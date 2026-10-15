// The I/O board (the operator board's I/O page): each PLC's I/O devices and the states of their boxes, and the I/O
// signals people chose, live, as time series. One monitor per PLC, shared by every board on it (stopped a minute after
// the last one closes), over the PLC's shared connection (read-only):
// - its I/O tree, as its TwinCAT project describes it (the boot folder's CurrentConfig.tszip), read again every 10
//   minutes and whenever the PLC's program changes; sent to a board when it is new to it (ioBoardTree);
// - its EtherCAT masters' slave states every 2 seconds (ioBoardState, with the PLC's ADS state);
// - the signals the boards chose (the PLC variables linked to the I/O), followed on change; the last 15 minutes kept,
//   so a chart opened shows them at once (ioSignalHistory), then their changes (ioSignalSamples, twice a second).
const crypto = require('crypto');

const IDLE_MS = 60000;
const TREE_EVERY_MS = 10 * 60000;
const STATES_EVERY_MS = 2000;
const KEEP_MS = 15 * 60000;
const KEEP_POINTS = 20000;
const MAX_SIGNALS = 50; // per PLC, every board together

function createIoBoards({ connectionFor, plcOf, log, sharedDir, retryMs = 30000 }) {
  const { readIoTree } = require(`${sharedDir}/tcIoTree.cjs`);
  const { readBootFile } = require(`${sharedDir}/tcSources.cjs`);
  const { readMasters } = require(`${sharedDir}/tcEcat.cjs`);
  const { VarWatcher } = require(`${sharedDir}/liveVars.cjs`);
  const ads = require(`${sharedDir}/tcAds.cjs`);
  const monitors = new Map(); // plc id -> monitor

  class IoMonitor {
    constructor(plc) {
      this.plc = plc;
      this.users = new Set();
      this.idle = null;
      this.conn = null;
      this.state = 'starting';
      this.message = '';
      this.tree = null;
      this.version = '';
      this.ecat = null;
      this.treeAt = 0;
      this.symbolVersion = null;
      this.stopped = false;
      this.timer = null;
      this.retry = null;
      this.busy = false;
      this.vars = null;
      this.wanted = new Map(); // viewer -> Set of signal paths (as asked)
      this.listeners = new Map(); // viewer -> fn(samples by path), its own signals only
      // (the samples drained here, twice a second, and handed to each board: one drain for all of them)
      this.fast = setInterval(() => this.hand(), 500);
      this.signals = new Map(); // path (lower case) -> { path, points: [{ t, v }], error }
      this.viewer = { send: () => {}, push: () => {}, lost: (message) => this.lost(message) };
    }

    async start() {
      if (this.stopped) return;
      this.state = 'connecting';
      this.message = `Connecting to ${this.plc.name}`;
      try {
        const conn = connectionFor(this.plc);
        await conn.connect();
        if (this.stopped) return;
        this.conn = conn;
        conn.viewers.add(this.viewer);
        clearTimeout(conn.idleTimer);
        this.state = 'watching';
        this.message = '';
        await this.readTree();
        await this.applySignals();
        this.timer = setInterval(() => void this.tick(), STATES_EVERY_MS);
        void this.tick();
      } catch (err) {
        this.state = 'error';
        this.message = err instanceof Error ? err.message : String(err);
        this.later();
      }
    }

    later() {
      clearTimeout(this.retry);
      if (!this.stopped) this.retry = setTimeout(() => void this.start(), retryMs);
    }

    lost(message) {
      if (this.stopped) return;
      this.state = 'error';
      this.message = message;
      this.cleanup();
      this.later();
    }

    cleanup() {
      clearInterval(this.timer);
      this.timer = null;
      const vars = this.vars;
      this.vars = null;
      if (vars && this.conn?.client) void vars.close().catch(() => {});
      this.conn?.viewers.delete(this.viewer);
      this.conn = null;
    }

    hand() {
      const got = this.drain();
      if (!got.size) return;
      for (const [viewer, fn] of this.listeners) {
        const mine = new Set([...(this.wanted.get(viewer) ?? [])].map((p) => p.toLowerCase()));
        const samples = {};
        for (const [p, list] of got) if (mine.has(p.toLowerCase())) samples[p] = list;
        if (Object.keys(samples).length) fn(samples);
      }
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retry);
      clearTimeout(this.idle);
      clearInterval(this.fast);
      const conn = this.conn;
      this.cleanup();
      if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
    }

    /** The I/O tree from the PLC's boot folder (its version: a hash, the boards get it when it changes) */
    async readTree() {
      const client = this.conn?.client;
      if (!client) return;
      this.treeAt = Date.now();
      try {
        const tree = await readIoTree((rel) => readBootFile(client, rel));
        const version = crypto.createHash('sha256').update(JSON.stringify(tree)).digest('hex').slice(0, 16);
        if (version !== this.version) {
          this.tree = tree;
          this.version = version;
          if (!tree.error) log(`io board: ${this.plc.id}: its I/O read (${(tree.devices ?? []).length} device(s))`);
        }
      } catch (err) {
        this.tree = { devices: [], links: [], error: ads.adsErrorText(err) };
        this.version = `error:${this.tree.error}`;
      }
    }

    async tick() {
      const client = this.conn?.client;
      if (!client || this.busy) return;
      this.busy = true;
      try {
        // (another program: its I/O read again)
        const sv = await ads.symbolVersion(client).catch(() => null);
        const changed = sv !== null && this.symbolVersion !== null && sv !== this.symbolVersion;
        if (sv !== null) this.symbolVersion = sv;
        if (changed || Date.now() - this.treeAt > TREE_EVERY_MS) await this.readTree();
        const netIds = (this.tree?.devices ?? []).filter((d) => d.netId && !d.disabled).map((d) => d.netId);
        this.ecat = netIds.length ? await readMasters(client, this.plc.netId, netIds) : { masters: {} };
      } catch (err) {
        this.ecat = { masters: {}, error: ads.adsErrorText(err) };
      } finally {
        this.busy = false;
      }
    }

    /** Every board's signals together, followed (the ones no board wants released, their points dropped) */
    async applySignals() {
      const all = new Map();
      for (const set of this.wanted.values()) for (const p of set) if (all.size < MAX_SIGNALS) all.set(p.toLowerCase(), p);
      for (const k of [...this.signals.keys()]) if (!all.has(k)) this.signals.delete(k);
      for (const [k, p] of all) if (!this.signals.has(k)) this.signals.set(k, { path: p, points: [], error: null });
      if (!this.conn?.client) return;
      if (!this.vars) {
        this.vars = new VarWatcher(this.conn.client, (m) => {
          for (const r of m?.vars ?? []) {
            const s = this.signals.get(String(r.id));
            if (s) s.error = r.error ?? null;
          }
        });
      }
      await this.vars.set([...all].map(([k, p]) => ({ id: k, candidates: [p] })));
    }

    /** The samples since the last drain, kept (the last 15 minutes) and returned by signal */
    drain() {
      const got = this.vars?.drain() ?? [];
      const out = new Map();
      const cut = Date.now() - KEEP_MS;
      for (const s of got) {
        const sig = this.signals.get(s.id);
        if (!sig) continue;
        const v = typeof s.v === 'bigint' ? Number(s.v) : s.v;
        const p = { t: s.t || Date.now(), v };
        sig.points.push(p);
        if (!out.has(sig.path)) out.set(sig.path, []);
        out.get(sig.path).push(p);
      }
      for (const sig of this.signals.values()) {
        let drop = 0;
        while (drop < sig.points.length - 1 && (sig.points[drop].t < cut || sig.points.length - drop > KEEP_POINTS)) drop++;
        // (the last point before the cut stays: the value at the window's start)
        if (drop > 1) sig.points.splice(0, drop - 1);
      }
      return out;
    }
  }

  function acquire(id, viewer) {
    let m = monitors.get(id);
    if (!m) {
      const plc = plcOf(id);
      if (!plc) return null;
      m = new IoMonitor(plc);
      monitors.set(id, m);
      void m.start();
    }
    clearTimeout(m.idle);
    m.users.add(viewer);
    return m;
  }
  function release(id, viewer) {
    const m = monitors.get(id);
    if (!m) return;
    m.users.delete(viewer);
    m.listeners.delete(viewer);
    if (m.wanted.delete(viewer)) void m.applySignals().catch(() => {});
    if (m.users.size) return;
    clearTimeout(m.idle);
    m.idle = setTimeout(() => {
      if (m.users.size) return;
      m.stop();
      monitors.delete(id);
    }, IDLE_MS);
  }

  return {
    /**
     * A board's PLCs followed for viewer (an object of its own): states every 2 s, the tree when new to it, its
     * signals' samples twice a second. Returns { stop, signals(plcId, paths) }
     */
    watch(plcIds, viewer, send) {
      const ids = plcIds.filter((id) => plcOf(id));
      const mons = ids.map((id) => acquire(id, viewer)).filter(Boolean);
      for (const m of mons) m.listeners.set(viewer, (samples) => send({ type: 'ioSignalSamples', plc: m.plc.id, samples }));
      const sentVersion = new Map();
      const tick = () => {
        for (const m of mons) {
          if (m.tree && sentVersion.get(m.plc.id) !== m.version) {
            sentVersion.set(m.plc.id, m.version);
            send({ type: 'ioBoardTree', plc: m.plc.id, version: m.version, tree: m.tree });
          }
        }
        send({
          type: 'ioBoardState', now: Date.now(),
          plcs: mons.map((m) => ({ id: m.plc.id, name: m.plc.name, state: m.state, message: m.message, plcState: m.conn?.plcState ?? null, version: m.version, ecat: m.ecat, signals: [...m.signals.values()].filter((s) => s.error).map((s) => ({ path: s.path, error: s.error })) })),
        });
      };
      tick();
      const timer = setInterval(tick, STATES_EVERY_MS);
      return {
        stop() {
          clearInterval(timer);
          for (const m of mons) release(m.plc.id, viewer);
        },
        /** This board's signals of a PLC (others' stay); their last 15 minutes sent at once */
        async signals(plcId, paths) {
          const m = mons.find((x) => x.plc.id === plcId);
          if (!m) return { error: 'Not a PLC of this board' };
          const list = [...new Set(paths.filter((p) => typeof p === 'string' && ads.isSymbolPath(p)))].slice(0, 20);
          m.wanted.set(viewer, new Set(list));
          await m.applySignals().catch(() => {});
          const history = {};
          for (const p of list) history[p] = m.signals.get(p.toLowerCase())?.points.slice() ?? [];
          send({ type: 'ioSignalHistory', plc: plcId, history });
          return { ok: true, signals: list };
        },
      };
    },
    stop() {
      for (const m of monitors.values()) m.stop();
      monitors.clear();
    },
  };
}

module.exports = { createIoBoards };

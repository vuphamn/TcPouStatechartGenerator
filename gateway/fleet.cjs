// The fleet: every I/O box of every PLC (the inventory: what is where, its maker, its type and firmware) and how each
// one fares (the risk list's I/O part). For each PLC, over its shared connection: its I/O tree read every 30 minutes
// (the boot folder's project, read-only), its EtherCAT masters' states every 60 seconds; per box and day, counted:
// how often it was seen out of OP, its CRC errors' increase. Kept in fleet/<plc>/summary.json beside config.json (the
// last 60 days). config.json "fleet": { "enabled": true, "everySeconds": 60 }.
const fs = require('fs');
const path = require('path');

const TREE_EVERY_MS = 30 * 60000;
const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function createFleet({ baseDir, getConfig, plcList, connectionFor, sharedDir, ads, log }) {
  const { readIoTree } = require(`${sharedDir}/tcIoTree.cjs`);
  const { readBootFile } = require(`${sharedDir}/tcSources.cjs`);
  const { readMasters, describeState } = require(`${sharedDir}/tcEcat.cjs`);
  const settings = () => {
    const c = getConfig().fleet ?? {};
    return { enabled: c.enabled !== false && getConfig().allowBrowse !== false, everyMs: Math.max(10, Math.min(3600, Number(c.everySeconds) || 60)) * 1000 };
  };
  const dirOf = (id) => path.join(baseDir, 'fleet', String(id).replace(/[^\w.-]/g, '_'));
  const monitors = new Map();

  class FleetMonitor {
    constructor(plc) {
      this.plc = plc;
      this.state = 'starting';
      this.message = '';
      this.conn = null;
      this.tree = null;
      this.treeAt = 0;
      this.boxes = []; // { path, name, product, device, netId, slave, address, vendor, type, revision, productCode, disabled }
      this.now = new Map(); // box path -> { ok, name, crc }
      this.summary = (() => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dirOf(plc.id), 'summary.json'), 'utf8'));
        } catch {
          return { days: {} };
        }
      })();
      this.viewer = { send: () => {}, push: () => {}, lost: (m) => this.lost(m) };
      this.stopped = false;
      this.busy = false;
    }

    async start() {
      if (this.stopped) return;
      try {
        const conn = connectionFor(this.plc);
        await conn.connect();
        if (this.stopped) return;
        this.conn = conn;
        conn.viewers.add(this.viewer);
        clearTimeout(conn.idleTimer);
        this.state = 'watching';
        this.message = '';
        void this.round();
        this.timer = setInterval(() => void this.round(), settings().everyMs);
      } catch (err) {
        this.state = 'error';
        this.message = err instanceof Error ? err.message : String(err);
        this.retry = setTimeout(() => void this.start(), 60000);
      }
    }

    lost(message) {
      if (this.stopped) return;
      this.state = 'error';
      this.message = message;
      clearInterval(this.timer);
      this.conn?.viewers.delete(this.viewer);
      this.conn = null;
      clearTimeout(this.retry);
      this.retry = setTimeout(() => void this.start(), 60000);
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retry);
      clearInterval(this.timer);
      const conn = this.conn;
      conn?.viewers.delete(this.viewer);
      this.conn = null;
      if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
      this.save();
    }

    save() {
      try {
        fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(this.plc.id), 'summary.json'), JSON.stringify(this.summary));
      } catch (err) {
        log(`fleet: ${this.plc.id}: ${err.message}`);
      }
    }

    async round() {
      const client = this.conn?.client;
      if (!client || this.busy || this.stopped) return;
      this.busy = true;
      try {
        if (!this.tree || Date.now() - this.treeAt > TREE_EVERY_MS) {
          this.treeAt = Date.now();
          const tree = await readIoTree((rel) => readBootFile(client, rel)).catch((err) => ({ devices: [], error: ads.adsErrorText(err) }));
          if (!tree.error || !this.tree) this.tree = tree;
          this.message = tree.error ? `Its I/O not read: ${tree.error}` : '';
          const boxes = [];
          for (const d of tree.devices ?? []) {
            const walk = (list) => {
              for (const b of list) {
                boxes.push({ path: b.path, name: b.name, product: b.product, device: d.name, netId: d.netId, slave: b.slave ?? null, address: b.address ?? null, vendorId: b.info?.vendorId ?? null, vendor: b.info?.supplier || (b.info?.vendorId === 2 ? 'Beckhoff' : b.info?.vendorId != null ? `vendor #x${b.info.vendorId.toString(16)}` : ''), type: b.info?.type ?? b.product ?? '', productCode: b.info?.productCode ?? '', revision: b.info?.revision ?? '', disabled: !!(b.disabled || d.disabled) });
                walk(b.boxes);
              }
            };
            walk(d.boxes);
          }
          this.boxes = boxes;
        }
        // (the masters' states: each box's, by its address, else its place; counted per day)
        const netIds = [...new Set((this.tree?.devices ?? []).filter((d) => d.netId && !d.disabled).map((d) => d.netId))];
        if (!netIds.length) return;
        const r = await readMasters(client, this.plc.netId, netIds);
        const day = dayOf(Date.now());
        const today = (this.summary.days[day] ??= {});
        for (const d of this.tree.devices ?? []) {
          const m = r.masters?.[d.netId];
          if (!m?.slaves) continue;
          const mine = this.boxes.filter((b) => b.device === d.name && !b.disabled);
          const byAddress = new Map(m.slaves.filter((s) => s.address !== undefined).map((s) => [s.address, s]));
          for (const b of mine) {
            const s = (b.address != null && byAddress.get(b.address)) || (b.slave != null ? m.slaves[b.slave] : null);
            const st = (today[b.path] ??= { seen: 0, notOp: 0, crc: 0 });
            st.seen++;
            const ok = !!s && s.ok !== false && (s.name ?? describeState?.(s.state)?.name ?? 'OP') === 'OP';
            if (!ok) st.notOp++;
            const before = this.now.get(b.path);
            const crcSum = Array.isArray(s?.crc) ? s.crc.reduce((a, x) => a + x, 0) : null;
            if (crcSum !== null && before?.crc != null && crcSum > before.crc) st.crc += crcSum - before.crc;
            this.now.set(b.path, { ok, name: s?.name ?? (s ? 'OP' : 'missing'), crc: crcSum });
          }
        }
        const days = Object.keys(this.summary.days).sort();
        for (const old of days.slice(0, Math.max(0, days.length - 60))) delete this.summary.days[old];
        this.save();
      } catch (err) {
        this.message = ads.adsErrorText(err);
      } finally {
        this.busy = false;
      }
    }

    /** Each box with its last 7 days and now */
    view() {
      const days = Object.keys(this.summary.days).sort().slice(-7);
      return {
        id: this.plc.id, name: this.plc.name, state: this.state, message: this.message,
        boxes: this.boxes.map((b) => {
          const week = days.map((d) => this.summary.days[d]?.[b.path]).filter(Boolean);
          return { ...b, now: this.now.get(b.path) ?? null, week: { seen: week.reduce((a, x) => a + x.seen, 0), notOp: week.reduce((a, x) => a + x.notOp, 0), crc: week.reduce((a, x) => a + x.crc, 0), daysOut: week.filter((x) => x.notOp > 0).length } };
        }),
      };
    }
  }

  const apply = () => {
    const s = settings();
    const wanted = new Set(s.enabled ? plcList().map((p) => p.id) : []);
    for (const [id, m] of monitors) {
      if (wanted.has(id) && JSON.stringify(m.plc) === JSON.stringify(plcList().find((p) => p.id === id))) continue;
      m.stop();
      monitors.delete(id);
    }
    for (const plc of plcList()) {
      if (!wanted.has(plc.id) || monitors.has(plc.id)) continue;
      const m = new FleetMonitor(plc);
      monitors.set(plc.id, m);
      void m.start();
    }
  };
  return {
    start: apply,
    apply,
    stop() {
      for (const m of monitors.values()) m.stop();
      monitors.clear();
    },
    view: () => [...monitors.values()].map((m) => m.view()),
    /** A round now on each PLC (the tests, the setup page) */
    roundNow: async () => {
      for (const m of monitors.values()) await m.round();
    },
  };
}

module.exports = { createFleet };

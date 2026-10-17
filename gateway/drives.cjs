// The drive health board's monitor: each PLC's drives (the EtherCAT boxes a drive profile matches, driveProfiles.cjs:
// Lenze i550, any maker's CiA 402 drive) read by the gateway itself, read-only, without the PLC's program: their own
// parameters (CoE objects, an SDO upload through the EtherCAT master: ADS index group 0xF302, the device's AMS NetId,
// the slave's EtherCAT address as the port) every 30 seconds (the slow ones, hours and counters, every 10 minutes),
// one after the other: a few mailbox reads a second for a whole line.
// - Kept: drives/<plc>/<day>.jsonl beside config.json (a value when it changes, else every 10 minutes; past days
//   compressed; config.drives.keepDays, 90 by default) and each day's statistics (summary.json), the baselines.
// - Judged (driveHealth.cjs) after each round: against its limits, its own past, its siblings; a drive turning to
//   warn or alarm is an alert (the boards' alert list, the chime, config.drives.webhook), its recovery too.
// - The board's Drives page follows them (drivesWatch: drivesState after each round), a drive's history (driveHistory).
// config.json "drives": { "enabled": true, "everySeconds": 30, "slowEveryMinutes": 10, "keepDays": 90, "plcs": [ids],
// "limits": { … driveHealth DEFAULTS }, "profiles": [ … ], "webhook": "https://…", "format": "teams" }.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { findMeters } = require('./energy.cjs');
const { profilesOf, profileFor, decodeValue } = require('./driveProfiles.cjs');
const { evaluate, dayStats } = require('./driveHealth.cjs');

const COE_SDO = 0xf302;
const HEARTBEAT_MS = 10 * 60000;
const TREE_EVERY_MS = 30 * 60000;
const SPARK_KEYS = ['heatsink', 'current', 'currentPct', 'dcBus'];
const SPARK_BUCKET_MS = 15 * 60000;
const REPEAT_MS = 12 * 3600_000;

const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * The drives at their EtherCAT addresses, by their identity (CoE 0x1018: vendor, product code; read(netId, address)): each
 * at its own address; else the address the master gives its place on the bus; else among the master's slaves, or (the
 * master gives no addresses) a scan of the addresses its project uses; several alike found: in order, said so
 */
async function locateDrives({ list, slaves, maxAddress = 1000, read, errorText = (e) => e.message, log = () => {} }) {
  const ids = new Map();
  const identity = async (netId, address) => {
    if (ids.has(address)) return ids.get(address);
    let r;
    try {
      r = await read(netId, address);
    } catch (err) {
      r = { error: errorText(err) };
    }
    ids.set(address, r);
    return r;
  };
  const hex = (n) => `#x${Number(n).toString(16)}`;
  const what = (id) => (id.error ? id.error : `vendor ${hex(id.vendorId)}, product ${hex(id.productCode)}`);
  const matches = (id, d) => !id.error && id.vendorId === d.vendorId && (d.productCode === null || id.productCode === d.productCode);
  const claimed = new Set();
  const take = (d, at, how, before) => {
    log(`${d.name}: at EtherCAT address ${at}, not ${d.address} (${how}; there: ${what(before)})`);
    d.identity = `found at ${at}, not ${d.address}${how === 'by order' ? ' (by order: alike ones)' : ''}`;
    d.address = at;
    claimed.add(at);
  };
  // 1. Each at its own address: the one its PLC link gives (its InfoData AdsAddr, read by the PLC), else its project's
  let lost = [];
  for (const d of list) {
    if (d.vendorId === null) {
      d.identity = 'unknown';
      continue;
    }
    if (typeof d.linkAddress === 'number' && d.linkAddress !== d.address && !claimed.has(d.linkAddress)) {
      const byLink = await identity(d.netId, d.linkAddress);
      if (matches(byLink, d)) {
        log(`${d.name}: at EtherCAT address ${d.linkAddress}, not ${d.address} (its PLC link, ${d.linkVar})`);
        d.identity = `found at ${d.linkAddress}, not ${d.address} (its PLC link)`;
        d.address = d.linkAddress;
        claimed.add(d.address);
        continue;
      }
    }
    const id = await identity(d.netId, d.address);
    if (matches(id, d)) {
      d.identity = typeof d.linkAddress === 'number' ? 'checked (its PLC link)' : 'checked';
      claimed.add(d.address);
    } else lost.push({ d, id });
  }
  if (!lost.length) return;
  // 2. At the address the master gives its place on the bus
  const listed = (slaves ?? []).some((x) => typeof x.address === 'number');
  for (const l of [...lost]) {
    const at = listed && l.d.slave !== null ? slaves[l.d.slave]?.address : null;
    if (typeof at !== 'number' || claimed.has(at) || at === l.d.address) continue;
    if (matches(await identity(l.d.netId, at), l.d)) {
      take(l.d, at, 'its place on the bus', l.id);
      lost = lost.filter((x) => x !== l);
    }
  }
  // 3. Among the master's slaves, or (no addresses from the master) a scan of the addresses the project uses
  const candidates = listed ? slaves.map((x) => x.address).filter((x) => typeof x === 'number') : Array.from({ length: Math.min(512, maxAddress - 1000 + 32) }, (_, i) => 1001 + i);
  const free = [];
  for (const at of candidates) {
    if (claimed.has(at) || !lost.length) continue;
    const id = await identity(lost[0].d.netId, at);
    if (!id.error) free.push({ at, id });
  }
  for (const l of [...lost]) {
    const alike = free.filter((x) => !claimed.has(x.at) && matches(x.id, l.d));
    if (!alike.length) continue;
    // (more than one alike left, and more than one drive alike lost: in order, said so)
    const others = lost.filter((x) => x !== l && x.d.vendorId === l.d.vendorId && x.d.productCode === l.d.productCode);
    take(l.d, alike[0].at, alike.length > 1 && others.length ? 'by order' : listed ? 'among the master\'s slaves' : 'a scan', l.id);
    lost = lost.filter((x) => x !== l);
  }
  // 4. Not found: why
  const anyIdentity = [...ids.values()].some((x) => !x.error);
  for (const { d, id } of lost) {
    if (!anyIdentity) {
      d.identity = 'unverified';
      continue;
    }
    d.identity = 'not found';
    const where = listed ? 'none of the master\'s slaves' : `none of the addresses 1001 to ${candidates.at(-1)} (the master gives no addresses)`;
    d.notFound = `not found on the EtherCAT bus: its identity (${what({ vendorId: d.vendorId, productCode: d.productCode ?? 0 })}) at ${where}; at its address ${d.address}: ${what(id)}`;
  }
}

/**
 * Each drive pinned to its serial number (CoE 0x1018:4, read at its address: d.serial): its first one kept
 * (pins: { drive path: { serial, since } }); drives alike that traded places follow their serials (their addresses
 * swapped); a new serial where a drive was, not another drive's: replaced (its pin and its baseline start again).
 * Gives the drives replaced: [{ d, was, now }]
 */
function reconcileSerials(list, pins, now = Date.now()) {
  const replaced = [];
  const at = new Map(list.filter((d) => typeof d.serial === 'number').map((d) => [d.serial, { address: d.address, d }]));
  const moves = [];
  for (const d of list) {
    const pin = pins[d.path];
    if (typeof d.serial !== 'number') continue;
    if (!pin) {
      // (pinned the first time: its past still its own)
      pins[d.path] = { serial: d.serial, since: null };
      continue;
    }
    if (pin.serial === d.serial) continue;
    const there = at.get(pin.serial);
    if (there && there.d !== d) moves.push({ d, address: there.address, serial: pin.serial });
    else replaced.push({ d, was: pin.serial, now: d.serial });
  }
  // (all moves at once: one's address taken from where its serial was read, before any changed)
  for (const m of moves) {
    m.d.identity = `found at ${m.address}, not ${m.d.address} (by its serial ${m.serial})`;
    m.d.address = m.address;
    m.d.serial = m.serial;
  }
  for (const r of replaced) pins[r.d.path] = { serial: r.now, since: now };
  return replaced;
}

function createDrives({ baseDir, getConfig, plcList, connectionFor, sharedDir, ads, log, onEvent, postWebhook, onSettingsChange }) {
  const { readIoTree } = require(`${sharedDir}/tcIoTree.cjs`);
  const { readBootFile } = require(`${sharedDir}/tcSources.cjs`);
  const { readEcatStates } = require(`${sharedDir}/tcEcat.cjs`);
  const settings = () => {
    const c = getConfig().drives ?? {};
    return {
      enabled: c.enabled !== false && getConfig().allowBrowse !== false,
      everyMs: Math.max(5, Math.min(3600, Number(c.everySeconds) || 30)) * 1000,
      slowMs: Math.max(1, Math.min(24 * 60, Number(c.slowEveryMinutes) || 10)) * 60000,
      keepDays: Math.max(2, Math.min(3650, Number(c.keepDays) || 90)),
      plcs: Array.isArray(c.plcs) && c.plcs.length ? c.plcs : null,
      limits: c.limits && typeof c.limits === 'object' ? c.limits : {},
      profiles: profilesOf(c.profiles, log),
      webhook: typeof c.webhook === 'string' && /^https?:\/\//i.test(c.webhook) ? c.webhook : null,
      format: ['teams', 'slack', 'json'].includes(c.format) ? c.format : 'teams',
      // (a PLC's mains signal, a BOOL: TRUE its mains on; "NOT x": TRUE off, an E-stop say; { plc id: symbol }, or
      // one symbol for every PLC)
      mains: typeof c.mains === 'string' || (c.mains && typeof c.mains === 'object') ? c.mains : null,
      // (each drive's settings read: once a day by default)
      settingsMs: Math.max(0.01, Math.min(24 * 30, Number(c.settingsEveryHours) || 24)) * 3600000,
    };
  };
  const fmtSetting = (v, unit) => `${Math.round(v * 1000) / 1000}${unit ? ` ${unit}` : ''}`;
  /** A PLC's mains signal: { symbol, invert, name } or null */
  const mainsOf = (s, plcId) => {
    const raw = typeof s.mains === 'string' ? s.mains : s.mains?.[plcId];
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const m = /^\s*NOT\s+(.+?)\s*$/i.exec(raw);
    return { symbol: (m ? m[1] : raw).trim(), invert: !!m, name: raw.trim() };
  };
  const dirOf = (plcId) => path.join(baseDir, 'drives', String(plcId).replace(/[^\w.-]/g, '_'));
  const monitors = new Map(); // plc id -> monitor
  const listeners = new Set();

  class DriveMonitor {
    constructor(plc) {
      this.plc = plc;
      this.state = 'starting';
      this.message = '';
      this.conn = null;
      this.tree = null;
      this.treeAt = 0;
      this.drives = []; // { path, name, device, netId, address, profile, latest, slowAt, failing, stored, today: [], spark, health, sent }
      this.timer = null;
      this.busy = false;
      this.stopped = false;
      this.lastRound = null;
      this.summary = this.readSummary();
      this.viewer = { send: () => {}, push: () => {}, lost: (m) => this.lost(m) };
    }

    readSummary() {
      try {
        return JSON.parse(fs.readFileSync(path.join(dirOf(this.plc.id), 'summary.json'), 'utf8'));
      } catch {
        return { days: {} };
      }
    }

    saveSummary() {
      try {
        fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
        fs.writeFileSync(path.join(dirOf(this.plc.id), 'summary.json'), JSON.stringify(this.summary));
      } catch (err) {
        log(`drives: ${this.plc.id}: summary.json: ${err.message}`);
      }
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
        await this.readTree();
        // (no drive a profile knows in its I/O: its connection not held for nothing; looked at again later)
        if (!this.drives.length) {
          this.state = 'idle';
          this.message = this.tree?.error ? this.message : 'No drive in its I/O that a profile knows';
          this.conn = null;
          conn.viewers.delete(this.viewer);
          if (conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
          for (const fn of listeners) fn(this.plc.id);
          clearTimeout(this.retry);
          if (!this.stopped) this.retry = setTimeout(() => void this.start(), TREE_EVERY_MS);
          return;
        }
        this.loadToday();
        void this.round();
        this.timer = setInterval(() => void this.round(), settings().everyMs);
      } catch (err) {
        this.state = 'error';
        this.message = err instanceof Error ? err.message : String(err);
        this.later();
      }
    }

    later() {
      clearTimeout(this.retry);
      if (!this.stopped) this.retry = setTimeout(() => void this.start(), 60000);
    }

    lost(message) {
      if (this.stopped) return;
      this.state = 'error';
      this.message = message;
      clearInterval(this.timer);
      this.conn?.viewers.delete(this.viewer);
      this.conn = null;
      this.later();
    }

    stop() {
      this.stopped = true;
      clearTimeout(this.retry);
      clearInterval(this.timer);
      const conn = this.conn;
      conn?.viewers.delete(this.viewer);
      this.conn = null;
      if (conn && conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
    }

    /** Its drives from the PLC's I/O (its boot folder); the ones kept, their values and history */
    async readTree() {
      const client = this.conn?.client;
      if (!client) return;
      this.treeAt = Date.now();
      const tree = await readIoTree((rel) => readBootFile(client, rel)).catch((err) => ({ devices: [], error: ads.adsErrorText(err) }));
      this.tree = tree;
      if (tree.error) {
        this.message = `Its I/O not read: ${tree.error}`;
        return;
      }
      const profiles = settings().profiles;
      const found = [];
      for (const d of tree.devices ?? []) {
        if (d.disabled || !d.netId) continue;
        // (the master's own addresses: a box's place among its slaves, when it is not at its default address)
        let slaves = null;
        try {
          const r = await readEcatStates(client, d.netId);
          slaves = r.slaves ?? null;
        } catch {
          slaves = null;
        }
        const walk = (boxes) => {
          for (const b of boxes) {
            const profile = b.disabled ? null : profileFor(b, profiles);
            if (profile) {
              const known = slaves?.some((s) => s.address === b.address);
              const address = known || !slaves ? b.address : slaves[b.slave ?? -1]?.address ?? b.address;
              found.push({ path: b.path, name: b.name.replace(/\s*\([^()]*\)\s*$/, '') || b.name, box: b.name, device: d.name, netId: d.netId, address, profile, notFound: null, identity: null, slave: b.slave ?? null, vendorId: b.info?.vendorId ?? null, productCode: /^#x[0-9a-f]+$/i.test(b.info?.productCode ?? '') ? parseInt(b.info.productCode.slice(2), 16) : null, product: b.info?.desc ?? '', firmware: b.info?.type ?? '', vendor: b.info?.supplier || (b.info?.vendorId !== undefined ? `vendor #x${b.info.vendorId.toString(16)}` : '') });
            }
            walk(b.boxes);
          }
        };
        walk(d.boxes);
        // (the highest address the project gives a box of this master: a scan's end)
        let maxAddress = 1000;
        const all = (boxes) => {
          for (const b of boxes ?? []) {
            if (typeof b.address === 'number') maxAddress = Math.max(maxAddress, b.address);
            all(b.boxes);
          }
        };
        all(d.boxes);
        // (each drive's InfoData AdsAddr linked to a PLC variable: read for its address)
        const tail = (p) => String(p).split('^').slice(1).join('^').toLowerCase();
        const adsLinks = new Map((tree.links ?? []).filter((l) => /^InfoData\^AdsAddr$/i.test(l.entry ?? '')).map((l) => [tail(l.box), l.variable]));
        for (const f of found) if (f.netId === d.netId) f.linkVar = adsLinks.get(tail(f.path)) ?? null;
        await this.verifyAddresses(client, found.filter((f) => f.netId === d.netId), slaves, maxAddress);
      }
      const old = new Map(this.drives.map((x) => [x.path, x]));
      this.drives = found.map((f) => ({ ...(old.get(f.path) ?? { latest: {}, slowAt: 0, failing: 0, stored: {}, today: [], spark: {}, health: null, sent: {} }), ...f }));
      if (found.length !== old.size) log(`drives: ${this.plc.id}: ${found.length} drive(s) in its I/O (${[...new Set(found.map((x) => x.profile.name))].join(', ') || 'none a profile knows'})`);
    }

    /**
     * Each drive at its address, by its identity (CoE 0x1018: vendor, product code): the address the project gives
     * it may be another slave's. One not there (another's identity, or no slave at it): looked for among the master's
     * slaves, in their order (each one taken once). Its identity not readable anywhere: kept where it was.
     */
    async verifyAddresses(client, list, slaves, maxAddress = 1000) {
      const read = async (netId, address) => {
        const v = await client.readRaw(COE_SDO, (0x1018 << 16) | 1, 4, { amsNetId: netId, adsPort: address });
        const p = await client.readRaw(COE_SDO, (0x1018 << 16) | 2, 4, { amsNetId: netId, adsPort: address });
        return { vendorId: v.readUInt32LE(0), productCode: p.readUInt32LE(0) };
      };
      // (a drive whose InfoData AdsAddr the PLC links to a variable, an AMSADDR: its address, exactly)
      for (const d of list) {
        if (!d.linkVar) continue;
        try {
          const handle = await ads.createHandle(client, d.linkVar);
          try {
            // (its bytes as they are: the NetId (6), the port (UINT): the slave's EtherCAT address; 0xF005, by handle)
            const buf = await client.readRaw(0xf005, handle, 8);
            const port = buf.readUInt16LE(6);
            if (port >= 1 && port < 65535) d.linkAddress = port;
          } finally {
            await ads.releaseHandle(client, handle).catch(() => {});
          }
        } catch {
          // (not readable: its project's address, then the search)
        }
      }
      await locateDrives({ list, slaves, maxAddress, read, errorText: (e) => ads.adsErrorText(e), log: (t) => log(`drives: ${this.plc.id}: ${t}`) });
      // (each one's serial: drives alike that traded places follow theirs; one replaced, said, its baseline anew)
      for (const d of list) {
        d.serial = null;
        if (d.notFound || d.vendorId === null) continue;
        try {
          d.serial = (await client.readRaw(COE_SDO, (0x1018 << 16) | 4, 4, { amsNetId: d.netId, adsPort: d.address })).readUInt32LE(0);
        } catch {
          d.serial = null;
        }
      }
      const pins = (this.summary.serials ??= {});
      for (const r of reconcileSerials(list, pins)) {
        log(`drives: ${this.plc.id}: ${r.d.name}: serial ${r.now}, was ${r.was}: replaced`);
        this.say(r.d, 'drive', `🔧 ${r.d.name}: replaced? Its serial ${r.now}, was ${r.was}: its baseline starts again`, 'watch', settings());
      }
      this.saveSummary();
    }

    /** Today's samples back from its file (the gateway restarted) */
    loadToday() {
      const file = path.join(dirOf(this.plc.id), `${dayOf(Date.now())}.jsonl`);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        return;
      }
      const by = new Map(this.drives.map((d) => [d.path, d]));
      const rows = new Map(); // path -> Map(t -> values)
      for (const line of text.split('\n')) {
        if (!line) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const d = by.get(o.d);
        if (!d || typeof o.v !== 'number') continue;
        if (!rows.has(o.d)) rows.set(o.d, new Map());
        const m = rows.get(o.d);
        if (!m.has(o.t)) m.set(o.t, {});
        m.get(o.t)[o.k] = o.v;
        d.stored[o.k] = { v: o.v, t: o.t };
      }
      // (a value kept only when it changed: carried forward to each row)
      for (const [p, m] of rows) {
        const d = by.get(p);
        const cur = {};
        d.today = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, vals]) => ({ t, values: Object.assign(cur, vals) && { ...cur } }));
      }
    }

    async readParam(client, drive, p) {
      const buf = await client.readRaw(COE_SDO, ((p.index & 0xffff) << 16) | (p.sub & 0xff), p.size, { amsNetId: drive.netId, adsPort: drive.address });
      return decodeValue(buf, p);
    }

    /**
     * A drive's settings (its profile's settings: its ramps, limits, motor nameplate), read once a day (and when the
     * gateway starts), against the last ones kept (summary.json): a change told (an alert) and kept to explain and
     * approve (change control: onSettingsChange), with what it was
     */
    async readSettings(client, d, now, s) {
      d.settingsAt = now;
      const values = {};
      for (const p of d.profile.settings) {
        try {
          const r = await this.readParam(client, d, p);
          if (typeof r?.value === 'number') values[p.key] = Math.round(r.value * 1e6) / 1e6;
        } catch {
          // (not answered: not this drive's object, or its firmware's: left out)
        }
      }
      if (!Object.keys(values).length) return;
      const kept = (this.summary.settings ??= {});
      const prev = kept[d.path];
      const changes = [];
      for (const p of d.profile.settings) {
        const was = prev?.values?.[p.key];
        const v = values[p.key];
        if (typeof was === 'number' && typeof v === 'number' && Math.abs(was - v) > 1e-9) changes.push({ key: p.key, label: p.label, unit: p.unit, was, now: v });
      }
      kept[d.path] = { t: now, values, ...(prev?.since && !changes.length ? { since: prev.since } : { since: now }) };
      if (changes.length) {
        const hist = ((this.summary.settingsChanges ??= {})[d.path] ??= []);
        hist.push({ t: now, changes });
        if (hist.length > 50) hist.splice(0, hist.length - 50);
        const one = (c) => `${c.label}: ${fmtSetting(c.was, c.unit)} → ${fmtSetting(c.now, c.unit)}`;
        this.say(d, 'drive', `🔧 ${d.name}: its settings changed: ${changes.map(one).join('; ')}`, 'watch', s);
        onSettingsChange?.({ plc: this.plc.id, plcName: this.plc.name, kind: 'drive settings', project: d.name, files: changes.map((c) => `${d.name}: ${one(c)}`), unit: 'setting', text: `${this.plc.name}: 🧾 ${d.name}: its settings changed (${changes.length}): not explained yet` });
      }
      this.saveSummary();
    }

    /** The PLC's mains signal, when one is set: this.mains { name, on: true / false / null, error } */
    async readMains(client, s) {
      const m = mainsOf(s, this.plc.id);
      if (!m) {
        this.mains = null;
        return;
      }
      try {
        const handle = await ads.createHandle(client, m.symbol);
        try {
          const buf = await client.readRaw(0xf005, handle, 1);
          this.mains = { name: m.name, on: !!buf[0] !== m.invert, error: null };
        } finally {
          await ads.releaseHandle(client, handle).catch(() => {});
        }
      } catch (err) {
        if (!this.mains?.error) log(`drives: ${this.plc.id}: its mains signal ${m.name}: ${ads.adsErrorText(err)}`);
        this.mains = { name: m.name, on: null, error: ads.adsErrorText(err) };
      }
    }

    /** One round: every drive's values, kept, judged, sent */
    async round() {
      const client = this.conn?.client;
      if (!client || this.busy || this.stopped) return;
      this.busy = true;
      const s = settings();
      try {
        if (Date.now() - this.treeAt > TREE_EVERY_MS) await this.readTree();
        const now = Date.now();
        const lines = [];
        await this.readMains(client, s);
        for (const d of this.drives) {
          // (a drive not answering: tried every 5 minutes only)
          if (d.failing >= 3 && now - (d.lastTry ?? 0) < 5 * 60000) continue;
          // (not on the bus: not read until its I/O is read again)
          if (d.notFound) {
            d.latest = { error: { v: null, t: now, error: d.notFound } };
            d.failing = 3;
            d.lastTry = now;
            continue;
          }
          d.lastTry = now;
          const slow = now - d.slowAt >= s.slowMs;
          let ok = 0;
          for (const p of d.profile.params) {
            if (p.slow && !slow) continue;
            try {
              const r = await this.readParam(client, d, p);
              d.latest[p.key] = { v: r?.value ?? null, raw: r?.raw ?? null, t: now };
              ok++;
            } catch (err) {
              d.latest[p.key] = { v: null, t: now, error: ads.adsErrorText(err) };
            }
          }
          if (slow) d.slowAt = now;
          d.failing = ok ? 0 : d.failing + 1;
          if (ok && d.profile.settings?.length && now - (d.settingsAt ?? 0) >= s.settingsMs) await this.readSettings(client, d, now, s);
          const values = {};
          for (const [k, x] of Object.entries(d.latest)) if (typeof x.v === 'number') values[k] = x.v;
          if (!ok) continue;
          // (no mains: its 0 °C, 0 A not its day's values)
          const noMains = (typeof values.dcBus === 'number' && values.dcBus < (s.limits?.noMainsV ?? 50)) || this.mains?.on === false;
          if (!noMains) d.today.push({ t: now, values });
          if (d.today.length > 6000) d.today.splice(0, d.today.length - 6000);
          // (kept when it changed, else every 10 minutes)
          for (const [k, v] of Object.entries(values)) {
            const st = d.stored[k];
            if (!st || st.v !== v || now - st.t >= HEARTBEAT_MS) {
              lines.push(JSON.stringify({ t: now, d: d.path, k, v: Math.round(v * 1000) / 1000 }));
              d.stored[k] = { v, t: now };
            }
          }
          for (const k of noMains ? [] : SPARK_KEYS) {
            if (typeof values[k] !== 'number') continue;
            const b = Math.floor(now / SPARK_BUCKET_MS) * SPARK_BUCKET_MS;
            const list = (d.spark[k] ??= []);
            const last = list[list.length - 1];
            if (last && last.t === b) {
              last.sum += values[k];
              last.n++;
            } else list.push({ t: b, sum: values[k], n: 1 });
            while (list.length && list[0].t < now - 24 * 3600_000) list.shift();
          }
        }
        if (lines.length) {
          try {
            fs.mkdirSync(dirOf(this.plc.id), { recursive: true });
            fs.appendFileSync(path.join(dirOf(this.plc.id), `${dayOf(now)}.jsonl`), lines.join('\n') + '\n');
          } catch (err) {
            log(`drives: ${this.plc.id}: ${err.message}`);
          }
        }
        this.rollDay(now);
        this.judge(s);
        this.lastRound = now;
        this.message = this.drives.length ? '' : this.tree?.error ? this.message : 'No drive in its I/O that a profile knows';
        for (const fn of listeners) fn(this.plc.id);
      } finally {
        this.busy = false;
      }
    }

    /** A new day: yesterday's statistics kept, today's samples begun afresh; old days compressed and removed */
    rollDay(now) {
      const today = dayOf(now);
      for (const d of this.drives) {
        const first = d.today[0];
        if (!first || dayOf(first.t) === today) continue;
        const day = dayOf(first.t);
        const done = d.today.filter((x) => dayOf(x.t) === day);
        d.today = d.today.filter((x) => dayOf(x.t) !== day);
        const stats = dayStats(done, d.profile);
        const counters = {};
        for (const p of d.profile.params.filter((x) => x.counter)) {
          const last = [...done].reverse().find((x) => typeof x.values[p.key] === 'number');
          if (last) counters[p.key] = last.values[p.key];
        }
        ((this.summary.days[day] ??= {})[d.path] = { ...stats, counters });
        this.summary.changed = true;
      }
      if (this.summary.changed) {
        delete this.summary.changed;
        const days = Object.keys(this.summary.days).sort();
        for (const old of days.slice(0, Math.max(0, days.length - 60))) delete this.summary.days[old];
        this.saveSummary();
        this.prune();
      }
    }

    prune() {
      const keep = dayOf(Date.now() - settings().keepDays * 86400000);
      const today = dayOf(Date.now());
      let files = [];
      try {
        files = fs.readdirSync(dirOf(this.plc.id));
      } catch {
        return;
      }
      for (const f of files) {
        const m = /^(\d{4}-\d\d-\d\d)\.jsonl(\.gz)?$/.exec(f);
        if (!m) continue;
        const full = path.join(dirOf(this.plc.id), f);
        try {
          if (m[1] < keep) fs.rmSync(full);
          else if (!m[2] && m[1] < today) {
            fs.writeFileSync(`${full}.gz`, zlib.gzipSync(fs.readFileSync(full)));
            fs.rmSync(full);
          }
        } catch (err) {
          log(`drives: ${f}: ${err.message}`);
        }
      }
    }

    /** Each drive judged (its siblings: the same profile on this PLC); a turn to warn or alarm, and back, said */
    judge(s) {
      const todayStats = new Map(this.drives.map((d) => [d.path, dayStats(d.today, d.profile)]));
      const days = Object.keys(this.summary.days).sort();
      const pastDays = days.slice(-14);
      const weekAgo = days.filter((x) => x <= dayOf(Date.now() - 7 * 86400000)).pop() ?? days[0];
      // (the machine powered down: its mains signal off, or, without one, most of its drives without mains (at
      // least 2, 60 % of those whose DC bus answers): one line, not a turn of each drive)
      const noMainsV = s.limits?.noMainsV ?? 50;
      const dcOf = (d) => (typeof d.latest.dcBus?.v === 'number' ? d.latest.dcBus.v : null);
      const withDc = this.drives.filter((d) => dcOf(d) !== null);
      const offNow = withDc.filter((d) => dcOf(d) < noMainsV).length;
      const signal = this.mains?.on ?? null;
      const down = signal === false || (signal === null && offNow >= 2 && offNow >= 0.6 * withDc.length);
      // (its first round: as it was, nothing said: a gateway restarted on a machine powered down)
      const wasDown = this.power ? !!this.power.down : down;
      const now0 = Date.now();
      this.power = { down, off: offNow, total: this.drives.length, signal: this.mains?.name ?? null, on: signal, signalError: this.mains?.error ?? null, since: down === wasDown ? this.power?.since ?? null : down ? now0 : null };
      const quietlyOff = [];
      for (const d of this.drives) {
        const past = {};
        // (its past since its serial was pinned: a drive replaced is not judged against the one before)
        const since = this.summary.serials?.[d.path]?.since;
        for (const day of pastDays) if (this.summary.days[day]?.[d.path] && (!since || day >= dayOf(since))) past[day] = this.summary.days[day][d.path];
        const peers = this.drives.filter((x) => x !== d && x.profile.id === d.profile.id).map((x) => ({ today: todayStats.get(x.path) }));
        const before = d.health;
        d.health = evaluate({ latest: d.latest, today: todayStats.get(d.path), past, counters7d: weekAgo ? this.summary.days[weekAgo]?.[d.path]?.counters ?? {} : {}, peers, profile: d.profile, limits: s.limits, mains: signal, mainsName: this.mains?.name ?? '', powerDown: down });
        d.todayStats = todayStats.get(d.path);
        const bad = (h) => h && (h.level === 'warn' || h.level === 'alarm');
        const now = Date.now();
        for (const f of d.health.findings.filter((x) => x.level === 'warn' || x.level === 'alarm')) {
          const key = `${f.key}|${f.level}`;
          if (now - (d.sent[key] ?? 0) < REPEAT_MS) continue;
          d.sent[key] = now;
          this.say(d, f.level === 'alarm' ? 'error' : 'drive', `🔧 ${d.name}: ${f.text}`, f.level, s);
        }
        if (bad(before) && !bad(d.health) && d.health.level !== 'unknown') {
          d.sent = {};
          if (down && d.health.level === 'off') quietlyOff.push(d.name);
          else this.say(d, 'recovered', d.health.level === 'off' ? `⏻ ${d.name}: no mains now (its DC bus off): not judged until it is powered` : `✅ ${d.name}: healthy again`, d.health.level, s);
        }
      }
      if (down && !wasDown) {
        const off = this.drives.filter((d) => d.health?.level === 'off').length;
        const why = signal === false ? `its mains signal ${this.mains.name} off` : `${offNow} of its ${withDc.length} drives without mains`;
        this.say({ name: 'Drives' }, 'recovered', `⏻ Machine powered down (${why}): ${off} drive${off === 1 ? '' : 's'} not judged until it is powered`, 'off', s, { resolves: quietlyOff });
      } else if (quietlyOff.length) this.say({ name: 'Drives' }, 'recovered', `⏻ Powered down too: ${quietlyOff.join(', ')}`, 'off', s, { resolves: quietlyOff });
      if (!down && wasDown) this.say({ name: 'Drives' }, 'drive', `⚡ Machine powered again: its ${this.drives.length} drives judged again`, 'ok', s, { quiet: true });
    }

    say(d, event, text, level, s, extra = {}) {
      const e = { event: event === 'error' ? 'drive' : event, level, rule: 'Drive health', ruleId: 'drives', plc: this.plc.id, plcName: this.plc.name, machine: d.name, state: level, text: `${this.plc.name}: ${text}`, at: new Date().toISOString(), ...extra };
      log(`drives: ${this.plc.id}: ${text}`);
      // (logged; its webhook unless it was muted: its alarm shelved)
      const kept = onEvent?.(e);
      if (s.webhook && !kept?.muted) void postWebhook?.(s.webhook, s.format, e, log);
    }

    /** Each drive's daily values while running (the risk list's trends: heatsink, i²t and ixt at their 90 %, current per Hz), today's last */
    daily() {
      const days = Object.keys(this.summary.days).sort().slice(-21);
      const of = (s) => ({ heatsink: s?.heatsink?.median ?? null, motorI2t: s?.motorI2t?.p90 ?? null, deviceIxt: s?.deviceIxt?.p90 ?? null, currentPerHz: s?.currentPerHz?.median ?? null });
      return Object.fromEntries(this.drives.map((d) => [d.path, [...days.map((day) => ({ day, ...of(this.summary.days[day]?.[d.path]) })), ...(d.todayStats ? [{ day: new Date().toISOString().slice(0, 10), ...of(d.todayStats) }] : [])].filter((x, i, all) => all.findIndex((y) => y.day === x.day) === i)]));
    }

    /** As the board shows it */
    view() {
      return {
        id: this.plc.id, name: this.plc.name, state: this.state, message: this.message, lastRound: this.lastRound, power: this.power ?? null,
        drives: this.drives.map((d) => ({
          path: d.path, name: d.name, box: d.box, device: d.device, netId: d.netId, address: d.address, serial: d.serial ?? null, profile: d.profile.id, vendor: d.vendor, product: d.product, firmware: d.firmware,
          latest: Object.fromEntries(Object.entries(d.latest).map(([k, x]) => [k, { v: x.v, ...(x.error ? { error: x.error } : {}) }])),
          health: d.health, today: d.todayStats ?? null,
          spark: Object.fromEntries(Object.entries(d.spark).map(([k, list]) => [k, list.map((b) => ({ t: b.t, v: Math.round((b.sum / b.n) * 10) / 10 }))])),
          notAnswering: d.failing >= 3,
          identity: d.identity ?? null,
          // (its settings, the last read, and their changes, newest last)
          settings: this.summary.settings?.[d.path] ?? null,
          settingsChanges: (this.summary.settingsChanges?.[d.path] ?? []).slice(-10),
        })),
      };
    }

    /** A drive's kept values between from and to (ms), at most 2000 points a key (each bucket's lowest and highest) */
    history(drivePath, keys, from, to) {
      const want = new Set(keys);
      const series = Object.fromEntries(keys.map((k) => [k, []]));
      for (let t = from - 86400000; dayOf(t) <= dayOf(to); t += 86400000) {
        const day = dayOf(t);
        const plain = path.join(dirOf(this.plc.id), `${day}.jsonl`);
        let text = '';
        try {
          text = fs.existsSync(plain) ? fs.readFileSync(plain, 'utf8') : zlib.gunzipSync(fs.readFileSync(`${plain}.gz`)).toString('utf8');
        } catch {
          continue;
        }
        for (const line of text.split('\n')) {
          if (!line || !line.includes(drivePath.slice(-20))) continue;
          let o;
          try {
            o = JSON.parse(line);
          } catch {
            continue;
          }
          if (o.d !== drivePath || !want.has(o.k) || o.t > to) continue;
          series[o.k].push({ t: o.t, v: o.v });
        }
      }
      for (const k of keys) {
        const all = series[k].sort((a, b) => a.t - b.t);
        // (the value at the window's start, then the window)
        const start = all.findLastIndex ? all.findLastIndex((x) => x.t < from) : -1;
        let list = all.slice(Math.max(0, start)).map((x) => (x.t < from ? { t: from, v: x.v } : x));
        if (list.length > 2000) {
          const bucket = (to - from) / 1000;
          const out = [];
          let cur = null;
          for (const x of list) {
            const b = Math.floor((x.t - from) / bucket);
            if (!cur || cur.b !== b) {
              if (cur) out.push(...(cur.lo.t <= cur.hi.t ? [cur.lo, cur.hi] : [cur.hi, cur.lo]));
              cur = { b, lo: x, hi: x };
            } else {
              if (x.v < cur.lo.v) cur.lo = x;
              if (x.v > cur.hi.v) cur.hi = x;
            }
          }
          if (cur) out.push(...(cur.lo.t <= cur.hi.t ? [cur.lo, cur.hi] : [cur.hi, cur.lo]));
          list = out;
        }
        series[k] = list;
      }
      const baseline = this.drives.find((d) => d.path === drivePath)?.health?.baseline ?? {};
      return { series, baseline };
    }
  }

  const apply = () => {
    const s = settings();
    const wanted = new Set(s.enabled ? plcList().filter((p) => !s.plcs || s.plcs.includes(p.id)).map((p) => p.id) : []);
    for (const [id, m] of monitors) {
      if (wanted.has(id) && JSON.stringify(m.plc) === JSON.stringify(plcList().find((p) => p.id === id))) continue;
      m.stop();
      monitors.delete(id);
    }
    for (const plc of plcList()) {
      if (!wanted.has(plc.id) || monitors.has(plc.id)) continue;
      const m = new DriveMonitor(plc);
      monitors.set(plc.id, m);
      void m.start();
    }
  };

  /** A value's bytes read every way (its own length) */
  const viewsOf = (buf) => {
    const v = {};
    if (buf.length === 1) Object.assign(v, { u8: buf.readUInt8(0), s8: buf.readInt8(0) });
    if (buf.length >= 2) Object.assign(v, { u16: buf.readUInt16LE(0), s16: buf.readInt16LE(0) });
    if (buf.length >= 4) Object.assign(v, { u32: buf.readUInt32LE(0), s32: buf.readInt32LE(0), f32: Math.round(buf.readFloatLE(0) * 1e6) / 1e6 });
    return v;
  };
  const numOf = (x, hex) => (typeof x === 'number' ? x : parseInt(String(x ?? '').trim().replace(/^0x/i, ''), hex || /^0x/i.test(String(x ?? '').trim()) ? 16 : 10));

  /**
   * The setup page's Check a drive (read only): a PLC's boxes of other makers than Beckhoff (and any a profile knows);
   * a box's profile read, each value raw and as the board reads it; or one object (index hex, sub, size)
   */
  const checkBoxes = new Map(); // PLC id -> { at, boxes }: its I/O read once a minute at most (a zip over ADS)
  async function check({ plc: plcId, path: boxPath, index, sub, size, address: atAddress, scan } = {}) {
    const plc = plcList().find((p) => p.id === plcId);
    if (!plc) throw new Error(`No PLC "${plcId ?? ''}"`);
    let conn = monitors.get(plcId)?.conn ?? null;
    const viewer = { send: () => {}, push: () => {}, lost: () => {} };
    let borrowed = false;
    if (!conn?.client) {
      conn = connectionFor(plc);
      await conn.connect();
      conn.viewers.add(viewer);
      clearTimeout(conn.idleTimer);
      borrowed = true;
    }
    try {
      const client = conn.client;
      const cached = checkBoxes.get(plcId);
      const boxes = cached && Date.now() - cached.at < 60000 && boxPath ? cached.boxes : [];
      const tree = boxes.length ? { devices: [] } : await readIoTree((rel) => readBootFile(client, rel)).catch((err) => ({ error: ads.adsErrorText(err) }));
      if (tree.error) throw new Error(`Its I/O not read: ${tree.error}`);
      const profiles = settings().profiles;
      const every = []; // (every box: its project address, its master; a scan's)
      for (const d of tree.devices ?? []) {
        if (d.disabled || !d.netId) continue;
        let slaves = null;
        try {
          slaves = (await readEcatStates(client, d.netId)).slaves ?? null;
        } catch {
          slaves = null;
        }
        const walk = (list) => {
          for (const b of list ?? []) {
            if (!b.disabled) every.push({ name: b.name, netId: d.netId, device: d.name, address: b.address ?? null, vendorId: b.info?.vendorId ?? null, productCode: b.info?.productCode ?? '' });
            const profile = b.disabled ? null : profileFor(b, profiles);
            if (!b.disabled && (profile || (b.info?.vendorId !== undefined && b.info.vendorId !== 2))) {
              const known = slaves?.some((s) => s.address === b.address);
              const followed = monitors.get(plcId)?.drives.find((x) => x.path === b.path && x.identity && x.identity !== 'not found');
              const onBus = typeof slaves?.[b.slave ?? -1]?.address === 'number' ? slaves[b.slave].address : null;
              boxes.push({ path: b.path, name: b.name, device: d.name, netId: d.netId, address: followed?.address ?? (known || !slaves ? b.address : onBus ?? b.address), projectAddress: b.address ?? null, onBus, listed: !!slaves?.some((x) => typeof x.address === 'number'), vendorId: b.info?.vendorId ?? null, productCode: b.info?.productCode ?? '', type: b.info?.type ?? '', profile });
            }
            walk(b.boxes);
          }
        };
        walk(d.boxes);
      }
      if (!cached || boxes !== cached.boxes) checkBoxes.set(plcId, { at: Date.now(), boxes });
      const view = (b) => ({ path: b.path, name: b.name, device: b.device, netId: b.netId, address: b.address, projectAddress: b.projectAddress, onBus: b.onBus, listed: b.listed, vendorId: b.vendorId, type: b.type, profile: b.profile ? { id: b.profile.id, name: b.profile.name } : null });
      // (a scan of the bus: each address answering, its identity; the project's box with that address)
      if (scan) {
        const masters = [...new Set(every.map((x) => x.netId))];
        const rows = [];
        for (const netId of masters) {
          const mine = every.filter((x) => x.netId === netId);
          const top = Math.min(1600, Math.max(1000, ...mine.map((x) => x.address ?? 1000)) + 32);
          for (let at = 1001; at <= top; at++) {
            let id = null;
            try {
              const v = await client.readRaw(COE_SDO, (0x1018 << 16) | 1, 4, { amsNetId: netId, adsPort: at });
              const p = await client.readRaw(COE_SDO, (0x1018 << 16) | 2, 4, { amsNetId: netId, adsPort: at });
              id = { vendorId: v.readUInt32LE(0), productCode: p.readUInt32LE(0) };
            } catch (err) {
              // (no slave there: Port not connected; a slave without CoE: said so)
              const t = ads.adsErrorText(err);
              if (/not connected|0xd\b|\[0xd\]|target port/i.test(t)) continue;
              rows.push({ device: mine[0]?.device ?? netId, address: at, error: t, box: mine.find((x) => x.address === at)?.name ?? null });
              continue;
            }
            const box = mine.find((x) => x.address === at);
            const expected = box && box.vendorId !== null ? `#x${box.vendorId.toString(16)}${box.productCode ? ` ${box.productCode}` : ''}` : null;
            const same = !!box && box.vendorId === id.vendorId && (!box.productCode || parseInt(String(box.productCode).replace(/^#x/i, ''), 16) === id.productCode);
            rows.push({ device: mine[0]?.device ?? netId, address: at, vendorId: id.vendorId, productCode: id.productCode, box: box?.name ?? null, expected, same });
          }
        }
        log(`drives: ${plcId}: the bus scanned: ${rows.length} address(es) answering`);
        return { scan: rows };
      }
      if (!boxPath) return { boxes: boxes.map(view) };
      const b = boxes.find((x) => x.path === boxPath);
      if (!b) throw new Error(`No box "${boxPath}" of another maker in its I/O`);
      let wanted;
      if (index !== undefined && index !== null && String(index).trim() !== '') {
        const i = numOf(index, true);
        const s = numOf(sub ?? 0, false);
        const n = [1, 2, 4, 8].includes(Number(size)) ? Number(size) : 4;
        if (!Number.isInteger(i) || i < 0 || i > 0xffff || !Number.isInteger(s) || s < 0 || s > 255) throw new Error('An object is an index (hex, e.g. 6ff1) and a subindex (0 to 255)');
        wanted = [{ key: 'asked', label: 'As asked', index: i, sub: s, size: n, signed: false, scale: 1, unit: '', asked: true }];
      } else {
        if (!b.profile) throw new Error(`${b.name}: no profile knows it: read one object of it`);
        // (its identity first: the vendor and product code its project expects, to see it is the right device)
        wanted = [
          { key: 'vendorId', label: `Identity: vendor (expected #x${(b.vendorId ?? 0).toString(16)})`, index: 0x1018, sub: 1, size: 4, signed: false, scale: 1, unit: '', format: 'hex' },
          { key: 'productCode', label: `Identity: product code (expected ${b.productCode || '?'})`, index: 0x1018, sub: 2, size: 4, signed: false, scale: 1, unit: '', format: 'hex' },
          { key: 'serial', label: 'Identity: serial number (the board pins the drive to it)', index: 0x1018, sub: 4, size: 4, signed: false, scale: 1, unit: '' },
          ...b.profile.params,
        ];
      }
      const at = Number(atAddress) >= 1 && Number(atAddress) <= 65535 ? Number(atAddress) : b.address;
      const reads = [];
      for (const p of wanted) {
        const base = { key: p.key, label: p.label, index: p.index, sub: p.sub, size: p.size, unit: p.unit, scale: p.scale, verified: p.asked ? null : p.verified !== false };
        try {
          const buf = await client.readRaw(COE_SDO, ((p.index & 0xffff) << 16) | (p.sub & 0xff), p.size ?? 4, { amsNetId: b.netId, adsPort: at });
          const dec = p.asked ? null : decodeValue(buf, p);
          reads.push({ ...base, hex: [...buf].map((x) => x.toString(16).padStart(2, '0')).join(' '), as: viewsOf(buf), value: dec?.value ?? null });
        } catch (err) {
          reads.push({ ...base, error: ads.adsErrorText(err) });
        }
      }
      log(`drives: ${plcId}: checked ${b.name} (${reads.length} object(s), ${reads.filter((r) => r.error).length} not answered)`);
      return { box: { ...view(b), address: at }, reads };
    } finally {
      if (borrowed) {
        conn.viewers.delete(viewer);
        if (conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
      }
    }
  }

  /** A PLC's client for a moment (its monitor's, else one borrowed and given back), for fn(client) */
  async function withClient(plcId, fn) {
    const plc = plcList().find((p) => p.id === plcId);
    if (!plc) throw new Error(`No PLC "${plcId ?? ''}"`);
    let conn = monitors.get(plcId)?.conn ?? null;
    const viewer = { send: () => {}, push: () => {}, lost: () => {} };
    let borrowed = false;
    if (!conn?.client) {
      conn = connectionFor(plc);
      await conn.connect();
      conn.viewers.add(viewer);
      clearTimeout(conn.idleTimer);
      borrowed = true;
    }
    try {
      return await fn(conn.client);
    } finally {
      if (borrowed) {
        conn.viewers.delete(viewer);
        if (conn.viewers.size === 0) void conn.unwatch({}).catch(() => {});
      }
    }
  }

  return {
    apply,
    check,
    /** A PLC's EL34xx boxes and the variables linked to them (energy meters to choose from) */
    findMeters: (plcId) => withClient(plcId, (client) => findMeters({ client, readIoTree, readBootFile })),
    start: () => apply(),
    stop() {
      for (const m of monitors.values()) m.stop();
      monitors.clear();
    },
    /** The board's view of these PLCs (all when none) */
    view: (ids) => [...monitors.values()].filter((m) => !ids?.length || ids.includes(m.plc.id)).map((m) => m.view()),
    /** Each PLC's drives' daily heatsink medians (the risk list) */
    daily: () => Object.fromEntries([...monitors.entries()].map(([id, m]) => [id, m.daily()])),
    /** The drives' parameters, by profile, for the board's labels */
    params: () => Object.fromEntries(settings().profiles.map((p) => [p.id, { name: p.name, params: p.params.map(({ key, label, unit, verified, format, counter, slow, trend }) => ({ key, label, unit, verified, format, counter, slow, trend })), settings: (p.settings ?? []).map(({ key, label, unit, verified }) => ({ key, label, unit, verified })) }])),
    history(plcId, drivePath, keys, from, to) {
      const m = monitors.get(plcId);
      if (!m) return { error: 'This gateway does not follow that PLC\'s drives' };
      return m.history(drivePath, keys, from, to);
    },
    pollNow(plcId) {
      const m = monitors.get(plcId);
      if (m) void m.round();
      return !!m;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    stats: () => [...monitors.values()].map((m) => ({ plc: m.plc.id, drives: m.drives.length, everyMs: settings().everyMs })),
  };
}

module.exports = { createDrives, locateDrives, reconcileSerials };

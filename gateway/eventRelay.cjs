// The TwinCAT EventLogger live (plc/FB_KvalEventRelay.st, in the PLC: its ring of the last 64 events): each PLC
// with one set (config.eventlog.live: { "<plc id>": "MAIN.fbEventRelay" }) read every 2 seconds: its nSeq, and when
// it moved its aEvents (64 × ST_KvalEvent, packed: 355 bytes). Each new event, with its text (asked for by the PLC: a
// few cycles; at most 5 s waited), kept in the event log (eventlog.cjs: the fault records show them); an alarm of
// severity error or critical raised: an alert ("plcEvent"), cleared: its recovery.
const EVENT_SIZE = 355;
const SLOTS = 64;
const KINDS = { 1: 'message', 2: 'raised', 3: 'cleared', 4: 'confirmed' };
const SEVERITIES = ['Verbose', 'Info', 'Warning', 'Error', 'Critical'];
// (FILETIME: 100 ns since 1601-01-01; its ms since 1970)
const EPOCH_DIFF_MS = 11644473600000;

/** A STRING of n bytes: up to its first 0 (UTF-8) */
const stringAt = (buf, at, n) => {
  const end = buf.indexOf(0, at);
  return buf.toString('utf8', at, end < 0 || end > at + n ? at + n : end);
};

/** The ring's events (its raw bytes), those used, oldest first */
function decodeEvents(buf) {
  const out = [];
  for (let i = 0; i < SLOTS && (i + 1) * EVENT_SIZE <= buf.length; i++) {
    const o = i * EVENT_SIZE;
    const seq = buf.readUInt32LE(o);
    if (!seq) continue;
    const ts = buf.readBigUInt64LE(o + 4);
    out.push({
      seq,
      t: Number(ts / 10000n) - EPOCH_DIFF_MS,
      kind: KINDS[buf.readUInt8(o + 12)] ?? 'message',
      severity: SEVERITIES[buf.readUInt8(o + 13)] ?? String(buf.readUInt8(o + 13)),
      eventId: buf.readUInt32LE(o + 14),
      source: stringAt(buf, o + 18, 81),
      text: stringAt(buf, o + 99, 256),
    });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function createEventRelay({ getConfig, plcList, connectionFor, ads, eventLog, onEvent, log, everyMs = 2000 }) {
  const relays = new Map(); // plc id -> { path, conn, viewer, handles, lastSeq, pending: Map(seq -> { e, since }), error }
  const wanted = () => {
    const live = getConfig().eventlog?.live;
    return live && typeof live === 'object' ? Object.entries(live).filter(([, p]) => typeof p === 'string' && ads.isSymbolPath(p)) : [];
  };
  const drop = (id) => {
    const r = relays.get(id);
    if (!r) return;
    r.conn?.viewers.delete(r.viewer);
    relays.delete(id);
  };
  const handleOf = async (r, name) => {
    if (!r.handles.has(name)) r.handles.set(name, await ads.createHandle(r.conn.client, name));
    return r.handles.get(name);
  };
  const keep = (plc, r, list) => {
    if (!list.length) return;
    eventLog.addLive(plc.id, list.map((e) => ({ t: e.t, severity: e.severity, source: e.source, text: e.text || `(event ${e.eventId})`, eventClass: '', eventId: String(e.eventId), state: e.kind })));
    for (const e of list) {
      if (e.kind !== 'raised' && e.kind !== 'cleared') continue;
      if (e.kind === 'raised' && !['Error', 'Critical'].includes(e.severity)) continue;
      const machine = e.source || r.path;
      onEvent?.(e.kind === 'raised'
        ? { event: 'plcEvent', level: e.severity === 'Critical' ? 'alarm' : 'warn', rule: 'TwinCAT events', ruleId: 'eventlog', plc: plc.id, plcName: plc.name, machine, state: e.text || `event ${e.eventId}`, text: `${plc.name}: 🔔 ${machine}: ${e.text || `event ${e.eventId}`} (${e.severity})`, at: new Date(e.t).toISOString() }
        : { event: 'recovered', rule: 'TwinCAT events', ruleId: 'eventlog', plc: plc.id, plcName: plc.name, machine, state: 'cleared', text: `${plc.name}: ✅ ${machine}: ${e.text || `event ${e.eventId}`} cleared`, at: new Date(e.t).toISOString() });
    }
  };
  async function poll(plc, path) {
    let r = relays.get(plc.id);
    if (!r || r.path !== path) {
      drop(plc.id);
      r = { path, conn: connectionFor(plc), viewer: { send: () => {}, push: () => {}, lost: () => {} }, handles: new Map(), lastSeq: null, pending: new Map(), error: null };
      r.conn.viewers.add(r.viewer);
      relays.set(plc.id, r);
    }
    try {
      if (!r.conn.client) await r.conn.connect();
      clearTimeout(r.conn.idleTimer);
      const seqBuf = await r.conn.client.readRaw(0xf005, await handleOf(r, `${path}.nSeq`), 4);
      const seq = seqBuf.readUInt32LE(0);
      const moved = seq !== r.lastSeq;
      if (moved || r.pending.size) {
        const buf = await r.conn.client.readRaw(0xf005, await handleOf(r, `${path}.aEvents`), SLOTS * EVENT_SIZE);
        if (buf.length < SLOTS * EVENT_SIZE) throw new Error(`${path}.aEvents: ${buf.length} bytes, not ${SLOTS * EVENT_SIZE}: not FB_KvalEventRelay as the gateway reads it`);
        const events = decodeEvents(buf);
        // (its first read: those already in its ring kept too; the PLC restarted: its numbers from 1 again)
        const after = r.lastSeq === null || seq < r.lastSeq ? 0 : r.lastSeq;
        for (const e of events) if (e.seq > after && !r.pending.has(e.seq)) r.pending.set(e.seq, { e, since: Date.now() });
        const ready = [];
        for (const [s, p] of r.pending) {
          const now = events.find((x) => x.seq === s) ?? p.e;
          if (now.text || Date.now() - p.since > 5000) {
            ready.push(now);
            r.pending.delete(s);
          } else p.e = now;
        }
        keep(plc, r, ready.sort((a, b) => a.seq - b.seq));
        r.lastSeq = seq;
      }
      if (r.error) log(`eventrelay: ${plc.id}: reading ${path} again`);
      r.error = null;
    } catch (err) {
      const text = ads.adsErrorText(err);
      if (r.error !== text) log(`eventrelay: ${plc.id}: ${path}: ${text}`);
      r.error = text;
      // (its handles again next time: the PLC's program may have been downloaded anew)
      for (const h of r.handles.values()) void ads.releaseHandle(r.conn.client, h).catch(() => {});
      r.handles.clear();
    }
  }
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const w = wanted();
      for (const id of [...relays.keys()]) if (!w.some(([x]) => x === id)) drop(id);
      for (const [id, path] of w) {
        const plc = plcList().find((p) => p.id === id);
        if (plc) await poll(plc, path);
      }
    } finally {
      busy = false;
    }
  }, everyMs);
  timer.unref?.();
  return {
    /** Each PLC's relay: its path, its last number, why not read */
    status: () => Object.fromEntries([...relays].map(([id, r]) => [id, { path: r.path, seq: r.lastSeq, error: r.error }])),
    stop() {
      clearInterval(timer);
      for (const id of [...relays.keys()]) drop(id);
    },
  };
}

module.exports = { createEventRelay, decodeEvents, EVENT_SIZE, SLOTS };

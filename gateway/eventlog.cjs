// TwinCAT logged events (the EventLogger's alarms and messages) beside the gateway's fault records: imported from the
// CSV the TwinCAT Logged Events window exports (XAE: View > Other Windows > TwinCAT Logged Events, Export), per PLC,
// on the setup page. Each fault record then shows the events of its window (on its timeline and listed). Its columns
// are found by their names (time, severity, source, text or message, event class, id, state; or in German), its separator (; , or
// a tab) and its date format (ISO, d.m.y, m/d/y) by what it has. Kept in eventlog/<plc>.jsonl beside config.json (the
// last 50 000 a PLC), the same event (time, source, text) once.
const fs = require('fs');
const path = require('path');

const MAX = 50000;

/** A CSV line's fields (quotes: "a;b", "say ""x""") */
function fieldsOf(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** A time as the export writes it (ISO; d.m.y h:m:s(.f); m/d/y h:m:s (AM|PM)); dayFirst: what the file's dates say */
function timeOf(text, dayFirst) {
  const s = String(text ?? '').trim();
  if (!s) return NaN;
  const m = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})[ T,]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,7}))?)?\s*(AM|PM)?$/i.exec(s);
  if (m) {
    let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    let y;
    let mo;
    let d;
    if (m[1].length === 4) [y, mo, d] = [a, b, c];
    else if (/^\d{1,2}\.\d/.test(s) || dayFirst || a > 12) [d, mo, y] = [a, b, c];
    else [mo, d, y] = [a, b, c];
    if (y < 100) y += 2000;
    let h = Number(m[4]);
    if (m[8]) h = (h % 12) + (/pm/i.test(m[8]) ? 12 : 0);
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
    return new Date(y, mo - 1, d, h, Number(m[5]), Number(m[6] ?? 0), ms).getTime();
  }
  return Date.parse(s);
}

/** The events of an export: [{ t, severity, source, text, eventClass, eventId, state }] and what was not understood */
function parseLoggedEvents(csv) {
  const lines = String(csv ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('No events: a CSV of the TwinCAT Logged Events window (its header, then the events)');
  const head = lines[0];
  const sep = [';', '\t', ','].sort((x, y) => head.split(y).length - head.split(x).length)[0];
  const names = fieldsOf(head, sep).map((n) => n.toLowerCase());
  const col = (rx) => names.findIndex((n) => rx.test(n));
  const c = {
    t: col(/time ?raised|^time|timestamp|date|zeit|datum/),
    severity: col(/severity|schweregrad/),
    source: col(/source|quelle/),
    text: col(/^text|message|meldung|nachricht|description/),
    eventClass: col(/class/),
    eventId: col(/event ?id|^id$/),
    state: col(/state/),
  };
  if (c.t < 0 || c.text < 0) throw new Error(`Its columns not found: a time and a text (or message) column (it has: ${names.join(', ')})`);
  const rows = lines.slice(1).map((l) => fieldsOf(l, sep));
  // (day first: a date whose first number is above 12 anywhere, or dots)
  const dayFirst = rows.some((r) => /^(1[3-9]|2\d|3[01])[./-]\d{1,2}[./-]\d/.test(r[c.t] ?? ''));
  const events = [];
  let skipped = 0;
  for (const r of rows) {
    const t = timeOf(r[c.t], dayFirst);
    const text = (r[c.text] ?? '').slice(0, 500);
    if (!Number.isFinite(t) || !text) {
      skipped++;
      continue;
    }
    const get = (k) => (c[k] >= 0 ? String(r[c[k]] ?? '').slice(0, 200) : '');
    events.push({ t, severity: get('severity'), source: get('source'), text, eventClass: get('eventClass'), eventId: get('eventId'), state: get('state') });
  }
  return { events, skipped };
}

function createEventLog({ baseDir, log, audit }) {
  const dir = path.join(baseDir, 'eventlog');
  const cache = new Map(); // PLC id -> events (sorted by time)
  const fileOf = (plc) => path.join(dir, `${String(plc).replace(/[^\w.-]/g, '_')}.jsonl`);
  const load = (plc) => {
    if (cache.has(plc)) return cache.get(plc);
    let list = [];
    try {
      list = fs.readFileSync(fileOf(plc), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      list = [];
    }
    list.sort((a, b) => a.t - b.t);
    cache.set(plc, list);
    return list;
  };
  const keyOf = (e) => `${e.t}|${e.source}|${e.text}`;
  return {
    /** An export imported for a PLC: its new events kept */
    import(plc, csv, user) {
      const { events, skipped } = parseLoggedEvents(csv);
      const list = load(plc);
      const have = new Set(list.map(keyOf));
      const fresh = events.filter((e) => !have.has(keyOf(e)));
      const all = [...list, ...fresh].sort((a, b) => a.t - b.t).slice(-MAX);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileOf(plc), all.map((e) => JSON.stringify(e)).join('\n') + (all.length ? '\n' : ''));
      cache.set(plc, all);
      const range = events.length ? { from: Math.min(...events.map((e) => e.t)), to: Math.max(...events.map((e) => e.t)) } : null;
      audit?.add(user, 'eventlog.import', { plc, events: events.length, added: fresh.length, skipped });
      log(`eventlog: ${user} imported ${events.length} logged event(s) of ${plc} (${fresh.length} new, ${skipped} not understood)`);
      return { read: events.length, added: fresh.length, skipped, kept: all.length, range };
    },
    /** Events read live (eventRelay.cjs: the PLC's FB_KvalEventRelay): its new ones kept */
    addLive(plc, events) {
      const list = load(plc);
      const have = new Set(list.slice(-2000).map(keyOf));
      const fresh = events.filter((e) => !have.has(keyOf(e)));
      if (!fresh.length) return 0;
      const all = [...list, ...fresh].sort((a, b) => a.t - b.t).slice(-MAX);
      fs.mkdirSync(dir, { recursive: true });
      if (all.length === list.length + fresh.length) fs.appendFileSync(fileOf(plc), fresh.map((e) => JSON.stringify(e)).join('\n') + '\n');
      else fs.writeFileSync(fileOf(plc), all.map((e) => JSON.stringify(e)).join('\n') + '\n');
      cache.set(plc, all);
      return fresh.length;
    },
    /** A PLC's events between from and to (a fault record's window) */
    between: (plc, from, to, limit = 300) => load(plc).filter((e) => e.t >= from && e.t <= to).slice(0, limit),
    /** Each PLC's events kept: how many, from when to when */
    stats(plcIds) {
      return Object.fromEntries(plcIds.map((id) => {
        const l = load(id);
        return [id, { count: l.length, from: l[0]?.t ?? null, to: l.at(-1)?.t ?? null }];
      }));
    },
  };
}

module.exports = { createEventLog, parseLoggedEvents, timeOf };

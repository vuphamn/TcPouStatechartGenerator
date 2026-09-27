// Audit log: who did what on the gateway, one JSON line per event in audit.jsonl next to config.json (a new file
// each month: audit-YYYY-MM.jsonl): sign-ins, going live, acknowledging, maintenance, replays, reports, setup page
// changes. The setup page searches it and exports it as CSV. Kept for 24 months.
const fs = require('fs');
const path = require('path');

const MONTHS_KEPT = 24;

function createAudit({ dir, log }) {
  const month = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const file = (m) => path.join(dir, `audit-${m}.jsonl`);
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const lines = buffer.splice(0);
    const byMonth = new Map();
    for (const l of lines) {
      const m = month(l.t);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(JSON.stringify(l));
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const [m, ls] of byMonth) fs.appendFileSync(file(m), ls.join('\n') + '\n');
    } catch (err) {
      log(`audit: could not write: ${err.message}`);
    }
  };
  const timer = setInterval(flush, 1000);
  timer.unref();
  const prune = () => {
    try {
      const keep = new Date();
      keep.setMonth(keep.getMonth() - MONTHS_KEPT);
      const cutoff = month(keep.getTime());
      for (const f of fs.readdirSync(dir)) {
        const m = /^audit-(\d{4}-\d\d)\.jsonl$/.exec(f);
        if (m && m[1] < cutoff) fs.rmSync(path.join(dir, f));
      }
    } catch {
      // no folder yet
    }
  };
  prune();

  return {
    /** An event: who (user or "setup page"), what, and details */
    add(user, action, details = {}) {
      buffer.push({ t: Date.now(), user: user || '(unknown)', action, ...details });
    },
    /** Events between from and to (ms), newest first, matching the text (user, action or any detail) */
    search({ from = 0, to = Date.now(), q = '', limit = 1000 } = {}) {
      flush();
      const needle = String(q).toLowerCase().trim();
      const out = [];
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => /^audit-\d{4}-\d\d\.jsonl$/.test(f)).sort().reverse();
      } catch {
        return [];
      }
      for (const f of files) {
        const m = f.slice(6, 13);
        if (m < month(from) || m > month(to)) continue;
        const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
        for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
          if (!lines[i]) continue;
          let e;
          try {
            e = JSON.parse(lines[i]);
          } catch {
            continue;
          }
          if (e.t < from || e.t > to) continue;
          if (needle && !JSON.stringify(e).toLowerCase().includes(needle)) continue;
          out.push(e);
        }
        if (out.length >= limit) break;
      }
      return out;
    },
    stop() {
      clearInterval(timer);
      flush();
    },
  };
}

module.exports = { createAudit };

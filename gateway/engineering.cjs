// The Engineering page's answers, from the gateway's recordings (recorder.cjs) and the PLC projects it keeps
// (projectSync.cjs):
// - timing: each state's time today against its normal (the median of its daily medians, the last 14 days), the
//   ones taking much longer or shorter flagged;
// - transitions: each one's count in the last hours against the 14 days before: new ones (never before), rare ones;
// - compare: two windows of one machine, or two machines: each state's share of the time, its count, its average;
// - what changed: the PLC project's versions kept, the files changed between two, a file's two texts.
const fs = require('fs');
const path = require('path');

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function createEngineering({ recorders, projectsDir, sources }) {
  const machineOf = (id, machine) => recorders.list().find((r) => r.id === id)?.machines.find((m) => m.path.toLowerCase() === String(machine).toLowerCase()) ?? null;
  const nameOf = (m, v) => m?.stateNames?.[String(v)] ?? `#${v}`;

  /** Each state today against its normal (14 days): today's median, the normal, the change */
  function timing(id, machine, days = 14) {
    const s = recorders.stats(id, machine, days + 1);
    if (s.error) return s;
    const today = dayOf(Date.now());
    const now = s.days.find((d) => d.day === today);
    const past = s.days.filter((d) => d.day < today);
    const values = new Set([...past.flatMap((d) => Object.keys(d.states)), ...Object.keys(now?.states ?? {})]);
    const rows = [...values].map((v) => {
      const normal = median(past.map((d) => d.states[v]?.medianMs).filter((x) => typeof x === 'number'));
      const t = now?.states[v];
      const change = normal && t ? t.medianMs / normal - 1 : null;
      return { value: Number(v), state: s.stateNames?.[v] ?? `#${v}`, todayMs: t?.medianMs ?? null, todayCount: t?.n ?? 0, normalMs: normal, days: past.filter((d) => d.states[v]).length, change, flag: change !== null && (t?.n ?? 0) >= 3 && Math.abs(change) >= 0.3 };
    });
    return { machine: s.machine, machineType: s.machineType, rows: rows.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)) };
  }

  /** The transitions (from → to) between from and to: their counts */
  const transitionsIn = (id, machine, from, to) => {
    const q = recorders.query(id, machine, from, to);
    const vals = (q.values ?? []).filter((x, i, all) => i === 0 || x.value !== all[i - 1].value);
    const out = new Map();
    for (let i = 1; i < vals.length; i++) {
      if (vals[i].t <= from) continue;
      const k = `${vals[i - 1].value}>${vals[i].value}`;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  };
  /** The last hours' transitions against the 14 days before: new (never before), rare (under 1 % of them) */
  function transitions(id, machine, hours = 24, days = 14) {
    const m = machineOf(id, machine);
    const now = Date.now();
    const recent = transitionsIn(id, machine, now - hours * 3600_000, now);
    const before = transitionsIn(id, machine, now - hours * 3600_000 - days * 86400000, now - hours * 3600_000);
    const total = [...before.values()].reduce((a, x) => a + x, 0);
    const keys = new Set([...recent.keys(), ...before.keys()]);
    const rows = [...keys].map((k) => {
      const [a, b] = k.split('>').map(Number);
      const n = recent.get(k) ?? 0;
      const was = before.get(k) ?? 0;
      return { from: nameOf(m, a), to: nameOf(m, b), recent: n, before: was, isNew: n > 0 && was === 0 && total > 0, rare: n > 0 && was > 0 && total > 0 && was / total < 0.01 };
    });
    return { machine: m?.path ?? machine, hours, days, rows: rows.sort((x, y) => Number(y.isNew) - Number(x.isNew) || Number(y.rare) - Number(x.rare) || y.recent - x.recent) };
  }

  /** One machine's window: each state's time, share, count, average */
  function windowOf({ id, machine, from, to }) {
    const m = machineOf(id, machine);
    const end = Math.min(to, Date.now());
    const q = recorders.query(id, machine, from, end);
    const vals = (q.values ?? []).filter((x, i, all) => i === 0 || x.value !== all[i - 1].value);
    const per = new Map();
    let known = 0;
    for (let i = 0; i < vals.length; i++) {
      const a = Math.max(vals[i].t, from);
      const b = Math.min(vals[i + 1]?.t ?? end, end);
      if (b <= a) continue;
      const s = per.get(vals[i].value) ?? { ms: 0, count: 0 };
      s.ms += b - a;
      if (vals[i].t >= from) s.count++;
      per.set(vals[i].value, s);
      known += b - a;
    }
    const states = [...per.entries()].map(([v, s]) => ({ value: v, state: nameOf(m, v), ms: s.ms, share: known ? s.ms / known : 0, count: s.count, avgMs: s.count ? s.ms / s.count : null }));
    return { machine: m?.path ?? machine, type: m?.type ?? '', from, to: end, knownMs: known, states: states.sort((a, b) => b.ms - a.ms), transitions: [...transitionsIn(id, machine, from, end)].map(([k, n]) => ({ from: nameOf(m, Number(k.split('>')[0])), to: nameOf(m, Number(k.split('>')[1])), count: n })).sort((a, b) => b.count - a.count).slice(0, 30) };
  }
  const compare = (a, b) => ({ a: windowOf(a), b: windowOf(b) });

  // What changed: the PLC project's versions (projectSync's: its current archive, the ones before in history/)
  const dirOf = (plcId) => path.join(projectsDir(), String(plcId).replace(/[^\w.-]/g, '_'));
  function versions(plcId) {
    const dir = dirOf(plcId);
    const out = [];
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'sync.json'), 'utf8'));
      if (fs.existsSync(path.join(dir, 'project.tpzip'))) out.push({ id: 'current', at: s.downloadedAt ?? null, project: s.project ?? '', files: s.files ?? null, current: true });
    } catch {
      // (none kept yet)
    }
    let hist = [];
    try {
      hist = fs.readdirSync(path.join(dir, 'history')).sort().reverse();
    } catch {
      hist = [];
    }
    for (const h of hist) {
      let s = {};
      try {
        s = JSON.parse(fs.readFileSync(path.join(dir, 'history', h, 'sync.json'), 'utf8'));
      } catch {
        s = {};
      }
      if (fs.existsSync(path.join(dir, 'history', h, 'project.tpzip'))) out.push({ id: h, at: s.downloadedAt ?? null, project: s.project ?? '', files: s.files ?? null, current: false });
    }
    return out;
  }
  const filesOf = (plcId, v) => {
    const file = v === 'current' ? path.join(dirOf(plcId), 'project.tpzip') : path.join(dirOf(plcId), 'history', String(v).replace(/[^\w.-]/g, ''), 'project.tpzip');
    const zip = fs.readFileSync(file);
    return new Map(sources.unzip(zip, (p) => /\.(TcPOU|TcDUT|TcGVL|TcIO|TcTTO|plcproj|TcTLO)$/i.test(p)).map((f) => [f.path, f.data.toString('utf8')]));
  };
  /** The files changed between two versions (a, b: ids of versions()); with a path: its two texts */
  function diff(plcId, a, b, file) {
    let A;
    let B;
    try {
      A = filesOf(plcId, a);
      B = filesOf(plcId, b);
    } catch (err) {
      return { error: `That version is not kept (${err.message})` };
    }
    if (file) return { path: file, before: A.get(file) ?? null, after: B.get(file) ?? null };
    const out = [];
    for (const [p, t] of B) {
      if (!A.has(p)) out.push({ path: p, change: 'added' });
      else if (A.get(p) !== t) out.push({ path: p, change: 'changed' });
    }
    for (const p of A.keys()) if (!B.has(p)) out.push({ path: p, change: 'removed' });
    return { files: out.sort((x, y) => x.path.localeCompare(y.path)) };
  }

  return { timing, transitions, compare, versions, diff };
}

module.exports = { createEngineering };

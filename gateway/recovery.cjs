// Guided recovery: for a machine stopped in an error state, the steps to bring it back, one at a time, for the
// operator at the machine. A guide is for a state (DOOR_DASHER_ERROR), of a type of machine (SM_DoorDasher) or of one
// machine; the most particular one is offered. A step can check the PLC itself: a variable at a value (the door
// closed: MAIN.bDoorClosed = TRUE), read live while the guide is open. Each use is kept (who, each step's time,
// recovered or not), to show how often a guide is used and how it ends. Written on the board by those who may edit it
// (boardEdit). Kept beside config.json: recovery-guides.json, recovery-runs.json (the last 2000).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUTCOMES = ['recovered', 'called', 'stopped'];
const SYMBOL = /^[A-Za-z_][\w]*(\[[\d, ]+\])?(\.[A-Za-z_][\w]*(\[[\d, ]+\])?)*$/;

/** A guide from the board, checked (throws with a message for the board) */
function checkGuide(g) {
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const title = text(g?.title, 120);
  const state = text(g?.state, 80);
  if (!state) throw new Error('A guide is for a state: its name, e.g. DOOR_DASHER_ERROR');
  const steps = (Array.isArray(g?.steps) ? g.steps : []).map((s, i) => {
    const t = text(s?.text, 300);
    if (!t) return null;
    const v = text(s?.check?.var, 200);
    if (v && !SYMBOL.test(v)) throw new Error(`Step ${i + 1}: its check is a PLC variable such as MAIN.bDoorClosed`);
    return { text: t, ...(v ? { check: { var: v, equals: text(s.check.equals, 40) || 'TRUE' } } : {}) };
  }).filter(Boolean);
  if (!steps.length) throw new Error('A guide has a step at least');
  if (steps.length > 30) throw new Error('At most 30 steps');
  return { id: /^[a-f0-9]{6,16}$/.test(String(g?.id ?? '')) ? String(g.id) : crypto.randomBytes(6).toString('hex'), title: title || state, plc: text(g?.plc, 60), type: text(g?.type, 80), machine: text(g?.machine, 300), state, steps };
}

/** A value read as the check compares it: TRUE/FALSE, numbers as numbers, else its text (case not minded) */
function checkPasses(value, equals) {
  if (value === null || value === undefined) return false;
  const want = String(equals).trim();
  if (typeof value === 'boolean') return want.toUpperCase() === (value ? 'TRUE' : 'FALSE') || want === (value ? '1' : '0');
  if (typeof value === 'number') {
    const m = /^(<=|>=|<|>|=)?\s*(-?\d+(\.\d+)?)$/.exec(want);
    if (!m) return false;
    const n = Number(m[2]);
    return { '<': value < n, '>': value > n, '<=': value <= n, '>=': value >= n, '=': value === n }[m[1] ?? '='];
  }
  return String(value).trim().toUpperCase() === want.toUpperCase();
}

function createRecovery({ baseDir, log, audit, readVars }) {
  const guidesFile = path.join(baseDir, 'recovery-guides.json');
  const runsFile = path.join(baseDir, 'recovery-runs.json');
  const read = (f) => {
    try {
      const x = JSON.parse(fs.readFileSync(f, 'utf8'));
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  };
  let guides = read(guidesFile);
  let runs = read(runsFile);
  const listeners = new Set();
  const write = (f, x) => {
    try {
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(x, null, f === guidesFile ? 2 : 0));
      fs.renameSync(`${f}.tmp`, f);
    } catch (err) {
      log(`recovery: ${err.message}`);
    }
  };
  const publish = () => {
    for (const fn of listeners) fn();
  };
  const lower = (x) => String(x ?? '').toLowerCase();
  const short = (t) => String(t ?? '').split('.').pop().toLowerCase();

  /** Each guide with how it was used (the last 90 days) */
  const withUse = () => {
    const since = Date.now() - 90 * 86400000;
    return guides.map((g) => {
      const mine = runs.filter((r) => r.guide === g.id && r.startedAt > since);
      const ended = mine.filter((r) => r.endedAt);
      return { ...g, used: mine.length, recovered: mine.filter((r) => r.outcome === 'recovered').length, meanMs: ended.length ? Math.round(ended.reduce((a, r) => a + (r.endedAt - r.startedAt), 0) / ended.length) : null };
    });
  };
  const runOf = (id) => {
    const r = runs.find((x) => x.id === id);
    if (!r) throw new Error('No such recovery');
    return r;
  };

  return {
    list: withUse,
    /** The guide for a machine in a state: its own, its type's, the state's (on its PLC or any) */
    match({ plc, machine, type, state }) {
      const of = guides.filter((g) => lower(g.state) === lower(state) && (!g.plc || g.plc === plc));
      return of.find((g) => g.machine && lower(g.machine) === lower(machine)) ?? of.find((g) => !g.machine && g.type && short(g.type) === short(type)) ?? of.find((g) => !g.machine && !g.type) ?? null;
    },
    save(g0, user) {
      const g = { ...checkGuide(g0), by: user, at: Date.now() };
      guides = [...guides.filter((x) => x.id !== g.id), g];
      write(guidesFile, guides);
      audit?.add(user, 'recovery.guide', { id: g.id, state: g.state, type: g.type, machine: g.machine, steps: g.steps.length });
      log(`recovery: ${user} saved the guide "${g.title}" (${g.steps.length} steps)`);
      publish();
      return g;
    },
    remove(id, user) {
      if (!guides.some((g) => g.id === id)) throw new Error('No such guide');
      guides = guides.filter((g) => g.id !== id);
      write(guidesFile, guides);
      audit?.add(user, 'recovery.guide.delete', { id });
      publish();
    },
    /** A guide begun for a machine */
    start({ guide, plc, plcName, machine, state }, user) {
      const g = guides.find((x) => x.id === guide);
      if (!g) throw new Error('No such guide');
      const r = { id: crypto.randomBytes(6).toString('hex'), guide: g.id, title: g.title, plc: String(plc ?? ''), plcName: String(plcName ?? ''), machine: String(machine ?? ''), state: String(state ?? ''), by: user, startedAt: Date.now(), steps: [], endedAt: null, outcome: null, note: '' };
      runs.push(r);
      if (runs.length > 2000) runs = runs.slice(-2000);
      write(runsFile, runs);
      return r;
    },
    /** A step done (or skipped), with what its check read */
    step(id, i, { skipped = false, value } = {}, user) {
      const r = runOf(id);
      if (r.endedAt) throw new Error('That recovery has ended');
      const n = Number(i);
      if (!Number.isInteger(n) || n < 0 || n > 29) throw new Error('No such step');
      r.steps = [...r.steps.filter((s) => s.i !== n), { i: n, at: Date.now(), by: user, skipped: !!skipped, ...(value !== undefined ? { value: String(value).slice(0, 40) } : {}) }];
      write(runsFile, runs);
      return r;
    },
    end(id, outcome, note, user) {
      const r = runOf(id);
      if (!OUTCOMES.includes(outcome)) throw new Error(`One of: ${OUTCOMES.join(', ')}`);
      if (!r.endedAt) {
        r.endedAt = Date.now();
        r.outcome = outcome;
        r.note = String(note ?? '').trim().slice(0, 500);
        write(runsFile, runs);
        audit?.add(user, 'recovery', { id, guide: r.guide, plc: r.plc, machine: r.machine, outcome, steps: r.steps.length, skipped: r.steps.filter((s) => s.skipped).length });
        log(`recovery: ${user}: ${r.machine} by "${r.title}": ${outcome} in ${Math.round((r.endedAt - r.startedAt) / 1000)} s`);
        publish();
      }
      return r;
    },
    /** The checks of a guide's steps, read from its PLC now: { var, value, ok } each */
    async checks(plc, list) {
      const want = (Array.isArray(list) ? list : []).filter((c) => c && SYMBOL.test(String(c.var ?? ''))).slice(0, 30);
      if (!want.length) return [];
      const values = await readVars(plc, [...new Set(want.map((c) => c.var))]);
      return want.map((c) => {
        const v = values[c.var];
        return { var: c.var, equals: c.equals, value: v?.error ? null : v?.value ?? null, error: v?.error ?? null, ok: !v?.error && checkPasses(v?.value, c.equals) };
      });
    },
    runs: (limit = 200) => runs.slice(-limit).reverse(),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createRecovery, checkGuide, checkPasses };

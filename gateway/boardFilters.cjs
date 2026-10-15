// The operator board's saved filters, shared by everyone on the gateway: a name, who it is for (engineering,
// operators, managers, maintenance, other), and what it shows: the words of the filter, problems only, the tree or the
// flat view, some PLCs, chosen machines, chosen I/O signals, the alerts panel. Kept in board-filters.json beside
// config.json; saved and deleted from the board by the people the gateway lets edit it (boardEditors), logged in its
// audit log; every open board gets the new list. A wall screen opens one with ?board&saved=<id>.
const fs = require('fs');
const crypto = require('crypto');

const AUDIENCES = ['engineering', 'operators', 'managers', 'maintenance', 'other'];
const MAX_FILTERS = 200;
const PATH = /^[A-Za-z_]\w*(\[-?\d+(,\s*-?\d+)*\])*(\.[A-Za-z_]\w*(\[-?\d+(,\s*-?\d+)*\])*)*$/;

/** A filter as saved, checked (throws with a message for the board) */
function checkFilter(f, plcIds) {
  const name = String(f?.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Name the filter');
  const audience = AUDIENCES.includes(f?.audience) ? f.audience : 'other';
  const list = (x, max, ok) => (Array.isArray(x) ? x : []).map((v) => String(v).trim()).filter((v) => v && ok(v)).slice(0, max);
  // (machines and signals: "<plc id>|<symbol path>")
  const keyed = (v) => {
    const [plc, p] = v.split('|');
    return plcIds.includes(plc) && PATH.test(p ?? '');
  };
  return {
    name,
    audience,
    note: String(f?.note ?? '').trim().slice(0, 200),
    text: String(f?.text ?? '').trim().slice(0, 200),
    problemsOnly: f?.problemsOnly === true,
    layout: f?.layout === 'tree' ? 'tree' : 'flat',
    plcs: list(f?.plcs, 50, (p) => plcIds.includes(p)),
    machines: list(f?.machines, 500, keyed),
    signals: list(f?.signals, 50, keyed),
    alerts: f?.alerts === false ? false : true,
    page: ['io', 'drives', 'risk', 'oee'].includes(f?.page) ? f.page : 'machines',
  };
}

function createBoardFilters({ file, log, audit }) {
  let filters = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    filters = Array.isArray(raw?.filters) ? raw.filters : [];
  } catch {
    filters = [];
  }
  const listeners = new Set();
  const save = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ filters }, null, 2) + '\n');
    fs.renameSync(tmp, file);
    for (const fn of listeners) fn(filters);
  };
  return {
    list: () => filters,
    /** Saved (a new one, or the one of that id replaced): the list */
    save(f, user, plcIds) {
      const clean = checkFilter(f, plcIds);
      const old = typeof f?.id === 'string' ? filters.find((x) => x.id === f.id) : null;
      if (!old && filters.length >= MAX_FILTERS) throw new Error(`At most ${MAX_FILTERS} saved filters: delete some first`);
      const now = new Date().toISOString();
      const next = old ? { ...old, ...clean, changedBy: user, changedAt: now } : { id: crypto.randomBytes(5).toString('hex'), ...clean, by: user, at: now };
      filters = old ? filters.map((x) => (x === old ? next : x)) : [...filters, next];
      save();
      log(`board: ${user} ${old ? 'changed' : 'saved'} the filter "${next.name}" (${next.audience})`);
      audit?.add(user, old ? 'board.filter.change' : 'board.filter.save', { id: next.id, name: next.name, audience: next.audience });
      return next;
    },
    remove(id, user) {
      const f = filters.find((x) => x.id === id);
      if (!f) return false;
      filters = filters.filter((x) => x !== f);
      save();
      log(`board: ${user} deleted the filter "${f.name}"`);
      audit?.add(user, 'board.filter.delete', { id, name: f.name });
      return true;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createBoardFilters, checkFilter, AUDIENCES };

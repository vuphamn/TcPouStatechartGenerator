// Spare parts: what is kept for the machines (its part number, name, where it is kept, how many, the level to reorder
// at, what it fits: device types, machines), each change of stock kept (received, taken, used by a work order). A
// work order done takes the parts it used from stock. A part at or below its reorder level is told to the roles that
// want "parts" (roles.notify). The catalogue is edited by those who assign work (supervisors, engineers); stock is
// received and taken by those who handle work orders. Kept in spares.json beside config.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_MOVES = 5000;

function createSpares({ baseDir, log, audit, notify }) {
  const file = path.join(baseDir, 'spares.json');
  let state = { parts: [], moves: [] };
  try {
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(x.parts)) state = { parts: x.parts, moves: Array.isArray(x.moves) ? x.moves : [] };
  } catch {
    // none yet
  }
  const listeners = new Set();
  const save = () => {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      log(`spares: ${err.message}`);
    }
    for (const fn of listeners) fn();
  };
  const text = (x, n) => String(x ?? '').trim().slice(0, n);
  const num = (x, lo, hi) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : null;
  };
  const partOf = (id) => {
    const p = state.parts.find((x) => x.id === id);
    if (!p) throw new Error('No such part');
    return p;
  };
  const low = (p) => p.min > 0 && p.qty <= p.min;
  const tellIfLow = (p, before) => {
    if (low(p) && !(before <= p.min)) notify?.({ event: 'parts', plc: '', plcName: '', machine: '', state: 'low', at: new Date().toISOString(), text: `📦 Spare part ${p.number} ${p.name}: ${p.qty} ${p.unit || 'left'} (reorder at ${p.min})${p.supplier ? `, from ${p.supplier}` : ''}` });
  };
  const move = (p, delta, why, user, order) => {
    const before = p.qty;
    p.qty = Math.max(0, p.qty + delta);
    p.updatedAt = Date.now();
    state.moves.push({ at: Date.now(), part: p.id, number: p.number, delta: p.qty - before, qty: p.qty, by: user, why: text(why, 200), ...(order ? { order } : {}) });
    if (state.moves.length > MAX_MOVES) state.moves = state.moves.slice(-MAX_MOVES);
    tellIfLow(p, before);
  };

  return {
    /** The parts (low ones flagged) and the latest changes of stock */
    /** Every move kept (the KPIs: parts per machine) */
    moves: () => state.moves,
    view: () => ({ parts: state.parts.map((p) => ({ ...p, low: low(p) })), moves: state.moves.slice(-200).reverse() }),
    /** A part written (new, or changed: its stock set here is a change of stock too) */
    save(p0, user) {
      const number = text(p0?.number, 60);
      const name = text(p0?.name, 120);
      if (!number || !name) throw new Error('A part has its number and its name');
      const id = typeof p0?.id === 'string' && state.parts.some((x) => x.id === p0.id) ? p0.id : null;
      if (state.parts.some((x) => x.id !== id && x.number.toLowerCase() === number.toLowerCase())) throw new Error(`Part ${number} is there already`);
      const fields = { number, name, location: text(p0?.location, 80), min: num(p0?.min, 0, 1e6) ?? 0, unit: text(p0?.unit, 20), fits: text(p0?.fits, 300), supplier: text(p0?.supplier, 120), notes: text(p0?.notes, 500) };
      const qty = num(p0?.qty, 0, 1e7) ?? 0;
      let p;
      if (id) {
        p = partOf(id);
        Object.assign(p, fields);
        if (qty !== p.qty) move(p, qty - p.qty, 'counted', user);
        p.updatedAt = Date.now();
      } else {
        p = { id: crypto.randomBytes(5).toString('hex'), ...fields, qty: 0, updatedAt: Date.now() };
        state.parts.push(p);
        if (qty) move(p, qty, 'first stock', user);
      }
      save();
      audit?.add(user, 'spares.save', { id: p.id, number, qty: p.qty });
      return p;
    },
    remove(id, user) {
      const p = partOf(id);
      state.parts = state.parts.filter((x) => x.id !== id);
      save();
      audit?.add(user, 'spares.delete', { id, number: p.number });
    },
    /** Stock received (+) or taken (-) by hand */
    adjust(id, delta, why, user) {
      const p = partOf(id);
      const d = num(delta, -1e6, 1e6);
      if (!d) throw new Error('How many: received (+) or taken (-)');
      if (d < 0 && -d > p.qty) throw new Error(`Only ${p.qty} of ${p.number} in stock`);
      move(p, d, why || (d > 0 ? 'received' : 'taken'), user);
      save();
      audit?.add(user, 'spares.move', { id, number: p.number, delta: d, qty: p.qty });
      return p;
    },
    /** The parts a work order used: checked (all known, enough of each) before it is done */
    check(used) {
      return (Array.isArray(used) ? used : []).filter((u) => u && Number(u.qty) > 0).map((u) => {
        const p = partOf(String(u.id));
        const qty = num(u.qty, 1, 1e6);
        if (qty > p.qty) throw new Error(`Only ${p.qty} of ${p.number} ${p.name} in stock`);
        return { p, qty };
      });
    },
    /** ... then taken from stock, the work order named; its text for the work order's parts */
    take(checked, user, orderNumber) {
      for (const { p, qty } of checked) move(p, -qty, `work order #${orderNumber}`, user, orderNumber);
      if (checked.length) {
        save();
        log(`spares: work order #${orderNumber} used ${checked.map(({ p, qty }) => `${qty} × ${p.number}`).join(', ')}`);
      }
      return checked.map(({ p, qty }) => `${qty} × ${p.number} ${p.name}`).join('; ');
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { createSpares };

// Energy per part (the OEE page): a PLC's energy meters, each a variable of the PLC (an EL34xx power measurement
// terminal's energy, or its power, linked to a PLC variable; or any meter the PLC reads), recorded with that PLC's
// recordings. A meter's energy in a window: its rises (an energy counter: Wh, kWh, MWh; a reset counted from zero),
// or its power integrated over time (W, kW). Per part: its energy over the parts its machines made (all of its PLC's,
// or those it names); per product too; its cost at config.energy.price a kWh.
// config.json "energy": { "meters": [{ "plc": "line202", "name": "Main feed", "var": "GVL.fEnergy", "unit": "kWh",
//   "machines": ["MAIN.fbCell.smTable1"] }], "price": 0.18, "currency": "USD" }
/** A counter's rises over its values (a drop: a reset, counted from zero); null: none (as oee.cjs counts parts) */
function risesOf(list) {
  if (!list?.length) return null;
  let n = 0;
  for (let i = 1; i < list.length; i++) {
    const a = Number(list[i - 1].v);
    const b = Number(list[i].v);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n += b >= a ? b - a : b;
  }
  return n;
}

const TO_KWH = { wh: 0.001, kwh: 1, mwh: 1000 };
const TO_KW = { w: 0.001, kw: 1, mw: 1000 };

/** A meter checked (null: not one): { plc, name, var, unit, kind: energy | power, factor (to kWh or kW), machines } */
function meterOf(m) {
  if (!m || typeof m.plc !== 'string' || typeof m.var !== 'string' || !m.var.trim()) return null;
  const unit = String(m.unit ?? 'kWh').trim();
  const u = unit.toLowerCase();
  const kind = TO_KWH[u] !== undefined ? 'energy' : TO_KW[u] !== undefined ? 'power' : null;
  if (!kind) return null;
  const scale = Number.isFinite(Number(m.scale)) && Number(m.scale) > 0 ? Number(m.scale) : 1;
  return { plc: m.plc, name: String(m.name ?? m.var).slice(0, 80), var: m.var.trim(), unit, kind, factor: (kind === 'energy' ? TO_KWH[u] : TO_KW[u]) * scale, machines: Array.isArray(m.machines) ? m.machines.map(String) : [] };
}

/** A meter's energy (kWh) from its recorded values [{ t, v }] over [from, to]; null: nothing recorded */
function kwhOf(meter, list, from, to) {
  if (!list?.length) return null;
  if (meter.kind === 'energy') {
    const r = risesOf(list.filter((x) => x.t <= to));
    return r === null ? null : r * meter.factor;
  }
  // (power: each value held until the next, integrated)
  let kwh = 0;
  for (let i = 0; i < list.length; i++) {
    const v = Number(list[i].v);
    if (!Number.isFinite(v)) continue;
    const a = Math.max(list[i].t, from);
    const b = Math.min(list[i + 1]?.t ?? to, to);
    if (b > a) kwh += (v * meter.factor * (b - a)) / 3600000;
  }
  return kwh;
}

/**
 * The EL34xx boxes of a PLC's I/O (its boot files) and the PLC variables linked to them: { boxes: [{ box, product,
 * links: [{ entry, variable, type }] }] }, to choose a meter's variable from
 */
async function findMeters({ client, readIoTree, readBootFile }) {
  const tree = await readIoTree((rel) => readBootFile(client, rel));
  if (tree?.error) return { error: tree.error, boxes: [] };
  const out = [];
  const walk = (boxes, device) => {
    for (const b of boxes ?? []) {
      const product = `${b.product ?? ''} ${b.info?.type ?? ''}`;
      if (/\bEL34\d\d/i.test(product) || /\bEL34\d\d/i.test(b.name ?? '')) {
        const tail = `^${b.name}`;
        const links = (tree.links ?? []).filter((l) => String(l.box ?? '').endsWith(tail)).map((l) => ({ entry: l.entry, variable: l.variable, type: l.type }));
        out.push({ device, box: b.name, product: (b.info?.type || b.product || '').trim(), links });
      }
      walk(b.boxes, device);
    }
  };
  for (const d of tree.devices ?? []) walk(d.boxes, d.name);
  return { boxes: out };
}

module.exports = { meterOf, kwhOf, findMeters };

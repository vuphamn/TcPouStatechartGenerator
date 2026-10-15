// Drive profiles for the drive health board (drives.cjs): which drives (an EtherCAT box's vendor and product, or its
// type), and which of their own parameters to read (CoE objects: index, subindex), as what (type, scale, unit).
// Read-only, over ADS through the EtherCAT master (the slave's mailbox: the device's AMS NetId, the slave's EtherCAT
// address as the port). A gateway's config.json "drives.profiles" adds its own or replaces one of the same id.
//
// Lenze i550 (EtherCAT, vendor 0x3B): the objects as Lenze's i550 commissioning manual lists them (keypad P-codes):
//   P100 output frequency 0x2DDD, P103 current actual 0x6078 (% of rated), P104 motor current 0x2D88, P105 DC-bus
//   voltage 0x2D87, P106 motor voltage 0x2D89, P107 torque actual 0x6077 (% of rated), P117.01 heatsink temperature
//   0x2D84:001 (x.x °C; 0x2D84:002 its warning threshold), P123 motor i²t utilisation 0x2D4F, P135.04 device ixt
//   utilisation 0x2D40:004, P151 life diagnosis 0x2D81:001 operating time (s), :002 power-on time (s), :004 mains
//   switching cycles, :006 short-circuit counter, :007 earth-fault counter; 0x603F the error code (CiA 402).
//   verified: false where the manual gives the object but not its scaling (shown so on the board): check one value
//   against the drive's keypad once, and correct the profile here or in config.json.

const PROFILES = [
  {
    id: 'lenze-i550',
    name: 'Lenze i550',
    match: { vendorId: 0x3b, type: /i550/i },
    running: 'freq',
    params: [
      { key: 'freq', label: 'Output frequency', index: 0x2ddd, sub: 0, signed: true, size: 2, scale: 0.1, unit: 'Hz', verified: false },
      { key: 'current', label: 'Motor current', index: 0x2d88, sub: 0, signed: false, size: 2, scale: 0.1, unit: 'A', verified: true, trend: true },
      { key: 'currentPct', label: 'Current of rated', index: 0x6078, sub: 0, signed: true, size: 2, scale: 0.1, unit: '%', verified: true },
      { key: 'torque', label: 'Torque', index: 0x6077, sub: 0, signed: true, size: 2, scale: 0.1, unit: '%', verified: true },
      { key: 'dcBus', label: 'DC-bus voltage', index: 0x2d87, sub: 0, signed: false, size: 2, scale: 1, unit: 'V', verified: true, peers: true },
      { key: 'motorVoltage', label: 'Motor voltage', index: 0x2d89, sub: 0, signed: false, size: 2, scale: 1, unit: 'V', verified: false },
      { key: 'heatsink', label: 'Heatsink temperature', index: 0x2d84, sub: 1, signed: true, size: 2, scale: 0.1, unit: '°C', verified: true, trend: true, peers: true },
      { key: 'heatsinkLimit', label: 'Heatsink warning threshold', index: 0x2d84, sub: 2, signed: true, size: 2, scale: 0.1, unit: '°C', verified: true, slow: true },
      { key: 'motorI2t', label: 'Motor utilisation (i²t)', index: 0x2d4f, sub: 0, signed: false, size: 2, scale: 1, unit: '%', verified: false },
      { key: 'deviceIxt', label: 'Device utilisation (ixt)', index: 0x2d40, sub: 4, signed: false, size: 2, scale: 1, unit: '%', verified: false },
      { key: 'error', label: 'Error code', index: 0x603f, sub: 0, signed: false, size: 2, scale: 1, unit: '', format: 'hex', verified: true },
      { key: 'opHours', label: 'Operating time', index: 0x2d81, sub: 1, signed: false, size: 4, scale: 1 / 3600, unit: 'h', verified: true, slow: true },
      { key: 'powerOnHours', label: 'Power-on time', index: 0x2d81, sub: 2, signed: false, size: 4, scale: 1 / 3600, unit: 'h', verified: true, slow: true },
      { key: 'switchCycles', label: 'Mains switching cycles', index: 0x2d81, sub: 4, signed: false, size: 4, scale: 1, unit: '', verified: true, slow: true, counter: true },
      { key: 'shortCircuits', label: 'Short circuits', index: 0x2d81, sub: 6, signed: false, size: 2, scale: 1, unit: '', verified: true, slow: true, counter: true, bad: true },
      { key: 'earthFaults', label: 'Earth faults', index: 0x2d81, sub: 7, signed: false, size: 2, scale: 1, unit: '', verified: true, slow: true, counter: true, bad: true },
    ],
  },
  // Any other maker's drive (not Beckhoff's: a box named or typed as a drive, inverter, spindle, servo): the
  // standard CiA 402 objects every such drive has (its own makers' objects differ: add a profile of its own)
  {
    id: 'cia402',
    name: 'CiA 402 drive',
    match: { exceptVendorIds: [2], type: /\b(inverter|vfd|drive|spindle|servo|ES95)/i },
    running: 'velocity',
    params: [
      { key: 'status', label: 'Status word', index: 0x6041, sub: 0, signed: false, size: 2, scale: 1, unit: '', format: 'hex', verified: true },
      { key: 'error', label: 'Error code', index: 0x603f, sub: 0, signed: false, size: 2, scale: 1, unit: '', format: 'hex', verified: true },
      { key: 'velocity', label: 'Velocity actual', index: 0x606c, sub: 0, signed: true, size: 4, scale: 1, unit: '', verified: false },
      { key: 'currentPct', label: 'Current of rated', index: 0x6078, sub: 0, signed: true, size: 2, scale: 0.1, unit: '%', verified: true, trend: true },
      { key: 'torque', label: 'Torque', index: 0x6077, sub: 0, signed: true, size: 2, scale: 0.1, unit: '%', verified: true },
      { key: 'dcBus', label: 'DC-link voltage', index: 0x6079, sub: 0, signed: false, size: 4, scale: 0.001, unit: 'V', verified: true, peers: true },
    ],
  },
];

/** A profile from config.json, checked (throws with a message for the log) */
function checkProfile(p, i) {
  const where = `drives.profiles[${i}]`;
  if (!p || typeof p.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id)) throw new Error(`${where}: an id (letters, digits, - _)`);
  const vendorId = p.match?.vendorId == null ? null : Number(p.match.vendorId);
  const type = typeof p.match?.type === 'string' && p.match.type ? new RegExp(p.match.type, 'i') : null;
  const productCode = typeof p.match?.productCode === 'string' ? p.match.productCode.toLowerCase() : null;
  if (vendorId === null && !type && !productCode) throw new Error(`${where}: match a vendorId, a type or a productCode`);
  const params = (Array.isArray(p.params) ? p.params : []).map((x, k) => {
    const index = typeof x.index === 'string' ? parseInt(x.index, 16) : Number(x.index);
    if (!/^[A-Za-z]\w{0,30}$/.test(String(x.key ?? '')) || !(index > 0 && index <= 0xffff)) throw new Error(`${where}.params[${k}]: a key and an index (0x2D84)`);
    return { key: x.key, label: String(x.label ?? x.key).slice(0, 60), index, sub: Number(x.sub) || 0, signed: x.signed === true, size: [1, 2, 4, 8].includes(Number(x.size)) ? Number(x.size) : 2, scale: Number.isFinite(Number(x.scale)) ? Number(x.scale) : 1, unit: String(x.unit ?? '').slice(0, 8), verified: x.verified !== false, trend: x.trend === true, peers: x.peers === true, slow: x.slow === true, counter: x.counter === true, bad: x.bad === true, ...(x.format === 'hex' ? { format: 'hex' } : {}) };
  });
  if (!params.length) throw new Error(`${where}: its params`);
  return { id: p.id, name: String(p.name ?? p.id).slice(0, 60), match: { vendorId, type, productCode }, running: typeof p.running === 'string' ? p.running : null, params };
}

/** The profiles: the built-in ones, with config.json's added (the same id: replaced) */
function profilesOf(extra, log) {
  const out = new Map(PROFILES.map((p) => [p.id, p]));
  (Array.isArray(extra) ? extra : []).forEach((p, i) => {
    try {
      const c = checkProfile(p, i);
      out.set(c.id, c);
    } catch (err) {
      log?.(`drives: ${err.message}`);
    }
  });
  return [...out.values()];
}

/** The profile of an EtherCAT box (null: not a drive the board knows) */
function profileFor(box, profiles) {
  const info = box?.info ?? {};
  for (const p of profiles) {
    const m = p.match;
    if (m.vendorId != null && info.vendorId !== m.vendorId) continue;
    if (m.exceptVendorIds?.includes(info.vendorId) || (m.exceptVendorIds && info.vendorId === undefined)) continue;
    if (m.productCode && String(info.productCode ?? '').toLowerCase() !== m.productCode) continue;
    if (m.type && !m.type.test(`${info.type ?? ''} ${info.desc ?? ''} ${box.name ?? ''}`)) continue;
    return p;
  }
  return null;
}

/** A CoE value's bytes (little-endian, its own length) as the profile reads it */
function decodeValue(buf, param) {
  if (!buf?.length) return null;
  // (its own size: a longer answer is padding)
  const n = [8, 4, 2, 1].find((k) => k <= Math.min(buf.length, param.size ?? buf.length)) ?? 1;
  let raw;
  if (n === 8) raw = Number(param.signed ? buf.readBigInt64LE(0) : buf.readBigUInt64LE(0));
  else if (n === 4) raw = param.signed ? buf.readInt32LE(0) : buf.readUInt32LE(0);
  else if (n === 2) raw = param.signed ? buf.readInt16LE(0) : buf.readUInt16LE(0);
  else raw = param.signed ? buf.readInt8(0) : buf.readUInt8(0);
  return { raw, value: raw * param.scale };
}

module.exports = { PROFILES, profilesOf, profileFor, decodeValue, checkProfile };

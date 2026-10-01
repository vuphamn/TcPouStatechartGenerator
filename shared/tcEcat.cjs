// The EtherCAT master's own view of its slaves, over ADS (read-only): the master answers at its device's AmsNetId
// (the I/O device's, e.g. 10.10.10.221.2.1, from the project's .xti) on port 0xFFFF:
//   index group 0x06: the number of slaves (UINT)
//   index group 0x07: their EtherCAT addresses (UINT each, in the same order)
//   index group 0x09: each slave's state, in the order they are wired (2 bytes each: its device state, its link state)
//   index group 0x12: each slave's CRC error counters, ports A … D
// as Tc2_EtherCAT's FB_EcGetSlaveCount / FB_EcGetAllSlaveAddr / FB_EcGetAllSlaveStates / FB_EcGetAllSlaveCrcErrors
// read them (the addresses and counters only when the master answers them). NOT YET CONFIRMED ON HARDWARE: the calls
// follow Beckhoff's documentation of the EtherCAT master's ADS interface; a PLC may answer otherwise.
const ECAT_PORT = 0xffff;
const IG_SLAVE_COUNT = 0x06;
const IG_SLAVE_ADDRESSES = 0x07;
const IG_SLAVE_STATES = 0x09;
const IG_SLAVE_CRC = 0x12;

/** A slave's device state as TwinCAT names it (the low nibble), and its flags (the high one) */
const STATE_NAMES = { 1: 'INIT', 2: 'PREOP', 3: 'BOOT', 4: 'SAFEOP', 8: 'OP' };
function describeState(device, link) {
  const base = device & 0x0f;
  const flags = [];
  if (device & 0x10) flags.push('error');
  if (device & 0x20) flags.push('invalid VPRS');
  if (device & 0x40) flags.push('init command error');
  if (device & 0x80) flags.push('disabled');
  // (the link state: 0 OK; 1 not present; 2 link without communication; 4 a link missing; 8 an additional link;
  // 0x10 … 0x80: on port A … D)
  const linkFlags = [];
  if (link & 0x01) linkFlags.push('not present');
  if (link & 0x02) linkFlags.push('link without communication');
  if (link & 0x04) linkFlags.push('missing link');
  if (link & 0x08) linkFlags.push('additional link');
  const ports = ['A', 'B', 'C', 'D'].filter((_, i) => link & (0x10 << i));
  const name = STATE_NAMES[base] ?? (base ? `state ${base}` : 'no answer');
  const ok = base === 8 && !(device & 0xf0) && !(link & 0x0f);
  return { name, ok, flags, link: linkFlags, ports, device, linkState: link };
}

/**
 * The slaves' states (client: an ads-client connected to the PLC's router; masterNetId: the I/O device's AmsNetId):
 * { count, slaves: [{ index, name, ok, flags, link, ports, device, linkState, address?, crc? }], at } or { error }
 * (crc: the counters of ports A … D)
 */
async function readEcatStates(client, masterNetId) {
  if (!/^\d+\.\d+\.\d+\.\d+\.\d+\.\d+$/.test(String(masterNetId || ''))) return { error: 'Not an EtherCAT master\'s AmsNetId' };
  const target = { amsNetId: masterNetId, adsPort: ECAT_PORT };
  try {
    const count = (await client.readRaw(IG_SLAVE_COUNT, 0, 2, target)).readUInt16LE(0);
    if (!count) return { count: 0, slaves: [], at: Date.now() };
    const raw = await client.readRaw(IG_SLAVE_STATES, 0, count * 2, target);
    const slaves = [];
    for (let i = 0; i < count && i * 2 + 1 < raw.length; i++) slaves.push({ index: i, ...describeState(raw[i * 2], raw[i * 2 + 1]) });
    // (the addresses and the CRC counters: when the master answers them)
    try {
      const a = await client.readRaw(IG_SLAVE_ADDRESSES, 0, count * 2, target);
      for (let i = 0; i < slaves.length && i * 2 + 1 < a.length; i++) slaves[i].address = a.readUInt16LE(i * 2);
    } catch {
      // (not known: the slaves matched by their order)
    }
    try {
      const c = await client.readRaw(IG_SLAVE_CRC, 0, count * 16, target);
      // (4 counters a slave: 4 bytes each, or 2)
      const per = Math.floor(c.length / count);
      const size = per >= 16 ? 4 : per >= 8 ? 2 : 0;
      if (size) for (let i = 0; i < slaves.length; i++) slaves[i].crc = [0, 1, 2, 3].map((k) => (size === 4 ? c.readUInt32LE(i * per + k * 4) : c.readUInt16LE(i * per + k * 2)));
    } catch {
      // (no counters)
    }
    return { count, slaves, at: Date.now() };
  } catch (err) {
    return { error: err?.adsError?.errorStr ? `${err.adsError.errorStr} (the EtherCAT master at ${masterNetId})` : String(err?.message || err) };
  }
}

/**
 * The states of the I/O devices' masters asked for (netIds: their AmsNetIds), only those of the connected target's
 * TwinCAT (the same first four numbers as targetNetId: its own devices), at most 8: { masters: { netId: result } }
 */
async function readMasters(client, targetNetId, netIds) {
  const system = String(targetNetId || '').split('.').slice(0, 4).join('.');
  const wanted = [...new Set((Array.isArray(netIds) ? netIds : []).map(String))].slice(0, 8);
  const masters = {};
  for (const id of wanted) {
    masters[id] = id.split('.').slice(0, 4).join('.') === system ? await readEcatStates(client, id) : { error: 'Not a device of the connected PLC' };
  }
  return { masters };
}

module.exports = { readEcatStates, readMasters, describeState, ECAT_PORT, IG_SLAVE_COUNT, IG_SLAVE_ADDRESSES, IG_SLAVE_STATES, IG_SLAVE_CRC };

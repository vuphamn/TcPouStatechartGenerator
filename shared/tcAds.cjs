// ADS helpers shared by the desktop app (electron/tcLive.cjs) and the web gateway (gateway/): symbol lookup and
// handles over raw ADS (ads-client in raw mode), value decoding, error texts, and finding the instances of a
// function block from the PLC's own symbol and data type tables.

const SYM_HANDLE_BY_NAME = 0xf003;
const SYM_VALUE_BY_HANDLE = 0xf005;
const SYM_RELEASE_HANDLE = 0xf006;
const SYM_INFO_BY_NAME_EX = 0xf009;
const SYM_UPLOAD = 0xf00b;
const SYM_DT_UPLOAD = 0xf00e;
const SYM_UPLOAD_INFO2 = 0xf00f;

const ADS_STATES = { 5: 'Run', 6: 'Stop', 15: 'Config', 16: 'Reconfig', 11: 'Error' };

function adsErrorText(err) {
  const code = err?.adsError?.errorCode ?? err?.errorCode;
  const text = err?.adsError?.errorStr ?? err?.message ?? String(err);
  switch (code) {
    case 0x6: return 'target port not found (is the PLC running? is it the right ADS port?) [0x6]';
    case 0x7: return 'target computer not found [0x7]';
    case 0x710: return 'symbol not found (is the current program downloaded?) [0x710]';
    case 0x745: case 0x746: return 'timeout (no answer from the PLC) [0x745]';
    default: return code ? `${text} [0x${code.toString(16)}]` : text;
  }
}

function decode(buf, size) {
  switch (size) {
    case 1: return buf.readUInt8(0);
    case 2: return buf.readInt16LE(0);
    case 4: return buf.readInt32LE(0);
    case 8: return Number(buf.readBigInt64LE(0));
    default: return 0;
  }
}

/** The symbol's size and type, or null when the PLC has no such symbol */
async function probe(client, symbol) {
  try {
    const buf = await client.readWriteRaw(SYM_INFO_BY_NAME_EX, 0, 0xffff, Buffer.from(`${symbol}\0`, 'latin1'));
    if (buf.length < 30) return null;
    // AdsSymbolEntry: entryLength, iGroup, iOffs, size, dataType, flags (uint32), name/type/comment lengths (uint16)
    const nameLength = buf.readUInt16LE(24);
    const typeLength = buf.readUInt16LE(26);
    return { size: buf.readUInt32LE(12), type: buf.toString('latin1', 30 + nameLength + 1, 30 + nameLength + 1 + typeLength) };
  } catch (err) {
    const code = err?.adsError?.errorCode;
    if (code === 0x710 || code === 0x703) return null;
    throw err;
  }
}

async function createHandle(client, symbol) {
  return (await client.readWriteRaw(SYM_HANDLE_BY_NAME, 0, 4, Buffer.from(`${symbol}\0`, 'latin1'))).readUInt32LE(0);
}

async function releaseHandle(client, handle) {
  const h = Buffer.alloc(4);
  h.writeUInt32LE(handle);
  await client.writeRaw(SYM_RELEASE_HANDLE, 0, h);
}

async function readByHandle(client, handle, size) {
  return decode(await client.readRaw(SYM_VALUE_BY_HANDLE, handle, size), size);
}

/** Subscribes on change (checked every 1 ms, at most once per PLC task cycle), sent without delay */
function subscribeHandle(client, handle, size, onValue) {
  return client.subscribeRaw(SYM_VALUE_BY_HANDLE, handle, size, (data) => onValue({ t: data.timestamp.getTime(), value: decode(data.value, size) }), 1, true, 0);
}

// ---- Instance discovery from the PLC's symbol and data type tables ----

const lastSegment = (type) => (type || '').trim().split('.').pop().toLowerCase();

/** "ARRAY [1..4] OF SM_X" -> { low: 1, high: 4, element: "SM_X" } */
function arrayType(type) {
  const m = (type || '').match(/^ARRAY\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s*OF\s+(.+)$/i);
  return m ? { low: Number(m[1]), high: Number(m[2]), element: m[3].trim() } : null;
}

function parseSymbols(buf) {
  const list = [];
  for (let at = 0; at + 30 <= buf.length; ) {
    const len = buf.readUInt32LE(at);
    if (!len) break;
    const nameLength = buf.readUInt16LE(at + 24);
    const typeLength = buf.readUInt16LE(at + 26);
    const name = buf.toString('latin1', at + 30, at + 30 + nameLength);
    const type = buf.toString('latin1', at + 30 + nameLength + 1, at + 30 + nameLength + 1 + typeLength);
    list.push({ name, type });
    at += len;
  }
  return list;
}

/** One AdsDatatypeEntry (with its sub items) at `at` */
function parseDataType(buf, at) {
  const len = buf.readUInt32LE(at);
  const nameLength = buf.readUInt16LE(at + 32);
  const typeLength = buf.readUInt16LE(at + 34);
  const commentLength = buf.readUInt16LE(at + 36);
  const arrayDim = buf.readUInt16LE(at + 38);
  const subCount = buf.readUInt16LE(at + 40);
  let p = at + 42;
  const name = buf.toString('latin1', p, p + nameLength);
  p += nameLength + 1;
  const type = buf.toString('latin1', p, p + typeLength);
  p += typeLength + 1 + commentLength + 1;
  const bounds = [];
  for (let i = 0; i < arrayDim; i++, p += 8) bounds.push({ low: buf.readInt32LE(p), count: buf.readUInt32LE(p + 4) });
  const subItems = [];
  for (let i = 0; i < subCount && p + 42 <= at + len; i++) {
    const sub = parseDataType(buf, p);
    subItems.push(sub.entry);
    p += sub.length;
  }
  return { entry: { name, type, bounds, subItems }, length: len };
}

function parseDataTypes(buf) {
  const types = new Map();
  for (let at = 0; at + 42 <= buf.length; ) {
    const len = buf.readUInt32LE(at);
    if (!len) break;
    const { entry } = parseDataType(buf, at);
    types.set(entry.name.toLowerCase(), entry);
    at += len;
  }
  return types;
}

/**
 * Paths of every instance of `typeName` in the running PLC (e.g. "MAIN.line.smTable", "GVL.aTables[2]"), from its
 * symbol table (top-level variables) and data types (members, walked down). Arrays are expanded up to 16 elements.
 */
async function discoverInstances(client, typeName, maxPaths = 50) {
  const info = await client.readRaw(SYM_UPLOAD_INFO2, 0, 24);
  const symSize = info.readUInt32LE(4);
  const dtSize = info.readUInt32LE(12);
  const symbols = parseSymbols(await client.readRaw(SYM_UPLOAD, 0, symSize));
  const types = dtSize ? parseDataTypes(await client.readRaw(SYM_DT_UPLOAD, 0, dtSize)) : new Map();
  const wanted = lastSegment(typeName);
  const paths = [];

  const visit = (path, type, bounds, depth, seen) => {
    if (paths.length >= maxPaths || depth > 12) return;
    const arr = arrayType(type) ?? (bounds && bounds.length === 1 ? { low: bounds[0].low, high: bounds[0].low + bounds[0].count - 1, element: type } : null);
    if (arr) {
      for (let i = arr.low; i <= Math.min(arr.high, arr.low + 15); i++) visit(`${path}[${i}]`, arr.element, null, depth + 1, seen);
      return;
    }
    const key = lastSegment(type);
    if (key === wanted) {
      paths.push(path);
      return;
    }
    const dt = types.get(type.toLowerCase()) ?? types.get(key);
    if (!dt || seen.has(dt.name.toLowerCase())) return;
    seen.add(dt.name.toLowerCase());
    for (const sub of dt.subItems) visit(`${path}.${sub.name}`, sub.type, sub.bounds, depth + 1, seen);
    // A derived function block: its base type's members (when the PLC lists them there)
    if (dt.type && dt.type.toLowerCase() !== dt.name.toLowerCase()) {
      const base = types.get(dt.type.toLowerCase()) ?? types.get(lastSegment(dt.type));
      if (base && !seen.has(base.name.toLowerCase())) {
        seen.add(base.name.toLowerCase());
        for (const sub of base.subItems) visit(`${path}.${sub.name}`, sub.type, sub.bounds, depth + 1, seen);
        seen.delete(base.name.toLowerCase());
      }
    }
    seen.delete(dt.name.toLowerCase());
  };
  for (const s of symbols) {
    if (lastSegment(s.type) === wanted && !arrayType(s.type)) paths.push(s.name);
    // Only top-level variables (nested members are reached through their data types)
    else if (!s.name.includes('.', s.name.indexOf('.') + 1)) visit(s.name, s.type, null, 0, new Set());
    if (paths.length >= maxPaths) break;
  }
  return [...new Map(paths.map((p) => [p.toLowerCase(), p])).values()];
}

/** Valid IEC symbol path (letters, digits, _, . and [index]): nothing else is ever sent to the PLC */
const isSymbolPath = (text) => typeof text === 'string' && text.length <= 250 && /^[A-Za-z_][\w]*(\[\d+\])*(\.[A-Za-z_][\w]*(\[\d+\])*)*$/.test(text);

module.exports = {
  ADS_STATES,
  adsErrorText,
  decode,
  probe,
  createHandle,
  releaseHandle,
  readByHandle,
  subscribeHandle,
  discoverInstances,
  isSymbolPath,
};

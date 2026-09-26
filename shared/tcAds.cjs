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

// ADS data type ids (AdsSymbolEntry.dataType) of values that can be shown as they are
const ADST = { INT16: 2, INT32: 3, REAL32: 4, REAL64: 5, INT8: 16, UINT8: 17, UINT16: 18, UINT32: 19, INT64: 20, UINT64: 21, STRING: 30, WSTRING: 31, BIT: 33 };
const SIMPLE_TYPES = new Set(Object.values(ADST));
/** Largest value read for a guard variable (STRING(255)) */
const MAX_VALUE_SIZE = 512;

/** A number, boolean or string variable (enums have their base type's id), small enough to follow */
const isSimpleValue = (info) => !!info && info.size > 0 && info.size <= MAX_VALUE_SIZE && SIMPLE_TYPES.has(info.dataType);

/** The value by the symbol's ADS data type: boolean, number (enums as their number) or string */
function decodeTyped(buf, info) {
  switch (info.dataType) {
    case ADST.BIT: return buf.readUInt8(0) !== 0;
    case ADST.INT8: return buf.readInt8(0);
    case ADST.UINT8: return buf.readUInt8(0);
    case ADST.INT16: return buf.readInt16LE(0);
    case ADST.UINT16: return buf.readUInt16LE(0);
    case ADST.INT32: return buf.readInt32LE(0);
    case ADST.UINT32: return buf.readUInt32LE(0);
    case ADST.INT64: return Number(buf.readBigInt64LE(0));
    case ADST.UINT64: return Number(buf.readBigUInt64LE(0));
    case ADST.REAL32: return buf.readFloatLE(0);
    case ADST.REAL64: return buf.readDoubleLE(0);
    case ADST.STRING: {
      const end = buf.indexOf(0);
      return buf.toString('latin1', 0, end < 0 ? buf.length : end);
    }
    case ADST.WSTRING: {
      let end = 0;
      while (end + 1 < buf.length && (buf[end] || buf[end + 1])) end += 2;
      return buf.toString('utf16le', 0, end);
    }
    default: return null;
  }
}

async function readTyped(client, handle, info) {
  return decodeTyped(await client.readRaw(SYM_VALUE_BY_HANDLE, handle, info.size), info);
}

/** Subscribes on change, checked every `cycleMs` (guard values are for people: 10 ms is plenty) */
function subscribeTyped(client, handle, info, onValue, cycleMs = 10) {
  return client.subscribeRaw(SYM_VALUE_BY_HANDLE, handle, info.size, (data) => onValue({ t: data.timestamp.getTime(), v: decodeTyped(data.value, info) }), cycleMs, true, 0);
}

/** The symbol's size, type and ADS data type id, or null when the PLC has no such symbol */
async function probe(client, symbol) {
  try {
    const buf = await client.readWriteRaw(SYM_INFO_BY_NAME_EX, 0, 0xffff, Buffer.from(`${symbol}\0`, 'latin1'));
    if (buf.length < 30) return null;
    // AdsSymbolEntry: entryLength, iGroup, iOffs, size, dataType, flags (uint32), name/type/comment lengths (uint16)
    const nameLength = buf.readUInt16LE(24);
    const typeLength = buf.readUInt16LE(26);
    return {
      size: buf.readUInt32LE(12),
      dataType: buf.readUInt32LE(16),
      type: buf.toString('latin1', 30 + nameLength + 1, 30 + nameLength + 1 + typeLength),
    };
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
  // entryLength, version, hashValue, typeHashValue, size, offs, dataType, flags (uint32), then lengths (uint16)
  const size = buf.readUInt32LE(at + 16);
  const dataType = buf.readUInt32LE(at + 24);
  const flags = buf.readUInt32LE(at + 28);
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
  return { entry: { name, type, size, dataType, flags, bounds, subItems, enumValues: enumInfos(buf, p, at + len, flags, size) }, length: len };
}

// AdsDatatypeEntry flags of the optional parts after the sub items (in this order)
const DT_TYPEGUID = 0x80;
const DT_COPYMASK = 0x200;
const DT_METHODINFOS = 0x800;
const DT_ATTRIBUTES = 0x1000;
const DT_ENUMINFOS = 0x2000;

/** An enum's members (value -> name) from the entry's optional parts, or null (not an enum / not readable) */
function enumInfos(buf, p, end, flags, size) {
  if (!(flags & DT_ENUMINFOS) || ![1, 2, 4, 8].includes(size)) return null;
  try {
    if (flags & DT_TYPEGUID) p += 16;
    if (flags & DT_COPYMASK) p += size;
    if (flags & DT_METHODINFOS) {
      const count = buf.readUInt16LE(p);
      p += 2;
      // Each method entry starts with its length
      for (let i = 0; i < count; i++) p += buf.readUInt32LE(p);
    }
    if (flags & DT_ATTRIBUTES) {
      const count = buf.readUInt16LE(p);
      p += 2;
      for (let i = 0; i < count; i++) p += 2 + buf.readUInt8(p) + 1 + buf.readUInt8(p + 1) + 1;
    }
    const count = buf.readUInt16LE(p);
    p += 2;
    const values = {};
    for (let i = 0; i < count && p < end; i++) {
      const nameLength = buf.readUInt8(p);
      const memberName = buf.toString('latin1', p + 1, p + 1 + nameLength);
      p += 1 + nameLength + 1;
      const value = size === 1 ? buf.readInt8(p) : size === 2 ? buf.readInt16LE(p) : size === 4 ? buf.readInt32LE(p) : Number(buf.readBigInt64LE(p));
      p += size;
      values[value] = memberName;
    }
    return Object.keys(values).length ? values : null;
  } catch {
    return null;
  }
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

// ---- Symbol browser: a symbol's members, one level at a time (from the PLC's data type information) ----

const SYM_DT_INFO_BY_NAME_EX = 0xf011;
const ADST_BIGTYPE = 65;
/** Most members / array elements listed for one symbol */
const MAX_BROWSE_CHILDREN = 500;
const MAX_ARRAY_CHILDREN = 100;

/** A data type by name (AdsDatatypeEntry with its sub items), cached per connection; null when the PLC has none */
async function dataTypeInfo(client, name, cache) {
  const key = (name || '').toLowerCase();
  if (!key) return null;
  if (cache?.has(key)) return cache.get(key);
  let dt = null;
  try {
    const buf = await client.readWriteRaw(SYM_DT_INFO_BY_NAME_EX, 0, 0xffff, Buffer.from(`${name}\0`, 'latin1'));
    if (buf.length >= 42) dt = parseDataType(buf, 0).entry;
  } catch (err) {
    const code = err?.adsError?.errorCode;
    if (code !== 0x710 && code !== 0x703 && code !== 0x707) throw err;
  }
  cache?.set(key, dt);
  return dt;
}

/** The type's members, with those of the function block it extends (when the PLC lists them there) */
async function membersOf(client, dt, cache, depth = 0) {
  const own = dt?.subItems ?? [];
  if (!dt || depth > 6 || !dt.type || lastSegment(dt.type) === lastSegment(dt.name) || /^(ARRAY|POINTER|REFERENCE)\b/i.test(dt.type)) return own;
  const base = await dataTypeInfo(client, dt.type, cache);
  if (!base || base.subItems.length === 0) return own;
  const inherited = await membersOf(client, base, cache, depth + 1);
  const names = new Set(own.map((m) => m.name.toLowerCase()));
  return [...inherited.filter((m) => !names.has(m.name.toLowerCase())), ...own];
}

/** value: shown with its value; struct / array: has members; other: pointers, references, interfaces, ... */
function symbolKind(type, size, dataType, bounds) {
  if (/^(POINTER|REFERENCE)\s+TO\b/i.test(type || '') || /^(PVOID|ITC\w*|I_\w+)$/i.test(type || '')) return 'other';
  if (/^ARRAY\b/i.test(type || '') || (bounds && bounds.length)) return arrayType(type) || (bounds && bounds.length === 1) ? 'array' : 'other';
  if (SIMPLE_TYPES.has(dataType) && size > 0 && size <= MAX_VALUE_SIZE) return 'value';
  return dataType === ADST_BIGTYPE ? 'struct' : 'other';
}

/** Does a variable of this type hold the state variable (a state machine the app can follow)? */
async function holdsStateVar(client, type, stateVar, cache) {
  return (await stateMemberOf(client, type, stateVar, cache)) !== null;
}

/** The state variable member of a type (with base types), or null */
async function stateMemberOf(client, type, stateVar, cache) {
  const dt = await dataTypeInfo(client, type, cache);
  if (!dt) return null;
  const want = stateVar.toLowerCase();
  return (await membersOf(client, dt, cache)).find((m) => m.name.toLowerCase() === want) ?? null;
}

/** A state machine's state variable: its type and, for an enum the PLC describes, its names by value */
async function stateInfo(client, type, stateVar, cache) {
  const m = await stateMemberOf(client, type, stateVar, cache);
  if (!m) return {};
  const enumDt = m.type ? await dataTypeInfo(client, m.type, cache) : null;
  return { stateType: m.type, ...(enumDt?.enumValues ? { stateNames: enumDt.enumValues } : {}) };
}

/**
 * The symbol and its members (or array elements), one level: { path, symbolType, kind, stateMachine, children: [{ name,
 * path, type, kind, stateMachine }], truncated } or { path, error }. cache: a Map kept for the connection.
 */
async function browseSymbol(client, symbolPath, { stateVar = 'machineState', cache } = {}) {
  const info = await probe(client, symbolPath);
  if (!info) return { path: symbolPath, error: `${symbolPath} is not in the PLC` };
  const node = { path: symbolPath, symbolType: info.type, kind: symbolKind(info.type, info.size, info.dataType, null), stateMachine: false, children: [], truncated: false };
  const describe = async (name, childPath, type, size, dataType, bounds) => {
    const kind = symbolKind(type, size, dataType, bounds);
    const state = kind === 'struct' ? await stateInfo(client, type, stateVar, cache) : {};
    // stateType / stateNames: for the Machine Overview (state names of any machine the PLC describes)
    return { name, path: childPath, type, kind, stateMachine: !!state.stateType, ...state };
  };
  if (node.kind === 'array') {
    const dt = await dataTypeInfo(client, info.type, cache);
    const arr = arrayType(info.type) ?? (dt?.bounds?.length === 1 ? { low: dt.bounds[0].low, high: dt.bounds[0].low + dt.bounds[0].count - 1, element: dt.type } : null);
    if (!arr) return node;
    const element = await dataTypeInfo(client, arr.element, cache);
    const last = Math.min(arr.high, arr.low + MAX_ARRAY_CHILDREN - 1);
    node.truncated = last < arr.high;
    for (let i = arr.low; i <= last; i++) {
      node.children.push(await describe(`[${i}]`, `${symbolPath}[${i}]`, arr.element, element?.size ?? 0, element?.dataType ?? ADST_BIGTYPE, element?.bounds));
    }
    return node;
  }
  if (node.kind !== 'struct') return node;
  const dt = await dataTypeInfo(client, info.type, cache);
  const members = await membersOf(client, dt, cache);
  node.stateMachine = members.some((m) => m.name.toLowerCase() === stateVar.toLowerCase());
  if (node.stateMachine) Object.assign(node, await stateInfo(client, info.type, stateVar, cache));
  node.truncated = members.length > MAX_BROWSE_CHILDREN;
  for (const m of members.slice(0, MAX_BROWSE_CHILDREN)) {
    if (!/^[A-Za-z_]\w*$/.test(m.name)) continue;
    node.children.push(await describe(m.name, `${symbolPath}.${m.name}`, m.type, m.size, m.dataType, m.bounds));
  }
  return node;
}

/** Valid IEC symbol path (letters, digits, _, . , [index] and ^ for a pointer): nothing else is ever sent to the PLC */
const isSymbolPath = (text) => typeof text === 'string' && text.length <= 250 && /^[A-Za-z_][\w]*(\[-?\d+\]|\^)*(\.[A-Za-z_][\w]*(\[-?\d+\]|\^)*)*$/.test(text);

module.exports = {
  ADS_STATES,
  adsErrorText,
  decode,
  probe,
  createHandle,
  releaseHandle,
  readByHandle,
  subscribeHandle,
  isSimpleValue,
  decodeTyped,
  readTyped,
  subscribeTyped,
  discoverInstances,
  isSymbolPath,
  browseSymbol,
};

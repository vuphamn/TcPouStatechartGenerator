// Fake remote PLC speaking AMS/TCP with several typed symbols (BOOL, INT, REAL, STRING, ...), changed by a script.
// Usage: node fake-ams2.cjs <tcpPort> <config.json>
//   config: { symbols: { name: { type, dataType, size, value } }, script: [{ hold: ms, set: { name: value } }] }
const net = require('net');
const fs = require('fs');
const [, , tcpPortArg, configFile] = process.argv;
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const symbols = new Map(); // lower name -> { name, type, dataType, size, value, handle }
let nextHandle = 0x100;
for (const [name, s] of Object.entries(config.symbols)) symbols.set(name.toLowerCase(), { name, ...s, handle: nextHandle++ });
const byHandle = new Map([...symbols.values()].map((s) => [s.handle, s]));
const subs = new Map(); // notification id -> { sock, client, plc, sym }
let nextNotification = 1;
let scriptStarted = false;
const handlesGiven = new Set();
const released = [];

function encode(s) {
  const b = Buffer.alloc(s.size);
  const v = s.value;
  switch (s.dataType) {
    case 33: b.writeUInt8(v ? 1 : 0); break;
    case 16: b.writeInt8(v); break;
    case 17: b.writeUInt8(v); break;
    case 2: b.writeInt16LE(v); break;
    case 18: b.writeUInt16LE(v); break;
    case 3: b.writeInt32LE(v); break;
    case 19: b.writeUInt32LE(v); break;
    case 4: b.writeFloatLE(v); break;
    case 5: b.writeDoubleLE(v); break;
    case 30: b.write(String(v), 0, s.size - 1, 'latin1'); break;
    default: break;
  }
  return b;
}

function frame(targetNetId, targetPort, sourceNetId, sourcePort, cmd, flags, invokeId, data) {
  const ams = Buffer.alloc(32);
  targetNetId.copy(ams, 0);
  ams.writeUInt16LE(targetPort, 6);
  sourceNetId.copy(ams, 8);
  ams.writeUInt16LE(sourcePort, 14);
  ams.writeUInt16LE(cmd, 16);
  ams.writeUInt16LE(flags, 18);
  ams.writeUInt32LE(data.length, 20);
  ams.writeUInt32LE(0, 24);
  ams.writeUInt32LE(invokeId, 28);
  const tcp = Buffer.alloc(6);
  tcp.writeUInt32LE(32 + data.length, 2);
  return Buffer.concat([tcp, ams, data]);
}

function sendNotification(id) {
  const n = subs.get(id);
  if (!n) return;
  const value = encode(n.sym);
  const data = Buffer.alloc(4 + 4 + 8 + 4 + 4 + 4 + value.length);
  data.writeUInt32LE(data.length - 4, 0);
  data.writeUInt32LE(1, 4);
  data.writeBigUInt64LE(BigInt(Date.now()) * 10000n + 116444736000000000n, 8);
  data.writeUInt32LE(1, 16);
  data.writeUInt32LE(id, 20);
  data.writeUInt32LE(value.length, 24);
  value.copy(data, 28);
  n.sock.write(frame(n.client.netId, n.client.port, n.plc.netId, n.plc.port, 8, 0x0004, 0, data));
}

async function runScript() {
  if (scriptStarted) return;
  scriptStarted = true;
  for (const step of config.script || []) {
    await new Promise((r) => setTimeout(r, step.hold));
    for (const [name, v] of Object.entries(step.set || {})) {
      const s = symbols.get(name.toLowerCase());
      if (!s) continue;
      s.value = v;
      log('set', s.name, '=', v);
      for (const [id, n] of subs) if (n.sym === s) sendNotification(id);
    }
  }
  log('script done');
}

function handle(sock, f) {
  const target = { netId: f.subarray(0, 6), port: f.readUInt16LE(6) };
  const source = { netId: f.subarray(8, 14), port: f.readUInt16LE(14) };
  const cmd = f.readUInt16LE(16);
  const invokeId = f.readUInt32LE(28);
  const d = f.subarray(32);
  const reply = (data) => sock.write(frame(source.netId, source.port, target.netId, target.port, cmd, 0x0005, invokeId, data));
  const result = (code, rest = Buffer.alloc(0)) => {
    if (code && (cmd === 2 || cmd === 9) && rest.length === 0) rest = Buffer.alloc(4);
    const b = Buffer.alloc(4);
    b.writeUInt32LE(code);
    reply(Buffer.concat([b, rest]));
  };
  const withLength = (payload) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(payload.length);
    return Buffer.concat([b, payload]);
  };
  switch (cmd) {
    case 1: {
      const b = Buffer.alloc(20);
      b.writeUInt8(3, 0); b.writeUInt8(1, 1); b.writeUInt16LE(4026, 2); b.write('FakePlc2', 4, 'latin1');
      return result(0, b);
    }
    case 4: {
      const b = Buffer.alloc(4);
      b.writeUInt16LE(5, 0);
      return result(0, b);
    }
    case 9: {
      const ig = d.readUInt32LE(0);
      const writeLen = d.readUInt32LE(12);
      const name = d.toString('latin1', 16, 16 + writeLen).replace(/\0+$/, '');
      // Data type info by name (symbol browser): config.types = { name: { size, dataType, type, bounds, subItems } }
      if (ig === 0xf011) {
        const types = new Map(Object.entries(config.types || {}).map(([k, v]) => [k.toLowerCase(), { name: k, ...v }]));
        const P = { BOOL: [1, 33], INT: [2, 2], DINT: [4, 3], REAL: [4, 4], LREAL: [8, 5], UINT: [2, 18], BYTE: [1, 17] };
        const t = types.get(name.toLowerCase()) ?? (P[name.toUpperCase()] ? { name, size: P[name.toUpperCase()][0], dataType: P[name.toUpperCase()][1], type: '', subItems: [] } : null);
        if (!t) return result(0x710);
        const entry = (x) => {
          const n = Buffer.from(x.name, 'latin1'), ty = Buffer.from(x.type || '', 'latin1');
          const bounds = x.bounds || [];
          const subs = (x.subItems || []).map(entry);
          // An enum: enumValues { value: name } after the sub items (flag ENUMINFOS 0x2000), with an attribute before
          // them (flag ATTRIBUTES 0x1000) as TwinCAT writes {attribute 'qualified_only'}
          const enumEntries = Object.entries(x.enumValues || {});
          const extra = [];
          let flags = 0;
          if (enumEntries.length) {
            flags |= 0x1000 | 0x2000;
            const attr = Buffer.alloc(2); attr.writeUInt16LE(1);
            const an = Buffer.from('qualified_only', 'latin1');
            extra.push(attr, Buffer.from([an.length, 0]), an, Buffer.from([0]), Buffer.from([0]));
            const cnt = Buffer.alloc(2); cnt.writeUInt16LE(enumEntries.length);
            extra.push(cnt);
            for (const [value, name] of enumEntries) {
              const nm = Buffer.from(name, 'latin1');
              const v = Buffer.alloc(x.size || 2);
              if ((x.size || 2) === 1) v.writeInt8(Number(value)); else if ((x.size || 2) === 2) v.writeInt16LE(Number(value)); else v.writeInt32LE(Number(value));
              extra.push(Buffer.from([nm.length]), nm, Buffer.from([0]), v);
            }
          }
          const head = Buffer.alloc(42);
          const body = Buffer.concat([n, Buffer.from([0]), ty, Buffer.from([0]), Buffer.from([0]),
            ...bounds.map(([low, count]) => { const b = Buffer.alloc(8); b.writeInt32LE(low, 0); b.writeUInt32LE(count, 4); return b; }), ...subs, ...extra]);
          head.writeUInt32LE(42 + body.length, 0); head.writeUInt32LE(1, 4); head.writeUInt32LE(x.size || 0, 16); head.writeUInt32LE(x.dataType || 0, 24); head.writeUInt32LE(flags, 28);
          head.writeUInt16LE(n.length, 32); head.writeUInt16LE(ty.length, 34); head.writeUInt16LE(0, 36); head.writeUInt16LE(bounds.length, 38); head.writeUInt16LE(subs.length, 40);
          return Buffer.concat([head, body]);
        };
        return result(0, withLength(entry(t)));
      }
      const s = symbols.get(name.toLowerCase());
      if ((ig === 0xf003 || ig === 0xf009) && !s) {
        log('not found:', name);
        return result(0x710);
      }
      if (ig === 0xf003) {
        const h = Buffer.alloc(4);
        h.writeUInt32LE(s.handle);
        handlesGiven.add(s.handle);
        return result(0, withLength(h));
      }
      if (ig === 0xf009) {
        const n = Buffer.from(s.name, 'latin1');
        const t = Buffer.from(s.type, 'latin1');
        const e = Buffer.alloc(30 + n.length + 1 + t.length + 1 + 1);
        e.writeUInt32LE(e.length, 0); e.writeUInt32LE(0x4040, 4); e.writeUInt32LE(0x1000, 8); e.writeUInt32LE(s.size, 12); e.writeUInt32LE(s.dataType, 16);
        e.writeUInt16LE(n.length, 24); e.writeUInt16LE(t.length, 26);
        n.copy(e, 30); t.copy(e, 30 + n.length + 1);
        return result(0, withLength(e));
      }
      return result(0x701);
    }
    case 2: {
      const ig = d.readUInt32LE(0);
      const io = d.readUInt32LE(4);
      // Symbol table upload (instance discovery): config.upload = [{ name, type }] (no data types)
      if (ig === 0xf00f || ig === 0xf00b) {
        const entries = (config.upload || []).map(({ name, type }) => {
          const n = Buffer.from(name, "latin1"), t = Buffer.from(type, "latin1");
          const e = Buffer.alloc(30 + n.length + 1 + t.length + 1 + 1);
          e.writeUInt32LE(e.length, 0); e.writeUInt16LE(n.length, 24); e.writeUInt16LE(t.length, 26);
          n.copy(e, 30); t.copy(e, 30 + n.length + 1);
          return e;
        });
        const table = Buffer.concat(entries);
        if (ig === 0xf00b) return result(0, withLength(table));
        const info = Buffer.alloc(24);
        info.writeUInt32LE(entries.length, 0); info.writeUInt32LE(table.length, 4);
        return result(0, withLength(info));
      }
      if (ig !== 0xf005 || !byHandle.has(io)) return result(0x703);
      return result(0, withLength(encode(byHandle.get(io))));
    }
    case 3:
      if (d.readUInt32LE(0) === 0xf006) {
        const h = d.readUInt32LE(12);
        released.push(byHandle.get(h)?.name ?? h);
        log('release handle', byHandle.get(h)?.name ?? h);
      }
      return result(0);
    case 6: {
      const ig = d.readUInt32LE(0);
      const io = d.readUInt32LE(4);
      if (ig !== 0xf005 || !byHandle.has(io)) return result(0x703);
      const id = nextNotification++;
      const sym = byHandle.get(io);
      subs.set(id, { sock, client: source, plc: target, sym });
      log(`add notification ${id} for ${sym.name} (cycle ${d.readUInt32LE(20)})`);
      const h = Buffer.alloc(4);
      h.writeUInt32LE(id);
      result(0, h);
      setTimeout(() => sendNotification(id), 20);
      runScript();
      return;
    }
    case 7: {
      const id = d.readUInt32LE(0);
      log('delete notification', id, subs.get(id)?.sym.name);
      subs.delete(id);
      return result(0);
    }
    default:
      return result(0x701);
  }
}

net
  .createServer((sock) => {
    log('connection from', sock.remoteAddress);
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 6) {
        const tcpCmd = buf.readUInt16LE(0);
        const len = buf.readUInt32LE(2);
        if (buf.length < 6 + len) break;
        const f = buf.subarray(6, 6 + len);
        buf = buf.subarray(6 + len);
        if (tcpCmd === 0) handle(sock, f);
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      for (const [id, s] of subs) if (s.sock === sock) subs.delete(id);
      log('connection closed');
    });
  })
  .listen(Number(tcpPortArg), '127.0.0.1', () => log(`fake PLC 2 on 127.0.0.1:${tcpPortArg}, ${symbols.size} symbols`));

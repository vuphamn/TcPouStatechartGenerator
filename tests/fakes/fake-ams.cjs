// Fake remote PLC speaking AMS/TCP (like a PLC's router on TCP 48898): serves one INT symbol and changes it by a
// script. Frames from an AMS NetId without a "route" (allowNetId) get the connection closed, as a PLC does.
// Usage: node fake-ams.cjs <tcpPort> <symbol> <script "value:holdMs,..."> [allowNetId]
const net = require('net');
const [, , tcpPortArg, symbol, scriptArg, allowNetId] = process.argv;
const script = scriptArg.split(',').map((p) => p.split(':').map(Number));
const HANDLE = 0x4711;
const netIdText = (b) => [...b].join('.');
let value = 0;
const subs = new Map(); // notification handle -> { sock, client, plc }
let nextNotification = 1;
let scriptStarted = false;
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

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

// Symbol and data type tables (as TwinCAT uploads them) for instance discovery:
//   MAIN.mainStateMachine : Commander3 { smTableManager : SM_TableManager; smHinge : SM_HingeManager; nCount : INT }
//   SM_HingeManager EXTENDS SM_Base { smInner : SM_TableManager }, SM_Base { smFromBase : SM_TableManager }
//   GVL_Test.aTables : ARRAY [1..2] OF SM_TableManager, GVL_Test.cfg : ST_Cfg { aSpare : ARRAY [0..1] OF SM_TableManager }
const z = Buffer.from([0]);
function symEntry(name, type) {
  const body = Buffer.concat([Buffer.from(name, 'latin1'), z, Buffer.from(type, 'latin1'), z, z]);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(30 + body.length, 0);
  h.writeUInt16LE(name.length, 24);
  h.writeUInt16LE(type.length, 26);
  return Buffer.concat([h, body]);
}
function dtEntry(name, type, subs = [], bounds = []) {
  const arr = Buffer.alloc(bounds.length * 8);
  bounds.forEach((b, i) => { arr.writeInt32LE(b.low, i * 8); arr.writeUInt32LE(b.count, i * 8 + 4); });
  const body = Buffer.concat([Buffer.from(name, 'latin1'), z, Buffer.from(type, 'latin1'), z, z, arr, ...subs]);
  const h = Buffer.alloc(42);
  h.writeUInt32LE(42 + body.length, 0);
  h.writeUInt16LE(name.length, 32);
  h.writeUInt16LE(type.length, 34);
  h.writeUInt16LE(bounds.length, 38);
  h.writeUInt16LE(subs.length, 40);
  return Buffer.concat([h, body]);
}
const SYMBOLS = Buffer.concat([
  symEntry('MAIN.mainStateMachine', 'Commander3'),
  symEntry('MAIN.nCycles', 'UDINT'),
  symEntry('GVL_Test.aTables', 'ARRAY [1..2] OF SM_TableManager'),
  symEntry('GVL_Test.cfg', 'ST_Cfg'),
]);
const DATATYPES = Buffer.concat([
  dtEntry('Commander3', '', [dtEntry('smTableManager', 'SM_TableManager'), dtEntry('smHinge', 'SM_HingeManager'), dtEntry('nCount', 'INT')]),
  dtEntry('SM_HingeManager', 'SM_Base', [dtEntry('smInner', 'SM_TableManager')]),
  dtEntry('SM_Base', '', [dtEntry('smFromBase', 'SM_TableManager')]),
  dtEntry('SM_TableManager', '', [dtEntry('machineState', 'E_TableManager_States')]),
  dtEntry('ST_Cfg', '', [dtEntry('aSpare', 'ARRAY [0..1] OF SM_TableManager', [], [{ low: 0, count: 2 }])]),
]);

function sendNotification(id) {
  const s = subs.get(id);
  if (!s) return;
  const data = Buffer.alloc(4 + 4 + 8 + 4 + 4 + 4 + 2);
  data.writeUInt32LE(data.length - 4, 0);
  data.writeUInt32LE(1, 4); // stamps
  data.writeBigUInt64LE(BigInt(Date.now()) * 10000n + 116444736000000000n, 8); // FILETIME
  data.writeUInt32LE(1, 16); // samples
  data.writeUInt32LE(id, 20);
  data.writeUInt32LE(2, 24);
  data.writeInt16LE(value, 28);
  s.sock.write(frame(s.client.netId, s.client.port, s.plc.netId, s.plc.port, 8, 0x0004, 0, data));
}

async function runScript() {
  if (scriptStarted) return;
  scriptStarted = true;
  await new Promise((r) => setTimeout(r, 500));
  for (const [v, hold] of script) {
    value = v;
    log('value', v);
    for (const id of subs.keys()) sendNotification(id);
    await new Promise((r) => setTimeout(r, hold));
  }
  log('script done');
}

function handle(sock, f) {
  const target = { netId: f.subarray(0, 6), port: f.readUInt16LE(6) };
  const source = { netId: f.subarray(8, 14), port: f.readUInt16LE(14) };
  const cmd = f.readUInt16LE(16);
  const invokeId = f.readUInt32LE(28);
  const d = f.subarray(32);
  if (allowNetId && netIdText(source.netId) !== allowNetId) {
    log(`no route for ${netIdText(source.netId)}: closing`);
    sock.destroy();
    return;
  }
  const reply = (data) => sock.write(frame(source.netId, source.port, target.netId, target.port, cmd, 0x0005, invokeId, data));
  const result = (code, rest = Buffer.alloc(0)) => {
    // Read / ReadWrite replies always carry a length, also after an error (0)
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
    case 1: { // ReadDeviceInfo
      const b = Buffer.alloc(20);
      b.writeUInt8(3, 0); b.writeUInt8(1, 1); b.writeUInt16LE(4026, 2); b.write('FakePlc', 4, 'latin1');
      return result(0, b);
    }
    case 4: { // ReadState
      const b = Buffer.alloc(4);
      b.writeUInt16LE(5, 0);
      return result(0, b);
    }
    case 9: { // ReadWrite
      const ig = d.readUInt32LE(0);
      const writeLen = d.readUInt32LE(12);
      const name = d.toString('latin1', 16, 16 + writeLen).replace(/\0+$/, '');
      const match = name.toLowerCase() === symbol.toLowerCase();
      if ((ig === 0xf003 || ig === 0xf009) && !match) return result(0x710);
      if (ig === 0xf003) {
        const h = Buffer.alloc(4);
        h.writeUInt32LE(HANDLE);
        return result(0, withLength(h));
      }
      if (ig === 0xf009) {
        const n = Buffer.from(symbol, 'latin1');
        const t = Buffer.from('E_TableManager_States', 'latin1');
        const e = Buffer.alloc(30 + n.length + 1 + t.length + 1 + 1);
        e.writeUInt32LE(e.length, 0); e.writeUInt32LE(0x4040, 4); e.writeUInt32LE(0x1000, 8); e.writeUInt32LE(2, 12); e.writeUInt32LE(2, 16);
        e.writeUInt16LE(n.length, 24); e.writeUInt16LE(t.length, 26);
        n.copy(e, 30); t.copy(e, 30 + n.length + 1);
        return result(0, withLength(e));
      }
      return result(0x701);
    }
    case 2: { // Read
      const ig = d.readUInt32LE(0);
      const io = d.readUInt32LE(4);
      if (ig === 0xf00f) {
        const info = Buffer.alloc(24);
        info.writeUInt32LE(4, 0); info.writeUInt32LE(SYMBOLS.length, 4); info.writeUInt32LE(5, 8); info.writeUInt32LE(DATATYPES.length, 12);
        return result(0, withLength(info));
      }
      if (ig === 0xf00b) return result(0, withLength(SYMBOLS));
      if (ig === 0xf00e) return result(0, withLength(DATATYPES));
      if (ig !== 0xf005 || io !== HANDLE) return result(0x703);
      const v = Buffer.alloc(2);
      v.writeInt16LE(value);
      return result(0, withLength(v));
    }
    case 3: // Write (release handle)
      log(`write ig=0x${d.readUInt32LE(0).toString(16)} (release handle)`);
      return result(0);
    case 6: { // AddDeviceNotification
      const ig = d.readUInt32LE(0);
      const io = d.readUInt32LE(4);
      if (ig !== 0xf005 || io !== HANDLE) return result(0x703);
      const id = nextNotification++;
      subs.set(id, { sock, client: source, plc: target });
      log(`add notification ${id} from ${netIdText(source.netId)}:${source.port} (mode ${d.readUInt32LE(12)}, delay ${d.readUInt32LE(16)}, cycle ${d.readUInt32LE(20)})`);
      const h = Buffer.alloc(4);
      h.writeUInt32LE(id);
      result(0, h);
      setTimeout(() => sendNotification(id), 20);
      runScript();
      return;
    }
    case 7: // DeleteDeviceNotification
      subs.delete(d.readUInt32LE(0));
      log(`delete notification ${d.readUInt32LE(0)}`);
      return result(0);
    default:
      log('unhandled command', cmd);
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
        else log('AMS/TCP command', tcpCmd.toString(16));
      }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      for (const [id, s] of subs) if (s.sock === sock) subs.delete(id);
      log('connection closed');
    });
  })
  .listen(Number(tcpPortArg), '127.0.0.1', () => log(`fake PLC on 127.0.0.1:${tcpPortArg}, symbol ${symbol}${allowNetId ? `, route for ${allowNetId} only` : ''}`));

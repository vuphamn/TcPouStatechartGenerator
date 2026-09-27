// Fake TwinCAT device search (UDP, like a PLC on 48899): answers a search request as two devices. The first one's
// name holds markup, which the gateway's setup page must show as text.
// Usage: node fake-discovery.cjs <udpPort>
const dgram = require('dgram');
const port = Number(process.argv[2]);
const MAGIC = 0x71146603;

function tag(id, data) {
  const h = Buffer.alloc(4);
  h.writeUInt16LE(id, 0);
  h.writeUInt16LE(data.length, 2);
  return Buffer.concat([h, data]);
}
function reply(netId, name, build) {
  const head = Buffer.alloc(24);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(0, 4);
  head.writeUInt32LE(0x80000001, 8);
  Buffer.from(netId.split('.').map(Number)).copy(head, 12);
  head.writeUInt16LE(10000, 18);
  const tc = Buffer.from([3, 1, build & 255, build >> 8]);
  const osv = Buffer.alloc(20);
  osv.writeUInt32LE(20, 0); osv.writeUInt32LE(10, 4); osv.writeUInt32LE(0, 8); osv.writeUInt32LE(17763, 12); osv.writeUInt32LE(2, 16);
  const tags = [tag(5, Buffer.from(`${name}\0`, 'latin1')), tag(3, tc), tag(4, osv)];
  head.writeUInt32LE(tags.length, 20);
  return Buffer.concat([head, ...tags]);
}

// Add Route (service 6): accepted with Administrator / 1, else refused (0x704); status tag 1 in the reply
function addRouteReply(msg) {
  const tags = {};
  let p = 24;
  for (let i = 0; i < msg.readUInt32LE(20) && p + 4 <= msg.length; i++) {
    const id = msg.readUInt16LE(p);
    const len = msg.readUInt16LE(p + 2);
    tags[id] = msg.subarray(p + 4, p + 4 + len);
    p += 4 + len;
  }
  const text = (id) => (tags[id] ? tags[id].toString('latin1').replace(/\0+$/, '') : '');
  const ok = text(13) === 'Administrator' && text(2) === '1';
  console.log(`add route "${text(12)}" to ${tags[7] ? [...tags[7]].join('.') : '?'} at ${text(5)}: ${ok ? 'added' : 'refused'}`);
  const head = Buffer.alloc(24);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(0x80000006, 8);
  Buffer.from([127, 0, 0, 1, 1, 1]).copy(head, 12);
  head.writeUInt16LE(10000, 18);
  const status = Buffer.alloc(4);
  status.writeUInt32LE(ok ? 0 : 0x704);
  head.writeUInt32LE(1, 20);
  return Buffer.concat([head, tag(1, status)]);
}

const sock = dgram.createSocket('udp4');
sock.on('message', (msg, rinfo) => {
  if (msg.length >= 24 && msg.readUInt32LE(0) === MAGIC && msg.readUInt32LE(8) === 6) {
    sock.send(addRouteReply(msg), rinfo.port, rinfo.address);
    return;
  }
  if (msg.length < 24 || msg.readUInt32LE(0) !== MAGIC || msg.readUInt32LE(8) !== 1) return;
  console.log(`search from ${rinfo.address}:${rinfo.port}, sender ${[...msg.subarray(12, 18)].join('.')}`);
  sock.send(reply('127.0.0.1.1.1', 'CX-<b>202</b>', 4026), rinfo.port, rinfo.address);
  sock.send(reply('127.0.0.2.1.1', 'CX-203', 4024), rinfo.port, rinfo.address);
});
sock.bind(port, '127.0.0.1', () => console.log(`fake discovery on ${port}`));

// Exports (gateway/exports.cjs; an MQTT broker and a CMMS of this computer; simulated PLC symbols-plc.cjs): the REST/
// JSON API (a view-only token as its bearer; none: 401); MQTT (its user and password, the gateway online with its will
// offline, a recorded machine's state retained, a call's alert, a work order); the CMMS hook (a work order made posts
// its body, its id kept; done posts to its address with that id); the setup page's Exports (the password not shown).
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8524;
const MQTT = 8525;
const CMMS = 8526;
const BASE = `http://localhost:${PORT}`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const M = `${R}.aDoors[1]`;

(async () => {
  // The broker: its CONNECT (user, password, will), each PUBLISH (topic, payload, retained)
  const broker = { connect: null, published: [] };
  const mq = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let len = 0;
        let mult = 1;
        let i = 1;
        let byte;
        do {
          byte = buf[i++];
          len += (byte & 127) * mult;
          mult *= 128;
        } while (byte & 128 && i < buf.length);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4;
        const body = buf.subarray(i, i + len);
        const rd = (o) => [body.subarray(o + 2, o + 2 + body.readUInt16BE(o)).toString(), o + 2 + body.readUInt16BE(o)];
        if (type === 1) {
          const flags = body[7];
          let [clientId, o] = rd(10);
          let will = null;
          if (flags & 4) {
            const [t1, o1] = rd(o);
            const [m1, o2] = rd(o1);
            will = { topic: t1, message: m1, retain: !!(flags & 0x20) };
            o = o2;
          }
          const [user, o3] = flags & 0x80 ? rd(o) : [null, o];
          const [pass] = flags & 0x40 ? rd(o3) : [null];
          broker.connect = { clientId, will, user, pass };
          s.write(Buffer.from([0x20, 2, 0, 0]));
        } else if (type === 3) {
          const [topic, o] = rd(0);
          broker.published.push({ topic, payload: body.subarray(o).toString(), retain: !!(buf[0] & 1) });
        } else if (type === 12) s.write(Buffer.from([0xd0, 0]));
        buf = buf.subarray(i + len);
      }
    });
    s.on('error', () => {});
  }).listen(MQTT);
  // The CMMS: what it was sent
  const cmms = [];
  const cm = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      cmms.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: 'WO-77' } }));
    });
  }).listen(CMMS);
  const cfg = writeSymbolsPlc('fake-ams2-exports.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48974', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-exports');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 3', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48974', port: 851 }],
    tokens: [{ name: 'tech', sha256: sha('exp-tech') }, { name: 'erp', sha256: sha('exp-view'), view: true }],
    recordings: [{ id: 'r1', name: 'Doors', enabled: true, plc: 'line', root: R, stateVar: 'machineState', days: 7, machines: [M] }],
    mqtt: { url: `mqtt://127.0.0.1:${MQTT}`, username: 'gw', password: 'mq-secret', prefix: 'acme/plant' },
    cmms: { url: `http://127.0.0.1:${CMMS}/api/wo`, body: '{"description":"{title}","asset":"{machine}","priority":"{priority}"}', idPath: 'data.id', doneUrl: `http://127.0.0.1:${CMMS}/api/wo/{externalId}/complete`, doneMethod: 'PUT', doneBody: '{"remarks":"{rootCause}"}', headers: { 'Content-Type': 'application/json', Authorization: 'Basic cmms-key' } },
    workorders: { fromCalls: false },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-exports-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  const get = (p, token) =>
    new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `localhost:${PORT}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
        let t = '';
        res.on('data', (d) => (t += d));
        res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }));
      });
    });
  // 1. MQTT: connected; the machine's state (retained)
  const state = await h.until(() => broker.published.find((p) => p.topic === `acme/plant/line/state/MAIN/mainStateMachine/aDoors[1]` && /DOOR_DASHER_ENABLING/.test(p.payload)), 20000);
  const online = broker.published.find((p) => p.topic === 'acme/plant/gateway/status');
  expect(broker.connect?.user === 'gw' && broker.connect.pass === 'mq-secret' && broker.connect.will?.topic === 'acme/plant/gateway/status' && broker.connect.will.message === 'offline' && broker.connect.will.retain && online?.payload === 'online' && online.retain && state?.retain, `MQTT: as ${broker.connect?.user}, its will ${broker.connect?.will?.message}; ${online?.payload}; ${state?.topic} ${state?.payload}`);
  // 2. A call (an alert), a work order: to MQTT, to the CMMS
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: 'exp-tech' }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'callMaintenance', requestId: 1, plc: 'line', machine: M, reason: 'Electrical', note: 'S12' }));
  ws.send(JSON.stringify({ type: 'workCreate', requestId: 2, order: { title: 'Door 1 "S12" sensor', plc: 'line', machine: M, priority: 'high' } }));
  const order = (await h.until(() => got.find((m) => m.type === 'workResult' && m.requestId === 2), 5000))?.order;
  const alertMsg = await h.until(() => broker.published.find((p) => p.topic === 'acme/plant/line/alerts'), 8000);
  const made = await h.until(() => cmms.find((c) => c.url === '/api/wo'), 8000);
  expect(/calls maintenance/.test(JSON.parse(alertMsg?.payload ?? '{}').text ?? '') && broker.published.some((p) => p.topic === 'acme/plant/workorders' && /Door 1/.test(p.payload)), `MQTT: the call (${alertMsg?.topic}), the work order`);
  expect(made?.method === 'POST' && made.auth === 'Basic cmms-key' && JSON.parse(made.body).description === 'Door 1 "S12" sensor' && JSON.parse(made.body).asset === M, `the CMMS: made: ${made?.body}`);
  // (its id there kept first)
  await h.until(() => (/cmms: work order #\d+ made: sent \(its id there: WO-77\)/.test(fs.readFileSync(logFile, 'utf8')) ? true : null), 8000);
  ws.send(JSON.stringify({ type: 'workUpdate', requestId: 3, id: order?.id, change: { status: 'done', rootCause: 'Cable cut' } }));
  const done = await h.until(() => cmms.find((c) => /complete/.test(c.url)), 8000);
  expect(done?.method === 'PUT' && done.url === '/api/wo/WO-77/complete' && JSON.parse(done.body).remarks === 'Cable cut', `the CMMS: done: ${done?.method} ${done?.url} ${done?.body}`);
  ws.close();
  // 3. The REST/JSON API
  const none = await get('/api/v1/plcs');
  const plcsR = await get('/api/v1/plcs', 'exp-view');
  const alertsR = await get(`/api/v1/alerts?since=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`, 'exp-view');
  const ordersR = await get('/api/v1/workorders?status=done', 'exp-view');
  const index = await get('/api/v1', 'exp-view');
  const nope = await get('/api/v1/secrets', 'exp-view');
  expect(none.status === 401 && plcsR.status === 200 && plcsR.json[0].id === 'line' && plcsR.json[0].name === 'Line 3' && alertsR.json.some((e) => e.event === 'call') && ordersR.json[0]?.externalId === 'WO-77' && index.json.endpoints.length === 8 && nope.status === 404, `the API: none ${none.status}; plcs ${plcsR.json?.map((p) => p.name)}; ${alertsR.json?.length} alert(s) lately; a done work order, its id there ${ordersR.json?.[0]?.externalId}; ${index.json?.endpoints?.length} endpoints`);
  // 4. The setup page: the MQTT password not shown
  const ex = await get('/admin/api/exports');
  expect(ex.json?.mqtt?.password === undefined && ex.json.mqtt.hasPassword && ex.json.mqttReady === true && ex.json.cmms.idPath === 'data.id', 'the setup page: MQTT connected, its password not shown');
  gw.kill();
  plc.kill();
  mq.close();
  cm.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

const h = require('../lib/harness.cjs');
// Kval StateScope Link (the built exe) against fake-ams.cjs: pairing, host / input checks, a live session
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = __dirname;
const seq = JSON.parse(fs.readFileSync(path.join(h.FAKES, 'seq.json'), 'utf8'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const profile = path.join(h.OUT, 'link-appdata');
fs.mkdirSync(profile, { recursive: true });

function session(url, messages, headers = {}, waitMs = 2500) {
  return new Promise((resolve) => {
    const got = [];
    const ws = new WebSocket(url, { headers });
    ws.on('error', () => {});
    ws.on('unexpected-response', (req, res) => resolve({ status: res.statusCode, got }));
    ws.on('open', () => messages.forEach((m, i) => setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify(m)), i * 300)));
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    ws.on('close', (code) => resolve({ code, got }));
    setTimeout(() => { try { ws.close(1000); } catch {} resolve({ got }); }, waitMs);
  });
}

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48954', 'MAIN.mainStateMachine.smTableManager.machineState', seq.seq, '10.9.9.9.1.1'], { stdio: ['ignore', fs.openSync(path.join(h.OUT, 'fake-ams-link.txt'), 'w'), 'ignore'] });
  const out = fs.openSync(path.join(h.OUT, 'link-run.txt'), 'w');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48961'], { env: { ...process.env, APPDATA: profile }, stdio: ['ignore', out, out] });
  await sleep(2000);
  const banner = fs.readFileSync(path.join(h.OUT, 'link-run.txt'), 'utf8');
  const code = banner.match(/Pairing code:\s+(\S+)/)?.[1];
  expect(!!code && /^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(code), `exe started, pairing code shown (${code})`);
  expect(fs.existsSync(path.join(profile, 'KvalStateScope', 'link.json')), 'code kept in the profile');
  const URL_ = 'ws://127.0.0.1:48961/live';

  const page = await new Promise((r) => http.get('http://127.0.0.1:48961/', (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => r(b)); }));
  expect(/is running/.test(page), 'status page');
  const rebinding = await session(URL_, [], { Host: 'evil.example:48961' });
  expect(rebinding.status === 403, `foreign Host refused (${rebinding.status})`);
  const wrong = await session(URL_, [{ type: 'hello', token: 'AAAAA-BBBBB-CCCCC' }], { Origin: 'https://statescope.example' });
  expect(wrong.code === 4401 && wrong.got[0]?.type === 'denied', `wrong code refused (${wrong.code})`);
  const lower = code.toLowerCase().replace(/-/g, ' ');
  const bad = await session(URL_, [{ type: 'hello', token: lower }, { type: 'liveStart', netId: '127.0.0.1.1.1; rm', stateVar: 'machineState' }], { Origin: 'https://statescope.example' });
  expect(bad.got[0]?.type === 'welcome', 'code accepted in any case / spacing');
  expect(bad.got[1]?.state === 'error' && /Check the PLC address/.test(bad.got[1].message), 'a bad address is refused');

  const live = await session(URL_, [
    { type: 'hello', token: code },
    { type: 'liveStart', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48954', localNetId: '10.9.9.9.1.1', stateVar: 'machineState', typeName: 'SM_TableManager' },
  ], { Origin: 'https://statescope.example' }, seq.states.length * 700 + 4000);
  const connected = live.got.find((m) => m.state === 'connected');
  expect(connected && connected.instance === 'MAIN.mainStateMachine.smTableManager', `connected, instance from the PLC's tables: "${connected?.message}"`);
  const values = live.got.filter((m) => m.type === 'liveValues').flatMap((m) => m.events.map((e) => e.value)).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  const want = [0, ...seq.seq.split(',').map((p) => Number(p.split(':')[0]))].filter((v, i, a) => i === 0 || v !== a[i - 1]);
  expect(JSON.stringify(values) === JSON.stringify(want), `values incl. the 5 ms state: ${values.join(',')}`);
  await sleep(800);
  const plcLog = fs.readFileSync(path.join(h.OUT, 'fake-ams-link.txt'), 'utf8');
  expect(/delete notification/.test(plcLog) && /release handle/.test(plcLog), 'closing the page ends the session in the PLC');
  console.log(fs.readFileSync(path.join(h.OUT, 'link-run.txt'), 'utf8').split(/\r?\n/).map((l) => '   ' + l).join('\n'));
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

// The gateway's backup and restore (gateway/backup.cjs; simulated PLC symbols-plc.cjs): a backup made (a short
// passphrase refused), its file encrypted (no config text in it), downloaded; the gateway changed after (its PLC's name,
// a work order more); a restore with the wrong passphrase refused, then with its own: the files as they were, the
// state before kept, the PLC's name taken at once; a restart refused when it does not run as its task.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8527;
const BASE = `http://localhost:${PORT}`;
const PASS = 'correct horse battery';

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-backup.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48975', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-backup');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 5', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48975', port: 851 }],
    tokens: [{ name: 'sup', sha256: crypto.createHash('sha256').update('bk-sup').digest('hex') }],
    smtp: { host: 'mail.acme.com', port: 587, user: 'alerts', pass: 'sm-secret', from: 'a@acme.com' },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-backup-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  const api = (method, p, body, headers = {}) =>
    new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json', ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, buf, json: (() => { try { return JSON.parse(buf.toString()); } catch { return null; } })() });
        });
      });
      r.on('error', () => resolve({ status: 0 }));
      r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
    });
  // (a work order, before the backup)
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: 'bk-sup' }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'workCreate', requestId: 1, order: { title: 'Before the backup', plc: 'line' } }));
  await h.until(() => got.find((m) => m.type === 'workResult' && m.requestId === 1), 5000);
  // 1. A backup
  const short = await api('POST', '/admin/api/backup', { passphrase: 'short' });
  const made = await api('POST', '/admin/api/backup', { passphrase: PASS });
  const list = await api('GET', '/admin/api/backups');
  const file = await api('GET', `/admin/backup/${made.json?.name}`);
  expect(short.status >= 400 && /8 characters/.test(short.json?.error ?? '') && made.json?.files >= 2 && list.json?.backups?.[0]?.name === made.json.name && file.status === 200 && file.buf.subarray(0, 7).toString() === 'KVALBK1' && !file.buf.includes(Buffer.from('sm-secret')) && !file.buf.includes(Buffer.from('Line 5')), `a backup: ${made.json?.name}, ${made.json?.files} files, ${file.buf?.length} bytes, encrypted; a short passphrase refused`);
  // 2. The gateway changed after it
  ws.send(JSON.stringify({ type: 'workCreate', requestId: 2, order: { title: 'After the backup', plc: 'line' } }));
  await h.until(() => got.find((m) => m.type === 'workResult' && m.requestId === 2), 5000);
  ws.close();
  await h.sleep(300);
  const c2 = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  c2.plcs[0].name = 'Line 5 renamed';
  fs.writeFileSync(configPath, JSON.stringify(c2, null, 2));
  // 3. Restored: the wrong passphrase refused; its own
  const wrong = await api('POST', '/admin/restore', file.buf, { 'content-type': 'application/octet-stream', 'x-passphrase': encodeURIComponent('not the one') });
  const restored = await api('POST', '/admin/restore', file.buf, { 'content-type': 'application/octet-stream', 'x-passphrase': encodeURIComponent(PASS) });
  const orders = JSON.parse(fs.readFileSync(path.join(dir, 'workorders.json'), 'utf8'));
  const conf3 = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const befores = fs.readdirSync(path.join(dir, 'backups')).filter((n) => n.startsWith('before-restore-'));
  expect(wrong.status === 400 && /passphrase/.test(wrong.json?.error ?? '') && restored.json?.ok && restored.json.plcs.join() === 'Line 5' && conf3.plcs[0].name === 'Line 5' && conf3.smtp.pass === 'sm-secret' && JSON.stringify(orders).includes('Before the backup') && !JSON.stringify(orders).includes('After the backup') && befores.length === 1, `restored: ${restored.json?.files} files (PLCs ${restored.json?.plcs}); the wrong passphrase: ${wrong.json?.error}; the state before kept (${befores[0]})`);
  // (its PLC's name taken at once)
  const ws2 = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  const got2 = [];
  ws2.on('message', (d) => got2.push(JSON.parse(d.toString())));
  await new Promise((r) => ws2.on('open', r));
  ws2.send(JSON.stringify({ type: 'hello', token: 'bk-sup' }));
  const w2 = await h.until(() => got2.find((m) => m.type === 'welcome'), 5000);
  ws2.close();
  const restart = await api('POST', '/admin/api/restart', {});
  expect(w2?.plcs?.[0]?.name === 'Line 5' && restart.status >= 400 && /by hand/.test(restart.json?.error ?? ''), `taken at once: ${w2?.plcs?.[0]?.name}; a restart refused: ${restart.json?.error}`);
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

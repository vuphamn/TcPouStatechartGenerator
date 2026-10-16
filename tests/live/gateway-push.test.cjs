// Push notifications (gateway/push.cjs; a push service of this computer; simulated PLC symbols-plc.cjs; the web app from
// dist/): a device subscribed (its own keys, as a browser makes them) for calls; a call for maintenance pushed to it,
// signed (VAPID: its JWT verified with the gateway's public key, for that service) and encrypted (RFC 8291: decrypted
// here with the device's keys): its title, text and the board's address at that machine; a kind it did not choose not
// pushed; a device its service no longer knows (410) dropped; the board: its manifest and service worker served, the
// dialog.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8514;
const PUSH = 8515;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'push-test-token';
const M = `${R}.aDoors[2]`;
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

/** A device: its keys, as a browser makes them; a message to it decrypted (RFC 8291) */
const device = () => {
  const ecdh = crypto.createECDH('prime256v1');
  const pub = ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    keys: { p256dh: b64u(pub), auth: b64u(auth) },
    decrypt(body) {
      const salt = body.subarray(0, 16);
      const idlen = body[20];
      const asPublic = body.subarray(21, 21 + idlen);
      const data = body.subarray(21 + idlen);
      const shared = ecdh.computeSecret(asPublic);
      const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), pub, asPublic, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
      const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(data.subarray(data.length - 16));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
      return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString('utf8'));
    },
  };
};

(async () => {
  // The push service: what each device's address receives (one of them: gone)
  const received = [];
  const service = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      received.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(req.url.includes('gone') ? 410 : 201);
      res.end();
    });
  }).listen(PUSH);
  const cfg = writeSymbolsPlc('fake-ams2-push.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48965', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-push');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 4', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48965', port: 851 }],
    tokens: [{ name: 'tim', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    workorders: { fromCalls: false },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-push-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  let id = 0;
  const ask = async (msg, reply) => {
    const requestId = ++id;
    ws.send(JSON.stringify({ ...msg, requestId }));
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 15000);
  };
  // 1. Two devices: one for calls, one gone from its service; one not a subscription
  const info = await ask({ type: 'pushInfo' }, 'pushInfoResult');
  const phone = device();
  const old = device();
  const endpoint = `http://127.0.0.1:${PUSH}/push/phone`;
  const sub = await ask({ type: 'pushSubscribe', subscription: { endpoint, keys: phone.keys }, events: ['call'], plcs: ['line'], label: 'Android' }, 'pushResult');
  await ask({ type: 'pushSubscribe', subscription: { endpoint: `http://127.0.0.1:${PUSH}/push/gone`, keys: old.keys }, events: ['call'] }, 'pushResult');
  const bad = await ask({ type: 'pushSubscribe', subscription: { endpoint: 'http://example.com/x', keys: phone.keys } }, 'pushResult');
  const again = await ask({ type: 'pushInfo', endpoint }, 'pushInfoResult');
  expect(info?.enabled && unb64u(info.publicKey ?? '').length === 65 && sub?.ok && sub.events.join() === 'call' && bad?.ok === false && again?.sub?.events?.join() === 'call', `subscribed (${sub?.events}); not a subscription refused (${bad?.error}); the gateway's key ${info?.publicKey?.slice(0, 12)}…`);
  // 2. A call for maintenance: pushed, signed, encrypted
  await ask({ type: 'callMaintenance', plc: 'line', machine: M, reason: 'Electrical', note: 'S12 dark' }, 'callMaintenanceResult');
  const msg = await h.until(() => received.find((r) => r.path === '/push/phone'), 10000);
  const auth = /^vapid t=([^,]+), k=(\S+)$/.exec(msg?.headers?.authorization ?? '');
  const [hd, cl, sig] = (auth?.[1] ?? '..').split('.');
  const jwt = cl ? JSON.parse(unb64u(cl).toString()) : {};
  const pub = unb64u(info?.publicKey ?? '');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  const signed = !!sig && crypto.verify('sha256', Buffer.from(`${hd}.${cl}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(sig));
  expect(signed && auth[2] === info.publicKey && jwt.aud === `http://127.0.0.1:${PUSH}` && jwt.exp > Date.now() / 1000 && /^mailto:/.test(jwt.sub) && msg.headers['content-encoding'] === 'aes128gcm' && Number(msg.headers.ttl) > 0, `signed (VAPID): ${signed}, for ${jwt.aud}, until ${new Date(jwt.exp * 1000).toISOString()}`);
  let payload = null;
  try {
    payload = phone.decrypt(msg.body);
  } catch (e) {
    console.log(`   not decrypted: ${e.message}`);
  }
  expect(payload?.title === 'Line 4' && /calls maintenance/.test(payload.body) && /Electrical/.test(payload.body) && payload.url === `/?board&focus=${encodeURIComponent(`m:line|${M}`)}`, `encrypted for the device: ${JSON.stringify(payload)}`);
  // 3. The device gone: dropped; a kind not chosen: not pushed
  await h.until(() => (fs.readFileSync(logFile, 'utf8').includes('device(s) gone') ? true : null), 8000);
  const kept = JSON.parse(fs.readFileSync(path.join(dir, 'push.json'), 'utf8')).subs;
  const before = received.length;
  await ask({ type: 'workCreate', order: { title: 'Belt', plc: 'line' } }, 'workResult');
  await h.sleep(1500);
  expect(kept.length === 1 && kept[0].endpoint === endpoint && received.length === before, `the gone device dropped (${kept.length} kept); a work order not pushed (${received.length - before})`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'sw.js'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    // 4. The board as an app: its manifest and service worker; the dialog
    const man = await fetch(`${BASE}/manifest.webmanifest`);
    const manifest = await man.json().catch(() => null);
    const sw = await fetch(`${BASE}/sw.js`);
    expect(/manifest\+json/.test(man.headers.get('content-type') ?? '') && manifest?.start_url === '/?board' && manifest.icons.some((i) => i.sizes === '512x512') && /javascript/.test(sw.headers.get('content-type') ?? '') && /no-cache/.test(sw.headers.get('cache-control') ?? ''), `the manifest (${manifest?.name}) and the service worker served`);
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#board-push', { timeout: 20000 });
    await p.click('#board-push');
    const dlg = await h.until(() => p.evaluate(() => ({ on: !!document.querySelector('#push-on'), kinds: document.querySelectorAll('.push-kind').length, sw: !!navigator.serviceWorker?.controller || null })).then((x) => (x.on ? x : null)), 10000);
    // (its registration: done a moment after the page, on a slow machine)
    const reg = await h.until(() => p.evaluate(() => navigator.serviceWorker.getRegistration('/').then((r) => r?.active?.scriptURL ?? r?.installing?.scriptURL ?? r?.waiting?.scriptURL ?? null)), 15000);
    expect(dlg?.kinds === 12 && /\/sw\.js$/.test(reg ?? ''), `the dialog (${dlg?.kinds} kinds), the service worker registered: ${reg}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  service.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

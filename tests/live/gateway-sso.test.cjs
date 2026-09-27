// Gateway sign-in with company accounts (OpenID Connect, fake-oidc.cjs as the identity provider): the login round
// trip (PKCE, state, nonce, signed ID token), who may use it (e-mail domain), the session cookie, the live connection
// without a token (and none without the session), tokens turned off, sign-out. In a browser: the web app served by
// the gateway shows "Sign in", goes through the provider and back, signed in, and goes live on a simulated PLC.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8461;
const IDP = 48974;
const BASE = `http://localhost:${PORT}`;

// A request without following redirects, with the cookies given
const get = (url, { cookie, method = 'GET', headers = {} } = {}) =>
  new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...(cookie ? { cookie } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: e.message }));
    req.end();
  });
const hello = (m, cookie) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE, ...(cookie ? { cookie } : {}) } });
    ws.on('open', () => ws.send(JSON.stringify(m)));
    ws.on('message', (d) => { resolve(JSON.parse(d.toString())); ws.close(); });
    ws.on('error', () => resolve(null));
    setTimeout(() => resolve(null), 4000);
  });
const setUser = (who) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: IDP, path: '/next-user', method: 'POST' }, (res) => { res.resume(); res.on('end', resolve); });
  req.end(JSON.stringify(who));
});
/** The whole login in three hops: gateway -> provider -> gateway (its callback sets the cookie) */
async function login() {
  const a = await get(`${BASE}/auth/login?return=/`);
  const b = await get(a.headers.location);
  const c = await get(b.headers.location);
  return { a, b, c, cookie: (c.headers['set-cookie']?.[0] ?? '').split(';')[0] };
}

(async () => {
  const idp = spawn(process.execPath, [path.join(h.FAKES, 'fake-oidc.cjs'), String(IDP)], { stdio: ['ignore', fs.openSync(h.out('fake-oidc.txt'), 'w'), 'ignore'] });
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48976', 'MAIN.mainStateMachine.smTableManager.machineState', '1:10,2:10', '127.0.0.1.1.1'], { stdio: 'ignore' });
  const dir = h.out('gw-sso');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [],
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48976', port: 851 }],
    tokens: [{ name: 'old', sha256: require('crypto').createHash('sha256').update('secret-token').digest('hex') }],
    oidc: { issuer: `http://127.0.0.1:${IDP}`, clientId: 'kss-test', name: 'Kval (test)', allowedDomains: ['kval.test'] },
  }, null, 2));
  const logFile = h.out('gw-sso-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);
  await h.sleep(500);

  let me = JSON.parse((await get(`${BASE}/auth/me`)).text);
  expect(me.sso === true && me.user === null && me.provider === 'Kval (test)' && me.tokens === true, 'set up, nobody signed in, tokens accepted too');
  const { a, b, c, cookie } = await login();
  const auth = new URL(a.headers.location);
  expect(a.status === 302 && auth.origin === `http://127.0.0.1:${IDP}` && auth.searchParams.get('code_challenge_method') === 'S256' && !!auth.searchParams.get('nonce') && auth.searchParams.get('redirect_uri') === `${BASE}/auth/callback`, 'login: to the provider, with PKCE, state and nonce');
  expect(b.status === 302 && c.status === 302 && c.headers.location === '/' && /HttpOnly/.test(c.headers['set-cookie']?.[0] ?? '') && /SameSite=Lax/.test(c.headers['set-cookie']?.[0] ?? ''), 'back: a session cookie (HttpOnly, SameSite=Lax), then to the app');
  me = JSON.parse((await get(`${BASE}/auth/me`, { cookie })).text);
  expect(me.user === 'alice@kval.test' && me.name === 'Alice Tester', `signed in: ${me.user}`);
  const w = await hello({ type: 'hello', sso: true }, cookie);
  expect(w?.type === 'welcome' && w.user === 'alice@kval.test' && w.plcs[0]?.id === 'line202', `live connection without a token: ${w?.type} ${w?.user}`);
  expect((await hello({ type: 'hello', sso: true }))?.type === 'denied', 'without the session: denied');
  expect((await hello({ type: 'hello', token: 'secret-token' }))?.type === 'welcome', 'a token still works');

  // A replayed callback, and someone from another domain
  expect((await get(b.headers.location)).status === 400, 'the same callback again: refused (state used)');
  await setUser({ user: 'mallory@elsewhere.test', name: 'Mallory', groups: [] });
  const other = await login();
  expect(other.c.status === 403 && !other.c.headers['set-cookie'] && /may not use this gateway/.test(other.c.text), 'another domain: no access, no session');
  expect(/auth: mallory@elsewhere\.test signed in but may not use/.test(fs.readFileSync(logFile, 'utf8')), 'logged');
  await setUser({ user: 'alice@kval.test', name: 'Alice Tester', groups: ['g-operators'] });

  // Sign-out: only from the gateway's pages; then the session is gone
  expect((await get(`${BASE}/auth/logout`, { cookie, method: 'POST', headers: { origin: 'https://evil.example' } })).status === 403, 'sign-out from another site: refused');
  const out = await get(`${BASE}/auth/logout`, { cookie, method: 'POST', headers: { origin: BASE } });
  expect(out.status === 200 && /Max-Age=0/.test(out.headers['set-cookie']?.[0] ?? '') && JSON.parse((await get(`${BASE}/auth/me`, { cookie })).text).user === null, 'signed out: the session ends');

  // Tokens turned off (config change picked up)
  const conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  conf.oidc.tokens = false;
  fs.writeFileSync(configPath, JSON.stringify(conf, null, 2));
  await h.sleep(11000);
  const noToken = await hello({ type: 'hello', token: 'secret-token' });
  expect(noToken?.type === 'denied' && /sign in instead of a token/.test(noToken.message), `tokens off: ${noToken?.message}`);

  // In a browser: the web app from the gateway (the build in dist/)
  const built = fs.existsSync(path.join(h.REPO, 'dist', 'index.html')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('live-sso-signin'));
  if (!built) {
    console.log('skip the browser part: dist/ is an older build (npm run build)');
  } else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1500, height: 950 } });
    const p = await browser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/`, { waitUntil: 'load' });
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.click('#dock-tab-live');
    await p.waitForSelector('#live-sso-signin', { timeout: 8000 }).catch(() => {});
    expect(!!(await p.$('#live-sso-signin')) && !(await p.$('#live-token-input')), 'the app: "Sign in with Kval (test)", no token field (tokens off)');
    await Promise.all([p.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), p.click('#live-sso-signin')]);
    await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
    await p.click('#dock-tab-live');
    await p.waitForSelector('#live-sso-user', { timeout: 8000 }).catch(() => {});
    expect(/Signed in as Alice Tester/.test(await p.$eval('#live-sso-user', (e) => e.textContent).catch(() => '')), 'back in the app: signed in as Alice Tester');
    await p.evaluate(() => { const el = document.getElementById('live-instance-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'MAIN.mainStateMachine.smTableManager'); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.click('#live-start-btn');
    await p.waitForFunction(() => /Signed in as alice@kval\.test: choose a PLC|smTableManager\.machineState on Line 202/.test(document.getElementById('live-status')?.textContent || ''), { timeout: 15000 }).catch(() => {});
    const status = await p.$eval('#live-status', (e) => e.textContent);
    expect(/machineState on Line 202/.test(status), `live through the gateway, signed in: ${status}`);
    await p.screenshot({ path: h.out('gateway-sso.png') });
    expect(errors.length === 0, `no page errors ${errors.slice(0, 2).join(' | ')}`);
    await browser.close();
  }
  gw.kill();
  idp.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

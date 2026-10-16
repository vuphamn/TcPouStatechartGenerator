// Several gateways in one view (gateway/sites.cjs): a hub gateway follows another gateway (with its view-only token)
// and one whose token is not accepted; the hub's board's Sites page: the other's PLC, its machine in error, a link to
// its own board; the one refused, said why; the setup page's Other gateways (its token never shown).
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
const HUB = 8522;
const LINE = 8523;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-sites.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48973', cfg], { stdio: 'ignore' });
  const start = (name, conf) => {
    const dir = h.out(`gw-sites-${name}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000, drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false }, axes: { enabled: false }, ...conf }, null, 2));
    const logFile = h.out(`gw-sites-${name}-run.txt`);
    const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
    return { gw, logFile, configPath };
  };
  // The line's gateway: its PLC (aDoors[2] in its error state), a view-only token for the hub
  const line = start('line', { port: LINE, plcs: [{ id: 'l4', name: 'Line 4', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48973', port: 851 }], tokens: [{ name: 'hub', sha256: sha('sites-view'), view: true }] });
  await h.waitForText(line.logFile, /Setup page/);
  // The hub: no PLC of its own; the line's gateway, and one with a wrong token
  const hub = start('hub', {
    port: HUB, plcs: [], tokens: [{ name: 'mgr', sha256: sha('sites-mgr') }],
    sites: [{ id: 'line4', name: 'Line 4 gateway', url: `http://localhost:${LINE}`, token: 'sites-view' }, { id: 'bad', name: 'Wrong token', url: `http://localhost:${LINE}`, token: 'nope' }],
  });
  await h.waitForText(hub.logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${HUB}/live`, { headers: { origin: `http://localhost:${HUB}` } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: 'sites-mgr' }));
  const welcome = await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'sitesWatch' }));
  const st = await h.until(() => {
    const s = [...got].reverse().find((m) => m.type === 'sitesState')?.sites ?? [];
    const l4 = s.find((x) => x.id === 'line4');
    const bad = s.find((x) => x.id === 'bad');
    return l4?.plcs?.[0]?.error >= 1 && /not accepted/.test(bad?.message ?? '') ? s : null;
  }, 25000);
  const l4 = st?.find((x) => x.id === 'line4');
  const bad = st?.find((x) => x.id === 'bad');
  expect(welcome?.sites === 2 && l4?.state === 'connected' && l4.plcs[0].name === 'Line 4' && l4.plcs[0].error >= 1 && l4.url === `http://localhost:${LINE}` && bad?.state === 'error', `the sites: ${l4?.name} ${l4?.state}, ${l4?.plcs?.[0]?.name}: ${l4?.plcs?.[0]?.machines} machines, ${l4?.plcs?.[0]?.error} in error; ${bad?.name}: ${bad?.message}`);
  ws.close();
  // The setup page: its token not shown
  const shown = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: HUB, path: '/admin/api/sites', headers: { host: `localhost:${HUB}` } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve(JSON.parse(t)));
    });
  });
  expect(shown.sites.length === 2 && shown.sites.every((s) => s.token === undefined && s.hasToken) && shown.status.find((s) => s.id === 'line4')?.state === 'connected', 'the setup page: its gateways without their tokens, their state');

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('sites-board'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://localhost:${HUB}/?board&page=sites&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', 'sites-mgr');
    await p.keyboard.press('Enter');
    const card = await h.until(() => p.evaluate(() => {
      const c = document.querySelector('.site-card[data-site="line4"]');
      return c ? { text: c.textContent, link: c.querySelector('.site-open')?.getAttribute('href'), down: c.getAttribute('data-down'), tab: !!document.querySelector('#board-page-sites') } : null;
    }), 20000);
    expect(/Line 4 gateway/.test(card?.text ?? '') && card.link === `http://localhost:${LINE}/?board` && Number(card.down) >= 1 && card.tab, `the Sites page: ${JSON.stringify(card)}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  hub.gw.kill();
  line.gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

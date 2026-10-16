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
    port: HUB, plcs: [], tokens: [{ name: 'mgr', sha256: sha('sites-mgr') }], sitesDownAfterMin: 0.05, siteName: 'Plant hub',
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
  expect(typeof l4?.health?.freePct === 'number' && welcome?.sites === 2 && l4?.state === 'connected' && l4.plcs[0].name === 'Line 4' && l4.plcs[0].error >= 1 && l4.url === `http://localhost:${LINE}` && bad?.state === 'error', `the sites: ${l4?.name} ${l4?.state}, ${l4?.plcs?.[0]?.name}: ${l4?.plcs?.[0]?.machines} machines, ${l4?.plcs?.[0]?.error} in error, its disk ${Math.round(l4?.health?.freePct ?? -1)} % free; ${bad?.name}: ${bad?.message}`);
  // (the plant roll-up: the hub itself, the line's gateway with its summary (asked with its view-only token), one away)
  ws.send(JSON.stringify({ type: 'plantRollup', requestId: 7 }));
  const roll = await h.until(() => got.find((m) => m.type === 'plantRollupResult' && m.requestId === 7 && m.rows?.find((r) => r.id === 'line4')?.week ? m : null), 15000).catch(() => null)
    ?? (await (async () => { for (let i = 0; i < 10; i++) { ws.send(JSON.stringify({ type: 'plantRollup', requestId: 70 + i })); const r = await h.until(() => got.find((m) => m.type === 'plantRollupResult' && m.requestId === 70 + i), 5000); if (r?.rows?.find((x) => x.id === 'line4')?.week) return r; await h.sleep(1000); } return null; })());
  const rl4 = roll?.rows?.find((r) => r.id === 'line4');
  expect(roll?.rows?.length === 3 && roll.rows[0].self && roll.rows[0].name === 'Plant hub' && rl4?.name === 'Line 4 gateway' && rl4.week && typeof rl4.openAlerts === 'number' && roll.rows.find((r) => r.id === 'bad')?.away === true && typeof roll.total.openAlerts === 'number', `the plant roll-up: ${roll?.rows?.map((r) => `${r.name}${r.away ? ' (away)' : `: ${r.openAlerts} open`}`).join('; ')}`);
  ws.close();
  // (the weekly roll-up: sent now to its webhook)
  const posts = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { posts.push(JSON.parse(b)); } catch { posts.push(b); } res.writeHead(200); res.end('1'); }); });
  await new Promise((r) => hook.listen(8537, '127.0.0.1', r));
  const postJson = (p, body) => new Promise((resolve) => { const r = http.request({ host: '127.0.0.1', port: HUB, path: p, method: 'POST', headers: { host: `localhost:${HUB}`, origin: `http://localhost:${HUB}`, 'content-type': 'application/json' } }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch { return null; } })() })); }); r.end(JSON.stringify(body)); });
  const badMail = await postJson('/admin/api/plant', { plantReport: { to: 'not an address' } });
  await postJson('/admin/api/plant', { siteName: 'Plant hub', plantReport: { day: 'mon', at: '07:00', webhook: 'http://127.0.0.1:8537/plant', format: 'json' } });
  const sentNow = await postJson('/admin/api/plant/send', {});
  const weekly = await h.until(() => posts.find((p) => p.event === 'plant.weekly'), 8000);
  expect(badMail.status >= 400 && /Not an email address/.test(badMail.json?.error ?? '') && sentNow.json?.sent?.join() === 'webhook' && /Line 4 gateway: OEE/.test(weekly?.text ?? '') && /Wrong token: not answering/.test(weekly.text) && /The plant: OEE/.test(weekly.text), `the weekly roll-up sent now: ${sentNow.json?.sent}; ${(weekly?.text ?? '').split('\n')[0]}`);
  hook.close();
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
    const plantRows = await h.until(() => p.$$eval('#plant-rollup .plant-row', (x) => x.map((e) => e.getAttribute('data-site'))).then((x) => (x.length === 3 ? x : null)), 70000);
    expect(plantRows?.join() === 'self,line4,bad', `the Sites page's plant: ${plantRows?.join(', ')}`);
    expect(/Line 4 gateway/.test(card?.text ?? '') && card.link === `http://localhost:${LINE}/?board` && Number(card.down) >= 1 && card.tab, `the Sites page: ${JSON.stringify(card)}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  // (one that never answered as it should: told after its minutes; the line's gateway stopped: told; started again: back)
  const hubAlerts = async () => {
    const g = [];
    const w = new WebSocket(`ws://localhost:${HUB}/live`, { headers: { origin: `http://localhost:${HUB}` } });
    w.on('message', (d) => g.push(JSON.parse(d.toString())));
    await new Promise((r) => w.on('open', r));
    w.send(JSON.stringify({ type: 'hello', token: 'sites-mgr' }));
    await h.until(() => g.find((m) => m.type === 'welcome'), 5000);
    w.send(JSON.stringify({ type: 'alertsList' }));
    const ev = await h.until(() => g.find((m) => m.type === 'alertsList')?.events, 5000);
    w.close();
    return ev ?? [];
  };
  line.gw.kill();
  const away = await h.until(() => hubAlerts().then((ev) => (ev.some((e) => e.event === 'site' && /Line 4 gateway has not answered/.test(e.text)) ? ev : null)), 30000);
  const line2 = start('line', { port: LINE, plcs: [{ id: 'l4', name: 'Line 4', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48973', port: 851 }], tokens: [{ name: 'hub', sha256: sha('sites-view'), view: true }] });
  const backEv = await h.until(() => hubAlerts().then((ev) => (ev.some((e) => e.event === 'recovered' && /Line 4 gateway answers again/.test(e.text)) ? ev : null)), 40000);
  const awayOne = (backEv ?? away ?? []).find((e) => e.event === 'site' && /Line 4/.test(e.text));
  expect(!!away && (away ?? []).some((e) => e.event === 'site' && /Wrong token has not answered/.test(e.text)) && !!backEv && !!awayOne?.resolvedAt, `a gateway away: "${awayOne?.text}"; back: "${(backEv ?? []).find((e) => e.event === 'recovered')?.text}" (its alert resolved: ${!!awayOne?.resolvedAt})`);
  hub.gw.kill();
  line2.gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

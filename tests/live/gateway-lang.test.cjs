// The board's languages (src/utils/boardLang.ts, gateway/roles.cjs; simulated PLC symbols-plc.cjs; the web app from
// dist/): an operator's language Spanish by default, a technician's English; the operator's board in Spanish (its
// header, the Andon page); the header's EN / ES switches it, kept for that viewer; the setup page's Roles sets a role's.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8513;
const BASE = `http://localhost:${PORT}`;
const tok = (n) => `lang-${n}-token`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-lang.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48964', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-lang');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 8', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48964', port: 851 }],
    tokens: ['ann', 'tim'].map((n) => ({ name: n, sha256: sha(tok(n)) })),
    roles: { users: { ann: 'operator', tim: 'technician' }, groups: {}, default: '', startPages: {}, notify: [] },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-lang-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // 1. Each role's language, in its welcome
  const welcome = async (name) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: tok(name) }));
    const w = await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    ws.close();
    return w;
  };
  const wa = await welcome('ann');
  const wt = await welcome('tim');
  expect(wa?.lang === 'es' && wt?.lang === 'en', `the operator's language ${wa?.lang}, the technician's ${wt?.lang}`);

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-lang'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 2. The operator's board in Spanish: its header, the Andon page
    await p.goto(`${BASE}/?board&page=machines`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', tok('ann'));
    await p.keyboard.press('Enter');
    const es = await h.until(() => p.evaluate(() => ({ count: document.querySelector('#board-machine-count')?.textContent ?? '', lang: document.querySelector('#board-lang')?.textContent, html: document.documentElement.lang, filter: document.querySelector('#board-filter')?.getAttribute('placeholder') })).then((x) => (/máquinas/.test(x.count) ? x : null)), 20000);
    await p.click('#board-page-andon');
    const andon = await h.until(() => p.$eval('.andon-plc h2', (e) => e.textContent).catch(() => null).then((x) => (x && /En marcha|detenidas/.test(x) ? x : null)), 10000);
    expect(!!es && es.lang === 'ES' && es.html === 'es' && /Filtrar/.test(es.filter ?? '') && !!andon, `the operator's board in Spanish: "${es?.count}", ${es?.lang}, filter "${es?.filter}"; Andon "${andon}"`);
    // 3. EN / ES: switched, kept for this viewer
    await p.click('#board-lang');
    await p.click('#board-page-machines');
    const en = await h.until(() => p.$eval('#board-machine-count', (e) => e.textContent).then((x) => (/machines/.test(x ?? '') ? x : null)), 5000);
    await p.reload({ waitUntil: 'load' });
    const kept = await h.until(() => p.evaluate(() => ({ count: document.querySelector('#board-machine-count')?.textContent ?? '', lang: document.querySelector('#board-lang')?.textContent })).then((x) => (x.count ? x : null)), 20000);
    expect(!!en && kept?.lang === 'EN' && /machines/.test(kept.count), `switched to English ("${en}"), kept after a reload: ${kept?.lang} "${kept?.count}"`);
    // 4. The setup page: a role's language
    await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
    await p.waitForSelector('[data-lang-role="technician"]', { timeout: 10000 });
    const opDefault = await p.$eval('[data-lang-role="operator"]', (e) => e.value);
    await p.select('[data-lang-role="technician"]', 'es');
    await p.click('#admin-roles-save');
    const msg = await h.until(() => p.$eval('#admin-roles-msg', (e) => e.textContent).then((t) => (t ? t : null)), 5000);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')).roles;
    const wt2 = await welcome('tim');
    expect(opDefault === 'es' && saved?.languages?.technician === 'es' && saved.languages.operator === undefined && wt2?.lang === 'es', `the setup page: the operator's ${opDefault} by default; the technician's saved ${saved?.languages?.technician} (${msg}), in its welcome ${wt2?.lang}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

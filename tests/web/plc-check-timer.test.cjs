const h = require('../lib/harness.cjs');
// Browse's Check all on a timer (web edition, through Link): a remembered PLC checked (it answers), checked again by
// itself every few seconds (the interval set here for the test); the PLC stops: its row marked with the time it
// stopped answering, and the Live tab's Browse button says so while Browse is closed
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-checktimer.json');

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48976', cfg], { stdio: 'ignore' });
  const linkOut = path.join(h.OUT, 'link-checktimer-run.txt');
  const out = fs.openSync(linkOut, 'w');
  // (TwinCAT's search on a port nobody answers: this computer's own TwinCAT is not asked)
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48978'], { env: { ...process.env, APPDATA: path.join(h.OUT, 'link-checktimer-appdata'), KSS_DISCOVERY_PORT: '48977', KSS_DISCOVERY_BROADCAST: '0', KSS_LOCAL_TWINCAT_NETID: 'none' }, stdio: ['ignore', out, out] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const set = async (p, id, v) => {
    await p.waitForSelector(`#${id}`, { timeout: 10000 }).catch(() => {});
    return p.evaluate((id, v) => { const el = document.getElementById(id); if (!el) throw new Error(`no #${id}`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  };
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  // (the browser's notifications: a stand-in that records them)
  await a.evaluateOnNewDocument(() => {
    window.__notes = [];
    window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); } constructor(title, o) { window.__notes.push(title + ' | ' + (o?.body ?? '')); } };
  });
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  // A remembered PLC (the fake one, on its own port); Check all every 3 s (0.05 min)
  await a.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('kss.live.plcs', JSON.stringify([{ name: 'Fake line', netId: '127.0.0.2.1.1', ip: '127.0.0.1:48976', port: '851', localNetId: '', used: Date.now() }]));
    localStorage.setItem('kss.plcCheckEvery', '0.05');
    localStorage.setItem('kss.limits.notify', 'true');
  });
  await a.reload({ waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await a.click('#dock-tab-live');
  await sleep(400);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48978');
  await a.click('#live-plc-browse');
  await a.waitForSelector('#live-plc-browser', { timeout: 5000 }).catch(() => {});
  const row = '.live-plc-remembered[data-netid="127.0.0.2.1.1"] .live-plc-check-mark';
  await a.click('#live-plc-check-all').catch(() => {});
  // (read as it is marked: the timer checks it again every 3 s, "Checking…" meanwhile)
  const first = await a.waitForFunction((sel) => {
    const e = document.querySelector(sel);
    return e?.getAttribute('data-ok') === 'true' ? e.getAttribute('data-ok') + '|' + e.getAttribute('title') : false;
  }, { timeout: 30000, polling: 100 }, row).then((x) => x.jsonValue()).catch(() => '');
  const every = await a.$eval('#live-plc-check-every', (e) => e.value).catch(() => '');
  expect(/^true\|/.test(first) && every === '0.05', `checked: it answers ("${first.slice(0, 80)}"), again every ${every} min`);

  // The PLC stops answering: the next check (by itself) marks it; Browse closed, its button says so
  plc.kill();
  // (read as it is marked: the timer checks it again every 3 s, "Checking…" meanwhile)
  const lost = await a.waitForFunction((sel) => {
    const e = document.querySelector(sel);
    return e?.getAttribute('data-lost') === 'true' && e.getAttribute('data-ok') === 'false' ? e.getAttribute('data-ok') + '|' + e.textContent + '|' + e.getAttribute('title') : false;
  }, { timeout: 40000, polling: 100 }, row).then((x) => x.jsonValue()).catch(() => '');
  expect(/^false\|✗since \d{1,2}:\d{2}/.test(lost) && /Stopped answering at /.test(lost), `stopped answering: "${lost.slice(0, 100)}"`);
  await a.click('#live-plc-browser-close').catch(() => {});
  await sleep(300);
  const badge = await a.$eval('#live-plc-lost', (e) => e.textContent + '|' + e.getAttribute('title')).catch(() => '');
  expect(/^1 down\|Stopped answering: Fake line/.test(badge), `Browse closed, its button: "${badge.slice(0, 80)}"`);
  const notes = await a.evaluate(() => window.__notes);
  expect(notes.length === 1 && /^Kval MachineScope: Fake line stopped answering \| Since /.test(notes[0]), `Notify on: a notification (${notes.join(' / ') || 'none'})`);
  await a.screenshot({ path: h.out('plc-check-timer.png') });

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close().catch(() => {});
  link.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

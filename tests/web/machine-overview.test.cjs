// Machine Overview (web edition through Link, simulated PLC with data types): every state machine under
// MAIN.mainStateMachine with its state (names from the PLC's enums or the loaded .TcDUT), errors, changes, filters,
// Watch, and the not-connected state
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const sleep = h.sleep;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-overview.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48965', cfg], { stdio: ['ignore', fs.openSync(h.out('fake-ams2-overview.txt'), 'w'), 'ignore'] });
  const linkOut = h.out('link-overview-run.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48966'], { env: { ...process.env, APPDATA: h.out('link-appdata') }, stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const browser = await h.launchBrowser();
  const errors = [];
  const set = (p, id, v) => p.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  const a = await browser.newPage();
  a.on('pageerror', (e) => errors.push(e.message));
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });

  // Before going live: the tab says so
  await a.evaluate(() => document.getElementById('dock-tab-overview')?.click());
  await sleep(300);
  expect(/Go live/.test(await a.$eval('#machine-overview', (e) => e.innerText).catch(() => '')), 'not live: the tab asks to go live');

  // Live through Link, following smTable1 (the Table Manager sample: its .TcDUT names SM_TableManager's states)
  await a.click('#dock-tab-live');
  await sleep(300);
  await set(a, 'live-token-input', code);
  await set(a, 'live-link-port-input', '48966');
  await set(a, 'live-netid-input', '127.0.0.1.1.1');
  await set(a, 'live-ip-input', '127.0.0.1:48965');
  await set(a, 'live-instance-input', `${R}.smTable1`);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-overview-btn', { timeout: 20000 }).catch(() => {});
  expect(!!(await a.$('#live-overview-btn')), 'Overview button once connected');
  await a.click('#live-overview-btn');
  const rows = async () => a.$$eval('.overview-row', (r) => r.map((x) => ({ path: x.getAttribute('data-path'), error: x.getAttribute('data-error') === 'true', state: x.querySelector('.overview-state').textContent.trim(), time: x.querySelector('.overview-time').textContent.trim(), changes: x.querySelector('.overview-changes').textContent.trim(), text: x.textContent })));
  let list = [];
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    list = await rows();
    if (list.length >= 5 && list.every((r) => r.state !== '…')) break;
  }
  const by = (p) => list.find((r) => r.path === `${R}${p}`);
  expect(list.length === 5, `5 machines found: ${list.map((r) => r.path.replace(R, '') || '(root)').join(', ')}`);
  expect(by('')?.state === 'MAIN_RUNNING' && by('.aDoors[1]')?.state === 'DOOR_DASHER_DISABLED', `names from the PLC's enums: root ${by('')?.state}, aDoors[1] ${by('.aDoors[1]')?.state}`);
  expect(by('.smTable1')?.state === 'TABLEMANAGER_HOMMING_READY_TO_START' && by('.smTable2')?.state === 'TABLEMANAGER_HOMMING', `names from the loaded .TcDUT: ${by('.smTable1')?.state}, ${by('.smTable2')?.state}`);
  expect(by('.aDoors[2]')?.error && /DOOR_DASHER_ERROR/.test(by('.aDoors[2]')?.state) && !by('.smTable1')?.error, 'the error state stands out');
  const summary = await a.$eval('#overview-summary', (e) => e.textContent);
  expect(/5 machines/.test(summary) && /1 in error/.test(summary), `summary: "${summary.trim()}"`);
  expect(/this tab/.test(by('.smTable1')?.text ?? ''), 'the machine this tab follows is marked');
  expect(/^≥ /.test(by('.smTable2')?.time ?? ''), `time in state before a change: "${by('.smTable2')?.time}" (at least)`);
  await a.screenshot({ path: h.out('machine-overview.png') });

  // aDoors[1] changes state (after 3 s): the change is counted, its time starts again
  for (let i = 0; i < 40 && by('.aDoors[1]')?.state !== 'DOOR_DASHER_ENABLING'; i++) {
    await sleep(250);
    list = await rows();
  }
  expect(by('.aDoors[1]')?.state === 'DOOR_DASHER_ENABLING' && by('.aDoors[1]')?.changes === '1' && !/^≥/.test(by('.aDoors[1]')?.time ?? '≥'), `a change: ${by('.aDoors[1]')?.state}, ${by('.aDoors[1]')?.changes} change, in state ${by('.aDoors[1]')?.time}`);

  // Errors only, filter, sort
  await a.click('#overview-errors-only');
  await sleep(200);
  list = await rows();
  expect(list.length === 1 && list[0].path === `${R}.aDoors[2]`, `errors only: ${list.map((r) => r.path).join(', ')}`);
  await a.click('#overview-errors-only');
  await set(a, 'overview-filter', 'TableManager');
  await sleep(200);
  list = await rows();
  expect(list.length === 2, `filter "TableManager": ${list.length} machines`);
  await set(a, 'overview-filter', '');
  await a.select('#overview-sort', 'state');
  await sleep(200);
  list = await rows();
  expect(list[0]?.path === `${R}.aDoors[2]`, `errors first: ${list[0]?.path}`);

  // Watch smTable2 (this POU's type): a new tab live on it
  await a.evaluate((p) => document.querySelector(`.overview-row[data-path="${p}"] .overview-watch`).click(), `${R}.smTable2`);
  let b = null;
  for (let i = 0; i < 40 && !b; i++) {
    await sleep(300);
    b = (await browser.pages()).find((p) => p !== a && p.url().startsWith(h.APP_ORIGIN));
  }
  let title = '';
  for (let i = 0; i < 60 && b && !/smTable2/.test(title); i++) {
    await sleep(250);
    title = await b.title();
  }
  expect(/SM_TableManager \(MAIN\.mainStateMachine\.smTable2\)/.test(title), `Watch: a new tab "${title}"`);

  // Stop: the overview stops following
  await a.bringToFront();
  await a.click('#dock-tab-live');
  await a.click('#live-stop-btn');
  await sleep(500);
  await a.click('#dock-tab-overview');
  await sleep(300);
  expect(/Go live/.test(await a.$eval('#machine-overview', (e) => e.innerText)), 'stopped: back to "go live"');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

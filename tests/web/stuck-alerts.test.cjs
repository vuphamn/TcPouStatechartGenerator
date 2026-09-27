// Stuck-state alerts (web edition through Link, simulated PLC): a state's time limit set from the canvas menu;
// over it the Live tab says STUCK, the canvas node turns red, the Machine Overview flags and counts the machine
// (Problems only), a default limit applies to the other states, Notify shows one notification per machine
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const sleep = h.sleep;
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-stuck.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48969', cfg], { stdio: 'ignore' });
  const linkOut = h.out('link-stuck-run.txt');
  const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48970'], { env: { ...process.env, APPDATA: h.out('link-appdata') }, stdio: ['ignore', fs.openSync(linkOut, 'w'), fs.openSync(linkOut, 'a')] });
  const code = (await h.waitForText(linkOut, /Pairing code:\s+(\S+)/))?.[1];
  if (!code) throw new Error('Link did not start (no pairing code)');

  const browser = await h.launchBrowser();
  const a = await browser.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(e.message));
  // Notifications are recorded, not shown
  await a.evaluateOnNewDocument(() => {
    window.__notes = [];
    window.Notification = function (title, o) { window.__notes.push({ title, body: o && o.body, tag: o && o.tag }); };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = () => Promise.resolve('granted');
  });
  const set = (id, v) => a.evaluate((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
  await a.goto(h.APP_URL, { waitUntil: 'load' });
  await a.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await sleep(600);

  // The canvas menu: a limit for TABLEMANAGER_HOMMING_READY_TO_START (smTable1's state) and TABLEMANAGER_HOMMING (smTable2's)
  const setLimitFromMenu = async (state, text) => {
    await a.click('#dock-tab-diagram');
    await sleep(300);
    const p = await a.evaluate((id) => {
      const n = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`);
      n.scrollIntoView?.({ block: 'center', inline: 'center' });
      const r = n.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, state);
    await a.mouse.click(p.x, p.y, { button: 'right' });
    await sleep(400);
    const found = await a.evaluate(() => { const b = document.getElementById('context-menu-time-limit-btn'); b?.click(); return !!b; });
    await a.waitForSelector('#text-prompt-input', { timeout: 5000 }).catch(() => {});
    await a.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.select(); });
    await a.keyboard.press('Backspace');
    if (text) await a.keyboard.type(text);
    await a.keyboard.press('Enter');
    await sleep(300);
    return found;
  };
  expect(await setLimitFromMenu('TABLEMANAGER_HOMMING_READY_TO_START', '2 s'), 'the state menu has Time limit…');
  await setLimitFromMenu('TABLEMANAGER_HOMMING', '2');
  const stored = await a.evaluate(() => JSON.parse(localStorage.getItem('kss.limits.sm_tablemanager') || '{}'));
  expect(stored.TABLEMANAGER_HOMMING_READY_TO_START === 2000 && stored.TABLEMANAGER_HOMMING === 2000, `limits kept per POU type: ${JSON.stringify(stored)}`);

  // Live on smTable1 (HOMMING_READY_TO_START, which does not change)
  await a.click('#dock-tab-live');
  await sleep(300);
  await set('live-token-input', code);
  await set('live-link-port-input', '48970');
  await set('live-netid-input', '127.0.0.1.1.1');
  await set('live-ip-input', '127.0.0.1:48969');
  await set('live-instance-input', `${R}.smTable1`);
  await a.click('#live-guards-off').catch(() => {});
  await a.click('#live-start-btn');
  await a.waitForSelector('#live-current-state', { timeout: 20000 });
  expect(!(await a.$('#live-stuck')), 'within its limit: not stuck');
  expect(/\/ 2 s/.test(await a.$eval('#live-time-in-state', (e) => e.textContent)), 'the Live tab shows the limit');
  await a.click('#live-notify');
  await a.waitForSelector('#live-stuck', { timeout: 8000 }).catch(() => {});
  expect(!!(await a.$('#live-stuck')) && /text-rose-300/.test(await a.$eval('#live-time-in-state', (e) => e.className)), 'over the limit: STUCK, the time in red');
  await a.waitForSelector('#mermaid-canvas-area g.node.live-stuck-node[data-state-id="TABLEMANAGER_HOMMING_READY_TO_START"]', { timeout: 3000 }).catch(() => {});
  expect(await a.evaluate(() => !!document.querySelector('#mermaid-canvas-area g.node.live-stuck-node[data-state-id="TABLEMANAGER_HOMMING_READY_TO_START"]')), 'the canvas node turns red');

  // The Machine Overview: smTable1 and smTable2 stuck; with a default limit, the others too (not the error one)
  await a.click('#live-overview-btn');
  const rows = () => a.$$eval('.overview-row', (r) => r.map((x) => ({ path: x.getAttribute('data-path'), stuck: x.getAttribute('data-stuck') === 'true', error: x.getAttribute('data-error') === 'true' })));
  let list = [];
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    list = await rows();
    if (list.filter((r) => r.stuck).length >= 2) break;
  }
  const stuckOf = (l) => l.filter((r) => r.stuck).map((r) => r.path.replace(R, '')).sort().join(', ');
  expect(stuckOf(list) === '.smTable1, .smTable2', `stuck in the overview: ${stuckOf(list)}`);
  expect(/2 stuck/.test(await a.$eval('#overview-stuck-count', (e) => e.textContent).catch(() => '')), 'the header counts them');
  await a.click('#dock-tab-live');
  await sleep(200);
  await a.click('#live-default-limit', { clickCount: 3 });
  await a.keyboard.type('1 s');
  await a.keyboard.press('Enter');
  await a.click('#dock-tab-overview');
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    list = await rows();
    if (list.filter((r) => r.stuck).length >= 4) break;
  }
  const stuckNow = list.filter((r) => r.stuck).map((r) => r.path.replace(R, '') || '(root)').sort();
  expect(stuckNow.length === 4 && !list.find((r) => r.path === `${R}.aDoors[2]`).stuck, `default 1 s: ${stuckNow.join(', ')} stuck; the error state is not counted as stuck`);
  await a.click('#overview-errors-only');
  await sleep(200);
  list = await rows();
  expect(list.length === 5 && list.every((r) => r.stuck || r.error), `Problems only: ${list.length} (stuck and error)`);
  await a.click('#overview-errors-only');
  await a.screenshot({ path: h.out('stuck-alerts.png') });

  // Notifications: one per machine
  const notes = await a.evaluate(() => window.__notes);
  const tags = notes.map((n) => n.tag);
  expect(notes.length >= 4 && new Set(tags).size === tags.length && notes.every((n) => /is stuck/.test(n.title)), `notifications: ${notes.map((n) => n.title.replace('Kval StateScope: ', '')).join(' | ')}`);

  // Clearing a limit: back to the default (1 s: still stuck); clearing the default too: not stuck
  await setLimitFromMenu('TABLEMANAGER_HOMMING_READY_TO_START', '');
  await a.click('#dock-tab-live');
  await sleep(200);
  await a.click('#live-default-limit', { clickCount: 3 });
  await a.keyboard.press('Backspace');
  await a.keyboard.press('Enter');
  await sleep(800);
  expect(!(await a.$('#live-stuck')) && !(await a.evaluate(() => !!document.querySelector('#mermaid-canvas-area g.node.live-stuck-node'))), 'limits cleared: not stuck');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  link.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

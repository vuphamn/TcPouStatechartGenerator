// Offline simulation (Simulation tab): start in a state, its transitions in priority order with their conditions'
// results, set a value (TRUE) and Step, Back, Take another, Stop; the canvas marks the simulated state
const h = require('../lib/harness.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  const current = () => p.$eval('#sim-current', (e) => e.textContent.trim()).catch(() => '');
  const marked = () => p.evaluate(() => [...document.querySelectorAll('#mermaid-canvas-area g.node.live-active-node')].map((n) => n.getAttribute('data-state-id')));
  const rows = () => p.$$eval('#simulation-panel li', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));

  await p.click('#dock-tab-simulate');
  await p.waitForSelector('#sim-start', { timeout: 5000 });
  await p.select('#sim-start-state', S('CLAMPED'));
  await p.click('#sim-start');
  await h.sleep(1200);
  expect((await current()) === S('CLAMPED'), `started in ${await current()}`);
  expect((await marked()).join() === S('CLAMPED'), `the canvas marks it: ${(await marked()).join()}`);
  let list = await rows();
  // (preProcess()'s transitions to ERROR apply to it too: first, as preProcess() runs first)
  const pre = list.filter((l) => /Take$/.test(l) && /^pre/.test(l));
  const out = list.filter((l) => /Take$/.test(l) && !/^pre/.test(l));
  expect(pre.length === 2 && pre.every((l) => /TABLEMANAGER_ERROR/.test(l) && /UNKNOWN/.test(l)), `preProcess()'s first: ${pre.join(' | ')}`);
  expect(out.length === 2 && /→ TABLEMANAGER_UNCLAMP_START/.test(out[0]) && /→ TABLEMANAGER_REFEED_START/.test(out[1]) && out.every((l) => /UNKNOWN/.test(l)), `its transitions, in priority order: ${out.join(' | ')}`);
  expect(await p.$eval('#sim-step', (e) => e.disabled), 'Step is off while no condition holds');

  // cmd_bUnclamp TRUE: the first holds; Step
  await p.evaluate(() => document.getElementById('sim-var-cmd_bUnclamp-true').click());
  await h.sleep(400);
  list = (await rows()).filter((l) => /Take$/.test(l) && !/^pre/.test(l));
  expect(/TRUE/.test(list[0]), `with cmd_bUnclamp = TRUE: ${list[0]}`);
  await p.evaluate(() => document.getElementById('sim-step').click());
  await h.sleep(800);
  expect((await current()) === S('UNCLAMP_START'), `Step: ${await current()}`);
  expect((await marked()).join() === S('UNCLAMP_START'), 'the canvas follows');
  expect((await p.$eval('#sim-history', (e) => e.innerText)).includes(`${S('CLAMPED')} → ${S('UNCLAMP_START')}`), 'the step is listed');

  // Back, then take the other one
  await p.evaluate(() => document.getElementById('sim-back').click());
  await h.sleep(600);
  expect((await current()) === S('CLAMPED'), `Back: ${await current()}`);
  await p.evaluate(() => document.getElementById('sim-take-3').click());
  await h.sleep(600);
  expect((await current()) === S('REFEED_START'), `Take the second: ${await current()}`);

  // Stop: no mark
  await p.evaluate(() => document.getElementById('sim-stop').click());
  await h.sleep(800);
  expect((await marked()).length === 0 && !!(await p.$('#sim-start')), 'Stop: the canvas unmarked');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

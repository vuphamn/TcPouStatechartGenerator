const h = require('../lib/harness.cjs');
// Pause on state (the Live tab): CLAMPED chosen (kept for the POU); live (XAE stand-in bridge), the view holds where
// the PLC entered CLAMPED, the samples after it kept (not shown) until Resume shows them and goes on; entered again:
// held again; a replay stops at CLAMPED's entry and Play goes on to the end; the choice removed
const fs = require('fs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const lv = await import('/src/utils/liveView.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  await p.exposeFunction('__hostPost', async (m) => {
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\\\proj\\\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('HOMMING')}"]`, { timeout: 60000 });
  await h.sleep(800);
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await p.waitForSelector('#live-pause-on-add', { timeout: 10000 }).catch(() => {});

  // 1. CLAMPED chosen: a chip, kept for the POU
  await p.select('#live-pause-on-add', S('CLAMPED'));
  await h.sleep(300);
  const chips = () => p.$$eval('.live-pause-chip', (c) => c.map((x) => x.getAttribute('data-state')));
  const kept = await p.evaluate(() => localStorage.getItem('kss.pauseOn|sm_tablemanager'));
  expect(JSON.stringify(await chips()) === JSON.stringify([S('CLAMPED')]) && kept === JSON.stringify([S('CLAMPED')]), `Pause on: ${await chips()} (kept: ${kept})`);

  // 2. Live: held where the PLC entered CLAMPED; what came after it not shown yet
  await p.click('#live-start-btn');
  await h.sleep(600);
  const t0 = Date.UTC(2026, 8, 20, 22, 0, 0);
  const send = (states, from) => toApp({ type: 'liveValues', events: states.map((s, i) => ({ t: t0 + (from + i) * 10000, value: sample.values[S(s)] })) });
  await send(['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED', 'REFEED_START', 'CLAMPED'], 0);
  const banner = await h.until(() => p.$eval('#live-hold-banner', (e) => e.textContent).catch(() => null), 5000);
  const rows = () => p.$$eval('.live-trail-row', (r) => r.length);
  const current = () => p.$eval('#live-current-state', (e) => e.textContent.trim().split(/\s+/)[0]).catch(() => '');
  expect(/entered TABLEMANAGER_CLAMPED/.test(banner ?? '') && (await rows()) === 2 && (await current()) === S('CLAMPED'), `held at CLAMPED: ${banner?.trim().slice(0, 80)}; ${await rows()} transitions, in ${await current()}`);
  await send(['UNCLAMP_START'], 5);
  await h.sleep(500);
  expect((await rows()) === 2 && (await current()) === S('CLAMPED'), `still held while the PLC goes on (${await rows()} transitions, in ${await current()})`);

  // 3. Resume: what came since shown (not held again at the second CLAMPED, already past); held again on a new entry
  await p.click('#live-hold-resume');
  await h.until(async () => !(await p.$('#live-hold-banner')), 3000);
  expect(!(await p.$('#live-hold-banner')) && (await rows()) === 5 && (await current()) === S('UNCLAMP_START'), `Resume: the 3 transitions since shown (${await rows()}, in ${await current()})`);
  await send(['CLAMPPING', 'CLAMPED', 'UNCLAMP_START'], 6);
  const again = await h.until(() => p.$('#live-hold-banner'), 4000);
  expect(!!again && (await current()) === S('CLAMPED'), `entered again: held again (in ${await current()})`);
  await p.click('#live-hold-resume');
  await p.click('#live-stop-btn').catch(() => {});
  await h.sleep(500);
  expect(!(await p.$('#live-hold-banner')), 'not live: no hold');

  // 4. A replay stops at CLAMPED's entry; Play goes on to the end
  const rec = { kind: 'kval-machinescope-recording', version: 1, pou: 'SM_TableManager', instance: I, stateVar: 'machineState', values: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED', 'UNCLAMP_START', 'IDLE_FEED_OFF'].map((s, i) => ({ t: t0 + i * 5000, value: sample.values[S(s)] })), vars: [], watched: {} };
  const file = h.out('pause.kssrec.json');
  fs.writeFileSync(file, JSON.stringify(rec));
  await (await p.$('#live-open-recording')).uploadFile(file);
  await p.waitForSelector('#live-replay-bar', { timeout: 5000 }).catch(() => {});
  await p.select('#live-replay-speed', '60');
  const paused = await h.until(() => p.$eval('#live-replay-paused-on', (e) => e.textContent.trim()).catch(() => null), 8000);
  const playLabel = await p.$eval('#live-replay-play', (b) => b.textContent.trim()).catch(() => '');
  expect(paused === S('CLAMPED') && playLabel === 'Play' && (await current()) === S('CLAMPED'), `the replay stopped at CLAMPED (${paused}, ${playLabel}, in ${await current()})`);
  await p.click('#live-replay-play');
  const ended = await h.until(async () => ((await current()) === S('IDLE_FEED_OFF') && !(await p.$('#live-replay-paused-on')) ? true : null), 8000);
  expect(!!ended, `Play: on to the end, not stopped again (in ${await current()})`);
  await p.screenshot({ path: h.out('pause-on-state.png') });

  // 5. The choice removed
  await p.click('.live-pause-chip .live-pause-remove');
  await h.sleep(300);
  expect((await chips()).length === 0 && (await p.evaluate(() => localStorage.getItem('kss.pauseOn|sm_tablemanager'))) === null, 'removed: no chip, nothing kept');

  // 6. A state's menu on the canvas: Pause when entered (and off again), the Live tab's chips the same
  const stateMenu = async (id) => {
    for (let i = 0; i < 3; i++) {
      const at = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, id);
      if (!at) return null;
      await p.mouse.click(at.x, at.y, { button: 'right' });
      const b = await p.waitForSelector('#context-menu-pause-on-state-btn', { timeout: 4000 }).catch(() => null);
      if (b) return p.evaluate(() => { const x = document.getElementById('context-menu-pause-on-state-btn'); const t = x.textContent.trim(); x.click(); return t; });
      await p.keyboard.press('Escape');
    }
    return null;
  };
  await p.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
  await h.sleep(800);
  const on = await stateMenu(S('HALT_FEED'));
  await h.sleep(300);
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(400);
  expect(on === 'Pause when entered' && JSON.stringify(await chips()) === JSON.stringify([S('HALT_FEED')]), `the state's menu: ${on}; Pause on ${await chips()}`);
  await p.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
  await h.sleep(800);
  const off = await stateMenu(S('HALT_FEED'));
  await h.sleep(300);
  expect(off === 'Do not pause when entered' && (await chips()).length === 0, `and off again: ${off}`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

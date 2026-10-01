const h = require('../lib/harness.cjs');
// A live session (XAE stand-in bridge) is recorded: Save recording writes it (saveDocument), Replay plays it back
// (play, speed, seek back); the transitions the PLC took are remembered: deleting one of them, and a Save without it,
// say so first
const fs = require('fs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.evaluateOnNewDocument(() => { const orig = console.error; console.error = (...a) => { if (/Maximum update depth/.test(String(a[0]))) orig('LOOPSTACK ' + new Error().stack); return orig(...a); }; });
  p.on('console', (m) => { if (m.type() === 'error' && /LOOPSTACK/.test(m.text())) console.log(m.text().slice(0, 4000)); if (false) Promise.all(m.args().map((x) => x.evaluate((v) => (v && v.stack) || String(v)).catch(() => '?'))).then((t) => console.log('CONSOLE-ERR', t.join(' || ').slice(0, 6000))); });
  p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log('NAVIGATED', f.url()); });
  const sent = [];
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const lv = await import('/src/utils/liveView.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  const PATH = 'C:\\\\proj\\\\SM_TableManager.TcPOU';
  let savedDoc = null;
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: PATH, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    } else if (m.type === 'saveDocument') {
      savedDoc = m;
      await toApp({ type: 'saveDocumentResult', path: `C:\\\\rec\\\\${m.name}` });
    } else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
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
  await h.sleep(400);
  expect(!!(await p.$('#live-open-recording')) && !(await p.$('#live-save-recording')), 'not live: Replay offered, nothing to save yet');

  // Live: IDLE -> CLAMPPING -> CLAMPED -> REFEED_START -> CLAMPED (PLC time 10 s apart), with a guard value
  await p.click('#live-start-btn');
  await h.sleep(600);
  const t0 = Date.UTC(2026, 8, 20, 22, 0, 0);
  const seq = ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED', 'REFEED_START', 'CLAMPED'];
  await toApp({ type: 'liveValues', events: seq.map((s, i) => ({ t: t0 + i * 10000, value: sample.values[S(s)] })) });
  await toApp({ type: 'liveWatchResult', vars: [{ id: 'cmd_bunclamp', symbol: `${I}.cmd_bUnclamp`, type: 'BOOL' }] });
  await toApp({ type: 'liveVars', values: [{ id: 'cmd_bunclamp', t: t0 + 41000, v: true }] });
  await h.sleep(800);
  const liveRows = await p.$$eval('.live-trail-row', (r) => r.length);
  expect(liveRows === 4, `live: 4 transitions (${liveRows})`);

  // Save recording
  await p.click('#live-save-recording');
  for (let i = 0; i < 20 && !savedDoc; i++) await h.sleep(150);
  const rec = savedDoc ? JSON.parse(savedDoc.content) : null;
  expect(!!rec && /^SM_TableManager_smTableManager_\d{4}-\d\d-\d\d_\d{4}\.kssrec\.json$/.test(savedDoc.name) && rec.values.length === 5 && rec.vars.length === 1 && rec.watched.cmd_bunclamp?.symbol === `${I}.cmd_bUnclamp` && rec.instance === I && rec.pou === 'SM_TableManager', `saved: ${savedDoc?.name}, ${rec?.values.length} samples, ${rec?.vars.length} guard value`);

  // Seen transitions: deleting CLAMPED -> REFEED_START (taken once) warns
  const seen = await p.evaluate(() => JSON.parse(localStorage.getItem('kss.live.seen.SM_TableManager') || localStorage.getItem('kss.seen.SM_TableManager') || '{}'));
  expect(seen[`${S('CLAMPED')}->${S('REFEED_START')}`]?.n === 1 && seen[`${S('REFEED_START')}->${S('CLAMPED')}`]?.n === 1, `remembered as taken: ${Object.keys(seen).length} transitions`);
  await p.click('#live-stop-btn');
  await h.sleep(400);
  await p.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
  await h.sleep(600);
  await p.evaluate((s) => [...(document.getElementById(`state-list-item-${s}`)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), S('CLAMPED'));
  await h.sleep(1200);
  const key = `${S('CLAMPED')}->${S('REFEED_START')}`;
  const ep = await p.evaluate((key) => {
    const el = document.querySelector(`#mermaid-canvas-area path.tc-edge-path[data-edge-key="${key}"]`);
    if (!el) return null;
    const len = el.getTotalLength(); const m = el.getScreenCTM();
    for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.2, 0.8]) {
      const q = el.getPointAtLength(len * f); const x = q.x * m.a + q.y * m.c + m.e; const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.getAttribute('data-edge-key') === key) return { x, y };
    }
    return null;
  }, key);
  if (ep) {
    await p.mouse.click(ep.x, ep.y, { button: 'right' });
    await h.sleep(400);
    await p.evaluate(() => document.getElementById('context-menu-delete-transition-btn')?.click());
    await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
    const label = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
    expect(/The PLC took this transition 1 time/.test(label), `delete: warned (${label.split('\n').find((l) => /PLC/.test(l)) || 'no warning'})`);
    await p.keyboard.press('Enter');
    await h.sleep(1200);
    // Save to project: asked first (the saved version has it, the PLC took it)
    const saveBtn = await p.$('#save-to-project-btn, #header-save-btn');
    await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control');
    await p.waitForSelector('#text-prompt-dialog', { timeout: 3000 }).catch(() => {});
    const ask = await p.$eval('#text-prompt-dialog', (e) => e.innerText).catch(() => '');
    expect(/Save without transitions the PLC uses\?/.test(ask) && /TABLEMANAGER_CLAMPED → TABLEMANAGER_REFEED_START: taken 1 time/.test(ask) && !sent.some((m) => m.type === 'save'), `Save (Ctrl+S): asked first, nothing sent yet (${saveBtn ? 'button' : 'keys'})`);
    await p.click('#text-prompt-submit');
    await h.sleep(500);
    expect(sent.some((m) => m.type === 'save'), 'Save anyway: sent to XAE');
  } else {
    expect(false, 'the CLAMPED -> REFEED_START edge on the canvas');
  }

  // Replay the recording: plays, jumps back, the time shown
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await h.sleep(300);
  const file = h.out('replay.kssrec.json');
  fs.writeFileSync(file, savedDoc.content);
  const input = await p.$('#live-open-recording');
  await input.uploadFile(file);
  await p.waitForSelector('#live-replay-bar', { timeout: 3000 }).catch(() => {});
  expect(!!(await p.$('#live-replay-bar')) && /Replay: replay\.kssrec\.json/.test(await p.$eval('#live-status', (e) => e.textContent)), 'Replay: the bar, the status');
  await p.select('#live-replay-speed', '60');
  // (played: its 4 transitions; a busy machine takes longer)
  let rows = 0;
  for (let i = 0; i < 40 && rows < 4; i++) {
    await h.sleep(250);
    rows = await p.$$eval('.live-trail-row', (r) => r.length);
  }
  if (rows < 4) console.log('DBG tabs', JSON.stringify(await p.evaluate(() => ({ tabs: [...document.querySelectorAll('[role=tab][aria-selected=true]')].map((t) => t.id), bar: !!document.getElementById('live-replay-bar'), live: !!document.getElementById('live-status'), status: document.getElementById('live-status')?.textContent, body: document.body.innerText.slice(0, 400) }))));
  const current = await p.$eval('#live-current-state', (e) => e.textContent).catch(() => '');
  expect(rows === 4 && /TABLEMANAGER_CLAMPED/.test(current), `played at 60x: ${rows} transitions, now in ${current.trim().split(/\s+/)[0]}`);
  const guardShown = await p.evaluate(() => document.body.innerText.includes('cmd_bUnclamp = TRUE'));
  expect(guardShown, 'its guard value shown (cmd_bUnclamp = TRUE)');
  const seenAfter = await p.evaluate(() => JSON.parse(localStorage.getItem('kss.seen.SM_TableManager') || '{}'));
  expect(seenAfter[`${S('REFEED_START')}->${S('CLAMPED')}`]?.n === 1, 'a replay is not counted as taken again');
  // Seek back to the start: one state, no transitions yet
  await p.evaluate(() => {
    const r = document.getElementById('live-replay-seek');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(r, r.min);
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await h.sleep(600);
  const back = await p.$$eval('.live-trail-row', (r) => r.length);
  expect(back === 0 && /IDLE_FEED_OFF/.test(await p.$eval('#live-current-state', (e) => e.textContent).catch(() => '')), `seek to the start: ${back} transitions, in IDLE_FEED_OFF`);
  await p.screenshot({ path: h.out('record-replay.png') });
  await p.click('#live-stop-btn');
  await h.sleep(300);
  expect(!(await p.$('#live-replay-bar')), 'Stop: the replay ends');
  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

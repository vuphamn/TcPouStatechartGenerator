const h = require('../lib/harness.cjs');
const fs = require('fs');
// The Live tab's tools, round 8 (XAE stand-in bridge): guard coverage (each condition seen true and false) and the test
// report (HTML, PDF); an alert snoozed (silent, then longer, then not); a note live and in a replay (kept with the
// recording); values by shift; the PLC set to a sequence of states (each step confirmed, each logged); the dashboard
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
  const PATH = 'C:\\proj\\SM_TableManager.TcPOU';
  const sent = [];
  const saved = [];
  const comm = { allowed: [], log: [] };
  // (the guards' variables as the PLC has them: HOMMING_READY_TO_START's conditions evaluated)
  const values = { cmd_bhome: true, 'smoutfeedstopaxis.config_fhomeposition': 0, 'smoutfeedstopaxis.status_bhomed': false };
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: PATH, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
      await toApp({ type: 'liveValues', events: [{ t: Date.now() - 5000, value: sample.values[S('IDLE_FEED_OFF')] }, { t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveStop') await toApp({ type: 'liveStatus', state: 'stopped', message: 'Stopped', instances: [] });
    else if (m.type === 'liveWatch') {
      await toApp({ type: 'liveWatchResult', vars: m.vars.map((v) => ({ id: v.id, symbol: v.candidates[0], type: /machinestate$/.test(v.id) ? 'E_TableManager_States' : /fhome/.test(v.id) ? 'LREAL' : /^cmd_|status_b|^b/.test(v.id.split('.').pop()) ? 'BOOL' : 'INT' })) });
      await toApp({ type: 'liveVars', values: m.vars.filter((v) => v.id in values).map((v) => ({ id: v.id, t: Date.now(), v: values[v.id] })) });
    } else if (m.type === 'liveWrite') await toApp({ type: 'liveWriteResult', requestId: m.requestId, ok: true, message: `${m.id} := ${m.value}` });
    else if (m.type === 'commissioning') await toApp({ type: 'commissioningResult', requestId: m.requestId, ...comm });
    else if (m.type === 'commissioningSave') {
      if (m.allowed) comm.allowed = m.allowed;
      if (m.entry) comm.log.push({ ...m.entry, t: '2026-10-13T08:00:00.000Z', user: 'ann' });
      await toApp({ type: 'commissioningSaveResult', requestId: m.requestId, ...comm });
    } else if (m.type === 'webhook') await toApp({ type: 'webhookResult', requestId: m.requestId, ok: true });
    else if (m.type === 'eventsSave') await toApp({ type: 'eventsSaveResult', requestId: m.requestId, ok: true, path: `C:\\proj\\MachineScope.events\\${m.name}` });
    else if (m.type === 'saveDocument') {
      saved.push(m);
      await toApp({ type: 'saveDocumentResult', path: `C:\\docs\\${m.name}` });
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
  await p.waitForSelector(`#mermaid-canvas-area g.node[data-state-id="${S('CLAMPED')}"]`, { timeout: 60000 });
  await h.sleep(800);
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await p.waitForSelector('#live-start-btn', { timeout: 10000 }).catch(() => {});
  await p.click('#live-start-btn');
  await h.sleep(1500);
  const vars = (list) => toApp({ type: 'liveVars', values: list.map(([id, v], i) => ({ id, t: Date.now() + i, v })) });
  const promptText = async (text) => {
    await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
    await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.select(); });
    await p.keyboard.type(text);
    await p.click('#text-prompt-submit').catch(() => {});
    await h.sleep(300);
  };

  // 1. Guard coverage: the conditions seen live (kept per POU type); one seen the other way too: both
  const count = () => p.$eval('#live-guard-coverage-count', (e) => e.textContent.trim()).catch(() => null);
  const first = await h.until(() => count().then((c) => (c && / \/ [1-9]/.test(c) ? c : null)), 6000);
  const seen = () => p.evaluate(() => JSON.parse(localStorage.getItem('kss.guardCoverage|sm_tablemanager') ?? '{}'));
  const seen1 = await h.until(() => seen().then((s) => (Object.keys(s).length ? s : null)), 4000);
  values.cmd_bhome = false;
  await vars([['cmd_bhome', false]]);
  const seen2 = await h.until(() => seen().then((s) => (Object.values(s).some((x) => x.t && x.f) ? s : null)), 4000);
  const second = await count();
  expect(!!first && !!seen1 && !!seen2 && Number(second?.split(' / ')[0]) > Number(first.split(' / ')[0]), `the conditions seen both ways: ${first} → ${second}`);
  await p.click('#live-guard-coverage-toggle').catch(() => {});
  await h.sleep(200);
  await p.click('#live-test-report-html').catch(() => {});
  const report = await h.until(() => saved.find((m) => /_test_report\.html$/.test(m.name)) ?? null, 4000);
  await p.click('#live-test-report-pdf').catch(() => {});
  const reportPdf = await h.until(() => saved.find((m) => /_test_report\.pdf$/.test(m.name)) ?? null, 4000);
  expect(report?.name === 'SM_TableManager_test_report.html' && /conditions seen both ways/.test(report.content) && /transitions taken/.test(report.content) && /Approved by/.test(report.content), `the test report: ${report?.name}`);
  expect(!!reportPdf && reportPdf.content.startsWith('%PDF-1.4') && reportPdf.content.trimEnd().endsWith('%%EOF'), `as PDF: ${reportPdf?.name}`);

  // 2. An alert snoozed: silent while snoozed (said in the events); a click more: 1 h; again: not snoozed
  await p.waitForSelector('#live-watch-expr-input', { timeout: 5000 }).catch(() => {});
  await p.type('#live-watch-expr-input', 'nFeedCount > 10');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  await p.click('.live-watch-expr .live-watch-alert').catch(() => {});
  await p.click('#live-events-toggle').catch(() => {});
  await h.sleep(200);
  await p.click('.live-watch-expr .live-watch-alert-snooze').catch(() => {});
  await h.sleep(200);
  const until15 = Number(await p.$eval('.live-watch-expr .live-watch-alert-snooze', (b) => b.getAttribute('data-until')).catch(() => 0));
  await vars([['nfeedcount', 5]]);
  await h.sleep(300);
  await vars([['nfeedcount', 12]]);
  await h.sleep(800);
  const alertTexts = await p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent));
  expect(Math.abs(until15 - Date.now() - 15 * 60_000) < 30_000 && alertTexts.some((t) => /Snoozed for 15 min: nFeedCount > 10/.test(t)) && !alertTexts.some((t) => /became true/.test(t)), `snoozed 15 min: silent (${alertTexts.length} alert events: ${alertTexts.map((t) => t.slice(-40)).join(' | ')})`);
  await p.click('.live-watch-expr .live-watch-alert-snooze').catch(() => {});
  await h.sleep(200);
  const until60 = Number(await p.$eval('.live-watch-expr .live-watch-alert-snooze', (b) => b.getAttribute('data-until')).catch(() => 0));
  await p.click('.live-watch-expr .live-watch-alert-snooze').catch(() => {});
  await h.sleep(200);
  const untilOff = await p.$eval('.live-watch-expr .live-watch-alert-snooze', (b) => b.getAttribute('data-until')).catch(() => null);
  await vars([['nfeedcount', 4]]);
  await h.sleep(300);
  await vars([['nfeedcount', 14]]);
  const fired = await h.until(() => p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent)).then((x) => x.find((t) => /became true/.test(t)) ?? null), 4000);
  expect(Math.abs(until60 - Date.now() - 60 * 60_000) < 30_000 && untilOff === '' && !!fired, `then 1 h, then not snoozed: said again (${fired?.slice(-40)})`);

  // 3. A note now (an event); the values by shift (the counts)
  await p.click('#live-events-note').catch(() => {});
  await promptText('jam cleared here');
  const note = await h.until(() => p.$$eval('.live-event[data-kind="note"]', (x) => x.map((e) => e.textContent)).then((x) => (x.length ? x[0] : null)), 3000);
  expect(/jam cleared here/.test(note ?? ''), `a note live: ${note}`);
  await p.click('#live-events-stats').catch(() => {});
  const byShift = await h.until(() => p.$$eval('#live-values-by-shift .live-value-stat', (x) => x.map((e) => `${e.getAttribute('data-name')}@${e.getAttribute('data-shift')}`)).then((x) => (x.length ? x : null)).catch(() => null), 3000);
  expect(!!byShift && byShift.some((x) => /nFeedCount/i.test(x)), `values by shift: ${byShift?.join(', ')}`);
  await p.click('#live-events-stats').catch(() => {});

  // 4. The PLC set to a sequence of states: each step confirmed, each written and logged
  for (const s of ['UNCLAMP_START', 'CLAMPPING']) {
    await p.select('#live-set-state-add', S(s)).catch(() => {});
    await h.sleep(200);
  }
  await p.click('#live-set-state-sequence').catch(() => {});
  await h.sleep(300);
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  const initial = await p.$eval('#text-prompt-input', (i) => i.value).catch(() => '');
  await p.click('#text-prompt-submit').catch(() => {});
  await p.waitForSelector('#text-prompt-check', { timeout: 3000 }).catch(() => {});
  await p.type('#text-prompt-input', 'valve check').catch(() => {});
  await p.click('#text-prompt-check').catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  const w1 = await h.until(() => sent.filter((m) => m.type === 'liveWrite').length === 1 || null, 4000);
  const step2 = await h.until(() => p.$eval('#text-prompt-dialog', (e) => e.textContent).then((t) => (/Step 2 of 2/.test(t) ? t : null)).catch(() => null), 3000);
  await p.click('#text-prompt-submit').catch(() => {});
  const writes = await h.until(() => { const w = sent.filter((m) => m.type === 'liveWrite'); return w.length === 2 ? w : null; }, 4000);
  const logged = await h.until(() => (comm.log.length === 2 ? comm.log : null), 4000);
  expect(initial === `${S('UNCLAMP_START')}, ${S('CLAMPPING')}` && !!w1 && !!step2 && writes?.map((m) => m.value).join() === [sample.values[S('UNCLAMP_START')], sample.values[S('CLAMPPING')]].join(), `the sequence written step by step: ${writes?.map((m) => m.value).join(', ')}`);
  expect(!!logged && /^valve check \(sequence 1\/2: TABLEMANAGER_UNCLAMP_START → TABLEMANAGER_CLAMPPING\)$/.test(logged[0].reason) && /sequence 2\/2/.test(logged[1].reason), `each step logged: ${logged?.map((e) => e.reason).join(' | ')}`);

  // 5. The dashboard: this PLC's state, the alerts now, the last events; Esc closes it
  await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: sample.values[S('CLAMPED')] }] });
  await p.click('#live-dashboard-btn').catch(() => {});
  const tile = await h.until(() => p.$eval('#live-dashboard .live-dashboard-tile', (e) => ({ state: e.getAttribute('data-state'), label: e.getAttribute('data-label') })).catch(() => null), 3000);
  const dashAlerts = await p.$$eval('#live-dashboard .live-dashboard-alert', (x) => x.map((e) => e.textContent)).catch(() => []);
  const dashEvents = await p.$$eval('#live-dashboard .live-dashboard-event', (x) => x.length).catch(() => 0);
  expect(tile?.state === S('CLAMPED') && tile.label === '5.1.2.3.1.1:851' && dashAlerts.some((t) => /nFeedCount > 10/.test(t)) && dashEvents > 0, `the dashboard: ${JSON.stringify(tile)}, alerts ${dashAlerts.length}, events ${dashEvents}`);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(!(await p.$('#live-dashboard')), 'Esc closes it');

  // 6. A note in a replay: at its position, on its list (a click goes there), kept for the file
  await p.click('#live-stop-btn').catch(() => {});
  await h.sleep(300);
  const r0 = Date.UTC(2026, 9, 12, 8, 30);
  const rec = { kind: 'kval-machinescope-recording', version: 1, pou: 'SM_TableManager', instance: I, stateVar: 'machineState', started: r0, ended: r0 + 30000, values: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED'].map((s, i) => ({ t: r0 + i * 12000, value: sample.values[S(s)] })), vars: [], watched: {}, notes: [{ t: r0 + 5000, text: 'from the file' }] };
  const recFile = h.out('notes.kssrec.json');
  fs.writeFileSync(recFile, JSON.stringify(rec));
  await (await p.$('#live-open-recording')).uploadFile(recFile);
  await p.waitForSelector('#live-replay-note', { timeout: 5000 }).catch(() => {});
  await p.click('#live-replay-note').catch(() => {});
  await promptText('the clamp slow');
  const notes = await h.until(() => p.$$eval('#live-replay-notes .live-replay-note', (x) => x.map((e) => e.textContent)).then((x) => (x.length >= 2 ? x : null)).catch(() => null), 3000);
  const keptNotes = await p.evaluate((k) => localStorage.getItem(k), `kss.recNotes|notes.kssrec.json|${r0}`);
  expect(!!notes && notes.some((t) => /from the file/.test(t)) && notes.some((t) => /the clamp slow/.test(t)) && /the clamp slow/.test(keptNotes ?? ''), `the replay's notes: ${notes?.join(' | ')} (kept: ${!!keptNotes})`);

  expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

const h = require('../lib/harness.cjs');
// The Live tab's tools, round 9 (XAE stand-in bridge): TcUnit tests of the guard coverage's gaps (never true, never
// false); an alert snoozed until the PLC leaves its state; a sequence saved by name (kept in the commissioning file),
// run again and removed; the shift report now (beside the project: MachineScope.reports); the test reports kept and
// two compared
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
  const comm = { allowed: [], log: [], sequences: [] };
  // (MachineScope.reports, as the host keeps it)
  const reports = new Map();
  let mtime = Date.now();
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
      if (m.sequences) comm.sequences = m.sequences;
      if (m.entry) comm.log.push({ ...m.entry, t: '2026-10-14T08:00:00.000Z', user: 'ann' });
      await toApp({ type: 'commissioningSaveResult', requestId: m.requestId, ...comm });
    } else if (m.type === 'reportFileSave') {
      reports.set(m.name, { content: m.content, mtime: (mtime += 1000) });
      await toApp({ type: 'reportFileSaveResult', requestId: m.requestId, ok: true, path: `C:\\proj\\MachineScope.reports\\${m.name}` });
    } else if (m.type === 'reportFiles') await toApp({ type: 'reportFilesResult', requestId: m.requestId, files: [...reports].map(([name, r]) => ({ name, size: r.content.length, mtime: r.mtime })).sort((a, b) => b.mtime - a.mtime) });
    else if (m.type === 'reportFileRead') await toApp({ type: 'reportFileReadResult', requestId: m.requestId, ok: reports.has(m.name), content: reports.get(m.name)?.content, error: reports.has(m.name) ? null : 'No such report' });
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
  const prompt = () => p.$eval('#text-prompt-dialog', (e) => e.textContent).catch(() => null);
  const typeInPrompt = async (text) => {
    await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
    await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.select(); });
    await p.keyboard.type(text);
  };

  // 1. TcUnit tests of the gaps: a never-true suite and a never-false one (its guard made false, held)
  await h.until(() => p.$('#live-guard-coverage-tcunit'), 6000);
  await p.click('#live-guard-coverage-tcunit').catch(() => {});
  await p.waitForSelector('#tcunit-save', { timeout: 3000 }).catch(() => {});
  const offer = (await prompt()) ?? '';
  await p.click('#tcunit-save').catch(() => {});
  const neverTrue = await h.until(() => saved.find((m) => /_NeverTrue1_Test\.TcPOU$/.test(m.name)) ?? null, 6000);
  const neverFalse = await h.until(() => saved.find((m) => /_NeverFalse1_Test\.TcPOU$/.test(m.name)) ?? null, 4000);
  expect(/seen only one way live/.test(offer) && !!neverTrue && !!neverFalse, `the gaps' suites: ${saved.map((m) => m.name).filter((n) => /Never/.test(n)).length} saved (${neverTrue?.name}, ${neverFalse?.name})`);
  expect(/made false: in TABLEMANAGER_\w+, not to TABLEMANAGER_\w+ for 100 cycles/.test(neverFalse?.content ?? '') && /with its condition false/.test(neverFalse?.content ?? ''), 'the never-false suite: its guard made false, the transition must not be taken');
  await p.keyboard.press('Escape');
  await h.sleep(300);

  // 2. An alert snoozed until the PLC leaves its state: silent in it; said again once it left
  await p.type('#live-watch-expr-input', 'nFeedCount > 10');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  await p.click('.live-watch-expr .live-watch-alert').catch(() => {});
  await p.click('#live-events-toggle').catch(() => {});
  for (let i = 0; i < 3; i++) {
    await p.click('.live-watch-expr .live-watch-alert-snooze').catch(() => {});
    await h.sleep(250);
  }
  const snoozedIn = await p.$eval('.live-watch-expr .live-watch-alert-snooze', (b) => ({ in: b.getAttribute('data-in'), text: b.textContent })).catch(() => null);
  await vars([['nfeedcount', 5]]);
  await h.sleep(300);
  await vars([['nfeedcount', 12]]);
  await h.sleep(800);
  const alertsIn = await p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent));
  expect(snoozedIn?.in === S('HOMMING_READY_TO_START') && /zz ⇥START/.test(snoozedIn.text) && alertsIn.some((t) => /Snoozed while in TABLEMANAGER_HOMMING_READY_TO_START/.test(t)) && !alertsIn.some((t) => /became true/.test(t)), `snoozed while in the state: silent (${snoozedIn?.text})`);
  await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: sample.values[S('CLAMPED')] }] });
  const left = await h.until(() => p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent)).then((x) => x.find((t) => /Not snoozed any more \(left TABLEMANAGER_HOMMING_READY_TO_START\)/.test(t)) ?? null), 4000);
  await vars([['nfeedcount', 4]]);
  await h.sleep(300);
  await vars([['nfeedcount', 14]]);
  const fired = await h.until(() => p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent)).then((x) => x.find((t) => /became true/.test(t)) ?? null), 4000);
  const after = await p.$eval('.live-watch-expr .live-watch-alert-snooze', (b) => b.getAttribute('data-in')).catch(() => null);
  expect(!!left && !!fired && after === '', `left the state: not snoozed, said again (${fired?.slice(-30)})`);

  // 3. A sequence saved by name, run again from Saved…, removed
  for (const s of ['UNCLAMP_START', 'CLAMPPING']) {
    await p.select('#live-set-state-add', S(s)).catch(() => {});
    await h.sleep(200);
  }
  await p.click('#live-set-state-sequence').catch(() => {});
  await typeInPrompt(`Clamp test: ${S('UNCLAMP_START')}, ${S('CLAMPPING')}`);
  await p.click('#text-prompt-submit').catch(() => {});
  const keptSeq = await h.until(() => (comm.sequences.length ? comm.sequences : null), 4000);
  const confirmTitle = await h.until(() => prompt().then((t) => (t && /\(Clamp test\)/.test(t) ? t : null)), 3000);
  await p.keyboard.press('Escape');
  await h.sleep(300);
  expect(JSON.stringify(keptSeq) === JSON.stringify([{ name: 'Clamp test', states: [S('UNCLAMP_START'), S('CLAMPPING')] }]) && !!confirmTitle, `kept by name in the commissioning file: ${JSON.stringify(keptSeq)}`);
  const options = await h.until(() => p.$$eval('#live-set-state-saved option', (x) => x.map((o) => o.value)).then((x) => (x.length > 1 ? x : null)).catch(() => null), 3000);
  await p.select('#live-set-state-saved', 'run:Clamp test').catch(() => {});
  const runTitle = await h.until(() => prompt().then((t) => (t && /Set the PLC to 2 states, one after another \(Clamp test\)\?/.test(t) ? t : null)), 3000);
  await p.click('#text-prompt-check').catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  const w1 = await h.until(() => sent.filter((m) => m.type === 'liveWrite').length === 1 || null, 4000);
  await h.until(() => prompt().then((t) => (t && /Step 2 of 2/.test(t) ? t : null)), 3000);
  await p.click('#text-prompt-submit').catch(() => {});
  const w2 = await h.until(() => sent.filter((m) => m.type === 'liveWrite').length === 2 || null, 4000);
  expect(!!options?.includes('run:Clamp test') && !!runTitle && !!w1 && !!w2 && /sequence 2\/2/.test(comm.log[comm.log.length - 1]?.reason ?? ''), 'run again from Saved…: no states asked, each step confirmed and logged');
  await h.sleep(300);
  await p.select('#live-set-state-saved', 'remove:Clamp test').catch(() => {});
  await h.until(() => prompt().then((t) => (t && /Remove the sequence Clamp test\?/.test(t) ? t : null)), 3000);
  await p.click('#text-prompt-submit').catch(() => {});
  const removed = await h.until(() => (comm.sequences.length === 0 ? true : null), 3000);
  const gone = await h.until(() => p.$('#live-set-state-saved').then((e) => (e ? null : true)), 3000);
  expect(!!removed && !!gone, 'removed (asked first): Saved… gone');

  // 4. The shift report now: beside the project
  await p.click('#live-shift-report-now').catch(() => {});
  const shift = await h.until(() => [...reports.keys()].find((n) => /^SM_TableManager_shift_\d{4}-\d\d-\d\d_(06-14|14-22|22-06)\.html$/.test(n)) ?? null, 4000);
  const shiftHtml = shift ? reports.get(shift).content : '';
  expect(!!shift && /Shift report: SM_TableManager/.test(shiftHtml) && /Time in each state/.test(shiftHtml) && /TABLEMANAGER_CLAMPED/.test(shiftHtml) && /became true/.test(shiftHtml) && (await p.$eval('#live-shift-report-keep', (e) => e.checked).catch(() => null)) === true, `the shift report: ${shift}`);

  // 5. Test reports kept beside the project (HTML and JSON); two compared
  await p.click('#live-test-report-html').catch(() => {});
  await h.until(() => [...reports.keys()].filter((n) => /_test_report_.*\.json$/.test(n)).length === 1 || null, 4000);
  await h.sleep(1100);
  // (one more condition seen both ways between them: back in HOMMING_READY_TO_START, cmd_bHome off)
  await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
  await h.sleep(400);
  values.cmd_bhome = false;
  await vars([['cmd_bhome', false]]);
  await h.sleep(500);
  await p.click('#live-test-report-html').catch(() => {});
  const kept = await h.until(() => { const k = [...reports.keys()].filter((n) => /^SM_TableManager_test_report_.*\.(json|html)$/.test(n)); return k.length === 4 ? k : null; }, 4000);
  expect(!!kept, `kept beside the project: ${kept?.join(', ')}`);
  await p.click('#live-test-report-history').catch(() => {});
  const history = await h.until(() => prompt().then((t) => (t && /Test reports kept: SM_TableManager \(2\)/.test(t) ? t : null)), 4000);
  await p.click('#text-prompt-submit').catch(() => {});
  const compared = await h.until(() => prompt().then((t) => (t && /Compared: \d+ better, \d+ worse/.test(t) ? t : null)), 4000);
  await p.click('#text-prompt-submit').catch(() => {});
  const page = await h.until(() => saved.find((m) => m.name === 'SM_TableManager_test_reports_compared.html') ?? null, 4000);
  expect(!!history && /Conditions seen both ways: 0 \/ \d+ \(0%\) → 1 \/ \d+/.test(compared ?? '') && /Compared: [1-9]\d* better/.test(compared ?? '') && !!page && /Test reports compared/.test(page.content), `two compared: ${(compared ?? '').slice(0, 120)}`);

  expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

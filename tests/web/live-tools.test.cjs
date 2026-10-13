const h = require('../lib/harness.cjs');
const fs = require('fs');
// The Live tab's tools (XAE stand-in bridge): a watch expression (its variables watched, its value computed, charted
// on the scope; a wrong one said why); the state timeline (this PLC's states as bars); the event log (connected, the
// PLC set to a state, CSV); a state's menu: Set the PLC to this state (asked first, its state variable written),
// History of the state (its CASE branch per commit, the change shown); a replay's TcUnit test (.TcPOU saved);
// the Method Editor's Convert to CASE
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
    const sa = await import('/src/utils/stateActions.ts');
    const s = mod.SAMPLES[0];
    // (an older commit: CLAMPED's branch had a line more)
    const code = sa.readStateCode(s.pouContent, 'TABLEMANAGER_CLAMPED');
    const older = sa.writeStateCode(s.pouContent, 'TABLEMANAGER_CLAMPED', [...code, 'nHistoryProbe := 1;'].join('\n'));
    return { pou: s.pouContent, dut: s.dutContent, older: older.pou ?? older.error, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  const PATH = 'C:\\proj\\SM_TableManager.TcPOU';
  const older = sample.older;
  const sent = [];
  const saved = [];
  // (the project's commissioning file, as the host keeps it: it names the user)
  const comm = { allowed: [], log: [] };
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: PATH, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    else if (m.type === 'liveWatch') await toApp({ type: 'liveWatchResult', vars: m.vars.map((v) => ({ id: v.id, symbol: v.candidates[0], type: /machinestate$/.test(v.id) ? 'E_TableManager_States' : 'INT' })) });
    else if (m.type === 'liveWrite') await toApp({ type: 'liveWriteResult', requestId: m.requestId, ok: true, message: `${m.id} := ${m.value}` });
    else if (m.type === 'commissioning') await toApp({ type: 'commissioningResult', requestId: m.requestId, ...comm });
    else if (m.type === 'commissioningSave') {
      if (m.allowed) comm.allowed = m.allowed;
      if (m.entry) comm.log.push({ ...m.entry, t: '2026-10-13T08:00:00.000Z', user: 'ann' });
      await toApp({ type: 'commissioningSaveResult', requestId: m.requestId, ...comm });
    } else if (m.type === 'gitLog') await toApp({ type: 'gitLogResult', requestId: m.requestId, commits: [{ hash: 'bbb2222', date: '2026-10-02 09:00', author: 'Ann', subject: 'CLAMPED: the probe taken out', file: 'PLC/SM_TableManager.TcPOU' }, { hash: 'aaa1111', date: '2026-10-01 08:00', author: 'Bob', subject: 'CLAMPED: a probe', file: 'PLC/SM_TableManager.TcPOU' }] });
    else if (m.type === 'gitShowAt') await toApp({ type: 'gitShowAtResult', requestId: m.requestId, content: m.hash === 'aaa1111' ? older : sample.pou.replace('</POU>', '</POU>') });
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
  await h.sleep(600);

  // 1. A watch expression: its variable watched, its value computed; charted on the scope; a wrong one said why
  await p.waitForSelector('#live-watch-expr-input', { timeout: 5000 }).catch(() => {});
  await p.type('#live-watch-expr-input', 'nFeedCount * 2 + 1');
  await p.keyboard.press('Enter');
  const EXPR = '= nFeedCount * 2 + 1';
  const watchedFeed = await h.until(() => sent.filter((m) => m.type === 'liveWatch').some((m) => m.vars.some((v) => v.id === 'nfeedcount')) || null, 5000);
  expect(!!watchedFeed, 'the expression\'s variable watched (nfeedcount asked of the PLC)');
  const now = Date.now();
  await toApp({ type: 'liveVars', values: [{ id: 'nfeedcount', t: now - 3000, v: 2 }, { id: 'nfeedcount', t: now - 1000, v: 4 }] });
  const exprValue = await h.until(() => p.$eval(`.live-watch-expr[data-name="${EXPR}"] .live-watch-value`, (e) => e.textContent.trim()).then((x) => (x === '9' ? x : null)).catch(() => null), 4000);
  expect(exprValue === '9', `its value: ${exprValue ?? (await p.$eval(`.live-watch-expr[data-name="${EXPR}"]`, (e) => e.textContent).catch(() => 'no row'))}`);
  await p.select('#live-scope-add', EXPR).catch(() => {});
  await toApp({ type: 'liveVars', values: [{ id: 'nfeedcount', t: Date.now(), v: 5 }] });
  const chart = await h.until(() => p.$eval(`.live-scope-chart[data-var="${EXPR}"] .live-scope-value`, (e) => e.textContent.trim()).then((x) => (x === '11' ? x : null)).catch(() => null), 4000);
  expect(chart === '11', `charted on the scope: ${chart}`);
  await p.type('#live-watch-expr-input', 'bA AND (');
  await p.keyboard.press('Enter');
  const exprError = await h.until(() => p.$eval('#live-watch-expr-error', (e) => e.textContent).catch(() => null), 2000);
  expect(!!exprError, `a wrong one said why: ${exprError}`);
  await p.evaluate(() => { const i = document.getElementById('live-watch-expr-input'); i.value = ''; });

  // 2. The timeline: this PLC's states as bars
  const t0 = Date.now() - 40000;
  await toApp({ type: 'liveValues', events: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED'].map((s, i) => ({ t: t0 + i * 10000, value: sample.values[S(s)] })) });
  const segs = await h.until(() => p.$$eval('#live-timeline .live-timeline-seg', (x) => x.map((e) => e.getAttribute('data-state'))).then((x) => (x.length >= 3 ? x : null)), 5000);
  expect(!!segs && segs.includes(S('CLAMPPING')) && segs[segs.length - 1] === S('CLAMPED'), `the timeline: ${JSON.stringify(segs)}`);
  await p.click('#live-timeline-span-1min').catch(() => {});

  // 3. A state's menu: Set the PLC to this state (asked first), its state variable written with the state's value
  const nodePoint = (id) => p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  const goTo = async (state) => {
    await p.evaluate((s) => [...(document.getElementById(`state-list-item-${s}`)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), state);
    await h.sleep(1200);
  };
  // (not allowed yet: said so, nothing asked; then allowed under May set to)
  await goTo(S('UNCLAMP_START'));
  let pt = await nodePoint(S('UNCLAMP_START'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.click('#context-menu-set-plc-state-btn').catch(() => {});
  await h.sleep(400);
  expect(!(await p.$('#text-prompt-dialog')), 'a state not allowed for commissioning: not asked, not written');
  await p.select('#live-set-state-add', S('UNCLAMP_START')).catch(() => {});
  await h.sleep(200);
  const allowed = await p.$$eval('.live-set-state-chip', (c) => c.map((x) => x.getAttribute('data-state')));
  expect(JSON.stringify(allowed) === JSON.stringify([S('UNCLAMP_START')]) && JSON.stringify(comm.allowed) === JSON.stringify([S('UNCLAMP_START')]) && (await p.$eval('#live-set-state-where', (e) => e.textContent).catch(() => '')) === 'project', `May set to: ${JSON.stringify(allowed)} (kept beside the project: ${JSON.stringify(comm.allowed)})`);
  await goTo(S('UNCLAMP_START'));
  pt = await nodePoint(S('UNCLAMP_START'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  const setItem = await p.$eval('#context-menu-set-plc-state-btn', (e) => e.textContent).catch(() => '');
  await p.click('#context-menu-set-plc-state-btn').catch(() => {});
  const prompt = await h.until(() => p.$eval('#text-prompt-dialog', (e) => e.textContent).catch(() => null), 3000);
  expect(/Set the PLC to this state/.test(setItem) && /without the steps that normally lead to it/.test(prompt ?? '') && /machineState := .*UNCLAMP_START/.test(prompt ?? ''), `asked first: ${(prompt ?? '').slice(0, 120)}`);
  expect(!sent.some((m) => m.type === 'liveWrite'), 'nothing written before the answer');
  const disabledFirst = await p.$eval('#text-prompt-submit', (b) => b.disabled).catch(() => null);
  await p.type('#text-prompt-input', 'clamp test after the valve change').catch(() => {});
  await p.click('#text-prompt-check').catch(() => {});
  const enabledAfter = await p.$eval('#text-prompt-submit', (b) => !b.disabled).catch(() => null);
  expect(disabledFirst === true && enabledAfter === true, 'the machine-is-safe box ticked first');
  await p.click('#text-prompt-submit').catch(() => {});
  const wrote = await h.until(() => sent.find((m) => m.type === 'liveWrite') ?? null, 4000);
  expect(wrote?.id === `sym:${I.toLowerCase()}.machinestate` && wrote?.value === sample.values[S('UNCLAMP_START')], `written: ${JSON.stringify(wrote)}`);
  // (who set which: logged beside the project, the host naming the user; the Log shows it)
  const logged = await h.until(() => (comm.log.length ? comm.log[0] : null), 4000);
  await p.click('#live-set-state-log').catch(() => {});
  const logText = await h.until(() => p.$eval('#text-prompt-details', (e) => e.textContent).catch(() => null), 3000);
  expect(logged?.state === S('UNCLAMP_START') && logged.ok && logged.reason === 'clamp test after the valve change' && /ann: .* → TABLEMANAGER_UNCLAMP_START on 5\.1\.2\.3\.1\.1:851: clamp test after the valve change/.test(logText ?? ''), `the log, with the reason: ${logText}`);
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(200);
  // (the commissioning report: an HTML page of the list and the log)
  await p.click('#live-set-state-report').catch(() => {});
  const report = await h.until(() => saved.find((m) => /_commissioning\.html$/.test(m.name)) ?? null, 4000);
  expect(report?.name === 'SM_TableManager_commissioning.html' && report.content.includes('clamp test after the valve change') && report.content.includes('<li>ann: 1</li>'), `the commissioning report: ${report?.name}`);

  // 4. The event log: connected, the PLC set to a state; CSV
  await p.click('#live-events-toggle').catch(() => {});
  await h.sleep(300);
  const kinds = await p.$$eval('.live-event', (x) => x.map((e) => e.getAttribute('data-kind')));
  expect(kinds.includes('connect') && kinds.includes('state'), `the events: ${JSON.stringify(kinds)}`);
  await p.click('#live-events-csv').catch(() => {});
  const csv = await h.until(() => saved.find((m) => /_events_.*\.csv$/.test(m.name)) ?? null, 4000);
  expect(!!csv && csv.content.startsWith('time;kind;event') && /;state;Set to TABLEMANAGER_UNCLAMP_START/.test(csv.content), `the events' CSV: ${csv?.name}`);

  // 5. History of the state: its branch per commit (the probe added, then taken out; as edited here: not committed)
  await goTo(S('CLAMPED'));
  pt = await nodePoint(S('CLAMPED'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.click('#context-menu-state-history-btn').catch(() => {});
  const versions = await h.until(() => p.$$eval('#state-history-dialog .state-history-version', (x) => x.map((e) => ({ hash: e.getAttribute('data-hash'), diff: e.querySelector('.state-history-diff')?.textContent ?? '' }))).then((x) => (x.length ? x : null)), 6000);
  const log = sent.find((m) => m.type === 'gitLog');
  expect(log?.path === PATH && !!versions && versions.map((v) => v.hash).join() === 'bbb2222,aaa1111', `the commits that changed it: ${JSON.stringify(versions?.map((v) => v.hash))}`);
  expect(!!versions && /-\s*nHistoryProbe := 1;/.test(versions[0].diff) && /first seen/.test(versions[1].diff), `the change shown: ${JSON.stringify(versions?.[0]?.diff.slice(0, 80))}`);
  await p.screenshot({ path: h.out('live-tools-history.png') });
  await p.keyboard.press('Escape');
  await h.sleep(200);

  // 6. A replay's TcUnit test: the recording's states and inputs, a .TcPOU saved
  await p.click('#live-stop-btn').catch(() => {});
  await h.sleep(400);
  const r0 = Date.UTC(2026, 9, 12, 8, 30);
  const rec = {
    kind: 'kval-machinescope-recording', version: 1, pou: 'SM_TableManager', instance: I, stateVar: 'machineState', started: r0, ended: r0 + 30000,
    values: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED'].map((s, i) => ({ t: r0 + i * 10000, value: sample.values[S(s)] })),
    vars: [{ id: 'cmd_bclamp', t: r0, v: false }, { id: 'cmd_bclamp', t: r0 + 9000, v: true }],
    watched: { cmd_bclamp: { symbol: `${I}.cmd_bClamp`, type: 'BOOL' } },
  };
  const file = h.out('live-tools.kssrec.json');
  fs.writeFileSync(file, JSON.stringify(rec));
  await (await p.$('#live-open-recording')).uploadFile(file);
  await p.waitForSelector('#live-replay-tcunit', { timeout: 5000 }).catch(() => {});
  await p.click('#live-replay-tcunit').catch(() => {});
  // (Add to the PLC project, or Save file…: saved here)
  await p.waitForSelector('#tcunit-save', { timeout: 3000 }).catch(() => {});
  await p.click('#tcunit-save').catch(() => {});
  const test = await h.until(() => saved.find((m) => /\.TcPOU$/.test(m.name)) ?? null, 4000);
  expect(test?.name === 'FB_SM_TableManager_Test.TcPOU' && /EXTENDS TcUnit\.FB_TestSuite/.test(test.content) && /fbUut\.cmd_bClamp := TRUE;/.test(test.content) && /E_TableManager_States\.TABLEMANAGER_CLAMPED/.test(test.content) && /RecordedRun_202610120830/.test(test.content), `the TcUnit test: ${test?.name}`);

  // 7. The Method Editor: Convert to CASE on an IF chain
  await p.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await p.waitForSelector('#method-implementation-editor', { timeout: 10000 }).catch(() => {});
  await h.sleep(500);
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, 'IF nMode = 1 THEN\n\tnA := 1;\nELSIF nMode = 2 OR nMode = 3 THEN\n\tnA := 2;\nELSE\n\tnA := 0;\nEND_IF\n');
  });
  await h.sleep(500);
  await p.evaluate(() => {
    const ta = document.getElementById('method-implementation-editor');
    ta.focus();
    ta.setSelectionRange(3, 3);
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
  });
  await h.sleep(400);
  // (the menu once more if it did not open: the editor still settling after the insert)
  if (!(await p.$('#editor-menu-if-to-case'))) {
    await h.sleep(800);
    await p.evaluate(() => {
      const ta = document.getElementById('method-implementation-editor');
      ta.focus();
      ta.setSelectionRange(3, 3);
      ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
    });
    await h.sleep(400);
  }
  const caseItem = await p.$eval('#editor-menu-if-to-case', (e) => e.textContent).catch(() => '');
  const menuIds = await p.$$eval('[id^="editor-menu-"]', (x) => x.map((e) => e.id)).catch(() => []);
  await p.click('#editor-menu-if-to-case').catch(() => {});
  // (shown first: the change, then Apply)
  const previewRows = await h.until(() => p.$$eval('#text-prompt-diff div', (x) => x.map((e) => e.textContent)).then((x) => (x.length ? x : null)), 3000);
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(300);
  expect(!!previewRows && previewRows.some((r) => /^\+\s*CASE nMode OF/.test(r)), `the change shown first: ${JSON.stringify(previewRows?.slice(0, 3))}`);
  const code = await p.$eval('#method-implementation-editor', (e) => e.value).catch(() => '');
  expect(/Convert to CASE/.test(caseItem) && code.startsWith('CASE nMode OF\n\t1:\n\t\tnA := 1;\n\t2, 3:\n\t\tnA := 2;\nELSE\n\tnA := 0;\nEND_CASE\n'), `Convert to CASE (item: ${JSON.stringify(caseItem)}, menu: ${JSON.stringify(menuIds)}): ${JSON.stringify(code.slice(0, 90))}`);

  expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

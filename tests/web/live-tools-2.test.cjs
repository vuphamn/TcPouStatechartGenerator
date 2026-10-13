const h = require('../lib/harness.cjs');
const fs = require('fs');
// More of the Live tab's and the editors' tools (XAE stand-in bridge): an alert on a watch expression; Pause on an
// expression; the timeline zoomed, a recording as a lane, CSV and SVG; each session's events kept beside the project;
// a TcUnit test added to the PLC project and its result read live; Blame in the Method Editor and Restore from a
// state's history; Convert to IF, Inline Method, state names for numbers; the nightly chip (development)
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const S = (n) => `TABLEMANAGER_${n}`;

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  // (the nightly run's result, as the dev server would serve it)
  await p.setRequestInterception(true);
  p.on('request', (r) => (/\/tests\/\.output\/nightly\/last\.json/.test(r.url()) ? r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ when: '2026-10-13T02:04:00Z', seconds: 250, passed: false, log: 'C:\\x.log' }) }) : r.continue()));
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const lv = await import('/src/utils/liveView.ts');
    const sa = await import('/src/utils/stateActions.ts');
    const s = mod.SAMPLES[0];
    const code = sa.readStateCode(s.pouContent, 'TABLEMANAGER_CLAMPED');
    const older = sa.writeStateCode(s.pouContent, 'TABLEMANAGER_CLAMPED', [...code, 'nHistoryProbe := 1;'].join('\n'));
    return { pou: s.pouContent, dut: s.dutContent, older: older.pou, values: Object.fromEntries([...lv.enumValueMap(s.dutContent)].map(([v, n]) => [n, v])) };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  const PATH = 'C:\\proj\\SM_TableManager.TcPOU';
  const sent = [];
  const saved = [];
  let liveValues = {};
  await p.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: PATH, content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'navigate') await toApp({ type: 'navigateResult', ok: false });
    else if (m.type === 'liveStart') await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    else if (m.type === 'liveStop') await toApp({ type: 'liveStatus', state: 'stopped', message: 'Stopped', instances: [] });
    else if (m.type === 'liveWatch') await toApp({ type: 'liveWatchResult', vars: m.vars.map((v) => ({ id: v.id, symbol: v.candidates[0], type: 'INT' })) });
    else if (m.type === 'gitLog') await toApp({ type: 'gitLogResult', requestId: m.requestId, commits: [{ hash: 'bbb2222', date: '2026-10-02 09:00', author: 'Ann', subject: 'the probe out', file: 'PLC/SM_TableManager.TcPOU' }, { hash: 'aaa1111', date: '2026-10-01 08:00', author: 'Bob', subject: 'a probe', file: 'PLC/SM_TableManager.TcPOU' }] });
    else if (m.type === 'gitShowAt') await toApp({ type: 'gitShowAtResult', requestId: m.requestId, content: m.hash === 'aaa1111' ? sample.older : sample.pou });
    else if (m.type === 'gitBlame') await toApp({ type: 'gitBlameResult', requestId: m.requestId, lines: sample.pou.split(/\r?\n/).map((text, i) => ({ hash: i % 2 ? 'bbb2222' : 'aaa1111', author: i % 2 ? 'Ann' : 'Bob', date: i % 2 ? '2026-10-02' : '2026-10-01', summary: 'x', text })) });
    else if (m.type === 'addPlcFiles') await toApp({ type: 'addPlcFilesResult', requestId: m.requestId, ok: true, written: m.files.map((f) => f.name), tcunit: true, folder: 'C:\\proj\\KssTests' });
    else if (m.type === 'webhook') await toApp({ type: 'webhookResult', requestId: m.requestId, ok: true });
    else if (m.type === 'runPlcTests') await toApp({ type: 'runPlcTestsResult', requestId: m.requestId, ok: true, message: 'KssPlc: built, downloaded and started: the tests run' });
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

  // 0. The nightly chip (development: the dev server's tests/.output/nightly/last.json)
  const chip = await h.until(() => p.$eval('#status-nightly', (e) => ({ passed: e.getAttribute('data-passed'), text: e.textContent })).catch(() => null), 4000);
  expect(chip?.passed === 'false' && /nightly ✗/.test(chip.text), `the nightly chip: ${chip?.text}`);

  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await p.waitForSelector('#live-start-btn', { timeout: 10000 }).catch(() => {});
  await p.click('#live-start-btn');
  await h.sleep(600);
  const vars = (list) => toApp({ type: 'liveVars', values: list.map(([id, v], i) => ({ id, t: Date.now() + i, v })) });

  // 1. An alert on a watch expression: said when it becomes true (an event of its own)
  await p.waitForSelector('#live-watch-expr-input', { timeout: 5000 }).catch(() => {});
  await p.type('#live-watch-expr-input', 'nFeedCount > 10');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  await p.click('.live-watch-expr .live-watch-alert').catch(() => {});
  const alertOn = await p.$eval('.live-watch-expr .live-watch-alert', (b) => b.getAttribute('data-on')).catch(() => null);
  await p.click('#live-events-toggle').catch(() => {});
  await p.type('#live-alerts-webhook', 'https://hooks.example/kss');
  await p.keyboard.press('Enter');
  await vars([['nfeedcount', 5]]);
  await h.sleep(300);
  await vars([['nfeedcount', 12]]);
  const alerted = await h.until(() => p.$$eval('.live-event[data-kind="alert"]', (x) => x.map((e) => e.textContent)).then((x) => (x.length ? x : null)), 4000);
  expect(alertOn === 'true' && !!alerted && /nFeedCount > 10 became true/.test(alerted[0]), `alert: ${alerted?.[0]}`);
  const hook = await h.until(() => sent.find((m) => m.type === 'webhook') ?? null, 4000);
  expect(hook?.url === 'https://hooks.example/kss' && /nFeedCount > 10 became true/.test(hook.text), `the webhook told: ${hook?.text}`);
  // (an alert that must last 1 s: not at once; said once it has)
  await p.click('.live-watch-expr .live-watch-alert-for').catch(() => {});
  await p.waitForSelector('#text-prompt-input', { timeout: 3000 }).catch(() => {});
  await p.evaluate(() => { const i = document.getElementById('text-prompt-input'); i.select(); });
  await p.keyboard.type('1');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  const forLabel = await p.$eval('.live-watch-expr .live-watch-alert-for', (e) => e.textContent).catch(() => '');
  const alertsNow = async () => p.$$eval('.live-event[data-kind="alert"]', (x) => x.length);
  const n0 = await alertsNow();
  await vars([['nfeedcount', 4]]);
  await h.sleep(200);
  await vars([['nfeedcount', 13]]);
  await h.sleep(400);
  const n1 = await alertsNow();
  const later = await h.until(async () => ((await alertsNow()) > n0 ? p.$eval('.live-event[data-kind="alert"]', (e) => e.textContent) : null), 4000);
  expect(forLabel === '1 s' && n1 === n0 && /became true \(for 1 s\)/.test(later ?? ''), `an alert after 1 s: not at once (${n1 - n0}), then: ${later}`);

  // 2. Pause on an expression (two variables): the view holds when it becomes true
  await p.type('#live-pause-when', 'nFeedCount > 20 AND bFeedOn');
  await p.keyboard.press('Enter');
  await h.sleep(300);
  const condChip = await p.$$eval('.live-pause-chip', (c) => c.map((x) => x.getAttribute('data-state')));
  const watchesBoth = await h.until(() => sent.filter((m) => m.type === 'liveWatch').some((m) => m.vars.some((v) => v.id === 'bfeedon')) || null, 4000);
  await vars([['bfeedon', true]]);
  await vars([['nfeedcount', 25]]);
  const banner = await h.until(() => p.$eval('#live-hold-banner', (e) => e.textContent).catch(() => null), 4000);
  expect(condChip.includes('nFeedCount > 20 AND bFeedOn') && !!watchesBoth && /nFeedCount > 20 AND bFeedOn/.test(banner ?? ''), `held on the expression: ${banner?.trim().slice(0, 80)}`);
  await p.click('#live-hold-resume').catch(() => {});
  await h.sleep(300);

  // 2b. Snapshots: two taken, the values that differ first; the events found by text; the webhook's test message
  await vars([['nfeedcount', 30], ['bfeedon', false]]);
  await h.sleep(200);
  await p.click('#live-snapshot-take').catch(() => {});
  await h.sleep(1100);
  await vars([['nfeedcount', 31]]);
  await h.sleep(200);
  await p.click('#live-snapshot-take').catch(() => {});
  await h.sleep(300);
  await p.$$eval('.live-snapshot input', (x) => x.forEach((i) => i.click()));
  const diffRows = await h.until(() => p.$$eval('#live-snapshots-compare .live-snapshot-row', (x) => x.map((r) => `${r.getAttribute('data-name')}:${r.getAttribute('data-same')}`)).then((x) => (x.length ? x : null)), 3000);
  expect(!!diffRows && diffRows[0] === 'nFeedCount:false' && diffRows.includes('bFeedOn:true'), `snapshots compared: ${JSON.stringify(diffRows)}`);
  await p.type('#live-events-find', 'became');
  await h.sleep(200);
  const found = await p.$$eval('.live-event', (x) => x.map((e) => e.getAttribute('data-kind')));
  expect(found.length > 0 && found.every((k) => k === 'alert' || k === 'hold'), `the events found by text: ${JSON.stringify(found)}`);
  await p.click('#live-alerts-webhook-test').catch(() => {});
  const testHook = await h.until(() => sent.find((m) => m.type === 'webhook' && /a test message/.test(m.text)) ?? null, 3000);
  expect(!!testHook, 'the webhook: a test message');

  // 3. The timeline: zoomed by the wheel (Now comes back), a recording as a lane, CSV and SVG
  const t0 = Date.now() - 40000;
  await toApp({ type: 'liveValues', events: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED'].map((s, i) => ({ t: t0 + i * 10000, value: sample.values[S(s)] })) });
  await p.waitForSelector('#live-timeline-lanes', { timeout: 5000 }).catch(() => {});
  await p.evaluate(() => {
    const el = document.getElementById('live-timeline-lanes');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: r.left + r.width * 0.7, clientY: r.top + 5 }));
  });
  await h.sleep(300);
  expect(!!(await p.$('#live-timeline-now')), 'zoomed: Now shown (back to following)');
  await p.click('#live-timeline-now').catch(() => {});
  const r0 = Date.UTC(2026, 9, 12, 8, 30);
  const rec = { kind: 'kval-machinescope-recording', version: 1, pou: 'SM_TableManager', instance: I, stateVar: 'machineState', started: r0, ended: r0 + 30000, values: ['IDLE_FEED_OFF', 'CLAMPPING', 'CLAMPED'].map((s, i) => ({ t: r0 + i * 12000, value: sample.values[S(s)] })), vars: [], watched: {} };
  const recFile = h.out('night.kssrec.json');
  fs.writeFileSync(recFile, JSON.stringify(rec));
  await (await p.$('#live-timeline-recording-file')).uploadFile(recFile);
  const lanes = await h.until(() => p.$$eval('.live-timeline-lane', (x) => x.map((e) => e.getAttribute('data-lane'))).then((x) => (x.length >= 2 ? x : null)), 4000);
  expect(!!lanes && lanes.includes('night'), `a recording as a lane: ${JSON.stringify(lanes)}`);
  await p.click('#live-timeline-span-All').catch(() => {});
  await p.click('#live-timeline-csv').catch(() => {});
  await p.click('#live-timeline-svg').catch(() => {});
  const csv = await h.until(() => saved.find((m) => /_timeline_.*\.csv$/.test(m.name)) ?? null, 4000);
  const svg = await h.until(() => saved.find((m) => /_timeline_.*\.svg$/.test(m.name)) ?? null, 4000);
  expect(!!csv && csv.content.startsWith('lane;state;from;to;ms') && /\nnight;TABLEMANAGER_IDLE_FEED_OFF;/.test(csv.content), `the timeline's CSV (${csv?.content.split('\n').length} rows)`);
  expect(!!svg && svg.content.startsWith('<svg') && svg.content.includes('TABLEMANAGER_CLAMPPING'), 'the timeline as SVG');
  await p.click('.live-event').catch(() => {});
  await h.sleep(300);
  expect(!!(await p.$('#live-timeline-now')) && /1 min|60/.test(await p.$eval('#live-timeline', (e) => e.textContent).catch(() => '')), 'an event picked: the timeline shows the minute around it');
  await p.click('#live-timeline-now').catch(() => {});
  await p.evaluate(() => { const i = document.getElementById('live-events-find'); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await h.sleep(200);
  const markers = await p.$$eval('#live-timeline-markers .live-timeline-marker', (x) => x.map((e) => e.getAttribute('data-kind')));
  expect(markers.includes('alert') && markers.includes('connect'), `the events on the timeline: ${JSON.stringify([...new Set(markers)])}`);
  const track = await p.evaluate(() => { const r = document.querySelectorAll('#live-timeline-lanes .live-timeline-track')[1].getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
  await p.keyboard.down('Shift');
  await p.mouse.move(track.x + track.w * 0.2, track.y);
  await p.mouse.down();
  await p.mouse.move(track.x + track.w * 0.6, track.y, { steps: 5 });
  await p.mouse.up();
  await p.keyboard.up('Shift');
  const measured = await p.$eval('#live-timeline-measure', (e) => e.textContent).catch(() => null);
  expect(/⟷ /.test(measured ?? ''), `Shift+drag measures: ${measured}`);

  // 4. Each session's events kept beside the project when it ends
  await p.click('#live-events-keep').catch(() => {});
  await p.click('#live-stop-btn').catch(() => {});
  const kept = await h.until(() => sent.find((m) => m.type === 'eventsSave') ?? null, 5000);
  expect(!!kept && /^SM_TableManager_\d{4}-\d\d-\d\d-\d\d-\d\d\.csv$/.test(kept.name) && /;connect;Live: /.test(kept.csv) && /;alert;/.test(kept.csv), `the session's events kept: ${kept?.name}`);

  // 5. A TcUnit test added to the PLC project; live, its result read (failed at step 1)
  const recFile2 = h.out('tcunit.kssrec.json');
  fs.writeFileSync(recFile2, JSON.stringify({ ...rec, vars: [{ id: 'cmd_bclamp', t: r0, v: false }, { id: 'cmd_bclamp', t: r0 + 9000, v: true }], watched: { cmd_bclamp: { symbol: `${I}.cmd_bClamp`, type: 'BOOL' } } }));
  await (await p.$('#live-open-recording')).uploadFile(recFile2);
  await p.waitForSelector('#live-replay-tcunit', { timeout: 5000 }).catch(() => {});
  await p.click('#live-replay-tcunit').catch(() => {});
  await p.waitForSelector('#text-prompt-submit', { timeout: 3000 }).catch(() => {});
  const addLabel = await p.$eval('#text-prompt-submit', (b) => b.textContent).catch(() => '');
  await p.click('#text-prompt-submit').catch(() => {});
  const added = await h.until(() => sent.find((m) => m.type === 'addPlcFiles') ?? null, 4000);
  expect(/Add to the PLC project/.test(addLabel) && added?.folder === 'KssTests' && added.files.map((f) => f.name).join() === 'FB_SM_TableManager_Test.TcPOU,PRG_KssTests.TcPOU' && /fbSM_TableManager_Test : FB_SM_TableManager_Test;/.test(added.files[1].content) && /TcUnit\.RUN\(\);/.test(added.files[1].content) && /nResult := 2;/.test(added.files[0].content), `added: ${added?.files.map((f) => f.name).join(', ')}`);
  await p.click('#live-stop-btn').catch(() => {});
  await h.sleep(300);
  await p.click('#live-start-btn').catch(() => {});
  const testWatch = await h.until(() => sent.filter((m) => m.type === 'liveWatch').some((m) => m.vars.some((v) => v.id === 'test:fb_sm_tablemanager_test:nresult' && v.candidates[0] === 'PRG_KssTests.fbSM_TableManager_Test.nResult')) || null, 5000);
  await vars([['test:fb_sm_tablemanager_test:nresult', 2], ['test:fb_sm_tablemanager_test:nfailedstep', 1]]);
  const testChip = await h.until(() => p.$eval('.live-test', (e) => ({ state: e.getAttribute('data-state'), text: e.textContent })).then((x) => (x.state === 'failed' ? x : null)).catch(() => null), 4000);
  expect(!!testWatch && /failed at step 1/.test(testChip?.text ?? ''), `the test's result live: ${testChip?.text}`);
  await p.click('#live-tests-run').catch(() => {});
  await p.waitForSelector('#text-prompt-check', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-check').catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  const ran = await h.until(() => sent.find((m) => m.type === 'runPlcTests') ?? null, 4000);
  const ranEvent = await h.until(() => p.$$eval('.live-event', (x) => x.map((e) => e.textContent)).then((x) => x.find((t) => /The TcUnit tests run/.test(t)) ?? null), 4000);
  expect(!!ran && !!ranEvent, `Run the tests: asked, then XAE told (${ranEvent})`);
  await p.click('#live-stop-btn').catch(() => {});
  await h.sleep(300);

  // 5b. A TcUnit test of a path (the Paths tab): its guards' inputs, saved
  await p.evaluate(() => document.getElementById('dock-tab-paths')?.click());
  await p.waitForSelector('#paths-from-select', { timeout: 8000 }).catch(() => {});
  await p.select('#paths-from-select', S('IDLE_FEED_OFF')).catch(() => {});
  await p.select('#paths-to-select', S('CLAMPED')).catch(() => {});
  await p.waitForSelector('.paths-tcunit', { timeout: 4000 }).catch(() => {});
  await p.click('.paths-tcunit').catch(() => {});
  await p.waitForSelector('#tcunit-save', { timeout: 3000 }).catch(() => {});
  const pathLabel = await p.$eval('#text-prompt-dialog', (e) => e.textContent).catch(() => '');
  await p.click('#tcunit-save').catch(() => {});
  const pathTest = await h.until(() => saved.find((m) => /_Path1_Test\.TcPOU$/.test(m.name)) ?? null, 4000);
  expect(/The path TABLEMANAGER_IDLE_FEED_OFF → /.test(pathLabel) && pathTest?.name === 'FB_SM_TableManager_Path1_Test.TcPOU' && /METHOD PRIVATE Path_/.test(pathTest.content) && /E_TableManager_States\.TABLEMANAGER_CLAMPED/.test(pathTest.content), `a path's TcUnit test: ${pathTest?.name}`);

  // 6. Blame in the Method Editor: who changed each line
  await p.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await p.waitForSelector('#method-blame-btn', { timeout: 10000 }).catch(() => {});
  await p.click('#method-blame-btn').catch(() => {});
  const blame = await h.until(() => p.$$eval('.st-blame', (x) => x.map((e) => e.getAttribute('title'))).then((x) => (x.length > 5 ? x : null)), 5000);
  expect(!!blame && blame.some((t) => /aaa1111 · Bob · 2026-10-01/.test(t)) && blame.some((t) => /bbb2222 · Ann/.test(t)) && sent.some((m) => m.type === 'gitBlame' && m.path === PATH), `blame: ${blame?.length} lines (${blame?.[0]?.split('\n')[0]})`);
  await p.click('.st-blame[data-blame-hash="bbb2222"]').catch(() => {});
  const commitTitle = await h.until(() => p.$eval('#state-history-dialog', (e) => e.textContent).catch(() => null), 5000);
  expect(/Commit bbb2222:/.test(commitTitle ?? '') && sent.some((m) => m.type === 'gitShowAt' && m.hash === 'bbb2222^'), `a blame bar's commit shown: ${(commitTitle ?? '').slice(0, 60)}`);
  await p.keyboard.press('Escape');
  await h.sleep(200);
  await p.click('#method-blame-btn').catch(() => {});
  await p.evaluate(() => document.getElementById('dock-tab-pou')?.click());
  await p.waitForSelector('#pou-blame-btn', { timeout: 8000 }).catch(() => {});
  await p.click('#pou-blame-btn').catch(() => {});
  const pouBlame = await h.until(() => p.$$eval('#pou-editor .st-blame', (x) => x.length).then((n) => (n ? n : null)), 4000);
  expect(!!pouBlame, `the POU Editor's body: blamed (${pouBlame} lines)`);
  await p.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await h.sleep(600);

  // 7. Convert to IF, Inline Method (offered on a method's call), state names for numbers
  const ID = 'method-implementation-editor';
  const menuAt = async (pos) => {
    await p.evaluate((id, pos) => {
      const ta = document.getElementById(id);
      ta.focus();
      ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 }));
    }, ID, pos);
    await h.sleep(400);
    return p.$$eval('[id^="editor-menu-"]', (x) => x.map((e) => ({ id: e.id, text: e.textContent })));
  };
  const clamped = sample.values[S('CLAMPED')];
  await p.evaluate((id, n) => {
    const ta = document.getElementById(id);
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, `CASE nMode OF\n\t1:\n\t\tnA := 1;\n\t2, 3:\n\t\tnA := 2;\nEND_CASE\nmachineState := ${n};\npreProcess();\n`);
  }, ID, clamped);
  await h.sleep(500);
  let menu = await menuAt(2);
  await p.click('#editor-menu-case-to-if').catch(() => {});
  await p.waitForSelector('#text-prompt-diff', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(300);
  const code = () => p.$eval(`#${ID}`, (e) => e.value);
  expect(menu.some((m) => m.id === 'editor-menu-case-to-if') && (await code()).startsWith('IF nMode = 1 THEN\n\tnA := 1;\nELSIF nMode = 2 OR nMode = 3 THEN\n\tnA := 2;\nEND_IF\n'), `Convert to IF: ${JSON.stringify((await code()).slice(0, 80))}`);
  const menu2 = await menuAt(2);
  const named = menu2.find((m) => m.id === 'editor-menu-numbers-to-enum');
  await p.click('#editor-menu-numbers-to-enum').catch(() => {});
  await p.waitForSelector('#text-prompt-diff', { timeout: 3000 }).catch(() => {});
  await p.click('#text-prompt-submit').catch(() => {});
  await h.sleep(300);
  expect(!!named && (await code()).includes('machineState := E_TableManager_States.TABLEMANAGER_CLAMPED;'), `state names for numbers: ${named?.text ?? menu2.map((m) => m.id).join(', ')}`);
  const callPos = (await code()).indexOf('preProcess();') + 2;
  menu = await menuAt(callPos);
  expect(menu.some((m) => m.id === 'editor-menu-inline-method' && /Inline Method preProcess\(\)/.test(m.text)), `Inline Method offered on a call: ${menu.map((m) => m.id).join(', ')}`);
  await p.keyboard.press('Escape');
  await h.sleep(200);

  // 8. Restore a state's branch from its history
  await p.evaluate(() => document.getElementById('dock-tab-diagram')?.click());
  await h.sleep(800);
  await p.evaluate((s) => [...(document.getElementById(`state-list-item-${s}`)?.querySelectorAll('button') ?? [])].find((b) => /Go to State/.test(b.textContent))?.click(), S('CLAMPED'));
  await h.sleep(1200);
  const pt = await p.evaluate((id) => { const r = document.querySelector(`#mermaid-canvas-area g.node[data-state-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, S('CLAMPED'));
  await p.mouse.click(pt.x, pt.y, { button: 'right' });
  await h.sleep(400);
  await p.click('#context-menu-state-history-btn').catch(() => {});
  await h.until(() => p.$('.state-history-restore'), 6000);
  await p.click('.state-history-version[data-hash="aaa1111"] .state-history-restore').catch(() => {});
  await h.sleep(500);
  await p.evaluate(() => document.getElementById('dock-tab-method')?.click());
  await h.sleep(800);
  expect((await code()).includes('nHistoryProbe := 1;'), 'Restore: the branch as in aaa1111 (the probe back)');

  expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

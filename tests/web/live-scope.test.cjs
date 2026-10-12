const h = require('../lib/harness.cjs');
const fs = require('fs');
// The Live tab's scope (XAE stand-in bridge): two watched variables charted (a BOOL, a number), their values coming in
// over time; the line drawn, the newest value shown; Pause holds the window while values keep coming; a click puts a
// cursor (each chart's value there); the 10 s / 1 min / 5 min span; CSV of what was recorded; kept per POU. The named
// watch lists (the host's MachineScope.watch.json): saved, loaded (replacing the watched ones), CSV out and in
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => p.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await p.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await p.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    return { pou: s.pouContent, dut: s.dutContent };
  });
  const I = 'MAIN.mainStateMachine.smTableManager';
  let saved = null;
  // (the host's watch lists: SM_TableManager's, one there already)
  const lists = { Feeding: ['nFeedCount', 'bFeedOn'] };
  const listMsgs = [];
  await p.exposeFunction('__hostPost', async (m) => {
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\\\proj\\\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\\\proj\\\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'liveStart') await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I] });
    else if (m.type === 'watchLists') {
      listMsgs.push(m);
      await toApp({ type: 'watchListsResult', requestId: m.requestId, lists });
    } else if (m.type === 'machineScopeFiles') {
      await toApp({ type: 'machineScopeFilesResult', requestId: m.requestId, dir: 'C:\proj', git: true, files: lists.Clamping ? [{ name: 'MachineScope.watch.json', path: 'C:\proj\MachineScope.watch.json', state: 'untracked' }] : [] });
    } else if (m.type === 'watchListSave') {
      listMsgs.push(m);
      if (m.vars === null) delete lists[m.name];
      else lists[m.name] = m.vars;
      await toApp({ type: 'watchListSaveResult', requestId: m.requestId, lists });
    } else if (m.type === 'saveDocument') {
      saved = m;
      await toApp({ type: 'saveDocumentResult', path: `C:\\\\docs\\\\${m.name}` });
    } else if (m.type === 'projectPous') await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
  });
  await p.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await p.evaluate(() => {
    localStorage.clear();
    // (two variables watched (as the editor's Watch keeps them))
    localStorage.setItem('kss.live.watch.SM_TableManager', JSON.stringify(['cmd_bUnclamp', 'nFeedCount']));
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#mermaid-canvas-area g.node', { timeout: 60000 });
  await h.sleep(800);
  await p.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await p.click('#live-start-btn');
  await h.sleep(600);
  await p.waitForSelector('#live-scope', { timeout: 8000 }).catch(() => {});

  // 1. Both charted
  await p.select('#live-scope-add', 'cmd_bUnclamp');
  await p.select('#live-scope-add', 'nFeedCount');
  await h.sleep(200);
  const charts = () => p.$$eval('.live-scope-chart', (c) => c.map((x) => ({ v: x.getAttribute('data-var'), value: x.querySelector('.live-scope-value')?.textContent, d: x.querySelector('.live-scope-line')?.getAttribute('d') ?? '' })));
  expect(JSON.stringify((await charts()).map((c) => c.v)) === JSON.stringify(['cmd_bUnclamp', 'nFeedCount']) && (await p.evaluate(() => localStorage.getItem('kss.scope|sm_tablemanager'))) === JSON.stringify(['cmd_bUnclamp', 'nFeedCount']), 'two watched variables charted, kept for the POU');

  // 2. Values over the last seconds (PLC time near now): the lines, the newest values
  const now = Date.now();
  await toApp({ type: 'liveVars', values: [{ id: 'cmd_bunclamp', t: now - 8000, v: false }, { id: 'nfeedcount', t: now - 8000, v: 1 }, { id: 'nfeedcount', t: now - 5000, v: 4 }, { id: 'cmd_bunclamp', t: now - 3000, v: true }, { id: 'nfeedcount', t: now - 1000, v: 7 }] });
  const drawn = await h.until(async () => { const c = await charts(); return c.length === 2 && c.every((x) => /H/.test(x.d)) && c[1].value === '7' ? c : null; }, 4000);
  expect(!!drawn && drawn[0].value === 'true', `charted: ${JSON.stringify((drawn ?? (await charts())).map((c) => `${c.v}=${c.value}`))}`);

  // 3. Pause: the window held, values keep coming (the newest not shown until Resume)
  await p.click('#live-scope-pause');
  await toApp({ type: 'liveVars', values: [{ id: 'nfeedcount', t: Date.now() + 100, v: 9 }] });
  await h.sleep(900);
  const pausedVal = (await charts())[1].value;
  await p.click('#live-scope-pause');
  const resumed = await h.until(async () => ((await charts())[1].value === '9' ? true : null), 3000);
  expect(pausedVal === '7' && !!resumed, `Pause: held at 7 while 9 came; Resume: 9 (${pausedVal})`);

  // 4. A cursor: each chart's value there (6 s before the window's end, a few seconds after the samples: unclamp
  // FALSE, the count 1 or 4)
  await p.click('#live-scope-span-10');
  await p.click('#live-scope-pause');
  await p.evaluate(() => {
    const svg = document.querySelectorAll('.live-scope-chart svg.live-scope-svg')[0];
    const r = svg.getBoundingClientRect();
    // (6 s before the right edge, of a 10 s window)
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.4, clientY: r.top + 5 }));
  });
  await h.sleep(200);
  const atCursor = (await charts()).map((c) => c.value);
  expect(!!(await p.$('#live-scope-cursor')) && atCursor[0] === 'false' && ['1', '4'].includes(atCursor[1]), `the cursor: ${JSON.stringify(atCursor)}`);
  await p.click('#live-scope-pause');

  // 5. CSV: every sample of both, in time order
  await p.click('#live-scope-csv');
  await h.until(() => saved, 4000);
  const lines = (saved?.content ?? '').split('\n');
  expect(/_scope_.*\.csv$/.test(saved?.name ?? '') && lines[0] === 'time;variable;value' && lines.length === 7 && /;cmd_bUnclamp;false$/.test(lines[1]) && /;nFeedCount;9$/.test(lines[6]), `CSV: ${saved?.name}, ${lines.length - 1} samples`);

  // 6. Off the scope
  await p.click('.live-scope-chart[data-var="nFeedCount"] .live-scope-remove');
  await h.sleep(200);
  expect(JSON.stringify((await charts()).map((c) => c.v)) === JSON.stringify(['cmd_bUnclamp']), 'one taken off');
  await p.screenshot({ path: h.out('live-scope.png') });

  // 7. Watch lists: the watched ones saved as "Clamping"; "Feeding" loaded (the watched ones replaced); CSV out, in
  const opts = await p.$$eval('#live-watch-list-load option', (o) => o.map((x) => x.value).filter(Boolean));
  expect(JSON.stringify(opts) === JSON.stringify(['Feeding']) && listMsgs.some((m) => m.type === 'watchLists' && m.pouType === 'SM_TableManager'), `the project's lists: ${JSON.stringify(opts)}`);
  await p.click('#live-watch-list-save');
  await p.waitForSelector('#live-watch-list-name', { timeout: 3000 });
  await p.type('#live-watch-list-name', 'Clamping');
  await p.keyboard.press('Enter');
  await h.until(() => (lists.Clamping ? true : null), 4000);
  expect(JSON.stringify(lists.Clamping) === JSON.stringify(['cmd_bUnclamp', 'nFeedCount']), `saved: Clamping = ${JSON.stringify(lists.Clamping)}`);
  // (its file beside the project, not in git yet: said on the bar)
  const sharedChip = (await h.until(() => p.$eval('#live-watch-lists-shared', (e) => e.getAttribute('data-state')).then((x) => (x === 'untracked' ? x : null)).catch(() => null), 6000)) ?? (await p.$eval('#live-watch-lists-shared', (e) => e.getAttribute('data-state')).catch(() => null));
  expect(sharedChip === 'untracked', `the lists' file: ${sharedChip} (not in git: commit it to share them)`);
  // (an untracked MachineScope file: the app asks once whether to stage or ignore it; not now)
  const asked = await h.until(() => p.$('#text-prompt-dialog'), 4000);
  expect(!!asked, 'the new file: asked to stage or ignore it');
  await p.keyboard.press('Escape');
  await h.sleep(300);
  await p.select('#live-watch-list-load', 'Feeding');
  const watchedNames = () => p.evaluate(() => JSON.parse(localStorage.getItem('kss.live.watch.SM_TableManager') || '[]'));
  const loaded = await h.until(async () => { const w = await watchedNames(); return JSON.stringify(w) === JSON.stringify(['nFeedCount', 'bFeedOn']) ? w : null; }, 4000);
  expect(!!loaded, `loaded: the watched ones now ${JSON.stringify(await watchedNames())}`);
  saved = null;
  await p.click('#live-watch-csv');
  await h.until(() => saved, 4000);
  expect(saved?.content === 'variable\nnFeedCount\nbFeedOn' && /_watch\.csv$/.test(saved?.name ?? ''), `CSV: ${JSON.stringify(saved?.content)}`);
  const csvIn = h.out('watch-in.csv');
  fs.writeFileSync(csvIn, 'variable;comment\ncmd_bUnclamp;the clamp\nnFeedCount;again\nnot a name!;x\n');
  await (await p.$('#live-watch-import')).uploadFile(csvIn);
  const imported = await h.until(async () => { const w = await watchedNames(); return w.length === 3 ? w : null; }, 4000);
  expect(JSON.stringify(imported) === JSON.stringify(['nFeedCount', 'bFeedOn', 'cmd_bUnclamp']), `imported: ${JSON.stringify(imported ?? (await watchedNames()))} (no repeat, no bad name)`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

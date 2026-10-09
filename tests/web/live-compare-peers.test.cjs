// Live on two PLCs at once (Compare…: the same POU live in another tab): two XAE stand-ins in one browser, live on
// 5.1.2.3.1.1 and 5.9.9.9.1.1. Each Live tab shows the other PLC with its current state (the same state as here: green)
// and Differences… compares the two sessions (Compare PLCs: time per state, the transitions only one took), kept
// current as the other PLC moves on; the other tab closed: gone from the list. Coverage on the chart: the transitions
// never taken dashed and dimmed while the Coverage strip's "On the chart" is on. The PLC's trial license end in a chip;
// a build of this copy listed by XAE before (projectBuilds) and run by the PLC later: an older build, with when; the
// comparison saved (both sides in one file) and opened again; coverage per commissioning session (each reset)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const I = 'MAIN.mainStateMachine';

  // An XAE stand-in live on that PLC: its state values sent on liveStart
  const saved = [];
  const coverageSaves = [];
  const open = async (target, values, opts = {}) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`${target}: ${e.message}`));
    const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
    await page.goto(h.APP_URL, { waitUntil: 'load' });
    const sample = await page.evaluate(async () => {
      const mod = await import('/src/samples/samplesData.ts');
      const s = mod.SAMPLES[0];
      const live = await import('/src/utils/liveView.ts');
      return { pou: s.pouContent, dut: s.dutContent, values: [...live.enumValueMap(s.dutContent)].map(([v, n]) => ({ v, n })) };
    });
    await page.exposeFunction('__hostPost', async (m) => {
      if (m.type === 'ready') {
        await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
      } else if (m.type === 'liveStart') {
        await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on ${target}:851 (PLC Run)`, target: `${target}:851`, plcState: 'Run', instance: I, instances: [I], instanceType: 'SM_TableManager', ...(opts.compileInfo ? { compileInfo: opts.compileInfo } : {}) });
        const t0 = Date.now() - values.length * 1000;
        await toApp({ type: 'liveValues', events: values.map((value, k) => ({ t: t0 + k * 1000, value })) });
      } else if (m.type === 'liveStop') {
        await toApp({ type: 'liveStatus', state: 'stopped', message: 'Stopped' });
      } else if (m.type === 'liveWatch') {
        await toApp({ type: 'liveWatchResult', vars: [] });
      } else if (m.type === 'projectPous') {
        // (the PLC project: this state machine and its enum, and a helper that is none)
        await toApp({
          type: 'projectPous',
          project: 'Line202',
          pous: [
            { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou },
            { name: 'FB_Helper.TcPOU', path: 'C:\\proj\\FB_Helper.TcPOU', content: '<TcPlcObject><POU Name="FB_Helper"><Declaration>FUNCTION_BLOCK FB_Helper</Declaration></POU></TcPlcObject>' },
          ],
          duts: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }],
        });
      } else if (m.type === 'projectBuilds') {
        await toApp({ type: 'projectBuildsResult', requestId: m.requestId, builds: opts.builds ?? [] });
      } else if (m.type === 'plcLicense') {
        await toApp({ type: 'plcLicenseResult', requestId: m.requestId, trial: opts.trial ?? null });
      } else if (m.type === 'saveDocument') {
        saved.push(m);
        await toApp({ type: 'saveDocumentResult', path: `C:\\Users\\me\\Documents\\${m.name}` });
      } else if (m.type === 'coverageFile') {
        await toApp({ type: 'coverageFileResult', requestId: m.requestId, pous: opts.coverageFile ?? {} });
      } else if (m.type === 'coverageFileSave') {
        coverageSaves.push({ target, ...m });
        await toApp({ type: 'coverageFileSaveResult', requestId: m.requestId, counts: m.counts });
      }
    });
    await page.evaluateOnNewDocument(() => {
      const listeners = [];
      window.chrome = window.chrome || {};
      window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
      window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
    await sleep(600);
    await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
    await sleep(400);
    await page.click('#live-start-btn');
    await sleep(800);
    return { page, toApp, sample };
  };

  // (A: its PLC's trial license runs out in 30 h; the project's coverage file: a colleague saw another transition)
  const SEEN_ELSEWHERE = 'TABLEMANAGER_HOMMING_READY_TO_START->TABLEMANAGER_HOMMING';
  const a = await open('5.1.2.3.1.1', [1, 2], {
    trial: { expires: new Date(Date.now() + 30 * 3600000).toISOString() },
    coverageFile: { SM_TableManager: { [SEEN_ELSEWHERE]: { n: 2, last: Date.parse('2026-10-08T09:00:00Z') } } },
  });
  await a.page.evaluate(() => localStorage.clear());
  const names = a.sample.values;
  const nameOf = (v) => names.find((x) => x.v === v)?.n;
  // (B: a longer session, ending in the state A is in)
  // (B: XAE listed build B1 when the POU opened; the PLC runs it while the copy's latest is B2 by now)
  const B1 = 'B1B1B1B1-0000-0000-0000-000000000001';
  const b = await open('5.9.9.9.1.1', [1, 3, 1, 2], {
    builds: [{ id: B1, at: '2026-10-08T20:42:44.000Z' }],
    compileInfo: { plc: B1, newest: { id: 'B2B2B2B2-0000-0000-0000-000000000002', at: '2026-10-09T00:05:02.000Z' }, state: 'other', builtAt: null },
  });
  const buildB = await b.page.evaluate(() => { const e = document.getElementById('live-build-state'); return e ? { state: e.getAttribute('data-state'), text: e.textContent.trim(), title: e.getAttribute('title') } : null; });
  expect(buildB?.state === 'older' && /older build/.test(buildB.text) && /seen here before/.test(buildB.title ?? ''), `a build listed before, run now: an older build (${JSON.stringify(buildB)})`);
  const lic = await a.page.evaluate(() => { const e = document.getElementById('live-license'); return e ? { level: e.getAttribute('data-level'), text: e.textContent.trim() } : null; });
  expect(lic?.level === 'soon' && /^trial until .*\(1 d [0-9]+ h\)$/.test(lic.text), `the trial license's end: a chip, soon (${JSON.stringify(lic)})`);

  // A's Live tab: B's PLC and its state (the same as A's: green)
  const peerOf = (page, plc) => page.evaluate((plc) => {
    const e = document.querySelector(`.live-peer[data-plc="${plc}"]`);
    return e ? { state: e.getAttribute('data-state'), same: !!e.querySelector('.text-emerald-300'), text: e.textContent.replace(/\s+/g, ' ').trim() } : null;
  }, plc);
  let peer = null;
  for (let t = 0; t < 8000 && !peer; t += 250) {
    peer = await peerOf(a.page, '5.9.9.9.1.1:851');
    if (!peer) await sleep(250);
  }
  expect(peer?.state === nameOf(2) && peer.same && /4 transitions|3 transitions/.test(peer.text), `A shows B live, in the same state (${peer?.text})`);
  let back = null;
  for (let t = 0; t < 8000 && !back; t += 250) {
    back = await peerOf(b.page, '5.1.2.3.1.1:851');
    if (!back) await sleep(250);
  }
  expect(back?.state === nameOf(2), `and B shows A (${back?.text})`);

  // Differences…: Compare PLCs, A this PLC, B the other
  await a.page.bringToFront();
  await sleep(300);
  await a.page.click('.live-peer-diff').catch(() => {});
  await a.page.waitForSelector('#compare-dialog', { timeout: 4000 }).catch(() => {});
  const dlg = await a.page.evaluate(() => ({
    title: document.querySelector('#compare-dialog .font-semibold')?.textContent ?? '',
    a: document.getElementById('compare-a')?.textContent ?? '',
    b: document.getElementById('compare-b')?.textContent ?? '',
    rows: document.querySelectorAll('#compare-table tbody tr').length,
  }));
  expect(dlg.title === 'Compare PLCs' && /^5\.1\.2\.3\.1\.1:851 \(1 transitions\)/.test(dlg.a) && /^5\.9\.9\.9\.1\.1:851 \(3 transitions\)/.test(dlg.b) && dlg.rows > 0, `Differences…: the two sessions compared (${JSON.stringify(dlg)})`);
  // From where they part: each one's path side by side (A: its one transition; B: its three)
  const paths = await a.page.evaluate(() => ({
    a: [...document.querySelectorAll('.compare-path-a .compare-path-step')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    b: [...document.querySelectorAll('.compare-path-b .compare-path-step')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
  }));
  expect(paths.a.length === 1 && paths.b.length === 3 && paths.a[0].startsWith(`${nameOf(1)} → ${nameOf(2)}`) && paths.b[0].startsWith(`${nameOf(1)} → ${nameOf(3)}`) && paths.b[1].startsWith(`${nameOf(3)} → ${nameOf(1)}`), `the paths from there, side by side (${JSON.stringify(paths)})`);
  // Where they part: both left the first state, A to the second, B to the third
  const first = await a.page.evaluate(() => { const e = document.getElementById('compare-first-diff'); return e ? { state: e.getAttribute('data-state'), same: e.getAttribute('data-same'), text: e.innerText.replace(/\s+/g, ' ') } : null; });
  expect(first?.state === nameOf(1) && first.same === '0' && new RegExp(`A: → ${nameOf(2)} after`).test(first.text) && new RegExp(`B: → ${nameOf(3)} after`).test(first.text) && !!(await a.page.$('#compare-first-diff-show')), `the first difference: in ${nameOf(1)}, what each did next (${first?.text.slice(0, 160)})`);
  // (B moves on: the dialog follows)
  await b.toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 3 }] });
  let bNow = '';
  for (let t = 0; t < 6000 && !/\(4 transitions\)/.test(bNow); t += 250) {
    await sleep(250);
    bNow = await a.page.evaluate(() => document.getElementById('compare-b')?.textContent ?? '');
  }
  expect(/\(4 transitions\)/.test(bNow), `kept current as B moves on (${bNow})`);
  peer = await peerOf(a.page, '5.9.9.9.1.1:851');
  expect(peer?.state === nameOf(3) && !peer.same, `B in another state than A: shown so (${peer?.text})`);
  // On A's chart: B's state outlined in B's colour, its name above (the same colour beside its name in the Live tab)
  const onChart = await a.page.evaluate(() => {
    const badge = document.querySelector('#mermaid-canvas-area g.peer-badge[data-plc="5.9.9.9.1.1:851"]');
    const node = badge?.closest('g.node');
    return badge ? { state: badge.getAttribute('data-state-id'), text: badge.textContent, color: node?.style.getPropertyValue('--peer-color'), marked: !!node?.classList.contains('peer-current-node'), swatch: document.querySelector('.live-peer .live-peer-color')?.style.background } : null;
  });
  expect(onChart?.state === nameOf(3) && onChart.marked && /5\.9\.9\.9\.1\.1:851/.test(onChart.text ?? '') && !!onChart.color && !!onChart.swatch, `B's state on A's chart, in its colour (${JSON.stringify(onChart)})`);
  await a.page.click('#compare-save').catch(() => {});
  for (let t = 0; t < 4000 && !saved.length; t += 200) await sleep(200);
  const file = saved[0];
  const savedName = await a.page.evaluate(() => document.getElementById('compare-saved')?.textContent ?? '');
  const content = file ? JSON.parse(file.content) : null;
  expect(/^SM_TableManager_5\.1\.2\.3\.1\.1_851_vs_5\.9\.9\.9\.1\.1_851\.comparison\.json$/.test(file?.name ?? '') && content?.kind === 'kss-live-comparison' && content.a.transitions.length === 1 && content.b.transitions.length === 4 && /comparison\.json$/.test(savedName), `Save comparison: both sides in one file (${file?.name}, ${savedName})`);
  await a.page.evaluate(() => document.querySelector('#compare-dialog button[title="Close"]')?.click());
  await sleep(300);
  if (content) {
    // (opened again: the recordings' Compare…, Open a saved comparison: both sides from the file)
    const tmp = path.join(h.OUT, 'saved.comparison.json');
    fs.writeFileSync(tmp, file.content);
    await a.page.evaluate(() => document.getElementById('live-compare')?.click());
    await a.page.waitForSelector('#compare-open-file', { timeout: 4000 }).catch(() => {});
    const input = await a.page.$('#compare-open-file');
    if (input) await input.uploadFile(tmp);
    let reopened = null;
    for (let t = 0; t < 4000 && !/5\.9\.9\.9/.test(reopened?.b ?? ''); t += 200) {
      await sleep(200);
      reopened = await a.page.evaluate(() => ({ a: document.getElementById('compare-a')?.textContent ?? '', b: document.getElementById('compare-b')?.textContent ?? '', rows: document.querySelectorAll('#compare-table tbody tr').length }));
    }
    expect(/^5\.1\.2\.3\.1\.1:851 \(1 transitions\)/.test(reopened?.a ?? '') && /^5\.9\.9\.9\.1\.1:851 \(4 transitions\)/.test(reopened?.b ?? '') && reopened.rows > 0, `the saved comparison opened again: both sides (${JSON.stringify(reopened)})`);
    // Show on chart: the comparison closes, the chart at the state where they part
    await a.page.click('#compare-first-diff-show').catch(() => {});
    await sleep(600);
    const shown = await a.page.evaluate(() => ({ open: !!document.getElementById('compare-dialog'), selected: document.querySelector('#mermaid-canvas-area g.node.selected, #mermaid-canvas-area g.node.node-selected, #mermaid-canvas-area g.node[data-selected="true"]')?.getAttribute('data-state-id') ?? null }));
    expect(!shown.open, `Show on chart: the comparison closed (${JSON.stringify(shown)})`);
  }
  await a.page.keyboard.press('Escape');
  await a.page.evaluate(() => document.querySelector('#compare-dialog button[title="Close"]')?.click());
  await sleep(300);

  // B closed: gone from A's list
  await b.page.close();
  for (let t = 0; t < 9000 && (await peerOf(a.page, '5.9.9.9.1.1:851')); t += 250) await sleep(250);
  expect(!(await peerOf(a.page, '5.9.9.9.1.1:851')) && !(await a.page.$('#live-peers')), 'B closed: gone from the list');
  expect(!(await a.page.$('#mermaid-canvas-area g.peer-badge')) && !(await a.page.$('#mermaid-canvas-area .peer-current-node')), "and from A's chart");

  // Coverage on the chart: the never-taken transitions dashed and dimmed while "On the chart" is on
  const cov = await a.page.evaluate(() => { const e = document.getElementById('live-coverage'); return e ? { taken: Number(e.getAttribute('data-taken')), total: Number(e.getAttribute('data-total')) } : null; });
  await a.page.click('#live-coverage-on-chart').catch(() => {});
  await sleep(500);
  const dashed = await a.page.evaluate(() => ({
    paths: document.querySelectorAll('#mermaid-canvas-area path.coverage-never').length,
    labels: document.querySelectorAll('#mermaid-canvas-area g.edgeLabel.coverage-never').length,
    dash: (() => { const p = document.querySelector('#mermaid-canvas-area path.coverage-never'); return p ? getComputedStyle(p).strokeDasharray : null; })(),
    pressed: document.getElementById('live-coverage-on-chart')?.getAttribute('aria-pressed'),
  }));
  expect(!!cov && cov.total - cov.taken > 0 && dashed.paths > 0 && dashed.paths <= cov.total - cov.taken && dashed.labels > 0 && /2px,\s*5px/.test(dashed.dash ?? '') && dashed.pressed === 'true', `on the chart: the never-taken dashed (${JSON.stringify({ cov, ...dashed })})`);
  await a.page.click('#live-coverage-on-chart').catch(() => {});
  await sleep(400);
  const after = await a.page.evaluate(() => document.querySelectorAll('#mermaid-canvas-area .coverage-never').length);
  expect(after === 0, `off: drawn as before (${after})`);

  // Coverage counted again (Reset…, asked): none taken since; one taken after; All time: every one again
  const covNow = () => a.page.evaluate(() => { const e = document.getElementById('live-coverage'); return e ? { taken: Number(e.getAttribute('data-taken')), since: !!document.getElementById('live-coverage-since') } : null; });
  await a.page.click('#live-coverage-reset').catch(() => {});
  await a.page.waitForSelector('#text-prompt-submit', { timeout: 4000 }).catch(() => {});
  const askedReset = await a.page.evaluate(() => document.getElementById('text-prompt-dialog')?.innerText ?? '');
  await a.page.click('#text-prompt-submit').catch(() => {});
  await sleep(400);
  const reset = await covNow();
  expect(/Count the coverage again\?/.test(askedReset) && reset?.taken === 0 && reset.since, `Reset: asked, counted from now (${JSON.stringify(reset)})`);
  await a.toApp({ type: 'liveValues', events: [{ t: Date.now() - 500, value: 1 }, { t: Date.now(), value: 2 }] });
  let since = reset;
  for (let t = 0; t < 4000 && !(since?.taken > 0); t += 250) {
    await sleep(250);
    since = await covNow();
  }
  expect(since?.taken >= 1 && since.taken <= cov.taken + 1, `a transition taken after the reset: counted (${JSON.stringify(since)})`);
  await a.page.click('#live-coverage-all').catch(() => {});
  await sleep(400);
  const all = await covNow();
  expect(all?.taken >= cov.taken && !all.since, `All time: every one taken again (${JSON.stringify(all)})`);
  // The commissioning sessions: before the reset, and since it (the transition taken after it)
  await a.page.click('#live-coverage-sessions-toggle').catch(() => {});
  await sleep(300);
  const sess = await a.page.$$eval('.live-coverage-session', (r) => r.map((e) => ({ text: e.textContent.replace(/\s+/g, ' ').trim(), taken: Number(e.getAttribute('data-taken')) })));
  expect(sess.length === 2 && /– now/.test(sess[0].text) && sess[0].taken >= 1 && /before the first reset/.test(sess[1].text) && sess[1].taken === cov.taken, `two sessions, newest first (${JSON.stringify(sess)})`);

  // The project's coverage (Project…): every state machine (the helper left out), this one's as in the Live tab
  const liveNow = await covNow();
  await a.page.click('#live-coverage-project').catch(() => {});
  await a.page.waitForSelector('#project-coverage-dialog', { timeout: 15000 }).catch(() => {});
  const proj = await a.page.evaluate(() => ({
    rows: [...document.querySelectorAll('.project-coverage-row')].map((r) => ({ pou: r.getAttribute('data-pou'), taken: Number(r.getAttribute('data-taken')), total: Number(r.getAttribute('data-total')) })),
    title: document.querySelector('#project-coverage-dialog .font-semibold')?.textContent ?? '',
  }));
  expect(proj.rows.length === 1 && proj.rows[0].pou === 'SM_TableManager' && proj.rows[0].taken === liveNow.taken && proj.rows[0].total === cov.total && /Line202/.test(proj.title), `the project's coverage: as in the Live tab (${JSON.stringify(proj)})`);
  // The sign-off report: the whole, the never-taken, lines to sign (saved through XAE)
  const before = saved.length;
  await a.page.click('#project-coverage-report').catch(() => {});
  for (let t = 0; t < 4000 && saved.length === before; t += 200) await sleep(200);
  const report = saved[before];
  expect(/^Line202-coverage-signoff\.html$/.test(report?.name ?? '') && /Line202: transition coverage/.test(report?.content ?? '') && /Never taken/.test(report.content) && /Commissioned by/.test(report.content) && new RegExp(`<b>${proj.rows[0].taken} of ${proj.rows[0].total}</b>`).test(report.content), `the sign-off report (${report?.name})`);

  // The project's coverage file: the colleague's transition counted here; this window's written back (with it)
  expect(liveNow.taken >= 2, `the coverage file: what was seen elsewhere counted (${liveNow.taken} taken)`);
  const written = coverageSaves.filter((s) => s.target === '5.1.2.3.1.1' && s.pouType === 'SM_TableManager').pop();
  expect(!!written && written.counts[SEEN_ELSEWHERE]?.n === 2 && Object.keys(written.counts).some((k) => k.startsWith(`${nameOf(1)}->`)), `this window's counts written to it (${Object.keys(written?.counts ?? {}).length} transitions)`);
  await a.page.keyboard.press('Escape');
  await sleep(300);
  expect(!(await a.page.$('#project-coverage-dialog')), 'Esc: closed');

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

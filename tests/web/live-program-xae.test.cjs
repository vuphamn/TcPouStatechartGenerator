// XAE stand-in: live on a PLC whose followed instance is of another type than the loaded POU (MAIN.mainStateMachine
// a TransferTable, SM_TableManager loaded): the Live tab says so, Open TransferTable asks XAE to open it; the XAE's
// build shown as its Remote Manager's ("XAE 4024.59"). Another program downloaded while connected (programChanged):
// Live stops and connects again; the instance now of the loaded POU's type: no warning. The project the PLC's
// configuration was activated from shown ("Active: TransferTable"); the PLC's enum of the state variable with a name
// the .TcDUT does not have for that value: said, with the difference; Update .TcDUT (asked): the warning gone. Another
// project active than the POU's (amber), Activate asks XAE; the PLC runs an older build of this copy (said); coverage;
// Compare on another PLC (Compare…, the PLC list while live): XAE asked for a new tab live on it
const h = require('../lib/harness.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(async () => {
  const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 1000 } });
  const errors = [];
  const I = 'MAIN.mainStateMachine';
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const toApp = (m) => page.evaluate((m) => window.__fromHost(m), m).catch(() => {});
  await page.goto(h.APP_URL, { waitUntil: 'load' });
  const sample = await page.evaluate(async () => {
    const mod = await import('/src/samples/samplesData.ts');
    const s = mod.SAMPLES[0];
    const live = await import('/src/utils/liveView.ts');
    // (the sample's enum as the PLC would have it: value -> name)
    const names = Object.fromEntries([...live.enumValueMap(s.dutContent)].map(([v, n]) => [String(v), n]));
    return { pou: s.pouContent, dut: s.dutContent, names };
  });
  const sent = [];
  // (the PLC's program: TransferTable, then SM_TableManager once "downloaded")
  let plcType = 'TransferTable';
  let plcNames = sample.names;
  await page.exposeFunction('__hostPost', async (m) => {
    sent.push(m);
    if (m.type === 'ready') {
      await toApp({ type: 'loadPou', source: { name: 'SM_TableManager.TcPOU', path: 'C:\\proj\\SM_TableManager.TcPOU', content: sample.pou, dutCandidates: [{ name: 'E_TableManager_States.TcDUT', relativePath: 'E_TableManager_States.TcDUT', path: 'C:\\proj\\E_TableManager_States.TcDUT', content: sample.dut }] } });
    } else if (m.type === 'liveStart') {
      await toApp({ type: 'liveStatus', state: 'connected', message: `${I}.machineState on 5.1.2.3.1.1:851 (PLC Run)`, target: '5.1.2.3.1.1:851', plcState: 'Run', instance: I, instances: [I], instanceType: plcType, symbolType: 'E_TableManager_States', stateNames: plcNames, activeProject: { name: 'TransferTable', created: '2026-10-07T11:03:36', plcProjects: ['TransferTable'] }, loadedProject: 'Line202', compileInfo: { plc: 'AAAAAAAA-0000-0000-0000-000000000001', newest: { id: 'BBBBBBBB-0000-0000-0000-000000000002', at: '2026-10-08T12:00:00Z' }, state: 'older', builtAt: '2026-10-07T12:00:00Z' }, twinCatBuild: 4024, xaeBuild: 4024, xaeVersion: '4024.59' });
      await toApp({ type: 'liveValues', events: [{ t: Date.now(), value: 2 }] });
    } else if (m.type === 'liveStop') {
      await toApp({ type: 'liveStatus', state: 'stopped', message: 'Stopped' });
    } else if (m.type === 'liveWatch') {
      await toApp({ type: 'liveWatchResult', vars: [] });
    } else if (m.type === 'activateProject') {
      await toApp({ type: 'activateResult', requestId: m.requestId, ok: true, message: 'Line202 activated: TwinCAT restarts in Run mode' });
    } else if (m.type === 'discoverPlcs') {
      setTimeout(() => toApp({ type: 'plcList', requestId: m.requestId, projectTarget: '', errors: [], devices: [{ netId: '5.9.9.9.1.1', ip: '192.168.1.20', name: 'CX-Other', route: true, source: 'network' }] }).catch(() => {}), 300);
    } else if (m.type === 'projectPous') {
      await toApp({ type: 'projectPous', project: 'P', pous: [], duts: [] });
    }
  });
  await page.evaluateOnNewDocument(() => {
    const listeners = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: (m) => window.__hostPost(m), addEventListener: (t, fn) => listeners.push(fn), removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
    window.__fromHost = (m) => listeners.forEach((fn) => fn({ data: m }));
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#mermaid-canvas-area g.node[data-state-id="TABLEMANAGER_HOMMING"]', { timeout: 60000 });
  await sleep(600);
  await page.evaluate(() => document.getElementById('dock-tab-live')?.click());
  await sleep(400);
  await page.click('#live-start-btn');

  // Another type than the loaded POU: said
  await page.waitForSelector('#live-type-mismatch', { timeout: 8000 }).catch(() => {});
  const warn = await page.evaluate(() => {
    const e = document.getElementById('live-type-mismatch');
    return e ? { text: e.textContent.replace(/\s+/g, ' ').trim(), type: e.getAttribute('data-plc-type'), open: !!document.getElementById('live-type-mismatch-open') } : null;
  });
  expect(!!warn && warn.type === 'TransferTable' && /MAIN\.mainStateMachine on this PLC is a TransferTable, not SM_TableManager/.test(warn.text) && warn.open, `another type: said, Open offered (${warn?.text.slice(0, 120)})`);
  const versions = await page.evaluate(() => document.getElementById('live-versions')?.textContent.trim() ?? '');
  expect(/XAE 4024\.59/.test(versions), `the XAE's build as its Remote Manager's (${versions})`);
  await page.click('#live-type-mismatch-open').catch(() => {});
  await sleep(500);
  expect(sent.some((m) => m.type === 'openPou' && m.typeName === 'TransferTable'), `Open TransferTable: XAE asked to open it (${JSON.stringify(sent.filter((m) => m.type === 'openPou'))})`);

  // Another program downloaded: stopped, connected again; the instance now the loaded POU's type
  plcType = 'SM_TableManager';
  // (its enum: value 2 named otherwise than in the .TcDUT)
  plcNames = { ...sample.names, 2: 'TABLEMANAGER_RENAMED' };
  const starts = () => sent.filter((m) => m.type === 'liveStart').length;
  const before = starts();
  await toApp({ type: 'liveStatus', state: 'programChanged', plcState: 'Run', message: "The PLC's program changed (a download or an activation)" });
  for (let t = 0; t < 6000 && starts() === before; t += 200) await sleep(200);
  expect(sent.some((m) => m.type === 'liveStop') && starts() === before + 1, `another program: Live stopped and connected again (${before} -> ${starts()} starts)`);
  await sleep(800);
  expect(!(await page.$('#live-type-mismatch')), 'connected again on the loaded POU\'s type: no warning');
  const active = await page.evaluate(() => document.getElementById('live-active-project')?.textContent.trim() ?? '');
  expect(active === '⚠ Active: TransferTable', `the project the PLC's configuration came from, not the POU's (${active})`);
  await page.waitForSelector('#live-enum-mismatch', { timeout: 4000 }).catch(() => {});
  const enumWarn = await page.evaluate(() => document.getElementById('live-enum-mismatch')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
  expect(new RegExp(`2: TABLEMANAGER_RENAMED on the PLC, ${sample.names['2']} in the \\.TcDUT`).test(enumWarn) && /1 difference/.test(enumWarn), `the PLC's enum against the .TcDUT: said, with the difference (${enumWarn.slice(0, 160)})`);

  // The PLC runs an older build of this project copy: said
  const build = await page.evaluate(() => { const e = document.getElementById('live-build-state'); return e ? { state: e.getAttribute('data-state'), text: e.textContent.trim() } : null; });
  expect(build?.state === 'older' && /older build/.test(build.text), `the PLC's build against this copy's: ${JSON.stringify(build)}`);

  // Activate the POU's project (asked first): XAE asked
  await page.click('#live-activate-project').catch(() => {});
  await page.waitForSelector('#text-prompt-submit', { timeout: 4000 }).catch(() => {});
  const askedActivate = await page.evaluate(() => document.getElementById('text-prompt-dialog')?.innerText ?? '');
  await page.click('#text-prompt-submit').catch(() => {});
  for (let t = 0; t < 3000 && !sent.some((m) => m.type === 'activateProject'); t += 200) await sleep(200);
  expect(/Activate Line202\?/.test(askedActivate) && sent.some((m) => m.type === 'activateProject'), `Activate: asked, then XAE asked (${askedActivate.replace(/\s+/g, ' ').slice(0, 80)})`);
  await sleep(400);

  // Update .TcDUT from the PLC (asked): the enum matches, the warning goes
  await page.click('#live-enum-update').catch(() => {});
  await page.waitForSelector('#text-prompt-submit', { timeout: 4000 }).catch(() => {});
  const askedEnum = await page.evaluate(() => document.getElementById('text-prompt-dialog')?.innerText ?? '');
  await page.click('#text-prompt-submit').catch(() => {});
  for (let t = 0; t < 4000 && (await page.$('#live-enum-mismatch')); t += 200) await sleep(200);
  expect(/1 renamed/.test(askedEnum) && new RegExp(`2: ${sample.names['2']} → TABLEMANAGER_RENAMED`).test(askedEnum) && !(await page.$('#live-enum-mismatch')), `Update .TcDUT: asked with the rename, then the enum matches (${askedEnum.replace(/\s+/g, ' ').slice(0, 120)})`);

  // Coverage: the chart's transitions against the ones taken
  const cov = await page.evaluate(() => { const e = document.getElementById('live-coverage'); return e ? { taken: Number(e.getAttribute('data-taken')), total: Number(e.getAttribute('data-total')) } : null; });
  expect(!!cov && cov.total > 5 && cov.taken >= 0 && cov.taken <= cov.total, `coverage: ${JSON.stringify(cov)}`);
  await page.click('#live-coverage-toggle').catch(() => {});
  await sleep(200);
  const never = await page.$$eval('.live-coverage-row', (r) => r.length).catch(() => 0);
  expect(never === cov.total - cov.taken, `the never-taken ones listed (${never})`);

  // Compare on another PLC (Compare…, the PLC list while live): XAE asked for a new tab live on it
  await page.click('#live-compare-btn').catch(() => {});
  await page.waitForSelector('.live-plc-compare[data-netid="5.9.9.9.1.1"]', { timeout: 6000 }).catch(() => {});
  await page.click('.live-plc-compare[data-netid="5.9.9.9.1.1"]').catch(() => {});
  await sleep(500);
  const open = sent.filter((m) => m.type === 'openInstance').pop();
  expect(open?.newTab === true && open.instance === I && open.connection?.netId === '5.9.9.9.1.1', `Compare: a new tab live on that PLC (${JSON.stringify(open)})`);

  expect(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
  await browser.close();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

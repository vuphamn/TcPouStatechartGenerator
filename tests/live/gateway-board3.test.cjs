// Operator board, round three (simulated PLC symbols-plc.cjs with its boot folder; the web app from a current dist/):
// - the tree view: the machines nested as in the program (smTable1 under the main one, aDoors' elements under it),
//   a branch closed shows what is under it;
// - Select: an alarm and a recording for the machines chosen (config.json, only those machines, made on the board);
//   their icons on the tiles; the recording played back on the board (its lanes, the tiles at the cursor);
// - saved filters: saved for operators with the machines chosen, opened by its link (&saved=), shown to a display
//   (view-only token) without Save; boardEditors: another user may not save one;
// - the I/O page: the device's boxes and their states (one not in OP), a non-Beckhoff box with its maker, the filter,
//   a linked channel charted live.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
const { unzip } = require('../../shared/tcSources.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8487;
const BASE = `http://localhost:${PORT}`;
const ALICE = 'board3-alice-token';
const BOB = 'board3-bob-token';
const WALL = 'board3-wall-token';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-board3.json', [], { sources: true });
  const plcConfig = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (its EtherCAT master: the coupler and the input terminal in OP, the output terminal in SAFEOP; a Lenze drive)
  plcConfig.ecat = [{ netId: '127.0.0.1.2.1', slaves: [[8, 0], [8, 0], [4, 0], [8, 0]] }];
  const tszip = Buffer.from(plcConfig.bootFiles['CurrentConfig.tszip'], 'base64');
  const files = Object.fromEntries(unzip(tszip, () => true).map((f) => [f.path, f.data.toString('utf8')]));
  const io = '_Config/IO/Device 1 (EtherCAT).xti';
  files[io] = files[io].replace('</Box></Device>', '</Box><Box Id="4" BoxType="9099"><Name>Feed VFD (Inverter i550 Cabinet)</Name><EtherCAT VendorId="#x0000003b" ProductCode="#x00005500" Type="i550 Cabinet" Desc="i550" PortABoxInfo="#x01000003"><SuName>Lenze</SuName><Pdo Name="Outputs" Index="#x1600" InOut="1"><Entry Name="Speed setpoint" Index="#x6042" Sub="#x00"><Type>INT</Type></Entry></Pdo></EtherCAT></Box></Device>');
  plcConfig.bootFiles['CurrentConfig.tszip'] = writeZip(files).toString('base64');
  fs.writeFileSync(cfg, JSON.stringify(plcConfig));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48983', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-board3');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48983', port: 851 }],
    tokens: [{ name: 'alice', sha256: sha(ALICE) }, { name: 'bob', sha256: sha(BOB) }, { name: 'wall', sha256: sha(WALL), view: true }],
    boardEditors: ['alice'],
    projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-board3-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // boardEditors over the protocol: bob may not save a filter, nor add an alarm
  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: BOB }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'boardList' }));
  ws.send(JSON.stringify({ type: 'boardFilterSave', requestId: 1, filter: { name: 'Bob\'s', audience: 'operators' } }));
  ws.send(JSON.stringify({ type: 'boardRuleSave', requestId: 2, kind: 'alarm', rule: { name: 'x', plc: 'line202', root: R, machines: [`${R}.smTable1`], onError: true } }));
  const refused = await h.until(() => (got.some((m) => m.requestId === 1) && got.some((m) => m.requestId === 2) ? got : null), 5000);
  const r1 = refused?.find((m) => m.requestId === 1);
  const r2 = refused?.find((m) => m.requestId === 2);
  const meta = got.find((m) => m.type === 'boardFilters');
  expect(r1?.ok === false && /boardEditors/.test(r1.error) && r2?.ok === false && meta?.canEdit === false, `bob may not save (boardEditors): ${r1?.error}; ${r2?.error}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('io-board-filter'));
  if (!built) {
    console.log('skip the browser part: dist/ is an older build (npm run build)');
  } else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('dialog', (d) => void d.accept());
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', ALICE);
    await p.keyboard.press('Enter');
    await p.waitForSelector('.board-tile[data-path$="smTable1"], .board-row[data-path$="smTable1"]', { timeout: 20000 }).catch(async (e) => {
      console.log(`the board: ${(await p.evaluate(() => document.body.innerText)).slice(0, 800)}\nerrors: ${errors.join(' | ')}`);
      throw e;
    });
    // (flat first)
    if (await p.$('.board-tree')) await p.click('#board-layout');

    // 1. The tree: nested as in the program
    await p.click('#board-layout');
    await p.waitForSelector('.board-tree', { timeout: 5000 });
    const tree = await p.evaluate(() => {
      const node = (k) => document.querySelector(`.board-tree-node[data-tree-key="${k}"]`);
      const main = node('main.mainstatemachine');
      const under = (parent, k) => !!parent && !!parent.querySelector(`.board-tree-node[data-tree-key="${k}"]`);
      return {
        main: !!main?.querySelector(':scope > div .board-row'),
        table: under(main, 'main.mainstatemachine.smtable1'),
        doors: under(main, 'main.mainstatemachine.adoors') && under(node('main.mainstatemachine.adoors'), 'main.mainstatemachine.adoors[2]'),
      };
    });
    expect(tree.main && tree.table && tree.doors, `the tree: the main machine, smTable1 under it, aDoors[2] under aDoors: ${JSON.stringify(tree)}`);
    // (aDoors closed: what is under it, its 2 machines; its children hidden)
    await p.click('.board-tree-node[data-tree-key="main.mainstatemachine.adoors"] > div .board-tree-toggle');
    await p.waitForSelector('.board-tree-node[data-tree-key="main.mainstatemachine.adoors"][data-closed="true"]', { timeout: 3000 }).catch(() => {});
    const rollup = await p.$eval('.board-tree-node[data-tree-key="main.mainstatemachine.adoors"] .board-tree-rollup', (e) => e.textContent).catch(() => '');
    expect(/^(1 error · )?2$/.test(rollup.trim()) && !(await p.$('.board-tree-node[data-tree-key="main.mainstatemachine.adoors[2]"]')), `aDoors closed: "${rollup}"`);
    await p.click('.board-tree-node[data-tree-key="main.mainstatemachine.adoors"] > div .board-tree-toggle');

    // 2. Select two machines: an alarm and a recording of them
    await p.click('#board-select');
    await p.click(`.board-row[data-path="${R}.smTable1"]`);
    await p.click(`.board-row[data-path="${R}.aDoors[1]"]`);
    const count = await p.$eval('#board-selected-count', (e) => e.textContent);
    await p.click('#board-sel-alarm');
    await p.waitForSelector('#board-alarm-dialog');
    await p.$eval('#board-rule-stuck', (e) => { e.value = ''; });
    await p.click('#board-rule-stuck', { clickCount: 3 });
    await p.type('#board-rule-stuck', '120');
    await p.click('#board-rule-save');
    await h.until(() => p.$('#board-alarm-dialog').then((x) => !x), 8000);
    let conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const alarm = (conf.alerts ?? [])[0];
    expect(count === '2 chosen' && alarm && alarm.machines?.length === 2 && alarm.stuckAfterMs === 120000 && alarm.fromBoard?.by === 'alice' && alarm.onPlcStop === false, `an alarm for the 2 chosen: ${JSON.stringify(alarm && { machines: alarm.machines, stuck: alarm.stuckAfterMs, by: alarm.fromBoard?.by })}`);
    await p.click('#board-select');
    await p.click(`.board-row[data-path="${R}.smTable1"]`);
    await p.click(`.board-row[data-path="${R}.aDoors[1]"]`);
    await p.click('#board-sel-record');
    await p.waitForSelector('#board-recording-dialog');
    await p.click('#board-rule-save');
    await h.until(() => p.$('#board-recording-dialog').then((x) => !x), 8000);
    conf = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const rec = (conf.recordings ?? [])[0];
    expect(rec && rec.machines?.length === 2 && rec.days === 7 && rec.fromBoard?.by === 'alice', `a recording of them: ${JSON.stringify(rec && { id: rec.id, machines: rec.machines })}`);
    const marks = await h.until(() => p.evaluate((r) => {
      const row = document.querySelector(`.board-row[data-path="${r}.smTable1"]`);
      const other = document.querySelector(`.board-row[data-path="${r}.smTable2"]`);
      return row?.querySelector('.board-recorded') && row?.querySelector('.board-alarmed') && !other?.querySelector('.board-recorded') ? 'yes' : null;
    }, R), 8000);
    expect(marks === 'yes', 'their icons: recorded and alarmed (smTable1), not smTable2');

    // 3. Played back: the recording's lanes, the tiles at the cursor
    await h.sleep(5000);
    await p.click('#board-select');
    await p.click(`.board-row[data-path="${R}.smTable1"]`);
    await p.click(`.board-row[data-path="${R}.smTable2"]`);
    await p.click('#board-sel-playback');
    await p.waitForSelector('#board-playback', { timeout: 5000 });
    const lanes = await h.until(() => p.$$eval('.board-playback-lane', (ls) => ls.map((l) => ({ path: l.getAttribute('data-path'), bars: l.querySelectorAll('span[style*="left"]').length - 1, text: l.textContent }))).then((x) => (x.length === 2 && x.some((l) => l.bars > 0) ? x : null)), 15000);
    const t1 = lanes?.find((l) => l.path.endsWith('smTable1'));
    const t2 = lanes?.find((l) => l.path.endsWith('smTable2'));
    expect(t1?.bars > 0 && /Not recorded/.test(t2?.text ?? ''), `played back: smTable1 ${t1?.bars} stay(s), smTable2: "${t2?.text}"`);
    // (the cursor at the end: smTable1 in its recorded state; smTable2, not in the playback, dimmed)
    await p.$eval('#board-playback .cursor-pointer', (e) => {
      const r = e.getBoundingClientRect();
      e.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.right - 1, clientY: r.top + 2 }));
    });
    const atCursor = await p.evaluate((r) => ({ t1: document.querySelector(`.board-row[data-path="${r}.smTable1"] .board-state`)?.textContent, dim: document.querySelector(`.board-row[data-path="${r}.smTable2"]`)?.className.includes('opacity-40') }), R);
    expect(!!atCursor.t1 && !/^(—|\.\.\.)$/.test(atCursor.t1) && atCursor.dim, `at the cursor: smTable1 ${atCursor.t1}, smTable2 dimmed: ${atCursor.dim}`);
    await p.click('#board-playback-close');

    // 4. A saved filter for operators: the machines chosen, the tree; its link opens it
    await p.click('#board-select');
    await p.click(`.board-row[data-path="${R}.smTable1"]`);
    await p.click(`.board-row[data-path="${R}.smTable2"]`);
    await p.click('#board-filters-btn');
    await p.click('#board-filter-save-new').catch(async (e) => {
      await p.screenshot({ path: h.out('board3-filters.png') });
      console.log(`the menu: ${await p.$eval('#board-filters-menu', (m) => m.textContent).catch(() => '(not open)')}`);
      throw e;
    });
    if (!(await p.$('#board-filter-name'))) {
      await p.screenshot({ path: h.out('board3-filters.png') });
      console.log(`the menu after Save: ${await p.$eval('#board-filters-menu', (m) => m.textContent).catch(() => '(not open)')}`);
    }
    await p.type('#board-filter-name', 'Tables (operators)');
    await p.select('#board-filter-audience', 'operators');
    await p.click('#board-filter-save');
    await h.until(() => p.$('#board-filter-form').then((x) => !x), 5000);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'board-filters.json'), 'utf8')).filters[0];
    const shownNow = await p.$$eval('.board-row', (rs) => rs.map((r) => r.getAttribute('data-path')));
    expect(saved?.audience === 'operators' && saved.machines.length === 2 && saved.layout === 'tree' && shownNow.length === 2, `saved for operators: ${saved?.name}, ${saved?.machines.length} machines; the board shows ${shownNow.length}`);
    // (a display, by its link: the same machines, the tree; no Save, no Select)
    const wall = await browser.newPage();
    wall.on('pageerror', (e) => errors.push(e.message));
    await wall.goto(`${BASE}/?board&view=${WALL}&saved=${saved.id}`, { waitUntil: 'load' });
    const wallRows = await h.until(() => wall.$$eval('.board-row', (rs) => rs.map((r) => r.getAttribute('data-path'))).then((x) => (x.length === 2 ? x : null)), 15000);
    await wall.click('#board-filters-btn');
    const wallMenu = await wall.evaluate(() => ({ save: !!document.querySelector('#board-filter-save-new'), select: !!document.querySelector('#board-select'), active: document.querySelector('#board-filter-active')?.textContent }));
    expect(wallRows?.length === 2 && !wallMenu.save && !wallMenu.select && wallMenu.active === 'Tables (operators)', `a display by its link: ${wallRows?.length} machines, "${wallMenu.active}", Save ${wallMenu.save}, Select ${wallMenu.select}`);
    await wall.close();
    await p.click('#board-filter-off');

    // 5. The I/O page: boxes and states, a non-Beckhoff box, the filter, a linked channel charted
    await p.click('#board-page-io');
    await p.waitForSelector('.io-board-box', { timeout: 15000 });
    const boxes = await h.until(() => p.$$eval('.io-board-box', (bs) => bs.map((b) => ({ path: b.getAttribute('data-box'), kind: b.getAttribute('data-kind'), vendor: b.querySelector(':scope > div .io-board-vendor')?.textContent ?? '' }))).then((x) => (x.some((b) => b.kind === 'bad') ? x : null)), 10000);
    const el2008 = boxes?.find((b) => /EL2008/.test(b.path));
    const vfd = boxes?.find((b) => /i550/.test(b.path));
    const counts = await p.$eval('.io-board-counts', (e) => e.textContent).catch(() => '');
    expect(boxes?.length === 4 && el2008?.kind === 'bad' && vfd?.vendor === 'Lenze' && /4 boxes: 3 OP, 1 not OK/.test(counts), `the I/O: ${boxes?.map((b) => `${b.path.split('^').pop()} ${b.kind}${b.vendor ? ` (${b.vendor})` : ''}`).join(', ')}; "${counts}"`);
    await p.type('#io-board-filter', 'lenze');
    const lenze = await p.$$eval('.io-board-box', (bs) => bs.map((b) => b.getAttribute('data-box').split('^').pop()));
    await p.click('#io-board-filter', { clickCount: 3 });
    await p.type('#io-board-filter', 'EL2008');
    const filtered = await p.$$eval('.io-board-box', (bs) => bs.map((b) => b.getAttribute('data-box').split('^').pop()));
    expect(lenze.length === 1 && /i550/.test(lenze[0]) && filtered.length === 2 && filtered.some((b) => /EL2008/.test(b)) && filtered.some((b) => /EK1100/.test(b)), `filter "lenze": ${lenze.join(', ')}; "EL2008": ${filtered.join(', ')} (with the coupler it hangs on)`);
    await p.click('#io-board-filter', { clickCount: 3 });
    await p.keyboard.press('Escape');
    await p.type('#io-board-filter', 'bEnable');
    await p.waitForSelector('.io-board-signal', { timeout: 5000 });
    await p.click('.io-board-signal');
    const lane = await h.until(() => p.$eval('.board-trend-lane .board-trend-value', (e) => e.textContent).then((t) => (t && t !== '—' ? t : null)).catch(() => null), 10000);
    expect(lane === 'TRUE' || lane === 'FALSE', `MAIN.mainStateMachine.bEnable charted live: ${lane}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  const log = fs.readFileSync(logFile, 'utf8');
  expect(/board: alice added the alarm/.test(log) && /board: alice saved the filter/.test(log) && /io board: alice watches/.test(log), 'said in the log');
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

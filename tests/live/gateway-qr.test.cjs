// QR labels and the phone view (simulated PLC symbols-plc.cjs with an i550 drive on its EtherCAT master; the web app
// from dist/): labels of chosen machines (each a QR code of its address on the board); a machine's address opening it
// on a phone (its state, what to do, Call maintenance, back to the whole board); a drive's opening its health; an I/O
// box's opening its properties; the I/O page's labels.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
const { unzip } = require('../../shared/tcSources.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8503;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'qr-test-token';
const MASTER = '127.0.0.1.2.1';
const DRIVE = 'Device 1 (EtherCAT)^Feed (Inverter i550 Cabinet)';
const BOX = 'Device 1 (EtherCAT)^Term 1 (EK1100)^Term 2 (EL1008)';

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-qr.json', [], { sources: true });
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const files = Object.fromEntries(unzip(Buffer.from(c.bootFiles['CurrentConfig.tszip'], 'base64'), () => true).map((f) => [f.path, f.data.toString('utf8')]));
  const io = '_Config/IO/Device 1 (EtherCAT).xti';
  files[io] = files[io].replace('</Box></Device>', '</Box><Box Id="4" BoxType="9099"><Name>Feed (Inverter i550 Cabinet)</Name><EtherCAT VendorId="#x0000003b" ProductCode="#x69055000" Type="i550 Cabinet V05.02.xx" Desc="Inverter i550 Cabinet" PortABoxInfo="#x01000003"><SuName>Lenze</SuName></EtherCAT></Box></Device>');
  c.bootFiles['CurrentConfig.tszip'] = writeZip(files).toString('base64');
  c.ecat = [{ netId: MASTER, slaves: [[8, 0], [8, 0], [8, 0], [8, 0]], addresses: [1001, 1002, 1003, 1004] }];
  c.coe = { [`${MASTER}|1004`]: { '2d84:1': { size: 2, value: 450, signed: true }, '2d88:0': { size: 2, value: 40 }, '603f:0': { size: 2, value: 0 } } };
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48992', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-qr');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 10', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48992', port: 851 }],
    tokens: [{ name: 'tech', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 10', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: false, webhook: null, format: 'json' }],
    andon: { steps: { DOOR_DASHER_ERROR: 'Check the door sensor S12, then press Reset' } },
    drives: { everySeconds: 5 }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-qr-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('focus-view'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    await p.waitForSelector(`.board-tile[data-path="${R}.aDoors[2]"]`, { timeout: 20000 });
    // 1. Labels of two machines
    await p.click('#board-select');
    await p.click(`.board-tile[data-path="${R}.aDoors[2]"]`);
    await p.click(`.board-tile[data-path="${R}.smTable1"]`);
    await p.click('#board-sel-qr');
    const labels = await h.until(() => p.$$eval('.qr-label', (x) => x.map((e) => ({ focus: e.getAttribute('data-focus'), svg: !!e.querySelector('svg path') }))).then((x) => (x.length === 2 && x.every((l) => l.svg) ? x : null)), 8000);
    expect(labels?.length === 2 && labels.some((l) => l.focus === `m:line|${R}.aDoors[2]`), `QR labels: ${labels?.map((l) => l.focus).join(', ')}`);
    await p.click('#qr-sheet button[title="Close"]');
    // 2. A machine's label, on a phone
    const phone = await browser.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.setViewport({ width: 390, height: 844 });
    await phone.goto(`${BASE}/?board&focus=${encodeURIComponent(`m:line|${R}.aDoors[2]`)}`, { waitUntil: 'load' });
    await phone.waitForSelector('#board-token', { timeout: 10000 }).catch(() => {});
    if (await phone.$('#board-token')) {
      await phone.type('#board-token', TOKEN);
      await phone.keyboard.press('Enter');
    }
    const view = await h.until(() => phone.evaluate(() => ({ state: document.querySelector('#focus-state')?.textContent, todo: document.querySelector('#focus-todo')?.textContent ?? '' })).then((x) => (x.state === 'DOOR_DASHER_ERROR' && x.todo ? x : null)), 20000);
    await phone.click('#focus-call');
    await phone.waitForSelector('.focus-reason', { timeout: 5000 });
    await phone.click('.focus-reason');
    const said = await h.until(() => phone.evaluate(() => document.body.innerText.match(/Maintenance called: \w+/)?.[0] ?? null), 5000);
    await phone.click('#focus-back');
    const back = await phone.$('#focus-view');
    expect(!!view && /door sensor S12/.test(view.todo) && !!said && !back, `a machine's label: ${view?.state}, "${view?.todo.slice(0, 40)}…", ${said}, back to the board ${!back}`);
    // 3. A drive's label: its health opened
    await phone.goto(`${BASE}/?board&focus=${encodeURIComponent(`d:line|${DRIVE}`)}`, { waitUntil: 'load' });
    const drive = await h.until(() => phone.$eval('#drive-detail', (e) => e.textContent).catch(() => null), 25000);
    expect(/Feed/.test(drive ?? '') && /Heatsink/.test(drive ?? ''), `a drive's label: its detail (${(drive ?? '').slice(0, 50)}…)`);
    // 4. A box's label: its properties
    await phone.goto(`${BASE}/?board&focus=${encodeURIComponent(`b:line|${BOX}`)}`, { waitUntil: 'load' });
    const box = await h.until(() => phone.$eval('#io-board-props', (e) => e.textContent).catch(() => null), 20000);
    const filter = await phone.$eval('#io-board-filter', (e) => e.value).catch(() => '');
    expect(/EL1008/.test(box ?? '') && /EL1008/.test(filter), `a box's label: its properties, filtered to "${filter}"`);
    // 5. The I/O page's labels (its filter: EL1008)
    await phone.click('#io-board-props button[title^="Close"]').catch(() => {});
    await phone.keyboard.press('Escape');
    await phone.evaluate(() => document.querySelector('#io-board-props')?.remove());
    await phone.click('#io-board-qr');
    const boxLabels = await h.until(() => phone.$$eval('.qr-label', (x) => x.map((e) => e.getAttribute('data-focus'))).then((x) => (x.length ? x : null)), 8000);
    expect(boxLabels?.length === 1 && boxLabels[0] === `b:line|${BOX}`, `the I/O page's labels: ${boxLabels?.join(', ')}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

// The risk list and the inventory (gateway/fleet.cjs, gateway/risk.cjs; simulated PLC symbols-plc.cjs with its
// EtherCAT master; the web app from dist/): a terminal out of OP now (alarm), a coupler whose CRC errors rise (watch),
// a drive whose heatsink rose 1 °C a day for 6 days (near its threshold in about 20 days), a machine with 6 faults this
// week and none the week before; the inventory by maker, type and firmware (two i550 firmware versions marked). The
// board's Risk page and its Inventory.
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
const PORT = 8495;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'fleet-test-token';
const MASTER = '127.0.0.1.2.1';
const DEV = 'Device 1 (EtherCAT)';
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-fleet.json', [], { sources: true });
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const files = Object.fromEntries(unzip(Buffer.from(c.bootFiles['CurrentConfig.tszip'], 'base64'), () => true).map((f) => [f.path, f.data.toString('utf8')]));
  const io = '_Config/IO/Device 1 (EtherCAT).xti';
  const i550 = (id, name, rev, fw) => `<Box Id="${id}" BoxType="9099"><Name>${name} (Inverter i550 Cabinet)</Name><EtherCAT VendorId="#x0000003b" ProductCode="#x69055000" RevisionNo="${rev}" Type="i550 Cabinet ${fw}" Desc="Inverter i550 Cabinet" PortABoxInfo="#x01000003"><SuName>Lenze</SuName></EtherCAT></Box>`;
  files[io] = files[io].replace('</Box></Device>', `</Box>${i550(4, 'Drive A', '#x00050002', 'V05.02.xx')}${i550(5, 'Drive B', '#x00060004', 'V06.04.xx')}</Device>`);
  c.bootFiles['CurrentConfig.tszip'] = writeZip(files).toString('base64');
  // (EK1100 and EL1008 in OP, EL2008 in SAFEOP, the drives in OP; the coupler's CRC errors rising after two reads)
  const slaves = [[8, 0], [8, 0], [4, 0], [8, 0], [8, 0]];
  c.ecat = [{ netId: MASTER, slaves, addresses: [1001, 1002, 1003, 1004, 1005], crc: slaves.map(() => [0, 0, 0, 0]), down: { afterReads: 4, slaves, crc: [[30, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] } }];
  // (the drives answer, healthy)
  const lenze = (heatsink) => ({ '2ddd:0': { size: 2, value: 500, signed: true }, '2d88:0': { size: 2, value: 52 }, '2d84:1': { size: 2, value: heatsink, signed: true }, '2d84:2': { size: 2, value: 800, signed: true }, '603f:0': { size: 2, value: 0 }, '2d87:0': { size: 2, value: 560 } });
  c.coe = { [`${MASTER}|1004`]: lenze(560), [`${MASTER}|1005`]: lenze(420) };
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48988', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-fleet');
  fs.rmSync(dir, { recursive: true, force: true });
  // (Drive A's heatsink: 50, 51 … 55 °C over the 6 days before today)
  const summary = { days: {} };
  for (let k = 6; k >= 1; k--) summary.days[dayOf(Date.now() - k * 86400000)] = { [`${DEV}^Drive A (Inverter i550 Cabinet)`]: { heatsink: { median: 56 - k, n: 2000 }, counters: {} } };
  fs.mkdirSync(path.join(dir, 'drives', 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'drives', 'line', 'summary.json'), JSON.stringify(summary));
  // (aDoors[2]: 6 faults this week, none the week before)
  const history = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, event: 'error', plc: 'line', plcName: 'Line 6', machine: `${R}.aDoors[2]`, state: 'DOOR_DASHER_ERROR', text: 'x', at: new Date(Date.now() - (i + 1) * 3600_000).toISOString(), ack: null, resolvedAt: null }));
  fs.writeFileSync(path.join(dir, 'alerts-history.json'), JSON.stringify(history));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 6', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48988', port: 851 }],
    tokens: [{ name: 'super', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    fleet: { everySeconds: 10 },
    drives: { everySeconds: 5 },
    faults: { enabled: false },
    projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-fleet-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  // (three fleet rounds: the CRC errors rise after the fourth read of the states; asked again until they show)
  let state = null;
  for (let i = 0; i < 12 && !state; i++) {
    ws.send(JSON.stringify({ type: 'fleetWatch', plcs: [] }));
    await h.sleep(5000);
    const s = [...got].reverse().find((m) => m.type === 'fleetState');
    if (s?.risks?.some((r) => r.id.startsWith('box-crc')) && s.risks.some((r) => r.id.startsWith('drive-trend'))) state = s;
  }
  const risks = state?.risks ?? [...got].reverse().find((m) => m.type === 'fleetState')?.risks ?? [];
  const find = (p) => risks.find((r) => r.id.startsWith(p));
  console.log(`   risks: ${risks.map((r) => `${r.level} ${r.name}: ${r.reason}`).join(' | ')}`);
  expect(find('box-now')?.level === 'alarm' && /EL2008/.test(find('box-now').name) && /SAFEOP/.test(find('box-now').reason), `a terminal out of OP: ${find('box-now')?.reason}`);
  expect(find('box-crc')?.level === 'watch' && /EK1100/.test(find('box-crc').name) && /30 CRC errors/.test(find('box-crc').reason), `CRC errors rising: ${find('box-crc')?.name} ${find('box-crc')?.reason}`);
  const trend = find('drive-trend');
  expect(trend?.name === 'Drive A' && trend.eta >= 18 && trend.eta <= 21 && trend.level === 'watch', `a heatsink rising: ${trend?.reason}`);
  expect(find('machine')?.level === 'watch' && /6 faults/.test(find('machine').reason), `a machine faulting more: ${find('machine')?.reason}`);
  expect(risks[0]?.level === 'alarm', 'the worst first');
  const inv = (state ?? [...got].reverse().find((m) => m.type === 'fleetState'))?.inventory ?? [];
  const i550s = inv.filter((g) => /i550/.test(g.type));
  expect(inv.length === 5 && i550s.length === 2 && i550s.every((g) => g.vendor === 'Lenze' && g.count === 1), `the inventory: ${inv.map((g) => `${g.vendor} ${g.type} ${g.revision} ×${g.count}`).join(', ')}`);
  expect(fs.existsSync(path.join(dir, 'fleet', 'line', 'summary.json')), 'kept in fleet/line/summary.json');
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('risk-inventory'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=risk`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    const items = await h.until(() => p.$$eval('.risk-item', (x) => x.map((e) => e.getAttribute('data-level'))).then((x) => (x.length >= 4 ? x : null)), 20000);
    const eta = await p.$eval('.risk-eta', (e) => e.textContent).catch(() => '');
    expect(items?.[0] === 'alarm' && /≈ (18|19|20|21) days/.test(eta), `the Risk page: ${items?.join(', ')}; ${eta}`);
    await p.click('#risk-tab-inventory');
    const rows = await p.$$eval('#risk-inventory .inventory-row', (x) => x.map((e) => `${e.getAttribute('data-type')}|${e.textContent?.includes('⚑')}`));
    expect(rows.length === 5 && rows.filter((r) => /i550/.test(r) && /true$/.test(r)).length === 2, `the Inventory: ${rows.join(', ')} (two firmware versions marked)`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

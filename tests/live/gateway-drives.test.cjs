// The drive health board, the load panel, the shared notifications (simulated PLC symbols-plc.cjs, its EtherCAT
// master with three Lenze i550 drives and an HSD spindle answering their CoE objects; the web app from dist/):
// - the drives found in the PLC's I/O (not the valve terminal), read every 5 s, judged: one healthy, one 14 °C warmer
//   than its last days and its siblings (warning), one in fault (alarm); the spindle by its own (HSD ES951) profile;
//   their alerts in the alert history; a drive's history kept;
// - the setup page's Check a drive: the boxes of other makers, the spindle's profile read raw, one object, one absent;
// - an alert rule, a recording and a board on the same machines: one ADS notification each, not three;
// - the setup page's Load: the shared notifications, the PLC's task with its overrun counted;
// - the board's Drives page (filter, problems only, a drive's history) and the I/O page's box properties;
// - a Hot Connect group not attached (optional equipment, in INIT, not present): not counted as not OK.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
const { unzip } = require('../../shared/tcSources.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8489;
const BASE = `http://localhost:${PORT}`;
const PLC_PORT = '48985';
const TOKEN = 'drives-test-token';
const MASTER = '127.0.0.1.2.1';
const DEV = 'Device 1 (EtherCAT)';
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const api = (method, p) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method, headers: { host: `localhost:${PORT}`, origin: BASE } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve((() => { try { return JSON.parse(t); } catch { return null; } })()));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
const apiPost = (p, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method: 'POST', headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve((() => { try { return JSON.parse(t); } catch { return null; } })()));
    });
    req.on('error', () => resolve(null));
    req.end(JSON.stringify(body));
  });

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-drives.json', [], { sources: true });
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (its task: 10 ms, 2.3 ms used; an overrun after 3 s)
  const TI = 'TwinCAT_SystemInfoVarList._TaskInfo[1]';
  Object.assign(c.symbols, {
    [`${TI}.TaskName`]: { type: 'STRING(63)', dataType: 30, size: 64, value: 'Plant_PlcTask' },
    [`${TI}.CycleTime`]: { type: 'UDINT', dataType: 19, size: 4, value: 100000 },
    [`${TI}.LastExecTime`]: { type: 'UDINT', dataType: 19, size: 4, value: 23000 },
    [`${TI}.CycleTimeExceeded`]: { type: 'BOOL', dataType: 33, size: 1, value: 0 },
    [`${TI}.RTViolation`]: { type: 'BOOL', dataType: 33, size: 1, value: 0 },
  });
  c.script = [...c.script, { hold: 2000, set: { [`${TI}.CycleTimeExceeded`]: 1 } }, { hold: 500, set: { [`${TI}.CycleTimeExceeded`]: 0 } }];
  // (three i550 drives and an HSD spindle on the master, and an SMC valve terminal: not a drive)
  const files = Object.fromEntries(unzip(Buffer.from(c.bootFiles['CurrentConfig.tszip'], 'base64'), () => true).map((f) => [f.path, f.data.toString('utf8')]));
  const io = '_Config/IO/Device 1 (EtherCAT).xti';
  const i550 = (id, name) => `<Box Id="${id}" BoxType="9099"><Name>${name} (Inverter i550 Cabinet)</Name><EtherCAT VendorId="#x0000003b" ProductCode="#x69055000" RevisionNo="#x00050002" Type="i550 Inverter FW V05.02.xx" Desc="Inverter i550 Cabinet" PortABoxInfo="#x01000003"><SuName>Lenze</SuName></EtherCAT></Box>`;
  files[io] = files[io].replace('</Box></Device>', `</Box>${i550(4, 'Drive A')}${i550(5, 'Drive B')}${i550(6, 'Drive C')}<Box Id="7" BoxType="9099"><Name>HSD ES951 Spindle (ES95x)</Name><EtherCAT VendorId="#x00000129" ProductCode="#x0000004b" Type="ES95x" PortABoxInfo="#x01000006"></EtherCAT></Box><Box Id="8" BoxType="9099"><Name>Q-A (EX260-SEC1)</Name><EtherCAT VendorId="#x00000114" Type="EX260-SEC1 EtherCAT SI Unit (32DO_PNP) Rev1.2" PortABoxInfo="#x01000007"></EtherCAT></Box><Box Id="9" BoxType="9099"><Name>(HC:SHOOTER.v1) Shooter (EP1111-0000)</Name><EtherCAT VendorId="#x00000002" Type="EP1111-0000" IdentificationAdo="308" IdentificationValue="30" PortABoxInfo="#x01000008"></EtherCAT></Box><Box Id="10" BoxType="9099"><Name>I-S.0 to I-S.7 (EP1098-0001)</Name><EtherCAT VendorId="#x00000002" Type="EP1098-0001" PortABoxInfo="#x01000009"></EtherCAT></Box></Device>`);
  c.bootFiles['CurrentConfig.tszip'] = writeZip(files).toString('base64');
  c.ecat = [{ netId: MASTER, slaves: [...Array.from({ length: 8 }, () => [8, 0]), [1, 1], [1, 1]], addresses: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010] }];
  const u16 = (value) => ({ size: 2, value });
  const s16 = (value) => ({ size: 2, value, signed: true });
  const u32 = (value) => ({ size: 4, value });
  const id = (vendor, product) => ({ '1018:1': u32(vendor), '1018:2': u32(product) });
  const lenze = (heatsink, error) => ({
    ...id(0x3b, 0x69055000),
    '2ddd:0': s16(500), '2d88:0': u16(52), '6078:0': s16(400), '6077:0': s16(300), '2d87:0': u16(560), '2d89:0': u16(400),
    '2d84:1': s16(heatsink), '2d84:2': s16(800), '2d4f:0': u16(30), '2d40:4': u16(40), '603f:0': u16(error),
    '2d81:1': u32(1234 * 3600), '2d81:2': u32(2000 * 3600), '2d81:4': u32(77), '2d81:6': u16(0), '2d81:7': u16(0),
  });
  c.coe = {
    [`${MASTER}|1004`]: lenze(420, 0),
    [`${MASTER}|1005`]: id(0x114, 0x1234),
    [`${MASTER}|1008`]: lenze(560, 0),
    [`${MASTER}|1006`]: lenze(430, 0x2250),
    [`${MASTER}|1007`]: { ...id(0x129, 0x4b), '6ff0:1': { size: 1, value: 5 }, '6ff1:1': u16(1200), '6ff1:2': u16(12000), '6010:1': u16(0x10), '6010:2': u16(35), '6010:3': u16(0) },
  };
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plcLog = h.out('fake-ams2-drives-run.txt');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), PLC_PORT, cfg], { stdio: ['ignore', fs.openSync(plcLog, 'w'), 'ignore'] });

  const dir = h.out('gw-drives');
  fs.rmSync(dir, { recursive: true, force: true });
  // (five days before today: each drive's heatsink 42 °C running, its current per Hz 0.104)
  const summary = { days: {} };
  for (let k = 5; k >= 1; k--) {
    const day = dayOf(Date.now() - k * 86400000);
    summary.days[day] = {};
    for (const n of ['Drive A', 'Drive B', 'Drive C']) summary.days[day][`${DEV}^${n} (Inverter i550 Cabinet)`] = { heatsink: { median: 42, n: 2000 }, currentPerHz: { median: 0.104, n: 2000 }, counters: { shortCircuits: 0, earthFaults: 0 } };
  }
  fs.mkdirSync(path.join(dir, 'drives', 'line'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'drives', 'line', 'summary.json'), JSON.stringify(summary));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 3', netId: '127.0.0.1.1.1', ip: `127.0.0.1:${PLC_PORT}`, port: 851 }],
    tokens: [{ name: 'tech', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    alerts: [{ id: 'a1', name: 'Line 3', enabled: true, plc: 'line', root: R, stateVar: 'machineState', stuckAfterMs: null, stateLimits: {}, onError: true, errorPattern: 'ERROR', notifyRecovery: true, webhook: null, format: 'json' }],
    recordings: [{ id: 'r1', name: 'Line 3', enabled: true, plc: 'line', root: R, stateVar: 'machineState', days: 7 }],
    drives: { everySeconds: 5 },
    projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-drives-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  ws.send(JSON.stringify({ type: 'boardWatch', plcs: ['line'], root: R }));
  ws.send(JSON.stringify({ type: 'drivesWatch', plcs: [] }));
  // 1. The drives, judged (after two rounds: today's running values)
  const state = await h.until(() => {
    const s = [...got].reverse().find((m) => m.type === 'drivesState');
    const ds = s?.plcs?.[0]?.drives ?? [];
    return ds.length === 4 && ds.every((d) => d.health) && ds.find((d) => d.name === 'Drive B')?.health?.level === 'warn' ? s : null;
  }, 30000);
  const ds = state?.plcs?.[0]?.drives ?? [];
  const by = (n) => ds.find((d) => d.name === n);
  expect(ds.length === 4 && !ds.some((d) => /EX260/.test(d.box)), `the drives found: ${ds.map((d) => `${d.name} (${d.profile}, ${d.address})`).join(', ')}`);
  expect(by('Drive B')?.address === 1008 && /found at 1008, not 1005/.test(by('Drive B')?.identity ?? '') && by('Drive A')?.identity === 'checked' && by('Drive A')?.address === 1004, `identity: Drive A ${by('Drive A')?.identity} at ${by('Drive A')?.address}; Drive B ${by('Drive B')?.identity}`);
  expect(by('Drive A')?.health?.level === 'ok' && Math.abs((by('Drive A')?.latest.heatsink?.v ?? 0) - 42) < 0.01 && Math.abs((by('Drive A')?.latest.current?.v ?? 0) - 5.2) < 0.01 && by('Drive A')?.latest.opHours?.v === 1234, `Drive A healthy: ${by('Drive A')?.latest.heatsink?.v} °C, ${by('Drive A')?.latest.current?.v} A, ${by('Drive A')?.latest.opHours?.v} h`);
  const bTexts = (by('Drive B')?.health?.findings ?? []).map((f) => f.text).join(' | ');
  expect(/14 °C warmer than its last 5 days/.test(bTexts) && /hotter than its 2 siblings/.test(bTexts), `Drive B: ${bTexts}`);
  expect(by('Drive C')?.health?.level === 'alarm' && /In fault: error 0x2250/.test(by('Drive C')?.health?.findings?.[0]?.text ?? ''), `Drive C: ${by('Drive C')?.health?.findings?.[0]?.text}`);
  const hsd = by('HSD ES951 Spindle');
  expect(hsd?.profile === 'hsd-es951' && hsd.latest.speed?.v === 12000 && hsd.latest.vibration?.v === 35 && hsd.latest.p75?.v === 5 && hsd.health?.level !== 'alarm', `the spindle (HSD ES951): ${hsd?.latest.speed?.v} rpm, vibration ${hsd?.latest.vibration?.v}, P75 ${hsd?.latest.p75?.v}, ${hsd?.health?.level}`);
  // 2. Their alerts; their history kept
  ws.send(JSON.stringify({ type: 'alertsList' }));
  const alerts = await h.until(() => got.find((m) => m.type === 'alertsList')?.events, 5000);
  const driveAlerts = (alerts ?? []).filter((e) => e.event === 'drive');
  expect(driveAlerts.some((e) => /Drive C: In fault/.test(e.text)) && driveAlerts.some((e) => /Drive B: Running 14 °C warmer/.test(e.text)), `alerts: ${driveAlerts.map((e) => e.text).join(' | ')}`);
  ws.send(JSON.stringify({ type: 'driveHistory', requestId: 3, plc: 'line', path: `${DEV}^Drive B (Inverter i550 Cabinet)`, keys: ['heatsink', 'current'], from: Date.now() - 3600_000, to: Date.now() }));
  const hist = await h.until(() => got.find((m) => m.type === 'driveHistoryResult' && m.requestId === 3), 5000);
  expect(hist?.series?.heatsink?.length >= 1 && Math.abs(hist.series.heatsink[0].v - 56) < 0.01 && hist.baseline?.heatsink === 42, `Drive B's history: ${hist?.series?.heatsink?.length} heatsink value(s), baseline ${hist?.baseline?.heatsink}`);
  expect(fs.existsSync(path.join(dir, 'drives', 'line', `${dayOf(Date.now())}.jsonl`)), 'kept in drives/line/<today>.jsonl');

  // 3. Shared notifications: the rule, the recording and the board on the same machines: one each
  await h.sleep(3000);
  const adds = (fs.readFileSync(plcLog, 'utf8').match(/add notification \d+ for (\S+)/g) ?? []).map((l) => l.replace(/^add notification \d+ for /, ''));
  const states = adds.filter((n) => /machineState$/i.test(n));
  const twice = [...new Set(states)].filter((n) => states.filter((x) => x === n).length > 1);
  expect(states.length >= 5 && !twice.length, `state variables subscribed once each: ${states.length} for ${new Set(states).size} variable(s)${twice.length ? `; twice: ${twice.join(', ')}` : ''}`);
  // 4. The load panel's numbers
  const load = await h.until(() => api('GET', 'load').then((l) => (l?.plcs?.[0]?.tasks?.[0]?.overruns >= 1 ? l : null)), 15000);
  const lp = load?.plcs?.[0];
  expect(lp?.shared?.notifications >= 5 && lp.shared.uses > lp.shared.notifications && lp.tasks[0].name === 'Plant_PlcTask' && lp.tasks[0].cycleUs === 10000 && lp.tasks[0].execUs === 2300 && lp.tasks[0].overruns >= 1 && load.drives?.[0]?.drives === 4 && load.machine?.cpuPct >= 0, `load: ${lp?.shared?.notifications} notifications (${lp?.shared?.uses} uses), task ${lp?.tasks?.[0]?.name} ${lp?.tasks?.[0]?.execUs} of ${lp?.tasks?.[0]?.cycleUs} µs, ${lp?.tasks?.[0]?.overruns} overrun(s); drives ${load?.drives?.[0]?.drives}`);
  // 5. Check a drive (the setup page): the boxes of other makers; the spindle's profile read raw; one object; one absent
  const listed = await apiPost('drivecheck', { plc: 'line' });
  const sp = listed?.boxes?.find((b) => /ES951/.test(b.name));
  expect(listed?.boxes?.length >= 5 && sp?.profile?.id === 'hsd-es951' && sp.address === 1007 && listed.boxes.some((b) => /EX260/.test(b.name) && !b.profile), `Check a drive: ${listed?.boxes?.map((b) => `${b.name} (${b.profile?.id ?? 'none'}, ${b.address})`).join(', ') ?? listed?.error}`);
  const prof = await apiPost('drivecheck', { plc: 'line', path: sp?.path });
  const speed = prof?.reads?.find((x) => x.key === 'speed');
  expect(prof?.reads?.length === 8 && prof.reads[1].as?.u32 === 0x4b && speed?.hex === 'e0 2e' && speed.as?.u16 === 12000 && speed.value === 12000 && speed.verified === false && prof.reads.find((x) => x.key === 'p75')?.as?.u8 === 5, `its profile read: ${prof?.reads?.map((x) => `${x.label} ${x.hex}`).join(', ') ?? prof?.error}`);
  const one = await apiPost('drivecheck', { plc: 'line', path: sp?.path, index: '0x6010', sub: '2', size: 2 });
  const none = await apiPost('drivecheck', { plc: 'line', path: sp?.path, index: '2d84', sub: 1, size: 2 });
  expect(one?.reads?.[0]?.as?.u16 === 35 && /\S/.test(none?.reads?.[0]?.error ?? ''), `one object: 0x6010:2 = ${one?.reads?.[0]?.as?.u16}; one it has not: ${none?.reads?.[0]?.error}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('drives-filter'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // The setup page's Load
    await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
    const row = await h.until(() => p.$eval('[data-load-plc="line"] .admin-load-tasks', (e) => e.textContent).catch(() => null), 10000);
    // (Check a drive on the page: the spindle's profile; its PLCs filled first)
    await p.waitForSelector('#admin-drive-plc option', { timeout: 10000 }).catch(() => {});
    await p.click('#admin-drive-list');
    await p.waitForFunction(() => document.querySelectorAll('#admin-drive-box option').length >= 5, { timeout: 15000 }).catch(() => {});
    const opt = await p.$$eval('#admin-drive-box option', (o) => o.find((x) => /ES951/.test(x.textContent ?? ''))?.value ?? '');
    if (opt) await p.select('#admin-drive-box', opt);
    await p.click('#admin-drive-read');
    const cell = await h.until(() => p.$eval('[data-drive-object="6ff1:2"]', (e) => e.textContent).catch(() => null), 15000);
    const driveMsg = await p.$eval('#admin-drive-msg', (e) => e.textContent).catch(() => '');
    expect(/0x6FF1:2/.test(cell ?? '') && /u16 12000/.test(cell ?? '') && /unverified/.test(cell ?? ''), `the setup page's Check a drive: ${cell} (${driveMsg})`);
    expect(/PlcTask: 2\.30 ms of 10\.00 ms \(23 %\)/.test(row ?? '') && /overrun/.test(row ?? ''), `the setup page's Load: "${row}"`);
    // The board's Drives page
    await p.goto(`${BASE}/?board&page=drives`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    const cards = await h.until(() => p.$$eval('.drive-card', (cs) => cs.map((c) => `${c.getAttribute('data-level')}`)).then((x) => (x.length === 4 ? x : null)), 20000);
    expect(cards?.[0] === 'alarm' && cards?.[1] === 'warn', `the Drives page: ${cards?.join(', ')} (problems first)`);
    await p.click('#drives-problems');
    const problems = await p.$$eval('.drive-card', (cs) => cs.length);
    await p.click('#drives-problems');
    await p.type('#drives-filter', 'hsd');
    const hsdCards = await p.$$eval('.drive-card', (cs) => cs.map((c) => c.getAttribute('data-drive')));
    expect(problems === 2 && hsdCards.length === 1 && /HSD/.test(hsdCards[0]), `problems only: ${problems}; filter "hsd": ${hsdCards.join(', ')}`);
    await p.click('#drives-filter', { clickCount: 3 });
    await p.keyboard.press('Escape');
    await p.click('.drive-card[data-level="warn"]');
    await p.waitForSelector('#drive-detail', { timeout: 5000 });
    const detail = await h.until(() => p.evaluate(() => ({ charts: document.querySelectorAll('#drive-detail .drive-chart').length, values: document.querySelectorAll('#drive-detail .drive-value').length, text: document.querySelector('#drive-detail')?.textContent ?? '' })).then((x) => (x.charts ? x : null)), 8000);
    expect(detail?.charts >= 5 && detail.values === 16 && /baseline 42/.test(detail.text), `a drive's detail: ${detail?.charts} charts, ${detail?.values} values, its baseline shown`);
    await p.keyboard.press('Escape');
    await p.click('#drive-detail button[title^="Close"]').catch(() => {});
    // The I/O page: a box's properties (as on the I/O tab)
    await p.click('#board-page-io');
    await p.waitForSelector('.io-board-props-btn', { timeout: 15000 });
    // (the Hot Connect group not attached: not counted as not OK)
    const hc = await h.until(() => p.evaluate(() => ({ chip: document.querySelector('.io-board-hc')?.textContent, bad: document.querySelector('.io-board-bad')?.textContent ?? null, kinds: [...document.querySelectorAll('.io-board-box[data-kind="absent"]')].length, tag: document.querySelector('.io-board-hc-tag')?.textContent })).then((x) => (x.chip ? x : null)), 15000);
    expect(/1 Hot Connect group not attached/.test(hc?.chip ?? '') && hc.bad === null && hc.kinds === 2 && /SHOOTER\.v1: not attached/.test(hc.tag ?? ''), `a Hot Connect group not attached: ${JSON.stringify(hc)}`);
    await p.click('.io-board-box[data-box$="Drive A (Inverter i550 Cabinet)"] .io-board-props-btn');
    const props = await h.until(() => p.$eval('#io-board-props', (e) => e.textContent).catch(() => null), 8000);
    expect(/Drive A/.test(props ?? '') && /i550/.test(props ?? ''), `the I/O page's box properties: ${(props ?? '').slice(0, 120)}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

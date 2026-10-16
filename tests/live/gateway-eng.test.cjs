// The Engineering page (gateway/engineering.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): aDoors[1]
// recorded 14 days (ENABLING 30 s a cycle) and today (60 s, and once into its error state): today's ENABLING flagged
// (+100 %), the transitions into and out of the error state new; today against yesterday; the PLC project's two
// versions kept (one POU changed): the file changed, its diff. The board's Engineering page.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc, PLANT_SOURCES } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8505;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'eng-test-token';
const M = `${R}.aDoors[1]`;
const dayOf = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-eng.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48993', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-eng');
  fs.rmSync(dir, { recursive: true, force: true });
  // The recording: 14 days at noon, 20 cycles (DISABLED 60 s, ENABLING 30 s); today 5 cycles of ENABLING 60 s, and
  // once ENABLING → ERROR → DISABLED
  const lines = [];
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  for (let k = 14; k >= 1; k--) {
    let t = noon.getTime() - k * 86400000;
    for (let i = 0; i < 20; i++) {
      lines.push({ t, m: M, v: 0 });
      t += 60000;
      lines.push({ t, m: M, v: 1 });
      t += 30000;
    }
    lines.push({ t, m: M, v: 0 });
  }
  let t = Date.now() - 40 * 60000;
  for (let i = 0; i < 5; i++) {
    lines.push({ t, m: M, v: 0 });
    t += 60000;
    lines.push({ t, m: M, v: 1 });
    t += 60000;
  }
  lines.push({ t, m: M, v: 7 });
  t += 60000;
  lines.push({ t, m: M, v: 0 });
  const byDay = new Map();
  for (const l of lines) byDay.set(dayOf(l.t), [...(byDay.get(dayOf(l.t)) ?? []), JSON.stringify(l)]);
  fs.mkdirSync(path.join(dir, 'recordings', 'r1'), { recursive: true });
  for (const [d, ls] of byDay) fs.writeFileSync(path.join(dir, 'recordings', 'r1', `${d}.jsonl`), ls.join('\n') + '\n');
  // The PLC project: the version before (history) and now (one POU changed)
  const pou = Object.keys(PLANT_SOURCES).find((f) => /SM_Conveyor\.TcPOU$/.test(f));
  const pdir = path.join(dir, 'PlcProjects', 'line');
  fs.mkdirSync(path.join(pdir, 'history', '2026-10-01T08-00-00-000Z'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'history', '2026-10-01T08-00-00-000Z', 'project.tpzip'), writeZip({ ...PLANT_SOURCES }));
  fs.writeFileSync(path.join(pdir, 'history', '2026-10-01T08-00-00-000Z', 'sync.json'), JSON.stringify({ downloadedAt: '2026-10-01T08:00:00.000Z', project: 'Plant' }));
  fs.writeFileSync(path.join(pdir, 'project.tpzip'), writeZip({ ...PLANT_SOURCES, [pou]: PLANT_SOURCES[pou].replace('doState();', 'doState();\nnTimeout := 5;') }));
  fs.writeFileSync(path.join(pdir, 'sync.json'), JSON.stringify({ downloadedAt: new Date().toISOString(), project: 'Plant', files: 6 }));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 11', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48993', port: 851 }],
    tokens: [{ name: 'eng', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    recordings: [{ id: 'r1', name: 'Doors', enabled: true, plc: 'line', root: R, stateVar: 'machineState', days: 30, machines: [M] }],
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-eng-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const got = [];
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
  let id = 0;
  const ask = async (msg, reply) => {
    const requestId = ++id;
    ws.send(JSON.stringify({ ...msg, requestId }));
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 60000);
  };
  await h.until(() => ask({ type: 'recordingsList' }, 'recordingsList').then((r) => (r?.recordings?.[0]?.machines?.length ? r : null)), 20000);
  // 1. Timing
  const timing = await ask({ type: 'engTiming', id: 'r1', machine: M }, 'engTimingResult');
  const en = timing?.rows?.find((r) => r.state === 'DOOR_DASHER_ENABLING');
  expect(en?.flag === true && Math.abs(en.change - 1) < 0.05 && en.normalMs === 30000 && en.days === 14, `timing: ENABLING today ${en?.todayMs / 1000} s, normal ${en?.normalMs / 1000} s (${en?.days} days), ${Math.round((en?.change ?? 0) * 100)} %`);
  // 2. Transitions
  const tr = await ask({ type: 'engTransitions', id: 'r1', machine: M, hours: 24 }, 'engTransitionsResult');
  const intoErr = tr?.rows?.find((r) => r.from === 'DOOR_DASHER_ENABLING' && r.to === 'DOOR_DASHER_ERROR');
  const usual = tr?.rows?.find((r) => r.from === 'DOOR_DASHER_DISABLED' && r.to === 'DOOR_DASHER_ENABLING');
  // (yesterday's noon in the last 24 hours or not, as the test runs before 12:30 or after: 260 before, or 280)
  expect(intoErr?.isNew === true && usual && !usual.isNew && usual.before >= 260 && usual.recent + usual.before === 285, `transitions: ENABLING → ERROR new (${intoErr?.recent}), DISABLED → ENABLING usual (${usual?.recent} / ${usual?.before})`);
  // 3. Compare today and yesterday
  const midnight = new Date(new Date().toDateString()).getTime();
  const cmp = await ask({ type: 'engCompare', a: { id: 'r1', machine: M, from: midnight - 86400000, to: midnight }, b: { id: 'r1', machine: M, from: midnight, to: Date.now() } }, 'engCompareResult');
  const ya = cmp?.a?.states?.find((s) => s.state === 'DOOR_DASHER_ENABLING');
  const tb = cmp?.b?.states?.find((s) => s.state === 'DOOR_DASHER_ENABLING');
  expect(ya?.count === 20 && Math.abs(ya.avgMs - 30000) < 1 && tb?.count >= 5 && Math.abs(tb.avgMs - 60000) < 2000, `compare: yesterday ENABLING ${ya?.count}× ${ya?.avgMs / 1000} s, today ${tb?.count}× ${Math.round(tb?.avgMs / 1000)} s`);
  // 4. What changed
  const vs = await ask({ type: 'engVersions', plc: 'line' }, 'engVersionsResult');
  const diff = await ask({ type: 'engDiff', plc: 'line', a: vs?.versions?.[1]?.id ?? 'x', b: 'current' }, 'engDiffResult');
  const file = await ask({ type: 'engDiff', plc: 'line', a: vs?.versions?.[1]?.id ?? 'x', b: 'current', path: pou }, 'engDiffResult');
  expect(vs?.versions?.length === 2 && vs.versions[0].current && diff?.files?.length === 1 && diff.files[0].path === pou && diff.files[0].change === 'changed' && /nTimeout := 5/.test(file?.after ?? '') && !/nTimeout := 5/.test(file?.before ?? ''), `what changed: ${vs?.versions?.length} versions, ${diff?.files?.map((f) => `${f.change} ${f.path}`).join(', ')}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('eng-timing'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=eng`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    const flagged = await h.until(() => p.$$eval('.eng-timing-row[data-flag="true"]', (x) => x.map((e) => e.getAttribute('data-state'))).then((x) => (x.length ? x : null)), 20000);
    await p.click('#eng-tab-transitions');
    const fresh = await h.until(() => p.$$eval('.eng-transition[data-new="true"]', (x) => x.length).then((n) => (n ? n : null)), 10000);
    await p.click('#eng-tab-changed');
    await p.waitForSelector('.eng-file', { timeout: 10000 });
    await p.click('.eng-file');
    const rows = await h.until(() => p.$$eval('#eng-diff .eng-diff-row[data-type="add"]', (x) => x.map((e) => e.textContent)).then((x) => (x.length ? x : null)), 8000);
    expect(flagged?.includes('DOOR_DASHER_ENABLING') && fresh >= 1 && rows?.some((r) => /nTimeout := 5/.test(r ?? '')), `the Engineering page: flagged ${flagged?.join(', ')}; ${fresh} new transition(s); the diff's added line`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

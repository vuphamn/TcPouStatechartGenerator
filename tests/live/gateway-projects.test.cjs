// The PLCs' projects kept by the gateway (gateway/projectSync.cjs, simulated PLC symbols-plc.cjs with its boot folder's
// sources): at start its project downloaded (the TwinCAT configuration at the root, the PLC project in its folder);
// a local edit undone from the PLC's copy (the golden one); checked again: in step, nothing downloaded; another
// version on the PLC: downloaded, the one before in history; From PLC (plcSources, not live) from the copy kept while
// the PLC's _AppInfo is the same, from the PLC after another build there (and the copy checked then); the setup page
// lists them, Check now
const h = require('../lib/harness.cjs');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { writeSymbolsPlc, PLANT_SOURCES } = require('../fakes/symbols-plc.cjs');
const { writeZip } = require('../lib/zip.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8477;
const BASE = `http://localhost:${PORT}`;
const PLC_PORT = '48951';

const api = (method, p, body) =>
  new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: `/admin/api/${p}`, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve((() => { try { return JSON.parse(t); } catch { return null; } })()));
    });
    req.on('error', () => resolve(null));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-projects.json', [], { sources: true });
  // (its _AppInfo steady: the build's time, its online changes not counted up on each read)
  const steady = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  steady.countOnRead = [];
  steady.symbols['TwinCAT_SystemInfoVarList._AppInfo.AppTimestamp'] = { type: 'DT', dataType: 19, size: 4, value: 1700000000 };
  fs.writeFileSync(cfg, JSON.stringify(steady));
  let plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), PLC_PORT, cfg], { stdio: 'ignore' });
  const dir = h.out('gw-projects');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [],
    plcs: [{ id: 'line202', name: 'Line 202', netId: '127.0.0.1.1.1', ip: `127.0.0.1:${PLC_PORT}`, port: 851 }],
    tokens: [],
  }, null, 2));
  const token = execFileSync(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'add-token', 'tester', '--config', configPath], { encoding: 'utf8' }).match(/\n\s+(\S+)\s*\n/)[1];
  const logFile = h.out('gw-projects-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')], env: { ...process.env, KSS_PROJECT_SYNC_DELAY_MS: '300' } });
  await h.waitForText(logFile, /Setup page/);
  const cur = path.join(dir, 'PlcProjects', 'line202', 'current');
  const list = async () => (await api('GET', 'projects'))?.plcs?.[0] ?? null;

  // 1. At start: downloaded, unpacked as a TwinCAT project
  const first = await h.until(() => list().then((p) => (p && p.state !== 'never' && !p.checking ? p : null)), 15000);
  const files = fs.existsSync(cur) ? fs.readdirSync(cur) : [];
  const pou = Object.keys(PLANT_SOURCES).find((f) => /\.TcPOU$/i.test(f));
  expect(first?.state === 'updated' && files.includes('Plant.tsproj') && files.includes('_Config') && fs.existsSync(path.join(cur, 'Plant', pou)) && fs.existsSync(path.join(cur, 'Plant', 'Plant.plcproj')), `downloaded at start: ${first?.state} (${files.join(', ')}; Plant/${pou})`);
  // (the fake's sources differ from its types: said, as for a PLC downloaded without its sources)
  expect(first?.files > 3 && /Downloaded from the PLC|differs from its sources/.test(first?.message ?? '') && /differs from its sources/.test(first?.stale ?? ''), `${first?.files} files: ${first?.message}`);

  // 2. A local edit: undone from the PLC's copy (the golden one)
  const pouFile = path.join(cur, 'Plant', pou);
  const original = fs.readFileSync(pouFile, 'utf8');
  fs.writeFileSync(pouFile, original.replace('<POU', '<!-- edited here --><POU'));
  fs.writeFileSync(path.join(cur, 'extra.txt'), 'not the PLC\'s');
  const restored = await api('POST', 'projects/check', { id: 'line202' });
  expect(restored?.state === 'restored' && fs.readFileSync(pouFile, 'utf8') === original && !fs.existsSync(path.join(cur, 'extra.txt')) && !('manifest' in restored), `a local edit undone: ${restored?.state}`);

  // 3. Again: in step, nothing downloaded, no history
  const again = await api('POST', 'projects/check', { id: 'line202' });
  expect(again?.state === 'in-sync' && (await list())?.history === 0, `checked again: ${again?.state}`);

  // 4. Another version on the PLC: downloaded, the one before in history
  const conf = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  conf.bootFiles['CurrentConfig/Plant.tpzip'] = writeZip({ ...PLANT_SOURCES, [pou]: PLANT_SOURCES[pou].replace('<POU', '<!-- version 2 --><POU'), 'Plant.plcproj': '<Project/>' }).toString('base64');
  fs.writeFileSync(cfg, JSON.stringify(conf));
  plc.kill();
  await h.sleep(500);
  plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), PLC_PORT, cfg], { stdio: 'ignore' });
  await h.sleep(800);
  const v2 = await api('POST', 'projects/check', { id: 'line202' });
  const shown = await list();
  expect(v2?.state === 'updated' && /version 2/.test(fs.readFileSync(pouFile, 'utf8')) && shown?.history === 1 && /A new version|differs from its sources/.test(v2?.message ?? ''), `a new version: ${v2?.state}, ${shown?.history} older kept`);
  const log = fs.readFileSync(logFile, 'utf8');
  expect(/projects: line202: its project downloaded from the PLC/.test(log) && /restored/.test(log) && /a new version downloaded/.test(log), 'said in the log');

  // 5. From PLC (not live): the copy kept here while the PLC's build is the same; another build there: read from the PLC
  // (and the copy checked); then from the copy again
  const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { Origin: BASE } });
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', token }));
  await h.sleep(400);
  const sourcesOf = async (requestId) => {
    ws.send(JSON.stringify({ type: 'plcSources', requestId, plc: 'line202' }));
    return h.until(() => got.find((m) => m.type === 'plcSourcesResult' && m.requestId === requestId) ?? null, 15000);
  };
  const v2pou = (r) => (r?.files ?? []).find((x) => x.path === pou)?.content ?? '';
  const kept = await sourcesOf(21);
  expect(!!kept?.fromGateway && /version 2/.test(v2pou(kept)) && kept.plcProject === 'Plant' && kept.projects?.length >= 1 && (kept.projectFiles ?? []).some((x) => /\.plcproj$/.test(x.path)), `From PLC: the copy kept here: ${kept?.error ?? (kept?.fromGateway ? `${kept.files?.length} files, read ${kept.fromGateway.downloadedAt}` : 'read from the PLC')}`);
  // (another PLC project than the one kept: from the PLC)
  ws.send(JSON.stringify({ type: 'plcSources', requestId: 22, plc: 'line202', plcProject: 'Other' }));
  const other = await h.until(() => got.find((m) => m.type === 'plcSourcesResult' && m.requestId === 22) ?? null, 15000);
  expect(!!other && !other.fromGateway, `another PLC project: not from the copy (${other?.error ?? 'read'})`);
  steady.symbols['TwinCAT_SystemInfoVarList._AppInfo.AppTimestamp'].value = 1700000500;
  steady.bootFiles = conf.bootFiles;
  fs.writeFileSync(cfg, JSON.stringify(steady));
  plc.kill();
  await h.sleep(500);
  plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), PLC_PORT, cfg], { stdio: 'ignore' });
  await h.sleep(800);
  const fresh = await sourcesOf(23);
  expect(!!fresh && !fresh.error && !fresh.fromGateway && /version 2/.test(v2pou(fresh)), `another build on the PLC: read from it: ${fresh?.error ?? (fresh?.fromGateway ? 'from the copy (wrong)' : 'from the PLC')}`);
  const rechecked = await h.until(() => list().then((p) => (p && !p.checking && p.state === 'in-sync' ? p : null)), 15000);
  const again2 = await sourcesOf(24);
  expect(!!rechecked && !!again2?.fromGateway, `the copy checked, then From PLC from it again: ${rechecked?.state}, ${again2?.fromGateway ? 'from the copy' : again2?.error ?? 'from the PLC'}`);
  expect(/sources from the copy kept here/.test(fs.readFileSync(logFile, 'utf8')), 'said in the log');
  ws.close();

  // 6. The setup page: the PLC's row, Check now
  if (!fs.existsSync(path.join(h.REPO, 'dist', 'index.html'))) console.log('skipped the browser part: no dist/');
  const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
  const row = await h.until(() => p.$eval('[data-project-plc="line202"] .admin-project-state', (e) => e.textContent).catch(() => null), 8000);
  await p.click('[data-project-plc="line202"] .admin-project-check').catch(() => {});
  const said = await h.until(() => p.$eval('#admin-projects-msg', (e) => e.textContent).then((t) => (/Line 202: /.test(t) && !/checking/.test(t) ? t : null)).catch(() => null), 8000);
  expect(/Downloaded|In step/.test(row ?? '') && /In step with the PLC/.test(said ?? '') && !errors.length, `the setup page: "${row}", Check now: "${said}"${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`);
  await browser.close();

  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

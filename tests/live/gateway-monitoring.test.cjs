// The setup page's Monitoring (gateway/admin.cjs): its script parses as served; the settings saved, checked (a bad
// webhook refused); the monitors follow them per PLC (drives on one PLC, fault records off, the fleet on both, the
// project copies off), as the Load section shows; the section's checkboxes saved from the page.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8509;
const BASE = `http://localhost:${PORT}`;
const req = (method, p, body) =>
  new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `localhost:${PORT}`, origin: BASE, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }));
    });
    r.on('error', () => resolve({ status: 0 }));
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-monitoring.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48995', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-monitoring');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'a', name: 'Line A', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48995', port: 851 }, { id: 'b', name: 'Line B', netId: '127.0.0.2.1.1', ip: '127.0.0.1:48996', port: 851 }],
    tokens: [],
  }, null, 2));
  const logFile = h.out('gw-monitoring-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  // 1. The setup page's script parses as served
  const page = await req('GET', '/admin');
  const scripts = [...page.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const parse = scripts.map((s) => { try { new vm.Script(s); return null; } catch (e) { return e.message; } }).filter(Boolean);
  expect(scripts.length >= 1 && !parse.length, `the setup page's script parses${parse.length ? `: ${parse.join('; ')}` : ''}`);
  // 2. The settings: read, saved, checked
  const got = (await req('GET', '/admin/api/monitoring')).json;
  expect(got?.plcs?.length === 2 && got.defaults?.reasons?.includes('Jam'), `read: ${got?.plcs?.length} PLCs, the reasons offered by default`);
  const bad = await req('POST', '/admin/api/monitoring', { ...got, drives: { webhook: 'not a url' } });
  expect(bad.status >= 400 && /http/.test(bad.json?.error ?? ''), `a bad webhook refused: ${bad.json?.error}`);
  const body = {
    ...got,
    drives: { enabled: true, plcs: ['a'], everySeconds: 20, limits: { heatsinkRise: { watch: 4, warn: 7 } } },
    faults: { enabled: false },
    fleet: { enabled: true, plcs: [], everySeconds: 30 },
    projectSync: { enabled: false },
    oee: { reasons: ['Jam', 'Material', ''], reasonAfterMin: 3, machines: [{ plc: 'a', machine: 'MAIN.mainStateMachine.smTable1', cycleState: 'TABLE_PLC_READY', idealCycleSec: 40, goodVar: 'MAIN.nGood' }] },
    andon: { steps: 'DOOR_DASHER_ERROR = Check S12' + String.fromCharCode(10) + 'SM_TableManager.TABLE_ERROR = Clamp', callReasons: [] },
    workorders: { fromCalls: false },
  };
  const saved = await req('POST', '/admin/api/monitoring', body);
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  expect(saved.json?.ok && c.drives.plcs.join() === 'a' && c.drives.everySeconds === 20 && c.drives.limits.heatsinkRise.warn === 7 && c.faults.enabled === false && c.fleet.plcs === undefined && c.projectSync.enabled === false, `saved: drives on ${c.drives.plcs}, fault records ${c.faults.enabled}, fleet on every PLC, project copies ${c.projectSync.enabled}`);
  expect(c.oee.reasons.join() === 'Jam,Material' && c.oee.machines[0].goodVar === 'MAIN.nGood' && c.oee.reasonAfterMin === 3 && c.andon.steps.DOOR_DASHER_ERROR === 'Check S12' && c.andon.steps['SM_TableManager.TABLE_ERROR'] === 'Clamp' && c.workorders.fromCalls === false, 'the OEE, andon and work orders settings saved');
  // 3. The monitors follow them (the Load section)
  const load = await h.until(() => req('GET', '/admin/api/load').then((r) => (r.json?.fleet?.length === 2 ? r.json : null)), 15000);
  expect(load && load.faults.length === 0 && load.fleet.length === 2 && load.projects.length === 0 && load.drives.every((d) => d.plc === 'a'), `the Load section: drives on ${load?.drives?.map((d) => d.plc).join()}, fault records ${load?.faults?.length}, fleet ${load?.fleet?.length}, projects ${load?.projects?.length}`);

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'index.html'));
  if (!built) console.log('skip the browser part: no dist/');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 4. The section: a row per PLC; the fleet off on Line B, saved
    await p.goto(`${BASE}/admin`, { waitUntil: 'load' });
    await p.waitForSelector('[data-monitor-plc="b"] [data-monitor="fleet"]', { timeout: 10000 });
    const states = await p.$$eval('[data-monitor-plc] [data-monitor]', (x) => x.map((e) => `${e.closest('tr').getAttribute('data-monitor-plc')}:${e.getAttribute('data-monitor')}:${e.checked}`));
    await p.click('[data-monitor-plc="b"] [data-monitor="fleet"]');
    await p.click('#admin-monitoring-save');
    const msg = await h.until(() => p.$eval('#admin-monitoring-msg', (e) => e.textContent).then((t) => (t ? t : null)), 8000);
    const c2 = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(states.includes('a:drives:true') && states.includes('b:drives:false') && states.includes('a:faults:false') && /Saved/.test(msg ?? '') && c2.fleet.plcs?.join() === 'a' && c2.drives.limits.heatsinkRise.warn === 7, `the section: ${states.join(' ')}; fleet now on ${c2.fleet.plcs} (${msg})`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

const h = require('../lib/harness.cjs');
// What the page asks of a PLC before going live, over connections of their own (fake-ams2.cjs): a POU type's
// instances (the one to go live on chosen first: SM_TableManager's two, SM_Conveyor's one, none of a type it does not
// have; TwinCAT in Config mode: said); a stopped PLC started from Browse; TwinCAT set from Config to Run mode; the
// found PLCs' states read again. Link: the same messages, said in its features. The desktop app's Update now: its
// release's installer found, downloaded and checked against the release's SHA-256 (a stand-in for GitHub's releases;
// dry run: not started); a file that does not match, not used
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
const { createLiveSession } = require('../../shared/liveSession.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const conn = (port) => ({ netId: '127.0.0.1.1.1', ip: `127.0.0.1:${port}`, localNetId: '127.0.0.1.1.1' });
const call = (session, fn, req) => new Promise((resolve) => session[fn](resolve, req));

const RUN = 48944;
const STOP = 48945;
const CONFIG = 48946;
const runCfg = writeSymbolsPlc('fake-ams2-offline-run.json', [], { sources: true });
const stopCfg = writeSymbolsPlc('fake-ams2-offline-stop.json', [], { adsState: 6 });
const configCfg = writeSymbolsPlc('fake-ams2-offline-config.json');
fs.writeFileSync(configCfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(configCfg, 'utf8')), configMode: true }));

(async () => {
  const plcs = [[RUN, runCfg], [STOP, stopCfg], [CONFIG, configCfg]].map(([port, cfg]) => spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(port), cfg], { stdio: 'ignore' }));
  await sleep(1200);
  // (GitHub's releases, stood in for: a desktop installer with its SHA-256, and one whose SHA-256 is not its own)
  const installer = Buffer.from('MZ fake installer ' + 'x'.repeat(1000));
  const sha = crypto.createHash('sha256').update(installer).digest('hex');
  const releases = http.createServer((req, res) => {
    if (req.url.startsWith('/files/')) return res.end(installer);
    res.setHeader('Content-Type', 'application/json');
    const asset = (v, digest) => ({ name: `KvalMachineScope-Setup-${v}.exe`, browser_download_url: `http://127.0.0.1:48943/files/${v}.exe`, url: `http://127.0.0.1:48943/api/${v}`, size: installer.length, digest: `sha256:${digest}` });
    res.end(JSON.stringify([
      { tag_name: 'desktop-v9.1.0', html_url: 'https://example.invalid/9.1.0', draft: false, prerelease: false, assets: [asset('9.1.0', sha), { name: 'KvalMachineScope-Portable-9.1.0.exe', browser_download_url: 'x', size: 1, digest: '' }] },
      { tag_name: 'desktop-v9.0.0', html_url: 'https://example.invalid/9.0.0', draft: false, prerelease: false, assets: [asset('9.0.0', 'f'.repeat(64))] },
      { tag_name: 'web-v99.0.0', html_url: 'https://example.invalid/w', draft: false, prerelease: false, assets: [] },
    ]));
  });
  await new Promise((r) => releases.listen(48943, '127.0.0.1', r));
  try {
    const session = createLiveSession();
    // A POU type's instances, not live
    const two = await call(session, 'instancesAt', { requestId: 1, connection: conn(RUN), typeName: 'SM_TableManager', stateVar: 'machineState' });
    expect(two.requestId === 1 && two.plcState === 'Run' && (two.instances ?? []).length === 2 && two.instances.every((i) => /smTable[12]$/.test(i)), `SM_TableManager: ${two.error ?? two.instances?.join(', ')}`);
    const one = await call(session, 'instancesAt', { requestId: 2, connection: conn(RUN), typeName: 'SM_Conveyor', stateVar: 'machineState' });
    expect((one.instances ?? []).length === 1 && /conveyor$/i.test(one.instances[0]), `SM_Conveyor: ${one.error ?? one.instances?.join(', ')}`);
    const none = await call(session, 'instancesAt', { requestId: 3, connection: conn(RUN), typeName: 'FB_NotThere', stateVar: 'machineState' });
    expect(!none.error && (none.instances ?? ['x']).length === 0, `a type it does not have: none (${none.error ?? none.instances?.length})`);
    const bad = await call(session, 'instancesAt', { requestId: 4, connection: conn(RUN), typeName: 'X; drop', stateVar: 'machineState' });
    expect(/Invalid/.test(bad.error ?? ''), `a bad type refused: "${bad.error}"`);
    const cfgMode = await call(session, 'instancesAt', { requestId: 5, connection: conn(CONFIG), typeName: 'SM_TableManager', stateVar: 'machineState' });
    expect(/Config mode/.test(cfgMode.error ?? '') && cfgMode.plcState === 'Config' && !cfgMode.instances, `TwinCAT in Config mode: said (${(cfgMode.error ?? '').slice(0, 80)})`);

    // The found PLCs' states again
    const states = await call(session, 'plcStates', { requestId: 6, localNetId: '127.0.0.1.1.1', devices: [{ netId: '127.0.0.1.1.1', ip: `127.0.0.1:${STOP}`, name: 'stopped' }, { netId: '127.0.0.1.1.1', ip: `127.0.0.1:${CONFIG}`, name: 'config' }, { netId: 'x; y', ip: '1' }] });
    const [s1, s2] = states.devices ?? [];
    expect(states.devices?.length === 2 && s1?.state?.plc === 'Stop' && s2?.state?.system === 'Config', `the found PLCs' states: ${JSON.stringify(states.devices?.map((d) => d.state))}`);

    // Started from Browse: a stopped PLC; TwinCAT from Config to Run mode
    const started = await call(session, 'startAt', { requestId: 7, connection: conn(STOP), mode: 'plc', timeoutMs: 5000 });
    expect(started.requestId === 7 && started.ok === true && started.state === 'Run', `a stopped PLC started: ${JSON.stringify(started)}`);
    const runMode = await call(session, 'startAt', { requestId: 8, connection: conn(CONFIG), mode: 'run', timeoutMs: 8000 });
    expect(runMode.ok === true && runMode.state === 'Run', `TwinCAT to Run mode: ${JSON.stringify(runMode)}`);
    const after = await call(session, 'plcStates', { requestId: 9, localNetId: '127.0.0.1.1.1', devices: [{ netId: '127.0.0.1.1.1', ip: `127.0.0.1:${STOP}` }, { netId: '127.0.0.1.1.1', ip: `127.0.0.1:${CONFIG}` }] });
    expect((after.devices ?? []).every((d) => d.state?.system === 'Run' && d.state?.plc === 'Run'), `both run now: ${JSON.stringify(after.devices?.map((d) => d.state))}`);
    const gone = await call(session, 'startAt', { requestId: 10, connection: conn(48999), mode: 'plc', timeoutMs: 2000 });
    expect(gone.ok === false && /did not answer/.test(gone.error ?? ''), `nothing there: "${(gone.error ?? '').slice(0, 70)}"`);

    // Link: the same messages
    const profile = path.join(h.OUT, 'link-appdata-offline-actions');
    fs.mkdirSync(profile, { recursive: true });
    const out = path.join(h.OUT, 'link-offline-actions.txt');
    const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48942'], { env: { ...process.env, APPDATA: profile, KSS_LINK_UPDATES: 'off' }, stdio: ['ignore', fs.openSync(out, 'w'), 'ignore'] });
    try {
      const code = (await h.waitForText(out, /Pairing code:\s+(\S+)/))?.[1];
      const got = [];
      const ws = new WebSocket('ws://127.0.0.1:48942/live', { headers: { Origin: 'https://machinescope.example' } });
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)));
      ws.send(JSON.stringify({ type: 'hello', token: code }));
      const reply = async (type, requestId, ms = 20000) => {
        for (let t = 0; t < ms && !got.some((m) => m.type === type && m.requestId === requestId); t += 150) await sleep(150);
        return got.find((m) => m.type === type && m.requestId === requestId);
      };
      for (let i = 0; i < 20 && !got.some((m) => m.type === 'welcome'); i++) await sleep(150);
      const features = got.find((m) => m.type === 'welcome')?.features ?? [];
      expect(['instancesOffline', 'plcStartAt', 'plcStatesRefresh'].every((f) => features.includes(f)), `Link says it can (${features.slice(-3).join(', ')})`);
      ws.send(JSON.stringify({ type: 'liveInstances', requestId: 31, connection: conn(RUN), typeName: 'SM_TableManager', stateVar: 'machineState' }));
      const li = await reply('liveInstancesResult', 31);
      expect((li?.instances ?? []).length === 2, `Link: the instances (${li?.error ?? li?.instances?.join(', ')})`);
      ws.send(JSON.stringify({ type: 'plcStates', requestId: 32, devices: [{ netId: '127.0.0.1.1.1', ip: `127.0.0.1:${RUN}` }], localNetId: '127.0.0.1.1.1' }));
      const ls = await reply('plcStatesResult', 32);
      expect(ls?.devices?.[0]?.state?.plc === 'Run' && ls.devices[0].state.project === 'Plant', `Link: the states (${JSON.stringify(ls?.devices?.[0]?.state)})`);
      ws.send(JSON.stringify({ type: 'plcStartAt', requestId: 33, connection: conn(RUN), mode: 'plc' }));
      const lst = await reply('plcStartAtResult', 33);
      expect(lst?.ok === true && lst.state === 'Run', `Link: started (${JSON.stringify(lst)})`);
      ws.close();
    } finally {
      link.kill();
    }

    // The desktop app's Update now (dry run: downloaded and checked, not started)
    process.env.KSS_DESKTOP_RELEASES = 'http://127.0.0.1:48943/releases';
    process.env.KSS_SERVICE_DRYRUN = '1';
    const { installUpdate } = require('../../shared/desktopUpdate.cjs');
    let startedFile = null;
    const ok = await installUpdate({ version: '9.1.0', start: (f) => (startedFile = f) });
    expect(ok.ok === true && ok.dry === true && ok.version === '9.1.0' && fs.readFileSync(ok.file).equals(installer) && startedFile === null, `the installer downloaded and checked: ${ok.message}`);
    if (ok.file) fs.rmSync(ok.file, { force: true });
    const newest = await installUpdate({ start: () => {} });
    expect(newest.ok === true && newest.version === '9.1.0', `no version given: the newest (${newest.version ?? newest.message})`);
    const wrong = await installUpdate({ version: '9.0.0', start: (f) => (startedFile = f) });
    expect(wrong.ok === false && /SHA-256/.test(wrong.message) && startedFile === null, `a file that does not match: not used (${wrong.message})`);
    const missing = await installUpdate({ version: '8.0.0', start: () => {} });
    expect(missing.ok === false && /has no installer/.test(missing.message), `a release that is not there: "${missing.message}"`);
    const notRepo = await installUpdate({ repo: 'a b', start: () => {} });
    expect(notRepo.ok === false && /Not a GitHub repository/.test(notRepo.message), `a bad repository refused: "${notRepo.message}"`);
  } finally {
    // (its connections closed first: the downloads' sockets still open at exit end Node with an assertion on Windows)
    releases.closeAllConnections();
    releases.close();
    plcs.forEach((p) => p.kill());
  }
  await sleep(300);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

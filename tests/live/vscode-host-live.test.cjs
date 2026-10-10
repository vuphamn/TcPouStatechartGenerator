// The statechart in VS Code (vscode-extension/host.cjs, as the extension makes it): live view through the desktop
// app's live session against fake-ams.cjs (a PLC on TCP whose MAIN.fbScan.State changes by a script): connected, the
// state's values come to the app, Stop ends it; Build… answered by the extension's build (xaeBuildResult)
const h = require('../lib/harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createHost } = require(path.join(h.REPO, 'vscode-extension', 'host.cjs'));
const { pou } = require(path.join(h.REPO, 'tests', 'fixtures', 'third-party-pou.cjs'));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-vscode-live-'));
  const pouPath = path.join(dir, 'FB_ScanSequencer.TcPOU');
  fs.writeFileSync(pouPath, pou);
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams.cjs'), '48963', 'MAIN.fbScan.State', '0:400,3:400,5:400,3:400,5:4000', '10.9.9.8.1.1'], { stdio: 'ignore' });
  await sleep(700);
  const got = [];
  const built = [];
  const host = createHost({
    pouPath,
    post: (m) => got.push(m),
    ui: {
      version: 'test',
      pick: async () => null,
      reveal: () => {},
      open: () => {},
      // (the extension's: the TwinCAT view's target and build)
      target: () => ({ name: 'Fake', netId: '127.0.0.1.1.1', address: '127.0.0.1:48963' }),
      build: async (file) => {
        built.push(file);
        return { ok: false, errors: 1, warnings: 0, items: [{ level: 'error', text: "Identifier 'x' not defined", file: `${file}@Execute (Impl)`, line: 3, column: 1, project: 'Robot' }] };
      },
    },
  });
  try {
    // Live view: no NetId given by the app (its live settings empty): the target picked in VS Code
    await host.handle({ type: 'liveStart', path: pouPath, stateVar: 'State', instance: 'MAIN.fbScan', localNetId: '10.9.9.8.1.1', ip: '127.0.0.1:48963' });
    for (let i = 0; i < 40 && !got.some((m) => m.type === 'liveValues' && m.events.some((e) => e.value === 5)); i++) await sleep(150);
    const statuses = got.filter((m) => m.type === 'liveStatus').map((m) => m.state);
    const values = got.filter((m) => m.type === 'liveValues').flatMap((m) => m.events.map((e) => e.value)).filter((v, i, a) => i === 0 || v !== a[i - 1]);
    expect(statuses.includes('connected') || statuses.includes('live'), `connected (${[...new Set(statuses)].join(', ')}; ${got.find((m) => m.type === 'liveStatus' && m.state === 'error')?.message ?? ''})`);
    expect(values.includes(3) && values.includes(5), `the state's values come (${values.join(' → ')})`);

    // Write Values from the Live tab (liveWrite): the followed variable written, its new value comes back; one out of
    // its type's range refused
    await host.handle({ type: 'liveWatch', vars: [{ id: 'state', candidates: ['MAIN.fbScan.State'] }] });
    for (let i = 0; i < 30 && !got.some((m) => m.type === 'liveWatchResult'); i++) await sleep(100);
    // (the script's last value held from here)
    await sleep(1400);
    await host.handle({ type: 'liveWrite', requestId: 9, id: 'state', value: 1 });
    const w = got.find((m) => m.type === 'liveWriteResult' && m.requestId === 9);
    for (let i = 0; i < 30 && !got.some((m) => m.type === 'liveVars' && m.values.some((x) => x.id === 'state' && x.v === 1)); i++) await sleep(100);
    const seen = got.some((m) => m.type === 'liveVars' && m.values.some((x) => x.id === 'state' && x.v === 1));
    expect(w?.ok === true && seen, `written: State := 1, its value back (${JSON.stringify(w)}; seen ${seen})`);
    await host.handle({ type: 'liveWrite', requestId: 10, id: 'state', value: 70000 });
    const bad = got.find((m) => m.type === 'liveWriteResult' && m.requestId === 10);
    expect(bad?.ok === false && /whole number/.test(bad.message), `out of its range: refused (${bad?.message})`);
    await host.handle({ type: 'liveWrite', requestId: 11, id: 'nothing', value: 1 });
    expect(got.find((m) => m.type === 'liveWriteResult' && m.requestId === 11)?.ok === false, 'a variable not followed: refused');

    await host.handle({ type: 'liveStop' });
    await sleep(300);
    expect(got.filter((m) => m.type === 'liveStatus').pop()?.state === 'stopped', 'Stop: not connected');

    // Build…: the extension's build, answered as XAE's (xaeBuildResult)
    await host.handle({ type: 'buildProject', requestId: 7 });
    const r = got.find((m) => m.type === 'xaeBuildResult');
    expect(built[0] === pouPath && r?.requestId === 7 && r.ok === false && r.errors === 1 && /Execute \(Impl\)$/.test(r.items?.[0]?.file ?? ''), `Build…: the extension's build (${JSON.stringify(r)})`);
  } finally {
    host.dispose?.();
    plc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

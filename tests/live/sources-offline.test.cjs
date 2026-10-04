const h = require('../lib/harness.cjs');
// The PLC's sources before going live (From PLC with only a Target entered): read from its boot folder over a
// connection of their own, against fake-ams2.cjs with the project downloaded with its sources. The live session:
// without a connection named, "Not connected" as before; with one, the project and its files. Link: says it can
// (sourcesOffline), and answers plcSources without liveStart
const cfg = require('../fakes/symbols-plc.cjs').writeSymbolsPlc('fake-ams2-sources-offline.json', [], { sources: true });
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { createLiveSession } = require('../../shared/liveSession.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 48957;
const connection = { netId: '127.0.0.1.1.1', ip: `127.0.0.1:${PORT}`, localNetId: '127.0.0.1.1.1', port: 851 };
const want = 'POUs/Conveyor/E_Conveyor_States.TcDUT,POUs/Conveyor/SM_Conveyor.TcPOU,POUs/MAIN.TcPOU,POUs/Table/E_TableManager_States.TcDUT,POUs/Table/SM_TableManager.TcPOU';
const ask = (session, req) => new Promise((resolve) => session.sources(resolve, req));

(async () => {
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), String(PORT), cfg], { stdio: 'ignore' });
  await sleep(1200);
  try {
    // The live session, not live
    const session = createLiveSession();
    const none = await ask(session, { requestId: 1 });
    expect(none.error === 'Not connected', `no connection named: "${none.error}"`);
    const r = await ask(session, { requestId: 2, connection });
    const files = (r.files ?? []).map((x) => x.path).sort().join();
    expect(r.requestId === 2 && r.project === 'Plant' && files === want, `a Target named: ${r.error ?? `${r.project}: ${files}`}`);
    const other = await ask(session, { requestId: 3, plcProject: 'Line2', connection });
    expect(!other.error && other.plcProject === 'Line2', `another PLC project on it: ${other.error ?? other.plcProject}`);
    const bad = await ask(session, { requestId: 4, connection: { netId: '127.0.0.1; rm' } });
    expect(/AMS NetId/.test(bad.error ?? ''), `a bad Target refused: "${bad.error}"`);
    const gone = await ask(session, { requestId: 5, connection: { netId: '127.0.0.1.1.1', ip: '127.0.0.1:48999', localNetId: '127.0.0.1.1.1' } });
    expect(/did not answer/.test(gone.error ?? ''), `nothing there: "${(gone.error ?? '').slice(0, 90)}"`);

    // Link: the same, paired, without going live
    const profile = path.join(h.OUT, 'link-appdata-sources');
    fs.mkdirSync(profile, { recursive: true });
    const out = path.join(h.OUT, 'link-sources-run.txt');
    const link = spawn(process.execPath, [path.join(h.REPO, 'link', 'link.cjs'), '--port', '48963'], { env: { ...process.env, APPDATA: profile }, stdio: ['ignore', fs.openSync(out, 'w'), 'ignore'] });
    try {
      let code = null;
      for (let i = 0; i < 30 && !code; i++) {
        await sleep(200);
        code = fs.readFileSync(out, 'utf8').match(/Pairing code:\s+(\S+)/)?.[1] ?? null;
      }
      const got = [];
      const ws = new WebSocket('ws://127.0.0.1:48963/live', { headers: { Origin: 'https://machinescope.example' } });
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      await new Promise((res, rej) => (ws.on('open', res), ws.on('error', rej)));
      ws.send(JSON.stringify({ type: 'hello', token: code }));
      for (let i = 0; i < 20 && !got.some((m) => m.type === 'welcome'); i++) await sleep(150);
      const welcome = got.find((m) => m.type === 'welcome');
      expect(!!welcome?.features?.includes('sourcesOffline'), `Link says it reads them before going live (${(welcome?.features ?? []).join(', ')})`);
      ws.send(JSON.stringify({ type: 'plcSources', requestId: 9, connection }));
      for (let i = 0; i < 50 && !got.some((m) => m.type === 'plcSourcesResult'); i++) await sleep(200);
      const lr = got.find((m) => m.type === 'plcSourcesResult');
      expect(lr?.requestId === 9 && lr.project === 'Plant' && (lr.files ?? []).map((x) => x.path).sort().join() === want, `Link, not live: ${lr?.error ?? `${lr?.project}, ${lr?.files?.length} files`}`);
      ws.close();
    } finally {
      link.kill();
    }
  } finally {
    plc.kill();
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});

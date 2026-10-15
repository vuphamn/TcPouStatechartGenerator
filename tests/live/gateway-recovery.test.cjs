// Guided recovery (gateway/recovery.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): a supervisor writes a
// guide for a door's error state (an operator may not; a guide without steps refused); its checks read from the PLC
// (one passes, one does not, one variable not in the PLC); the operator at the board: the guide on the stopped
// machine's tile, its steps one at a time with their checks live, Recovered (kept: its steps, one skipped); the
// guide on the Andon page too; how often it was used, with the guide.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8512;
const BASE = `http://localhost:${PORT}`;
const tok = (n) => `recovery-${n}-token`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const M = `${R}.aDoors[1]`;

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-recovery.json');
  const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  // (aDoors[1] goes into its error state 2 s in)
  c.script = [...c.script, { hold: 2000, set: { [`${M}.machineState`]: 7 } }];
  fs.writeFileSync(cfg, JSON.stringify(c));
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48998', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-recovery');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 6', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48998', port: 851 }],
    tokens: ['ann', 'sue'].map((n) => ({ name: n, sha256: sha(tok(n)) })),
    roles: { users: { ann: 'operator', sue: 'supervisor' }, groups: {}, default: '', startPages: {}, notify: [] },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-recovery-run.txt');
  const gw = spawn(process.execPath, [path.join(h.REPO, 'gateway', 'gateway.cjs'), 'start', '--config', configPath], { stdio: ['ignore', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'a')] });
  await h.waitForText(logFile, /Setup page/);

  const session = async (name) => {
    const got = [];
    const ws = new WebSocket(`ws://localhost:${PORT}/live`, { headers: { origin: BASE } });
    ws.on('message', (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'hello', token: tok(name) }));
    await h.until(() => got.find((m) => m.type === 'welcome'), 5000);
    let id = 100;
    const ask = async (msg, reply) => {
      const requestId = ++id;
      ws.send(JSON.stringify({ ...msg, requestId }));
      return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 15000);
    };
    return { ws, got, ask };
  };
  // 1. The guide: written by a supervisor; not by an operator; not without steps
  const guide = {
    title: 'Clear the door', state: 'DOOR_DASHER_ERROR', type: 'SM_DoorDasher', plc: '',
    steps: [
      { text: 'Remove the jammed part' },
      { text: 'The count is right', check: { var: `${R}.nCount`, equals: '>=42' } },
      { text: 'Up to speed', check: { var: `${R}.fSpeed`, equals: '>2' } },
      { text: 'The guard closed', check: { var: 'MAIN.bNoSuchGuard', equals: 'TRUE' } },
    ],
  };
  const ann = await session('ann');
  const sue = await session('sue');
  const denied = await ann.ask({ type: 'recoverySave', guide }, 'recoveryResult');
  const empty = await sue.ask({ type: 'recoverySave', guide: { ...guide, steps: [] } }, 'recoveryResult');
  const saved = await sue.ask({ type: 'recoverySave', guide }, 'recoveryResult');
  expect(denied?.ok === false && empty?.ok === false && /a step/.test(empty.error) && saved?.ok && saved.guide.steps.length === 4 && fs.existsSync(path.join(dir, 'recovery-guides.json')), `written by the supervisor (${saved?.ok}); the operator may not (${denied?.message ?? denied?.error}); without steps: ${empty?.error}`);
  // 2. Its checks, read from the PLC
  const checks = await ann.ask({ type: 'recoveryChecks', plc: 'line', checks: saved?.guide?.steps.filter((s) => s.check).map((s) => s.check) }, 'recoveryChecksResult');
  const ck = checks?.checks ?? [];
  expect(ck.length === 3 && ck[0].ok === true && ck[0].value >= 42 && ck[1].ok === false && ck[1].value === 1.5 && ck[2].ok === false && /not in the PLC/.test(ck[2].error ?? ''), `its checks: ${ck.map((x) => `${x.var.split('.').pop()} ${x.value ?? x.error} ${x.ok}`).join('; ')}`);
  ann.ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('board-recovery'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    // 3. The operator at the board: the guide on the stopped door's tile
    await p.goto(`${BASE}/?board&page=machines&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', tok('ann'));
    await p.keyboard.press('Enter');
    const btn = await h.until(() => p.$(`.board-tile[data-path="${M}"] .board-guide[data-guide]`), 20000);
    await btn?.click();
    await p.waitForSelector('#board-recovery', { timeout: 5000 }).catch(() => {});
    const live = await h.until(() => p.$$eval('.recovery-check', (x) => x.map((e) => e.getAttribute('data-ok'))).then((x) => (x.length === 3 && x.every((v) => v) ? x : null)), 10000);
    const liveText = await p.$$eval('.recovery-check', (x) => x.map((e) => e.textContent).join(' | '));
    expect(live?.join() === 'true,false,false', `its checks live on the board: ${live?.join()} (${liveText})`);
    // 4. Its steps one at a time: done, done, skipped, done; Recovered
    await p.click('#recovery-begin');
    for (const which of ['.recovery-done', '.recovery-done', '.recovery-skip', '.recovery-done']) {
      const before = await p.$$eval('.recovery-step[data-done="done"], .recovery-step[data-done="skipped"]', (x) => x.length);
      await h.until(() => p.$(`.recovery-step:not([data-done="done"]):not([data-done="skipped"]) ${which}`), 5000);
      await p.click(`.recovery-step:not([data-done="done"]):not([data-done="skipped"]) ${which}`);
      await h.until(() => p.$$eval('.recovery-step[data-done="done"], .recovery-step[data-done="skipped"]', (x) => x.length).then((n) => (n > before ? n : null)), 5000);
    }
    await p.click('#recovery-recovered');
    const msg = await h.until(() => p.$eval('#recovery-msg', (e) => e.textContent).catch(() => null), 5000);
    const runs = JSON.parse(fs.readFileSync(path.join(dir, 'recovery-runs.json'), 'utf8'));
    const run = runs.at(-1);
    expect(/Recovered/.test(msg ?? '') && run?.outcome === 'recovered' && run.by === 'ann' && run.steps.length === 4 && run.steps.filter((s) => s.skipped).length === 1 && Number(run.steps.find((s) => s.i === 1)?.value) >= 42, `Recovered (${msg}): kept with ${run?.steps?.length} steps, ${run?.steps?.filter((s) => s.skipped).length} skipped, by ${run?.by}`);
    await p.keyboard.press('Escape');
    await p.click('#board-recovery button[title="Close"]').catch(() => {});
    // 5. On the Andon page too
    await p.click('#board-page-andon');
    const andon = await h.until(() => p.$eval(`.andon-down[data-path="${M}"] .board-guide`, (e) => e.textContent).catch(() => null), 10000);
    expect(/Recovery steps/.test(andon ?? ''), `on the Andon page: ${andon}`);
    // 6. How often it was used, with the guide
    sue.ws.send(JSON.stringify({ type: 'recoveryWatch' }));
    const list = await h.until(() => [...sue.got].reverse().find((m) => m.type === 'recoveryGuides' && m.guides?.[0]?.used === 1)?.guides, 5000);
    expect(list?.[0]?.recovered === 1 && list[0].meanMs >= 0, `the guide: used ${list?.[0]?.used}, recovered ${list?.[0]?.recovered}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  sue.ws.close();
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

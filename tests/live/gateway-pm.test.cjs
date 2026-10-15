// Preventive maintenance (gateway/pm.cjs; simulated PLC symbols-plc.cjs; the web app from dist/): a plan every 30 days,
// last done 31 days ago: due, its work order made by itself (its steps, due); a plan every 10 operating hours of a PLC
// counter past due: its work order; one not due: none; plans without an interval, or hours without their counter,
// refused; its work order done: the plan done (due again in 30 days); Work order now (not twice); the Work page's
// Preventive tab.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8516;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'pm-test-token';
const DAY = 86400000;

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-pm.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48966', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-pm');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 3', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48966', port: 851 }],
    tokens: [{ name: 'sup', sha256: crypto.createHash('sha256').update(TOKEN).digest('hex') }],
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
  }, null, 2));
  const logFile = h.out('gw-pm-run.txt');
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
    return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 20000);
  };
  ws.send(JSON.stringify({ type: 'workWatch' }));
  const ordersNow = () => [...got].reverse().find((m) => m.type === 'workOrders')?.orders ?? [];
  // 1. By the calendar: due
  const lastMonth = new Date(Date.now() - 31 * DAY).toISOString().slice(0, 10);
  const cal = await ask({ type: 'pmSave', plan: { title: 'Grease the table bearings', plc: 'line', machine: `${R}.smTable1`, everyDays: 30, lastDoneAt: lastMonth, steps: 'Grease nipples 1 to 4, 2 strokes each', priority: 'high' } }, 'pmResult');
  const calOrder = await h.until(() => ordersNow().find((o) => o.source?.kind === 'pm' && o.source.id === cal?.plan?.id), 5000);
  expect(cal?.ok && cal.plan.due.state === 'due' && /^PM: Grease the table bearings/.test(calOrder?.title ?? '') && calOrder.priority === 'high' && calOrder.due && /Grease nipples/.test(calOrder.log?.[0]?.text ?? ''), `every 30 days, last done 31 days ago: ${cal?.plan?.due?.state}, its work order #${calOrder?.number} (due ${calOrder?.due?.slice(0, 10)})`);
  // 2. By operating hours (a PLC counter): one past due, one not
  const hrs = await ask({ type: 'pmSave', plan: { title: 'Check the belt', plc: 'line', everyHours: 10, lastDoneHours: 20, counter: { kind: 'var', var: `${R}.nCount` } } }, 'pmResult');
  const fine = await ask({ type: 'pmSave', plan: { title: 'Change the spindle bearings', plc: 'line', everyHours: 5000, lastDoneHours: 40, counter: { kind: 'var', var: `${R}.nCount` } } }, 'pmResult');
  const hrsOrder = await h.until(() => ordersNow().find((o) => o.source?.id === hrs?.plan?.id), 5000);
  expect(hrs?.plan?.due?.state === 'due' && hrs.plan.hoursNow >= 42 && !!hrsOrder && fine?.plan?.due?.state === 'ok' && !ordersNow().some((o) => o.source?.id === fine?.plan?.id) && /in \d+ h of running/.test(fine.plan.due.why), `every 10 h (now ${hrs?.plan?.hoursNow} h, done at 20): ${hrs?.plan?.due?.state}, #${hrsOrder?.number}; every 5000 h: ${fine?.plan?.due?.state} (${fine?.plan?.due?.why})`);
  const none = await ask({ type: 'pmSave', plan: { title: 'x', plc: 'line' } }, 'pmResult');
  const noCounter = await ask({ type: 'pmSave', plan: { title: 'x', plc: 'line', everyHours: 5 } }, 'pmResult');
  expect(none?.ok === false && /How often/.test(none.error) && noCounter?.ok === false && /operating hours/.test(noCounter.error), `refused: "${none?.error}"; "${noCounter?.error}"`);
  // 3. Its work order done: the plan done
  await ask({ type: 'workUpdate', id: calOrder?.id, change: { status: 'done', rootCause: 'Greased' } }, 'workResult');
  ws.send(JSON.stringify({ type: 'pmWatch' }));
  const after = await h.until(() => [...got].reverse().find((m) => m.type === 'pmPlans')?.plans?.find((p) => p.id === cal?.plan?.id && !p.openOrder), 5000);
  expect(after?.due?.state === 'ok' && Math.abs(after.due.nextAt - (Date.now() + 30 * DAY)) < 60000, `done: next ${after ? new Date(after.due.nextAt).toISOString().slice(0, 10) : '?'} (${after?.due?.state})`);
  // 4. Work order now; not twice
  const now1 = await ask({ type: 'pmNow', id: fine?.plan?.id }, 'pmResult');
  const now2 = await ask({ type: 'pmNow', id: fine?.plan?.id }, 'pmResult');
  expect(now1?.ok && /^PM: Change the spindle bearings/.test(now1.order?.title ?? '') && now2?.ok === false && /is open/.test(now2.error), `Work order now: #${now1?.order?.number}; again: ${now2?.error}`);
  ws.close();

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('work-pm'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1400, height: 900 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=work&lang=en`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', TOKEN);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#work-tab-pm', { timeout: 20000 });
    const tab = await h.until(() => p.$eval('#work-tab-pm', (e) => e.textContent).then((x) => (/1 due/.test(x ?? '') ? x : null)), 10000);
    await p.click('#work-tab-pm');
    const rows = await h.until(() => p.$$eval('.pm-plan', (x) => x.map((e) => `${e.getAttribute('data-state')}:${e.getAttribute('data-plan')}`)).then((x) => (x.length === 3 ? x : null)), 8000);
    expect(/Preventive \(1 due\)/.test(tab ?? '') && rows?.[0] === 'due:Check the belt', `the Preventive tab "${tab}": ${rows?.join(', ')}`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

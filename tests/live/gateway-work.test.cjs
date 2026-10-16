// Work orders, reliability and the maintenance calendar (gateway/workorders.cjs; simulated PLC symbols-plc.cjs; the
// web app from dist/): a call for maintenance makes a work order by itself; a technician creates one, takes it, may not
// assign it to someone else, closes it only with its root cause; a supervisor assigns one; each machine's failures,
// MTBF and MTTR from the alert history; the calendar's planned window. The board's Work page, its three tabs.
// A call's photo on its work order (one not a PNG refused); a checklist: done only when each step is ticked; signed
// off by a supervisor (not a technician); on the board: the photo, the sign-off.
const h = require('../lib/harness.cjs');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require(require.resolve('ws', { paths: [h.REPO] }));
const { R, writeSymbolsPlc } = require('../fakes/symbols-plc.cjs');
let fails = 0;
const expect = (c, w) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const PORT = 8501;
const BASE = `http://localhost:${PORT}`;
const tok = (n) => `work-${n}-token`;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const M = `${R}.aDoors[2]`;

(async () => {
  const cfg = writeSymbolsPlc('fake-ams2-work.json');
  const plc = spawn(process.execPath, [path.join(h.FAKES, 'fake-ams2.cjs'), '48991', cfg], { stdio: 'ignore' });
  const dir = h.out('gw-work');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // (three failures of aDoors[2] in the last 30 days, each recovered in 10 minutes)
  const DAY = 86400000;
  const history = [3, 10, 20].map((d, i) => ({ id: `f${i}`, event: 'error', plc: 'line', plcName: 'Line 9', machine: M, state: 'DOOR_DASHER_ERROR', text: 'x', at: new Date(Date.now() - d * DAY).toISOString(), ack: null, resolvedAt: new Date(Date.now() - d * DAY + 10 * 60000).toISOString() }));
  fs.writeFileSync(path.join(dir, 'alerts-history.json'), JSON.stringify(history));
  // (a planned maintenance window in two hours)
  const from = new Date(Date.now() + 2 * 3600_000);
  fs.writeFileSync(path.join(dir, 'maintenance.json'), JSON.stringify({ windows: [{ id: 'w1', plc: 'line', from: from.toISOString(), until: new Date(from.getTime() + 3600_000).toISOString(), by: 'sup', note: 'belt', started: false }], history: [] }));
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    port: PORT, insecure: true, appDir: path.join(h.REPO, 'dist'), localNetId: '127.0.0.1.1.1', allowedOrigins: [], alertRetryMs: 2000,
    plcs: [{ id: 'line', name: 'Line 9', netId: '127.0.0.1.1.1', ip: '127.0.0.1:48991', port: 851 }],
    tokens: ['tech', 'sup', 'ann'].map((n) => ({ name: n, sha256: sha(tok(n)) })),
    roles: { users: { tech: 'technician', sup: 'supervisor', ann: 'operator' }, groups: {}, default: '', startPages: {}, notify: [] },
    drives: { enabled: false }, fleet: { enabled: false }, faults: { enabled: false }, projectSync: { enabled: false },
    workorders: { signOff: true, checklists: [{ id: 'motor-change', name: 'Motor change', items: ['Lock out', 'Swap the motor', 'Remove the lockout'] }] },
  }, null, 2));
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const logFile = h.out('gw-work-run.txt');
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
      return h.until(() => got.find((m) => m.type === reply && m.requestId === requestId), 10000);
    };
    return { ws, got, ask };
  };
  // 1. A call makes a work order by itself
  const ann = await session('ann');
  // (its photo first: kept, then on the call and its work order; one that says PNG but is not refused)
  const photo = await ann.ask({ type: 'attachmentAdd', file: { name: 'sensor.png', type: 'image/png', data: PNG } }, 'attachmentAddResult');
  const notPng = await ann.ask({ type: 'attachmentAdd', file: { name: 'x.png', type: 'image/png', data: Buffer.from('hello').toString('base64') } }, 'attachmentAddResult');
  await ann.ask({ type: 'callMaintenance', plc: 'line', machine: M, reason: 'Electrical', note: 'S12 dark', attachments: [photo?.attachment?.id] }, 'callMaintenanceResult');
  const annCreate = await ann.ask({ type: 'workCreate', order: { title: 'x' } }, 'workResult');
  ann.ws.send(JSON.stringify({ type: 'workWatch' }));
  const fromCall = await h.until(() => [...ann.got].reverse().find((m) => m.type === 'workOrders')?.orders?.find((o) => o.source?.kind === 'call'), 5000);
  const back = await ann.ask({ type: 'attachmentGet', id: fromCall?.attachments?.[0]?.id }, 'attachmentGetResult');
  expect(photo?.ok && photo.attachment.by === 'ann' && notPng?.ok === false && /Not a PNG/.test(notPng.error) && fromCall?.attachments?.length === 1 && fromCall.attachments[0].name === 'sensor.png' && back?.ok && back.data === PNG && back.contentType === 'image/png' && fs.existsSync(path.join(dir, 'attachments', `${photo.attachment.id}.png`)), `a call's photo: ${photo?.attachment?.name} (${photo?.attachment?.size} B) on its work order (${fromCall?.attachments?.length}), read back ${back?.ok}; not a PNG: ${notPng?.error}`);
  expect(fromCall?.priority === 'high' && /Electrical at aDoors\[2\]: S12 dark/.test(fromCall.title) && fromCall.machine === M && annCreate?.ok === false, `a call's work order: #${fromCall?.number} "${fromCall?.title}"; an operator creates none (${annCreate?.error})`);
  ann.ws.close();
  // 1b. Spare parts: a supervisor writes one (an operator may not)
  const sup0 = await session('sup');
  const annPart = await (await session('ann')).ask({ type: 'spareSave', part: { number: 'X1', name: 'x' } }, 'spareResult');
  const part = (await sup0.ask({ type: 'spareSave', part: { number: 'S12-SENS', name: 'Door sensor', location: 'Cabinet 3', qty: 3, min: 1, fits: 'SM_DoorDasher' } }, 'spareResult'))?.part;
  expect(annPart?.ok === false && part?.qty === 3, `a spare part written (${part?.number}, ${part?.qty} in stock); an operator may not (${annPart?.message ?? annPart?.error})`);
  sup0.ws.close();
  // 2. A technician: creates, may not assign another, takes it, closes it only with its root cause
  const tech = await session('tech');
  const made = await tech.ask({ type: 'workCreate', order: { title: 'Replace the door sensor S12', plc: 'line', machine: M, priority: 'urgent' } }, 'workResult');
  const o = made?.order;
  const assignOther = await tech.ask({ type: 'workUpdate', id: o?.id, change: { assignee: 'sup' } }, 'workResult');
  const take = await tech.ask({ type: 'workUpdate', id: o?.id, change: { status: 'in progress' } }, 'workResult');
  const noCause = await tech.ask({ type: 'workUpdate', id: o?.id, change: { status: 'done' } }, 'workResult');
  const tooMany = await tech.ask({ type: 'workUpdate', id: o?.id, change: { status: 'done', rootCause: 'x', partsUsed: [{ id: part?.id, qty: 5 }] } }, 'workResult');
  const done = await tech.ask({ type: 'workUpdate', id: o?.id, change: { status: 'done', rootCause: 'Sensor cable cut at the hinge', parts: '2 m cable', partsUsed: [{ id: part?.id, qty: 2 }] } }, 'workResult');
  tech.ws.send(JSON.stringify({ type: 'sparesWatch' }));
  const stock = await h.until(() => [...tech.got].reverse().find((m) => m.type === 'spares'), 5000);
  const sp = stock?.parts?.find((x) => x.number === 'S12-SENS');
  expect(tooMany?.ok === false && /Only 3 of S12-SENS/.test(tooMany.error) && /2 m cable; 2 × S12-SENS Door sensor/.test(done?.order?.parts ?? '') && sp?.qty === 1 && sp.low === true && stock.moves[0]?.order === o?.number && stock.moves[0].delta === -2, `parts from stock: too many refused (${tooMany?.error}); used "${done?.order?.parts}"; ${sp?.qty} left (low ${sp?.low}), its change by work order #${stock?.moves?.[0]?.order}`);
  expect(made?.ok && o.plcName === 'Line 9' && assignOther?.ok === false && /supervisor/.test(assignOther.error) && take?.order?.status === 'in progress' && take.order.assignee === 'tech', `a technician: created #${o?.number}, assigning another refused, taken (${take?.order?.assignee})`);
  expect(noCause?.ok === false && /root cause/.test(noCause.error) && done?.order?.status === 'done' && done.order.rootCause === 'Sensor cable cut at the hinge' && done.order.log.length >= 3, `done only with its root cause: ${done?.order?.rootCause} (${done?.order?.parts})`);
  // (a checklist: done only once each step is ticked; signed off by a supervisor only)
  const withList = (await tech.ask({ type: 'workCreate', order: { title: 'Change the infeed motor', plc: 'line', machine: `${R}.aDoors[3]`, checklist: 'motor-change' } }, 'workResult'))?.order;
  const early = await tech.ask({ type: 'workUpdate', id: withList?.id, change: { status: 'done', rootCause: 'Worn bearing' } }, 'workResult');
  for (const i of [0, 1, 2]) await tech.ask({ type: 'workUpdate', id: withList?.id, change: { check: { index: i, done: true } } }, 'workResult');
  const listDone = await tech.ask({ type: 'workUpdate', id: withList?.id, change: { status: 'done', rootCause: 'Worn bearing' } }, 'workResult');
  const techSign = await tech.ask({ type: 'workUpdate', id: withList?.id, change: { signOff: true } }, 'workResult');
  expect(withList?.checklist?.items?.length === 3 && early?.ok === false && /Its checklist first: 3 steps not ticked/.test(early.error) && listDone?.order?.status === 'done' && listDone.order.checklist.items.every((x) => x.done && x.by === 'tech') && techSign?.ok === false && /supervisor/.test(techSign.error), `a checklist: done refused first (${early?.error}), then done with its 3 steps ticked; a technician signs off: ${techSign?.error}`);
  tech.ws.close();
  const sup1 = await session('sup');
  const signed = await sup1.ask({ type: 'workUpdate', id: withList?.id, change: { signOff: true } }, 'workResult');
  const again = await sup1.ask({ type: 'workUpdate', id: withList?.id, change: { signOff: true } }, 'workResult');
  expect(signed?.order?.signedOffBy === 'sup' && !!signed.order.signedOffAt && again?.ok === false && /already/.test(again.error) && /signed off/.test(signed.order.log.at(-1)?.text ?? ''), `signed off by ${signed?.order?.signedOffBy}; twice: ${again?.error}`);
  sup1.ws.close();
  // 3. A supervisor assigns; reliability; the calendar
  const sup = await session('sup');
  const assigned = await sup.ask({ type: 'workUpdate', id: fromCall?.id, change: { assignee: 'tech' } }, 'workResult');
  const rel = await sup.ask({ type: 'reliability', days: 30 }, 'reliabilityResult');
  const row = rel?.rows?.find((r) => r.machine === M);
  const cal = await sup.ask({ type: 'maintenanceCalendar', from: Date.now() - DAY, to: Date.now() + 2 * DAY }, 'maintenanceCalendarResult');
  expect(assigned?.order?.status === 'assigned' && assigned.order.assignee === 'tech', `a supervisor assigns: ${assigned?.order?.status} to ${assigned?.order?.assignee}`);
  expect(row?.failures === 3 && row.orders === 1 && Math.abs(row.mtbfMs - 10 * DAY) < 60000 && row.mttrMs > 0 && row.causes[0]?.cause === 'Sensor cable cut at the hinge', `reliability: ${row?.failures} failures, MTBF ${(row?.mtbfMs / DAY).toFixed(1)} days, MTTR ${Math.round(row?.mttrMs / 60000)} min, cause ${row?.causes?.[0]?.cause}`);
  expect(cal?.windows?.length === 1 && cal.windows[0].planned && cal.windows[0].plcName === 'Line 9' && cal.windows[0].note === 'belt', `the calendar: ${JSON.stringify(cal?.windows?.[0])}`);
  sup.ws.close();
  expect(fs.existsSync(path.join(dir, 'workorders.json')), 'kept in workorders.json');

  const built = fs.existsSync(path.join(h.REPO, 'dist', 'assets')) && fs.readdirSync(path.join(h.REPO, 'dist', 'assets')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(h.REPO, 'dist', 'assets', f), 'utf8').includes('work-reliability'));
  if (!built) console.log('skip the browser part: dist/ is an older build (npm run build)');
  else {
    const browser = await h.launchBrowser({ defaultViewport: { width: 1600, height: 950 } });
    const errors = [];
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}/?board&page=work`, { waitUntil: 'load' });
    await p.waitForSelector('#board-token', { timeout: 10000 });
    await p.type('#board-token', tok('sup'));
    await p.keyboard.press('Enter');
    await p.select('#work-show', 'all');
    const orders = await h.until(() => p.$$eval('.work-order', (x) => x.length).then((n) => (n >= 2 ? n : null)), 15000);
    await p.click(`.work-order[data-order="${o?.number}"]`);
    const detail = await h.until(() => p.$eval('#work-detail', (e) => e.textContent).catch(() => null), 5000);
    // (the one not signed off: signed off from the board)
    const count = await p.$eval('#work-signoff-count', (e) => e.textContent).catch(() => null);
    await p.click('#work-signoff-btn').catch(() => {});
    const signedText = await h.until(() => p.$eval('#work-signoff', (e) => (/Signed off by sup/.test(e.textContent ?? '') ? e.textContent : null)).catch(() => null), 8000);
    await p.click('#work-detail button[title^="Close"]').catch(() => {});
    // (the call's work order: its photo shown)
    await p.click(`.work-order[data-order="${fromCall?.number}"]`);
    const img = await h.until(() => p.$eval('#work-detail .attachment-thumb img', (e) => (e.complete && e.naturalWidth === 1 ? e.getAttribute('alt') : null)).catch(() => null), 8000);
    const canAdd = await p.$('#work-detail .attachment-add');
    await p.click('#work-detail button[title^="Close"]').catch(() => {});
    expect(/1 to sign off/.test(count ?? '') && !!signedText && img === 'sensor.png' && !!canAdd, `the board: "${count}", signed off ("${signedText}"); the call's photo shown (${img}), a photo to add`);
    await p.click('#work-tab-calendar');
    const win = await h.until(() => p.$eval('.calendar-window', (e) => e.textContent).catch(() => null), 8000);
    await p.click('#work-tab-reliability');
    const rel2 = await h.until(() => p.$eval(`.reliability-row[data-machine="${M}"]`, (e) => e.textContent).catch(() => null), 8000);
    await p.click('#work-tab-parts');
    const lowRow = await h.until(() => p.$eval('.spare-part[data-low="true"] .spare-qty', (e) => e.textContent).catch(() => null), 8000);
    const tabText = await p.$eval('#work-tab-parts', (e) => e.textContent);
    expect(/1/.test(lowRow ?? '') && /1 low/.test(tabText ?? ''), `the Parts tab: S12-SENS ${lowRow} (low), the tab "${tabText}"`);
    expect(orders >= 2 && /Sensor cable cut at the hinge/.test(detail ?? '') && /Line 9/.test(win ?? '') && /10\.0 days/.test(rel2 ?? ''), `the Work page: ${orders} orders, the done one's root cause, the calendar's window, reliability "${rel2}"`);
    expect(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await browser.close();
  }
  gw.kill();
  plc.kill();
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

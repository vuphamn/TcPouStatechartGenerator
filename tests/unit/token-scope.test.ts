// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Tokens (gateway/tokens.cjs): an expired one refused, one rotated out let in until its grace ends (then not), a
// wrong one not; a token of some PLCs: a message of another PLC refused, its lists narrowed (an empty one: all of its
// own); what it is sent narrowed (alerts, work orders, drives, its welcome), gateway-wide ones (no PLC) kept
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');
const { tokenFor, allowedOf, scopeIn, scopeOut } = require('../../gateway/tokens.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
  const now = Date.parse('2026-10-16T12:00:00Z');
  const tokens = [
    { name: 'ann', sha256: sha256('new-ann'), previous: { sha256: sha256('old-ann'), until: '2026-10-20T00:00:00Z' }, plcs: ['line2'] },
    { name: 'bob', sha256: sha256('bob'), expires: '2026-10-01T00:00:00Z' },
    { name: 'cy', sha256: sha256('cy'), previous: { sha256: sha256('old-cy'), until: '2026-10-10T00:00:00Z' } },
  ];
  const a = tokenFor(tokens, 'new-ann', sha256, now);
  const old = tokenFor(tokens, 'old-ann', sha256, now);
  const late = tokenFor(tokens, 'old-cy', sha256, now);
  const ex = tokenFor(tokens, 'bob', sha256, now);
  expect(a?.token?.name === 'ann' && !a.old && old?.token?.name === 'ann' && old.old && late === null && ex?.expired?.name === 'bob' && tokenFor(tokens, 'nope', sha256, now) === null, `tokens: ann's new and old (until its grace) let in; cy's old past its grace not; bob's expired; a wrong one not`);
  const allowed = allowedOf(a.token);
  expect(allowedOf(tokens[1]) === null && allowed.has('line2') && allowed.size === 1, 'its PLCs: ann line2 only; bob all');
  const watch = { type: 'boardWatch', plcs: [] };
  const some = { type: 'drivesWatch', plcs: ['line1', 'line2'] };
  const other = { type: 'workCreate', order: { plc: 'line1', title: 'x' } };
  const shelf = { type: 'alarmShelve', shelf: { plc: 'line1' } };
  expect(!scopeIn(watch, allowed) && watch.plcs.join() === 'line2' && !scopeIn(some, allowed) && some.plcs.join() === 'line2' && scopeIn(other, allowed) && scopeIn(shelf, allowed) && scopeIn({ type: 'faultsList', plc: 'line1' }, allowed) && !scopeIn({ type: 'x', plc: 'line2' }, allowed), 'in: an empty list all of its own, another PLC left out of a list; one of another PLC refused (a work order, a shelf, a message)');
  const alerts = scopeOut({ type: 'alertsList', events: [{ plc: 'line1' }, { plc: 'line2' }, { plc: '' }] }, allowed);
  const ev1 = scopeOut({ type: 'alertEvent', event: { plc: 'line1' } }, allowed);
  const orders = scopeOut({ type: 'workOrders', orders: [{ plc: 'line1' }, { plc: null }, { plc: 'line2' }] }, allowed);
  const drives = scopeOut({ type: 'drivesState', plcs: [{ id: 'line1' }, { id: 'line2' }] }, allowed);
  const welcome = scopeOut({ type: 'welcome', plcs: [{ id: 'line1' }, { id: 'line2' }] }, allowed);
  const same = { type: 'other', x: 1 };
  expect(alerts.events.length === 2 && ev1 === null && orders.orders.length === 2 && drives.plcs.length === 1 && welcome.plcs[0].id === 'line2' && welcome.plcs.length === 1 && scopeOut(same, allowed) === same && scopeOut(ev1, null) === null, `out: alerts ${alerts.events.length} (its own, the gateway's), one of another PLC not sent, work orders ${orders.orders.length}, drives ${drives.plcs.length}, its welcome ${welcome.plcs.map((p: { id: string }) => p.id)}`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

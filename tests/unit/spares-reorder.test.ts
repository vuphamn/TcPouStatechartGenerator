// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Spare parts: a part's reorder suggestion (gateway/spares.cjs reorderOf: its use the last 90 days, counted stock
// not a use, its supplier's lead time), and the parts that fit a device (src/utils/spares.ts: "i550" fits a Lenze
// i550's box, a word of its type or name; not a part of nothing)
/* eslint-disable @typescript-eslint/no-require-imports */
const { reorderOf } = require('../../gateway/spares.cjs');
import { sparesFor, fitsTokens } from '../../src/utils/spares.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const DAY = 86400000;
  const now = Date.parse('2026-10-16T12:00:00Z');
  const part = (x: Record<string, unknown>) => ({ id: 'p1', number: 'S12', name: 'Door sensor', qty: 10, min: 2, unit: '', fits: '', location: '', supplier: '', notes: '', low: false, updatedAt: 0, leadDays: null, ...x });
  // (18 used in 90 days: 0.2 a day; a count of -5 not a use; one older than 90 days not)
  const moves = [
    { part: 'p1', delta: -9, at: now - 10 * DAY, why: 'work order' },
    { part: 'p1', delta: -9, at: now - 50 * DAY, why: 'taken' },
    { part: 'p1', delta: -5, at: now - 5 * DAY, why: 'counted' },
    { part: 'p1', delta: -40, at: now - 100 * DAY, why: 'taken' },
    { part: 'p1', delta: 20, at: now - 60 * DAY, why: 'delivery' },
    { part: 'p2', delta: -50, at: now - DAY, why: 'taken' },
  ];
  const ok = reorderOf(part({ qty: 10 }), moves, now);
  expect(ok.used90 === 18 && Math.abs(ok.usedPerDay - 0.2) < 1e-9 && ok.daysLeft === 50 && ok.leadDays === 14 && ok.suggest === 0, `enough: used ${ok.used90} (${ok.usedPerDay} a day), lasts ${ok.daysLeft} days, lead ${ok.leadDays}: order ${ok.suggest}`);
  // (4 left: 20 days, less than 14 days and a week: order its level and 44 days of use, less its stock: 2 + 8.8 - 4)
  const soon = reorderOf(part({ qty: 4 }), moves, now);
  expect(soon.daysLeft === 20 && soon.suggest === 7, `running out: lasts ${soon.daysLeft} days: order ${soon.suggest}`);
  // (a longer lead time: 30 days; 7 left lasts 35 days, less than 37: due, order 2 + 12 - 7 = 7)
  const longLead = reorderOf(part({ qty: 7, leadDays: 30 }), moves, now);
  expect(longLead.leadDays === 30 && longLead.suggest === 7, `a 30-day lead time: order ${longLead.suggest}`);
  // (never used, at its level: its level to order; not at it: nothing)
  const idle = reorderOf(part({ id: 'p9', qty: 1, min: 3 }), moves, now);
  const idleOk = reorderOf(part({ id: 'p9', qty: 5, min: 3 }), moves, now);
  expect(idle.used90 === 0 && idle.daysLeft === null && idle.suggest === 2 && idleOk.suggest === 0, `not used: at its level order ${idle.suggest}; above it ${idleOk.suggest}`);
  // What fits a device
  const parts = [part({ id: 'a', number: 'I550-075', fits: 'i550, Lenze inverter', qty: 0 }), part({ id: 'b', number: 'FAN-550', fits: 'I550', qty: 2 }), part({ id: 'c', number: 'EL1008', fits: 'EL1008; EL1018' }), part({ id: 'd', number: 'X', fits: ' , a' })];
  const drive = sparesFor(parts, 'Table 1 VFD', 'Table 1 VFD (Inverter i550 Cabinet)', 'i550 Inverter FW V05.02.xx').map((p) => p.number).join(' ');
  const box = sparesFor(parts, 'Term 4 (EL1018)', 'EL1018-0000').map((p) => p.number).join(' ');
  expect(drive === 'FAN-550 I550-075' && box === 'EL1008' && !sparesFor(parts).length && fitsTokens(' , a').length === 0, `fits: the i550 "${drive}" (in stock first), an EL1018 box "${box}"; nothing for nothing; one-letter words not words`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The commissioning report (commissioningReport.ts); the live state in expressions: _state, _inState (watchExpr.ts)
import { commissioningReport } from '../../src/utils/commissioningReport.ts';
import { evalExpr, isStateVar, parseExpr, withState } from '../../src/utils/watchExpr.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- The commissioning report ----
const html = commissioningReport({
  pouType: 'SM_A',
  allowed: ['IDLE', 'RUN'],
  where: 'project',
  made: new Date(Date.UTC(2026, 9, 13)),
  log: [
    { t: '2026-10-13T08:00:00.000Z', user: 'ann', state: 'RUN', from: 'IDLE', plc: '5.1.2.3.1.1:851', ok: true, reason: 'test <after> the valve' },
    { t: '2026-10-13T09:00:00.000Z', user: 'bob', state: 'IDLE', from: 'RUN', plc: '5.1.2.3.1.1:851', ok: false, message: 'Not connected' },
    { t: '2026-10-13T10:00:00.000Z', user: 'ann', state: 'RUN', from: 'IDLE', plc: '', ok: true },
  ],
});
expect(html.startsWith('<!doctype html>') && html.includes('<title>Commissioning: SM_A</title>') && html.includes('<span class="chip">IDLE</span>'), 'a page: the POU type, the states it may be set to');
expect(html.includes('3 states set, 1 not written') && html.includes('<li>ann: 2</li>') && html.includes('<li>RUN: 2</li>'), 'the counts: by user, by state, not written');
const rows = html.split('<tbody>')[1];
expect(rows.indexOf('10:00:00') < rows.indexOf('09:00:00') && rows.includes('test &lt;after&gt; the valve') && rows.includes('class="failed"') && rows.includes('not written: Not connected'), 'every state set, newest first, escaped, the failed one marked');
expect(commissioningReport({ pouType: 'X', allowed: [], log: [], where: 'browser' }).includes('nobody set the PLC to a state'), 'none yet: said');

// ---- _state, _inState ----
const state = { name: 'TABLEMANAGER_CLAMPED', sinceMs: Date.now() - 45_000 };
const ev = (s: string, vals: Record<string, number | boolean> = {}) => {
  const p = parseExpr(s);
  return 'error' in p ? `!${p.error}` : evalExpr(p.node, withState((n) => vals[n], state));
};
expect(ev('_state = TABLEMANAGER_CLAMPED') === true && ev('_state <> TABLEMANAGER_CLAMPED') === false, '_state: the live state, compared by its name');
expect(ev('_inState > T#30S') === true && ev('_inState > T#1M') === false, '_inState: how long in it (ms)');
expect(ev('_state = TABLEMANAGER_CLAMPED AND fTemp > 80', { ftemp: 85 }) === true, 'with variables');
expect(isStateVar('_state') && isStateVar('_inState') && !isStateVar('state') && !isStateVar('_states'), 'not PLC variables (not asked of the PLC)');
expect(evalExpr((parseExpr('_inState > 0') as { node: never }).node, withState(() => undefined, null)) === null, 'not live: no value');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

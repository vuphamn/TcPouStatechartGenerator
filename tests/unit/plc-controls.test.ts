// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// What a PLC's state offers (Browse, the gateway's PLC): Config: Run mode; stopped: Start; running: Stop, Restart; no
// program, no answer: nothing; only what is allowed (an older Link: start and Run mode). Its badge's text; the states
// that changed when read again; a remembered PLC that ran and does not now (stopped, or gone), for its notification
import { ALL_PLC_CONTROLS, needsRenew, plcActionDone, plcActionQuestion, plcActions, plcStateText, stateChanges, type PlcState } from '../../src/components/PlcControls.tsx';
import { checkRuns } from '../../src/components/PlcBrowser.tsx';
import type { CheckResult } from '../../src/utils/connectionCheck.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const run: PlcState = { system: 'Run', plc: 'Run', project: 'Plant' };
const stop: PlcState = { system: 'Run', plc: 'Stop' };
const config: PlcState = { system: 'Config', plc: null };
const invalid: PlcState = { system: 'Run', plc: 'Invalid', project: 'TransferTable' };
const gone: PlcState = { error: 'no route for this computer' };

expect(plcActions(run, ALL_PLC_CONTROLS).join() === 'stop,restart', 'running: Stop, Restart');
expect(plcActions(stop, ALL_PLC_CONTROLS).join() === 'plc', 'stopped: Start');
expect(plcActions(config, ALL_PLC_CONTROLS).join() === 'run', 'Config: Run mode');
expect(plcActions(invalid, ALL_PLC_CONTROLS).length === 0 && plcActions(gone, ALL_PLC_CONTROLS).length === 0 && plcActions(null, ALL_PLC_CONTROLS).length === 0, 'no program, no answer, not read: nothing');
expect(plcActions(run, ['plc', 'run']).length === 0 && plcActions(stop, ['plc', 'run']).join() === 'plc', 'an older Link: no Stop or Restart');
expect(plcActions(run, []).length === 0, 'nothing allowed: nothing');

expect([run, stop, config, invalid, gone, { system: 'Run', plc: 'none' } as PlcState].map(plcStateText).join() === 'Run,Stop,Config,no program,no route,no PLC', 'the badges\' texts');
const ranOut: PlcState = { system: 'Run', plc: 'Invalid', license: { state: 'expired', expires: '2026-01-01T00:00:00Z' } };
const soon: PlcState = { system: 'Run', plc: 'Run', license: { state: 'soon', expires: '2026-01-01T00:00:00Z' } };
expect(plcStateText(ranOut) === 'license ran out' && plcStateText(soon) === 'Run', 'no program, its license ran out: said so');
expect(needsRenew(ranOut) && needsRenew(soon) && !needsRenew(run) && !needsRenew(gone) && !needsRenew({ ...run, license: { state: 'ok', expires: 'x' } }), 'Renew license: ran out, or soon');
expect(/Stop the PLC on Line\?/.test(plcActionQuestion('stop', 'Line')) && /Run mode\?/.test(plcActionQuestion('run', 'Line')) && /initial values/.test(plcActionQuestion('restart', 'Line')), 'each asked in its own words');
expect(plcActionDone('stop', { ok: true, state: 'Stop' }, 'Line') === 'Its PLC is stopped (Stop)' && plcActionDone('restart', { ok: false, state: 'Error', error: 'x' }, 'Line') === 'Not restarted (Error): x', 'what it answered, in words');

const before = new Map([['a', 'Run'], ['b', 'Stop'], ['c', 'Run']]);
const changed = stateChanges(before, [['a', stop], ['b', stop], ['c', undefined], ['d', run]], 1000);
expect(JSON.stringify(changed) === JSON.stringify({ a: { from: 'Run', at: 1000 } }), `read again: only the one that changed (${JSON.stringify(changed)})`);

const result = (steps: CheckResult['steps']): CheckResult => ({ steps, verdict: 'v' });
const ok = result([{ id: 'port', ok: true, title: 'p' }, { id: 'ads', ok: true, title: 'a' }]);
const stopped = result([{ id: 'port', ok: true, title: 'p' }, { id: 'ads', ok: true, title: 'a' }, { id: 'plc', ok: null, title: 'stopped' }]);
const noProgram = result([{ id: 'ads', ok: true, title: 'a' }, { id: 'plc', ok: false, title: 'no program' }]);
const unreachable = result([{ id: 'port', ok: false, title: 'closed' }]);
expect(checkRuns(ok) === true && checkRuns(stopped) === false && checkRuns(noProgram) === false && checkRuns(unreachable) === false && checkRuns(null) === null, 'runs: answers with no step about its PLC; stopped, no program, gone: not');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

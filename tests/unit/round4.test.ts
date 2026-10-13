// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The inputs a guard needs (pathTest.ts) and a TcUnit test of a path; watch expressions' functions and typed
// literals (watchExpr.ts); snapshots compared and as CSV (LiveSnapshots.tsx); the Problems' "State by number"
// (stateMachineLint.ts)
import { generateTcUnitPathTest, guardInputs } from '../../src/utils/pathTest.ts';
import { evalExpr, parseExpr } from '../../src/utils/watchExpr.ts';
import { compareSnapshots, snapshotsCsv, type LiveSnapshot } from '../../src/components/LiveSnapshots.tsx';
import { lintStateMachine } from '../../src/utils/stateMachineLint.ts';
import { readStateCode, writeStateCode } from '../../src/utils/stateActions.ts';
import { enumValueMap } from '../../src/utils/liveView.ts';
import { SAMPLES } from '../../src/samples/samplesData.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- A guard's inputs ----
const g = (s: string) => {
  const r = guardInputs(s);
  return `${r.set.map((x) => `${x.name}=${String(x.value)}`).join(',')}${r.notes.length ? ` | ${r.notes.join('; ')}` : ''}`;
};
expect(g('bStart AND NOT bStop') === 'bStart=true,bStop=false', `AND, NOT: ${g('bStart AND NOT bStop')}`);
expect(g('nCount >= 10') === 'nCount=10' && g('nCount > 10') === 'nCount=11' && g('10 < nCount') === 'nCount=11' && g('nCount < 3') === 'nCount=2', 'comparisons: the value that makes them true');
expect(g('eMode = E_Mode.Auto') === 'eMode=E_Mode.Auto', `an enum member: ${g('eMode = E_Mode.Auto')}`);
expect(g('bA OR bB') === 'bA=true', 'an OR: its first side');
expect(/^ \| set by its block, not from outside: fbTimer\.Q = true$/.test(g('fbTimer.Q')) && /not understood/.test(g('isReady()')), `a block's output, a call: said (${g('fbTimer.Q')} / ${g('isReady()')})`);
expect(g('') === '' && g('(always)') === '', 'no guard: nothing');

// ---- A TcUnit test of a path ----
const path = [
  { from: 'IDLE', to: 'RUN', guard: 'bStart AND NOT bStop', edgeId: 'e1' },
  { from: 'RUN', to: 'DONE', guard: 'nCount >= 10 AND fbTimer.Q', edgeId: 'e2' },
];
const t = generateTcUnitPathTest({ pou: 'FB_Machine', enumType: 'E_State', stateVar: 'eState', path, suiteName: 'FB_Machine_Path1_Test', started: Date.UTC(2026, 9, 13, 9, 0) });
expect(t.name === 'FB_Machine_Path1_Test' && t.steps === 3 && t.methodName === 'Path_202610130900', `the suite and its method (${t.name}, ${t.methodName})`);
expect(t.methodCode.includes('fbUut.bStart := TRUE;') && t.methodCode.includes('fbUut.bStop := FALSE;') && t.methodCode.includes('fbUut.nCount := 10;'), 'each step writes its guard\'s inputs');
expect(t.methodCode.includes('// set by its block, not from outside: fbTimer.Q = true') && t.declaration.includes('[E_State.IDLE, E_State.RUN, E_State.DONE]'), 'what it cannot set: a comment in its step; the states expected');
const enumPath = generateTcUnitPathTest({ pou: 'P', enumType: 'E', stateVar: 's', path: [{ from: 'A', to: 'B', guard: 'eMode = E_Mode.Auto', edgeId: 'x' }] });
expect(enumPath.methodCode.includes('fbUut.eMode := E_Mode.Auto;'), 'an enum member written as it is (no quotes)');

// ---- Watch expressions: functions, typed literals ----
const ev = (s: string, v: Record<string, number | boolean>) => {
  const p = parseExpr(s);
  return 'error' in p ? `!${p.error}` : evalExpr(p.node, (n) => v[n]);
};
expect(ev('LIMIT(0, ABS(x), 5) + MAX(1, 2, 3)', { x: -9 }) === 8 && ev('SEL(b, 16#10, 2#11)', { b: false }) === 16 && ev('t > T#1S500MS', { t: 1600 }) === true, 'ABS, LIMIT, MAX, SEL, 16# / 2#, T#');
expect(String(ev('MIN(x)', { x: 1 })).startsWith('!') && String(ev('16#ZZ', {})).startsWith('!'), 'a wrong one said');

// ---- Snapshots ----
const a: LiveSnapshot = { id: '1', t: Date.UTC(2026, 0, 1), label: 'A', state: 'IDLE', values: { bOn: true, n: 1, s: 'x' } };
const b: LiveSnapshot = { id: '2', t: Date.UTC(2026, 0, 1, 0, 1), label: 'B', state: 'RUN', values: { bOn: true, n: 2, m: 5 } };
const rows = compareSnapshots(a, b);
expect(rows.map((r) => `${r.name}:${r.same}`).join(' ') === 'm:false n:false s:false bOn:true', `compared: the differences first (${rows.map((r) => r.name).join(', ')})`);
const csv = snapshotsCsv([a, b]).split('\n');
expect(csv[0] === 'variable;A (2026-01-01T00:00:00.000Z);B (2026-01-01T00:01:00.000Z)' && csv[1] === '(state);IDLE;RUN' && csv.includes('n;1;2') && csv.includes('m;—;5'), `as CSV: ${csv.slice(0, 3).join(' | ')}`);

// ---- Problems: the state variable by number ----
const s = SAMPLES[0];
const clamped = [...enumValueMap(s.dutContent)].find(([, n]) => n === 'TABLEMANAGER_CLAMPED')![0];
const code = readStateCode(s.pouContent, 'TABLEMANAGER_IDLE_FEED_OFF') as string[];
const w = writeStateCode(s.pouContent, 'TABLEMANAGER_IDLE_FEED_OFF', [...code, `IF bProbe THEN machineState := ${clamped}; END_IF`].join('\n'));
const found = 'pou' in w ? lintStateMachine(w.pou, s.dutContent).filter((f) => f.rule === 'state-number') : [];
expect(found.length === 1 && found[0].fix?.kind === 'numbers-to-enum' && /set or tested by number 1 time/.test(found[0].message), `State by number: ${found[0]?.message}`);
expect(lintStateMachine(s.pouContent, s.dutContent).every((f) => f.rule !== 'state-number'), 'the sample as it is: none');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

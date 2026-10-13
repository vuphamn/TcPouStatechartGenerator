// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The new features' logic: watch expressions (src/utils/watchExpr.ts), Convert to CASE (ifToCase.ts), a TcUnit test
// from a recorded run (tcunitTest.ts), the online change's risks (onlineChangeRisks.ts), the timeline's bars
// (StateTimeline laneSegments)
import { evalExpr, exprText, isWatchExpr, parseExpr } from '../../src/utils/watchExpr.ts';
import { ifToCase } from '../../src/utils/ifToCase.ts';
import { generateTcUnitTest } from '../../src/utils/tcunitTest.ts';
import { onlineChangeRisks, retainVars } from '../../src/utils/onlineChangeRisks.ts';
import { laneSegments } from '../../src/components/StateTimeline.tsx';
import { eventsCsv } from '../../src/components/EventLog.tsx';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- Watch expressions ----
const vals: Record<string, boolean | number | string> = { ba: true, bb: false, fpos: 12.5, ftarget: 10, ncount: 7, 'fbaxis.nstate': 3, emode: 'E_Mode.Auto' };
const ev = (src: string) => {
  const p = parseExpr(src);
  return 'error' in p ? `!${p.error}` : evalExpr(p.node, (n) => vals[n]);
};
expect(ev('bA AND NOT bB') === true && ev('bA AND bB') === false && ev('bA XOR bB') === true && ev('bB OR_ELSE bA') === true, 'booleans: AND NOT, XOR, OR_ELSE');
expect(ev('fPos - fTarget') === 2.5 && ev('-(fPos - fTarget) * 2') === -5 && ev('nCount MOD 3') === 1 && ev('nCount / 0') === null, 'arithmetic, unary minus, MOD; division by 0: no value');
expect(ev('nCount >= 7 AND fbAxis.nState <> 2') === true && ev('(nCount < 5) OR (fPos > 20)') === false, 'comparisons, paths, parentheses');
expect(ev("eMode = Auto") === true && ev('eMode <> E_Mode.Auto') === false, 'an enum value compared by its member name');
expect(ev('nUnknown + 1') === null, 'a variable not known yet: no value');
expect(typeof ev('bA AND (') === 'string' && String(ev('bA AND (')).startsWith('!') && String(ev('bA $ bB')).startsWith('!'), `errors said (${ev('bA $ bB')})`);
const pv = parseExpr('fbAxis.nState + nCount');
expect(!('error' in pv) && pv.vars.join(',') === 'fbAxis.nState,nCount', 'its variables listed (watched with it)');
expect(isWatchExpr('= bA AND bB') && !isWatchExpr('bA') && exprText(' = bA AND bB') === 'bA AND bB', 'an entry "= …" is an expression');

// ---- Convert to CASE ----
const code = [
  'IF eState = E_State.Idle THEN',
  '\tbReady := TRUE;',
  'ELSIF eState = E_State.Run OR eState = E_State.Jog THEN',
  '\tIF bStop THEN eState := E_State.Idle; END_IF',
  '\tnCount := nCount + 1;',
  'ELSIF (eState = E_State.Error) THEN',
  '\tIF bReset THEN',
  '\t\teState := E_State.Idle;',
  '\tEND_IF',
  'ELSE',
  '\tbReady := FALSE;',
  'END_IF',
  'x := 1;',
].join('\n');
const c = ifToCase(code, 0);
expect(!('error' in c) && c.variable === 'eState', 'the IF chain converted');
if (!('error' in c)) {
  const out = c.code.split('\n');
  expect(out[0] === 'CASE eState OF' && out[1] === '\tE_State.Idle:' && out[2] === '\t\tbReady := TRUE;', `the first arm under its label (${JSON.stringify(out.slice(0, 3))})`);
  expect(out.includes('\tE_State.Run, E_State.Jog:') && out.includes('\tE_State.Error:'), 'OR made a label list; parentheses taken off');
  expect(out.includes('\t\tIF bStop THEN eState := E_State.Idle; END_IF') && out.includes('\t\tEND_IF'), 'nested IFs kept (one-line too), a step in');
  expect(out.includes('ELSE') && out.includes('\tbReady := FALSE;') && out.at(-2) === 'END_CASE' && out.at(-1) === 'x := 1;', 'ELSE at the CASE level; the code after kept');
}
const err = (src: string, line = 0) => {
  const r = ifToCase(src, line);
  return 'error' in r ? r.error : '';
};
expect(/different variables/.test(err('IF a = 1 THEN\n\tx();\nELSIF b = 2 THEN\n\ty();\nEND_IF')), 'different variables: not converted');
expect(/one condition/.test(err('IF a = 1 THEN\n\tx();\nELSE\n\ty();\nEND_IF')), 'a single condition: not converted');
expect(/same variable with a value/.test(err('IF a > 1 THEN\n\tx();\nELSIF a = 2 THEN\n\ty();\nEND_IF')), 'a comparison other than = : not converted');
expect(/twice/.test(err('IF a = 1 THEN\n\tx();\nELSIF a = 1 THEN\n\ty();\nEND_IF')), 'a value tested twice: not converted');
expect(/No IF/.test(err('x := 1;')), 'not an IF line');
const crlf = ifToCase('  IF n = 1 THEN\r\n    a();\r\n  ELSIF n = 2 THEN\r\n    b();\r\n  END_IF', 0);
expect(!('error' in crlf) && crlf.code.split('\r\n')[0] === '  CASE n OF' && crlf.code.split('\r\n')[1] === '    1:', 'CRLF and space indents kept');

// ---- TcUnit test from a recorded run ----
const names: Record<number, string> = { 0: 'Idle', 1: 'Run', 2: 'Done' };
const t = generateTcUnitTest({
  pou: 'FB_Machine',
  enumType: 'E_MachineState',
  stateVar: 'eState',
  stateName: (v) => names[v] ?? String(v),
  run: {
    values: [{ t: 1000, value: 0 }, { t: 1500, value: 0 }, { t: 2000, value: 1 }, { t: 5000, value: 2 }],
    vars: [
      { id: 'bstart', t: 1000, v: false },
      { id: 'bstart', t: 1990, v: true },
      { id: 'bdone', t: 1000, v: false },
      { id: 'bdone', t: 4990, v: true },
      { id: 'gvl.other', t: 1000, v: 1 },
    ],
    watched: { bstart: { symbol: 'MAIN.fbMachine.bStart', type: 'BOOL' }, bdone: { symbol: 'MAIN.fbMachine.bDone', type: 'BOOL' }, 'gvl.other': { symbol: 'GVL.other', type: 'INT' } },
    instance: 'MAIN.fbMachine',
    started: Date.UTC(2026, 9, 12, 8, 30),
  },
});
expect(t.name === 'FB_Machine_Test', `the suite's name (${t.name})`);
const s = generateTcUnitTest({ pou: 'P', enumType: 'E', stateVar: 's', stateName: String, run: { values: [{ t: 0, value: 0 }, { t: 9, value: 1 }], vars: [{ id: 'txt', t: 5, v: "it's $5" }], watched: { txt: { symbol: 'M.p.txt' } }, instance: 'M.p' } });
expect(s.methodCode.includes("fbUut.txt := 'it$'s $$5';"), `a STRING's quote and dollar escaped as ST's $' and $$ (${s.methodCode.match(/fbUut\.txt.*/)?.[0]})`);
expect(t.steps === 3 && t.methodName === 'RecordedRun_202610120830', `three states one after another, the method named by the time (${t.steps}, ${t.methodName})`);
expect(t.declaration.includes('EXTENDS TcUnit.FB_TestSuite') && t.declaration.includes('fbUut : FB_Machine;') && t.declaration.includes('[E_MachineState.Idle, E_MachineState.Run, E_MachineState.Done]'), 'the declaration: the suite, the instance, the expected states');
expect(t.methodCode.includes('fbUut.bStart := TRUE;') && t.methodCode.includes('fbUut.bDone := TRUE;') && !t.methodCode.includes('GVL.other') && !t.methodCode.includes('other :='), 'the inputs written relative to the instance; others left out');
expect(/1: \/\/ Idle -> Run/.test(t.methodCode) && /2: \/\/ Run -> Done/.test(t.methodCode) && t.methodCode.includes('TEST_FINISHED();') && t.methodCode.includes('AssertEquals_DINT('), 'each step, the assert, TEST_FINISHED');
const ids = [...t.xml.matchAll(/Id="\{([0-9a-f-]+)\}"/g)].map((m) => m[1]);
expect(ids.length === 2 && ids[0] !== ids[1] && ids.every((g) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(g)), `two new GUIDs, valid v4 (${ids.join(' ')})`);
expect(t.xml.startsWith('<?xml version="1.0" encoding="utf-8"?>') && t.xml.includes('<Method Name="RecordedRun_202610120830"') && t.xml.includes('<![CDATA[RecordedRun_202610120830();]]>'), 'the .TcPOU: the body calls the test method');

// ---- Online change risks ----
const pou = (decl: string) => `<?xml version="1.0" encoding="utf-8"?><TcPlcObject><POU Name="FB_A" Id="{1}"><Declaration><![CDATA[${decl}]]></Declaration></POU></TcPlcObject>`;
const was = pou('FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nVAR RETAIN\n\tnTotal : UDINT;\n\tfOld : REAL;\nEND_VAR\n');
const now = pou('FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\n\tm : INT;\nEND_VAR\nVAR RETAIN\n\tnTotal : ULINT;\nEND_VAR\nVAR PERSISTENT\n\tbKept : BOOL;\nEND_VAR\n');
const r = onlineChangeRisks(
  [{ path: 'POUs/FB_A.TcPOU', content: now }, { path: 'POUs/FB_New.TcPOU', content: pou('FUNCTION_BLOCK FB_New').replace('FB_A', 'FB_New') }, { path: 'POUs/FB_Same.TcPOU', content: was }],
  (p) => (p === 'POUs/FB_A.TcPOU' || p === 'POUs/FB_Same.TcPOU' ? was : null)
);
expect(r.interfaces.join() === 'FB_A', `a changed declaration said; the same one not (${r.interfaces.join()})`);
expect(r.added.join() === 'FB_New', 'a POU not on the PLC: added');
const rr = r.retain.map((x) => `${x.name}: ${x.change}`).sort().join('; ');
expect(rr === 'bKept: PERSISTENT added; fOld: no longer RETAIN; nTotal: UDINT → ULINT', `RETAIN / PERSISTENT: added, removed, another type (${rr})`);
expect(retainVars('VAR RETAIN // comment\n\ta, b : INT := 5;\n\tc AT %MW0 : WORD;\nEND_VAR').size === 3, 'RETAIN lists: several names, AT, initial values');
expect(onlineChangeRisks([{ path: 'x.TcPOU', content: pou('FUNCTION_BLOCK FB_A // note\nVAR\n\tn : INT; (* x *)\nEND_VAR') }], () => pou('FUNCTION_BLOCK FB_A\nVAR\n  n : INT;\nEND_VAR')).interfaces.length === 0, 'comments and spaces are not a change');

// ---- The timeline's bars ----
const segs = laneSegments({ label: 'here', transitions: [{ t: 2000, from: 'Idle', to: 'Run', dwellMs: 1000 }, { t: 5000, from: 'Run', to: 'Done', dwellMs: 3000 }], current: { state: 'Done', since: 5000 } }, 6000);
expect(segs.map((s) => `${s.state}:${s.from}-${s.to}`).join(' ') === 'Idle:1000-2000 Run:2000-5000 Done:5000-6000', `each stay then the current one (${segs.map((s) => `${s.state}:${s.from}-${s.to}`).join(' ')})`);

// ---- The event log's CSV ----
const csv = eventsCsv([{ t: Date.UTC(2026, 0, 1), kind: 'write', text: 'a := 1; b\nc' }]);
expect(csv === 'time;kind;event\n2026-01-01T00:00:00.000Z;write;a := 1 b c', `the events as CSV (${JSON.stringify(csv)})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

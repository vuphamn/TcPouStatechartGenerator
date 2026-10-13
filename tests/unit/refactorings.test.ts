// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// More refactorings (src/utils/ifToCase.ts, refactorings.ts): Convert to IF (a CASE as an IF / ELSIF chain: label
// lists, ranges, ELSE, code on a label's line, nested blocks), Inline Method (a call replaced by the code of a method
// that takes, keeps and returns nothing; why not otherwise), state names for numbers
import { caseToIf, ifToCase } from '../../src/utils/ifToCase.ts';
import { callOnLine, inlineMethod, numbersToEnum } from '../../src/utils/refactorings.ts';
import { getMethodCodeFromPou } from '../../src/utils/pouStateEditor.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// ---- Convert to IF ----
const src = [
  'CASE eState OF',
  '\tE_State.Idle:',
  '\t\tbReady := TRUE;',
  '\tE_State.Run, E_State.Jog:',
  '\t\tCASE nSub OF',
  '\t\t\t1: x := 1;',
  '\t\tEND_CASE',
  '\t\tIF bStop THEN',
  '\t\t\teState := E_State.Idle;',
  '\t\tELSE',
  '\t\t\t;',
  '\t\tEND_IF',
  '\t10..20: n := 0;',
  'ELSE',
  '\tbReady := FALSE;',
  'END_CASE',
  'y := 2;',
].join('\n');
const r = caseToIf(src, 0);
const want = [
  'IF eState = E_State.Idle THEN',
  '\tbReady := TRUE;',
  'ELSIF eState = E_State.Run OR eState = E_State.Jog THEN',
  '\tCASE nSub OF',
  '\t\t1: x := 1;',
  '\tEND_CASE',
  '\tIF bStop THEN',
  '\t\teState := E_State.Idle;',
  '\tELSE',
  '\t\t;',
  '\tEND_IF',
  'ELSIF (eState >= 10 AND eState <= 20) THEN',
  '\tn := 0;',
  'ELSE',
  '\tbReady := FALSE;',
  'END_IF',
  'y := 2;',
].join('\n');
expect(!('error' in r) && r.code === want, `Convert to IF: lists, a nested CASE and IF/ELSE kept, a range, code on a label's line, ELSE${'error' in r ? ` (${r.error})` : r.code === want ? '' : `\n${r.code}`}`);
// (and back: the same variable's arms as a CASE again)
const orig = 'CASE n OF\n\t1:\n\t\ta();\n\t2, 3:\n\t\tb();\nELSE\n\tc();\nEND_CASE';
const asIf = caseToIf(orig, 0);
const back = 'error' in asIf ? asIf : ifToCase(asIf.code, 0);
expect(!('error' in back) && back.code === orig, `a CASE to IF and back: the same (${'error' in back ? back.error : JSON.stringify(back.code)})`);
const simple = caseToIf('  CASE n OF\r\n    1:\r\n      a();\r\n  END_CASE', 0);
expect(!('error' in simple) && simple.code === '  IF n = 1 THEN\r\n    a();\r\n  END_IF', `one arm, CRLF, space indents (${'error' in simple ? simple.error : JSON.stringify(simple.code)})`);
expect('error' in caseToIf('x := 1;', 0) && 'error' in caseToIf('CASE n OF\nEND_CASE', 0), 'not a CASE, or no labels: not converted');

// ---- Inline Method ----
const method = (name: string, decl: string, code: string) => `<Method Name="${name}" Id="{00000000-0000-4000-8000-00000000000${name.length}}"><Declaration><![CDATA[${decl}]]></Declaration><Implementation><ST><![CDATA[${code}]]></ST></Implementation></Method>`;
const pou = `<?xml version="1.0" encoding="utf-8"?><TcPlcObject Version="1.1.0.1"><POU Name="FB_A" Id="{00000000-0000-4000-8000-000000000001}" SpecialFunc="None"><Declaration><![CDATA[FUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR]]></Declaration><Implementation><ST><![CDATA[]]></ST></Implementation>${method('doState', 'METHOD doState\nVAR_INPUT\nEND_VAR', 'IF n > 0 THEN\n\tresetAll();\nEND_IF\nTHIS^.resetAll(); // again\nwithLocal();')}${method('resetAll', 'METHOD PRIVATE resetAll\nVAR_INPUT\nEND_VAR', '// all off\nn := 0;\nIF n = 0 THEN\n\tn := 1;\nEND_IF')}${method('withLocal', 'METHOD withLocal\nVAR\n\ti : INT;\nEND_VAR', 'i := 1;')}${method('isOn', 'METHOD isOn : BOOL', 'isOn := TRUE;')}</POU></TcPlcObject>`;
const inl = inlineMethod(pou, 'doState', 2);
const after = 'error' in inl ? '' : getMethodCodeFromPou(inl.pou, 'doState').code;
expect(!('error' in inl) && after.startsWith('IF n > 0 THEN\n\t// all off\n\tn := 0;\n\tIF n = 0 THEN\n\t\tn := 1;\n\tEND_IF\nEND_IF\n') && inl.calls === 1, `Inline: the call's line replaced by the code, at its indentation; 1 call left (${'error' in inl ? inl.error : JSON.stringify(after.slice(0, 120))})`);
expect(callOnLine('THIS^.resetAll(); // again') === 'resetAll' && callOnLine('x := f();') === null && callOnLine('fb(IN := TRUE);') === null, 'a call on its own line (THIS^. too); not an assignment, not with parameters');
const why = (line: number) => { const x = inlineMethod(pou, 'doState', line); return 'error' in x ? x.error : ''; };
expect(/variables of its own/.test(why(5)), `a method with locals: not inlined (${why(5)})`);
expect(/no call/.test(why(1)), 'not a call line');
const withResult = inlineMethod(pou.replace('withLocal();', 'isOn();'), 'doState', 5);
expect('error' in withResult && /returns a value/.test(withResult.error), `a method with a result: not inlined (${'error' in withResult ? withResult.error : 'inlined'})`);

// ---- State names for numbers ----
const names = new Map([[0, 'IDLE'], [10, 'RUN'], [20, 'DONE']]);
const code = ['CASE machineState OF', '\t0:', '\t\tIF bGo THEN machineState := 10; END_IF', '\t10, 20:', '\t\tCASE nSub OF', '\t\t\t10: n := 10;', '\t\tEND_CASE', '\t\tbDone := machineState = 20;', 'END_CASE', 'IF machineState <> 0 THEN ; END_IF', 'n := 10;', 'machineState := 99;'].join('\n');
const ne = numbersToEnum(code, 'machineState', 'E_Machine', names);
const lines = ne.code.split('\n');
expect(lines[1] === '\tE_Machine.IDLE:' && lines[3] === '\tE_Machine.RUN, E_Machine.DONE:' && lines[2] === '\t\tIF bGo THEN machineState := E_Machine.RUN; END_IF', `labels and assignments named (${JSON.stringify(lines.slice(1, 4))})`);
expect(lines[5] === '\t\t\t10: n := 10;' && lines[7] === '\t\tbDone := machineState = E_Machine.DONE;' && lines[9] === 'IF machineState <> E_Machine.IDLE THEN ; END_IF' && lines[10] === 'n := 10;' && lines[11] === 'machineState := 99;', `another CASE's labels, other variables and unknown numbers kept (${JSON.stringify(lines.slice(5, 12))})`);
expect(ne.count === 6, `6 numbers named (${ne.count})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

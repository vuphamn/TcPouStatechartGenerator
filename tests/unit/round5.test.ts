// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Several states copied at once (the transitions between them going to the copies), the line diff of Edit the
// state's code, Extract Method with a RETURN, Extract Property (and its type guessed), the new fixes attached
import { copyName, copyStates } from '../../src/utils/stateCopyDelete.ts';
import { lineDiff } from '../../src/utils/lineDiff.ts';
import { checkExtract, checkExtractProperty, extractMethod, extractProperty, guessExpressionType, planExtract } from '../../src/utils/extractMethod.ts';
import { getMethodCodeFromPou } from '../../src/utils/pouStateEditor.ts';
import { lintVariables } from '../../src/utils/variableLint.ts';
import { lintStateMachine } from '../../src/utils/stateMachineLint.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s: string) => `<![CDATA[${s}]]>`;

const DO_STATE = [
  'CASE machineState OF',
  '\tS_A:',
  '\t\tIF bGo THEN',
  '\t\t\tmachineState := E_S.S_B;',
  '\t\tEND_IF',
  '\tS_B:',
  '\t\tIF bBack THEN',
  '\t\t\tmachineState := E_S.S_A;',
  '\t\tELSIF bOut THEN',
  '\t\t\tmachineState := E_S.S_C;',
  '\t\tEND_IF',
  '\tS_C:',
  '\t\tnCount := nCount + 1;',
  '\t\tIF bStop THEN',
  '\t\t\tRETURN;',
  '\t\tEND_IF',
  '\t\tfSum := fSum + fStep;',
  'END_CASE',
].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR', '\tmachineState : E_S;', '\tbGo : BOOL;', '\tbBack : BOOL;', '\tbOut : BOOL;', '\tbStop : BOOL;', '\tnCount : INT;', '\tfSum : LREAL;', '\tfStep : LREAL;', 'END_VAR'].join('\n');
const method = (name: string, decl: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n${method('unusedOne', 'METHOD PRIVATE unusedOne', 'nCount := 0;')}\n  </POU>\n</TcPlcObject>`;
const DUT = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <DUT Name="E_S" Id="{2}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_S :\n(\n\tS_A := 0,\n\tS_B,\n\tS_C\n);\nEND_TYPE")}</Declaration>\n  </DUT>\n</TcPlcObject>`;
const doState = (pou: string) => getMethodCodeFromPou(pou, 'doState').code ?? '';

// 1. S_A and S_B copied together: S_A_COPY goes to S_B_COPY, S_B_COPY back to S_A_COPY; S_C stays S_C
{
  const names: string[] = [];
  for (const s of ['S_A', 'S_B']) names.push(copyName(POU, DUT, s, names));
  const r = copyStates(POU, DUT, ['S_A', 'S_B'], names, 'machineState');
  if ('error' in r) expect(false, `copyStates: ${r.error}`);
  else {
    const code = doState(r.pou);
    const branch = (s: string) => code.split(`\t${s}:`)[1]?.split(/\n\t[A-Z_]+:/)[0] ?? '';
    expect(names.join() === 'S_A_COPY,S_B_COPY', `the names: ${names.join(', ')}`);
    expect(/machineState := E_S\.S_B_COPY;/.test(branch('E_S.S_A_COPY') || branch('S_A_COPY')), 'S_A_COPY → S_B_COPY (the copied group)');
    const b = branch('E_S.S_B_COPY') || branch('S_B_COPY');
    expect(/machineState := E_S\.S_A_COPY;/.test(b) && /machineState := E_S\.S_C;/.test(b), 'S_B_COPY → S_A_COPY, and still → S_C (not copied)');
    expect(/machineState := E_S\.S_B;/.test(branch('S_A')), 'the originals unchanged (S_A → S_B)');
    expect(!!r.dut && /S_A_COPY/.test(r.dut) && /S_B_COPY/.test(r.dut), 'both in the enum');
  }
}

// 2. The line diff: only the changed lines (and one line around them)
{
  const d = lineDiff(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'C', 'd', 'e', 'f', 'g']);
  expect(d.added === 2 && d.removed === 1 && d.rows.join('|') === '  b|- c|+ C|  d|…|  f|+ g', `lineDiff: ${d.rows.join(' | ')}`);
  expect(lineDiff(['x'], ['x']).rows.length === 0, 'no change: no rows');
}

// 3. Extract Method with a RETURN (S_C's lines 13-16): the new method returns TRUE when it RETURNed
{
  expect(checkExtract(POU, 'doState', 13, 16, 'CountAndStop') === null, 'lines with a RETURN can be extracted');
  const p = planExtract(POU, 'doState', 13, 16, 'CountAndStop');
  expect(p.returns && /^METHOD PRIVATE CountAndStop : BOOL$/.test(p.declaration.split('\n')[0]) && p.body.some((l) => /CountAndStop := TRUE; RETURN;/.test(l)), `its declaration and body: ${p.declaration.split('\n')[0]} / ${p.body.find((l) => /RETURN/.test(l))?.trim()}`);
  const r = extractMethod(POU, 'doState', 13, 16, 'CountAndStop');
  if ('error' in r) expect(false, r.error);
  else expect(/\t\tIF CountAndStop\(\) THEN\n\t\t\tRETURN;\n\t\tEND_IF\n\t\tfSum := fSum \+ fStep;/.test(doState(r.pou)), 'the call RETURNs after it');
  const setsResult = POU.replace('\t\t\tRETURN;', '\t\t\tdoState := TRUE;\n\t\t\tRETURN;');
  expect(!!checkExtract(setsResult, 'doState', 13, 17, 'X'), 'lines that set the method\'s result and RETURN: refused');
}

// 4. Extract Property: an expression of one line
{
  const line = 17; // fSum := fSum + fStep;
  const text = doState(POU).split('\n')[line - 1];
  const from = text.indexOf('fSum + fStep');
  const to = from + 'fSum + fStep'.length;
  expect(guessExpressionType(POU, 'doState', 'fSum + fStep') === 'LREAL' && guessExpressionType(POU, 'doState', 'bGo AND NOT bStop') === 'BOOL' && guessExpressionType(POU, 'doState', 'nCount') === 'INT', 'the type guessed: LREAL, BOOL, INT');
  expect(!!checkExtractProperty(POU, 'doState', line, text.indexOf('fSum'), to + 1, 'fNext', 'LREAL'), 'with the ; : refused (an expression only)');
  const r = extractProperty(POU, 'doState', line, from, to, 'fNext', 'LREAL');
  if ('error' in r) expect(false, r.error);
  else {
    expect(doState(r.pou).split('\n')[line - 1] === '\t\tfSum := fNext;', `the line: ${doState(r.pou).split('\n')[line - 1]}`);
    expect(/<Property Name="fNext" Id="\{[0-9a-f-]{36}\}">[\s\S]*PROPERTY PRIVATE fNext : LREAL[\s\S]*<Get Name="Get"[\s\S]*fNext := fSum \+ fStep;[\s\S]*<\/Property>\s*<\/POU>/.test(r.pou), 'the property: declaration and Get, before </POU>');
  }
}

// 5. The fixes: an ELSE for the CASE, the PRIVATE method nobody calls removed, S_C (nothing leads to it? it does) ...
{
  const v = lintVariables(POU, null, false, ['S_A', 'S_B', 'S_C']);
  const unused = v.find((f) => f.rule === 'unused-method');
  expect(unused?.fix?.kind === 'remove-method' && unused.fix.name === 'unusedOne', `unusedOne(): ${unused?.fix?.kind}`);
  const l = lintStateMachine(POU, DUT);
  const noElse = l.find((f) => f.rule === 'no-else');
  expect(noElse?.fix?.kind === 'add-else' && noElse.fix.line === 18, `no ELSE: ${noElse?.fix?.kind} at line ${noElse?.fix && 'line' in noElse.fix ? noElse.fix.line : '?'}`);
  const lone = POU.replace('\tS_C:', '\tS_D:\n\t\t;\n\tS_C:');
  const l2 = lintStateMachine(lone, DUT.replace('\tS_C\n', '\tS_C,\n\tS_D,\n\tS_E\n'));
  const unreachable = l2.find((f) => f.rule === 'unreachable' && f.stateId === 'S_D');
  const unusedEnum = l2.find((f) => f.rule === 'unused-enum' && f.stateId === 'S_E');
  expect(unreachable?.fix?.kind === 'delete-state' && unusedEnum?.fix?.kind === 'remove-enum-member', `S_D: ${unreachable?.fix?.kind}; S_E: ${unusedEnum?.fix?.kind}`);
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// This round's refactors and fixes, on a small POU: Extract Method, a method renamed (its uses too), the "FB never
// called" and "never runs" fixes' plans, a state's whole code read and written back, the entry / exit blocks
// written without spaces (IF(bFirstPass)THEN), snippets to / from a file
import { extractMethod, checkExtract } from '../../src/utils/extractMethod.ts';
import { checkMethodRename, renameMethod } from '../../src/utils/renameVariable.ts';
import { deadLines, plannedCall } from '../../src/utils/variableLint.ts';
import { readStateActions, readStateCode, writeStateCode } from '../../src/utils/stateActions.ts';
import { getMethodCodeFromPou } from '../../src/utils/pouStateEditor.ts';
import { mergeSnippets, snippetsFromFile, snippetsToFile } from '../../src/utils/stSnippets.ts';
import { undeclaredNames } from '../../src/utils/pouVariables.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s: string) => `<![CDATA[${s}]]>`;

const DO_STATE = [
  'CASE machineState OF',
  '\tS_IDLE:',
  '\t\t\t// (a comment indented deeper than the code)',
  '\t\tIF(bFirstPass)THEN',
  '\t\t\tnCount := 0;',
  '\t\tEND_IF',
  '\t\tnCount := nCount + 1;',
  '\t\tfTotal := fTotal + fStep;',
  '\t\tIF bGo THEN',
  '\t\t\tmachineState := E_S.S_RUN;',
  '\t\tEND_IF',
  '\t\tIF(machineState <> E_S.S_IDLE)THEN',
  '\t\t\tbLeft := TRUE;',
  '\t\tEND_IF',
  '\tS_RUN:',
  '\t\tfbTimer.Q;',
  '\t\tIF fbTimer.Q THEN',
  '\t\t\tmachineState := E_S.S_IDLE;',
  '\t\tEND_IF',
  'END_CASE',
].join('\n');
const DECL = ['FUNCTION_BLOCK SM_X', 'VAR', '\tmachineState : E_S;', '\tnCount : INT;', '\tfTotal : LREAL;', '\tfStep : LREAL;', '\tbGo : BOOL;', '\tbLeft : BOOL;', '\tbFirstPass : BOOL;', '\tfbTimer : TON;', 'END_VAR'].join('\n');
const method = (name: string, decl: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();\nIF doState() THEN\n\t;\nEND_IF')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO_STATE)}\n${method('helper', 'METHOD helper : BOOL\nVAR_INPUT\nEND_VAR', 'RETURN;\nnCount := 5;\nIF bGo THEN\n\tbLeft := FALSE;\nEND_IF')}\n  </POU>\n</TcPlcObject>`;
const doState = (pou: string) => getMethodCodeFromPou(pou, 'doState').code ?? '';

// 1. Extract Method: lines 7-8 (nCount / fTotal) of doState
{
  expect(checkExtract(POU, 'doState', 9, 11, 'AddUp') === null, 'Extract: a whole IF block can be extracted');
  expect(!!checkExtract(POU, 'doState', 9, 10, 'AddUp'), 'Extract: half an IF block cannot');
  expect(!!checkExtract(POU, 'doState', 7, 8, 'helper'), 'Extract: a name the POU has is refused');
  const r = extractMethod(POU, 'doState', 7, 8, 'AddUp');
  if ('error' in r) expect(false, `Extract: ${r.error}`);
  else {
    const code = doState(r.pou).split('\n');
    const body = getMethodCodeFromPou(r.pou, 'AddUp');
    expect(/^\t\tAddUp\(.*\);$/.test(code[6]) && !code.some((l) => /fTotal := fTotal/.test(l)), `Extract: the lines replaced by the call (${code[6]})`);
    expect(body.methodFound && /fTotal := fTotal \+ fStep;/.test(body.code ?? ''), 'Extract: the new method holds them');
  }
}

// 2. A method renamed: its declaration and its calls
{
  expect(!!checkMethodRename(POU, 'doState', 'helper'), 'Rename method: a name the POU has is refused');
  const r = renameMethod(POU, 'doState', 'runStates');
  if ('error' in r) expect(false, `Rename method: ${r.error}`);
  else {
    expect(/<Method Name="runStates"/.test(r.pou) && !/<Method Name="doState"/.test(r.pou) && r.kind === 'method', 'Rename method: its Name attribute');
    expect(/runStates\(\);\nIF runStates\(\) THEN/.test(r.pou) && r.changes.length >= 2, `Rename method: the calls (${r.changes.length} changes)`);
  }
}

// 3. The fixes' plans: a call for an FB used but never called; the lines after a RETURN
{
  const c = plannedCall(POU, 'fbTimer', 'TON');
  expect(!!c && c.method === 'doState' && /^\t\tfbTimer\(IN := FALSE, PT := T#0S\);$/.test(c.text), `FB never called: ${c?.method} line ${c?.line}: ${c?.text}`);
  const d = deadLines('RETURN;\nnCount := 5;\nIF bGo THEN\n\tbLeft := FALSE;\nEND_IF', 2);
  expect(d.start === 2 && d.end === 5, `never runs: lines ${d.start}-${d.end} (to the end)`);
  const d2 = deadLines('IF a THEN\n\tRETURN;\n\tb := 1;\n\tc := 2;\nEND_IF\nd := 3;', 3);
  expect(d2.start === 3 && d2.end === 4, `never runs, in a block: lines ${d2.start}-${d2.end} (not past its END_IF)`);
}

// 4. A state's whole code, and its actions written without spaces
{
  const c = readStateCode(POU, 'S_IDLE');
  expect(Array.isArray(c) && c[0] === '\t// (a comment indented deeper than the code)' && c[1] === 'IF(bFirstPass)THEN', `the state's code, as written (${Array.isArray(c) ? c.length : c.error})`);
  if (Array.isArray(c)) {
    const same = writeStateCode(POU, 'S_IDLE', c.join('\n'));
    expect(!('error' in same) && same.pou === POU, 'written back unchanged: the same file');
    const w = writeStateCode(POU, 'S_IDLE', [...c, '// more'].join('\n'));
    expect(!('error' in w) && doState(w.pou).includes('\t\tEND_IF\n\t\t// more\n\tS_RUN:'), 'a line added: at the branch\'s indentation');
  }
  const a = readStateActions(POU, 'S_IDLE', 'machineState');
  expect(!('error' in a) && a.entry.join() === 'nCount := 0;' && a.exit.join() === 'bLeft := TRUE;' && a.do.length === 2, `IF(bFirstPass)THEN / IF(machineState <> …)THEN: entry and exit (${'error' in a ? a.error : `${a.entry} | ${a.do.length} | ${a.exit}`})`);
}

// 5. Snippets to a file and back, merged
{
  const file = snippetsToFile([{ key: 'mine', body: 'a := 1;', description: 'my one' }]);
  const back = snippetsFromFile(file);
  expect(Array.isArray(back) && back[0].key === 'mine' && back[0].description === 'my one', 'snippets: to a file and back');
  expect(typeof snippetsFromFile('nope') === 'string' && typeof snippetsFromFile('{"snippets":[{"key":"1x","body":""}]}') === 'string', 'snippets: a wrong file refused');
  const m = mergeSnippets([{ key: 'a', body: '1', description: '' }, { key: 'b', body: '2', description: '' }], [{ key: 'B', body: '3', description: '' }, { key: 'c', body: '4', description: '' }]);
  expect(m.list.map((s) => `${s.key}${s.body}`).join() === 'a1,B3,c4' && m.added === 1 && m.replaced === 1, 'snippets: merged (a key in both: the file\'s)');
}

// 6. Undeclared names: none from // comments on any line
{
  const u = undeclaredNames('a := 1; // some words here\nb := 2; // more words', [{ name: 'a' }, { name: 'b' }] as never);
  expect(u.length === 0, `undeclared: comments skipped (${u.join(', ')})`);
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

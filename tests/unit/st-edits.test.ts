// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's edits (vscode-extension/stEdits.cjs): Auto Declare's type guessed from a name's use and its
// declaration added to a VAR block (or a new one); a declaration removed (alone on its line, or one of "a, b : INT;");
// Format Document's indentation (IF / CASE labels / FOR / REPEAT / VAR / STRUCT / an enum, a call over several lines
// moved with its first line, a comment over several lines kept), and XAE's own code (the samples) left as it is
import { SAMPLES } from '../../src/samples/samplesData.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { guessType, addDeclaration, removeDeclaration, formatSection } = require('../../vscode-extension/stEdits.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSource } = require('../../vscode-extension/tcStSource.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The type from the use
const impl = "bDone := TRUE;\nfSpeed := 1.5;\nnCount := nCount + 1;\nnLimit := 10;\ntWait := T#2S;\nsName := 'x';\neMode := E_Mode.Auto;\nIF bFlag THEN\nEND_IF\ntonDelay(IN := TRUE, PT := T#1S);\nIF rtStart.Q THEN\nEND_IF\nfbEdge(CLK := bIn);\n";
const types = Object.fromEntries(['bDone', 'fSpeed', 'nLimit', 'tWait', 'sName', 'eMode', 'bFlag', 'tonDelay', 'fbEdge'].map((n) => [n, guessType(impl, n)]));
expect(JSON.stringify(types) === JSON.stringify({ bDone: 'BOOL', fSpeed: 'LREAL', nLimit: 'INT', tWait: 'TIME', sName: 'STRING', eMode: 'E_Mode', bFlag: 'BOOL', tonDelay: 'TON', fbEdge: 'R_TRIG' }), `types guessed (${JSON.stringify(types)})`);

// Declared: in the VAR block (its indentation), a new block, VAR_INPUT
const decl = 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\nVAR\n\tnStep : INT;\nEND_VAR\n';
const a1 = addDeclaration(decl, { name: 'bDone', type: 'BOOL' });
expect(a1.text === 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\nVAR\n\tnStep : INT;\n\tbDone : BOOL;\nEND_VAR\n' && a1.line === 6, `into VAR, before its END_VAR (${JSON.stringify(a1)})`);
const a2 = addDeclaration(decl, { name: 'tWait', type: 'TIME', block: 'VAR_TEMP' });
expect(a2.text === 'METHOD Move : BOOL\nVAR_INPUT\n\tfPos : LREAL;\nEND_VAR\nVAR\n\tnStep : INT;\nEND_VAR\nVAR_TEMP\n\ttWait : TIME;\nEND_VAR\n' && a2.line === 8, `no VAR_TEMP: a new block after the last END_VAR (${JSON.stringify(a2.text)})`);
const a3 = addDeclaration('METHOD Reset\n', { name: 'bOk', type: 'BOOL' });
expect(a3.text === 'METHOD Reset\nVAR\n\tbOk : BOOL;\nEND_VAR\n', `no VAR block at all: one at the end (${JSON.stringify(a3.text)})`);
const crlf = addDeclaration('FUNCTION_BLOCK FB_A\r\nVAR\r\n    x : INT;\r\nEND_VAR\r\n', { name: 'y', type: 'INT' });
expect(crlf.text === 'FUNCTION_BLOCK FB_A\r\nVAR\r\n    x : INT;\r\n    y : INT;\r\nEND_VAR\r\n', `line ends and indentation kept (${JSON.stringify(crlf.text)})`);
expect(!/CONSTANT[\s\S]*bNew/.test(addDeclaration('VAR CONSTANT\n\tc : INT := 1;\nEND_VAR\n', { name: 'bNew', type: 'BOOL' }).text.split('END_VAR')[0]), 'not into VAR CONSTANT');

// Removed: alone on its line; one of several
expect(removeDeclaration('VAR\n\tnStep : INT; // the step\n\tbOk : BOOL;\nEND_VAR\n', 'nStep') === 'VAR\n\tbOk : BOOL;\nEND_VAR\n', 'a declaration alone on its line: the line removed');
expect(removeDeclaration('VAR\n\ta, b, c : INT;\nEND_VAR\n', 'b') === 'VAR\n\ta, c : INT;\nEND_VAR\n', 'one of several: its name taken out');
expect(removeDeclaration('VAR\n\tab : INT;\nEND_VAR\n', 'a') === null, 'not declared: null');

// Formatted
const messy = [
  'CASE State OF',
  'E_S.Idle:',
  'IF bGo THEN',
  'State := E_S.Run;',
  'ELSIF bStop THEN',
  'x := 0;',
  'ELSE',
  'y := 1;',
  'END_IF',
  '  E_S.Run:   // running',
  '        MoveAndAdvance(ProgramNumber := 1,',
  '                       StartX := 0.0);',
  '(* a comment',
  '      kept as it is *)',
  'FOR i := 1 TO 10 DO',
  'REPEAT',
  'i := i + 1;',
  'UNTIL i > 5',
  'END_REPEAT',
  'END_FOR',
  'ELSE',
  'State := E_S.Idle;',
  'END_CASE',
  '',
].join('\n');
const want = [
  'CASE State OF',
  '\tE_S.Idle:',
  '\t\tIF bGo THEN',
  '\t\t\tState := E_S.Run;',
  '\t\tELSIF bStop THEN',
  '\t\t\tx := 0;',
  '\t\tELSE',
  '\t\t\ty := 1;',
  '\t\tEND_IF',
  '\tE_S.Run:   // running',
  '\t\tMoveAndAdvance(ProgramNumber := 1,',
  '\t\t               StartX := 0.0);',
  '\t\t(* a comment',
  '      kept as it is *)',
  '\t\tFOR i := 1 TO 10 DO',
  '\t\t\tREPEAT',
  '\t\t\t\ti := i + 1;',
  '\t\t\tUNTIL i > 5',
  '\t\t\tEND_REPEAT',
  '\t\tEND_FOR',
  'ELSE',
  '\tState := E_S.Idle;',
  'END_CASE',
  '',
].join('\n');
const got = formatSection(messy);
const diff = got.split('\n').map((l: string, k: number) => (l === want.split('\n')[k] ? null : `${k + 1}: ${JSON.stringify(l)} ≠ ${JSON.stringify(want.split('\n')[k])}`)).filter(Boolean);
expect(diff.length === 0, `formatted: CASE labels, IF / ELSIF / ELSE, the CASE's ELSE at its level, a call over two lines, a comment, FOR / REPEAT (${diff.slice(0, 4).join(' | ') || 'as wanted'})`);
expect(formatSection(got) === got, 'formatting twice: the same');
const declFmt = formatSection('FUNCTION_BLOCK FB_A\nVAR_INPUT\nbGo : BOOL;\n  END_VAR\nVAR\nfbT : TON;\nEND_VAR\n');
expect(declFmt === 'FUNCTION_BLOCK FB_A\nVAR_INPUT\n\tbGo : BOOL;\nEND_VAR\nVAR\n\tfbT : TON;\nEND_VAR\n', `a declaration: VAR blocks (${JSON.stringify(declFmt)})`);
const dutFmt = formatSection('TYPE E_A :\n(\nIdle := 0,\nBusy\n);\nEND_TYPE\nTYPE ST_A :\nSTRUCT\nfX : LREAL;\nEND_STRUCT\nEND_TYPE\n');
expect(dutFmt === 'TYPE E_A :\n(\n\tIdle := 0,\n\tBusy\n);\nEND_TYPE\nTYPE ST_A :\nSTRUCT\n\tfX : LREAL;\nEND_STRUCT\nEND_TYPE\n', `a DUT: an enum's members, a struct's fields (${JSON.stringify(dutFmt)})`);
const ifCond = formatSection('IF a AND\n   b THEN\nx := 1;\nEND_IF\n');
expect(ifCond === 'IF a AND\n   b THEN\n\tx := 1;\nEND_IF\n', `an IF over two lines: its body indented (${JSON.stringify(ifCond)})`);
expect(formatSection('x := 1;\r\nIF a THEN\r\ny := 2;\r\nEND_IF\r\n') === 'x := 1;\r\nIF a THEN\r\n\ty := 2;\r\nEND_IF\r\n', 'CRLF kept');

// XAE's own code (the samples): only leading white space changes, formatting twice gives the same, and most lines
// stay as they are (their authors' own extra indents are what changes)
let lines = 0;
let changed = 0;
let content = 0;
let twice = 0;
const examples: string[] = [];
for (const s of SAMPLES) {
  for (const m of parseSource(s.pouContent).members) {
    for (const sec of [m.decl, m.impl]) {
      if (!sec?.text) continue;
      const a = sec.text.split(/\r?\n/);
      const once = formatSection(sec.text);
      const b = once.split(/\r?\n/);
      if (formatSection(once) !== once) twice++;
      lines += a.length;
      a.forEach((l: string, k: number) => {
        if (l.trim() !== (b[k] ?? '').trim()) content++;
        if (l !== b[k] && l.trim()) {
          changed++;
          if (examples.length < 3) examples.push(`${m.key || 'body'}: ${JSON.stringify(l)} → ${JSON.stringify(b[k])}`);
        }
      });
    }
  }
}
expect(lines > 1000 && content === 0 && twice === 0 && changed / lines < 0.1, `the samples: ${lines} lines, ${changed} re-indented, ${content} with other changes, ${twice} sections not stable (${examples.join(' | ')})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

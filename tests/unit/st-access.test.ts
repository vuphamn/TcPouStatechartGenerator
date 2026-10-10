// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Reads and writes as XAE's Cross Reference List tells them (vscode-extension/stReferences.cjs accessOf /
// occurrencesIn): x := (a member or an index after it too), x R= / S=, an output bound to it (Q => x): writes; x(…):
// a call; a declaration; else reads (a comparison, a condition, an argument); comments and strings are no places;
// by name, as Find All References: stPos.bDone := writes a bDone too
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { blankCode, declarationsIn, occurrencesIn } = require('../../vscode-extension/stReferences.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const impl = [
  'bDone := TRUE;',
  'IF bDone THEN',
  '\tx := bDone AND y;',
  'END_IF',
  'bDone R= bStop;',
  'tonWait(IN := bDone, Q => bDone);',
  'stPos.bDone := FALSE; // bDone := in a comment',
  "sText := 'bDone := no';",
  'aFlags[2] := bDone = FALSE;',
  'bDone();',
].join('\n');
const code = blankCode(impl);
const places = occurrencesIn(code, declarationsIn(code), 'bDone') as { offset: number; access: string }[];
const lineOf = (o: number) => impl.slice(0, o).split('\n').length;
const got = places.map((p) => `${lineOf(p.offset)}:${p.access}`).join(' ');
expect(got === '1:write 2:read 3:read 5:write 6:read 6:write 7:write 9:read 10:call', `the places and their access (${got})`);

const decl = 'VAR\n\tbDone : BOOL := FALSE;\n\tbCopy : BOOL := bDone;\nEND_VAR\n';
const dcode = blankCode(decl);
const dp = (occurrencesIn(dcode, declarationsIn(dcode), 'bDone') as { access: string }[]).map((p) => p.access).join(' ');
expect(dp === 'declaration read', `in a declaration: its own, an initial value reads it (${dp})`);

const member = occurrencesIn(blankCode('stPos.fX := 1.0;\nstPos[1].fY := 2;\nfZ := stPos.fX;'), [], 'stPos') as { access: string }[];
expect(member.map((p) => p.access).join(' ') === 'write write read', `a member or an index written: a write of the whole (${member.map((p) => p.access).join(' ')})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

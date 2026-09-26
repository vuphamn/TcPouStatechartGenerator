// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// getPouBody / updatePouBody on every sample and on synthetic POUs (CRLF, empty body, SFC body, no body)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { getPouBody, updatePouBody } from '../../src/utils/pouBody.ts';
import { getMethodCodeFromPou, getAllMethodsFromPou } from '../../src/utils/pouStateEditor.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

for (const s of SAMPLES as any[]) {
  const b = getPouBody(s.pouContent);
  const name = s.pouName.replace(/\.TcPOU$/i, '');
  expect(b.found && b.name === name && /^(FUNCTION_BLOCK|PROGRAM)$/.test(b.kind) && /VAR/.test(b.declaration) && !/METHOD\b/.test(b.declaration), `${s.title}: ${b.kind} ${b.name}${b.extendsName ? ' EXTENDS ' + b.extendsName : ''}, ${b.declaration.split('\n').length} decl lines, ${b.implementation.split('\n').length} body lines, ${b.methodCount} methods`);
  // Round trip: unchanged text gives the same file
  const same = updatePouBody(s.pouContent, b.declaration, b.implementation);
  expect(same.success && same.updatedPou === s.pouContent, `${s.title}: saving unchanged code leaves the file as it is`);
  // An edit changes only the POU's own parts
  const methods = getAllMethodsFromPou(s.pouContent);
  const before = methods.map((m) => getMethodCodeFromPou(s.pouContent, m));
  const edited = updatePouBody(s.pouContent, b.declaration + '\n// decl edit', b.implementation + '\n// body edit');
  const b2 = getPouBody(edited.updatedPou);
  const after = methods.map((m) => getMethodCodeFromPou(edited.updatedPou, m));
  expect(edited.success && b2.declaration.endsWith('// decl edit') && b2.implementation.endsWith('// body edit'), `${s.title}: edit read back`);
  expect(before.every((m, i) => m.code === after[i].code && m.declaration === after[i].declaration), `${s.title}: all ${methods.length} methods unchanged`);
}

const pou = (inner: string) => `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <POU Name="FB_X" Id="{1}" SpecialFunc="None">\r\n${inner}\r\n    <Method Name="m1" Id="{2}">\r\n      <Declaration><![CDATA[METHOD m1\r\nVAR_INPUT\r\nEND_VAR]]></Declaration>\r\n      <Implementation>\r\n        <ST><![CDATA[x := 1;]]></ST>\r\n      </Implementation>\r\n    </Method>\r\n  </POU>\r\n</TcPlcObject>`;
const crlf = pou(`    <Declaration><![CDATA[FUNCTION_BLOCK FB_X EXTENDS FB_Base IMPLEMENTS I_X\r\nVAR_INPUT\r\n\tbIn : BOOL;\r\nEND_VAR\r\nVAR_OUTPUT\r\n\tbOut : BOOL;\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[bOut := bIn;\r\nm1();]]></ST>\r\n    </Implementation>`);
let b = getPouBody(crlf);
expect(b.kind === 'FUNCTION_BLOCK' && b.extendsName === 'FB_Base' && b.methodCount === 1 && b.implementation.includes('m1();'), `synthetic: FUNCTION_BLOCK FB_X EXTENDS ${b.extendsName}, body "${b.implementation.replace(/\r?\n/g, ' | ')}"`);
const empty = pou(`    <Declaration><![CDATA[PROGRAM FB_X\r\nVAR\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[]]></ST>\r\n    </Implementation>`);
b = getPouBody(empty);
expect(b.kind === 'PROGRAM' && b.implementation === '' && b.isStructuredText, 'an empty ST body');
const sfc = pou(`    <Declaration><![CDATA[FUNCTION_BLOCK FB_X\r\nVAR\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <SFC><Step Name="Init"/></SFC>\r\n    </Implementation>`);
b = getPouBody(sfc);
expect(!b.isStructuredText && b.language === 'SFC', `an SFC body: ${b.language}`);
let u = updatePouBody(sfc, 'FUNCTION_BLOCK FB_X\r\nVAR\r\n\tn : INT;\r\nEND_VAR', null);
expect(u.success && getPouBody(u.updatedPou).declaration.includes('n : INT') && u.updatedPou.includes('<SFC><Step Name="Init"/></SFC>'), 'SFC body: the declaration is saved, the body stays');
expect(!updatePouBody(sfc, 'x', 'y := 1;').success, 'SFC body: saving ST into it is refused');
const noBody = pou(`    <Declaration><![CDATA[FUNCTION_BLOCK FB_X\r\nVAR\r\nEND_VAR]]></Declaration>`);
u = updatePouBody(noBody, getPouBody(noBody).declaration, 'a := 2;');
expect(u.success && getPouBody(u.updatedPou).implementation === 'a := 2;' && getMethodCodeFromPou(u.updatedPou, 'm1').code === 'x := 1;', 'no body yet: one is added after the declaration, the method stays');
expect(!updatePouBody(crlf, 'a ]]> b', '').success, '"]]>" is refused');
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;

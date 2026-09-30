// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Composites come only from the enum's {region} markers: a POU without them draws none; the composites the chart
// used to find on its own (the state names: after *_ENABLING; TwinCAT's UML chart, nested) written as markers draw
// them again. Edges: into a composite's initial state at its border, out of its @final states from its border, all
// others at its inner states; preProcess(): a range check is a composite's only when it spans exactly its states
const fs = require('fs');
const path = require('path');
import { generateStatechartModel } from '../../src/generator.ts';
import { writeCompositeMarkers, enumComposites, setEnumMark } from '../../src/utils/statechartEdits.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
// (the fixtures: the original files, without markers; the bundle runs from tests/.output/unit)
const F = path.join(process.cwd(), 'tests', 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(F, f), 'utf8');

for (const [pouF, dutF, name, parts] of [
  ['sample0/SM_TableManager.TcPOU', 'sample0/E_TableManager_States.TcDUT', 'TableManager', ['TableManagerEnabled']],
  ['sample1/SM_DoorDasher.TcPOU', 'sample1/E_DoorDasher_States.TcDUT', 'DoorDasher', ['Enabled', 'DoordashSeq', 'CrossTransfer', 'InlineTransfer']],
] as const) {
  const pou = read(pouF);
  const dut = read(dutF);
  const before = generateStatechartModel(dut, pou, { flowchartOutput: true });
  expect(Object.keys(before.composites).length === 0, `${name} without markers: no composites (${Object.keys(before.composites).join(', ') || 'none'})`);
  const w = writeCompositeMarkers(dut, pou);
  expect(parts.every((p) => w.written.includes(p)) && w.errors.length === 0, `${name}: written as markers: ${w.written.join(', ')}${w.errors.length ? ` (${w.errors.join('; ')})` : ''}`);
  const after = generateStatechartModel(w.dut, pou, { flowchartOutput: true });
  expect(parts.every((p) => p in after.composites), `... and drawn: ${Object.keys(after.composites).join(', ')}`);
  const again = writeCompositeMarkers(w.dut, pou);
  expect(again.written.length === 0 && again.dut === w.dut, `${name}: written again: nothing more`);
  if (name === 'DoorDasher') {
    const comps = enumComposites(w.dut);
    expect(comps.find((c) => c.name === 'CrossTransfer')?.parent === 'DoordashSeq' && comps.find((c) => c.name === 'DoordashSeq')?.parent === 'Enabled', 'nested as in the UML chart (CrossTransfer in DoordashSeq in Enabled)');
  }
}

// The edges of a composite
const method = (name: string, body: string) => `    <Method Name="${name}" Id="{m-${name}}">\r\n      <Declaration><![CDATA[METHOD ${name} : BOOL]]></Declaration>\r\n      <Implementation>\r\n        <ST><![CDATA[${body}]]></ST>\r\n      </Implementation>\r\n    </Method>`;
const DO = ['CASE machineState OF', '\tS_IDLE:', '\t\tIF go THEN', '\t\t\tmachineState := S_A;', '\t\tELSIF skip THEN', '\t\t\tmachineState := S_B;', '\t\tEND_IF', '\tS_A:', '\t\tmachineState := S_B;', '\tS_B:', '\t\tIF done THEN', '\t\t\tmachineState := S_IDLE;', '\t\tEND_IF', '\t\tIF bad THEN', '\t\t\tmachineState := S_ERR;', '\t\tEND_IF', '\tS_ERR:', '\t\t;', 'END_CASE'].join('\r\n');
const PRE = ['IF machineState >= S_A AND machineState <= S_B AND fault THEN', '\tmachineState := S_ERR;', 'END_IF', 'IF machineState > S_IDLE AND stop THEN', '\tmachineState := S_IDLE;', 'END_IF', 'IF estop THEN', '\tmachineState := S_ERR;', 'END_IF'].join('\r\n');
const POU = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\r\n    <Declaration><![CDATA[FUNCTION_BLOCK SM_X\r\nVAR\r\n\tmachineState : E_S;\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[preProcess();\r\ndoState();]]></ST>\r\n    </Implementation>\r\n${method('doState', DO)}\r\n${method('preProcess', PRE)}\r\n  </POU>\r\n</TcPlcObject>`;
const dutOf = (list: string) => `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <DUT Name="E_S" Id="{2}">\r\n    <Declaration><![CDATA[TYPE E_S :\r\n(\r\n${list}\r\n);\r\nEND_TYPE]]></Declaration>\r\n  </DUT>\r\n</TcPlcObject>`;
const DUT = dutOf('\tS_IDLE := 0,\r\n\t{region "Work"}\r\n\tS_A,\r\n\tS_B,\r\n\t{endregion}\r\n\tS_ERR');
const edgesOf = (dut: string, flowchartOutput: boolean) => extractEdgesFromMermaid(generateStatechartModel(dut, POU, { flowchartOutput }).markdown).map((e) => `${e.from}->${e.to}`);
for (const flow of [true, false]) {
  const kind = flow ? 'flowchart' : 'stateDiagram-v2';
  let e = edgesOf(DUT, flow);
  expect(e.includes('S_IDLE->Work') && e.includes('S_IDLE->S_B') && !e.includes('S_IDLE->S_A'), `${kind}: into its initial state (its first: S_A) at its border; into S_B at S_B (${e.filter((x) => /^S_IDLE/.test(x)).join(', ')})`);
  expect(e.includes('S_B->S_IDLE') && e.includes('S_B->S_ERR') && !e.includes('Work->S_IDLE'), `${kind}: no final marked: out of S_B at S_B (${e.filter((x) => /^S_B|^Work/.test(x)).join(', ')})`);
  expect(e.includes('Work->S_ERR'), `${kind}: preProcess, S_A..S_B (its states exactly): from its border (${e.filter((x) => /S_ERR$/.test(x)).join(', ')})`);
  expect(e.includes('AnyState->S_ERR') && e.includes('AnyState->S_IDLE'), `${kind}: preProcess, no range / > S_IDLE (S_ERR too, not only Work's): from any state`);
  const marked = setEnumMark(setEnumMark(DUT, 'S_B', 'initial', true)!, 'S_B', 'final', true)!;
  e = edgesOf(marked, flow);
  expect(e.includes('S_IDLE->S_A') && e.filter((x) => x === 'S_IDLE->Work').length >= 1, `${kind}: S_B @initial: into S_B at the border, into S_A at S_A (${e.filter((x) => /^S_IDLE/.test(x)).join(', ')})`);
  expect(e.includes('Work->S_IDLE') && !e.includes('S_B->S_IDLE'), `${kind}: S_B @final: out of it from the border (${e.filter((x) => /^S_B|^Work/.test(x)).join(', ')})`);
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

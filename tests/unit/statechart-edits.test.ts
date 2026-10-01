// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The statechart editor's elements in the ST: composites as {region} pragmas in the enum (nested; the generator's
// clusters), the initial state (the declaration's initial value), final states, choices, state descriptions
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { addTransition } from '../../src/utils/stateEdits.ts';
import { getPouBody } from '../../src/utils/pouBody.ts';
import { enumMembers, lintStateMachine } from '../../src/utils/stateMachineLint.ts';
import { removeEnumMember } from '../../src/utils/stateCopyDelete.ts';
import {
  enumMarksOf, setEnumMark, addChoice, addCompletionTransition, addEnumMemberIn, addExceptionTransition, addForkJoinRegions, addStateDescription, regionVariables, compositeOf, describeName, dropEmptyComposites, enumComposites, initialStateOf,
  isFinalState, setFinalState, setInitialState, wrapInComposite, compositeColorsOf, setCompositeColor, groupInComposite, moveToComposite, ungroupComposite,
} from '../../src/utils/statechartEdits.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const DO_STATE = ['CASE machineState OF', '\tS_A:', '\t\tIF a THEN', '\t\t\tmachineState := S_B;', '\t\tEND_IF', '\tS_B:', '\t\tmachineState := S_C;', '\tS_C:', '\t\t;', '\tS_D:', '\t\tmachineState := S_A;', 'END_CASE'].join('\r\n');
const DESC = ['CASE machineState OF', "\tS_A: getStateDescription := 'Idle';", "\tS_B: getStateDescription := 'Busy';", 'END_CASE'].join('\r\n');
const method = (name: string, code: string) => `    <Method Name="${name}" Id="{${name}}">\r\n      <Declaration><![CDATA[METHOD ${name}]]></Declaration>\r\n      <Implementation>\r\n        <ST><![CDATA[${code}]]></ST>\r\n      </Implementation>\r\n    </Method>`;
const POU = `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <POU Name="SM_X" Id="{1}" SpecialFunc="None">\r\n    <Declaration><![CDATA[FUNCTION_BLOCK SM_X\r\nVAR\r\n\tmachineState : E_S; // the state\r\n\tn : INT;\r\nEND_VAR]]></Declaration>\r\n    <Implementation>\r\n      <ST><![CDATA[doState();]]></ST>\r\n    </Implementation>\r\n${method('doState', DO_STATE)}\r\n${method('getStateDescription', DESC)}\r\n  </POU>\r\n</TcPlcObject>`;
const dutOf = (list: string) => `<?xml version="1.0" encoding="utf-8"?>\r\n<TcPlcObject Version="1.1.0.1">\r\n  <DUT Name="E_S" Id="{2}">\r\n    <Declaration><![CDATA[TYPE E_S :\r\n(\r\n${list}\r\n);\r\nEND_TYPE]]></Declaration>\r\n  </DUT>\r\n</TcPlcObject>`;
const DUT = dutOf('\tS_A := 0,\r\n\tS_B,\r\n\tS_C,\r\n\tS_D');
const V = 'machineState';
const model = (pou: string, dut: string, flowchartOutput = false) => generateStatechartModel(dut, pou, { flowchartOutput });

// Composites
let dut = wrapInComposite(DUT, 'S_B', 'Working')!;
expect(/\tS_A := 0,\r\n\t\{region "Working"\}\r\n\tS_B,\r\n\t\{endregion\}\r\n\tS_C,/.test(dut), 'a member wrapped in a composite');
expect(enumMembers(dut).join() === 'S_A,S_B,S_C,S_D', `the members with pragmas: ${enumMembers(dut).join(', ')}`);
dut = addEnumMemberIn(dut, 'S_B2', 'Working')!;
expect(/\tS_B,\r\n\tS_B2,\r\n\t\{endregion\}\r\n\tS_C,/.test(dut), 'a member added in the composite (its last)');
dut = wrapInComposite(dut, 'S_B2', 'Inner')!;
const comps = enumComposites(dut);
expect(JSON.stringify(comps) === JSON.stringify([{ name: 'Working', parent: null, members: ['S_B'] }, { name: 'Inner', parent: 'Working', members: ['S_B2'] }]), `nested: ${JSON.stringify(comps)}`);
expect(compositeOf(dut, 'S_B2') === 'Inner' && compositeOf(dut, 'S_A') === null, 'compositeOf');
// A composite at the end of the list: the member before it gets a comma
let tail = wrapInComposite(DUT, 'S_D', 'Last')!;
tail = addEnumMemberIn(tail, 'S_E', 'Last')!;
expect(/\t\{region "Last"\}\r\n\tS_D,\r\n\tS_E\r\n\t\{endregion\}\r\n\);/.test(tail) && enumMembers(tail).join() === 'S_A,S_B,S_C,S_D,S_E', 'last in the list: S_D, S_E');
// A top-level member after a composite that ends the list: after its {endregion}
const top = addEnumMemberIn(tail, 'S_F', null)!;
expect(/\tS_E,\r\n\t\{endregion\}\r\n\tS_F\r\n\);/.test(top) && compositeOf(top, 'S_F') === null, 'a top-level member after the last composite');
// Removing members with pragmas around; an empty composite goes
const noB2 = removeEnumMember(dut, 'S_B2');
expect(!!noB2 && enumMembers(noB2.dut).join() === 'S_A,S_B,S_C,S_D', `removed inside a composite: ${noB2 && enumMembers(noB2.dut).join(', ')}`);
const cleaned = dropEmptyComposites(noB2!.dut);
expect(!/Inner/.test(cleaned) && /Working/.test(cleaned), 'the empty composite dropped');

// The generator: the composites are clusters, nested
const pouB2 = POU.replace('\tS_C:', '\tS_B2:\r\n\t\t;\r\n\tS_C:');
const md = model(pouB2, dut).markdown;
expect(/state "Working" as Working \{[\s\S]*S_B[\s\S]*state "Inner" as Inner \{[\s\S]*S_B2[\s\S]*\}[\s\S]*\}/.test(md), 'stateDiagram: Working holds S_B and Inner (S_B2)');
const fc = model(pouB2, dut, true).markdown;
expect(/subgraph Working\["Working"\][\s\S]*subgraph Inner\["Inner"\][\s\S]*end[\s\S]*end/.test(fc), 'flowchart: nested subgraphs');

// The initial state
expect(initialStateOf(POU, V) === null, 'no initial value');
expect(/\[\*\] --> S_A/.test(model(POU, DUT).markdown), 'the first member starts');
const init = setInitialState(POU, V, 'S_C');
if ('error' in init) throw new Error(init.error);
expect(getPouBody(init.pou).declaration.includes('\tmachineState : E_S := S_C; // the state') && initialStateOf(init.pou, V) === 'S_C', 'the declaration: machineState : E_S := S_C;');
const init2 = setInitialState(init.pou, V, 'S_D');
expect(!('error' in init2) && initialStateOf(init2.pou, V) === 'S_D' && getPouBody(init2.pou).declaration.includes(':= S_D;'), 'changed again');
expect(/\[\*\] --> S_C/.test(model(init.pou, DUT).markdown) && /startNode\(\(" "\)\) --> S_C/.test(model(init.pou, DUT, true).markdown), 'the chart starts in S_C');

// Final states
const fin = setFinalState(POU, 'S_C', true);
if ('error' in fin) throw new Error(fin.error);
expect(getMethodCodeFromPou(fin.pou, 'doState').code.includes('\tS_C: (* final *)') && isFinalState(fin.pou, 'S_C'), 'S_C: (* final *)');
expect(/S_C --> \[\*\]/.test(model(fin.pou, DUT).markdown), 'stateDiagram: S_C --> [*]');
const fcFin = model(fin.pou, DUT, true).markdown;
expect(/S_C --> endNode\w*\(\(\(" "\)\)\)/.test(fcFin), 'flowchart: S_C to an end node (its composite\'s: the enum\'s states are one)');
expect(!extractEdgesFromMermaid(fcFin).some((e) => /endNode/.test(e.to)), 'the end node is no transition');
const unfin = setFinalState(fin.pou, 'S_C', false);
expect(!('error' in unfin) && !isFinalState(unfin.pou, 'S_C') && getMethodCodeFromPou(unfin.pou, 'doState').code === DO_STATE, 'not final again: the code as it was');

// A choice
const ch = addChoice(POU, 'S_C', [{ condition: 'x > 1', to: 'S_A' }, { condition: 'bStop', to: 'S_D' }], 'S_B', V);
if ('error' in ch) throw new Error(ch.error);
expect(getMethodCodeFromPou(ch.pou, 'doState').code.includes('\tS_C:\r\n\t\tIF x > 1 THEN\r\n\t\t\tmachineState := S_A;\r\n\t\tELSIF bStop THEN\r\n\t\t\tmachineState := S_D;\r\n\t\tELSE\r\n\t\t\tmachineState := S_B;\r\n\t\tEND_IF\r\n\tS_D:'), 'the IF / ELSIF / ELSE in S_C (its ";" gone)');
const out = extractEdgesFromMermaid(model(ch.pou, DUT).markdown).filter((e) => e.from === 'S_C').map((e) => e.to).sort().join();
expect(out === 'S_A,S_B,S_D', `S_C's transitions: ${out}`);
expect('error' in addChoice(POU, 'S_C', [{ condition: 'x', to: 'S_C' }], null, V), 'to itself: refused');

// Descriptions
const desc = addStateDescription(POU, 'S_C', 'Done');
expect(getMethodCodeFromPou(desc, 'getStateDescription').code.includes("\tS_B: getStateDescription := 'Busy';\r\n\tS_C: getStateDescription := 'Done';\r\nEND_CASE"), 'getStateDescription: a line for S_C');
expect(addStateDescription(desc, 'S_C', 'Again') === desc, 'not twice');
expect(describeName('TABLEMANAGER_WAIT_FOR_DOOR', ['TABLEMANAGER_IDLE', 'TABLEMANAGER_HOMMING']) === 'Wait For Door', 'describeName');

// Completion and exception transitions
const comp = addCompletionTransition(POU, 'S_C', 'S_D', V);
expect(!('error' in comp) && getMethodCodeFromPou(comp.pou, 'doState').code.includes('\tS_C:\r\n\t\tmachineState := S_D; // completion transition\r\n\tS_D:'), 'completion: an assignment with no condition');
const exc = addExceptionTransition(POU, DUT, { state: 'S_A' }, 'S_D', 'bFault', V);
if ('error' in exc) throw new Error(exc.error);
expect(getMethodCodeFromPou(exc.pou, 'doState').code.includes('\tS_A:\r\n\t\tIF bFault THEN // exception transition\r\n\t\t\tmachineState := S_D;\r\n\t\tELSE\r\n\t\t\tIF a THEN\r\n\t\t\t\tmachineState := S_B;\r\n\t\t\tEND_IF\r\n\t\tEND_IF\r\n\tS_B:'), 'exception from a state: first, the branch in its ELSE');
const excEdges = extractEdgesFromMermaid(generateStatechartModel(DUT, exc.pou, { showTransitionPriorities: true, priorityFormat: 'paren' }).markdown).filter((e) => e.from === 'S_A').map((e) => `${e.to}(${e.priority})`).sort().join(' ');
expect(excEdges === 'S_B(2) S_D(1)', `the exception has priority 1: ${excEdges}`);
const pouPre = POU.replace('  </POU>', `${method('preProcess', 'n := n + 1;')}\r\n  </POU>`);
const excC = addExceptionTransition(pouPre, dut, { composite: 'Working' }, 'S_D', 'bAbort', V);
if ('error' in excC) throw new Error(excC.error);
expect(getMethodCodeFromPou(excC.pou, 'preProcess').code.includes('IF machineState >= S_B AND machineState <= S_B2 AND (bAbort) THEN\n\tmachineState := S_D;\nEND_IF'), 'exception from a composite: preProcess() over its states (S_B .. S_B2)');
const mdC = generateStatechartModel(dut, excC.pou.replace('\tS_C:', '\tS_B2:\r\n\t\t;\r\n\tS_C:'), {}).markdown;
expect(/Working --> S_D/.test(mdC), `the chart: Working → S_D (${(mdC.match(/.*--> S_D.*/g) || []).join(' | ')})`);

// Fork / Join with parallel regions: region variables of the enum's type, their states in the enum, CASEs in the
// state's branch; the chart draws the regions inside the state
const withFirst = POU.replace('\tS_B:\r\n\t\tmachineState := S_C;', '\tS_B:\r\n\t\tIF bFirstPass THEN n := 0; END_IF\r\n\t\tmachineState := S_C;');
const fj = addForkJoinRegions(withFirst, DUT, 'S_B', [{ variable: 'regionA', states: ['S_B_A_RUN', 'S_B_A_DONE'] }, { variable: 'regionB', states: ['S_B_B_DONE'] }], 'S_D', V);
if ('error' in fj) throw new Error(fj.error);
expect(enumMembers(fj.dut).join() === 'S_A,S_B,S_C,S_D,S_B_A_RUN,S_B_A_DONE,S_B_B_DONE', `the enum: ${enumMembers(fj.dut).join(', ')}`);
expect(/\tregionA : E_S; \/\/ parallel region of S_B\r\n\tregionB : E_S; \/\/ parallel region of S_B\r\nEND_VAR/.test(getPouBody(fj.pou).declaration), 'the declaration: the region variables');
const fjCode = getMethodCodeFromPou(fj.pou, 'doState').code;
expect(fjCode.includes([
  '\t\t// fork: regionA, regionB run in parallel', '\t\tIF bFirstPass THEN', '\t\t\tregionA := S_B_A_RUN;', '\t\t\tregionB := S_B_B_DONE;', '\t\tEND_IF',
  '\t\tCASE regionA OF', '\t\t\tS_B_A_RUN:', '\t\t\t\t// regionA := S_B_A_DONE; when …', '\t\t\tS_B_A_DONE: (* final *)', '\t\t\t\t;', '\t\tEND_CASE',
  '\t\tCASE regionB OF', '\t\t\tS_B_B_DONE: (* final *)', '\t\t\t\t;', '\t\tEND_CASE',
  '\t\t// join: when every region is in its final state', '\t\tIF regionA = S_B_A_DONE AND regionB = S_B_B_DONE THEN', '\t\t\tmachineState := S_D;', '\t\tEND_IF',
].join('\r\n')), 'doState(): fork, the regions\' CASEs, join');
// A transition in region A (as the canvas writes it, with the region's variable)
const inRegion = addTransition(fj.pou, 'S_B_A_RUN', 'S_B_A_DONE', 'bWorkDone', 'regionA')!;
const fjPou = updateMethodCodeInPou(fj.pou, 'doState', inRegion).updatedPou;
const regions = regionVariables(fjPou, fj.dut, V);
expect(regions.get('S_B_A_RUN')?.variable === 'regionA' && regions.get('S_B_B_DONE')?.variable === 'regionB' && regions.get('S_B_A_RUN')?.parent === 'S_B', 'regionVariables: each state\'s region');
const fcR = generateStatechartModel(fj.dut, fjPou, { flowchartOutput: true }).markdown;
expect(/subgraph S_B\["S_B[^"]*"\]\n\s*subgraph S_B__regionA\["regionA"\]\n\s*S_B_A_RUN\["S_B_A_RUN"\]\n\s*S_B_A_DONE\["S_B_A_DONE"\]\n\s*startNode_S_B__regionA\(\(" "\)\) --> S_B_A_RUN\n\s*S_B_A_RUN -->\|"bWorkDone"\| S_B_A_DONE\n\s*S_B_A_DONE --> endNode_S_B__regionA\(\(\(" "\)\)\)\n\s*end\n\s*subgraph S_B__regionB/.test(fcR), 'flowchart: S_B holds a subgraph per region');
expect(/S_B -->\|"[^"]*regionA = S_B_A_DONE AND regionB = S_B_B_DONE[^"]*"\| S_D/.test(fcR), 'the join: S_B → S_D');
const sdR = generateStatechartModel(fj.dut, fjPou, {}).markdown;
expect(/state "S_B" as S_B \{\n\s*\[\*\] --> S_B_A_RUN\n\s*S_B_A_RUN\n\s*S_B_A_DONE\n\s*S_B_A_RUN --> S_B_A_DONE: bWorkDone\n\s*S_B_A_DONE --> \[\*\]\n\s*--\n\s*\[\*\] --> S_B_B_DONE/.test(sdR), 'stateDiagram: the regions separated by --');
const rEdges = extractEdgesFromMermaid(fcR).map((e) => `${e.from}->${e.to}`);
expect(rEdges.includes('S_B_A_RUN->S_B_A_DONE') && !rEdges.some((e) => /startNode|endNode/.test(e)), `the region's transition is an edge: ${rEdges.filter((e) => /S_B_/.test(e)).join(', ')}`);
expect(!/S_B_A_RUN/.test(fcR.replace(/subgraph S_B\[[\s\S]*?\n {4}end\n/, '')), 'its states only in the region');
expect('error' in addForkJoinRegions(withFirst, DUT, 'S_B', [{ variable: 'regionA', states: ['X1'] }], 'S_D', V), 'one region: refused');
expect('error' in addForkJoinRegions(POU, DUT, 'S_B', [{ variable: 'rA', states: ['X1'] }, { variable: 'rB', states: ['X2'] }], 'S_D', V), 'no bFirstPass: refused');
expect('error' in addForkJoinRegions(withFirst, DUT, 'S_B', [{ variable: 'n', states: ['X1'] }, { variable: 'rB', states: ['X2'] }], 'S_D', V), 'a used variable name: refused');

// Initial / final marked in the enum; in a composite: its entry and exits at its border
let mk = setEnumMark(dutOf('\tS_A := 0,\r\n\t{region "Work"}\r\n\tS_B,\r\n\tS_C,\r\n\tS_D, // done\r\n\t{endregion}\r\n\tS_E'), 'S_B', 'initial', true)!;
mk = setEnumMark(mk, 'S_D', 'final', true)!;
expect(/\tS_B, \/\/ @initial\r\n/.test(mk) && /\tS_D, \/\/ @final done\r\n/.test(mk), 'the marks in the enum');
expect(enumMarksOf(mk, 'S_B').initial && enumMarksOf(mk, 'S_D').final && !enumMarksOf(mk, 'S_C').initial, 'enumMarksOf');
expect(!/@final/.test(setEnumMark(mk, 'S_D', 'final', false)!) && /\tS_D, \/\/ done\r\n/.test(setEnumMark(mk, 'S_D', 'final', false)!), 'unmarked: the comment as it was');
const MK_DO = ['CASE machineState OF', '\tS_A:', '\t\tIF a THEN machineState := S_B; END_IF', '\t\tIF c THEN machineState := S_C; END_IF', '\tS_B:', '\t\tmachineState := S_C;', '\tS_C:', '\t\tmachineState := S_D;', '\tS_D:', '\t\tIF x THEN machineState := S_E; END_IF', '\t\tIF y THEN machineState := S_A; END_IF', '\tS_E:', '\t\tmachineState := S_A;', 'END_CASE'].join('\r\n');
const MK_POU = POU.replace(DO_STATE, MK_DO);
const fcMk = generateStatechartModel(mk, MK_POU, { flowchartOutput: true }).markdown;
expect(/S_A -->[^\n]*\bWork\b/.test(fcMk) && !/S_A -->[^\n]*\bS_B\b/.test(fcMk), 'into the initial state: to the composite\'s border (S_A → Work)');
expect(/S_A -->[^\n]*\bS_C\b/.test(fcMk), 'into another state of it: to that state');
expect(/Work -->[^\n]*\bS_E\b/.test(fcMk) && /Work -->[^\n]*\bS_A\b/.test(fcMk) && !/S_D -->[^\n]*\bS_E\b/.test(fcMk), 'out of the final state: from the border (Work → S_E, Work → S_A)');
expect(/startNode_Work\(\(" "\)\) --> S_B/.test(fcMk) && /S_D --> endNode_Work\(\(\(" "\)\)\)/.test(fcMk), 'the composite\'s start and end nodes');
const sdMk = generateStatechartModel(mk, MK_POU, {}).markdown;
expect(/state "Work" as Work \{\n\s*\[\*\] --> S_B[\s\S]*S_D --> \[\*\]\n\s*\}/.test(sdMk), 'stateDiagram: [*] → S_B and S_D → [*] in Work');
const lintMk = lintStateMachine(MK_POU.replace("\t\tIF x THEN machineState := S_E; END_IF\r\n\t\tIF y THEN machineState := S_A; END_IF", '\t\t;'), mk);
expect(!lintMk.some((f) => f.key === 'dead-end:S_D'), 'lint: a state marked @final is no dead end');

// Lint: several @initial in a composite; a region with no final state; a region state never entered
const lintKeys = (pou: string, d: string) => lintStateMachine(pou, d).map((f) => f.key);
const twoInit = setEnumMark(setEnumMark(mk, 'S_B', 'initial', true)!, 'S_C', 'initial', true)!;
expect(lintKeys(MK_POU, twoInit).includes('multiple-initial:Work'), 'two @initial in Work: multiple-initial');
expect(!lintKeys(MK_POU, mk).some((k) => k.startsWith('multiple-initial')), 'one: fine');
// The fork above: region A's S_B_A_RUN leads nowhere yet (no transition to S_B_A_DONE); both regions have a final state
const fkKeys = lintKeys(fj.pou, fj.dut);
expect(fkKeys.includes('region-unreachable:S_B_A_DONE') && !fkKeys.some((k) => k.startsWith('region-no-final')), `the fork: ${fkKeys.filter((k) => /region/.test(k)).join(', ')}`);
expect(!lintKeys(fjPou, fj.dut).includes('region-unreachable:S_B_A_DONE'), 'with the transition in region A: entered');
const noFinal = fjPou.replace('S_B_B_DONE: (* final *)', 'S_B_B_DONE:');
expect(lintKeys(noFinal, fj.dut).includes('region-no-final:S_B.regionB'), 'no (* final *) in region B: region-no-final');

// A composite's own colour: "// @color <preset or #hex>" on its {region} line (set, changed, taken out; the
// region still a composite, the other lines as they were)
{
  const w = wrapInComposite(DUT, 'S_B', 'Working')!;
  expect(Object.keys(compositeColorsOf(w)).length === 0, 'no colour: none read');
  const rose = setCompositeColor(w, 'Working', 'rose')!;
  expect(/\t\{region "Working"\} \/\/ @color rose\r\n\tS_B,/.test(rose) && compositeColorsOf(rose).Working === 'rose', 'Colour rose: // @color rose on its {region} line');
  expect(enumComposites(rose).map((c) => `${c.name}:${c.members.join('+')}`).join() === 'Working:S_B', 'still the composite Working with S_B');
  const hex = setCompositeColor(rose, 'Working', '#7aa2c8')!;
  expect(/\{region "Working"\} \/\/ @color #7aa2c8\r\n/.test(hex) && !/rose/.test(hex) && compositeColorsOf(hex).Working === '#7aa2c8', 'changed to a #hex: the one colour on the line');
  const withNote = hex.replace('// @color #7aa2c8', '// the working ones @color #7aa2c8');
  const back = setCompositeColor(withNote, 'Working', null)!;
  expect(/\{region "Working"\} \/\/ the working ones\r\n/.test(back) && !compositeColorsOf(back).Working, 'taken out: its comment kept, the mark gone');
  expect(setCompositeColor(setCompositeColor(w, 'Working', 'olive')!, 'Working', null) === w, 'set and taken out: the enum as it was');
  expect(setCompositeColor(w, 'Nope', 'rose') === null, 'no such composite: null');
  expect(model(POU, rose).composites.Working?.includes('S_B'), 'the chart still draws Working around S_B');
}

// Several states grouped into a composite (Shift + a box on the canvas): their lines moved together where the first
// one is, wrapped in {region}; comments, values and marks kept; the commas right (a comma after, or ", NAME" before)
{
  const list = dutOf('\tS_A := 0,\r\n\tS_B, // busy @final\r\n\tS_C,\r\n\tS_D := 7 (* last *)');
  const g = groupInComposite(list, ['S_D', 'S_B'], 'Work') as { dut: string; reordered: boolean };
  expect(!('error' in g) && /\tS_A := 0,\r\n\t\{region "Work"\}\r\n\tS_B, \/\/ busy @final\r\n\tS_D := 7, \(\* last \*\)\r\n\t\{endregion\}\r\n\tS_C\r\n\);/.test(g.dut), `S_B and S_D grouped: moved together, their comments and value kept, the commas right (${JSON.stringify(g.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  expect(g.reordered === true && enumMembers(g.dut).join() === 'S_A,S_B,S_D,S_C' && enumComposites(g.dut).map((c) => `${c.name}:${c.members.join('+')}`).join() === 'Work:S_B+S_D', 'reordered (S_C was between them); the composite Work with S_B, S_D');
  expect(enumMarksOf(g.dut, 'S_B').final, 'its @final mark kept');
  const inOrder = groupInComposite(list, ['S_B', 'S_C'], 'Run') as { dut: string; reordered: boolean };
  expect(!inOrder.reordered && /\tS_A := 0,\r\n\t\{region "Run"\}\r\n\tS_B, \/\/ busy @final\r\n\tS_C,\r\n\t\{endregion\}\r\n\tS_D := 7 \(\* last \*\)/.test(inOrder.dut), 'next to each other: only wrapped, nothing reordered');
  // Comments and blank lines between them: kept in place, inside the composite
  const commented = dutOf('\tS_A := 0,\r\n\t(* running *)\r\n\tS_B,\r\n\r\n//\tS_OLD,\r\n\tS_C,\r\n\t(* the end *)\r\n\tS_D');
  const gc = groupInComposite(commented, ['S_B', 'S_C'], 'Run') as { dut: string; reordered: boolean };
  expect(!gc.reordered && /\t\(\* running \*\)\r\n\t\{region "Run"\}\r\n\tS_B,\r\n\r\n\/\/\tS_OLD,\r\n\tS_C,\r\n\t\{endregion\}\r\n\t\(\* the end \*\)\r\n\tS_D\r\n\);/.test(gc.dut), `the blank line and the commented-out member between them stay (${JSON.stringify(gc.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  // A list with commas before its members (", NAME"), and a mixed one
  const lead = dutOf('\tS_A,\r\n\tS_B\r\n\t, S_C\r\n\t, S_D\r\n\t, S_E');
  const gl = groupInComposite(lead, ['S_B', 'S_D'], 'Mid') as { dut: string; reordered: boolean };
  expect(/\tS_A,\r\n\t\{region "Mid"\}\r\n\tS_B\r\n\t, S_D\r\n\t\{endregion\}\r\n\t, S_C\r\n\t, S_E\r\n\);/.test(gl.dut) && enumMembers(gl.dut).join() === 'S_A,S_B,S_D,S_C,S_E', `commas before the members: kept so (${JSON.stringify(gl.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  const glFirst = groupInComposite(lead, ['S_C', 'S_A'], 'Top') as { dut: string };
  expect(enumMembers(glFirst.dut).join() === 'S_A,S_C,S_B,S_D,S_E' && !/\{region "Top"\}\r\n\t,/.test(glFirst.dut), `a ", NAME" line first: no comma before it (${JSON.stringify(glFirst.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  // In a composite: the new one inside it; states of two composites: refused
  const nested = groupInComposite(g.dut, ['S_D'], 'Inner') as { dut: string };
  expect(enumComposites(nested.dut).find((c) => c.name === 'Inner')?.parent === 'Work', 'a state of Work grouped: the new composite inside Work');
  const two = groupInComposite(g.dut, ['S_B', 'S_C'], 'Mixed');
  expect('error' in two && /different composites/.test(two.error), `states of two composites: ${'error' in two ? two.error : 'grouped'}`);
  expect('error' in groupInComposite(list, ['S_B'], 'S_B?'), 'a bad name: refused');
  expect('error' in groupInComposite(g.dut, ['S_A'], 'Work'), 'a name already there: refused');
  expect('error' in groupInComposite(list, ['NOPE'], 'X'), 'not a member: refused');

  // A state dragged into a composite (its line last in it, kept whole), and out again (after the composite)
  const into = moveToComposite(g.dut, ['S_C'], 'Work') as { dut: string; reordered: boolean };
  expect(!('error' in into) && /\t\{region "Work"\}\r\n\tS_B, \/\/ busy @final\r\n\tS_D := 7, \(\* last \*\)\r\n\tS_C\r\n\t\{endregion\}\r\n\);/.test(into.dut) && compositeOf(into.dut, 'S_C') === 'Work', `S_C into Work: last in it (${JSON.stringify(into.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  const outOf = moveToComposite(into.dut, ['S_B'], null) as { dut: string; reordered: boolean };
  expect(!('error' in outOf) && compositeOf(outOf.dut, 'S_B') === null && enumMarksOf(outOf.dut, 'S_B').final && /\t\{endregion\}\r\n\tS_B \/\/ busy @final\r\n\);/.test(outOf.dut) && outOf.reordered, `S_B out of Work: after it, its @final kept (${JSON.stringify(outOf.dut?.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  const empty = moveToComposite(g.dut, ['S_B', 'S_D'], null) as { dut: string };
  expect(!/\{region/.test(empty.dut) && enumMembers(empty.dut).join() === 'S_A,S_B,S_D,S_C', `all out: the composite gone (${enumMembers(empty.dut).join()})`);
  const nestedIn = moveToComposite(nested.dut, ['S_B'], 'Inner') as { dut: string };
  expect(compositeOf(nestedIn.dut, 'S_B') === 'Inner', 'into a composite inside another');
  const up = moveToComposite(nestedIn.dut, ['S_B'], 'Work') as { dut: string };
  expect(compositeOf(up.dut, 'S_B') === 'Work' && enumComposites(up.dut).some((c) => c.name === 'Inner'), 'from the inner one back into Work');
  expect('error' in moveToComposite(g.dut, ['S_A'], 'Nope'), 'no such composite: refused');

  // Ungrouped: its markers out, its states (and a composite in it) where they are, the commas right
  const un = ungroupComposite(nested.dut, 'Work')!;
  expect(!!un && !/\{region "Work"\}/.test(un) && enumComposites(un).map((c) => `${c.name}:${c.parent}`).join() === 'Inner:null' && enumMembers(un).join() === 'S_A,S_B,S_D,S_C', `Work ungrouped: Inner left, top level (${enumComposites(un).map((c) => c.name).join()}; ${enumMembers(un).join()})`);
  const plain = ungroupComposite(g.dut, 'Work')!;
  expect(/\tS_A := 0,\r\n\tS_B, \/\/ busy @final\r\n\tS_D := 7, \(\* last \*\)\r\n\tS_C\r\n\);/.test(plain), `ungrouped: the lines as they were around it (${JSON.stringify(plain.match(/\(\r\n[\s\S]*?\);/)?.[0])})`);
  expect(ungroupComposite(g.dut, 'Nope') === null, 'no such composite: null');
}

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

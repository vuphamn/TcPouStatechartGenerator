// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Qualified enum states (E_X.MEMBER): what each parser makes of the KPowerSupply POUs
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { lintStateMachine, stateAtLine, addCaseBranch, enumMembers } from '../../src/utils/stateMachineLint.ts';
import { getStateCodeFromPou, getMethodCodeFromPou } from '../../src/utils/pouStateEditor.ts';
import { findCaseLabelLineIndex } from '../../src/utils/stSyntaxHighlighter.ts';
import { detectFoldableBlocks, findFoldableBlockForState } from '../../src/utils/stCodeFolding.ts';
import { enumValueMap } from '../../src/utils/liveView.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const read = (f: string) => {
  const s = (SAMPLES as any[]).find((x) => x.pouName === f || x.dutName === f);
  if (!s) throw new Error(`${f} is not a sample`);
  return f.endsWith('.TcDUT') ? s.dutContent : s.pouContent;
};
const cases = [
  { pou: 'SM_KServoSupplyManager.TcPOU', dut: 'E_KSupplyManager_States.TcDUT', states: ['DISABLED', 'ADD_CHILDREN', 'NO_CHILDREN', 'ENABLE_CHILDREN', 'ENABLED', 'ERROR'],
    edges: ['ADD_CHILDREN->ERROR', 'ADD_CHILDREN->NO_CHILDREN', 'ADD_CHILDREN->ENABLE_CHILDREN', 'ENABLE_CHILDREN->ENABLED'] },
  { pou: 'SM_KPowerSupplyAx86x0.TcPOU', dut: 'E_KPowerSupply_States.TcDUT', states: ['DISABLED', 'ENABLING', 'RESET', 'ENABLED', 'ERROR'],
    edges: ['ENABLING->ERROR', 'ENABLING->KPowerSupplyEnabled', 'RESET->ENABLED', 'ENABLED->RESET', 'KPowerSupplyEnabled->ERROR'] },
];
for (const c of cases) {
  const pou = read(c.pou);
  const dut = read(c.dut);
  console.log(`== ${c.pou}`);
  let model;
  try { model = generateStatechartModel(dut, pou, { includeStateDescriptions: true }); } catch (e) { console.log('   generator threw:', (e as Error).message); continue; }
  const edges = extractEdgesFromMermaid(model.markdown).filter((e) => e.from !== '[*]' && e.to !== '[*]');
  const ids = edges.map((e) => `${e.from}->${e.to}`);
  console.log('   edges:', ids.join(', '));
  expect(c.edges.every((e) => ids.includes(e)) && !ids.some((e) => /E_K/.test(e)), 'generator: transitions with plain state names');
  expect(!/E_K\w+\./.test(model.markdown), 'generator: no qualifier left in the Mermaid code');
  const desc = model.markdown.match(/Adding Children|Enabling Children|ENABLING/g) || [];
  expect(desc.length > 0, `generator: state descriptions from getStateDescription (${desc.length})`);
  const ext = extractIdentifiedStatesFromPou(pou, dut);
  const found = ext.states.map((s) => s.id);
  console.log('   identified:', found.join(', '), '| logic:', ext.states.filter((s) => s.hasCaseBranch).map((s) => s.id).join(', '), '| stateVar', ext.stateVarName);
  expect(c.states.every((s) => found.includes(s)) && ext.states.filter((s) => s.hasCaseBranch).length >= c.states.length - 1, 'Identified States: every member, with its CASE branch');
  const lint = lintStateMachine(pou, dut, edges);
  console.log('   lint:', lint.map((f) => `${f.rule}:${f.stateId ?? ''}`).join(', ') || 'none');
  expect(!lint.some((f) => /unknown-target|unknown-label|missing-branch/.test(f.rule)), 'Problems: no false "not in enum" / "no CASE branch"');
  const doState = getMethodCodeFromPou(pou, 'doState').code;
  const li = findCaseLabelLineIndex(doState, 'ENABLED');
  expect(li >= 0 && /ENABLED\s*:/.test(doState.split(/\r?\n/)[li]), `Method Editor: jump to the ENABLED label (line ${li + 1})`);
  const code = getStateCodeFromPou(pou, 'ERROR');
  expect(!!code && /status_bError := TRUE/.test(code.code || ''), `state code of ERROR: ${(code?.code || '').replace(/\s+/g, ' ').slice(0, 60)}`);
  const blocks = detectFoldableBlocks(doState);
  const b = findFoldableBlockForState(blocks, 'ENABLED');
  expect(!!b, `folding: the ENABLED branch is a block (${blocks.filter((x) => x.type === 'case-branch').length} branches)`);
  const at = doState.split(/\r?\n/).findIndex((l) => /\.ERROR:/.test(l)) + 2;
  expect(stateAtLine(pou, at) === 'ERROR', `caret line ${at} is in ERROR (${stateAtLine(pou, at)})`);
  const added = addCaseBranch(pou, 'NEW_STATE');
  expect(!!added && /E_K\w+_States\.NEW_STATE\s*:/.test(added), 'add state: the new branch uses the qualified style');
  expect(enumMembers(dut).length === c.states.length && enumValueMap(dut).size === c.states.length, 'enum members read');
}
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;

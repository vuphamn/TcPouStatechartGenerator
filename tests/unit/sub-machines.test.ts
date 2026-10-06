// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Sub-machines: a state's branch calls a method of the POU with a state machine of its own (as EFX_IDLE calls
// RpsSimulation() in its test mode): found with its states, transitions, start ("↑ cmd_bTestMode": the rising edge
// passed to its bInit), the condition it runs under, the RETURN that keeps the state's own transitions waiting, and
// its states never reached. The chart: drawn inside the state by default, by their own names, the entry labelled, never
// reached ones dashed, in both chart styles; collapsed ("-<state>"): the state's label says it has one. Its states and
// transitions found in its method (Go to code). A method called without a state machine, or a member's method, is none
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel, subMachinesOf } from '../../src/generator.ts';
import { findSubMachines } from '../../src/utils/subMachines.ts';
import { locateState, locateTransition, subMachineId } from '../../src/utils/sourceLocation.ts';
import { setTransitionPriority, transitionOrder } from '../../src/utils/transitionEdits.ts';
import { calculateStateComplexityHeatmap } from '../../src/utils/complexityHeatmap.ts';
import { extractStateNodesFromMermaid } from '../../src/utils/nodeStyles.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const METHOD = `    <Method Name="TestSequence" Id="{11111111-2222-3333-4444-555555555555}">
      <Declaration><![CDATA[METHOD TestSequence
VAR_INPUT
	bInit	: BOOL;
END_VAR
VAR_INST
	eTestState	: E_TEST_SEQ;
	tonStep		: TON;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF (bInit) THEN
	eTestState := E_TEST_SEQ.INIT;
ELSE
	CASE eTestState OF
		E_TEST_SEQ.INIT:
			eTestState := E_TEST_SEQ.WAITING;
		E_TEST_SEQ.WAITING:
			IF (cmd_bTestStart) THEN
				eTestState := E_TEST_SEQ.RUNNING;
			END_IF
		E_TEST_SEQ.RUNNING:
			tonStep(IN:=TRUE, PT:=T#2S);
			IF (tonStep.Q) THEN
				tonStep(IN:=FALSE);
				eTestState := E_TEST_SEQ.WAITING;
			END_IF
		E_TEST_SEQ.UNUSED:
			;
	END_CASE
END_IF]]></ST>
      </Implementation>
    </Method>
`;
const sample = SAMPLES.find((s) => s.id === 'table-manager-202')!;
const pou = sample.pouContent
  .replace(/(\tTABLEMANAGER_IDLE_FEED_OFF:\r?\n)/, '$1\t\trtrigTestMode(CLK:=cmd_bTestMode);\n\t\tIF (cmd_bTestMode) THEN\n\t\t\tTestSequence(rtrigTestMode.Q);\n\t\t\tRETURN;\n\t\tEND_IF\n')
  .replace('</POU>', `${METHOD}  </POU>`);
const dut = sample.dutContent;

const found = subMachinesOf(pou);
const f0 = found[0];
expect(found.length === 1 && f0.parent === 'TABLEMANAGER_IDLE_FEED_OFF' && f0.method === 'TestSequence' && f0.states.join() === 'INIT,WAITING,RUNNING,UNUSED', `found: ${JSON.stringify(found)}`);
// (what Live and the simulation need: its variable and its enum, where it starts, when it runs, its transitions)
expect(f0?.variable === 'eTestState' && f0.variableType === 'E_TEST_SEQ' && f0.start === 'INIT' && f0.entry === '↑ cmd_bTestMode' && f0.when === 'cmd_bTestMode' && f0.preempts === true && f0.transitions.length === 3, `for Live and the simulation: ${JSON.stringify(f0)}`);
expect(subMachinesOf(sample.pouContent).length === 0, 'the sample as it is: none (its methods have no state machine of their own)');

// The details
const methods = new Map<string, { st: string | null; decl: string | null }>();
for (const m of pou.matchAll(/<Method Name="([^"]+)"[^>]*>\s*<Declaration><!\[CDATA\[([\s\S]*?)\]\]><\/Declaration>\s*<Implementation>\s*<ST><!\[CDATA\[([\s\S]*?)\]\]><\/ST>/g)) methods.set(m[1], { decl: m[2], st: m[3] });
const [m] = findSubMachines(methods.get('doState')!.st, methods, pou);
expect(m?.variable === 'eTestState' && m.states.join() === 'INIT,WAITING,RUNNING,UNUSED' && m.start === 'INIT', `its states, its start: ${m?.states.join()} from ${m?.start}`);
expect(m?.entry === '↑ cmd_bTestMode' && m.when === 'cmd_bTestMode' && m.preempts === true, `starts on ↑ cmd_bTestMode, runs while cmd_bTestMode, the state's own transitions wait (${m?.entry}; ${m?.when}; ${m?.preempts})`);
expect(m?.transitions.map((t) => `${t.from}>${t.to}:${t.guard ?? ''}`).join(' ') === 'INIT>WAITING: WAITING>RUNNING:cmd_bTestStart RUNNING>WAITING:tonStep.Q', `its transitions: ${m?.transitions.map((t) => `${t.from}>${t.to}:${t.guard ?? ''}`).join(' ')}`);
expect(m?.unreachable.join() === 'UNUSED', `never reached: ${m?.unreachable.join()}`);

// The chart: collapsed ("-<state>")
const collapsed = generateStatechartModel(dut, pou, { collapsedComposites: ['-TABLEMANAGER_IDLE_FEED_OFF'] });
expect(/state "TABLEMANAGER_IDLE_FEED_OFF<br\/><span class='node-desc'>⊞ TestSequence<\/span>" as TABLEMANAGER_IDLE_FEED_OFF/.test(collapsed.markdown) && !/__TestSequence__/.test(collapsed.markdown), 'collapsed: the state\'s label says it has one, its states not drawn');
expect(JSON.stringify(collapsed.subMachines) === JSON.stringify([{ parent: 'TABLEMANAGER_IDLE_FEED_OFF', method: 'TestSequence', expanded: false }]), `the model says so: ${JSON.stringify(collapsed.subMachines)}`);
// By default: inside the state (a "+<state>" from before it was the default: the same)
const open = generateStatechartModel(dut, pou, {});
expect(generateStatechartModel(dut, pou, { collapsedComposites: ['+TABLEMANAGER_IDLE_FEED_OFF'] }).markdown === open.markdown && JSON.stringify(open.subMachines) === JSON.stringify([{ parent: 'TABLEMANAGER_IDLE_FEED_OFF', method: 'TestSequence', expanded: true }]), 'expanded by default');
const id = (x: string) => `TABLEMANAGER_IDLE_FEED_OFF__TestSequence__${x}`;
const md = open.markdown;
// (the state a box titled with its own name; inside it, its sub-machine's box headed by its method, when it runs under it)
expect(md.includes('state "TABLEMANAGER_IDLE_FEED_OFF" as TABLEMANAGER_IDLE_FEED_OFF {') && md.includes(`state "TestSequence<br/><span class='node-desc'>while cmd_bTestMode</span>" as TABLEMANAGER_IDLE_FEED_OFF__TestSequence {`) && !md.includes('⊟'), 'expanded: the state a box, its sub-machine a box of its own inside it, headed by its method');
expect(md.includes(`[*] --> ${id('INIT')}: ↑ cmd_bTestMode`) && md.includes(`state "WAITING" as ${id('WAITING')}`) && md.includes(`${id('WAITING')} --> ${id('RUNNING')}: cmd_bTestStart`), 'its states by their own names, its entry labelled, its transitions');
expect(md.includes(`state "UNUSED<br/><span class='node-desc'>never reached</span>" as ${id('UNUSED')}`) && md.includes(`class ${id('UNUSED')} kssUnreachable`) && /classDef kssUnreachable/.test(md), 'never reached: said, dashed');
// (the state's own transitions still drawn, from its box; the composites' list unchanged)
expect(collapsed.edges.filter((e) => e.from === 'TABLEMANAGER_IDLE_FEED_OFF').length === open.edges.filter((e) => e.from === 'TABLEMANAGER_IDLE_FEED_OFF').length && open.edges.length > 10, 'its own transitions the same');
expect(JSON.stringify(Object.keys(open.composites)) === JSON.stringify(Object.keys(collapsed.composites)), 'the enum\'s composites unchanged');
// Flowchart: a subgraph titled with it
const flow = generateStatechartModel(dut, pou, { flowchartOutput: true }).markdown;
expect(flow.includes(`subgraph TABLEMANAGER_IDLE_FEED_OFF__TestSequence["TestSequence<br/><span class='node-desc'>while cmd_bTestMode</span>"]`) && flow.includes(`${id('RUNNING')}["RUNNING"]`) && flow.includes(`-->|"↑ cmd_bTestMode"| ${id('INIT')}`), 'flowchart: its subgraph headed by its method, the entry labelled');

// Go to code: its states and transitions in its method (its entry: where its start is set)
expect(JSON.stringify(subMachineId(pou, id('RUNNING'))) === JSON.stringify({ parent: 'TABLEMANAGER_IDLE_FEED_OFF', method: 'TestSequence', name: 'RUNNING' }) && subMachineId(pou, 'TABLEMANAGER_IDLE_FEED_OFF') === null, 'its ids: the state, the method, its name');
const st = locateState(pou, id('RUNNING'));
expect(st?.method === 'TestSequence' && st.text === 'E_TEST_SEQ.RUNNING:', `its state: ${JSON.stringify(st)}`);
const tr = locateTransition(pou, { from: id('WAITING'), to: id('RUNNING'), label: 'cmd_bTestStart' });
expect(tr?.method === 'TestSequence' && tr.text === 'eTestState := E_TEST_SEQ.RUNNING;' && tr.line === 9, `its transition: ${JSON.stringify(tr)}`);
const back = locateTransition(pou, { from: id('RUNNING'), to: id('WAITING'), label: 'tonStep.Q' });
expect(back?.text === 'eTestState := E_TEST_SEQ.WAITING;' && back.line === 15, `another: ${JSON.stringify(back)}`);
const entry = locateTransition(pou, { from: '[*]', to: id('INIT'), label: '↑ cmd_bTestMode' });
expect(entry?.method === 'TestSequence' && entry.text === 'eTestState := E_TEST_SEQ.INIT;' && entry.line === 2, `its entry: ${JSON.stringify(entry)}`);

// Priorities: a sub-machine's state with several transitions has them numbered (their order in its branch), and
// reordered in its method
const two = pou.replace('\t\t\tIF (cmd_bTestStart) THEN\n', '\t\t\tIF (cmd_bTestAbort) THEN\n\t\t\t\teTestState := E_TEST_SEQ.INIT;\n\t\t\tEND_IF\n\t\t\tIF (cmd_bTestStart) THEN\n');
expect(two !== pou, 'a second transition out of WAITING');
const twoMd = generateStatechartModel(dut, two, {}).markdown;
expect(twoMd.includes(`${id('WAITING')} --> ${id('INIT')}: ① cmd_bTestAbort`) && twoMd.includes(`${id('WAITING')} --> ${id('RUNNING')}: ② cmd_bTestStart`) && twoMd.includes(`${id('RUNNING')} --> ${id('WAITING')}: tonStep.Q`), 'numbered when their state has several: ① ②, a single one not');
expect(generateStatechartModel(dut, two, { priorityFormat: 'bracket' }).markdown.includes(': [2] cmd_bTestStart') && !generateStatechartModel(dut, two, { showTransitionPriorities: false }).markdown.includes('② cmd_bTestStart'), 'in the chosen format; none when priorities are off');
const ord = transitionOrder(two, { from: 'WAITING', to: 'RUNNING', label: 'cmd_bTestStart' }, 'eTestState', 'TestSequence');
expect(!('error' in ord) && ord.priority === 2 && ord.count === 2, `its order in its method: ${JSON.stringify(ord)}`);
const raised = setTransitionPriority(two, { from: 'WAITING', to: 'RUNNING', label: 'cmd_bTestStart' }, 1, 'eTestState', 'TestSequence');
expect(!('error' in raised) && raised.method === 'TestSequence' && raised.code.indexOf('cmd_bTestStart') < raised.code.indexOf('cmd_bTestAbort'), `raised: checked first in its method (${'error' in raised ? raised.error : raised.message})`);

// The heat map and the statistics: its states with their own code (their branch in its method)
const heat = calculateStateComplexityHeatmap(extractStateNodesFromMermaid(twoMd), extractEdgesFromMermaid(twoMd), two);
const hw = heat.metrics.get(id('WAITING'));
const hi = heat.metrics.get(id('INIT'));
expect(!!hw && hw.outgoingTransitionsCount === 2 && hw.internalDecisionsCount >= 2 && hw.hasCaseBranch && hw.score > (hi?.score ?? 99), `WAITING scored from its branch: ${JSON.stringify(hw && { out: hw.outgoingTransitionsCount, dec: hw.internalDecisionsCount, score: hw.score, branch: hw.hasCaseBranch })} (INIT ${hi?.score})`);
expect(heat.metrics.has(id('RUNNING')) && heat.metrics.has('TABLEMANAGER_IDLE_FEED_OFF'), 'its states and the state itself in the heat map');
// (the state's label, its popups' header: the same expanded or collapsed, not its box's "· while …")
const labelOf = (md: string) => extractStateNodesFromMermaid(md).find((s) => s.id === 'TABLEMANAGER_IDLE_FEED_OFF')?.label;
const collapsedMd = generateStatechartModel(dut, two, { collapsedComposites: ['-TABLEMANAGER_IDLE_FEED_OFF'] }).markdown;
const text = (l?: string) => (l ?? '').replace(/<[^>]+>/g, '');
expect(text(labelOf(twoMd)) === text(labelOf(collapsedMd)) && /⊞ TestSequence/.test(labelOf(twoMd) ?? '') && !/while/.test(labelOf(twoMd) ?? ''), `its label: "${labelOf(twoMd)}" expanded, "${labelOf(collapsedMd)}" collapsed`);
expect(!extractStateNodesFromMermaid(twoMd).some((s) => s.id === 'TABLEMANAGER_IDLE_FEED_OFF__TestSequence') && !extractStateNodesFromMermaid(generateStatechartModel(dut, two, { flowchartOutput: true }).markdown).some((s) => s.id === 'TABLEMANAGER_IDLE_FEED_OFF__TestSequence'), 'its box: no state of its own');

// Not a sub-machine: a method without a state machine; a member's method
const noMachine = pou.replace(/eTestState := E_TEST_SEQ\.(WAITING|RUNNING);/g, ';');
expect(subMachinesOf(noMachine).length === 0, 'a method whose CASE never changes its state: none');
const memberCall = pou.replace('TestSequence(rtrigTestMode.Q);', 'fbOther.TestSequence(rtrigTestMode.Q);');
expect(subMachinesOf(memberCall).length === 0, 'another FB\'s method of the same name: none');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

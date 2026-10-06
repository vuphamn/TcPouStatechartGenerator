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
expect(JSON.stringify(found) === JSON.stringify([{ parent: 'TABLEMANAGER_IDLE_FEED_OFF', method: 'TestSequence', states: ['INIT', 'WAITING', 'RUNNING', 'UNUSED'] }]), `found: ${JSON.stringify(found)}`);
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
// (the title wrapped as descriptions are)
expect(/state "TABLEMANAGER_IDLE_FEED_OFF<br\/><span class='node-desc'>⊟ TestSequence · while(?: |<br\/>)cmd_bTestMode<\/span>" as TABLEMANAGER_IDLE_FEED_OFF \{/.test(md), 'expanded: the state a box, titled with it');
expect(md.includes(`[*] --> ${id('INIT')}: ↑ cmd_bTestMode`) && md.includes(`state "WAITING" as ${id('WAITING')}`) && md.includes(`${id('WAITING')} --> ${id('RUNNING')}: cmd_bTestStart`), 'its states by their own names, its entry labelled, its transitions');
expect(md.includes(`state "UNUSED<br/><span class='node-desc'>never reached</span>" as ${id('UNUSED')}`) && md.includes(`class ${id('UNUSED')} kssUnreachable`) && /classDef kssUnreachable/.test(md), 'never reached: said, dashed');
// (the state's own transitions still drawn, from its box; the composites' list unchanged)
expect(collapsed.edges.filter((e) => e.from === 'TABLEMANAGER_IDLE_FEED_OFF').length === open.edges.filter((e) => e.from === 'TABLEMANAGER_IDLE_FEED_OFF').length && open.edges.length > 10, 'its own transitions the same');
expect(JSON.stringify(Object.keys(open.composites)) === JSON.stringify(Object.keys(collapsed.composites)), 'the enum\'s composites unchanged');
// Flowchart: a subgraph titled with it
const flow = generateStatechartModel(dut, pou, { flowchartOutput: true }).markdown;
expect(flow.includes('["TestSequence · while cmd_bTestMode"]') && flow.includes(`${id('RUNNING')}["RUNNING"]`) && flow.includes(`-->|"↑ cmd_bTestMode"| ${id('INIT')}`), 'flowchart: a subgraph titled with it, the entry labelled');

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

// Not a sub-machine: a method without a state machine; a member's method
const noMachine = pou.replace(/eTestState := E_TEST_SEQ\.(WAITING|RUNNING);/g, ';');
expect(subMachinesOf(noMachine).length === 0, 'a method whose CASE never changes its state: none');
const memberCall = pou.replace('TestSequence(rtrigTestMode.Q);', 'fbOther.TestSequence(rtrigTestMode.Q);');
expect(subMachinesOf(memberCall).length === 0, 'another FB\'s method of the same name: none');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

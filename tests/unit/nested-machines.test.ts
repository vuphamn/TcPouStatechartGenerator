// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Nested CASEs and nested sub-machines. A CASE inside a state's branch (on a step number, not the states): its arms
// guard what is under them as an IF's would ("iStep = 1 AND cmd_bA"; a range, several labels, its ELSE), in doState()
// and in a sub-machine's method. A label, its IF and its assignment on one line ("1: IF a THEN x := B; END_IF") read
// as on their own lines: guarded, and the IF closed there. A sub-machine's state that calls another method with a state
// machine of its own: that one inside it (<state>__<method>__<name>__<method>__<name>), drawn in a box in its box,
// collapsed on its own ("-<its state's id>"), found by Go to code, scored by the heat map
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel, subMachinesOf } from '../../src/generator.ts';
import { locateState, locateTransition, subMachineId } from '../../src/utils/sourceLocation.ts';
import { calculateStateComplexityHeatmap } from '../../src/utils/complexityHeatmap.ts';
import { extractStateNodesFromMermaid } from '../../src/utils/nodeStyles.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { splitStatements } from '../../src/utils/stStatements.ts';
import { moveTransitionStart } from '../../src/utils/transitionEdits.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const sample = SAMPLES.find((s) => s.id === 'table-manager-202')!;
const dut = sample.dutContent;
const S = 'TABLEMANAGER_IDLE_FEED_OFF';
const at = (body: string) => sample.pouContent.replace(/(\tTABLEMANAGER_IDLE_FEED_OFF:\r?\n)/, `$1${body}`);
const out = (pou: string) => generateStatechartModel(dut, pou, { showTransitionPriorities: false }).edges.filter((e) => e.from === S);
const guardTo = (pou: string, to: string) => out(pou).filter((e) => e.to === to).map((e) => e.label ?? '');

// 1. Statements split
expect(JSON.stringify(splitStatements('1: IF a THEN x := B; END_IF')) === JSON.stringify(['1:', 'IF a THEN', 'x := B;', 'END_IF']), `split: ${JSON.stringify(splitStatements('1: IF a THEN x := B; END_IF'))}`);
expect(JSON.stringify(splitStatements('ELSE x := 1;')) === JSON.stringify(['ELSE', 'x := 1;']), 'split: ELSE and its code');
expect(JSON.stringify(splitStatements('fb(IN := TRUE, PT := T#2S);')) === JSON.stringify(['fb(IN := TRUE, PT := T#2S);']), 'split: a call with named arguments stays one');

// 2. doState(): a nested CASE's arms guard what is under them
const E = 'E_TableManager_States';
const nested = at(`\t\tCASE iStep OF
\t\t\t1:
\t\t\t\tIF cmd_bA THEN
\t\t\t\t\tmachineState := ${E}.TABLEMANAGER_ERROR;
\t\t\t\tEND_IF
\t\t\t2, 4:
\t\t\t\tmachineState := ${E}.TABLEMANAGER_HOMMING;
\t\t\t5..7:
\t\t\t\tmachineState := ${E}.TABLEMANAGER_CLAMPED;
\t\t\tELSE
\t\t\t\tmachineState := ${E}.TABLEMANAGER_UNCLAMPING;
\t\tEND_CASE
`);
const err = guardTo(nested, 'TABLEMANAGER_ERROR')[0] ?? '';
expect(/iStep = 1/.test(err) && /cmd_bA/.test(err), `nested CASE: its arm and the IF in it (${err})`);
const hom = guardTo(nested, 'TABLEMANAGER_HOMMING')[0] ?? '';
expect(/iStep = 2 OR iStep = 4/.test(hom), `several labels: either (${hom})`);
const clamped = guardTo(nested, 'TABLEMANAGER_CLAMPED')[0] ?? '';
expect(/iStep >= 5 AND iStep <= 7/.test(clamped), `a range (${clamped})`);
const unc = guardTo(nested, 'TABLEMANAGER_UNCLAMPING')[0] ?? '';
expect(unc.trim() === 'NOT (iStep = 1 OR (iStep = 2 OR iStep = 4) OR (iStep >= 5 AND iStep <= 7))', `its ELSE: none of its arms (${unc})`);
// (after END_CASE: the state's own transitions as before, not guarded by an arm)
const after = guardTo(nested, 'TABLEMANAGER_AUTOFEED_INIT')[0] ?? '';
expect(!/iStep/.test(after) && /cmd_eFeedMode/.test(after), `after END_CASE: no arm in the guard (${after})`);

// 3. One line: a label, its IF and its assignment
const oneLine = at(`\t\tCASE iStep OF
\t\t\t1: IF cmd_bA THEN machineState := ${E}.TABLEMANAGER_ERROR; END_IF
\t\tEND_CASE
\t\tIF cmd_bB THEN machineState := ${E}.TABLEMANAGER_HOMMING; END_IF
`);
const e1 = guardTo(oneLine, 'TABLEMANAGER_ERROR')[0] ?? '';
const h1 = guardTo(oneLine, 'TABLEMANAGER_HOMMING')[0] ?? '';
expect(/iStep = 1/.test(e1) && /cmd_bA/.test(e1), `"1: IF … END_IF" on one line: guarded (${e1})`);
expect(h1.trim() === 'cmd_bB', `a one-line IF closed there: the next one not under it (${h1})`);
const a1 = guardTo(oneLine, 'TABLEMANAGER_AUTOFEED_INIT')[0] ?? '';
expect(!/cmd_bB|cmd_bA/.test(a1), `the state's own transitions after them: not under them (${a1})`);

// 4. Nested sub-machines
const method = (name: string, id: string, decl: string, body: string) => `    <Method Name="${name}" Id="{${id}}">
      <Declaration><![CDATA[METHOD ${name}
${decl}]]></Declaration>
      <Implementation>
        <ST><![CDATA[${body}]]></ST>
      </Implementation>
    </Method>
`;
const OUTER = method('Outer', '11111111-2222-3333-4444-555555555501', 'VAR_INST\n\teOuter\t: E_OUTER;\nEND_VAR\n', `CASE eOuter OF
	E_OUTER.A:
		IF cmd_bGo THEN
			eOuter := E_OUTER.B;
		END_IF
	E_OUTER.B:
		IF cmd_bInner THEN
			Inner();
		END_IF
		CASE iSub OF
			1: IF cmd_bBack THEN eOuter := E_OUTER.A; END_IF
		END_CASE
END_CASE`);
const INNER = method('Inner', '11111111-2222-3333-4444-555555555502', 'VAR_INST\n\teInner\t: E_INNER;\nEND_VAR\n', `CASE eInner OF
	E_INNER.X:
		eInner := E_INNER.Y;
	E_INNER.Y:
		IF cmd_bZ THEN
			eInner := E_INNER.X;
		END_IF
END_CASE`);
const pou = at(`\t\tOuter();\n`).replace('</POU>', `${OUTER}${INNER}  </POU>`);
const found = subMachinesOf(pou);
const B = `${S}__Outer__B`;
expect(found.map((m) => `${m.parent}/${m.method}`).join(' ') === `${S}/Outer ${B}/Inner`, `found: Outer in ${S}, Inner in its state B (${found.map((m) => `${m.parent}/${m.method}`).join(' ')})`);
const inner = found.find((m) => m.method === 'Inner');
expect(inner?.when === 'cmd_bInner' && inner.states.join() === 'X,Y' && inner.variableType === 'E_INNER', `Inner: runs while cmd_bInner, its states, its enum (${JSON.stringify(inner && { when: inner.when, states: inner.states, type: inner.variableType })})`);
const outer = found.find((m) => m.method === 'Outer');
const back = outer?.transitions.find((t) => t.to === 'A');
expect(!!back && /iSub = 1/.test(back.guard ?? '') && /cmd_bBack/.test(back.guard ?? ''), `in a sub-machine: a nested CASE's arm and a one-line IF guard its transition (${back?.guard})`);
// (the chart: Inner's box inside B, inside Outer's box, inside the state)
const md = generateStatechartModel(dut, pou, {}).markdown;
const X = `${B}__Inner__X`;
expect(md.includes(`state "B" as ${B} {`) && md.includes(`state "Inner<br/><span class='node-desc'>while cmd_bInner</span>" as ${B}__Inner {`) && md.includes(`state "X" as ${X}`) && md.includes(`${X} --> ${B}__Inner__Y`), 'stateDiagram: B a box, Inner\'s box in it, its states');
const flow = generateStatechartModel(dut, pou, { flowchartOutput: true }).markdown;
expect(flow.includes(`subgraph ${B}["B"]`) && flow.includes(`subgraph ${B}__Inner[`) && flow.includes(`${X}["X"]`), 'flowchart: the same');
// (collapsed on its own: B's label says so; the outer one collapsed: neither drawn)
const c1 = generateStatechartModel(dut, pou, { collapsedComposites: [`-${B}`] }).markdown;
expect(!c1.includes(X) && c1.includes(`state "B<br/><span class='node-desc'>⊞ Inner</span>" as ${B}`), 'Inner collapsed: B one state, its label says so');
const c2 = generateStatechartModel(dut, pou, { collapsedComposites: [`-${S}`] }).markdown;
expect(!c2.includes(B) && !c2.includes(X), 'Outer collapsed: neither drawn');
// (ids, Go to code)
expect(JSON.stringify(subMachineId(pou, X)) === JSON.stringify({ parent: B, method: 'Inner', name: 'X' }), `its id: ${JSON.stringify(subMachineId(pou, X))}`);
const ls = locateState(pou, `${B}__Inner__Y`);
expect(ls?.method === 'Inner' && ls.text === 'E_INNER.Y:', `Go to code, its state: ${JSON.stringify(ls)}`);
const lt = locateTransition(pou, { from: `${B}__Inner__Y`, to: X, label: 'cmd_bZ' });
expect(lt?.method === 'Inner' && lt.text === 'eInner := E_INNER.X;', `Go to code, its transition: ${JSON.stringify(lt)}`);
// (the heat map: its states scored from their branch of Inner)
const heat = calculateStateComplexityHeatmap(extractStateNodesFromMermaid(md), extractEdgesFromMermaid(md), pou);
expect(!!heat.metrics.get(`${B}__Inner__Y`)?.hasCaseBranch && !heat.metrics.has(`${B}__Inner`), 'heat map: its states scored, its box no state');
// (a method calling itself: not one again)
const self = pou.replace(`E_INNER.X:\n\t\teInner := E_INNER.Y;`, `E_INNER.X:\n\t\tInner();\n\t\teInner := E_INNER.Y;`);
expect(subMachinesOf(self).length === 2, `a method calling itself: not nested again (${subMachinesOf(self).length})`);

// 5. The K-Test Station sample: CALIBRATING calls Calibrate(), whose CAL_MEASURE calls Measure(); TESTING a nested CASE
const ts = SAMPLES.find((s) => s.id === 'k-test-station')!;
const tsSubs = subMachinesOf(ts.pouContent);
expect(tsSubs.map((m) => `${m.parent}/${m.method}`).join(' ') === 'KTESTSTATION_CALIBRATING/Calibrate KTESTSTATION_CALIBRATING__Calibrate__CAL_MEASURE/Measure', `the sample: its sub-machine and the one inside it (${tsSubs.map((m) => `${m.parent}/${m.method}`).join(' ')})`);
// (choice nodes: the nested CASE's arms as the choice's branches, its ELSE named; the arm holding an IF of two
// transitions: a choice of its own after the arm, the arm's condition on the way)
const choiceLines = generateStatechartModel(ts.dutContent, ts.pouContent, { choiceNodes: true }).markdown.split('\n').filter((l) => /choice_KTESTSTATION_TESTING_\d+ -->/.test(l)).map((l) => l.trim().replace(/choice_KTESTSTATION_TESTING_(\d+)/g, 'c$1').replace(/KTESTSTATION_/g, ''));
const choice = choiceLines.map((l) => l.replace(/^.*?: /, ''));
expect(
  choiceLines.join(' | ') ===
    'c5 --> IDLE: ① (iTestStep = 1) AND else | c5 --> c7: iTestStep = 2 | c7 --> DONE: ② (iTestStep = 2) AND (rMeasured > 10.0) | c7 --> ERROR: ③ (iTestStep = 2) AND (rMeasured < 0.0) | c5 --> ERROR: ④ NOT (iTestStep = 1 OR iTestStep = 2)',
  `choice nodes: TESTING's branches its CASE's arms, arm 2 a choice of its own (${choiceLines.join(' | ')})`
);
// (an IF's arms: no second choice, their guards say it: the Table Manager's choices as before)
const tm = SAMPLES.find((s) => s.id === 'table-manager-202')!;
const tmMd = generateStatechartModel(tm.dutContent, tm.pouContent, { choiceNodes: true }).markdown;
const chained = tmMd.match(/choice_\w+ --> choice_\w+/g) ?? [];
expect(/<<choice>>/.test(tmMd) && chained.length === 0, `an IF's arms: no second choices (the Table Manager: ${chained.length} choice into a choice)`);
// (the option "ELSE as condition": an IF's ELSE written out; off: "else")
const spelled = generateStatechartModel(ts.dutContent, ts.pouContent, { choiceNodes: true, spellOutElse: true }).markdown.split('\n').find((l) => /choice_KTESTSTATION_TESTING_\d+ --> KTESTSTATION_IDLE/.test(l)) ?? '';
expect(/\(iTestStep = 1\) AND NOT \(di_bPartPresent\)/.test(spelled) && choice[0].includes('AND else'), `ELSE as condition: an IF's ELSE written out (${spelled.replace(/^.*?: /, '')}); off: else`);
// (Move start out of a CASE arm: kept under the arm's condition)
const moved = moveTransitionStart(ts.pouContent, { from: 'KTESTSTATION_TESTING', to: 'KTESTSTATION_DONE', label: '(iTestStep = 2) AND (rMeasured > 10.0)' }, 'KTESTSTATION_IDLE', 'machineState');
const movedCode = 'error' in moved ? moved.error : moved.code.replace(/\s+/g, ' ');
expect(!('error' in moved) && /KTESTSTATION_IDLE:.*IF iTestStep = 2 THEN IF \(rMeasured > 10\.0\) THEN machineState := KTESTSTATION_DONE; END_IF END_IF/.test(movedCode), `Move start out of a CASE arm: under IF iTestStep = 2 (${'error' in moved ? moved.error : moved.message})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A POU whose state machine is in its body (FB_TestCycle: CASE State OF in its own code, no method): found (the POU's
// name stands for the body), its chart, identified states, the Method Editor's doState() reading and saving the body,
// line counts / Go to code, the checks; a method with such a CASE still wins, and an INT CASE in a body is none
import { generateStatechartModel } from '../../src/generator.ts';
import { isBodyMethod, stateMethodName, stateEnumTypeOf } from '../../src/utils/stateMethod.ts';
import { getMethodCodeFromPou, updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { declarationLineCount, implementationLineCount, lintStateMachine, stateAtLine } from '../../src/utils/stateMachineLint.ts';
import { methodLines } from '../../src/utils/sourceLocation.ts';
import { hasOwnMethod } from '../../src/utils/pouInheritance.ts';
import { getPouBody } from '../../src/utils/pouBody.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const decl = `FUNCTION_BLOCK FB_TestCycle
VAR_INPUT
	bStart : BOOL;
END_VAR
VAR_OUTPUT
	bBusy : BOOL;
	nCycles : INT;
END_VAR
VAR
	State : E_TestState := E_TestState.Idle;
	tonRun : TON;
END_VAR
`;
const body = `CASE State OF
	E_TestState.Idle:
		bBusy := FALSE;
		IF bStart THEN
			State := E_TestState.Running;
		END_IF
	E_TestState.Running:
		bBusy := TRUE;
		tonRun(IN := TRUE, PT := T#2S);
		IF tonRun.Q THEN
			tonRun(IN := FALSE);
			nCycles := nCycles + 1;
			State := E_TestState.Done;
		END_IF
	E_TestState.Done:
		IF NOT bStart THEN
			State := E_TestState.Idle;
		END_IF
END_CASE
`;
const pouOf = (d: string, b: string, methods = '') => `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_TestCycle" Id="{e1fe9245-b7d1-4f02-9468-a8049ecd6f04}" SpecialFunc="None">
    <Declaration><![CDATA[${d}]]></Declaration>
    <Implementation>
      <ST><![CDATA[${b}]]></ST>
    </Implementation>${methods}
  </POU>
</TcPlcObject>`;
const pou = pouOf(decl, body);
const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="E_TestState" Id="{b8a9e7a5-0f0e-4a43-9d0e-6f6a7b1c2d3e}">
    <Declaration><![CDATA[TYPE E_TestState :
(
	Idle := 0,
	Running,
	Done
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`;

// Found: the POU's name for its body
expect(stateMethodName(pou) === 'FB_TestCycle', `the state method: the body, by the POU's name (${stateMethodName(pou)})`);
expect(isBodyMethod(pou, 'FB_TestCycle') && isBodyMethod(pou, 'FB_TestCycle()') && !isBodyMethod(pou, 'Execute'), 'isBodyMethod: the POU name only');
expect(stateEnumTypeOf(pou) === 'E_TestState', `the state enum: E_TestState (${stateEnumTypeOf(pou)})`);
expect(hasOwnMethod(pou, 'doState'), 'the body is the POU\'s own');

// The chart
const model = generateStatechartModel(dut, pou, {});
const pairs = model.edges.flatMap((e) => (e.members.length ? e.members : [{ from: e.from, to: e.to }])).map((t) => `${t.from}->${t.to}`);
expect(['Idle->Running', 'Running->Done', 'Done->Idle'].every((w) => pairs.includes(w)), `the transitions: ${pairs.join(', ')}`);

// Identified states
const ids = extractIdentifiedStatesFromPou(pou, dut);
expect(ids.stateVarName === 'State' && ['Idle', 'Running', 'Done'].every((s) => ids.states.some((x) => x.id === s)), `the states (${ids.stateVarName}: ${ids.states.map((s) => s.id).join(', ')})`);

// The Method Editor: doState() asked → the body and the POU's declaration; saved back into the body
const code = getMethodCodeFromPou(pou, 'doState');
expect(code.methodFound && code.methodName === 'FB_TestCycle' && /CASE State OF/.test(code.code) && /FUNCTION_BLOCK FB_TestCycle/.test(code.declaration), `doState() asked: the body (${code.methodName})`);
const edited = updateMethodCodeInPou(pou, 'doState', code.code.replace('nCycles + 1', 'nCycles + 2'));
const after = getPouBody(edited.updatedPou);
expect(edited.success && /nCycles \+ 2/.test(after.implementation) && after.declaration === decl && !/<Method\b/.test(edited.updatedPou), 'an edit: written into the body, the declaration kept, no method added');
expect(/Id="\{e1fe9245-b7d1-4f02-9468-a8049ecd6f04\}"/.test(edited.updatedPou), 'the POU\'s GUID kept');
const withDecl = updateMethodCodeInPou(pou, 'FB_TestCycle', body, decl.replace('tonRun : TON;', 'tonRun : TON;\n\tnSpare : INT;'));
expect(withDecl.success && /nSpare : INT/.test(getPouBody(withDecl.updatedPou).declaration), 'a declaration edit: into the POU\'s declaration');

// Lines: Go to code / the XAE editor's offsets
expect(methodLines(pou, 'doState')?.[0] === 'CASE State OF', 'methodLines: the body');
expect(implementationLineCount(pou, 'doState') === body.split('\n').length, `implementationLineCount: the body's (${implementationLineCount(pou, 'doState')})`);
expect(declarationLineCount(pou, 'doState') === decl.split('\n').length, `declarationLineCount: the POU's declaration (${declarationLineCount(pou, 'doState')})`);
expect(stateAtLine(pou, 9) === 'E_TestState.Running' || stateAtLine(pou, 9) === 'Running', `stateAtLine: line 9 in Running (${stateAtLine(pou, 9)})`);

// The checks: on the body's CASE, findings named by the POU
const noBranch = lintStateMachine(pou, dut.replace('\tDone\n', '\tDone,\n\tParked\n'), []);
const parked = noBranch.find((f) => /Parked/.test(f.message));
expect(!!parked, `an enum member without a branch: said (${parked?.message ?? 'not said'})`);
const all = lintStateMachine(pou, dut, []);
expect(all.filter((f) => f.line).every((f) => f.method === 'FB_TestCycle'), `findings with lines name the body (${all.map((f) => `${f.rule}@${f.method}`).join(', ')})`);

// A method with such a CASE wins; an INT CASE in a body is none
const withMethod = pouOf(decl, 'Execute();\n', `
    <Method Name="Execute" Id="{0b7d9d8e-1a2b-4c3d-8e9f-a0b1c2d3e4f5}">
      <Declaration><![CDATA[METHOD Execute
]]></Declaration>
      <Implementation>
        <ST><![CDATA[${body}]]></ST>
      </Implementation>
    </Method>`);
expect(stateMethodName(withMethod) === 'Execute', `a method with the CASE: it (${stateMethodName(withMethod)})`);
const intCase = pouOf(decl.replace('State : E_TestState := E_TestState.Idle;', 'State : INT;'), 'CASE State OF\n\t0:\n\t\tState := 1;\n\t1:\n\t\tState := 0;\nEND_CASE\n');
expect(stateMethodName(intCase) === 'doState', `an INT CASE in the body: none (${stateMethodName(intCase)})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

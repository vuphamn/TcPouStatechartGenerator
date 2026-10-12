// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The Problems tab with another company's POU (its state machine in Execute() on CASE State OF, not Kval's doState()):
// its findings name Execute(), never doState(); the rules' descriptions said with it (withStateMethod); a Kval POU's
// still say doState()
import { lintStateMachine, LINT_RULES } from '../../src/utils/stateMachineLint.ts';
import { stateMethodText, withStateMethod } from '../../src/utils/stateMethod.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const pou = (decl: string, methods: string) => `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_Scan" Id="{1}" SpecialFunc="None">
    <Declaration><![CDATA[${decl}]]></Declaration>
    <Implementation>
      <ST><![CDATA[Execute();]]></ST>
    </Implementation>${methods}
  </POU>
</TcPlcObject>`;
const method = (name: string, code: string) => `\n    <Method Name="${name}" Id="{2}">\n      <Declaration><![CDATA[METHOD ${name}]]></Declaration>\n      <Implementation>\n        <ST><![CDATA[${code}]]></ST>\n      </Implementation>\n    </Method>`;
const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <DUT Name="E_Scan" Id="{3}">
    <Declaration><![CDATA[TYPE E_Scan :
(
	Idle,
	Moving,
	Done
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`;

const other = pou('FUNCTION_BLOCK FB_Scan\nVAR\n\tState : E_Scan;\n\tbGo : BOOL;\nEND_VAR', method('Execute', 'CASE State OF\n\tE_Scan.Idle:\n\t\tIF bGo THEN\n\t\t\tState := E_Scan.Moving;\n\t\tEND_IF\n\tE_Scan.Idle:\n\t\t;\nEND_CASE'));
expect(stateMethodText(other) === 'Execute()', `its state method: ${stateMethodText(other)}`);
const findings = lintStateMachine(other, dut);
const texts = findings.map((f) => f.message);
expect(findings.length > 0 && texts.every((t) => !/doState/.test(t)), `its findings never say doState: ${texts.join(' | ')}`);
expect(texts.some((t) => /Moving is entered but Execute\(\) has no branch for it/.test(t)), 'a state entered without a branch: Execute() has none');
expect(texts.some((t) => /Idle has another branch at Execute\(\) line/.test(t)), 'a second branch: at Execute() line …');
expect(withStateMethod(LINT_RULES['missing-branch'].description, 'Execute()') === 'A state is entered, but Execute() has no branch for it, so nothing runs while in it.', 'a rule\'s description, with the POU\'s state method');

const kval = pou('FUNCTION_BLOCK FB_Scan EXTENDS KvalStateMachineBase\nVAR\nEND_VAR', method('doState', 'CASE machineState OF\n\tE_Scan.Idle:\n\t\tmachineState := E_Scan.Moving;\nEND_CASE'));
expect(stateMethodText(kval) === 'doState()' && lintStateMachine(kval, dut).some((f) => /doState\(\) has no branch/.test(f.message)), "a Kval POU's: doState()");

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

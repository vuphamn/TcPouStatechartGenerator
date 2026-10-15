// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// State names from a PLC project's sources (shared/enumFromSources.cjs: the operator board's machines whose state
// variable the PLC knows as an INT only, as Kval's KvalStateMachineBase.machineState): each type's enum found from its
// CASE labels or assignments (qualified or not, CASE (machineState) OF too), through its base type; its values read as
// the app reads them (implicit, := 16#…, comments)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { stateNamesFromSources, enumValues } = require('../../shared/enumFromSources.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const pou = (name: string, decl: string, st: string) => ({ path: `POUs/${name}.TcPOU`, content: `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject>\n  <POU Name="${name}" Id="{1}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n    <Implementation>\n      <ST><![CDATA[${st}]]></ST>\n    </Implementation>\n  </POU>\n</TcPlcObject>` });
const dut = (name: string, decl: string) => ({ path: `DUTs/${name}.TcDUT`, content: `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject>\n  <DUT Name="${name}" Id="{2}">\n    <Declaration><![CDATA[${decl}]]></Declaration>\n  </DUT>\n</TcPlcObject>` });

// ---- An enum's values ----
const e1 = enumValues(dut('E_A', `{attribute 'qualified_only'}\nTYPE E_A :\n(\n\tA_DISABLED, // off\n\tA_IDLE := 5, (* waiting *)\n\tA_RUN,\n\tA_ERROR := 16#10\n) INT;\nEND_TYPE`).content);
expect(JSON.stringify(e1) === '{"0":"A_DISABLED","5":"A_IDLE","6":"A_RUN","16":"A_ERROR"}', `its values (implicit, := 5, 16#10, comments): ${JSON.stringify(e1)}`);
expect(JSON.stringify(enumValues(dut('ST_X', 'TYPE ST_X :\nSTRUCT\n\tn : INT;\nEND_STRUCT\nEND_TYPE').content)) === '{}', 'a structure: none');

// ---- The machines' types ----
const files = [
  // (qualified labels)
  pou('SM_Qualified', 'FUNCTION_BLOCK SM_Qualified EXTENDS KvalStateMachineBase', 'CASE machineState OF\n\tE_A.A_DISABLED:\n\t\tmachineState := E_A.A_IDLE;\n\tE_A.A_IDLE:\n\t\t;\nEND_CASE'),
  // (Kval's: unqualified members, CASE (machineState) OF; a comment naming another enum's member)
  pou('SM_BallCatch', 'FUNCTION_BLOCK SM_BallCatch EXTENDS KvalStateMachineBase', '// machineState := A_RUN;\nCASE (machineState) OF\n\tBALLCATCH_DISABLED:\n\t\tmachineState := BALLCATCH_RESET;\n\tBALLCATCH_RESET, BALLCATCH_IDLE:\n\t\tmachineState := BALLCATCH_IDLE;\nEND_CASE'),
  dut('E_BallCatch_States', 'TYPE E_BallCatch_States :\n(\n\tBALLCATCH_DISABLED,\n\tBALLCATCH_ENABLING,\n\tBALLCATCH_RESET,\n\tBALLCATCH_IDLE\n);\nEND_TYPE'),
  // (no CASE of its own: its base type's)
  pou('SM_Derived', 'FUNCTION_BLOCK PUBLIC SM_Derived EXTENDS SM_Qualified', 'SUPER^();'),
  // (the base: its state variable an INT, no enum of its own)
  pou('KvalStateMachineBase', 'FUNCTION_BLOCK ABSTRACT KvalStateMachineBase\nVAR\n\tmachineState : INT;\nEND_VAR', ''),
  pou('SM_Other', 'FUNCTION_BLOCK SM_Other', 'CASE eStep OF\n\tE_A.A_RUN:\n\t\t;\nEND_CASE'),
  dut('E_A', 'TYPE E_A :\n(\n\tA_DISABLED,\n\tA_IDLE := 5,\n\tA_RUN\n);\nEND_TYPE'),
];
const names = stateNamesFromSources(files, ['SM_Qualified', 'MAIN.SM_BallCatch', 'SM_Derived', 'KvalStateMachineBase', 'SM_Other', 'SM_NotThere']);
expect(names.get('sm_qualified')?.[5] === 'A_IDLE', 'qualified labels: E_A');
expect(JSON.stringify(names.get('sm_ballcatch')) === '{"0":"BALLCATCH_DISABLED","1":"BALLCATCH_ENABLING","2":"BALLCATCH_RESET","3":"BALLCATCH_IDLE"}', `unqualified members, CASE (machineState) OF: ${JSON.stringify(names.get('sm_ballcatch'))}`);
expect(names.get('sm_derived')?.[0] === 'A_DISABLED', 'no CASE of its own: its base type\'s enum');
expect(!names.has('kvalstatemachinebase') && !names.has('sm_other') && !names.has('sm_notthere'), 'an INT base, a CASE on another variable, a type not in the sources: none');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

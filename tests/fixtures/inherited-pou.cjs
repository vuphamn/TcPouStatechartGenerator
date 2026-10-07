// A POU that EXTENDS another without a doState() of its own (tests: pou-inheritance, inherited-pou): SM_Derived
// EXTENDS SM_Base EXTENDS SM_Root. SM_Base's doState() calls a method per state; SM_Derived overrides stIdle() (calling
// SUPER^.stIdle()) and preProcess() (SUPER^.preProcess()); the enum E_St
const method = (name, st) => `    <Method Name="${name}" Id="{${name}}">
      <Declaration><![CDATA[METHOD ${name}
]]></Declaration>
      <Implementation>
        <ST><![CDATA[${st}]]></ST>
      </Implementation>
    </Method>`;
const pou = (name, head, methods) => `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.13">
  <POU Name="${name}" Id="{${name}}" SpecialFunc="None">
    <Declaration><![CDATA[${head}
VAR
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
${methods.join('\n')}
  </POU>
</TcPlcObject>`;

const root = pou('SM_Root', 'FUNCTION_BLOCK ABSTRACT SM_Root', [
  method('doState', ''),
  method('preProcess', 'IF bEnable THEN\n\tmachineState := ST_ENABLING;\nEND_IF'),
]);
const base = pou('SM_Base', 'FUNCTION_BLOCK SM_Base EXTENDS SM_Root', [
  method('doState', 'CASE (machineState) OF\n\tST_ENABLING:\t\tstEnabling();\n\tST_IDLE:\t\t\tstIdle();\n\tST_RUN:\t\t\t\tstRun();\n\tST_ERROR:\t\t\tstError();\nEND_CASE;'),
  method('stEnabling', 'IF bReady THEN\n\tmachineState := ST_IDLE;\nEND_IF'),
  method('stIdle', 'logIt();\nIF cmd_bStart THEN\n\tmachineState := ST_RUN;\nEND_IF'),
  method('stRun', 'IF bDone THEN\n\tmachineState := ST_IDLE;\nELSIF bFault THEN\n\traiseError();\nEND_IF'),
  method('stError', 'IF cmd_bReset THEN\n\tmachineState := ST_IDLE;\nEND_IF'),
  method('raiseError', 'machineState := ST_ERROR;'),
  method('logIt', 'iCount := iCount + 1;'),
  method('preProcess', 'SUPER^.preProcess();\nIF cmd_bAbort THEN\n\tmachineState := ST_ERROR;\nEND_IF'),
]);
const derived = pou('SM_Derived', 'FUNCTION_BLOCK SM_Derived EXTENDS SM_Base', [
  method('stIdle', '// its own first\nIF bJam THEN\n\tmachineState := ST_ERROR;\nELSE\n\tSUPER^.stIdle();\nEND_IF'),
  method('preProcess', 'SUPER^.preProcess();'),
]);
const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.13">
  <DUT Name="E_St" Id="{e}">
    <Declaration><![CDATA[TYPE E_St :
(
	ST_ENABLING := 0,
	ST_IDLE,
	ST_RUN,
	ST_ERROR
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>`;

module.exports = { root, base, derived, dut };

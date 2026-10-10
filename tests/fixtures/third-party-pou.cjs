// A POU written by another company (the shape of one, made up here): its state machine in Execute(), CASE State OF,
// State an enum (E_ScanState, qualified labels); most transitions through helper methods given the next state as a
// parameter (MoveAndAdvance(…, NextState := E_ScanState.X), its call over several lines; AdvanceWhenDone(NextState :=
// …)), which set State := NextState behind their own IF; Start() sets the first state; the enum in another folder.
const dut = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4026.18">
  <DUT Name="E_ScanState" Id="{9b188998-ca21-4869-891a-84dd84e5ca01}">
    <Declaration><![CDATA[{attribute 'qualified_only'}
{attribute 'strict'}
TYPE E_ScanState :
(
	InitializeScan,
	MoveToStart,
	ResetData,
	FastScan,
	ProcessFastScan,
	ComputeResult
);
END_TYPE
]]></Declaration>
  </DUT>
</TcPlcObject>
`;

const pou = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4026.18">
  <POU Name="FB_ScanSequencer" Id="{1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a01}" SpecialFunc="None">
    <Declaration><![CDATA[// Scans a part: moves to the start, scans fast, computes the result. Call Start(), then Execute() every cycle.
FUNCTION_BLOCK FB_ScanSequencer
VAR_OUTPUT
	Busy	: BOOL;
	Done	: BOOL;
	ErrorID	: E_CellError;
	State	: E_ScanState := E_ScanState.InitializeScan;	// read-only in practice
END_VAR
VAR
	_Motion			: I_Motion;
	_SubStarted		: BOOL;
	_Count			: INT;
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
    <Method Name="AdvanceWhenDone" Id="{a67e4c68-6f5a-455f-b4ee-b13a829e6f01}">
      <Declaration><![CDATA[// Moves on to NextState once the robot is at rest. A failed pass never advances.
METHOD PRIVATE AdvanceWhenDone
VAR_INPUT
	NextState	: E_ScanState;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF ErrorID <> E_CellError.None THEN
	RETURN;
END_IF

IF _Motion.RobotState = E_RobotState.Idle THEN
	_SubStarted := FALSE;
	State := NextState;
END_IF]]></ST>
      </Implementation>
    </Method>
    <Method Name="Execute" Id="{7984585b-6abb-428e-9d30-372339334701}">
      <Declaration><![CDATA[// One PLC cycle of the scan. Does nothing unless a scan is running.
METHOD Execute
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF NOT Busy THEN
	RETURN;
END_IF

CASE State OF
	E_ScanState.InitializeScan:
		_SubStarted := FALSE;
		State := E_ScanState.MoveToStart;

	E_ScanState.MoveToStart:
		MoveAndAdvance(ProgramNumber := 3,
					   StartX := 0.0, StartY := 100.0,
					   NextState := E_ScanState.ResetData);

	E_ScanState.ResetData:
		IF _Motion.RobotState = E_RobotState.Idle THEN
			_Count := 0;
			State := E_ScanState.FastScan;
		END_IF

	E_ScanState.FastScan:
		AdvanceWhenDone(NextState := E_ScanState.ProcessFastScan);

	E_ScanState.ProcessFastScan:
		_Count := _Count + 1;
		State := E_ScanState.ComputeResult;

	E_ScanState.ComputeResult:
		Busy := FALSE;
		Done := TRUE;
		State := E_ScanState.InitializeScan;

	ELSE
		ErrorID := E_CellError.UnhandledState;

END_CASE]]></ST>
      </Implementation>
    </Method>
    <Method Name="MoveAndAdvance" Id="{1f36b055-17fa-4703-9754-b416615a7e01}">
      <Declaration><![CDATA[// One fast move; advances State to NextState once the move is done, or latches the move's error.
METHOD PRIVATE MoveAndAdvance
VAR_INPUT
	ProgramNumber	: INT;
	StartX			: REAL;
	StartY			: REAL;
	NextState		: E_ScanState;
END_VAR
VAR
	MoveErrorID		: E_CellError;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF _Motion.StartMove(ProgramNumber := ProgramNumber,
					  StartX := StartX,
					  StartY := StartY,
					  ErrorID => MoveErrorID) THEN
	State := NextState;
ELSIF MoveErrorID <> E_CellError.None THEN
	ErrorID := MoveErrorID;
END_IF]]></ST>
      </Implementation>
    </Method>
    <Method Name="Start" Id="{ef5ee6e3-bb1f-4253-bcce-ac0708545001}">
      <Declaration><![CDATA[// Starts a new scan. Call Execute() every cycle afterwards until Done.
METHOD Start
]]></Declaration>
      <Implementation>
        <ST><![CDATA[Busy := TRUE;
Done := FALSE;
ErrorID := E_CellError.None;
State := E_ScanState.InitializeScan;]]></ST>
      </Implementation>
    </Method>
  </POU>
</TcPlcObject>
`;

module.exports = { pou, dut };

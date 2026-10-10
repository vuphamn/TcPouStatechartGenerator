// Another company's POU (the shape of one, made up here): it EXTENDS a base of its own (not Kval's state machine
// base), its state machine in TrackSample() on CASE Phase OF, Phase an enum declared inline in the POU (no .TcDUT):
// Phase : (Waiting, OffEdge, OnBest, OnLesser) := Waiting; Reset() / Seed() set it from outside the CASE.
// kvalDerived: a Kval POU that EXTENDS its base without a doState() of its own but with a CASE on an enum variable
// it declares (a homing sequence): still Kval's, its state machine the base's doState()
const pou = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4026.18">
  <POU Name="FB_StepTracker" Id="{772388d8-c6cd-43c9-a39b-8ddc09572f01}" SpecialFunc="None">
    <Declaration><![CDATA[(* Finds where a stream of samples steps onto and off the closest plateau seen so far. Feed one
sample per cycle via TrackSample(); call Reset() before a new pass. *)
FUNCTION_BLOCK FB_StepTracker EXTENDS FB_TrackerBase
VAR
	Phase			: (Waiting, OffEdge, OnBest, OnLesser) := Waiting;
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
    <Method Name="Reset" Id="{9898192f-6088-4def-b011-2dc33378d101}">
      <Declaration><![CDATA[METHOD Reset
]]></Declaration>
      <Implementation>
        <ST><![CDATA[SUPER^.Reset();
Phase := Waiting;]]></ST>
      </Implementation>
    </Method>
    <Method Name="Seed" Id="{c75e8f16-5d72-44b5-9505-670d8f7bb701}">
      <Declaration><![CDATA[METHOD Seed
VAR_INPUT
	Value	: REAL;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[SUPER^.Reset();
_Level := Value;
Phase := OnBest;]]></ST>
      </Implementation>
    </Method>
    <Method Name="TrackSample" Id="{86b85a85-e5d1-4133-bcf0-91b8f64d4301}">
      <Declaration><![CDATA[// Feed one sample.
METHOD TrackSample
VAR_INPUT
	Value	: REAL;
END_VAR
]]></Declaration>
      <Implementation>
        <ST><![CDATA[CASE Phase OF
	Waiting:
		Phase := OffEdge;

	OffEdge:
		IF _Prev - Value > MinStep THEN
			_Level := Value;
			IF NOT _HasEntry THEN
				RecordEntry(Value := Value);
				Phase := OnBest;
			ELSE
				Phase := OnLesser;
			END_IF
		END_IF

	OnBest:
		IF Value - _Level > MinStep THEN
			RecordExit(Value := Value);
			Phase := OffEdge;
		END_IF

	OnLesser:
		IF Value - _Level > MinStep THEN
			Phase := OffEdge;
		END_IF
END_CASE

_Prev := Value;]]></ST>
      </Implementation>
    </Method>
  </POU>
</TcPlcObject>
`;

const kvalDerived = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1" ProductVersion="3.1.4024.12">
  <POU Name="SM_HeadX" Id="{11111111-2222-3333-4444-555555555501}" SpecialFunc="None">
    <Declaration><![CDATA[FUNCTION_BLOCK SM_HeadX EXTENDS SM_3AxisHead
VAR
	eHoming	: E_HomingStep;
END_VAR
]]></Declaration>
    <Implementation>
      <ST><![CDATA[]]></ST>
    </Implementation>
    <Method Name="headIdle" Id="{11111111-2222-3333-4444-555555555502}">
      <Declaration><![CDATA[METHOD headIdle
]]></Declaration>
      <Implementation>
        <ST><![CDATA[IF bStart THEN
	machineState := HEAD_RUN;
END_IF]]></ST>
      </Implementation>
    </Method>
    <Method Name="homing" Id="{11111111-2222-3333-4444-555555555503}">
      <Declaration><![CDATA[METHOD homing
]]></Declaration>
      <Implementation>
        <ST><![CDATA[CASE eHoming OF
	E_HomingStep.MOVE_UP:
		eHoming := E_HomingStep.MOVE_HOME;
	E_HomingStep.MOVE_HOME:
		eHoming := E_HomingStep.DONE;
	E_HomingStep.DONE:
		;
END_CASE]]></ST>
      </Implementation>
    </Method>
  </POU>
</TcPlcObject>
`;

module.exports = { pou, kvalDerived };

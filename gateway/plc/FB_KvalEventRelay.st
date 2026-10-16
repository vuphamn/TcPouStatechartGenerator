// Kval MachineScope: the TwinCAT EventLogger, live, for the gateway (its event log, its fault records, its alerts).
//
// In your PLC project:
//   1. References: add Tc3_EventLogger (>= v3.1.27.0; TwinCAT 3.1.4024.17 or newer).
//   2. DUTs: add a structure ST_KvalEvent, its declaration below.
//   3. POUs: add a function block FB_KvalEventRelay, its declaration below; then its methods, each with its
//      declaration and its implementation below (Execute, AddEvent (PRIVATE), OnMessageSent, OnAlarmRaised,
//      OnAlarmCleared, OnAlarmConfirmed).
//   4. An instance where the gateway can read it, called every cycle:
//        PROGRAM MAIN
//        VAR
//            fbEventRelay : FB_KvalEventRelay;
//        END_VAR
//        fbEventRelay.Execute();
//   5. The gateway's setup page, Logged events: its instance (MAIN.fbEventRelay) for that PLC.
//
// Built with TwinCAT XAE (no errors) and run on a TwinCAT runtime: a message and an alarm (raised, cleared) of the
// ADS event class read live by the gateway (tests/plc/real-eventrelay.test.cjs). Its layout (ST_KvalEvent packed, 355 bytes; 64 of them) is
// what the gateway reads: keep it as it is.

// ===== DUT: ST_KvalEvent =====
// One TwinCAT event as FB_KvalEventRelay keeps it for the Kval MachineScope gateway (packed: read as raw bytes)
{attribute 'pack_mode' := '1'}
TYPE ST_KvalEvent :
STRUCT
	nSeq : UDINT;           // its number (0: an empty slot)
	nTimestamp : ULINT;     // when: 100 ns since 1601-01-01 (UTC), as the EventLogger gives it
	nKind : USINT;          // 1 message, 2 alarm raised, 3 alarm cleared, 4 alarm confirmed
	nSeverity : USINT;      // TcEventSeverity: 0 verbose, 1 info, 2 warning, 3 error, 4 critical
	nEventId : UDINT;       // its event id in its event class
	sSource : STRING(80);   // its source (the symbol of what sent it)
	{attribute 'TcEncoding' := 'UTF-8'}
	sText : STRING(255);    // its text (en-US), filled in a few cycles later
END_STRUCT
END_TYPE

// ===== POU: FB_KvalEventRelay (declaration; its body is empty) =====
// The TwinCAT EventLogger's messages and alarms, live, for the Kval MachineScope gateway: each one kept in a ring of
// the last 64 (aEvents, the newest at (nSeq - 1) MOD 64), with its text (en-US). Call Execute() every cycle:
//   fbEventRelay.Execute();
// The gateway reads nSeq and aEvents (config.json "eventlog": { "live": { "<plc id>": "MAIN.fbEventRelay" } }).
// Needs Tc3_EventLogger (>= v3.1.27.0, TwinCAT 3.1.4024.17).
FUNCTION_BLOCK FB_KvalEventRelay EXTENDS FB_ListenerBase2
VAR_OUTPUT
	nSeq : UDINT;                              // the newest event's number (0: none yet)
	aEvents : ARRAY[0..63] OF ST_KvalEvent;    // the last 64
	hrSubscribe : HRESULT;                     // its subscription (S_OK: listening)
END_VAR
VAR
	bListening : BOOL;
	aRequests : ARRAY[0..7] OF FB_RequestEventText;   // the texts asked for (up to 8 at once)
	aRequestSlot : ARRAY[0..7] OF UINT;                // the slot each one's text goes to
	aRequestSeq : ARRAY[0..7] OF UDINT;                // the event it is for (its slot not overwritten since)
	aRequestBusy : ARRAY[0..7] OF BOOL;
END_VAR

// ===== METHOD Execute (declaration) =====
METHOD Execute : HRESULT
VAR
	i : UINT;
END_VAR
// ----- its implementation -----
// (subscribed once: every message and alarm, no filter)
IF NOT bListening THEN
	hrSubscribe := Subscribe(0, 0);
	bListening := (hrSubscribe = S_OK);
END_IF
// (the EventLogger's queue: its callbacks below)
Execute := SUPER^.Execute();
// (the texts asked for: each one into its slot, unless a newer event took that slot since)
FOR i := 0 TO 7 DO
	IF aRequestBusy[i] THEN
		IF aRequests[i].bError THEN
			aRequestBusy[i] := FALSE;
		ELSIF NOT aRequests[i].bBusy THEN
			IF aEvents[aRequestSlot[i]].nSeq = aRequestSeq[i] THEN
				aRequests[i].GetString(aEvents[aRequestSlot[i]].sText, SIZEOF(aEvents[aRequestSlot[i]].sText));
			END_IF
			aRequestBusy[i] := FALSE;
		END_IF
	END_IF
END_FOR

// ===== METHOD PRIVATE AddEvent (declaration) =====
METHOD PRIVATE AddEvent : BOOL
VAR_INPUT
	nKind : USINT;                          // 1 message, 2 raised, 3 cleared, 4 confirmed
	fbEvent : REFERENCE TO FB_TcEvent;      // (not copied: read here only)
END_VAR
VAR
	nSlot : UINT;
	i : UINT;
END_VAR
// ----- its implementation -----
nSeq := nSeq + 1;
IF nSeq = 0 THEN
	nSeq := 1;
END_IF
nSlot := UDINT_TO_UINT((nSeq - 1) MOD 64);
aEvents[nSlot].nSeq := nSeq;
aEvents[nSlot].nTimestamp := fbEvent.nTimestamp;
aEvents[nSlot].nKind := nKind;
aEvents[nSlot].nSeverity := TO_USINT(fbEvent.eSeverity);
aEvents[nSlot].nEventId := fbEvent.nEventId;
aEvents[nSlot].sSource := fbEvent.ipSourceInfo.sName;
aEvents[nSlot].sText := '';
// (its text asked for by a request free; none free: kept without its text)
FOR i := 0 TO 7 DO
	IF NOT aRequestBusy[i] THEN
		aRequests[i].Request(eventClass := fbEvent.EventClass, nEventId := fbEvent.nEventId, nLangId := TcLcid.en_US, ipArgs := fbEvent.ipArguments);
		aRequestSlot[i] := nSlot;
		aRequestSeq[i] := nSeq;
		aRequestBusy[i] := TRUE;
		EXIT;
	END_IF
END_FOR
AddEvent := TRUE;

// ===== METHOD OnMessageSent (declaration) =====
METHOD OnMessageSent : HRESULT
VAR_INPUT
	fbEvent : REFERENCE TO FB_TcEvent;
END_VAR
// ----- its implementation -----
AddEvent(nKind := 1, fbEvent := fbEvent);
OnMessageSent := S_OK; // (more callbacks this cycle)

// ===== METHOD OnAlarmRaised (declaration) =====
METHOD OnAlarmRaised : HRESULT
VAR_INPUT
	fbEvent : REFERENCE TO FB_TcEvent;
END_VAR
// ----- its implementation -----
AddEvent(nKind := 2, fbEvent := fbEvent);
OnAlarmRaised := S_OK;

// ===== METHOD OnAlarmCleared (declaration) =====
METHOD OnAlarmCleared : HRESULT
VAR_INPUT
	fbEvent : REFERENCE TO FB_TcEvent;
END_VAR
// ----- its implementation -----
AddEvent(nKind := 3, fbEvent := fbEvent);
OnAlarmCleared := S_OK;

// ===== METHOD OnAlarmConfirmed (declaration) =====
METHOD OnAlarmConfirmed : HRESULT
VAR_INPUT
	fbEvent : REFERENCE TO FB_TcEvent;
END_VAR
// ----- its implementation -----
AddEvent(nKind := 4, fbEvent := fbEvent);
OnAlarmConfirmed := S_OK;

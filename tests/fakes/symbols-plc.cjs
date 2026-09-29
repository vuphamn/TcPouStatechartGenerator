// A PLC with data types for the symbol browser tests (fake-ams2.cjs config): MAIN.mainStateMachine with values,
// two SM_TableManager (machineState inherited from a base FB), an array of SM_DoorDasher (the second in an error
// state) and a structure. State enums the PLC describes (E_Main, E_DoorDasher_States) give the Machine Overview names;
// E_TableManager_States is not described (the app takes its names from the .TcDUT). aDoors[1] goes from DISABLED to
// ENABLING after 3 s.
const fs = require('fs');
const path = require('path');
const h = require('../lib/harness.cjs');

const R = 'MAIN.mainStateMachine';
const sym = (type, dataType, size, value) => ({ type, dataType, size, value });
const config = ({
  symbols: {
    [R]: sym('FB_MainStateMachine', 65, 400, 0),
    [`${R}.machineState`]: sym('E_Main', 2, 2, 1),
    [`${R}.bEnable`]: sym('BOOL', 33, 1, 1),
    [`${R}.nCount`]: sym('DINT', 3, 4, 42),
    [`${R}.fSpeed`]: sym('LREAL', 5, 8, 1.5),
    [`${R}.sName`]: sym('STRING(80)', 30, 81, 'hello'),
    [`${R}.smTable1`]: sym('SM_TableManager', 65, 64, 0),
    [`${R}.smTable1.machineState`]: sym('E_TableManager_States', 2, 2, 2),
    [`${R}.smTable1.bHomed`]: sym('BOOL', 33, 1, 0),
    [`${R}.smTable2`]: sym('SM_TableManager', 65, 64, 0),
    [`${R}.smTable2.machineState`]: sym('E_TableManager_States', 2, 2, 3),
    [`${R}.aDoors`]: sym('ARRAY [1..2] OF SM_DoorDasher', 65, 64, 0),
    [`${R}.aDoors[1]`]: sym('SM_DoorDasher', 65, 32, 0),
    [`${R}.aDoors[1].machineState`]: sym('E_DoorDasher_States', 2, 2, 0),
    [`${R}.aDoors[2]`]: sym('SM_DoorDasher', 65, 32, 0),
    [`${R}.aDoors[2].machineState`]: sym('E_DoorDasher_States', 2, 2, 7),
    [`${R}.stSettings`]: sym('ST_Settings', 65, 16, 0),
    [`${R}.stSettings.rTimeout`]: sym('REAL', 4, 4, 2.5),
    // (outside the root the symbol tests browse: SM_Conveyor, from the PLC's sources, has an instance to go live on)
    'MAIN.conveyor': sym('SM_Conveyor', 65, 4, 0),
    'MAIN.conveyor.machineState': sym('E_Conveyor_States', 2, 2, 1),
    'MAIN.conveyor.bStart': sym('BOOL', 33, 1, 1),
  },
  types: {
    FB_MainStateMachine: { size: 400, dataType: 65, type: '', subItems: [
      { name: 'machineState', type: 'E_Main', size: 2, dataType: 2 },
      { name: 'bEnable', type: 'BOOL', size: 1, dataType: 33 },
      { name: 'nCount', type: 'DINT', size: 4, dataType: 3 },
      { name: 'fSpeed', type: 'LREAL', size: 8, dataType: 5 },
      { name: 'sName', type: 'STRING(80)', size: 81, dataType: 30 },
      { name: 'pTarget', type: 'POINTER TO INT', size: 8, dataType: 65 },
      { name: 'smTable1', type: 'SM_TableManager', size: 64, dataType: 65 },
      { name: 'smTable2', type: 'SM_TableManager', size: 64, dataType: 65 },
      { name: 'aDoors', type: 'ARRAY [1..2] OF SM_DoorDasher', size: 64, dataType: 65, bounds: [[1, 2]] },
      { name: 'stSettings', type: 'ST_Settings', size: 16, dataType: 65 },
    ] },
    // A derived function block: machineState comes from its base
    SM_TableManager: { size: 64, dataType: 65, type: 'KvalStateMachineBase', subItems: [{ name: 'bHomed', type: 'BOOL', size: 1, dataType: 33 }] },
    KvalStateMachineBase: { size: 16, dataType: 65, type: '', subItems: [{ name: 'machineState', type: 'INT', size: 2, dataType: 2 }] },
    SM_DoorDasher: { size: 32, dataType: 65, type: '', subItems: [{ name: 'machineState', type: 'E_DoorDasher_States', size: 2, dataType: 2 }] },
    E_DoorDasher_States: { size: 2, dataType: 2, type: 'INT', subItems: [], enumValues: { 0: 'DOOR_DASHER_DISABLED', 1: 'DOOR_DASHER_ENABLING', 7: 'DOOR_DASHER_ERROR' } },
    E_Main: { size: 2, dataType: 2, type: 'INT', subItems: [], enumValues: { 1: 'MAIN_RUNNING', 9: 'MAIN_ERROR' } },
    ST_Settings: { size: 16, dataType: 65, type: '', subItems: [{ name: 'rTimeout', type: 'REAL', size: 4, dataType: 4 }] },
    // (the running code's SM_Conveyor: no machineState, unlike its sources' .tmc)
    SM_Conveyor: { size: 4, dataType: 65, type: '', subItems: [{ name: 'bStart', type: 'BOOL', size: 1, dataType: 33 }] },
  },
  // Instance discovery (the symbol table): the conveyor, found for SM_Conveyor
  upload: [
    { name: `${R}.smTable1`, type: 'SM_TableManager' },
    { name: `${R}.smTable2`, type: 'SM_TableManager' },
    { name: `${R}.aDoors[1]`, type: 'SM_DoorDasher' },
    { name: `${R}.aDoors[2]`, type: 'SM_DoorDasher' },
    { name: 'MAIN.conveyor', type: 'SM_Conveyor' },
  ],
  script: [{ hold: 3000, set: { [`${R}.aDoors[1].machineState`]: 1 } }, { hold: 2000, set: { [`${R}.nCount`]: 43, [`${R}.bEnable`]: 0 } }],
});

// The PLC project "Plant", downloaded with its sources: its boot folder's project information and archive, with a
// conveyor state machine (SM_Conveyor, E_Conveyor_States) that the PLC's symbols do not have (SM_DoorDasher is not
// in these sources)
const cdata = (s) => `<![CDATA[${s}]]>`;
const CONVEYOR_DO = ['CASE machineState OF', '\tE_Conveyor_States.CONVEYOR_STOPPED:', '\t\tIF bStart THEN', '\t\t\tmachineState := E_Conveyor_States.CONVEYOR_RUNNING;', '\t\tEND_IF', '\tE_Conveyor_States.CONVEYOR_RUNNING:', '\t\tIF NOT bStart THEN', '\t\t\tmachineState := E_Conveyor_States.CONVEYOR_STOPPED;', '\t\tEND_IF', 'END_CASE'].join('\n');
const xml = (inner) => `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n${inner}\n</TcPlcObject>`;
const PLANT_SOURCES = {
  'POUs/Conveyor/SM_Conveyor.TcPOU': xml(`  <POU Name="SM_Conveyor" Id="{c1}" SpecialFunc="None">\n    <Declaration>${cdata('FUNCTION_BLOCK SM_Conveyor\nVAR_INPUT\n\tbStart : BOOL;\nEND_VAR\nVAR\n\tmachineState : E_Conveyor_States;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n    <Method Name="doState" Id="{c2}">\n      <Declaration>${cdata('METHOD doState : BOOL')}</Declaration>\n      <Implementation>\n        <ST>${cdata(CONVEYOR_DO)}</ST>\n      </Implementation>\n    </Method>\n  </POU>`),
  'POUs/Conveyor/E_Conveyor_States.TcDUT': xml(`  <DUT Name="E_Conveyor_States" Id="{c3}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_Conveyor_States :\n(\n\tCONVEYOR_STOPPED := 0,\n\tCONVEYOR_RUNNING\n);\nEND_TYPE")}</Declaration>\n  </DUT>`),
  'POUs/MAIN.TcPOU': xml(`  <POU Name="MAIN" Id="{c4}" SpecialFunc="None">\n    <Declaration>${cdata('PROGRAM MAIN\nVAR\n\tmainStateMachine : FB_MainStateMachine;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('mainStateMachine();')}</ST>\n    </Implementation>\n  </POU>`),
  // (SM_TableManager: its own enum, not the sample's: opened Here from the PLC Symbols)
  'POUs/Table/SM_TableManager.TcPOU': xml(`  <POU Name="SM_TableManager" Id="{c5}" SpecialFunc="None">\n    <Declaration>${cdata('FUNCTION_BLOCK SM_TableManager\nVAR\n\tmachineState : E_TableManager_States;\n\tbHomed : BOOL;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n    <Method Name="doState" Id="{c6}">\n      <Declaration>${cdata('METHOD doState : BOOL')}</Declaration>\n      <Implementation>\n        <ST>${cdata(['CASE machineState OF', '\tE_TableManager_States.TABLE_PLC_IDLE:', '\t\tIF bHomed THEN', '\t\t\tmachineState := E_TableManager_States.TABLE_PLC_READY;', '\t\tEND_IF', 'END_CASE'].join('\n'))}</ST>\n      </Implementation>\n    </Method>\n  </POU>`),
  'POUs/Table/E_TableManager_States.TcDUT': xml(`  <DUT Name="E_TableManager_States" Id="{c7}">\n    <Declaration>${cdata("{attribute 'qualified_only'}\nTYPE E_TableManager_States :\n(\n\tTABLE_PLC_IDLE := 0,\n\tTABLE_PLC_READY := 2\n);\nEND_TYPE")}</Declaration>\n  </DUT>`),
  // As built (the .tmc): SM_Conveyor with a member the PLC's own type lacks (the sources are older than the running
  // code); SM_DoorDasher from a library
  'Plant.tmc': '<?xml version="1.0"?>\n<TcModuleClass><DataTypes><DataType><Name>SM_Conveyor</Name><BitSize>32</BitSize><SubItem><Name>bStart</Name><Type>BOOL</Type></SubItem><SubItem><Name>machineState</Name><Type>E_Conveyor_States</Type></SubItem></DataType><DataType><Name Namespace="Tc3_Doors">SM_DoorDasher</Name><BitSize>256</BitSize></DataType></DataTypes></TcModuleClass>',
  'README.md': '(not a source)',
};
// A second PLC project on the same target (ADS port 852)
const LINE2_SOURCES = {
  'POUs/SM_Line2.TcPOU': xml(`  <POU Name="SM_Line2" Id="{d1}" SpecialFunc="None">\n    <Declaration>${cdata('FUNCTION_BLOCK SM_Line2\nVAR\n\tnStep : INT;\nEND_VAR')}</Declaration>\n    <Implementation>\n      <ST>${cdata('')}</ST>\n    </Implementation>\n  </POU>`),
};
function plantBootFiles() {
  const { writeZip } = require('../lib/zip.cjs');
  return {
    'CurrentProjectInfo.json': Buffer.from(JSON.stringify({ project: { name: 'Plant', platform: 'TwinCAT RT (x64)' }, sub_projects: [{ name: 'Plant', file: 'Plc/Port_851.json' }, { name: 'Line2', file: 'Plc/Port_852.json' }] })).toString('base64'),
    'CurrentConfig/Plant.tpzip': writeZip({ ...PLANT_SOURCES, 'Plant.plcproj': '<Project/>' }).toString('base64'),
    // The TwinCAT project (Build: rebuilt from the PLC): the .tsproj and its PLC project's .xti, which says where the
    // PLC project goes
    'CurrentConfig.tszip': writeZip({
      'Plant.tsproj': '<?xml version="1.0"?>\n<TcSmProject><Project><Plc><Project File="Plant.xti"/></Plc></Project></TcSmProject>',
      '_Config/PLC/Plant.xti': '<?xml version="1.0"?>\n<TcSmItem ClassName="CNestedPlcProjDef"><Project GUID="{p1}" Name="Plant" PrjFilePath="..\\..\\Plant\\Plant.plcproj" TmcFilePath="..\\..\\Plant\\Plant.tmc" AmsPort="851"/></TcSmItem>',
    }).toString('base64'),
    'CurrentConfig/Line2.tpzip': writeZip(LINE2_SOURCES).toString('base64'),
  };
}

/** Writes the config for fake-ams2.cjs (more steps after its own script: extra; the PLC project's sources: sources); returns its path */
function writeSymbolsPlc(name = 'fake-ams2-sym.json', extra = [], { sources = false } = {}) {
  const file = path.join(h.OUT, name);
  fs.writeFileSync(file, JSON.stringify({ ...config, script: [...config.script, ...extra], ...(sources ? { bootFiles: plantBootFiles() } : {}) }));
  return file;
}

module.exports = { R, config, writeSymbolsPlc, PLANT_SOURCES };

// The Lenze i550's error codes (its 0x603F), as the i550 commissioning manual's table "Error codes, causes and
// remedies" names them (the table's text, its spelling kept). A code whose name says it is a warning, and 0x3222
// (the DC-bus voltage too low for power-up: a drive without mains, classed a warning), is a warning; any other an
// error. Check a code against your drive's firmware manual: Lenze's tables differ a little between firmwares.
const TEXT = {
  0x2250: 'CiA: Continuous over current (internal)', 0x2320: 'CiA: Short circuit/earth leakage (internal)', 0x2340: 'CiA: Short circuit (device internal)',
  0x2350: 'CiA: i²*t overload (thermal state)', 0x2382: 'I*t error', 0x2383: 'I*t warning', 0x2387: 'Imax: Clamp responded too often', 0x2388: 'SL-PSM stall detection active',
  0x238a: 'Maximum current reached', 0x3120: 'Mains phase fault', 0x3180: 'UPS operation active', 0x3210: 'DC bus overvoltage', 0x3211: 'DC bus overvoltage warning',
  0x3220: 'DC bus undervoltage', 0x3221: 'DC bus undervoltage warning', 0x3222: 'DC-bus voltage to low for power up', 0x4210: 'PU: overtemperature fault',
  0x4280: 'Heat sink temperature sensor fault', 0x4281: 'Heat sink fan warning', 0x4285: 'PU overtemperature warning', 0x4310: 'Motor temperature error',
  0x5112: '24 V supply critical', 0x5180: 'Overload 24 V supply', 0x5380: 'OEM hardware incompatible', 0x618a: 'Internal fan warning',
  0x6280: 'Trigger/functions connected incorrectly', 0x6281: 'User-defined fault 1', 0x6282: 'User-defined fault 2', 0x6290: 'Warning invert rotation',
  0x6291: 'Maximuml allowed troubles exceeded', 0x62a0: 'User-defined fault (LECOM)', 0x62a1: 'Network: user fault 1', 0x62a2: 'Network: user fault 2',
  0x62b1: 'NetWordIN1 configuration incorrect', 0x63a1: 'CU: load error ID tag', 0x63a2: 'PU: load error ID tag', 0x63a3: 'Power unit unknown',
  0x7080: 'Assertion level monitoring (Low/High)', 0x7081: 'Analog input 1 fault', 0x7082: 'Analog input 2 fault', 0x7083: 'HTL input fault',
  0x70a1: 'Analog output 1 fault', 0x70a2: 'Analog output 2 fault', 0x7121: 'Pole position identification fault', 0x7180: 'Motor overcurrent',
  0x7305: 'Encoder open circuit', 0x7385: 'Feedback system: speed limit', 0x7680: 'Memory module is full', 0x7681: 'Memory module not present',
  0x7682: 'Memory module: Invalid user data', 0x7684: 'Data not compl. saved before powerdown', 0x7686: 'Internal communication error',
  0x7689: 'Memory module: invalid OEM data', 0x768a: 'Memory module: wrong type', 0x7690: 'EPM firmware version incompatible',
  0x7691: 'EPM data: firmware type incompatible', 0x7692: 'EPM data: new firmware type detected', 0x7693: 'EPM data: PU size incompatible',
  0x7694: 'EPM data: new PU size detected', 0x7695: 'Invalid parameter changeover configuration', 0x7696: 'EPM data: unknown parameter found',
  0x7697: 'Parameter changes lost', 0x8112: 'Network: timeout explicit message', 0x8114: 'Network: overall communication timeout', 0x8115: 'Time-out (PAM)',
  0x8116: 'Modbus TCP master time-out', 0x8117: 'Modbus TCP Keep Alive time-out', 0x811a: 'BACnet time-out', 0x8182: 'CAN: bus off', 0x8183: 'CAN: warning',
  0x8184: 'CAN: heartbeat time-out consumer 1', 0x8185: 'CAN: heartbeat time-out consumer 2', 0x8186: 'CAN: heartbeat time-out consumer 3',
  0x8187: 'CAN: heartbeat time-out consumer 4', 0x8190: 'Network: watchdog timeout', 0x8191: 'Network: disruption of cyclic data exchange',
  0x8192: 'Network: initialisation error', 0x8193: 'Network: invalid cyclic process data', 0x81a1: 'Modbus: network time-out',
  0x81a2: 'Modbus: incorrect request by master', 0x81b0: 'Network communication faulty', 0x8265: 'POWERLINK: Loss of SoC', 0x8266: 'POWERLINK: CRC error',
  0x8286: 'Network: PDO mapping error', 0x8291: 'CAN: RPDO1 time-out', 0x8292: 'CAN: RPDO2 time-out', 0x8293: 'CAN: RPDO3 time-out',
  0x8311: 'Torque limit reached', 0x8380: 'Function not allowed in selected operating mode', 0x9080: 'Keypad removed', 0xff02: 'Brake resistor: overload fault',
  0xff05: 'Safe Torque Off is locked', 0xff06: 'Motor overspeed', 0xff09: 'Motor phase missing', 0xff0a: 'Motor phase failure phase U',
  0xff0b: 'Motor phase failure phase V', 0xff0c: 'Motor phase failure phase W', 0xff19: 'Motor parameter identification fault', 0xff1f: 'FMF Error',
  0xff36: 'Brake resistor: overload warning', 0xff37: 'Automatic start disabled', 0xff38: 'Load loss detected', 0xff39: 'Motor overload',
  0xff56: 'Maximum motor frequency reached', 0xff71: 'Wrong password', 0xff72: 'Warning', 0xff73: 'Fatal Error', 0xff74: 'Power unit fatal error',
  0xff85: 'Keypad full control active',
};

/** A code's name and whether it is a warning (null: not in the table) */
function lenzeError(code) {
  const text = TEXT[code];
  if (!text) return null;
  return { text, warning: /warning/i.test(text) || code === 0x3222 };
}

module.exports = { lenzeError, LENZE_I550_ERRORS: TEXT };

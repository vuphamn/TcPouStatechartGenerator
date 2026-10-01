// The fronts of the Beckhoff terminals, couplers and boxes on Kval's machines, as their manuals' connection diagrams
// draw them: the contacts (numbered as Beckhoff numbers them: column by column, top to bottom), the LEDs, the ports
// and sockets, each signal's channel (its PDO "Channel n") for the live values. From Beckhoff's documentation (each
// one's source); the I/O tab says to check against the manual. A type not here: no front view.
import type { IoBox } from '../components/IoTreePanel.tsx';

export interface FaceContact {
  /** Its number as printed: 1 … 8, and on a 24 mm terminal's second block 1' … 8' */
  n: number | string;
  label: string;
  kind: 'in' | 'out' | 'signal' | 'power+' | 'power0' | 'pe' | 'shield' | 'ethercat' | 'nc';
  /** Its channel (1-based), for its linked variable's value */
  channel?: number;
  comment?: string;
}
export interface FaceLed {
  name: string;
  colour: 'green' | 'red' | 'yellow' | 'orange' | 'blue' | 'white';
  meaning?: string;
  /** Lit by this channel's value (1-based) */
  channel?: number;
  dir?: 'in' | 'out';
  /** Its place in the LED field (column, row from 0), when the field has empty places */
  at?: [number, number];
}
export interface FacePort {
  name: string;
  comment?: string;
}
export interface FaceSocket {
  name: string;
  label: string;
  channel?: number;
  dir?: 'in' | 'out';
  comment?: string;
}
export interface TerminalFace {
  type: string;
  /** The contacts' grid: columns of rows (8 points: 2 x 4) */
  columns: number;
  rows: number;
  contacts: FaceContact[];
  leds: FaceLed[];
  ledColumns: number;
  ports?: FacePort[];
  /** Connectors at the bottom (a box's power: X60 / X61) */
  portsBottom?: FacePort[];
  sockets?: FaceSocket[];
  /** The sockets' order: alternating left / right (0 left, 1 right …), or down the left column, then the right */
  socketOrder?: 'alternate' | 'columns';
  /** Beckhoff gives the contacts no numbers (a coupler's): drawn by place, listed as left / right and row */
  unnumbered?: boolean;
  /** Its width as drawn (default: by its columns) */
  width?: number;
  source: string[];
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

// (8 signal LEDs in two columns: 1 | 2, 3 | 4 …, as the contacts: odd channels left, even right)
const eightLeds = (word: 'Input' | 'Output', dir: 'in' | 'out'): FaceLed[] => Array.from({ length: 8 }, (_, i) => ({ name: `${word} ${i + 1}`, colour: 'green', channel: i + 1, dir }));
const alternating = (word: 'Input' | 'Output', kind: 'in' | 'out'): FaceContact[] =>
  [1, 3, 5, 7, 2, 4, 6, 8].map((ch, i) => ({ n: i + 1, label: `${word} ${ch}`, kind, channel: ch }));

const DIGITAL: TerminalFace[] = [
  {
    type: 'EL1088',
    columns: 2,
    rows: 4,
    contacts: alternating('Input', 'in'),
    leds: eightLeds('Input', 'in'),
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el10xx_el11xx/1631414411.html', 'https://infosys.beckhoff.com/content/1033/el10xx_el11xx/1623216395.html'],
    confidence: 'high',
    notes: 'Negative switching: "1" = 0 … 7 V. Power only on the side contacts. LED positions: from the drawing, not the text.',
  },
  {
    type: 'EL1008',
    columns: 2,
    rows: 4,
    contacts: alternating('Input', 'in'),
    leds: eightLeds('Input', 'in'),
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el10xx_el11xx/1623216395.html'],
    confidence: 'medium',
    notes: 'The EL1088\'s front, positive switching ("1" = 15 … 30 V). LED positions: from the drawing, not the text.',
  },
  {
    type: 'EL2008',
    columns: 2,
    rows: 4,
    contacts: alternating('Output', 'out'),
    leds: eightLeds('Output', 'out'),
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el20xx_el2124/1636470795.html', 'https://infosys.beckhoff.com/content/1033/el20xx_el2124/1625834251.html'],
    confidence: 'high',
    notes: '24 V DC, 0.5 A an output. Power only on the side contacts. LED positions: from the drawing, not the text.',
  },
  {
    type: 'EL1512',
    columns: 2,
    rows: 4,
    contacts: [
      { n: 1, label: 'Clock Ch.1 / U/D, Gate', kind: 'in', comment: 'clock 1 (2 x 32 bit), up/down, or gate input' },
      { n: 2, label: '+24 V', kind: 'power+', comment: 'with 6 and the + power contact' },
      { n: 3, label: '0 V', kind: 'power0', comment: 'with 7 and the 0 V power contact' },
      { n: 4, label: 'PE', kind: 'pe' },
      { n: 5, label: 'Clock Ch.2 / Clock', kind: 'in', comment: 'clock 2 (2 x 32 bit), or clock input' },
      { n: 6, label: '+24 V', kind: 'power+', comment: 'with 2 and the + power contact' },
      { n: 7, label: '0 V', kind: 'power0', comment: 'with 3 and the 0 V power contact' },
      { n: 8, label: 'PE', kind: 'pe' },
    ],
    leds: [
      { name: 'CLOCK CH.1 / UP/DOWN, Gate', colour: 'green', meaning: 'a signal at input 1' },
      { name: 'CLOCK CH.2 / CLOCK', colour: 'green', meaning: 'a signal at input 5' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-terminals/el15xxen.pdf (5.10 EL1512 - LEDs and connection)'],
    confidence: 'high',
    notes: 'Not the EL1502 (its 4 / 8 are outputs). Max. 1 kHz.',
  },
  {
    type: 'EL1904',
    columns: 2,
    rows: 4,
    contacts: [
      { n: 1, label: 'Input 1+', kind: 'signal', comment: 'test pulse out (24 V) to the sensor contact' },
      { n: 2, label: 'Input 1-', kind: 'in', comment: 'read back' },
      { n: 3, label: 'Input 3+', kind: 'signal', comment: 'test pulse out' },
      { n: 4, label: 'Input 3-', kind: 'in', comment: 'read back' },
      { n: 5, label: 'Input 2+', kind: 'signal', comment: 'test pulse out' },
      { n: 6, label: 'Input 2-', kind: 'in', comment: 'read back' },
      { n: 7, label: 'Input 4+', kind: 'signal', comment: 'test pulse out' },
      { n: 8, label: 'Input 4-', kind: 'in', comment: 'read back' },
    ],
    leds: [
      { name: 'Diag 1', colour: 'green', meaning: 'TwinSAFE communication: on = OK; flashing codes = an error (S / I parameters, watchdog, CRC …)' },
      { name: 'Diag 2', colour: 'red', meaning: 'an external supply or a cross-circuit found' },
      { name: 'Diag 3', colour: 'red', meaning: 'on: Diag 4 shows an internal error' },
      { name: 'Diag 4', colour: 'red', meaning: 'the internal error\'s flashing code' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/automation/twinsafe/el1904_en.pdf (6.3.2 EL1904 pin assignment, 8.1 Diagnostic LEDs)', 'https://www.beckhoff.com/en-us/products/automation/twinsafe/twinsafe-hardware/el1904.html'],
    confidence: 'medium',
    notes: 'TwinSAFE: its values are the safety program\'s, not shown here. Its Input 1 … 4 LEDs are not drawn (their colour is not in the manual).',
  },
  {
    type: 'EL2904',
    columns: 4,
    rows: 4,
    contacts: [
      { n: 1, label: 'not used', kind: 'nc' },
      { n: 2, label: '+ power contact', kind: 'power+' },
      { n: 3, label: '0 V power contact', kind: 'power0' },
      { n: 4, label: 'not used', kind: 'nc' },
      { n: 5, label: 'not used', kind: 'nc' },
      { n: 6, label: '+ power contact', kind: 'power+' },
      { n: 7, label: '0 V power contact', kind: 'power0' },
      { n: 8, label: 'not used', kind: 'nc' },
      { n: "1'", label: 'Output 1+', kind: 'out' },
      { n: "2'", label: 'Output 1-', kind: 'signal', comment: 'its return' },
      { n: "3'", label: 'Output 3+', kind: 'out' },
      { n: "4'", label: 'Output 3-', kind: 'signal', comment: 'its return' },
      { n: "5'", label: 'Output 2+', kind: 'out' },
      { n: "6'", label: 'Output 2-', kind: 'signal', comment: 'its return' },
      { n: "7'", label: 'Output 4+', kind: 'out' },
      { n: "8'", label: 'Output 4-', kind: 'signal', comment: 'its return' },
    ],
    leds: [
      { name: 'Output 1', colour: 'green' },
      { name: 'Output 2', colour: 'green' },
      { name: 'Output 3', colour: 'green' },
      { name: 'Output 4', colour: 'green' },
      { name: 'Diag 1', colour: 'green', meaning: 'TwinSAFE interface' },
      { name: 'Diag 2', colour: 'red', meaning: 'the outputs: an output\'s error, field voltage too low / high, temperature' },
      { name: 'Diag 3', colour: 'red', meaning: 'on: Diag 4 shows an internal error (the terminal shuts down)' },
      { name: 'Diag 4', colour: 'red', meaning: 'the internal error\'s flashing code' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/Document/automation/twinsafe/el2904_en.pdf (6.3.2 EL2904 pin assignment, 8.1 Diagnostic LEDs)', 'https://www.beckhoff.com/en-en/products/automation/twinsafe/twinsafe-hardware/el2904.html'],
    confidence: 'medium',
    notes: '24 mm, two blocks (1 … 8 and 1\' … 8\'; which one is left: from the drawing). TwinSAFE: its values are the safety program\'s. Max. 0.5 A a channel.',
  },
  {
    type: 'EL5101',
    columns: 4,
    rows: 4,
    contacts: [
      { n: 1, label: 'A', kind: 'in' },
      { n: 2, label: 'B', kind: 'in' },
      { n: 3, label: 'C', kind: 'in' },
      { n: 4, label: 'Latch 24 V', kind: 'in' },
      { n: 5, label: '/A', kind: 'in', comment: 'A inverted' },
      { n: 6, label: '/B', kind: 'in', comment: 'B inverted' },
      { n: 7, label: '/C', kind: 'in', comment: 'C inverted' },
      { n: 8, label: 'Gate 24 V', kind: 'in' },
      { n: "1'", label: 'Ue = +5 V', kind: 'signal', comment: 'the encoder\'s supply (out)' },
      { n: "2'", label: '+24 V', kind: 'power+', comment: 'with 6\' and the + power contact' },
      { n: "3'", label: '0 V', kind: 'power0', comment: 'with 7\' and the 0 V power contact' },
      { n: "4'", label: 'Input 1', kind: 'in', comment: 'status input (the encoder\'s alarm); pulled up to 5 V' },
      { n: "5'", label: 'Uo = 0 V', kind: 'signal', comment: 'the encoder\'s supply 0 V' },
      { n: "6'", label: '+24 V', kind: 'power+', comment: 'with 2\' and the + power contact' },
      { n: "7'", label: '0 V', kind: 'power0', comment: 'with 3\' and the 0 V power contact' },
      { n: "8'", label: 'Shield', kind: 'shield' },
    ],
    leds: [
      { name: 'INPUT A', colour: 'green' },
      { name: 'INPUT B', colour: 'green' },
      { name: 'INPUT C', colour: 'green' },
      { name: 'INPUT 1', colour: 'red', meaning: 'Input 1 pulled to 0 V' },
      { name: 'LATCH', colour: 'green', meaning: '+24 V at the latch input' },
      { name: 'GATE', colour: 'green', meaning: '+24 V at the gate input' },
      { name: 'RUN', colour: 'green', meaning: 'off INIT; flashing PREOP; single flash SAFEOP; on OP' },
      { name: 'POWER 5 V', colour: 'green', meaning: 'the encoder\'s supply' },
    ],
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el5101/1716197643.html (EL5101-00x0 - LEDs and Connection)', 'https://infosys.beckhoff.com/content/1033/el5101/10709058315.html'],
    confidence: 'high',
    notes: '24 mm, two blocks. Not for the EL5101-0010 / -0011 (no single-ended, another table). LED positions: from the drawing.',
  },
  {
    type: 'EL4004',
    columns: 2,
    rows: 4,
    contacts: [
      { n: 1, label: 'Output 1', kind: 'out', channel: 1, comment: '0 … 10 V' },
      { n: 2, label: 'Ground', kind: 'power0', comment: '0 V, with 4, 6, 8' },
      { n: 3, label: 'Output 3', kind: 'out', channel: 3, comment: '0 … 10 V' },
      { n: 4, label: 'Ground', kind: 'power0', comment: '0 V, with 2, 6, 8' },
      { n: 5, label: 'Output 2', kind: 'out', channel: 2, comment: '0 … 10 V' },
      { n: 6, label: 'Ground', kind: 'power0', comment: '0 V, with 2, 4, 8' },
      { n: 7, label: 'Output 4', kind: 'out', channel: 4, comment: '0 … 10 V' },
      { n: 8, label: 'Ground', kind: 'power0', comment: '0 V, with 2, 4, 6' },
    ],
    leds: [{ name: 'RUN', colour: 'green', meaning: 'off INIT; flashing PREOP; single flash SAFEOP; on OP' }],
    ledColumns: 1,
    source: ['https://infosys.beckhoff.com/content/1033/el40xx/12759410699.html (EL4004, connection and display)', 'https://infosys.beckhoff.com/content/1033/el40xx/1711311499.html'],
    confidence: 'high',
    notes: 'Load > 5 kOhm. How many RUN LEDs: not in the text.',
  },
];

const RUN: FaceLed = { name: 'RUN', colour: 'green', meaning: 'off INIT; flashing PREOP; single flash SAFEOP; on OP; flickering BOOTSTRAP' };
const unused = (n: number): FaceContact[] => Array.from({ length: n }, (_, i) => ({ n: i + 1, label: 'not used', kind: 'nc' as const }));

const SYSTEM: TerminalFace[] = [
  {
    type: 'EL6070-0033',
    columns: 2,
    rows: 4,
    contacts: unused(8),
    leds: [
      { ...RUN, at: [0, 0] },
      { name: 'Processing', colour: 'green', meaning: 'a cryptographic process runs', at: [0, 1] },
      { name: 'Initialization', colour: 'yellow', meaning: 'initialising, then receiving', at: [0, 2] },
      { name: 'Dev', colour: 'red', meaning: 'an error while initialising or in a cryptographic process', at: [0, 3] },
    ],
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el6070/1153441675.html', 'https://www.beckhoff.com/en-us/products/i-o/ethercat-terminals/el-ed6xxx-communication/el6070.html'],
    confidence: 'medium',
    notes: 'Licence key terminal: no contacts in use. From the EL6070\'s page (the -0033 differs only by its licences).',
  },
  {
    type: 'EL6224',
    columns: 2,
    rows: 8,
    contacts: [
      { n: 1, label: 'Input 1', kind: 'signal', comment: 'IO-Link port 1' },
      { n: 2, label: '+ 24 V', kind: 'power+' },
      { n: 3, label: 'Input 2', kind: 'signal', comment: 'IO-Link port 2' },
      { n: 4, label: '+ 24 V', kind: 'power+' },
      { n: 5, label: 'Input 3', kind: 'signal', comment: 'IO-Link port 3' },
      { n: 6, label: '+ 24 V', kind: 'power+' },
      { n: 7, label: 'Input 4', kind: 'signal', comment: 'IO-Link port 4' },
      { n: 8, label: '+ 24 V', kind: 'power+' },
      { n: 9, label: '+ 24 V', kind: 'power+' },
      { n: 10, label: '0 V', kind: 'power0' },
      { n: 11, label: '+ 24 V', kind: 'power+' },
      { n: 12, label: '0 V', kind: 'power0' },
      { n: 13, label: '+ 24 V', kind: 'power+' },
      { n: 14, label: '0 V', kind: 'power0' },
      { n: 15, label: '+ 24 V', kind: 'power+' },
      { n: 16, label: '0 V', kind: 'power0' },
    ],
    leds: [
      ...[0, 2, 4, 6].map((r): FaceLed => ({ ...RUN, at: [0, r] })),
      ...[0, 2, 4, 6].map((r, i): FaceLed => ({ name: `State Ch. ${i + 1}`, colour: 'green', meaning: 'on / off: the signal (STD in / out); flashing twice: IO-Link starting; flashing: IO-Link running', at: [1, r] })),
    ],
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el6224/22432034677273397643.html', 'https://www.beckhoff.com/en-en/products/i-o/ethercat-terminals/el-ed6xxx-communication/el6224.html'],
    confidence: 'high',
    notes: 'HD housing, 16 points (1 … 8 left, 9 … 16 right). Power the IO-Link devices from this terminal\'s 24 V. Which State LED is which channel: by their order.',
  },
  {
    type: 'EL6900',
    columns: 2,
    rows: 4,
    contacts: unused(8),
    leds: [
      { name: 'State 1', colour: 'green' },
      { name: 'State 2', colour: 'green' },
      { name: 'State 3', colour: 'green' },
      { name: 'State 4', colour: 'green', meaning: 'State 1 … 4: 4 only: no project; 3 + 4: project, Pre-OP; all: project, OP' },
      { name: 'Diag 1', colour: 'green', meaning: 'a project is stored' },
      { name: 'Diag 2', colour: 'red', meaning: 'process variable errors' },
      { name: 'Diag 3', colour: 'red', meaning: 'with Diag 4: an error of µC1 (flashing) or µC2 (off): return the terminal' },
      { name: 'Diag 4', colour: 'red', meaning: '1 flash: function block error; 2: communication; 3: both; on: supply or temperature out of range' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/automation/twinsafe/el6900en.pdf (5.2.4.4 EL6900/EL6910 pin assignment, 5.4 LEDs)'],
    confidence: 'high',
    notes: 'TwinSAFE logic terminal: no contacts in use.',
  },
  {
    type: 'EL6910',
    columns: 2,
    rows: 4,
    contacts: unused(8),
    leds: [
      { name: 'State 1', colour: 'green' },
      { name: 'State 2', colour: 'green' },
      { name: 'State 3', colour: 'green' },
      { name: 'State 4', colour: 'green', meaning: 'State 1 … 4: 4 only: no project; 3 + 4: loaded, not RUN; 1 + 3 + 4: RUN, customising active; all: RUN' },
      { name: 'Diag 1', colour: 'green', meaning: 'on: supply, temperature and internal tests in range' },
      { name: 'Diag 2', colour: 'red', meaning: 'flashing: a logic or environment error code (by Diag 1); with Diag 3 and 4: global shutdown / fault' },
      { name: 'Diag 3', colour: 'red', meaning: 'global fault or shutdown on µC1' },
      { name: 'Diag 4', colour: 'red', meaning: 'global fault or shutdown on µC2' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/automation/twinsafe/el6910_en.pdf (4.4 EL6900/EL6910 pin assignment, 5.17 LEDs)'],
    confidence: 'high',
    notes: 'TwinSAFE logic terminal: no contacts in use.',
  },
  {
    type: 'EL9011',
    columns: 0,
    rows: 0,
    contacts: [],
    leds: [],
    ledColumns: 1,
    source: ['https://infosys.beckhoff.com/content/1033/el9xxx/1246705163.html'],
    confidence: 'high',
    notes: 'End cap: closes the E-bus; no contacts, no LEDs.',
  },
  {
    type: 'EL9227-5500',
    columns: 2,
    rows: 4,
    contacts: [
      { n: 1, label: 'Digital input 1', kind: 'in', comment: 'switches output 1 (falling edge); "I1"' },
      { n: 2, label: '24 V supply', kind: 'power+', comment: 'infeed; with 6' },
      { n: 3, label: '0 V supply', kind: 'power0', comment: 'with 7 and the 0 V power contact' },
      { n: 4, label: 'Digital input 2', kind: 'in', comment: 'switches output 2; "I2"' },
      { n: 5, label: 'Protected output 1', kind: 'out', comment: 'protected +24 V, also on the + power contact; "O1"' },
      { n: 6, label: '24 V supply', kind: 'power+', comment: 'with 2' },
      { n: 7, label: '0 V supply', kind: 'power0', comment: 'with 3 and the 0 V power contact' },
      { n: 8, label: 'Protected output 2', kind: 'out', comment: 'protected +24 V (no power contact); "O2"' },
    ],
    leds: [
      { name: 'Button LED 1', colour: 'green', meaning: 'output 1: green on / off / programming; orange: pre-warning or disabled; red: tripped (the push-button: on / off / reset)', at: [0, 0] },
      { ...RUN, at: [0, 1] },
      { name: 'Status LED 1', colour: 'orange', meaning: 'orange: output 1 under / overvoltage; red flashing: cooling', at: [1, 1] },
      { name: 'Ready LED', colour: 'green', meaning: 'green: ready; orange: programming; red: no 24 V, an initialisation or wiring error', at: [0, 2] },
      { name: 'Status LED 2', colour: 'orange', meaning: 'orange: output 2 under / overvoltage; red flashing: cooling', at: [1, 2] },
      { name: 'Button LED 2', colour: 'green', meaning: 'output 2, as Button LED 1', at: [0, 3] },
    ],
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el922x/5204726411.html', 'https://www.beckhoff.com/en-us/products/i-o/ethercat-terminals/el-ed9xxx-system/el9227-5500.html'],
    confidence: 'medium',
    notes: 'The + power contact carries protected output 1, not the infeed. The LED field\'s layout: from a small drawing. Sum current at most 10 A.',
  },
  {
    type: 'EL9410',
    columns: 2,
    rows: 4,
    contacts: [
      { n: 1, label: '+24 V for E-bus', kind: 'power+', comment: 'Us' },
      { n: 2, label: '+24 V', kind: 'power+', comment: 'with 6 and the + power contact' },
      { n: 3, label: '0 V', kind: 'power0', comment: 'with 7 and the 0 V power contact' },
      { n: 4, label: 'PE', kind: 'pe', comment: 'with 8' },
      { n: 5, label: '0 V for E-bus', kind: 'power0' },
      { n: 6, label: '+24 V', kind: 'power+', comment: 'with 2 and the + power contact' },
      { n: 7, label: '0 V', kind: 'power0', comment: 'with 3 and the 0 V power contact' },
      { n: 8, label: 'PE', kind: 'pe', comment: 'with 4' },
    ],
    leds: [
      { name: 'Power (E-bus)', colour: 'green', meaning: '24 V at the E-bus supply', at: [0, 0] },
      { name: 'Power', colour: 'green', meaning: '24 V at the supply', at: [1, 0] },
      { name: 'Diag Us', colour: 'red', meaning: 'Us or Up below 17 V', at: [0, 1] },
      { name: 'Diag Up', colour: 'red', meaning: 'Us or Up below 17 V', at: [1, 1] },
      { ...RUN, at: [0, 2] },
    ],
    ledColumns: 2,
    source: ['https://infosys.beckhoff.com/content/1033/el9xxx/1246731659.html'],
    confidence: 'high',
    notes: 'A power feed: the E-bus and the power contacts (to its right) fed anew.',
  },
  {
    type: 'ELM3142-0000',
    columns: 1,
    rows: 8,
    contacts: [
      { n: 1, label: 'X1.1 Ch.1+', kind: 'in', channel: 1 },
      { n: 2, label: 'X1.2 Ch.1-', kind: 'in' },
      { n: 3, label: 'X1.3 +24 V', kind: 'power+', comment: 'from the + power contact: sensor supply' },
      { n: 4, label: 'X1.4 0 V', kind: 'power0', comment: 'from the 0 V power contact' },
      { n: 5, label: 'X2.1 Ch.2+', kind: 'in', channel: 2 },
      { n: 6, label: 'X2.2 Ch.2-', kind: 'in' },
      { n: 7, label: 'X2.3 +24 V', kind: 'power+', comment: 'from the + power contact' },
      { n: 8, label: 'X2.4 0 V', kind: 'power0', comment: 'from the 0 V power contact' },
    ],
    leds: [
      { ...RUN, at: [0, 0] },
      { name: 'OK Ch.1', colour: 'green', meaning: 'green: no error; red: an error (range, overload, saturation …); flashing: self-test', at: [0, 1] },
      { name: 'OK Ch.2', colour: 'green', meaning: 'as OK Ch.1', at: [0, 2] },
    ],
    ledColumns: 1,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-terminals/elm3xxx_en.pdf (3.8.1 ELM314x, 8.13 Power contacts ELM314x)', 'https://www.beckhoff.com/en-us/products/i-o/ethercat-terminals/elmxxxx-measurement-technology/elm3142-0000.html'],
    confidence: 'medium',
    notes: '30 mm, two 4-pin push-in plugs (X1, X2). The pins: from a schematic, not a table; at most 2 A from the supply pins.',
  },
];

// (a coupler's 8 spring terminals, as Beckhoff labels them: no numbers; left column then right, top to bottom)
const couplerSupply = (us: string): FaceContact[] => [
  { n: 1, label: `24V (${us} 24 V)`, kind: 'power+', comment: 'the coupler\'s supply' },
  { n: 2, label: '+ (Up 24 V)', kind: 'power+', comment: 'the power contacts\' feed, with the + beside it' },
  { n: 3, label: '- (Up 0 V)', kind: 'power0', comment: 'with the - beside it' },
  { n: 4, label: 'PE', kind: 'pe' },
  { n: 5, label: `0V (${us} 0 V)`, kind: 'power0' },
  { n: 6, label: '+ (Up 24 V)', kind: 'power+' },
  { n: 7, label: '- (Up 0 V)', kind: 'power0' },
  { n: 8, label: 'PE', kind: 'pe' },
];
const LINK_ACT = 'off: no link; on: linked; flashing: traffic';
const boxPower: FacePort[] = [
  { name: 'X60', comment: 'supply in (M8 plug, 4-pin): 1 +24 V Us, 2 +24 V Up, 3 GND Us, 4 GND Up' },
  { name: 'X61', comment: 'supply on (M8 socket, 4-pin): the same, bridged to X60' },
];
const boxEtherCat: FacePort[] = [
  { name: 'X40 IN', comment: 'EtherCAT in (M8, 4-pin): 1 Tx+, 2 Rx+, 3 Rx-, 4 Tx-' },
  { name: 'X41 OUT', comment: 'EtherCAT on (M8, 4-pin)' },
];

const COUPLERS: TerminalFace[] = [
  {
    type: 'EK1100',
    columns: 2,
    rows: 4,
    unnumbered: true,
    contacts: couplerSupply('Us'),
    ports: [{ name: 'X1 IN', comment: 'EtherCAT in (RJ45): port A' }, { name: 'X2 OUT', comment: 'EtherCAT on (RJ45): port C' }],
    leds: [
      { name: 'Us', colour: 'green', meaning: '24 V at the coupler' },
      { name: 'Up', colour: 'green', meaning: '24 V at the power contacts' },
      { name: 'Link/Act E-Bus', colour: 'green', meaning: LINK_ACT },
      { ...RUN, meaning: 'off INIT; flashing PREOP; single flash SAFEOP; on OP; flickering BOOTSTRAP' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-terminals/ek110x_ek15xx_en.pdf (4.13 Power supply, 6.1 Diagnostic LEDs)', 'https://infosys.beckhoff.com/content/1033/ek110x_ek15xx/1880439691.html', 'https://infosys.beckhoff.com/content/1033/ek110x_ek15xx/1880420747.html'],
    confidence: 'high',
    notes: 'Beckhoff numbers neither contact: L / R and the row. Port B: the E-bus to the right. The RJ45 sockets\' own LEDs: Link/Act of X1 / X2.',
  },
  {
    type: 'EK1101',
    columns: 2,
    rows: 4,
    unnumbered: true,
    contacts: couplerSupply('Us'),
    ports: [{ name: 'X1 IN', comment: 'EtherCAT in (RJ45): port A' }, { name: 'X2 OUT', comment: 'EtherCAT on (RJ45): port C' }],
    sockets: [
      { name: 'x256', label: 'ID switch x256', comment: 'hex digit' },
      { name: 'x16', label: 'ID switch x16', comment: 'hex digit' },
      { name: 'x1', label: 'ID switch x1', comment: 'hex digit (ID 0 … 4095)' },
    ],
    socketOrder: 'columns',
    leds: [
      { name: 'Us', colour: 'green', meaning: '24 V at the coupler' },
      { name: 'Up', colour: 'green', meaning: '24 V at the power contacts' },
      { name: 'Link/Act E-Bus', colour: 'green', meaning: LINK_ACT },
      RUN,
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-terminals/ek110x_ek15xx_en.pdf (2.2.2, 6.2)', 'https://infosys.beckhoff.com/content/1033/ek110x_ek15xx/7636275083.html'],
    confidence: 'medium',
    notes: 'The EK1100 with an ID switch (3 rotary switches; their labels from the EK1101-0080\'s drawing). Contacts: L / R and the row.',
  },
  {
    type: 'EK1110',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: [{ name: 'X1', comment: 'EtherCAT on (RJ45), from the end of this block' }],
    leds: [
      { name: 'Run', colour: 'green', meaning: 'off INIT; flashing PREOP; flashing slowly SAFEOP; on OP; flashing fast BOOTSTRAP' },
      { name: 'Link/Act X1', colour: 'green', meaning: LINK_ACT },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-terminals/ek1110_en.pdf (2.1, 6.1)', 'https://infosys.beckhoff.com/content/1033/ek1110/2021649803.html'],
    confidence: 'high',
    notes: 'An EtherCAT extension at the end of a block, supplied from the E-bus. Its spring terminals (in the drawing) are not described in the manual: not drawn.',
  },
  {
    type: 'EK1122',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: [{ name: 'X1', comment: 'junction port D (3): EtherCAT client 1, the frame goes here first' }, { name: 'X2', comment: 'junction port B (1): EtherCAT client 2' }],
    leds: [
      { name: 'Run', colour: 'green', meaning: 'off INIT; single flash PREOP; flashing SAFEOP; on OP; flickering BOOTSTRAP (as its manual writes)' },
      { name: 'Link/Act X1', colour: 'green', meaning: LINK_ACT },
      { name: 'Link/Act X2', colour: 'green', meaning: LINK_ACT },
    ],
    ledColumns: 1,
    source: ['https://download.beckhoff.com/download/Document/io/ethercat-terminals/ek112x_ek15xx_en.pdf (2.1.1, 3.1.2, 4.1)', 'https://infosys.beckhoff.com/content/1033/ek112x_ek15xx/10345231499.html', 'https://infosys.beckhoff.com/content/1033/ek112x_ek15xx/1881498891.html'],
    confidence: 'high',
    notes: 'A 2-port junction, supplied from the E-bus. Ports: A from the left, C to the right, X1 = D, X2 = B (Beckhoff calls neither IN or OUT).',
  },
  {
    type: 'EK1200-5000',
    columns: 2,
    rows: 4,
    unnumbered: true,
    contacts: [
      { n: 1, label: '24V (Us)', kind: 'power+', comment: 'the CX\'s supply (the PSU: 4 A)' },
      { n: 2, label: '+ (Up)', kind: 'power+', comment: 'the power contacts\' feed' },
      { n: 3, label: '- (Up 0 V)', kind: 'power0' },
      { n: 4, label: 'PE', kind: 'pe' },
      { n: 5, label: '0V (Us)', kind: 'power0', comment: 'at the same potential as PE' },
      { n: 6, label: '+ (Up)', kind: 'power+' },
      { n: 7, label: '- (Up 0 V)', kind: 'power0' },
      { n: 8, label: 'PE', kind: 'pe' },
    ],
    leds: [
      { name: 'Us 24V', colour: 'green', meaning: 'the CPU\'s supply' },
      { name: 'Up 24V', colour: 'green', meaning: 'the terminals\' supply (power contacts)' },
      { name: 'L/A', colour: 'green', meaning: 'E-bus: off not connected; on connected; flashing traffic' },
    ],
    ledColumns: 2,
    source: ['Beckhoff EK12xx.xml (TwinCAT\'s ESI: "EK1200-5000 EtherCAT Power supply (2A E-Bus)")', 'https://download.beckhoff.com/download/document/ipc/embedded-pc/embedded-pc-cx/cx5000_en.pdf (3.4 Power supply, 6.1.3 LEDs)', 'https://infosys.beckhoff.com/content/1033/cx5000_hw/212987275.html'],
    confidence: 'medium',
    notes: 'Not a module of its own: the E-bus coupler in a CX50x0 Embedded PC\'s power supply (2 A E-bus). Drawn from the CX5000 manual; another CX may differ.',
  },
  {
    type: 'EP1098-0001',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: boxEtherCat,
    portsBottom: boxPower,
    sockets: Array.from({ length: 8 }, (_, i): FaceSocket => ({ name: String(i), label: `Input ${i}`, channel: i + 1, dir: 'in', comment: 'M8, 3-pin: 1 +24 V Us, 3 GND, 4 the input' })),
    socketOrder: 'alternate',
    leds: [
      { name: 'L/A IN', colour: 'green', meaning: LINK_ACT },
      { name: 'L/A OUT', colour: 'green', meaning: LINK_ACT },
      { name: 'Run', colour: 'green', meaning: 'off INIT; flashing PREOP; flashing now and then SAFEOP; on OP' },
      { name: 'Us', colour: 'green', meaning: 'Us there (red: the sensor supply overloaded, all off)' },
      { name: 'Up', colour: 'green', meaning: 'Up there' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-box/ep1xxx_en.pdf (3.3 EP1098-0001, 4.2)', 'https://infosys.beckhoff.com/content/1033/ep1xxx/1170709259.html'],
    confidence: 'high',
    notes: '8 inputs, ground (negative) switching, 10 µs. Each socket\'s LED: its input high. Socket n = TwinCAT\'s Channel n+1 (by their order).',
    width: 44,
  },
  {
    type: 'EP1111-0000',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: boxEtherCat,
    portsBottom: boxPower,
    sockets: [
      { name: 'X 1', label: 'ID switch X 1', comment: 'units 0 … 9' },
      { name: 'X 10', label: 'ID switch X 10', comment: 'tens 0 … 9' },
      { name: 'X 100', label: 'ID switch X 100', comment: 'hundreds 0 … 9 (ID 0 … 999, read as its ID)' },
    ],
    socketOrder: 'columns',
    leds: [
      { name: 'L/A IN', colour: 'green', meaning: LINK_ACT },
      { name: 'L/A OUT', colour: 'green', meaning: LINK_ACT },
      { name: 'Run', colour: 'green', meaning: 'off INIT; flashing PREOP; flashing now and then SAFEOP; on OP' },
      { name: 'Us', colour: 'green', meaning: 'Us there' },
      { name: 'Up', colour: 'green', meaning: 'Up there' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/Document/io/ethercat-box/ep1111-0000en.pdf (3.1, 3.2, 3.4, 4.2.2, 4.3)', 'https://infosys.beckhoff.com/content/1033/ep1111-0000/1170715275.html'],
    confidence: 'high',
    notes: 'An ID switch box (no I/O).',
    width: 44,
  },
  {
    type: 'EP7047-1032',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: [{ name: 'X40 IN', comment: 'EtherCAT in (M8, 4-pin)' }, { name: 'X41 OUT', comment: 'EtherCAT on (M8, 4-pin)' }],
    portsBottom: [
      { name: 'X60 IN', comment: 'supply in (7/8", 5-pin): 1 GND Up, 2 GND Us, 3 FE, 4 +24 V Us, 5 +48 V Up (8 … 48 V, the DC link)' },
      { name: 'X61 OUT', comment: 'supply on (7/8", 5-pin): the same' },
    ],
    sockets: [
      { name: 'X01', label: '(no function)' },
      { name: 'X02', label: '(no function)' },
      { name: 'X03', label: 'Encoder, 5 V', comment: 'M12: 1 GND, 2 5 V, 3 A, 4 B, 5 C; X03 or X04, not both' },
      { name: 'X04', label: 'Encoder, 24 V', comment: 'M12: 1 GND, 2 24 V Us, 3 A, 4 B, 5 C' },
      { name: 'X05', label: 'Limit switches', comment: 'M12: 1 24 V, 2 Di2, 3 0 V, 4 Di1, 5 FE (LEDs: Di1 left, Di2 right)' },
      { name: 'X06', label: 'Latch input', comment: 'M12: 1 24 V, 3 0 V, 4 latch, 5 FE' },
      { name: 'X07', label: 'Brake output', comment: 'M12: 3 GND, 4 brake (24 V, 0.5 A), 5 FE' },
      { name: 'X08', label: 'Stepper motor', comment: 'M12: 1 A1, 2 A2 (winding A), 3 B1, 4 B2 (winding B), 5 FE; 5 A a phase' },
    ],
    socketOrder: 'columns',
    leds: [
      { name: 'Link/Act X40', colour: 'green', meaning: LINK_ACT },
      { name: 'Link/Act X41', colour: 'green', meaning: LINK_ACT },
      { name: 'Run', colour: 'green', meaning: 'off INIT; flashing PREOP; flashing now and then SAFEOP; on OP' },
      { name: 'Supply 1', colour: 'green', meaning: 'a supply there (Us or Up: which LED is which, not in the manual)' },
      { name: 'Supply 2', colour: 'green', meaning: 'a supply there' },
    ],
    ledColumns: 2,
    source: ['https://download.beckhoff.com/download/document/io/ethercat-box/ep7047-1032en.pdf (2.2, 3.2.1 … 3.2.8)', 'https://infosys.beckhoff.com/content/1033/ep7047-1032/8736907787.html'],
    confidence: 'medium',
    notes: 'A stepper motor box (48 V, 5 A) with an encoder. Its sockets\' other LEDs: not in the manual.',
    width: 52,
  },
];

// Other vendors' devices on Kval's machines (from their makers' manuals)
const smc = (type: string, outputs: number): TerminalFace => ({
  type,
  columns: 0,
  rows: 0,
  contacts: [],
  sockets: [
    { name: 'BUS OUT', label: 'EtherCAT out', comment: 'M12 D-coded, 4-pin: 1 TD+, 2 RD+, 3 TD-, 4 RD-' },
    { name: 'BUS IN', label: 'EtherCAT in', comment: 'M12 D-coded, 4-pin: 1 TD+, 2 RD+, 3 TD-, 4 RD-' },
    { name: 'PWR', label: 'Power', comment: 'M12 A-coded, 5-pin: 1 SV24V (valves +24 V), 2 SV0V, 3 SI24V (the unit +24 V), 4 SI0V, 5 not used' },
    { name: 'FE', label: 'Functional earth', comment: 'M3 screw (100 ohm or less to ground)' },
  ],
  socketOrder: 'columns',
  leds: [
    { name: 'RUN', colour: 'green', meaning: 'off INIT; flashing PREOP; single flash SAFEOP; flickering BOOTSTRAP; on OP' },
    { name: 'L/A IN', colour: 'green', meaning: 'BUS IN: off no link; on link; flickering traffic' },
    { name: 'L/A OUT', colour: 'green', meaning: 'BUS OUT: off no link; on link; flickering traffic' },
    { name: 'PWR', colour: 'green', meaning: 'the unit\'s supply there' },
    { name: 'PWR(V)', colour: 'green', meaning: 'the valves\' supply there (off: missing, or 19 V or less)' },
  ],
  ledColumns: 5,
  source: ['https://static.smc.eu/binaries/content/assets/smc_global/product-documentation/operation-manuals/en/om_ex260_ethercat_en-f.pdf', 'https://static.smc.eu/binaries/content/assets/smc_global/product-documentation/installationmaintenance-manuals/en/im_ex260_ethercat_en.pdf'],
  confidence: 'high',
  notes: `SMC's EtherCAT SI unit on the valve manifold: ${outputs} outputs, PNP (0 … ${outputs - 1}: output n = byte n div 8, bit n mod 8). Standard wiring: station 1 = outputs 0 (solenoid A) and 1 (B), station 2 = 2 and 3, …; a single solenoid skips its B number (custom wiring: the manifold's wiring sheet). LEDs on the top face; no switches (addresses automatic). Valves 22.8 … 26.4 V, 2 A.`,
  width: 60,
});

const OTHERS: TerminalFace[] = [
  smc('EX260-SEC1', 32),
  smc('EX260-SEC3', 16),
  {
    type: 'i550',
    // X3: 8 columns of 2 (upper / lower), no numbers printed
    columns: 8,
    rows: 2,
    unnumbered: true,
    contacts: [
      ['24E', '24E', 'power+', '24 V in: the control electronics\' own supply (max. 1 A)'],
      ['GND', 'GND', 'power0', ''],
      ['DO1', 'AI1', 'signal', 'DO1: digital output (100 mA, with 24V); AI1: analog input (voltage or current)'],
      ['DI1', 'AI2', 'in', 'AI2: analog input'],
      ['DI2', '10V', 'in', '10V: out, for a potentiometer (1 … 10 kOhm, 10 mA)'],
      ['DI3', 'GND', 'in', 'DI3: also a frequency / encoder input'],
      ['DI4', 'AO1', 'in', 'DI4: also a frequency / encoder input; AO1: analog output'],
      ['DI5', '24V', 'in', '24V: out, for the digital inputs (100 mA, with DO1)'],
    ].flatMap(([up, low, kind, comment], i): FaceContact[] => [
      { n: i * 2 + 1, label: `X3 ${up}`, kind: kind as FaceContact['kind'], ...(comment ? { comment } : {}) },
      { n: i * 2 + 2, label: `X3 ${low}`, kind: low === 'GND' ? 'power0' : low === '24E' || low === '24V' ? 'power+' : low === '10V' ? 'signal' : (kind as FaceContact['kind']) },
    ]),
    ports: [{ name: 'X246 IN', comment: 'EtherCAT in (RJ45); its L/A LED: on linked, flickering traffic' }, { name: 'X247 OUT', comment: 'EtherCAT out (RJ45)' }],
    portsBottom: [
      { name: 'X9', comment: 'relay (changeover): NO, NC, COM (from the diagram); 240 V AC 3 A, 24 V DC 2 A; not for a holding brake' },
      { name: 'X1', comment: 'STO (safety variants only): SIA, GS, SIB (the order: check the manual)' },
      { name: 'X109', comment: 'PTC / thermal contact: T1, T2 (a jumper from the factory)' },
    ],
    leds: [
      { name: 'RUN', colour: 'green', meaning: 'EtherCAT: off INIT; flashing PREOP; single flash SAFEOP; on OP; flickering BOOTSTRAP' },
      { name: 'ERR (EtherCAT)', colour: 'red', meaning: 'off no error; single flash a local error (to SAFEOP); double flash watchdog timeout; flashing an invalid configuration' },
      { name: 'RDY', colour: 'blue', meaning: 'with ERR: 1 Hz ready (disabled); on enabled; 2 Hz disabled …' },
      { name: 'ERR', colour: 'red', meaning: 'the inverter\'s error / warning (with RDY: on = an error; fast = a warning)' },
    ],
    ledColumns: 2,
    source: ['Lenze: Operating instructions i550 cabinet frequency inverter 0.25 … 132 kW, 01/2023 (https://media.automation24.com/manual/i550.pdf)', 'Lenze: i550 PROFINET, EtherCAT, EtherNet/IP commissioning manual 13516178 (https://www.precision-elec.com/wp-content/uploads/2017/02/Lenze-AC-Tech-i550-Cabinet-VFD-Ethernet-Network-Commissioning-Reference-Manual.pdf)'],
    confidence: 'medium',
    notes: 'The EtherCAT control unit (Standard I/O): X3 as its label strip, 8 columns of 2 (no numbers printed: L/R are the columns\' upper / lower). Its rotary switches x16 / x1: the EtherCAT identifier (0x00: from the parameter). The power terminals (X100, X105, PE) depend on the frame size: not drawn. Lenze\'s manuals, from distributors\' copies.',
  },
];

// Beckhoff's servo drives (AX5000, AX8000): their connectors as the manuals list them (pins in each one's comment)
const AX5_SRC = ['https://download.beckhoff.com/download/document/motion/ax5000_system_manual_hw2_en.pdf (5.x connections, 6.2.5 dimensions, display)'];
const AX8_SRC = ['https://download.beckhoff.com/download/document/motion/ax8000_ba_en.pdf', 'https://infosys.beckhoff.com/content/1033/ax8000_ba/9840551435.html'];
const AX5_X11 = 'feedback, high resolution (EnDat / BiSS, Hiperface, SinCos, TTL): D-sub 15, max. 250 mA (the pins: by the encoder type, in the manual)';
const AX5_X12 = 'feedback, resolver or analog Hall: D-sub 15 (resolver: 1 temperature, 3/10 COS-/+, 4/11 SIN-/+, 5/12 REF-/+)';
const ax5 = (type: string, two: boolean, note: string): TerminalFace => ({
  type,
  columns: 0,
  rows: 0,
  contacts: [],
  ports: [
    { name: 'X11', comment: `channel A ${AX5_X11}` },
    { name: 'X12', comment: `channel A ${AX5_X12}` },
    ...(two ? [{ name: 'X21', comment: `channel B ${AX5_X11}` }, { name: 'X22', comment: `channel B ${AX5_X12}` }] : []),
    { name: 'X06', comment: 'digital I/O: 24 (Up for sensors), inputs 0 … 6, 7 (input or output), 0V' },
    { name: 'X04 IN', comment: 'EtherCAT in (RJ45); a status LED beside it' },
    { name: 'X05 OUT', comment: 'EtherCAT out (RJ45); a status LED beside it' },
    { name: 'X03', comment: '24 V: Up (24 V ±10 %: peripherals, the brake), Us (24 V: the electronics), GND; one supply: bridge Up and Us' },
    { name: 'X02', comment: 'DC link: DC+, DC- (max. 875 V): coupling, or an external braking resistor' },
    { name: 'X01', comment: 'mains: L1, L2, L3/N, PE (1-phase 100 … 240 V: phase on L1, neutral on L3/N; 3-phase 100 … 480 V)' },
  ],
  portsBottom: [
    { name: 'X13', comment: 'channel A motor: U, V, W, PE; the shield by the shroud' },
    { name: 'X14', comment: 'channel A: T- / T+ (OCT, temperature), PE, B- / B+ (the brake, max. 2.2 A)' },
    ...(two ? [{ name: 'X23', comment: 'channel B motor: U, V, W, PE' }, { name: 'X24', comment: 'channel B: T- / T+, PE, B- / B+' }] : []),
  ],
  leds: [
    { name: 'Display', colour: 'white', meaning: '2 lines (by default: the EtherCAT state, the DC link voltage); an error: its code and text, flashing' },
    { name: 'EtherCAT IN', colour: 'green', meaning: 'beside X04 (its meaning: not in the manual)' },
    { name: 'EtherCAT OUT', colour: 'green', meaning: 'beside X05 (its meaning: not in the manual)' },
  ],
  ledColumns: 1,
  source: AX5_SRC,
  confidence: 'medium',
  notes: `${note} 92 mm. No STO connector of its own (an optional safety card in the X3x slot). The places: from the manual's photo (an AX5201). The pin tables: high confidence; the connectors' places and the LEDs: medium.`,
  width: 52,
});
const AX8_X13 = 'motor: PE, U, V, W, T- / T+ (OCT, temperature), B- / B+ (the brake)';
const ax8 = (type: string, two: boolean, brake: string, note: string, width: number): TerminalFace => ({
  type,
  columns: 0,
  rows: 0,
  contacts: [],
  ports: [
    { name: 'Display', comment: two ? 'E (EtherCAT) in the middle; A, S for channel A left, channel B right' : 'E (EtherCAT), A (the axis), S (safety), D (debug firmware)' },
    { name: 'X15', comment: `channel A digital inputs 1 … 4 (push-in): 1, 2 30 µs (TwinSAFE inputs on -x1xx / -x2xx), 3, 4 15 µs` },
    ...(two ? [{ name: 'X25', comment: 'channel B digital inputs 1 … 4 (as X15)' }] : []),
    { name: 'X11', comment: 'channel A feedback: D-sub 15 (on the -0x10 / -0x20 variants; -0x00: OCT / EnDat 3 only): 2 GND, 4 5 V, 5 / 13 DX+ / DX-, 8 / 15 CLK+ / CLK-, 6 11 V' },
    ...(two ? [{ name: 'X21', comment: 'channel B feedback (as X11, -0x10 only)' }] : [{ name: 'X12', comment: 'a second feedback (-0x10 only; EnDat / BiSS)' }]),
    { name: 'AX-Bridge', comment: '24 V and DC link / PE quick couplings and the EtherCAT link to the next module (no RJ45)' },
  ],
  portsBottom: [
    { name: 'X13', comment: `channel A ${AX8_X13}; the brake max. ${brake}` },
    ...(two ? [{ name: 'X23', comment: `channel B ${AX8_X13}; the brake max. ${brake}` }] : []),
  ],
  leds: [
    { name: 'E', colour: 'green', meaning: 'green: the EtherCAT master active; flashing: its configuration not; red flashing: an EtherCAT error' },
    { name: 'A', colour: 'green', meaning: 'green: enabled; flashing fast: initialising; slowly: disabled; red: INIT; red flashing: an error; green-red: an error reaction' },
    { name: 'S', colour: 'green', meaning: 'safety variants: green no safety error; red: in STO' },
    { name: 'D', colour: 'green', meaning: 'flashing: debug firmware' },
  ],
  ledColumns: 4,
  source: AX8_SRC,
  confidence: 'medium',
  notes: `${note} The connectors' places: from the manual's renders. The D-subs depend on the variant (its -0x.. digits).`,
  width,
});

const DRIVES: TerminalFace[] = [
  ax5('AX5106', false, 'A 1-channel servo drive, 6 A (1-phase 4.5 A).'),
  ax5('AX5112', false, 'A 1-channel servo drive, 12 A (3-phase only).'),
  ax5('AX5206', true, 'A 2-channel servo drive, 2 x 6 A.'),
  ax8('AX8108', false, '1 A', 'A 1-axis module, 8 A (peak 20 A), 60 mm.', 44),
  ax8('AX8118', false, '2 A', 'A 1-axis module, 18 A, 90 mm (its front: from a dimension sketch).', 56),
  ax8('AX8206', true, '1 A', 'A 2-axis module, 2 x 6 A, 60 mm.', 48),
  {
    type: 'AX8640',
    columns: 0,
    rows: 0,
    contacts: [],
    ports: [
      { name: 'Display', comment: 'E (EtherCAT), P (power: DC link), D (debug)' },
      { name: 'X04 IN', comment: 'EtherCAT in (RJ45)' },
      { name: 'X05 OUT', comment: 'EtherCAT out (RJ45)' },
      { name: 'Test', comment: 'measuring sockets: +24V DC, GND, +DC, -DC (top to bottom)' },
      { name: 'AX-Bridge', comment: '2 x 24 V, 3 x DC link / PE quick couplings to the next module' },
    ],
    portsBottom: [
      { name: 'X01', comment: 'mains (3 x 200 … 480 V): L3/N, L2, L1, PE' },
      { name: 'X02', comment: '24VDC, GND, PE, RB- / RBint+ / RB+ (the braking resistor: RB- to RBint+ bridged for the internal one)' },
      { name: 'PE', comment: 'the grounding bolt' },
    ],
    leds: [
      { name: 'E', colour: 'green', meaning: 'green: the EtherCAT master active; red flashing: an EtherCAT error' },
      { name: 'P', colour: 'green', meaning: 'green: mains on, DC link charged; flashing: charging / discharging; red: an error' },
      { name: 'D', colour: 'green', meaning: 'flashing: debug firmware' },
    ],
    ledColumns: 3,
    source: AX8_SRC,
    confidence: 'high',
    notes: 'The power supply module, 40 A, 90 mm; DC link max. 848 V; an internal braking resistor. E and P green: ready.',
    width: 56,
  },
];

export const TERMINAL_FACES: TerminalFace[] = [...DIGITAL, ...SYSTEM, ...COUPLERS, ...OTHERS, ...DRIVES];

/** A contact's place on the front, 1-based (a second block's 1' … 8': 9 … 16) */
export const contactPos = (n: number | string) => {
  const m = /^(\d+)('?)$/.exec(String(n).trim());
  return m ? Number(m[1]) + (m[2] ? 8 : 0) : 0;
};

/** A type's front ("EL1008", "EK1200-5000", "ELM3142-0000": its name, else its family's without the variant) */
export function faceFor(type: string): TerminalFace | null {
  const t = String(type || '').trim().toUpperCase();
  if (!t) return null;
  // (its own; else without its variant's blocks, one at a time: AX5106-0000-0203 -> AX5106-0000 -> AX5106)
  for (let k = t; ; ) {
    const f = TERMINAL_FACES.find((x) => x.type.toUpperCase() === k);
    if (f) return f;
    const shorter = k.replace(/-\d{4}$/, '');
    if (shorter === k) return null;
    k = shorter;
  }
}

/** A box's front (by its type: the project's ESI type, else its name's "(…)") */
export const faceOf = (box: IoBox) => faceFor((box.info?.type || box.info?.desc || box.product || '').split(/[\s,;]+/)[0]);

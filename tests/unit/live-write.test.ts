// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Writing a value from the Live tab (src/utils/liveWrite.ts): the text typed read as the variable's type: BOOL, an
// enum's member (by name, qualified or not, or its number), integers in ST's notations, REAL, TIME literals,
// STRING (its quotes off); a wrong one said why
import { parseDuration, parseLiveValue } from '../../src/utils/liveWrite.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const val = (text: string, type?: string) => {
  const r = parseLiveValue(text, type, { types: new Map([['e_mode', new Map([[0, 'Off'], [1, 'Auto'], [2, 'Manual']])]]) } as never);
  return 'error' in r ? `!${r.error}` : JSON.stringify(r.value);
};

expect(val('TRUE', 'BOOL') === 'true' && val('false', 'BOOL') === 'false' && val('1', 'BOOL') === 'true' && val('yes', 'BOOL').startsWith('!'), 'BOOL: TRUE / FALSE / 1 / 0, else said');
expect(val('Auto', 'E_Mode') === '1' && val('E_Mode.Manual', 'E_Mode') === '2' && val('0', 'E_Mode') === '0' && /^!One of Off, Auto, Manual/.test(val('Fast', 'E_Mode')), `an enum: its member by name or number (${val('Fast', 'E_Mode')})`);
expect(val('42', 'INT') === '42' && val('-7', 'DINT') === '-7' && val('16#FF', 'BYTE') === '255' && val('2#1010', 'WORD') === '10' && val('1_000', 'UDINT') === '1000' && val('1.5', 'INT').startsWith('!'), 'integers: decimal, 16# / 2#, underscores; a fraction refused');
expect(val('1.5', 'LREAL') === '1.5' && val('-2E3', 'REAL') === '-2000' && val('x', 'REAL').startsWith('!'), 'REAL / LREAL');
expect(val('T#2S', 'TIME') === '2000' && val('T#1s250ms', 'TIME') === '1250' && val('TIME#1M30S', 'TIME') === '90000' && val('500', 'TIME') === '500' && val('2 seconds', 'TIME').startsWith('!'), 'TIME: T#… or milliseconds');
expect(val("'Hello'", 'STRING(80)') === '"Hello"' && val('plain', 'STRING') === '"plain"' && val('', 'STRING') === '""', "STRING: its quotes off; empty allowed");
expect(parseDuration('T#-1S') === -1000 && parseDuration('T#1H') === 3600000 && parseDuration('abc') === null, 'durations');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

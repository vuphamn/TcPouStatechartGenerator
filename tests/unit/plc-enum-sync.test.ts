// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The loaded .TcDUT brought to the PLC's enum (Live): a value named otherwise renamed in the .TcDUT and the POU's code
// (two swapped names too), a value the .TcDUT lacks added with its value, one only the .TcDUT has left (said)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { applyPlcEnum, plcEnumChanges } from '../../src/utils/plcEnumSync.ts';
import { enumValueMap } from '../../src/utils/liveView.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const s = SAMPLES[0];
const mine = Object.fromEntries([...enumValueMap(s.dutContent)].map(([v, n]) => [String(v), n]));
const values = Object.keys(mine).map(Number).sort((a, b) => a - b);
const [v1, v2] = [values[1], values[2]];
const last = values[values.length - 1];
// (the PLC: v1 renamed, v1 and v2... swapped below; a new value; the last one gone)
const plc: Record<string, string> = { ...mine, [v1]: 'TABLEMANAGER_RENAMED', [last + 1]: 'TABLEMANAGER_NEW' };
delete plc[String(last)];
const ch = plcEnumChanges(s.dutContent, plc);
expect(ch.renames.length === 1 && ch.renames[0].to === 'TABLEMANAGER_RENAMED' && ch.adds[0]?.name === 'TABLEMANAGER_NEW' && ch.extra[0]?.value === last, `changes: a rename, an add, an extra (${JSON.stringify(ch)})`);
const r = applyPlcEnum(s.pouContent, s.dutContent, plc);
if ('error' in r) throw new Error(r.error);
const after = enumValueMap(r.dut);
expect(after.get(v1) === 'TABLEMANAGER_RENAMED' && after.get(last + 1) === 'TABLEMANAGER_NEW' && after.get(last) === mine[String(last)], 'the .TcDUT: renamed, added (its value), the extra kept');
expect(!new RegExp(`\b${mine[String(v1)]}\b`).test(r.pou) && /\bTABLEMANAGER_RENAMED\b/.test(r.pou), "the POU's code: the old name replaced");
// Two names swapped on the PLC
const swapped = applyPlcEnum(s.pouContent, s.dutContent, { ...mine, [v1]: mine[String(v2)], [v2]: mine[String(v1)] });
if ('error' in swapped) throw new Error(swapped.error);
const sw = enumValueMap(swapped.dut);
expect(sw.get(v1) === mine[String(v2)] && sw.get(v2) === mine[String(v1)] && !/KSS_TEMP_/.test(swapped.pou + swapped.dut), 'two names swapped: both renamed, no temporary name left');
console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { enumValueMap } from '../../src/utils/liveView.ts';
import {
  parseCondition, evaluate, buildEnumTables, buildGuardEdges, evaluateGuards, variablesToWatch, formatDurationLiteral, parseTimeLiteral,
} from '../../src/utils/liveGuards.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const ev = (text: string, vals: Record<string, any> = {}) => evaluate(parseCondition(text), { value: (p) => vals[p.toLowerCase()] });

// --- Expressions
expect(ev('a AND b', { a: true, b: false }) === false, 'AND');
expect(ev('a AND b', { b: false }) === false, 'unknown AND FALSE = FALSE');
expect(ev('a AND b', { b: true }) === undefined, 'unknown AND TRUE = unknown');
expect(ev('a OR b', { b: true }) === true, 'unknown OR TRUE = TRUE');
expect(ev('NOT a = b', { a: false, b: true }) === true, 'NOT binds tighter than =');
expect(ev('x.y > 5 AND z <= 2.5', { 'x.y': 6, z: 2.5 }) === true, 'comparisons');
expect(ev('t >= T#1s500ms', { t: 1500 }) === true, 'time literal');
expect(ev('n MOD 2 = 1', { n: 7 }) === true, 'MOD');
expect(ev('ABS(v) < 0.1', { v: -0.05 }) === true, 'ABS');
expect(ev('THIS^.bReady', { breddy: 1, bready: true }) === true, 'THIS^.x');
expect(parseCondition('fb.isReady()').k === 'opaque' && ev('fb.isReady() OR b', { b: true }) === true, 'method call opaque, OR TRUE decides');
expect((parseCondition('aX[i] > 0') as any).a.k === 'opaque', 'computed index opaque');
expect(ev('p^ AND ps^.b', { 'p^': true, 'ps^.b': true }) === true, 'pointer dereference read by name');
expect(ev('aX[2] > 0', { 'ax[2]': 3 }) === true, 'literal index');
expect(ev('iMode.1 AND NOT iMode.2', { imode: 2 }) === true && ev('iMode.0', { imode: 2 }) === false, 'bit access');
expect(ev('16#FF = 255') === true && ev('INT#5 + 2 = 7') === true, 'based / typed literals');
expect(ev("s = 'abc'", { s: 'abc' }) === true, 'strings');
expect(ev('a XOR b', { a: true, b: false }) === true, 'XOR');
expect(ev('a & b', { a: true, b: true }) === true, '& as AND');
expect(parseTimeLiteral('T#1h2m3s4ms') === 3723004 && formatDurationLiteral(3723004) === 'T#1h2m3s4ms', 'time literal round trip');
expect(parseCondition('IN := x').k === 'opaque', 'unparsable -> opaque');

// --- Table Manager: the model's edges match the diagram's
const tm = (SAMPLES as any[])[0];
for (const flow of [false, true]) {
  const model = generateStatechartModel(tm.dutContent, tm.pouContent, { flowchartOutput: flow });
  const edges = extractEdgesFromMermaid(model.markdown);
  const enums = buildEnumTables([tm.dutContent]);
  const guards = buildGuardEdges(model.edges, edges, model.stateVar, enums);
  const labeled = edges.filter((e) => e.from !== '[*]' && e.to !== '[*]');
  expect(guards.length === labeled.length, `${flow ? 'flowchart' : 'stateDiagram'}: ${guards.length} of ${labeled.length} edges matched`);
}
const model = generateStatechartModel(tm.dutContent, tm.pouContent, {});
const edges = extractEdgesFromMermaid(model.markdown);
const enums = buildEnumTables([tm.dutContent, `TYPE E_FeedMode : (FEEDMODE_OFF := 0, FEEDMODE_AUTO, FEEDMODE_FEEDTHRU); END_TYPE`]);
const guards = buildGuardEdges(model.edges, edges, model.stateVar, enums);
const names = enumValueMap(tm.dutContent);
const valueOf = (state: string) => [...names].find(([, n]) => n === state)![0];

// HOMMING_READY_TO_START: IF cmd_bHome THEN IF config_fHomePosition = 0 THEN ERROR ELSIF status_bHomed THEN IDLE ELSE HOMMING
const inputs = (state: string, values: Record<string, any>) => ({
  values, watched: {}, stateVar: model.stateVar, stateValue: valueOf(state), currentState: state, enums,
});
let inp = inputs('TABLEMANAGER_HOMMING_READY_TO_START', { cmd_bhome: true, 'smoutfeedstopaxis.config_fhomeposition': 12.5, 'smoutfeedstopaxis.status_bhomed': false });
const watch = variablesToWatch(guards, inp, false);
console.log('   watch (active HOMMING_READY_TO_START):', watch.join(', '));
expect(watch.some((w) => /cmd_bHome/i.test(w)) && watch.some((w) => /config_fHomePosition/.test(w)) && watch.some((w) => /fbMC_MoveAbsolute.Error/.test(w)), 'active state + preProcess variables watched');
expect(!watch.some((w) => /status_bTableEmpty/.test(w)), 'other states not watched');
let views = evaluateGuards(guards, inp, false, null);
const byTo = (to: string) => Object.entries(views).find(([id]) => id.startsWith('TABLEMANAGER_HOMMING_READY_TO_START->' + to))?.[1];
console.log('   ', Object.entries(views).map(([id, v]) => `${id}=${v.result}`).join('  '));
expect(byTo('TABLEMANAGER_ERROR')?.result === 'false' && byTo('TABLEMANAGER_IDLE_FEED_OFF')?.result === 'false' && byTo('TABLEMANAGER_HOMMING')?.result === 'true', 'ELSIF / ELSE: only HOMMING fires');
inp = inputs('TABLEMANAGER_HOMMING_READY_TO_START', { cmd_bhome: true, 'smoutfeedstopaxis.config_fhomeposition': 0 });
views = evaluateGuards(guards, inp, false, null);
expect(byTo('TABLEMANAGER_ERROR')?.result === 'true' && byTo('TABLEMANAGER_IDLE_FEED_OFF')?.result === 'false' && byTo('TABLEMANAGER_HOMMING')?.result === 'false', 'IF true: later branches FALSE even with unknown variables');
const vals = byTo('TABLEMANAGER_ERROR')!.vars.map((v) => `${v.name}=${v.text}`).join(', ');
console.log('   vars:', vals);
expect(/cmd_bHome=TRUE/.test(vals) && /config_fHomePosition=0/.test(vals), 'values listed');
// preProcess edge from the composite applies in an enabled state
const pre = Object.entries(views).find(([id]) => id.startsWith('TableManagerEnabled->TABLEMANAGER_ERROR'));
expect(!!pre, `preProcess edge in the active set: ${pre?.[0]} = ${pre?.[1].result}`);
// Enum comparison
inp = inputs('TABLEMANAGER_ERROR', { cmd_efeedmode: 0 });
views = evaluateGuards(guards, inp, false, null);
const err = Object.entries(views).find(([id]) => id.startsWith('TABLEMANAGER_ERROR->TABLEMANAGER_IDLE_FEED_OFF'))?.[1];
expect(err?.result === 'true', 'cmd_eFeedMode = FEEDMODE_OFF with the enum literal');
// All transitions
const all = evaluateGuards(guards, inp, true, null);
expect(Object.keys(all).length > 40 && Object.values(all).filter((v) => v.detail).length < 10, `all transitions: ${Object.keys(all).length} badges, ${Object.values(all).filter((v) => v.detail).length} with values`);

// Every sample: everything parses (opaque terms counted)
for (const s of SAMPLES as any[]) {
  const m = generateStatechartModel(s.dutContent || '', s.pouContent, {});
  const g = buildGuardEdges(m.edges, extractEdgesFromMermaid(m.markdown), m.stateVar, buildEnumTables([s.dutContent || '']));
  let opaque = 0;
  const texts: string[] = [];
  for (const e of g) for (const mem of e.members) { const walk = (x: any) => { if (x.k === 'opaque') { opaque++; texts.push(x.text); } else if (x.k === 'un') walk(x.e); else if (x.k === 'bin') { walk(x.a); walk(x.b); } else if (x.k === 'call') x.args.forEach(walk); }; walk(mem.expr); }
  console.log(`   ${s.title}: ${g.length} edges, ${new Set(g.flatMap((e) => e.refs)).size} variables, ${opaque} unreadable terms ${[...new Set(texts)].slice(0, 6).join(' | ')}`);
}
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;

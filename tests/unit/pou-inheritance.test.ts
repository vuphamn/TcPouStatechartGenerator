// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A POU that EXTENDS another without a doState() of its own (SM_Head EXTENDS SM_3AxisHead EXTENDS
// KvalStateMachineBase): the bases' methods merged in for reading (its own win; an overridden one kept for SUPER^),
// taken out again for saving (the file as it was). A doState() branch that only calls a method ("ST_IDLE: stIdle();")
// reads that method's code (the derived POU's override, its SUPER^ call the base's), only methods that set the state;
// preProcess()'s SUPER^ call too. Each transition says where it is written (its method, its base). The bases
// registered by name: the chart, the enum match and the Identified States read them
import { generateStatechartModel } from '../../src/generator.ts';
import { expandStateCalls, extendsOf, hasOwnMethod, inheritedBases, mergeInherited, readableInline, setInheritedBases, stripInherited, withInherited } from '../../src/utils/pouInheritance.ts';
import { rankDutCandidates } from '../../src/utils/dutMatcher.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { extractStateCodeFromPou } from '../../src/utils/complexityHeatmap.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { root, base, derived, dut } = require('../fixtures/inherited-pou.cjs');
const bases = [{ name: 'SM_Base', content: base }, { name: 'SM_Root', content: root }];

// 1. The chain, merged and taken out again
expect(extendsOf(derived) === 'SM_Base' && extendsOf(base) === 'SM_Root' && extendsOf(root) === null, 'EXTENDS read');
expect(!hasOwnMethod(derived, 'doState') && hasOwnMethod(base, 'doState'), 'its own methods: no doState()');
const merged = mergeInherited(derived, bases);
expect(stripInherited(merged) === derived, 'stripped: the file as it was');
expect(inheritedBases(merged).join() === 'SM_Base,SM_Root', `the bases named (${inheritedBases(merged).join()})`);
expect(/<Method Name="doState"[^>]*KvalInheritedFrom="SM_Base"/.test(merged) && /<Method Name="SM_Root\.doState"/.test(merged), "doState(): the nearest base's; the root's kept for SUPER^");
expect(/<Method Name="SM_Base\.stIdle"/.test(merged) && (merged.match(/<Method Name="stIdle"/g) ?? []).length === 1, "stIdle(): its own, the base's kept as SM_Base.stIdle");
expect(mergeInherited(merged, bases) === merged, 'merged twice: the same');

// 2. The calls written out
const doState = merged.match(/<Method Name="doState"[\s\S]*?<!\[CDATA\[([\s\S]*?)\]\]><\/ST>/)![1];
const expanded = expandStateCalls(merged, doState, 'machineState', 'doState');
expect(/\{kss-in stIdle SM_Derived\}/.test(expanded) && /\{kss-in SM_Base\.stIdle SM_Base\}/.test(expanded), 'ST_IDLE: its own stIdle(), then the base\'s (SUPER^)');
expect(!/kss-in logIt/.test(expanded), 'logIt() (sets no state): left as a call');
expect(/\{kss-in raiseError SM_Base\}/.test(expanded), 'raiseError() (sets the state): written out where stRun() calls it');
expect(readableInline('{kss-in stIdle SM_Derived}\nx;\n{kss-out}') === '// stIdle() (SM_Derived)\nx;', 'readable: the method named, the end left out');

// 3. The chart: every state's transitions, where each is written
const edges = generateStatechartModel(dut, merged, { showTransitionPriorities: false }).edges;
const members = edges.flatMap((e) => e.members);
const find = (from: string, to: string) => members.find((m) => m.from === from && m.to === to);
expect(find('ST_ENABLING', 'ST_IDLE')?.inMethod === 'stEnabling' && find('ST_ENABLING', 'ST_IDLE')?.inheritedFrom === 'SM_Base', 'ST_ENABLING → ST_IDLE: in stEnabling() of SM_Base');
expect(find('ST_IDLE', 'ST_ERROR')?.inMethod === 'stIdle' && !find('ST_IDLE', 'ST_ERROR')?.inheritedFrom, "ST_IDLE → ST_ERROR: in its own stIdle()");
const idleRun = edges.find((e) => e.from === 'ST_IDLE' && e.to === 'ST_RUN');
expect(!!idleRun && /else AND \(?cmd_bStart\)?/.test(idleRun.label) && idleRun.members[0].inheritedFrom === 'SM_Base', `ST_IDLE → ST_RUN: the base's, under the override's ELSE (${idleRun?.label})`);
expect(find('ST_RUN', 'ST_ERROR')?.inMethod === 'raiseError', 'ST_RUN → ST_ERROR: in raiseError()');
expect(!!find('ST_ERROR', 'ST_IDLE'), 'ST_ERROR → ST_IDLE');
const pre = edges.filter((e) => e.source === 'preProcess');
expect(pre.some((e) => e.to === 'ST_ERROR' && e.members[0].inheritedFrom === 'SM_Base') && pre.some((e) => e.to === 'ST_ENABLING' && e.members[0].inheritedFrom === 'SM_Root'), `preProcess(): the bases' through SUPER^ (${pre.map((e) => `${e.to}@${e.members[0].inheritedFrom}`).join(', ')})`);

// 4. Not merged: only preProcess(); registered by name: the chart, the enum, the Identified States
expect(generateStatechartModel(dut, derived, {}).edges.every((e) => e.source === 'preProcess'), 'not registered: no doState() transitions');
expect(rankDutCandidates(derived, [{ name: 'E_St.TcDUT', relativePath: 'E_St.TcDUT', content: dut }]).length === 0, 'not registered: no enum matches');
setInheritedBases('SM_Derived', bases);
expect(withInherited(derived) === merged, 'registered: merged');
expect(generateStatechartModel(dut, derived, { showTransitionPriorities: false }).edges.length === edges.length, 'registered: the chart from the merged code');
expect(rankDutCandidates(derived, [{ name: 'E_St.TcDUT', relativePath: 'E_St.TcDUT', content: dut }]).length === 1, 'registered: the enum matches');
const ids = extractIdentifiedStatesFromPou(derived, dut).states.filter((s) => s.hasCaseBranch).map((s) => s.id);
expect(['ST_ENABLING', 'ST_IDLE', 'ST_RUN', 'ST_ERROR'].every((s) => ids.includes(s)), `registered: the Identified States (${ids.join(', ')})`);
const code = extractStateCodeFromPou(derived, 'ST_IDLE');
expect(/\/\/ stIdle\(\) \(SM_Derived\)/.test(code) && /cmd_bStart/.test(code), "the heat map's state code: its methods written out");
setInheritedBases('SM_Derived', null);
expect(withInherited(derived) === derived, 'forgotten: its own again');

// 5. A POU whose doState() calls its own state methods (the base itself, opened): their transitions drawn
const own = generateStatechartModel(dut, base, { showTransitionPriorities: false }).edges.filter((e) => e.source === 'doState');
expect(own.length >= 5 && own.every((e) => e.members[0].inMethod && !e.members[0].inheritedFrom), `the base opened: its state methods' transitions (${own.length})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

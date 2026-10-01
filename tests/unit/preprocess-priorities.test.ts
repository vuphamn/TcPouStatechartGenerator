// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// preProcess()'s transitions (AnyState's, a composite's exception ones) numbered by their order there: the same
// numbers its Earlier / Later in preProcess() moves them by (transitionOrder), drawn as their edges' badges
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { transitionOrder } from '../../src/utils/transitionEdits.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

let seen = 0;
for (const s of SAMPLES) {
  const model = generateStatechartModel(s.dutContent, s.pouContent, { showTransitionPriorities: true });
  const pre = model.edges.filter((e) => e.source === 'preProcess');
  if (!pre.length) continue;
  seen++;
  const members = pre.flatMap((e) => e.members.map((m) => ({ ...m, label: e.label })));
  // (each one's number: its place in preProcess(), 1 … n)
  const nums = members.map((m) => m.priority).filter((n): n is number => typeof n === 'number');
  expect(nums.length === members.length && new Set(nums).size === nums.length && Math.min(...nums) === 1, `${s.id}: preProcess()'s ${members.length} transitions numbered (${nums.join(', ')})`);
  // (the same as Earlier / Later in preProcess() go by)
  // (two to the same state: the lookup finds one of them; its number one of theirs)
  const off = members.filter((m) => {
    const o = transitionOrder(s.pouContent, { from: m.from, to: m.to, label: m.label ?? '', priority: m.priority } as never, model.stateVar);
    const theirs = members.filter((x) => x.from === m.from && x.to === m.to).map((x) => x.priority);
    return 'error' in o || o.method !== 'preProcess' || !theirs.includes(o.priority);
  });
  expect(off.length === 0, `${s.id}: their numbers are preProcess()'s order (${off.map((m) => `${m.from} → ${m.to} ${m.priority}`).join(', ') || 'all'})`);
  // (drawn: a badge on each AnyState edge)
  const drawn = extractEdgesFromMermaid(model.markdown).filter((e) => e.from === 'AnyState' || pre.some((p) => p.from === e.from && p.to === e.to));
  expect(drawn.length > 0 && drawn.every((e) => typeof e.priority === 'number' && e.priority > 0), `${s.id}: their edges' badges (${drawn.map((e) => `${e.from}→${e.to}:${e.priority}`).join(' ')})`);
}
expect(seen >= 3, `${seen} samples with preProcess() transitions`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

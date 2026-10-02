// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// runner-timeout: 300 (791 moves; CI's machines take half as long again)
// Every sample's every transition (the code's, also those drawn to or from a composite's border): its start moved to
// another state (moveTransitionStart, the canvas' drop of a start endpoint): none refused, each one then leaving the
// new state (the generator's own model), in an IF, an ELSIF, an IF / ELSE, an ELSE or nested in them
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { moveTransitionStart } from '../../src/utils/transitionEdits.ts';
import { updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

let total = 0;
for (const s of SAMPLES) {
  const model = generateStatechartModel(s.dutContent, s.pouContent, {});
  // (the code's transitions: each edge's members; preProcess' leave any state)
  const own = model.edges.filter((e) => e.source !== 'preProcess');
  const transitions = [...new Map(own.flatMap((e) => e.members.map((m) => ({ from: m.from, to: m.to, label: e.label, priority: m.priority }))).map((x) => [`${x.from}->${x.to}`, x])).values()];
  const states = [...new Set(transitions.map((t) => t.from))].filter((x) => x !== '[*]' && x !== 'AnyState');
  const refused: string[] = [];
  const lost: string[] = [];
  for (const t of transitions) {
    if (t.from === '[*]' || t.from === 'AnyState') continue;
    // (each to every state that has transitions of its own, three of them: near, middle, far)
    const targets = states.filter((x) => x !== t.from && x !== t.to);
    for (const target of [targets[0], targets[Math.floor(targets.length / 2)], targets[targets.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i)) {
      total++;
      const r = moveTransitionStart(s.pouContent, { from: t.from, to: t.to, label: t.label ?? '', priority: t.priority } as never, target, model.stateVar);
      if ('error' in r) {
        refused.push(`${t.from} → ${t.to} to ${target}: ${r.error}`);
        continue;
      }
      const u = updateMethodCodeInPou(s.pouContent, r.method, r.code);
      const after = u.success ? generateStatechartModel(s.dutContent, u.updatedPou, {}).edges.flatMap((e) => e.members) : [];
      if (!after.some((m) => m.from === target && m.to === t.to)) lost.push(`${t.from} → ${t.to} to ${target}`);
    }
  }
  expect(refused.length === 0, `${s.id}: every start movable (${refused.length} refused${refused.length ? `: ${refused.slice(0, 3).join(' | ')}` : ''})`);
  expect(lost.length === 0, `${s.id}: each moved one leaving its new state (${lost.length} not${lost.length ? `: ${lost.slice(0, 3).join(' | ')}` : ''})`);
}
expect(total > 500, `${total} moves tried`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Collapse error-sink edges: a composite's transitions to the error state drawn as one edge from its border
// ("hasErrors [collapsed]"); it keeps a priority (the lowest of those it stands for), so it has a badge as the
// composite's other edges do. Its members: the transitions of the code it stands for, with their states and
// priorities (its badge lists them)
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

let collapsed = 0;
const missing: string[] = [];
for (const s of SAMPLES as any[]) {
  for (const flowchartOutput of [true, false]) {
    const md = generateStatechartModel(s.dutContent, s.pouContent, { flowchartOutput, collapseErrorSinkEdges: true, showTransitionPriorities: true, priorityFormat: 'bracket' } as any).markdown;
    // (each edge: its source and label; flowchart A -->|"label"| B, stateDiagram A --> B : label)
    const edges = [...md.matchAll(/^\s*(\S+) -->(?:\|"([^"]*)"\|)? (\S+)(?: : (.*))?$/gm)].map((m) => ({ from: m[1], label: m[2] ?? m[4] ?? '', to: m[3] }));
    for (const e of edges.filter((x) => /hasErrors \[collapsed\]/.test(x.label))) {
      collapsed++;
      const others = edges.filter((x) => x.from === e.from && x !== e && /\[\d+\]/.test(x.label));
      if (others.length && !/\[\d+\] hasErrors \[collapsed\]/.test(e.label)) missing.push(`${s.name ?? s.pouName ?? '?'} (${flowchartOutput ? 'flowchart' : 'stateDiagram'}): ${e.from} -> ${e.to} "${e.label}" (its composite's others: ${others.map((x) => x.label.match(/\[\d+\]/)?.[0]).join(' ')})`);
    }
  }
}
// The collapsed edges' members: each a transition to the error state from a state (not the composite), the lowest
// priority the edge's own
let withMembers = 0;
const wrong: string[] = [];
for (const s of SAMPLES as any[]) {
  const model = generateStatechartModel(s.dutContent, s.pouContent, { flowchartOutput: true, collapseErrorSinkEdges: true, showTransitionPriorities: true, priorityFormat: 'bracket' } as any);
  for (const e of model.edges.filter((x) => /hasErrors \[collapsed\]/.test(x.label))) {
    withMembers++;
    const ok = e.members.length > 0 && e.members.every((m) => m.to === e.to && m.from !== e.from && !(e.from in model.composites && m.from === e.from));
    const prios = e.members.map((m) => m.priority).filter((x): x is number => typeof x === 'number' && x > 0);
    const own = /\[(\d+)\] hasErrors/.exec(e.label)?.[1];
    if (!ok || (own && prios.length && Math.min(...prios) !== +own)) wrong.push(`${s.name ?? '?'}: ${e.from} -> ${e.to} [${e.members.map((m) => `${m.from}:${m.priority}`).join(', ')}] "${e.label}"`);
  }
}
expect(withMembers > 0 && wrong.length === 0, `each collapsed edge lists its transitions, from their own states, its priority the lowest of theirs (${withMembers} edges${wrong.length ? `; ${wrong.slice(0, 2).join('; ')}` : ''})`);
expect(collapsed > 0, `the samples have collapsed error edges (${collapsed})`);
expect(missing.length === 0, `each collapsed edge whose composite has other numbered edges has its priority too (${missing.slice(0, 2).join('; ') || 'all'})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Collapse error-sink edges: a composite's transitions to the error state drawn as one edge from its border
// ("hasErrors [collapsed]"); it keeps a priority (the lowest of those it stands for), so it has a badge as the
// composite's other edges do
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
expect(collapsed > 0, `the samples have collapsed error edges (${collapsed})`);
expect(missing.length === 0, `each collapsed edge whose composite has other numbered edges has its priority too (${missing.slice(0, 2).join('; ') || 'all'})`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

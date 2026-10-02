// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The composites' states read from the chart's Mermaid source (the canvas grows a composite's box to hold them):
// every sample, both chart kinds; nested composites' states counted in the ones around them
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { compositeMembersOf } from '../../src/utils/compositeBounds.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// A small one of each kind
const flow = compositeMembersOf(['flowchart TD', '  A["a"]', '  subgraph G["G"]', '    B["b"]', '    subgraph H["H"]', '      C["c"]', '    end', '  end', '  A --> B', '  B --> C'].join('\n'));
expect(JSON.stringify(flow.G?.sort()) === JSON.stringify(['B', 'C', 'H']) && JSON.stringify(flow.H) === JSON.stringify(['C']), `flowchart: G holds B, H and C; H holds C (${JSON.stringify(flow)})`);
const st = compositeMembersOf(['stateDiagram-v2', '  state "G" as G {', '    state "b" as B', '    B --> C', '    state H {', '      D', '    }', '  }', '  [*] --> A'].join('\n'));
expect(['B', 'C', 'H', 'D'].every((x) => st.G?.includes(x)) && !st.G?.includes('A') && JSON.stringify(st.H) === JSON.stringify(['D']), `state diagram: G holds B, C, H and D; H holds D (${JSON.stringify(st)})`);

// Every sample: each composite holds states, and no state is in two composites that are not nested
let composites = 0;
for (const s of SAMPLES) {
  for (const flowchart of [true, false]) {
    const model = generateStatechartModel(s.dutContent, s.pouContent, { flowchartOutput: flowchart });
    const m = compositeMembersOf(model.markdown);
    const names = Object.keys(m);
    composites += names.length;
    const empty = names.filter((n) => !m[n].length);
    expect(empty.length === 0, `${s.id} (${flowchart ? 'flowchart' : 'state diagram'}): ${names.length} composites, each with states (${empty.join(', ') || 'none empty'})`);
    const clash = names.flatMap((a) => names.filter((b) => a < b && !m[a].includes(b) && !m[b].includes(a) && m[a].some((x) => m[b].includes(x))).map((b) => `${a}/${b}`));
    expect(clash.length === 0, `${s.id} (${flowchart ? 'flowchart' : 'state diagram'}): no state in two separate composites (${clash.slice(0, 3).join(', ') || 'none'})`);
  }
}
expect(composites > 10, `${composites} composites in the samples`);

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

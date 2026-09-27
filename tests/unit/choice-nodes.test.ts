// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Choice nodes (an option): a state's top-level IF / ELSIF / ELSE with two or more transitions is drawn as a choice
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const s = (SAMPLES as any[])[0];
const C = 'TABLEMANAGER_CLAMPED';

const off = generateStatechartModel(s.dutContent, s.pouContent, { flowchartOutput: true }).markdown;
expect(!/choice_/.test(off), 'off: no choices (the chart as before)');

const fc = generateStatechartModel(s.dutContent, s.pouContent, { flowchartOutput: true, choiceNodes: true });
const id = fc.markdown.match(new RegExp(`(choice_${C}_\\d+)\\{" "\\}`))?.[1];
expect(!!id, `flowchart: CLAMPED's IF / ELSIF is a choice (${id})`);
expect(new RegExp(`\\n\\s*${C} --> ${id}\\n`).test(fc.markdown), 'CLAMPED goes to it');
expect(new RegExp(`${id} -->\\|"[^"]*cmd_bUnclamp[^"]*"\\| TABLEMANAGER_UNCLAMP_START`).test(fc.markdown) && new RegExp(`${id} -->\\|"[^"]*cmd_bStartReClamp[^"]*"\\| TABLEMANAGER_REFEED_START`).test(fc.markdown), 'its arms leave the choice, with their conditions');
expect(!new RegExp(`${C} -->\\|[^\\n]*TABLEMANAGER_UNCLAMP_START`).test(fc.markdown), 'no longer straight from CLAMPED');
expect(fc.edges.some((e) => e.from === id && /UNCLAMP_START/.test(e.to)), 'the model: the edge from the choice (guards / live values)');
// Its declaration is in CLAMPED's composite
const sub = fc.markdown.match(/subgraph TableManagerEnabled[\s\S]*?\n {4}end\n/)?.[0] ?? '';
expect(sub.includes(`${id}{" "}`), 'declared in its composite');
// A state whose transitions are in separate IFs gets none
const count = (fc.markdown.match(/choice_\w+\{" "\}/g) ?? []).length;
expect(count >= 1 && count < 20, `${count} choices in the Table Manager`);

const sd = generateStatechartModel(s.dutContent, s.pouContent, { choiceNodes: true }).markdown;
expect(new RegExp(`state ${id} <<choice>>`).test(sd) && new RegExp(`${id} --> TABLEMANAGER_UNCLAMP_START: `).test(sd), 'stateDiagram: <<choice>>');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

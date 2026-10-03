// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The exported Mermaid text's comments (the canvas positions block): every one stripped by Mermaid as a comment (its
// own rule: %% and at least one character after it, not %%{), none left over to be drawn as a node (a bare %% was:
// Mermaid Live showed a box "%%" beside the chart)
import { appendCanvasPositionsToMermaid } from '../../src/utils/canvasPositions.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const chart = ['flowchart TD', '    IDLE["Idle"]', '    RUN["Run"]', '    IDLE --> RUN', ''].join('\n');
const pos = (id: string, x: number, y: number) => ({ id, label: id, x, y, width: 80, height: 30, centerX: x + 40, centerY: y + 15 });
const out = appendCanvasPositionsToMermaid(chart, { IDLE: pos('IDLE', 0, 0), RUN: pos('RUN', 0, 100) }, { layoutEngine: 'elk', includeJsonMetadata: true });
// (Mermaid's cleanupComments, mermaid.core.mjs)
const cleaned = out.replace(/^\s*%%(?!{)[^\n]+\n?/gm, '').trimStart();
const left = cleaned.split('\n').filter((l) => /%%/.test(l) && !/^\s*%%\{.*\}%%\s*$/.test(l));
expect(/DIAGRAM CANVAS NODE POSITIONS/.test(out), 'the positions block is in it');
expect(left.length === 0, `every comment stripped by Mermaid (${left.length} left: ${JSON.stringify(left.slice(0, 3))})`);
expect(!out.split('\n').some((l) => /^\s*%%\s*$/.test(l)), 'no bare %% line');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

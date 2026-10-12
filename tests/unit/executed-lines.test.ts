// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The code that ran (src/utils/executedLines.ts): from the transitions taken, each one's assignment line in its
// source state's branch and the label of each state left; a qualified state (E_S.B), a label for two states, a nested
// CASE, a comment not counted; a transition never taken: not marked
import { executedLines } from '../../src/utils/executedLines.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const code = [
  'CASE machineState OF', // 1
  '\tE_S.S_A:', // 2
  '\t\tIF bGo THEN', // 3
  '\t\t\tmachineState := E_S.S_B;', // 4
  '\t\tELSIF bStop THEN', // 5
  '\t\t\tmachineState := E_S.S_C;', // 6
  '\t\tEND_IF', // 7
  '\tE_S.S_B, E_S.S_D:', // 8
  '\t\tCASE nStep OF', // 9
  '\t\t\t1: nStep := 2;', // 10
  '\t\tEND_CASE', // 11
  '\t\t// machineState := E_S.S_A; (a comment)', // 12
  '\t\tmachineState := E_S.S_A;', // 13
  '\tE_S.S_C:', // 14
  '\t\tmachineState := S_A;', // 15
  'END_CASE', // 16
].join('\n');
const m = executedLines(code, 'machineState', [{ from: 'S_A', to: 'S_B', n: 3 }, { from: 'S_B', to: 'S_A', n: 2 }, { from: 'S_A', to: 'S_C', n: 0 }, { from: 'S_C', to: 'S_A', n: 1 }]);
const show = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([l, x]) => `${l}:${x.kind}:${x.n}`).join(' ');
expect(show === '2:state:3 4:transition:3 8:state:2 13:transition:2 14:state:1 15:transition:1', `the lines: ${show}`);
expect(!m.has(6) && !m.has(12) && !m.has(10), 'not taken, a comment, a nested CASE label: not marked');
expect(/S_A → S_B: taken 3×/.test(m.get(4)!.title) && /S_A: left 3×/.test(m.get(2)!.title), 'their titles');
expect(executedLines(code, 'otherState', [{ from: 'S_A', to: 'S_B', n: 3 }]).size === 0, 'another state variable: nothing');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

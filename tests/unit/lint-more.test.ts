// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// More variable checks: a trigger on a constant (its call removed only where that changes nothing), an empty IF
// (removed when its condition calls nothing), an output that nothing sets
import { lintVariables } from '../../src/utils/variableLint.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const cdata = (s: string) => `<![CDATA[${s}]]>`;
const method = (name: string, decl: string, code: string) => `    <Method Name="${name}" Id="{m}">\n      <Declaration>${cdata(decl)}</Declaration>\n      <Implementation>\n        <ST>${cdata(code)}</ST>\n      </Implementation>\n    </Method>`;

const DECL = ['FUNCTION_BLOCK SM_Y', 'VAR_OUTPUT', '\tstatus_bReady : BOOL;', '\tstatus_nCount : INT;', '\tstatus_bDone : BOOL;', '\tstatus_bLatched : BOOL;', 'END_VAR', 'VAR', '\trtNever : R_TRIG;', '\tftNever : F_TRIG;', '\trtOnce : R_TRIG;', '\trtAlways : R_TRIG;', '\tbIn : BOOL;', '\tfbCounter : CTU;', 'END_VAR', 'VAR CONSTANT', '\tALWAYS_ON : BOOL := TRUE;', 'END_VAR'].join('\n');
const DO = [
  'rtNever(CLK := FALSE);',
  'ftNever(CLK := ALWAYS_ON);',
  'rtOnce(CLK := TRUE);',
  'rtAlways(CLK := bIn);',
  'IF bIn THEN',
  '',
  'END_IF',
  'IF isReady() THEN',
  'END_IF',
  'IF bIn THEN',
  '\tstatus_bReady := TRUE;',
  'END_IF',
  'status_nCount := status_nCount + 1;',
  'fbCounter(CU := bIn, Q => status_bDone);',
  'status_bLatched S= bIn;',
].join('\n');
const POU = `<?xml version="1.0" encoding="utf-8"?>\n<TcPlcObject Version="1.1.0.1">\n  <POU Name="SM_Y" Id="{1}" SpecialFunc="None">\n    <Declaration>${cdata(DECL)}</Declaration>\n    <Implementation>\n      <ST>${cdata('doState();')}</ST>\n    </Implementation>\n${method('doState', 'METHOD doState : BOOL', DO)}\n${method('isReady', 'METHOD isReady : BOOL', 'isReady := bIn;')}\n  </POU>\n</TcPlcObject>`;

const f = lintVariables(POU, null, false, []);
const of = (rule: string) => f.filter((x) => x.rule === rule);

// 1. Triggers on constants
const trig = of('trigger-constant');
const by = (n: string) => trig.find((x) => x.message.startsWith(`${n} `));
expect(trig.length === 3 && !by('rtAlways'), `three triggers on constants: ${trig.map((x) => x.message.split(' ')[0]).join(', ')}`);
expect(/never TRUE/.test(by('rtNever')?.message ?? '') && by('rtNever')?.fix?.kind === 'remove-lines' && (by('rtNever')?.fix as { count?: number })?.count === 1 && (by('rtNever')?.fix as { line?: number })?.line === 1, `rtNever (CLK := FALSE): never TRUE, its call removable (${by('rtNever')?.message})`);
expect(/always TRUE \(ALWAYS_ON\): its Q is never TRUE/.test(by('ftNever')?.message ?? '') && !!by('ftNever')?.fix, `ftNever (a constant TRUE): never TRUE, removable (${by('ftNever')?.message})`);
expect(/TRUE only in the first cycle/.test(by('rtOnce')?.message ?? '') && !by('rtOnce')?.fix, `rtOnce (CLK := TRUE): once, not removed for you (${by('rtOnce')?.message})`);

// 2. Empty IFs: removable when the condition calls nothing
const ifs = of('empty-if');
const first = ifs.find((x) => x.line === 5);
const call = ifs.find((x) => x.line === 8);
expect(ifs.length === 2 && (first?.fix as { count?: number })?.count === 3 && !!call && !call.fix && /calls something/.test(call.message), `empty IFs: lines ${ifs.map((x) => x.line).join(', ')} (the second calls isReady(): kept)`);

// 3. Outputs: set (assigned, S=, an output's =>) or never
const outs = of('output-never-set').map((x) => x.message.split(' ')[0]);
expect(outs.length === 0, `every output set somewhere: ${outs.join(', ') || 'none flagged'}`);
const f2 = lintVariables(POU.replace('\tstatus_bReady := TRUE;', '\t;'), null, false, []);
expect(f2.filter((x) => x.rule === 'output-never-set').map((x) => x.message.split(' ')[0]).join() === 'status_bReady', 'status_bReady no longer set: flagged');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

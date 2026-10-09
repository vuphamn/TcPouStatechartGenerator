// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Coverage per commissioning session (src/utils/transitionCoverage.ts): each reset kept; a session's coverage the
// counts at its end above those at its start (before the first reset, between resets, the last one to now), newest
// first, its CSV with since / until. A saved comparison of two PLCs (src/utils/liveComparison.ts): both sides back,
// another file not taken for one. The PLC's trial license end (src/utils/plcLicense.ts): fine, soon, ran out
import { addCoverageReset, coverageCsv, coverageSessions, coverageStartNow, loadCoverageResets } from '../../src/utils/transitionCoverage.ts';
import { comparisonFileName, comparisonText, parseComparison } from '../../src/utils/liveComparison.ts';
import { trialChip, trialLicenseState } from '../../src/utils/plcLicense.ts';
import type { SeenMap } from '../../src/utils/seenTransitions.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k),
};

const chart = [
  { from: 'IDLE', to: 'RUN' },
  { from: 'RUN', to: 'IDLE' },
  { from: 'RUN', to: 'ERROR' },
  { from: 'ERROR', to: 'IDLE' },
];
// Session 1 (before any reset): IDLE->RUN twice, RUN->IDLE once
let seen: SeenMap = { 'IDLE->RUN': { n: 2, last: 1000 }, 'RUN->IDLE': { n: 1, last: 1100 } };
expect(coverageSessions(chart, seen, []).length === 0, 'no reset: no sessions (the coverage is the whole)');
addCoverageReset('SM_X', coverageStartNow(seen, 2000));
// Session 2: RUN->ERROR, ERROR->IDLE
seen = { ...seen, 'RUN->ERROR': { n: 1, last: 2100 }, 'ERROR->IDLE': { n: 1, last: 2200 } };
addCoverageReset('SM_X', coverageStartNow(seen, 3000));
// Session 3 (now): IDLE->RUN once more
seen = { ...seen, 'IDLE->RUN': { n: 3, last: 3100 } };
const resets = loadCoverageResets('SM_X');
expect(resets.length === 2 && resets[0].at === 2000 && resets[1].at === 3000, `the resets kept, oldest first (${resets.map((r) => r.at)})`);

const sessions = coverageSessions(chart, seen, resets);
const taken = (k: number) => sessions[k].coverage.rows.filter((r) => r.n > 0).map((r) => `${r.from}->${r.to}x${r.n}`).sort().join(' ');
expect(sessions.length === 3, `three sessions (${sessions.length})`);
expect(sessions[0].from === 3000 && sessions[0].to === null && taken(0) === 'IDLE->RUNx1', `now: since the last reset (${taken(0)})`);
expect(sessions[1].from === 2000 && sessions[1].to === 3000 && taken(1) === 'ERROR->IDLEx1 RUN->ERRORx1' && sessions[1].coverage.taken === 2, `between the resets (${taken(1)})`);
expect(sessions[2].from === null && sessions[2].to === 2000 && taken(2) === 'IDLE->RUNx2 RUN->IDLEx1', `before the first reset (${taken(2)})`);
const csv = coverageCsv(sessions[1].coverage);
expect(/Counted since,Counted until/.test(csv) && csv.includes(new Date(2000).toISOString()) && csv.includes(new Date(3000).toISOString()), 'a session\'s CSV: since and until');

// A comparison saved and opened again
const a = { label: '5.1.2.3.1.1:851', transitions: [{ t: 1, from: 'IDLE', to: 'RUN', dwellMs: 10, inModel: true }] };
const b = { label: 'CX-Other', transitions: [{ t: 2, from: 'RUN', to: 'ERROR', dwellMs: 20, inModel: true }] };
const back = parseComparison(comparisonText(a, b, 'SM_X'));
expect(!!back && !('error' in back) && back.a.label === a.label && back.b.transitions[0].to === 'ERROR' && back.pou === 'SM_X', 'a comparison: both sides back');
expect(parseComparison('{"values":[]}') === null && parseComparison('not json') === null, 'a recording or another file: not a comparison');
const broken = parseComparison('{"kind":"kss-live-comparison","version":1,"a":{"label":"x"}}');
expect(!!broken && 'error' in broken, 'a comparison without its sides: said');
expect(comparisonFileName(a, b, 'SM_X') === 'SM_X_5.1.2.3.1.1_851_vs_CX-Other.comparison.json', `its file name (${comparisonFileName(a, b, 'SM_X')})`);

// The PLC's trial license
const now = Date.parse('2026-10-08T12:00:00Z');
expect(trialLicenseState('2026-10-16T00:00:00.000Z', now)?.state === 'ok' && trialChip('2026-10-16T00:00:00.000Z', now).level === 'ok' && /trial until .*\(7 d 12 h\)/.test(trialChip('2026-10-16T00:00:00.000Z', now).text), `a week left: fine (${trialChip('2026-10-16T00:00:00.000Z', now).text})`);
expect(trialLicenseState('2026-10-09T06:00:00Z', now)?.state === 'soon' && trialChip('2026-10-09T06:00:00Z', now).level === 'soon', 'under two days: soon');
expect(trialLicenseState('2026-10-08T06:00:00Z', now)?.state === 'expired' && /ran out/.test(trialChip('2026-10-08T06:00:00Z', now).text), 'ran out');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

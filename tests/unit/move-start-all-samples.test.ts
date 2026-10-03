// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// runner-timeout: 300 (791 moves: about 85 s on one core, mostly the two biggest samples drawn again after each move;
// shared out to worker threads, a quarter of that on four)
// Every sample's every transition (the code's, also those drawn to or from a composite's border): its start moved to
// another state (moveTransitionStart, the canvas' drop of a start endpoint): none refused, each one then leaving the
// new state (the generator's own model), in an IF, an ELSIF, an IF / ELSE, an ELSE or nested in them
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { moveTransitionStart } from '../../src/utils/transitionEdits.ts';
import { updateMethodCodeInPou } from '../../src/utils/pouStateEditor.ts';

/** One move to try: a sample's transition, its start moved to a target */
interface Job {
  sample: number;
  from: string;
  to: string;
  label: string;
  priority?: number;
  target: string;
}
interface Outcome {
  sample: number;
  refused?: string;
  lost?: string;
}

/** Each sample's moves: each transition to three states that have transitions of their own (near, middle, far) */
function jobsOf(): { jobs: Job[]; stateVars: string[] } {
  const jobs: Job[] = [];
  const stateVars: string[] = [];
  SAMPLES.forEach((s, sample) => {
    const model = generateStatechartModel(s.dutContent, s.pouContent, {});
    stateVars[sample] = model.stateVar;
    // (the code's transitions: each edge's members; preProcess' leave any state)
    const own = model.edges.filter((e) => e.source !== 'preProcess');
    const transitions = [...new Map(own.flatMap((e) => e.members.map((m) => ({ from: m.from, to: m.to, label: e.label ?? '', priority: m.priority }))).map((x) => [`${x.from}->${x.to}`, x])).values()];
    const states = [...new Set(transitions.map((t) => t.from))].filter((x) => x !== '[*]' && x !== 'AnyState');
    for (const t of transitions) {
      if (t.from === '[*]' || t.from === 'AnyState') continue;
      const targets = states.filter((x) => x !== t.from && x !== t.to);
      for (const target of [targets[0], targets[Math.floor(targets.length / 2)], targets[targets.length - 1]].filter((x, i, a) => x && a.indexOf(x) === i)) jobs.push({ sample, ...t, target });
    }
  });
  return { jobs, stateVars };
}

function run(job: Job, stateVar: string): Outcome {
  const s = SAMPLES[job.sample];
  const what = `${job.from} → ${job.to} to ${job.target}`;
  const r = moveTransitionStart(s.pouContent, { from: job.from, to: job.to, label: job.label, priority: job.priority } as never, job.target, stateVar);
  if ('error' in r) return { sample: job.sample, refused: `${what}: ${r.error}` };
  const u = updateMethodCodeInPou(s.pouContent, r.method, r.code);
  const after = u.success ? generateStatechartModel(s.dutContent, u.updatedPou, {}).edges.flatMap((e) => e.members) : [];
  return after.some((m) => m.from === job.target && m.to === job.to) ? { sample: job.sample } : { sample: job.sample, lost: what };
}

if (!isMainThread) {
  // A worker: its share of the moves
  const { jobs, stateVars } = workerData as { jobs: Job[]; stateVars: string[] };
  parentPort!.postMessage(jobs.map((j) => run(j, stateVars[j.sample])));
} else void (async () => {
  let fails = 0;
  const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
  const started = Date.now();
  const { jobs, stateVars } = jobsOf();
  // (the big samples' moves dealt out in turn, so each worker gets some of the slow ones)
  const n = Math.max(1, Math.min(4, os.cpus().length - 1));
  const shares: Job[][] = Array.from({ length: n }, () => []);
  jobs.forEach((j, i) => shares[i % n].push(j));
  const outcomes = (
    await Promise.all(
      shares.map(
        (share) =>
          new Promise<Outcome[]>((resolve, reject) => {
            const w = new Worker(__filename, { workerData: { jobs: share, stateVars } });
            w.once('message', resolve);
            w.once('error', reject);
          })
      )
    )
  ).flat();
  SAMPLES.forEach((s, i) => {
    const mine = outcomes.filter((o) => o.sample === i);
    const refused = mine.flatMap((o) => (o.refused ? [o.refused] : []));
    const lost = mine.flatMap((o) => (o.lost ? [o.lost] : []));
    expect(refused.length === 0, `${s.id}: every start movable (${refused.length} refused${refused.length ? `: ${refused.slice(0, 3).join(' | ')}` : ''})`);
    expect(lost.length === 0, `${s.id}: each moved one leaving its new state (${lost.length} not${lost.length ? `: ${lost.slice(0, 3).join(' | ')}` : ''})`);
  });
  expect(outcomes.length === jobs.length && jobs.length > 500, `${outcomes.length} of ${jobs.length} moves tried (${n} workers, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

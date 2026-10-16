// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The gateway's health (gateway/health.cjs): its disk (a statfs given), what it keeps, each recording's size and its
// growth (its last 7 full days a day, today not), the days left at that, the retention planned (it fits, or each
// recording's days to keep to fit), and when it is low (under 10 %, 5 GB, not fitting, full within 14 days)
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { healthOf } = require('../../gateway/health.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

(() => {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kss-health-'));
  try {
    const day = (k: number) => {
      const d = new Date(2026, 9, 16 - k);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    // (r1: 10 days of 2 MB, today 5 MB (not counted in its growth); r2: 3 days of 1 MB)
    fs.mkdirSync(path.join(dir, 'recordings', 'r1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'recordings', 'r2'), { recursive: true });
    for (let k = 10; k >= 1; k--) fs.writeFileSync(path.join(dir, 'recordings', 'r1', `${day(k)}.jsonl`), Buffer.alloc(2 * MB));
    fs.writeFileSync(path.join(dir, 'recordings', 'r1', `${day(0)}.jsonl`), Buffer.alloc(5 * MB));
    for (let k = 3; k >= 1; k--) fs.writeFileSync(path.join(dir, 'recordings', 'r2', `${day(k)}.jsonl.gz`), Buffer.alloc(MB));
    fs.mkdirSync(path.join(dir, 'attachments'));
    fs.writeFileSync(path.join(dir, 'attachments', 'a.png'), Buffer.alloc(1000));
    const now = new Date(2026, 9, 16, 12).getTime();
    const recordings = [{ id: 'r1', name: 'Doors', days: 90 }, { id: 'r2', name: 'Press', days: 30 }];
    const disk = (freeBytes: number, totalBytes: number) => () => ({ bsize: 4096, bavail: freeBytes / 4096, blocks: totalBytes / 4096 });
    const big = healthOf({ baseDir: dir, recordings, statfs: disk(500 * GB, 1000 * GB), now });
    const r1 = big.recordings.find((r: { id: string }) => r.id === 'r1');
    const r2 = big.recordings.find((r: { id: string }) => r.id === 'r2');
    expect(r1.bytes === 25 * MB && r1.days === 11 && r1.perDay === 2 * MB && r1.atFull === 180 * MB && r2.perDay === MB && r2.atFull === 30 * MB && big.growthPerDay === 3 * MB, `recordings: r1 ${r1.bytes / MB} MB, ${r1.perDay / MB} MB a day (today not), at 90 days ${r1.atFull / MB} MB; r2 ${r2.perDay / MB} MB a day`);
    expect(big.plan.fits && big.plan.needed === 182 * MB && big.low === null && Math.round(big.disk.freePct) === 50 && big.folders.some((f: { name: string; bytes: number }) => f.name === 'attachments' && f.bytes === 1000), `plenty free: fits (${big.plan.needed / MB} MB more), not low; kept: ${big.folders.map((f: { name: string }) => f.name).join(', ')}`);
    // (100 MB free: 182 MB more will not fit in 80 %: each recording's days cut in the same share)
    const small = healthOf({ baseDir: dir, recordings, statfs: disk(100 * MB, 1000 * GB), now });
    const keep = small.plan.suggestions.map((x: { id: string; keep: number }) => `${x.id} ${x.keep}`).join(', ');
    expect(!small.plan.fits && small.plan.suggestions.length === 2 && small.plan.suggestions[0].keep < 90 && small.plan.suggestions[0].keep >= 1 && /free/.test(small.low ?? ''), `tight: not fitting; keep ${keep}; low: ${small.low}`);
    // (low: under 10 %, under 5 GB, full within 14 days)
    const tenth = healthOf({ baseDir: dir, recordings: [], statfs: disk(80 * GB, 1000 * GB), now });
    const soon = healthOf({ baseDir: dir, recordings: [{ id: 'r1', days: 3650 }], statfs: disk(20 * MB + 6 * GB, 60 * GB), now });
    expect(/8\.0 % free/.test(tenth.low ?? '') && soon.daysLeft !== null && soon.low !== null, `low: "${tenth.low}"; ${Math.round(soon.daysLeft)} days left: "${soon.low}"`);
    const none = healthOf({ baseDir: dir, recordings, statfs: () => { throw new Error('no'); }, now });
    expect(none.disk === null && none.low === null && none.plan.fits, 'its disk not known: not low, nothing planned');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${fails} failures`);
  process.exit(fails ? 1 : 0);
})();

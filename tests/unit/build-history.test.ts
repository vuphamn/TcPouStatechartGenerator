// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The builds of a project copy seen when live (src/utils/buildHistory.ts): XAE keeps only the latest build's
// compile info, so a PLC ID that is not the newest is an older build of this copy only when it was seen here before
// (said with when it was built); never seen: not known. Per copy (the POU's folder), the IDs without regard to case
import { buildCopyOf, loadBuilds, rememberBuild, withSeenBuilds, type CompileInfo } from '../../src/utils/buildHistory.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// (this browser's storage, as a Map)
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => void store.set(k, v),
  removeItem: (k) => void store.delete(k),
};

const copy = buildCopyOf('C:\\machines\\229\\EFX\\EFX\\POUs\\EFX\\EFX.TcPOU');
expect(copy === 'C:\\machines\\229\\EFX\\EFX\\POUs\\EFX', `the copy: the POU's folder (${copy})`);

// Two builds seen, one after the other (the newest each time the app went live)
rememberBuild(copy, { id: 'eedee9f4-9617-e48a-044f-bb10fb1cbb23', at: '2026-10-08T20:42:44Z' });
rememberBuild(copy, { id: 'E83231B4-9806-EB68-87CD-2C0EF6A2578B', at: '2026-10-09T00:05:02Z' });
rememberBuild(copy, { id: 'E83231B4-9806-EB68-87CD-2C0EF6A2578B', at: '2026-10-09T00:05:02Z' });
const seen = loadBuilds(copy);
expect(seen.length === 2 && seen[0].id === 'E83231B4-9806-EB68-87CD-2C0EF6A2578B' && seen[1].id === 'EEDEE9F4-9617-E48A-044F-BB10FB1CBB23', `kept once each, newest first (${JSON.stringify(seen)})`);
expect(loadBuilds('C:\\machines\\other').length === 0, 'another copy: its own list');

const newest = { id: 'E83231B4-9806-EB68-87CD-2C0EF6A2578B', at: '2026-10-09T00:05:02Z' };
const at = (plc: string, state: CompileInfo['state']): CompileInfo => ({ plc, newest, state, builtAt: null });
// The PLC runs the build seen before: an older build of this copy, with when
const older = withSeenBuilds(at('EEDEE9F4-9617-E48A-044F-BB10FB1CBB23', 'other'), seen);
expect(older.state === 'older' && older.builtAt === '2026-10-08T20:42:44Z' && older.seenBefore === true, `seen before: older, built then (${JSON.stringify(older)})`);
// Never seen: not known
const other = withSeenBuilds(at('CDEC49C9-FFC9-F926-6D7D-1D28C929851E', 'other'), seen);
expect(other.state === 'other' && !other.seenBefore, 'never seen: not the latest build (not known which)');
// The newest: as it is
const latest = withSeenBuilds(at(newest.id, 'newest'), seen);
expect(latest.state === 'newest' && !latest.seenBefore, 'the newest: as it is');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

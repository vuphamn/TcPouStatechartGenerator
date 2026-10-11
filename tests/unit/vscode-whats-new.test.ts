// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The VS Code extension's What's New (vscode-extension/whatsNew.cjs): the features newer than the commit seen, by
// area; a notification on start only after an update with new features (not on a first install, not for fixes only);
// (the history it is made from: tests/vscode, run from the sources with git)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { featuresSince, notifyOnStart, areaOf } = require('../../vscode-extension/whatsNew.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const commits = [
  { hash: 'c4', date: '2026-10-11', changes: [{ kind: 'feat', scope: 'vscode', text: 'cross reference list' }], body: 'Every read and write.' },
  { hash: 'c3', date: '2026-10-11', changes: [{ kind: 'fix', text: 'a crash' }] },
  { hash: 'c2', date: '2026-10-10', changes: [{ kind: 'feat', scope: 'live', text: 'write all' }, { kind: 'feat', text: 'prepare' }] },
  { hash: 'c1', date: '2026-10-09', changes: [{ kind: 'feat', text: 'bookmarks' }] },
];
const r = featuresSince(commits, 'c1');
expect(r.sinceSeen && r.newest === 'c4' && r.items.map((i: { hash: string }) => i.hash).join() === 'c4,c2', `since c1: c4, c2 (${JSON.stringify(r.items)})`);
expect(r.items[0].area === 'VS Code' && r.items[0].body === 'Every read and write.' && r.items[1].title === 'Write all; Prepare' && r.items[1].area === 'Live', 'by area, titled, described');
expect(featuresSince(commits, 'gone').items.length === 3 && !featuresSince(commits, 'gone').sinceSeen, 'a commit not in the history: the latest');
expect(!notifyOnStart(commits, null) && !notifyOnStart(commits, 'c4') && notifyOnStart(commits, 'c1') && !notifyOnStart([{ hash: 'c5', changes: [{ kind: 'fix', text: 'x' }] }, ...commits], 'c4'), 'notified only after an update with new features');
expect(areaOf('xae') === 'TwinCAT XAE' && areaOf('') === 'MachineScope', 'areaOf');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

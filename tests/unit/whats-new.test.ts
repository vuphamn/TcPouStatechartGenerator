// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// What's new (src/utils/whatsNew.ts): the features newer than the commit last seen, by area, with their descriptions;
// shown by itself only after an update (not on a first start, not when nothing new); the release history's scopes and
// feature descriptions (scripts/release-plan.cjs changesOf, descriptionOf)
import { areaOf, byArea, showWhatsNewOnStart, whatsNew } from '../../src/utils/whatsNew.ts';
import type { EditionHistory } from '../../src/utils/releaseNotes.ts';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { changesOf, descriptionOf } = require('../../scripts/release-plan.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// 1. The history: scopes kept, items apart; a feature's description: its first paragraph, not its trailers
const ch = changesOf('feat(live): Activate then download, Prepare several values; fix: a crash');
expect(JSON.stringify(ch) === JSON.stringify([{ kind: 'feat', scope: 'live', text: 'Activate then download' }, { kind: 'feat', scope: 'live', text: 'Prepare several values' }, { kind: 'fix', text: 'a crash' }]), `changesOf: ${JSON.stringify(ch)}`);
expect(descriptionOf('The Solution view lists\neach library.\n\nMore here.\n\nCo-Authored-By: X <x@y>') === 'The Solution view lists each library.', 'descriptionOf: the first paragraph, one line');
expect(descriptionOf('Co-Authored-By: X <x@y>') === '' && descriptionOf('') === '', 'descriptionOf: only trailers or nothing: none');
expect(descriptionOf('word '.repeat(200)).length <= 480 && descriptionOf('word '.repeat(200)).endsWith('…'), 'descriptionOf: a long one cut at a word');

// 2. What's new since a commit
const h: EditionHistory = {
  title: 'Web edition',
  version: '1.3.0',
  unreleased: [
    { hash: 'a5', date: '2026-10-11', changes: [{ kind: 'feat', scope: 'vscode', text: 'library versions under References' }], body: 'Each library with its version.' },
    { hash: 'a4', date: '2026-10-11', changes: [{ kind: 'fix', text: 'a crash' }] },
    { hash: 'a3', date: '2026-10-10', changes: [{ kind: 'feat', scope: 'live', text: 'activate then download' }, { kind: 'feat', scope: 'live', text: 'write all' }] },
  ],
  releases: [{ tag: 'web-v1.2.0', version: '1.2.0', date: '2026-10-01', commits: [{ hash: 'a2', date: '2026-10-01', changes: [{ kind: 'feat', text: 'bookmarks' }] }, { hash: 'a1', date: '2026-09-30', changes: [{ kind: 'docs', text: 'readme' }] }] }],
};
const r = whatsNew(h, 'a2');
expect(r.sinceSeen && r.newest === 'a5' && r.items.map((i) => i.hash).join() === 'a5,a3', `since a2: a5, a3 (the fix not: ${r.items.map((i) => i.hash).join()})`);
expect(r.items[0].area === 'VS Code' && r.items[0].body === 'Each library with its version.' && r.items[1].title === 'Activate then download; Write all' && r.items[1].area === 'Live', `the items: ${JSON.stringify(r.items)}`);
const all = whatsNew(h, 'gone');
expect(!all.sinceSeen && all.items.map((i) => i.hash).join() === 'a5,a3,a2' && all.items[2].area === 'MachineScope', 'a commit no longer in the history: the latest features, across releases');
expect(whatsNew(h, null, 2).items.length === 2, 'at most max');

// 3. Shown by itself: only after an update with new features
expect(!showWhatsNewOnStart(h, null), 'a first start: not shown');
expect(!showWhatsNewOnStart(h, 'gone'), "a commit not in this edition's history (another edition's): not shown, what came since not known");
expect(!showWhatsNewOnStart(h, 'a5'), 'the same build: not shown');
const fixed: EditionHistory = { ...h, unreleased: [{ hash: 'a6', date: '2026-10-12', changes: [{ kind: 'fix', text: 'another crash' }] }, ...h.unreleased] };
expect(!showWhatsNewOnStart(fixed, 'a5'), 'only a fix since: not shown');
expect(showWhatsNewOnStart(h, 'a2'), 'new features since: shown');
expect(!showWhatsNewOnStart(undefined, 'a2'), 'no history: not shown');

// 4. By area, in order; areas said plainly
expect(JSON.stringify(byArea(all.items).map((g) => [g.area, g.items.length])) === JSON.stringify([['VS Code', 1], ['Live', 1], ['MachineScope', 1]]), 'byArea');
expect(areaOf('xae') === 'TwinCAT XAE' && areaOf('ui') === 'Ui' && areaOf(undefined) === 'MachineScope', 'areaOf');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

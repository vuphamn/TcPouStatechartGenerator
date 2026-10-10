// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// A state's bookmark key: the main state machine's state by its name (INIT), a sub-machine's state by
// <method>.<name> (readDiagnostics.INIT): a state of each with the same name bookmarked apart, in the method editor's
// lines (doState()'s CASE label, readDiagnostics()'s), the enum's members (the main enum, the sub-machine's) and the
// bookmarks list (each at its own CASE label)
import { bookmarkStateName, bookmarkedLines, enumBookmarkedLines, getBookmarks, listBookmarks, scopedStateKey, toggleLineBookmark, toggleStateBookmark } from '../../src/utils/bookmarks.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

// The keys
expect(bookmarkStateName('INIT') === 'INIT', 'the main machine\'s state: its name');
expect(bookmarkStateName('KANALOGMEASURE_ENABLING__readDiagnostics__INIT') === 'readDiagnostics.INIT', 'a sub-machine\'s: <method>.<name>');
expect(bookmarkStateName('A__m1__B__m2__C') === 'm2.C', 'a nested sub-machine\'s: its own method');
expect(JSON.stringify(scopedStateKey('readDiagnostics.INIT')) === '{"method":"readDiagnostics","name":"INIT"}' && scopedStateKey('INIT') === null, 'read back');

const POU = 'FB_KeysTest';
const doState = 'CASE machineState OF\n\tINIT:\n\t\tmachineState := RUN;\n\tRUN:\n\t\treadDiagnostics();\nEND_CASE';
const readDiagnostics = 'CASE diagState OF\n\tINIT:\n\t\tdiagState := READ;\n\tREAD:\n\t\t;\nEND_CASE';
const mainEnum = 'TYPE E_Main :\n(\n\tINIT,\n\tRUN\n);\nEND_TYPE';
const subEnum = 'TYPE E_Diag :\n(\n\tINIT,\n\tREAD\n);\nEND_TYPE';
const subKey = (m: string) => bookmarkStateName(`RUN__readDiagnostics__${m}`);

// The sub-machine's INIT bookmarked (its CASE label in readDiagnostics(), scoped): not the main machine's INIT
const r = toggleLineBookmark(POU, 'readDiagnostics', readDiagnostics, 2, { scoped: true });
expect(r.on && r.state === 'readDiagnostics.INIT' && JSON.stringify(getBookmarks(POU).states) === '["readDiagnostics.INIT"]', `set at readDiagnostics()'s label: readDiagnostics.INIT (${JSON.stringify(getBookmarks(POU).states)})`);
expect(JSON.stringify(bookmarkedLines(POU, 'readDiagnostics', readDiagnostics, { plain: false })) === '[2]', 'readDiagnostics(): its label marked');
expect(JSON.stringify(bookmarkedLines(POU, 'doState', doState)) === '[]', "doState(): the main machine's INIT not marked");
expect(JSON.stringify(enumBookmarkedLines(POU, subEnum, subKey)) === '[3]' && JSON.stringify(enumBookmarkedLines(POU, mainEnum)) === '[]', 'the enums: the sub-machine\'s INIT member only');

// The main machine's INIT too: both, each in its own place
toggleStateBookmark(POU, 'INIT');
expect(JSON.stringify(bookmarkedLines(POU, 'doState', doState)) === '[2]' && JSON.stringify(bookmarkedLines(POU, 'readDiagnostics', readDiagnostics, { plain: false })) === '[2]', 'both marked, each in its method');
const list = listBookmarks(POU, (m) => (m === 'doState' ? doState : m === 'readDiagnostics' ? readDiagnostics : null)).map((e) => `${e.state}@${e.method}:${e.line}`).sort();
expect(JSON.stringify(list) === '["INIT@doState:2","readDiagnostics.INIT@readDiagnostics:2"]', `the bookmarks list: each at its own label (${JSON.stringify(list)})`);

// The main machine's taken off: the sub-machine's kept
toggleStateBookmark(POU, 'INIT');
expect(JSON.stringify(getBookmarks(POU).states) === '["readDiagnostics.INIT"]' && JSON.stringify(bookmarkedLines(POU, 'doState', doState)) === '[]', 'the main machine\'s removed: the sub-machine\'s kept');

// A method that is no sub-machine's (getStateDescription(): CASE machineState OF INIT: …): the main machine's INIT there
toggleStateBookmark(POU, 'INIT');
expect(JSON.stringify(bookmarkedLines(POU, 'getStateDescription', 'CASE machineState OF\n\tINIT: s := \'init\';\nEND_CASE')) === '[2]', "another method's label of the main machine's state: marked as before");

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

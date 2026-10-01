// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Bookmarks shared (src/utils/bookmarks.ts): Export writes the POU's states, lines and names; Import puts them in with
// another's own (the same ones once, the names taken); not a bookmarks file: refused, nothing changed
import { exportBookmarks, getBookmarks, importBookmarks, setBookmarkNote, toggleLineBookmark, toggleStateBookmark } from '../../src/utils/bookmarks.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

toggleStateBookmark('SM_A.TcPOU', 'S_RUN');
toggleLineBookmark('SM_A.TcPOU', 'doState', 'CASE x OF\n  n := 1;\nEND_CASE', 2, { labels: false });
setBookmarkNote('SM_A.TcPOU', 'state:S_RUN', 'start here');
const file = exportBookmarks('SM_A.TcPOU');
const parsed = JSON.parse(file);
expect(parsed.format === 'kss-bookmarks' && parsed.pou === 'SM_A' && parsed.states.join() === 'S_RUN' && parsed.lines[0]?.text === 'n := 1;' && parsed.notes['state:S_RUN'] === 'start here', 'Export: states, lines, names');

// Another one's: its own kept, these added
toggleStateBookmark('SM_B.TcPOU', 'S_IDLE');
let r = importBookmarks('SM_B.TcPOU', file);
const b = getBookmarks('SM_B.TcPOU');
expect(!r.error && r.added === 2 && b.states.join() === 'S_IDLE,S_RUN' && b.lines.length === 1 && b.notes?.['state:S_RUN'] === 'start here', `Import: ${r.added} added (${b.states.join()}), the name taken`);
r = importBookmarks('SM_B.TcPOU', file);
expect(r.added === 0 && getBookmarks('SM_B.TcPOU').states.length === 2, 'again: nothing twice');
r = importBookmarks('SM_B.TcPOU', '{"states": []}');
expect(!!r.error && getBookmarks('SM_B.TcPOU').states.length === 2, `not a bookmarks file: ${r.error}`);
expect(!!importBookmarks('SM_B.TcPOU', 'nope').error, 'not JSON: refused');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

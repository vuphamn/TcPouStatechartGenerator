// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// VS Code's bookmarks (vscode-extension/bookmarks.cjs), the app's model: a section's key (a method's name, (body), a
// declaration's <name>#declaration); a line bookmark found again by its text when lines above change; a CASE label's
// line toggles its state's bookmark; a declaration's labels are no states
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bookmarkedLines, toggleAt, keyOfSection, labelNamesOf } = require('../../vscode-extension/bookmarks.cjs');

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

expect(keyOfSection('Method:doState', 'impl') === 'doState' && keyOfSection('', 'impl') === '(body)' && keyOfSection('Property:Speed.Get', 'impl') === 'Speed.Get' && keyOfSection('Method:doState', 'decl') === 'doState#declaration', 'section keys as the app\'s');
expect(labelNamesOf('\tE_State.Idle, E_State.Busy: // two') .join() === 'Idle,Busy' && labelNamesOf('\tx := 1;').length === 0 && labelNamesOf('ELSE').length === 0, 'CASE labels: their states');

const code = 'CASE eState OF\n\tE_State.Idle:\n\t\tnX := 1;\n\tE_State.Busy:\n\t\tnY := 2;\nEND_CASE';
let b = { states: [] as string[], lines: [] as { method: string; line: number; text: string }[] };
let r = toggleAt(b, 'doState', code, 3);
b = r.bookmarks;
expect(r.on && b.lines[0].text === 'nX := 1;' && bookmarkedLines(b, 'doState', code).join() === '3', 'a line toggled on');
r = toggleAt(b, 'doState', code, 4);
b = r.bookmarks;
expect(r.state === 'Busy' && b.states.join() === 'Busy' && bookmarkedLines(b, 'doState', code).join() === '3,4', 'a label: its state');
// (two lines added above: found again by its text)
const moved = '// a\n// b\n' + code;
expect(bookmarkedLines(b, 'doState', moved).join() === '5,6', `found again after lines added above (${bookmarkedLines(b, 'doState', moved).join()})`);
r = toggleAt(b, 'doState', code, 3);
expect(!r.on && r.bookmarks.lines.length === 0, 'toggled off');
expect(bookmarkedLines(b, 'doState#declaration', 'VAR\n\tBusy: INT;\nEND_VAR').length === 0, 'a declaration\'s line is no state label');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

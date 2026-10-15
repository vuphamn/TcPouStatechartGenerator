// (tests/unit: bundled with esbuild and run by tests/run.cjs, from the repository)
// The board's languages (src/utils/boardLang.ts): every t('…') of the operator board's components has its Spanish; the
// page labels and titles and the reasons offered by default too; {name} parts filled in; English is the text itself;
// which language: the address, the viewer's own, the role's, the browser's.
import fs from 'fs';
import path from 'path';
import { boardLangKeys, pickBoardLang, setBoardLang, t } from '../../src/utils/boardLang.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const FILES = ['OperatorBoard.tsx', 'BoardFiltersMenu.tsx', 'AndonBoard.tsx', 'FocusView.tsx', 'RecoveryDialog.tsx', 'HandoverDialog.tsx', 'PushDialog.tsx'];
const es = new Set(boardLangKeys('es'));
const missing: string[] = [];
let used = 0;
for (const f of FILES) {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'components', f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) {
    const key = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    used++;
    if (!es.has(key)) missing.push(`${f}: ${key}`);
  }
}
expect(used > 80 && !missing.length, `every t('…') of the board has its Spanish (${used} uses)${missing.length ? `; missing: ${missing.join(' | ')}` : ''}`);
// (the pages' labels and titles, the reasons offered by default)
const others = ['Andon', 'Machines', 'I/O', 'Drives', 'Risk', 'OEE', 'Work', 'Engineering', 'The state machines', 'Mechanical', 'Electrical', 'Material', 'Quality', 'Safety', 'Other', 'Waiting for material', 'Jam', 'Tool change', 'Changeover', 'Electrical fault', 'Mechanical fault', 'Maintenance', 'Operator break', 'Quality check', 'The last 8 hours', 'errors', 'calls'];
expect(others.every((k) => es.has(k)), `the pages, the reasons, the summary's kinds: ${others.filter((k) => !es.has(k)).join(', ') || 'all there'}`);
const board = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'OperatorBoard.tsx'), 'utf8');
const titles = [...board.matchAll(/\{ id: '\w+', icon: \w+, label: '([^']+)', title: (?:'((?:[^'\\]|\\.)*)'|"([^"]*)")/g)].map((m) => [m[1], (m[2] ?? m[3]).replace(/\\'/g, "'")]).flat();
expect(titles.length === 16 && titles.every((k) => es.has(k)), `the pages' labels and titles (${titles.length / 2} pages)${titles.filter((k) => !es.has(k)).map((k) => `; missing: ${k}`).join('')}`);

setBoardLang('es');
const a = t('{a} of {n} machines', { a: 3, n: 12 });
const b = t('Call maintenance');
const c = t('A text the board has no Spanish for');
setBoardLang('en');
const d = t('{n} stopped', { n: 2 });
expect(a === '3 de 12 máquinas' && b === 'Llamar a mantenimiento' && c === 'A text the board has no Spanish for' && d === '2 stopped', `Spanish: "${a}", "${b}"; none: "${c}"; English: "${d}"`);
expect(pickBoardLang('es', 'en', 'en', 'en-US') === 'es' && pickBoardLang(null, 'en', 'es', 'es-MX') === 'en' && pickBoardLang(null, null, 'es', 'en-US') === 'es' && pickBoardLang(null, null, null, 'es-MX') === 'es' && pickBoardLang(null, null, null, 'en-US') === 'en' && pickBoardLang('fr', null, null, 'en') === 'en', 'which: the address, the viewer\'s own, the role\'s, the browser\'s');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

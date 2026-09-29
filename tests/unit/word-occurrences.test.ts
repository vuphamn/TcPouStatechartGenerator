// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// The word under the caret and its uses marked in the code editors: identifiers only (not keywords, not within a
// selection), whole words, any case; marks only in text, never inside Prism's tags
import { highlightWordOccurrences, wordAtCaret } from '../../src/utils/stFindHighlight.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const code = 'IF bStart THEN\n\tnCount := nCount + 1;\nEND_IF';
const at = (s: string) => code.indexOf(s);
expect(wordAtCaret(code, at('nCount') + 2, at('nCount') + 2) === 'nCount', 'in a word: the word');
expect(wordAtCaret(code, at('nCount'), at('nCount')) === 'nCount' && wordAtCaret(code, at(' :=') , at(' :=')) === 'nCount', 'at its start or just after it: the word');
expect(wordAtCaret(code, at('THEN') + 1, at('THEN') + 1) === '' && wordAtCaret(code, at('END_IF') + 2, at('END_IF') + 2) === '', 'a keyword: none');
expect(wordAtCaret(code, at('nCount'), at('nCount') + 3) === '', 'a selection: none');
expect(wordAtCaret(code, at('1'), at('1')) === '', 'a number: none');

const html = '<span class="token keyword">IF</span> bStart <span class="token keyword">THEN</span>\n\tncount := NCOUNT + 1; (* nCountX *)';
const r = highlightWordOccurrences(html, 'nCount');
expect(r.count === 2 && (r.html.match(/class="word-occurrence"/g) ?? []).length === 2 && /nCountX/.test(r.html) && !/<mark[^>]*>nCountX/.test(r.html), `two uses (any case, whole words): ${r.count}`);
expect(highlightWordOccurrences('<span class="token keyword">IF</span> bStart', 'bStart').html === '<span class="token keyword">IF</span> bStart', 'one use only: nothing marked');
expect(!/class="token (<mark)/.test(highlightWordOccurrences('<span class="token">token</span> token', 'token').html) && highlightWordOccurrences('<span class="token">token</span> token', 'token').count === 2, 'a word that is also in a tag: only the text marked');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Find in Files (src/utils/findInFiles.ts): a text, a whole word, a regular expression in the POU's code (its
// declaration, body, methods), never in the XML around it; each match's place; Replace only there (a regex's $1),
// counted; the word the project's other POUs are found by
import { findMatcher, projectWordOf, replaceInCode, searchCode } from '../../src/utils/findInFiles.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };

const xml = `<?xml version="1.0" encoding="utf-8"?>
<TcPlcObject Version="1.1.0.1">
  <POU Name="FB_Axis" Id="{1}" SpecialFunc="None">
    <Declaration><![CDATA[FUNCTION_BLOCK FB_Axis
VAR
\tnCount : INT;
\tnCountMax : INT := 10;
END_VAR]]></Declaration>
    <Implementation>
      <ST><![CDATA[nCount := nCount + 1;
IF nCount > nCountMax THEN
\tnCount := 0; // ncount wraps
END_IF]]></ST>
    </Implementation>
    <Method Name="Reset" Id="{2}">
      <Declaration><![CDATA[METHOD Reset]]></Declaration>
      <Implementation>
        <ST><![CDATA[nCount := 0;]]></ST>
      </Implementation>
    </Method>
  </POU>
</TcPlcObject>`;

const rx = (o: Parameters<typeof findMatcher>[0]) => findMatcher(o) as RegExp;
const plain = searchCode(xml, rx({ query: 'nCount' }));
expect(plain.length === 9, `a text, any case: ${plain.length} (nCountMax and the comment too)`);
const word = searchCode(xml, rx({ query: 'nCount', wholeWord: true, matchCase: true }));
expect(word.length === 6 && word.every((m) => m.text.slice(m.at, m.at + 6) === 'nCount'), `a whole word, its case: ${word.length}`);
const places = word.map((m) => `${m.where}:${m.part}:${m.line}`);
expect(places[0] === 'declaration:declaration:3' && places.includes('body:implementation:2') && places.includes('Reset():implementation:1'), `their places: ${places.join(', ')}`);
expect(searchCode(xml, rx({ query: 'SpecialFunc' })).length === 0, 'the XML around the code: never');
const re = searchCode(xml, rx({ query: 'nCount\\s*:=\\s*0', regex: true }));
expect(re.length === 2, `a regular expression: ${re.length}`);
expect('error' in findMatcher({ query: '(' , regex: true }) && 'error' in findMatcher({ query: 'x*', regex: true }) && 'error' in findMatcher({ query: '' }), 'an invalid expression, one matching nothing, nothing: refused');

const r1 = replaceInCode(xml, rx({ query: 'nCount', wholeWord: true, matchCase: true }), 'nCycles');
expect(r1.count === 6 && /nCycles : INT;/.test(r1.xml) && /nCountMax/.test(r1.xml) && /\/\/ ncount wraps/.test(r1.xml) && /<POU Name="FB_Axis"/.test(r1.xml), `Replace: 6, only the whole word in the code (${r1.count})`);
const r2 = replaceInCode(xml, rx({ query: '(nCount)Max', regex: true, matchCase: true }), '$1Limit');
expect(r2.count === 2 && /nCountLimit : INT := 10/.test(r2.xml) && /nCount > nCountLimit/.test(r2.xml), "a regular expression's group: $1Limit");
expect(replaceInCode(xml, rx({ query: 'END_IF' }), ']]>').count === 0, 'what would break the CDATA: not replaced');

expect(projectWordOf({ query: 'fbAxis.nCount' }) === 'nCount' && projectWordOf({ query: 'n\\w+Max', regex: true }) === 'Max' && projectWordOf({ query: ':=' }) === null, 'the word the project is searched by');

console.log(`${fails} failures`);
process.exit(fails ? 1 : 0);

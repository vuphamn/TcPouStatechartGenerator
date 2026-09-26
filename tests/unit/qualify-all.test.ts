// (tests/unit: bundled with esbuild and run by tests/run.cjs)
// Every sample with all state names qualified (E_X.STATE) in doState and preProcess: same edges and states as unqualified
import { SAMPLES } from '../../src/samples/samplesData.ts';
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { extractIdentifiedStatesFromPou } from '../../src/utils/pouStateExtractor.ts';
import { enumMembers } from '../../src/utils/stateMachineLint.ts';

let fails = 0;
const expect = (c: boolean, w: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails++; };
const edgeKeys = (md: string) => extractEdgesFromMermaid(md).map((e) => `${e.from}->${e.to}`).sort();

for (const s of SAMPLES as any[]) {
  if (!s.dutContent) continue;
  const members = enumMembers(s.dutContent);
  const typeName = (s.dutContent.match(/TYPE\s+(\w+)/) || [])[1];
  if (!typeName || !members.length) continue;
  // qualify whole-word members that are not already qualified, in the code only (not the DUT)
  const re = new RegExp(`(?<![.\\w])(${members.join('|')})(?!\\w)`, 'g');
  const qualified = s.pouContent.replace(/<ST><!\[CDATA\[([\s\S]*?)\]\]><\/ST>/g, (_m: string, code: string) =>
    `<ST><![CDATA[${code.replace(re, `${typeName}.$1`)}]]></ST>`);
  const count = (qualified.match(new RegExp(`${typeName}\\.`, 'g')) || []).length - (s.pouContent.match(new RegExp(`${typeName}\\.`, 'g')) || []).length;
  const a = generateStatechartModel(s.dutContent, s.pouContent, { includeStateDescriptions: true });
  const b = generateStatechartModel(s.dutContent, qualified, { includeStateDescriptions: true });
  const ea = edgeKeys(a.markdown), eb = edgeKeys(b.markdown);
  const missing = ea.filter((x) => !eb.includes(x)), extra = eb.filter((x) => !ea.includes(x));
  expect(missing.length === 0 && extra.length === 0, `${s.title}: ${count} names qualified, ${eb.length}/${ea.length} edges${missing.length ? ` missing ${missing.slice(0, 4).join(' ')}` : ''}${extra.length ? ` extra ${extra.slice(0, 4).join(' ')}` : ''}`);
  const pre = (s.pouContent.match(/<Method Name="preProcess"[\s\S]*?<\/Method>/) || [''])[0];
  if (pre) expect((pre.match(re) || []).length === 0 || count > 0, `${s.title}: preProcess names qualified too`);
  const ia = extractIdentifiedStatesFromPou(s.pouContent, s.dutContent).states.map((x: any) => `${x.name}:${x.lineCount}`).sort().join(',');
  const ib = extractIdentifiedStatesFromPou(qualified, s.dutContent).states.map((x: any) => `${x.name}:${x.lineCount}`).sort().join(',');
  expect(ia === ib, `${s.title}: identified states unchanged`);
}
console.log(`${fails} failures`);

if (typeof fails === 'number' && fails > 0) process.exitCode = 1;

// (tests/unit: bundled with esbuild and run by tests/run.cjs)
import * as fs from 'fs';
import * as path from 'path';
import { generateStatechartModel } from '../../src/generator.ts';
import { extractEdgesFromMermaid } from '../../src/utils/diagramNotes.ts';
import { rankDutCandidates } from '../../src/utils/dutMatcher.ts';
import { buildEnumTables, buildGuardEdges, collectOpaque } from '../../src/utils/liveGuards.ts';

const root = process.env.KSS_PROJECT || '';
if (!root) {
  console.log('skipped: set KSS_PROJECT to a PLC project folder (a copy) to run it');
  process.exit(0);
}
const walk = (d: string, out: string[] = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!e.name.startsWith('_')) walk(f, out); } else out.push(f); } return out; };
const files = walk(root);
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const duts = files.filter((f) => /\.TcDUT$/i.test(f)).map((f) => ({ name: path.basename(f), relativePath: f, path: f, content: read(f) }));
const enums = buildEnumTables(duts.map((d) => d.content));
let pous = 0, edges = 0, matched = 0, vars = 0, opaque = 0, unresolvedLiterals = 0;
const opaqueTexts = new Map<string, number>();
const literalLike = new Set<string>();
for (const f of files.filter((f) => /\.TcPOU$/i.test(f))) {
  const pou = read(f);
  if (!/<Method\b[^>]*\bName="doState"/i.test(pou) || !/\bCASE\b[\s\S]*?\bOF\b/i.test(pou)) continue;
  const dut = rankDutCandidates(pou, duts)[0];
  let model;
  try { model = generateStatechartModel(dut && dut.matched > 0 ? dut.content : '', pou, {}); } catch { continue; }
  pous++;
  const diagramEdges = extractEdgesFromMermaid(model.markdown).filter((e) => e.from !== '[*]' && e.to !== '[*]');
  const g = buildGuardEdges(model.edges, diagramEdges, model.stateVar, enums);
  edges += diagramEdges.length;
  matched += g.length;
  if (g.length !== diagramEdges.length) console.log(`  unmatched in ${path.basename(f)}: ${diagramEdges.length - g.length}`);
  for (const e of g) {
    vars += e.refs.length;
    for (const r of e.refs) if (/^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/.test(r)) { unresolvedLiterals++; literalLike.add(r); }
    for (const m of e.members) for (const t of collectOpaque(m.expr)) { opaque++; opaqueTexts.set(t, (opaqueTexts.get(t) ?? 0) + 1); }
  }
}
if (matched !== edges || pous === 0) process.exitCode = 1;
console.log(`${pous} state machines, ${matched}/${edges} edges matched, ${vars} variable uses, ${opaque} unreadable terms, ${enums.literals.size} enum literals known`);
console.log('unreadable (most frequent):', [...opaqueTexts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${n}x ${t.slice(0, 60)}`).join(' | '));
console.log(`all-caps names treated as variables (${literalLike.size}):`, [...literalLike].slice(0, 20).join(', '));

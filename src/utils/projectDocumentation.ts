/**
 * One document for all state machines of a PLC project: for each POU with a doState() CASE its chart, states,
 * transitions with their guards, and the Problems checks. A single self-contained HTML file (print it to PDF).
 */

import mermaid from 'mermaid';
import { generateStatechart, PriorityFormat } from '../generator.ts';
import { extractEdgesFromMermaid } from './diagramNotes.ts';
import { extractIdentifiedStatesFromPou } from './pouStateExtractor.ts';
import { lintStateMachine, LINT_RULES } from './stateMachineLint.ts';
import { rankDutCandidates, DutCandidate } from './dutMatcher.ts';
import { guardOf } from './statePaths.ts';

export interface ProjectFiles {
  project: string;
  pous: { name: string; path?: string; content: string }[];
  duts: DutCandidate[];
}

export interface DocumentationOptions {
  flowchartOutput: boolean;
  collapseErrorSinkEdges: boolean;
  includeStateDescriptions: boolean;
  showTransitionPriorities: boolean;
  priorityFormat: PriorityFormat;
}

/** A state machine: doState() with a CASE */
export const isStateMachinePou = (content: string) => /<Method\b[^>]*\bName="doState"/i.test(content) && /\bCASE\b[\s\S]*?\bOF\b/i.test(content);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const anchor = (name: string) => 'pou-' + name.replace(/[^A-Za-z0-9_-]/g, '_');

export async function buildProjectDocumentation(
  files: ProjectFiles,
  options: DocumentationOptions,
  onProgress: (done: number, total: number, name: string) => void,
  isCancelled: () => boolean
): Promise<{ html: string; count: number } | null> {
  const pous = files.pous.filter((p) => isStateMachinePou(p.content)).sort((a, b) => a.name.localeCompare(b.name));
  const sections: string[] = [];
  const toc: string[] = [];
  let totalStates = 0;
  let totalTransitions = 0;
  for (let i = 0; i < pous.length; i++) {
    if (isCancelled()) return null;
    const pou = pous[i];
    const name = pou.name.replace(/\.TcPOU$/i, '');
    onProgress(i, pous.length, name);
    const best = rankDutCandidates(pou.content, files.duts)[0];
    const dut = best && best.matched > 0 ? best : null;
    let md = '';
    let svg = '';
    let failed: string | null = null;
    try {
      md = generateStatechart(dut?.content ?? '', pou.content, options);
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', layout: 'dagre', flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' }, state: { useMaxWidth: true } });
      svg = (await mermaid.render(`doc-${i}-${Math.random().toString(36).slice(2, 8)}`, md)).svg;
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
    const states = extractIdentifiedStatesFromPou(pou.content, dut?.content ?? '').states;
    const edges = md ? extractEdgesFromMermaid(md).filter((e) => e.from !== '[*]' && e.to !== '[*]') : [];
    const findings = lintStateMachine(pou.content, dut?.content ?? '', edges);
    const errors = findings.filter((f) => f.severity === 'error').length;
    const warnings = findings.filter((f) => f.severity === 'warning').length;
    totalStates += states.length;
    totalTransitions += edges.length;
    toc.push(`<li><a href="#${anchor(name)}">${esc(name)}</a> <span class="muted">${states.length} states · ${edges.length} transitions${errors + warnings ? ` · <span class="${errors ? 'err' : 'warn'}">${errors + warnings} problem${errors + warnings === 1 ? '' : 's'}</span>` : ''}</span></li>`);
    sections.push(`
<section id="${anchor(name)}">
  <h2>${esc(name)}</h2>
  <p class="muted">${esc(pou.path ?? pou.name)}${dut ? ` · enum ${esc(dut.name)}` : ' · no matching enum found'}</p>
  <div class="chart">${failed ? `<p class="err">The chart could not be drawn: ${esc(failed)}</p>` : svg}</div>
  <h3>States <span class="muted">${states.length}</span></h3>
  <table><thead><tr><th>State</th><th>Description</th><th>In</th><th>Out</th><th>Branch</th></tr></thead><tbody>
  ${states.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td>${esc(s.description ?? '')}</td><td>${edges.filter((e) => e.to === s.id && e.from !== s.id).length}</td><td>${edges.filter((e) => e.from === s.id && e.to !== s.id).length}</td><td>${s.hasCaseBranch ? 'yes' : '<span class="warn">none</span>'}</td></tr>`).join('\n  ')}
  </tbody></table>
  <h3>Transitions <span class="muted">${edges.length}</span></h3>
  <table><thead><tr><th>From</th><th>To</th><th>Guard</th></tr></thead><tbody>
  ${edges.map((e) => `<tr><td class="mono">${esc(e.from)}</td><td class="mono">${esc(e.to)}</td><td class="mono">${esc(guardOf(e))}</td></tr>`).join('\n  ')}
  </tbody></table>
  ${findings.length ? `<h3>Problems <span class="muted">${errors} errors · ${warnings} warnings</span></h3><ul class="problems">${findings.map((f) => `<li class="${f.severity}"><b>${esc(LINT_RULES[f.rule].title)}</b>: ${esc(f.message)}${f.method && f.line ? ` <span class="muted">(${esc(f.method)}:${f.line})</span>` : ''}</li>`).join('')}</ul>` : ''}
</section>`);
    // Let the page breathe between charts
    await new Promise((r) => setTimeout(r, 0));
  }
  onProgress(pous.length, pous.length, '');
  const title = `${files.project} – state machines`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; margin: 2rem auto; max-width: 1100px; padding: 0 1rem; }
  h1 { margin-bottom: .2rem; } h2 { border-bottom: 2px solid #e2e8f0; padding-bottom: .2rem; margin-top: 2.5rem; } h3 { margin: 1.2rem 0 .4rem; }
  .muted { color: #64748b; font-weight: normal; font-size: .9em; } .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; } th, td { border: 1px solid #e2e8f0; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; } .chart { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: .5rem; background: #fff; }
  .chart svg { max-width: 100%; height: auto; } .err { color: #be123c; } .warn { color: #b45309; }
  .problems li.error { color: #be123c; } .problems li.warning { color: #b45309; } .problems li.info { color: #334155; }
  @media print { section { break-before: page; } .chart { border: none; } }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${pous.length} state machines · ${totalStates} states · ${totalTransitions} transitions · generated by Kval StateScope on ${new Date().toLocaleString()}</p>
<h2>Contents</h2><ol>${toc.join('\n')}</ol>
${sections.join('\n')}
</body></html>`;
  return { html, count: pous.length };
}

/**
 * The commissioning report (the Live tab's May set to → Report…): one HTML page of a POU type's commissioning, as
 * MachineScope.commissioning.json keeps it: the states the PLC may be set to, and every state set (when, who, from,
 * to, on which PLC, why, written or not), newest first; with the counts per user and per state. Printable.
 */
import type { CommissioningEntry } from './xaeHost.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function commissioningReport(o: { pouType: string; allowed: string[]; log: CommissioningEntry[]; where: 'project' | 'browser'; made?: Date }): string {
  const made = o.made ?? new Date();
  const count = (key: (e: CommissioningEntry) => string) => {
    const m = new Map<string, number>();
    for (const e of o.log) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const byUser = count((e) => e.user || '?');
  const byState = count((e) => e.state);
  const failed = o.log.filter((e) => !e.ok).length;
  const rows = [...o.log]
    .reverse()
    .map(
      (e) =>
        `<tr class="${e.ok ? '' : 'failed'}"><td>${esc(e.t.slice(0, 19).replace('T', ' '))}</td><td>${esc(e.user)}</td><td>${esc(e.from || '?')}</td><td><b>${esc(e.state)}</b></td><td>${esc(e.plc)}</td><td>${esc(e.reason ?? '')}</td><td>${e.ok ? 'written' : `not written: ${esc(e.message ?? '')}`}</td></tr>`
    )
    .join('\n');
  const list = (pairs: [string, number][]) => pairs.map(([k, n]) => `<li>${esc(k)}: ${n}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Commissioning: ${esc(o.pouType)}</title>
<style>
body{font:14px system-ui,Segoe UI,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin-bottom:16px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f1f5f9}tr.failed td{background:#fee2e2}.cols{display:flex;gap:40px;margin:12px 0}.chip{display:inline-block;border:1px solid #888;border-radius:4px;padding:1px 6px;margin:2px;font-family:monospace}
@media print{body{margin:0}}
</style></head><body>
<h1>Commissioning: ${esc(o.pouType)}</h1>
<div class="sub">Made by Kval MachineScope ${esc(made.toLocaleString())}; from ${o.where === 'project' ? 'MachineScope.commissioning.json, beside the PLC project' : 'this browser'}. ${o.log.length} state${o.log.length === 1 ? '' : 's'} set${failed ? `, ${failed} not written` : ''}.</div>
<h2>May be set to</h2>
<div>${o.allowed.length ? o.allowed.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ') : '<i>none</i>'}</div>
<div class="cols"><div><h2>By user</h2><ul>${list(byUser) || '<li>none</li>'}</ul></div><div><h2>By state</h2><ul>${list(byState) || '<li>none</li>'}</ul></div></div>
<h2>Every state set (newest first)</h2>
<table><thead><tr><th>When (UTC)</th><th>Who</th><th>From</th><th>To</th><th>PLC</th><th>Why</th><th>Result</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="7"><i>nobody set the PLC to a state from MachineScope yet</i></td></tr>'}
</tbody></table>
</body></html>
`;
}

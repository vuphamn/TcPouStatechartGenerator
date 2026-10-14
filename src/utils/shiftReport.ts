/**
 * The shift report (the Live tab, saved at each shift's end while live: MachineScope.reports beside the PLC project,
 * or on request): one page of a shift on this PLC: the time in each state, the alerts, notes, stuck states and other
 * events, the watched values (min / avg / max), the transitions first taken and the conditions first seen both ways.
 * The shifts are the Events' Stats ones: 06–14, 14–22, 22–06 (this computer's clock).
 */
export type ShiftName = '06–14' | '14–22' | '22–06';

export interface ShiftReportInput {
  pou: string;
  plc?: string;
  shift: ShiftName;
  from: number;
  to: number;
  states: { state: string; ms: number; times: number }[];
  events: { t: number; kind: string; text: string; state?: string }[];
  values: { name: string; min: number; max: number; avg: number; n: number }[];
  coverage: { newly: { from: string; to: string }[]; taken: number; total: number } | null;
  guards: { both: number; total: number; newly: number } | null;
  made?: Date;
}

/** The shift a moment is in, and its window (this computer's clock) */
export function shiftWindow(t: number): { shift: ShiftName; from: number; to: number } {
  const d = new Date(t);
  const h = d.getHours();
  const at = (day: Date, hour: number) => {
    const x = new Date(day);
    x.setHours(hour, 0, 0, 0);
    return x.getTime();
  };
  if (h >= 6 && h < 14) return { shift: '06–14', from: at(d, 6), to: at(d, 14) };
  if (h >= 14 && h < 22) return { shift: '14–22', from: at(d, 14), to: at(d, 22) };
  // (22–06: from 22:00 the day before when past midnight)
  const start = new Date(d);
  if (h < 6) start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { shift: '22–06', from: at(start, 22), to: at(end, 6) };
}

/** The time in each state within [from, to) from a session's state values (each value until the next) */
export function stateTimesIn(values: { t: number; value: number }[], from: number, to: number, nameOf: (v: number) => string, until = to): { state: string; ms: number; times: number }[] {
  const by = new Map<string, { ms: number; times: number }>();
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(from, values[i].t);
    const b = Math.min(to, until, i + 1 < values.length ? values[i + 1].t : until);
    if (b <= a) continue;
    const name = nameOf(values[i].value);
    const s = by.get(name) ?? { ms: 0, times: 0 };
    s.ms += b - a;
    // (counted as a stay when it began in the window, or the window began in it)
    s.times += 1;
    by.set(name, s);
  }
  return [...by].map(([state, s]) => ({ state, ...s })).sort((x, y) => y.ms - x.ms);
}

/** The report's file name: SM_A_shift_2026-10-14_06-14.html */
export function shiftReportName(pou: string, from: number, shift: ShiftName): string {
  const d = new Date(from);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${pou.replace(/[^\w.-]/g, '_')}_shift_${day}_${shift.replace('–', '-')}.html`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
};
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function shiftReportHtml(o: ShiftReportInput): string {
  const made = o.made ?? new Date();
  const total = o.states.reduce((a, s) => a + s.ms, 0);
  const count = (k: string) => o.events.filter((e) => e.kind === k).length;
  const time = (t: number) => new Date(t).toLocaleTimeString();
  const day = new Date(o.from).toLocaleDateString();
  const notes = o.events.filter((e) => e.kind === 'note');
  const shown = o.events.filter((e) => ['alert', 'stuck', 'overrun', 'state', 'write', 'pause'].includes(e.kind));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shift report: ${esc(o.pou)} ${esc(day)} ${o.shift}</title>
<style>
body{font:14px system-ui,Segoe UI,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}.sub{color:#555;margin-bottom:12px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left}th{background:#f1f5f9}td.n{text-align:right}
.sum{display:flex;flex-wrap:wrap;gap:16px;margin:10px 0}.sum div{border:1px solid #ccc;border-radius:6px;padding:6px 12px}.bar{display:inline-block;height:9px;background:#0284c7;vertical-align:middle}
.note{background:#ecfdf5}@media print{body{margin:0}}
</style></head><body>
<h1>Shift report: ${esc(o.pou)}</h1>
<div class="sub">${esc(day)}, shift ${o.shift} (${time(o.from)} to ${time(o.to)})${o.plc ? `, ${esc(o.plc)}` : ''}. Made by Kval MachineScope ${esc(made.toLocaleString())}.</div>
<div class="sum"><div><b>${count('alert')}</b> alerts</div><div><b>${count('stuck')}</b> stuck</div><div><b>${count('overrun')}</b> overruns</div><div><b>${notes.length}</b> notes</div><div><b>${o.coverage ? o.coverage.newly.length : '—'}</b> transitions first taken${o.coverage ? ` (${o.coverage.taken} / ${o.coverage.total} now)` : ''}</div><div><b>${o.guards ? o.guards.newly : '—'}</b> conditions first seen both ways${o.guards ? ` (${o.guards.both} / ${o.guards.total} now)` : ''}</div></div>
<h2>Time in each state</h2>
${o.states.length ? `<table><thead><tr><th>State</th><th>Time</th><th>Share</th><th>Stays</th></tr></thead><tbody>${o.states.map((s) => `<tr><td>${esc(s.state)}</td><td class="n">${dur(s.ms)}</td><td><span class="bar" style="width:${total ? Math.round((s.ms / total) * 160) : 0}px"></span> ${total ? Math.round((s.ms / total) * 100) : 0}%</td><td class="n">${s.times}</td></tr>`).join('')}</tbody></table>` : '<p><i>not live in this shift</i></p>'}
<h2>Notes</h2>
${notes.length ? `<table><tbody>${notes.map((e) => `<tr class="note"><td>${time(e.t)}</td><td>${esc(e.state ?? '')}</td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table>` : '<p><i>none</i></p>'}
<h2>Events</h2>
${shown.length ? `<table><thead><tr><th>Time</th><th>Kind</th><th>State then</th><th>Event</th></tr></thead><tbody>${shown.slice(-300).map((e) => `<tr><td>${time(e.t)}</td><td>${esc(e.kind)}</td><td>${esc(e.state ?? '')}</td><td>${esc(e.text)}</td></tr>`).join('')}</tbody></table>` : '<p><i>none</i></p>'}
<h2>Watched values</h2>
${o.values.length ? `<table><thead><tr><th>Value</th><th>Min</th><th>Avg</th><th>Max</th><th>Samples</th></tr></thead><tbody>${o.values.map((v) => `<tr><td>${esc(v.name)}</td><td class="n">${num(v.min)}</td><td class="n">${num(v.avg)}</td><td class="n">${num(v.max)}</td><td class="n">${v.n}</td></tr>`).join('')}</tbody></table>` : '<p><i>none watched</i></p>'}
<h2>Transitions first taken</h2>
${o.coverage?.newly.length ? `<ul>${o.coverage.newly.map((r) => `<li>${esc(r.from)} → ${esc(r.to)}</li>`).join('')}</ul>` : '<p><i>none</i></p>'}
</body></html>
`;
}

// Shift report: per shift (config.json "shifts": [{ "name": "Early", "from": "06:00", "to": "14:00" }, ...]; default:
// the whole day), the alerts: how many of each kind, how long until acknowledged and resolved, the machines with the
// most, what is still open, the maintenance windows, the notes written live (the Live tab's + Note). Posted to "reports.webhook" when a shift ends; the board
// downloads it (CSV) for the last shift, today or yesterday.
const fs = require('fs');
const { postWebhook } = require('./alerts.cjs');

const hm = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The shifts, checked: [{ name, from, to }] (minutes; to may be past midnight) */
function checkShifts(list) {
  if (list == null || (Array.isArray(list) && !list.length)) return [{ name: 'Day', from: 0, to: 24 * 60 }];
  if (!Array.isArray(list) || list.length > 6) throw new Error('Shifts: a list of up to 6 { name, from, to }');
  return list.map((s, i) => {
    const from = hm(s?.from);
    const to = hm(s?.to);
    if (from === null || to === null || from === to) throw new Error(`Shift ${i + 1}: from and to are times such as 06:00 and 14:00`);
    return { name: String(s?.name ?? '').trim().slice(0, 30) || `Shift ${i + 1}`, from, to };
  });
}

/** The shift windows (ms) that overlap [from, to], in order */
function shiftWindows(shifts, from, to) {
  const out = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - 1);
  for (let d = day.getTime(); d <= to; ) {
    for (const s of shifts) {
      const a = new Date(d);
      a.setMinutes(s.from);
      const b = new Date(d);
      b.setMinutes(s.to + (s.to <= s.from ? 24 * 60 : 0));
      if (b.getTime() > from && a.getTime() < to) out.push({ name: s.name, from: a.getTime(), to: b.getTime() });
    }
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    d = next.getTime();
  }
  return out.sort((x, y) => x.from - y.from);
}

const mins = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1)} h`);

/** The report of [from, to] from the alert history, the maintenance windows and the notes written live ({ t, user, plc, pou, text }) */
function buildReport({ name, from, to }, events, maintenanceWindows = [], notes = []) {
  const notesIn = notes.filter((n) => n && n.t >= from && n.t < to).sort((a, b) => a.t - b.t);
  const inWindow = events.filter((e) => Date.parse(e.at) >= from && Date.parse(e.at) < to);
  // (muted ones, in maintenance or quiet hours: not counted)
  const alerts = inWindow.filter((e) => e.event !== 'recovered' && !e.muted);
  const kinds = {};
  for (const e of alerts) kinds[e.event] = (kinds[e.event] ?? 0) + 1;
  const acked = alerts.filter((e) => e.ack);
  const ackTimes = acked.map((e) => Date.parse(e.ack.at) - Date.parse(e.at)).filter((x) => x >= 0);
  const resolvedTimes = alerts.filter((e) => e.resolvedAt).map((e) => Date.parse(e.resolvedAt) - Date.parse(e.at)).filter((x) => x >= 0);
  const byMachine = new Map();
  for (const e of alerts) byMachine.set(e.machine, (byMachine.get(e.machine) ?? 0) + 1);
  const top = [...byMachine.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([machine, n]) => ({ machine, n }));
  const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
  const open = alerts.filter((e) => !e.ack && !e.resolvedAt);
  const summary = {
    name, from, to, alerts: alerts.length, kinds, acknowledged: acked.length, escalated: alerts.filter((e) => e.escalatedAt).length,
    ackAvgMs: avg(ackTimes), ackMaxMs: ackTimes.length ? Math.max(...ackTimes) : null, resolvedAvgMs: avg(resolvedTimes), resolvedMaxMs: resolvedTimes.length ? Math.max(...resolvedTimes) : null,
    open: open.length, top, maintenance: maintenanceWindows,
    notes: notesIn.length, noteList: notesIn.slice(-5).map((n) => ({ t: n.t, user: n.user, plc: n.plc, text: n.text })),
  };
  const noteText = notesIn.length ? `; ${notesIn.length} note${notesIn.length === 1 ? '' : 's'}: ${notesIn.slice(-3).map((n) => `"${String(n.text).slice(0, 60)}" (${n.user})`).join(', ')}` : '';
  const time = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const kindText = Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ');
  summary.text = alerts.length
    ? `📋 ${name} (${time(from)} to ${time(to)}): ${alerts.length} alert${alerts.length === 1 ? '' : 's'} (${kindText}); acknowledged ${acked.length}${summary.ackAvgMs !== null ? ` in ${mins(summary.ackAvgMs)} on average (longest ${mins(summary.ackMaxMs)})` : ''}; ${summary.escalated ? `${summary.escalated} escalated; ` : ''}${open.length ? `${open.length} still open; ` : ''}most: ${top.map((t) => `${t.machine.split('.').pop()} (${t.n})`).join(', ')}${maintenanceWindows.length ? `; ${maintenanceWindows.length} maintenance window(s)` : ''}${noteText}`
    : `📋 ${name} (${time(from)} to ${time(to)}): no alerts${maintenanceWindows.length ? `; ${maintenanceWindows.length} maintenance window(s)` : ''}${noteText}`;
  return { summary, alerts: inWindow, notes: notesIn };
}

/** The report as CSV: a summary line, then one row per alert */
function reportCsv({ summary, alerts, notes = [] }) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const iso = (t) => (t ? new Date(t).toISOString() : '');
  const rows = [
    ['report', summary.name, iso(summary.from), iso(summary.to), `${summary.alerts} alerts`, `${summary.acknowledged} acknowledged`, `${summary.open} open`].map(q).join(','),
    ['at', 'event', 'plc', 'machine', 'state', 'acknowledged by', 'acknowledged at', 'note', 'resolved at', 'escalated at', 'text'].map(q).join(','),
    ...alerts.map((e) => [e.at, e.event, e.plcName ?? e.plc, e.machine, e.state, e.ack?.by, e.ack?.at, e.ack?.note, e.resolvedAt, e.escalatedAt, e.text].map(q).join(',')),
    ...(notes.length ? [['note at', 'by', 'plc', 'pou', 'note'].map(q).join(','), ...notes.map((n) => [iso(n.t), n.user, n.plc, n.pou, n.text].map(q).join(','))] : []),
  ];
  return rows.join('\r\n') + '\r\n';
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/**
 * The window a scheduled email report is due for now (reports.email: { when: 'daily' | 'weekly', day, at }), or null:
 * daily, yesterday (its time passed today, not sent today); weekly, the last 7 days (its day, its time passed)
 */
function emailWindow(email, now, lastKey) {
  if (!email || !['daily', 'weekly'].includes(email.when)) return null;
  const [hh, mm] = String(email.at || '07:00').split(':').map(Number);
  const d = new Date(now);
  const at = new Date(d);
  at.setHours(hh || 0, mm || 0, 0, 0);
  if (now < at.getTime()) return null;
  if (email.when === 'weekly' && d.getDay() !== Math.max(0, DAYS.indexOf(String(email.day || 'mon').slice(0, 3).toLowerCase()))) return null;
  const midnight = new Date(d);
  midnight.setHours(0, 0, 0, 0);
  const key = `${email.when}|${midnight.toDateString()}`;
  if (key === lastKey) return null;
  const days = email.when === 'weekly' ? 7 : 1;
  return { key, name: email.when === 'weekly' ? 'The last 7 days' : 'Yesterday', from: midnight.getTime() - days * 86400000, to: midnight.getTime() };
}

/** The rest of a report, for its email: stops and OEE, work orders, drives to watch, alerts still open (handover.cjs' summary) */
function moreText(s) {
  if (!s) return '';
  const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`);
  const lines = [];
  if (s.stops) lines.push(`Stops: ${s.stops.count}, ${mins(s.stops.downMs)} down; availability ${pct(s.stops.availability)}, OEE ${pct(s.stops.oee)}${s.stops.reasons.length ? `; most: ${s.stops.reasons.map((r) => `${r.reason} ${mins(r.ms)}`).join(', ')}` : ''}${s.stops.noReason ? ` (${s.stops.noReason} without a reason)` : ''}`);
  lines.push(`Work orders: ${s.work.opened.length} opened, ${s.work.done.length} done, ${s.work.open.length} open`);
  for (const o of s.work.open.slice(0, 10)) lines.push(`  #${o.number} ${o.title} (${o.priority}${o.assignee ? `, ${o.assignee}` : ''})`);
  if (s.drives.length) lines.push('Drives to watch:', ...s.drives.map((d) => `  ${d.name} (${d.plcName}): ${d.text}`));
  if (s.open.length) lines.push('Alerts still open:', ...s.open.slice(0, 15).map((a) => `  ${a.text}${a.ack ? '' : ' (not acknowledged)'}`));
  return lines.join('\n');
}

/**
 * Posts each shift's report when it ends (reports.webhook); emails it (reports.email: each shift, or daily or weekly at
 * a time) with its CSV; the last ones sent kept in reports.json
 */
function createReports({ file, getConfig, events, maintenanceOf, log, audit, notes = () => [], sendEmail = null, more = () => null, link = () => '' }) {
  let last = 0;
  let lastEmail = '';
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    last = kept.lastEnd ?? 0;
    lastEmail = kept.lastEmail ?? '';
  } catch {
    last = 0;
  }
  const keep = () => {
    try {
      fs.writeFileSync(file, JSON.stringify({ lastEnd: last, lastEmail }));
    } catch {
      // sent again after a restart, at worst
    }
  };
  /** A report emailed: its summary, the rest (stops, work, drives, open), its CSV attached */
  const email = async (w) => {
    const e = getConfig().reports?.email;
    if (!e?.to?.length || !sendEmail) throw new Error('No one to email the report to: the setup page, Shift reports');
    const r = buildReport(w, events(), maintenanceOf(w.from, w.to), notes(w.from, w.to));
    const rest = moreText(more(w.from, w.to));
    const day = new Date(w.from).toISOString().slice(0, 10);
    await sendEmail({
      to: e.to,
      subject: `MachineScope report: ${w.name} (${r.summary.alerts} alert${r.summary.alerts === 1 ? '' : 's'})`,
      text: `${r.summary.text}${rest ? `\n\n${rest}` : ''}${link() ? `\n\nThe board: ${link()}` : ''}\n\n(Kval MachineScope gateway; every alert of the report in the CSV attached)`,
      attachments: [{ filename: `report-${day}-${String(w.name).replace(/[^\w-]+/g, '_')}.csv`, content: reportCsv(r), type: 'text/csv' }],
    });
    log(`reports: ${w.name} report emailed to ${e.to.join(', ')}`);
    audit?.add('gateway', 'report.emailed', { name: w.name, from: new Date(w.from).toISOString(), to: e.to.length });
  };
  const tick = () => {
    const cfg = getConfig();
    // (by email, daily or weekly)
    const ew = emailWindow(cfg.reports?.email, Date.now(), lastEmail);
    if (ew) {
      lastEmail = ew.key;
      keep();
      void email(ew).catch((err) => log(`reports: not emailed: ${err.message}`));
    }
    const byEmail = cfg.reports?.email?.when === 'shift' && cfg.reports.email.to?.length;
    if (!cfg.reports?.webhook && !byEmail) return;
    let shifts;
    try {
      shifts = checkShifts(cfg.shifts);
    } catch {
      return;
    }
    const now = Date.now();
    // (a gateway started long after: only the last shift that ended is sent)
    const ended = shiftWindows(shifts, now - 36 * 3600000, now).filter((w) => w.to <= now && w.to > last);
    const w = ended[ended.length - 1];
    if (!w) return;
    last = w.to;
    keep();
    if (byEmail) void email(w).catch((err) => log(`reports: not emailed: ${err.message}`));
    if (!cfg.reports?.webhook) return;
    const r = buildReport(w, events(), maintenanceOf(w.from, w.to), notes(w.from, w.to));
    log(`reports: ${w.name} report posted (${r.summary.alerts} alerts)`);
    audit?.add('gateway', 'report.posted', { shift: w.name, from: new Date(w.from).toISOString(), alerts: r.summary.alerts });
    void postWebhook(cfg.reports.webhook, cfg.reports.format || 'teams', { event: 'report', ...r.summary }, log);
  };
  const timer = setInterval(tick, Number(process.env.KSS_REPORT_CHECK_MS) || 60000);
  timer.unref();
  return {
    tick,
    /** A report emailed now: "last" (the last shift that ended), "today", "yesterday" */
    async emailNow(which) {
      const r = this.report(which);
      await email({ name: r.summary.name ?? which, from: r.summary.from ?? Date.now() - 86400000, to: r.summary.to ?? Date.now() });
    },
    /** "last" (the last shift that ended), "today", "yesterday", or { from, to } */
    report(which) {
      const shifts = checkShifts(getConfig().shifts);
      const now = Date.now();
      let w;
      if (which === 'today' || which === 'yesterday') {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        if (which === 'yesterday') d.setDate(d.getDate() - 1);
        const e = new Date(d);
        e.setDate(e.getDate() + 1);
        w = { name: which === 'today' ? 'Today' : 'Yesterday', from: d.getTime(), to: Math.min(e.getTime(), now) };
      } else if (which && typeof which === 'object') {
        w = { name: 'Report', from: Number(which.from), to: Number(which.to) };
      } else {
        const ended = shiftWindows(shifts, now - 48 * 3600000, now).filter((x) => x.to <= now);
        // (no shift has ended in two days: today so far)
        w = ended[ended.length - 1] ?? { name: 'Today', from: new Date(new Date(now).setHours(0, 0, 0, 0)).getTime(), to: now };
      }
      const r = buildReport(w, events(), maintenanceOf(w.from, w.to), notes(w.from, w.to));
      return { ...r, csv: reportCsv(r) };
    },
    /** The report posted now to reports.webhook (the setup page's "Send now") */
    async send(which) {
      const cfg = getConfig();
      if (!cfg.reports?.webhook) throw new Error('No reports webhook: save one first');
      const r = this.report(which);
      log(`reports: ${r.summary.name} report sent from the setup page`);
      return postWebhook(cfg.reports.webhook, cfg.reports.format || 'teams', { event: 'report', ...r.summary }, log);
    },
    stop: () => clearInterval(timer),
  };
}

module.exports = { createReports, checkShifts, shiftWindows, buildReport, reportCsv, emailWindow, moreText };

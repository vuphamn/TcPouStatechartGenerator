// The plant roll-up (the Sites page; a weekly email): each gateway's summary — this one's and those it follows
// (their "siteSummary", asked with their view-only tokens) — its OEE over 24 hours and 7 days, its availability, its
// downtime and stops, its top stop reasons, its alarms an hour, its open alerts; the plant's totals (OEE and
// availability weighted by planned time); each Monday (config.plantReport: day, at) emailed to config.plantReport.to
// and posted to its webhook.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A gateway's own summary: { name, at, day: {…}, week: {…}, top, alarmsPerHour, openAlerts } */
function summaryOf({ name, report, events, alarmHealth, now = Date.now() }) {
  const pick = (r) => {
    const planned = (r.machines ?? []).reduce((a, m) => a + (m.plannedMs ?? 0), 0);
    return { oee: r.line?.oee ?? null, availability: r.line?.availability ?? null, performance: r.line?.performance ?? null, quality: r.line?.quality ?? null, downMs: r.line?.downMs ?? 0, stops: r.line?.stops ?? 0, plannedMs: planned, machines: (r.machines ?? []).length };
  };
  const day = report({ from: now - 86400000, to: now });
  const week = report({ from: now - 7 * 86400000, to: now });
  const ah = alarmHealth({ events, from: now - 86400000, to: now });
  const open = events.filter((e) => !e.resolvedAt && !e.muted && e.event !== 'recovered').length;
  return { name, at: now, day: pick(day), week: pick(week), top: (week.pareto?.reason ?? []).slice(0, 3).map((x) => ({ reason: x.key, ms: x.ms, count: x.count })), alarmsPerHour: ah.perHour ?? null, openAlerts: open };
}

/** The plant's totals over rows of summaries: OEE and availability weighted by planned time; downtime, stops summed */
function totalsOf(rows) {
  const tot = (k) => {
    const w = rows.filter((r) => r?.[k] && r[k].plannedMs > 0);
    const planned = w.reduce((a, r) => a + r[k].plannedMs, 0);
    const avg = (f) => {
      const x = w.filter((r) => typeof r[k][f] === 'number');
      const p = x.reduce((a, r) => a + r[k].plannedMs, 0);
      return p > 0 ? x.reduce((a, r) => a + r[k][f] * r[k].plannedMs, 0) / p : null;
    };
    return { oee: avg('oee'), availability: avg('availability'), downMs: rows.reduce((a, r) => a + (r?.[k]?.downMs ?? 0), 0), stops: rows.reduce((a, r) => a + (r?.[k]?.stops ?? 0), 0), plannedMs: planned };
  };
  return { day: tot('day'), week: tot('week'), openAlerts: rows.reduce((a, r) => a + (r?.openAlerts ?? 0), 0), alarmsPerHour: rows.reduce((a, r) => a + (r?.alarmsPerHour ?? 0), 0) };
}

const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)} %`);
const hours = (ms) => `${(ms / 3600000).toFixed(1)} h`;

/** The roll-up as text (the email), one line a gateway, the plant last */
function textOf(rows, total) {
  const line = (n, r) => `${n}: OEE ${pct(r?.week?.oee)} the last 7 days (${pct(r?.day?.oee)} the last 24 h), availability ${pct(r?.week?.availability)}, ${hours(r?.week?.downMs ?? 0)} down in ${r?.week?.stops ?? 0} stops, ${r?.openAlerts ?? 0} open alerts${r?.top?.length ? `; most: ${r.top.map((t) => `${t.reason} ${hours(t.ms)}`).join(', ')}` : ''}`;
  return [...rows.map((r) => (r.away ? `${r.name}: not answering${r.message ? ` (${r.message})` : ''}` : line(r.name, r))), '', line('The plant', { ...total, top: [] })].join('\n');
}

/** The roll-up followed: this gateway's summary (cached 10 minutes), the sites', the weekly email */
function createPlant({ getConfig, ownSummary, siteRows, sendEmail, postWebhook, log, audit }) {
  let cache = null;
  const own = () => {
    if (!cache || Date.now() - cache.at > 10 * 60000) cache = ownSummary();
    return cache;
  };
  const rollup = () => {
    const rows = [{ id: 'self', ...own(), self: true }, ...siteRows()];
    return { rows, total: totalsOf(rows.filter((r) => !r.away)) };
  };
  let lastKey = '';
  const send = async (user = 'schedule') => {
    const pr = getConfig().plantReport ?? {};
    const { rows, total } = rollup();
    const text = textOf(rows, total);
    const sent = [];
    if (Array.isArray(pr.to) && pr.to.length && sendEmail) {
      await sendEmail({ to: pr.to, subject: `The plant, the last 7 days: OEE ${pct(total.week.oee)}`, text: `${text}${pr.link ? `\n\nThe Sites page: ${pr.link}` : ''}\n\n(Kval MachineScope gateway)` });
      sent.push('email');
    }
    if (pr.webhook && postWebhook) {
      await postWebhook(pr.webhook, ['teams', 'slack', 'json'].includes(pr.format) ? pr.format : 'teams', { event: 'plant.weekly', text, at: new Date().toISOString(), total, rows: rows.map(({ id, name, day, week, openAlerts, away }) => ({ id, name, day, week, openAlerts, away: !!away })) }, log);
      sent.push('webhook');
    }
    log(`plant: the weekly roll-up${sent.length ? ` sent (${sent.join(', ')})` : ': nowhere to send it'}`);
    audit?.add(user, 'plant.report', { sent });
    return { sent, text };
  };
  const timer = setInterval(() => {
    const pr = getConfig().plantReport;
    if (!pr || (!pr.to?.length && !pr.webhook)) return;
    const now = new Date();
    const [hh, mm] = String(pr.at ?? '07:00').split(':').map(Number);
    const day = DAYS.indexOf(String(pr.day ?? 'mon').slice(0, 3).toLowerCase());
    const key = now.toDateString();
    if (now.getDay() !== (day < 0 ? 1 : day) || now.getHours() !== hh || now.getMinutes() !== mm || lastKey === key) return;
    lastKey = key;
    void send().catch((err) => log(`plant: the weekly roll-up not sent: ${err.message}`));
  }, 30000);
  timer.unref?.();
  return { own, rollup, send, stop: () => clearInterval(timer) };
}

module.exports = { summaryOf, totalsOf, textOf, createPlant };

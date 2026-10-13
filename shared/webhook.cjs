// An alert told to a webhook (Teams, Slack: a JSON { text } POSTed), from the desktop app's main process or the VS Code
// extension's host (the page cannot: CORS; the XAE extension posts it in C#). Only https. → { ok, status } or { error }
async function postWebhook(url, text) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { ok: false, error: 'Not a URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Only an https:// webhook' };
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ text: String(text).slice(0, 4000) }), signal: AbortSignal.timeout(15000) });
    return r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `The webhook answered ${r.status}` };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

module.exports = { postWebhook };

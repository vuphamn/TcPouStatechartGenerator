// What's New in the VS Code extension: the features since the version last opened here (the feature commits of the
// git history; the VSIX carries them as whatsNew.json, written by pack.cjs), by area, each with what it does. Once
// after an update a notification offers them; a first install says nothing; the command shows them any time.
'use strict';
const fs = require('fs');
const path = require('path');

const SEEN_KEY = 'kvalMachineScope.whatsNew.seen';
const AREA = { vscode: 'VS Code', xae: 'TwinCAT XAE', activate: 'TwinCAT', twincat: 'TwinCAT', live: 'Live', editors: 'Code editors', editor: 'Code editors', canvas: 'Statechart', statechart: 'Statechart', layout: 'Layout', app: 'MachineScope', desktop: 'Desktop app', web: 'Web' };
const areaOf = (scope) => {
  const s = String(scope ?? '').trim().toLowerCase();
  return s ? AREA[s] ?? s.charAt(0).toUpperCase() + s.slice(1) : 'MachineScope';
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The features: the VSIX's whatsNew.json; run from its sources (development, the tests): from git */
function loadFeatures(extensionPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(extensionPath, 'whatsNew.json'), 'utf8'));
  } catch {
    // (not packaged)
  }
  try {
    // eslint-disable-next-line import/no-dynamic-require
    return require(path.join(__dirname, '..', 'scripts', 'release-plan.cjs')).vscodeFeatures();
  } catch {
    return [];
  }
}

/** The features newer than the commit seen (none seen or gone: the latest) → { items, newest, sinceSeen } */
function featuresSince(commits, seen, max = 40) {
  const newest = commits[0]?.hash ?? null;
  const at = seen ? commits.findIndex((c) => c.hash === seen) : -1;
  const items = (at >= 0 ? commits.slice(0, at) : commits)
    .map((c) => {
      const feats = (c.changes ?? []).filter((x) => x.kind === 'feat' && x.text);
      return feats.length ? { hash: c.hash, date: c.date, title: feats.map((x) => cap(x.text)).join('; '), body: c.body ?? '', area: areaOf(feats[0].scope) } : null;
    })
    .filter(Boolean)
    .slice(0, max);
  return { items, newest, sinceSeen: at >= 0 };
}

/** A notification on start: an earlier version seen here and new features since (a first install: nothing) */
const notifyOnStart = (commits, seen) => {
  if (!seen) return false;
  const r = featuresSince(commits, seen);
  return !!r.newest && r.newest !== seen && r.items.length > 0;
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function html(r, version) {
  const groups = [];
  for (const it of r.items) {
    let g = groups.find((x) => x.area === it.area);
    if (!g) groups.push((g = { area: it.area, items: [] }));
    g.items.push(it);
  }
  const intro = r.sinceSeen ? `${r.items.length} new feature${r.items.length === 1 ? '' : 's'} since you last used it.` : 'The latest features.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:16px 24px;max-width:860px}
h1{font-size:1.4em;margin:0 0 4px}.intro{color:var(--vscode-descriptionForeground);margin-bottom:12px}
h2{font-size:.8em;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-textLink-foreground);margin:18px 0 6px}
.item{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 12px;margin:6px 0;background:var(--vscode-sideBar-background)}
.title{font-weight:600}.date{float:right;color:var(--vscode-descriptionForeground);font-size:.85em;font-family:var(--vscode-editor-font-family)}
.body{color:var(--vscode-descriptionForeground);margin-top:4px;line-height:1.45}
</style></head><body>
<h1>What's New in Kval MachineScope${version ? ` ${esc(version)}` : ''}</h1><div class="intro">${esc(intro)}</div>
${groups.map((g) => `<h2>${esc(g.area)}</h2>${g.items.map((it) => `<div class="item" data-hash="${esc(it.hash)}"><span class="date">${esc(it.date)}</span><div class="title">${esc(it.title)}</div>${it.body ? `<div class="body">${esc(it.body)}</div>` : ''}</div>`).join('')}`).join('')}
${r.items.length ? '' : '<p>No features listed in this build.</p>'}
</body></html>`;
}

function registerWhatsNew(context, vscode) {
  const commits = loadFeatures(context.extensionPath);
  const version = context.extension?.packageJSON?.version ?? '';
  let panel = null;
  const show = (since) => {
    const r = featuresSince(commits, since === undefined ? null : since);
    const shown = r.items.length ? r : featuresSince(commits, null, 20);
    if (panel) panel.reveal();
    else {
      panel = vscode.window.createWebviewPanel('kvalMachineScope.whatsNew', "What's New: MachineScope", vscode.ViewColumn.Active, { enableScripts: false });
      panel.onDidDispose(() => (panel = null));
    }
    panel.webview.html = html({ ...shown, sinceSeen: r.items.length > 0 && r.sinceSeen }, version);
    if (r.newest) void context.globalState.update(SEEN_KEY, r.newest);
    return { items: shown.items.length, sinceSeen: r.items.length > 0 && r.sinceSeen, newest: r.newest };
  };
  // (since: a commit, the features after it; the tests')
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.whatsNew', (since) => show(typeof since === 'string' ? since : context.globalState.get(SEEN_KEY, null))));
  const seen = context.globalState.get(SEEN_KEY, null);
  const newest = commits[0]?.hash;
  if (!seen && newest) void context.globalState.update(SEEN_KEY, newest);
  else if (notifyOnStart(commits, seen)) {
    const n = featuresSince(commits, seen).items.length;
    void context.globalState.update(SEEN_KEY, newest);
    void vscode.window.showInformationMessage(`Kval MachineScope was updated: ${n} new feature${n === 1 ? '' : 's'}.`, "What's New").then((c) => {
      if (c) show(seen);
    });
  }
}

module.exports = { registerWhatsNew, featuresSince, notifyOnStart, areaOf };

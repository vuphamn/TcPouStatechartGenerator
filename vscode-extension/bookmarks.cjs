// Bookmarks in VS Code, as TwinCAT's PLC bookmarks and MachineScope's (the same model, kept in sync): per POU, its
// states (a CASE label's line marked) and its lines (a member's declaration or implementation, found again by the
// line's text when lines above change). Kept by the extension (the workspace's state); the statechart and the code tab
// of that POU get them and tell their changes (bookmarksChanged / bookmarks).
'use strict';
const path = require('path');

const BODY = '(body)';
/** A section's bookmark key, as the app's: a method's name (doState, Speed.Get, Reset), (body) for the POU itself; a declaration's: <name>#declaration */
function keyOfSection(memberKey, section) {
  const m = !memberKey ? BODY : memberKey.replace(/^(Method|Property|Action|Transition):/, '');
  return section === 'decl' ? `${m}#declaration` : m;
}

const LABEL_RX = /^\s*((?:[A-Za-z_][\w.]*|\d+)(?:\s*(?:,|\.\.)\s*(?:[A-Za-z_][\w.]*|\d+))*)\s*:(?!=)/;
const stripComment = (l) => l.replace(/\(\*.*?\*\)/g, '').replace(/\/\/.*$/, '');
/** The state names a line's CASE label gives (E_State.Idle: → Idle), or none */
function labelNamesOf(line) {
  const m = LABEL_RX.exec(stripComment(line));
  if (!m) return [];
  return m[1].split(/\s*(?:,|\.\.)\s*/).map((n) => n.split('.').pop()).filter((n) => /^[A-Za-z_]\w*$/.test(n) && !/^(ELSE|END_CASE)$/i.test(n));
}

/** A POU's bookmarks, as stored (missing parts empty) */
const normalize = (b) => ({
  states: Array.isArray(b?.states) ? b.states.filter((s) => typeof s === 'string') : [],
  lines: Array.isArray(b?.lines) ? b.lines.filter((l) => l && typeof l.method === 'string' && typeof l.line === 'number') : [],
  ...(b?.notes && typeof b.notes === 'object' ? { notes: b.notes } : {}),
});

/** A section's bookmarked lines (1-based, in order): its line bookmarks (by their text, the nearest), its labels' states */
function bookmarkedLines(b, key, text) {
  const lines = text.split(/\r?\n/);
  const out = new Set();
  for (const bm of b.lines) {
    if (bm.method !== key) continue;
    let best = -1;
    lines.forEach((l, i) => {
      if (bm.text && l.trim() === bm.text && (best < 0 || Math.abs(i + 1 - bm.line) < Math.abs(best - bm.line))) best = i + 1;
    });
    if (best < 0) best = Math.min(Math.max(1, bm.line), lines.length);
    out.add(best);
  }
  if (b.states.length && !key.endsWith('#declaration')) {
    const states = new Set(b.states);
    lines.forEach((l, i) => {
      if (labelNamesOf(l).some((n) => states.has(n) || states.has(`${key}.${n}`))) out.add(i + 1);
    });
  }
  return [...out].sort((a, c) => a - c);
}

/** A line toggled (1-based): a CASE label's state, else the line → { bookmarks, on, state? } */
function toggleAt(b, key, text, line) {
  const lines = text.split(/\r?\n/);
  const state = key.endsWith('#declaration') ? null : labelNamesOf(lines[line - 1] ?? '')[0];
  if (state) {
    const on = !b.states.includes(state);
    return { bookmarks: { ...b, states: on ? [...b.states, state] : b.states.filter((s) => s !== state) }, on, state };
  }
  const at = bookmarkedLines({ ...b, states: [] }, key, text);
  if (at.includes(line)) {
    // (the bookmark found on this line: the one whose text is there, or at that line)
    const t = (lines[line - 1] ?? '').trim();
    const idx = b.lines.findIndex((x) => x.method === key && (x.text === t || x.line === line));
    return { bookmarks: { ...b, lines: b.lines.filter((_, i) => i !== idx) }, on: false };
  }
  return { bookmarks: { ...b, lines: [...b.lines, { method: key, line, text: (lines[line - 1] ?? '').trim() }] }, on: true };
}

/**
 * VS Code's side: the store, the gutter marks in the sections, Toggle / Next / Previous / Clear, the Bookmarks view;
 * apps: { postsOf(file) → the app panels' posts of that POU } (told when bookmarks change here)
 */
function registerBookmarks(context, { vscode, SCHEME, addressOf, parseSource, readText, openMember, apps }) {
  const keyOf = (file) => `kss.bookmarks|${path.resolve(file).toLowerCase()}`;
  const get = (file) => normalize(context.workspaceState.get(keyOf(file)));
  const known = () => (context.workspaceState.get('kss.bookmarks.files') ?? []).filter((f) => typeof f === 'string');
  const changed = new vscode.EventEmitter();
  /** A POU's bookmarks set (from: the app panel that changed them, not told again) */
  async function set(file, b, from = null) {
    const next = normalize(b);
    await context.workspaceState.update(keyOf(file), next.states.length || next.lines.length || Object.keys(next.notes ?? {}).length ? next : undefined);
    const files = new Set(known().map((f) => path.resolve(f).toLowerCase()));
    if (next.states.length || next.lines.length) files.add(path.resolve(file).toLowerCase());
    else files.delete(path.resolve(file).toLowerCase());
    await context.workspaceState.update('kss.bookmarks.files', [...files]);
    for (const post of apps.postsOf(file)) if (post !== from) post({ type: 'bookmarks', bookmarks: next });
    render();
    changed.fire(undefined);
  }

  // (the gutter's mark, the overview ruler's)
  const icon = vscode.Uri.joinPath(context.extensionUri, 'media', 'bookmark.svg');
  const deco = vscode.window.createTextEditorDecorationType({ gutterIconPath: icon, gutterIconSize: '80%', overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.infoForeground'), overviewRulerLane: vscode.OverviewRulerLane.Right });
  context.subscriptions.push(deco, changed);
  const sectionOf = (doc) => {
    if (doc.uri.scheme !== SCHEME) return null;
    try {
      const a = addressOf(doc.uri.query);
      return /\.tcpou$/i.test(a.file) ? { file: a.file, member: a.key, section: a.section, key: keyOfSection(a.key, a.section) } : null;
    } catch {
      return null;
    }
  };
  const linesShown = new Map(); // (for the tests: uri → bookmarked lines)
  function render() {
    for (const ed of vscode.window.visibleTextEditors) {
      const s = sectionOf(ed.document);
      if (!s) continue;
      const lines = bookmarkedLines(get(s.file), s.key, ed.document.getText());
      linesShown.set(ed.document.uri.toString(), lines);
      ed.setDecorations(deco, lines.filter((l) => l <= ed.document.lineCount).map((l) => new vscode.Range(l - 1, 0, l - 1, 0)));
    }
  }
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(render), vscode.workspace.onDidChangeTextDocument((e) => e.document.uri.scheme === SCHEME && render()));

  const active = () => {
    const ed = vscode.window.activeTextEditor;
    const s = ed && sectionOf(ed.document);
    return s ? { ed, s } : null;
  };
  async function toggle() {
    const a = active();
    if (!a) {
      void vscode.window.showInformationMessage('Bookmarks are set in a POU\'s Structured Text (its sections, or the code tab\'s editors)');
      return null;
    }
    const line = a.ed.selection.active.line + 1;
    const r = toggleAt(get(a.s.file), a.s.key, a.ed.document.getText(), line);
    await set(a.s.file, r.bookmarks);
    return { on: r.on, line, ...(r.state ? { state: r.state } : {}) };
  }
  async function step(dir) {
    const a = active();
    if (!a) return null;
    const lines = bookmarkedLines(get(a.s.file), a.s.key, a.ed.document.getText());
    if (!lines.length) return null;
    const cur = a.ed.selection.active.line + 1;
    const next = dir > 0 ? lines.find((l) => l > cur) ?? lines[0] : [...lines].reverse().find((l) => l < cur) ?? lines[lines.length - 1];
    const pos = new vscode.Position(next - 1, 0);
    a.ed.selection = new vscode.Selection(pos, pos);
    a.ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return next;
  }

  // The Bookmarks view (the TwinCAT view): every POU's, each bookmark; a click opens it
  const tree = {
    onDidChangeTreeData: changed.event,
    getChildren(el) {
      if (!el) return known().map((f) => ({ file: f })).filter((x) => get(x.file).states.length || get(x.file).lines.length);
      if (el.file && !el.bm && !el.state) {
        const b = get(el.file);
        return [...b.states.map((s) => ({ file: el.file, state: s })), ...b.lines.map((bm) => ({ file: el.file, bm }))];
      }
      return [];
    },
    getTreeItem(el) {
      if (el.state) {
        const it = new vscode.TreeItem(el.state, vscode.TreeItemCollapsibleState.None);
        it.iconPath = new vscode.ThemeIcon('symbol-enum-member');
        it.description = 'state';
        it.command = { command: 'kvalMachineScope.openBookmark', title: 'Open', arguments: [el] };
        it.contextValue = 'kssBookmark';
        return it;
      }
      if (el.bm) {
        const decl = el.bm.method.endsWith('#declaration');
        const m = el.bm.method.replace(/#declaration$/, '');
        const it = new vscode.TreeItem(el.bm.text || `line ${el.bm.line}`, vscode.TreeItemCollapsibleState.None);
        it.iconPath = new vscode.ThemeIcon('bookmark');
        it.description = `${m === BODY ? 'POU' : m}${decl ? ' (declaration)' : ''} · line ${el.bm.line}`;
        it.command = { command: 'kvalMachineScope.openBookmark', title: 'Open', arguments: [el] };
        it.contextValue = 'kssBookmark';
        return it;
      }
      const it = new vscode.TreeItem(path.basename(el.file), vscode.TreeItemCollapsibleState.Expanded);
      it.iconPath = new vscode.ThemeIcon('symbol-class');
      it.tooltip = el.file;
      return it;
    },
  };
  const view = vscode.window.createTreeView('kvalMachineScope.bookmarks', { treeDataProvider: tree });
  context.subscriptions.push(view);

  /** A bookmark opened: its member at its line (a state: its CASE label in the state method) */
  async function openBookmark(el) {
    let members = [];
    try {
      members = parseSource(readText(el.file)).members;
    } catch {
      return false;
    }
    let memberKey = '';
    let section = 'impl';
    let line = 1;
    if (el.bm) {
      const decl = el.bm.method.endsWith('#declaration');
      const m = el.bm.method.replace(/#declaration$/, '');
      const mb = m === BODY ? members.find((x) => x.key === '') : members.find((x) => x.key.replace(/^(Method|Property|Action|Transition):/, '').toLowerCase() === m.toLowerCase());
      if (!mb) return false;
      memberKey = mb.key;
      section = decl ? 'decl' : 'impl';
      const text = (decl ? mb.decl?.text : mb.impl?.text) ?? '';
      line = bookmarkedLines({ states: [], lines: [el.bm] }, el.bm.method, text)[0] ?? el.bm.line;
    } else if (el.state) {
      // (the member whose implementation has the state's label)
      for (const mb of members) {
        const text = mb.impl?.text ?? '';
        const i = text.split(/\r?\n/).findIndex((l) => labelNamesOf(l).includes(el.state));
        if (i >= 0) {
          memberKey = mb.key;
          line = i + 1;
          break;
        }
      }
    }
    await openMember(el.file, memberKey, { focus: { section, line: line - 1, column: 0 } });
    return true;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.toggleBookmark', toggle),
    vscode.commands.registerCommand('kvalMachineScope.nextBookmark', () => step(1)),
    vscode.commands.registerCommand('kvalMachineScope.previousBookmark', () => step(-1)),
    vscode.commands.registerCommand('kvalMachineScope.clearBookmarks', async (el) => {
      const a = active();
      const file = el?.file ?? a?.s.file;
      if (file) await set(file, { states: [], lines: [] });
    }),
    vscode.commands.registerCommand('kvalMachineScope.removeBookmark', async (el) => {
      if (!el?.file) return;
      const b = get(el.file);
      await set(el.file, el.state ? { ...b, states: b.states.filter((s) => s !== el.state) } : { ...b, lines: b.lines.filter((x) => !(x.method === el.bm.method && x.line === el.bm.line && x.text === el.bm.text)) });
    }),
    vscode.commands.registerCommand('kvalMachineScope.openBookmark', openBookmark),
    // (for the tests: a section's bookmarked lines, a POU's bookmarks)
    vscode.commands.registerCommand('kvalMachineScope.bookmarksShown', (uri) => linesShown.get(String(uri)) ?? null),
    vscode.commands.registerCommand('kvalMachineScope.bookmarksOf', (file) => get(file))
  );
  render();
  return { get, set, render };
}

module.exports = { registerBookmarks, bookmarkedLines, toggleAt, keyOfSection, labelNamesOf, BODY };

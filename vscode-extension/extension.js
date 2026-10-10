// Kval MachineScope for VS Code: a .TcPOU opened as its statechart (Open With… → Kval MachineScope Statechart, or the
// Explorer's / editor's Open in Kval MachineScope). The app (the web edition's build, in ./app) runs in a webview with
// full file access through host.cjs: its .TcDUT found beside it, saved back, Go to code at the line in the .TcPOU.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createHost, webviewHtml } = require('./host.cjs');
const stEditor = require('./stEditor.cjs');
const twincat = require('./twincat.cjs');
const { registerCreate } = require('./createCommands.cjs');
const { parseSource } = require('./tcStSource.cjs');
const { addressOf, normalPath } = require('./sectionStore.cjs');

const VIEW_TYPE = 'kvalMachineScope.statechart';

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const appDir = vscode.Uri.joinPath(context.extensionUri, 'app');
  // (TwinCAT files as Structured Text: also where the statechart's Go to code goes)
  const st = stEditor.register(context);
  // (the TwinCAT view: the statechart's live view goes to its target, its Build… is its build)
  let tc = null;
  // Follow selection: the caret in a POU's state method (its implementation section) selects that state in the POU's
  // open statecharts; the message XAE sends (editorCaret: its line counted after the declaration's, as XAE's editor)
  const charts = new Map();
  let caretTimer = null;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const u = e.textEditor.document.uri;
      if (u.scheme !== 'twincat-st') return;
      clearTimeout(caretTimer);
      caretTimer = setTimeout(() => {
        let a;
        try {
          a = addressOf(u.query);
        } catch {
          return;
        }
        // (a method, or the POU's body: a state machine in the body is named by the POU)
        if (a.section !== 'impl' || !(/^Method:/.test(a.key) || a.key === '')) return;
        const posts = charts.get(normalPath(a.file).toLowerCase());
        if (!posts?.size) return;
        let declLines = 0;
        try {
          declLines = (parseSource(fs.readFileSync(a.file, 'utf8')).members.find((m) => m.key === a.key)?.decl?.text ?? '').split(/\r?\n/).length;
        } catch {
          return;
        }
        const line = declLines + e.selections[0].active.line + 1;
        for (const post of posts) post({ type: 'editorCaret', method: a.key ? a.key.replace(/^Method:/, '') : path.basename(a.file).replace(/\.TcPOU$/i, ''), line, lineCount: declLines + e.textEditor.document.lineCount });
      }, 150);
    })
  );
  const version = context.extension.packageJSON.version;

  /** The app in a webview, its host for that .TcPOU */
  const resolve = (pouPath, webviewPanel) => {
    const webview = webviewPanel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [appDir] };
    const post = (m) => void webview.postMessage(m);
    const ui = {
      version,
      async pick(kind, name) {
        const near = vscode.Uri.file(path.dirname(host.pou));
        if (kind === 'save') {
          const u = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(near, name || 'document.txt') });
          return u ? [u.fsPath] : null;
        }
        const u = await vscode.window.showOpenDialog({
          defaultUri: near,
          canSelectFiles: kind !== 'folder',
          canSelectFolders: kind === 'folder',
          canSelectMany: kind === 'duts',
          filters: kind === 'pou' ? { 'TwinCAT POU': ['TcPOU'] } : kind === 'duts' ? { 'TwinCAT DUT': ['TcDUT'] } : undefined,
          openLabel: kind === 'folder' ? 'Search this folder' : 'Open',
        });
        return u ? u.map((x) => x.fsPath) : null;
      },
      async reveal(file, line, column) {
        // (a TwinCAT file: the section that place is in, as Structured Text; else, or outside the sections, the file)
        if (/\.(tcpou|tcdut|tcgvl|tcio)$/i.test(file) && (await st.revealInSource(file, line, column).catch(() => false))) return;
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const pos = new vscode.Position(line, column);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside, preview: false });
      },
      open(file) {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
      },
      // (live view: the target picked for the project in the TwinCAT view; Build…: its build)
      target: (file) => tc?.targetFor(file) ?? null,
      build: (file) => (tc ? tc.buildFor(file) : Promise.resolve({ ok: false, fatal: 'Not ready yet' })),
    };
    const host = createHost({ pouPath, post, ui });
    // (the caret in this POU's sections: followed by the chart)
    const key = normalPath(pouPath).toLowerCase();
    const posts = charts.get(key) ?? new Set();
    posts.add(post);
    charts.set(key, posts);
    webviewPanel.onDidDispose(() => posts.delete(post));
    webviewPanel.title = `${path.basename(pouPath)} · statechart`;
    const index = fs.readFileSync(path.join(appDir.fsPath, 'index.html'), 'utf8');
    webview.html = webviewHtml(index, { base: webview.asWebviewUri(appDir).toString(), cspSource: webview.cspSource, nonce: crypto.randomBytes(16).toString('base64') });
    const subs = [webview.onDidReceiveMessage((m) => host.handle(m))];
    // (a loaded file changed on disk: TwinCAT, git, another editor)
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(pouPath)), '**/*.{TcPOU,TcDUT,tcpou,tcdut}'));
    const timers = new Map();
    const changed = (u) => {
      clearTimeout(timers.get(u.fsPath));
      timers.set(u.fsPath, setTimeout(() => host.changed(u.fsPath), 600));
    };
    subs.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed));
    webviewPanel.onDidDispose(() => {
      host.dispose?.();
      for (const t of timers.values()) clearTimeout(t);
      for (const s of subs) s.dispose();
    });
  };

  // Open With… → Kval MachineScope Statechart: the .TcPOU as its statechart (the file itself is read and written by the
  // app's host, not as a VS Code document)
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      {
        openCustomDocument: (uri) => ({ uri, dispose() {} }),
        resolveCustomEditor: (doc, panel) => resolve(doc.uri.fsPath, panel),
      },
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
    )
  );
  // Open in Kval MachineScope (the Explorer's, an editor's menu, the Command Palette): the active / chosen .TcPOU
  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.open', async (uri) => {
      // (a section of a TwinCAT file, "twincat-st:": its file)
      const given = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      const file = stEditor.fileOf(given);
      const target = file ? vscode.Uri.file(file) : given;
      if (!target || !/\.tcpou$/i.test(target.fsPath)) {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'TwinCAT POU': ['TcPOU'] } });
        if (!picked?.length) return;
        return vscode.commands.executeCommand('vscode.openWith', picked[0], VIEW_TYPE);
      }
      return vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    })
  );

  // TwinCAT files as Structured Text (declaration above, implementation below), and XAE's toolbar: Build, Login,
  // Start, Stop, Logout, the target and the Remote Manager build
  tc = twincat.register(context, { activeFile: st.activeFile, sectionUriOf: st.sectionUriOf });
  registerCreate(context, { activeFile: st.activeFile, projectOf: twincat.projectOf, currentProject: () => tc.currentProject(), openMember: st.openMember, refreshSolution: () => vscode.commands.executeCommand('kvalMachineScope.refreshSolution') });
}

function deactivate() {}

module.exports = { activate, deactivate };

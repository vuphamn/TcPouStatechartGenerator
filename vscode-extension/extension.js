// Kval MachineScope for VS Code: a .TcPOU opened as its statechart (Open With… → Kval MachineScope Statechart, or the
// Explorer's / editor's Open in Kval MachineScope). The app (the web edition's build, in ./app) runs in a webview with
// full file access through host.cjs: its .TcDUT found beside it, saved back, Go to code at the line in the .TcPOU.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createHost, webviewHtml } = require('./host.cjs');

const VIEW_TYPE = 'kvalMachineScope.statechart';

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const appDir = vscode.Uri.joinPath(context.extensionUri, 'app');
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
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const pos = new vscode.Position(line, column);
        await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside, preview: false });
      },
      open(file) {
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
      },
    };
    const host = createHost({ pouPath, post, ui });
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
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (!target || !/\.tcpou$/i.test(target.fsPath)) {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'TwinCAT POU': ['TcPOU'] } });
        if (!picked?.length) return;
        return vscode.commands.executeCommand('vscode.openWith', picked[0], VIEW_TYPE);
      }
      return vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };

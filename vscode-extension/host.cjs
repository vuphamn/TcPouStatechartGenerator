// Kval MachineScope in VS Code: the app's host, as the TwinCAT XAE extension is (the same messages: src/utils/xaeHost.ts),
// without VS Code's API in it (extension.js gives it the user interface: dialogs, opening a file at a line), so it can
// be tested by itself. The app runs in a webview: chrome.webview, which the app talks to, made of VS Code's own
// webview API (SHIM, before the app's script).
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', '_boot', '_compileinfo', '_libraries', '_deployment', 'bin', 'obj']);
const MAX_DEPTH = 8;
const MAX_DUTS = 500;

/** A text file's content, without its BOM */
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
/** A file's content compared as the XAE extension does: BOM, line ends and trailing white space aside */
const contentKey = (text) => (text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\s+$/, '');

/** The .TcDUT files in a folder and its subfolders (its own first; dot folders, build output skipped) */
function findDutFiles(folder) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_DUTS) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const e of entries) {
      if (out.length >= MAX_DUTS) return;
      if (e.isFile() && /\.tcdut$/i.test(e.name)) {
        const p = path.join(dir, e.name);
        try {
          out.push({ name: e.name, relativePath: path.relative(folder, p).replace(/\\/g, '/'), path: p, content: readText(p) });
        } catch {
          // (unreadable)
        }
      }
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) walk(path.join(dir, e.name), depth + 1);
  };
  walk(folder, 0);
  return out;
}

/**
 * Where a method's line is in the .TcPOU (0-based line and column in the file): its implementation's <![CDATA[ and
 * the line in it; text: that line's code, preferred where it is near (the file may have changed a little)
 */
function locateInPou(xml, method, line, text) {
  const lines = xml.split(/\r?\n/);
  const methodAt = method ? lines.findIndex((l) => new RegExp(`<Method\\b[^>]*\\bName="${method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i').test(l)) : -1;
  // (the POU's own body: its first <ST> outside any method)
  const from = methodAt >= 0 ? methodAt : 0;
  let st = -1;
  for (let i = from; i < lines.length; i++) {
    if (methodAt < 0 && /<Method\b/i.test(lines[i])) {
      // (a method before the POU's body: skip to its end)
      while (i < lines.length && !/<\/Method>/i.test(lines[i])) i++;
      continue;
    }
    if (/<ST>\s*<!\[CDATA\[/i.test(lines[i])) {
      st = i;
      break;
    }
  }
  if (st < 0) return null;
  const cdataCol = lines[st].search(/<!\[CDATA\[/i) + '<![CDATA['.length;
  let target = st + Math.max(0, (line || 1) - 1);
  const wanted = (text || '').trim();
  if (wanted) {
    const code = (i) => (i === st ? lines[i].slice(cdataCol) : lines[i]).trim();
    let best = -1;
    for (let d = 0; d <= 60 && best < 0; d++) for (const i of [target - d, target + d]) if (best < 0 && i >= st && i < lines.length && code(i) === wanted) best = i;
    if (best >= 0) target = best;
  }
  const col = target === st ? cdataCol : (lines[target] ?? '').search(/\S|$/);
  return { line: target, column: Math.max(0, col) };
}

/**
 * The host of one .TcPOU's panel. ui: { pick(kind: 'pou' | 'folder' | 'duts' | 'save', name?): Promise<string[] | null>,
 * reveal(file, line, column), open(file), version, info(msg) }. post: a message to the app.
 */
function createHost({ pouPath, post, ui }) {
  let pou = pouPath;
  /** Each loaded file's content as loaded / saved here: what a save is checked against, and what a change is */
  const lastSeen = new Map();
  const load = (p) => {
    pou = p;
    const content = readText(p);
    const duts = findDutFiles(path.dirname(p));
    lastSeen.clear();
    lastSeen.set(p, contentKey(content));
    for (const d of duts) lastSeen.set(d.path, contentKey(d.content));
    post({ type: 'loadPou', source: { name: path.basename(p), path: p, content, dutCandidates: duts } });
  };
  const layoutFile = (p) => `${p.replace(/\.tcpou$/i, '')}.machinescope.json`;
  const handlers = {
    ready: () => load(pou),
    save: ({ files = [] }) => {
      const known = files.filter((f) => lastSeen.has(f.path));
      // (all checked before any is written: changed on disk since it was loaded, unless kept anyway)
      for (const f of known) {
        if (!fs.existsSync(f.path)) return post({ type: 'saveResult', ok: false, message: `${path.basename(f.path)} no longer exists` });
        if (!f.force && contentKey(readText(f.path)) !== lastSeen.get(f.path))
          return post({ type: 'saveResult', ok: false, message: `${path.basename(f.path)} was changed on disk since it was loaded (saved in TwinCAT or another editor?). Reload it first, or keep your edits to overwrite it.` });
      }
      const saved = [];
      for (const f of known) {
        // (its BOM kept: TwinCAT writes one)
        const bom = fs.readFileSync(f.path).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
        fs.writeFileSync(f.path, (bom ? '﻿' : '') + f.content);
        lastSeen.set(f.path, contentKey(f.content));
        saved.push({ path: f.path, content: readText(f.path) });
      }
      post({ type: 'saveResult', ok: true, files: saved, message: saved.length ? `Saved ${saved.map((f) => path.basename(f.path)).join(' and ')}` : 'Nothing to save' });
    },
    navigate: ({ path: p, method, line, text }) => {
      const file = p || pou;
      const at = locateInPou(readText(file), method, line, text);
      if (!at) return post({ type: 'error', message: `${method ? `${method}()` : 'The code'} was not found in ${path.basename(file)}` });
      ui.reveal(file, at.line, at.column);
    },
    layoutRead: ({ path: p, requestId }) => {
      const f = layoutFile(p || pou);
      post({ type: 'layoutResult', requestId, text: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null });
    },
    layoutWrite: ({ path: p, requestId, text }) => {
      const f = layoutFile(p || pou);
      try {
        if (text === null || text === undefined) fs.rmSync(f, { force: true });
        else fs.writeFileSync(f, text);
        post({ type: 'layoutResult', requestId, written: true });
      } catch (e) {
        post({ type: 'layoutResult', requestId, written: false, error: String(e?.message ?? e) });
      }
    },
    findDut: async () => {
      const dir = (await ui.pick('folder'))?.[0];
      if (!dir) return;
      const duts = findDutFiles(dir);
      for (const d of duts) lastSeen.set(d.path, contentKey(d.content));
      post({ type: 'dutCandidates', candidates: duts, forceFirst: false });
    },
    chooseDutFiles: async () => {
      const files = await ui.pick('duts');
      if (!files?.length) return;
      const duts = files.map((p) => ({ name: path.basename(p), relativePath: path.basename(p), path: p, content: readText(p) }));
      for (const d of duts) lastSeen.set(d.path, contentKey(d.content));
      post({ type: 'dutCandidates', candidates: duts, forceFirst: true });
    },
    browsePou: async () => {
      const p = (await ui.pick('pou'))?.[0];
      if (p) load(p);
    },
    openPou: ({ path: p }) => {
      if (p && fs.existsSync(p)) load(p);
      else post({ type: 'error', message: 'Open the other state machine from the Explorer (Open in Kval MachineScope)' });
    },
    openInXae: ({ typeName }) => {
      const dir = path.dirname(pou);
      const found = typeName && findFile(path.dirname(dir), new RegExp(`^${typeName}\\.(TcPOU|TcDUT|TcGVL|TcIO)$`, 'i'));
      if (found) ui.open(found);
      else post({ type: 'error', message: `${typeName ?? 'It'} was not found near ${path.basename(pou)}` });
    },
    saveDocument: async ({ name, content }) => {
      const p = (await ui.pick('save', name))?.[0];
      if (!p) return post({ type: 'saveDocumentResult', canceled: true });
      fs.writeFileSync(p, content);
      post({ type: 'saveDocumentResult', path: p });
    },
    hostInfo: () => post({ type: 'hostInfo', edition: 'vscode', version: ui.version }),
    // (not in VS Code: live view, the PLC, the project's other files)
    liveStart: () => post({ type: 'liveStatus', state: 'error', message: 'Live view is not available in VS Code: use the desktop app, the web edition (Link or a gateway) or TwinCAT XAE' }),
    liveStop: () => post({ type: 'liveStatus', state: 'stopped', message: 'Not connected' }),
    gitShow: ({ requestId }) => post({ type: 'gitShowResult', requestId, error: 'Not available in VS Code (use its Source Control view)' }),
    projectPous: () => post({ type: 'projectPous', error: 'Not available in VS Code' }),
    projectSymbols: () => post({ type: 'projectSymbols', error: 'Not available in VS Code' }),
    projectUses: ({ requestId }) => post({ type: 'projectUses', requestId, error: 'Not available in VS Code: rename it in TwinCAT XAE' }),
    saveOther: ({ requestId }) => post({ type: 'saveOtherResult', requestId, ok: false, message: 'Not available in VS Code' }),
    buildProject: ({ requestId }) => post({ type: 'xaeBuildResult', requestId, ok: false, fatal: 'Building the PLC project is not available in VS Code: build it in TwinCAT XAE' }),
    liveBrowse: ({ requestId, path: p }) => post({ type: 'liveBrowseResult', requestId, path: p, error: 'Not available in VS Code' }),
    discoverPlcs: ({ requestId }) => post({ type: 'plcList', requestId, devices: [], errors: ['Finding PLCs is not available in VS Code'] }),
    probePlcs: ({ requestId }) => post({ type: 'probeResult', requestId, reachable: [] }),
    addRoute: ({ requestId }) => post({ type: 'addRouteResult', requestId, ok: false, message: 'Not available in VS Code' }),
    openInstance: () => post({ type: 'error', message: 'Live view is not available in VS Code' }),
  };
  return {
    /** A message from the app */
    async handle(m) {
      const h = m && handlers[m.type];
      if (!h) return;
      try {
        await h(m);
      } catch (e) {
        post({ type: 'error', message: String(e?.message ?? e) });
      }
    },
    /** A file changed on disk (VS Code's watcher): the app told when it is one it loaded and not its own save */
    changed(p) {
      if (!lastSeen.has(p) || !fs.existsSync(p)) return;
      const content = readText(p);
      if (contentKey(content) === lastSeen.get(p)) return;
      lastSeen.set(p, contentKey(content));
      post({ type: 'sourceChanged', path: p, name: path.basename(p), content });
    },
    get pou() {
      return pou;
    },
  };
}

/** A file by name under a folder (the PLC project's), else null */
function findFile(root, rx, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) if (e.isFile() && rx.test(e.name)) return path.join(root, e.name);
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) {
    const f = findFile(path.join(root, e.name), rx, depth + 1);
    if (f) return f;
  }
  return null;
}

/** chrome.webview (WebView2's, which the app talks to: src/utils/xaeHost.ts) made of VS Code's webview API */
const SHIM = `(function () {
  var api = acquireVsCodeApi();
  window.__kssHost = 'vscode';
  var listeners = [];
  window.addEventListener('message', function (e) { for (var i = 0; i < listeners.length; i++) listeners[i](e); });
  window.chrome = window.chrome || {};
  window.chrome.webview = {
    postMessage: function (m) { api.postMessage(m); },
    addEventListener: function (t, l) { if (t === 'message') listeners.push(l); },
    removeEventListener: function (t, l) { var i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }
  };
})();`;

/**
 * The app's page for a webview: its files under base (the app's folder as the webview sees it), a content policy
 * allowing them (and the styles the charts make), the shim before the app's script
 */
function webviewHtml(indexHtml, { base, cspSource, nonce }) {
  const csp = [
    "default-src 'none'",
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `connect-src ${cspSource}`,
    `worker-src ${cspSource} blob:`,
  ].join('; ');
  const head = `<base href="${base.replace(/\/?$/, '/')}">\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<script nonce="${nonce}">${SHIM}</script>`;
  return indexHtml.replace(/<head([^>]*)>/i, (m) => `${m}\n${head}`).replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`);
}

module.exports = { createHost, findDutFiles, locateInPou, webviewHtml, contentKey, SHIM };

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
 * reveal(file, line, column), open(file), version, info(msg), target?(file): the PLC target picked for its project
 * ({ name, netId, address, local }), build?(file): the project built ({ ok, errors, warnings, fatal, items }) }.
 * post: a message to the app. Live view: the desktop app's live session (electron/tcLive.cjs), one per panel.
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
  // (live view: made when first asked for)
  let liveSession = null;
  const live = () => (liveSession ??= require('../electron/tcLive.cjs')());
  // (the PLC project's files: shared with the desktop app)
  const targets = () => require('../electron/tcLiveTargets.cjs');
  /** The target given, else the one picked for the project in VS Code (the TwinCAT view), else this computer's */
  const targetOf = async (m) => {
    if (m.netId) return { netId: m.netId, ip: m.ip };
    const t = ui.target ? await ui.target(m.path || pou) : null;
    return t?.netId ? { netId: t.netId, ip: t.local ? '127.0.0.1' : t.address || undefined } : {};
  };
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
      // (in the PLC project: the folder with its .plcproj)
      const found = typeName && findFile(projectRoot(pou), new RegExp(`^${typeName}\\.(TcPOU|TcDUT|TcGVL|TcIO)$`, 'i'));
      if (found) ui.open(found);
      else post({ type: 'error', message: `${typeName ?? 'It'} was not found near ${path.basename(pou)}` });
    },
    // The POU's project files' TwinCAT version here and in git
    projectVersions: async ({ requestId }) => post({ type: 'projectVersionsResult', requestId, ...(await require('../shared/projectVersions.cjs').projectVersions(pou)) }),
    coverageFile: ({ requestId }) => post({ type: 'coverageFileResult', requestId, ...require('../shared/coverageFile.cjs').readCoverageFile(pou) }),
    coverageFileSave: ({ requestId, pouType, counts }) => post({ type: 'coverageFileSaveResult', requestId, ...require('../shared/coverageFile.cjs').mergeCoverageFile(pou, pouType, counts) }),
    reportSettings: ({ requestId }) => post({ type: 'reportSettingsResult', requestId, ...require('../shared/reportSettings.cjs').readReportSettings(pou) }),
    machineScopeFiles: async ({ requestId }) => post({ type: 'machineScopeFilesResult', requestId, ...(await require('../shared/projectVersions.cjs').machineScopeFiles(pou)) }),
    machineScopeFilesAct: async ({ requestId, action }) => post({ type: 'machineScopeFilesActResult', requestId, ...(await require('../shared/projectVersions.cjs').machineScopeFilesAct(pou, action)) }),
    openXaeFor: async ({ requestId, version }) => post({ type: 'openXaeForResult', requestId, ...(await require('../shared/projectVersions.cjs').openXaeForProject(pou, version)) }),
    projectBuilds: async ({ requestId }) => post({ type: 'projectBuildsResult', requestId, builds: require('../shared/tcCompileInfo.cjs').recordProjectBuilds(pou) }),
    revertProjectFiles: async ({ requestId, paths }) => post({ type: 'revertProjectFilesResult', requestId, ...(await require('../shared/projectVersions.cjs').revertProjectFiles(pou, paths)) }),
    // A base the POU EXTENDS (its doState() and state methods): read only, with its folder's .TcDUT files
    findPou: ({ requestId, typeName }) => {
      const found = /^[A-Za-z_]\w*$/.test(typeName ?? '') && findFile(projectRoot(pou), new RegExp(`^${typeName}\\.TcPOU$`, 'i'));
      if (!found) return post({ type: 'findPouResult', requestId, typeName, error: `${typeName}.TcPOU was not found in the PLC project` });
      const content = readText(found);
      const duts = findDutFiles(path.dirname(found));
      // (it and its enum can be edited and saved here: known, as the POU's own folder's)
      lastSeen.set(found, contentKey(content));
      for (const d of duts) lastSeen.set(d.path, contentKey(d.content));
      post({ type: 'findPouResult', requestId, typeName, source: { name: path.basename(found), path: found, content, dutCandidates: duts } });
    },
    // The enum of a type anywhere in the PLC project (another company's POU: its state variable's enum elsewhere)
    findEnumType: ({ requestId, typeName }) => {
      const found = /^[A-Za-z_]\w*$/.test(typeName ?? '') && findFile(projectRoot(pou), new RegExp(`^${typeName}\\.TcDUT$`, 'i'));
      if (!found) return post({ type: 'findEnumTypeResult', requestId, typeName, error: `${typeName}.TcDUT was not found in the PLC project` });
      const content = readText(found);
      // (it can be edited and saved here: known)
      lastSeen.set(found, contentKey(content));
      post({ type: 'findEnumTypeResult', requestId, typeName, dut: { name: path.basename(found), relativePath: path.relative(path.dirname(pou), found), path: found, content } });
    },
    saveDocument: async ({ name, content }) => {
      const p = (await ui.pick('save', name))?.[0];
      if (!p) return post({ type: 'saveDocumentResult', canceled: true });
      fs.writeFileSync(p, content);
      post({ type: 'saveDocumentResult', path: p });
    },
    hostInfo: () => post({ type: 'hostInfo', edition: 'vscode', version: ui.version }),
    // Live view: the desktop app's live session (its instance paths from the PLC project's files beside the POU)
    liveStart: async (m) => live().start(post, { ...m, path: m.path || pou, ...(await targetOf(m)) }),
    liveStop: async () => {
      if (liveSession) await liveSession.stop(true, post);
      else post({ type: 'liveStatus', state: 'stopped', message: 'Not connected' });
    },
    liveWatch: ({ vars }) => live().watch(vars),
    // The committed (git HEAD) version of a loaded file, from its folder's repository (as the XAE extension does)
    gitShow: ({ path: p, requestId }) => {
      if (!p || !lastSeen.has(p)) return post({ type: 'gitShowResult', requestId, error: 'Not a file loaded in MachineScope' });
      require('child_process').execFile('git', ['-C', path.dirname(p), 'show', `HEAD:./${path.basename(p)}`], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
        if (!err) return post({ type: 'gitShowResult', requestId, content: stdout.replace(/^\uFEFF/, '') });
        const text = String(stderr || err.message || '');
        // (as the XAE extension says it: no git, no repository, a file not committed yet)
        const error =
          err.code === 'ENOENT' ? 'git is not installed (or not on the PATH)'
          : /not a git repository/i.test(text) ? 'The file is not in a git repository'
          : /exists on disk, but not in|does not exist in/i.test(text) ? 'The file is not committed yet'
          : text.trim().split(/\r?\n/)[0] || 'git did not answer';
        post({ type: 'gitShowResult', requestId, error });
      });
    },
    // The project's files: its POUs with a CASE (the documentation), its types (completion, the checks), a name's uses (a rename)
    projectPous: () => post({ type: 'projectPous', ...targets().projectPous(pou) }),
    projectSymbols: () => post({ type: 'projectSymbols', ...targets().projectSymbols(pou) }),
    projectUses: ({ requestId, name }) => post({ type: 'projectUses', requestId, ...targets().projectUses(pou, name) }),
    // Other POUs of the project written (a rename): each in the PLC project, unchanged on disk since it was read
    saveOther: ({ requestId, files = [] }) => {
      const plcproj = targets().plcProjectFile(pou);
      const root = plcproj ? path.resolve(path.dirname(plcproj)).toLowerCase() + path.sep : null;
      const inProject = (p) => !!root && typeof p === 'string' && /\.tcpou$/i.test(p) && path.resolve(p).toLowerCase().startsWith(root) && fs.existsSync(p);
      const list = files.filter((f) => inProject(f.path) && typeof f.content === 'string' && typeof f.baseline === 'string');
      if (!list.length) return post({ type: 'saveOtherResult', requestId, ok: false, message: 'No file of the PLC project to write' });
      for (const f of list)
        if (contentKey(readText(f.path)) !== contentKey(f.baseline))
          return post({ type: 'saveOtherResult', requestId, ok: false, message: `${path.basename(f.path)} was changed on disk since it was read: nothing written` });
      for (const f of list) {
        const bom = fs.readFileSync(f.path).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
        fs.writeFileSync(f.path, (bom ? '\uFEFF' : '') + f.content);
        if (lastSeen.has(f.path)) lastSeen.set(f.path, contentKey(f.content));
      }
      post({ type: 'saveOtherResult', requestId, ok: true, message: `Wrote ${list.length} other POU(s): ${list.map((f) => path.basename(f.path)).join(', ')}` });
    },
    // Build…: the TwinCAT view's build (TwinCAT XAE's Automation Interface, a copy of the project)
    buildProject: async ({ requestId }) => {
      if (!ui.build) return post({ type: 'xaeBuildResult', requestId, ok: false, fatal: 'Building the PLC project is not available here' });
      const r = await ui.build(pou);
      post({ type: 'xaeBuildResult', requestId, ok: !!r.ok, errors: r.errors ?? 0, warnings: r.warnings ?? 0, ...(r.fatal ? { fatal: r.fatal } : {}), items: r.items ?? [] });
    },
    liveBrowse: (req) => live().browse(post, req),
    // Browse (the Live tab): this computer's routes and the TwinCAT devices answering on the network
    discoverPlcs: async ({ requestId }) => {
      const { localRoutes, discover } = require('../shared/tcDiscovery.cjs');
      const routes = localRoutes().map((r) => ({ netId: r.netId, ip: r.address, name: r.name, route: true, source: 'route' }));
      const errors = [];
      const found = await discover({}).catch((err) => {
        errors.push(String(err?.message ?? err));
        return [];
      });
      const seen = new Set(routes.map((r) => r.netId));
      const devices = [...routes, ...found.filter((d) => d?.netId && !seen.has(d.netId)).map((d) => ({ netId: d.netId, ip: d.ip ?? d.address ?? '', name: d.name ?? d.hostname ?? d.netId, twincat: d.twincat, os: d.os, route: false, source: 'network' }))];
      const t = ui.target ? await ui.target(pou) : null;
      post({ type: 'plcList', requestId, devices, errors, projectTarget: t?.netId ?? null });
    },
    probePlcs: ({ requestId }) => post({ type: 'probeResult', requestId, reachable: [] }),
    addRoute: ({ requestId }) => post({ type: 'addRouteResult', requestId, ok: false, message: 'Not available in VS Code' }),
    openInstance: () => post({ type: 'error', message: 'Live view is not available in VS Code' }),
  };
  return {
    /** The panel closed: its live session ends */
    dispose() {
      if (liveSession) void liveSession.stop(false);
    },
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

/** The PLC project's folder: the nearest one above the POU with a .plcproj (else the POU folder's parent) */
function projectRoot(pouFile) {
  for (let dir = path.dirname(pouFile), k = 0; k < 10; k++) {
    try {
      if (fs.readdirSync(dir).some((n) => /\.plcproj$/i.test(n))) return dir;
    } catch {
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.dirname(path.dirname(pouFile));
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

// Live values in the Structured Text sections while logged in, as XAE shows them: each variable's value after it, in
// the visible part of each section of the online project (a POU: under its instance on the PLC, found in its symbol
// table, one chosen when there are several; a GVL: its own variables). Read over ADS twice a second: numbers,
// booleans, strings, enums by their names; a function block, struct or array itself is not shown (its members are,
// fbAxis.bDone). The source of values: the PLC's (tcAds), or a stand-in (KSS_LIVE_STANDIN: a JSON file, the tests).
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const ads = require('../shared/tcAds.cjs');
const { parseSource } = require('./tcStSource.cjs');
const { addressOf, SCHEME } = require('./sectionStore.cjs');
const { watchNames, valueText, parseValue, ADST } = require('./liveText.cjs');
const { blankCode } = require('./stReferences.cjs');
const { implementationOutline } = require('./stOutline.cjs');

const MAX_NAMES = 150;

/** The PLC's values over ADS: { instances(type), probe(path), read(path, info), enumNames(type), dispose() } */
function adsSource(client) {
  const handles = new Map();
  const types = new Map();
  return {
    instances: (type) => ads.discoverInstances(client, type),
    async probe(p) {
      const info = await ads.probe(client, p);
      return info && ads.isSimpleValue(info) ? info : info ? { ...info, simple: false } : null;
    },
    async read(p, info) {
      let h = handles.get(p);
      if (h === undefined) {
        h = await ads.createHandle(client, p);
        handles.set(p, h);
      }
      return ads.readTyped(client, h, info);
    },
    async write(p, info, value) {
      let h = handles.get(p);
      if (h === undefined) {
        h = await ads.createHandle(client, p);
        handles.set(p, h);
      }
      await ads.writeTyped(client, h, info, value);
    },
    async enumNames(type) {
      if (!type) return null;
      const dt = await ads.dataTypeInfo(client, type, types);
      return dt?.enumValues ?? null;
    },
    async dispose() {
      for (const h of handles.values()) await ads.releaseHandle(client, h).catch(() => {});
      handles.clear();
    },
  };
}

/** A stand-in for the tests: { instances: { FB_X: ['MAIN.fbX'] }, symbols: { 'MAIN.fbX.State': { type, value, enum? } } } */
function standInSource(file) {
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const sym = (p) => Object.entries(read().symbols ?? {}).find(([k]) => k.toLowerCase() === p.toLowerCase())?.[1] ?? null;
  return {
    instances: async (type) => read().instances?.[type] ?? [],
    probe: async (p) => {
      const s = sym(p);
      return s ? { type: s.type, size: s.size ?? (typeof s.value === 'string' ? 81 : 4), dataType: s.dataType ?? (typeof s.value === 'boolean' ? ADST.BIT : typeof s.value === 'string' ? ADST.STRING : Number.isInteger(s.value) ? ADST.INT32 : ADST.REAL64), ...(s.struct ? { simple: false } : {}) } : null;
    },
    read: async (p) => sym(p)?.value ?? null,
    write: async (p, info, value) => {
      const all = read();
      const k = Object.keys(all.symbols ?? {}).find((x) => x.toLowerCase() === p.toLowerCase());
      if (!k) throw new Error(`${p}: no such symbol`);
      all.symbols[k].value = value;
      fs.writeFileSync(file, JSON.stringify(all, null, 1));
    },
    enumNames: async (type) => Object.values(read().symbols ?? {}).find((s) => s.type === type && s.enum)?.enum ?? null,
    dispose: async () => {},
  };
}

/**
 * online: { isOnline(root), source(root) → a source, dropped(root) }; projectOf(file). → { refresh, shown(uri) }
 */
function registerLiveValues(context, { online, projectOf, currentRoot = () => null }) {
  const deco = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2px', color: new vscode.ThemeColor('editorInlayHint.foreground'), backgroundColor: new vscode.ThemeColor('editorInlayHint.background'), fontStyle: 'normal' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  // (the CASE branch of the state the PLC is in: the line, a bar before it, the overview ruler)
  const activeDeco = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('charts.green'),
    overviewRulerColor: new vscode.ThemeColor('charts.green'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  // (the line marked per section: for the tests)
  const activeNow = new Map();
  const bar = vscode.window.createStatusBarItem('kvalMachineScope.instance', vscode.StatusBarAlignment.Left, 47);
  bar.name = 'TwinCAT instance (live values)';
  bar.command = 'kvalMachineScope.pickInstance';
  context.subscriptions.push(deco, activeDeco, bar);
  const clearActive = (ed) => {
    ed.setDecorations(activeDeco, []);
    activeNow.delete(ed.document.uri.toString());
  };
  /** The state the PLC is in: its branch of the section's (first) CASE marked */
  async function markActive(ed, a, text, inst, root, src) {
    if (a.section !== 'impl' || !vscode.workspace.getConfiguration('kvalMachineScope.liveValues').get('activeState', true)) return clearActive(ed);
    const m = /\bCASE\s*\(?\s*([A-Za-z_]\w*)\s*\)?\s*OF\b/i.exec(blankCode(text));
    if (!m) return clearActive(ed);
    const full = `${inst.path}.${m[1]}`;
    const k = `${root}|${full}`.toLowerCase();
    if (!known.has(k)) known.set(k, await src.probe(full).catch(() => null));
    const sym = known.get(k);
    if (!sym || sym.simple === false) return clearActive(ed);
    let value;
    try {
      value = await src.read(full, sym);
    } catch {
      return clearActive(ed);
    }
    const ek = `${root}|${sym.type}`.toLowerCase();
    if (!enums.has(ek)) enums.set(ek, await src.enumNames(sym.type).catch(() => null));
    const t = valueText(value, { enumNames: enums.get(ek) });
    const want = String(t).split('.').pop().trim().toLowerCase();
    const branch = implementationOutline(text).find((b) => b.name.split(',').some((n) => n.trim().toLowerCase() === want));
    if (!branch) return clearActive(ed);
    const line = ed.document.positionAt(branch.start).line;
    ed.setDecorations(activeDeco, [{ range: new vscode.Range(line, 0, line, 0), hoverMessage: `The PLC is in this state: ${full} = ${t}` }]);
    activeNow.set(ed.document.uri.toString(), { line, state: branch.name });
  }

  // (what each symbol is, per instance: its info, or null when the PLC has none; enum names per type)
  const known = new Map();
  const enums = new Map();
  const instancesOf = new Map();
  const files = new Map();
  // (what is shown now, per section: for the tests and the hover)
  const shownNow = new Map();
  // (each section's names shown, with their symbol: the one at the caret for Prepare Value)
  const metaNow = new Map();
  // Values prepared to write (Prepare Value…), by symbol: { full, root, info, value, text }
  const prepared = new Map();
  const fileInfo = (file) => {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return null;
    }
    const hit = files.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit;
    try {
      const { kind, name } = parseSource(fs.readFileSync(file, 'utf8'));
      const v = { mtimeMs: st.mtimeMs, kind, name };
      files.set(file, v);
      return v;
    } catch {
      return null;
    }
  };
  const chosenKey = (root, type) => `kvalMachineScope.instance|${root.toLowerCase()}|${type.toLowerCase()}`;
  async function instanceFor(root, type, src) {
    const k = `${root}|${type}`.toLowerCase();
    if (!instancesOf.has(k)) instancesOf.set(k, await src.instances(type));
    const list = instancesOf.get(k);
    const kept = context.workspaceState.get(chosenKey(root, type));
    return { list, path: list.find((x) => x.toLowerCase() === String(kept ?? '').toLowerCase()) ?? list[0] ?? null };
  }

  let busy = false;
  let barFor = null;
  async function tick() {
    if (busy) return;
    busy = true;
    let barShown = false;
    try {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.scheme !== SCHEME) continue;
        let a;
        try {
          a = addressOf(ed.document.uri.query);
        } catch {
          continue;
        }
        const p = projectOf(a.file);
        if (!p || !online.isOnline(p.root)) {
          ed.setDecorations(deco, []);
          clearActive(ed);
          shownNow.delete(ed.document.uri.toString());
          continue;
        }
        const info = fileInfo(a.file);
        if (!info || (info.kind !== 'POU' && info.kind !== 'GVL')) continue;
        let src;
        try {
          src = await online.source(p.root);
        } catch {
          continue;
        }
        const inst = info.kind === 'GVL' ? { path: info.name, list: [info.name] } : await instanceFor(p.root, info.name, src);
        if (ed === vscode.window.activeTextEditor && info.kind === 'POU') {
          barShown = true;
          barFor = { root: p.root, type: info.name, list: inst.list };
          bar.text = inst.path ? `$(symbol-field) ${inst.path}` : `$(symbol-field) no ${info.name} on the PLC`;
          bar.tooltip = inst.path ? `Live values of ${info.name}: this instance${inst.list.length > 1 ? ` (${inst.list.length} on the PLC: click to choose)` : ''}` : `The PLC has no instance of ${info.name}: no live values`;
          bar.show();
        }
        if (!inst.path) {
          ed.setDecorations(deco, []);
          clearActive(ed);
          continue;
        }
        const text = ed.document.getText();
        const vr = ed.visibleRanges[0] ?? new vscode.Range(0, 0, ed.document.lineCount, 0);
        const from = ed.document.offsetAt(new vscode.Position(Math.max(0, vr.start.line - 5), 0));
        const to = ed.document.offsetAt(new vscode.Position(vr.end.line + 5, 0));
        const names = watchNames(text, { from, to }).slice(0, MAX_NAMES);
        const list = [];
        const shown = {};
        const meta = [];
        for (const n of names) {
          const full = `${inst.path}.${n.path}`;
          const k = `${p.root}|${full}`.toLowerCase();
          if (!known.has(k)) known.set(k, await src.probe(full).catch(() => null));
          const sym = known.get(k);
          if (!sym || sym.simple === false) continue;
          let value;
          try {
            value = await src.read(full, sym);
          } catch {
            known.delete(k);
            continue;
          }
          const ek = `${p.root}|${sym.type}`.toLowerCase();
          if (!enums.has(ek)) enums.set(ek, await src.enumNames(sym.type).catch(() => null));
          const t = valueText(value, { enumNames: enums.get(ek) });
          shown[n.path] = t;
          meta.push({ full, root: p.root, sym, enumNames: enums.get(ek), uses: n.uses, text: t });
          // (a value prepared to write: after the current one)
          const prep = prepared.get(full.toLowerCase());
          const label = prep ? ` ${t} ⇒ ${prep.text} ` : ` ${t} `;
          for (const u of n.uses) {
            const at = ed.document.positionAt(u.end);
            list.push({ range: new vscode.Range(at, at), renderOptions: { after: { contentText: label } }, hoverMessage: `${full} (${sym.type || 'value'}) = ${t}${prep ? `; prepared: ${prep.text} (Write Values: Ctrl+F7)` : ''}` });
          }
        }
        ed.setDecorations(deco, list);
        if (info.kind === 'POU') await markActive(ed, a, text, inst, p.root, src);
        shownNow.set(ed.document.uri.toString(), shown);
        metaNow.set(ed.document.uri.toString(), meta);
      }
      await readWatched();
    } catch (err) {
      if (process.env.KSS_LIVE_DEBUG) console.error("live values:", err?.stack ?? err);
      // (the connection lost: tried again next time)
    } finally {
      busy = false;
      if (!barShown) bar.hide();
    }
  }
  // ---- The Watch view: variables by their full path (MAIN.fbTest.nCycles), kept per project; their values while
  // logged in; each one written (asked first) or removed. Their history (10 minutes) for the trend panel
  const watchKey = (root) => `kvalMachineScope.watch|${String(root).toLowerCase()}`;
  const watchedOf = (root) => (root ? context.workspaceState.get(watchKey(root), []) : []);
  const watchValues = new Map();
  const history = new Map();
  const HISTORY_MS = 10 * 60 * 1000;
  const watchChanged = new vscode.EventEmitter();
  async function readWatched() {
    const root = currentRoot();
    const list = watchedOf(root);
    if (!root || !list.length || !online.isOnline(root)) return;
    const src = await online.source(root);
    const now = Date.now();
    for (const full of list.slice(0, 50)) {
      const k = `${root}|${full}`.toLowerCase();
      if (!known.has(k)) known.set(k, await src.probe(full).catch(() => null));
      const sym = known.get(k);
      if (!sym || sym.simple === false) {
        watchValues.set(full, { text: sym ? '(not a value: its members are)' : '(not on the PLC)', sym });
        continue;
      }
      let value;
      try {
        value = await src.read(full, sym);
      } catch {
        known.delete(k);
        continue;
      }
      const ek = `${root}|${sym.type}`.toLowerCase();
      if (!enums.has(ek)) enums.set(ek, await src.enumNames(sym.type).catch(() => null));
      watchValues.set(full, { text: valueText(value, { enumNames: enums.get(ek) }), sym, enumNames: enums.get(ek), root });
      // (a number or a boolean: its history)
      const n = typeof value === 'boolean' ? (value ? 1 : 0) : typeof value === 'number' ? value : null;
      if (n !== null) {
        const h = history.get(full) ?? [];
        h.push([now, n]);
        while (h.length && now - h[0][0] > HISTORY_MS) h.shift();
        history.set(full, h);
      }
    }
    watchChanged.fire(undefined);
    trend?.post();
  }
  const watchView = vscode.window.createTreeView('kvalMachineScope.watch', {
    treeDataProvider: {
      onDidChangeTreeData: watchChanged.event,
      getChildren: () => watchedOf(currentRoot()),
      getTreeItem(full) {
        const v = watchValues.get(full);
        const it = new vscode.TreeItem(full, vscode.TreeItemCollapsibleState.None);
        it.description = v?.text ?? (online.isOnline(currentRoot() ?? '') ? '…' : 'offline');
        it.tooltip = `${full}${v?.sym?.type ? ` (${v.sym.type})` : ''}${v ? ` = ${v.text}` : ''}`;
        it.iconPath = new vscode.ThemeIcon('symbol-field');
        it.contextValue = 'watchItem';
        return it;
      },
    },
  });
  context.subscriptions.push(watchView, watchChanged);
  async function setWatched(root, list) {
    await context.workspaceState.update(watchKey(root), [...new Set(list)]);
    watchChanged.fire(undefined);
  }

  // ---- The trend panel: the watched numbers and booleans over the last minutes
  let trend = null;
  function showTrend() {
    if (trend) return trend.panel.reveal();
    const panel = vscode.window.createWebviewPanel('kvalMachineScope.trend', 'TwinCAT Trend', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    const nonce = Math.random().toString(36).slice(2);
    panel.webview.html = trendHtml(panel.webview.cspSource, nonce);
    trend = {
      panel,
      post: () => void panel.webview.postMessage({ type: 'series', now: Date.now(), series: watchedOf(currentRoot()).filter((f) => history.has(f)).map((f) => ({ name: f, points: history.get(f) })) }),
    };
    panel.onDidDispose(() => (trend = null));
    trend.post();
  }

  const timer = setInterval(() => void tick(), Number(process.env.KSS_LIVE_POLL_MS) || 500);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.pickInstance', async () => {
      if (!barFor?.list?.length) return void vscode.window.showInformationMessage('No instance to choose: log in, with a POU open');
      const picked = await vscode.window.showQuickPick(barFor.list, { placeHolder: `${barFor.type}: the instance whose values are shown` });
      if (!picked) return;
      await context.workspaceState.update(chosenKey(barFor.root, barFor.type), picked);
      void tick();
    }),
    // (what is shown now in a section: { name: value text }; the tests)
    vscode.commands.registerCommand('kvalMachineScope.liveValuesShown', (uri) => shownNow.get(String(uri)) ?? null),
    // (for the tests: the branch marked as the PLC's state, { line, state })
    vscode.commands.registerCommand('kvalMachineScope.activeStateShown', (uri) => activeNow.get(String(uri)) ?? null),
    // Prepare Value… (the variable at the caret): its new value, typed or picked, shown after the current one
    vscode.commands.registerCommand('kvalMachineScope.prepareValue', async (given) => {
      const ed = vscode.window.activeTextEditor;
      const meta = ed ? metaNow.get(ed.document.uri.toString()) : null;
      const offset = ed ? ed.document.offsetAt(ed.selection.active) : -1;
      const m = meta?.find((x) => x.uses.some((u) => u.start <= offset && offset <= u.end));
      if (!m) return void vscode.window.showInformationMessage('Prepare Value: put the caret on a variable whose value is shown (logged in)');
      const current = m.text;
      let text = given?.text;
      if (text === undefined) {
        if (m.enumNames) text = (await vscode.window.showQuickPick(Object.values(m.enumNames), { placeHolder: `${m.full} (now ${current}): its new value` })) ?? undefined;
        else if (m.sym.dataType === ADST.BIT) text = (await vscode.window.showQuickPick(['TRUE', 'FALSE'], { placeHolder: `${m.full} (now ${current}): its new value` })) ?? undefined;
        else text = await vscode.window.showInputBox({ prompt: `${m.full} (${m.sym.type}, now ${current}): its new value`, validateInput: (v) => parseValue(v, m.sym, m.enumNames).error ?? null });
      }
      if (text === undefined) return;
      const r = parseValue(text, m.sym, m.enumNames);
      if (r.error) return void vscode.window.showErrorMessage(`${m.full}: ${r.error}`);
      prepared.set(m.full.toLowerCase(), { full: m.full, root: m.root, info: m.sym, value: r.value, text: valueText(r.value, { enumNames: m.enumNames }) });
      void vscode.commands.executeCommand('setContext', 'kvalMachineScope.prepared', prepared.size > 0);
      void tick();
    }),
    // Write Values (Ctrl+F7): every prepared value, after one question naming them and the PLC
    vscode.commands.registerCommand('kvalMachineScope.writeValues', async (opts) => {
      const list = [...prepared.values()].filter((x) => online.isOnline(x.root));
      if (!list.length) return void vscode.window.showInformationMessage('No values prepared: Prepare Value… on a variable first (logged in)');
      if (!opts?.confirmed) {
        const where = [...new Set(list.map((x) => online.targetName?.(x.root) ?? 'the PLC'))].join(', ');
        const ok = await vscode.window.showWarningMessage(`Write ${list.length} value${list.length > 1 ? 's' : ''} to the PLC on ${where}?`, { modal: true, detail: list.slice(0, 12).map((x) => `${x.full} := ${x.text}`).join('\n') + (list.length > 12 ? `\n… and ${list.length - 12} more` : '') }, 'Write');
        if (ok !== 'Write') return;
      }
      const failed = [];
      for (const x of list) {
        try {
          const src = await online.source(x.root);
          await src.write(x.full, x.info, x.value);
          prepared.delete(x.full.toLowerCase());
        } catch (err) {
          failed.push(`${x.full}: ${err?.message ?? err}`);
        }
      }
      void vscode.commands.executeCommand('setContext', 'kvalMachineScope.prepared', prepared.size > 0);
      void tick();
      if (failed.length) void vscode.window.showErrorMessage(`Not written: ${failed.join('; ')}`);
      else void vscode.window.showInformationMessage(`Wrote ${list.length} value${list.length > 1 ? 's' : ''}`);
      return { written: list.length - failed.length, failed };
    }),
    // Watch: the variable at the caret (its full path), or one typed
    vscode.commands.registerCommand('kvalMachineScope.addWatch', async (given) => {
      const root = currentRoot();
      if (!root) return void vscode.window.showInformationMessage('Open a file of a TwinCAT project first');
      let full = typeof given === 'string' ? given : null;
      if (!full) {
        const ed = vscode.window.activeTextEditor;
        const meta = ed ? metaNow.get(ed.document.uri.toString()) : null;
        const offset = ed ? ed.document.offsetAt(ed.selection.active) : -1;
        full = meta?.find((x) => x.uses.some((u) => u.start <= offset && offset <= u.end))?.full ?? null;
      }
      if (!full) full = await vscode.window.showInputBox({ prompt: 'The variable to watch: its full path on the PLC', placeHolder: 'MAIN.fbCell.nCycles', validateInput: (v) => (/^[A-Za-z_][\w.\[\]]*$/.test(v.trim()) ? null : 'A symbol path: MAIN.fbCell.nCycles') });
      if (!full) return;
      await setWatched(root, [...watchedOf(root), full.trim()]);
      void tick();
      return full.trim();
    }),
    vscode.commands.registerCommand('kvalMachineScope.removeWatch', async (full) => {
      const root = currentRoot();
      if (root && full) await setWatched(root, watchedOf(root).filter((x) => x !== full));
    }),
    vscode.commands.registerCommand('kvalMachineScope.clearWatch', async () => {
      const root = currentRoot();
      if (root) await setWatched(root, []);
    }),
    // A watched variable written: its value picked or typed, asked once more naming it and the PLC
    vscode.commands.registerCommand('kvalMachineScope.writeWatch', async (full, given) => {
      const v = watchValues.get(full);
      if (!v?.sym || v.sym.simple === false || !online.isOnline(v.root ?? '')) return void vscode.window.showInformationMessage('Write: log in first; only a variable with a value is written');
      let text = given?.text;
      if (text === undefined) {
        if (v.enumNames) text = await vscode.window.showQuickPick(Object.values(v.enumNames), { placeHolder: `${full} (now ${v.text})` });
        else if (v.sym.dataType === ADST.BIT) text = await vscode.window.showQuickPick(['TRUE', 'FALSE'], { placeHolder: `${full} (now ${v.text})` });
        else text = await vscode.window.showInputBox({ prompt: `${full} (${v.sym.type}, now ${v.text})`, validateInput: (x) => parseValue(x, v.sym, v.enumNames).error ?? null });
      }
      if (text === undefined) return;
      const r = parseValue(text, v.sym, v.enumNames);
      if (r.error) return void vscode.window.showErrorMessage(`${full}: ${r.error}`);
      if (!given?.confirmed) {
        const ok = await vscode.window.showWarningMessage(`Write ${full} := ${valueText(r.value, { enumNames: v.enumNames })} to the PLC on ${online.targetName?.(v.root) ?? 'the PLC'}?`, { modal: true }, 'Write');
        if (ok !== 'Write') return;
      }
      const src = await online.source(v.root);
      await src.write(full, v.sym, r.value);
      void tick();
      return true;
    }),
    vscode.commands.registerCommand('kvalMachineScope.showTrend', () => showTrend()),
    // (the watch list's values now: { path: text }; the tests)
    vscode.commands.registerCommand('kvalMachineScope.watchShown', () => Object.fromEntries([...watchValues].map(([k, v]) => [k, v.text]))),
    vscode.commands.registerCommand('kvalMachineScope.clearPrepared', () => {
      prepared.clear();
      void vscode.commands.executeCommand('setContext', 'kvalMachineScope.prepared', false);
      void tick();
    })
  );
  return {
    /** Online state or the project changed: what was known is read again */
    refresh(root) {
      for (const m of [known, enums, instancesOf]) for (const k of [...m.keys()]) if (!root || k.startsWith(root.toLowerCase())) m.delete(k);
      if (!online.isOnline(root ?? '')) for (const ed of vscode.window.visibleTextEditors) if (ed.document.uri.scheme === SCHEME) { ed.setDecorations(deco, []); clearActive(ed); }
      void tick();
    },
  };
}

/** The trend panel's page: the series drawn on a canvas, the newest at the right (the last minutes) */
function trendHtml(cspSource, nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { margin: 0; padding: 8px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  #bar { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; font-size: 12px; }
  .key { display: inline-flex; align-items: center; gap: 4px; }
  .swatch { width: 10px; height: 3px; display: inline-block; }
  canvas { width: 100%; height: calc(100vh - 60px); display: block; }
  #empty { opacity: .7; padding: 20px; }
</style></head><body>
<div id="bar"><label>Last <select id="span"><option value="60">1 min</option><option value="300" selected>5 min</option><option value="600">10 min</option></select></label><span id="keys"></span></div>
<div id="empty">Add variables to the Watch view (TwinCAT view) and log in: their numbers and booleans are drawn here.</div>
<canvas id="c"></canvas>
<script nonce="${nonce}">
const colors = ['#4fc1ff', '#f9a03f', '#b5cea8', '#d16d9e', '#dcdcaa', '#c586c0', '#4ec9b0', '#ce9178'];
let last = null;
const canvas = document.getElementById('c');
function draw() {
  if (!last) return;
  const span = Number(document.getElementById('span').value) * 1000;
  const series = last.series.filter((s) => s.points.length);
  document.getElementById('empty').style.display = series.length ? 'none' : 'block';
  document.getElementById('keys').innerHTML = series.map((s, i) => '<span class="key"><span class="swatch" style="background:' + colors[i % colors.length] + '"></span>' + s.name.replace(/[<&]/g, '') + ': ' + s.points[s.points.length - 1][1] + '</span>').join('');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  const from = last.now - span;
  const vals = series.flatMap((s) => s.points.filter((p) => p[0] >= from).map((p) => p[1]));
  if (!vals.length) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = 30;
  const x = (t) => pad + ((t - from) / span) * (w - pad - 8);
  const y = (v) => 8 + (1 - (v - lo) / (hi - lo)) * (h - 28);
  g.strokeStyle = getComputedStyle(document.body).color; g.globalAlpha = 0.25; g.beginPath(); g.moveTo(pad, 8); g.lineTo(pad, h - 20); g.lineTo(w - 8, h - 20); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = getComputedStyle(document.body).color; g.font = '10px sans-serif';
  g.fillText(String(Number(hi.toPrecision(4))), 2, 14); g.fillText(String(Number(lo.toPrecision(4))), 2, h - 22); g.fillText('-' + span / 1000 + ' s', pad, h - 6); g.fillText('now', w - 30, h - 6);
  series.forEach((s, i) => {
    g.strokeStyle = colors[i % colors.length]; g.lineWidth = 1.5; g.beginPath();
    let started = false, prev = null;
    for (const p of s.points) {
      if (p[0] < from) { prev = p; continue; }
      // (steps: a PLC value holds until it changes)
      if (!started) { g.moveTo(x(Math.max(from, (prev ?? p)[0])), y((prev ?? p)[1])); started = true; }
      else if (prev) g.lineTo(x(p[0]), y(prev[1]));
      g.lineTo(x(p[0]), y(p[1]));
      prev = p;
    }
    if (prev) g.lineTo(x(last.now), y(prev[1]));
    g.stroke();
  });
}
window.addEventListener('message', (e) => { if (e.data?.type === 'series') { last = e.data; draw(); } });
document.getElementById('span').addEventListener('change', draw);
window.addEventListener('resize', draw);
</script></body></html>`;
}

module.exports = { registerLiveValues, adsSource, standInSource, trendHtml };
void path;

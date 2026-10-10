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
const { watchNames, valueText } = require('./liveText.cjs');

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
      return s ? { type: s.type, size: 4, dataType: 3, ...(s.struct ? { simple: false } : {}) } : null;
    },
    read: async (p) => sym(p)?.value ?? null,
    enumNames: async (type) => Object.values(read().symbols ?? {}).find((s) => s.type === type && s.enum)?.enum ?? null,
    dispose: async () => {},
  };
}

/**
 * online: { isOnline(root), source(root) → a source, dropped(root) }; projectOf(file). → { refresh, shown(uri) }
 */
function registerLiveValues(context, { online, projectOf }) {
  const deco = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2px', color: new vscode.ThemeColor('editorInlayHint.foreground'), backgroundColor: new vscode.ThemeColor('editorInlayHint.background'), fontStyle: 'normal' },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  const bar = vscode.window.createStatusBarItem('kvalMachineScope.instance', vscode.StatusBarAlignment.Left, 47);
  bar.name = 'TwinCAT instance (live values)';
  bar.command = 'kvalMachineScope.pickInstance';
  context.subscriptions.push(deco, bar);

  // (what each symbol is, per instance: its info, or null when the PLC has none; enum names per type)
  const known = new Map();
  const enums = new Map();
  const instancesOf = new Map();
  const files = new Map();
  // (what is shown now, per section: for the tests and the hover)
  const shownNow = new Map();
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
          continue;
        }
        const text = ed.document.getText();
        const vr = ed.visibleRanges[0] ?? new vscode.Range(0, 0, ed.document.lineCount, 0);
        const from = ed.document.offsetAt(new vscode.Position(Math.max(0, vr.start.line - 5), 0));
        const to = ed.document.offsetAt(new vscode.Position(vr.end.line + 5, 0));
        const names = watchNames(text, { from, to }).slice(0, MAX_NAMES);
        const list = [];
        const shown = {};
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
          for (const u of n.uses) {
            const at = ed.document.positionAt(u.end);
            list.push({ range: new vscode.Range(at, at), renderOptions: { after: { contentText: ` ${t} ` } }, hoverMessage: `${full} (${sym.type || 'value'}) = ${t}` });
          }
        }
        ed.setDecorations(deco, list);
        shownNow.set(ed.document.uri.toString(), shown);
      }
    } catch (err) {
      if (process.env.KSS_LIVE_DEBUG) console.error("live values:", err?.stack ?? err);
      // (the connection lost: tried again next time)
    } finally {
      busy = false;
      if (!barShown) bar.hide();
    }
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
    vscode.commands.registerCommand('kvalMachineScope.liveValuesShown', (uri) => shownNow.get(String(uri)) ?? null)
  );
  return {
    /** Online state or the project changed: what was known is read again */
    refresh(root) {
      for (const m of [known, enums, instancesOf]) for (const k of [...m.keys()]) if (!root || k.startsWith(root.toLowerCase())) m.delete(k);
      if (!online.isOnline(root ?? '')) for (const ed of vscode.window.visibleTextEditors) if (ed.document.uri.scheme === SCHEME) ed.setDecorations(deco, []);
      void tick();
    },
  };
}

module.exports = { registerLiveValues, adsSource, standInSource };
void path;

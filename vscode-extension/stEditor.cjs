// TwinCAT source files opened as Structured Text, as in TwinCAT XAE: a .TcPOU / .TcDUT / .TcGVL / .TcIO opens as its
// declaration (above) and its implementation (below), without the XML; a method, property or action the same way
// (Go to member, or the TwinCAT view's POU list). Each section is a document of the "twincat-st:" file system
// (sectionStore.cjs): VS Code's own editor, with the Structured Text language of the extensions installed (or this
// one's grammar), Find, formatting; saved, only its text goes back into the file.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseSource, sectionAt, memberTitle } = require('./tcStSource.cjs');
const { createIndex, nameAt, findReferences, findDefinition, renameEdits } = require('./stReferences.cjs');
const { declarationOutline, implementationOutline } = require('./stOutline.cjs');
const { projectRootOf } = require('../shared/tcBuild.cjs');
const { SCHEME, sectionAddress, addressOf, createSectionStore } = require('./sectionStore.cjs');

const VIEW_TYPE = 'kvalMachineScope.structuredText';
const SOURCE_RX = /\.(tcpou|tcdut|tcgvl|tcio)$/i;

/** The Structured Text language for the sections: the setting, else an installed extension's "st", else ours */
async function stLanguage() {
  const chosen = vscode.workspace.getConfiguration('kvalMachineScope').get('structuredText.language', 'auto');
  const langs = await vscode.languages.getLanguages();
  if (chosen && chosen !== 'auto' && langs.includes(chosen)) return chosen;
  return langs.includes('st') ? 'st' : 'kval-st';
}

/** The file a URI stands for: a section's file, or the file itself */
function fileOf(uri) {
  if (!uri) return null;
  if (uri.scheme === SCHEME) {
    try {
      return addressOf(uri.query).file;
    } catch {
      return null;
    }
  }
  return uri.scheme === 'file' ? uri.fsPath : null;
}

function register(context) {
  const store = createSectionStore();
  const changes = new vscode.EventEmitter();
  const sectionUri = (a, members) => {
    const { path: p, query } = sectionAddress(a, members);
    return vscode.Uri.from({ scheme: SCHEME, path: p, query });
  };

  // The file system: each section a file
  const watchers = new Map();
  const watchFile = (file) => {
    const k = path.resolve(file).toLowerCase();
    const w = watchers.get(k);
    if (w) {
      w.count++;
      return;
    }
    let timer = null;
    let fsw = null;
    try {
      fsw = fs.watch(file, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const changed = store.changedIn(file);
          if (changed.length) changes.fire(changed.map((a) => ({ type: vscode.FileChangeType.Changed, uri: sectionUri(a, parseSafe(file)) })));
        }, 300);
      });
    } catch {
      fsw = null;
    }
    watchers.set(k, { count: 1, close: () => { clearTimeout(timer); fsw?.close(); } });
  };
  const unwatchFile = (file) => {
    const k = path.resolve(file).toLowerCase();
    const w = watchers.get(k);
    if (!w) return;
    if (--w.count <= 0) {
      w.close();
      watchers.delete(k);
    }
  };
  const provider = {
    onDidChangeFile: changes.event,
    watch(uri) {
      const file = fileOf(uri);
      if (!file) return new vscode.Disposable(() => {});
      watchFile(file);
      return new vscode.Disposable(() => unwatchFile(file));
    },
    stat(uri) {
      const a = addressOf(uri.query);
      if (!fs.existsSync(a.file)) throw vscode.FileSystemError.FileNotFound(uri);
      const s = store.stat(a);
      if (!s) throw vscode.FileSystemError.FileNotFound(uri);
      return { type: vscode.FileType.File, ctime: s.mtime, mtime: s.mtime, size: Buffer.byteLength(s.text, 'utf8') };
    },
    readFile(uri) {
      const a = addressOf(uri.query);
      if (!fs.existsSync(a.file)) throw vscode.FileSystemError.FileNotFound(uri);
      const s = store.stat(a);
      if (!s) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(s.text, 'utf8');
    },
    writeFile(uri, content) {
      const a = addressOf(uri.query);
      try {
        store.write(a, Buffer.from(content).toString('utf8'));
      } catch (err) {
        if (err?.code === 'EACCES' || err?.code === 'EPERM') throw vscode.FileSystemError.NoPermissions(`${path.basename(a.file)} is read-only`);
        throw vscode.FileSystemError.Unavailable(err?.message ?? String(err));
      }
    },
    readDirectory: () => [],
    createDirectory: (uri) => { throw vscode.FileSystemError.NoPermissions(uri); },
    delete: (uri) => { throw vscode.FileSystemError.NoPermissions(uri); },
    rename: (uri) => { throw vscode.FileSystemError.NoPermissions(uri); },
  };
  context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, provider, { isCaseSensitive: true }), changes);

  // The section documents in the Structured Text language (also when VS Code reopens them at start)
  const setLanguage = async (doc) => {
    if (doc.uri.scheme !== SCHEME) return doc;
    const lang = await stLanguage();
    return doc.languageId === lang ? doc : vscode.languages.setTextDocumentLanguage(doc, lang);
  };
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => void setLanguage(d).catch(() => {})),
    // (the setting changed: every open section in the new language at once)
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kvalMachineScope.structuredText.language')) for (const d of vscode.workspace.textDocuments) void setLanguage(d).catch(() => {});
    })
  );
  for (const d of vscode.workspace.textDocuments) void setLanguage(d).catch(() => {});

  // Where the implementation goes: the editor group below the declaration's (made once, then reused)
  const below = new Map();
  const groupExists = (col) => vscode.window.tabGroups.all.some((g) => g.viewColumn === col);

  /**
   * A member of a file opened as XAE does: its declaration in the group given (or the active one), its implementation
   * in the group below it. Only one of them: in the group given. A graphical implementation (SFC, CFC): said so
   */
  async function openMember(file, key = '', { viewColumn, focus } = {}) {
    const xml = fs.readFileSync(file, 'utf8');
    const { members } = parseSource(xml);
    const mb = members.find((m) => m.key === key) ?? members[0];
    if (!mb) {
      void vscode.window.showWarningMessage(`${path.basename(file)} has no TwinCAT object in it: opened as XML`);
      return vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'default');
    }
    // (opened from a group that holds implementations: the declarations' group above it)
    let column = viewColumn ?? vscode.window.tabGroups.activeTabGroup?.viewColumn ?? vscode.ViewColumn.One;
    for (const [declCol, implCol] of below) if (implCol === column && groupExists(declCol)) column = declCol;
    const open = async (section) => setLanguage(await vscode.workspace.openTextDocument(sectionUri({ file, key: mb.key, section }, members)));
    const decl = mb.decl ? await open('decl') : null;
    const impl = mb.impl ? await open('impl') : null;
    if (decl) {
      const shown = await vscode.window.showTextDocument(decl, { viewColumn: column, preview: false, preserveFocus: !!impl });
      // (Beside: the group it went to)
      column = shown.viewColumn ?? column;
    }
    if (impl && decl) {
      let implCol = below.get(column);
      if (!implCol || !groupExists(implCol) || implCol === column) {
        // (a new group below the declaration's, a third of the height for the declaration as in XAE)
        await vscode.window.showTextDocument(decl, { viewColumn: column, preview: false });
        await vscode.commands.executeCommand('workbench.action.newGroupBelow');
        implCol = vscode.window.tabGroups.activeTabGroup.viewColumn;
        below.set(column, implCol);
        try {
          await vscode.commands.executeCommand('workbench.action.focusPreviousGroup');
          for (let i = 0; i < 3; i++) await vscode.commands.executeCommand('workbench.action.decreaseViewHeight');
        } catch {
          // (the sizes as VS Code makes them)
        }
      }
      await vscode.window.showTextDocument(impl, { viewColumn: implCol, preview: false });
    } else if (impl) {
      await vscode.window.showTextDocument(impl, { viewColumn: column, preview: false });
    }
    // (a place to show: that section's editor, the caret there)
    const target = focus ? (focus.section === 'decl' ? decl : impl) : null;
    if (target) {
      const ed = vscode.window.visibleTextEditors.find((e) => e.document === target);
      const pos = new vscode.Position(focus.line ?? 0, focus.column ?? 0);
      await vscode.window.showTextDocument(target, { viewColumn: ed?.viewColumn ?? column, preview: false, selection: new vscode.Range(pos, pos) });
    }
    if (mb.implLanguage && mb.implLanguage !== 'ST') {
      void vscode.window.showInformationMessage(`${memberTitle(mb)}'s implementation is ${mb.implLanguage}, not text: edit it in TwinCAT XAE`);
    }
    members_.refresh(file);
  }

  // .TcPOU / .TcDUT / .TcGVL / .TcIO opened (double-click, Quick Open): as Structured Text, the XML tab closed again.
  // "Reopen Editor With… → Text Editor" (or Open as XML) shows the XML
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      {
        openCustomDocument: (uri) => ({ uri, dispose() {} }),
        async resolveCustomEditor(doc, panel) {
          panel.webview.options = { enableScripts: false };
          panel.webview.html = `<!doctype html><meta charset="utf-8"><body style="font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px">Opening ${escapeHtml(path.basename(doc.uri.fsPath))} as Structured Text…</body>`;
          const column = panel.viewColumn;
          setTimeout(async () => {
            try {
              await openMember(doc.uri.fsPath, '', { viewColumn: column });
            } catch (err) {
              void vscode.window.showErrorMessage(`Could not open ${path.basename(doc.uri.fsPath)} as Structured Text: ${err?.message ?? err}`);
              return vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default', column);
            }
            const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === VIEW_TYPE && t.input.uri.toString() === doc.uri.toString());
            if (tab) void vscode.window.tabGroups.close(tab).then(undefined, () => {});
          }, 0);
        },
      },
      { supportsMultipleEditorsPerDocument: true }
    )
  );

  // The active file (a section's, or a TwinCAT file's)
  const activeFile = () => {
    const u = vscode.window.activeTextEditor?.document.uri ?? vscode.window.tabGroups.activeTabGroup?.activeTab?.input?.uri;
    const f = fileOf(u);
    return f && SOURCE_RX.test(f) ? f : null;
  };
  const pickFile = async (uri) => {
    const f = fileOf(uri instanceof vscode.Uri ? uri : undefined) ?? activeFile();
    if (f) return f;
    const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'TwinCAT source': ['TcPOU', 'TcDUT', 'TcGVL', 'TcIO'] } });
    return picked?.[0]?.fsPath ?? null;
  };

  // The members of the active file, a list (the TwinCAT view's "POU")
  const members_ = membersView(context, { activeFile, openMember });

  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.openStructuredText', async (uri) => {
      const f = await pickFile(uri);
      if (f) await openMember(f, '');
    }),
    vscode.commands.registerCommand('kvalMachineScope.openXml', async (uri) => {
      const f = await pickFile(uri);
      if (f) await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(f), 'default');
    }),
    vscode.commands.registerCommand('kvalMachineScope.goToMember', async (uri) => {
      const f = await pickFile(uri);
      if (!f) return;
      const { members } = parseSource(fs.readFileSync(f, 'utf8'));
      const items = members.filter((m) => m.decl || m.impl).map((m) => ({ label: `${iconOf(m)} ${memberTitle(m)}`, description: m.key === '' ? m.kind : m.kind, key: m.key }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: `${path.basename(f)}: open a member (declaration and implementation)`, matchOnDescription: true });
      if (picked) await openMember(f, picked.key);
    }),
    vscode.commands.registerCommand('kvalMachineScope.openMember', (file, key) => openMember(file, key))
  );
  const sectionUriOf = (file, key, section, members) => sectionUri({ file, key, section }, members);

  /**
   * A place in a TwinCAT file (line and column 0-based, as in the file: the statechart's Go to code) shown in its
   * section, beside the chart (the declarations' group when there is one); not in a section's text: the file itself.
   * true when shown in a section
   */
  async function revealInSource(file, line, column = 0) {
    let at = null;
    try {
      at = sectionAt(fs.readFileSync(file, 'utf8'), line, column);
    } catch {
      at = null;
    }
    if (!at) return false;
    // (the section shown already: there, the active editor first; no more groups)
    let members = null;
    try {
      members = parseSource(fs.readFileSync(file, 'utf8')).members;
    } catch {
      members = null;
    }
    const uri = sectionUri({ file, key: at.key, section: at.section }, members).toString();
    const visible = vscode.window.visibleTextEditors.filter((e) => e.document.uri.toString() === uri);
    const ed = visible.find((e) => e === vscode.window.activeTextEditor) ?? visible[0];
    if (ed) {
      const pos = new vscode.Position(at.line, at.column);
      await vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preview: false, selection: new vscode.Range(pos, pos) });
      return true;
    }
    const declGroup = [...below.keys()].find((c) => groupExists(c) && c !== vscode.window.tabGroups.activeTabGroup?.viewColumn);
    await openMember(file, at.key, { viewColumn: declGroup ?? vscode.ViewColumn.Beside, focus: at });
    return true;
  }

  // Find All References, Go to Definition (F12, Ctrl+click): by name, across the project's sections (the open,
  // edited ones as they are now)
  const index = createIndex();
  const editedNow = () => {
    const m = new Map();
    for (const d of vscode.workspace.textDocuments) {
      if (d.uri.scheme !== SCHEME || !d.isDirty) continue;
      try {
        const a = addressOf(d.uri.query);
        m.set(`${path.resolve(a.file).toLowerCase()}|${a.key}|${a.section}`, d.getText());
      } catch {
        // (not a section)
      }
    }
    return m;
  };
  const projectFiles = (file) => index.project(projectRootOf(file) ?? path.dirname(file), editedNow());
  const locationOf = (files, r) => {
    const members = files.find((f) => f.file === r.file)?.members;
    return new vscode.Location(sectionUri({ file: r.file, key: r.key, section: r.section }, members), new vscode.Range(r.line, r.column, r.line, r.column + r.length));
  };
  const here = (doc, pos) => {
    const a = addressOf(doc.uri.query);
    const n = nameAt(doc.getText(), pos.line, pos.character);
    return n ? { a, n } : null;
  };
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider({ scheme: SCHEME }, {
      provideReferences(doc, pos, ctx) {
        const h = here(doc, pos);
        if (!h) return [];
        const files = projectFiles(h.a.file);
        return findReferences(files, h.n.name).filter((r) => ctx.includeDeclaration || !r.declaration).map((r) => locationOf(files, r));
      },
    }),
    vscode.languages.registerDefinitionProvider({ scheme: SCHEME }, {
      provideDefinition(doc, pos) {
        const h = here(doc, pos);
        if (!h) return [];
        const files = projectFiles(h.a.file);
        return findDefinition(files, { file: h.a.file, key: h.a.key, name: h.n.name, qualifier: h.n.qualifier }).map((r) => locationOf(files, r));
      },
    }),
    vscode.commands.registerCommand('kvalMachineScope.revealInSource', (file, line, column) => revealInSource(file, line, column)),
    // Rename (F2): by the name's declaration (a method's local in that method, a POU's variable in its POU and the
    // POUs that extend it, a global everywhere); always shown in the refactor preview first, each change to check
    vscode.languages.registerRenameProvider({ scheme: SCHEME }, {
      prepareRename(doc, pos) {
        const h = here(doc, pos);
        if (!h) throw new Error('Not a name to rename');
        const r = renameEdits(projectFiles(h.a.file), { file: h.a.file, key: h.a.key, name: h.n.name, qualifier: h.n.qualifier }, `${h.n.name}_`);
        if (r.error && !/already declared|not a Structured Text name/.test(r.error)) throw new Error(r.error);
        const word = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
        return { range: word, placeholder: h.n.name };
      },
      provideRenameEdits(doc, pos, newName) {
        const h = here(doc, pos);
        if (!h) return null;
        const files = projectFiles(h.a.file);
        const r = renameEdits(files, { file: h.a.file, key: h.a.key, name: h.n.name, qualifier: h.n.qualifier }, newName);
        if (r.error) throw new Error(r.error);
        const edit = new vscode.WorkspaceEdit();
        const inScope = { needsConfirmation: true, label: `Rename ${h.n.name} to ${newName}`, description: r.scope === 'member' ? 'in its method' : r.scope === 'pou' ? 'in its POU and the POUs that extend it' : 'in the project' };
        const apart = { needsConfirmation: true, label: `${h.n.name} after a dot in other POUs`, description: 'their type is not known here: check each one' };
        for (const e of r.edits) {
          const loc = locationOf(files, e);
          edit.replace(loc.uri, loc.range, newName, e.apart ? apart : inScope);
        }
        return edit;
      },
    }),
    // The outline (the Outline view, the breadcrumbs): the declaration's object, VAR blocks and variables; the
    // implementation's CASE branches
    vscode.languages.registerDocumentSymbolProvider({ scheme: SCHEME }, {
      provideDocumentSymbols(doc) {
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return [];
        }
        // (a declaration in the "st" language of Structured Text language Support: its own outline has the same
        // blocks and variables; not twice. An implementation's CASE branches: only here)
        if (a.section === 'decl' && doc.languageId === 'st' && vscode.extensions.getExtension('serhioromano.vscode-st')) return [];
        const text = doc.getText();
        const list = a.section === 'decl' ? declarationOutline(text) : implementationOutline(text);
        const KIND = { class: vscode.SymbolKind.Class, method: vscode.SymbolKind.Method, property: vscode.SymbolKind.Property, function: vscode.SymbolKind.Function, interface: vscode.SymbolKind.Interface, struct: vscode.SymbolKind.Struct, enum: vscode.SymbolKind.Enum, namespace: vscode.SymbolKind.Namespace, variable: vscode.SymbolKind.Variable, field: vscode.SymbolKind.Field, enumMember: vscode.SymbolKind.EnumMember, constant: vscode.SymbolKind.Constant, event: vscode.SymbolKind.Event };
        const toSymbol = (sy) => {
          const range = new vscode.Range(doc.positionAt(sy.start), doc.positionAt(Math.max(sy.start, sy.end)));
          const sel = new vscode.Range(doc.positionAt(sy.nameStart), doc.positionAt(sy.nameEnd));
          const d = new vscode.DocumentSymbol(sy.name, sy.detail ?? '', KIND[sy.kind] ?? vscode.SymbolKind.Variable, range.union(sel), sel);
          d.children = sy.children.map(toSymbol);
          return d;
        };
        return list.map(toSymbol);
      },
    })
  );
  return { openMember, activeFile, fileOf, sectionUriOf, revealInSource };
}

const ICONS = { POU: '$(symbol-class)', DUT: '$(symbol-structure)', GVL: '$(symbol-variable)', Itf: '$(symbol-interface)', Method: '$(symbol-method)', Property: '$(symbol-property)', Get: '$(arrow-right)', Set: '$(arrow-left)', Action: '$(symbol-event)', Transition: '$(arrow-swap)' };
const iconOf = (m) => ICONS[m.kind] ?? '$(symbol-misc)';
const THEME_ICONS = { POU: 'symbol-class', DUT: 'symbol-structure', GVL: 'symbol-variable', Itf: 'symbol-interface', Method: 'symbol-method', Property: 'symbol-property', Get: 'arrow-right', Set: 'arrow-left', Action: 'symbol-event', Transition: 'arrow-swap' };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const parseSafe = (file) => {
  try {
    return parseSource(fs.readFileSync(file, 'utf8')).members;
  } catch {
    return null;
  }
};

/** The TwinCAT view's POU list: the active file's object and its methods, properties (Get / Set), actions */
function membersView(context, { activeFile, openMember }) {
  const changed = new vscode.EventEmitter();
  let file = null;
  const provider = {
    onDidChangeTreeData: changed.event,
    getChildren(el) {
      if (!file) return [];
      const members = parseSafe(file) ?? [];
      if (!el) return members.filter((m) => !m.parent);
      return members.filter((m) => m.parent === el.key);
    },
    getTreeItem(m) {
      const members = parseSafe(file) ?? [];
      const hasChildren = members.some((x) => x.parent === m.key);
      const item = new vscode.TreeItem(memberTitle(m), hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(THEME_ICONS[m.kind] ?? 'symbol-misc');
      item.description = m.key === '' ? m.kind : m.implLanguage && m.implLanguage !== 'ST' ? m.implLanguage : '';
      item.tooltip = `${memberTitle(m)}: ${[m.decl ? 'declaration' : '', m.impl ? 'implementation' : ''].filter(Boolean).join(' and ') || 'nothing to show'}`;
      if (m.decl || m.impl) item.command = { command: 'kvalMachineScope.openMember', title: 'Open', arguments: [file, m.key] };
      return item;
    },
  };
  const view = vscode.window.createTreeView('kvalMachineScope.pouMembers', { treeDataProvider: provider, showCollapseAll: true });
  const refresh = (f = activeFile()) => {
    if (f) file = f;
    view.description = file ? path.basename(file) : '';
    view.message = file ? undefined : 'Open a .TcPOU, .TcDUT, .TcGVL or .TcIO to list its members.';
    changed.fire(undefined);
  };
  context.subscriptions.push(view, changed, vscode.window.onDidChangeActiveTextEditor(() => refresh()), vscode.window.tabGroups.onDidChangeTabs(() => refresh()));
  refresh();
  return { refresh };
}

module.exports = { register, VIEW_TYPE, fileOf, SOURCE_RX };

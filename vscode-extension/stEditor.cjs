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
const { createIndex, nameAt, findReferences, findDefinition, renameEdits, blankCode, declarationsIn, occurrencesIn } = require('./stReferences.cjs');
const { declarationOutline, implementationOutline } = require('./stOutline.cjs');
const { checkSection, projectNames, extendsUnknown } = require('./stChecks.cjs');
const { libraryNames } = require('./libraryNames.cjs');
const { completionsAt, signatureAt } = require('./stCompletion.cjs');
const { projectRootOf } = require('../shared/tcBuild.cjs');
const nav = require('./stNavigation.cjs');
const { guessType, addDeclaration, removeDeclaration, formatSection } = require('./stEdits.cjs');
// (the app's own: which method holds the POU's state machine, doState(), Execute() or the body)
const { stateMethodName } = require('../src/utils/stateMethod.ts');
const { plcProjectsUnder } = require('./plcTree.cjs');
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
    if (doc.uri.scheme !== SCHEME && doc.uri.scheme !== 'twincat-st-git') return doc;
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

  // Auto Declare (XAE's Shift+F2) and Remove: Quick Fixes on the checks' findings (a name declared nowhere, a
  // variable never used); Format Document: each line's indentation from its blocks
  const wholeRange = (doc) => new vscode.Range(0, 0, doc.lineCount, 0);
  const declareTargets = (file, key) => {
    const members = parseSafe(file) ?? [];
    const own = key ? members.find((m) => m.key === key && m.decl) : null;
    const pou = members.find((m) => m.key === '');
    const pouName = path.basename(file).replace(/\.tcpou$/i, '');
    const list = [];
    if (own) for (const block of ['VAR', 'VAR_INPUT', 'VAR_OUTPUT']) list.push({ key, block, where: `${own.name}()'s ${block}`, members });
    if (pou?.decl) for (const block of ['VAR', 'VAR_INPUT', 'VAR_OUTPUT', ...(own ? [] : ['VAR_TEMP'])]) list.push({ key: '', block, where: `${pouName}'s ${block}`, members });
    return list;
  };
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: SCHEME }, {
      async provideCodeActions(doc, _range, ctx) {
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return [];
        }
        const out = [];
        for (const d of ctx.diagnostics) {
          if (d.source !== 'TwinCAT') continue;
          const name = doc.getText(d.range);
          if (d.code === 'unused' && a.section === 'decl') {
            const text = removeDeclaration(doc.getText(), name);
            if (text === null) continue;
            const act = new vscode.CodeAction(`Remove the declaration of ${name}`, vscode.CodeActionKind.QuickFix);
            act.diagnostics = [d];
            act.isPreferred = true;
            act.edit = new vscode.WorkspaceEdit();
            act.edit.replace(doc.uri, wholeRange(doc), text);
            out.push(act);
          } else if (d.code === 'undeclared' && a.section === 'impl' && /\.tcpou$/i.test(a.file)) {
            const type = guessType(doc.getText(), name);
            let first = true;
            for (const t of declareTargets(a.file, a.key)) {
              const uri = sectionUri({ file: a.file, key: t.key, section: 'decl' }, t.members);
              const declDoc = await vscode.workspace.openTextDocument(uri);
              const r = addDeclaration(declDoc.getText(), { name, type, block: t.block });
              const act = new vscode.CodeAction(`Declare ${name} : ${type} in ${t.where}`, vscode.CodeActionKind.QuickFix);
              act.diagnostics = [d];
              act.isPreferred = first;
              first = false;
              act.edit = new vscode.WorkspaceEdit();
              act.edit.replace(uri, wholeRange(declDoc), r.text);
              out.push(act);
            }
            const ask = new vscode.CodeAction(`Declare ${name}… (its type and block)`, vscode.CodeActionKind.QuickFix);
            ask.diagnostics = [d];
            ask.command = { command: 'kvalMachineScope.autoDeclare', title: 'Auto Declare', arguments: [doc.uri, name] };
            out.push(ask);
          }
        }
        return out;
      },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    // Auto Declare… (the right-click menu, Shift+F2 as in XAE; a Quick Fix): the name at the caret, its type (guessed)
    // and block asked, then declared and the declaration shown
    vscode.commands.registerCommand('kvalMachineScope.autoDeclare', async (uriArg, nameArg, given = {}) => {
      const ed = vscode.window.activeTextEditor;
      const uri = uriArg instanceof vscode.Uri ? uriArg : ed?.document.uri;
      if (!uri || uri.scheme !== SCHEME) return null;
      const a = addressOf(uri.query);
      const doc = await vscode.workspace.openTextDocument(uri);
      const at = ed && ed.document.uri.toString() === uri.toString() ? nameAt(doc.getText(), ed.selection.active.line, ed.selection.active.character) : null;
      const name = typeof nameArg === 'string' ? nameArg : at?.name;
      if (!name) return null;
      const implText = a.section === 'impl' ? doc.getText() : textOf(a.file, a.key, 'impl') ?? '';
      const type = given.type ?? (await vscode.window.showInputBox({ prompt: `${name}'s type`, value: guessType(implText, name) }));
      if (!type) return null;
      const targets = declareTargets(a.file, a.key);
      const picked = given.block
        ? targets.find((t) => t.block === given.block && (given.pou ? t.key === '' : true))
        : (await vscode.window.showQuickPick(targets.map((t) => ({ label: t.where, t })), { placeHolder: `Declare ${name} : ${type} in` }))?.t;
      if (!picked) return null;
      const declUri = sectionUri({ file: a.file, key: picked.key, section: 'decl' }, picked.members);
      const declDoc = await vscode.workspace.openTextDocument(declUri);
      const r = addDeclaration(declDoc.getText(), { name, type, block: picked.block });
      const we = new vscode.WorkspaceEdit();
      we.replace(declUri, wholeRange(declDoc), r.text);
      await vscode.workspace.applyEdit(we);
      const shown = await vscode.window.showTextDocument(declDoc, { preserveFocus: true, preview: false, viewColumn: vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === declUri.toString())?.viewColumn });
      shown.revealRange(new vscode.Range(r.line, 0, r.line, 0));
      return { uri: declUri.toString(), line: r.line };
    }),
    vscode.languages.registerDocumentFormattingEditProvider({ scheme: SCHEME }, {
      provideDocumentFormattingEdits(doc, options) {
        const text = doc.getText();
        const next = formatSection(text, { indent: options.insertSpaces ? ' '.repeat(options.tabSize) : '\t' }).split(/\r?\n/);
        // (only the lines whose indentation changes: the caret and the rest stay)
        const edits = [];
        for (let i = 0; i < doc.lineCount && i < next.length; i++) {
          const line = doc.lineAt(i).text;
          if (line !== next[i]) edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, line.length), next[i]));
        }
        return edits;
      },
    })
  );

  // Reads and writes, as XAE's Cross Reference List tells them: a name's places in the section highlighted (write,
  // read; its declaration), Find All Writes across the project ("who sets this?")
  context.subscriptions.push(
    vscode.languages.registerDocumentHighlightProvider({ scheme: SCHEME }, {
      provideDocumentHighlights(doc, pos) {
        const n = nameAt(doc.getText(), pos.line, pos.character);
        if (!n) return [];
        const code = blankCode(doc.getText());
        const KIND = { write: vscode.DocumentHighlightKind.Write, read: vscode.DocumentHighlightKind.Read, call: vscode.DocumentHighlightKind.Read, declaration: vscode.DocumentHighlightKind.Text };
        return occurrencesIn(code, declarationsIn(code), n.name).map((o) => {
          const at = doc.positionAt(o.offset);
          return new vscode.DocumentHighlight(new vscode.Range(at, at.translate(0, o.length)), KIND[o.access]);
        });
      },
    }),
    vscode.commands.registerCommand('kvalMachineScope.findWrites', async (uriArg, posArg) => {
      const ed = vscode.window.activeTextEditor;
      const uri = uriArg instanceof vscode.Uri ? uriArg : ed?.document.uri;
      if (!uri || uri.scheme !== SCHEME) return [];
      const doc = await vscode.workspace.openTextDocument(uri);
      const pos = posArg instanceof vscode.Position ? posArg : ed?.selection.active;
      const h = pos ? here(doc, pos) : null;
      if (!h) return [];
      const files = projectFiles(h.a.file);
      const locs = findReferences(files, h.n.name).filter((r) => r.access === 'write').map((r) => locationOf(files, r));
      if (!locs.length) void vscode.window.showInformationMessage(`${h.n.name} is written nowhere in this project (by name)`);
      else if (!uriArg) await vscode.commands.executeCommand('editor.action.showReferences', uri, pos, locs);
      return locs;
    })
  );

  // Navigation as in XAE (stNavigation.cjs): the project's symbols (Ctrl+T), folding, the type hierarchy, the calls
  // (Shift+Alt+H), Go to Implementation (Ctrl+F12); by name, as Find All References
  const NAV_KIND = { class: vscode.SymbolKind.Class, function: vscode.SymbolKind.Function, module: vscode.SymbolKind.Module, interface: vscode.SymbolKind.Interface, struct: vscode.SymbolKind.Struct, enum: vscode.SymbolKind.Enum, typeParameter: vscode.SymbolKind.TypeParameter, method: vscode.SymbolKind.Method, property: vscode.SymbolKind.Property, event: vscode.SymbolKind.Event, variable: vscode.SymbolKind.Variable, enumMember: vscode.SymbolKind.EnumMember };
  const TYPE_KIND = { FUNCTION_BLOCK: 'class', FUNCTION: 'function', PROGRAM: 'module', INTERFACE: 'interface', STRUCT: 'struct', UNION: 'struct', ENUM: 'enum', ALIAS: 'typeParameter' };
  const CALL_KIND = { method: vscode.SymbolKind.Method, action: vscode.SymbolKind.Event, function: vscode.SymbolKind.Function, program: vscode.SymbolKind.Module, functionBlock: vscode.SymbolKind.Class };
  const navLocation = (files, l) => locationOf(files, { ...l, length: l.length ?? 0 });
  // (the projects searched without a document: those of the open sections, else the workspace's TwinCAT projects)
  const symbolRoots = () => {
    const roots = new Set();
    for (const d of vscode.workspace.textDocuments) {
      if (d.uri.scheme !== SCHEME) continue;
      try {
        const file = addressOf(d.uri.query).file;
        roots.add(projectRootOf(file) ?? path.dirname(file));
      } catch {
        // (not a section)
      }
    }
    if (!roots.size) for (const w of vscode.workspace.workspaceFolders ?? []) for (const p of plcProjectsUnder(w.uri.fsPath)) roots.add(projectRootOf(p) ?? path.dirname(p));
    return [...roots];
  };
  const typeItem = (files, t) => {
    const loc = navLocation(files, t.location);
    return new vscode.TypeHierarchyItem(NAV_KIND[TYPE_KIND[t.kind]] ?? vscode.SymbolKind.Class, t.name, t.kind.replace('_', ' ').toLowerCase(), loc.uri, loc.range, loc.range);
  };
  // (a call item: at its implementation, where its calls are; an interface's method at its declaration)
  const callItem = (files, it) => {
    const f = files.find((x) => x.file === it.file);
    const impl = f?.sections.some((x) => x.key === it.key && x.section === 'impl');
    const loc = impl ? new vscode.Location(sectionUri({ file: it.file, key: it.key, section: 'impl' }, f.members), new vscode.Range(0, 0, 0, 0)) : navLocation(files, it.location);
    return new vscode.CallHierarchyItem(CALL_KIND[it.kind] ?? vscode.SymbolKind.Function, it.name, it.container || it.kind, loc.uri, loc.range, loc.range);
  };
  const navOf = (uri) => {
    const a = addressOf(uri.query);
    const files = projectFiles(a.file);
    return { a, files };
  };
  const rangesOf = (ranges) => ranges.map((r) => new vscode.Range(r.line, r.column, r.line, r.column + r.length));
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols(query) {
        const out = [];
        for (const root of symbolRoots()) {
          const files = index.project(root, editedNow());
          for (const sy of nav.workspaceSymbols(files, query, 300)) out.push(new vscode.SymbolInformation(sy.name, NAV_KIND[sy.kind] ?? vscode.SymbolKind.Variable, sy.container, navLocation(files, sy.location)));
        }
        return out;
      },
    }),
    vscode.languages.registerFoldingRangeProvider({ scheme: SCHEME }, {
      provideFoldingRanges(doc) {
        const KIND = { region: vscode.FoldingRangeKind.Region, comment: vscode.FoldingRangeKind.Comment };
        return nav.foldingRanges(doc.getText()).map((r) => new vscode.FoldingRange(r.start, r.end, KIND[r.kind]));
      },
    }),
    vscode.languages.registerTypeHierarchyProvider({ scheme: SCHEME }, {
      prepareTypeHierarchy(doc, pos) {
        const a = addressOf(doc.uri.query);
        const files = projectFiles(a.file);
        const types = nav.typesOf(files);
        const n = nameAt(doc.getText(), pos.line, pos.character);
        // (the name at the caret, a type; else the file's own type)
        const t = (n && types.find((x) => x.name.toLowerCase() === n.name.toLowerCase())) || types.find((x) => path.resolve(x.file).toLowerCase() === path.resolve(a.file).toLowerCase());
        return t ? [typeItem(files, t)] : [];
      },
      provideTypeHierarchySupertypes(item) {
        const { files } = navOf(item.uri);
        return nav.supertypes(files, item.name).map((t) => typeItem(files, t));
      },
      provideTypeHierarchySubtypes(item) {
        const { files } = navOf(item.uri);
        return nav.subtypes(files, item.name).map((t) => typeItem(files, t));
      },
    }),
    vscode.languages.registerCallHierarchyProvider({ scheme: SCHEME }, {
      prepareCallHierarchy(doc, pos) {
        const a = addressOf(doc.uri.query);
        const files = projectFiles(a.file);
        const n = nameAt(doc.getText(), pos.line, pos.character);
        // (the callables the name stands for; else the method, action or POU the caret is in)
        let items = n ? nav.callablesNamed(files, { file: a.file, name: n.name, qualifier: n.qualifier }) : [];
        if (!items.length) items = [nav.itemOfPlace(files, a.file, a.key)].filter(Boolean);
        return items.map((it) => callItem(files, it));
      },
      provideCallHierarchyIncomingCalls(item) {
        const { a, files } = navOf(item.uri);
        const it = nav.itemOfPlace(files, a.file, a.key);
        return it ? nav.incomingCalls(files, it).map((c) => new vscode.CallHierarchyIncomingCall(callItem(files, c.from), rangesOf(c.ranges))) : [];
      },
      provideCallHierarchyOutgoingCalls(item) {
        const { a, files } = navOf(item.uri);
        const it = nav.itemOfPlace(files, a.file, a.key);
        return it ? nav.outgoingCalls(files, it).map((c) => new vscode.CallHierarchyOutgoingCall(callItem(files, c.to), rangesOf(c.ranges))) : [];
      },
    }),
    // Show in statechart: above each state's CASE branch of the POU's state method
    vscode.languages.registerCodeLensProvider({ scheme: SCHEME }, {
      provideCodeLenses(doc) {
        if (!vscode.workspace.getConfiguration('kvalMachineScope.structuredText').get('codeLens', true)) return [];
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return [];
        }
        if (a.section !== 'impl' || !/\.tcpou$/i.test(a.file)) return [];
        let xml;
        try {
          xml = fs.readFileSync(a.file, 'utf8');
        } catch {
          return [];
        }
        const sm = stateMethodName(xml);
        const pouName = path.basename(a.file).replace(/\.tcpou$/i, '');
        const isState = a.key ? a.key.toLowerCase() === `method:${sm.toLowerCase()}` : sm.toLowerCase() === pouName.toLowerCase();
        if (!isState) return [];
        return implementationOutline(doc.getText()).map((b) => {
          const line = doc.positionAt(b.start).line;
          return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: '$(type-hierarchy-sub) Show in statechart', tooltip: `${b.name}: selected in the POU's statechart`, command: 'kvalMachineScope.showStateInChart', arguments: [a.file, a.key, line] });
        });
      },
    }),
    vscode.languages.registerImplementationProvider({ scheme: SCHEME }, {
      provideImplementation(doc, pos) {
        const h = here(doc, pos);
        if (!h) return [];
        const files = projectFiles(h.a.file);
        return nav.implementations(files, { file: h.a.file, name: h.n.name }).map((l) => navLocation(files, l));
      },
    })
  );
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
  // Checks while typing (stChecks.cjs): a method's local never used (faded), a plain name declared nowhere in the
  // project (a typo?); kvalMachineScope.structuredText.checks switches them off
  const checks = vscode.languages.createDiagnosticCollection('TwinCAT checks');
  // (the names the project declares and its libraries' (their cache in _Libraries): read again at most each minute)
  const libraries = new Map();
  const knownNames = (file, files) => {
    const root = projectRootOf(file) ?? path.dirname(file);
    let l = libraries.get(root);
    if (!l || Date.now() - l.at > 60000) libraries.set(root, (l = { at: Date.now(), names: libraryNames(root) }));
    const names = projectNames(files);
    for (const n of l.names) names.add(n);
    return names;
  };
  context.subscriptions.push(checks);
  const textOf = (file, key, section) => {
    const open = vscode.workspace.textDocuments.find((d) => {
      if (d.uri.scheme !== SCHEME) return false;
      try {
        const a = addressOf(d.uri.query);
        return path.resolve(a.file).toLowerCase() === path.resolve(file).toLowerCase() && a.key === key && a.section === section;
      } catch {
        return false;
      }
    });
    if (open) return open.getText();
    try {
      return parseSource(fs.readFileSync(file, 'utf8')).members.find((m) => m.key === key)?.[section]?.text ?? '';
    } catch {
      return '';
    }
  };
  const checkTimers = new Map();
  const runChecks = (doc) => {
    if (doc.uri.scheme !== SCHEME) return;
    if (!vscode.workspace.getConfiguration('kvalMachineScope').get('structuredText.checks', true)) return checks.delete(doc.uri);
    let a;
    try {
      a = addressOf(doc.uri.query);
    } catch {
      return;
    }
    const files = projectFiles(a.file);
    const found = checkSection({
      section: a.section,
      text: doc.getText(),
      declText: a.section === 'impl' ? textOf(a.file, a.key, 'decl') : '',
      implText: a.section === 'decl' ? textOf(a.file, a.key, 'impl') : '',
      files,
      known: knownNames(a.file, files),
      baseUnknown: extendsUnknown(files, a.file),
    });
    checks.set(doc.uri, found.map((c) => {
      const d = new vscode.Diagnostic(new vscode.Range(c.line, c.column, c.line, c.column + c.length), c.message, c.kind === 'unused' ? vscode.DiagnosticSeverity.Hint : vscode.DiagnosticSeverity.Warning);
      d.source = 'TwinCAT';
      d.code = c.kind;
      if (c.kind === 'unused') d.tags = [vscode.DiagnosticTag.Unnecessary];
      return d;
    }));
  };
  const checkSoon = (doc) => {
    if (doc.uri.scheme !== SCHEME) return;
    clearTimeout(checkTimers.get(doc.uri.toString()));
    checkTimers.set(doc.uri.toString(), setTimeout(() => runChecks(doc), 400));
  };
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(checkSoon),
    vscode.workspace.onDidChangeTextDocument((e) => {
      checkSoon(e.document);
      // (a declaration changed: its implementation's checks again, and the other way)
      for (const d of vscode.workspace.textDocuments) if (d !== e.document && d.uri.scheme === SCHEME && d.uri.path.split('(')[0] === e.document.uri.path.split('(')[0]) checkSoon(d);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => checks.delete(d.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('kvalMachineScope.structuredText.checks')) for (const d of vscode.workspace.textDocuments) runChecks(d);
    })
  );
  for (const d of vscode.workspace.textDocuments) checkSoon(d);

  // IntelliSense: after a dot the members of the name's type, else the names visible here; parameter hints in a call
  const KIND = { variable: vscode.CompletionItemKind.Variable, field: vscode.CompletionItemKind.Field, enumMember: vscode.CompletionItemKind.EnumMember, method: vscode.CompletionItemKind.Method, property: vscode.CompletionItemKind.Property, event: vscode.CompletionItemKind.Event, class: vscode.CompletionItemKind.Class, struct: vscode.CompletionItemKind.Struct, enum: vscode.CompletionItemKind.Enum, interface: vscode.CompletionItemKind.Interface };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ scheme: SCHEME }, {
      provideCompletionItems(doc, pos) {
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return [];
        }
        return completionsAt(projectFiles(a.file), { file: a.file, key: a.key, section: a.section, text: doc.getText(), offset: doc.offsetAt(pos) }).map((c) => {
          const it = new vscode.CompletionItem(c.label, KIND[c.kind] ?? vscode.CompletionItemKind.Text);
          it.detail = c.detail;
          return it;
        });
      },
    }, '.'),
    vscode.languages.registerSignatureHelpProvider({ scheme: SCHEME }, {
      provideSignatureHelp(doc, pos) {
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return null;
        }
        const s = signatureAt(projectFiles(a.file), { file: a.file, key: a.key, text: doc.getText(), offset: doc.offsetAt(pos) });
        if (!s) return null;
        const label = `${s.name}(${s.params.map((p) => `${p.name} ${p.dir === 'VAR_OUTPUT' ? '=>' : ':='} ${p.type}`).join(', ')})`;
        const sig = new vscode.SignatureInformation(label);
        sig.parameters = s.params.map((p) => new vscode.ParameterInformation(`${p.name} ${p.dir === 'VAR_OUTPUT' ? '=>' : ':='} ${p.type}`, p.dir));
        const help = new vscode.SignatureHelp();
        help.signatures = [sig];
        help.activeSignature = 0;
        help.activeParameter = s.active;
        return help;
      },
    }, '(', ',')
  );
  // Hover: a name's declaration (its line, its comment) where it is declared (its member, its POU or its file)
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: SCHEME }, {
      provideHover(doc, pos) {
        let a;
        try {
          a = addressOf(doc.uri.query);
        } catch {
          return null;
        }
        const n = nameAt(doc.getText(), pos.line, pos.character);
        if (!n) return null;
        const files = projectFiles(a.file);
        const defs = findDefinition(files, { file: a.file, key: a.key, name: n.name, qualifier: n.qualifier });
        if (!defs.length) return null;
        const d = defs[0];
        const f = files.find((x) => x.file === d.file);
        const text = textOf(d.file, d.key, d.section).split(/\r?\n/)[d.line] ?? '';
        const where = `${f?.name ?? path.basename(d.file)}${d.key ? `.${d.key.replace(/^\w+:/, '')}` : ''}`;
        const md = new vscode.MarkdownString();
        md.appendCodeblock(text.trim(), doc.languageId);
        md.appendMarkdown(`*${d.section === 'decl' ? 'declared in' : 'in'} ${where}*${defs.length > 1 ? ` (and ${defs.length - 1} more)` : ''}`);
        return new vscode.Hover(md, doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/));
      },
    })
  );

  // Compare with Committed: the section as git's HEAD has it (its file's committed version), beside this one
  const GIT_SCHEME = 'twincat-st-git';
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GIT_SCHEME, {
      provideTextDocumentContent(uri) {
        const a = addressOf(uri.query);
        const dir = path.dirname(a.file);
        let xml = '';
        try {
          xml = require('child_process').execFileSync('git', ['-C', dir, 'show', `HEAD:./${path.basename(a.file)}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
          return `(not in git's HEAD: ${String(err?.stderr || err?.message || err).trim().split('\n')[0]})`;
        }
        return parseSource(xml).members.find((m) => m.key === a.key)?.[a.section]?.text ?? '(this section is not in the committed version)';
      },
    }),
    vscode.commands.registerCommand('kvalMachineScope.compareCommitted', async (uri) => {
      const u = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (!u || u.scheme !== SCHEME) return void vscode.window.showInformationMessage('Compare with Committed: open a TwinCAT section first');
      const left = u.with({ scheme: GIT_SCHEME });
      const doc = await vscode.workspace.openTextDocument(left);
      await setLanguage(doc).catch(() => {});
      await vscode.commands.executeCommand('vscode.diff', left, u, `${path.posix.basename(u.path)} (HEAD ↔ now)`);
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

// Run inside VS Code by st-editor.test.cjs (--extensionTestsPath): the checks, written to KSS_TEST_RESULT as
// [[ok, what], ...]
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(get, ms = 15000) {
  const until = Date.now() + ms;
  let v = await get();
  while (!v && Date.now() < until) {
    await sleep(200);
    v = await get();
  }
  return v;
}
const sections = () => vscode.window.visibleTextEditors.filter((e) => e.document.uri.scheme === 'twincat-st');
const sectionOf = (e) => new URLSearchParams(e.document.uri.query);
const cdataOf = (xml, key) => {
  // (the text between the member's first CDATA tags: a light reading, independent of the extension's parser)
  const at = key ? xml.indexOf(`Name="${key}"`) : 0;
  const decl = xml.indexOf('<Declaration><![CDATA[', at);
  return xml.slice(decl + 22, xml.indexOf(']]></Declaration>', decl));
};

exports.run = async function run() {
  const results = [];
  const expect = (c, w) => results.push([!!c, w]);
  try {
    const proj = process.env.KSS_TEST_PROJECT;
    const pou = path.join(proj, 'Robot', 'POUs', 'FB_ScanSequencer.TcPOU');
    const dutFile = path.join(proj, 'Robot', 'DUTs', 'E_ScanState.TcDUT');
    const ext = vscode.extensions.all.find((e) => e.id === 'kval.kval-machinescope-vscode');
    await ext?.activate();
    expect(ext?.isActive, `the extension active (${ext?.id ?? 'not found'})`);
    const original = fs.readFileSync(pou, 'utf8');
    // (the steps below on VS Code's own editors: a .TcPOU as sections; the code tab is looked at at the end)
    await vscode.workspace.getConfiguration('kvalMachineScope.structuredText').update('pouOpensAs', 'sections', vscode.ConfigurationTarget.Global);

    // 1. Opened (the default editor of .TcPOU): its declaration and implementation, in two groups, no XML
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pou));
    await waitFor(() => sections().length >= 2);
    const eds = sections();
    const decl = eds.find((e) => sectionOf(e).get('section') === 'decl');
    const impl = eds.find((e) => sectionOf(e).get('section') === 'impl');
    expect(decl && impl && decl.viewColumn !== impl.viewColumn, `opened: its declaration and implementation, each in a group of its own (${eds.map((e) => `${path.posix.basename(e.document.uri.path)}@${e.viewColumn}`).join(', ')})`);
    expect(decl && /FUNCTION_BLOCK FB_ScanSequencer/.test(decl.document.getText()) && !/<\?xml|CDATA|<POU/.test(decl.document.getText()), 'the declaration: Structured Text, no XML');
    expect(decl?.document.languageId === 'kval-st' && impl?.document.languageId === 'kval-st', `its language: Structured Text (${decl?.document.languageId})`);
    await sleep(500);
    const custom = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputCustom);
    expect(custom.length === 0, `no XML or placeholder tab left (${custom.map((t) => t.label).join(', ') || 'none'})`);
    expect(decl && path.posix.basename(decl.document.uri.path) === 'FB_ScanSequencer (Decl).st', `its tab: ${decl ? path.posix.basename(decl.document.uri.path) : '?'}`);

    // 2. Its declaration edited and saved: only that text in the file changes
    const add = '\r\n// added in VS Code';
    let we = new vscode.WorkspaceEdit();
    const declEnd = decl.document.lineAt(decl.document.lineCount - 1).range.end;
    we.insert(decl.document.uri, declEnd, add);
    await vscode.workspace.applyEdit(we);
    const saved = await decl.document.save();
    const after = fs.readFileSync(pou, 'utf8');
    expect(saved && after !== original && after.replace(add, '') === original && cdataOf(after, '').endsWith('// added in VS Code'), 'saved: only the declaration changed in the file (the Ids, BOM, CRLF and the rest as they were)');

    // 3. Both edited: the implementation saved after the declaration, no conflict
    we = new vscode.WorkspaceEdit();
    we.insert(decl.document.uri, new vscode.Position(0, 0), '// one\r\n');
    we.insert(impl.document.uri, new vscode.Position(0, 0), '// two\r\n');
    await vscode.workspace.applyEdit(we);
    const s1 = await decl.document.save();
    const s2 = await impl.document.save();
    const both = fs.readFileSync(pou, 'utf8');
    expect(s1 && s2 && both.includes('<![CDATA[// one\r\n') && both.includes('<![CDATA[// two\r\n'), 'two sections edited, saved one after the other: both in the file, no "file is newer"');

    // 4. Changed on disk (another program): the open declaration shows it
    fs.writeFileSync(pou, both.replace('// added in VS Code', '// changed on disk'), 'utf8');
    const reloaded = await waitFor(() => decl.document.getText().includes('// changed on disk'), 8000);
    expect(reloaded, 'changed on disk: the section shows it');

    // 5. A member: Execute()'s declaration and implementation
    await vscode.commands.executeCommand('kvalMachineScope.openMember', pou, 'Method:Execute');
    const ex = await waitFor(() => sections().find((e) => /Execute \(Impl\)\.st$/.test(e.document.uri.path)));
    expect(ex && /CASE State OF/.test(ex.document.getText()), `a method: Execute()'s implementation (${ex ? path.posix.basename(ex.document.uri.path) : 'not shown'})`);
    expect(sections().some((e) => /Execute \(Decl\)\.st$/.test(e.document.uri.path) && /METHOD Execute/.test(e.document.getText())), "and its declaration");

    // 6. The .TcDUT: its declaration only
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(dutFile));
    const dd = await waitFor(() => sections().find((e) => /E_ScanState \(Decl\)\.st$/.test(e.document.uri.path)));
    expect(dd && /TYPE E_ScanState/.test(dd.document.getText()), 'the .TcDUT: its declaration');

    // 7. Open as XML: the file itself, in the text editor
    await vscode.commands.executeCommand('kvalMachineScope.openXml', vscode.Uri.file(pou));
    const xmlEd = await waitFor(() => vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'file' && /FB_ScanSequencer\.TcPOU$/i.test(e.document.uri.fsPath)));
    expect(xmlEd && /<POU Name="FB_ScanSequencer"/.test(xmlEd.document.getText()), 'Open as XML: the file as it is');

    // 8. Build (XAE's stand-in, KSS_BUILD_DRYRUN): an error in Execute() in the Problems panel, on its section and line
    const exDoc = ex.document;
    we = new vscode.WorkspaceEdit();
    we.insert(exDoc.uri, new vscode.Position(0, 0), 'noSuchVar := 1;\r\n');
    await vscode.workspace.applyEdit(we);
    await exDoc.save();
    await vscode.window.showTextDocument(exDoc);
    await vscode.commands.executeCommand('kvalMachineScope.build');
    const problem = await waitFor(() => vscode.languages.getDiagnostics().find(([u, list]) => u.scheme === 'twincat-st' && /Execute \(Impl\)\.st$/.test(u.path) && list.some((d) => /noSuchVar/.test(d.message))), 20000);
    const diag = problem?.[1].find((d) => /noSuchVar/.test(d.message));
    expect(diag && diag.range.start.line === 0 && diag.severity === vscode.DiagnosticSeverity.Error && problem[0].toString() === exDoc.uri.toString(), `Build: the error on Execute()'s implementation, line 1 (${problem ? `${path.posix.basename(problem[0].path)}:${diag?.range.start.line + 1} ${diag?.message}` : vscode.languages.getDiagnostics().map(([u, l]) => `${u.scheme}:${path.posix.basename(u.path)}=${l.length}`).join(', ') || 'none'})`);

    // 9. Find All References and Go to Definition on "State" in Execute() (the provider VS Code asks)
    const exText = exDoc.getText().split(/\r?\n/);
    const caseLine = exText.findIndex((l) => /CASE State OF/.test(l));
    const statePos = new vscode.Position(caseLine, exText[caseLine].indexOf('State') + 2);
    const refs = (await vscode.commands.executeCommand('vscode.executeReferenceProvider', exDoc.uri, statePos)) ?? [];
    const declUri = refs.find((l) => /FB_ScanSequencer \(Decl\)\.st$/.test(l.uri.path));
    expect(refs.length > 5 && refs.some((l) => /Execute \(Impl\)\.st$/.test(l.uri.path)) && declUri, `Find All References: State, ${refs.length} uses (${[...new Set(refs.map((l) => path.posix.basename(l.uri.path)))].join(', ')})`);
    const defs = (await vscode.commands.executeCommand('vscode.executeDefinitionProvider', exDoc.uri, statePos)) ?? [];
    const d0 = defs[0];
    const defLine = d0 ? (await vscode.workspace.openTextDocument(d0.uri ?? d0.targetUri)).lineAt((d0.range ?? d0.targetRange).start.line).text : '';
    expect(defs.length === 1 && /^\s*State\s*:\s*E_ScanState/.test(defLine), `Go to Definition: State's declaration (${defLine.trim()})`);
    const qLine = exText.findIndex((l) => /E_ScanState\.\w+/.test(l));
    const qPos = new vscode.Position(qLine, exText[qLine].indexOf('E_ScanState.') + 'E_ScanState.'.length + 1);
    const qDefs = (await vscode.commands.executeCommand('vscode.executeDefinitionProvider', exDoc.uri, qPos)) ?? [];
    expect(qDefs.length === 1 && /E_ScanState \(Decl\)\.st$/.test((qDefs[0].uri ?? qDefs[0].targetUri).path), `Go to Definition after a dot: the enum's member (${qDefs.map((x) => path.posix.basename((x.uri ?? x.targetUri).path)).join(', ') || 'none'})`);

    // 10. Go to code (the statechart's): a place in the .TcPOU shown in its section, the caret there
    const xmlNow = fs.readFileSync(pou, 'utf8').split(/\r?\n/);
    const xLine = xmlNow.findIndex((l) => /CASE State OF/.test(l));
    const shown = await vscode.commands.executeCommand('kvalMachineScope.revealInSource', pou, xLine, xmlNow[xLine].indexOf('CASE'));
    const act = vscode.window.activeTextEditor;
    const at = require(path.join(__dirname, '..', '..', 'vscode-extension', 'tcStSource.cjs')).sectionAt(fs.readFileSync(pou, 'utf8'), xLine, xmlNow[xLine].indexOf('CASE'));
    expect(shown && act && /Execute \(Impl\)\.st$/.test(act.document.uri.path) && /CASE State OF/.test(act.document.lineAt(act.selection.active.line).text), `Go to code: Execute()'s implementation, at its line (${act ? `${path.posix.basename(act.document.uri.path)}:${act.selection.active.line + 1}` : 'none'}; the place: ${JSON.stringify(at)}; editors: ${vscode.window.visibleTextEditors.map((e) => `${path.posix.basename(e.document.uri.path)}@${e.viewColumn}:${e.selection.active.line + 1}`).join(', ')})`);

    // 11. The language setting: the open sections at once
    const cfg = vscode.workspace.getConfiguration('kvalMachineScope');
    await cfg.update('structuredText.language', 'plaintext', vscode.ConfigurationTarget.Global);
    const plain = await waitFor(() => sections().length && sections().every((e) => e.document.languageId === 'plaintext'), 5000);
    await cfg.update('structuredText.language', undefined, vscode.ConfigurationTarget.Global);
    const back = await waitFor(() => sections().every((e) => e.document.languageId === 'kval-st'), 5000);
    expect(plain && back, `the language setting: the open sections at once (plaintext ${!!plain}, back ${!!back})`);

    // 12. The outline: Execute()'s states; the FB's declaration with its blocks and variables
    const flat = (l, d = 0) => (l ?? []).flatMap((s) => [`${'  '.repeat(d)}${s.name}`, ...flat(s.children, d + 1)]);
    const exSyms = flat(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', exDoc.uri));
    expect(['InitializeScan', 'ResetData', 'FastScan'].every((n) => exSyms.includes(n)), `the outline of Execute(): its states (${exSyms.slice(0, 6).join(', ')})`);
    const declSyms = flat(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', decl.document.uri));
    expect(declSyms[0] === 'FB_ScanSequencer' && declSyms.includes('  VAR_OUTPUT') && declSyms.includes('    State'), `the outline of the declaration (${declSyms.slice(0, 5).join(' | ')})`);

    // 13. Rename (F2): _Count in Execute(): the POU's variable, in its sections only (the edit looked at, not made)
    const cLine = exText.findIndex((l) => /_Count\s*:=/.test(l));
    const renamed = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', exDoc.uri, new vscode.Position(cLine, exText[cLine].indexOf('_Count') + 1), '_Passes');
    const entries = renamed?.entries() ?? [];
    const edits = entries.flatMap(([u, list]) => list.map((e) => ({ name: path.posix.basename(u.path), text: e.newText })));
    expect(edits.length >= 2 && edits.every((e) => e.text === '_Passes' && /^FB_ScanSequencer/.test(e.name)) && edits.some((e) => e.name === 'FB_ScanSequencer (Decl).st'), `Rename _Count: ${edits.length} edits in ${[...new Set(edits.map((e) => e.name))].join(', ')}`);

    // 14. Live values (the stand-in PLC, KSS_LIVE_STANDIN): logged in, Execute()'s variables with their values;
    // a value changed on the PLC shows; logged out, none
    await vscode.window.showTextDocument(exDoc);
    await vscode.commands.executeCommand('kvalMachineScope.login');
    const shownOf = () => vscode.commands.executeCommand('kvalMachineScope.liveValuesShown', exDoc.uri.toString());
    const v1 = await waitFor(async () => { const s = await shownOf(); return s && s.State === 'FastScan' && s.Busy === 'TRUE' ? s : null; }, 8000);
    expect(v1, `logged in: the values shown (${JSON.stringify(await shownOf())})`);
    const standIn = JSON.parse(fs.readFileSync(process.env.KSS_LIVE_STANDIN, 'utf8'));
    standIn.symbols['MAIN.fbScan.State'].value = 5;
    fs.writeFileSync(process.env.KSS_LIVE_STANDIN, JSON.stringify(standIn));
    const v2 = await waitFor(async () => (await shownOf())?.State === 'ComputeResult', 8000);
    expect(v2, `a value changed on the PLC: shown (${JSON.stringify(await shownOf())})`);
    // Counts per state (every change followed), Notify When the PLC Enters This State (the caret in FastScan's branch)
    const fastLine = exDoc.getText().split(/\r?\n/).findIndex((l) => /E_ScanState\.FastScan\s*:/.test(l));
    const exEd2 = await vscode.window.showTextDocument(exDoc);
    exEd2.selection = new vscode.Selection(new vscode.Position(fastLine + 1, 2), new vscode.Position(fastLine + 1, 2));
    await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.stateStatsShown', exDoc.uri.toString())) !== null, 8000);
    const on = await vscode.commands.executeCommand('kvalMachineScope.notifyOnState');
    const setState = (v) => { const s = JSON.parse(fs.readFileSync(process.env.KSS_LIVE_STANDIN, 'utf8')); s.symbols['MAIN.fbScan.State'].value = v; fs.writeFileSync(process.env.KSS_LIVE_STANDIN, JSON.stringify(s)); };
    setState(3);
    await sleep(400);
    setState(5);
    await sleep(400);
    setState(3);
    const counted = await waitFor(async () => { const st = await vscode.commands.executeCommand('kvalMachineScope.stateStatsShown', exDoc.uri.toString()); return st?.fastscan?.n >= 1 && st?.computeresult?.n >= 1 ? st : null; }, 8000);
    const seen = await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.notificationsSeen')).find((x) => /entered FastScan/.test(x)), 5000);
    expect(on?.state === 'FastScan' && on.on && counted && seen, `counts per state (${JSON.stringify(counted)}), notified: ${seen ?? 'nothing'}`);
    setState(5);
    // Notify When TRUE: Busy (the caret on it): FALSE, then TRUE again, notified
    const busyAt = exDoc.getText().split(/\r?\n/).findIndex((l) => /\bBusy\b/.test(l));
    const exEd3 = await vscode.window.showTextDocument(exDoc);
    const bCol = exDoc.lineAt(busyAt).text.indexOf('Busy') + 1;
    exEd3.selection = new vscode.Selection(new vscode.Position(busyAt, bCol), new vscode.Position(busyAt, bCol));
    await sleep(800);
    const onTrue = await vscode.commands.executeCommand('kvalMachineScope.notifyWhenTrue');
    const setSym = (k, v) => { const s = JSON.parse(fs.readFileSync(process.env.KSS_LIVE_STANDIN, 'utf8')); s.symbols[k].value = v; fs.writeFileSync(process.env.KSS_LIVE_STANDIN, JSON.stringify(s)); };
    setSym('MAIN.fbScan.Busy', false);
    await sleep(400);
    setSym('MAIN.fbScan.Busy', true);
    const becameTrue = await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.notificationsSeen')).find((x) => /Busy became TRUE/.test(x)), 5000);
    expect(onTrue?.on && becameTrue, `Notify When TRUE: ${becameTrue ?? JSON.stringify(onTrue)}`);
    await vscode.commands.executeCommand('kvalMachineScope.clearNotifications');

    // The Solution view's tasks: PlcTask (10 ms, priority 20, calls MAIN), logged in: its last cycle's time
    const tk = await waitFor(async () => { const t = await vscode.commands.executeCommand('kvalMachineScope.tasksShown'); return t?.PlcTask?.execMs !== undefined ? t : null; }, 8000);
    expect(tk && tk.PlcTask.cycleMs === 10 && tk.PlcTask.priority === 20 && tk.PlcTask.calls.join() === 'MAIN' && Math.abs(tk.PlcTask.execMs - 0.0523) < 1e-9 && Math.abs(tk.PlcTask.maxMs - 0.0523) < 1e-9 && tk.PlcTask.index === 1 && tk.PlcTask.exceeded === false, `tasks: ${JSON.stringify(tk ?? (await vscode.commands.executeCommand('kvalMachineScope.tasksShown')))}`);
    const marked = await waitFor(async () => { const x = await vscode.commands.executeCommand('kvalMachineScope.activeStateShown', exDoc.uri.toString()); return x?.state === 'ComputeResult' ? x : null; }, 8000);
    expect(marked && /ComputeResult\s*:/.test(exDoc.lineAt(marked.line).text), `the PLC's state marked: its CASE branch (${JSON.stringify(marked)})`);
    // Write Values: Busy prepared FALSE (the caret on it), written: the PLC's value changes
    const busyLine = exText.findIndex((l) => /\bBusy\b/.test(l));
    const exEd = await vscode.window.showTextDocument(exDoc);
    const bPos = new vscode.Position(busyLine, exText[busyLine].indexOf('Busy') + 1);
    exEd.selection = new vscode.Selection(bPos, bPos);
    await vscode.commands.executeCommand('kvalMachineScope.prepareValue', { text: 'FALSE' });
    const wrote = await vscode.commands.executeCommand('kvalMachineScope.writeValues', { confirmed: true });
    const v4 = await waitFor(async () => (await shownOf())?.Busy === 'FALSE', 8000);
    const onPlc = JSON.parse(fs.readFileSync(process.env.KSS_LIVE_STANDIN, 'utf8')).symbols['MAIN.fbScan.Busy'].value;
    expect(wrote?.written === 1 && onPlc === false && v4, `Write Values: Busy := FALSE written (${JSON.stringify(wrote)}; on the PLC ${onPlc}; shown ${JSON.stringify(await shownOf())})`);
    // The Watch view: _Count by its full path, its value; written from there; the trend panel
    await vscode.commands.executeCommand('kvalMachineScope.addWatch', 'MAIN.fbScan._Count');
    const w1 = await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.watchShown'))?.['MAIN.fbScan._Count'] === '7', 8000);
    const wrote2 = await vscode.commands.executeCommand('kvalMachineScope.writeWatch', 'MAIN.fbScan._Count', { text: '9', confirmed: true });
    const w2 = await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.watchShown'))?.['MAIN.fbScan._Count'] === '9', 8000);
    expect(w1 && wrote2 && w2 && JSON.parse(fs.readFileSync(process.env.KSS_LIVE_STANDIN, 'utf8')).symbols['MAIN.fbScan._Count'].value === 9, `Watch: MAIN.fbScan._Count shown (7), written from there (9) (${JSON.stringify(await vscode.commands.executeCommand('kvalMachineScope.watchShown'))})`);
    await vscode.commands.executeCommand('kvalMachineScope.showTrend');
    const trendTab = await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'TwinCAT Trend'), 5000);
    expect(trendTab, 'the trend panel opened');
    if (trendTab) await vscode.window.tabGroups.close(trendTab);
    await vscode.window.showTextDocument(exDoc);
    await vscode.commands.executeCommand('kvalMachineScope.logout');
    const v3 = await waitFor(async () => (await shownOf()) === null, 8000);
    expect(v3, `logged out: no values (${JSON.stringify(await shownOf())})`);

    // 15. Checks while typing: noSuchVar (the build step's line) flagged as declared nowhere
    const flagged = await waitFor(() => vscode.languages.getDiagnostics(exDoc.uri).find((d) => d.source === 'TwinCAT' && d.code === 'undeclared' && /noSuchVar/.test(d.message)), 8000);
    expect(flagged && flagged.range.start.line === 0, `checks: noSuchVar is not declared (${flagged ? flagged.message : vscode.languages.getDiagnostics(exDoc.uri).map((d) => d.message).join('; ') || 'none'})`);

    // 15b. Auto Declare: the Quick Fixes on noSuchVar (declared in Execute()'s VAR first); Format Document
    const fixes = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', exDoc.uri, flagged ? flagged.range : new vscode.Range(0, 0, 0, 0), vscode.CodeActionKind.QuickFix.value);
    const declareFix = (fixes ?? []).find((f) => /^Declare noSuchVar : \w+ in Execute\(\)'s VAR$/.test(f.title));
    expect(declareFix && (fixes ?? []).some((f) => /in FB_ScanSequencer's VAR_INPUT/.test(f.title)), `Auto Declare: the Quick Fixes (${(fixes ?? []).map((f) => f.title).slice(0, 4).join(' | ')})`);
    if (declareFix?.edit) await vscode.workspace.applyEdit(declareFix.edit);
    const exDecl = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'twincat-st' && /Execute \(Decl\)\.st$/.test(d.uri.path));
    expect(exDecl && /noSuchVar : \w+;/.test(exDecl.getText()), `declared in Execute()'s declaration (${exDecl ? exDecl.getText().split(/\r?\n/).filter((l) => /noSuchVar/.test(l)).join('') : 'not open'})`);
    const gone = await waitFor(() => !vscode.languages.getDiagnostics(exDoc.uri).some((d) => d.code === 'undeclared' && /noSuchVar/.test(d.message)), 8000);
    expect(gone, 'the finding gone once declared');
    const fmt = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', exDoc.uri, { insertSpaces: false, tabSize: 4 });
    expect(Array.isArray(fmt), `Format Document: ${fmt?.length ?? 'no'} line(s) re-indented`);

    // 15c. Reads and writes: State's places in Execute() highlighted (CASE State OF: read; State := …: write);
    // Find All Writes: its assignments
    const hl = await vscode.commands.executeCommand('vscode.executeDocumentHighlights', exDoc.uri, statePos);
    const kinds = new Set((hl ?? []).map((x) => x.kind));
    expect(kinds.has(vscode.DocumentHighlightKind.Write) && kinds.has(vscode.DocumentHighlightKind.Read), `State highlighted: written and read (${(hl ?? []).length} places)`);
    const writes = await vscode.commands.executeCommand('kvalMachineScope.findWrites', exDoc.uri, statePos);
    const writeLines = [];
    for (const l of writes ?? []) writeLines.push((await vscode.workspace.openTextDocument(l.uri)).lineAt(l.range.start.line).text.trim());
    expect(writeLines.length > 0 && writeLines.every((x) => /State\s*:=|=>\s*State/.test(x)), `Find All Writes: ${writeLines.length} (${writeLines.slice(0, 3).join(' | ')})`);

    // The Cross Reference List: every place of State by POU and member, each declaration / write / read; Writes only
    const xr = await vscode.commands.executeCommand('kvalMachineScope.crossReference', exDoc.uri, statePos);
    const xrRefs = (xr?.groups ?? []).flatMap((g) => g.members.flatMap((m) => m.refs));
    expect(xr?.name === 'State' && xrRefs.some((r) => /:declaration$/.test(r)) && xrRefs.filter((r) => /:write$/.test(r)).length === writeLines.length && xrRefs.some((r) => /:read$/.test(r)), `Cross Reference: ${xrRefs.length} places of State (${JSON.stringify(xr?.groups?.[0]?.members?.map((m) => m.label))})`);
    const xw = await vscode.commands.executeCommand('kvalMachineScope.crossReferenceFilter', 'writes');
    const xwRefs = (xw?.groups ?? []).flatMap((g) => g.members.flatMap((m) => m.refs));
    expect(xwRefs.length === writeLines.length && xwRefs.every((r) => /:write$/.test(r)), `Cross Reference, Writes: ${xwRefs.join(', ')}`);
    await vscode.commands.executeCommand('kvalMachineScope.crossReferenceFilter', 'all');

    // 16. IntelliSense: after "E_ScanState." the enum's members; in MoveAndAdvance( its parameters
    const now = exDoc.getText().split(/\r?\n/);
    const qL = now.findIndex((l) => /E_ScanState\.\w+/.test(l));
    const qC = now[qL].indexOf('E_ScanState.') + 'E_ScanState.'.length;
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', exDoc.uri, new vscode.Position(qL, qC), '.');
    const labels = (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    expect(['InitializeScan', 'FastScan', 'ComputeResult'].every((n) => labels.includes(n)), `completion after E_ScanState.: its members (${labels.slice(0, 6).join(', ')})`);
    const mL = now.findIndex((l) => /MoveAndAdvance\(/.test(l));
    const mC = now[mL].indexOf('MoveAndAdvance(') + 'MoveAndAdvance('.length;
    const help = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', exDoc.uri, new vscode.Position(mL, mC), '(');
    expect(help?.signatures?.[0] && /ProgramNumber/.test(help.signatures[0].label), `parameter hints in MoveAndAdvance( (${help?.signatures?.[0]?.label ?? 'none'})`);

    // 17. Hover: State's declaration
    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', exDoc.uri, statePos);
    const hoverText = (hovers ?? []).flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value))).join('\n');
    expect(/State\s*:\s*E_ScanState/.test(hoverText) && /declared in FB_ScanSequencer/.test(hoverText), `hover: State's declaration (${hoverText.replace(/\s+/g, ' ').slice(0, 120)})`);

    // 18. Compare with Committed: git's HEAD (the project as committed by the test) beside the section now
    await vscode.window.showTextDocument(exDoc);
    await vscode.commands.executeCommand('kvalMachineScope.compareCommitted', exDoc.uri);
    const committed = await waitFor(() => vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'twincat-st-git' && /Execute \(Impl\)\.st$/.test(d.uri.path)), 5000);
    expect(committed && /CASE State OF/.test(committed.getText()) && !/noSuchVar/.test(committed.getText()) && /noSuchVar/.test(exDoc.getText()), `Compare with Committed: HEAD's Execute() (without the edits) beside it (${committed ? committed.getText().split(/\r?\n/)[0] : 'not opened'})`);

    // Compare with Saved (the edits not saved yet beside the file's text) and All Changes (every section with them)
    const dirtyNow = exDoc.isDirty;
    if (!dirtyNow) {
      const ed = await vscode.window.showTextDocument(exDoc);
      await ed.edit((e) => e.insert(new vscode.Position(0, 0), '// an unsaved note\n'));
    }
    const cs = await vscode.commands.executeCommand('kvalMachineScope.compareSaved', exDoc.uri);
    const savedSide = await waitFor(() => vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'twincat-st-saved' && /Execute \(Impl\)\.st$/.test(d.uri.path)), 5000);
    expect(exDoc.isDirty && savedSide && savedSide.getText() !== exDoc.getText() && cs?.added > 0, `Compare with Saved: the saved Execute() beside the edits (${JSON.stringify(cs)}; it was ${dirtyNow ? 'dirty' : 'made dirty'})`);
    const allCh = (await vscode.commands.executeCommand('kvalMachineScope.allChanges', { quiet: true })) ?? [];
    expect(allCh.some((x) => /Execute \(Impl\)/.test(x.label) && x.added > 0), `All Changes: ${JSON.stringify(allCh)}`);
    for (const t of vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => /saved ↔ now|All Changes/.test(t.label))) await vscode.window.tabGroups.close(t);

    // 19. Add Method / Add POU (their answers given): the method in the file, opened; the POU file and the .plcproj
    const added = await vscode.commands.executeCommand('kvalMachineScope.addMethod', { name: 'Reset', type: '' });
    const pouNow = fs.readFileSync(pou, 'utf8');
    expect(added === 'Reset' && /<Method Name="Reset" Id="\{[0-9a-f-]{36}\}">/.test(pouNow) && sections().some((e) => /Reset \(Decl\)\.st$/.test(e.document.uri.path)), 'Add Method: Reset in the POU, opened');
    const newFile = await vscode.commands.executeCommand('kvalMachineScope.addPou', undefined, { kind: 'Function Block', name: 'FB_Added' });
    const plcprojText = fs.readFileSync(path.join(proj, 'Robot', 'Robot.plcproj'), 'utf8');
    expect(newFile && fs.existsSync(newFile) && /<Compile Include="POUs\\FB_Added\.TcPOU">/.test(plcprojText), `Add POU: FB_Added.TcPOU and the .plcproj (${newFile})`);

    // 19-lib. The Library Manager (References): a library added from a repository, its version set, removed
    const repo = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kss-repo-'));
    const vendor = 'Beckhoff Automation GmbH';
    for (const v of ['3.3.59.0', '3.3.100.0']) fs.mkdirSync(path.join(repo, vendor, 'Tc2_Utilities', v), { recursive: true });
    process.env.KSS_LIBRARY_REPOSITORIES = repo;
    const robotProj = path.join(proj, 'Robot', 'Robot.plcproj');
    const libsNow = () => require(path.join(__dirname, '..', '..', 'vscode-extension', 'plcTree.cjs')).readLibraries(robotProj);
    await vscode.commands.executeCommand('kvalMachineScope.addLibrary', { plcproj: robotProj }, { name: 'Tc2_Utilities' , version: '*' });
    let util = libsNow().find((l) => l.name === 'Tc2_Utilities');
    expect(util && util.version === '*' && util.used === '3.3.100.0' && /<PlaceholderReference Include="Tc2_Utilities">/.test(fs.readFileSync(robotProj, 'utf8')), `Add Library: Tc2_Utilities, the newest (${JSON.stringify(util)})`);
    await vscode.commands.executeCommand('kvalMachineScope.setLibraryVersion', { lib: util, plcproj: robotProj }, '3.3.59.0');
    util = libsNow().find((l) => l.name === 'Tc2_Utilities');
    expect(util && util.version === '3.3.59.0' && util.used === '3.3.59.0', `Set Version: 3.3.59.0 (${util?.version})`);
    await vscode.commands.executeCommand('kvalMachineScope.removeLibrary', { lib: util, plcproj: robotProj }, true);
    expect(!libsNow().some((l) => l.name === 'Tc2_Utilities') && /<Compile Include="POUs\\FB_Added\.TcPOU">/.test(fs.readFileSync(robotProj, 'utf8')), 'Remove Library: gone, the rest of the .plcproj kept');
    delete process.env.KSS_LIBRARY_REPOSITORIES;
    fs.rmSync(repo, { recursive: true, force: true });

    // 19-oc. Online Change Details: the PLC's project (a test's: this one with the POU's declaration as it was, and a
    // POU only on the PLC) compared with this one: in the Online Change view, by kind, each a click from its code
    const { localProjectFiles } = require(path.join(__dirname, '..', '..', 'shared', 'onlineChangeCheck.cjs'));
    const pouName = path.basename(pou, '.TcPOU');
    const plcSide = localProjectFiles(robotProj).map((x) => {
      if (path.basename(x.path).toLowerCase() !== path.basename(pou).toLowerCase()) return x;
      const end = x.content.indexOf(']]>');
      return { ...x, content: `${x.content.slice(0, end)}\nVAR\n\tnOld : INT;\nEND_VAR\n${x.content.slice(end)}` };
    });
    plcSide.push({ path: 'POUs/FB_Gone.TcPOU', content: '<TcPlcObject><POU Name="FB_Gone"><Declaration><![CDATA[FUNCTION_BLOCK FB_Gone]]></Declaration></POU></TcPlcObject>' });
    const ocLines = await vscode.commands.executeCommand('kvalMachineScope.onlineChangeDetails', plcSide);
    const ocShown = (await vscode.commands.executeCommand('kvalMachineScope.onlineChangeShown')) ?? {};
    const oc = ocShown.groups ?? [];
    const ocDecl = oc.find((g) => g.label === 'Declarations changed');
    expect(!!ocDecl && ocDecl.items.some((i) => i.label === pouName && i.opens) && oc.find((g) => g.label === 'Removed')?.items.some((i) => i.label === 'FB_Gone'), `Online Change Details: ${pouName}'s declaration changed (opens it), FB_Gone removed (${JSON.stringify(oc)})`);
    expect(Array.isArray(ocLines) && ocLines.some((l) => /^Declarations changed/.test(l)), `its lines for the confirmation (${(ocLines ?? []).join(' | ')})`);
    // (a task changed on the PLC's side: a warning, counted on the view, said on the PLC's status bar item)
    const ttoAt = plcSide.findIndex((x) => /\.TcTTO$/i.test(x.path));
    const withTask = ttoAt >= 0 ? plcSide.map((x, i) => (i === ttoAt ? { ...x, content: x.content.replace(/<CycleTime>\d+<\/CycleTime>/, '<CycleTime>99000</CycleTime>') } : x)) : [...plcSide, { path: 'PlcTask.TcTTO', content: '<TcPlcObject><Task Name="PlcTask"><CycleTime>99000</CycleTime><Priority>20</Priority></Task></TcPlcObject>' }];
    await vscode.commands.executeCommand('kvalMachineScope.onlineChangeDetails', withTask);
    const warned = (await vscode.commands.executeCommand('kvalMachineScope.onlineChangeShown')) ?? {};
    expect(warned.badge >= 1 && /\$\(warning\)/.test(warned.plcBar ?? '') && (warned.groups ?? []).some((g) => g.label === 'Tasks changed'), `a task changed: the view's badge ${warned.badge}, the PLC's status bar item "${warned.plcBar}"`);
    await vscode.commands.executeCommand('kvalMachineScope.onlineChangeDetails', localProjectFiles(robotProj));
    const clean = (await vscode.commands.executeCommand('kvalMachineScope.onlineChangeShown')) ?? {};
    expect(!clean.badge && !/\$\(warning\)/.test(clean.plcBar ?? ''), `nothing changed: no badge, no warning (${clean.badge}, "${clean.plcBar}")`);

    // 19a. Show in statechart: a lens over each state's branch of Execute() (the state method); one opens the chart
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', exDoc.uri);
    const stateLenses = (lenses ?? []).filter((l) => l.command?.command === 'kvalMachineScope.showStateInChart');
    expect(stateLenses.length >= 5 && /InitializeScan/.test(exDoc.lineAt(stateLenses[0].range.start.line).text), `Show in statechart: ${stateLenses.length} lenses, the first on InitializeScan`);
    const shownChart = stateLenses[0] ? await vscode.commands.executeCommand(stateLenses[0].command.command, ...stateLenses[0].command.arguments) : false;
    const chartTab = await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => /statechart/.test(t.label)), 8000);
    expect(shownChart === true && chartTab, `Show in statechart: the chart opened (${chartTab?.label ?? 'none'})`);
    if (chartTab) await vscode.window.tabGroups.close(chartTab);
    await vscode.window.showTextDocument(exDoc);

    // 19c. Semantic colours: E_ScanState's members in Execute() as enum members
    const legend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', exDoc.uri);
    const sem = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', exDoc.uri);
    const kindsSeen = new Set();
    if (sem?.data && legend) for (let i = 0; i + 4 < sem.data.length; i += 5) kindsSeen.add(legend.tokenTypes[sem.data[i + 3]]);
    expect(kindsSeen.has('enumMember') && kindsSeen.has('enum'), `semantic colours: ${[...kindsSeen].join(', ') || 'none'}`);

    // 19b. Navigation: the project's symbols (Ctrl+T), the calls of MoveAndAdvance (Shift+Alt+H), the type hierarchy
    const syms = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'MoveAndAdv');
    expect((syms ?? []).some((x) => x.name === 'MoveAndAdvance' && x.containerName === 'FB_ScanSequencer'), `workspace symbols: MoveAndAdvance in FB_ScanSequencer (${(syms ?? []).map((x) => `${x.containerName}.${x.name}`).slice(0, 5).join(', ')})`);
    const callNow = exDoc.getText().split(/\r?\n/);
    const cL = callNow.findIndex((l) => /MoveAndAdvance\(/.test(l));
    const callItems = await vscode.commands.executeCommand('vscode.prepareCallHierarchy', exDoc.uri, new vscode.Position(cL, callNow[cL].indexOf('MoveAndAdvance') + 2));
    const incoming = callItems?.[0] ? await vscode.commands.executeCommand('vscode.provideIncomingCalls', callItems[0]) : [];
    expect(callItems?.[0]?.name === 'MoveAndAdvance' && (incoming ?? []).some((c) => c.from.name === 'Execute'), `call hierarchy: MoveAndAdvance called from Execute (${(incoming ?? []).map((c) => c.from.name).join(', ') || 'none'})`);
    const typeItems = await vscode.commands.executeCommand('vscode.prepareTypeHierarchy', exDoc.uri, new vscode.Position(0, 0));
    expect(typeItems?.[0]?.name === 'FB_ScanSequencer', `type hierarchy: the POU (${typeItems?.[0]?.name ?? 'none'})`);

    // 19c2. Bookmarks (the sections): a line of Execute() and a CASE label (its state) toggled, marked; Next; kept as
    // MachineScope's (the statechart and the code tab get them)
    const bmEd = await vscode.window.showTextDocument(exDoc);
    const bmLines = exDoc.getText().split(/\r?\n/);
    const plainLine = bmLines.findIndex((l) => /_Count\s*:=\s*_Count/.test(l));
    const labelLine = bmLines.findIndex((l) => /E_ScanState\.FastScan\s*:/.test(l));
    bmEd.selection = new vscode.Selection(new vscode.Position(plainLine, 0), new vscode.Position(plainLine, 0));
    const t1 = await vscode.commands.executeCommand('kvalMachineScope.toggleBookmark');
    bmEd.selection = new vscode.Selection(new vscode.Position(labelLine, 0), new vscode.Position(labelLine, 0));
    const t2 = await vscode.commands.executeCommand('kvalMachineScope.toggleBookmark');
    await sleep(300);
    const marks = await vscode.commands.executeCommand('kvalMachineScope.bookmarksShown', exDoc.uri.toString());
    const stored = await vscode.commands.executeCommand('kvalMachineScope.bookmarksOf', pou);
    expect(t1?.on && t2?.state === 'FastScan' && (marks ?? []).includes(plainLine + 1) && (marks ?? []).includes(labelLine + 1) && stored.states.includes('FastScan') && stored.lines.some((l) => l.method === 'Execute'), `bookmarks: a line and FastScan's label marked (${JSON.stringify(marks)}; ${JSON.stringify(stored)})`);
    bmEd.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
    const n1 = await vscode.commands.executeCommand('kvalMachineScope.nextBookmark');
    expect(n1 === Math.min(plainLine, labelLine) + 1 && bmEd.selection.active.line === n1 - 1, `Next Bookmark: line ${n1}`);

    // 19d. The code tab (pouOpensAs: tab, the default): the POU in one tab (MachineScope's code editors); a member
    // from the POU list shown in that same tab
    await vscode.workspace.getConfiguration('kvalMachineScope.structuredText').update('pouOpensAs', 'tab', vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pou));
    const tabbed = await waitFor(async () => { const t = await vscode.commands.executeCommand('kvalMachineScope.codeTabsShown'); return Object.keys(t ?? {}).length ? t : null; }, 10000);
    const codeTab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.input instanceof vscode.TabInputCustom && x.input.viewType === 'kvalMachineScope.code');
    expect(tabbed && tabbed['fb_scansequencer.tcpou'] === '' && codeTab && sections().length === 0, `the code tab: ${JSON.stringify(tabbed)} (${codeTab?.label ?? 'no tab'}; sections ${sections().length})`);
    await vscode.commands.executeCommand('kvalMachineScope.openMember', pou, 'Method:Execute');
    const switched = await waitFor(async () => (await vscode.commands.executeCommand('kvalMachineScope.codeTabsShown'))?.['fb_scansequencer.tcpou'] === 'Execute', 5000);
    const codeTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((x) => x.input instanceof vscode.TabInputCustom && x.input.viewType === 'kvalMachineScope.code');
    expect(switched && codeTabs.length === 1, `a member: the same tab, Execute shown (${codeTabs.map((x) => x.label).join(', ')}; ${switched})`);
    await vscode.commands.executeCommand('kvalMachineScope.openSections', vscode.Uri.file(pou));
    expect(await waitFor(() => sections().length >= 2, 8000), 'Open as Sections: VS Code\'s editors');
    await vscode.workspace.getConfiguration('kvalMachineScope.structuredText').update('pouOpensAs', undefined, vscode.ConfigurationTarget.Global);

    // 20. The TwinCAT commands (XAE's toolbar) are there
    const cmds = await vscode.commands.getCommands(true);
    // What's New: the features since a commit of the history (the extension run from its sources: from git), in a panel
    const history = require(path.join(__dirname, '..', '..', 'scripts', 'release-plan.cjs')).vscodeFeatures();
    const wn = history.length > 3 ? await vscode.commands.executeCommand('kvalMachineScope.whatsNew', history[3].hash) : null;
    const wnTab = await waitFor(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => /What's New/.test(t.label)), 5000);
    expect(history.every((c) => c.changes.some((x) => x.kind === 'feat')) && wn?.items === 3 && wn.sinceSeen && wnTab, `What's New: the 3 features since ${history[3]?.hash} in its panel (${JSON.stringify(wn)}, ${wnTab?.label})`);
    if (wnTab) await vscode.window.tabGroups.close(wnTab);
    const want = ['build', 'login', 'logout', 'start', 'stop', 'pickTarget', 'pickBuild', 'goToMember', 'openStructuredText', 'openXml', 'buildOnlineChange', 'prepareValue', 'writeValues', 'pickInstance', 'refreshSolution', 'addLibrary', 'setLibraryVersion', 'removeLibrary', 'onlineChangeDetails', 'crossReference', 'whatsNew', 'compareSaved', 'allChanges'].map((c) => `kvalMachineScope.${c}`);
    expect(want.every((c) => cmds.includes(c)), `the TwinCAT commands (${want.filter((c) => !cmds.includes(c)).join(', ') || 'all there'})`);
  } catch (err) {
    results.push([false, `threw: ${err?.stack ?? err}`]);
  }
  fs.writeFileSync(process.env.KSS_TEST_RESULT, JSON.stringify(results, null, 1));
};

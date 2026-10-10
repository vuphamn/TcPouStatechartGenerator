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

    // 9. The TwinCAT commands (XAE's toolbar) are there
    const cmds = await vscode.commands.getCommands(true);
    const want = ['build', 'login', 'logout', 'start', 'stop', 'pickTarget', 'pickBuild', 'goToMember', 'openStructuredText', 'openXml'].map((c) => `kvalMachineScope.${c}`);
    expect(want.every((c) => cmds.includes(c)), `the TwinCAT commands (${want.filter((c) => !cmds.includes(c)).join(', ') || 'all there'})`);
  } catch (err) {
    results.push([false, `threw: ${err?.stack ?? err}`]);
  }
  fs.writeFileSync(process.env.KSS_TEST_RESULT, JSON.stringify(results, null, 1));
};

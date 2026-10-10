// Add POU… / Add DUT… (the Solution view: on its PLC project or a folder) and Add Method… / Add Property… (the active
// POU), as XAE's Add menu: the file written (tcCreate.cjs), the .plcproj told, the new object opened as Structured
// Text. A project open in XAE asks to reload it then.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { checkName, newPouXml, newDutXml, addMethod, addProperty, addToPlcproj } = require('./tcCreate.cjs');
const { plcProjectsUnder } = require('./plcTree.cjs');

function registerCreate(context, { activeFile, projectOf, currentProject, openMember, refreshSolution }) {
  /** The PLC project and folder an Add goes to: the Solution view's node, else the active file's PLC project */
  async function targetOf(node, defaultFolder) {
    let plcproj = node?.plcproj ?? null;
    let folder = node?.children ? node.path ?? '' : defaultFolder;
    if (!plcproj) {
      const p = currentProject() ?? projectOf(activeFile() ?? '');
      if (!p) throw new Error('Open a file of a TwinCAT project first');
      const all = plcProjectsUnder(p.root);
      plcproj = p.plcproj && all.some((x) => x.toLowerCase() === p.plcproj.toLowerCase()) ? p.plcproj : all[0];
      if (all.length > 1 && !p.plcproj) {
        const picked = await vscode.window.showQuickPick(all.map((x) => ({ label: path.basename(x, '.plcproj'), x })), { placeHolder: 'Which PLC project?' });
        if (!picked) return null;
        plcproj = picked.x;
      }
    }
    if (!plcproj) throw new Error('No PLC project (.plcproj) in this project');
    return { plcproj, folder };
  }
  const askName = (what, dir, ext) =>
    vscode.window.showInputBox({
      prompt: `The new ${what}'s name`,
      validateInput: (v) => checkName(v) ?? (dir && fs.existsSync(path.join(dir, `${v}.${ext}`)) ? `${v}.${ext} is there already` : null),
    });

  // (given: the answers, without asking: { kind, name, returnType } (the tests))
  async function addFile(kind, node, given = {}) {
    const isDut = kind === 'DUT';
    const t = await targetOf(node, isDut ? 'DUTs' : 'POUs');
    if (!t) return;
    const which = given.kind ?? (await vscode.window.showQuickPick(isDut ? ['Struct', 'Enum', 'Alias'] : ['Function Block', 'Program', 'Function'], { placeHolder: `The new ${isDut ? 'DUT' : 'POU'}: its kind` }));
    if (!which) return;
    const dir = path.join(path.dirname(t.plcproj), ...String(t.folder || '').split(/[\\/]/).filter(Boolean));
    const ext = isDut ? 'TcDUT' : 'TcPOU';
    const name = given.name ?? (await askName(which, dir, ext));
    if (!name) return;
    if (checkName(name) || fs.existsSync(path.join(dir, `${name}.${ext}`))) throw new Error(`${name}: ${checkName(name) ?? `${name}.${ext} is there already`}`);
    let xml;
    if (isDut) {
      const members = which === 'Enum' ? ['Idle'] : which === 'Struct' ? ['bValue : BOOL'] : [];
      xml = newDutXml(which.toUpperCase(), name, { members });
    } else {
      const k = which === 'Function Block' ? 'FUNCTION_BLOCK' : which.toUpperCase();
      const returnType = k === 'FUNCTION' ? given.returnType ?? (await vscode.window.showInputBox({ prompt: `${name}'s return type`, value: 'BOOL' })) : undefined;
      if (k === 'FUNCTION' && !returnType) return;
      xml = newPouXml(k, name, { returnType });
    }
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.${ext}`);
    fs.writeFileSync(file, xml, 'utf8');
    const rel = path.relative(path.dirname(t.plcproj), file);
    fs.writeFileSync(t.plcproj, addToPlcproj(fs.readFileSync(t.plcproj, 'utf8'), rel), 'utf8');
    refreshSolution();
    await openMember(file, '');
    void vscode.window.showInformationMessage(`Added ${rel} to ${path.basename(t.plcproj)} (a project open in TwinCAT XAE asks to reload it)`);
    return file;
  }

  async function addMember(kind, given = {}) {
    const file = activeFile();
    if (!file || !/\.tcpou$/i.test(file)) throw new Error(`Add ${kind}: open a POU first (a .TcPOU's section)`);
    const name = given.name ?? (await vscode.window.showInputBox({ prompt: `The new ${kind.toLowerCase()}'s name`, validateInput: (v) => checkName(v) }));
    if (!name) return;
    if (checkName(name)) throw new Error(`${name}: ${checkName(name)}`);
    const type = given.type ?? await vscode.window.showInputBox({ prompt: kind === 'Method' ? `${name}'s return type (empty: none)` : `${name}'s type`, value: kind === 'Method' ? '' : 'BOOL' });
    if (type === undefined) return;
    const xml = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, kind === 'Method' ? addMethod(xml, name, { returnType: type.trim() }) : addProperty(xml, name, { type: type.trim() || 'BOOL' }), 'utf8');
    await openMember(file, kind === 'Method' ? `Method:${name}` : `Property:${name}.Get`);
    return name;
  }

  const guard = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      void vscode.window.showErrorMessage(`TwinCAT: ${err?.message ?? err}`);
      return undefined;
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.addPou', guard((node, given) => addFile('POU', node, given))),
    vscode.commands.registerCommand('kvalMachineScope.addDut', guard((node, given) => addFile('DUT', node, given))),
    vscode.commands.registerCommand('kvalMachineScope.addMethod', guard((given) => addMember('Method', given))),
    vscode.commands.registerCommand('kvalMachineScope.addProperty', guard((given) => addMember('Property', given)))
  );
}

module.exports = { registerCreate };

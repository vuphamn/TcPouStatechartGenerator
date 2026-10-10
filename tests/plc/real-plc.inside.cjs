// Run inside VS Code by real-plc.test.cjs (no stand-in): the test project's FB_TestCycle opened, Login (the PLC runs its latest build: logged in,
// no question), its live values, Write Values (bStart := TRUE), Logout
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(get, ms = 15000) {
  const until = Date.now() + ms;
  let v = await get();
  while (!v && Date.now() < until) {
    await sleep(250);
    v = await get();
  }
  return v;
}
exports.run = async () => {
  const results = [];
  const expect = (c, w) => results.push([!!c, w]);
  try {
    const pou = path.join(process.env.KSS_TEST_PROJECT, 'KssLocalTest', 'KssPlc', 'POUs', 'FB_TestCycle.TcPOU');
    await vscode.extensions.all.find((e) => e.id === 'kval.kval-machinescope-vscode')?.activate();
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(pou));
    const impl = await waitFor(() => vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'twincat-st' && /FB_TestCycle \(Impl\)\.st$/.test(e.document.uri.path)));
    expect(impl, 'FB_TestCycle opened as Structured Text');
    await vscode.window.showTextDocument(impl.document);
    await vscode.commands.executeCommand('kvalMachineScope.login');
    const shown = () => vscode.commands.executeCommand('kvalMachineScope.liveValuesShown', impl.document.uri.toString());
    const v1 = await waitFor(async () => { const s = await shown(); return s && s.State ? s : null; }, 20000);
    expect(v1 && v1.State === 'Idle' && v1.bBusy === 'FALSE', `logged in (no question: the PLC runs the latest build), live values: ${JSON.stringify(v1)}`);
    // Write Values: bStart := TRUE (the caret on it)
    const lines = impl.document.getText().split(/\r?\n/);
    const l = lines.findIndex((x) => /IF bStart THEN/.test(x));
    const ed = await vscode.window.showTextDocument(impl.document);
    const pos = new vscode.Position(l, lines[l].indexOf('bStart') + 2);
    ed.selection = new vscode.Selection(pos, pos);
    await vscode.commands.executeCommand('kvalMachineScope.prepareValue', { text: 'TRUE' });
    const w = await vscode.commands.executeCommand('kvalMachineScope.writeValues', { confirmed: true });
    const v2 = await waitFor(async () => { const s = await shown(); return s?.State === 'Running' ? s : null; }, 8000);
    expect(w?.written === 1 && v2, `Write Values: bStart := TRUE written, State Running (${JSON.stringify(await shown())})`);
    const v3 = await waitFor(async () => { const s = await shown(); return s?.State === 'Done' ? s : null; }, 8000);
    expect(v3, `after its timer: Done (${JSON.stringify(await shown())})`);
    // (put back)
    await vscode.commands.executeCommand('kvalMachineScope.prepareValue', { text: 'FALSE' });
    await vscode.commands.executeCommand('kvalMachineScope.writeValues', { confirmed: true });
    const v4 = await waitFor(async () => { const s = await shown(); return s?.State === 'Idle' ? s : null; }, 8000);
    expect(v4, `bStart := FALSE: Idle (${JSON.stringify(await shown())})`);
    // (the Watch view: nCycles by its full path)
    await vscode.commands.executeCommand('kvalMachineScope.addWatch', 'MAIN.fbTest.nCycles');
    const wv = await waitFor(async () => /^\d+$/.test((await vscode.commands.executeCommand('kvalMachineScope.watchShown'))?.['MAIN.fbTest.nCycles'] ?? ''), 8000);
    expect(wv, `Watch: MAIN.fbTest.nCycles shown (${JSON.stringify(await vscode.commands.executeCommand('kvalMachineScope.watchShown'))})`);
    await vscode.commands.executeCommand('kvalMachineScope.logout');
    const v5 = await waitFor(async () => (await shown()) === null, 8000);
    expect(v5, 'logged out: no values');
  } catch (err) {
    results.push([false, `threw: ${err?.stack ?? err}`]);
  }
  fs.writeFileSync(process.env.KSS_TEST_RESULT, JSON.stringify(results, null, 1));
};

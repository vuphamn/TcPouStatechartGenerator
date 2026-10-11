// TwinCAT XAE's toolbar in VS Code, for the project of the active TwinCAT file: Build, Login / Logout, Start / Stop,
// the target (TwinCAT's routes, or this computer) and XAE's Remote Manager build. As status bar items, buttons on the
// editor's title (a TwinCAT file's or section's), and the TwinCAT view's PLC list.
//  - Build: the project built by TwinCAT XAE through its Automation Interface (shared/tcBuild.cjs: a copy of the
//    project folder in an XAE of its own, hidden; the user's XAE windows untouched); its errors and warnings in the
//    Problems panel, on the section (declaration / implementation) and line.
//  - Login: the PLC's code against this project's latest build (its compile ID); the same: logged in. Another: asked
//    first, as XAE asks: online change (the PLC keeps running) or download (the application stops and starts again),
//    made by XAE (the boot project updated too), then logged in. Logout: offline again.
//  - Start / Stop: the PLC application over ADS (logged in; asked first unless switched off).
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { buildFromProject, remoteManagerBuilds, xaeAvailable, rmCrashesFor } = require('../shared/tcBuild.cjs');
const { readPlcTree, plcProjectsUnder, readTasks, readLibraries } = require('./plcTree.cjs');
const { installedLibraries, setLibraryVersion, removeLibrary, addLibrary, editPlcproj, compareVersions } = require('./libraryEdit.cjs');
const { projectOf, projectTarget, findPlcproj } = require('./twincatProject.cjs');
const { systemClient, localTwinCatNetId } = require('../shared/liveSession.cjs');
const { startPlc, stopPlc } = require('../shared/tcAppInfo.cjs');
const { plcCompileId, projectBuilds, compareBuilds } = require('../shared/tcCompileInfo.cjs');
const { localRoutes } = require('../shared/tcDiscovery.cjs');
const { registerLiveValues, adsSource, standInSource } = require('./liveValues.cjs');
// (the tests: a stand-in PLC, KSS_LIVE_STANDIN: a JSON file of its instances and values; logged in without ADS)
const STAND_IN = process.env.KSS_LIVE_STANDIN || null;
const ads = require('../shared/tcAds.cjs');
const { parseSource } = require('./tcStSource.cjs');
const { readPlcSources } = require('../shared/tcSources.cjs');
const { onlineChangeRisks, riskLines, localProjectFiles } = require('../shared/onlineChangeCheck.cjs');

const SOURCE_RX = /\.(tcpou|tcdut|tcgvl|tcio)$/i;
const LOCAL = 'Local';

function register(context, { activeFile, sectionUriOf }) {
  const out = vscode.window.createOutputChannel('TwinCAT');
  const diagnostics = vscode.languages.createDiagnosticCollection('TwinCAT');
  context.subscriptions.push(out, diagnostics);
  const log = (s) => out.appendLine(`[${new Date().toLocaleTimeString()}] ${s}`);

  // The state of each project (by its folder): logged in, the PLC's state, its code, the last build
  const states = new Map();
  const stateOf = (root) => {
    let s = states.get(root);
    if (!s) states.set(root, (s = { loggedIn: false, plc: null, code: null, lastBuild: null, busy: null }));
    return s;
  };
  let project = null;
  const key = (what) => `kvalMachineScope.${what}|${project?.root.toLowerCase() ?? ''}`;

  /** The target chosen for the project (kept per workspace), else the project's, else this computer */
  function targetOf(p = project) {
    if (!p) return null;
    const kept = context.workspaceState.get(`kvalMachineScope.target|${p.root.toLowerCase()}`);
    if (kept?.netId) return kept;
    const netId = projectTarget(p.tsproj);
    if (netId) {
      const route = localRoutes().find((r) => r.netId === netId);
      return { name: route?.name ?? netId, netId, address: route?.address ?? '' };
    }
    return { name: LOCAL, netId: localTwinCatNetId() ?? '', address: '127.0.0.1', local: true };
  }
  const rmOf = (p = project) => (p ? context.workspaceState.get(`kvalMachineScope.rm|${p.root.toLowerCase()}`, '') : '');

  // An ADS connection to the target's PLC (port 851), kept while it answers
  let conn = null;
  async function plcClient(target) {
    if (!target?.netId) throw new Error('No target: TwinCAT is not installed here, and no route chosen (pick a target)');
    if (conn && conn.netId === target.netId) return conn.client;
    if (conn) await conn.client.disconnect().catch(() => {});
    conn = null;
    // (TwinCAT in Config mode, no PLC yet: connected all the same, Login activates and downloads)
    const client = await systemClient({ netId: target.netId, ip: target.local ? '127.0.0.1' : target.address || '' }, 851, { allowNoPlc: true });
    conn = { netId: target.netId, client };
    return client;
  }
  const dropClient = async () => {
    const c = conn;
    conn = null;
    if (c) await c.client.disconnect().catch(() => {});
  };
  context.subscriptions.push({ dispose: () => void dropClient() });

  // ---- The status bar: target, Remote Manager build, the PLC (and logged in), a build running
  const bar = {
    target: vscode.window.createStatusBarItem('kvalMachineScope.target', vscode.StatusBarAlignment.Left, 50),
    rm: vscode.window.createStatusBarItem('kvalMachineScope.rm', vscode.StatusBarAlignment.Left, 49),
    plc: vscode.window.createStatusBarItem('kvalMachineScope.plc', vscode.StatusBarAlignment.Left, 48),
  };
  bar.target.name = 'TwinCAT target';
  bar.rm.name = 'TwinCAT build (Remote Manager)';
  bar.plc.name = 'TwinCAT PLC';
  bar.target.command = 'kvalMachineScope.pickTarget';
  bar.rm.command = 'kvalMachineScope.pickBuild';
  bar.plc.command = 'kvalMachineScope.plcActions';
  context.subscriptions.push(...Object.values(bar));

  const plcText = (s) => {
    if (s.busy) return `$(sync~spin) ${s.busy}`;
    const run = s.plc === 'Run' ? '$(debug-start) Run' : s.plc === 'Stop' ? '$(debug-pause) Stop' : s.plc ? `$(circle-slash) ${s.plc}` : '$(debug-disconnect) not reachable';
    return `${s.loggedIn ? '$(plug) Online' : '$(debug-disconnect) Offline'} · ${run}`;
  };
  function render() {
    const p = project;
    for (const b of Object.values(bar)) (p ? b.show() : b.hide());
    void vscode.commands.executeCommand('setContext', 'kvalMachineScope.twincatProject', !!p);
    if (!p) return void plcView.refresh();
    const s = stateOf(p.root);
    const t = targetOf(p);
    bar.target.text = `$(server-environment) ${t?.name ?? 'no target'}`;
    bar.target.tooltip = `TwinCAT target: ${t?.name ?? 'none'}${t?.netId ? ` (${t.netId})` : ''}\nProject ${p.name}: click to choose another`;
    const rm = rmOf(p);
    bar.rm.text = `$(versions) Build ${rm || '(Default)'}`;
    bar.rm.tooltip = `XAE's Remote Manager: the TwinCAT build that builds ${p.name}${rm ? '' : ' (XAE\'s default)'}: click to choose another`;
    bar.plc.text = plcText(s);
    bar.plc.tooltip = `${p.plcProject || p.name} on ${t?.name ?? '?'}: ${s.loggedIn ? 'logged in' : 'not logged in'}; PLC ${s.plc ?? 'not reachable'}${s.code ? `; ${CODE_TEXT[s.code.state] ?? ''}` : ''}\nClick: Login, Logout, Start, Stop`;
    void vscode.commands.executeCommand('setContext', 'kvalMachineScope.loggedIn', s.loggedIn);
    void vscode.commands.executeCommand('setContext', 'kvalMachineScope.plcRunning', s.plc === 'Run');
    void vscode.commands.executeCommand('setContext', 'kvalMachineScope.busy', !!s.busy);
    plcView.refresh();
  }

  // ---- The PLC's state: read every few seconds while a TwinCAT project is active and the window has focus
  let polling = false;
  async function poll() {
    if (polling || !project || !vscode.window.state.focused) return;
    polling = true;
    const p = project;
    const s = stateOf(p.root);
    try {
      if (STAND_IN) {
        s.plc = s.plc ?? 'Run';
        s.code = { state: 'newest', at: Date.now() };
        return;
      }
      const client = await plcClient(targetOf(p));
      const st = await client.readState();
      s.plc = ads.ADS_STATES?.[st.adsState] ?? String(st.adsState);
      if (!s.code || Date.now() - (s.code.at ?? 0) > 30000) {
        const id = await plcCompileId(client).catch(() => null);
        const was = s.code?.state ?? null;
        s.code = { ...(compareBuilds(id, projectBuilds(p.plcproj ?? p.tsproj)) ?? { state: null }), at: Date.now() };
        if (s.loggedIn && was === 'newest' && s.code.state && s.code.state !== 'newest') void codeChanged(p);
      }
    } catch {
      s.plc = null;
      await dropClient();
    } finally {
      polling = false;
      if (STAND_IN && project === p) render();
    }
    if (project === p) render();
  }
  const timer = setInterval(() => void poll(), 4000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // ---- Follow the active file's project
  const follow = () => {
    const f = activeFile();
    const p = f && SOURCE_RX.test(f) ? projectOf(f) : null;
    // (another editor, not a TwinCAT file: the last project kept)
    if (p && p.root !== project?.root) {
      project = p;
      void dropClient();
      void poll();
    }
    render();
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(follow), vscode.window.tabGroups.onDidChangeTabs(follow));

  // ---- Unsaved edits of the project: saved first (as XAE saves before it builds)
  async function saveProjectEdits(p) {
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && (() => {
      const f = d.uri.scheme === 'file' ? d.uri.fsPath : d.uri.scheme === 'twincat-st' ? new URLSearchParams(d.uri.query).get('file') : null;
      return f && path.resolve(f).toLowerCase().startsWith(p.root.toLowerCase() + path.sep);
    })());
    for (const d of dirty) if (!(await d.save())) throw new Error(`${path.basename(d.uri.path)} could not be saved`);
    return dirty.length;
  }

  // ---- XAE's messages in the Problems panel, on their section
  function showItems(p, items) {
    diagnostics.clear();
    const byUri = new Map();
    const general = [];
    for (const i of items ?? []) {
      const severity = i.level === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      const uri = uriOfPlace(p, i.place);
      const line = Math.max(0, (Number(i.line) || 1) - 1);
      const d = new vscode.Diagnostic(new vscode.Range(line, Math.max(0, (Number(i.column) || 1) - 1), line, 1000), i.text, severity);
      d.source = 'TwinCAT';
      if (!uri) {
        general.push(d);
        continue;
      }
      const k = uri.toString();
      if (!byUri.has(k)) byUri.set(k, { uri, list: [] });
      byUri.get(k).list.push(d);
    }
    for (const { uri, list } of byUri.values()) diagnostics.set(uri, list);
    // (messages of no file: on the project's .tsproj)
    if (general.length) diagnostics.set(vscode.Uri.file(p.tsproj), general);
  }
  function uriOfPlace(p, place) {
    if (!place?.path) return null;
    // (the PLC project's folder in the project folder, by its name)
    const plcproj = findPlcproj(p.root, place.plcProject);
    if (!plcproj) return null;
    const file = path.join(path.dirname(plcproj), ...place.path.split('/'));
    if (!fs.existsSync(file)) return null;
    let members = [];
    try {
      members = parseSource(fs.readFileSync(file, 'utf8')).members;
    } catch {
      return vscode.Uri.file(file);
    }
    const root = members[0];
    const name = place.member ?? '';
    const mb = !name || name === root?.name ? root : members.find((m) => m.key.endsWith(`:${name}`)) ?? members.find((m) => m.key.endsWith(`:${name.replace(/\.(Get|Set)$/, '')}.${name.split('.').pop()}`)) ?? root;
    const section = place.part === 'declaration' ? 'decl' : 'impl';
    return mb?.[section] ? sectionUriOf(file, mb.key, section, members) : vscode.Uri.file(file);
  }

  // ---- A build or a write: XAE's steps in the progress and the TwinCAT output
  async function runXae(title, opts) {
    const p = project;
    const s = stateOf(p.root);
    if (!(await xaeAvailable())) throw new Error('TwinCAT XAE is not installed on this computer: its Automation Interface builds the project (TcXaeShell)');
    const crashed = rmOf(p) ? rmCrashesFor(p.tsproj)[rmOf(p)] : null;
    if (crashed && !opts.confirmedRm) {
      const DEF = 'Use (Default)';
      const c = await vscode.window.showWarningMessage(`XAE stopped while it opened ${p.name} with Remote Manager build ${rmOf(p)} (${new Date(crashed).toLocaleString()}).`, { modal: true }, DEF, 'Try again');
      if (!c) throw new Error('Not built');
      if (c === DEF) await context.workspaceState.update(`kvalMachineScope.rm|${p.root.toLowerCase()}`, '');
    }
    const saved = await saveProjectEdits(p);
    if (saved) log(`${saved} unsaved file(s) saved first`);
    s.busy = title;
    render();
    out.show(true);
    log(`${title}: ${p.name} (${p.plcProject || 'its PLC project'}), Remote Manager build ${rmOf(p) || '(Default)'}`);
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `TwinCAT: ${title}`, cancellable: false }, (progress) =>
        buildFromProject(opts.client ?? null, {
          file: p.plcproj ?? p.tsproj,
          plcProject: p.plcProject,
          rmVersion: rmOf(p),
          ...opts,
          onStep: (text) => {
            progress.report({ message: text });
            log(text);
          },
        })
      );
    } finally {
      s.busy = null;
      render();
    }
  }
  const summary = (r) => `${r.errors ?? (r.items ?? []).filter((i) => i.level === 'error').length} error(s), ${(r.items ?? []).filter((i) => i.level === 'warning').length} warning(s)`;

  const needProject = () => {
    if (!project) throw new Error('Open a file of a TwinCAT project first (.TcPOU, .TcDUT, .TcGVL)');
    return project;
  };
  const guard = (fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      log(`Failed: ${err?.message ?? err}`);
      void vscode.window.showErrorMessage(`TwinCAT: ${err?.message ?? err}`);
    }
  };

  async function build() {
    const p = needProject();
    const r = await runXae('Build', {});
    stateOf(p.root).lastBuild = { ok: !!r.ok, at: Date.now(), text: r.fatal ?? summary(r) };
    showItems(p, r.items);
    for (const i of r.items ?? []) log(`${i.level}: ${i.text}${i.place ? ` (${i.place.path}${i.place.member ? `@${i.place.member}` : ''}, line ${i.line})` : ''}`);
    render();
    if (r.fatal) throw new Error(r.fatal);
    const msg = `Build ${r.ok ? 'succeeded' : 'failed'}: ${summary(r)}`;
    log(msg);
    if (r.ok) void vscode.window.showInformationMessage(`TwinCAT: ${msg}`);
    else void vscode.window.showErrorMessage(`TwinCAT: ${msg}`, 'Problems').then((c) => c && vscode.commands.executeCommand('workbench.actions.view.problems'));
  }

  async function login() {
    const p = needProject();
    const s = stateOf(p.root);
    const t = targetOf(p);
    if (STAND_IN) {
      s.loggedIn = true;
      s.plc = s.plc ?? 'Run';
      log(`Logged in to ${t.name} (stand-in)`);
      render();
      live.refresh(p.root);
      return;
    }
    const client = await plcClient(t);
    const id = await plcCompileId(client);
    const cmp = compareBuilds(id, projectBuilds(p.plcproj ?? p.tsproj));
    s.code = { ...(cmp ?? { state: null }), at: Date.now() };
    if (cmp?.state === 'newest') {
      s.loggedIn = true;
      log(`Logged in to ${t.name}: the PLC runs ${p.name}'s latest build`);
      render();
      live.refresh(p.root);
      return;
    }
    const why = !id ? `The PLC on ${t.name} runs no program (or does not say which)` : `The PLC on ${t.name} runs other code than ${p.name}'s latest build`;
    const ONLINE = 'Login with online change';
    const DOWNLOAD = 'Login with download';
    const choice = await vscode.window.showWarningMessage(
      `${why}.`,
      { modal: true, detail: `${ONLINE}: the PLC takes the new code while it keeps running.\n${DOWNLOAD}: the PLC application stops, takes the new code and starts again (its variables to their initial values).\nThe project is built first; the boot project is updated too.` },
      ONLINE,
      DOWNLOAD
    );
    if (!choice) return;
    const r = await runXae(choice === ONLINE ? 'Online change' : 'Download', { client, write: choice === ONLINE ? 'online' : 'download', netId: t.netId });
    showItems(p, r.items);
    if (!r.ok) throw new Error(r.fatal ?? `Nothing was written: ${summary(r)}`);
    s.loggedIn = true;
    s.code = null;
    log(`Logged in to ${t.name}: ${choice === ONLINE ? 'online change' : 'download'} made${r.bootProject === false ? ' (the boot project was not updated)' : ''}`);
    render();
    live.refresh(p.root);
    void poll();
  }

  /** What the online change would change (as XAE's Online Change dialog's details): the PLC's project (its sources in
   * its boot folder) compared with the local one → lines for the confirmation, or null when it can't be read */
  async function onlineChangePreview(p, t, given) {
    if (given && p.plcproj) return showOnlineChange(p, onlineChangeRisks(given, localProjectFiles(p.plcproj)));
    if (STAND_IN || !p.plcproj) return null;
    const client = await plcClient(t);
    const plcName = path.basename(p.plcproj, path.extname(p.plcproj));
    const within = (pr) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('the PLC did not answer in time')), 8000))]);
    let r = await within(readPlcSources(client, 851, { plcProject: plcName }));
    // (the PLC project's name on the PLC is not the .plcproj's: the one of port 851)
    if (r.error && /has no PLC project/.test(r.error)) r = await within(readPlcSources(client, 851));
    if (r.error) {
      onlineChangeView.show(null, `Not compared with the PLC's project: ${r.error}`);
      return [`(Not compared with the PLC's project: ${r.error})`];
    }
    return showOnlineChange(p, onlineChangeRisks([...r.files, ...(r.projectFiles ?? [])], localProjectFiles(p.plcproj)));
  }
  /** The comparison in the Online Change view; its lines for a confirmation */
  function showOnlineChange(p, risks) {
    onlineChangeView.show({ risks, dir: path.dirname(p.plcproj), at: new Date(), target: targetOf(p)?.name ?? 'the PLC' });
    const lines = riskLines(risks);
    return lines.length ? lines : ['No declarations, RETAIN / PERSISTENT variables, tasks or libraries changed: only code.'];
  }

  /** Online Change Details: the comparison alone, in its view (given: the PLC's files, a test's) */
  async function onlineChangeDetails(given) {
    const p = needProject();
    const t = targetOf(p);
    const lines = await onlineChangePreview(p, t, Array.isArray(given) ? given : undefined);
    if (!lines) {
      void vscode.window.showInformationMessage('Online Change Details: not with a stand-in PLC (log in to a real one).');
      return null;
    }
    await vscode.commands.executeCommand('kvalMachineScope.onlineChange.focus');
    return lines;
  }

  async function buildOnlineChange() {
    const p = needProject();
    const s = stateOf(p.root);
    const t = targetOf(p);
    const preview = await onlineChangePreview(p, t).catch((err) => [`(Not compared with the PLC's project: ${err?.message ?? err})`]);
    if (preview) log(`Online change on ${t.name}, compared with the PLC's project:\n  ${preview.join('\n  ')}`);
    const DETAILS = 'Show Details';
    const ok = await vscode.window.showWarningMessage(`Build ${p.name} and write it to the PLC on ${t.name} as an online change?`, { modal: true, detail: `${preview ? `${preview.join('\n')}\n\n` : ''}The PLC takes the new code while it keeps running; the boot project is updated too. When an online change is not possible, nothing is written (Login offers a download).` }, 'Build and Online Change', ...(preview ? [DETAILS] : []));
    if (ok === DETAILS) {
      // (each change to look at, one click from its code: nothing written)
      await vscode.commands.executeCommand('kvalMachineScope.onlineChange.focus');
      return;
    }
    if (!ok) return;
    if (STAND_IN) {
      s.loggedIn = true;
      log(`Online change on ${t.name} (stand-in)`);
      render();
      live.refresh(p.root);
      return;
    }
    const client = await plcClient(t);
    const r = await runXae('Online change', { client, write: 'online', netId: t.netId });
    showItems(p, r.items);
    if (!r.ok) throw new Error(r.fatal ?? `Nothing was written: ${summary(r)}`);
    s.loggedIn = true;
    s.code = null;
    log(`Online change on ${t.name}: made${r.bootProject === false ? ' (the boot project was not updated)' : ''}`);
    render();
    live.refresh(p.root);
    void poll();
  }

  /** The PLC no longer runs the project's latest build while logged in: said once, with Build and Online Change */
  async function codeChanged(p) {
    const t = targetOf(p);
    const BUILD = 'Build and Online Change';
    const c = await vscode.window.showWarningMessage(`The PLC on ${t?.name ?? '?'} no longer runs ${p.name}'s latest build (built anew here or in XAE, or changed on the PLC): the live values may not match the code.`, BUILD, 'Logout');
    if (c === BUILD) await vscode.commands.executeCommand('kvalMachineScope.buildOnlineChange');
    else if (c === 'Logout') await vscode.commands.executeCommand('kvalMachineScope.logout');
  }

  async function logout() {
    const p = needProject();
    stateOf(p.root).loggedIn = false;
    log(`Logged out of ${targetOf(p)?.name ?? 'the PLC'}`);
    await dropSource(p.root);
    render();
    live.refresh(p.root);
  }

  async function startStop(start) {
    const p = needProject();
    const s = stateOf(p.root);
    const t = targetOf(p);
    if (!s.loggedIn) throw new Error(`Log in first (${start ? 'Start' : 'Stop'} works while logged in, as in XAE)`);
    if (vscode.workspace.getConfiguration('kvalMachineScope').get('twincat.confirmStartStop', true)) {
      const ok = await vscode.window.showWarningMessage(`${start ? 'Start' : 'Stop'} the PLC on ${t.name}?`, { modal: true, detail: start ? 'Its program runs: the machine may move.' : 'Its program stops: the machine stops being controlled.' }, start ? 'Start' : 'Stop');
      if (!ok) return;
    }
    if (STAND_IN) {
      s.plc = start ? 'Run' : 'Stop';
      log(`${start ? 'Start' : 'Stop'} on ${t.name} (stand-in): ${s.plc}`);
      return render();
    }
    const client = await plcClient(t);
    s.busy = start ? 'Starting' : 'Stopping';
    render();
    try {
      const r = await (start ? startPlc(client) : stopPlc(client));
      s.plc = r.state ?? s.plc;
      log(`${start ? 'Start' : 'Stop'} on ${t.name}: ${r.ok ? r.state : r.error}`);
      if (!r.ok) throw new Error(r.error);
    } finally {
      s.busy = null;
      render();
    }
  }

  async function pickTarget() {
    const p = needProject();
    const routes = localRoutes();
    const local = localTwinCatNetId();
    const current = targetOf(p);
    const items = [
      ...(local ? [{ label: `$(device-desktop) ${LOCAL}`, description: local, target: { name: LOCAL, netId: local, address: '127.0.0.1', local: true } }] : []),
      ...routes.map((r) => ({ label: `$(server-environment) ${r.name}`, description: `${r.netId}  ${r.address}`, target: { name: r.name, netId: r.netId, address: r.address } })),
    ].map((i) => ({ ...i, picked: i.target.netId === current?.netId, detail: i.target.netId === current?.netId ? 'current' : undefined }));
    if (!items.length) throw new Error('No TwinCAT routes on this computer (add one in XAE, or with the desktop app)');
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `${p.name}: the target (TwinCAT's routes on this computer)` });
    if (!picked) return;
    await context.workspaceState.update(`kvalMachineScope.target|${p.root.toLowerCase()}`, picked.target);
    const s = stateOf(p.root);
    s.loggedIn = false;
    s.plc = null;
    s.code = null;
    await dropSource(p.root);
    await dropClient();
    log(`Target: ${picked.target.name} (${picked.target.netId})`);
    render();
    live.refresh(p.root);
    void poll();
  }

  async function pickBuild() {
    const p = needProject();
    const builds = remoteManagerBuilds().sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    const current = rmOf(p);
    const crashes = rmCrashesFor(p.tsproj);
    const items = [{ label: '(Default)', description: "XAE's default", value: '' }, ...builds.map((b) => ({ label: b, description: `TwinCAT 3.1.${b}`, value: b }))].map((i) => ({ ...i, detail: [i.value === current ? 'current' : '', crashes[i.value] ? `$(warning) XAE stopped while it opened ${p.name} with it (${new Date(crashes[i.value]).toLocaleDateString()})` : ''].filter(Boolean).join(' · ') || undefined }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `${p.name}: the TwinCAT build that builds it (XAE's Remote Manager)` });
    if (!picked) return;
    await context.workspaceState.update(`kvalMachineScope.rm|${p.root.toLowerCase()}`, picked.value);
    log(`Remote Manager build: ${picked.value || '(Default)'}`);
    render();
  }

  async function plcActions() {
    const p = needProject();
    const s = stateOf(p.root);
    const items = [
      { label: '$(tools) Build', run: build },
      { label: '$(cloud-upload) Build and Online Change', run: buildOnlineChange },
      s.loggedIn ? { label: '$(debug-disconnect) Logout', run: logout } : { label: '$(plug) Login', run: login },
      ...(s.loggedIn ? [s.plc === 'Run' ? { label: '$(debug-stop) Stop', run: () => startStop(false) } : { label: '$(debug-start) Start', run: () => startStop(true) }] : []),
      { label: '$(server-environment) Choose target…', run: pickTarget },
      { label: '$(versions) Choose build (Remote Manager)…', run: pickBuild },
      { label: '$(output) Show TwinCAT output', run: async () => out.show() },
    ];
    const picked = await vscode.window.showQuickPick(items, { placeHolder: `${p.name} on ${targetOf(p)?.name ?? '?'}` });
    if (picked) await picked.run();
  }

  // ---- The TwinCAT view's PLC list
  const CODE_TEXT = { newest: "runs this project's latest build", older: 'runs an older build of this project', other: 'runs other code' };
  const plcView = (() => {
    const changed = new vscode.EventEmitter();
    const provider = {
      onDidChangeTreeData: changed.event,
      getChildren() {
        const p = project;
        if (!p) return [];
        const s = stateOf(p.root);
        const t = targetOf(p);
        const rm = rmOf(p);
        const item = (label, description, icon, command, tooltip) => {
          const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
          it.description = description;
          it.iconPath = new vscode.ThemeIcon(icon);
          if (command) it.command = { command, title: label };
          it.tooltip = tooltip ?? `${label}: ${description}`;
          return it;
        };
        return [
          item('Project', `${p.name}${p.plcProject ? ` · ${p.plcProject}` : ''}`, 'project', undefined, p.tsproj),
          item('Target', `${t?.name ?? 'none'}${t?.netId ? ` (${t.netId})` : ''}`, 'server-environment', 'kvalMachineScope.pickTarget'),
          item('Build', rm || '(Default)', 'versions', 'kvalMachineScope.pickBuild', "XAE's Remote Manager build: click to choose"),
          item('PLC', s.busy ?? `${s.loggedIn ? 'logged in' : 'not logged in'} · ${s.plc ?? 'not reachable'}`, s.loggedIn ? 'plug' : 'debug-disconnect', 'kvalMachineScope.plcActions'),
          item('Code', s.plc === 'Invalid' ? 'no program running' : s.code?.state ? CODE_TEXT[s.code.state] : s.plc ? 'unknown' : '—', s.plc !== 'Invalid' && s.code?.state === 'newest' ? 'pass' : s.code?.state || s.plc === 'Invalid' ? 'warning' : 'question'),
          item('Last build', s.lastBuild ? `${s.lastBuild.ok ? 'ok' : 'failed'}: ${s.lastBuild.text} (${new Date(s.lastBuild.at).toLocaleTimeString()})` : '—', s.lastBuild ? (s.lastBuild.ok ? 'pass' : 'error') : 'circle-outline', 'kvalMachineScope.showOutput'),
        ];
      },
      getTreeItem: (x) => x,
    };
    const view = vscode.window.createTreeView('kvalMachineScope.plc', { treeDataProvider: provider });
    context.subscriptions.push(view, changed);
    return {
      refresh: () => {
        view.message = project ? undefined : 'Open a file of a TwinCAT project (.TcPOU, .TcDUT, .TcGVL) to build it and go online.';
        changed.fire(undefined);
      },
    };
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand('kvalMachineScope.build', guard(build)),
    vscode.commands.registerCommand('kvalMachineScope.login', guard(login)),
    vscode.commands.registerCommand('kvalMachineScope.logout', guard(logout)),
    vscode.commands.registerCommand('kvalMachineScope.buildOnlineChange', guard(buildOnlineChange)),
    vscode.commands.registerCommand('kvalMachineScope.start', guard(() => startStop(true))),
    vscode.commands.registerCommand('kvalMachineScope.stop', guard(() => startStop(false))),
    vscode.commands.registerCommand('kvalMachineScope.pickTarget', guard(pickTarget)),
    vscode.commands.registerCommand('kvalMachineScope.pickBuild', guard(pickBuild)),
    vscode.commands.registerCommand('kvalMachineScope.plcActions', guard(plcActions)),
    vscode.commands.registerCommand('kvalMachineScope.showOutput', () => out.show()),
    vscode.commands.registerCommand('kvalMachineScope.refreshPlc', guard(async () => {
      if (project) stateOf(project.root).code = null;
      await poll();
    }))
  );
  // ---- Live values (liveValues.cjs): each project's source, made when it is first asked for while logged in
  const sources = new Map();
  async function sourceOf(root) {
    const proj = projects.get(root) ?? project;
    if (STAND_IN) {
      if (!sources.has(root)) sources.set(root, { client: null, src: standInSource(STAND_IN) });
      return sources.get(root).src;
    }
    const t = targetOf(proj);
    const client = await plcClient(t);
    let e = sources.get(root);
    if (!e || e.client !== client) {
      if (e) await e.src.dispose().catch(() => {});
      e = { client, src: adsSource(client) };
      sources.set(root, e);
    }
    return e.src;
  }
  async function dropSource(root) {
    const e = sources.get(root);
    sources.delete(root);
    if (e) await e.src.dispose().catch(() => {});
  }
  // (a file's project, kept: asked twice a second)
  const projectCache = new Map();
  const projects = new Map();
  const cachedProjectOf = (file) => {
    const k = path.dirname(path.resolve(file)).toLowerCase();
    if (!projectCache.has(k)) projectCache.set(k, projectOf(file));
    const p = projectCache.get(k);
    if (p) projects.set(p.root, p);
    return p;
  };
  const live = registerLiveValues(context, {
    online: { isOnline: (root) => !!states.get(root)?.loggedIn, source: sourceOf, targetName: (root) => targetOf(projects.get(root) ?? project)?.name ?? 'the PLC' },
    projectOf: cachedProjectOf,
    currentRoot: () => project?.root ?? null,
  });
  // ---- The Solution view: the PLC projects' trees (their .plcproj), as XAE's Solution Explorer shows them
  // (each task's online values, by "<root>|<task>": the last cycle's execution time, an overrun, the cycles)
  const taskOnline = new Map();
  const solution = (() => {
    const changed = new vscode.EventEmitter();
    const ICON = { TcPOU: 'symbol-class', TcDUT: 'symbol-structure', TcGVL: 'symbol-variable', TcIO: 'symbol-interface', TcVIS: 'eye', TcTTO: 'watch' };
    const provider = {
      onDidChangeTreeData: changed.event,
      getChildren(el) {
        if (!project) return [];
        if (!el) {
          // (the project's tasks first, as XAE's SYSTEM > Tasks)
          let tasks = [];
          try {
            tasks = readTasks(project.root);
          } catch {
            // (an unreadable .tsproj)
          }
          const tasksNode = tasks.length ? [{ tasksNode: true, tasks, root: project.root }] : [];
          return [...tasksNode, ...plcProjectsUnder(project.root).map((plcproj) => {
            try {
              const t = readPlcTree(plcproj);
              // (References always: Add Library there)
              return { label: t.name, plc: true, plcproj, path: '', children: [...t.children, { name: 'References', references: t.references, plcproj }] };
            } catch {
              return { label: path.basename(plcproj), plc: true, children: [] };
            }
          })];
        }
        if (el.tasksNode) return el.tasks.map((t) => ({ task: t, root: el.root }));
        if (el.task) {
          // (the programs it calls: each opens as Structured Text)
          const files = plcProjectsUnder(el.root).flatMap((p) => {
            const walk = (n) => (n.children ? n.children.flatMap(walk) : [n]);
            try {
              return readPlcTree(p).children.flatMap(walk);
            } catch {
              return [];
            }
          });
          return el.task.calls.map((c) => ({ call: c, file: files.find((f) => f.ext?.toLowerCase() === 'tcpou' && f.name.toLowerCase() === c.toLowerCase())?.file }));
        }
        // (the libraries as XAE's Library Manager shows them: their versions, the one used, missing ones)
        if (el.references) {
          try {
            return readLibraries(el.plcproj).map((lib) => ({ name: lib.name, reference: true, lib, plcproj: el.plcproj }));
          } catch {
            return el.references.map((r) => ({ name: r, reference: true }));
          }
        }
        // (each node with its PLC project: Add POU / Add DUT there)
        return (el.children ?? []).map((c) => ({ ...c, plcproj: el.plcproj }));
      },
      getTreeItem(el) {
        if (el.plc) {
          const it = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.Expanded);
          it.iconPath = new vscode.ThemeIcon('project');
          it.description = 'PLC project';
          it.contextValue = 'plcFolder';
          return it;
        }
        if (el.tasksNode) {
          const it = new vscode.TreeItem('Tasks', vscode.TreeItemCollapsibleState.Expanded);
          it.iconPath = new vscode.ThemeIcon('clock');
          it.description = `${el.tasks.length}`;
          it.id = `tasks|${el.root}`;
          return it;
        }
        if (el.task) {
          const t = el.task;
          const on = taskOnline.get(`${el.root}|${t.name}`.toLowerCase());
          const it = new vscode.TreeItem(t.name, t.calls.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
          it.id = `task|${el.root}|${t.name}`;
          const plan = [t.cycleMs !== undefined ? `${t.cycleMs} ms` : null, t.priority !== undefined ? `priority ${t.priority}` : null].filter(Boolean).join(' · ');
          it.description = on ? `${plan} · exec ${on.execMs.toFixed(3)} ms (max ${on.maxMs.toFixed(3)})${on.exceeded ? ' · OVERRUN' : ''}` : plan;
          it.iconPath = new vscode.ThemeIcon(on?.exceeded ? 'warning' : 'watch', on?.exceeded ? new vscode.ThemeColor('problemsWarningIcon.foreground') : undefined);
          it.tooltip = new vscode.MarkdownString([
            `**${t.name}**${t.plc ? ` (${t.plc})` : ''}`,
            t.cycleMs !== undefined ? `Cycle: ${t.cycleMs} ms` : null,
            t.priority !== undefined ? `Priority: ${t.priority}` : null,
            t.adsPort !== undefined ? `ADS port: ${t.adsPort}` : null,
            t.calls.length ? `Calls: ${t.calls.join(', ')}` : null,
            on ? `Online: last cycle ${on.execMs.toFixed(3)} ms of ${t.cycleMs ?? '?'} ms${on.cycles !== undefined ? `, ${on.cycles} cycles` : ''}${on.exceeded ? ', **cycle time exceeded**' : ''}` : null,
          ].filter(Boolean).join('  \n'));
          const file = t.ttoFile ?? t.tsproj;
          if (file) it.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(file)] };
          it.contextValue = on ? 'plcTaskOnline' : 'plcTask';
          if (on) el.trendPath = `TwinCAT_SystemInfoVarList._TaskInfo[${on.index}].LastExecTime`;
          return it;
        }
        if (el.call) {
          const it = new vscode.TreeItem(el.call, vscode.TreeItemCollapsibleState.None);
          it.iconPath = new vscode.ThemeIcon('symbol-function');
          it.description = 'called';
          if (el.file) it.command = { command: 'kvalMachineScope.openStructuredText', title: 'Open', arguments: [vscode.Uri.file(el.file)] };
          return it;
        }
        if (el.references) {
          let missing = 0;
          try {
            missing = readLibraries(el.plcproj).filter((l) => l.missing).length;
          } catch {
            // (the names only)
          }
          return Object.assign(new vscode.TreeItem('References', vscode.TreeItemCollapsibleState.Collapsed), {
            iconPath: new vscode.ThemeIcon(missing ? 'warning' : 'library', missing ? new vscode.ThemeColor('problemsWarningIcon.foreground') : undefined),
            description: `${el.references.length}${missing ? ` · ${missing} missing` : ''}`,
            contextValue: 'plcReferences',
          });
        }
        if (el.reference && el.lib) {
          const l = el.lib;
          const it = new vscode.TreeItem(l.name, vscode.TreeItemCollapsibleState.None);
          it.iconPath = new vscode.ThemeIcon(l.missing ? 'warning' : 'package', l.missing ? new vscode.ThemeColor('problemsWarningIcon.foreground') : undefined);
          it.description = l.missing ? `${l.version === '*' ? 'newest' : l.version}: not installed here` : `${l.used}${l.pinned ? '' : ' (newest, *)'}`;
          it.tooltip = new vscode.MarkdownString([
            `**${l.name}**${l.vendor ? ` (${l.vendor})` : ''}${l.placeholder ? ` · placeholder ${l.placeholder}` : ''}`,
            `Asked for: ${l.version === '*' ? 'the newest (*)' : l.version}`,
            `Used: ${l.used ?? '**none: not in the project\'s cache nor installed on this computer**'}`,
            `In the project's cache (_Libraries): ${l.cached.join(', ') || 'none'}`,
            `Installed here: ${l.installed.join(', ') || 'none'}`,
          ].join('  \n'));
          it.contextValue = 'plcLibrary';
          return it;
        }
        if (el.reference) return Object.assign(new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.None), { iconPath: new vscode.ThemeIcon('package') });
        if (el.children) return Object.assign(new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.Collapsed), { iconPath: vscode.ThemeIcon.Folder, contextValue: 'plcFolder' });
        const it = new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.None);
        it.iconPath = new vscode.ThemeIcon(ICON[el.ext] ?? 'file');
        it.description = el.ext;
        it.tooltip = el.file;
        it.resourceUri = vscode.Uri.file(el.file);
        // (a source: as Structured Text; another (a visualization, the task): the file itself)
        it.command = /^(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(el.ext) ? { command: 'kvalMachineScope.openStructuredText', title: 'Open', arguments: [vscode.Uri.file(el.file)] } : { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(el.file)] };
        return it;
      },
    };
    const view = vscode.window.createTreeView('kvalMachineScope.solution', { treeDataProvider: provider, showCollapseAll: true });
    context.subscriptions.push(view, changed);
    let shownRoot = null;
    return {
      refresh: () => {
        view.description = project ? project.name : '';
        view.message = project ? undefined : 'Open a file of a TwinCAT project to see its PLC project here.';
        if (project?.root !== shownRoot) {
          shownRoot = project?.root ?? null;
          changed.fire(undefined);
        }
      },
      reload: () => changed.fire(undefined),
    };
  })();
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.refreshSolution', () => solution.reload()));

  // ---- The Online Change view: what an online change would change (as XAE's Online Change details), by kind, each a
  // click from its code; the warnings first
  const onlineChangeView = (() => {
    const changed = new vscode.EventEmitter();
    let shown = null;
    const warn = () => new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    const openOf = (name) => {
      const rel = shown?.risks.files?.[String(name).toLowerCase()];
      if (!rel) return undefined;
      const file = path.join(shown.dir, ...rel.split('/'));
      return /\.(TcPOU|TcDUT|TcGVL|TcIO)$/i.test(file) ? { command: 'kvalMachineScope.openStructuredText', title: 'Open', arguments: [vscode.Uri.file(file)] } : { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(file)] };
    };
    const groups = () => {
      if (!shown?.risks) return [];
      const r = shown.risks;
      return [
        { kind: 'tasks', label: 'Tasks changed', why: 'The task configuration changed: a download, not an online change.', warn: true, items: r.tasks.map((x) => ({ label: x.name, description: x.change, open: x.name })) },
        { kind: 'libraries', label: 'Libraries changed', why: 'An online change may not be possible, or reinitializes their instances.', warn: true, items: r.libraries.map((x) => ({ label: x.name, description: `${x.from ?? '(new)'} → ${x.to ?? '(removed)'}` })) },
        { kind: 'retain', label: 'RETAIN / PERSISTENT changed', why: 'Their values are lost or reinitialized.', warn: true, items: r.retain.map((x) => ({ label: `${x.object}.${x.name}`, description: x.change, open: x.object })) },
        { kind: 'interfaces', label: 'Declarations changed', why: 'Their instances move: pointers and references to them are invalid until assigned again.', items: r.interfaces.map((x) => ({ label: x, open: x })) },
        { kind: 'added', label: 'Added', items: r.added.map((x) => ({ label: x, open: x })) },
        { kind: 'removed', label: 'Removed', items: r.removed.map((x) => ({ label: x })) },
      ].filter((g) => g.items.length);
    };
    const provider = {
      onDidChangeTreeData: changed.event,
      getChildren: (el) => (el ? el.items.map((it) => ({ ...it, group: el })) : groups()),
      getTreeItem: (el) => {
        if (el.items) {
          const it = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.Expanded);
          it.description = String(el.items.length);
          it.iconPath = el.warn ? warn() : new vscode.ThemeIcon(el.kind === 'added' ? 'diff-added' : el.kind === 'removed' ? 'diff-removed' : 'symbol-interface');
          if (el.why) it.tooltip = el.why;
          it.contextValue = 'onlineChangeGroup';
          return it;
        }
        const it = new vscode.TreeItem(el.label, vscode.TreeItemCollapsibleState.None);
        it.description = el.description;
        it.tooltip = [el.label, el.description, el.group.why].filter(Boolean).join('\n');
        it.iconPath = new vscode.ThemeIcon(el.group.kind === 'tasks' ? 'watch' : el.group.kind === 'libraries' ? 'package' : el.group.kind === 'retain' ? 'database' : 'symbol-class');
        const cmd = el.open ? openOf(el.open) : undefined;
        if (cmd) it.command = cmd;
        return it;
      },
    };
    const view = vscode.window.createTreeView('kvalMachineScope.onlineChange', { treeDataProvider: provider });
    view.message = 'Online Change Details (or Build and Online Change) compares the project the PLC runs with yours.';
    context.subscriptions.push(view, changed);
    return {
      show(next, error) {
        shown = next;
        const n = next ? groups().reduce((a, g) => a + g.items.length, 0) : 0;
        view.message = error ?? (next && !n ? `Compared with the PLC on ${next.target} (${next.at.toLocaleTimeString()}): only code changed.` : next ? undefined : view.message);
        view.description = next ? `${next.target} · ${next.at.toLocaleTimeString()}` : '';
        changed.fire(undefined);
      },
      groups,
    };
  })();
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.onlineChangeDetails', async (given) => {
    try {
      return await onlineChangeDetails(given);
    } catch (err) {
      log(`Failed: ${err?.message ?? err}`);
      void vscode.window.showErrorMessage(`TwinCAT: ${err?.message ?? err}`);
      return null;
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.onlineChangeShown', () => onlineChangeView.groups().map((g) => ({ label: g.label, items: g.items.map((i) => ({ label: i.label, description: i.description, opens: !!(i.open && i.open) })) }))));

  // ---- The Library Manager (the Solution view's References, as XAE's): a library's version, one added, one removed.
  // The .plcproj edited: XAE, when it has the project open, asks to reload it
  const libraryChanged = (plcproj, what) => {
    log(`${what} (${path.basename(plcproj)})`);
    solution.reload();
    vscode.window.setStatusBarMessage(`$(library) ${what}. Build to use it; XAE asks to reload the project if it has it open.`, 8000);
  };
  const libraryCommand = (id, run) => context.subscriptions.push(vscode.commands.registerCommand(id, guard(run)));
  libraryCommand('kvalMachineScope.setLibraryVersion', async (el, choice) => {
    const l = el?.lib;
    if (!l || !el.plcproj) return false;
    const versions = [...new Set([...l.installed, ...l.cached])].sort(compareVersions).reverse();
    const picks = [
      { label: '$(arrow-up) The newest (*)', description: versions[0] ? `now ${versions[0]}` : 'none installed here', version: '*' },
      ...versions.map((v) => ({ label: v, description: [l.used === v ? 'used now' : '', l.cached.includes(v) ? "in the project's cache" : '', l.installed.includes(v) ? 'installed here' : ''].filter(Boolean).join(' · '), version: v })),
    ];
    const pick = choice ? picks.find((x) => x.version === choice) : await vscode.window.showQuickPick(picks, { title: `${l.name}: its version`, placeHolder: `Asked for now: ${l.version === '*' ? 'the newest (*)' : l.version}` });
    if (!pick || pick.version === l.version) return false;
    editPlcproj(el.plcproj, (x) => setLibraryVersion(x, l, pick.version));
    libraryChanged(el.plcproj, `${l.name} set to ${pick.version === '*' ? 'the newest (*)' : pick.version}`);
    return true;
  });
  libraryCommand('kvalMachineScope.removeLibrary', async (el, sure) => {
    const l = el?.lib;
    if (!l || !el.plcproj) return false;
    if (!sure) {
      const ok = await vscode.window.showWarningMessage(`Remove ${l.name} from ${path.basename(el.plcproj, '.plcproj')}?`, { modal: true, detail: 'Code that uses its blocks, types or functions no longer builds.' }, 'Remove');
      if (ok !== 'Remove') return false;
    }
    editPlcproj(el.plcproj, (x) => removeLibrary(x, l));
    libraryChanged(el.plcproj, `${l.name} removed`);
    return true;
  });
  libraryCommand('kvalMachineScope.addLibrary', async (el, choice) => {
    const plcproj = el?.plcproj ?? (project ? plcProjectsUnder(project.root)[0] : null);
    if (!plcproj) return false;
    const have = new Set(readLibraries(plcproj, { repositories: [] }).map((l) => l.name.toLowerCase()));
    const all = installedLibraries().filter((l) => !have.has(l.name.toLowerCase()));
    let lib = choice ? all.find((l) => l.name.toLowerCase() === String(choice.name).toLowerCase()) : null;
    if (!choice) {
      const pick = await vscode.window.showQuickPick(all.map((l) => ({ label: l.name, description: l.vendor, detail: `Installed: ${[...l.versions].reverse().slice(0, 4).join(', ')}${l.versions.length > 4 ? ', …' : ''}`, lib: l })), { title: `Add a library to ${path.basename(plcproj, '.plcproj')}`, placeHolder: all.length ? 'The libraries installed on this computer' : 'No other library installed on this computer', matchOnDescription: true });
      lib = pick?.lib ?? null;
    }
    if (!lib) return false;
    let version = choice?.version;
    if (!version) {
      const v = await vscode.window.showQuickPick([{ label: '$(arrow-up) The newest (*)', description: 'as XAE adds a library: a placeholder on the newest', version: '*' }, ...[...lib.versions].reverse().map((x) => ({ label: x, version: x }))], { title: `${lib.name}: its version` });
      version = v?.version;
    }
    if (!version) return false;
    editPlcproj(plcproj, (x) => addLibrary(x, { name: lib.name, vendor: lib.vendor, version }));
    libraryChanged(plcproj, `${lib.name} added (${version === '*' ? 'the newest' : version})`);
    return true;
  });
  // A task's trend: its LastExecTime (100 ns units) watched, the trend panel opened
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.taskTrend', async (el) => {
    if (!el?.trendPath) return false;
    await vscode.commands.executeCommand('kvalMachineScope.addWatch', el.trendPath);
    await vscode.commands.executeCommand('kvalMachineScope.showTrend');
    return true;
  }));
  // Logged in: the tasks' online values every 2 s (TwinCAT_SystemInfoVarList._TaskInfo[i], matched by TaskName)
  const TASK_INFO = 'TwinCAT_SystemInfoVarList._TaskInfo';
  let taskBusy = false;
  async function pollTasks() {
    if (taskBusy || !project) return;
    const root = project.root;
    const was = [...taskOnline.keys()].some((k) => k.startsWith(`${root}|`.toLowerCase()));
    if (!states.get(root)?.loggedIn) {
      if (was) {
        for (const k of [...taskOnline.keys()]) if (k.startsWith(`${root}|`.toLowerCase())) taskOnline.delete(k);
        solution.reload();
      }
      return;
    }
    taskBusy = true;
    try {
      const src = await sourceOf(root);
      const value = async (p) => {
        const info = await src.probe(p).catch(() => null);
        return info ? src.read(p, info).catch(() => undefined) : undefined;
      };
      const seen = new Map();
      // (the PLC names a task "<PLC project>_<task>": KssPlc_PlcTask is PlcTask)
      let known = [];
      try {
        known = readTasks(root);
      } catch {
        // (as the PLC names them)
      }
      const taskName = (n) => known.find((t) => t.name.toLowerCase() === n.toLowerCase() || n.toLowerCase().endsWith(`_${t.name.toLowerCase()}`))?.name ?? n;
      for (let i = 1; i <= 8; i++) {
        const raw = await value(`${TASK_INFO}[${i}].TaskName`);
        if (typeof raw !== 'string' || !raw) break;
        const name = taskName(raw);
        const exec = await value(`${TASK_INFO}[${i}].LastExecTime`);
        const execMs = typeof exec === 'number' ? exec / 10000 : 0;
        const prevMax = taskOnline.get(`${root}|${name}`.toLowerCase())?.maxMs ?? 0;
        seen.set(`${root}|${name}`.toLowerCase(), {
          // (100 ns units)
          execMs,
          maxMs: Math.max(prevMax, execMs),
          index: i,
          exceeded: (await value(`${TASK_INFO}[${i}].CycleTimeExceeded`)) === true,
          cycles: await value(`${TASK_INFO}[${i}].CycleCount`),
        });
      }
      const before = JSON.stringify([...taskOnline].filter(([k]) => k.startsWith(`${root}|`.toLowerCase())));
      for (const k of [...taskOnline.keys()]) if (k.startsWith(`${root}|`.toLowerCase())) taskOnline.delete(k);
      for (const [k, v] of seen) taskOnline.set(k, v);
      if (JSON.stringify([...seen]) !== before) solution.reload();
    } catch {
      // (the PLC not reachable now: tried again)
    } finally {
      taskBusy = false;
    }
  }
  const taskTimer = setInterval(() => void pollTasks(), Number(process.env.KSS_LIVE_POLL_MS) > 0 ? Math.max(500, Number(process.env.KSS_LIVE_POLL_MS) * 5) : 2000);
  context.subscriptions.push({ dispose: () => clearInterval(taskTimer) });
  // (for the tests: the tasks as shown, { name: description })
  context.subscriptions.push(vscode.commands.registerCommand('kvalMachineScope.tasksShown', () => {
    if (!project) return null;
    let tasks = [];
    try {
      tasks = readTasks(project.root);
    } catch {
      return null;
    }
    return Object.fromEntries(tasks.map((t) => {
      const on = taskOnline.get(`${project.root}|${t.name}`.toLowerCase());
      return [t.name, { cycleMs: t.cycleMs, priority: t.priority, calls: t.calls, execMs: on?.execMs, maxMs: on?.maxMs, exceeded: on?.exceeded, index: on?.index }];
    }));
  }));
  const renderAll = render;
  render = () => {
    renderAll();
    solution.refresh();
  };

  follow();
  return {
    projectOf,
    /** The project the TwinCAT view shows (the active TwinCAT file's) */
    currentProject: () => project,
    /** The statechart's live view: the target picked for the file's project ({ name, netId, address, local }) */
    targetFor: (file) => {
      const p = cachedProjectOf(file);
      return p ? targetOf(p) : null;
    },
    /** The statechart's Build…: the file's project built as Build does (its messages in the Problems panel too) */
    async buildFor(file) {
      const p = cachedProjectOf(file);
      if (!p) return { ok: false, fatal: 'This POU is not in a TwinCAT project folder (no .tsproj above it)' };
      project = p;
      render();
      try {
        const r = await runXae('Build', {});
        stateOf(p.root).lastBuild = { ok: !!r.ok, at: Date.now(), text: r.fatal ?? summary(r) };
        showItems(p, r.items);
        render();
        // (each message's file as XAE names it: <file>.TcPOU@<member> (Impl), in the project itself, not the build's copy)
        const items = (r.items ?? []).map((i) => {
          const plcproj = i.place ? findPlcproj(p.root, i.place.plcProject) : null;
          const file = plcproj ? `${path.join(path.dirname(plcproj), ...i.place.path.split('/'))}${i.place.member ? `@${i.place.member}` : ''}${i.place.part ? ` (${i.place.part === 'declaration' ? 'Decl' : 'Impl'})` : ''}` : i.file;
          return { level: i.level, text: i.text, file, line: i.line, column: i.column, project: i.project };
        });
        return { ok: !!r.ok, errors: r.errors ?? items.filter((i) => i.level === 'error').length, warnings: items.filter((i) => i.level === 'warning').length, ...(r.fatal ? { fatal: r.fatal } : {}), items };
      } catch (err) {
        return { ok: false, fatal: err?.message ?? String(err) };
      }
    },
  };

}

module.exports = { register, projectOf, projectTarget, findPlcproj };

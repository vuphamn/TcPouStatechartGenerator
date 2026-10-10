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
const { buildFromProject, remoteManagerBuilds, xaeAvailable } = require('../shared/tcBuild.cjs');
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
    const client = await systemClient({ netId: target.netId, ip: target.local ? '127.0.0.1' : target.address || '' }, 851);
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
        s.code = { ...(compareBuilds(id, projectBuilds(p.plcproj ?? p.tsproj)) ?? { state: null }), at: Date.now() };
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
    const items = [{ label: '(Default)', description: "XAE's default", value: '' }, ...builds.map((b) => ({ label: b, description: `TwinCAT 3.1.${b}`, value: b }))].map((i) => ({ ...i, detail: i.value === current ? 'current' : undefined }));
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
    online: { isOnline: (root) => !!states.get(root)?.loggedIn, source: sourceOf },
    projectOf: cachedProjectOf,
  });
  follow();
  return { projectOf };

}

module.exports = { register, projectOf, projectTarget, findPlcproj };

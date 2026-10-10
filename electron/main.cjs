const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readPouWithDutCandidates, saveSources, writeSource } = require('./tcSourceFiles.cjs');
const createLiveSession = require('./tcLive.cjs');

// ---- Opening a .TcPOU from Windows Explorer ("Open in Kval MachineScope", or a file dropped on the exe) ----

/** The .TcPOU in a command line (the packaged exe gets it as its first argument, `electron .` after the dot) */
function pouFromArgs(argv) {
  for (let i = argv.length - 1; i >= 1; i--) {
    const a = argv[i];
    if (/\.tcpou$/i.test(a) && fs.existsSync(a)) return path.resolve(a);
  }
  return null;
}

async function readPouForApp(file) {
  try {
    return await readPouWithDutCandidates(file);
  } catch (err) {
    return { error: `Could not open ${path.basename(file)}: ${err.message}` };
  }
}

// ---- Windows: one per POU ----
// One process: a second start (a file opened from Explorer) hands its file over. A POU already open in a window
// brings that window forward; another one opens in a new window, with its own diagram and live session.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();
/**
 * webContents id -> { win, pouPath: the POU the page reported, instance: the PLC instance it follows (a POU can be
 * declared several times: one window per instance), startupPou / launch: the file it opens first, and the instance
 * to follow in it }
 */
const windows = new Map();
/** webContents id -> live session */
const liveSessions = new Map();

const sameFile = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const sameInstance = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
/** The window showing the file (with an instance: the one following that instance of it) */
function windowShowing(file, instance) {
  for (const w of windows.values()) {
    if (!sameFile(w.pouPath, file) && !sameFile(w.startupPou, file)) continue;
    if (!instance || sameInstance(w.instance ?? w.launch?.instance, instance)) return w.win;
  }
  return null;
}
function focusWindow(win) {
  if (win.isMinimized()) win.restore();
  win.focus();
}
/** Opens the POU (and an instance of it): in the window that shows it, else in a new window */
function openPouWindow(file, launch = null) {
  const open = file ? windowShowing(file, launch?.instance) : null;
  if (open) focusWindow(open);
  else createWindow(file, launch);
}

app.on('second-instance', (_event, argv) => {
  const file = pouFromArgs(argv);
  // Too early (the first window is not open yet): open it once ready
  if (!app.isReady()) {
    if (file) app.whenReady().then(() => openPouWindow(file));
    return;
  }
  if (file) return openPouWindow(file);
  // Started again without a file: bring the app forward (the Window menu opens another window)
  const last = BrowserWindow.getFocusedWindow() ?? [...windows.values()].pop()?.win;
  if (last) focusWindow(last);
  else createWindow(null);
});

// The page asks once it is loaded: the file its window was opened for
ipcMain.handle('tc:startup-pou', async (event) => {
  const w = windows.get(event.sender.id);
  const file = w?.startupPou;
  if (!file) return null;
  const launch = w.launch;
  w.startupPou = null;
  w.launch = null;
  w.pouPath = file;
  const source = await readPouForApp(file);
  return launch && !source.error ? { ...source, launch } : source;
});
// The page reports the POU it shows (after Browse, Open referenced POU, ...) and the instance it follows: Explorer
// and Open instance then find its window
ipcMain.on('tc:current-pou', (event, filePath, instance) => {
  const w = windows.get(event.sender.id);
  if (!w) return;
  w.pouPath = typeof filePath === 'string' && filePath ? filePath : null;
  w.instance = typeof instance === 'string' && instance ? instance : null;
});
// Window menu: New window (optionally with a .TcPOU). Live's Open instance: the POU following one PLC instance
// (launch: { instance, live }), or a POU the page hands over itself (launch: { handoff: id }, see instanceLaunch.ts)
ipcMain.handle('tc:new-window', (_event, filePath, launch) => {
  const file = typeof filePath === 'string' && /\.tcpou$/i.test(filePath) && fs.existsSync(filePath) ? filePath : null;
  const handoff = typeof launch?.handoff === 'string' && /^[a-z0-9]{1,40}$/i.test(launch.handoff) ? launch.handoff : null;
  if (handoff) return void createWindow(null, null, { handoff });
  const instance = typeof launch?.instance === 'string' && launch.instance.trim() ? launch.instance.trim() : null;
  // The opener's PLC connection (short strings only; the page keeps the keys it knows)
  const connection = launch?.connection && typeof launch.connection === 'object'
    ? Object.fromEntries(Object.entries(launch.connection).filter(([k, v]) => /^[a-zA-Z]{1,20}$/.test(k) && typeof v === 'string' && v.length <= 200).slice(0, 16))
    : undefined;
  // Compare (another PLC, the same instance): always a new window, the two side by side on this screen
  if (launch?.compare === true && file && instance) {
    const opener = BrowserWindow.getFocusedWindow();
    const win = createWindow(file, { instance, live: launch.live === true, connection });
    try {
      const { screen } = require('electron');
      const area = screen.getDisplayMatching(opener ? opener.getBounds() : win.getBounds()).workArea;
      const half = Math.floor(area.width / 2);
      if (opener && !opener.isDestroyed()) {
        if (opener.isMaximized()) opener.unmaximize();
        opener.setBounds({ x: area.x, y: area.y, width: half, height: area.height });
      }
      win.setBounds({ x: area.x + half, y: area.y, width: area.width - half, height: area.height });
    } catch {
      // (placed as a new window is)
    }
    return;
  }
  openPouWindow(file, instance ? { instance, live: launch.live === true, connection } : null);
});

function createWindow(startupPou = null, launch = null, query = null) {
  // A new window opens a little below and right of the current one
  const from = BrowserWindow.getFocusedWindow() ?? [...windows.values()].pop()?.win;
  const at = from && !from.isMaximized() ? from.getBounds() : null;
  const mainWindow = new BrowserWindow({
    ...(at ? { x: at.x + 32, y: at.y + 32 } : {}),
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    title: 'Kval MachineScope',
    // Window & taskbar icon (the packaged .exe also carries it, from build/icon.ico)
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#020617', // slate-950
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    autoHideMenuBar: true,
  });

  // Open external links (like mermaid.live) in the user's default browser
  // (the app's own pages, such as window.html for a tab moved to a window of its own, open as windows of the app)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    let own = false;
    try {
      own = new URL(url).origin === new URL(mainWindow.webContents.getURL()).origin;
    } catch {
      own = false;
    }
    if (!own && (url.startsWith('https:') || url.startsWith('http:'))) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#020617' } };
  });
  // Unsaved edits: the page holds the window open (beforeunload); ask whether to leave them
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Kval MachineScope',
      message: 'The POU or the enum has unsaved edits.',
      detail: 'Save writes them to the files. Close anyway and lose them?',
    });
    if (choice === 0) event.preventDefault();
  });
  // The window title follows the page's <title> (the app puts the POU's name in it)
  const id = mainWindow.webContents.id;
  windows.set(id, { win: mainWindow, pouPath: null, instance: null, startupPou, launch });
  mainWindow.on('closed', () => {
    windows.delete(id);
    // Its live session ends with it
    liveSessions.get(id)?.stop(false);
    liveSessions.delete(id);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    mainWindow.loadURL(url.toString());
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), query ? { query } : undefined);
  }
  return mainWindow;
}

// Browse for a .TcPOU; its folder and subfolders are searched for the .TcDUT holding its state enum
ipcMain.handle('tc:open-pou', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Open TwinCAT Function Block',
    properties: ['openFile'],
    filters: [
      { name: 'TwinCAT POU', extensions: ['TcPOU'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return readPouWithDutCandidates(result.filePaths[0]);
});

// Open another POU of the same PLC project: a state machine the diagram references (typeName) or a previous one
// (path, the app's Back). Resolves with the POU and its .TcDUT candidates, or { error }
ipcMain.handle('tc:open-pou-in-project', async (_event, fromPath, typeName, filePath) => {
  const { findPouInProject, isInSameProject } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  const target = filePath ? (isInSameProject(fromPath, filePath) ? filePath : null) : findPouInProject(fromPath, String(typeName || ''));
  if (!target) return { error: filePath ? `${path.basename(String(filePath))} is not in this PLC project` : `${typeName}.TcPOU was not found in the PLC project` };
  return readPouWithDutCandidates(target);
});

// The enum of a type in the same PLC project (another company's POU: its state variable's enum elsewhere)
ipcMain.handle('tc:find-enum-type', async (_event, fromPath, typeName) => {
  const { findEnumTypeInProject } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  const file = findEnumTypeInProject(fromPath, String(typeName || ''));
  if (!file) return { error: `${typeName}.TcDUT was not found in the PLC project` };
  const text = fs.readFileSync(file, 'utf8');
  return { name: path.basename(file), relativePath: path.relative(path.dirname(fromPath), file), path: file, content: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
});

// Project documentation: the PLC project's state machine POUs and enums
ipcMain.handle('tc:project-pous', async (_event, fromPath) => {
  const { projectPous } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  return projectPous(fromPath);
});

// A rename's other files: the project's POUs whose code has the name (written back with tc:save-sources)
ipcMain.handle('tc:project-uses', async (_event, fromPath, name) => {
  const { projectUses } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  return projectUses(fromPath, name);
});

// Completion and the checks: the PLC project's types (declarations only)
ipcMain.handle('tc:project-symbols', async (_event, fromPath) => {
  const { projectSymbols } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  return projectSymbols(fromPath);
});

// A save dialog for a document (the project documentation); opens it afterwards
// Save: the edited .TcPOU / .TcDUT back to their files (conflicts when changed on disk since they were read)
ipcMain.handle('tc:save-sources', (_event, files) => saveSources(files));

// Save As: a .TcPOU / .TcDUT to a file the user picks
ipcMain.handle('tc:save-source-as', async (event, name, content, defaultDir) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const dut = /\.tcdut$/i.test(String(name));
  const result = await dialog.showSaveDialog(win, {
    title: dut ? 'Save the enum as' : 'Save the function block as',
    defaultPath: path.join(typeof defaultDir === 'string' && defaultDir ? defaultDir : app.getPath('documents'), path.basename(String(name || (dut ? 'E_States.TcDUT' : 'SM_Machine.TcPOU')))),
    filters: [dut ? { name: 'TwinCAT DUT', extensions: ['TcDUT'] } : { name: 'TwinCAT POU', extensions: ['TcPOU'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    await writeSource(result.filePath, content);
    return { path: result.filePath };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
});

/** Documents\Kval MachineScope\<sub> (made when missing): the user's own files (KSS_DOCUMENTS: the tests' folder) */
function personalFolder(sub) {
  const dir = path.join(process.env.KSS_DOCUMENTS || app.getPath('documents'), 'Kval MachineScope', sub);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // (the dialog starts elsewhere)
  }
  return dir;
}
ipcMain.handle('tc:save-file', async (event, name, content, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // A document (HTML, opened after saving), a live recording (JSON) or a table (CSV)
  const recording = /\.json$/i.test(String(name));
  const csv = /\.csv$/i.test(String(name));
  const result = await dialog.showSaveDialog(win, {
    title: recording ? 'Save the live recording' : csv ? 'Save the table' : 'Save the documentation',
    // (personal: a live recording, offered in the user's own folder, not the project's: not for git)
    defaultPath: opts?.personal ? path.join(personalFolder('Recordings'), path.basename(String(name || 'recording.json'))) : String(name || 'documentation.html'),
    filters: [recording ? { name: 'Live recording', extensions: ['json'] } : csv ? { name: 'CSV (Excel)', extensions: ['csv'] } : { name: 'HTML document', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    await require('fs/promises').writeFile(result.filePath, String(content), 'utf8');
    if (!recording && !csv) shell.openPath(result.filePath);
    return { path: result.filePath };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
});

// Compare: the committed (git HEAD) version of a file, from its folder's repository
// A POU's layout file (<POU>.machinescope.json beside it, for git): { text } (null: none yet) or { error }; written:
// { written } or { error }
ipcMain.handle('tc:layout-read', (_event, pouPath) => {
  try {
    return { text: require('../shared/pouLayout.cjs').readLayoutFile(pouPath) };
  } catch (err) {
    return { error: err.message };
  }
});
ipcMain.handle('tc:layout-write', (_event, pouPath, text) => {
  try {
    return require('../shared/pouLayout.cjs').writeLayoutFile(pouPath, typeof text === 'string' ? text : null);
  } catch (err) {
    return { error: err.message };
  }
});

// The loaded POU's project files' TwinCAT version here and in git (XAE of another build converts them when it saves)
ipcMain.handle('tc:project-versions', (_event, pouPath) => require('../shared/projectVersions.cjs').projectVersions(pouPath));
ipcMain.handle('tc:project-builds', (_event, pouPath) => require('../shared/tcCompileInfo.cjs').recordProjectBuilds(pouPath));
ipcMain.handle('tc:revert-project-files', (_event, pouPath, paths) => require('../shared/projectVersions.cjs').revertProjectFiles(pouPath, paths));

ipcMain.handle('tc:git-show', async (_event, filePath) => {
  const { execFile } = require('child_process');
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return { error: 'Not a file of this computer' };
  return new Promise((resolve) => {
    execFile('git', ['-C', path.dirname(filePath), 'show', `HEAD:./${path.basename(filePath)}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const text = String(stderr || err.message || err);
        const error = /not a git repository/i.test(text)
          ? 'The file is not in a git repository'
          : /exists on disk, but not in|does not exist in/i.test(text)
            ? 'The file is not committed yet'
            : err.code === 'ENOENT'
              ? 'git is not installed'
              : text.trim().split(/\r?\n/)[0];
        resolve({ error });
        return;
      }
      resolve({ content: stdout.toString('utf8').replace(/^\uFEFF/, '') });
    });
  });
});

// Live view: follow a POU's state variable in a PLC on another computer (messages go back on 'tc:live').
// Each window has its own session.
function liveFor(contents) {
  let s = liveSessions.get(contents.id);
  if (!s) {
    // (a PLC's project kept in Documents\Kval MachineScope\PLC projects; KSS_DOCUMENTS: the tests' folder)
    s = createLiveSession({ documents: () => process.env.KSS_DOCUMENTS || app.getPath('documents') });
    liveSessions.set(contents.id, s);
  }
  return s;
}
ipcMain.handle('tc:live-start', (event, options) => {
  const contents = event.sender;
  const send = (m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  };
  liveFor(contents).start(send, options || {});
});
// Guard variables to follow in the window's running session (their values also come back on 'tc:live')
ipcMain.handle('tc:live-watch', (event, vars) => liveFor(event.sender).watch(vars));
// A followed variable's value written (XAE's Write Values; the app asks first): { id, value } → { ok, message }
ipcMain.handle('tc:live-write', (event, req) => liveFor(event.sender).write(req));
// Symbol browser: a symbol's members in the connected PLC (answered with liveBrowseResult on 'tc:live')
ipcMain.handle('tc:live-browse', (event, req) => {
  const contents = event.sender;
  return liveFor(contents).browse((m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  }, req);
});
// The PLC project's sources as the PLC keeps them (read-only: its boot folder over ADS), for the window's session
ipcMain.handle('tc:live-sources', (event, req) => new Promise((resolve) => liveFor(event.sender).sources(resolve, req)));
// A POU type's instances in a PLC before going live; a PLC started (or TwinCAT set to Run) from Browse; the found
// PLCs' states again
ipcMain.handle('tc:live-instances', (event, req) => new Promise((resolve) => liveFor(event.sender).instancesAt(resolve, req)));
ipcMain.handle('tc:plc-start-at', (event, req) => new Promise((resolve) => liveFor(event.sender).startAt(resolve, req)));
ipcMain.handle('tc:plc-states', (event, req) => new Promise((resolve) => liveFor(event.sender).plcStates(resolve, req)));
// The PLC's I/O tree (read-only: its boot folder's TwinCAT project), for the window's session
ipcMain.handle('tc:live-io-tree', (event, req) => new Promise((resolve) => liveFor(event.sender).ioTree(resolve, req)));
// A device's details for the I/O tab: TwinCAT's device descriptions (ESI), the user's pictures of it
// (Documents\Kval MachineScope\Devices; KSS_DOCUMENTS: the tests' folder)
const devicesDocuments = () => process.env.KSS_DOCUMENTS || app.getPath('documents');
ipcMain.handle('tc:device-info', (event, req) => require('../shared/tcDeviceInfo.cjs').deviceInfo(req ?? {}, devicesDocuments()));
// That pictures folder opened in Explorer (made first when missing)
ipcMain.handle('tc:open-devices-folder', async () => {
  const dir = require('../shared/tcDeviceInfo.cjs').devicesDirOf(devicesDocuments());
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  return { folder: dir, ...(err ? { error: err } : {}) };
});
// The EtherCAT masters' slave states (read-only), for the window's session
ipcMain.handle('tc:live-ecat-states', (event, req) => new Promise((resolve) => liveFor(event.sender).ecatStates(resolve, req)));
// The I/O tree of a TwinCAT project on this computer (offline): the open POU's project, else a folder chosen
// (KSS_PICK_PROJECT: the tests' folder, no dialog)
ipcMain.handle('tc:io-tree-folder', async (event, req) => {
  const { readIoFolder } = require('../shared/tcIoTree.cjs');
  let dir = req?.pick ? null : (req?.pouPath && require('../shared/tcBuild.cjs').projectRootOf(String(req.pouPath))) || null;
  if (!dir) dir = process.env.KSS_PICK_PROJECT || null;
  if (!dir) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'A TwinCAT project (the folder with its .tsproj)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true, devices: [], links: [] };
    dir = r.filePaths[0];
  }
  try {
    return await readIoFolder(dir);
  } catch (err) {
    return { devices: [], links: [], error: String(err?.message || err) };
  }
});
// The PLC's project kept on this computer (shared/plcProjectCopy.cjs): downloaded when new, else current / differs
ipcMain.handle('tc:live-project-copy', (event, req) => new Promise((resolve) => liveFor(event.sender).projectCopy(resolve, req)));
// A folder for a PLC's project (Save to a different location; KSS_PICK_FOLDER: the tests' folder, no dialog)
ipcMain.handle('tc:pick-folder', async (event, title) => {
  if (process.env.KSS_PICK_FOLDER) return { path: process.env.KSS_PICK_FOLDER };
  const win = BrowserWindow.fromWebContents(event.sender);
  const r = await dialog.showOpenDialog(win, { title: String(title || 'Choose a folder'), properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths[0] ? { canceled: true } : { path: r.filePaths[0] };
});
// Rebuild the PLC's project with the edits (TwinCAT XAE on this computer), and write it back when asked: progress on
// 'tc:live' (plcBuildProgress), the result returned
// Build (and write back) from the TwinCAT project the POU was opened from (a copy of it; the new compile
// information copied back after a write)
ipcMain.handle('tc:project-build', (event, req) => {
  const contents = event.sender;
  return new Promise((resolve) => liveFor(contents).projectBuild((m) => {
    if (m.type === 'plcBuildResult') resolve(m);
    else if (!contents.isDestroyed()) contents.send('tc:live', m);
  }, req));
});
ipcMain.handle('tc:live-build-close', (event, req) => new Promise((resolve) => liveFor(event.sender).closeBuild(resolve, req)));
// The connected PLC's TwinCAT trial license (read-only)
ipcMain.handle('tc:live-license', (event, req) => new Promise((resolve) => liveFor(event.sender).license(resolve, req)));
// The PLC application's state and online change count (did an online change from XAE take? read-only)
ipcMain.handle('tc:live-app-info', (event, req) => new Promise((resolve) => liveFor(event.sender).appInfo(resolve, req)));
// The PLC application started (after a write left it in Stop; the page confirms first)
ipcMain.handle('tc:live-plc-start', (event, req) => new Promise((resolve) => liveFor(event.sender).startPlc(resolve, req)));
// TwinCAT XAE opened for the user (its license page renews a trial license)
ipcMain.handle('tc:open-xae', () => require('../shared/tcBuild.cjs').openXae());
ipcMain.handle('tc:coverage-file', (_event, pouPath) => require('../shared/coverageFile.cjs').readCoverageFile(pouPath));
ipcMain.handle('tc:coverage-file-save', (_event, pouPath, pouType, counts) => require('../shared/coverageFile.cjs').mergeCoverageFile(pouPath, pouType, counts));
ipcMain.handle('tc:report-settings', (_event, pouPath) => require('../shared/reportSettings.cjs').readReportSettings(pouPath));
ipcMain.handle('tc:ms-files', (_event, pouPath) => require('../shared/projectVersions.cjs').machineScopeFiles(pouPath));
ipcMain.handle('tc:ms-files-act', (_event, pouPath, action) => require('../shared/projectVersions.cjs').machineScopeFilesAct(pouPath, action));
ipcMain.handle('tc:open-xae-for', (_event, pouPath, version) => require('../shared/projectVersions.cjs').openXaeForProject(pouPath, version));
// The engineering project for a POU from the PLC (Online change in XAE): its folder chosen (the one with the .tsproj;
// KSS_PICK_PROJECT: the tests' folder, no dialog), then the POU as edited saved into it (only a file already there)
ipcMain.handle('tc:pick-project-folder', async (event) => {
  let dir = process.env.KSS_PICK_PROJECT;
  if (!dir) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(win, { title: 'The TwinCAT project that runs on this PLC (the folder with its .tsproj)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    dir = r.filePaths[0];
  }
  try {
    if (!fs.readdirSync(dir).some((f) => /\.tsproj$/i.test(f))) return { error: `${path.basename(dir)} has no .tsproj: choose the TwinCAT project's folder` };
  } catch (err) {
    return { error: err.message };
  }
  return { path: dir };
});
ipcMain.handle('tc:save-into-project', (event, req) => require('../shared/tcBuild.cjs').saveIntoProject({ root: String(req?.root ?? ''), plcProject: String(req?.plcProject ?? ''), path: req?.path, content: req?.content }));
ipcMain.handle('tc:live-build', (event, req) => {
  const contents = event.sender;
  return new Promise((resolve) => liveFor(contents).build((m) => {
    if (m.type === 'plcBuildResult') resolve(m);
    else if (!contents.isDestroyed()) contents.send('tc:live', m);
  }, req));
});
// The Live tab's Browse: the TwinCAT devices on the network (UDP 48899 search; read-only). KSS_DISCOVERY_PORT and
// KSS_DISCOVERY_BROADCAST=0 are for the tests (a simulated device on another port, no broadcast)
ipcMain.handle('tc:discover-plcs', (_event, options) => {
  const { discover } = require('../shared/tcDiscovery.cjs');
  const { localIpTowards, defaultLocalNetId } = require('../shared/liveSession.cjs');
  const addresses = (Array.isArray(options?.addresses) ? options.addresses : [])
    .map((a) => String(a).trim())
    .filter((a) => /^[A-Za-z0-9.-]{1,253}$/.test(a))
    .slice(0, 64);
  // (the adapter towards the PLC asked for, else a real network one: not a virtual switch)
  const localNetId = /^\d+(\.\d+){5}$/.test(options?.localNetId ?? '') ? options.localNetId : defaultLocalNetId(localIpTowards(addresses[0] ?? ''));
  // (each found PLC described as going live would see it: TwinCAT's state, its PLC's, its project)
  return discover({ localNetId, addresses, broadcast: process.env.KSS_DISCOVERY_BROADCAST !== '0', port: Number(process.env.KSS_DISCOVERY_PORT) || 48899 })
    .then(async (r) => ({
      ...r,
      // (this computer's routes that did not answer: listed too, marked)
      devices: [...(await require('../shared/tcPlcState.cjs').describePlcs(r.devices)), ...(process.env.KSS_DISCOVERY_BROADCAST !== '0' ? require('../shared/tcDiscovery.cjs').routesNotAnswering(r.devices) : [])],
      localTwinCat: require('../shared/liveSession.cjs').localTwinCatNetId(),
    }));
});
// The Live tab's Check: why a PLC does not answer (all read-only)
ipcMain.handle('tc:check-connection', (_event, req) => {
  const { checkConnection } = require('../shared/tcCheck.cjs');
  const netId = String(req?.netId ?? '').trim();
  const ip = String(req?.ip ?? '').trim();
  if ((netId && !/^\d{1,3}(\.\d{1,3}){5}$/.test(netId)) || (ip && !/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(ip))) return { steps: [], verdict: 'Check the PLC address and AMS NetIds' };
  return checkConnection({ netId, ip, adsPort: Number.isInteger(req?.port) && req.port > 0 ? req.port : 851, localNetId: /^\d{1,3}(\.\d{1,3}){5}$/.test(req?.localNetId ?? '') ? req.localNetId : '', discoveryPort: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
});
// (installable: an installed app updates itself with its release's installer; the portable one, or one run from its
// sources, is updated by hand. KSS_DESKTOP_RELEASES: the tests' stand-in for the releases)
const installable = () => (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE) || !!process.env.KSS_DESKTOP_RELEASES;
ipcMain.handle('tc:app-info', () => ({ version: app.getVersion(), installable: installable(), ...(process.env.KSS_DESKTOP_RELEASES ? { releasesUrl: process.env.KSS_DESKTOP_RELEASES } : {}) }));
// Update now: the release's installer downloaded and checked, then started; this app closes for it
ipcMain.handle('tc:install-update', (_event, req) => {
  if (!installable()) return { ok: false, message: 'This app is not installed (portable, or run from its sources): download the new one from its release' };
  return require('../shared/desktopUpdate.cjs').installUpdate({
    repo: req?.repo,
    token: req?.token,
    version: req?.version,
    quiet: req?.quiet === true,
    start: (file, args) => {
      require('child_process').spawn(file, args, { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 800);
    },
  });
});
// The PLC switcher: which remembered PLCs answer (a TCP connect to their ADS router port, nothing sent)
ipcMain.handle('tc:probe-plcs', (_event, targets) => require('../shared/tcDiscovery.cjs').probeAll(Array.isArray(targets) ? targets.slice(0, 50) : []));
// Add Route: a route on the PLC to this computer (its IP towards the PLC and the AMS NetId the live view uses), with
// the PLC's user name and password as entered (never stored)
ipcMain.handle('tc:add-route', (_event, options) => require('../shared/tcRoutes.cjs').addRoutes({
  plcIp: options?.plcIp, plcNetId: options?.plcNetId, plcName: options?.plcName, user: options?.user, password: options?.password, localNetId: options?.localNetId,
  routeName: options?.routeName, both: options?.both === true, localUser: options?.localUser, localPassword: options?.localPassword,
}));
ipcMain.handle('tc:live-stop', (event) => {
  const contents = event.sender;
  return liveFor(contents).stop(true, (m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  });
});
// Other PLCs in the Machine Overview: a monitor session per window and key (browse and watched values, no state
// variable); their messages come on 'tc:side' as { key, message }
const sideSessions = new Map(); // `${contents.id}|${key}` -> session
const sideFor = (contents, key) => {
  const k = `${contents.id}|${key}`;
  if (!sideSessions.has(k)) {
    sideSessions.set(k, createLiveSession());
    contents.once('destroyed', () => {
      sideSessions.get(k)?.stop(false);
      sideSessions.delete(k);
    });
  }
  return sideSessions.get(k);
};
const sideSend = (contents, key) => (m) => {
  if (!contents.isDestroyed()) contents.send('tc:side', { key, message: m });
};
const sideKey = (key) => (typeof key === 'string' && /^[\w.:-]{1,80}$/.test(key) ? key : null);
ipcMain.handle('tc:side-start', (event, key, options) => {
  if (!sideKey(key)) return;
  const o = options || {};
  sideFor(event.sender, key).start(sideSend(event.sender, key), { netId: o.netId, ip: o.ip, port: o.port, localNetId: o.localNetId, stateVar: 'machineState', monitor: true });
});
ipcMain.handle('tc:side-watch', (event, key, vars) => (sideKey(key) ? sideFor(event.sender, key).watch(vars) : false));
ipcMain.handle('tc:side-browse', (event, key, req) => (sideKey(key) ? sideFor(event.sender, key).browse(sideSend(event.sender, key), req) : undefined));
ipcMain.handle('tc:side-stop', (event, key) => {
  if (!sideKey(key)) return;
  const k = `${event.sender.id}|${key}`;
  const s = sideSessions.get(k);
  sideSessions.delete(k);
  return s?.stop(true, sideSend(event.sender, key));
});
app.on('before-quit', () => {
  for (const s of liveSessions.values()) s.stop(false);
  for (const s of sideSessions.values()) s.stop(false);
});

// Windows groups taskbar buttons and pins by this id; it must match build.appId in package.json
if (process.platform === 'win32') app.setAppUserModelId('com.kval.machinescope');

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  createWindow(pouFromArgs(process.argv));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

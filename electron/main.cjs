const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readPouWithDutCandidates, saveSources, writeSource } = require('./tcSourceFiles.cjs');
const createLiveSession = require('./tcLive.cjs');

// ---- Opening a .TcPOU from Windows Explorer ("Open in Kval StateScope", or a file dropped on the exe) ----

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
    title: 'Kval StateScope',
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
      title: 'Kval StateScope',
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

// Project documentation: the PLC project's state machine POUs and enums
ipcMain.handle('tc:project-pous', async (_event, fromPath) => {
  const { projectPous } = require('./tcLiveTargets.cjs');
  if (typeof fromPath !== 'string') return { error: 'The POU was not opened from its folder' };
  return projectPous(fromPath);
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

ipcMain.handle('tc:save-file', async (event, name, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // A document (HTML, opened after saving) or a live recording (JSON)
  const recording = /\.json$/i.test(String(name));
  const result = await dialog.showSaveDialog(win, {
    title: recording ? 'Save the live recording' : 'Save the documentation',
    defaultPath: String(name || 'documentation.html'),
    filters: [recording ? { name: 'Live recording', extensions: ['json'] } : { name: 'HTML document', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    await require('fs/promises').writeFile(result.filePath, String(content), 'utf8');
    if (!recording) shell.openPath(result.filePath);
    return { path: result.filePath };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
});

// Compare: the committed (git HEAD) version of a file, from its folder's repository
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
    s = createLiveSession();
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
// Symbol browser: a symbol's members in the connected PLC (answered with liveBrowseResult on 'tc:live')
ipcMain.handle('tc:live-browse', (event, req) => {
  const contents = event.sender;
  return liveFor(contents).browse((m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  }, req);
});
// The Live tab's Browse: the TwinCAT devices on the network (UDP 48899 search; read-only). KSS_DISCOVERY_PORT and
// KSS_DISCOVERY_BROADCAST=0 are for the tests (a simulated device on another port, no broadcast)
ipcMain.handle('tc:discover-plcs', (_event, options) => {
  const { discover, localNetworks } = require('../shared/tcDiscovery.cjs');
  const addresses = (Array.isArray(options?.addresses) ? options.addresses : [])
    .map((a) => String(a).trim())
    .filter((a) => /^[A-Za-z0-9.-]{1,253}$/.test(a))
    .slice(0, 64);
  const localNetId = /^\d+(\.\d+){5}$/.test(options?.localNetId ?? '') ? options.localNetId : localNetworks()[0]?.netId;
  return discover({ localNetId, addresses, broadcast: process.env.KSS_DISCOVERY_BROADCAST !== '0', port: Number(process.env.KSS_DISCOVERY_PORT) || 48899 });
});
// Add Route: a route on the PLC to this computer (its IP towards the PLC and the AMS NetId the live view uses), with
// the PLC's user name and password as entered (never stored)
ipcMain.handle('tc:add-route', (_event, options) => {
  const { addRoute } = require('../shared/tcDiscovery.cjs');
  const { localIpTowards, defaultLocalNetId } = require('../shared/liveSession.cjs');
  const plcIp = String(options?.plcIp ?? '').trim().split(':')[0];
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(plcIp)) return { ok: false, message: 'The PLC\'s IP address is needed' };
  const hostAddress = localIpTowards(plcIp);
  const localNetId = /^\d+(\.\d+){5}$/.test(options?.localNetId ?? '') ? options.localNetId : defaultLocalNetId(hostAddress);
  return addRoute({
    plcIp, localNetId, hostAddress, routeName: String(options?.routeName || require('os').hostname()).slice(0, 60),
    user: String(options?.user ?? ''), password: String(options?.password ?? ''), port: Number(process.env.KSS_DISCOVERY_PORT) || 48899,
  });
});
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
if (process.platform === 'win32') app.setAppUserModelId('com.kval.statescope');

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

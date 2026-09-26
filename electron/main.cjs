const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readPouWithDutCandidates } = require('./tcSourceFiles.cjs');
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
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
ipcMain.handle('tc:save-file', async (event, name, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title: 'Save the documentation',
    defaultPath: String(name || 'documentation.html'),
    filters: [{ name: 'HTML document', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  try {
    await require('fs/promises').writeFile(result.filePath, String(content), 'utf8');
    shell.openPath(result.filePath);
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
ipcMain.handle('tc:live-stop', (event) => {
  const contents = event.sender;
  return liveFor(contents).stop(true, (m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  });
});
app.on('before-quit', () => {
  for (const s of liveSessions.values()) s.stop(false);
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

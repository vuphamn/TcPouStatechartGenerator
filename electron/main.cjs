const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { readPouWithDutCandidates } = require('./tcSourceFiles.cjs');
const live = require('./tcLive.cjs');

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

// One window: a second start (another file opened from Explorer) hands its file to the running app
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();
let mainWindow = null;
// Opened when the page asks for it (the app is not loaded yet when the window opens)
let startupPou = pouFromArgs(process.argv);

app.on('second-instance', async (_event, argv) => {
  const file = pouFromArgs(argv);
  if (!mainWindow) {
    startupPou = file ?? startupPou;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  if (file) mainWindow.webContents.send('tc:open-pou-file', await readPouForApp(file));
});

ipcMain.handle('tc:startup-pou', async () => {
  const file = startupPou;
  startupPou = null;
  return file ? readPouForApp(file) : null;
});

function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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

// Live view: follow a POU's state variable in a PLC on another computer (messages go back on 'tc:live')
ipcMain.handle('tc:live-start', (event, options) => {
  const contents = event.sender;
  const send = (m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  };
  live.start(send, options || {});
});
// Guard variables to follow in the running session (their values also come back on 'tc:live')
ipcMain.handle('tc:live-watch', (_event, vars) => live.watch(vars));
ipcMain.handle('tc:live-stop', (event) => {
  const contents = event.sender;
  return live.stop(true, (m) => {
    if (!contents.isDestroyed()) contents.send('tc:live', m);
  });
});
app.on('before-quit', () => {
  live.stop(false);
});

// Windows groups taskbar buttons and pins by this id; it must match build.appId in package.json
if (process.platform === 'win32') app.setAppUserModelId('com.kval.statescope');

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { readPouWithDutCandidates } = require('./tcSourceFiles.cjs');
const live = require('./tcLive.cjs');

function createWindow() {
  const mainWindow = new BrowserWindow({
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

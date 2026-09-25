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

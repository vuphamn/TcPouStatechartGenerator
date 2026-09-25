// Desktop-only API for the renderer (contextIsolation keeps Node out of the page)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  isDesktop: true,
  /** Native open dialog for a .TcPOU; resolves with its content and the .TcDUT files in its folder tree, or null */
  openPou: () => ipcRenderer.invoke('tc:open-pou'),
  /** Live view over ADS to a PLC on another computer (see electron/tcLive.cjs) */
  live: {
    start: (options) => ipcRenderer.invoke('tc:live-start', options),
    stop: () => ipcRenderer.invoke('tc:live-stop'),
    /** Subscribes to liveStatus / liveValues messages; returns the unsubscribe function */
    onMessage: (handler) => {
      const listener = (_event, message) => handler(message);
      ipcRenderer.on('tc:live', listener);
      return () => ipcRenderer.removeListener('tc:live', listener);
    },
  },
});

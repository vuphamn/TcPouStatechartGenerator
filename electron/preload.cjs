// Desktop-only API for the renderer (contextIsolation keeps Node out of the page)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  isDesktop: true,
  /** Native open dialog for a .TcPOU; resolves with its content and the .TcDUT files in its folder tree, or null */
  openPou: () => ipcRenderer.invoke('tc:open-pou'),
  /** The .TcPOU the app was started with (Explorer's Open in Kval StateScope), once; null when none */
  startupPou: () => ipcRenderer.invoke('tc:startup-pou'),
  /** A .TcPOU opened from Explorer while the app runs; returns the unsubscribe function */
  onOpenPouFile: (handler) => {
    const listener = (_event, source) => handler(source);
    ipcRenderer.on('tc:open-pou-file', listener);
    return () => ipcRenderer.removeListener('tc:open-pou-file', listener);
  },
  /** Another POU of the same PLC project, by type name or path: a PouSource or { error } */
  openPouInProject: (fromPath, typeName, filePath) => ipcRenderer.invoke('tc:open-pou-in-project', fromPath, typeName, filePath),
  /** Project documentation: the state machine POUs and enums of the PLC project that contains the file */
  projectPous: (fromPath) => ipcRenderer.invoke('tc:project-pous', fromPath),
  /** A save dialog for a document: { path } | { canceled } | { error } */
  saveFile: (name, content) => ipcRenderer.invoke('tc:save-file', name, content),
  /** The committed (git HEAD) version of a file: { content } or { error } */
  gitShow: (path) => ipcRenderer.invoke('tc:git-show', path),
  /** Live view over ADS to a PLC on another computer (see electron/tcLive.cjs) */
  live: {
    start: (options) => ipcRenderer.invoke('tc:live-start', options),
    stop: () => ipcRenderer.invoke('tc:live-stop'),
    /** Guard variables to follow: [{ id, candidates }] (answered with liveWatchResult, values in liveVars) */
    watch: (vars) => ipcRenderer.invoke('tc:live-watch', vars),
    /** Subscribes to liveStatus / liveValues / liveWatchResult / liveVars messages; returns the unsubscribe function */
    onMessage: (handler) => {
      const listener = (_event, message) => handler(message);
      ipcRenderer.on('tc:live', listener);
      return () => ipcRenderer.removeListener('tc:live', listener);
    },
  },
});

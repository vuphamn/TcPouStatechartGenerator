// Desktop-only API for the renderer (contextIsolation keeps Node out of the page)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  isDesktop: true,
  /** The app's version (updates: compared with the newest desktop release) */
  appInfo: () => ipcRenderer.invoke('tc:app-info'),
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
  /** The POU this window shows and the PLC instance it follows (Explorer / Open instance bring this window forward) */
  reportPou: (filePath, instance) => ipcRenderer.send('tc:current-pou', filePath || null, instance || null),
  /**
   * A new window, empty or with a .TcPOU (one already open in a window brings that window forward). launch:
   * { instance, live } follows that PLC instance of it; { handoff } takes a POU the page handed over
   */
  newWindow: (filePath, launch) => ipcRenderer.invoke('tc:new-window', filePath || null, launch || null),
  /** Another POU of the same PLC project, by type name or path: a PouSource or { error } */
  openPouInProject: (fromPath, typeName, filePath) => ipcRenderer.invoke('tc:open-pou-in-project', fromPath, typeName, filePath),
  /** Project documentation: the state machine POUs and enums of the PLC project that contains the file */
  projectPous: (fromPath) => ipcRenderer.invoke('tc:project-pous', fromPath),
  projectSymbols: (fromPath) => ipcRenderer.invoke('tc:project-symbols', fromPath),
  projectUses: (fromPath, name) => ipcRenderer.invoke('tc:project-uses', fromPath, name),
  /** A save dialog for a document: { path } | { canceled } | { error } */
  saveFile: (name, content) => ipcRenderer.invoke('tc:save-file', name, content),
  // The edited sources back to their files; Save As a new file
  saveSources: (files) => ipcRenderer.invoke('tc:save-sources', files),
  saveSourceAs: (name, content, defaultDir) => ipcRenderer.invoke('tc:save-source-as', name, content, defaultDir || null),
  /** The committed (git HEAD) version of a file: { content } or { error } */
  gitShow: (path) => ipcRenderer.invoke('tc:git-show', path),
  /** Live view over ADS to a PLC on another computer (see electron/tcLive.cjs) */
  live: {
    start: (options) => ipcRenderer.invoke('tc:live-start', options),
    stop: () => ipcRenderer.invoke('tc:live-stop'),
    /** Guard variables to follow: [{ id, candidates }] (answered with liveWatchResult, values in liveVars) */
    watch: (vars) => ipcRenderer.invoke('tc:live-watch', vars),
    /** Symbol browser: { requestId, path, stateVar } (answered with liveBrowseResult) */
    browse: (req) => ipcRenderer.invoke('tc:live-browse', req),
    /** The PLC project's sources as the PLC keeps them: { project, plcProject, files: [{ path, content }] } or { error } */
    sources: (req) => ipcRenderer.invoke('tc:live-sources', req),
    /** Rebuild the PLC's project with edits, write it back: { requestId, edits, write? } -> plcBuildResult (progress: plcBuildProgress) */
    build: (req) => ipcRenderer.invoke('tc:live-build', req),
    /** Close the XAE kept open for builds now -> plcBuildClosed { closed } */
    closeBuild: (req) => ipcRenderer.invoke('tc:live-build-close', req),
    /** Build from the TwinCAT project on this computer: { requestId, file, edits: [{ file, content }], write? } */
    projectBuild: (req) => ipcRenderer.invoke('tc:project-build', req),
    /** The connected PLC's TwinCAT trial license -> { trial, state } */
    license: (req) => ipcRenderer.invoke('tc:live-license', req),
    /** The PLC application's state and online change count -> { state, onlineChanges } */
    appInfo: (req) => ipcRenderer.invoke('tc:live-app-info', req),
    /** The PLC application started -> { state, ok, error } */
    startPlc: (req) => ipcRenderer.invoke('tc:live-plc-start', req),
    /** TwinCAT XAE opened for the user -> { ok, message } */
    openXae: () => ipcRenderer.invoke('tc:open-xae'),
    /** The engineering project's folder chosen -> { path } | { canceled } | { error } */
    pickProjectFolder: () => ipcRenderer.invoke('tc:pick-project-folder'),
    /** A POU saved into it: { root, plcProject, path, content } -> { file } | { error } */
    saveIntoProject: (req) => ipcRenderer.invoke('tc:save-into-project', req),
    /** The Live tab's Check: why a PLC does not answer, { steps, verdict, suggest? } */
    checkConnection: (req) => ipcRenderer.invoke('tc:check-connection', req),
    /** The Live tab's Browse: the TwinCAT devices on the network, { devices, errors } */
    discoverPlcs: (options) => ipcRenderer.invoke('tc:discover-plcs', options),
    /** Add Route on a PLC to this computer: { plcIp, user, password, routeName?, localNetId? } -> { ok, message } */
    addRoute: (options) => ipcRenderer.invoke('tc:add-route', options),
    /** Which PLCs answer: [{ key, ip }] -> { key: boolean } */
    probePlcs: (targets) => ipcRenderer.invoke('tc:probe-plcs', targets),
    /** Other PLCs in the Machine Overview: monitor sessions by key (browse, watched values; no state variable) */
    side: {
      start: (key, options) => ipcRenderer.invoke('tc:side-start', key, options),
      stop: (key) => ipcRenderer.invoke('tc:side-stop', key),
      watch: (key, vars) => ipcRenderer.invoke('tc:side-watch', key, vars),
      browse: (key, req) => ipcRenderer.invoke('tc:side-browse', key, req),
      /** { key, message } for every session's liveStatus / liveVars / liveBrowseResult; returns the unsubscribe function */
      onMessage: (handler) => {
        const listener = (_event, m) => handler(m);
        ipcRenderer.on('tc:side', listener);
        return () => ipcRenderer.removeListener('tc:side', listener);
      },
    },
    /** Subscribes to liveStatus / liveValues / liveWatchResult / liveVars messages; returns the unsubscribe function */
    onMessage: (handler) => {
      const listener = (_event, message) => handler(message);
      ipcRenderer.on('tc:live', listener);
      return () => ipcRenderer.removeListener('tc:live', listener);
    },
  },
});

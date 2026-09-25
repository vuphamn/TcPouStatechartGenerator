// Desktop-only API for the renderer (contextIsolation keeps Node out of the page)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tcDesktop', {
  isDesktop: true,
  /** Native open dialog for a .TcPOU; resolves with its content and the .TcDUT files in its folder tree, or null */
  openPou: () => ipcRenderer.invoke('tc:open-pou'),
});

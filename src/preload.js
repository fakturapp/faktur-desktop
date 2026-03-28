const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturShell', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getURL: () => ipcRenderer.sendSync('get-faktur-url'),

  // Download events
  onDownloadStart: (cb) => ipcRenderer.on('download-start', (_, d) => cb(d)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_, d) => cb(d)),
  onDownloadComplete: (cb) => ipcRenderer.on('download-complete', (_, d) => cb(d)),
  onDownloadError: (cb) => ipcRenderer.on('download-error', (_, d) => cb(d)),

  // Download history
  getDownloadHistory: () => ipcRenderer.invoke('get-download-history'),
  clearDownloadHistory: () => ipcRenderer.send('clear-download-history'),

  // File operations
  openDownloadFile: (p) => ipcRenderer.send('open-download-file', p),
  openDownloadFolder: (p) => ipcRenderer.send('open-download-folder', p)
});

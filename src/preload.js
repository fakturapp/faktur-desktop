const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturShell', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getURL: () => ipcRenderer.sendSync('get-faktur-url'),
  getSitePreloadPath: () => ipcRenderer.sendSync('get-site-preload-path'),

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
  openDownloadFolder: (p) => ipcRenderer.send('open-download-folder', p),

  // Credentials
  saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
  getCredentials: (url) => ipcRenderer.invoke('get-credentials', url),

  // Load error forwarded from main process
  onWebviewLoadError: (cb) => ipcRenderer.on('webview-load-error', (_, d) => cb(d))
});

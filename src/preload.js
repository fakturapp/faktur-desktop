const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturApp', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, data) => callback(data)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (_, data) => callback(data)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (_, data) => callback(data))
});

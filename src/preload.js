const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturApp', {
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_, data) => callback(data)),
  onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (_, data) => callback(data)),
  onDownloadError: (callback) => ipcRenderer.on('download-error', (_, data) => callback(data))
});

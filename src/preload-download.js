const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturDownload', {
  onStart: (callback) => ipcRenderer.on('download-start', (_, data) => callback(data)),
  onProgress: (callback) => ipcRenderer.on('download-progress', (_, data) => callback(data)),
  onComplete: (callback) => ipcRenderer.on('download-complete', (_, data) => callback(data)),
  onError: (callback) => ipcRenderer.on('download-error', (_, data) => callback(data)),
  close: () => ipcRenderer.send('download-window-close')
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fakturShell', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  getURL: () => ipcRenderer.sendSync('get-faktur-url')
});

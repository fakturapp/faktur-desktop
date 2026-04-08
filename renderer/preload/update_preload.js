'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// ---------- Update window bridge ----------
contextBridge.exposeInMainWorld('fakturUpdate', {
  getUpdateInfo: () => ipcRenderer.invoke('update:get-info'),
  start: () => ipcRenderer.invoke('update:start-download'),
  onProgress: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
})

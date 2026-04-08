'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('faktur', {
  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  startAuth: () => ipcRenderer.invoke('auth:start'),
  openExternal: (url) => ipcRenderer.invoke('window:open-external', url),
  onSessionChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('session:state-changed', handler)
    return () => ipcRenderer.removeListener('session:state-changed', handler)
  },
})

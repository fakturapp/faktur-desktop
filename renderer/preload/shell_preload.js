'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fakturDesktop', {
  isDesktop: true,
  version: '2.0.0',

  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openVaultUnlock: () => ipcRenderer.invoke('vault:open-unlock'),
  openExternal: (url) => ipcRenderer.invoke('window:open-external', url),

  onSessionChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('session:state-changed', handler)
    return () => ipcRenderer.removeListener('session:state-changed', handler)
  },
})

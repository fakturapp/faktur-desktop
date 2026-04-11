'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('faktur', {
  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  startAuth: (opts) => {
    const safe =
      opts && typeof opts === 'object'
        ? { intent: opts.intent === 'register' ? 'register' : 'login' }
        : {}
    return ipcRenderer.invoke('auth:start', safe)
  },
  openExternal: (url) => ipcRenderer.invoke('window:open-external', url),
  onSessionChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('session:state-changed', handler)
    return () => ipcRenderer.removeListener('session:state-changed', handler)
  },
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getPendingUpdate: () => ipcRenderer.invoke('update:get-pending'),
  beginUpdate: () => ipcRenderer.invoke('update:begin'),
  onUpdateAvailable: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
})

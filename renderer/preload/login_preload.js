'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// ---------- Login window bridge ----------
// Exposes only what the login page actually needs.
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
})

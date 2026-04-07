'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * Exposes a tiny, deliberately minimal API to the login window
 * renderer. Only what the 'Se connecter' button actually needs —
 * no arbitrary IPC access, no Node built-ins.
 */
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

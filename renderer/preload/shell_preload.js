'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('fakturDesktop', {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  platform: process.platform,

  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getCertificationStatus: () => ipcRenderer.invoke('attestation:get-status'),
  logout: (opts) => {
    const safeOpts = opts && typeof opts === 'object' ? { wipeAll: !!opts.wipeAll } : {}
    return ipcRenderer.invoke('auth:logout', safeOpts)
  },
  openVaultUnlock: () => ipcRenderer.invoke('vault:open-unlock'),
  openExternal: (url) => {
    if (typeof url !== 'string') return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('window:open-external', url)
  },

  getPendingUpdate: () => ipcRenderer.invoke('update:get-pending'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  beginUpdate: () => ipcRenderer.invoke('update:begin'),
  onUpdateAvailable: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, info) => listener(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },

  onSessionChange: (listener) => {
    if (typeof listener !== 'function') return () => {}
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('session:state-changed', handler)
    return () => ipcRenderer.removeListener('session:state-changed', handler)
  },
})

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

// ---------- fakturDesktop bridge ----------
// Minimal, strictly-filtered API exposed to the dashboard renderer.
// Everything goes through named IPC channels; no Node globals leak.
contextBridge.exposeInMainWorld('fakturDesktop', {
  isDesktop: true,
  version: '2.1.0',
  platform: process.platform,

  getSessionState: () => ipcRenderer.invoke('session:get-state'),
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getCertificationStatus: () => ipcRenderer.invoke('attestation:get-status'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  openVaultUnlock: () => ipcRenderer.invoke('vault:open-unlock'),
  openExternal: (url) => {
    if (typeof url !== 'string') return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('window:open-external', url)
  },

  // ---------- Update API ----------
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

'use strict'

const { ipcMain, shell } = require('electron')
const constants = require('../config/constants')
const tokenManager = require('../oauth/token_manager')
const config = require('../config/env')

// ---------- IPC registration ----------
function registerIpcHandlers({ onSessionChange }) {
  const { ipc } = constants

  ipcMain.handle(ipc.SESSION_GET_STATE, () => {
    return { state: tokenManager.state }
  })

  ipcMain.handle(ipc.AUTH_START, async () => {
    try {
      await tokenManager.startAuthorizationFlow()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || 'authentication failed' }
    }
  })

  ipcMain.handle(ipc.AUTH_LOGOUT, async () => {
    await tokenManager.logout({ remoteRevoke: true, reason: 'user_logout' })
    return { ok: true }
  })

  ipcMain.handle(ipc.VAULT_OPEN_UNLOCK, async () => {
    const url = `${config.urls.dashboard}/vault/unlock?source=desktop`
    await shell.openExternal(url).catch(() => {})
    return { ok: true }
  })

  ipcMain.handle(ipc.OPEN_EXTERNAL, async (_event, url) => {
    if (typeof url !== 'string') return { ok: false }
    if (!/^https?:\/\//.test(url)) return { ok: false }
    await shell.openExternal(url).catch(() => {})
    return { ok: true }
  })

  ipcMain.handle(ipc.GET_APP_INFO, () => {
    return {
      version: '2.0.0',
      platform: process.platform,
      isDesktop: true,
    }
  })

  // ---------- Session forwarder ----------
  tokenManager.onStateChange((payload) => {
    onSessionChange?.(payload)
  })
}

module.exports = { registerIpcHandlers }

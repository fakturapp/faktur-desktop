'use strict'

const { ipcMain, shell } = require('electron')
const constants = require('../config/constants')
const tokenManager = require('../oauth/token_manager')
const config = require('../config/env')

/**
 * Wires every main-process IPC handler. Called once at boot from
 * main.js. Handlers are idempotent and safe to call multiple times
 * in case the preload registers late.
 */
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
    // The vault unlock flow is handled in the browser, not in Electron —
    // we open a dedicated page on the dashboard that ends the flow by
    // redirecting back to a desktop-specific deep link.
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

  // Forward session changes from the token manager to every renderer.
  tokenManager.onStateChange((payload) => {
    onSessionChange?.(payload)
  })
}

module.exports = { registerIpcHandlers }

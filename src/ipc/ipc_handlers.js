'use strict'

const { ipcMain, shell, BrowserWindow } = require('electron')
const constants = require('../config/constants')
const tokenManager = require('../oauth/token_manager')
const updater = require('../update/updater')
const attestation = require('../security/attestation')
const config = require('../config/env')

// ---------- IPC registration ----------
function registerIpcHandlers({ onSessionChange, onUpdateBegin }) {
  const { ipc } = constants

  // ---------- Session ----------
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
      version: updater.getCurrentVersion(),
      platform: process.platform,
      isDesktop: true,
    }
  })

  // ---------- Attestation ----------
  ipcMain.handle(ipc.ATTESTATION_GET_STATUS, () => {
    return attestation.getCertificationStatus()
  })

  // ---------- Update ----------
  ipcMain.handle(ipc.UPDATE_GET_PENDING, () => {
    return updater.getCachedUpdate()
  })

  ipcMain.handle(ipc.UPDATE_CHECK, async () => {
    const info = await updater.checkForUpdate({ silent: true })
    return info
  })

  ipcMain.handle(ipc.UPDATE_BEGIN, async () => {
    if (typeof onUpdateBegin === 'function') {
      await onUpdateBegin()
    }
    return { ok: true }
  })

  ipcMain.handle(ipc.UPDATE_GET_INFO, () => {
    return updater.getCachedUpdate()
  })

  ipcMain.handle(ipc.UPDATE_START_DOWNLOAD, async (event) => {
    try {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
      await updater.downloadAndInstall({
        onProgress: (payload) => {
          if (targetWindow && !targetWindow.isDestroyed()) {
            targetWindow.webContents.send(ipc.UPDATE_PROGRESS, {
              phase: 'downloading',
              ...payload,
            })
          }
        },
      })
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(ipc.UPDATE_PROGRESS, { phase: 'launching' })
      }
      return { ok: true }
    } catch (err) {
      const targetWindow = BrowserWindow.fromWebContents(event.sender)
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send(ipc.UPDATE_PROGRESS, {
          phase: 'error',
          message: err?.message || 'Download failed',
        })
      }
      return { ok: false, error: err?.message || 'Download failed' }
    }
  })

  // ---------- Session forwarder ----------
  tokenManager.onStateChange((payload) => {
    onSessionChange?.(payload)
  })
}

module.exports = { registerIpcHandlers }

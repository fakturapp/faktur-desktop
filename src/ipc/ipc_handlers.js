'use strict'

const { ipcMain, shell, BrowserWindow } = require('electron')
const constants = require('../config/constants')
const tokenManager = require('../oauth/token_manager')
const updater = require('../update/updater')
const attestation = require('../security/attestation')
const config = require('../config/env')
const preferences = require('../store/preferences')
const sessionBridgeState = require('../store/session_bridge_state')

function registerIpcHandlers({ onSessionChange, onUpdateBegin, onTeamSelected }) {
  const { ipc } = constants

  ipcMain.handle(ipc.SESSION_GET_STATE, () => {
    return { state: tokenManager.state }
  })

  ipcMain.handle(ipc.AUTH_START, async (_event, opts) => {
    try {
      const intent =
        opts && typeof opts === 'object' && opts.intent === 'register' ? 'register' : 'login'
      await tokenManager.startAuthorizationFlow({ intent })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err?.message || 'authentication failed' }
    }
  })

  ipcMain.handle(ipc.AUTH_LOGOUT, async (_event, opts) => {
    const wipeAll = !!(opts && opts.wipeAll)
    await tokenManager.logout({
      remoteRevoke: true,
      reason: 'user_logout',
      wipeAll,
    })
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
              phase: payload?.phase || 'downloading',
              ...payload,
            })
          }
        },
      })
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

  ipcMain.handle(ipc.PREFS_GET, () => {
    return preferences.read()
  })

  ipcMain.handle(ipc.PREFS_SET, (_event, patch) => {
    if (!patch || typeof patch !== 'object') return preferences.read()
    const allowed = {}
    if (typeof patch.alwaysShowTeamSelect === 'boolean') {
      allowed.alwaysShowTeamSelect = patch.alwaysShowTeamSelect
    }
    if (patch.lastTeamId === null || typeof patch.lastTeamId === 'string') {
      allowed.lastTeamId = patch.lastTeamId
    }
    return preferences.write(allowed)
  })

  ipcMain.handle(ipc.SESSION_GET_BRIDGE, () => {
    const bridged = sessionBridgeState.get()
    if (!bridged) return null
    const rawUser = bridged.user || {}
    const teamsArr = Array.isArray(bridged.teams) ? bridged.teams : []
    return {
      user: {
        id: rawUser.id ?? null,
        fullName: rawUser.fullName ?? rawUser.full_name ?? null,
        email: rawUser.email ?? null,
        avatarUrl: rawUser.avatarUrl ?? rawUser.avatar_url ?? null,
        initials: rawUser.initials ?? null,
      },
      teams: teamsArr.map((t) => ({
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        iconUrl: t.iconUrl ?? t.icon_url ?? null,
        encryptionMode: t.encryptionMode ?? t.encryption_mode ?? 'standard',
        locked: !!t.locked,
        role: t.role ?? null,
      })),
      vaultLocked: !!bridged.vaultLocked,
      vaultRequired: !!bridged.vaultRequired,
      currentTeamEncryptionMode: bridged.currentTeamEncryptionMode ?? null,
      allUnlockedOrStandard: bridged.allUnlockedOrStandard !== false,
    }
  })

  ipcMain.handle(ipc.SESSION_SELECT_TEAM, async (_event, opts) => {
    if (!opts || typeof opts !== 'object') return { ok: false, error: 'invalid_payload' }
    const teamId = typeof opts.teamId === 'string' ? opts.teamId : null
    if (!teamId) return { ok: false, error: 'missing_team_id' }
    const persist = !!opts.persistAsDefault
    sessionBridgeState.setSelectedTeamId(teamId)
    if (typeof opts.alwaysShowTeamSelect === 'boolean') {
      preferences.write({ alwaysShowTeamSelect: opts.alwaysShowTeamSelect })
    }
    if (persist) preferences.write({ lastTeamId: teamId })
    if (typeof onTeamSelected === 'function') {
      await onTeamSelected({ teamId })
    }
    return { ok: true }
  })

  ipcMain.handle(ipc.VAULT_REQUEST_UNLOCK, async (_event, opts) => {
    const teamId = opts && typeof opts.teamId === 'string' ? opts.teamId : null
    const params = new URLSearchParams({ source: 'desktop' })
    if (teamId) params.set('team', teamId)
    const url = `${config.urls.dashboard}/vault/unlock?${params.toString()}`
    await shell.openExternal(url).catch(() => {})
    return { ok: true }
  })

  tokenManager.onStateChange((payload) => {
    onSessionChange?.(payload)
  })
}

module.exports = { registerIpcHandlers }

'use strict'

const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

let config
try {
  config = require('../config/env')
} catch (err) {
  console.error(err?.message || err)
  app.exit(1)
}

const constants = require('../config/constants')
const tokenManager = require('../oauth/token_manager')
const updater = require('../update/updater')
const { createLoginWindow } = require('../windows/login_window')
const { createShellWindow } = require('../windows/shell_window')
const { createUpdateWindow } = require('../windows/update_window')
const { registerIpcHandlers } = require('../ipc/ipc_handlers')
const {
  enforceLaunchFlagPolicy,
  installGlobalContentsGuard,
  installHttpsOnlyGuard,
  installCertificateValidator,
  removeApplicationMenu,
  startDebuggerWatchdog,
} = require('../security/hardening')

enforceLaunchFlagPolicy()

app.enableSandbox()

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const wins = BrowserWindow.getAllWindows()
    if (wins.length > 0) {
      if (wins[0].isMinimized()) wins[0].restore()
      wins[0].focus()
    }
  })
}

let currentWindow = null
let lastLogoutReason = null
let swapping = false

async function openForState(state, options = {}) {
  if (swapping) return
  swapping = true
  try {
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.removeAllListeners('closed')
      currentWindow.close()
      currentWindow = null
    }

    if (state === constants.session.AUTHENTICATED) {
      currentWindow = await createShellWindow({
        onFatalError: async (reason) => {
          if (reason === 'session_expired' || reason === 'network_error') {
            await openForState(constants.session.AUTHENTICATED)
            return
          }
          lastLogoutReason = reason
          await tokenManager.logout({ remoteRevoke: false, reason })
        },
      })
    } else {
      currentWindow = createLoginWindow({
        disconnectReason: options.reason || lastLogoutReason,
      })
    }

    currentWindow.on('closed', () => {
      currentWindow = null
    })
  } finally {
    swapping = false
  }
}

async function beginUpdate() {
  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.removeAllListeners('closed')
    currentWindow.close()
    currentWindow = null
  }
  currentWindow = createUpdateWindow()
  currentWindow.on('closed', () => {
    currentWindow = null
  })
}

function pushUpdateToWindows(info) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(constants.ipc.UPDATE_AVAILABLE, info)
  }
}

async function scheduleUpdateCheck() {
  setTimeout(async () => {
    const info = await updater.checkForUpdate({ silent: true })
    if (info) pushUpdateToWindows(info)
  }, 800)
  setInterval(async () => {
    const info = await updater.checkForUpdate({ silent: true })
    if (info) pushUpdateToWindows(info)
  }, 1000 * 60 * 60)
}

function purgeStalePartitionDirs() {
  const stale = [
    'Partitions/faktur-desktop-login',
    'Partitions/faktur-desktop-update',
    'Partitions/persist%3Afaktur-desktop-login',
    'Partitions/persist%3Afaktur-desktop-update',
  ]
  const base = app.getPath('userData')
  for (const rel of stale) {
    try {
      const full = path.join(base, rel)
      if (fs.existsSync(full)) {
        fs.rmSync(full, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 150,
        })
      }
    } catch {
    }
  }
}

async function bootstrap() {
  removeApplicationMenu()

  purgeStalePartitionDirs()

  installGlobalContentsGuard([
    config.urls.dashboard,
    config.api.baseUrl,
    'http://127.0.0.1',
    'http://localhost',
    'file://',
  ])

  for (const sessionInstance of [
    session.defaultSession,
    session.fromPartition('persist:faktur-desktop-shell'),
    session.fromPartition('faktur-desktop-login-v2'),
    session.fromPartition('faktur-desktop-update-v2'),
  ]) {
    installHttpsOnlyGuard(sessionInstance)
    installCertificateValidator(sessionInstance)
  }

  startDebuggerWatchdog()

  registerIpcHandlers({
    onSessionChange: async (payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(constants.ipc.SESSION_STATE_CHANGED, payload)
      }
      if (
        payload.state === constants.session.AUTHENTICATED &&
        currentWindow?.getTitle?.()?.includes('Connexion')
      ) {
        lastLogoutReason = null
        await openForState(constants.session.AUTHENTICATED)
      }
      if (payload.state === constants.session.UNAUTHENTICATED && currentWindow) {
        if (payload.reason) lastLogoutReason = payload.reason
        await openForState(constants.session.UNAUTHENTICATED, { reason: payload.reason })
      }
    },
    onUpdateBegin: beginUpdate,
  })

  const initial = tokenManager.bootstrap()
  await openForState(initial)
  scheduleUpdateCheck()
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const state = tokenManager.bootstrap()
    await openForState(state)
  }
})

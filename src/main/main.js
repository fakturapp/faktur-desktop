'use strict'

const { app, BrowserWindow, session } = require('electron')

// ---------- Env (must load before app.whenReady for early failures) ----------
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

// ---------- Launch-flag policy (runs before any other Electron API) ----------
enforceLaunchFlagPolicy()

// ---------- Global sandbox ----------
// Forces every renderer process the app spawns to run inside a
// restricted Chromium sandbox. Must be called before app.whenReady.
app.enableSandbox()

// ---------- Single-instance lock ----------
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

// ---------- Window lifecycle ----------
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

// ---------- Update flow ----------
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
  }, 4000)
  setInterval(async () => {
    const info = await updater.checkForUpdate({ silent: true })
    if (info) pushUpdateToWindows(info)
  }, 1000 * 60 * 60)
}

// ---------- Bootstrap ----------
async function bootstrap() {
  // ---------- Kill the application menu ----------
  // Removes every "View → Toggle DevTools" entry from the native menu
  // bar. Must run before windows are created.
  removeApplicationMenu()

  // ---------- Global web-contents guard ----------
  installGlobalContentsGuard([
    config.urls.dashboard,
    config.api.baseUrl,
    'http://127.0.0.1',
    'http://localhost',
    'file://',
  ])

  // ---------- HTTPS-only + cert validation on every session ----------
  for (const sessionInstance of [
    session.defaultSession,
    session.fromPartition('persist:faktur-desktop-shell'),
    session.fromPartition('persist:faktur-desktop-login'),
    session.fromPartition('persist:faktur-desktop-update'),
  ]) {
    installHttpsOnlyGuard(sessionInstance)
    installCertificateValidator(sessionInstance)
  }

  // ---------- Runtime debugger detection (prod only) ----------
  startDebuggerWatchdog()

  // ---------- IPC wiring ----------
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

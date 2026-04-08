'use strict'

const { app, BrowserWindow } = require('electron')

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
const { createLoginWindow } = require('../windows/login_window')
const { createShellWindow } = require('../windows/shell_window')
const { registerIpcHandlers } = require('../ipc/ipc_handlers')
const {
  enforceLaunchFlagPolicy,
  installGlobalContentsGuard,
} = require('../security/hardening')

// ---------- Launch-flag policy (must run before anything else) ----------
enforceLaunchFlagPolicy()

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

// ---------- Bootstrap ----------
async function bootstrap() {
  installGlobalContentsGuard([
    config.urls.dashboard,
    config.api.baseUrl,
    'http://127.0.0.1',
    'http://localhost',
    'file://',
  ])

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
  })

  const initial = tokenManager.bootstrap()
  await openForState(initial)
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

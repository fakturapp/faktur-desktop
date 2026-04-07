'use strict'

/**
 * Faktur Desktop — main process entry point.
 *
 * Responsibilities:
 *   1. Enforce single-instance lock.
 *   2. Load env / crypto / store.
 *   3. Bootstrap the token manager.
 *   4. Open the login window when unauthenticated, the shell window
 *      otherwise.
 *   5. Wire the IPC bridge so both windows can drive the auth flow
 *      from their respective renderers.
 */

const { app, BrowserWindow } = require('electron')

// Must be required BEFORE `app.whenReady` so env errors surface early.
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

// Enforce a single instance so OAuth callbacks don't fight multiple
// loopback listeners for the same port.
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

/** Holds a reference to whatever window is currently on screen. */
let currentWindow = null
/** Reason code for the most recent logout — forwarded to the login
 *  window so it can display the 'Vous avez été déconnecté' banner. */
let lastLogoutReason = null

async function openForState(state, options = {}) {
  // Tear down any open window before we put a different one up.
  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.close()
    currentWindow = null
  }

  if (state === constants.session.AUTHENTICATED) {
    currentWindow = await createShellWindow({
      onFatalError: async (reason) => {
        lastLogoutReason = reason
        await tokenManager.logout({ remoteRevoke: false, reason })
      },
    })
  } else {
    currentWindow = createLoginWindow({ disconnectReason: options.reason || lastLogoutReason })
  }

  currentWindow.on('closed', () => {
    currentWindow = null
  })
}

async function bootstrap() {
  // Block remote content in unexpected windows.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (evt, url) => {
      // Allow navigation inside the dashboard + loopback responses only.
      const allowed = [config.urls.dashboard, config.api.baseUrl, 'http://127.0.0.1', 'http://localhost']
      if (!allowed.some((prefix) => url.startsWith(prefix))) {
        evt.preventDefault()
      }
    })
  })

  registerIpcHandlers({
    onSessionChange: async (payload) => {
      // Forward to every open renderer.
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(constants.ipc.SESSION_STATE_CHANGED, payload)
      }
      // And switch windows when we cross the auth boundary.
      if (
        payload.state === constants.session.AUTHENTICATED &&
        currentWindow?.getTitle?.()?.includes('Connexion')
      ) {
        lastLogoutReason = null
        await openForState(constants.session.AUTHENTICATED)
      }
      if (payload.state === constants.session.UNAUTHENTICATED && currentWindow) {
        // Remember why we got kicked out so the login window can show it.
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

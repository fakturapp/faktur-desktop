'use strict'

const path = require('node:path')
const { BrowserWindow, shell, session } = require('electron')
const config = require('../config/env')
const tokenManager = require('../oauth/token_manager')

/**
 * Factory for the main authenticated shell. We load the real dashboard
 * inside a BrowserWindow and attach an in-process session listener
 * that injects the Authorization header on every request to the API
 * origin. Everything else goes out as-is.
 *
 * The dashboard runs as if it were a full browser tab so all its
 * existing auth logic (AuthProvider + vault unlock) keeps working.
 * The only thing we intercept is the API host so we can plug our
 * OAuth token in.
 */
async function createShellWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Faktur',
    backgroundColor: '#faf9f7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'shell_preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: config.devtools,
    },
  })

  await installApiAuthBridge(win)
  await win.loadURL(config.urls.dashboard)

  win.once('ready-to-show', () => {
    win.show()
    if (config.devtools) win.webContents.openDevTools({ mode: 'detach' })
  })

  // External links open in the system browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  return win
}

/**
 * Attaches a session-level `onBeforeSendHeaders` listener that adds
 * the Authorization: Bearer <token> header to every request hitting
 * the API base URL. We fetch a fresh token lazily so we always honour
 * the refresh margin.
 */
async function installApiAuthBridge(win) {
  const apiHost = new URL(config.api.baseUrl).host

  const ses = win.webContents.session
  ses.webRequest.onBeforeSendHeaders(async (details, callback) => {
    try {
      const target = new URL(details.url)
      if (target.host !== apiHost) {
        return callback({ requestHeaders: details.requestHeaders })
      }
      const token = await tokenManager.getAccessToken().catch(() => null)
      const headers = { ...details.requestHeaders }
      if (token) headers['Authorization'] = `Bearer ${token}`
      callback({ requestHeaders: headers })
    } catch {
      callback({ requestHeaders: details.requestHeaders })
    }
  })
}

module.exports = { createShellWindow }

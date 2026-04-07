'use strict'

const path = require('node:path')
const { BrowserWindow, shell } = require('electron')
const config = require('../config/env')
const tokenManager = require('../oauth/token_manager')
const { exchangeForDashboardSession } = require('../oauth/session_bridge')

/**
 * Identifier we stamp onto every request the shell makes. The frontend
 * reads this (via navigator.userAgent) to detect that it's running
 * inside Faktur Desktop and bypass the regular email/password login
 * form, which would be a dead end here.
 */
const DESKTOP_USER_AGENT_SUFFIX = 'FakturDesktop/2.0'

/**
 * Factory for the main authenticated shell. We load the real dashboard
 * inside a BrowserWindow and:
 *
 *  1. Tag every outbound request with a `FakturDesktop/2.0` user-agent
 *     suffix so the frontend and analytics can tell we're the desktop.
 *  2. Exchange the OAuth access token for a dashboard session token
 *     via POST /oauth/exchange-session.
 *  3. Inject that session token into localStorage.faktur_token BEFORE
 *     navigating to the dashboard — the dashboard's AuthProvider picks
 *     it up, calls /auth/me, and skips the login screen entirely.
 *  4. Install a webRequest auth bridge that keeps injecting
 *     Authorization: Bearer <token> on every request to the API host.
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

  // Append the desktop suffix to the default user-agent so front-ends
  // can detect us without us looking weird in server logs. We keep
  // the Chromium prefix intact so third-party services don't trip.
  const defaultUa = win.webContents.userAgent
  win.webContents.setUserAgent(`${defaultUa} ${DESKTOP_USER_AGENT_SUFFIX}`)

  installApiAuthBridge(win)

  // Bridge the OAuth token → dashboard session BEFORE we load the URL.
  // If it fails, we surface the error and fall back to loading the
  // dashboard anyway so the user sees what happened (most likely a
  // network issue or a revoked OAuth token).
  let bridgedSession = null
  try {
    const oauthAccessToken = await tokenManager.getAccessToken()
    bridgedSession = await exchangeForDashboardSession(oauthAccessToken)
  } catch (err) {
    console.error('[shell] session bridge failed:', err?.message || err)
  }

  // Stamp the session token into the renderer's localStorage via a
  // CDP bootstrap script so the write happens BEFORE any page script
  // runs. executeJavaScript would be too late because it runs after
  // the HTML parser — by then AuthProvider has already fetched
  // /auth/me and redirected to /login.
  if (bridgedSession) {
    await injectBootstrapScript(win, bridgedSession)
  }

  try {
    await win.loadURL(config.urls.dashboard)
  } catch (err) {
    console.error('[shell] failed to load dashboard:', err?.message || err)
  }

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
 * Authorization: Bearer <token> on every request hitting the API
 * host. Uses the OAuth access token (not the exchanged dashboard
 * token) — the backend accepts both for user-scoped routes.
 */
function installApiAuthBridge(win) {
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

/**
 * Uses Chrome DevTools Protocol to seed the renderer's localStorage
 * with the exchanged session token + vault key BEFORE any page
 * script runs. Goes through
 * Page.addScriptToEvaluateOnNewDocument which Chromium runs before
 * any page script on every navigation.
 */
async function injectBootstrapScript(win, bridgedSession) {
  const payload = JSON.stringify({
    token: bridgedSession.token,
    vaultKey: bridgedSession.vaultKey,
    vaultLocked: !!bridgedSession.vaultLocked,
  })

  const script = `
    (function () {
      try {
        var data = ${payload};
        if (data.token) {
          localStorage.setItem('faktur_token', data.token);
        }
        if (data.vaultKey) {
          localStorage.setItem('faktur_vault_key', data.vaultKey);
        }
        localStorage.setItem('faktur_source', 'desktop');
        if (data.vaultLocked) {
          localStorage.setItem('faktur_vault_locked', '1');
        } else {
          localStorage.removeItem('faktur_vault_locked');
        }
      } catch (e) {
        console.error('[faktur-desktop bootstrap]', e);
      }
    })();
  `

  try {
    const debuggee = win.webContents.debugger
    if (!debuggee.isAttached()) debuggee.attach('1.3')
    await debuggee.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script })
  } catch (err) {
    console.error('[shell] bootstrap injection failed:', err?.message || err)
  }
}

module.exports = { createShellWindow }

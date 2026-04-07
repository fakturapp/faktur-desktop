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
async function createShellWindow({ onFatalError } = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Faktur',
    backgroundColor: '#080808',
    show: true, // show immediately with the loading screen
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'shell_preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: config.devtools,
    },
  })

  const defaultUa = win.webContents.userAgent
  win.webContents.setUserAgent(`${defaultUa} ${DESKTOP_USER_AGENT_SUFFIX}`)

  // Show the local loading screen first so the user sees something in
  // < 100ms instead of a blank 3-second wait. The loading page is a
  // static HTML file bundled with the app — no network, no external
  // dependency beyond the Google Fonts stylesheet.
  const loadingPath = path.join(__dirname, '..', '..', 'renderer', 'loading.html')
  win.loadFile(loadingPath).catch(() => {})

  // Prevent the regular Faktur web login page from ever being shown
  // inside the Electron shell — if AuthProvider tries to redirect to
  // /login (e.g. after a manual logout from the dashboard or a 401
  // on any request) we tear the shell down and swap to the native
  // login window instead.
  installNavigationGuard(win, onFatalError)
  installApiAuthBridge(win, onFatalError)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  if (config.devtools) win.webContents.openDevTools({ mode: 'detach' })

  // Kick off the session bridge AFTER the window is visible so the
  // 200-500ms HTTP round trip doesn't block the UI.
  ;(async () => {
    let bridgedSession = null
    try {
      const oauthAccessToken = await tokenManager.getAccessToken()
      bridgedSession = await exchangeForDashboardSession(oauthAccessToken)
    } catch (err) {
      console.error('[shell] session bridge failed:', err?.message || err)
      const code = err?.status === 401 ? 'token_invalid' : 'bridge_failed'
      setImmediate(() => onFatalError?.(code))
      return
    }

    if (bridgedSession.vaultLocked) {
      setImmediate(() => onFatalError?.('vault_locked'))
      return
    }

    try {
      await injectBootstrapScript(win, bridgedSession)
    } catch (err) {
      console.error('[shell] bootstrap injection failed:', err?.message || err)
    }

    if (win.isDestroyed()) return

    try {
      await win.loadURL(config.urls.dashboard)
    } catch (err) {
      const msg = err?.message || String(err)
      // ERR_ABORTED (-3) happens when a new load preempts the current
      // one — e.g. when we navigate away from loading.html to the
      // dashboard, or when the dashboard SPA pushes a new state
      // immediately on mount. This is expected behavior, NOT a failure,
      // and we must not treat it as a fatal error (otherwise the
      // window closes straight after the dashboard appears).
      if (msg.includes('ERR_ABORTED') || msg.includes('(-3)')) return
      console.error('[shell] failed to load dashboard:', msg)
      setImmediate(() => onFatalError?.('network_error'))
    }
  })()

  return win
}

/**
 * Blocks any navigation inside the shell that isn't to the dashboard,
 * the API or the local loopback. Also detects the dashboard's /login
 * redirect (which happens on logout or 401) and turns it into a
 * fatal error so the main process swaps back to the native login
 * window instead of rendering a dead-end login form here.
 */
function installNavigationGuard(win, onFatalError) {
  const dashboardOrigin = new URL(config.urls.dashboard).origin

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      // /login on the dashboard host → user logged out. Hard swap.
      if (target.origin === dashboardOrigin && target.pathname.startsWith('/login')) {
        event.preventDefault()
        setImmediate(() => onFatalError?.('user_logout'))
        return
      }
      // Allow same-origin and loopback navigations, kill everything else.
      const allowed = [
        dashboardOrigin,
        new URL(config.api.baseUrl).origin,
        'http://127.0.0.1',
        'http://localhost',
        'file://',
      ]
      if (!allowed.some((prefix) => url.startsWith(prefix))) {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })

  // Catch client-side navigations triggered by router.push('/login') too —
  // will-navigate only fires on full loads, not History.pushState changes.
  win.webContents.on('did-navigate-in-page', (_event, url) => {
    try {
      const target = new URL(url)
      if (target.origin === dashboardOrigin && target.pathname.startsWith('/login')) {
        setImmediate(() => onFatalError?.('user_logout'))
      }
    } catch {
      /* ignore */
    }
  })
}

/**
 * Attaches two session-level webRequest listeners:
 *
 *  1. onBeforeSendHeaders injects the Authorization: Bearer header
 *     on every request hitting the API host.
 *  2. onCompleted watches for 401/423 responses on the same host —
 *     any of those is a hard signal that the session is no longer
 *     valid. We fire onFatalError so the main process logs us out
 *     and swaps to the login window with the right banner.
 */
function installApiAuthBridge(win, onFatalError) {
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

  let triggered = false
  ses.webRequest.onCompleted((details) => {
    if (triggered) return
    try {
      const target = new URL(details.url)
      if (target.host !== apiHost) return
      // 401 = token dead, 423 = vault locked. Either one is a hard
      // logout for the desktop shell since we can't prompt for a
      // password here.
      if (details.statusCode === 401) {
        triggered = true
        onFatalError?.('token_invalid')
      } else if (details.statusCode === 423) {
        triggered = true
        onFatalError?.('vault_locked')
      }
    } catch {
      /* ignore parse errors */
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

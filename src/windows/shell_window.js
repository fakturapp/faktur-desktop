'use strict'

const path = require('node:path')
const { app, BrowserWindow, shell, session } = require('electron')
const config = require('../config/env')
const tokenManager = require('../oauth/token_manager')
const { exchangeForDashboardSession } = require('../oauth/session_bridge')
const { computeDesktopProofHeader } = require('../security/desktop_proof')
const {
  assertSecureWebPreferences,
  installDevToolsLockdown,
  installHttpsOnlyGuard,
  installCertificateValidator,
  isDevMode,
} = require('../security/hardening')

// ---------- Constants ----------
const DESKTOP_USER_AGENT_SUFFIX = 'FakturDesktop/2.0'
const SHELL_PARTITION = 'persist:faktur-desktop-shell'

// ---------- Public factory ----------
async function createShellWindow({ onFatalError } = {}) {
  const shellSession = session.fromPartition(SHELL_PARTITION)
  installHttpsOnlyGuard(shellSession)
  installCertificateValidator(shellSession)

  const webPreferences = {
    preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'shell_preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    devTools: isDevMode(),
    session: shellSession,
  }
  assertSecureWebPreferences('shell', webPreferences)

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Faktur Desktop',
    backgroundColor: '#080808',
    show: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'renderer', 'assets', 'favicon.ico'),
    webPreferences,
  })

  const defaultUa = win.webContents.userAgent
  win.webContents.setUserAgent(`${defaultUa} ${DESKTOP_USER_AGENT_SUFFIX}`)

  // ---------- Per-window DevTools lockdown ----------
  installDevToolsLockdown(win)
  if (isDevMode()) win.webContents.openDevTools({ mode: 'detach' })

  // ---------- Loading screen ----------
  const loadingPath = path.join(__dirname, '..', '..', 'renderer', 'loading.html')
  win.loadFile(loadingPath).catch(() => {})

  // ---------- Hardening ----------
  installNavigationGuard(win, onFatalError)
  installDesktopProofHeader(win)
  installPermissionBlocker(shellSession)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // ---------- Session bridge + dashboard load ----------
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

    if (win.isDestroyed()) return

    // The dashboard session is delivered via a URL hash fragment that
    // the frontend reads on first render through consumeDesktopSessionHash.
    // Fragments never reach the server, never show up in logs or
    // referrers, and are readable synchronously before React mounts.
    // This replaces the old CDP-debugger injection path which required
    // sandbox:false — we can now ship a fully sandboxed shell.
    const sessionPayload = {
      t: bridgedSession.token,
      v: bridgedSession.vaultKey,
      l: !!bridgedSession.vaultLocked,
      s: 'desktop',
    }
    const encoded = Buffer.from(JSON.stringify(sessionPayload), 'utf8').toString('base64url')
    const target = `${config.urls.dashboard.replace(/\/+$/, '')}/dashboard#faktur_desktop_session=${encoded}`

    try {
      await win.loadURL(target)
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('ERR_ABORTED') || msg.includes('(-3)')) return
      console.error('[shell] failed to load dashboard:', msg)
      setImmediate(() => onFatalError?.('network_error'))
    }
  })()

  return win
}

// ---------- Navigation guard ----------
function installNavigationGuard(win, onFatalError) {
  const dashboardOrigin = new URL(config.urls.dashboard).origin

  const handleLoginRedirect = () => {
    setImmediate(() => onFatalError?.('session_expired'))
  }

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      if (target.origin === dashboardOrigin && target.pathname.startsWith('/login')) {
        event.preventDefault()
        handleLoginRedirect()
        return
      }
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

  win.webContents.on('did-navigate-in-page', (_event, url) => {
    try {
      const target = new URL(url)
      if (target.origin === dashboardOrigin && target.pathname.startsWith('/login')) {
        handleLoginRedirect()
      }
    } catch {
      /* ignore */
    }
  })
}

// ---------- Desktop cryptographic proof header ----------
// Adds X-Faktur-Desktop-Proof on every API request so the backend can
// distinguish a real desktop client from a browser that spoofs the UA.
function installDesktopProofHeader(win) {
  const apiHost = new URL(config.api.baseUrl).host
  const ses = win.webContents.session

  ses.webRequest.onBeforeSendHeaders(async (details, callback) => {
    try {
      const target = new URL(details.url)
      if (target.host !== apiHost) {
        return callback({ requestHeaders: details.requestHeaders })
      }
      const headers = { ...details.requestHeaders }
      const proof = computeDesktopProofHeader()
      if (proof) {
        headers['X-Faktur-Desktop-Proof'] = proof.signature
        headers['X-Faktur-Desktop-Nonce'] = proof.nonce
        headers['X-Faktur-Desktop-Ts'] = String(proof.ts)
      }
      callback({ requestHeaders: headers })
    } catch {
      callback({ requestHeaders: details.requestHeaders })
    }
  })
}

// ---------- Permission blocker ----------
// The dashboard is trusted content but we still block notifications,
// media devices, geolocation, etc. by default — the user can re-enable
// from the OS permissions panel if they need them.
function installPermissionBlocker(sessionInstance) {
  sessionInstance.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write'])
    callback(allowed.has(permission))
  })
}

module.exports = { createShellWindow, SHELL_PARTITION }

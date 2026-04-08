'use strict'

const path = require('node:path')
const { BrowserWindow, shell } = require('electron')
const config = require('../config/env')
const tokenManager = require('../oauth/token_manager')
const { exchangeForDashboardSession } = require('../oauth/session_bridge')

const DESKTOP_USER_AGENT_SUFFIX = 'FakturDesktop/2.0'

async function createShellWindow({ onFatalError } = {}) {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Faktur',
    backgroundColor: '#080808',
    show: true,
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

  const loadingPath = path.join(__dirname, '..', '..', 'renderer', 'loading.html')
  win.loadFile(loadingPath).catch(() => {})

  installNavigationGuard(win, onFatalError)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })

  if (config.devtools) win.webContents.openDevTools({ mode: 'detach' })

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

function installNavigationGuard(win, onFatalError) {
  const dashboardOrigin = new URL(config.urls.dashboard).origin

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url)
      if (target.origin === dashboardOrigin && target.pathname.startsWith('/login')) {
        event.preventDefault()
        setImmediate(() => onFatalError?.('session_expired'))
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
        setImmediate(() => onFatalError?.('session_expired'))
      }
    } catch {
      /* ignore */
    }
  })
}

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

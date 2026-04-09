'use strict'

const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const {
  assertSecureWebPreferences,
  installDevToolsLockdown,
  installHttpsOnlyGuard,
  installCertificateValidator,
  isDevMode,
} = require('../security/hardening')

const LOGIN_PARTITION = 'faktur-desktop-login-v2'

function createLoginWindow({ disconnectReason } = {}) {
  const loginSession = session.fromPartition(LOGIN_PARTITION)
  installHttpsOnlyGuard(loginSession)
  installCertificateValidator(loginSession)

  const webPreferences = {
    preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'login_preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    devTools: isDevMode(),
    session: loginSession,
  }
  assertSecureWebPreferences('login', webPreferences)

  const win = new BrowserWindow({
    width: 880,
    height: 580,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Faktur Desktop — Connexion',
    backgroundColor: '#080808',
    show: true,
    paintWhenInitiallyHidden: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'renderer', 'assets', 'favicon.ico'),
    webPreferences,
  })

  installDevToolsLockdown(win)
  if (isDevMode()) win.webContents.openDevTools({ mode: 'detach' })

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'login.html')
  const loadOptions = disconnectReason
    ? { search: new URLSearchParams({ reason: disconnectReason }).toString() }
    : undefined

  const attemptLoad = (attempt = 1) => {
    if (win.isDestroyed()) return
    win.loadFile(htmlPath, loadOptions).catch((err) => {
      console.error(
        `[login] loadFile attempt ${attempt} failed:`,
        err?.message || err
      )
      if (attempt < 3 && !win.isDestroyed()) {
        setTimeout(() => attemptLoad(attempt + 1), 250 * attempt)
      }
    })
  }
  attemptLoad()

  win.webContents.on('did-fail-load', (_evt, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    console.error(`[login] did-fail-load ${code} ${desc} ${url}`)
    if (!win.isDestroyed()) {
      setTimeout(() => attemptLoad(99), 300)
    }
  })
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.error('[login] render-process-gone:', details?.reason)
  })

  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed()) win.focus()
  })

  return win
}

module.exports = { createLoginWindow, LOGIN_PARTITION }

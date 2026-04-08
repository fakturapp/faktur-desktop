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

const LOGIN_PARTITION = 'persist:faktur-desktop-login'

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
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'renderer', 'assets', 'favicon.ico'),
    webPreferences,
  })

  installDevToolsLockdown(win)
  if (isDevMode()) win.webContents.openDevTools({ mode: 'detach' })

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'login.html')
  const search = disconnectReason
    ? new URLSearchParams({ reason: disconnectReason }).toString()
    : undefined

  win.loadFile(htmlPath, search ? { search } : undefined).catch((err) => {
    console.error('[login] loadFile failed:', err?.message || err)
  })

  win.webContents.on('did-fail-load', (_evt, code, desc, url) => {
    console.error(`[login] did-fail-load ${code} ${desc} ${url}`)
  })
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.error('[login] render-process-gone:', details?.reason)
  })

  let shown = false
  const reveal = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
    win.focus()
  }
  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', reveal)
  setTimeout(reveal, 2500)

  return win
}

module.exports = { createLoginWindow, LOGIN_PARTITION }

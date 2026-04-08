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
    width: 860,
    height: 560,
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
  win.loadFile(htmlPath, search ? { search } : undefined)

  win.once('ready-to-show', () => {
    win.show()
  })

  return win
}

module.exports = { createLoginWindow, LOGIN_PARTITION }

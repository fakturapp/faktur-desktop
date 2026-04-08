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

const UPDATE_PARTITION = 'persist:faktur-desktop-update'

function createUpdateWindow() {
  const updateSession = session.fromPartition(UPDATE_PARTITION)
  installHttpsOnlyGuard(updateSession)
  installCertificateValidator(updateSession)

  const webPreferences = {
    preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'update_preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    devTools: isDevMode(),
    session: updateSession,
  }
  assertSecureWebPreferences('update', webPreferences)

  const win = new BrowserWindow({
    width: 460,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    title: 'Faktur Desktop — Mise à jour',
    backgroundColor: '#080808',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'renderer', 'assets', 'favicon.ico'),
    webPreferences,
  })

  installDevToolsLockdown(win)

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'update.html')
  win.loadFile(htmlPath).catch((err) => {
    console.error('[update] loadFile failed:', err?.message || err)
  })

  let shown = false
  const reveal = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', reveal)
  win.webContents.once('did-finish-load', reveal)
  setTimeout(reveal, 2500)

  return win
}

module.exports = { createUpdateWindow, UPDATE_PARTITION }

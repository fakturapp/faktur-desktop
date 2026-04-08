'use strict'

const path = require('node:path')
const { app, BrowserWindow, session } = require('electron')
const {
  assertSecureWebPreferences,
  installDevToolsLockdown,
  installHttpsOnlyGuard,
  installCertificateValidator,
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
    devTools: !app.isPackaged,
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
  win.loadFile(htmlPath)
  win.once('ready-to-show', () => win.show())

  return win
}

module.exports = { createUpdateWindow, UPDATE_PARTITION }

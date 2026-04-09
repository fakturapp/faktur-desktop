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

const UPDATE_PARTITION = 'faktur-desktop-update-v2'

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
    show: true,
    paintWhenInitiallyHidden: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'renderer', 'assets', 'favicon.ico'),
    webPreferences,
  })

  installDevToolsLockdown(win)

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'update.html')
  win.loadFile(htmlPath).catch((err) => {
    console.error('[update] loadFile failed:', err?.message || err)
  })

  return win
}

module.exports = { createUpdateWindow, UPDATE_PARTITION }

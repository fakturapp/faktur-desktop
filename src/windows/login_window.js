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

  const MAX_LOAD_ATTEMPTS = 3
  let totalAttempts = 0
  let loading = false
  let loaded = false

  const attemptLoad = () => {
    if (win.isDestroyed() || loaded || loading) return
    if (totalAttempts >= MAX_LOAD_ATTEMPTS) {
      console.error(
        `[login] giving up after ${totalAttempts} loadFile attempts — check asar contents and fuses`
      )
      return
    }
    totalAttempts += 1
    loading = true
    win.loadFile(htmlPath, loadOptions).catch((err) => {
      loading = false
      console.error(
        `[login] loadFile attempt ${totalAttempts} failed:`,
        err?.message || err
      )
    })
  }
  attemptLoad()

  win.webContents.on('did-fail-load', (_evt, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    loading = false
    console.error(`[login] did-fail-load ${code} ${desc} ${url}`)
    if (!win.isDestroyed() && totalAttempts < MAX_LOAD_ATTEMPTS) {
      setTimeout(attemptLoad, 300 * totalAttempts)
    }
  })
  win.webContents.on('did-finish-load', () => {
    loaded = true
    loading = false
    if (!win.isDestroyed()) win.focus()
  })
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.error('[login] render-process-gone:', details?.reason)
  })

  return win
}

module.exports = { createLoginWindow, LOGIN_PARTITION }

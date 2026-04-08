'use strict'

const path = require('node:path')
const { BrowserWindow, session } = require('electron')
const config = require('../config/env')

const LOGIN_PARTITION = 'persist:faktur-desktop-login'

function createLoginWindow({ disconnectReason } = {}) {
  const loginSession = session.fromPartition(LOGIN_PARTITION)

  const win = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Faktur Desktop — Connexion',
    backgroundColor: '#080808',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'login_preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: config.devtools,
      session: loginSession,
    },
  })

  const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'login.html')
  const search = disconnectReason
    ? new URLSearchParams({ reason: disconnectReason }).toString()
    : undefined
  win.loadFile(htmlPath, search ? { search } : undefined)

  win.once('ready-to-show', () => {
    win.show()
    if (config.devtools) win.webContents.openDevTools({ mode: 'detach' })
  })

  return win
}

module.exports = { createLoginWindow, LOGIN_PARTITION }

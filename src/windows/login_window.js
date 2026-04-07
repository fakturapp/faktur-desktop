'use strict'

const path = require('node:path')
const { BrowserWindow } = require('electron')
const config = require('../config/env')

/**
 * Factory for the 'not yet authenticated' window. This is the first
 * thing the user sees — a small card with a 'Se connecter' button and
 * an optional disconnect banner when we got kicked out of a previous
 * session (revoked token, vault locked, network error, etc.).
 */
function createLoginWindow({ disconnectReason } = {}) {
  const win = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Faktur — Connexion',
    backgroundColor: '#080808',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'renderer', 'preload', 'login_preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: config.devtools,
    },
  })

  // Forward the disconnect reason via the file URL's search param so
  // the renderer can display the right banner without a separate IPC
  // round trip.
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

module.exports = { createLoginWindow }

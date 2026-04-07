'use strict'

const path = require('node:path')
const { BrowserWindow } = require('electron')
const config = require('../config/env')

/**
 * Factory for the 'not yet authenticated' window. This is the first
 * thing the user sees — a small, frameless 'Se connecter' card. All
 * the auth heavy lifting happens in main.js via the token_manager,
 * this window just renders a button and listens for state changes.
 */
function createLoginWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 600,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    title: 'Faktur — Connexion',
    backgroundColor: '#faf9f7',
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

  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'login.html'))

  win.once('ready-to-show', () => {
    win.show()
    if (config.devtools) win.webContents.openDevTools({ mode: 'detach' })
  })

  return win
}

module.exports = { createLoginWindow }

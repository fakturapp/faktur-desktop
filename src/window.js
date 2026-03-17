const { BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow = null;

const WINDOW_WIDTH = parseInt(process.env.WINDOW_WIDTH) || 1280;
const WINDOW_HEIGHT = parseInt(process.env.WINDOW_HEIGHT) || 800;

function createMainWindow(url, icon) {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    icon: icon || undefined,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#09090b',
      symbolColor: '#fafafa',
      height: 36
    },
    backgroundColor: '#09090b',
    webPreferences: {
      partition: 'persist:faktur',
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Pas de menu
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  mainWindow.loadURL(url);

  // Ouvrir les liens externes dans le navigateur par défaut
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const fakturUrl = process.env.FAKTUR_URL || 'https://dash.fakturapp.cc';
    if (!url.startsWith(fakturUrl)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow };

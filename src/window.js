const { BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;
let webviewContents = null;

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
    backgroundColor: '#09090b',
    title: 'Faktur App',
    webPreferences: {
      partition: 'persist:faktur',
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.removeMenu();

  // Charger le shell local (titlebar + webview)
  mainWindow.loadFile(path.join(__dirname, '..', 'public', 'shell.html'));

  // Renvoyer l'URL quand le shell la demande
  ipcMain.on('get-faktur-url', (event) => {
    event.returnValue = url;
  });

  // Renvoyer le chemin du preload webview
  ipcMain.on('get-site-preload-path', (event) => {
    event.returnValue = 'file:///' + path.join(__dirname, 'preload-site.js').replace(/\\/g, '/');
  });

  // IPC pour les contrôles de fenêtre
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });
  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
  });
  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  // Rafraîchir la webview avec F5 ou Ctrl+Shift+R
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' ||
        (input.control && input.shift && input.key.toLowerCase() === 'r')) {
      if (webviewContents && !webviewContents.isDestroyed()) {
        webviewContents.reload();
      }
      event.preventDefault();
    }
  });

  // Gérer les ouvertures de fenêtres depuis la webview
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webviewContents = webContents;
    webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      // Bloquer les blob:// URLs (le download est déjà géré par will-download)
      if (linkUrl.startsWith('blob:')) {
        return { action: 'deny' };
      }
      // Ouvrir les liens externes dans le navigateur par défaut
      if (!linkUrl.startsWith(url)) {
        shell.openExternal(linkUrl);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
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

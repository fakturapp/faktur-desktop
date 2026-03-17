const { BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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
    backgroundColor: '#09090b',
    title: '',
    webPreferences: {
      partition: 'persist:faktur',
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.removeMenu();

  mainWindow.loadURL(url);

  // Injecter la titlebar custom une fois la page chargée
  mainWindow.webContents.on('did-finish-load', () => {
    injectTitleBar(mainWindow);
  });

  // Aussi après chaque navigation (changement de page)
  mainWindow.webContents.on('did-navigate', () => {
    injectTitleBar(mainWindow);
  });
  mainWindow.webContents.on('did-navigate-in-page', () => {
    injectTitleBar(mainWindow);
  });

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

  return mainWindow;
}

function injectTitleBar(win) {
  // Lire le SVG inline pour l'icône
  const logoSvg = fs.readFileSync(path.join(__dirname, '..', 'public', 'logo.svg'), 'utf8')
    .replace(/\n/g, '')
    .replace(/"/g, '\\"');

  win.webContents.executeJavaScript(`
    (function() {
      if (document.getElementById('faktur-titlebar')) return;

      const bar = document.createElement('div');
      bar.id = 'faktur-titlebar';
      bar.innerHTML = \`
        <div class="ftb-drag">
          <div class="ftb-icon">${logoSvg}</div>
        </div>
        <div class="ftb-controls">
          <button class="ftb-btn ftb-minimize" onclick="window.fakturApp.minimize()">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
          </button>
          <button class="ftb-btn ftb-maximize" onclick="window.fakturApp.maximize()">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
          <button class="ftb-btn ftb-close" onclick="window.fakturApp.close()">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      \`;

      const style = document.createElement('style');
      style.textContent = \`
        #faktur-titlebar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 36px;
          background: #09090b;
          display: flex;
          align-items: center;
          justify-content: space-between;
          z-index: 99999;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .ftb-drag {
          flex: 1;
          height: 100%;
          display: flex;
          align-items: center;
          padding-left: 12px;
          -webkit-app-region: drag;
        }
        .ftb-icon {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
        }
        .ftb-icon svg {
          width: 22px;
          height: 22px;
        }
        .ftb-controls {
          display: flex;
          height: 100%;
          -webkit-app-region: no-drag;
        }
        .ftb-btn {
          width: 46px;
          height: 100%;
          border: none;
          background: transparent;
          color: #a1a1aa;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .ftb-btn:hover {
          background: rgba(255,255,255,0.08);
          color: #fafafa;
        }
        .ftb-close:hover {
          background: #ef4444;
          color: white;
        }
        body {
          padding-top: 36px !important;
        }
      \`;

      document.head.appendChild(style);
      document.body.prepend(bar);
    })();
  `);
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow };

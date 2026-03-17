const { app, BrowserWindow, session, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { createMainWindow, getMainWindow } = require('./window');
const { setupDownloadManager } = require('./download');

const FAKTUR_URL = process.env.FAKTUR_URL || 'https://dash.fakturapp.cc';

// Persistence de session : on stocke dans userData
const userDataPath = app.getPath('userData');
const sessionPartition = 'persist:faktur';

app.whenReady().then(() => {
  // Charger l'icône
  const iconPath = path.join(__dirname, '..', 'public', 'icon.png');
  let appIcon = undefined;
  if (fs.existsSync(iconPath)) {
    appIcon = nativeImage.createFromPath(iconPath);
  }

  const mainWindow = createMainWindow(FAKTUR_URL, appIcon);
  setupDownloadManager(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(FAKTUR_URL, appIcon);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

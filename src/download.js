const { dialog, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let downloadWindow = null;

const DL_WIDTH = parseInt(process.env.DOWNLOAD_WINDOW_WIDTH) || 420;
const DL_HEIGHT = parseInt(process.env.DOWNLOAD_WINDOW_HEIGHT) || 220;

function createDownloadWindow(parentWindow) {
  downloadWindow = new BrowserWindow({
    width: DL_WIDTH,
    height: DL_HEIGHT,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#09090b',
    parent: parentWindow,
    modal: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-download.js')
    }
  });

  downloadWindow.removeMenu();
  downloadWindow.loadFile(path.join(__dirname, '..', 'public', 'download.html'));

  downloadWindow.once('ready-to-show', () => {
    downloadWindow.show();
  });

  downloadWindow.on('closed', () => {
    downloadWindow = null;
  });

  return downloadWindow;
}

function setupDownloadManager(mainWindow) {
  mainWindow.webContents.session.on('will-download', async (event, item, webContents) => {
    const defaultFilename = item.getFilename();
    const totalBytes = item.getTotalBytes();

    // Demander "Enregistrer sous"
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters: [
        { name: 'Tous les fichiers', extensions: ['*'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg'] },
        { name: 'Documents', extensions: ['doc', 'docx', 'xls', 'xlsx', 'csv'] }
      ]
    });

    if (canceled) {
      item.cancel();
      return;
    }

    item.setSavePath(filePath);

    // Ouvrir la fenêtre de progression
    const dlWindow = createDownloadWindow(mainWindow);

    // Envoyer le nom du fichier une fois la fenêtre prête
    dlWindow.webContents.once('did-finish-load', () => {
      dlWindow.webContents.send('download-start', {
        filename: path.basename(filePath),
        totalBytes
      });
    });

    item.on('updated', (event, state) => {
      if (!downloadWindow) return;

      if (state === 'progressing') {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const percent = total > 0 ? Math.round((received / total) * 100) : 0;

        downloadWindow.webContents.send('download-progress', {
          percent,
          received,
          total,
          filename: path.basename(filePath)
        });

        // Barre de progression dans la taskbar
        mainWindow.setProgressBar(total > 0 ? received / total : -1);
      }
    });

    item.once('done', (event, state) => {
      mainWindow.setProgressBar(-1);

      if (downloadWindow) {
        if (state === 'completed') {
          downloadWindow.webContents.send('download-complete', {
            filename: path.basename(filePath),
            path: filePath
          });
          // Fermer après un court délai pour montrer 100%
          setTimeout(() => {
            if (downloadWindow) downloadWindow.close();
          }, 1500);
        } else {
          downloadWindow.webContents.send('download-error', {
            filename: path.basename(filePath),
            state
          });
          setTimeout(() => {
            if (downloadWindow) downloadWindow.close();
          }, 3000);
        }
      }
    });
  });
}

module.exports = { setupDownloadManager };

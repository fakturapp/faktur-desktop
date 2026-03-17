const { dialog, BrowserWindow, session } = require('electron');
const path = require('path');

let downloadWindow = null;
let dialogOpen = false;

const DL_WIDTH = parseInt(process.env.DOWNLOAD_WINDOW_WIDTH) || 420;
const DL_HEIGHT = parseInt(process.env.DOWNLOAD_WINDOW_HEIGHT) || 220;

function createDownloadWindow(parentWindow) {
  if (downloadWindow && !downloadWindow.isDestroyed()) {
    downloadWindow.destroy();
    downloadWindow = null;
  }

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
    if (downloadWindow && !downloadWindow.isDestroyed()) downloadWindow.show();
  });

  downloadWindow.on('closed', () => {
    downloadWindow = null;
  });

  return downloadWindow;
}

function setupDownloadManager(mainWindow) {
  const webviewSession = session.fromPartition('persist:faktur');

  webviewSession.on('will-download', (event, item, webContents) => {
    // Si un dialog est déjà ouvert, annuler ce download (doublon blob://)
    if (dialogOpen) {
      item.cancel();
      return;
    }

    const defaultFilename = item.getFilename();

    item.pause();
    dialogOpen = true;

    dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters: getFiltersForFilename(defaultFilename)
    }).then(({ canceled, filePath }) => {
      dialogOpen = false;

      if (canceled || !filePath) {
        item.cancel();
        return;
      }

      item.setSavePath(filePath);
      const filename = path.basename(filePath);

      // Créer la fenêtre de progression
      const dlWindow = createDownloadWindow(mainWindow);
      let windowReady = false;
      let pendingUpdates = [];
      let finalResult = null; // Stocker le résultat si download finit avant la fenêtre

      dlWindow.webContents.once('did-finish-load', () => {
        windowReady = true;

        dlWindow.webContents.send('download-start', {
          filename,
          totalBytes: item.getTotalBytes()
        });

        // Envoyer les updates en attente
        for (const update of pendingUpdates) {
          dlWindow.webContents.send('download-progress', update);
        }
        pendingUpdates = [];

        // Si le download a déjà fini avant que la fenêtre soit prête
        if (finalResult) {
          sendFinalResult(finalResult.state, filename, filePath);
        }
      });

      item.on('updated', (event, state) => {
        if (state === 'progressing') {
          const received = item.getReceivedBytes();
          const total = item.getTotalBytes();
          const percent = total > 0 ? Math.round((received / total) * 100) : -1;
          const update = { percent, received, total, filename };

          if (windowReady && downloadWindow && !downloadWindow.isDestroyed()) {
            downloadWindow.webContents.send('download-progress', update);
          } else {
            pendingUpdates.push(update);
          }

          mainWindow.setProgressBar(total > 0 ? received / total : 2);
        }
      });

      item.once('done', (event, state) => {
        mainWindow.setProgressBar(-1);

        if (windowReady && downloadWindow && !downloadWindow.isDestroyed()) {
          sendFinalResult(state, filename, filePath);
        } else {
          // La fenêtre n'est pas encore prête, stocker le résultat
          finalResult = { state };
        }
      });

      item.resume();
    });
  });

  function sendFinalResult(state, filename, filePath) {
    if (!downloadWindow || downloadWindow.isDestroyed()) return;

    if (state === 'completed') {
      downloadWindow.webContents.send('download-complete', { filename, path: filePath });
      setTimeout(() => {
        if (downloadWindow && !downloadWindow.isDestroyed()) downloadWindow.close();
      }, 1500);
    } else {
      downloadWindow.webContents.send('download-error', { filename, state });
      setTimeout(() => {
        if (downloadWindow && !downloadWindow.isDestroyed()) downloadWindow.close();
      }, 3000);
    }
  }
}

function getFiltersForFilename(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const filters = [];

  if (ext === 'pdf') {
    filters.push({ name: 'PDF', extensions: ['pdf'] });
  } else if (['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(ext)) {
    filters.push({ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] });
  } else if (['doc', 'docx', 'xls', 'xlsx', 'csv'].includes(ext)) {
    filters.push({ name: 'Documents', extensions: ['doc', 'docx', 'xls', 'xlsx', 'csv'] });
  }

  filters.push({ name: 'Tous les fichiers', extensions: ['*'] });
  return filters;
}

module.exports = { setupDownloadManager };

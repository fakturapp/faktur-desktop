const { dialog, session, ipcMain, app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const historyPath = path.join(app.getPath('userData'), 'download-history.json');

function loadHistory() {
  try {
    if (fs.existsSync(historyPath)) {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }
  } catch (e) { /* ignore */ }
  return [];
}

function saveHistory(history) {
  try {
    fs.writeFileSync(historyPath, JSON.stringify(history));
  } catch (e) { /* ignore */ }
}

function setupDownloadManager(mainWindow) {
  let downloadHistory = loadHistory();

  ipcMain.handle('get-download-history', () => downloadHistory);

  ipcMain.on('clear-download-history', () => {
    downloadHistory = [];
    saveHistory(downloadHistory);
  });

  ipcMain.on('open-download-file', (_, filePath) => {
    shell.openPath(filePath);
  });

  ipcMain.on('open-download-folder', (_, filePath) => {
    shell.showItemInFolder(filePath);
  });

  const webviewSession = session.fromPartition('persist:faktur');

  webviewSession.on('will-download', (event, item, webContents) => {
    const defaultFilename = item.getFilename();

    const filePath = dialog.showSaveDialogSync(mainWindow, {
      defaultPath: defaultFilename,
      filters: getFiltersForFilename(defaultFilename)
    });

    if (!filePath) {
      item.cancel();
      return;
    }

    item.setSavePath(filePath);
    const filename = path.basename(filePath);
    const downloadId = Date.now().toString();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-start', {
        id: downloadId,
        filename,
        totalBytes: item.getTotalBytes(),
        path: filePath
      });
    }

    item.on('updated', (event, state) => {
      if (state === 'progressing' && mainWindow && !mainWindow.isDestroyed()) {
        const received = item.getReceivedBytes();
        const total = item.getTotalBytes();
        const percent = total > 0 ? Math.round((received / total) * 100) : -1;

        mainWindow.webContents.send('download-progress', {
          id: downloadId,
          percent,
          received,
          total,
          filename
        });

        mainWindow.setProgressBar(total > 0 ? received / total : 2);
      }
    });

    item.once('done', (event, state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }

      const entry = {
        id: downloadId,
        filename,
        path: filePath,
        size: item.getTotalBytes(),
        date: new Date().toISOString(),
        state: state === 'completed' ? 'completed' : 'failed'
      };

      downloadHistory.unshift(entry);
      if (downloadHistory.length > 50) downloadHistory = downloadHistory.slice(0, 50);
      saveHistory(downloadHistory);

      if (mainWindow && !mainWindow.isDestroyed()) {
        if (state === 'completed') {
          mainWindow.webContents.send('download-complete', {
            id: downloadId,
            filename,
            path: filePath,
            size: item.getTotalBytes()
          });
        } else {
          mainWindow.webContents.send('download-error', {
            id: downloadId,
            filename,
            state
          });
        }
      }
    });
  });
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

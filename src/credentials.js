const { safeStorage, app } = require('electron');
const path = require('path');
const fs = require('fs');

const credPath = path.join(app.getPath('userData'), 'saved-credentials.json');

function loadCredentials() {
  try {
    if (!fs.existsSync(credPath)) return [];
    if (!safeStorage.isEncryptionAvailable()) return [];
    const data = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    return data.map(entry => {
      try {
        return {
          ...entry,
          password: safeStorage.decryptString(Buffer.from(entry.password, 'base64'))
        };
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function saveCredentialsToDisk(credentials) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = credentials.map(entry => ({
      url: entry.url,
      username: entry.username,
      password: safeStorage.encryptString(entry.password).toString('base64')
    }));
    fs.writeFileSync(credPath, JSON.stringify(encrypted));
  } catch { /* ignore */ }
}

module.exports = { loadCredentials, saveCredentialsToDisk };

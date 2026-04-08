'use strict'

const { safeStorage } = require('electron')

class SafeStorageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SafeStorageError'
  }
}

// ---------- Strong-backend enforcement ----------
// safeStorage can silently fall back to 'basic_text' on Linux when no
// secret store (libsecret/kwallet) is available. In that mode the tokens
// are stored in plaintext and offer no protection. We refuse to run in
// that mode — the user must install a real backend or use a different
// host. See https://electronjs.org/docs/latest/api/safe-storage

const WEAK_BACKENDS = new Set(['basic_text'])

function getBackend() {
  if (typeof safeStorage.getSelectedStorageBackend === 'function') {
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}

function ensureAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageError(
      'OS-level encryption is not available — refusing to persist secrets in plaintext. ' +
        'On Linux install libsecret-tools (or equivalent) and restart the app.'
    )
  }
  const backend = getBackend()
  if (WEAK_BACKENDS.has(backend)) {
    throw new SafeStorageError(
      `safeStorage fell back to '${backend}' — refusing to persist secrets. ` +
        'Install a real secret backend (libsecret, kwallet) and restart.'
    )
  }
}

// ---------- Encrypt / decrypt ----------

function encryptString(plaintext) {
  ensureAvailable()
  if (typeof plaintext !== 'string') {
    throw new SafeStorageError('encryptString expects a string argument')
  }
  const buffer = safeStorage.encryptString(plaintext)
  return buffer.toString('base64')
}

function decryptString(payloadBase64) {
  ensureAvailable()
  if (!payloadBase64) return null
  try {
    const buffer = Buffer.from(payloadBase64, 'base64')
    return safeStorage.decryptString(buffer)
  } catch {
    return null
  }
}

module.exports = {
  SafeStorageError,
  encryptString,
  decryptString,
  isAvailable: () => safeStorage.isEncryptionAvailable() && !WEAK_BACKENDS.has(getBackend()),
  getBackend,
}

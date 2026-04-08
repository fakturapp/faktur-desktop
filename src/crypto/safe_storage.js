'use strict'

const { safeStorage } = require('electron')

class SafeStorageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SafeStorageError'
  }
}

function ensureAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageError(
      'OS-level encryption is not available — refusing to persist secrets in plaintext. ' +
        'On Linux install libsecret-tools (or equivalent) and restart the app.'
    )
  }
}

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
  isAvailable: () => safeStorage.isEncryptionAvailable(),
}

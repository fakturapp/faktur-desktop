'use strict'

/**
 * Thin wrapper around Electron's `safeStorage` API. Falls back to
 * explicit failures rather than plaintext writes when the OS
 * encryption layer is unavailable — we'd rather refuse to persist a
 * token than leak one.
 *
 * On macOS: Keychain.
 * On Windows: DPAPI.
 * On Linux: libsecret / kwallet (if available).
 */

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

/**
 * Encrypts an arbitrary UTF-8 string using the OS-backed key.
 * Returns a base64 string safe to persist in any JSON file.
 */
function encryptString(plaintext) {
  ensureAvailable()
  if (typeof plaintext !== 'string') {
    throw new SafeStorageError('encryptString expects a string argument')
  }
  const buffer = safeStorage.encryptString(plaintext)
  return buffer.toString('base64')
}

/**
 * Decrypts a base64 payload previously produced by `encryptString`.
 * Returns null if the payload cannot be decrypted (tampered, OS key
 * rotated, different user profile) — callers MUST handle the null
 * and treat the session as 'requires re-login'.
 */
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

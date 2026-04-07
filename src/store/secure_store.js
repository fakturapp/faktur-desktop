'use strict'

/**
 * Encrypted persistent key/value store backed by a single JSON file
 * placed in Electron's `userData` directory. Every value is wrapped
 * with `safeStorage` before being written, so even someone with full
 * filesystem access can't read the tokens without also holding the
 * OS user session.
 *
 * This is intentionally minimal: a flat { key: ciphertext } map. No
 * migrations, no schema, no indexes. If the file is corrupted we
 * delete it and start fresh — anything inside was ephemeral auth
 * state that can be re-established by re-running the OAuth flow.
 */

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const safeStorage = require('../crypto/safe_storage')

const FILE_NAME = 'faktur-secure-store.json'

function storePath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function readRaw() {
  const file = storePath()
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) ?? {}
  } catch {
    // Corrupted — nuke so we start clean.
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
    return {}
  }
}

function writeRaw(data) {
  const file = storePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
}

/**
 * Reads a value by key and returns it as a UTF-8 string, or null if
 * it's missing / undecryptable.
 */
function get(key) {
  const raw = readRaw()
  const entry = raw[key]
  if (!entry) return null
  return safeStorage.decryptString(entry)
}

/**
 * Writes a value under `key`. If `value` is null or undefined, the
 * key is removed instead — keeping the on-disk file tidy.
 */
function set(key, value) {
  const raw = readRaw()
  if (value === null || value === undefined) {
    delete raw[key]
  } else {
    raw[key] = safeStorage.encryptString(String(value))
  }
  writeRaw(raw)
}

/**
 * Removes a single key.
 */
function remove(key) {
  set(key, null)
}

/**
 * Wipes the entire store file from disk. Called on logout or after a
 * remote revocation notification.
 */
function clear() {
  try {
    fs.unlinkSync(storePath())
  } catch {
    /* already gone */
  }
}

/**
 * Bulk replace — useful when persisting a fresh token pair atomically.
 */
function setMany(pairs) {
  const raw = readRaw()
  for (const [key, value] of Object.entries(pairs)) {
    if (value === null || value === undefined) {
      delete raw[key]
    } else {
      raw[key] = safeStorage.encryptString(String(value))
    }
  }
  writeRaw(raw)
}

module.exports = { get, set, remove, clear, setMany, path: storePath }

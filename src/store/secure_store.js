'use strict'

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

function get(key) {
  const raw = readRaw()
  const entry = raw[key]
  if (!entry) return null
  return safeStorage.decryptString(entry)
}

function set(key, value) {
  const raw = readRaw()
  if (value === null || value === undefined) {
    delete raw[key]
  } else {
    raw[key] = safeStorage.encryptString(String(value))
  }
  writeRaw(raw)
}

function remove(key) {
  set(key, null)
}

function clear() {
  try {
    fs.unlinkSync(storePath())
  } catch {
    /* already gone */
  }
}

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

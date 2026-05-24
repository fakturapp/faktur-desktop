'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

const DEFAULTS = Object.freeze({
  alwaysShowTeamSelect: true,
  lastTeamId: null,
})

function filePath() {
  return path.join(app.getPath('userData'), 'preferences.json')
}

function read() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function write(patch) {
  const current = read()
  const next = { ...current, ...patch }
  try {
    fs.mkdirSync(path.dirname(filePath()), { recursive: true })
    fs.writeFileSync(filePath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    console.error('[preferences] write failed:', err?.message || err)
  }
  return next
}

function reset() {
  try {
    fs.unlinkSync(filePath())
  } catch {}
  return { ...DEFAULTS }
}

module.exports = { read, write, reset, DEFAULTS }

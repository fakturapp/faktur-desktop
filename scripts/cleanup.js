#!/usr/bin/env node
'use strict'

/**
 * `npm run cleanup`
 *
 * Wipes every piece of local state the desktop app has persisted so
 * you can start from a clean boot to test the OAuth flow from scratch.
 * Targets are:
 *
 *   - Electron `userData` directory (cookies, localStorage, service
 *     workers, our encrypted secure_store JSON file)
 *   - Electron `sessionData` directory (webRequest cache, GPUCache…)
 *   - The app's logs directory (Electron `log`)
 *   - The build artifact dir (`dist/`) — optional, toggled via --dist
 *
 * The script uses the same path resolution Electron would — but since
 * we're running outside Electron here, we re-implement it per-platform
 * so we don't need to boot the app to find its user directory.
 *
 * Run:
 *   npm run cleanup              # wipes userData + sessionData + logs
 *   npm run cleanup -- --dist    # also wipes ./dist (build artifacts)
 *   npm run cleanup -- --dry     # prints what would be deleted
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const APP_NAME = 'Faktur' // matches productName in electron-builder config

const args = process.argv.slice(2)
const INCLUDE_DIST = args.includes('--dist')
const DRY_RUN = args.includes('--dry')

/* ─────────────── Per-platform app data dirs ─────────────── */

function userDataDir() {
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_NAME)
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
        APP_NAME
      )
    default:
      // Linux and friends follow the XDG spec.
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), APP_NAME)
  }
}

function cacheDir() {
  const home = os.homedir()
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Caches', APP_NAME)
    case 'win32':
      return path.join(
        process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        APP_NAME,
        'Cache'
      )
    default:
      return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), APP_NAME)
  }
}

/* ─────────────── Removal helpers ─────────────── */

function humanBytes(size) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function dirSize(dir) {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += dirSize(p)
        else total += fs.statSync(p).size
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    return 0
  }
  return total
}

function removeTarget(label, target) {
  if (!target) return
  if (!fs.existsSync(target)) {
    console.log(`  · ${label}: \x1b[90mnot present\x1b[0m (${target})`)
    return
  }
  const size = dirSize(target)
  if (DRY_RUN) {
    console.log(`  · ${label}: \x1b[33mwould remove\x1b[0m ${humanBytes(size)} → ${target}`)
    return
  }
  try {
    fs.rmSync(target, { recursive: true, force: true })
    console.log(`  · ${label}: \x1b[32mremoved\x1b[0m ${humanBytes(size)} → ${target}`)
  } catch (err) {
    console.log(`  · ${label}: \x1b[31mfailed\x1b[0m ${err.message}`)
  }
}

/* ─────────────── Main ─────────────── */

console.log('')
console.log('\x1b[1m  🧹 Faktur Desktop — local state cleanup\x1b[0m')
if (DRY_RUN) console.log('     (dry-run — nothing will actually be deleted)')
console.log('')

console.log('  Targets:')
removeTarget('userData', userDataDir())
removeTarget('cache', cacheDir())

if (INCLUDE_DIST) {
  removeTarget('dist', path.join(__dirname, '..', 'dist'))
}

console.log('')
console.log('\x1b[32m  ✓ Cleanup complete.\x1b[0m Next `npm run start` will boot with a blank slate.')
console.log('')

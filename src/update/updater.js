'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app } = require('electron')

const GITHUB_LATEST_URL =
  'https://api.github.com/repos/fakturapp/faktur-desktop/releases/latest'
const INSTALLER_FILENAME = 'FakturDesktop-Installer.exe'

function parseVersion(raw) {
  const clean = String(raw || '').replace(/^v/i, '')
  const parts = clean.split('-')[0].split('.').map((n) => Number.parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

function semverGt(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true
    if (pa[i] < pb[i]) return false
  }
  return false
}

function getCurrentVersion() {
  try {
    return require('../../package.json').version
  } catch {
    return '0.0.0'
  }
}

let cachedResult = null
const listeners = new Set()

function onUpdateEvent(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(event) {
  for (const cb of listeners) {
    try {
      cb(event)
    } catch {
    }
  }
}

async function checkForUpdate({ silent = false } = {}) {
  try {
    const res = await fetch(GITHUB_LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'FakturDesktop-Updater',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      if (!silent) emit({ type: 'error', message: `HTTP ${res.status}` })
      return null
    }
    const data = await res.json()
    const remoteTag = data?.tag_name
    const currentVersion = getCurrentVersion()

    if (!remoteTag || !semverGt(remoteTag, currentVersion)) {
      cachedResult = null
      emit({ type: 'none', current: currentVersion })
      return null
    }

    const asset = (data.assets || []).find((a) => a.name === INSTALLER_FILENAME)
    if (!asset) {
      cachedResult = null
      emit({
        type: 'error',
        message: `Release ${remoteTag} has no ${INSTALLER_FILENAME} asset`,
      })
      return null
    }

    const info = {
      version: String(remoteTag).replace(/^v/i, ''),
      currentVersion,
      downloadUrl: asset.browser_download_url,
      size: asset.size,
      releaseNotes: data.body || '',
      publishedAt: data.published_at,
    }
    cachedResult = info
    emit({ type: 'available', info })
    return info
  } catch (err) {
    if (!silent) emit({ type: 'error', message: err?.message || 'network error' })
    return null
  }
}

function getCachedUpdate() {
  return cachedResult
}

// ---------- Download + launch installer ----------
async function downloadAndInstall({ onProgress } = {}) {
  if (!cachedResult) {
    throw new Error('No update available — call checkForUpdate first')
  }

  const installerPath = path.join(app.getPath('temp'), INSTALLER_FILENAME)

  try {
    fs.unlinkSync(installerPath)
  } catch {
  }

  const res = await fetch(cachedResult.downloadUrl, {
    headers: { 'User-Agent': 'FakturDesktop-Updater' },
  })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || cachedResult.size || 0
  const file = fs.createWriteStream(installerPath)
  let downloaded = 0

  const reader = res.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      file.write(Buffer.from(value))
      downloaded += value.length
      if (onProgress) {
        onProgress({
          downloaded,
          total,
          percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
        })
      }
    }
  } finally {
    file.end()
    await new Promise((resolve) => file.on('close', resolve))
  }

  emit({ type: 'downloaded', path: installerPath })

  const args = ['/S', '--force-run']
  const child = spawn(installerPath, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  setTimeout(() => app.quit(), 200)
  return { installerPath }
}

module.exports = {
  checkForUpdate,
  downloadAndInstall,
  getCachedUpdate,
  onUpdateEvent,
  semverGt,
  getCurrentVersion,
  INSTALLER_FILENAME,
}

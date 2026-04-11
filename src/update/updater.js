'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const {
  getAssetNameForCurrentPlatform,
  isPlatformSupported,
} = require('./assets')
const installPlatforms = require('./install-platforms')

const GITHUB_LATEST_URL =
  'https://api.github.com/repos/fakturapp/faktur-desktop/releases/latest'

function parseVersion(raw) {
  if (raw == null) return null
  const str = String(raw).trim()
  const match = str.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return null
  return [
    Number.parseInt(match[1], 10) || 0,
    Number.parseInt(match[2] || '0', 10) || 0,
    Number.parseInt(match[3] || '0', 10) || 0,
  ]
}

function semverGt(a, b) {
  const pa = Array.isArray(a) ? a : parseVersion(a)
  const pb = Array.isArray(b) ? b : parseVersion(b)
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true
    if (pa[i] < pb[i]) return false
  }
  return false
}

function extractVersionFromRelease(data) {
  const candidates = [data?.tag_name, data?.name]
  for (const candidate of candidates) {
    const parsed = parseVersion(candidate)
    if (parsed && (parsed[0] > 0 || parsed[1] > 0 || parsed[2] > 0)) {
      return { parsed, raw: candidate }
    }
  }
  return null
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

const JUST_UPDATED_SUPPRESS_MS = 5 * 60 * 1000
const _justUpdatedAt = process.argv.includes('--updated') ? Date.now() : null

function wasJustUpdated() {
  return _justUpdatedAt !== null
}

function _isUpdateSuppressed() {
  if (_justUpdatedAt === null) return false
  return Date.now() - _justUpdatedAt < JUST_UPDATED_SUPPRESS_MS
}

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
  if (_isUpdateSuppressed()) {
    console.log('[updater] skipping check — launched with --updated flag (just installed)')
    return null
  }
  if (!isPlatformSupported()) {
    if (!silent) {
      emit({
        type: 'error',
        message: `Updates are not supported on platform ${process.platform}`,
      })
    }
    return null
  }
  const assetName = getAssetNameForCurrentPlatform()
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
    const currentVersion = getCurrentVersion()
    const currentParsed = parseVersion(currentVersion) || [0, 0, 0]

    const remote = extractVersionFromRelease(data)
    if (!remote) {
      cachedResult = null
      emit({
        type: 'error',
        message: 'Could not parse a semver from the release tag or name',
      })
      return null
    }

    if (!semverGt(remote.parsed, currentParsed)) {
      cachedResult = null
      console.log(
        `[updater] no update: installed v${currentVersion} >= latest v${remote.parsed.join('.')} (tag: ${remote.raw})`
      )
      emit({ type: 'none', current: currentVersion, latest: remote.parsed.join('.') })
      return null
    }
    console.log(
      `[updater] update available: v${currentVersion} -> v${remote.parsed.join('.')}`
    )

    const asset = (data.assets || []).find((a) => a.name === assetName)
    if (!asset) {
      cachedResult = null
      emit({
        type: 'error',
        message: `Release ${remote.raw} has no ${assetName} asset`,
      })
      return null
    }

    const info = {
      version: remote.parsed.join('.'),
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

async function downloadAndInstall({ onProgress } = {}) {
  if (!cachedResult) {
    throw new Error('No update available — call checkForUpdate first')
  }
  if (!isPlatformSupported()) {
    throw new Error(`Updates are not supported on platform ${process.platform}`)
  }

  const assetName = getAssetNameForCurrentPlatform()
  const downloadedPath = path.join(app.getPath('temp'), assetName)

  try {
    fs.unlinkSync(downloadedPath)
  } catch {
  }

  const res = await fetch(cachedResult.downloadUrl, {
    headers: { 'User-Agent': 'FakturDesktop-Updater' },
  })
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`)
  }

  const total = Number(res.headers.get('content-length')) || cachedResult.size || 0
  const file = fs.createWriteStream(downloadedPath)
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

  emit({ type: 'downloaded', path: downloadedPath })

  if (onProgress) {
    onProgress({ phase: 'installing', percent: 100, total, downloaded })
  }

  await new Promise((resolve) => setTimeout(resolve, 1500))

  try {
    app.releaseSingleInstanceLock()
  } catch {
  }

  try {
    installPlatforms.installCurrent(downloadedPath)
  } catch (err) {
    console.error('[updater] failed to launch platform installer:', err?.message || err)
    throw err
  }

  await new Promise((resolve) => setTimeout(resolve, 500))

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.destroy()
    } catch {
    }
  }

  app.exit(0)
  return { installerPath: downloadedPath }
}

module.exports = {
  checkForUpdate,
  downloadAndInstall,
  getCachedUpdate,
  onUpdateEvent,
  semverGt,
  getCurrentVersion,
  wasJustUpdated,
}

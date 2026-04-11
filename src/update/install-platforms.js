'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

// ---------- Windows ----------
function buildWindowsTrampoline(installerPath) {
  return [
    '@echo off',
    'echo Faktur Desktop is updating, please wait...',
    'timeout /t 2 /nobreak >nul 2>&1',
    `"${installerPath}"`,
    'exit /b 0',
    '',
  ].join('\r\n')
}

function installWindows(installerPath) {
  const trampolineScript = buildWindowsTrampoline(installerPath)
  const trampolinePath = path.join(
    require('electron').app.getPath('temp'),
    `faktur-updater-${Date.now()}.cmd`
  )
  fs.writeFileSync(trampolinePath, trampolineScript, 'utf8')

  const child = spawn('cmd.exe', ['/c', trampolinePath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return { trampolinePath }
}

// ---------- macOS ----------
function resolveMacAppPath() {
  let current = process.execPath
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(current)
    if (parent === current) break
    if (path.basename(parent).endsWith('.app')) return parent
    current = parent
  }
  throw new Error(
    '[updater] could not locate running .app bundle from ' + process.execPath
  )
}

function buildMacTrampoline({ zipPath, appPath }) {
  return [
    '#!/bin/sh',
    'set -e',
    'sleep 2',
    'EXTRACT_DIR=$(mktemp -d)',
    `/usr/bin/unzip -q "${zipPath}" -d "$EXTRACT_DIR"`,
    'NEW_APP=$(find "$EXTRACT_DIR" -maxdepth 2 -type d -name "*.app" | head -n 1)',
    'if [ -z "$NEW_APP" ]; then echo "[updater] no .app in zip" >&2; exit 1; fi',
    `rm -rf "${appPath}"`,
    `/usr/bin/ditto "$NEW_APP" "${appPath}"`,
    `rm -rf "$EXTRACT_DIR" "${zipPath}"`,
    `open "${appPath}" --args --updated`,
    'exit 0',
    '',
  ].join('\n')
}

function installMacOS(zipPath) {
  const appPath = resolveMacAppPath()
  const trampolineScript = buildMacTrampoline({ zipPath, appPath })
  const trampolinePath = path.join(
    require('electron').app.getPath('temp'),
    `faktur-updater-${Date.now()}.sh`
  )
  fs.writeFileSync(trampolinePath, trampolineScript, 'utf8')
  fs.chmodSync(trampolinePath, 0o755)

  const child = spawn('/bin/sh', [trampolinePath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { trampolinePath, appPath }
}

// ---------- Linux (AppImage) ----------
function resolveLinuxAppImagePath() {
  const envPath = process.env.APPIMAGE
  if (envPath && envPath.length > 0) return envPath
  throw new Error(
    '[updater] APPIMAGE environment variable is not set — refusing to install. ' +
    'In-place updates are only supported when running from an AppImage.'
  )
}

function buildLinuxTrampoline({ downloadPath, appImagePath }) {
  return [
    '#!/bin/sh',
    'set -e',
    'sleep 2',
    `mv -f "${downloadPath}" "${appImagePath}"`,
    `chmod +x "${appImagePath}"`,
    `"${appImagePath}" --updated &`,
    'exit 0',
    '',
  ].join('\n')
}

function installLinux(downloadPath) {
  const appImagePath = resolveLinuxAppImagePath()
  const trampolineScript = buildLinuxTrampoline({ downloadPath, appImagePath })
  const trampolinePath = path.join(
    require('electron').app.getPath('temp'),
    `faktur-updater-${Date.now()}.sh`
  )
  fs.writeFileSync(trampolinePath, trampolineScript, 'utf8')
  fs.chmodSync(trampolinePath, 0o755)

  const child = spawn('/bin/sh', [trampolinePath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return { trampolinePath, appImagePath }
}

// ---------- Dispatcher ----------
function installCurrent(downloadedPath) {
  switch (process.platform) {
    case 'win32':
      return installWindows(downloadedPath)
    case 'darwin':
      return installMacOS(downloadedPath)
    case 'linux':
      return installLinux(downloadedPath)
    default:
      throw new Error(
        `[updater] unsupported platform: ${process.platform}`
      )
  }
}

module.exports = {
  installCurrent,
  installWindows,
  installMacOS,
  installLinux,
  buildWindowsTrampoline,
  buildMacTrampoline,
  buildLinuxTrampoline,
  resolveMacAppPath,
  resolveLinuxAppImagePath,
}

'use strict'

const assert = require('node:assert/strict')

const assets = require('../src/update/assets')
const installPlatforms = require('../src/update/install-platforms')

let passed = 0
let failed = 0

function run(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`     ${err.message}`)
    failed++
  }
}

console.log('updater_platform')

// ---------- assets.js ----------
run('asset name resolves for win32', () => {
  assert.equal(assets.getAssetNameForPlatform('win32'), 'FakturDesktop-Installer.exe')
})

run('asset name resolves for darwin (zip, not dmg)', () => {
  const name = assets.getAssetNameForPlatform('darwin')
  assert.equal(name, 'FakturDesktop-mac.zip')
  assert.ok(!name.endsWith('.dmg'), 'updater must not target the .dmg')
})

run('asset name resolves for linux', () => {
  assert.equal(assets.getAssetNameForPlatform('linux'), 'FakturDesktop-linux-x64.AppImage')
})

run('asset name returns null for unknown platform', () => {
  assert.equal(assets.getAssetNameForPlatform('aix'), null)
})

run('isPlatformSupported is true for known platforms, false otherwise', () => {
  assert.equal(assets.isPlatformSupported('win32'), true)
  assert.equal(assets.isPlatformSupported('darwin'), true)
  assert.equal(assets.isPlatformSupported('linux'), true)
  assert.equal(assets.isPlatformSupported('freebsd'), false)
})

// ---------- Trampoline script generators ----------
run('Windows trampoline uses cmd.exe syntax and quotes installer path', () => {
  const script = installPlatforms.buildWindowsTrampoline('C:\\temp\\FakturDesktop-Installer.exe')
  assert.match(script, /@echo off/)
  assert.match(script, /timeout \/t 2 \/nobreak/)
  assert.match(script, /"C:\\temp\\FakturDesktop-Installer\.exe"/)
  // CRLF line endings are required for .cmd files
  assert.ok(script.includes('\r\n'), 'Windows trampoline must use CRLF')
})

run('macOS trampoline uses ditto and open --args --updated', () => {
  const script = installPlatforms.buildMacTrampoline({
    zipPath: '/tmp/FakturDesktop-mac.zip',
    appPath: '/Applications/Faktur Desktop.app',
  })
  assert.match(script, /^#!\/bin\/sh/)
  assert.match(script, /sleep 2/)
  assert.match(script, /\/usr\/bin\/unzip -q "\/tmp\/FakturDesktop-mac\.zip"/)
  assert.match(script, /\/usr\/bin\/ditto/)
  assert.match(script, /rm -rf "\/Applications\/Faktur Desktop\.app"/)
  assert.match(script, /open "\/Applications\/Faktur Desktop\.app" --args --updated/)
  assert.ok(!script.includes('\r\n'), 'macOS shell scripts must use LF')
})

run('Linux trampoline mv + chmod + relaunch with --updated', () => {
  const script = installPlatforms.buildLinuxTrampoline({
    downloadPath: '/tmp/FakturDesktop-linux-x64.AppImage',
    appImagePath: '/home/user/Apps/FakturDesktop.AppImage',
  })
  assert.match(script, /^#!\/bin\/sh/)
  assert.match(script, /sleep 2/)
  assert.match(script, /mv -f "\/tmp\/FakturDesktop-linux-x64\.AppImage" "\/home\/user\/Apps\/FakturDesktop\.AppImage"/)
  assert.match(script, /chmod \+x "\/home\/user\/Apps\/FakturDesktop\.AppImage"/)
  assert.match(script, /"\/home\/user\/Apps\/FakturDesktop\.AppImage" --updated &/)
})

// ---------- Linux safety: refuse to install without APPIMAGE env ----------
run('resolveLinuxAppImagePath throws when APPIMAGE env is unset', () => {
  const original = process.env.APPIMAGE
  delete process.env.APPIMAGE
  try {
    assert.throws(
      () => installPlatforms.resolveLinuxAppImagePath(),
      /APPIMAGE environment variable is not set/
    )
  } finally {
    if (original !== undefined) process.env.APPIMAGE = original
  }
})

run('resolveLinuxAppImagePath returns the env value when set', () => {
  const original = process.env.APPIMAGE
  process.env.APPIMAGE = '/tmp/fake.AppImage'
  try {
    assert.equal(installPlatforms.resolveLinuxAppImagePath(), '/tmp/fake.AppImage')
  } finally {
    if (original === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = original
  }
})

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

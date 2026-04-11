'use strict'

const ASSET_BY_PLATFORM = {
  win32: 'FakturDesktop-Installer.exe',
  darwin: 'FakturDesktop-mac.zip',
  linux: 'FakturDesktop-linux-x64.AppImage',
}

function getAssetNameForPlatform(platform) {
  return ASSET_BY_PLATFORM[platform] || null
}

function getAssetNameForCurrentPlatform() {
  return getAssetNameForPlatform(process.platform)
}

function isPlatformSupported(platform = process.platform) {
  return Object.prototype.hasOwnProperty.call(ASSET_BY_PLATFORM, platform)
}

module.exports = {
  ASSET_BY_PLATFORM,
  getAssetNameForPlatform,
  getAssetNameForCurrentPlatform,
  isPlatformSupported,
}

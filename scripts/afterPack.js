'use strict'

// ---------- electron-builder afterPack hook ----------
// Runs after every target is packed (win-unpacked, mac, linux-unpacked).
// Computes SHA-256 of the packed app.asar, signs
//   { version, asarSha256, issuedAt, expiresAt }
// with the maintainer's Ed25519 private key, and writes the result to
// resources/attestation.json next to the asar so it ships inside the
// installer.
//
// Required env:
//   FAKTUR_DESKTOP_SIGNING_KEY — base64 of Ed25519 private key in
//                                PKCS8 DER format
//
// If the env var is missing, the hook logs a warning and exits 0
// (useful for contributors building locally without the signing key).

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ENV_KEY = 'FAKTUR_DESKTOP_SIGNING_KEY'
const VALIDITY_MS = 365 * 24 * 60 * 60 * 1000

module.exports = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context
  const version = packager.appInfo.version

  // Resources directory differs between platforms
  let resourcesPath
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    const appName = packager.appInfo.productFilename
    resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources')
  } else {
    resourcesPath = path.join(appOutDir, 'resources')
  }

  const asarPath = path.join(resourcesPath, 'app.asar')
  if (!fs.existsSync(asarPath)) {
    console.warn(`[attestation] no app.asar at ${asarPath} — skipping`)
    return
  }

  const rawKey = process.env[ENV_KEY]
  if (!rawKey) {
    console.warn(
      `[attestation] ${ENV_KEY} not set — skipping signing. ` +
        'The resulting binary will NOT be certified as official. ' +
        'Set the env var to a base64-encoded PKCS8 DER Ed25519 private key.'
    )
    return
  }

  // ---------- Compute asar hash ----------
  const asarBuffer = fs.readFileSync(asarPath)
  const asarSha256 = crypto.createHash('sha256').update(asarBuffer).digest('hex')

  // ---------- Sign payload ----------
  const now = Date.now()
  const payload = {
    version,
    asarSha256,
    issuedAt: now,
    expiresAt: now + VALIDITY_MS,
    platform: electronPlatformName,
  }

  let signature
  try {
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(rawKey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    })
    signature = crypto
      .sign(null, Buffer.from(JSON.stringify(payload)), privateKey)
      .toString('base64')
  } catch (err) {
    console.error(`[attestation] failed to sign: ${err.message}`)
    throw err
  }

  // ---------- Write attestation.json ----------
  const attestation = {
    algorithm: 'ed25519',
    payload,
    signature,
  }
  const attestationPath = path.join(resourcesPath, 'attestation.json')
  fs.writeFileSync(attestationPath, JSON.stringify(attestation, null, 2))

  console.log(
    `[attestation] signed v${version} (${electronPlatformName}) ` +
      `asar=${asarSha256.slice(0, 16)}... → ${path.relative(appOutDir, attestationPath)}`
  )
}

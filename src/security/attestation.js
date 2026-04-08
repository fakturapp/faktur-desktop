'use strict'

// ---------- Runtime attestation verifier ----------
// At every boot we:
//   1. Read resources/attestation.json (written at build-time by
//      scripts/afterPack.js using the maintainer's private key).
//   2. Recompute SHA-256 of resources/app.asar at runtime.
//   3. Verify the Ed25519 signature with the hardcoded official
//      public key (src/config/keys.js).
//   4. Cross-check that the computed asar hash equals the hash that
//      was signed. Any mismatch = NOT certified.
//
// This guarantees two things at once:
//   a. The running binary was built by the legitimate maintainer
//      (signature check).
//   b. The running binary's code has not been tampered with since
//      being signed (hash check).
//
// A forked Faktur Desktop cannot produce a valid attestation because
// the attacker does not hold the Ed25519 private key, and cannot
// reuse the official attestation because their asar hash differs.

const path = require('node:path')
const crypto = require('node:crypto')
const { app } = require('electron')
const { OFFICIAL_PUBLIC_KEY_SPKI_BASE64 } = require('../config/keys')

// `original-fs` bypasses Electron's asar virtualization so we can
// read raw bytes from app.asar on disk.
let fs
try {
  fs = require('original-fs')
} catch {
  fs = require('node:fs')
}

const CACHE = { value: null }

// ---------- SHA-256 of the raw app.asar file ----------
function computeAsarHash() {
  if (!app.isPackaged) return null
  try {
    const asarPath = path.join(process.resourcesPath, 'app.asar')
    if (!fs.existsSync(asarPath)) return null
    const buffer = fs.readFileSync(asarPath)
    return crypto.createHash('sha256').update(buffer).digest('hex')
  } catch {
    return null
  }
}

// ---------- Load signed attestation.json ----------
function loadAttestationFile() {
  if (!app.isPackaged) return null
  try {
    const attestPath = path.join(process.resourcesPath, 'attestation.json')
    if (!fs.existsSync(attestPath)) return null
    const raw = fs.readFileSync(attestPath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------- Ed25519 signature verification ----------
function verifySignature(attestation) {
  try {
    const { payload, signature } = attestation
    if (!payload || !signature) return false

    const publicKey = crypto.createPublicKey({
      key: Buffer.from(OFFICIAL_PUBLIC_KEY_SPKI_BASE64, 'base64'),
      format: 'der',
      type: 'spki',
    })
    const payloadBuffer = Buffer.from(JSON.stringify(payload))
    const signatureBuffer = Buffer.from(signature, 'base64')
    return crypto.verify(null, payloadBuffer, publicKey, signatureBuffer)
  } catch {
    return false
  }
}

// ---------- Public API ----------
function getCertificationStatus() {
  if (CACHE.value) return CACHE.value

  if (!app.isPackaged) {
    CACHE.value = {
      certified: false,
      reason: 'dev_build',
      version: null,
      issuedAt: null,
    }
    return CACHE.value
  }

  const attestation = loadAttestationFile()
  if (!attestation) {
    CACHE.value = { certified: false, reason: 'no_attestation_file' }
    return CACHE.value
  }

  if (attestation.algorithm && attestation.algorithm !== 'ed25519') {
    CACHE.value = { certified: false, reason: 'unsupported_algorithm' }
    return CACHE.value
  }

  const sigValid = verifySignature(attestation)
  if (!sigValid) {
    CACHE.value = { certified: false, reason: 'signature_invalid' }
    return CACHE.value
  }

  const actualAsarHash = computeAsarHash()
  if (!actualAsarHash) {
    CACHE.value = { certified: false, reason: 'asar_hash_failed' }
    return CACHE.value
  }

  if (attestation.payload.asarSha256 !== actualAsarHash) {
    CACHE.value = { certified: false, reason: 'asar_hash_mismatch' }
    return CACHE.value
  }

  const expiresAt = Number(attestation.payload.expiresAt) || 0
  if (expiresAt && Date.now() > expiresAt) {
    CACHE.value = {
      certified: false,
      reason: 'attestation_expired',
      expiresAt,
    }
    return CACHE.value
  }

  CACHE.value = {
    certified: true,
    version: attestation.payload.version ?? null,
    issuedAt: attestation.payload.issuedAt ?? null,
    expiresAt: attestation.payload.expiresAt ?? null,
    asarSha256: actualAsarHash,
    reason: null,
  }
  return CACHE.value
}

module.exports = { getCertificationStatus }

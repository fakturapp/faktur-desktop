'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const { app } = require('electron')
const { OFFICIAL_PUBLIC_KEY_SPKI_BASE64 } = require('../config/keys')

let fs
try {
  fs = require('original-fs')
} catch {
  fs = require('node:fs')
}

const CACHE = { value: null }

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

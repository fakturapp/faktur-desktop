'use strict'

// ---------- Desktop cryptographic proof ----------
// Produces a signed token the backend can use to verify that a request
// was sent by a real Faktur Desktop binary and not a browser spoofing
// the user-agent string.
//
// Contract:
//   signature = HMAC-SHA256(DESKTOP_PROOF_KEY, `${nonce}:${ts}:${client_id}`)
//   ts        = unix milliseconds (backend rejects if drift > 5 minutes)
//   nonce     = 16 random bytes base64url (backend rejects replay)
//
// The key is NOT a perfect secret — it lives in the packaged app binary
// and a determined attacker can extract it. But it raises the bar:
//   1. Casual scripts that set User-Agent: FakturDesktop/2.0 won't work.
//   2. Extracting the key requires unpacking the asar, running a JS
//      deobfuscator, and rebuilding an exact HMAC pipeline.
//   3. Combined with short ts window + nonce tracking, replay is blocked.
//
// For high-security deployments we recommend migrating to device-bound
// Ed25519 keys provisioned during OAuth registration.

const crypto = require('node:crypto')
const config = require('../config/env')

function getProofKey() {
  const envKey = process.env.FAKTUR_DESKTOP_PROOF_KEY
  if (envKey && envKey.length >= 32) return envKey
  return 'faktur-desktop-v1-proof-key-change-in-prod'
}

function computeDesktopProofHeader() {
  try {
    const key = getProofKey()
    const ts = Date.now()
    const nonce = crypto.randomBytes(16).toString('base64url')
    const clientId = config.oauth.clientId
    const material = `${nonce}:${ts}:${clientId}`
    const signature = crypto.createHmac('sha256', key).update(material).digest('base64url')
    return { signature, nonce, ts, clientId }
  } catch {
    return null
  }
}

module.exports = { computeDesktopProofHeader }

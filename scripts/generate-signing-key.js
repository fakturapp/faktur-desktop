'use strict'

// ---------- One-time Ed25519 signing key generator ----------
// Run with: node scripts/generate-signing-key.js
//
// Outputs:
//   1. The private key as base64 — store it as the env var
//      FAKTUR_DESKTOP_SIGNING_KEY on your build machine / CI secret.
//   2. The public key as base64 — paste it into src/config/keys.js
//      so every running binary can verify signatures.
//
// NEVER commit the private key anywhere. NEVER paste it into chat.
// Rotating the key invalidates every previously-released binary's
// attestation — only rotate on a confirmed compromise, and only
// after preparing a release with the new public key.

const crypto = require('node:crypto')

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'der', type: 'pkcs8' },
  publicKeyEncoding: { format: 'der', type: 'spki' },
})

const privB64 = privateKey.toString('base64')
const pubB64 = publicKey.toString('base64')

console.log('')
console.log('========================================')
console.log(' Faktur Desktop — signing key generated ')
console.log('========================================')
console.log('')
console.log('PUBLIC KEY (paste into src/config/keys.js):')
console.log('')
console.log(pubB64)
console.log('')
console.log('PRIVATE KEY (store as env FAKTUR_DESKTOP_SIGNING_KEY):')
console.log('')
console.log(privB64)
console.log('')
console.log('Example .env for your build machine:')
console.log(`  FAKTUR_DESKTOP_SIGNING_KEY=${privB64}`)
console.log('')
console.log('NEVER commit the private key. NEVER share it.')
console.log('')

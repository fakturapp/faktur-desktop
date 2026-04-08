'use strict'

// ---------- Attestation round-trip test ----------
// Self-contained: generates a throwaway Ed25519 keypair, signs a
// payload, verifies successfully, then tampers and verifies the
// failures.

const crypto = require('node:crypto')
const assert = require('node:assert/strict')

function sign(payload, privateKey) {
  const buf = Buffer.from(JSON.stringify(payload))
  return crypto.sign(null, buf, privateKey).toString('base64')
}

function verify(payload, signature, publicKey) {
  try {
    const buf = Buffer.from(JSON.stringify(payload))
    const sig = Buffer.from(signature, 'base64')
    return crypto.verify(null, buf, publicKey, sig)
  } catch {
    return false
  }
}

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

console.log('attestation')

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const { privateKey: wrongKey } = crypto.generateKeyPairSync('ed25519')

run('valid signature verifies', () => {
  const payload = {
    version: '2.1.1',
    asarSha256: 'abcd'.repeat(16),
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000,
  }
  const signature = sign(payload, privateKey)
  assert.ok(verify(payload, signature, publicKey))
})

run('signature from wrong private key fails', () => {
  const payload = { version: '2.1.1', asarSha256: 'abcd' }
  const signature = sign(payload, wrongKey)
  assert.equal(verify(payload, signature, publicKey), false)
})

run('tampered payload breaks verification', () => {
  const payload = { version: '2.1.1', asarSha256: 'abcd' }
  const signature = sign(payload, privateKey)
  const tampered = { ...payload, version: '2.1.2' }
  assert.equal(verify(tampered, signature, publicKey), false)
})

run('tampered asar hash breaks verification', () => {
  const payload = { version: '2.1.1', asarSha256: 'abcd' }
  const signature = sign(payload, privateKey)
  const tampered = { ...payload, asarSha256: 'ef12' }
  assert.equal(verify(tampered, signature, publicKey), false)
})

run('SPKI round-trip (base64 DER)', () => {
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  const base64 = spki.toString('base64')
  const imported = crypto.createPublicKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const payload = { version: '2.1.1' }
  const signature = sign(payload, privateKey)
  assert.ok(verify(payload, signature, imported))
})

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

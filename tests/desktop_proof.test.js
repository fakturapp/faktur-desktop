'use strict'

const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const PROOF_KEY = 'faktur-desktop-v1-proof-key-change-in-prod'
const CLIENT_ID = 'test-client'

function sign(nonce, ts, clientId) {
  const material = `${nonce}:${ts}:${clientId}`
  return crypto.createHmac('sha256', PROOF_KEY).update(material).digest('base64url')
}

function verify({ signature, nonce, ts, clientId }, now = Date.now()) {
  if (!signature || !nonce || !ts || !clientId) return false
  if (Math.abs(now - ts) > 5 * 60 * 1000) return false
  const expected = sign(nonce, ts, clientId)
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ---------- Test cases ----------
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

console.log('desktop_proof')

run('valid signature passes verification', () => {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const ts = Date.now()
  const signature = sign(nonce, ts, CLIENT_ID)
  assert.ok(verify({ signature, nonce, ts, clientId: CLIENT_ID }))
})

run('tampered signature fails', () => {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const ts = Date.now()
  const signature = sign(nonce, ts, CLIENT_ID)
  const tampered = signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a')
  assert.equal(verify({ signature: tampered, nonce, ts, clientId: CLIENT_ID }), false)
})

run('tampered nonce fails', () => {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const ts = Date.now()
  const signature = sign(nonce, ts, CLIENT_ID)
  const badNonce = crypto.randomBytes(16).toString('base64url')
  assert.equal(verify({ signature, nonce: badNonce, ts, clientId: CLIENT_ID }), false)
})

run('stale timestamp (> 5 min) fails', () => {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const ts = Date.now() - 6 * 60 * 1000
  const signature = sign(nonce, ts, CLIENT_ID)
  assert.equal(verify({ signature, nonce, ts, clientId: CLIENT_ID }), false)
})

run('missing field fails', () => {
  assert.equal(verify({ signature: '', nonce: 'x', ts: Date.now(), clientId: CLIENT_ID }), false)
  assert.equal(verify({ signature: 'x', nonce: '', ts: Date.now(), clientId: CLIENT_ID }), false)
  assert.equal(verify({ signature: 'x', nonce: 'x', ts: 0, clientId: CLIENT_ID }), false)
  assert.equal(verify({ signature: 'x', nonce: 'x', ts: Date.now(), clientId: '' }), false)
})

run('cross-client mismatch fails', () => {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const ts = Date.now()
  const signature = sign(nonce, ts, CLIENT_ID)
  assert.equal(verify({ signature, nonce, ts, clientId: 'different-client' }), false)
})

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)

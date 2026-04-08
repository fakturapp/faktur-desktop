'use strict'

const crypto = require('node:crypto')

function generateCodeVerifier(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function deriveCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

function createPkcePair() {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = deriveCodeChallenge(codeVerifier)
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' }
}

module.exports = {
  generateCodeVerifier,
  deriveCodeChallenge,
  createPkcePair,
}

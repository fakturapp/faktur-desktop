'use strict'

/**
 * PKCE (RFC 7636) helper — generates a cryptographically random
 * code_verifier and derives the matching S256 code_challenge.
 *
 * We only support the S256 method; the plain method provides no
 * actual protection and is explicitly rejected by the backend.
 */

const crypto = require('node:crypto')

/**
 * Produces a 43 to 128 character base64url-encoded random string.
 * The verifier is kept in memory only — never persisted to disk.
 */
function generateCodeVerifier(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url')
}

/**
 * Derives the SHA-256 challenge for a given verifier.
 */
function deriveCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Convenience helper: creates a fresh (verifier, challenge) pair in
 * one call. Used at the start of every authorization flow.
 */
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

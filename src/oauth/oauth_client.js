'use strict'

/**
 * Low-level OAuth client — talks to the Faktur /oauth/token and
 * /oauth/revoke endpoints. This file contains zero UI logic and no
 * persistent state; it's a pure HTTP adapter so it can be unit-tested
 * against a mocked server.
 */

const crypto = require('node:crypto')
const config = require('../config/env')

class OauthClientError extends Error {
  constructor(message, code = 'oauth_error', status = 0) {
    super(message)
    this.name = 'OauthClientError'
    this.code = code
    this.status = status
  }
}

function buildAuthorizeUrl({ redirectUri, state, codeChallenge, codeChallengeMethod }) {
  const base = config.urls.authorize
  const url = new URL(base)
  url.searchParams.set('client_id', config.oauth.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.oauth.scopes.join(' '))
  url.searchParams.set('state', state)
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', codeChallengeMethod || 'S256')
  }
  return url.toString()
}

function generateState(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url')
}

async function postForm(path, body) {
  const url = `${config.api.baseUrl}${config.api.prefix}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new OauthClientError(
      (data && (data.error_description || data.message)) || `HTTP ${res.status}`,
      (data && data.error) || 'http_error',
      res.status
    )
  }
  return data
}

/**
 * Exchanges an authorization code for a token pair. Called right after
 * the loopback server captures the callback.
 */
async function exchangeCodeForToken({ code, redirectUri, codeVerifier, deviceInfo }) {
  return postForm('/oauth/token', {
    grant_type: 'authorization_code',
    client_id: config.oauth.clientId,
    client_secret: config.oauth.clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    device_name: deviceInfo?.name ?? null,
    device_platform: deviceInfo?.platform ?? null,
    device_os: deviceInfo?.os ?? null,
  })
}

/**
 * Exchanges a refresh_token for a fresh token pair. The backend
 * rotates the refresh token on every call so we always persist the
 * brand-new one and drop the old one.
 */
async function refreshAccessToken({ refreshToken }) {
  return postForm('/oauth/token', {
    grant_type: 'refresh_token',
    client_id: config.oauth.clientId,
    client_secret: config.oauth.clientSecret,
    refresh_token: refreshToken,
  })
}

/**
 * Revokes a token (logout). Never throws — revocation is best-effort.
 */
async function revokeToken({ token, hint }) {
  try {
    await postForm('/oauth/revoke', {
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      token,
      token_type_hint: hint || 'access_token',
    })
  } catch {
    /* ignore */
  }
}

module.exports = {
  OauthClientError,
  buildAuthorizeUrl,
  generateState,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
}

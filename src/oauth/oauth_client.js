'use strict'

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

// ---------- URL helpers ----------
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

// ---------- HTTP core ----------
// Desktop is a PUBLIC OAuth client: we rely on PKCE (RFC 7636) rather
// than an embedded client_secret. The secret would be trivially
// extractable from the packaged binary and provides no real protection.
async function postForm(path, body) {
  const url = `${config.api.baseUrl}${config.api.prefix}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'FakturDesktop/2.0',
    },
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

// ---------- Grants ----------
async function exchangeCodeForToken({ code, redirectUri, codeVerifier, deviceInfo }) {
  return postForm('/oauth/token', {
    grant_type: 'authorization_code',
    client_id: config.oauth.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    device_name: deviceInfo?.name ?? null,
    device_platform: deviceInfo?.platform ?? null,
    device_os: deviceInfo?.os ?? null,
  })
}

async function refreshAccessToken({ refreshToken }) {
  return postForm('/oauth/token', {
    grant_type: 'refresh_token',
    client_id: config.oauth.clientId,
    refresh_token: refreshToken,
  })
}

async function revokeToken({ token, hint }) {
  try {
    await postForm('/oauth/revoke', {
      client_id: config.oauth.clientId,
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

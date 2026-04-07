'use strict'

/**
 * Session bridge — trades the OAuth access_token for a regular
 * dashboard session token (the same format the web dashboard stores
 * in localStorage.faktur_token).
 *
 * This is what makes the embedded BrowserWindow boot directly into
 * the authenticated dashboard instead of showing the login form:
 *
 *   desktop OAuth access_token
 *         │
 *         ▼
 *   POST /oauth/exchange-session
 *         │
 *         ▼
 *   { token, user, vaultKey, vaultLocked }
 *         │
 *         ▼
 *   webContents.executeJavaScript(
 *     `localStorage.setItem('faktur_token', '${token}')`
 *   )
 *         │
 *         ▼
 *   loadURL('https://dash.fakturapp.cc')
 */

const config = require('../config/env')

class SessionBridgeError extends Error {
  constructor(message, code = 'bridge_error', status = 0) {
    super(message)
    this.name = 'SessionBridgeError'
    this.code = code
    this.status = status
  }
}

/**
 * Calls the backend exchange endpoint with the user's OAuth access
 * token and returns the dashboard session payload.
 *
 * @param {string} oauthAccessToken Raw OAuth access token
 * @returns {Promise<{token: string, user: object, vaultKey: string|null, vaultLocked: boolean}>}
 */
async function exchangeForDashboardSession(oauthAccessToken) {
  const url = `${config.api.baseUrl}${config.api.prefix}/oauth/exchange-session`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${oauthAccessToken}`,
      Accept: 'application/json',
      'User-Agent': 'FakturDesktop/2.0',
    },
    signal: AbortSignal.timeout(15_000),
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }

  if (!res.ok) {
    throw new SessionBridgeError(
      (data && (data.error_description || data.message)) || `HTTP ${res.status}`,
      (data && data.error) || 'http_error',
      res.status
    )
  }

  if (!data?.token) {
    throw new SessionBridgeError('Backend did not return a token', 'missing_token')
  }

  return data
}

module.exports = { exchangeForDashboardSession, SessionBridgeError }

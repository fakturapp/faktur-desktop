'use strict'

const config = require('../config/env')

class SessionBridgeError extends Error {
  constructor(message, code = 'bridge_error', status = 0) {
    super(message)
    this.name = 'SessionBridgeError'
    this.code = code
    this.status = status
  }
}

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

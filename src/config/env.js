'use strict'

const path = require('node:path')
const dotenv = require('dotenv')
const { app } = require('electron')

// ---------- .env loader ----------
const envPath = path.join(
  app?.isPackaged ? path.dirname(app.getAppPath()) : process.cwd(),
  '.env'
)
dotenv.config({ path: envPath })

function parseScopes(raw) {
  if (!raw) return ['profile']
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function required(name, fallback) {
  const value = process.env[name] ?? fallback
  if (!value) {
    throw new Error(
      `[faktur-desktop] Missing required env variable ${name}. ` +
        `Copy .env.example to .env and fill in the values issued by the admin panel.`
    )
  }
  return value
}

function optional(name, fallback) {
  return process.env[name] ?? fallback
}

// ---------- Frozen config object ----------
// NOTE: client_secret intentionally REMOVED — the desktop is a public
// OAuth client and relies exclusively on PKCE. Any secret embedded in
// the binary is extractable and provides no real protection.
const config = Object.freeze({
  env: optional('FAKTUR_ENV', 'production'),
  devtools: optional('FAKTUR_DEVTOOLS', 'false') === 'true',

  oauth: {
    clientId: required('FAKTUR_OAUTH_CLIENT_ID'),
    scopes: parseScopes(
      optional(
        'FAKTUR_OAUTH_SCOPES',
        'profile invoices:read invoices:write clients:read clients:write vault:unlock offline_access'
      )
    ),
  },

  api: {
    baseUrl: optional('FAKTUR_API_BASE_URL', 'https://api.fakturapp.cc'),
    prefix: optional('FAKTUR_API_PREFIX', '/api/v1'),
  },

  urls: {
    dashboard: optional('FAKTUR_DASHBOARD_URL', 'https://dash.fakturapp.cc'),
    authorize: optional('FAKTUR_AUTHORIZE_URL', 'https://dash.fakturapp.cc/oauth/authorize'),
  },

  callback: {
    host: optional('FAKTUR_CALLBACK_HOST', '127.0.0.1'),
    path: optional('FAKTUR_CALLBACK_PATH', '/callback'),
    port: Number.parseInt(optional('FAKTUR_CALLBACK_PORT', '0'), 10) || 0,
  },
})

module.exports = config

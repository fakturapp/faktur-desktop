'use strict'

module.exports = Object.freeze({
  APP_NAME: 'Faktur Desktop',
  APP_ID: 'cc.fakturapp.desktop',

  // ---------- IPC channels ----------
  ipc: {
    SESSION_STATE_CHANGED: 'session:state-changed',
    SESSION_GET_STATE: 'session:get-state',
    AUTH_START: 'auth:start',
    AUTH_LOGOUT: 'auth:logout',
    VAULT_OPEN_UNLOCK: 'vault:open-unlock',
    OPEN_EXTERNAL: 'window:open-external',
    GET_APP_INFO: 'app:get-info',
  },

  // ---------- Session state enum ----------
  session: {
    UNAUTHENTICATED: 'unauthenticated',
    AUTHENTICATING: 'authenticating',
    AUTHENTICATED: 'authenticated',
    VAULT_LOCKED: 'vault-locked',
    REVOKED: 'revoked',
    ERROR: 'error',
  },

  // ---------- Secure store keys ----------
  storageKeys: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    TOKEN_EXPIRES_AT: 'token_expires_at',
    REFRESH_EXPIRES_AT: 'refresh_expires_at',
    SCOPES: 'scopes',
    USER: 'user',
  },
})

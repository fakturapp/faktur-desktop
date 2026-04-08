'use strict'

module.exports = Object.freeze({
  APP_NAME: 'Faktur',
  APP_ID: 'cc.fakturapp.desktop',

  ipc: {
    SESSION_STATE_CHANGED: 'session:state-changed',
    SESSION_GET_STATE: 'session:get-state',
    AUTH_START: 'auth:start',
    AUTH_LOGOUT: 'auth:logout',
    VAULT_OPEN_UNLOCK: 'vault:open-unlock',
    OPEN_EXTERNAL: 'window:open-external',
  },

  session: {
    UNAUTHENTICATED: 'unauthenticated',
    AUTHENTICATING: 'authenticating',
    AUTHENTICATED: 'authenticated',
    VAULT_LOCKED: 'vault-locked',
    REVOKED: 'revoked',
    ERROR: 'error',
  },

  storageKeys: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    TOKEN_EXPIRES_AT: 'token_expires_at',
    REFRESH_EXPIRES_AT: 'refresh_expires_at',
    SCOPES: 'scopes',
    USER: 'user',
  },
})
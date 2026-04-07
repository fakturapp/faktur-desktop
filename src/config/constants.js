'use strict'

/**
 * Hard-coded runtime constants that should not live in .env because
 * they are tied to the app build itself.
 */

module.exports = Object.freeze({
  APP_NAME: 'Faktur',
  APP_ID: 'cc.fakturapp.desktop',

  /** IPC channel names — centralised so renderer and main stay in sync */
  ipc: {
    // Session lifecycle
    SESSION_STATE_CHANGED: 'session:state-changed',
    SESSION_GET_STATE: 'session:get-state',

    // Auth flow (invoked from renderer)
    AUTH_START: 'auth:start',
    AUTH_LOGOUT: 'auth:logout',

    // Vault flow
    VAULT_OPEN_UNLOCK: 'vault:open-unlock',

    // Window management
    OPEN_EXTERNAL: 'window:open-external',
  },

  /** Local state machine emitted to the renderer */
  session: {
    UNAUTHENTICATED: 'unauthenticated',
    AUTHENTICATING: 'authenticating',
    AUTHENTICATED: 'authenticated',
    VAULT_LOCKED: 'vault-locked',
    REVOKED: 'revoked',
    ERROR: 'error',
  },

  /** Electron safeStorage keys used in the encrypted store */
  storageKeys: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    TOKEN_EXPIRES_AT: 'token_expires_at',
    REFRESH_EXPIRES_AT: 'refresh_expires_at',
    SCOPES: 'scopes',
    USER: 'user',
  },
})

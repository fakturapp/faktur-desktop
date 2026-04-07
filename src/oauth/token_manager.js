'use strict'

/**
 * Stateful façade on top of the low-level oauth_client that:
 *
 *  1. Orchestrates a fresh authorization flow (PKCE + loopback).
 *  2. Persists and refreshes tokens via the secure store.
 *  3. Exposes a single `getAccessToken()` used by every authenticated
 *     request: it transparently refreshes expired tokens and wipes
 *     the store on revocation.
 *  4. Notifies subscribers of session state changes so the main
 *     process can push the latest status to the renderer.
 */

const { shell } = require('electron')
const os = require('node:os')
const oauthClient = require('./oauth_client')
const pkce = require('./pkce')
const loopback = require('../loopback/callback_server')
const secureStore = require('../store/secure_store')
const config = require('../config/env')
const constants = require('../config/constants')

const { storageKeys, session: sessionStates } = constants

/** Soft margin — refresh the access token if it expires in less than this. */
const REFRESH_MARGIN_MS = 60 * 1000

class TokenManager {
  constructor() {
    this.listeners = new Set()
    this.state = sessionStates.UNAUTHENTICATED
    this.currentFlow = null
  }

  /** Subscribe to session state changes. Returns an unsubscribe fn. */
  onStateChange(cb) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  _emit(state, extra = {}) {
    this.state = state
    for (const cb of this.listeners) {
      try {
        cb({ state, ...extra })
      } catch {
        /* ignore individual subscriber failures */
      }
    }
  }

  /** Lazy-checks the store and returns the current state on boot. */
  bootstrap() {
    const access = secureStore.get(storageKeys.ACCESS_TOKEN)
    const refresh = secureStore.get(storageKeys.REFRESH_TOKEN)
    if (access && refresh) {
      this._emit(sessionStates.AUTHENTICATED)
      return sessionStates.AUTHENTICATED
    }
    this._emit(sessionStates.UNAUTHENTICATED)
    return sessionStates.UNAUTHENTICATED
  }

  /** Full OAuth flow — opens the system browser, waits for callback. */
  async startAuthorizationFlow() {
    if (this.currentFlow) return this.currentFlow.promise

    this._emit(sessionStates.AUTHENTICATING)

    const { codeVerifier, codeChallenge, codeChallengeMethod } = pkce.createPkcePair()
    const state = oauthClient.generateState()
    const server = loopback.startCallbackServer({ expectedState: state })
    await server.ready
    const redirectUri = server.getRedirectUri()

    const authorizeUrl = oauthClient.buildAuthorizeUrl({
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
    })

    // Open in the real browser — this is the whole point of OAuth:
    // no password ever touches Electron.
    shell.openExternal(authorizeUrl).catch(() => {
      /* user has no browser? they'll see the loopback timeout */
    })

    const promise = (async () => {
      try {
        const { code } = await server.wait
        const tokenResponse = await oauthClient.exchangeCodeForToken({
          code,
          redirectUri,
          codeVerifier,
          deviceInfo: {
            name: `${os.hostname()} · Faktur Desktop`,
            platform: 'desktop',
            os: `${os.type()} ${os.release()}`,
          },
        })
        this._persistTokenResponse(tokenResponse)
        this._emit(sessionStates.AUTHENTICATED)
        return tokenResponse
      } catch (err) {
        this._emit(sessionStates.ERROR, { error: err?.message || 'authentication failed' })
        throw err
      } finally {
        server.close()
        this.currentFlow = null
      }
    })()

    this.currentFlow = { promise }
    return promise
  }

  /**
   * Returns a valid access token, refreshing it transparently if
   * needed. Throws if the session cannot be restored — the caller
   * should then present the login screen.
   */
  async getAccessToken() {
    const access = secureStore.get(storageKeys.ACCESS_TOKEN)
    const refresh = secureStore.get(storageKeys.REFRESH_TOKEN)
    const expiresAtRaw = secureStore.get(storageKeys.TOKEN_EXPIRES_AT)
    if (!access || !refresh) {
      this._emit(sessionStates.UNAUTHENTICATED)
      throw new Error('No active session')
    }

    const expiresAt = Number(expiresAtRaw ?? 0)
    if (Date.now() < expiresAt - REFRESH_MARGIN_MS) {
      return access
    }

    try {
      const tokenResponse = await oauthClient.refreshAccessToken({ refreshToken: refresh })
      this._persistTokenResponse(tokenResponse)
      return tokenResponse.access_token
    } catch (err) {
      // Treat any refresh failure as a hard logout — the remote side
      // may have revoked our tokens (admin panel, security rotation).
      this.logout({ remoteRevoke: false, reason: 'refresh_failed' })
      throw err
    }
  }

  /** Wipes the store, best-effort revokes, emits state. */
  async logout({ remoteRevoke = true, reason = 'user_logout' } = {}) {
    const access = secureStore.get(storageKeys.ACCESS_TOKEN)
    const refresh = secureStore.get(storageKeys.REFRESH_TOKEN)

    secureStore.clear()

    if (remoteRevoke) {
      if (access) await oauthClient.revokeToken({ token: access, hint: 'access_token' })
      if (refresh) await oauthClient.revokeToken({ token: refresh, hint: 'refresh_token' })
    }

    this._emit(sessionStates.UNAUTHENTICATED, { reason })
  }

  /** Copies the token response payload into the encrypted store. */
  _persistTokenResponse(res) {
    const accessExpiresAt = Date.now() + Number(res.expires_in ?? 3600) * 1000
    const refreshExpiresAt = Date.now() + Number(res.refresh_expires_in ?? 0) * 1000
    secureStore.setMany({
      [storageKeys.ACCESS_TOKEN]: res.access_token,
      [storageKeys.REFRESH_TOKEN]: res.refresh_token,
      [storageKeys.TOKEN_EXPIRES_AT]: String(accessExpiresAt),
      [storageKeys.REFRESH_EXPIRES_AT]: String(refreshExpiresAt),
      [storageKeys.SCOPES]: res.scope ?? '',
    })
  }
}

module.exports = new TokenManager()

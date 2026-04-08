'use strict'

const { shell } = require('electron')
const os = require('node:os')
const oauthClient = require('./oauth_client')
const pkce = require('./pkce')
const loopback = require('../loopback/callback_server')
const secureStore = require('../store/secure_store')
const config = require('../config/env')
const constants = require('../config/constants')

const { storageKeys, session: sessionStates } = constants

const REFRESH_MARGIN_MS = 60 * 1000

class TokenManager {
  constructor() {
    this.listeners = new Set()
    this.state = sessionStates.UNAUTHENTICATED
    this.currentFlow = null
  }

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
        /* ignore */
      }
    }
  }

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

    shell.openExternal(authorizeUrl).catch(() => {})

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
      const status = err?.status || 0
      const hardFail = status === 400 || status === 401
      if (hardFail) {
        await this.logout({ remoteRevoke: false, reason: 'refresh_failed' })
      }
      throw err
    }
  }

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

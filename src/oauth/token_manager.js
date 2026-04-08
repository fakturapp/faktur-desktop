'use strict'

const { shell, session } = require('electron')
const os = require('node:os')
const oauthClient = require('./oauth_client')
const pkce = require('./pkce')
const loopback = require('../loopback/callback_server')
const secureStore = require('../store/secure_store')
const config = require('../config/env')
const constants = require('../config/constants')

const { storageKeys, session: sessionStates } = constants

const REFRESH_MARGIN_MS = 60 * 1000
const SHELL_PARTITION = 'persist:faktur-desktop-shell'
const LOGIN_PARTITION = 'persist:faktur-desktop-login'
const LOOPBACK_PROGRESS_MS = 500
const SUCCESS_DWELL_MS = 900

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

  async startAuthorizationFlow({ intent = 'login' } = {}) {
    if (this.currentFlow) return this.currentFlow.promise

    this._emit(sessionStates.AUTHENTICATING, { step: 'opening_browser' })

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
    const externalUrl =
      intent === 'register'
        ? oauthClient.buildRegisterUrl({ authorizeUrl })
        : authorizeUrl

    shell.openExternal(externalUrl).catch(() => {})

    setTimeout(() => {
      if (this.state === sessionStates.AUTHENTICATING) {
        this._emit(sessionStates.AUTHENTICATING, { step: 'waiting_callback' })
      }
    }, 500)

    const promise = (async () => {
      try {
        const { code } = await server.wait
        this._emit(sessionStates.AUTHENTICATING, { step: 'exchanging' })

        const exchangePromise = oauthClient.exchangeCodeForToken({
          code,
          redirectUri,
          codeVerifier,
          deviceInfo: {
            name: `${os.hostname()} · Faktur Desktop`,
            platform: 'desktop',
            os: `${os.type()} ${os.release()}`,
          },
        })
        const minDelay = new Promise((resolve) => setTimeout(resolve, LOOPBACK_PROGRESS_MS))
        const [tokenResponse] = await Promise.all([exchangePromise, minDelay])
        this._persistTokenResponse(tokenResponse)

        this._emit(sessionStates.AUTHENTICATING, { step: 'success' })
        await new Promise((resolve) => setTimeout(resolve, SUCCESS_DWELL_MS))
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

  // ---------- Access token accessor ----------
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

  // ---------- Logout ----------
  async logout({ remoteRevoke = true, reason = 'user_logout', wipeAll = false } = {}) {
    const access = secureStore.get(storageKeys.ACCESS_TOKEN)
    const refresh = secureStore.get(storageKeys.REFRESH_TOKEN)

    secureStore.clear()
    if (wipeAll) {
      await this._wipeAllSessionStorage()
    }

    if (remoteRevoke) {
      if (access) await oauthClient.revokeToken({ token: access, hint: 'access_token' })
      if (refresh) await oauthClient.revokeToken({ token: refresh, hint: 'refresh_token' })
    }

    this._emit(sessionStates.UNAUTHENTICATED, { reason })
  }

  // ---------- Nuke every browser-side storage bucket ----------
  async _wipeAllSessionStorage() {
    const partitions = [SHELL_PARTITION, LOGIN_PARTITION]
    const wipeOptions = {
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'websql',
        'serviceworkers',
        'cachestorage',
      ],
    }
    for (const partitionName of partitions) {
      try {
        const ses = session.fromPartition(partitionName)
        await ses.clearStorageData(wipeOptions)
        await ses.clearCache()
        if (typeof ses.clearAuthCache === 'function') await ses.clearAuthCache()
        await ses.clearHostResolverCache().catch(() => {})
      } catch (err) {
        console.error(`[token-manager] failed to wipe ${partitionName}:`, err?.message || err)
      }
    }
    try {
      const defaultSession = session.defaultSession
      await defaultSession.clearStorageData(wipeOptions)
      await defaultSession.clearCache()
    } catch {
    }
  }

  // ---------- Persistence ----------
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

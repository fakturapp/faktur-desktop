'use strict'

const button = document.getElementById('connect')
const registerBtn = document.getElementById('register')
const label = document.getElementById('label')
const iconSlot = document.getElementById('icon-slot')
const errorBox = document.getElementById('error')
const banner = document.getElementById('banner')
const bannerTitle = document.getElementById('banner-title')
const bannerMessage = document.getElementById('banner-message')
const updatePill = document.getElementById('update-pill')
const updatePillVersion = document.getElementById('update-pill-version')

const DISCONNECT_MESSAGES = {
  token_invalid: {
    title: 'Vous avez été déconnecté(e)',
    message:
      'Votre session a expiré ou a été révoquée à distance. Reconnectez-vous pour continuer.',
    variant: 'red',
  },
  token_expired: {
    title: 'Session expirée',
    message: 'Votre session OAuth a expiré. Veuillez vous reconnecter.',
    variant: 'red',
  },
  bridge_failed: {
    title: 'Échec du pont de session',
    message:
      "Faktur n'a pas pu valider votre session. Vos identifiants locaux ont été effacés par sécurité.",
    variant: 'red',
  },
  vault_locked: {
    title: 'Coffre-fort verrouillé',
    message:
      "Votre coffre-fort est verrouillé et ne peut pas être déverrouillé depuis le bureau. " +
      'Reconnectez-vous pour démarrer une nouvelle session.',
    variant: 'amber',
  },
  network_error: {
    title: 'Erreur réseau',
    message: 'Impossible de contacter les serveurs Faktur. Vérifiez votre connexion.',
    variant: 'red',
  },
  refresh_failed: {
    title: 'Session perdue',
    message: 'Le jeton de rafraîchissement a échoué. Reconnectez-vous pour continuer.',
    variant: 'red',
  },
  user_logout: null,
  session_expired: {
    title: 'Session expirée',
    message: 'Votre session a expiré. Reconnectez-vous pour continuer.',
    variant: 'red',
  },
  revoked: {
    title: 'Accès révoqué',
    message:
      "Un administrateur ou vous-même avez révoqué cette application depuis Mon compte → " +
      'Applications connectées.',
    variant: 'red',
  },
}

function getReasonFromQuery() {
  try {
    const url = new URL(window.location.href)
    return url.searchParams.get('reason')
  } catch {
    return null
  }
}

function showBanner(reason) {
  if (!reason) return
  const meta = DISCONNECT_MESSAGES[reason]
  if (!meta) return
  bannerTitle.textContent = meta.title
  bannerMessage.textContent = meta.message
  banner.classList.add('visible')
  if (meta.variant === 'amber') banner.classList.add('amber')
}

showBanner(getReasonFromQuery())

function showError(msg) {
  errorBox.textContent = msg
  errorBox.classList.add('visible')
}

function clearError() {
  errorBox.textContent = ''
  errorBox.classList.remove('visible')
}

const SPINNER_HTML = '<span class="faktur-spinner"></span>'
const CHECK_HTML =
  '<span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>'

function setStage(stage) {
  button.classList.remove('success')

  switch (stage) {
    case 'idle':
      button.disabled = false
      if (registerBtn) registerBtn.disabled = false
      iconSlot.innerHTML = ''
      label.textContent = 'Se connecter avec Faktur'
      break

    case 'opening_browser':
      button.disabled = true
      if (registerBtn) registerBtn.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'Ouverture du navigateur…'
      break

    case 'waiting_callback':
      button.disabled = true
      if (registerBtn) registerBtn.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'En attente de connexion…'
      break

    case 'received_callback':
    case 'exchanging':
      button.disabled = true
      if (registerBtn) registerBtn.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'Connexion en cours…'
      break

    case 'success':
      button.disabled = true
      if (registerBtn) registerBtn.disabled = true
      button.classList.add('success')
      iconSlot.innerHTML = CHECK_HTML
      label.textContent = 'Connexion réussie'
      break

    default:
      setStage('idle')
  }
}

function isTimeoutError(msg) {
  if (!msg) return false
  const lower = String(msg).toLowerCase()
  return lower.includes('timeout') || lower.includes('expir')
}

async function startAuth(intent) {
  clearError()
  banner.classList.remove('visible')
  setStage('opening_browser')
  try {
    const result = await window.faktur.startAuth({ intent })
    if (!result?.ok) {
      if (isTimeoutError(result?.error)) {
        showError(
          'La demande de connexion a expiré. Vous avez 5 minutes pour vous connecter dans le navigateur — veuillez réessayer.'
        )
      } else {
        showError(result?.error || "Impossible de démarrer l'authentification")
      }
      setStage('idle')
    }
  } catch (err) {
    showError(err?.message || 'Erreur inattendue')
    setStage('idle')
  }
}

button.addEventListener('click', () => startAuth('login'))
if (registerBtn) {
  registerBtn.addEventListener('click', () => startAuth('register'))
}

function showUpdatePill(info) {
  if (!info || !updatePill) return
  if (updatePillVersion && info.version) {
    updatePillVersion.textContent = `v${info.version}`
  }
  updatePill.classList.add('visible')
}

if (window.faktur?.getPendingUpdate) {
  window.faktur
    .getPendingUpdate()
    .then((info) => {
      if (info) showUpdatePill(info)
    })
    .catch(() => {})
}

if (window.faktur?.onUpdateAvailable) {
  window.faktur.onUpdateAvailable((info) => {
    if (info) showUpdatePill(info)
  })
}

if (updatePill) {
  updatePill.addEventListener('click', async () => {
    if (updatePill.disabled) return
    updatePill.disabled = true
    try {
      await window.faktur?.beginUpdate?.()
    } catch {
      updatePill.disabled = false
    }
  })
}

if (window.faktur?.onSessionChange) {
  window.faktur.onSessionChange((payload) => {
    if (!payload) return

    if (payload.state === 'authenticating' && payload.step) {
      setStage(payload.step)
      return
    }
    if (payload.state === 'authenticated') {
      setStage('success')
      return
    }
    if (payload.state === 'error') {
      setStage('idle')
      if (isTimeoutError(payload.error)) {
        showError(
          'La demande de connexion a expiré. Vous avez 5 minutes pour vous connecter dans le navigateur — veuillez réessayer.'
        )
      } else {
        showError(payload.error || 'Erreur inconnue')
      }
    }
  })
}

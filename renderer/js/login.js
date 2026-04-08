'use strict'

// ---------- Element refs ----------
const button = document.getElementById('connect')
const label = document.getElementById('label')
const iconSlot = document.getElementById('icon-slot')
const halo = document.getElementById('halo')
const errorBox = document.getElementById('error')
const banner = document.getElementById('banner')
const bannerTitle = document.getElementById('banner-title')
const bannerMessage = document.getElementById('banner-message')
const title = document.getElementById('title')
const subtitle = document.getElementById('subtitle')

// ---------- Disconnect banner strings ----------
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

// ---------- Error helpers ----------
function showError(msg) {
  errorBox.textContent = msg
  errorBox.classList.add('visible')
}

function clearError() {
  errorBox.textContent = ''
  errorBox.classList.remove('visible')
}

// ---------- Button/label state machine ----------
const SPINNER_HTML = '<span class="faktur-spinner"></span>'
const CHECK_HTML =
  '<span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>'

function setStage(stage) {
  button.classList.remove('success')

  switch (stage) {
    case 'idle':
      button.disabled = false
      iconSlot.innerHTML = ''
      label.textContent = 'Se connecter avec Faktur'
      halo.classList.remove('pulsing')
      break

    case 'opening_browser':
      button.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'Ouverture du navigateur…'
      halo.classList.add('pulsing')
      break

    case 'waiting_callback':
      button.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'En attente de connexion…'
      halo.classList.add('pulsing')
      break

    case 'received_callback':
    case 'exchanging':
      button.disabled = true
      iconSlot.innerHTML = SPINNER_HTML
      label.textContent = 'Connexion en cours…'
      halo.classList.add('pulsing')
      break

    case 'success':
      button.disabled = true
      button.classList.add('success')
      iconSlot.innerHTML = CHECK_HTML
      label.textContent = 'Connexion réussie'
      halo.classList.remove('pulsing')
      break

    default:
      setStage('idle')
  }
}

// ---------- Click handler ----------
button.addEventListener('click', async () => {
  clearError()
  banner.classList.remove('visible')
  setStage('opening_browser')
  try {
    const result = await window.faktur.startAuth()
    if (!result?.ok) {
      showError(result?.error || "Impossible de démarrer l'authentification")
      setStage('idle')
    }
  } catch (err) {
    showError(err?.message || 'Erreur inattendue')
    setStage('idle')
  }
})

// ---------- Session state sub-step listener ----------
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
      showError(payload.error || 'Erreur inconnue')
    }
  })
}

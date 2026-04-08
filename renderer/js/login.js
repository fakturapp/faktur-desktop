'use strict'

const button = document.getElementById('connect')
const label = document.getElementById('label')
const errorBox = document.getElementById('error')
const banner = document.getElementById('banner')
const bannerTitle = document.getElementById('banner-title')
const bannerMessage = document.getElementById('banner-message')

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

function setLoading(isLoading) {
  button.disabled = isLoading
  label.innerHTML = isLoading
    ? '<span class="spinner"></span> Ouverture du navigateur…'
    : 'Se connecter avec Faktur'
}

button.addEventListener('click', async () => {
  clearError()
  banner.classList.remove('visible')
  setLoading(true)
  try {
    const result = await window.faktur.startAuth()
    if (!result?.ok) {
      showError(result?.error || "Impossible de démarrer l'authentification")
    }
  } catch (err) {
    showError(err?.message || 'Erreur inattendue')
  } finally {
    setLoading(false)
  }
})

if (window.faktur?.onSessionChange) {
  window.faktur.onSessionChange((payload) => {
    if (payload.state === 'error') {
      setLoading(false)
      showError(payload.error || 'Erreur inconnue')
    }
  })
}

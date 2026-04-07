'use strict'

/**
 * Login window renderer. Minimal: a 'Se connecter' button that
 * invokes the main-process auth flow, shows a spinner while the
 * browser dance runs, and surfaces any error back on the card.
 */

const button = document.getElementById('connect')
const label = document.getElementById('label')
const errorBox = document.getElementById('error')

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
  setLoading(true)
  try {
    const result = await window.faktur.startAuth()
    if (!result?.ok) {
      showError(result?.error || "Impossible de démarrer l'authentification")
    }
  } catch (err) {
    showError(err?.message || "Erreur inattendue")
  } finally {
    setLoading(false)
  }
})

// If the main process flips the session to 'authenticated' while this
// window is still visible, it will be closed automatically — we don't
// need to do anything here, but we still listen to expose debug info.
if (window.faktur?.onSessionChange) {
  window.faktur.onSessionChange((payload) => {
    if (payload.state === 'error') {
      setLoading(false)
      showError(payload.error || 'Erreur inconnue')
    }
  })
}

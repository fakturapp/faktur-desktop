'use strict'

const f = window.fakturDesktop

const elTeams = document.getElementById('teams')
const elLoading = document.getElementById('loading')
const elEmpty = document.getElementById('empty')
const elErr = document.getElementById('err')
const elAlwaysShow = document.getElementById('always-show')
const elUserRow = document.getElementById('user-row')
const elUserAvatar = document.getElementById('user-avatar')
const elUserFullName = document.getElementById('user-fullname')
const elUserEmail = document.getElementById('user-email')
const elLogout = document.getElementById('logout')

const SVG_NS = 'http://www.w3.org/2000/svg'

function makeIcon(paths, viewBox) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', viewBox || '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  for (const def of paths) {
    const el = document.createElementNS(SVG_NS, def.tag)
    for (const [k, v] of Object.entries(def.attrs)) el.setAttribute(k, v)
    svg.appendChild(el)
  }
  return svg
}

function lockIcon() {
  return makeIcon([
    { tag: 'rect', attrs: { x: '3', y: '11', width: '18', height: '11', rx: '2' } },
    { tag: 'path', attrs: { d: 'M7 11V7a5 5 0 0 1 10 0v4' } },
  ])
}

function arrowIcon() {
  return makeIcon([{ tag: 'path', attrs: { d: 'm9 18 6-6-6-6' } }])
}

function showError(msg) {
  elErr.textContent = msg
  elErr.classList.add('visible')
}

function clearError() {
  elErr.textContent = ''
  elErr.classList.remove('visible')
}

function initialsFor(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function renderUser(user) {
  if (!user) return
  elUserFullName.textContent = user.fullName || user.email || 'Utilisateur'
  elUserEmail.textContent = user.email || ''
  if (user.avatarUrl) {
    const img = document.createElement('img')
    img.src = user.avatarUrl
    img.alt = user.fullName || user.email || ''
    elUserAvatar.textContent = ''
    elUserAvatar.appendChild(img)
  } else {
    elUserAvatar.textContent = initialsFor(user.fullName || user.email || '?')
  }
  elUserRow.hidden = false
}

function renderTeams(teams) {
  while (elTeams.firstChild) elTeams.removeChild(elTeams.firstChild)
  for (const team of teams) {
    const node = document.createElement('button')
    node.type = 'button'
    node.className = 'team' + (team.locked ? ' locked' : '')
    node.setAttribute('data-team-id', team.id)
    node.setAttribute('data-locked', team.locked ? '1' : '0')

    const icon = document.createElement('span')
    icon.className = 'team-icon'
    if (team.iconUrl) {
      const img = document.createElement('img')
      img.src = team.iconUrl
      img.alt = team.name
      icon.appendChild(img)
    } else {
      icon.textContent = initialsFor(team.name)
    }
    node.appendChild(icon)

    const body = document.createElement('div')
    body.className = 'team-body'
    const name = document.createElement('div')
    name.className = 'team-name'
    name.textContent = team.name
    body.appendChild(name)

    const meta = document.createElement('div')
    meta.className = 'team-meta'
    const modeBadge = document.createElement('span')
    if (team.encryptionMode === 'private') {
      modeBadge.className = 'badge private'
      modeBadge.textContent = 'Mode Privé'
    } else {
      modeBadge.className = 'badge standard'
      modeBadge.textContent = 'Mode Standard'
    }
    meta.appendChild(modeBadge)
    if (team.locked) {
      const lockBadge = document.createElement('span')
      lockBadge.className = 'badge locked'
      lockBadge.appendChild(lockIcon())
      const lockText = document.createElement('span')
      lockText.textContent = ' Verrouillé'
      lockBadge.appendChild(lockText)
      meta.appendChild(lockBadge)
    }
    body.appendChild(meta)
    node.appendChild(body)

    const arrow = document.createElement('span')
    arrow.className = 'team-arrow'
    arrow.appendChild(team.locked ? lockIcon() : arrowIcon())
    node.appendChild(arrow)

    node.addEventListener('click', () => onTeamClick(team, node))
    elTeams.appendChild(node)
  }
  elTeams.hidden = false
}

async function onTeamClick(team, node) {
  clearError()
  if (team.locked) {
    const ok = window.confirm(
      `L'équipe « ${team.name} » utilise le Mode Privé (E2E) et son coffre-fort est verrouillé.\n\n` +
      'Pour la déverrouiller, ouvrez Faktur dans le navigateur, déverrouillez votre coffre, puis revenez ici.'
    )
    if (ok) await f.requestVaultUnlock({ teamId: team.id })
    return
  }
  for (const el of document.querySelectorAll('.team')) el.style.pointerEvents = 'none'
  node.style.opacity = '0.6'
  try {
    const res = await f.selectTeam({
      teamId: team.id,
      persistAsDefault: true,
      alwaysShowTeamSelect: !!elAlwaysShow.checked,
    })
    if (!res?.ok) {
      showError(res?.error || 'Impossible de sélectionner cette équipe.')
      for (const el of document.querySelectorAll('.team')) el.style.pointerEvents = ''
      node.style.opacity = ''
    }
  } catch (err) {
    showError(err?.message || 'Erreur inattendue')
    for (const el of document.querySelectorAll('.team')) el.style.pointerEvents = ''
    node.style.opacity = ''
  }
}

async function init() {
  try {
    const [bridge, prefs] = await Promise.all([f.getBridge(), f.getPrefs()])
    elLoading.hidden = true
    if (!bridge) {
      showError('Session non disponible. Reconnectez-vous.')
      return
    }
    renderUser(bridge.user)
    if (prefs && typeof prefs.alwaysShowTeamSelect === 'boolean') {
      elAlwaysShow.checked = prefs.alwaysShowTeamSelect
    }
    elAlwaysShow.addEventListener('change', () => {
      f.setPrefs({ alwaysShowTeamSelect: !!elAlwaysShow.checked }).catch(() => {})
    })
    const teams = Array.isArray(bridge.teams) ? bridge.teams : []
    if (teams.length === 0) {
      elEmpty.hidden = false
      return
    }
    renderTeams(teams)
  } catch (err) {
    elLoading.hidden = true
    showError(err?.message || 'Erreur inattendue')
  }
}

elLogout?.addEventListener('click', async () => {
  try { await f.logout() } catch {}
})

init()

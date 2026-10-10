// The Global panel's server list, Kirka-style (2026-10-10, Gaymi: "do the
// same like Kirka, make Global have servers too"): chat on the left, the
// servers on the right with Main / Parkour / Custom tabs (Parkour and
// Custom are Coming Soon - those modes don't exist yet), a search box, a
// Create Server button and one row per server with its player count and
// Join. Joining or creating one starts Map 1 with the other players
// (PlayNet.js); the rules live in api/_lib/servers.js.
//
// Same module shape as ChatUI.js / CloudSaveUI.js: plain functions taking
// `game`, all state on the game (game._serverList, game._serverTab...).
import { t } from './i18n.js'
import { _escapeHtml } from './Game.js'
import { DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'

// How often the open list refreshes itself.
const LIST_REFRESH_MS = 5000

// The calls to /api/servers/*. Tests swap in their own with
// game.__serversBackendForTests (same five functions).
export function serverApi(game) {
  if (game?.__serversBackendForTests) return game.__serversBackendForTests
  const call = async (name, body) => {
    const res = await fetch(`/api/servers/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      keepalive: name === 'leave',
    })
    let data = null
    try { data = await res.json() } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error(data?.error || `http-${res.status}`)
      err.code = data?.error || `http-${res.status}`
      throw err
    }
    return data
  }
  return {
    list: () => call('list'),
    create: (body) => call('create', body),
    join: (body) => call('join', body),
    leave: (body) => call('leave', body),
    sync: (body) => call('sync', body),
  }
}

function myDetails(game) {
  const s = game.settings || {}
  const skin = typeof s.customSkinDataUrl === 'string' && s.customSkinDataUrl.length < 50000 ? s.customSkinDataUrl : DEFAULT_SKIN_DATA_URL
  return { nickname: (s.nickname || '').trim() || 'Survivor', skin }
}

export function bindServerBrowser(game) {
  const root = document.getElementById('server-browser')
  if (!root || root._bound) return
  root._bound = true
  game._serverTab = 'main'
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-server-tab]')
    if (tab) {
      game._serverTab = tab.dataset.serverTab
      renderServerList(game)
      return
    }
    const join = e.target.closest('[data-server-join]')
    if (join && !join.disabled) {
      joinServer(game, join.dataset.serverJoin)
      return
    }
    if (e.target.closest('#server-create-btn')) createServer(game)
    else if (e.target.closest('#server-refresh-btn')) refreshServerList(game)
  })
  document.getElementById('server-search')?.addEventListener('input', () => renderServerList(game))
  document.getElementById('server-create-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createServer(game)
  })
}

export function openServerBrowser(game) {
  bindServerBrowser(game)
  const name = document.getElementById('server-create-name')
  if (name) name.placeholder = t('serverNamePlaceholder')
  const search = document.getElementById('server-search')
  if (search) search.placeholder = t('serverSearchPlaceholder')
  refreshServerList(game)
  clearInterval(game._serverListTimer)
  game._serverListTimer = setInterval(() => refreshServerList(game), LIST_REFRESH_MS)
}

export function closeServerBrowser(game) {
  clearInterval(game._serverListTimer)
  game._serverListTimer = null
}

export async function refreshServerList(game) {
  try {
    game._serverList = await serverApi(game).list()
    game._serverListError = false
  } catch {
    game._serverListError = true
  }
  renderServerList(game)
}

export function renderServerList(game) {
  const root = document.getElementById('server-browser')
  if (!root) return
  const tab = game._serverTab || 'main'
  for (const b of root.querySelectorAll('[data-server-tab]')) b.classList.toggle('active', b.dataset.serverTab === tab)
  const list = document.getElementById('server-list')
  const line = document.getElementById('server-count-line')
  const tools = document.getElementById('server-tools')
  if (!list) return
  const soon = tab !== 'main'
  if (tools) tools.style.display = soon ? 'none' : ''
  if (soon) {
    if (line) line.textContent = ''
    list.innerHTML = `<p class="server-empty">${_escapeHtml(t(tab === 'parkour' ? 'serverParkourSoon' : 'serverCustomSoon'))}</p>`
    return
  }
  const q = (document.getElementById('server-search')?.value || '').trim().toLowerCase()
  const all = (game._serverList || []).filter((s) => s.mode === 'main')
  const shown = all.filter((s) => !q || String(s.name).toLowerCase().includes(q) || String(s.id).toLowerCase().includes(q))
  if (line) line.textContent = game._serverListError ? '' : t('serverCountLine', { n: all.length })
  if (game._serverListError) {
    list.innerHTML = `<p class="server-empty">${_escapeHtml(t('serverListError'))}</p>`
    return
  }
  if (!shown.length) {
    list.innerHTML = `<p class="server-empty">${_escapeHtml(t(all.length ? 'serverNoMatch' : 'serverNoneYet'))}</p>`
    return
  }
  list.innerHTML = shown.map((s, i) => {
    const full = s.players >= s.max
    return `<div class="server-row${full ? ' full' : ''}">
      <span class="server-num">${i + 1}.</span>
      <span class="server-name">${_escapeHtml(s.name)}</span>
      <span class="server-id">${_escapeHtml(s.id)}</span>
      ${s.wave ? `<span class="server-wave">${_escapeHtml(t('buildPlayWave', { n: Number(s.wave) || 0 }))}</span>` : ''}
      <span class="server-players">${Number(s.players) || 0} / ${Number(s.max) || 0}</span>
      <button type="button" class="mini-action-btn server-join-btn" data-server-join="${_escapeHtml(s.id)}"${full ? ' disabled' : ''}>${_escapeHtml(t(full ? 'serverFull' : 'serverJoin'))}</button>
    </div>`
  }).join('')
}

function setBusy(game, busy) {
  game._serverBusy = busy
  for (const b of document.querySelectorAll('#server-browser button')) {
    if (b.dataset.serverTab) continue
    if (busy) b.dataset.wasDisabled = b.disabled ? '1' : ''
    b.disabled = busy || b.dataset.wasDisabled === '1'
  }
}

async function createServer(game) {
  if (game._serverBusy) return
  const name = (document.getElementById('server-create-name')?.value || '').trim()
  setBusy(game, true)
  try {
    const info = await serverApi(game).create({ ...myDetails(game), name, mode: 'main' })
    enterServer(game, { ...info, name: name || info.name })
  } catch {
    game._showHomepageToast(t('serverCreateFailed'))
  } finally {
    setBusy(game, false)
  }
}

async function joinServer(game, serverId) {
  if (game._serverBusy) return
  setBusy(game, true)
  try {
    const info = await serverApi(game).join({ ...myDetails(game), serverId })
    enterServer(game, info)
  } catch (err) {
    game._showHomepageToast(t(err?.code === 'full' ? 'serverFullToast' : err?.code === 'gone' ? 'serverGoneToast' : 'serverJoinFailed'))
    refreshServerList(game)
  } finally {
    setBusy(game, false)
  }
}

// Into Map 1 with the others (Game._enterBuildMode starts the run).
function enterServer(game, info) {
  closeServerBrowser(game)
  game._enterBuildMode({ map: 'map3', play: true, server: info })
}

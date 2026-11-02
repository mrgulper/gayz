// The Global panel's server list, Kirka-style (2026-10-10, Gaymi: "do the
// same like Kirka, make Global have servers too"): chat on the left, the
// servers on the right with Zombie Survival / Deathmatch / Parkour /
// Custom tabs (all but Zombie Survival are Coming Soon - those modes don't
// exist yet; the first tab's internal id is still 'main'), a search box, a
// Create Server button and one row per server with its player count and
// Join. Joining or creating one starts Map 1 with the other players
// (PlayNet.js); the rules live in api/_lib/servers.js.
//
// Same module shape as ChatUI.js / CloudSaveUI.js: plain functions taking
// `game`, all state on the game (game._serverList, game._serverTab...).
import { t } from './i18n.js'
import { PARTY_SERVER_MODES } from './PartyModes.js'
import { _escapeHtml } from './Game.js'
import { DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { PlayNet } from './PlayNet.js'
import { isEarthWorld, worldSeed } from './OpenWorld.js'

// How often the open list refreshes itself.
const LIST_REFRESH_MS = 5000

// The calls to /api/servers/*. Tests swap in their own with
// game.__serversBackendForTests (same five functions) - or, to be in place
// before the game exists (an invite link joins as soon as it's loaded),
// window.__serversBackendForTests.
export function serverApi(game) {
  if (game?.__serversBackendForTests) return game.__serversBackendForTests
  if (typeof window !== 'undefined' && window.__serversBackendForTests) return window.__serversBackendForTests
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

const SERVER_SKIN_MAX = 50000

// An HD skin (8x/16x from Design a Skin) is too big to send to a server, so
// the others get a copy with fewer pixels - the biggest of 4x/2x/1x that
// fits - instead of the default skin.
async function serverSkin(url) {
  if (typeof url !== 'string') return DEFAULT_SKIN_DATA_URL
  if (url.length < SERVER_SKIN_MAX) return url
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    for (const k of [4, 2, 1]) {
      if (img.naturalWidth <= 64 * k) continue
      const c = document.createElement('canvas')
      c.width = 64 * k
      c.height = Math.round(img.naturalHeight * (64 * k) / img.naturalWidth)
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const small = c.toDataURL('image/png')
      if (small.length < SERVER_SKIN_MAX) return small
    }
  } catch { /* falls back to the default skin */ }
  return DEFAULT_SKIN_DATA_URL
}

export async function myDetails(game) {
  const s = game.settings || {}
  return { nickname: (s.nickname || '').trim() || 'Survivor', skin: await serverSkin(s.customSkinDataUrl) }
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
    const soonKey = { deathmatch: 'serverDeathmatchSoon', parkour: 'serverParkourSoon' }[tab] || 'serverCustomSoon'
    list.innerHTML = `<p class="server-empty">${_escapeHtml(t(soonKey))}</p>`
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
    const info = await serverApi(game).create({ ...(await myDetails(game)), name, mode: 'main' })
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
    const info = await serverApi(game).join({ ...(await myDetails(game)), serverId })
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

// --- Invite Friends (2026-10-18, Gaymi: "when clicking escape in gameplay
// add a invite friends where a link will pop up for you to invite your
// friends to join you") ---

// The link that joins a server.
export function inviteLink(serverId) {
  return `${location.origin}/?join=${encodeURIComponent(serverId)}`
}

// A solo game becomes a server, right where it is: the run keeps going,
// now synced (PlayNet), and the server remembers this world (land seed,
// Earth or not, the spawn-map place) so friends joining get the same land
// and start where you did. Resolves the PlayNet, or throws.
// A server id made here (same letters as api/_lib/servers.js), so the
// invite link can show before the server exists.
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function newServerId() {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((n) => ID_CHARS[n % ID_CHARS.length]).join('')
}

// Infection games make Infection servers (Infection.js), Shrinking Zone
// games Zone servers (ShrinkZone.js), party games their own (PartyModes.js).
const serverMode = (survival) => (survival?.cfg?.mode === 'infection' ? 'infection' : survival?.cfg?.mode === 'shrinkingZone' ? 'zone' : PARTY_SERVER_MODES[survival?.cfg?.mode] || 'main')

export async function makeGameJoinable(game, survival, id = newServerId()) {
  if (survival.net && !survival.net.closed) return survival.net
  // Already ready for friends (a lobby): it just becomes a server game now.
  if (survival.lobby && !survival.lobby.closed) {
    const lobby = survival.lobby
    lobby._promote()
    return lobby
  }
  const world = game.buildMode?.world?.active ? { seed: worldSeed(), earth: isEarthWorld(), pick: survival._spawnPick || null } : null
  const info = await serverApi(game).create({ ...(await myDetails(game)), name: '', mode: serverMode(survival), world, id })
  const net = new PlayNet(game, { ...info, world })
  survival.net = net
  net.attach(survival)
  return net
}

// A solo game from the homepage is a hidden server from the start, so the
// address bar is its invite link right away (2026-10-26, Gaymi: "it still
// says gayz.vercel.app (map editor) until I click the invite link") - see
// PlayNet's header. Offline, or if it can't be made, the game stays solo.
export async function openLobby(game, survival) {
  if (survival.net || survival.lobby || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null
  const world = game.buildMode?.world?.active ? { seed: worldSeed(), earth: isEarthWorld(), pick: survival._spawnPick || null } : null
  const api = serverApi(game)
  const info = await api.create({ ...(await myDetails(game)), name: '', mode: serverMode(survival), world, id: newServerId(), hidden: true })
  if (!info?.serverId || !info.token) return null
  // The game ended (or got a server another way) while this was made.
  if (!survival.active || survival.net || survival.lobby) {
    api.leave({ serverId: info.serverId, playerId: info.playerId, token: info.token }).catch(() => { /* times out */ })
    return null
  }
  const net = new PlayNet(game, { ...info, world }, { lobby: true })
  survival.lobby = net
  net.attach(survival)
  return net
}

// Opened with ?join=CODE (an invite link): join that server once the game
// has loaded, and take the code out of the address bar.
export function joinFromLink(game) {
  let code = null
  try { code = new URLSearchParams(location.search).get('join') } catch { /* no URL */ }
  if (!code || !/^[A-Za-z0-9]{4,40}$/.test(code)) return
  try {
    const url = new URL(location.href)
    url.searchParams.delete('join')
    history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  } catch { /* leave the address alone */ }
  joinServer(game, code)
}

// Settings > Controls > HUD (ideas 25-38 of the 2026-11-11 settings list,
// docs/notes/ui-and-menu.md > "Settings ideas (to do)"). The rows come from
// MoreSettingsList.js; this file is what they do in a game:
//   - looks that are pure CSS (HUD size, health display, chat opacity, hit
//     marker, small minimap) are classes/variables on <html>/<body>
//     (applyHudLook, called by MoreSettings when one changes);
//   - everything that follows the game (hide HUD, low ammo, the info box
//     with clock/coordinates/ping, compass, kill feed, turning minimap,
//     chat fading) runs from hudTick, called every frame by
//     BuildSurvival.update - so it's only ever on while a game runs
//     (spectating too), and goes away when it stops.
import { t } from './i18n.js'
import { saveSettings } from './Game.js'
import { sessionText } from './Wellbeing.js'

// Kill feed: lines shown at once, and how long each stays.
const FEED_MAX = 5
const FEED_S = 5
// Low ammo: this share of a magazine or less.
const LOW_AMMO = 0.25
// Compass: pixels per degree (the bar shows about 150 degrees).
const COMPASS_PX = 2
// The info box / kill feed / compass places are rechecked this often.
const PLACE_EVERY = 0.25

const root = () => document.documentElement

// The CSS-only ones (also when no game runs, so Settings shows them right).
export function applyHudLook(set) {
  if (!set) return
  const html = root()
  html.style.setProperty('--hud-scale', String((Number(set.hudScale) || 100) / 100))
  html.style.setProperty('--chat-opacity', String((Number(set.chatOpacity) || 100) / 100))
  html.dataset.healthDisplay = set.healthDisplay || 'both'
  html.classList.toggle('minimap-small', set.minimapSize === 'small')
  html.classList.toggle('no-hitmarker', set.hitMarker === false)
  if (set.killFeed === false) clearFeed()
  // A different small-map size: the map redraws at its new size.
  lastGame?.bm?.tryMode?._applyMapMode?.()
}

// F1 (Key Bindings > Hide HUD) in a game: HUD off/on, saved like the setting.
export function toggleHideHud(game) {
  if (!game?.settings) return
  game.settings.hideHud = !game.settings.hideHud
  const box = document.getElementById('ms-hide-hud')
  if (box) box.checked = game.settings.hideHud
  saveSettings(game.settings)
}

// ---------- each frame of a game ----------

let lastGame = null
let lastStart = null
let lastTick = 0
let placeIn = 0
let lastKills = 0
let info = null
let feed = null
let compass = null
let north = null

export function hudTick(s, dt) {
  const set = s.bm?.game?.settings
  if (!set) return
  lastTick = performance.now()
  // A new game: start counting kills from here and pick the map size.
  if (s !== lastGame || s._startedAt !== lastStart) {
    lastGame = s
    lastStart = s._startedAt
    lastKills = s.kills || 0
    clearFeed()
    startMapSize(s, set)
    placeIn = 0
    chatSeenAt = performance.now()
  }
  document.body.classList.toggle('hud-hidden', !!set.hideHud)
  lowAmmo(s, set)
  kills(s, set)
  turnMap(s, set)
  compassTick(s, set)
  chatFade(s.bm.game, set)
  placeIn -= dt
  if (placeIn <= 0) {
    placeIn = PLACE_EVERY
    infoTick(s, set)
    place()
  }
  feedTick()
}

// The game stopped (no tick for a moment): everything of ours goes away.
setInterval(() => {
  if (!lastGame || performance.now() - lastTick < 400) return
  document.body.classList.remove('hud-hidden')
  if (info) info.style.display = 'none'
  if (compass) compass.style.display = 'none'
  if (north) north.style.display = 'none'
  clearFeed()
  const map = lastGame.bm?.tryMode?._mapEl
  if (map) {
    map.classList.remove('map-turning')
    const c = map.querySelector('canvas')
    if (c) c.style.transform = ''
  }
  const ammo = document.getElementById('build-play-ammo')
  ammo?.classList.remove('low-ammo')
  ammo?.removeAttribute('data-low')
  document.getElementById('chat-panel')?.classList.remove('chat-faded')
  lastGame = null
}, 500)

// Minimap Size: the size a game starts with (M still changes it).
function startMapSize(s, set) {
  const tm = s.bm?.tryMode
  if (!tm || tm._mapMode == null) return
  const want = set.minimapSize === 'big' ? 1 : 0
  if (tm._mapMode !== want) {
    tm._mapMode = want
    tm._applyMapMode?.()
  }
}

// Low-Ammo Warning: the ammo count turns red and says so.
function lowAmmo(s, set) {
  const el = document.getElementById('build-play-ammo')
  if (!el) return
  const size = s.magSize?.() || 0
  let say = ''
  if (set.lowAmmoWarning && !s.weapon?.fuel && !s.weapon?.melee && Number.isFinite(s.mag) && size > 0 && !(s._reloadLeft > 0)) {
    if (s.mag <= 0 && !(s.reserve > 0)) say = t('hudNoAmmo')
    else if (s.mag <= Math.ceil(size * LOW_AMMO)) say = t('hudLowAmmo')
  }
  if ((el.dataset.low || '') === say) return
  el.classList.toggle('low-ammo', !!say)
  if (say) el.dataset.low = say
  else el.removeAttribute('data-low')
}

// ---------- the info box: clock, coordinates, ping ----------

function ensureRight() {
  if (info) return
  info = document.createElement('div')
  info.id = 'play-hud-info'
  info.setAttribute('aria-hidden', 'true')
  document.body.appendChild(info)
  feed = document.createElement('div')
  feed.id = 'play-kill-feed'
  feed.setAttribute('aria-live', 'polite')
  document.body.appendChild(feed)
}

function timeText(date, set) {
  try {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: set.timeFormat === '12h' })
  } catch {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  }
}

function infoTick(s, set) {
  ensureRight()
  const lines = []
  if (set.hudClock === 'real') lines.push(t('hudClockReal', { t: timeText(new Date(), set) }))
  else if (set.hudClock === 'game') {
    const h = s.bm?.sky?.topBarLook?.().hours
    if (Number.isFinite(h)) {
      const d = new Date(2000, 0, 1, Math.floor(h), Math.floor((h % 1) * 60))
      lines.push(t('hudClockGame', { t: timeText(d, set) }))
    }
  }
  if (set.sessionTimer) lines.push(t('hudSessionTimer', { t: sessionText() }))
  if (set.showCoords) {
    const p = s.bm?.tryMode?.pos
    if (p) lines.push(t('hudCoords', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }))
  }
  const net = s.net
  if (set.showPing && net && !net.closed && !net.lobby && Number.isFinite(net.ping)) lines.push(t('hudPing', { n: Math.round(net.ping) }))
  const text = lines.join('\n')
  if (info.textContent !== text) info.textContent = text
  info.style.display = text ? '' : 'none'
}

// ---------- kill feed ----------

function feedLine(text, mine) {
  ensureRight()
  const el = document.createElement('div')
  el.className = `kill-feed-line${mine ? ' mine' : ''}`
  el.textContent = text
  feed.prepend(el)
  el._until = performance.now() + FEED_S * 1000
  while (feed.children.length > FEED_MAX) feed.lastChild.remove()
}

function clearFeed() {
  if (feed) feed.textContent = ''
}

function feedTick() {
  if (!feed) return
  const now = performance.now()
  for (const el of [...feed.children]) {
    if (now > el._until) el.remove()
    else if (now > el._until - 600) el.classList.add('fading')
  }
}

// Mine: the game's kill count going up (kills a server sends back to me
// count there too). Other players': their own count, sent with where they
// are (PlayNet: state.kills).
function kills(s, set) {
  const k = s.kills || 0
  const mine = Math.max(0, Math.min(3, k - lastKills))
  lastKills = k
  const net = s.net
  if (!set.killFeed) {
    for (const p of net?.players?.values() || []) p.kfSeen = p.kills
    return
  }
  for (let i = 0; i < mine; i++) feedLine(t('killFeedYou'), true)
  for (const p of net?.players?.values() || []) {
    if (!Number.isFinite(p.kills)) continue
    if (!Number.isFinite(p.kfSeen) || p.kills < p.kfSeen) {
      p.kfSeen = p.kills
      continue
    }
    const n = Math.min(3, p.kills - p.kfSeen)
    p.kfSeen = p.kills
    for (let i = 0; i < n; i++) feedLine(t('killFeedOther', { name: p.nick || 'Survivor' }), false)
  }
}

// ---------- minimap that turns with you ----------

function turnMap(s, set) {
  const tm = s.bm?.tryMode
  const map = tm?._mapEl
  if (!map) return
  const canvas = tm._mapCanvas
  const on = set.minimapRotate === 'turn' && !!s.bm.world?.active && map.dataset.size !== 'center' && !map.classList.contains('interactive') && map.style.display !== 'none'
  if (map.classList.contains('map-turning') !== on) {
    map.classList.toggle('map-turning', on)
    if (!on && canvas) canvas.style.transform = ''
  }
  if (!north) {
    north = document.createElement('div')
    north.id = 'map-north'
    north.setAttribute('aria-hidden', 'true')
  }
  if (north.parentNode !== map) map.appendChild(north)
  north.style.display = on ? '' : 'none'
  if (!on || !canvas) return
  // The map's arrow points at `ang` (MiniMap: 0 = east, clockwise);
  // turn the picture so it points straight up.
  const yaw = s.bm._yaw
  const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
  const turn = -Math.PI / 2 - ang
  canvas.style.transform = `rotate(${turn.toFixed(4)}rad)`
  north.textContent = t('compassDirs').split(',')[0] || 'N'
  // North sits on the map's edge, wherever the turned picture puts it.
  const a = -Math.PI / 2 + turn
  const r = 0.43
  north.style.left = `${(50 + Math.cos(a) * r * 100).toFixed(2)}%`
  north.style.top = `${(50 + Math.sin(a) * r * 100).toFixed(2)}%`
}

// ---------- compass bar ----------

function ensureCompass() {
  if (compass) return
  compass = document.createElement('div')
  compass.id = 'play-compass'
  compass.setAttribute('aria-hidden', 'true')
  compass.innerHTML = '<div class="compass-strip"></div><div class="compass-mark"></div>'
  document.body.appendChild(compass)
  compass._lang = ''
}

function fillCompass() {
  const strip = compass.querySelector('.compass-strip')
  const names = t('compassDirs').split(',')
  let html = ''
  // Three turns' worth, so it never runs out at either end.
  for (let d = -360; d < 720; d += 15) {
    const deg = ((d % 360) + 360) % 360
    const name = deg % 45 === 0 ? names[deg / 45] || '' : ''
    const left = (d + 360) * COMPASS_PX
    html += name
      ? `<span class="compass-dir${deg % 90 === 0 ? ' main' : ''}" style="left:${left}px">${name}</span>`
      : `<span class="compass-tick" style="left:${left}px"></span>`
  }
  strip.innerHTML = html
}

function compassTick(s, set) {
  if (!set.compassBar) {
    if (compass) compass.style.display = 'none'
    return
  }
  ensureCompass()
  compass.style.display = ''
  const lang = t('compassDirs')
  if (compass._lang !== lang) {
    compass._lang = lang
    fillCompass()
  }
  // Heading: 0 north, 90 east (the same angle the minimap's arrow uses).
  const yaw = s.bm._yaw
  const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw))
  const heading = (((ang * 180) / Math.PI + 90) % 360 + 360) % 360
  const w = compass.clientWidth || 300
  compass.firstChild.style.transform = `translateX(${(w / 2 - (heading + 360) * COMPASS_PX).toFixed(1)}px)`
}

// ---------- places ----------

// Info box (right, under the corner map), compass (top middle) and kill
// feed (right, under both): each goes into the first free gap from the
// top, below anything already up there - the top bar, wave line, corner
// map, ammo count and, on phones, the row of buttons (measured: at
// 375x812 those fill the top 200px).
const GAP = 6
// Room kept for the kill feed's lines when placing the compass.
const FEED_ROOM = 80
function obstacles() {
  const out = []
  const els = [...['top-bar', 'build-play-wave', 'build-play-ammo'].map((id) => document.getElementById(id)), ...document.querySelectorAll('#touch-play .tp-btn')]
  const map = document.getElementById('build-try-map')
  if (map && map.dataset.size !== 'center') els.push(map)
  for (const el of els) {
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push(r)
  }
  return out
}

// The first top (from 8px down) where a box x0..x1, h tall touches none.
function freeTop(x0, x1, h, rects) {
  let top = 8
  for (let i = 0; i < 20; i++) {
    const hit = rects.find((r) => r.left < x1 && r.right > x0 && r.top < top + h && r.bottom > top)
    if (!hit) break
    top = hit.bottom + GAP
  }
  return top
}

// A box w x h on the right: down the right edge if there's room in the
// top half, else just left of the corner map (a sideways phone, where
// the ammo count and Reload button fill the right edge).
function placeRight(el, w, h, rects) {
  const W = window.innerWidth
  const H = window.innerHeight
  const map = document.getElementById('build-try-map')?.getBoundingClientRect()
  const rights = [16]
  if (map && map.width) rights.push(W - map.left + 8)
  let best = null
  for (const right of rights) {
    const top = freeTop(W - right - w, W - right, h, rects)
    if (!best || top < best.top) best = { right, top }
    if (top + h <= H * 0.55) {
      best = { right, top }
      break
    }
  }
  el.style.right = `${Math.round(best.right)}px`
  el.style.top = `${Math.round(best.top)}px`
  const box = { left: W - best.right - w, right: W - best.right, top: best.top, bottom: best.top + h }
  rects.push(box)
  return box
}

function place() {
  const W = window.innerWidth
  const rects = obstacles()
  if (info && info.style.display !== 'none') {
    const r = info.getBoundingClientRect()
    placeRight(info, r.width, r.height, rects)
  }
  if (compass && compass.style.display !== 'none') {
    const r = compass.getBoundingClientRect()
    const w = r.width || 300
    const h = r.height || 26
    const top = freeTop(W / 2 - w / 2, W / 2 + w / 2, h, rects)
    compass.style.top = `${Math.round(top)}px`
    rects.push({ left: W / 2 - w / 2, right: W / 2 + w / 2, top, bottom: top + h })
  }
  // The feed grows downward: room for its widest line and a few lines.
  if (feed) placeRight(feed, 220, FEED_ROOM, rects)
}

// ---------- chat fades ----------

// Chat Fade: the messages fade out X seconds after the newest one came in,
// and come back with a new message or while typing.
let chatNewest = 0
let chatSeenAt = 0
function chatFade(game, set) {
  const panel = document.getElementById('chat-panel')
  if (!panel) return
  const secs = Number(set.chatFade)
  const now = performance.now()
  let newest = 0
  for (const m of game?._lastChatMsgs || []) newest = Math.max(newest, Number(m.createdAt) || 0)
  for (const l of game?._chatSystemLines || []) newest = Math.max(newest, l.at || 0)
  if (newest !== chatNewest) {
    chatNewest = newest
    chatSeenAt = now
  }
  const typing = document.activeElement?.id === 'chat-input'
  if (typing) chatSeenAt = now
  const faded = Number.isFinite(secs) && secs > 0 && now - chatSeenAt > secs * 1000
  if (panel.classList.contains('chat-faded') !== faded) panel.classList.toggle('chat-faded', faded)
}

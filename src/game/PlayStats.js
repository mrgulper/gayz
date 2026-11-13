// Anonymous play counts (2026-11-13) - api/_lib/playStats.js keeps only
// totals per day: players and visits, the hour (UTC), phone/tablet/computer,
// language, the mode/map/skin/weapon of each game, and where the game was
// closed. Nothing that names the player (no Player ID, nickname or
// account) is sent. Off when Settings' "Share Anonymous Usage Stats" is
// off, inside another site's frame, and in automated browsers (tests).
//
// Counts wait in a small queue and go out together: once a minute while
// there are any, and when the page closes (sendBeacon).
import { isTouchDevice } from './BuildTouch.js'
import { INVENTORY_SKINS } from './InventorySkins.js'
import { NO_ZOMBIE_MODES } from './PlayRules.js'

const FIRST_HELLO_MS = 10 * 1000
const FLUSH_EVERY_MS = 60 * 1000
const SEND_MAX = 40
// This device's last counted day (device-only: never synced by Cloud Save).
export const STATS_DAY_KEY = 'gayz-stats-day'

let game = null
let queue = []

const utcDay = () => new Date().toISOString().slice(0, 10)

function embedded() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function enabled() {
  if (!game || game.settings?.shareTelemetry === false) return false
  if (window.__playStatsForTests) return true
  return !navigator.webdriver && !embedded()
}

function who() {
  return game?._cloudProfile ? 's' : 'g'
}

function body(hits) {
  return { action: 'stats', who: who(), hits }
}

function send(hits, closing) {
  if (!hits.length) return
  const data = body(hits)
  if (window.__playStatsForTests) return window.__playStatsForTests(data)
  try {
    if (closing && navigator.sendBeacon) {
      navigator.sendBeacon('/api/live', new Blob([JSON.stringify(data)], { type: 'application/json' }))
      return
    }
    fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive: !!closing }).catch(() => {})
  } catch { /* offline or blocked - counts are only nice to have */ }
}

export function flushStats(closing = false) {
  while (queue.length) send(queue.splice(0, SEND_MAX), closing)
}

function count(cat, key) {
  if (!enabled() || key == null) return
  queue.push([cat, String(key)])
}

export function deviceKind() {
  if (!isTouchDevice()) return 'computer'
  return Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'phone'
}

export function skinKind(settings) {
  const url = settings?.customSkinDataUrl
  if (!url) return 'default'
  return INVENTORY_SKINS.find((s) => s.dataUrl === url)?.id || 'custom'
}

// Called by BuildSurvival.start for every game started from the homepage.
export function countRun(survival) {
  const cfg = survival.cfg || {}
  const slot = survival.bm?.activeSlot
  const map = survival.net ? 'server' : slot === 'map3' ? 'city' : slot === 'shared' ? 'shared' : 'own'
  count('sum', 'runs')
  count('mode', cfg.mode || 'classic')
  count('map', map)
  count('skin', skinKind(game?.settings))
}

// Each gun picked in a game (the first pick and any switch).
export function countWeapon(id) {
  count('weapon', id)
}

// Where the player was when the page closed.
export function quitPlace() {
  const s = game?.buildMode?.survival
  if (s?.active) {
    if (NO_ZOMBIE_MODES.includes(s.cfg?.mode)) return 'nozombie'
    const w = Math.max(1, Math.floor(Number(s.wave) || 1))
    return w <= 5 ? `w${w}` : w <= 10 ? 'w6-10' : w <= 20 ? 'w11-20' : 'w21up'
  }
  if (document.body.classList.contains('build-mode-on')) return 'editor'
  return location.pathname === '/' ? 'home' : 'panel'
}

// Once per page: a visit and its hour; once per device per day (UTC): a
// player, with their device and language.
export function hello() {
  if (!enabled()) return
  count('sum', 'visits')
  count('hour', new Date().getUTCHours())
  let last = null
  try { last = localStorage.getItem(STATS_DAY_KEY) } catch { /* no storage */ }
  const today = utcDay()
  if (last !== today) {
    try { localStorage.setItem(STATS_DAY_KEY, today) } catch { /* no storage */ }
    count('sum', 'players')
    count('device', deviceKind())
    count('lang', game?.settings?.language || 'en')
  }
  flushStats()
}

export function startPlayStats(g) {
  game = g
  game._playStats = { countRun, countWeapon }
  // Tests: set window.__playStatsForTests (gets each message), then call these.
  game.__statsHello = hello
  game.__statsFlush = flushStats
  game.__statsQuitPlace = quitPlace
  // Late enough that a signed-in player's account has loaded (s vs g).
  setTimeout(hello, FIRST_HELLO_MS)
  setInterval(() => flushStats(), FLUSH_EVERY_MS)
  window.addEventListener('pagehide', () => {
    count('quit', quitPlace())
    flushStats(true)
  })
}

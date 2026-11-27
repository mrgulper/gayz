// Anonymous play counts (2026-11-13) - api/_lib/playStats.js keeps only
// totals per day: players and visits, the hour (UTC), phone/tablet/computer,
// language, new vs coming back (days away, days played in all, days since
// the first day, and phone or computer), the mode/map/skin/weapon of
// each game, where the game was closed, and how fast the game loads and
// runs (seconds to load, frames per second in a game - 2026-11-26), and
// which 8-block square of the city map a death happened in, and which first
// steps a new player reached (2026-11-27). Nothing that names the player (no Player ID, nickname or
// account) is sent. Off when Settings' "Share Anonymous Usage Stats" is
// off, inside another site's frame, and in automated browsers (tests).
//
// Counts wait in a small queue and go out together: once a minute while
// there are any, and when the page closes (sendBeacon).
import { isTouchDevice } from './BuildTouch.js'
import { INVENTORY_SKINS } from './InventorySkins.js'
import { NO_ZOMBIE_MODES } from './PlayRules.js'
import { GRAPHICS_LEVELS } from './GraphicsLevels.js'
import { deathCell } from './DeathCells.js'

const FIRST_HELLO_MS = 10 * 1000
const FLUSH_EVERY_MS = 60 * 1000
const SEND_MAX = 40
// This device's last counted day (device-only: never synced by Cloud Save).
export const STATS_DAY_KEY = 'gayz-stats-day'
// How many different days this device has played, and its first day
// (2026-11-26, device-only like the one above).
export const STATS_DAYS_KEY = 'gayz-stats-days'
export const STATS_FIRST_KEY = 'gayz-stats-first'
// Quit Funnel (2026-11-27): the first steps a brand-new device reached, so
// the Console can show where new players stop. Only devices new since this
// shipped have this (device-only), so old players never count.
export const FUNNEL_KEY = 'gayz-funnel'
export const FUNNEL_STEPS = ['home', 'run', 'kill', 'death', 'wave3', 'run2', 'day2']

let game = null
let queue = []
// Game speed (2026-11-26): seconds from opening the page until the homepage
// works, sent once per page; and each game's usual frame rate.
let loadMs = null
let loadSent = false
let fpsRun = null
// This device's funnel ({ start: day, done: [steps] }), read once; null =
// not a new device (no funnel). Steps before the first hello wait here.
let funnel
let funnelWaiting = []
// A game's frame rate: skip the first seconds (the world loads in), then
// take the middle value of this many half-second readings (~30 seconds).
const FPS_WARMUP_MS = 15 * 1000
export const FPS_SAMPLES = 60

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

function readFunnel() {
  if (funnel !== undefined) return funnel
  try {
    const f = JSON.parse(localStorage.getItem(FUNNEL_KEY) || 'null')
    funnel = f && Array.isArray(f.done) ? f : null
  } catch { funnel = null }
  return funnel
}

// Counts a funnel step once per device. Before the first hello decides
// whether this is a new device, the step waits.
export function funnelStep(step) {
  if (!enabled() || !FUNNEL_STEPS.includes(step)) return
  if (funnelWaiting && !readFunnel()) {
    if (!funnelWaiting.includes(step)) funnelWaiting.push(step)
    return
  }
  const f = readFunnel()
  if (!f || f.done.includes(step)) return
  f.done.push(step)
  try { localStorage.setItem(FUNNEL_KEY, JSON.stringify(f)) } catch { /* no storage */ }
  count('funnel', step)
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
  // Quit Funnel: first game, then second game.
  const f = readFunnel()
  funnelStep((f ? f.done.includes('run') : funnelWaiting?.includes('run')) ? 'run2' : 'run')
  fpsRun = { start: performance.now(), samples: [] }
}

// Death Heatmap (2026-11-27): called by BuildSurvival._die for a death on
// the city map (map3), with where the player fell. Only the 8-block square
// is sent (DeathCells.js), never who died.
export function countDeath(x, z) {
  count('death', deathCell(x, z))
}

export function loadBucket(ms) {
  const s = ms / 1000
  return s < 2 ? 's0-2' : s < 4 ? 's2-4' : s < 7 ? 's4-7' : s < 12 ? 's7-12' : 's12up'
}
export function fpsBucket(fps) {
  return fps < 20 ? 'f0-19' : fps < 30 ? 'f20-29' : fps < 45 ? 'f30-44' : fps < 60 ? 'f45-59' : 'f60up'
}
export function graphicsKey(settings) {
  const g = settings?.graphicsLevel
  return GRAPHICS_LEVELS.includes(g) ? g : 'other'
}

// The game's fps readout calls this every half second while a game runs
// (Game.js). Once enough readings are in, the game's usual frame rate is
// counted once, with the device and graphics level. A hidden tab doesn't count.
export function fpsSample(fps, now = performance.now()) {
  const r = fpsRun
  if (!r || document.hidden || now - r.start < FPS_WARMUP_MS || !Number.isFinite(fps)) return
  r.samples.push(fps)
  if (r.samples.length < FPS_SAMPLES) return
  fpsRun = null
  const sorted = r.samples.sort((a, b) => a - b)
  const mid = sorted[Math.floor(sorted.length / 2)]
  count('fps', `${deviceKind()}-${graphicsKey(game?.settings)}-${fpsBucket(mid)}`)
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

// New player, or back after how many days away (2026-11-26). Uses only this
// device's last counted day; a device with none falls back to the login
// streak's earlier day (covers players from before stats existed).
export function backKind(last, today) {
  const before = last || game?.loginStreak?.previousDate || null
  const gap = before ? Math.round((Date.parse(today) - Date.parse(before)) / 86400000) : NaN
  if (!Number.isFinite(gap) || gap < 1) return before ? 'd1' : 'new'
  return gap === 1 ? 'd1' : gap <= 6 ? 'd2-6' : gap <= 29 ? 'd7-29' : 'd30up'
}

// Days played on this device, today included. A device that was already
// playing before this was counted starts at 2 (it has at least 2).
export function daysPlayed(saved, kind) {
  const n = Math.floor(Number(saved))
  if (Number.isFinite(n) && n >= 1) return n + 1
  return kind === 'new' ? 1 : 2
}
export function daysBucket(n) {
  return n <= 1 ? '1' : n === 2 ? '2' : n <= 6 ? '3-6' : n <= 29 ? '7-29' : '30up'
}

// Days since this device's first day, for a device coming back. Exact days
// 1-7, 14 and 30 so the Console can say "of the new players on a day, how
// many were back 1 / 7 / 30 days later"; ranges between them.
export function sinceKind(first, today) {
  const gap = Math.round((Date.parse(today) - Date.parse(first)) / 86400000)
  if (!Number.isFinite(gap) || gap < 1) return null
  if (gap <= 7) return `d${gap}`
  return gap <= 13 ? 'd8-13' : gap === 14 ? 'd14' : gap <= 29 ? 'd15-29' : gap === 30 ? 'd30' : 'd31up'
}

// Once per page: a visit and its hour; once per device per day (UTC): a
// player, with their device and language.
export function hello() {
  if (!enabled()) return
  count('sum', 'visits')
  count('hour', new Date().getUTCHours())
  if (!loadSent && loadMs != null) {
    loadSent = true
    count('load', `${deviceKind()}-${loadBucket(loadMs)}`)
  }
  let last = null
  try { last = localStorage.getItem(STATS_DAY_KEY) } catch { /* no storage */ }
  const today = utcDay()
  if (last !== today) {
    try { localStorage.setItem(STATS_DAY_KEY, today) } catch { /* no storage */ }
    count('sum', 'players')
    count('device', deviceKind())
    count('lang', game?.settings?.language || 'en')
    const kind = backKind(last, today)
    count('back', kind)
    count('backdev', `${deviceKind()}-${kind === 'new' ? 'new' : 'back'}`)
    const store = (k, v) => { try { localStorage.setItem(k, v) } catch { /* no storage */ } }
    const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
    const played = daysPlayed(read(STATS_DAYS_KEY), kind)
    store(STATS_DAYS_KEY, String(played))
    count('days', daysBucket(played))
    // First day: a device from before this was counted has no first day
    // ("old") and is left out, so the return rates stay honest.
    let first = read(STATS_FIRST_KEY)
    if (!first) first = kind === 'new' ? today : 'old'
    store(STATS_FIRST_KEY, first)
    if (kind !== 'new') count('since', sinceKind(first, today))
    // Quit Funnel: a new device starts one; one coming back on a later
    // day reached "came back another day".
    if (kind === 'new' && !readFunnel()) {
      funnel = { start: today, done: [] }
      funnelStep('home')
    } else if (kind !== 'new') funnelStep('day2')
  }
  // The first hello has decided: replay steps that came before it (a
  // device with no funnel drops them).
  const waiting = funnelWaiting
  funnelWaiting = null
  if (waiting) for (const step of waiting) funnelStep(step)
  flushStats()
}

export function startPlayStats(g) {
  game = g
  // Called right after the game is built, so this is the wait from opening
  // the page until the homepage works.
  loadMs = performance.now()
  game._playStats = { countRun, countWeapon, fpsSample, countDeath, funnelStep }
  // Tests: set window.__playStatsForTests (gets each message), then call these.
  game.__statsHello = hello
  game.__statsFlush = flushStats
  game.__statsQuitPlace = quitPlace
  game.__statsFunnelReset = () => { funnel = undefined; funnelWaiting = [] }
  // Late enough that a signed-in player's account has loaded (s vs g).
  setTimeout(hello, FIRST_HELLO_MS)
  setInterval(() => flushStats(), FLUSH_EVERY_MS)
  window.addEventListener('pagehide', () => {
    count('quit', quitPlace())
    flushStats(true)
  })
}

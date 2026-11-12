// Live settings from the Console's admin controls (2026-11-12, Console
// batch 4): the homepage banner, the event switches (Double Coins, Double
// XP, Horde Night, a Holiday look), maps/builds the Console hid, and this
// player's own ban. Asked from /api/live (api/_lib/admin.js) a moment after
// the page opens, then every LIVE_EVERY_MS and when the tab comes back.
//
// The last answer is kept in localStorage so the next visit starts with
// the right look straight away (homepage first paint = final look). Offline
// or before the first answer, everything is simply off.
//
// Changes fire a 'gayz-live' event on window; the theme, background mood
// and snow listen for it (a Holiday switch shows within a couple of
// minutes on open pages).
import { t } from './i18n.js'

const CACHE_KEY = 'gayz-live-config'
const CLOSED_KEY = 'gayz-live-banner-closed'
const LIVE_EVERY_MS = 2 * 60 * 1000
const FIRST_ASK_MS = 1500
const EVENT_IDS = ['doubleCoins', 'doubleXp', 'hordeNight']

// Horde Night's extra zombies per wave.
export const HORDE_MULT = 1.5

const EMPTY = { banner: null, events: {}, hidden: { maps: [], builds: [] }, ban: null }

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return c && typeof c === 'object' ? { ...EMPTY, ...c } : EMPTY
  } catch {
    return EMPTY
  }
}

let config = readCache()
let hiddenSets = { maps: new Set(), builds: new Set() }
function rebuildHidden() {
  hiddenSets = {
    maps: new Set(Array.isArray(config.hidden?.maps) ? config.hidden.maps : []),
    builds: new Set(Array.isArray(config.hidden?.builds) ? config.hidden.builds : []),
  }
}
rebuildHidden()

export function eventOn(id) {
  return config.events?.[id] === true
}

// 'halloween' | 'christmas' | null
export function holiday() {
  const h = config.events?.holiday
  return h === 'halloween' || h === 'christmas' ? h : null
}

// The date seasonal looks should go by: a day inside the Holiday switch's
// season (same time of day) while it's on, else the real date.
export function holidayDate(now = new Date()) {
  const h = holiday()
  if (!h) return now
  const d = new Date(now)
  d.setMonth(h === 'halloween' ? 9 : 11, h === 'halloween' ? 25 : 20)
  return d
}

// Coins multiplier from the Double Coins switch.
export function coinMult() {
  return eventOn('doubleCoins') ? 2 : 1
}

// XP and quest/daily rewards multiplier from the Double XP switch.
export function rewardMult() {
  return eventOn('doubleXp') ? 2 : 1
}

export function hordeMult() {
  return eventOn('hordeNight') ? HORDE_MULT : 1
}

// A map/build the Console hid ('map' code, or 'build' id).
export function isHidden(kind, id) {
  return (kind === 'map' ? hiddenSets.maps : hiddenSets.builds).has(id)
}

// This player's ban: null, or { until (0 = forever), reason, kick }.
export function currentBan() {
  const b = config.ban
  if (!b) return null
  if (b.until && b.until <= Date.now()) return null
  return b
}

// The "you're banned" words, or null.
export function banMessage() {
  const b = currentBan()
  if (!b) return null
  if (!b.until) return t('liveBannedForever')
  return t('liveBannedUntil', { when: new Date(b.until).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
}

function liveApi() {
  if (typeof window !== 'undefined' && window.__liveConfigForTests) return window.__liveConfigForTests
  return async (body) => {
    const res = await fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) throw new Error(data?.error || `http-${res.status}`)
    return data
  }
}

// A Report from chat's name popup (ChatUI.showPlayerIdPopup).
export async function reportPlayer(game, { target, targetName, where, text }) {
  return liveApi()({ action: 'report', target, targetName, where, text, by: game.settings.playerId, byName: game.settings.nickname || '' })
}

function apply(next, game) {
  const before = JSON.stringify(config)
  config = { ...EMPTY, ...next }
  rebuildHidden()
  if (JSON.stringify(config) === before) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config))
  } catch { /* full or blocked - the next answer still applies */ }
  renderLiveBanner(game)
  window.dispatchEvent(new Event('gayz-live'))
}

async function ask(game) {
  try {
    apply(await liveApi()({ pid: game.settings?.playerId }), game)
  } catch { /* offline or no server (local dev) - keep what we had */ }
}

// The banner and the "live now" event chips, bottom middle of the homepage.
export function renderLiveBanner(game) {
  const el = document.getElementById('live-banner')
  if (!el) return
  const b = config.banner && (!config.banner.until || config.banner.until > Date.now()) ? config.banner : null
  let closed = null
  try {
    closed = localStorage.getItem(CLOSED_KEY)
  } catch { /* blocked */ }
  const showText = !!b && String(b.id) !== closed
  const chips = EVENT_IDS.filter(eventOn).map((id) => t(`liveEvent_${id}`))
  if (holiday()) chips.push(t(`liveEvent_${holiday()}`))
  el.dataset.style = b?.style || 'info'
  const text = el.querySelector('.live-banner-text')
  const chipsEl = el.querySelector('.live-banner-chips')
  text.textContent = showText ? b.text : ''
  text.hidden = !showText
  el.querySelector('.live-banner-close').hidden = !showText
  chipsEl.textContent = ''
  if (chips.length) {
    const label = document.createElement('span')
    label.className = 'live-banner-label'
    label.textContent = t('liveEventsOn')
    chipsEl.appendChild(label)
    for (const c of chips) {
      const chip = document.createElement('span')
      chip.className = 'live-banner-chip'
      chip.textContent = c
      chipsEl.appendChild(chip)
    }
  }
  chipsEl.hidden = !chips.length
  el.hidden = !showText && !chips.length
  if (game && !el._bound) {
    el._bound = true
    el.querySelector('.live-banner-close').addEventListener('click', () => {
      try {
        localStorage.setItem(CLOSED_KEY, String(config.banner?.id || ''))
      } catch { /* blocked */ }
      renderLiveBanner(game)
    })
  }
}

// From main.js once the game exists.
export function startLiveConfig(game) {
  renderLiveBanner(game)
  // A ban carried over from the last visit: say so once.
  const shownBan = () => {
    const msg = banMessage()
    if (msg && !game._liveBanShown) {
      game._liveBanShown = true
      game._showHomepageToast?.(msg)
    }
  }
  window.addEventListener('gayz-live', shownBan)
  // The Holiday switch moves the Auto background mood's season too.
  window.addEventListener('gayz-live', () => game._applyBgMood?.())
  // Tests: set window.__liveConfigForTests (a fake /api/live), then
  // await game.__liveAsk().
  game.__liveAsk = () => ask(game)
  setTimeout(() => ask(game), FIRST_ASK_MS)
  setInterval(() => {
    if (document.visibilityState === 'visible') ask(game)
  }, LIVE_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ask(game)
  })
  // A timed banner goes away by itself.
  setInterval(() => renderLiveBanner(game), 60 * 1000)
}

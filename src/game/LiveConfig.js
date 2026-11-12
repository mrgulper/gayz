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
//
// Safety switches (2026-11-12, Console "Safety" batch): `off` lists paused
// features (switchedOff(id) - CloudSync/ChatUI check it, the banner shows
// "Paused:" chips) and `maintenance` covers the homepage with a "back
// soon" screen. Neither stops a game already running; servers are also
// closed on the server side (api/_lib/admin.js onlineClosed).
//
// Players (2026-11-12, Console "Players" batch): `mute` is this player's
// chat mute (muteMessage() - ChatUI won't send; the server and Firebase's
// rules also refuse) and `warnings` are messages from the team, shown one
// at a time in a popup with an OK button (renderWarning) on the homepage.
import { t } from './i18n.js'

const CACHE_KEY = 'gayz-live-config'
const CLOSED_KEY = 'gayz-live-banner-closed'
const LIVE_EVERY_MS = 2 * 60 * 1000
const FIRST_ASK_MS = 1500
const EVENT_IDS = ['doubleCoins', 'doubleXp', 'hordeNight']
export const SWITCH_IDS = ['online', 'chat', 'market', 'sharing', 'gallery', 'leaderboards']
// While maintenance is on, ask more often so the screen goes away soon
// after it ends.
const MAINT_EVERY_MS = 30 * 1000
const OFF_TOAST_GAP_MS = 20 * 1000
// Warning ids this device already pressed OK on (the server is told too,
// but this hides it at once and works offline).
const WARN_SEEN_KEY = 'gayz-warnings-seen'

// Horde Night's extra zombies per wave.
export const HORDE_MULT = 1.5

const EMPTY = { banner: null, events: {}, hidden: { maps: [], builds: [] }, ban: null, mute: null, warnings: [], off: [], maintenance: null }

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

// A paused feature ('online' | 'chat' | 'market' | 'sharing' | 'gallery'
// | 'leaderboards').
export function featureOff(id) {
  return Array.isArray(config.off) && config.off.includes(id)
}

export function switchedOffText(id) {
  return t('liveSwitchedOff', { what: t(`liveFeature_${id}`) })
}

let liveGame = null
const lastOffToast = {}
// For an action the player just pressed (send, buy, share...): true when
// that feature is paused, after saying so. `quiet` (lists that load by
// themselves) skips the message - the banner's "Paused:" chips explain.
// The message waits a moment so it lands after the caller's own "couldn't
// ..." toast instead of being replaced by it.
export function switchedOff(id, { quiet = false } = {}) {
  if (!featureOff(id)) return false
  const now = Date.now()
  if (!quiet && liveGame && !(now - (lastOffToast[id] || 0) < OFF_TOAST_GAP_MS)) {
    lastOffToast[id] = now
    setTimeout(() => liveGame?._showHomepageToast?.(switchedOffText(id)), 300)
  }
  return true
}

// The error CloudSync throws for a paused feature.
export function switchedOffError(id) {
  const err = new Error(`switched-off:${id}`)
  err.code = 'switched-off'
  return err
}

// Maintenance: { text, at } or null.
export function maintenance() {
  return config.maintenance && typeof config.maintenance === 'object' ? config.maintenance : null
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

// This player's chat mute from the Console: null, or { until (0 = forever) }.
export function currentMute() {
  const m = config.mute
  if (!m) return null
  if (m.until && m.until <= Date.now()) return null
  return m
}

// The "you're muted" words, or null.
export function muteMessage() {
  const m = currentMute()
  if (!m) return null
  if (!m.until) return t('liveMutedForever')
  return t('liveMutedUntil', { when: new Date(m.until).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })
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
  renderMaintenance(game)
  renderWarning(game)
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
  const paused = SWITCH_IDS.filter(featureOff).map((id) => t(`liveFeature_${id}`))
  el.dataset.style = b?.style || 'info'
  const text = el.querySelector('.live-banner-text')
  const chipsEl = el.querySelector('.live-banner-chips')
  text.textContent = showText ? b.text : ''
  text.hidden = !showText
  el.querySelector('.live-banner-close').hidden = !showText
  chipsEl.textContent = ''
  const addChips = (labelKey, list, extraClass) => {
    if (!list.length) return
    const label = document.createElement('span')
    label.className = 'live-banner-label'
    label.textContent = t(labelKey)
    chipsEl.appendChild(label)
    for (const c of list) {
      const chip = document.createElement('span')
      chip.className = `live-banner-chip${extraClass}`
      chip.textContent = c
      chipsEl.appendChild(chip)
    }
  }
  addChips('liveEventsOn', chips, '')
  addChips('livePausedNow', paused, ' paused')
  const anyChips = chips.length + paused.length > 0
  chipsEl.hidden = !anyChips
  el.hidden = !showText && !anyChips
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

// Inside the Console's preview (an iframe) the screen never shows, so the
// homepage can still be edited during maintenance.
function embedded() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

// The "back soon" screen over the homepage. Only on the homepage: a game
// already running carries on (it gets one heads-up toast) and meets the
// screen when it goes back to the homepage.
export function renderMaintenance(game) {
  const m = maintenance()
  const onHome = !game?.menu || game.menu.style.display !== 'none'
  let el = document.getElementById('maintenance-screen')
  const show = !!m && onHome && !embedded()
  if (!show) {
    if (el) el.hidden = true
    if (!m) {
      if (game) game._maintWarned = false
    } else if (!onHome && game && !game._maintWarned) {
      game._maintWarned = true
      game._showHomepageToast?.(t('maintenanceSoon'))
    }
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'maintenance-screen'
    el.setAttribute('role', 'alertdialog')
    el.setAttribute('aria-modal', 'true')
    el.innerHTML = '<div class="maintenance-card"><h2 class="maintenance-title"></h2><p class="maintenance-text"></p><p class="maintenance-note"></p></div>'
    document.body.appendChild(el)
  }
  el.querySelector('.maintenance-title').textContent = t('maintenanceTitle')
  const text = el.querySelector('.maintenance-text')
  text.textContent = m.text || ''
  text.hidden = !m.text
  el.querySelector('.maintenance-note').textContent = t('maintenanceNote')
  el.hidden = false
}

function seenWarnings() {
  try {
    const list = JSON.parse(localStorage.getItem(WARN_SEEN_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// A warning from the team: a popup the player has to press OK on, one at
// a time, oldest first. Only on the homepage (a running game isn't
// interrupted; it shows when they get back), never in the Console preview
// and never over the maintenance screen.
export function renderWarning(game) {
  const seen = seenWarnings()
  const w = (Array.isArray(config.warnings) ? config.warnings : []).find((x) => x && x.id && !seen.includes(x.id))
  const onHome = !game?.menu || game.menu.style.display !== 'none'
  const maintEl = document.getElementById('maintenance-screen')
  const maintUp = !!maintEl && !maintEl.hidden
  let el = document.getElementById('warning-screen')
  if (!w || !onHome || maintUp || embedded()) {
    if (el) el.hidden = true
    return
  }
  if (!el) {
    el = document.createElement('div')
    el.id = 'warning-screen'
    el.setAttribute('role', 'alertdialog')
    el.setAttribute('aria-modal', 'true')
    el.innerHTML = '<div class="maintenance-card warning-card"><h2 class="maintenance-title"></h2><p class="maintenance-text"></p><button type="button" class="warning-ok"></button></div>'
    document.body.appendChild(el)
    el.querySelector('.warning-ok').addEventListener('click', () => {
      const id = el.dataset.id
      if (!id) return
      try {
        localStorage.setItem(WARN_SEEN_KEY, JSON.stringify([...seenWarnings(), id].slice(-50)))
      } catch { /* blocked - the server's "seen" still hides it next time */ }
      liveApi()({ action: 'seenWarning', pid: game?.settings?.playerId, id }).catch(() => {})
      renderWarning(game)
    })
  }
  el.dataset.id = w.id
  el.querySelector('.maintenance-title').textContent = t('warningTitle')
  el.querySelector('.maintenance-text').textContent = w.text
  el.querySelector('.warning-ok').textContent = t('warningOk')
  el.hidden = false
}

// From main.js once the game exists.
export function startLiveConfig(game) {
  liveGame = game
  renderLiveBanner(game)
  renderMaintenance(game)
  renderWarning(game)
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
  game.__liveSwitchedOff = switchedOff
  setTimeout(() => ask(game), FIRST_ASK_MS)
  setInterval(() => {
    if (document.visibilityState === 'visible') ask(game)
  }, LIVE_EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ask(game)
  })
  // A timed banner goes away by itself.
  setInterval(() => renderLiveBanner(game), 60 * 1000)
  // Maintenance: ask more often while it's on, and put the screen up when
  // a running game goes back to the homepage.
  setInterval(() => {
    // A warning waiting for the homepage (a game just ended).
    if (config.warnings?.length) renderWarning(game)
    if (!maintenance()) return
    renderMaintenance(game)
    if (document.visibilityState === 'visible' && Date.now() - (game._maintAskedAt || 0) >= MAINT_EVERY_MS) {
      game._maintAskedAt = Date.now()
      ask(game)
    }
  }, 3000)
}

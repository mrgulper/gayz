// Settings > Controls > Gameplay, ideas 51-62 of Gaymi's settings list
// (2026-11-11; #52 auto-equip skipped - you only ever carry one gun).
// The rows are in MoreSettingsList.js; this file holds the hook-ups that
// aren't a one-liner where they're used:
//   - Confirm Buying Over: needsBuyConfirm (PlayShop's "Sure?" button and
//     the Market's buy box).
//   - Game Tips: gameTip (pause screen, 9 s into a game, the fade into a
//     game) - Silly (SillyTips.js), Helpful (helpTip1..N) or both.
//   - Hints only show HINT_MAX times each (hintOk), Reset Hints brings
//     them back; Replay Tutorial makes the next game a first game
//     (PlayOnboarding.isFirstGame).
//   - Pause When Tab Is Hidden and AFK Pause: solo games from the
//     homepage only (a server game can't stop for one player).
//   - Loot Glow / Beams: LootMarks.js, run from BuildSurvival.update.
// Kept light (no game code): the homepage's Settings loads it.
// Auto-Reload is in BuildSurvival.tryFire, Auto-Sort in PlayInventory,
// Confirm Before Selling in InventoryUI, Spoiler-Free Story in
// PlayCrafting + the Features page (html.spoiler-free).
import { t } from './i18n.js'
import { getKeyFor, keyLabel } from './Keybinds.js'
import { sillyTip } from './SillyTips.js'

// ---------- Confirm Buying Over (55) ----------

// true when a buy for `price` coins should ask first.
export function needsBuyConfirm(settings, price) {
  const v = settings?.confirmBuyOver ?? '100'
  if (v === 'always') return true
  if (v === 'never') return false
  const n = Number(v)
  return !Number.isFinite(n) || price >= n
}

// ---------- Game Tips (57) ----------

export const HELP_TIP_COUNT = 12

function helpTip() {
  const k = (a) => keyLabel(getKeyFor(a))
  return t(`helpTip${1 + Math.floor(Math.random() * HELP_TIP_COUNT)}`, {
    shop: k('shop'), use: k('use'), reload: k('reload'), drop: k('dropItem'), camera: k('cameraView'),
    run: k('autoRun'), bingo: k('bingo'), emote: k('emote'),
  })
}

// A tip for the settings' choice, or '' with tips off.
export function gameTip(settings) {
  const mode = settings?.gameTips || 'silly'
  if (mode === 'off') return ''
  if (mode === 'silly' || (mode === 'both' && Math.random() < 0.5)) return sillyTip()
  return helpTip()
}

// The fade into a game (PlayEntryUI._fadeScreen): a tip in the middle of
// the black, gone with it.
export function fadeTip(el, settings) {
  if (!el) return
  let line = el.querySelector('.play-fade-tip')
  if (!line) {
    line = document.createElement('p')
    line.className = 'play-fade-tip'
    el.appendChild(line)
  }
  line.textContent = gameTip(settings)
}

// ---------- Hints (58, 62) ----------

const HINT_KEY = 'gayz-hint-counts'
export const HINT_MAX = 3
let hintCounts = null

function counts() {
  if (hintCounts) return hintCounts
  try { hintCounts = JSON.parse(localStorage.getItem(HINT_KEY)) } catch { hintCounts = null }
  if (!hintCounts || typeof hintCounts !== 'object' || Array.isArray(hintCounts)) hintCounts = {}
  return hintCounts
}

// May hint `id` show? Counts it if so. Only called when a hint would
// show (never per frame).
export function hintOk(id) {
  const c = counts()
  const n = Number(c[id]) || 0
  if (n >= HINT_MAX) return false
  c[id] = n + 1
  try { localStorage.setItem(HINT_KEY, JSON.stringify(c)) } catch { /* storage blocked: hints just keep showing */ }
  return true
}

export function resetHints() {
  hintCounts = {}
  try { localStorage.removeItem(HINT_KEY) } catch { /* storage blocked */ }
}

const REPLAY_KEY = 'gayz-replay-tutorial'

export function wantsTutorial() {
  try { return localStorage.getItem(REPLAY_KEY) === '1' } catch { return false }
}

export function setTutorialReplay(on) {
  try {
    if (on) localStorage.setItem(REPLAY_KEY, '1')
    else localStorage.removeItem(REPLAY_KEY)
  } catch { /* storage blocked */ }
}

// The two buttons' clicks (MoreSettings.bindMoreSettings).
export function onGameplayButton(key, game) {
  if (key === 'replayTutorial') {
    setTutorialReplay(true)
    resetHints()
    game._showHomepageToast?.(t('replayTutorialDone'))
  } else if (key === 'resetHints') {
    resetHints()
    game._showHomepageToast?.(t('resetHintsDone'))
  }
}

// ---------- Pause When Tab Is Hidden (59) + AFK Pause (60) ----------

let lastInput = performance.now()

// Tests: pretend the last input was `ms` ago.
export function _testIdle(ms) {
  lastInput = performance.now() - ms
}

// Opens the pause screen of a solo game from the homepage. true if it did.
function pauseSolo(game, note) {
  const bm = game?.buildMode
  const s = bm?.survival
  if (!bm?.active || !s?.active || !s.fromMenu || s.dead || s._picking || bm.menuOpen) return false
  if (s.net && !s.net.closed) return false
  bm.toggleMenu()
  if (!bm.menuOpen) return false
  const el = document.getElementById('play-pause-status')
  if (el && note) el.textContent = note
  return true
}

export function bindPauseHelpers(game) {
  game._testIdle = _testIdle
  const seen = () => { lastInput = performance.now() }
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) window.addEventListener(ev, seen, { passive: true, capture: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && game.settings.pauseWhenHidden) pauseSolo(game, t('pausedTabHidden'))
    if (document.visibilityState === 'visible') seen()
  })
}

// Spoiler-Free Story: a click shows the blurred Features card.
export function bindSpoilerReveal() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('.feature-spoiler')
    if (el && document.documentElement.classList.contains('spoiler-free')) el.classList.add('revealed')
  })
}

// Every frame of a game (BuildSurvival.update).
export function afkTick(s) {
  const bm = s.bm
  // Holding a key, a stick or the trigger counts as playing.
  if (bm._padMove || bm._fireHeld || bm._keys?.size) lastInput = performance.now()
  const mins = Number(bm.game?.settings?.afkPause)
  if (!Number.isFinite(mins) || mins <= 0) return
  if (performance.now() - lastInput < mins * 60000) return
  if (pauseSolo(bm.game, t('pausedAfk', { n: mins }))) lastInput = performance.now()
}

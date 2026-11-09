// Lag warning (2026-11-09, Gaymi: "when the fps or ms goes too low for the
// player make a warning and make them turn on performance mode ... some
// pcs do 144fps or 60fps the game needs to find whats too slow for them
// ... dont just warn all with 60 fps").
//
// "Too slow" is measured against what THIS player's screen can show, not a
// fixed 60: the game learns the screen's refresh rate from the best frame
// rate it has seen (the homepage draws almost nothing, so it runs at the
// screen's own speed), snapped to a real screen rate (60, 75, 120, 144...).
// A game running under SLOW_SHARE of that for a while, in a real game,
// pops a box recommending Performance Mode - once a session.
//
// Internet trouble never counts (Gaymi: "if they like lose internet
// connection that doesnt count"): nothing is measured while offline, and
// the frame rate itself only measures drawing, not the connection. Hidden
// tabs, the first seconds of a game (the world still loading) and long
// stalls (a tab switch, a big load) are skipped too.

import { saveSettings } from './Game.js'
import { t } from './i18n.js'

// Real screen refresh rates. The measured best is snapped up to the next
// one (a 144 Hz screen measures ~142).
const SCREEN_RATES = [60, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360]
// Below this share of the screen's rate counts as a slow half-second:
// 36 fps on a 60 Hz screen, 72 on 120 Hz, 86 on 144 Hz.
export const SLOW_SHARE = 0.6
// Slow half-seconds needed (a good one takes one back): ~12 seconds of
// mostly-slow play, so a short dip (an explosion, a big horde) doesn't.
export const SLOW_NEEDED = 24
// Nothing is measured for this long after a game starts or the game comes
// back from a stall - the world is still loading in.
const WARMUP_MS = 12000

export function snapScreenRate(fps) {
  // A little measuring slack: 142 counts as 144, 61 as 60.
  const near = fps / 1.04
  return SCREEN_RATES.find((r) => r >= near) ?? Math.round(fps)
}

export class LagWarning {
  constructor(game) {
    this.game = game
    this.best = 0
    this.slow = 0
    this.shown = false
    this._lastSampleAt = 0
    this._warmUntil = 0
    this._el = null
  }

  // The screen's refresh rate, as best the game knows it (never under 60 -
  // nearly every screen is at least that).
  get screenHz() {
    return Math.max(60, snapScreenRate(this.best))
  }

  // What this player should be getting: their screen's rate, or their FPS
  // Cap if that's lower.
  get targetFps() {
    const cap = this.game.settings?.fpsCap || 0
    return cap > 0 ? Math.min(cap, this.screenHz) : this.screenHz
  }

  // Any half-second's frame rate, homepage or game - learns the screen.
  seen(fps) {
    if (fps > this.best && fps < 1000) this.best = fps
  }

  // A game started (or restarted): give the world time to load in.
  gameStarted(now = performance.now()) {
    this._warmUntil = now + WARMUP_MS
    this.slow = 0
  }

  // One half-second of a running game.
  sample(fps, now = performance.now()) {
    this.seen(fps)
    const gap = now - (this._lastSampleAt || now)
    this._lastSampleAt = now
    // A long gap (tab hidden, a big load) restarts the warm-up.
    if (gap > 2000) this._warmUntil = now + WARMUP_MS
    if (this.shown || !this._shouldMeasure(now)) return false
    if (fps < this.targetFps * SLOW_SHARE) this.slow++
    else this.slow = Math.max(0, this.slow - 1)
    if (this.slow < SLOW_NEEDED) return false
    this.show(fps)
    return true
  }

  _shouldMeasure(now) {
    const s = this.game.settings || {}
    if (s.performanceMode || s.lagWarnOff) return false
    if (now < this._warmUntil) return false
    if (typeof document !== 'undefined' && document.hidden) return false
    // Internet lost: not this box's problem.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
    const bm = this.game.buildMode
    if (!bm?.survival?.active) return false
    return true
  }

  _build() {
    if (this._el) return this._el
    const el = document.createElement('div')
    el.id = 'lag-warning'
    el.setAttribute('role', 'alertdialog')
    el.setAttribute('aria-labelledby', 'lag-warning-title')
    el.innerHTML = `
      <p id="lag-warning-title"></p>
      <p id="lag-warning-text"></p>
      <div class="lag-warning-btns">
        <button type="button" id="lag-warning-on"></button>
        <button type="button" id="lag-warning-later"></button>
      </div>
      <button type="button" id="lag-warning-never"></button>
      <p id="lag-warning-mouse"></p>`
    document.body.appendChild(el)
    el.querySelector('#lag-warning-on').addEventListener('click', () => this.turnOn())
    el.querySelector('#lag-warning-later').addEventListener('click', () => this.hide())
    el.querySelector('#lag-warning-never').addEventListener('click', () => {
      this.game.settings.lagWarnOff = true
      saveSettings(this.game.settings)
      this.hide()
    })
    this._el = el
    return el
  }

  show(fps) {
    this.shown = true
    const el = this._build()
    el.querySelector('#lag-warning-title').textContent = t('lagWarnTitle')
    el.querySelector('#lag-warning-text').textContent = t('lagWarnText', { fps: Math.round(fps), hz: this.targetFps })
    el.querySelector('#lag-warning-on').textContent = t('lagWarnTurnOn')
    el.querySelector('#lag-warning-later').textContent = t('lagWarnLater')
    el.querySelector('#lag-warning-never').textContent = t('lagWarnNever')
    const touch = document.body.classList.contains('touch-play-on')
    el.querySelector('#lag-warning-mouse').textContent = touch ? '' : t('lagWarnMouseHint')
    el.classList.add('on')
  }

  hide() {
    this._el?.classList.remove('on')
  }

  get open() {
    return !!this._el?.classList.contains('on')
  }

  turnOn() {
    const game = this.game
    game.settings.performanceMode = true
    game._applyPerformanceMode(true)
    if (game.performanceToggle) game.performanceToggle.checked = true
    game.quickPerformanceBtn?.classList.toggle('active', true)
    saveSettings(game.settings)
    this.hide()
    game.buildMode?.survival?._message?.(t('lagWarnDone'), 5)
  }
}

// The spin ring tutorial (2026-11-15, Batch 5 of the spin ring plan): your
// first ring game shows a small tip at the top, one step at a time, and
// each step waits until you've actually done it (Gaymi's pick):
//
//   spread -> pull -> pickup -> bag -> swap -> done (a last tip, then gone)
//
// Shown once for everyone - new and old players alike - in their first
// ring game (gayz-ring-tutorial = '1' once finished or skipped); Settings >
// Gameplay > Replay Tutorial clears that (GameplayAssist.onGameplayButton).
// A Skip button ends it for good. Owned by BuildSurvival (`ringTutorial`),
// only while there's a ring. Hooks: RingLoot._collect -> did('pickup'),
// RingEditor.open -> did('bag'), RingEditor._apply -> did('swap').
// While it runs, PlayOnboarding's own first-game hint (about guns) stays
// hidden.
import { t } from './i18n.js'
import { getKeyFor, keyLabel } from './Keybinds.js'

export const RING_TUTORIAL_KEY = 'gayz-ring-tutorial'
export const STEPS = ['spread', 'pull', 'pickup', 'bag', 'swap', 'done']
// How long (seconds) you hold attack/defend for it to count.
export const HOLD_S = 0.6
// The last tip stays this long.
const DONE_S = 6
// A short pause between steps, so you see it ticked off.
const GAP_S = 0.9

export function ringTutorialDone() {
  try { return localStorage.getItem(RING_TUTORIAL_KEY) === '1' } catch { return true }
}

export function resetRingTutorial() {
  try { localStorage.removeItem(RING_TUTORIAL_KEY) } catch { /* storage blocked */ }
}

function markDone() {
  try { localStorage.setItem(RING_TUTORIAL_KEY, '1') } catch { /* storage blocked: it shows again next time */ }
}

// Should this game get the tutorial? (Automated tests keep it off unless
// they ask for it: __ringTutorialForTests.)
export function wantsRingTutorial() {
  if (typeof navigator !== 'undefined' && navigator.webdriver && !window.__ringTutorialForTests) return false
  return !ringTutorialDone()
}

export class RingTutorial {
  constructor(survival) {
    this.s = survival
    this.step = 0
    this.active = true
    this._held = 0
    this._gap = 0
    this._left = 0
    this._el = null
    this._render()
  }

  get name() {
    return STEPS[this.step]
  }

  // A hook says something happened (pickup / bag / swap).
  did(what) {
    if (!this.active || this._gap > 0 || this.name !== what) return
    this._next()
  }

  _next() {
    this._gap = GAP_S
    this._el?.classList.add('ring-tut-ticked')
  }

  // Each frame from BuildSurvival.update.
  update(dt) {
    const s = this.s
    if (!this.active) return
    const ring = s.ring
    const shown = ring && s.active && !s.dead && !s.couch?.p1Down
    if (this._el) this._el.style.display = shown ? 'flex' : 'none'
    if (!shown) return
    if (this._gap > 0) {
      this._gap -= dt
      if (this._gap <= 0) {
        this.step++
        this._held = 0
        if (this.name === 'done') {
          // Finished: it won't come back (Replay Tutorial brings it back).
          markDone()
          this._left = DONE_S
        }
        this._render()
      }
      return
    }
    const name = this.name
    if (name === 'spread' || name === 'pull') {
      const want = name === 'spread' ? 1 : -1
      this._held = ring._push() === want ? this._held + dt : 0
      if (this._held >= HOLD_S) this._next()
    } else if (name === 'done') {
      this._left -= dt
      if (this._left <= 0) this.end()
    }
  }

  skip() {
    markDone()
    this.end()
  }

  end() {
    this.active = false
    this._el?.remove()
    this._el = null
  }

  _text() {
    const touch = this.s.bm.touch?.enabled
    const bag = keyLabel(getKeyFor('ringBag'))
    const k = {
      spread: touch ? 'ringTutSpreadTouch' : 'ringTutSpread',
      pull: touch ? 'ringTutPullTouch' : 'ringTutPull',
      pickup: 'ringTutPickup',
      bag: touch ? 'ringTutBagTouch' : 'ringTutBag',
      swap: 'ringTutSwap',
      done: 'ringTutDone',
    }[this.name]
    return t(k, { key: bag })
  }

  _render() {
    let el = this._el
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-ring-tutorial'
      el.setAttribute('role', 'status')
      el.innerHTML = '<span class="ring-tut-step"></span><span class="ring-tut-text"></span><button type="button" class="ring-tut-skip"></button>'
      const btn = el.querySelector('.ring-tut-skip')
      btn.onclick = (e) => {
        e.stopPropagation()
        this.skip()
      }
      btn.onpointerdown = (e) => e.stopPropagation()
      btn.ontouchstart = (e) => e.stopPropagation()
      document.body.appendChild(el)
      this._el = el
    }
    el.classList.remove('ring-tut-ticked')
    const last = this.name === 'done'
    // "1/5" ... "5/5"; the last tip has no number and no Skip.
    el.querySelector('.ring-tut-step').textContent = last ? '' : `${this.step + 1}/${STEPS.length - 1}`
    el.querySelector('.ring-tut-text').textContent = this._text()
    const btn = el.querySelector('.ring-tut-skip')
    btn.textContent = t('ringTutSkip')
    btn.style.display = last ? 'none' : ''
  }
}

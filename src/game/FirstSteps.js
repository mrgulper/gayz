// "Next up" for a new player's first few games (2026-11-27, Gaymi's
// first-5-minutes check-up: after wave 1 nothing pointed a new player at
// the camp, the Shop, Loot Chests or crafting).
//
// One pill over the hotbar (PlayPills.js, so it fits on phones too) shows
// the first step not done yet, e.g. "Next up (2/4): Open a Loot Chest
// with E". Steps count in any order, whenever they happen. It shows in
// solo games from the homepage until all four are done or the player has
// finished FIRST_STEPS_GAMES games. Done steps are saved in
// localStorage (only when one is done - never per frame).
// Owned by BuildSurvival (`s.firstSteps`); hooks call done(id).
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'
import { isTouchDevice } from './BuildTouch.js'

export const FIRST_STEPS_KEY = 'gayz-first-steps'
export const FIRST_STEPS_GAMES = 5
// Text keys: step<Name> (computer) and step<Name>Touch (phone buttons).
export const STEPS = [
  { id: 'camp', text: 'stepCamp' },
  { id: 'chest', text: 'stepChest' },
  { id: 'shop', text: 'stepShop' },
  { id: 'craft', text: 'stepCraft' },
]

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(FIRST_STEPS_KEY) || '[]')
    return Array.isArray(v) ? v.filter((id) => STEPS.some((s) => s.id === id)) : []
  } catch {
    return []
  }
}

function stepText(step) {
  if (isTouchDevice()) return t(`${step.text}Touch`)
  return t(step.text)
}

export class FirstSteps {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.doneIds = []
  }

  // From BuildSurvival.start. want: a solo game from the homepage.
  begin(want, gamesPlayed) {
    this.doneIds = load()
    this._wasWaiting = undefined
    this.on = !!want && gamesPlayed < FIRST_STEPS_GAMES && !!this.next()
    this._render()
  }

  end() {
    this.on = false
    hidePill('steps')
  }

  next() {
    return STEPS.find((st) => !this.doneIds.includes(st.id)) || null
  }

  // A step happened (any order).
  done(id) {
    if (!this.on || this.doneIds.includes(id) || !STEPS.some((st) => st.id === id)) return
    this.doneIds.push(id)
    try { localStorage.setItem(FIRST_STEPS_KEY, JSON.stringify(this.doneIds)) } catch { /* storage off */ }
    const nx = this.next()
    this.s._message(nx ? t('stepsNice', { step: stepText(nx) }) : t('stepsAll'), nx ? 3.5 : 5)
    if (!nx) this.on = false
    this._render()
  }

  // A very first game keeps the screen calm: the pill waits until wave 1
  // is over (steps done before then still count).
  _waiting() {
    return !!this.s.onboard?.active && (this.s.wave || 0) <= 1
  }

  // Each frame from BuildSurvival.update (cheap: one camp check).
  update() {
    if (!this.on || this.s.dead) return
    const wait = this._waiting()
    if (wait !== this._wasWaiting) {
      this._wasWaiting = wait
      this._render()
    }
    const camp = this.s.camp
    const p = this.s.bm?.tryMode?.pos
    if (camp && p && !this.doneIds.includes('camp') && camp.inside(p.x, p.z)) this.done('camp')
  }

  _render() {
    const nx = this.on && !this._waiting() ? this.next() : null
    if (!nx) {
      hidePill('steps')
      return
    }
    showPill('steps', t('stepsPill', { n: this.doneIds.length + 1, total: STEPS.length, step: stepText(nx) }))
  }
}

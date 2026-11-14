// Hardcore Survival (2026-11-06, Gaymi's idea list 8: "an optional hunger
// meter: you hunt, fish or farm, then cook it on a campfire" - picked "a
// toggle, off by default"). A Challenge in the Game Mode panel
// (PlayRules `hardcore`). Owned by BuildSurvival (`s.hunger`).
//
// With it on, a Hunger meter (a pill on screen) starts full and empties
// over HUNGER_MINUTES minutes. Eat to fill it: every food fills it by its
// FOOD amount - raw meat and fish only a little, cooked food a lot, crops
// from the Camp Farm and fish from Fishing in between. Empty, you lose
// STARVE_DPS health a second until you eat (even in camp). You can eat at
// full health while you're hungry.
//
// Cooking (this works in every game, not just Hardcore): hold raw meat or
// a fish next to a Campfire block (COOK_R) or inside the camp, and use it -
// it turns into Cooked Meat or Cooked Fish, which heal more too. Hardcore
// games start with a Campfire block in your bag to put down anywhere.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { showPill, hidePill } from './PlayPills.js'

export const HUNGER_MAX = 100
export const HUNGER_MINUTES = 12
export const STARVE_DPS = 1
export const COOK_R = 3
export const RAW_FOOD = 15
export const COOKED_FOOD = 45
// How much each food fills you (anything else that heals: RAW_FOOD).
export const FOOD = { veggies: 25, candy: 10, fish: RAW_FOOD, goldenFish: 40, cookedMeat: COOKED_FOOD, cookedFish: 40 }
const LOW = 25

export function isRaw(id) {
  return id === 'meat' || id === 'fish' || /^meat_/.test(id)
}

export function cookedOf(id) {
  return id === 'fish' ? 'cookedFish' : 'cookedMeat'
}

export function foodValue(id) {
  if (FOOD[id] !== undefined) return FOOD[id]
  return RAW_FOOD
}

export class Hunger {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.food = HUNGER_MAX
    this._warned = ''
    this._hurtT = 0
  }

  // A new game: on if the Hardcore Challenge is.
  start() {
    const s = this.s
    this.on = !!s.cfg?.hunger
    this.food = HUNGER_MAX
    this._warned = ''
    if (this.on && s.inv && !s.inv.has?.('campfire')) s.inv.add({ kind: 'block', id: 'campfire', n: 1 })
  }

  hungry() {
    return this.on && this.food < HUNGER_MAX - 1
  }

  // Just ate one `id`.
  eat(id) {
    if (!this.on) return 0
    const n = foodValue(id)
    this.food = Math.min(HUNGER_MAX, this.food + n)
    if (this.food > LOW) this._warned = ''
    return n
  }

  // Next to a Campfire block, or in the camp?
  nearFire() {
    const s = this.s
    const p = s.bm.tryMode.pos
    if (s._campSafe?.(p.x, p.z)) return true
    for (const e of s.bm.specials?.kind?.('campfire') || []) {
      if (Math.hypot(e.x + 0.5 - p.x, e.y - p.y, e.z + 0.5 - p.z) <= COOK_R) return true
    }
    return false
  }

  // Using a held raw food by a fire: cook it. -> true if cooked.
  cook(it) {
    const s = this.s
    if (!it || !isRaw(it.id) || !this.nearFire()) return false
    const inv = s.inv
    const id = cookedOf(it.id)
    inv._take(inv.hotbar, inv.active, 1)
    inv.add({ kind: 'item', id, n: 1 })
    s._message(t('hungerCooked', { name: t(id === 'cookedFish' ? 'invCookedFish' : 'invCookedMeat') }), 2.5)
    try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
    return true
  }

  update(dt) {
    const s = this.s
    if (!this.on || !s.active) {
      hidePill('hunger')
      return
    }
    if (!s.dead && !s.spectating && !s.bm.menuOpen) {
      // (Slower with the Iron Gut upgrade, cfg.hungerMult.)
      this.food = Math.max(0, this.food - (HUNGER_MAX / (HUNGER_MINUTES * 60)) * (s.cfg?.hungerMult ?? 1) * dt)
      if (this.food <= 0) {
        if (this._warned !== 'starve') s._message(t('hungerStarving'), 4)
        this._warned = 'starve'
        this._hurtT += dt
        while (this._hurtT >= 1 && s.health > 0) {
          this._hurtT -= 1
          s.health = Math.max(0, s.health - STARVE_DPS)
          s._renderHud?.()
          if (s.health <= 0) s._die()
        }
      } else if (this.food < LOW && !this._warned) {
        this._warned = 'low'
        s._message(t('hungerLow'), 4)
      }
    }
    showPill('hunger', t('hungerPill', { n: Math.ceil(this.food) }), this.food < LOW)
  }

  clear() {
    this.on = false
    this.food = HUNGER_MAX
    hidePill('hunger')
  }
}

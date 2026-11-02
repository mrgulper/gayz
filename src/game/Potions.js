// Potions (2026-11-01, Gaymi's idea list 3: "drink for speed,
// invisibility, giant mode or tiny mode"). Crafted (PlayCrafting) or found
// in loot chests (CHEST_POTION_CHANCE). Hold one and use it to drink it:
// its effect lasts POTION_S seconds, with a pill counting down. They run
// on the special blocks' buffs (BuildSpecials._setBuff) - the same Speed
// Pad, Invisibility Pad and Shrink / Grow Pad effects, only longer:
//   - Speed: run SPEED_MULT x as fast.
//   - Invisibility: zombies lose you (they wander) until it wears off.
//   - Giant: GIANT_SIZE x as big and hitting harder (the Grow Pad's bonus).
//   - Tiny: TINY_SIZE x as big - fits through one-block gaps.
// Giant and Tiny cancel each other. Owned by BuildSurvival (`s.potions`).
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { itemName } from './PlayInventory.js'
import { showPill, hidePill } from './PlayPills.js'

export const POTION_S = 30
export const SPEED_MULT = 1.6
export const GIANT_SIZE = 1.8
export const TINY_SIZE = 0.5
export const CHEST_POTION_CHANCE = 0.25
// item id -> the buff it gives and how strong.
export const POTIONS = {
  potionSpeed: { buff: 'speed', mult: SPEED_MULT },
  potionInvis: { buff: 'invisible', mult: 1 },
  potionGiant: { buff: 'grow', mult: GIANT_SIZE },
  potionTiny: { buff: 'shrink', mult: TINY_SIZE },
}
export const POTION_IDS = Object.keys(POTIONS)

export class Potions {
  constructor(survival) {
    this.s = survival
  }

  get sp() {
    return this.s.bm.specials
  }

  // Drink one. -> true if drunk (one used).
  drink(id) {
    const p = POTIONS[id]
    const s = this.s
    if (!p || !s.active || s.dead || !this.sp?.active) return false
    // Giant and Tiny can't both be on.
    if (p.buff === 'grow') delete this.sp._buffs.shrink
    if (p.buff === 'shrink') delete this.sp._buffs.grow
    this.sp._setBuff(p.buff, p.mult, POTION_S)
    s._message(t('potionDrunk', { name: itemName(id), s: POTION_S }), 3)
    try { audioEngine.playSpecial?.('potionGulp') } catch { /* no audio */ }
    return true
  }

  // Seconds left of a potion's effect (0 when off).
  left(id) {
    const b = this.sp?._buffs?.[POTIONS[id].buff]
    if (!b || !this.sp.active) return 0
    return Math.max(0, b.until - this.sp._time)
  }

  update() {
    for (const id of POTION_IDS) {
      const left = this.left(id)
      if (left > 0 && this.s.active) showPill(id, `${itemName(id)} ${Math.ceil(left)}s`, left < 5)
      else hidePill(id)
    }
  }

  clear() {
    for (const id of POTION_IDS) hidePill(id)
  }
}

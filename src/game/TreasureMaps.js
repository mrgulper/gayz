// Treasure Maps (2026-11-02, Gaymi's idea list 5, quick wins: "find torn
// map pieces on zombies, put 3 together and an X shows up, dig there" -
// picked "every map" and "a mix of coins, gems and a rare item").
//
// - A zombie you kill drops a Map Piece now and then (PIECE_CHANCE,
//   BuildSurvival.damageZombie). Three craft into a Treasure Map
//   (PlayCrafting).
// - Use the map: an X is marked NEAR..FAR blocks away - a gold X on the
//   big map and on the compass strip (MapPins draws both). Use it again
//   standing on the X (DIG_R) to dig up the chest: coins (COINS), gems
//   (GEMS, kept like any gems) and one rare item (RARE). The map is used
//   up. Anywhere else it says how far the X is.
// - The ground never changes (open-world terrain stays full cubes); the X
//   is just a spot. Each player's own, nothing to sync. Owned by
//   BuildSurvival (`s.treasure`).
import { audioEngine } from './Audio.js'
import { saveShopProgress } from './Game.js'
import { t } from './i18n.js'
import { itemName } from './PlayInventory.js'

export const PIECE_CHANCE = 0.06
export const PIECES_PER_MAP = 3
// Tried farthest first; small maps fall back to the nearer rings.
const RINGS = [[40, 90], [20, 40], [8, 20]]
export const DIG_R = 2
export const COINS = [120, 260]
export const GEMS = [1, 3]
export const RARE = ['jetpack', 'metalDetector', 'goldenFish', 'potionSpeed', 'potionInvis', 'potionGiant', 'gooDisguise', 'hotAirBalloon', 'chestplate', 'shield']

const between = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1))

export class TreasureMaps {
  constructor(survival) {
    this.s = survival
    this.spot = null
  }

  // Marks a new X near `me`. -> the spot, or null (nowhere to put it).
  mark(me = this.s.bodyPos()) {
    const s = this.s
    for (const [near, far] of RINGS) {
      for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2
        const d = near + Math.random() * (far - near)
        const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
        const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
        if (s.camp?.inside(x, z, 2)) continue
        const y = s._groundUnder(x, me.y + 16, z)
        if (!Number.isFinite(y) || Math.abs(y - me.y) > 14) continue
        if (s.bm._cellIsLiquid(Math.floor(x), Math.floor(y - 0.5), Math.floor(z)) || s.bm._cellIsLiquid(Math.floor(x), Math.floor(y + 0.5), Math.floor(z))) continue
        this.spot = { x, y, z }
        return this.spot
      }
    }
    return null
  }

  // Used (PlayInventory.useHeld). -> true only when the map is used up.
  use() {
    const s = this.s
    if (!s.active || s.dead) return false
    const me = s.bodyPos()
    if (!this.spot) {
      if (!this.mark(me)) {
        s._message(t('treasureNowhere'), 3)
        return false
      }
      s._message(t('treasureMarked', { n: Math.round(Math.hypot(this.spot.x - me.x, this.spot.z - me.z)) }), 5)
      try { audioEngine.playSpecial?.('detectorFound') } catch { /* no audio */ }
      return false
    }
    const d = Math.hypot(this.spot.x - me.x, this.spot.z - me.z)
    if (d > DIG_R || Math.abs(this.spot.y - me.y) > 3) {
      s._message(t('treasureFar', { n: Math.round(d) }), 2)
      return false
    }
    this._dig()
    return true
  }

  _dig() {
    const s = this.s
    const B = s.B
    const { x, y, z } = this.spot
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2
      s._fx?.spark(x * B, (y + 0.2) * B, z * B, { life: 0.9, from: 0.22, to: 0.08, gravity: 10, color: i % 3 ? 0x6b4a2a : 0xffcf3a, vel: { x: Math.cos(a) * 2 * B, y: 5 * B, z: Math.sin(a) * 2 * B } })
    }
    s._fx?.confetti?.(x * B, (y + 0.8) * B, z * B)
    const before = s._coinsEarned
    s._earn(between(COINS))
    const coins = s._coinsEarned - before
    const gems = between(GEMS)
    const game = s.bm.game
    if (game) {
      game.gems = (game.gems || 0) + gems
      saveShopProgress(game)
      game._renderCurrencyBar?.()
    }
    const id = RARE[Math.floor(Math.random() * RARE.length)]
    if (s.inv.add({ kind: 'item', id, n: 1 })) s._drops?.spawnItem(id, x, y + 1, z)
    s.stats.treasures = (s.stats.treasures || 0) + 1
    s._message(t('treasureDug', { coins, gems, item: itemName(id) }), 5)
    try { audioEngine.playSpecial?.('goldZombie') } catch { /* no audio */ }
    this.spot = null
    s._renderHud()
  }

  clear() {
    this.spot = null
  }
}

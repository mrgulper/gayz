// Metal detector (2026-11-01, Gaymi's idea list 3: "beeps faster near
// buried loot, and you dig it up"). Crafted (PlayCrafting) or found in a
// loot chest now and then. While you hold it, one spot of buried loot is
// hidden NEAR..FAR blocks from you: the detector beeps, faster the closer
// you get (BEEP_SLOW -> BEEP_FAST), and a pill shows the signal as bars.
// Standing within DIG_R of the spot, use it (click / the use button) to
// dig: coins (DIG_COINS) and one random find (FINDS), a puff of dirt, and
// a new spot is hidden. Using it anywhere else says how warm you are.
//
// The ground is never changed (open-world terrain stays full cubes) - the
// loot is just a spot. Each player's own, nothing to sync. Owned by
// BuildSurvival (`s.detector`).
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { itemName } from './PlayInventory.js'
import { showPill, hidePill } from './PlayPills.js'

const NEAR = 14
const FAR = 34
export const DIG_R = 1.6
const RANGE = 45 // past this, no signal at all
const BEEP_SLOW = 1.4 // seconds between beeps at RANGE
const BEEP_FAST = 0.1
export const DIG_COINS = [30, 90]
export const FINDS = ['healthpack', 'ammobox', 'catchTrap', 'zombieGoo', 'candy', 'helmet', 'boots']
const BARS = 5

export class MetalDetector {
  constructor(survival) {
    this.s = survival
    this.spot = null
    this._beepIn = 0
  }

  get holding() {
    const it = this.s.inv?.selected()
    return it?.kind === 'item' && it.id === 'metalDetector'
  }

  // Hides a new spot near (x, z). -> the spot, or null.
  hide(me = this.s.bodyPos()) {
    const s = this.s
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      if (s.camp?.inside(x, z, 2)) continue
      const y = s._groundUnder(x, me.y + 12, z)
      if (Math.abs(y - me.y) > 10 || s.bm._cellIsLiquid(Math.floor(x), Math.floor(y - 0.5), Math.floor(z))) continue
      this.spot = { x, y, z }
      return this.spot
    }
    return null
  }

  // 0 (nothing) .. 1 (right on it).
  signal(me = this.s.bodyPos()) {
    if (!this.spot) return 0
    const d = Math.hypot(this.spot.x - me.x, this.spot.z - me.z)
    return Math.max(0, 1 - d / RANGE)
  }

  // Used: dig if close enough, else a hint. -> true (never used up).
  use() {
    const s = this.s
    if (!s.active || s.dead) return true
    const me = s.bodyPos()
    if (!this.spot) this.hide(me)
    if (!this.spot) return true
    const d = Math.hypot(this.spot.x - me.x, this.spot.z - me.z)
    if (d > DIG_R || Math.abs(this.spot.y - me.y) > 2.5) {
      s._message(t(this.signal(me) > 0.75 ? 'detectorHot' : this.signal(me) > 0.4 ? 'detectorWarm' : 'detectorCold'), 2)
      return true
    }
    this._dig()
    return true
  }

  _dig() {
    const s = this.s
    const B = s.B
    const { x, y, z } = this.spot
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      s._fx?.spark(x * B, (y + 0.2) * B, z * B, { life: 0.8, from: 0.2, to: 0.08, gravity: 10, color: 0x6b4a2a, vel: { x: Math.cos(a) * 2 * B, y: 4 * B, z: Math.sin(a) * 2 * B } })
    }
    const [lo, hi] = DIG_COINS
    const before = s._coinsEarned
    s._earn(lo + Math.floor(Math.random() * (hi - lo + 1)))
    const coins = s._coinsEarned - before
    const id = FINDS[Math.floor(Math.random() * FINDS.length)]
    const lost = s.inv.add({ kind: 'item', id, n: 1 })
    if (lost) s._drops?.spawnItem(id, x, y + 1, z)
    s.stats.dug = (s.stats.dug || 0) + 1
    s._message(t('detectorDug', { coins, item: itemName(id) }), 4)
    try { audioEngine.playSpecial?.('detectorFound') } catch { /* no audio */ }
    s._renderHud()
    this.hide()
  }

  update(dt) {
    if (!this.holding || !this.s.active || this.s.dead) {
      hidePill('detector')
      return
    }
    if (!this.spot) this.hide()
    const sig = this.signal()
    const on = Math.round(sig * BARS)
    showPill('detector', `${t('detectorSignal')} ${'▮'.repeat(on)}${'▯'.repeat(BARS - on)}`)
    if (sig <= 0) return
    this._beepIn -= dt
    if (this._beepIn <= 0) {
      this._beepIn = BEEP_FAST + (BEEP_SLOW - BEEP_FAST) * (1 - sig) ** 2
      try { audioEngine.playSpecial?.('detectorBeep') } catch { /* no audio */ }
    }
  }

  clear() {
    this.spot = null
    hidePill('detector')
  }
}

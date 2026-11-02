// Camp sieges (2026-11-02, Gaymi's idea list 4: "Sometimes a big horde
// attacks your camp, and the traps and turrets you built there finally get
// a real job" - Gaymi picked "zombies break in"). Owned by BuildSurvival
// (`s.siege`) in your own games on a map with the walled camp (Map 3), not
// on a server.
//
// From wave FROM_WAVE, a wave has a CHANCE of bringing a siege (never two
// within GAP_WAVES waves), if you're within NEAR_CAMP blocks of the camp.
// While it lasts the camp stops being safe (BuildCamp.safe): zombies walk
// in, bite and nobody heals there. A horde of HORDE_BASE + HORDE_PER_WAVE x
// the wave siege zombies comes from all round the walls a few at a time,
// and goes for the camp's middle (for you once you're close). Your traps,
// turrets and the camp's guards (Survivors.js) fight them.
//
// Every siege zombie killed = it's held: COINS + COINS_PER_WAVE x the wave
// and BONUS_XP at the end of the game. BREAK_INS siege zombies reaching the
// middle, or LIMIT_S seconds running out = it's lost: the rest wander off
// and nothing else is lost. Either way the camp is safe again after.
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const FROM_WAVE = 4
export const CHANCE = 0.3
export const GAP_WAVES = 3
export const NEAR_CAMP = 120
export const HORDE_BASE = 10
export const HORDE_PER_WAVE = 2
export const HORDE_MAX = 40
export const COINS = 300
export const COINS_PER_WAVE = 25
export const BONUS_XP = 100
export const BREAK_INS = 5
export const LIMIT_S = 180
const SPAWN_EVERY = 0.5
const CORE_R = 3
const CHASE_R = 30

export class CampSiege {
  constructor(survival) {
    this.s = survival
    this.clear()
  }

  // A new game.
  clear() {
    this._end()
    this.active = false
    this.lastWave = -99
    this._bar?.remove()
    this._bar = null
  }

  get camp() {
    return this.s.camp
  }

  // The camp's middle, in blocks.
  center() {
    const zn = this.camp.zone
    const x = (zn.cx ?? (zn.x0 + zn.x1) / 2) + 0.5
    const z = (zn.cz ?? (zn.z0 + zn.z1) / 2) + 0.5
    return { x, z, y: this._y ?? (this._y = this.s._groundUnder(x, this.s.bodyPos().y + 20, z)) }
  }

  // A wave started: maybe a siege.
  onWave(n) {
    const s = this.s
    if (this.active || !this.camp || s.net || s.td || s.cfg.noZombies || n < FROM_WAVE || n - this.lastWave < GAP_WAVES) return false
    const me = s.bodyPos()
    const c = this.center()
    if (Math.hypot(me.x - c.x, me.z - c.z) > NEAR_CAMP) return false
    if (Math.random() >= CHANCE) return false
    return this.start()
  }

  start() {
    const s = this.s
    if (!this.camp || this.active) return false
    this._y = undefined
    this.active = true
    this.lastWave = s.wave
    this.camp.siege = true
    this.toSend = Math.min(HORDE_MAX, HORDE_BASE + HORDE_PER_WAVE * Math.max(1, s.wave))
    this.total = this.toSend
    this.killed = 0
    this.breakIns = 0
    this.left = LIMIT_S
    this._sendIn = 0
    this.zombies = new Set()
    s._message(t('siegeStart'), 6)
    try { audioEngine.playSpecial?.('bloodMoon') } catch { /* no audio */ }
    this._renderBar()
    return true
  }

  // Where a siege zombie goes: the camp's middle, unless you're close.
  target(zb, player) {
    if (!this.active || !zb.siege) return null
    const c = this.center()
    if (player && !player.idle && Math.hypot(player.x - zb.x, player.z - zb.z) < CHASE_R) return null
    return { x: c.x, y: c.y, z: c.z, idle: true }
  }

  // One died (BuildSurvival.damageZombie).
  onKilled(zb) {
    if (!this.active || !this.zombies.delete(zb)) return
    if (!zb.lost) this.killed++
    this._renderBar()
  }

  update(dt) {
    if (!this.active) return
    const s = this.s
    this.left -= dt
    // The horde comes in a few at a time, from all round the walls.
    if (this.toSend > 0 && (this._sendIn -= dt) <= 0) {
      this._sendIn = SPAWN_EVERY
      if (this._spawnOne()) this.toSend--
    }
    const c = this.center()
    for (const zb of this.zombies) {
      if (zb.health > 0 && Math.hypot(zb.x - c.x, zb.z - c.z) < CORE_R) {
        // Got to the middle: one break-in, and it's gone.
        this.breakIns++
        zb.lost = true
        zb.health = 0
        s._message(t('siegeBreakIn', { n: this.breakIns, max: BREAK_INS }), 3)
      }
    }
    if (this.breakIns >= BREAK_INS || this.left <= 0) this._finish(false)
    else if (this.toSend === 0 && this.zombies.size === 0) this._finish(true)
    else if (Math.floor(this.left + dt) !== Math.floor(this.left)) this._renderBar()
  }

  _spawnOne() {
    const s = this.s
    const zn = this.camp.zone
    const c = this.center()
    const half = Math.hypot(zn.x1 - zn.x0, zn.z1 - zn.z0) / 2
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      const d = half + 8 + Math.random() * 8
      const x = Math.floor(c.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(c.z + Math.sin(a) * d) + 0.5
      if (this.camp.inside(x, z, 2)) continue
      const y = s._groundUnder(x, c.y + 10, z)
      if (!Number.isFinite(y) || Math.abs(y - c.y) > 8 || s.bm._cellIsLiquid?.(Math.floor(x), Math.floor(y - 0.5), Math.floor(z))) continue
      const zb = s._extraZombie(x, y, z)
      if (!zb) continue
      zb.siege = true
      this.zombies.add(zb)
      return true
    }
    return false
  }

  _finish(won) {
    const s = this.s
    if (won) {
      const before = s._coinsEarned
      s._earn(COINS + COINS_PER_WAVE * (s.wave || 0))
      s._bonusXp = (s._bonusXp || 0) + BONUS_XP
      s.stats.sieges = (s.stats.sieges || 0) + 1
      s._message(t('siegeWon', { n: s._coinsEarned - before, xp: BONUS_XP }), 6)
      try { audioEngine.playSpecial?.('diamondZombie') } catch { /* no audio */ }
    } else s._message(t('siegeLost'), 6)
    this._end()
    s._renderHud()
  }

  // The camp is safe again: whatever's still inside (or still part of the
  // horde) wanders off.
  _end() {
    const s = this.s
    if (this.camp) this.camp.siege = false
    if (this.active) {
      for (const zb of s.zombies) {
        if (zb.siege || this.camp?.inside(zb.x, zb.z, 0.5)) {
          zb.lost = true
          zb.health = 0
        }
      }
    }
    this.active = false
    this.zombies?.clear()
    this.toSend = 0
    if (this._bar) this._bar.style.display = 'none'
  }

  _renderBar() {
    if (!this._bar) {
      this._bar = document.createElement('div')
      this._bar.id = 'siege-bar'
      this._bar.className = 'event-bar'
      document.body.appendChild(this._bar)
    }
    const left = Math.max(0, Math.ceil(this.left))
    this._bar.textContent = t('siegeBar', {
      n: this.zombies.size + this.toSend,
      time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
      b: this.breakIns,
      max: BREAK_INS,
    })
    this._bar.style.display = 'flex'
  }
}

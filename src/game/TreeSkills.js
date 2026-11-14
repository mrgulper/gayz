// Skill tree effects (2026-11-14, Batch 4b) - the Upgrades that react to
// what happens in a game rather than just changing a number at the start
// (those are PlayRules.js UPGRADE_PLAY). Owned by BuildSurvival as
// `s.skills`; it reads the ids in s.cfg.skills (bought in the Upgrades
// skill tree, MetaProgress.js) and BuildSurvival asks it about shots,
// bites, kills, chests and cleared waves.
import { t } from './i18n.js'

export const ARMOR_REFILL = 15
export const SHRUG_EVERY = 5
export const NOT_TODAY_HP = 25
export const REGEN_HP = 1
export const PATCH_UP_HP = 20
export const GIANT_KILLER = 0.3
export const FINISHER = 0.5
export const FINISHER_BELOW = 0.25
export const FIRST_STRIKE = 0.4
export const RANGE_BONUS = 0.35
export const CLOSE_R = 5
export const LONG_R = 15
export const ROLL_STEP = 5
export const ROLL_UP = 0.05
export const ROLL_MAX = 0.25
export const BRAWLER = 0.4
export const LAST_ROUNDS = 3
export const LAST_ROUNDS_UP = 0.4
export const RECYCLE_CHANCE = 0.2
export const HIT_AND_RUN = { up: 0.25, s: 3 }
export const SECOND_BREATH = { up: 0.35, s: 2 }
export const ADRENALINE = { up: 0.25, below: 0.3 }
export const DODGE_S = 1
export const BREAK_RUN = 0.2
export const INTEREST = { rate: 0.1, max: 100 }
export const STREAK_CASH = { every: 10, coins: 25 }
export const WAVE_PAY = 0.5
export const GOLDEN_TOUCH = 0.5
export const LUCKY_CHEST = 15
export const TIP_JAR = 20
export const SCROUNGER = 0.5
export const PACKED_LUNCH = 3
export const TRAP_KIT = 2

export class TreeSkills {
  constructor(survival) {
    this.s = survival
    this.on = new Set()
    this.reset()
  }

  // A new game: the bought ones, nothing used up yet.
  reset() {
    this.on = new Set(this.s.cfg?.skills || [])
    this._bites = 0
    this._savedOnce = false
    this._killBoost = 0
    this._hurtBoost = 0
    this._safeUntil = 0
    this._tipWave = -1
    this._speed = 1
  }

  has(id) {
    return this.on.has(id)
  }

  // --- the run starting (a new game, not a resumed one) ---

  giveStartItems() {
    const inv = this.s.inv
    if (!inv) return
    if (this.has('packedLunch')) inv.add({ kind: 'item', id: 'cookedMeat', n: PACKED_LUNCH })
    if (this.has('trapKit')) inv.add({ kind: 'block', id: 'beartrap', n: TRAP_KIT })
  }

  // --- shots ---

  // A shot's damage to zombie z, before it lands.
  shotDamage(z, amount, weapon) {
    let mult = 1
    const s = this.s
    if (this.has('giantKiller') && z.boss) mult += GIANT_KILLER
    const max = z.maxHealth || z.health
    if (this.has('finisher') && z.health < max * FINISHER_BELOW) mult += FINISHER
    if (this.has('firstStrike') && z.health >= max) mult += FIRST_STRIKE
    if (this.has('closeQuarters') || this.has('longShot')) {
      const p = s.bm.tryMode.pos
      const d = Math.hypot(z.x - p.x, z.z - p.z)
      if (this.has('closeQuarters') && d < CLOSE_R) mult += RANGE_BONUS
      if (this.has('longShot') && d > LONG_R) mult += RANGE_BONUS
    }
    if (this.has('onARoll')) mult += Math.min(ROLL_MAX, Math.floor((s.streak || 0) / ROLL_STEP) * ROLL_UP)
    if (this.has('brawler') && weapon?.melee) mult += BRAWLER
    // tryFire already took this shot's bullet, so fewer than LAST_ROUNDS
    // left means it was one of the last ones.
    if (this.has('lastRounds') && Number.isFinite(s.mag) && s.mag < LAST_ROUNDS) mult += LAST_ROUNDS_UP
    return amount * mult
  }

  // tryFire: true = this shot doesn't use a bullet.
  saveBullet() {
    return this.has('recycler') && Math.random() < RECYCLE_CHANCE
  }

  // --- getting hurt ---

  // Before a hit lands: true = nothing happens.
  blocksHit() {
    if (this.has('dodgeStep') && performance.now() < this._safeUntil) return true
    if (this.has('shrugOff')) {
      this._bites++
      if (this._bites % SHRUG_EVERY === 0) {
        this.s._message(t('skillShrugOff'), 1.5)
        return true
      }
    }
    return false
  }

  // A hit landed (and didn't kill you).
  onHurt() {
    const now = performance.now()
    if (this.has('dodgeStep')) this._safeUntil = now + DODGE_S * 1000
    if (this.has('secondBreath')) this._hurtBoost = SECOND_BREATH.s
  }

  // The hit would kill you: once a game, Not Today leaves you standing.
  cheatDeath() {
    if (!this.has('notToday') || this._savedOnce) return false
    this._savedOnce = true
    this.s.health = NOT_TODAY_HP
    this.s._message(t('skillNotToday'), 3)
    return true
  }

  // --- kills, chests, waves ---

  // One of my kills was counted. shine: the zombie's shine (gold...),
  // paid: the coins it paid before multipliers, bossCoins: a boss's own.
  onKill({ shine = null, paid = 0, boss = false, bossCoins = 0 } = {}) {
    const s = this.s
    if (this.has('hitAndRun')) this._killBoost = HIT_AND_RUN.s
    if (this.has('goldenTouch') && shine) s._earn(Math.round(paid * GOLDEN_TOUCH))
    if (this.has('bossBounty') && boss) s._earn(bossCoins)
    if (this.has('streakCash') && s.streak > 0 && s.streak % STREAK_CASH.every === 0) {
      s._earn(STREAK_CASH.coins)
      s._message(t('skillStreakCash', { n: s.streak }), 2)
    }
    if (this.has('tipJar') && this._tipWave !== s.wave) {
      this._tipWave = s.wave
      s._earn(TIP_JAR)
    }
  }

  // A loot chest was opened: its ammo, after Scrounger.
  chestAmmo(ammo) {
    if (this.has('luckyChest')) this.s._earn(LUCKY_CHEST)
    return this.has('scrounger') ? Math.round(ammo * (1 + SCROUNGER)) : ammo
  }

  // A wave was cleared (coinPerWave: what clearing it paid).
  onWaveCleared(coinPerWave) {
    const s = this.s
    if (this.has('wavePay')) s._earn(Math.round(coinPerWave * WAVE_PAY))
    if (this.has('interest')) {
      const n = Math.min(INTEREST.max, Math.floor(Math.max(0, s.coins) * INTEREST.rate))
      if (n > 0) {
        s.coins += n
        s._coinsEarned = (s._coinsEarned || 0) + n
      }
    }
    if (this.has('patchUp') && s.health > 0) s.health = Math.min(s.maxHealth, s.health + PATCH_UP_HP)
    if (this.has('armorRefill')) s.armor = Math.max(s.armor || 0, Math.min(s.cfg.armor, (s.armor || 0) + ARMOR_REFILL))
    if (this.has('restock') && Number.isFinite(s.reserve)) {
      const mag = s.magSize()
      if (Number.isFinite(mag)) s.reserve += mag
    }
  }

  // --- every frame ---

  // How much faster you move right now.
  speedMult() {
    return this._speed
  }

  update(dt) {
    const s = this.s
    // (Party and Infection games set your speed themselves.)
    if (!this.on.size || !s.active || s.dead || s.cfg?.noZombies) return
    if (this.has('regenerator') && s.health < s.maxHealth) {
      s.health = Math.min(s.maxHealth, s.health + REGEN_HP * dt)
    }
    this._killBoost = Math.max(0, this._killBoost - dt)
    this._hurtBoost = Math.max(0, this._hurtBoost - dt)
    let speed = 1
    if (this._killBoost > 0) speed += HIT_AND_RUN.up
    if (this._hurtBoost > 0) speed += SECOND_BREATH.up
    if (this.has('adrenaline') && s.health < s.maxHealth * ADRENALINE.below) speed += ADRENALINE.up
    if (this.has('breakRunner') && s.wave > 0 && s._toSpawn === 0 && s._breakTimer > 0) speed += BREAK_RUN
    if (speed !== this._speed) {
      this._speed = speed
      // RunPerks.applySpeed multiplies this in (or this game has no perks).
      if (s.perks) s.perks.applySpeed()
      else s.bm.tryMode.speedMult = (s.cfg?.moveMult ?? 1) * speed
    }
  }
}

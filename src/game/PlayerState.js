const MAX_HEALTH = 1000
const MAX_ARMOR = 100
const ARMOR_ABSORB_RATIO = 0.5
const INFECTION_DRAIN_PER_SEC = 3
const INFECTION_CHANCE_PER_HIT = 0.12
const INFECTION_MIN_HEALTH = 40 // infection alone can never finish the player off

export class PlayerState {
  constructor() {
    this.maxHealth = MAX_HEALTH
    this.maxArmor = MAX_ARMOR
    this.health = MAX_HEALTH
    this.armor = 0
    this.alive = true
    this.armorAbsorbRatio = ARMOR_ABSORB_RATIO
    this.infected = false
    // Run summary screen (see Game.js's _onPlayerDeath) - actual health
    // lost, after armor absorption, not the raw pre-absorption amount.
    this.totalDamageTaken = 0
  }

  takeDamage(amount) {
    if (!this.alive) return
    let remaining = amount
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * this.armorAbsorbRatio)
      this.armor -= absorbed
      remaining -= absorbed
    }
    this.health = Math.max(0, this.health - remaining)
    this.totalDamageTaken += remaining
    if (!this.infected && Math.random() < INFECTION_CHANCE_PER_HIT) this.infected = true
    if (this.health <= 0) this.alive = false
  }

  // Slow health drain while infected - stops just short of being lethal on
  // its own, since there's no counterplay to the tick beyond the HUD icon.
  tickInfection(dt) {
    if (!this.infected || !this.alive) return
    if (this.health <= INFECTION_MIN_HEALTH) return
    this.health = Math.max(INFECTION_MIN_HEALTH, this.health - INFECTION_DRAIN_PER_SEC * dt)
  }

  cureInfection() {
    this.infected = false
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount)
  }

  addArmor(amount) {
    this.armor = Math.min(this.maxArmor, this.armor + amount)
  }

  respawn() {
    this.health = this.maxHealth
    this.armor = 0
    this.alive = true
    this.armorAbsorbRatio = ARMOR_ABSORB_RATIO
    this.infected = false
    this.totalDamageTaken = 0
  }
}

const MAX_HEALTH = 500
const MAX_ARMOR = 100
const ARMOR_ABSORB_RATIO = 0.5

export class PlayerState {
  constructor() {
    this.maxHealth = MAX_HEALTH
    this.maxArmor = MAX_ARMOR
    this.health = MAX_HEALTH
    this.armor = 0
    this.alive = true
    this.armorAbsorbRatio = ARMOR_ABSORB_RATIO
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
    if (this.health <= 0) this.alive = false
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
  }
}

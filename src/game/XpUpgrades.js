import { getAutoWeaponUpgrades } from './AutoWeapons.js'

// Free passive buffs offered on every XP-gem level-up (see Game.js's
// _triggerXpLevelUp) - deliberately smaller and more frequent than the
// scrap-cost night perks in Perks.js, which stay the bigger periodic picks.
// Auto-attacking weapon unlocks (orbiting blade, homing shot) get appended
// to this same pool - see AutoWeapons.js's getAutoWeaponUpgrades.
export const XP_UPGRADE_DEFS = [
  {
    id: 'xp_move_speed',
    titleKey: 'xpUpgradeMoveSpeed',
    apply: (game) => {
      game.player.moveSpeed += 0.35
    },
  },
  {
    id: 'xp_max_health',
    titleKey: 'xpUpgradeMaxHealth',
    apply: (game) => {
      game.playerState.maxHealth += 15
      game.playerState.heal(15)
      game._updateHealthHud()
    },
  },
  {
    id: 'xp_damage',
    titleKey: 'xpUpgradeDamage',
    apply: (game) => {
      game.weapons.damageMult += 0.08
    },
  },
  {
    id: 'xp_stamina',
    titleKey: 'xpUpgradeStamina',
    apply: (game) => {
      game.player.maxStamina += 12
      game.player.stamina = game.player.maxStamina
    },
  },
  {
    id: 'xp_armor',
    titleKey: 'xpUpgradeArmor',
    apply: (game) => {
      game.playerState.armorAbsorbRatio = Math.min(0.9, game.playerState.armorAbsorbRatio + 0.05)
    },
  },
  // Tradeoff picks - real downsides, not just smaller upsides, so they read
  // as a build-defining choice rather than a free stat. `once: true` keeps
  // them from being picked repeatedly and spiraling a stat to nothing (see
  // rollXpUpgrades' filter, driven by game.xpPicked).
  {
    id: 'xp_glass_cannon',
    titleKey: 'xpUpgradeGlassCannon',
    once: true,
    apply: (game) => {
      game.weapons.damageMult += 0.4
      game.playerState.maxHealth = Math.max(20, game.playerState.maxHealth * 0.8)
      game.playerState.health = Math.min(game.playerState.health, game.playerState.maxHealth)
      game._updateHealthHud()
    },
  },
  {
    id: 'xp_berserker',
    titleKey: 'xpUpgradeBerserker',
    once: true,
    apply: (game) => {
      game.player.moveSpeed += 1.0
      game.player.maxStamina = Math.max(20, game.player.maxStamina - 20)
      game.player.stamina = Math.min(game.player.stamina, game.player.maxStamina)
    },
  },
  {
    id: 'xp_juggernaut',
    titleKey: 'xpUpgradeJuggernaut',
    once: true,
    apply: (game) => {
      game.playerState.armorAbsorbRatio = Math.min(0.9, game.playerState.armorAbsorbRatio + 0.15)
      game.player.moveSpeed = Math.max(1, game.player.moveSpeed - 0.6)
    },
  },
]

// Fisher-Yates-ish partial shuffle: picks `count` distinct upgrades at
// random (mirrors Perks.js's rollPerks). `once` upgrades already picked
// (see game.xpPicked) drop out of the pool so they can't be taken twice.
export function rollXpUpgrades(game, count = 3) {
  const staticDefs = XP_UPGRADE_DEFS.filter((d) => !d.once || !game.xpPicked.has(d.id))
  // Pure Gunplay mutator (see Game.js's settings.mutators) strips auto-weapons
  // out of the pool entirely, forcing a passive-only, manually-aimed build.
  const autoDefs = game.settings.mutators.pureGunplay ? [] : getAutoWeaponUpgrades(game.autoWeapons, game.xpPicked)
  const pool = [...staticDefs, ...autoDefs]
  const picked = []
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(i, 1)[0])
  }
  return picked
}

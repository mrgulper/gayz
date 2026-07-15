// Curated roguelike-style perk pool. Offered 3-at-a-time (see
// Game.js._openPerkPanel), each costs scrap earned from kills, and apply()
// mutates whatever live game object owns that stat - no separate perk state
// to track since the effect just lives on the object it boosted.
export const PERK_DEFS = [
  {
    id: 'fast_reload',
    titleKey: 'perkFastReload',
    cost: 30,
    apply: (game) => game.weapons.boostReloadSpeed(0.85),
  },
  {
    id: 'more_stamina',
    titleKey: 'perkMoreStamina',
    cost: 25,
    apply: (game) => {
      game.player.maxStamina += 25
      game.player.stamina = game.player.maxStamina
    },
  },
  {
    id: 'better_armor',
    titleKey: 'perkBetterArmor',
    cost: 35,
    apply: (game) => {
      game.playerState.armorAbsorbRatio = Math.min(0.9, game.playerState.armorAbsorbRatio + 0.12)
    },
  },
  {
    id: 'stronger_heals',
    titleKey: 'perkStrongerHeals',
    cost: 25,
    apply: (game) => {
      game.healthPackHealAmount += 60
    },
  },
  {
    id: 'sprint_boost',
    titleKey: 'perkSprintBoost',
    cost: 30,
    apply: (game) => {
      game.player.sprintMultiplier += 0.25
    },
  },
]

// Fisher-Yates-ish partial shuffle: picks `count` distinct perks at random.
export function rollPerks(count = 3) {
  const pool = [...PERK_DEFS]
  const picked = []
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length)
    picked.push(pool.splice(i, 1)[0])
  }
  return picked
}

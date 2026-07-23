// Curated roguelike-style perk pool. Offered 3-at-a-time (see
// Game.js._openPerkPanel), each costs points earned from kills, and apply()
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
  {
    id: 'dead_silence',
    titleKey: 'perkDeadSilence',
    cost: 35,
    apply: (game) => {
      game.zombies.aggroRadiusMult *= 0.5
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

// Rewards committing to a build direction instead of just buying whatever's
// cheapest each night - each fires once, the first time both of its
// `requires` perks have ever been purchased (see game.perksOwned, tracked
// in Game.js's perk-purchase click handler).
export const PERK_SYNERGIES = [
  {
    id: 'combat_reflexes',
    requires: ['fast_reload', 'sprint_boost'],
    titleKey: 'synergyCombatReflexes',
    apply: (game) => game.weapons.boostReloadSpeed(0.92),
  },
  {
    id: 'iron_resolve',
    requires: ['more_stamina', 'better_armor'],
    titleKey: 'synergyIronResolve',
    apply: (game) => {
      game.playerState.maxHealth += 20
      game.playerState.heal(20)
      game._updateHealthHud()
    },
  },
  {
    id: 'fortified',
    requires: ['stronger_heals', 'better_armor'],
    titleKey: 'synergyFortified',
    apply: (game) => {
      game.playerState.armorAbsorbRatio = Math.min(0.9, game.playerState.armorAbsorbRatio + 0.05)
    },
  },
]

// Returns the synergies that just newly unlocked (empty most of the time) -
// call after every perk purchase, see Game.js's _renderPerkOptions.
export function checkPerkSynergies(game) {
  const newlyUnlocked = []
  for (const syn of PERK_SYNERGIES) {
    if (game.perkSynergiesUnlocked.has(syn.id)) continue
    if (syn.requires.every((id) => game.perksOwned.has(id))) {
      game.perkSynergiesUnlocked.add(syn.id)
      syn.apply(game)
      newlyUnlocked.push(syn)
    }
  }
  return newlyUnlocked
}

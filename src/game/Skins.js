// Cosmetic pistol skins purchasable with scrap (see Game.js's skins shop) -
// visual only, no gameplay effect. 'gold' is also granted for free by the
// Centurion achievement, and 'obsidian' by completing the bestiary (see
// Achievements.js / Game.js's _onZombieKilled) - buying them here is only
// needed if that achievement/completion hasn't happened yet.
export const SKIN_DEFS = [
  { id: 'gold', titleKey: 'skinGold', cost: 40 },
  { id: 'crimson', titleKey: 'skinCrimson', cost: 40 },
  { id: 'cobalt', titleKey: 'skinCobalt', cost: 40 },
  { id: 'obsidian', titleKey: 'skinObsidian', cost: 40 },
]

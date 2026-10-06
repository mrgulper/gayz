// What the homepage's Game Mode panel and the Upgrades panel change in a
// Map 1 run (2026-10-06 - they came back after the old Map 1 was deleted).
// Game.js builds one config from the player's picks with playConfig() and
// hands it to BuildSurvival.start(); BuildSurvival and BuildCamp read
// only the fields below, so a new option is one entry here plus the line
// that reads it there. Runs started from the Map Editor's own Play button
// use PLAY_DEFAULTS (a sandbox: no picks, nothing saved).

// The Challenges & Mutators that have a block-city version. The others in
// that list stay hidden until they get one.
export const PLAY_MUTATORS = ['hordeRush', 'lootRush', 'healthRegen', 'glassHouse', 'ironMode', 'escalation', 'bossRush']

// Game Modes with a block-city version (Zombie Extraction is still Coming Soon).
export const PLAY_GAME_MODES = ['classic', 'zombieDefense', 'bossHunt', 'zombieRush']

// Zombie Defense: hold out this many waves to win.
export const DEFENSE_WAVES = 10
// Boss Hunt: a boss comes with every BOSS_HUNT_EVERY-th wave (Boss Rush: every wave).
export const BOSS_HUNT_EVERY = 3
export const BOSS_HEALTH_MULT = 8
export const BOSS_DAMAGE_MULT = 2
export const BOSS_SIZE = 1.35
export const BOSS_COINS = 100
// Zombie Rush: barely a breather between waves, zombies come twice as fast.
export const RUSH_WAVE_BREAK = 1
export const RUSH_SPAWN_GAP_MULT = 0.5
// Health Regen: after this long without getting hurt, heal this fast.
export const REGEN_DELAY = 5
export const REGEN_PER_SECOND = 3
// Standing in Map 1's camp heals you this fast (Fortified Rest adds to it).
export const CAMP_HEAL_PER_SECOND = 4

// Choose Class (the player's build).
export const LOADOUT_PLAY = {
  balanced: { moveMult: 1, healthMult: 1 },
  runner: { moveMult: 1.15, healthMult: 0.75 },
  tank: { moveMult: 0.9, healthMult: 1.35 },
}

// Upgrades panel (MetaProgress.js's META_UPGRADES, bought with Legacy
// Points) that do something in a Map 1 run. Only these are shown there.
export const UPGRADE_PLAY = {
  vitality: { health: 50 },
  plating: { armor: 25 },
  marksman: { damage: 0.1 },
  deadeye: { damage: 0.15 },
  quickhands: { reload: 0.2 },
  fortune: { coins: 30 },
  ironwill: { health: 15, armor: 15 },
  juggernaut: { health: 30, armor: 20 },
  fortifiedRest: { campHeal: 0.5 },
  traderDiscount: { discount: 0.15 },
  coin_damage: { damage: 0.1 },
  coin_health: { health: 25 },
  cache_resolve: { health: 15 },
  cache_fortune: { damage: 0.08 },
}

// Legacy Points for a run: this share of its points (DEATH_POINTS_CONVERSION
// in MetaProgress.js), points being these per kill / wave survived.
export const POINTS_PER_KILL = 10
export const POINTS_PER_WAVE = 50

export const PLAY_DEFAULTS = {
  mode: 'classic',
  maxHealth: 100,
  armor: 0,
  moveMult: 1,
  damageMult: 1,
  reloadMult: 1,
  startCoins: 0,
  coinMult: 1,
  zombieHealthMult: 1,
  zombieDamageMult: 1,
  zombieCountMult: 1,
  escalation: false,
  regen: false,
  ironMode: false,
  bossEvery: 0,
  campHealRate: CAMP_HEAL_PER_SECOND,
  discount: 0,
  mutators: [],
}

// difficulty: a DIFFICULTY_PRESETS entry (Game.js); purchased: a Set of
// upgrade ids.
export function playConfig({ difficulty, loadout, gameMode, mutators = {}, purchased = new Set() }) {
  const cfg = { ...PLAY_DEFAULTS }
  const on = PLAY_MUTATORS.filter((m) => mutators[m])
  cfg.mutators = on
  cfg.mode = PLAY_GAME_MODES.includes(gameMode) ? gameMode : 'classic'
  if (difficulty) {
    cfg.zombieHealthMult = difficulty.healthMult
    cfg.zombieDamageMult = difficulty.damageMult
    cfg.zombieCountMult = difficulty.spawnRateMult
  }
  const build = LOADOUT_PLAY[loadout] || LOADOUT_PLAY.balanced
  cfg.moveMult = build.moveMult
  let health = 0
  let damage = 0
  let reload = 0
  let campHeal = 0
  for (const id of purchased) {
    const up = UPGRADE_PLAY[id]
    if (!up) continue
    health += up.health || 0
    cfg.armor += up.armor || 0
    damage += up.damage || 0
    reload += up.reload || 0
    cfg.startCoins += up.coins || 0
    campHeal += up.campHeal || 0
    cfg.discount = Math.max(cfg.discount, up.discount || 0)
  }
  cfg.maxHealth = Math.round(PLAY_DEFAULTS.maxHealth * build.healthMult) + health
  cfg.damageMult = 1 + damage
  cfg.reloadMult = Math.max(0.3, 1 - reload)
  cfg.campHealRate = CAMP_HEAL_PER_SECOND * (1 + campHeal)
  if (on.includes('hordeRush')) cfg.zombieCountMult *= 2
  if (on.includes('lootRush')) cfg.coinMult = 2
  if (on.includes('healthRegen')) cfg.regen = true
  if (on.includes('glassHouse')) {
    cfg.damageMult *= 2
    cfg.zombieDamageMult *= 2
  }
  if (on.includes('ironMode')) cfg.ironMode = true
  if (on.includes('escalation')) cfg.escalation = true
  if (on.includes('bossRush')) cfg.bossEvery = 1
  else if (cfg.mode === 'bossHunt') cfg.bossEvery = BOSS_HUNT_EVERY
  return cfg
}

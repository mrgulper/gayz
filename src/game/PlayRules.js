// What the homepage's Game Mode panel and the Upgrades panel change in a
// Map 1 run (2026-10-06 - they came back after the old Map 1 was deleted).
// Game.js builds one config from the player's picks with playConfig() and
// hands it to BuildSurvival.start(); BuildSurvival and BuildCamp read
// only the fields below, so a new option is one entry here plus the line
// that reads it there. Runs started from the Map Editor's own Play button
// use PLAY_DEFAULTS (a sandbox: no picks, nothing saved).

// Every standing mob - zombies, skeletons, your own body, other players,
// camp NPCs and any mob added later - is drawn exactly this many blocks
// tall (bloxd.io's size, 2026-10-17).
export const MOB_HEIGHT = 2

// The Challenges & Mutators that have a block-city version. The others in
// that list stay hidden until they get one.
export const PLAY_MUTATORS = ['hordeRush', 'lootRush', 'healthRegen', 'glassHouse', 'ironMode', 'escalation', 'bossRush']

// Game Modes with a block-city version.
// worldMap (2026-10-18): pick a real place on Earth and survive in land
// shaped like the real world (SpawnMap.js, OpenWorld's Earth mode).
// infection (2026-10-31, Infection.js): tag - zombies turn humans, last human wins.
// shrinkingZone (2026-11-01, ShrinkZone.js): the waves inside a closing ring.
export const PLAY_GAME_MODES = ['classic', 'zombieDefense', 'bossHunt', 'zombieRush', 'zombieExtraction', 'worldMap', 'infection', 'shrinkingZone']
// Game Modes with no zombies at all (2026-10-26, Gaymi: "make world map
// not spawn zombies ... make world map just a gamemode with the world
// map"): you just explore the real Earth.
export const NO_ZOMBIE_MODES = ['worldMap', 'infection']
// Its achievement, Globetrotter: a World Map run this long (seconds).
export const GLOBETROTTER_SECONDS = 600

// Zombie Defense: hold out this many waves to win.
export const DEFENSE_WAVES = 10
// Zombie Extraction (2026-10-10, "make all of these game modes work"):
// a helicopter lands somewhere in the city, EXTRACTION_MIN..MAX blocks of
// walking away; stand within EXTRACTION_RADIUS of it for EXTRACTION_HOLD
// seconds (the waves keep coming) to win.
// Helicopter Escape (the same mode, upgraded 2026-10-31, HeliFuel.js): it
// no longer waits for wave 5 - find FUEL_CANS fuel cans
// FUEL_MIN..FUEL_MAX blocks of walking away (about FUEL_GAP apart, picked
// up within FUEL_REACH), then the helicopter flies in over HELI_FLY_IN
// seconds, and after the hold you ride it up for HELI_TAKE_OFF seconds.
export const FUEL_CANS = 3
export const FUEL_MIN = 15
export const FUEL_MAX = 70
export const FUEL_GAP = 18
export const FUEL_REACH = 1.8
export const HELI_FLY_IN = 6
export const HELI_TAKE_OFF = 4
// Shrinking Zone (ShrinkZone.js): each circle's radius (blocks) and how
// long it holds (seconds) before shrinking to the next over ZONE_SHRINK_S;
// outside it zombies run ZONE_ZOMBIE_SPEED times as fast. Lasting out the
// last hold wins (about 5 and a half minutes in all).
export const ZONE_STAGES = [
  { r: 100, hold: 45 },
  { r: 70, hold: 40 },
  { r: 45, hold: 35 },
  { r: 28, hold: 30 },
  { r: 15, hold: 30 },
  { r: 7, hold: 45 },
]
export const ZONE_SHRINK_S = 20
export const ZONE_ZOMBIE_SPEED = 1.7
// Skeletons (real animated 3D models, SkeletonModels.js) join the waves
// from this wave on, each spawn with SKELETON_CHANCE (BuildSurvival).
export const SKELETON_FROM_WAVE = 3
// Zombies never appear closer than this many blocks to any player
// (2026-10-23, Gaymi: "must be at least 20-30+ blocks apart from you").
export const SPAWN_MIN_DIST = 30
export const SKELETON_CHANCE = 0.3
// The pixel-art monster zombies (ZombieKinds.js: hunched, blob, beast,
// crawler, brute, bloater, skinny - not the spider since 2026-10-26) join from this wave on, each
// spawn with MONSTER_CHANCE. From the first wave and about half of all
// spawns since 2026-10-26 (Gaymi: "dont make them human shape").
// A broken leaf block drops a leaf block this often (2026-10-26, Gaymi;
// every time since 2026-10-30: "make the leaf block chance 100%").
export const LEAF_DROP_CHANCE = 1
export const MONSTER_FROM_WAVE = 1
export const MONSTER_CHANCE = 0.5
export const EXTRACTION_HOLD = 10
export const EXTRACTION_RADIUS = 3
export const EXTRACTION_MIN = 25
export const EXTRACTION_MAX = 60
// Boss Hunt: a boss comes with every BOSS_HUNT_EVERY-th wave (Boss Rush: every wave).
export const BOSS_HUNT_EVERY = 3
export const BOSS_HEALTH_MULT = 8
export const BOSS_DAMAGE_MULT = 2
export const BOSS_SIZE = 1.35
export const BOSS_COINS = 100
// On a server: an assist (hurting a zombie someone else finished, by at
// least ASSIST_MIN_HURT of its health) pays ASSIST_SHARE of the kill's coins.
export const ASSIST_SHARE = 0.25
export const ASSIST_MIN_HURT = 0.1
// Zombie Rush: barely a breather between waves, zombies come twice as fast.
export const RUSH_WAVE_BREAK = 1
export const RUSH_SPAWN_GAP_MULT = 0.5
// Health Regen: after this long without getting hurt, heal this fast.
export const REGEN_DELAY = 5
export const REGEN_PER_SECOND = 3
// Standing in Map 1's camp heals you this fast (Fortified Rest adds to it).
export const CAMP_HEAL_PER_SECOND = 4

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
  // More upgrades for Zombie Survival (2026-10-10, "add more upgrades you
  // can add in gayz upgrades for zombie survival").
  swiftfoot: { speed: 0.1 },
  sprinter: { speed: 0.1 },
  scavenger: { coinBonus: 0.25 },
  treasureHunter: { coinBonus: 0.25 },
  warChest: { coins: 60 },
  secondWind: { regen: true },
  ammoBelt: { ammo: 0.5 },
  bandolier: { ammo: 0.5 },
  headhunter: { headshot: 0.25 },
  thickSkin: { toughness: 0.1 },
  fieldMedic: { campHeal: 0.5 },
  lastStand: { health: 40, armor: 20 },
  kevlar: { armor: 25 },
  berserker: { damage: 0.15 },
  speedLoader: { reload: 0.15 },
  marathoner: { speed: 0.1 },
  goldRush: { coinBonus: 0.25 },
  bankroll: { coins: 100 },
  ammoHoarder: { ammo: 0.5 },
  sharpEye: { headshot: 0.25 },
  hardenedHide: { toughness: 0.1 },
  haggler: { discount: 0.25 },
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
  ammoMult: 1,
  headshotMult: 1,
  mutators: [],
}

// difficulty: a DIFFICULTY_PRESETS entry (Game.js); purchased: a Set of
// upgrade ids.
export function playConfig({ difficulty, gameMode, mutators = {}, purchased = new Set() }) {
  const cfg = { ...PLAY_DEFAULTS }
  const on = PLAY_MUTATORS.filter((m) => mutators[m])
  cfg.mutators = on
  cfg.mode = PLAY_GAME_MODES.includes(gameMode) ? gameMode : 'classic'
  cfg.noZombies = NO_ZOMBIE_MODES.includes(cfg.mode)
  if (difficulty) {
    cfg.zombieHealthMult = difficulty.healthMult
    cfg.zombieDamageMult = difficulty.damageMult
    cfg.zombieCountMult = difficulty.spawnRateMult
  }
  cfg.moveMult = 1
  let health = 0
  let damage = 0
  let reload = 0
  let campHeal = 0
  let speed = 0
  let coinBonus = 0
  let toughness = 0
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
    speed += up.speed || 0
    coinBonus += up.coinBonus || 0
    cfg.ammoMult += up.ammo || 0
    cfg.headshotMult += up.headshot || 0
    toughness += up.toughness || 0
    if (up.regen) cfg.regen = true
  }
  cfg.moveMult *= 1 + speed
  cfg.coinMult += coinBonus
  cfg.maxHealth = PLAY_DEFAULTS.maxHealth + health
  cfg.damageMult = 1 + damage
  cfg.reloadMult = Math.max(0.3, 1 - reload)
  cfg.campHealRate = CAMP_HEAL_PER_SECOND * (1 + campHeal)
  if (on.includes('hordeRush')) cfg.zombieCountMult *= 2
  if (on.includes('lootRush')) cfg.coinMult *= 2
  if (on.includes('healthRegen')) cfg.regen = true
  if (on.includes('glassHouse')) {
    cfg.damageMult *= 2
    cfg.zombieDamageMult *= 2
  }
  cfg.zombieDamageMult *= Math.max(0.5, 1 - toughness)
  if (on.includes('ironMode')) cfg.ironMode = true
  if (on.includes('escalation')) cfg.escalation = true
  if (on.includes('bossRush')) cfg.bossEvery = 1
  else if (cfg.mode === 'bossHunt') cfg.bossEvery = BOSS_HUNT_EVERY
  return cfg
}

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildWorld, WORLD_CULL_DISTANCE, WORLD_SHADOW_CULL_DISTANCE } from './World.js'
import { PlayerController } from './PlayerController.js'
import { WeaponSystem } from './WeaponSystem.js'
import { ZombieManager } from './ZombieManager.js'
import { PickupManager } from './Pickups.js'
import { PlayerState } from './PlayerState.js'
import { Inventory } from './Inventory.js'
import { DayNightCycle } from './DayNightCycle.js'
import { ChestManager, Vault } from './Chests.js'
import { RivalManager } from './RivalScavenger.js'
import { loadMastery, saveMastery, MASTERY_THRESHOLD, MASTERY_DAMAGE_MULT } from './WeaponMastery.js'
import { BarricadeWindows, REPAIR_REWARD_POINTS } from './BarricadeWindows.js'
import { Minimap } from './Minimap.js'
import { DecalManager } from './Decals.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { rollPerks, checkPerkSynergies } from './Perks.js'
import { rollXpUpgrades } from './XpUpgrades.js'
import { XpGemManager } from './XpGems.js'
import { AutoWeaponManager } from './AutoWeapons.js'
import { COIN_SHOP_ITEMS, ATTACHMENT_TYPES } from './CoinShop.js'
import { pickNightEvent } from './NightEvents.js'
import { Companion } from './Companion.js'
import { PlayerBody } from './PlayerBody.js'
import { Vehicle } from './Vehicle.js'
import { META_UPGRADES, loadMetaProgress, saveMetaProgress, DEATH_POINTS_CONVERSION } from './MetaProgress.js'
import { pickBounty } from './BountyBoard.js'
import { ZOMBIE_TYPES } from './ZombieTypes.js'
import { RescueSurvivor } from './RescueSurvivor.js'
import { loadEncountered, saveEncountered } from './Bestiary.js'
import { ACTIONS, getKeyFor, setBinding, resetBindings, keyLabel } from './Keybinds.js'
import { audioEngine } from './Audio.js'
import { LANGUAGES, setLanguage, t, tHtml } from './i18n.js'
import { setColorblind } from './Accessibility.js'

// Companion flavor barks - plain English rather than full i18n, since these
// are throwaway personality lines, not core UI text.
const COMPANION_BARKS = {
  lowHealth: ["You're bleeding out, use a health pack!", 'Stay with me!', "That doesn't look good.", 'Heal up, now!'],
  killStreak: ['Nice shooting!', "You're on fire tonight!", 'Keep it up!', 'Not bad.'],
  nightStart: ['Stay sharp out there.', 'Here we go again.', 'Eyes open.', "Let's not die tonight."],
  companionDown: ["I'm down, help!", 'Get them off me!', "I can't get up!", 'Revive me, quick!'],
  bossSpawn: ["Something big just showed up!", "That's not a regular one - watch yourself!", 'Big target, incoming!', "We've got a boss on us!"],
}

const PICKUP_LABELS = {
  health: (label, isLoot, count = 1) =>
    count > 1 ? t('toastHealthAddedCount', { count }) : t('toastHealthAdded'),
  armor: () => t('toastArmorAdded'),
  ammo: (label, isLoot, count) => {
    if (isLoot) return t('toastAmmoScavenged')
    if (count && count > 1) return t('toastAmmoCratesCollected', { count })
    return t('toastAmmoCrateCollected')
  },
  minigun: () => t('toastMinigunAcquired'),
  battery: () => t('toastBatteryAdded'),
  noisemaker: () => t('toastNoisemakerAdded'),
  grenade: () => t('toastGrenadeAdded'),
  scope: () => t('toastScopeAdded'),
  fuelcan: () => t('toastFuelCanAdded'),
  extended_mag: () => t('toastMagAdded'),
  melee_bat: () => t('toastBatAdded'),
  melee_machete: () => t('toastMacheteAdded'),
  melee_uvbaton: () => t('toastUvBatonAdded'),
}

// Starting stat tradeoffs, picked once on the main menu and applied a
// single time when a fresh run begins (see the playBtn click handler) -
// not reapplied on respawn, same as XP upgrades/perks.
const LOADOUT_PRESETS = {
  balanced: { moveSpeedDelta: 0, maxHealthMult: 1, maxStaminaDelta: 0 },
  runner: { moveSpeedDelta: 1.2, maxHealthMult: 0.75, maxStaminaDelta: 15 },
  tank: { moveSpeedDelta: -0.8, maxHealthMult: 1.35, maxStaminaDelta: -10 },
}

const DIFFICULTY_PRESETS = {
  easy: { damageMult: 0.7, spawnRateMult: 0.75 },
  normal: { damageMult: 1, spawnRateMult: 1 },
  hard: { damageMult: 1.4, spawnRateMult: 1.3 },
  // Unlocked by the "Ground Truth" (true_ending) achievement - see the
  // diff-nightmare visibility toggle right after Achievements loads.
  nightmare: { damageMult: 1.8, spawnRateMult: 1.6 },
}

const SETTINGS_STORAGE_KEY = 'gayz-settings'

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      language: parsed.language || 'en',
      musicVolume: parsed.musicVolume ?? 100,
      sfxVolume: parsed.sfxVolume ?? 100,
      difficulty: DIFFICULTY_PRESETS[parsed.difficulty] ? parsed.difficulty : 'normal',
      sensitivity: parsed.sensitivity ?? 100,
      fov: parsed.fov ?? 75,
      colorblind: parsed.colorblind ?? false,
      performanceMode: parsed.performanceMode ?? false,
      nickname: parsed.nickname || '',
      defaultTag: parsed.defaultTag || null,
      companionRole: ['melee', 'medic'].includes(parsed.companionRole) ? parsed.companionRole : 'ranged',
      scoreAttackMode: parsed.scoreAttackMode ?? false,
      hardcoreMode: parsed.hardcoreMode ?? false,
      loadout: LOADOUT_PRESETS[parsed.loadout] ? parsed.loadout : 'balanced',
      // 5-slot hotbar (see Game.js's _bindHotbar) - a weapon id per slot,
      // or null for empty. Defaults match the request this was built for:
      // melee/AK-47/M1911 filled in, two open slots for whatever's bought.
      hotbar: Array.isArray(parsed.hotbar) && parsed.hotbar.length === 5 ? parsed.hotbar : ['melee', 'rifle', 'pistol', null, null],
      mutators: {
        hordeRush: parsed.mutators?.hordeRush ?? false,
        lootRush: parsed.mutators?.lootRush ?? false,
        pureGunplay: parsed.mutators?.pureGunplay ?? false,
        bossRush: parsed.mutators?.bossRush ?? false,
        hordeMode: parsed.mutators?.hordeMode ?? false,
        kingOfTheHill: parsed.mutators?.kingOfTheHill ?? false,
        extraction: parsed.mutators?.extraction ?? false,
        dailyChallenge: parsed.mutators?.dailyChallenge ?? false,
      },
    }
  } catch {
    return { language: 'en', musicVolume: 100, sfxVolume: 100, difficulty: 'normal', sensitivity: 100, fov: 75, colorblind: false, nickname: '', defaultTag: null, companionRole: 'ranged', scoreAttackMode: false, hardcoreMode: false, loadout: 'balanced', performanceMode: false, hotbar: ['melee', 'rifle', 'pistol', null, null], mutators: { hordeRush: false, lootRush: false, pureGunplay: false, bossRush: false, hordeMode: false, kingOfTheHill: false, extraction: false, dailyChallenge: false } }
  }
}

const SCORE_ATTACK_NIGHT_DURATION_MS = 60000
const ROUND_INTERMISSION_MS = 5000
const SCORE_ATTACK_BEST_KEY = 'gayz-score-attack-best'

function loadScoreAttackBest() {
  try {
    return Number(localStorage.getItem(SCORE_ATTACK_BEST_KEY)) || 0
  } catch {
    return 0
  }
}

function saveScoreAttackBest(score) {
  try {
    localStorage.setItem(SCORE_ATTACK_BEST_KEY, String(score))
  } catch {
    // Storage unavailable - best score just won't persist.
  }
}

// Daily Challenge: today's local date hashes to one of these twists so the
// run is deterministic and replayable within the same day - no server, so
// "daily" just means fixed-for-today rather than a shared cross-player seed.
const DAILY_TWISTS = [
  { nameKey: 'dailyTwistSwarm', spawnMult: 2.2, damageMult: 1, forceHardcore: false },
  { nameKey: 'dailyTwistGlassCannon', spawnMult: 1, damageMult: 1.6, forceHardcore: false },
  { nameKey: 'dailyTwistLockdown', spawnMult: 1.3, damageMult: 1, forceHardcore: true },
]

function _todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function _dailyTwistIndex(dateStr) {
  let hash = 0
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) | 0
  return Math.abs(hash) % DAILY_TWISTS.length
}

const DAILY_BEST_KEY = 'gayz-daily-best'

function loadDailyBest() {
  try {
    const raw = localStorage.getItem(DAILY_BEST_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.date === _todayDateStr()) return parsed
    return { date: _todayDateStr(), score: 0 }
  } catch {
    return { date: _todayDateStr(), score: 0 }
  }
}

function saveDailyBest(best) {
  try {
    localStorage.setItem(DAILY_BEST_KEY, JSON.stringify(best))
  } catch {
    // Storage unavailable - best score just won't persist.
  }
}

const ENDING_SEEN_KEY = 'gayz-ending-seen'

function loadEndingSeen() {
  try {
    return localStorage.getItem(ENDING_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

function saveEndingSeen() {
  try {
    localStorage.setItem(ENDING_SEEN_KEY, 'true')
  } catch {
    // Storage unavailable - the ending just might show again next time.
  }
}

const ENDING_MILESTONE_NIGHT = 10

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (e.g. private browsing) - setting just won't persist.
  }
}

const BEST_STATS_KEY = 'gayz-best-stats'

function loadBestStats() {
  try {
    const raw = localStorage.getItem(BEST_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { bestNight: parsed.bestNight || 0, bestKills: parsed.bestKills || 0 }
  } catch {
    return { bestNight: 0, bestKills: 0 }
  }
}

function saveBestStats(stats) {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - best stats just won't persist across sessions.
  }
}

// Points/coins and everything bought with them (skins, Shop stat perks) used
// to be purely in-run state that reset on every page reload, same as
// health/inventory/kills. Split out into its own persisted slice so the
// currency balance and anything already owned survive a reload, without
// touching the rest of the run-state reset behavior on death/respawn.
const SHOP_PROGRESS_KEY = 'gayz-shop-progress'
const COIN_SHOP_GUN_IDS = new Set(COIN_SHOP_ITEMS.filter((i) => i.gun).map((i) => i.gun))

function loadShopProgress() {
  try {
    const raw = localStorage.getItem(SHOP_PROGRESS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      points: parsed.points || 0,
      coins: parsed.coins || 0,
      ownedSkins: new Set(parsed.ownedSkins || []),
      equippedSkin: parsed.equippedSkin || null,
      shopPurchased: new Set(parsed.shopPurchased || []),
      // Coin Shop gun purchases (minigun/awp/glock18/weatie) - previously
      // never saved, so a bought gun's `unlocked` flag (pure in-memory
      // WeaponSystem state) vanished on the next page load even though the
      // coins were already spent. Restored via WeaponSystem.markUnlocked
      // right after the weapons instance is built (see the constructor).
      unlockedGuns: parsed.unlockedGuns || [],
      // Per-gun Coin Shop attachments (see CoinShop.js's ATTACHMENT_TYPES) -
      // "weaponId:attachmentId" strings, restored via
      // WeaponSystem.applyAttachment right after unlockedGuns in the
      // constructor.
      attachments: parsed.attachments || [],
    }
  } catch {
    return { points: 0, coins: 0, ownedSkins: new Set(), equippedSkin: null, shopPurchased: new Set(), unlockedGuns: [], attachments: [] }
  }
}

function saveShopProgress(game) {
  try {
    localStorage.setItem(SHOP_PROGRESS_KEY, JSON.stringify({
      points: game.points,
      coins: game.coins,
      ownedSkins: [...game.ownedSkins],
      equippedSkin: game.equippedSkin,
      shopPurchased: [...game.coinShopPurchased],
      unlockedGuns: game.weapons.weapons.filter((w) => w.unlocked && COIN_SHOP_GUN_IDS.has(w.id)).map((w) => w.id),
      attachments: game.weapons.weapons.flatMap((w) => {
        const ids = []
        if (w.scopeOwned && w.id !== 'awp') ids.push(`${w.id}:scope`)
        if (w.hasExtMag) ids.push(`${w.id}:extmag`)
        if (w.suppressed) ids.push(`${w.id}:suppressor`)
        return ids
      }),
    }))
  } catch {
    // Storage unavailable - shop progress just won't persist across sessions.
  }
}

const NIGHT_DURATION_MS = 90000
const FLASHLIGHT_DRAIN_PER_SEC = 1.5
const GENERATOR_DRAIN_PER_SEC = 100 / 150
const GENERATOR_REFUEL_RADIUS = 2.5
const GENERATOR_PASSIVE_REFUEL_PER_SEC = 6
const GENERATOR_FUELCAN_AMOUNT = 35
const VAULT_REWARD_POINTS = 150
const TROPHY_WALL_INTERACT_RADIUS = 2.4
const TRADER_INTERACT_RADIUS = 2.5
const AMMO_STATION_RADIUS = 2.2
const AMMO_STATION_HOLD_SECONDS = 10
const BREAKER_BOX_RADIUS = 2.0
const BREAKER_BOX_HOLD_SECONDS = 6
const LIGHT_LURE_RADIUS = 20
const LIGHT_LURE_INTERVAL_MS = 2000
const SAFE_ZONE_HEAL_PER_SEC = 6
const LIGHT_LURE_ENRAGE_MS = 2500
const VEHICLE_INTERACT_RADIUS = 3
const VIREO_TERMINAL_RADIUS = 2.5
const STATION_ENCOUNTER_RADIUS = 8
const STATION_ENCOUNTER_ZOMBIE_COUNT = 4
const PERK_REROLL_COST = 15
const COMBO_WINDOW_MS = 3000
const COMBO_MIN_DISPLAY = 2
// Left 4 Dead-style "Director" - re-scores the player's situation every
// DIRECTOR_EVAL_INTERVAL_MS and hands ZombieManager a multiplier on top of
// its normal night-based curve, instead of pressure being a flat per-night
// ramp regardless of how the run is actually going. See _updateDirectorAI.
const DIRECTOR_EVAL_INTERVAL_MS = 5000
const DIRECTOR_MIN_MULT = 0.6
const DIRECTOR_MAX_MULT = 1.35
const DIRECTOR_KILL_WINDOW_MS = 30000
const ADRENALINE_DURATION_MS = 8000
const ADRENALINE_SPEED_MULT = 1.5
const ADRENALINE_FIRE_RATE_MULT = 1.4
const DEATH_CAM_MS = 900
const KILLCAM_DURATION_MS = 1000
const KILLCAM_SLOWMO_FACTOR = 0.2
const KILLCAM_ZOOM_FOV_MULT = 0.75
const COMPASS_HALF_FOV = Math.PI / 3
const BARRICADE_LIFETIME_MS = 25000
const BARRICADE_PLACE_DIST = 2.2
const BARRICADE_W = 2.2
const BARRICADE_H = 1.8
const BARRICADE_D = 0.3
const TRAP_PLACE_DIST = 1.8
const TRAP_TRIGGER_RADIUS = 1.3
const TRAP_BLAST_RADIUS = 3
const TRAP_DAMAGE_MIN = 45
const TRAP_DAMAGE_MAX = 90
const TRAP_LIFETIME_MS = 30000
// Rubble left behind by a kill - a small chance per kill so a long fight in
// one spot gradually clutters the battlefield with real obstacles (blocks
// both the player and other zombies, same as a barricade) instead of every
// corpse just fading away with nothing left in its place. Capped and
// time-limited so a long night doesn't permanently choke off a chokepoint.
const OBSTACLE_DROP_CHANCE = 0.18
const OBSTACLE_LIFETIME_MS = 20000
const OBSTACLE_MAX_COUNT = 12
// Ambient world hazards (see NightEvents.js's toxic_gas/emp_field) - zones
// the player has to notice and route around, not a tool they chose to use
// (that's the EMP grenade, a separate system in ZombieManager.js).
const HAZARD_RADIUS = 5
const HAZARD_TICK_MS = 700
const HAZARD_GAS_DAMAGE_PER_TICK = 8
const HAZARD_GAS_DURATION_MS = 22000
const HAZARD_EMP_DURATION_MS = 18000
const HAZARD_EMP_BATTERY_DRAIN_PER_SEC = 30
const VEHICLE_RAM_MIN_SPEED = 4
const VEHICLE_RAM_RADIUS = 2.6
const VEHICLE_RAM_DAMAGE = 70
const VEHICLE_RAM_COOLDOWN_MS = 500
const LIGHTNING_MIN_DELAY_MS = 8000
const LIGHTNING_DELAY_RANGE_MS = 12000
const LIGHTNING_FLINCH_RADIUS = 18
const LIGHTNING_FLINCH_MS = 1200
const FOG_PATCH_MIN_DELAY_MS = 40000
const FOG_PATCH_MAX_DELAY_MS = 90000
const FOG_PATCH_DURATION_MS = 25000
const FOG_PATCH_RADIUS = 16
const FOG_PATCH_MULT = 0.32
const FOG_PATCH_SPAWN_RADIUS = 34
const AIRDROP_MIN_DELAY_MS = 70000
const AIRDROP_MAX_DELAY_MS = 130000
// Ambient world-building, not tied to any system - a fragment of an old
// broadcast surfaces every so often, same lore-toast + radio-static cue as
// finding a collectible audio log (see audioEngine.playAudioLog), just
// passive instead of something you had to find.
const RADIO_CHATTER_KEYS = ['radioChatter1', 'radioChatter2', 'radioChatter3', 'radioChatter4', 'radioChatter5', 'radioChatter6', 'radioChatter7', 'radioChatter8']
const RADIO_CHATTER_MIN_DELAY_MS = 75000
const RADIO_CHATTER_MAX_DELAY_MS = 140000
const AIRDROP_WINDOW_MS = 75000
const RIVAL_SQUAD_CHANCE = 0.4
const AIRDROP_SPAWN_RADIUS = 30
const AIRDROP_CLAIM_RADIUS = 2
const AIRDROP_REST_Y = 1.1
const AIRDROP_FALL_HEIGHT = 16
const AIRDROP_FALL_DURATION_MS = 2200
const BOSS_TIER_IDS = new Set(['colossus', 'titan'])
const WHEEL_RADIUS = 110
const WHEEL_DEADZONE = 18
const RESCUE_INTERACT_RADIUS = 2.5
const RESCUE_POINTS_REWARD = 25
const RECRUIT_INTERACT_RADIUS = 2.5
// Fixed roles rather than random - each recruit spot is a reason to visit
// both underground station offices (see buildUndergroundStation), not just
// duplicate whatever role the player already picked for their main companion.
const RECRUIT_ROLES = ['melee', 'medic']

// King of the Hill mutator: hold the marked zone to fill the capture bar,
// then it pays out and relocates to keep the fight moving. Spots are fixed,
// hand-picked points along the open avenue - clear of the safe zone
// (x:[-20,-6], z:[-17,-3]), the generator (1.5, 5), the four barricade
// windows, and the trader/ammo station (-8, 33) / (8, -33).
const KOTH_RADIUS = 4
const KOTH_CAPTURE_SECONDS = 12
const KOTH_DECAY_SECONDS = 6
const KOTH_CAPTURE_POINTS = 60
const KOTH_CAPTURE_COINS = 40
const KOTH_SPAWN_SURGE = 2
const KOTH_SPOTS = [
  { x: 0, z: -25 },
  { x: 0, z: 20 },
  { x: 14, z: 6 },
  { x: -2, z: -30 },
]

// Extraction mutator: a one-time win condition instead of a repeating
// capture. The hold timer only counts up while the player is standing in
// the LZ (stepping out pauses it, doesn't drain it - the chopper just
// waits) and zombie pressure escalates near the LZ the longer it takes.
const EXTRACTION_RADIUS = 4
const EXTRACTION_HOLD_SECONDS = 45
const EXTRACTION_SURGE_INTERVAL_MS = 8000
const EXTRACTION_SURGE_SIZE = 2
const EXTRACTION_POINTS_BONUS = 300
const EXTRACTION_COINS_BONUS = 150
const EXTRACTION_SPOT = { x: 8, z: -8 }

const SHOP_ITEMS = [
  { id: 'health', cost: 15, titleKey: 'shopHealthPack', give: (game) => game.inventory.addHealthPack(1) },
  { id: 'armor', cost: 18, titleKey: 'shopArmorPack', give: (game) => game.inventory.addArmorPack(1) },
  { id: 'grenade', cost: 20, titleKey: 'shopGrenade', give: (game) => game.inventory.addGrenade(1) },
  { id: 'fuelcan', cost: 10, titleKey: 'shopFuelCan', give: (game) => game.inventory.addFuelCan(1) },
  { id: 'noisemaker', cost: 8, titleKey: 'shopNoisemaker', give: (game) => game.inventory.addNoisemaker(1) },
  { id: 'barricade', cost: 25, titleKey: 'shopBarricade', give: (game) => game.inventory.addBarricade(1) },
  { id: 'trap', cost: 20, titleKey: 'shopTrap', give: (game) => game.inventory.addTrap(1) },
  { id: 'molotov', cost: 28, titleKey: 'shopMolotov', give: (game) => game.inventory.addMolotov(1) },
  { id: 'c4', cost: 40, titleKey: 'shopC4', give: (game) => game.inventory.addC4(1) },
  { id: 'adrenaline', cost: 22, titleKey: 'shopAdrenaline', give: (game) => game.inventory.addAdrenaline(1) },
  { id: 'emp', cost: 26, titleKey: 'shopEmp', give: (game) => game.inventory.addEmp(1) },
  {
    id: 'train_companion',
    cost: 30,
    titleKey: 'shopTrainCompanion',
    give: (game) => {
      game.companionTrainingLevel += 1
      game.companion.applyTraining(game.companionTrainingLevel)
    },
  },
  // Companion gear: one-time equip per slot (see Companion.js's hasVest/
  // hasRig guards) - a visible model change plus a stat bonus, stacking
  // with training rather than replacing it.
  {
    id: 'companion_vest',
    cost: 40,
    titleKey: 'shopCompanionVest',
    isOwned: (game) => game.companionGear.vest,
    give: (game) => {
      game.companionGear.vest = true
      game.companion.equipVest()
    },
  },
  {
    id: 'companion_rig',
    cost: 45,
    titleKey: 'shopCompanionRig',
    isOwned: (game) => game.companionGear.rig,
    give: (game) => {
      game.companionGear.rig = true
      game.companion.equipRig()
    },
  },
  // Attachments - same effect as finding the equivalent loot pickup, just
  // guaranteed instead of RNG. Extended Mag stacks each purchase; Scope is a
  // harmless no-op if bought again.
  {
    id: 'craft_extended_mag',
    cost: 35,
    titleKey: 'shopExtendedMag',
    give: (game) => game.weapons.addMagBonus(game.weapons.current.id === 'minigun' ? 50 : 10),
  },
  { id: 'craft_scope', cost: 30, titleKey: 'shopScope', give: (game) => game.weapons.attachScope('rifle') },
]

// Salvage: the inverse of SHOP_ITEMS - convert consumables sitting unused in
// the inventory back into points at a fraction of their buy price, so a
// player who over-bought molotovs and never threw them (or is about to die
// with a full pack) isn't stuck holding dead value. Sell price is derived
// from the matching SHOP_ITEMS cost rather than a second hardcoded number,
// so the two never drift out of sync.
const SALVAGE_RATE = 0.4
function salvageValue(shopId) {
  return Math.max(1, Math.round(SHOP_ITEMS.find((i) => i.id === shopId).cost * SALVAGE_RATE))
}
const SALVAGE_ITEMS = [
  { id: 'health', invKey: 'healthPacks', titleKey: 'shopHealthPack', sellValue: salvageValue('health'), sell: (game) => game.inventory.useHealthPack() },
  { id: 'armor', invKey: 'armorPacks', titleKey: 'shopArmorPack', sellValue: salvageValue('armor'), sell: (game) => game.inventory.useArmorPack() },
  { id: 'grenade', invKey: 'grenades', titleKey: 'shopGrenade', sellValue: salvageValue('grenade'), sell: (game) => game.inventory.useGrenade() },
  { id: 'fuelcan', invKey: 'fuelCans', titleKey: 'shopFuelCan', sellValue: salvageValue('fuelcan'), sell: (game) => game.inventory.useFuelCan() },
  { id: 'noisemaker', invKey: 'noisemakers', titleKey: 'shopNoisemaker', sellValue: salvageValue('noisemaker'), sell: (game) => game.inventory.useNoisemaker() },
  { id: 'barricade', invKey: 'barricades', titleKey: 'shopBarricade', sellValue: salvageValue('barricade'), sell: (game) => game.inventory.useBarricade() },
  { id: 'trap', invKey: 'traps', titleKey: 'shopTrap', sellValue: salvageValue('trap'), sell: (game) => game.inventory.useTrap() },
  { id: 'molotov', invKey: 'molotovs', titleKey: 'shopMolotov', sellValue: salvageValue('molotov'), sell: (game) => game.inventory.useMolotov() },
  { id: 'c4', invKey: 'c4', titleKey: 'shopC4', sellValue: salvageValue('c4'), sell: (game) => game.inventory.useC4() },
  { id: 'adrenaline', invKey: 'adrenaline', titleKey: 'shopAdrenaline', sellValue: salvageValue('adrenaline'), sell: (game) => game.inventory.useAdrenaline() },
  { id: 'emp', invKey: 'emp', titleKey: 'shopEmp', sellValue: salvageValue('emp'), sell: (game) => game.inventory.useEmp() },
]

// Hidden Trader tier, only shown once Achievements.js's 'centurion' (100
// kills, see _onZombieKilled) has ever been unlocked - a permanent,
// localStorage-persisted flag, so once earned it stays open on every future
// run too, not just the one where it was earned. Exclusive items only
// available here: a guaranteed legendary weapon part (elsewhere only a rare
// loot roll or the Vault's one-time reward), a bulk ammo cache, and a
// bigger-than-normal permanent mag bonus.
const BLACK_MARKET_ITEMS = [
  {
    id: 'bm_legendary',
    cost: 150,
    titleKey: 'shopBmLegendary',
    give: (game) => {
      const weaponId = game.weapons.randomUnlockedWeaponId()
      const w = weaponId && game.weapons.weapons.find((w) => w.id === weaponId)
      const boosted = w && game.weapons.applyRarityBoost(weaponId, 1.3, 'legendary')
      game._showLoreToast(boosted ? t('toastLegendaryWeapon', { weapon: t(game.weapons._nameKeyFor(w)) }) : t('toastRarityWasted'))
    },
  },
  {
    id: 'bm_ammo_cache',
    cost: 45,
    titleKey: 'shopBmAmmoCache',
    give: (game) => game.weapons.addAmmoToCurrent(Math.round(game.weapons.current.magSize * 2)),
  },
  {
    id: 'bm_mega_mag',
    cost: 70,
    titleKey: 'shopBmMegaMag',
    give: (game) => game.weapons.addMagBonus(game.weapons.current.id === 'minigun' ? 100 : 20),
  },
]

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('scene')
    this.menu = document.getElementById('menu')
    this.playBtn = document.getElementById('play-btn')
    this.crosshair = document.getElementById('crosshair')
    this.hudEl = document.getElementById('hud')
    this.hotbarEl = document.getElementById('hotbar')
    this.hotbarSlotEls = Array.from(this.hotbarEl.querySelectorAll('.hotbar-slot'))
    this.statusHud = document.getElementById('status-hud')
    this.healthFill = document.getElementById('health-fill')
    this.healthValue = document.getElementById('health-value')
    this.armorFill = document.getElementById('armor-fill')
    this.armorValue = document.getElementById('armor-value')
    this.damageFlash = document.getElementById('damage-flash')
    this.pickupToast = document.getElementById('pickup-toast')
    this.deathScreen = document.getElementById('death-screen')
    this.respawnBtn = document.getElementById('respawn-btn')
    this.inventoryHud = document.getElementById('inventory-hud')
    this.healthPackCount = document.getElementById('health-pack-count')
    this.armorPackCount = document.getElementById('armor-pack-count')
    this.noisemakerCount = document.getElementById('noisemaker-count')
    this.grenadeCount = document.getElementById('grenade-count')
    this.barricadeCount = document.getElementById('barricade-count')
    this.trapCount = document.getElementById('trap-count')
    this.molotovCount = document.getElementById('molotov-count')
    this.c4Count = document.getElementById('c4-count')
    this.adrenalineCount = document.getElementById('adrenaline-count')
    this.empCount = document.getElementById('emp-count')
    this.inventoryPanel = document.getElementById('inventory-panel')
    this.panelHealthCount = document.getElementById('panel-health-count')
    this.panelArmorCount = document.getElementById('panel-armor-count')
    this.panelNoisemakerCount = document.getElementById('panel-noisemaker-count')
    this.panelGrenadeCount = document.getElementById('panel-grenade-count')
    this.panelBarricadeCount = document.getElementById('panel-barricade-count')
    this.panelTrapCount = document.getElementById('panel-trap-count')
    this.panelMolotovCount = document.getElementById('panel-molotov-count')
    this.panelC4Count = document.getElementById('panel-c4-count')
    this.panelAdrenalineCount = document.getElementById('panel-adrenaline-count')
    this.panelEmpCount = document.getElementById('panel-emp-count')
    this.panelWeaponsList = document.getElementById('panel-weapons-list')
    // Delegated once (not re-bound on every _refreshInventoryPanel render,
    // since that rebuilds the row HTML from scratch) - reads which weapon/
    // slot the clicked button belongs to off its own data attributes.
    this.panelWeaponsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.hotbar-assign-btn')
      if (!btn || btn.disabled) return
      this._assignHotbarSlot(Number(btn.dataset.slot), btn.dataset.weapon)
    })
    this.inventoryOpen = false
    this.staminaFill = document.getElementById('stamina-fill')
    this.batteryFill = document.getElementById('battery-fill')
    this.staminaValue = document.getElementById('stamina-value')
    this.progressHud = document.getElementById('progress-hud')
    this.nightValueEl = document.getElementById('night-value')
    this.timeValueEl = document.getElementById('time-value')
    this.killsValueEl = document.getElementById('kills-value')
    this.nightBanner = document.getElementById('night-banner')
    this.comboCounter = document.getElementById('combo-counter')
    this.weaponWheel = document.getElementById('weapon-wheel')
    this.weaponWheelRing = document.getElementById('weapon-wheel-ring')
    this.weaponWheelCursor = document.getElementById('weapon-wheel-cursor')
    this.weaponWheelOpen = false
    this._wheelCursorX = 0
    this._wheelCursorY = 0
    this._wheelHighlightIndex = -1
    this._wheelSegments = []
    this.compassStrip = document.getElementById('compass-strip')
    this.compassTrader = document.getElementById('compass-trader')
    this.compassAmmo = document.getElementById('compass-ammo')
    this.compassVehicle = document.getElementById('compass-vehicle')
    this.compassAirdrop = document.getElementById('compass-airdrop')
    this.compassSubway = document.getElementById('compass-subway')
    this.comboCount = 0
    this.comboResetAt = 0
    this.deathStats = document.getElementById('death-stats')
    this.deathLegacyPoints = document.getElementById('death-legacy-points')
    this.deathScoreAttack = document.getElementById('death-score-attack')
    this.deathDaily = document.getElementById('death-daily')
    this.endingPanel = document.getElementById('ending-panel')
    this.endingText = document.getElementById('ending-text')
    this.endingCredits = document.getElementById('ending-credits')
    this.endingContinueBtn = document.getElementById('ending-continue-btn')
    this.interactPrompt = document.getElementById('interact-prompt')
    this.ammoStationProgressWrap = document.getElementById('ammo-station-progress-wrap')
    this.ammoStationFill = document.getElementById('ammo-station-fill')
    this.breakerBoxProgressWrap = document.getElementById('breaker-box-progress-wrap')
    this.breakerBoxFill = document.getElementById('breaker-box-fill')
    this.rainOverlayEl = document.getElementById('rain-overlay')
    this.lightningFlashEl = document.getElementById('lightning-flash')
    this.nextLightningAt = 0
    this.fogPatch = null
    this.nextFogPatchAt = performance.now() + FOG_PATCH_MIN_DELAY_MS + Math.random() * (FOG_PATCH_MAX_DELAY_MS - FOG_PATCH_MIN_DELAY_MS)
    // Distinct from NightEvents.js's 'supply_drop' event (which just quietly
    // adds a permanent extra chest) - this one is a marked, timed beacon you
    // have to actually reach before it's gone.
    this.airdrop = null
    this.nextAirdropAt = performance.now() + AIRDROP_MIN_DELAY_MS + Math.random() * (AIRDROP_MAX_DELAY_MS - AIRDROP_MIN_DELAY_MS)
    this.nextRadioChatterAt = performance.now() + RADIO_CHATTER_MIN_DELAY_MS + Math.random() * (RADIO_CHATTER_MAX_DELAY_MS - RADIO_CHATTER_MIN_DELAY_MS)
    this.lastRadioChatterIndex = -1
    this.nightmareOverlayEl = document.getElementById('nightmare-overlay')
    this.infectionIndicator = document.getElementById('infection-indicator')
    this.statsPanel = document.getElementById('stats-panel')
    this.phaseRow = document.getElementById('phase-row')
    this.phaseLabel = document.getElementById('phase-label')
    this.phaseTime = document.getElementById('phase-time')
    this.statsDay = document.getElementById('stats-day')
    this.statsDeaths = document.getElementById('stats-deaths')
    this.statsKills = document.getElementById('stats-kills')
    this.minimapWrap = document.getElementById('minimap-wrap')
    this.minimapCanvas = document.getElementById('minimap')
    this.menuBestStats = document.getElementById('menu-best-stats')
    this.difficultyBtns = document.querySelectorAll('.difficulty-btn')
    this.roleBtns = document.querySelectorAll('.role-btn')
    this.loadoutBtns = document.querySelectorAll('.loadout-btn')
    this.settingsBtn = document.getElementById('settings-btn')
    this.settingsPanel = document.getElementById('settings-panel')
    this.languageGrid = document.getElementById('language-grid')
    this.musicVolumeSlider = document.getElementById('music-volume')
    this.musicVolumeValue = document.getElementById('music-volume-value')
    this.sfxVolumeSlider = document.getElementById('sfx-volume')
    this.sfxVolumeValue = document.getElementById('sfx-volume-value')
    this.sensitivitySlider = document.getElementById('sensitivity-slider')
    this.sensitivityValue = document.getElementById('sensitivity-value')
    this.fovSlider = document.getElementById('fov-slider')
    this.fovValue = document.getElementById('fov-value')
    this.colorblindToggle = document.getElementById('colorblind-toggle')
    this.performanceToggle = document.getElementById('performance-toggle')
    this.nicknameInput = document.getElementById('nickname-input')
    this.scoreAttackToggle = document.getElementById('score-attack-toggle')
    this.hardcoreToggle = document.getElementById('hardcore-toggle')
    this.mutatorHordeRush = document.getElementById('mutator-horde-rush')
    this.mutatorLootRush = document.getElementById('mutator-loot-rush')
    this.mutatorPureGunplay = document.getElementById('mutator-pure-gunplay')
    this.mutatorBossRush = document.getElementById('mutator-boss-rush')
    this.mutatorHordeMode = document.getElementById('mutator-horde-mode')
    this.mutatorKoth = document.getElementById('mutator-koth')
    this.mutatorExtraction = document.getElementById('mutator-extraction')
    this.mutatorDaily = document.getElementById('mutator-daily')
    this.controlsGrid = document.getElementById('controls-grid')
    this.resetBindsBtn = document.getElementById('reset-binds-btn')
    this.rebindingAction = null
    this.settingsOpen = false
    this.settings = loadSettings()
    setLanguage(this.settings.language)
    this.difficulty = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal
    this.nightDurationMs = this.settings.scoreAttackMode ? SCORE_ATTACK_NIGHT_DURATION_MS : NIGHT_DURATION_MS
    this.scoreAttackBest = loadScoreAttackBest()
    this.endingSeen = loadEndingSeen()
    this.bestStats = loadBestStats()
    this.dailyBest = loadDailyBest()
    this.dailyChallengeActive = false
    this.dailyDamageMult = 1
    this.dailyTwist = null

    this.night = 1
    this.kills = 0
    this.totalKills = 0
    this.totalDeaths = 0
    // Director AI signals - see _updateDirectorAI. lastHitTakenAt starts at
    // "now" rather than 0 so a fresh run doesn't read as "25+ seconds since
    // last hit" (i.e. immediately eligible to ramp up) before the player
    // has even taken a first step.
    this.lastHitTakenAt = performance.now()
    this.recentKillTimestamps = []
    this.nextDirectorEvalAt = 0
    this._hordeAnnounced = false
    this.adrenalineExpiresAt = 0
    this.shopProgress = loadShopProgress()
    this.points = this.shopProgress.points
    this.healthPackHealAmount = 200
    this.perkPanelOpen = false
    this.xp = 0
    this.xpLevel = 1
    this.xpToNext = this._xpForLevel(this.xpLevel)
    this.xpLevelupPanelOpen = false
    this.xpPicked = new Set()
    this.stealthTakedowns = 0
    this.eliteKills = 0
    this.companionTrainingLevel = 0
    this.companionGear = { vest: false, rig: false }
    this.perksOwned = new Set()
    this.perkSynergiesUnlocked = new Set()
    this.tempCompanion = null
    this.tempCompanionExpiresAtNight = 0
    this.coins = this.shopProgress.coins
    this.coinShopPurchased = this.shopProgress.shopPurchased
    this._shakeOffset = new THREE.Vector3()
    this._shakeMagnitude = 0
    this._shakeDuration = 0
    this._shakeTime = 0
    this._hitstopUntil = 0
    this.killcamUntil = 0
    this.musicIntensityCurrent = 0
    this.runStartedAt = performance.now()
    this.nightStartedAt = performance.now()
    this.roundIntermissionUntil = 0
    this._scheduleNightEvent()
    this._rollWeather()
    this._rollFeaturedItem()
    this._rollTraderPrices()

    // No preserveDrawingBuffer: it disables a fast path in most browsers and
    // isn't actually needed - _takeScreenshot() renders and reads the canvas
    // in the same synchronous call, before any buffer swap/clear can happen.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Cinematic contrast/rolloff instead of the flat default - the single
    // biggest free visual-quality win available (no extra render cost).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200)

    // Third-person view: this.camera stays the actual PointerLockControls
    // target (everything in the codebase reads its position as "the
    // player"), so a second, separate camera renders from an offset behind
    // it instead - see _updateThirdPerson. Not added to the scene graph;
    // its transform is copied fresh every frame.
    this.thirdPerson = false
    this.tpCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200)
    this._tpOffsetLocal = new THREE.Vector3(0, 1.1, 3.0)
    this._tpDesiredPos = new THREE.Vector3()
    this._tpYawQuat = new THREE.Quaternion()
    this._tpRayDir = new THREE.Vector3()
    this._tpRaycaster = new THREE.Raycaster()
    this._traderRaycaster = new THREE.Raycaster()

    // Post-processing: render pass -> bloom (makes practical lights - street
    // lamps, muzzle flash, headlights, neon signage - actually glow instead
    // of just being bright flat shapes) -> output pass (applies the tone
    // mapping/color space conversion above, required as the final pass when
    // using a composer instead of the renderer's direct render() call).
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.4, 0.82)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())

    const { colliders, solidMeshes, flickerLights, spawnPoints, hemiLight, sunLight, towerChestSpots, minigunSpot, generator, trader, ammoStation, vireoFacility, undergroundStation, subwayEntrance, safeZone, practiceTargets, trophyWall, cullables, supermarket, groceryStore, hospital, pharmacy, hardwareStore, gunShop, policeStation, militaryCheckpoint, prison, university, skyscraper, megaMall, warehouse, gasStation, bank, diner, radioStation, fireStation, motel, newUndergroundEntrance, maintenanceTunnel } = buildWorld(this.scene, ACHIEVEMENTS.length)
    this.cullables = cullables
    this.supermarket = supermarket
    this.groceryStore = groceryStore
    this.hospital = hospital
    this.pharmacy = pharmacy
    this.hardwareStore = hardwareStore
    this.gunShop = gunShop
    this.policeStation = policeStation
    this.militaryCheckpoint = militaryCheckpoint
    this.prison = prison
    this.university = university
    this.skyscraper = skyscraper
    this.megaMall = megaMall
    this.warehouse = warehouse
    this.gasStation = gasStation
    this.bank = bank
    this.diner = diner
    this.radioStation = radioStation
    this.fireStation = fireStation
    this.motel = motel
    this.newUndergroundEntrance = newUndergroundEntrance
    // Stage 10 continuation - the tunnel content behind that entrance.
    // The turnstile is a physical gate, not a free-interact lockedCells
    // door: it only opens once the breaker box's power-restore puzzle
    // succeeds (see _restoreTunnelPower), so it's registered here by hand
    // rather than added to the lockedCells array/loop below.
    this.maintenanceTunnel = maintenanceTunnel
    this.breakerBox = maintenanceTunnel.breakerBox
    this.nearBreakerBox = false
    this.breakerBoxHoldProgress = 0
    this.breakerBoxKeyHeld = false
    this.tunnelPowerOn = false
    this.turnstile = maintenanceTunnel.turnstile
    this.turnstile.locked = true
    // colliders/solidMeshes here are the local destructured arrays from
    // buildWorld() above (this.colliders/this.solidMeshes aren't assigned
    // until further down this constructor) - pushing onto them now is safe
    // since they're the same array objects by reference either way.
    colliders.push(this.turnstile.box)
    solidMeshes.push(this.turnstile.mesh)
    // Extended Metropolitan Grid usability pass - none of Stages 1-9's new
    // locations showed up on the compass/minimap at all, the biggest real
    // gap once the map got this spread out (the skyscraper alone is 250
    // units from the safe zone). Compass markers are created here rather
    // than hand-authored in index.html like compass-trader/compass-ammo -
    // 12 near-identical elements would be a lot of markup to maintain by
    // hand for what's really one repeated pattern.
    this.newLocationLandmarks = [
      { label: 'Supermarket', x: supermarket.x, z: supermarket.z },
      { label: 'Grocery', x: groceryStore.x, z: groceryStore.z },
      { label: 'Hospital', x: hospital.x, z: hospital.z },
      { label: 'Pharmacy', x: pharmacy.x, z: pharmacy.z },
      { label: 'Hardware', x: hardwareStore.x, z: hardwareStore.z },
      { label: 'Gun Shop', x: gunShop.x, z: gunShop.z },
      { label: 'Police', x: policeStation.x, z: policeStation.z },
      { label: 'Checkpoint', x: militaryCheckpoint.x, z: militaryCheckpoint.z },
      { label: 'Prison', x: prison.x, z: prison.z },
      { label: 'Campus', x: university.x, z: university.z },
      { label: 'Skyscraper', x: skyscraper.x, z: skyscraper.z },
      { label: 'Mega-Mall', x: megaMall.x, z: megaMall.z },
      { label: 'Warehouse', x: warehouse.x, z: warehouse.z },
      { label: 'Gas Station', x: gasStation.x, z: gasStation.z },
      { label: 'Bank', x: bank.x, z: bank.z },
      { label: 'Diner', x: diner.x, z: diner.z },
      { label: 'Radio Station', x: radioStation.x, z: radioStation.z },
      { label: 'Fire Station', x: fireStation.x, z: fireStation.z },
      { label: 'Motel', x: motel.x, z: motel.z },
    ]
    for (const lm of this.newLocationLandmarks) {
      const el = document.createElement('div')
      el.className = 'compass-marker'
      el.style.display = 'none'
      el.style.color = '#b39cff'
      el.textContent = lm.label
      this.compassStrip.appendChild(el)
      lm.el = el
    }
    // Kept for _deployBarricade - both PlayerController and ZombieManager
    // hold this exact same array by reference (not a copy), so pushing a
    // new collider here is immediately respected by both without needing
    // to reconstruct anything.
    this.colliders = colliders
    this.solidMeshes = solidMeshes
    // Stage 4's "reinforced entry" - each entry starts locked (a real
    // collider blocking the doorway, pushed into colliders/solidMeshes
    // above, not just a closed-looking mesh) until the player interacts
    // with it in range. Same dynamic-collider-removal pattern as
    // _removeDeathObstacle - splice the box back out on unlock instead of
    // rebuilding the whole colliders array.
    this.lockedCells = [policeStation.cellDoor, ...prison.cellDoors, skyscraper.bunkerDoor, gunShop.caseDoor, warehouse.cageDoor, bank.vaultDoor, radioStation.broadcastDoor, fireStation.equipDoor]
    for (const cell of this.lockedCells) {
      cell.locked = true
      this.colliders.push(cell.box)
      this.solidMeshes.push(cell.mesh)
    }
    this.nearLockedCell = null
    this.trophyWall = trophyWall
    this.barricades = []
    this.hazardZones = []
    this.deathObstacles = []

    this.kothActive = false
    this.kothZone = { x: KOTH_SPOTS[0].x, z: KOTH_SPOTS[0].z }
    this.kothProgress = 0
    const kothMarkerMat = new THREE.MeshStandardMaterial({
      color: 0x3a2f10,
      emissive: 0xffcf5c,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
    this.kothMarker = new THREE.Mesh(new THREE.RingGeometry(KOTH_RADIUS - 0.2, KOTH_RADIUS, 32), kothMarkerMat)
    this.kothMarker.rotation.x = -Math.PI / 2
    this.kothMarker.position.set(this.kothZone.x, 0.06, this.kothZone.z)
    this.kothMarker.visible = false
    this.scene.add(this.kothMarker)

    this.extractionActive = false
    this.extractionProgress = 0
    this.extractionNextSurgeAt = 0
    const extractionMarkerMat = new THREE.MeshStandardMaterial({
      color: 0x0f3a2a,
      emissive: 0x6fe08a,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
    this.extractionMarker = new THREE.Mesh(new THREE.RingGeometry(EXTRACTION_RADIUS - 0.2, EXTRACTION_RADIUS, 32), extractionMarkerMat)
    this.extractionMarker.rotation.x = -Math.PI / 2
    this.extractionMarker.position.set(EXTRACTION_SPOT.x, 0.06, EXTRACTION_SPOT.z)
    this.extractionMarker.visible = false
    this.scene.add(this.extractionMarker)
    this.practiceTargets = practiceTargets
    this.traps = []
    this._vehicleHitAt = new Map()
    this.flickerLights = flickerLights
    this.minigunSpot = minigunSpot
    this.generator = generator
    this.spawnPoints = spawnPoints
    this.generatorFuel = 100
    this.maxGeneratorFuel = 100
    this.trader = trader
    this.ammoStation = ammoStation
    this.nearAmmoStation = false
    this.ammoStationHoldProgress = 0
    this.ammoStationKeyHeld = false
    this.vireoTerminal = vireoFacility.terminalSpot
    this.subwayEntrance = subwayEntrance
    this.activeBounty = null
    this.nearVireoTerminal = false
    this.vireoGuardian = null
    this.stationTerminal = undergroundStation.terminalSpot
    this.nearStationTerminal = false
    this.stationEncounterCenter = undergroundStation.encounterCenter
    this.stationEncounterTriggered = false
    this.rescueSurvivor = null
    this.nearRescueSurvivor = false
    // Permanent squad additions (unlike tempCompanion, which leaves at dawn)
    // - one fixed recruit per underground station office, reusing
    // RescueSurvivor's stationary-NPC visual for the marker since it needs
    // no combat/movement behavior until actually recruited.
    // Ground-level spots only (Companion/RescueSurvivor never update their
    // own Y after spawn - confirmed neither class touches position.y in its
    // update loop - so anything placed underground would stay pinned there
    // even after the player and the recruit both walk back to the surface).
    this.recruits = []
    this.recruitSpots = [
      { x: -3, z: -36, role: RECRUIT_ROLES[0] },
      { x: 3, z: 28, role: RECRUIT_ROLES[1] },
    ]
    for (const spot of this.recruitSpots) {
      spot.marker = new RescueSurvivor(this.scene, spot.x, spot.z)
    }
    this.nearRecruitSpot = null
    this.bestiaryEncountered = loadEncountered()
    this.traderPanelOpen = false
    this.nearTrader = false
    this.dayNight = new DayNightCycle(this.scene, hemiLight, sunLight)

    this.player = new PlayerController(this.camera, this.canvas, colliders, solidMeshes)
    this.scene.add(this.player.controls.object)

    this._addFlashlight()

    this.zombies = new ZombieManager(this.scene, this.difficulty.spawnRateMult, colliders, solidMeshes)
    // Zombies must never be able to stand inside the safe zone - the wall
    // colliders alone don't cover this since the entrance gap has no
    // collider (the player needs to walk through it too), so ZombieManager
    // clamps every zombie's position back out to the radius every frame
    // instead (see its update loop). Assigned as soon as safeZone exists
    // rather than in the constructor, since ZombieManager has no other
    // reason to know about it and this keeps its constructor signature
    // unchanged.
    this.zombies.safeZone = safeZone
    // Fixed chokepoints spread along the avenue, clear of the generator
    // (1.5, 5), trader (-8, 33), and ammo station (8, -33).
    this.barricadeWindows = new BarricadeWindows(this.scene, [
      { x: 10, z: -20, rotY: -Math.PI / 2 },
      { x: -10, z: -2, rotY: Math.PI / 2 },
      { x: 10, z: 12, rotY: -Math.PI / 2 },
      { x: -10, z: 30, rotY: Math.PI / 2 },
    ])
    this.nearBarricadeWindow = null
    this.safeZone = safeZone
    // Stationary defenders (see Companion.js) - each guard.update() call
    // below passes the guard's own position as "playerPos" so its
    // follow-the-player movement never triggers, only its zombie-targeting/
    // firing logic, which works off whatever `zombies` list is passed in
    // regardless of who's "following" who.
    this.safeZoneGuards = safeZone.guardSpots.map((spot) => {
      const guard = new Companion(this.scene, spot.x, spot.z, 'ranged', { vulnerable: false })
      guard.setName('Guard')
      return guard
    })
    // Static guide NPCs at the trader/ammo corner - built the same as any
    // other Companion but never ticked (no .update() call anywhere), so
    // they just stand there with an instructional label instead of
    // following/fighting like every other Companion instance.
    this.traderGuideNpc = new Companion(this.scene, trader.x + 1.6, trader.z - 1.4, 'ranged', { vulnerable: false })
    this.traderGuideNpc.setName('Click the trader to trade points for supplies')
    this.ammoGuideNpc = new Companion(this.scene, ammoStation.x - 1.4, ammoStation.z - 1.2, 'ranged', { vulnerable: false })
    this.ammoGuideNpc.setName('Hold F here to refill reserve ammo')
    this.companion = new Companion(this.scene, 1.6, 7, this.settings.companionRole)
    this.reviveTarget = null
    this.playerBody = new PlayerBody(this.scene)
    // Was (-6, -18) - right against the safe zone's east wall (x:-13 z:-10,
    // half:7 -> wall at x=-6, z -17..-3), so the car's own collider spawned
    // already overlapping it and could never find a non-colliding direction
    // to move in (see Vehicle._tryMove - it has no "push clear" recovery,
    // just refuses any move that would still intersect). Moved well clear.
    this.vehicle = new Vehicle(this.scene, -6, 22, 0)
    this.driving = false
    this.nearVehicle = false
    this._vehicleSeatPos = new THREE.Vector3()
    this.pickups = new PickupManager(this.scene, spawnPoints)
    this.xpGems = new XpGemManager(this.scene)
    this.autoWeapons = new AutoWeaponManager(this.scene)
    // Minigun used to be a one-off floating pickup at minigunSpot (still
    // returned by buildWorld for the lookout room's layout) - now
    // Shop-exclusive instead, so it's no longer spawned on the map at all.
    this.pickups.spawnUnique('audiolog1', 0, -30, 0.5)
    this.pickups.spawnUnique('audiolog2', 0, 0, 0.5)
    this.pickups.spawnUnique('audiolog3', 0, 30, 0.5)
    // Used to sit in the standalone surface tunnel - that tunnel is gone
    // (see World.js's buildVireoFacility, now a straight continuation of
    // the subway instead), so this moves underground with it, tucked just
    // past the corridor marker spot along the same corridor.
    this.pickups.spawnUnique('audiolog4', vireoFacility.corridorMarkerSpot.x - 1.2, vireoFacility.corridorMarkerSpot.z + 3, vireoFacility.floorY + 0.5)
    this.pickups.spawnUnique('audiolog5', 0, 60, 0.5)
    // Locked Vault: a one-off "find the key, then cash in a guaranteed good
    // reward" loop, distinct from the random-roll chest rotation. Tucked in
    // a back corner of the safe zone compound, away from the entrance gap
    // and the beacon/guard spots. The key itself spawns at a random one of
    // a few scattered locations (see _spawnVaultKey) so where to look
    // changes run to run. z-offset negated from -3 to +3 to match the safe
    // zone's 180-degree flip (entrance moved from +z to -z, so "away from
    // the entrance" is now +z).
    this.vault = new Vault(safeZone.x - 4, 0, safeZone.z + 3)
    this.scene.add(this.vault.group)
    this.nearVault = false
    this.vaultKeySpots = [
      { x: 0, y: 0.5, z: -20 },
      { x: 0, y: 0.5, z: 65 },
      { x: vireoFacility.corridorMarkerSpot.x + 1.5, y: vireoFacility.floorY + 0.5, z: vireoFacility.corridorMarkerSpot.z - 2 },
    ]
    this._spawnVaultKey()
    this.audioLogsFound = new Set()
    this.chests = new ChestManager(this.scene, towerChestSpots)
    this.playerState = new PlayerState()
    this.inventory = new Inventory()
    this.metaProgress = loadMetaProgress()
    this._applyMetaUpgrades()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    if (this.achievements.unlocked.has('true_ending')) {
      document.getElementById('diff-nightmare').style.display = ''
    }
    this._updateTrophyWall()
    this.nearTrophyWall = false
    this.killCountsByWeapon = {}
    this.achievementLabel = document.getElementById('achievement-label')
    this.achievementTitle = document.getElementById('achievement-title')
    this.achievementToast = document.getElementById('achievement-toast')
    this.loreToast = document.getElementById('lore-toast')
    this.companionBarkEl = document.getElementById('companion-bark')
    this.lowHealthBarked = false
    this.bossAnnounced = false
    this.nextHeartbeatAt = 0
    this.statsPoints = document.getElementById('stats-points')
    this.perkPanel = document.getElementById('perk-panel')
    this.perkPanelTitle = document.getElementById('perk-panel-title')
    this.perkPointsLine = document.getElementById('perk-points-line')
    this.perkOptions = document.getElementById('perk-options')
    this.perkSkipBtn = document.getElementById('perk-skip-btn')
    this.perkRerollBtn = document.getElementById('perk-reroll-btn')
    this.traderPanel = document.getElementById('trader-panel')
    this.traderPanelTitle = document.getElementById('trader-panel-title')
    this.traderPointsLine = document.getElementById('trader-points-line')
    this.bountyLineEl = document.getElementById('bounty-line')
    this.traderOptions = document.getElementById('trader-options')
    this.traderSalvageTitle = document.getElementById('trader-salvage-title')
    this.traderSalvageOptions = document.getElementById('trader-salvage-options')
    this.traderBlackMarketTitle = document.getElementById('trader-blackmarket-title')
    this.traderBlackMarketOptions = document.getElementById('trader-blackmarket-options')
    this.traderHint = document.getElementById('trader-hint')
    this.upgradesBtn = document.getElementById('upgrades-btn')
    this.upgradesPanel = document.getElementById('upgrades-panel')
    this.upgradesPanelTitle = document.getElementById('upgrades-panel-title')
    this.upgradesPointsLine = document.getElementById('upgrades-points-line')
    this.upgradesOptions = document.getElementById('upgrades-options')
    this.upgradesCloseBtn = document.getElementById('upgrades-close-btn')
    this.prestigeSection = document.getElementById('prestige-section')
    this.prestigeLevelLine = document.getElementById('prestige-level-line')
    this.prestigeBtn = document.getElementById('prestige-btn')
    this.achievementsBtn = document.getElementById('achievements-btn')
    this.achievementsPanel = document.getElementById('achievements-panel')
    this.achievementsPanelTitle = document.getElementById('achievements-panel-title')
    this.achievementsOptions = document.getElementById('achievements-options')
    this.achievementsCloseBtn = document.getElementById('achievements-close-btn')
    this.bestiaryBtn = document.getElementById('bestiary-btn')
    this.bestiaryPanel = document.getElementById('bestiary-panel')
    this.bestiaryPanelTitle = document.getElementById('bestiary-panel-title')
    this.bestiaryOptions = document.getElementById('bestiary-options')
    this.bestiaryCloseBtn = document.getElementById('bestiary-close-btn')
    this.coinshopBtn = document.getElementById('coinshop-btn')
    this.coinshopPanel = document.getElementById('coinshop-panel')
    this.coinshopPanelTitle = document.getElementById('coinshop-panel-title')
    this.coinshopCoinLine = document.getElementById('coinshop-coin-line')
    this.coinshopOptions = document.getElementById('coinshop-options')
    this.coinshopCloseBtn = document.getElementById('coinshop-close-btn')
    this.statsCoins = document.getElementById('stats-coins')
    this.coinPopupEl = document.getElementById('coin-popup')
    this.bossHealthWrap = document.getElementById('boss-health-wrap')
    this.bossNameEl = document.getElementById('boss-name')
    this.bossHealthFill = document.getElementById('boss-health-fill')
    this.kothWrap = document.getElementById('koth-wrap')
    this.kothLabel = document.getElementById('koth-label')
    this.kothFill = document.getElementById('koth-fill')
    this.extractionWrap = document.getElementById('extraction-wrap')
    this.extractionLabel = document.getElementById('extraction-label')
    this.extractionFill = document.getElementById('extraction-fill')
    this.extractionScreen = document.getElementById('extraction-screen')
    this.extractionStats = document.getElementById('extraction-stats')
    this.extractionDaily = document.getElementById('extraction-daily')
    this.extractionContinueBtn = document.getElementById('extraction-continue-btn')
    this.dailyWrap = document.getElementById('daily-wrap')
    this.dailyLabel = document.getElementById('daily-label')
    this.dailyBestEl = document.getElementById('daily-best')
    this.xpFill = document.getElementById('xp-fill')
    this.xpLevelBadge = document.getElementById('xp-level-badge')
    this.xpLevelupPanel = document.getElementById('xp-levelup-panel')
    this.xpLevelupPanelTitle = document.getElementById('xp-levelup-panel-title')
    this.xpLevelupOptions = document.getElementById('xp-levelup-options')
    this.pauseOverlay = document.getElementById('pause-overlay')
    this.pauseOverlayTitle = document.getElementById('pause-overlay-title')
    this.pauseResumeBtn = document.getElementById('pause-resume-btn')
    this.pauseSettingsBtn = document.getElementById('pause-settings-btn')
    this.pauseQuitBtn = document.getElementById('pause-quit-btn')
    this.pauseUpgradesBtn = document.getElementById('pause-upgrades-btn')
    this.pauseShopBtn = document.getElementById('pause-shop-btn')
    this.screenshotCropOverlay = document.getElementById('screenshot-crop-overlay')
    this.screenshotCropStage = document.getElementById('screenshot-crop-stage')
    this.screenshotCropImage = document.getElementById('screenshot-crop-image')
    this.screenshotCropSelection = document.getElementById('screenshot-crop-selection')
    this.screenshotCropSaveBtn = document.getElementById('screenshot-crop-save')
    this.screenshotCropFullBtn = document.getElementById('screenshot-crop-full')
    this.screenshotCropCancelBtn = document.getElementById('screenshot-crop-cancel')
    this.screenshotCropOpen = false
    this.screenshotCropSelectionRect = null
    this.gameStarted = false
    this.decals = new DecalManager(this.scene)
    this.minimap = new Minimap(this.minimapCanvas)
    this._camDir = new THREE.Vector3()

    const hud = {
      weaponName: document.getElementById('weapon-name'),
      ammo: document.getElementById('ammo'),
    }
    this.ammoHudEl = hud.ammo
    this.nextLowAmmoTickAt = 0
    this.weapons = new WeaponSystem(
      this.camera,
      this.scene,
      solidMeshes,
      hud,
      this.zombies,
      (point, normal, isZombie) => this.decals.spawn(point, normal, isZombie),
      () => {
        this._triggerShake(0.05, 90)
        this._triggerHitstop(40)
      },
      () => this._onStealthTakedown()
    )
    this.rivals = new RivalManager(this.scene)
    this.weapons.setRivalManager(this.rivals)
    this._rivalsClaimedAirdrop = false
    // Weapon mastery (see WeaponMastery.js) - re-applies any previously
    // earned masteryMult bonuses to this fresh set of weapon objects, since
    // WeaponSystem's own weapons array is rebuilt from scratch every run.
    this.weaponMastery = loadMastery()
    for (const w of this.weapons.weapons) {
      if (this.weaponMastery.mastered.has(w.id)) w.masteryMult = MASTERY_DAMAGE_MULT
    }
    // Restore previously-purchased Coin Shop guns (see saveShopProgress) -
    // markUnlocked rather than unlockWeapon so restoring e.g. a past
    // minigun purchase doesn't yank the equipped weapon away from melee on
    // every fresh load.
    for (const gunId of this.shopProgress.unlockedGuns) this.weapons.markUnlocked(gunId)
    for (const entry of this.shopProgress.attachments) {
      const [weaponId, attachmentId] = entry.split(':')
      this.weapons.applyAttachment(weaponId, attachmentId)
    }
    this.ownedSkins = this.shopProgress.ownedSkins
    this.equippedSkin = this.shopProgress.equippedSkin
    // Only auto-grant+equip gold the first time the achievement unlocks -
    // once ownedSkins/equippedSkin persist across reloads (see
    // loadShopProgress), re-forcing gold on every single load would
    // steamroll whatever skin the player actually chose afterward.
    if (this.achievements.unlocked.has('centurion') && !this.ownedSkins.has('gold')) {
      this.ownedSkins.add('gold')
      if (this.equippedSkin === null) this.equippedSkin = 'gold'
    }
    if (this.equippedSkin) this.weapons.setSkinAllGuns(this.equippedSkin)

    audioEngine.setMusicVolume(this.settings.musicVolume / 100)
    audioEngine.setSfxVolume(this.settings.sfxVolume / 100)

    this._bindMenu()
    this._bindScreenshotCrop()
    this._bindTraderClick()
    // Safety net alongside the _updateStatsPanel save hook - catches a
    // close/reload happening between the last stats-panel update and now.
    window.addEventListener('beforeunload', () => saveShopProgress(this))
    this._bindItemKeys()
    this._bindHotbar()
    this._bindSettings()
    this._bindDifficulty()
    this._bindCompanionRole()
    this._bindLoadout()
    this._bindControlsTab()
    this.perkSkipBtn.addEventListener('click', () => this._closePerkPanel())
    this.perkRerollBtn.addEventListener('click', () => {
      if (this.points < PERK_REROLL_COST) return
      this.points -= PERK_REROLL_COST
      this._updateStatsPanel()
      this._renderPerkOptions(rollPerks(3))
    })
    this._applyLanguage()
    this._updateHealthHud()
    this._updateInventoryHud()
    this._updateProgressHud()
    this._updateStaminaHud()
    this._updateStatsPanel()
    this._updateXpHud()
    this._onResize()
    window.addEventListener('resize', () => this._onResize())

    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.renderer.setAnimationLoop(() => this._tick())

    // Debug/QA hook - lets Playwright (or the browser console) drive real
    // game methods directly, since this project has no test suite.
    window.__game = this
  }

  _addFlashlight() {
    this.flashlight = new THREE.SpotLight(0xfff4dd, 3.2, 35, THREE.MathUtils.degToRad(38), 0.5, 1.3)
    this.flashlight.position.set(0, 0, 0)
    this.camera.add(this.flashlight)

    this.flashlightTarget = new THREE.Object3D()
    this.flashlightTarget.position.set(0, 0, -1)
    this.camera.add(this.flashlightTarget)
    this.flashlight.target = this.flashlightTarget

    this.flashlightOn = true
    this.flashlightBattery = 100
    this.maxFlashlightBattery = 100
    this.flashlightLoreShown = false
    this.nextLightLureAt = 0
  }

  _updateFlashlightBattery(dt) {
    if (this.flashlightOn && this.flashlightBattery > 0) {
      this.flashlightBattery = Math.max(0, this.flashlightBattery - FLASHLIGHT_DRAIN_PER_SEC * dt)
      if (this.flashlightBattery === 0) this.flashlightOn = false
    }
    this.flashlight.visible = this.flashlightOn
    this.batteryFill.style.width = `${(this.flashlightBattery / this.maxFlashlightBattery) * 100}%`
  }

  _bindMenu() {
    this.playBtn.addEventListener('click', () => {
      audioEngine.init()
      audioEngine.resume()
      audioEngine.startAmbient()
      audioEngine.startMusic()
      this._applyLoadout(this.settings.loadout)
      let spawnMult = this.difficulty.spawnRateMult
      if (this.settings.mutators.hordeRush) spawnMult *= 2
      if (this.settings.mutators.hordeMode) spawnMult *= 3
      this.dailyChallengeActive = this.settings.mutators.dailyChallenge
      this.dailyDamageMult = 1
      if (this.dailyChallengeActive) {
        this.dailyTwist = DAILY_TWISTS[_dailyTwistIndex(_todayDateStr())]
        this.dailyDamageMult = this.dailyTwist.damageMult
        spawnMult *= this.dailyTwist.spawnMult
      }
      if (spawnMult !== this.difficulty.spawnRateMult) this.zombies.setDifficultyMultiplier(spawnMult)
      if (this.settings.mutators.hordeMode) this.zombies.setHordeMode(true)
      if (this.settings.mutators.bossRush) this.zombies.bossRushMode = true
      this.kothActive = this.settings.mutators.kingOfTheHill
      this.kothMarker.visible = this.kothActive
      if (this.kothActive) {
        this.kothProgress = 0
        this.kothZone.x = KOTH_SPOTS[0].x
        this.kothZone.z = KOTH_SPOTS[0].z
        this.kothMarker.position.set(this.kothZone.x, 0.06, this.kothZone.z)
      }
      this.extractionActive = this.settings.mutators.extraction
      this.extractionMarker.visible = this.extractionActive
      if (this.extractionActive) {
        this.extractionProgress = 0
        this.extractionNextSurgeAt = 0
      }
      if (this.dailyChallengeActive) {
        this.dailyBest = loadDailyBest()
        this.dailyWrap.style.display = 'block'
        this.dailyLabel.textContent = t(this.dailyTwist.nameKey)
        this.dailyBestEl.textContent = t('dailyBest', { score: this.dailyBest.score })
      } else {
        this.dailyWrap.style.display = 'none'
      }
      if (this._isRoundMode()) {
        this.zombies.roundMode = true
        this.zombies.reset()
        this.zombies.startRound(1)
        this.roundIntermissionUntil = 0
      }
      this.player.controls.lock()
    })

    this.respawnBtn.addEventListener('click', () => {
      // Hardcore: one life. A full page reload cleanly wipes all in-session
      // state (points, inventory, kills...) while keeping everything that's
      // meant to be permanent (settings, achievements, legacy points,
      // bestiary, best stats), since those all live in localStorage anyway.
      if (this.settings.hardcoreMode || (this.dailyChallengeActive && this.dailyTwist.forceHardcore)) {
        window.location.reload()
        return
      }
      this.playerState.respawn()
      this.lowHealthBarked = false
      this.bossAnnounced = false
      this.player.resetPosition()
      this.zombies.roundMode = this._isRoundMode()
      this.zombies.reset()
      if (this._isRoundMode()) this.zombies.startRound(1)
      this.roundIntermissionUntil = 0
      this.barricadeWindows.reset()
      this.chests.reset()
      this.rivals.reset()
      this._rivalsClaimedAirdrop = false
      this.xpGems.reset()
      this.companion.teleportTo(1.6, 7)
      this.companion.resetVitals()
      this.night = 1
      this.kills = 0
      this.activeBounty = null
      if (this.rescueSurvivor) {
        this.rescueSurvivor.dispose()
        this.rescueSurvivor = null
      }
      this.runStartedAt = performance.now()
      this.nightStartedAt = performance.now()
      this._scheduleNightEvent()
      this._rollWeather()
      this._rollFeaturedItem()
      this._rollTraderPrices()
      this._updateHealthHud()
      this._updateProgressHud()
      this.deathScreen.style.display = 'none'
      this.extractionScreen.style.display = 'none'
      if (this.kothActive) {
        this.kothProgress = 0
        this.kothZone.x = KOTH_SPOTS[0].x
        this.kothZone.z = KOTH_SPOTS[0].z
        this.kothMarker.position.set(this.kothZone.x, 0.06, this.kothZone.z)
      }
      if (this.extractionActive) {
        this.extractionProgress = 0
        this.extractionNextSurgeAt = 0
      }
      if (this.dailyChallengeActive) {
        this.dailyBest = loadDailyBest()
        this.dailyBestEl.textContent = t('dailyBest', { score: this.dailyBest.score })
      }
      this.player.controls.lock()
    })

    // Extraction success re-uses the exact same soft-reset the respawn
    // button runs, rather than duplicating the reset logic - a successful
    // extraction just starts a fresh run, same as respawning after death.
    this.extractionContinueBtn.addEventListener('click', () => this.respawnBtn.click())

    this.pauseResumeBtn.addEventListener('click', () => this.player.controls.lock())
    this.pauseSettingsBtn.addEventListener('click', () => this._toggleSettings(true))
    this.pauseQuitBtn.addEventListener('click', () => window.location.reload())
    this.pauseUpgradesBtn.addEventListener('click', () => this._openUpgradesPanel())
    this.pauseShopBtn.addEventListener('click', () => this._openCoinShopPanel())

    this.player.controls.addEventListener('lock', () => {
      this.gameStarted = true
      audioEngine.resume()
      this.pauseOverlay.style.display = 'none'
      this.screenshotCropOverlay.style.display = 'none'
      this.screenshotCropOpen = false
      this.menu.style.display = 'none'
      this.crosshair.style.display = this.driving ? 'none' : 'block'
      this.hudEl.style.display = this.driving ? 'none' : 'block'
      this.hotbarEl.style.display = this.driving ? 'none' : 'flex'
      this.statusHud.style.display = 'flex'
      this.inventoryHud.style.display = 'flex'
      this.progressHud.style.display = 'flex'
      this.statsPanel.style.display = 'flex'
      this.minimapWrap.style.display = 'block'
      this.compassStrip.style.display = 'block'
      if (this.driving) {
        this.interactPrompt.innerHTML = tHtml('interactExitVehicle')
        this.interactPrompt.style.display = 'block'
      }
    })

    this.player.controls.addEventListener('unlock', () => {
      this.inventoryOpen = false
      this.inventoryPanel.style.display = 'none'
      this.interactPrompt.style.display = 'none'
      this.infectionIndicator.style.display = 'none'
      if (!this.playerState.alive) return
      // Any of these panels already put up their own overlay and released
      // pointer lock themselves (see each _openXPanel), specifically so
      // their buttons are actually clickable - a locked pointer only
      // reports relative mouse deltas for the camera, not a usable cursor.
      // Don't also reset them or pop the pause menu on top when that's why
      // we just unlocked.
      if (this.screenshotCropOpen || this.perkPanelOpen || this.xpLevelupPanelOpen || this.traderPanelOpen) {
        // handled by whichever panel is open
      } else if (this.gameStarted) {
        audioEngine.pause()
        this.pauseOverlayTitle.textContent = t('pauseOverlayTitle')
        this.pauseResumeBtn.textContent = t('pauseResumeBtn')
        this.pauseUpgradesBtn.textContent = t('upgradesBtn')
        this.pauseShopBtn.textContent = t('coinshopBtn')
        this.pauseSettingsBtn.textContent = t('settingsBtn')
        this.pauseQuitBtn.textContent = t('pauseQuitBtn')
        this.pauseOverlay.style.display = 'flex'
      } else {
        this.menu.style.display = 'flex'
      }
      this.crosshair.style.display = 'none'
      this.hudEl.style.display = 'none'
      this.hotbarEl.style.display = 'none'
      this.statusHud.style.display = 'none'
      this.inventoryHud.style.display = 'none'
      this.progressHud.style.display = 'none'
      this.statsPanel.style.display = 'none'
      this.minimapWrap.style.display = 'none'
      this.compassStrip.style.display = 'none'
    })
  }

  _bindItemKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.player.controls.isLocked || !this.playerState.alive) return

      if (e.code === 'Tab') {
        e.preventDefault()
        this.inventoryOpen = !this.inventoryOpen
        this.inventoryPanel.style.display = this.inventoryOpen ? 'flex' : 'none'
        if (this.inventoryOpen) this._refreshInventoryPanel()
        return
      }

      if (this.inventoryOpen) return

      if (e.code === getKeyFor('heal')) {
        if (this.inventory.useHealthPack()) {
          this.playerState.heal(this.healthPackHealAmount)
          this.playerState.cureInfection()
          this._updateHealthHud()
          this._updateInventoryHud()
        }
      } else if (e.code === getKeyFor('armor')) {
        if (this.inventory.useArmorPack()) {
          this.playerState.addArmor(50)
          this._updateHealthHud()
          this._updateInventoryHud()
        }
      } else if (e.code === getKeyFor('flashlight')) {
        if (!this.flashlightOn && this.flashlightBattery <= 0) return
        this.flashlightOn = !this.flashlightOn
        if (this.flashlightOn && !this.flashlightLoreShown) {
          this.flashlightLoreShown = true
          this._showLoreToast(t('loreFlashlightWarning'))
        }
      } else if (e.code === getKeyFor('noisemaker')) {
        this._throwNoisemaker()
      } else if (e.code === getKeyFor('grenade')) {
        this._throwGrenade()
      } else if (e.code === getKeyFor('barricade')) {
        this._deployBarricade()
      } else if (e.code === getKeyFor('trap')) {
        this._deployTrap()
      } else if (e.code === getKeyFor('molotov')) {
        this._throwMolotov()
      } else if (e.code === getKeyFor('c4')) {
        this._throwC4()
      } else if (e.code === getKeyFor('detonateC4')) {
        this._detonateC4()
      } else if (e.code === getKeyFor('adrenaline')) {
        this._useAdrenaline()
      } else if (e.code === getKeyFor('emp')) {
        this._throwEmp()
      } else if (e.code === getKeyFor('interact')) {
        // Tracked independently of the rest of this branch (which only
        // fires the various one-shot interactions below) so the ammo
        // station's hold-to-charge check in _updateAmmoStation knows the
        // key is physically down, for as long as it's held.
        this.ammoStationKeyHeld = true
        this.breakerBoxKeyHeld = true
        if (this.driving) {
          this._exitVehicle()
        } else if (this.nearVehicle) {
          this._enterVehicle()
        } else if (this.reviveTarget) {
          this.reviveTarget.revive()
          this._showLoreToast(t('toastCompanionRevived'))
          this.reviveTarget = null
        } else if (this.nearVireoTerminal) {
          this._interactVireoTerminal()
        } else if (this.nearStationTerminal) {
          this._interactStationTerminal()
        } else if (this.nearRescueSurvivor) {
          this._rescueSurvivor()
        } else if (this.nearRecruitSpot) {
          this._recruitSurvivor(this.nearRecruitSpot)
        } else if (this.nearBarricadeWindow) {
          const reward = this.barricadeWindows.repair(this.nearBarricadeWindow)
          if (reward > 0) {
            this.points += reward
            this._updateStatsPanel()
          }
        } else if (this.nearVault) {
          this._openVault()
        } else if (this.nearLockedCell) {
          this._tryOpenLockedCell()
        } else if (this.nearTrophyWall) {
          this._showTrophyWallSummary()
        } else {
          const loot = this.chests.tryInteract()
          if (loot) {
            this._onPickup(loot.type, loot.label, false, loot.count)
            this.interactPrompt.style.display = 'none'
          } else if (this.nearGenerator && this.inventory.useFuelCan()) {
            this.generatorFuel = Math.min(this.maxGeneratorFuel, this.generatorFuel + GENERATOR_FUELCAN_AMOUNT)
          }
        }
      } else if (e.code === getKeyFor('screenshot')) {
        this._takeScreenshot()
      } else if (e.code === getKeyFor('toggleView')) {
        this.thirdPerson = !this.thirdPerson
        this.weapons.viewmodelRoot.visible = !this.thirdPerson
      } else if (e.code === getKeyFor('weaponWheel')) {
        if (!this.weaponWheelOpen) this._openWeaponWheel()
      }
    })

    window.addEventListener('keyup', (e) => {
      if (e.code === getKeyFor('interact')) { this.ammoStationKeyHeld = false; this.breakerBoxKeyHeld = false }
      if (e.code === getKeyFor('weaponWheel') && this.weaponWheelOpen) this._closeWeaponWheel(true)
    })

    // Pointer Lock only gives relative movement deltas (no visible cursor),
    // so the wheel tracks its own virtual cursor by integrating those
    // deltas itself rather than reading a real mouse position - the same
    // trick every FPS radial menu uses under pointer lock.
    window.addEventListener('mousemove', (e) => {
      if (!this.weaponWheelOpen) return
      this._wheelCursorX = Math.max(-WHEEL_RADIUS, Math.min(WHEEL_RADIUS, this._wheelCursorX + e.movementX))
      this._wheelCursorY = Math.max(-WHEEL_RADIUS, Math.min(WHEEL_RADIUS, this._wheelCursorY + e.movementY))
      this._updateWeaponWheelHighlight()
    })
  }

  _openWeaponWheel() {
    const unlocked = this.weapons.getSummary().filter((w) => w.unlocked)
    if (unlocked.length === 0) return
    this.weaponWheelOpen = true
    this._wheelCursorX = 0
    this._wheelCursorY = 0
    this._wheelHighlightIndex = -1
    this._wheelSegments = unlocked
    this.weaponWheelRing.innerHTML = ''
    unlocked.forEach((w, i) => {
      const angle = (i / unlocked.length) * Math.PI * 2 - Math.PI / 2
      const el = document.createElement('div')
      el.className = 'wheel-segment'
      el.style.left = `${Math.cos(angle) * WHEEL_RADIUS}px`
      el.style.top = `${Math.sin(angle) * WHEEL_RADIUS}px`
      el.textContent = t(w.nameKey)
      this.weaponWheelRing.appendChild(el)
    })
    this.weaponWheel.style.display = 'block'
    this._updateWeaponWheelHighlight()
  }

  _updateWeaponWheelHighlight() {
    const mag = Math.hypot(this._wheelCursorX, this._wheelCursorY)
    this.weaponWheelCursor.style.transform =
      `translate(calc(-50% + ${this._wheelCursorX}px), calc(-50% + ${this._wheelCursorY}px))`

    let index = -1
    if (mag > WHEEL_DEADZONE) {
      const angle = Math.atan2(this._wheelCursorY, this._wheelCursorX) + Math.PI / 2
      const count = this._wheelSegments.length
      const step = (Math.PI * 2) / count
      index = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / step) % count
    }
    if (index === this._wheelHighlightIndex) return
    this._wheelHighlightIndex = index
    const els = this.weaponWheelRing.children
    for (let i = 0; i < els.length; i++) els[i].classList.toggle('highlight', i === index)
  }

  _closeWeaponWheel(confirm) {
    this.weaponWheelOpen = false
    this.weaponWheel.style.display = 'none'
    if (confirm && this._wheelHighlightIndex >= 0) {
      const chosen = this._wheelSegments[this._wheelHighlightIndex]
      const index = this.weapons.weapons.findIndex((w) => w.id === chosen.id)
      if (index !== -1) this.weapons.switchToIndex(index)
    }
  }

  // P captures the current frame, pauses (same pointer-unlock mechanism as
  // Esc), and opens an in-game crop tool instead of just instantly saving a
  // full screenshot - lets a player select just the part of the frame they
  // want without needing their OS's own screenshot tool.
  _takeScreenshot() {
    this.composer.render()
    this._screenshotDataUrl = this.canvas.toDataURL('image/png')
    this.screenshotCropOpen = true
    this.screenshotCropImage.src = this._screenshotDataUrl
    this.screenshotCropSelection.style.display = 'none'
    this.screenshotCropSelectionRect = null
    this.screenshotCropOverlay.style.display = 'flex'
    this.player.controls.unlock()
  }

  _closeScreenshotCrop() {
    this.screenshotCropOpen = false
    this.screenshotCropOverlay.style.display = 'none'
    this.player.controls.lock()
  }

  // Crops this._screenshotDataUrl to the given CSS-pixel rect (relative to
  // the rendered <img>, which may be scaled down from the actual capture
  // resolution to fit the overlay) and downloads the result.
  _saveScreenshotCrop(rect) {
    const img = this.screenshotCropImage
    const scaleX = img.naturalWidth / img.clientWidth
    const scaleY = img.naturalHeight / img.clientHeight
    const sx = Math.round(rect.x * scaleX)
    const sy = Math.round(rect.y * scaleY)
    const sw = Math.round(rect.width * scaleX)
    const sh = Math.round(rect.height * scaleY)

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

    const link = document.createElement('a')
    link.download = `gayz-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  _saveFullScreenshot() {
    const link = document.createElement('a')
    link.download = `gayz-${Date.now()}.png`
    link.href = this._screenshotDataUrl
    link.click()
  }

  // Simple click-drag-release rectangle selector over the captured image -
  // no resize handles, dragging again just replaces the previous selection.
  _bindScreenshotCrop() {
    let dragStart = null

    const stageRect = () => this.screenshotCropStage.getBoundingClientRect()
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

    this.screenshotCropStage.addEventListener('mousedown', (e) => {
      const r = stageRect()
      dragStart = {
        x: clamp(e.clientX - r.left, 0, r.width),
        y: clamp(e.clientY - r.top, 0, r.height),
      }
      this.screenshotCropSelection.style.display = 'block'
    })

    window.addEventListener('mousemove', (e) => {
      if (!dragStart) return
      const r = stageRect()
      const x = clamp(e.clientX - r.left, 0, r.width)
      const y = clamp(e.clientY - r.top, 0, r.height)
      const rect = {
        x: Math.min(dragStart.x, x),
        y: Math.min(dragStart.y, y),
        width: Math.abs(x - dragStart.x),
        height: Math.abs(y - dragStart.y),
      }
      this.screenshotCropSelectionRect = rect
      this.screenshotCropSelection.style.left = `${rect.x}px`
      this.screenshotCropSelection.style.top = `${rect.y}px`
      this.screenshotCropSelection.style.width = `${rect.width}px`
      this.screenshotCropSelection.style.height = `${rect.height}px`
    })

    window.addEventListener('mouseup', () => {
      dragStart = null
    })

    this.screenshotCropSaveBtn.addEventListener('click', () => {
      const rect = this.screenshotCropSelectionRect
      if (rect && rect.width > 4 && rect.height > 4) this._saveScreenshotCrop(rect)
      else this._saveFullScreenshot()
      this._closeScreenshotCrop()
    })
    this.screenshotCropFullBtn.addEventListener('click', () => {
      this._saveFullScreenshot()
      this._closeScreenshotCrop()
    })
    this.screenshotCropCancelBtn.addEventListener('click', () => this._closeScreenshotCrop())

    window.addEventListener('keydown', (e) => {
      if (!this.screenshotCropOpen) return
      if (e.code === 'Escape') this._closeScreenshotCrop()
      else if (e.code === 'Enter') this.screenshotCropSaveBtn.click()
    })

    // Close controls for the mouse-driven pick panels below - each one
    // unlocks pointer lock itself when it opens (see _openTraderPanel etc.)
    // so its buttons are actually clickable, which means the normal
    // pointer-lock-gated keydown handler never sees these keys while a
    // panel is open (nothing left to unlock, so the "!isLocked -> return"
    // guard at its top always bails first). This is a separate always-on
    // listener for exactly that reason - trader's own hint text promises
    // "Press F to leave", so F needs to keep working here too, not just
    // Escape. XP level-up is deliberately not included - picking one of
    // the 3 free buffs is mandatory, same as it having no Skip button.
    window.addEventListener('keydown', (e) => {
      if (this.traderPanelOpen && (e.code === 'Escape' || e.code === getKeyFor('interact'))) {
        this._closeTraderPanel()
      } else if (this.perkPanelOpen && e.code === 'Escape') {
        this._closePerkPanel()
      }
    })
  }

  // Trader is opened by clicking directly on the stall (not a proximity F
  // press like every other interact prompt) - the hint text still only
  // shows up within TRADER_INTERACT_RADIUS (see _updateTrader), this just
  // decides whether a given left click actually opens the panel once
  // you're close enough. Guarded on isLocked so it can't fire again while
  // the panel (or any other unlock-driven panel/menu) is already open, and
  // on nearTrader so a random click across the map doesn't raycast for no
  // reason.
  _bindTraderClick() {
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      if (!this.player.controls.isLocked || !this.playerState.alive) return
      if (this.driving || this.inventoryOpen || this.weaponWheelOpen) return
      if (!this.nearTrader) return

      this._traderRaycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
      const hits = this._traderRaycaster.intersectObject(this.trader.mesh, true)
      if (hits.length > 0 && hits[0].distance <= TRADER_INTERACT_RADIUS + 1.5) {
        this._openTraderPanel()
      }
    })
  }

  _throwNoisemaker() {
    if (!this.inventory.useNoisemaker()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 8)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnNoisemakerThrow(origin, target)
    this._updateInventoryHud()
  }

  _throwGrenade() {
    if (!this.inventory.useGrenade()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 10)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnGrenadeThrow(origin, target)
    this._updateInventoryHud()
  }

  _throwMolotov() {
    if (!this.inventory.useMolotov()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 9)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnMolotovThrow(origin, target)
    this._updateInventoryHud()
  }

  _throwC4() {
    if (!this.inventory.useC4()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 8)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnC4Throw(origin, target)
    this._updateInventoryHud()
  }

  _detonateC4() {
    if (!this.zombies.detonateC4()) {
      this._showLoreToast(t('toastNoC4'))
    }
  }

  _throwEmp() {
    if (!this.inventory.useEmp()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 9)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnEmpThrow(origin, target)
    this._updateInventoryHud()
  }

  // Panic-button speed + fire-rate boost, distinct from health/armor packs -
  // see PlayerController's adrenalineMult and WeaponSystem's fireRateMult,
  // both plain multipliers this sets then clears on a timer (_updateAdrenaline,
  // called every tick) rather than either system owning the countdown itself.
  _useAdrenaline() {
    if (!this.inventory.useAdrenaline()) return
    this.adrenalineExpiresAt = performance.now() + ADRENALINE_DURATION_MS
    this.player.adrenalineMult = ADRENALINE_SPEED_MULT
    this.weapons.fireRateMult = ADRENALINE_FIRE_RATE_MULT
    this._updateInventoryHud()
  }

  _updateAdrenaline() {
    if (this.adrenalineExpiresAt && performance.now() >= this.adrenalineExpiresAt) {
      this.adrenalineExpiresAt = 0
      this.player.adrenalineMult = 1
      this.weapons.fireRateMult = 1
    }
  }

  // Drops a temporary wall a couple meters ahead, facing the same way the
  // player is - pushed straight into the same colliders/solidMeshes arrays
  // PlayerController and ZombieManager already read every frame, so
  // zombies path around it exactly like any other world prop with no
  // extra wiring, and it despawns on a timer (see _tick's cleanup check)
  // rather than needing its own health/damage model.
  _deployBarricade() {
    if (!this.inventory.useBarricade()) return
    this.camera.getWorldDirection(this._camDir)
    const playerPos = this.player.controls.object.position
    const x = playerPos.x + this._camDir.x * BARRICADE_PLACE_DIST
    const z = playerPos.z + this._camDir.z * BARRICADE_PLACE_DIST
    const heading = Math.atan2(this._camDir.x, this._camDir.z)

    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3c2a, roughness: 0.9 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BARRICADE_W, BARRICADE_H, BARRICADE_D), mat)
    mesh.position.set(x, BARRICADE_H / 2, z)
    mesh.rotation.y = heading
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)

    const box = new THREE.Box3().setFromObject(mesh)
    this.colliders.push(box)
    this.solidMeshes.push(mesh)
    this.barricades.push({ mesh, box, expiresAt: performance.now() + BARRICADE_LIFETIME_MS })

    this._updateInventoryHud()
  }

  // Unlike a barricade (blocks indefinitely until it expires), a trap is a
  // one-shot device: the first alive zombie to step within
  // TRAP_TRIGGER_RADIUS sets it off, dealing falloff AoE damage to
  // everything within TRAP_BLAST_RADIUS - same falloff-damage shape as
  // ZombieManager's own explodeAt.
  _deployTrap() {
    if (!this.inventory.useTrap()) return
    this.camera.getWorldDirection(this._camDir)
    const playerPos = this.player.controls.object.position
    const x = playerPos.x + this._camDir.x * TRAP_PLACE_DIST
    const z = playerPos.z + this._camDir.z * TRAP_PLACE_DIST

    const mat = new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0xff2a1e, emissiveIntensity: 0.9, roughness: 0.6 })
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12), mat)
    mesh.position.set(x, 0.03, z)
    this.scene.add(mesh)

    this.traps.push({ mesh, x, z, triggered: false, expiresAt: performance.now() + TRAP_LIFETIME_MS })
    this._updateInventoryHud()
  }

  _triggerTrap(trap) {
    trap.triggered = true
    for (const zombie of this.zombies.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - trap.x, zombie.group.position.z - trap.z)
      if (dist <= TRAP_BLAST_RADIUS) {
        const falloff = 1 - dist / TRAP_BLAST_RADIUS
        zombie.lastHitWeaponId = 'trap'
        zombie.onHit(TRAP_DAMAGE_MIN + (TRAP_DAMAGE_MAX - TRAP_DAMAGE_MIN) * falloff)
      }
    }
    this._triggerShake(0.05, 100)
  }

  _updateTraps() {
    if (this.traps.length === 0) return
    const now = performance.now()
    for (const trap of this.traps) {
      if (trap.triggered) continue
      for (const zombie of this.zombies.zombies) {
        if (zombie.state !== 'alive') continue
        const dist = Math.hypot(zombie.group.position.x - trap.x, zombie.group.position.z - trap.z)
        if (dist <= TRAP_TRIGGER_RADIUS) {
          this._triggerTrap(trap)
          break
        }
      }
    }
    for (const trap of this.traps) {
      if (trap.triggered || now >= trap.expiresAt) this.scene.remove(trap.mesh)
    }
    this.traps = this.traps.filter((t) => !t.triggered && now < t.expiresAt)
  }

  // Rolled from _onZombieKilled - a rubble pile at the kill spot that blocks
  // movement like a barricade, but appears on its own instead of being
  // player-placed. Oldest one is cleared early if the cap's already full,
  // so a long fight in one spot can't wall itself off entirely.
  _maybeDropObstacle(x, z) {
    if (Math.random() >= OBSTACLE_DROP_CHANCE) return
    if (this.deathObstacles.length >= OBSTACLE_MAX_COUNT) {
      const oldest = this.deathObstacles.shift()
      this._removeDeathObstacle(oldest)
    }

    const baseMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.95 })
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0x2c211c, roughness: 0.95 })
    const group = new THREE.Group()
    group.position.set(x, 0, z)

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 1.1), baseMat)
    base.position.y = 0.2
    base.rotation.y = Math.random() * Math.PI
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    for (let i = 0; i < 3; i++) {
      const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.25, 0.25 + Math.random() * 0.3, 0.3 + Math.random() * 0.25), chunkMat)
      chunk.position.set((Math.random() - 0.5) * 0.7, 0.35 + Math.random() * 0.2, (Math.random() - 0.5) * 0.7)
      chunk.rotation.y = Math.random() * Math.PI
      chunk.castShadow = true
      group.add(chunk)
    }

    this.scene.add(group)
    base.updateWorldMatrix(true, false)
    const box = new THREE.Box3().setFromObject(base)
    this.colliders.push(box)
    this.solidMeshes.push(base)
    this.deathObstacles.push({ group, base, box, expiresAt: performance.now() + OBSTACLE_LIFETIME_MS })
  }

  _removeDeathObstacle(o) {
    this.scene.remove(o.group)
    const ci = this.colliders.indexOf(o.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(o.base)
    if (si !== -1) this.solidMeshes.splice(si, 1)
  }

  _updateDeathObstacles() {
    if (this.deathObstacles.length === 0) return
    const now = performance.now()
    const expired = this.deathObstacles.filter((o) => now >= o.expiresAt)
    if (expired.length === 0) return
    for (const o of expired) this._removeDeathObstacle(o)
    this.deathObstacles = this.deathObstacles.filter((o) => now < o.expiresAt)
  }

  // Ambient hazard (see NightEvents.js's toxic_gas/emp_field) - a lingering
  // zone the player has to notice and route around. 'gas' damages the
  // player per tick while inside; 'emp' forces the flashlight off and
  // drains its battery fast instead, no direct damage.
  _spawnHazardZone(type, x, z) {
    const isGas = type === 'gas'
    const color = isGas ? 0x5fcf4a : 0x4ecfff
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(HAZARD_RADIUS, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat)
    mesh.position.set(x, 0.05, z)
    this.scene.add(mesh)
    const light = new THREE.PointLight(color, 1.4, HAZARD_RADIUS * 2.5, 2)
    light.position.set(x, 1.5, z)
    this.scene.add(light)

    this.hazardZones.push({
      type,
      x,
      z,
      mesh,
      light,
      expiresAt: performance.now() + (isGas ? HAZARD_GAS_DURATION_MS : HAZARD_EMP_DURATION_MS),
      nextTickAt: performance.now(),
    })
  }

  _removeHazardZone(zone) {
    this.scene.remove(zone.mesh)
    this.scene.remove(zone.light)
  }

  _updateHazardZones(dt, playerPos) {
    if (this.hazardZones.length === 0) return
    const now = performance.now()
    let playerInEmp = false

    this.hazardZones = this.hazardZones.filter((zone) => {
      if (now >= zone.expiresAt) {
        this._removeHazardZone(zone)
        return false
      }
      const flicker = 0.8 + Math.sin(now * 0.015 + zone.x) * 0.2
      zone.light.intensity = 1.4 * flicker
      zone.mesh.material.opacity = 0.32 * flicker + 0.08

      const dist = Math.hypot(playerPos.x - zone.x, playerPos.z - zone.z)
      const inside = dist <= HAZARD_RADIUS
      if (inside && zone.type === 'emp') playerInEmp = true

      if (inside && zone.type === 'gas' && now >= zone.nextTickAt) {
        zone.nextTickAt = now + HAZARD_TICK_MS
        if (this.player.isDodging) return true // brief invincibility window, same as a zombie hit
        this.playerState.takeDamage(HAZARD_GAS_DAMAGE_PER_TICK)
        this._updateHealthHud()
        this.damageFlash.classList.remove('hit')
        void this.damageFlash.offsetWidth
        this.damageFlash.classList.add('hit')
        if (!this.playerState.alive) this._onPlayerDeath()
      }
      return true
    })

    if (playerInEmp) {
      this.flashlightOn = false
      this.flashlightBattery = Math.max(0, this.flashlightBattery - HAZARD_EMP_BATTERY_DRAIN_PER_SEC * dt)
      this.flashlight.visible = false
    }
  }

  _updateBarricades() {
    if (this.barricades.length === 0) return
    const now = performance.now()
    const expired = this.barricades.filter((b) => now >= b.expiresAt)
    if (expired.length === 0) return
    for (const b of expired) {
      this.scene.remove(b.mesh)
      const ci = this.colliders.indexOf(b.box)
      if (ci !== -1) this.colliders.splice(ci, 1)
      const si = this.solidMeshes.indexOf(b.mesh)
      if (si !== -1) this.solidMeshes.splice(si, 1)
    }
    this.barricades = this.barricades.filter((b) => now < b.expiresAt)
  }

  // Vehicle combat: zombies don't get their own update() call while driving
  // (see the driving branch in _tick - the player is invulnerable and the
  // whole gameplay block is skipped), so this checks proximity against
  // their last-known (frozen) positions directly rather than needing them
  // to be "live" - onHit still works standalone, the kill/XP-gem bookkeeping
  // just catches up the moment the player gets back out of the car.
  _updateVehicleRamming() {
    if (Math.abs(this.vehicle.speed) < VEHICLE_RAM_MIN_SPEED) return
    const pos = this.vehicle.group.position
    const now = performance.now()
    for (const zombie of this.zombies.zombies) {
      if (zombie.state !== 'alive') continue
      const lastHit = this._vehicleHitAt.get(zombie) || 0
      if (now - lastHit < VEHICLE_RAM_COOLDOWN_MS) continue
      const dist = Math.hypot(zombie.group.position.x - pos.x, zombie.group.position.z - pos.z)
      if (dist <= VEHICLE_RAM_RADIUS) {
        this._vehicleHitAt.set(zombie, now)
        zombie.lastHitWeaponId = 'vehicle'
        zombie.onHit(VEHICLE_RAM_DAMAGE)
        this._triggerShake(0.08, 120)
      }
    }
  }

  // Swaps a slider's value label for a temporary <input type="number"> on
  // click, so a precise number can be typed in instead of fighting the
  // drag precision of a 0-100 (or 20-300) range - commits by re-dispatching
  // the slider's own 'input' event so audio/FOV/sensitivity update through
  // the exact same path a drag would use, no separate update logic to keep
  // in sync.
  _bindEditableSliderValue(valueEl, sliderEl) {
    valueEl.classList.add('audio-value-editable')
    valueEl.title = 'Click to type an exact value'
    valueEl.addEventListener('click', () => {
      if (valueEl.dataset.editing) return
      valueEl.dataset.editing = '1'
      const min = Number(sliderEl.min)
      const max = Number(sliderEl.max)
      const current = Number(sliderEl.value)
      const input = document.createElement('input')
      input.type = 'number'
      input.min = min
      input.max = max
      input.value = current
      input.className = 'audio-value-input'
      valueEl.replaceWith(input)
      input.focus()
      input.select()

      let settled = false
      const finish = (commit) => {
        if (settled) return
        settled = true
        if (commit) {
          let v = Number(input.value)
          if (Number.isNaN(v)) v = current
          v = Math.max(min, Math.min(max, Math.round(v)))
          sliderEl.value = v
          sliderEl.dispatchEvent(new Event('input'))
        }
        delete valueEl.dataset.editing
        input.replaceWith(valueEl)
      }
      input.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') { e.preventDefault(); finish(true) }
        else if (e.code === 'Escape') { e.preventDefault(); finish(false) }
      })
      input.addEventListener('blur', () => finish(true))
    })
  }

  _bindSettings() {
    this.languageGrid.innerHTML = LANGUAGES.map((lang) => `
      <button class="language-btn${lang.code === this.settings.language ? ' active' : ''}" data-lang="${lang.code}">
        <span class="lang-name">${lang.name}</span>
        <span class="lang-native">${lang.native}</span>
      </button>
    `).join('')

    this.languageGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.language-btn')
      if (!btn) return
      this.settings.language = btn.dataset.lang
      saveSettings(this.settings)
      setLanguage(this.settings.language)
      this._applyLanguage()
      for (const el of this.languageGrid.querySelectorAll('.language-btn')) {
        el.classList.toggle('active', el === btn)
      }
    })

    for (const tab of document.querySelectorAll('.settings-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.settings-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.settings-page')) {
          page.style.display = page.id === `settings-page-${tab.dataset.page}` ? 'block' : 'none'
        }
      })
    }

    this.musicVolumeSlider.value = this.settings.musicVolume
    this.musicVolumeValue.textContent = `${this.settings.musicVolume}%`
    this.sfxVolumeSlider.value = this.settings.sfxVolume
    this.sfxVolumeValue.textContent = `${this.settings.sfxVolume}%`

    this.musicVolumeSlider.addEventListener('input', () => {
      const value = Number(this.musicVolumeSlider.value)
      this.musicVolumeValue.textContent = `${value}%`
      this.settings.musicVolume = value
      audioEngine.setMusicVolume(value / 100)
      saveSettings(this.settings)
    })

    this.sfxVolumeSlider.addEventListener('input', () => {
      const value = Number(this.sfxVolumeSlider.value)
      this.sfxVolumeValue.textContent = `${value}%`
      this.settings.sfxVolume = value
      audioEngine.setSfxVolume(value / 100)
      saveSettings(this.settings)
    })

    this.sensitivitySlider.value = this.settings.sensitivity
    this.sensitivityValue.textContent = `${this.settings.sensitivity}%`
    this.player.controls.pointerSpeed = this.settings.sensitivity / 100

    this.fovSlider.value = this.settings.fov
    this.fovValue.textContent = `${this.settings.fov}`
    this.camera.fov = this.settings.fov
    this.camera.updateProjectionMatrix()
    this.weapons.setBaseFov(this.settings.fov)

    this.sensitivitySlider.addEventListener('input', () => {
      const value = Number(this.sensitivitySlider.value)
      this.sensitivityValue.textContent = `${value}%`
      this.settings.sensitivity = value
      this.player.controls.pointerSpeed = value / 100
      saveSettings(this.settings)
    })

    this.fovSlider.addEventListener('input', () => {
      const value = Number(this.fovSlider.value)
      this.fovValue.textContent = `${value}`
      this.settings.fov = value
      this.camera.fov = value
      this.camera.updateProjectionMatrix()
      this.weapons.setBaseFov(value)
      saveSettings(this.settings)
    })

    // Click any of the four value labels above to type an exact number
    // instead of dragging the slider - the slider itself stays as the
    // primary control, this just re-dispatches its own 'input' event so
    // every existing listener (audio engine, saveSettings, HUD text) fires
    // exactly the same way it would from a drag.
    this._bindEditableSliderValue(this.musicVolumeValue, this.musicVolumeSlider)
    this._bindEditableSliderValue(this.sfxVolumeValue, this.sfxVolumeSlider)
    this._bindEditableSliderValue(this.sensitivityValue, this.sensitivitySlider)
    this._bindEditableSliderValue(this.fovValue, this.fovSlider)

    this.colorblindToggle.checked = this.settings.colorblind
    setColorblind(this.settings.colorblind)

    this.colorblindToggle.addEventListener('change', () => {
      this.settings.colorblind = this.colorblindToggle.checked
      setColorblind(this.settings.colorblind)
      saveSettings(this.settings)
    })

    this.performanceToggle.checked = this.settings.performanceMode
    this._applyPerformanceMode(this.settings.performanceMode)

    this.performanceToggle.addEventListener('change', () => {
      this.settings.performanceMode = this.performanceToggle.checked
      this._applyPerformanceMode(this.settings.performanceMode)
      saveSettings(this.settings)
    })

    this.scoreAttackToggle.checked = this.settings.scoreAttackMode
    this.scoreAttackToggle.addEventListener('change', () => {
      this.settings.scoreAttackMode = this.scoreAttackToggle.checked
      this.nightDurationMs = this.settings.scoreAttackMode ? SCORE_ATTACK_NIGHT_DURATION_MS : NIGHT_DURATION_MS
      saveSettings(this.settings)
    })

    this.hardcoreToggle.checked = this.settings.hardcoreMode
    this.hardcoreToggle.addEventListener('change', () => {
      this.settings.hardcoreMode = this.hardcoreToggle.checked
      saveSettings(this.settings)
    })

    this.mutatorHordeRush.checked = this.settings.mutators.hordeRush
    this.mutatorHordeRush.addEventListener('change', () => {
      this.settings.mutators.hordeRush = this.mutatorHordeRush.checked
      saveSettings(this.settings)
    })
    this.mutatorLootRush.checked = this.settings.mutators.lootRush
    this.mutatorLootRush.addEventListener('change', () => {
      this.settings.mutators.lootRush = this.mutatorLootRush.checked
      saveSettings(this.settings)
    })
    this.mutatorPureGunplay.checked = this.settings.mutators.pureGunplay
    this.mutatorPureGunplay.addEventListener('change', () => {
      this.settings.mutators.pureGunplay = this.mutatorPureGunplay.checked
      saveSettings(this.settings)
    })
    this.mutatorBossRush.checked = this.settings.mutators.bossRush
    this.mutatorBossRush.addEventListener('change', () => {
      this.settings.mutators.bossRush = this.mutatorBossRush.checked
      saveSettings(this.settings)
    })
    this.mutatorHordeMode.checked = this.settings.mutators.hordeMode
    this.mutatorHordeMode.addEventListener('change', () => {
      this.settings.mutators.hordeMode = this.mutatorHordeMode.checked
      saveSettings(this.settings)
    })
    this.mutatorKoth.checked = this.settings.mutators.kingOfTheHill
    this.mutatorKoth.addEventListener('change', () => {
      this.settings.mutators.kingOfTheHill = this.mutatorKoth.checked
      saveSettings(this.settings)
    })
    this.mutatorExtraction.checked = this.settings.mutators.extraction
    this.mutatorExtraction.addEventListener('change', () => {
      this.settings.mutators.extraction = this.mutatorExtraction.checked
      saveSettings(this.settings)
    })
    this.mutatorDaily.checked = this.settings.mutators.dailyChallenge
    this.mutatorDaily.addEventListener('change', () => {
      this.settings.mutators.dailyChallenge = this.mutatorDaily.checked
      saveSettings(this.settings)
    })
    this.nicknameInput.value = this.settings.nickname
    this._updateCompanionName()

    this.nicknameInput.addEventListener('input', () => {
      this.settings.nickname = this.nicknameInput.value
      saveSettings(this.settings)
      this._updateCompanionName()
    })

    this.settingsBtn.addEventListener('click', () => this._toggleSettings(!this.settingsOpen))
    this.upgradesBtn.addEventListener('click', () => this._openUpgradesPanel())
    this.upgradesCloseBtn.addEventListener('click', () => this._closeUpgradesPanel())
    this.prestigeBtn.addEventListener('click', () => this._prestige())
    this.achievementsBtn.addEventListener('click', () => this._openAchievementsPanel())
    this.achievementsCloseBtn.addEventListener('click', () => this._closeAchievementsPanel())
    this.bestiaryBtn.addEventListener('click', () => this._openBestiaryPanel())
    this.bestiaryCloseBtn.addEventListener('click', () => this._closeBestiaryPanel())
    this.coinshopBtn.addEventListener('click', () => this._openCoinShopPanel())
    this.coinshopCloseBtn.addEventListener('click', () => this._closeCoinShopPanel())
    this.endingContinueBtn.addEventListener('click', () => {
      this.endingPanel.style.display = 'none'
      this.player.controls.lock()
    })

    // Click anywhere outside the settings content (the backdrop itself, not
    // a descendant) to close, in addition to toggling the Settings button.
    this.settingsPanel.addEventListener('click', (e) => {
      if (e.target === this.settingsPanel) this._toggleSettings(false)
    })
    this.upgradesPanel.addEventListener('click', (e) => {
      if (e.target === this.upgradesPanel) this._closeUpgradesPanel()
    })
    this.coinshopPanel.addEventListener('click', (e) => {
      if (e.target === this.coinshopPanel) this._closeCoinShopPanel()
    })
  }

  _bindControlsTab() {
    this._renderControlsGrid()
    this.resetBindsBtn.addEventListener('click', () => {
      resetBindings()
      this._renderControlsGrid()
    })
  }

  _renderControlsGrid() {
    this.controlsGrid.innerHTML = ACTIONS.map((a) => `
      <span class="control-label">${t(a.labelKey)}</span>
      <button class="control-key-btn" data-action="${a.id}">${keyLabel(getKeyFor(a.id))}</button>
    `).join('')

    for (const btn of this.controlsGrid.querySelectorAll('.control-key-btn')) {
      btn.addEventListener('click', () => this._startRebind(btn, btn.dataset.action))
    }
  }

  // Puts one button into "listening" mode, capturing the next keydown
  // anywhere as the new binding for that action (Escape cancels).
  _startRebind(btn, action) {
    if (this.rebindingAction) return
    this.rebindingAction = action
    btn.textContent = t('pressAnyKey')
    btn.classList.add('listening')

    const handler = (e) => {
      e.preventDefault()
      window.removeEventListener('keydown', handler, true)
      this.rebindingAction = null
      // Digit1-5 (the hotbar, see _bindHotbar) and Tab (inventory, see
      // _bindItemKeys) are hardcoded key.code checks outside the rebindable
      // ACTIONS list - allowing an action to be remapped onto one of them
      // wouldn't move it there, it would just make both fire together on
      // every press (e.g. rebinding Reload to "1" would reload AND switch
      // to hotbar slot 1 every time). Treated the same as Escape: cancels
      // the rebind and keeps the previous key instead.
      const reserved = e.code === 'Tab' || /^Digit[1-5]$/.test(e.code)
      if (e.code !== 'Escape' && !reserved) setBinding(action, e.code)
      this._renderControlsGrid()
    }
    window.addEventListener('keydown', handler, true)
  }

  _bindDifficulty() {
    this._updateNightmareOverlay()
    for (const btn of this.difficultyBtns) {
      btn.classList.toggle('active', btn.dataset.difficulty === this.settings.difficulty)
      btn.addEventListener('click', () => {
        const id = btn.dataset.difficulty
        if (!DIFFICULTY_PRESETS[id]) return
        this.settings.difficulty = id
        saveSettings(this.settings)
        this.difficulty = DIFFICULTY_PRESETS[id]
        this.zombies.setDifficultyMultiplier(this.difficulty.spawnRateMult)
        for (const b of this.difficultyBtns) b.classList.toggle('active', b === btn)
        this._updateNightmareOverlay()
      })
    }
  }

  // Nightmare (unlocked by the true ending) gets a harsher red tint so it's
  // visually distinct, not just numerically harder.
  _updateNightmareOverlay() {
    this.nightmareOverlayEl.style.display = this.settings.difficulty === 'nightmare' ? 'block' : 'none'
  }

  _bindCompanionRole() {
    for (const btn of this.roleBtns) {
      btn.classList.toggle('active', btn.dataset.role === this.settings.companionRole)
      btn.addEventListener('click', () => {
        const role = btn.dataset.role
        if (!['ranged', 'melee', 'medic'].includes(role)) return
        this.settings.companionRole = role
        saveSettings(this.settings)
        // Matches by role, not by exact button, since the same 3 roles now
        // appear both on the main menu and inside the trader panel.
        for (const b of this.roleBtns) b.classList.toggle('active', b.dataset.role === role)
        this._rebuildCompanion(role)
      })
    }
  }

  _rebuildCompanion(role) {
    const pos = this.companion.group.position
    this.companion.dispose()
    this.companion = new Companion(this.scene, pos.x, pos.z, role)
    // A role swap rebuilds the companion from scratch - reapply any
    // points-bought training/gear so switching roles mid-run doesn't reset it.
    if (this.companionTrainingLevel > 0) this.companion.applyTraining(this.companionTrainingLevel)
    if (this.companionGear.vest) this.companion.equipVest()
    if (this.companionGear.rig) this.companion.equipRig()
    this._updateCompanionName()
  }

  // Selection-only here - the actual stat deltas (see LOADOUT_PRESETS) get
  // applied once, when the very first "Click to Play" starts a run (see
  // playBtn's click handler), not on every settings change.
  _applyLoadout(id) {
    const preset = LOADOUT_PRESETS[id] || LOADOUT_PRESETS.balanced
    this.player.moveSpeed += preset.moveSpeedDelta
    this.playerState.maxHealth = Math.round(this.playerState.maxHealth * preset.maxHealthMult)
    this.playerState.health = this.playerState.maxHealth
    this.player.maxStamina = Math.max(20, this.player.maxStamina + preset.maxStaminaDelta)
    this.player.stamina = this.player.maxStamina
    this._updateHealthHud()
    this._updateStaminaHud()
  }

  _bindLoadout() {
    for (const btn of this.loadoutBtns) {
      btn.classList.toggle('active', btn.dataset.loadout === this.settings.loadout)
      btn.addEventListener('click', () => {
        const id = btn.dataset.loadout
        if (!LOADOUT_PRESETS[id]) return
        this.settings.loadout = id
        saveSettings(this.settings)
        for (const b of this.loadoutBtns) b.classList.toggle('active', b === btn)
      })
    }
  }

  // Applied once per page load (not on respawn - inventory/points already
  // survive respawns as-is, so re-granting these would let repeated
  // dying farm free items).
  _applyMetaUpgrades() {
    for (const upgrade of META_UPGRADES) {
      if (this.metaProgress.purchased.has(upgrade.id)) upgrade.apply(this)
    }
  }

  _updateCompanionName() {
    const nickname = this.settings.nickname.trim() || this._defaultNickname()
    this.companion.setName(`${nickname}'s Assistant`)
  }

  // A stable "SurvivorNNNNN" tag, generated once per browser and reused
  // every session, so players who skip the nickname field still get a
  // distinct identity instead of everyone showing up as plain "Survivor".
  _defaultNickname() {
    if (!this.settings.defaultTag) {
      this.settings.defaultTag = String(Math.floor(10000 + Math.random() * 90000))
      saveSettings(this.settings)
    }
    return `Survivor${this.settings.defaultTag}`
  }

  _toggleSettings(open) {
    this.settingsOpen = open
    this.settingsPanel.style.display = open ? 'flex' : 'none'
  }

  // Trades visual fidelity for frame rate on weaker machines: drops the
  // most expensive effects (shadows, bloom) and caps the render resolution,
  // rather than touching gameplay-affecting settings like draw distance.
  _applyPerformanceMode(enabled) {
    this.renderer.shadowMap.enabled = !enabled
    this.bloomPass.enabled = !enabled
    this.renderer.setPixelRatio(enabled ? 1 : Math.min(window.devicePixelRatio, 1.5))
  }

  // Fires on every night transition: pauses gameplay and offers 3 random
  // perks (see Perks.js) purchased with points earned from kills.
  _openPerkPanel() {
    this.perkPanelOpen = true
    this.perkPanel.style.display = 'flex'
    this.perkPanelTitle.textContent = t('perkPanelTitle')
    this.perkSkipBtn.textContent = t('perkSkip')
    // Releases pointer lock so the mouse is an actual clickable cursor
    // instead of just relative look-deltas - see the 'unlock' handler's
    // perkPanelOpen check for why this doesn't also pop the pause menu.
    this.player.controls.unlock()
    this._renderPerkOptions(rollPerks(3))
  }

  _renderPerkOptions(perks) {
    this.perkPointsLine.textContent = t('scrapLabel', { n: this.points })
    this.perkRerollBtn.textContent = t('perkRerollLabel', { n: PERK_REROLL_COST })
    this.perkRerollBtn.disabled = this.points < PERK_REROLL_COST
    this.perkOptions.innerHTML = ''
    for (const perk of perks) {
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = this.points < perk.cost
      btn.innerHTML = `
        <span class="perk-name">${t(perk.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: perk.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.points < perk.cost) return
        this.points -= perk.cost
        perk.apply(this)
        this.perksOwned.add(perk.id)
        for (const syn of checkPerkSynergies(this)) this._showLoreToast(t(syn.titleKey))
        this._updateStatsPanel()
        this._closePerkPanel()
      })
      this.perkOptions.appendChild(btn)
    }
  }

  _closePerkPanel() {
    this.perkPanelOpen = false
    this.perkPanel.style.display = 'none'
    this.player.controls.lock()
  }

  // XP needed to go from `level` to `level + 1`. Grows linearly so early
  // levels (weak starting kit) come fast and later ones space out as the
  // player already has most of the small passive buffs.
  _xpForLevel(level) {
    return 10 + level * 6
  }

  // Rewards fast, chained kills with an escalating on-screen counter -
  // resets if COMBO_WINDOW_MS passes without a follow-up kill (see the
  // fade-out check in _tick).
  _registerComboKill() {
    const now = performance.now()
    this.comboCount = now < this.comboResetAt ? this.comboCount + 1 : 1
    this.comboResetAt = now + COMBO_WINDOW_MS
    if (this.comboCount >= COMBO_MIN_DISPLAY) {
      this.comboCounter.textContent = t('comboLabel', { n: this.comboCount })
      this.comboCounter.style.display = 'block'
      this.comboCounter.classList.remove('pulse')
      void this.comboCounter.offsetWidth
      this.comboCounter.classList.add('pulse')
    }
  }

  _updateXpHud() {
    this.xpLevelBadge.textContent = String(this.xpLevel)
    this.xpFill.style.width = `${Math.min(100, (this.xp / this.xpToNext) * 100)}%`
  }

  _onXpGemCollected(value) {
    if (!this.playerState.alive) return
    this.xp += value
    this._updateXpHud()
    this._checkXpLevelUp()
  }

  // Handles one level at a time - if a big gem overflows past the next
  // threshold too, the leftover xp carries over and _renderXpLevelupOptions'
  // click handler re-checks once the panel closes.
  _checkXpLevelUp() {
    if (this.xp < this.xpToNext) return
    this.xp -= this.xpToNext
    this.xpLevel += 1
    this.xpToNext = this._xpForLevel(this.xpLevel)
    this._updateXpHud()
    this._openXpLevelupPanel()
  }

  // Fires every time the xp-gem meter fills (see _checkXpLevelUp) - offers
  // 3 free passive buffs (see XpUpgrades.js), distinct from the points-cost
  // night perks in Perks.js.
  _openXpLevelupPanel() {
    this.xpLevelupPanelOpen = true
    this.xpLevelupPanel.style.display = 'flex'
    this.xpLevelupPanelTitle.textContent = t('xpLevelupPanelTitle')
    this.player.controls.unlock()
    this._renderXpLevelupOptions(rollXpUpgrades(this, 3))
  }

  _renderXpLevelupOptions(upgrades) {
    this.xpLevelupOptions.innerHTML = ''
    for (const upgrade of upgrades) {
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.innerHTML = `<span class="perk-name">${t(upgrade.titleKey)}</span>`
      btn.addEventListener('click', () => {
        upgrade.apply(this)
        this.xpPicked.add(upgrade.id)
        if (upgrade.id === 'auto_blade_evolve' || upgrade.id === 'auto_homing_evolve') {
          this.achievements.unlock('weapon_evolved')
        }
        this._closeXpLevelupPanel()
        this._checkXpLevelUp()
      })
      this.xpLevelupOptions.appendChild(btn)
    }
  }

  _closeXpLevelupPanel() {
    this.xpLevelupPanelOpen = false
    this.xpLevelupPanel.style.display = 'none'
    // _checkXpLevelUp (called right after this, see the click handler
    // above) may immediately re-open this same panel for a chained level-up
    // from one big XP gem - that re-open calls unlock() again right after
    // this lock(), which is fine, just a redundant pair.
    this.player.controls.lock()
  }

  // Opened by pressing the interact key near the trader stall (see
  // World.js's buildTraderStall). Buying doesn't close the panel, so
  // multiple items can be bought in one visit - press interact again to leave.
  _openTraderPanel() {
    this.traderPanelOpen = true
    this.traderPanel.style.display = 'flex'
    this.traderPanelTitle.textContent = t('traderPanelTitle')
    this.traderHint.textContent = tHtml('traderHint')
    this.player.controls.unlock()
    if (!this.activeBounty) this._assignBounty()
    this._renderBounty()
    this._renderTraderOptions()
  }

  _assignBounty(excludeId) {
    const def = pickBounty(excludeId)
    this.activeBounty = { ...def, progress: 0, startNight: this.night }
  }

  _renderBounty() {
    const b = this.activeBounty
    if (!b) return
    this.bountyLineEl.textContent = t('bountyLine', {
      title: t(b.titleKey, { n: b.target }),
      progress: Math.min(b.progress, b.target),
      target: b.target,
      reward: b.reward,
    })
  }

  // Called whenever something that could satisfy the active bounty happens.
  // amount defaults to a full completion check (used by the night-count and
  // rain-night bounty types, which aren't incremented event-by-event).
  _checkBountyProgress(kind, amount = 0) {
    const b = this.activeBounty
    if (!b || b.id !== kind) return
    b.progress = Math.min(b.target, b.progress + amount)
    if (b.progress >= b.target) this._completeBounty()
  }

  _completeBounty() {
    const b = this.activeBounty
    this.points += b.reward
    this._updateStatsPanel()
    this._showLoreToast(t('bountyComplete', { title: t(b.titleKey, { n: b.target }), reward: b.reward }))
    this._assignBounty(b.id)
    if (this.traderPanelOpen) this._renderBounty()
  }

  // Rolled once per night-round (see _rollWeather's call sites) - a random
  // shop item at a discount, so there's a reason to check the trader every
  // night instead of just once.
  _rollFeaturedItem() {
    this.featuredItem = SHOP_ITEMS[Math.floor(Math.random() * SHOP_ITEMS.length)]
  }

  // Every SHOP_ITEMS entry gets its own random price swing for the night -
  // some items run cheap, some run pricy, so which items are worth buying
  // shifts night to night instead of the price list being static. Stacks
  // independently on top of the featured item's flat 30% discount.
  _rollTraderPrices() {
    this.traderPriceMults = {}
    for (const item of SHOP_ITEMS) {
      this.traderPriceMults[item.id] = 0.75 + Math.random() * 0.6
    }
  }

  _traderPrice(item) {
    const mult = this.traderPriceMults?.[item.id] ?? 1
    const discountMult = this.metaProgress.purchased.has('traderDiscount') ? 0.85 : 1
    return Math.max(1, Math.round(item.cost * mult * discountMult))
  }

  _renderTraderOptions() {
    this.traderPointsLine.textContent = t('scrapLabel', { n: this.points })
    this.traderOptions.innerHTML = ''

    if (this.featuredItem) {
      const item = this.featuredItem
      const cost = Math.round(this._traderPrice(item) * 0.7)
      const btn = document.createElement('button')
      btn.className = 'perk-option featured'
      btn.disabled = this.points < cost
      btn.innerHTML = `
        <span class="perk-name">${t('traderFeaturedLabel')}: ${t(item.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.points < cost) return
        this.points -= cost
        item.give(this)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }

    for (const item of SHOP_ITEMS) {
      if (item === this.featuredItem) continue
      const owned = item.isOwned && item.isOwned(this)
      const cost = this._traderPrice(item)
      const pctDelta = Math.round((cost / item.cost - 1) * 100)
      const priceTagHtml = pctDelta <= -10
        ? `<span class="price-tag price-down">${pctDelta}%</span>`
        : pctDelta >= 10
          ? `<span class="price-tag price-up">+${pctDelta}%</span>`
          : ''
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = owned || this.points < cost
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)}</span>
        <span class="perk-cost">${owned ? t('upgradesOwned') : `${t('perkCostLabel', { n: cost })} ${priceTagHtml}`}</span>
      `
      btn.addEventListener('click', () => {
        if (owned || this.points < cost) return
        this.points -= cost
        item.give(this)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }

    this._renderSalvageOptions()
    this._renderBlackMarketOptions()
  }

  // Only visible once Achievements.js's 'centurion' has ever been unlocked
  // (see achievements.unlocked, persisted across runs) - a permanent
  // reputation-gated tier rather than a one-run bonus.
  _renderBlackMarketOptions() {
    this.traderBlackMarketOptions.innerHTML = ''
    const show = this.achievements.unlocked.has('centurion')
    this.traderBlackMarketTitle.style.display = show ? '' : 'none'
    this.traderBlackMarketOptions.style.display = show ? '' : 'none'
    if (!show) return

    this.traderBlackMarketTitle.textContent = t('blackMarketSectionLabel')
    for (const item of BLACK_MARKET_ITEMS) {
      const btn = document.createElement('button')
      btn.className = 'perk-option blackmarket'
      btn.disabled = this.points < item.cost
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: item.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.points < item.cost) return
        this.points -= item.cost
        item.give(this)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderBlackMarketOptions.appendChild(btn)
    }
  }

  _renderSalvageOptions() {
    this.traderSalvageOptions.innerHTML = ''
    const available = SALVAGE_ITEMS.filter((item) => this.inventory[item.invKey] > 0)
    const show = available.length > 0
    this.traderSalvageTitle.style.display = show ? '' : 'none'
    this.traderSalvageOptions.style.display = show ? '' : 'none'
    if (!show) return

    this.traderSalvageTitle.textContent = t('salvageSectionLabel')
    for (const item of available) {
      const btn = document.createElement('button')
      btn.className = 'perk-option salvage'
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)} (${this.inventory[item.invKey]})</span>
        <span class="perk-cost salvage-gain">${t('salvageGainLabel', { n: item.sellValue })}</span>
      `
      btn.addEventListener('click', () => {
        if (!item.sell(this)) return
        this.points += item.sellValue
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderSalvageOptions.appendChild(btn)
    }
  }

  _closeTraderPanel() {
    this.traderPanelOpen = false
    this.traderPanel.style.display = 'none'
    this.player.controls.lock()
  }

  // Opened from the main menu (not gameplay) - spends persistent Legacy
  // Points (see MetaProgress.js) on one-time permanent upgrades.
  _openUpgradesPanel() {
    // Opened from the pause overlay (still on screen, unlocked) as well as
    // the main menu - hide it explicitly rather than relying on DOM/paint
    // order, since #pause-overlay comes after #upgrades-panel in index.html
    // and would otherwise render on top and eat every click meant for an
    // upgrade card underneath it.
    this.pauseOverlay.style.display = 'none'
    this.upgradesPanel.style.display = 'flex'
    this.upgradesPanelTitle.textContent = t('upgradesPanelTitle')
    this.upgradesCloseBtn.textContent = t('upgradesClose')
    this._renderUpgradesOptions()
  }

  _renderUpgradesOptions() {
    this.upgradesPointsLine.textContent = t('legacyScrapLabel', { n: this.metaProgress.legacyPoints })
    this.upgradesOptions.innerHTML = ''
    for (const upgrade of META_UPGRADES) {
      const owned = this.metaProgress.purchased.has(upgrade.id)
      const locked = !!upgrade.requires && !this.metaProgress.purchased.has(upgrade.requires)
      const btn = document.createElement('button')
      btn.className = locked ? 'perk-option locked' : 'perk-option'
      btn.disabled = owned || locked || this.metaProgress.legacyPoints < upgrade.cost
      const costLine = owned
        ? t('upgradesOwned')
        : locked
          ? t('upgradesRequires', { name: t(META_UPGRADES.find((u) => u.id === upgrade.requires)?.titleKey) })
          : t('perkCostLabel', { n: upgrade.cost })
      btn.innerHTML = `
        <span class="perk-name">${t(upgrade.titleKey)}</span>
        <span class="perk-cost">${costLine}</span>
      `
      btn.addEventListener('click', () => {
        if (owned || locked || this.metaProgress.legacyPoints < upgrade.cost) return
        this.metaProgress.legacyPoints -= upgrade.cost
        this.metaProgress.purchased.add(upgrade.id)
        saveMetaProgress(this.metaProgress)
        this._renderUpgradesOptions()
      })
      this.upgradesOptions.appendChild(btn)
    }

    // Gated behind the same milestone as Nightmare difficulty (see the
    // constructor's diff-nightmare toggle) - both read as "you've actually
    // beaten the game," which is the bar for offering a full reset+bonus.
    const prestigeUnlocked = this.achievements.unlocked.has('true_ending')
    this.prestigeSection.style.display = prestigeUnlocked ? 'block' : 'none'
    if (prestigeUnlocked) {
      this.prestigeLevelLine.textContent = t('prestigeLevelLine', { level: this.metaProgress.prestigeLevel, bonus: this.metaProgress.prestigeLevel * 10 })
      this.prestigeBtn.textContent = t('prestigeBtn')
    }
  }

  // Irreversible from the player's side (wipes Legacy Points and every
  // purchased Permanent Upgrade), so gated behind a real confirm dialog
  // rather than a single click, unlike everything else in this panel.
  _prestige() {
    if (!window.confirm(t('prestigeConfirm'))) return
    this.metaProgress.prestigeLevel += 1
    this.metaProgress.legacyPoints = 0
    this.metaProgress.purchased = new Set()
    saveMetaProgress(this.metaProgress)
    this._showLoreToast(t('prestigeComplete', { level: this.metaProgress.prestigeLevel, bonus: this.metaProgress.prestigeLevel * 10 }))
    this._renderUpgradesOptions()
  }

  _closeUpgradesPanel() {
    this.upgradesPanel.style.display = 'none'
    if (this.gameStarted) this.pauseOverlay.style.display = 'flex'
  }

  // Cosmetic skins bought with coins live in this same panel (see
  // CoinShop.js) rather than a separate Skins shop - equipping one reskins
  // every gun at once (see WeaponSystem.setSkinAllGuns), not just one
  // weapon. 'gold' may already be owned+equipped for free via the Centurion
  // achievement (see the constructor), and both skins and stat perks share
  // this one render loop.
  _openCoinShopPanel() {
    this.pauseOverlay.style.display = 'none'
    this.coinshopPanel.style.display = 'flex'
    this.coinshopPanelTitle.textContent = t('coinshopPanelTitle')
    this.coinshopCloseBtn.textContent = t('upgradesClose')
    this._renderCoinShopOptions()
  }

  _renderCoinShopOptions() {
    this.coinshopCoinLine.textContent = t('coinsLabel', { n: this.coins })
    this.coinshopOptions.innerHTML = ''

    const sections = [
      { id: 'guns', labelKey: 'shopSectionGuns' },
      { id: 'weapons', labelKey: 'shopSectionWeapons' },
      { id: 'skins', labelKey: 'shopSectionSkins' },
      { id: 'perks', labelKey: 'shopSectionPerks' },
    ]

    for (const section of sections) {
      const heading = document.createElement('h3')
      heading.className = 'shop-section-heading'
      heading.textContent = t(section.labelKey)
      this.coinshopOptions.appendChild(heading)

      const row = document.createElement('div')
      row.className = 'perk-options shop-section-row'
      this.coinshopOptions.appendChild(row)

      // Every weapon the player has (or could buy) in one place, so
      // switching back to an already-owned gun never depends on
      // remembering its number key - buying a gun elsewhere in this same
      // panel doesn't auto-refresh this list, but closing/reopening Shop
      // does (see _renderCoinShopOptions being re-run on every purchase).
      if (section.id === 'weapons') {
        for (const w of this.weapons.getSummary()) {
          const wrap = document.createElement('div')
          wrap.className = 'weapon-slot-wrap'

          const btn = document.createElement('button')
          btn.className = 'perk-option'
          const equipped = this.weapons.current.id === w.id
          btn.disabled = equipped || !w.unlocked
          btn.innerHTML = `
            <span class="perk-name">${t(w.nameKey)}</span>
            <span class="perk-cost">${equipped ? t('skinEquipped') : w.unlocked ? t('skinEquip') : t('lockedLabel')}</span>
          `
          btn.addEventListener('click', () => {
            if (equipped || !w.unlocked) return
            const index = this.weapons.weapons.findIndex((ww) => ww.id === w.id)
            if (index !== -1) this.weapons.switchToIndex(index)
            this._renderCoinShopOptions()
          })
          wrap.appendChild(btn)

          // Per-gun permanent attachments (see CoinShop.js's
          // ATTACHMENT_TYPES) - melee has no ammo/scope/sound to attach to,
          // and every attachment needs the gun owned first.
          if (w.id !== 'melee' && w.unlocked) {
            const ownedFlags = { scope: w.scopeOwned, extmag: w.hasExtMag, suppressor: w.suppressed }
            const attachRow = document.createElement('div')
            attachRow.className = 'attach-row'
            for (const at of ATTACHMENT_TYPES) {
              const owned = ownedFlags[at.id]
              const abtn = document.createElement('button')
              abtn.className = 'attach-btn'
              abtn.disabled = owned || this.coins < at.cost
              abtn.innerHTML = `
                <span>${t(at.titleKey)}</span>
                <span>${owned ? t('attachOwned') : t('coinCostLabel', { n: at.cost })}</span>
              `
              abtn.addEventListener('click', () => {
                if (owned || this.coins < at.cost) return
                this.coins -= at.cost
                this.weapons.applyAttachment(w.id, at.id)
                this._updateStatsPanel()
                this._renderCoinShopOptions()
              })
              attachRow.appendChild(abtn)
            }
            wrap.appendChild(attachRow)
          }

          row.appendChild(wrap)
        }
      }

      // The "unequip skin" option belongs at the front of the Skins
      // section, not as its own top-level item outside any section.
      if (section.id === 'skins') {
        const defaultBtn = document.createElement('button')
        defaultBtn.className = 'perk-option'
        defaultBtn.disabled = this.equippedSkin === null
        defaultBtn.innerHTML = `
          <span class="perk-name">${t('skinDefault')}</span>
          <span class="perk-cost">${this.equippedSkin === null ? t('skinEquipped') : t('skinEquip')}</span>
        `
        defaultBtn.addEventListener('click', () => {
          this.equippedSkin = null
          this.weapons.setSkinAllGuns(null)
          this._renderCoinShopOptions()
        })
        row.appendChild(defaultBtn)
      }

      for (const item of COIN_SHOP_ITEMS) {
        if (item.section !== section.id) continue
        const btn = document.createElement('button')
        btn.className = 'perk-option'

        if (item.skin) {
          const owned = this.ownedSkins.has(item.skin)
          const equipped = this.equippedSkin === item.skin
          btn.disabled = equipped || (!owned && this.coins < item.cost)
          btn.innerHTML = `
            <span class="perk-name">${t(item.titleKey)}</span>
            <span class="perk-cost">${equipped ? t('skinEquipped') : owned ? t('skinEquip') : t('coinCostLabel', { n: item.cost })}</span>
          `
          btn.addEventListener('click', () => {
            if (equipped) return
            if (!owned) {
              if (this.coins < item.cost) return
              this.coins -= item.cost
              this.ownedSkins.add(item.skin)
              this._updateStatsPanel()
            }
            this.equippedSkin = item.skin
            this.weapons.setSkinAllGuns(item.skin)
            this._renderCoinShopOptions()
          })
        } else if (item.gun) {
          const weapon = this.weapons.weapons.find((w) => w.id === item.gun)
          const owned = !!weapon?.unlocked
          btn.disabled = owned || this.coins < item.cost
          btn.innerHTML = `
            <span class="perk-name">${t(item.titleKey)}</span>
            <span class="perk-cost">${owned ? t('upgradesOwned') : t('coinCostLabel', { n: item.cost })}</span>
          `
          btn.addEventListener('click', () => {
            if (owned || this.coins < item.cost) return
            this.coins -= item.cost
            this.weapons.unlockWeapon(item.gun)
            if (item.onUnlock) item.onUnlock(this)
            this._updateStatsPanel()
            this._renderCoinShopOptions()
          })
        } else {
          const owned = item.isOwned(this)
          btn.disabled = owned || this.coins < item.cost
          btn.innerHTML = `
            <span class="perk-name">${t(item.titleKey)}</span>
            <span class="perk-cost">${owned ? t('upgradesOwned') : t('coinCostLabel', { n: item.cost })}</span>
          `
          btn.addEventListener('click', () => {
            if (owned || this.coins < item.cost) return
            this.coins -= item.cost
            item.apply(this)
            this._updateStatsPanel()
            this._renderCoinShopOptions()
          })
        }
        row.appendChild(btn)
      }
    }
  }

  _closeCoinShopPanel() {
    this.coinshopPanel.style.display = 'none'
    if (this.gameStarted) this.pauseOverlay.style.display = 'flex'
  }

  _showCoinPopup(amount) {
    this.coinPopupEl.textContent = t('coinPopup', { n: amount })
    this.coinPopupEl.classList.remove('show')
    void this.coinPopupEl.offsetWidth
    this.coinPopupEl.classList.add('show')
  }

  _openAchievementsPanel() {
    this.achievementsPanel.style.display = 'flex'
    this.achievementsPanelTitle.textContent = t('achievementsPanelTitle')
    this.achievementsCloseBtn.textContent = t('upgradesClose')
    this.achievementsOptions.innerHTML = ''
    for (const ach of ACHIEVEMENTS) {
      const unlocked = this.achievements.unlocked.has(ach.id)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = true
      btn.innerHTML = `
        <span class="perk-name">${unlocked ? t(ach.titleKey) : '???'}</span>
        <span class="perk-cost">${unlocked ? t('achievementUnlocked') : t('achievementLocked')}</span>
      `
      this.achievementsOptions.appendChild(btn)
    }
  }

  _closeAchievementsPanel() {
    this.achievementsPanel.style.display = 'none'
  }

  _openBestiaryPanel() {
    this.bestiaryPanel.style.display = 'flex'
    this.bestiaryPanelTitle.textContent = t('bestiaryPanelTitle')
    this.bestiaryCloseBtn.textContent = t('upgradesClose')
    this.bestiaryOptions.innerHTML = ''
    for (const type of Object.values(ZOMBIE_TYPES)) {
      const known = this.bestiaryEncountered.has(type.id)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = true
      btn.innerHTML = `
        <span class="perk-name">${known ? type.label : '???'}</span>
        <span class="perk-cost">${known ? t('achievementUnlocked') : t('achievementLocked')}</span>
        <span class="perk-lore">${known ? type.lore : t('bestiaryUnknown')}</span>
      `
      this.bestiaryOptions.appendChild(btn)
    }
  }

  _closeBestiaryPanel() {
    this.bestiaryPanel.style.display = 'none'
  }

  // Entering/exiting the drivable car (see Vehicle.js). While driving, the
  // rest of the world simulation pauses - same as it already does for the
  // inventory/perk menus - so this is a "drive around and explore" feature
  // rather than a way to outrun zombies; the player can't shoot or take
  // damage while behind the wheel.
  _enterVehicle() {
    this.driving = true
    this.vehicle.occupied = true
    // Third-person doesn't track the vehicle seat (_updateThirdPerson only
    // runs in the on-foot branch of the tick loop) - force back to first
    // person so the render camera doesn't freeze wherever it last was.
    this.thirdPerson = false
    this.renderPass.camera = this.camera
    this.playerBody.update(0, 0, 0, 0, false)
    this.weapons.viewmodelRoot.visible = false
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.hotbarEl.style.display = 'none'
    this.interactPrompt.innerHTML = tHtml('interactExitVehicle')
    this.interactPrompt.style.display = 'block'
  }

  _exitVehicle() {
    this.driving = false
    this.vehicle.occupied = false
    this.vehicle.speed = 0
    this.weapons.viewmodelRoot.visible = true
    this.crosshair.style.display = 'block'
    this.hudEl.style.display = 'block'
    this.hotbarEl.style.display = 'flex'
    this.interactPrompt.style.display = 'none'

    const exitPos = this.vehicle.getExitWorld(this._vehicleSeatPos)
    const groundY = this.player.sampleGroundHeight(exitPos.x, exitPos.z)
    this.player.controls.object.position.set(exitPos.x, groundY + this.player.eyeHeight, exitPos.z)
    this.player.velocity.set(0, 0, 0)
  }

  // Re-renders every static UI string in the current language. Called once
  // at startup and again whenever the player picks a different language.
  _applyLanguage() {
    document.getElementById('menu-subtitle').textContent = t('menuSubtitle')
    document.getElementById('menu-subhint').textContent = t('menuSubhint')
    this.playBtn.textContent = t('playBtn')
    this.settingsBtn.textContent = t('settingsBtn')
    this.upgradesBtn.textContent = t('upgradesBtn')
    this.achievementsBtn.textContent = t('achievementsBtn')
    this.bestiaryBtn.textContent = t('bestiaryBtn')
    this.coinshopBtn.textContent = t('coinshopBtn')
    document.getElementById('stats-coins-label').textContent = t('coinsStatLabel')

    document.getElementById('ctrl-line-1').innerHTML = tHtml('ctrlLine1')
    document.getElementById('ctrl-line-2').innerHTML = tHtml('ctrlLine2')
    document.getElementById('ctrl-line-3').innerHTML = tHtml('ctrlLine3')
    document.getElementById('ctrl-line-4').innerHTML = tHtml('ctrlLine4')
    document.getElementById('ctrl-line-5').innerHTML = tHtml('ctrlLine5')

    this.interactPrompt.innerHTML = tHtml('interactPrompt')

    document.getElementById('settings-title').textContent = t('settingsTitle')
    document.getElementById('tab-language').textContent = t('tabLanguage')
    document.getElementById('tab-audio').textContent = t('tabAudio')
    document.getElementById('tab-controls').textContent = t('tabControls')
    this.resetBindsBtn.textContent = t('resetBinds')
    this._renderControlsGrid()
    document.getElementById('music-label').textContent = t('musicLabel')
    document.getElementById('sfx-label').textContent = t('sfxLabel')
    document.getElementById('sensitivity-label').textContent = t('sensitivityLabel')
    document.getElementById('fov-label').textContent = t('fovLabel')
    document.getElementById('colorblind-label').textContent = t('colorblindLabel')
    document.getElementById('performance-label').textContent = t('performanceLabel')
    this.compassTrader.textContent = t('compassTrader')
    this.compassAmmo.textContent = t('compassAmmo')
    this.compassVehicle.textContent = t('compassVehicle')
    this.compassAirdrop.textContent = t('compassAirdrop')
    document.getElementById('infection-label').textContent = t('infectionLabel')
    document.getElementById('settings-hint').innerHTML = tHtml('settingsHint')

    document.getElementById('death-title').textContent = t('deathTitle')
    this.respawnBtn.textContent = t('respawnBtn')
    document.getElementById('extraction-title').textContent = t('extractionTitle')
    this.extractionContinueBtn.textContent = t('extractionContinueBtn')

    document.getElementById('inventory-title').textContent = t('inventoryTitle')
    document.getElementById('panel-health-label').textContent = t('healthPackLabel')
    document.getElementById('panel-armor-label').textContent = t('armorPackLabel')
    document.getElementById('panel-noisemaker-label').textContent = t('noisemakerLabel')
    document.getElementById('panel-grenade-label').textContent = t('grenadeLabel')
    document.getElementById('panel-barricade-label').textContent = t('barricadeLabel')
    document.getElementById('panel-trap-label').textContent = t('trapLabel')
    document.getElementById('panel-molotov-label').textContent = t('molotovLabel')
    document.getElementById('panel-c4-label').textContent = t('c4Label')
    document.getElementById('panel-adrenaline-label').textContent = t('adrenalineLabel')
    document.getElementById('panel-emp-label').textContent = t('empLabel')
    document.getElementById('weapons-title').textContent = t('weaponsTitle')
    document.getElementById('inventory-hint').innerHTML = tHtml('inventoryHint')

    document.getElementById('stats-day-label').textContent = t('dayLabel')
    document.getElementById('stats-deaths-label').textContent = t('deathsLabel')
    document.getElementById('stats-kills-label').textContent = t('killsLabel')
    document.getElementById('stats-points-label').textContent = t('scrapStatLabel')

    document.getElementById('diff-easy').textContent = t('difficultyEasy')
    document.getElementById('diff-normal').textContent = t('difficultyNormal')
    document.getElementById('diff-hard').textContent = t('difficultyHard')
    document.getElementById('diff-nightmare').textContent = t('difficultyNightmare')

    const roleLabelKeys = { ranged: 'roleRanged', melee: 'roleMelee', medic: 'roleMedic' }
    for (const btn of this.roleBtns) btn.textContent = t(roleLabelKeys[btn.dataset.role])
    const loadoutLabelKeys = { balanced: 'loadoutBalanced', runner: 'loadoutRunner', tank: 'loadoutTank' }
    for (const btn of this.loadoutBtns) btn.textContent = t(loadoutLabelKeys[btn.dataset.loadout])
    document.getElementById('score-attack-label').textContent = t('scoreAttackLabel')
    document.getElementById('hardcore-label').textContent = t('hardcoreLabel')
    document.getElementById('mutator-horde-rush-label').textContent = t('mutatorHordeRush')
    document.getElementById('mutator-loot-rush-label').textContent = t('mutatorLootRush')
    document.getElementById('mutator-pure-gunplay-label').textContent = t('mutatorPureGunplay')
    document.getElementById('mutator-boss-rush-label').textContent = t('mutatorBossRush')
    document.getElementById('mutator-horde-mode-label').textContent = t('mutatorHordeMode')
    document.getElementById('mutator-koth-label').textContent = t('mutatorKoth')
    document.getElementById('mutator-extraction-label').textContent = t('mutatorExtraction')
    document.getElementById('mutator-daily-label').textContent = t('mutatorDaily')

    this._updateBestStatsDisplay()
    if (this.inventoryOpen) this._refreshInventoryPanel()
    this._updateProgressHud()
  }

  _updateBestStatsDisplay() {
    const { bestNight, bestKills } = this.bestStats
    if (bestNight === 0 && bestKills === 0) {
      this.menuBestStats.textContent = ''
      return
    }
    this.menuBestStats.textContent =
      `${t('bestLabel')}: ${t('hudNight', { n: bestNight })} · ${t('hudKills', { n: bestKills })}`
  }

  _refreshInventoryPanel() {
    this.panelHealthCount.textContent = this.inventory.healthPacks
    this.panelArmorCount.textContent = this.inventory.armorPacks
    this.panelNoisemakerCount.textContent = this.inventory.noisemakers
    this.panelGrenadeCount.textContent = this.inventory.grenades
    this.panelBarricadeCount.textContent = this.inventory.barricades
    this.panelTrapCount.textContent = this.inventory.traps
    this.panelMolotovCount.textContent = this.inventory.molotovs
    this.panelC4Count.textContent = this.inventory.c4
    this.panelAdrenalineCount.textContent = this.inventory.adrenaline
    this.panelEmpCount.textContent = this.inventory.emp

    this.panelWeaponsList.innerHTML = this.weapons
      .getSummary()
      .map((w) => {
        const mastered = w.masteryMult > 1
        const kills = this.weaponMastery.kills[w.id] || 0
        const masteryTag = mastered
          ? `<span class="mastery-tag mastered" title="${t('masteryMasteredTitle', { pct: Math.round((MASTERY_DAMAGE_MULT - 1) * 100) })}">★</span>`
          : w.unlocked
            ? `<span class="mastery-tag" title="${t('masteryProgressTitle')}">${Math.min(kills, MASTERY_THRESHOLD)}/${MASTERY_THRESHOLD}</span>`
            : ''
        const name = `${t(w.nameKey)} ${masteryTag}`
        const slotButtons = this.settings.hotbar
          .map((slotWeaponId, i) => {
            const assigned = slotWeaponId === w.id
            return `<button class="hotbar-assign-btn${assigned ? ' assigned' : ''}" data-slot="${i}" data-weapon="${w.id}" ${w.unlocked ? '' : 'disabled'} title="Put in hotbar slot ${i + 1}">${i + 1}</button>`
          })
          .join('')
        return `
        <div class="inv-panel-row">
          <span>${name}</span>
          <span>${w.unlocked ? `${w.ammoInMag} / ${w.ammoReserve}` : t('lockedLabel')}</span>
          <span class="hotbar-assign-row">${slotButtons}</span>
        </div>
      `
      })
      .join('')
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.tpCamera.aspect = window.innerWidth / window.innerHeight
    this.tpCamera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
    this.bloomPass.resolution.set(window.innerWidth, window.innerHeight)
  }

  // Positions the third-person camera behind+above the player rig (this.
  // camera, which PointerLockControls still owns and every other system
  // still reads as "the player") and points the visible player body model
  // at the same spot. The offset is built from yaw alone (not pitch) so the
  // camera doesn't dip into the ground/fly up when aiming up/down - only
  // the final look direction (copied separately) uses full pitch.
  _updateThirdPerson() {
    const eyeHeight = this.player.eyeHeight
    const feetX = this.camera.position.x
    const feetY = this.camera.position.y - eyeHeight
    const feetZ = this.camera.position.z

    if (!this.thirdPerson) {
      this.playerBody.update(feetX, feetY, feetZ, 0, false)
      this.renderPass.camera = this.camera
      return
    }

    const yaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y
    this.playerBody.update(feetX, feetY, feetZ, yaw, true)

    this._tpYawQuat.setFromEuler(new THREE.Euler(0, yaw, 0))
    this._tpDesiredPos.copy(this._tpOffsetLocal).applyQuaternion(this._tpYawQuat).add(this.camera.position)

    this._tpRayDir.copy(this._tpDesiredPos).sub(this.camera.position)
    const fullDist = this._tpRayDir.length()
    let dist = fullDist
    if (fullDist > 0.001) {
      this._tpRayDir.normalize()
      this._tpRaycaster.set(this.camera.position, this._tpRayDir)
      this._tpRaycaster.far = fullDist
      const hits = this._tpRaycaster.intersectObjects(this.player.groundMeshes, true)
      if (hits.length > 0) dist = Math.max(0.3, hits[0].distance - 0.2)
    }

    this.tpCamera.position.copy(this.camera.position).addScaledVector(this._tpRayDir, dist)
    this.tpCamera.quaternion.copy(this.camera.quaternion)
    this.tpCamera.fov = this.camera.fov
    this.tpCamera.updateProjectionMatrix()

    this.renderPass.camera = this.tpCamera
  }

  // Left 4 Dead-style Director - re-evaluates every DIRECTOR_EVAL_INTERVAL_MS
  // and hands ZombieManager a pressure multiplier based on how the run is
  // actually going (health, time since last hit, resources, recent kill
  // pace) instead of pressure being purely a function of night number.
  // Never removes zombies that already exist - easing off just throttles
  // future spawns (see ZombieManager.setDirectorMult), so it can never feel
  // like enemies vanish out from under the player.
  _updateDirectorAI() {
    const now = performance.now()
    if (now < this.nextDirectorEvalAt) return
    this.nextDirectorEvalAt = now + DIRECTOR_EVAL_INTERVAL_MS

    this.recentKillTimestamps = this.recentKillTimestamps.filter((t) => now - t <= DIRECTOR_KILL_WINDOW_MS)

    const healthPct = this.playerState.maxHealth > 0 ? this.playerState.health / this.playerState.maxHealth : 1
    const secsSinceHit = (now - this.lastHitTakenAt) / 1000
    const lowResources = this.inventory.healthPacks === 0 && this.inventory.armorPacks === 0
    const recentKills = this.recentKillTimestamps.length

    let score = 0
    if (healthPct < 0.3) score -= 0.45
    else if (healthPct > 0.75) score += 0.1

    // Brief relief window right after a hit lands, then ramps up the
    // longer things stay quiet - the classic L4D "lull, then throw a
    // horde" rhythm instead of constant flat pressure.
    if (secsSinceHit < 5) score -= 0.2
    else if (secsSinceHit > 25) score += 0.25

    if (lowResources) score -= 0.15

    score += Math.min(0.25, recentKills * 0.03)

    const mult = Math.max(DIRECTOR_MIN_MULT, Math.min(DIRECTOR_MAX_MULT, 1 + score))
    this.zombies.setDirectorMult(mult)
  }

  _onZombieAttack(damage) {
    if (this.player.isDodging) return // brief invincibility window - see PlayerController's dodge
    this.lastHitTakenAt = performance.now()
    this.playerState.takeDamage(damage * this.difficulty.damageMult * this.dailyDamageMult)
    this._updateHealthHud()
    audioEngine.playZombieSnarl()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.12, 220)

    if (!this.playerState.alive) this._onPlayerDeath()
  }

  // Same damage/UI pipeline as _onZombieAttack, minus the zombie-specific
  // snarl sound - rival scavengers (see RivalScavenger.js) already play
  // their own gunshot when they fire.
  _onRivalAttack(damage) {
    if (this.player.isDodging) return
    this.lastHitTakenAt = performance.now()
    this.playerState.takeDamage(damage * this.difficulty.damageMult * this.dailyDamageMult)
    this._updateHealthHud()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.1, 180)

    if (!this.playerState.alive) this._onPlayerDeath()
  }

  // Camera juice: a brief random position jitter (see _updateShake, called
  // once per tick) plus an optional freeze-frame. Only overwrites the
  // current shake if the new one is stronger, so a big damage-taken shake
  // doesn't get cut short by a small hit-landed shake a moment later.
  _triggerShake(magnitude, durationMs) {
    if (magnitude < this._shakeMagnitude) return
    this._shakeMagnitude = magnitude
    this._shakeDuration = durationMs / 1000
    this._shakeTime = this._shakeDuration
  }

  // Fired by WeaponSystem when a melee hit lands on a zombie facing away
  // from the player (see _fire's dot-product check) - purely a counter +
  // achievement hook, the guaranteed-kill damage itself is already applied
  // by the time this runs.
  _onStealthTakedown() {
    this.stealthTakedowns += 1
    this._triggerShake(0.07, 100)
    if (this.stealthTakedowns >= 10) this.achievements.unlock('shadow_hunter')
  }

  _triggerHitstop(ms) {
    this._hitstopUntil = Math.max(this._hitstopUntil, performance.now() + ms)
  }

  // Slow-mo + camera zoom on the killing blow against a boss-tier zombie
  // (see the BOSS_TIER_IDS check in _onZombieKilled) - the fov pull-in is
  // applied every frame in _tick (after WeaponSystem's own aim-fov lerp
  // runs, so it wins for the frame) rather than owning the camera outright,
  // since WeaponSystem re-asserts fov from scratch every frame regardless.
  _triggerBossKillcam() {
    this.killcamUntil = performance.now() + KILLCAM_DURATION_MS
    this.nightBanner.textContent = t('toastBossDefeated')
    this.nightBanner.classList.remove('show')
    void this.nightBanner.offsetWidth
    this.nightBanner.classList.add('show')
  }

  _updateShake(dt) {
    if (this._shakeTime > 0) {
      this._shakeTime = Math.max(0, this._shakeTime - dt)
      const mag = this._shakeMagnitude * (this._shakeTime / this._shakeDuration)
      this._shakeOffset.set(
        (Math.random() - 0.5) * 2 * mag,
        (Math.random() - 0.5) * 2 * mag * 0.6,
        (Math.random() - 0.5) * 2 * mag
      )
    } else {
      this._shakeOffset.set(0, 0, 0)
    }
  }

  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering = false) {
    this.kills += 1
    this.totalKills += 1
    this.recentKillTimestamps.push(performance.now())
    // Wandering horde members (see ZombieManager's _maybeSpawnWanderingHorde)
    // are worth intercepting for their own sake rather than just background
    // population you happen to run into - a small guaranteed bonus per kill,
    // on top of (not instead of) the normal 25%-chance points roll below.
    if (isWandering) {
      this.points += 5
      this._updateStatsPanel()
    }
    const lootMult = this.settings.mutators.lootRush ? 2 : 1
    this.xpGems.spawn(x, z, (isElite ? 4 : 1) * lootMult)
    if (isElite) {
      this.eliteKills += 1
      if (this.eliteKills >= 5) this.achievements.unlock('elite_hunter')
    }
    if (weaponId === 'vehicle') this.achievements.unlock('road_kill')
    this._registerComboKill()
    if (this.kills % 10 === 0) {
      this._companionBark('killStreak')
      // Guaranteed loot every 10th kill - replaces the old flat per-kill
      // random-chance drop so supplies come from actually fighting instead
      // of the world just handing them out.
      this.pickups.spawnKillDrop(x, z)
    }
    this.achievements.unlock('first_blood')
    if (this.totalKills >= 100) this.achievements.unlock('centurion')
    if (zombieTypeId === 'brute' && weaponId === 'melee') this.achievements.unlock('brute_knife')
    if (zombieTypeId === 'screamer') this._checkBountyProgress('kill_screamers', 1)
    if (weaponId === 'melee') this._checkBountyProgress('melee_kills', 1)
    if (weaponId === 'minigun') {
      this.killCountsByWeapon.minigun = (this.killCountsByWeapon.minigun || 0) + 1
      if (this.killCountsByWeapon.minigun >= 50) this.achievements.unlock('meat_grinder')
    }
    this._trackWeaponMastery(weaponId)
    if (Math.random() < 0.25) {
      this.points += (2 + Math.floor(Math.random() * 4)) * lootMult
      this._updateStatsPanel()
    }

    // Coins: a separate, guaranteed-every-kill currency (unlike points'
    // 25%-chance drop) spent exclusively in the Coin Shop - see CoinShop.js.
    let coinsEarned
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      coinsEarned = 300 + Math.floor(Math.random() * 201)
      this._triggerBossKillcam()
    } else if (isElite) {
      coinsEarned = 20 + Math.floor(Math.random() * 181)
    } else {
      coinsEarned = 10 + Math.floor(Math.random() * 91)
    }
    this.coins += coinsEarned
    this._showCoinPopup(coinsEarned)
    this._updateStatsPanel()
    this._maybeDropObstacle(x, z)

    if (!this.bestiaryEncountered.has(zombieTypeId)) {
      this.bestiaryEncountered.add(zombieTypeId)
      saveEncountered(this.bestiaryEncountered)
      if (this.bestiaryEncountered.size >= Object.keys(ZOMBIE_TYPES).length) {
        this.achievements.unlock('bestiary_master')
        if (!this.ownedSkins.has('obsidian')) {
          this.ownedSkins.add('obsidian')
          this._showLoreToast(t('obsidianSkinUnlocked'))
        }
      }
    }

    // Guaranteed boss loot - on top of the normal chance-based ammo drop,
    // not instead of it.
    if (zombieTypeId === 'colossus') this.pickups.spawnLootDrop('extended_mag', x, z)
  }

  // Persistent per-weapon kill tally (see WeaponMastery.js) - only counts
  // toward mastery if weaponId actually names one of WeaponSystem's real
  // guns/melee slot, not an environmental kill source (trap/C4/vehicle/etc,
  // none of which have a matching weapons[] entry to apply a bonus to).
  _trackWeaponMastery(weaponId) {
    if (this.weaponMastery.mastered.has(weaponId)) return
    const w = this.weapons.weapons.find((w) => w.id === weaponId)
    if (!w) return

    this.weaponMastery.kills[weaponId] = (this.weaponMastery.kills[weaponId] || 0) + 1
    if (this.weaponMastery.kills[weaponId] >= MASTERY_THRESHOLD) {
      this.weaponMastery.mastered.add(weaponId)
      w.masteryMult = MASTERY_DAMAGE_MULT
      this._showLoreToast(t('toastWeaponMastered', { weapon: t(this.weapons._nameKeyFor(w)) }))
    }
    saveMastery(this.weaponMastery)
  }

  _showAchievementToast(def) {
    this.achievementLabel.textContent = t('achievementUnlocked')
    this.achievementTitle.textContent = t(def.titleKey)
    this.achievementToast.classList.remove('show')
    void this.achievementToast.offsetWidth
    this.achievementToast.classList.add('show')

    if (def.id === 'centurion') this.weapons.setWeaponSkin('pistol', 'gold')
    this._updateTrophyWall()
  }

  // Lights up one medallion per unlocked achievement on the safe zone's
  // physical trophy wall (see World.js's buildTrophyWall) - called once at
  // startup (covers achievements already unlocked in a past session) and
  // again every time a new one unlocks.
  _updateTrophyWall() {
    ACHIEVEMENTS.forEach((ach, i) => {
      const mat = this.trophyWall.medallions[i]
      if (!mat) return
      const unlocked = this.achievements.unlocked.has(ach.id)
      mat.color.setHex(unlocked ? 0xffcf5c : 0x1c1a16)
      mat.emissive.setHex(unlocked ? 0xffcf5c : 0x000000)
      mat.emissiveIntensity = unlocked ? 1.1 : 0
    })
  }

  _showLoreToast(text) {
    this.loreToast.textContent = text
    this.loreToast.classList.remove('show')
    void this.loreToast.offsetWidth
    this.loreToast.classList.add('show')
  }

  // Passive world-building - fires on its own timer, unrelated to any
  // player action. Never repeats the same line twice in a row (picks again
  // if it rolls the last index) since the pool is small enough that an
  // immediate repeat would be noticeable.
  _maybeShowRadioChatter() {
    if (performance.now() < this.nextRadioChatterAt) return
    this.nextRadioChatterAt = performance.now() + RADIO_CHATTER_MIN_DELAY_MS + Math.random() * (RADIO_CHATTER_MAX_DELAY_MS - RADIO_CHATTER_MIN_DELAY_MS)
    let index = Math.floor(Math.random() * RADIO_CHATTER_KEYS.length)
    if (index === this.lastRadioChatterIndex) index = (index + 1) % RADIO_CHATTER_KEYS.length
    this.lastRadioChatterIndex = index
    this._showLoreToast(t(RADIO_CHATTER_KEYS[index]))
    audioEngine.playAudioLog()
  }

  _companionBark(pool) {
    const lines = COMPANION_BARKS[pool]
    const line = lines[Math.floor(Math.random() * lines.length)]
    this.companionBarkEl.textContent = line
    this.companionBarkEl.classList.remove('show')
    void this.companionBarkEl.offsetWidth
    this.companionBarkEl.classList.add('show')
  }

  _onPlayerDeath() {
    this.player.controls.unlock()
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.hotbarEl.style.display = 'none'
    this.statusHud.style.display = 'none'
    this.inventoryHud.style.display = 'none'
    this.progressHud.style.display = 'none'
    this.interactPrompt.style.display = 'none'
    this.statsPanel.style.display = 'none'
    this.minimapWrap.style.display = 'none'
    this.totalDeaths += 1
    this._updateStatsPanel()
    if (this.totalDeaths === 1) this.achievements.unlock('first_death')

    let improved = false
    if (this.night > this.bestStats.bestNight) { this.bestStats.bestNight = this.night; improved = true }
    if (this.kills > this.bestStats.bestKills) { this.bestStats.bestKills = this.kills; improved = true }
    if (improved) {
      saveBestStats(this.bestStats)
      this._updateBestStatsDisplay()
    }

    const elapsed = formatTime(performance.now() - this.runStartedAt)
    this.deathStats.textContent = t('deathStats', { night: this.night, kills: this.kills, time: elapsed })

    const legacyEarned = Math.floor(this.points * DEATH_POINTS_CONVERSION * (1 + this.metaProgress.prestigeLevel * 0.1))
    this.metaProgress.legacyPoints += legacyEarned
    saveMetaProgress(this.metaProgress)
    this.deathLegacyPoints.textContent = t('deathLegacyScrap', { n: legacyEarned })

    if (this.settings.scoreAttackMode) {
      const score = this.kills * 10 + this.night * 100
      if (score > this.scoreAttackBest) {
        this.scoreAttackBest = score
        saveScoreAttackBest(score)
      }
      this.deathScoreAttack.textContent = t('scoreAttackResult', { score, best: this.scoreAttackBest })
      this.deathScoreAttack.style.display = 'block'
    } else {
      this.deathScoreAttack.style.display = 'none'
    }

    if (this.dailyChallengeActive) {
      const score = this.kills * 10 + this.night * 100
      this.dailyBest = loadDailyBest()
      if (score > this.dailyBest.score) {
        this.dailyBest = { date: _todayDateStr(), score }
        saveDailyBest(this.dailyBest)
      }
      this.deathDaily.textContent = t('dailyResult', { twist: t(this.dailyTwist.nameKey), score, best: this.dailyBest.score })
      this.deathDaily.style.display = 'block'
    } else {
      this.deathDaily.style.display = 'none'
    }

    this.respawnBtn.textContent = (this.settings.hardcoreMode || (this.dailyChallengeActive && this.dailyTwist.forceHardcore)) ? t('newAttemptBtn') : t('respawnBtn')

    // Death cam: a beat of the frozen, shaking scene before the UI slams
    // in, instead of the death screen appearing instantly - gameplay is
    // already paused by this.playerState.alive being false, so this is
    // just holding the reveal, not simulating extra time passing.
    this._triggerShake(0.28, 450)
    setTimeout(() => {
      this.deathScreen.style.display = 'flex'
    }, DEATH_CAM_MS)
  }

  _onPickup(type, label, isLoot, count) {
    if (type === 'health') this.inventory.addHealthPack(count || 1)
    else if (type === 'armor') this.inventory.addArmorPack(1)
    else if (type === 'ammo') {
      if (isLoot) this.weapons.addAmmoToCurrent(12)
      else if (count) this.weapons.addAmmoToCurrent(12 * count)
      else this.weapons.refillReserveAmmo()
    } else if (type === 'minigun') {
      this.weapons.unlockWeapon('minigun')
      this.achievements.unlock('minigun_unlocked')
    }
    else if (type === 'battery') {
      this.flashlightBattery = Math.min(this.maxFlashlightBattery, this.flashlightBattery + 40)
    } else if (type === 'noisemaker') this.inventory.addNoisemaker(count || 1)
    else if (type === 'grenade') this.inventory.addGrenade(count || 1)
    else if (type === 'scope') this.weapons.attachScope('rifle')
    else if (type === 'extended_mag') this.weapons.addMagBonus(this.weapons.current.id === 'minigun' ? 50 : 10)
    else if (type === 'fuelcan') this.inventory.addFuelCan(count || 1)
    else if (type === 'melee_bat') this.weapons.setMeleeVariant('bat')
    else if (type === 'melee_machete') this.weapons.setMeleeVariant('machete')
    else if (type === 'melee_uvbaton') this.weapons.setMeleeVariant('uvbaton')
    else if (type === 'vaultkey') {
      this.inventory.vaultKey = true
      this._showLoreToast(t('toastVaultKeyFound'))
      this._updateInventoryHud()
      return
    }
    else if (type === 'rare_weapon' || type === 'legendary_weapon') {
      const legendary = type === 'legendary_weapon'
      const weaponId = this.weapons.randomUnlockedWeaponId()
      const w = weaponId && this.weapons.weapons.find((w) => w.id === weaponId)
      const boosted = w && this.weapons.applyRarityBoost(weaponId, legendary ? 1.3 : 1.15, legendary ? 'legendary' : 'rare')
      this.pickupToast.textContent = boosted
        ? t(legendary ? 'toastLegendaryWeapon' : 'toastRareWeapon', { weapon: t(this.weapons._nameKeyFor(w)) })
        : t('toastRarityWasted')
      this.pickupToast.classList.remove('show')
      void this.pickupToast.offsetWidth
      this.pickupToast.classList.add('show')
      return
    }
    else if (type.startsWith('audiolog')) {
      audioEngine.playAudioLog()
      this._showLoreToast(t(`lore${type.charAt(0).toUpperCase()}${type.slice(1)}`))
      this.audioLogsFound.add(type)
      if (this.audioLogsFound.size >= 5) this.achievements.unlock('full_story')
      return
    }

    this._updateInventoryHud()
    const format = PICKUP_LABELS[type] || (() => label)
    this.pickupToast.textContent = format(label, isLoot, count)
    this.pickupToast.classList.remove('show')
    void this.pickupToast.offsetWidth
    this.pickupToast.classList.add('show')
  }

  _updateInventoryHud() {
    this.healthPackCount.textContent = this.inventory.healthPacks
    this.armorPackCount.textContent = this.inventory.armorPacks
    this.noisemakerCount.textContent = this.inventory.noisemakers
    this.grenadeCount.textContent = this.inventory.grenades
    this.barricadeCount.textContent = this.inventory.barricades
    this.trapCount.textContent = this.inventory.traps
    this.molotovCount.textContent = this.inventory.molotovs
    this.c4Count.textContent = this.inventory.c4
    this.adrenalineCount.textContent = this.inventory.adrenaline
    this.empCount.textContent = this.inventory.emp
  }

  _updateHealthHud() {
    const s = this.playerState
    this.healthFill.style.width = `${(s.health / s.maxHealth) * 100}%`
    this.healthValue.textContent = Math.round(s.health)
    this.armorFill.style.width = `${(s.armor / s.maxArmor) * 100}%`
    this.armorValue.textContent = Math.round(s.armor)
    const lowHealth = s.health > 0 && s.health < 30
    this.damageFlash.classList.toggle('low-health', lowHealth)
    this.infectionIndicator.style.display = s.infected ? 'flex' : 'none'

    if (lowHealth && performance.now() >= this.nextHeartbeatAt) {
      audioEngine.playHeartbeat()
      this.nextHeartbeatAt = performance.now() + 1600
    }

    const healthFraction = s.health / s.maxHealth
    if (healthFraction < 0.25 && !this.lowHealthBarked) {
      this.lowHealthBarked = true
      this._companionBark('lowHealth')
    } else if (healthFraction > 0.4) {
      this.lowHealthBarked = false
    }
  }

  // Distinct from the low-health heartbeat (see _updateHealthHud) - a low
  // ammo count (mag + reserve at or below one magazine's worth) is its own
  // kind of tension and deserves its own read, not just blur into "danger
  // sound is playing" generically. Skipped for melee (no ammo concept).
  // Fades each practice range target's hit-flash back to nothing over
  // ~180ms - the hit itself (see World.js's buildPracticeRange and
  // WeaponSystem's userData.practiceTarget check) only sets flashUntil,
  // this owns the actual decay curve.
  _updatePracticeTargets() {
    const now = performance.now()
    for (const t of this.practiceTargets) {
      if (now < t.flashUntil) {
        t.mat.emissiveIntensity = ((t.flashUntil - now) / 180) * 3
      } else if (t.mat.emissiveIntensity !== 0) {
        t.mat.emissiveIntensity = 0
      }
    }
  }

  _updateLowAmmoCue() {
    const w = this.weapons.current
    const low = !w.melee && w.ammoInMag + w.ammoReserve <= w.magSize
    this.ammoHudEl.classList.toggle('low-ammo', low)
    if (low && performance.now() >= this.nextLowAmmoTickAt) {
      audioEngine.playLowAmmoTick()
      this.nextLowAmmoTickAt = performance.now() + 2200
    }
  }

  _updateProgressHud() {
    this.nightValueEl.textContent = t('hudNight', { n: this.night })
    // Round Mode advances on a kill-clear, not a clock - showing the
    // elapsed-run timer there is misleading (it has no relationship to when
    // the round actually ends), so swap it for the number that does.
    this.timeValueEl.textContent = this._isRoundMode()
      ? `${this.zombies.aliveCount()} left`
      : formatTime(performance.now() - this.runStartedAt)
    this.killsValueEl.textContent = t('hudKills', { n: this.kills })
  }

  _updateStaminaHud() {
    this.staminaFill.style.width = `${(this.player.stamina / this.player.maxStamina) * 100}%`
    this.staminaValue.textContent = Math.round(this.player.stamina)
  }

  // Bottom-of-screen 5-slot hotbar (see _bindHotbar for Digit1-5 switching
  // and _refreshInventoryPanel for the Tab-opened assignment UI) - just
  // reflects this.settings.hotbar's weapon-id-per-slot array plus which
  // slot (if any) matches the currently equipped weapon.
  _updateHotbarHud() {
    const summary = this.weapons.getSummary()
    const currentId = this.weapons.current.id
    this.settings.hotbar.forEach((weaponId, i) => {
      const el = this.hotbarSlotEls[i]
      const nameEl = el.querySelector('.hotbar-slot-name')
      if (!weaponId) {
        nameEl.textContent = '-'
        el.classList.remove('active', 'locked')
        return
      }
      const w = summary.find((ww) => ww.id === weaponId)
      nameEl.textContent = w ? t(w.nameKey) : '-'
      el.classList.toggle('locked', !!w && !w.unlocked)
      el.classList.toggle('active', weaponId === currentId)
    })
  }

  // Digit1-5 switch to whatever's assigned in that hotbar slot (see
  // this.settings.hotbar) - assignment itself happens in the Tab-opened
  // inventory panel (_refreshInventoryPanel's per-weapon slot buttons).
  _bindHotbar() {
    window.addEventListener('keydown', (e) => {
      // weaponWheelOpen isn't covered by the isLocked check below - the
      // wheel is deliberately opened while still locked (it drives its own
      // virtual cursor off the same mouse deltas that steer the camera, see
      // _openWeaponWheel), so without this a Digit press while the wheel is
      // up would switch weapons immediately underneath it instead of
      // waiting for the wheel's own release-to-confirm.
      if (!this.player.controls.isLocked || !this.playerState.alive || this.inventoryOpen || this.driving || this.weaponWheelOpen) return
      const digitIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code)
      if (digitIndex === -1) return
      const weaponId = this.settings.hotbar[digitIndex]
      if (!weaponId) return
      const index = this.weapons.weapons.findIndex((w) => w.id === weaponId)
      if (index !== -1) this.weapons.switchToIndex(index)
    })
    this._updateHotbarHud()
  }

  // Assigns a weapon to a hotbar slot from the inventory panel's per-row
  // slot buttons (see _refreshInventoryPanel) - only one slot may hold a
  // given weapon at a time, so assigning it elsewhere clears its old slot
  // rather than leaving a duplicate.
  _assignHotbarSlot(slotIndex, weaponId) {
    for (let i = 0; i < this.settings.hotbar.length; i++) {
      if (this.settings.hotbar[i] === weaponId) this.settings.hotbar[i] = null
    }
    this.settings.hotbar[slotIndex] = weaponId
    saveSettings(this.settings)
    this._updateHotbarHud()
    this._refreshInventoryPanel()
  }

  _updateStatsPanel() {
    // Piggybacks on this already being called after every points/coins/skin
    // change in the game (kills, purchases, repairs, rescues...) instead of
    // needing a save call at each individual mutation site - see
    // saveShopProgress/loadShopProgress for what actually persists.
    saveShopProgress(this)
    this.statsDay.textContent = this.dayNight ? this.dayNight.getDayNumber() : 1
    this.statsDeaths.textContent = this.totalDeaths
    this.statsKills.textContent = this.totalKills
    this.statsPoints.textContent = this.points
    this.statsCoins.textContent = this.coins

    if (this._isRoundMode()) {
      this.phaseLabel.textContent = 'Zombies left'
      this.phaseTime.textContent = this.zombies.aliveCount()
      this.phaseRow.classList.remove('is-day', 'is-night')
    } else if (this.dayNight) {
      const { phase, remainingMs } = this.dayNight.getPhaseInfo()
      this.phaseLabel.textContent = phase === 'Day' ? t('dayLabel') : t('nightLabel')
      this.phaseTime.textContent = formatTime(remainingMs)
      this.phaseRow.classList.toggle('is-day', phase === 'Day')
      this.phaseRow.classList.toggle('is-night', phase === 'Night')
    }
  }

  // Round Mode isn't a separate opt-in toggle - it's just what Easy/Normal
  // do instead of the 90s timer. Hard/Nightmare keep the timed loop, since
  // that's where the tighter time-pressure pacing is meant to bite.
  _isRoundMode() {
    return this.settings.difficulty === 'easy' || this.settings.difficulty === 'normal'
  }

  _showNightBanner() {
    const nightText = t('hudNight', { n: this.night })
    this.nightBanner.textContent = this.night % 5 === 0 ? `${nightText} — ${t('bossWarning')}` : nightText
    this.nightBanner.classList.remove('show')
    void this.nightBanner.offsetWidth
    this.nightBanner.classList.add('show')
  }

  // Picks a random moment within the current night-round for a random event
  // to fire (see NIGHT_EVENTS) - called whenever a round starts/restarts.
  _scheduleNightEvent() {
    this.nextEventAt = this.nightStartedAt + 10000 + Math.random() * (this.nightDurationMs - 15000)
    this.eventTriggeredForNight = false
  }

  // Rolled once per night-round: a chance of rain for the whole round,
  // lower visibility (see the fog scaling in _tick) plus the rain-on-lens
  // overlay.
  _rollWeather() {
    this.raining = Math.random() < 0.35
    this.rainOverlayEl.style.display = this.raining ? 'block' : 'none'
    this.nextLightningAt = this.raining ? performance.now() + LIGHTNING_MIN_DELAY_MS + Math.random() * LIGHTNING_DELAY_RANGE_MS : 0
  }

  // Independent of rain - a localized fog bank that rolls in at a random
  // spot and only thickens visibility while the player is actually inside
  // it, unlike rain's uniform map-wide reduction.
  _updateFogPatch() {
    const now = performance.now()
    if (this.fogPatch && now >= this.fogPatch.expiresAt) this.fogPatch = null

    if (!this.fogPatch && now >= this.nextFogPatchAt) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * FOG_PATCH_SPAWN_RADIUS
      this.fogPatch = {
        x: Math.sin(angle) * radius,
        z: Math.cos(angle) * radius,
        expiresAt: now + FOG_PATCH_DURATION_MS,
      }
      this.nextFogPatchAt = now + FOG_PATCH_MIN_DELAY_MS + Math.random() * (FOG_PATCH_MAX_DELAY_MS - FOG_PATCH_MIN_DELAY_MS)
    }

    if (this.fogPatch) {
      const pos = this.player.controls.object.position
      const dist = Math.hypot(pos.x - this.fogPatch.x, pos.z - this.fogPatch.z)
      if (dist <= FOG_PATCH_RADIUS) {
        this.scene.fog.near *= FOG_PATCH_MULT
        this.scene.fog.far *= FOG_PATCH_MULT
      }
    }
  }

  // Timed, marked airdrop - shows on the minimap/compass like the trader
  // and ammo station, but only for its AIRDROP_WINDOW_MS window. Reaching
  // it claims a reward; letting it expire just removes the marker. Spawns
  // high overhead and drops onto its target spot (see _spawnAirdrop) rather
  // than just appearing - only claimable once it's actually landed.
  _updateAirdrop() {
    const now = performance.now()
    if (this.airdrop && now >= this.airdrop.expiresAt) {
      this.scene.remove(this.airdrop.mesh)
      this._showLoreToast(t('airdropExpired'))
      this.airdrop = null
    }

    if (!this.airdrop && now >= this.nextAirdropAt) this._spawnAirdrop()

    if (this.airdrop && this._rivalsClaimedAirdrop) {
      this.scene.remove(this.airdrop.mesh)
      this._showLoreToast(t('airdropStolenByRivals'))
      this.airdrop = null
      this._rivalsClaimedAirdrop = false
    }

    if (this.airdrop) {
      const fallElapsed = now - this.airdrop.spawnedAt
      if (fallElapsed < AIRDROP_FALL_DURATION_MS) {
        const t = Math.min(1, fallElapsed / AIRDROP_FALL_DURATION_MS)
        const eased = 1 - (1 - t) * (1 - t)
        this.airdrop.mesh.position.y = AIRDROP_REST_Y + AIRDROP_FALL_HEIGHT * (1 - eased)
        this.airdrop.mesh.rotation.y += 0.06
      } else if (this.airdrop.mesh.position.y !== AIRDROP_REST_Y) {
        this.airdrop.mesh.position.y = AIRDROP_REST_Y
        this.airdrop.beam.intensity = 0.8
      } else {
        const pos = this.player.controls.object.position
        const dist = Math.hypot(pos.x - this.airdrop.x, pos.z - this.airdrop.z)
        if (dist <= AIRDROP_CLAIM_RADIUS) this._claimAirdrop()
      }
    }
  }

  _spawnAirdrop() {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random() * AIRDROP_SPAWN_RADIUS
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius

    // A supply crate that visibly falls out of the sky onto its landing
    // spot instead of just popping into existence as a bright beacon - see
    // _updateAirdrop's fall animation. Toned way down from the old
    // constant emissiveIntensity 1.6 cone + intensity 1.6 point light,
    // which lit up the whole street around it.
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.85 })
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.7, metalness: 0.3, emissive: 0xffe680, emissiveIntensity: 0.35 })
    const mesh = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateMat)
    mesh.add(body)
    // Two crossing metal bands, like a strapped supply crate.
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.1, 0.98), trimMat))
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.98, 0.1), trimMat))
    mesh.position.set(x, AIRDROP_REST_Y + AIRDROP_FALL_HEIGHT, z)
    this.scene.add(mesh)
    const beam = new THREE.PointLight(0xffe680, 0.5, 8, 2)
    beam.position.set(0, 3, 0)
    mesh.add(beam)

    this.airdrop = { x, z, mesh, beam, spawnedAt: performance.now(), expiresAt: performance.now() + AIRDROP_FALL_DURATION_MS + AIRDROP_WINDOW_MS }
    this.nextAirdropAt = performance.now() + AIRDROP_MIN_DELAY_MS + Math.random() * (AIRDROP_MAX_DELAY_MS - AIRDROP_MIN_DELAY_MS)
    this._showLoreToast(t('airdropIncoming'))

    // Rival scavengers converging on the same crate - a race, not just a
    // free pickup, some of the time.
    if (Math.random() < RIVAL_SQUAD_CHANCE) {
      this.rivals.spawnSquad(x, z, 2)
      this._showLoreToast(t('rivalsSpotted'))
    }
  }

  _claimAirdrop() {
    this.scene.remove(this.airdrop.mesh)
    this.points += 40
    this.pickups.spawnLootDrop('ammo', this.airdrop.x, this.airdrop.z)
    this._showLoreToast(t('airdropClaimed'))
    this.airdrop = null
    this._updateStatsPanel()
  }

  // Rare rain-night flash: a bright screen flash + thunder, and briefly
  // weakens (see Zombie.weaken - the same UV-lamp slow/soften effect)
  // every zombie near the player, as a startle effect.
  _triggerLightning() {
    this.lightningFlashEl.classList.remove('flash')
    void this.lightningFlashEl.offsetWidth
    this.lightningFlashEl.classList.add('flash')
    audioEngine.playThunder()
    this._triggerShake(0.06, 200)

    const playerPos = this.player.controls.object.position
    for (const zombie of this.zombies.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - playerPos.x, zombie.group.position.z - playerPos.z)
      if (dist <= LIGHTNING_FLINCH_RADIUS) zombie.weaken(LIGHTNING_FLINCH_MS)
    }

    this.nextLightningAt = performance.now() + LIGHTNING_MIN_DELAY_MS + Math.random() * LIGHTNING_DELAY_RANGE_MS
  }

  // Threat-based dynamic music (see Audio.js's setMusicIntensity) - nearby
  // zombie pressure, an active boss, and low player health all push the
  // score up; smoothed with a lerp (musicIntensityCurrent) so the volume/
  // playback-rate shift is a fade rather than a jump as zombies wander in
  // and out of range.
  _updateMusicIntensity(playerPos) {
    let nearbyCount = 0
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d < 22) nearbyCount++
    }
    let threat = Math.min(1, nearbyCount / 8)
    if (this.zombies.zombies.some((z) => z.isBoss && z.state === 'alive')) threat = Math.max(threat, 0.8)
    const healthFrac = this.playerState.maxHealth > 0 ? this.playerState.health / this.playerState.maxHealth : 1
    if (healthFrac < 0.3) threat = Math.max(threat, 0.7)

    this.musicIntensityCurrent = THREE.MathUtils.lerp(this.musicIntensityCurrent, threat, 0.04)
    audioEngine.setMusicIntensity(this.musicIntensityCurrent)
  }

  _updateFlicker(elapsed) {
    // Streetlights fade out during the day rather than staying lit - and
    // stay dark regardless of time of day if the generator has run dry.
    if (this.generatorFuel <= 0) {
      for (const f of this.flickerLights) f.light.intensity = 0
      return
    }
    const nightStrength = 1 - this.dayNight.dayFactor * 0.9
    for (const f of this.flickerLights) {
      const n = Math.sin(elapsed * 9 + f.seed) * Math.sin(elapsed * 3.7 + f.seed)
      f.light.intensity = f.base * (0.65 + 0.35 * Math.max(0, n)) * nightStrength
    }
  }

  // Companions are vulnerable (see Companion.js's `vulnerable` option) and
  // go down instead of just tanking hits forever - this reacts to the
  // one-shot justWentDown/justDied flags each companion sets on itself and
  // figures out who (if anyone) the player can currently revive.
  _updateCompanionDownedState(playerPos) {
    if (this.companion.justWentDown) {
      this.companion.justWentDown = false
      this._showLoreToast(t('toastCompanionDown'))
      this._companionBark('companionDown')
    }
    if (this.companion.justDied) {
      // Not gone for good - the main companion always exists elsewhere in
      // this file, so "died" here means dragged back to the safe zone to
      // recover rather than actually removed.
      this.companion.justDied = false
      this.companion.downed = true // revive() below requires this to be true
      this.companion.revive()
      this.companion.teleportTo(this.safeZone.x, this.safeZone.z)
      this._showLoreToast(t('toastCompanionCrawledBack'))
    }

    if (this.tempCompanion) {
      if (this.tempCompanion.justWentDown) {
        this.tempCompanion.justWentDown = false
        this._showLoreToast(t('toastCompanionDown'))
      }
      if (this.tempCompanion.justDied) {
        this._showLoreToast(t('tempCompanionLeft'))
        this.tempCompanion.dispose()
        this.tempCompanion = null
      }
    }

    // Recruits are permanent, so a "death" crawls them back to the safe zone
    // to recover instead of removing them - same treatment as the main
    // companion, not the temporary rescue guest.
    for (const recruit of this.recruits) {
      if (recruit.justWentDown) {
        recruit.justWentDown = false
        this._showLoreToast(t('toastCompanionDown'))
      }
      if (recruit.justDied) {
        recruit.justDied = false
        recruit.downed = true
        recruit.revive()
        recruit.teleportTo(this.safeZone.x, this.safeZone.z)
        this._showLoreToast(t('toastCompanionCrawledBack'))
      }
    }

    this.reviveTarget = null
    if (this.companion.isNear(playerPos)) this.reviveTarget = this.companion
    else if (this.tempCompanion && this.tempCompanion.isNear(playerPos)) this.reviveTarget = this.tempCompanion
    else {
      for (const recruit of this.recruits) {
        if (recruit.isNear(playerPos)) { this.reviveTarget = recruit; break }
      }
    }
  }

  _spawnVaultKey() {
    const spot = this.vaultKeySpots[Math.floor(Math.random() * this.vaultKeySpots.length)]
    this.pickups.spawnUnique('vaultkey', spot.x, spot.z, spot.y)
  }

  _updateVault(dt, playerPos) {
    this.vault.update(dt, performance.now() / 1000)
    this.nearVault = this.vault.isNear(playerPos)
  }

  // Stage 4's "reinforced entry" - unlike the Vault (which needs a
  // dedicated key item), these just need the player in range and the
  // interact key pressed, matching a "basic" security tier rather than the
  // Vault's one-off "hunt down the key" loop.
  _updateLockedCells(playerPos) {
    let nearest = null
    let nearestDist = 2.2
    for (const cell of this.lockedCells) {
      if (!cell.locked) continue
      const dist = Math.hypot(playerPos.x - cell.x, playerPos.z - cell.z)
      if (dist < nearestDist) {
        nearest = cell
        nearestDist = dist
      }
    }
    this.nearLockedCell = nearest
  }

  _tryOpenLockedCell() {
    const cell = this.nearLockedCell
    if (!cell || !cell.locked) return
    cell.locked = false
    // Same dynamic-collider-removal pattern as _removeDeathObstacle.
    const ci = this.colliders.indexOf(cell.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(cell.mesh)
    if (si !== -1) this.solidMeshes.splice(si, 1)
    cell.mesh.visible = false
    cell.indicatorMat.color.setHex(0x0a2a0a)
    cell.indicatorMat.emissive.setHex(0x2aff3e)
    cell.indicatorMat.emissiveIntensity = 0.6
    this.nearLockedCell = null
    // Guaranteed weapon-tier reward for breaking in, same weapon-only
    // weighting the gun shop/hardware store chests use by default - a door
    // can set its own lootWeights (see the bank vault) for a better/
    // different reward instead.
    this.chests.addChest(cell.x, 0, cell.z, cell.lootWeights || { rare_weapon: 10, legendary_weapon: 3 })
  }

  // Phase 6 of the 3D asset overhaul - the new outer zones (see World.js's
  // buildOuterZones) made the map's real object count several times bigger
  // than the old ~80x80 core, so everything registered via buildWorld's
  // register() (buildings, streetlights, the perimeter wall) now gets
  // hidden/shown by distance instead of always rendering. Squared-distance
  // comparison avoids a sqrt per object per frame; this is plain arithmetic
  // over an array, not the expensive part (rendering/shadow-casting a
  // visible mesh is), so it runs on every object every frame rather than
  // throttling/spreading the check across multiple frames.
  _updateCulling(playerPos) {
    const cullSq = WORLD_CULL_DISTANCE * WORLD_CULL_DISTANCE
    const shadowSq = WORLD_SHADOW_CULL_DISTANCE * WORLD_SHADOW_CULL_DISTANCE
    for (const obj of this.cullables) {
      const dx = obj.position.x - playerPos.x
      const dz = obj.position.z - playerPos.z
      const distSq = dx * dx + dz * dz
      obj.visible = distSq < cullSq
      const wantsShadow = distSq < shadowSq
      if (obj.castShadow !== wantsShadow) obj.castShadow = wantsShadow
      if (obj.isMesh) continue
      obj.traverse((child) => {
        if (!child.isMesh) return
        if (child.castShadow !== wantsShadow) child.castShadow = wantsShadow
      })
    }
  }

  _updateTrophyWallProximity(playerPos) {
    const dist = Math.hypot(playerPos.x - this.trophyWall.x, playerPos.z - this.trophyWall.z)
    this.nearTrophyWall = dist <= TROPHY_WALL_INTERACT_RADIUS
  }

  // Purely informational - a quick progress readout rather than opening the
  // full (main-menu-only) achievements/bestiary panels, which aren't wired
  // for being opened mid-run (no pointer-unlock/ESC handling).
  _showTrophyWallSummary() {
    const achCount = this.achievements.unlocked.size
    const bestiaryCount = this.bestiaryEncountered.size
    const bestiaryTotal = Object.keys(ZOMBIE_TYPES).length
    this._showLoreToast(t('trophyWallSummary', {
      ach: achCount,
      achTotal: ACHIEVEMENTS.length,
      bestiary: bestiaryCount,
      bestiaryTotal,
    }))
  }

  // Opens the vault if the player has the key - one-off per run (see the
  // Vault class, no re-lock/respawn cycle) with a guaranteed strong payoff
  // instead of another random chest roll, since finding the key already was
  // the gamble.
  _openVault() {
    if (this.vault.opened) return
    if (!this.inventory.useVaultKey()) {
      this._showLoreToast(t('toastVaultLocked'))
      return
    }
    this.vault.open()
    this.points += VAULT_REWARD_POINTS
    this._updateStatsPanel()
    this.pickups.spawnLootDrop('legendary_weapon', this.vault.x, this.vault.z + 1)
    this._showLoreToast(t('toastVaultOpened', { n: VAULT_REWARD_POINTS }))
  }

  _updateGenerator(dt, playerPos) {
    const dist = Math.hypot(playerPos.x - this.generator.x, playerPos.z - this.generator.z)
    this.generatorFuel = Math.max(0, this.generatorFuel - GENERATOR_DRAIN_PER_SEC * dt)
    if (dist <= GENERATOR_REFUEL_RADIUS) {
      this.generatorFuel = Math.min(this.maxGeneratorFuel, this.generatorFuel + GENERATOR_PASSIVE_REFUEL_PER_SEC * dt)
    }

    const fraction = this.generatorFuel / this.maxGeneratorFuel
    const mat = this.generator.indicatorMat
    if (this.generatorFuel <= 0) {
      mat.color.setHex(0x2a0505)
      mat.emissive.setHex(0xff2a1e)
    } else if (fraction < 0.3) {
      mat.color.setHex(0x2a2005)
      mat.emissive.setHex(0xffcf3e)
    } else {
      mat.color.setHex(0x0a2a0a)
      mat.emissive.setHex(0x2aff3e)
    }

    this.nearGenerator = dist <= GENERATOR_REFUEL_RADIUS
  }

  // Hold-to-charge ammo refill - progress only accumulates while standing
  // in range, holding the interact key, and not currently firing (checked
  // via weapons.timeSinceLastShot, reset to 0 on every shot attempt
  // including dry-fire clicks). Walking away, letting go, or shooting all
  // reset progress back to zero rather than pausing it, so it can't be
  // topped up in short bursts between fights.
  _updateAmmoStation(dt, playerPos) {
    const dist = Math.hypot(playerPos.x - this.ammoStation.x, playerPos.z - this.ammoStation.z)
    this.nearAmmoStation = dist <= AMMO_STATION_RADIUS

    const charging = this.nearAmmoStation && this.ammoStationKeyHeld && this.weapons.timeSinceLastShot > 0.3
    if (charging) {
      this.ammoStationHoldProgress = Math.min(AMMO_STATION_HOLD_SECONDS, this.ammoStationHoldProgress + dt)
      if (this.ammoStationHoldProgress >= AMMO_STATION_HOLD_SECONDS) {
        this.ammoStationHoldProgress = 0
        this._onPickup('ammo', 'Ammo Crate', false) // refillReserveAmmo() runs inside _onPickup's ammo branch
      }
    } else {
      this.ammoStationHoldProgress = 0
    }

    const mat = this.ammoStation.buttonMat
    if (charging) {
      const fraction = this.ammoStationHoldProgress / AMMO_STATION_HOLD_SECONDS
      mat.color.setHex(0x2a1a05)
      mat.emissive.setHex(0xe3a63c)
      mat.emissiveIntensity = 0.6 + fraction * 1.2
    } else {
      mat.color.setHex(0x2a0808)
      mat.emissive.setHex(0xff2a1e)
      mat.emissiveIntensity = 1.1
    }

    this.ammoStationProgressWrap.style.display = charging ? 'block' : 'none'
    if (charging) {
      this.ammoStationFill.style.width = `${(this.ammoStationHoldProgress / AMMO_STATION_HOLD_SECONDS) * 100}%`
    }
  }

  // Stage 10's "electricity puzzle" - the exact same hold-to-charge shape as
  // _updateAmmoStation above (proximity + held key + not-currently-firing +
  // progress that resets to zero on any interruption rather than pausing),
  // just with a one-time success (_restoreTunnelPower) instead of a
  // repeatable pickup.
  _updateBreakerBox(dt, playerPos) {
    if (this.tunnelPowerOn) {
      this.nearBreakerBox = false
      this.breakerBoxProgressWrap.style.display = 'none'
      return
    }
    const dist = Math.hypot(playerPos.x - this.breakerBox.x, playerPos.z - this.breakerBox.z)
    this.nearBreakerBox = dist <= BREAKER_BOX_RADIUS

    const charging = this.nearBreakerBox && this.breakerBoxKeyHeld && this.weapons.timeSinceLastShot > 0.3
    if (charging) {
      this.breakerBoxHoldProgress = Math.min(BREAKER_BOX_HOLD_SECONDS, this.breakerBoxHoldProgress + dt)
      if (this.breakerBoxHoldProgress >= BREAKER_BOX_HOLD_SECONDS) {
        this._restoreTunnelPower()
      }
    } else {
      this.breakerBoxHoldProgress = 0
    }

    const mat = this.breakerBox.buttonMat
    if (charging) {
      const fraction = this.breakerBoxHoldProgress / BREAKER_BOX_HOLD_SECONDS
      mat.color.setHex(0x2a1a05)
      mat.emissive.setHex(0xe3a63c)
      mat.emissiveIntensity = 0.6 + fraction * 1.2
    } else {
      mat.color.setHex(0x2a0808)
      mat.emissive.setHex(0xff2a1e)
      mat.emissiveIntensity = 1.1
    }

    this.breakerBoxProgressWrap.style.display = charging ? 'block' : 'none'
    if (charging) {
      this.breakerBoxFill.style.width = `${(this.breakerBoxHoldProgress / BREAKER_BOX_HOLD_SECONDS) * 100}%`
    }
  }

  // Fires once, when the breaker box's hold-to-charge completes: turns the
  // dark stretch's lights on for real (they were built at intensity 0 - see
  // buildMaintenanceTunnelNetwork - and only join flickerLights now, so they
  // don't flicker while still "dead"), and opens the turnstile gate the same
  // way _tryOpenLockedCell opens a locked cell (splice its box/mesh back out
  // of colliders/solidMeshes) - except this one was never a free-interact
  // unlock, it was always gated on this puzzle succeeding.
  _restoreTunnelPower() {
    this.tunnelPowerOn = true
    this.breakerBoxHoldProgress = 0
    this.breakerBox.buttonMat.color.setHex(0x0a2a0a)
    this.breakerBox.buttonMat.emissive.setHex(0x2aff3e)
    this.breakerBox.buttonMat.emissiveIntensity = 0.6

    for (const light of this.maintenanceTunnel.tunnelDarkLights) {
      light.intensity = 0.8
      this.flickerLights.push({ light, base: 0.8, seed: Math.random() * 100 })
    }

    const turnstile = this.turnstile
    turnstile.locked = false
    const ci = this.colliders.indexOf(turnstile.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(turnstile.mesh)
    if (si !== -1) this.solidMeshes.splice(si, 1)
    turnstile.mesh.visible = false
    turnstile.sign.visible = false
    turnstile.indicatorMat.color.setHex(0x0a2a0a)
    turnstile.indicatorMat.emissive.setHex(0x2aff3e)
    turnstile.indicatorMat.emissiveIntensity = 0.6

    this._showLoreToast(t('toastPowerRestored'))
  }

  _updateTrader(playerPos) {
    const dist = Math.hypot(playerPos.x - this.trader.x, playerPos.z - this.trader.z)
    this.nearTrader = dist <= TRADER_INTERACT_RADIUS
  }

  // Slow passive regen while standing inside the guarded compound - the
  // mechanical half of "safe zone" (the guards shooting anything that
  // approaches are the other half). Silent/no toast on its own; the
  // health bar visibly ticking up is feedback enough.
  _updateSafeZoneHeal(dt, playerPos) {
    const dist = Math.hypot(playerPos.x - this.safeZone.x, playerPos.z - this.safeZone.z)
    if (dist > this.safeZone.radius) return
    if (!this.playerState.alive || this.playerState.health >= this.playerState.maxHealth) return
    const rateMult = this.metaProgress.purchased.has('fortifiedRest') ? 1.5 : 1
    this.playerState.heal(SAFE_ZONE_HEAL_PER_SEC * rateMult * dt)
    this._updateHealthHud()
  }

  // Base upgrade (see MetaProgress.js's extraGuard) - one more Companion
  // standing watch, same construction as the original guardSpots in the
  // constructor, just placed a little further into the compound than any
  // existing post.
  _addExtraGuard() {
    const guard = new Companion(this.scene, this.safeZone.x - 2, this.safeZone.z + 2, 'ranged', { vulnerable: false })
    guard.setName('Guard')
    this.safeZoneGuards.push(guard)
  }

  // Core-loop twist: VIREO's "wellness light" is exactly what drew the
  // infection in the first place (see the audio log lore), so the
  // flashlight - the tool you need to see at night - is also a beacon.
  // Reuses the same forceWake()/enrage() the Screamer's scream uses.
  _updateLightLure(playerPos) {
    if (performance.now() < this.nextLightLureAt) return
    this.nextLightLureAt = performance.now() + LIGHT_LURE_INTERVAL_MS
    for (const zombie of this.zombies.zombies) {
      const dist = Math.hypot(zombie.group.position.x - playerPos.x, zombie.group.position.z - playerPos.z)
      if (dist > LIGHT_LURE_RADIUS) continue
      if (zombie.state === 'dormant') zombie.forceWake()
      else if (zombie.state === 'alive') zombie.enrage(LIGHT_LURE_ENRAGE_MS)
    }
  }

  _updateVehicleProximity(playerPos) {
    this.nearVehicle = this.vehicle.distanceTo(playerPos.x, playerPos.z) <= VEHICLE_INTERACT_RADIUS
  }

  _updateVireoTerminal(playerPos) {
    const dist = Math.hypot(playerPos.x - this.vireoTerminal.x, playerPos.z - this.vireoTerminal.z)
    this.nearVireoTerminal = dist <= VIREO_TERMINAL_RADIUS
  }

  _updateStationTerminal(playerPos) {
    const dist = Math.hypot(playerPos.x - this.stationTerminal.x, playerPos.z - this.stationTerminal.z)
    this.nearStationTerminal = dist <= VIREO_TERMINAL_RADIUS
  }

  _interactStationTerminal() {
    this._showLoreToast(t('loreStationTerminal'))
  }

  // One-off ambush the first time the player actually walks into the new
  // underground station's hall - roughly half the concurrent zombie count a
  // normal surface encounter runs at (BASE_SPAWN_COUNT in ZombieManager.js
  // is 9), rather than hooking into the surface radial spawner, which spawns
  // purely around the map origin with no notion of underground rooms at all.
  _updateStationEncounter(playerPos) {
    if (this.stationEncounterTriggered) return
    const dist = Math.hypot(playerPos.x - this.stationEncounterCenter.x, playerPos.z - this.stationEncounterCenter.z)
    if (dist > STATION_ENCOUNTER_RADIUS) return
    this.stationEncounterTriggered = true
    this.zombies.spawnStationAmbush(this.stationEncounterCenter.x, this.stationEncounterCenter.z, STATION_ENCOUNTER_ZOMBIE_COUNT)
    this._showLoreToast(t('stationAmbush'))
  }

  // First-ever visit: reading the terminal wakes a guardian that must be
  // killed before it'll actually talk. Already unlocked the true ending?
  // Just re-read it any time, no fight.
  _interactVireoTerminal() {
    if (this.achievements.unlocked.has('true_ending')) {
      this._showLoreToast(t('loreVireoTerminal'))
      return
    }
    if (!this.vireoGuardian) {
      this.vireoGuardian = this.zombies.spawnGuardian(this.vireoTerminal.x, this.vireoTerminal.z - 3, ZOMBIE_TYPES.colossus)
      this._showLoreToast(t('vireoGuardianWakes'))
      return
    }
    if (this.vireoGuardian.state !== 'dead') {
      this._showLoreToast(t('vireoGuardianAlive'))
      return
    }
    this._showLoreToast(t('loreVireoTerminal'))
    this.achievements.unlock('true_ending')
    document.getElementById('diff-nightmare').style.display = ''
  }

  // Shown once, ever (persisted), after both the true ending is unlocked and
  // the player has actually survived a while past it - a small reward
  // moment, not a hard stop, so the game keeps going afterward.
  _showEndingSequence() {
    this.endingSeen = true
    saveEndingSeen()
    this.player.controls.unlock()
    this.endingText.textContent = t('endingText')
    this.endingCredits.innerHTML = t('endingCredits').split('\n').map((line) => `<div>${line}</div>`).join('')
    this.endingPanel.style.display = 'flex'
  }

  // Random night event (see NightEvents.js's 'survivor_found') - only one
  // at a time; a new event while one's still out there just replaces it.
  _spawnRescueSurvivor() {
    if (this.rescueSurvivor) this.rescueSurvivor.dispose()
    const spot = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
    this.rescueSurvivor = new RescueSurvivor(this.scene, spot.x, spot.z)
  }

  _updateRescueSurvivor(playerPos) {
    if (!this.rescueSurvivor) {
      this.nearRescueSurvivor = false
      return
    }
    const dist = Math.hypot(playerPos.x - this.rescueSurvivor.x, playerPos.z - this.rescueSurvivor.z)
    this.nearRescueSurvivor = dist <= RESCUE_INTERACT_RADIUS
  }

  _updateRecruitSpots(elapsed, playerPos) {
    this.nearRecruitSpot = null
    for (const spot of this.recruitSpots) {
      if (!spot.marker) continue
      spot.marker.update(elapsed)
      const dist = Math.hypot(playerPos.x - spot.x, playerPos.z - spot.z)
      if (dist <= RECRUIT_INTERACT_RADIUS) this.nearRecruitSpot = spot
    }
  }

  _recruitSurvivor(spot) {
    spot.marker.dispose()
    spot.marker = null
    const recruit = new Companion(this.scene, spot.x, spot.z, spot.role)
    this.recruits.push(recruit)
    this.nearRecruitSpot = null
    this._showLoreToast(t('survivorRecruited'))
  }

  // A real top-of-screen bar while any boss (Colossus/Titan/the VIREO
  // guardian) is alive, instead of just the same tiny floating sprite every
  // regular zombie gets.
  _updateBossHealthBar() {
    const boss = this.zombies.zombies.find((z) => z.isBoss && z.state !== 'dead')
    if (!boss) {
      this.bossHealthWrap.style.display = 'none'
      this.bossAnnounced = false
      return
    }
    if (!this.bossAnnounced) {
      this.bossAnnounced = true
      this._companionBark('bossSpawn')
    }
    this.bossHealthWrap.style.display = 'block'
    this.bossNameEl.textContent = boss.config.label
    this.bossHealthFill.style.width = `${Math.max(0, boss.health / boss.maxHealth) * 100}%`
  }

  // King of the Hill mutator: standing inside the marked ring fills the
  // capture bar; leaving it drains the bar instead of resetting it outright,
  // so a brief retreat under fire doesn't erase all progress. A full capture
  // pays out points+coins, triggers a small spawn surge to keep the zone
  // contested, and relocates the ring to the next fixed spot.
  _updateKingOfTheHill(dt, playerPos) {
    if (!this.kothActive) {
      this.kothWrap.style.display = 'none'
      return
    }
    this.kothWrap.style.display = 'block'
    const dist = Math.hypot(playerPos.x - this.kothZone.x, playerPos.z - this.kothZone.z)
    const inZone = dist <= KOTH_RADIUS
    this.kothProgress = THREE.MathUtils.clamp(
      this.kothProgress + (inZone ? dt / KOTH_CAPTURE_SECONDS : -dt / KOTH_DECAY_SECONDS),
      0,
      1
    )
    this.kothLabel.textContent = inZone ? t('kothLabelCapturing') : t('kothLabelHold')
    this.kothFill.style.width = `${this.kothProgress * 100}%`
    if (this.kothProgress >= 1) this._captureKothZone()
  }

  // Extraction mutator: a one-time win condition. The hold timer only
  // advances while standing in the LZ - stepping out pauses it rather than
  // draining it, since narratively the chopper is just waiting - and
  // zombie pressure ramps up near the LZ on a fixed interval the whole
  // time it's in progress, so camping the ring isn't free.
  _updateExtraction(dt, playerPos) {
    if (!this.extractionActive) {
      this.extractionWrap.style.display = 'none'
      return
    }
    this.extractionWrap.style.display = 'block'
    const dist = Math.hypot(playerPos.x - EXTRACTION_SPOT.x, playerPos.z - EXTRACTION_SPOT.z)
    const inZone = dist <= EXTRACTION_RADIUS
    if (inZone) {
      this.extractionProgress = Math.min(1, this.extractionProgress + dt / EXTRACTION_HOLD_SECONDS)
      if (performance.now() >= this.extractionNextSurgeAt) {
        this.extractionNextSurgeAt = performance.now() + EXTRACTION_SURGE_INTERVAL_MS
        this.zombies.spawnSurge(EXTRACTION_SURGE_SIZE)
      }
    }
    this.extractionLabel.textContent = inZone ? t('extractionLabelActive') : t('extractionLabelHold')
    this.extractionFill.style.width = `${this.extractionProgress * 100}%`
    if (this.extractionProgress >= 1) this._onExtractionSuccess()
  }

  _onExtractionSuccess() {
    this.extractionActive = false
    this.player.controls.unlock()
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.hotbarEl.style.display = 'none'
    this.statusHud.style.display = 'none'
    this.inventoryHud.style.display = 'none'
    this.progressHud.style.display = 'none'
    this.interactPrompt.style.display = 'none'
    this.statsPanel.style.display = 'none'
    this.minimapWrap.style.display = 'none'
    this.extractionWrap.style.display = 'none'

    let improved = false
    if (this.night > this.bestStats.bestNight) { this.bestStats.bestNight = this.night; improved = true }
    if (this.kills > this.bestStats.bestKills) { this.bestStats.bestKills = this.kills; improved = true }
    if (improved) {
      saveBestStats(this.bestStats)
      this._updateBestStatsDisplay()
    }

    this.points += EXTRACTION_POINTS_BONUS
    this.coins += EXTRACTION_COINS_BONUS
    this._updateStatsPanel()

    const legacyEarned = Math.floor(this.points * DEATH_POINTS_CONVERSION * (1 + this.metaProgress.prestigeLevel * 0.1))
    this.metaProgress.legacyPoints += legacyEarned
    saveMetaProgress(this.metaProgress)

    const elapsed = formatTime(performance.now() - this.runStartedAt)
    this.extractionStats.textContent = t('extractionStats', { night: this.night, kills: this.kills, time: elapsed, points: EXTRACTION_POINTS_BONUS, coins: EXTRACTION_COINS_BONUS, legacy: legacyEarned })

    if (this.dailyChallengeActive) {
      const score = this.kills * 10 + this.night * 100
      this.dailyBest = loadDailyBest()
      if (score > this.dailyBest.score) {
        this.dailyBest = { date: _todayDateStr(), score }
        saveDailyBest(this.dailyBest)
      }
      this.extractionDaily.textContent = t('dailyResult', { twist: t(this.dailyTwist.nameKey), score, best: this.dailyBest.score })
      this.extractionDaily.style.display = 'block'
    } else {
      this.extractionDaily.style.display = 'none'
    }

    this.extractionScreen.style.display = 'flex'
  }

  _captureKothZone() {
    this.points += KOTH_CAPTURE_POINTS
    this.coins += KOTH_CAPTURE_COINS
    this._updateStatsPanel()
    this._showLoreToast(t('kothCaptured'))
    this.kothProgress = 0
    const next = KOTH_SPOTS[Math.floor(Math.random() * KOTH_SPOTS.length)]
    this.kothZone.x = next.x
    this.kothZone.z = next.z
    this.kothMarker.position.set(next.x, 0.06, next.z)
    this.zombies.spawnSurge(KOTH_SPAWN_SURGE)
  }

  _rescueSurvivor() {
    this.points += RESCUE_POINTS_REWARD
    this.inventory.addHealthPack(1)
    this._updateStatsPanel()
    this._updateInventoryHud()
    this._showLoreToast(t('survivorRescued', { reward: RESCUE_POINTS_REWARD }))

    // Bonus on top of the usual reward: the rescued survivor tags along as
    // a second, weaker companion until dawn instead of just vanishing after
    // handing over loot - makes a rescue feel like an event, not a pickup.
    // Deliberately fixed-role/no training carryover - this one's a guest,
    // not your main companion.
    if (this.tempCompanion) this.tempCompanion.dispose()
    const pos = this.rescueSurvivor.group.position
    this.tempCompanion = new Companion(this.scene, pos.x, pos.z, 'ranged')
    this.tempCompanion.stats.damageMin *= 0.6
    this.tempCompanion.stats.damageMax *= 0.6
    this.tempCompanionExpiresAtNight = this.night + 1

    this.rescueSurvivor.dispose()
    this.rescueSurvivor = null
    this.nearRescueSurvivor = false
  }

  // Top-of-screen strip showing which way key landmarks are, relative to
  // where the camera is currently facing - each marker slides off either
  // edge and hides once it's more than COMPASS_HALF_FOV off-center.
  _updateCompass(playerPos) {
    this.camera.getWorldDirection(this._camDir)
    const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)

    const landmarks = [
      { el: this.compassTrader, x: this.trader.x, z: this.trader.z },
      { el: this.compassAmmo, x: this.ammoStation.x, z: this.ammoStation.z },
      { el: this.compassSubway, x: this.subwayEntrance.x, z: this.subwayEntrance.z },
      ...this.newLocationLandmarks,
    ]
    if (this.vehicle && !this.driving) {
      landmarks.push({ el: this.compassVehicle, x: this.vehicle.group.position.x, z: this.vehicle.group.position.z })
    } else {
      this.compassVehicle.style.display = 'none'
    }
    if (this.airdrop) {
      landmarks.push({ el: this.compassAirdrop, x: this.airdrop.x, z: this.airdrop.z })
    } else {
      this.compassAirdrop.style.display = 'none'
    }

    for (const lm of landmarks) {
      const dx = lm.x - playerPos.x
      const dz = lm.z - playerPos.z
      const bearing = Math.atan2(dx, -dz)
      let diff = bearing - facingRad
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      if (Math.abs(diff) > COMPASS_HALF_FOV) {
        lm.el.style.display = 'none'
      } else {
        lm.el.style.display = 'block'
        lm.el.style.left = `${50 + (diff / COMPASS_HALF_FOV) * 50}%`
      }
    }
  }

  _updateMinimap(playerPos) {
    this.camera.getWorldDirection(this._camDir)
    const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)
    const zombiePositions = this.zombies.zombies
      .filter((z) => z.state === 'alive')
      .map((z) => ({ x: z.group.position.x, z: z.group.position.z }))
    this.minimap.update(
      playerPos,
      facingRad,
      zombiePositions,
      this.chests.chests,
      // Minigun is Shop-exclusive now (see WeaponSystem.js) - no more
      // physical pickup on the map to point a marker at.
      null,
      this.trader,
      this.ammoStation,
      this.airdrop,
      this.zombies.wanderingHorde,
      this.newLocationLandmarks
    )
  }

  // Announces a wandering horde exactly once per appearance (see
  // ZombieManager's _maybeSpawnWanderingHorde) by watching for the
  // null-to-object transition, rather than needing a dedicated callback
  // threaded through update()'s already-long argument list.
  _updateHordeAnnouncement() {
    if (this.zombies.wanderingHorde && !this._hordeAnnounced) {
      this._hordeAnnounced = true
      this._showLoreToast(t('hordeIncoming'))
    } else if (!this.zombies.wanderingHorde) {
      this._hordeAnnounced = false
    }
  }

  _tick() {
    this.timer.update()
    let dt = Math.min(this.timer.getDelta(), 0.1)
    const elapsed = this.timer.getElapsed()
    if (performance.now() < this._hitstopUntil) dt = 0
    else if (performance.now() < this.killcamUntil) dt *= KILLCAM_SLOWMO_FACTOR

    this.camera.position.sub(this._shakeOffset)

    this.dayNight.update()
    if (this.raining) {
      this.scene.fog.near *= 0.6
      this.scene.fog.far *= 0.6
    }
    this._updateFogPatch()
    this._updateFlicker(elapsed)
    this._updateMusicIntensity(this.player.controls.object.position)

    if (this.driving && this.player.controls.isLocked && this.playerState.alive) {
      this.vehicle.update(dt, this.player.input, this.player.colliders)
      this.vehicle.getDriverSeatWorld(this._vehicleSeatPos)
      this.camera.position.copy(this._vehicleSeatPos)
      this._updateVehicleRamming()
    } else if (this.player.controls.isLocked && this.playerState.alive && !this.inventoryOpen && !this.perkPanelOpen && !this.traderPanelOpen && !this.xpLevelupPanelOpen) {
      this.player.update(dt)
      this._updateThirdPerson()
      const isMoving = this.player.onGround && (
        this.player.input.forward || this.player.input.back ||
        this.player.input.left || this.player.input.right
      )
      if (!this.weaponWheelOpen) this.weapons.update(dt, isMoving)
      if (performance.now() < this.killcamUntil) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.weapons.defaultFov * KILLCAM_ZOOM_FOV_MULT, 0.15)
        this.camera.updateProjectionMatrix()
      }
      this._updateHotbarHud()
      this._updateStaminaHud()
      this._updateFlashlightBattery(dt)

      this.playerState.tickInfection(dt)
      this._updateHealthHud()

      if (!this.eventTriggeredForNight && performance.now() >= this.nextEventAt) {
        this.eventTriggeredForNight = true
        const event = pickNightEvent()
        event.apply(this)
        this._showLoreToast(t(event.labelKey))
      }

      // Round Mode swaps the timer for a kill-the-wave gate: once every
      // zombie is dead, wait out a short intermission (matching Obsidian
      // Ops' ~5s), then advance through the exact same night-advance block
      // timed mode uses below - just triggered by a clear instead of a clock.
      let shouldAdvance
      if (this._isRoundMode()) {
        shouldAdvance = false
        if (!this.roundIntermissionUntil) {
          if (this.zombies.aliveCount() === 0) {
            this.roundIntermissionUntil = performance.now() + ROUND_INTERMISSION_MS
            this._showLoreToast(`Round ${this.night} cleared! Next wave in ${ROUND_INTERMISSION_MS / 1000}s...`)
          }
        } else if (performance.now() >= this.roundIntermissionUntil) {
          this.roundIntermissionUntil = 0
          shouldAdvance = true
        }
      } else {
        shouldAdvance = performance.now() - this.nightStartedAt > this.nightDurationMs
      }

      if (shouldAdvance) {
        if (this.raining) this._checkBountyProgress('survive_rain_night', 1)
        this._checkBountyProgress('reach_3_nights', 1)
        this.night += 1
        if (this.tempCompanion && this.night >= this.tempCompanionExpiresAtNight) {
          this._showLoreToast(t('tempCompanionLeft'))
          this.tempCompanion.dispose()
          this.tempCompanion = null
        }
        this.nightStartedAt = performance.now()
        this._scheduleNightEvent()
        this._rollWeather()
        this._rollFeaturedItem()
        this._rollTraderPrices()
        this.chests.refillNight()
        this.barricadeWindows.onRoundStart()
        if (this._isRoundMode()) this.zombies.startRound(this.night)
        else this.zombies.applyDifficulty(this.night)
        this._showNightBanner()
        this._companionBark('nightStart')
        if (this.night >= 5) this.achievements.unlock('survivor_5')
        if (this.night >= 10) this.achievements.unlock('survivor_10')
        let endingTriggered = false
        if (!this.endingSeen && this.night >= ENDING_MILESTONE_NIGHT && this.achievements.unlocked.has('true_ending')) {
          this._showEndingSequence()
          endingTriggered = true
        }
        // Score Attack skips the perk-pick pause - staying in the run
        // without interruption is the point of a high-score chase mode.
        // The ending sequence takes priority over the perk pick this tick.
        if (!this.settings.scoreAttackMode && !endingTriggered) this._openPerkPanel()
      }
      this._updateProgressHud()
      this._updateStatsPanel()

      const playerPos = this.player.controls.object.position
      this._updateDirectorAI()
      this._updateAdrenaline()
      this.zombies.update(
        dt,
        playerPos,
        (dmg) => this._onZombieAttack(dmg),
        (x, z) => this.pickups.spawnLootDrop('ammo', x, z), // boss-only guaranteed drop, see ZombieManager
        () => audioEngine.playAmbushShriek(),
        (zombieTypeId, weaponId, x, z, isElite, isWandering) => this._onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering),
        this.player.isCrouching,
        this.dayNight ? this.dayNight.getPhaseInfo().phase === 'Night' : false
      )
      this.companion.update(dt, playerPos, this.zombies.zombies, (amount) => {
        this.playerState.heal(amount)
        this._updateHealthHud()
      })
      if (this.tempCompanion) this.tempCompanion.update(dt, playerPos, this.zombies.zombies, null)
      for (const recruit of this.recruits) recruit.update(dt, playerPos, this.zombies.zombies, null)
      this._updateCompanionDownedState(playerPos)
      for (const guard of this.safeZoneGuards) {
        guard.update(dt, guard.group.position, this.zombies.zombies, null)
      }
      this._updateSafeZoneHeal(dt, playerPos)
      if (this.flashlightOn) this._updateLightLure(playerPos)
      this.pickups.update(dt, elapsed, playerPos, {
        onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
      })
      this.xpGems.update(dt, elapsed, playerPos, (value) => this._onXpGemCollected(value))
      this.autoWeapons.update(dt, playerPos, this.zombies.zombies, () => {
        this._triggerShake(0.04, 80)
        this._triggerHitstop(30)
      })

      this._updateCulling(playerPos)
      this.chests.update(dt, elapsed, playerPos)
      this._updateVault(dt, playerPos)
      this._updateLockedCells(playerPos)
      this._updateTrophyWallProximity(playerPos)
      this._updateGenerator(dt, playerPos)
      this._updateTrader(playerPos)
      this._updateAmmoStation(dt, playerPos)
      this._updateBreakerBox(dt, playerPos)
      this._updateVehicleProximity(playerPos)
      this._updateVireoTerminal(playerPos)
      this._updateStationTerminal(playerPos)
      this._updateStationEncounter(playerPos)
      this._updateRescueSurvivor(playerPos)
      if (this.rescueSurvivor) this.rescueSurvivor.update(elapsed)
      this._updateRecruitSpots(elapsed, playerPos)
      this._updateBossHealthBar()
      this._updateKingOfTheHill(dt, playerPos)
      this._updateExtraction(dt, playerPos)

      this.barricadeWindows.update(dt, this.zombies.zombies, (w) => {
        this._showLoreToast('A barricade was breached! Zombies are pouring through.')
        this.zombies.spawnSurge(2)
        void w
      })
      this.nearBarricadeWindow = this.barricadeWindows.nearestRepairable(playerPos)

      const canRefuelGenerator = this.nearGenerator && this.inventory.fuelCans > 0 && this.generatorFuel < this.maxGeneratorFuel
      if (this.chests.nearbyChest) {
        this.interactPrompt.innerHTML = tHtml('interactPrompt')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearTrader) {
        this.interactPrompt.innerHTML = tHtml('interactTrader')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearVehicle) {
        this.interactPrompt.innerHTML = tHtml('interactEnterVehicle')
        this.interactPrompt.style.display = 'block'
      } else if (this.reviveTarget) {
        this.interactPrompt.innerHTML = tHtml('interactRevive')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearVireoTerminal) {
        this.interactPrompt.innerHTML = tHtml('interactTerminal')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearStationTerminal) {
        this.interactPrompt.innerHTML = tHtml('interactTerminal')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearRescueSurvivor) {
        this.interactPrompt.innerHTML = tHtml('interactRescue')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearRecruitSpot) {
        this.interactPrompt.innerHTML = tHtml('interactRecruit')
        this.interactPrompt.style.display = 'block'
      } else if (canRefuelGenerator) {
        this.interactPrompt.innerHTML = tHtml('interactRefuel')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearAmmoStation) {
        this.interactPrompt.innerHTML = tHtml('interactAmmoStation')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearBreakerBox) {
        this.interactPrompt.innerHTML = tHtml('interactBreakerBox')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearVault) {
        this.interactPrompt.innerHTML = tHtml(this.inventory.vaultKey ? 'interactVaultUnlock' : 'interactVaultLocked')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearLockedCell) {
        this.interactPrompt.innerHTML = tHtml('interactLockedCell')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearTrophyWall) {
        this.interactPrompt.innerHTML = tHtml('interactTrophyWall')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearBarricadeWindow) {
        this.interactPrompt.innerHTML = `<b>F</b> repair barricade (+${REPAIR_REWARD_POINTS} points)`
        this.interactPrompt.style.display = 'block'
      } else {
        this.interactPrompt.style.display = 'none'
      }
      this._updateMinimap(playerPos)
      this._updateCompass(playerPos)
      this._updateHordeAnnouncement()
      this._updateBarricades()
      this._updateDeathObstacles()
      this._updateHazardZones(dt, playerPos)
      this._maybeShowRadioChatter()
      this._updateLowAmmoCue()
      this._updatePracticeTargets()
      this._updateTraps()
      if (this.rivals.update(dt, playerPos, (dmg) => this._onRivalAttack(dmg))) this._rivalsClaimedAirdrop = true
      this._updateAirdrop()
      if (this.raining && this.nextLightningAt > 0 && performance.now() >= this.nextLightningAt) {
        this._triggerLightning()
      }
    }

    if (this.comboCount > 0 && performance.now() > this.comboResetAt) {
      this.comboCount = 0
      this.comboCounter.style.display = 'none'
    }

    this._updateShake(dt)
    this.camera.position.add(this._shakeOffset)

    this.composer.render()
  }
}

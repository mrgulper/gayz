import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildWorld, WORLD_CULL_DISTANCE, WORLD_SHADOW_CULL_DISTANCE } from './World.js'
import { LOW_QUALITY_MODE, flatMaterial } from './QualitySettings.js'
import { PlayerController } from './PlayerController.js'
import { WeaponSystem, WEAPON_CHARM_IDS } from './WeaponSystem.js'
import { ZombieManager } from './ZombieManager.js'
import { PickupManager } from './Pickups.js'
import { PlayerState } from './PlayerState.js'
import { Inventory } from './Inventory.js'
import { DayNightCycle } from './DayNightCycle.js'
import { ChestManager, Vault } from './Chests.js'
import { RivalManager } from './RivalScavenger.js'
import { loadMastery, saveMastery, MASTERY_THRESHOLD, MASTERY_DAMAGE_MULT, GRANDMASTER_THRESHOLD, GRANDMASTER_DAMAGE_MULT } from './WeaponMastery.js'
import { BarricadeWindows, REPAIR_REWARD_POINTS } from './BarricadeWindows.js'
import { Minimap } from './Minimap.js'
import { FullMap } from './FullMap.js'
import { DecalManager } from './Decals.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { rollPerks, checkPerkSynergies } from './Perks.js'
import { rollXpUpgrades } from './XpUpgrades.js'
import { XpGemManager } from './XpGems.js'
import { AutoWeaponManager } from './AutoWeapons.js'
import { COIN_SHOP_ITEMS, ATTACHMENT_TYPES } from './CoinShop.js'
import { pickNightEvent, NIGHT_MUTATIONS, NIGHT_MUTATION_CHANCE } from './NightEvents.js'
import { Companion } from './Companion.js'
import { Turret } from './Turret.js'
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
import { registerZone } from './Zones.js'

// Companion flavor barks - plain English rather than full i18n, since these
// are throwaway personality lines, not core UI text.
const COMPANION_BARKS = {
  lowHealth: ["You're bleeding out, use a health pack!", 'Stay with me!', "That doesn't look good.", 'Heal up, now!'],
  killStreak: ['Nice shooting!', "You're on fire tonight!", 'Keep it up!', 'Not bad.'],
  nightStart: ['Stay sharp out there.', 'Here we go again.', 'Eyes open.', "Let's not die tonight."],
  companionDown: ["I'm down, help!", 'Get them off me!', "I can't get up!", 'Revive me, quick!'],
  bossSpawn: ["Something big just showed up!", "That's not a regular one - watch yourself!", 'Big target, incoming!', "We've got a boss on us!"],
  // Companion bond dialogue (see _updateCompanionBond) - unlocks in order as
  // this run's elapsed time-together crosses COMPANION_BOND_THRESHOLDS_MS,
  // distinct from the flat always-available pools above: these specifically
  // read as the relationship warming up over the course of one run, not
  // random ambient flavor available from minute one.
  bondTier1: ["Guess we're stuck together for tonight.", "Don't slow me down and we'll get along fine."],
  bondTier2: ["You're better at this than I expected.", "Alright, I trust you to watch my back now."],
  bondTier3: ["Whatever happens out here, I'm glad it's you I ended up with.", "We've made it this far. Let's make it further."],
}

// Squad banter - a 2-line back-and-forth between companions, distinct
// from the single-voice COMPANION_BARKS above: only fires when a real
// squad exists (this.recruits.length >= 1, i.e. more than just the one
// main companion), reusing the same companionBarkEl display in sequence.
const SQUAD_BANTER_CHANCE = 0.5
const SQUAD_BANTER_LINE_DELAY_MS = 2600

// Companion bond dialogue (see _updateCompanionBond and COMPANION_BARKS'
// bondTier1/2/3 pools) - elapsed run time (this.elapsedRunMs-equivalent,
// see the call site) the main companion needs to have been alongside the
// player before each tier's line becomes available. Resets every fresh
// run, same as the rest of this run's companion state.
const COMPANION_BOND_THRESHOLDS_MS = [3 * 60 * 1000, 8 * 60 * 1000, 16 * 60 * 1000]
const SQUAD_BANTER_EXCHANGES = [
  ["Think we'll make it another night?", 'Ask me after, not before.'],
  ["You keeping count of these things?", 'Lost count a while back.'],
  ['Quiet is worse than the noise.', "Don't jinx it."],
  ['Heard anything on the radio?', 'Just static and bad news.'],
  ["You ever miss how things used to be?", "Every damn day."],
]

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
  shield: () => t('toastShieldAdded'),
  knife: () => t('toastKnifeAdded'),
  scope: () => t('toastScopeAdded'),
  fuelcan: () => t('toastFuelCanAdded'),
  extended_mag: () => t('toastMagAdded'),
  melee_bat: () => t('toastBatAdded'),
  melee_machete: () => t('toastMacheteAdded'),
  melee_uvbaton: () => t('toastUvBatonAdded'),
  melee_fireaxe: () => t('toastFireaxeAdded'),
  melee_sledgehammer: () => t('toastSledgehammerAdded'),
  weapon_charm: () => t('toastCharmAdded'),
  ration: () => t('toastRationAdded'),
}

// Starting stat tradeoffs, picked once on the main menu and applied a
// single time when a fresh run begins (see the playBtn click handler) -
// not reapplied on respawn, same as XP upgrades/perks.
const LOADOUT_PRESETS = {
  balanced: { moveSpeedDelta: 0, maxHealthMult: 1, maxStaminaDelta: 0 },
  runner: { moveSpeedDelta: 1.2, maxHealthMult: 0.75, maxStaminaDelta: 15 },
  tank: { moveSpeedDelta: -0.8, maxHealthMult: 1.35, maxStaminaDelta: -10 },
}

// Run-start trait draw (see _openTraitDrawPanel) - 3 of these are offered
// at the start of every run, pick one; a smaller, single, run-only choice
// layered on top of the Loadout tradeoff above rather than replacing it -
// distinct from XP upgrades (XpUpgrades.js), which only ever appear
// mid-run from leveling up.
const RUN_START_TRAITS = [
  { id: 'trait_fleet', titleKey: 'traitFleetTitle', apply: (game) => { game.player.moveSpeed *= 1.08 } },
  { id: 'trait_ironclad', titleKey: 'traitIroncladTitle', apply: (game) => { game.playerState.maxHealth += 15; game.playerState.health += 15 } },
  { id: 'trait_marksman', titleKey: 'traitMarksmanTitle', apply: (game) => { game.weapons.damageMult *= 1.06 } },
  { id: 'trait_lucky', titleKey: 'traitLuckyTitle', apply: (game) => { game.difficulty = { ...game.difficulty, lootMult: game.difficulty.lootMult * 1.15 } } },
  { id: 'trait_veteranInstinct', titleKey: 'traitVeteranInstinctTitle', apply: (game) => { game.player.maxStamina += 12; game.player.stamina = game.player.maxStamina } },
]

// Difficulty-tier opening flavor (see the playBtn click handler) - a
// one-line framing shown right as a fresh run begins, distinct from the
// difficulty PICKER labels above (diffFlavorEasy/etc keyed the same way).
const DIFFICULTY_FLAVOR_KEYS = { easy: 'diffFlavorEasy', normal: 'diffFlavorNormal', hard: 'diffFlavorHard', nightmare: 'diffFlavorNightmare', apex: 'diffFlavorApex' }
// Shared with _updateTexts' loadout button labels and the Journal's World
// State section (see _renderJournal) - one lookup instead of two copies.
const LOADOUT_LABEL_KEYS = { balanced: 'loadoutBalanced', runner: 'loadoutRunner', tank: 'loadoutTank' }
// Main-menu news ticker thresholds (see _updateMenuNewsTicker) - both read
// against bestStats.bestNight.
const NEWS_TICKER_MID_NIGHT = 5
const NEWS_TICKER_LATE_NIGHT = 15
const DIFFICULTY_PRESETS = {
  easy: { damageMult: 0.7, spawnRateMult: 0.75, healthMult: 0.8, eliteChanceMult: 0.6, lootMult: 1.3 },
  normal: { damageMult: 1, spawnRateMult: 1, healthMult: 1, eliteChanceMult: 1, lootMult: 1 },
  hard: { damageMult: 1.4, spawnRateMult: 1.3, healthMult: 1.25, eliteChanceMult: 1.4, lootMult: 0.85 },
  // Unlocked by the "Ground Truth" (true_ending) achievement - see the
  // diff-nightmare visibility toggle right after Achievements loads.
  nightmare: { damageMult: 1.8, spawnRateMult: 1.6, healthMult: 1.5, eliteChanceMult: 1.8, lootMult: 0.7 },
  // Apex - unlocked by 'nightmare_conqueror' (see APEX_UNLOCK_NIGHT), the
  // same "beat the game, unlock something harder" precedent nightmare
  // itself already set, one rung further out.
  apex: { damageMult: 2.3, spawnRateMult: 2, healthMult: 1.85, eliteChanceMult: 2.2, lootMult: 0.6 },
}
// Nights survived on Nightmare to unlock both 'nightmare_conqueror' and the
// Apex difficulty tier it gates.
const APEX_UNLOCK_NIGHT = 15

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
      hudScale: parsed.hudScale ?? 100,
      hudOpacity: parsed.hudOpacity ?? 100,
      colorblind: parsed.colorblind ?? false,
      performanceMode: parsed.performanceMode ?? false,
      // Accessibility (see the settings-page-controls HTML section) -
      // shakeIntensity/toastDuration are percentages of the normal/default
      // value, not absolute units.
      shakeIntensity: parsed.shakeIntensity ?? 100,
      reduceFlashing: parsed.reduceFlashing ?? false,
      toggleSprint: parsed.toggleSprint ?? false,
      toggleCrouch: parsed.toggleCrouch ?? false,
      toggleAds: parsed.toggleAds ?? false,
      aimAssist: parsed.aimAssist ?? false,
      bigInteractPrompt: parsed.bigInteractPrompt ?? false,
      toastDuration: parsed.toastDuration ?? 100,
      crosshairColor: parsed.crosshairColor || '#ffffff',
      crosshairSize: parsed.crosshairSize ?? 100,
      nickname: parsed.nickname || '',
      // Custom companion name (see _updateCompanionName) - falls back to
      // the auto-generated "{nickname}'s Assistant" pattern when empty.
      companionName: parsed.companionName || '',
      defaultTag: parsed.defaultTag || null,
      companionRole: ['melee', 'medic'].includes(parsed.companionRole) ? parsed.companionRole : 'ranged',
      scoreAttackMode: parsed.scoreAttackMode ?? false,
      hardcoreMode: parsed.hardcoreMode ?? false,
      endlessMode: parsed.endlessMode ?? false,
      loadout: LOADOUT_PRESETS[parsed.loadout] ? parsed.loadout : 'balanced',
      // 5-slot hotbar (see Game.js's _bindHotbar) - a weapon id per slot,
      // or null for empty. Defaults match the request this was built for:
      // melee/AK-47/M1911 filled in, two open slots for whatever's bought.
      hotbar: Array.isArray(parsed.hotbar) && parsed.hotbar.length === 5 ? parsed.hotbar : ['melee', 'rifle', 'pistol', null, null],
      // Loadout save slots (see Game.js's _saveHotbarPreset/_loadHotbarPreset) -
      // 3 named snapshots of the 5-slot hotbar above, so switching between a
      // couple of full weapon setups doesn't mean re-assigning every slot by
      // hand each time. null entries are empty/unsaved slots.
      hotbarPresets: Array.isArray(parsed.hotbarPresets) && parsed.hotbarPresets.length === 3 ? parsed.hotbarPresets : [null, null, null],
      mutators: {
        hordeRush: parsed.mutators?.hordeRush ?? false,
        lootRush: parsed.mutators?.lootRush ?? false,
        pureGunplay: parsed.mutators?.pureGunplay ?? false,
        bossRush: parsed.mutators?.bossRush ?? false,
        hordeMode: parsed.mutators?.hordeMode ?? false,
        kingOfTheHill: parsed.mutators?.kingOfTheHill ?? false,
        extraction: parsed.mutators?.extraction ?? false,
        dailyChallenge: parsed.mutators?.dailyChallenge ?? false,
        // Off by default - deliberately a toggle, not a replacement for
        // manual healing (medkits, safe-zone rest). See _updateHealthRegen's
        // own comment for why this stays optional rather than becoming the
        // new baseline.
        healthRegen: parsed.mutators?.healthRegen ?? false,
        ironMode: parsed.mutators?.ironMode ?? false,
        scavenger: parsed.mutators?.scavenger ?? false,
        glassHouse: parsed.mutators?.glassHouse ?? false,
        featuredEnemy: parsed.mutators?.featuredEnemy ?? false,
        blackout: parsed.mutators?.blackout ?? false,
        bossGauntlet: parsed.mutators?.bossGauntlet ?? false,
      },
    }
  } catch {
    return { language: 'en', musicVolume: 100, sfxVolume: 100, difficulty: 'normal', sensitivity: 100, fov: 75, hudScale: 100, hudOpacity: 100, colorblind: false, shakeIntensity: 100, reduceFlashing: false, toggleSprint: false, toggleCrouch: false, toggleAds: false, aimAssist: false, bigInteractPrompt: false, toastDuration: 100, crosshairColor: '#ffffff', crosshairSize: 100, nickname: '', companionName: '', defaultTag: null, companionRole: 'ranged', scoreAttackMode: false, hardcoreMode: false, endlessMode: false, loadout: 'balanced', performanceMode: false, hotbar: ['melee', 'rifle', 'pistol', null, null], hotbarPresets: [null, null, null], mutators: { hordeRush: false, lootRush: false, pureGunplay: false, bossRush: false, hordeMode: false, kingOfTheHill: false, extraction: false, dailyChallenge: false, healthRegen: false, ironMode: false, scavenger: false, glassHouse: false, featuredEnemy: false, blackout: false, bossGauntlet: false } }
  }
}

// See _updateCulling - every World.js flickerLights PointLight has a real
// illumination range well under this, so turning one off past this distance
// from the player can't darken anything actually visible. Shrunk under
// LOW_QUALITY_MODE - fewer simultaneously-active lights, each one a real
// per-pixel cost against every visible fragment in this forward renderer.
const LIGHT_CULL_DISTANCE = LOW_QUALITY_MODE ? 60 : 100

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

// Tracked separately from bestStats.bestNight - Endless forces Round Mode's
// kill-the-wave loop regardless of difficulty (see _isRoundMode), so a great
// Endless run at Nightmare difficulty shouldn't get averaged in with (or
// overwrite) a casual Easy-mode Round Mode best, same reasoning as why
// Score Attack/Daily Challenge each get their own key instead of sharing
// bestStats.
const ENDLESS_BEST_KEY = 'gayz-endless-best'

function loadEndlessBest() {
  try {
    return Number(localStorage.getItem(ENDLESS_BEST_KEY)) || 0
  } catch {
    return 0
  }
}

function saveEndlessBest(round) {
  try {
    localStorage.setItem(ENDLESS_BEST_KEY, String(round))
  } catch {
    // Storage unavailable - best round just won't persist.
  }
}

// Endless Mode milestone rewards - a one-time coin bonus every
// ENDLESS_MILESTONE_INTERVAL nights, tracked as "highest milestone ever
// claimed" (not per-run) so re-reaching an already-claimed milestone in a
// later run doesn't re-grant it, but pushing past a new one always does.
const ENDLESS_MILESTONE_INTERVAL = 10
const ENDLESS_MILESTONE_REWARD_COINS = 100
const ENDLESS_MILESTONE_KEY = 'gayz-endless-milestone'

function loadEndlessMilestone() {
  try {
    return Number(localStorage.getItem(ENDLESS_MILESTONE_KEY)) || 0
  } catch {
    return 0
  }
}

function saveEndlessMilestone(n) {
  try {
    localStorage.setItem(ENDLESS_MILESTONE_KEY, String(n))
  } catch {
    // Storage unavailable - milestone progress just won't persist.
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

// Weekly Challenge - a rotating kill-count goal distinct from the Daily
// Challenge mutator above: no spawn/damage twist or hardcore forcing, just
// a cumulative target tracked across every run played that week, with a
// one-time coin reward on completion. Deliberately lighter-weight than
// fully mirroring the Daily Challenge's whole mutator machinery.
const WEEKLY_CHALLENGES = [
  { id: 'headhunter', titleKey: 'weeklyHeadhunter', target: 300, rewardCoins: 200 },
  { id: 'exterminator', titleKey: 'weeklyExterminator', target: 500, rewardCoins: 300 },
  { id: 'sharpshooter', titleKey: 'weeklySharpshooter', target: 200, rewardCoins: 150 },
]

function _thisWeekStr() {
  const d = new Date()
  const firstJan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d - firstJan) / 86400000 + firstJan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${week}`
}

function _weeklyChallengeIndex(weekStr) {
  let hash = 0
  for (let i = 0; i < weekStr.length; i++) hash = (hash * 31 + weekStr.charCodeAt(i)) | 0
  return Math.abs(hash) % WEEKLY_CHALLENGES.length
}

const WEEKLY_CHALLENGE_KEY = 'gayz-weekly-challenge'

function loadWeeklyChallenge() {
  const week = _thisWeekStr()
  try {
    const raw = localStorage.getItem(WEEKLY_CHALLENGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.week === week) return parsed
    return { week, progress: 0, completed: false }
  } catch {
    return { week, progress: 0, completed: false }
  }
}

function saveWeeklyChallenge(w) {
  try {
    localStorage.setItem(WEEKLY_CHALLENGE_KEY, JSON.stringify(w))
  } catch {
    // Storage unavailable - weekly challenge progress just won't persist.
  }
}

// Weekly Featured Mutator - a single mutator auto-picked via the same
// week-seed technique WEEKLY_CHALLENGES above already uses, nudging
// players toward trying a different mutator each week via a coin bonus -
// never forced, the player still has to check the box themselves.
const WEEKLY_FEATURED_MUTATORS = ['hordeRush', 'pureGunplay', 'bossRush', 'hordeMode', 'glassHouse', 'scavenger', 'featuredEnemy', 'blackout']
const WEEKLY_FEATURED_MUTATOR_BONUS_COINS = 50
const WEEKLY_FEATURED_MUTATOR_LABEL_KEYS = {
  hordeRush: 'mutatorHordeRush',
  pureGunplay: 'mutatorPureGunplay',
  bossRush: 'mutatorBossRush',
  hordeMode: 'mutatorHordeMode',
  glassHouse: 'mutatorGlassHouse',
  scavenger: 'mutatorScavenger',
  featuredEnemy: 'mutatorFeaturedEnemy',
  blackout: 'mutatorBlackout',
}

function _weeklyFeaturedMutatorKey() {
  const weekStr = _thisWeekStr()
  // +7 offset so this doesn't land on the exact same hash bucket
  // WEEKLY_CHALLENGES' own index would for the same week string.
  let hash = 7
  for (let i = 0; i < weekStr.length; i++) hash = (hash * 31 + weekStr.charCodeAt(i)) | 0
  return WEEKLY_FEATURED_MUTATORS[Math.abs(hash) % WEEKLY_FEATURED_MUTATORS.length]
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
    return { bestNight: parsed.bestNight || 0, bestKills: parsed.bestKills || 0, bestKillStreak: parsed.bestKillStreak || 0 }
  } catch {
    return { bestNight: 0, bestKills: 0, bestKillStreak: 0 }
  }
}

function saveBestStats(stats) {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - best stats just won't persist across sessions.
  }
}

// Narrative Stats - lifetime, never-reset counters for the story-facing
// systems below (rescued/lost survivors, which boss epitaphs have been
// read), same "cumulative across every run on this save" shape as
// careerStats, just tracking narrative beats instead of raw kill count.
const NARRATIVE_STATS_KEY = 'gayz-narrative-stats'

function loadNarrativeStats() {
  try {
    const raw = localStorage.getItem(NARRATIVE_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      rescued: parsed.rescued || 0,
      lost: parsed.lost || 0,
      bossEpitaphsSeen: Array.isArray(parsed.bossEpitaphsSeen) ? parsed.bossEpitaphsSeen : [],
    }
  } catch {
    return { rescued: 0, lost: 0, bossEpitaphsSeen: [] }
  }
}

function saveNarrativeStats(stats) {
  try {
    localStorage.setItem(NARRATIVE_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - narrative stats just won't persist across sessions.
  }
}

// Career Rank - a cumulative, NEVER-reset lifetime total (unlike bestStats'
// single-run bests, and unlike MetaProgress's prestigeLevel which is a
// deliberate reset-everything choice) - purely a "how much have you played,
// ever" number, feeding both a display title and the Veteran Perks below.
const CAREER_STATS_KEY = 'gayz-career-stats'
const CAREER_RANK_TITLES = [
  { min: 0, titleKey: 'careerRankRookie' },
  { min: 1000, titleKey: 'careerRankSurvivor' },
  { min: 5000, titleKey: 'careerRankVeteran' },
  { min: 15000, titleKey: 'careerRankElite' },
  { min: 50000, titleKey: 'careerRankLegend' },
]
// Auto-granted once each, permanently, purely from lifetime kills - distinct
// from Legacy Points' spent-on-purpose upgrades and from Weapon Mastery's
// per-weapon threshold, this is a single account-wide "you've clearly put
// the hours in" bonus with no choice involved.
const VETERAN_PERKS = [
  { id: 'veteran_500', killThreshold: 500, apply: (game) => { game.playerState.maxHealth += 10; game.playerState.health += 10 } },
  { id: 'veteran_2000', killThreshold: 2000, apply: (game) => { game.player.maxStamina += 10; game.player.stamina = game.player.maxStamina } },
  { id: 'veteran_5000', killThreshold: 5000, apply: (game) => { game.weapons.damageMult += 0.05 } },
]

function loadCareerStats() {
  try {
    const raw = localStorage.getItem(CAREER_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { totalKills: parsed.totalKills || 0, totalRuns: parsed.totalRuns || 0, veteranPerksGranted: parsed.veteranPerksGranted || [] }
  } catch {
    return { totalKills: 0, totalRuns: 0, veteranPerksGranted: [] }
  }
}

function saveCareerStats(stats) {
  try {
    localStorage.setItem(CAREER_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - career stats just won't persist across sessions.
  }
}

// Companion Legacy - a persistent bonus level layered on top of
// companionTrainingLevel (session-only by design, see Game.js's own
// precedent comment on that field), growing +1 per completed run that
// reaches COMPANION_LEGACY_MIN_NIGHT, capped at COMPANION_LEGACY_MAX. The
// two levels are simply added together at the applyTraining() call sites
// rather than needing any change to Companion.js itself.
const COMPANION_LEGACY_KEY = 'gayz-companion-legacy'
const COMPANION_LEGACY_MIN_NIGHT = 3
const COMPANION_LEGACY_MAX = 15

function loadCompanionLegacy() {
  try {
    const raw = localStorage.getItem(COMPANION_LEGACY_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { level: parsed.level || 0 }
  } catch {
    return { level: 0 }
  }
}

function saveCompanionLegacy(data) {
  try {
    localStorage.setItem(COMPANION_LEGACY_KEY, JSON.stringify(data))
  } catch {
    // Storage unavailable - companion legacy just won't persist across sessions.
  }
}

function careerRankTitleKey(totalKills) {
  let key = CAREER_RANK_TITLES[0].titleKey
  for (const tier of CAREER_RANK_TITLES) {
    if (totalKills >= tier.min) key = tier.titleKey
  }
  return key
}

// Daily Login Streak - consecutive CALENDAR days played, distinct from the
// Weekly Challenge (a single rotating task) and Bounty Board (per-run
// objective) - this is purely "did you come back today," resetting to 1
// the moment a day is skipped rather than decaying gradually.
const LOGIN_STREAK_KEY = 'gayz-login-streak'
const LOGIN_STREAK_COIN_PER_DAY = 15
const LOGIN_STREAK_MAX_BONUS_DAYS = 10

function loadLoginStreak() {
  try {
    const raw = localStorage.getItem(LOGIN_STREAK_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { lastDate: parsed.lastDate || null, streak: parsed.streak || 0 }
  } catch {
    return { lastDate: null, streak: 0 }
  }
}

function saveLoginStreak(state) {
  try {
    localStorage.setItem(LOGIN_STREAK_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable - streak just won't persist across sessions.
  }
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10)
}

function yesterdayDateString() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Local leaderboard - a ranked history of runs, distinct from bestStats
// above (a single best-ever record with no history). Every run that ends
// (death or dawn-survival) adds one entry; kept sorted best-first and
// capped at LEADERBOARD_MAX_ENTRIES so this can't grow unbounded.
const LEADERBOARD_KEY = 'gayz-leaderboard'
const LEADERBOARD_MAX_ENTRIES = 10

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveLeaderboard(entries) {
  try {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable - leaderboard just won't persist across sessions.
  }
}

// Boss Rush leaderboard - a genuinely separate board/cap from the main one
// above, not just a tagged entry sharing its cap. A flood of normal runs
// would otherwise push every Boss Rush entry out of the shared top-10
// regardless of how good those runs were.
const BOSS_RUSH_LEADERBOARD_KEY = 'gayz-bossrush-leaderboard'

function loadBossRushLeaderboard() {
  try {
    const raw = localStorage.getItem(BOSS_RUSH_LEADERBOARD_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveBossRushLeaderboard(entries) {
  try {
    localStorage.setItem(BOSS_RUSH_LEADERBOARD_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable - leaderboard just won't persist across sessions.
  }
}

// Hardcore Mode death memorial - a permanent, never-pruned-by-cap record of
// every one-life character lost (unlike the leaderboards above, this isn't
// a top-N ranking, it's a full history, so each hardcore attempt becomes
// its own remembered "story" rather than just another leaderboard row that
// can get pushed out by a better one).
const HARDCORE_MEMORIAL_KEY = 'gayz-hardcore-memorial'
const HARDCORE_MEMORIAL_MAX_ENTRIES = 20

function loadHardcoreMemorial() {
  try {
    const raw = localStorage.getItem(HARDCORE_MEMORIAL_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHardcoreMemorial(entries) {
  try {
    localStorage.setItem(HARDCORE_MEMORIAL_KEY, JSON.stringify(entries))
  } catch {
    // Storage unavailable - memorial just won't persist across sessions.
  }
}

// Shared Stash - a small cross-run bank for a few consumables (see
// STASH_ITEMS), distinct from every other persistence system in this game:
// Legacy Points/Coin Shop persist STATS, this persists actual inventory
// items. Deposited via the Trader panel, auto-withdrawn into inventory the
// next time a fresh page load starts (see Game.js constructor).
const STASH_KEY = 'gayz-stash'
const STASH_ITEMS = [
  { invKey: 'healthPacks', titleKey: 'shopHealthPack' },
  { invKey: 'grenades', titleKey: 'shopGrenade' },
  { invKey: 'fuelCans', titleKey: 'shopFuelCan' },
  { invKey: 'rations', titleKey: 'shopRation' },
]

function loadStash() {
  try {
    const raw = localStorage.getItem(STASH_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const stash = {}
    for (const item of STASH_ITEMS) stash[item.invKey] = Math.max(0, Math.floor(parsed[item.invKey] || 0))
    return stash
  } catch {
    const stash = {}
    for (const item of STASH_ITEMS) stash[item.invKey] = 0
    return stash
  }
}

function saveStash(stash) {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(stash))
  } catch {
    // Storage unavailable - stash just won't persist across sessions.
  }
}

// Trader leveling - cumulative Points ever sold to the Trader (persists
// across every run, never resets), unlocking a small permanent discount
// tier every TRADER_LEVEL_SALES_PER_TIER sold. Stacks with (multiplies
// into) the existing traderDiscount meta-upgrade in _traderPrice, rather
// than replacing it.
const TRADER_SALES_KEY = 'gayz-trader-sales'
const TRADER_LEVEL_SALES_PER_TIER = 2000
const TRADER_LEVEL_DISCOUNT_PER_TIER = 0.01
const TRADER_LEVEL_MAX_DISCOUNT = 0.2

function loadTraderSales() {
  try {
    return Math.max(0, Number(localStorage.getItem(TRADER_SALES_KEY)) || 0)
  } catch {
    return 0
  }
}

function saveTraderSales(total) {
  try {
    localStorage.setItem(TRADER_SALES_KEY, String(total))
  } catch {
    // Storage unavailable - trader level just won't persist across sessions.
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
      ownedOutfits: new Set(parsed.ownedOutfits || []),
      equippedOutfit: parsed.equippedOutfit || null,
      challengeKillCounts: parsed.challengeKillCounts || {},
      weaponChallengesUnlocked: new Set(parsed.weaponChallengesUnlocked || []),
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
    return { points: 0, coins: 0, ownedSkins: new Set(), equippedSkin: null, ownedOutfits: new Set(), equippedOutfit: null, challengeKillCounts: {}, weaponChallengesUnlocked: new Set(), shopPurchased: new Set(), unlockedGuns: [], attachments: [] }
  }
}

function saveShopProgress(game) {
  try {
    localStorage.setItem(SHOP_PROGRESS_KEY, JSON.stringify({
      points: game.points,
      coins: game.coins,
      ownedSkins: [...game.ownedSkins],
      equippedSkin: game.equippedSkin,
      ownedOutfits: [...game.ownedOutfits],
      equippedOutfit: game.equippedOutfit,
      challengeKillCounts: game.challengeKillCounts,
      weaponChallengesUnlocked: [...game.weaponChallengesUnlocked],
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
const ROCKFALL_TRIGGER_RADIUS = 2.8
const ROCKFALL_BURST_DAMAGE = 22
// Performance: bloom is an inherently soft/blurred effect, so running its
// own internal buffer at a fraction of screen resolution costs almost no
// visible quality while cutting the pixels it has to shade to a quarter.
const BLOOM_RESOLUTION_SCALE = 0.5
// Stage 14's fog-of-war grid - must match the cell size FullMap.js and
// Minimap.js's own fog overlay use, since they all read the same
// discoveredCells Set of "cellX,cellZ" string keys.
const EXPLORE_CELL_SIZE = 20
const EXPLORE_REVEAL_RADIUS_CELLS = 2
const LANDMARK_DISCOVERY_COINS = 25
// Zone Danger Rating - warns the first time the player wanders into a zone
// dense enough to actually matter (see Zones.js's densityMult), reusing
// ZombieManager's own already-computed currentZone rather than a second
// getZoneAt query every frame.
const ZONE_DANGER_THRESHOLD = 1.4
// Lore Markers - visual, inspectable world props (distinct from the
// existing Audio Logs collectibles) at a handful of named locations,
// reusing their real coordinates with a small offset rather than needing a
// fresh clearance check.
const LORE_MARKERS = [
  { id: 'library', x: 324, z: 160, textKey: 'loreMarkerLibrary' },
  { id: 'church', x: 334, z: 70, textKey: 'loreMarkerChurch' },
  { id: 'school', x: -324, z: 150, textKey: 'loreMarkerSchool' },
]
const LORE_MARKER_INTERACT_RADIUS = 2.5
const LIGHT_LURE_RADIUS = 20
const LIGHT_LURE_INTERVAL_MS = 2000
const SAFE_ZONE_HEAL_PER_SEC = 6
// Health Regen mutator (off by default, see loadSettings) - a deliberate
// toggle rather than the new baseline: manual healing (medkits, safe-zone
// rest) is the game's own survival-tension choice, not an oversight, so
// this stays opt-in for whoever wants the more forgiving CoD-style flow.
const HEALTH_REGEN_DELAY_SEC = 6
const HEALTH_REGEN_PER_SEC = 4
// Riot Shield - trades firing (see WeaponSystem's canFire check) for a flat
// damage cut on anything that gets through anyway (no per-attacker facing
// check - simpler than tracking attacker angle, and still reads as "block"
// since it's a large, constant reduction).
const SHIELD_DAMAGE_REDUCTION = 0.7
// Throwing Knife - a fast, silent one-hit-kill throwable, distinct from the
// grenade's slow lob + AOE.
const KNIFE_THROW_SPEED = 24
const KNIFE_DAMAGE = 500
// Weapon Upgrade Machine - cost doubles each use *this run* (resets with
// everything else on a fresh run), capped uses *per night* so it can't be
// abused as a single mega-grind session.
const UPGRADE_MACHINE_BASE_COST = 500
const UPGRADE_MACHINE_MULT = 1.6
const UPGRADE_MACHINE_USES_PER_NIGHT = 2
const UPGRADE_MACHINE_RADIUS = 2.2
// Mystery Box - flat cost, no scaling (unlike the upgrade machine above,
// re-rolling isn't meant to get progressively harder to discourage, just to
// cost something each time).
const MYSTERY_BOX_COST = 950
const MYSTERY_BOX_RADIUS = 2.2
const MAX_DEPLOYED_TURRETS = 3
// Field power-ups - a small chance per kill (see _onZombieKilled) to drop
// one of these instead of (not in addition to) the normal loot roll,
// mirroring spawnKillDrop's own "every 10th kill" guaranteed drop but at a
// much lower, random rate across every kill. Collected the same walkover
// way as any other pickup (see Pickups.js) - Game.js only owns what
// happens once type reaches _onPickup below.
const POWERUP_DROP_CHANCE = 0.02
const POWERUP_TYPES = ['double_points', 'nuke', 'instakill', 'zombie_blood', 'cleaning_kit']
const CLEANING_KIT_DURATION_MS = 45000
const CLEANING_KIT_JAM_MULT = 0.15
const DOUBLE_POINTS_DURATION_MS = 20000
const INSTAKILL_DURATION_MS = 20000
const ZOMBIE_BLOOD_DURATION_MS = 20000
// Last Stand - once per run (this.lastStandUsed), a reprieve instead of an
// instant death: crawl speed, pistol-locked, a kill quota to claw back up
// under your own power before the window runs out for real.
const LAST_STAND_DURATION_MS = 15000
const LAST_STAND_KILLS_NEEDED = 3
const LAST_STAND_SPEED_MULT = 0.3
const LAST_STAND_REVIVE_HEALTH_FRAC = 0.4
const LIGHT_LURE_ENRAGE_MS = 2500
const VEHICLE_INTERACT_RADIUS = 3
const VIREO_TERMINAL_RADIUS = 2.5
const STATION_ENCOUNTER_RADIUS = 8
const STATION_ENCOUNTER_ZOMBIE_COUNT = 4
const PERK_REROLL_COST = 15
const COMBO_WINDOW_MS = 3000
const COMBO_MIN_DISPLAY = 2
// Escalating combo popup (see _registerComboKill's tier class toggle) -
// COMBO_MULT_CAP below already maxes the damage bonus out around 11 kills,
// so these tiers are pitched a bit past that: still climbing after the
// mechanical reward caps out is exactly when the visual payoff should keep
// escalating.
const COMBO_TIER2_THRESHOLD = 10
const COMBO_TIER3_THRESHOLD = 20
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
// Wave-Clear Finisher Cam - shorter than the boss killcam above since this
// fires far more often (any time the alive-zombie count hits 0, not just
// once per boss).
const WAVE_CLEAR_KILLCAM_DURATION_MS = 500
const KILLCAM_SLOWMO_FACTOR = 0.2
// Landing camera dip - only a genuinely hard fall dips the camera (a normal
// jump lands around -10 to -12, a stair/step correction is well under -4,
// see PlayerController's GRAVITY/JUMP_SPEED). Scale/max keep a long fall off
// the skyscraper roof from producing an absurd dip - it clamps instead of
// scaling forever.
const LANDING_DIP_MIN_IMPACT = -4
const LANDING_DIP_SCALE = 0.01
const LANDING_DIP_MAX = 0.35
const LANDING_DIP_RECOVER_SPEED = 9
// Gunfire alerts nearby zombies (see _alertNearbyZombiesToGunfire) - an
// unaware zombie within radius instantly notices the player, no line-of-
// sight required (a gunshot is heard through walls, unlike being seen).
// Suppressed weapons alert at much shorter range instead of not at all -
// still a gun going off, just a quieter one.
const GUNFIRE_ALERT_RADIUS = 22
const GUNFIRE_ALERT_RADIUS_SUPPRESSED = 6
const KILLCAM_ZOOM_FOV_MULT = 0.75
// Killstreak rewards - this.killStreak counts consecutive kills without
// dying (reset in _onPlayerDeath), distinct from the flat "every 10th kill"
// loot drop _onZombieKilled already does off the lifetime this.kills
// counter. Three escalating one-shot rewards, no repeat until the next
// life (killStreak only grows, thresholds only ever fire once per streak).
const KILLSTREAK_DAMAGE_THRESHOLD = 5
const KILLSTREAK_DAMAGE_MULT = 1.5
const KILLSTREAK_DAMAGE_DURATION_MS = 8000
const KILLSTREAK_AIRSTRIKE_THRESHOLD = 10
const KILLSTREAK_AIRSTRIKE_RADIUS = 12
const KILLSTREAK_AIRSTRIKE_DAMAGE_MIN = 100
const KILLSTREAK_AIRSTRIKE_DAMAGE_MAX = 260
const KILLSTREAK_AMMO_THRESHOLD = 15
const KILLSTREAK_AMMO_DURATION_MS = 6000
// Per-weapon challenge unlock - a distinct "veteran" camo (see
// Viewmodels.js's SKIN_TINTS) earned by kill count with that specific gun,
// tracked separately from killCountsByWeapon.minigun above (that one's
// scoped to the meat_grinder achievement at a different threshold - reusing
// the same counter here would double-increment it on minigun kills).
const CHALLENGE_KILL_THRESHOLD = 30
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
const ELECTRIC_TRAP_CHANCE = 0.25
const ELECTRIC_TRAP_STUN_MS = 2200
// Tripwire alarm - unlike a trap, never damages anything; it's an
// early-warning tool (see _triggerAlarm) with a wider detection radius and
// a longer lifetime since it's meant to watch an approach, not punish one
// specific step.
const ALARM_PLACE_DIST = 1.8
const ALARM_TRIGGER_RADIUS = 6
const ALARM_LIFETIME_MS = 60000
// Hunger - light survival pressure alongside health, not a hard fail
// state: it only ever slow-drains health while empty (HUNGER_STARVE_DPS),
// never kills outright on its own. Full depletion takes ~10 real minutes
// of play, restored by eating Rations (press 0).
const HUNGER_DECAY_PER_SEC = 100 / 600
const HUNGER_STARVE_DPS = 2
// Critical-health blood-edge overlay - a lower, more severe threshold than
// the existing low-health pulse (health < 30), its own escalation tier.
const CRITICAL_HEALTH_THRESHOLD = 15
const RATION_HUNGER_RESTORE = 40
// Thirst - same shape as Hunger right above (own meter, own starve-damage
// floor, own restore item), decaying a little faster since real thirst
// outpaces hunger.
const THIRST_DECAY_PER_SEC = 100 / 420
const THIRST_DEHYDRATE_DPS = 2
const WATER_THIRST_RESTORE = 45
// Temperature/Exposure - unlike Hunger/Thirst (always draining, restored by
// consumables), warmth passively drifts toward whichever end the player's
// current situation favors: rain or an outdoor night chills it, being
// indoors or it being daytime warms it back up. No consumable - shelter and
// time of day are the only counterplay.
const WARMTH_DRIFT_PER_SEC = 100 / 90
const WARMTH_LOW_THRESHOLD = 30
const WARMTH_STAMINA_REGEN_MULT = 0.6
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
// Contaminated water (see NightEvents.js's 'toxic_spread') - unlike the
// sewer's own fixed toxic pool (_updateToxicWater, one specific
// underground location, constant size), this spawns anywhere and grows
// every tick it's not dealt with, so ignoring it has a real cost.
const TOXIC_SPREAD_DURATION_MS = 40000
const TOXIC_SPREAD_START_RADIUS = 4
const TOXIC_SPREAD_MAX_RADIUS = 16
const TOXIC_SPREAD_GROWTH_PER_SEC = 0.3
const TOXIC_SPREAD_DAMAGE_PER_TICK = 6
// Acid Trail zombie (see ZombieTypes.js's leavesTrail) - a small fixed pool
// dropped on a cooldown while it's alive and moving, same tick-damage shape
// as the gas zone above rather than a new hazard mechanic.
const HAZARD_ACID_RADIUS = 3
const HAZARD_ACID_DURATION_MS = 8000
const HAZARD_ACID_DAMAGE_PER_TICK = 6
// Webber zombie (see ZombieTypes.js's plantsWeb) - a patch that slows
// instead of damaging, read by PlayerController's webSlowMult the same way
// corpse piles read corpsePileMult below.
const HAZARD_WEB_RADIUS = 4
const HAZARD_WEB_DURATION_MS = 6000
const WEB_SLOW_MULT = 0.55
// Corpse pile-up - a cluster of recent kills slows the player passing
// through it (see PlayerController's corpsePileMult), recomputed live
// every frame from a rolling window of recent kill spots rather than a
// persistent world object.
const CORPSE_PILE_RADIUS = 6
const CORPSE_PILE_WINDOW_MS = 30000
const CORPSE_PILE_MIN_KILLS = 6
const CORPSE_PILE_SPEED_MULT = 0.7
const CORPSE_PILE_MAX_TRACKED = 200
// Run Score Multiplier (see _comboMultiplier) - a points-only bonus layered
// on top of the existing on-screen combo counter (this.comboCount, see
// _registerComboKill) rather than a second parallel "kills close together"
// tracker - that counter was purely cosmetic before this, never affecting
// actual rewards.
const COMBO_MULT_PER_KILL = 0.15
const COMBO_MULT_CAP = 2.5
const DAMAGE_NUMBER_MAX_CONCURRENT = 40
// Rain reduces how far wandering zombies notice the player (see
// _rollNightMutation) - a real gameplay tie-in for the existing weather
// roll, not just the rain overlay/thunder sound it already had.
const RAIN_AGGRO_RADIUS_MULT = 0.7
// Weather-reactive lighting - multiplies on top of the existing day/night
// hemi/sun intensity lerp (see DayNightCycle.js) rather than a second
// competing light system.
const WEATHER_DIM_RAIN = 0.7
const WEATHER_DIM_SNOW = 0.85
// Blackout mutator - near-zero ambient/sun, not literally 0 (a true 0 would
// make the flashlight's own light contribution invisible against a fully
// black backdrop in a way that reads as broken rather than "dark").
const BLACKOUT_DIM = 0.08
// Indoor detection (see _updateIndoorDetection) - throttled, not per-frame;
// a straight-up raycast is cheap but still no reason to run it 60x/sec for
// something that only changes when the player actually walks through a
// doorway or roofline.
const INDOOR_CHECK_INTERVAL_MS = 400
const INDOOR_RAY_MAX_DIST = 6
const FOOTSTEP_INTERVAL_WALK = 0.42
const FOOTSTEP_INTERVAL_SPRINT = 0.27
// Seasonal map dressing - purely additive banner props at the safe zone
// (no new geometry touching World.js/buildSafeZone), recolored based on
// night number so there's rotating visual variety across a long run.
const SEASONAL_THEMES = [
  { id: 'default', color: 0x4a7a5a },
  { id: 'harvest', color: 0xcf6a2a },
  { id: 'frost', color: 0x4ecfff },
]
// Road pileups - car-wreck obstacles rerolled at random spawn points each
// night (see _rollRoadPileups), distinct from _maybeDropObstacle's
// kill-reactive rubble (a combat byproduct, not a deliberate night-start
// placement).
const ROAD_PILEUP_COUNT = 3
// Destructible shortcut wall - a single, hand-placed obstacle (see
// _buildDestructibleWall) at a known-clear spawnPoint-derived location,
// deliberately not touching World.js's deterministic buildingLayout() at
// all - see CLAUDE.md's own notes on how risky hand-authored geometry near
// existing buildings/the safe zone has been in this codebase before.
const DESTRUCTIBLE_WALL_HEALTH = 220
// Zipline - reuses the exact position-teleport fast travel already has
// (see the fullMapCanvas click handler) rather than new traversal physics,
// bi-directional between 2 fixed points connected by a purely decorative
// cable (no collider - see _buildZipline's own note).
const ZIPLINE_INTERACT_RADIUS = 3
// Farming Plot - passive Ration trickle while built, feeding the hunger
// meter's economy (see CoinShop.js's farm_plot entry).
const FARM_HARVEST_INTERVAL_MS = 90000
// Ammo Press - same passive-trickle base structure shape as the Farm Plot
// above, generating reserve ammo for the currently equipped gun instead of
// Rations.
const AMMO_PRESS_INTERVAL_MS = 75000
const AMMO_PRESS_AMOUNT = 15
// World-space ping marker - a temporary floating beacon at the custom pin's
// location, visible through walls (depthTest: false) while playing, unlike
// the persistent flat map pin itself (see the map's contextmenu handler)
// which never expires on its own.
const PING_MARKER_DURATION_MS = 60000
// Gamepad support - the core FPS loop only (move/look/fire/reload/
// interact/sprint), not full menu navigation, which still needs mouse/
// keyboard. Left stick -> movement (digital, same on/off flags WASD
// already sets), right stick -> camera look (mirrors PointerLockControls'
// own onMouseMove exactly, since this.camera IS controls.object).
const GAMEPAD_DEADZONE = 0.2
const GAMEPAD_LOOK_SENSITIVITY = 2.5
const GAMEPAD_TRIGGER_THRESHOLD = 0.3
const HAZARD_EMP_BATTERY_DRAIN_PER_SEC = 30
const VEHICLE_RAM_MIN_SPEED = 4
const VEHICLE_RAM_RADIUS = 2.6
const VEHICLE_RAM_DAMAGE = 70
const VEHICLE_RAM_COOLDOWN_MS = 500
// Vehicle Health takes a little wear per zombie actually run over, on top
// of whatever crash damage the wall-collision path (see Vehicle._crash)
// already deals - small enough that ramming stays worth it, not a reason
// to avoid zombies entirely.
const VEHICLE_RAM_SELF_DAMAGE = 2
const VEHICLE_MOTORCYCLE_CHANCE = 0.3
const VEHICLE_REFUEL_PER_CAN = 35
const VEHICLE_HORN_DISTRACTION_MS = 6000
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
// Boss Gauntlet mutator (see _onZombieKilled) - broader than BOSS_TIER_IDS
// above on purpose: this needs every type _spawnBoss's own colossus/
// broodmother alternation can produce, not just the epitaph/killcam subset.
const BOSS_GAUNTLET_TYPE_IDS = new Set(['colossus', 'broodmother', 'titan'])
// Trophy Wall Nightmare-tier variant (see _updateTrophyWall) - which
// medallions glow the hot red-orange instead of standard gold.
const NIGHTMARE_TIER_ACHIEVEMENT_IDS = new Set(['nightmare_survivor_5', 'nightmare_conqueror', 'completionist'])
// Boss lore epitaphs (see _onZombieKilled's BOSS_TIER_IDS branch) - shown
// once per boss type, ever (see narrativeStats.bossEpitaphsSeen), not once
// per kill - a boss killed for the tenth time doesn't need its epitaph
// re-read every single time.
const BOSS_EPITAPH_KEYS = { colossus: 'bossEpitaphColossus', titan: 'bossEpitaphTitan' }
// Named loot lore blurbs (see _trackWeaponMastery) - a one-line "why this
// gun in particular" appended to the existing mastery toast, keyed by
// weapon id rather than added as a field on WEAPONS itself so this stays a
// pure narrative-layer lookup, not a WeaponSystem.js change.
const WEAPON_MASTERY_LORE_KEYS = {
  melee: 'masteryLoreMelee',
  rifle: 'masteryLoreRifle',
  pistol: 'masteryLorePistol',
  minigun: 'masteryLoreMinigun',
  shotgun: 'masteryLoreShotgun',
  awp: 'masteryLoreAwp',
  glock18: 'masteryLoreGlock18',
  flamethrower: 'masteryLoreFlamethrower',
  rocket: 'masteryLoreRocket',
  crossbow: 'masteryLoreCrossbow',
  launcher: 'masteryLoreLauncher',
  suppressedsmg: 'masteryLoreSuppressedsmg',
  nailgun: 'masteryLoreNailgun',
  harpoon: 'masteryLoreHarpoon',
}
const WHEEL_RADIUS = 110
const WHEEL_DEADZONE = 18
const RESCUE_INTERACT_RADIUS = 2.5
const RESCUE_POINTS_REWARD = 25
// Survivor Camp Liberation (see _spawnSurvivorCamp/_updateSurvivorCamp) -
// unlike the single passive rescueSurvivor above, this has a real fail
// state: a small group of vulnerable Companion NPCs under active zombie
// pressure at a location, resolved after CAMP_EVENT_DURATION_MS by however
// many are still alive at that point.
const CAMP_SURVIVOR_COUNT = 3
const CAMP_ATTACK_ZOMBIE_COUNT = 6
const CAMP_EVENT_DURATION_MS = 60000
const CAMP_LOOT_REWARD_POINTS = 500
// Escort Convoy - unlike the camp above (stationary, timer-resolved), these
// survivors use Companion's own follow-the-player AI (see
// _updateEscortConvoy) and the mission resolves by proximity to the safe
// zone instead of a clock, so actually leading them home matters.
const ESCORT_SURVIVOR_COUNT = 2
const ESCORT_ARRIVAL_RADIUS = 12
const ESCORT_REWARD_POINTS = 600
// How close a kill needs to land to a named location to count toward the
// 'clear_location' bounty - generous enough to cover a whole building's
// footprint, not just its exact center point.
const CLEAR_LOCATION_RADIUS = 40
const RECRUIT_INTERACT_RADIUS = 2.5
// Informant NPC - a fixed safe-zone fixture (unlike Rescue Survivors/Recruit
// Spots, which roam/appear at scattered world locations), so it just needs
// one static interact radius rather than a per-spot array.
const INFORMANT_INTERACT_RADIUS = 2.5
const INFORMANT_COST = 60
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
  { id: 'shield', cost: 30, titleKey: 'shopShield', give: (game) => game.inventory.addShield(1) },
  { id: 'knife', cost: 18, titleKey: 'shopKnife', give: (game) => game.inventory.addThrowingKnife(1) },
  { id: 'turretkit', cost: 120, titleKey: 'shopTurretKit', give: (game) => game.inventory.addTurretKit(1) },
  { id: 'alarmkit', cost: 25, titleKey: 'shopAlarmKit', give: (game) => game.inventory.addAlarmKit(1) },
  { id: 'ration', cost: 12, titleKey: 'shopRation', give: (game) => game.inventory.addRation(1) },
  { id: 'water', cost: 10, titleKey: 'shopWater', give: (game) => game.inventory.addWaterBottle(1) },
  {
    id: 'train_companion',
    cost: 30,
    titleKey: 'shopTrainCompanion',
    give: (game) => {
      game.companionTrainingLevel += 1
      game.companion.applyTraining(game.companionTrainingLevel + game.companionLegacy.level)
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
  { id: 'shield', invKey: 'shields', titleKey: 'shopShield', sellValue: salvageValue('shield'), sell: (game) => game.inventory.useShield() },
  { id: 'knife', invKey: 'throwingKnives', titleKey: 'shopKnife', sellValue: salvageValue('knife'), sell: (game) => game.inventory.useThrowingKnife() },
  { id: 'turretkit', invKey: 'turretKits', titleKey: 'shopTurretKit', sellValue: salvageValue('turretkit'), sell: (game) => game.inventory.useTurretKit() },
  { id: 'alarmkit', invKey: 'alarmKits', titleKey: 'shopAlarmKit', sellValue: salvageValue('alarmkit'), sell: (game) => game.inventory.useAlarmKit() },
  { id: 'ration', invKey: 'rations', titleKey: 'shopRation', sellValue: salvageValue('ration'), sell: (game) => game.inventory.useRation() },
  { id: 'water', invKey: 'waterBottles', titleKey: 'shopWater', sellValue: salvageValue('water'), sell: (game) => game.inventory.useWaterBottle() },
]

// Crafting - an alternative path to specific consumables that doesn't cost
// points at all, just other consumables already sitting in inventory.
// Shown/hidden per-recipe the same way SALVAGE_ITEMS above is (only once
// you actually have the ingredients), rather than always listing every
// recipe including ones you can't currently afford.
const CRAFTING_RECIPES = [
  {
    id: 'craft_molotov',
    titleKey: 'craftMolotov',
    ingredients: [{ invKey: 'fuelCans', count: 2 }, { invKey: 'noisemakers', count: 1 }],
    craft: (game) => {
      game.inventory.fuelCans -= 2
      game.inventory.noisemakers -= 1
      game.inventory.addMolotov(1)
    },
  },
  {
    id: 'craft_emp',
    titleKey: 'craftEmp',
    ingredients: [{ invKey: 'grenades', count: 2 }],
    craft: (game) => {
      game.inventory.grenades -= 2
      game.inventory.addEmp(1)
    },
  },
  {
    id: 'craft_c4',
    titleKey: 'craftC4',
    ingredients: [{ invKey: 'molotovs', count: 1 }, { invKey: 'grenades', count: 1 }],
    craft: (game) => {
      game.inventory.molotovs -= 1
      game.inventory.grenades -= 1
      game.inventory.addC4(1)
    },
  },
  {
    id: 'craft_shield',
    titleKey: 'craftShield',
    ingredients: [{ invKey: 'barricades', count: 2 }, { invKey: 'traps', count: 1 }],
    craft: (game) => {
      game.inventory.barricades -= 2
      game.inventory.traps -= 1
      game.inventory.addShield(1)
    },
  },
  {
    id: 'craft_ration',
    titleKey: 'craftRation',
    ingredients: [{ invKey: 'fuelCans', count: 1 }, { invKey: 'adrenaline', count: 1 }],
    craft: (game) => {
      game.inventory.fuelCans -= 1
      game.inventory.adrenaline -= 1
      game.inventory.addRation(2)
    },
  },
  {
    id: 'craft_healthpack',
    titleKey: 'craftHealthpack',
    ingredients: [{ invKey: 'rations', count: 2 }, { invKey: 'adrenaline', count: 1 }],
    craft: (game) => {
      game.inventory.rations -= 2
      game.inventory.adrenaline -= 1
      game.inventory.addHealthPack(1)
    },
  },
  {
    id: 'craft_turretkit',
    titleKey: 'craftTurretkit',
    ingredients: [{ invKey: 'barricades', count: 3 }, { invKey: 'alarmKits', count: 1 }],
    craft: (game) => {
      game.inventory.barricades -= 3
      game.inventory.alarmKits -= 1
      game.inventory.addTurretKit(1)
    },
  },
]

// Trader Requests - a real 2-stage side quest, distinct in kind from
// Bounties (which are pure kill-count challenges): stage 1 is an inventory
// turn-in, stage 2 is a kill count, so there's an actual fetch step before
// the combat step. See _assignTraderQuest/_renderQuestLine/
// _checkTraderQuestKill.
const TRADER_QUESTS = [
  { id: 'fuel_run', titleKey: 'questFuelRun', fetchInvKey: 'fuelCans', fetchCount: 3, fetchLabelKey: 'shopFuelCan', killCount: 8, rewardPoints: 250, rewardCoins: 80 },
  { id: 'grenade_cache', titleKey: 'questGrenadeCache', fetchInvKey: 'grenades', fetchCount: 2, fetchLabelKey: 'shopGrenade', killCount: 12, rewardPoints: 300, rewardCoins: 100 },
  { id: 'medical_supply', titleKey: 'questMedicalSupply', fetchInvKey: 'healthPacks', fetchCount: 2, fetchLabelKey: 'shopHealthPack', killCount: 10, rewardPoints: 275, rewardCoins: 90 },
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
    // Real-time FPS readout - every prior perf fix this session was code-level
    // reasoning + Playwright correctness checks, never an actual measured
    // frame rate (headless Chromium can't reliably report one for this game -
    // see CLAUDE.md). This puts a real number in front of whoever's actually
    // playing, on their actual hardware, instead of guessing blind. Always on
    // (not gated behind a debug flag) since there's no working alternative to
    // ask "is it actually still slow, and where."
    this.fpsEl = document.createElement('div')
    this.fpsEl.id = 'fps-counter'
    this.fpsEl.style.cssText = 'position:fixed;top:6px;left:6px;background:rgba(0,0,0,0.55);color:#7fd88f;font:13px monospace;padding:3px 7px;border-radius:4px;z-index:9999;pointer-events:none;'
    this.fpsEl.textContent = '-- fps'
    document.body.appendChild(this.fpsEl)
    this._fpsFrameCount = 0
    this._fpsLastUpdate = performance.now()

    // Same idea as the fps counter - a real, always-visible number instead
    // of guessing where a bug report is happening from a screenshot's
    // background scenery/compass (which shows facing-direction landmarks,
    // not necessarily nearby ones, so it can't reliably localize a report).
    this.coordsEl = document.createElement('div')
    this.coordsEl.id = 'coords-readout'
    this.coordsEl.style.cssText = 'position:fixed;top:28px;left:6px;background:rgba(0,0,0,0.55);color:#8fc8ff;font:13px monospace;padding:3px 7px;border-radius:4px;z-index:9999;pointer-events:none;'
    this.coordsEl.textContent = 'x:0 z:0 y:0'
    document.body.appendChild(this.coordsEl)
    // Auto-enable Performance Mode on genuinely bad, sustained frame rate
    // instead of leaving it as a settings checkbox someone has to already
    // know exists - a user reporting single-digit fps shouldn't need to
    // dig through a menu first. Requires several consecutive bad 500ms
    // samples (not just one dip - a single stutter shouldn't flip this)
    // and only fires once per session.
    this._lowFpsStreak = 0
    this._autoPerfModeTriggered = false
    // Dynamic resolution scaling - the same trick real FPS games use to
    // hold 60fps: instead of a one-time quality switch, continuously nudge
    // actual render resolution down when frames are running slow and back
    // up when there's headroom, every ~500ms (same window as the fps
    // counter above). Multiplies whatever the "normal" pixel ratio would
    // be (see _applyRenderScale) rather than replacing it outright, so it
    // still respects Performance Mode's own lower baseline when that's on.
    // Drops fast (one bad sample) but climbs back slowly (avoids visibly
    // flickering between resolutions every time fps hovers near the line).
    this._dynResScale = 1
    // Real fix for "make it stable at 60fps" - unlike resolution (proven
    // this session not to matter), simultaneous zombie count IS a real,
    // confirmed cost (each one runs its own AI/collision/animation work
    // every frame). This continuously caps how many can be alive at once
    // based on ACTUAL measured fps, tightening fast on a bad sample and
    // loosening slowly once there's real headroom - same shape as the
    // dynamic resolution scaler, just aimed at the thing that actually
    // costs something instead of the thing that turned out not to.
    // Starts at ZombieManager's own ROUND_MAX_SPAWN_COUNT ceiling (20
    // under LOW_QUALITY_MODE, 50 otherwise) - effectively uncapped for
    // any normal scenario, so difficulty/round scaling alone decides
    // zombie count until fps actually says otherwise.
    this._zombiePopulationCap = LOW_QUALITY_MODE ? 20 : 50

    this.playBtn = document.getElementById('play-btn')
    this.crosshair = document.getElementById('crosshair')
    this.damageNumbersEl = document.getElementById('damage-numbers')
    this.threatIndicator = document.getElementById('threat-indicator')
    this._activeDamageNumbers = 0
    this._damageNumberVec = new THREE.Vector3()
    this.hudEl = document.getElementById('hud')
    this.hotbarEl = document.getElementById('hotbar')
    this.hotbarSlotEls = Array.from(this.hotbarEl.querySelectorAll('.hotbar-slot'))
    // _updateHotbarHud runs every frame - resolve each slot's name element
    // once here instead of a fresh querySelector per slot per frame (the
    // DOM structure itself never changes after this point).
    this.hotbarNameEls = this.hotbarSlotEls.map((el) => el.querySelector('.hotbar-slot-name'))
    this.statusHud = document.getElementById('status-hud')
    this.healthFill = document.getElementById('health-fill')
    this.healthValue = document.getElementById('health-value')
    this.armorFill = document.getElementById('armor-fill')
    this.armorValue = document.getElementById('armor-value')
    this.damageFlash = document.getElementById('damage-flash')
    this.criticalBloodOverlay = document.getElementById('critical-blood-overlay')
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
    this.shieldCount = document.getElementById('shield-count')
    this.knifeCount = document.getElementById('knife-count')
    this.turretkitCount = document.getElementById('turretkit-count')
    this.alarmkitCount = document.getElementById('alarmkit-count')
    this.rationCount = document.getElementById('ration-count')
    this.inventoryPanel = document.getElementById('inventory-panel')
    this.hideEmptyInventoryToggle = document.getElementById('hide-empty-inventory-toggle')
    this.hideEmptyInventoryToggle.addEventListener('change', () => {
      this.hideEmptyInventory = this.hideEmptyInventoryToggle.checked
      this._refreshInventoryPanel()
    })
    // Session-only (not persisted to settings) - a lightweight convenience
    // toggle for a long inventory list, not a durable preference worth its
    // own load/save plumbing.
    this.hideEmptyInventory = false
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
    this.panelShieldCount = document.getElementById('panel-shield-count')
    this.panelKnifeCount = document.getElementById('panel-knife-count')
    this.panelTurretkitCount = document.getElementById('panel-turretkit-count')
    this.panelAlarmkitCount = document.getElementById('panel-alarmkit-count')
    this.panelRationCount = document.getElementById('panel-ration-count')
    this.panelWaterCount = document.getElementById('panel-water-count')
    this.panelWeaponsList = document.getElementById('panel-weapons-list')
    this.panelLoadoutPresets = document.getElementById('panel-loadout-presets')
    // Delegated once (not re-bound on every _refreshInventoryPanel render,
    // since that rebuilds the row HTML from scratch) - reads which weapon/
    // slot the clicked button belongs to off its own data attributes.
    this.panelWeaponsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.hotbar-assign-btn')
      if (!btn || btn.disabled) return
      this._assignHotbarSlot(Number(btn.dataset.slot), btn.dataset.weapon)
    })
    this.panelLoadoutPresets.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('.loadout-save-btn')
      const loadBtn = e.target.closest('.loadout-load-btn')
      if (saveBtn) this._saveHotbarPreset(Number(saveBtn.dataset.slot))
      else if (loadBtn && !loadBtn.disabled) this._loadHotbarPreset(Number(loadBtn.dataset.slot))
    })
    this.inventoryOpen = false
    this.staminaFill = document.getElementById('stamina-fill')
    this.batteryFill = document.getElementById('battery-fill')
    this.staminaValue = document.getElementById('stamina-value')
    this.hungerFill = document.getElementById('hunger-fill')
    this.hungerValue = document.getElementById('hunger-value')
    this.thirstFill = document.getElementById('thirst-fill')
    this.thirstValue = document.getElementById('thirst-value')
    this.warmthFill = document.getElementById('warmth-fill')
    this.warmthValue = document.getElementById('warmth-value')
    this.hunger = 100
    this.maxHunger = 100
    this.thirst = 100
    this.maxThirst = 100
    this.warmth = 100
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
    this.deathSummary = document.getElementById('death-summary')
    this.deathGrade = document.getElementById('death-grade')
    this.deathHighlights = document.getElementById('death-highlights')
    this.deathLegacyPoints = document.getElementById('death-legacy-points')
    this.deathScoreAttack = document.getElementById('death-score-attack')
    this.deathEndless = document.getElementById('death-endless')
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
    this.snowOverlayEl = document.getElementById('snow-overlay')
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
    this.menuCareerRank = document.getElementById('menu-career-rank')
    this.menuPrestigeBadge = document.getElementById('menu-prestige-badge')
    this.menuNewsTicker = document.getElementById('menu-news-ticker')
    this.weeklyFeaturedMutatorLine = document.getElementById('weekly-featured-mutator-line')
    this.menuLeaderboard = document.getElementById('menu-leaderboard')
    this.menuBossRushLeaderboard = document.getElementById('menu-bossrush-leaderboard')
    this.menuHardcoreMemorial = document.getElementById('menu-hardcore-memorial')
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
    this.hudScaleSlider = document.getElementById('hud-scale-slider')
    this.hudScaleValue = document.getElementById('hud-scale-value')
    this.hudOpacitySlider = document.getElementById('hud-opacity-slider')
    this.hudOpacityValue = document.getElementById('hud-opacity-value')
    this.colorblindToggle = document.getElementById('colorblind-toggle')
    this.performanceToggle = document.getElementById('performance-toggle')
    this.shakeIntensitySlider = document.getElementById('shake-intensity-slider')
    this.shakeIntensityValue = document.getElementById('shake-intensity-value')
    this.reduceFlashingToggle = document.getElementById('reduce-flashing-toggle')
    this.toggleSprintToggle = document.getElementById('toggle-sprint-toggle')
    this.toggleCrouchToggle = document.getElementById('toggle-crouch-toggle')
    this.toggleAdsToggle = document.getElementById('toggle-ads-toggle')
    this.aimAssistToggle = document.getElementById('aim-assist-toggle')
    this.bigInteractPromptToggle = document.getElementById('big-interact-prompt-toggle')
    this.toastDurationSlider = document.getElementById('toast-duration-slider')
    this.toastDurationValue = document.getElementById('toast-duration-value')
    this.crosshairColorPicker = document.getElementById('crosshair-color-picker')
    this.crosshairSizeSlider = document.getElementById('crosshair-size-slider')
    this.crosshairSizeValue = document.getElementById('crosshair-size-value')
    this.nicknameInput = document.getElementById('nickname-input')
    this.companionNameInput = document.getElementById('companion-name-input')
    this.scoreAttackToggle = document.getElementById('score-attack-toggle')
    this.hardcoreToggle = document.getElementById('hardcore-toggle')
    this.endlessToggle = document.getElementById('endless-toggle')
    this.mutatorHordeRush = document.getElementById('mutator-horde-rush')
    this.mutatorLootRush = document.getElementById('mutator-loot-rush')
    this.mutatorPureGunplay = document.getElementById('mutator-pure-gunplay')
    this.mutatorBossRush = document.getElementById('mutator-boss-rush')
    this.mutatorHordeMode = document.getElementById('mutator-horde-mode')
    this.mutatorKoth = document.getElementById('mutator-koth')
    this.mutatorExtraction = document.getElementById('mutator-extraction')
    this.mutatorDaily = document.getElementById('mutator-daily')
    this.mutatorHealthRegen = document.getElementById('mutator-health-regen')
    this.mutatorIronMode = document.getElementById('mutator-iron-mode')
    this.mutatorScavenger = document.getElementById('mutator-scavenger')
    this.mutatorGlassHouse = document.getElementById('mutator-glass-house')
    this.mutatorFeaturedEnemy = document.getElementById('mutator-featured-enemy')
    this.mutatorBlackout = document.getElementById('mutator-blackout')
    this.mutatorBossGauntlet = document.getElementById('mutator-boss-gauntlet')
    this.controlsGrid = document.getElementById('controls-grid')
    this.resetBindsBtn = document.getElementById('reset-binds-btn')
    this.rebindingAction = null
    this.settingsOpen = false
    this.settings = loadSettings()
    setLanguage(this.settings.language)
    this.difficulty = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal
    this.nightDurationMs = this.settings.scoreAttackMode ? SCORE_ATTACK_NIGHT_DURATION_MS : NIGHT_DURATION_MS
    this.scoreAttackBest = loadScoreAttackBest()
    this.endlessBest = loadEndlessBest()
    this.endlessMilestoneClaimed = loadEndlessMilestone()
    this.endingSeen = loadEndingSeen()
    this.bestStats = loadBestStats()
    this.careerStats = loadCareerStats()
    this.companionLegacy = loadCompanionLegacy()
    this.narrativeStats = loadNarrativeStats()
    this.loginStreak = loadLoginStreak()
    this.leaderboard = loadLeaderboard()
    this.bossRushLeaderboard = loadBossRushLeaderboard()
    this.hardcoreMemorial = loadHardcoreMemorial()
    this.dailyBest = loadDailyBest()
    this.dailyChallengeActive = false
    this.dailyDamageMult = 1
    this.dailyTwist = null

    this.night = 1
    this.kills = 0
    this.killStreak = 0
    // Records screen (see bestStats.bestKillStreak) - killStreak itself
    // resets to 0 on any hit taken, so this separately tracks the highest
    // it ever reached this run, checked against the persisted best at death.
    this.peakKillStreakThisRun = 0
    this.killstreakDamageBoostUntil = 0
    this.killstreakAmmoUntil = 0
    this.shieldActive = false
    this.upgradeMachineUsesThisNight = 0
    // Deployable turrets (see _deployTurret) - separate from this.turret
    // above (the single permanent Coin Shop base-defense fixture at the
    // safe zone), these are player-placed anywhere, consumed from
    // inventory.turretKits, capped at MAX_DEPLOYED_TURRETS alive at once.
    this.deployedTurrets = []
    this.doublePointsUntil = 0
    this.instakillUntil = 0
    this.cleaningKitUntil = 0
    this.lastStandUsed = false
    this.playerDowned = false
    this.downedKillsNeeded = 0
    this.downedUntil = 0
    this._preDownedMoveSpeed = null
    this.totalKills = 0
    this.totalDeaths = 0
    // Director AI signals - see _updateDirectorAI. lastHitTakenAt starts at
    // "now" rather than 0 so a fresh run doesn't read as "25+ seconds since
    // last hit" (i.e. immediately eligible to ramp up) before the player
    // has even taken a first step.
    this.lastHitTakenAt = performance.now()
    this.recentKillTimestamps = []
    this.recentKillSpots = []
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
    // Landing camera dip (see _updateLandingDip) - a deliberate one-shot
    // downward snap-then-recover on hard falls, distinct from _shakeOffset's
    // random noise above.
    this._landingDipY = 0
    this._lastSeenLandingSeq = 0
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
    // Antialias can only be set at renderer creation (not toggled live), so
    // this respects whatever Performance Mode was saved from last session -
    // toggling the checkbox mid-game still updates everything else in
    // _applyPerformanceMode below, just not this specific setting until the
    // next reload. Forced off unconditionally under LOW_QUALITY_MODE
    // (bare-bones mode), regardless of the separate Performance Mode
    // setting - a real, free GPU cost cut (no multi-sample resolve pass).
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !LOW_QUALITY_MODE && !this.settings.performanceMode })
    this.renderer.setPixelRatio(this._basePixelRatio())
    // Shadows off entirely under LOW_QUALITY_MODE - a big chunk of both
    // remaining visual complexity (soft shadow edges) and render cost
    // (a full extra depth pass every frame). Performance Mode's own
    // toggle still layers on top of this if a player enables it manually.
    this.renderer.shadowMap.enabled = !LOW_QUALITY_MODE
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Cinematic contrast/rolloff instead of the flat default - the single
    // biggest free visual-quality win available (no extra render cost).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    // Weapon viewmodel (and every other metalness-tuned surface) env-map
    // reflections - a scene-wide `scene.environment` is the only way PBR
    // materials pick up reflections at all, so this is inherently global
    // rather than something scopable to just the viewmodel; skipped
    // entirely under LOW_QUALITY_MODE, same as shadows/AA above, since a
    // PMREM generation pass is a real one-time cost this game didn't
    // previously pay. Built from a small procedural gradient scene rather
    // than loading an external HDRI, so this needs no new asset.
    if (!LOW_QUALITY_MODE) {
      const pmremGen = new THREE.PMREMGenerator(this.renderer)
      const envScene = new THREE.Scene()
      const envGeo = new THREE.SphereGeometry(20, 16, 16)
      const envMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })
      const colors = []
      const posAttr = envGeo.getAttribute('position')
      for (let i = 0; i < posAttr.count; i++) {
        const y = posAttr.getY(i) / 20
        const t = THREE.MathUtils.clamp(y * 0.5 + 0.5, 0, 1)
        const c = new THREE.Color().lerpColors(new THREE.Color(0x1a1c22), new THREE.Color(0x8a95a8), t)
        colors.push(c.r, c.g, c.b)
      }
      envGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      envScene.add(new THREE.Mesh(envGeo, envMat))
      this.scene = new THREE.Scene()
      this.scene.environment = pmremGen.fromScene(envScene, 0.04).texture
      pmremGen.dispose()
    } else {
      this.scene = new THREE.Scene()
    }
    // Far plane matched to WORLD_CULL_DISTANCE (+ a small margin) instead of
    // a much larger 200 - fog already makes anything past ~140 units
    // invisible, so the old 200 far plane meant the GPU was still rendering
    // a 150-200 unit-deep shell of geometry the player could never actually
    // see. This lets normal camera frustum culling (free, automatic, no
    // custom system needed) exclude that band entirely.
    const CAMERA_FAR = WORLD_CULL_DISTANCE + 5
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR)
    // Performance Mode shrinks this (see _applyPerformanceMode) so weak
    // hardware renders/lights/shadows a meaningfully smaller radius around
    // the player instead of just losing shadows/bloom - those two alone
    // don't help much if the GPU's real bottleneck is fill rate or draw
    // count from far-away geometry.
    this._perfDistanceMult = 1

    // Third-person view: this.camera stays the actual PointerLockControls
    // target (everything in the codebase reads its position as "the
    // player"), so a second, separate camera renders from an offset behind
    // it instead - see _updateThirdPerson. Not added to the scene graph;
    // its transform is copied fresh every frame.
    this.thirdPerson = false
    this.tpCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, CAMERA_FAR)
    this._tpOffsetLocal = new THREE.Vector3(0, 1.1, 3.0)
    this._tpDesiredPos = new THREE.Vector3()
    this._tpYawQuat = new THREE.Quaternion()
    this._tpRayDir = new THREE.Vector3()
    this._tpRaycaster = new THREE.Raycaster()
    this._traderRaycaster = new THREE.Raycaster()
    this._indoorRaycaster = new THREE.Raycaster(undefined, new THREE.Vector3(0, 1, 0), 0, INDOOR_RAY_MAX_DIST)
    this.isIndoors = false
    this.nextIndoorCheckAt = 0
    this.footstepTimer = 0

    // Post-processing: render pass -> bloom (makes practical lights - street
    // lamps, muzzle flash, headlights, neon signage - actually glow instead
    // of just being bright flat shapes) -> output pass (applies the tone
    // mapping/color space conversion above, required as the final pass when
    // using a composer instead of the renderer's direct render() call).
    this.composer = new EffectComposer(this.renderer)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    // Bloom's own internal buffer runs at half the screen's resolution -
    // it's an inherently soft/blurred effect (several downsample+blur
    // passes), so the quarter-the-pixel-count savings from halving both
    // dimensions costs essentially no visible quality, unlike halving the
    // main render resolution would.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth * BLOOM_RESOLUTION_SCALE, window.innerHeight * BLOOM_RESOLUTION_SCALE), 0.55, 0.4, 0.82)
    // Glow/bloom is a whole extra set of blur passes every frame for a
    // purely cosmetic effect - off by default under LOW_QUALITY_MODE.
    this.bloomPass.enabled = !LOW_QUALITY_MODE
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())

    const { colliders, solidMeshes, flickerLights, spawnPoints, hemiLight, sunLight, towerChestSpots, minigunSpot, generator, trader, ammoStation, upgradeMachine, mysteryBox, vireoFacility, undergroundStation, subwayEntrance, safeZone, practiceTargets, trophyWall, cullables, supermarket, groceryStore, hospital, pharmacy, hardwareStore, gunShop, policeStation, militaryCheckpoint, prison, university, skyscraper, megaMall, warehouse, gasStation, bank, diner, radioStation, fireStation, motel, newUndergroundEntrance, maintenanceTunnel, toxicSewerLevel, mineLevel } = buildWorld(this.scene, ACHIEVEMENTS.length)
    // Base fog distance, captured once - see _applyFogState. Rain/fog-patch
    // used to *= an already-modified fog.near/far every single frame they
    // were active, which compounds toward zero exponentially (0.6 per frame
    // at 60fps collapses to a hundredth of the original within half a
    // second) and NEVER recovers, since nothing ever restored the original
    // value - explains persistent, worsening "can't see anything" reports
    // that outlast the actual rain/fog-patch event, sometimes for the rest
    // of the session. Recomputing fresh from these base values every frame
    // instead fixes that permanently.
    this._baseFogNear = this.scene.fog.near
    this._baseFogFar = this.scene.fog.far
    this.cullables = cullables
    // See _updateCulling: any cullable that's a Group (not a bare Mesh)
    // used to get a fresh recursive .traverse() every single frame just to
    // propagate its castShadow flag to its mesh children. These hierarchies
    // never change shape after construction, so the mesh list is resolved
    // once (lazily, on first cull pass) and reused from then on.
    this._cullShadowMeshCache = new WeakMap()
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

    // Stage 11 - Level -2 sewers (toxic water + slippery walkway).
    this.toxicSewerLevel = toxicSewerLevel
    this.nextToxicTickAt = 0

    // Stage 12 - Level -3 mines (rockfall + unstable beams).
    this.mineLevel = mineLevel
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
    // Full map + fast travel destination list - every named location on the
    // map, including the "fill the empty map" rounds (World.js's
    // buildFillerLocation calls) that never got their own compass markers
    // above (49 locations on a compass strip would be unreadable clutter -
    // this list is only ever consumed by the full map screen, which has
    // room to show all of them as dots). Coordinates match World.js's own
    // buildWorld() call sites exactly (hand-copied, not returned from
    // buildWorld() - none of these bare buildFillerLocation() calls capture
    // a return value there).
    this.allLocationLandmarks = [
      ...this.newLocationLandmarks,
      { label: 'Library', x: 320, z: 160 },
      { label: 'Church', x: 330, z: 70 },
      { label: 'School', x: -320, z: 150 },
      { label: 'Theater', x: 280, z: 260 },
      { label: 'Gym', x: -280, z: 260 },
      { label: 'Laundromat', x: 65, z: -95 },
      { label: 'Post Office', x: -65, z: -95 },
      { label: 'Burger Joint', x: 320, z: -75 },
      { label: 'Electronics', x: -320, z: -60 },
      { label: 'Clothing', x: -320, z: 260 },
      { label: 'Barber Shop', x: 320, z: -150 },
      { label: 'Auto Repair', x: -320, z: -150 },
      { label: 'Farmers Market', x: 200, z: 300 },
      { label: 'Strip Mall', x: -200, z: 300 },
      { label: 'Bowling', x: 200, z: -280 },
      { label: 'Cemetery', x: -200, z: -280 },
      { label: 'Trailer Park', x: 0, z: 300 },
      { label: 'Junkyard', x: 0, z: -300 },
      { label: 'Substation', x: 100, z: 260 },
      { label: 'Outpost', x: -100, z: 260 },
      { label: 'Zoo', x: 160, z: 220 },
      { label: 'Carnival', x: -160, z: 220 },
      { label: 'Casino', x: 250, z: 180 },
      { label: 'Nightclub', x: -250, z: 180 },
      { label: 'Marina', x: 160, z: -260 },
      { label: 'Water Plant', x: -160, z: -260 },
      { label: 'Funeral Home', x: -260, z: -260 },
      { label: 'News Station', x: 250, z: -260 },
      { label: 'Truck Stop', x: 0, z: 250 },
      { label: 'Daycare', x: 100, z: -260 },
    ]
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
    this.lockedCells = [policeStation.cellDoor, ...prison.cellDoors, skyscraper.bunkerDoor, gunShop.caseDoor, warehouse.cageDoor, bank.vaultDoor, radioStation.broadcastDoor, fireStation.equipDoor, skyscraper.hiddenComplex.speakeasyDoor]
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
    this.roadPileups = []
    this.destructibleWalls = []
    this.ziplineA = null
    this.ziplineB = null
    this.nearZiplineEnd = null

    this.kothActive = false
    this.kothZone = { x: KOTH_SPOTS[0].x, z: KOTH_SPOTS[0].z }
    this.kothProgress = 0
    const kothMarkerMat = flatMaterial({
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
    const extractionMarkerMat = flatMaterial({
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
    this.alarms = []
    this._vehicleHitAt = new Map()
    this.flickerLights = flickerLights
    this.minigunSpot = minigunSpot
    this.generator = generator
    this.spawnPoints = spawnPoints
    this.generatorFuel = 100
    this.maxGeneratorFuel = 100
    this.trader = trader
    this.ammoStation = ammoStation
    this.upgradeMachine = upgradeMachine
    this.mysteryBox = mysteryBox
    this.nearAmmoStation = false
    this.ammoStationHoldProgress = 0
    this.ammoStationKeyHeld = false
    this.vireoTerminal = vireoFacility.terminalSpot
    this.subwayEntrance = subwayEntrance
    this.activeBounty = null
    // Trader Request (see TRADER_QUESTS) - a 2-stage side quest distinct
    // from the bounty above. null until _assignTraderQuest is first called
    // (see _openTraderPanel), otherwise { ...questDef, stage: 1, kills: 0 }.
    this.traderQuest = null
    this.nearVireoTerminal = false
    this.vireoGuardian = null
    this.stationTerminal = undergroundStation.terminalSpot
    this.nearStationTerminal = false
    this.stationEncounterCenter = undergroundStation.encounterCenter
    this.stationEncounterTriggered = false
    this.rescueSurvivor = null
    this.nearRescueSurvivor = false
    // Survivor Camp Liberation (see CAMP_SURVIVOR_COUNT's comment) - null
    // when no camp event is active, otherwise { survivors, x, z, startedAt }
    this.survivorCamp = null
    // Escort Convoy - null when no mission is active, otherwise
    // { survivors: Companion[] } (see _spawnEscortConvoy/_updateEscortConvoy)
    this.escortConvoy = null
    // Permanent squad additions (unlike tempCompanion, which leaves at dawn)
    // - one fixed recruit per underground station office, reusing
    // RescueSurvivor's stationary-NPC visual for the marker since it needs
    // no combat/movement behavior until actually recruited.
    // Ground-level spots only (Companion/RescueSurvivor never update their
    // own Y after spawn - confirmed neither class touches position.y in its
    // update loop - so anything placed underground would stay pinned there
    // even after the player and the recruit both walk back to the surface).
    this.recruits = []
    // Squad Formation Toggle (see _toggleSquadHold) - off by default, so
    // the whole squad follows the player exactly like before this existed.
    this.squadHoldPosition = false
    this.squadHoldAnchor = null
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
    this.nearUpgradeMachine = false
    this.nearMysteryBox = false
    this.dayNight = new DayNightCycle(this.scene, hemiLight, sunLight)

    this.player = new PlayerController(this.camera, this.canvas, colliders, solidMeshes)
    this.scene.add(this.player.controls.object)

    this._addFlashlight()

    this.zombies = new ZombieManager(this.scene, this.difficulty.spawnRateMult, colliders, solidMeshes)
    this.zombies.healthMult = this.difficulty.healthMult
    this.zombies.eliteChanceMult = this.difficulty.eliteChanceMult
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
    this.traderGuideNpc = new Companion(this.scene, trader.x + 1.6, trader.z - 1.4, 'vendor', { vulnerable: false })
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
    // Second vehicle type (see Vehicle.js's VEHICLE_STATS) - which one
    // spawns this run is random rather than always the car, so a run can
    // hand you the faster/fragile motorcycle instead of always the sturdier
    // default without needing two simultaneously-drivable vehicles (and
    // everything that would take - a second enter/exit/camera-seat/ramming
    // path) on top of the one this file already has throughout.
    this.vehicle = new Vehicle(this.scene, -6, 22, 0, Math.random() < VEHICLE_MOTORCYCLE_CHANCE ? 'motorcycle' : 'car')
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
    this.pickups.spawnUnique('audiolog6', radioStation.x - 2, radioStation.z + 2, 0.5)
    this.pickups.spawnUnique('audiolog7', warehouse.x + 2, warehouse.z - 2, 0.5)
    this.pickups.spawnUnique('audiolog8', mineLevel.deadEndSpot.x, mineLevel.deadEndSpot.z, mineLevel.floorY + 0.5)
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
      // Was (0, 0.5, -20) - that x,z sits directly above the underground
      // subway junction's unbuilt south side (see World.js's
      // buildSubwayJunctionRoom), a surface-height pickup floating right
      // over a hole in the world with nothing underneath - a player
      // walking through the tunnel below could "find" it (pickup range
      // checks x/z distance only, not y) despite it being 5+ units
      // overhead and physically unreachable from up there. Moved to open
      // street clear of any underground structure.
      { x: 0, y: 0.5, z: -40 },
      { x: 0, y: 0.5, z: 65 },
      { x: vireoFacility.corridorMarkerSpot.x + 1.5, y: vireoFacility.floorY + 0.5, z: vireoFacility.corridorMarkerSpot.z - 2 },
    ]
    this._spawnVaultKey()
    this.audioLogsFound = new Set()
    this.chests = new ChestManager(this.scene, towerChestSpots)
    this.playerState = new PlayerState()
    this.inventory = new Inventory()
    // Shared Stash - auto-withdraw whatever was banked last run into this
    // fresh run's inventory, then clear the bank (see STASH_ITEMS' own
    // doc comment).
    this.stash = loadStash()
    for (const item of STASH_ITEMS) {
      if (this.stash[item.invKey] > 0) {
        this.inventory[item.invKey] += this.stash[item.invKey]
        this.stash[item.invKey] = 0
      }
    }
    saveStash(this.stash)
    this.traderTotalSales = loadTraderSales()
    this.weeklyChallenge = loadWeeklyChallenge()
    this.weeklyDef = WEEKLY_CHALLENGES[_weeklyChallengeIndex(this.weeklyChallenge.week)]
    this.metaProgress = loadMetaProgress()
    this._applyMetaUpgrades()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    if (this.achievements.unlocked.has('true_ending')) {
      document.getElementById('diff-nightmare').style.display = ''
    }
    if (this.achievements.unlocked.has('nightmare_conqueror')) {
      document.getElementById('diff-apex').style.display = ''
    }
    this._updateTrophyWall()
    this.nearTrophyWall = false
    this.killCountsByWeapon = {}
    // Run summary screen (see _renderRunSummary) - generic per-weapon
    // tally for the CURRENT run only, distinct from killCountsByWeapon
    // above (minigun-only, feeds the meat_grinder achievement) and from
    // WeaponMastery's persistent cross-run kills.
    this.killCountsThisRun = {}
    // Biggest Hit / Closest Call (see _renderRunSummary) - lowestHealthThisRun
    // starts at Infinity so the very first _updateHealthHud call always
    // wins the initial comparison.
    this.biggestHitThisRun = 0
    this.lowestHealthThisRun = Infinity
    this.challengeKillCounts = this.shopProgress.challengeKillCounts
    this.weaponChallengesUnlocked = this.shopProgress.weaponChallengesUnlocked
    this.achievementLabel = document.getElementById('achievement-label')
    this.achievementTitle = document.getElementById('achievement-title')
    this.achievementToast = document.getElementById('achievement-toast')
    this.loreToast = document.getElementById('lore-toast')
    this.companionBarkEl = document.getElementById('companion-bark')
    this.lowHealthBarked = false
    this.companionBondTier = 0
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
    this.traderMoodLine = document.getElementById('trader-mood-line')
    this.traderPointsLine = document.getElementById('trader-points-line')
    this.bountyLineEl = document.getElementById('bounty-line')
    this.questLineEl = document.getElementById('quest-line')
    this.weeklyChallengeLineEl = document.getElementById('weekly-challenge-line')
    this.traderOptions = document.getElementById('trader-options')
    this.traderSalvageTitle = document.getElementById('trader-salvage-title')
    this.traderSalvageOptions = document.getElementById('trader-salvage-options')
    this.traderCraftingTitle = document.getElementById('trader-crafting-title')
    this.traderCraftingOptions = document.getElementById('trader-crafting-options')
    this.traderStashTitle = document.getElementById('trader-stash-title')
    this.traderStashOptions = document.getElementById('trader-stash-options')
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
    this.statsRankRow = document.getElementById('stats-rank-row')
    this.statsRank = document.getElementById('stats-rank')
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
    this._gamepadEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    this._gamepadInteractWasDown = false
    this._gamepadReloadWasDown = false
    // Reused every _updateMinimap call instead of a fresh .filter().map()
    // chain (2 throwaway arrays) 60 times a second - same GC-pressure
    // reasoning as ColliderGrid.js's reused query buffers.
    this._minimapZombiePositions = []

    // Stage 14 - fog-of-war full map. Per-run state (resets on a fresh
    // `new Game()`, same as companion gear/shop purchases) rather than
    // persisted - re-exploring the map each run fits this game's other
    // per-run resets better than a permanent meta-unlock would.
    this.discoveredCells = new Set()
    this.rewardedLandmarks = new Set()
    // Zone Danger Warning (see _updateZoneDangerWarning) - one toast per
    // zone id per run, not re-shown every time the player passes back
    // through the same zone.
    this.warnedZones = new Set()
    this.loreMarkersFound = new Set()
    this.mapOpen = false
    this.fullMapPanel = document.getElementById('fullmap-panel')
    this.fullMapCanvas = document.getElementById('fullmap-canvas')
    this.journalPanel = document.getElementById('journal-panel')
    this.journalContent = document.getElementById('journal-content')
    this.journalOpen = false
    this.fullMap = new FullMap(this.fullMapCanvas)
    // Fast travel - click any discovered dot on the full map to warp there
    // instantly and close the map, same "instant, free, no cooldown" feel
    // as the map itself (already freezes gameplay while open). Safe Zone is
    // always a valid target (FullMap.hitTargets[0]); every other landmark
    // only counts once its own map cell has actually been revealed - same
    // discoveredCells gate the map's own rendering already uses, so nothing
    // clickable here was ever invisible a moment ago.
    this.fullMapCanvas.addEventListener('click', (e) => {
      if (!this.mapOpen) return
      const rect = this.fullMapCanvas.getBoundingClientRect()
      const px = (e.clientX - rect.left) * (this.fullMapCanvas.width / rect.width)
      const py = (e.clientY - rect.top) * (this.fullMapCanvas.height / rect.height)
      const cellSize = EXPLORE_CELL_SIZE
      for (const target of this.fullMap.hitTargets) {
        if (target.px === null) continue
        const dx = px - target.px
        const dy = py - target.py
        if (dx * dx + dy * dy > 64) continue // 8px click radius
        const cx = Math.floor(target.x / cellSize)
        const cz = Math.floor(target.z / cellSize)
        if (target.label !== 'Safe Zone' && target.label !== 'Custom Pin' && !this.discoveredCells.has(`${cx},${cz}`)) continue
        this.player.controls.object.position.set(target.x, this.player.eyeHeight, target.z)
        this.player.velocity.set(0, 0, 0)
        this.mapOpen = false
        this.fullMapPanel.style.display = 'none'
        this._showLoreToast(t('fastTraveledTo', { name: target.label }))
        break
      }
    })

    // Custom map pins - right-click anywhere on the map to drop a marker
    // (visible through fog-of-war, see FullMap.render's own note), or
    // right-click near an existing pin to clear it instead of moving it.
    this.customPin = null
    this.pingMarkerMesh = null
    this.pingMarkerExpiresAt = 0
    this.fullMapCanvas.addEventListener('contextmenu', (e) => {
      if (!this.mapOpen) return
      e.preventDefault()
      const rect = this.fullMapCanvas.getBoundingClientRect()
      const px = (e.clientX - rect.left) * (this.fullMapCanvas.width / rect.width)
      const py = (e.clientY - rect.top) * (this.fullMapCanvas.height / rect.height)
      const world = this.fullMap.screenToWorld(px, py)
      if (this.customPin && Math.hypot(world.x - this.customPin.x, world.z - this.customPin.z) < 15) {
        this.customPin = null
        this._removePingMarker()
        this._showLoreToast(t('toastPinCleared'))
      } else {
        this.customPin = { x: world.x, z: world.z }
        this._buildPingMarker(world.x, world.z)
        this._showLoreToast(t('toastPinPlaced'))
      }
      this._renderFullMap()
    })

    // Photo mode: a free-fly noclip camera + hidden HUD for taking clean
    // screenshots, joining the same "gameplay freezes" gating condition as
    // mapOpen/inventoryOpen so nothing moves/spawns while composing a shot.
    this.photoModeOpen = false
    this._photoModeReturnPos = new THREE.Vector3()
    this._photoForward = new THREE.Vector3()
    this._photoRight = new THREE.Vector3()
    this._photoUp = false
    this._photoDown = false
    this._photoBoost = false
    window.addEventListener('keydown', (e) => {
      if (!this.photoModeOpen) return
      if (e.code === 'Space') this._photoUp = true
      else if (e.code === 'ControlLeft' || e.code === 'ControlRight') this._photoDown = true
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._photoBoost = true
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this._photoUp = false
      else if (e.code === 'ControlLeft' || e.code === 'ControlRight') this._photoDown = false
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this._photoBoost = false
    })

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
      () => this._onStealthTakedown(),
      (x, y, z, damage, isHeadshot) => this._spawnDamageNumber(x, y, z, damage, isHeadshot),
      (intensity, durationMs) => {
        this._triggerShake(intensity, durationMs)
        this._alertNearbyZombiesToGunfire()
      }
    )
    this.rivals = new RivalManager(this.scene)
    this.weapons.setRivalManager(this.rivals)
    this._rivalsClaimedAirdrop = false
    // Weapon mastery (see WeaponMastery.js) - re-applies any previously
    // earned masteryMult bonuses to this fresh set of weapon objects, since
    // WeaponSystem's own weapons array is rebuilt from scratch every run.
    this.weaponMastery = loadMastery()
    for (const w of this.weapons.weapons) {
      // Grandmaster replaces mastery's own multiplier rather than stacking
      // with it (see WeaponMastery.js) - checked first so it wins when both
      // are true.
      if (this.weaponMastery.grandmastered.has(w.id)) w.masteryMult = GRANDMASTER_DAMAGE_MULT
      else if (this.weaponMastery.mastered.has(w.id)) w.masteryMult = MASTERY_DAMAGE_MULT
    }
    // Re-apply already-earned per-weapon challenge camos - before
    // equippedSkin below, which (if the player has chosen a global skin)
    // should still win, same "earned reward is the default until you
    // actively choose something else" precedent as Centurion's gold skin.
    for (const weaponId of this.weaponChallengesUnlocked) this.weapons.setWeaponSkin(weaponId, 'veteran')
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
    this.ownedOutfits = this.shopProgress.ownedOutfits
    this.equippedOutfit = this.shopProgress.equippedOutfit
    if (this.equippedOutfit) {
      const item = COIN_SHOP_ITEMS.find((i) => i.outfit === this.equippedOutfit)
      if (item) this.playerBody.setOutfit(item.outfitColor)
    }
    this._applyCoinShopPerks()
    this._applyVeteranPerks()

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
    // Needs both this.zombies (constructed above) and this.loreToast (set
    // earlier in the constructor) to already exist - see the crash this
    // caused when it briefly lived right after this.zombies alone.
    this._rollNightMutation()
    // Needs this.safeZone (set well after the original early _rollWeather
    // call site) - kept here for the same reason as _rollNightMutation above.
    this._applySeasonalDressing()
    this._rollRoadPileups()
    this._maybeSquadBanter()
    this._checkLoginStreak()
    // Built once, not rerolled per-night like the pileups above - a
    // permanent shortcut once broken, not something that resets.
    {
      const wallSpot = this.spawnPoints[Math.min(2, this.spawnPoints.length - 1)]
      this._buildDestructibleWall(wallSpot.x + 4, wallSpot.z)
    }
    this._buildZipline()
    this._buildInformant()
    this._buildLoreMarkers()
    this._buildWetStreetSheen()
    this._buildNightSky()

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

    // Volumetric flashlight beam - a cheap additive-blended cone standing
    // in for real raymarched volumetrics (this project has no post-
    // processing volumetric pass), parented directly to the light so it
    // always points wherever the light points with zero per-frame update
    // cost of its own.
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff4dd,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.flashlightBeam = new THREE.Mesh(new THREE.ConeGeometry(2.6, 12, 20, 1, true), beamMat)
    this.flashlightBeam.rotation.x = Math.PI / 2
    this.flashlightBeam.position.z = -6
    this.flashlight.add(this.flashlightBeam)
  }

  _updateFlashlightBattery(dt) {
    if (this.flashlightOn && this.flashlightBattery > 0) {
      this.flashlightBattery = Math.max(0, this.flashlightBattery - FLASHLIGHT_DRAIN_PER_SEC * dt)
      if (this.flashlightBattery === 0) this.flashlightOn = false
    }
    this.flashlight.visible = this.flashlightOn
    this.flashlightBeam.visible = this.flashlightOn
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
      // Scavenger Run - locks the two normally-free starting guns back down
      // to melee-only; earned back through the Trader/Coin Shop's existing
      // economy same as every other non-starting weapon, not a separate
      // battlefield-loot path.
      if (this.settings.mutators.scavenger) {
        const rifle = this.weapons.weapons.find((w) => w.id === 'rifle')
        const pistol = this.weapons.weapons.find((w) => w.id === 'pistol')
        if (rifle) rifle.unlocked = false
        if (pistol) pistol.unlocked = false
        this.weapons.switchToIndex(this.weapons.weapons.findIndex((w) => w.id === 'melee'))
      }
      // Glass House - symmetric 2x damage both ways, reusing the two
      // multipliers already read at every damage-dealt/damage-taken site
      // rather than adding a third parallel multiplier.
      if (this.settings.mutators.glassHouse) {
        this.weapons.damageMult *= 2
        this.dailyDamageMult *= 2
      }
      // Featured Enemy - see ZombieManager's setFeaturedEnemy/
      // FEATURED_ENEMY_WEIGHT_MULT. Picked from the same ambient pool
      // _spawnRandom already draws from (weight > 0 excludes boss-only
      // entries like colossus, which are never part of the random roll).
      if (this.settings.mutators.featuredEnemy) {
        const candidates = Object.values(ZOMBIE_TYPES).filter((zt) => zt.weight > 0)
        const featured = candidates[Math.floor(Math.random() * candidates.length)]
        this.zombies.setFeaturedEnemy(featured.id)
        this._showLoreToast(t('featuredEnemyToast', { type: featured.label }))
      } else {
        this.zombies.setFeaturedEnemy(null)
      }
      // Blackout - folds into the same weatherDim multiply _tick already
      // applies to dayNight.hemi/sun every frame (see the main tick), so it
      // composes with rain/snow dimming instead of fighting it.
      this.blackoutActive = this.settings.mutators.blackout
      // Weekly Featured Mutator bonus - a nudge, not a requirement: playing
      // with this week's auto-picked mutator on grants a small one-time
      // coin bonus for the run.
      if (this.settings.mutators[_weeklyFeaturedMutatorKey()]) {
        this.coins += WEEKLY_FEATURED_MUTATOR_BONUS_COINS
        this._showLoreToast(t('weeklyFeaturedMutatorBonusToast', { coins: WEEKLY_FEATURED_MUTATOR_BONUS_COINS }))
      }
      this._showLoreToast(t(DIFFICULTY_FLAVOR_KEYS[this.settings.difficulty] || DIFFICULTY_FLAVOR_KEYS.normal))
      this._openTraitDrawPanel()
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
      this.companionBondTier = 0
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
      this.killCountsThisRun = {}
      this.biggestHitThisRun = 0
      this.lowestHealthThisRun = Infinity
      this.killStreak = 0
      this.lastStandUsed = false
      this.playerDowned = false
      this.downedUntil = 0
      for (const t of this.deployedTurrets) t.dispose()
      this.deployedTurrets = []
      this.activeBounty = null
      if (this.rescueSurvivor) {
        this.rescueSurvivor.dispose()
        this.rescueSurvivor = null
      }
      if (this.survivorCamp) {
        for (const s of this.survivorCamp.survivors) s.dispose()
        this.survivorCamp = null
      }
      if (this.escortConvoy) {
        for (const s of this.escortConvoy.survivors) s.dispose()
        this.escortConvoy = null
      }
      this.runStartedAt = performance.now()
      this.nightStartedAt = performance.now()
      this._scheduleNightEvent()
      this._rollWeather()
      this._applySeasonalDressing()
      this._rollRoadPileups()
      this._maybeSquadBanter()
      this._rollNightMutation()
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
        if (this.mapOpen) return // don't let the inventory open on top of the map
        this.inventoryOpen = !this.inventoryOpen
        this.inventoryPanel.style.display = this.inventoryOpen ? 'flex' : 'none'
        if (this.inventoryOpen) this._refreshInventoryPanel()
        return
      }

      if (e.code === getKeyFor('toggleMap')) {
        if (this.inventoryOpen || this.photoModeOpen || this.journalOpen) return // don't let the map open on top of the inventory/photo mode/journal
        this.mapOpen = !this.mapOpen
        this.fullMapPanel.style.display = this.mapOpen ? 'flex' : 'none'
        if (this.mapOpen) {
          // Rendered once here, not every frame - gameplay (and the
          // player's own position) freezes while mapOpen, same as the
          // inventory panel already does, so nothing on the map can
          // change while it's showing.
          this._renderFullMap()
        }
        return
      }

      if (e.code === getKeyFor('journal')) {
        if (this.inventoryOpen || this.mapOpen || this.photoModeOpen) return
        this.journalOpen = !this.journalOpen
        this.journalPanel.style.display = this.journalOpen ? 'flex' : 'none'
        if (this.journalOpen) this._renderJournal()
        return
      }

      if (e.code === getKeyFor('minimapZoom')) {
        const newRange = this.minimap.cycleZoom()
        this._showLoreToast(t('minimapZoomToast', { range: newRange }))
        return
      }

      if (e.code === getKeyFor('squadHold')) {
        this._toggleSquadHold()
        return
      }

      if (e.code === getKeyFor('horn') && this.driving) {
        this._useHorn()
        return
      }

      if (e.code === getKeyFor('photoMode')) {
        if (this.inventoryOpen || this.mapOpen || this.journalOpen) return // don't let photo mode open on top of the inventory/map/journal
        this.photoModeOpen = !this.photoModeOpen
        if (this.photoModeOpen) {
          this._photoModeReturnPos.copy(this.camera.position)
          this._setPhotoModeHudHidden(true)
          this._showLoreToast(t('photoModeOn'))
        } else {
          this._photoUp = false
          this._photoDown = false
          this._photoBoost = false
          this.camera.position.copy(this._photoModeReturnPos)
          this._setPhotoModeHudHidden(false)
          this._showLoreToast(t('photoModeOff'))
        }
        return
      }

      if (this.inventoryOpen || this.mapOpen || this.photoModeOpen || this.journalOpen) return

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
      } else if (e.code === getKeyFor('threatPing')) {
        this._pingNearestThreat()
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
      } else if (e.code === 'Digit6') {
        this._toggleShield()
      } else if (e.code === 'Digit7') {
        this._throwKnife()
      } else if (e.code === 'Digit8') {
        this._deployTurret()
      } else if (e.code === 'Digit9') {
        this._deployAlarm()
      } else if (e.code === 'Digit0') {
        this._eatRation()
      } else if (e.code === getKeyFor('drinkWater')) {
        this._drinkWater()
      } else if (e.code === getKeyFor('interact')) {
        // Tracked independently of the rest of this branch (which only
        // fires the various one-shot interactions below) so the ammo
        // station's hold-to-charge check in _updateAmmoStation knows the
        // key is physically down, for as long as it's held.
        this.ammoStationKeyHeld = true
        this.breakerBoxKeyHeld = true
        if (this.driving) {
          this._exitVehicle()
        } else if (this.nearVehicle && this.vehicle.fuel < this.vehicle.stats.maxFuel && this.inventory.fuelCans > 0) {
          this._refuelVehicle()
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
        } else if (this.nearUpgradeMachine) {
          this._tryUpgradeWeapon()
        } else if (this.nearMysteryBox) {
          this._tryMysteryBox()
        } else if (this.nearZiplineEnd) {
          this._useZipline()
        } else if (this.nearInformant) {
          this._useInformant()
        } else if (this.nearLoreMarker) {
          this._readLoreMarker()
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

  // Hides the whole HUD surface for a clean screenshot - same element set
  // the pointer-unlock handler already hides, plus the debug fps/coords
  // readouts, which have no place in a "photo mode" shot.
  _setPhotoModeHudHidden(hidden) {
    const display = hidden ? 'none' : ''
    this.crosshair.style.display = hidden ? 'none' : 'block'
    this.hudEl.style.display = display
    this.hotbarEl.style.display = display
    this.statusHud.style.display = display
    this.inventoryHud.style.display = display
    this.progressHud.style.display = display
    this.statsPanel.style.display = display
    this.minimapWrap.style.display = display
    this.compassStrip.style.display = display
    this.fpsEl.style.display = hidden ? 'none' : 'block'
    this.coordsEl.style.display = hidden ? 'none' : 'block'
  }

  // Free-fly noclip camera while photo mode is open - reuses the same
  // held-state WASD flags PlayerController already tracks (input tracking
  // itself isn't gated, only its consumption in player.update() is, which
  // is frozen while photoModeOpen), plus dedicated Space/Ctrl for up/down
  // and Shift to move faster. Deliberately ignores collision - the point
  // is to compose a shot from anywhere, including through walls/ceilings.
  _updatePhotoMode(dt) {
    const speed = (this._photoBoost ? 22 : 8) * dt
    this.camera.getWorldDirection(this._photoForward)
    this._photoRight.crossVectors(this._photoForward, this.camera.up).normalize()
    const input = this.player.input
    if (input.forward) this.camera.position.addScaledVector(this._photoForward, speed)
    if (input.back) this.camera.position.addScaledVector(this._photoForward, -speed)
    if (input.right) this.camera.position.addScaledVector(this._photoRight, speed)
    if (input.left) this.camera.position.addScaledVector(this._photoRight, -speed)
    if (this._photoUp) this.camera.position.y += speed
    if (this._photoDown) this.camera.position.y -= speed
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
      if (index !== -1) {
        this.weapons.switchToIndex(index)
        this._updateHotbarHud()
      }
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

  _throwKnife() {
    if (!this.inventory.useThrowingKnife()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 12)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnKnifeThrow(origin, target)
    this._updateInventoryHud()
  }

  // Riot Shield - a toggle (not hold), consuming one charge per activation
  // (see Inventory.useShield) rather than per second held, so putting it up
  // briefly and lowering it again doesn't waste multiple charges.
  _toggleShield() {
    if (this.shieldActive) {
      this.shieldActive = false
      this.weapons.shieldActive = false
      return
    }
    if (!this.inventory.useShield()) {
      this._showLoreToast(t('toastNoShield'))
      return
    }
    this.shieldActive = true
    this.weapons.shieldActive = true
    this._updateInventoryHud()
  }

  // Deployable turret - drops at the player's current feet position,
  // capped at MAX_DEPLOYED_TURRETS alive at once (oldest one is torn down
  // to make room for a new one past the cap, rather than just refusing the
  // deploy, so the key always does something as long as a kit is owned).
  _deployTurret() {
    if (!this.inventory.useTurretKit()) {
      this._showLoreToast(t('toastNoTurretKit'))
      return
    }
    if (this.deployedTurrets.length >= MAX_DEPLOYED_TURRETS) {
      const oldest = this.deployedTurrets.shift()
      oldest.dispose()
    }
    const pos = this.player.controls.object.position
    const turret = new Turret(this.scene, pos.x, pos.z)
    this.deployedTurrets.push(turret)
    this._updateInventoryHud()
    this._showLoreToast(t('toastTurretDeployed'))
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

    const mat = flatMaterial({ color: 0x4a3c2a, roughness: 0.9 })
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
  // Electric Trap - a random variant of the same spike trap item/keybind
  // (see ELECTRIC_TRAP_CHANCE) rather than a whole second inventory item/
  // keybind: stuns instead of damaging, so it reads as a genuinely
  // different tool (crowd control vs. burst damage) without doubling the
  // amount of new plumbing (shop entry, HUD row, keybind) a fully separate
  // item would need.
  _deployTrap() {
    if (!this.inventory.useTrap()) return
    this.camera.getWorldDirection(this._camDir)
    const playerPos = this.player.controls.object.position
    const x = playerPos.x + this._camDir.x * TRAP_PLACE_DIST
    const z = playerPos.z + this._camDir.z * TRAP_PLACE_DIST
    const isElectric = Math.random() < ELECTRIC_TRAP_CHANCE

    const mat = isElectric
      ? flatMaterial({ color: 0x0a1a3a, emissive: 0x4ecfff, emissiveIntensity: 1.1, roughness: 0.5, metalness: 0.3 })
      : flatMaterial({ color: 0x3a0a0a, emissive: 0xff2a1e, emissiveIntensity: 0.9, roughness: 0.6 })
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12), mat)
    mesh.position.set(x, 0.03, z)
    this.scene.add(mesh)

    this.traps.push({ mesh, x, z, type: isElectric ? 'electric' : 'spike', triggered: false, expiresAt: performance.now() + TRAP_LIFETIME_MS })
    this._updateInventoryHud()
  }

  _triggerTrap(trap) {
    trap.triggered = true
    if (trap.type === 'electric') {
      for (const zombie of this.zombies.zombies) {
        if (zombie.state !== 'alive') continue
        const dist = Math.hypot(zombie.group.position.x - trap.x, zombie.group.position.z - trap.z)
        if (dist <= TRAP_BLAST_RADIUS) zombie.stun(ELECTRIC_TRAP_STUN_MS)
      }
      this._triggerShake(0.05, 100)
      return
    }
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

  // Tripwire alarm - an early-warning tool, not a damage trap (see
  // ALARM_TRIGGER_RADIUS's own comment). Same place/trigger/expire shape as
  // _deployTrap/_triggerTrap/_updateTraps above, just with a toast+sound
  // instead of AoE damage.
  _deployAlarm() {
    if (!this.inventory.useAlarmKit()) {
      this._showLoreToast(t('toastNoAlarmKit'))
      return
    }
    this.camera.getWorldDirection(this._camDir)
    const playerPos = this.player.controls.object.position
    const x = playerPos.x + this._camDir.x * ALARM_PLACE_DIST
    const z = playerPos.z + this._camDir.z * ALARM_PLACE_DIST

    const postMat = flatMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.4 })
    const wireMat = flatMaterial({ color: 0xd8cfa0, emissive: 0xd8cfa0, emissiveIntensity: 0.6 })
    const group = new THREE.Group()
    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), postMat)
    post1.position.set(-0.4, 0.25, 0)
    const post2 = post1.clone()
    post2.position.set(0.4, 0.25, 0)
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), wireMat)
    wire.rotation.z = Math.PI / 2
    wire.position.set(0, 0.42, 0)
    group.add(post1, post2, wire)
    group.position.set(x, 0, z)
    this.scene.add(group)

    this.alarms.push({ mesh: group, x, z, triggered: false, expiresAt: performance.now() + ALARM_LIFETIME_MS })
    this._updateInventoryHud()
    this._showLoreToast(t('toastAlarmDeployed'))
  }

  _triggerAlarm(alarm) {
    alarm.triggered = true
    this._showLoreToast(t('toastAlarmTriggered'))
    audioEngine.playNoisemaker()
  }

  _updateAlarms() {
    if (this.alarms.length === 0) return
    const now = performance.now()
    for (const alarm of this.alarms) {
      if (alarm.triggered) continue
      for (const zombie of this.zombies.zombies) {
        if (zombie.state !== 'alive') continue
        const dist = Math.hypot(zombie.group.position.x - alarm.x, zombie.group.position.z - alarm.z)
        if (dist <= ALARM_TRIGGER_RADIUS) {
          this._triggerAlarm(alarm)
          break
        }
      }
    }
    for (const alarm of this.alarms) {
      if (alarm.triggered || now >= alarm.expiresAt) this.scene.remove(alarm.mesh)
    }
    this.alarms = this.alarms.filter((a) => !a.triggered && now < a.expiresAt)
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

    const baseMat = flatMaterial({ color: 0x3a2a24, roughness: 0.95 })
    const chunkMat = flatMaterial({ color: 0x2c211c, roughness: 0.95 })
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

  // Rolled once per night alongside weather/mutation (see their own call
  // sites) - clears last night's wrecks and drops a fresh set at random
  // spawn points, so the roads never look the same two nights running.
  _rollRoadPileups() {
    for (const p of this.roadPileups) {
      this.scene.remove(p.group)
      const ci = this.colliders.indexOf(p.box)
      if (ci !== -1) this.colliders.splice(ci, 1)
      const si = this.solidMeshes.indexOf(p.mesh)
      if (si !== -1) this.solidMeshes.splice(si, 1)
    }
    this.roadPileups = []

    const wreckMat = flatMaterial({ color: 0x3a3632, roughness: 0.8, metalness: 0.3 })
    for (let i = 0; i < ROAD_PILEUP_COUNT; i++) {
      const spot = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
      const x = spot.x + (Math.random() - 0.5) * 6
      const z = spot.z + (Math.random() - 0.5) * 6
      const group = new THREE.Group()
      group.position.set(x, 0, z)
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6), wreckMat)
      body.position.y = 0.35
      body.castShadow = true
      group.add(body)
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.6), wreckMat)
      cabin.position.set(0, 0.95, -0.3)
      cabin.castShadow = true
      group.add(cabin)
      this.scene.add(group)

      // Axis-aligned collider built from known dimensions rather than
      // Box3().setFromObject() on this group - see CLAUDE.md's own
      // rotated-mesh-AABB-inflation note (this group has no rotation, but
      // building it explicitly is free insurance and matches the safer
      // pattern used elsewhere in this codebase).
      const box = new THREE.Box3(
        new THREE.Vector3(x - 0.9, 0, z - 1.8),
        new THREE.Vector3(x + 0.9, 1.2, z + 1.8)
      )
      this.colliders.push(box)
      this.solidMeshes.push(body)
      this.roadPileups.push({ group, mesh: body, box })
    }
  }

  // Built once (not per-night) at a fixed spawnPoint-derived location - a
  // shootable/meleeable wall panel with its own health pool; once broken
  // it stays open for the rest of the session (see _destroyWall).
  _buildDestructibleWall(x, z) {
    const mat = flatMaterial({ color: 0x5a5040, roughness: 0.9 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 0.4), mat)
    mesh.position.set(x, 1.5, z)
    mesh.castShadow = true
    this.scene.add(mesh)

    const box = new THREE.Box3(
      new THREE.Vector3(x - 1.5, 0, z - 0.2),
      new THREE.Vector3(x + 1.5, 3, z + 0.2)
    )
    this.colliders.push(box)
    this.solidMeshes.push(mesh)

    const wall = { health: DESTRUCTIBLE_WALL_HEALTH, destroyed: false, mesh, box }
    wall.onHit = (damage) => {
      if (wall.destroyed) return
      wall.health -= damage
      mat.emissive.setHex(0xff2a1e)
      mat.emissiveIntensity = 0.6
      setTimeout(() => { if (!wall.destroyed) mat.emissiveIntensity = 0 }, 100)
      if (wall.health <= 0) this._destroyWall(wall)
    }
    mesh.userData.destructibleWall = wall
    this.destructibleWalls.push(wall)
  }

  _destroyWall(wall) {
    wall.destroyed = true
    this.scene.remove(wall.mesh)
    const ci = this.colliders.indexOf(wall.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(wall.mesh)
    if (si !== -1) this.solidMeshes.splice(si, 1)
    this._showLoreToast(t('toastWallDestroyed'))
  }

  // Built once at 2 fixed spawnPoint-derived locations - the cable is
  // purely decorative (no collider registered), so its rotated geometry
  // never risks the AABB-inflation gotcha CLAUDE.md warns about for
  // anything that actually needs to block movement.
  _buildZipline() {
    const a = this.spawnPoints[0]
    const b = this.spawnPoints[Math.min(6, this.spawnPoints.length - 1)]
    this.ziplineA = { x: a.x, z: a.z }
    this.ziplineB = { x: b.x, z: b.z }

    const postMat = flatMaterial({ color: 0x2a2a28, roughness: 0.6, metalness: 0.5 })
    const cableMat = flatMaterial({ color: 0x1a1a18, roughness: 0.4, metalness: 0.7 })
    const postA = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 8), postMat)
    postA.position.set(a.x, 2.5, a.z)
    postA.castShadow = true
    this.scene.add(postA)
    const postB = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 8), postMat)
    postB.position.set(b.x, 2.5, b.z)
    postB.castShadow = true
    this.scene.add(postB)

    const dx = b.x - a.x
    const dz = b.z - a.z
    const length = Math.hypot(dx, dz)
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, length, 6), cableMat)
    cable.position.set((a.x + b.x) / 2, 4.9, (a.z + b.z) / 2)
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize())
    this.scene.add(cable)
  }

  _updateZipline(playerPos) {
    if (!this.ziplineA) {
      this.nearZiplineEnd = null
      return
    }
    const distA = Math.hypot(playerPos.x - this.ziplineA.x, playerPos.z - this.ziplineA.z)
    const distB = Math.hypot(playerPos.x - this.ziplineB.x, playerPos.z - this.ziplineB.z)
    if (distA <= ZIPLINE_INTERACT_RADIUS) this.nearZiplineEnd = 'B'
    else if (distB <= ZIPLINE_INTERACT_RADIUS) this.nearZiplineEnd = 'A'
    else this.nearZiplineEnd = null
  }

  _useZipline() {
    if (!this.nearZiplineEnd) return
    const dest = this.nearZiplineEnd === 'B' ? this.ziplineB : this.ziplineA
    this.player.controls.object.position.set(dest.x, this.player.eyeHeight, dest.z)
    this.player.velocity.set(0, 0, 0)
    this.nearZiplineEnd = null
    this._showLoreToast(t('toastZiplineUsed'))
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
    // color/radius/duration per type - was a 3-way ternary chain that
    // silently assumed "anything that isn't gas/toxic_spread is emp"; a
    // lookup reads the same for the 2 original types and scales to the
    // Acid Trail/Webber zombies' zones without that assumption.
    const ZONE_DEFS = {
      gas: { color: 0x5fcf4a, radius: HAZARD_RADIUS, duration: HAZARD_GAS_DURATION_MS },
      emp: { color: 0x4ecfff, radius: HAZARD_RADIUS, duration: HAZARD_EMP_DURATION_MS },
      toxic_spread: { color: 0x6ecf3a, radius: TOXIC_SPREAD_START_RADIUS, duration: TOXIC_SPREAD_DURATION_MS },
      acid: { color: 0x8fd93a, radius: HAZARD_ACID_RADIUS, duration: HAZARD_ACID_DURATION_MS },
      web: { color: 0xe8e4d0, radius: HAZARD_WEB_RADIUS, duration: HAZARD_WEB_DURATION_MS },
    }
    const def = ZONE_DEFS[type]
    const mat = flatMaterial({
      color: def.color,
      emissive: def.color,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radius, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat)
    mesh.position.set(x, 0.05, z)
    this.scene.add(mesh)
    const light = new THREE.PointLight(def.color, 1.4, def.radius * 2.5, 2)
    light.position.set(x, 1.5, z)
    this.scene.add(light)

    this.hazardZones.push({
      type,
      x,
      z,
      mesh,
      light,
      baseRadius: def.radius,
      radius: def.radius,
      expiresAt: performance.now() + def.duration,
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
    let playerInWeb = false
    const TICK_DAMAGE = { gas: HAZARD_GAS_DAMAGE_PER_TICK, toxic_spread: TOXIC_SPREAD_DAMAGE_PER_TICK, acid: HAZARD_ACID_DAMAGE_PER_TICK }

    this.hazardZones = this.hazardZones.filter((zone) => {
      if (now >= zone.expiresAt) {
        this._removeHazardZone(zone)
        return false
      }
      if (zone.type === 'toxic_spread' && zone.radius < TOXIC_SPREAD_MAX_RADIUS) {
        zone.radius = Math.min(TOXIC_SPREAD_MAX_RADIUS, zone.radius + TOXIC_SPREAD_GROWTH_PER_SEC * dt)
        const growthScale = zone.radius / zone.baseRadius
        zone.mesh.scale.set(growthScale, 1, growthScale)
        zone.light.distance = zone.radius * 2.5
      }

      const flicker = 0.8 + Math.sin(now * 0.015 + zone.x) * 0.2
      zone.light.intensity = 1.4 * flicker
      zone.mesh.material.opacity = 0.32 * flicker + 0.08

      const dist = Math.hypot(playerPos.x - zone.x, playerPos.z - zone.z)
      const inside = dist <= zone.radius
      if (inside && zone.type === 'emp') playerInEmp = true
      if (inside && zone.type === 'web') playerInWeb = true

      if (inside && zone.type in TICK_DAMAGE && now >= zone.nextTickAt) {
        zone.nextTickAt = now + HAZARD_TICK_MS
        if (this.player.isDodging) return true // brief invincibility window, same as a zombie hit
        this.playerState.takeDamage(TICK_DAMAGE[zone.type])
        this._updateHealthHud()
        this.damageFlash.classList.remove('hit')
        void this.damageFlash.offsetWidth
        this.damageFlash.classList.add('hit')
        if (!this.playerState.alive) this._maybeLastStandOrDie()
      }
      return true
    })

    if (playerInEmp) {
      this.flashlightOn = false
      this.flashlightBattery = Math.max(0, this.flashlightBattery - HAZARD_EMP_BATTERY_DRAIN_PER_SEC * dt)
      this.flashlight.visible = false
    }
    // Webber's web patch (see PlayerController's webSlowMult) - recomputed
    // live every frame from current zone overlap, same precedent as
    // corpsePileMult rather than a timed buff/debuff.
    this.player.webSlowMult = playerInWeb ? WEB_SLOW_MULT : 1
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
        this.vehicle.health = Math.max(0, this.vehicle.health - VEHICLE_RAM_SELF_DAMAGE)
        if (this.vehicle.health <= 0) this.vehicle.disabled = true
      }
    }
  }

  // Vehicle Horn - an instant distraction at the car's own position (unlike
  // the thrown Noisemaker, nothing needs to travel there first) so it reads
  // as "blast the horn, draw the horde toward the car" - same
  // zombies.distraction shape ZombieManager's own noisemaker-landing code
  // already produces, just set directly.
  _useHorn() {
    audioEngine.playHorn()
    this.zombies.distraction = {
      x: this.vehicle.group.position.x,
      z: this.vehicle.group.position.z,
      expiresAt: performance.now() + VEHICLE_HORN_DISTRACTION_MS,
    }
  }

  // Vehicle Fuel refill - same "walk up, hold a resource, press interact"
  // shape as the Generator's fuel-can refuel, just for the car instead.
  _refuelVehicle() {
    if (!this.inventory.useFuelCan()) return
    this.vehicle.refuel(VEHICLE_REFUEL_PER_CAN)
    this._updateInventoryHud()
    this._showLoreToast(t('vehicleRefueled'))
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

    this.hudScaleSlider.value = this.settings.hudScale
    this.hudScaleValue.textContent = `${this.settings.hudScale}%`
    document.documentElement.style.setProperty('--hud-scale', this.settings.hudScale / 100)
    this.hudOpacitySlider.value = this.settings.hudOpacity
    this.hudOpacityValue.textContent = `${this.settings.hudOpacity}%`
    document.documentElement.style.setProperty('--hud-opacity', this.settings.hudOpacity / 100)

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

    this.hudScaleSlider.addEventListener('input', () => {
      const value = Number(this.hudScaleSlider.value)
      this.hudScaleValue.textContent = `${value}%`
      this.settings.hudScale = value
      document.documentElement.style.setProperty('--hud-scale', value / 100)
      saveSettings(this.settings)
    })

    this.hudOpacitySlider.addEventListener('input', () => {
      const value = Number(this.hudOpacitySlider.value)
      this.hudOpacityValue.textContent = `${value}%`
      this.settings.hudOpacity = value
      document.documentElement.style.setProperty('--hud-opacity', value / 100)
      saveSettings(this.settings)
    })

    // Motion Reduction (accessibility) - see _updateShake/_updateLandingDip's
    // own use of settings.shakeIntensity, no DOM/CSS effect to apply here.
    this.shakeIntensitySlider.value = this.settings.shakeIntensity
    this.shakeIntensityValue.textContent = `${this.settings.shakeIntensity}%`
    this.shakeIntensitySlider.addEventListener('input', () => {
      const value = Number(this.shakeIntensitySlider.value)
      this.shakeIntensityValue.textContent = `${value}%`
      this.settings.shakeIntensity = value
      saveSettings(this.settings)
    })

    // On-Screen Text Duration (accessibility) - a CSS custom property the
    // toast/lore-toast animations read their duration from (see style.css),
    // same --hud-scale-style plumbing as the sliders above.
    this.toastDurationSlider.value = this.settings.toastDuration
    this.toastDurationValue.textContent = `${this.settings.toastDuration}%`
    document.documentElement.style.setProperty('--toast-duration-mult', this.settings.toastDuration / 100)
    this.toastDurationSlider.addEventListener('input', () => {
      const value = Number(this.toastDurationSlider.value)
      this.toastDurationValue.textContent = `${value}%`
      this.settings.toastDuration = value
      document.documentElement.style.setProperty('--toast-duration-mult', value / 100)
      saveSettings(this.settings)
    })

    // Customizable Crosshair (accessibility) - --crosshair-color/size are
    // read by #crosshair's own CSS (see style.css).
    this.crosshairColorPicker.value = this.settings.crosshairColor
    document.documentElement.style.setProperty('--crosshair-color', this.settings.crosshairColor)
    this.crosshairColorPicker.addEventListener('input', () => {
      this.settings.crosshairColor = this.crosshairColorPicker.value
      document.documentElement.style.setProperty('--crosshair-color', this.settings.crosshairColor)
      saveSettings(this.settings)
    })
    this.crosshairSizeSlider.value = this.settings.crosshairSize
    this.crosshairSizeValue.textContent = `${this.settings.crosshairSize}%`
    document.documentElement.style.setProperty('--crosshair-size', this.settings.crosshairSize / 100)
    this.crosshairSizeSlider.addEventListener('input', () => {
      const value = Number(this.crosshairSizeSlider.value)
      this.crosshairSizeValue.textContent = `${value}%`
      this.settings.crosshairSize = value
      document.documentElement.style.setProperty('--crosshair-size', value / 100)
      saveSettings(this.settings)
    })

    // Reduce Flashing Effects (accessibility) - a body-level class every
    // flash/throb keyframe (critical-blood-overlay, damage-flash, etc.)
    // reads via CSS to swap to a slower/static variant, see style.css.
    this.reduceFlashingToggle.checked = this.settings.reduceFlashing
    document.body.classList.toggle('reduce-flashing', this.settings.reduceFlashing)
    this.reduceFlashingToggle.addEventListener('change', () => {
      this.settings.reduceFlashing = this.reduceFlashingToggle.checked
      document.body.classList.toggle('reduce-flashing', this.settings.reduceFlashing)
      saveSettings(this.settings)
    })

    // Toggle-to-Sprint/Crouch/Aim (accessibility) - see PlayerController's
    // toggleSprint/toggleCrouch and WeaponSystem's toggleAds.
    this.toggleSprintToggle.checked = this.settings.toggleSprint
    this.player.toggleSprint = this.settings.toggleSprint
    this.toggleSprintToggle.addEventListener('change', () => {
      this.settings.toggleSprint = this.toggleSprintToggle.checked
      this.player.toggleSprint = this.settings.toggleSprint
      saveSettings(this.settings)
    })
    this.toggleCrouchToggle.checked = this.settings.toggleCrouch
    this.player.toggleCrouch = this.settings.toggleCrouch
    this.toggleCrouchToggle.addEventListener('change', () => {
      this.settings.toggleCrouch = this.toggleCrouchToggle.checked
      this.player.toggleCrouch = this.settings.toggleCrouch
      saveSettings(this.settings)
    })
    this.toggleAdsToggle.checked = this.settings.toggleAds
    this.weapons.toggleAds = this.settings.toggleAds
    this.toggleAdsToggle.addEventListener('change', () => {
      this.settings.toggleAds = this.toggleAdsToggle.checked
      this.weapons.toggleAds = this.settings.toggleAds
      saveSettings(this.settings)
    })

    // Aim Assist (accessibility) - see WeaponSystem's AIM_ASSIST_OFFSETS.
    this.aimAssistToggle.checked = this.settings.aimAssist
    this.weapons.aimAssist = this.settings.aimAssist
    this.aimAssistToggle.addEventListener('change', () => {
      this.settings.aimAssist = this.aimAssistToggle.checked
      this.weapons.aimAssist = this.settings.aimAssist
      saveSettings(this.settings)
    })

    // Large Interact Prompt (accessibility) - a body-level class the
    // #interact-prompt CSS reads for a bigger font/box (see style.css).
    this.bigInteractPromptToggle.checked = this.settings.bigInteractPrompt
    document.body.classList.toggle('big-interact-prompt', this.settings.bigInteractPrompt)
    this.bigInteractPromptToggle.addEventListener('change', () => {
      this.settings.bigInteractPrompt = this.bigInteractPromptToggle.checked
      document.body.classList.toggle('big-interact-prompt', this.settings.bigInteractPrompt)
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
    this._bindEditableSliderValue(this.hudScaleValue, this.hudScaleSlider)
    this._bindEditableSliderValue(this.hudOpacityValue, this.hudOpacitySlider)
    this._bindEditableSliderValue(this.shakeIntensityValue, this.shakeIntensitySlider)
    this._bindEditableSliderValue(this.toastDurationValue, this.toastDurationSlider)
    this._bindEditableSliderValue(this.crosshairSizeValue, this.crosshairSizeSlider)

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

    this.endlessToggle.checked = this.settings.endlessMode
    this.endlessToggle.addEventListener('change', () => {
      this.settings.endlessMode = this.endlessToggle.checked
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
    this.mutatorHealthRegen.checked = this.settings.mutators.healthRegen
    this.mutatorHealthRegen.addEventListener('change', () => {
      this.settings.mutators.healthRegen = this.mutatorHealthRegen.checked
      saveSettings(this.settings)
    })
    this.mutatorIronMode.checked = this.settings.mutators.ironMode
    this.mutatorIronMode.addEventListener('change', () => {
      this.settings.mutators.ironMode = this.mutatorIronMode.checked
      saveSettings(this.settings)
    })
    this.mutatorScavenger.checked = this.settings.mutators.scavenger
    this.mutatorScavenger.addEventListener('change', () => {
      this.settings.mutators.scavenger = this.mutatorScavenger.checked
      saveSettings(this.settings)
    })
    this.mutatorGlassHouse.checked = this.settings.mutators.glassHouse
    this.mutatorGlassHouse.addEventListener('change', () => {
      this.settings.mutators.glassHouse = this.mutatorGlassHouse.checked
      saveSettings(this.settings)
    })
    this.mutatorFeaturedEnemy.checked = this.settings.mutators.featuredEnemy
    this.mutatorFeaturedEnemy.addEventListener('change', () => {
      this.settings.mutators.featuredEnemy = this.mutatorFeaturedEnemy.checked
      saveSettings(this.settings)
    })
    this.mutatorBlackout.checked = this.settings.mutators.blackout
    this.mutatorBlackout.addEventListener('change', () => {
      this.settings.mutators.blackout = this.mutatorBlackout.checked
      saveSettings(this.settings)
    })
    this.mutatorBossGauntlet.checked = this.settings.mutators.bossGauntlet
    this.mutatorBossGauntlet.addEventListener('change', () => {
      this.settings.mutators.bossGauntlet = this.mutatorBossGauntlet.checked
      saveSettings(this.settings)
    })
    this.nicknameInput.value = this.settings.nickname
    this.companionNameInput.value = this.settings.companionName
    this._updateCompanionName()

    this.nicknameInput.addEventListener('input', () => {
      this.settings.nickname = this.nicknameInput.value
      saveSettings(this.settings)
      this._updateCompanionName()
    })
    this.companionNameInput.addEventListener('input', () => {
      this.settings.companionName = this.companionNameInput.value
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
        this.zombies.healthMult = this.difficulty.healthMult
        this.zombies.eliteChanceMult = this.difficulty.eliteChanceMult
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
    // Companion Legacy (see COMPANION_LEGACY_KEY) applies even on a
    // trainingLevel-0 fresh run, unlike the training-only check this used
    // to be - a returning player's legacy bonus shouldn't need a single
    // in-run purchase to kick in first.
    if (this.companionTrainingLevel > 0 || this.companionLegacy.level > 0) {
      this.companion.applyTraining(this.companionTrainingLevel + this.companionLegacy.level)
    }
    if (this.companionGear.vest) this.companion.equipVest()
    if (this.companionGear.rig) this.companion.equipRig()
    if (this.coinShopPurchased.has('companion_speed')) this.companion.equipSpeedBoost()
    if (this.coinShopPurchased.has('companion_autorevive')) this.companion.equipAutoRevive()
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

  // Mirrors _applyMetaUpgrades' exact reasoning, for Coin Shop's own
  // permanent items (perks section: coin_damage/coin_health/coin_stamina,
  // and base: turret) - these were a real gap found while adding the
  // turret purchase: their apply() mutates a fresh WeaponSystem/PlayerState/
  // PlayerController directly (unlike traderDiscount/fortifiedRest, which
  // are no-op-apply and checked live via coinShopPurchased.has() at their
  // own use site instead), so without this they silently reset to baseline
  // every fresh page load despite coinShopPurchased still correctly
  // remembering they're owned. Guns/skins/attachments already have their
  // own separate, correct restoration a few lines above this call site -
  // 'weapons' section added for Akimbo (also mutates live WeaponSystem
  // state - fireInterval/skin - the same way perks/base items mutate their
  // own live state, and setAkimbo's own !w.akimbo check keeps re-calling
  // apply() here every load harmless).
  _applyCoinShopPerks() {
    for (const item of COIN_SHOP_ITEMS) {
      if ((item.section === 'perks' || item.section === 'base' || item.section === 'weapons') && item.isOwned && item.isOwned(this)) item.apply(this)
    }
  }

  // Veteran Perks - mirrors _applyMetaUpgrades' exact reasoning: granted
  // once (see _onPlayerDeath, when careerStats.totalKills crosses a
  // threshold) but re-applied every fresh run since WeaponSystem/PlayerState
  // are rebuilt from scratch each time.
  _applyVeteranPerks() {
    for (const perk of VETERAN_PERKS) {
      if (this.careerStats.veteranPerksGranted.includes(perk.id)) perk.apply(this)
    }
  }

  // Daily Login Streak - checked once per page load (not per run-restart),
  // so playing several runs in one sitting only ever grants today's bonus
  // the first time. today/yesterday comparison keeps it simple: any bigger
  // gap resets to a fresh streak of 1 rather than trying to partially credit it.
  _checkLoginStreak() {
    const today = todayDateString()
    if (this.loginStreak.lastDate === today) return
    this.loginStreak.streak = this.loginStreak.lastDate === yesterdayDateString() ? this.loginStreak.streak + 1 : 1
    this.loginStreak.lastDate = today
    saveLoginStreak(this.loginStreak)
    const bonusDays = Math.min(this.loginStreak.streak, LOGIN_STREAK_MAX_BONUS_DAYS)
    const coinBonus = bonusDays * LOGIN_STREAK_COIN_PER_DAY
    this.coins += coinBonus
    this._showLoreToast(t('loginStreakToast', { n: this.loginStreak.streak, coins: coinBonus }))
  }

  _updateCompanionName() {
    const customName = this.settings.companionName.trim()
    if (customName) {
      this.companion.setName(customName)
      return
    }
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
  // most expensive effects (shadows, bloom) and caps draw/light/shadow
  // distance (_perfDistanceMult), rather than touching gameplay-affecting
  // settings. Resolution is no longer part of that trade - confirmed
  // (2026-07-21) that cutting render resolution all the way down didn't
  // recover any fps in a genuinely severe case, meaning pixel count isn't
  // the bottleneck, so capping it below the display's real resolution was
  // pure downside (blur) for zero benefit. Always renders at the display's
  // true native pixel ratio now, in and out of Performance Mode alike.
  _basePixelRatio() {
    // Fixed, modest cut under LOW_QUALITY_MODE (bare-bones/minimum-
    // resource mode) - real GPU fill-rate win (fewer total shaded
    // pixels), unlike the disabled dynamic per-frame scaler above, which
    // was specifically proven not to rescue an already-catastrophic case.
    // This is a flat baseline cost reduction, not trying to "save" a bad
    // frame - a different goal, still worth doing.
    return LOW_QUALITY_MODE ? 0.75 : window.devicePixelRatio
  }

  _applyRenderScale() {
    this.renderer.setPixelRatio(this._basePixelRatio() * this._dynResScale)
  }

  _applyPerformanceMode(settingEnabled) {
    // LOW_QUALITY_MODE (bare-bones mode) must never get UNDONE by this -
    // without this OR, loading with the "FPS Optimized" checkbox off
    // (its default) would call _applyPerformanceMode(false) during
    // startup and re-enable shadows/bloom, overriding the bare-bones
    // renderer setup above. The checkbox can still make things even MORE
    // reduced on top when the player explicitly turns it on; it just
    // can't turn bare-bones mode itself back off.
    const enabled = settingEnabled || LOW_QUALITY_MODE
    this.renderer.shadowMap.enabled = !enabled
    this.bloomPass.enabled = !enabled
    // 0.75 (fewer total shaded pixels than native resolution) instead of
    // just capping at 1 - a real, substantial GPU fill-rate win on weak
    // hardware, worth the softer image for the framerate it buys back.
    this._applyRenderScale()
    // Shrinks how much of the map gets rendered/shadow-cast/lit at all
    // (_updateCulling), not just the shadow-map/bloom toggles above - those
    // two alone barely help if the GPU's actual bottleneck is fill rate or
    // sheer draw count from geometry far from the player.
    this._perfDistanceMult = enabled ? 0.6 : 1
    const far = (WORLD_CULL_DISTANCE * this._perfDistanceMult) + 5
    this.camera.far = far
    this.camera.updateProjectionMatrix()
    this.tpCamera.far = far
    this.tpCamera.updateProjectionMatrix()
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
      this.comboCounter.classList.toggle('combo-tier-2', this.comboCount >= COMBO_TIER2_THRESHOLD)
      this.comboCounter.classList.toggle('combo-tier-3', this.comboCount >= COMBO_TIER3_THRESHOLD)
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
  // Run-start trait draw (see RUN_START_TRAITS) - reuses the XP level-up
  // panel's exact DOM elements (a title + N option buttons) rather than
  // building a second parallel panel, just with different content and a
  // different completion action (resume into the run instead of
  // re-checking level-up thresholds).
  _rollRunStartTraits() {
    const pool = [...RUN_START_TRAITS]
    const picks = []
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      picks.push(pool[idx])
      pool.splice(idx, 1)
    }
    return picks
  }

  _openTraitDrawPanel() {
    this.xpLevelupPanelOpen = true
    this.xpLevelupPanel.style.display = 'flex'
    this.xpLevelupPanelTitle.textContent = t('traitDrawPanelTitle')
    this._renderTraitDrawOptions(this._rollRunStartTraits())
  }

  _renderTraitDrawOptions(traits) {
    this.xpLevelupOptions.innerHTML = ''
    for (const trait of traits) {
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.innerHTML = `<span class="perk-name">${t(trait.titleKey)}</span>`
      btn.addEventListener('click', () => {
        trait.apply(this)
        this.xpLevelupPanelOpen = false
        this.xpLevelupPanel.style.display = 'none'
        this.player.controls.lock()
      })
      this.xpLevelupOptions.appendChild(btn)
    }
  }

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

  // Trader mood line (see NARRATIVE_STATS_KEY) - reacts to this save's
  // lifetime rescued-vs-lost survivor counts rather than anything about
  // the current run, so it reads as the Trader having heard about your
  // reputation over time rather than commenting on tonight specifically.
  _renderTraderMoodLine() {
    if (!this.traderMoodLine) return
    const { rescued, lost } = this.narrativeStats
    let key = 'traderMoodNeutral'
    if (rescued > 0 || lost > 0) key = rescued > lost ? 'traderMoodGrateful' : 'traderMoodGrim'
    this.traderMoodLine.textContent = t(key)
  }

  // Opened by pressing the interact key near the trader stall (see
  // World.js's buildTraderStall). Buying doesn't close the panel, so
  // multiple items can be bought in one visit - press interact again to leave.
  _openTraderPanel() {
    this.traderPanelOpen = true
    this.traderPanel.style.display = 'flex'
    this.traderPanelTitle.textContent = t('traderPanelTitle')
    this._renderTraderMoodLine()
    this.traderHint.textContent = tHtml('traderHint')
    this.player.controls.unlock()
    if (!this.activeBounty) this._assignBounty()
    this._renderBounty()
    if (!this.traderQuest) this._assignTraderQuest()
    this._renderQuestLine()
    this._renderWeeklyChallengeLine()
    this._renderTraderOptions()
  }

  _assignBounty(excludeId) {
    const def = pickBounty(excludeId)
    this.activeBounty = { ...def, progress: 0, startNight: this.night }
    // clear_location needs a fresh target picked at assignment time, not
    // baked into the static def - reuses the same named-location spots
    // already tracked as compass landmarks, so no new coordinate list to
    // maintain separately.
    if (def.id === 'clear_location') {
      const spots = [
        { label: t('bountyLocHospital'), x: this.hospital.x, z: this.hospital.z },
        { label: t('bountyLocPolice'), x: this.policeStation.x, z: this.policeStation.z },
        { label: t('bountyLocPrison'), x: this.prison.x, z: this.prison.z },
        { label: t('bountyLocUniversity'), x: this.university.x, z: this.university.z },
        { label: t('bountyLocMegaMall'), x: this.megaMall.x, z: this.megaMall.z },
      ]
      const spot = spots[Math.floor(Math.random() * spots.length)]
      this.activeBounty.locationLabel = spot.label
      this.activeBounty.locationX = spot.x
      this.activeBounty.locationZ = spot.z
    }
  }

  _renderBounty() {
    const b = this.activeBounty
    if (!b) return
    this.bountyLineEl.textContent = t('bountyLine', {
      title: t(b.titleKey, { n: b.target, location: b.locationLabel }),
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

  // Weekly Challenge - see WEEKLY_CHALLENGES' own doc comment.
  _checkWeeklyChallengeProgress() {
    if (this.weeklyChallenge.completed) return
    this.weeklyChallenge.progress += 1
    if (this.weeklyChallenge.progress >= this.weeklyDef.target) {
      this.weeklyChallenge.completed = true
      this.coins += this.weeklyDef.rewardCoins
      this._showLoreToast(t('weeklyChallengeComplete', { title: t(this.weeklyDef.titleKey), coins: this.weeklyDef.rewardCoins }))
    }
    saveWeeklyChallenge(this.weeklyChallenge)
    if (this.traderPanelOpen) this._renderWeeklyChallengeLine()
  }

  _renderWeeklyChallengeLine() {
    const w = this.weeklyChallenge
    this.weeklyChallengeLineEl.textContent = w.completed
      ? t('weeklyChallengeDoneLine', { title: t(this.weeklyDef.titleKey) })
      : t('weeklyChallengeLine', { title: t(this.weeklyDef.titleKey), progress: Math.min(w.progress, this.weeklyDef.target), target: this.weeklyDef.target, coins: this.weeklyDef.rewardCoins })
  }

  // Trader Request - see TRADER_QUESTS' own doc comment for why this is
  // meaningfully different from the bounty above (2 stages, a real fetch
  // step before the kill count).
  _assignTraderQuest(excludeId) {
    const pool = TRADER_QUESTS.filter((q) => q.id !== excludeId)
    const def = pool[Math.floor(Math.random() * pool.length)] || TRADER_QUESTS[0]
    this.traderQuest = { ...def, stage: 1, kills: 0 }
  }

  _renderQuestLine() {
    const q = this.traderQuest
    this.questLineEl.innerHTML = ''
    if (!q) return
    if (q.stage === 1) {
      const have = this.inventory[q.fetchInvKey]
      const span = document.createElement('span')
      span.textContent = t('questStage1Line', { title: t(q.titleKey), have: Math.min(have, q.fetchCount), need: q.fetchCount, item: t(q.fetchLabelKey) })
      this.questLineEl.appendChild(span)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.textContent = t('questTurnInButton')
      btn.disabled = have < q.fetchCount
      btn.addEventListener('click', () => this._turnInTraderQuestStage1())
      this.questLineEl.appendChild(btn)
    } else {
      const span = document.createElement('span')
      span.textContent = t('questStage2Line', { title: t(q.titleKey), progress: Math.min(q.kills, q.killCount), target: q.killCount })
      this.questLineEl.appendChild(span)
    }
  }

  _turnInTraderQuestStage1() {
    const q = this.traderQuest
    if (!q || q.stage !== 1 || this.inventory[q.fetchInvKey] < q.fetchCount) return
    this.inventory[q.fetchInvKey] -= q.fetchCount
    q.stage = 2
    this._updateInventoryHud()
    this._renderQuestLine()
    this._showLoreToast(t('questStage1Complete', { title: t(q.titleKey) }))
  }

  // Called on every zombie kill (see _onZombieKilled) - unlike the bounty
  // checks above, stage 2 doesn't care about zombie type or weapon.
  _checkTraderQuestKill() {
    const q = this.traderQuest
    if (!q || q.stage !== 2) return
    q.kills += 1
    if (q.kills >= q.killCount) this._completeTraderQuest()
    else if (this.traderPanelOpen) this._renderQuestLine()
  }

  _completeTraderQuest() {
    const q = this.traderQuest
    this.points += q.rewardPoints
    this.coins += q.rewardCoins
    this._updateStatsPanel()
    this._showLoreToast(t('questComplete', { title: t(q.titleKey), points: q.rewardPoints, coins: q.rewardCoins }))
    this._assignTraderQuest(q.id)
    if (this.traderPanelOpen) this._renderQuestLine()
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
    // Trader leveling (see TRADER_LEVEL_SALES_PER_TIER's own comment) -
    // stacks with (multiplies into) the discount above rather than
    // replacing it.
    const levelDiscount = Math.min(TRADER_LEVEL_MAX_DISCOUNT, Math.floor(this.traderTotalSales / TRADER_LEVEL_SALES_PER_TIER) * TRADER_LEVEL_DISCOUNT_PER_TIER)
    return Math.max(1, Math.round(item.cost * mult * discountMult * (1 - levelDiscount)))
  }

  _renderTraderOptions() {
    this.traderPointsLine.textContent = t('scrapLabel', { n: this.points })
    this.traderOptions.innerHTML = ''
    // Iron Mode - blocks spending specifically (this list and the Black
    // Market below), not salvage/crafting (converting resources you
    // already have, not buying with currency).
    if (this.settings.mutators.ironMode) {
      this.traderOptions.innerHTML = `<p class="iron-mode-notice">${t('ironModeShopDisabled')}</p>`
      return
    }

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
    this._renderCraftingOptions()
    this._renderStashOptions()
    this._renderBlackMarketOptions()
  }

  // Only visible once Achievements.js's 'centurion' has ever been unlocked
  // (see achievements.unlocked, persisted across runs) - a permanent
  // reputation-gated tier rather than a one-run bonus.
  _renderBlackMarketOptions() {
    this.traderBlackMarketOptions.innerHTML = ''
    const show = this.achievements.unlocked.has('centurion') && !this.settings.mutators.ironMode
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
        this.traderTotalSales += item.sellValue
        saveTraderSales(this.traderTotalSales)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderSalvageOptions.appendChild(btn)
    }
  }

  // Crafting - same "only shown if you actually have the ingredients"
  // gating as _renderSalvageOptions above, just checking every ingredient
  // in a recipe rather than a single owned count.
  _renderCraftingOptions() {
    this.traderCraftingOptions.innerHTML = ''
    const available = CRAFTING_RECIPES.filter((recipe) => recipe.ingredients.every((ing) => this.inventory[ing.invKey] >= ing.count))
    const show = available.length > 0
    this.traderCraftingTitle.style.display = show ? '' : 'none'
    this.traderCraftingOptions.style.display = show ? '' : 'none'
    if (!show) return

    this.traderCraftingTitle.textContent = t('craftingSectionLabel')
    for (const recipe of available) {
      const ingredientsLabel = recipe.ingredients.map((ing) => `${ing.count}x ${t(SALVAGE_ITEMS.find((s) => s.invKey === ing.invKey).titleKey)}`).join(' + ')
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.innerHTML = `
        <span class="perk-name">${t(recipe.titleKey)}</span>
        <span class="perk-cost">${ingredientsLabel}</span>
      `
      btn.addEventListener('click', () => {
        if (!recipe.ingredients.every((ing) => this.inventory[ing.invKey] >= ing.count)) return
        recipe.craft(this)
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderCraftingOptions.appendChild(btn)
    }
  }

  // Shared Stash - always shown (unlike crafting/salvage, which hide when
  // nothing qualifies) since depositing 0 of everything is still a valid,
  // visible state showing what's already banked.
  _renderStashOptions() {
    this.traderStashOptions.innerHTML = ''
    this.traderStashTitle.textContent = t('stashSectionLabel')
    for (const item of STASH_ITEMS) {
      const have = this.inventory[item.invKey]
      const banked = this.stash[item.invKey]
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = have <= 0
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)} (${t('stashBankedLabel', { n: banked })})</span>
        <span class="perk-cost">${t('stashDepositLabel', { n: have })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.inventory[item.invKey] <= 0) return
        this.inventory[item.invKey] -= 1
        this.stash[item.invKey] += 1
        saveStash(this.stash)
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderStashOptions.appendChild(btn)
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
    this._updatePrestigeBadge()
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

  // Journal - built entirely from state the game already tracks (discovered
  // map cells + allLocationLandmarks for fast travel, the active bounty,
  // audioLogsFound) rather than a new lore/objective tracker, same "render
  // once per open, gameplay frozen while open" pattern as the map/inventory.
  _renderJournal() {
    const foundLocations = this.allLocationLandmarks.filter((lm) => {
      const cx = Math.floor(lm.x / EXPLORE_CELL_SIZE)
      const cz = Math.floor(lm.z / EXPLORE_CELL_SIZE)
      return this.discoveredCells.has(`${cx},${cz}`)
    })
    const b = this.activeBounty
    const q = this.traderQuest
    const w = this.weeklyChallenge
    // Unified Quest Log - the journal already tracked bounty progress; this
    // folds in the Trader Request and Weekly Challenge too (previously only
    // visible from inside the trader panel itself), so every active
    // objective is readable from one screen instead of three.
    this.journalContent.innerHTML = `
      <div class="journal-section">
        <h3>${t('journalLocationsHeading')}</h3>
        <p>${t('journalLocationsCount', { found: foundLocations.length, total: this.allLocationLandmarks.length })}</p>
      </div>
      <div class="journal-section">
        <h3>${t('journalBountyHeading')}</h3>
        ${b
          ? `<p>${t(b.titleKey, { n: b.target })}</p><p>${t('journalBountyProgress', { progress: Math.min(b.progress, b.target), target: b.target })}</p>`
          : `<p>${t('journalNoBounty')}</p>`}
      </div>
      <div class="journal-section">
        <h3>${t('journalTraderQuestHeading')}</h3>
        ${q
          ? q.stage === 1
            ? `<p>${t('questStage1Line', { title: t(q.titleKey), have: Math.min(this.inventory[q.fetchInvKey], q.fetchCount), need: q.fetchCount, item: t(q.fetchLabelKey) })}</p>`
            : `<p>${t('questStage2Line', { title: t(q.titleKey), progress: Math.min(q.kills, q.killCount), target: q.killCount })}</p>`
          : `<p>${t('journalNoTraderQuest')}</p>`}
      </div>
      <div class="journal-section">
        <h3>${t('journalWeeklyHeading')}</h3>
        <p>${w.completed
          ? t('weeklyChallengeDoneLine', { title: t(this.weeklyDef.titleKey) })
          : t('weeklyChallengeLine', { title: t(this.weeklyDef.titleKey), progress: Math.min(w.progress, this.weeklyDef.target), target: this.weeklyDef.target, coins: this.weeklyDef.rewardCoins })}</p>
      </div>
      <div class="journal-section">
        <h3>${t('journalLoreHeading')}</h3>
        <p>${t('journalLoreCount', { found: this.audioLogsFound.size, total: 8 })}</p>
      </div>
      <div class="journal-section">
        <h3>${t('journalMarkersHeading')}</h3>
        <p>${t('journalMarkersCount', { found: this.loreMarkersFound.size, total: LORE_MARKERS.length })}</p>
      </div>
      <div class="journal-section">
        <h3>${t('journalWorldStateHeading')}</h3>
        <p>${t('journalWorldStateRescues', { rescued: this.narrativeStats.rescued, lost: this.narrativeStats.lost })}</p>
        <p>${t('journalWorldStateBosses', { count: this.narrativeStats.bossEpitaphsSeen.length, total: Object.keys(BOSS_EPITAPH_KEYS).length })}</p>
        <p>${t('journalWorldStateBackstory', { loadout: t(LOADOUT_LABEL_KEYS[this.settings.loadout]) })}</p>
      </div>
    `
  }

  _renderCoinShopOptions() {
    this.coinshopCoinLine.textContent = t('coinsLabel', { n: this.coins })
    this.coinshopOptions.innerHTML = ''
    // Iron Mode - gated once here rather than at every individual buy
    // button, since every Coin Shop purchase path renders through this one
    // function.
    if (this.settings.mutators.ironMode) {
      this.coinshopOptions.innerHTML = `<p class="iron-mode-notice">${t('ironModeShopDisabled')}</p>`
      return
    }

    const sections = [
      { id: 'guns', labelKey: 'shopSectionGuns' },
      { id: 'weapons', labelKey: 'shopSectionWeapons' },
      { id: 'skins', labelKey: 'shopSectionSkins' },
      { id: 'outfits', labelKey: 'shopSectionOutfits' },
      { id: 'perks', labelKey: 'shopSectionPerks' },
      { id: 'base', labelKey: 'shopSectionBase' },
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
            if (index !== -1) {
              this.weapons.switchToIndex(index)
              this._updateHotbarHud()
            }
            this._renderCoinShopOptions()
          })
          wrap.appendChild(btn)

          // Per-gun permanent attachments (see CoinShop.js's
          // ATTACHMENT_TYPES) - melee has no ammo/scope/sound to attach to,
          // and every attachment needs the gun owned first.
          if (w.id !== 'melee' && w.unlocked) {
            const ownedFlags = {
              scope: w.scopeOwned,
              extmag: w.hasExtMag,
              suppressor: w.suppressed,
              laser: w.hasLaser,
              incendiary: w.ignites,
              ricochet: w.ricochet,
              armorpierce: w.armorPierce,
              precision: !!w.critChance,
            }
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

      // Same "unequip" front-of-section button, mirrored for outfits.
      if (section.id === 'outfits') {
        const defaultBtn = document.createElement('button')
        defaultBtn.className = 'perk-option'
        defaultBtn.disabled = this.equippedOutfit === null
        defaultBtn.innerHTML = `
          <span class="perk-name">${t('skinDefault')}</span>
          <span class="perk-cost">${this.equippedOutfit === null ? t('skinEquipped') : t('skinEquip')}</span>
        `
        defaultBtn.addEventListener('click', () => {
          this.equippedOutfit = null
          this.playerBody.setOutfit(null)
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
        } else if (item.outfit) {
          const owned = this.ownedOutfits.has(item.outfit)
          const equipped = this.equippedOutfit === item.outfit
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
              this.ownedOutfits.add(item.outfit)
              this._updateStatsPanel()
            }
            this.equippedOutfit = item.outfit
            this.playerBody.setOutfit(item.outfitColor)
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
    document.getElementById('panel-shield-label').textContent = t('shieldLabel')
    document.getElementById('panel-knife-label').textContent = t('knifeLabel')
    document.getElementById('panel-turretkit-label').textContent = t('shopTurretKit')
    document.getElementById('panel-alarmkit-label').textContent = t('shopAlarmKit')
    document.getElementById('panel-ration-label').textContent = t('shopRation')
    document.getElementById('panel-water-label').textContent = t('shopWater')
    document.getElementById('weapons-title').textContent = t('weaponsTitle')
    document.getElementById('inventory-hint').innerHTML = tHtml('inventoryHint')

    document.getElementById('stats-day-label').textContent = t('dayLabel')
    document.getElementById('stats-deaths-label').textContent = t('deathsLabel')
    document.getElementById('stats-kills-label').textContent = t('killsLabel')
    document.getElementById('stats-points-label').textContent = t('scrapStatLabel')
    document.getElementById('stats-rank-label').textContent = t('statsRankLabel')

    document.getElementById('diff-easy').textContent = t('difficultyEasy')
    document.getElementById('diff-normal').textContent = t('difficultyNormal')
    document.getElementById('diff-hard').textContent = t('difficultyHard')
    document.getElementById('diff-nightmare').textContent = t('difficultyNightmare')
    document.getElementById('diff-apex').textContent = t('difficultyApex')

    const roleLabelKeys = { ranged: 'roleRanged', melee: 'roleMelee', medic: 'roleMedic' }
    for (const btn of this.roleBtns) btn.textContent = t(roleLabelKeys[btn.dataset.role])
    // Narrative blurb (see loadoutBalancedBlurb/RunnerBlurb/TankBlurb) shown
    // as a hover tooltip - these presets were already a pure stat tradeoff
    // with zero flavor text, so this is purely additive over the existing
    // selection UI rather than a second parallel picker.
    const loadoutBlurbKeys = { balanced: 'loadoutBalancedBlurb', runner: 'loadoutRunnerBlurb', tank: 'loadoutTankBlurb' }
    for (const btn of this.loadoutBtns) {
      btn.textContent = t(LOADOUT_LABEL_KEYS[btn.dataset.loadout])
      btn.title = t(loadoutBlurbKeys[btn.dataset.loadout])
    }
    document.getElementById('score-attack-label').textContent = t('scoreAttackLabel')
    document.getElementById('hardcore-label').textContent = t('hardcoreLabel')
    document.getElementById('endless-label').textContent = t('endlessLabel')
    document.getElementById('mutator-horde-rush-label').textContent = t('mutatorHordeRush')
    document.getElementById('mutator-loot-rush-label').textContent = t('mutatorLootRush')
    document.getElementById('mutator-pure-gunplay-label').textContent = t('mutatorPureGunplay')
    document.getElementById('mutator-boss-rush-label').textContent = t('mutatorBossRush')
    document.getElementById('mutator-horde-mode-label').textContent = t('mutatorHordeMode')
    document.getElementById('mutator-koth-label').textContent = t('mutatorKoth')
    document.getElementById('mutator-extraction-label').textContent = t('mutatorExtraction')
    document.getElementById('mutator-daily-label').textContent = t('mutatorDaily')
    document.getElementById('mutator-health-regen-label').textContent = t('mutatorHealthRegen')
    document.getElementById('mutator-iron-mode-label').textContent = t('mutatorIronMode')
    document.getElementById('mutator-scavenger-label').textContent = t('mutatorScavenger')
    document.getElementById('mutator-glass-house-label').textContent = t('mutatorGlassHouse')
    document.getElementById('mutator-featured-enemy-label').textContent = t('mutatorFeaturedEnemy')
    document.getElementById('mutator-blackout-label').textContent = t('mutatorBlackout')
    document.getElementById('mutator-boss-gauntlet-label').textContent = t('mutatorBossGauntlet')
    document.getElementById('shake-intensity-label').textContent = t('shakeIntensityLabel')
    document.getElementById('reduce-flashing-label').textContent = t('reduceFlashingLabel')
    document.getElementById('toggle-sprint-label').textContent = t('toggleSprintLabel')
    document.getElementById('toggle-crouch-label').textContent = t('toggleCrouchLabel')
    document.getElementById('toggle-ads-label').textContent = t('toggleAdsLabel')
    document.getElementById('aim-assist-label').textContent = t('aimAssistLabel')
    document.getElementById('big-interact-prompt-label').textContent = t('bigInteractPromptLabel')
    document.getElementById('toast-duration-label').textContent = t('toastDurationLabel')
    document.getElementById('crosshair-color-label').textContent = t('crosshairColorLabel')
    document.getElementById('crosshair-size-label').textContent = t('crosshairSizeLabel')

    this._updateBestStatsDisplay()
    this._updateLeaderboardDisplay()
    this._updateBossRushLeaderboardDisplay()
    this._updateHardcoreMemorialDisplay()
    if (this.inventoryOpen) this._refreshInventoryPanel()
    this._updateProgressHud()
  }

  _updateBestStatsDisplay() {
    const { bestNight, bestKills, bestKillStreak } = this.bestStats
    if (bestNight === 0 && bestKills === 0) {
      this.menuBestStats.textContent = ''
    } else {
      this.menuBestStats.textContent =
        `${t('bestLabel')}: ${t('hudNight', { n: bestNight })} · ${t('hudKills', { n: bestKills })} · ${t('bestKillStreakLabel', { n: bestKillStreak })}`
    }
    if (this.menuCareerRank) {
      this.menuCareerRank.textContent = this.careerStats.totalKills === 0
        ? ''
        : t('careerRankLabel', { rank: t(careerRankTitleKey(this.careerStats.totalKills)), kills: this.careerStats.totalKills })
    }
    this._updateMenuNewsTicker()
    this._updatePrestigeBadge()
  }

  // Prestige cosmetic badges - tiered color escalation (bronze/silver/gold-
  // ish) purely for visual flair, distinct from the numeric +10%/level
  // bonus prestigeLevelLine already shows inside the Legacy panel.
  _updatePrestigeBadge() {
    if (!this.menuPrestigeBadge) return
    const level = this.metaProgress.prestigeLevel
    if (level <= 0) {
      this.menuPrestigeBadge.style.display = 'none'
      return
    }
    this.menuPrestigeBadge.style.display = ''
    this.menuPrestigeBadge.classList.remove('prestige-tier-1', 'prestige-tier-2', 'prestige-tier-3')
    const tier = level >= 6 ? 3 : level >= 3 ? 2 : 1
    this.menuPrestigeBadge.classList.add(`prestige-tier-${tier}`)
    this.menuPrestigeBadge.textContent = t('prestigeBadgeLabel', { level })
  }

  // Main-menu news ticker - tied to bestStats.bestNight (already persisted,
  // no new tracking needed), framed as the world worsening the further
  // you've ever gotten rather than reacting to any single run's outcome.
  _updateMenuNewsTicker() {
    if (!this.menuNewsTicker) return
    const n = this.bestStats.bestNight
    const key = n >= NEWS_TICKER_LATE_NIGHT ? 'newsTickerLate' : n >= NEWS_TICKER_MID_NIGHT ? 'newsTickerMid' : 'newsTickerEarly'
    this.menuNewsTicker.textContent = t(key)
    if (this.weeklyFeaturedMutatorLine) {
      const mutatorKey = _weeklyFeaturedMutatorKey()
      this.weeklyFeaturedMutatorLine.textContent = t('weeklyFeaturedMutatorLine', {
        mutator: t(WEEKLY_FEATURED_MUTATOR_LABEL_KEYS[mutatorKey]),
        coins: WEEKLY_FEATURED_MUTATOR_BONUS_COINS,
      })
    }
  }

  // Local leaderboard - see loadLeaderboard's own doc comment for how this
  // differs from bestStats above. Called once per run end (death or
  // dawn-survival) from _onPlayerDeath/the survive-to-dawn path.
  _recordLeaderboardEntry() {
    this.leaderboard.push({ night: this.night, kills: this.kills, points: this.points, date: Date.now() })
    this.leaderboard.sort((a, b) => (b.night - a.night) || (b.kills - a.kills) || (b.points - a.points))
    this.leaderboard = this.leaderboard.slice(0, LEADERBOARD_MAX_ENTRIES)
    saveLeaderboard(this.leaderboard)
    this._updateLeaderboardDisplay()

    // Boss Rush leaderboard - a genuinely separate board (see
    // BOSS_RUSH_LEADERBOARD_KEY's own comment), only ever gains an entry
    // from a run that actually had the mutator on.
    if (this.settings.mutators.bossRush) {
      this.bossRushLeaderboard.push({ night: this.night, kills: this.kills, points: this.points, date: Date.now() })
      this.bossRushLeaderboard.sort((a, b) => (b.night - a.night) || (b.kills - a.kills) || (b.points - a.points))
      this.bossRushLeaderboard = this.bossRushLeaderboard.slice(0, LEADERBOARD_MAX_ENTRIES)
      saveBossRushLeaderboard(this.bossRushLeaderboard)
    }
    this._updateBossRushLeaderboardDisplay()
  }

  _updateLeaderboardDisplay() {
    if (this.leaderboard.length === 0) {
      this.menuLeaderboard.style.display = 'none'
      this.menuLeaderboard.innerHTML = ''
      return
    }
    this.menuLeaderboard.style.display = ''
    const rows = this.leaderboard
      .map((e, i) => `<div class="leaderboard-row"><span>#${i + 1}</span><span>${t('hudNight', { n: e.night })}</span><span>${t('hudKills', { n: e.kills })}</span></div>`)
      .join('')
    this.menuLeaderboard.innerHTML = `<p class="menu-best-stats">${t('leaderboardTitle')}</p>${rows}`
  }

  // Shows once this save has ever recorded a Boss Rush run, regardless of
  // whether the mutator checkbox happens to be checked right now - this is
  // a hall-of-fame for past runs, not a live preview of the current toggle.
  _updateBossRushLeaderboardDisplay() {
    if (!this.menuBossRushLeaderboard) return
    if (this.bossRushLeaderboard.length === 0) {
      this.menuBossRushLeaderboard.style.display = 'none'
      this.menuBossRushLeaderboard.innerHTML = ''
      return
    }
    this.menuBossRushLeaderboard.style.display = ''
    const rows = this.bossRushLeaderboard
      .map((e, i) => `<div class="leaderboard-row"><span>#${i + 1}</span><span>${t('hudNight', { n: e.night })}</span><span>${t('hudKills', { n: e.kills })}</span></div>`)
      .join('')
    this.menuBossRushLeaderboard.innerHTML = `<p class="menu-best-stats">${t('bossRushLeaderboardTitle')}</p>${rows}`
  }

  // Hardcore Mode death memorial (see HARDCORE_MEMORIAL_KEY's own comment) -
  // called only from an actual death (_onPlayerDeath), never from the
  // survive-to-dawn path _recordLeaderboardEntry above also handles, since
  // surviving isn't a death worth memorializing.
  _recordHardcoreMemorial() {
    this.hardcoreMemorial.unshift({
      name: this.settings.nickname || t('hardcoreMemorialUnnamed'),
      night: this.night,
      kills: this.kills,
      date: Date.now(),
    })
    this.hardcoreMemorial = this.hardcoreMemorial.slice(0, HARDCORE_MEMORIAL_MAX_ENTRIES)
    saveHardcoreMemorial(this.hardcoreMemorial)
    this._updateHardcoreMemorialDisplay()
  }

  _updateHardcoreMemorialDisplay() {
    if (!this.menuHardcoreMemorial) return
    if (this.hardcoreMemorial.length === 0) {
      this.menuHardcoreMemorial.style.display = 'none'
      this.menuHardcoreMemorial.innerHTML = ''
      return
    }
    this.menuHardcoreMemorial.style.display = ''
    const rows = this.hardcoreMemorial
      .map((e) => `<div class="leaderboard-row"><span>${e.name}</span><span>${t('hudNight', { n: e.night })}</span><span>${t('hudKills', { n: e.kills })}</span></div>`)
      .join('')
    this.menuHardcoreMemorial.innerHTML = `<p class="menu-best-stats">${t('hardcoreMemorialTitle')}</p>${rows}`
  }

  _refreshInventoryPanel() {
    this.panelHealthCount.textContent = this.inventory.healthPacks
    this.panelArmorCount.textContent = this.inventory.armorPacks
    this.panelNoisemakerCount.textContent = this.inventory.noisemakers
    this.panelGrenadeCount.textContent = this.inventory.grenades
    this.panelShieldCount.textContent = this.inventory.shields
    this.panelKnifeCount.textContent = this.inventory.throwingKnives
    this.panelTurretkitCount.textContent = this.inventory.turretKits
    this.panelAlarmkitCount.textContent = this.inventory.alarmKits
    this.panelRationCount.textContent = this.inventory.rations
    this.panelWaterCount.textContent = this.inventory.waterBottles
    this.panelBarricadeCount.textContent = this.inventory.barricades
    this.panelTrapCount.textContent = this.inventory.traps
    this.panelMolotovCount.textContent = this.inventory.molotovs
    this.panelC4Count.textContent = this.inventory.c4
    this.panelAdrenalineCount.textContent = this.inventory.adrenaline
    this.panelEmpCount.textContent = this.inventory.emp

    // Hide Empty toggle - walks every consumable row rather than a fixed
    // id list, so a future new consumable row is covered automatically as
    // long as it follows the same "count span inside an .inv-panel-row"
    // shape every existing row already uses.
    for (const row of document.querySelectorAll('#inventory-panel .inv-panel-section .inv-panel-row')) {
      const countEl = row.querySelector('[id$="-count"]')
      if (!countEl) continue
      row.style.display = this.hideEmptyInventory && countEl.textContent === '0' ? 'none' : ''
    }

    this.panelWeaponsList.innerHTML = this.weapons
      .getSummary()
      .map((w) => {
        const grandmastered = this.weaponMastery.grandmastered.has(w.id)
        const mastered = w.masteryMult > 1
        const kills = this.weaponMastery.kills[w.id] || 0
        const masteryTag = grandmastered
          ? `<span class="mastery-tag grandmastered" title="${t('masteryGrandmasteredTitle', { pct: Math.round((GRANDMASTER_DAMAGE_MULT - 1) * 100) })}">★★</span>`
          : mastered
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
    this._renderLoadoutPresets()
  }

  // 3 named snapshots of the 5-slot hotbar (see settings.hotbarPresets'
  // own doc comment) - save copies the CURRENT hotbar into a slot, load
  // restores it, so switching between a couple of full weapon setups
  // doesn't mean re-assigning every slot by hand each time.
  _renderLoadoutPresets() {
    this.panelLoadoutPresets.innerHTML = this.settings.hotbarPresets
      .map((preset, i) => {
        const summary = preset ? (preset.filter(Boolean).join(', ') || t('loadoutPresetEmptySlots')) : t('loadoutPresetEmpty')
        return `
        <div class="inv-panel-row">
          <span>${t('loadoutPresetSlot', { n: i + 1 })}: ${summary}</span>
          <span>
            <button class="loadout-save-btn" data-slot="${i}">${t('loadoutPresetSave')}</button>
            <button class="loadout-load-btn" data-slot="${i}" ${preset ? '' : 'disabled'}>${t('loadoutPresetLoad')}</button>
          </span>
        </div>
      `
      })
      .join('')
  }

  _saveHotbarPreset(slot) {
    this.settings.hotbarPresets[slot] = [...this.settings.hotbar]
    saveSettings(this.settings)
    this._renderLoadoutPresets()
    this._showLoreToast(t('toastLoadoutSaved', { n: slot + 1 }))
  }

  _loadHotbarPreset(slot) {
    const preset = this.settings.hotbarPresets[slot]
    if (!preset) return
    this.settings.hotbar = [...preset]
    saveSettings(this.settings)
    this._updateHotbarHud()
    this._refreshInventoryPanel()
    this._showLoreToast(t('toastLoadoutLoaded', { n: slot + 1 }))
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.tpCamera.aspect = window.innerWidth / window.innerHeight
    this.tpCamera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
    this.bloomPass.resolution.set(window.innerWidth * BLOOM_RESOLUTION_SCALE, window.innerHeight * BLOOM_RESOLUTION_SCALE)
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
      const hits = this._tpRaycaster.intersectObjects(this.player.queryGroundMeshesNear(this.camera.position.x, this.camera.position.z), true)
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
    if (this.shieldActive) damage *= 1 - SHIELD_DAMAGE_REDUCTION
    this.playerState.takeDamage(damage * this.difficulty.damageMult * this.dailyDamageMult)
    this._updateHealthHud()
    audioEngine.playZombieSnarl()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.12, 220)
    this._showThreatIndicator()

    if (!this.playerState.alive) this._maybeLastStandOrDie()
  }

  // Boss-targets-companion (see ZombieManager's targetPos override) - only
  // ever includes companions that can actually take the hit: invulnerable
  // guards/vendor NPCs (vulnerable: false, see Companion.js's constructor
  // option) and already-downed/dead ones are excluded so a boss never
  // wastes its targeting on something that can't be hurt.
  _collectCompanionTargets() {
    const targets = []
    const candidates = [this.companion, this.tempCompanion, ...this.recruits]
    for (const c of candidates) {
      if (c && c.vulnerable && !c.downed && !c.dead) {
        targets.push({ x: c.group.position.x, z: c.group.position.z, takeDamage: (dmg) => c.takeDamage(dmg) })
      }
    }
    return targets
  }

  // Gunfire alerting (see GUNFIRE_ALERT_RADIUS/_SUPPRESSED and Zombie.js's
  // awareness system) - fired from WeaponSystem's onWeaponFired callback,
  // so this runs once per shot regardless of whether it actually connects.
  // Only ever flips unaware zombies to aware; never re-checked against
  // already-aware ones.
  _alertNearbyZombiesToGunfire() {
    const radius = this.weapons.current.suppressed ? GUNFIRE_ALERT_RADIUS_SUPPRESSED : GUNFIRE_ALERT_RADIUS
    const playerPos = this.player.controls.object.position
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive' || z.aware) continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d <= radius) z.aware = true
    }
  }

  // Visual Sound Cue Indicator (accessibility) - a screen-edge pulse toward
  // the nearest attacker, since _onZombieAttack doesn't know exactly which
  // zombie landed the hit (shared by every melee/ranged/boss attack path -
  // see ZombieManager's onPlayerDamage callback) and the nearest one is a
  // reasonable stand-in. Supplements audioEngine.playZombieSnarl() above for
  // players who can't rely on the sound alone to tell them where a hit came
  // from, especially one from off-screen/behind.
  // On-Demand Threat Ping (accessibility) - a player-initiated version of
  // the same screen-edge pulse _showThreatIndicator already shows
  // automatically on taking a hit, for proactively checking "where's the
  // nearest one" instead of only ever finding out reactively after being
  // hit. A toast fallback when nothing's alive yet, so the key always
  // gives some feedback rather than silently doing nothing.
  _pingNearestThreat() {
    const hasAliveZombie = this.zombies.zombies.some((z) => z.state === 'alive')
    if (!hasAliveZombie) {
      this._showLoreToast(t('threatPingNoneNearby'))
      return
    }
    this._showThreatIndicator()
  }

  _showThreatIndicator() {
    const playerPos = this.player.controls.object.position
    let nearest = null
    let nearestDist = Infinity
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d < nearestDist) {
        nearestDist = d
        nearest = z
      }
    }
    if (!nearest) return
    // Directional shake kick - punches the already-triggered shake (see
    // _onZombieAttack, called right before this) away from the attacker
    // instead of pure random noise, reusing this same nearest-zombie lookup
    // rather than a second scan.
    const awayX = (playerPos.x - nearest.group.position.x) / Math.max(0.001, nearestDist)
    const awayZ = (playerPos.z - nearest.group.position.z) / Math.max(0.001, nearestDist)
    this._shakeBiasX = awayX
    this._shakeBiasZ = awayZ
    this.camera.getWorldDirection(this._camDir)
    const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)
    const bearing = Math.atan2(nearest.group.position.x - playerPos.x, -(nearest.group.position.z - playerPos.z))
    let diff = bearing - facingRad
    diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
    // Placed on a ring around screen center rather than the compass strip's
    // narrow top-of-screen FOV band, specifically so an attacker behind the
    // player (diff near +-PI) still shows up, at the bottom of the ring.
    const radius = Math.min(window.innerWidth, window.innerHeight) * 0.38
    const x = window.innerWidth / 2 + Math.sin(diff) * radius
    const y = window.innerHeight / 2 - Math.cos(diff) * radius
    this.threatIndicator.style.left = `${x}px`
    this.threatIndicator.style.top = `${y}px`
    this.threatIndicator.classList.remove('show')
    void this.threatIndicator.offsetWidth
    this.threatIndicator.classList.add('show')
  }

  // Anchor zombie (see ZombieTypes.js's pullsPlayer) - its spit lands as a
  // pull instead of damage (see ZombieManager's projectile 'pull' effect).
  // Same direct-position-nudge approach as the Harpoon Gun's pull, just
  // moving the player toward the zombie instead of a zombie toward the
  // player, and clamped so it never overshoots into melee range.
  _onZombiePull(originX, originZ) {
    const pos = this.player.controls.object.position
    const dx = originX - pos.x
    const dz = originZ - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist <= 0.0001) return
    const pull = Math.min(4, Math.max(0, dist - 2))
    pos.x += (dx / dist) * pull
    pos.z += (dz / dist) * pull
  }

  // Shared by every damage source that can kill the player (zombie/rival
  // melee+ranged, gas/toxic hazard ticks, rockfall) - Last Stand gets one
  // chance per run regardless of which of those actually landed the blow.
  _maybeLastStandOrDie() {
    if (this._tryLastStand()) return
    this._onPlayerDeath()
  }

  // Last Stand - once per run, being "killed" instead drops the player into
  // a downed state: revived to 1 HP, locked to the pistol, crawl speed,
  // with a kill quota to claw back up before the window runs out for real
  // (checked in _updateKillstreakTimers, which already ticks every frame).
  _tryLastStand() {
    if (this.lastStandUsed) return false
    this.lastStandUsed = true
    this.playerState.alive = true
    this.playerState.health = 1
    this.playerDowned = true
    this.downedKillsNeeded = LAST_STAND_KILLS_NEEDED
    this.downedUntil = performance.now() + LAST_STAND_DURATION_MS
    this._preDownedMoveSpeed = this.player.moveSpeed
    this.player.moveSpeed *= LAST_STAND_SPEED_MULT
    const pistolIdx = this.weapons.weapons.findIndex((w) => w.id === 'pistol')
    if (pistolIdx >= 0) this.weapons.currentIndex = pistolIdx
    this._updateHealthHud()
    this._updateHotbarHud()
    this._showLoreToast(t('lastStandEntered', { n: LAST_STAND_KILLS_NEEDED }))
    return true
  }

  _reviveFromLastStand() {
    this.playerDowned = false
    this.downedUntil = 0
    this.playerState.health = Math.round(this.playerState.maxHealth * LAST_STAND_REVIVE_HEALTH_FRAC)
    if (this._preDownedMoveSpeed !== null) this.player.moveSpeed = this._preDownedMoveSpeed
    this._preDownedMoveSpeed = null
    this._updateHealthHud()
    this._showLoreToast(t('lastStandRevived'))
  }

  // Same damage/UI pipeline as _onZombieAttack, minus the zombie-specific
  // snarl sound - rival scavengers (see RivalScavenger.js) already play
  // their own gunshot when they fire.
  _onRivalAttack(damage) {
    if (this.player.isDodging) return
    this.lastHitTakenAt = performance.now()
    if (this.shieldActive) damage *= 1 - SHIELD_DAMAGE_REDUCTION
    this.playerState.takeDamage(damage * this.difficulty.damageMult * this.dailyDamageMult)
    this._updateHealthHud()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.1, 180)

    if (!this.playerState.alive) this._maybeLastStandOrDie()
  }

  // Camera juice: a brief random position jitter (see _updateShake, called
  // once per tick) plus an optional freeze-frame. Only overwrites the
  // current shake if the new one is stronger, so a big damage-taken shake
  // doesn't get cut short by a small hit-landed shake a moment later.
  // dirX/dirZ (both default 0, every pre-existing call site is unaffected)
  // bias the shake's jitter toward a direction instead of pure random noise
  // - see _showThreatIndicator's own bearing math, reused for "punch the
  // camera away from whatever just hit you" instead of pure noise.
  _triggerShake(magnitude, durationMs, dirX = 0, dirZ = 0) {
    if (magnitude < this._shakeMagnitude) return
    this._shakeMagnitude = magnitude
    this._shakeDuration = durationMs / 1000
    this._shakeTime = this._shakeDuration
    this._shakeBiasX = dirX
    this._shakeBiasZ = dirZ
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

  // Damage Number Popups - projected once at spawn (world -> screen space)
  // rather than re-projected every frame; the CSS keyframe (see style.css's
  // damageNumberRise) handles the rise/fade entirely on its own, so this
  // only ever runs once per hit instead of adding a per-frame update loop.
  // Capped so a minigun spray can't flood the DOM with hundreds of live
  // nodes - past the cap, hits just stop popping new numbers until old ones
  // finish animating out.
  _spawnDamageNumber(x, y, z, damage, isHeadshot) {
    // Biggest Hit (see _renderRunSummary) - tracked here rather than after
    // the display cap below, so a huge hit during a already-cluttered
    // minigun spray still counts even though its own number never
    // actually got to pop up on screen.
    if (damage > this.biggestHitThisRun) this.biggestHitThisRun = damage
    if (this._activeDamageNumbers >= DAMAGE_NUMBER_MAX_CONCURRENT) return
    this._damageNumberVec.set(x, y, z).project(this.camera)
    if (this._damageNumberVec.z > 1) return // behind the camera
    const sx = (this._damageNumberVec.x * 0.5 + 0.5) * window.innerWidth
    const sy = (-this._damageNumberVec.y * 0.5 + 0.5) * window.innerHeight
    const el = document.createElement('div')
    el.className = isHeadshot ? 'damage-number headshot' : 'damage-number'
    el.textContent = String(damage)
    el.style.left = `${sx}px`
    el.style.top = `${sy}px`
    this.damageNumbersEl.appendChild(el)
    this._activeDamageNumbers += 1
    el.addEventListener('animationend', () => {
      el.remove()
      this._activeDamageNumbers -= 1
    })
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
      // Motion Reduction (accessibility, see settings.shakeIntensity) -
      // scales every shake event down (or to exactly 0) without touching
      // any of the individual _triggerShake call sites' own magnitudes.
      const mag = this._shakeMagnitude * (this._shakeTime / this._shakeDuration) * (this.settings.shakeIntensity / 100)
      this._shakeOffset.set(
        (Math.random() - 0.5) * 2 * mag + (this._shakeBiasX || 0) * mag,
        (Math.random() - 0.5) * 2 * mag * 0.6,
        (Math.random() - 0.5) * 2 * mag + (this._shakeBiasZ || 0) * mag
      )
    } else {
      this._shakeOffset.set(0, 0, 0)
    }
  }

  // Landing camera dip (see PlayerController's lastLandingImpact/landingSeq)
  // - a one-shot downward snap consumed the instant a new landing shows up,
  // then springs back to 0 every subsequent frame. Deliberately a separate
  // offset from _shakeOffset above (composed together in _tick) rather than
  // folded into the shake system, since this is a fixed-direction dip, not
  // random jitter.
  _updateLandingDip(dt) {
    if (this.player.landingSeq !== this._lastSeenLandingSeq) {
      this._lastSeenLandingSeq = this.player.landingSeq
      const impact = this.player.lastLandingImpact
      if (impact < LANDING_DIP_MIN_IMPACT) {
        // Motion Reduction (see _updateShake's own note) applies here too.
        this._landingDipY = Math.max(-LANDING_DIP_MAX, impact * LANDING_DIP_SCALE) * (this.settings.shakeIntensity / 100)
      }
    }
    this._landingDipY = THREE.MathUtils.damp(this._landingDipY, 0, LANDING_DIP_RECOVER_SPEED, dt)
  }

  // Run Score Multiplier - reuses the existing on-screen combo counter
  // (this.comboCount, see _registerComboKill, already called just above
  // every point-award site) rather than a second parallel "kills close
  // together" tracker. Purely a points multiplier, no combat effect,
  // distinct from the killstreak reward thresholds (damage/ammo/airstrike).
  _comboMultiplier() {
    return Math.min(COMBO_MULT_CAP, 1 + Math.max(0, this.comboCount - 1) * COMBO_MULT_PER_KILL)
  }

  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering = false) {
    this.decals.spawnPuddle(x, z)
    this.kills += 1
    this.killStreak += 1
    if (this.killStreak > this.peakKillStreakThisRun) this.peakKillStreakThisRun = this.killStreak
    this._checkKillstreakReward()
    this.totalKills += 1
    this.killCountsThisRun[weaponId] = (this.killCountsThisRun[weaponId] || 0) + 1
    this._checkWeeklyChallengeProgress()
    // Last Stand - clawing back up under your own power, not a passive
    // timer-only wait (see _tryLastStand/downedKillsNeeded).
    if (this.playerDowned) {
      this.downedKillsNeeded -= 1
      if (this.downedKillsNeeded <= 0) this._reviveFromLastStand()
    }
    this.recentKillTimestamps.push(performance.now())
    // Corpse pile-up (see CORPSE_PILE_RADIUS's own comment) - capped so a
    // long run can't grow this array unbounded.
    this.recentKillSpots.push({ x, z, at: performance.now() })
    if (this.recentKillSpots.length > CORPSE_PILE_MAX_TRACKED) this.recentKillSpots.shift()
    // Wandering horde members (see ZombieManager's _maybeSpawnWanderingHorde)
    // are worth intercepting for their own sake rather than just background
    // population you happen to run into - a small guaranteed bonus per kill,
    // on top of (not instead of) the normal 25%-chance points roll below.
    if (isWandering) {
      this.points += 5
      this._updateStatsPanel()
    }
    const lootMult = (this.settings.mutators.lootRush ? 2 : 1) * this.difficulty.lootMult
    this.xpGems.spawn(x, z, (isElite ? 4 : 1) * lootMult)
    if (isElite) {
      this.eliteKills += 1
      if (this.eliteKills >= 5) {
        this.achievements.unlock('elite_hunter')
        // Milestone cosmetic unlock - same free-grant shape as
        // bestiary_master's obsidian skin below, just a different
        // achievement/skin pairing.
        if (!this.ownedSkins.has('crimson')) {
          this.ownedSkins.add('crimson')
          this._showLoreToast(t('crimsonSkinUnlocked'))
        }
      }
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
    // Field power-ups - independent of (not instead of) the guaranteed
    // every-10th-kill drop above, so they can land on any kill.
    if (Math.random() < POWERUP_DROP_CHANCE) {
      const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
      this.pickups.spawnLootDrop(powerupType, x, z)
    }
    this.achievements.unlock('first_blood')
    if (this.totalKills >= 100) this.achievements.unlock('centurion')
    if (zombieTypeId === 'fester') this._spawnHazardZone('gas', x, z)
    if (this.activeBounty && this.activeBounty.id === 'clear_location') {
      const dist = Math.hypot(x - this.activeBounty.locationX, z - this.activeBounty.locationZ)
      if (dist <= CLEAR_LOCATION_RADIUS) this._checkBountyProgress('clear_location', 1)
    }
    if (zombieTypeId === 'brute' && weaponId === 'melee') this.achievements.unlock('brute_knife')
    if (zombieTypeId === 'screamer') this._checkBountyProgress('kill_screamers', 1)
    this._checkTraderQuestKill()
    if (weaponId === 'melee') this._checkBountyProgress('melee_kills', 1)
    if (weaponId === 'minigun') {
      this.killCountsByWeapon.minigun = (this.killCountsByWeapon.minigun || 0) + 1
      if (this.killCountsByWeapon.minigun >= 50) {
        this.achievements.unlock('meat_grinder')
        if (!this.ownedSkins.has('cobalt')) {
          this.ownedSkins.add('cobalt')
          this._showLoreToast(t('cobaltSkinUnlocked'))
        }
      }
    }
    this._trackWeaponMastery(weaponId)
    this._checkWeaponChallenge(weaponId)
    if (Math.random() < 0.25) {
      const doublePointsMult = this.doublePointsUntil && performance.now() < this.doublePointsUntil ? 2 : 1
      this.points += (2 + Math.floor(Math.random() * 4)) * lootMult * doublePointsMult * this._comboMultiplier()
      this._updateStatsPanel()
    }

    // Coins: a separate, guaranteed-every-kill currency (unlike points'
    // 25%-chance drop) spent exclusively in the Coin Shop - see CoinShop.js.
    let coinsEarned
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      coinsEarned = 300 + Math.floor(Math.random() * 201)
      this._triggerBossKillcam()
      if (!this.narrativeStats.bossEpitaphsSeen.includes(zombieTypeId)) {
        this.narrativeStats.bossEpitaphsSeen.push(zombieTypeId)
        saveNarrativeStats(this.narrativeStats)
        this._showLoreToast(t(BOSS_EPITAPH_KEYS[zombieTypeId]))
      }
    } else if (isElite) {
      coinsEarned = 20 + Math.floor(Math.random() * 181)
    } else {
      coinsEarned = 10 + Math.floor(Math.random() * 91)
    }
    this.coins += coinsEarned
    this._showCoinPopup(coinsEarned)
    this._updateStatsPanel()
    this._maybeDropObstacle(x, z)

    // Boss Gauntlet mutator - the next boss walks in immediately on this
    // one's death, no waiting for the next night boundary. Checked
    // separately from the BOSS_TIER_IDS branch above (which only covers
    // colossus/titan for the epitaph/killcam reward) since _spawnBoss's own
    // alternation also treats broodmother as an equal boss slot.
    if (this.settings.mutators.bossGauntlet && BOSS_GAUNTLET_TYPE_IDS.has(zombieTypeId)) {
      this.zombies.spawnBossGauntletNext()
    }

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

    // Wave-Clear Finisher Cam - reuses the exact same killcamUntil slow-mo/
    // zoom mechanism _triggerBossKillcam already drives, just triggered by
    // "nothing left alive" instead of "that alive thing was a boss" - boss
    // kills are excluded here since _triggerBossKillcam above already fired
    // for those, and stacking both would just restart the same effect.
    if (!BOSS_TIER_IDS.has(zombieTypeId) && this.zombies.zombies.filter((z) => z.state === 'alive').length === 0) {
      this._triggerWaveClearedCam()
    }
  }

  _triggerWaveClearedCam() {
    this.killcamUntil = performance.now() + WAVE_CLEAR_KILLCAM_DURATION_MS
    this.nightBanner.textContent = t('toastWaveCleared')
    this.nightBanner.classList.remove('show')
    void this.nightBanner.offsetWidth
    this.nightBanner.classList.add('show')
  }

  // this.killStreak crosses each threshold exactly once per life (it only
  // ever grows until _onPlayerDeath resets it to 0), so these are true
  // one-shot triggers, not something to guard with a "already fired" flag.
  _checkKillstreakReward() {
    if (this.killStreak === KILLSTREAK_DAMAGE_THRESHOLD) {
      this.weapons.damageMult *= KILLSTREAK_DAMAGE_MULT
      this.killstreakDamageBoostUntil = performance.now() + KILLSTREAK_DAMAGE_DURATION_MS
      this._showLoreToast(t('killstreakDamageBoost'))
    } else if (this.killStreak === KILLSTREAK_AIRSTRIKE_THRESHOLD) {
      const pos = this.player.controls.object.position
      this.zombies.damageInRadius(pos.x, pos.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
      this._showLoreToast(t('killstreakAirstrike'))
    } else if (this.killStreak === KILLSTREAK_AMMO_THRESHOLD) {
      this.weapons.infiniteAmmo = true
      this.killstreakAmmoUntil = performance.now() + KILLSTREAK_AMMO_DURATION_MS
      this._showLoreToast(t('killstreakInfiniteAmmo'))
    }
  }

  // Reverts the two timed rewards above once their window closes - the
  // damage boost divides back out by the exact multiplier it was applied
  // with (rather than resetting damageMult to a fixed baseline), so it
  // can't clobber whatever other bonus (XP upgrade, mastery, coin shop
  // perk) was already stacked onto damageMult before this one landed.
  _updateKillstreakTimers() {
    const now = performance.now()
    if (this.killstreakDamageBoostUntil && now >= this.killstreakDamageBoostUntil) {
      this.weapons.damageMult /= KILLSTREAK_DAMAGE_MULT
      this.killstreakDamageBoostUntil = 0
    }
    if (this.killstreakAmmoUntil && now >= this.killstreakAmmoUntil) {
      this.weapons.infiniteAmmo = false
      this.killstreakAmmoUntil = 0
    }
    if (this.instakillUntil && now >= this.instakillUntil) {
      this.weapons.instakillActive = false
      this.instakillUntil = 0
    }
    if (this.cleaningKitUntil && now >= this.cleaningKitUntil) {
      this.weapons.jamChanceMult = 1
      this.cleaningKitUntil = 0
    }
    if (this.playerDowned && now >= this.downedUntil) {
      this.playerDowned = false
      this._onPlayerDeath()
    }
  }

  // Persistent per-weapon kill tally (see WeaponMastery.js) - only counts
  // toward mastery if weaponId actually names one of WeaponSystem's real
  // guns/melee slot, not an environmental kill source (trap/C4/vehicle/etc,
  // none of which have a matching weapons[] entry to apply a bonus to).
  _trackWeaponMastery(weaponId) {
    // Grandmaster (see WeaponMastery.js) is the real stopping point now -
    // kills need to keep tallying past the mastery threshold below for a
    // weapon to ever reach it.
    if (this.weaponMastery.grandmastered.has(weaponId)) return
    const w = this.weapons.weapons.find((w) => w.id === weaponId)
    if (!w) return

    this.weaponMastery.kills[weaponId] = (this.weaponMastery.kills[weaponId] || 0) + 1
    if (!this.weaponMastery.mastered.has(weaponId) && this.weaponMastery.kills[weaponId] >= MASTERY_THRESHOLD) {
      this.weaponMastery.mastered.add(weaponId)
      w.masteryMult = MASTERY_DAMAGE_MULT
      const loreKey = WEAPON_MASTERY_LORE_KEYS[weaponId]
      const masteredText = t('toastWeaponMastered', { weapon: t(this.weapons._nameKeyFor(w)) })
      this._showLoreToast(loreKey ? `${masteredText} ${t(loreKey)}` : masteredText)
    } else if (this.weaponMastery.mastered.has(weaponId) && this.weaponMastery.kills[weaponId] >= GRANDMASTER_THRESHOLD) {
      this.weaponMastery.grandmastered.add(weaponId)
      w.masteryMult = GRANDMASTER_DAMAGE_MULT
      this._showLoreToast(t('toastWeaponGrandmastered', { weapon: t(this.weapons._nameKeyFor(w)) }))
    }
    saveMastery(this.weaponMastery)
  }

  // Kill-milestone-with-this-specific-gun reward, distinct from weapon
  // mastery above (a flat damage bonus at a lower threshold, applies
  // silently) - this one is purely cosmetic and shows up immediately as a
  // reskin, same "kills earn a look" idea CoinShop's currency-bought skins
  // don't capture (those are bought, not earned).
  _checkWeaponChallenge(weaponId) {
    if (this.weaponChallengesUnlocked.has(weaponId)) return
    const w = this.weapons.weapons.find((w) => w.id === weaponId)
    if (!w || w.melee) return
    this.challengeKillCounts[weaponId] = (this.challengeKillCounts[weaponId] || 0) + 1
    if (this.challengeKillCounts[weaponId] < CHALLENGE_KILL_THRESHOLD) return
    this.weaponChallengesUnlocked.add(weaponId)
    this.weapons.setWeaponSkin(weaponId, 'veteran')
    this._showLoreToast(t('weaponChallengeUnlocked', { weapon: t(this.weapons._nameKeyFor(w)) }))
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
      // Nightmare-tier medallions (see NIGHTMARE_TIER_ACHIEVEMENT_IDS) glow
      // a distinct hot red-orange instead of the standard gold, so the
      // hardest-earned trophies visibly stand out on the same wall rather
      // than blending in as just more gold medallions.
      const isNightmareTier = NIGHTMARE_TIER_ACHIEVEMENT_IDS.has(ach.id)
      const unlockedColor = isNightmareTier ? 0xff4a2a : 0xffcf5c
      mat.color.setHex(unlocked ? unlockedColor : 0x1c1a16)
      mat.emissive.setHex(unlocked ? unlockedColor : 0x000000)
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

  // Companion bond dialogue - see COMPANION_BOND_THRESHOLDS_MS/bondTier1-3.
  // this.runStartedAt is a reasonable stand-in for "time with the main
  // companion specifically" since it's (re)created fresh alongside every
  // new run, same lifecycle as runStartedAt itself.
  _updateCompanionBond() {
    if (this.companionBondTier >= COMPANION_BOND_THRESHOLDS_MS.length) return
    const elapsed = performance.now() - this.runStartedAt
    if (elapsed >= COMPANION_BOND_THRESHOLDS_MS[this.companionBondTier]) {
      this.companionBondTier += 1
      this._companionBark(`bondTier${this.companionBondTier}`)
    }
  }

  _companionBark(pool) {
    const lines = COMPANION_BARKS[pool]
    const line = lines[Math.floor(Math.random() * lines.length)]
    this.companionBarkEl.textContent = line
    this.companionBarkEl.classList.remove('show')
    void this.companionBarkEl.offsetWidth
    this.companionBarkEl.classList.add('show')
  }

  // Rolled once per night alongside weather/mutation (see their own call
  // sites) - only when there's an actual squad to bounce lines between.
  _maybeSquadBanter() {
    if (this.recruits.length === 0) return
    if (Math.random() >= SQUAD_BANTER_CHANCE) return
    const exchange = SQUAD_BANTER_EXCHANGES[Math.floor(Math.random() * SQUAD_BANTER_EXCHANGES.length)]
    this.companionBarkEl.textContent = exchange[0]
    this.companionBarkEl.classList.remove('show')
    void this.companionBarkEl.offsetWidth
    this.companionBarkEl.classList.add('show')
    setTimeout(() => {
      this.companionBarkEl.textContent = exchange[1]
      this.companionBarkEl.classList.remove('show')
      void this.companionBarkEl.offsetWidth
      this.companionBarkEl.classList.add('show')
    }, SQUAD_BANTER_LINE_DELAY_MS)
  }

  // Fuller death-screen breakdown alongside the existing night/kills/time
  // line - top weapon (see killCountsThisRun's own doc comment) and total
  // damage taken this run (see PlayerState.totalDamageTaken).
  _renderRunSummary() {
    let topWeapon = null
    let topCount = 0
    for (const [weaponId, count] of Object.entries(this.killCountsThisRun)) {
      if (count > topCount) {
        topWeapon = weaponId
        topCount = count
      }
    }
    const weaponLabel = topWeapon ? t(`weapon${topWeapon.charAt(0).toUpperCase()}${topWeapon.slice(1)}`) : t('runSummaryNoKills')
    this.deathSummary.textContent = t('runSummaryLine', {
      weapon: weaponLabel,
      kills: topCount,
      damage: Math.round(this.playerState.totalDamageTaken),
    })
    this.deathGrade.textContent = t('runSummaryGrade', { grade: this._computeRunGrade() })

    // Run highlights - peak streak was already tracked (it feeds the grade
    // formula above) but never shown on its own line; biggest hit/closest
    // call are new this-run-only trackers (see _spawnDamageNumber/
    // _updateHealthHud). closestCall reads 0 (not Infinity) if the run
    // ended without ever taking damage at all.
    const closestCall = Number.isFinite(this.lowestHealthThisRun) ? Math.round(this.lowestHealthThisRun) : 0
    this.deathHighlights.textContent = t('runSummaryHighlights', {
      streak: this.peakKillStreakThisRun,
      hit: Math.round(this.biggestHitThisRun),
      closestCall,
    })
  }

  // Run Summary Grade - a single letter reading on how the run went,
  // rewarding kills/streak/depth and penalizing damage taken, folded onto
  // the existing death-summary breakdown rather than a separate screen.
  _computeRunGrade() {
    const score = this.kills * 3 + this.peakKillStreakThisRun * 2 + this.night * 20 - this.playerState.totalDamageTaken * 0.05
    if (score >= 400) return 'S'
    if (score >= 250) return 'A'
    if (score >= 150) return 'B'
    if (score >= 80) return 'C'
    return 'D'
  }

  // Shared by _onPlayerDeath and the survive-to-dawn/extraction win path -
  // both are "a run just ended" moments that should update every persistent
  // record (bestStats, career totals, Veteran Perks) the same way.
  _recordRunEnd() {
    let improved = false
    if (this.night > this.bestStats.bestNight) { this.bestStats.bestNight = this.night; improved = true }
    if (this.kills > this.bestStats.bestKills) { this.bestStats.bestKills = this.kills; improved = true }
    if (this.peakKillStreakThisRun > this.bestStats.bestKillStreak) { this.bestStats.bestKillStreak = this.peakKillStreakThisRun; improved = true }
    if (improved) {
      saveBestStats(this.bestStats)
      this._updateBestStatsDisplay()
    }
    this._recordLeaderboardEntry()

    this.careerStats.totalKills += this.kills
    this.careerStats.totalRuns += 1
    for (const perk of VETERAN_PERKS) {
      if (this.careerStats.totalKills >= perk.killThreshold && !this.careerStats.veteranPerksGranted.includes(perk.id)) {
        this.careerStats.veteranPerksGranted.push(perk.id)
        this._showLoreToast(t('veteranPerkToast', { rank: t(careerRankTitleKey(this.careerStats.totalKills)) }))
      }
    }
    saveCareerStats(this.careerStats)

    // Companion Legacy - grows +1 per completed run reaching
    // COMPANION_LEGACY_MIN_NIGHT, capped at COMPANION_LEGACY_MAX. Checked
    // here (the shared "a run just ended" hook, death or dawn-survival)
    // rather than only on death, so a good survive-to-dawn run counts too.
    if (this.night >= COMPANION_LEGACY_MIN_NIGHT && this.companionLegacy.level < COMPANION_LEGACY_MAX) {
      this.companionLegacy.level += 1
      saveCompanionLegacy(this.companionLegacy)
    }
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
    this.killStreak = 0
    // Dying mid-boost skips the timer's own revert entirely (nothing else
    // calls _updateKillstreakTimers between now and the next run), so
    // clean these up here too rather than risk a stuck damage multiplier
    // or free ammo carrying into the next life.
    if (this.killstreakDamageBoostUntil) {
      this.weapons.damageMult /= KILLSTREAK_DAMAGE_MULT
      this.killstreakDamageBoostUntil = 0
    }
    if (this.killstreakAmmoUntil) {
      this.weapons.infiniteAmmo = false
      this.killstreakAmmoUntil = 0
    }
    this._updateStatsPanel()
    if (this.totalDeaths === 1) this.achievements.unlock('first_death')
    if (this.settings.hardcoreMode || (this.dailyChallengeActive && this.dailyTwist.forceHardcore)) {
      this._recordHardcoreMemorial()
    }

    this._recordRunEnd()

    const elapsed = formatTime(performance.now() - this.runStartedAt)
    this.deathStats.textContent = t('deathStats', { night: this.night, kills: this.kills, time: elapsed })
    this._renderRunSummary()

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

    if (this.settings.endlessMode) {
      if (this.night > this.endlessBest) {
        this.endlessBest = this.night
        saveEndlessBest(this.endlessBest)
      }
      const milestonesReached = Math.floor(this.night / ENDLESS_MILESTONE_INTERVAL)
      if (milestonesReached > this.endlessMilestoneClaimed) {
        const reward = (milestonesReached - this.endlessMilestoneClaimed) * ENDLESS_MILESTONE_REWARD_COINS
        this.endlessMilestoneClaimed = milestonesReached
        saveEndlessMilestone(this.endlessMilestoneClaimed)
        this.coins += reward
        this._showLoreToast(t('endlessMilestoneToast', { night: milestonesReached * ENDLESS_MILESTONE_INTERVAL, coins: reward }))
      }
      this.deathEndless.textContent = t('endlessResult', { round: this.night, best: this.endlessBest })
      this.deathEndless.style.display = 'block'
    } else {
      this.deathEndless.style.display = 'none'
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
    else if (type === 'melee_fireaxe') this.weapons.setMeleeVariant('fireaxe')
    else if (type === 'melee_sledgehammer') this.weapons.setMeleeVariant('sledgehammer')
    else if (type === 'weapon_charm') this.weapons.equipCharm(WEAPON_CHARM_IDS[Math.floor(Math.random() * WEAPON_CHARM_IDS.length)])
    else if (type === 'ration') this.inventory.addRation(1)
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
    else if (type === 'double_points') {
      this.doublePointsUntil = performance.now() + DOUBLE_POINTS_DURATION_MS
      this._showLoreToast(t('powerupDoublePoints'))
      return
    }
    else if (type === 'nuke') {
      this.zombies.nukeAll()
      this._showLoreToast(t('powerupNuke'))
      return
    }
    else if (type === 'instakill') {
      this.weapons.instakillActive = true
      this.instakillUntil = performance.now() + INSTAKILL_DURATION_MS
      this._showLoreToast(t('powerupInstakill'))
      return
    }
    else if (type === 'zombie_blood') {
      this.zombies.invisibleUntil = performance.now() + ZOMBIE_BLOOD_DURATION_MS
      this._showLoreToast(t('powerupZombieBlood'))
      return
    }
    else if (type === 'cleaning_kit') {
      this.weapons.jamChanceMult = CLEANING_KIT_JAM_MULT
      this.cleaningKitUntil = performance.now() + CLEANING_KIT_DURATION_MS
      this._showLoreToast(t('powerupCleaningKit'))
      return
    }
    else if (type.startsWith('audiolog')) {
      audioEngine.playAudioLog()
      this._showLoreToast(t(`lore${type.charAt(0).toUpperCase()}${type.slice(1)}`))
      this.audioLogsFound.add(type)
      if (this.audioLogsFound.size >= 8) this.achievements.unlock('full_story')
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
    this.shieldCount.textContent = this.inventory.shields
    this.knifeCount.textContent = this.inventory.throwingKnives
    this.turretkitCount.textContent = this.inventory.turretKits
    this.alarmkitCount.textContent = this.inventory.alarmKits
    this.rationCount.textContent = this.inventory.rations
    this.barricadeCount.textContent = this.inventory.barricades
    this.trapCount.textContent = this.inventory.traps
    this.molotovCount.textContent = this.inventory.molotovs
    this.c4Count.textContent = this.inventory.c4
    this.adrenalineCount.textContent = this.inventory.adrenaline
    this.empCount.textContent = this.inventory.emp
  }

  _updateHealthHud() {
    const s = this.playerState
    // Closest Call (see _renderRunSummary) - a running minimum, gated to
    // s.health > 0 so a fatal hit (the last health value seen right before
    // death) doesn't get mistaken for "a close call you survived."
    if (s.health > 0 && s.health < this.lowestHealthThisRun) this.lowestHealthThisRun = s.health
    // Called every frame - skip the DOM write entirely when the rounded
    // displayed value hasn't actually changed since last frame, instead
    // of unconditionally touching style/textContent 60 times a second
    // for numbers that are usually not moving at all.
    const healthRounded = Math.round(s.health)
    if (healthRounded !== this._lastHudHealth) {
      this._lastHudHealth = healthRounded
      this.healthFill.style.width = `${(s.health / s.maxHealth) * 100}%`
      this.healthValue.textContent = healthRounded
    }
    const armorRounded = Math.round(s.armor)
    if (armorRounded !== this._lastHudArmor) {
      this._lastHudArmor = armorRounded
      this.armorFill.style.width = `${(s.armor / s.maxArmor) * 100}%`
      this.armorValue.textContent = armorRounded
    }
    const lowHealth = s.health > 0 && s.health < 30
    this.damageFlash.classList.toggle('low-health', lowHealth)
    // Critical-health blood-edge overlay - a further escalation past the
    // low-health pulse above, at a lower threshold, own visual treatment.
    this.criticalBloodOverlay.classList.toggle('show', s.health > 0 && s.health < CRITICAL_HEALTH_THRESHOLD)
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
    // Called every frame, but none of these need sub-frame precision -
    // aliveCount() in particular is a real O(zombies) scan just to
    // refresh a text label, not worth doing 60 times a second. Throttled
    // to every ~200ms instead.
    const now = performance.now()
    if (now < (this._nextProgressHudAt || 0)) return
    this._nextProgressHudAt = now + 200

    this.nightValueEl.textContent = t('hudNight', { n: this.night })
    // Round Mode advances on a kill-clear, not a clock - showing the
    // elapsed-run timer there is misleading (it has no relationship to when
    // the round actually ends), so swap it for the number that does.
    this.timeValueEl.textContent = this._isRoundMode()
      ? `${this.zombies.aliveCount()} left`
      : formatTime(now - this.runStartedAt)
    this.killsValueEl.textContent = t('hudKills', { n: this.kills })
  }

  _updateStaminaHud() {
    // Same "skip if unchanged" guard as _updateHealthHud - called every
    // frame, but stamina is often sitting still at max/empty for long
    // stretches.
    const staminaRounded = Math.round(this.player.stamina)
    if (staminaRounded === this._lastHudStamina) return
    this._lastHudStamina = staminaRounded
    this.staminaFill.style.width = `${(this.player.stamina / this.player.maxStamina) * 100}%`
    this.staminaValue.textContent = staminaRounded
  }

  // Ticks hunger down over real playtime and applies a light passive drain
  // while empty (see HUNGER_STARVE_DPS's own doc comment) - never an
  // instant threat, just a reason to keep a Ration or two in reserve.
  _updateHunger(dt) {
    this.hunger = Math.max(0, this.hunger - HUNGER_DECAY_PER_SEC * dt)
    if (this.hunger <= 0 && this.playerState.alive) {
      this.playerState.takeDamage(HUNGER_STARVE_DPS * dt)
      this._updateHealthHud()
      if (!this.playerState.alive) this._maybeLastStandOrDie()
    }
    this._updateHungerHud()
  }

  _updateHungerHud() {
    const hungerRounded = Math.round(this.hunger)
    if (hungerRounded === this._lastHudHunger) return
    this._lastHudHunger = hungerRounded
    this.hungerFill.style.width = `${(this.hunger / this.maxHunger) * 100}%`
    this.hungerValue.textContent = hungerRounded
  }

  // Thirst - same shape as _updateHunger above.
  _updateThirst(dt) {
    this.thirst = Math.max(0, this.thirst - THIRST_DECAY_PER_SEC * dt)
    if (this.thirst <= 0 && this.playerState.alive) {
      this.playerState.takeDamage(THIRST_DEHYDRATE_DPS * dt)
      this._updateHealthHud()
      if (!this.playerState.alive) this._maybeLastStandOrDie()
    }
    this._updateThirstHud()
  }

  _updateThirstHud() {
    const thirstRounded = Math.round(this.thirst)
    if (thirstRounded === this._lastHudThirst) return
    this._lastHudThirst = thirstRounded
    this.thirstFill.style.width = `${(this.thirst / this.maxThirst) * 100}%`
    this.thirstValue.textContent = thirstRounded
  }

  _drinkWater() {
    if (!this.inventory.useWaterBottle()) {
      this._showLoreToast(t('toastNoWater'))
      return
    }
    this.thirst = Math.min(this.maxThirst, this.thirst + WATER_THIRST_RESTORE)
    this._updateThirstHud()
    this._updateInventoryHud()
  }

  // Temperature/Exposure - drifts toward 0 while rained on or outdoors at
  // night, toward 100 while indoors or in daylight; no consumable, shelter/
  // timing is the only counterplay. Low warmth softens stamina regen
  // (see PlayerController's warmthStaminaMult) rather than dealing damage
  // outright - a real penalty, not a second death timer stacked on Hunger/
  // Thirst's already-lethal-if-ignored drains.
  _updateWarmth(dt) {
    const isNight = this.dayNight ? this.dayNight.getPhaseInfo().phase === 'Night' : false
    const warming = this.isIndoors || !isNight
    const target = this.raining ? 0 : warming ? 100 : 0
    const step = WARMTH_DRIFT_PER_SEC * dt
    this.warmth = target > this.warmth ? Math.min(target, this.warmth + step) : Math.max(target, this.warmth - step)
    this.player.warmthStaminaMult = this.warmth < WARMTH_LOW_THRESHOLD ? WARMTH_STAMINA_REGEN_MULT : 1
    this._updateWarmthHud()
  }

  _updateWarmthHud() {
    const warmthRounded = Math.round(this.warmth)
    if (warmthRounded === this._lastHudWarmth) return
    this._lastHudWarmth = warmthRounded
    this.warmthFill.style.width = `${this.warmth}%`
    this.warmthValue.textContent = warmthRounded
  }

  // Slows the player while standing in a cluster of recent kills - see
  // CORPSE_PILE_RADIUS's own comment for why this is computed fresh every
  // frame instead of a persistent hazard-zone-style object.
  _updateCorpsePileSlow(playerPos) {
    const now = performance.now()
    this.recentKillSpots = this.recentKillSpots.filter((k) => now - k.at < CORPSE_PILE_WINDOW_MS)
    let nearbyCount = 0
    for (const k of this.recentKillSpots) {
      if (Math.hypot(playerPos.x - k.x, playerPos.z - k.z) <= CORPSE_PILE_RADIUS) nearbyCount++
    }
    this.player.corpsePileMult = nearbyCount >= CORPSE_PILE_MIN_KILLS ? CORPSE_PILE_SPEED_MULT : 1
  }

  _eatRation() {
    if (!this.inventory.useRation()) {
      this._showLoreToast(t('toastNoRations'))
      return
    }
    this.hunger = Math.min(this.maxHunger, this.hunger + RATION_HUNGER_RESTORE)
    this._updateHungerHud()
    this._updateInventoryHud()
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
      const nameEl = this.hotbarNameEls[i]
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
      if (!this.player.controls.isLocked || !this.playerState.alive || this.inventoryOpen || this.driving || this.weaponWheelOpen || this.playerDowned) return
      const digitIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code)
      if (digitIndex === -1) return
      const weaponId = this.settings.hotbar[digitIndex]
      if (!weaponId) return
      const index = this.weapons.weapons.findIndex((w) => w.id === weaponId)
      // Explicit immediate refresh (not the throttled per-frame one - see
      // its own note) so the hotbar's active-slot highlight switches
      // instantly, not up to 200ms later.
      if (index !== -1) {
        this.weapons.switchToIndex(index)
        this._updateHotbarHud()
      }
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
    // Career Rank HUD badge - the same title menuCareerRank already shows
    // on the main menu, kept visible during gameplay too instead of only
    // being checkable from the menu between runs.
    if (this.statsRankRow) {
      if (this.careerStats.totalKills > 0) {
        this.statsRankRow.style.display = ''
        this.statsRank.textContent = t(careerRankTitleKey(this.careerStats.totalKills))
      } else {
        this.statsRankRow.style.display = 'none'
      }
    }

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

  // Round Mode isn't a separate opt-in toggle on Easy/Normal - it's just
  // what those two difficulties do instead of the 90s timer. Hard/Nightmare
  // keep the timed loop normally, since that's where the tighter
  // time-pressure pacing is meant to bite - EXCEPT Endless Mode explicitly
  // wants the opposite: an uncapped kill-the-wave climb regardless of which
  // difficulty (and its zombie health/elite/loot tuning) is selected, so a
  // Nightmare-difficulty Endless run is deliberately possible.
  _isRoundMode() {
    return this.settings.endlessMode || this.settings.difficulty === 'easy' || this.settings.difficulty === 'normal'
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

  // Rolled once per night-round: a chance of rain OR snow for the whole
  // round (mutually exclusive - one weather state at a time), lower
  // visibility (see the fog scaling in _applyFogState) plus the matching
  // screen overlay. Snow is deliberately lighter than rain (no thunder,
  // smaller fog reduction) so it reads as a calmer, colder night rather
  // than reskinned rain.
  _rollWeather() {
    const roll = Math.random()
    this.raining = roll < 0.3
    this.snowing = !this.raining && roll < 0.45
    this.rainOverlayEl.style.display = this.raining ? 'block' : 'none'
    this.snowOverlayEl.style.display = this.snowing ? 'block' : 'none'
    this.nextLightningAt = this.raining ? performance.now() + LIGHTNING_MIN_DELAY_MS + Math.random() * LIGHTNING_DELAY_RANGE_MS : 0
  }

  // Rolled once per night-round, same cadence as _rollWeather - see
  // NightEvents.js's NIGHT_MUTATIONS for what each one does. Always
  // recomputed from this.difficulty.healthMult fresh (never multiplied in
  // place) so a mutation can never compound across nights or fight with
  // the difficulty setting's own value.
  _rollNightMutation() {
    // Rain masks noise/scent - folded in as a flat multiplier on top of
    // whatever the mutation roll already produced (or the 1 baseline)
    // rather than a special case, so it stacks the same way for every
    // mutation instead of only working on nights with no mutation active.
    const rainMult = this.raining ? RAIN_AGGRO_RADIUS_MULT : 1
    if (Math.random() < NIGHT_MUTATION_CHANCE) {
      this.nightMutation = NIGHT_MUTATIONS[Math.floor(Math.random() * NIGHT_MUTATIONS.length)]
      this.zombies.healthMult = this.difficulty.healthMult * (this.nightMutation.healthMult || 1)
      this.zombies.aggroRadiusMult = (this.nightMutation.aggroRadiusMult || 1) * rainMult
      this.zombies.speedMult = this.nightMutation.speedMult || 1
      this._showLoreToast(t(this.nightMutation.labelKey))
    } else {
      this.nightMutation = null
      this.zombies.healthMult = this.difficulty.healthMult
      this.zombies.aggroRadiusMult = rainMult
      this.zombies.speedMult = 1
    }
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

  }

  // Recomputes fog.near/far fresh from the base distance every frame,
  // instead of repeatedly *=-ing whatever the CURRENT value already is
  // (the old approach - see the constructor's _baseFogNear/_baseFogFar
  // note for why that was a real bug: it compounds toward zero the whole
  // time rain or a fog patch is active, and never recovers afterward,
  // since nothing ever restored the original value). Rain and a fog
  // patch can stack (both active at once = extra foggy), matching what
  // the old code seemed to intend, just without the runaway compounding.
  _applyFogState() {
    let mult = 1
    if (this.raining) mult *= 0.6
    if (this.snowing) mult *= 0.75
    if (this.fogPatch) {
      const pos = this.player.controls.object.position
      const dist = Math.hypot(pos.x - this.fogPatch.x, pos.z - this.fogPatch.z)
      if (dist <= FOG_PATCH_RADIUS) mult *= FOG_PATCH_MULT
    }
    this.scene.fog.near = this._baseFogNear * mult
    this.scene.fog.far = this._baseFogFar * mult
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
    const crateMat = flatMaterial({ color: 0x3a3226, roughness: 0.85 })
    const trimMat = flatMaterial({ color: 0x2a2018, roughness: 0.7, metalness: 0.3, emissive: 0xffe680, emissiveIntensity: 0.35 })
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
    let nearestDist = Infinity
    let nearestZombie = null
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d < 22) nearbyCount++
      if (d < nearestDist) {
        nearestDist = d
        nearestZombie = z
      }
    }
    let threat = Math.min(1, nearbyCount / 8)
    if (this.zombies.zombies.some((z) => z.isBoss && z.state === 'alive')) threat = Math.max(threat, 0.8)
    const healthFrac = this.playerState.maxHealth > 0 ? this.playerState.health / this.playerState.maxHealth : 1
    if (healthFrac < 0.3) threat = Math.max(threat, 0.7)

    this.musicIntensityCurrent = THREE.MathUtils.lerp(this.musicIntensityCurrent, threat, 0.04)
    audioEngine.setMusicIntensity(this.musicIntensityCurrent)

    // Directional Zombie Ambience Bed (see Audio.js's updateZombiePresence) -
    // reuses the nearest-zombie/nearby-count values already computed above
    // rather than a second scan over every zombie.
    let pan = 0
    if (nearestZombie) {
      this.camera.getWorldDirection(this._camDir)
      const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)
      const bearing = Math.atan2(nearestZombie.group.position.x - playerPos.x, -(nearestZombie.group.position.z - playerPos.z))
      let diff = bearing - facingRad
      diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
      pan = Math.sin(diff)
    }
    audioEngine.updateZombiePresence(Math.min(1, nearbyCount / 6), pan)
  }

  // Indoor detection (see Audio.js's playFootstep muffled param) - a
  // straight-up raycast against solidMeshes; a roof/ceiling within
  // INDOOR_RAY_MAX_DIST reads as "under cover." Throttled rather than
  // per-frame since this only ever changes when the player actually crosses
  // a doorway or roofline.
  // Wet-street sheen - a single large semi-transparent plane that follows
  // the player's XZ position (the real 750-unit ground plane's own
  // material isn't returned from buildWorld, so this rides on top of it
  // instead of trying to reach in and mutate it), faded in during rain for
  // a cheap "wet asphalt" glint rather than real planar reflections.
  _buildWetStreetSheen() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0a0e12,
      roughness: 0.15,
      metalness: 0.6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.wetStreetSheen = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mat)
    this.wetStreetSheen.rotation.x = -Math.PI / 2
    this.wetStreetSheen.position.y = 0.03
    this.scene.add(this.wetStreetSheen)
  }

  _updateWetStreetSheen(playerPos, dt) {
    this.wetStreetSheen.position.x = playerPos.x
    this.wetStreetSheen.position.z = playerPos.z
    const target = this.raining ? 0.16 : 0
    this.wetStreetSheen.material.opacity = THREE.MathUtils.damp(this.wetStreetSheen.material.opacity, target, 3, dt)
  }

  // Visible moon disc + star field - the existing "moon" (see World.js) is
  // only ever an invisible DirectionalLight; this adds an actual visible
  // disc far along that same light direction, plus a static star Points
  // cloud, both toggled by night phase alone (no smooth dayFactor - that's
  // internal to DayNightCycle - so this just matches its own Night/Day
  // phase check instead of exposing a new field there).
  _buildNightSky() {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32)
    grad.addColorStop(0, 'rgba(230, 235, 245, 0.95)')
    grad.addColorStop(0.5, 'rgba(210, 220, 240, 0.35)')
    grad.addColorStop(1, 'rgba(210, 220, 240, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
    const moonMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, depthWrite: false, fog: false })
    this.moonSprite = new THREE.Sprite(moonMat)
    this.moonSprite.scale.set(40, 40, 1)
    this.moonSprite.position.set(300, 450, -150)
    this.moonSprite.renderOrder = -1
    this.scene.add(this.moonSprite)

    const starCount = 400
    const positions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI * 0.45 // upper dome only
      const r = 480
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r
      positions[i * 3 + 1] = Math.cos(phi) * r
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.8, depthWrite: false, fog: false })
    this.starField = new THREE.Points(starGeo, starMat)
    this.scene.add(this.starField)
  }

  _updateNightSky() {
    const isNight = this.dayNight ? this.dayNight.getPhaseInfo().phase === 'Night' : false
    this.moonSprite.visible = isNight
    this.starField.visible = isNight
  }

  // Wind-driven prop sway - the 4 seasonal safe-zone banners (see
  // _applySeasonalDressing) were purely static before this, just recolored
  // per season. Each banner's own array index offsets its phase so all 4
  // don't sway in lockstep.
  _updateBannerSway(elapsed) {
    if (!this.seasonalBanners) return
    for (let i = 0; i < this.seasonalBanners.length; i++) {
      const banner = this.seasonalBanners[i]
      banner.rotation.z = Math.sin(elapsed * 1.3 + i * 1.7) * 0.12
      banner.rotation.y = Math.sin(elapsed * 0.9 + i * 2.3) * 0.08
    }
  }

  _updateIndoorDetection(playerPos) {
    const now = performance.now()
    if (now < this.nextIndoorCheckAt) return
    this.nextIndoorCheckAt = now + INDOOR_CHECK_INTERVAL_MS
    this._indoorRaycaster.ray.origin.set(playerPos.x, playerPos.y + 0.2, playerPos.z)
    const hits = this._indoorRaycaster.intersectObjects(this.solidMeshes, true)
    this.isIndoors = hits.length > 0
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
  // Squad Formation Toggle - "Hold Position" freezes the companion/temp
  // companion/every recruit at wherever the player is standing right now
  // (see the squadTargetPos substitution in the main tick); "Follow" (the
  // default) goes right back to chasing the real player.
  _toggleSquadHold() {
    this.squadHoldPosition = !this.squadHoldPosition
    if (this.squadHoldPosition) {
      const pos = this.player.controls.object.position
      this.squadHoldAnchor = { x: pos.x, z: pos.z }
      this._showLoreToast(t('squadHoldToast'))
    } else {
      this._showLoreToast(t('squadFollowToast'))
    }
  }

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
        this.narrativeStats.lost += 1
        saveNarrativeStats(this.narrativeStats)
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
    // different reward instead. cell.floorY is 0 for every ground-level
    // door (the only kind that existed before Stage 13's underground
    // speakeasy door), so this is unchanged for all of them.
    this.chests.addChest(cell.x, cell.floorY || 0, cell.z, cell.lootWeights || { rare_weapon: 10, legendary_weapon: 3 })
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
    // Performance Mode (see _applyPerformanceMode) shrinks all three of
    // these together via _perfDistanceMult - fewer rendered objects, fewer
    // shadow casters, and fewer active lights all at once, not just the
    // resolution/shadow-map/bloom toggles alone.
    const cullSq = (WORLD_CULL_DISTANCE * this._perfDistanceMult) ** 2
    const shadowSq = (WORLD_SHADOW_CULL_DISTANCE * this._perfDistanceMult) ** 2
    // Classic forward rendering (no light clustering) means every visible
    // fragment's shader evaluates every VISIBLE scene light, regardless of
    // distance - confirmed live at 62 PointLights across the map (rib
    // lights, streetlamps, beacons). Every one of World.js's flickerLights
    // has a real illumination range of 30 units or less (checked every
    // `new THREE.PointLight(...)` call site building this array), so a
    // light more than LIGHT_CULL_DISTANCE from the player cannot possibly
    // be lighting anything the player could currently see - turning it
    // fully off (not just intensity=0, which still costs a shader
    // evaluation) is a real, not approximate, render-cost cut.
    const lightCullSq = (LIGHT_CULL_DISTANCE * this._perfDistanceMult) ** 2
    for (const f of this.flickerLights) {
      const dx = f.light.position.x - playerPos.x
      const dz = f.light.position.z - playerPos.z
      f.light.visible = (dx * dx + dz * dz) < lightCullSq
    }
    for (const obj of this.cullables) {
      const dx = obj.position.x - playerPos.x
      const dz = obj.position.z - playerPos.z
      const distSq = dx * dx + dz * dz
      obj.visible = distSq < cullSq
      const wantsShadow = distSq < shadowSq
      if (obj.castShadow !== wantsShadow) obj.castShadow = wantsShadow
      if (obj.isMesh) continue
      // Cullable Groups (composite props/buildings) need their castShadow
      // flag propagated to every mesh child - the hierarchy itself never
      // changes shape after construction, so the flat mesh list is resolved
      // once via .traverse() and reused every frame after, instead of
      // re-walking the whole subtree from scratch every single frame.
      let meshChildren = this._cullShadowMeshCache.get(obj)
      if (!meshChildren) {
        meshChildren = []
        obj.traverse((child) => { if (child.isMesh) meshChildren.push(child) })
        this._cullShadowMeshCache.set(obj, meshChildren)
      }
      for (const child of meshChildren) {
        if (child.castShadow !== wantsShadow) child.castShadow = wantsShadow
      }
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

  // Stage 11's toxic water + slippery walkway. Same tick-damage shape as
  // _updateHazardZones' 'gas' case (HAZARD_TICK_MS interval, dodge grants
  // the same brief invincibility, same damage-flash/death handling) but
  // this zone is a fixed rectangle rather than a spawned/expiring one, so
  // it's checked directly here instead of going through the hazardZones
  // array. The walkway is the same rectangle at the same Z range, narrower
  // in X - being inside it takes priority (safe + slippery) over the wider
  // pool bounds around it (unsafe, normal traction).
  _updateToxicWater(dt, playerPos) {
    const pool = this.toxicSewerLevel.poolBounds
    const walkway = this.toxicSewerLevel.walkwayBounds
    const inPoolZ = playerPos.z <= pool.zMax && playerPos.z >= pool.zMin
    const inWalkway = inPoolZ && playerPos.x >= walkway.xMin && playerPos.x <= walkway.xMax
    const inOpenWater = inPoolZ && !inWalkway && playerPos.x >= pool.xMin && playerPos.x <= pool.xMax

    this.player.slipFactor = inWalkway ? 0.8 : 0

    if (!inOpenWater) return
    const now = performance.now()
    if (now < this.nextToxicTickAt) return
    this.nextToxicTickAt = now + HAZARD_TICK_MS
    if (this.player.isDodging) return // brief invincibility window, same as a zombie hit
    this.playerState.takeDamage(HAZARD_GAS_DAMAGE_PER_TICK)
    this._updateHealthHud()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    if (!this.playerState.alive) this._maybeLastStandOrDie()
  }

  // Stage 12's "rockfall" - unlike the sewer's toxic pool (continuous
  // per-tick damage over a whole zone), each unstable beam is a one-time
  // proximity trigger: walk within range once and it goes off for good,
  // dealing a single burst of damage and permanently narrowing the shaft
  // with a rubble pile instead of just flashing damage and moving on.
  _updateMineHazards(playerPos) {
    for (const beam of this.mineLevel.beams) {
      if (beam.triggered) continue
      const dist = Math.hypot(playerPos.x - beam.x, playerPos.z - beam.z)
      if (dist <= ROCKFALL_TRIGGER_RADIUS) this._triggerRockfall(beam)
    }
  }

  _triggerRockfall(beam) {
    beam.triggered = true
    beam.beam.material.color.setHex(0x1a1410)
    beam.beam.rotation.z = 0.3 // sags instead of standing straight once it's given way
    beam.warnMark.visible = false

    const rubbleMat = flatMaterial({ color: 0x352c22, roughness: 1 })
    for (const [rx, s] of [[-0.9, 0.45], [-0.5, 0.3], [-1.2, 0.35]]) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s), rubbleMat)
      rock.position.set(beam.x + rx, beam.floorY + s * 0.6, beam.z + (Math.random() - 0.5) * 0.6)
      rock.castShadow = true
      this.scene.add(rock)
    }
    // Narrows (never fully seals) the shaft on one side only - half the
    // mine's own width stays clear on the other side, always enough room
    // for the player's small collision radius to pass.
    const rubbleHalfWidth = this.mineLevel.mineWidth / 4
    const rubbleCollider = new THREE.Box3(
      new THREE.Vector3(beam.x - this.mineLevel.mineWidth / 2, beam.floorY, beam.z - 0.9),
      new THREE.Vector3(beam.x - this.mineLevel.mineWidth / 2 + rubbleHalfWidth * 2, beam.floorY + 0.9, beam.z + 0.9)
    )
    this.colliders.push(rubbleCollider)

    const flashLight = new THREE.PointLight(0xffb347, 2.5, 8, 2)
    flashLight.position.set(beam.x, beam.floorY + 1.5, beam.z)
    this.scene.add(flashLight)
    setTimeout(() => this.scene.remove(flashLight), 250)

    if (!this.player.isDodging) {
      this.playerState.takeDamage(ROCKFALL_BURST_DAMAGE)
      this._updateHealthHud()
      this.damageFlash.classList.remove('hit')
      void this.damageFlash.offsetWidth
      this.damageFlash.classList.add('hit')
      if (!this.playerState.alive) this._maybeLastStandOrDie()
    }
    this._showLoreToast(t('toastRockfall'))
  }

  _updateTrader(playerPos) {
    const dist = Math.hypot(playerPos.x - this.trader.x, playerPos.z - this.trader.z)
    this.nearTrader = dist <= TRADER_INTERACT_RADIUS
  }

  _updateUpgradeMachine(playerPos) {
    const dist = Math.hypot(playerPos.x - this.upgradeMachine.x, playerPos.z - this.upgradeMachine.z)
    this.nearUpgradeMachine = dist <= UPGRADE_MACHINE_RADIUS
  }

  _updateMysteryBox(playerPos) {
    const dist = Math.hypot(playerPos.x - this.mysteryBox.x, playerPos.z - this.mysteryBox.z)
    this.nearMysteryBox = dist <= MYSTERY_BOX_RADIUS
  }

  // Weapon Upgrade Machine - cost scales up each use this run (see
  // UPGRADE_MACHINE_MULT), capped per night so the same night's points
  // grind can't buy an unlimited stack of boosts on one gun.
  _tryUpgradeWeapon() {
    if (this.upgradeMachineUsesThisNight >= UPGRADE_MACHINE_USES_PER_NIGHT) {
      this._showLoreToast(t('upgradeMachineOutOfUses'))
      return
    }
    const w = this.weapons.current
    if (w.melee) {
      this._showLoreToast(t('upgradeMachineNoMelee'))
      return
    }
    const cost = Math.round(UPGRADE_MACHINE_BASE_COST * Math.pow(UPGRADE_MACHINE_MULT, this.upgradeMachineUsesThisNight))
    if (this.points < cost) {
      this._showLoreToast(t('upgradeMachineNotEnoughPoints', { n: cost }))
      return
    }
    this.points -= cost
    this.upgradeMachineUsesThisNight += 1
    this.weapons.boostUpgradeMult(w.id, 1.5)
    this._updateStatsPanel()
    this._showLoreToast(t('upgradeMachineSuccess', { weapon: t(this.weapons._nameKeyFor(w)) }))
  }

  // Mystery Box - flat cost, no per-night cap (unlike the upgrade machine
  // above) since the whole point is being able to re-roll if the random
  // pick isn't what you wanted.
  _tryMysteryBox() {
    if (this.points < MYSTERY_BOX_COST) {
      this._showLoreToast(t('mysteryBoxNotEnoughPoints', { n: MYSTERY_BOX_COST }))
      return
    }
    this.points -= MYSTERY_BOX_COST
    const candidates = this.weapons.weapons.filter((w) => !w.melee)
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    this.weapons.markUnlocked(pick.id)
    this.weapons.currentIndex = this.weapons.weapons.indexOf(pick)
    this._updateStatsPanel()
    this._updateHotbarHud()
    this._showLoreToast(t('mysteryBoxResult', { weapon: t(this.weapons._nameKeyFor(pick)) }))
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

  // Health Regen mutator - reuses lastHitTakenAt (already tracked for the
  // Director AI's own "brief relief window right after a hit" scoring),
  // rather than a second timestamp doing the same job.
  _updateHealthRegen(dt) {
    if (!this.playerState.alive || this.playerState.health >= this.playerState.maxHealth) return
    const secsSinceHit = (performance.now() - this.lastHitTakenAt) / 1000
    if (secsSinceHit < HEALTH_REGEN_DELAY_SEC) return
    this.playerState.heal(HEALTH_REGEN_PER_SEC * dt)
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

  // Base building (see CoinShop.js's 'turret' item) - a genuine placed prop
  // rather than another Companion instance, so it reads as base
  // infrastructure being built up rather than just another guard hired.
  // Only ever built once - _applyCoinShopPerks() re-calls this on every
  // fresh page load for an already-owned turret, and this.turret already
  // existing would just mean building a second one, so guard against that.
  _buildAutoTurret() {
    if (this.turret) return
    this.turret = new Turret(this.scene, this.safeZone.x + 2, this.safeZone.z + 4)
  }

  // Coin Shop 'base_walls' perk - decorative sandbag ring around the safe
  // zone, plus a real Zones.js density reduction (see Zones.js's own doc
  // comment) while the player's standing near it. Purely additive, no
  // collision registered - avoids the rotated-mesh AABB inflation and
  // safe-zone-coordinate gotchas that hand-authored colliders near the
  // safe zone have hit before in this codebase.
  _buildBaseWalls() {
    if (this.baseWallsBuilt) return
    this.baseWallsBuilt = true
    const sandbagMat = flatMaterial({ color: 0x5a5138, roughness: 1 })
    const radius = 11
    const postCount = 10
    for (let i = 0; i < postCount; i++) {
      const angle = (i / postCount) * Math.PI * 2
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.55), sandbagMat)
      bag.position.set(this.safeZone.x + Math.cos(angle) * radius, 0.25, this.safeZone.z + Math.sin(angle) * radius)
      bag.rotation.y = angle
      bag.castShadow = true
      this.scene.add(bag)
    }
    registerZone({ id: 'safezone_fortified', x: this.safeZone.x, z: this.safeZone.z, radius: 20, densityMult: 0.4 })
  }

  // Coin Shop 'watchtower' perk - a decorative axis-aligned tower (no
  // stairs/climbable geometry, so no new collider risk) near the safe
  // zone, plus a flat ranged damage bonus. Guarded the same way
  // _buildAutoTurret is, since _applyCoinShopPerks re-calls apply() for
  // every already-owned 'base' item on every fresh page load.
  _buildWatchtower() {
    if (this.watchtowerBuilt) return
    this.watchtowerBuilt = true
    const postMat = flatMaterial({ color: 0x4a3d2c, roughness: 0.9 })
    const platformMat = flatMaterial({ color: 0x3a3024, roughness: 0.85 })
    const towerX = this.safeZone.x - 9
    const towerZ = this.safeZone.z - 6
    for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), postMat)
      post.position.set(towerX + ox, 2, towerZ + oz)
      post.castShadow = true
      this.scene.add(post)
    }
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 2.2), platformMat)
    platform.position.set(towerX, 4.1, towerZ)
    platform.castShadow = true
    this.scene.add(platform)
    this.weapons.damageMult += 0.05
  }

  // Coin Shop 'farm_plot' perk - decorative crop-row planes near the safe
  // zone, plus a slow passive Ration trickle (see _updateFarmPlot) rather
  // than a one-time stat bump. Same idempotent-build guard as the other
  // 'base' perks.
  _buildFarmPlot() {
    if (this.farmPlotBuilt) return
    this.farmPlotBuilt = true
    const soilMat = flatMaterial({ color: 0x3a2c1e, roughness: 1 })
    const cropMat = flatMaterial({ color: 0x5a8a3a, roughness: 0.9 })
    const plotX = this.safeZone.x + 9
    const plotZ = this.safeZone.z - 6
    for (let row = 0; row < 3; row++) {
      const soil = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 0.6), soilMat)
      soil.position.set(plotX, 0.08, plotZ + row * 0.9)
      soil.receiveShadow = true
      this.scene.add(soil)
      for (let i = 0; i < 5; i++) {
        const crop = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), cropMat)
        crop.position.set(plotX - 1.1 + i * 0.55, 0.3, plotZ + row * 0.9)
        crop.castShadow = true
        this.scene.add(crop)
      }
    }
    this.nextFarmHarvestAt = performance.now() + FARM_HARVEST_INTERVAL_MS
  }

  // Only ticks while the plot's actually been built - a no-op otherwise,
  // same "harmless if never purchased" shape as every other Coin Shop perk.
  _updateFarmPlot() {
    if (!this.farmPlotBuilt) return
    if (performance.now() < this.nextFarmHarvestAt) return
    this.nextFarmHarvestAt = performance.now() + FARM_HARVEST_INTERVAL_MS
    this.inventory.addRation(1)
    this._updateInventoryHud()
    this._showLoreToast(t('toastFarmHarvest'))
  }

  // Ammo Press - same permanent-base-structure shape as buildFarmPlot right
  // above (own coordinate offset from the safe zone, built once, ticked
  // every frame but a no-op until purchased).
  _buildAmmoPress() {
    if (this.ammoPressBuilt) return
    this.ammoPressBuilt = true
    const bodyMat = flatMaterial({ color: 0x3a3a3e, roughness: 0.7, metalness: 0.4 })
    const beltMat = flatMaterial({ color: 0x1c1c1e, roughness: 0.9 })
    const x = this.safeZone.x - 9
    const z = this.safeZone.z - 6
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.2), bodyMat)
    body.position.set(x, 0.7, z)
    body.castShadow = true
    this.scene.add(body)
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.5), beltMat)
    belt.position.set(x, 0.08, z)
    this.scene.add(belt)
    this.nextAmmoPressAt = performance.now() + AMMO_PRESS_INTERVAL_MS
  }

  _updateAmmoPress() {
    if (!this.ammoPressBuilt) return
    if (performance.now() < this.nextAmmoPressAt) return
    this.nextAmmoPressAt = performance.now() + AMMO_PRESS_INTERVAL_MS
    if (!this.weapons.current.melee) this.weapons.addAmmoToCurrent(AMMO_PRESS_AMOUNT)
    this._showLoreToast(t('toastAmmoPress', { n: AMMO_PRESS_AMOUNT }))
  }

  // Informant NPC - a fixed safe-zone fixture (always present, not a Coin
  // Shop purchase like the base structures above), offering intel instead
  // of items/services: pay coins, reveal one random undiscovered location
  // straight onto the map's fog-of-war (see this.discoveredCells) without
  // having to actually walk there first.
  _buildInformant() {
    const mat = flatMaterial({ color: 0x2a2420, roughness: 0.85 })
    const capMat = flatMaterial({ color: 0x3a3228, emissive: 0xffb84a, emissiveIntensity: 0.5, roughness: 0.6 })
    this.informantX = this.safeZone.x + 9
    this.informantZ = this.safeZone.z + 6
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.7, 8), mat)
    post.position.set(this.informantX, 0.85, this.informantZ)
    post.castShadow = true
    this.scene.add(post)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 8), capMat)
    cap.position.set(this.informantX, 1.95, this.informantZ)
    this.scene.add(cap)
    this.nearInformant = false
  }

  _updateInformant(playerPos) {
    const dist = Math.hypot(playerPos.x - this.informantX, playerPos.z - this.informantZ)
    this.nearInformant = dist <= INFORMANT_INTERACT_RADIUS
  }

  _useInformant() {
    if (this.coins < INFORMANT_COST) {
      this._showLoreToast(t('informantNoCoins'))
      return
    }
    const undiscovered = this.allLocationLandmarks.filter((lm) => {
      const cx = Math.floor(lm.x / EXPLORE_CELL_SIZE)
      const cz = Math.floor(lm.z / EXPLORE_CELL_SIZE)
      return !this.discoveredCells.has(`${cx},${cz}`)
    })
    if (undiscovered.length === 0) {
      this._showLoreToast(t('informantNothingLeft'))
      return
    }
    this.coins -= INFORMANT_COST
    const pick = undiscovered[Math.floor(Math.random() * undiscovered.length)]
    const cx = Math.floor(pick.x / EXPLORE_CELL_SIZE)
    const cz = Math.floor(pick.z / EXPLORE_CELL_SIZE)
    this.discoveredCells.add(`${cx},${cz}`)
    this._updateStatsPanel()
    this._showLoreToast(t('informantRevealed', { name: pick.label }))
  }

  // Lore Markers - a handful of small glowing props, own interact prompt
  // (see nearLoreMarker in the main tick's prompt chain) rather than
  // folding into any existing interactable, since none of them are "read a
  // short line of world lore" in shape.
  _buildLoreMarkers() {
    const mat = flatMaterial({ color: 0x2a2418, emissive: 0xb39cff, emissiveIntensity: 0.8, roughness: 0.5 })
    this.loreMarkerProps = LORE_MARKERS.map((m) => {
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat)
      mesh.position.set(m.x, 1.1, m.z)
      this.scene.add(mesh)
      return { ...m, mesh }
    })
    this.nearLoreMarker = null
  }

  _updateLoreMarkers(dt, playerPos) {
    this.nearLoreMarker = null
    for (const m of this.loreMarkerProps) {
      m.mesh.rotation.y += dt * 0.6
      if (this.loreMarkersFound.has(m.id)) continue
      const dist = Math.hypot(playerPos.x - m.x, playerPos.z - m.z)
      if (dist <= LORE_MARKER_INTERACT_RADIUS) this.nearLoreMarker = m
    }
  }

  _readLoreMarker() {
    const m = this.nearLoreMarker
    if (!m) return
    this.loreMarkersFound.add(m.id)
    this.nearLoreMarker = null
    this._showLoreToast(t(m.textKey))
  }

  // Rolled alongside _rollWeather/_rollNightMutation (see their own call
  // sites) - banner meshes are built once, lazily, then just recolored on
  // every later call rather than rebuilt from scratch.
  _applySeasonalDressing() {
    const theme = SEASONAL_THEMES[this.night % SEASONAL_THEMES.length]
    if (!this.seasonalBanners) {
      this.seasonalBanners = []
      for (const [ox, oz] of [[-6, 6], [6, 6], [-6, -6], [6, -6]]) {
        const mat = flatMaterial({ color: theme.color, emissive: theme.color, emissiveIntensity: 0.5, side: THREE.DoubleSide })
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.4), mat)
        banner.position.set(this.safeZone.x + ox, 1.4, this.safeZone.z + oz)
        this.scene.add(banner)
        this.seasonalBanners.push(banner)
      }
    } else {
      for (const banner of this.seasonalBanners) {
        banner.material.color.setHex(theme.color)
        banner.material.emissive.setHex(theme.color)
      }
    }
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
    // Stat summary appended after the fixed endingText - templated with
    // this save's actual lifetime numbers so the epilogue reads a little
    // differently depending on how the story actually went, on top of the
    // one fixed paragraph everyone gets.
    const statSummary = t('endingStatSummary', {
      nights: this.bestStats.bestNight,
      kills: this.careerStats.totalKills,
      rescued: this.narrativeStats.rescued,
    })
    this.endingText.textContent = `${t('endingText')} ${statSummary}`
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

    this._recordRunEnd()

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
    this._checkBountyProgress('rescue_survivors', 1)
    this.narrativeStats.rescued += 1
    saveNarrativeStats(this.narrativeStats)

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

  // Survivor Camp Liberation night event - see 'camp_attack' in
  // NightEvents.js. Spawns CAMP_SURVIVOR_COUNT vulnerable Companion NPCs in
  // a small cluster plus an immediate zombie burst on top of them (see
  // ZombieManager.spawnAt), then leaves the outcome to _updateSurvivorCamp.
  _spawnSurvivorCamp() {
    if (this.survivorCamp) {
      for (const s of this.survivorCamp.survivors) s.dispose()
    }
    const spot = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
    const survivors = []
    for (let i = 0; i < CAMP_SURVIVOR_COUNT; i++) {
      const angle = (i / CAMP_SURVIVOR_COUNT) * Math.PI * 2
      survivors.push(new Companion(this.scene, spot.x + Math.cos(angle) * 2.5, spot.z + Math.sin(angle) * 2.5, 'ranged'))
    }
    this.survivorCamp = { survivors, x: spot.x, z: spot.z, startedAt: performance.now() }
    this.zombies.spawnAt(spot.x, spot.z, CAMP_ATTACK_ZOMBIE_COUNT)
    this._showLoreToast(t('toastCampUnderAttack'))
  }

  // Ticks the camp's survivor NPCs every frame (same update() signature the
  // player's own this.recruits get) and resolves the event once
  // CAMP_EVENT_DURATION_MS has passed, or immediately if every survivor
  // dies first - a real fail state, unlike the single passive
  // rescueSurvivor above.
  _updateSurvivorCamp(dt, playerPos) {
    const camp = this.survivorCamp
    if (!camp) return
    for (const s of camp.survivors) s.update(dt, playerPos, this.zombies.zombies, null)
    camp.survivors = camp.survivors.filter((s) => !s.dead)

    if (camp.survivors.length === 0) {
      this._showLoreToast(t('toastCampLost'))
      this.survivorCamp = null
      return
    }
    if (performance.now() - camp.startedAt >= CAMP_EVENT_DURATION_MS) {
      this._resolveCampSuccess(camp)
    }
  }

  // Reward roll: either a surviving NPC joins the player's real recruit
  // roster (this.recruits, permanent - unlike tempCompanion's dawn expiry),
  // or a loot cache instead when none join, so the reward stays interesting
  // whether the player kept every survivor alive or just barely enough.
  _resolveCampSuccess(camp) {
    this.points += CAMP_LOOT_REWARD_POINTS
    this._updateStatsPanel()
    if (Math.random() < 0.5) {
      const recruit = camp.survivors.shift()
      this.recruits.push(recruit)
      this._showLoreToast(t('toastCampSavedRecruit'))
    } else {
      this.inventory.addHealthPack(2)
      this.inventory.addGrenade(1)
      this._updateInventoryHud()
      this._showLoreToast(t('toastCampSavedLoot', { reward: CAMP_LOOT_REWARD_POINTS }))
    }
    for (const s of camp.survivors) s.dispose()
    this.survivorCamp = null
  }

  // Escort Convoy night event (see 'escort_convoy' in NightEvents.js) -
  // spawns ESCORT_SURVIVOR_COUNT vulnerable Companion NPCs far from the
  // safe zone. Unlike _spawnSurvivorCamp, these use Companion's normal
  // follow-the-player update() unchanged, so the player has to physically
  // lead them home rather than just holding a position.
  _spawnEscortConvoy() {
    if (this.escortConvoy) {
      for (const s of this.escortConvoy.survivors) s.dispose()
    }
    const spot = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)]
    const survivors = []
    for (let i = 0; i < ESCORT_SURVIVOR_COUNT; i++) {
      survivors.push(new Companion(this.scene, spot.x + i, spot.z, 'ranged'))
    }
    this.escortConvoy = { survivors }
    this._showLoreToast(t('toastConvoyStarted'))
  }

  // Ticked every frame alongside this.recruits (same update() signature) -
  // resolves by proximity to the safe zone instead of a timer, or
  // immediately as a failure once every survivor is dead.
  _updateEscortConvoy(dt, playerPos) {
    const convoy = this.escortConvoy
    if (!convoy) return
    for (const s of convoy.survivors) s.update(dt, playerPos, this.zombies.zombies, null)
    convoy.survivors = convoy.survivors.filter((s) => !s.dead)

    if (convoy.survivors.length === 0) {
      this._showLoreToast(t('toastConvoyLost'))
      this.escortConvoy = null
      return
    }
    const allArrived = convoy.survivors.every((s) => Math.hypot(s.group.position.x - this.safeZone.x, s.group.position.z - this.safeZone.z) <= ESCORT_ARRIVAL_RADIUS)
    if (allArrived) this._resolveConvoySuccess(convoy)
  }

  _resolveConvoySuccess(convoy) {
    this.points += ESCORT_REWARD_POINTS
    this._updateStatsPanel()
    if (Math.random() < 0.5) {
      const recruit = convoy.survivors.shift()
      this.recruits.push(recruit)
      this._showLoreToast(t('toastConvoySavedRecruit'))
    } else {
      this.inventory.addHealthPack(2)
      this.inventory.addFuelCan(1)
      this._updateInventoryHud()
      this._showLoreToast(t('toastConvoySavedLoot', { reward: ESCORT_REWARD_POINTS }))
    }
    for (const s of convoy.survivors) s.dispose()
    this.escortConvoy = null
  }

  // Rendered on demand (map open, or right after placing/clearing a custom
  // pin) rather than every frame - see the toggleMap handler's own note on
  // why (gameplay freezes while the map's open, so nothing on it can change
  // between renders anyway).
  _renderFullMap() {
    this.camera.getWorldDirection(this._camDir)
    const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)
    this.fullMap.render(this.player.controls.object.position, facingRad, this.discoveredCells, EXPLORE_CELL_SIZE, this.allLocationLandmarks, this.customPin)
  }

  _buildPingMarker(x, z) {
    this._removePingMarker()
    const mat = flatMaterial({ color: 0xff5c5c, emissive: 0xff5c5c, emissiveIntensity: 1.8, transparent: true, opacity: 0.85, depthTest: false })
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 4), mat)
    marker.position.set(x, 3, z)
    marker.rotation.x = Math.PI
    marker.renderOrder = 999
    this.scene.add(marker)
    this.pingMarkerMesh = marker
    this.pingMarkerExpiresAt = performance.now() + PING_MARKER_DURATION_MS
  }

  _removePingMarker() {
    if (this.pingMarkerMesh) {
      this.scene.remove(this.pingMarkerMesh)
      this.pingMarkerMesh = null
    }
    this.pingMarkerExpiresAt = 0
  }

  _updatePingMarker(dt) {
    if (!this.pingMarkerMesh) return
    if (performance.now() >= this.pingMarkerExpiresAt) {
      this._removePingMarker()
      return
    }
    this.pingMarkerMesh.rotation.y += dt * 2
    this.pingMarkerMesh.position.y = 3 + Math.sin(performance.now() * 0.003) * 0.3
  }

  // Core FPS loop via gamepad - see GAMEPAD_DEADZONE's own doc comment for
  // scope. Gated on the same "not in a menu" flags the keydown handler
  // already checks, rather than controls.isLocked (real Pointer Lock never
  // actually engages in headless Playwright - see this project's own
  // CLAUDE.md note - so gating on it would make this untestable).
  _updateGamepad(dt) {
    if (!this.gameStarted || this.inventoryOpen || this.mapOpen || this.photoModeOpen || this.weaponWheelOpen || this.driving || this.journalOpen) return
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    const pad = pads[0]
    if (!pad) return

    const lx = pad.axes[0] || 0
    const ly = pad.axes[1] || 0
    this.player.input.left = lx < -GAMEPAD_DEADZONE
    this.player.input.right = lx > GAMEPAD_DEADZONE
    this.player.input.forward = ly < -GAMEPAD_DEADZONE
    this.player.input.back = ly > GAMEPAD_DEADZONE

    const rx = pad.axes[2] || 0
    const ry = pad.axes[3] || 0
    if (Math.abs(rx) > GAMEPAD_DEADZONE || Math.abs(ry) > GAMEPAD_DEADZONE) {
      this._gamepadEuler.setFromQuaternion(this.camera.quaternion)
      this._gamepadEuler.y -= rx * GAMEPAD_LOOK_SENSITIVITY * dt
      this._gamepadEuler.x -= ry * GAMEPAD_LOOK_SENSITIVITY * dt
      this._gamepadEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this._gamepadEuler.x))
      this.camera.quaternion.setFromEuler(this._gamepadEuler)
    }

    const triggerValue = pad.buttons[7] ? pad.buttons[7].value : 0
    this.weapons.triggerDown = triggerValue > GAMEPAD_TRIGGER_THRESHOLD

    this.player.input.sprint = !!(pad.buttons[10] && pad.buttons[10].pressed)

    const interactPressed = !!(pad.buttons[0] && pad.buttons[0].pressed)
    if (interactPressed !== this._gamepadInteractWasDown) {
      window.dispatchEvent(new KeyboardEvent(interactPressed ? 'keydown' : 'keyup', { code: getKeyFor('interact') }))
      this._gamepadInteractWasDown = interactPressed
    }

    const reloadPressed = !!(pad.buttons[2] && pad.buttons[2].pressed)
    if (reloadPressed && !this._gamepadReloadWasDown) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: getKeyFor('reload') }))
    }
    this._gamepadReloadWasDown = reloadPressed
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
    const zombiePositions = this._minimapZombiePositions
    zombiePositions.length = 0
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      zombiePositions.push({ x: z.group.position.x, z: z.group.position.z })
    }
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
      this.newLocationLandmarks,
      this.discoveredCells,
      EXPLORE_CELL_SIZE
    )
  }

  // Stage 14's fog-of-war - marks a small radius of cells around the player
  // as discovered every frame. Cheap (a handful of Set.add calls over a
  // fixed small radius, not scaled to the whole 750x750 map), so no need to
  // throttle like this file's other timer-gated systems.
  _updateExploration(playerPos) {
    const cx = Math.floor(playerPos.x / EXPLORE_CELL_SIZE)
    const cz = Math.floor(playerPos.z / EXPLORE_CELL_SIZE)
    for (let dx = -EXPLORE_REVEAL_RADIUS_CELLS; dx <= EXPLORE_REVEAL_RADIUS_CELLS; dx++) {
      for (let dz = -EXPLORE_REVEAL_RADIUS_CELLS; dz <= EXPLORE_REVEAL_RADIUS_CELLS; dz++) {
        this.discoveredCells.add(`${cx + dx},${cz + dz}`)
      }
    }
    // Landmark Discovery Rewards - a one-time coin bonus the first time
    // each named location's own cell actually gets walked-into-range of,
    // checked right here since exploration reveal is already the trigger
    // rather than a second per-frame scan. The Informant's paid reveal
    // (see _useInformant) doesn't call this method, so buying intel skips
    // the bonus - only actually walking there earns it.
    for (const lm of this.allLocationLandmarks) {
      if (this.rewardedLandmarks.has(lm.label)) continue
      const lcx = Math.floor(lm.x / EXPLORE_CELL_SIZE)
      const lcz = Math.floor(lm.z / EXPLORE_CELL_SIZE)
      if (this.discoveredCells.has(`${lcx},${lcz}`)) {
        this.rewardedLandmarks.add(lm.label)
        this.coins += LANDMARK_DISCOVERY_COINS
        this._updateStatsPanel()
        this._showLoreToast(t('landmarkDiscovered', { name: lm.label, coins: LANDMARK_DISCOVERY_COINS }))
      }
    }
  }

  _updateZoneDangerWarning() {
    const zone = this.zombies.currentZone
    if (!zone || zone.densityMult < ZONE_DANGER_THRESHOLD || this.warnedZones.has(zone.id)) return
    this.warnedZones.add(zone.id)
    this._showLoreToast(t('zoneDangerToast'))
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
    this._fpsFrameCount++
    const nowFps = performance.now()
    const fpsElapsed = nowFps - this._fpsLastUpdate
    if (fpsElapsed >= 500) {
      const fps = Math.round((this._fpsFrameCount * 1000) / fpsElapsed)
      const msPerFrame = (fpsElapsed / this._fpsFrameCount).toFixed(1)
      this.fpsEl.textContent = `${fps} fps / ${msPerFrame} ms`
      this._fpsFrameCount = 0
      this._fpsLastUpdate = nowFps

      const p = this.player.controls.object.position
      this.coordsEl.textContent = `x:${p.x.toFixed(1)} z:${p.z.toFixed(1)} y:${p.y.toFixed(1)}`

      // Zombie population governor - the real "make it stable" lever
      // (see the constructor's own note): tightens fast on one bad
      // sample, loosens slowly once there's real headroom, same shape as
      // the disabled resolution scaler below but aimed at a cost that
      // actually matters. Floor of 6 keeps Round Mode from ever going
      // fully empty even in the worst case.
      const zombieCapCeiling = LOW_QUALITY_MODE ? 20 : 50
      if (fps < 40) this._zombiePopulationCap = Math.max(6, this._zombiePopulationCap - 5)
      else if (fps > 55) this._zombiePopulationCap = Math.min(zombieCapCeiling, this._zombiePopulationCap + 1)
      this.zombies.performanceCap = this._zombiePopulationCap

      // Dynamic resolution scaling DISABLED (2026-07-21) - confirmed
      // dropping render resolution all the way down didn't recover any fps
      // in a genuinely severe real case, meaning pixel count isn't the
      // bottleneck here, so automatically blurring the image bought
      // nothing. _dynResScale stays permanently at 1 (full resolution);
      // left the field/multiplication in _applyRenderScale/_basePixelRatio
      // in place rather than ripping it out, in case a future case
      // legitimately needs it back.

      if (!this.settings.performanceMode && !this._autoPerfModeTriggered) {
        this._lowFpsStreak = fps < 25 ? this._lowFpsStreak + 1 : 0
        if (this._lowFpsStreak >= 6) {
          this._autoPerfModeTriggered = true
          this.settings.performanceMode = true
          this.performanceToggle.checked = true
          this._applyPerformanceMode(true)
          saveSettings(this.settings)
          this._showLoreToast(t('toastAutoPerfMode'))
        }
      }
    }

    this.timer.update()
    let dt = Math.min(this.timer.getDelta(), 0.1)
    const elapsed = this.timer.getElapsed()
    if (performance.now() < this._hitstopUntil) dt = 0
    else if (performance.now() < this.killcamUntil) dt *= KILLCAM_SLOWMO_FACTOR

    this.camera.position.sub(this._shakeOffset)
    this.camera.position.y -= this._landingDipY

    this.dayNight.update()
    // Weather dims the day/night lighting further (see WEATHER_DIM_RAIN/
    // SNOW) - dayNight.update() just set hemi/sun intensity fresh from the
    // day/night lerp above, so this multiplies on top of that every frame
    // rather than fighting it.
    const weatherDim = this.raining ? WEATHER_DIM_RAIN : this.snowing ? WEATHER_DIM_SNOW : 1
    // Blackout mutator - composes with the weather dim above (both apply)
    // rather than overriding it, so a rainy Blackout night is darker still.
    const blackoutDim = this.blackoutActive ? BLACKOUT_DIM : 1
    this.dayNight.hemi.intensity *= weatherDim * blackoutDim
    this.dayNight.sun.intensity *= weatherDim * blackoutDim
    this._updateWetStreetSheen(this.player.controls.object.position, dt)
    this._updateNightSky()
    this._updateBannerSway(elapsed)
    this._updateFogPatch()
    this._applyFogState()
    this._updateFlicker(elapsed)
    this._updateMusicIntensity(this.player.controls.object.position)
    this._updateIndoorDetection(this.player.controls.object.position)

    if (this.driving && this.player.controls.isLocked && this.playerState.alive) {
      this.vehicle.update(dt, this.player.input, this.player.colliders)
      this.vehicle.getDriverSeatWorld(this._vehicleSeatPos)
      this.camera.position.copy(this._vehicleSeatPos)
      this._updateVehicleRamming()
    } else if (this.photoModeOpen) {
      this._updatePhotoMode(dt)
    } else if (this.player.controls.isLocked && this.playerState.alive && !this.inventoryOpen && !this.perkPanelOpen && !this.traderPanelOpen && !this.xpLevelupPanelOpen && !this.mapOpen && !this.journalOpen) {
      this.player.update(dt)
      const playerPos = this.player.controls.object.position
      this._updateThirdPerson()
      const isMoving = this.player.onGround && (
        this.player.input.forward || this.player.input.back ||
        this.player.input.left || this.player.input.right
      )
      if (isMoving) {
        this.footstepTimer -= dt
        if (this.footstepTimer <= 0) {
          this.footstepTimer = this.player.isSprinting ? FOOTSTEP_INTERVAL_SPRINT : FOOTSTEP_INTERVAL_WALK
          audioEngine.playFootstep(this.isIndoors)
        }
      } else {
        this.footstepTimer = 0
      }
      if (!this.weaponWheelOpen) this.weapons.update(dt, isMoving, this.player.isSprinting)
      if (performance.now() < this.killcamUntil) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.weapons.defaultFov * KILLCAM_ZOOM_FOV_MULT, 0.15)
        this.camera.updateProjectionMatrix()
      }
      // Throttled here, not inside _updateHotbarHud itself - this is the
      // continuous per-frame refresh (getSummary() rebuilds a whole array
      // of objects every call, wasteful 60x/sec for a hotbar that rarely
      // changes); the OTHER call sites (weapon switch, slot assignment)
      // are real one-off events that should still refresh immediately,
      // not get delayed by this same throttle.
      const nowHotbar = performance.now()
      if (nowHotbar >= (this._nextHotbarHudAt || 0)) {
        this._nextHotbarHudAt = nowHotbar + 200
        this._updateHotbarHud()
      }
      this._updateStaminaHud()
      this._updateHunger(dt)
      this._updateThirst(dt)
      this._updateWarmth(dt)
      this._updateFarmPlot()
      this._updateAmmoPress()
      this._updateGamepad(dt)
      this._updatePingMarker(dt)
      this._updateCorpsePileSlow(playerPos)
      this._updateFlashlightBattery(dt)
      this._updateKillstreakTimers()

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
        if (this.snowing) this._checkBountyProgress('survive_snow_night', 1)
        this._checkBountyProgress('reach_3_nights', 1)
        this.night += 1
        this.upgradeMachineUsesThisNight = 0
        if (this.tempCompanion && this.night >= this.tempCompanionExpiresAtNight) {
          this._showLoreToast(t('tempCompanionLeft'))
          this.tempCompanion.dispose()
          this.tempCompanion = null
        }
        this.nightStartedAt = performance.now()
        this._scheduleNightEvent()
        this._rollWeather()
        this._applySeasonalDressing()
        this._rollRoadPileups()
        this._maybeSquadBanter()
      this._rollNightMutation()
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
        // Nightmare-tier achievements - same night thresholds as
        // survivor_5/10 above, gated on actually being on Nightmare rather
        // than new milestones, since surviving 5-10 nights means something
        // different at this difficulty.
        if (this.settings.difficulty === 'nightmare') {
          if (this.night >= 5) this.achievements.unlock('nightmare_survivor_5')
          if (this.night >= APEX_UNLOCK_NIGHT) {
            this.achievements.unlock('nightmare_conqueror')
            document.getElementById('diff-apex').style.display = ''
          }
        }
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

      this._updateDirectorAI()
      this._updateAdrenaline()
      this.camera.getWorldDirection(this._camDir)
      this.zombies.update(
        dt,
        playerPos,
        (dmg) => this._onZombieAttack(dmg),
        (x, z) => this.pickups.spawnLootDrop('ammo', x, z), // boss-only guaranteed drop, see ZombieManager
        () => audioEngine.playAmbushShriek(),
        (zombieTypeId, weaponId, x, z, isElite, isWandering) => this._onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering),
        this.player.isCrouching,
        this.dayNight ? this.dayNight.getPhaseInfo().phase === 'Night' : false,
        (x, z) => this._spawnHazardZone('acid', x, z),
        (originX, originZ) => this._onZombiePull(originX, originZ),
        () => this._triggerShake(0.18, 600),
        (x, z) => this._spawnHazardZone('web', x, z),
        this._camDir.x,
        this._camDir.z,
        this.barricadeWindows.windows,
        this._collectCompanionTargets()
      )
      // Squad Formation Toggle (see _toggleSquadHold) - the whole squad
      // treats a fixed anchor point as "playerPos" instead of the real one
      // while holding, same substitution ZombieManager already uses to
      // redirect wandering-horde members toward a waypoint instead of the
      // player.
      const squadTargetPos = this.squadHoldPosition ? this.squadHoldAnchor : playerPos
      this.companion.update(dt, squadTargetPos, this.zombies.zombies, (amount) => {
        this.playerState.heal(amount)
        this._updateHealthHud()
      })
      if (this.tempCompanion) this.tempCompanion.update(dt, squadTargetPos, this.zombies.zombies, null)
      for (const recruit of this.recruits) recruit.update(dt, squadTargetPos, this.zombies.zombies, null)
      this._updateCompanionDownedState(playerPos)
      this._updateCompanionBond()
      for (const guard of this.safeZoneGuards) {
        guard.update(dt, guard.group.position, this.zombies.zombies, null)
      }
      if (this.turret) this.turret.update(this.zombies.zombies)
      for (const t of this.deployedTurrets) t.update(this.zombies.zombies)
      this._updateSafeZoneHeal(dt, playerPos)
      if (this.settings.mutators.healthRegen) this._updateHealthRegen(dt)
      if (this.flashlightOn) this._updateLightLure(playerPos)
      // Companion Auto-Loot - the companion sweeps up anything it walks
      // near too, not just the player (see Pickups.update's companionPos
      // param). Only while actually up and about, same guard every other
      // companion-ability check in this file uses.
      const companionLootPos = (!this.companion.dead && !this.companion.downed) ? this.companion.group.position : null
      this.pickups.update(dt, elapsed, playerPos, {
        onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
      }, companionLootPos)
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
      this._updateUpgradeMachine(playerPos)
      this._updateMysteryBox(playerPos)
      this._updateAmmoStation(dt, playerPos)
      this._updateBreakerBox(dt, playerPos)
      this._updateToxicWater(dt, playerPos)
      this._updateMineHazards(playerPos)
      this._updateExploration(playerPos)
      this._updateZoneDangerWarning()
      this._updateVehicleProximity(playerPos)
      this._updateVireoTerminal(playerPos)
      this._updateStationTerminal(playerPos)
      this._updateStationEncounter(playerPos)
      this._updateRescueSurvivor(playerPos)
      if (this.rescueSurvivor) this.rescueSurvivor.update(elapsed)
      this._updateSurvivorCamp(dt, playerPos)
      this._updateEscortConvoy(dt, playerPos)
      this._updateRecruitSpots(elapsed, playerPos)
      this._updateInformant(playerPos)
      this._updateLoreMarkers(dt, playerPos)
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
      } else if (this.nearUpgradeMachine) {
        this.interactPrompt.innerHTML = tHtml('interactUpgradeMachine')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearMysteryBox) {
        this.interactPrompt.innerHTML = tHtml('interactMysteryBox')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearVehicle && this.vehicle.fuel < this.vehicle.stats.maxFuel && this.inventory.fuelCans > 0) {
        this.interactPrompt.innerHTML = tHtml('interactRefuelVehicle')
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
      } else if (this.nearZiplineEnd) {
        this.interactPrompt.innerHTML = tHtml('interactZipline')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearInformant) {
        this.interactPrompt.innerHTML = tHtml('interactInformant', { cost: INFORMANT_COST })
        this.interactPrompt.style.display = 'block'
      } else if (this.nearLoreMarker) {
        this.interactPrompt.innerHTML = tHtml('interactLoreMarker')
        this.interactPrompt.style.display = 'block'
      } else {
        this.interactPrompt.style.display = 'none'
      }
      this._updateZipline(playerPos)
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
      this._updateAlarms()
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
    this._updateLandingDip(dt)
    this.camera.position.add(this._shakeOffset)
    this.camera.position.y += this._landingDipY

    this.composer.render()
  }
}

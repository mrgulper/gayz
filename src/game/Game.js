import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { buildWorld, WORLD_CULL_DISTANCE, WORLD_SHADOW_CULL_DISTANCE, CAMPFIRE_X, CAMPFIRE_Z } from './World.js'
import { LOW_QUALITY_MODE, flatMaterial } from './QualitySettings.js'
import { PlayerController } from './PlayerController.js'
import { WeaponSystem, WEAPON_CHARM_IDS } from './WeaponSystem.js'
import { ZombieManager } from './ZombieManager.js'
import { PickupManager } from './Pickups.js'
import { PlayerState } from './PlayerState.js'
import { Inventory } from './Inventory.js'
import { DayNightCycle } from './DayNightCycle.js'
import { ChestManager, Vault, LOOT_WEIGHTS } from './Chests.js'
import { RivalManager, RIVAL_BANTER } from './RivalScavenger.js'
import { loadMastery, saveMastery, MASTERY_THRESHOLD, MASTERY_DAMAGE_MULT, GRANDMASTER_THRESHOLD, GRANDMASTER_DAMAGE_MULT } from './WeaponMastery.js'
import { BarricadeWindows, REPAIR_REWARD_POINTS } from './BarricadeWindows.js'
import { Minimap } from './Minimap.js'
import { FullMap } from './FullMap.js'
import { DecalManager } from './Decals.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { Quests, QUESTS } from './Quests.js'
import { RollingQuests, EXPIRE_MS as ROLLING_QUEST_EXPIRE_MS } from './RollingQuests.js'
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
import { ACTIONS, getKeyFor, setBinding, resetBindings, keyLabel, getAllBindings, setAllBindings } from './Keybinds.js'
import { audioEngine } from './Audio.js'
import { LANGUAGES, setLanguage, t, tHtml } from './i18n.js'
import * as MenuEasterEggs from './MenuEasterEggs.js'
import { JOKE_TIPS, FUNNY_TRIVIA } from './MenuEasterEggs.js'
import * as MenuPresets from './MenuPresets.js'
import { BuildMode } from './BuildMode.js'
import * as CloudSync from './CloudSync.js'
import * as CloudSaveUI from './CloudSaveUI.js'
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
  melee_spear: () => t('toastSpearAdded'),
  melee_nunchaku: () => t('toastNunchakuAdded'),
  smokebomb: () => t('toastSmokeBombAdded'),
  weapon_charm: () => t('toastCharmAdded'),
  ration: () => t('toastRationAdded'),
}

// Starting stat tradeoffs, picked once on the main menu and applied a
// single time when a fresh run begins (see the playBtn click handler) -
// not reapplied on respawn, same as XP upgrades/perks.
// Nickname Font (see --nickname-font) - web-safe stacks only, no new font
// file loads (unlike the title's Black Ops One Google Font, already
// loaded regardless).
const NICKNAME_FONT_STACKS = {
  default: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'Courier New', Courier, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  display: "'Bebas Neue', 'Segoe UI', sans-serif",
}

// "Laps around the map" flavor stat (Profile panel) - the real perimeter
// of World.js's 750x750 square play area (see addPerimeterBarricade's
// groundSize param there), not an arbitrary made-up lap length.
const MAP_LAP_METERS = 750 * 4

// Random Nickname Generator (see _generateRandomNickname) - a small
// adjective+noun word bank combined with a 2-digit suffix, plenty of
// distinct combinations without needing a name-generation service.
const RANDOM_NICKNAME_ADJECTIVES = ['Rusty', 'Silent', 'Grim', 'Feral', 'Lucky', 'Rogue', 'Shady', 'Blunt', 'Sneaky', 'Iron']
const RANDOM_NICKNAME_NOUNS = ['Wolf', 'Scav', 'Reaper', 'Nomad', 'Ghost', 'Viper', 'Ranger', 'Drifter', 'Hound', 'Raven']


// Leaderboard podium styling (ranks 1-3, see _renderLeaderboardRows/
// _renderWeeklyLeaderboardList) - plain ordinal text + a gold/silver/
// bronze CSS class, not emoji medals (this codebase has a documented
// no-emoji UI convention, see #profile-emblem-row's own comment).
const PODIUM_MEDALS = ['1st', '2nd', '3rd']

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
export const LOADOUT_LABEL_KEYS = { balanced: 'loadoutBalanced', runner: 'loadoutRunner', tank: 'loadoutTank' }
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
      invertY: parsed.invertY ?? false,
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
      // Nickname color (see nickname display sites - Hardcore Memorial, kill
      // feed) - a plain hex string like crosshairColor above, not tied to
      // any purchase.
      nicknameColor: parsed.nicknameColor || '#ffe08a',
      // Custom companion name (see _updateCompanionName) - falls back to
      // the auto-generated "{nickname}'s Assistant" pattern when empty.
      companionName: parsed.companionName || '',
      // Companion jacket color override (see Companion.js's ROLE_STATS.jacket) -
      // null keeps the existing role-based default color (blue/red/green/tan).
      companionColor: parsed.companionColor || null,
      // Profile avatar preset (see _openProfilePanel) - 'male'/'female'/null.
      // Takes priority over the signed-in Google photo when set (see
      // _updateCloudQuickIcon).
      avatarChoice: parsed.avatarChoice || null,
      // Profile bio - free text, capped at 250 chars (see _renderProfileBio).
      bio: typeof parsed.bio === 'string' ? parsed.bio.slice(0, 250) : '',
      // Streaming-safe mode (see _updateStreamSafeVisibility) - hides the
      // fps/ms/draw-calls debug overlay specifically, leaving the rest of
      // the HUD untouched.
      streamSafeMode: parsed.streamSafeMode ?? false,
      defaultTag: parsed.defaultTag || null,
      companionRole: ['melee', 'medic'].includes(parsed.companionRole) ? parsed.companionRole : 'ranged',
      scoreAttackMode: parsed.scoreAttackMode ?? false,
      hardcoreMode: parsed.hardcoreMode ?? false,
      // Guest Mode (Local Sharing batch) - lets someone else play a run on
      // this save without it touching bestStats/careerStats/leaderboards
      // (see _recordRunEnd's own guard), so a shared/borrowed computer's
      // owner doesn't get their stats muddied by a one-off guest run.
      guestMode: parsed.guestMode ?? false,
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
      // Homepage batch - up to 3 pinned achievement ids (Achievement
      // Showcase) and up to 3 named class+difficulty+companion-role combos
      // (Loadout Presets, distinct from hotbarPresets above which only
      // covers the weapon hotbar). Muted volumes remember what to restore
      // on unmute (Quick Mute).
      showcaseSlots: Array.isArray(parsed.showcaseSlots) && parsed.showcaseSlots.length === 3 ? parsed.showcaseSlots : [null, null, null],
      menuPresets: Array.isArray(parsed.menuPresets) ? parsed.menuPresets.slice(0, 3) : [],
      mutedBeforeVolumes: parsed.mutedBeforeVolumes || null,
      // Second Homepage batch - the Quick Language toggle's remembered
      // "most recent non-English pick" (see #quick-language-btn's handler).
      quickLanguageAlt: parsed.quickLanguageAlt || 'es',
      // Second Online Features batch - saved friend nicknames (Cloud Save
      // panel's compare box, avoids retyping) and every mutator id ever
      // toggled on at least once (backs the "you haven't tried X yet"
      // spotlight nudge).
      savedFriends: Array.isArray(parsed.savedFriends) ? parsed.savedFriends.slice(0, 5) : [],
      mutatorsEverEnabled: Array.isArray(parsed.mutatorsEverEnabled) ? parsed.mutatorsEverEnabled : [],
      // Round 4 Online Features batch - region filter for the global
      // leaderboard (REGION_OPTIONS) and two extra accessibility modes
      // alongside the existing colorblind toggle.
      region: parsed.region || 'global',
      largeTextMode: parsed.largeTextMode ?? false,
      highContrastMode: parsed.highContrastMode ?? false,
      dyslexiaFont: parsed.dyslexiaFont ?? false,
      // Homepage background mood (see _applyBgMood) - 'auto' follows the
      // same seasonal date windows as EVENT_BANNERS, any other value is an
      // explicit user override that ignores the calendar.
      bgMood: parsed.bgMood || 'auto',
      keybindCheatSheet: parsed.keybindCheatSheet ?? false,
      showHitFeedback: parsed.showHitFeedback ?? true,
      // Graphics tab (see _bindGraphicsSettings). renderResolution is a
      // percentage fed into _basePixelRatio's pixel-ratio math, not a
      // separate render target size - docs/PERFORMANCE.md already ruled
      // resolution out as a fix for the real (CPU-bound) stutter, so this
      // is a genuine visual/GPU-cost lever, not a performance fix.
      renderResolution: parsed.renderResolution ?? 100,
      brightness: parsed.brightness ?? 100,
      contrast: parsed.contrast ?? 100,
      // 0 = SSAO pass disabled outright (default - it's real added GPU
      // cost, so it should be an opt-in, not something every player pays
      // for unasked).
      aoIntensity: parsed.aoIntensity ?? 0,
      // Default false to match this build's existing out-of-box behavior
      // (LOW_QUALITY_MODE already keeps shadows off) - an explicit opt-in
      // still works, see _resolveShadowsEnabled's own comment on why.
      shadowsEnabled: parsed.shadowsEnabled ?? false,
      shadowQuality: parsed.shadowQuality || 'medium',
      bulletHolesEnabled: parsed.bulletHolesEnabled ?? true,
      bloodEffectsEnabled: parsed.bloodEffectsEnabled ?? true,
      damageIndicatorEnabled: parsed.damageIndicatorEnabled ?? true,
      // Independent from showHitFeedback (which already gates the
      // hitmarker + damage numbers together, see _spawnDamageNumber) -
      // this ANDs with it rather than replacing it, so the existing
      // combined toggle keeps working exactly as before for players who
      // never open the new Graphics tab.
      damageNumbersEnabled: parsed.damageNumbersEnabled ?? true,
      damageNumbersScale: parsed.damageNumbersScale ?? 100,
      grainIntensity: parsed.grainIntensity ?? 100,
      panelFlickerEnabled: parsed.panelFlickerEnabled ?? true,
      // Off by default - an opt-in accessibility enhancement, not a
      // baseline change to every button/input's default focus styling.
      focusRingMode: parsed.focusRingMode ?? false,
      homepageFpsCounter: parsed.homepageFpsCounter ?? false,
      selectedGoals: Array.isArray(parsed.selectedGoals) ? parsed.selectedGoals.slice(0, 3) : [],
      underlineLinks: parsed.underlineLinks ?? false,
      shopWishlist: Array.isArray(parsed.shopWishlist) ? parsed.shopWishlist : [],
      shopSortMode: parsed.shopSortMode || 'default',
      shopSpendingLog: Array.isArray(parsed.shopSpendingLog) ? parsed.shopSpendingLog.slice(0, 10) : [],
      // {name, night} pairs already notified about (see
      // _checkFriendBeatNotifications) - prevents re-toasting the same
      // "X is ahead of you" fact every single page load; only re-fires if
      // that friend's bestNight climbs even higher, or clears once you
      // catch back up.
      friendBeatNotified: Array.isArray(parsed.friendBeatNotified) ? parsed.friendBeatNotified : [],
      // Third features batch - Personalization group.
      accentColor: parsed.accentColor || null,
      playBtnColor: parsed.playBtnColor || null,
      nicknameFont: parsed.nicknameFont || 'default',
      motto: typeof parsed.motto === 'string' ? parsed.motto.slice(0, 60) : '',
      layoutDensity: parsed.layoutDensity || 'cozy',
      pinnedStat: parsed.pinnedStat || null,
      companionNameColor: parsed.companionNameColor || null,
      pinnedPreset: Number.isInteger(parsed.pinnedPreset) ? parsed.pinnedPreset : null,
      navOrder: Array.isArray(parsed.navOrder) && parsed.navOrder.length === 5 ? parsed.navOrder : ['coinshop-btn', 'upgrades-btn', 'quests-btn', 'achievements-btn', 'credits-btn'],
      bioPresets: Array.isArray(parsed.bioPresets) ? parsed.bioPresets.slice(0, 3) : [],
      // Third features batch - Accessibility group.
      uiFont: parsed.uiFont || 'default',
      textSpacing: parsed.textSpacing ?? 100,
      buttonSize: parsed.buttonSize ?? 100,
      reduceTransparency: parsed.reduceTransparency ?? false,
      cursorTrail: parsed.cursorTrail ?? false,
      crtScanlines: parsed.crtScanlines ?? false,
      weatherParticles: parsed.weatherParticles ?? true,
      frameTimeGraph: parsed.frameTimeGraph ?? false,
      hoverAudioCue: parsed.hoverAudioCue ?? false,
      highVisCursor: parsed.highVisCursor ?? false,
      captionBackground: parsed.captionBackground ?? false,
      themePreset: parsed.themePreset || 'none',
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
    return defaultSettings()
  }
}

// Restore Default Settings (see _restoreDefaultSettings) reuses this exact
// same shape loadSettings' own catch-block fallback already used inline -
// extracted once so there's a single source of truth for "what are the
// defaults" instead of two copies drifting apart.
function defaultSettings() {
  return { language: 'en', musicVolume: 100, sfxVolume: 100, difficulty: 'normal', sensitivity: 100, invertY: false, fov: 75, hudScale: 100, hudOpacity: 100, colorblind: false, shakeIntensity: 100, reduceFlashing: false, toggleSprint: false, toggleCrouch: false, toggleAds: false, aimAssist: false, bigInteractPrompt: false, toastDuration: 100, crosshairColor: '#ffffff', crosshairSize: 100, nickname: '', nicknameColor: '#ffe08a', companionName: '', companionColor: null, avatarChoice: null, bio: '', streamSafeMode: false, defaultTag: null, companionRole: 'ranged', scoreAttackMode: false, hardcoreMode: false, guestMode: false, endlessMode: false, loadout: 'balanced', performanceMode: false, hotbar: ['melee', 'rifle', 'pistol', null, null], hotbarPresets: [null, null, null], showcaseSlots: [null, null, null], menuPresets: [], mutedBeforeVolumes: null, quickLanguageAlt: 'es', savedFriends: [], mutatorsEverEnabled: [], region: 'global', largeTextMode: false, highContrastMode: false, dyslexiaFont: false, bgMood: 'auto', keybindCheatSheet: false, showHitFeedback: true, renderResolution: 100, brightness: 100, contrast: 100, aoIntensity: 0, shadowsEnabled: false, shadowQuality: 'medium', bulletHolesEnabled: true, bloodEffectsEnabled: true, damageIndicatorEnabled: true, damageNumbersEnabled: true, damageNumbersScale: 100, grainIntensity: 100, panelFlickerEnabled: true, focusRingMode: false, homepageFpsCounter: false, selectedGoals: [], underlineLinks: false, friendBeatNotified: [], shopWishlist: [], shopSortMode: 'default', shopSpendingLog: [], accentColor: null, playBtnColor: null, nicknameFont: 'default', motto: '', layoutDensity: 'cozy', pinnedStat: null, companionNameColor: null, pinnedPreset: null, navOrder: ['coinshop-btn', 'upgrades-btn', 'quests-btn', 'achievements-btn', 'credits-btn'], bioPresets: [], uiFont: 'default', textSpacing: 100, buttonSize: 100, reduceTransparency: false, cursorTrail: false, crtScanlines: false, weatherParticles: true, frameTimeGraph: false, hoverAudioCue: false, highVisCursor: false, captionBackground: false, themePreset: 'none', mutators: { hordeRush: false, lootRush: false, pureGunplay: false, bossRush: false, hordeMode: false, kingOfTheHill: false, extraction: false, dailyChallenge: false, healthRegen: false, ironMode: false, scavenger: false, glassHouse: false, featuredEnemy: false, blackout: false, bossGauntlet: false } }
}

// See _updateCulling - every World.js flickerLights PointLight has a real
// illumination range well under this, so turning one off past this distance
// from the player can't darken anything actually visible. Shrunk under
// LOW_QUALITY_MODE - fewer simultaneously-active lights, each one a real
// per-pixel cost against every visible fragment in this forward renderer.
const LIGHT_CULL_DISTANCE = LOW_QUALITY_MODE ? 60 : 100
// Nearest-K dynamic light cap (see _updateCulling) - on top of the pure
// distance cull above, for dense light clusters (mall, safe zone) where
// more than this many lights can all be within range simultaneously.
const MAX_ACTIVE_LIGHTS = LOW_QUALITY_MODE ? 12 : 20
// Adaptive Shadow Quality (see _updateAdaptiveShadowQuality) - the
// recover threshold sits well above the low threshold (hysteresis) so a
// borderline framerate right at the boundary can't flicker the
// adjustment back and forth every 500ms sample.
const ADAPTIVE_SHADOW_LOW_FPS = 40
const ADAPTIVE_SHADOW_RECOVER_FPS = 52
const ADAPTIVE_SHADOW_MIN_MULT = 0.4
const ADAPTIVE_SHADOW_STEP = 0.9
const ADAPTIVE_SHADOW_RECOVER_STEP = 1.05

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

function _thisWeekStr(date) {
  const d = date || new Date()
  const firstJan = new Date(d.getFullYear(), 0, 1)
  const week = Math.ceil(((d - firstJan) / 86400000 + firstJan.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${week}`
}

// Days until _thisWeekStr() itself next changes - reuses that same
// function's own logic (by feeding it future dates) rather than
// re-deriving the week-boundary math by hand, so this can never drift
// out of sync with what "this week" actually means elsewhere.
function _daysUntilWeekReset() {
  const current = _thisWeekStr()
  for (let i = 1; i <= 7; i++) {
    const future = new Date()
    future.setDate(future.getDate() + i)
    if (_thisWeekStr(future) !== current) return i
  }
  return 7
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
// Renamed from WEEKLY_FEATURED_MUTATOR_LABEL_KEYS (Online Features batch)
// and extended to cover every mutator with a real i18n label - the
// Mutator Exploration spotlight nudge (see _updateMenuSpotlight mode 4)
// needs the full set, not just the 8 WEEKLY_FEATURED_MUTATORS covers.
// dailyChallenge deliberately excluded - it's its own distinct system
// already promoted separately (the daily-reset spotlight mode), not a
// "try this mutator" flavor pick.
const MUTATOR_LABEL_KEYS = {
  hordeRush: 'mutatorHordeRush',
  lootRush: 'mutatorLootRush',
  pureGunplay: 'mutatorPureGunplay',
  bossRush: 'mutatorBossRush',
  hordeMode: 'mutatorHordeMode',
  kingOfTheHill: 'mutatorKoth',
  extraction: 'mutatorExtraction',
  healthRegen: 'mutatorHealthRegen',
  ironMode: 'mutatorIronMode',
  scavenger: 'mutatorScavenger',
  glassHouse: 'mutatorGlassHouse',
  featuredEnemy: 'mutatorFeaturedEnemy',
  blackout: 'mutatorBlackout',
  bossGauntlet: 'mutatorBossGauntlet',
}

// Settings Code (export/import, see _exportSettingsCode/_importSettingsCode)
// - a deliberate whitelist of pure preference fields (audio/graphics/
// controls/accessibility), NOT the full settings object. Excludes
// identity-shaped fields (nickname, companionName, bio, colors tied to a
// player's identity) since this is meant to be pasted/shared with someone
// else, unlike Export Save's full-fidelity file backup.
const SETTINGS_CODE_KEYS = [
  'musicVolume', 'sfxVolume', 'sensitivity', 'invertY', 'fov', 'hudScale', 'hudOpacity',
  'colorblind', 'shakeIntensity', 'reduceFlashing', 'toggleSprint', 'toggleCrouch', 'toggleAds',
  'aimAssist', 'bigInteractPrompt', 'toastDuration', 'crosshairSize', 'largeTextMode',
  'highContrastMode', 'dyslexiaFont', 'focusRingMode', 'keybindCheatSheet', 'showHitFeedback',
  'performanceMode', 'bgMood', 'renderResolution', 'brightness', 'contrast', 'aoIntensity',
  'shadowsEnabled', 'shadowQuality', 'bulletHolesEnabled', 'bloodEffectsEnabled',
  'damageIndicatorEnabled', 'damageNumbersEnabled', 'damageNumbersScale', 'grainIntensity',
  'panelFlickerEnabled',
]

// Setup Code mutator whitelist (see _copySetupCode/_checkSetupCode) -
// excludes dailyChallenge, same precedent MUTATOR_LABEL_KEYS below already
// set: that's a distinct system promoted via its own daily-reset spotlight
// mode, not a "try this mutator" pick a shared setup code should carry.
const SETUP_CODE_MUTATOR_ELEMENT_KEYS = {
  hordeRush: 'mutatorHordeRush',
  lootRush: 'mutatorLootRush',
  pureGunplay: 'mutatorPureGunplay',
  bossRush: 'mutatorBossRush',
  hordeMode: 'mutatorHordeMode',
  kingOfTheHill: 'mutatorKoth',
  extraction: 'mutatorExtraction',
  healthRegen: 'mutatorHealthRegen',
  ironMode: 'mutatorIronMode',
  scavenger: 'mutatorScavenger',
  glassHouse: 'mutatorGlassHouse',
  featuredEnemy: 'mutatorFeaturedEnemy',
  blackout: 'mutatorBlackout',
  bossGauntlet: 'mutatorBossGauntlet',
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

let _settingsSavedPulseTimer = null
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (e.g. private browsing) - setting just won't persist.
  }
  // Subtle autosave confirmation - only pulses while the Settings panel is
  // actually open (a plain computed-style check, since this is a
  // standalone function with no `this`), debounced so a rapid slider drag
  // (many saveSettings calls per second) shows one steady pulse instead of
  // a flicker.
  const panel = document.getElementById('settings-panel')
  const indicator = document.getElementById('settings-saved-indicator')
  if (panel && indicator && getComputedStyle(panel).display !== 'none') {
    indicator.classList.add('show')
    clearTimeout(_settingsSavedPulseTimer)
    _settingsSavedPulseTimer = setTimeout(() => indicator.classList.remove('show'), 1200)
    // Recently Changed / Undo - reuses window.__game (see the constructor's
    // own comment on why it's set) since this is a standalone function
    // with no `this` of its own, to live-update the diff on every change
    // while the panel is actually open.
    if (window.__game) window.__game._renderRecentlyChangedList()
  }
}

const BEST_STATS_KEY = 'gayz-best-stats'

function loadBestStats() {
  try {
    const raw = localStorage.getItem(BEST_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      bestNight: parsed.bestNight || 0, bestKills: parsed.bestKills || 0, bestKillStreak: parsed.bestKillStreak || 0,
      // Third features batch - the calendar date the current bestKillStreak
      // record was actually set (see _recordRunEnd), not just the number.
      bestKillStreakDate: parsed.bestKillStreakDate || null,
    }
  } catch {
    return { bestNight: 0, bestKills: 0, bestKillStreak: 0, bestKillStreakDate: null }
  }
}

function saveBestStats(stats) {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - best stats just won't persist across sessions.
  }
}

// Best-Run Pace Comparison (see _checkBestRunPace) - records real elapsed
// time only when a new bestStats.bestNight record actually lands (see
// _recordRunEnd), so a live run can be compared against a linear
// projection of "how fast did the best-ever run reach this same night."
const BEST_RUN_PACE_KEY = 'gayz-best-run-pace'

function loadBestRunPace() {
  try {
    const raw = localStorage.getItem(BEST_RUN_PACE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveBestRunPace(pace) {
  try {
    localStorage.setItem(BEST_RUN_PACE_KEY, JSON.stringify(pace))
  } catch {
    // Storage unavailable - pace comparison just won't have a baseline yet.
  }
}

// Death-location memorial markers (see _spawnDeathMemorials) - small,
// non-solid world markers at past death coordinates, distinct from the
// menu-based Hardcore Memorial list (text log, hardcore-only) and the
// static Survivor Memorial Wall prop in World.js (one fixed decoration).
// Capped so a long play history can't grow the marker count unbounded.
const DEATH_MEMORIALS_KEY = 'gayz-death-memorials'
const DEATH_MEMORIALS_MAX = 15

function loadDeathMemorials() {
  try {
    const raw = localStorage.getItem(DEATH_MEMORIALS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveDeathMemorials(list) {
  try {
    localStorage.setItem(DEATH_MEMORIALS_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable - markers just won't persist across sessions.
  }
}

// Nemesis system (see _recordNemesis/_checkNemesisReturn) - remembers only
// the single most recent death's nearest zombie type/night, not a history.
const NEMESIS_KEY = 'gayz-nemesis'

function loadNemesis() {
  try {
    const raw = localStorage.getItem(NEMESIS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveNemesis(nemesis) {
  try {
    localStorage.setItem(NEMESIS_KEY, JSON.stringify(nemesis))
  } catch {
    // Storage unavailable - nemesis just won't persist across sessions.
  }
}

// Daily Challenge local leaderboard (see _recordDailyLeaderboardEntry) -
// top-N attempts for TODAY's date specifically, distinct from dailyBest's
// single lifetime-best score. Resets whenever the stored date goes stale,
// same day-rollover check loadDailyBest already uses.
const DAILY_LEADERBOARD_KEY = 'gayz-daily-leaderboard'
const DAILY_LEADERBOARD_MAX = 5

function loadDailyLeaderboard() {
  try {
    const raw = localStorage.getItem(DAILY_LEADERBOARD_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.date === _todayDateStr()) return parsed
    return { date: _todayDateStr(), scores: [] }
  } catch {
    return { date: _todayDateStr(), scores: [] }
  }
}

function saveDailyLeaderboard(board) {
  try {
    localStorage.setItem(DAILY_LEADERBOARD_KEY, JSON.stringify(board))
  } catch {
    // Storage unavailable - leaderboard just won't persist across sessions.
  }
}

// Secrets progress (see _digBuriedCache/_maybeTriggerRareEasterEgg) -
// lifetime counters for the Profile screen's "Secrets found" tally, not
// per-run state (buried caches/the Easter egg are re-checked fresh every
// run, but how many you've ever found persists).
const SECRETS_PROGRESS_KEY = 'gayz-secrets-progress'

function loadSecretsProgress() {
  try {
    const raw = localStorage.getItem(SECRETS_PROGRESS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { cachesDug: parsed.cachesDug || 0, easterEggSeen: !!parsed.easterEggSeen }
  } catch {
    return { cachesDug: 0, easterEggSeen: false }
  }
}

function saveSecretsProgress(progress) {
  try {
    localStorage.setItem(SECRETS_PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // Storage unavailable - the tally just won't persist across sessions.
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
    return {
      totalKills: parsed.totalKills || 0,
      totalRuns: parsed.totalRuns || 0,
      veteranPerksGranted: parsed.veteranPerksGranted || [],
      // Long-Term Goals batch - all NEVER-reset cumulative totals, same
      // shape/reasoning as totalKills/totalRuns above, just new axes
      // (real time played, ground covered, coins ever earned, damage-free
      // full runs) instead of kills.
      lifetimePlaytimeSeconds: parsed.lifetimePlaytimeSeconds || 0,
      lifetimeDistanceMeters: parsed.lifetimeDistanceMeters || 0,
      lifetimeCoinsEarned: parsed.lifetimeCoinsEarned || 0,
      flawlessRunCount: parsed.flawlessRunCount || 0,
      playtimeMilestonesGranted: parsed.playtimeMilestonesGranted || [],
      distanceMilestonesGranted: parsed.distanceMilestonesGranted || [],
      flawlessMilestonesGranted: parsed.flawlessMilestonesGranted || [],
      hallOfRecordsClaimed: parsed.hallOfRecordsClaimed || false,
      // Homepage batch (see _recordRunEnd/_updateBestStatsDisplay) - lifetime
      // death count (for a K/D ratio) and per-difficulty run/death tallies
      // (for the Recommended Difficulty hint), same never-reset shape as
      // every other axis on this object.
      totalDeaths: parsed.totalDeaths || 0,
      difficultyStats: parsed.difficultyStats || {},
      // Second Online Features batch - set once, on the very first run
      // this browser/save has ever completed (see _recordRunEnd), never
      // touched again - backs the Profile panel's "X days since your
      // first run" anniversary line.
      firstPlayedDate: parsed.firstPlayedDate || null,
      // Profile panel's "Created" line (see _renderProfileCreated) - unlike
      // firstPlayedDate above (date-only, set on first completed RUN), this
      // is a real millisecond timestamp set on the very first time the game
      // ever CONSTRUCTS on this device (see the constructor, right after
      // this load call) - a beginner may never finish a run, but this still
      // has to be accurate to the second from the moment they first opened
      // the game at all.
      accountCreatedAt: parsed.accountCreatedAt || null,
      // More-features batch - longest single continuous browser session
      // (see _updateLongestSession), and two lifetime tallies aggregated
      // at the same points totalKills/totalRuns already update, not new
      // tracking systems of their own.
      longestSessionSeconds: parsed.longestSessionSeconds || 0,
      // Reuses the Nemesis system's own "nearest alive zombie at death" proxy
      // (see _recordNemesis's own comment on why that's the accepted
      // approximation for "who killed you" in this codebase) rather than
      // inventing a second, more precise attacker-tracking system.
      deathsByType: parsed.deathsByType || {},
      mutatorUseCounts: parsed.mutatorUseCounts || {},
      // Third features batch - lifetime damage/accuracy (see the
      // WeaponSystem callbacks in the constructor) and how many times
      // you've revived your companion (see the reviveTarget interact
      // handler). No matching "revived BY companion" counter - that
      // mechanic doesn't exist in this codebase (Last Stand is entirely
      // self-revive, see _tryLastStand's own comment), so it isn't built.
      lifetimeDamageDealt: parsed.lifetimeDamageDealt || 0,
      shotsFired: parsed.shotsFired || 0,
      shotsHit: parsed.shotsHit || 0,
      timesRevivedCompanion: parsed.timesRevivedCompanion || 0,
      mostProfitableRun: parsed.mostProfitableRun || 0,
      companionRoleUseCounts: parsed.companionRoleUseCounts || {},
      playButtonClicks: parsed.playButtonClicks || 0,
    }
  } catch {
    return {
      totalKills: 0, totalRuns: 0, veteranPerksGranted: [],
      lifetimePlaytimeSeconds: 0, lifetimeDistanceMeters: 0, lifetimeCoinsEarned: 0, flawlessRunCount: 0,
      playtimeMilestonesGranted: [], distanceMilestonesGranted: [], flawlessMilestonesGranted: [], hallOfRecordsClaimed: false,
      totalDeaths: 0, difficultyStats: {}, firstPlayedDate: null, accountCreatedAt: null,
      longestSessionSeconds: 0, deathsByType: {}, mutatorUseCounts: {},
      lifetimeDamageDealt: 0, shotsFired: 0, shotsHit: 0, timesRevivedCompanion: 0, mostProfitableRun: 0,
      companionRoleUseCounts: {}, playButtonClicks: 0,
    }
  }
}

function saveCareerStats(stats) {
  try {
    localStorage.setItem(CAREER_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - career stats just won't persist across sessions.
  }
}

// Playtime/Distance/Flawless Milestones (see _recordRunEnd) - same "cross a
// threshold once, get a one-time coin bonus, remember it happened" shape as
// ENDLESS_MILESTONE_INTERVAL above, just on three new lifetime axes instead
// of Endless Mode's night count.
const PLAYTIME_MILESTONES = [
  { id: 'playtime_1h', seconds: 3600, rewardCoins: 100 },
  { id: 'playtime_5h', seconds: 18000, rewardCoins: 300 },
  { id: 'playtime_20h', seconds: 72000, rewardCoins: 800 },
  { id: 'playtime_50h', seconds: 180000, rewardCoins: 2000 },
]
const DISTANCE_MILESTONES = [
  { id: 'distance_10km', meters: 10000, rewardCoins: 100 },
  { id: 'distance_50km', meters: 50000, rewardCoins: 400 },
  { id: 'distance_200km', meters: 200000, rewardCoins: 1200 },
]
const FLAWLESS_MILESTONES = [
  { id: 'flawless_1', count: 1, rewardCoins: 150 },
  { id: 'flawless_5', count: 5, rewardCoins: 500 },
  { id: 'flawless_15', count: 15, rewardCoins: 1500 },
]
const HALL_OF_RECORDS_REWARD_COINS = 2500

// Run History Log - a capped, chronological "what happened in each of your
// past runs" list, distinct from bestStats (single-run bests only) and
// Run Summary/Career Portrait (a snapshot of the moment, not a browsable
// history). Persisted flat here (inline load/save, same convention as
// dailyLeaderboard/weeklyChallenge above) rather than a dedicated file -
// it's simple list storage, not a system with its own logic of its own.
const RUN_HISTORY_KEY = 'gayz-run-history'
const RUN_HISTORY_MAX = 25

function loadRunHistory() {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveRunHistory(list) {
  try {
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable - run history just won't persist across sessions.
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
const LOGIN_STREAK_MAX_FREEZES = 3

function loadLoginStreak() {
  try {
    const raw = localStorage.getItem(LOGIN_STREAK_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      lastDate: parsed.lastDate || null,
      streak: parsed.streak || 0,
      // Second Online Features batch - last 7 calendar dates actually
      // played (for the Profile panel's streak calendar), distinct from
      // `streak` (a single consecutive-days number) - this is a rolling
      // window capped at 7 entries, not itself a source of truth for the
      // streak count.
      recentDates: Array.isArray(parsed.recentDates) ? parsed.recentDates.slice(-7) : [],
      // More-features batch - a genuine streak-freeze mechanic (not just a
      // passive indicator): earns 1 freeze per 7-day streak milestone,
      // capped at LOGIN_STREAK_MAX_FREEZES, spent automatically to
      // preserve the streak the next time a day is missed (see
      // _checkLoginStreak) instead of always hard-resetting to 1.
      freezesAvailable: parsed.freezesAvailable || 0,
      // Profile panel's "Last Played" row (see _checkLoginStreak) - the
      // date before the current page load's own lastDate update.
      previousDate: parsed.previousDate || null,
    }
  } catch {
    return { lastDate: null, streak: 0, recentDates: [], freezesAvailable: 0, previousDate: null }
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

// Pass-the-Controller Challenge (Local Sharing batch) - a single stored
// snapshot (not a list) of the most recent run's config, offered to
// whoever plays next via #accept-challenge-btn (see _updateAcceptChallengeButton).
const CHALLENGE_HANDOFF_KEY = 'gayz-challenge-handoff'

function loadChallengeHandoff() {
  try {
    const raw = localStorage.getItem(CHALLENGE_HANDOFF_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveChallengeHandoff(handoff) {
  try {
    localStorage.setItem(CHALLENGE_HANDOFF_KEY, JSON.stringify(handoff))
  } catch {
    // Storage unavailable - the challenge handoff just won't persist.
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

// Lifetime "Total spent" (see _openProfilePanel/net worth) - same plain
// numeric localStorage pattern as traderTotalSales above.
const TOTAL_SPENT_KEY = 'gayz-total-spent'

function loadTotalSpent() {
  try {
    return Math.max(0, Number(localStorage.getItem(TOTAL_SPENT_KEY)) || 0)
  } catch {
    return 0
  }
}

function saveTotalSpent(total) {
  try {
    localStorage.setItem(TOTAL_SPENT_KEY, String(total))
  } catch {
    // Storage unavailable - just won't persist across sessions.
  }
}

// Bounty streak (see _completeBounty) - consecutive completions without
// letting one expire, persisted the same way.
const BOUNTY_STREAK_KEY = 'gayz-bounty-streak'

function loadBountyStreak() {
  try {
    return Math.max(0, Number(localStorage.getItem(BOUNTY_STREAK_KEY)) || 0)
  } catch {
    return 0
  }
}

function saveBountyStreak(streak) {
  try {
    localStorage.setItem(BOUNTY_STREAK_KEY, String(streak))
  } catch {
    // Storage unavailable - just won't persist across sessions.
  }
}

// Haggle streak (see _tryHaggle) - consecutive successful haggles across
// trader visits, same plain numeric localStorage pattern.
const HAGGLE_STREAK_KEY = 'gayz-haggle-streak'

function loadHaggleStreak() {
  try {
    return Math.max(0, Number(localStorage.getItem(HAGGLE_STREAK_KEY)) || 0)
  } catch {
    return 0
  }
}

function saveHaggleStreak(streak) {
  try {
    localStorage.setItem(HAGGLE_STREAK_KEY, String(streak))
  } catch {
    // Storage unavailable - just won't persist across sessions.
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
      ownedHats: new Set(parsed.ownedHats || []),
      equippedHat: parsed.equippedHat || null,
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
    return { points: 0, coins: 0, ownedSkins: new Set(), equippedSkin: null, ownedOutfits: new Set(), equippedOutfit: null, ownedHats: new Set(), equippedHat: null, challengeKillCounts: {}, weaponChallengesUnlocked: new Set(), shopPurchased: new Set(), unlockedGuns: [], attachments: [] }
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
      ownedHats: [...game.ownedHats],
      equippedHat: game.equippedHat,
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
// Rare/wonder weapons (w.rare, e.g. the Void Ripper) hit low odds instead of
// joining the normal uniform-random pool - a pull should feel like a real
// jackpot, not just as likely as any other gun.
const MYSTERY_BOX_RARE_CHANCE = 0.05
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
// Death Killcam (see _onPlayerDeath) - reuses this exact killcamUntil/
// KILLCAM_SLOWMO_FACTOR mechanism the boss/wave-clear cams above already
// drive, just triggered by the player's own death instead. Timed to
// slightly outlast DEATH_CAM_MS's held-beat above so the whole freeze
// plays out in slow motion rather than snapping back to normal speed
// right before the death screen shows.
const DEATH_KILLCAM_DURATION_MS = 1100
// Landing camera dip - only a genuinely hard fall dips the camera (a normal
// jump lands around -10 to -12, a stair/step correction is well under -4,
// see PlayerController's GRAVITY/JUMP_SPEED). Scale/max keep a long fall off
// the skyscraper roof from producing an absurd dip - it clamps instead of
// scaling forever.
const LANDING_DIP_MIN_IMPACT = -4
const LANDING_DIP_SCALE = 0.01
const LANDING_DIP_MAX = 0.35
// Fall damage - deliberately a much harder threshold than the camera dip
// above (-13 vs -4), so routine jumps/stairs never hurt, only a real
// drop (off a roof, down a stairwell shaft). Scales linearly from 0 at
// the min impact to FALL_DAMAGE_MAX at the max, then clamps - same
// severity-ramp shape LANDING_DIP already uses, just for damage instead
// of camera offset.
const FALL_DAMAGE_MIN_IMPACT = -13
const FALL_DAMAGE_MAX_IMPACT = -26
const FALL_DAMAGE_MAX = 45
// Landing roll - crouching the instant you land cuts fall damage way
// down, the same intuitive "crouch to soften a fall" convention several
// other games already use, so it needs no new dedicated key.
const FALL_DAMAGE_ROLL_MULT = 0.35
const LANDING_DIP_RECOVER_SPEED = 9
// Gunfire alerts nearby zombies (see _alertNearbyZombiesToGunfire) - an
// unaware zombie within radius instantly notices the player, no line-of-
// sight required (a gunshot is heard through walls, unlike being seen).
// Suppressed weapons alert at much shorter range instead of not at all -
// still a gun going off, just a quieter one.
const GUNFIRE_ALERT_RADIUS = 22
const GUNFIRE_ALERT_RADIUS_SUPPRESSED = 6
// Taunt (see _triggerTaunt) - a free, player-initiated shout that alerts
// every unaware zombie in a wide radius, no ammo cost. Deliberately a much
// bigger radius than gunfire's above since it's meant as a deliberate
// aggro-pulling tool (kite a horde away from a downed companion, or gather
// stragglers before a grenade throw) rather than gunfire's incidental
// side-effect of just shooting.
const TAUNT_ALERT_RADIUS = 32
const TAUNT_COOLDOWN_MS = 8000
const TAUNT_LINES = [
  "OVER HERE, UGLY!",
  "COME AND GET ME!",
  "IS THAT ALL YOU'VE GOT?",
  "HEY! EYES ON ME!",
  "YOU WANT SOME? COME ON!",
]
// Kill Feed (see _pushKillFeed) - a multiplayer-style running strip of the
// player's own notable kills (boss/elite/combo/melee), purely presentational.
// Capped so a fast fight can't grow the DOM list unbounded; entries fade on
// their own timer rather than waiting for a manual clear.
const KILL_FEED_MAX_ENTRIES = 5
const KILL_FEED_ENTRY_MS = 4000
// Reset All Progress - see _handleResetProgressClick's own comment for why
// this is a two-click arm/confirm instead of a single button.
const RESET_PROGRESS_CONFIRM_MS = 4000
// Achievement toast queue - slightly longer than the toast's own 3.2s CSS
// animation (see #achievement-toast.show) so one fully fades before the
// next begins, instead of visually cutting it off mid-animation.
const ACHIEVEMENT_TOAST_GAP_MS = 3400
// Buried caches (see _spawnBuriedCaches/_digBuriedCache) - placed as a ring
// around the safe zone (offset from this.safeZone.x/z per this project's
// own "position new safe-zone-adjacent things as an offset from these
// constants" note), well outside its radius so they never collide with
// the compound itself. No collision-check against the ~900 world colliders
// (same "accept a rare awkward placement" tradeoff other random-position
// systems in this game already make) since a flat ground marker has very
// low visual risk if it ends up close to a wall.
const BURIED_CACHE_COUNT = 3
const BURIED_CACHE_MIN_RADIUS = 35
const BURIED_CACHE_MAX_RADIUS = 90
const BURIED_CACHE_INTERACT_RADIUS = 2
// Secret key-sequence code (see _checkSecretSequence) - this game's own
// WASD keys rather than the classic arrow-key Konami code, since arrows
// aren't otherwise bound to anything here (movement fallback aside).
const SECRET_SEQUENCE = ['KeyW', 'KeyW', 'KeyS', 'KeyS', 'KeyA', 'KeyD', 'KeyA', 'KeyD']
const SECRET_SEQUENCE_BONUS_DURATION_MS = 15000
const SECRET_SEQUENCE_SPEED_MULT = 1.6
// Rare one-time Easter egg (see _maybeTriggerRareEasterEgg) - checked on
// every night-advance (a low-frequency, natural tick), never more than
// once per save ever (gated by secretsProgress.easterEggSeen).
const RARE_EASTER_EGG_CHANCE = 0.05
// Vault bonus second reward roll (see _openVault).
const VAULT_BONUS_ROLL_CHANCE = 0.25
// Undiscovered-landmark proximity chime (see _checkUndiscoveredLandmarkChime).
const UNDISCOVERED_CHIME_RADIUS = 25
// Smoke Bomb (see _throwSmokeBomb) - a one-time awareness reset within
// radius at throw-time (not an ongoing line-of-sight block), the simplest
// correct version of "loses the zombies chasing you" without needing to
// thread a new check into Zombie.js's own awareness/LOS update loop.
const SMOKE_BOMB_THROW_DIST = 6
const SMOKE_BOMB_RADIUS = 10
const SMOKE_BOMB_CLOUD_DURATION_MS = 4000
// Parry (see _triggerParry) - a short active-press window, distinct from
// the Riot Shield's passive always-on-while-equipped damage reduction:
// this needs precise timing and works with any weapon equipped.
const PARRY_WINDOW_MS = 350
const PARRY_COOLDOWN_MS = 3000
const PARRY_DAMAGE_REDUCTION = 0.9
const PARRY_STAGGER_MS = 1500
// Melee kill visual effect (see _spawnMeleeKillFlash) - a brief colored
// point light per variant, distinct game feel per melee weapon without
// needing real per-weapon kill animations on these procedural viewmodels.
const MELEE_KILL_FLASH_COLORS = {
  knife: 0xd8483a, bat: 0xffcf5c, machete: 0xd8483a, uvbaton: 0x8b2fe0,
  fireaxe: 0xff8a3a, sledgehammer: 0x9aa0a6, spear: 0xe8e4d8, nunchaku: 0xffcf5c,
}
const MELEE_KILL_FLASH_DURATION_MS = 350
// Golden Zombie (see _maybeSpawnGoldenZombie) - a rare tag applied
// reactively to an already-spawned ambient zombie rather than a new
// ZombieManager spawn path, so this needs no changes to its core spawn
// internals. Marked with an attached halo light (see _addGoldenHalo)
// rather than re-tinting the zombie's own body material, which is shared/
// GLB-specific and riskier to safely override per-instance.
const GOLDEN_ZOMBIE_CHECK_INTERVAL_MS = 10000
const GOLDEN_ZOMBIE_CHANCE = 0.15
const GOLDEN_ZOMBIE_COIN_BONUS = 500
const GOLDEN_ZOMBIE_ESCORT_COUNT = 3
// Noise-reactive stampede (see _alertNearbyZombiesToGunfire's own call
// site) - distinct from NightEvents.js's horde_surge (a flat per-night
// random trigger): this is a per-shot chance, only on unsuppressed fire.
const STAMPEDE_TRIGGER_CHANCE = 0.03
const STAMPEDE_SIZE = 3
// "Reclaimed" area (see _checkReclaimedArea) - a one-time small spawn on
// returning to a grid cell you haven't been back to in a while, not a
// continuous density system layered onto Zones.js's static per-zone tuning.
const RECLAIM_REVISIT_MS = 180000
const RECLAIM_CLUSTER_SIZE = 2
// Rain-slicked stumble (see _checkRainStumble) - a small per-check chance
// a nearby zombie briefly staggers on wet ground. _triggerLightning
// already has its own flinch-on-strike effect (LIGHTNING_FLINCH_RADIUS/MS,
// found while auditing this item), so this is deliberately a separate,
// much rarer ambient thing rather than a duplicate of that.
const RAIN_STUMBLE_CHECK_INTERVAL_MS = 6000
const RAIN_STUMBLE_CHANCE = 0.25
const RAIN_STUMBLE_RADIUS = 25
const RAIN_STUMBLE_STAGGER_MS = 700
// Horde-density ambient audio cue (see _checkHordeDensityAudio).
const HORDE_AUDIO_CHECK_INTERVAL_MS = 8000
const HORDE_AUDIO_DENSITY_THRESHOLD = 6
const HORDE_AUDIO_RADIUS = 30
// "Last one flees" / "Clean Sweep" - both scoped to Round Mode specifically
// (see _isRoundMode), which already has clean, well-defined wave
// boundaries (startRound/aliveCount===0), unlike ambient population which
// has no equivalent "this batch of zombies" grouping to key off of. The
// actual flee speed boost (FLEE_SPEED_MULT) lives in Zombie.js's own
// effectiveSpeed formula, alongside its other speed-multiplier constants.
const CLEAN_SWEEP_TIME_THRESHOLD_MS = 25000
const CLEAN_SWEEP_BONUS_COINS = 200
// Haggle (see _tryHaggle) - a per-visit gamble, not another passive
// discount stacked onto _traderPrice's existing mult/discountMult/
// levelDiscount chain. Streak (consecutive successful haggles across
// visits, not purchases) scales the bonus, capped.
const HAGGLE_SUCCESS_CHANCE = 0.65
const HAGGLE_BASE_DISCOUNT = 0.15
const HAGGLE_STREAK_BONUS_PER_LEVEL = 0.02
const HAGGLE_STREAK_MAX_BONUS = 0.15
// Bounty streak (see _completeBounty) - consecutive completions escalate
// a bonus points reward, capped.
const BOUNTY_STREAK_BONUS_PER_LEVEL = 15
const BOUNTY_STREAK_MAX_BONUS_POINTS = 150
// Black Market rotation (see _rollTraderPrices' own call site) - shows a
// rotating subset instead of the full static BLACK_MARKET_ITEMS list every
// time, re-picked on the same per-night cadence trader prices already use.
const BLACK_MARKET_ROTATION_SIZE = 3
// Cosmetic sell-back (see _renderCosmeticSellback) - Salvage already
// covers crafting-ingredient items; this is the distinct "no longer want
// this owned outfit/hat" case Salvage doesn't touch.
const COSMETIC_SELLBACK_REFUND_MULT = 0.5
// Bulk-purchase combo discount (see _traderPrice) - 3+ different items
// bought in the same trader visit (not the same item repeatedly) discounts
// the rest of that visit.
const BULK_PURCHASE_THRESHOLD = 3
const BULK_PURCHASE_DISCOUNT = 0.08
// Daily Featured Item reroll (see _rerollFeaturedItem) - a small paid
// reroll, once per night (resets the same time _rollFeaturedItem itself
// does).
const FEATURED_ITEM_REROLL_COST = 40
// Rare free bonus item on a big purchase (see the SHOP_ITEMS click handler).
const BIG_PURCHASE_THRESHOLD = 100
const FREE_BONUS_ITEM_CHANCE = 0.1
// Weather & Hazards batch - sandstorm/heatwave roll alongside rain/snow in
// _rollWeather (mutually exclusive with them, same one-roll-picks-one-state
// shape), the rest are periodic checks in the main tick.
const SANDSTORM_CHANCE = 0.1
const SANDSTORM_SPEED_MULT = 0.85
const HEATWAVE_CHANCE = 0.1
const HEATWAVE_THIRST_MULT = 1.8
// Earthquake - a rare mid-night event, not tied to any weather roll.
const EARTHQUAKE_CHECK_INTERVAL_MS = 15000
const EARTHQUAKE_CHANCE = 0.02
const EARTHQUAKE_STUMBLE_RADIUS = 30
const EARTHQUAKE_STUMBLE_MS = 800
// Lightning striking the player directly (see _triggerLightning's own
// existing zombie-flinch effect, which this is additive to, not a
// replacement for) - a small flat chance, independent of position (real
// "am I sheltered" detection would need a raycast up to the sky, out of
// scope for what's meant to be a rare, dramatic risk of being caught out
// in a storm).
const LIGHTNING_PLAYER_STRIKE_CHANCE = 0.08
const LIGHTNING_PLAYER_STRIKE_DAMAGE = 15
// Flash flooding - a temporary global movement slow after sustained rain,
// distinct from a spatial hazard zone (no per-tile puddle placement).
const FLOOD_CHECK_INTERVAL_MS = 20000
const FLOOD_CHANCE = 0.15
const FLOOD_SPEED_MULT = 0.8
const FLOOD_DURATION_MS = 12000
// Insect/rat swarm - periodic minor bite, reuses playerState.takeDamage's
// own existing infection-chance-per-hit rather than a parallel roll.
const SWARM_BITE_CHECK_INTERVAL_MS = 10000
const SWARM_BITE_CHANCE = 0.12
const SWARM_BITE_DAMAGE = 4
// Power surge - the inverse of NightEvents.js's blackout (power loss): an
// overload that drains the generator instantly instead of cutting it
// entirely, a resource hit rather than a full outage.
const POWER_SURGE_CHECK_INTERVAL_MS = 25000
const POWER_SURGE_CHANCE = 0.08
const POWER_SURGE_DRAIN = 35
// Rooftop wind gusts - only while high up (see ROOFTOP_WIND_MIN_HEIGHT),
// a brief camera nudge rather than touching PlayerController's own
// look-input handling.
const ROOFTOP_WIND_MIN_HEIGHT = 8
const ROOFTOP_WIND_CHECK_INTERVAL_MS = 8000
const ROOFTOP_WIND_CHANCE = 0.3
const ROOFTOP_WIND_NUDGE = 0.04
// Perfect Weather - a rare bonus night, rolled alongside the normal
// weather (see _rollWeather), overriding rain/snow/sandstorm/heatwave off
// for the night when it hits.
const PERFECT_WEATHER_CHANCE = 0.05
const PERFECT_WEATHER_LOOT_BONUS_MULT = 1.3
// Flashlight range in heavy rain - a plain multiplier on the SpotLight's
// own .distance, restored the instant rain stops.
const FLASHLIGHT_RAIN_RANGE_MULT = 0.7
const FLASHLIGHT_BASE_RANGE = 35
// Sharing & Content Tools batch.
// Manual slow-motion toggle (see _toggleSlowMo) - a deliberate content-
// creation tool, distinct from the automatic killcam/hitstop slow-mo
// (those are timed and automatic; this is a manual on/off the player
// controls themselves, e.g. while clip-recording something dramatic).
const MANUAL_SLOWMO_FACTOR = 0.4
// Clip recording (see _toggleClipRecording) - a manual start/stop tool,
// deliberately not an always-on rolling buffer: continuously running
// MediaRecorder/canvas.captureStream for the whole session has a real,
// constant encoding cost, a bad tradeoff for a nice-to-have.
const CLIP_RECORDING_FPS = 30
// Auto-highlight moment flagging (see _flagHighlightMoment) - reuses the
// exact same notable-kill categories Kill Feed already classifies (see
// _onZombieKilled's own priority chain), just also logged with a
// timestamp instead of only shown as a transient feed entry.
const HIGHLIGHT_LOG_MAX_ENTRIES = 20
// Photo mode filters (see _cyclePhotoFilter) - plain CSS filter presets
// applied to the canvas element itself, cycled with a key while in photo
// mode.
const PHOTO_FILTERS = ['none', 'grayscale(1)', 'sepia(0.7)', 'contrast(1.4) saturate(1.3)']
// First-time tutorial hint sequence - see _maybeShowTutorialHints.
const TUTORIAL_SEEN_KEY = 'gayz-tutorial-seen'
const TUTORIAL_HINT_START_DELAY_MS = 2500
const TUTORIAL_HINT_INTERVAL_MS = 4200

// Homepage batch - Spotlight ticker tip pool (see _updateMenuSpotlight),
// Seasonal Event Banner windows (month is 0-indexed, JS Date convention),
// What's New badge-dot gate, and the replayable How to Play step sequence
// (distinct from TUTORIAL_SEEN_KEY's one-time toast sequence above).
const SPOTLIGHT_TIPS = ['spotlightTip1', 'spotlightTip2', 'spotlightTip3', 'spotlightTip4', 'spotlightTip5', 'spotlightTip6', 'spotlightTip7', 'spotlightTip8']
// Round 4 Online Features batch - standalone lore/world trivia, distinct
// from SPOTLIGHT_TIPS above (actionable gameplay advice vs. pure flavor).
const TRIVIA_FACTS = ['triviaFact1', 'triviaFact2', 'triviaFact3', 'triviaFact4', 'triviaFact5', 'triviaFact6']
// Pure flavor, day-seeded the same way as TRIVIA_FACTS - a silly one-liner,
// not meant to be taken as real gameplay advice.
const HOROSCOPES = ['horoscope1', 'horoscope2', 'horoscope3', 'horoscope4', 'horoscope5', 'horoscope6']
// Dark-comedy flavor lines, day-seeded the same way as HOROSCOPES/
// TRIVIA_FACTS - pure flavor, not tied to any actual death event.
const DEATH_QUOTES = ['deathQuote1', 'deathQuote2', 'deathQuote3', 'deathQuote4', 'deathQuote5', 'deathQuote6']
// bgMood is reused by _applyBgMood() for the "Auto (Seasonal)" background
// mood default - same date windows as the banner itself rather than a
// second parallel date table, so a season only ever needs updating here.
const EVENT_BANNERS = [
  { month: 9, startDay: 20, endDay: 31, key: 'eventBannerHalloween', bgMood: 'amber' },
  { month: 11, startDay: 15, endDay: 31, key: 'eventBannerWinter', bgMood: 'foggy' },
]
const WHATS_NEW_VERSION = '2026-07-29-homepage'
const WHATS_NEW_SEEN_KEY = 'gayz-whatsnew-seen'
const CHANGELOG_LAST_VIEWED_KEY = 'gayz-changelog-last-viewed'
// Total-lifetime-kills milestones (see _checkKillMilestones) - a one-time
// toast the first homepage render after crossing each, tracked separately
// from CAREER_RANK_TITLES since these are just round-number celebration
// beats, not rank tiers.
const KILL_MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000]
const KILL_MILESTONES_SEEN_KEY = 'gayz-kill-milestones-seen'
const HOWTOPLAY_STEPS = ['htpMove', 'htpShoot', 'htpInventory', 'htpChests', 'htpSurvive']
const SCREENSHOT_GALLERY_KEY = 'gayz-screenshot-gallery'

function _loadScreenshotGallery() {
  try {
    const raw = localStorage.getItem(SCREENSHOT_GALLERY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function _saveScreenshotGallery(list) {
  try {
    localStorage.setItem(SCREENSHOT_GALLERY_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable (or quota exceeded by the data-URL thumbnails) -
    // the gallery just won't persist across sessions.
  }
}

// Nearly There nudge (Profile panel) - deliberately a small curated list,
// not every achievement: most ACHIEVEMENTS conditions are per-run counters
// (this.totalKills, this.stealthTakedowns, etc.) that reset every session,
// so showing "progress" toward them would be misleading. These two are the
// ones with genuinely persistent, numeric backing (see the audit comments
// at their own unlock() call sites in _onZombieKilled/the outfit-buy
// handler).
const NEARLY_THERE_CANDIDATES = [
  { achievementId: 'bestiary_master', current: (g) => g.bestiaryEncountered.size, total: (g) => Object.keys(ZOMBIE_TYPES).length },
  { achievementId: 'fashion_icon', current: (g) => g.ownedOutfits.size, total: (g) => COIN_SHOP_ITEMS.filter((i) => i.outfit).length },
]

// Goals checklist (Profile panel, see settings.selectedGoals) - a wider
// candidate pool than NEARLY_THERE_CANDIDATES since these are player-picked
// (not auto-surfaced achievement hints), so they don't need the same
// "genuinely persistent, always-visible" bar - any honestly-derivable
// lifetime metric with a sensible target qualifies. Pick any 3.
const GOAL_CANDIDATES = [
  { id: 'goal_kills10k', titleKey: 'goalKills10k', current: (g) => g.careerStats.totalKills, total: () => 10000 },
  { id: 'goal_achievements50', titleKey: 'goalAchievements50', current: (g) => g.achievements.unlocked.size, total: () => ACHIEVEMENTS.length },
  { id: 'goal_rankElite', titleKey: 'goalRankElite', current: (g) => g.careerStats.totalKills, total: () => 15000 },
  { id: 'goal_masterFive', titleKey: 'goalMasterFive', current: (g) => g.weaponMastery.mastered.size + g.weaponMastery.grandmastered.size, total: () => 5 },
  { id: 'goal_night10', titleKey: 'goalNight10', current: (g) => g.bestStats.bestNight, total: () => 10 },
  { id: 'goal_coins100k', titleKey: 'goalCoins100k', current: (g) => g.careerStats.lifetimeCoinsEarned, total: () => 100000 },
  { id: 'goal_playtime10h', titleKey: 'goalPlaytime10h', current: (g) => g.careerStats.lifetimePlaytimeSeconds, total: () => 36000 },
  { id: 'goal_runs50', titleKey: 'goalRuns50', current: (g) => g.careerStats.totalRuns, total: () => 50 },
  { id: 'goal_bestiaryFull', titleKey: 'goalBestiaryFull', current: (g) => g.bestiaryEncountered.size, total: () => Object.keys(ZOMBIE_TYPES).length },
  { id: 'goal_streak30', titleKey: 'goalStreak30', current: (g) => g.bestStats.bestKillStreak, total: () => 30 },
]

// Cloud Save (see CloudSync.js) - just a display-only "when did we last
// push" timestamp. The signed-in account itself needs no local caching -
// Firebase Auth persists its own session (IndexedDB) and CloudSync's
// onAuthChange restores _cloudProfile/_cloudUid from that directly.
export const CLOUD_LAST_SYNC_KEY = 'gayz-cloud-last-sync'
// Rank velocity arrow (see _renderPlayerTag) - the rank as of the last
// time it was fetched, so this visit's fetch can compare against it.
const PREV_GLOBAL_RANK_KEY = 'gayz-prev-global-rank'

// Online Features batch - one hardcoded, developer-authored poll (not
// user-generated content, so no moderation surface beyond picking a new
// POLL_ID + option set for the next one). Changing POLL_ID starts a fresh
// vote count from zero rather than resetting the old one's votes.
const POLL_ID = 'next-feature-2026'
const POLL_OPTIONS = [
  { id: 'more_bosses', labelKey: 'pollOptionMoreBosses' },
  { id: 'new_map_area', labelKey: 'pollOptionNewMapArea' },
  { id: 'more_weapons', labelKey: 'pollOptionMoreWeapons' },
  { id: 'coop_multiplayer', labelKey: 'pollOptionCoop' },
]

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
// Weapon weight (see PlayerController's weaponWeightMult) - set live every
// frame from whichever gun is currently equipped (WeaponSystem's `heavy`/
// `light` flags), same "recomputed every frame, no timer" shape as
// corpsePileMult above. Neither flag set (most guns, all melee) is neutral.
const WEAPON_HEAVY_SPEED_MULT = 0.85
const WEAPON_LIGHT_SPEED_MULT = 1.08
// Run Score Multiplier (see _comboMultiplier) - a points-only bonus layered
// on top of the existing on-screen combo counter (this.comboCount, see
// _registerComboKill) rather than a second parallel "kills close together"
// tracker - that counter was purely cosmetic before this, never affecting
// actual rewards.
const COMBO_MULT_PER_KILL = 0.15
const COMBO_MULT_CAP = 2.5
const DAMAGE_NUMBER_MAX_CONCURRENT = 40
// Throttled minimap/compass redraw (see the main tick) - ~20fps instead of
// every frame.
const PERIPHERAL_UI_UPDATE_INTERVAL_MS = 50
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
// Breakable Glass Case - same "shootable prop with its own health pool,
// removed from colliders/solidMeshes once broken" shape as the
// destructible wall above, just fragile (breaks in 1-2 hits from nearly
// any weapon, unlike the wall's much higher pool) and gated behind loot
// instead of a shortcut. Standalone structure (own frame + glass, not
// touching any existing building) at a verified-clear spot, same
// reasoning the Elevator Tower's placement already established.
const GLASS_CASE_HEALTH = 20
// Zipline - reuses the exact position-teleport fast travel already has
// (see the fullMapCanvas click handler) rather than new traversal physics,
// bi-directional between 2 fixed points connected by a purely decorative
// cable (no collider - see _buildZipline's own note).
const ZIPLINE_INTERACT_RADIUS = 3

// Interactive World batch - module-level constants for the 10 new props/
// mechanics, grouped together here rather than scattered at each usage
// site, since most of these are small and share this same neighborhood.
const MANHOLE_INTERACT_RADIUS = 1.6
const CAMPFIRE_INTERACT_RADIUS = 3
// Rested buff - a flat stamina refill + short regen boost, distinct from
// any perk/upgrade (free, repeatable, but gated by its own cooldown so it
// can't just be stood in for a permanent regen loop).
const CAMPFIRE_REST_COOLDOWN_MS = 45000
const CAMPFIRE_REST_HEAL = 25
const WATER_TOWER_VALVE_RADIUS = 2
const WATER_TOWER_PUDDLE_RADIUS = 7
const WATER_TOWER_PUDDLE_DURATION_MS = 12000
const INDUSTRIAL_SIREN_RADIUS = 2
// Siren risk/reward - a deliberate opt-in difficulty spike (see
// buildIndustrialSiren's own comment) in exchange for a temporary loot
// multiplier, applied the same way DOUBLE_POINTS/other timed multipliers
// already are (a plain "until" timestamp checked at the award site).
const SIREN_BONUS_LOOT_MULT = 1.5
const SIREN_BONUS_DURATION_MS = 25000
const SIREN_SURGE_COUNT = 4
const WRECKING_PENDULUM_RADIUS = 2.5
const PENDULUM_SWING_DURATION_MS = 1800
const PENDULUM_HIT_RADIUS = 2.2
const PENDULUM_DAMAGE = 60
const SCAFFOLDING_COLLAPSE_RADIUS = 2.4
// Elevator Tower - see _rideElevator/_updateElevatorTower. Radius checked
// against the car's own CURRENT x/z+y (not just x/z) since the car and
// deck occupy different footprints - being near the tower isn't enough,
// the player has to actually be standing where the car currently is.
const ELEVATOR_INTERACT_RADIUS = 1.6
const ELEVATOR_RIDE_DURATION_MS = 1800
// Ladder (see PlayerController's isOnLadder) - pure XZ proximity to the
// tower's fixed ladder point, independent of current height, so grabbing
// on works approaching from the ground OR already partway/fully up.
const LADDER_RADIUS = 0.6
const SCAFFOLDING_COLLAPSE_DAMAGE = 70
const PAYPHONE_INTERACT_RADIUS = 2
const PAYPHONE_CALL_DELAY_MS = 20000
const BARRICADE_CRATE_HEALTH = 150
const BARRICADE_CRATE_PLACE_DIST = 1.5
const BARRICADE_CRATE_INTERACT_RADIUS = 2.2
const BARRICADE_CRATE_CHIP_PER_SEC = 12

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
// Diseased Survivor - see RescueSurvivor.js's signal-color tell and
// _rescueSurvivor's infection roll. Noticeably higher than a normal
// zombie hit's own INFECTION_CHANCE_PER_HIT (0.12, PlayerState.js) - a
// real gamble, not just a different-flavored version of the same odds.
const DISEASED_SURVIVOR_CHANCE = 0.3
const DISEASED_INFECTION_CHANCE = 0.35
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

// Human "X ago" phrasing (Cloud Save's last-synced line) - distinct from
// formatTime above, which is MM:SS run-clock formatting and would render
// nonsense like "1440:00" for a sync from a day ago.
export function _formatRelativeTime(ms) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return t('relativeTimeJustNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('relativeTimeMinutes', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('relativeTimeHours', { n: hr })
  return t('relativeTimeDays', { n: Math.floor(hr / 24) })
}

// Escapes player-entered text (the nickname field, and - since the Local
// Sharing batch - any name/text field that could round-trip through an
// uploaded save file) before it goes into any template string, rather than
// interpolating it raw.
export function _escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// Coerces an untrusted value to a plain finite number before it's allowed
// anywhere near an innerHTML template (see _compareSaveFile) - it reads
// stat-shaped fields
// (night/kills/bestNight/totalKills) that, unlike free-form name text
// above, are supposed to always be numbers, so coercion is both the
// correctness fix (a string here is already wrong data) and the security
// fix (a coerced number can never carry markup) in one step. An uploaded
// save file is fully attacker-controlled - nothing in it should reach
// innerHTML unescaped or untyped.
// Formats a whole-seconds duration as "Xh Ym" (or just "Ym"/"Ys" for
// anything under an hour) - shared by the Profile panel's Longest Session
// and Average Run Length rows so the two use identical formatting.
function _formatDurationShort(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${totalSeconds}s`
}

export function _safeStatNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// Profile panel grouping (see _openProfilePanel) - every stat row's stable
// id (the first element of its row tuple) mapped to one of 4 categories,
// rendered in PROFILE_GROUP_ORDER's fixed order. A row with no entry here
// falls back to Social & Meta (the catch-all group) rather than being
// silently dropped, so a future new row can't vanish from the panel just
// because this table wasn't updated for it.
const PROFILE_STAT_GROUPS = {
  profileTotalKills: 'combat',
  profileBestKills: 'combat',
  profileBestKillStreak: 'combat',
  profileBestStreakDate: 'combat',
  profileFavoriteWeapon: 'combat',
  profileKillsPerMin: 'combat',
  profileWeaponsMastered: 'combat',
  profileDeadliestEnemy: 'combat',
  profileDamageDealt: 'combat',
  profileAccuracy: 'combat',
  profileTotalRuns: 'survival',
  profileBestNight: 'survival',
  profilePlaytime: 'survival',
  profileDistance: 'survival',
  profileFlawlessRuns: 'survival',
  profileWinRate: 'survival',
  profileLongestSession: 'survival',
  profileAvgRunLength: 'survival',
  profileLaps: 'survival',
  profileNetWorth: 'economy',
  profileTotalSpent: 'economy',
  profileCoinsRatio: 'economy',
  profileCoinsToday: 'economy',
  profileMostProfitableRun: 'economy',
  profileAchievements: 'socialMeta',
  profileCosmetics: 'socialMeta',
  profilePrestige: 'socialMeta',
  profileNemesisLabel: 'socialMeta',
  profileSecretsFound: 'socialMeta',
  profileCompletionPct: 'socialMeta',
  profileCompanionLegacy: 'socialMeta',
  profileMostUsedMutator: 'socialMeta',
  profileLastPlayed: 'socialMeta',
  profileTimesRevivedCompanion: 'socialMeta',
  profileFavoriteCompanionRole: 'socialMeta',
  profileFavoriteDayOfWeek: 'socialMeta',
  profilePlayClicks: 'socialMeta',
}
const PROFILE_GROUP_ORDER = [
  ['combat', 'profileGroupCombat'],
  ['survival', 'profileGroupSurvival'],
  ['economy', 'profileGroupEconomy'],
  ['socialMeta', 'profileGroupSocialMeta'],
]

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
    // opacity:0 + a transition (not display:none) - both start hidden on
    // the main menu and fade in once Play is clicked (see that handler),
    // rather than popping in instantly or cluttering the homepage.
    this.fpsEl = document.createElement('div')
    this.fpsEl.id = 'fps-counter'
    this.fpsEl.style.cssText = 'position:fixed;top:6px;left:6px;background:rgba(0,0,0,0.55);color:#7fd88f;font:13px monospace;padding:3px 7px;border-radius:4px;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.8s ease;'
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
    this.coordsEl.style.cssText = 'position:fixed;top:28px;left:6px;background:rgba(0,0,0,0.55);color:#8fc8ff;font:13px monospace;padding:3px 7px;border-radius:4px;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.8s ease;'
    this.coordsEl.textContent = 'x:0 z:0 y:0'
    document.body.appendChild(this.coordsEl)
    // Frame-Time Graph (opt-in, see settings.frameTimeGraph) - same
    // fixed-position/opacity-fade pattern as fpsEl/coordsEl above, a
    // small canvas sparkline instead of text.
    this.frameTimeCanvas = document.createElement('canvas')
    this.frameTimeCanvas.id = 'frame-time-canvas'
    this.frameTimeCanvas.width = 120
    this.frameTimeCanvas.height = 30
    this.frameTimeCanvas.style.cssText = 'position:fixed;top:50px;left:6px;background:rgba(0,0,0,0.55);border-radius:4px;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.8s ease;'
    document.body.appendChild(this.frameTimeCanvas)
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
    // Graphics tab's manual Resolution slider (50-100%) - see
    // _applyRenderScale's own comment on why this is a separate
    // multiplier from _dynResScale above, not a revival of it. Placeholder
    // 1 here (this.settings doesn't exist yet at this point in the
    // constructor) - the real value is set from this.settings right after
    // the renderer itself is created, below.
    this._userResScale = 1
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
    this._damageNumberVec = new THREE.Vector3()
    // Pooled damage-number DOM nodes (see _spawnDamageNumber) - built once
    // up front at exactly DAMAGE_NUMBER_MAX_CONCURRENT capacity, cycled
    // through round-robin instead of createElement/remove per hit.
    this._damageNumberPool = []
    for (let i = 0; i < DAMAGE_NUMBER_MAX_CONCURRENT; i++) {
      const el = document.createElement('div')
      el.style.display = 'none'
      this.damageNumbersEl.appendChild(el)
      this._damageNumberPool.push(el)
    }
    this._damageNumberPoolIndex = 0
    this.hudEl = document.getElementById('hud')
    this.hotbarEl = document.getElementById('hotbar')
    this.hotbarSlotEls = Array.from(this.hotbarEl.querySelectorAll('.hotbar-slot'))
    // _updateHotbarHud runs every frame - resolve each slot's name element
    // once here instead of a fresh querySelector per slot per frame (the
    // DOM structure itself never changes after this point).
    this.hotbarNameEls = this.hotbarSlotEls.map((el) => el.querySelector('.hotbar-slot-name'))
    this.hotbarPowerScoreEl = document.getElementById('hotbar-power-score')
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
    this.compassVault = document.getElementById('compass-vault')
    this.hordeIndicatorEl = document.getElementById('horde-indicator')
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
    this.sandstormOverlayEl = document.getElementById('sandstorm-overlay')
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
    // Main menu redesign - hero stat pair + left-column "Your Stats" panel
    // + player badge, replacing the old single menu-best-stats text blob.
    this.heroBestNight = document.getElementById('hero-best-night')
    this.heroBestStreak = document.getElementById('hero-best-streak')
    // Each of these now renders in TWO places (homepage Your Stats panel +
    // Profile panel's stats column) sharing one data-stat attribute rather
    // than duplicate ids, so querySelectorAll + forEach keeps both in sync.
    this.statLongestSurvival = document.querySelectorAll('[data-stat="longest-survival"]')
    this.statTotalKills = document.querySelectorAll('[data-stat="total-kills"]')
    this.statRunsPlayed = document.querySelectorAll('[data-stat="runs-played"]')
    this.statFavoriteClass = document.querySelectorAll('[data-stat="favorite-class"]')
    this.statLastRun = document.querySelectorAll('[data-stat="last-run"]')
    this.menuAvatarLevel = document.getElementById('menu-avatar-level')
    this.menuAvatarPhoto = document.getElementById('menu-avatar-photo')
    this.menuPlayerTag = document.getElementById('menu-player-tag')
    this.menuCareerRank = document.getElementById('menu-career-rank')
    this.menuPrestigeBadge = document.getElementById('menu-prestige-badge')
    this.menuNewsTicker = document.getElementById('menu-news-ticker')
    this.weeklyFeaturedMutatorLine = document.getElementById('weekly-featured-mutator-line')
    // Homepage batch - Continue card, Recommended Difficulty hint, Loadout
    // Presets, quick-access icons, Achievement Showcase, Season Progress,
    // Spotlight ticker, Event Banner, What's New dot, How to Play, and the
    // Profile screenshot gallery. See each feature's own method for how
    // these get populated.
    this.continueActions = document.getElementById('continue-actions')
    this.playAgainBtn = document.getElementById('play-again-btn')
    this.shareLastRunBtn = document.getElementById('share-last-run-btn')
    this.shareCardBtn = document.getElementById('share-card-btn')
    this.recommendedDifficultyHint = document.getElementById('recommended-difficulty-hint')
    this.menuPresetRow = document.getElementById('menu-preset-row')
    this.savePresetBtn = document.getElementById('save-preset-btn')
    this.surpriseMeBtn = document.getElementById('surprise-me-btn')
    this.quickKeybindsBtn = document.getElementById('quick-keybinds-btn')
    this.menuPresetChips = document.getElementById('menu-preset-chips')
    this.quickMuteBtn = document.getElementById('quick-mute-btn')
    this.quickColorblindBtn = document.getElementById('quick-colorblind-btn')
    this.howtoplayBtn = document.getElementById('howtoplay-btn')
    this.howtoplayPanel = document.getElementById('howtoplay-panel')
    this.howtoplayPanelTitle = document.getElementById('howtoplay-panel-title')
    this.howtoplayStepContent = document.getElementById('howtoplay-step-content')
    this.howtoplayDots = document.getElementById('howtoplay-dots')
    this.howtoplayBackBtn = document.getElementById('howtoplay-back-btn')
    this.howtoplayNextBtn = document.getElementById('howtoplay-next-btn')
    this.howtoplayCloseBtn = document.getElementById('howtoplay-close-btn')
    this.seasonProgressFill = document.getElementById('season-progress-fill')
    this.menuSpotlight = document.getElementById('menu-spotlight')
    this.menuSpotlightPauseBtn = document.getElementById('menu-spotlight-pause-btn')
    this.weeklyProgressTrack = document.getElementById('weekly-progress-track')
    this.weeklyProgressFill = document.getElementById('weekly-progress-fill')
    if (this.menuSpotlightPauseBtn) {
      this.menuSpotlightPauseBtn.addEventListener('click', () => {
        this._spotlightPaused = !this._spotlightPaused
        this.menuSpotlightPauseBtn.innerHTML = this._spotlightPaused
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6,4 20,12 6,20"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        this.menuSpotlightPauseBtn.setAttribute('aria-label', this._spotlightPaused ? 'Resume ticker' : 'Pause ticker')
      })
    }
    this.eventBanner = document.getElementById('event-banner')
    this.whatsNewDot = document.getElementById('whats-new-dot')
    this.profileScreenshotGallery = document.getElementById('profile-screenshot-gallery')
    this.profileGalleryTitle = document.getElementById('profile-gallery-title')
    this.menuScreenshotGallery = document.getElementById('menu-screenshot-gallery')
    // Second Homepage batch - login streak badge, nav completion rings,
    // season-progress countdown label, Player Title picker, Nearly There
    // nudge, Weekly Recap, Recent Activity feed, and the 2 new quick-action
    // icons (performance/language).
    this.menuLoginStreak = document.getElementById('menu-login-streak')
    this.achievementsCompletionRing = document.getElementById('achievements-completion-ring')
    this.cosmeticsCompletionRing = document.getElementById('cosmetics-completion-ring')
    this.questsCompletionRing = document.getElementById('quests-completion-ring')
    this.cosmeticsNavCount = document.getElementById('cosmetics-nav-count')
    this.achievementsNavCount = document.getElementById('achievements-nav-count')
    this.questsNavCount = document.getElementById('quests-nav-count')
    this.seasonProgressLabel = document.getElementById('season-progress-label')
    this.profileAvatarHeading = document.getElementById('profile-avatar-heading')
    this.profileAvatarRow = document.getElementById('profile-avatar-row')
    this.profileBioHeading = document.getElementById('profile-bio-heading')
    this.profileBioInput = document.getElementById('profile-bio-input')
    this.profileBioCounter = document.getElementById('profile-bio-counter')
    this.profileNearlyThereList = document.getElementById('profile-nearly-there-list')
    this.profileAnniversaryLine = document.getElementById('profile-anniversary-line')
    this.profileTodayLine = document.getElementById('profile-today-line')
    this.profilePercentileLine = document.getElementById('profile-percentile-line')
    this.profilePercentileBar = document.getElementById('profile-percentile-bar')
    this.profileFavoriteDifficultyLine = document.getElementById('profile-favorite-difficulty-line')
    this.profileBestRunCard = document.getElementById('profile-best-run-card')
    this.profileBestRunTitle = document.getElementById('profile-best-run-title')
    this.profileBestRunLine = document.getElementById('profile-best-run-line')
    this.profileCreatedTitle = document.getElementById('profile-created-title')
    this.profileCreatedLine = document.getElementById('profile-created-line')
    this.profileWeeklyRecapTitle = document.getElementById('profile-weekly-recap-title')
    this.profileWeeklyRecapLine = document.getElementById('profile-weekly-recap-line')
    this.profileWeeklyDeltaLine = document.getElementById('profile-weekly-delta-line')
    this.profileAccountSignedOut = document.getElementById('profile-account-signed-out')
    this.profileAccountSignedIn = document.getElementById('profile-account-signed-in')
    this.profileLoginBtn = document.getElementById('profile-login-btn')
    this.profileRegisterBtn = document.getElementById('profile-register-btn')
    this.profileSignoutBtn = document.getElementById('profile-signout-btn')
    this.quickPerformanceBtn = document.getElementById('quick-performance-btn')
    this.quickLanguageBtn = document.getElementById('quick-language-btn')
    // Cloud Save (Google Sign-In + Drive appDataFolder, see CloudSync.js).
    this.quickCloudBtn = document.getElementById('quick-cloud-btn')
    this.cloudSignedInDot = document.getElementById('cloud-signed-in-dot')
    this.cloudsavePanel = document.getElementById('cloudsave-panel')
    this.cloudsavePanelTitle = document.getElementById('cloudsave-panel-title')
    this.cloudsaveSignedOut = document.getElementById('cloudsave-signed-out')
    this.cloudsaveSignedOutDesc = document.getElementById('cloudsave-signed-out-desc')
    this.cloudsaveSigninBtn = document.getElementById('cloudsave-signin-btn')
    this.cloudsaveSignedIn = document.getElementById('cloudsave-signed-in')
    this.cloudsaveAvatar = document.getElementById('cloudsave-avatar')
    this.cloudsaveAccountName = document.getElementById('cloudsave-account-name')
    this.cloudsaveSyncStatus = document.getElementById('cloudsave-sync-status')
    this.cloudsaveConflict = document.getElementById('cloudsave-conflict')
    this.cloudsaveConflictDesc = document.getElementById('cloudsave-conflict-desc')
    this.cloudsaveUseCloudBtn = document.getElementById('cloudsave-use-cloud-btn')
    this.cloudsaveUseLocalBtn = document.getElementById('cloudsave-use-local-btn')
    this.cloudsaveSyncNowBtn = document.getElementById('cloudsave-sync-now-btn')
    this.cloudsaveSignoutBtn = document.getElementById('cloudsave-signout-btn')
    // Online Features batch (leaderboard, weekly ranking, friend compare,
    // global kill counter, community poll) - see _renderCloudOnlineSection.
    this.cloudsaveOnlineSection = document.getElementById('cloudsave-online-section')
    this.cloudsaveGlobalKills = document.getElementById('cloudsave-global-kills')
    this.cloudsaveRankLine = document.getElementById('cloudsave-rank-line')
    this.cloudsaveRivalLine = document.getElementById('cloudsave-rival-line')
    this.cloudsaveNearbyRankTitle = document.getElementById('cloudsave-nearby-rank-title')
    this.cloudsaveNearbyRankList = document.getElementById('cloudsave-nearby-rank-list')
    this.cloudsaveRandomOpponentBtn = document.getElementById('cloudsave-random-opponent-btn')
    this.cloudsaveOfflineWarning = document.getElementById('cloudsave-offline-warning')
    this.cloudsaveAvgLine = document.getElementById('cloudsave-avg-line')
    this.cloudsaveAvgBars = document.getElementById('cloudsave-avg-bars')
    this.cloudsaveRegionSelect = document.getElementById('cloudsave-region-select')
    this.cloudsaveAchievementsLeaderboardTitle = document.getElementById('cloudsave-achievements-leaderboard-title')
    this.cloudsaveAchievementsLeaderboardList = document.getElementById('cloudsave-achievements-leaderboard-list')
    this.cloudsaveSavedFriends = document.getElementById('cloudsave-saved-friends')
    this.cloudsaveFriendSaveBtn = document.getElementById('cloudsave-friend-save-btn')
    this.cloudsaveLeaderboardTitle = document.getElementById('cloudsave-leaderboard-title')
    this.cloudsaveLeaderboardList = document.getElementById('cloudsave-leaderboard-list')
    this.cloudsaveWeeklyLeaderboardList = document.getElementById('cloudsave-weekly-leaderboard-list')
    this.cloudsaveWeeklyLeaderboardTitle = document.getElementById('cloudsave-weekly-leaderboard-title')
    this.cloudsaveFriendTitle = document.getElementById('cloudsave-friend-title')
    this.cloudsaveFriendInput = document.getElementById('cloudsave-friend-input')
    this.cloudsaveFriendCompareBtn = document.getElementById('cloudsave-friend-compare-btn')
    this.cloudsaveFriendResult = document.getElementById('cloudsave-friend-result')
    this.cloudsavePollTitle = document.getElementById('cloudsave-poll-title')
    this.cloudsavePollOptions = document.getElementById('cloudsave-poll-options')
    this.cloudsavePollHint = document.getElementById('cloudsave-poll-hint')
    // In-memory only - Firebase Auth owns the real session (IndexedDB);
    // these just mirror it for convenience (see CloudSync.onAuthChange).
    this._cloudProfile = null
    this._cloudUid = null
    this._cloudPendingConflict = null
    this._cloudGlobalRank = null
    // "Today" session stats (round 4 Online Features batch) - deliberately
    // session-local only (reset on every page load, never persisted) -
    // distinct from the lifetime careerStats totals shown elsewhere.
    this._sessionKills = 0
    this._sessionStartTime = performance.now()
    this._leaderboardUnsubscribe = null
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
    this.musicTestBtn = document.getElementById('music-test-btn')
    this.sfxVolumeSlider = document.getElementById('sfx-volume')
    this.sfxVolumeValue = document.getElementById('sfx-volume-value')
    this.sfxTestBtn = document.getElementById('sfx-test-btn')
    this.sensitivitySlider = document.getElementById('sensitivity-slider')
    this.sensitivityValue = document.getElementById('sensitivity-value')
    this.invertYToggle = document.getElementById('invert-y-toggle')
    this.fovSlider = document.getElementById('fov-slider')
    this.fovValue = document.getElementById('fov-value')
    this.hudScaleSlider = document.getElementById('hud-scale-slider')
    this.hudScaleValue = document.getElementById('hud-scale-value')
    this.hudOpacitySlider = document.getElementById('hud-opacity-slider')
    this.hudOpacityValue = document.getElementById('hud-opacity-value')
    this.colorblindToggle = document.getElementById('colorblind-toggle')
    this.largeTextToggle = document.getElementById('large-text-toggle')
    this.highContrastToggle = document.getElementById('high-contrast-toggle')
    this.focusRingToggle = document.getElementById('focus-ring-toggle')
    this.underlineLinksToggle = document.getElementById('underline-links-toggle')
    this.homepageFpsToggle = document.getElementById('homepage-fps-toggle')
    this.bgMoodSelect = document.getElementById('bg-mood-select')
    this.dyslexiaFontToggle = document.getElementById('dyslexia-font-toggle')
    this.keybindCheatsheetToggle = document.getElementById('keybind-cheatsheet-toggle')
    this.keybindCheatsheet = document.getElementById('keybind-cheatsheet')
    this.hitFeedbackToggle = document.getElementById('hit-feedback-toggle')
    this.performanceToggle = document.getElementById('performance-toggle')
    this.shakeIntensitySlider = document.getElementById('shake-intensity-slider')
    this.shakeIntensityValue = document.getElementById('shake-intensity-value')
    this.reduceFlashingToggle = document.getElementById('reduce-flashing-toggle')
    // Graphics tab (see _bindGraphicsSettings)
    this.gfxResolutionSlider = document.getElementById('gfx-resolution-slider')
    this.gfxResolutionValue = document.getElementById('gfx-resolution-value')
    this.gfxBrightnessSlider = document.getElementById('gfx-brightness-slider')
    this.gfxBrightnessValue = document.getElementById('gfx-brightness-value')
    this.gfxContrastSlider = document.getElementById('gfx-contrast-slider')
    this.gfxContrastValue = document.getElementById('gfx-contrast-value')
    this.gfxAoSlider = document.getElementById('gfx-ao-slider')
    this.gfxAoValue = document.getElementById('gfx-ao-value')
    this.gfxShadowsToggle = document.getElementById('gfx-shadows-toggle')
    this.gfxShadowQualitySelect = document.getElementById('gfx-shadow-quality-select')
    this.gfxBulletHolesToggle = document.getElementById('gfx-bullet-holes-toggle')
    this.gfxBloodToggle = document.getElementById('gfx-blood-toggle')
    this.gfxDamageIndicatorToggle = document.getElementById('gfx-damage-indicator-toggle')
    this.gfxDamageNumbersToggle = document.getElementById('gfx-damage-numbers-toggle')
    this.gfxDamageNumbersScaleSlider = document.getElementById('gfx-damage-numbers-scale-slider')
    this.gfxDamageNumbersScaleValue = document.getElementById('gfx-damage-numbers-scale-value')
    this.gfxGrainSlider = document.getElementById('gfx-grain-slider')
    this.gfxGrainValue = document.getElementById('gfx-grain-value')
    this.gfxPanelFlickerToggle = document.getElementById('gfx-panel-flicker-toggle')
    this.resetGraphicsDefaultsBtn = document.getElementById('reset-graphics-defaults-btn')
    this.streamSafeModeToggle = document.getElementById('stream-safe-mode-toggle')
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
    this.nicknameColorPicker = document.getElementById('nickname-color-picker')
    this.companionColorPicker = document.getElementById('companion-color-picker')
    this.companionColorPreview = document.getElementById('companion-color-preview')
    this.companionNameColorPicker = document.getElementById('companion-name-color-picker')
    this.accentColorPicker = document.getElementById('accent-color-picker')
    this.accentColorResetBtn = document.getElementById('accent-color-reset-btn')
    this.playBtnColorPicker = document.getElementById('play-btn-color-picker')
    this.playBtnColorResetBtn = document.getElementById('play-btn-color-reset-btn')
    this.nicknameFontSelect = document.getElementById('nickname-font-select')
    this.layoutDensitySelect = document.getElementById('layout-density-select')
    this.mottoInput = document.getElementById('motto-input')
    this.randomNicknameBtn = document.getElementById('random-nickname-btn')
    this.bioPresetSaveBtn = document.getElementById('bio-preset-save-btn')
    this.bioPresetChips = document.getElementById('bio-preset-chips')
    this.recentUnlocksHeading = document.getElementById('recent-unlocks-heading')
    this.recentUnlocksList = document.getElementById('recent-unlocks-list')
    this.prestigeHistoryHeading = document.getElementById('prestige-history-heading')
    this.prestigeHistoryList = document.getElementById('prestige-history-list')
    this.highlightReelHeading = document.getElementById('highlight-reel-heading')
    this.highlightReelList = document.getElementById('highlight-reel-list')
    this.pinnedStatSelect = document.getElementById('pinned-stat-select')
    this.navOrderList = document.getElementById('nav-order-list')
    this.settingsSearchInput = document.getElementById('settings-search-input')
    this.recentlyChangedList = document.getElementById('recently-changed-list')
    this.exportKeybindsBtn = document.getElementById('export-keybinds-btn')
    this.importKeybindsBtn = document.getElementById('import-keybinds-btn')
    this.importKeybindsInput = document.getElementById('import-keybinds-input')
    this.importKeybindsApplyBtn = document.getElementById('import-keybinds-apply-btn')
    this.resetAudioDefaultsBtn = document.getElementById('reset-audio-defaults-btn')
    this.resetControlsDefaultsBtn = document.getElementById('reset-controls-defaults-btn')
    this.uiFontSelect = document.getElementById('ui-font-select')
    this.textSpacingSlider = document.getElementById('text-spacing-slider')
    this.textSpacingValue = document.getElementById('text-spacing-value')
    this.buttonSizeSlider = document.getElementById('button-size-slider')
    this.buttonSizeValue = document.getElementById('button-size-value')
    this.reduceTransparencyToggle = document.getElementById('reduce-transparency-toggle')
    this.hoverAudioCueToggle = document.getElementById('hover-audio-cue-toggle')
    this.highVisCursorToggle = document.getElementById('high-vis-cursor-toggle')
    this.captionBackgroundToggle = document.getElementById('caption-background-toggle')
    this.themePresetSelect = document.getElementById('theme-preset-select')
    this.cursorTrailToggle = document.getElementById('cursor-trail-toggle')
    this.crtScanlinesToggle = document.getElementById('crt-scanlines-toggle')
    this.weatherParticlesToggle = document.getElementById('weather-particles-toggle')
    this.nicknameInput = document.getElementById('nickname-input')
    this.companionNameInput = document.getElementById('companion-name-input')
    this.challengeCodeInput = document.getElementById('challenge-code-input')
    this.scoreAttackToggle = document.getElementById('score-attack-toggle')
    this.hardcoreToggle = document.getElementById('hardcore-toggle')
    this.guestModeToggle = document.getElementById('guest-mode-toggle')
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
    this.restoreDefaultsBtn = document.getElementById('restore-defaults-btn')
    this.resetProgressBtn = document.getElementById('reset-progress-btn')
    this._resetProgressArmed = false
    // Local Sharing batch.
    this.exportSaveBtn = document.getElementById('export-save-btn')
    this.importSaveBtn = document.getElementById('import-save-btn')
    this.importSaveInput = document.getElementById('import-save-input')
    this.compareSaveBtn = document.getElementById('compare-save-btn')
    this.compareSaveInput = document.getElementById('compare-save-input')
    this.compareSaveResult = document.getElementById('compare-save-result')
    this.storageUsageLine = document.getElementById('storage-usage-line')
    this.storageQuotaWarning = document.getElementById('storage-quota-warning')
    this.copySaveBtn = document.getElementById('copy-save-btn')
    this.exportSettingsCodeBtn = document.getElementById('export-settings-code-btn')
    this.importSettingsCodeBtn = document.getElementById('import-settings-code-btn')
    this.importSettingsCodeInput = document.getElementById('import-settings-code-input')
    this.importSettingsCodeApplyBtn = document.getElementById('import-settings-code-apply-btn')
    this.clearLeaderboardsBtn = document.getElementById('clear-leaderboards-btn')
    this.profilePrintBtn = document.getElementById('profile-print-btn')
    this.printStatsSheet = document.getElementById('print-stats-sheet')
    this.copyTextRecapBtn = document.getElementById('copy-text-recap-btn')
    this.acceptChallengeBtn = document.getElementById('accept-challenge-btn')
    this.loadoutCodeInput = document.getElementById('loadout-code-input')
    this.applyLoadoutCodeBtn = document.getElementById('apply-loadout-code-btn')
    this.sharePanel = document.getElementById('share-panel')
    this.sharePanelTitle = document.getElementById('share-panel-title')
    this.openShareBtn = document.getElementById('open-share-btn')
    this.shareSetupBtn = document.getElementById('share-setup-btn')
    this.shareProfileBtn = document.getElementById('share-profile-btn')
    this.shareChallengeBtn = document.getElementById('share-challenge-btn')
    this.shareLoadoutBtn = document.getElementById('share-loadout-btn')
    this.sharePageLinkBtn = document.getElementById('share-page-link-btn')
    this.screenFadeEl = document.getElementById('screen-fade')
    this.cinematicBarsEl = document.getElementById('cinematic-bars')
    this.tutorialHintEl = document.getElementById('tutorial-hint')
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
    // First-ever load on this device - captured once, right here, so it's
    // accurate even for a player who never finishes a run (see
    // accountCreatedAt's own comment in loadCareerStats).
    if (!this.careerStats.accountCreatedAt) {
      this.careerStats.accountCreatedAt = Date.now()
      saveCareerStats(this.careerStats)
    }
    this.runHistory = loadRunHistory()
    this.companionLegacy = loadCompanionLegacy()
    this.narrativeStats = loadNarrativeStats()
    this.loginStreak = loadLoginStreak()
    this.leaderboard = loadLeaderboard()
    this.bossRushLeaderboard = loadBossRushLeaderboard()
    this.hardcoreMemorial = loadHardcoreMemorial()
    this.dailyBest = loadDailyBest()
    this.dailyLeaderboard = loadDailyLeaderboard()
    this.dailyChallengeActive = false
    this.dailyDamageMult = 1
    this.dailyTwist = null
    // Custom Challenge Code (Local Sharing batch, see the Play-button
    // handler's own comment) - read from #challenge-code-input at Play
    // time, not tied to any settings toggle.
    this._pendingChallengeCode = ''
    this.challengeCodeActive = false
    this.challengeCodeTwist = null
    this.bestRunPace = loadBestRunPace()
    this.deathMemorials = loadDeathMemorials()
    this.nemesis = loadNemesis()
    this._nemesisAnnouncedThisRun = false
    this.secretsProgress = loadSecretsProgress()
    this.buriedCaches = []
    this.nearBuriedCache = null
    this._secretSequenceBuffer = []
    this._secretSequenceBonusUntil = 0
    this._undiscoveredChimePlayedFor = new Set()

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
    this._lastTauntAt = 0
    this._lastParryAt = 0
    this._parryActiveUntil = 0
    this._nextGoldenCheckAt = 0
    this._nextHordeAudioCheckAt = 0
    this.sandstorming = false
    this.heatwave = false
    this.perfectWeather = false
    this._nextEarthquakeCheckAt = 0
    this._nextFloodCheckAt = 0
    this._floodActiveUntil = 0
    this._nextSwarmBiteCheckAt = 0
    this._nextPowerSurgeCheckAt = 0
    this._nextRooftopWindCheckAt = 0
    this._manualSlowMoActive = false
    this._clipRecorder = null
    this._highlightLog = []
    this._photoFilterIndex = 0
    this._cinematicBarsActive = false
    this._reclaimedCells = new Map()
    this._lastAliveCountSeen = 0
    this._runCardBaseImage = null
    this.musicIntensityCurrent = 0
    this.runStartedAt = performance.now()
    this.nightStartedAt = performance.now()
    // Long-Term Goals batch (see _recordRunEnd) - per-run baselines used to
    // derive this run's contribution to the lifetime totals in careerStats.
    // _runStartCoins is a net-earned approximation (coins can be spent
    // mid-run too), not a true gross-earned ledger - fine for a flavor stat.
    this._runStartCoins = this.coins
    this._runDistanceTraveled = 0
    this._lastDistPos = null
    this.roundIntermissionUntil = 0
    this._scheduleNemesisCheck()
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
    this.buildMode = new BuildMode(this.renderer)
    this._userResScale = (this.settings.renderResolution ?? 100) / 100
    this.renderer.setPixelRatio(this._basePixelRatio() * this._userResScale)
    // Shadows off entirely under LOW_QUALITY_MODE - a big chunk of both
    // remaining visual complexity (soft shadow edges) and render cost
    // (a full extra depth pass every frame). Performance Mode's own
    // toggle still layers on top of this if a player enables it manually.
    // Also respects the Graphics tab's own Shadows checkbox now (see
    // _resolveShadowsEnabled) - LOW_QUALITY_MODE/Performance Mode still
    // win regardless of that checkbox's state, same precedent as before.
    this.renderer.shadowMap.enabled = this._resolveShadowsEnabled()
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    // Cinematic contrast/rolloff instead of the flat default - the single
    // biggest free visual-quality win available (no extra render cost).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    // renderer.info auto-resets at the start of every individual render()
    // call, and EffectComposer.render() makes several (RenderPass, bloom,
    // then a final OutputPass that just draws one fullscreen quad) - so
    // reading renderer.info.render.calls right after composer.render()
    // used to always read "1" (only the last pass's count survived the
    // next auto-reset). Turning auto-reset off and resetting/reading it
    // ourselves around the whole composer.render() call (see _tick) gives
    // the real total instead. See docs/PERFORMANCE.md §3 "known-bad
    // diagnostic".
    this.renderer.info.autoReset = false
    this._lastFrameDrawCalls = 0
    this._lastFrameTriangles = 0

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
    // Ambient Occlusion (Graphics tab) - real added GPU cost (its own
    // depth+normal render targets every frame), so disabled by default
    // (kernelRadius 0 below, aoIntensity setting defaults to 0) rather
    // than something every player pays for unasked. Must come before
    // bloom/output below so AO shading gets picked up by the tone mapping
    // like any other lit surface, not applied on top of the final image.
    this.ssaoPass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight)
    this.ssaoPass.enabled = false
    this.composer.addPass(this.ssaoPass)
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

    const { colliders, solidMeshes, flickerLights, spawnPoints, hemiLight, sunLight, towerChestSpots, minigunSpot, generator, trader, ammoStation, upgradeMachine, mysteryBox, vireoFacility, undergroundStation, subwayEntrance, safeZone, practiceTargets, trophyWall, cullables, supermarket, groceryStore, hospital, pharmacy, hardwareStore, gunShop, policeStation, militaryCheckpoint, prison, university, skyscraper, megaMall, warehouse, gasStation, bank, diner, radioStation, fireStation, motel, newUndergroundEntrance, maintenanceTunnel, toxicSewerLevel, mineLevel, manholeCovers, waterTowerValve, containerStaircase, industrialSiren, wreckingPendulum, scaffolding, elevatorTower, payphone, tacticalStreetlights, grassBounds, waterBounds } = buildWorld(this.scene, ACHIEVEMENTS.length)
    this.grassBounds = grassBounds
    this.waterBounds = waterBounds
    // The moon DirectionalLight (World.js's only shadow-casting light) -
    // was previously only passed straight into DayNightCycle, never kept
    // on `this` itself. Needed here for the Graphics tab's Shadow Quality
    // setting (see _applyShadowQuality) to reach its shadow.mapSize.
    this.sunLight = sunLight
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
    this._lightCullScratch = []
    this._adaptiveShadowMult = 1
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
    this.breakableGlassCases = []
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
    // Interactive World batch - proximity flags follow the exact
    // nearGenerator/nearZiplineEnd shape already used throughout this file.
    this.manholeCovers = manholeCovers
    this.nearManholeCover = null
    // Underground landing target for manholes - the same known-safe spot
    // undergroundStation's own terminal/encounter already use, so this
    // doesn't need to derive or guess a new safe underground coordinate.
    this.manholeLandingSpot = { x: undergroundStation.encounterCenter.x, y: undergroundStation.floorY + 0.1, z: undergroundStation.encounterCenter.z }
    this.campfireSpot = { x: CAMPFIRE_X, z: CAMPFIRE_Z }
    this.campfireRestedUntil = 0
    this.nearCampfire = false
    this.waterTowerValve = waterTowerValve
    this.nearWaterTowerValve = false
    this.waterTowerPuddleUntil = 0
    this.containerStaircase = containerStaircase
    this.industrialSiren = industrialSiren
    this.nearIndustrialSiren = false
    this.sirenLootBonusUntil = 0
    this.wreckingPendulum = wreckingPendulum
    this.nearWreckingPendulum = false
    this._pendulumSwingStartedAt = 0
    this._pendulumHitThisSwing = false
    this.scaffolding = scaffolding
    this.elevatorTower = elevatorTower
    this.nearElevatorCar = false
    // 'bottom'/'top' - which floor the car is currently parked at (only
    // meaningful while not riding; see _rideElevator/_updateElevatorTower).
    this.elevatorFloor = 'bottom'
    this.elevatorRiding = false
    this.elevatorRideStartedAt = 0
    this.elevatorRideFromY = 0
    this.elevatorRideToY = 0
    this.payphone = payphone
    this.nearPayphone = false
    this.payphoneCallActive = false
    this.payphoneCallReadyAt = 0
    this.payphoneUsedThisRun = false
    this.tacticalStreetlights = tacticalStreetlights
    this.barricadeCrates = []
    this.nearBarricadeCrate = null
    // Attach real onHit closures now that `this` exists - buildScaffolding/
    // buildTacticalStreetlight (World.js) return their object with
    // onHit: null since they're built before Game's methods are available.
    this.scaffolding.onHit = (damage) => {
      if (this.scaffolding.destroyed) return
      this.scaffolding.health -= damage
      if (this.scaffolding.health <= 0) this._collapseScaffolding()
    }
    for (const light of this.tacticalStreetlights) {
      light.onHit = () => {
        if (light.shotOut) return
        light.shotOut = true
        light.light.intensity = 0
        light.litMat.emissive.setHex(0x000000)
        light.litMat.emissiveIntensity = 0
        light.litMat.color.setHex(0x2a2a28)
        registerZone({ id: `tacticallight_${light.x}_${light.z}`, x: light.x, z: light.z, radius: 10, densityMult: 0.5 })
        this._showLoreToast(t('toastStreetlightShotOut'))
      }
    }
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
    this.companion = new Companion(this.scene, 1.6, 7, this.settings.companionRole, { jacketColor: this._companionColorHex() })
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
    this.totalSpent = loadTotalSpent()
    this.bountyStreak = loadBountyStreak()
    this.haggleStreak = loadHaggleStreak()
    this._haggleDiscountActive = false
    this._traderVisitPurchaseCount = 0
    this._blackMarketRotation = []
    this.weeklyChallenge = loadWeeklyChallenge()
    this.weeklyDef = WEEKLY_CHALLENGES[_weeklyChallengeIndex(this.weeklyChallenge.week)]
    this.metaProgress = loadMetaProgress()
    this._applyMetaUpgrades()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    this.quests = new Quests()
    this.rollingQuests = new RollingQuests()
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
    // Achievement toast queue (see _showAchievementToast) - the toast is a
    // single shared element like every other toast in this codebase, so
    // without a queue, two achievements unlocking in the same tick (e.g.
    // the completionist auto-cascade) would silently clobber one another.
    this._achievementToastQueue = []
    this._achievementToastShowing = false
    this.loreToast = document.getElementById('lore-toast')
    this.companionBarkEl = document.getElementById('companion-bark')
    this.lowHealthBarked = false
    this.companionBondTier = 0
    this.bossAnnounced = false
    this.nextHeartbeatAt = 0
    this._nextPeripheralUiUpdateAt = 0
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
    this.traderSellbackTitle = document.getElementById('trader-sellback-title')
    this.traderSellbackOptions = document.getElementById('trader-sellback-options')
    this.traderBlackMarketTitle = document.getElementById('trader-blackmarket-title')
    this.traderBlackMarketOptions = document.getElementById('trader-blackmarket-options')
    this.traderHint = document.getElementById('trader-hint')
    this.upgradesBtn = document.getElementById('upgrades-btn')
    this.upgradesPanel = document.getElementById('upgrades-panel')
    this.upgradesPanelTitle = document.getElementById('upgrades-panel-title')
    this.upgradesPointsLine = document.getElementById('upgrades-points-line')
    this.upgradesOptions = document.getElementById('upgrades-options')
    this.prestigeSection = document.getElementById('prestige-section')
    this.prestigeLevelLine = document.getElementById('prestige-level-line')
    this.prestigeBtn = document.getElementById('prestige-btn')
    this.respecSection = document.getElementById('respec-section')
    this.respecBtn = document.getElementById('respec-btn')
    this.questsBtn = document.getElementById('quests-btn')
    this.questsPanel = document.getElementById('quests-panel')
    this.questsPanelTitle = document.getElementById('quests-panel-title')
    this.questsOptions = document.getElementById('quests-options')
    this.rollingQuestsHeading = document.getElementById('rolling-quests-heading')
    this.rollingQuestsSubtitle = document.getElementById('rolling-quests-subtitle')
    this.rollingQuestsOptions = document.getElementById('rolling-quests-options')
    this.lifetimeQuestsHeading = document.getElementById('lifetime-quests-heading')
    this.achievementsBtn = document.getElementById('achievements-btn')
    this.achievementsPanel = document.getElementById('achievements-panel')
    this.achievementsPanelTitle = document.getElementById('achievements-panel-title')
    this.achievementsOptions = document.getElementById('achievements-options')
    this.achievementsFilterInput = document.getElementById('achievements-filter-input')
    this.achievementsCategorySelect = document.getElementById('achievements-category-select')
    this.achievementsSortSelect = document.getElementById('achievements-sort-select')
    this.printAchievementsBtn = document.getElementById('print-achievements-btn')
    this.bestiarySectionHeading = document.getElementById('bestiary-section-heading')
    this.bestiaryOptions = document.getElementById('bestiary-options')
    this.bestiaryFilterInput = document.getElementById('bestiary-filter-input')
    this.menuPlayerBadge = document.getElementById('menu-player-badge')
    this.profilePanel = document.getElementById('profile-panel')
    this.profilePanelTitle = document.getElementById('profile-panel-title')
    this.profileOptions = document.getElementById('profile-options')
    this.profileCopyStatsBtn = document.getElementById('profile-copy-stats-btn')
    this.profileReadAloudBtn = document.getElementById('profile-read-aloud-btn')
    this.sharedProfileBanner = document.getElementById('shared-profile-banner')
    this.sharedProfileTitle = document.getElementById('shared-profile-title')
    this.sharedProfileLine = document.getElementById('shared-profile-line')
    this.sharedProfileCloseBtn = document.getElementById('shared-profile-close-btn')
    this.whatsNewDigest = document.getElementById('whats-new-digest')
    this.whatsNewDigestTitle = document.getElementById('whats-new-digest-title')
    this.whatsNewDigestList = document.getElementById('whats-new-digest-list')
    this.whatsNewDigestCloseBtn = document.getElementById('whats-new-digest-close-btn')
    this.shortcutCheatsheet = document.getElementById('shortcut-cheatsheet')
    this.shortcutCheatsheetTitle = document.getElementById('shortcut-cheatsheet-title')
    this.shortcutCheatsheetList = document.getElementById('shortcut-cheatsheet-list')
    this.shortcutCheatsheetCloseBtn = document.getElementById('shortcut-cheatsheet-close-btn')
    this.profileCareerPortraitBtn = document.getElementById('profile-career-portrait-btn')
    this.killFeedEl = document.getElementById('kill-feed')
    this.tauntTextEl = document.getElementById('taunt-text')
    this.dailyLeaderboardEl = document.getElementById('death-daily-leaderboard')
    this.shareRunCardBtn = document.getElementById('share-run-card-btn')
    this.creditsBtn = document.getElementById('credits-btn')
    this.buildModeBtn = document.getElementById('build-mode-btn')
    this.menuAriaSummary = document.getElementById('menu-aria-summary')
    this.menuTitle = document.getElementById('menu-title')
    this.menuBgRain = document.getElementById('menu-bg-rain')
    this.menuBgAsh = document.getElementById('menu-bg-ash')
    this.rankRoadmapHeading = document.getElementById('rank-roadmap-heading')
    this.rankRoadmapList = document.getElementById('rank-roadmap-list')
    this.classComparisonHeading = document.getElementById('class-comparison-heading')
    this.classComparisonTable = document.getElementById('class-comparison-table')
    this.goalsHeading = document.getElementById('goals-heading')
    this.goalsPicker = document.getElementById('goals-picker')
    this.goalsChecklist = document.getElementById('goals-checklist')
    this.creditsPanel = document.getElementById('credits-panel')
    this.creditsPanelTitle = document.getElementById('credits-panel-title')
    this.buildVersionLine = document.getElementById('build-version-line')
    this.shopSortSelect = document.getElementById('shop-sort-select')
    this.shopSpendingLogRow = document.getElementById('shop-spending-log-row')
    this.shopSpendingLogHeading = document.getElementById('shop-spending-log-heading')
    this.shopSpendingLogList = document.getElementById('shop-spending-log-list')
    this.printChangelogBtn = document.getElementById('print-changelog-btn')
    this.copyChangelogBtn = document.getElementById('copy-changelog-btn')
    this.buildSessionIdLine = document.getElementById('build-session-id-line')
    this.checkUpdatesBtn = document.getElementById('check-updates-btn')
    this.diagnosticsHeading = document.getElementById('diagnostics-heading')
    this.diagnosticsLine = document.getElementById('diagnostics-line')
    this.copyDiagnosticsBtn = document.getElementById('copy-diagnostics-btn')
    this.copyErrorLogBtn = document.getElementById('copy-error-log-btn')
    this.coinshopBtn = document.getElementById('coinshop-btn')
    this.coinshopPanel = document.getElementById('coinshop-panel')
    this.coinshopPanelTitle = document.getElementById('coinshop-panel-title')
    this.coinshopCoinLine = document.getElementById('coinshop-coin-line')
    this.coinshopOptions = document.getElementById('coinshop-options')
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
    this.weaponPickerPanel = document.getElementById('weapon-picker-panel')
    this.weaponPickerPanelTitle = document.getElementById('weapon-picker-panel-title')
    this.weaponPickerOptions = document.getElementById('weapon-picker-options')
    this.pauseOverlay = document.getElementById('pause-overlay')
    this.pauseOverlayTitle = document.getElementById('pause-overlay-title')
    this.pauseResumeBtn = document.getElementById('pause-resume-btn')
    this.pauseSettingsBtn = document.getElementById('pause-settings-btn')
    this.pauseQuitBtn = document.getElementById('pause-quit-btn')
    this.pauseUpgradesBtn = document.getElementById('pause-upgrades-btn')
    this.pauseShopBtn = document.getElementById('pause-shop-btn')
    this.pauseWeaponBtn = document.getElementById('pause-weapon-btn')
    this.screenshotCropOverlay = document.getElementById('screenshot-crop-overlay')
    this.screenshotCropStage = document.getElementById('screenshot-crop-stage')
    this.screenshotCropImage = document.getElementById('screenshot-crop-image')
    this.screenshotCropSelection = document.getElementById('screenshot-crop-selection')
    this.screenshotCropSaveBtn = document.getElementById('screenshot-crop-save')
    this.screenshotCropFullBtn = document.getElementById('screenshot-crop-full')
    this.screenshotCropCancelBtn = document.getElementById('screenshot-crop-cancel')
    this.screenshotCaptionInput = document.getElementById('screenshot-caption-input')
    this.screenshotCopyClipboardBtn = document.getElementById('screenshot-copy-clipboard')
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
      // Photo mode filters/cinematic bars - hardcoded to this listener
      // (already isolated to photoModeOpen, same precedent as Space/Ctrl/
      // Shift above) rather than added to the rebindable Keybinds.js list,
      // since these only ever do anything while frozen in photo mode.
      else if (e.code === 'KeyF') this._cyclePhotoFilter()
      else if (e.code === 'KeyC') this._toggleCinematicBars()
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
      (point, normal, isZombie) => {
        // Gated here (not inside Decals.js itself) since Decals has no
        // access to this.settings - isZombie true means a blood splat,
        // false means a bullet hole in the environment (see DecalManager
        // .spawn's own isBlood param).
        if (isZombie && !this.settings.bloodEffectsEnabled) return
        if (!isZombie && !this.settings.bulletHolesEnabled) return
        this.decals.spawn(point, normal, isZombie)
      },
      () => {
        this._triggerShake(0.05, 90)
        this._triggerHitstop(40)
        // Shot-accuracy tracking (Profile panel) - fires once per shot
        // that connected (hitZombies.size > 0 in _fire(), not per pellet),
        // same granularity as onShotFired below.
        this.careerStats.shotsHit = (this.careerStats.shotsHit || 0) + 1
      },
      () => this._onStealthTakedown(),
      (x, y, z, damage, isHeadshot) => {
        this._spawnDamageNumber(x, y, z, damage, isHeadshot)
        // Lifetime damage dealt (Profile panel) - per pellet is correct
        // here (unlike shotsHit above), since multi-pellet weapons really
        // do deal that much total damage per shot.
        this.careerStats.lifetimeDamageDealt = (this.careerStats.lifetimeDamageDealt || 0) + damage
      },
      (intensity, durationMs) => {
        this._triggerShake(intensity, durationMs)
        this._alertNearbyZombiesToGunfire()
        this._maybeTriggerStampede()
      },
      () => this.settings.showHitFeedback,
      () => { this.careerStats.shotsFired = (this.careerStats.shotsFired || 0) + 1 }
    )
    this.rivals = new RivalManager(this.scene)
    this.weapons.setRivalManager(this.rivals)
    this._rivalsClaimedAirdrop = false
    this._rivalsClaimedByName = null
    this._spawnDeathMemorials()
    this._spawnBuriedCaches()
    this._maybeShowTutorialHints()
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
    this.ownedHats = this.shopProgress.ownedHats
    this.equippedHat = this.shopProgress.equippedHat
    if (this.equippedHat) {
      const item = COIN_SHOP_ITEMS.find((i) => i.hat === this.equippedHat)
      if (item) this.playerBody.setHat(item.hat, item.hatColor)
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
    window.addEventListener('beforeunload', () => this._updateLongestSession())
    // Copy Error Log (Credits) / Session ID - both purely diagnostic, for
    // pasting into a bug report. Session ID is a fresh random string per
    // page load, not persisted - it only needs to be stable within one
    // session so a report and a follow-up question can reference "the
    // same session," not a lasting player identifier.
    this._sessionId = Math.random().toString(36).slice(2, 10)
    this._errorLog = []
    window.addEventListener('error', (e) => {
      if (this._errorLog.length >= 20) this._errorLog.shift()
      this._errorLog.push(`[${new Date().toISOString()}] ${e.message} (${e.filename}:${e.lineno})`)
    })
    this._bindItemKeys()
    this._bindHotbar()
    this._bindSettings()
    this._bindGraphicsSettings()
    this._bindDifficulty()
    this._bindCompanionRole()
    this._bindLoadout()
    // Must run after the three binds above - _checkSetupCode's payload
    // apply works by calling .click() on the real difficulty/role/loadout
    // buttons, which only does anything once their own listeners are
    // attached. _bindSettings() (called earlier, at the top of the
    // constructor) runs _checkBeatThisChallenge/_checkViewProfileLink at a
    // point that predates these binds too, but neither of those touches
    // these buttons, so only this one actually needed moving.
    this._checkSetupCode()
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
    // Standalone structure, own verified-clear spot (-300,300 - mirrors
    // the Elevator Tower's own (300,300) placement, same live
    // collider-overlap check done before picking it).
    this._buildGlassCase(-300, 300)
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
      // Lifetime Play-button click count (Profile panel) - not saved
      // immediately (matches every other high-frequency careerStats
      // counter's batching precedent - persisted at the next
      // saveCareerStats call, e.g. _recordRunEnd).
      this.careerStats.playButtonClicks = (this.careerStats.playButtonClicks || 0) + 1
      saveCareerStats(this.careerStats)
      // Screen fade transition - masks the otherwise-instant menu-to-game
      // switch with a brief flash-to-black-then-fade, same show/hide
      // re-trigger pattern as every toast in this codebase.
      this.screenFadeEl.classList.remove('show')
      void this.screenFadeEl.offsetWidth
      this.screenFadeEl.classList.add('show')
      // Hide the menu right here rather than waiting on the pointer-lock
      // 'lock' event further down - _openTraitDrawPanel() (below) can show
      // its own panel for a while before the player picks a trait and
      // player.controls.lock() is finally called on that choice, and until
      // now the still-fully-visible menu bled through that panel's 90%-
      // opacity backdrop the entire time it was up.
      this.menu.style.display = 'none'
      // FPS/coords debug readout - hidden on the menu, fades in once real
      // gameplay starts (see their own opacity/transition setup).
      this.fpsEl.style.opacity = '1'
      this.coordsEl.style.opacity = '1'
      this._applyFrameTimeGraphVisibility()
      audioEngine.init()
      audioEngine.resume()
      audioEngine.startAmbient()
      audioEngine.startMusic()
      this._applyLoadout(this.settings.loadout)
      // Mutator Exploration nudge (see _updateMenuSpotlight's mode 4) -
      // "tried" means actually started a run with it on, checked here
      // (once, at the one place every mutator flag is already read for
      // real) rather than at each of the ~15 individual checkbox handlers.
      let mutatorsChanged = false
      for (const [id, on] of Object.entries(this.settings.mutators)) {
        if (on && !this.settings.mutatorsEverEnabled.includes(id)) {
          this.settings.mutatorsEverEnabled.push(id)
          mutatorsChanged = true
        }
      }
      if (mutatorsChanged) saveSettings(this.settings)
      if (Object.values(this.settings.mutators).some(Boolean)) CloudSync.incrementTelemetry('mutatorUsed').catch(() => {})
      let spawnMult = this.difficulty.spawnRateMult
      if (this.settings.mutators.hordeRush) spawnMult *= 2
      if (this.settings.mutators.hordeMode) spawnMult *= 3
      this.dailyChallengeActive = this.settings.mutators.dailyChallenge
      this.dailyDamageMult = 1
      if (this.dailyChallengeActive) {
        this.dailyTwist = DAILY_TWISTS[_dailyTwistIndex(_todayDateStr())]
        this.dailyDamageMult = this.dailyTwist.damageMult
        spawnMult *= this.dailyTwist.spawnMult
        CloudSync.incrementTelemetry('challengeStarted').catch(() => {})
      }
      // Custom Challenge Code (Local Sharing batch) - same twist-selection
      // mechanism as Daily Challenge above (_dailyTwistIndex is a generic
      // string hash, not date-specific), just keyed off a typed code
      // instead of today's date, and deliberately NOT wired into
      // dailyChallengeActive/dailyBest - that pool compares same-day runs
      // against each other, and mixing a shareable custom code into it
      // would compare two different things under one leaderboard.
      this.challengeCodeActive = !!this._pendingChallengeCode
      if (this.challengeCodeActive) {
        this.challengeCodeTwist = DAILY_TWISTS[_dailyTwistIndex(this._pendingChallengeCode)]
        this.dailyDamageMult = this.challengeCodeTwist.damageMult
        spawnMult *= this.challengeCodeTwist.spawnMult
        this._showLoreToast(t('challengeCodeApplied', { twist: t(this.challengeCodeTwist.nameKey) }))
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
      this._openWeaponPickerPanel()
    })

    this.respawnBtn.addEventListener('click', () => {
      // Hardcore: one life. A full page reload cleanly wipes all in-session
      // state (points, inventory, kills...) while keeping everything that's
      // meant to be permanent (settings, achievements, legacy points,
      // bestiary, best stats), since those all live in localStorage anyway.
      if (this._isForceHardcore()) {
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
      this._rivalsClaimedByName = null
      this._reclaimedCells = new Map()
      this._lastAliveCountSeen = 0
      this._cleanSweepAwardedThisRound = false
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
      this._runStartCoins = this.coins
      this._runDistanceTraveled = 0
      this._lastDistPos = null
      this._nemesisAnnouncedThisRun = false
      this._scheduleNemesisCheck()
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
    this.pauseWeaponBtn.addEventListener('click', () => {
      // Hide Pause first - both panels share the shared panel rule's
      // z-index:15, so with Pause left open underneath, DOM order (it
      // comes after the weapon picker in index.html) would let it paint on
      // top of the picker instead of the other way around.
      this.pauseOverlay.style.display = 'none'
      this._openWeaponPickerPanel(true)
    })

    this.player.controls.addEventListener('lock', () => {
      // Build Mode acquires pointer lock too (its own free-fly look
      // controls, see BuildMode.js) - it shares the same canvas/
      // PlayerController as the real game, so every time its Tab-picker
      // toggle re-locks the pointer, this handler was firing right along
      // with it, setting gameStarted = true and showing the entire real-run
      // HUD (health/hotbar/stats/etc.) on top of the Build Mode scene.
      if (this.buildMode.active) return
      this.gameStarted = true
      audioEngine.resume()
      this.pauseOverlay.style.display = 'none'
      this.screenshotCropOverlay.style.display = 'none'
      this.screenshotCropOpen = false
      this.menu.style.display = 'none'
      this.crosshair.style.display = this.driving ? 'none' : 'block'
      this.hudEl.style.display = this.driving ? 'none' : 'block'
      this.hotbarEl.style.display = this.driving ? 'none' : 'flex'
      if (this.hotbarPowerScoreEl) this.hotbarPowerScoreEl.style.display = this.driving ? 'none' : 'block'
      this.statusHud.style.display = 'flex'
      this.inventoryHud.style.display = 'flex'
      this.progressHud.style.display = 'flex'
      this.statsPanel.style.display = 'flex'
      if (this.keybindCheatsheet) this.keybindCheatsheet.style.display = this.settings.keybindCheatSheet ? '' : 'none'
      this.minimapWrap.style.display = 'block'
      this.compassStrip.style.display = 'block'
      if (this.driving) {
        this.interactPrompt.innerHTML = tHtml('interactExitVehicle')
        this.interactPrompt.style.display = 'block'
      }
    })

    this.player.controls.addEventListener('unlock', () => {
      // Same shared-canvas reasoning as the 'lock' handler above - Build
      // Mode's picker calls document.exitPointerLock() itself, which fires
      // this handler too. Without this guard it was popping the real
      // pause overlay (Resume/Upgrades/Shop/Settings/Quit) right on top of
      // the block picker.
      if (this.buildMode.active) return
      this.interactPrompt.style.display = 'none'
      this.infectionIndicator.style.display = 'none'
      if (!this.playerState.alive) return
      // Any of these panels already put up their own overlay and released
      // pointer lock themselves (see each _openXPanel), specifically so
      // their buttons are actually clickable - a locked pointer only
      // reports relative mouse deltas for the camera, not a usable cursor.
      // Don't also reset them or pop the pause menu on top when that's why
      // we just unlocked. Inventory (see _bindItemKeys) now does the same
      // unlock-on-open/lock-on-close dance as the others, closed via its
      // own always-on Tab/Escape listener rather than here.
      if (this.screenshotCropOpen || this.perkPanelOpen || this.xpLevelupPanelOpen || this.traderPanelOpen || this.inventoryOpen) {
        // handled by whichever panel is open
      } else if (this.gameStarted) {
        audioEngine.pause()
        this.pauseOverlayTitle.textContent = t('pauseOverlayTitle')
        this.pauseResumeBtn.textContent = t('pauseResumeBtn')
        this.pauseUpgradesBtn.textContent = t('upgradesBtn')
        this.pauseShopBtn.textContent = t('coinshopBtn')
        this.pauseWeaponBtn.textContent = t('pauseWeaponBtn')
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
      // Build Mode acquires pointer lock too (its own free-fly look
      // controls, see BuildMode.js) - controls.isLocked alone can't tell
      // these two apart, so without this guard Tab was opening the real
      // Inventory panel (plus every item hotkey below it) right on top of
      // Build Mode's own block picker.
      if (this.buildMode.active) return
      if (!this.player.controls.isLocked || !this.playerState.alive) return

      this._checkSecretSequence(e.code)

      if (e.code === 'Tab') {
        e.preventDefault()
        if (this.mapOpen) return // don't let the inventory open on top of the map
        this.inventoryOpen = true
        this.inventoryPanel.style.display = 'flex'
        this._refreshInventoryPanel()
        // Pointer lock only reports relative mouse deltas for the camera,
        // not a usable cursor - every other clickable panel unlocks itself
        // on open for exactly this reason (see _openTraderPanel etc.); this
        // one never did, so its hotbar-assign buttons looked clickable but
        // never actually were. Closing now goes through the always-on
        // Tab/Escape listener below instead of this handler, since once
        // unlocked this whole handler's own isLocked guard stops it from
        // ever firing again.
        this.player.controls.unlock()
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
      } else if (e.code === getKeyFor('taunt')) {
        this._triggerTaunt()
      } else if (e.code === getKeyFor('fastTravelNearest')) {
        this._fastTravelToNearest()
      } else if (e.code === getKeyFor('smokeBomb')) {
        this._throwSmokeBomb()
      } else if (e.code === getKeyFor('parry')) {
        this._triggerParry()
      } else if (e.code === getKeyFor('slowMo')) {
        this._toggleSlowMo()
      } else if (e.code === getKeyFor('clipRecording')) {
        this._toggleClipRecording()
      } else if (e.code === getKeyFor('barricadeCrate')) {
        this._placeBarricadeCrate()
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
          this.careerStats.timesRevivedCompanion += 1
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
        } else if (this.nearBuriedCache) {
          this._digBuriedCache()
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
        } else if (this.nearManholeCover) {
          this._useManholeCover()
        } else if (this.nearCampfire) {
          this._useCampfire()
        } else if (this.nearWaterTowerValve) {
          this._useWaterTowerValve()
        } else if (this.nearIndustrialSiren) {
          this._pullSirenLever()
        } else if (this.nearWreckingPendulum) {
          this._triggerWreckingPendulum()
        } else if (this.nearElevatorCar) {
          this._rideElevator()
        } else if (this.nearPayphone && !this.payphoneUsedThisRun) {
          this._usePayphone()
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
    // Streaming-safe mode (see _updateStreamSafeVisibility) keeps the
    // debug overlay hidden even once photo mode closes again.
    this.fpsEl.style.display = (hidden || this.settings.streamSafeMode) ? 'none' : 'block'
    this.coordsEl.style.display = hidden ? 'none' : 'block'
  }

  _updateStreamSafeVisibility() {
    this.fpsEl.style.display = (this.settings.streamSafeMode || this.photoModeOpen) ? 'none' : 'block'
  }

  // Manual slow-motion toggle (see MANUAL_SLOWMO_FACTOR's own comment).
  _toggleSlowMo() {
    this._manualSlowMoActive = !this._manualSlowMoActive
    this._showLoreToast(this._manualSlowMoActive ? t('slowMoOn') : t('slowMoOff'))
  }

  // Manual clip recording (see CLIP_RECORDING_FPS's own comment) - a real
  // MediaRecorder capture of this.canvas's own WebGL output, not a
  // separate offscreen render.
  _toggleClipRecording() {
    if (this._clipRecorder && this._clipRecorder.state === 'recording') {
      this._clipRecorder.stop()
      return
    }
    if (!this.canvas.captureStream || typeof MediaRecorder === 'undefined') {
      this._showLoreToast(t('clipRecordingUnsupported'))
      return
    }
    let recorder
    try {
      const stream = this.canvas.captureStream(CLIP_RECORDING_FPS)
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    } catch {
      this._showLoreToast(t('clipRecordingUnsupported'))
      return
    }
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const link = document.createElement('a')
      link.download = `gayz-clip-${Date.now()}.webm`
      link.href = URL.createObjectURL(blob)
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      this._showLoreToast(t('clipSaved'))
    }
    recorder.start()
    this._clipRecorder = recorder
    this._showLoreToast(t('clipRecordingStarted'))
  }

  // Auto-highlight moment flagging (see HIGHLIGHT_LOG_MAX_ENTRIES's own
  // comment) - a lightweight timestamped log, not a full auto-edited reel.
  _flagHighlightMoment(label) {
    this._highlightLog.unshift({ label, night: this.night, elapsed: performance.now() - this.runStartedAt })
    if (this._highlightLog.length > HIGHLIGHT_LOG_MAX_ENTRIES) this._highlightLog.length = HIGHLIGHT_LOG_MAX_ENTRIES
  }

  // Photo mode filters (see PHOTO_FILTERS's own comment) - a plain CSS
  // filter cycled on the canvas element itself.
  _cyclePhotoFilter() {
    this._photoFilterIndex = (this._photoFilterIndex + 1) % PHOTO_FILTERS.length
    this.canvas.style.filter = PHOTO_FILTERS[this._photoFilterIndex]
    this._showLoreToast(t('photoFilterChanged', { n: this._photoFilterIndex + 1, total: PHOTO_FILTERS.length }))
  }

  // Cinematic letterbox bars (see #cinematic-bars) - a purely visual CSS
  // overlay toggle, photo mode only.
  _toggleCinematicBars() {
    this._cinematicBarsActive = !this._cinematicBarsActive
    if (this.cinematicBarsEl) this.cinematicBarsEl.style.display = this._cinematicBarsActive ? 'block' : 'none'
  }

  // Copy Profile stats as shareable text (see _openProfilePanel) - plain
  // text via the Clipboard API, not an image.
  _copyProfileStatsToClipboard() {
    const lines = Array.from(this.profileOptions.querySelectorAll('.perk-option')).map((btn) => {
      const name = btn.querySelector('.perk-name')?.textContent || ''
      const value = btn.querySelector('.perk-cost')?.textContent || ''
      return `${name}: ${value}`
    })
    const text = `GayZ Profile\n${lines.join('\n')}`
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(text)
      .then(() => this._showLoreToast(t('clipboardCopySuccess')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  // Manual text-to-speech (Profile panel) - reads the exact same rows
  // _copyProfileStatsToClipboard already extracts from the rendered grid,
  // via the standard Web Speech API. A manual button rather than
  // auto-reading on open, since an unannounced voice suddenly speaking
  // would surprise a sighted user just browsing the panel.
  _readProfileStatsAloud() {
    if (!window.speechSynthesis) {
      this._showLoreToast(t('ttsUnsupported'))
      return
    }
    const lines = Array.from(this.profileOptions.querySelectorAll('.perk-option')).map((btn) => {
      const name = btn.querySelector('.perk-name')?.textContent || ''
      const value = btn.querySelector('.perk-cost')?.textContent || ''
      return `${name}: ${value}.`
    })
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(lines.join(' ')))
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
  // resolution to fit the overlay), composites the watermark/caption, and
  // downloads the result.
  _saveScreenshotCrop(rect) {
    this._finalizeScreenshotCanvas(this._buildScreenshotCanvas(rect), 'download')
  }

  _saveFullScreenshot() {
    this._finalizeScreenshotCanvas(this._buildScreenshotCanvas(null), 'download')
  }

  // Copy to Clipboard (see navigator.clipboard.write below) - same
  // rect-or-full logic _saveScreenshotCrop/_saveFullScreenshot already
  // follow, just written to the OS clipboard instead of downloaded.
  _copyScreenshotToClipboard() {
    const rect = this.screenshotCropSelectionRect
    const usableRect = rect && rect.width > 4 && rect.height > 4 ? rect : null
    this._finalizeScreenshotCanvas(this._buildScreenshotCanvas(usableRect), 'clipboard')
  }

  // Shared by all three screenshot actions above - builds the actual pixel
  // canvas (cropped or full) from the captured <img>, without yet
  // compositing the watermark/caption or deciding download-vs-clipboard.
  _buildScreenshotCanvas(rect) {
    const img = this.screenshotCropImage
    const canvas = document.createElement('canvas')
    if (rect) {
      const scaleX = img.naturalWidth / img.clientWidth
      const scaleY = img.naturalHeight / img.clientHeight
      const sx = Math.round(rect.x * scaleX)
      const sy = Math.round(rect.y * scaleY)
      const sw = Math.round(rect.width * scaleX)
      const sh = Math.round(rect.height * scaleY)
      canvas.width = sw
      canvas.height = sh
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    } else {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d').drawImage(img, 0, 0)
    }
    return canvas
  }

  // Watermark + optional caption compositing, then either downloads the
  // result or writes it to the OS clipboard.
  _finalizeScreenshotCanvas(canvas, mode) {
    const ctx = canvas.getContext('2d')
    const caption = this.screenshotCaptionInput ? this.screenshotCaptionInput.value.trim() : ''
    if (caption) {
      const bannerH = Math.max(28, Math.round(canvas.height * 0.06))
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillRect(0, canvas.height - bannerH, canvas.width, bannerH)
      ctx.fillStyle = '#ffffff'
      ctx.font = `${Math.max(12, Math.round(canvas.width * 0.02))}px sans-serif`
      ctx.textBaseline = 'bottom'
      ctx.fillText(caption, 10, canvas.height - bannerH * 0.3)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = `${Math.max(10, Math.round(canvas.width * 0.015))}px sans-serif`
    ctx.fillText('GayZ', canvas.width - 8, canvas.height - 8)
    ctx.textAlign = 'left'

    // Screenshot Gallery (Profile panel) - every save/copy also stores a
    // small thumbnail, regardless of mode, so the gallery reflects both
    // download and clipboard-copy screenshots.
    this._pushGalleryThumbnail(canvas.toDataURL('image/png'))

    if (mode === 'clipboard') {
      if (!navigator.clipboard || !window.ClipboardItem) {
        this._showLoreToast(t('clipboardCopyUnsupported'))
        return
      }
      canvas.toBlob((blob) => {
        if (!blob) return
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          .then(() => this._showLoreToast(t('clipboardCopySuccess')))
          .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
      })
    } else {
      const link = document.createElement('a')
      link.download = `gayz-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
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
    this.screenshotCopyClipboardBtn.addEventListener('click', () => this._copyScreenshotToClipboard())
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
      } else if (this.inventoryOpen && (e.code === 'Tab' || e.code === 'Escape')) {
        e.preventDefault()
        this._closeInventoryPanel()
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

  // Breakable Glass Case - a small standalone display case (own frame,
  // not attached to any existing building) blocking a real loot chest
  // behind a shootable glass pane. Frame walls are tall (3, above
  // LEDGE_MAX_HEIGHT's 2.6) so vaulting over is never a way to skip
  // actually breaking the glass. Same "userData flag + onHit health pool"
  // shape as _buildDestructibleWall above, just fragile.
  _buildGlassCase(x, z) {
    const frameMat = flatMaterial({ color: 0x4a4640, roughness: 0.7, metalness: 0.4 })
    const glassMat = flatMaterial({ color: 0x8fd8e8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35 })
    const caseHalf = 1.2
    const caseDepthHalf = 0.8
    const wallHeight = 3

    const back = new THREE.Mesh(new THREE.BoxGeometry(caseHalf * 2, wallHeight, 0.2), frameMat)
    back.position.set(x, wallHeight / 2, z - caseDepthHalf)
    back.castShadow = true
    this.scene.add(back)
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(x - caseHalf, 0, z - caseDepthHalf - 0.1),
      new THREE.Vector3(x + caseHalf, wallHeight, z - caseDepthHalf + 0.1)
    ))
    this.solidMeshes.push(back)

    for (const sx of [-caseHalf, caseHalf]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, wallHeight, caseDepthHalf * 2), frameMat)
      side.position.set(x + sx, wallHeight / 2, z)
      side.castShadow = true
      this.scene.add(side)
      this.colliders.push(new THREE.Box3(
        new THREE.Vector3(x + sx - 0.1, 0, z - caseDepthHalf),
        new THREE.Vector3(x + sx + 0.1, wallHeight, z + caseDepthHalf)
      ))
      this.solidMeshes.push(side)
    }

    // The breakable pane itself - front side, facing the approach.
    const glassMesh = new THREE.Mesh(new THREE.BoxGeometry(caseHalf * 2, wallHeight, 0.15), glassMat)
    glassMesh.position.set(x, wallHeight / 2, z + caseDepthHalf)
    this.scene.add(glassMesh)
    const glassBox = new THREE.Box3(
      new THREE.Vector3(x - caseHalf, 0, z + caseDepthHalf - 0.075),
      new THREE.Vector3(x + caseHalf, wallHeight, z + caseDepthHalf + 0.075)
    )
    this.colliders.push(glassBox)
    this.solidMeshes.push(glassMesh)

    const glassCase = { health: GLASS_CASE_HEALTH, destroyed: false, mesh: glassMesh, box: glassBox }
    glassCase.onHit = (damage) => {
      if (glassCase.destroyed) return
      glassCase.health -= damage
      if (glassCase.health <= 0) this._breakGlassCase(glassCase)
    }
    glassMesh.userData.breakableGlass = glassCase
    this.breakableGlassCases.push(glassCase)

    // Loot visible through the glass before it's broken - better-than-usual
    // odds, the payoff for noticing and shooting it open.
    this.chests.addChest(x, 0, z, { ...LOOT_WEIGHTS, rare_weapon: 6, legendary_weapon: 3, extended_mag: 3 })
  }

  _breakGlassCase(glassCase) {
    glassCase.destroyed = true
    this.scene.remove(glassCase.mesh)
    const ci = this.colliders.indexOf(glassCase.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(glassCase.mesh)
    if (si !== -1) this.solidMeshes.splice(si, 1)
    this._showLoreToast(t('toastGlassBroken'))
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

  // Interactive World batch - 5 proximity interactables below, all sharing
  // the exact nearGenerator/nearZiplineEnd "compute a flag every tick, act
  // on it from the interact-key handler" shape already established.

  _updateManholeCovers(playerPos) {
    this.nearManholeCover = this.manholeCovers.find((m) => Math.hypot(playerPos.x - m.x, playerPos.z - m.z) <= MANHOLE_INTERACT_RADIUS) || null
  }

  // Straight position-teleport down to undergroundStation's own known-safe
  // encounter center (see the constructor's manholeLandingSpot) - same
  // "reuse the exact position-teleport fast travel already has" precedent
  // _useZipline's own comment documents, rather than a new physical shaft.
  _useManholeCover() {
    if (!this.nearManholeCover) return
    this.player.controls.object.position.set(this.manholeLandingSpot.x, this.manholeLandingSpot.y, this.manholeLandingSpot.z)
    this.player.velocity.set(0, 0, 0)
    this._showLoreToast(t('toastManholeUsed'))
  }

  _updateCampfire(playerPos) {
    this.nearCampfire = Math.hypot(playerPos.x - this.campfireSpot.x, playerPos.z - this.campfireSpot.z) <= CAMPFIRE_INTERACT_RADIUS
  }

  _useCampfire() {
    if (!this.nearCampfire) return
    const now = performance.now()
    if (now < this.campfireRestedUntil) {
      this._showLoreToast(t('toastCampfireCooldown'))
      return
    }
    this.campfireRestedUntil = now + CAMPFIRE_REST_COOLDOWN_MS
    this.playerState.heal(CAMPFIRE_REST_HEAL)
    this.player.stamina = this.player.maxStamina
    this._updateHealthHud()
    this._updateStaminaHud()
    this._showLoreToast(t('toastCampfireRested', { n: CAMPFIRE_REST_HEAL }))
  }

  _updateWaterTowerValve(playerPos) {
    this.nearWaterTowerValve = Math.hypot(playerPos.x - this.waterTowerValve.x, playerPos.z - this.waterTowerValve.z) <= WATER_TOWER_VALVE_RADIUS
    // Slip puddle - a flat, dedicated puddleMult slowdown (see
    // PlayerController's own comment on why this doesn't reuse
    // environmentMult) recomputed fresh every tick from current distance +
    // window state, rather than toggled on/off at the moment of entering/
    // leaving - so it can never get stuck at the wrong value.
    const inWindow = performance.now() < this.waterTowerPuddleUntil
    const inPuddle = inWindow && Math.hypot(playerPos.x - this.waterTowerValve.x, playerPos.z - this.waterTowerValve.z) <= WATER_TOWER_PUDDLE_RADIUS
    this.player.puddleMult = inPuddle ? 0.6 : 1
  }

  _useWaterTowerValve() {
    if (!this.nearWaterTowerValve) return
    this.waterTowerPuddleUntil = performance.now() + WATER_TOWER_PUDDLE_DURATION_MS
    this._showLoreToast(t('toastValveOpened'))
  }

  _updateIndustrialSiren(playerPos) {
    this.nearIndustrialSiren = Math.hypot(playerPos.x - this.industrialSiren.x, playerPos.z - this.industrialSiren.z) <= INDUSTRIAL_SIREN_RADIUS
  }

  _pullSirenLever() {
    if (!this.nearIndustrialSiren) return
    this.sirenLootBonusUntil = performance.now() + SIREN_BONUS_DURATION_MS
    this.zombies.spawnSurge(SIREN_SURGE_COUNT)
    this._showLoreToast(t('toastSirenPulled'))
  }

  _updateWreckingPendulum(playerPos) {
    this.nearWreckingPendulum = Math.hypot(playerPos.x - this.wreckingPendulum.x, playerPos.z - this.wreckingPendulum.z) <= WRECKING_PENDULUM_RADIUS
    if (this._pendulumSwingStartedAt === 0) return
    const elapsed = performance.now() - this._pendulumSwingStartedAt
    const frac = Math.min(1, elapsed / PENDULUM_SWING_DURATION_MS)
    // One full swing, out and back - a sine arc through the pivot rather
    // than a rigid-body simulation, same "good enough" spirit as every
    // other cosmetic-physics animation in this file (killcam zoom lerp,
    // landing dip, etc).
    const angle = Math.sin(frac * Math.PI) * (Math.PI / 3)
    const p = this.wreckingPendulum.pivot
    const len = this.wreckingPendulum.ropeLength
    // Ball's position is in the GROUP's local space, which is why its
    // resting local x is localPivotX (1.7), not 0 - the pivot itself sits
    // offset from the group's own origin (see buildWreckingPendulum).
    const localPivotX = this.wreckingPendulum.localPivotX
    this.wreckingPendulum.ball.position.set(localPivotX + Math.sin(angle) * len, p.y - Math.cos(angle) * len, 0)
    if (!this._pendulumHitThisSwing && frac > 0.45 && frac < 0.55) {
      this._pendulumHitThisSwing = true
      // World-space ball x, derived directly from the pivot (already
      // world-space, see buildWreckingPendulum's own comment) + swing
      // offset - NOT pivot.x + ball.position.x, which would double-count
      // the local pivot offset baked into both.
      const ballWorldX = p.x + Math.sin(angle) * len
      for (const zombie of this.zombies.zombies) {
        if (zombie.state !== 'alive') continue
        const dist = Math.hypot(zombie.group.position.x - ballWorldX, zombie.group.position.z - p.z)
        if (dist <= PENDULUM_HIT_RADIUS) {
          zombie.lastHitWeaponId = 'pendulum'
          zombie.onHit(PENDULUM_DAMAGE)
        }
      }
      this._triggerShake(0.06, 150)
    }
    if (frac >= 1) this._pendulumSwingStartedAt = 0
  }

  _triggerWreckingPendulum() {
    if (!this.nearWreckingPendulum || this._pendulumSwingStartedAt !== 0) return
    this._pendulumSwingStartedAt = performance.now()
    this._pendulumHitThisSwing = false
    this._showLoreToast(t('toastPendulumTriggered'))
  }

  _updateElevatorTower(playerPos) {
    const car = this.elevatorTower.car
    if (this.elevatorRiding) {
      const elapsed = performance.now() - this.elevatorRideStartedAt
      const frac = Math.min(1, elapsed / ELEVATOR_RIDE_DURATION_MS)
      car.position.y = THREE.MathUtils.lerp(this.elevatorRideFromY, this.elevatorRideToY, frac)
      // World.js's final buildWorld() pass sets matrixAutoUpdate=false on
      // every object it builds (a real perf win for the ~15k static
      // objects that never move again - see its own comment) - a moving
      // object built there has to manually re-bake its matrix after every
      // position change or the render/raycast never picks up the change.
      car.updateMatrix()
      this.nearElevatorCar = false
      this.player.nearLadder = null
      if (frac >= 1) {
        this.elevatorRiding = false
        this.elevatorFloor = this.elevatorRideToY > 0 ? 'top' : 'bottom'
      }
      return
    }
    this.nearElevatorCar =
      Math.hypot(playerPos.x - car.position.x, playerPos.z - car.position.z) <= ELEVATOR_INTERACT_RADIUS &&
      Math.abs(playerPos.y - this.player.eyeHeight - car.position.y) < 1.0
    const tower = this.elevatorTower
    this.player.nearLadder = Math.hypot(playerPos.x - tower.ladderX, playerPos.z - tower.ladderZ) <= LADDER_RADIUS
      ? { x: tower.ladderX, z: tower.ladderZ, topY: tower.stopHeight }
      : null
  }

  _rideElevator() {
    if (this.elevatorRiding) return
    const toTop = this.elevatorFloor === 'bottom'
    this.elevatorRideFromY = this.elevatorTower.car.position.y
    this.elevatorRideToY = toTop ? this.elevatorTower.stopHeight : 0
    this.elevatorRideStartedAt = performance.now()
    this.elevatorRiding = true
    this.player.startScriptedMove(this.elevatorTower.x, this.elevatorRideToY + this.player.eyeHeight, this.elevatorTower.z, ELEVATOR_RIDE_DURATION_MS)
  }

  // Called from WeaponSystem's hit loop via scaffolding.onHit (see
  // buildScaffolding's own comment on why it holds a real object
  // reference, not just a boolean flag).
  _collapseScaffolding() {
    if (this.scaffolding.destroyed) return
    this.scaffolding.destroyed = true
    this.scene.remove(this.scaffolding.group)
    const gi = this.solidMeshes.indexOf(this.scaffolding.group)
    if (gi !== -1) this.solidMeshes.splice(gi, 1)
    const bi = this.colliders.indexOf(this.scaffolding.box)
    if (bi !== -1) this.colliders.splice(bi, 1)
    for (const zombie of this.zombies.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - this.scaffolding.x, zombie.group.position.z - this.scaffolding.z)
      if (dist <= SCAFFOLDING_COLLAPSE_RADIUS) {
        zombie.lastHitWeaponId = 'scaffolding'
        zombie.onHit(SCAFFOLDING_COLLAPSE_DAMAGE)
      }
    }
    this._triggerShake(0.08, 200)
    this._showLoreToast(t('toastScaffoldingCollapsed'))
  }

  _updatePayphone(playerPos) {
    this.nearPayphone = Math.hypot(playerPos.x - this.payphone.x, playerPos.z - this.payphone.z) <= PAYPHONE_INTERACT_RADIUS
    if (this.payphoneCallActive && performance.now() >= this.payphoneCallReadyAt) {
      this.payphoneCallActive = false
      this.coins += 60
      this.inventory.addHealthPack(1)
      this._updateInventoryHud()
      this._showLoreToast(t('toastPayphoneArrived'))
    }
  }

  _usePayphone() {
    if (!this.nearPayphone || this.payphoneUsedThisRun || this.payphoneCallActive) return
    this.payphoneUsedThisRun = true
    this.payphoneCallActive = true
    this.payphoneCallReadyAt = performance.now() + PAYPHONE_CALL_DELAY_MS
    this._showLoreToast(t('toastPayphoneCalled'))
  }

  // Barricade Crates - a placeable, portable chokepoint obstacle (mirrors
  // _throwC4's placement math) with its own health pool like
  // _buildDestructibleWall, but purely a movement blocker - no damage
  // component of its own, distinct in shape from the existing spike/
  // electric traps (_deployTrap) and tripwire alarm (_deployAlarm), which
  // both damage/lure rather than just physically block.
  _placeBarricadeCrate() {
    if (!this.inventory.useBarricadeCrate()) {
      this._showLoreToast(t('toastNoBarricadeCrate'))
      return
    }
    this.camera.getWorldDirection(this._camDir)
    const playerPos = this.player.controls.object.position
    const x = playerPos.x + this._camDir.x * BARRICADE_CRATE_PLACE_DIST
    const z = playerPos.z + this._camDir.z * BARRICADE_CRATE_PLACE_DIST

    const mat = flatMaterial({ color: 0x5a4a30, roughness: 0.9 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), mat)
    mesh.position.set(x, 0.55, z)
    mesh.castShadow = true
    this.scene.add(mesh)

    const box = new THREE.Box3(
      new THREE.Vector3(x - 0.55, 0, z - 0.55),
      new THREE.Vector3(x + 0.55, 1.1, z + 0.55)
    )
    this.colliders.push(box)
    this.solidMeshes.push(mesh)

    const crate = { x, z, health: BARRICADE_CRATE_HEALTH, mesh, box, mat }
    this.barricadeCrates.push(crate)
    this._updateInventoryHud()
    this._showLoreToast(t('toastBarricadeCratePlaced'))
  }

  _removeBarricadeCrate(crate) {
    this.scene.remove(crate.mesh)
    const ci = this.colliders.indexOf(crate.box)
    if (ci !== -1) this.colliders.splice(ci, 1)
    const si = this.solidMeshes.indexOf(crate.mesh)
    if (si !== -1) this.solidMeshes.splice(si, 1)
    const bi = this.barricadeCrates.indexOf(crate)
    if (bi !== -1) this.barricadeCrates.splice(bi, 1)
  }

  // Zombies chip away at a nearby crate over time instead of instantly
  // pathing through it - same "obstacle with a health pool" idea
  // destructibleWalls already models, just decremented on a timer per
  // nearby zombie rather than needing a dedicated attack animation.
  _updateBarricadeCrates(dt, playerPos) {
    if (this.barricadeCrates.length === 0) {
      this.nearBarricadeCrate = null
      return
    }
    this.nearBarricadeCrate = this.barricadeCrates.find((c) => Math.hypot(playerPos.x - c.x, playerPos.z - c.z) <= BARRICADE_CRATE_INTERACT_RADIUS) || null
    for (const crate of [...this.barricadeCrates]) {
      let underAttack = false
      for (const zombie of this.zombies.zombies) {
        if (zombie.state !== 'alive') continue
        if (Math.hypot(zombie.group.position.x - crate.x, zombie.group.position.z - crate.z) <= 1.3) {
          underAttack = true
          break
        }
      }
      if (underAttack) {
        crate.health -= BARRICADE_CRATE_CHIP_PER_SEC * dt
        if (crate.health <= 0) this._removeBarricadeCrate(crate)
      }
    }
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
    // _spawnHazardZone builds a fresh geometry/material per zone (radius
    // and color both vary by type) - scene.remove() alone doesn't free
    // either's GPU buffer, the same leak class Zombie.js's own dispose()
    // already documents fixing for corpses.
    zone.mesh.geometry.dispose()
    zone.mesh.material.dispose()
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
      // Remembered for #quick-language-btn's English<->alt toggle.
      if (btn.dataset.lang !== 'en') this.settings.quickLanguageAlt = btn.dataset.lang
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
    this.invertYToggle.checked = this.settings.invertY
    this.player.invertY = this.settings.invertY

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

    this.invertYToggle.addEventListener('change', () => {
      this.settings.invertY = this.invertYToggle.checked
      this.player.invertY = this.settings.invertY
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

    // Nickname color - a plain CSS custom property, same technique as
    // crosshair color above, read by the .nickname-tag class wrapped around
    // every nickname display site (Hardcore Memorial, Kill Feed).
    this.nicknameColorPicker.value = this.settings.nicknameColor
    document.documentElement.style.setProperty('--nickname-color', this.settings.nicknameColor)
    this.nicknameColorPicker.addEventListener('input', () => {
      this.settings.nicknameColor = this.nicknameColorPicker.value
      document.documentElement.style.setProperty('--nickname-color', this.settings.nicknameColor)
      saveSettings(this.settings)
    })

    // Companion color override - live-rebuilds the companion the same way
    // a role swap already does (_rebuildCompanion), so the change is
    // visible immediately rather than only on the next run/rescue.
    this.companionColorPicker.value = this.settings.companionColor || '#2f4f7a'
    this._renderCompanionColorPreview()
    this.companionColorPicker.addEventListener('input', () => {
      this.settings.companionColor = this.companionColorPicker.value
      saveSettings(this.settings)
      if (this.companion) this._rebuildCompanion(this.settings.companionRole)
      this._renderCompanionColorPreview()
    })
    // Companion Name Tag Color - a plain CSS var applied to the input
    // field itself (the only current on-screen "companion name tag"
    // display), same --nickname-color technique above.
    if (this.companionNameColorPicker) {
      this.companionNameColorPicker.value = this.settings.companionNameColor || '#8fc8ff'
      document.documentElement.style.setProperty('--companion-name-color', this.settings.companionNameColor || '#8fc8ff')
      this.companionNameColorPicker.addEventListener('input', () => {
        this.settings.companionNameColor = this.companionNameColorPicker.value
        document.documentElement.style.setProperty('--companion-name-color', this.settings.companionNameColor)
        saveSettings(this.settings)
      })
    }

    // Homepage Accent Color - overrides --menu-gold on #menu itself
    // (inline style beats the stylesheet's own #menu rule), recoloring
    // every gold highlight/border/active-state across the homepage at
    // once. Reset restores the original gold by clearing the override.
    if (this.accentColorPicker) {
      const defaultAccent = '#d9a34a'
      this.accentColorPicker.value = this.settings.accentColor || defaultAccent
      if (this.settings.accentColor && this.menu) this.menu.style.setProperty('--menu-gold', this.settings.accentColor)
      this.accentColorPicker.addEventListener('input', () => {
        this.settings.accentColor = this.accentColorPicker.value
        if (this.menu) this.menu.style.setProperty('--menu-gold', this.settings.accentColor)
        saveSettings(this.settings)
      })
      if (this.accentColorResetBtn) {
        this.accentColorResetBtn.addEventListener('click', () => {
          this.settings.accentColor = null
          this.accentColorPicker.value = defaultAccent
          if (this.menu) this.menu.style.removeProperty('--menu-gold')
          saveSettings(this.settings)
        })
      }
    }

    // Play Button Color - a dedicated CSS var (--play-btn-color) the
    // #play-btn gradient reads, independent of the accent color above so
    // the two can be set separately.
    if (this.playBtnColorPicker) {
      const defaultPlayColor = '#d9a34a'
      this.playBtnColorPicker.value = this.settings.playBtnColor || defaultPlayColor
      if (this.settings.playBtnColor) document.documentElement.style.setProperty('--play-btn-color', this.settings.playBtnColor)
      this.playBtnColorPicker.addEventListener('input', () => {
        this.settings.playBtnColor = this.playBtnColorPicker.value
        document.documentElement.style.setProperty('--play-btn-color', this.settings.playBtnColor)
        saveSettings(this.settings)
      })
      if (this.playBtnColorResetBtn) {
        this.playBtnColorResetBtn.addEventListener('click', () => {
          this.settings.playBtnColor = null
          this.playBtnColorPicker.value = defaultPlayColor
          document.documentElement.style.removeProperty('--play-btn-color')
          saveSettings(this.settings)
        })
      }
    }

    if (this.nicknameFontSelect) {
      this.nicknameFontSelect.value = this.settings.nicknameFont
      document.documentElement.style.setProperty('--nickname-font', NICKNAME_FONT_STACKS[this.settings.nicknameFont] || NICKNAME_FONT_STACKS.default)
      this.nicknameFontSelect.addEventListener('change', () => {
        this.settings.nicknameFont = this.nicknameFontSelect.value
        document.documentElement.style.setProperty('--nickname-font', NICKNAME_FONT_STACKS[this.settings.nicknameFont] || NICKNAME_FONT_STACKS.default)
        saveSettings(this.settings)
      })
    }

    if (this.layoutDensitySelect) {
      this.layoutDensitySelect.value = this.settings.layoutDensity
      document.documentElement.classList.toggle('layout-compact', this.settings.layoutDensity === 'compact')
      this.layoutDensitySelect.addEventListener('change', () => {
        this.settings.layoutDensity = this.layoutDensitySelect.value
        document.documentElement.classList.toggle('layout-compact', this.settings.layoutDensity === 'compact')
        saveSettings(this.settings)
      })
    }

    if (this.randomNicknameBtn) {
      this.randomNicknameBtn.addEventListener('click', () => {
        const adj = RANDOM_NICKNAME_ADJECTIVES[Math.floor(Math.random() * RANDOM_NICKNAME_ADJECTIVES.length)]
        const noun = RANDOM_NICKNAME_NOUNS[Math.floor(Math.random() * RANDOM_NICKNAME_NOUNS.length)]
        const suffix = Math.floor(Math.random() * 90) + 10
        this.nicknameInput.value = `${adj}${noun}${suffix}`.slice(0, 16)
        this.settings.nickname = this.nicknameInput.value
        saveSettings(this.settings)
        this._renderPlayerTag()
      })
    }
    if (this.mottoInput) {
      this.mottoInput.value = this.settings.motto
      this.mottoInput.addEventListener('input', () => {
        this.settings.motto = this.mottoInput.value.slice(0, 60)
        saveSettings(this.settings)
        this._renderPlayerTag()
      })
    }

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

    // Streaming-safe mode (see _updateStreamSafeVisibility).
    this.streamSafeModeToggle.checked = this.settings.streamSafeMode
    this._updateStreamSafeVisibility()
    this.streamSafeModeToggle.addEventListener('change', () => {
      this.settings.streamSafeMode = this.streamSafeModeToggle.checked
      this._updateStreamSafeVisibility()
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

    // Large Text / High Contrast modes - two more accessibility toggles
    // alongside colorblind, applied as classes on <html> (document.
    // documentElement) so the CSS can be a couple of scoped rules rather
    // than per-element style overrides.
    if (this.largeTextToggle) {
      this.largeTextToggle.checked = this.settings.largeTextMode
      document.documentElement.classList.toggle('large-text-mode', this.settings.largeTextMode)
      this.largeTextToggle.addEventListener('change', () => {
        this.settings.largeTextMode = this.largeTextToggle.checked
        document.documentElement.classList.toggle('large-text-mode', this.settings.largeTextMode)
        saveSettings(this.settings)
      })
    }
    if (this.highContrastToggle) {
      this.highContrastToggle.checked = this.settings.highContrastMode
      document.documentElement.classList.toggle('high-contrast-mode', this.settings.highContrastMode)
      this.highContrastToggle.addEventListener('change', () => {
        this.settings.highContrastMode = this.highContrastToggle.checked
        document.documentElement.classList.toggle('high-contrast-mode', this.settings.highContrastMode)
        saveSettings(this.settings)
      })
    }
    if (this.focusRingToggle) {
      this.focusRingToggle.checked = this.settings.focusRingMode
      document.documentElement.classList.toggle('focus-ring-mode', this.settings.focusRingMode)
      this.focusRingToggle.addEventListener('change', () => {
        this.settings.focusRingMode = this.focusRingToggle.checked
        document.documentElement.classList.toggle('focus-ring-mode', this.settings.focusRingMode)
        saveSettings(this.settings)
      })
    }
    this.frameTimeGraphToggle = document.getElementById('frame-time-graph-toggle')
    if (this.frameTimeGraphToggle) {
      this.frameTimeGraphToggle.checked = this.settings.frameTimeGraph
      this._applyFrameTimeGraphVisibility()
      this.frameTimeGraphToggle.addEventListener('change', () => {
        this.settings.frameTimeGraph = this.frameTimeGraphToggle.checked
        this._applyFrameTimeGraphVisibility()
        saveSettings(this.settings)
      })
    }
    if (this.homepageFpsToggle) {
      this.homepageFpsToggle.checked = this.settings.homepageFpsCounter
      if (this.settings.homepageFpsCounter) this.fpsEl.style.opacity = '1'
      this._applyFrameTimeGraphVisibility()
      this.homepageFpsToggle.addEventListener('change', () => {
        this.settings.homepageFpsCounter = this.homepageFpsToggle.checked
        this.fpsEl.style.opacity = (this.settings.homepageFpsCounter || this.gameStarted) ? '1' : '0'
        this._applyFrameTimeGraphVisibility()
        saveSettings(this.settings)
      })
    }
    if (this.underlineLinksToggle) {
      this.underlineLinksToggle.checked = this.settings.underlineLinks
      document.documentElement.classList.toggle('underline-links', this.settings.underlineLinks)
      this.underlineLinksToggle.addEventListener('change', () => {
        this.settings.underlineLinks = this.underlineLinksToggle.checked
        document.documentElement.classList.toggle('underline-links', this.settings.underlineLinks)
        saveSettings(this.settings)
      })
    }
    if (this.uiFontSelect) {
      this.uiFontSelect.value = this.settings.uiFont
      document.documentElement.style.setProperty('--ui-font', NICKNAME_FONT_STACKS[this.settings.uiFont] || NICKNAME_FONT_STACKS.default)
      this.uiFontSelect.addEventListener('change', () => {
        this.settings.uiFont = this.uiFontSelect.value
        document.documentElement.style.setProperty('--ui-font', NICKNAME_FONT_STACKS[this.settings.uiFont] || NICKNAME_FONT_STACKS.default)
        saveSettings(this.settings)
      })
    }
    if (this.textSpacingSlider) {
      this.textSpacingSlider.value = this.settings.textSpacing
      this.textSpacingValue.textContent = `${this.settings.textSpacing}%`
      document.documentElement.style.setProperty('--text-spacing', this.settings.textSpacing)
      document.documentElement.classList.toggle('text-spacing-active', this.settings.textSpacing !== 100)
      this.textSpacingSlider.addEventListener('input', () => {
        const value = Number(this.textSpacingSlider.value)
        this.textSpacingValue.textContent = `${value}%`
        this.settings.textSpacing = value
        document.documentElement.style.setProperty('--text-spacing', value)
        document.documentElement.classList.toggle('text-spacing-active', value !== 100)
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.textSpacingValue, this.textSpacingSlider)
    }
    if (this.buttonSizeSlider) {
      const applyButtonSize = (value) => {
        document.documentElement.classList.toggle('button-size-scaled', value !== 100)
        document.documentElement.style.setProperty('--button-size-scale', value / 100)
      }
      this.buttonSizeSlider.value = this.settings.buttonSize
      this.buttonSizeValue.textContent = `${this.settings.buttonSize}%`
      applyButtonSize(this.settings.buttonSize)
      this.buttonSizeSlider.addEventListener('input', () => {
        const value = Number(this.buttonSizeSlider.value)
        this.buttonSizeValue.textContent = `${value}%`
        this.settings.buttonSize = value
        applyButtonSize(value)
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.buttonSizeValue, this.buttonSizeSlider)
    }
    if (this.reduceTransparencyToggle) {
      this.reduceTransparencyToggle.checked = this.settings.reduceTransparency
      document.documentElement.classList.toggle('reduce-transparency', this.settings.reduceTransparency)
      this.reduceTransparencyToggle.addEventListener('change', () => {
        this.settings.reduceTransparency = this.reduceTransparencyToggle.checked
        document.documentElement.classList.toggle('reduce-transparency', this.settings.reduceTransparency)
        saveSettings(this.settings)
      })
    }
    if (this.hoverAudioCueToggle) {
      this.hoverAudioCueToggle.checked = this.settings.hoverAudioCue
      this.hoverAudioCueToggle.addEventListener('change', () => {
        this.settings.hoverAudioCue = this.hoverAudioCueToggle.checked
        saveSettings(this.settings)
      })
    }
    if (this.highVisCursorToggle) {
      this.highVisCursorToggle.checked = this.settings.highVisCursor
      document.documentElement.classList.toggle('high-vis-cursor', this.settings.highVisCursor)
      this.highVisCursorToggle.addEventListener('change', () => {
        this.settings.highVisCursor = this.highVisCursorToggle.checked
        document.documentElement.classList.toggle('high-vis-cursor', this.settings.highVisCursor)
        saveSettings(this.settings)
      })
    }
    if (this.captionBackgroundToggle) {
      this.captionBackgroundToggle.checked = this.settings.captionBackground
      document.documentElement.classList.toggle('caption-background', this.settings.captionBackground)
      this.captionBackgroundToggle.addEventListener('change', () => {
        this.settings.captionBackground = this.captionBackgroundToggle.checked
        document.documentElement.classList.toggle('caption-background', this.settings.captionBackground)
        saveSettings(this.settings)
      })
    }
    if (this.themePresetSelect) {
      const applyTheme = (preset) => {
        for (const cls of ['theme-sepia', 'theme-darker', 'theme-lighter']) document.documentElement.classList.remove(cls)
        if (preset !== 'none') document.documentElement.classList.add(`theme-${preset}`)
      }
      this.themePresetSelect.value = this.settings.themePreset
      applyTheme(this.settings.themePreset)
      this.themePresetSelect.addEventListener('change', () => {
        this.settings.themePreset = this.themePresetSelect.value
        applyTheme(this.settings.themePreset)
        saveSettings(this.settings)
      })
    }
    // Audio Cue on Hover/Focus - a single delegated listener on #menu
    // (event bubbling from focusin, which - unlike focus - does bubble)
    // covers every current and future homepage button without needing
    // one listener per element.
    if (this.menu) {
      this.menu.addEventListener('mouseover', (e) => {
        if (this.settings.hoverAudioCue && e.target.closest('button')) audioEngine.playUiHover?.()
      })
      this.menu.addEventListener('focusin', (e) => {
        if (this.settings.hoverAudioCue && e.target.closest('button')) audioEngine.playUiHover?.()
      })
    }

    if (this.cursorTrailToggle) {
      this.cursorTrailToggle.checked = this.settings.cursorTrail
      this.cursorTrailToggle.addEventListener('change', () => {
        this.settings.cursorTrail = this.cursorTrailToggle.checked
        saveSettings(this.settings)
      })
    }
    // Cursor Trail Effect - one throttled listener, homepage-only
    // (checks !this.gameStarted, same guard the idle-animation/Konami
    // listeners already use), spawns a small fading dot per movement,
    // capped by a timestamp check rather than a per-frame budget.
    if (this.menu) {
      let lastTrailAt = 0
      this.menu.addEventListener('mousemove', (e) => {
        if (!this.settings.cursorTrail || this.gameStarted) return
        const now = performance.now()
        if (now - lastTrailAt < 40) return
        lastTrailAt = now
        const dot = document.createElement('div')
        dot.className = 'cursor-trail-dot'
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
        document.body.appendChild(dot)
        dot.addEventListener('animationend', () => dot.remove())
      })
    }
    if (this.crtScanlinesToggle) {
      this.crtScanlinesToggle.checked = this.settings.crtScanlines
      document.documentElement.classList.toggle('crt-scanlines', this.settings.crtScanlines)
      this.crtScanlinesToggle.addEventListener('change', () => {
        this.settings.crtScanlines = this.crtScanlinesToggle.checked
        document.documentElement.classList.toggle('crt-scanlines', this.settings.crtScanlines)
        saveSettings(this.settings)
        if (this.settings.crtScanlines) CloudSync.incrementTelemetry('crtEnabled').catch(() => {})
      })
    }
    if (this.weatherParticlesToggle) {
      const applyWeather = (on) => {
        if (this.menuBgRain) this.menuBgRain.style.display = on ? '' : 'none'
        if (this.menuBgAsh) this.menuBgAsh.style.display = on ? '' : 'none'
      }
      this.weatherParticlesToggle.checked = this.settings.weatherParticles
      applyWeather(this.settings.weatherParticles)
      this.weatherParticlesToggle.addEventListener('change', () => {
        this.settings.weatherParticles = this.weatherParticlesToggle.checked
        applyWeather(this.settings.weatherParticles)
        saveSettings(this.settings)
      })
    }
    if (this.dyslexiaFontToggle) {
      this.dyslexiaFontToggle.checked = this.settings.dyslexiaFont
      document.documentElement.classList.toggle('dyslexia-font', this.settings.dyslexiaFont)
      this.dyslexiaFontToggle.addEventListener('change', () => {
        this.settings.dyslexiaFont = this.dyslexiaFontToggle.checked
        document.documentElement.classList.toggle('dyslexia-font', this.settings.dyslexiaFont)
        saveSettings(this.settings)
      })
    }
    if (this.bgMoodSelect) {
      this.bgMoodSelect.value = this.settings.bgMood
      this._applyBgMood()
      this.bgMoodSelect.addEventListener('change', () => {
        this.settings.bgMood = this.bgMoodSelect.value
        this._applyBgMood()
        saveSettings(this.settings)
      })
    }
    // Keybind Cheat Sheet - a persistent in-game HUD overlay, distinct
    // from the one-time tutorial toasts and the replayable How to Play
    // modal (see #keybind-cheatsheet's own CSS comment). Only actually
    // visible while gameStarted, same gating every other gameplay-only
    // HUD element already uses.
    if (this.keybindCheatsheetToggle) {
      this.keybindCheatsheetToggle.checked = this.settings.keybindCheatSheet
      this.keybindCheatsheetToggle.addEventListener('change', () => {
        this.settings.keybindCheatSheet = this.keybindCheatsheetToggle.checked
        saveSettings(this.settings)
        if (this.keybindCheatsheet) this.keybindCheatsheet.style.display = (this.settings.keybindCheatSheet && this.gameStarted) ? '' : 'none'
      })
    }
    // Show Hit Feedback - hides the crosshair hitmarker flash (WeaponSystem's
    // _showHitmarker) and floating damage numbers (_spawnDamageNumber below)
    // for players who want a cleaner screen. Defaults ON to match this
    // game's existing always-on behavior before this setting existed.
    if (this.hitFeedbackToggle) {
      this.hitFeedbackToggle.checked = this.settings.showHitFeedback
      this.hitFeedbackToggle.addEventListener('change', () => {
        this.settings.showHitFeedback = this.hitFeedbackToggle.checked
        saveSettings(this.settings)
      })
    }
    if (this.musicTestBtn) {
      this.musicTestBtn.addEventListener('click', () => {
        audioEngine.init()
        audioEngine.resume()
        audioEngine.startMusic()
      })
    }
    if (this.sfxTestBtn) {
      this.sfxTestBtn.addEventListener('click', () => {
        audioEngine.init()
        audioEngine.resume()
        audioEngine.playShot('pistol')
      })
    }

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

    this.guestModeToggle.checked = this.settings.guestMode
    this.guestModeToggle.addEventListener('change', () => {
      this.settings.guestMode = this.guestModeToggle.checked
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
      this._renderPlayerTag()
    })
    this.companionNameInput.addEventListener('input', () => {
      this.settings.companionName = this.companionNameInput.value
      saveSettings(this.settings)
      this._updateCompanionName()
    })
    // Challenge code - deliberately NOT persisted to settings (unlike
    // nickname/companion name above) - it's a one-shot, typed-fresh-each-
    // time code, not a standing preference.
    this.challengeCodeInput.addEventListener('input', () => {
      this._pendingChallengeCode = this.challengeCodeInput.value.trim()
    })

    this.settingsBtn.addEventListener('click', () => this._toggleSettings(!this.settingsOpen))
    // Recently Viewed Panel quick-return (see the shortcut cheat sheet's
    // "R" row) - remembers whichever of these 6 nav-reachable panels was
    // opened most recently, so it can be reopened with one keypress
    // without re-navigating the homepage nav row.
    const trackAndOpen = (openFn) => { this._lastPanelOpener = openFn; openFn() }
    this.upgradesBtn.addEventListener('click', () => trackAndOpen(() => this._openUpgradesPanel()))
    this.prestigeBtn.addEventListener('click', () => this._prestige())
    this.respecBtn.addEventListener('click', () => this._respecMetaUpgrades())
    this.questsBtn.addEventListener('click', () => trackAndOpen(() => this._openQuestsPanel()))
    this.questsOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-quest-id]')
      if (btn && !btn.disabled) this._claimQuest(btn.dataset.questId)
    })
    this.rollingQuestsOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-spawned-at]')
      if (btn && !btn.disabled) this._claimRollingQuest(Number(btn.dataset.spawnedAt))
    })
    this.achievementsBtn.addEventListener('click', () => trackAndOpen(() => this._openAchievementsPanel()))
    if (this.achievementsFilterInput) {
      this.achievementsFilterInput.addEventListener('click', (e) => e.stopPropagation())
      this.achievementsFilterInput.addEventListener('input', () => this._renderAchievementsPanel())
    }
    if (this.achievementsCategorySelect) {
      this.achievementsCategorySelect.addEventListener('click', (e) => e.stopPropagation())
      this.achievementsCategorySelect.addEventListener('change', () => this._renderAchievementsPanel())
    }
    if (this.achievementsSortSelect) {
      this.achievementsSortSelect.addEventListener('click', (e) => e.stopPropagation())
      this.achievementsSortSelect.addEventListener('change', () => this._renderAchievementsPanel())
    }
    if (this.printAchievementsBtn) {
      this.printAchievementsBtn.addEventListener('click', () => {
        if (!this.printStatsSheet) return
        this.printStatsSheet.innerHTML = `<h1>${t('printAchievementsTitle')}</h1>${this.achievementsOptions.innerHTML}`
        window.print()
      })
    }
    if (this.bestiaryFilterInput) {
      this.bestiaryFilterInput.addEventListener('click', (e) => e.stopPropagation())
      this.bestiaryFilterInput.addEventListener('input', () => this._renderBestiaryPanel())
    }
    this.menuPlayerBadge.addEventListener('click', () => this._openProfilePanel())
    this.menuPlayerBadge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this._openProfilePanel()
      }
    })
    this.profileCopyStatsBtn.addEventListener('click', () => this._copyProfileStatsToClipboard())
    if (this.profileReadAloudBtn) this.profileReadAloudBtn.addEventListener('click', () => this._readProfileStatsAloud())
    if (this.sharedProfileCloseBtn) {
      this.sharedProfileCloseBtn.addEventListener('click', () => { this.sharedProfileBanner.style.display = 'none' })
    }
    if (this.whatsNewDigestCloseBtn) {
      this.whatsNewDigestCloseBtn.addEventListener('click', () => {
        this.whatsNewDigest.style.display = 'none'
        try { localStorage.setItem(CHANGELOG_LAST_VIEWED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
        this._updateWhatsNewDot()
      })
    }
    // Login/Register both trigger the same Google sign-in flow today (see
    // _handleCloudSignIn) - kept as two separate buttons/labels rather than
    // one combined "Sign in with Google" button so a second sign-in method
    // can slot in later without a UI reshuffle.
    if (this.profileLoginBtn) this.profileLoginBtn.addEventListener('click', () => this._handleCloudSignIn())
    if (this.profileRegisterBtn) this.profileRegisterBtn.addEventListener('click', () => this._handleCloudSignIn())
    if (this.profileSignoutBtn) {
      this.profileSignoutBtn.addEventListener('click', async () => {
        await CloudSaveUI.handleCloudSignOut(this)
        this._renderProfileAccountRow()
      })
    }
    if (this.profileCareerPortraitBtn) this.profileCareerPortraitBtn.addEventListener('click', () => this._generateCareerPortrait())
    if (this.profilePrintBtn) this.profilePrintBtn.addEventListener('click', () => this._printProfile())
    if (this.printChangelogBtn) this.printChangelogBtn.addEventListener('click', () => this._printChangelog())
    if (this.copyChangelogBtn) {
      this.copyChangelogBtn.addEventListener('click', () => {
        const entries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry'))
          .map((el) => `${el.querySelector('.changelog-date')?.textContent || ''}: ${el.querySelector('.changelog-text')?.textContent || ''}`)
        if (!navigator.clipboard) { this._showLoreToast(t('clipboardCopyUnsupported')); return }
        navigator.clipboard.writeText(entries.join('\n'))
          .then(() => this._showLoreToast(t('clipboardCopySuccess')))
          .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
      })
    }
    // Check for Updates - this app has no service worker/version-check
    // API of its own (a plain static Vite build), so a real reload IS
    // the actual "check for updates" mechanism - it re-fetches whatever
    // is currently deployed, same as the browser's own refresh button.
    if (this.checkUpdatesBtn) this.checkUpdatesBtn.addEventListener('click', () => window.location.reload())
    if (this.copyDiagnosticsBtn) {
      this.copyDiagnosticsBtn.addEventListener('click', () => {
        if (!navigator.clipboard) { this._showLoreToast(t('clipboardCopyUnsupported')); return }
        navigator.clipboard.writeText(this._buildDiagnosticsText())
          .then(() => this._showLoreToast(t('clipboardCopySuccess')))
          .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
      })
    }
    if (this.copyErrorLogBtn) {
      this.copyErrorLogBtn.addEventListener('click', () => {
        if (!navigator.clipboard) { this._showLoreToast(t('clipboardCopyUnsupported')); return }
        const text = this._errorLog.length ? this._errorLog.join('\n') : t('errorLogEmpty')
        navigator.clipboard.writeText(text)
          .then(() => this._showLoreToast(t('clipboardCopySuccess')))
          .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
      })
    }
    this.shareRunCardBtn.addEventListener('click', () => this._generateRunSummaryCard())
    if (this.copyTextRecapBtn) this.copyTextRecapBtn.addEventListener('click', () => this._copyTextRecap())
    if (this.acceptChallengeBtn) this.acceptChallengeBtn.addEventListener('click', () => this._acceptChallenge())
    if (this.applyLoadoutCodeBtn) {
      this.applyLoadoutCodeBtn.addEventListener('click', () => this._applyLoadoutCode(this.loadoutCodeInput.value))
    }
    this.creditsBtn.addEventListener('click', () => trackAndOpen(() => this._openCreditsPanel()))
    this.coinshopBtn.addEventListener('click', () => trackAndOpen(() => this._openCoinShopPanel()))
    if (this.shopSortSelect) {
      this.shopSortSelect.value = this.settings.shopSortMode
      this.shopSortSelect.addEventListener('click', (e) => e.stopPropagation())
      this.shopSortSelect.addEventListener('change', () => {
        this.settings.shopSortMode = this.shopSortSelect.value
        saveSettings(this.settings)
        this._renderCoinShopOptions()
      })
    }
    this._bindHomepageBatch()
    CloudSaveUI.bindCloudSave(this)
    this._checkBeatThisChallenge()
    this._checkViewProfileLink()
    this._maybeShowWhatsNewDigest()
    this._checkFriendBeatNotifications()
    this._checkSettingsTabDeepLink()
    this._checkWeeklyResetImminent()
    this._checkUnclaimedQuestsReminder()
    if (this.openShareBtn) this.openShareBtn.addEventListener('click', () => trackAndOpen(() => this._openSharePanel()))
    if (this.sharePanel) {
      this.sharePanel.addEventListener('click', (e) => {
        if (e.target === this.sharePanel) this._closeSharePanel()
      })
    }
    if (this.shareSetupBtn) this.shareSetupBtn.addEventListener('click', () => this._copySetupCode())
    if (this.shareProfileBtn) this.shareProfileBtn.addEventListener('click', () => this._copyProfileLink())
    if (this.shareChallengeBtn) this.shareChallengeBtn.addEventListener('click', () => this._copyBeatThisLink())
    if (this.shareLoadoutBtn) this.shareLoadoutBtn.addEventListener('click', () => this._copyLoadoutCode())
    if (this.sharePageLinkBtn) this.sharePageLinkBtn.addEventListener('click', () => this._copyPageUrl())
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
    this.questsPanel.addEventListener('click', (e) => {
      if (e.target === this.questsPanel) this._closeQuestsPanel()
    })
    this.achievementsPanel.addEventListener('click', (e) => {
      if (e.target === this.achievementsPanel) this._closeAchievementsPanel()
    })
    this.profilePanel.addEventListener('click', (e) => {
      if (e.target === this.profilePanel) this._closeProfilePanel()
    })
    this.creditsPanel.addEventListener('click', (e) => {
      if (e.target === this.creditsPanel) this._closeCreditsPanel()
    })
    this.coinshopPanel.addEventListener('click', (e) => {
      if (e.target === this.coinshopPanel) this._closeCoinShopPanel()
    })
  }

  // Graphics tab (Settings > Graphics, beside Controls) - Rendering/
  // Effects/Damage Indicator/Damage Numbers sections. Every control here
  // is a real, working setting (not placeholder UI) - see each one's own
  // comment for what it actually wires into.
  _bindGraphicsSettings() {
    if (this.gfxResolutionSlider) {
      this.gfxResolutionSlider.value = this.settings.renderResolution
      this.gfxResolutionValue.textContent = `${this.settings.renderResolution}%`
      this.gfxResolutionSlider.addEventListener('input', () => {
        const value = Number(this.gfxResolutionSlider.value)
        this.gfxResolutionValue.textContent = `${value}%`
        this.settings.renderResolution = value
        this._userResScale = value / 100
        this._applyRenderScale()
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.gfxResolutionValue, this.gfxResolutionSlider)
    }
    // Brightness/Contrast - a CSS filter on the actual <canvas> element
    // (not the DOM-wide #app filter "High Contrast Mode" already uses in
    // the Controls tab - that's a separate accessibility toggle, this is
    // a continuous rendering-level control, the two compound rather than
    // conflict). Applied via _applyGraphicsFilters so both sliders share
    // one filter string instead of overwriting each other.
    if (this.gfxBrightnessSlider) {
      this.gfxBrightnessSlider.value = this.settings.brightness
      this.gfxBrightnessValue.textContent = `${this.settings.brightness}%`
      this.gfxBrightnessSlider.addEventListener('input', () => {
        const value = Number(this.gfxBrightnessSlider.value)
        this.gfxBrightnessValue.textContent = `${value}%`
        this.settings.brightness = value
        this._applyGraphicsFilters()
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.gfxBrightnessValue, this.gfxBrightnessSlider)
    }
    if (this.gfxContrastSlider) {
      this.gfxContrastSlider.value = this.settings.contrast
      this.gfxContrastValue.textContent = `${this.settings.contrast}%`
      this.gfxContrastSlider.addEventListener('input', () => {
        const value = Number(this.gfxContrastSlider.value)
        this.gfxContrastValue.textContent = `${value}%`
        this.settings.contrast = value
        this._applyGraphicsFilters()
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.gfxContrastValue, this.gfxContrastSlider)
    }
    this._applyGraphicsFilters()

    // Ambient Occlusion - real SSAOPass in the composer chain (see
    // constructor), off by default since it's genuine added GPU cost.
    // kernelRadius scales the effect's reach/strength; 0 keeps the pass
    // fully disabled rather than just invisible-but-still-costing-a-frame.
    if (this.gfxAoSlider) {
      const applyAo = (value) => {
        if (value <= 0) {
          this.ssaoPass.enabled = false
          this.gfxAoValue.textContent = 'Off'
        } else {
          this.ssaoPass.enabled = true
          this.ssaoPass.kernelRadius = 2 + (value / 100) * 18
          this.gfxAoValue.textContent = `${value}%`
        }
      }
      this.gfxAoSlider.value = this.settings.aoIntensity
      applyAo(this.settings.aoIntensity)
      this.gfxAoSlider.addEventListener('input', () => {
        const value = Number(this.gfxAoSlider.value)
        this.settings.aoIntensity = value
        applyAo(value)
        saveSettings(this.settings)
      })
    }

    // Shadows - ORs with Performance Mode/LOW_QUALITY_MODE the same way
    // _applyPerformanceMode already does (both of those force shadows off
    // regardless of this toggle - see _resolveShadowsEnabled), so this
    // and the existing "FPS Optimized" checkbox can't silently fight.
    if (this.gfxShadowsToggle) {
      this.gfxShadowsToggle.checked = this.settings.shadowsEnabled
      this.gfxShadowsToggle.addEventListener('change', () => {
        this.settings.shadowsEnabled = this.gfxShadowsToggle.checked
        this.renderer.shadowMap.enabled = this._resolveShadowsEnabled()
        saveSettings(this.settings)
      })
    }
    if (this.gfxShadowQualitySelect) {
      this.gfxShadowQualitySelect.value = this.settings.shadowQuality
      this.gfxShadowQualitySelect.addEventListener('change', () => {
        this.settings.shadowQuality = this.gfxShadowQualitySelect.value
        this._applyShadowQuality()
        saveSettings(this.settings)
      })
      this._applyShadowQuality()
    }

    // Bullet Holes / Blood Animation - gate the existing DecalManager
    // (see Decals.js) rather than building a second decal system; no
    // prior toggle existed for either, both were previously always-on.
    if (this.gfxBulletHolesToggle) {
      this.gfxBulletHolesToggle.checked = this.settings.bulletHolesEnabled
      this.gfxBulletHolesToggle.addEventListener('change', () => {
        this.settings.bulletHolesEnabled = this.gfxBulletHolesToggle.checked
        saveSettings(this.settings)
      })
    }
    if (this.gfxBloodToggle) {
      this.gfxBloodToggle.checked = this.settings.bloodEffectsEnabled
      this.gfxBloodToggle.addEventListener('change', () => {
        this.settings.bloodEffectsEnabled = this.gfxBloodToggle.checked
        saveSettings(this.settings)
      })
    }

    // Damage Indicator - a brand-new system (see _showDamageIndicator),
    // this just gates whether it's allowed to show at all.
    if (this.gfxDamageIndicatorToggle) {
      this.gfxDamageIndicatorToggle.checked = this.settings.damageIndicatorEnabled
      this.gfxDamageIndicatorToggle.addEventListener('change', () => {
        this.settings.damageIndicatorEnabled = this.gfxDamageIndicatorToggle.checked
        saveSettings(this.settings)
      })
    }

    // Damage Numbers - independent from the existing "Show Hit Feedback"
    // checkbox (which already gates damage numbers + the hitmarker
    // together, see _spawnDamageNumber) - this ANDs with it rather than
    // replacing it, so that existing combined toggle's behavior is
    // unchanged for anyone who never opens this new tab.
    if (this.gfxDamageNumbersToggle) {
      this.gfxDamageNumbersToggle.checked = this.settings.damageNumbersEnabled
      this.gfxDamageNumbersToggle.addEventListener('change', () => {
        this.settings.damageNumbersEnabled = this.gfxDamageNumbersToggle.checked
        saveSettings(this.settings)
      })
    }
    if (this.gfxDamageNumbersScaleSlider) {
      this.gfxDamageNumbersScaleSlider.value = this.settings.damageNumbersScale
      this.gfxDamageNumbersScaleValue.textContent = `${this.settings.damageNumbersScale}%`
      document.documentElement.style.setProperty('--damage-number-scale', this.settings.damageNumbersScale / 100)
      this.gfxDamageNumbersScaleSlider.addEventListener('input', () => {
        const value = Number(this.gfxDamageNumbersScaleSlider.value)
        this.gfxDamageNumbersScaleValue.textContent = `${value}%`
        this.settings.damageNumbersScale = value
        document.documentElement.style.setProperty('--damage-number-scale', value / 100)
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.gfxDamageNumbersScaleValue, this.gfxDamageNumbersScaleSlider)
    }

    // Film Grain - regenerates the shared --grain-texture SVG data URI with
    // a scaled alpha (0.1 is the original always-on strength) and sets it
    // on :root, rather than adding a per-usage opacity wrapper around each
    // of the 4 places --grain-texture is layered into a background-image
    // list - inline style on :root already beats the stylesheet's own
    // --grain-texture declaration, so every usage picks it up for free.
    if (this.gfxGrainSlider) {
      this.gfxGrainSlider.value = this.settings.grainIntensity
      this.gfxGrainValue.textContent = `${this.settings.grainIntensity}%`
      this._applyGrainIntensity()
      this.gfxGrainSlider.addEventListener('input', () => {
        const value = Number(this.gfxGrainSlider.value)
        this.gfxGrainValue.textContent = `${value}%`
        this.settings.grainIntensity = value
        this._applyGrainIntensity()
        saveSettings(this.settings)
      })
      this._bindEditableSliderValue(this.gfxGrainValue, this.gfxGrainSlider)
    }

    // Menu Panel Flicker - the panelFlicker animation on .menu-panel/
    // .menu-card has no toggle of its own (only prefers-reduced-motion
    // covers it, see the media query this same batch also extended to
    // include it); this lets it be turned off regardless of OS setting.
    if (this.gfxPanelFlickerToggle) {
      this.gfxPanelFlickerToggle.checked = this.settings.panelFlickerEnabled
      document.documentElement.classList.toggle('no-panel-flicker', !this.settings.panelFlickerEnabled)
      this.gfxPanelFlickerToggle.addEventListener('change', () => {
        this.settings.panelFlickerEnabled = this.gfxPanelFlickerToggle.checked
        document.documentElement.classList.toggle('no-panel-flicker', !this.settings.panelFlickerEnabled)
        saveSettings(this.settings)
      })
    }

    if (this.resetGraphicsDefaultsBtn) {
      this.resetGraphicsDefaultsBtn.addEventListener('click', () => this._resetGraphicsDefaults())
    }
  }

  _applyGrainIntensity() {
    const alpha = ((this.settings.grainIntensity ?? 100) / 100) * 0.1
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
    document.documentElement.style.setProperty('--grain-texture', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
  }

  // Scoped to just the sliders/toggles this batch's Graphics tab actually
  // owns (not nickname/audio/controls) - reload is the same low-risk
  // pattern _restoreDefaultSettings already uses, simpler and more
  // reliable than re-applying every live graphics effect by hand.
  _resetGraphicsDefaults() {
    const defaults = defaultSettings()
    const graphicsKeys = ['renderResolution', 'brightness', 'contrast', 'aoIntensity', 'shadowsEnabled', 'shadowQuality', 'bulletHolesEnabled', 'bloodEffectsEnabled', 'damageIndicatorEnabled', 'damageNumbersEnabled', 'damageNumbersScale', 'grainIntensity', 'panelFlickerEnabled']
    for (const key of graphicsKeys) this.settings[key] = defaults[key]
    saveSettings(this.settings)
    window.location.reload()
  }

  _applyGraphicsFilters() {
    if (!this.canvas) return
    this.canvas.style.filter = `brightness(${this.settings.brightness}%) contrast(${this.settings.contrast}%)`
  }

  // Shadows are forced off by Performance Mode/LOW_QUALITY_MODE regardless
  // of the Graphics tab's own toggle (same precedent as bloom/render-scale
  // in _applyPerformanceMode) - this is the single source of truth both
  // that method and the Graphics toggle's own change handler call into,
  // so they can't disagree.
  // Deliberately does NOT also check !LOW_QUALITY_MODE (unlike bloom/AA/
  // materials, which stay hardcoded off under it) - LOW_QUALITY_MODE is
  // true in this build (see QualitySettings.js), and shadowsEnabled's own
  // default is false to match its previous always-off behavior, so
  // out-of-box nothing changes for anyone who never opens the Graphics
  // tab. But a real user-facing "Shadows" checkbox that can never
  // actually turn shadows on is inert UI, not a real setting - so an
  // explicit opt-in here is allowed to win, same as it would with
  // LOW_QUALITY_MODE off. Performance Mode still forces shadows off
  // regardless, same precedent as before.
  _resolveShadowsEnabled() {
    return this.settings.shadowsEnabled && !this.settings.performanceMode
  }

  _applyShadowQuality() {
    const sizes = { low: 512, medium: 1024, high: 2048 }
    const size = sizes[this.settings.shadowQuality] || 1024
    if (this.sunLight && this.sunLight.shadow) {
      this.sunLight.shadow.mapSize.set(size, size)
      // mapSize only takes effect once the shadow map's own render target
      // is (re)built - forcing that via needsUpdate rather than waiting
      // for some other unrelated shadow-camera change to trigger it.
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose()
        this.sunLight.shadow.map = null
      }
      this.sunLight.shadow.needsUpdate = true
    }
  }

  // Homepage Nav Order (Controls tab) - up/down reordering of an id list,
  // applied purely via CSS `order` on the real buttons (#menu-nav-buttons
  // is already flex-column, see style.css) rather than touching the DOM
  // structure, so every button's own click listener/id/state is untouched.
  _renderNavOrderList() {
    if (!this.navOrderList) return
    const labels = { 'coinshop-btn': t('navOrderShop'), 'upgrades-btn': t('navOrderUpgrades'), 'quests-btn': t('navOrderQuests'), 'achievements-btn': t('navOrderAchievements'), 'credits-btn': t('navOrderCredits') }
    this.navOrderList.innerHTML = this.settings.navOrder.map((id, i) => `
      <div class="nav-order-row" data-id="${id}">
        <span>${labels[id] || id}</span>
        <button class="mini-action-btn nav-order-up" type="button" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="mini-action-btn nav-order-down" type="button" ${i === this.settings.navOrder.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    `).join('')
    for (const row of this.navOrderList.querySelectorAll('.nav-order-row')) {
      const id = row.dataset.id
      row.querySelector('.nav-order-up').addEventListener('click', () => this._moveNavOrder(id, -1))
      row.querySelector('.nav-order-down').addEventListener('click', () => this._moveNavOrder(id, 1))
    }
  }

  _moveNavOrder(id, delta) {
    const i = this.settings.navOrder.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= this.settings.navOrder.length) return
    ;[this.settings.navOrder[i], this.settings.navOrder[j]] = [this.settings.navOrder[j], this.settings.navOrder[i]]
    saveSettings(this.settings)
    this._renderNavOrderList()
    this._applyNavOrder()
  }

  _applyNavOrder() {
    this.settings.navOrder.forEach((id, i) => {
      const btn = document.getElementById(id)
      if (btn) btn.style.order = i
    })
  }

  // Settings Search - filters .audio-row rows within whichever tab is
  // currently active by their <label> text (case-insensitive substring),
  // same filter-by-visible-text approach the Achievements/Bestiary filter
  // boxes already use. Doesn't cross tabs - a match on a different tab's
  // setting stays hidden until that tab is opened, same as this panel's
  // existing tab-based organization.
  _bindSettingsSearch() {
    if (!this.settingsSearchInput) return
    this.settingsSearchInput.addEventListener('click', (e) => e.stopPropagation())
    this.settingsSearchInput.addEventListener('input', () => {
      const filter = this.settingsSearchInput.value.trim().toLowerCase()
      const activePage = document.querySelector('.settings-page:not([style*="display: none"])')
      if (!activePage) return
      for (const row of activePage.querySelectorAll('.audio-row')) {
        const label = row.querySelector('label')?.textContent.toLowerCase() || ''
        const matches = !filter || label.includes(filter)
        row.style.display = matches ? '' : 'none'
        // A <details> (see the Advanced disclosure in Personalization)
        // hides its content via the UA's own collapsed state, ignoring a
        // child's own `display` override entirely - a real filter match
        // inside one would otherwise stay invisible even though this loop
        // just un-hid it. Auto-expand on a real match; leave collapsed
        // state alone when the search is cleared rather than re-collapsing
        // it out from under someone who opened it on purpose.
        const details = row.closest('details')
        if (details && matches && filter) details.open = true
      }
    })
  }

  _bindControlsTab() {
    this._renderControlsGrid()
    this._renderNavOrderList()
    this._applyNavOrder()
    this._bindSettingsSearch()
    this.resetBindsBtn.addEventListener('click', () => {
      resetBindings()
      this._renderControlsGrid()
    })
    this.restoreDefaultsBtn.addEventListener('click', () => this._restoreDefaultSettings())
    if (this.exportKeybindsBtn) this.exportKeybindsBtn.addEventListener('click', () => this._exportKeybindsCode())
    if (this.importKeybindsBtn) {
      this.importKeybindsBtn.addEventListener('click', () => {
        this.importKeybindsInput.style.display = 'inline-block'
        this.importKeybindsApplyBtn.style.display = 'inline-block'
        this.importKeybindsInput.focus()
      })
    }
    if (this.importKeybindsApplyBtn) {
      this.importKeybindsApplyBtn.addEventListener('click', () => this._importKeybindsCode(this.importKeybindsInput.value))
    }
    // Per-tab resets (Audio/Controls) - same scoped-reset-then-reload
    // pattern _resetGraphicsDefaults already established for the Graphics
    // tab, just a different key whitelist per tab.
    if (this.resetAudioDefaultsBtn) {
      this.resetAudioDefaultsBtn.addEventListener('click', () => {
        const defaults = defaultSettings()
        for (const key of ['musicVolume', 'sfxVolume']) this.settings[key] = defaults[key]
        saveSettings(this.settings)
        window.location.reload()
      })
    }
    if (this.resetControlsDefaultsBtn) {
      this.resetControlsDefaultsBtn.addEventListener('click', () => {
        const defaults = defaultSettings()
        const keys = ['sensitivity', 'invertY', 'fov', 'hudScale', 'hudOpacity', 'colorblind', 'shakeIntensity', 'reduceFlashing',
          'toggleSprint', 'toggleCrouch', 'toggleAds', 'aimAssist', 'bigInteractPrompt', 'toastDuration', 'crosshairColor', 'crosshairSize',
          'largeTextMode', 'highContrastMode', 'dyslexiaFont', 'bgMood', 'keybindCheatSheet', 'showHitFeedback', 'performanceMode',
          'streamSafeMode', 'focusRingMode', 'homepageFpsCounter', 'underlineLinks', 'nicknameFont', 'layoutDensity']
        for (const key of keys) this.settings[key] = defaults[key]
        saveSettings(this.settings)
        window.location.reload()
      })
    }
    this._updateStorageUsageLine()
    this.exportSaveBtn.addEventListener('click', () => this._exportSave())
    this.importSaveBtn.addEventListener('click', () => this.importSaveInput.click())
    this.importSaveInput.addEventListener('change', () => this._importSaveFile(this.importSaveInput.files[0]))
    this.compareSaveBtn.addEventListener('click', () => this.compareSaveInput.click())
    this.compareSaveInput.addEventListener('change', () => this._compareSaveFile(this.compareSaveInput.files[0]))
    if (this.copySaveBtn) this.copySaveBtn.addEventListener('click', () => this._copySaveToClipboard())
    if (this.exportSettingsCodeBtn) this.exportSettingsCodeBtn.addEventListener('click', () => this._exportSettingsCode())
    if (this.importSettingsCodeBtn) {
      this.importSettingsCodeBtn.addEventListener('click', () => {
        this.importSettingsCodeInput.style.display = 'inline-block'
        this.importSettingsCodeApplyBtn.style.display = 'inline-block'
        this.importSettingsCodeInput.focus()
      })
    }
    if (this.importSettingsCodeApplyBtn) {
      this.importSettingsCodeApplyBtn.addEventListener('click', () => this._importSettingsCode(this.importSettingsCodeInput.value))
    }
    this.clearLeaderboardsBtn.addEventListener('click', () => this._clearLeaderboardsOnly())
    this.resetProgressBtn.addEventListener('click', () => this._handleResetProgressClick())
  }

  // Restore Default Settings - a full reload after saving the defaults, so
  // every scattered per-slider/per-checkbox UI-sync call (there's no single
  // "apply all settings to the DOM" function to call instead) re-runs
  // correctly from a clean construction, same reload-to-resync precedent
  // Hardcore Mode's respawn already uses.
  _restoreDefaultSettings() {
    saveSettings(defaultSettings())
    window.location.reload()
  }

  // Reset All Progress - the single most destructive action in the
  // settings panel, so it's deliberately two clicks: the first arms it and
  // shows a plain warning, the second (within RESET_PROGRESS_CONFIRM_MS)
  // actually wipes. Letting the window lapse silently disarms rather than
  // wiping on a stray click. localStorage.clear() rather than enumerating
  // every individual key this game has accumulated (bestStats, achievements,
  // nemesis, dailyLeaderboard...) since this page uses localStorage for
  // nothing else.
  _handleResetProgressClick() {
    if (!this._resetProgressArmed) {
      this._resetProgressArmed = true
      this.resetProgressBtn.textContent = t('resetProgressConfirm')
      setTimeout(() => {
        this._resetProgressArmed = false
        this.resetProgressBtn.textContent = t('resetProgressLabel')
      }, RESET_PROGRESS_CONFIRM_MS)
      return
    }
    localStorage.clear()
    window.location.reload()
  }

  // Local Sharing batch - Save Export/Import/Compare, all built on the
  // exact same "this page uses localStorage for nothing else" fact
  // _handleResetProgressClick's own comment already documents - a full
  // backup is just every key/value pair, no need to enumerate every
  // individual system's own storage key.
  _exportSave() {
    const data = this._snapshotLocalSave()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const link = document.createElement('a')
    link.download = `gayz-save-${Date.now()}.json`
    link.href = URL.createObjectURL(blob)
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    this._showLoreToast(t('saveExported'))
  }

  // Same snapshot _exportSave() downloads as a file, copied to the
  // clipboard as text instead - a one-click backup for anyone who'd
  // rather paste it somewhere (notes app, chat-to-self) than manage a
  // downloaded .json file.
  _copySaveToClipboard() {
    const data = JSON.stringify(this._snapshotLocalSave())
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(data)
      .then(() => this._showLoreToast(t('saveCopiedToClipboard')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  // Shareable Settings Code - just the whitelisted preference fields (see
  // SETTINGS_CODE_KEYS), base64-encoded. Distinct from Export Save (full
  // fidelity, includes progress/identity, downloads a file) - this is
  // meant to be pasted into a chat message.
  _exportSettingsCode() {
    const payload = {}
    for (const key of SETTINGS_CODE_KEYS) payload[key] = this.settings[key]
    const code = btoa(JSON.stringify(payload))
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(code)
      .then(() => this._showLoreToast(t('settingsCodeCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  _importSettingsCode(code) {
    let payload
    try {
      payload = JSON.parse(atob(code.trim()))
    } catch {
      this._showLoreToast(t('settingsCodeInvalid'))
      return
    }
    for (const key of SETTINGS_CODE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) this.settings[key] = payload[key]
    }
    saveSettings(this.settings)
    window.location.reload()
  }

  // Export/Import Keybinds Code - just the rebindable action->key map
  // (see Keybinds.js's getAllBindings/setAllBindings), separate from the
  // wider Settings Code above (which deliberately excludes keybinds
  // entirely - two different things to share independently).
  _exportKeybindsCode() {
    const code = btoa(JSON.stringify(getAllBindings()))
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(code)
      .then(() => this._showLoreToast(t('keybindsCodeCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  _importKeybindsCode(code) {
    let payload
    try {
      payload = JSON.parse(atob(code.trim()))
    } catch {
      this._showLoreToast(t('keybindsCodeInvalid'))
      return
    }
    setAllBindings(payload)
    this._renderControlsGrid()
    this._showLoreToast(t('keybindsCodeApplied'))
  }

  // Overwrites every current key - same "irreversible, needs a real
  // confirm dialog" bar as Prestige/Respec, plus a full reload afterward
  // (same reasoning _handleResetProgressClick's own comment gives for
  // Reset Progress - every system reads its state fresh from localStorage
  // at construction, not via some live-refresh path). Shared with the
  // Cloud Save "Use Cloud Save" flow below (see _resolveCloudConflict) -
  // one path for "replace all local data with this parsed blob and
  // reload", regardless of whether the blob came from an uploaded file or
  // Google Drive.
  _applyImportedSaveData(data) {
    localStorage.clear()
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value)
    window.location.reload()
  }

  async _importSaveFile(file) {
    if (!file) return
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      this._showLoreToast(t('saveFileInvalid'))
      return
    }
    if (!window.confirm(t('saveImportConfirm'))) return
    this._applyImportedSaveData(data)
  }

  // Same {key: stringValue} snapshot _exportSave() downloads as a file,
  // just returned in-memory for Cloud Save's push instead - one source of
  // truth for "what does a save blob contain."
  _snapshotLocalSave() {
    const data = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      data[key] = localStorage.getItem(key)
    }
    return data
  }

  // Cloud Save panel open/close - a normal modal, same shared z-index/
  // display:flex rule every other panel uses.
  // Online Features - global leaderboard, weekly-challenge ranking, friend
  // comparison, global kill counter, community poll. All read-only fetches
  // here (writes happen once per run in _pushOnlineStats, not on every
  // panel open) - best-effort, a failed fetch just leaves that section
  // showing its previous/empty state rather than blocking the rest of the
  // panel.
  async _renderCloudOnlineSection() {
    if (!this.cloudsaveOnlineSection || !CloudSync.isConfigured()) return
    this._renderGlobalKills()
    this._renderMyRank()
    this._renderRival()
    this._renderNearbyRank()
    this._renderGlobalAverages()
    this._subscribeLeaderboard()
    this._renderAchievementsLeaderboard()
    this._renderWeeklyLeaderboardList()
    this._renderPoll()
    this._renderSavedFriends()
    if (this.cloudsaveFriendCompareBtn) this.cloudsaveFriendCompareBtn.textContent = t('cloudsaveFriendCompareBtn')
    if (this.cloudsaveFriendInput) this.cloudsaveFriendInput.placeholder = t('cloudsaveFriendPlaceholder')
    if (this.cloudsaveLeaderboardTitle) this.cloudsaveLeaderboardTitle.textContent = t('cloudsaveLeaderboardTitle')
    if (this.cloudsaveAchievementsLeaderboardTitle) this.cloudsaveAchievementsLeaderboardTitle.textContent = t('cloudsaveAchievementsLeaderboardTitle')
    if (this.cloudsaveFriendTitle) this.cloudsaveFriendTitle.textContent = t('cloudsaveFriendTitle')
    if (this.cloudsaveRegionSelect) this.cloudsaveRegionSelect.value = this.settings.region
  }

  // Global rank badge - also mirrored onto the homepage player tag (see
  // _updateBestStatsDisplay) once fetched, so signing in and opening this
  // panel is what refreshes that homepage line rather than a live
  // subscription (a rank that's a few minutes stale is fine for this).
  async _renderMyRank() {
    if (!this.cloudsaveRankLine) return
    try {
      this._cloudGlobalRank = await CloudSync.fetchMyGlobalRank(_safeStatNumber(this.bestStats.bestNight))
      this.cloudsaveRankLine.textContent = t('cloudsaveRankLine', { rank: this._cloudGlobalRank })
      if (this.menuPlayerTag) this._renderPlayerTag()
    } catch {
      this.cloudsaveRankLine.textContent = ''
    }
  }

  async _renderRival() {
    if (!this.cloudsaveRivalLine) return
    try {
      const rival = await CloudSync.fetchNearestRivalAbove(_safeStatNumber(this.bestStats.bestNight))
      if (!rival) {
        this.cloudsaveRivalLine.textContent = t('cloudsaveRivalNone')
        return
      }
      const gap = _safeStatNumber(rival.bestNight) - _safeStatNumber(this.bestStats.bestNight)
      this.cloudsaveRivalLine.textContent = t('cloudsaveRivalLine', { n: gap, name: rival.name || '???' })
      // Urgent variant - a toast (not just the panel text above) when the
      // gap is genuinely small, once per session per rival name so it
      // doesn't refire every time the Cloud Save panel happens to open.
      if (gap <= 2 && this._urgentRivalToastedFor !== rival.name) {
        this._urgentRivalToastedFor = rival.name
        this._showHomepageToast(t('urgentRivalToast', { name: rival.name || '???', n: gap }))
      }
    } catch {
      this.cloudsaveRivalLine.textContent = ''
    }
  }

  // Nearby Rank mini-leaderboard - 3 entries above you, 3 below (see
  // CloudSync.fetchNearbyRank), reversing "above" so the combined list
  // reads highest-to-lowest, same order as the main leaderboard.
  async _renderNearbyRank() {
    if (!this.cloudsaveNearbyRankList) return
    if (this.cloudsaveNearbyRankTitle) this.cloudsaveNearbyRankTitle.textContent = t('cloudsaveNearbyRankTitle')
    try {
      const { above, below } = await CloudSync.fetchNearbyRank(_safeStatNumber(this.bestStats.bestNight), 3)
      const mine = { name: this.settings.nickname || t('menuPlayerTagDefault'), bestNight: this.bestStats.bestNight, bestKills: this.careerStats.totalKills, __me: true }
      const combined = [...above.reverse(), mine, ...below]
      this.cloudsaveNearbyRankList.innerHTML = combined.map((r) => `
        <div class="cloud-leaderboard-row${r.__me ? ' me' : ''}"><span>${_escapeHtml(r.name || '???')}</span><span>${t('cloudsaveLeaderboardRow', { night: _safeStatNumber(r.bestNight), kills: _safeStatNumber(r.bestKills) })}</span></div>
      `).join('')
    } catch {
      this.cloudsaveNearbyRankList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
    }
  }

  // Random Top Player compare - picks randomly among whatever the main
  // leaderboard list already has rendered (its own top 10, see
  // _subscribeLeaderboard), not a separate "truly random among every
  // player ever" query - Firestore has no native random-row primitive,
  // and downloading the whole collection client-side to pick one is the
  // exact "download-and-sort" pattern this codebase's aggregate queries
  // deliberately avoid elsewhere.
  _compareVsRandomOpponent() {
    const rows = Array.from(this.cloudsaveLeaderboardList?.querySelectorAll('.cloud-leaderboard-row') || [])
      .filter((el) => !el.classList.contains('me'))
    if (!rows.length) {
      this.cloudsaveFriendResult.textContent = t('cloudsaveFriendNotFound')
      return
    }
    const row = rows[Math.floor(Math.random() * rows.length)]
    const name = row.querySelector('span')?.textContent.replace(/^(1st|2nd|3rd|\d+\.)\s*/, '') || ''
    if (this.cloudsaveFriendInput) this.cloudsaveFriendInput.value = name
    this._handleFriendCompare()
  }

  _renderSavedFriends() {
    if (!this.cloudsaveSavedFriends) return
    this.cloudsaveSavedFriends.innerHTML = this.settings.savedFriends.map((name) => `
      <span class="saved-friend-chip" data-name="${_escapeHtml(name)}">${_escapeHtml(name)}<span class="saved-friend-remove" data-remove="${_escapeHtml(name)}">×</span></span>
    `).join('')
    for (const chip of this.cloudsaveSavedFriends.querySelectorAll('.saved-friend-chip')) {
      chip.addEventListener('click', (e) => {
        const removeName = e.target.dataset.remove
        if (removeName) {
          this.settings.savedFriends = this.settings.savedFriends.filter((n) => n !== removeName)
          saveSettings(this.settings)
          this._renderSavedFriends()
          return
        }
        this.cloudsaveFriendInput.value = chip.dataset.name
        this._handleFriendCompare()
      })
    }
  }

  _saveFriend() {
    const name = this.cloudsaveFriendInput.value.trim()
    if (!name || this.settings.savedFriends.includes(name)) return
    if (this.settings.savedFriends.length >= 5) this.settings.savedFriends.shift()
    this.settings.savedFriends.push(name)
    saveSettings(this.settings)
    this._renderSavedFriends()
  }

  async _renderGlobalKills() {
    if (!this.cloudsaveGlobalKills) return
    try {
      const total = await CloudSync.fetchGlobalKills()
      this.cloudsaveGlobalKills.textContent = total === null ? '' : t('cloudsaveGlobalKillsLine', { n: total.toLocaleString() })
    } catch {
      this.cloudsaveGlobalKills.textContent = ''
    }
  }

  _renderLeaderboardRows(rows) {
    if (!this.cloudsaveLeaderboardList) return
    // Podium styling (ranks 1-3) - PODIUM_MEDALS below, same treatment
    // _renderWeeklyLeaderboardList uses.
    this.cloudsaveLeaderboardList.innerHTML = rows.length
      ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === this.settings.nickname ? ' me' : ''}${i < 3 ? ` podium-${i + 1}` : ''}"><span>${PODIUM_MEDALS[i] || `${i + 1}.`} ${_escapeHtml(r.name || '???')}</span><span>${t('cloudsaveLeaderboardRow', { night: _safeStatNumber(r.bestNight), kills: _safeStatNumber(r.bestKills) })}</span></div>`).join('')
      : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
  }

  // Live-subscribed (see CloudSync.subscribeTopLeaderboard) rather than a
  // one-shot fetch - only while this panel is actually open (subscribed
  // here, unsubscribed in _closeCloudSavePanel/_handleCloudSignOut) so
  // the read cost stays bounded to "panel is visible," not indefinite.
  // Re-subscribes with the new filter whenever the region select changes.
  _subscribeLeaderboard() {
    if (!this.cloudsaveLeaderboardList) return
    if (this._leaderboardUnsubscribe) this._leaderboardUnsubscribe()
    this.cloudsaveLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveConnecting')}</p>`
    this._leaderboardUnsubscribe = CloudSync.subscribeTopLeaderboard(10, this.settings.region, (rows) => this._renderLeaderboardRows(rows))
  }

  async _renderAchievementsLeaderboard() {
    if (!this.cloudsaveAchievementsLeaderboardList) return
    try {
      const rows = await CloudSync.fetchTopByAchievements(10)
      this.cloudsaveAchievementsLeaderboardList.innerHTML = rows.length
        ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === this.settings.nickname ? ' me' : ''}"><span>${i + 1}. ${_escapeHtml(r.name || '???')}</span><span>${_safeStatNumber(r.achievementCount)}/${ACHIEVEMENTS.length}</span></div>`).join('')
        : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
    } catch {
      this.cloudsaveAchievementsLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
    }
  }

  async _renderGlobalAverages() {
    if (!this.cloudsaveAvgLine) return
    try {
      const { avgKills, avgNight } = await CloudSync.fetchGlobalAverages()
      const myKills = _safeStatNumber(this.careerStats.totalKills)
      const myNight = _safeStatNumber(this.bestStats.bestNight)
      this.cloudsaveAvgLine.textContent = t('cloudsaveAvgLine', {
        myKills, avgKills: Math.round(avgKills), myNight, avgNight: avgNight.toFixed(1),
      })
      // Bar-chart visual (see #cloudsave-avg-bars) - same numbers the text
      // line above already computed, just also drawn as two you-vs-average
      // bars scaled to whichever side of each pair is larger.
      if (this.cloudsaveAvgBars) {
        const killsMax = Math.max(myKills, avgKills, 1)
        const nightMax = Math.max(myNight, avgNight, 1)
        this.cloudsaveAvgBars.innerHTML = `
          <div class="avg-bar-row"><span class="avg-bar-label">${t('avgBarYou')}</span><div class="mini-progress-track"><div class="mini-progress-fill" style="width: ${(myKills / killsMax) * 100}%"></div></div><span class="avg-bar-value">${myKills.toLocaleString()}</span></div>
          <div class="avg-bar-row"><span class="avg-bar-label">${t('avgBarAverage')}</span><div class="mini-progress-track"><div class="mini-progress-fill" style="width: ${(avgKills / killsMax) * 100}%"></div></div><span class="avg-bar-value">${Math.round(avgKills).toLocaleString()}</span></div>
        `
      }
    } catch {
      this.cloudsaveAvgLine.textContent = ''
      if (this.cloudsaveAvgBars) this.cloudsaveAvgBars.innerHTML = ''
    }
  }

  // "Most Improved This Week" is just a badge on the #1 entry here, not a
  // separate tracked metric - this week's weekly-challenge progress
  // already represents "how much you've contributed this week," so the
  // top entry IS the most-improved player by that same measure.
  async _renderWeeklyLeaderboardList() {
    if (!this.cloudsaveWeeklyLeaderboardList) return
    if (this.cloudsaveWeeklyLeaderboardTitle) this.cloudsaveWeeklyLeaderboardTitle.textContent = t('cloudsaveWeeklyLeaderboardTitle')
    try {
      const weekStr = _thisWeekStr()
      const rows = await CloudSync.fetchTopWeeklyLeaderboard(weekStr, 10)
      this.cloudsaveWeeklyLeaderboardList.innerHTML = rows.length
        ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === this.settings.nickname ? ' me' : ''}${i < 3 ? ` podium-${i + 1}` : ''}"><span>${PODIUM_MEDALS[i] || `${i + 1}.`} ${_escapeHtml(r.name || '???')}${i === 0 ? ` ${t('mostImprovedBadge')}` : ''}</span><span>${_safeStatNumber(r.progress)}</span></div>`).join('')
        : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
    } catch {
      this.cloudsaveWeeklyLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
    }
  }

  async _handleFriendCompare() {
    if (!this.cloudsaveFriendInput || !this.cloudsaveFriendResult) return
    const name = this.cloudsaveFriendInput.value.trim()
    if (!name) return
    this.cloudsaveFriendResult.textContent = t('cloudsaveConnecting')
    try {
      const entry = await CloudSync.fetchLeaderboardEntryByName(name)
      if (!entry) {
        this.cloudsaveFriendResult.textContent = t('cloudsaveFriendNotFound')
        return
      }
      // Last played - reuses the same updatedAt field every leaderboard
      // push already writes (see pushLeaderboardEntry), not a new
      // presence/timestamp system.
      const lastPlayed = entry.updatedAt ? _formatRelativeTime(Math.max(0, Date.now() - Number(entry.updatedAt))) : null
      this.cloudsaveFriendResult.textContent = t('cloudsaveFriendResult', {
        name: entry.name || name,
        myNight: _safeStatNumber(this.bestStats.bestNight),
        myKills: _safeStatNumber(this.careerStats.totalKills),
        theirNight: _safeStatNumber(entry.bestNight),
        theirKills: _safeStatNumber(entry.bestKills),
      }) + (lastPlayed ? ` ${t('cloudsaveFriendLastPlayed', { time: lastPlayed })}` : '')
    } catch {
      this.cloudsaveFriendResult.textContent = t('cloudsaveError')
    }
  }

  // Community Poll - renders each option as a bar showing its live vote
  // share; once this account has voted (existing vote checked on render),
  // every option becomes non-interactive so a vote can't be changed
  // (matches the create-only security rule, which would reject a second
  // vote from the server side anyway - this just avoids the round trip).
  async _renderPoll() {
    if (!this.cloudsavePollOptions || !this._cloudUid) return
    this.cloudsavePollTitle.textContent = t('pollQuestionNextFeature')
    try {
      const [myVote, counts] = await Promise.all([
        CloudSync.fetchMyPollVote(POLL_ID, this._cloudUid),
        CloudSync.fetchPollResults(POLL_ID, POLL_OPTIONS.map((o) => o.id)),
      ])
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      this.cloudsavePollOptions.innerHTML = POLL_OPTIONS.map((o) => {
        const n = counts[o.id] || 0
        const pct = total > 0 ? Math.round((n / total) * 100) : 0
        const voted = myVote === o.id
        return `<button type="button" class="poll-option-btn${voted ? ' voted' : ''}" data-option="${o.id}" style="--poll-pct: ${myVote ? pct : 0}%">
          <span class="poll-option-label">${voted ? '✓ ' : ''}${_escapeHtml(t(o.labelKey))}</span>
          <span class="poll-option-pct">${myVote ? `${pct}%` : ''}</span>
        </button>`
      }).join('')
      this.cloudsavePollHint.textContent = myVote ? t('pollVotedHint', { n: total }) : t('pollNotVotedHint')
      if (!myVote) {
        for (const btn of this.cloudsavePollOptions.querySelectorAll('.poll-option-btn')) {
          btn.addEventListener('click', () => this._castVote(btn.dataset.option))
        }
      }
    } catch {
      this.cloudsavePollOptions.innerHTML = ''
      this.cloudsavePollHint.textContent = t('cloudsaveError')
    }
  }

  async _castVote(option) {
    if (!this._cloudUid) return
    try {
      await CloudSync.castPollVote(POLL_ID, this._cloudUid, option)
      this._renderPoll()
    } catch {
      this._showLoreToast(t('cloudsaveError'))
    }
  }

  // Pushed once per completed run (see _recordRunEnd), alongside the save
  // sync - separate Firestore writes (leaderboard/weekly/global-kills) so
  // a failure in one doesn't block the others, all best-effort/silent
  // like the save push itself.
  async _pushOnlineStats() {
    if (!this._cloudUid || !CloudSync.isConfigured()) return
    const name = this.settings.nickname || t('menuPlayerTagDefault')
    const entry = {
      name,
      bestNight: _safeStatNumber(this.bestStats.bestNight),
      bestKills: _safeStatNumber(this.bestStats.bestKills),
      bestKillStreak: _safeStatNumber(this.bestStats.bestKillStreak),
      achievementCount: this.achievements.unlocked.size,
    }
    // region is omitted entirely when unset ('global' = no preference
    // picked) rather than defaulted to some region - the security rule's
    // own enum check only applies when the field is present at all.
    if (this.settings.region && this.settings.region !== 'global') entry.region = this.settings.region
    CloudSync.pushLeaderboardEntry(this._cloudUid, entry).catch(() => {})
    CloudSync.pushWeeklyLeaderboardEntry(_thisWeekStr(), this._cloudUid, {
      name,
      progress: _safeStatNumber(this.weeklyChallenge.progress),
    }).catch(() => {})
    CloudSync.incrementGlobalKills(_safeStatNumber(this.kills)).catch(() => {})
  }

  async _handleCloudSignIn() {
    if (!CloudSync.isConfigured()) {
      this._showLoreToast(t('cloudsaveNotConfigured'))
      return
    }
    if (this.cloudsaveSigninBtn) this.cloudsaveSigninBtn.textContent = t('cloudsaveConnecting')
    try {
      const { uid, profile } = await CloudSync.signIn()
      // _restoreCloudSession's onAuthChange listener will also fire from
      // this same sign-in and set _cloudProfile/_cloudUid again - setting
      // them here too just means the very next lines (fetchCloudSave)
      // don't have to wait a tick for that callback to run first.
      this._cloudProfile = profile
      this._cloudUid = uid
      CloudSaveUI.updateCloudQuickIcon(this, true)
      CloudSaveUI.renderCloudSaveState(this)
      this._renderProfileAccountRow()

      const cloud = await CloudSync.fetchCloudSave(uid)
      if (!cloud) {
        // First time signing in on any device - nothing to compare against,
        // just push this device's save up.
        await CloudSaveUI.pushToCloud(this, false)
        return
      }
      this._cloudPendingConflict = cloud.data
      CloudSaveUI.renderCloudConflict(this, cloud.data)
    } catch (err) {
      this._showLoreToast(t('cloudsaveError'))
      CloudSaveUI.renderCloudSaveState(this)
    }
  }

  // Shows a short side-by-side comparison (same safe-parse-untrusted-JSON
  // pattern _compareSaveFile already uses for an uploaded file - a Drive
  // file the player controls is no more trustworthy than one they pick
  // from disk) so the choice isn't blind.
  // Read-only - parses another save file WITHOUT writing anything, just to
  // show a side-by-side stat comparison (e.g. two family members comparing
  // progress without either one's save getting overwritten). Reads the
  // same 3 storage keys BEST_STATS_KEY/CAREER_STATS_KEY/Achievements'
  // STORAGE_KEY directly out of the parsed JSON rather than through
  // loadBestStats() etc., since those functions read from the REAL
  // localStorage, not this uploaded file.
  async _compareSaveFile(file) {
    if (!file || !this.compareSaveResult) return
    let data
    try {
      data = JSON.parse(await file.text())
    } catch {
      this._showLoreToast(t('saveFileInvalid'))
      return
    }
    const safeParse = (raw, fallback) => {
      try {
        return raw ? JSON.parse(raw) : fallback
      } catch {
        return fallback
      }
    }
    const otherBest = safeParse(data['gayz-best-stats'], {})
    const otherCareer = safeParse(data['gayz-career-stats'], {})
    const otherAch = safeParse(data['gayz-achievements'], [])
    this.compareSaveResult.style.display = 'block'
    // _safeStatNumber on every value read from the uploaded file - this
    // file is fully attacker-controlled (see its own doc comment).
    this.compareSaveResult.innerHTML = [
      t('compareSaveRow', { label: t('profileBestNight'), mine: _safeStatNumber(this.bestStats.bestNight), theirs: _safeStatNumber(otherBest.bestNight) }),
      t('compareSaveRow', { label: t('profileTotalKills'), mine: _safeStatNumber(this.careerStats.totalKills), theirs: _safeStatNumber(otherCareer.totalKills) }),
      t('compareSaveRow', { label: t('profileAchievements'), mine: _safeStatNumber(this.achievements.unlocked.size), theirs: _safeStatNumber(Array.isArray(otherAch) ? otherAch.length : 0) }),
    ].join('<br>')
  }

  _updateStorageUsageLine() {
    if (!this.storageUsageLine) return
    let totalChars = 0
    let count = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      totalChars += key.length + (localStorage.getItem(key) || '').length
      count++
    }
    this.storageUsageLine.textContent = t('storageUsageLine', { kb: (totalChars / 1024).toFixed(1), count })
    // Quota warning - most browsers cap localStorage around 5MB/origin
    // (varies, some allow more); warns approaching that rather than only
    // failing silently later (every save() in this codebase already
    // catches quota errors and just skips persisting, so a save actually
    // failing has no other visible symptom without this).
    if (this.storageQuotaWarning) {
      this.storageQuotaWarning.style.display = totalChars > 4 * 1024 * 1024 ? '' : 'none'
    }
  }

  // Narrower than Reset All Progress below - only the leaderboard-shaped
  // records, leaves achievements/mastery/meta-progress/etc untouched.
  _clearLeaderboardsOnly() {
    if (!window.confirm(t('clearLeaderboardsConfirm'))) return
    localStorage.removeItem(LEADERBOARD_KEY)
    localStorage.removeItem(BOSS_RUSH_LEADERBOARD_KEY)
    localStorage.removeItem(DAILY_LEADERBOARD_KEY)
    window.location.reload()
  }

  // Print Stats Sheet - reuses profileOptions' already-rendered innerHTML
  // (this button only exists inside the open Profile panel, so it's always
  // populated by the time this can be clicked) rather than recomputing the
  // same rows a second time. #print-stats-sheet is hidden on-screen and
  // only shown by the @media print rule in style.css.
  // Diagnostics text (Credits) - browser/GPU info for a bug report,
  // reading the same live WebGL context this.renderer already owns
  // (WEBGL_debug_renderer_info is the standard way to get the real GPU
  // name, not just "WebGL 2.0" generically) rather than opening a second
  // context just to inspect it.
  _buildDiagnosticsText() {
    let gpu = 'unknown'
    try {
      const gl = this.renderer?.getContext()
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      if (gl && ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
    } catch {
      // Best-effort - some browsers block this extension entirely.
    }
    return [
      `Session: ${this._sessionId}`,
      `Build: ${__BUILD_HASH__} (${__BUILD_DATE__})`,
      `User Agent: ${navigator.userAgent}`,
      `GPU: ${gpu}`,
      `Screen: ${window.innerWidth}x${window.innerHeight}`,
      `Language: ${navigator.language}`,
    ].join('\n')
  }

  _printProfile() {
    if (!this.printStatsSheet) return
    this.printStatsSheet.innerHTML = `<h1>${t('printSheetTitle')}</h1>${this.profileOptions.innerHTML}`
    window.print()
  }

  // Print Full Changelog - same #print-stats-sheet element/mechanism as
  // Print Stats Sheet above (hidden on-screen, shown only by the @media
  // print rule), just pointed at #changelog-list's real, already-rendered
  // entries instead of the Profile stat grid.
  _printChangelog() {
    if (!this.printStatsSheet) return
    const list = document.getElementById('changelog-list')
    this.printStatsSheet.innerHTML = `<h1>${t('printChangelogTitle')}</h1>${list ? list.innerHTML : ''}`
    window.print()
  }

  // Text Recap - a pure-text, Wordle-style shareable summary (no image),
  // distinct from the Sharing & Content Tools batch's screenshot/clipboard-
  // image tools - pastes cleanly into SMS/Discord/anywhere that doesn't
  // support image paste.
  _copyTextRecap() {
    const text = t('textRecapTemplate', { night: this.night, kills: this.kills, rank: t(careerRankTitleKey(this.careerStats.totalKills)) })
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(text)
      .then(() => this._showLoreToast(t('clipboardCopySuccess')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  // Pass-the-Controller Challenge - captures the exact config a run was
  // played under so whoever plays next (same session or a different local
  // player) can accept the identical difficulty/mutators with one click,
  // rather than needing to be told or guess the settings verbally.
  _captureChallengeHandoff() {
    saveChallengeHandoff({
      name: this.settings.nickname || t('anonymousPlayerName'),
      night: this.night,
      kills: this.kills,
      difficulty: this.settings.difficulty,
      mutators: { ...this.settings.mutators },
    })
  }

  _updateAcceptChallengeButton() {
    if (!this.acceptChallengeBtn) return
    const handoff = loadChallengeHandoff()
    if (!handoff) {
      this.acceptChallengeBtn.style.display = 'none'
      return
    }
    this.acceptChallengeBtn.style.display = ''
    this.acceptChallengeBtn.textContent = t('acceptChallengeBtn', { name: handoff.name, night: handoff.night })
  }

  // Applies via settings + a reload rather than live-patching every
  // difficulty/mutator checkbox in the menu by hand - this project's own
  // per-mutator checkboxes are each their own named field (mutatorHordeRush,
  // mutatorLootRush, ...), not a generic map, and every one of them already
  // syncs its .checked state from settings at construction time. A reload
  // gets that sync for free and correctly, instead of re-deriving it here.
  _acceptChallenge() {
    const handoff = loadChallengeHandoff()
    if (!handoff) return
    this.settings.difficulty = handoff.difficulty
    this.settings.mutators = { ...this.settings.mutators, ...handoff.mutators }
    saveSettings(this.settings)
    window.location.reload()
  }

  // Shareable Loadout Code - encodes the current 5-slot hotbar (weapon ids
  // only, same array shape as settings.hotbar/hotbarPresets) as a short
  // delimited string, no new dependency needed for something this simple.
  _copyLoadoutCode() {
    const code = this.settings.hotbar.map((id) => id || '_').join('-')
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(code)
      .then(() => this._showLoreToast(t('loadoutCodeCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  _applyLoadoutCode(code) {
    const ids = code.trim().split('-').map((s) => (s === '_' ? null : s))
    if (ids.length !== this.settings.hotbar.length) {
      this._showLoreToast(t('loadoutCodeInvalid'))
      return
    }
    const validIds = new Set(this.weapons.weapons.map((w) => w.id))
    for (const id of ids) {
      if (id !== null && !validIds.has(id)) {
        this._showLoreToast(t('loadoutCodeInvalid'))
        return
      }
    }
    this.settings.hotbar = ids
    saveSettings(this.settings)
    this._updateHotbarHud()
    this._showLoreToast(t('loadoutCodeApplied'))
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
      // Keybind collision detection - previously two actions could silently
      // share one key (only the first in the dispatch if/else-if chain
      // would ever actually fire), with no warning at rebind time.
      const collision = ACTIONS.find((a) => a.id !== action && getKeyFor(a.id) === e.code)
      if (e.code !== 'Escape' && !reserved) {
        if (collision) this._showLoreToast(t('keybindCollision', { key: keyLabel(e.code) }))
        else setBinding(action, e.code)
      }
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

  // Companion color override (see Companion.js's jacketColor option) -
  // converts the '#rrggbb' setting string to the numeric hex Companion's
  // material .setHex() expects, or null (role default) if unset.
  _companionColorHex() {
    if (!this.settings.companionColor) return null
    return parseInt(this.settings.companionColor.slice(1), 16)
  }

  _rebuildCompanion(role) {
    const pos = this.companion.group.position
    this.companion.dispose()
    this.companion = new Companion(this.scene, pos.x, pos.z, role, { jacketColor: this._companionColorHex() })
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
  // Online Features batch: a broken streak (gap > 1 day) now shows a
  // "welcome back, it's been N days" toast instead of the normal streak
  // toast - same hook, no separate tracking needed, since the gap is
  // already implicit in wasConsecutive/previousLastDate below.
  _checkLoginStreak() {
    const today = todayDateString()
    if (this.loginStreak.lastDate === today) return
    const previousLastDate = this.loginStreak.lastDate
    const wasConsecutive = previousLastDate === yesterdayDateString()
    // Streak Freeze - a gap of exactly 1 missed day (2 real days since
    // last play) spends a banked freeze to preserve the streak instead of
    // resetting to 1. A bigger gap still resets outright - a freeze
    // covers one missed day, not an open-ended vacation.
    const gapDays = previousLastDate ? Math.round((new Date(today) - new Date(previousLastDate)) / 86400000) : 0
    const usedFreeze = !wasConsecutive && gapDays === 2 && this.loginStreak.freezesAvailable > 0
    if (usedFreeze) {
      this.loginStreak.freezesAvailable -= 1
      this.loginStreak.streak += 1
    } else {
      this.loginStreak.streak = wasConsecutive ? this.loginStreak.streak + 1 : 1
    }
    if (this.loginStreak.streak % 7 === 0 && this.loginStreak.freezesAvailable < LOGIN_STREAK_MAX_FREEZES) {
      this.loginStreak.freezesAvailable += 1
    }
    // Kept distinct from lastDate (which this function itself immediately
    // overwrites to today, every page load) - Profile panel's "Last
    // Played" row needs the date BEFORE today's visit, not today's own
    // date reflected back.
    if (previousLastDate) this.loginStreak.previousDate = previousLastDate
    this.loginStreak.lastDate = today
    this.loginStreak.recentDates = [...(this.loginStreak.recentDates || []), today].slice(-7)
    saveLoginStreak(this.loginStreak)
    const bonusDays = Math.min(this.loginStreak.streak, LOGIN_STREAK_MAX_BONUS_DAYS)
    const coinBonus = bonusDays * LOGIN_STREAK_COIN_PER_DAY
    this.coins += coinBonus
    if (usedFreeze) {
      this._showLoreToast(t('loginStreakFreezeUsedToast', { n: this.loginStreak.streak, coins: coinBonus }))
    } else if (!wasConsecutive && previousLastDate) {
      const days = Math.max(1, gapDays)
      this._showLoreToast(t('welcomeBackToast', { days, coins: coinBonus }))
    } else {
      this._showLoreToast(t('loginStreakToast', { n: this.loginStreak.streak, coins: coinBonus }))
    }
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
    // Opened from the pause overlay (still on screen, unlocked) as well as
    // the homepage/HUD gear icon - hide it explicitly rather than relying
    // on DOM/paint order, same reasoning (and bug, until now missed here)
    // as _openUpgradesPanel/_openCoinShopPanel: #pause-overlay comes after
    // #settings-panel in index.html and would otherwise render on top and
    // eat every click meant for a setting underneath it.
    if (open) this.pauseOverlay.style.display = 'none'
    this.settingsOpen = open
    this.settingsPanel.style.display = open ? 'flex' : 'none'
    // Recently Changed / Undo (see _renderRecentlyChangedList/
    // _undoSettingsSession) - a snapshot taken fresh every time the panel
    // opens, so "recently changed" and "undo" both mean "since I opened
    // Settings this time," not some longer rolling history.
    if (open) {
      this._settingsOpenSnapshot = JSON.stringify(this.settings)
      this._renderRecentlyChangedList()
      CloudSync.incrementTelemetry('settingsOpened').catch(() => {})
    }
  }

  // Build Mode - a standalone block-placing sandbox (see BuildMode.js's own
  // comment), reachable from the homepage. Reuses this.menu's existing
  // hide/show pattern (same as starting a real run) rather than a new panel.
  _enterBuildMode() {
    this.menu.style.display = 'none'
    // Build Mode is only ever reachable from the homepage nav (#menu is
    // hidden the instant a real run starts, see the 'lock' handler), but
    // force this false regardless rather than trust that precondition -
    // the 'lock'/'unlock' handlers above both gate on it, and a stray
    // true here would make Build Mode's own pointer-lock cycle re-trigger
    // the entire real-run HUD on top of it.
    this.gameStarted = false
    // See PlayerController's own comment on why this exists - without it,
    // Space/Ctrl/C while flying around in Build Mode silently set real
    // jump/crouch/prone/dodge state that fires unexpectedly the moment
    // Build Mode is exited.
    this.player.suspended = true
    // _maybeShowTutorialHints' own guard only stops FUTURE hints from
    // firing once Build Mode is active - it can't stop one already
    // mid-animation at the exact moment Build Mode is entered. Hide it
    // directly here too, for that already-in-flight case.
    if (this.tutorialHintEl) this.tutorialHintEl.classList.remove('show')
    // Build Mode is a standalone sandbox with its own scene/camera, but it
    // reuses the same shared renderer/DOM as the zombie survival game (see
    // BuildMode.js's own comment) - so any real-run HUD element that was
    // left visible (health/armor, weather overlay, etc.) sits on top of it
    // with nothing to cover it, since #menu is hidden here too. Every one
    // of these is normally hidden the moment a run ends (death/extraction)
    // or pointer lock is released, but force them off here too rather than
    // trust that every path that can precede a Build Mode click already
    // did - same "don't assume a shared toast/HUD is in the state you
    // expect" lesson as the tutorial hint above.
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.hotbarEl.style.display = 'none'
    if (this.hotbarPowerScoreEl) this.hotbarPowerScoreEl.style.display = 'none'
    this.statusHud.style.display = 'none'
    this.inventoryHud.style.display = 'none'
    this.progressHud.style.display = 'none'
    this.statsPanel.style.display = 'none'
    this.minimapWrap.style.display = 'none'
    this.compassStrip.style.display = 'none'
    this.interactPrompt.style.display = 'none'
    if (this.keybindCheatsheet) this.keybindCheatsheet.style.display = 'none'
    this.infectionIndicator.style.display = 'none'
    this.damageFlash.classList.remove('low-health')
    this.criticalBloodOverlay.classList.remove('show')
    // Weather overlay isn't gated to a real run at all - _rollWeather()
    // fires once from the constructor itself, so a fresh page load can
    // already be sitting at rainOverlayEl display:block before the player
    // has ever started (or finished) a real run.
    if (this.rainOverlayEl) this.rainOverlayEl.style.display = 'none'
    if (this.snowOverlayEl) this.snowOverlayEl.style.display = 'none'
    const exitBtn = document.getElementById('build-mode-exit-btn')
    if (exitBtn) exitBtn.style.display = 'block'
    const saveBtn = document.getElementById('build-mode-save-btn')
    if (saveBtn) saveBtn.style.display = 'block'
    this.buildMode.enter()
    // requestPointerLock() genuinely fails when not triggered by a real,
    // trusted user gesture (e.g. Playwright driving this programmatically,
    // or headless Chromium in general - see this project's own documented
    // Pointer Lock gotcha) and can both throw synchronously and reject its
    // returned promise; swallow both rather than letting either surface as
    // an uncaught page error.
    try {
      this.renderer.domElement.requestPointerLock()?.catch(() => {})
    } catch {
      // Not available in this environment - Build Mode still works via
      // mouse-move events, it just won't be pointer-locked.
    }
  }

  _exitBuildMode() {
    this.buildMode.exit()
    document.exitPointerLock()
    this.player.suspended = false
    // Defensive reset, not just un-suspending - a stray real jump/fall
    // velocity firing for real the instant _tick() resumes calling
    // this.player.update() again would be a jarring launch off the
    // homepage's own spawn point.
    this.player.velocity.y = 0
    const exitBtn = document.getElementById('build-mode-exit-btn')
    if (exitBtn) exitBtn.style.display = 'none'
    const saveBtn = document.getElementById('build-mode-save-btn')
    if (saveBtn) saveBtn.style.display = 'none'
    this.menu.style.display = ''
  }

  // Diffs the live settings object against the snapshot taken when the
  // panel was opened (see _toggleSettings) - shallow key comparison, good
  // enough since nearly every settings field is a primitive; the handful
  // of object/array fields (mutators, navOrder, etc.) just compare by
  // JSON string equality, which still correctly detects "did this change."
  _renderRecentlyChangedList() {
    if (!this.recentlyChangedList || !this._settingsOpenSnapshot) return
    const before = JSON.parse(this._settingsOpenSnapshot)
    const changed = Object.keys(this.settings).filter((k) => JSON.stringify(this.settings[k]) !== JSON.stringify(before[k]))
    if (!changed.length) {
      this.recentlyChangedList.style.display = 'none'
      return
    }
    this.recentlyChangedList.style.display = ''
    this.recentlyChangedList.innerHTML = `<p>${t('recentlyChangedLabel', { list: changed.join(', ') })}</p><button id="undo-settings-session-btn" class="mini-action-btn" type="button">${t('undoSettingsBtn')}</button>`
    document.getElementById('undo-settings-session-btn')?.addEventListener('click', () => this._undoSettingsSession())
  }

  // Reverts every field back to the snapshot from when Settings was
  // opened, then reloads - same "resync every scattered UI control from a
  // clean construction" reasoning _restoreDefaultSettings already uses,
  // just restoring the pre-session snapshot instead of hardcoded defaults.
  _undoSettingsSession() {
    if (!this._settingsOpenSnapshot) return
    localStorage.setItem(SETTINGS_STORAGE_KEY, this._settingsOpenSnapshot)
    window.location.reload()
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
    // Capped at 2x even outside LOW_QUALITY_MODE - a 2.5x+ high-DPI
    // display would otherwise render 6x+ the pixels for a resolution
    // difference invisible at gameplay viewing distance. Dormant today
    // (LOW_QUALITY_MODE is hardcoded true, so the branch above always
    // wins) but see docs/PERFORMANCE.md Option A3/B: this is the landmine
    // it warns about for whoever turns that flag back off.
    return LOW_QUALITY_MODE ? 0.75 : Math.min(window.devicePixelRatio, 2)
  }

  _applyRenderScale() {
    // _userResScale (Graphics tab's Resolution slider, 50-100%) is a
    // separate multiplier from _dynResScale (the disabled *automatic*
    // per-frame scaler above - see its own comment) - this is a manual,
    // user-chosen setting, not a revival of that dormant auto-scaling.
    this.renderer.setPixelRatio(this._basePixelRatio() * this._dynResScale * this._userResScale)
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
    // Shadows deliberately keyed off settingEnabled alone, NOT the
    // LOW_QUALITY_MODE-inclusive `enabled` above (unlike bloom right
    // below, which stays governed by LOW_QUALITY_MODE same as always) -
    // see _resolveShadowsEnabled's own comment on why an explicit
    // Graphics-tab opt-in has to be able to win even though this build
    // has LOW_QUALITY_MODE hardcoded true, or the checkbox is inert UI.
    // Performance Mode itself (settingEnabled) still forces shadows off
    // regardless, same as before.
    this.renderer.shadowMap.enabled = !settingEnabled && this.settings.shadowsEnabled
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

  // Adaptive Shadow Quality - a different lever from the dynamic
  // RESOLUTION scaling this project already tried and deliberately
  // disabled (see _dynResScale's own history - pixel count wasn't the
  // actual bottleneck that time). This tests shadow-casting distance
  // specifically: sustained low fps gradually shrinks how far
  // _updateCulling still marks objects as shadow-casters, sustained
  // healthy fps gradually restores it. Multiplies into shadowSq alongside
  // (not replacing) _perfDistanceMult's own manual Performance Mode
  // shrink, and never touches render distance or light culling - only
  // shadow-casting range.
  _updateAdaptiveShadowQuality(fps) {
    if (fps < ADAPTIVE_SHADOW_LOW_FPS) {
      this._adaptiveShadowMult = Math.max(ADAPTIVE_SHADOW_MIN_MULT, this._adaptiveShadowMult * ADAPTIVE_SHADOW_STEP)
    } else if (fps >= ADAPTIVE_SHADOW_RECOVER_FPS) {
      this._adaptiveShadowMult = Math.min(1, this._adaptiveShadowMult * ADAPTIVE_SHADOW_RECOVER_STEP)
    }
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

  _closeInventoryPanel() {
    this.inventoryOpen = false
    this.inventoryPanel.style.display = 'none'
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

  // Shown right when Play is clicked, before the trait draw - every gun
  // unlocks by default now (see WeaponSystem.js), so this replaces the old
  // "buy it in the Shop first" gate with a per-run pick of which one you
  // start with instead. Melee is left out - it's always available as
  // hotbar slot 1 regardless of this pick, so it's not a meaningful choice
  // here the way the other 14 guns are.
  //
  // Also reused mid-run from the Pause menu's "Switch Weapon" button
  // (fromPause=true) - same picker grid, but a pick just re-equips and
  // resumes instead of chaining into the trait draw.
  _openWeaponPickerPanel(fromPause = false) {
    this._weaponPickerFromPause = fromPause
    this.weaponPickerPanel.style.display = 'flex'
    this.weaponPickerPanelTitle.textContent = t('weaponPickerPanelTitle')
    this._renderWeaponPickerOptions()
  }

  _renderWeaponPickerOptions() {
    this.weaponPickerOptions.innerHTML = ''
    for (const w of this.weapons.weapons) {
      if (w.id === 'melee') continue
      const btn = document.createElement('button')
      btn.className = 'perk-option weapon-picker-card'
      const tags = []
      if (w.heavy) tags.push(t('weaponPickerTagHeavy'))
      if (w.rare) tags.push(t('weaponPickerTagRare'))
      btn.innerHTML = `
        <span class="perk-name">${t(this.weapons._nameKeyFor(w))}</span>
        ${tags.length ? `<span class="perk-tag">${tags.join(' - ')}</span>` : ''}
      `
      btn.addEventListener('click', () => {
        const index = this.weapons.weapons.indexOf(w)
        // Assign into hotbar slot 2 (not just switchToIndex alone) - the
        // hotbar HUD and Digit1-5 switching both read settings.hotbar
        // directly (see _updateHotbarHud/_bindHotbar), not whatever's
        // currently equipped. Without this, the pick looked like it did
        // nothing (still showed the old Knife/Rifle/Pistol loadout with
        // nothing highlighted) and pressing "2" would silently switch back
        // to the default rifle out from under the player.
        this._assignHotbarSlot(1, w.id)
        this.weapons.switchToIndex(index)
        this._updateHotbarHud()
        this.weaponPickerPanel.style.display = 'none'
        if (this._weaponPickerFromPause) this.player.controls.lock()
        else this._openTraitDrawPanel()
      })
      this.weaponPickerOptions.appendChild(btn)
    }
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
    // Bulk-purchase combo discount visit counter - resets per visit, not
    // per purchase, so it's the count of DIFFERENT-VISIT buys, not a
    // lifetime total (that's totalSpent below, tracked separately).
    this._traderVisitPurchaseCount = 0
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
    // Bounty streak (see BOUNTY_STREAK_KEY's own comment) - an escalating
    // bonus for consecutive completions, capped the same way Haggle's
    // streak bonus is.
    this.bountyStreak += 1
    saveBountyStreak(this.bountyStreak)
    const streakBonus = Math.min(BOUNTY_STREAK_MAX_BONUS_POINTS, this.bountyStreak * BOUNTY_STREAK_BONUS_PER_LEVEL)
    this.points += b.reward + streakBonus
    this._updateStatsPanel()
    this._showLoreToast(t('bountyCompleteWithStreak', { title: t(b.titleKey, { n: b.target }), reward: b.reward, streak: this.bountyStreak, bonus: streakBonus }))
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
    // Black Market rotation (see BLACK_MARKET_ROTATION_SIZE's own comment) -
    // re-picked on the same per-night cadence as the prices above.
    const shuffled = [...BLACK_MARKET_ITEMS].sort(() => Math.random() - 0.5)
    this._blackMarketRotation = shuffled.slice(0, BLACK_MARKET_ROTATION_SIZE)
  }

  _traderPrice(item) {
    const mult = this.traderPriceMults?.[item.id] ?? 1
    const discountMult = this.metaProgress.purchased.has('traderDiscount') ? 0.85 : 1
    // Bulk-purchase combo discount (see BULK_PURCHASE_THRESHOLD's own
    // comment) and Haggle (see _tryHaggle) - both flat multipliers,
    // stacking with everything else the same way the existing
    // discountMult/levelDiscount pair already does.
    const bulkMult = this._traderVisitPurchaseCount >= BULK_PURCHASE_THRESHOLD ? 1 - BULK_PURCHASE_DISCOUNT : 1
    const haggleBonus = Math.min(HAGGLE_STREAK_MAX_BONUS, this.haggleStreak * HAGGLE_STREAK_BONUS_PER_LEVEL)
    const haggleMult = this._haggleDiscountActive ? 1 - (HAGGLE_BASE_DISCOUNT + haggleBonus) : 1
    // Trader leveling (see TRADER_LEVEL_SALES_PER_TIER's own comment) -
    // stacks with (multiplies into) the discount above rather than
    // replacing it.
    const levelDiscount = Math.min(TRADER_LEVEL_MAX_DISCOUNT, Math.floor(this.traderTotalSales / TRADER_LEVEL_SALES_PER_TIER) * TRADER_LEVEL_DISCOUNT_PER_TIER)
    return Math.max(1, Math.round(item.cost * mult * discountMult * (1 - levelDiscount) * bulkMult * haggleMult))
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

    // Featured Item reroll (see FEATURED_ITEM_REROLL_COST's own comment) -
    // a small paid button next to the featured slot itself.
    if (this.featuredItem) {
      const rerollBtn = document.createElement('button')
      rerollBtn.className = 'perk-option'
      rerollBtn.disabled = this.points < FEATURED_ITEM_REROLL_COST
      rerollBtn.innerHTML = `
        <span class="perk-name">${t('rerollFeaturedBtn')}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: FEATURED_ITEM_REROLL_COST })}</span>
      `
      rerollBtn.addEventListener('click', () => {
        if (this.points < FEATURED_ITEM_REROLL_COST) return
        this.points -= FEATURED_ITEM_REROLL_COST
        this._rerollFeaturedItem()
        this._updateStatsPanel()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(rerollBtn)

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
        this._recordTraderPurchase(cost)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }

    // Haggle (see HAGGLE_SUCCESS_CHANCE's own comment).
    const haggleBtn = document.createElement('button')
    haggleBtn.className = 'perk-option'
    haggleBtn.disabled = this._haggleDiscountActive
    haggleBtn.innerHTML = `
      <span class="perk-name">${t('haggleBtn')}</span>
      <span class="perk-cost">${this._haggleDiscountActive ? t('haggleActiveLabel') : t('haggleHintLabel')}</span>
    `
    haggleBtn.addEventListener('click', () => this._tryHaggle())
    this.traderOptions.appendChild(haggleBtn)

    // "Best deal today" highlight - the single biggest discount roll this
    // visit, found in its own pass before building the row buttons below.
    let bestDealId = null
    let bestDealPct = 0
    for (const item of SHOP_ITEMS) {
      if (item === this.featuredItem) continue
      const pctDelta = Math.round((this._traderPrice(item) / item.cost - 1) * 100)
      if (pctDelta < bestDealPct) {
        bestDealPct = pctDelta
        bestDealId = item.id
      }
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
      btn.className = `perk-option${item.id === bestDealId ? ' best-deal' : ''}`
      btn.disabled = owned || this.points < cost
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)}</span>
        <span class="perk-cost">${owned ? t('upgradesOwned') : `${t('perkCostLabel', { n: cost })} ${priceTagHtml}`}</span>
      `
      btn.addEventListener('click', () => {
        if (owned || this.points < cost) return
        this.points -= cost
        item.give(this)
        this._recordTraderPurchase(cost)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }

    this._renderSalvageOptions()
    this._renderCraftingOptions()
    this._renderStashOptions()
    this._renderCosmeticSellback()
    this._renderBlackMarketOptions()
  }

  // Shared by both trader purchase handlers (featured item + the main
  // list) - lifetime spend tracking, the bulk-purchase visit counter, and
  // consuming the Haggle discount (see _tryHaggle) all in one place rather
  // than duplicated at each click site.
  _recordTraderPurchase(cost) {
    this.totalSpent += cost
    saveTotalSpent(this.totalSpent)
    this._traderVisitPurchaseCount += 1
    this._haggleDiscountActive = false
    // Rare free bonus item on a big purchase - a small chance, not
    // guaranteed, so it reads as a nice surprise rather than an expected
    // rebate.
    if (cost >= BIG_PURCHASE_THRESHOLD && Math.random() < FREE_BONUS_ITEM_CHANCE) {
      const bonus = SHOP_ITEMS[Math.floor(Math.random() * SHOP_ITEMS.length)]
      bonus.give(this)
      this._showLoreToast(t('freeBonusItemToast', { item: t(bonus.titleKey) }))
    }
  }

  // Haggle (see HAGGLE_SUCCESS_CHANCE's own comment) - success arms a
  // discount for the next purchase and grows the cross-visit streak;
  // failure doesn't penalize, just doesn't grant anything, and breaks the
  // streak back to 0.
  _tryHaggle() {
    if (this._haggleDiscountActive) return
    if (Math.random() < HAGGLE_SUCCESS_CHANCE) {
      this._haggleDiscountActive = true
      this.haggleStreak += 1
      saveHaggleStreak(this.haggleStreak)
      this._showLoreToast(t('haggleSuccess'))
    } else {
      this.haggleStreak = 0
      saveHaggleStreak(this.haggleStreak)
      this._showLoreToast(t('haggleFail'))
    }
    this._renderTraderOptions()
  }

  // Daily Featured Item reroll (see FEATURED_ITEM_REROLL_COST's own
  // comment) - reuses the exact same random pick _rollFeaturedItem already
  // does, just triggered by a paid button instead of the nightly roll.
  _rerollFeaturedItem() {
    this.featuredItem = SHOP_ITEMS[Math.floor(Math.random() * SHOP_ITEMS.length)]
  }

  // Cosmetic sell-back (see COSMETIC_SELLBACK_REFUND_MULT's own comment) -
  // owned-but-not-currently-equipped outfits/hats only (selling the
  // equipped one would need to also clear playerBody's live tint/prop,
  // extra complexity not worth it for what's meant to be a declutter tool).
  _renderCosmeticSellback() {
    if (!this.traderSellbackOptions) return
    this.traderSellbackOptions.innerHTML = ''
    const sellableOutfits = COIN_SHOP_ITEMS.filter((i) => i.outfit && this.ownedOutfits.has(i.outfit) && this.equippedOutfit !== i.outfit)
    const sellableHats = COIN_SHOP_ITEMS.filter((i) => i.hat && this.ownedHats.has(i.hat) && this.equippedHat !== i.hat)
    const sellable = [...sellableOutfits, ...sellableHats]
    const show = sellable.length > 0
    this.traderSellbackTitle.style.display = show ? '' : 'none'
    this.traderSellbackOptions.style.display = show ? '' : 'none'
    if (!show) return

    this.traderSellbackTitle.textContent = t('sellbackSectionLabel')
    for (const item of sellable) {
      const refund = Math.round(item.cost * COSMETIC_SELLBACK_REFUND_MULT)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)}</span>
        <span class="perk-cost salvage-gain">${t('salvageGainLabel', { n: refund })}</span>
      `
      btn.addEventListener('click', () => {
        if (item.outfit) this.ownedOutfits.delete(item.outfit)
        else this.ownedHats.delete(item.hat)
        this.coins += refund
        this._updateStatsPanel()
        this._renderTraderOptions()
      })
      this.traderSellbackOptions.appendChild(btn)
    }
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
    // Rotation (see BLACK_MARKET_ROTATION_SIZE's own comment) - falls back
    // to the full list if the rotation somehow hasn't been rolled yet
    // (e.g. centurion unlocked mid-run, after tonight's _rollTraderPrices
    // already ran once without Black Market being visible yet).
    const items = this._blackMarketRotation.length > 0 ? this._blackMarketRotation : BLACK_MARKET_ITEMS
    for (const item of items) {
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
        this._recordTraderPurchase(item.cost)
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

    // Legacy Tree Respec (Long-Term Goals batch) - only worth showing once
    // there's actually something purchased to redistribute.
    if (this.respecSection) {
      const canRespec = this.metaProgress.purchased.size > 0
      this.respecSection.style.display = canRespec ? 'block' : 'none'
      if (canRespec) this.respecBtn.textContent = t('respecBtn')
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
    this.metaProgress.prestigeHistory.push({ level: this.metaProgress.prestigeLevel, ts: Date.now() })
    saveMetaProgress(this.metaProgress)
    this._showLoreToast(t('prestigeComplete', { level: this.metaProgress.prestigeLevel, bonus: this.metaProgress.prestigeLevel * 10 }))
    this._renderUpgradesOptions()
    this._updatePrestigeBadge()
  }

  // Respec (Long-Term Goals batch) - refunds every purchased Permanent
  // Upgrade's cost back into Legacy Points and clears `purchased`, same
  // reset-then-let-the-next-run's-apply-loop-sort-it-out mechanism
  // _prestige() above already relies on (see the constructor's own
  // "if (this.metaProgress.purchased.has(upgrade.id)) upgrade.apply(this)"
  // loop) - nothing needs undoing mid-run, only future runs read this set.
  // No prestigeLevel change and no currency cost of its own, unlike
  // Prestige - this is pure redistribution, not a fresh-start bonus.
  _respecMetaUpgrades() {
    if (this.metaProgress.purchased.size === 0) return
    if (!window.confirm(t('respecConfirm'))) return
    let refund = 0
    for (const id of this.metaProgress.purchased) {
      const upgrade = META_UPGRADES.find((u) => u.id === id)
      if (upgrade) refund += upgrade.cost
    }
    this.metaProgress.purchased = new Set()
    this.metaProgress.legacyPoints += refund
    saveMetaProgress(this.metaProgress)
    this._showLoreToast(t('respecComplete', { n: refund }))
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
    // Directional hint for the nearest undiscovered landmark - the journal
    // previously only ever showed a bare found/total count with no clue
    // where to look next.
    const undiscovered = this.allLocationLandmarks.filter((lm) => !foundLocations.includes(lm))
    let nearestHint = ''
    if (undiscovered.length > 0) {
      const playerPos = this.player.controls.object.position
      let nearest = null
      let nearestDist = Infinity
      for (const lm of undiscovered) {
        const dist = Math.hypot(lm.x - playerPos.x, lm.z - playerPos.z)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = lm
        }
      }
      const bearing = Math.atan2(nearest.x - playerPos.x, -(nearest.z - playerPos.z))
      const dirIndex = Math.round(((bearing + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8
      const dirKeys = ['journalDirN', 'journalDirNE', 'journalDirE', 'journalDirSE', 'journalDirS', 'journalDirSW', 'journalDirW', 'journalDirNW']
      nearestHint = t('journalNearestUndiscovered', { direction: t(dirKeys[dirIndex]) })
    }
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
        ${nearestHint ? `<p>${nearestHint}</p>` : ''}
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

  // Spending History Log - capped at 10, newest first, persisted (see
  // settings.shopSpendingLog). item.titleKey is resolved to text at log
  // time (not re-resolved later), so a future language switch doesn't
  // retroactively change what an old log entry says it was.
  _logShopPurchase(item) {
    this.settings.shopSpendingLog.unshift({ name: t(item.titleKey), cost: item.cost, ts: Date.now() })
    this.settings.shopSpendingLog = this.settings.shopSpendingLog.slice(0, 10)
    saveSettings(this.settings)
  }

  _renderShopSpendingLog() {
    if (!this.shopSpendingLogRow) return
    if (!this.settings.shopSpendingLog.length) {
      this.shopSpendingLogRow.style.display = 'none'
      return
    }
    this.shopSpendingLogRow.style.display = ''
    this.shopSpendingLogHeading.textContent = t('shopSpendingLogHeading')
    this.shopSpendingLogList.innerHTML = this.settings.shopSpendingLog.map((entry) => `
      <div class="shop-spending-log-row"><span>${_escapeHtml(entry.name)}</span><span>${t('coinCostLabel', { n: _safeStatNumber(entry.cost) })}</span></div>
    `).join('')
  }

  _renderCoinShopOptions() {
    this.coinshopCoinLine.textContent = t('coinsLabel', { n: this.coins })
    this._renderShopSpendingLog()
    this.coinshopOptions.innerHTML = ''
    // Iron Mode - gated once here rather than at every individual buy
    // button, since every Coin Shop purchase path renders through this one
    // function.
    if (this.settings.mutators.ironMode) {
      this.coinshopOptions.innerHTML = `<p class="iron-mode-notice">${t('ironModeShopDisabled')}</p>`
      return
    }

    const sections = [
      { id: 'weapons', labelKey: 'shopSectionWeapons' },
      { id: 'skins', labelKey: 'shopSectionSkins' },
      { id: 'outfits', labelKey: 'shopSectionOutfits' },
      { id: 'hats', labelKey: 'shopSectionHats' },
      { id: 'perks', labelKey: 'shopSectionPerks' },
      { id: 'base', labelKey: 'shopSectionBase' },
      // Veteran's Cache (Long-Term Goals batch) - own section, last, since
      // it's gated by lifetime-earned coins rather than current balance
      // like every section above it.
      { id: 'legacy', labelKey: 'shopSectionLegacy' },
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

      // Same "unequip" front-of-section button, mirrored for hats.
      if (section.id === 'hats') {
        const defaultBtn = document.createElement('button')
        defaultBtn.className = 'perk-option'
        defaultBtn.disabled = this.equippedHat === null
        defaultBtn.innerHTML = `
          <span class="perk-name">${t('skinDefault')}</span>
          <span class="perk-cost">${this.equippedHat === null ? t('skinEquipped') : t('skinEquip')}</span>
        `
        defaultBtn.addEventListener('click', () => {
          this.equippedHat = null
          this.playerBody.setHat(null)
          this._renderCoinShopOptions()
        })
        row.appendChild(defaultBtn)
      }

      // Sort (see #shop-sort-select) - reorders items WITHIN each section
      // rather than across all sections at once, so the existing guns/
      // skins/perks grouping stays intact regardless of sort mode.
      const sectionItems = COIN_SHOP_ITEMS.filter((i) => i.section === section.id)
      const sortMode = this.settings.shopSortMode || 'default'
      if (sortMode === 'costAsc') sectionItems.sort((a, b) => a.cost - b.cost)
      else if (sortMode === 'costDesc') sectionItems.sort((a, b) => b.cost - a.cost)
      else if (sortMode === 'alpha') sectionItems.sort((a, b) => t(a.titleKey).localeCompare(t(b.titleKey)))
      else if (sortMode === 'wishlist') sectionItems.sort((a, b) => (this.settings.shopWishlist.includes(b.id) ? 1 : 0) - (this.settings.shopWishlist.includes(a.id) ? 1 : 0))

      for (const item of sectionItems) {
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
            this._logShopPurchase(item)
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
            this._logShopPurchase(item)
              this.ownedOutfits.add(item.outfit)
              this._updateStatsPanel()
              // Fashion Icon - every outfit color owned at once.
              const totalOutfits = COIN_SHOP_ITEMS.filter((i) => i.outfit).length
              if (this.ownedOutfits.size >= totalOutfits) this.achievements.unlock('fashion_icon')
            }
            this.equippedOutfit = item.outfit
            this.playerBody.setOutfit(item.outfitColor)
            this._renderCoinShopOptions()
          })
        } else if (item.hat) {
          const owned = this.ownedHats.has(item.hat)
          const equipped = this.equippedHat === item.hat
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
            this._logShopPurchase(item)
              this.ownedHats.add(item.hat)
              this._updateStatsPanel()
            }
            this.equippedHat = item.hat
            this.playerBody.setHat(item.hat, item.hatColor)
            this._renderCoinShopOptions()
          })
        } else {
          const owned = item.isOwned(this)
          // Veteran's Cache lifetime-earnings gate (see CoinShop.js's own
          // comment on requiresLifetimeCoins) - checked alongside the
          // normal coins-affordability check, but shown as its own locked
          // label so "I have the coins but haven't earned enough lifetime"
          // reads differently from "I just can't afford this yet."
          const lifetimeLocked = !!item.requiresLifetimeCoins && this.careerStats.lifetimeCoinsEarned < item.requiresLifetimeCoins
          btn.disabled = owned || lifetimeLocked || this.coins < item.cost
          btn.innerHTML = `
            <span class="perk-name">${t(item.titleKey)}</span>
            <span class="perk-cost">${owned ? t('upgradesOwned') : lifetimeLocked ? t('cacheLifetimeLocked', { have: this.careerStats.lifetimeCoinsEarned, need: item.requiresLifetimeCoins }) : t('coinCostLabel', { n: item.cost })}</span>
          `
          btn.addEventListener('click', () => {
            if (owned || lifetimeLocked || this.coins < item.cost) return
            this.coins -= item.cost
            this._logShopPurchase(item)
            item.apply(this)
            this._updateStatsPanel()
            this._renderCoinShopOptions()
          })
        }

        // Wrapper (not appended as a child of btn) - a disabled <button>
        // suppresses pointer events on its whole subtree, so the wishlist
        // star's own click would silently never fire for any owned/
        // unaffordable item if it were nested inside btn instead of
        // beside it. Same "wrap, don't nest into a possibly-disabled
        // button" precedent the per-gun attachment row already uses.
        const wrap = document.createElement('div')
        wrap.className = 'shop-item-wrap'
        wrap.appendChild(btn)

        const star = document.createElement('span')
        star.className = `shop-wishlist-star${this.settings.shopWishlist.includes(item.id) ? ' active' : ''}`
        star.textContent = '★'
        star.title = t('wishlistStarTooltip')
        star.addEventListener('click', (e) => {
          e.stopPropagation()
          if (this.settings.shopWishlist.includes(item.id)) {
            this.settings.shopWishlist = this.settings.shopWishlist.filter((id) => id !== item.id)
          } else {
            this.settings.shopWishlist.push(item.id)
          }
          saveSettings(this.settings)
          this._renderCoinShopOptions()
        })
        wrap.appendChild(star)

        // Runs-to-afford estimator - avgCoinsPerRun is the exact same
        // lifetime-earned/totalRuns ratio the Profile panel's own
        // careerStats rows already use, not a separately-invented rate.
        if (this.coins < item.cost && this.careerStats.totalRuns > 0) {
          const avgCoinsPerRun = this.careerStats.lifetimeCoinsEarned / this.careerStats.totalRuns
          if (avgCoinsPerRun > 0) {
            const runsNeeded = Math.ceil((item.cost - this.coins) / avgCoinsPerRun)
            const estimate = document.createElement('span')
            estimate.className = 'shop-afford-estimate'
            estimate.textContent = t('affordEstimate', { n: runsNeeded })
            wrap.appendChild(estimate)
          }
        }

        row.appendChild(wrap)
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

  // Quests panel - tiered career-kill and best-killstreak goals, each a
  // one-time coin reward (see Quests.js for the exact tiers/amounts).
  // Uses real clickable buttons (unlike Achievements/Bestiary above,
  // which are pure display) since completed-but-unclaimed quests need a
  // Claim action - one delegated click listener on the container handles
  // every quest button rather than rebinding per-button on every render.
  _openQuestsPanel() {
    this.questsPanel.style.display = 'flex'
    this.questsPanelTitle.textContent = t('questsPanelTitle')
    this.rollingQuestsHeading.textContent = t('rollingQuestsTitle')
    this.rollingQuestsSubtitle.textContent = t('rollingQuestsSubtitle')
    this.lifetimeQuestsHeading.textContent = t('lifetimeQuestsTitle')
    this._renderQuestsPanel()
    this._renderRollingQuestsPanel()
  }

  _renderQuestsPanel() {
    this.questsOptions.innerHTML = ''
    for (const quest of QUESTS) {
      const claimed = this.quests.isClaimed(quest.id)
      const progress = Math.min(quest.target, this.quests.currentProgress(quest, this))
      const complete = this.quests.isComplete(quest, this)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.dataset.questId = quest.id
      btn.disabled = claimed || !complete
      const statusText = claimed
        ? t('questClaimed')
        : complete
          ? t('questClaimReward', { n: quest.rewardCoins })
          : t('questProgress', { current: progress.toLocaleString(), target: quest.target.toLocaleString() })
      btn.innerHTML = `
        <span class="perk-name">${t(quest.titleKey, { n: quest.target.toLocaleString() })}</span>
        <span class="perk-cost">${statusText}</span>
      `
      this.questsOptions.appendChild(btn)
    }
  }

  // Rolling Quests - separate from the lifetime tiers above (see
  // RollingQuests.js): each expires 3 hours after it spawns, and a new one
  // spawns every 30 minutes (up to 6 active at once). refresh() prunes
  // anything expired and catches up on any spawns due since the panel was
  // last opened, so opening this panel is also what keeps the rotation
  // moving forward - it doesn't need its own always-running timer loop.
  _renderRollingQuestsPanel() {
    this.rollingQuests.refresh()
    this.rollingQuestsOptions.innerHTML = ''
    const active = this.rollingQuests.activeQuests()
    if (active.length === 0) {
      this.rollingQuestsOptions.innerHTML = `<p class="menu-best-stats">${t('rollingQuestNone')}</p>`
      return
    }
    const now = Date.now()
    for (const q of active) {
      const progress = Math.min(q.template.target, q.progress)
      const complete = progress >= q.template.target
      const timeLeftSeconds = Math.max(0, Math.floor((q.spawnedAt + ROLLING_QUEST_EXPIRE_MS - now) / 1000))
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.dataset.spawnedAt = q.spawnedAt
      btn.disabled = !complete
      const statusText = complete
        ? t('rollingQuestClaimReward', { coins: q.template.rewardCoins, xp: q.template.rewardXp })
        : `${t('questProgress', { current: progress.toLocaleString(), target: q.template.target.toLocaleString() })} · ${t('rollingQuestTimeLeft', { time: _formatDurationShort(timeLeftSeconds) })}`
      btn.innerHTML = `
        <span class="perk-name">${t(q.template.titleKey, { n: q.template.target.toLocaleString() })}</span>
        <span class="perk-cost">${statusText}</span>
      `
      this.rollingQuestsOptions.appendChild(btn)
    }
  }

  _closeQuestsPanel() {
    this.questsPanel.style.display = 'none'
  }

  // Share panel - single entry point consolidating what used to be 5
  // scattered buttons (homepage row + Inventory panel + Profile panel),
  // each already backed by its own real encode/decode function. This is a
  // UI consolidation only - every button here calls an existing _copy*
  // method (or, for Copy Page Link, the equally-existing inline handler
  // now named _copyPageUrl) as-is, none of the underlying sharing logic
  // changed.
  _openSharePanel() {
    if (!this.sharePanel) return
    this.sharePanel.style.display = 'flex'
    if (this.sharePanelTitle) this.sharePanelTitle.textContent = t('sharePanelTitle')
    CloudSync.incrementTelemetry('shareUsed').catch(() => {})
  }

  _closeSharePanel() {
    if (this.sharePanel) this.sharePanel.style.display = 'none'
  }

  _copyPageUrl() {
    if (!navigator.clipboard) {
      this._showHomepageToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(location.href)
      .then(() => this._showHomepageToast(t('pageUrlCopied')))
      .catch(() => this._showHomepageToast(t('clipboardCopyUnsupported')))
  }

  _claimQuest(id) {
    if (!this.quests.claim(id, this)) return
    saveShopProgress(this)
    this._showHomepageToast(t('questClaimedToast', { n: QUESTS.find((q) => q.id === id)?.rewardCoins || 0 }))
    this._renderQuestsPanel()
    this._updateNavCompletionRings()
    this._updateFaviconQuestBadge()
  }

  _claimRollingQuest(spawnedAt) {
    const reward = this.rollingQuests.claim(spawnedAt, this)
    if (!reward) return
    // RollingQuests.claim() applies the coin reward itself (mirrors
    // Quests.claim()) but deliberately leaves XP to us - game.xp has its
    // own HUD/level-up side effects that belong here, not duplicated in a
    // plain data module. _checkXpLevelUp() can open the run-buff picker
    // panel (_openXpLevelupPanel, designed for picking a passive buff
    // mid-combat) - only run that side effect if a run is actually active;
    // claiming from the homepage just banks the XP toward the next
    // level-up, which gets caught for real the next time xp is gained
    // during real play.
    this.xp += reward.xp
    this._updateXpHud()
    if (this.gameStarted) this._checkXpLevelUp()
    saveShopProgress(this)
    this._showHomepageToast(t('rollingQuestClaimedToast', { coins: reward.coins, xp: reward.xp }))
    this._renderRollingQuestsPanel()
    this._updateFaviconQuestBadge()
  }

  // Favicon Quest Badge - draws the real favicon.svg onto an offscreen
  // canvas plus a small red count badge (capped display at "9+") when
  // quests are complete but not yet claimed, then swaps the <link
  // rel="icon"> href to the resulting data URL. Same-origin SVG, so the
  // canvas is never tainted and toDataURL works normally. No-ops (leaves
  // the plain icon alone) if canvas/SVG loading ever fails - a badge that
  // silently doesn't appear is fine, a thrown error breaking the menu
  // refresh batch is not.
  _updateFaviconQuestBadge() {
    const lifetimeCount = QUESTS.filter((q) => this.quests.isComplete(q, this) && !this.quests.isClaimed(q.id)).length
    const rollingCount = this.rollingQuests.activeQuests().filter((q) => q.progress >= q.template.target).length
    const count = lifetimeCount + rollingCount
    const link = document.querySelector('link[rel="icon"]')
    if (!link) return
    if (count <= 0) {
      if (this._faviconBaseHref) link.href = this._faviconBaseHref
      return
    }
    if (!this._faviconBaseHref) this._faviconBaseHref = link.href
    if (!this._faviconImg) {
      this._faviconImg = new Image()
      this._faviconImg.onload = () => this._updateFaviconQuestBadge()
      this._faviconImg.src = this._faviconBaseHref
      return
    }
    if (!this._faviconImg.complete || this._faviconImg.naturalWidth === 0) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 32
      const ctx = canvas.getContext('2d')
      ctx.drawImage(this._faviconImg, 0, 0, 32, 32)
      ctx.beginPath()
      ctx.arc(24, 8, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#d3392f'
      ctx.fill()
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(count > 9 ? '9+' : String(count), 24, 9)
      link.href = canvas.toDataURL('image/png')
    } catch {
      // Best-effort - leave whatever icon is currently set.
    }
  }

  _openAchievementsPanel() {
    this.achievementsPanel.style.display = 'flex'
    this.achievementsPanelTitle.textContent = t('achievementsPanelTitle')
    if (this.achievementsFilterInput) this.achievementsFilterInput.placeholder = t('achievementsFilterPlaceholder')
    if (this.bestiarySectionHeading) this.bestiarySectionHeading.textContent = t('bestiaryPanelTitle')
    if (this.bestiaryFilterInput) this.bestiaryFilterInput.placeholder = t('bestiaryFilterPlaceholder')
    this._renderAchievementsPanel()
    this._renderBestiaryPanel()
  }

  // Filters against the DISPLAYED name only (not the real underlying
  // title) - a locked entry always shows '???' (see the loop below), same
  // spoiler-avoidance precedent as everywhere else in this panel, so
  // typing a real achievement name never reveals a locked one early.
  _renderAchievementsPanel() {
    const filter = (this.achievementsFilterInput?.value || '').trim().toLowerCase()
    const category = this.achievementsCategorySelect?.value || 'all'
    const sortMode = this.achievementsSortSelect?.value || 'default'
    let list = ACHIEVEMENTS.filter((ach) => category === 'all' || ach.category === category)
    // Sort by unlock date - unlocked-with-a-known-time first (newest
    // first, same source Achievements.js's getRecentUnlocks already
    // reads), then everything else (locked, or unlocked before
    // unlockTimes existed) in original array order after.
    if (sortMode === 'unlockDate') {
      list = [...list].sort((a, b) => {
        const ta = this.achievements.unlockTimes[a.id] || 0
        const tb = this.achievements.unlockTimes[b.id] || 0
        return tb - ta
      })
    }
    this.achievementsOptions.innerHTML = ''
    for (const ach of list) {
      const unlocked = this.achievements.unlocked.has(ach.id)
      const name = unlocked ? t(ach.titleKey) : '???'
      if (filter && !name.toLowerCase().includes(filter)) continue
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = true
      btn.innerHTML = `
        <span class="perk-name">${name}</span>
        <span class="perk-cost">${unlocked ? t('achievementUnlockedShort') : (ach.hintKey ? t(ach.hintKey) : t('achievementLocked'))}</span>
      `
      this.achievementsOptions.appendChild(btn)
    }
  }

  _closeAchievementsPanel() {
    this.achievementsPanel.style.display = 'none'
  }

  _renderBestiaryPanel() {
    const filter = (this.bestiaryFilterInput?.value || '').trim().toLowerCase()
    this.bestiaryOptions.innerHTML = ''
    for (const type of Object.values(ZOMBIE_TYPES)) {
      const known = this.bestiaryEncountered.has(type.id)
      const name = known ? type.label : '???'
      if (filter && !name.toLowerCase().includes(filter)) continue
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = true
      btn.innerHTML = `
        <span class="perk-name">${name}</span>
        <span class="perk-cost">${known ? t('achievementUnlockedShort') : t('achievementLocked')}</span>
        <span class="perk-lore">${known ? type.lore : t('bestiaryUnknown')}</span>
      `
      this.bestiaryOptions.appendChild(btn)
    }
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
    // Menu redesign - these 5 buttons now hold an <svg> icon + <span> label
    // (settings is icon-only). Setting .textContent on the BUTTON itself
    // would wipe out the icon entirely (it replaces every child with one
    // text node) - target the inner <span>/aria-label instead.
    this.settingsBtn.setAttribute('aria-label', t('settingsBtn'))
    this.upgradesBtn.querySelector('span').textContent = t('upgradesBtn')
    this.questsBtn.querySelector('span').textContent = t('questsBtn')
    this.achievementsBtn.querySelector('span').textContent = t('achievementsBtn')
    this.coinshopBtn.querySelector('span').textContent = t('coinshopBtn')
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
    // Local Sharing batch - static settings-panel labels.
    this.exportSaveBtn.textContent = t('exportSaveBtn')
    this.importSaveBtn.textContent = t('importSaveBtn')
    this.compareSaveBtn.textContent = t('compareSaveBtn')
    this.clearLeaderboardsBtn.textContent = t('clearLeaderboardsBtn')
    document.getElementById('guest-mode-label').textContent = t('guestModeLabel')
    this._updateStorageUsageLine()
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

    // this.roleBtns covers both the main-menu icon+span buttons and the
    // plain-text trader-screen role buttons (#trader-role-ranged etc, no
    // icon) - only the former has a <span> to target, so fall back to the
    // button itself for the latter rather than assuming every match has one.
    const roleLabelKeys = { ranged: 'roleRanged', melee: 'roleMelee', medic: 'roleMedic' }
    for (const btn of this.roleBtns) {
      const label = t(roleLabelKeys[btn.dataset.role])
      const span = btn.querySelector('span')
      if (span) span.textContent = label
      else btn.textContent = label
    }
    // Narrative blurb (see loadoutBalancedBlurb/RunnerBlurb/TankBlurb) shown
    // as a hover tooltip - these presets were already a pure stat tradeoff
    // with zero flavor text, so this is purely additive over the existing
    // selection UI rather than a second parallel picker.
    const loadoutBlurbKeys = { balanced: 'loadoutBalancedBlurb', runner: 'loadoutRunnerBlurb', tank: 'loadoutTankBlurb' }
    for (const btn of this.loadoutBtns) {
      btn.querySelector('span').textContent = t(LOADOUT_LABEL_KEYS[btn.dataset.loadout])
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
    document.getElementById('stream-safe-mode-label').textContent = t('streamSafeModeLabel')
    document.getElementById('toggle-sprint-label').textContent = t('toggleSprintLabel')
    document.getElementById('toggle-crouch-label').textContent = t('toggleCrouchLabel')
    document.getElementById('toggle-ads-label').textContent = t('toggleAdsLabel')
    document.getElementById('aim-assist-label').textContent = t('aimAssistLabel')
    document.getElementById('big-interact-prompt-label').textContent = t('bigInteractPromptLabel')
    document.getElementById('toast-duration-label').textContent = t('toastDurationLabel')
    document.getElementById('crosshair-color-label').textContent = t('crosshairColorLabel')
    document.getElementById('crosshair-size-label').textContent = t('crosshairSizeLabel')
    document.getElementById('nickname-color-label').textContent = t('nicknameColorLabel')
    document.getElementById('companion-color-label').textContent = t('companionColorLabel')

    this._updateBestStatsDisplay()
    this._updateBossRushLeaderboardDisplay()
    this._updateAcceptChallengeButton()
    this._updateHardcoreMemorialDisplay()
    if (this.inventoryOpen) this._refreshInventoryPanel()
    this._updateProgressHud()
  }

  _updateBestStatsDisplay() {
    const { bestNight, bestKills, bestKillStreak } = this.bestStats
    // Hero stat pair (Best Night / Best Streak) - all textContent, so a
    // malicious imported bestStats value (see _safeStatNumber's own
    // comment on this exact risk) just renders as text, never HTML.
    if (this.heroBestNight) this.heroBestNight.textContent = _safeStatNumber(bestNight)
    if (this.heroBestStreak) this.heroBestStreak.textContent = _safeStatNumber(bestKillStreak)

    // Your Stats panel - a different stat slice than the hero pair above,
    // matching the redesigned menu's own left-column panel. All pulled
    // from data this game already tracks (careerStats/bestRunPace/
    // runHistory), nothing new recorded just for this display.
    // K/D ratio appended inline rather than as its own stat row - the
    // Your Stats panel has no spare vertical budget for a new row (see
    // CLAUDE.md's menu-redesign notes on the zero-scroll fight).
    {
      const kd = (_safeStatNumber(this.careerStats.totalKills) / Math.max(1, _safeStatNumber(this.careerStats.totalDeaths))).toFixed(1)
      this.statTotalKills.forEach((el) => { el.textContent = `${_safeStatNumber(this.careerStats.totalKills)} (K/D ${kd})` })
    }
    {
      const hours = (_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 3600).toFixed(1)
      this.statRunsPlayed.forEach((el) => { el.textContent = `${_safeStatNumber(this.careerStats.totalRuns)} · ${hours}h played` })
    }
    {
      // Favorite Class - purely derived from runHistory's own loadout field
      // (already captured per run, see _recordRunEnd), same "no new tracking
      // needed" precedent as the favorite-difficulty line elsewhere.
      const tally = {}
      for (const run of this.runHistory) {
        if (run.loadout) tally[run.loadout] = (tally[run.loadout] || 0) + 1
      }
      const topLoadout = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0]
      const favoriteClassText = topLoadout ? t(LOADOUT_LABEL_KEYS[topLoadout] || topLoadout) : '--'
      this.statFavoriteClass.forEach((el) => { el.textContent = favoriteClassText })
    }
    {
      const survivalText = this.bestRunPace && this.bestRunPace.elapsedMs
        ? formatTime(_safeStatNumber(this.bestRunPace.elapsedMs))
        : '--'
      this.statLongestSurvival.forEach((el) => { el.textContent = survivalText })
    }
    {
      const last = this.runHistory[0]
      let lastRunText = '--'
      if (last) {
        let line = t(last.survived ? 'runHistorySurvived' : 'runHistoryDied', { night: _safeStatNumber(last.night), kills: _safeStatNumber(last.kills), coins: _safeStatNumber(last.coins) })
        // Personal-best delta - compares only against bestStats.bestNight
        // (already the single source of truth for "your best run ever"),
        // not a new "is this actually the best" computation of its own.
        const nightDelta = _safeStatNumber(last.night) - _safeStatNumber(bestNight)
        if (nightDelta === 0 && _safeStatNumber(last.night) > 0) line += ` — ${t('deltaNewBest')}`
        else if (nightDelta < 0) line += ` (${t('deltaFromBest', { n: Math.abs(nightDelta) })})`
        lastRunText = line
      }
      this.statLastRun.forEach((el) => { el.textContent = lastRunText })
      if (this.continueActions) this.continueActions.style.display = last ? 'flex' : 'none'
    }

    if (this.menuCareerRank) {
      this.menuCareerRank.textContent = this.careerStats.totalKills === 0
        ? ''
        : t('careerRankLabel', { rank: t(careerRankTitleKey(this.careerStats.totalKills)), kills: this.careerStats.totalKills })
    }
    // Avatar level badge - the same tier index careerRankTitleKey already
    // derives from totalKills, just as a plain 1-5 number instead of a title.
    if (this.menuAvatarLevel) {
      let level = 1
      for (let i = 0; i < CAREER_RANK_TITLES.length; i++) {
        if (this.careerStats.totalKills >= CAREER_RANK_TITLES[i].min) level = i + 1
      }
      this.menuAvatarLevel.textContent = level
      // Avatar frame tiers - automatic, not a picker (see that CSS rule's
      // own comment), reuses this same tier index.
      const avatarIcon = document.getElementById('menu-avatar-icon')
      if (avatarIcon) {
        for (let i = 2; i <= 5; i++) avatarIcon.classList.remove(`avatar-frame-${i}`)
        if (level >= 2) avatarIcon.classList.add(`avatar-frame-${level}`)
      }
      // Logo blood-tint intensity - same tier index, purely cosmetic (a
      // CSS filter, not a different image asset). Doesn't touch the
      // logo's size, only how saturated/red its existing blood-crack
      // texture reads.
      const logoImg = document.getElementById('menu-title-img')
      if (logoImg) {
        for (let i = 2; i <= 5; i++) logoImg.classList.remove(`logo-tier-${i}`)
        if (level >= 2) logoImg.classList.add(`logo-tier-${level}`)
      }
    }
    this._renderPlayerTag()
    this._updateMenuNewsTicker()
    this._updatePrestigeBadge()
    this._updateRecommendedDifficultyHint()
    this._updateSeasonProgress()
    this._updateMenuSpotlight()
    this._updateWhatsNewDot()
    this._updateLoginStreakBadge()
    this._updateNavCompletionRings()
    this._checkKillMilestones()
    this._updateWeeklyProgressBar()
    this._updateFaviconQuestBadge()
    this._updateLongestSession()
    if (this._pendingConfetti && !this.gameStarted) {
      this._pendingConfetti = false
      this._fireConfetti()
      this._showHomepageToast(t('newPersonalBestToast'))
    }
    if (this.menuAriaSummary) {
      this.menuAriaSummary.textContent = t('menuAriaSummary', {
        night: _safeStatNumber(this.bestStats.bestNight),
        kills: _safeStatNumber(this.careerStats.totalKills),
        coins: _safeStatNumber(this.coins),
      })
    }
  }

  // Player tag - factored out of _updateBestStatsDisplay (also fired on
  // nickname edits directly) since it now also appends the cached Global
  // Rank (see _renderMyRank, fetched only when the Cloud Save panel opens
  // - not a live subscription) when one's available.
  _renderPlayerTag() {
    if (!this.menuPlayerTag) return
    const base = this.settings.nickname ? `#${this.settings.nickname.toUpperCase()}` : t('menuPlayerTagDefault')
    let text = base + (this.settings.motto ? ` "${this.settings.motto}"` : '')
    if (this._cloudGlobalRank) {
      text += ` · ${t('globalRankBadge', { rank: this._cloudGlobalRank })}`
      // Rank velocity arrow - compares against the rank as of the last
      // time this ever fetched (localStorage, not per-session), computed
      // once per session (_rankVelocityArrow caches it) so repeated
      // _renderPlayerTag calls later in the same session don't keep
      // comparing against an already-updated baseline and always show
      // "no change."
      if (this._rankVelocityArrow === undefined) {
        const prev = Number(localStorage.getItem(PREV_GLOBAL_RANK_KEY)) || 0
        this._rankVelocityArrow = !prev ? '' : this._cloudGlobalRank < prev ? ' ▲' : this._cloudGlobalRank > prev ? ' ▼' : ' –'
        // Rank-change toast - the arrow above is a passive, easy-to-miss
        // badge; this surfaces the same "you moved up" fact as an actual
        // toast, once per session, only on genuine improvement.
        if (prev && this._cloudGlobalRank < prev) this._showHomepageToast(t('rankImprovedToast', { rank: this._cloudGlobalRank }))
        localStorage.setItem(PREV_GLOBAL_RANK_KEY, String(this._cloudGlobalRank))
      }
      text += this._rankVelocityArrow
    }
    this.menuPlayerTag.textContent = text
  }

  // Recommended Difficulty hint - only shown once a difficulty has at
  // least MIN_RUNS_FOR_HINT runs logged (career-wide, never resets), so
  // it never guesses off a single unlucky/lucky run. Flags the current
  // difficulty specifically when its own death rate is high, nudging
  // toward Normal rather than computing a full skill rating.
  _updateRecommendedDifficultyHint() {
    if (!this.recommendedDifficultyHint) return
    const MIN_RUNS_FOR_HINT = 3
    const current = this.careerStats.difficultyStats[this.settings.difficulty]
    if (!current || current.runs < MIN_RUNS_FOR_HINT) {
      this.recommendedDifficultyHint.style.display = 'none'
      return
    }
    const deathRate = current.deaths / current.runs
    if (deathRate >= 0.8 && this.settings.difficulty !== 'easy') {
      this.recommendedDifficultyHint.textContent = t('recommendedDifficultyEasier')
      this.recommendedDifficultyHint.style.display = ''
    } else if (deathRate <= 0.2 && this.settings.difficulty !== 'apex') {
      this.recommendedDifficultyHint.textContent = t('recommendedDifficultyHarder')
      this.recommendedDifficultyHint.style.display = ''
    } else {
      this.recommendedDifficultyHint.style.display = 'none'
    }
  }

  // Season Progress - a thin bar toward the next Career Rank tier, reusing
  // CAREER_RANK_TITLES/careerStats.totalKills (already computed just above
  // for menuAvatarLevel) rather than a new XP system.
  _updateSeasonProgress() {
    if (!this.seasonProgressFill) return
    const kills = this.careerStats.totalKills
    let tierIndex = 0
    for (let i = 0; i < CAREER_RANK_TITLES.length; i++) {
      if (kills >= CAREER_RANK_TITLES[i].min) tierIndex = i
    }
    const current = CAREER_RANK_TITLES[tierIndex]
    const next = CAREER_RANK_TITLES[tierIndex + 1]
    if (!next) {
      this.seasonProgressFill.style.width = '100%'
      if (this.seasonProgressLabel) this.seasonProgressLabel.style.display = 'none'
      return
    }
    const pct = ((kills - current.min) / (next.min - current.min)) * 100
    this.seasonProgressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`
    if (this.seasonProgressLabel) {
      this.seasonProgressLabel.textContent = t('seasonProgressLabel', { n: next.min - kills, rank: t(next.titleKey) })
      this.seasonProgressLabel.style.display = ''
    }
  }

  // Login Streak badge - surfaces the existing loginStreak tracker (which
  // otherwise only ever shows once, as a one-time toast on login) as a
  // small persistent badge, same row as career-rank/prestige-badge. Only
  // shown from streak 2 onward so day-one players don't see "Streak: 1".
  _updateLoginStreakBadge() {
    if (!this.menuLoginStreak) return
    if (this.loginStreak.streak >= 2) {
      // Streak Freeze count folded into the same badge text (rather than a
      // second homepage element) - only shown when there's actually a
      // freeze banked, so it doesn't add a permanent "0" to the badge.
      this.menuLoginStreak.textContent = this.loginStreak.freezesAvailable > 0
        ? t('loginStreakBadgeWithFreeze', { n: this.loginStreak.streak, freezes: this.loginStreak.freezesAvailable })
        : t('loginStreakBadge', { n: this.loginStreak.streak })
      this.menuLoginStreak.style.display = ''
    } else {
      this.menuLoginStreak.style.display = 'none'
    }
  }

  // Completion ring (Achievements nav button, which also now covers the
  // merged-in Bestiary section) - combines both categories into one
  // unlocked/total ratio rather than the old two-ring split, since there's
  // only the one nav button left to show it on.
  _updateNavCompletionRings() {
    if (this.achievementsCompletionRing) {
      const bestiaryTotal = Object.keys(ZOMBIE_TYPES).length
      const unlocked = this.achievements.unlocked.size + this.bestiaryEncountered.size
      const total = ACHIEVEMENTS.length + bestiaryTotal
      const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0
      this.achievementsCompletionRing.style.setProperty('--pct', `${pct}%`)
      this.achievementsCompletionRing.title = t('completionRingTitle', { pct })
      if (this.achievementsNavCount) this.achievementsNavCount.textContent = `${unlocked}/${total}`
    }
    if (this.cosmeticsCompletionRing) {
      // Same cosmeticsOwned/cosmeticsTotal computation _openProfilePanel
      // already uses (outfits + hats vs the shop items that have either
      // field) - just also surfaced as a homepage nav ring, not a new
      // count.
      const owned = this.ownedOutfits.size + this.ownedHats.size
      const total = COIN_SHOP_ITEMS.filter((i) => i.outfit || i.hat).length
      const pct = total > 0 ? Math.round((owned / total) * 100) : 0
      this.cosmeticsCompletionRing.style.setProperty('--pct', `${pct}%`)
      this.cosmeticsCompletionRing.title = t('completionRingTitle', { pct })
      if (this.cosmeticsNavCount) this.cosmeticsNavCount.textContent = `${owned}/${total}`
    }
    if (this.questsCompletionRing) {
      const claimedCount = QUESTS.filter((q) => this.quests.isClaimed(q.id)).length
      const pct = Math.round((claimedCount / QUESTS.length) * 100)
      this.questsCompletionRing.style.setProperty('--pct', `${pct}%`)
      this.questsCompletionRing.title = t('completionRingTitle', { pct })
      if (this.questsNavCount) this.questsNavCount.textContent = `${claimedCount}/${QUESTS.length}`
    }
  }

  // Spotlight ticker - a single rotating hero-column line (Tip of the Day /
  // Daily Challenge reset countdown / Featured Weekly Challenge), distinct
  // from the decluttered .menu-news-ticker (see that class's own comment -
  // it stays hidden per the reference-image pass). Idempotent: safe to call
  // from _updateBestStatsDisplay repeatedly, only starts its rotation timer
  // once.
  _updateMenuSpotlight() {
    if (!this.menuSpotlight) return
    // Async data for the Global Activity / Community Poll modes below -
    // kicked off once (idempotent, same guard style as the interval start
    // further down) so the numbers are already cached by the time the
    // rotation reaches those modes, rather than fetching on every render().
    if (!this._spotlightAsyncStarted) {
      this._spotlightAsyncStarted = true
      CloudSync.fetchGlobalKills().then((n) => { this._spotlightGlobalKills = n }).catch(() => {})
      if (this._cloudUid) {
        CloudSync.fetchPollResults(POLL_ID, POLL_OPTIONS.map((o) => o.id)).then((counts) => { this._spotlightPollCounts = counts }).catch(() => {})
        // Weekly MVP - a random pick among the top 5 (not always #1, so
        // this doesn't just duplicate the weekly leaderboard's own #1
        // display elsewhere), reusing the exact fetchTopWeeklyLeaderboard
        // the Cloud Save panel's weekly leaderboard list already calls.
        CloudSync.fetchTopWeeklyLeaderboard(_thisWeekStr(), 5).then((entries) => {
          // #1 specifically cached separately from the random MVP pick
          // below - mode 24's Most Improved check needs the real #1, not
          // whichever of the top 5 got randomly chosen for the MVP line.
          if (entries.length) this._spotlightWeeklyTop1 = entries[0]
          if (entries.length) this._spotlightWeeklyMvp = entries[Math.floor(Math.random() * entries.length)]
        }).catch(() => {})
        // Head-to-head rival - same fetchNearestRivalAbove the Cloud Save
        // panel's own rival line already uses (_renderRival), just also
        // surfaced on the homepage ticker rather than only inside that
        // panel.
        CloudSync.fetchNearestRivalAbove(_safeStatNumber(this.bestStats.bestNight)).then((rival) => { this._spotlightRival = rival }).catch(() => {})
      }
    }
    const render = () => {
      const mode = (this._spotlightIndex || 0) % 28
      if (mode === 0) {
        const tipKey = SPOTLIGHT_TIPS[Math.floor(Date.now() / 60000) % SPOTLIGHT_TIPS.length]
        this.menuSpotlight.textContent = t('spotlightTipPrefix', { tip: t(tipKey) })
      } else if (mode === 1) {
        const now = new Date()
        const midnight = new Date(now)
        midnight.setHours(24, 0, 0, 0)
        const msLeft = midnight - now
        const h = Math.floor(msLeft / 3600000)
        const m = Math.floor((msLeft % 3600000) / 60000)
        this.menuSpotlight.textContent = t('spotlightDailyReset', { h, m })
      } else if (mode === 2 && this.weeklyDef) {
        this.menuSpotlight.textContent = t('spotlightWeeklyChallenge', { title: t(this.weeklyDef.titleKey), target: this.weeklyDef.target, days: _daysUntilWeekReset() })
      } else if (mode === 3) {
        // Featured Bestiary entry - day-seeded (same hash-the-date-string
        // technique DAILY_TWISTS uses) so it's stable for the whole day
        // rather than re-rolling every 6s, prioritizing an undiscovered
        // type over an already-encountered one to tease the Bestiary.
        const ids = Object.keys(ZOMBIE_TYPES)
        const undiscovered = ids.filter((id) => !this.bestiaryEncountered.has(id))
        const pool = undiscovered.length > 0 ? undiscovered : ids
        const id = pool[_dailyTwistIndex(_todayDateStr()) % pool.length]
        const zt = ZOMBIE_TYPES[id]
        this.menuSpotlight.textContent = this.bestiaryEncountered.has(id)
          ? t('spotlightBestiaryKnown', { label: zt.label })
          : t('spotlightBestiaryUnknown')
      } else if (mode === 4) {
        // Mutator Exploration nudge - day-seeded pick among mutators never
        // once started a run with (see settings.mutatorsEverEnabled,
        // recorded at Play-click time). Silently falls through to the
        // next render call's modulo if every mutator's been tried at
        // least once - nothing to nudge toward.
        const untried = Object.keys(this.settings.mutators).filter((id) => !this.settings.mutatorsEverEnabled.includes(id))
        if (untried.length > 0) {
          const id = untried[_dailyTwistIndex(_todayDateStr()) % untried.length]
          this.menuSpotlight.textContent = t('spotlightMutatorNudge', { mutator: t(MUTATOR_LABEL_KEYS[id] || id) })
        }
      } else if (mode === 5) {
        // Standalone lore/world trivia - distinct from SPOTLIGHT_TIPS
        // (mode 0), which are actionable gameplay advice; these are pure
        // flavor facts about the world, day-seeded the same way as every
        // other daily-stable pick in this rotation.
        const triviaKey = TRIVIA_FACTS[_dailyTwistIndex(_todayDateStr() + 'trivia') % TRIVIA_FACTS.length]
        this.menuSpotlight.textContent = t(triviaKey)
      } else if (mode === 6) {
        // Featured Shop Item - day-seeded pick from the real Coin Shop
        // catalog (no fake "sale"/discount - CoinShop.js has no such
        // mechanic, and inventing a fake price cut that doesn't apply at
        // checkout would be misleading).
        const item = COIN_SHOP_ITEMS[_dailyTwistIndex(_todayDateStr() + 'shop') % COIN_SHOP_ITEMS.length]
        this.menuSpotlight.textContent = t('spotlightFeaturedItem', { item: t(item.titleKey), cost: item.cost.toLocaleString() })
      } else if (mode === 7 && this._spotlightGlobalKills) {
        // Global Activity - the one real cross-player signal this game
        // tracks (stats/global.totalKills, see CloudSync.fetchGlobalKills).
        // No presence/session system exists to build a genuine "players
        // online" count from, so this stays an aggregate-kills line rather
        // than faking one.
        this.menuSpotlight.textContent = t('spotlightGlobalActivity', { n: this._spotlightGlobalKills.toLocaleString() })
      } else if (mode === 8 && this._spotlightPollCounts) {
        // Community Poll teaser - reuses the same POLL_ID/POLL_OPTIONS and
        // fetchPollResults aggregation the Cloud Save panel's full poll UI
        // already uses (see _renderPoll), just condensed to a leader-only
        // line. Only shown once signed in (fetch is gated on _cloudUid
        // above), same as the full poll widget.
        const total = Object.values(this._spotlightPollCounts).reduce((a, b) => a + b, 0)
        if (total > 0) {
          const leaderId = Object.keys(this._spotlightPollCounts).sort((a, b) => this._spotlightPollCounts[b] - this._spotlightPollCounts[a])[0]
          const leaderOpt = POLL_OPTIONS.find((o) => o.id === leaderId)
          const pct = Math.round((this._spotlightPollCounts[leaderId] / total) * 100)
          this.menuSpotlight.textContent = t('spotlightPollTeaser', { option: t(leaderOpt.labelKey), pct })
        }
      } else if (mode === 9) {
        // Patch Notes - reads the newest Credits changelog entry straight
        // from the DOM rather than duplicating it into a second data
        // source. The changelog is hand-authored static HTML (see
        // #changelog-list in index.html), not a JS array, so this stays
        // in sync with whatever's actually shown in Credits automatically.
        const latest = document.querySelector('#changelog-list .changelog-entry')
        if (latest) {
          const date = latest.querySelector('.changelog-date')?.textContent || ''
          const text = latest.querySelector('.changelog-text')?.textContent || ''
          this.menuSpotlight.textContent = t('spotlightPatchNotes', { date, text })
        }
      } else if (mode === 10) {
        // Comeback nudge - only shows once there's an actual gap to nudge
        // about (a first-ever visit has no last run yet, and a same-day
        // return has nothing meaningful to say). Silently no-ops otherwise,
        // same precedent as the Mutator Exploration nudge (mode 4).
        const last = this.runHistory[0]
        if (last && last.ts) {
          const days = Math.floor((Date.now() - _safeStatNumber(last.ts)) / 86400000)
          if (days >= 1) this.menuSpotlight.textContent = t('spotlightComebackNudge', { days })
        }
      } else if (mode === 11 && this.nemesis) {
        // Nemesis teaser - same this.nemesis the Profile panel's own
        // Nemesis stat already reads (see _recordNemesis), just surfaced
        // here too rather than only inside Profile.
        this.menuSpotlight.textContent = t('spotlightNemesisTeaser', { label: this.nemesis.label, night: this.nemesis.night })
      } else if (mode === 12) {
        const horoscopeKey = HOROSCOPES[_dailyTwistIndex(_todayDateStr() + 'horoscope') % HOROSCOPES.length]
        this.menuSpotlight.textContent = t(horoscopeKey)
      } else if (mode === 13) {
        // Almost Affordable - the cheapest item still just out of reach,
        // not the closest-by-any-metric item (a 1-coin-short legendary
        // gun is a more useful nudge than a 50-coin-short cheap skin).
        const affordableGap = COIN_SHOP_ITEMS
          .filter((i) => i.cost > this.coins)
          .sort((a, b) => a.cost - this.coins - (b.cost - this.coins))[0]
        if (affordableGap) {
          this.menuSpotlight.textContent = t('spotlightAlmostAffordable', { item: t(affordableGap.titleKey), gap: (affordableGap.cost - this.coins).toLocaleString() })
        }
      } else if (mode === 14 && this._cloudUid) {
        // Cloud sync status - same CLOUD_LAST_SYNC_KEY/_formatRelativeTime
        // the Cloud Save panel and the quick-cloud-btn tooltip already use
        // (see _renderCloudSyncStatus), just visible here too instead of
        // only on hover. Only shown when signed in.
        const last = localStorage.getItem(CLOUD_LAST_SYNC_KEY)
        this.menuSpotlight.textContent = last
          ? t('spotlightCloudSynced', { time: _formatRelativeTime(Math.max(0, Date.now() - Number(last))) })
          : t('spotlightCloudNeverSynced')
      } else if (mode === 15) {
        // Recently Unlocked - only ever pulls from achievements.unlockTimes
        // (see Achievements.js), which is forward-only tracked, so this
        // silently shows nothing (falls through, previous text stays)
        // until the player earns something new after this feature shipped.
        const recent = this.achievements.getRecentUnlocks(1)[0]
        if (recent) this.menuSpotlight.textContent = t('spotlightRecentUnlock', { name: t(recent.titleKey) })
      } else if (mode === 16 && this.runHistory.length >= 6) {
        // Win-rate trend - splits runHistory (newest-first, see
        // _recordRunEnd) into the most recent half vs the older half of
        // whatever's available, rather than requiring exactly 20 runs on
        // hand. Needs at least 6 total so each half has a meaningful size.
        const half = Math.floor(this.runHistory.length / 2)
        const recentRate = this.runHistory.slice(0, half).filter((r) => r.survived).length / half
        const olderRate = this.runHistory.slice(half, half * 2).filter((r) => r.survived).length / half
        const delta = Math.round((recentRate - olderRate) * 100)
        if (delta > 5) this.menuSpotlight.textContent = t('spotlightWinRateUp', { n: delta })
        else if (delta < -5) this.menuSpotlight.textContent = t('spotlightWinRateDown', { n: Math.abs(delta) })
        else this.menuSpotlight.textContent = t('spotlightWinRateSteady', { pct: Math.round(recentRate * 100) })
      } else if (mode === 17 && this.runHistory.length >= 3) {
        // Favorite play time - buckets runHistory timestamps into 4
        // dayparts and picks whichever has the most runs. Only meaningful
        // with a handful of runs on hand (RUN_HISTORY_MAX caps this at 25
        // recent ones anyway, so this always reflects recent habits, not
        // a lifetime average).
        const buckets = { spotlightPlayTimeMorning: 0, spotlightPlayTimeAfternoon: 0, spotlightPlayTimeEvening: 0, spotlightPlayTimeNight: 0 }
        for (const r of this.runHistory) {
          if (!r.ts) continue
          const h = new Date(r.ts).getHours()
          if (h >= 5 && h < 12) buckets.spotlightPlayTimeMorning++
          else if (h >= 12 && h < 17) buckets.spotlightPlayTimeAfternoon++
          else if (h >= 17 && h < 22) buckets.spotlightPlayTimeEvening++
          else buckets.spotlightPlayTimeNight++
        }
        const topKey = Object.keys(buckets).sort((a, b) => buckets[b] - buckets[a])[0]
        if (buckets[topKey] > 0) this.menuSpotlight.textContent = t('spotlightFavoritePlayTime', { period: t(topKey) })
      } else if (mode === 18 && this._spotlightWeeklyMvp) {
        this.menuSpotlight.textContent = t('spotlightWeeklyMvp', { name: this._spotlightWeeklyMvp.name || '???', progress: _safeStatNumber(this._spotlightWeeklyMvp.progress) })
      } else if (mode === 19 && this._spotlightRival) {
        const gap = _safeStatNumber(this._spotlightRival.bestNight) - _safeStatNumber(this.bestStats.bestNight)
        this.menuSpotlight.textContent = t('spotlightHeadToHead', { name: this._spotlightRival.name || '???', n: gap })
      } else if (mode === 20) {
        // Changelog diff - counts real .changelog-entry dates newer than
        // CHANGELOG_LAST_VIEWED_KEY (set on Credits open, see
        // _openCreditsPanel), distinct from mode 9's Patch Notes (which
        // always shows the newest entry regardless of whether it's been
        // seen). Silently no-ops if there's nothing new or no prior visit
        // recorded (a first-ever visit has nothing to diff against).
        const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
        if (lastViewed) {
          const newCount = Array.from(document.querySelectorAll('#changelog-list .changelog-entry')).filter((el) => {
            const parsed = Date.parse(el.querySelector('.changelog-date')?.textContent || '')
            return !isNaN(parsed) && parsed > lastViewed
          }).length
          if (newCount > 0) this.menuSpotlight.textContent = t('spotlightChangelogDiff', { n: newCount })
        }
      } else if (mode === 21) {
        const key = DEATH_QUOTES[_dailyTwistIndex(_todayDateStr() + 'deathquote') % DEATH_QUOTES.length]
        this.menuSpotlight.textContent = t(key)
      } else if (mode === 22) {
        const key = FUNNY_TRIVIA[_dailyTwistIndex(_todayDateStr() + 'funnytrivia') % FUNNY_TRIVIA.length]
        this.menuSpotlight.textContent = t(key)
      } else if (mode === 23) {
        // Silly title generator - a template picked by career-rank tier
        // (same CAREER_RANK_TITLES lookup _updateSeasonProgress already
        // uses) combined with the current loadout, so it changes as the
        // player actually progresses/switches builds rather than being
        // purely random noise.
        let tierIndex = 0
        for (let i = 0; i < CAREER_RANK_TITLES.length; i++) {
          if (this.careerStats.totalKills >= CAREER_RANK_TITLES[i].min) tierIndex = i
        }
        const titleKeys = ['sillyTitleTier0', 'sillyTitleTier1', 'sillyTitleTier2', 'sillyTitleTier3', 'sillyTitleTier4']
        this.menuSpotlight.textContent = t('spotlightSillyTitle', { title: t(titleKeys[tierIndex], { loadout: t(LOADOUT_LABEL_KEYS[this.settings.loadout]) }) })
      } else if (mode === 24 && this._spotlightWeeklyTop1 && this.settings.nickname) {
        // Most Improved badge on your own tag - the weekly leaderboard's
        // #1 entry already effectively means "most improved this week"
        // (same reasoning as the existing weekly-leaderboard label per
        // CLAUDE.md) - checks the real #1 (cached separately above, not
        // the randomly-picked Weekly MVP), reusing the same
        // fetchTopWeeklyLeaderboard call rather than a second fetch.
        if (this._spotlightWeeklyTop1.name === this.settings.nickname) {
          this.menuSpotlight.textContent = t('spotlightMostImproved')
        }
      } else if (mode === 25) {
        // Session uptime - reuses _sessionStartTime (already tracked for
        // the "Today" session-stats line, see _renderTodayLine), not a
        // second timestamp.
        const totalSeconds = Math.floor((performance.now() - this._sessionStartTime) / 1000)
        const mins = Math.floor(totalSeconds / 60)
        const secs = totalSeconds % 60
        this.menuSpotlight.textContent = t('spotlightSessionUptime', { time: `${mins}:${String(secs).padStart(2, '0')}` })
      } else if (mode === 26) {
        // On This Day - genuinely checks today's real month+day against
        // every changelog entry's own date (parsed straight from the DOM,
        // same source _updateMenuSpotlight's Patch Notes mode already
        // reads), not a random pick dressed up as a historical match. Only
        // shows when there's an actual match, same silent-skip precedent
        // mode 24's Most Improved check already uses.
        const today = new Date()
        for (const el of document.querySelectorAll('#changelog-list .changelog-entry')) {
          const parsed = new Date(el.querySelector('.changelog-date')?.textContent || '')
          if (Number.isNaN(parsed.getTime())) continue
          if (parsed.getMonth() === today.getMonth() && parsed.getDate() === today.getDate() && parsed.getFullYear() < today.getFullYear()) {
            this.menuSpotlight.textContent = t('spotlightOnThisDay', { years: today.getFullYear() - parsed.getFullYear(), text: el.querySelector('.changelog-text')?.textContent || '' })
            break
          }
        }
      } else if (mode === 27) {
        // Joke Tip - day-seeded like every other flavor-array mode, see
        // JOKE_TIPS' own comment on why this stays separate from
        // SPOTLIGHT_TIPS.
        const key = JOKE_TIPS[_dailyTwistIndex(_todayDateStr() + 'joketip') % JOKE_TIPS.length]
        this.menuSpotlight.textContent = t(key)
      }
      this._spotlightIndex = (this._spotlightIndex || 0) + 1
    }
    render()
    if (this._spotlightIntervalStarted) return
    this._spotlightIntervalStarted = true
    setInterval(() => { if (!this._spotlightPaused) render() }, 6000)
  }

  // Seasonal Event Banner - display:none year-round outside a defined date
  // window (see EVENT_BANNERS), so it costs zero homepage real estate most
  // of the year. Doesn't touch #menu-bg-photo itself (see CLAUDE.md's note
  // on the reverted live-3D-background attempt - anything near that
  // element needs care).
  _updateEventBanner() {
    if (!this.eventBanner) return
    const now = new Date()
    const active = EVENT_BANNERS.find((ev) => now.getMonth() === ev.month && now.getDate() >= ev.startDay && now.getDate() <= ev.endDay)
    if (!active) {
      this.eventBanner.style.display = 'none'
      return
    }
    this.eventBanner.textContent = t(active.key)
    this.eventBanner.style.display = ''
  }

  // Weekly Challenge visual progress bar - the homepage ticker's own
  // Weekly Challenge mode only ever showed the target + days-left as
  // text (see mode 2 in _updateMenuSpotlight); this reads the real
  // in-progress count (this.weeklyChallenge.progress, incremented per
  // qualifying kill by _checkWeeklyChallengeProgress) into an actual bar.
  _updateWeeklyProgressBar() {
    if (!this.weeklyProgressTrack) return
    if (!this.weeklyDef || !this.weeklyChallenge) {
      this.weeklyProgressTrack.style.display = 'none'
      return
    }
    const pct = Math.min(100, (_safeStatNumber(this.weeklyChallenge.progress) / Math.max(1, this.weeklyDef.target)) * 100)
    this.weeklyProgressFill.style.width = `${pct}%`
    this.weeklyProgressTrack.style.display = ''
  }

  // Kill-count milestone toast - fires once per threshold, ever, tracked
  // in localStorage so it survives across sessions but never repeats.
  _checkKillMilestones() {
    let seen
    try { seen = JSON.parse(localStorage.getItem(KILL_MILESTONES_SEEN_KEY)) || [] } catch { seen = [] }
    const kills = _safeStatNumber(this.careerStats.totalKills)
    for (const m of KILL_MILESTONES) {
      if (kills >= m && !seen.includes(m)) {
        seen.push(m)
        this._showHomepageToast(t('milestoneKillsToast', { n: m.toLocaleString() }))
        localStorage.setItem(KILL_MILESTONES_SEEN_KEY, JSON.stringify(seen))
        break // one toast per render call, in case multiple thresholds were crossed at once (e.g. imported save)
      }
    }
  }

  // Homepage Background Mood (Settings panel) - 'auto' follows the same
  // EVENT_BANNERS date windows as the banner above (falling back to no
  // filter outside any window), any other settings.bgMood value is an
  // explicit user override that always wins regardless of date. Applies
  // via a class on <html>, matching the large-text-mode/high-contrast-mode
  // convention, so it's a single CSS filter swap - no new DOM elements.
  _applyBgMood() {
    let mood = this.settings.bgMood
    if (mood === 'auto') {
      const now = new Date()
      const active = EVENT_BANNERS.find((ev) => now.getMonth() === ev.month && now.getDate() >= ev.startDay && now.getDate() <= ev.endDay)
      mood = active ? active.bgMood : 'none'
    } else if (mood === 'timeofday') {
      // Reuses the same 3 existing tint classes (no new art) mapped to the
      // player's real local hour rather than a fixed/seasonal schedule -
      // late night keeps the default night-photo look as-is since there's
      // no separate daytime photo asset to switch to.
      const hour = new Date().getHours()
      if (hour >= 5 && hour < 8) mood = 'foggy'
      else if (hour >= 8 && hour < 17) mood = 'amber'
      else if (hour >= 17 && hour < 22) mood = 'bloodmoon'
      else mood = 'none'
    }
    for (const cls of ['bg-mood-bloodmoon', 'bg-mood-foggy', 'bg-mood-amber']) {
      document.documentElement.classList.remove(cls)
    }
    if (mood !== 'none') document.documentElement.classList.add(`bg-mood-${mood}`)
  }

  // What's New badge dot - a small red dot on the Credits nav button until
  // the player has actually opened Credits at least once since
  // WHATS_NEW_VERSION last changed (bump that constant on future updates).
  _updateWhatsNewDot() {
    if (!this.whatsNewDot) return
    this.whatsNewDot.style.display = localStorage.getItem(WHATS_NEW_SEEN_KEY) === WHATS_NEW_VERSION ? 'none' : ''
  }

  // How to Play - a replayable, interactive step-through overlay, distinct
  // from _maybeShowTutorialHints (a one-time, non-interactive toast
  // sequence that still runs independently the first time a run starts).
  _openHowToPlayPanel() {
    this.howtoplayPanel.style.display = 'flex'
    this.howtoplayPanelTitle.textContent = t('howtoplayPanelTitle')
    this._howtoplayStep = 0
    this._renderHowToPlayStep()
  }

  _closeHowToPlayPanel() {
    this.howtoplayPanel.style.display = 'none'
  }

  _renderHowToPlayStep() {
    const keys = HOWTOPLAY_STEPS
    this.howtoplayStepContent.innerHTML = tHtml(keys[this._howtoplayStep])
    this.howtoplayDots.innerHTML = ''
    for (let i = 0; i < keys.length; i++) {
      const dot = document.createElement('span')
      dot.className = 'howtoplay-dot' + (i === this._howtoplayStep ? ' active' : '')
      this.howtoplayDots.appendChild(dot)
    }
    this.howtoplayBackBtn.style.visibility = this._howtoplayStep === 0 ? 'hidden' : 'visible'
    this.howtoplayNextBtn.textContent = this._howtoplayStep === keys.length - 1 ? t('howtoplayDoneBtn') : t('howtoplayNextBtn')
  }

  // Continue card - Play Again replays the exact class/difficulty/companion
  // combo the last recorded run used (see _recordRunEnd's runHistory entry),
  // by clicking the real menu buttons rather than duplicating their apply
  // logic. Share copies a short text recap of that same run.
  _playAgainFromLastRun() {
    const last = this.runHistory[0]
    if (!last) return
    if (last.difficulty) {
      const btn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === last.difficulty)
      if (btn && btn.style.display !== 'none') btn.click()
    }
    if (last.loadout) {
      const btn = Array.from(this.loadoutBtns).find((b) => b.dataset.loadout === last.loadout)
      if (btn) btn.click()
    }
    if (last.companionRole) {
      const btn = Array.from(this.roleBtns).find((b) => b.dataset.role === last.companionRole)
      if (btn) btn.click()
    }
    if (this.playBtn) this.playBtn.click()
  }

  _shareLastRun() {
    const last = this.runHistory[0]
    if (!last) return
    const text = t(last.survived ? 'shareLastRunSurvived' : 'shareLastRunDied', { night: _safeStatNumber(last.night), kills: _safeStatNumber(last.kills), coins: _safeStatNumber(last.coins) })
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => this._showLoreToast(t('shareCopiedToast'))).catch(() => {})
    }
  }

  // Screenshot Gallery (Profile panel) - the existing screenshot tool only
  // ever downloads/copies to clipboard (see CLAUDE.md's duplicate-audit),
  // never keeps anything retrievable in-app. This stores a small downscaled
  // thumbnail (not the full-res capture, to keep localStorage cheap)
  // alongside every save, capped to the last 3.
  _pushGalleryThumbnail(fullDataUrl) {
    try {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = Math.round((160 * img.height) / img.width)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const thumb = canvas.toDataURL('image/jpeg', 0.7)
        const gallery = _loadScreenshotGallery()
        gallery.unshift(thumb)
        _saveScreenshotGallery(gallery.slice(0, 3))
        this._renderScreenshotGallery()
      }
      img.src = fullDataUrl
    } catch {
      // Best-effort only - a failed thumbnail never blocks the actual save/copy.
    }
  }

  _renderScreenshotGallery() {
    const gallery = _loadScreenshotGallery()
    if (this.profileGalleryTitle) this.profileGalleryTitle.style.display = gallery.length ? '' : 'none'
    // Homepage preview strip (see #menu-screenshot-gallery) mirrors the same
    // gallery array - kept at display:none whenever empty (most players,
    // most of the time) so it costs zero homepage space until earned.
    if (this.menuScreenshotGallery) this.menuScreenshotGallery.style.display = gallery.length ? '' : 'none'
    for (const el of [this.profileScreenshotGallery, this.menuScreenshotGallery]) {
      if (!el) continue
      el.innerHTML = ''
      for (const thumb of gallery) {
        const img = document.createElement('img')
        img.src = thumb
        img.alt = t('galleryThumbnailAlt')
        el.appendChild(img)
      }
    }
  }

  // Homepage batch - every quick-action/one-shot listener that isn't
  // already covered by an existing _bindX() method (difficulty/loadout/
  // role buttons keep their own _bindDifficulty/_bindLoadout/
  // _bindCompanionRole - Play Again/preset load click those same real
  // buttons rather than duplicating their apply logic).
  _bindHomepageBatch() {
    if (this.playAgainBtn) this.playAgainBtn.addEventListener('click', () => this._playAgainFromLastRun())
    if (this.shareLastRunBtn) this.shareLastRunBtn.addEventListener('click', () => this._shareLastRun())
    // Reuses _generateCareerPortrait() as-is (see its own comment - it
    // already composites a styled stat-card image, not a plain
    // screenshot). The Profile panel's own button stays gated behind
    // true_ending; this homepage shortcut uses the same lower bar as
    // Play Again/Share above it (any completed run at all), since a
    // shareable stat card is reasonable to want well before the true
    // ending.
    if (this.shareCardBtn) this.shareCardBtn.addEventListener('click', () => this._generateCareerPortrait())
    if (this.savePresetBtn) this.savePresetBtn.addEventListener('click', () => MenuPresets.saveMenuPreset(this))
    if (this.surpriseMeBtn) this.surpriseMeBtn.addEventListener('click', () => MenuPresets.surpriseMe(this))
    if (this.quickKeybindsBtn) {
      this.quickKeybindsBtn.addEventListener('click', () => {
        this._toggleSettings(true)
        document.getElementById('tab-controls')?.click()
      })
    }
    if (this.buildModeBtn) this.buildModeBtn.addEventListener('click', () => this._enterBuildMode())
    const buildExitBtn = document.getElementById('build-mode-exit-btn')
    if (buildExitBtn) buildExitBtn.addEventListener('click', () => this._exitBuildMode())
    const buildSaveBtn = document.getElementById('build-mode-save-btn')
    if (buildSaveBtn) buildSaveBtn.addEventListener('click', () => this.buildMode.save())
    MenuPresets.renderMenuPresets(this)
    MenuEasterEggs.bindAll(this)
    window.addEventListener('online', () => CloudSaveUI.updateOnlineStatus(this))
    window.addEventListener('offline', () => CloudSaveUI.updateOnlineStatus(this))
    if (this.shortcutCheatsheetCloseBtn) {
      this.shortcutCheatsheetCloseBtn.addEventListener('click', () => { this.shortcutCheatsheet.style.display = 'none' })
    }

    if (this.profileBioInput) {
      this.profileBioInput.addEventListener('input', () => {
        this.settings.bio = this.profileBioInput.value.slice(0, 250)
        if (this.profileBioInput.value.length > 250) this.profileBioInput.value = this.settings.bio
        saveSettings(this.settings)
        this._renderProfileBioCounter()
      })
    }

    if (this.bioPresetSaveBtn) {
      this.bioPresetSaveBtn.addEventListener('click', () => {
        if (!this.settings.bio) return
        if (this.settings.bioPresets.includes(this.settings.bio)) return
        if (this.settings.bioPresets.length >= 3) this.settings.bioPresets.shift()
        this.settings.bioPresets.push(this.settings.bio)
        saveSettings(this.settings)
        this._renderBioPresets()
      })
    }

    if (this.quickMuteBtn) {
      this.quickMuteBtn.classList.toggle('active', !!this.settings.mutedBeforeVolumes)
      this.quickMuteBtn.addEventListener('click', () => {
        if (this.settings.mutedBeforeVolumes) {
          this.settings.musicVolume = this.settings.mutedBeforeVolumes.music
          this.settings.sfxVolume = this.settings.mutedBeforeVolumes.sfx
          this.settings.mutedBeforeVolumes = null
        } else {
          this.settings.mutedBeforeVolumes = { music: this.settings.musicVolume, sfx: this.settings.sfxVolume }
          this.settings.musicVolume = 0
          this.settings.sfxVolume = 0
        }
        audioEngine.setMusicVolume(this.settings.musicVolume / 100)
        audioEngine.setSfxVolume(this.settings.sfxVolume / 100)
        if (this.musicVolumeSlider) { this.musicVolumeSlider.value = this.settings.musicVolume; this.musicVolumeValue.textContent = `${this.settings.musicVolume}%` }
        if (this.sfxVolumeSlider) { this.sfxVolumeSlider.value = this.settings.sfxVolume; this.sfxVolumeValue.textContent = `${this.settings.sfxVolume}%` }
        saveSettings(this.settings)
        this.quickMuteBtn.classList.toggle('active', !!this.settings.mutedBeforeVolumes)
      })
    }

    if (this.quickColorblindBtn) {
      this.quickColorblindBtn.classList.toggle('active', this.settings.colorblind)
      this.quickColorblindBtn.addEventListener('click', () => {
        this.settings.colorblind = !this.settings.colorblind
        setColorblind(this.settings.colorblind)
        if (this.colorblindToggle) this.colorblindToggle.checked = this.settings.colorblind
        saveSettings(this.settings)
        this.quickColorblindBtn.classList.toggle('active', this.settings.colorblind)
      })
    }

    if (this.quickPerformanceBtn) {
      this.quickPerformanceBtn.classList.toggle('active', this.settings.performanceMode)
      this.quickPerformanceBtn.addEventListener('click', () => {
        this.settings.performanceMode = !this.settings.performanceMode
        this._applyPerformanceMode(this.settings.performanceMode)
        if (this.performanceToggle) this.performanceToggle.checked = this.settings.performanceMode
        saveSettings(this.settings)
        this.quickPerformanceBtn.classList.toggle('active', this.settings.performanceMode)
      })
    }

    // Quick Language toggle - flips between English and settings.
    // quickLanguageAlt (the most recent non-English language picked via
    // the full grid in Settings, see _bindSettings' language-btn handler)
    // rather than cycling all 20 LANGUAGES one at a time, and rather than
    // just reopening Settings (which already defaults to the Language tab
    // - a second icon doing the exact same thing would be a pure duplicate).
    if (this.quickLanguageBtn) {
      this.quickLanguageBtn.addEventListener('click', () => {
        const next = this.settings.language === 'en' ? this.settings.quickLanguageAlt : 'en'
        this.settings.language = next
        saveSettings(this.settings)
        setLanguage(next)
        this._applyLanguage()
        if (this.languageGrid) {
          for (const el of this.languageGrid.querySelectorAll('.language-btn')) {
            el.classList.toggle('active', el.dataset.lang === next)
          }
        }
      })
    }

    if (this.howtoplayBtn) this.howtoplayBtn.addEventListener('click', () => this._openHowToPlayPanel())
    if (this.howtoplayNextBtn) {
      this.howtoplayNextBtn.addEventListener('click', () => {
        if (this._howtoplayStep < HOWTOPLAY_STEPS.length - 1) { this._howtoplayStep++; this._renderHowToPlayStep() }
        else this._closeHowToPlayPanel()
      })
    }
    if (this.howtoplayBackBtn) {
      this.howtoplayBackBtn.addEventListener('click', () => {
        if (this._howtoplayStep > 0) { this._howtoplayStep--; this._renderHowToPlayStep() }
      })
    }
    if (this.howtoplayCloseBtn) this.howtoplayCloseBtn.addEventListener('click', () => this._closeHowToPlayPanel())
    if (this.howtoplayPanel) {
      this.howtoplayPanel.addEventListener('click', (e) => {
        if (e.target === this.howtoplayPanel) this._closeHowToPlayPanel()
      })
    }

    this._renderScreenshotGallery()
    this._updateEventBanner()
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
        mutator: t(MUTATOR_LABEL_KEYS[mutatorKey]),
        coins: WEEKLY_FEATURED_MUTATOR_BONUS_COINS,
      })
    }
    this._updatePlayBtnCentering()
  }

  // Decides whether #play-btn can go dead-center in the viewport (see its
  // .play-btn-centered rule in style.css) without overlapping the hero
  // column's own content. Can't be a fixed CSS breakpoint: the news
  // ticker/weekly mutator lines above are variable-length text, so how
  // much clearance actually exists shifts with them - this measures the
  // real gap between the hero column's true end (with play-btn briefly
  // popped out of flow) and the game-mode cards row below it, live.
  // Uses #settings-btn (not #controls-list/#round-mode-hint, both
  // display:none now that the instructional text was removed from the
  // visible menu) as the "last visible hero element" reference - a
  // display:none element's getBoundingClientRect() is always all-zero,
  // which would silently make this measurement meaningless.
  _updatePlayBtnCentering() {
    const settingsBtn = document.getElementById('settings-btn')
    const cardsRow = document.getElementById('menu-cards-row')
    if (!this.playBtn || !settingsBtn || !cardsRow) return

    this.playBtn.classList.remove('play-btn-centered')
    const btnHeight = this.playBtn.getBoundingClientRect().height

    const prevDisplay = this.playBtn.style.display
    this.playBtn.style.display = 'none'
    const safeTop = settingsBtn.getBoundingClientRect().bottom
    this.playBtn.style.display = prevDisplay

    const safeBottom = cardsRow.getBoundingClientRect().top
    const centerY = window.innerHeight / 2
    const margin = 20
    const fits = (centerY - btnHeight / 2) > (safeTop + margin) && (centerY + btnHeight / 2) < (safeBottom - margin)

    this.playBtn.classList.toggle('play-btn-centered', fits)
  }

  // Local leaderboard - see loadLeaderboard's own doc comment for how this
  // differs from bestStats above. Called once per run end (death or
  // dawn-survival) from _onPlayerDeath/the survive-to-dawn path.
  _recordLeaderboardEntry() {
    this.leaderboard.push({ night: this.night, kills: this.kills, points: this.points, date: Date.now() })
    this.leaderboard.sort((a, b) => (b.night - a.night) || (b.kills - a.kills) || (b.points - a.points))
    this.leaderboard = this.leaderboard.slice(0, LEADERBOARD_MAX_ENTRIES)
    saveLeaderboard(this.leaderboard)

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
      .map((e, i) => `<div class="leaderboard-row"><span>#${i + 1}</span><span>${t('hudNight', { n: _safeStatNumber(e.night) })}</span><span>${t('hudKills', { n: _safeStatNumber(e.kills) })}</span></div>`)
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
    // e.name is player-entered text (the nickname field) - escaped rather
    // than interpolated raw, same as every other player-entered string
    // this method now touches for nickname-color support. night/kills go
    // through _safeStatNumber for the same reason (see its own comment).
    const rows = this.hardcoreMemorial
      .map((e) => `<div class="leaderboard-row"><span class="nickname-tag">${_escapeHtml(e.name)}</span><span>${t('hudNight', { n: _safeStatNumber(e.night) })}</span><span>${t('hudKills', { n: _safeStatNumber(e.kills) })}</span></div>`)
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
    this._updatePlayBtnCentering()
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
    // Parry (see _triggerParry/PARRY_WINDOW_MS) - a successful parry both
    // heavily reduces this hit AND staggers back whichever zombie is
    // nearest (the same "nearest as attacker proxy" this codebase already
    // uses for the threat indicator/Nemesis, since the exact attacker
    // isn't threaded through this callback).
    if (this._parryActiveUntil && performance.now() < this._parryActiveUntil) {
      this._parryActiveUntil = 0
      damage *= 1 - PARRY_DAMAGE_REDUCTION
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
      if (nearest) nearest.stun(PARRY_STAGGER_MS)
      this._showLoreToast(t('parrySuccess'))
    }
    if (this.shieldActive) damage *= 1 - SHIELD_DAMAGE_REDUCTION
    this.playerState.takeDamage(damage * this.difficulty.damageMult * this.dailyDamageMult)
    this._updateHealthHud()
    audioEngine.playZombieSnarl()
    audioEngine.playPlayerHurt()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.12, 220)
    // Graphics tab's Damage Indicator toggle - only gates this automatic
    // on-hit trigger, not the separate on-demand "ping nearest threat"
    // accessibility key (_pingNearestThreat also calls
    // _showThreatIndicator directly) - turning this off shouldn't remove
    // the player's ability to manually check for nearby threats.
    if (this.settings.damageIndicatorEnabled) this._showThreatIndicator()

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
    if (!this.settings.showHitFeedback) return
    // Graphics tab's own Damage Numbers toggle - independent from (ANDs
    // with) showHitFeedback above, which still controls the hitmarker
    // flash too (see WeaponSystem._showHitmarker) - this just adds a
    // second, separate way to turn off the numbers specifically.
    if (!this.settings.damageNumbersEnabled) return
    this._damageNumberVec.set(x, y, z).project(this.camera)
    if (this._damageNumberVec.z > 1) return // behind the camera
    const sx = (this._damageNumberVec.x * 0.5 + 0.5) * window.innerWidth
    const sy = (-this._damageNumberVec.y * 0.5 + 0.5) * window.innerHeight
    // Pooled DOM node (see the constructor's _damageNumberPool) instead of
    // createElement/remove per hit - a minigun spray was creating and
    // tearing down dozens of DOM nodes a second. Reusing one means
    // restarting its CSS animation explicitly (the "none, reflow, clear"
    // trick) rather than relying on class-add to trigger it fresh.
    const el = this._damageNumberPool[this._damageNumberPoolIndex]
    this._damageNumberPoolIndex = (this._damageNumberPoolIndex + 1) % this._damageNumberPool.length
    el.className = isHeadshot ? 'damage-number headshot' : 'damage-number'
    el.textContent = String(damage)
    el.style.left = `${sx}px`
    el.style.top = `${sy}px`
    el.style.display = ''
    el.style.animation = 'none'
    void el.offsetWidth
    el.style.animation = ''
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
      // Fall damage (see FALL_DAMAGE_MIN_IMPACT's own comment) - same
      // takeDamage/HUD/flash/last-stand sequence every other damage
      // source in this file already follows (see e.g. the hazard-zone
      // tick damage above).
      if (impact < FALL_DAMAGE_MIN_IMPACT && this.playerState.alive && !this.player.isDodging) {
        const severity = Math.min(1, (impact - FALL_DAMAGE_MIN_IMPACT) / (FALL_DAMAGE_MAX_IMPACT - FALL_DAMAGE_MIN_IMPACT))
        let damage = severity * FALL_DAMAGE_MAX
        if (this.player.isCrouching) damage *= FALL_DAMAGE_ROLL_MULT
        this.playerState.takeDamage(damage)
        this._updateHealthHud()
        this.damageFlash.classList.remove('hit')
        void this.damageFlash.offsetWidth
        this.damageFlash.classList.add('hit')
        if (!this.playerState.alive) this._maybeLastStandOrDie()
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

  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering = false, isGolden = false, wasFleeing = false) {
    if (this.settings.bloodEffectsEnabled) this.decals.spawnPuddle(x, z)
    if (weaponId === 'melee') this._spawnMeleeKillFlash(x, z)
    // Golden Zombie bonus (see _maybeSpawnGoldenZombie) - on top of, not
    // instead of, every other reward this kill already earns below.
    if (isGolden) {
      this.coins += GOLDEN_ZOMBIE_COIN_BONUS
      this._showCoinPopup(GOLDEN_ZOMBIE_COIN_BONUS)
      this._showLoreToast(t('goldenZombieJackpot', { n: GOLDEN_ZOMBIE_COIN_BONUS }))
    }
    // Caught the last, fleeing zombie of a Round Mode wave (see
    // _checkRoundModeSpecialEvents) - a small capstone bonus/flavor line
    // for finishing what would otherwise have gotten away.
    if (wasFleeing) this._showLoreToast(t('caughtFleeingZombie'))
    this.rollingQuests.recordKill()
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
    const lootMult = (this.settings.mutators.lootRush ? 2 : 1) * this.difficulty.lootMult * (this.perfectWeather ? PERFECT_WEATHER_LOOT_BONUS_MULT : 1)
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
    // Kill Feed (see _pushKillFeed) - one entry per kill at most, picked by
    // priority (boss > big combo > elite > melee) so a kill that qualifies
    // for several categories at once doesn't spam multiple stacked entries.
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      this._pushKillFeed('BOSS DOWN')
      this._flagHighlightMoment('Boss down')
    } else if (this.comboCount >= COMBO_TIER3_THRESHOLD) {
      this._pushKillFeed(`${this.comboCount}x COMBO`)
      this._flagHighlightMoment(`${this.comboCount}x combo`)
    } else if (isElite) {
      this._pushKillFeed('Elite eliminated')
    } else if (weaponId === 'melee') {
      this._pushKillFeed('Melee finish')
    }
    // Industrial Siren bonus (Interactive World batch, see
    // _pullSirenLever) - applied here so the popup itself already reflects
    // the boosted total, same "multiply before display" approach
    // doublePointsMult above already uses for points.
    if (this.sirenLootBonusUntil && performance.now() < this.sirenLootBonusUntil) {
      coinsEarned = Math.round(coinsEarned * SIREN_BONUS_LOOT_MULT)
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
      // Heirloom forge (Long-Term Goals batch) - auto-granted the instant a
      // weapon reaches Grandmaster, no confirmation needed: purely cosmetic
      // (no stat tradeoff to weigh, unlike Prestige/Respec), and this fires
      // mid-combat from a kill where a blocking window.confirm() would
      // freeze the game at the worst moment. Melee excluded - same "doesn't
      // read as a gun cosmetically" reasoning CoinShop's setSkinAllGuns
      // already applies to every other skin system.
      // Combined into ONE toast rather than a separate one right after the
      // Grandmaster toast below - two _showLoreToast calls in the same
      // synchronous tick would silently clobber each other (shared
      // single-element toast, see this project's own documented gotcha).
      if (!w.melee) {
        this.weaponMastery.heirlooms.add(weaponId)
        this.weapons.setWeaponSkin(weaponId, 'heirloom')
        this._showLoreToast(t('toastWeaponGrandmasteredHeirloom', { weapon: t(this.weapons._nameKeyFor(w)) }))
      } else {
        this._showLoreToast(t('toastWeaponGrandmastered', { weapon: t(this.weapons._nameKeyFor(w)) }))
      }
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
    // State changes (skin unlock, trophy wall) happen immediately, same as
    // before - only the visual toast display itself is queued below, so an
    // unlock is never delayed, just its notification.
    if (def.id === 'centurion') this.weapons.setWeaponSkin('pistol', 'gold')
    this._updateTrophyWall()
    // The live game world (zombies, weather) keeps simulating behind the
    // menu before Play is ever clicked (see main.js) - no gameplay toast
    // should actually reach the screen before then, even if whatever
    // triggered this fired anyway.
    if (!this.gameStarted) return
    this._achievementToastQueue.push(def)
    this._drainAchievementToastQueue()
  }

  // Achievement toast queue (see _achievementToastQueue's own comment) -
  // shows one at a time so two simultaneous unlocks (e.g. the completionist
  // auto-cascade) each get their own visible moment on the shared toast
  // element instead of the first silently getting clobbered by the second.
  _drainAchievementToastQueue() {
    if (this._achievementToastShowing || this._achievementToastQueue.length === 0) return
    this._achievementToastShowing = true
    const def = this._achievementToastQueue.shift()
    this.achievementLabel.textContent = t('achievementUnlocked')
    this.achievementTitle.textContent = t(def.titleKey)
    this.achievementToast.classList.remove('show')
    void this.achievementToast.offsetWidth
    this.achievementToast.classList.add('show')
    setTimeout(() => {
      this._achievementToastShowing = false
      this._drainAchievementToastQueue()
    }, ACHIEVEMENT_TOAST_GAP_MS)
  }

  // Credits & What's New panel - static prose, not a data-driven list like
  // achievements/bestiary, so this just sets textContent once rather than
  // building rows.
  _openCreditsPanel() {
    this.creditsPanel.style.display = 'flex'
    this.creditsPanelTitle.textContent = t('creditsPanelTitle')
    if (this.buildVersionLine) this.buildVersionLine.textContent = t('buildVersionLine', { hash: __BUILD_HASH__, date: __BUILD_DATE__ })
    if (this.buildSessionIdLine) this.buildSessionIdLine.textContent = t('sessionIdLine', { id: this._sessionId })
    if (this.diagnosticsHeading) this.diagnosticsHeading.textContent = t('diagnosticsHeading')
    if (this.diagnosticsLine) this.diagnosticsLine.textContent = this._buildDiagnosticsText()
    // What's New badge dot - clears the moment the player actually reads
    // this panel, not just on page load, so it stays a genuine "have you
    // seen this" indicator rather than a permanent decoration.
    try { localStorage.setItem(WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION) } catch { /* storage unavailable */ }
    // Separate from WHATS_NEW_SEEN_KEY above (that's a single version
    // string gating the nav-button dot) - this is an actual timestamp, so
    // the homepage ticker's "X updates since your last visit" mode (see
    // _updateMenuSpotlight) can diff real changelog entry dates against
    // it, not just know "has the dot been cleared."
    try { localStorage.setItem(CHANGELOG_LAST_VIEWED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
    this._updateWhatsNewDot()
  }

  _closeCreditsPanel() {
    this.creditsPanel.style.display = 'none'
  }

  // First-time tutorial hint sequence - a one-time (localStorage-gated)
  // chained sequence, distinct from the always-visible static menu-subhint
  // text. Only ever runs once per browser/profile.
  _maybeShowTutorialHints() {
    if (localStorage.getItem(TUTORIAL_SEEN_KEY)) return
    const lines = ['tutorialHint1', 'tutorialHint2', 'tutorialHint3', 'tutorialHint4']
    lines.forEach((key, i) => {
      setTimeout(() => {
        // Build Mode is a separate standalone sandbox (see BuildMode.js's
        // own comment) that doesn't set gameStarted, so the usual
        // "if (!this.gameStarted) return" guard this codebase uses for
        // homepage-only toasts wouldn't catch it - a delayed hint firing
        // while the player has since entered Build Mode would otherwise
        // render on top of that completely different canvas.
        if (this.buildMode.active) return
        this.tutorialHintEl.innerHTML = tHtml(key)
        this.tutorialHintEl.classList.remove('show')
        void this.tutorialHintEl.offsetWidth
        this.tutorialHintEl.classList.add('show')
      }, TUTORIAL_HINT_START_DELAY_MS + i * TUTORIAL_HINT_INTERVAL_MS)
    })
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, 'true')
    } catch {
      // Storage unavailable - the sequence just might show again next time.
    }
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
    // The live game world (zombies, weather, the auto perf-mode FPS check
    // in _tick) keeps running behind the menu before Play is clicked (see
    // main.js) - without this, a passive background check like that one
    // could pop a gameplay toast over the main menu.
    if (!this.gameStarted) return
    this._renderLoreToast(text)
  }

  // Homepage-safe variant - same toast element/animation as _showLoreToast
  // above, deliberately WITHOUT its gameStarted guard, for toasts that are
  // themselves genuinely about the homepage (kill milestones, the Beat
  // This challenge-link comparison) rather than a background gameplay
  // system that shouldn't be allowed to surprise-pop over the menu. The
  // guard's own reasoning doesn't apply here since these calls only ever
  // originate from homepage-specific code paths.
  _showHomepageToast(text) {
    this._renderLoreToast(text)
  }

  _renderLoreToast(text) {
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
  // record (bestStats, career totals, Veteran Perks) the same way. `survived`
  // distinguishes the two for Run History's result column (see below).
  _recordRunEnd(survived) {
    // Guest Mode (Local Sharing batch) - this entire method is exactly
    // "update a persistent/lifetime record" (bestStats, careerStats,
    // runHistory, milestones, companionLegacy, the local leaderboard), so
    // skipping it wholesale is the correct behavior, not a shortcut - a
    // guest run genuinely shouldn't move any of these numbers.
    if (this.settings.guestMode) return
    // Guest Mode already gates the whole method above (same "guest runs
    // don't move persistent records" reasoning applies here too, since
    // claiming a rolling quest grants real coins).
    this.rollingQuests.recordRunComplete()
    let improved = false
    if (this.night > this.bestStats.bestNight) {
      this.bestStats.bestNight = this.night
      improved = true
      // Best-Run Pace Comparison baseline (see _checkBestRunPace) - only
      // ever overwritten on an actual new record, so the projection always
      // reflects the single best-ever run, not just the most recent one.
      this.bestRunPace = { night: this.night, elapsedMs: performance.now() - this.runStartedAt }
      saveBestRunPace(this.bestRunPace)
    }
    if (this.kills > this.bestStats.bestKills) { this.bestStats.bestKills = this.kills; improved = true }
    if (this.peakKillStreakThisRun > this.bestStats.bestKillStreak) {
      this.bestStats.bestKillStreak = this.peakKillStreakThisRun
      this.bestStats.bestKillStreakDate = todayDateString()
      improved = true
    }
    if (improved) {
      saveBestStats(this.bestStats)
      // Confetti burst - armed here, actually fired the next time
      // _updateBestStatsDisplay runs with gameStarted false (i.e. once
      // the menu is genuinely showing again, not this same synchronous
      // call which still fires mid-run right as the record is set).
      this._pendingConfetti = true
      this._updateBestStatsDisplay()
    }
    this._recordLeaderboardEntry()

    this._sessionKills += this.kills
    this.careerStats.totalKills += this.kills
    this.careerStats.totalRuns += 1
    if (!this.careerStats.firstPlayedDate) this.careerStats.firstPlayedDate = todayDateString()
    // Most-used mutator (Profile panel) - one increment per active mutator
    // per completed run, same settings.mutators flags the Coin Shop/Play
    // button already read, no separate tracking.
    for (const [id, active] of Object.entries(this.settings.mutators)) {
      if (active) this.careerStats.mutatorUseCounts[id] = (this.careerStats.mutatorUseCounts[id] || 0) + 1
    }
    for (const perk of VETERAN_PERKS) {
      if (this.careerStats.totalKills >= perk.killThreshold && !this.careerStats.veteranPerksGranted.includes(perk.id)) {
        this.careerStats.veteranPerksGranted.push(perk.id)
        this._showLoreToast(t('veteranPerkToast', { rank: t(careerRankTitleKey(this.careerStats.totalKills)) }))
      }
    }

    // Run History Log - one capped entry per completed run (see
    // RUN_HISTORY_KEY's own comment). difficulty/loadout/companionRole
    // captured alongside (Homepage batch) so a "Play Again" action can
    // restore the exact setup this run used, not just show its stats.
    this.runHistory.unshift({
      night: this.night, kills: this.kills, coins: this.coins, survived: !!survived,
      prestige: this.metaProgress.prestigeLevel, ts: Date.now(),
      difficulty: this.settings.difficulty, loadout: this.settings.loadout, companionRole: this.settings.companionRole,
    })
    this.runHistory = this.runHistory.slice(0, RUN_HISTORY_MAX)
    saveRunHistory(this.runHistory)

    // Homepage batch - lifetime deaths (K/D ratio) and per-difficulty
    // run/death tallies (Recommended Difficulty hint). Deaths is every
    // non-survived run; DIFFICULTY_PRESETS keys are the same ids
    // settings.difficulty already uses everywhere else.
    if (!survived) this.careerStats.totalDeaths += 1
    const diffId = this.settings.difficulty
    if (!this.careerStats.difficultyStats[diffId]) this.careerStats.difficultyStats[diffId] = { runs: 0, deaths: 0 }
    this.careerStats.difficultyStats[diffId].runs += 1
    if (!survived) this.careerStats.difficultyStats[diffId].deaths += 1

    // Lifetime Playtime/Distance/Coins-Earned/Flawless-Runs (Long-Term Goals
    // batch) - each a new cumulative axis on careerStats, checked against
    // its own milestone ladder the same way Veteran Perks checks kills above.
    this.careerStats.lifetimePlaytimeSeconds += (performance.now() - this.runStartedAt) / 1000
    this.careerStats.lifetimeDistanceMeters += this._runDistanceTraveled
    this.careerStats.lifetimeCoinsEarned += Math.max(0, this.coins - this._runStartCoins)
    if (!Number.isFinite(this.lowestHealthThisRun)) this.careerStats.flawlessRunCount += 1
    // Most Profitable Run (Profile panel) - a single-run coin delta, same
    // Math.max(0, ...) clamp lifetimeCoinsEarned above already uses (a
    // run that ended with fewer coins than it started, e.g. after a big
    // Coin Shop purchase mid-run, shouldn't count as negative profit).
    this.careerStats.mostProfitableRun = Math.max(this.careerStats.mostProfitableRun, Math.max(0, this.coins - this._runStartCoins))
    // Favorite companion role (Profile panel) - one increment per
    // completed run, same pattern as mutatorUseCounts above.
    const roleId = this.settings.companionRole
    this.careerStats.companionRoleUseCounts[roleId] = (this.careerStats.companionRoleUseCounts[roleId] || 0) + 1

    for (const m of PLAYTIME_MILESTONES) {
      if (this.careerStats.lifetimePlaytimeSeconds >= m.seconds && !this.careerStats.playtimeMilestonesGranted.includes(m.id)) {
        this.careerStats.playtimeMilestonesGranted.push(m.id)
        this.coins += m.rewardCoins
        this._showLoreToast(t('playtimeMilestoneToast', { hours: Math.round(m.seconds / 3600), coins: m.rewardCoins }))
      }
    }
    for (const m of DISTANCE_MILESTONES) {
      if (this.careerStats.lifetimeDistanceMeters >= m.meters && !this.careerStats.distanceMilestonesGranted.includes(m.id)) {
        this.careerStats.distanceMilestonesGranted.push(m.id)
        this.coins += m.rewardCoins
        this._showLoreToast(t('distanceMilestoneToast', { km: Math.round(m.meters / 1000), coins: m.rewardCoins }))
      }
    }
    for (const m of FLAWLESS_MILESTONES) {
      if (this.careerStats.flawlessRunCount >= m.count && !this.careerStats.flawlessMilestonesGranted.includes(m.id)) {
        this.careerStats.flawlessMilestonesGranted.push(m.id)
        this.coins += m.rewardCoins
        this._showLoreToast(t('flawlessMilestoneToast', { n: m.count, coins: m.rewardCoins }))
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

    this._captureChallengeHandoff()

    // Cloud Save auto-sync - best-effort, only if already signed in (never
    // prompts here; a mid-game consent popup would be jarring). See
    // pushToCloud's own comment on why manual=false swallows errors.
    CloudSaveUI.pushToCloud(this, false)
    this._pushOnlineStats()
  }

  _onPlayerDeath() {
    // Shareable run-summary card (see _generateRunSummaryCard) - captures
    // the actual moment-of-death frame before any HUD teardown/UI change,
    // same composer.render()+toDataURL technique _takeScreenshot uses.
    this.composer.render()
    this._runCardBaseImage = this.canvas.toDataURL('image/png')
    // Death Killcam (see DEATH_KILLCAM_DURATION_MS's own comment) - reuses
    // the boss/wave-clear slow-mo mechanism, timed to cover the death cam's
    // held beat below.
    this.killcamUntil = performance.now() + DEATH_KILLCAM_DURATION_MS
    this._recordDeathMemorial()
    this._recordNemesis()
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
    if (this._isForceHardcore()) {
      this._recordHardcoreMemorial()
    }

    this._recordRunEnd(false)

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
      this._recordDailyLeaderboardEntry(score)
    } else {
      this.deathDaily.style.display = 'none'
    }

    this.respawnBtn.textContent = this._isForceHardcore() ? t('newAttemptBtn') : t('respawnBtn')

    // Death cam: a beat of the frozen, shaking scene before the UI slams
    // in, instead of the death screen appearing instantly - gameplay is
    // already paused by this.playerState.alive being false, so this is
    // just holding the reveal, not simulating extra time passing.
    this._triggerShake(0.28, 450)
    setTimeout(() => {
      this.deathScreen.style.display = 'flex'
    }, DEATH_CAM_MS)
  }

  // Best-Run Pace Comparison (see BEST_RUN_PACE_KEY's own comment) - a
  // linear projection from the single best-ever run's elapsed-time/night
  // ratio, compared against this run's actual elapsed time at the same
  // night. An estimate (no per-night history is stored), not a
  // frame-accurate replay comparison.
  _checkBestRunPace() {
    if (!this.bestRunPace || this.bestRunPace.night <= 0) return
    const projectedMs = (this.bestRunPace.elapsedMs / this.bestRunPace.night) * this.night
    const actualMs = performance.now() - this.runStartedAt
    const diffS = Math.round(Math.abs(projectedMs - actualMs) / 1000)
    if (diffS === 0) return
    if (actualMs < projectedMs) this._showLoreToast(t('paceAhead', { n: this.night, s: diffS }))
    else this._showLoreToast(t('paceBehind', { n: this.night, s: diffS }))
  }

  // Death-location memorial markers (see DEATH_MEMORIALS_KEY's own
  // comment) - records the current death and immediately adds its own
  // marker mesh too, so a same-session respawn already sees it without
  // needing a fresh page load.
  _recordDeathMemorial() {
    const pos = this.player.controls.object.position
    this.deathMemorials.unshift({ x: pos.x, z: pos.z })
    this.deathMemorials = this.deathMemorials.slice(0, DEATH_MEMORIALS_MAX)
    saveDeathMemorials(this.deathMemorials)
    this._addDeathMemorialMesh(pos.x, pos.z)
  }

  // Called once at construction to draw every persisted entry.
  _spawnDeathMemorials() {
    for (const m of this.deathMemorials) this._addDeathMemorialMesh(m.x, m.z)
  }

  // Small dark cross, added straight to the scene (never passed through
  // World.js's register()) so old death spots never block a path or show
  // up in a raycast - purely a visual "you fell here before" marker.
  _addDeathMemorialMesh(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a })
    const group = new THREE.Group()
    const vertical = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), mat)
    vertical.position.y = 0.25
    group.add(vertical)
    const horizontal = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.06), mat)
    horizontal.position.y = 0.36
    group.add(horizontal)
    group.position.set(x, 0, z)
    group.rotation.y = Math.random() * Math.PI * 2
    this.scene.add(group)
  }

  // Shareable run-summary card - composites the moment-of-death frame
  // (_runCardBaseImage, captured in _onPlayerDeath) with a stat overlay,
  // distinct from the manual mid-game screenshot/crop tool (_takeScreenshot).
  _generateRunSummaryCard() {
    if (!this._runCardBaseImage) return
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 450
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(0, canvas.height - 110, canvas.width, 110)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 28px sans-serif'
      ctx.fillText(`Night ${this.night} · ${this.kills} kills`, 24, canvas.height - 66)
      ctx.font = '20px sans-serif'
      ctx.fillText(`${formatTime(performance.now() - this.runStartedAt)} survived · Grade ${this._computeRunGrade()}`, 24, canvas.height - 34)
      ctx.textAlign = 'right'
      ctx.font = 'bold 22px sans-serif'
      ctx.fillText('GayZ', canvas.width - 24, canvas.height - 34)
      ctx.textAlign = 'left'

      const link = document.createElement('a')
      link.download = `gayz-run-${Date.now()}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
      this._showLoreToast(t('runCardSaved'))
    }
    img.src = this._runCardBaseImage
  }

  // Kill Feed (see KILL_FEED_MAX_ENTRIES/_MS) - a multiplayer-style stacked
  // strip of notable kills, purely presentational; each entry removes
  // itself on its own timer instead of needing a manual clear.
  _pushKillFeed(text) {
    // Same reasoning as _showLoreToast - the game world simulates behind
    // the menu before Play is clicked, so nothing should actually reach
    // the screen yet.
    if (!this.gameStarted) return
    const entry = document.createElement('div')
    entry.className = 'kill-feed-entry'
    const nickname = this.settings.nickname.trim()
    entry.innerHTML = nickname
      ? `<span class="nickname-tag">${_escapeHtml(nickname)}</span> ${_escapeHtml(text)}`
      : _escapeHtml(text)
    this.killFeedEl.appendChild(entry)
    while (this.killFeedEl.children.length > KILL_FEED_MAX_ENTRIES) {
      this.killFeedEl.removeChild(this.killFeedEl.firstChild)
    }
    setTimeout(() => {
      if (entry.parentNode === this.killFeedEl) this.killFeedEl.removeChild(entry)
    }, KILL_FEED_ENTRY_MS)
  }

  // Taunt (see TAUNT_ALERT_RADIUS/_COOLDOWN_MS/_LINES) - a free,
  // player-initiated shout that alerts every unaware zombie in a wide
  // radius, reusing the same aware-flip _alertNearbyZombiesToGunfire
  // already does, just with its own bigger radius and no gunshot required.
  _triggerTaunt() {
    const now = performance.now()
    if (now < this._lastTauntAt + TAUNT_COOLDOWN_MS) return
    this._lastTauntAt = now
    audioEngine.playHorn()
    const playerPos = this.player.controls.object.position
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive' || z.aware) continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d <= TAUNT_ALERT_RADIUS) z.aware = true
    }
    const line = TAUNT_LINES[Math.floor(Math.random() * TAUNT_LINES.length)]
    this.tauntTextEl.textContent = line
    this.tauntTextEl.classList.remove('show')
    void this.tauntTextEl.offsetWidth
    this.tauntTextEl.classList.add('show')
  }

  // Local Profile screen - read-only aggregation of stats already
  // persisted elsewhere (careerStats/bestStats/achievements/prestige/
  // nemesis), no new tracking of its own besides the Nemesis record.
  _openProfilePanel() {
    this.profilePanel.style.display = 'flex'
    this.profilePanelTitle.textContent = t('profilePanelTitle')
    if (this.profileCopyStatsBtn) this.profileCopyStatsBtn.textContent = t('profileCopyStatsBtn')
    if (this.profilePrintBtn) this.profilePrintBtn.textContent = t('profilePrintBtn')
    // Cosmetics counter - outfits+hats only (charms are randomly equipped
    // one at a time via field pickups, see WeaponSystem.equipCharm, with no
    // persistent "owned charms" set to count against).
    const cosmeticsOwned = this.ownedOutfits.size + this.ownedHats.size
    const cosmeticsTotal = COIN_SHOP_ITEMS.filter((i) => i.outfit || i.hat).length

    // Hall of Records - a single completion % averaging 4 existing
    // collection ratios (achievements/bestiary/cosmetics/weapon grandmaster)
    // into one number none of those systems compute on their own. Checked
    // here at display time, same "purely derived, no new tracking" pattern
    // the prestigeUnlocked toggle in _renderUpgradesOptions already uses.
    const totalGuns = this.weapons.weapons.filter((w) => !w.melee).length
    const completionRatios = [
      this.achievements.unlocked.size / ACHIEVEMENTS.length,
      this.bestiaryEncountered.size / Object.values(ZOMBIE_TYPES).length,
      cosmeticsTotal > 0 ? cosmeticsOwned / cosmeticsTotal : 0,
      totalGuns > 0 ? this.weaponMastery.grandmastered.size / totalGuns : 0,
    ]
    const completionPct = Math.round((completionRatios.reduce((a, b) => a + b, 0) / completionRatios.length) * 100)
    if (completionPct >= 100 && !this.careerStats.hallOfRecordsClaimed) {
      this.careerStats.hallOfRecordsClaimed = true
      saveCareerStats(this.careerStats)
      this.coins += HALL_OF_RECORDS_REWARD_COINS
      this._showLoreToast(t('hallOfRecordsToast', { coins: HALL_OF_RECORDS_REWARD_COINS }))
    }

    // _safeStatNumber on every plain-numeric field, _escapeHtml on the 2
    // computed-string ones (nemesis label, favorite weapon's unmatched-id
    // fallback) - every field in this grid ultimately traces back to
    // localStorage, all of which Import Save (Local Sharing batch) lets an
    // uploaded file overwrite wholesale, so none of it can be trusted to
    // already be the right type by the time it reaches this render.
    // Each row now carries a stable id (the i18n key itself, language-
    // independent) as its first element - Pin a Stat (see
    // _renderPinnedStatSelect) needs something durable to store in
    // settings.pinnedStat, and a translated label isn't stable across a
    // language switch.
    let rows = [
      ['profileTotalRuns', t('profileTotalRuns'), _safeStatNumber(this.careerStats.totalRuns)],
      ['profileTotalKills', t('profileTotalKills'), _safeStatNumber(this.careerStats.totalKills)],
      ['profileBestNight', t('profileBestNight'), _safeStatNumber(this.bestStats.bestNight)],
      ['profileBestKills', t('profileBestKills'), _safeStatNumber(this.bestStats.bestKills)],
      ['profileBestKillStreak', t('profileBestKillStreak'), _safeStatNumber(this.bestStats.bestKillStreak)],
      ['profileAchievements', t('profileAchievements'), `${this.achievements.unlocked.size}/${ACHIEVEMENTS.length}`],
      ['profileCosmetics', t('profileCosmetics'), `${cosmeticsOwned}/${cosmeticsTotal}`],
      ['profilePrestige', t('profilePrestige'), _safeStatNumber(this.metaProgress.prestigeLevel)],
      ['profileNemesisLabel', t('profileNemesisLabel'), this.nemesis ? t('profileNemesisValue', { name: _escapeHtml(this.nemesis.label), n: _safeStatNumber(this.nemesis.night) }) : t('profileNemesisNone')],
      ['profileSecretsFound', t('profileSecretsFound'), _safeStatNumber(this.secretsProgress.cachesDug) + (this.secretsProgress.easterEggSeen ? 1 : 0)],
      ['profileNetWorth', t('profileNetWorth'), _safeStatNumber(this.coins) + _safeStatNumber(this.points) + _safeStatNumber(this.metaProgress.legacyPoints)],
      ['profileTotalSpent', t('profileTotalSpent'), _safeStatNumber(this.totalSpent)],
      // Long-Term Goals batch additions below.
      ['profileCompletionPct', t('profileCompletionPct'), `${completionPct}%`],
      ['profilePlaytime', t('profilePlaytime'), `${Math.floor(_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 3600)}h`],
      ['profileDistance', t('profileDistance'), `${(_safeStatNumber(this.careerStats.lifetimeDistanceMeters) / 1000).toFixed(1)}km`],
      ['profileFlawlessRuns', t('profileFlawlessRuns'), _safeStatNumber(this.careerStats.flawlessRunCount)],
      // Career Almanac - derived favorite-weapon/avg-night/win-rate view,
      // same "pure display, zero new tracking" reasoning as completionPct
      // above, just reading weaponMastery.kills and bestStats instead.
      ['profileFavoriteWeapon', t('profileFavoriteWeapon'), _escapeHtml(this._favoriteWeaponLabel())],
      ['profileWinRate', t('profileWinRate'), this.runHistory.length > 0 ? `${Math.round((this.runHistory.filter((r) => r.survived).length / this.runHistory.length) * 100)}%` : '—'],
      // 100-features batch - 4 more pure-derived rows, same "zero new
      // tracking" reasoning as completionPct/Career Almanac above.
      ['profileKillsPerMin', t('profileKillsPerMin'), _safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) > 0
        ? (_safeStatNumber(this.careerStats.totalKills) / (_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 60)).toFixed(1)
        : '—'],
      ['profileCoinsRatio', t('profileCoinsRatio'), `${_safeStatNumber(this.careerStats.lifetimeCoinsEarned).toLocaleString()} / ${_safeStatNumber(this.totalSpent).toLocaleString()}`],
      ['profileWeaponsMastered', t('profileWeaponsMastered'), `${this.weaponMastery.mastered.size + this.weaponMastery.grandmastered.size}/${this.weapons.weapons.length}`],
      ['profileCompanionLegacy', t('profileCompanionLegacy'), _safeStatNumber(this.companionLegacy.level)],
      // More-features batch - 5 more pure-derived rows (Personal Stats),
      // same "zero new tracking beyond what _recordRunEnd/_recordNemesis
      // already aggregate" reasoning as every row above.
      ['profileLongestSession', t('profileLongestSession'), _formatDurationShort(_safeStatNumber(this.careerStats.longestSessionSeconds))],
      ['profileAvgRunLength', t('profileAvgRunLength'), _safeStatNumber(this.careerStats.totalRuns) > 0
        ? _formatDurationShort(Math.round(_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / this.careerStats.totalRuns))
        : '—'],
      ['profileDeadliestEnemy', t('profileDeadliestEnemy'), _escapeHtml(this._deadliestZombieLabel())],
      ['profileMostUsedMutator', t('profileMostUsedMutator'), _escapeHtml(this._mostUsedMutatorLabel())],
      ['profileCoinsToday', t('profileCoinsToday'), `${_safeStatNumber(this._coinsToday()).toLocaleString()} (${t('profileCoinsWeeklyAvg', { n: _safeStatNumber(this._coinsWeeklyAvg()).toLocaleString() })})`],
      // Reuses loginStreak.previousDate (see _checkLoginStreak) - the
      // calendar date of the visit before this one, not today's own date
      // (which lastDate always reflects by the time this panel can open).
      ['profileLastPlayed', t('profileLastPlayed'), this.loginStreak.previousDate || t('profileLastPlayedFirstVisit')],
      // Third features batch - Stats & Data group.
      ['profileDamageDealt', t('profileDamageDealt'), Math.round(_safeStatNumber(this.careerStats.lifetimeDamageDealt)).toLocaleString()],
      ['profileAccuracy', t('profileAccuracy'), _safeStatNumber(this.careerStats.shotsFired) > 0
        ? `${Math.round((_safeStatNumber(this.careerStats.shotsHit) / _safeStatNumber(this.careerStats.shotsFired)) * 100)}%`
        : '—'],
      ['profileBestStreakDate', t('profileBestStreakDate'), this.bestStats.bestKillStreakDate || '—'],
      ['profileTimesRevivedCompanion', t('profileTimesRevivedCompanion'), _safeStatNumber(this.careerStats.timesRevivedCompanion)],
      ['profileMostProfitableRun', t('profileMostProfitableRun'), _safeStatNumber(this.careerStats.mostProfitableRun).toLocaleString()],
      // MAP_LAP_METERS below is the real perimeter of World.js's 750x750
      // play area (see addPerimeterBarricade's groundSize param), not an
      // arbitrary made-up "lap" length.
      ['profileLaps', t('profileLaps'), (_safeStatNumber(this.careerStats.lifetimeDistanceMeters) / MAP_LAP_METERS).toFixed(1)],
      ['profileFavoriteCompanionRole', t('profileFavoriteCompanionRole'), this._favoriteCompanionRoleLabel()],
      ['profileFavoriteDayOfWeek', t('profileFavoriteDayOfWeek'), this._favoriteDayOfWeekLabel()],
      ['profilePlayClicks', t('profilePlayClicks'), _safeStatNumber(this.careerStats.playButtonClicks).toLocaleString()],
    ]
    this._renderPinnedStatSelect(rows)
    // Pinned stat (if any) is pulled out and rendered first, same "always
    // the very first thing in the panel" position it already had before
    // grouping existed - it stays a single ungrouped row up top rather
    // than getting its own heading or appearing a second time inside its
    // normal category below.
    let pinnedRow = null
    if (this.settings.pinnedStat) {
      const pinnedIndex = rows.findIndex((r) => r[0] === this.settings.pinnedStat)
      if (pinnedIndex >= 0) {
        pinnedRow = rows[pinnedIndex]
        rows = [...rows.slice(0, pinnedIndex), ...rows.slice(pinnedIndex + 1)]
      }
    }
    const rowButton = ([, label, value]) => `
      <button class="perk-option" disabled>
        <span class="perk-name">${label}</span>
        <span class="perk-cost">${value}</span>
      </button>
    `
    const grouped = PROFILE_GROUP_ORDER.map(([groupId, labelKey]) => [
      labelKey,
      rows.filter((r) => (PROFILE_STAT_GROUPS[r[0]] || 'socialMeta') === groupId),
    ]).filter(([, groupRows]) => groupRows.length > 0)
    this.profileOptions.innerHTML =
      (pinnedRow ? rowButton(pinnedRow) : '') +
      grouped.map(([labelKey, groupRows]) => `
        <h3 class="settings-section-heading">${t(labelKey)}</h3>
        ${groupRows.map(rowButton).join('')}
      `).join('')
    this._animateStatCountUp()

    // Career Portrait - gated the same as Prestige (see _renderUpgradesOptions),
    // "beaten the game" being the bar for a capstone memento worth keeping.
    if (this.profileCareerPortraitBtn) {
      this.profileCareerPortraitBtn.style.display = this.achievements.unlocked.has('true_ending') ? 'block' : 'none'
      this.profileCareerPortraitBtn.textContent = t('profileCareerPortraitBtn')
    }

    this._renderProfileAvatarPicker()
    this._renderProfileBio()
    this._renderProfileAccountRow()
    this._updateBestStatsDisplay()
    this._renderNearlyThereNudge()
    this._renderWeeklyRecap()
    this._renderAnniversaryLine()
    this._renderProfileCreated()
    this._renderTodayLine()
    this._renderPercentileLine()
    this._renderFavoriteDifficultyLine()
    this._renderBestRunCard()
    this._renderRankRoadmap()
    this._renderClassComparison()
    this._renderGoalsPicker()
    this._renderGoalsChecklist()
    this._renderHighlightReel()
    this._renderRecentUnlocksStrip()
    this._renderPrestigeHistory()
  }

  // Recently Unlocked strip (Profile panel) - a persistent list, not just
  // the ticker's single rotating line (mode 15 in _updateMenuSpotlight,
  // see its own comment) - same getRecentUnlocks(n) data source, just n=5
  // here instead of 1.
  _renderRecentUnlocksStrip() {
    if (!this.recentUnlocksList) return
    if (this.recentUnlocksHeading) this.recentUnlocksHeading.textContent = t('recentUnlocksHeading')
    const recent = this.achievements.getRecentUnlocks(5)
    this.recentUnlocksList.innerHTML = recent.length
      ? recent.map((ach) => `<button class="perk-option" disabled><span class="perk-name">${t(ach.titleKey)}</span></button>`).join('')
      : `<p class="nearly-there-line">${t('recentUnlocksEmpty')}</p>`
  }

  // Prestige History Log (Profile panel) - forward-only, see
  // metaProgress.prestigeHistory's own comment. Hidden entirely (not just
  // empty) for players who have never prestiged, same show/hide pattern
  // Weekly Recap's own title/line pair already uses.
  _renderPrestigeHistory() {
    if (!this.prestigeHistoryList) return
    if (!this.metaProgress.prestigeHistory.length) {
      if (this.prestigeHistoryHeading) this.prestigeHistoryHeading.style.display = 'none'
      this.prestigeHistoryList.style.display = 'none'
      return
    }
    if (this.prestigeHistoryHeading) {
      this.prestigeHistoryHeading.style.display = ''
      this.prestigeHistoryHeading.textContent = t('prestigeHistoryHeading')
    }
    this.prestigeHistoryList.style.display = ''
    this.prestigeHistoryList.innerHTML = [...this.metaProgress.prestigeHistory].reverse().map((entry) => `
      <p class="nearly-there-line">${_escapeHtml(t('prestigeHistoryLine', { level: entry.level, date: new Date(entry.ts).toLocaleDateString() }))}</p>
    `).join('')
  }

  // Highlight Reel - auto-picks the 3 most impressive numbers from a
  // curated candidate list, ranked by value/benchmark ratio (not just
  // raw magnitude, which would always favor whichever stat happens to
  // use the smallest unit). "Benchmark" is a round, clearly-labeled
  // reference point for each stat (not a hidden fabricated threshold),
  // shown alongside the value so the ranking is legible, not mysterious.
  _renderHighlightReel() {
    if (!this.highlightReelList) return
    if (this.highlightReelHeading) this.highlightReelHeading.textContent = t('highlightReelHeading')
    const candidates = [
      { labelKey: 'profileTotalKills', value: _safeStatNumber(this.careerStats.totalKills), benchmark: 5000 },
      { labelKey: 'profileDamageDealt', value: _safeStatNumber(this.careerStats.lifetimeDamageDealt), benchmark: 500000 },
      { labelKey: 'profileDistance', value: _safeStatNumber(this.careerStats.lifetimeDistanceMeters) / 1000, benchmark: 50 },
      { labelKey: 'profilePlaytime', value: Math.floor(_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 3600), benchmark: 20 },
      { labelKey: 'profileBestKillStreak', value: _safeStatNumber(this.bestStats.bestKillStreak), benchmark: 30 },
      { labelKey: 'profileTotalRuns', value: _safeStatNumber(this.careerStats.totalRuns), benchmark: 100 },
      { labelKey: 'profileMostProfitableRun', value: _safeStatNumber(this.careerStats.mostProfitableRun), benchmark: 5000 },
    ]
    const top3 = candidates
      .filter((c) => c.value > 0)
      .sort((a, b) => (b.value / b.benchmark) - (a.value / a.benchmark))
      .slice(0, 3)
    this.highlightReelList.innerHTML = top3.length
      ? top3.map((c) => `
          <button class="perk-option" disabled>
            <span class="perk-name">${t(c.labelKey)}</span>
            <span class="perk-cost">${Math.round(c.value).toLocaleString()}</span>
          </button>
        `).join('')
      : `<p class="nearly-there-line">${t('highlightReelEmpty')}</p>`
  }

  // Goals picker - toggleable chips, one per GOAL_CANDIDATES entry, capped
  // at 3 selected (oldest bumped on a 4th pick, same "cap and shift"
  // precedent settings.savedFriends/menuPresets already use).
  _renderGoalsPicker() {
    if (!this.goalsPicker) return
    if (this.goalsHeading) this.goalsHeading.textContent = t('goalsHeading')
    this.goalsPicker.innerHTML = GOAL_CANDIDATES.map((goal) => `
      <button class="goal-chip${this.settings.selectedGoals.includes(goal.id) ? ' active' : ''}" data-goal="${goal.id}">${t(goal.titleKey)}</button>
    `).join('')
    for (const btn of this.goalsPicker.querySelectorAll('.goal-chip')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.goal
        if (this.settings.selectedGoals.includes(id)) {
          this.settings.selectedGoals = this.settings.selectedGoals.filter((g) => g !== id)
        } else {
          if (this.settings.selectedGoals.length >= 3) this.settings.selectedGoals.shift()
          this.settings.selectedGoals.push(id)
        }
        saveSettings(this.settings)
        this._renderGoalsPicker()
        this._renderGoalsChecklist()
      })
    }
  }

  _renderGoalsChecklist() {
    if (!this.goalsChecklist) return
    this.goalsChecklist.innerHTML = this.settings.selectedGoals.map((id) => {
      const goal = GOAL_CANDIDATES.find((g) => g.id === id)
      if (!goal) return ''
      const total = goal.total(this)
      const current = Math.min(goal.current(this), total)
      const pct = total > 0 ? Math.round((current / total) * 100) : 0
      return `
        <div class="nearly-there-item">
          <p class="nearly-there-line">${_escapeHtml(t('goalProgressLine', { title: t(goal.titleKey), current: current.toLocaleString(), total: total.toLocaleString() }))}${pct >= 100 ? ` ${t('goalCompleteBadge')}` : ''}</p>
          <div class="mini-progress-track" aria-hidden="true"><div class="mini-progress-fill" style="width: ${pct}%"></div></div>
        </div>
      `
    }).join('') || `<p class="nearly-there-line">${t('goalsEmpty')}</p>`
  }

  // Rank Roadmap - all CAREER_RANK_TITLES tiers at once (the homepage/
  // spotlight ticker only ever shows the CURRENT tier one at a time), with
  // the reached ones checked off and the current one highlighted, so a
  // player can see the whole ladder rather than just where they stand
  // right now.
  _renderRankRoadmap() {
    if (!this.rankRoadmapList) return
    if (this.rankRoadmapHeading) this.rankRoadmapHeading.textContent = t('rankRoadmapHeading')
    const kills = _safeStatNumber(this.careerStats.totalKills)
    this.rankRoadmapList.innerHTML = CAREER_RANK_TITLES.map((tier, i) => {
      const reached = kills >= tier.min
      const isCurrent = reached && (i === CAREER_RANK_TITLES.length - 1 || kills < CAREER_RANK_TITLES[i + 1].min)
      return `
        <button class="perk-option${isCurrent ? ' active' : ''}" disabled>
          <span class="perk-name">${reached ? '✓ ' : ''}${t(tier.titleKey)}</span>
          <span class="perk-cost">${t('rankRoadmapThreshold', { n: tier.min.toLocaleString() })}</span>
        </button>
      `
    }).join('')
  }

  // Class Comparison - the real, honest per-loadout stat deltas from
  // LOADOUT_PRESETS (moveSpeedDelta/maxHealthMult/maxStaminaDelta), the
  // exact same numbers _applyLoadout uses, not a separately-hand-written
  // description that could drift out of sync with what the class actually
  // does.
  _renderClassComparison() {
    if (!this.classComparisonTable) return
    if (this.classComparisonHeading) this.classComparisonHeading.textContent = t('classComparisonHeading')
    this.classComparisonTable.innerHTML = Object.entries(LOADOUT_PRESETS).map(([id, preset]) => `
      <button class="perk-option" disabled>
        <span class="perk-name">${t(LOADOUT_LABEL_KEYS[id])}</span>
        <span class="perk-cost">${t('classComparisonLine', {
          speed: preset.moveSpeedDelta > 0 ? `+${preset.moveSpeedDelta}` : preset.moveSpeedDelta,
          health: Math.round(preset.maxHealthMult * 100),
          stamina: preset.maxStaminaDelta > 0 ? `+${preset.maxStaminaDelta}` : preset.maxStaminaDelta,
        })}</span>
      </button>
    `).join('')
  }

  // Avatar picker - two preset portraits (male/female) the player can pick
  // instead of/on top of the signed-in Google photo. Clicking the already-
  // active preset toggles it off (falls back to the Google photo or the
  // generic hooded-figure SVG, same precedence _updateCloudQuickIcon uses).
  _renderProfileAvatarPicker() {
    if (!this.profileAvatarRow) return
    if (this.profileAvatarHeading) this.profileAvatarHeading.textContent = t('profileAvatarHeading')
    const options = [
      { id: 'male', src: '/images/avatar-male.png' },
      { id: 'female', src: '/images/avatar-female.png' },
    ]
    this.profileAvatarRow.innerHTML = options.map((o) => `
      <button class="avatar-swatch${this.settings.avatarChoice === o.id ? ' active' : ''}" data-avatar="${o.id}" aria-label="${o.id}">
        <img src="${o.src}" alt="" />
      </button>
    `).join('')
    for (const btn of this.profileAvatarRow.querySelectorAll('.avatar-swatch')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.avatar
        this.settings.avatarChoice = this.settings.avatarChoice === id ? null : id
        saveSettings(this.settings)
        this._renderProfileAvatarPicker()
        CloudSaveUI.updateCloudQuickIcon(this, !!this._cloudProfile)
      })
    }
  }

  // Profile bio - free text, capped at 250 chars (enforced both by the
  // textarea's own maxlength and here, since a paste can exceed maxlength).
  _renderProfileBio() {
    if (!this.profileBioInput) return
    if (this.profileBioHeading) this.profileBioHeading.textContent = t('profileBioHeading')
    this.profileBioInput.placeholder = t('profileBioPlaceholder')
    this.profileBioInput.value = this.settings.bio || ''
    this._renderProfileBioCounter()
    this._renderBioPresets()
  }

  // Bio Presets - up to 3 saved bio strings, switchable via chips (same
  // "cap at 3, oldest bumped" pattern as menuPresets/savedFriends), so
  // switching between a couple of go-to bios doesn't mean retyping.
  _renderBioPresets() {
    if (!this.bioPresetChips) return
    this.bioPresetChips.innerHTML = this.settings.bioPresets.map((preset, i) => `
      <span class="preset-chip" data-index="${i}">${_escapeHtml(preset.slice(0, 20))}${preset.length > 20 ? '…' : ''}<span class="saved-friend-remove" data-remove="${i}">×</span></span>
    `).join('')
    for (const chip of this.bioPresetChips.querySelectorAll('.preset-chip')) {
      chip.addEventListener('click', (e) => {
        const removeIndex = e.target.dataset.remove
        if (removeIndex !== undefined) {
          this.settings.bioPresets.splice(Number(removeIndex), 1)
          saveSettings(this.settings)
          this._renderBioPresets()
          return
        }
        this.settings.bio = this.settings.bioPresets[Number(chip.dataset.index)]
        saveSettings(this.settings)
        this._renderProfileBio()
      })
    }
  }

  _renderProfileBioCounter() {
    if (!this.profileBioCounter) return
    this.profileBioCounter.textContent = `${(this.settings.bio || '').length}/250`
  }

  // "Today" session stats - _sessionKills/_sessionStartTime are
  // session-local only (see constructor), never persisted, distinct from
  // careerStats' lifetime totals shown elsewhere in this same panel.
  _renderTodayLine() {
    if (!this.profileTodayLine) return
    const minutes = Math.round((performance.now() - this._sessionStartTime) / 60000)
    this.profileTodayLine.textContent = t('todayLine', { kills: this._sessionKills, minutes })
    this.profileTodayLine.style.display = ''
  }

  // Longest single session (Profile panel) - compares the CURRENT
  // session's running length (same _sessionStartTime the Today line above
  // already reads) against the stored record every time this fires
  // (menu refresh + beforeunload below), so the record is accurate even
  // if the tab is just closed mid-session rather than ever returning to
  // the menu again.
  _updateLongestSession() {
    const currentSeconds = Math.floor((performance.now() - this._sessionStartTime) / 1000)
    if (currentSeconds > this.careerStats.longestSessionSeconds) {
      this.careerStats.longestSessionSeconds = currentSeconds
      saveCareerStats(this.careerStats)
    }
  }

  // Percentile - reuses the same "better than me" COUNT query as the
  // rank badge, plus one more COUNT (no filter) for the total player
  // count, rather than a separate ranking system. Only shown once
  // signed in (needs a real leaderboard entry to rank against).
  async _renderPercentileLine() {
    if (!this.profilePercentileLine || !this._cloudUid) {
      if (this.profilePercentileLine) this.profilePercentileLine.style.display = 'none'
      return
    }
    try {
      const [rank, total] = await Promise.all([
        CloudSync.fetchMyGlobalRank(_safeStatNumber(this.bestStats.bestNight)),
        CloudSync.fetchLeaderboardTotalCount(),
      ])
      if (total <= 0) {
        this.profilePercentileLine.style.display = 'none'
        return
      }
      const percentile = Math.max(1, Math.round((rank / total) * 100))
      this.profilePercentileLine.textContent = t('percentileLine', { pct: percentile })
      this.profilePercentileLine.style.display = ''
      // Visual bar - fills to (100 - percentile) so "top 5%" reads as a
      // 95%-full bar (better-than-X-percent-of-players), not a nearly-
      // empty one.
      if (this.profilePercentileBar) {
        this.profilePercentileBar.style.display = ''
        this.profilePercentileBar.querySelector('.mini-progress-fill').style.width = `${100 - percentile}%`
      }
    } catch {
      this.profilePercentileLine.style.display = 'none'
      if (this.profilePercentileBar) this.profilePercentileBar.style.display = 'none'
    }
  }

  _renderFavoriteDifficultyLine() {
    if (!this.profileFavoriteDifficultyLine) return
    const entries = Object.entries(this.careerStats.difficultyStats)
    if (entries.length === 0) {
      this.profileFavoriteDifficultyLine.style.display = 'none'
      return
    }
    const [favoriteId] = entries.reduce((best, cur) => (cur[1].runs > best[1].runs ? cur : best))
    const btn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === favoriteId)
    this.profileFavoriteDifficultyLine.textContent = t('favoriteDifficultyLine', { difficulty: btn ? btn.textContent : favoriteId })
    this.profileFavoriteDifficultyLine.style.display = ''
  }

  // Best Run card - the runHistory entry matching bestStats.bestNight
  // (the same "single best-ever run" bestStats already is the source of
  // truth for), showing the difficulty/loadout/companion fields
  // _recordRunEnd already captures on every entry (see CLAUDE.md's note
  // on why those were added) rather than tracking a new "best run"
  // snapshot separately.
  _renderBestRunCard() {
    if (!this.profileBestRunCard) return
    const best = this.runHistory.find((r) => _safeStatNumber(r.night) === _safeStatNumber(this.bestStats.bestNight))
    if (!best) {
      this.profileBestRunCard.style.display = 'none'
      return
    }
    this.profileBestRunTitle.textContent = t('profileBestRunTitle')
    const diffBtn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === best.difficulty)
    this.profileBestRunLine.textContent = t('profileBestRunLine', {
      night: _safeStatNumber(best.night),
      kills: _safeStatNumber(best.kills),
      coins: _safeStatNumber(best.coins),
      difficulty: diffBtn ? diffBtn.textContent : (best.difficulty || '?'),
      loadout: best.loadout ? t(LOADOUT_LABEL_KEYS[best.loadout] || best.loadout) : '?',
    })
    this.profileBestRunCard.style.display = ''
  }

  _renderCompanionColorPreview() {
    if (!this.companionColorPreview) return
    this.companionColorPreview.style.background = this.settings.companionColor || '#2f4f7a'
  }


  // Nearly There nudge - the single closest-to-unlocking achievement among
  // a small curated set of *persistent, numeric* achievements (most
  // achievement conditions are per-run counters that reset, so aren't
  // meaningful to show as a lifetime "so close" hint).
  // Shows every currently-qualifying candidate (sorted closest-first),
  // not a fixed "top 3" - NEARLY_THERE_CANDIDATES only has 2 entries
  // right now (see its own comment on why most achievements can't back
  // this honestly), so this naturally shows 0-2 lines rather than
  // padding to a number that doesn't reflect what's actually trackable.
  _renderNearlyThereNudge() {
    if (!this.profileNearlyThereList) return
    const rows = []
    for (const c of NEARLY_THERE_CANDIDATES) {
      if (this.achievements.unlocked.has(c.achievementId)) continue
      const total = c.total(this)
      if (total <= 0) continue
      const current = Math.min(c.current(this), total)
      rows.push({ ...c, current, total, ratio: current / total })
    }
    rows.sort((a, b) => b.ratio - a.ratio)
    this.profileNearlyThereList.innerHTML = rows.map((r) => {
      const def = ACHIEVEMENTS.find((a) => a.id === r.achievementId)
      const pct = Math.round(r.ratio * 100)
      return `
        <div class="nearly-there-item">
          <p class="nearly-there-line">${_escapeHtml(t('nearlyThereLine', { title: t(def.titleKey), current: r.current, total: r.total }))}</p>
          <div class="mini-progress-track" aria-hidden="true"><div class="mini-progress-fill" style="width: ${pct}%"></div></div>
        </div>
      `
    }).join('')
  }

  // Weekly Recap - aggregates runHistory entries from the last 7 real days
  // (rolling window, not calendar-week-aligned like WEEKLY_CHALLENGES) -
  // pure derived display, no new tracking, same reasoning as
  // _openProfilePanel's completionPct.
  _renderWeeklyRecap() {
    if (!this.profileWeeklyRecapLine) return
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recent = this.runHistory.filter((r) => _safeStatNumber(r.ts) >= cutoff)
    this.profileWeeklyRecapTitle.style.display = ''
    this.profileWeeklyRecapTitle.textContent = t('weeklyRecapTitle')
    this.profileWeeklyRecapLine.style.display = ''
    if (recent.length === 0) {
      this.profileWeeklyRecapLine.textContent = t('weeklyRecapEmpty')
      return
    }
    const kills = recent.reduce((sum, r) => sum + _safeStatNumber(r.kills), 0)
    const bestNight = recent.reduce((max, r) => Math.max(max, _safeStatNumber(r.night)), 0)
    this.profileWeeklyRecapLine.textContent = t('weeklyRecapLine', { kills, runs: recent.length, night: bestNight })
    // "vs last week" delta - the same rolling-7-day window one step back
    // (days 8-14 ago), bounded by RUN_HISTORY_MAX same as everything else
    // reading runHistory, so a very inactive stretch may show no prior-
    // week data at all rather than a misleading zero.
    if (this.profileWeeklyDeltaLine) {
      const priorCutoffStart = Date.now() - 14 * 24 * 60 * 60 * 1000
      const prior = this.runHistory.filter((r) => _safeStatNumber(r.ts) >= priorCutoffStart && _safeStatNumber(r.ts) < cutoff)
      if (prior.length === 0) {
        this.profileWeeklyDeltaLine.style.display = 'none'
      } else {
        const priorKills = prior.reduce((sum, r) => sum + _safeStatNumber(r.kills), 0)
        const delta = kills - priorKills
        this.profileWeeklyDeltaLine.textContent = t('weeklyDeltaLine', { delta: delta >= 0 ? `+${delta}` : delta })
        this.profileWeeklyDeltaLine.style.display = ''
      }
    }
  }

  // Profile panel account row - Login/Register when signed out, Sign Out
  // when signed in. Reuses CloudSync/_handleCloudSignIn/_handleCloudSignOut
  // wholesale (see their own comments) rather than a second auth path -
  // this is just a second place to trigger the exact same sign-in/out flow
  // the Cloud Save panel already has, not a parallel system.
  _renderProfileAccountRow() {
    const signedIn = !!this._cloudUid
    if (this.profileAccountSignedOut) this.profileAccountSignedOut.style.display = signedIn ? 'none' : 'flex'
    if (this.profileAccountSignedIn) this.profileAccountSignedIn.style.display = signedIn ? 'flex' : 'none'
    if (this.profileLoginBtn) this.profileLoginBtn.textContent = t('profileLoginBtn')
    if (this.profileRegisterBtn) this.profileRegisterBtn.textContent = t('profileRegisterBtn')
    if (this.profileSignoutBtn) this.profileSignoutBtn.textContent = t('profileSignoutBtn')
  }

  // "X days since your first run" - careerStats.firstPlayedDate is set
  // once, on the very first completed run (see _recordRunEnd), never
  // touched again. Hidden entirely before that first run exists (a
  // brand-new save has nothing to anniversary yet).
  _renderAnniversaryLine() {
    if (!this.profileAnniversaryLine) return
    if (!this.careerStats.firstPlayedDate) {
      this.profileAnniversaryLine.style.display = 'none'
      return
    }
    const days = Math.max(0, Math.round((new Date(todayDateString()) - new Date(this.careerStats.firstPlayedDate)) / 86400000))
    this.profileAnniversaryLine.textContent = t('anniversaryLine', { n: days })
    this.profileAnniversaryLine.style.display = ''
  }

  // "Created" - replaces the old Login Streak calendar. Ticks live every
  // second while the panel is open (see _closeProfilePanel's matching
  // clearInterval) off careerStats.accountCreatedAt - a real millisecond
  // timestamp set once, the very first time the game ever constructed on
  // this device (see the constructor, right after loadCareerStats()) -
  // not firstPlayedDate above, which only covers players who've finished
  // at least one run and has no time-of-day precision.
  _renderProfileCreated() {
    if (!this.profileCreatedLine) return
    if (this.profileCreatedTitle) this.profileCreatedTitle.textContent = t('profileCreatedTitle')
    if (this._profileCreatedTickInterval) clearInterval(this._profileCreatedTickInterval)
    const tick = () => {
      const elapsedMs = Math.max(0, Date.now() - _safeStatNumber(this.careerStats.accountCreatedAt))
      const totalSeconds = Math.floor(elapsedMs / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      this.profileCreatedLine.textContent = t('profileCreatedLine', { days, hours, minutes, seconds })
    }
    tick()
    this._profileCreatedTickInterval = setInterval(tick, 1000)
  }

  _closeProfilePanel() {
    this.profilePanel.style.display = 'none'
    if (this._profileCreatedTickInterval) {
      clearInterval(this._profileCreatedTickInterval)
      this._profileCreatedTickInterval = null
    }
  }

  // Career Portrait (Long-Term Goals batch, gated behind true_ending - see
  // _openProfilePanel) - draws straight from the live WebGL canvas rather
  // than routing through screenshotCropImage's async <img> load like the
  // manual screenshot tool does (see _buildScreenshotCanvas's own comment):
  // that intermediate exists to support crop-selection UI, which this
  // capstone memento doesn't need, so skipping it keeps this synchronous
  // with no onload race. Still finishes through the shared
  // _finalizeScreenshotCanvas so it gets the same watermark+download step.
  _generateCareerPortrait() {
    this.composer.render()
    const canvas = document.createElement('canvas')
    canvas.width = this.canvas.width
    canvas.height = this.canvas.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(this.canvas, 0, 0)

    const bannerH = Math.max(70, Math.round(canvas.height * 0.14))
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 0, canvas.width, bannerH)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const titleSize = Math.max(18, Math.round(canvas.width * 0.03))
    ctx.font = `bold ${titleSize}px sans-serif`
    ctx.fillText(t(careerRankTitleKey(this.careerStats.totalKills)), 16, 12)
    const lineSize = Math.max(12, Math.round(canvas.width * 0.016))
    ctx.font = `${lineSize}px sans-serif`
    ctx.fillText(t('careerPortraitStatsLine', { kills: this.careerStats.totalKills, prestige: this.metaProgress.prestigeLevel, runs: this.careerStats.totalRuns }), 16, titleSize + 24)

    this._finalizeScreenshotCanvas(canvas, 'download')
  }

  // Beat This challenge link - encodes just enough to render a comparison
  // (name + bestNight + totalKills) as a base64 URL param. Deliberately
  // NOT the same thing as the existing Challenge Code system (see
  // _pendingChallengeCode/challengeCodeTwist) - that hashes a typed
  // string into a gameplay difficulty twist; this only carries stats for
  // a one-time display comparison, nothing gameplay-affecting, and
  // there's no server round-trip since the whole payload lives in the URL.
  _copyBeatThisLink() {
    const payload = { n: this.settings.nickname || t('menuPlayerTagDefault'), bn: _safeStatNumber(this.bestStats.bestNight), tk: _safeStatNumber(this.careerStats.totalKills) }
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)))
    const url = `${location.origin}${location.pathname}?challenge=${encoded}`
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => this._showLoreToast(t('beatThisLinkCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  // Reads a ?challenge=... param left by _copyBeatThisLink above (if any)
  // and shows a one-time comparison toast. Best-effort: any malformed/
  // tampered param (this is untrusted user input arriving via URL, same
  // caution as _safeStatNumber's own comment on imported save data)
  // silently no-ops rather than throwing.
  _checkBeatThisChallenge() {
    try {
      const raw = new URLSearchParams(location.search).get('challenge')
      if (!raw) return
      const payload = JSON.parse(atob(decodeURIComponent(raw)))
      const name = typeof payload.n === 'string' ? payload.n.slice(0, 20) : '???'
      const theirNight = _safeStatNumber(payload.bn)
      const theirKills = _safeStatNumber(payload.tk)
      const myNight = _safeStatNumber(this.bestStats.bestNight)
      this._showHomepageToast(t('beatThisComparison', { name, theirNight, myNight, theirKills, myKills: _safeStatNumber(this.careerStats.totalKills) }))
    } catch {
      // Malformed/tampered param - silently ignored, see comment above.
    }
  }

  // Copy My Setup - encodes difficulty + loadout class + companion role +
  // active mutators as a ?setup= URL param, same base64-in-a-link
  // technique as _copyBeatThisLink above, but for "try my build" instead
  // of a stat comparison. Distinct from _saveMenuPreset (local-only, up to
  // 3 saved presets) and _copyLoadoutCode (weapon hotbar only).
  _copySetupCode() {
    const activeMutators = Object.keys(SETUP_CODE_MUTATOR_ELEMENT_KEYS).filter((k) => this.settings.mutators[k])
    const payload = { d: this.settings.difficulty, l: this.settings.loadout, r: this.settings.companionRole, m: activeMutators }
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)))
    const url = `${location.origin}${location.pathname}?setup=${encoded}`
    if (!navigator.clipboard) {
      this._showHomepageToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => this._showHomepageToast(t('setupLinkCopied')))
      .catch(() => this._showHomepageToast(t('clipboardCopyUnsupported')))
  }

  // Reads a ?setup=... param left by _copySetupCode above (if any) and
  // clicks the real buttons to apply it (same .click()-the-real-button
  // technique _loadMenuPreset/_surpriseMe already use, so every other
  // listener tied to those clicks still fires normally). Best-effort, same
  // untrusted-URL-input caution as _checkBeatThisChallenge.
  _checkSetupCode() {
    try {
      const raw = new URLSearchParams(location.search).get('setup')
      if (!raw) return
      const payload = JSON.parse(atob(decodeURIComponent(raw)))
      if (typeof payload.d === 'string') {
        const diffBtn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === payload.d)
        if (diffBtn && diffBtn.style.display !== 'none') diffBtn.click()
      }
      if (typeof payload.l === 'string') {
        const loadoutBtn = Array.from(this.loadoutBtns).find((b) => b.dataset.loadout === payload.l)
        if (loadoutBtn) loadoutBtn.click()
      }
      if (typeof payload.r === 'string') {
        const roleBtn = Array.from(this.roleBtns).find((b) => b.dataset.role === payload.r)
        if (roleBtn) roleBtn.click()
      }
      if (Array.isArray(payload.m)) {
        for (const key of payload.m) {
          const el = this[SETUP_CODE_MUTATOR_ELEMENT_KEYS[key]]
          if (el && !el.checked) el.click()
        }
      }
      this._showHomepageToast(t('setupLinkApplied'))
    } catch {
      // Malformed/tampered param - silently ignored, see comment above.
    }
  }

  // Shareable public Profile link - same base64-in-a-URL technique as
  // _copyBeatThisLink/_copySetupCode, but carries a wider read-only stat
  // snapshot (not just a head-to-head comparison) for the #shared-profile-
  // banner below to display.
  _copyProfileLink() {
    const payload = {
      n: this.settings.nickname || t('menuPlayerTagDefault'),
      tr: _safeStatNumber(this.careerStats.totalRuns),
      tk: _safeStatNumber(this.careerStats.totalKills),
      bn: _safeStatNumber(this.bestStats.bestNight),
      bk: _safeStatNumber(this.bestStats.bestKills),
      ach: this.achievements.unlocked.size,
      achTotal: ACHIEVEMENTS.length,
      fw: this._favoriteWeaponLabel(),
    }
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)))
    const url = `${location.origin}${location.pathname}?viewprofile=${encoded}`
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => this._showLoreToast(t('profileLinkCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
  }

  // Reads a ?viewprofile=... param left by _copyProfileLink above (if any)
  // and shows the read-only #shared-profile-banner - untrusted URL input,
  // same best-effort try/catch caution as _checkBeatThisChallenge/
  // _checkSetupCode. Set via .textContent (not innerHTML) below, so no
  // _escapeHtml needed - the browser never interprets this as markup.
  _checkViewProfileLink() {
    try {
      const raw = new URLSearchParams(location.search).get('viewprofile')
      if (!raw || !this.sharedProfileBanner) return
      const p = JSON.parse(atob(decodeURIComponent(raw)))
      const name = typeof p.n === 'string' ? p.n.slice(0, 20) : '???'
      const weapon = typeof p.fw === 'string' ? p.fw.slice(0, 40) : '?'
      this.sharedProfileTitle.textContent = t('sharedProfileTitle', { name })
      this.sharedProfileLine.textContent = t('sharedProfileLine', {
        runs: _safeStatNumber(p.tr),
        kills: _safeStatNumber(p.tk),
        night: _safeStatNumber(p.bn),
        bestKills: _safeStatNumber(p.bk),
        ach: _safeStatNumber(p.ach),
        achTotal: _safeStatNumber(p.achTotal),
        weapon,
      })
      this.sharedProfileBanner.style.display = 'block'
    } catch {
      // Malformed/tampered param - silently ignored, see comment above.
    }
  }

  // What's New digest (see #whats-new-digest) - a fuller, more prominent
  // one-time surfacing of the same new-entries diff the ticker's
  // Changelog-diff mode already computes (see mode 20 in
  // _updateMenuSpotlight), for players who might never happen to land on
  // that ticker mode in its 27-mode rotation. Same lastViewed gate/logic,
  // just rendered as a dismissible card instead of one rotating line.
  // Closing it (or opening Credits, which already does this) marks it
  // seen - reload before dismissing and it shows again, which is the
  // correct behavior for "you still haven't caught up."
  _maybeShowWhatsNewDigest() {
    if (!this.whatsNewDigest) return
    const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
    if (!lastViewed) return
    const newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry')).filter((el) => {
      const parsed = Date.parse(el.querySelector('.changelog-date')?.textContent || '')
      return !isNaN(parsed) && parsed > lastViewed
    })
    if (!newEntries.length) return
    this.whatsNewDigestTitle.textContent = t('whatsNewDigestTitle', { n: newEntries.length })
    this.whatsNewDigestList.innerHTML = newEntries.map((el) => `<p>${el.querySelector('.changelog-text')?.textContent || ''}</p>`).join('')
    this.whatsNewDigest.style.display = 'block'
  }

  // Friend-beats-you notification - checks each saved friend's real public
  // leaderboard entry (same fetchLeaderboardEntryByName the manual Friend
  // Compare box already uses) once per page load, bounded to the capped-
  // at-5 savedFriends list. friendBeatNotified tracks {name, night} pairs
  // already shown so this doesn't re-toast the same fact on every visit -
  // only fires again if that friend's bestNight climbs even higher, and
  // clears once you catch back up (so a real future overtake notifies
  // again instead of staying silently suppressed forever).
  async _checkFriendBeatNotifications() {
    if (!CloudSync.isConfigured() || !this.settings.savedFriends.length) return
    const myNight = _safeStatNumber(this.bestStats.bestNight)
    const stillRelevant = []
    for (const name of this.settings.savedFriends) {
      let entry
      try {
        entry = await CloudSync.fetchLeaderboardEntryByName(name)
      } catch {
        continue
      }
      if (!entry) continue
      const theirNight = _safeStatNumber(entry.bestNight)
      if (theirNight <= myNight) continue
      const alreadyNotified = this.settings.friendBeatNotified.find((n) => n.name === name)
      if (alreadyNotified && alreadyNotified.night >= theirNight) {
        stillRelevant.push(alreadyNotified)
        continue
      }
      this._showHomepageToast(t('friendBeatYouToast', { name, night: theirNight }))
      stillRelevant.push({ name, night: theirNight })
    }
    this.settings.friendBeatNotified = stillRelevant
    saveSettings(this.settings)
  }

  // Count-up animation for Profile stat numbers - only touches values
  // that are a plain whole number (with optional thousands commas), so
  // percentages/ratios/dates/text values are left exactly as rendered
  // rather than mangled by a naive count-up. Skipped under reduced-motion
  // (the real final value is already on screen from the synchronous
  // render above, nothing more to do).
  _animateStatCountUp() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const el of this.profileOptions.querySelectorAll('.perk-cost')) {
      const text = el.textContent
      if (!/^[\d,]+$/.test(text)) continue
      const target = Number(text.replace(/,/g, ''))
      if (!Number.isFinite(target) || target <= 0) continue
      const duration = 500
      const start = performance.now()
      const step = (now) => {
        const progress = Math.min(1, (now - start) / duration)
        el.textContent = Math.round(target * progress).toLocaleString()
        if (progress < 1) requestAnimationFrame(step)
        else el.textContent = target.toLocaleString()
      }
      requestAnimationFrame(step)
    }
  }

  // Pin a Stat (see _openProfilePanel) - populates the select fresh every
  // render (cheap, just <option> elements) but wires its change listener
  // only once (_pinnedStatBound guard) so repeated panel opens don't stack
  // duplicate listeners.
  _renderPinnedStatSelect(rows) {
    if (!this.pinnedStatSelect) return
    const current = this.settings.pinnedStat
    this.pinnedStatSelect.innerHTML = `<option value="">${t('pinnedStatNone')}</option>` +
      rows.map(([id, label]) => `<option value="${id}"${id === current ? ' selected' : ''}>${label}</option>`).join('')
    if (!this._pinnedStatBound) {
      this._pinnedStatBound = true
      this.pinnedStatSelect.addEventListener('change', () => {
        this.settings.pinnedStat = this.pinnedStatSelect.value || null
        saveSettings(this.settings)
        this._openProfilePanel()
      })
    }
  }

  // Deep-link a Settings tab (?settingstab=controls) - opens Settings and
  // clicks the real tab button (reuses its own click handler, same
  // "click the real element" precedent _loadMenuPreset uses) rather than
  // duplicating tab-switch logic here.
  _checkSettingsTabDeepLink() {
    const tab = new URLSearchParams(location.search).get('settingstab')
    if (!tab) return
    const btn = document.getElementById(`tab-${tab}`)
    if (!btn) return
    this._toggleSettings(true)
    btn.click()
  }

  // Weekly Challenge reset imminent - _daysUntilWeekReset() is day-
  // granularity by design (see its own comment), so "a few hours left"
  // is approximated as "the last day of the week, and it's evening
  // local time" rather than rewriting that shared function for hour
  // precision just for this one toast.
  _checkWeeklyResetImminent() {
    if (!this.weeklyDef) return
    if (_daysUntilWeekReset() === 1 && new Date().getHours() >= 20) {
      this._showHomepageToast(t('weeklyResetImminentToast', { title: t(this.weeklyDef.titleKey) }))
    }
  }

  // Unclaimed Quests reminder - a dedicated toast alongside the passive
  // favicon badge (see _updateFaviconQuestBadge), once per page load.
  _checkUnclaimedQuestsReminder() {
    const count = QUESTS.filter((q) => this.quests.isComplete(q, this) && !this.quests.isClaimed(q.id)).length
    if (count > 0) this._showHomepageToast(t('unclaimedQuestsToast', { n: count }))
  }

  // Career Almanac helper (see _openProfilePanel) - the single highest kill
  // tally in weaponMastery.kills, purely derived from data that system
  // already tracks for the mastery/grandmaster thresholds.
  _favoriteWeaponLabel() {
    let bestId = null
    let bestKills = 0
    for (const [id, kills] of Object.entries(this.weaponMastery.kills)) {
      if (kills > bestKills) { bestKills = kills; bestId = id }
    }
    if (!bestId) return t('profileFavoriteWeaponNone')
    const w = this.weapons.weapons.find((w) => w.id === bestId)
    return w ? t(this.weapons._nameKeyFor(w)) : bestId
  }

  // Favorite companion role helper (see _openProfilePanel) - the highest
  // tally in careerStats.companionRoleUseCounts (see _recordRunEnd). Role
  // names are plain English here, same as the homepage class-grid's own
  // static (non-i18n) Melee/Ranged/Medic span text.
  _favoriteCompanionRoleLabel() {
    const labels = { melee: 'Melee', ranged: 'Ranged', medic: 'Medic' }
    let bestId = null
    let bestCount = 0
    for (const [id, count] of Object.entries(this.careerStats.companionRoleUseCounts)) {
      if (count > bestCount) { bestCount = count; bestId = id }
    }
    return bestId ? (labels[bestId] || bestId) : '—'
  }

  // Favorite day-of-week helper (see _openProfilePanel) - buckets
  // runHistory timestamps by weekday, same "recent habits, not lifetime
  // average" caveat the ticker's Favorite Play Time mode already
  // documents (runHistory is capped at RUN_HISTORY_MAX).
  _favoriteDayOfWeekLabel() {
    if (this.runHistory.length < 3) return '—'
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const r of this.runHistory) {
      if (!r.ts) continue
      counts[new Date(r.ts).getDay()]++
    }
    const bestIndex = counts.indexOf(Math.max(...counts))
    return counts[bestIndex] > 0 ? dayNames[bestIndex] : '—'
  }

  // Deaths-by-type helper (see _openProfilePanel) - the single highest
  // tally in careerStats.deathsByType (see _recordNemesis).
  _deadliestZombieLabel() {
    let bestId = null
    let bestCount = 0
    for (const [id, count] of Object.entries(this.careerStats.deathsByType)) {
      if (count > bestCount) { bestCount = count; bestId = id }
    }
    if (!bestId) return t('profileDeadliestEnemyNone')
    const typeInfo = ZOMBIE_TYPES[bestId]
    return t('profileDeadliestEnemyValue', { name: typeInfo ? typeInfo.label : bestId, n: bestCount })
  }

  // Most-used mutator helper (see _openProfilePanel) - the single highest
  // tally in careerStats.mutatorUseCounts (see _recordRunEnd).
  _mostUsedMutatorLabel() {
    let bestId = null
    let bestCount = 0
    for (const [id, count] of Object.entries(this.careerStats.mutatorUseCounts)) {
      if (count > bestCount) { bestCount = count; bestId = id }
    }
    if (!bestId) return t('profileMostUsedMutatorNone')
    return t('profileMostUsedMutatorValue', { name: t(MUTATOR_LABEL_KEYS[bestId] || bestId), n: bestCount })
  }

  // Coins today / weekly average helpers (see _openProfilePanel) - both
  // pure-derived from runHistory's own ts/coins fields (same rolling
  // window _renderWeeklyRecap already uses), no new tracking. "Today"
  // sums coins from runs completed since local midnight; the weekly
  // average spreads the last 7 days' total coins evenly across 7, not
  // just the days actually played, so a quiet week reads as a genuinely
  // lower average rather than being hidden by only counting play-days.
  _coinsToday() {
    const todayStr = todayDateString()
    return this.runHistory
      .filter((r) => new Date(_safeStatNumber(r.ts)).toISOString().slice(0, 10) === todayStr)
      .reduce((sum, r) => sum + _safeStatNumber(r.coins), 0)
  }

  _coinsWeeklyAvg() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    const total = this.runHistory
      .filter((r) => _safeStatNumber(r.ts) >= cutoff)
      .reduce((sum, r) => sum + _safeStatNumber(r.coins), 0)
    return Math.round(total / 7)
  }

  // Nemesis system (see NEMESIS_KEY's own comment) - the nearest alive
  // zombie to the player at the moment of death becomes the recorded
  // nemesis, same "nearest as attacker proxy" approximation
  // _showThreatIndicator already relies on (the exact attacker isn't
  // threaded through every damage callback).
  _recordNemesis() {
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
    const typeInfo = ZOMBIE_TYPES[nearest.type]
    this.nemesis = { typeId: nearest.type, label: typeInfo ? typeInfo.label : nearest.type, night: this.night }
    saveNemesis(this.nemesis)
    // Deaths-by-type tally (Profile panel) - same nearest-zombie proxy as
    // the nemesis line above, aggregated over every death instead of just
    // the most recent one.
    this.careerStats.deathsByType[nearest.type] = (this.careerStats.deathsByType[nearest.type] || 0) + 1
    saveCareerStats(this.careerStats)
  }

  _scheduleNemesisCheck() {
    setTimeout(() => this._checkNemesisReturn(), 3500)
  }

  _checkNemesisReturn() {
    if (!this.nemesis || this._nemesisAnnouncedThisRun || !this.playerState.alive) return
    this._nemesisAnnouncedThisRun = true
    this._showLoreToast(t('nemesisReturnToast', { name: this.nemesis.label }))
  }

  // Daily Challenge local leaderboard (see DAILY_LEADERBOARD_KEY's own
  // comment) - top-N attempts for today's date, distinct from dailyBest's
  // single lifetime-best score.
  _recordDailyLeaderboardEntry(score) {
    this.dailyLeaderboard = loadDailyLeaderboard()
    this.dailyLeaderboard.scores.push(score)
    this.dailyLeaderboard.scores.sort((a, b) => b - a)
    this.dailyLeaderboard.scores = this.dailyLeaderboard.scores.slice(0, DAILY_LEADERBOARD_MAX)
    saveDailyLeaderboard(this.dailyLeaderboard)
    this._renderDailyLeaderboard()
  }

  _renderDailyLeaderboard() {
    if (!this.dailyLeaderboardEl) return
    if (this.dailyLeaderboard.scores.length === 0) {
      this.dailyLeaderboardEl.style.display = 'none'
      this.dailyLeaderboardEl.innerHTML = ''
      return
    }
    this.dailyLeaderboardEl.style.display = ''
    // _safeStatNumber - same untrusted-after-Import-Save reasoning as
    // every other leaderboard render in this file (see its own comment).
    const rows = this.dailyLeaderboard.scores.map((s, i) => `<p class="menu-best-stats">${i + 1}. ${_safeStatNumber(s)}</p>`).join('')
    this.dailyLeaderboardEl.innerHTML = `<p class="menu-best-stats">${t('dailyLeaderboardTitle')}</p>${rows}`
  }

  // Buried caches (see BURIED_CACHE_COUNT's own comment) - a small
  // disturbed-earth marker, dug via the existing F-interact prompt chain
  // (this.nearBuriedCache follows the same nearX pattern as this.nearVault
  // etc.), not a separate shovel tool/inventory item.
  _spawnBuriedCaches() {
    for (let i = 0; i < BURIED_CACHE_COUNT; i++) {
      const angle = (i / BURIED_CACHE_COUNT) * Math.PI * 2 + Math.random() * 0.8
      const dist = BURIED_CACHE_MIN_RADIUS + Math.random() * (BURIED_CACHE_MAX_RADIUS - BURIED_CACHE_MIN_RADIUS)
      const x = this.safeZone.x + Math.cos(angle) * dist
      const z = this.safeZone.z + Math.sin(angle) * dist
      const mat = flatMaterial({ color: 0x3a2e20, roughness: 1 })
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10), mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(x, 0.02, z)
      this.scene.add(mesh)
      this.buriedCaches.push({ x, z, mesh, dug: false })
    }
  }

  _updateBuriedCaches(playerPos) {
    this.nearBuriedCache = null
    for (const cache of this.buriedCaches) {
      if (cache.dug) continue
      const dist = Math.hypot(cache.x - playerPos.x, cache.z - playerPos.z)
      if (dist <= BURIED_CACHE_INTERACT_RADIUS) {
        this.nearBuriedCache = cache
        break
      }
    }
  }

  _digBuriedCache() {
    const cache = this.nearBuriedCache
    if (!cache || cache.dug) return
    cache.dug = true
    this.scene.remove(cache.mesh)
    cache.mesh.geometry.dispose()
    cache.mesh.material.dispose()
    this.nearBuriedCache = null
    this.secretsProgress.cachesDug += 1
    saveSecretsProgress(this.secretsProgress)
    this.coins += 150
    this._showCoinPopup(150)
    this.pickups.spawnLootDrop('ammo', cache.x, cache.z)
    this._showLoreToast(t('toastBuriedCacheFound'))
  }

  // Secret key-sequence code (see SECRET_SEQUENCE's own comment) - called
  // from every keydown regardless of menu state, a rolling buffer checked
  // against the fixed sequence. Reuses PlayerController's adrenalineMult
  // (see _useAdrenaline) rather than a parallel speed-boost mechanism -
  // if both happen to be active at once, whichever's timer clears last
  // wins, an acceptable rare edge case for what's meant to be a fun secret.
  _checkSecretSequence(code) {
    this._secretSequenceBuffer.push(code)
    if (this._secretSequenceBuffer.length > SECRET_SEQUENCE.length) this._secretSequenceBuffer.shift()
    if (this._secretSequenceBuffer.length === SECRET_SEQUENCE.length && this._secretSequenceBuffer.every((c, i) => c === SECRET_SEQUENCE[i])) {
      this._secretSequenceBuffer = []
      this._secretSequenceBonusUntil = performance.now() + SECRET_SEQUENCE_BONUS_DURATION_MS
      this.player.adrenalineMult = SECRET_SEQUENCE_SPEED_MULT
      this._showLoreToast(t('secretSequenceActivated'))
    }
  }

  // Frame-Time Graph visibility/draw (see settings.frameTimeGraph) -
  // opacity follows the same "visible once gameplay/homepage-fps-toggle
  // has shown fpsEl at least once" rule fpsEl itself already uses, so
  // the graph never appears without its own text readout also present.
  _applyFrameTimeGraphVisibility() {
    if (!this.frameTimeCanvas) return
    this.frameTimeCanvas.style.opacity = this.settings.frameTimeGraph && this.fpsEl.style.opacity === '1' ? '1' : '0'
  }

  _drawFrameTimeGraph() {
    if (!this.frameTimeCanvas || !this._frameTimeHistory) return
    this._applyFrameTimeGraphVisibility()
    const ctx = this.frameTimeCanvas.getContext('2d')
    const w = this.frameTimeCanvas.width
    const h = this.frameTimeCanvas.height
    ctx.clearRect(0, 0, w, h)
    const maxMs = Math.max(33, ...this._frameTimeHistory)
    ctx.strokeStyle = '#7fd88f'
    ctx.beginPath()
    this._frameTimeHistory.forEach((ms, i) => {
      const x = (i / 59) * w
      const y = h - (ms / maxMs) * h
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  // Confetti burst on a new personal best (see _recordRunEnd's
  // _pendingConfetti flag) - a handful of plain colored divs falling and
  // fading via CSS, no canvas/library, auto-removed after the animation
  // ends. Skipped entirely under prefers-reduced-motion.
  _fireConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const colors = ['#e0b13e', '#7fd88f', '#6fa8dc', '#c9564a', '#b07cd6']
    for (let i = 0; i < 24; i++) {
      const piece = document.createElement('div')
      piece.className = 'confetti-piece'
      piece.style.left = `${Math.random() * 100}vw`
      piece.style.background = colors[Math.floor(Math.random() * colors.length)]
      piece.style.animationDelay = `${Math.random() * 0.3}s`
      piece.style.animationDuration = `${1.8 + Math.random() * 0.8}s`
      document.body.appendChild(piece)
      piece.addEventListener('animationend', () => piece.remove())
    }
  }

  _updateSecretSequenceBonus() {
    if (this._secretSequenceBonusUntil && performance.now() >= this._secretSequenceBonusUntil) {
      this._secretSequenceBonusUntil = 0
      this.player.adrenalineMult = 1
    }
  }

  // Rare one-time Easter egg - checked on every night-advance (a natural
  // low-frequency tick), a small per-check chance, never more than once
  // per save ever.
  _maybeTriggerRareEasterEgg() {
    if (this.secretsProgress.easterEggSeen) return
    if (Math.random() > RARE_EASTER_EGG_CHANCE) return
    this.secretsProgress.easterEggSeen = true
    saveSecretsProgress(this.secretsProgress)
    this._showLoreToast(t('rareEasterEggToast'))
  }

  // Undiscovered-landmark proximity chime - a soft sensory hint that
  // something's nearby, distinct from the guaranteed coin reward
  // Landmark Discovery Rewards already gives once you actually reach one.
  // Tracked per-run (_undiscoveredChimePlayedFor) so it can only ever
  // nudge you toward the same landmark once per run, not every frame
  // you're in range.
  _checkUndiscoveredLandmarkChime(playerPos) {
    for (const lm of this.allLocationLandmarks) {
      const cx = Math.floor(lm.x / EXPLORE_CELL_SIZE)
      const cz = Math.floor(lm.z / EXPLORE_CELL_SIZE)
      if (this.discoveredCells.has(`${cx},${cz}`)) continue
      if (this._undiscoveredChimePlayedFor.has(lm.label)) continue
      const dist = Math.hypot(lm.x - playerPos.x, lm.z - playerPos.z)
      if (dist <= UNDISCOVERED_CHIME_RADIUS) {
        this._undiscoveredChimePlayedFor.add(lm.label)
        audioEngine.playTargetDing()
      }
    }
  }

  // Quick fast-travel to the nearest already-discovered point (see
  // Keybinds.js's fastTravelNearest action) - same eligibility rule
  // FullMap.render() uses for its own hitTargets (Safe Zone always known,
  // a landmark only once its cell is discovered, plus any custom pin), but
  // computed directly here rather than reading this.fullMap.hitTargets -
  // that list is only ever populated by an actual render() call, so it's
  // still undefined if the player has never opened the full map yet.
  _fastTravelToNearest() {
    const playerPos = this.player.controls.object.position
    // 'Safe Zone'/'Custom Pin' match FullMap.render()'s own hardcoded
    // labels for these two entries - neither is run through i18n there
    // either.
    const candidates = [{ label: 'Safe Zone', x: this.safeZone.x, z: this.safeZone.z }]
    for (const lm of this.allLocationLandmarks) {
      const cx = Math.floor(lm.x / EXPLORE_CELL_SIZE)
      const cz = Math.floor(lm.z / EXPLORE_CELL_SIZE)
      if (this.discoveredCells.has(`${cx},${cz}`)) candidates.push(lm)
    }
    if (this.customPin) candidates.push({ label: 'Custom Pin', x: this.customPin.x, z: this.customPin.z })

    let nearest = null
    let nearestDist = Infinity
    for (const target of candidates) {
      const dist = Math.hypot(target.x - playerPos.x, target.z - playerPos.z)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = target
      }
    }
    if (!nearest) return
    playerPos.set(nearest.x, playerPos.y, nearest.z)
    this._showLoreToast(t('fastTraveledTo', { name: nearest.label }))
  }

  // Smoke Bomb - see SMOKE_BOMB_RADIUS's own comment for why this is a
  // one-time awareness reset rather than an ongoing vision-block.
  _throwSmokeBomb() {
    if (!this.inventory.useSmokeBomb()) return
    this.camera.getWorldDirection(this._camDir)
    const pos = this.player.controls.object.position
    const x = pos.x + this._camDir.x * SMOKE_BOMB_THROW_DIST
    const z = pos.z + this._camDir.z * SMOKE_BOMB_THROW_DIST
    for (const zombie of this.zombies.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist <= SMOKE_BOMB_RADIUS) zombie.aware = false
    }
    this._spawnSmokeCloudVisual(x, z)
    this._updateInventoryHud()
    this._showLoreToast(t('toastSmokeBombUsed'))
  }

  _spawnSmokeCloudVisual(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a8a82, transparent: true, opacity: 0.55 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(SMOKE_BOMB_RADIUS * 0.5, 12, 10), mat)
    mesh.position.set(x, 1, z)
    this.scene.add(mesh)
    setTimeout(() => {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }, SMOKE_BOMB_CLOUD_DURATION_MS)
  }

  // Parry - a short active-press window (see PARRY_WINDOW_MS's own
  // comment), checked from _onZombieAttack. Cooldown-gated the same
  // pattern _triggerTaunt already uses for its own cooldown.
  _triggerParry() {
    const now = performance.now()
    if (now < (this._lastParryAt || 0) + PARRY_COOLDOWN_MS) return
    this._lastParryAt = now
    this._parryActiveUntil = now + PARRY_WINDOW_MS
    this._showLoreToast(t('parryReady'))
  }

  // Melee kill visual effect - a brief colored point light per variant
  // (see MELEE_KILL_FLASH_COLORS), distinct game feel per weapon without
  // needing real per-weapon kill animations on these procedural viewmodels.
  _spawnMeleeKillFlash(x, z) {
    const color = MELEE_KILL_FLASH_COLORS[this.weapons.meleeVariant] || 0xffffff
    const light = new THREE.PointLight(color, 2.2, 4, 2)
    light.position.set(x, 1.2, z)
    this.scene.add(light)
    setTimeout(() => this.scene.remove(light), MELEE_KILL_FLASH_DURATION_MS)
  }

  // Golden Zombie (see GOLDEN_ZOMBIE_CHANCE's own comment) - tags an
  // already-alive ambient zombie reactively rather than a new spawn path.
  _maybeSpawnGoldenZombie() {
    const now = performance.now()
    if (now < this._nextGoldenCheckAt) return
    this._nextGoldenCheckAt = now + GOLDEN_ZOMBIE_CHECK_INTERVAL_MS
    if (this.zombies.zombies.some((z) => z.isGolden && z.state === 'alive')) return // one at a time
    if (Math.random() > GOLDEN_ZOMBIE_CHANCE) return
    const candidates = this.zombies.zombies.filter((z) => z.state === 'alive' && !z.isGolden)
    if (candidates.length === 0) return
    const target = candidates[Math.floor(Math.random() * candidates.length)]
    target.isGolden = true
    this._addGoldenHalo(target)
    // Escort pack - spawned via the same location-targeted burst the
    // Survivor Camp night event already uses, not a new spawn primitive.
    this.zombies.spawnAt(target.group.position.x, target.group.position.z, GOLDEN_ZOMBIE_ESCORT_COUNT)
    this._showLoreToast(t('goldenZombieSpotted'))
  }

  // Attached decoration (halo ring + point light), not a re-tint of the
  // zombie's own body material - that material may be shared/GLB-specific,
  // riskier to safely override per-instance than adding a small prop, same
  // reasoning RivalScavenger.js's bone-parented eyes already established.
  _addGoldenHalo(zombie) {
    const haloMat = flatMaterial({ color: 0xffcf5c, emissive: 0xffcf5c, emissiveIntensity: 1.5 })
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 16), haloMat)
    halo.rotation.x = Math.PI / 2
    halo.position.y = 1.7
    zombie.group.add(halo)
    const light = new THREE.PointLight(0xffcf5c, 1.2, 5, 2)
    light.position.y = 1.5
    zombie.group.add(light)
  }

  // Noise-reactive stampede (see STAMPEDE_TRIGGER_CHANCE's own comment).
  _maybeTriggerStampede() {
    if (this.weapons.current.suppressed) return
    if (Math.random() < STAMPEDE_TRIGGER_CHANCE) {
      this.zombies.spawnSurge(STAMPEDE_SIZE)
      this._showLoreToast(t('stampedeTriggered'))
    }
  }

  // "Reclaimed" area - a one-time small spawn on returning to a grid cell
  // you haven't been back to in a while (see RECLAIM_REVISIT_MS's own
  // comment), keyed the same discoveredCells-style cell string every other
  // per-cell check in this file already uses.
  _checkReclaimedArea(playerPos) {
    const cx = Math.floor(playerPos.x / EXPLORE_CELL_SIZE)
    const cz = Math.floor(playerPos.z / EXPLORE_CELL_SIZE)
    const key = `${cx},${cz}`
    const now = performance.now()
    const lastSeen = this._reclaimedCells.get(key)
    this._reclaimedCells.set(key, now)
    if (lastSeen && now - lastSeen >= RECLAIM_REVISIT_MS) {
      this.zombies.spawnAt(playerPos.x, playerPos.z, RECLAIM_CLUSTER_SIZE)
      this._showLoreToast(t('areaReclaimedToast'))
    }
  }

  // Rain-slicked stumble (see RAIN_STUMBLE_CHANCE's own comment) - a rare
  // ambient stagger on one random nearby zombie, distinct from
  // _triggerLightning's own existing strike-triggered flinch.
  _checkRainStumble(playerPos) {
    if (!this.raining) return
    const now = performance.now()
    if (now < (this._nextRainStumbleCheckAt || 0)) return
    this._nextRainStumbleCheckAt = now + RAIN_STUMBLE_CHECK_INTERVAL_MS
    if (Math.random() > RAIN_STUMBLE_CHANCE) return
    const nearby = this.zombies.zombies.filter((z) => {
      if (z.state !== 'alive') return false
      return Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z) <= RAIN_STUMBLE_RADIUS
    })
    if (nearby.length === 0) return
    nearby[Math.floor(Math.random() * nearby.length)].stun(RAIN_STUMBLE_STAGGER_MS)
  }

  // Earthquake - a rare mid-night event, independent of any weather roll.
  _checkEarthquake(playerPos) {
    const now = performance.now()
    if (now < this._nextEarthquakeCheckAt) return
    this._nextEarthquakeCheckAt = now + EARTHQUAKE_CHECK_INTERVAL_MS
    if (Math.random() > EARTHQUAKE_CHANCE) return
    this._triggerShake(0.15, 900)
    this._showLoreToast(t('earthquakeToast'))
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d <= EARTHQUAKE_STUMBLE_RADIUS) z.stun(EARTHQUAKE_STUMBLE_MS)
    }
  }

  // Flash flooding (see FLOOD_SPEED_MULT's own comment) - a temporary
  // global movement slow, cleared automatically after FLOOD_DURATION_MS.
  _checkFlooding() {
    const now = performance.now()
    if (this._floodActiveUntil && now >= this._floodActiveUntil) {
      this._floodActiveUntil = 0
      this.player.environmentMult = 1
    }
    if (!this.raining || this._floodActiveUntil) return
    if (now < this._nextFloodCheckAt) return
    this._nextFloodCheckAt = now + FLOOD_CHECK_INTERVAL_MS
    if (Math.random() > FLOOD_CHANCE) return
    this._floodActiveUntil = now + FLOOD_DURATION_MS
    this.player.environmentMult = FLOOD_SPEED_MULT
    this._showLoreToast(t('floodToast'))
  }

  // Insect/rat swarm - reuses playerState.takeDamage's own existing
  // infection-chance-per-hit rather than a parallel roll.
  _checkSwarmBite() {
    const now = performance.now()
    if (now < this._nextSwarmBiteCheckAt) return
    this._nextSwarmBiteCheckAt = now + SWARM_BITE_CHECK_INTERVAL_MS
    if (Math.random() > SWARM_BITE_CHANCE) return
    this.playerState.takeDamage(SWARM_BITE_DAMAGE)
    this._updateHealthHud()
    this._showLoreToast(t('swarmBiteToast'))
  }

  // Power surge - the inverse of NightEvents.js's blackout (a full power
  // outage): an overload that drains the generator instantly instead.
  _checkPowerSurge() {
    const now = performance.now()
    if (now < this._nextPowerSurgeCheckAt) return
    this._nextPowerSurgeCheckAt = now + POWER_SURGE_CHECK_INTERVAL_MS
    if (Math.random() > POWER_SURGE_CHANCE) return
    this.generatorFuel = Math.max(0, this.generatorFuel - POWER_SURGE_DRAIN)
    this._showLoreToast(t('powerSurgeToast'))
  }

  // Rooftop wind gusts - reuses the existing camera shake system rather
  // than touching camera rotation directly (PointerLockControls owns
  // yaw/pitch; a manual roll nudge risks fighting or being silently
  // overwritten by its own next mouse-move update).
  _checkRooftopWind(playerPos) {
    if (playerPos.y < ROOFTOP_WIND_MIN_HEIGHT) return
    const now = performance.now()
    if (now < this._nextRooftopWindCheckAt) return
    this._nextRooftopWindCheckAt = now + ROOFTOP_WIND_CHECK_INTERVAL_MS
    if (Math.random() > ROOFTOP_WIND_CHANCE) return
    this._triggerShake(ROOFTOP_WIND_NUDGE, 400)
  }

  // Horde-density ambient audio cue - a low murmur when a lot of zombies
  // are nearby at once, distinct from any single zombie's own moan/snarl.
  _checkHordeDensityAudio(playerPos) {
    const now = performance.now()
    if (now < this._nextHordeAudioCheckAt) return
    this._nextHordeAudioCheckAt = now + HORDE_AUDIO_CHECK_INTERVAL_MS
    let nearby = 0
    for (const z of this.zombies.zombies) {
      if (z.state !== 'alive') continue
      const d = Math.hypot(z.group.position.x - playerPos.x, z.group.position.z - playerPos.z)
      if (d <= HORDE_AUDIO_RADIUS) nearby += 1
    }
    if (nearby >= HORDE_AUDIO_DENSITY_THRESHOLD) audioEngine.playZombieMoan()
    if (this.hordeIndicatorEl) {
      this.hordeIndicatorEl.textContent = t('hordeSizeIndicator', { n: nearby })
      this.hordeIndicatorEl.style.display = nearby > 0 ? '' : 'none'
    }
  }

  // "Last one flees" / "Clean Sweep" - both scoped to Round Mode (see
  // FLEE_SPEED_MULT's own comment for why). Checked once per tick
  // alongside the round-clear check Round Mode already does.
  _checkRoundModeSpecialEvents() {
    if (!this._isRoundMode()) return
    const alive = this.zombies.aliveCount()
    if (alive === 1 && this._lastAliveCountSeen !== 1) {
      const last = this.zombies.zombies.find((z) => z.state === 'alive')
      if (last) last.fleeing = true
    }
    this._lastAliveCountSeen = alive
    if (alive === 0 && performance.now() - this.nightStartedAt <= CLEAN_SWEEP_TIME_THRESHOLD_MS && !this._cleanSweepAwardedThisRound) {
      this._cleanSweepAwardedThisRound = true
      this.coins += CLEAN_SWEEP_BONUS_COINS
      this._showCoinPopup(CLEAN_SWEEP_BONUS_COINS)
      this._showLoreToast(t('cleanSweepToast', { n: CLEAN_SWEEP_BONUS_COINS }))
    }
    if (alive > 0) this._cleanSweepAwardedThisRound = false
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
    else if (type === 'melee_spear') this.weapons.setMeleeVariant('spear')
    else if (type === 'melee_nunchaku') this.weapons.setMeleeVariant('nunchaku')
    else if (type === 'smokebomb') this.inventory.addSmokeBomb(count || 1)
    else if (type === 'barricadecrate') this.inventory.addBarricadeCrate(count || 1)
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
    // Heatwave (see HEATWAVE_THIRST_MULT's own comment) - only the decay
    // rate speeds up, not the dehydration damage below once it hits 0.
    const heatwaveMult = this.heatwave ? HEATWAVE_THIRST_MULT : 1
    this.thirst = Math.max(0, this.thirst - THIRST_DECAY_PER_SEC * heatwaveMult * dt)
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
        el.classList.remove('active', 'locked', 'mastered', 'grandmastered')
        return
      }
      const w = summary.find((ww) => ww.id === weaponId)
      nameEl.textContent = w ? t(w.nameKey) : '-'
      el.classList.toggle('locked', !!w && !w.unlocked)
      el.classList.toggle('active', weaponId === currentId)
      // Mastery-tier badge (see WeaponMastery.js) - already-tracked data,
      // previously only ever surfaced as a one-time unlock toast, never
      // shown persistently anywhere during play.
      el.classList.toggle('grandmastered', this.weaponMastery.grandmastered.has(weaponId))
      el.classList.toggle('mastered', !this.weaponMastery.grandmastered.has(weaponId) && this.weaponMastery.mastered.has(weaponId))
    })
    if (this.hotbarPowerScoreEl) this.hotbarPowerScoreEl.textContent = t('hotbarPowerScore', { n: this._computeLoadoutPowerScore() })
  }

  // Loadout Power Score - a single at-a-glance number for the whole
  // 5-slot hotbar, not any one weapon. Uses w.damage directly (kept
  // current by setMeleeVariant/upgrades/rarity rolls, see those own call
  // sites) rather than re-deriving it from base WEAPONS data.
  _computeLoadoutPowerScore() {
    let total = 0
    for (const weaponId of this.settings.hotbar) {
      if (!weaponId) continue
      const w = this.weapons.weapons.find((ww) => ww.id === weaponId)
      if (!w || !w.unlocked) continue
      total += (w.damage || 0) * (w.rarityMult || 1) * (w.masteryMult || 1) * (w.upgradeMult || 1)
    }
    return Math.round(total)
  }

  // Digit1-5 switch to whatever's assigned in that hotbar slot (see
  // this.settings.hotbar) - assignment itself happens in the Tab-opened
  // inventory panel (_refreshInventoryPanel's per-weapon slot buttons).
  _bindHotbar() {
    window.addEventListener('keydown', (e) => {
      // Same shared-controls.isLocked reasoning as _bindItemKeys - without
      // this, Digit1-5 in Build Mode would silently switch the real
      // (hidden) weapon system's equipped gun in the background.
      if (this.buildMode.active) return
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

  // One-life-only check, shared by Hardcore Mode, the Daily Challenge's
  // Lockdown twist, and (Local Sharing batch) a Custom Challenge Code that
  // happens to hash to that same twist - all 3 call sites used to repeat
  // this same expression inline.
  _isForceHardcore() {
    return this.settings.hardcoreMode || (this.dailyChallengeActive && this.dailyTwist.forceHardcore) || (this.challengeCodeActive && this.challengeCodeTwist.forceHardcore)
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
    // Perfect Weather (see PERFECT_WEATHER_CHANCE's own comment) - checked
    // first and, if it hits, short-circuits every other weather state off
    // for the night rather than being just another slice of the same roll.
    this.perfectWeather = Math.random() < PERFECT_WEATHER_CHANCE
    if (this.perfectWeather) {
      this.raining = false
      this.snowing = false
      this.sandstorming = false
      this.heatwave = false
      this.rainOverlayEl.style.display = 'none'
      this.snowOverlayEl.style.display = 'none'
      if (this.sandstormOverlayEl) this.sandstormOverlayEl.style.display = 'none'
      // Guarded the same way as flood below - don't clobber an in-progress
      // flood's slowdown (_checkFlooding clears this on its own timer) just
      // because the weather re-rolled to Perfect in the same window.
      if (this.player && !this._floodActiveUntil) this.player.environmentMult = 1
      this.nextLightningAt = 0
      // Guarded - _rollWeather is called once from the constructor itself,
      // before this.loreToast (a DOM ref assigned later in it) exists yet.
      if (this.loreToast) this._showLoreToast(t('perfectWeatherToast'))
      return
    }
    const roll = Math.random()
    this.raining = roll < 0.3
    this.snowing = !this.raining && roll < 0.45
    // Sandstorm/heatwave roll independently of rain/snow (mutually
    // exclusive with EACH OTHER, but rain/snow already excluded themselves
    // above) - small enough chances that most nights still have neither.
    this.sandstorming = !this.raining && !this.snowing && Math.random() < SANDSTORM_CHANCE
    this.heatwave = !this.sandstorming && Math.random() < HEATWAVE_CHANCE
    this.rainOverlayEl.style.display = this.raining ? 'block' : 'none'
    this.snowOverlayEl.style.display = this.snowing ? 'block' : 'none'
    if (this.sandstormOverlayEl) this.sandstormOverlayEl.style.display = this.sandstorming ? 'block' : 'none'
    // Sandstorm's actual movement slowdown (see SANDSTORM_SPEED_MULT's own
    // comment) - was previously only ever a visual overlay + toast with no
    // real gameplay effect, unlike heatwave's thirst-drain multiplier just
    // below this function. Shares PlayerController's environmentMult slot
    // with flood (see that field's own comment - the two are mutually
    // exclusive by construction, sandstorm only rolls when !raining and
    // flood only rolls when raining) - guarded so a re-roll can't clobber
    // an in-progress flood still counting down on its own timer.
    if (this.player && !this._floodActiveUntil) this.player.environmentMult = this.sandstorming ? SANDSTORM_SPEED_MULT : 1
    // Same constructor-ordering guard as the perfectWeather branch above.
    if (this.loreToast) {
      if (this.sandstorming) this._showLoreToast(t('sandstormToast'))
      else if (this.heatwave) this._showLoreToast(t('heatwaveToast'))
    }
    this.nextLightningAt = this.raining ? performance.now() + LIGHTNING_MIN_DELAY_MS + Math.random() * LIGHTNING_DELAY_RANGE_MS : 0
    // Flashlight range in heavy rain (see FLASHLIGHT_RAIN_RANGE_MULT's own
    // comment) - restored the instant rain stops, same as every other
    // per-night weather toggle here.
    if (this.flashlight) this.flashlight.distance = FLASHLIGHT_BASE_RANGE * (this.raining ? FLASHLIGHT_RAIN_RANGE_MULT : 1)
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
      this._showLoreToast(this._rivalsClaimedByName ? RIVAL_BANTER.claimed(this._rivalsClaimedByName) : t('airdropStolenByRivals'))
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
      const leaderName = this.rivals.spawnSquad(x, z, 2)
      this._showLoreToast(RIVAL_BANTER.spotted(leaderName))
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

    // Lightning can now actually strike the player too (see
    // LIGHTNING_PLAYER_STRIKE_CHANCE's own comment - additive to the
    // zombie-flinch effect above, not a replacement for it).
    if (this.playerState.alive && Math.random() < LIGHTNING_PLAYER_STRIKE_CHANCE) {
      this.playerState.takeDamage(LIGHTNING_PLAYER_STRIKE_DAMAGE)
      this._updateHealthHud()
      this._triggerShake(0.2, 300)
      this._showLoreToast(t('lightningStruckToast'))
      if (!this.playerState.alive) this._maybeLastStandOrDie()
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
    audioEngine.updateAmbientZone(this.isIndoors)
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
    const shadowSq = (WORLD_SHADOW_CULL_DISTANCE * this._perfDistanceMult * this._adaptiveShadowMult) ** 2
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
    // Nearest-K cap on top of the distance cull above - a dense cluster
    // (several streetlamps/beacons all within LIGHT_CULL_DISTANCE at once,
    // e.g. standing in the mall or the safe zone) can still leave far more
    // lights on at once than the distance check alone would catch, so only
    // the MAX_ACTIVE_LIGHTS nearest of the in-range candidates actually
    // stay on; the rest are within range but capped off anyway.
    const candidates = this._lightCullScratch
    candidates.length = 0
    for (const f of this.flickerLights) {
      const dx = f.light.position.x - playerPos.x
      const dz = f.light.position.z - playerPos.z
      const distSq = dx * dx + dz * dz
      if (distSq < lightCullSq) {
        f.light.visible = true
        f._cullDistSq = distSq
        candidates.push(f)
      } else {
        f.light.visible = false
      }
    }
    if (candidates.length > MAX_ACTIVE_LIGHTS) {
      candidates.sort((a, b) => a._cullDistSq - b._cullDistSq)
      for (let i = MAX_ACTIVE_LIGHTS; i < candidates.length; i++) candidates[i].light.visible = false
    }
    for (const obj of this.cullables) {
      const dx = obj.position.x - playerPos.x
      const dz = obj.position.z - playerPos.z
      const distSq = dx * dx + dz * dz
      const wantsVisible = distSq < cullSq
      obj.visible = wantsVisible
      // A hidden (visible=false) object still gets walked and matrix-
      // updated by scene.updateMatrixWorld() every frame - hiding isn't
      // removing. Actually detaching it from the scene graph while out of
      // range (and reattaching to its ORIGINAL parent - never the scene
      // root, since some cullables are children of building groups and
      // rely on that group's transform) skips that cost entirely. See
      // docs/PERFORMANCE.md Option A1; __parkedParent is captured once per
      // object at the end of World.js's buildWorld(), before anything is
      // ever detached. Colliders are a separate Box3 array untouched by
      // this, so raycasts/collision against culled objects are unaffected.
      if (wantsVisible) {
        if (!obj.parent) obj.__parkedParent.add(obj)
      } else if (obj.parent) {
        obj.parent.remove(obj)
      }
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
    // Rare bonus second reward roll - the vault only ever opens once per
    // run (this.vault.opened above), so this is the one chance to roll it.
    if (Math.random() < VAULT_BONUS_ROLL_CHANCE) {
      this.pickups.spawnLootDrop('rare_weapon', this.vault.x, this.vault.z - 1)
      this._showLoreToast(t('toastVaultBonusRoll'))
    } else {
      this._showLoreToast(t('toastVaultOpened', { n: VAULT_REWARD_POINTS }))
    }
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
    const rareCandidates = candidates.filter((w) => w.rare)
    const commonCandidates = candidates.filter((w) => !w.rare)
    const pool = rareCandidates.length > 0 && Math.random() < MYSTERY_BOX_RARE_CHANCE ? rareCandidates : commonCandidates
    const pick = pool[Math.floor(Math.random() * pool.length)]
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
    // Diseased Survivor (see RescueSurvivor's own signal-color comment and
    // _rescueSurvivor's infection roll) - a real risk/reward variant, not
    // a guaranteed-safe rescue every time.
    const diseased = Math.random() < DISEASED_SURVIVOR_CHANCE
    this.rescueSurvivor = new RescueSurvivor(this.scene, spot.x, spot.z, diseased)
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

    this._recordRunEnd(true)

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
    // Diseased Survivor (see RescueSurvivor.js's signal-color tell and
    // _spawnRescueSurvivor's spawn roll) - the reward is the same either
    // way, but a diseased one carries a real chance of infecting the
    // player too, same playerState.infected flag a zombie hit sets
    // (see cureInfection's own direct-set precedent) - not routed through
    // takeDamage() since this isn't damage, just an infection risk.
    if (this.rescueSurvivor.diseased && !this.playerState.infected && Math.random() < DISEASED_INFECTION_CHANCE) {
      this.playerState.infected = true
      this._showLoreToast(t('survivorRescuedInfected', { reward: RESCUE_POINTS_REWARD }))
    } else if (this.rescueSurvivor.diseased) {
      this._showLoreToast(t('survivorRescuedLucky', { reward: RESCUE_POINTS_REWARD }))
    } else {
      this._showLoreToast(t('survivorRescued', { reward: RESCUE_POINTS_REWARD }))
    }
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
    // Vault compass icon - only worth showing once the key is actually in
    // hand (before that, there's nothing useful to do there yet).
    if (this.inventory.vaultKey) {
      landmarks.push({ el: this.compassVault, x: this.vault.x, z: this.vault.z })
    } else {
      this.compassVault.style.display = 'none'
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
    // Build Mode is a fully standalone sandbox (see BuildMode.js's own
    // comment) - while active, none of the normal survival tick logic
    // below runs at all, not even the FPS counter.
    if (this.buildMode.active) {
      const dt = Math.min(this.timer.getDelta(), 0.1)
      this.buildMode.update(dt)
      this.buildMode.render()
      return
    }
    this._fpsFrameCount++
    const nowFps = performance.now()
    const fpsElapsed = nowFps - this._fpsLastUpdate
    if (fpsElapsed >= 500) {
      const fps = Math.round((this._fpsFrameCount * 1000) / fpsElapsed)
      const msPerFrame = (fpsElapsed / this._fpsFrameCount).toFixed(1)
      // Extended perf overlay - zombie count and draw calls alongside the
      // fps/frame-time this already showed, so a real slowdown's likely
      // cause is visible without opening devtools. Reads the value
      // captured right after last frame's composer.render() (see bottom
      // of _tick and the autoReset=false note near renderer creation) -
      // reading renderer.info.render.calls live here would always show 1,
      // see docs/PERFORMANCE.md §3.
      const drawCalls = this._lastFrameDrawCalls
      this.fpsEl.textContent = `${fps} fps / ${msPerFrame} ms / ${this.zombies.zombies.length} zmb / ${drawCalls} draws`
      // Frame-Time Graph (opt-in, Controls tab) - a small history buffer
      // of the same msPerFrame value the text readout above already
      // computes, drawn as a sparkline rather than just the latest number.
      if (this.settings.frameTimeGraph) {
        if (!this._frameTimeHistory) this._frameTimeHistory = []
        this._frameTimeHistory.push(Number(msPerFrame))
        if (this._frameTimeHistory.length > 60) this._frameTimeHistory.shift()
        this._drawFrameTimeGraph()
      }
      this._fpsFrameCount = 0
      this._fpsLastUpdate = nowFps
      this._updateAdaptiveShadowQuality(fps)

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
    // Manual slow-motion toggle (see _toggleSlowMo) - a deliberate content-
    // creation tool, checked as its own branch so it never fights the
    // automatic killcam/hitstop effects above (whichever's already active
    // wins; this one only ever applies when neither of those is).
    else if (this._manualSlowMoActive) dt *= MANUAL_SLOWMO_FACTOR

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
      // The Long Road (see _recordRunEnd) - lifetime ground-distance
      // milestone. Horizontal only (x/z), so jumping in place doesn't
      // count - ground actually covered, not vertical bobbing.
      if (this._lastDistPos) {
        this._runDistanceTraveled += Math.hypot(playerPos.x - this._lastDistPos.x, playerPos.z - this._lastDistPos.z)
        this._lastDistPos.x = playerPos.x
        this._lastDistPos.z = playerPos.z
      } else {
        this._lastDistPos = { x: playerPos.x, z: playerPos.z }
      }
      this._updateThirdPerson()
      const isMoving = this.player.onGround && (
        this.player.input.forward || this.player.input.back ||
        this.player.input.left || this.player.input.right
      )
      if (isMoving) {
        this.footstepTimer -= dt
        if (this.footstepTimer <= 0) {
          this.footstepTimer = this.player.isSprinting ? FOOTSTEP_INTERVAL_SPRINT : FOOTSTEP_INTERVAL_WALK
          const p = this.player.controls.object.position
          const onGrass = this.grassBounds && p.x >= this.grassBounds.xMin && p.x <= this.grassBounds.xMax && p.z >= this.grassBounds.zMin && p.z <= this.grassBounds.zMax
          audioEngine.playFootstep(this.isIndoors, onGrass ? 'grass' : 'default')
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
      const currentWeapon = this.weapons.current
      this.player.weaponWeightMult = currentWeapon.heavy ? WEAPON_HEAVY_SPEED_MULT : (currentWeapon.light ? WEAPON_LIGHT_SPEED_MULT : 1)
      this.player.isSwimming = !!this.waterBounds && playerPos.x >= this.waterBounds.xMin && playerPos.x <= this.waterBounds.xMax && playerPos.z >= this.waterBounds.zMin && playerPos.z <= this.waterBounds.zMax
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
        this.rollingQuests.recordNight(this.night)
        this._checkBestRunPace()
        this._maybeTriggerRareEasterEgg()
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
        (zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing) => this._onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing),
        this.player.isCrouching || this.player.isProne,
        this.dayNight ? this.dayNight.getPhaseInfo().phase === 'Night' : false,
        (x, z) => this._spawnHazardZone('acid', x, z),
        (originX, originZ) => this._onZombiePull(originX, originZ),
        () => this._triggerShake(0.18, 600),
        (x, z) => this._spawnHazardZone('web', x, z),
        this._camDir.x,
        this._camDir.z,
        this.barricadeWindows.windows,
        this._collectCompanionTargets(),
        this.player.isProne
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
      this._updateBuriedCaches(playerPos)
      this._updateSecretSequenceBonus()
      this._checkUndiscoveredLandmarkChime(playerPos)
      this._maybeSpawnGoldenZombie()
      this._checkReclaimedArea(playerPos)
      this._checkHordeDensityAudio(playerPos)
      this._checkRoundModeSpecialEvents()
      this._checkRainStumble(playerPos)
      this._checkEarthquake(playerPos)
      this._checkFlooding()
      this._checkSwarmBite()
      this._checkPowerSurge()
      this._checkRooftopWind(playerPos)
      this._updateLockedCells(playerPos)
      this._updateTrophyWallProximity(playerPos)
      // Interactive World batch.
      this._updateManholeCovers(playerPos)
      this._updateCampfire(playerPos)
      this._updateWaterTowerValve(playerPos)
      this._updateIndustrialSiren(playerPos)
      this._updateWreckingPendulum(playerPos)
      this._updateElevatorTower(playerPos)
      this._updatePayphone(playerPos)
      this._updateBarricadeCrates(dt, playerPos)
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
        this.interactPrompt.innerHTML = tHtml(this.rescueSurvivor.diseased ? 'interactRescueDiseased' : 'interactRescue')
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
      } else if (this.nearBuriedCache) {
        this.interactPrompt.innerHTML = tHtml('interactBuriedCache')
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
      } else if (this.nearManholeCover) {
        this.interactPrompt.innerHTML = tHtml('interactManhole')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearCampfire) {
        this.interactPrompt.innerHTML = tHtml('interactCampfire')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearWaterTowerValve) {
        this.interactPrompt.innerHTML = tHtml('interactValve')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearIndustrialSiren) {
        this.interactPrompt.innerHTML = tHtml('interactSiren')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearWreckingPendulum) {
        this.interactPrompt.innerHTML = tHtml('interactPendulum')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearElevatorCar) {
        this.interactPrompt.innerHTML = tHtml('interactElevator')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearPayphone && !this.payphoneUsedThisRun) {
        this.interactPrompt.innerHTML = tHtml('interactPayphone')
        this.interactPrompt.style.display = 'block'
      } else {
        this.interactPrompt.style.display = 'none'
      }
      this._updateZipline(playerPos)
      // Throttled to ~20fps (imperceptible for a corner minimap/compass,
      // unlike the main 3D view) - a canvas redraw + several DOM position
      // writes every single frame was real, unnecessary cost 60 times a
      // second for UI that reads identically at 20.
      if (performance.now() >= this._nextPeripheralUiUpdateAt) {
        this._nextPeripheralUiUpdateAt = performance.now() + PERIPHERAL_UI_UPDATE_INTERVAL_MS
        this._updateMinimap(playerPos)
        this._updateCompass(playerPos)
      }
      this._updateHordeAnnouncement()
      this._updateBarricades()
      this._updateDeathObstacles()
      this._updateHazardZones(dt, playerPos)
      this._maybeShowRadioChatter()
      this._updateLowAmmoCue()
      this._updatePracticeTargets()
      this._updateTraps()
      this._updateAlarms()
      const rivalResult = this.rivals.update(dt, playerPos, (dmg) => this._onRivalAttack(dmg), this.solidMeshes)
      if (rivalResult.claimed) {
        this._rivalsClaimedAirdrop = true
        this._rivalsClaimedByName = rivalResult.claimedByName
      }
      if (rivalResult.defeatedNames.length > 0) {
        this._showLoreToast(RIVAL_BANTER.defeated(rivalResult.defeatedNames[0]))
        this._pushKillFeed(`${rivalResult.defeatedNames[0]}'s crew wiped out`)
      }
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

    this.renderer.info.reset()
    this.composer.render()
    this._lastFrameDrawCalls = this.renderer.info.render.calls
    this._lastFrameTriangles = this.renderer.info.render.triangles
  }
}

import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { LOW_QUALITY_MODE } from './QualitySettings.js'
import { WeaponCatalog } from './WeaponCatalog.js'
import { Inventory } from './Inventory.js'
import { loadMastery } from './WeaponMastery.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { Quests, QUESTS } from './Quests.js'
import { RollingQuests, EXPIRE_MS as ROLLING_QUEST_EXPIRE_MS } from './RollingQuests.js'
import { COIN_SHOP_ITEMS, ATTACHMENT_TYPES } from './CoinShop.js'

// The Skin Designer page, embedded in #skindesigner-frame. Served from this
// game's own site (public/skin-designer/) since 2026-09-30 - it used to be a
// separate gayzcharacterskindesigner.vercel.app project.
const SKIN_DESIGNER_ORIGIN = window.location.origin
const SKIN_DESIGNER_URL = '/skin-designer/index.html'

// Crate economy (Inventory panel's Crates tab) - buys a chance at a random
// currently-unowned outfit/hat from COIN_SHOP_ITEMS, which have had no
// purchase path since the old Store buy-list was removed (see that file's
// own header comment) - reuses that exact existing reward pool rather than
// inventing new cosmetics. rareChance is the odds of rolling from the
// pricier half of COIN_SHOP_ITEMS (>= CRATE_RARE_COST_THRESHOLD) instead of
// the cheaper half - reuses the cost value already baked into that data as
// the rarity signal, rather than hand-tagging a separate rarity field.
const CRATE_TIERS = {
  wood: { cost: 1000, rareChance: 0.15 },
  ice: { cost: 2000, rareChance: 0.45 },
  golden: { cost: 5000, rareChance: 0.8 },
}
const CRATE_RARE_COST_THRESHOLD = 900
// Same values as each .crate-tier-wood/-ice/-golden CSS class's own
// --crate-tier-color (src/style.css) - duplicated here since the
// purchase modal sets this as an inline style (there's no per-tier class
// on its single shared box to hang a CSS rule off instead).
const CRATE_TIER_COLORS = { wood: '#c9915a', ice: '#8fd9f0', golden: '#f0c23e' }

// Same isometric 3-face icon markup as each .crate-card's own <svg> (see
// index.html), duplicated here as plain strings so the purchase modal
// (Game.js's _openCratePurchaseModal) can inject whichever tier was
// clicked at a bigger size. Gradient ids get a "-modal" suffix - reusing
// the plain tier names here would collide with the Shop/Inventory
// copies' own ids (that exact bug, and why it matters, is documented on
// the crate-icon SVG's own commit - duplicate SVG gradient ids are
// invalid HTML and rendered visibly wrong in one of the three places).
const CRATE_ICON_SVG = {
  wood: `<svg viewBox="0 0 24 24">
    <defs>
      <linearGradient id="wood-top-modal" x1="4" y1="4" x2="20" y2="13" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#e3b57e"/>
        <stop offset="100%" stop-color="#b5824a"/>
      </linearGradient>
      <linearGradient id="wood-left-modal" x1="4" y1="8.5" x2="12" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#a3703f"/>
        <stop offset="100%" stop-color="#6b431f"/>
      </linearGradient>
      <linearGradient id="wood-right-modal" x1="12" y1="13" x2="20" y2="16.5" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#7a5228"/>
        <stop offset="100%" stop-color="#4a2f16"/>
      </linearGradient>
    </defs>
    <polygon points="12,4 20,8.5 12,13 4,8.5" fill="url(#wood-top-modal)" stroke="#4a2f16" stroke-width="0.5"/>
    <polygon points="4,8.5 12,13 12,21 4,16.5" fill="url(#wood-left-modal)" stroke="#4a2f16" stroke-width="0.5"/>
    <polygon points="20,8.5 12,13 12,21 20,16.5" fill="url(#wood-right-modal)" stroke="#4a2f16" stroke-width="0.5"/>
    <path d="M6.5,9.9v8M9.2,11.4v8" stroke="#5c3a1a" stroke-width="0.4" opacity="0.7"/>
    <path d="M17.5,9.9v8M14.8,11.4v8" stroke="#3d2610" stroke-width="0.4" opacity="0.7"/>
    <path d="M12,4v9" stroke="#a3703f" stroke-width="0.4" opacity="0.6"/>
    <circle cx="12" cy="4.6" r="0.9" fill="#f0dcb8"/>
    <circle cx="4.6" cy="8.9" r="0.9" fill="#f0dcb8"/>
    <circle cx="19.4" cy="8.9" r="0.9" fill="#f0dcb8"/>
    <circle cx="12" cy="4.4" r="0.3" fill="#fff" opacity="0.8"/>
    <circle cx="4.4" cy="8.7" r="0.3" fill="#fff" opacity="0.8"/>
    <circle cx="19.2" cy="8.7" r="0.3" fill="#fff" opacity="0.8"/>
  </svg>`,
  ice: `<svg viewBox="0 0 24 24">
    <defs>
      <linearGradient id="ice-top-modal" x1="4" y1="4" x2="20" y2="13" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#eaf9ff"/>
        <stop offset="100%" stop-color="#a8e6f5"/>
      </linearGradient>
      <linearGradient id="ice-left-modal" x1="4" y1="8.5" x2="12" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#b3e6f5"/>
        <stop offset="100%" stop-color="#6fc5e0"/>
      </linearGradient>
      <linearGradient id="ice-right-modal" x1="12" y1="13" x2="20" y2="16.5" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#7fc9e0"/>
        <stop offset="100%" stop-color="#4a9cbc"/>
      </linearGradient>
    </defs>
    <polygon points="12,4 20,8.5 12,13 4,8.5" fill="url(#ice-top-modal)" stroke="#e8fbff" stroke-width="0.5"/>
    <polygon points="4,8.5 12,13 12,21 4,16.5" fill="url(#ice-left-modal)" stroke="#e8fbff" stroke-width="0.5"/>
    <polygon points="20,8.5 12,13 12,21 20,16.5" fill="url(#ice-right-modal)" stroke="#e8fbff" stroke-width="0.5"/>
    <path d="M12,4v9M4,8.5l8,4.5 8,-4.5" stroke="#ffffff" stroke-width="0.4" opacity="0.6" fill="none"/>
    <polygon points="9,3 10.5,1 12,3" fill="#e8fbff"/>
    <polygon points="14,3 15.5,1 17,3" fill="#e8fbff"/>
  </svg>`,
  golden: `<svg viewBox="0 0 24 24">
    <defs>
      <linearGradient id="gold-top-modal" x1="4" y1="4" x2="20" y2="13" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#fde79a"/>
        <stop offset="100%" stop-color="#e8bc3e"/>
      </linearGradient>
      <linearGradient id="gold-left-modal" x1="4" y1="8.5" x2="12" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#e0ab1e"/>
        <stop offset="100%" stop-color="#a67c0a"/>
      </linearGradient>
      <linearGradient id="gold-right-modal" x1="12" y1="13" x2="20" y2="16.5" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#b3860e"/>
        <stop offset="100%" stop-color="#7a5a0a"/>
      </linearGradient>
    </defs>
    <polygon points="12,4 20,8.5 12,13 4,8.5" fill="url(#gold-top-modal)" stroke="#7a5a0a" stroke-width="0.5"/>
    <polygon points="4,8.5 12,13 12,21 4,16.5" fill="url(#gold-left-modal)" stroke="#7a5a0a" stroke-width="0.5"/>
    <polygon points="20,8.5 12,13 12,21 20,16.5" fill="url(#gold-right-modal)" stroke="#7a5a0a" stroke-width="0.5"/>
    <path d="M4,11.8 12,16.3 20,11.8" stroke="#7a5a0a" stroke-width="0.5" fill="none"/>
    <polygon points="16,13.3 17,14.8 16,16.3 15,14.8" fill="#7fe8ff" stroke="#2a7a95" stroke-width="0.3"/>
    <circle cx="4.6" cy="8.9" r="0.9" fill="#fde79a"/>
    <circle cx="19.4" cy="8.9" r="0.9" fill="#fde79a"/>
    <circle cx="4.4" cy="8.7" r="0.3" fill="#fff" opacity="0.8"/>
    <circle cx="19.2" cy="8.7" r="0.3" fill="#fff" opacity="0.8"/>
  </svg>`,
}
import { META_UPGRADES, loadMetaProgress, saveMetaProgress, DEATH_POINTS_CONVERSION } from './MetaProgress.js'
import { playConfig, UPGRADE_PLAY, POINTS_PER_KILL, POINTS_PER_WAVE, DEFENSE_WAVES, BOSS_HUNT_EVERY } from './PlayRules.js'
import { ZOMBIE_TYPES } from './ZombieTypes.js'
import { loadEncountered } from './Bestiary.js'
import { ACTIONS, getKeyFor, setBinding, resetBindings, keyLabel, getAllBindings, setAllBindings } from './Keybinds.js'
import { audioEngine } from './Audio.js'
import { LANGUAGES, setLanguage, t, tHtml } from './i18n.js'
import * as MenuEasterEggs from './MenuEasterEggs.js'
import { MenuAvatar3D, loadSkinTexture, buildTexturedCharacter, DEFAULT_SKIN_DATA_URL, SHOP_SKIN_PREVIEW_DATA_URL } from './MenuAvatar3D.js'
import { InspectViewer } from './InspectViewer.js'
import * as MenuPresets from './MenuPresets.js'
// BuildMode.js is deliberately NOT statically imported here - it's a big,
// self-contained system most visitors never touch (a whole separate
// scene/camera/90+ block types), so it's dynamically imported on first use
// instead (see _enterBuildMode) to keep it out of the initial page load.
import * as CloudSync from './CloudSync.js'
import * as CloudSaveUI from './CloudSaveUI.js'
import * as ChatUI from './ChatUI.js'
import { setColorblindMode } from './Accessibility.js'
import { MARKET_SKINS, MARKET_PRICES } from './MarketSkins.js'
import { shrinkTextures, restoreTextures } from './LiteTextures.js'





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


// Shared with _updateTexts' loadout button labels and the Journal's World
// State section (see _renderJournal) - one lookup instead of two copies.
export const LOADOUT_LABEL_KEYS = { balanced: 'loadoutBalanced', runner: 'loadoutRunner', tank: 'loadoutTank' }
// Main-menu news ticker thresholds (see _updateMenuNewsTicker) - both read
// against bestStats.bestNight.
const NEWS_TICKER_MID_NIGHT = 5
const NEWS_TICKER_LATE_NIGHT = 15
// The Upgrades panel lists only the upgrades that do something in a Map 1
// run (PlayRules.js's UPGRADE_PLAY); the rest wait for a block-city version.
const PLAY_META_UPGRADES = META_UPGRADES.filter((u) => UPGRADE_PLAY[u.id])

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

const SETTINGS_STORAGE_KEY = 'gayz-settings'

// Corner-badge player ID - 6-10 uppercase letters/digits, generated once
// and kept stable for that account. Distinct from the nickname (still
// editable, still used for companion naming/leaderboards/friend search
// elsewhere) - this is only what the corner badge itself displays now.
const PLAYER_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const PLAYER_ID_LENGTH = 6
function _generatePlayerId() {
  let id = ''
  for (let i = 0; i < PLAYER_ID_LENGTH; i++) id += PLAYER_ID_CHARS[Math.floor(Math.random() * PLAYER_ID_CHARS.length)]
  return id
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    // A genuinely new player (no settings saved at all yet) gets a
    // "Survivor####" starter nickname instead of a blank field (changed
    // 2026-09-11 from "Warrior####", to match the "Survivor" wording
    // _defaultNickname() already uses elsewhere for the blank-nickname
    // fallback) - an existing player who has settings saved but left
    // their nickname blank on purpose keeps it blank, never overwritten
    // on a later load.
    const defaultNickname = raw ? '' : `Survivor${Math.floor(1000 + Math.random() * 9000)}`
    const settings = {
      language: parsed.language || 'en',
      masterVolume: parsed.masterVolume ?? 100,
      sfxVolume: parsed.sfxVolume ?? 100,
      ambientVolume: parsed.ambientVolume ?? 100,
      muteOnTabBlur: parsed.muteOnTabBlur ?? false,
      positionalAudio: parsed.positionalAudio ?? true,
      difficulty: DIFFICULTY_PRESETS[parsed.difficulty] ? parsed.difficulty : 'normal',
      sensitivity: parsed.sensitivity ?? 100,
      invertY: parsed.invertY ?? false,
      fov: parsed.fov ?? 75,
      hudScale: parsed.hudScale ?? 100,
      hudOpacity: parsed.hudOpacity ?? 100,
      // Replaced the old boolean 'colorblind' toggle with a 3-way mode
      // (off/redgreen/blueyellow) - redgreen covers protanopia/deuteranopia
      // (the old single mode, unchanged) and blueyellow is a new,
      // genuinely different palette for tritanopia, which the old amber/
      // blue scheme actually sat right on top of (amber-vs-blue is exactly
      // the hue pair tritanopes confuse - see Accessibility.js). Migrates
      // an old save's boolean straight across so nobody's existing
      // preference silently resets to Off.
      colorblindMode: parsed.colorblindMode ?? (parsed.colorblind ? 'redgreen' : 'off'),
      autoLootRadius: parsed.autoLootRadius ?? 'medium',
      performanceMode: parsed.performanceMode ?? false,
      // Accessibility (see the settings-page-controls HTML section) -
      // shakeIntensity/toastDuration are percentages of the normal/default
      // value, not absolute units.
      // Split from the old single shakeIntensity into two independent
      // sliders (weapon recoil kick vs damage/explosion impact shake) -
      // both fall back to whatever the old combined value already was, so
      // an existing save doesn't silently reset to 100/100.
      recoilShakeIntensity: parsed.recoilShakeIntensity ?? parsed.shakeIntensity ?? 100,
      damageShakeIntensity: parsed.damageShakeIntensity ?? parsed.shakeIntensity ?? 100,
      reduceFlashing: parsed.reduceFlashing ?? false,
      toggleSprint: parsed.toggleSprint ?? false,
      toggleCrouch: parsed.toggleCrouch ?? false,
      toggleAds: parsed.toggleAds ?? false,
      aimAssist: parsed.aimAssist ?? false,
      touchControlsOverride: ['auto', 'touch', 'desktop'].includes(parsed.touchControlsOverride) ? parsed.touchControlsOverride : 'auto',
      clanId: typeof parsed.clanId === 'string' ? parsed.clanId : null,
      clanTag: typeof parsed.clanTag === 'string' ? parsed.clanTag : null,
      clanName: typeof parsed.clanName === 'string' ? parsed.clanName : null,
      bigInteractPrompt: parsed.bigInteractPrompt ?? false,
      toastDuration: parsed.toastDuration ?? 100,
      crosshairColor: parsed.crosshairColor || '#ffffff',
      crosshairSize: parsed.crosshairSize ?? 100,
      adsFov: parsed.adsFov ?? 45,
      motionBlur: parsed.motionBlur ?? false,
      autoQuality: parsed.autoQuality ?? true,
      fpsCap: parsed.fpsCap ?? 0,
      mouseAcceleration: parsed.mouseAcceleration ?? false,
      invertScrollWeaponSwitch: parsed.invertScrollWeaponSwitch ?? false,
      doubleClickSpeed: parsed.doubleClickSpeed ?? 300,
      gamepadDeadzone: parsed.gamepadDeadzone ?? 20,
      gamepadVibration: parsed.gamepadVibration ?? true,
      mutedChatPlayers: Array.isArray(parsed.mutedChatPlayers) ? parsed.mutedChatPlayers : [],
      // Private per-player notes (Other Profile popup) - keyed by the
      // OTHER player's stable playerId, never synced anywhere, only ever
      // read/written by this local client. A plain object (not an array)
      // since lookup is always "the note for THIS specific playerId."
      playerNotes: (parsed.playerNotes && typeof parsed.playerNotes === 'object') ? parsed.playerNotes : {},
      killFeedPosition: parsed.killFeedPosition === 'left' ? 'left' : 'right',
      killFeedIcons: parsed.killFeedIcons ?? true,
      killFeedVerbosity: parsed.killFeedVerbosity === 'important' ? 'important' : 'all',
      petAdopted: parsed.petAdopted ?? false,
      compassStyle: parsed.compassStyle === 'degrees' ? 'degrees' : 'letters',
      showWeaponNameHud: parsed.showWeaponNameHud ?? true,
      minimapDefaultZoom: parsed.minimapDefaultZoom ?? 1,
      friendPresenceNotify: parsed.friendPresenceNotify ?? true,
      dailyChallengeReminder: parsed.dailyChallengeReminder ?? true,
      timeFormat: parsed.timeFormat === '24h' ? '24h' : '12h',
      autoSaveFrequencySec: parsed.autoSaveFrequencySec ?? 30,
      hudFpsCounter: parsed.hudFpsCounter ?? true,
      ammoPosition: parsed.ammoPosition === 'left' || parsed.ammoPosition === 'center' ? parsed.ammoPosition : 'right',
      healthDisplayStyle: ['bar', 'number', 'both'].includes(parsed.healthDisplayStyle) ? parsed.healthDisplayStyle : 'both',
      lowAmmoFlash: parsed.lowAmmoFlash ?? true,
      sessionTimerHud: parsed.sessionTimerHud ?? false,
      difficultyLabelHud: parsed.difficultyLabelHud ?? false,
      objectiveDistanceHud: parsed.objectiveDistanceHud ?? true,
      achievementToasts: parsed.achievementToasts ?? true,
      rankUpToasts: parsed.rankUpToasts ?? true,
      leaderboardRankAlerts: parsed.leaderboardRankAlerts ?? true,
      weeklyChallengeReminder: parsed.weeklyChallengeReminder ?? true,
      lowCurrencyReminder: parsed.lowCurrencyReminder ?? true,
      backupReminder: parsed.backupReminder ?? true,
      lastExportAt: parsed.lastExportAt || 0,
      confirmSignOut: parsed.confirmSignOut ?? false,
      stayEmbedSignedIn: parsed.stayEmbedSignedIn ?? true,
      anonymousLeaderboard: parsed.anonymousLeaderboard ?? false,
      shareTelemetry: parsed.shareTelemetry ?? true,
      autoDeclineFriendRequests: parsed.autoDeclineFriendRequests ?? false,
      exactLastSeen: parsed.exactLastSeen ?? false,
      rememberSettingsTab: parsed.rememberSettingsTab ?? false,
      lastSettingsTab: parsed.lastSettingsTab || 'general',
      confirmRemoveFriend: parsed.confirmRemoveFriend ?? false,
      reduceBgEffects: parsed.reduceBgEffects ?? false,
      autoReloadOnEmpty: parsed.autoReloadOnEmpty ?? true,
      autoLoot: parsed.autoLoot ?? false,
      instantStationInteract: parsed.instantStationInteract ?? false,
      damageFlashColor: typeof parsed.damageFlashColor === 'string' ? parsed.damageFlashColor : '#c80000',
      oneHandedLayout: parsed.oneHandedLayout ?? false,
      sortWeaponsAlpha: parsed.sortWeaponsAlpha ?? false,
      homepageGreeting: typeof parsed.homepageGreeting === 'string' ? parsed.homepageGreeting.slice(0, 40) : '',
      whatsNewEveryLaunch: parsed.whatsNewEveryLaunch ?? false,
      // Corner-badge ID (see _generatePlayerId above) - unlike nickname,
      // this always backfills if missing (not just for a fully-fresh
      // player), since it's a new field every already-existing save is
      // missing the first time this ships. Also regenerates once for any
      // existing player whose saved id predates the fixed 6-character
      // length (the old format was randomly 6-10 characters) - a one-time
      // move onto the new format, not something that keeps re-rolling.
      // playerIdRegenerated (below) is read by the immediate-persist guard
      // a few lines down - without it, this "one-time" regeneration wasn't
      // actually one-time: the old-length check kept failing on every
      // load (nothing here ever writes the fresh id back for that specific
      // case, only the "missing entirely" case), so a player with a
      // legacy long id got a brand new RANDOM id every single reload,
      // never persisted, until some unrelated settings change happened to
      // save it - found live 2026-09-11 from a player reporting their
      // corner-badge id kept changing on every plain refresh.
      playerId: parsed.playerId && parsed.playerId.length === PLAYER_ID_LENGTH ? parsed.playerId : _generatePlayerId(),
      nickname: parsed.nickname || defaultNickname,
      // Nickname color (see nickname display sites - Hardcore Memorial, kill
      // feed) - a plain hex string like crosshairColor above, not tied to
      // any purchase.
      nicknameColor: parsed.nicknameColor || '#ffffff',
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
      // A real uploaded Minecraft skin PNG (see MenuAvatar3D.js's UV
      // support + _bindSkinUpload/_applyStoredSkin below), stored as a
      // data URL so it survives a reload without needing a server. null
      // means "no custom skin, use the default flat-color character."
      customSkinDataUrl: typeof parsed.customSkinDataUrl === 'string' ? parsed.customSkinDataUrl : null,
      // Profile bio - free text, capped at 250 chars (see _renderProfileBio).
      // 5000, not a hard product decision so much as "no real limit, but
      // still some sane ceiling" (2026-09-23, explicit "write as much as
      // you want" request) - was 250.
      bio: typeof parsed.bio === 'string' ? parsed.bio.slice(0, 5000) : '',
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
      // Game Modes grid (Choose Your Challenge) - 'classic' is plain
      // Zombie Survival, no special mutator. zombieDefense/bossHunt/
      // zombieRush are all real, built modes; only zombieExtraction stays
      // locked (Coming Soon) in the grid - see _bindGameModeSelect for how
      // picking one of the 3 built modes drives its matching
      // settings.mutators.* flag.
      selectedGameMode: ['classic', 'zombieDefense', 'bossHunt', 'zombieRush'].includes(parsed.selectedGameMode) ? parsed.selectedGameMode : 'classic',
      // 3-slot hotbar (see Game.js's _bindHotbar) - slot 0 is whatever gun
      // was picked in the Play/Pause weapon picker, slots 1-2 are the fixed
      // M1911/Knife backup weapons every run starts with.
      hotbar: Array.isArray(parsed.hotbar) && parsed.hotbar.length === 3 ? parsed.hotbar : ['rifle', 'pistol', 'melee'],
      // Loadout save slots (see Game.js's _saveHotbarPreset/_loadHotbarPreset) -
      // 3 named snapshots of the 3-slot hotbar above, so switching between a
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
      // Second Online Features batch - saved friends (now `{name, uid}`
      // objects, was a plain nickname string until the presence/status
      // batch needed a real uid to look status up by - normalize any
      // pre-existing plain-string entries here rather than a one-time
      // migration, since a saved friend re-accepted after that point
      // already writes the new shape anyway, see _respondToFriendRequest)
      // and every mutator id ever toggled on at least once (backs the
      // "you haven't tried X yet" spotlight nudge).
      savedFriends: Array.isArray(parsed.savedFriends)
        ? parsed.savedFriends.slice(0, 5).map((f) => (typeof f === 'string' ? { name: f, uid: null } : f))
        : [],
      // Presence status the player picks in the Friends panel - one of
      // 'online'/'idle'/'dnd'/'offline' (see _computeFriendStatus).
      statusMode: ['online', 'idle', 'dnd', 'offline'].includes(parsed.statusMode) ? parsed.statusMode : 'online',
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
      liteTextures: parsed.liteTextures ?? false,
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
      selectedGoals: Array.isArray(parsed.selectedGoals) ? parsed.selectedGoals.slice(0, MAX_GOALS) : [],
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
      layoutDensity: parsed.layoutDensity || 'cozy',
      pinnedStat: parsed.pinnedStat || null,
      companionNameColor: parsed.companionNameColor || null,
      pinnedPreset: Number.isInteger(parsed.pinnedPreset) ? parsed.pinnedPreset : null,
      navOrder: Array.isArray(parsed.navOrder) && parsed.navOrder.length === 8 ? parsed.navOrder : ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'menu-inventory-btn', 'quests-btn', 'friends-btn', 'achievements-btn'],
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
      // Default flipped 2026-09-11 (explicit request) - 'old' is now what
      // a player with no saved preference gets. An existing player whose
      // settings already have an explicit 'golden' saved (anyone who's
      // loaded the game since this was the default) keeps seeing golden,
      // not silently switched - only a genuinely fresh/never-set value
      // falls through to the new default.
      uiTheme: parsed.uiTheme === 'golden' ? 'golden' : 'old',
      lastSeenBuildId: parsed.lastSeenBuildId || null,
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
        zombieDefense: parsed.mutators?.zombieDefense ?? false,
        bossHunt: parsed.mutators?.bossHunt ?? false,
        zombieRush: parsed.mutators?.zombieRush ?? false,
        escalation: parsed.mutators?.escalation ?? false,
        cursedRun: parsed.mutators?.cursedRun ?? false,
        randomizer: parsed.mutators?.randomizer ?? false,
      },
    }
    // Repairs a hotbar with empty (null) slots - a real save could have
    // gotten into this state from _assignHotbarSlot's old overwrite bug
    // (fixed 2026-08-20, see that function's own comment: assigning a
    // weapon to an occupied slot used to just drop the previous occupant
    // instead of swapping it elsewhere). The array-shape check just above
    // only replaces the whole hotbar if it isn't a valid 3-length array,
    // so a save with e.g. ['harpoon', null, null] passed through
    // untouched - backfill each null slot with the first default weapon
    // not already present elsewhere on the hotbar.
    if (settings.hotbar.includes(null)) {
      const fallbacks = ['rifle', 'pistol', 'melee']
      for (let i = 0; i < settings.hotbar.length; i++) {
        if (settings.hotbar[i] !== null) continue
        const fill = fallbacks.find((id) => !settings.hotbar.includes(id))
        if (fill) settings.hotbar[i] = fill
      }
    }
    // The homepage name display's old default color (pale gold) is being
    // replaced with plain white - an existing save whose nicknameColor is
    // still exactly that old default (never touched via the Settings color
    // picker) gets migrated forward too, not just brand-new saves, since
    // the `parsed.nicknameColor || '#ffffff'` fallback above only ever
    // catches a genuinely missing field, never an already-persisted old
    // default value.
    if (settings.nicknameColor === '#ffe88a') settings.nicknameColor = '#ffffff'
    // A genuinely new player's generated defaults (starter nickname, etc.)
    // only exist in memory otherwise - persist them right away so a page
    // refresh before any real settings change doesn't silently generate a
    // second, different "Survivor####" and lose the first one. Also fires
    // for an EXISTING player whose saved settings predate the playerId
    // field (just backfilled above), OR whose playerId is in the old
    // pre-fixed-length format (also just regenerated above) - either way
    // that freshly-generated ID only lives in memory until their next
    // unrelated settings change, and would get silently REPLACED WITH A
    // DIFFERENT RANDOM ID (not just "lost once", but every single reload
    // in a loop) if they leave before that happens - this second OR
    // clause was missing until 2026-09-11 (see playerId's own comment
    // above), so every reload for an old-format account rolled a brand
    // new id that never saved, forever, until some unrelated setting
    // change happened to catch it.
    if (!raw || !parsed.playerId || parsed.playerId.length !== PLAYER_ID_LENGTH) localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return settings
  } catch {
    return defaultSettings()
  }
}

// Restore Default Settings (see _restoreDefaultSettings) reuses this exact
// same shape loadSettings' own catch-block fallback already used inline -
// extracted once so there's a single source of truth for "what are the
// defaults" instead of two copies drifting apart.
function defaultSettings() {
  return { language: 'en', playerId: _generatePlayerId(), masterVolume: 100, sfxVolume: 100, ambientVolume: 100, muteOnTabBlur: false, positionalAudio: true, difficulty: 'normal', sensitivity: 100, invertY: false, fov: 75, hudScale: 100, hudOpacity: 100, colorblindMode: 'off', recoilShakeIntensity: 100, damageShakeIntensity: 100, adsFov: 45, motionBlur: false, autoQuality: true, fpsCap: 0, mouseAcceleration: false, invertScrollWeaponSwitch: false, doubleClickSpeed: 300, gamepadDeadzone: 20, gamepadVibration: true, killFeedPosition: 'right', killFeedIcons: true, killFeedVerbosity: 'all', petAdopted: false, compassStyle: 'letters', showWeaponNameHud: true, minimapDefaultZoom: 1, friendPresenceNotify: true, dailyChallengeReminder: true, timeFormat: '12h', autoSaveFrequencySec: 30, hudFpsCounter: true, ammoPosition: 'right', healthDisplayStyle: 'both', lowAmmoFlash: true, sessionTimerHud: false, difficultyLabelHud: false, objectiveDistanceHud: true, achievementToasts: true, rankUpToasts: true, leaderboardRankAlerts: true, weeklyChallengeReminder: true, lowCurrencyReminder: true, backupReminder: true, lastExportAt: 0, confirmSignOut: false, stayEmbedSignedIn: true, anonymousLeaderboard: false, shareTelemetry: true, autoDeclineFriendRequests: false, exactLastSeen: false, rememberSettingsTab: false, lastSettingsTab: 'general', confirmRemoveFriend: false, reduceBgEffects: false, autoReloadOnEmpty: true, autoLoot: false, autoLootRadius: 'medium', instantStationInteract: false, damageFlashColor: '#c80000', oneHandedLayout: false, sortWeaponsAlpha: false, homepageGreeting: '', whatsNewEveryLaunch: false, reduceFlashing: false, toggleSprint: false, toggleCrouch: false, toggleAds: false, aimAssist: false, touchControlsOverride: 'auto', clanId: null, clanTag: null, clanName: null, bigInteractPrompt: false, toastDuration: 100, crosshairColor: '#ffffff', crosshairSize: 100, nickname: '', nicknameColor: '#ffffff', companionName: '', companionColor: null, avatarChoice: null, customSkinDataUrl: null, bio: '', streamSafeMode: false, defaultTag: null, companionRole: 'ranged', scoreAttackMode: false, hardcoreMode: false, guestMode: false, endlessMode: false, loadout: 'balanced', selectedGameMode: 'classic', performanceMode: false, hotbar: ['rifle', 'pistol', 'melee'], hotbarPresets: [null, null, null], showcaseSlots: [null, null, null], menuPresets: [], mutedBeforeVolumes: null, quickLanguageAlt: 'es', savedFriends: [], mutedChatPlayers: [], playerNotes: {}, statusMode: 'online', mutatorsEverEnabled: [], region: 'global', largeTextMode: false, highContrastMode: false, dyslexiaFont: false, bgMood: 'auto', keybindCheatSheet: false, showHitFeedback: true, renderResolution: 100, brightness: 100, contrast: 100, aoIntensity: 0, shadowsEnabled: false, shadowQuality: 'medium', liteTextures: false, bulletHolesEnabled: true, bloodEffectsEnabled: true, damageIndicatorEnabled: true, damageNumbersEnabled: true, damageNumbersScale: 100, grainIntensity: 100, panelFlickerEnabled: true, focusRingMode: false, homepageFpsCounter: false, selectedGoals: [], underlineLinks: false, friendBeatNotified: [], shopWishlist: [], shopSortMode: 'default', shopSpendingLog: [], accentColor: null, playBtnColor: null, nicknameFont: 'default', layoutDensity: 'cozy', pinnedStat: null, companionNameColor: null, pinnedPreset: null, navOrder: ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'menu-inventory-btn', 'quests-btn', 'friends-btn', 'achievements-btn'], uiFont: 'default', textSpacing: 100, buttonSize: 100, reduceTransparency: false, cursorTrail: false, crtScanlines: false, weatherParticles: true, frameTimeGraph: false, hoverAudioCue: false, highVisCursor: false, captionBackground: false, themePreset: 'none', uiTheme: 'old', lastSeenBuildId: null, mutators: { hordeRush: false, lootRush: false, pureGunplay: false, bossRush: false, hordeMode: false, kingOfTheHill: false, extraction: false, dailyChallenge: false, healthRegen: false, ironMode: false, scavenger: false, glassHouse: false, featuredEnemy: false, blackout: false, bossGauntlet: false, zombieDefense: false, bossHunt: false, zombieRush: false, escalation: false, cursedRun: false, randomizer: false } }
}


const SCORE_ATTACK_NIGHT_DURATION_MS = 60000
const SCORE_ATTACK_BEST_KEY = 'gayz-score-attack-best'

function loadScoreAttackBest() {
  try {
    return Number(localStorage.getItem(SCORE_ATTACK_BEST_KEY)) || 0
  } catch {
    return 0
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


const ENDLESS_MILESTONE_KEY = 'gayz-endless-milestone'

function loadEndlessMilestone() {
  try {
    return Number(localStorage.getItem(ENDLESS_MILESTONE_KEY)) || 0
  } catch {
    return 0
  }
}



function _todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
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






// Weekly Featured Mutator - a single mutator auto-picked via the same
// week-seed technique WEEKLY_CHALLENGES above already uses, nudging
// players toward trying a different mutator each week via a coin bonus -
// never forced, the player still has to check the box themselves.
// Only mutators with a block-city version (PlayRules.js's PLAY_MUTATORS).
const WEEKLY_FEATURED_MUTATORS = ['hordeRush', 'lootRush', 'bossRush', 'healthRegen', 'glassHouse', 'escalation']
const WEEKLY_FEATURED_MUTATOR_BONUS_COINS = 50
const GLOBAL_KILLS_MILESTONE_STEP = 100000
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
  zombieDefense: 'mutatorZombieDefense',
  bossHunt: 'mutatorBossHunt',
  zombieRush: 'mutatorZombieRush',
  escalation: 'mutatorEscalation',
}


// Settings Code (export/import, see _exportSettingsCode/_importSettingsCode)
// - a deliberate whitelist of pure preference fields (audio/graphics/
// controls/accessibility), NOT the full settings object. Excludes
// identity-shaped fields (nickname, companionName, bio, colors tied to a
// player's identity) since this is meant to be pasted/shared with someone
// else, unlike Export Save's full-fidelity file backup.
const SETTINGS_CODE_KEYS = [
  'masterVolume', 'sfxVolume', 'ambientVolume', 'sensitivity', 'invertY', 'fov', 'adsFov', 'hudScale', 'hudOpacity',
  'colorblindMode', 'recoilShakeIntensity', 'damageShakeIntensity', 'reduceFlashing', 'toggleSprint', 'toggleCrouch', 'toggleAds',
  'aimAssist', 'bigInteractPrompt', 'toastDuration', 'crosshairSize', 'largeTextMode',
  'highContrastMode', 'dyslexiaFont', 'focusRingMode', 'keybindCheatSheet', 'showHitFeedback',
  'performanceMode', 'bgMood', 'renderResolution', 'brightness', 'contrast', 'aoIntensity',
  'shadowsEnabled', 'shadowQuality', 'liteTextures', 'bulletHolesEnabled', 'bloodEffectsEnabled',
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


const ENDING_SEEN_KEY = 'gayz-ending-seen'

function loadEndingSeen() {
  try {
    return localStorage.getItem(ENDING_SEEN_KEY) === 'true'
  } catch {
    return false
  }
}



let _settingsSavedPulseTimer = null
export function saveSettings(settings) {
  try {
    // Cloud Save picks this up through its change tracking (see
    // CloudSaveUI.installChangeTracking) - only when the stored value
    // actually changed, which matters because the settings autosave timer
    // calls this every ~30s. The old version stamped "unsynced change" and
    // queued a full upload on every call, so an idle device kept
    // re-uploading its stale save over newer progress from other devices.
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
  if (panel && indicator && getComputedStyle(panel).display !== 'none' && window.__game) {
    // Recently Changed / Undo - reuses window.__game (see the constructor's
    // own comment on why it's set) since this is a standalone function
    // with no `this` of its own, to live-update the diff on every change
    // while the panel is actually open. Its own diff already excludes
    // lastSettingsTab (written on every tab click, not a real change) -
    // reusing that same result here means clicking between tabs with
    // nothing actually changed no longer pulses "Saved" either, which it
    // used to (this indicator had no way to know a save was "just the tab
    // bookkeeping" until now, even after that exclusion was added to the
    // list below it).
    const hasRealChange = window.__game._renderRecentlyChangedList()
    if (hasRealChange) {
      indicator.classList.add('show')
      clearTimeout(_settingsSavedPulseTimer)
      _settingsSavedPulseTimer = setTimeout(() => indicator.classList.remove('show'), 1200)
    }
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

function loadDeathMemorials() {
  try {
    const raw = localStorage.getItem(DEATH_MEMORIALS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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


// Daily Challenge local leaderboard (see _recordDailyLeaderboardEntry) -
// top-N attempts for TODAY's date specifically, distinct from dailyBest's
// single lifetime-best score. Resets whenever the stored date goes stale,
// same day-rollover check loadDailyBest already uses.
const DAILY_LEADERBOARD_KEY = 'gayz-daily-leaderboard'

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
      // Trader's Past mini arc (see _completeTraderQuest) - which of
      // TRADER_QUESTS' 3 quest ids have ever been completed at least once,
      // cumulative across every run, same shape as bossEpitaphsSeen above.
      traderArcSeen: Array.isArray(parsed.traderArcSeen) ? parsed.traderArcSeen : [],
    }
  } catch {
    return { rescued: 0, lost: 0, bossEpitaphsSeen: [], traderArcSeen: [] }
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
      // Lifetime Points quest tier (see Quests.js) - unlike this.points
      // itself (spent on perks/rerolls, goes back down), this only ever
      // grows, same never-reset shape as lifetimeCoinsEarned above. Every
      // points award routes through Game.js's _gainPoints so this can't
      // drift out of sync with a scattered set of individual += sites.
      lifetimePointsEarned: parsed.lifetimePointsEarned || 0,
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
      lifetimePlaytimeSeconds: 0, lifetimeDistanceMeters: 0, lifetimeCoinsEarned: 0, lifetimePointsEarned: 0, flawlessRunCount: 0,
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
// Auto-suggested best loadout (batch 8 feature)
const SUGGESTED_LOADOUT_MIN_RUNS = 3

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
      recentDates: Array.isArray(parsed.recentDates) ? parsed.recentDates.slice(-LOGIN_CALENDAR_DAYS) : [],
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

// Hardcore Mode death memorial - a permanent, never-pruned-by-cap record of
// every one-life character lost (unlike the leaderboards above, this isn't
// a top-N ranking, it's a full history, so each hardcore attempt becomes
// its own remembered "story" rather than just another leaderboard row that
// can get pushed out by a better one).
const HARDCORE_MEMORIAL_KEY = 'gayz-hardcore-memorial'





// Field Notes (batch 5 feature) - same array-of-ids shape as
// loadHardcoreMemorial below, just collected-note ids instead of death
// entries.
const FIELD_NOTES_KEY = 'gayz-field-notes'
function loadFieldNotes() {
  try {
    const raw = localStorage.getItem(FIELD_NOTES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}


function loadHardcoreMemorial() {
  try {
    const raw = localStorage.getItem(HARDCORE_MEMORIAL_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
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

function loadTraderSales() {
  try {
    return Math.max(0, Number(localStorage.getItem(TRADER_SALES_KEY)) || 0)
  } catch {
    return 0
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


// Points/coins and everything bought with them (skins, Shop stat perks) used
// to be purely in-run state that reset on every page reload, same as
// health/inventory/kills. Split out into its own persisted slice so the
// currency balance and anything already owned survive a reload, without
// touching the rest of the run-state reset behavior on death/respawn.
const SHOP_PROGRESS_KEY = 'gayz-shop-progress'
// Weapon Attachments shop section (batch 11 feature) - one runtime-flag
// check per ATTACHMENT_TYPES id, the single source of truth both
// saveShopProgress (persistence) and the shop UI (ownership display) read
// from, so the two can never drift out of sync with each other. scope
// excludes the AWP (already has one baked in - same reasoning as the
// suppressor exclusion set below) - matches this file's pre-existing
// w.id !== 'awp' check, just generalized to the other 10 attachments too.
const ATTACHMENT_OWNED_CHECK = {
  scope: (w) => w.scopeOwned && w.id !== 'awp',
  extmag: (w) => w.hasExtMag,
  suppressor: (w) => w.suppressed,
  laser: (w) => w.hasLaser,
  incendiary: (w) => w.ignites,
  ricochet: (w) => w.ricochet,
  armorpierce: (w) => w.armorPierce,
  precision: (w) => !!w.critChance,
  electric: (w) => w.shocks,
  acid: (w) => w.corrodes,
  cryo: (w) => w.freezes,
}

function loadShopProgress() {
  try {
    const raw = localStorage.getItem(SHOP_PROGRESS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      points: parsed.points || 0,
      coins: parsed.coins || 0,
      cash: parsed.cash || 0,
      gems: parsed.gems || 0,
      ownsShopSkin: parsed.ownsShopSkin || false,
      ownedSkins: new Set(parsed.ownedSkins || []),
      equippedSkin: parsed.equippedSkin || null,
      ownedOutfits: new Set(parsed.ownedOutfits || []),
      equippedOutfit: parsed.equippedOutfit || null,
      ownedHats: new Set(parsed.ownedHats || []),
      equippedHat: parsed.equippedHat || null,
      challengeKillCounts: parsed.challengeKillCounts || {},
      weaponChallengesUnlocked: new Set(parsed.weaponChallengesUnlocked || []),
      shopPurchased: new Set(parsed.shopPurchased || []),
      // Per-gun Coin Shop attachments (see CoinShop.js's ATTACHMENT_TYPES) -
      // "weaponId:attachmentId" strings, restored via
      // WeaponSystem.applyAttachment right after unlockedGuns in the
      // constructor.
      attachments: parsed.attachments || [],
      // Unopened crate stock, per CRATE_TIERS key (2026-09-21) - buying a
      // crate used to instantly roll its reward in one action; now buying
      // adds to this count and Inventory > Crates' own Open button is what
      // actually consumes one and rolls the reward, so a crate can sit
      // unopened across a reload same as anything else owned.
      crateStock: parsed.crateStock || {},
      // Inventory > Character skins bought in the Market, { skinId: count }
      // (2026-10-01). Numbers, so Cloud Save adds up buys/sells made on
      // two devices instead of one overwriting the other.
      charSkins: (parsed.charSkins && typeof parsed.charSkins === 'object') ? parsed.charSkins : {},
    }
  } catch {
    return { points: 0, coins: 0, cash: 0, gems: 0, ownsShopSkin: false, ownedSkins: new Set(), equippedSkin: null, ownedOutfits: new Set(), equippedOutfit: null, ownedHats: new Set(), equippedHat: null, challengeKillCounts: {}, weaponChallengesUnlocked: new Set(), shopPurchased: new Set(), attachments: [], crateStock: {}, charSkins: {} }
  }
}

function saveShopProgress(game) {
  try {
    const json = JSON.stringify({
      points: game.points,
      coins: game.coins,
      cash: game.cash,
      gems: game.gems,
      ownsShopSkin: game.ownsShopSkin,
      ownedSkins: [...game.ownedSkins],
      equippedSkin: game.equippedSkin,
      ownedOutfits: [...game.ownedOutfits],
      equippedOutfit: game.equippedOutfit,
      ownedHats: [...game.ownedHats],
      equippedHat: game.equippedHat,
      challengeKillCounts: game.challengeKillCounts,
      weaponChallengesUnlocked: [...game.weaponChallengesUnlocked],
      shopPurchased: [...game.coinShopPurchased],
      // Weapon Attachments shop section (batch 11 feature) - was only ever
      // deriving 3 of the 11 real ATTACHMENT_TYPES (scope/extmag/suppressor)
      // from their runtime flags; the other 8 (laser/incendiary/ricochet/
      // armorpierce/precision/electric/acid/cryo) would silently vanish on
      // reload even after being bought - see ATTACHMENT_OWNED_CHECK's own
      // comment for why this now covers all 11 generically instead.
      attachments: game.weapons.weapons.flatMap((w) => {
        const ids = []
        for (const item of ATTACHMENT_TYPES) {
          const check = ATTACHMENT_OWNED_CHECK[item.id]
          if (check && check(w)) ids.push(`${w.id}:${item.id}`)
        }
        return ids
      }),
      crateStock: game.crateStock,
      charSkins: game.charSkins,
    })
    // Skip identical writes - this runs from _updateStatsPanel after nearly
    // every points/coins change, and a localStorage write is synchronous on
    // the main thread. Compared against what's actually stored (not a
    // cached "last thing I wrote") so a write from elsewhere - a cloud
    // restore, an imported save - still gets overwritten exactly as it
    // always did; only a true no-op write is skipped.
    if (localStorage.getItem(SHOP_PROGRESS_KEY) === json) return
    localStorage.setItem(SHOP_PROGRESS_KEY, json)
  } catch {
    // Storage unavailable - shop progress just won't persist across sessions.
  }
}

// Friend presence (see _computeFriendStatus/_startPresenceHeartbeat) -
// FRIEND_HEARTBEAT_INTERVAL_MS is how often a signed-in player's own
// lastActiveAt gets pushed; the two threshold constants below classify a
// FRIEND's staleness against that same cadence with headroom for a missed
// tick or two, not an exact 1:1 match to the interval.
const FRIEND_HEARTBEAT_INTERVAL_MS = 60000
const FRIEND_ONLINE_THRESHOLD_MS = 2 * 60 * 1000
const FRIEND_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000
const FRIEND_STATUS_LABEL_KEYS = { online: 'friendStatusOnline', idle: 'friendStatusIdle', dnd: 'friendStatusDnd', offline: 'friendStatusOffline' }

const NIGHT_DURATION_MS = 90000
// Build Mode entry loading overlay (see _enterBuildMode) - a floor, not a
// fixed delay: real loading (first visit's dynamic import) can take
// longer and this never cuts that short, it only stretches an
// already-fast repeat visit up to feel like a deliberate beat instead of
// a one-frame flicker.
const BUILD_MODE_LOADING_MIN_MS = 400
// Reset All Progress - see _handleResetProgressClick's own comment for why
// this is a two-click arm/confirm instead of a single button.
const RESET_PROGRESS_CONFIRM_MS = 4000
// Achievement toast queue - slightly longer than the toast's own 3.2s CSS
// animation (see #achievement-toast.show) so one fully fades before the
// next begins, instead of visually cutting it off mid-animation.
const ACHIEVEMENT_TOAST_GAP_MS = 3400
const MAX_GOALS = 3
const LOGIN_CALENDAR_DAYS = 7
const MARKET_FEE_RATE = 0.05
// Languages that are fully translated; the rest show "Coming soon".
const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'zh', 'hi', 'es'])
// How long the game waits for a lost graphics connection to come back
// before showing the full Reload message.
const GL_LOST_PANEL_MS = 12000
// Lite Textures: how often newly loaded models get shrunk too.
const LITE_TEXTURE_SWEEP_MS = 4000

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
// Nav badge dots (Upgrades/Achievements/Quests) - "seen ids" persistence
// shared by each "new item added" check. First-ever check seeds the
// seen set with whatever already exists/is already unlocked, so shipping
// this feature doesn't retroactively flag today's content as new - only
// something added/unlocked AFTER a player's first check ever lights the
// dot. null return (vs an empty Set) is how callers tell "never checked
// before, needs seeding" apart from "checked before, genuinely empty."
// (The Store/Shop panel used to have one of these too - removed along with
// its own new-item dot notification when the Store panel was cut down to
// just the GaygarX skin purchase.)
const UPGRADES_SEEN_IDS_KEY = 'gayz-upgrades-seen-ids'
const ACHIEVEMENTS_SEEN_IDS_KEY = 'gayz-achievements-seen-ids'
const QUESTS_SEEN_IDS_KEY = 'gayz-quests-seen-ids'

function _loadSeenIds(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function _saveSeenIds(key, idsIterable) {
  try {
    localStorage.setItem(key, JSON.stringify([...idsIterable]))
  } catch {
    // Storage unavailable - the dot just won't remember what's been seen.
  }
}
// Total-lifetime-kills milestones (see _checkKillMilestones) - a one-time
// toast the first homepage render after crossing each, tracked separately
// from CAREER_RANK_TITLES since these are just round-number celebration
// beats, not rank tiers.
const KILL_MILESTONES = [1000, 5000, 10000, 25000, 50000, 100000]
const KILL_MILESTONES_SEEN_KEY = 'gayz-kill-milestones-seen'
// 3 steps added on top of the original 5 - the game has grown a lot since
// those were written (companions, the Trader, Game Modes/Mutators all
// exist now) and a new player had zero signposting toward any of them.
// Deliberately still short and high-level, not trying to explain every
// system - just "these exist, go look."
// How to Play used to be a paginated Next/Back stepper - now rendered as
// one static scrollable list (see _openHowToPlayPanel), same format as
// Credits/Rules & Info, so each step needs a short heading of its own.
// `code`: the functions/constants each step describes. When a change touches
// one of them, scripts/check-docs.mjs asks for that step's text to be
// re-read (edited, or confirmed with [reread: htpX] in the commit message).
const HOWTOPLAY_STEPS = [
  { key: 'htpMove', headingKey: 'htpHeadingMovement', code: '' },
  { key: 'htpWavesShoot', headingKey: 'htpHeadingCombat', code: 'RELOAD_TIME' },
  { key: 'htpWavesCamp', headingKey: 'htpHeadingTrader', code: 'SHOP_ITEMS CAMP_QUESTS' },
  { key: 'htpWavesWaves', headingKey: 'htpHeadingSurvival', code: 'waveSize zombieSpeed playConfig' },
  { key: 'htpRules', headingKey: 'htpHeadingRules', code: '' },
]

// Mega i18n sweep (2026-09-05): hundreds of settings labels, dropdown options,
// panel buttons/headings, and placeholders across the whole app had never been
// wired to translation at all (not a regression - they were simply never
// connected when built). Rather than hundreds of individual .textContent = t(...)
// lines, these three maps drive one bulk-apply pass in _applyLanguage().
const SIMPLE_TEXT_I18N_KEYS = {
  'skip-to-play-link': 'skipToPlayLink',
  'build-menu-hint': 'buildMenuHint',
  'build-menu-title-main': 'buildMenuTitle',
  'build-menu-title-sub': 'buildMenuPaused',
  'build-menu-info-title': 'buildMenuQuickInfo',
  'build-menu-info-map-label': 'buildMenuCurrentMap',
  'build-menu-info-saved-label': 'buildMenuLastSaved',
  'build-menu-info-blocks-label': 'buildMenuBlocks',
  'build-menu-shortcuts-title': 'buildMenuShortcuts',
  'build-menu-tip-title': 'buildMenuTip',
  'build-mode-try-btn-label': 'buildModeTryBtn',
  'build-mode-play-btn-label': 'buildModePlayBtn',
  'map-select-3-tag': 'mapSelect3Tag',
  'build-mode-mirror-btn-label': 'buildModeMirrorBtn',
  'build-mode-line-btn-label': 'buildModeLineBtn',
  'build-mode-copy-btn-label': 'buildModeCopyBtn',
  'build-mode-paste-btn-label': 'buildModePasteBtn',
  'build-mode-rotate-btn-label': 'buildModeRotateBtn',
  'build-mode-fill-btn-label': 'buildModeFillBtn',
  'build-mode-replace-btn-label': 'buildModeReplaceBtn',
  'build-mode-shape-btn-label': 'buildModeShapeBtn',
  'build-mode-undo-btn-label': 'buildModeUndoBtn',
  'build-mode-redo-btn-label': 'buildModeRedoBtn',
  'build-mode-save-btn-label': 'buildModeSaveBtn',
  'build-mode-export-btn-label': 'buildModeExportBtn',
  'build-mode-import-btn-label': 'buildModeImportBtn',
  'build-mode-reset-btn-label': 'buildModeResetBtn',
  'build-mode-publish-btn-label': 'buildModePublishBtn',
  'build-mode-browse-btn-label': 'buildModeBrowseBtn',
  'build-mode-exit-btn-label': 'buildModeExitBtn',
  'community-maps-empty': 'shareEmpty',
  'community-maps-close-btn': 'communityBuildsCloseBtn',
  'community-maps-shared-label': 'shareYourCode',
  'community-maps-copy': 'shareCopyBtn',
  'community-maps-code-play': 'sharePlayBtn',
  'community-maps-code-edit': 'shareEditBtn',
  'community-maps-tab-new': 'shareTabNew',
  'community-maps-tab-likes': 'shareTabLikes',
  'community-maps-tab-plays': 'shareTabPlays',
  'build-together-title': 'buildModeTogetherBtn',
  'build-mode-together-btn-label': 'buildModeTogetherBtn',
  'build-together-host-btn': 'togetherHostBtn',
  'build-together-join-btn': 'togetherJoinBtn',
  'build-together-copy-btn': 'shareCopyBtn',
  'build-together-leave-btn': 'togetherLeaveBtn',
  'build-together-close-btn': 'communityBuildsCloseBtn',
  'touch-btn-fire': 'touchBtnFire',
  'touch-btn-aim': 'touchBtnAim',
  'touch-btn-jump': 'touchBtnJump',
  'touch-btn-reload': 'touchBtnReload',
  'touch-btn-melee': 'touchBtnMelee',
  'touch-btn-interact': 'touchBtnInteract',
  'touch-btn-sprint': 'touchBtnSprint',
  'touch-btn-crouch': 'touchBtnCrouch',
  'touch-btn-more': 'touchBtnMore',
  'chat-send-btn': 'chatSendBtn',
  'random-nickname-btn': 'randomNicknameBtn',
  'round-mode-hint': 'roundModeHint',
  'menu-player-tag': 'menuPlayerTagFallback',
  'settings-saved-indicator': 'settingsSavedIndicator',
  'auto-loot-label': 'autoLootLabel',
  'auto-loot-radius-label': 'autoLootRadiusLabel',
  'fullscreen-label': 'fullscreenLabel',
  'fullscreen-btn': 'fullscreenBtn',
  'master-volume-label': 'masterVolumeLabel',
  'sfx-test-btn': 'sfxTestBtn',
  'gfx-resolution-label': 'gfxResolutionLabel',
  'gfx-brightness-label': 'gfxBrightnessLabel',
  'gfx-contrast-label': 'gfxContrastLabel',
  'gfx-ao-label': 'gfxAoLabel',
  'gfx-shadows-label': 'gfxShadowsLabel',
  'gfx-shadow-quality-label': 'gfxShadowQualityLabel',
  'gfx-grain-label': 'gfxGrainLabel',
  'gfx-panel-flicker-label': 'gfxPanelFlickerLabel',
  'gfx-bullet-holes-label': 'gfxBulletHolesLabel',
  'gfx-lite-textures-label': 'gfxLiteTexturesLabel',
  'graphics-reconnecting-text': 'graphicsReconnecting',
  'gfx-blood-label': 'gfxBloodLabel',
  'gfx-damage-indicator-label': 'gfxDamageIndicatorLabel',
  'gfx-damage-numbers-label': 'gfxDamageNumbersLabel',
  'gfx-damage-numbers-scale-label': 'gfxDamageNumbersScaleLabel',
  'reset-graphics-defaults-btn': 'resetGraphicsDefaultsBtnLabel',
  'invert-y-label': 'invertYLabel',
  'gamepad-deadzone-label': 'gamepadDeadzoneLabel',
  'gamepad-vibration-label': 'gamepadVibrationLabel',
  'hud-scale-label': 'hudScaleLabel',
  'hud-opacity-label': 'hudOpacityLabel',
  'hit-feedback-label': 'hitFeedbackLabel',
  'keybind-cheatsheet-label': 'keybindCheatsheetLabel',
  'frame-time-graph-label': 'frameTimeGraphLabel',
  'colorblind-preview-normal-label': 'colorblindPreviewNormalLabel',
  'colorblind-preview-safe-label': 'colorblindPreviewSafeLabel',
  'large-text-label': 'largeTextLabel2',
  'dyslexia-font-label': 'dyslexiaFontLabel',
  'high-contrast-label': 'highContrastLabel2',
  'focus-ring-label': 'focusRingLabel',
  'underline-links-label': 'underlineLinksLabel',
  'text-spacing-label': 'textSpacingLabel',
  'button-size-label': 'buttonSizeLabel',
  'reduce-transparency-label': 'reduceTransparencyLabel',
  'hover-audio-cue-label': 'hoverAudioCueLabel',
  'high-vis-cursor-label': 'highVisCursorLabel',
  'caption-background-label': 'captionBackgroundLabel',
  'ui-font-label': 'uiFontLabel',
  'theme-preset-label': 'themePresetLabel',
  'cursor-trail-label': 'cursorTrailLabel',
  'crt-scanlines-label': 'crtScanlinesLabel',
  'companion-name-color-label': 'companionNameColorLabel2',
  'accent-color-label': 'accentColorLabel',
  'accent-color-reset-btn': 'accentColorResetBtn',
  'play-btn-color-label': 'playBtnColorLabel',
  'play-btn-color-reset-btn': 'playBtnColorResetBtn',
  'nickname-font-label': 'nicknameFontLabel',
  'layout-density-label': 'layoutDensityLabel',
  'bg-mood-label': 'bgMoodLabel',
  'weather-particles-label': 'weatherParticlesLabel',
  'homepage-fps-label': 'homepageFpsLabel',
  'export-keybinds-btn': 'exportKeybindsBtn',
  'import-keybinds-btn': 'importKeybindsBtn',
  'import-keybinds-apply-btn': 'importKeybindsApplyBtn',
  'reset-audio-defaults-btn': 'resetAudioDefaultsBtn',
  'reset-controls-defaults-btn': 'resetControlsDefaultsBtn',
  'restore-defaults-btn': 'restoreDefaultsBtnLabel',
  'storage-quota-warning': 'storageQuotaWarning',
  'copy-save-btn': 'copySaveBtn',
  'export-settings-code-btn': 'exportSettingsCodeBtn',
  'import-settings-code-btn': 'importSettingsCodeBtn',
  'import-settings-code-apply-btn': 'importSettingsCodeApplyBtn',
  'theme-picker-golden-label': 'optUiThemeGolden',
  'theme-picker-old-label': 'optUiThemeOld',
  'share-run-card-btn': 'shareRunCardBtnLabel',
  'copy-text-recap-btn': 'copyTextRecapBtn',
  'ending-title': 'endingTitle',
  'ending-continue-btn': 'endingContinueBtn',
  'hide-empty-inventory-text': 'hideEmptyInventoryText',
  'fullmap-hint': 'fullmapHint',
  'journal-hint': 'journalHint',
  'trader-role-ranged': 'traderRoleRanged',
  'trader-role-melee': 'traderRoleMelee',
  'trader-role-medic': 'traderRoleMedic',
  'coming-soon-close-btn': 'comingSoonCloseBtn',
  'general-tab-general': 'generalTabGeneral',
  'general-tab-clan': 'generalTabClan',
  'general-page-general-placeholder': 'generalPageGeneralPlaceholder',
  'clan-members-heading': 'clanMembersHeading',
  'clan-invite-send-btn': 'clanInviteSendBtn',
  'clan-requests-heading': 'clanRequestsHeading',
  'clan-make-btn': 'clanMakeBtn',
  'clan-create-btn': 'clanCreateBtn',
  'clan-ranking-heading': 'clanRankingHeading',
  'clan-request-name-btn': 'clanRequestNameBtn',
  'clan-subtab-myclan': 'clanSubtabMyClan',
  'clan-subtab-ranking': 'clanSubtabRanking',
  'hub-tab-survival': 'hubTabSurvival',
  'hub-tab-deathmatch': 'hubTabDeathmatch',
  'save-preset-btn': 'savePresetBtnLabel',
  'surprise-me-btn': 'surpriseMeBtn',
  'quick-keybinds-btn': 'quickKeybindsBtn',
  'open-share-btn': 'openShareBtn',
  'quest-tab-rolling': 'questTabRolling',
  'quest-tab-monthly': 'questTabMonthly',
  'quest-tab-yearly': 'questTabYearly',
  'quest-tab-lifetime': 'questTabLifetime',
  'monthly-quests-placeholder': 'monthlyQuestsPlaceholder',
  'yearly-quests-placeholder': 'yearlyQuestsPlaceholder',
  'share-setup-btn': 'shareSetupBtn',
  'share-profile-btn': 'shareProfileBtn',
  'share-challenge-btn': 'shareChallengeBtn',
  'share-loadout-btn': 'shareLoadoutBtn',
  'share-page-link-btn': 'sharePageLinkBtn',
  'achievements-tab-survival': 'achievementsTabSurvival',
  'achievements-tab-deathmatch': 'achievementsTabDeathmatch',
  'print-achievements-btn': 'printAchievementsBtnLabel',
  'crate-monthly-coming-soon-tag': 'crateComingSoonTag',
  'shop-crate-section-heading': 'crateSectionHeading',
  'upload-skin-btn': 'uploadSkinBtn',
  'reset-skin-btn': 'resetSkinBtn',
  'profile-tab-public': 'profilePublicHeading',
  'profile-public-hint': 'profilePublicHint',
  'profile-public-id-label': 'profilePublicIdLabel',
  // Reusing #other-profile-panel's existing labels (already translated
  // into zh/hi/es) - same "Best Night"/"Best Kills"/"Achievements" text,
  // no reason to duplicate the key.
  'profile-public-bestnight-label': 'otherProfileBestnightLabel',
  'profile-public-bestkills-label': 'otherProfileBestkillsLabel',
  'profile-public-achievements-label': 'otherProfileAchievementsLabel',
  'profile-public-beststreak-label': 'profilePublicBeststreakLabel',
  'profile-public-region-label': 'profilePublicRegionLabel',
  'profile-public-clan-label': 'profilePublicClanLabel',
  'profile-tab-hidden': 'profilePrivateHeading',
  'profile-private-hint': 'profilePrivateHint',
  'stats-dashboard-heading': 'statsDashboardHeadingLabel',
  'pinned-stat-label': 'pinnedStatLabel',
  'multiplayer-create-btn': 'multiplayerCreateBtn',
  'multiplayer-join-desc': 'multiplayerJoinDesc',
  'multiplayer-join-btn': 'multiplayerJoinBtn',
  'multiplayer-link-desc': 'multiplayerLinkDesc',
  'multiplayer-copy-link-btn': 'multiplayerCopyLinkBtn',
  'multiplayer-start-playing-btn': 'multiplayerStartPlayingBtn',
  'cloudsave-offline-warning': 'cloudsaveOfflineWarning',
  'cloudsave-signed-out-desc': 'cloudsaveSignedOutDescLabel',
  'cloudsave-use-cloud-btn': 'cloudsaveUseCloudBtnLabel',
  'cloudsave-use-local-btn': 'cloudsaveUseLocalBtnLabel',
  'cloudsave-sync-now-btn': 'cloudsaveSyncNowBtnLabel',
  'cloudsave-signout-btn': 'cloudsaveSignoutBtnLabel',
  'status-row-heading': 'statusRowHeading',
  'status-pick-label-online': 'friendStatusOnline',
  'status-pick-label-idle': 'friendStatusIdle',
  'status-pick-label-dnd': 'friendStatusDnd',
  'status-pick-label-offline': 'friendStatusOffline',
  'other-profile-loading': 'otherProfileLoading',
  'other-profile-none': 'otherProfileNone',
  'other-profile-bestnight-label': 'otherProfileBestnightLabel',
  'other-profile-bestkills-label': 'otherProfileBestkillsLabel',
  'other-profile-beststreak-label': 'profilePublicBeststreakLabel',
  'other-profile-achievements-label': 'otherProfileAchievementsLabel',
  'other-profile-region-label': 'profilePublicRegionLabel',
  'pause-invite-btn': 'pauseInviteBtn',
  'screenshot-crop-hint': 'screenshotCropHint',
  'screenshot-section-title': 'screenshotSectionTitle',
  'screenshot-crop-save': 'screenshotCropSave',
  'screenshot-crop-full': 'screenshotCropFull',
  'screenshot-crop-cancel': 'screenshotCropCancel',
  'credits-body-text': 'creditsBodyText',
  'credits-contact-text': 'creditsContactText',
  'credits-privacy-link': 'creditsPrivacyLink',
  'credits-terms-link': 'creditsTermsLink',
  'ammo-guide-heading': 'ammoGuideHeading',
  'ammo-guide-hint': 'ammoGuideHint',
  'ammo-guide-incendiary-name': 'ammoGuideIncendiaryName',
  'ammo-guide-incendiary-desc': 'ammoGuideIncendiaryDesc',
  'ammo-guide-ricochet-name': 'ammoGuideRicochetName',
  'ammo-guide-ricochet-desc': 'ammoGuideRicochetDesc',
  'ammo-guide-armorpiercing-name': 'ammoGuideArmorpiercingName',
  'ammo-guide-armorpiercing-desc': 'ammoGuideArmorpiercingDesc',
  'ammo-guide-precision-name': 'ammoGuidePrecisionName',
  'ammo-guide-precision-desc': 'ammoGuidePrecisionDesc',
  'ammo-guide-electric-name': 'ammoGuideElectricName',
  'ammo-guide-electric-desc': 'ammoGuideElectricDesc',
  'ammo-guide-acid-name': 'ammoGuideAcidName',
  'ammo-guide-acid-desc': 'ammoGuideAcidDesc',
  'ammo-guide-cryo-name': 'ammoGuideCryoName',
  'ammo-guide-cryo-desc': 'ammoGuideCryoDesc',
  'friends-own-id-label': 'friendsOwnIdLabel',
  'touch-more-actions-hint': 'touchMoreActionsHint',
  'achievements-category-label': 'achievementsCategoryLabel',
  'achievements-sort-label': 'achievementsSortLabel',
  'clan-invite-id-label': 'clanInviteIdLabel',
  'clan-create-name-label': 'clanCreateNameLabel',
  'clan-request-name-label': 'clanRequestNameLabel',
  'companion-name-field-label': 'companionNameFieldLabel',
  'challenge-code-label': 'challengeCodeLabel',
  'cloudsave-panel-title': 'cloudsavePanelTitle',
  'settings-section-hud': 'settingsSectionHud',
  'settings-section-hud-2': 'settingsSectionHud',
  'settings-section-notifications': 'settingsSectionNotifications',
  'settings-section-account-data': 'settingsSectionAccountData',
  'settings-section-social': 'settingsSectionSocial',
  'settings-section-homepage': 'settingsSectionHomepage',
  'settings-section-homepage-2': 'settingsSectionHomepage',
  'settings-section-gameplay': 'settingsSectionGameplay',
  'settings-section-accessibility': 'settingsSectionAccessibility',
  'settings-section-accessibility-2': 'settingsSectionAccessibility',
  'settings-section-misc': 'settingsSectionMisc',
  'settings-section-weapon-gear-guide': 'settingsSectionWeaponGearGuide',
  'settings-section-performance': 'settingsSectionPerformance',
  'settings-section-rendering': 'settingsSectionRendering',
  'settings-section-effects': 'settingsSectionEffects',
  'settings-section-damage-indicator': 'settingsSectionDamageIndicator',
  'settings-section-damage-numbers': 'settingsSectionDamageNumbers',
  'settings-section-movement-aim': 'settingsSectionMovementAim',
  'settings-section-gamepad': 'settingsSectionGamepad',
  'settings-section-personalization': 'settingsSectionPersonalization',
  'settings-section-theme': 'settingsSectionTheme',
  'community-maps-title': 'communityBuildsTitle',
  'chat-tab-global': 'chatTabGlobal',
  'chat-tab-clan': 'chatTabClan',
  'hub-section-player': 'hubSectionPlayer',
  'hub-section-difficulty': 'hubSectionDifficulty',
  'hub-section-choose-class': 'hubSectionChooseClass',
  'hub-section-game-modes': 'hubSectionGameModes',
  'hub-section-challenges-mutators': 'hubSectionChallengesMutators',
}

const PLACEHOLDER_I18N_KEYS = {
  'community-maps-code': 'shareCodePlaceholder',
  'build-together-code': 'togetherCodePlaceholder',
  'chat-input': 'chatInputPlaceholder',
  'nickname-input': 'nicknameInputPlaceholder',
  'settings-search-input': 'settingsSearchInputPlaceholder',
  'homepage-greeting-input': 'homepageGreetingInputPlaceholder',
  'import-keybinds-input': 'importKeybindsInputPlaceholder',
  'import-settings-code-input': 'importSettingsCodeInputPlaceholder',
  'clan-invite-id-input': 'clanInviteIdInputPlaceholder',
  'clan-create-name-input': 'clanCreateNameInputPlaceholder',
  'clan-request-name-input': 'clanRequestNameInputPlaceholder',
  'companion-name-input': 'companionNameInputPlaceholder',
  'challenge-code-input': 'challengeCodeInputPlaceholder',
  'cloudsave-friend-input': 'cloudsaveFriendInputPlaceholder',
  'screenshot-caption-input': 'screenshotCaptionInputPlaceholder',
  'emoji-picker-search': 'emojiPickerSearchPlaceholder',
}

const SELECT_OPTION_I18N_KEYS = {
  'kill-feed-position-select': { 'right': 'optKfPosRight', 'left': 'optKfPosLeft' },
  'kill-feed-verbosity-select': { 'all': 'optKfVerbAll', 'important': 'optKfVerbImportant' },
  'compass-style-select': { 'letters': 'optCompassLetters', 'degrees': 'optCompassDegrees' },
  'minimap-zoom-select': { '0': 'optMinimapClose', '1': 'optMinimapNormal', '2': 'optMinimapFar' },
  'ammo-position-select': { 'right': 'optAmmoPosRight', 'left': 'optAmmoPosLeft', 'center': 'optAmmoPosCenter' },
  'health-display-style-select': { 'both': 'optHealthBoth', 'bar': 'optHealthBar', 'number': 'optHealthNumber' },
  'time-format-select': { '12h': 'optTimeFormat12h', '24h': 'optTimeFormat24h' },
  'auto-loot-radius-select': { 'close': 'optAutoLootClose', 'medium': 'optAutoLootMedium', 'far': 'optAutoLootFar' },
  'fps-cap-select': { '0': 'optFpsUncapped', '60': 'optFps60', '120': 'optFps120', '144': 'optFps144' },
  'gfx-shadow-quality-select': { 'low': 'optShadowLow', 'medium': 'optShadowMedium', 'high': 'optShadowHigh' },
  'touch-controls-override-select': { 'auto': 'optTouchAuto', 'touch': 'optTouchForceOn', 'desktop': 'optTouchForceOff' },
  'colorblind-mode-select': { 'off': 'optColorblindOff', 'redgreen': 'optColorblindRedGreen', 'blueyellow': 'optColorblindBlueYellow' },
  'ui-font-select': { 'default': 'optUiFontDefault', 'mono': 'optUiFontMono', 'serif': 'optUiFontSerif', 'display': 'optUiFontDisplay' },
  'theme-preset-select': { 'none': 'optThemePresetDefault', 'sepia': 'optThemePresetSepia', 'darker': 'optThemePresetDarker', 'lighter': 'optThemePresetLighter' },
  'nickname-font-select': { 'default': 'optNicknameFontDefault', 'mono': 'optNicknameFontMono', 'serif': 'optNicknameFontSerif', 'display': 'optNicknameFontDisplay' },
  'layout-density-select': { 'cozy': 'optLayoutCozy', 'compact': 'optLayoutCompact' },
  'bg-mood-select': { 'auto': 'optBgMoodAutoSeasonal', 'timeofday': 'optBgMoodAutoLocal', 'none': 'optBgMoodNight', 'bloodmoon': 'optBgMoodBloodMoon', 'foggy': 'optBgMoodFoggy', 'amber': 'optBgMoodAmber' },
  'achievements-category-select': { 'all': 'optAchCatAll', 'combat': 'optAchCatCombat', 'survival': 'optAchCatSurvival', 'exploration': 'optAchCatExploration', 'story': 'optAchCatStory', 'collection': 'optAchCatCollection' },
  'achievements-sort-select': { 'default': 'optAchSortDefault', 'achieved': 'optAchSortAchieved', 'incomplete': 'optAchSortIncomplete' },
  'pinned-stat-select': { '': 'optPinnedStatNone' },
  'cloudsave-region-select': { 'global': 'optRegionGlobal', 'na': 'optRegionNa', 'eu': 'optRegionEu', 'asia': 'optRegionAsia', 'sa': 'optRegionSa', 'oceania': 'optRegionOceania', 'africa': 'optRegionAfrica' },
}

// Nearly There nudge (Profile panel) - deliberately a small curated list,
// not every achievement: most ACHIEVEMENTS conditions are per-run counters
// (this.totalKills, this.stealthTakedowns, etc.) that reset every session,
// so showing "progress" toward them would be misleading. Its one persistent-
// numeric candidate (fashion_icon) was retired 2026-09-12 (see Achievements.js -
// the Coin Shop's outfit-buying screen was removed with no replacement,
// making it permanently unearnable), leaving no candidate that honestly
// qualifies right now - _renderNearlyThereNudge already handles an empty
// list gracefully (0 lines shown, same as it already did for 0-2). Add a
// new entry here if a future achievement gets genuinely persistent numeric
// backing again.
const NEARLY_THERE_CANDIDATES = []

// Achievement chain previews (Achievements panel) - the handful of
// achievements that genuinely form a tiered sequence, hand-picked rather
// than inferred from naming (most achievements are standalone, not a
// series - guessing from id/title text would false-match unrelated ones).
const ACHIEVEMENT_CHAINS = {
  survivor_5: 'survivor_10',
  nightmare_survivor_5: 'nightmare_conqueror',
}

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

// Stamped by Cloud Save's change tracking (CloudSaveUI.installChangeTracking)
// whenever any synced value actually changes - originally stamped by
// saveSettings alone. Now only decides settings-style merge conflicts
// (whichever device changed more recently wins); history below. Lets _checkForNewerCloudSave
// (see its own comment) tell "this device has an edit that hasn't been
// pushed yet" apart from "this device is fully caught up", instead of
// only ever comparing the cloud's timestamp against when this device
// last synced. Without this, a silent background catch-up had no way to
// know a genuinely unpushed local change existed and could overwrite it
// outright if another device happened to push in the same narrow window
// (reload right after an edit, before the debounced push got a chance
// to fire).
export const LAST_LOCAL_CHANGE_KEY = 'gayz-last-local-change'

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



const FOG_PATCH_MIN_DELAY_MS = 40000
const FOG_PATCH_MAX_DELAY_MS = 90000
const AIRDROP_MIN_DELAY_MS = 70000
const AIRDROP_MAX_DELAY_MS = 130000
const RADIO_CHATTER_MIN_DELAY_MS = 75000
const RADIO_CHATTER_MAX_DELAY_MS = 140000
// Simple line-icon silhouette per weapon (same 24x24/stroke-only visual
// language as every other icon in the game - .mode-icon, .class-icon -
// not a photorealistic render, since nothing else in this UI is). Used by
// _renderWeaponPickerOptions so the "Choose Your Weapon" screen shown
// right after clicking Play has a distinct image per card instead of
// name-only text.
const WEAPON_ICON_PATHS = {
  rifle: '<line x1="2" y1="12" x2="22" y2="12"/><line x1="20" y1="12" x2="20" y2="9"/><line x1="2" y1="12" x2="1" y2="17"/><line x1="13" y1="12" x2="14" y2="17"/><path d="M10 12q0 6 3 7"/>',
  pistol: '<rect x="5" y="9" width="12" height="4" rx="1"/><line x1="17" y1="10.5" x2="20" y2="10.5"/><path d="M6 13v6h4v-6"/><path d="M9 13a3 3 0 0 0 3 3"/>',
  minigun: '<circle cx="9" cy="12" r="5"/><circle cx="9" cy="12" r="2.5"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><line x1="13.5" y1="12" x2="19" y2="12"/><line x1="16" y1="12" x2="16" y2="18"/>',
  shotgun: '<line x1="3" y1="10.5" x2="21" y2="10.5"/><line x1="3" y1="14" x2="15" y2="14"/><line x1="3" y1="10.5" x2="2" y2="17"/>',
  awp: '<line x1="2" y1="15" x2="21" y2="15"/><circle cx="11" cy="9" r="3"/><line x1="11" y1="12" x2="11" y2="15"/><line x1="2" y1="15" x2="2" y2="19"/><line x1="15" y1="15" x2="17" y2="19"/>',
  glock18: '<rect x="7" y="9" width="8" height="4"/><rect x="8" y="13" width="4" height="6"/><rect x="10.5" y="13.5" width="1.5" height="1.5" fill="currentColor" stroke="none"/>',
  flamethrower: '<rect x="3" y="9" width="6" height="8" rx="1.5"/><line x1="9" y1="13" x2="14" y2="13"/><path d="M17.5 6.5c1.5 2 3 4 3 6.3a3.3 3.3 0 0 1-6.6 0c0-.9.4-1.8.9-2.7.3.7.7.9 1.2.6-.5-1.4 0-2.6 1.5-4.2z" fill="currentColor" stroke="none"/>',
  rocket: '<rect x="2" y="11" width="14" height="4" rx="0.5"/><polygon points="16,8.5 22,13 16,17.5" fill="currentColor" stroke="none"/><line x1="3" y1="15" x2="2" y2="19"/>',
  crossbow: '<path d="M3 4q7 8 0 16"/><line x1="3" y1="4" x2="3" y2="20"/><line x1="3" y1="12" x2="20" y2="12"/><line x1="14" y1="12" x2="14" y2="16"/>',
  launcher: '<rect x="4" y="10" width="9" height="5" rx="1"/><circle cx="16.5" cy="12.5" r="3.5"/><line x1="10" y1="15" x2="13" y2="19"/>',
  suppressedsmg: '<rect x="6" y="11" width="6" height="4"/><rect x="12" y="12" width="10" height="2" rx="1"/><line x1="3" y1="12.5" x2="6" y2="12.5"/><path d="M8 15v4h3v-4"/>',
  nailgun: '<rect x="4" y="8" width="10" height="6" rx="1"/><path d="M7 14v5h4v-5"/><line x1="7" y1="19" x2="11" y2="19"/><line x1="14" y1="10" x2="19" y2="10"/><line x1="19" y1="8" x2="19" y2="12"/>',
  harpoon: '<line x1="3" y1="13" x2="17" y2="13"/><polygon points="17,10 23,13 17,16" fill="currentColor" stroke="none"/><line x1="17" y1="11" x2="14" y2="9"/><line x1="17" y1="15" x2="14" y2="17"/><rect x="1" y="11" width="4" height="4" rx="0.8"/>',
  voidripper: '<polygon points="13,2 5,13 10,13 8,22 19,10 13,10 15,2" fill="currentColor" stroke="none"/>',
}















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
// The textContent->innerHTML round-trip alone only encodes &, <, > - safe
// for text-node placement (`<span>${_escapeHtml(x)}</span>`) but NOT for
// placement inside a double-quoted HTML attribute
// (`data-name="${_escapeHtml(x)}"`), since a raw " in the source string
// passes straight through untouched and closes the attribute early -
// found via a real online-features security pass: a friend/chat
// nickname of `" onclick="..."` breaks out of `data-nickname="..."`/
// `data-name="..."` and plants a live event-handler attribute on that
// element (confirmed executing on a real click, not just parsing oddly).
// Manually escaping quotes after the round-trip (both " and ' - some call
// sites use single-quoted attributes) closes this for every call site at
// once rather than patching each one.
export function _escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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

// Chat profanity filter (2026-09-23, trimmed to strong-profanity-only
// 2026-09-26 - the milder/goofier tier, plus damn/goddamn, got dropped
// entirely at Gaymi's request rather than censored). English only for
// now (see the gayz-chat-filter-other-languages memory - zh/hi/es word
// lists are planned, not an oversight). Base words plus their common
// everyday inflections only, no generic suffix wildcard - a wildcard
// like /\bass\w*\b/ would also catch "assassin", which \b-anchored
// exact entries never do ("class"/"grass"/"passed"/"assassin" all stay
// untouched since none of them equal one of these exact words). The
// slur entries exist ONLY to be swapped for a harmless word below, same
// as everything else here - this list censors, it doesn't platform
// anything.
const PROFANITY_WORDS = [
  'bitch', 'bitches',
  'fuck', 'fucks', 'fucking', 'fucked', 'fucker', 'fuckers', 'fuckup', 'motherfucker',
  'shit', 'shits', 'shitty', 'bullshit',
  'cunt', 'cunts', 'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'pussy', 'pussies', 'whore', 'whores', 'slut', 'sluts',
  'twat', 'twats', 'prick', 'pricks', 'wanker', 'wankers',
  'nigga', 'niggas', 'nigger', 'niggers',
]

// Word -> the clean word it auto-corrects to when a chat message is sent
// (2026-09-26: Gaymi wanted every word swapped for something readable,
// not blanked to asterisks - "shoot"/"shot" were deliberately avoided
// for the shit-family since this is an FPS and those read as combat
// chatter. crap/crappy were picked instead since they read as an actual
// closer-sounding minced oath for shit/shitty AND are themselves already
// treated as fine, uncensored casual language in this game - same
// "bullcrap" logic real people already use in place of "bullshit").
// Anything in PROFANITY_WORDS with no entry here would fall back to
// plain asterisks in _censorText below, but every current entry has one.
const PROFANITY_REPLACEMENTS = {
  bitch: 'witch', bitches: 'witches',
  fuck: 'fudge', fucks: 'fudges', fucking: 'fudging', fucked: 'fudged',
  fucker: 'fudger', fuckers: 'fudgers', fuckup: 'fudge-up', motherfucker: 'motherfudger',
  shit: 'crap', shits: 'craps', shitty: 'crappy', bullshit: 'bullcrap',
  cunt: 'grump', cunts: 'grumps',
  dick: 'jerk', dicks: 'jerks', dickhead: 'jerkface',
  cock: 'rooster', cocks: 'roosters',
  pussy: 'kitty', pussies: 'kitties',
  whore: 'floozy', whores: 'floozies',
  slut: 'tramp', sluts: 'tramps',
  twat: 'twit', twats: 'twits',
  prick: 'grump', pricks: 'grumps',
  wanker: 'dweeb', wankers: 'dweebs',
  nigga: 'ninja', niggas: 'ninjas', nigger: 'ninja', niggers: 'ninjas',
}

// Letter -> the character class matching every common stand-in for it,
// so "sh1t"/"$hit"/"sh*t" all still hit the same pattern as "shit". '*'
// is included on vowels specifically since that's the common
// self-censoring style ("f*ck", "sh*t"), not just a leetspeak swap.
const PROFANITY_LEET_MAP = {
  a: 'a4@*', e: 'e3*', i: 'i1!*', o: 'o0*', u: 'u*',
  s: 's5$', t: 't7', b: 'b8', g: 'g9', l: 'l1',
}

// Precompiled once at module load, not per keystroke/send - PROFANITY_WORDS
// is plain a-z only, so no regex-special characters need escaping here.
// Boundaries use lookaround (not \b) on purpose - \b only fires at a
// \w/\W transition, but a leetspeak match can legitimately START or END
// on a symbol (the 'a' class includes '@', so "@ss" is a real match) and
// \b silently fails right before/after a non-word character with another
// non-word character (like a space) on its other side. Checking "not a
// letter" directly on both sides catches that while still blocking
// "assassin" the same way \b did (the character right after a would-be
// "ass" match there is "a", so the lookahead fails).
const PROFANITY_ENTRIES = PROFANITY_WORDS.map((word) => {
  const pattern = word.split('').map((ch) => {
    const cls = PROFANITY_LEET_MAP[ch]
    return cls ? `[${cls}]` : ch
  }).join('')
  return { regex: new RegExp(`(?<![a-zA-Z])${pattern}(?![a-zA-Z])`, 'gi'), replacement: PROFANITY_REPLACEMENTS[word] || null }
})

// Runs right before a chat message is sent (see ChatUI.sendChatMessage/
// ChatUI.sendServerChatMessage) so the censored text is what actually reaches
// Firestore - every viewer sees it censored, not just the sender's own
// client (there's no backend here to filter on the way in, same trust
// model as everything else in this file - see CLAUDE.md's anti-cheat
// note). A word with an entry in PROFANITY_REPLACEMENTS gets swapped for
// that word instead; everything else gets asterisked to the same length
// as what matched, so the rest of the sentence still reads naturally.
export function _censorText(text) {
  let result = text
  for (const { regex, replacement } of PROFANITY_ENTRIES) {
    result = result.replace(regex, (m) => replacement || '*'.repeat(m.length))
  }
  return result
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

// Lowest resolution the map editor's auto resolution may drop to, in
// pixels per CSS pixel - only reached on devices too slow at 1.
const EDITOR_MIN_PIXEL_RATIO = 0.6

// Inventory > Character skins, in grid order (Kirka-style cards). Adding a
// skin to the game = one entry here: its 64x64 Minecraft-format texture,
// a rarity (colors the card's side bar) and how many the player owns
// (0 = not shown). An uploaded custom skin gets its own card on top of
// these while it's the one equipped (see _inventorySkinEntries).
const INVENTORY_SKINS = [
  { id: 'default', nameKey: 'skinDefault', rarity: 'common', dataUrl: DEFAULT_SKIN_DATA_URL, count: () => 1 },
  // Sells back for half its 10,000-gem Shop price, in gems.
  { id: 'gaygarx', name: 'GaygarX', rarity: 'legendary', dataUrl: SHOP_SKIN_PREVIEW_DATA_URL, count: (g) => (g.ownsShopSkin ? 1 : 0), sell: { currency: 'gems', amount: 5000 } },
  // Market skins (MarketSkins.js): bought with coins, sold for half.
  ...MARKET_SKINS.map((skin) => ({
    ...skin,
    price: MARKET_PRICES[skin.rarity],
    count: (g) => Math.max(0, Math.floor(Number(g.charSkins?.[skin.id]) || 0)),
    sell: { currency: 'coins', amount: Math.floor(MARKET_PRICES[skin.rarity] / 2) },
  })),
]
const SKIN_RARITIES = {
  common: { color: '#9aa0a6', key: 'skinRarityCommon' },
  uncommon: { color: '#4caf50', key: 'skinRarityUncommon' },
  rare: { color: '#2f80ed', key: 'skinRarityRare' },
  epic: { color: '#9b51e0', key: 'skinRarityEpic' },
  legendary: { color: '#f2a516', key: 'skinRarityLegendary' },
  mythic: { color: '#e5322d', key: 'skinRarityMythic' },
}

// Flat front view of a Minecraft skin (head+hat, body, arms, legs) as a
// data URL - the card picture, like Kirka's inventory. Cached per texture.
const _skinFrontIconCache = new Map()
function skinFrontIconURL(dataUrl) {
  if (_skinFrontIconCache.has(dataUrl)) return _skinFrontIconCache.get(dataUrl)
  const promise = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const legacy = img.height < 64 // old 64x32 skins: left limbs mirror the right ones
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 32
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingEnabled = false
      const part = (sx, sy, w, h, dx, dy, mirror = false) => {
        if (mirror) {
          ctx.save()
          ctx.translate(dx + w, dy)
          ctx.scale(-1, 1)
          ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)
          ctx.restore()
        } else ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
      }
      part(8, 8, 8, 8, 4, 0) // head
      part(40, 8, 8, 8, 4, 0) // hat layer
      part(20, 20, 8, 12, 4, 8) // body
      part(44, 20, 4, 12, 0, 8) // right arm (viewer's left)
      if (legacy) part(44, 20, 4, 12, 12, 8, true)
      else part(36, 52, 4, 12, 12, 8) // left arm
      part(4, 20, 4, 12, 4, 20) // right leg
      if (legacy) part(4, 20, 4, 12, 8, 20, true)
      else part(20, 52, 4, 12, 8, 20) // left leg
      resolve(canvas.toDataURL())
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
  _skinFrontIconCache.set(dataUrl, promise)
  return promise
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

    // Auto-enable Performance Mode on genuinely bad, sustained frame rate
    // instead of leaving it as a settings checkbox someone has to already
    // know exists - a user reporting single-digit fps shouldn't need to
    // dig through a menu first. Requires several consecutive bad 500ms
    // samples (not just one dip - a single stutter shouldn't flip this)
    // and only fires once per session.
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
    this.continueRunBtn = document.getElementById('continue-run-btn')
    this.buildModeLoadingOverlay = document.getElementById('build-mode-loading-overlay')
    // Session-only (not persisted to settings) - a lightweight convenience
    // toggle for a long inventory list, not a durable preference worth its
    // own load/save plumbing.
    // Delegated once (not re-bound on every _refreshInventoryPanel render,
    // since that rebuilds the row HTML from scratch) - reads which weapon/
    // slot the clicked button belongs to off its own data attributes.
    this.hunger = 100
    this.thirst = 100
    this.statsDashboardCanvas = document.getElementById('stats-dashboard-canvas')
    this.rainOverlayEl = document.getElementById('rain-overlay')
    this.rainOverlayHardEl = document.getElementById('rain-overlay-hard')
    this.snowOverlayEl = document.getElementById('snow-overlay')
    this.snowOverlayHardEl = document.getElementById('snow-overlay-hard')
    this.sandstormOverlayEl = document.getElementById('sandstorm-overlay')
    this.lightningFlashEl = document.getElementById('lightning-flash')
    this.nextFogPatchAt = performance.now() + FOG_PATCH_MIN_DELAY_MS + Math.random() * (FOG_PATCH_MAX_DELAY_MS - FOG_PATCH_MIN_DELAY_MS)
    // Distinct from NightEvents.js's 'supply_drop' event (which just quietly
    // adds a permanent extra chest) - this one is a marked, timed beacon you
    // have to actually reach before it's gone.
    this.airdrop = null
    this.nextAirdropAt = performance.now() + AIRDROP_MIN_DELAY_MS + Math.random() * (AIRDROP_MAX_DELAY_MS - AIRDROP_MIN_DELAY_MS)
    this.nextRadioChatterAt = performance.now() + RADIO_CHATTER_MIN_DELAY_MS + Math.random() * (RADIO_CHATTER_MAX_DELAY_MS - RADIO_CHATTER_MIN_DELAY_MS)
    // Main menu redesign - left-column "Your Stats" panel + player badge,
    // replacing the old single menu-best-stats text blob.
    this.currencyCoinsAmount = document.getElementById('currency-coins-amount')
    this.currencyPointsAmount = document.getElementById('currency-points-amount')
    this.currencyCashAmount = document.getElementById('currency-cash-amount')
    this.currencyGemsAmount = document.getElementById('currency-gems-amount')
    // Each of these now renders in TWO places (homepage Your Stats panel +
    // Profile panel's stats column) sharing one data-stat attribute rather
    // than duplicate ids, so querySelectorAll + forEach keeps both in sync.
    this.statLongestSurvival = document.querySelectorAll('[data-stat="longest-survival"]')
    this.statTotalKills = document.querySelectorAll('[data-stat="total-kills"]')
    this.statRunsPlayed = document.querySelectorAll('[data-stat="runs-played"]')
    this.statFavoriteClass = document.querySelectorAll('[data-stat="favorite-class"]')
    this.suggestedLoadoutHint = document.getElementById('suggested-loadout-hint')
    this.statLastRun = document.querySelectorAll('[data-stat="last-run"]')
    this.menuAvatarLevel = document.getElementById('menu-avatar-level')
    this.menuAvatarPhoto = document.getElementById('menu-avatar-photo')
    this.setupAvatarCanvas = document.getElementById('setup-avatar-canvas')
    if (this.setupAvatarCanvas) {
      const showcaseHeader = document.getElementById('player-showcase-header')
      this._menuAvatar3D = new MenuAvatar3D(this.setupAvatarCanvas, null, () => {
        if (showcaseHeader) showcaseHeader.style.opacity = '1'
      })
      this._menuAvatar3D.start()
    }
    // The Profile panel used to show this same live 3D character again in
    // its own canvas - removed by request in favor of just the corner
    // photo badge (see _updateMenuAvatarPhoto), so there's only ever the
    // one spinning instance now (the Player Setup panel's).
    this.menuPlayerTag = document.getElementById('menu-player-tag')
    this.playerShowcaseTitle = document.getElementById('player-showcase-title')
    this.playerShowcaseClanName = document.getElementById('player-showcase-clan-name')
    this.menuNewsTicker = document.getElementById('menu-news-ticker')
    this.weeklyFeaturedMutatorLine = document.getElementById('weekly-featured-mutator-line')
    // Homepage batch - Continue card, Recommended Difficulty hint, Loadout
    // Presets, quick-access icons, Achievement Showcase, Season Progress,
    // Spotlight ticker, Event Banner, What's New dot, How to Play, and the
    // Profile screenshot gallery. See each feature's own method for how
    // these get populated.
    this.recommendedDifficultyHint = document.getElementById('recommended-difficulty-hint')
    this.savePresetBtn = document.getElementById('save-preset-btn')
    this.surpriseMeBtn = document.getElementById('surprise-me-btn')
    this.quickKeybindsBtn = document.getElementById('quick-keybinds-btn')
    this.menuPresetChips = document.getElementById('menu-preset-chips')
    this.quickMuteBtn = document.getElementById('quick-mute-btn')
    this.quickColorblindBtn = document.getElementById('quick-colorblind-btn')
    this.howtoplayBtn = document.getElementById('howtoplay-btn')
    this.howtoplayPanel = document.getElementById('howtoplay-panel')
    this.howtoplayPanelTitle = document.getElementById('howtoplay-panel-title')
    this.howtoplayContent = document.getElementById('howtoplay-content')
    this.eventBanner = document.getElementById('event-banner')
    this.whatsNewDot = document.getElementById('whats-new-dot')
    this.questsClaimDot = document.getElementById('quests-claim-dot')
    this.questsNewDot = document.getElementById('quests-new-dot')
    this.achievementsNewDot = document.getElementById('achievements-new-dot')
    this.upgradesDot = document.getElementById('upgrades-dot')
    this.friendsRequestDot = document.getElementById('friends-request-dot')
    this.friendsAcceptedDot = document.getElementById('friends-accepted-dot')
    this._friendAcceptedNotifications = []
    // Second Homepage batch - login streak badge, nav completion rings,
    // season-progress countdown label, Player Title picker, Nearly There
    // nudge, Weekly Recap, Recent Activity feed, and the 2 new quick-action
    // icons (performance/language).
    this.profileBioHeading = document.getElementById('profile-bio-heading')
    this.profileBioInput = document.getElementById('profile-bio-input')
    this.profileBioCounter = document.getElementById('profile-bio-counter')
    this.profileNearlyThereList = document.getElementById('profile-nearly-there-list')
    this.profileAnniversaryLine = document.getElementById('profile-anniversary-line')
    this.profileTodayLine = document.getElementById('profile-today-line')
    this.profileFavoriteDifficultyLine = document.getElementById('profile-favorite-difficulty-line')
    this.profileBestRunCard = document.getElementById('profile-best-run-card')
    this.profileBestRunTitle = document.getElementById('profile-best-run-title')
    this.profileBestRunLine = document.getElementById('profile-best-run-line')
    this.profileCreatedTitle = document.getElementById('profile-created-title')
    this.profileCreatedLine = document.getElementById('profile-created-line')
    this.profileAccountSignedOut = document.getElementById('profile-account-signed-out')
    this.profileAccountSignedIn = document.getElementById('profile-account-signed-in')
    this.profileLoginBtn = document.getElementById('profile-login-btn')
    this.profileRegisterBtn = document.getElementById('profile-register-btn')
    this.profileSignoutBtn = document.getElementById('profile-signout-btn')
    this.profileLoginGate = document.getElementById('profile-login-gate')
    this.profileLoginGateText = document.getElementById('profile-login-gate-text')
    this.profileContent = document.getElementById('profile-content')
    // Public Profile section (see _openProfilePanel) - the exact same
    // fields _openOtherPlayerProfile shows when a friend looks YOU up by
    // #ID (leaderboard doc is public-read - see CloudSync.js's
    // pushLeaderboardEntry/fetchLeaderboardEntryByPlayerId), surfaced here
    // too so a player can see for themselves what that actually is,
    // instead of just being told "some stuff is public" in the abstract.
    this.profilePublicNameValue = document.getElementById('profile-public-name-value')
    this.profilePublicIdValue = document.getElementById('profile-public-id-value')
    this.profilePublicBestnightValue = document.getElementById('profile-public-bestnight-value')
    this.profilePublicBestkillsValue = document.getElementById('profile-public-bestkills-value')
    this.profilePublicBeststreakValue = document.getElementById('profile-public-beststreak-value')
    this.profilePublicAchievementsValue = document.getElementById('profile-public-achievements-value')
    this.profilePublicRegionRow = document.getElementById('profile-public-region-row')
    this.profilePublicRegionValue = document.getElementById('profile-public-region-value')
    this.profilePublicClanRow = document.getElementById('profile-public-clan-row')
    this.profilePublicClanValue = document.getElementById('profile-public-clan-value')
    this.profileGateLoginBtn = document.getElementById('profile-gate-login-btn')
    this.profileGateRegisterBtn = document.getElementById('profile-gate-register-btn')
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
    this.cloudsaveOfflineWarning = document.getElementById('cloudsave-offline-warning')
    this.cloudsaveAvgLine = document.getElementById('cloudsave-avg-line')
    this.cloudsaveAvgBars = document.getElementById('cloudsave-avg-bars')
    this.cloudsaveRegionSelect = document.getElementById('cloudsave-region-select')
    this.cloudsaveAchievementsLeaderboardTitle = document.getElementById('cloudsave-achievements-leaderboard-title')
    this.cloudsaveAchievementsLeaderboardList = document.getElementById('cloudsave-achievements-leaderboard-list')
    this.cloudsaveSavedFriends = document.getElementById('cloudsave-saved-friends')
    this.otherProfilePanel = document.getElementById('other-profile-panel')
    this.otherProfileName = document.getElementById('other-profile-name')
    this.otherProfileId = document.getElementById('other-profile-id')
    this.otherProfileLoading = document.getElementById('other-profile-loading')
    this.otherProfileNone = document.getElementById('other-profile-none')
    this.otherProfileStats = document.getElementById('other-profile-stats')
    this.otherProfileBestNightValue = document.getElementById('other-profile-bestnight-value')
    this.otherProfileBestKillsValue = document.getElementById('other-profile-bestkills-value')
    this.otherProfileBestStreakValue = document.getElementById('other-profile-beststreak-value')
    this.otherProfileAchievementsValue = document.getElementById('other-profile-achievements-value')
    this.otherProfileRegionRow = document.getElementById('other-profile-region-row')
    this.otherProfileRegionValue = document.getElementById('other-profile-region-value')
    this.otherProfileTotalKillsValue = document.getElementById('other-profile-totalkills-value')
    this.otherProfileRunsPlayedValue = document.getElementById('other-profile-runsplayed-value')
    this.otherProfileFavoriteClassValue = document.getElementById('other-profile-favoriteclass-value')
    this.otherProfileLongestSurvivalValue = document.getElementById('other-profile-longestsurvival-value')
    this.otherProfileLastRunValue = document.getElementById('other-profile-lastrun-value')
    this.otherProfileAnniversaryLine = document.getElementById('other-profile-anniversary-line')
    this.otherProfileTodayLine = document.getElementById('other-profile-today-line')
    this.otherProfileFavoriteDifficultyLine = document.getElementById('other-profile-favorite-difficulty-line')
    this.otherProfileBestRunCard = document.getElementById('other-profile-best-run-card')
    this.otherProfileBestRunTitle = document.getElementById('other-profile-best-run-title')
    this.otherProfileBestRunLine = document.getElementById('other-profile-best-run-line')
    this.otherProfileCreatedLine = document.getElementById('other-profile-created-line')
    this.otherProfileBioMotto = document.getElementById('other-profile-bio-motto')
    this.otherProfileBioHeading = document.getElementById('other-profile-bio-heading')
    this.otherProfileBioText = document.getElementById('other-profile-bio-text')
    this.otherProfileNotesHeading = document.getElementById('other-profile-notes-heading')
    this.otherProfileNotesHint = document.getElementById('other-profile-notes-hint')
    this.otherProfileNotesInput = document.getElementById('other-profile-notes-input')
    this.cloudsaveLeaderboardTitle = document.getElementById('cloudsave-leaderboard-title')
    this.cloudsaveLeaderboardList = document.getElementById('cloudsave-leaderboard-list')
    this.cloudsaveWeeklyLeaderboardList = document.getElementById('cloudsave-weekly-leaderboard-list')
    this.cloudsaveWeeklyLeaderboardTitle = document.getElementById('cloudsave-weekly-leaderboard-title')
    this.cloudsaveFriendTitle = document.getElementById('cloudsave-friend-title')
    this.addFriendHeading = document.getElementById('add-friend-heading')
    this.cloudsaveFriendInput = document.getElementById('cloudsave-friend-input')
    this.cloudsaveFriendResult = document.getElementById('cloudsave-friend-result')
    this.cloudsavePollTitle = document.getElementById('cloudsave-poll-title')
    this.cloudsavePollOptions = document.getElementById('cloudsave-poll-options')
    this.cloudsavePollHint = document.getElementById('cloudsave-poll-hint')
    // In-memory only - Firebase Auth owns the real session (IndexedDB);
    // these just mirror it for convenience (see CloudSync.onAuthChange).
    this._cloudProfile = null
    this._cloudUid = null
    // Resolves the first time CloudSync.onAuthChange fires (restoreCloudSession
    // in CloudSaveUI.js) - that's an async check (dynamic import + Firebase's
    // own IndexedDB lookup), so _cloudUid can still be null for a real window
    // after the page loads even for an already-signed-in player. Any panel
    // that shows a "please sign in" gate based on _cloudUid awaits this
    // first, so a player who opens Profile/Clan/Friends quickly after
    // loading sees a brief wait instead of a false "you're signed out" gate
    // that would prompt an unnecessary second real sign-in.
    this._authReadyPromise = new Promise((resolve) => { this._resolveAuthReady = resolve })
    // Safety net - if restoreCloudSession's own resolve paths (real
    // callback, isConfigured() false, or its .catch) somehow never run, a
    // panel awaiting this would otherwise hang open forever. Calling an
    // already-resolved promise's resolve function again is a harmless no-op.
    setTimeout(() => this._resolveAuthReady?.(), 8000)
    this._cloudPendingConflict = null
    this._cloudGlobalRank = null
    // "Today" session stats (round 4 Online Features batch) - deliberately
    // session-local only (reset on every page load, never persisted) -
    // distinct from the lifetime careerStats totals shown elsewhere.
    this._sessionKills = 0
    this._sessionStartTime = performance.now()
    // Chat "looks empty on a fresh page load" (both the homepage Global
    // panel and the in-game HUD chat, explicit request 2026-09-22) - a
    // real wall-clock timestamp (Date.now(), unlike _sessionStartTime
    // above which is a performance.now() elapsed-ms counter unrelated to
    // real dates) captured once here, at construction, not re-captured on
    // every panel open/close or game restart within the same page load.
    // ChatUI.renderServerChatMessages/ChatUI.renderChatMessages filter out anything
    // with an earlier createdAt - nothing is deleted from Firestore, this
    // only affects what THIS client's own view renders.
    this._chatSessionStartMs = Date.now()
    this._leaderboardUnsubscribe = null
    this.menuBossRushLeaderboard = document.getElementById('menu-bossrush-leaderboard')
    this.menuHardcoreMemorial = document.getElementById('menu-hardcore-memorial')
    this.difficultyBtns = document.querySelectorAll('.difficulty-btn')
    this.roleBtns = document.querySelectorAll('.role-btn')
    this.loadoutBtns = document.querySelectorAll('.loadout-btn')
    this.gameModeSelectBtns = document.querySelectorAll('.mode-select-btn')
    this.settingsBtn = document.getElementById('settings-btn')
    this.settingsPanel = document.getElementById('settings-panel')
    this.languageGrid = document.getElementById('language-grid')
    this.masterVolumeSlider = document.getElementById('master-volume')
    this.masterVolumeValue = document.getElementById('master-volume-value')
    this.sfxVolumeSlider = document.getElementById('sfx-volume')
    this.sfxVolumeValue = document.getElementById('sfx-volume-value')
    this.sfxTestBtn = document.getElementById('sfx-test-btn')
    this.ambientVolumeSlider = document.getElementById('ambient-volume')
    this.ambientVolumeValue = document.getElementById('ambient-volume-value')
    this.muteOnBlurToggle = document.getElementById('mute-on-blur-toggle')
    this.positionalAudioToggle = document.getElementById('positional-audio-toggle')
    this.sensitivitySlider = document.getElementById('sensitivity-slider')
    this.sensitivityValue = document.getElementById('sensitivity-value')
    this.invertYToggle = document.getElementById('invert-y-toggle')
    this.fovSlider = document.getElementById('fov-slider')
    this.fovValue = document.getElementById('fov-value')
    this.adsFovSlider = document.getElementById('ads-fov-slider')
    this.adsFovValue = document.getElementById('ads-fov-value')
    this.mouseAccelerationToggle = document.getElementById('mouse-acceleration-toggle')
    this.invertScrollToggle = document.getElementById('invert-scroll-toggle')
    this.doubleClickSpeedSlider = document.getElementById('double-click-speed-slider')
    this.doubleClickSpeedValue = document.getElementById('double-click-speed-value')
    this.gamepadDeadzoneSlider = document.getElementById('gamepad-deadzone-slider')
    this.gamepadDeadzoneValue = document.getElementById('gamepad-deadzone-value')
    this.gamepadVibrationToggle = document.getElementById('gamepad-vibration-toggle')
    this.hudScaleSlider = document.getElementById('hud-scale-slider')
    this.hudScaleValue = document.getElementById('hud-scale-value')
    this.hudOpacitySlider = document.getElementById('hud-opacity-slider')
    this.hudOpacityValue = document.getElementById('hud-opacity-value')
    this.colorblindModeSelect = document.getElementById('colorblind-mode-select')
    this.largeTextToggle = document.getElementById('large-text-toggle')
    this.highContrastToggle = document.getElementById('high-contrast-toggle')
    this.focusRingToggle = document.getElementById('focus-ring-toggle')
    this.underlineLinksToggle = document.getElementById('underline-links-toggle')
    this.homepageFpsToggle = document.getElementById('homepage-fps-toggle')
    this.bgMoodSelect = document.getElementById('bg-mood-select')
    this.dyslexiaFontToggle = document.getElementById('dyslexia-font-toggle')
    this.keybindCheatsheetToggle = document.getElementById('keybind-cheatsheet-toggle')
    this.hitFeedbackToggle = document.getElementById('hit-feedback-toggle')
    this.performanceToggle = document.getElementById('performance-toggle')
    this.recoilShakeSlider = document.getElementById('recoil-shake-slider')
    this.recoilShakeValue = document.getElementById('recoil-shake-value')
    this.damageShakeSlider = document.getElementById('damage-shake-slider')
    this.damageShakeValue = document.getElementById('damage-shake-value')
    this.reduceFlashingToggle = document.getElementById('reduce-flashing-toggle')
    // Graphics tab (see _bindGraphicsSettings)
    this.gfxResolutionSlider = document.getElementById('gfx-resolution-slider')
    this.gfxResolutionValue = document.getElementById('gfx-resolution-value')
    this.fpsCapSelect = document.getElementById('fps-cap-select')
    this.motionBlurToggle = document.getElementById('motion-blur-toggle')
    this.autoQualityToggle = document.getElementById('auto-quality-toggle')
    this.gfxBrightnessSlider = document.getElementById('gfx-brightness-slider')
    this.gfxBrightnessValue = document.getElementById('gfx-brightness-value')
    this.gfxContrastSlider = document.getElementById('gfx-contrast-slider')
    this.gfxContrastValue = document.getElementById('gfx-contrast-value')
    this.gfxAoSlider = document.getElementById('gfx-ao-slider')
    this.gfxAoValue = document.getElementById('gfx-ao-value')
    this.gfxShadowsToggle = document.getElementById('gfx-shadows-toggle')
    this.gfxShadowQualitySelect = document.getElementById('gfx-shadow-quality-select')
    this.gfxBulletHolesToggle = document.getElementById('gfx-bullet-holes-toggle')
    this.gfxLiteTexturesToggle = document.getElementById('gfx-lite-textures-toggle')
    this.gfxBloodToggle = document.getElementById('gfx-blood-toggle')
    this.gfxDamageIndicatorToggle = document.getElementById('gfx-damage-indicator-toggle')
    this.gfxDamageNumbersToggle = document.getElementById('gfx-damage-numbers-toggle')
    this.gfxDamageNumbersScaleSlider = document.getElementById('gfx-damage-numbers-scale-slider')
    this.gfxDamageNumbersScaleValue = document.getElementById('gfx-damage-numbers-scale-value')
    this.gfxGrainSlider = document.getElementById('gfx-grain-slider')
    this.gfxGrainValue = document.getElementById('gfx-grain-value')
    this.gfxPanelFlickerToggle = document.getElementById('gfx-panel-flicker-toggle')
    this.resetGraphicsDefaultsBtn = document.getElementById('reset-graphics-defaults-btn')
    // General tab (see _bindGeneralSettings)
    this.killFeedPositionSelect = document.getElementById('kill-feed-position-select')
    this.killFeedVerbositySelect = document.getElementById('kill-feed-verbosity-select')
    this.killFeedIconsToggle = document.getElementById('kill-feed-icons-toggle')
    this.compassStyleSelect = document.getElementById('compass-style-select')
    this.weaponNameHudToggle = document.getElementById('weapon-name-hud-toggle')
    this.minimapZoomSelect = document.getElementById('minimap-zoom-select')
    this.friendPresenceNotifyToggle = document.getElementById('friend-presence-notify-toggle')
    this.dailyChallengeReminderToggle = document.getElementById('daily-challenge-reminder-toggle')
    this.timeFormatSelect = document.getElementById('time-format-select')
    this.autosaveFrequencySlider = document.getElementById('autosave-frequency-slider')
    this.autosaveFrequencyValue = document.getElementById('autosave-frequency-value')
    this.homepageClockEl = document.getElementById('homepage-clock')
    this.updateAvailableBanner = document.getElementById('update-available-banner')
    this.updateAvailableTitleEl = document.getElementById('update-available-title')
    this.updateAvailableChangelog = document.getElementById('update-available-changelog')
    this.updateAvailableRefreshBtn = document.getElementById('update-available-refresh-btn')
    this.updateAvailableLaterBtn = document.getElementById('update-available-later-btn')
    this.hudFpsToggle = document.getElementById('hud-fps-toggle')
    this.ammoPositionSelect = document.getElementById('ammo-position-select')
    this.healthDisplayStyleSelect = document.getElementById('health-display-style-select')
    this.lowAmmoFlashToggle = document.getElementById('low-ammo-flash-toggle')
    this.sessionTimerToggle = document.getElementById('session-timer-toggle')
    this.difficultyLabelToggle = document.getElementById('difficulty-label-toggle')
    this.objectiveDistanceToggle = document.getElementById('objective-distance-toggle')
    this.achievementToastToggle = document.getElementById('achievement-toast-toggle')
    this.rankUpToastToggle = document.getElementById('rank-up-toast-toggle')
    this.leaderboardRankToggle = document.getElementById('leaderboard-rank-toggle')
    this.weeklyReminderToggle = document.getElementById('weekly-reminder-toggle')
    this.lowCurrencyToggle = document.getElementById('low-currency-toggle')
    this.backupReminderToggle = document.getElementById('backup-reminder-toggle')
    this.saveSizeValueEl = document.getElementById('save-size-value')
    this.clearCacheBtn = document.getElementById('clear-cache-btn')
    this.confirmSignoutToggle = document.getElementById('confirm-signout-toggle')
    this.staySignedinToggle = document.getElementById('stay-signedin-toggle')
    this.anonymousLeaderboardToggle = document.getElementById('anonymous-leaderboard-toggle')
    this.shareTelemetryToggle = document.getElementById('share-telemetry-toggle')
    this.autoDeclineToggle = document.getElementById('auto-decline-toggle')
    this.exactLastseenToggle = document.getElementById('exact-lastseen-toggle')
    this.mutedChatPlayersList = document.getElementById('muted-chat-players-list')
    this.rememberSettingsTabToggle = document.getElementById('remember-settings-tab-toggle')
    this.confirmRemoveFriendToggle = document.getElementById('confirm-remove-friend-toggle')
    this.reduceBgEffectsToggle = document.getElementById('reduce-bg-effects-toggle')
    this.homepageGreetingInput = document.getElementById('homepage-greeting-input')
    this.autoReloadToggle = document.getElementById('auto-reload-toggle')
    this.autoLootToggle = document.getElementById('auto-loot-toggle')
    this.autoLootRadiusSelect = document.getElementById('auto-loot-radius-select')
    this.instantInteractToggle = document.getElementById('instant-interact-toggle')
    this.settingsInfoOverlay = document.getElementById('settings-info-overlay')
    this.settingsInfoText = document.getElementById('settings-info-text')
    this.damageFlashColorInput = document.getElementById('damage-flash-color-input')
    this.oneHandedToggle = document.getElementById('one-handed-toggle')
    this.fullscreenBtn = document.getElementById('fullscreen-btn')
    this.sortWeaponsToggle = document.getElementById('sort-weapons-toggle')
    this.whatsNewEveryLaunchToggle = document.getElementById('whatsnew-every-launch-toggle')
    this.homepageGreetingEl = document.getElementById('homepage-greeting')
    this.streamSafeModeToggle = document.getElementById('stream-safe-mode-toggle')
    this.toggleSprintToggle = document.getElementById('toggle-sprint-toggle')
    this.toggleCrouchToggle = document.getElementById('toggle-crouch-toggle')
    this.toggleAdsToggle = document.getElementById('toggle-ads-toggle')
    this.aimAssistToggle = document.getElementById('aim-assist-toggle')
    this.touchControlsOverrideSelect = document.getElementById('touch-controls-override-select')
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
    this.randomNicknameBtn = document.getElementById('random-nickname-btn')
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
    this.themePickerGolden = document.getElementById('theme-picker-golden')
    this.themePickerOld = document.getElementById('theme-picker-old')
    this.cursorTrailToggle = document.getElementById('cursor-trail-toggle')
    this.crtScanlinesToggle = document.getElementById('crt-scanlines-toggle')
    this.weatherParticlesToggle = document.getElementById('weather-particles-toggle')
    this.nicknameInput = document.getElementById('nickname-input')
    this.nicknameRow = document.getElementById('nickname-row')
    this.playerShowcaseRenameBtn = document.getElementById('player-showcase-rename-btn')
    this.companionNameInput = document.getElementById('companion-name-input')
    this.challengeCodeInput = document.getElementById('challenge-code-input')
    this.clanSigninGate = document.getElementById('clan-signin-gate')
    this.clanSubtabMyClanBtn = document.getElementById('clan-subtab-myclan')
    this.clanInClanState = document.getElementById('clan-in-clan-state')
    this.clanBrowseState = document.getElementById('clan-browse-state')
    this.clanMakeBtn = document.getElementById('clan-make-btn')
    this.clanMakeForm = document.getElementById('clan-make-form')
    this.clanAllList = document.getElementById('clan-all-list')
    this.clanCreateNameInput = document.getElementById('clan-create-name-input')
    this.clanCreateBtn = document.getElementById('clan-create-btn')
    this.clanCreateTakenWarning = document.getElementById('clan-create-taken-warning')
    this.clanRequestNameInput = document.getElementById('clan-request-name-input')
    this.clanRequestNameBtn = document.getElementById('clan-request-name-btn')
    this.clanRequestNameStatus = document.getElementById('clan-request-name-status')
    this.clanIncomingInvitesList = document.getElementById('clan-incoming-invites-list')
    this.clanDisplayName = document.getElementById('clan-display-name')
    this.clanStatsMembers = document.getElementById('clan-stats-members')
    this.clanStatsKills = document.getElementById('clan-stats-kills')
    this.clanStatsNight = document.getElementById('clan-stats-night')
    this.clanSendInviteSection = document.getElementById('clan-send-invite-section')
    this.clanInviteIdInput = document.getElementById('clan-invite-id-input')
    this.clanInviteSendBtn = document.getElementById('clan-invite-send-btn')
    this.clanInviteStatus = document.getElementById('clan-invite-status')
    this.clanMemberList = document.getElementById('clan-member-list')
    this.clanRequestsSection = document.getElementById('clan-requests-section')
    this.clanRequestsList = document.getElementById('clan-requests-list')
    this.clanLeaveBtn = document.getElementById('clan-leave-btn')
    this.clanLeaveDisabledHint = document.getElementById('clan-leave-disabled-hint')
    this.chatIdPopup = document.getElementById('chat-id-popup')
    this.chatIdPopupName = document.getElementById('chat-id-popup-name')
    this.chatIdPopupIdBtn = document.getElementById('chat-id-popup-id-btn')
    this.chatIdPopupMuteBtn = document.getElementById('chat-id-popup-mute-btn')
    this.chatPanel = document.getElementById('chat-panel')
    this.chatMessages = document.getElementById('chat-messages')
    this.chatMutedNotice = document.getElementById('chat-muted-notice')
    this.chatInputRow = document.getElementById('chat-input-row')
    this.chatInput = document.getElementById('chat-input')
    this.chatEmojiBtn = document.getElementById('chat-emoji-btn')
    this.chatTabBtns = document.querySelectorAll('.chat-tab-btn')
    this.scoreAttackToggle = document.getElementById('score-attack-toggle')
    this.hardcoreToggle = document.getElementById('hardcore-toggle')
    this.guestModeToggle = document.getElementById('guest-mode-toggle')
    this.endlessToggle = document.getElementById('endless-toggle')
    this.mutatorHordeRush = document.getElementById('mutator-horde-rush')
    this.mutatorLootRush = document.getElementById('mutator-loot-rush')
    this.mutatorPureGunplay = document.getElementById('mutator-pure-gunplay')
    this.mutatorBossRush = document.getElementById('mutator-boss-rush')
    this.mutatorHordeMode = document.getElementById('mutator-horde-mode')
    this.mutatorEscalation = document.getElementById('mutator-escalation')
    this.mutatorCursedRun = document.getElementById('mutator-cursed-run')
    this.mutatorRandomizer = document.getElementById('mutator-randomizer')
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
    this.printStatsSheet = document.getElementById('print-stats-sheet')
    this.reportBugBtn = document.getElementById('report-bug-btn')
    this.sharePanel = document.getElementById('share-panel')
    this.sharePanelTitle = document.getElementById('share-panel-title')
    this.openShareBtn = document.getElementById('open-share-btn')
    this.shareSetupBtn = document.getElementById('share-setup-btn')
    this.shareProfileBtn = document.getElementById('share-profile-btn')
    this.shareChallengeBtn = document.getElementById('share-challenge-btn')
    this.shareLoadoutBtn = document.getElementById('share-loadout-btn')
    this.sharePageLinkBtn = document.getElementById('share-page-link-btn')
    this.rebindingAction = null
    this.settingsOpen = false
    this.settings = loadSettings()
    // Real skin upload (see MenuAvatar3D.js's UV support) - needs
    // this.settings to already exist (customSkinDataUrl lives there) and
    // this._menuAvatar3D to already be constructed (both true by this
    // point), so it can't move any earlier than here.
    this._bindSkinUpload()
    if (this.settings.customSkinDataUrl) this._applyStoredSkin()
    else this._applyDefaultBundledSkin()
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
    this.fieldNotesCollected = new Set(loadFieldNotes())
    this.dailyBest = loadDailyBest()
    this.dailyLeaderboard = loadDailyLeaderboard()
    // Custom Challenge Code (Local Sharing batch, see the Play-button
    // handler's own comment) - read from #challenge-code-input at Play
    // time, not tied to any settings toggle.
    this._pendingChallengeCode = ''
    this.bestRunPace = loadBestRunPace()
    this.deathMemorials = loadDeathMemorials()
    this.nemesis = loadNemesis()
    this.secretsProgress = loadSecretsProgress()

    this.night = 1
    this.kills = 0
    // Records screen (see bestStats.bestKillStreak) - killStreak itself
    // resets to 0 on any hit taken, so this separately tracks the highest
    // it ever reached this run, checked against the persisted best at death.
    this.peakKillStreakThisRun = 0
    // Deployable turrets (see _deployTurret) - separate from this.turret
    // above (the single permanent Coin Shop base-defense fixture at the
    // safe zone), these are player-placed anywhere, consumed from
    // inventory.turretKits, capped at MAX_DEPLOYED_TURRETS alive at once.
    // Deployable Med Stations (see _deployMedStation) - the support
    // counterpart, same shape as deployedTurrets above just healing instead
    // of shooting, consumed from inventory.medStationKits.
    this.totalKills = 0
    this.totalDeaths = 0
    // Director AI signals - see _updateDirectorAI. lastHitTakenAt starts at
    // "now" rather than 0 so a fresh run doesn't read as "25+ seconds since
    // last hit" (i.e. immediately eligible to ramp up) before the player
    // has even taken a first step.
    this.shopProgress = loadShopProgress()
    this.points = this.shopProgress.points
    this.xp = 0
    this.xpLevel = 1
    this.xpToNext = this._xpForLevel(this.xpLevel)
    this.stealthTakedowns = 0
    this.companionGear = { vest: false, rig: false }
    // Vehicle Armor (see SHOP_ITEMS's vehicle_armor) - one-time per-run
    // purchase, same reset precedent as companionGear (fresh on a new
    // Game(), survives a same-session restart-run).
    this.vehicleUpgrades = { armor: false }
    this.hasNightVision = false
    this.coins = this.shopProgress.coins
    // Cash - a 4th currency alongside Coins/Points/Gems, not yet spendable
    // anywhere (same as Gems currently isn't) and with no earning mechanic
    // wired up yet either - just the tracked value + display for now.
    this.cash = this.shopProgress.cash
    this.gems = this.shopProgress.gems
    this.ownsShopSkin = this.shopProgress.ownsShopSkin
    this.charSkins = this.shopProgress.charSkins
    this.coinShopPurchased = this.shopProgress.shopPurchased
    // Landing camera dip (see _updateLandingDip) - a deliberate one-shot
    // downward snap-then-recover on hard falls, distinct from _shakeOffset's
    // random noise above.
    this.heatwave = false
    this.runStartedAt = performance.now()
    // Long-Term Goals batch (see _recordRunEnd) - per-run baselines used to
    // derive this run's contribution to the lifetime totals in careerStats.
    // _runStartCoins is a net-earned approximation (coins can be spent
    // mid-run too), not a true gross-earned ledger - fine for a flavor stat.
    this._runStartCoins = this.coins
    this._runDistanceTraveled = 0

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
    // powerPreference (2026-09-18) - a hint, not a guarantee: on a laptop
    // with both an integrated and a discrete GPU, this asks the browser to
    // use the stronger one instead of whichever one it'd otherwise pick to
    // save battery. Does nothing on a single-GPU machine (e.g. Apple
    // Silicon's one unified chip) and can't help with the actual thing a
    // real player report traced this session's lag to - multiple other
    // GPU-heavy tabs open at once, all sharing the one chip a page has no
    // way to see or control. Free and safe either way, so left on.
    // alpha: false - an opaque canvas (2026-09-30). Nothing ever showed
    // through it (the clear color is already fully opaque), but a
    // transparent WebGL canvas makes the browser blend it with the page
    // every frame, and on macOS keeps it from being handed straight to the
    // screen - a real per-frame cost at Retina size.
    // three.js always asks for an alpha (transparent) context itself, so
    // the opaque one is created here and handed over. Falls back to letting
    // three.js create its own if this browser refuses these attributes.
    // Also off on high-DPI phones/tablets (2026-09-30, "60fps on mobile
    // and old devices"): at 2-3x pixel density edges are already fine, and
    // multisampling that many pixels is one of the biggest costs on a
    // phone GPU.
    const highDpiTouch = window.devicePixelRatio >= 2 && window.matchMedia('(hover: none) and (pointer: coarse)').matches
    const antialias = !LOW_QUALITY_MODE && !this.settings.performanceMode && !highDpiTouch
    const glAttrs = { alpha: false, depth: true, stencil: false, antialias, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }
    const opaqueContext = this.canvas.getContext('webgl2', glAttrs)
    this.renderer = opaqueContext
      ? new THREE.WebGLRenderer({ canvas: this.canvas, context: opaqueContext, alpha: false, antialias, powerPreference: 'high-performance' })
      : new THREE.WebGLRenderer({ canvas: this.canvas, alpha: false, antialias, powerPreference: 'high-performance' })
    // Graphics-connection-lost handling (2026-09-19, extended same day) -
    // the multi-tab GPU-contention scenario documented above (several
    // GPU-heavy tabs open at once) can make the browser actually drop this
    // page's WebGL context, not just run it slowly. Undetected, that reads
    // to a player as the 3D view silently going black forever with the HUD
    // still working (HUD is plain DOM, doesn't need this context) - no
    // error, no explanation. `event.preventDefault()` on the loss event is
    // required by the WebGL spec for the browser to even consider
    // restoring the context later.
    //
    // On restore, this does NOT manually re-upload anything - three.js's
    // WebGLRenderer already listens for the same event internally and
    // resets its own state/resource caches, so the very next normal
    // `composer.render()` call (the existing render loop never stops
    // running, loss or not - draw calls are harmless no-ops per spec while
    // lost) lazily rebuilds whatever GPU resources it touches that frame.
    // This is standard, documented three.js behavior, not bespoke recovery
    // code here. What IS bespoke: this game layers a lot on top of plain
    // three.js (the pooled combat lights, merged/instanced world geometry,
    // EffectComposer bloom) that has never been tested against a real
    // mid-game context loss/restore cycle, so automatic recovery is a
    // reasonable bet, not a guarantee - `graphics-lost-reload-btn` stays
    // up as a manual fallback even after "Keep Playing" is offered, for
    // exactly the case where something comes back looking wrong.
    // A lost graphics connection (2026-10-04, Gaymi: "make gayz playable
    // when this happens"): nothing can be drawn until the browser gives it
    // back, so the game pauses (_tick does nothing while _glLost) behind a
    // small "reconnecting" note instead of the full-screen message. When
    // it comes back, three.js re-uploads everything by itself and the game
    // just carries on - switched to Lite Textures (LiteTextures.js) so it's
    // less likely to be dropped again. Only if it hasn't come back after
    // GL_LOST_PANEL_MS does the full message with Reload appear.
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this._glLost = true
      const note = document.getElementById('graphics-reconnecting')
      if (note) note.style.display = 'flex'
      clearTimeout(this._glLostPanelTimer)
      this._glLostPanelTimer = setTimeout(() => {
        if (!this._glLost) return
        if (note) note.style.display = 'none'
        const panel = document.getElementById('graphics-lost-panel')
        if (panel) panel.style.display = 'flex'
        const title = document.getElementById('graphics-lost-title')
        const text = document.getElementById('graphics-lost-text')
        if (title) title.textContent = 'Graphics Connection Lost'
        if (text) text.textContent = "Your browser's connection to your graphics card dropped, usually because too many 3D-heavy tabs/apps were open at once and it ran out of room. Closing other game or video tabs helps this not happen again."
        document.getElementById('graphics-lost-keep-playing-btn')?.style.setProperty('display', 'none')
      }, GL_LOST_PANEL_MS)
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this._glLost = false
      clearTimeout(this._glLostPanelTimer)
      const note = document.getElementById('graphics-reconnecting')
      if (note) note.style.display = 'none'
      const panel = document.getElementById('graphics-lost-panel')
      if (panel) panel.style.display = 'none'
      if (!this.settings.liteTextures) {
        this.settings.liteTextures = true
        saveSettings(this.settings)
        if (this.gfxLiteTexturesToggle) this.gfxLiteTexturesToggle.checked = true
        const msg = t('liteTexturesAutoToast')
        if (this.gameStarted) this._showLoreToast(msg)
        else this._showHomepageToast(msg)
      }
      this._applyLiteTextures()
    })
    document.getElementById('graphics-lost-keep-playing-btn')?.addEventListener('click', () => {
      const panel = document.getElementById('graphics-lost-panel')
      if (panel) panel.style.display = 'none'
      // Safety net (2026-09-19, real report) - automatic recovery can
      // report success while the actual picture never comes back. Rather
      // than trust it and vanish completely, leave a small corner button
      // reachable so there's always a way out that isn't "know to manually
      // refresh the browser yourself."
      const notice = document.getElementById('graphics-recovery-notice')
      if (notice) notice.style.display = 'flex'
    })
    document.getElementById('graphics-lost-reload-btn')?.addEventListener('click', () => window.location.reload())
    document.getElementById('graphics-recovery-reload-btn')?.addEventListener('click', () => window.location.reload())
    document.getElementById('graphics-recovery-dismiss-btn')?.addEventListener('click', () => {
      const notice = document.getElementById('graphics-recovery-notice')
      if (notice) notice.style.display = 'none'
    })
    // Temporary (2026-09-11) - surfaces real GPU info in the existing FPS
    // HUD line (see its own comment) so a player reporting lag can just
    // screenshot the corner they already know, instead of navigating
    // chrome://gpu or opening DevTools themselves. "SwiftShader"/"Software
    // Rasterizer" here would mean hardware acceleration is off and every
    // frame is drawn by the CPU, not the graphics card - the single
    // biggest possible cause of exactly this kind of lag. Remove once no
    // longer needed for live diagnosis.
    const _dbgGl = this.renderer.getContext()
    const _dbgExt = _dbgGl.getExtension('WEBGL_debug_renderer_info')
    this._gpuRendererString = _dbgExt ? _dbgGl.getParameter(_dbgExt.UNMASKED_RENDERER_WEBGL) : 'unknown'
    // Lightweight placeholder until the player actually clicks Build (see
    // _enterBuildMode) - satisfies every `this.buildMode.active` check
    // scattered through the per-frame tick/keydown handlers without needing
    // to touch every one of those call sites for a null-safety check.
    this.buildMode = { active: false }
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
    this.weeklyChallenge = loadWeeklyChallenge()
    this.weeklyDef = WEEKLY_CHALLENGES[_weeklyChallengeIndex(this.weeklyChallenge.week)]
    this.metaProgress = loadMetaProgress()
    // Zombie types killed so far - shown in the Achievements panel.
    this.bestiaryEncountered = loadEncountered()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    this.quests = new Quests()
    this.rollingQuests = new RollingQuests()
    if (this.achievements.unlocked.has('true_ending')) {
      document.getElementById('diff-nightmare').style.display = ''
    }
    if (this.achievements.unlocked.has('nightmare_conqueror')) {
      document.getElementById('diff-apex').style.display = ''
    }
    // Run summary screen (see _renderRunSummary) - generic per-weapon
    // tally for the CURRENT run only, distinct from killCountsByWeapon
    // above (minigun-only, feeds the meat_grinder achievement) and from
    // WeaponMastery's persistent cross-run kills.
    // Biggest Hit / Closest Call (see _renderRunSummary) - lowestHealthThisRun
    // starts at Infinity so the very first _updateHealthHud call always
    // wins the initial comparison.
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
    this.rollingQuestsSubtitle = document.getElementById('rolling-quests-subtitle')
    this.rollingQuestsOptions = document.getElementById('rolling-quests-options')
    this.monthlyQuestsPlaceholder = document.getElementById('monthly-quests-placeholder')
    this.yearlyQuestsPlaceholder = document.getElementById('yearly-quests-placeholder')
    this.hubBtn = document.getElementById('hub-btn')
    this.hubPanel = document.getElementById('hub-panel')
    this.hubPanelTitle = document.getElementById('hub-panel-title')
    this.gamemodeBtn = document.getElementById('gamemode-btn')
    this.comingSoonPanel = document.getElementById('coming-soon-panel')
    this.comingSoonTitle = document.getElementById('coming-soon-title')
    this.comingSoonBody = document.getElementById('coming-soon-body')
    this.comingSoonCloseBtn = document.getElementById('coming-soon-close-btn')
    this.clanPanel = document.getElementById('clan-panel')
    this.clanPanelTitle = document.getElementById('clan-panel-title')
    this.howtoplayNavLink = document.getElementById('nav-howtoplay-link')
    // Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
    // sync calls fire every ~100ms and are fire-and-forget; under real
    // network/CPU jitter their responses can arrive out of order. Found
    // this the hard way testing host-absence detection: a single late-
    // arriving STALE response (captured server-side before the host
    // actually went stale) would silently reset _hostMissingStreak right
    // back down, so the streak could flicker forever and migration would
    // never trigger. _nextSyncSequence/_lastProcessedSyncSequence guard
    // the whole response-handling block (not just migration detection -
    // every field a stale response carries, positions included, has the
    // same going-backward risk) by dropping any response older than the
    // most recent one already processed.
    this._pendingZombieHits = [] // {zombieId, damage, bypassShield} queued locally, drained into the next sync call
    this._sharedZombieBodies = new Map() // zombieId -> Zombie (network-driven, guest side only)
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
    this._otherPlayerJoinedAt = new Map() // playerId -> server-recorded join timestamp (ms), Phase 5's anti-abuse guard input
    // Phase 3c multiplayer - fester's gas-on-death and acid_trail/webber's
    // hazard-zone drops, queued here (host-only) so a guest can replay the
    // same puddle/gas cloud on its own screen. Drained by
    // _syncNetworkPlayerState, same pattern as ZombieManager.worldEvents.
    this._seenWorldEventIds = new Set() // Phase 3c - dedupes replayed world events across sync calls, both host and guest
    // Phase 4 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase4-shared-loot-design.md) -
    // one combined queue for every kind of "I did something" report a
    // GUEST needs to tell the host about (collecting a pickup, opening a
    // chest/the vault, repairing a window) - discriminated by entry.kind,
    // same shape as ZombieManager.remoteDamageQueue's own kind field.
    // A guest removes a pickup from sharedPickups the instant it collects
    // it (see _renderSharedPickups/updateSharedPickups), but the host only
    // stops broadcasting that id once it's actually processed the
    // collectPickup interaction - a real network round trip later. Without
    // tracking "already collected, ignore until it's truly gone", the very
    // next (still-stale) snapshot would see the id missing from
    // sharedPickups and recreate it, letting the guest collect - and get
    // credited for - the same drop again on every sync tick until the host
    // catches up.
    // Phase 5 - same "already collected, ignore until it's gone from the
    // snapshot" guard Phase 4 needed for ground loot pickups (see that
    // phase's fix commit), built in here from the start instead of
    // rediscovering the same bug.
    // Phase 5 multiplayer - {playerId, payload}[] the host drains into its
    // next sync payload. payload is either a kill event (kind: 'kill') or
    // a Last Stand revival (kind: 'revive') - see _queueKillEvent/Task 10.
    // Phase 5 multiplayer - host-only. A guest becoming downed reports it
    // (see _tryLastStand below); every kill (regardless of who's
    // credited) decrements every entry here, same as the host's own
    // playerDowned/downedKillsNeeded - see _onZombieKilledWorldEffects.
    this._remotePlayerBodies = new Map() // uid -> PlayerBody
    this._pendingJoinSessionId = new URLSearchParams(window.location.search).get('join') || null
    this.whatsNewLink = document.getElementById('nav-whatsnew-link')
    this.friendsBtn = document.getElementById('friends-btn')
    this.friendsPanel = document.getElementById('friends-panel')
    this.friendsPanelTitle = document.getElementById('friends-panel-title')
    this.friendsSignedOut = document.getElementById('friends-signed-out')
    this.friendsSignedOutDesc = document.getElementById('friends-signed-out-desc')
    this.friendsSigninBtn = document.getElementById('friends-signin-btn')
    this.friendsSignedIn = document.getElementById('friends-signed-in')
    this.friendRequestsHeading = document.getElementById('friend-requests-heading')
    this.friendRequestsCount = document.getElementById('friend-requests-count')
    this.deleteAllRequestsBtn = document.getElementById('delete-all-requests-btn')
    this.friendRequestsList = document.getElementById('friend-requests-list')
    this.friendsOwnId = document.getElementById('friends-own-id')
    this.statusPickBtns = document.querySelectorAll('.status-pick-btn')
    this.statusPicker = document.getElementById('status-picker')
    this.statusPickerToggle = document.getElementById('status-picker-toggle')
    this.statusPickerDot = document.getElementById('status-picker-dot')
    this.statusPickerLabel = document.getElementById('status-picker-label')
    this.sendFriendRequestBtn = document.getElementById('send-friend-request-btn')
    this._incomingFriendRequests = []
    this._friendRequestsUnsubscribe = null
    this.menuInventoryBtn = document.getElementById('menu-inventory-btn')
    this.menuInventoryPanel = document.getElementById('menu-inventory-panel')
    this.menuInventoryPanelTitle = document.getElementById('menu-inventory-panel-title')
    this.inventoryTabCharacter = document.getElementById('inventory-tab-character')
    this.inventoryTabCrates = document.getElementById('inventory-tab-crates')
    this.inventoryTabWeapons = document.getElementById('inventory-tab-weapons')
    this.inventoryTabTheme = document.getElementById('inventory-tab-theme')
    this.inventorySkinsList = document.getElementById('inventory-skins-list')
    this.invSkinSearch = document.getElementById('inv-skin-search')
    this.invSkinMenu = document.getElementById('inv-skin-menu')
    this.invSkinMenuEquip = document.getElementById('inv-skin-menu-equip')
    this.invSkinMenuInspect = document.getElementById('inv-skin-menu-inspect')
    this.invSkinMenuSell = document.getElementById('inv-skin-menu-sell')
    this.invSkinMenuMarket = document.getElementById('inv-skin-menu-market')
    this.tradeDialog = document.getElementById('trade-dialog')
    this.tradeDialogTitle = document.getElementById('trade-dialog-title')
    this.tradeDialogPriceRow = document.getElementById('trade-dialog-price-row')
    this.tradeDialogPrice = document.getElementById('trade-dialog-price')
    this.tradeDialogFee = document.getElementById('trade-dialog-fee')
    this.tradeDialogAction = document.getElementById('trade-dialog-action')
    // Player Market listings (CloudSync.fetchActiveMarketListings), loaded
    // whenever the Market opens. null = not loaded yet, 'error' = failed.
    this._marketListings = null
    this.shopMarketGrid = document.getElementById('shop-market-grid')
    this.marketPanel = document.getElementById('market-panel')
    this.marketPanelTitle = document.getElementById('market-panel-title')
    this.marketBtn = document.getElementById('market-btn')
    this.marketSearch = document.getElementById('market-search')
    this.marketItemFilterBtn = document.getElementById('market-item-filter-btn')
    this.marketItemFilterMenu = document.getElementById('market-item-filter-menu')
    this.marketRarityFilterBtn = document.getElementById('market-rarity-filter-btn')
    this.marketRarityFilterMenu = document.getElementById('market-rarity-filter-menu')
    // Market filters (search text, ticked items, one rarity) - reset each
    // time the panel opens. Items: 'character' plus every weapon id.
    this._marketQuery = ''
    this._marketItems = null
    this._marketRarity = 'all'
    this.invSkinPreviewCanvas = document.getElementById('inv-skin-preview-canvas')
    this.inventoryWeaponsList = document.getElementById('inventory-weapons-list')
    this.serverBtn = document.getElementById('server-btn')
    this.serverPanel = document.getElementById('server-panel')
    this.serverPanelTitle = document.getElementById('server-panel-title')
    this.serverChatSignedOut = document.getElementById('server-chat-signed-out')
    this.serverChatSignedOutDesc = document.getElementById('server-chat-signed-out-desc')
    this.serverChatSigninBtn = document.getElementById('server-chat-signin-btn')
    this.serverChatMessages = document.getElementById('server-chat-messages')
    this.serverChatMutedNotice = document.getElementById('server-chat-muted-notice')
    this.serverChatInputRow = document.getElementById('server-chat-input-row')
    this.serverChatInput = document.getElementById('server-chat-input')
    this.serverChatEmojiBtn = document.getElementById('server-chat-emoji-btn')
    this.emojiPicker = document.getElementById('emoji-picker')
    this.emojiPickerSearch = document.getElementById('emoji-picker-search')
    this.emojiPickerCategories = document.getElementById('emoji-picker-categories')
    this.emojiPickerList = document.getElementById('emoji-picker-list')
    this.achievementsBtn = document.getElementById('achievements-btn')
    this.achievementsPanel = document.getElementById('achievements-panel')
    this.achievementsPanelTitle = document.getElementById('achievements-panel-title')
    this.achievementsOptions = document.getElementById('achievements-options')
    this.achievementsFilterInput = document.getElementById('achievements-filter-input')
    this.achievementsCategorySelect = document.getElementById('achievements-category-select')
    this.achievementsSortSelect = document.getElementById('achievements-sort-select')
    this.printAchievementsBtn = document.getElementById('print-achievements-btn')
    this.achievementsControlsRow = document.getElementById('achievements-controls-row')
    this.achievementsDeathmatchPlaceholder = document.getElementById('achievements-deathmatch-placeholder')
    this._achievementsMode = 'survival'
    this.menuPlayerBadge = document.getElementById('menu-player-badge')
    this.profilePanel = document.getElementById('profile-panel')
    this.profilePanelTitle = document.getElementById('profile-panel-title')
    this.profileOptions = document.getElementById('profile-options')
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
    this.creditsPrivacyLink = document.getElementById('credits-privacy-link')
    this.creditsTermsLink = document.getElementById('credits-terms-link')
    this.levelsPanel = document.getElementById('levels-panel')
    this.levelsPanelTitle = document.getElementById('levels-panel-title')
    this.levelsIntroText = document.getElementById('levels-intro-text')
    this.levelsRoadmapList = document.getElementById('levels-roadmap-list')
    this.termsBtn = document.getElementById('terms-btn')
    this.termsPanel = document.getElementById('terms-panel')
    this.termsPanelTitle = document.getElementById('terms-panel-title')
    this.termsContent = document.getElementById('terms-content')
    this.privacyPanel = document.getElementById('privacy-panel')
    this.privacyPanelTitle = document.getElementById('privacy-panel-title')
    this.privacyContent = document.getElementById('privacy-content')
    this.gayzFeaturesBtn = document.getElementById('nav-gayzfeatures-link')
    this.featuresPanel = document.getElementById('features-panel')
    this.featuresContent = document.getElementById('features-content')
    this.featuresSearch = document.getElementById('features-search')
    this.featuresSearchCount = document.getElementById('features-search-count')
    this.skindesignerBtn = document.getElementById('nav-designskin-link')
    this.skindesignerPanel = document.getElementById('skindesigner-panel')
    this.skindesignerFrame = document.getElementById('skindesigner-frame')
    this.featuresToc = document.getElementById('features-toc')
    this.featuresStatLive = document.getElementById('features-stat-live')
    this.featuresStatSoon = document.getElementById('features-stat-soon')
    this.shopPanel = document.getElementById('shop-panel')
    this.shopPanelTitle = document.getElementById('shop-panel-title')
    this.shopSkinCanvas = document.getElementById('shop-skin-canvas')
    this.shopSkinBuyBtn = document.getElementById('shop-skin-buy-btn')
    this.shopSkinBadge = document.getElementById('shop-skin-badge')
    this.cratePurchaseModal = document.getElementById('crate-purchase-modal')
    this.cratePurchaseBox = document.getElementById('crate-purchase-box')
    this.cratePurchaseCloseBtn = document.getElementById('crate-purchase-close-btn')
    this.cratePurchaseIconWrap = document.getElementById('crate-purchase-icon-wrap')
    this.cratePurchaseTierName = document.getElementById('crate-purchase-tier-name')
    this.cratePurchaseQtyMinus = document.getElementById('crate-purchase-qty-minus')
    this.cratePurchaseQtyPlus = document.getElementById('crate-purchase-qty-plus')
    this.cratePurchaseQtyValue = document.getElementById('crate-purchase-qty-value')
    this.cratePurchaseConfirmBtn = document.getElementById('crate-purchase-confirm-btn')
    this.cratePurchaseTotalAmount = document.getElementById('crate-purchase-total-amount')
    this.whatsNewPanel = document.getElementById('whatsnew-panel')
    this.whatsNewPanelTitle = document.getElementById('whatsnew-panel-title')
    this.buildVersionLine = document.getElementById('build-version-line')
    this.coinshopBtn = document.getElementById('coinshop-btn')
    this.gameStarted = false
    this.weapons = new WeaponCatalog()
    // Weapon mastery (see WeaponMastery.js) - re-applies any previously
    // earned masteryMult bonuses to this fresh set of weapon objects, since
    // WeaponSystem's own weapons array is rebuilt from scratch every run.
    this.weaponMastery = loadMastery()
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
    this.ownedOutfits = this.shopProgress.ownedOutfits
    this.equippedOutfit = this.shopProgress.equippedOutfit
    this.ownedHats = this.shopProgress.ownedHats
    this.equippedHat = this.shopProgress.equippedHat
    // Unopened crate stock (see loadShopProgress's own comment) - a plain
    // object, not a Set/Map, since it's just an integer count per tier,
    // not a collection of distinct owned ids like ownedHats/ownedOutfits.
    this.crateStock = { wood: 0, ice: 0, golden: 0, ...this.shopProgress.crateStock }

    this._applyAllVolumes()

    this._bindMenu()
    // Safety net alongside the _updateStatsPanel save hook - catches a
    // close/reload happening between the last stats-panel update and now.
    // The _importingSave guard (see _applyImportedSaveData's own comment)
    // skips this specific save during a cloud/import restore's own
    // reload - this page's in-memory shopProgress/careerStats are stale
    // by definition at that point (a newer save was just written to
    // localStorage moments ago), and saving them here would silently
    // overwrite it right back before the reload takes effect.
    window.addEventListener('beforeunload', () => { if (!this._importingSave) saveShopProgress(this) })
    window.addEventListener('beforeunload', () => { if (!this._importingSave) this._updateLongestSession() })
    // Browser's own native "Leave site?" confirmation, only while an
    // actual run is in progress (not the homepage - closing that needs
    // no warning). Every real browser ignores a custom message here by
    // design (shows its own generic wording instead, same as every other
    // site's version of this prompt) - preventDefault() + a non-empty
    // returnValue is what actually triggers it, per spec, across
    // Chrome/Firefox/Edge/desktop Safari. iOS Safari (and everything on
    // iPhone/iPad, which all run WebKit under Apple's rules) doesn't
    // support this prompt at all - it silently does nothing there,
    // that's an Apple platform limitation, not something fixable here.
    window.addEventListener('beforeunload', (e) => {
      if (!this.gameStarted) return
      e.preventDefault()
      e.returnValue = ''
    })
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
    this._bindNavButtonFocusFix()
    this._bindClanSection()
    ChatUI.bindChatWidget(this)
    ChatUI.bindServerChat(this)
    ChatUI.bindEmojiPicker(this)
    this._bindSettings()
    this._bindGraphicsSettings()
    this._bindGeneralSettings()
    this._bindDifficulty()
    this._bindCompanionRole()
    this._bindLoadout()
    this._bindGameModeSelect()
    // Must run after the three binds above - _checkSetupCode's payload
    // apply works by calling .click() on the real difficulty/role/loadout
    // buttons, which only does anything once their own listeners are
    // attached. _bindSettings() (called earlier, at the top of the
    // constructor) runs _checkBeatThisChallenge/_checkViewProfileLink at a
    // point that predates these binds too, but neither of those touches
    // these buttons, so only this one actually needed moving.
    this._checkSetupCode()
    this._checkImportSkinCode()
    this._bindPanelRouting()
    this._bindControlsTab()
    this._applyLanguage()
    this._onResize()
    window.addEventListener('resize', () => this._onResize())
    this._checkLoginStreak()

    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.renderer.setAnimationLoop(() => this._tick())
    // Lite Textures: shrink what's loaded now, then whatever loads later
    // (weapons, zombies, the Map Editor) every few seconds.
    if (this.settings.liteTextures) this._applyLiteTextures()
    setInterval(() => {
      if (this.settings.liteTextures && !this._glLost) shrinkTextures(this._liteTextureRoots())
    }, LITE_TEXTURE_SWEEP_MS)

    // See _warmUpShaders' own comment - must run after everything above is
    // built (weapons/zombie types/chests all need to exist) but before the
    // player can possibly see anything (gameStarted is still false, #menu
    // sits fully opaque over the 3D canvas the whole time this runs).

    // Debug/QA hook - lets Playwright (or the browser console) drive real
    // game methods directly, since this project has no test suite.
    window.__game = this
    // Reveals the save-driven homepage values (see index.html's
    // html:not(.game-ready) rule).
    document.documentElement.classList.add('game-ready')

    // Arrived via a friend's invite link (?join=<sessionId>) - show the
    // Join prompt right away rather than making them find the pause menu.
  }

  _bindMenu() {
    this.playBtn.addEventListener('click', () => {
      this._enterBuildMode({ map: 'map3', play: true })
    })

    if (this.settingsInfoOverlay) {
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.settings-info-btn')
        if (!btn) {
          this.settingsInfoOverlay.style.display = 'none'
          return
        }
        const key = btn.dataset.info
        if (this.settingsInfoOverlay.style.display === 'flex' && this._settingsInfoOpenKey === key) {
          this.settingsInfoOverlay.style.display = 'none'
          this._settingsInfoOpenKey = null
          return
        }
        this._settingsInfoOpenKey = key
        this.settingsInfoText.textContent = t(`${key}InfoText`)
        this.settingsInfoOverlay.style.display = 'flex'
        const rect = btn.getBoundingClientRect()
        this.settingsInfoOverlay.style.left = `${Math.min(rect.left, window.innerWidth - 296)}px`
        this.settingsInfoOverlay.style.top = `${rect.bottom + 6}px`
      })
    }
    // Save & Exit - the non-destructive alternative to Quit to Menu above:
    // writes a full snapshot (see _captureRunSnapshot) instead of banking
    // a legacy-points payout, so Continue Run on the homepage can put the
    // player right back where they left off. Hardcore is excluded on
    // purpose - its whole design is "no do-overs" (see _isForceHardcore's
    // own callers), and letting it be saved/resumed would undermine that.
  }





  _updateStreamSafeVisibility() {
    this.fpsEl.style.display = this.settings.streamSafeMode ? 'none' : 'block'
  }

  // Watermark + optional caption compositing, then either downloads the
  // result or writes it to the OS clipboard.
  _finalizeScreenshotCanvas(canvas) {
    const ctx = canvas.getContext('2d')
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.font = `${Math.max(10, Math.round(canvas.width * 0.015))}px sans-serif`
    ctx.fillText('GayZ', canvas.width - 8, canvas.height - 8)
    ctx.textAlign = 'left'

    const link = document.createElement('a')
    link.download = `gayz-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  // Interactive World batch - 5 proximity interactables below, all sharing
  // the exact nearGenerator/nearZiplineEnd "compute a flag every tick, act
  // on it from the interact-key handler" shape already established.

  // Personal stats dashboard (batch feature) - a simple bar chart of kills
  // per run from runHistory (already tracked, newest-first, see
  // _onPlayerDeath's own unshift), most recent run on the right so reading
  // left-to-right matches reading oldest-to-newest.
  _drawStatsDashboard() {
    const canvas = this.statsDashboardCanvas
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)
    const runs = this.runHistory.slice(0, 10).reverse()
    if (runs.length === 0) return
    const maxKills = Math.max(1, ...runs.map((r) => r.kills))
    const barW = w / runs.length
    runs.forEach((run, i) => {
      const barH = (run.kills / maxKills) * (h - 14)
      const x = i * barW + 2
      ctx.fillStyle = run.survived ? 'rgba(78, 224, 111, 0.8)' : 'rgba(214, 69, 69, 0.8)'
      ctx.fillRect(x, h - barH - 12, barW - 4, barH)
      ctx.fillStyle = 'rgba(232, 232, 232, 0.6)'
      ctx.font = '9px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(run.kills), x + (barW - 4) / 2, h - 2)
    })
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
      const step = Number(sliderEl.step) || 1
      const current = Number(sliderEl.value)

      // Custom up/down buttons instead of the native <input type="number">
      // spinner (removed via -webkit-appearance: none on the spin-button
      // pseudo-elements below) - that native spinner's own chrome doesn't
      // reliably respect this input's custom dark background/border
      // across browsers, but the up/down clicking itself was a real,
      // wanted feature (flagged the moment it silently disappeared with
      // the spinner during a styling pass, 2026-09-21) - rebuilt as two
      // plain buttons so both the dark theme and the clickable steppers
      // hold regardless of platform.
      const wrap = document.createElement('span')
      wrap.className = 'audio-value-input-wrap'
      const input = document.createElement('input')
      input.type = 'number'
      input.min = min
      input.max = max
      input.step = step
      input.value = current
      input.className = 'audio-value-input'
      const stepUp = document.createElement('button')
      stepUp.type = 'button'
      stepUp.className = 'audio-value-step audio-value-step-up'
      stepUp.tabIndex = -1
      stepUp.setAttribute('aria-label', 'Increase')
      const stepDown = document.createElement('button')
      stepDown.type = 'button'
      stepDown.className = 'audio-value-step audio-value-step-down'
      stepDown.tabIndex = -1
      stepDown.setAttribute('aria-label', 'Decrease')
      wrap.append(input, stepUp, stepDown)
      valueEl.replaceWith(wrap)
      input.focus()
      input.select()

      let settled = false
      const finish = (commit) => {
        if (settled) return
        settled = true
        if (commit) {
          let v = Number(input.value)
          if (Number.isNaN(v)) v = current
          v = Math.max(min, Math.min(max, Math.round(v / step) * step))
          sliderEl.value = v
          sliderEl.dispatchEvent(new Event('input'))
        }
        delete valueEl.dataset.editing
        wrap.replaceWith(valueEl)
      }
      // mousedown preventDefault keeps focus on the <input> (a plain
      // click would otherwise blur it first, firing finish(true) before
      // the step buttons' own click handler ever runs).
      const nudge = (dir) => {
        let v = Number(input.value)
        if (Number.isNaN(v)) v = current
        input.value = Math.max(min, Math.min(max, v + dir * step))
      }
      stepUp.addEventListener('mousedown', (e) => e.preventDefault())
      stepDown.addEventListener('mousedown', (e) => e.preventDefault())
      stepUp.addEventListener('click', () => nudge(1))
      stepDown.addEventListener('click', () => nudge(-1))

      input.addEventListener('keydown', (e) => {
        if (e.code === 'Enter') { e.preventDefault(); finish(true) }
        else if (e.code === 'Escape') { e.preventDefault(); finish(false) }
      })
      input.addEventListener('blur', () => finish(true))
    })
  }

  // Master Volume - a multiplier on top of the three independent channel
  // sliders (SFX/Ambient), not a third channel of its own. Keeps whatever
  // balance the player already set between channels while still giving a
  // single "turn everything up/down" control. Called after any of the
  // three volume settings changes, rather than each slider computing its
  // own effective value inline in three separate places.
  _applyAllVolumes() {
    const master = this.settings.masterVolume / 100
    audioEngine.setSfxVolume(master * (this.settings.sfxVolume / 100))
    audioEngine.setAmbientVolume(master * (this.settings.ambientVolume / 100))
  }

  _bindSettings() {
    // Only these 4 are being called properly supported right now (product
    // call, 2026-09-11) - every language DOES have translated strings in
    // i18n.js (see that file's own standing rule - a one-time catch-up
    // already covered every key), but that hasn't been enough for a
    // "supported" bar yet, so every other language is flagged as coming
    // soon here rather than silently implying it's equally ready.
    this._renderLanguageGrid = () => {
      this.languageGrid.innerHTML = LANGUAGES.map((lang) => `
        <button class="language-btn${lang.code === this.settings.language ? ' active' : ''}" data-lang="${lang.code}">
          <span class="lang-name">${t(lang.nameKey)}</span>
          <span class="lang-native">${lang.native}</span>
          ${SUPPORTED_LANGUAGE_CODES.has(lang.code) ? '' : `<span class="lang-coming-soon">${t('languageComingSoonTag')}</span>`}
        </button>
      `).join('')
    }
    this._renderLanguageGrid()

    this.languageGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.language-btn')
      if (!btn) return
      // The button already shows its own "Coming soon" tag, but until now
      // this handler applied the switch anyway - every language DOES have
      // a real i18n block (see this function's own comment above), just
      // not synced to the 1798-key bar the 4 supported languages are held
      // to, so actually switching to one showed a jarring mix of real
      // translations and English fallback throughout the app while still
      // *looking* fully selected (active state, persisted to settings).
      // A toast instead of _openComingSoonPanel() - which would close the
      // whole Settings panel via _closeAllMenuPanels() - keeps the
      // language list open so the player can keep browsing it.
      if (!SUPPORTED_LANGUAGE_CODES.has(btn.dataset.lang)) {
        this._showHomepageToast(t('comingSoonBody'))
        return
      }
      this.settings.language = btn.dataset.lang
      // Remembered for #quick-language-btn's English<->alt toggle.
      if (btn.dataset.lang !== 'en') this.settings.quickLanguageAlt = btn.dataset.lang
      // setLanguage/_applyLanguage BEFORE saveSettings, not after - saveSettings
      // triggers the "Saved" pulse + a live _renderRecentlyChangedList() re-render
      // (see that function's own comment), which used to fire on the OLD
      // language (currentLang hadn't been updated yet) and never got a second
      // chance to re-render in the new one - "Changed this session: ..." stayed
      // in whatever language you switched FROM, every other language string on
      // screen already correctly in the new one.
      setLanguage(this.settings.language)
      this._applyLanguage()
      saveSettings(this.settings)
    })

    for (const tab of document.querySelectorAll('.settings-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.settings-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.settings-page')) {
          page.style.display = page.id === `settings-page-${tab.dataset.page}` ? 'block' : 'none'
        }
        // Reopen Settings to Last-Used Tab (General tab) - recorded on
        // every click regardless of whether the setting is on, so turning
        // it on later immediately has a real tab to restore rather than
        // needing one more click first.
        this.settings.lastSettingsTab = tab.dataset.page
        saveSettings(this.settings)
      })
    }

    // Quests panel tab strip - same pattern as .settings-tab above, kept as
    // a separate class/loop so quest tabs don't get swept into the
    // settings-tab handler's global .settings-tab/.settings-page queries.
    for (const tab of document.querySelectorAll('.quest-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.quest-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.quest-tab-page')) {
          page.style.display = page.id === `quests-page-${tab.dataset.questPage}` ? 'flex' : 'none'
        }
      })
    }

    // Upgrades panel tab strip (Upgrades/Special Ammo Guide) - same isolated
    // class/loop pattern as the quest tabs above.
    for (const tab of document.querySelectorAll('.upgrades-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.upgrades-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.upgrades-tab-page')) {
          page.style.display = page.id === `upgrades-page-${tab.dataset.upgradesPage}` ? 'flex' : 'none'
        }
      })
    }

    // Profile panel tab strip (Shown to Public/Hidden) - same isolated
    // class/loop pattern as the Upgrades tabs above.
    for (const tab of document.querySelectorAll('.profile-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.profile-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.profile-tab-page')) {
          page.style.display = page.id === `profile-page-${tab.dataset.profilePage}` ? 'flex' : 'none'
        }
      })
    }

    // Hub panel tab strip (Zombie Survival/Deathmatch) - same isolated
    // class/loop pattern as the quest tabs above.
    for (const tab of document.querySelectorAll('.hub-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.hub-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.hub-tab-page')) {
          page.style.display = page.id === `hub-page-${tab.dataset.hubPage}` ? 'flex' : 'none'
        }
      })
    }

    // Inventory panel tab strip (Character/Crates/Weapons/Theme) - same
    // isolated class/loop pattern as the quest/hub tabs above.
    for (const tab of document.querySelectorAll('.inventory-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.inventory-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.inventory-tab-page')) {
          page.style.display = page.id === `inventory-page-${tab.dataset.inventoryPage}` ? 'block' : 'none'
        }
      })
    }

    // Shop crate cards - ONE listener per card (not a separate button-level
    // listener plus a card-level one) and explicitly scoped to
    // #shop-crate-tier-grid, not `.crate-card`/`.crate-open-btn` globally.
    // Inventory > Crates reuses those exact same class names purely for
    // matching visual styling (see _renderInventorySkins/that tab's own
    // markup) - its crates are deliberately free/cost-nothing (explicit
    // request), but the OLD unscoped `document.querySelectorAll('.crate-
    // open-btn')` matched Inventory's copies too, silently charging real
    // coins to open them (real regression, caught 2026-09-21). The old
    // split into two separate global listeners (one per button, one per
    // card, relying on event-bubbling + e.target.closest() to route
    // between them) also intermittently failed to fire the button's own
    // handler on a fresh page load for reasons never fully root-caused
    // despite extensive live testing - consolidating into one listener
    // per card removes that whole class of failure, since there's only
    // ever one handler deciding what a click meant, not two racing/
    // depending on each other.
    for (const card of document.querySelectorAll('#shop-crate-tier-grid .crate-card')) {
      card.addEventListener('click', (e) => {
        const tierClass = [...card.classList].find((c) => c.startsWith('crate-tier-'))
        if (!tierClass) return
        const tier = tierClass.slice('crate-tier-'.length)
        const btn = e.target.closest('.crate-open-btn')
        if (btn) {
          if (!btn.disabled) this._openCrate(tier)
        } else {
          this._openCratePurchaseModal(tier)
        }
      })
    }

    // Inventory > Crates' own cards - separate listener, separate scope
    // (#inventory-page-crates, never #shop-crate-tier-grid) than the Shop
    // one above, same "one listener per card, no cross-scope selectors"
    // reasoning as that one's own comment. Only the Open button does
    // anything here - clicking elsewhere on the card has no purchase
    // modal to open (Inventory doesn't buy, only opens what's already
    // owned), so it's a no-op rather than reusing _openCratePurchaseModal.
    for (const card of document.querySelectorAll('#inventory-page-crates .crate-card')) {
      card.addEventListener('click', (e) => {
        const tierClass = [...card.classList].find((c) => c.startsWith('crate-tier-'))
        if (!tierClass) return
        const tier = tierClass.slice('crate-tier-'.length)
        const btn = e.target.closest('.crate-open-btn')
        if (btn && !btn.disabled) this._openOwnedCrate(tier)
      })
    }

    if (this.cratePurchaseQtyMinus) {
      this.cratePurchaseQtyMinus.addEventListener('click', () => {
        this._cratePurchaseQty = Math.max(1, this._cratePurchaseQty - 1)
        this._updateCratePurchaseModal()
      })
    }
    if (this.cratePurchaseQtyPlus) {
      this.cratePurchaseQtyPlus.addEventListener('click', () => {
        this._cratePurchaseQty += 1
        this._updateCratePurchaseModal()
      })
    }
    if (this.cratePurchaseQtyValue) {
      // Live total-price feedback while typing, without re-clamping or
      // overwriting the input's own value mid-keystroke (that would
      // fight the user's typing - e.g. snapping "1" back while they're
      // still in the middle of typing "10").
      this.cratePurchaseQtyValue.addEventListener('input', () => {
        const raw = parseInt(this.cratePurchaseQtyValue.value, 10)
        if (!Number.isFinite(raw) || raw < 1) return
        this._cratePurchaseQty = raw
        const tierConfig = CRATE_TIERS[this._cratePurchaseTier]
        if (tierConfig) this.cratePurchaseTotalAmount.textContent = tierConfig.cost * raw
      })
      // Final clamp once they're actually done (blur/Enter/spinner) -
      // this is where an out-of-range typed value gets corrected back.
      this.cratePurchaseQtyValue.addEventListener('change', () => this._updateCratePurchaseModal())
    }
    if (this.cratePurchaseConfirmBtn) {
      this.cratePurchaseConfirmBtn.addEventListener('click', () => this._confirmCratePurchase())
    }
    if (this.cratePurchaseCloseBtn) {
      this.cratePurchaseCloseBtn.addEventListener('click', () => this._closeCratePurchaseModal())
    }
    if (this.cratePurchaseModal) {
      this.cratePurchaseModal.addEventListener('click', (e) => {
        if (e.target === this.cratePurchaseModal) this._closeCratePurchaseModal()
      })
    }

    // Shared red-X close button on every .panel-box panel (Settings, Shop,
    // What's New, How to Play, etc). #crate-purchase-close-btn shares this
    // class for the look but keeps its own handler above, so skip it here.
    for (const btn of document.querySelectorAll('.panel-close-btn')) {
      if (btn.id === 'crate-purchase-close-btn') continue
      btn.addEventListener('click', () => {
        if (btn.closest('#other-profile-panel')) this._closeOtherPlayerProfile()
        else this._closeAllMenuPanels()
      })
    }

    // Character tab's skin list (see _renderInventorySkins) - one
    // delegated listener since the rows get fully replaced on every
    // render, same reasoning as chat's own click-to-mute delegation.
    // Clicking a card opens its Equip/Inspect menu next to it (Kirka's
    // inventory does the same); clicking anywhere else closes it.
    if (this.inventorySkinsList) {
      this.inventorySkinsList.addEventListener('click', (e) => {
        const card = e.target.closest('[data-inventory-skin]')
        if (!card) return
        e.stopPropagation()
        this._openInventorySkinMenu(card)
      })
    }
    if (this.inventoryWeaponsList) {
      this.inventoryWeaponsList.addEventListener('click', (e) => {
        const card = e.target.closest('[data-weapon-card]')
        if (!card) return
        e.stopPropagation()
        this._openInventorySkinMenu(card)
      })
    }
    document.getElementById('inspect-close')?.addEventListener('click', () => this._closeInspectDialog())
    document.getElementById('inspect-dialog')?.addEventListener('click', (e) => {
      if (e.target.id === 'inspect-dialog') this._closeInspectDialog()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._inspectViewer) this._closeInspectDialog()
    })
    if (this.invSkinMenu) {
      this.invSkinMenu.addEventListener('click', (e) => e.stopPropagation())
      this.invSkinMenuEquip.addEventListener('click', () => {
        const id = this._invSkinMenuFor
        const kind = this._invSkinMenuKind
        this._closeInventorySkinMenu()
        if (id && kind === 'character') this._equipInventorySkin(id)
      })
      this.invSkinMenuInspect.addEventListener('click', () => {
        const id = this._invSkinMenuFor
        const kind = this._invSkinMenuKind
        this._closeInventorySkinMenu()
        if (id) this._openInspectDialog(kind, id)
      })
      const tradeClick = (btn, open) => btn?.addEventListener('click', () => {
        const id = this._invSkinMenuFor
        this._closeInventorySkinMenu()
        if (!id) return
        if (btn.classList.contains('locked')) {
          this._showHomepageToast(t('marketCantTrade'))
          return
        }
        open(id)
      })
      tradeClick(this.invSkinMenuSell, (id) => this._openSellDialog(id))
      tradeClick(this.invSkinMenuMarket, (id) => this._openListDialog(id))
      document.addEventListener('click', () => this._closeInventorySkinMenu())
    }
    if (this.invSkinSearch) this.invSkinSearch.addEventListener('input', () => this._renderInventorySkins())
    this.shopMarketGrid?.addEventListener('click', (e) => {
      const card = e.target.closest('[data-market-listing]')
      if (!card || !Array.isArray(this._marketListings)) return
      const listing = this._marketListings.find((l) => l.id === card.dataset.marketListing)
      const entry = listing && INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
      if (!entry) return
      const name = entry.nameKey ? t(entry.nameKey) : entry.name
      if (this._cloudUid && listing.sellerUid === this._cloudUid) {
        this._openTradeDialog('cancel', { listing, name })
        return
      }
      const price = _safeStatNumber(listing.price)
      if (this.coins < price) {
        this._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - this.coins).toLocaleString() }))
        return
      }
      this._openTradeDialog('buy', { listing, name, seller: String(listing.sellerName || '').slice(0, 24), priceLabel: this._formatSkinPrice('coins', price) })
    })
    if (this.tradeDialog) {
      document.getElementById('trade-dialog-close').addEventListener('click', () => this._closeTradeDialog())
      this.tradeDialog.addEventListener('click', (e) => { if (e.target === this.tradeDialog) this._closeTradeDialog() })
      document.getElementById('trade-dialog-minus').addEventListener('click', () => this._stepTradeDialogPrice(-1))
      document.getElementById('trade-dialog-plus').addEventListener('click', () => this._stepTradeDialogPrice(1))
      this.tradeDialogPrice.addEventListener('input', () => this._updateTradeDialogFee())
      this.tradeDialogAction.addEventListener('click', () => this._confirmTradeDialog())
    }
    this.marketSearch?.addEventListener('input', () => {
      this._marketQuery = this.marketSearch.value
      this._renderShopMarket()
    })
    if (this.marketItemFilterBtn && this.marketItemFilterMenu) {
      this.marketItemFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._toggleMarketFilterMenu(this.marketItemFilterBtn, this.marketItemFilterMenu)
      })
      // Ticking stays open so several items can be changed in one go.
      this.marketItemFilterMenu.addEventListener('click', (e) => {
        e.stopPropagation()
        const opt = e.target.closest('[data-market-item]')
        if (!opt) return
        const all = this._marketItemOptions().map((i) => i.id)
        const ticked = this._marketItems || new Set(all)
        const id = opt.dataset.marketItem
        if (ticked.has(id)) ticked.delete(id)
        else ticked.add(id)
        this._marketItems = ticked.size === all.length ? null : ticked
        this._renderMarketFilters()
        this._renderShopMarket()
      })
    }
    if (this.marketRarityFilterBtn && this.marketRarityFilterMenu) {
      this.marketRarityFilterBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._toggleMarketFilterMenu(this.marketRarityFilterBtn, this.marketRarityFilterMenu)
      })
      this.marketRarityFilterMenu.addEventListener('click', (e) => {
        e.stopPropagation()
        const opt = e.target.closest('[data-market-rarity]')
        if (!opt) return
        this._marketRarity = opt.dataset.marketRarity
        this._closeMarketFilterMenus()
        this._renderMarketFilters()
        this._renderShopMarket()
      })
    }
    document.addEventListener('click', () => this._closeMarketFilterMenus())

    // Clan panel tab strip (General/Clan/Market) - same isolated
    // class/loop pattern as the other tab strips above.
    for (const tab of document.querySelectorAll('.general-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.general-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.general-tab-page')) {
          page.style.display = page.id === `general-page-${tab.dataset.generalPage}` ? 'block' : 'none'
        }
        if (tab.dataset.generalPage === 'clan') this._refreshClanUi()
      })
    }

    // Clan tab's own sub-tabs (My Clan/Clan Ranking/Clan War) - fixes a
    // real gap where the "All Clans" list used to live only inside the
    // not-in-a-clan browse state, so once you'd joined a clan there was no
    // way to see any other clan at all, ranking included. Ranking now
    // renders fresh every time its sub-tab is clicked (not cached, and not
    // fetched on every Clan-tab open either - it does a real network read
    // per clan to total their kills, see _renderClanRanking's own comment,
    // so only paying that cost when someone actually looks at it).
    for (const tab of document.querySelectorAll('.clan-subtab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.clan-subtab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.clan-subtab-page')) {
          page.style.display = page.id === `clan-subpage-${tab.dataset.clanSubpage}` ? 'block' : 'none'
        }
        if (tab.dataset.clanSubpage === 'ranking') this._renderClanRanking()
      })
    }

    // Achievements panel mode tabs (Zombie Survival/Deathmatch) - no
    // achievement is tagged to a mode (Deathmatch itself is still locked/
    // "Coming Soon" everywhere else in the game, see the Hub's own
    // deathmatch tab), so Zombie Survival just shows the existing full
    // list and Deathmatch shows a plain placeholder in its place.
    for (const tab of document.querySelectorAll('.achievements-mode-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.achievements-mode-tab')) tabEl.classList.toggle('active', tabEl === tab)
        this._achievementsMode = tab.dataset.achievementsMode
        this._renderAchievementsPanel()
      })
    }

    this.masterVolumeSlider.value = this.settings.masterVolume
    this.masterVolumeValue.textContent = `${this.settings.masterVolume}%`
    this.sfxVolumeSlider.value = this.settings.sfxVolume
    this.sfxVolumeValue.textContent = `${this.settings.sfxVolume}%`
    this.ambientVolumeSlider.value = this.settings.ambientVolume
    this.ambientVolumeValue.textContent = `${this.settings.ambientVolume}%`
    this._applyAllVolumes()

    this.masterVolumeSlider.addEventListener('input', () => {
      const value = Number(this.masterVolumeSlider.value)
      this.masterVolumeValue.textContent = `${value}%`
      this.settings.masterVolume = value
      this._applyAllVolumes()
      saveSettings(this.settings)
    })

    this.sfxVolumeSlider.addEventListener('input', () => {
      const value = Number(this.sfxVolumeSlider.value)
      this.sfxVolumeValue.textContent = `${value}%`
      this.settings.sfxVolume = value
      this._applyAllVolumes()
      saveSettings(this.settings)
    })

    this.ambientVolumeSlider.addEventListener('input', () => {
      const value = Number(this.ambientVolumeSlider.value)
      this.ambientVolumeValue.textContent = `${value}%`
      this.settings.ambientVolume = value
      this._applyAllVolumes()
      saveSettings(this.settings)
    })

    this.muteOnBlurToggle.checked = this.settings.muteOnTabBlur
    this.muteOnBlurToggle.addEventListener('change', () => {
      this.settings.muteOnTabBlur = this.muteOnBlurToggle.checked
      saveSettings(this.settings)
    })
    // Belongs here rather than a per-tab bind since it needs to keep
    // working regardless of which settings tab (or panel) is open when
    // the player alt-tabs away - checked live off this.settings each
    // time, not captured once at bind time.
    document.addEventListener('visibilitychange', () => {
      if (!this.settings.muteOnTabBlur) return
      if (document.hidden) audioEngine.pause()
      else audioEngine.resume()
    })

    this.positionalAudioToggle.checked = this.settings.positionalAudio
    audioEngine.setPositionalAudio(this.settings.positionalAudio)
    this.positionalAudioToggle.addEventListener('change', () => {
      this.settings.positionalAudio = this.positionalAudioToggle.checked
      audioEngine.setPositionalAudio(this.settings.positionalAudio)
      saveSettings(this.settings)
    })

    this.sensitivitySlider.value = this.settings.sensitivity
    this.sensitivityValue.textContent = `${this.settings.sensitivity}%`
    this.invertYToggle.checked = this.settings.invertY

    this.fovSlider.value = this.settings.fov
    this.fovValue.textContent = `${this.settings.fov}`

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
      saveSettings(this.settings)
    })

    this.invertYToggle.addEventListener('change', () => {
      this.settings.invertY = this.invertYToggle.checked
      saveSettings(this.settings)
    })

    this.fovSlider.addEventListener('input', () => {
      const value = Number(this.fovSlider.value)
      this.fovValue.textContent = `${value}`
      this.settings.fov = value
      saveSettings(this.settings)
    })

    this.adsFovSlider.value = this.settings.adsFov
    this.adsFovValue.textContent = `${this.settings.adsFov}`
    this.adsFovSlider.addEventListener('input', () => {
      const value = Number(this.adsFovSlider.value)
      this.adsFovValue.textContent = `${value}`
      this.settings.adsFov = value
      saveSettings(this.settings)
    })

    this.mouseAccelerationToggle.checked = this.settings.mouseAcceleration
    this.mouseAccelerationToggle.addEventListener('change', () => {
      this.settings.mouseAcceleration = this.mouseAccelerationToggle.checked
      saveSettings(this.settings)
    })

    this.invertScrollToggle.checked = this.settings.invertScrollWeaponSwitch
    this.invertScrollToggle.addEventListener('change', () => {
      this.settings.invertScrollWeaponSwitch = this.invertScrollToggle.checked
      saveSettings(this.settings)
    })

    this.doubleClickSpeedSlider.value = this.settings.doubleClickSpeed
    this.doubleClickSpeedValue.textContent = `${this.settings.doubleClickSpeed}ms`
    this.doubleClickSpeedSlider.addEventListener('input', () => {
      const value = Number(this.doubleClickSpeedSlider.value)
      this.doubleClickSpeedValue.textContent = `${value}ms`
      this.settings.doubleClickSpeed = value
      saveSettings(this.settings)
    })

    this.gamepadDeadzoneSlider.value = this.settings.gamepadDeadzone
    this.gamepadDeadzoneValue.textContent = `${this.settings.gamepadDeadzone}%`
    this.gamepadDeadzoneSlider.addEventListener('input', () => {
      const value = Number(this.gamepadDeadzoneSlider.value)
      this.gamepadDeadzoneValue.textContent = `${value}%`
      this.settings.gamepadDeadzone = value
      saveSettings(this.settings)
    })

    this.gamepadVibrationToggle.checked = this.settings.gamepadVibration
    this.gamepadVibrationToggle.addEventListener('change', () => {
      this.settings.gamepadVibration = this.gamepadVibrationToggle.checked
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
    // own use of settings.recoilShakeIntensity/damageShakeIntensity, no
    // DOM/CSS effect to apply here. Split from one combined slider into
    // two (weapon recoil vs damage/impact) so a player who wants to feel
    // gunfire kick but not get jolted by explosions (or the reverse) can
    // tune them independently.
    this.recoilShakeSlider.value = this.settings.recoilShakeIntensity
    this.recoilShakeValue.textContent = `${this.settings.recoilShakeIntensity}%`
    this.recoilShakeSlider.addEventListener('input', () => {
      const value = Number(this.recoilShakeSlider.value)
      this.recoilShakeValue.textContent = `${value}%`
      this.settings.recoilShakeIntensity = value
      saveSettings(this.settings)
    })
    this.damageShakeSlider.value = this.settings.damageShakeIntensity
    this.damageShakeValue.textContent = `${this.settings.damageShakeIntensity}%`
    this.damageShakeSlider.addEventListener('input', () => {
      const value = Number(this.damageShakeSlider.value)
      this.damageShakeValue.textContent = `${value}%`
      this.settings.damageShakeIntensity = value
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
      const defaultAccent = '#d9bc4a'
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
      const defaultPlayColor = '#d9bc4a'
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
        // Only previews a candidate name in the box - doesn't save/apply it.
        // Player can click Random again to reroll, then confirm via the
        // pencil icon (see _confirmNicknameEdit) once they like one.
        const adj = RANDOM_NICKNAME_ADJECTIVES[Math.floor(Math.random() * RANDOM_NICKNAME_ADJECTIVES.length)]
        const noun = RANDOM_NICKNAME_NOUNS[Math.floor(Math.random() * RANDOM_NICKNAME_NOUNS.length)]
        const suffix = Math.floor(Math.random() * 90) + 10
        this.nicknameInput.value = `${adj}${noun}${suffix}`.slice(0, 16)
        this.nicknameInput.focus()
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
    this.toggleSprintToggle.addEventListener('change', () => {
      this.settings.toggleSprint = this.toggleSprintToggle.checked
      saveSettings(this.settings)
    })
    this.toggleCrouchToggle.checked = this.settings.toggleCrouch
    this.toggleCrouchToggle.addEventListener('change', () => {
      this.settings.toggleCrouch = this.toggleCrouchToggle.checked
      saveSettings(this.settings)
    })
    this.toggleAdsToggle.checked = this.settings.toggleAds
    this.toggleAdsToggle.addEventListener('change', () => {
      this.settings.toggleAds = this.toggleAdsToggle.checked
      saveSettings(this.settings)
    })

    // Aim Assist (accessibility) - see WeaponSystem's AIM_ASSIST_OFFSETS.
    this.aimAssistToggle.checked = this.settings.aimAssist
    // Touch aiming is inherently less precise than a mouse - entering
    // touch mode turns on aim assist for this session only. Deliberately
    // does NOT write back to this.settings.aimAssist/saveSettings - a
    // player who later plays on desktop keeps whatever they had before.
    this.aimAssistToggle.addEventListener('change', () => {
      this.settings.aimAssist = this.aimAssistToggle.checked
      saveSettings(this.settings)
    })

    // Touch Controls override (see TouchControls.js) - decided once per
    // session in the constructor, not re-evaluated live, so changing it
    // reloads the page rather than trying to hot-swap input modes.
    if (this.touchControlsOverrideSelect) {
      this.touchControlsOverrideSelect.value = this.settings.touchControlsOverride
      this.touchControlsOverrideSelect.addEventListener('change', () => {
        this.settings.touchControlsOverride = this.touchControlsOverrideSelect.value
        saveSettings(this.settings)
        window.location.reload()
      })
    }

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
    this._bindEditableSliderValue(this.masterVolumeValue, this.masterVolumeSlider)
    this._bindEditableSliderValue(this.sfxVolumeValue, this.sfxVolumeSlider)
    this._bindEditableSliderValue(this.sensitivityValue, this.sensitivitySlider)
    this._bindEditableSliderValue(this.fovValue, this.fovSlider)
    this._bindEditableSliderValue(this.hudScaleValue, this.hudScaleSlider)
    this._bindEditableSliderValue(this.hudOpacityValue, this.hudOpacitySlider)
    this._bindEditableSliderValue(this.recoilShakeValue, this.recoilShakeSlider)
    this._bindEditableSliderValue(this.damageShakeValue, this.damageShakeSlider)
    this._bindEditableSliderValue(this.toastDurationValue, this.toastDurationSlider)
    this._bindEditableSliderValue(this.crosshairSizeValue, this.crosshairSizeSlider)

    this.colorblindModeSelect.value = this.settings.colorblindMode
    setColorblindMode(this.settings.colorblindMode)

    this.colorblindModeSelect.addEventListener('change', () => {
      this.settings.colorblindMode = this.colorblindModeSelect.value
      setColorblindMode(this.settings.colorblindMode)
      if (this.quickColorblindBtn) this.quickColorblindBtn.classList.toggle('active', this.settings.colorblindMode !== 'off')
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
      this.frameTimeGraphToggle.addEventListener('change', () => {
        this.settings.frameTimeGraph = this.frameTimeGraphToggle.checked
        saveSettings(this.settings)
      })
    }
    if (this.homepageFpsToggle) {
      this.homepageFpsToggle.checked = this.settings.homepageFpsCounter
      if (this.settings.homepageFpsCounter) this.fpsEl.style.opacity = '1'
      this.homepageFpsToggle.addEventListener('change', () => {
        this.settings.homepageFpsCounter = this.homepageFpsToggle.checked
        this.fpsEl.style.opacity = (this.settings.homepageFpsCounter || this.gameStarted) ? '1' : '0'
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
    // Theme (Old/Golden) - was a plain <select>, replaced with two
    // clickable preview-image cards per request (Inventory > Theme).
    // Golden is the current live UI (every existing button/panel style is
    // unscoped, i.e. Golden by default, no class needed); Old's look is
    // driven entirely off html.ui-theme-old (see style.css's many
    // html.ui-theme-old overrides, e.g. #menu-bg-photo, #menu-player-badge).
    if (this.themePickerGolden && this.themePickerOld) {
      const applyUiTheme = () => {
        document.documentElement.classList.toggle('ui-theme-old', this.settings.uiTheme === 'old')
        this.themePickerGolden.classList.toggle('active', this.settings.uiTheme !== 'old')
        this.themePickerOld.classList.toggle('active', this.settings.uiTheme === 'old')
        // Keep the Skin Designer panel in sync too, for the case where it's
        // already open (its iframe src is only ever set once - see
        // _openSkinDesignerPanel - so it can't just pick up a fresh
        // ?theme= param on its own after that).
        if (this.skindesignerFrame && this.skindesignerFrame.src !== 'about:blank') {
          const theme = this.settings.uiTheme === 'old' ? 'old' : 'golden'
          this.skindesignerFrame.contentWindow.postMessage({ type: 'gayz-set-theme', theme }, SKIN_DESIGNER_ORIGIN)
        }
      }
      applyUiTheme()
      this.themePickerGolden.addEventListener('click', () => {
        this.settings.uiTheme = 'golden'
        applyUiTheme()
        saveSettings(this.settings)
      })
      this.themePickerOld.addEventListener('click', () => {
        this.settings.uiTheme = 'old'
        applyUiTheme()
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
        if (this.settings.crtScanlines && this.settings.shareTelemetry) CloudSync.incrementTelemetry('crtEnabled').catch(() => {})
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
    if (this.sfxTestBtn) {
      this.sfxTestBtn.addEventListener('click', () => {
        audioEngine.init()
        audioEngine.resume()
        audioEngine.playShot('pistol')
      })
    }

    this.performanceToggle.checked = this.settings.performanceMode
    this._applyPerformanceMode(this.settings.performanceMode)
    // Mobile GPUs are generally much weaker than desktop - entering touch
    // mode turns on Performance Mode (reduced shadows/bloom/render scale/
    // draw distance, see _applyPerformanceMode) for this session only,
    // same "don't overwrite the saved preference" reasoning as the aim
    // assist default above. The checkbox/quick-toggle still shows and
    // controls the real settings.performanceMode value underneath -
    // toggling it off during a touch session turns this back off too,
    // exactly like any other setting change would.

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
    this.mutatorEscalation.checked = this.settings.mutators.escalation
    this.mutatorEscalation.addEventListener('change', () => {
      this.settings.mutators.escalation = this.mutatorEscalation.checked
      saveSettings(this.settings)
    })
    this.mutatorCursedRun.checked = this.settings.mutators.cursedRun
    this.mutatorCursedRun.addEventListener('change', () => {
      this.settings.mutators.cursedRun = this.mutatorCursedRun.checked
      saveSettings(this.settings)
    })
    this.mutatorRandomizer.checked = this.settings.mutators.randomizer
    this.mutatorRandomizer.addEventListener('change', () => {
      this.settings.mutators.randomizer = this.mutatorRandomizer.checked
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

    this.nicknameInput.addEventListener('input', () => {
      // Standard keyboard characters only (letters, numbers, punctuation) -
      // strips emoji/other unicode a player might paste in.
      const filtered = this.nicknameInput.value.replace(/[^\x20-\x7E]/g, '')
      if (filtered !== this.nicknameInput.value) this.nicknameInput.value = filtered
      // .trim() only on the SAVED value, not the input box itself - a
      // trailing space while still mid-typing is harmless and shouldn't
      // be yanked out from under the cursor, but a leading/trailing
      // space that makes it into settings.nickname (what actually gets
      // synced/displayed/used for chat lookups elsewhere) is a real,
      // silent footgun - caught 2026-09-22 live-debugging a "can't
      // copy/block a friend in chat" report: their chat nickname
      // rendered as "Tazbot " (trailing space, from not having this
      // trim), which would break the by-NAME lookup fallback specifically
      // if it's ever reached. Not confirmed as the actual cause of that
      // report (their by-UID lookup failing first is equally explained by
      // them not having completed a run yet - no leaderboard doc to find
      // by either key) but worth fixing regardless, on its own merits.
      this.settings.nickname = this.nicknameInput.value.trim()
      saveSettings(this.settings)
      this._renderPlayerTag()
    })
    this.companionNameInput.addEventListener('input', () => {
      this.settings.companionName = this.companionNameInput.value
      saveSettings(this.settings)
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
    if (this.hubBtn) this.hubBtn.addEventListener('click', () => trackAndOpen(() => this._openClanPanel()))
    if (this.gamemodeBtn) this.gamemodeBtn.addEventListener('click', () => trackAndOpen(() => this._openHubPanel()))
    if (this.comingSoonCloseBtn) this.comingSoonCloseBtn.addEventListener('click', () => this._closeComingSoonPanel())
    if (this.howtoplayNavLink) this.howtoplayNavLink.addEventListener('click', () => this._openHowToPlayPanel())
    if (this.whatsNewLink) this.whatsNewLink.addEventListener('click', () => trackAndOpen(() => this._openWhatsNewPanel()))
    if (this.friendsBtn) this.friendsBtn.addEventListener('click', () => trackAndOpen(() => this._openFriendsPanel()))
    if (this.statusPickerToggle) {
      this.statusPickerToggle.addEventListener('click', (e) => {
        e.stopPropagation()
        this.statusPicker.classList.toggle('open')
      })
    }
    for (const btn of this.statusPickBtns) {
      btn.addEventListener('click', () => {
        this._applyStatusMode(btn.dataset.status)
        this.statusPicker.classList.remove('open')
      })
    }
    document.addEventListener('click', (e) => {
      if (this.statusPicker && this.statusPicker.classList.contains('open') && !this.statusPicker.contains(e.target)) {
        this.statusPicker.classList.remove('open')
      }
    })
    if (this.friendsSigninBtn) this.friendsSigninBtn.addEventListener('click', () => this._handleCloudSignIn())
    if (this.menuInventoryBtn) this.menuInventoryBtn.addEventListener('click', () => trackAndOpen(() => this._openMenuInventoryPanel()))
    if (this.serverBtn) this.serverBtn.addEventListener('click', () => trackAndOpen(() => this._openServerPanel()))
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
        // Rebuilds clean print-only markup (name/status pairs in a
        // 2-column grid) instead of cloning achievementsOptions.innerHTML
        // verbatim (2026-09-21) - the live cards are `.perk-option`
        // buttons built for the dark in-game panel, and reusing that
        // markup for print left every field stacked on its own
        // underlined line with no sections/summary, unreadable on paper.
        // Respects whatever filter/category/sort is currently applied,
        // same as before - this prints what you're looking at.
        const filter = (this.achievementsFilterInput?.value || '').trim().toLowerCase()
        const category = this.achievementsCategorySelect?.value || 'all'
        const sortMode = this.achievementsSortSelect?.value || 'default'
        const buildRow = (name, unlocked, status) =>
          `<div class="print-ach-row ${unlocked ? 'unlocked' : 'locked'}"><span class="print-ach-name">${_escapeHtml(name)}</span><span class="print-ach-status">${_escapeHtml(status)}</span></div>`

        let achList = ACHIEVEMENTS.filter((ach) => category === 'all' || ach.category === category)
        if (sortMode === 'achieved') achList = achList.filter((ach) => this.achievements.unlocked.has(ach.id))
        else if (sortMode === 'incomplete') achList = achList.filter((ach) => !this.achievements.unlocked.has(ach.id))
        const achRows = achList
          .map((ach) => {
            const unlocked = this.achievements.unlocked.has(ach.id)
            const name = unlocked ? t(ach.titleKey) : '???'
            if (filter && !name.toLowerCase().includes(filter)) return null
            const status = unlocked ? t('achievementUnlockedShort') : (ach.hintKey ? t(ach.hintKey) : t('achievementLocked'))
            return buildRow(name, unlocked, status)
          })
          .filter(Boolean)
          .join('')

        const bestiaryRows = Object.values(ZOMBIE_TYPES)
          .map((type) => {
            const known = this.bestiaryEncountered.has(type.id)
            if (sortMode === 'achieved' && !known) return null
            if (sortMode === 'incomplete' && known) return null
            const name = known ? type.label : '???'
            if (filter && !name.toLowerCase().includes(filter)) return null
            return buildRow(name, known, known ? t('achievementUnlockedShort') : t('achievementLocked'))
          })
          .filter(Boolean)
          .join('')

        // Counts are the true overall totals, not the filtered row
        // count - so "0/12 unlocked" doesn't show up when you've simply
        // filtered the list down to "Incomplete" (every row unlocked=0
        // there by definition, which would be a meaningless count).
        const achSummary = t('printAchievementsSummary', { unlocked: this.achievements.unlocked.size, total: ACHIEVEMENTS.length })
        const bestiarySummary = t('printAchievementsSummary', { unlocked: this.bestiaryEncountered.size, total: Object.keys(ZOMBIE_TYPES).length })
        this.printStatsSheet.innerHTML = `
          <h1>${t('printAchievementsTitle')}</h1>
          ${achRows ? `<h2 class="print-ach-section">${_escapeHtml(t('printAchievementsSectionAchievements'))} — ${_escapeHtml(achSummary)}</h2><div class="print-ach-grid">${achRows}</div>` : ''}
          ${bestiaryRows ? `<h2 class="print-ach-section">${_escapeHtml(t('printAchievementsSectionBestiary'))} — ${_escapeHtml(bestiarySummary)}</h2><div class="print-ach-grid">${bestiaryRows}</div>` : ''}
        `
        window.print()
      })
    }
    this.menuPlayerBadge.addEventListener('click', () => this._openProfilePanel())
    this.menuPlayerBadge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this._openProfilePanel()
      }
    })
    if (this.menuAvatarLevel) {
      this.menuAvatarLevel.addEventListener('click', (e) => {
        e.stopPropagation()
        this._openLevelsPanel()
      })
    }
    // Pencil icon in the Player showcase panel reveals the same
    // #nickname-row (hidden by default since the old always-visible
    // Player Setup form was replaced with just "Player" + the big avatar).
    // The corner ID tag has no editor of its own - it's not editable,
    // it's a stable random id - clicking it copies it instead (see below),
    // stopPropagation so that doesn't also trigger the parent badge's
    // "open profile" click.
    if (this.menuPlayerTag) {
      this.menuPlayerTag.addEventListener('click', (e) => {
        e.stopPropagation()
        this._copyPlayerId()
      })
    }
    if (this.playerShowcaseRenameBtn) {
      // Toggle: first click opens the editor, a second click (while it's
      // already open) confirms whatever's in the box - including a random
      // suggestion the player hasn't typed themselves - and closes it.
      this.playerShowcaseRenameBtn.addEventListener('click', () => {
        if (this.nicknameRow && this.nicknameRow.style.display !== 'none') {
          this._confirmNicknameEdit()
        } else {
          this._revealNicknameEditor()
        }
      })
    }
    if (this.nicknameInput && this.nicknameRow) {
      // Short delay before hiding on blur so a click on the adjacent
      // Random button (which also steals focus) has time to register
      // first - a plain synchronous hide would swallow that click.
      this.nicknameInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (document.activeElement !== this.nicknameInput) this.nicknameRow.style.display = 'none'
        }, 150)
      })
      this.nicknameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.nicknameInput.blur()
      })
    }
    if (this.sharedProfileCloseBtn) {
      this.sharedProfileCloseBtn.addEventListener('click', () => { this.sharedProfileBanner.style.display = 'none' })
    }
    if (this.whatsNewDigestCloseBtn) {
      this.whatsNewDigestCloseBtn.addEventListener('click', () => {
        clearTimeout(this._whatsNewDigestFadeTimer)
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
    // Same handler as the two above - Google Sign-In is the only auth
    // method here, so "Login" and "Register" both just trigger it.
    if (this.profileGateLoginBtn) this.profileGateLoginBtn.addEventListener('click', () => this._handleCloudSignIn())
    if (this.profileGateRegisterBtn) this.profileGateRegisterBtn.addEventListener('click', () => this._handleCloudSignIn())
    if (this.profileSignoutBtn) {
      this.profileSignoutBtn.addEventListener('click', async () => {
        await CloudSaveUI.handleCloudSignOut(this)
        this._renderProfileAccountRow()
      })
    }
    if (this.profileCareerPortraitBtn) this.profileCareerPortraitBtn.addEventListener('click', () => this._generateCareerPortrait())
    if (this.reportBugBtn) this.reportBugBtn.addEventListener('click', () => this._reportBug())
    this.creditsBtn.addEventListener('click', () => trackAndOpen(() => this._openCreditsPanel()))
    if (this.termsBtn) this.termsBtn.addEventListener('click', () => trackAndOpen(() => this._openTermsPanel()))
    const navPrivacyLink = document.getElementById('nav-privacy-link')
    if (navPrivacyLink) navPrivacyLink.addEventListener('click', () => trackAndOpen(() => this._openPrivacyPanel()))
    if (this.creditsTermsLink) this.creditsTermsLink.addEventListener('click', () => trackAndOpen(() => this._openTermsPanel()))
    if (this.creditsPrivacyLink) this.creditsPrivacyLink.addEventListener('click', () => trackAndOpen(() => this._openPrivacyPanel()))
    if (this.gayzFeaturesBtn) this.gayzFeaturesBtn.addEventListener('click', () => trackAndOpen(() => this._openFeaturesPanel()))
    if (this.skindesignerBtn) this.skindesignerBtn.addEventListener('click', () => trackAndOpen(() => this._openSkinDesignerPanel()))
    this._bindSkinDesignerMessages()
    this._bindFeaturesPanel()
    // Cross-reference links inside the Terms/Privacy body text themselves
    // (event delegation - each doc only has 1-3 of these, but delegating
    // keeps this binding in one place rather than querying per-instance).
    if (this.privacyContent) {
      this.privacyContent.addEventListener('click', (e) => {
        if (e.target.closest('.open-terms-panel-link')) this._openTermsPanel()
      })
    }
    if (this.termsContent) {
      this.termsContent.addEventListener('click', (e) => {
        if (e.target.closest('.open-privacy-panel-link')) this._openPrivacyPanel()
      })
    }
    this.coinshopBtn.addEventListener('click', () => trackAndOpen(() => this._openShopPanel()))
    this.marketBtn?.addEventListener('click', () => trackAndOpen(() => this._openMarketPanel()))
    this._bindHomepageBatch()
    CloudSaveUI.bindCloudSave(this)
    CloudSaveUI.installChangeTracking(this)
    this._startPresenceHeartbeat()
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
    if (this.hubPanel) {
      this.hubPanel.addEventListener('click', (e) => {
        if (e.target === this.hubPanel) this._closeHubPanel()
      })
    }
    if (this.comingSoonPanel) {
      this.comingSoonPanel.addEventListener('click', (e) => {
        if (e.target === this.comingSoonPanel) this._closeComingSoonPanel()
      })
    }
    if (this.friendsPanel) {
      this.friendsPanel.addEventListener('click', (e) => {
        if (e.target === this.friendsPanel) this._closeFriendsPanel()
      })
    }
    if (this.menuInventoryPanel) {
      this.menuInventoryPanel.addEventListener('click', (e) => {
        if (e.target === this.menuInventoryPanel) this._closeMenuInventoryPanel()
      })
    }
    if (this.serverPanel) {
      this.serverPanel.addEventListener('click', (e) => {
        if (e.target === this.serverPanel) this._closeServerPanel()
      })
    }
    this.profilePanel.addEventListener('click', (e) => {
      if (e.target === this.profilePanel) this._closeProfilePanel()
    })
    this.creditsPanel.addEventListener('click', (e) => {
      if (e.target === this.creditsPanel) this._closeCreditsPanel()
    })
    if (this.levelsPanel) {
      this.levelsPanel.addEventListener('click', (e) => {
        if (e.target === this.levelsPanel) this._closeLevelsPanel()
      })
    }
    if (this.termsPanel) {
      this.termsPanel.addEventListener('click', (e) => {
        if (e.target === this.termsPanel) this._closeTermsPanel()
      })
    }
    if (this.privacyPanel) {
      this.privacyPanel.addEventListener('click', (e) => {
        if (e.target === this.privacyPanel) this._closePrivacyPanel()
      })
    }
    if (this.featuresPanel) {
      this.featuresPanel.addEventListener('click', (e) => {
        if (e.target === this.featuresPanel) this._closeFeaturesPanel()
      })
    }
    if (this.skindesignerPanel) {
      this.skindesignerPanel.addEventListener('click', (e) => {
        if (e.target === this.skindesignerPanel) this._closeSkinDesignerPanel()
      })
    }
    this.shopPanel.addEventListener('click', (e) => {
      if (e.target === this.shopPanel) this._closeShopPanel()
    })
    this.marketPanel?.addEventListener('click', (e) => {
      if (e.target === this.marketPanel) this._closeMarketPanel()
    })
    if (this.shopSkinBuyBtn) this.shopSkinBuyBtn.addEventListener('click', () => this._buyShopSkin())
    if (this.otherProfilePanel) {
      this.otherProfilePanel.addEventListener('click', (e) => {
        if (e.target === this.otherProfilePanel) this._closeOtherPlayerProfile()
      })
    }
    if (this.otherProfileId) {
      this.otherProfileId.addEventListener('click', () => {
        if (!this._otherProfileIdText) return
        navigator.clipboard.writeText(this._otherProfileIdText).then(() => this._showCopiedBadge(this.otherProfileId)).catch(() => {})
      })
    }
    // Private note about whichever player the popup is CURRENTLY showing
    // (_otherProfileCurrentPlayerId, set fresh by _renderOtherProfileEntry
    // every time it renders someone) - bound once here rather than
    // re-bound per render, so it always saves against whoever is live in
    // the popup right now, not whoever was showing when this listener was
    // first attached. Local-only (settings.playerNotes), never synced -
    // "only you can see this" per the popup's own hint text.
    if (this.otherProfileNotesInput) {
      this.otherProfileNotesInput.addEventListener('input', () => {
        if (!this._otherProfileCurrentPlayerId) return
        const text = this.otherProfileNotesInput.value.slice(0, 250)
        this.settings.playerNotes[this._otherProfileCurrentPlayerId] = text
        saveSettings(this.settings)
      })
    }
    // Delegated (one listener survives every _renderSavedFriends re-render,
    // rather than needing to rebind per row) - clicking a friend's row
    // opens their public profile, clicking the × still just removes them.
    if (this.cloudsaveSavedFriends) {
      this.cloudsaveSavedFriends.addEventListener('click', (e) => {
        if (e.target.closest('.saved-friend-remove')) return
        const row = e.target.closest('.saved-friend-row')
        if (!row || !row.dataset.uid) return
        this._openOtherPlayerProfile(row.dataset.uid, row.dataset.name)
      })
    }
    if (this.whatsNewPanel) {
      this.whatsNewPanel.addEventListener('click', (e) => {
        if (e.target === this.whatsNewPanel) this._closeWhatsNewPanel()
      })
    }
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
    // FPS Cap - throttles how often _tick's requestAnimationFrame loop
    // actually renders (see the frame-skip check there), not a real
    // browser-level VSync toggle (no such API exists for a web page -
    // the browser always syncs requestAnimationFrame to the display's own
    // refresh rate already). A cap is the closest meaningful equivalent:
    // caps GPU/battery usage same as VSync would for a player who doesn't
    // want or need every frame their monitor can show.
    if (this.fpsCapSelect) {
      this.fpsCapSelect.value = String(this.settings.fpsCap)
      this._fpsCapMinFrameMs = this.settings.fpsCap > 0 ? 1000 / this.settings.fpsCap : 0
      this.fpsCapSelect.addEventListener('change', () => {
        const value = Number(this.fpsCapSelect.value)
        this.settings.fpsCap = value
        this._fpsCapMinFrameMs = value > 0 ? 1000 / value : 0
        saveSettings(this.settings)
      })
    }
    // Auto Quality (see AutoQuality.js) - turning it off snaps straight back
    // to full quality (level 0's levers) rather than freezing wherever it
    // had got to; turning it back on resumes from its current level. The
    // light count is fixed at load, so that part follows on the next reload.
    if (this.autoQualityToggle) {
      this.autoQualityToggle.checked = this.settings.autoQuality
      this.autoQualityToggle.addEventListener('change', () => {
        this.settings.autoQuality = this.autoQualityToggle.checked
        // Off: back to full sharpness in the editor right away.
        if (!this.settings.autoQuality) this._editorResScale = 1
        this._applyRenderScale()
        saveSettings(this.settings)
      })
    }
    if (this.motionBlurToggle) {
      this.motionBlurToggle.checked = this.settings.motionBlur
      this.motionBlurToggle.addEventListener('change', () => {
        this.settings.motionBlur = this.motionBlurToggle.checked
        saveSettings(this.settings)
      })
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
        this.gfxAoValue.textContent = value <= 0 ? 'Off' : `${value}%`
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
    if (this.gfxLiteTexturesToggle) {
      this.gfxLiteTexturesToggle.checked = !!this.settings.liteTextures
      this.gfxLiteTexturesToggle.addEventListener('change', () => {
        this.settings.liteTextures = this.gfxLiteTexturesToggle.checked
        saveSettings(this.settings)
        this._applyLiteTextures()
      })
    }
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

  // General tab (Settings > General) - HUD/Notifications/Account &amp; Data
  // sections. Was an empty "Coming soon" placeholder before this batch.
  _bindGeneralSettings() {
    if (this.killFeedPositionSelect) {
      this.killFeedPositionSelect.value = this.settings.killFeedPosition
      this.killFeedPositionSelect.addEventListener('change', () => {
        this.settings.killFeedPosition = this.killFeedPositionSelect.value
        saveSettings(this.settings)
      })
    }

    if (this.compassStyleSelect) {
      this.compassStyleSelect.value = this.settings.compassStyle
      this.compassStyleSelect.addEventListener('change', () => {
        this.settings.compassStyle = this.compassStyleSelect.value
        saveSettings(this.settings)
      })
    }

    // Kill Feed icon/verbosity (batch feature)
    if (this.killFeedVerbositySelect) {
      this.killFeedVerbositySelect.value = this.settings.killFeedVerbosity
      this.killFeedVerbositySelect.addEventListener('change', () => {
        this.settings.killFeedVerbosity = this.killFeedVerbositySelect.value
        saveSettings(this.settings)
      })
    }
    if (this.killFeedIconsToggle) {
      this.killFeedIconsToggle.checked = this.settings.killFeedIcons
      this.killFeedIconsToggle.addEventListener('change', () => {
        this.settings.killFeedIcons = this.killFeedIconsToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.weaponNameHudToggle) {
      this.weaponNameHudToggle.checked = this.settings.showWeaponNameHud
      this.weaponNameHudToggle.addEventListener('change', () => {
        this.settings.showWeaponNameHud = this.weaponNameHudToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.minimapZoomSelect) {
      this.minimapZoomSelect.value = String(this.settings.minimapDefaultZoom)
      this.minimapZoomSelect.addEventListener('change', () => {
        this.settings.minimapDefaultZoom = Number(this.minimapZoomSelect.value)
        saveSettings(this.settings)
      })
    }

    if (this.friendPresenceNotifyToggle) {
      this.friendPresenceNotifyToggle.checked = this.settings.friendPresenceNotify
      this.friendPresenceNotifyToggle.addEventListener('change', () => {
        this.settings.friendPresenceNotify = this.friendPresenceNotifyToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.dailyChallengeReminderToggle) {
      this.dailyChallengeReminderToggle.checked = this.settings.dailyChallengeReminder
      this.dailyChallengeReminderToggle.addEventListener('change', () => {
        this.settings.dailyChallengeReminder = this.dailyChallengeReminderToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.timeFormatSelect) {
      this.timeFormatSelect.value = this.settings.timeFormat
      this.timeFormatSelect.addEventListener('change', () => {
        this.settings.timeFormat = this.timeFormatSelect.value
        saveSettings(this.settings)
        this._updateHomepageClock()
      })
    }
    if (this.homepageClockEl) {
      this._updateHomepageClock()
      setInterval(() => this._updateHomepageClock(), 1000)
    }

    if (this.autosaveFrequencySlider) {
      this.autosaveFrequencySlider.value = this.settings.autoSaveFrequencySec
      this.autosaveFrequencyValue.textContent = `${this.settings.autoSaveFrequencySec}s`
      this._restartAutoSaveTimer()
      this.autosaveFrequencySlider.addEventListener('input', () => {
        const value = Number(this.autosaveFrequencySlider.value)
        this.autosaveFrequencyValue.textContent = `${value}s`
        this.settings.autoSaveFrequencySec = value
        saveSettings(this.settings)
        this._restartAutoSaveTimer()
      })
    }

    // Once-per-session reminder, not once-per-homepage-visit - checking
    // loadDailyBest()'s own date field (already the source of truth for
    // "have I posted a daily score today") rather than tracking a second
    // parallel "have I seen the reminder" flag.
    if (this.settings.dailyChallengeReminder && this.dailyBest.date !== _todayDateStr()) {
      this._showHomepageToast(t('dailyChallengeReminderToast'))
    }
    if (this.settings.weeklyChallengeReminder && this.weeklyChallenge.week !== _thisWeekStr()) {
      this._showHomepageToast(t('weeklyChallengeReminderToast'))
    }

    if (this.hudFpsToggle) {
      this.hudFpsToggle.checked = this.settings.hudFpsCounter
      this.hudFpsToggle.addEventListener('change', () => {
        this.settings.hudFpsCounter = this.hudFpsToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.ammoPositionSelect) {
      this.ammoPositionSelect.value = this.settings.ammoPosition
      this.ammoPositionSelect.addEventListener('change', () => {
        this.settings.ammoPosition = this.ammoPositionSelect.value
        saveSettings(this.settings)
      })
    }

    if (this.healthDisplayStyleSelect) {
      this.healthDisplayStyleSelect.value = this.settings.healthDisplayStyle
      this.healthDisplayStyleSelect.addEventListener('change', () => {
        this.settings.healthDisplayStyle = this.healthDisplayStyleSelect.value
        saveSettings(this.settings)
      })
    }

    if (this.lowAmmoFlashToggle) {
      this.lowAmmoFlashToggle.checked = this.settings.lowAmmoFlash
      this.lowAmmoFlashToggle.addEventListener('change', () => {
        this.settings.lowAmmoFlash = this.lowAmmoFlashToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.sessionTimerToggle) {
      this.sessionTimerToggle.checked = this.settings.sessionTimerHud
      this.sessionTimerToggle.addEventListener('change', () => {
        this.settings.sessionTimerHud = this.sessionTimerToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.difficultyLabelToggle) {
      this.difficultyLabelToggle.checked = this.settings.difficultyLabelHud
      this.difficultyLabelToggle.addEventListener('change', () => {
        this.settings.difficultyLabelHud = this.difficultyLabelToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.objectiveDistanceToggle) {
      this.objectiveDistanceToggle.checked = this.settings.objectiveDistanceHud
      this.objectiveDistanceToggle.addEventListener('change', () => {
        this.settings.objectiveDistanceHud = this.objectiveDistanceToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.achievementToastToggle) {
      this.achievementToastToggle.checked = this.settings.achievementToasts
      this.achievementToastToggle.addEventListener('change', () => {
        this.settings.achievementToasts = this.achievementToastToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.rankUpToastToggle) {
      this.rankUpToastToggle.checked = this.settings.rankUpToasts
      this.rankUpToastToggle.addEventListener('change', () => {
        this.settings.rankUpToasts = this.rankUpToastToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.leaderboardRankToggle) {
      this.leaderboardRankToggle.checked = this.settings.leaderboardRankAlerts
      this.leaderboardRankToggle.addEventListener('change', () => {
        this.settings.leaderboardRankAlerts = this.leaderboardRankToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.weeklyReminderToggle) {
      this.weeklyReminderToggle.checked = this.settings.weeklyChallengeReminder
      this.weeklyReminderToggle.addEventListener('change', () => {
        this.settings.weeklyChallengeReminder = this.weeklyReminderToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.lowCurrencyToggle) {
      this.lowCurrencyToggle.checked = this.settings.lowCurrencyReminder
      this.lowCurrencyToggle.addEventListener('change', () => {
        this.settings.lowCurrencyReminder = this.lowCurrencyToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.backupReminderToggle) {
      this.backupReminderToggle.checked = this.settings.backupReminder
      this.backupReminderToggle.addEventListener('change', () => {
        this.settings.backupReminder = this.backupReminderToggle.checked
        saveSettings(this.settings)
      })
      // Nudges at most once a week - lastExportAt is set by _exportSave().
      const DAYS_MS = 7 * 24 * 60 * 60 * 1000
      if (this.settings.backupReminder && Date.now() - (this.settings.lastExportAt || 0) > DAYS_MS) {
        this._showHomepageToast(t('backupReminderToast'))
      }
    }

    if (this.saveSizeValueEl) {
      let totalChars = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        totalChars += key.length + (localStorage.getItem(key) || '').length
      }
      this.saveSizeValueEl.textContent = totalChars > 1024 ? `${(totalChars / 1024).toFixed(1)} KB` : `${totalChars} B`
    }

    if (this.clearCacheBtn) {
      this.clearCacheBtn.addEventListener('click', () => {
        if (!window.confirm(t('clearCacheConfirm'))) return
        // Only genuinely disposable caches - never the save itself
        // (settings/careerStats/achievements/etc, none of which are
        // prefixed 'gayz-cache-') and never keybinds.
        const keys = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('gayz-cache-')) keys.push(key)
        }
        for (const key of keys) localStorage.removeItem(key)
        this._showHomepageToast(t('clearCacheDoneToast', { n: keys.length }))
      })
    }

    if (this.confirmSignoutToggle) {
      this.confirmSignoutToggle.checked = this.settings.confirmSignOut
      this.confirmSignoutToggle.addEventListener('change', () => {
        this.settings.confirmSignOut = this.confirmSignoutToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.staySignedinToggle) {
      this.staySignedinToggle.checked = this.settings.stayEmbedSignedIn
      this.staySignedinToggle.addEventListener('change', () => {
        this.settings.stayEmbedSignedIn = this.staySignedinToggle.checked
        saveSettings(this.settings)
        CloudSync.setAuthPersistence(this.settings.stayEmbedSignedIn).catch(() => {})
      })
    }

    if (this.anonymousLeaderboardToggle) {
      this.anonymousLeaderboardToggle.checked = this.settings.anonymousLeaderboard
      this.anonymousLeaderboardToggle.addEventListener('change', () => {
        this.settings.anonymousLeaderboard = this.anonymousLeaderboardToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.shareTelemetryToggle) {
      this.shareTelemetryToggle.checked = this.settings.shareTelemetry
      this.shareTelemetryToggle.addEventListener('change', () => {
        this.settings.shareTelemetry = this.shareTelemetryToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.autoDeclineToggle) {
      this.autoDeclineToggle.checked = this.settings.autoDeclineFriendRequests
      this.autoDeclineToggle.addEventListener('change', () => {
        this.settings.autoDeclineFriendRequests = this.autoDeclineToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.exactLastseenToggle) {
      this.exactLastseenToggle.checked = this.settings.exactLastSeen
      this.exactLastseenToggle.addEventListener('change', () => {
        this.settings.exactLastSeen = this.exactLastseenToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.rememberSettingsTabToggle) {
      this.rememberSettingsTabToggle.checked = this.settings.rememberSettingsTab
      this.rememberSettingsTabToggle.addEventListener('change', () => {
        this.settings.rememberSettingsTab = this.rememberSettingsTabToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.confirmRemoveFriendToggle) {
      this.confirmRemoveFriendToggle.checked = this.settings.confirmRemoveFriend
      this.confirmRemoveFriendToggle.addEventListener('change', () => {
        this.settings.confirmRemoveFriend = this.confirmRemoveFriendToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.reduceBgEffectsToggle) {
      this.reduceBgEffectsToggle.checked = this.settings.reduceBgEffects
      document.body.classList.toggle('reduce-bg-effects', this.settings.reduceBgEffects)
      this.reduceBgEffectsToggle.addEventListener('change', () => {
        this.settings.reduceBgEffects = this.reduceBgEffectsToggle.checked
        document.body.classList.toggle('reduce-bg-effects', this.settings.reduceBgEffects)
        saveSettings(this.settings)
      })
    }

    if (this.homepageGreetingInput) {
      this.homepageGreetingInput.value = this.settings.homepageGreeting
      this._updateHomepageGreeting()
      this.homepageGreetingInput.addEventListener('input', () => {
        this.settings.homepageGreeting = this.homepageGreetingInput.value.slice(0, 40)
        this._updateHomepageGreeting()
        saveSettings(this.settings)
      })
    }

    if (this.autoReloadToggle) {
      this.autoReloadToggle.checked = this.settings.autoReloadOnEmpty
      this.autoReloadToggle.addEventListener('change', () => {
        this.settings.autoReloadOnEmpty = this.autoReloadToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.autoLootToggle) {
      this.autoLootToggle.checked = this.settings.autoLoot
      this.autoLootToggle.addEventListener('change', () => {
        this.settings.autoLoot = this.autoLootToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.autoLootRadiusSelect) {
      this.autoLootRadiusSelect.value = this.settings.autoLootRadius
      this.autoLootRadiusSelect.addEventListener('change', () => {
        this.settings.autoLootRadius = this.autoLootRadiusSelect.value
        saveSettings(this.settings)
      })
    }

    if (this.instantInteractToggle) {
      this.instantInteractToggle.checked = this.settings.instantStationInteract
      this.instantInteractToggle.addEventListener('change', () => {
        this.settings.instantStationInteract = this.instantInteractToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.damageFlashColorInput) {
      this.damageFlashColorInput.value = this.settings.damageFlashColor
      this.damageFlashColorInput.addEventListener('input', () => {
        this.settings.damageFlashColor = this.damageFlashColorInput.value
        saveSettings(this.settings)
      })
    }

    if (this.oneHandedToggle) {
      this.oneHandedToggle.checked = this.settings.oneHandedLayout
      this.oneHandedToggle.addEventListener('change', () => {
        this.settings.oneHandedLayout = this.oneHandedToggle.checked
        saveSettings(this.settings)
      })
    }
    // One-Handed Key Layout - rather than remapping keyboard keys (the
    // right half of a full keyboard has more bound actions than the left
    // half has free keys to receive them, so a genuine full remap doesn't
    // fit), extra mouse buttons (4/5 - Back/Forward on most mice) trigger
    // Interact/Reload while enabled, reusing the real bound key via a
    // synthetic keydown/keyup pair rather than duplicating each action's
    // own handler logic. The same hand already on the mouse can reach
    // these without ever touching the keyboard.
    window.addEventListener('mousedown', (e) => {
      if (!this.settings.oneHandedLayout || !this.gameStarted) return
      const action = e.button === 3 ? 'interact' : e.button === 4 ? 'reload' : null
      if (!action) return
      e.preventDefault()
      window.dispatchEvent(new KeyboardEvent('keydown', { code: getKeyFor(action) }))
    })
    window.addEventListener('mouseup', (e) => {
      if (!this.settings.oneHandedLayout || !this.gameStarted) return
      const action = e.button === 3 ? 'interact' : e.button === 4 ? 'reload' : null
      if (!action) return
      window.dispatchEvent(new KeyboardEvent('keyup', { code: getKeyFor(action) }))
    })

    // Fullscreen button - a real button instead of expecting players to
    // know the F11 shortcut. Label/state driven off the actual
    // document.fullscreenElement, not a settings flag - fullscreen can also
    // be exited via Esc or F11 outside this button, and there's no reliable
    // way to auto-re-enter it on page load anyway (Fullscreen API requires
    // a real user gesture), so this deliberately isn't a persisted setting.
    if (this.fullscreenBtn) {
      const updateFullscreenBtnLabel = () => {
        this.fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Enter Fullscreen'
      }
      updateFullscreenBtnLabel()
      document.addEventListener('fullscreenchange', updateFullscreenBtnLabel)
      this.fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {})
        } else {
          // Rejects (rather than throwing) if fullscreen isn't allowed here
          // - e.g. embedded in an iframe without the allowfullscreen
          // attribute - nothing useful to do about that from inside the
          // page, so just swallow it rather than showing a broken toast.
          document.documentElement.requestFullscreen().catch(() => {})
        }
      })
    }

    // Fullscreen visibly enlarges the homepage - no browser chrome left to
    // subtract from the viewport, and it's often a genuinely wider screen
    // than whatever window the player was just looking at. #menu-layout's
    // width/max-width (see that rule's own comment) is meant to just avoid
    // forcing horizontal overflow on a narrow screen, not to actively grow
    // things on a wide one, so this wasn't intentional. Rather than
    // guessing one fixed "not too big" cap, zoom #menu back down on
    // entering fullscreen so it renders at the exact same size it was
    // just before - same viewport-independent-size intent as
    // html.large-text-mode's fixed zoom elsewhere, just computed live here
    // instead of a constant. Triggers on fullscreenchange (not the
    // button's own click handler above) so it applies the same way
    // whether fullscreen was entered via that button, F11, or the
    // browser's own menu/shortcut.
    //
    // Measures #menu-layout's own rendered WIDTH, not window.innerWidth -
    // a straight viewport-width ratio undershoots badly, because
    // #menu-layout/#menu-title-img/#play-btn each have their own
    // min()/percentage caps that kick in at different breakpoints (e.g.
    // the logo is already pinned to its 850px ceiling well before 1600px
    // wide, but nowhere near it at 900px) - the relationship between
    // viewport width and any given element's rendered width isn't linear,
    // so only measuring the actual element before/after gives the right
    // factor.
    let _lastMenuLayoutWidth = null
    const _trackMenuLayoutWidth = () => {
      if (!document.fullscreenElement && this.menuLayout) {
        _lastMenuLayoutWidth = this.menuLayout.getBoundingClientRect().width
      }
    }
    this.menuLayout = document.getElementById('menu-layout')
    _trackMenuLayoutWidth()
    window.addEventListener('resize', _trackMenuLayoutWidth)
    document.addEventListener('fullscreenchange', () => {
      if (!this.menu || !this.menuLayout) return
      if (document.fullscreenElement) {
        // Clear any stale zoom first so the next frame's measurement is
        // the natural (unzoomed) fullscreen size, then compute the ratio
        // against it.
        this.menu.style.zoom = ''
        requestAnimationFrame(() => {
          const naturalWidth = this.menuLayout.getBoundingClientRect().width
          if (_lastMenuLayoutWidth && naturalWidth) {
            this.menu.style.zoom = Math.min(1, _lastMenuLayoutWidth / naturalWidth)
          }
        })
      } else {
        this.menu.style.zoom = ''
      }
    })

    if (this.sortWeaponsToggle) {
      this.sortWeaponsToggle.checked = this.settings.sortWeaponsAlpha
      this.sortWeaponsToggle.addEventListener('change', () => {
        this.settings.sortWeaponsAlpha = this.sortWeaponsToggle.checked
        saveSettings(this.settings)
      })
    }

    if (this.whatsNewEveryLaunchToggle) {
      this.whatsNewEveryLaunchToggle.checked = this.settings.whatsNewEveryLaunch
      this.whatsNewEveryLaunchToggle.addEventListener('change', () => {
        this.settings.whatsNewEveryLaunch = this.whatsNewEveryLaunchToggle.checked
        saveSettings(this.settings)
      })
    }

  }


  // Homepage Greeting (General tab) - shown right under the player tag,
  // purely decorative custom text, empty by default so nothing new shows
  // for anyone who never sets one.
  _updateHomepageGreeting() {
    if (!this.homepageGreetingEl) return
    this.homepageGreetingEl.textContent = this.settings.homepageGreeting
    this.homepageGreetingEl.style.display = this.settings.homepageGreeting ? '' : 'none'
  }

  // Auto-Save Frequency (General tab, settings.autoSaveFrequencySec) -
  // this game already saves immediately after every meaningful change
  // (settings tweaks, run-end stats, etc.), so this is a defensive
  // "just in case" periodic re-flush of the same snapshot rather than
  // something that newly becomes possible - re-persists current
  // settings on an interval so a crash/force-quit between explicit saves
  // loses less. Cleared and restarted (not just left running) whenever
  // the frequency itself changes, so a shorter interval takes effect
  // immediately instead of waiting out the old one first.
  _restartAutoSaveTimer() {
    if (this._autoSaveTimer) clearInterval(this._autoSaveTimer)
    this._autoSaveTimer = setInterval(() => saveSettings(this.settings), this.settings.autoSaveFrequencySec * 1000)
  }

  // Homepage clock (General tab, settings.timeFormat) - the only place
  // in the game that shows an absolute (not relative/countdown) local
  // time, so it's the one thing the 12h/24h setting actually controls.
  _updateHomepageClock() {
    const now = new Date()
    if (this.settings.timeFormat === '24h') {
      this.homepageClockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    } else {
      const h24 = now.getHours()
      const h12 = h24 % 12 || 12
      this.homepageClockEl.textContent = `${h12}:${String(now.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
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
    const graphicsKeys = ['renderResolution', 'brightness', 'contrast', 'aoIntensity', 'shadowsEnabled', 'shadowQuality', 'liteTextures', 'bulletHolesEnabled', 'bloodEffectsEnabled', 'damageIndicatorEnabled', 'damageNumbersEnabled', 'damageNumbersScale', 'grainIntensity', 'panelFlickerEnabled']
    for (const key of graphicsKeys) this.settings[key] = defaults[key]
    saveSettings(this.settings)
    window.location.reload()
  }

  _applyGraphicsFilters() {
    if (!this.canvas) return
    // No filter at all at the defaults - even an identity CSS filter
    // (brightness(100%) contrast(100%)) makes the browser run the whole
    // canvas through an extra filter pass every frame (2026-09-30).
    const neutral = Number(this.settings.brightness) === 100 && Number(this.settings.contrast) === 100
    this.canvas.style.filter = neutral ? 'none' : `brightness(${this.settings.brightness}%) contrast(${this.settings.contrast}%)`
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
    const sun = this.buildMode?.sunLight
    if (sun && sun.shadow) {
      sun.shadow.mapSize.set(size, size)
      // mapSize only takes effect once the shadow map's own render target
      // is (re)built - forcing that via needsUpdate.
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
      sun.shadow.needsUpdate = true
      this.buildMode._shadowsDirty = true
    }
  }

  // Homepage Nav Order (Controls tab) - up/down reordering of an id list,
  // applied purely via CSS `order` on the real buttons (#menu-nav-buttons
  // is already flex-column, see style.css) rather than touching the DOM
  // structure, so every button's own click listener/id/state is untouched.
  _renderNavOrderList() {
    if (!this.navOrderList) return
    const labels = { 'hub-btn': t('navOrderHub'), 'coinshop-btn': t('navOrderShop'), 'upgrades-btn': t('navOrderUpgrades'), 'server-btn': t('navOrderServer'), 'quests-btn': t('navOrderQuests'), 'friends-btn': t('navOrderFriends'), 'menu-inventory-btn': t('navOrderInventory'), 'achievements-btn': t('navOrderAchievements') }
    this.navOrderList.innerHTML = this.settings.navOrder.map((id, i) => `
      <div class="nav-order-row" data-id="${id}">
        <span>${labels[id] || id}</span>
        <div class="nav-order-btns">
          <button class="mini-action-btn nav-order-up" type="button" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="mini-action-btn nav-order-down" type="button" ${i === this.settings.navOrder.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
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
    // Even slots for the 8 reorderable buttons, so Market (not reorderable)
    // can always take the odd slot right after Store.
    this.settings.navOrder.forEach((id, i) => {
      const btn = document.getElementById(id)
      if (btn) btn.style.order = i * 2
    })
    const market = document.getElementById('market-btn')
    if (market) market.style.order = this.settings.navOrder.indexOf('coinshop-btn') * 2 + 1
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
      this._applyLanguage() // text shows keys via {key:...} - refresh it
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
        for (const key of ['masterVolume', 'sfxVolume', 'ambientVolume']) this.settings[key] = defaults[key]
        saveSettings(this.settings)
        window.location.reload()
      })
    }
    if (this.resetControlsDefaultsBtn) {
      this.resetControlsDefaultsBtn.addEventListener('click', () => {
        const defaults = defaultSettings()
        const keys = ['sensitivity', 'invertY', 'fov', 'adsFov', 'hudScale', 'hudOpacity', 'colorblindMode', 'recoilShakeIntensity', 'damageShakeIntensity', 'reduceFlashing',
          'toggleSprint', 'toggleCrouch', 'toggleAds', 'aimAssist', 'bigInteractPrompt', 'toastDuration', 'crosshairColor', 'crosshairSize',
          'largeTextMode', 'highContrastMode', 'dyslexiaFont', 'bgMood', 'keybindCheatSheet', 'showHitFeedback', 'performanceMode',
          'streamSafeMode', 'focusRingMode', 'homepageFpsCounter', 'underlineLinks', 'nicknameFont', 'layoutDensity',
          'mouseAcceleration', 'invertScrollWeaponSwitch', 'doubleClickSpeed', 'gamepadDeadzone', 'gamepadVibration', 'killFeedPosition', 'killFeedIcons', 'killFeedVerbosity', 'compassStyle', 'showWeaponNameHud', 'minimapDefaultZoom']
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
    // playerId carried over explicitly - unlike nickname (which
    // legitimately goes back to blank here, an existing precedent),
    // wiping the account's corner-badge ID on a settings reset would be
    // a surprising identity change, not just a preference reset.
    saveSettings({ ...defaultSettings(), playerId: this.settings.playerId })
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
    this.settings.lastExportAt = Date.now()
    saveSettings(this.settings)
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
    this._applyLanguage() // text shows keys via {key:...} - refresh it
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
  // Real bug found 2026-09-26 while investigating a report of stats being
  // wrong right after a cloud restore: this function's own reload triggers
  // the beforeunload event below, and that handler unconditionally saves
  // shopProgress/careerStats from THIS PAGE'S in-memory (pre-restore)
  // values - silently overwriting the data/coins just written a moment
  // earlier, before the reload actually takes effect. The periodic
  // settings autosave timer is the same hazard on a longer fuse. Both are
  // real writes to localStorage that race the reload, not just something
  // that looks wrong and self-corrects - reproduced directly (not just
  // theorized) by calling this with mock cloud data and checking what
  // localStorage actually held after the reload: the restored coins value
  // was gone, replaced by the old pre-restore one. _importingSave is
  // checked by both beforeunload handlers below to skip their save while
  // this is in flight, and the timer is stopped outright since there's no
  // reason for it to fire again before the reload completes anyway.
  _applyImportedSaveData(data) {
    this._importingSave = true
    if (this._autoSaveTimer) clearInterval(this._autoSaveTimer)
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
    if (this.sendFriendRequestBtn) this.sendFriendRequestBtn.textContent = t('sendFriendRequestBtn')
    if (this.cloudsaveFriendInput) this.cloudsaveFriendInput.placeholder = t('cloudsaveFriendPlaceholder')
    if (this.cloudsaveLeaderboardTitle) this.cloudsaveLeaderboardTitle.textContent = t('cloudsaveLeaderboardTitle')
    if (this.cloudsaveAchievementsLeaderboardTitle) this.cloudsaveAchievementsLeaderboardTitle.textContent = t('cloudsaveAchievementsLeaderboardTitle')
    if (this.cloudsaveFriendTitle) this.cloudsaveFriendTitle.textContent = t('cloudsaveFriendTitle')
    if (this.addFriendHeading) this.addFriendHeading.textContent = t('addFriendHeading')
    if (this.cloudsaveRegionSelect) this.cloudsaveRegionSelect.value = this.settings.region
  }

  // Global rank badge - also mirrored onto the homepage player tag (see
  // _updateBestStatsDisplay) once fetched, so signing in and opening this
  // panel is what refreshes that homepage line rather than a live
  // subscription (a rank that's a few minutes stale is fine for this).
  async _renderMyRank() {
    if (!this.cloudsaveRankLine) return
    try {
      const newRank = await CloudSync.fetchMyGlobalRank(_safeStatNumber(this.bestStats.bestNight))
      // Leaderboard Rank Change Alerts (General tab) - only a real
      // improvement (lower rank number), not the first fetch this
      // session, and not a worsening (someone else beating your old
      // score isn't something to nag about here).
      if (this.settings.leaderboardRankAlerts && this._cloudGlobalRank !== undefined && newRank < this._cloudGlobalRank) {
        this._showHomepageToast(t('leaderboardRankUpToast', { rank: newRank }))
      }
      this._cloudGlobalRank = newRank
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

  // "Your Friends" list - now populated only by accepting an incoming
  // friend request (see _respondToFriendRequest), not by manually typing a
  // name any more (that was the removed Save/Compare flow). Each row shows
  // a live presence status (see _fetchFriendPresences/_computeFriendStatus)
  // fetched right after the list itself renders, since the status read is
  // its own async Firestore call per friend, not part of settings.
  _renderSavedFriends() {
    if (!this.cloudsaveSavedFriends) return
    const friends = this.settings.savedFriends
    this.cloudsaveSavedFriends.innerHTML = friends.map((f) => `
      <div class="saved-friend-row" data-uid="${_escapeHtml(f.uid || '')}" data-name="${_escapeHtml(f.name)}" title="Click to view profile">
        <span class="friend-status-dot" data-status="offline"></span>
        <span class="friend-name">${_escapeHtml(f.name)}</span>
        <span class="friend-status-label">${t('friendStatusOffline')}</span>
        <span class="saved-friend-remove" data-remove="${_escapeHtml(f.name)}">×</span>
      </div>
    `).join('')
    for (const btn of this.cloudsaveSavedFriends.querySelectorAll('.saved-friend-remove')) {
      btn.addEventListener('click', () => {
        if (this.settings.confirmRemoveFriend && !window.confirm(t('confirmRemoveFriendMessage', { name: btn.dataset.remove }))) return
        this.settings.savedFriends = this.settings.savedFriends.filter((f) => f.name !== btn.dataset.remove)
        saveSettings(this.settings)
        this._renderSavedFriends()
      })
    }
    this._fetchFriendPresences(friends)
  }

  // Viewing another player's live profile - a small public read-only panel
  // (name/id/best stats, all already-public leaderboard fields, see
  // CloudSync.fetchLeaderboardEntryByUid) opened by clicking a row in
  // "Your Friends". Distinct from the existing static ?viewprofile= share
  // link (a snapshot someone posts elsewhere) - this always reflects their
  // CURRENT live stats since it fetches fresh on every open.
  async _openOtherPlayerProfile(uid, fallbackName) {
    if (!this.otherProfilePanel) return
    this._showOtherProfileLoading(fallbackName)
    let entry = null
    try {
      entry = await CloudSync.fetchLeaderboardEntryByUid(uid)
    } catch {
      // Best-effort - falls through to the "hasn't completed a run yet"
      // state below, same as a genuine null result.
    }
    // The panel may have been closed (or reopened for someone else) while
    // this fetch was in flight - don't clobber whatever's showing now.
    if (this.otherProfilePanel.style.display === 'none') return
    this._renderOtherProfileEntry(entry, fallbackName)
  }

  // Same panel, reached by pasting a Player ID into chat instead of
  // clicking a Friends row (see ChatUI.bindChatContextActions/ChatUI.bindServerChat's
  // .chat-message-id-link handler) - looked up by playerId
  // (fetchLeaderboardEntryByPlayerId) rather than uid, everything else
  // about opening/rendering the panel is identical.
  async _openOtherPlayerProfileById(playerId, fallbackName) {
    if (!this.otherProfilePanel) return
    this._showOtherProfileLoading(fallbackName)
    const entry = await CloudSync.fetchLeaderboardEntryByPlayerId(playerId).catch(() => null)
    if (this.otherProfilePanel.style.display === 'none') return
    this._renderOtherProfileEntry(entry, fallbackName)
  }

  _showOtherProfileLoading(fallbackName) {
    this.otherProfilePanel.style.display = 'flex'
    this.otherProfileName.textContent = fallbackName || '???'
    this._otherProfileIdText = null
    this._otherProfileCurrentPlayerId = null
    this.otherProfileId.textContent = ''
    this.otherProfileStats.style.display = 'none'
    this.otherProfileNone.style.display = 'none'
    this.otherProfileLoading.style.display = 'block'
    // Bio/Motto/Notes column - hidden during loading/no-data states (see
    // _renderOtherProfileEntry's own !entry branch), only shown once
    // there's an actual entry+playerId to attach a Notes key to.
    if (this.otherProfileBioMotto) this.otherProfileBioMotto.style.display = 'none'
  }

  // Same field set as the Profile panel's own "Shown to Public" tab (see
  // _renderPublicProfileSection) minus Clan - a leaderboard entry only
  // carries the other player's clanId, not a resolvable tag/name, and
  // showing a raw id wouldn't mean anything to whoever's looking.
  _renderOtherProfileEntry(entry, fallbackName) {
    this.otherProfileLoading.style.display = 'none'
    if (!entry) {
      this.otherProfileNone.style.display = 'block'
      return
    }
    this.otherProfileName.textContent = entry.name || fallbackName || '???'
    // Notes needs a stable key to save under - no playerId, no Notes
    // section (matches _showOtherProfileLoading's own default-hidden
    // state, just never un-hidden in this rare case).
    this._otherProfileCurrentPlayerId = entry.playerId || null
    if (entry.playerId) {
      this._otherProfileIdText = `#${entry.playerId}`
      this.otherProfileId.textContent = this._otherProfileIdText
    }
    this.otherProfileBestNightValue.textContent = _safeStatNumber(entry.bestNight)
    this.otherProfileBestKillsValue.textContent = _safeStatNumber(entry.bestKills)
    this.otherProfileBestStreakValue.textContent = _safeStatNumber(entry.bestKillStreak)
    this.otherProfileAchievementsValue.textContent = _safeStatNumber(entry.achievementCount)
    // Same enum keys the region <select> and _renderPublicProfileSection
    // already use - no new i18n keys needed.
    const REGION_LABEL_KEYS = { na: 'optRegionNa', eu: 'optRegionEu', asia: 'optRegionAsia', sa: 'optRegionSa', oceania: 'optRegionOceania', africa: 'optRegionAfrica' }
    const regionKey = REGION_LABEL_KEYS[entry.region]
    if (this.otherProfileRegionRow) this.otherProfileRegionRow.style.display = regionKey ? 'flex' : 'none'
    if (regionKey && this.otherProfileRegionValue) this.otherProfileRegionValue.textContent = t(regionKey)
    this._renderOtherProfilePublicFields(entry)
    this.otherProfileStats.style.display = 'block'
  }

  // The read side of moving Bio/Motto/Your Stats to Shown to Public (see
  // _pushOnlineStats' own comment on the write side) - every field here
  // is raw/structured (never pre-rendered text) coming off the fetched
  // leaderboard entry, formatted/translated through the VIEWER's own t(),
  // same as _updateBestStatsDisplay does for the profile owner's own
  // view. Every field is optional (an old doc synced before this shipped
  // won't have any of them) - each row/line hides itself rather than
  // showing a misleading "0"/"--" when its source field is just absent.
  _renderOtherProfilePublicFields(entry) {
    if (this.otherProfileTotalKillsValue) {
      const kd = (_safeStatNumber(entry.totalKills) / Math.max(1, _safeStatNumber(entry.totalDeaths))).toFixed(1)
      this.otherProfileTotalKillsValue.textContent = `${_safeStatNumber(entry.totalKills)} (K/D ${kd})`
    }
    if (this.otherProfileRunsPlayedValue) {
      const hours = (_safeStatNumber(entry.lifetimePlaytimeSeconds) / 3600).toFixed(1)
      this.otherProfileRunsPlayedValue.textContent = `${_safeStatNumber(entry.totalRuns)} · ${hours}h played`
    }
    if (this.otherProfileFavoriteClassValue) {
      this.otherProfileFavoriteClassValue.textContent = entry.favoriteClass ? t(LOADOUT_LABEL_KEYS[entry.favoriteClass] || entry.favoriteClass) : '--'
    }
    if (this.otherProfileLongestSurvivalValue) {
      this.otherProfileLongestSurvivalValue.textContent = entry.longestSurvivalMs ? formatTime(_safeStatNumber(entry.longestSurvivalMs)) : '--'
    }
    if (this.otherProfileLastRunValue) {
      this.otherProfileLastRunValue.textContent = ('lastRunNight' in entry)
        ? t(entry.lastRunSurvived ? 'runHistorySurvived' : 'runHistoryDied', { night: _safeStatNumber(entry.lastRunNight), kills: _safeStatNumber(entry.lastRunKills), coins: _safeStatNumber(entry.lastRunCoins) })
        : '--'
    }
    if (this.otherProfileAnniversaryLine) {
      if (entry.firstPlayedDate) {
        const days = Math.max(0, Math.round((new Date(todayDateString()) - new Date(entry.firstPlayedDate)) / 86400000))
        this.otherProfileAnniversaryLine.textContent = t('otherProfileAnniversaryLine', { n: days })
        this.otherProfileAnniversaryLine.style.display = ''
      } else {
        this.otherProfileAnniversaryLine.style.display = 'none'
      }
    }
    if (this.otherProfileTodayLine) {
      if ('todayKills' in entry) {
        this.otherProfileTodayLine.textContent = t('todayLine', { kills: _safeStatNumber(entry.todayKills), minutes: _safeStatNumber(entry.todayMinutes) })
        this.otherProfileTodayLine.style.display = ''
      } else {
        this.otherProfileTodayLine.style.display = 'none'
      }
    }
    if (this.otherProfileFavoriteDifficultyLine) {
      if (entry.favoriteDifficulty) {
        const btn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === entry.favoriteDifficulty)
        this.otherProfileFavoriteDifficultyLine.textContent = t('favoriteDifficultyLine', { difficulty: btn ? btn.textContent : entry.favoriteDifficulty })
        this.otherProfileFavoriteDifficultyLine.style.display = ''
      } else {
        this.otherProfileFavoriteDifficultyLine.style.display = 'none'
      }
    }
    if (this.otherProfileBestRunCard) {
      if ('bestRunNight' in entry) {
        if (this.otherProfileBestRunTitle) this.otherProfileBestRunTitle.textContent = t('profileBestRunTitle')
        const diffBtn = Array.from(this.difficultyBtns).find((b) => b.dataset.difficulty === entry.bestRunDifficulty)
        this.otherProfileBestRunLine.textContent = t('profileBestRunLine', {
          night: _safeStatNumber(entry.bestRunNight),
          kills: _safeStatNumber(entry.bestRunKills),
          coins: _safeStatNumber(entry.bestRunCoins),
          difficulty: diffBtn ? diffBtn.textContent : (entry.bestRunDifficulty || '?'),
          loadout: entry.bestRunLoadout ? t(LOADOUT_LABEL_KEYS[entry.bestRunLoadout] || entry.bestRunLoadout) : '?',
        })
        this.otherProfileBestRunCard.style.display = ''
      } else {
        this.otherProfileBestRunCard.style.display = 'none'
      }
    }
    if (this.otherProfileCreatedLine) {
      if (entry.accountCreatedAt) {
        const elapsedMs = Math.max(0, Date.now() - _safeStatNumber(entry.accountCreatedAt))
        const totalSeconds = Math.floor(elapsedMs / 1000)
        const days = Math.floor(totalSeconds / 86400)
        const hours = Math.floor((totalSeconds % 86400) / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60
        this.otherProfileCreatedLine.textContent = t('profileCreatedLine', { days, hours, minutes, seconds })
        this.otherProfileCreatedLine.style.display = ''
      } else {
        this.otherProfileCreatedLine.style.display = 'none'
      }
    }
    if (this.otherProfileBioMotto) {
      // .trim() before checking .length - a whitespace-only bio (e.g. a
      // single stray space) used to count as "has a bio" and render as an
      // empty-looking box (real report, 2026-09-22 - same class of bug as
      // the untrimmed-nickname fix from the same day).
      const bioTrimmed = typeof entry.bio === 'string' ? entry.bio.trim() : ''
      const hasBio = bioTrimmed.length > 0
      // Bio always shows now (real text, or a "this user has no bio"
      // fallback) instead of hiding the whole Bio/Motto/Notes column
      // whenever neither was set - Notes below needs to be reachable
      // even for a player with nothing else here, and an always-present
      // Bio row reads better than the column silently vanishing.
      if (this.otherProfileBioHeading) {
        this.otherProfileBioHeading.textContent = t('profileBioHeading')
        this.otherProfileBioHeading.style.display = ''
      }
      // .textContent, not innerHTML - bio/motto are untrusted freeform
      // text from another player's own doc, same "every persisted stat
      // is untrusted" rule as everywhere else in this file (see
      // CLAUDE.md's own recurring-bug-class note on this).
      if (this.otherProfileBioText) {
        this.otherProfileBioText.textContent = hasBio ? bioTrimmed : t('otherProfileNoBio')
        this.otherProfileBioText.style.display = ''
      }
      // Notes - private, local-only, keyed by this player's playerId (see
      // _otherProfileCurrentPlayerId, set right before this function runs).
      // Only shown at all when there's actually a playerId to key by.
      const notesAvailable = !!this._otherProfileCurrentPlayerId
      if (this.otherProfileNotesHeading) {
        this.otherProfileNotesHeading.textContent = t('otherProfileNotesHeading')
        this.otherProfileNotesHeading.style.display = notesAvailable ? '' : 'none'
      }
      if (this.otherProfileNotesHint) {
        this.otherProfileNotesHint.textContent = t('otherProfileNotesHint')
        this.otherProfileNotesHint.style.display = notesAvailable ? '' : 'none'
      }
      if (this.otherProfileNotesInput) {
        this.otherProfileNotesInput.placeholder = t('otherProfileNotesPlaceholder')
        this.otherProfileNotesInput.style.display = notesAvailable ? '' : 'none'
        this.otherProfileNotesInput.value = notesAvailable ? (this.settings.playerNotes[this._otherProfileCurrentPlayerId] || '') : ''
      }
      this.otherProfileBioMotto.style.display = ''
    }
  }

  _closeOtherPlayerProfile() {
    if (this.otherProfilePanel) this.otherProfilePanel.style.display = 'none'
  }

  // Fetches each friend's live status (see _computeFriendStatus) by their
  // stored uid - index-paired with the rows _renderSavedFriends just built
  // rather than re-querying by a data-uid attribute selector, simplest way
  // to avoid needing to escape uid for use in a CSS selector. A friend
  // saved before this presence system existed has uid: null (see
  // loadSettings' savedFriends normalizer) and is skipped, staying at the
  // default "Offline" the row already renders.
  async _fetchFriendPresences(friends) {
    if (!CloudSync.isConfigured() || !this.cloudsaveSavedFriends) return
    const rows = this.cloudsaveSavedFriends.querySelectorAll('.saved-friend-row')
    if (!this._lastFriendStatuses) this._lastFriendStatuses = {}
    await Promise.all(friends.map(async (f, i) => {
      if (!f.uid) return
      try {
        const presence = await CloudSync.fetchPresence(f.uid)
        const status = this._computeFriendStatus(presence)
        // Friend Online/Offline Alerts (General tab) - fires only on an
        // actual offline->online transition (not idle/dnd shuffling, and
        // not the very first read this session, which would otherwise
        // fire once for every already-online friend the moment the panel
        // opens - _lastFriendStatuses starting undefined for a uid is
        // exactly that "first read" case).
        const prevStatus = this._lastFriendStatuses[f.uid]
        if (this.settings.friendPresenceNotify && prevStatus === 'offline' && status !== 'offline') {
          this._showHomepageToast(t('friendCameOnlineToast', { name: f.name || t('friendStatusOnline') }))
        }
        this._lastFriendStatuses[f.uid] = status
        const row = rows[i]
        if (!row) return
        row.querySelector('.friend-status-dot').dataset.status = status
        const label = row.querySelector('.friend-status-label')
        // Offline shows how long ago they were last seen instead of a bare
        // "Offline" - falls back to the plain label if we never got a
        // timestamp at all (e.g. they've never synced).
        label.textContent = status === 'offline' && presence && presence.lastActiveAt
          ? t('friendStatusOfflineAgo', {
            time: this.settings.exactLastSeen
              ? new Date(presence.lastActiveAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', hour12: this.settings.timeFormat === '12h' })
              : _formatRelativeTime(Date.now() - presence.lastActiveAt),
          })
          : t(FRIEND_STATUS_LABEL_KEYS[status])
      } catch {
        // Best-effort - stays "Offline" default on a failed read.
      }
    }))
  }

  // Online: heartbeat seen in the last 2 min. Idle: seen more than 2 but
  // less than 5 min ago. Offline: no heartbeat at all, or older than 5 min
  // (this wins over Do Not Disturb even if that flag is still set from
  // their last active session - a friend who's actually gone offline
  // shouldn't show as "busy," they should show as gone).
  _computeFriendStatus(presence) {
    if (!presence || !presence.lastActiveAt) return 'offline'
    const elapsed = Date.now() - presence.lastActiveAt
    if (elapsed > FRIEND_OFFLINE_THRESHOLD_MS) return 'offline'
    if (presence.doNotDisturb) return 'dnd'
    if (presence.manualIdle) return 'idle'
    return elapsed < FRIEND_ONLINE_THRESHOLD_MS ? 'online' : 'idle'
  }

  // Send Friend Request - looked up by the recipient's stable random
  // playerId (see CloudSync.fetchLeaderboardEntryByPlayerId) rather than
  // their nickname, since a nickname can change/collide and an ID can't.
  // Requires being signed in, same gate the rest of this panel already has.
  async _sendFriendRequestClick() {
    if (!this.cloudsaveFriendInput || !this.cloudsaveFriendResult || !this._cloudUid) return
    const id = this.cloudsaveFriendInput.value.trim().toUpperCase()
    if (!id) return
    if (id === this.settings.playerId) {
      this.cloudsaveFriendResult.textContent = t('friendRequestSelfError')
      return
    }
    this.cloudsaveFriendResult.textContent = t('cloudsaveConnecting')
    try {
      const entry = await CloudSync.fetchLeaderboardEntryByPlayerId(id)
      if (!entry || !entry.uid) {
        this.cloudsaveFriendResult.textContent = t('cloudsaveFriendNotFound')
        return
      }
      await CloudSync.sendFriendRequest(entry.uid, this._cloudUid, this.settings.nickname || t('cloudsaveFriendNotFound'))
      this.cloudsaveFriendResult.textContent = t('friendRequestSent', { name: entry.name || id })
    } catch {
      this.cloudsaveFriendResult.textContent = t('cloudsaveError')
    }
  }

  // Incoming Friend Requests - _incomingFriendRequests is kept live by the
  // subscribeIncomingFriendRequests listener started in restoreCloudSession
  // (CloudSaveUI.js), so this is just a render of already-current state,
  // not a fetch of its own.
  _renderFriendRequests() {
    if (!this.friendRequestsList) return
    if (this.friendRequestsHeading) this.friendRequestsHeading.textContent = t('friendRequestsHeading')
    const requests = this._incomingFriendRequests
    if (this.friendRequestsCount) this.friendRequestsCount.textContent = t('friendRequestsCount', { n: requests.length })
    if (this.deleteAllRequestsBtn) {
      this.deleteAllRequestsBtn.textContent = t('deleteAllRequestsBtn')
      this.deleteAllRequestsBtn.style.display = requests.length ? '' : 'none'
    }
    this.friendRequestsList.innerHTML = requests.length
      ? requests.map((r) => `
          <div class="friend-request-row" data-from-uid="${_escapeHtml(r.fromUid)}">
            <span>${_escapeHtml(r.fromNickname || '???')}</span>
            <span>
              <button class="mini-action-btn friend-request-accept" data-from-uid="${_escapeHtml(r.fromUid)}" data-from-name="${_escapeHtml(r.fromNickname || '')}" type="button">${t('friendRequestAccept')}</button>
              <button class="mini-action-btn friend-request-decline" data-from-uid="${_escapeHtml(r.fromUid)}" type="button">${t('friendRequestDecline')}</button>
            </span>
          </div>
        `).join('')
      : `<p class="nearly-there-line">${t('friendRequestNone')}</p>`
    for (const btn of this.friendRequestsList.querySelectorAll('.friend-request-accept')) {
      btn.addEventListener('click', () => this._respondToFriendRequest(btn.dataset.fromUid, btn.dataset.fromName, true))
    }
    for (const btn of this.friendRequestsList.querySelectorAll('.friend-request-decline')) {
      btn.addEventListener('click', () => this._respondToFriendRequest(btn.dataset.fromUid, null, false))
    }
  }

  async _respondToFriendRequest(fromUid, fromNickname, accept) {
    if (!this._cloudUid) return
    if (accept && fromNickname && !this.settings.savedFriends.some((f) => f.uid === fromUid)) {
      if (this.settings.savedFriends.length >= 5) this.settings.savedFriends.shift()
      this.settings.savedFriends.push({ name: fromNickname, uid: fromUid })
      saveSettings(this.settings)
      this._renderSavedFriends()
    }
    try {
      await CloudSync.respondToFriendRequest(this._cloudUid, fromUid)
      // Lets the ORIGINAL SENDER find out their request was accepted even
      // if they're not online right now (see CloudSync.notifyFriendAccepted)
      // - only on accept, a decline stays silent same as before.
      if (accept) await CloudSync.notifyFriendAccepted(fromUid, this._cloudUid)
    } catch {
      // Best-effort - the live subscription will resync the list either
      // way the next time it fires.
    }
  }

  async _deleteAllFriendRequests() {
    if (!this._cloudUid || !this._incomingFriendRequests.length) return
    try {
      await Promise.all(this._incomingFriendRequests.map((r) => CloudSync.respondToFriendRequest(this._cloudUid, r.fromUid)))
    } catch {
      // Best-effort - same reasoning as _respondToFriendRequest above.
    }
  }

  _updateFriendsDot() {
    if (!this.friendsRequestDot) return
    this.friendsRequestDot.style.display = this._incomingFriendRequests.length ? '' : 'none'
  }

  // Friends nav dot - gold, lights up if someone accepted a friend request
  // you sent them (see CloudSync.notifyFriendAccepted/fetchAcceptedNotifications).
  // A one-off fetch (not a live subscription like incoming requests) run
  // alongside the other homepage nav dots, not on its own timer.
  async _checkFriendAcceptedNotifications() {
    if (!this._cloudUid || !CloudSync.isConfigured() || !this.friendsAcceptedDot) return
    try {
      this._friendAcceptedNotifications = await CloudSync.fetchAcceptedNotifications(this._cloudUid)
    } catch {
      return // Best-effort - leaves the dot at whatever it last showed.
    }
    this.friendsAcceptedDot.style.display = this._friendAcceptedNotifications.length ? '' : 'none'
  }

  // Clears every accepted-notification doc once the player has opened
  // Friends to see it - mirrors the other panels' _markXSeen pattern,
  // just against Firestore docs instead of a localStorage seen-id set.
  async _markFriendAcceptedSeen() {
    if (!this._cloudUid || !this._friendAcceptedNotifications.length) return
    const notifications = this._friendAcceptedNotifications
    this._friendAcceptedNotifications = []
    if (this.friendsAcceptedDot) this.friendsAcceptedDot.style.display = 'none'
    try {
      await Promise.all(notifications.map((n) => CloudSync.clearAcceptedNotification(this._cloudUid, n.accepterUid)))
    } catch {
      // Best-effort - a leftover doc just gets re-fetched (and re-cleared)
      // next time the dot check runs.
    }
  }

  async _renderGlobalKills() {
    if (!this.cloudsaveGlobalKills) return
    try {
      const total = await CloudSync.fetchGlobalKills()
      this.cloudsaveGlobalKills.textContent = total === null ? '' : t('cloudsaveGlobalKillsLine', { n: total.toLocaleString() })
      // Server-wide milestone bulletin - a one-time homepage toast the
      // first time this session's fetch sees the global total past a
      // round 100k mark, rather than a permanent new homepage line (this
      // menu's own zero-scroll height budget is a real, easy thing to
      // break - see the menu-redesign notes - so a toast is the safer
      // way to surface this).
      if (total !== null) {
        const milestone = Math.floor(total / GLOBAL_KILLS_MILESTONE_STEP) * GLOBAL_KILLS_MILESTONE_STEP
        if (milestone > 0 && this._globalKillsMilestoneToastedFor !== milestone) {
          this._globalKillsMilestoneToastedFor = milestone
          this._showHomepageToast(t('globalKillsMilestoneToast', { n: milestone.toLocaleString() }))
        }
      }
    } catch {
      this.cloudsaveGlobalKills.textContent = ''
    }
  }

  _renderLeaderboardRows(rows) {
    if (!this.cloudsaveLeaderboardList) return
    // rows is `null` on a subscription error (see CloudSync.subscribeTopLeaderboard's
    // own comment) - distinct from a real empty array, which just means no
    // entries yet. Without this check an error left the "Connecting..."
    // placeholder _subscribeLeaderboard sets up on open showing forever,
    // most commonly hit by the region filter (a region + bestNight compound
    // query needs a Firestore index this project never had created).
    if (rows === null) {
      this.cloudsaveLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
      return
    }
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
    // Anonymous Mode (General tab) - only swaps the displayed name; every
    // other field (playerId, stats) still writes normally, so Friend
    // Compare/lookup-by-ID keeps working even while anonymous on the
    // public leaderboard itself.
    const name = this.settings.anonymousLeaderboard ? t('anonymousLeaderboardName') : (this.settings.nickname || t('menuPlayerTagDefault'))
    const entry = {
      name,
      bestNight: _safeStatNumber(this.bestStats.bestNight),
      bestKills: _safeStatNumber(this.bestStats.bestKills),
      bestKillStreak: _safeStatNumber(this.bestStats.bestKillStreak),
      achievementCount: this.achievements.unlocked.size,
      // Synced so Add Friend can look someone up by their stable random ID
      // instead of their (changeable, non-unique) nickname - see
      // CloudSync.fetchLeaderboardEntryByPlayerId.
      playerId: this.settings.playerId,
      // Career-rank source of truth (see CAREER_RANK_TITLES, Game.js ~1208)
      // wasn't previously exposed to the public leaderboard doc at all -
      // added so external readers (the Discord bot's rank-role feature)
      // can compute the same Rookie/Survivor/Veteran/Elite/Legend tier the
      // game itself shows, instead of reinventing a second rank scale.
      // Not covered by FIRESTORE_SECURITY_RULES' explicit per-field checks
      // yet (that rule has no `hasOnly()`, so an unlisted field isn't
      // rejected) - fine for a read-only display number with no gameplay
      // effect if spoofed, but add real bounds validation there too if
      // this field ever gates something that matters.
      totalKills: _safeStatNumber(this.careerStats.totalKills),
    }
    // region is omitted entirely when unset ('global' = no preference
    // picked) rather than defaulted to some region - the security rule's
    // own enum check only applies when the field is present at all.
    if (this.settings.region && this.settings.region !== 'global') entry.region = this.settings.region
    // this.settings.clanId is the local membership cache (see
    // _refreshClanUi) - denormalized onto the player's own leaderboard doc
    // so fetchClanCombinedStats can sum a clan's kills/night with one
    // where('clanId', ...) query instead of a per-member fetch.
    if (this.settings.clanId) entry.clanId = this.settings.clanId
    // Bio/Motto/Your Stats moved from Hidden to Shown to Public
    // (2026-09-22, explicit request) - these fields make that real rather
    // than just relabeling a tab: raw/structured values only (never
    // pre-rendered/translated text), same reasoning as everywhere else in
    // this file - the VIEWING client's own t() formats it in their own
    // language, not the profile owner's. _renderOtherProfileEntry is the
    // read side of this same change.
    entry.bio = (this.settings.bio || '').slice(0, 5000)
    entry.totalDeaths = _safeStatNumber(this.careerStats.totalDeaths)
    entry.totalRuns = _safeStatNumber(this.careerStats.totalRuns)
    entry.lifetimePlaytimeSeconds = _safeStatNumber(this.careerStats.lifetimePlaytimeSeconds)
    entry.longestSurvivalMs = this.bestRunPace ? _safeStatNumber(this.bestRunPace.elapsedMs) : 0
    {
      // Same tally _updateBestStatsDisplay's own Favorite Class does, not
      // a new computation - kept in sync with that one by hand since the
      // source data (runHistory) isn't itself synced (see its own comment
      // in _updateBestStatsDisplay on why a lifetime array of every run
      // isn't something to expose wholesale to the public leaderboard).
      const loadoutTally = {}
      for (const run of this.runHistory) {
        if (run.loadout) loadoutTally[run.loadout] = (loadoutTally[run.loadout] || 0) + 1
      }
      const topLoadout = Object.keys(loadoutTally).sort((a, b) => loadoutTally[b] - loadoutTally[a])[0]
      if (topLoadout) entry.favoriteClass = topLoadout
    }
    {
      const diffEntries = Object.entries(this.careerStats.difficultyStats)
      if (diffEntries.length > 0) {
        const [favoriteId] = diffEntries.reduce((best, cur) => (cur[1].runs > best[1].runs ? cur : best))
        entry.favoriteDifficulty = favoriteId
      }
    }
    {
      const last = this.runHistory[0]
      if (last) {
        entry.lastRunSurvived = !!last.survived
        entry.lastRunNight = _safeStatNumber(last.night)
        entry.lastRunKills = _safeStatNumber(last.kills)
        entry.lastRunCoins = _safeStatNumber(last.coins)
      }
    }
    {
      const best = this.runHistory.find((r) => _safeStatNumber(r.night) === _safeStatNumber(this.bestStats.bestNight))
      if (best) {
        entry.bestRunNight = _safeStatNumber(best.night)
        entry.bestRunKills = _safeStatNumber(best.kills)
        entry.bestRunCoins = _safeStatNumber(best.coins)
        if (best.difficulty) entry.bestRunDifficulty = best.difficulty
        if (best.loadout) entry.bestRunLoadout = best.loadout
      }
    }
    if (this.careerStats.firstPlayedDate) entry.firstPlayedDate = this.careerStats.firstPlayedDate
    // Same source/priority _renderProfileCreated uses for the OWN profile's
    // "Created" line - was wrongly hardcoded to careerStats.accountCreatedAt
    // (this device's own first-launch timestamp) here, while the owner's own
    // view prefers the signed-in Google account's real creation date. Real
    // bug (2026-09-22): another player's looked-up profile showed a wildly
    // different "Created X ago" than the owner's own Profile panel did for
    // the exact same account.
    entry.accountCreatedAt = _safeStatNumber((this._cloudProfile && this._cloudProfile.accountCreatedAt) || this.careerStats.accountCreatedAt)
    // "Today" is deliberately session-local/never-persisted everywhere
    // else in this codebase (see _renderTodayLine's own comment) - synced
    // here anyway per explicit request despite that, so it WILL read
    // stale (frozen at whatever it was on the last sync) until this
    // player's next _pushOnlineStats call, unlike every other field above.
    entry.todayKills = _safeStatNumber(this._sessionKills)
    entry.todayMinutes = Math.round((performance.now() - this._sessionStartTime) / 60000)
    CloudSync.pushLeaderboardEntry(this._cloudUid, entry).catch(() => {})
    CloudSync.pushWeeklyLeaderboardEntry(_thisWeekStr(), this._cloudUid, {
      name,
      progress: _safeStatNumber(this.weeklyChallenge.progress),
    }).catch(() => {})
    CloudSync.incrementGlobalKills(_safeStatNumber(this.kills)).catch(() => {})
  }

  // Popup-based (see CloudSync.signIn's own comment for why the
  // redirect version tried 2026-09-15 got reverted the same day: Chrome's
  // bounce-tracking mitigation can silently wipe the Firebase auth
  // handler's storage mid-redirect, with no error at all - confirmed live
  // via a "Chrome may soon delete state for intermediate websites in a
  // recent navigation chain" DevTools warning during the actual failure).
  // Popup's own known risk (ad blockers/privacy extensions breaking the
  // popup<->opener channel) at least surfaces as a real caught error code
  // below instead of a silent no-op.
  async _handleCloudSignIn() {
    if (!CloudSync.isConfigured()) {
      this._showLoreToast(t('cloudsaveNotConfigured'))
      return
    }
    if (this.cloudsaveSigninBtn) this.cloudsaveSigninBtn.textContent = t('cloudsaveConnecting')
    try {
      const { uid, profile } = await CloudSync.signIn()
      await this._afterCloudSignIn(uid, profile)
    } catch (err) {
      this._showLoreToast(err && err.code === 'auth/network-request-failed' ? t('cloudsaveNetworkError') : t('cloudsaveError'))
      CloudSaveUI.renderCloudSaveState(this)
    }
  }

  async _afterCloudSignIn(uid, profile) {
    // _restoreCloudSession's onAuthChange listener will also fire from
    // this same sign-in and set _cloudProfile/_cloudUid again - setting
    // them here too just means the very next lines (fetchCloudSave)
    // don't have to wait a tick for that callback to run first.
    this._cloudProfile = profile
    this._cloudUid = uid
    CloudSaveUI.updateCloudQuickIcon(this, true)
    CloudSaveUI.renderCloudSaveState(this)
    this._renderProfileAccountRow()

    // Retry safeguard (kept from the earlier investigation, still cheap
    // insurance regardless of the popup/redirect root cause above): a
    // false "empty" here is destructive - falling through to pushToCloud
    // would silently overwrite a real cloud save with this device's blank
    // one - so don't believe "no save exists" off a single fetch.
    //
    // Real bug fixed 2026-09-26: fetchCloudSave itself had no try/catch
    // anywhere in this chain, and neither did this loop - a genuine fetch
    // failure (thrown exception - a real network hiccup, not a clean
    // "no document") propagated straight out of this whole function,
    // skipping BOTH the push-if-first-time branch below AND the pull/
    // conflict branch after it. Net effect on a real device: sign-in
    // itself succeeded (so it looked "signed in"), but the save never
    // got pulled OR pushed - the device just silently kept its own
    // freshly-generated playerId/nickname/zero stats, with no error
    // shown anywhere. Now every attempt is individually caught, and a
    // clean "no document" (worth trusting) is tracked separately from a
    // thrown error (worth retrying, then telling the player about if it
    // never recovers) - `!cloud` alone can no longer mean either one.
    let cloud = null
    let fetchFailed = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        cloud = await CloudSync.fetchCloudSave(uid)
        fetchFailed = false
        if (cloud) break
      } catch {
        fetchFailed = true
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800))
    }
    if (fetchFailed) {
      // Every attempt genuinely failed - never guess here. Falling
      // through to pushToCloud would risk overwriting a real cloud save
      // with this device's own (possibly blank) local state; silently
      // doing nothing would repeat the exact silent-wrong-identity bug
      // this replaced. Tell the player plainly instead - they're still
      // signed in and can retry (re-open Cloud Save, or reload) once
      // their connection is better.
      // _showHomepageToast, not _showLoreToast - sign-in almost always
      // happens from the homepage, before gameStarted is true, and
      // _showLoreToast silently no-ops in that case (see its own
      // gameStarted guard) - this message would never have shown at all.
      this._showHomepageToast(t('cloudsaveRestoreFailed'))
      return
    }
    if (!cloud) {
      // Confirmed (not just assumed) no cloud save exists yet - first
      // time signing in on any device.
      await CloudSaveUI.pushToCloud(this, false)
      return
    }
    // Same account should read the same everywhere, automatically -
    // requiring a manual "cloud or local" pick on every single sign-in
    // was exactly the confusing step this whole investigation kept
    // running into. Auto-apply the cloud save directly UNLESS this
    // device already has real progress of its own that a silent
    // overwrite would actually lose - in that one case, still show the
    // same compare-and-choose prompt as before rather than discarding a
    // device someone's genuinely been playing on without asking.
    if (this._hasMeaningfulLocalProgress()) {
      this._cloudPendingConflict = cloud.data
      CloudSaveUI.renderCloudConflict(this, cloud.data)
    } else {
      CloudSaveUI.applyCloudSaveData(this, cloud.data)
    }
  }

  // Silent background counterpart to _afterCloudSignIn, called once per
  // page load when Firebase resumes an ALREADY-signed-in session (see
  // CloudSaveUI.restoreCloudSession) rather than a fresh Sign In click.
  //
  // Root problem this fixes: before this existed, a device that was
  // already signed in never checked the cloud again after its very first
  // sign-in - editing something that isn't tied to finishing a run (bio,
  // nickname, anything Settings-only) never reached a second device that
  // was never explicitly signed out and back in again. Two devices could
  // drift apart forever, each only ever showing its own edits, with
  // nothing ever telling either one to catch up.
  //
  // Deliberately much narrower than _afterCloudSignIn: no conflict
  // prompt, no push-if-missing branch, and any failure is silent - this
  // runs unprompted on every single load, so it must never interrupt
  // with a popup or error toast the way an explicit Sign In click can.
  //
  // Real bug found 2026-09-27, same day this function shipped: comparing
  // only the cloud's timestamp against this device's own last SYNC time
  // (ignoring whether this device had made any edit since then) meant an
  // edit made just before a reload - too recent for its own debounced
  // push to have fired yet - could get silently overwritten if another
  // device happened to push in that same narrow window. Now also tracks
  // whether THIS device has an edit newer than its last sync
  // (LAST_LOCAL_CHANGE_KEY, stamped by saveSettings on every call) before
  // deciding what to do, instead of only ever considering the cloud side.
  //
  // Replaced 2026-09-28 by the three-way merge sync (see CloudMerge.js):
  // the timestamp comparison here could only ever pick ONE whole side -
  // whichever device's save "won" silently discarded everything the other
  // device had done - and its "unpushed change" signal only covered
  // settings, not stats/coins/purchases. uid is unused now (the sync reads
  // this._cloudUid) but kept so the caller didn't need to change.
  //
  // Upload-only since the reload-loop fix (see CloudPreBoot.js): the pull
  // half already happened before the game was built.
  async _checkForNewerCloudSave(_uid) {
    await CloudSaveUI.syncWithCloud(this, { allowApply: false })
  }

  // In-memory state that's normally only written on page close
  // (beforeunload) - flushed early when the tab is hidden, so Cloud Save's
  // on-hide sync uploads it too (see CloudSaveUI.installChangeTracking).
  _flushLocalSave() {
    if (this._importingSave) return
    saveShopProgress(this)
  }

  // See _afterCloudSignIn's own comment - the one condition under which a
  // fresh sign-in still asks before overwriting local with cloud. Cheap
  // real-progress signals only (not exhaustive) - a device that's never
  // actually been played on genuinely has nothing worth protecting.
  _hasMeaningfulLocalProgress() {
    return _safeStatNumber(this.careerStats.totalKills) > 0
      || _safeStatNumber(this.bestStats.bestNight) > 0
      || (Array.isArray(this.runHistory) && this.runHistory.length > 0)
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

  // In-game bug report (batch feature) - copies a plain-text report to the
  // clipboard (same navigator.clipboard pattern _copyTextRecap already
  // uses) with real live state auto-attached, so a player doesn't have to
  // remember to describe what they were doing - reads it straight off the
  // game/kill-feed rather than needing a new "recent actions" log of its
  // own. No backend - the player pastes it into Discord themselves (see
  // the game's own Terms/Credits, same support channel already listed
  // there), not a silent submission anywhere.
  _reportBug() {
    const report = [
      `GayZ bug report`,
      `Coins: ${this.coins}  Page: ${location.pathname}  Map Editor open: ${this.buildMode.active ? 'yes' : 'no'}`,
      `--- describe what happened above this line ---`,
    ].join('\n')
    if (!navigator.clipboard) {
      this._showLoreToast(t('clipboardCopyUnsupported'))
      return
    }
    navigator.clipboard.writeText(report)
      .then(() => this._showLoreToast(t('bugReportCopied')))
      .catch(() => this._showLoreToast(t('clipboardCopyUnsupported')))
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
      this._applyLanguage() // text shows keys via {key:...} - refresh it
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
        for (const b of this.difficultyBtns) b.classList.toggle('active', b === btn)
        this._updateNightmareOverlay()
      })
    }
  }

  // Nightmare (unlocked by the true ending) gets a harsher red tint so it's
  // visually distinct, not just numerically harder.
  _updateNightmareOverlay() {
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
      })
    }
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

  // Game Modes grid (Choose Your Challenge) - single-select like Choose
  // Class's role/loadout buttons above, not the general checkbox mutators
  // list. Locked (Coming Soon) entries carry a real `disabled` attribute
  // in the HTML, so they never reach this click handler at all - no extra
  // guard needed here for those. zombieDefense/bossHunt/zombieRush each
  // just flip the matching settings.mutators.* flag the run-start setup
  // (see _setupGameModeRun) already reads.
  _bindGameModeSelect() {
    for (const btn of this.gameModeSelectBtns) {
      btn.classList.toggle('active', btn.dataset.gameMode === this.settings.selectedGameMode)
      btn.addEventListener('click', () => {
        const mode = btn.dataset.gameMode
        const wasZombieRush = this.settings.selectedGameMode === 'zombieRush'
        const isZombieRush = mode === 'zombieRush'
        this.settings.selectedGameMode = mode
        this.settings.mutators.zombieDefense = mode === 'zombieDefense'
        this.settings.mutators.bossHunt = mode === 'bossHunt'
        this.settings.mutators.zombieRush = isZombieRush
        // Zombie Rush's "limited resources" - reuses Iron Mode's existing
        // no-Trader/no-Shop-spending restriction rather than a new one.
        // Only touched on an actual enter/exit of Zombie Rush (not on
        // every click, e.g. re-clicking the already-active tile or
        // switching between two other modes) - forcing it on remembers
        // whatever the player's own Iron Mode checkbox was set to first,
        // so leaving Zombie Rush restores their real preference instead
        // of always resetting it to off. Also re-syncs the actual
        // checkbox in the Mutators panel, which otherwise silently
        // disagreed with settings.mutators.ironMode.
        if (isZombieRush && !wasZombieRush) {
          this._ironModeBeforeZombieRush = this.settings.mutators.ironMode
          this.settings.mutators.ironMode = true
        } else if (!isZombieRush && wasZombieRush) {
          this.settings.mutators.ironMode = this._ironModeBeforeZombieRush ?? false
        }
        if (this.mutatorIronMode) this.mutatorIronMode.checked = this.settings.mutators.ironMode
        saveSettings(this.settings)
        for (const b of this.gameModeSelectBtns) b.classList.toggle('active', b === btn)
      })
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
    this.loginStreak.recentDates = [...(this.loginStreak.recentDates || []), today].slice(-LOGIN_CALENDAR_DAYS)
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
    // as _openUpgradesPanel: #pause-overlay comes after
    // #settings-panel in index.html and would otherwise render on top and
    // eat every click meant for a setting underneath it.
    if (open) {
      this._closeAllMenuPanels()
    }
    this.settingsOpen = open
    this.settingsPanel.style.display = open ? 'flex' : 'none'
    // Recently Changed / Undo (see _renderRecentlyChangedList/
    // _undoSettingsSession) - a snapshot taken fresh every time the panel
    // opens, so "recently changed" and "undo" both mean "since I opened
    // Settings this time," not some longer rolling history.
    if (open) {
      this._settingsOpenSnapshot = JSON.stringify(this.settings)
      this._renderRecentlyChangedList()
      if (this.settings.shareTelemetry) CloudSync.incrementTelemetry('settingsOpened').catch(() => {})
      // Reopen Settings to Last-Used Tab (General tab) - always resets to a
      // specific tab on open (General unless the toggle is on), rather than
      // only doing so when the toggle is on. The tab strip's own "active"
      // CSS class otherwise just carries over from whatever was last
      // clicked (recorded regardless of this toggle, see the click handler
      // above) - even from a much earlier session - so without this,
      // opening Settings could silently land on a random leftover tab
      // instead of General.
      const targetTabPage = this.settings.rememberSettingsTab ? this.settings.lastSettingsTab : 'general'
      const tab = document.querySelector(`.settings-tab[data-page="${targetTabPage}"]`)
      if (tab) tab.click()
    }
  }

  // Build Mode - a standalone block-placing sandbox (see BuildMode.js's own
  // comment), reachable from the homepage. Reuses this.menu's existing
  // hide/show pattern (same as starting a real run) rather than a new panel.
  // map: 'map3' opens the ready-made Map 3 city (Map3Generator.js); 'map2'
  // leaves it for the player's own slots. Omitted keeps the last slot.
  // play: start Play (zombie waves, BuildSurvival.js) on it straight away -
  // Game Mode's Map 3 + the Play button.
  async _enterBuildMode({ map, play = false } = {}) {
    // Every other nav button routes through trackAndOpen/_open*Panel(),
    // which calls _closeAllMenuPanels() first (see that function's own
    // comment on the z-index/stacking bug this prevents). Build Mode
    // isn't one of those panels (it hides this.menu itself instead), but
    // the panels themselves are siblings of #menu, not children of it -
    // hiding #menu does NOT hide an already-open panel. Currently
    // unreachable through a normal click (every panel sits at a higher
    // z-index than #menu and blocks the nav button underneath), but
    // calling it here too is a one-line no-op the rest of the time and
    // closes the gap for any future path that reaches _enterBuildMode()
    // without going through a blocked nav click first.
    this._closeAllMenuPanels()
    // Covers the canvas for the whole function - without this, the real
    // game world (which keeps rendering the whole time, see the dynamic-
    // import comment below) flashes through for however long loading
    // takes, especially noticeable on the very first visit this session.
    if (this.buildModeLoadingOverlay) this.buildModeLoadingOverlay.style.display = 'flex'
    const buildModeLoadStartedAt = performance.now()
    this.menu.style.display = 'none'
    // Deferred a tick (queueMicrotask, not called inline here) - the
    // _closeAllMenuPanels() call above, when it actually closes something
    // (e.g. entering from the Map 2 tile in the Game Mode panel), flips a
    // routable panel's display:none, which _bindPanelRouting's own
    // MutationObserver reacts to on its OWN microtask by pushing '/' (no
    // routable panel reads as "open" anymore - Build Mode isn't one of
    // _routes). That observer microtask was queued first (the mutation
    // happened above, before this line), so an inline pushState here would
    // still lose the race and get silently overwritten back to '/' the
    // instant the observer's callback ran. Queueing this one as its own
    // microtask puts it strictly after the observer's in the same FIFO
    // queue, so '/map-editor' is the last write and actually sticks -
    // verified live (was reproducibly overwritten back to '/' without
    // this). Harmless no-op when entered from the bare homepage nav
    // button instead (nothing closes, no mutation, no race to lose).
    queueMicrotask(() => {
      if (location.pathname !== '/map-editor') history.pushState({}, '', '/map-editor')
    })
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
    // _maybeShowTutorialHints' own guard only stops FUTURE hints from
    // firing once Build Mode is active - it can't stop one already
    // mid-animation at the exact moment Build Mode is entered. Hide it
    // directly here too, for that already-in-flight case.
    // Same for a homepage toast still fading out (e.g. the backup
    // reminder) - it would otherwise sit over the editor.
    if (this.loreToast) this.loreToast.classList.remove('show')
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
    // Chat stays with you in the Map Editor and Try Map (Enter to type).
    this.chatPanel.style.display = 'flex'
    document.body.classList.add('build-mode-on')
    // Zombie Rush's survival timer (real report 2026-09-29: "Survival
    // Time" showing over the map editor after a Zombie Rush run).
    // Weather overlay isn't gated to a real run at all - _rollWeather()
    // fires once from the constructor itself, so a fresh page load can
    // already be sitting at rainOverlayEl display:block before the player
    // has ever started (or finished) a real run.
    if (this.rainOverlayEl) this.rainOverlayEl.style.display = 'none'
    if (this.rainOverlayHardEl) this.rainOverlayHardEl.style.display = 'none'
    if (this.snowOverlayEl) this.snowOverlayEl.style.display = 'none'
    if (this.snowOverlayHardEl) this.snowOverlayHardEl.style.display = 'none'
    // Exit/Save/Export/Import etc. now live inside #build-menu, which
    // BuildMode.js's own enter()/exit() shows/hides (see toggleMenu) -
    // same pattern already used for its hotbar/slot-picker/tool buttons,
    // nothing left for Game.js to individually toggle here.
    // No auto requestPointerLock() here any more - the mouse used to get
    // captured the instant Build Mode opened, before the player had even
    // gotten oriented. It now starts free; clicking into the viewport
    // acquires it (see BuildMode.js's _onPointerDown), and Escape releases
    // it again at any time (see _onKeyDownPicker).
    // First visit this session - dynamically load the real class (see the
    // top-of-file comment on why this isn't a static import) and swap it in
    // for the placeholder. Every _tick()/keydown check in the meantime just
    // reads active: false off the placeholder and no-ops, same as before
    // Build Mode was ever touched at all - no race condition, just a few
    // extra frames of the normal game rendering underneath until this
    // resolves.
    if (typeof this.buildMode.enter !== 'function') {
      const { BuildMode } = await import('./BuildMode.js')
      this.buildMode = new BuildMode(this.renderer, this)
    }
    const current = this.buildMode.activeSlot
    const slot = map === 'map3' ? 'map3' : map === 'map2' && current === 'map3' ? 0 : undefined
    this.buildMode.enter({ slot })
    if (play) this.buildMode.survival.start({ fromMenu: true })
    this._applyRenderScale()
    // A boss bar left over from a run would otherwise sit over the editor.
    // FPS readout in the top-left corner (the save slot buttons moved into
    // the Escape menu), shown whenever the gameplay one would be.
    this.fpsEl.style.left = '16px'
    this.fpsEl.style.top = '16px'
    this.fpsEl.style.transform = ''
    this.fpsEl.style.opacity = this.settings.hudFpsCounter ? '1' : '0'
    this._fpsFrameCount = 0
    this._fpsLastUpdate = performance.now()
    // Opening the editor builds every chunk - don't judge fps on that.
    this._editorResHoldUntil = performance.now() + 2000
    // Always shows for at least BUILD_MODE_LOADING_MIN_MS so this reads as
    // a deliberate loading beat rather than a one-frame flicker on repeat
    // visits, where the dynamic import above is already cached and
    // everything in this function finishes near-instantly.
    const buildModeLoadElapsed = performance.now() - buildModeLoadStartedAt
    if (buildModeLoadElapsed < BUILD_MODE_LOADING_MIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, BUILD_MODE_LOADING_MIN_MS - buildModeLoadElapsed))
    }
    if (this.buildModeLoadingOverlay) this.buildModeLoadingOverlay.style.display = 'none'
  }

  // The run settings for a Map 1 run from the homepage: Game Mode's
  // Difficulty / Choose Class / Game Modes / Challenges & Mutators, plus
  // the Upgrades bought with Legacy Points (PlayRules.js).
  _playConfig() {
    return playConfig({
      difficulty: DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal,
      loadout: this.settings.loadout,
      gameMode: this.settings.selectedGameMode,
      mutators: this.settings.mutators,
      purchased: this.metaProgress.purchased,
    })
  }

  // What a homepage Map 1 run tells the game (BuildSurvival._report):
  // 'kill', 'wave', and 'end' once per run. Guest Mode saves none of it.
  // 'end' returns what the run earned, for the game-over card.
  _onPlayEvent(type, data) {
    if (this.settings.guestMode) return null
    if (type === 'kill') {
      this.rollingQuests.recordKill()
      this.achievements.unlock('first_blood')
      return null
    }
    if (type === 'wave') {
      const wave = data.wave
      this.rollingQuests.recordNight(wave)
      if (wave >= 5) this.achievements.unlock('survivor_5')
      if (wave >= 10) this.achievements.unlock('survivor_10')
      if (this.settings.difficulty === 'nightmare' && wave >= 5) this.achievements.unlock('nightmare_survivor_5')
      return null
    }
    if (type !== 'end') return null
    const points = data.kills * POINTS_PER_KILL + data.waves * POINTS_PER_WAVE
    // _recordRunEnd (the old Map 1's end-of-run bookkeeping: best stats,
    // career totals, run history, leaderboards, gems, Cloud Save) reads
    // these run fields.
    this.night = data.waves
    this.kills = data.kills
    this.peakKillStreakThisRun = data.bestStreak
    this.points = points
    this.runStartedAt = performance.now() - data.seconds * 1000
    this._runDistanceTraveled = 0
    this.lowestHealthThisRun = 0
    this._runStartCoins = this.coins
    // The camp coins earned in the run go to your real coins too, plus
    // this week's featured mutator bonus.
    let coins = data.coins
    if (this.settings.mutators[_weeklyFeaturedMutatorKey()]) coins += WEEKLY_FEATURED_MUTATOR_BONUS_COINS
    this.coins += coins
    this.careerStats.lifetimePointsEarned = (this.careerStats.lifetimePointsEarned || 0) + points
    if (data.died) this.achievements.unlock('first_death')
    if (data.kills >= 100) this.achievements.unlock('centurion')
    const legacy = Math.floor(points * DEATH_POINTS_CONVERSION)
    this.metaProgress.legacyPoints += legacy
    saveMetaProgress(this.metaProgress)
    this._recordRunEnd(!data.died)
    saveShopProgress(this)
    this._renderCurrencyBar()
    this._updateUpgradesDot()
    this._updateQuestsDot()
    return { legacy, coins }
  }

  // The block city is the only map to play now (the old Map 1 city was
  // deleted 2026-10-05) - its card is always the picked one.
  _renderMapSelect() {
    document.getElementById('map-select-3')?.classList.add('active')
  }

  // Update-available check - only ever called from _exitBuildMode (back
  // at the homepage), never mid-game, so a fresh deploy
  // while someone's playing never interrupts them; they just find out the
  // next time they're actually looking at the main menu again. version.json
  // carries the exact same build timestamp __BUILD_ID__ was compiled from
  // (see vite.config.js) - if they differ, a newer build than the one
  // currently loaded exists. Deliberately a timestamp, not the git hash
  // __BUILD_HASH__ already carries - confirmed via a real production
  // deploy that `vercel --prod`'s upload doesn't include .git, so the git
  // hash is always the literal fallback string 'dev' there, useless for
  // telling two real deploys apart. The "what changed" content isn't
  // duplicated anywhere - it re-fetches the live index.html and reads its
  // #changelog-list directly, so there's exactly one place (that list) to
  // keep updated, same as today.
  async _checkForUpdate() {
    if (!this.updateAvailableBanner || this.updateAvailableBanner.style.display === 'flex') return
    try {
      const versionRes = await fetch('/version.json', { cache: 'no-store' })
      const { id } = await versionRes.json()
      if (!id || id === __BUILD_ID__ || id === this.settings.lastSeenBuildId) return
      const pageRes = await fetch('/index.html', { cache: 'no-store' })
      const freshDoc = new DOMParser().parseFromString(await pageRes.text(), 'text/html')
      const freshChangelogList = freshDoc.getElementById('changelog-list')
      if (!freshChangelogList) return
      const entries = [...freshChangelogList.querySelectorAll('.changelog-entry')].slice(0, 5)
      if (!entries.length) return
      this.updateAvailableChangelog.innerHTML = entries.map((entry) => entry.outerHTML).join('')
      this._pendingUpdateId = id
      if (this.updateAvailableTitleEl) this.updateAvailableTitleEl.textContent = t('updateAvailableTitle')
      if (this.updateAvailableRefreshBtn) this.updateAvailableRefreshBtn.textContent = t('updateAvailableRefreshBtn')
      if (this.updateAvailableLaterBtn) this.updateAvailableLaterBtn.textContent = t('updateAvailableLaterBtn')
      this.updateAvailableBanner.style.display = 'flex'
    } catch {
      // A failed check (offline, blocked request, etc.) just means no
      // banner this time - not a player-facing error worth surfacing.
    }
  }

  _exitBuildMode() {
    this.buildMode.exit()
    this.chatPanel.style.display = 'none'
    document.body.classList.remove('build-mode-on')
    this._applyRenderScale()
    this.fpsEl.style.left = '6px'
    this.fpsEl.style.top = '6px'
    this.fpsEl.style.transform = ''
    this.fpsEl.style.opacity = this.settings.homepageFpsCounter ? '1' : '0'
    document.exitPointerLock()
    // Defensive reset, not just un-suspending - a stray real jump/fall
    // velocity firing for real the instant _tick() resumes calling
    // this.player.update() again would be a jarring launch off the
    // homepage's own spawn point.
    this.menu.style.display = ''
    if (location.pathname === '/map-editor') history.pushState({}, '', '/')
    // Back on the homepage - say so if a newer version was deployed.
    this._checkForUpdate()
  }

  // Diffs the live settings object against the snapshot taken when the
  // panel was opened (see _toggleSettings) - shallow key comparison, good
  // enough since nearly every settings field is a primitive; the handful
  // of object/array fields (mutators, navOrder, etc.) just compare by
  // JSON string equality, which still correctly detects "did this change."
  // lastSettingsTab is excluded on purpose - it's written on every single
  // tab click (see the .settings-tab handler), so without this exclusion
  // just browsing tabs (with zero real settings touched) would flag it as
  // a "change." A REAL change (language, a slider, etc.) still legitimately
  // shows this banner - #settings-status-row/#recently-changed-list.show
  // (style.css) reserve fixed space for it via visibility rather than
  // display:none, so the panel-box itself never resizes either way (it
  // used to - a language switch, which touches settings.language/
  // quickLanguageAlt, made the whole panel visibly grow).
  // Returns whether anything real actually changed - saveSettings() (Game.js
  // module scope, above the class) reuses this to decide whether its own
  // "Saved" pulse indicator is warranted, so the two never disagree about
  // what counts as a real change.
  _renderRecentlyChangedList() {
    if (!this.recentlyChangedList || !this._settingsOpenSnapshot) return false
    const before = JSON.parse(this._settingsOpenSnapshot)
    const changed = Object.keys(this.settings)
      .filter((k) => k !== 'lastSettingsTab')
      .filter((k) => JSON.stringify(this.settings[k]) !== JSON.stringify(before[k]))
    if (!changed.length) {
      this.recentlyChangedList.classList.remove('show')
      return false
    }
    this.recentlyChangedList.classList.add('show')
    // Raw camelCase setting keys (exactLastSeen, hudScale, ...) read as a
    // developer's own field name, not a sentence - capitalizing just the
    // first letter (ExactLastSeen) is a one-line, no-translation-needed
    // way to make the list read a little more like a real label without
    // needing a display-name lookup table kept in sync with 150+ settings
    // keys.
    const displayList = changed.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ')
    this.recentlyChangedList.innerHTML = `<p>${t('recentlyChangedLabel', { list: displayList })}</p><button id="undo-settings-session-btn" class="mini-action-btn" type="button">${t('undoSettingsBtn')}</button>`
    document.getElementById('undo-settings-session-btn')?.addEventListener('click', () => this._undoSettingsSession())
    return true
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
    // The map editor gets the screen's full sharpness (2026-09-29 report:
    // "the texture is way too blurry") - LOW_QUALITY_MODE's 0.75 base and
    // Auto Quality's resolution cut are for the survival world's cost; the
    // chunk-meshed editor (see BlockChunks.js) is cheap enough without
    // them, and on a 2x Retina screen they left it at ~1/3 of the real
    // pixels, stretched up. The Resolution slider still applies.
    const ratio = this.buildMode.active ? this._editorPixelRatio(this._editorResScale ?? 1) : this._basePixelRatio() * this._userResScale
    // Setting the same ratio again still resizes the canvas, and a resize
    // clears it - that's what flashed the map editor black ~5 times on
    // entry (2026-09-30 report) while its auto resolution kept "stepping"
    // on a screen where the ratio couldn't actually go any lower.
    if (Math.abs(this.renderer.getPixelRatio() - ratio) < 1e-3) return false
    this.renderer.setPixelRatio(ratio)
    return true
  }

  // _editorResScale: the editor's own automatic resolution (see
  // _updateEditorResScale). It gives up Retina/high-DPI extra sharpness
  // first; only a device still too slow at 1 pixel per CSS pixel (old
  // laptops, phones) goes lower, and never below EDITOR_MIN_PIXEL_RATIO.
  _editorPixelRatio(scale) {
    const full = Math.min(window.devicePixelRatio, 2) * this._userResScale
    return Math.max(Math.min(EDITOR_MIN_PIXEL_RATIO, full), full * scale)
  }

  _applyPerformanceMode(settingEnabled) {
    // Shadows are the expensive part left (the editor and Map 1 share this
    // renderer) - Performance Mode turns them off.
    this.renderer.shadowMap.enabled = !settingEnabled && this.settings.shadowsEnabled
    this._applyRenderScale()
  }



  // XP needed to go from `level` to `level + 1`. Grows linearly so early
  // levels (weak starting kit) come fast and later ones space out as the
  // player already has most of the small passive buffs.
  _xpForLevel(level) {
    return 10 + level * 6
  }

  // URL routing (per request - kirka.io shows e.g. kirka.io/store when you
  // open its store; this does the same, gayz.vercel.app/store etc.) A
  // single MutationObserver watches every routable panel's own display
  // toggle rather than hand-wiring history.pushState into each of the ~13
  // individual _openXPanel functions below - _closeAllMenuPanels() (right
  // after this) already guarantees at most one of these is ever visible
  // at a time, since every _openXPanel calls it first, so "which one just
  // became visible" is enough on its own to know which route to show.
  // This also means any future panel added to that same close-all
  // convention gets routing for free just by being added to _routes below,
  // no bespoke per-panel history code needed. vercel.json has the matching
  // rewrite for each slug, needed so a direct visit/refresh at one of
  // these URLs doesn't 404 - Vercel's static hosting has no server of its
  // own to fall back to index.html on an unrecognized path otherwise.
  // Build Mode/Map Editor doesn't fit this pattern (it's not a simple
  // display-toggle panel - see _enterBuildMode's own comment) and gets a
  // simpler one-way pushState in _enterBuildMode/_exitBuildMode directly:
  // its URL updates on entry/exit, but a direct visit to /map-editor just
  // lands on the plain homepage rather than actually re-entering Build
  // Mode - a real limitation, not attempted here given how much more
  // involved Build Mode's own startup sequence is than any of these.
  // Builds a panel's subTabs list from its tab buttons' shared "active"
  // class convention (every one of these 6 tab systems - Settings,
  // General/Clan/Market, Game Mode's Survival/Deathmatch, Quests,
  // Achievements' Survival/Deathmatch, Inventory - toggles class="...-tab
  // active" on whichever button was clicked, even though each uses its
  // own element-id prefix and its own way of switching the tab CONTENT
  // underneath). Reusing that one shared signal (not each tab system's
  // own content-visibility mechanism, which varies) keeps this generic
  // instead of needing bespoke logic per panel.
  _subTabsFor(idPrefix, slugs) {
    return slugs.map((slug) => ({ slug, btn: document.getElementById(idPrefix + slug) })).filter((s) => s.btn)
  }

  _bindPanelRouting() {
    this._routes = [
      { slug: 'store', panel: this.shopPanel, open: () => this._openShopPanel() },
      { slug: 'market', panel: this.marketPanel, open: () => this._openMarketPanel() },
      { slug: 'upgrades', panel: this.upgradesPanel, open: () => this._openUpgradesPanel() },
      {
        slug: 'quests', panel: this.questsPanel, open: () => this._openQuestsPanel(),
        subTabs: this._subTabsFor('quest-tab-', ['rolling', 'monthly', 'yearly', 'lifetime']),
      },
      { slug: 'friends', panel: this.friendsPanel, open: () => this._openFriendsPanel() },
      {
        slug: 'achievements', panel: this.achievementsPanel, open: () => this._openAchievementsPanel(),
        subTabs: this._subTabsFor('achievements-tab-', ['survival', 'deathmatch']),
      },
      {
        slug: 'inventory', panel: this.menuInventoryPanel, open: () => this._openMenuInventoryPanel(),
        subTabs: this._subTabsFor('inventory-tab-', ['character', 'crates', 'weapons', 'theme']),
      },
      { slug: 'global', panel: this.serverPanel, open: () => this._openServerPanel() },
      {
        slug: 'general', panel: this.clanPanel, open: () => this._openClanPanel(),
        subTabs: this._subTabsFor('general-tab-', ['general', 'clan', 'market']),
      },
      {
        slug: 'settings', panel: this.settingsPanel, open: () => this._toggleSettings(true),
        subTabs: this._subTabsFor('tab-', ['general', 'language', 'audio', 'controls', 'graphics']),
      },
      { slug: 'credits', panel: this.creditsPanel, open: () => this._openCreditsPanel() },
      { slug: 'levels', panel: this.levelsPanel, open: () => this._openLevelsPanel() },
      { slug: 'terms', panel: this.termsPanel, open: () => this._openTermsPanel() },
      { slug: 'privacy', panel: this.privacyPanel, open: () => this._openPrivacyPanel() },
      { slug: 'features', panel: this.featuresPanel, open: () => this._openFeaturesPanel() },
      { slug: 'design-a-skin', panel: this.skindesignerPanel, open: () => this._openSkinDesignerPanel() },
      { slug: 'how-to-play', panel: this.howtoplayPanel, open: () => this._openHowToPlayPanel() },
      { slug: 'whats-new', panel: this.whatsNewPanel, open: () => this._openWhatsNewPanel() },
      {
        slug: 'gamemode', panel: this.hubPanel, open: () => this._openHubPanel(),
        subTabs: this._subTabsFor('hub-tab-', ['survival', 'deathmatch']),
      },
    ].filter((route) => route.panel)

    // getComputedStyle, not panel.style.display directly - #settings-panel
    // (unlike every other routed panel) has no inline display:none in its
    // HTML at all, only a stylesheet rule, so its own .style.display
    // starts as an empty string rather than the literal 'none' every
    // other panel's inline style starts as. That empty string isn't
    // 'none', so a raw .style.display check treated Settings as already
    // open from the very first page load, before anything was clicked.
    const isOpen = (panel) => getComputedStyle(panel).display !== 'none'
    const isActiveTab = (btn) => btn.classList.contains('active')

    const computeTargetPath = () => {
      const openRoute = this._routes.find((r) => isOpen(r.panel))
      if (!openRoute) return '/'
      let path = '/' + openRoute.slug
      if (openRoute.subTabs) {
        const activeSub = openRoute.subTabs.find((s) => isActiveTab(s.btn))
        if (activeSub) path += '/' + activeSub.slug
      }
      return path
    }

    // Reacts to the NET open panel/tab across a whole batch of mutations,
    // not each individual transition - opening a new panel calls
    // _closeAllMenuPanels() first, hiding whichever was already open in
    // the SAME synchronous tick (MutationObserver batches same-tick
    // mutations into one callback), so reacting per-mutation would push an
    // intermediate "/" between the old panel's URL and the new one -
    // harmless-looking, but it means pressing Back once lands on that
    // empty "/" instead of the panel you were actually on before.
    const observer = new MutationObserver(() => {
      const targetPath = computeTargetPath()
      if (location.pathname !== targetPath) history.pushState({}, '', targetPath)
    })
    for (const route of this._routes) {
      observer.observe(route.panel, { attributes: true, attributeFilter: ['style'] })
      if (route.subTabs) {
        for (const sub of route.subTabs) observer.observe(sub.btn, { attributes: true, attributeFilter: ['class'] })
      }
    }

    window.addEventListener('popstate', () => this._applyRouteFromUrl())
    // Initial load - restores whichever panel (if any) the URL names, e.g.
    // a shared/bookmarked gayz.vercel.app/settings/language link.
    this._applyRouteFromUrl()
  }

  _applyRouteFromUrl() {
    if (!this._routes || this.gameStarted) return
    const [slug, subSlug] = location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
    if (!slug) {
      this._closeAllMenuPanels()
      return
    }
    const route = this._routes.find((r) => r.slug === slug)
    if (!route) return
    route.open()
    // Runs AFTER open() on purpose - some panels reset to their own
    // default tab as part of opening (e.g. Inventory's "always reopen on
    // the first tab" convention), so the URL's requested sub-tab has to
    // be applied afterward to actually win. A real .click() (not just
    // toggling the class this file's own observer reads) so every other
    // real click handler's own side effects still run exactly as if a
    // person had clicked it themselves.
    if (subSlug && route.subTabs) {
      const sub = route.subTabs.find((s) => s.slug === subSlug)
      if (sub) sub.btn.click()
    }
  }

  // Every top-level menu panel shares the same z-index (see style.css), so
  // opening a second one (e.g. Upgrades) without closing whichever was
  // already open (e.g. Shop) used to leave both stacked on top of each
  // other - only the topmost got the backdrop-click-to-close, so closing
  // fully needed two separate clicks. Each _open*Panel() below calls this
  // first so at most one is ever visible at once. Upgrades/How to
  // Play/Settings close via a direct display='none' here rather than their
  // own close method, since those methods also re-show #pause-overlay -
  // whichever panel is actually being opened decides that for itself.
  _closeAllMenuPanels() {
    if (this.upgradesPanel) this.upgradesPanel.style.display = 'none'
    if (this.howtoplayPanel) this.howtoplayPanel.style.display = 'none'
    if (this.settingsPanel && this.settingsOpen) {
      this.settingsOpen = false
      this.settingsPanel.style.display = 'none'
    }
    if (this.questsPanel) this._closeQuestsPanel()
    if (this.achievementsPanel) this._closeAchievementsPanel()
    if (this.hubPanel) this._closeHubPanel()
    if (this.comingSoonPanel) this._closeComingSoonPanel()
    if (this.clanPanel) this._closeClanPanel()
    if (this.friendsPanel) this._closeFriendsPanel()
    if (this.menuInventoryPanel) this._closeMenuInventoryPanel()
    if (this.serverPanel) this._closeServerPanel()
    if (this.profilePanel) this._closeProfilePanel()
    if (this.creditsPanel) this._closeCreditsPanel()
    if (this.levelsPanel) this._closeLevelsPanel()
    if (this.termsPanel) this._closeTermsPanel()
    if (this.privacyPanel) this._closePrivacyPanel()
    if (this.featuresPanel) this._closeFeaturesPanel()
    if (this.skindesignerPanel) this._closeSkinDesignerPanel()
    if (this.shopPanel) this._closeShopPanel()
    if (this.marketPanel) this._closeMarketPanel()
    this._closeTradeDialog()
    if (this.whatsNewPanel) this._closeWhatsNewPanel()
    if (this.sharePanel) this._closeSharePanel()
  }

  // Opened from the main menu (not gameplay) - spends persistent Legacy
  // Points (see MetaProgress.js) on one-time permanent upgrades.
  _openUpgradesPanel() {
    this._closeAllMenuPanels()
    // Opened from the pause overlay (still on screen, unlocked) as well as
    // the main menu - hide it explicitly rather than relying on DOM/paint
    // order, since #pause-overlay comes after #upgrades-panel in index.html
    // and would otherwise render on top and eat every click meant for an
    // upgrade card underneath it.
    this.upgradesPanel.style.display = 'flex'
    this.upgradesPanelTitle.textContent = t('upgradesPanelTitle')
    this._renderUpgradesOptions()
    this._markUpgradesSeen()
  }

  _renderUpgradesOptions() {
    this.upgradesPointsLine.textContent = t('legacyScrapLabel', { n: this.metaProgress.legacyPoints })
    this.upgradesOptions.innerHTML = ''
    for (const upgrade of PLAY_META_UPGRADES) {
      const owned = this.metaProgress.purchased.has(upgrade.id)
      const locked = !!upgrade.requires && !this.metaProgress.purchased.has(upgrade.requires)
      // Veteran's Cache pair moved here from the Coin Shop keeps its
      // lifetime-earned-coins gate (see MetaProgress.js's own comment on
      // requiresLifetimeCoins) - a second, different kind of lock from
      // `requires` above, shown with the same "locked" treatment but its
      // own distinct label (you have the Legacy Points, you just haven't
      // played long enough yet).
      const lifetimeLocked = !!upgrade.requiresLifetimeCoins && this.careerStats.lifetimeCoinsEarned < upgrade.requiresLifetimeCoins
      const btn = document.createElement('button')
      btn.className = (locked || lifetimeLocked) ? 'perk-option locked' : 'perk-option'
      btn.disabled = owned || locked || lifetimeLocked || this.metaProgress.legacyPoints < upgrade.cost
      const costLine = owned
        ? t('upgradesOwned')
        : locked
          ? t('upgradesRequires', { name: t(META_UPGRADES.find((u) => u.id === upgrade.requires)?.titleKey) })
          : lifetimeLocked
            ? t('cacheLifetimeLocked', { have: _safeStatNumber(this.careerStats.lifetimeCoinsEarned), need: upgrade.requiresLifetimeCoins })
            : t('perkCostLabel', { n: upgrade.cost })
      btn.innerHTML = `
        <span class="perk-name">${t(upgrade.titleKey)}</span>
        <span class="perk-cost">${costLine}</span>
      `
      btn.addEventListener('click', () => {
        if (owned || locked || lifetimeLocked || this.metaProgress.legacyPoints < upgrade.cost) return
        this.metaProgress.legacyPoints -= upgrade.cost
        this.metaProgress.purchased.add(upgrade.id)
        saveMetaProgress(this.metaProgress)
        this._renderUpgradesOptions()
        this._updateUpgradesDot()
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
  }

  // Quests panel - tiered career-kill and best-killstreak goals, each a
  // one-time coin reward (see Quests.js for the exact tiers/amounts).
  // Uses real clickable buttons (unlike Achievements/Bestiary above,
  // which are pure display) since completed-but-unclaimed quests need a
  // Claim action - one delegated click listener on the container handles
  // every quest button rather than rebinding per-button on every render.
  _openQuestsPanel() {
    this._closeAllMenuPanels()
    this.questsPanel.style.display = 'flex'
    // The X/Y claimed count used to live on the homepage nav button, then
    // briefly moved into the panel title on open - removed per direct
    // follow-up request, not shown anywhere any more.
    this.questsPanelTitle.textContent = t('questsPanelTitle')
    this.rollingQuestsSubtitle.textContent = t('rollingQuestsSubtitle')
    if (this.monthlyQuestsPlaceholder) this.monthlyQuestsPlaceholder.textContent = t('monthlyQuestsPlaceholder')
    if (this.yearlyQuestsPlaceholder) this.yearlyQuestsPlaceholder.textContent = t('yearlyQuestsPlaceholder')
    this._renderQuestsPanel()
    this._renderRollingQuestsPanel()
    this._markQuestsSeen()
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
  // RollingQuests.js): a GLOBAL rotation of 5 quests every 30 minutes
  // (all still-alive ones shown at once, each expiring 3 hours after its
  // spawn window), computed deterministically from wall-clock time rather than
  // per-player spawn history - every player sees the same quests at the
  // same real-world moment, reset on schedule whether or not anyone was
  // online to trigger it. refresh() just prunes expired local
  // progress/claim records; it doesn't need its own always-running timer
  // loop since the active set itself is recomputed fresh on every call.
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
    this._closeAllMenuPanels()
    this.sharePanel.style.display = 'flex'
    if (this.sharePanelTitle) this.sharePanelTitle.textContent = t('sharePanelTitle')
    if (this.settings.shareTelemetry) CloudSync.incrementTelemetry('shareUsed').catch(() => {})
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
    this._updateQuestsDot()
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
    saveShopProgress(this)
    this._showHomepageToast(t('rollingQuestClaimedToast', { coins: reward.coins, xp: reward.xp }))
    this._renderRollingQuestsPanel()
    this._updateQuestsDot()
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
    this._closeAllMenuPanels()
    this.achievementsPanel.style.display = 'flex'
    // Same move as the Quests panel title above - the X/Y count used to
    // live on the homepage nav button, now shown here instead when the
    // panel is actually open.
    const bestiaryTotal = Object.keys(ZOMBIE_TYPES).length
    const unlocked = this.achievements.unlocked.size + this.bestiaryEncountered.size
    const total = ACHIEVEMENTS.length + bestiaryTotal
    this.achievementsPanelTitle.textContent = `${t('achievementsPanelTitle')} (${unlocked}/${total})`
    if (this.achievementsFilterInput) this.achievementsFilterInput.placeholder = t('achievementsFilterPlaceholder')
    this._renderAchievementsPanel()
    this._markAchievementsSeen()
  }

  _renderAchievementsPanel() {
    const deathmatch = this._achievementsMode === 'deathmatch'
    if (this.achievementsFilterInput) this.achievementsFilterInput.style.display = deathmatch ? 'none' : ''
    if (this.achievementsControlsRow) this.achievementsControlsRow.style.display = deathmatch ? 'none' : ''
    if (this.printAchievementsBtn) this.printAchievementsBtn.style.display = deathmatch ? 'none' : ''
    this.achievementsOptions.style.display = deathmatch ? 'none' : ''
    if (this.achievementsDeathmatchPlaceholder) {
      this.achievementsDeathmatchPlaceholder.style.display = deathmatch ? '' : 'none'
      this.achievementsDeathmatchPlaceholder.textContent = t('menuInventoryPlaceholder')
    }
    if (deathmatch) return

    const filter = (this.achievementsFilterInput?.value || '').trim().toLowerCase()
    const category = this.achievementsCategorySelect?.value || 'all'
    const sortMode = this.achievementsSortSelect?.value || 'default'
    let list = ACHIEVEMENTS.filter((ach) => category === 'all' || ach.category === category)
    // Achieved/Incomplete - a straight filter on unlock state, not a sort
    // (replaced the old Unlock Date sort per direct request). Applied to
    // the bestiary loop below too via the same `known` check, since both
    // lists share this one sort control.
    if (sortMode === 'achieved') list = list.filter((ach) => this.achievements.unlocked.has(ach.id))
    else if (sortMode === 'incomplete') list = list.filter((ach) => !this.achievements.unlocked.has(ach.id))
    this.achievementsOptions.innerHTML = ''
    for (const ach of list) {
      const unlocked = this.achievements.unlocked.has(ach.id)
      const name = unlocked ? t(ach.titleKey) : '???'
      if (filter && !name.toLowerCase().includes(filter)) continue
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = true
      // Chain preview - only for an achievement that's both unlocked and
      // has a defined next tier still locked, so it reads as "here's
      // what's next," not a spoiler of a locked achievement's own name.
      const nextId = ACHIEVEMENT_CHAINS[ach.id]
      const next = nextId && unlocked && !this.achievements.unlocked.has(nextId) ? ACHIEVEMENTS.find((a) => a.id === nextId) : null
      btn.innerHTML = `
        <span class="perk-name">${name}</span>
        <span class="perk-cost">${unlocked ? t('achievementUnlockedShort') : (ach.hintKey ? t(ach.hintKey) : t('achievementLocked'))}</span>
        ${next ? `<span class="perk-lore">${_escapeHtml(t('achievementChainNext', { name: t(next.titleKey) }))}</span>` : ''}
      `
      this.achievementsOptions.appendChild(btn)
    }
    for (const type of Object.values(ZOMBIE_TYPES)) {
      const known = this.bestiaryEncountered.has(type.id)
      if (sortMode === 'achieved' && !known) continue
      if (sortMode === 'incomplete' && known) continue
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
      this.achievementsOptions.appendChild(btn)
    }
  }

  _closeAchievementsPanel() {
    this.achievementsPanel.style.display = 'none'
  }

  // Shared by both nickname pencils (corner badge + Player showcase panel)
  // - reveals the same #nickname-row (hidden by default) and focuses the
  // input, rather than each pencil building its own edit surface. A normal,
  // reusable edit - not a one-time-only lock.
  _revealNicknameEditor() {
    if (!this.nicknameRow || !this.nicknameInput) return
    this.nicknameRow.style.display = 'flex'
    this.nicknameInput.focus()
    this.nicknameInput.select()
  }

  // Confirms whatever's currently in the nickname box (typed or a Random
  // preview) as the real saved nickname, then closes the editor row.
  _confirmNicknameEdit() {
    if (!this.nicknameRow || !this.nicknameInput) return
    // .trim() - see the live 'input' listener's own comment on this same
    // fix, right below #nickname-input's other binding.
    this.settings.nickname = this.nicknameInput.value.trim()
    saveSettings(this.settings)
    this._renderPlayerTag()
    this.nicknameRow.style.display = 'none'
    this.nicknameInput.blur()
  }

  // Difficulty/Choose Class/Game Modes/Challenges & Mutators - used to be
  // spread across the homepage's left column and #menu-cards-row, moved
  // into their own panel instead. Purely static toggle content (every
  // control already has its own change listener bound elsewhere, same
  // elements/ids, just relocated) - no render step needed on open, unlike
  // Achievements/Upgrades.
  _openHubPanel() {
    if (!this.hubPanel) return
    this._closeAllMenuPanels()
    this.hubPanel.style.display = 'flex'
    if (this.hubPanelTitle) this.hubPanelTitle.textContent = t('hubPanelTitle')
  }

  _closeHubPanel() {
    if (this.hubPanel) this.hubPanel.style.display = 'none'
  }

  _closeComingSoonPanel() {
    if (this.comingSoonPanel) this.comingSoonPanel.style.display = 'none'
  }

  // The sidebar's HUB nav button opens this (see hubBtn's listener) -
  // distinct from _openHubPanel(), an older, differently-scoped panel
  // (Player/Difficulty/Choose Class/Game Modes/Challenges) only reachable
  // from the homepage's "Game Mode" button, not the sidebar at all.
  _openClanPanel() {
    if (!this.clanPanel) return
    this._closeAllMenuPanels()
    this.clanPanel.style.display = 'flex'
    if (this.clanPanelTitle) this.clanPanelTitle.textContent = t('hubBtn')
    // Defaults to the General tab every time the panel opens, same
    // "always reopen on the first tab" convention as Inventory's tabs.
    for (const tabEl of document.querySelectorAll('.general-tab')) tabEl.classList.toggle('active', tabEl.dataset.generalPage === 'general')
    for (const page of document.querySelectorAll('.general-tab-page')) page.style.display = page.id === 'general-page-general' ? 'block' : 'none'
    this._refreshClanUi()
  }

  _closeClanPanel() {
    if (this.clanPanel) this.clanPanel.style.display = 'none'
  }

  // Friends - the existing Compare-with-a-Friend feature (see CloudSaveUI's
  // renderCloudSaveState, which toggles friendsSignedOut/friendsSignedIn
  // alongside the Cloud Save panel's own signed-in state), moved here from
  // inside the Cloud Save panel so it's a first-class nav destination.
  // Same underlying settings.savedFriends/CloudSync lookups, just relocated
  // markup - no behavior change to the feature itself.
  async _openFriendsPanel() {
    if (!this.friendsPanel) return
    this._closeAllMenuPanels()
    this.friendsPanel.style.display = 'flex'
    if (this.friendsPanelTitle) this.friendsPanelTitle.textContent = t('friendsPanelTitle')
    // See _authReadyPromise's own comment (Game.js constructor) - same
    // false-signed-out race the Profile panel had.
    await this._authReadyPromise
    // Re-sync signed-in/signed-out visibility against the CURRENT
    // _cloudProfile every time the panel opens, rather than trusting
    // whatever was last rendered - previously this only happened when the
    // Cloud Save panel itself was open (see renderCloudSaveState's caller
    // in restoreCloudSession), so Friends could keep showing a stale
    // "Sign in with Google" view after navigating away and back even
    // though the account was still actually signed in.
    CloudSaveUI.renderCloudSaveState(this)
    this._renderFriendRequests()
    this._renderStatusPicker()
    if (this.friendsOwnId) this.friendsOwnId.textContent = this.settings.playerId ? `#${this.settings.playerId}` : ''
    this._markFriendAcceptedSeen()
  }

  _closeFriendsPanel() {
    if (this.friendsPanel) this.friendsPanel.style.display = 'none'
    if (this.statusPicker) this.statusPicker.classList.remove('open')
  }

  // Inventory - homepage placeholder only for now, no functionality yet
  // (distinct from the in-game Tab inventory - #inventory-panel - which
  // already exists and does something different: managing the run's
  // equipped weapons/hotbar mid-game).
  _openMenuInventoryPanel() {
    if (!this.menuInventoryPanel) return
    this._closeAllMenuPanels()
    this.menuInventoryPanel.style.display = 'flex'
    this._claimMarketSales()
    if (this.menuInventoryPanelTitle) this.menuInventoryPanelTitle.textContent = t('menuInventoryPanelTitle')
    if (this.inventoryTabCharacter) this.inventoryTabCharacter.textContent = t('inventorySkinsTitle')
    if (this.inventoryTabCrates) this.inventoryTabCrates.textContent = t('inventoryCratesTitle')
    if (this.inventoryTabWeapons) this.inventoryTabWeapons.textContent = t('inventoryWeaponsTitle')
    if (this.inventoryTabTheme) this.inventoryTabTheme.textContent = t('tabTheme')
    this._renderCrateTiers()
    if (this.invSkinSearch) {
      this.invSkinSearch.value = ''
      this.invSkinSearch.placeholder = t('inventorySkinSearch')
    }
    this._renderInventorySkins()
    this._renderInventorySkinPreview()
    this._renderInventoryWeapons()
    // Always reopen on the Character tab - simpler than remembering the
    // last-used one, and matches this panel's own approved design.
    for (const tabEl of document.querySelectorAll('.inventory-tab')) tabEl.classList.toggle('active', tabEl === this.inventoryTabCharacter)
    for (const page of document.querySelectorAll('.inventory-tab-page')) page.style.display = page.id === 'inventory-page-character' ? 'block' : 'none'
  }

  // Character tab of the Inventory panel - Kirka-style card grid (see
  // INVENTORY_SKINS): every owned skin is a card with its front-view
  // picture, rarity bar and count; clicking one opens Equip/Inspect.
  _inventorySkinEntries() {
    const custom = this.settings.customSkinDataUrl
    const entries = INVENTORY_SKINS
      .map((skin) => ({ ...skin, name: skin.nameKey ? t(skin.nameKey) : skin.name, owned: skin.count(this) }))
      .filter((skin) => skin.owned > 0)
    if (custom && !INVENTORY_SKINS.some((skin) => skin.dataUrl === custom)) {
      entries.unshift({ id: 'custom', name: t('skinCustom'), rarity: 'common', dataUrl: custom, owned: 1 })
    }
    return entries
  }

  // Market cards: one per active player listing, joined with the skin it
  // sells (listings for a skin id this build doesn't know are skipped).
  _marketSkinEntries() {
    if (!Array.isArray(this._marketListings)) return []
    const out = []
    for (const listing of this._marketListings) {
      const skin = INVENTORY_SKINS.find((s) => s.id === listing.skinId)
      if (!skin) continue
      out.push({
        ...skin,
        name: skin.nameKey ? t(skin.nameKey) : skin.name,
        listing,
        price: _safeStatNumber(listing.price),
        mine: !!this._cloudUid && listing.sellerUid === this._cloudUid,
      })
    }
    return out
  }

  // The shared Market backend - Firestore via CloudSync, or an in-memory
  // fake a Playwright test puts on game.__marketBackendForTests.
  _marketApi() {
    return this.__marketBackendForTests || CloudSync
  }

  async _loadMarketListings() {
    if (!this.__marketBackendForTests && !CloudSync.isConfigured()) {
      this._marketListings = 'error'
      this._renderShopMarket()
      return
    }
    try {
      this._marketListings = await this._marketApi().fetchActiveMarketListings()
    } catch (err) {
      console.warn('Market listings failed to load', err)
      this._marketListings = 'error'
    }
    if (this.marketPanel?.style.display !== 'none') this._renderShopMarket()
  }

  // Market panel (its own nav button, right under Store): opened like every
  // other menu panel.
  _openMarketPanel() {
    this._closeAllMenuPanels()
    if (!this.marketPanel) return
    this.marketPanel.style.display = 'flex'
    if (this.marketPanelTitle) this.marketPanelTitle.textContent = t('skinModeMarket')
    this._marketQuery = ''
    this._marketItems = null
    this._marketRarity = 'all'
    if (this.marketSearch) {
      this.marketSearch.value = ''
      this.marketSearch.placeholder = t('marketSearchPlaceholder')
    }
    this._closeMarketFilterMenus()
    this._renderMarketFilters()
    this._marketListings = null
    this._renderShopMarket()
    this._loadMarketListings()
    this._claimMarketSales()
  }

  // Items you can filter by: Character, then every weapon (Kirka's market
  // lists every weapon the same way). Market skins without a `kind` are
  // character skins.
  _marketItemOptions() {
    const weapons = this.weapons.getSummary()
      .map((w) => ({ id: w.id, label: t(w.nameKey) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [{ id: 'character', label: t('marketItemCharacter') }, ...weapons]
  }

  _renderMarketFilters() {
    const items = this._marketItemOptions()
    const ticked = this._marketItems || new Set(items.map((i) => i.id))
    if (this.marketItemFilterBtn) {
      const count = items.filter((i) => ticked.has(i.id)).length
      this.marketItemFilterBtn.textContent = count === items.length
        ? t('marketItemsAll')
        : t('marketItemsCount', { n: count })
    }
    if (this.marketItemFilterMenu) {
      this.marketItemFilterMenu.innerHTML = items.map((i) =>
        `<button type="button" class="market-filter-option${ticked.has(i.id) ? ' checked' : ''}" data-market-item="${_escapeHtml(i.id)}">`
        + `<span class="market-check"></span><span>${_escapeHtml(i.label)}</span></button>`).join('')
    }
    // Mythic left out - no skin uses it.
    const rarities = ['all', ...Object.keys(SKIN_RARITIES).filter((r) => r !== 'mythic')]
    const rarityLabel = (r) => (r === 'all' ? t('marketRarityAll') : t(SKIN_RARITIES[r].key))
    if (this.marketRarityFilterBtn) this.marketRarityFilterBtn.textContent = rarityLabel(this._marketRarity)
    if (this.marketRarityFilterMenu) {
      this.marketRarityFilterMenu.innerHTML = rarities.map((r) =>
        `<button type="button" class="market-filter-option${r === this._marketRarity ? ' active' : ''}" data-market-rarity="${r}"`
        + (r === 'all' ? '' : ` style="color: ${SKIN_RARITIES[r].color}"`) + `>${_escapeHtml(rarityLabel(r))}</button>`).join('')
    }
  }

  _closeMarketFilterMenus() {
    for (const [btn, menu] of [[this.marketItemFilterBtn, this.marketItemFilterMenu], [this.marketRarityFilterBtn, this.marketRarityFilterMenu]]) {
      if (menu) menu.style.display = 'none'
      if (btn) btn.classList.remove('open')
    }
  }

  _toggleMarketFilterMenu(btn, menu) {
    const opening = menu.style.display === 'none'
    this._closeMarketFilterMenus()
    if (opening) {
      menu.style.display = 'block'
      btn.classList.add('open')
    }
  }

  _closeMarketPanel() {
    if (this.marketPanel) this.marketPanel.style.display = 'none'
  }

  // Market panel grid: a card per skin with its price (or Owned); clicking
  // one buys it. Same card look as Inventory > Character.
  _renderShopMarket() {
    if (!this.shopMarketGrid) return
    if (this._marketListings === null || this._marketListings === 'error') {
      this.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t(this._marketListings === null ? 'marketLoading' : 'marketError'))}</p>`
      return
    }
    if (!this._marketListings.length) {
      this.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('marketEmpty'))}</p>`
      return
    }
    const query = this._marketQuery.trim().toLowerCase()
    const entries = this._marketSkinEntries().filter((skin) =>
      (!query || skin.name.toLowerCase().includes(query))
      && (!this._marketItems || this._marketItems.has(skin.kind || 'character'))
      && (this._marketRarity === 'all' || skin.rarity === this._marketRarity))
    if (!entries.length) {
      this.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('skinNoMatch'))}</p>`
      return
    }
    // Seller names come from other players' writes - escaped like any
    // other untrusted text.
    this.shopMarketGrid.innerHTML = entries.map((skin) => {
      const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
      const classes = ['inv-skin-card']
      if (skin.mine) classes.push('owned')
      else if (this.coins < skin.price) classes.push('cant-afford')
      const label = skin.mine ? t('marketYours') : this._formatSkinPrice('coins', skin.price)
      const listingId = String(skin.listing.id).replace(/[^A-Za-z0-9_-]/g, '')
      return `<button type="button" class="${classes.join(' ')}" data-market-listing="${listingId}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${skin.name} - ${t(rarity.key)}`)}">`
        + `<span class="inv-skin-card-name">${_escapeHtml(skin.name)}</span>`
        + '<img class="inv-skin-card-img" alt="" draggable="false" />'
        + `<span class="market-card-seller">${_escapeHtml(t('marketSellerBy', { name: String(skin.listing.sellerName || '').slice(0, 24) }))}</span>`
        + `<span class="inv-skin-card-price">${_escapeHtml(skin.mine ? `${label} · ${this._formatSkinPrice('coins', skin.price)}` : label)}</span>`
        + '</button>'
    }).join('')
    for (const skin of entries) {
      skinFrontIconURL(skin.dataUrl).then((url) => {
        const listingId = String(skin.listing.id).replace(/[^A-Za-z0-9_-]/g, '')
        const img = this.shopMarketGrid.querySelector(`[data-market-listing="${listingId}"] .inv-skin-card-img`)
        if (img && url) img.src = url
      })
    }
  }

  // Takes one copy of a skin out of / puts one into this player's own save.
  async _removeSkinFromInventory(id) {
    if (id === this._equippedInventorySkinId()) await this._equipInventorySkin('default')
    if (id === 'gaygarx') this.ownsShopSkin = false
    else this.charSkins[id] = Math.max(0, (Number(this.charSkins[id]) || 0) - 1)
  }

  _addSkinToInventory(id) {
    if (id === 'gaygarx') this.ownsShopSkin = true
    else this.charSkins[id] = (Number(this.charSkins[id]) || 0) + 1
  }

  _afterTradeChange() {
    saveShopProgress(this)
    this._renderCurrencyBar()
    if (this._renderShopSkinState) this._renderShopSkinState()
    if (this.menuInventoryPanel?.style.display !== 'none') {
      this._renderInventorySkins()
      this._renderInventorySkinPreview()
    }
    if (this.marketPanel?.style.display !== 'none') this._renderShopMarket()
  }

  // Market fee: 5% of the asking price, taken from what the seller gets.
  _marketFee(price) {
    return Math.ceil(price * MARKET_FEE_RATE)
  }

  // One Kirka-style dialog for every trade action. mode: 'list' (price
  // picker), 'sell' (sell to the game), 'buy' or 'cancel' (a listing).
  _openTradeDialog(mode, opts) {
    if (!this.tradeDialog) return
    this._tradeDialogState = { mode, ...opts }
    const priceMode = mode === 'list'
    this.tradeDialogPriceRow.style.display = priceMode ? '' : 'none'
    this.tradeDialogFee.style.display = priceMode ? '' : 'none'
    this.tradeDialogAction.className = `trade-action-${mode}`
    if (priceMode) {
      this.tradeDialogPrice.value = String(opts.startPrice)
      this.tradeDialogTitle.textContent = t('marketListTitle', { name: opts.name })
      this.tradeDialogAction.textContent = t('marketAddBtn')
      this._updateTradeDialogFee()
    } else if (mode === 'sell') {
      this.tradeDialogTitle.textContent = t('marketSellTitle', { name: opts.name, price: opts.priceLabel })
      this.tradeDialogAction.textContent = t('marketSellBtn')
    } else if (mode === 'buy') {
      this.tradeDialogTitle.textContent = t('marketBuyTitle', { name: opts.name, seller: opts.seller, price: opts.priceLabel })
      this.tradeDialogAction.textContent = t('marketBuyBtn')
    } else {
      this.tradeDialogTitle.textContent = t('marketCancelTitle', { name: opts.name })
      this.tradeDialogAction.textContent = t('marketCancelBtn')
    }
    this.tradeDialogAction.disabled = false
    this.tradeDialog.style.display = 'flex'
  }

  _closeTradeDialog() {
    if (this.tradeDialog) this.tradeDialog.style.display = 'none'
    this._tradeDialogState = null
  }

  _tradeDialogPriceValue() {
    const n = Math.floor(Number(this.tradeDialogPrice.value))
    return Number.isFinite(n) ? Math.max(1, Math.min(10000000, n)) : 1
  }

  _updateTradeDialogFee() {
    const fee = this._marketFee(this._tradeDialogPriceValue())
    this.tradeDialogFee.textContent = t('marketFee', { fee: fee.toLocaleString() })
  }

  _stepTradeDialogPrice(dir) {
    const p = this._tradeDialogPriceValue()
    const step = p >= 100000 ? 10000 : p >= 10000 ? 1000 : p >= 1000 ? 100 : 10
    this.tradeDialogPrice.value = String(Math.max(1, Math.min(10000000, p + dir * step)))
    this._updateTradeDialogFee()
  }

  // Signed-in account needed for anything that touches the shared Market.
  async _marketUid() {
    await this._authReadyPromise
    if (!this._cloudUid) {
      this._showHomepageToast(t('marketSignInNeeded'))
      return null
    }
    return this._cloudUid
  }

  async _confirmTradeDialog() {
    const st = this._tradeDialogState
    if (!st) return
    this.tradeDialogAction.disabled = true
    try {
      if (st.mode === 'sell') await this._sellSkinToGame(st.id)
      else if (st.mode === 'list') await this._listSkinOnMarket(st.id, this._tradeDialogPriceValue())
      else if (st.mode === 'buy') await this._buyMarketListing(st.listing)
      else if (st.mode === 'cancel') await this._cancelMarketListing(st.listing)
    } finally {
      this._closeTradeDialog()
    }
  }

  async _listSkinOnMarket(id, price) {
    const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
    if (!entry?.sell || !(entry.count(this) > 0)) return
    const uid = await this._marketUid()
    if (!uid) return
    const name = entry.nameKey ? t(entry.nameKey) : entry.name
    // Out of the inventory first, so it can't be equipped/sold twice while
    // the listing is being written; put back if the write fails.
    await this._removeSkinFromInventory(id)
    this._afterTradeChange()
    try {
      const seller = (this.settings.nickname || '').trim().slice(0, 24) || this._defaultNickname().slice(0, 24)
      await this._marketApi().createMarketListing(uid, seller, id, price)
      this._showHomepageToast(t('marketListedToast', { name }))
    } catch (err) {
      console.warn('Listing failed', err)
      this._addSkinToInventory(id)
      this._afterTradeChange()
      this._showHomepageToast(t('marketError'))
    }
  }

  async _buyMarketListing(listing) {
    const entry = INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
    const price = _safeStatNumber(listing.price)
    if (!entry || !(price > 0)) return
    if (this.coins < price) {
      this._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - this.coins).toLocaleString() }))
      return
    }
    const uid = await this._marketUid()
    if (!uid) return
    let bought
    try {
      bought = await this._marketApi().buyMarketListing(listing.id, uid)
    } catch (err) {
      console.warn('Buying failed', err)
      this._showHomepageToast(t('marketError'))
      return
    }
    if (!bought) {
      this._showHomepageToast(t('marketAlreadySold'))
    } else {
      this.coins -= price
      this._addSkinToInventory(entry.id)
      this._afterTradeChange()
      this._showHomepageToast(t('skinBoughtToast', { name: entry.nameKey ? t(entry.nameKey) : entry.name }))
    }
    this._loadMarketListings()
  }

  async _cancelMarketListing(listing) {
    const uid = await this._marketUid()
    if (!uid) return
    let cancelled
    try {
      cancelled = await this._marketApi().cancelMarketListing(listing.id, uid)
    } catch (err) {
      console.warn('Cancel failed', err)
      this._showHomepageToast(t('marketError'))
      return
    }
    const entry = INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
    if (cancelled && entry) {
      this._addSkinToInventory(entry.id)
      this._afterTradeChange()
      this._showHomepageToast(t('marketCancelledToast', { name: entry.nameKey ? t(entry.nameKey) : entry.name }))
    } else if (!cancelled) {
      this._showHomepageToast(t('marketAlreadySold'))
    }
    this._loadMarketListings()
  }

  // Pays the seller for listings other players bought while they were away
  // - each sale is claimed in a transaction, so it pays out exactly once
  // even with two devices open. Runs when the Market or Inventory opens.
  async _claimMarketSales() {
    if (this._claimingMarketSales || (!this.__marketBackendForTests && !CloudSync.isConfigured())) return
    this._claimingMarketSales = true
    try {
      await this._authReadyPromise
      const uid = this._cloudUid
      if (!uid) return
      const sales = await this._marketApi().fetchUnclaimedMarketSales(uid)
      for (const sale of sales) {
        const claimed = await this._marketApi().claimMarketSale(sale.id, uid).catch(() => null)
        if (!claimed) continue
        const price = _safeStatNumber(claimed.price)
        const earned = Math.max(0, price - this._marketFee(price))
        this.coins += earned
        saveShopProgress(this)
        this._renderCurrencyBar()
        const entry = INVENTORY_SKINS.find((skin) => skin.id === claimed.skinId)
        const name = entry ? (entry.nameKey ? t(entry.nameKey) : entry.name) : String(claimed.skinId)
        this._showHomepageToast(t('marketSoldToast', { name, price: this._formatSkinPrice('coins', earned) }))
      }
    } catch (err) {
      console.warn('Collecting Market sales failed', err)
    } finally {
      this._claimingMarketSales = false
    }
  }

  _formatSkinPrice(currency, amount) {
    const n = Math.floor(amount).toLocaleString()
    return currency === 'gems' ? t('skinPriceGems', { n }) : t('skinPriceCoins', { n })
  }

  _equippedInventorySkinId() {
    const custom = this.settings.customSkinDataUrl
    if (!custom) return 'default'
    return INVENTORY_SKINS.find((skin) => skin.dataUrl === custom)?.id || 'custom'
  }

  _renderInventorySkins() {
    if (!this.inventorySkinsList) return
    this._closeInventorySkinMenu()
    const equippedId = this._equippedInventorySkinId()
    const query = (this.invSkinSearch?.value || '').trim().toLowerCase()
    const entries = this._inventorySkinEntries().filter((skin) => !query || skin.name.toLowerCase().includes(query))
    if (!entries.length) {
      this.inventorySkinsList.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('skinNoMatch'))}</p>`
      return
    }
    this.inventorySkinsList.innerHTML = entries.map((skin) => {
      const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
      const classes = ['inv-skin-card']
      if (skin.id === equippedId) classes.push('equipped')
      return `<button type="button" class="${classes.join(' ')}" data-inventory-skin="${skin.id}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${skin.name} - ${t(rarity.key)}`)}">`
        + `<span class="inv-skin-card-name">${_escapeHtml(skin.name)}</span>`
        + '<img class="inv-skin-card-img" alt="" draggable="false" />'
        + `<span class="inv-skin-card-count">${_safeStatNumber(skin.owned)}</span>`
        + '</button>'
    }).join('')
    // Pictures fill in as they're drawn (cached after the first time).
    for (const skin of entries) {
      skinFrontIconURL(skin.dataUrl).then((url) => {
        const img = this.inventorySkinsList.querySelector(`[data-inventory-skin="${skin.id}"] .inv-skin-card-img`)
        if (img && url) img.src = url
      })
    }
  }

  // Big 3D preview on the left: the equipped skin.
  async _renderInventorySkinPreview() {
    const entries = this._inventorySkinEntries()
    const shownId = this._equippedInventorySkinId()
    const skin = entries.find((entry) => entry.id === shownId) || entries[0]
    const nameEl = document.getElementById('inv-skin-preview-name')
    const levelEl = document.getElementById('inv-skin-preview-level')
    const skinEl = document.getElementById('inv-skin-preview-skin')
    if (levelEl) levelEl.textContent = String(this._computeAvatarLevel())
    if (nameEl) nameEl.textContent = this.settings.nickname.trim() || this._defaultNickname()
    if (skinEl && skin) {
      const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
      skinEl.innerHTML = `${_escapeHtml(skin.name)} <span style="color: ${rarity.color}">${_escapeHtml(t(rarity.key))}</span>`
    }
    if (!this.invSkinPreviewCanvas || !skin) return
    if (!this._invSkinAvatar3D) {
      this._invSkinAvatar3D = new MenuAvatar3D(this.invSkinPreviewCanvas)
      this._invSkinAvatar3D.start()
    }
    const token = (this._invSkinPreviewToken = (this._invSkinPreviewToken || 0) + 1)
    try {
      const texture = await loadSkinTexture(skin.dataUrl)
      if (token === this._invSkinPreviewToken && this._invSkinAvatar3D) this._invSkinAvatar3D.setSkin(texture)
    } catch {
      // Unreadable texture - keep whatever the preview showed before.
    }
  }

  // The same menu serves Character cards and Weapons cards (kind
  // 'weapon': every weapon only has its Default skin so far - always
  // equipped, not tradable).
  _openInventorySkinMenu(card) {
    if (!this.invSkinMenu) return
    const kind = card.dataset.weaponCard ? 'weapon' : 'character'
    const id = kind === 'weapon' ? card.dataset.weaponCard : card.dataset.inventorySkin
    if (this._invSkinMenuFor === id && this._invSkinMenuKind === kind && this.invSkinMenu.style.display !== 'none') {
      this._closeInventorySkinMenu()
      return
    }
    this._invSkinMenuFor = id
    this._invSkinMenuKind = kind
    const entry = kind === 'character' ? INVENTORY_SKINS.find((skin) => skin.id === id) : null
    const owned = entry ? entry.count(this) : 0
    const equipped = kind === 'weapon' || id === this._equippedInventorySkinId()
    // Market (list for other players) and Sell (to the game) only on your
    // own tradable skins - never Default or an uploaded custom skin.
    this.invSkinMenuEquip.textContent = equipped ? t('skinEquipped') : t('skinEquip')
    this.invSkinMenuEquip.disabled = equipped
    this.invSkinMenuInspect.textContent = t('skinInspect')
    // Always all four buttons, like Kirka; on a skin that can't be traded
    // (Default, an uploaded skin) Market/Sell are faded and say why.
    const tradable = !!entry?.sell && owned > 0
    for (const [btn, key] of [[this.invSkinMenuMarket, 'marketListBtn'], [this.invSkinMenuSell, 'marketSellBtn']]) {
      if (!btn) continue
      btn.textContent = t(key)
      btn.classList.toggle('locked', !tradable)
      btn.setAttribute('aria-disabled', tradable ? 'false' : 'true')
    }
    // Lives next to whichever grid the card is in, and always fits inside
    // the card itself (below its name, never past its bottom edge).
    const host = card.closest('#inv-skins-side, #inventory-page-weapons') || this.invSkinMenu.parentElement
    if (this.invSkinMenu.parentElement !== host) host.appendChild(this.invSkinMenu)
    const side = host.getBoundingClientRect()
    const rect = card.getBoundingClientRect()
    this.invSkinMenu.style.display = 'flex'
    const menuH = this.invSkinMenu.offsetHeight
    const top = Math.max(rect.top + 4, Math.min(rect.top + 26, rect.bottom - menuH - 6))
    this.invSkinMenu.style.left = `${rect.left - side.left + host.scrollLeft + rect.width / 2}px`
    this.invSkinMenu.style.top = `${top - side.top + host.scrollTop}px`
  }

  _closeInventorySkinMenu() {
    if (this.invSkinMenu) this.invSkinMenu.style.display = 'none'
    this._invSkinMenuFor = null
    this._invSkinMenuKind = null
  }

  // Sell to the game for the fixed price (half the old shop price;
  // GaygarX: gems) - the confirm box is the Kirka-style trade dialog.
  _openSellDialog(id) {
    const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
    if (!entry?.sell || !(entry.count(this) > 0)) return
    const name = entry.nameKey ? t(entry.nameKey) : entry.name
    this._openTradeDialog('sell', { id, name, priceLabel: this._formatSkinPrice(entry.sell.currency, entry.sell.amount) })
  }

  _openListDialog(id) {
    const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
    if (!entry?.sell || !(entry.count(this) > 0)) return
    const name = entry.nameKey ? t(entry.nameKey) : entry.name
    this._openTradeDialog('list', { id, name, startPrice: MARKET_PRICES[entry.rarity] || 1000 })
  }

  async _sellSkinToGame(id) {
    const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
    if (!entry?.sell || !(entry.count(this) > 0)) return
    const name = entry.nameKey ? t(entry.nameKey) : entry.name
    await this._removeSkinFromInventory(id)
    if (entry.sell.currency === 'gems') this.gems += entry.sell.amount
    else this.coins += entry.sell.amount
    this._afterTradeChange()
    this._showHomepageToast(t('skinSoldToast', { name, price: this._formatSkinPrice(entry.sell.currency, entry.sell.amount) }))
  }

  // Kirka-style Inspect window: the item big in 3D (InspectViewer.js) -
  // drag to turn it, scroll/pinch to zoom. kind 'character' is a skin id,
  // 'weapon' a weapon id. A fresh canvas every time, since the viewer
  // releases its WebGL context on close and a canvas can't get one back.
  async _openInspectDialog(kind, id) {
    const dialog = document.getElementById('inspect-dialog')
    const stage = document.getElementById('inspect-stage')
    if (!dialog || !stage) return
    this._closeInspectDialog()
    let name
    let rarity = SKIN_RARITIES.common
    let owned = 1
    if (kind === 'weapon') {
      const w = this.weapons.getSummary().find((entry) => entry.id === id)
      if (!w || !this.weapons.viewmodels?.[id]) return
      name = `${t(w.nameKey)} - ${t('skinDefault')}`
    } else {
      const skin = this._inventorySkinEntries().find((entry) => entry.id === id)
      if (!skin) return
      name = skin.name
      rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
      owned = skin.owned
    }
    document.getElementById('inspect-title').textContent = t('inspectTitle', { name })
    const rarityEl = document.getElementById('inspect-rarity')
    rarityEl.textContent = t(rarity.key)
    rarityEl.style.background = rarity.color
    document.getElementById('inspect-count').textContent = t('inspectOwned', { n: Math.floor(_safeStatNumber(owned)).toLocaleString() })
    document.getElementById('inspect-hint').textContent = t('inspectHint')
    const canvas = document.createElement('canvas')
    canvas.id = 'inspect-canvas'
    stage.appendChild(canvas)
    dialog.style.display = 'flex'
    const viewer = new InspectViewer(canvas)
    this._inspectViewer = viewer
    this._inspectCharacter = null
    if (kind === 'weapon') {
      // Barrel pointing left, side-on - like Kirka's.
      viewer.setObject(this._weaponDisplayClone(this.weapons.viewmodels[id]), { yaw: Math.PI / 2, pitch: 0.12 })
    } else {
      const skin = this._inventorySkinEntries().find((entry) => entry.id === id)
      try {
        const texture = await loadSkinTexture(skin.dataUrl)
        if (this._inspectViewer !== viewer) return
        this._inspectCharacter = buildTexturedCharacter(texture)
        viewer.setObject(this._inspectCharacter, { yaw: 0.5 })
      } catch {
        // Unreadable texture - the window just stays empty.
      }
    }
    viewer.start()
  }

  _closeInspectDialog() {
    const dialog = document.getElementById('inspect-dialog')
    if (dialog) dialog.style.display = 'none'
    if (this._inspectViewer) {
      this._inspectViewer.dispose()
      this._inspectViewer = null
    }
    // The character is built just for this window; a weapon is a clone
    // sharing the game's own geometry/materials, so it's left alone.
    if (this._inspectCharacter) {
      this._inspectCharacter.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) obj.material.dispose()
      })
      this._inspectCharacter = null
    }
    document.getElementById('inspect-canvas')?.remove()
  }

  // Same skin-apply sequence _buyShopSkin/_bindSkinUpload's Reset button
  // already each use on their own equip/reset paths - kept as its own
  // separate function rather than refactoring those two (both already
  // shipped/working, each with its own extra step around this - currency
  // deduction + confirm dialog for buying, the default-bundled-skin
  // re-fetch for resetting) to avoid touching either for this.
  async _equipInventorySkin(id) {
    if (id === 'custom') return
    // Any INVENTORY_SKINS entry the player owns (other than Default) -
    // no per-skin code needed for a new one.
    const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
    if (entry && id !== 'default') {
      if (!(entry.count(this) > 0)) return
      this.settings.customSkinDataUrl = entry.dataUrl
      saveSettings(this.settings)
      const skin = await loadSkinTexture(entry.dataUrl)
      if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
      this._updateMenuAvatarPhoto(skin)
    } else {
      this.settings.customSkinDataUrl = null
      saveSettings(this.settings)
      if (this._menuAvatar3D) this._menuAvatar3D.setSkin(null)
      await this._applyDefaultBundledSkin()
    }
    // Profile's own Reset to Default button (see _bindSkinUpload) shows/
    // hides based on this same customSkinDataUrl - keep it in sync too,
    // even though it's on a different panel, since both reflect one
    // shared piece of state.
    const resetBtn = document.getElementById('reset-skin-btn')
    if (resetBtn) resetBtn.style.display = this.settings.customSkinDataUrl ? '' : 'none'
    this._renderInventorySkins()
    this._renderInventorySkinPreview()
  }

  _closeMenuInventoryPanel() {
    if (this.menuInventoryPanel) this.menuInventoryPanel.style.display = 'none'
    this._closeInspectDialog()
  }

  async _openServerPanel() {
    if (!this.serverPanel) return
    this._closeAllMenuPanels()
    this.serverPanel.style.display = 'flex'
    if (this.serverPanelTitle) this.serverPanelTitle.textContent = t('serverPanelTitle')
    // Reading chat is public (no sign-in needed - see #server-chat-wrap's
    // own CSS comment), so this starts immediately, unlike the sign-in
    // gate below.
    ChatUI.subscribeServerChat(this)
    // See _authReadyPromise's own comment (Game.js constructor) - same
    // false-"you're signed out" race Friends/Profile/Clan already guard
    // against with this same await. Without it, opening this panel
    // shortly after a page load/reload reads _cloudUid before Firebase's
    // own async session check has finished, so an already-signed-in
    // player briefly (or, since nothing re-checks afterward, sometimes
    // permanently until they open a different panel) sees the sign-in
    // prompt instead of the chat input.
    await this._authReadyPromise
    ChatUI.renderServerChatSignInState(this)
  }

  _closeServerPanel() {
    if (this.serverPanel) this.serverPanel.style.display = 'none'
    ChatUI.unsubscribeServerChat(this)
  }

  // Re-renders every static UI string in the current language. Called once
  // at startup and again whenever the player picks a different language.
  _applyLanguage() {
    // The two guide NPCs' name tags (the ammo one names the interact key).
    for (const [elId, key] of Object.entries(SIMPLE_TEXT_I18N_KEYS)) {
      const el = document.getElementById(elId)
      if (el) el.textContent = t(key)
    }
    for (const [elId, key] of Object.entries(PLACEHOLDER_I18N_KEYS)) {
      const el = document.getElementById(elId)
      if (el) el.placeholder = t(key)
    }
    for (const [selId, valueKeyMap] of Object.entries(SELECT_OPTION_I18N_KEYS)) {
      const sel = document.getElementById(selId)
      if (!sel) continue
      for (const opt of sel.options) {
        const key = valueKeyMap[opt.value]
        if (key) opt.textContent = t(key)
      }
    }
    // Settings > Language grid's own labels (LANGUAGES[].nameKey/the
    // "Coming soon" tag) - rebuilds the whole grid rather than patching
    // individual .lang-name spans, which also keeps the active-state
    // highlight correct without a separate classList loop at the call
    // site (see _bindSettings, where this is first defined).
    this._renderLanguageGrid?.()
    document.querySelectorAll('.panel-close-hint').forEach((el) => {
      if (el.id === 'touch-more-actions-hint') return
      el.textContent = t('panelGenericCloseHint')
    })
    if (this.resetProgressBtn) this.resetProgressBtn.textContent = t(this._resetProgressArmed ? 'resetProgressConfirm' : 'resetProgressLabel')
    this._updateClanMyClanTabLabel()
    const menuTaglineEl = document.getElementById('menu-tagline')
    if (menuTaglineEl) menuTaglineEl.textContent = t('menuTagline')
    document.getElementById('menu-subtitle').textContent = t('menuSubtitle')
    document.getElementById('menu-subhint').textContent = t('menuSubhint')
    this.playBtn.textContent = t('playBtn')
    if (this.continueRunBtn) this.continueRunBtn.textContent = t('continueRunBtn')
    if (this.gamemodeBtn) this.gamemodeBtn.textContent = t('gamemodeBtn')
    const languageMissingHintEl = document.getElementById('language-missing-hint')
    if (languageMissingHintEl) {
      languageMissingHintEl.innerHTML = t('languageMissingHint', {
        discord: '<a id="language-missing-discord-link" href="https://discord.gg/kukR72Euj6" target="_blank" rel="noopener noreferrer">Discord</a>'
      })
    }
    // Menu redesign - these 5 buttons now hold an <svg> icon + <span> label
    // (settings is icon-only). Setting .textContent on the BUTTON itself
    // would wipe out the icon entirely (it replaces every child with one
    // text node) - target the inner <span>/aria-label instead.
    this.settingsBtn.setAttribute('aria-label', t('settingsBtn'))
    this.upgradesBtn.querySelector('span').textContent = t('upgradesBtn')
    this.questsBtn.querySelector('span').textContent = t('questsBtn')
    this.achievementsBtn.querySelector('span').textContent = t('achievementsBtn')
    this.coinshopBtn.querySelector('span').textContent = t('coinshopBtn')
    if (this.marketBtn) this.marketBtn.querySelector('span').textContent = t('skinModeMarket')
    if (this.hubBtn) this.hubBtn.querySelector('span').textContent = t('hubBtn')
    if (this.howtoplayNavLink) this.howtoplayNavLink.querySelector('span').textContent = t('howtoplayPanelTitle')
    if (this.whatsNewLink) this.whatsNewLink.querySelector('span').textContent = t('navLinkWhatsNew')
    const designSkinLinkEl = document.getElementById('nav-designskin-link')
    if (designSkinLinkEl) designSkinLinkEl.querySelector('span').textContent = t('navLinkDesignSkin')
    if (this.creditsBtn) this.creditsBtn.querySelector('span').textContent = t('creditsBtn')
    const termsBtnEl = document.getElementById('terms-btn')
    if (termsBtnEl) termsBtnEl.querySelector('span').textContent = t('termsBtn')
    const navPrivacyEl = document.getElementById('nav-privacy-link')
    if (navPrivacyEl) navPrivacyEl.querySelector('span').textContent = t('creditsPrivacyLink')
    if (this.friendsBtn) this.friendsBtn.querySelector('span').textContent = t('friendsBtn')
    if (this.friendsSignedOutDesc) this.friendsSignedOutDesc.textContent = t('friendsSignedOutDesc')
    if (this.friendsSigninBtn) this.friendsSigninBtn.textContent = t('cloudsaveSigninBtn')
    if (this.menuInventoryBtn) this.menuInventoryBtn.querySelector('span').textContent = t('menuInventoryBtn')
    if (this.serverBtn) this.serverBtn.querySelector('span').textContent = t('serverBtn')

    document.getElementById('ctrl-line-1').innerHTML = tHtml('ctrlLine1')
    document.getElementById('ctrl-line-2').innerHTML = tHtml('ctrlLine2')
    document.getElementById('ctrl-line-3').innerHTML = tHtml('ctrlLine3')
    document.getElementById('ctrl-line-4').innerHTML = tHtml('ctrlLine4')
    document.getElementById('ctrl-line-5').innerHTML = tHtml('ctrlLine5')


    document.getElementById('settings-title').textContent = t('settingsTitle')
    document.getElementById('tab-general').textContent = t('tabGeneral')
    document.getElementById('tab-language').textContent = t('tabLanguage')
    document.getElementById('tab-audio').textContent = t('tabAudio')
    document.getElementById('tab-controls').textContent = t('tabControls')
    document.getElementById('tab-graphics').textContent = t('tabGraphics')
    if (this.buildModeBtn) this.buildModeBtn.querySelector('span').textContent = t('mapEditorBtn')
    const fullmapTitleEl = document.getElementById('fullmap-title')
    if (fullmapTitleEl) fullmapTitleEl.textContent = t('fullmapTitle')
    const journalPanelTitleEl = document.getElementById('journal-panel-title')
    if (journalPanelTitleEl) journalPanelTitleEl.textContent = t('journalPanelTitle')
    const generalPlaceholder = document.getElementById('settings-general-placeholder')
    if (generalPlaceholder) generalPlaceholder.textContent = t('settingsGeneralPlaceholder')
    this.resetBindsBtn.textContent = t('resetBinds')
    this._renderControlsGrid()
    // Local Sharing batch - static settings-panel labels.
    this.exportSaveBtn.textContent = t('exportSaveBtn')
    this.importSaveBtn.textContent = t('importSaveBtn')
    this.compareSaveBtn.textContent = t('compareSaveBtn')
    this.clearLeaderboardsBtn.textContent = t('clearLeaderboardsBtn')
    document.getElementById('guest-mode-label').textContent = t('guestModeLabel')
    this._updateStorageUsageLine()
    document.getElementById('sfx-label').textContent = t('sfxLabel')
    document.getElementById('sensitivity-label').textContent = t('sensitivityLabel')
    document.getElementById('fov-label').textContent = t('fovLabel')
    document.getElementById('colorblind-label').textContent = t('colorblindLabel')
    document.getElementById('performance-label').textContent = t('performanceLabel')
    document.getElementById('performance-troubleshoot-hint').textContent = t('performanceModeTroubleshootHint')




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
    document.getElementById('mutator-escalation-label').textContent = t('mutatorEscalation')
    document.getElementById('mutator-cursed-run-label').textContent = t('mutatorCursedRun')
    document.getElementById('mutator-randomizer-label').textContent = t('mutatorRandomizer')
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
    document.getElementById('recoil-shake-label').textContent = t('recoilShakeLabel')
    document.getElementById('damage-shake-label').textContent = t('damageShakeLabel')
    document.getElementById('ambient-volume-label').textContent = t('ambientVolumeLabel')
    document.getElementById('mute-on-blur-label').textContent = t('muteOnBlurLabel')
    document.getElementById('positional-audio-label').textContent = t('positionalAudioLabel')
    document.getElementById('ads-fov-label').textContent = t('adsFovLabel')
    document.getElementById('mouse-acceleration-label').textContent = t('mouseAccelerationLabel')
    document.getElementById('invert-scroll-label').textContent = t('invertScrollLabel')
    document.getElementById('double-click-speed-label').textContent = t('doubleClickSpeedLabel')
    document.getElementById('fps-cap-label').textContent = t('fpsCapLabel')
    document.getElementById('motion-blur-label').textContent = t('motionBlurLabel')
    document.getElementById('auto-quality-label').textContent = t('autoQualityLabel')
    document.getElementById('kill-feed-position-label').textContent = t('killFeedPositionLabel')
    document.getElementById('kill-feed-verbosity-label').textContent = t('killFeedVerbosityLabel')
    document.getElementById('kill-feed-icons-label').textContent = t('killFeedIconsLabel')
    document.getElementById('compass-style-label').textContent = t('compassStyleLabel')
    document.getElementById('touch-controls-override-label').textContent = t('touchControlsOverrideLabel')
    document.getElementById('touch-controls-override-hint').textContent = t('touchControlsOverrideHint')
    document.getElementById('weapon-name-hud-label').textContent = t('weaponNameHudLabel')
    document.getElementById('minimap-zoom-label').textContent = t('minimapZoomLabel')
    document.getElementById('friend-presence-notify-label').textContent = t('friendPresenceNotifyLabel')
    document.getElementById('daily-challenge-reminder-label').textContent = t('dailyChallengeReminderLabel')
    document.getElementById('time-format-label').textContent = t('timeFormatLabel')
    document.getElementById('autosave-frequency-label').textContent = t('autosaveFrequencyLabel')
    document.getElementById('hud-fps-label').textContent = t('hudFpsLabel')
    document.getElementById('ammo-position-label').textContent = t('ammoPositionLabel')
    document.getElementById('health-display-style-label').textContent = t('healthDisplayStyleLabel')
    document.getElementById('low-ammo-flash-label').textContent = t('lowAmmoFlashLabel')
    document.getElementById('session-timer-label').textContent = t('sessionTimerLabel')
    document.getElementById('difficulty-label-label').textContent = t('difficultyLabelLabel')
    document.getElementById('objective-distance-label').textContent = t('objectiveDistanceLabel')
    document.getElementById('achievement-toast-label').textContent = t('achievementToastLabel')
    document.getElementById('rank-up-toast-label').textContent = t('rankUpToastLabel')
    document.getElementById('leaderboard-rank-label').textContent = t('leaderboardRankLabel')
    document.getElementById('weekly-reminder-label').textContent = t('weeklyReminderLabel')
    document.getElementById('low-currency-label').textContent = t('lowCurrencyLabel')
    document.getElementById('backup-reminder-label').textContent = t('backupReminderLabel')
    document.getElementById('report-bug-label').textContent = t('reportBugLabel')
    if (this.reportBugBtn) this.reportBugBtn.textContent = t('reportBugBtn')
    document.getElementById('save-size-label').textContent = t('saveSizeLabel')
    document.getElementById('clear-cache-label').textContent = t('clearCacheLabel')
    document.getElementById('clear-cache-btn').textContent = t('clearCacheLabel')
    document.getElementById('confirm-signout-label').textContent = t('confirmSignoutLabel')
    document.getElementById('stay-signedin-label').textContent = t('staySignedinLabel')
    document.getElementById('anonymous-leaderboard-label').textContent = t('anonymousLeaderboardLabel')
    document.getElementById('share-telemetry-label').textContent = t('shareTelemetryLabel')
    document.getElementById('auto-decline-label').textContent = t('autoDeclineLabel')
    document.getElementById('exact-lastseen-label').textContent = t('exactLastseenLabel')
    document.getElementById('remember-settings-tab-label').textContent = t('rememberSettingsTabLabel')
    document.getElementById('confirm-remove-friend-label').textContent = t('confirmRemoveFriendLabel')
    document.getElementById('reduce-bg-effects-label').textContent = t('reduceBgEffectsLabel')
    document.getElementById('homepage-greeting-label').textContent = t('homepageGreetingLabel')
    document.getElementById('auto-reload-label').textContent = t('autoReloadLabel')
    document.getElementById('instant-interact-label').textContent = t('instantInteractLabel')
    document.getElementById('damage-flash-color-label').textContent = t('damageFlashColorLabel')
    document.getElementById('one-handed-label').textContent = t('oneHandedLabel')
    document.getElementById('sort-weapons-label').textContent = t('sortWeaponsLabel')
    document.getElementById('whatsnew-every-launch-label').textContent = t('whatsNewEveryLaunchLabel')
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
    this._updateHardcoreMemorialDisplay()
  }

  // Homepage corner currency bar (Coins/Points/Gems) - piggybacks on the
  // same two already-everywhere call sites _updateStatsPanel's own comment
  // describes (in-game HUD refresh + this homepage stats refresh) rather
  // than a save call/listener at each individual currency mutation site.
  _renderCurrencyBar() {
    if (this.currencyCoinsAmount) this.currencyCoinsAmount.textContent = _safeStatNumber(this.coins)
    if (this.currencyPointsAmount) this.currencyPointsAmount.textContent = Math.round(_safeStatNumber(this.points))
    if (this.currencyCashAmount) this.currencyCashAmount.textContent = _safeStatNumber(this.cash)
    if (this.currencyGemsAmount) this.currencyGemsAmount.textContent = _safeStatNumber(this.gems)
  }

  _updateBestStatsDisplay() {
    const { bestNight } = this.bestStats
    this._renderCurrencyBar()

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
    if (this.suggestedLoadoutHint) {
      // Auto-suggested best loadout (batch 8 feature) - based on this
      // player's own past runHistory (average night reached per loadout+
      // companion-role combo actually played), not a generic default.
      // Requires a real sample (SUGGESTED_LOADOUT_MIN_RUNS per combo) so one
      // lucky/unlucky early run doesn't skew the recommendation.
      const combos = {}
      for (const run of this.runHistory) {
        if (!run.loadout || !run.companionRole) continue
        const key = `${run.loadout}|${run.companionRole}`
        if (!combos[key]) combos[key] = { totalNight: 0, count: 0 }
        combos[key].totalNight += _safeStatNumber(run.night)
        combos[key].count += 1
      }
      let best = null
      for (const key in combos) {
        const c = combos[key]
        if (c.count < SUGGESTED_LOADOUT_MIN_RUNS) continue
        const avg = c.totalNight / c.count
        if (!best || avg > best.avg) best = { key, avg }
      }
      if (best) {
        const [loadout, role] = best.key.split('|')
        const roleLabelKeys = { ranged: 'roleRanged', melee: 'roleMelee', medic: 'roleMedic' }
        this.suggestedLoadoutHint.textContent = t('suggestedLoadoutHint', {
          loadout: t(LOADOUT_LABEL_KEYS[loadout] || loadout),
          role: t(roleLabelKeys[role] || role),
          night: best.avg.toFixed(1),
        })
        this.suggestedLoadoutHint.style.display = 'block'
      } else {
        this.suggestedLoadoutHint.style.display = 'none'
      }
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
    }

    // Avatar level badge - the same tier index careerRankTitleKey already
    // derives from totalKills, just as a plain 1-5 number instead of a title.
    if (this.menuAvatarLevel) {
      const level = this._computeAvatarLevel()
      this.menuAvatarLevel.textContent = level
      // Rank-Up Toasts (General tab) - fires only on an actual increase,
      // not the first read this session (_lastAvatarLevel starting
      // undefined would otherwise fire once on page load for anyone
      // already above level 1).
      if (this.settings.rankUpToasts && this._lastAvatarLevel !== undefined && level > this._lastAvatarLevel) {
        this._showHomepageToast(t('rankUpToast', { level }))
      }
      this._lastAvatarLevel = level
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
    this._updateRecommendedDifficultyHint()
    this._updateWhatsNewDot()
    this._updateUpgradesDot()
    this._updateAchievementsDot()
    this._updateQuestsDot()
    this._checkFriendAcceptedNotifications()
    this._checkKillMilestones()
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
  // Shows the account's stable random ID (see _generatePlayerId), not the
  // nickname - the nickname is still editable via the Player showcase
  // panel's pencil icon and still used everywhere else (companion naming,
  // leaderboards, friend search), just not on this specific badge any
  // more. This tag isn't editable at all (it's not a nickname), so it has
  // no pencil of its own - clicking it copies it instead, see
  // _copyPlayerId(). The "#{rank} Worldwide" suffix this used to show was
  // removed per request; the global rank itself is still fetched/shown
  // separately in the Cloud Save panel's own online section
  // (#cloudsave-rank-line).
  // Shared by the avatar-corner level badge (#menu-avatar-level) and the
  // Player showcase title below - same 1-5 tier index careerRankTitleKey
  // already derives from totalKills, just as a plain number instead of a
  // title, computed once here rather than duplicating the lookup loop.
  _computeAvatarLevel() {
    let level = 1
    for (let i = 0; i < CAREER_RANK_TITLES.length; i++) {
      if (this.careerStats.totalKills >= CAREER_RANK_TITLES[i].min) level = i + 1
    }
    return level
  }

  _renderPlayerTag() {
    if (!this.menuPlayerTag) return
    // Motto removed (2026-09-23, explicit request) - used to append
    // `"{motto}"` after the ID here; just the ID now.
    this.menuPlayerTag.textContent = this.settings.playerId ? `#${this.settings.playerId}` : t('menuPlayerTagDefault')
    // The "Player" section heading above the 3D avatar - shows the
    // player's own chosen nickname once they've set one, falls back to
    // the generic "Player" label otherwise (same default the heading
    // ships with in index.html). Level number goes in front of the name
    // (reusing the same tier already shown on the avatar-corner badge,
    // not a separate deeper level system); the clan name (if any, see
    // settings.clanName) shows on its own line above, simple plain text
    // rather than the boxed badge/pill look from the reference image.
    if (this.playerShowcaseTitle) {
      const level = this._computeAvatarLevel()
      const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
      this.playerShowcaseTitle.textContent = t('playerShowcaseLevelName', { level, name: nickname })
      this._fitPlayerShowcaseTitle()
    }
    if (this.playerShowcaseClanName) {
      this.playerShowcaseClanName.textContent = this.settings.clanName || ''
      this.playerShowcaseClanName.style.display = this.settings.clanName ? 'block' : 'none'
    }
  }

  // "Lvl 1 [name]" must stay pinned to the exact same spot no matter how
  // long the name is (#menu-col-left is bottom-anchored - see its own CSS
  // comment - so letting this text wrap onto a 2nd line pushes everything
  // above it, including this same title, further up the screen). Instead
  // of wrapping or truncating, shrink the font just enough to keep it on
  // one line - reset to the CSS default first (so it grows back once the
  // name/level shrinks again), then scale down only if it still overflows
  // the space actually available next to the pencil button.
  _fitPlayerShowcaseTitle() {
    const title = this.playerShowcaseTitle
    const header = title?.closest('#player-showcase-header')
    const pencil = this.playerShowcaseRenameBtn
    if (!title || !header || !pencil) return
    title.style.fontSize = ''
    const headerGap = parseFloat(getComputedStyle(header).columnGap || getComputedStyle(header).gap) || 0
    const available = header.clientWidth - pencil.offsetWidth - headerGap
    if (available <= 0) return
    const naturalWidth = title.scrollWidth
    if (naturalWidth <= available) return
    const baseFontSize = parseFloat(getComputedStyle(title).fontSize)
    const minFontSize = 11
    const scaledSize = Math.floor(baseFontSize * (available / naturalWidth))
    title.style.fontSize = `${Math.max(minFontSize, scaledSize)}px`
  }

  _copyPlayerId() {
    if (!this.settings.playerId || !navigator.clipboard || !navigator.clipboard.writeText) return
    // A small oval "Copied" badge right above the ID you clicked, not the
    // shared homepage toast - a dedicated confirmation for a copy action
    // reads clearer than reusing the same banner used for lore/milestones.
    navigator.clipboard.writeText(`#${this.settings.playerId}`).then(() => this._showCopiedBadge(this.menuPlayerTag)).catch(() => {})
  }

  // Shared "Copied" oval badge - pops up right above whichever element was
  // clicked to copy an ID, then fades on its own (CSS animation, same
  // self-contained pattern as #lore-toast). One reused element rather than
  // creating a new one per click.
  // anchorElOrRect: a live element (reads its rect at call time) OR a
  // plain {left, top, width} already captured earlier - needed for the
  // chat ID popup's own copy button, which hides itself (display:none)
  // before this runs, so its live rect would read all-zero by then.
  _showCopiedBadge(anchorElOrRect) {
    if (!anchorElOrRect) return
    if (!this._copiedBadgeEl) {
      this._copiedBadgeEl = document.createElement('div')
      this._copiedBadgeEl.className = 'copied-oval-badge'
      // A plain SVG tag icon, not an emoji - this codebase has an existing
      // documented no-emoji-in-the-UI convention (see the Achievement
      // Showcase badges, which use a colored swatch instead of an emoji).
      this._copiedBadgeEl.innerHTML = `<span class="copied-oval-badge-text"></span><svg class="copied-oval-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1"/></svg>`
      this._copiedBadgeTextEl = this._copiedBadgeEl.querySelector('.copied-oval-badge-text')
      document.body.appendChild(this._copiedBadgeEl)
    }
    this._copiedBadgeTextEl.textContent = t('copiedBadgeLabel')
    const rect = anchorElOrRect.getBoundingClientRect ? anchorElOrRect.getBoundingClientRect() : anchorElOrRect
    this._copiedBadgeEl.style.left = `${rect.left + rect.width / 2}px`
    this._copiedBadgeEl.style.top = `${rect.top}px`
    this._copiedBadgeEl.classList.remove('show')
    void this._copiedBadgeEl.offsetWidth
    this._copiedBadgeEl.classList.add('show')
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

  // Upgrades nav dot - red, lights up if either (a) a new upgrade was
  // added since this player last opened Upgrades, or (b) they can afford
  // an upgrade they haven't bought yet right now (checked live, not
  // persisted - this one naturally turns off the moment they buy it or
  // spend their points elsewhere).
  _updateUpgradesDot() {
    if (!this.upgradesDot) return
    let seen = _loadSeenIds(UPGRADES_SEEN_IDS_KEY)
    if (!seen) {
      seen = new Set(PLAY_META_UPGRADES.map((u) => u.id))
      _saveSeenIds(UPGRADES_SEEN_IDS_KEY, seen)
    }
    const hasNewUpgrade = PLAY_META_UPGRADES.some((u) => !seen.has(u.id))
    const canAffordOne = PLAY_META_UPGRADES.some((u) => {
      if (this.metaProgress.purchased.has(u.id)) return false
      if (u.requires && !this.metaProgress.purchased.has(u.requires)) return false
      return this.metaProgress.legacyPoints >= u.cost
    })
    this.upgradesDot.style.display = (hasNewUpgrade || canAffordOne) ? '' : 'none'
  }

  _markUpgradesSeen() {
    _saveSeenIds(UPGRADES_SEEN_IDS_KEY, PLAY_META_UPGRADES.map((u) => u.id))
    this._updateUpgradesDot()
  }

  // Achievements nav dot - gold, lights up if an achievement unlocked
  // since this player last opened the Achievements panel.
  _updateAchievementsDot() {
    if (!this.achievementsNewDot) return
    let seen = _loadSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY)
    if (!seen) {
      seen = new Set(this.achievements.unlocked)
      _saveSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY, seen)
    }
    this.achievementsNewDot.style.display = [...this.achievements.unlocked].some((id) => !seen.has(id)) ? '' : 'none'
  }

  _markAchievementsSeen() {
    _saveSeenIds(ACHIEVEMENTS_SEEN_IDS_KEY, this.achievements.unlocked)
    this._updateAchievementsDot()
  }

  // Quests nav dot - gold, lights up if any lifetime or rolling quest is
  // complete and waiting to be claimed. Purely live-computed (no seen-
  // tracking needed) since "claimable right now" already turns itself off
  // the instant the reward is claimed.
  _updateQuestsDot() {
    if (!this.questsClaimDot) return
    const lifetimeReady = QUESTS.some((q) => this.quests.isComplete(q, this) && !this.quests.isClaimed(q.id))
    const rollingReady = this.rollingQuests.activeQuests().some((q) => q.progress >= q.template.target)
    this.questsClaimDot.style.display = (lifetimeReady || rollingReady) ? '' : 'none'
    this._updateQuestsNewDot()
  }

  // Quests nav dot - red, lights up if there's a lifetime quest (id-based)
  // or an active rolling quest (spawnedAt-based, since rolling quests
  // don't have a fixed id - see RollingQuests.activeQuests()) the player
  // hasn't opened the Quests panel to see yet. Same seen-id pattern as
  // Store/Upgrades/Achievements, just tracking two different kinds of id
  // in one set since lifetime ids and rolling spawnedAt timestamps can
  // never collide (one's a short string, the other's a large number).
  _updateQuestsNewDot() {
    if (!this.questsNewDot) return
    let seen = _loadSeenIds(QUESTS_SEEN_IDS_KEY)
    if (!seen) {
      seen = new Set([...QUESTS.map((q) => q.id), ...this.rollingQuests.activeQuests().map((q) => q.spawnedAt)])
      _saveSeenIds(QUESTS_SEEN_IDS_KEY, seen)
    }
    const hasNewLifetime = QUESTS.some((q) => !seen.has(q.id))
    const hasNewRolling = this.rollingQuests.activeQuests().some((q) => !seen.has(q.spawnedAt))
    this.questsNewDot.style.display = (hasNewLifetime || hasNewRolling) ? '' : 'none'
  }

  _markQuestsSeen() {
    _saveSeenIds(QUESTS_SEEN_IDS_KEY, [...QUESTS.map((q) => q.id), ...this.rollingQuests.activeQuests().map((q) => q.spawnedAt)])
    this._updateQuestsNewDot()
  }

  // How to Play - a replayable overlay, distinct from _maybeShowTutorialHints
  // (a one-time, non-interactive toast sequence that still runs
  // independently the first time a run starts). Renders every step as one
  // static scrollable list rather than a Next/Back stepper.
  _openHowToPlayPanel() {
    this._closeAllMenuPanels()
    this.howtoplayPanel.style.display = 'flex'
    this.howtoplayPanelTitle.textContent = t('howtoplayPanelTitle')
    this.howtoplayContent.innerHTML = HOWTOPLAY_STEPS.map((step) => `<h3>${t(step.headingKey)}</h3><p>${tHtml(step.key)}</p>`).join('')
  }

  _closeHowToPlayPanel() {
    this.howtoplayPanel.style.display = 'none'
  }

  // Homepage batch - every quick-action/one-shot listener that isn't
  // already covered by an existing _bindX() method (difficulty/loadout/
  // role buttons keep their own _bindDifficulty/_bindLoadout/
  // _bindCompanionRole - Play Again/preset load click those same real
  // buttons rather than duplicating their apply logic).
  _bindHomepageBatch() {
    // Reuses _generateCareerPortrait() as-is (see its own comment - it
    // already composites a styled stat-card image, not a plain
    // screenshot). The Profile panel's own button stays gated behind
    // true_ending; this homepage shortcut uses the same lower bar as
    // Play Again/Share above it (any completed run at all), since a
    // shareable stat card is reasonable to want well before the true
    // ending.
    if (this.updateAvailableRefreshBtn) this.updateAvailableRefreshBtn.addEventListener('click', () => window.location.reload())
    if (this.updateAvailableLaterBtn) {
      this.updateAvailableLaterBtn.addEventListener('click', () => {
        // Remembers this specific version was seen so returning to the
        // homepage again later doesn't re-show the same notice - a genuinely
        // NEWER deploy after this one still gets its own fresh banner, since
        // its id won't match what's stored here.
        this.settings.lastSeenBuildId = this._pendingUpdateId
        saveSettings(this.settings)
        this.updateAvailableBanner.style.display = 'none'
      })
    }
    if (this.savePresetBtn) this.savePresetBtn.addEventListener('click', () => MenuPresets.saveMenuPreset(this))
    if (this.surpriseMeBtn) this.surpriseMeBtn.addEventListener('click', () => MenuPresets.surpriseMe(this))
    if (this.quickKeybindsBtn) {
      this.quickKeybindsBtn.addEventListener('click', () => {
        this._toggleSettings(true)
        document.getElementById('tab-controls')?.click()
      })
    }
    if (this.buildModeBtn) this.buildModeBtn.addEventListener('click', () => this._enterBuildMode())
    // Map 2 (Game Mode panel) - there's no second playable map yet, so this
    // opens the same Build Mode / block editor as the dedicated Map Editor
    // nav button instead of pretending to switch to a real map. Reuses
    // _enterBuildMode() as-is rather than a second copy - it already calls
    // _closeAllMenuPanels() as its first step (see that function's own
    // comment - added specifically for "any future path that reaches
    // _enterBuildMode() without going through a blocked nav click first"),
    // which correctly closes this very panel (#hub-panel) before Build
    // Mode's own UI takes over.
    const mapSelect2Btn = document.getElementById('map-select-2')
    if (mapSelect2Btn) mapSelect2Btn.addEventListener('click', () => this._enterBuildMode({ map: 'map2' }))
    this._renderMapSelect()
    const buildExitBtn = document.getElementById('build-mode-exit-btn')
    if (buildExitBtn) buildExitBtn.addEventListener('click', () => this._exitBuildMode())
    const buildSaveBtn = document.getElementById('build-mode-save-btn')
    if (buildSaveBtn) buildSaveBtn.addEventListener('click', () => this.buildMode.save())
    const buildExportBtn = document.getElementById('build-mode-export-btn')
    if (buildExportBtn) buildExportBtn.addEventListener('click', () => this.buildMode.exportMap())
    const buildImportBtn = document.getElementById('build-mode-import-btn')
    const buildImportInput = document.getElementById('build-mode-import-input')
    if (buildImportBtn && buildImportInput) {
      buildImportBtn.addEventListener('click', () => buildImportInput.click())
      buildImportInput.addEventListener('change', async () => {
        const file = buildImportInput.files[0]
        buildImportInput.value = ''
        if (!file) return
        if (!window.confirm(t('buildImportConfirm'))) return
        const ok = await this.buildMode.importMapFile(file)
        // _showLoreToast no-ops here - it's gated on gameStarted, which
        // Build Mode deliberately sets false (see _enterBuildMode). This is
        // the same "homepage-safe" ungated variant used elsewhere for
        // toasts that genuinely belong to a pre-gameStarted context.
        this._showHomepageToast(t(ok ? 'buildImportSuccess' : 'buildImportInvalid'))
      })
    }
    // Share Map / Community Maps (BuildShare.js).
    document.getElementById('build-mode-publish-btn')?.addEventListener('click', () => this.buildMode.share.shareCurrent())
    document.getElementById('build-mode-browse-btn')?.addEventListener('click', () => this.buildMode.share.open())
    MenuPresets.renderMenuPresets(this)
    MenuEasterEggs.bindAll(this)
    window.addEventListener('online', () => CloudSaveUI.updateOnlineStatus(this))
    window.addEventListener('offline', () => CloudSaveUI.updateOnlineStatus(this))
    if (this.shortcutCheatsheetCloseBtn) {
      this.shortcutCheatsheetCloseBtn.addEventListener('click', () => { this.shortcutCheatsheet.style.display = 'none' })
    }

    if (this.profileBioInput) {
      this.profileBioInput.addEventListener('input', () => {
        this.settings.bio = this.profileBioInput.value.slice(0, 5000)
        if (this.profileBioInput.value.length > 5000) this.profileBioInput.value = this.settings.bio
        saveSettings(this.settings)
        this._renderProfileBioCounter()
      })
    }

    if (this.quickMuteBtn) {
      this.quickMuteBtn.classList.toggle('active', !!this.settings.mutedBeforeVolumes)
      this.quickMuteBtn.addEventListener('click', () => {
        if (this.settings.mutedBeforeVolumes) {
          this.settings.sfxVolume = this.settings.mutedBeforeVolumes.sfx
          this.settings.mutedBeforeVolumes = null
        } else {
          this.settings.mutedBeforeVolumes = { sfx: this.settings.sfxVolume }
          this.settings.sfxVolume = 0
        }
        this._applyAllVolumes()
        if (this.sfxVolumeSlider) { this.sfxVolumeSlider.value = this.settings.sfxVolume; this.sfxVolumeValue.textContent = `${this.settings.sfxVolume}%` }
        saveSettings(this.settings)
        this.quickMuteBtn.classList.toggle('active', !!this.settings.mutedBeforeVolumes)
      })
    }

    if (this.quickColorblindBtn) {
      this.quickColorblindBtn.classList.toggle('active', this.settings.colorblindMode !== 'off')
      // Quick on/off, not a 3-way cycle - picking WHICH mode (redgreen vs
      // blueyellow) is a one-time setup choice that belongs in the real
      // Settings dropdown, not something to hunt for via repeated clicks on
      // a homepage icon. Remembers whichever mode was last selected there
      // (defaulting to redgreen, the more common form) and just flips it on/off.
      this.quickColorblindBtn.addEventListener('click', () => {
        if (this.settings.colorblindMode !== 'off') {
          this._lastColorblindMode = this.settings.colorblindMode
          this.settings.colorblindMode = 'off'
        } else {
          this.settings.colorblindMode = this._lastColorblindMode || 'redgreen'
        }
        setColorblindMode(this.settings.colorblindMode)
        if (this.colorblindModeSelect) this.colorblindModeSelect.value = this.settings.colorblindMode
        saveSettings(this.settings)
        this.quickColorblindBtn.classList.toggle('active', this.settings.colorblindMode !== 'off')
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
    if (this.howtoplayPanel) {
      this.howtoplayPanel.addEventListener('click', (e) => {
        if (e.target === this.howtoplayPanel) this._closeHowToPlayPanel()
      })
    }

    this._updateEventBanner()
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
    this._fitMenuLinksRow()
  }

  // The footer links (#menu-links-row, How to Play ... Privacy Policy ...
  // Discord) must stay clear of the right column's nav buttons (2026-10-04,
  // Gaymi: "dont make it touch the right side panel") and stay on one line
  // ("dont stack them, theres space on the left side, move it to the left").
  // Where the centered row would reach within MENU_LINKS_CLEARANCE px of the
  // buttons, it slides left into the empty space first; only if the window
  // is too narrow for that does it tighten its spacing (.links-compact), and
  // only then wrap. Measured live, like _updatePlayBtnCentering below - the
  // row's width depends on translated labels, the columns on window size.
  _fitMenuLinksRow() {
    const row = document.getElementById('menu-links-row')
    const nav = [...document.querySelectorAll('#menu-nav-buttons button')].filter((b) => b.offsetParent)
    if (!row || !nav.length || row.offsetParent === null) return
    const MENU_LINKS_CLEARANCE = 24
    const MENU_LINKS_MIN_LEFT = 16
    row.classList.remove('links-compact')
    row.style.maxWidth = ''
    row.style.transform = ''
    const limit = Math.min(...nav.map((b) => b.getBoundingClientRect().left)) - MENU_LINKS_CLEARANCE
    const slide = () => {
      const r = row.getBoundingClientRect()
      const shift = Math.min(Math.max(0, r.right - limit), Math.max(0, r.left - MENU_LINKS_MIN_LEFT))
      row.style.transform = shift ? `translateX(${-shift}px)` : ''
      return r.right - shift <= limit
    }
    if (slide()) return
    row.style.transform = ''
    row.classList.add('links-compact')
    if (slide()) return
    row.style.transform = ''
    // Centered, so the row may be at most twice the distance from the middle
    // of the window to the limit.
    row.style.maxWidth = `${Math.max(240, 2 * (limit - window.innerWidth / 2))}px`
  }

  // Decides whether #play-btn can go dead-center in the viewport (see its
  // .play-btn-centered rule in style.css) without overlapping the hero
  // column's own content. Can't be a fixed CSS breakpoint: the news
  // ticker/weekly mutator lines above are variable-length text, so how
  // much clearance actually exists shifts with them - this measures the
  // real gap between the hero column's true end (with play-btn briefly
  // popped out of flow) and the bottom of the viewport, live. Uses
  // #settings-btn (not #controls-list/#round-mode-hint, both
  // display:none now that the instructional text was removed from the
  // visible menu) as the "last visible hero element" reference - a
  // display:none element's getBoundingClientRect() is always all-zero,
  // which would silently make this measurement meaningless.
  _updatePlayBtnCentering() {
    const settingsBtn = document.getElementById('settings-btn')
    if (!this.playBtn || !settingsBtn) return

    this.playBtn.classList.remove('play-btn-centered')
    const btnHeight = this.playBtn.getBoundingClientRect().height

    const prevDisplay = this.playBtn.style.display
    this.playBtn.style.display = 'none'
    const safeTop = settingsBtn.getBoundingClientRect().bottom
    this.playBtn.style.display = prevDisplay

    const safeBottom = window.innerHeight
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

  // Crate tier cards - there are two copies in the DOM (Inventory's Crates
  // tab, cost-free per the project owner's request, and the Shop panel,
  // which shows cost - amount + coin icon, right on the button itself -
  // since that's the actual place to buy them), both sharing the same
  // class/data-crate-tier markup rather than each getting their own cached
  // element set - a plain querySelectorAll here updates every copy in one
  // pass. The two copies' buttons only differ by whether they still have
  // the .crate-open-btn-amount child (Shop's markup) or not (Inventory's,
  // reverted back to plain "Open" text) - that presence check is what
  // decides which label a given button gets, so a future 3rd copy needs no
  // changes here, just whichever markup shape it should follow.
  _renderCrateTiers() {
    // Tier-name labels (just "Wood"/"Ice"/...) stay unscoped - both the
    // Shop's real crates and Inventory > Crates' cost-free display copies
    // (see the click-binding's own comment, above where this is called
    // from) need this same translation, and there's no price/affordability
    // concept involved here to leak between them.
    for (const el of document.querySelectorAll('.crate-tier-name[data-crate-tier]')) {
      el.textContent = t(`crateTier${el.dataset.crateTier.charAt(0).toUpperCase()}${el.dataset.crateTier.slice(1)}`)
    }
    // Price/affordability, unlike the tier names above, is Shop-only -
    // scoped to #shop-crate-tier-grid so Inventory's plain "Open" buttons
    // (same classes/data-crate-tier, reused purely for visual styling)
    // never get disabled by an affordability check they have no price to
    // justify (real regression, caught 2026-09-21 - see the click
    // handler's own comment for the matching fix on that side).
    for (const btn of document.querySelectorAll('#shop-crate-tier-grid .crate-open-btn[data-crate-tier]')) {
      const tier = CRATE_TIERS[btn.dataset.crateTier]
      if (!tier) continue
      btn.disabled = this.coins < tier.cost
      // .querySelector('span'), not btn.textContent, for the Shop's
      // version specifically - it also has an <svg> icon child that a
      // plain textContent set would silently wipe out (see the Menu
      // redesign notes' own recurring gotcha on this exact pattern).
      const amountEl = btn.querySelector('.crate-open-btn-amount')
      if (amountEl) amountEl.textContent = tier.cost
      else btn.textContent = t('crateOpenBtn')
    }
    // Inventory > Crates' own plain "Open" buttons - excluded from the
    // Shop-scoped loop above (no price to check/show), but still need
    // their label translated on language switch, same as everywhere else.
    // Disabled when crateStock is 0 for that tier - nothing owned yet to
    // open (2026-09-21, part of the buy/open split).
    for (const btn of document.querySelectorAll('#inventory-page-crates .crate-open-btn[data-crate-tier]')) {
      btn.textContent = t('crateOpenBtn')
      btn.disabled = (this.crateStock[btn.dataset.crateTier] || 0) <= 0
    }
    // Star-shaped stock badge on each Inventory crate card, "x3"-style
    // text (reverted back from a plain-number-only pass per explicit
    // request). Hidden entirely at 0 rather than shown as "x0" (see
    // .crate-stock-count's own CSS comment).
    for (const el of document.querySelectorAll('#inventory-page-crates .crate-stock-count[data-crate-tier]')) {
      const count = this.crateStock[el.dataset.crateTier] || 0
      el.textContent = `x${count}`
      // '' (not 'block') when shown - the CSS class's own display:flex
      // centers the number inside the star shape; an inline 'block'
      // here would override it right back to left-aligned/uncentered.
      el.style.display = count > 0 ? '' : 'none'
    }
  }

  // Rolls one random reward from COIN_SHOP_ITEMS for the given crate tier -
  // see CRATE_TIERS' own comment on why the existing .cost field (not a new
  // rarity field) decides which half of the pool a tier favors.
  _rollCrateReward(tier) {
    const wantsRare = Math.random() < CRATE_TIERS[tier].rareChance
    const pool = COIN_SHOP_ITEMS.filter((i) => (i.cost >= CRATE_RARE_COST_THRESHOLD) === wantsRare)
    const finalPool = pool.length > 0 ? pool : COIN_SHOP_ITEMS
    return finalPool[Math.floor(Math.random() * finalPool.length)]
  }

  // Buys 1 crate - adds it to crateStock, unopened, rather than instantly
  // rolling a reward (that used to happen right here; moved to
  // _openOwnedCrate, called from Inventory > Crates' own Open button -
  // 2026-09-21, per explicit request to separate buying from opening so
  // Inventory can show a real "how many do I have" count). Mirrors
  // _buyShopSkin's own afford-check/deduct/persist/toast shape.
  _openCrate(tier) {
    const tierConfig = CRATE_TIERS[tier]
    if (!tierConfig) return
    if (this.coins < tierConfig.cost) {
      this._showHomepageToast(t('crateNotEnoughCoins'))
      return
    }
    this.coins -= tierConfig.cost
    this.crateStock[tier] = (this.crateStock[tier] || 0) + 1
    this._showHomepageToast(t('crateBought', { n: 1, name: t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`) }))
    saveShopProgress(this)
    this._renderCurrencyBar()
    this._renderCrateTiers()
  }

  // Opens ONE owned, already-paid-for crate from crateStock - the actual
  // reward roll + duplicate-refund logic this used to be part of buying
  // itself (see _openCrate's own comment). Refunding the crate's cost on
  // a duplicate still applies here (same "never waste a roll on something
  // already owned" reasoning as before), even though the coins were
  // already spent earlier at buy time - the crate itself is consumed
  // either way, so this is the only point left where a duplicate can be
  // made whole again.
  _openOwnedCrate(tier) {
    const tierConfig = CRATE_TIERS[tier]
    if (!tierConfig) return
    if ((this.crateStock[tier] || 0) <= 0) return
    this.crateStock[tier] -= 1
    const item = this._rollCrateReward(tier)
    const alreadyOwned = item.outfit ? this.ownedOutfits.has(item.outfit) : this.ownedHats.has(item.hat)
    if (alreadyOwned) {
      this.coins += tierConfig.cost
      this._showHomepageToast(t('crateDuplicateRefund', { name: t(item.titleKey), coins: tierConfig.cost }))
    } else {
      if (item.outfit) {
        this.ownedOutfits.add(item.outfit)
        this.equippedOutfit = item.outfit
      } else {
        this.ownedHats.add(item.hat)
        this.equippedHat = item.hat
      }
      this._showHomepageToast(t('crateRewardWon', { name: t(item.titleKey) }))
    }
    saveShopProgress(this)
    this._renderCurrencyBar()
    this._renderCrateTiers()
  }

  // Bulk-purchase modal (2026-09-21) - opened by clicking a crate card
  // anywhere other than its own Open button (see the click binding in
  // _bindMenu). Lets a player pick a quantity and buy several crates in
  // one confirm instead of one _openCrate() click at a time.
  _openCratePurchaseModal(tier) {
    const tierConfig = CRATE_TIERS[tier]
    if (!tierConfig || !this.cratePurchaseModal) return
    if (this.coins < tierConfig.cost) {
      this._showHomepageToast(t('crateNotEnoughCoins'))
      return
    }
    this._cratePurchaseTier = tier
    this._cratePurchaseQty = 1
    this.cratePurchaseIconWrap.innerHTML = CRATE_ICON_SVG[tier] || ''
    this.cratePurchaseTierName.textContent = t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`)
    this.cratePurchaseBox.style.setProperty('--crate-tier-color', CRATE_TIER_COLORS[tier] || '#e3c23c')
    this.cratePurchaseModal.style.display = 'flex'
    this._updateCratePurchaseModal()
  }

  _closeCratePurchaseModal() {
    if (this.cratePurchaseModal) this.cratePurchaseModal.style.display = 'none'
  }

  // Recomputes the quantity clamp (1..whatever this.coins can actually
  // afford - no fixed upper cap anymore, per explicit request to allow
  // buying as many as you can afford in one purchase) - re-run after
  // every +/- click and right after opening, since "what's affordable"
  // can only ever shrink relative to when the modal opened, never grow,
  // but re-deriving it fresh here rather than caching it once is what
  // makes that safe regardless of when coins last changed.
  _updateCratePurchaseModal() {
    const tier = this._cratePurchaseTier
    const tierConfig = CRATE_TIERS[tier]
    if (!tierConfig) return
    const maxAffordable = Math.floor(this.coins / tierConfig.cost)
    const maxQty = Math.max(1, maxAffordable)
    this._cratePurchaseQty = Math.min(this._cratePurchaseQty, maxQty)
    this.cratePurchaseQtyValue.value = this._cratePurchaseQty
    this.cratePurchaseQtyValue.max = maxQty
    this.cratePurchaseQtyMinus.disabled = this._cratePurchaseQty <= 1
    this.cratePurchaseQtyPlus.disabled = this._cratePurchaseQty >= maxQty
    const total = tierConfig.cost * this._cratePurchaseQty
    this.cratePurchaseTotalAmount.textContent = total
    this.cratePurchaseConfirmBtn.disabled = this.coins < total
  }

  // Buys the chosen quantity, adding all of it to crateStock unopened -
  // no more per-crate reward rolling here (moved to _openOwnedCrate, see
  // its own comment). One combined "Bought Nx Tier Crate" toast instead
  // of the old per-reward summary, since there's no longer a reward to
  // summarize at buy time.
  _confirmCratePurchase() {
    const tier = this._cratePurchaseTier
    const tierConfig = CRATE_TIERS[tier]
    if (!tierConfig) return
    // Clamps this._cratePurchaseQty for real - the qty input's own
    // 'input' listener updates it live while typing WITHOUT clamping
    // (see its own comment), so clicking Confirm before ever blurring a
    // just-typed out-of-range value would otherwise reach here
    // unclamped.
    this._updateCratePurchaseModal()
    const qty = this._cratePurchaseQty
    const totalCost = tierConfig.cost * qty
    if (this.coins < totalCost) {
      this._showHomepageToast(t('crateNotEnoughCoins'))
      return
    }
    this.coins -= totalCost
    this.crateStock[tier] = (this.crateStock[tier] || 0) + qty
    this._showHomepageToast(t('crateBought', { n: qty, name: t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`) }))
    saveShopProgress(this)
    this._renderCurrencyBar()
    this._renderCrateTiers()
    this._closeCratePurchaseModal()
  }

  // Inventory panel's Weapons tab - every weapon's mastery progress in one
  // place. _refreshInventoryPanel's hotbar list (below) deliberately only
  // shows the 3 currently-equipped weapons (see its own comment - the full
  // roster there read as confusing next to the HUD's 3-weapon list), so
  // there was previously no way to check mastery progress on a weapon
  // that isn't in your hotbar right now. Read-only by design - this tab's
  // job is showing progress, not reassigning loadouts (the Loadout panel
  // and this same Inventory panel's hotbar-assign buttons already do that).
  // Inventory > Weapons (2026-10-01): a card per weapon's Default skin, in
  // the same Kirka-style grid as Character - the old list of names with
  // mastery kill counts ("0/75") is gone from here. Pictures are rendered
  // once from each weapon's own viewmodel (_weaponThumbnails).
  _renderInventoryWeapons() {
    if (!this.inventoryWeaponsList) return
    if (this._invSkinMenuKind === 'weapon') this._closeInventorySkinMenu()
    const weapons = this.weapons
      .getSummary()
      .sort((a, b) => t(a.nameKey).localeCompare(t(b.nameKey)))
    const rarity = SKIN_RARITIES.common
    const thumbs = this._weaponThumbCache || {}
    this.inventoryWeaponsList.innerHTML = weapons.map((w) => {
      const name = t(w.nameKey)
      const icon = WEAPON_ICON_PATHS[w.id]
      const picture = thumbs[w.id]
        ? `<img class="inv-weapon-card-img" alt="" draggable="false" src="${thumbs[w.id]}" />`
        : icon ? `<svg class="inv-weapon-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` : ''
      return `<div class="inv-skin-card inv-weapon-card" data-weapon-card="${w.id}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${name} - ${t('skinDefault')}`)}">`
        + `<span class="inv-skin-card-name">${_escapeHtml(name)}</span>`
        + picture
        + `<span class="inv-weapon-card-skin">${_escapeHtml(t('skinDefault'))}</span>`
        + '<span class="inv-skin-card-count">1</span>'
        + '</div>'
    }).join('')
    if (!this._weaponThumbCache) {
      // After the panel has painted, so opening Inventory never waits on it.
      setTimeout(() => {
        this._weaponThumbCache = this._weaponThumbnails()
        if (this.menuInventoryPanel?.style.display !== 'none') this._renderInventoryWeapons()
      }, 50)
    }
  }

  // Side-view picture of every weapon, drawn once with a small throwaway
  // renderer (its own canvas, so the game's renderer and frame are never
  // touched) and kept as data URLs. Hands are left out.
  _weaponThumbnails() {
    const out = {}
    let renderer
    try {
      const canvas = document.createElement('canvas')
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
      renderer.setPixelRatio(1)
      renderer.setSize(240, 140, false)
      renderer.setClearColor(0x000000, 0)
      const scene = new THREE.Scene()
      // Most guns are fully metallic (metalness 1), which only shows what it
      // reflects - without an environment they render pure black.
      const pmrem = new THREE.PMREMGenerator(renderer)
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      // Bright, even studio light - most guns are dark metal and would
      // otherwise read as black silhouettes on the dark cards.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 2.6))
      const key = new THREE.DirectionalLight(0xffffff, 3)
      key.position.set(4, 3, 1)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0xffffff, 1.2)
      rim.position.set(-2, 2, -3)
      scene.add(rim)
      const camera = new THREE.PerspectiveCamera(30, 240 / 140, 0.01, 50)
      const box = new THREE.Box3()
      const meshBox = new THREE.Box3()
      for (const [id, vm] of Object.entries(this.weapons.viewmodels || {})) {
        const model = this._weaponDisplayClone(vm)
        scene.add(model)
        model.updateMatrixWorld(true)
        // Bounds of what's actually visible (hidden parts like scopes or
        // alternate melee variants would otherwise stretch the framing).
        box.makeEmpty()
        model.traverse((o) => {
          if (!o.isMesh || !o.geometry) return
          for (let p = o; p; p = p.parent) if (!p.visible) return
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
          meshBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
          box.union(meshBox)
        })
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3())
          const size = box.getSize(new THREE.Vector3())
          // Guns point along -Z, so look from the side (+X) with the
          // barrel running left-right; fit the longer of length/height.
          const fitH = Math.max(size.y, size.z / camera.aspect) * 1.15
          const dist = fitH / 2 / Math.tan((camera.fov * Math.PI) / 360) + size.x
          camera.position.set(center.x + dist, center.y + dist * 0.12, center.z)
          camera.lookAt(center)
          renderer.render(scene, camera)
          out[id] = canvas.toDataURL('image/png')
        }
        scene.remove(model)
      }
    } catch (err) {
      console.warn('Weapon pictures failed, using icons instead', err)
    } finally {
      if (renderer) {
        renderer.dispose()
        renderer.forceContextLoss()
      }
    }
    return out
  }

  // A weapon's viewmodel copied for showing on its own (card pictures,
  // Inspect): reset to the origin, visible, hands left out. Shares the
  // game's geometry/materials - never dispose them through this.
  _weaponDisplayClone(vm) {
    const model = vm.clone(true)
    model.position.set(0, 0, 0)
    model.rotation.set(0, 0, 0)
    model.scale.set(1, 1, 1)
    model.visible = true
    const hands = []
    model.traverse((o) => { if (o.userData?.isHand) hands.push(o) })
    for (const h of hands) h.parent?.remove(h)
    return model
  }

  _onResize() {
    // Build Mode reuses this same renderer/canvas but owns its own camera
    // (see BuildMode.js), created once at startup with whatever
    // window.innerWidth/innerHeight was at page load and never touched
    // again - toggling browser fullscreen (or any window resize) while
    // inside Build Mode visibly stretched the view since the renderer's
    // output size changed but this camera's aspect didn't follow it.
    if (this.buildMode?.camera) {
      this.buildMode.camera.aspect = window.innerWidth / window.innerHeight
      this.buildMode.camera.updateProjectionMatrix()
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this._updatePlayBtnCentering()
    this._fitMenuLinksRow()
    this._fitPlayerShowcaseTitle()
  }

  _showAchievementToast(def) {
    // State changes (skin unlock, trophy wall) happen immediately, same as
    // before - only the visual toast display itself is queued below, so an
    // unlock is never delayed, just its notification.
    // The live game world (zombies, weather) keeps simulating behind the
    // menu before Play is ever clicked (see main.js) - no gameplay toast
    // should actually reach the screen before then, even if whatever
    // triggered this fired anyway.
    if (!this.gameStarted) return
    if (!this.settings.achievementToasts) return
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

  // Credits panel - static prose (dev/asset credits only), not a
  // data-driven list, so no render step needed beyond the title.
  _openCreditsPanel() {
    this._closeAllMenuPanels()
    this.creditsPanel.style.display = 'flex'
    this.creditsPanelTitle.textContent = t('creditsPanelTitle')
  }

  _closeCreditsPanel() {
    this.creditsPanel.style.display = 'none'
  }

  // Levels panel - the avatar-corner star badge used to open a "Coming
  // Soon" placeholder; this replaces that. Content is the same Rank
  // Roadmap list Profile already renders (_renderRankRoadmap writes to
  // both list elements at once), just shown as its own dedicated screen.
  _openLevelsPanel() {
    this._closeAllMenuPanels()
    this.levelsPanel.style.display = 'flex'
    if (this.levelsPanelTitle) this.levelsPanelTitle.textContent = t('levelsPanelTitle')
    if (this.levelsIntroText) this.levelsIntroText.textContent = t('levelsIntroText')
    this._renderRankRoadmap()
  }

  _closeLevelsPanel() {
    this.levelsPanel.style.display = 'none'
  }

  // Terms of Use / Privacy Policy - used to be a plain link out to
  // /terms.html and /privacy.html (target="_blank"); moved in-panel
  // (same static-prose pattern as Credits above) at Gaymi's request. The
  // standalone terms.html/privacy.html pages themselves are left as-is
  // (still real, linkable URLs - just no longer linked to from here).
  _openTermsPanel() {
    this._closeAllMenuPanels()
    this.termsPanel.style.display = 'flex'
    this.termsPanelTitle.textContent = t('termsBtn')
  }

  _closeTermsPanel() {
    this.termsPanel.style.display = 'none'
  }

  _openPrivacyPanel() {
    this._closeAllMenuPanels()
    this.privacyPanel.style.display = 'flex'
    this.privacyPanelTitle.textContent = t('creditsPrivacyLink')
  }

  _closePrivacyPanel() {
    this.privacyPanel.style.display = 'none'
  }

  // GayZ Features - ported in from the standalone gayz-features.vercel.app
  // site's own index.html/style.css/app.js (that project's own repo,
  // updated separately after every shipped game change - see its own
  // habit note) rather than iframed, per explicit request. "GayZ
  // Features" (like "GayZ" itself) is treated as a proper-noun brand
  // name, not translated - same as the standalone site itself, which has
  // no i18n of its own either. #features-content lives as
  // static HTML (index.html) with the styling in style.css; this only
  // wires up the same interactive behavior app.js had: TOC nav built
  // from the category sections, expandable multi-item cards, live/
  // coming-soon counts and search-as-you-type filtering.
  _openFeaturesPanel() {
    this._closeAllMenuPanels()
    this.featuresPanel.style.display = 'flex'
    this._refreshFeatureValues()
  }

  _closeFeaturesPanel() {
    this.featuresPanel.style.display = 'none'
  }

  // Embeds the standalone Skin Designer site in an iframe rather than
  // porting its own ~2000 lines of painter/3D-preview code into this
  // codebase - one tool, one place it actually lives. The iframe's src
  // is left as "about:blank" in index.html and only pointed at the real
  // site the first time this panel opens, so a homepage visit that never
  // opens it never pays for loading a second whole app.
  _openSkinDesignerPanel() {
    this._closeAllMenuPanels()
    this.skindesignerPanel.style.display = 'flex'
    if (this.skindesignerFrame && this.skindesignerFrame.src === 'about:blank') {
      const theme = this.settings.uiTheme === 'old' ? 'old' : 'golden'
      this.skindesignerFrame.src = `${SKIN_DESIGNER_URL}?theme=${theme}`
    }
  }

  _closeSkinDesignerPanel() {
    this.skindesignerPanel.style.display = 'none'
  }

  // What each expandable GayZ Features list contains, straight from the
  // game's data: {id: {name, about}}. The descriptions live next to the
  // thing they describe (WEAPONS/MELEE_VARIANTS, ZOMBIE_TYPES, NIGHT_EVENTS,
  // Inventory.js's ITEM_INFO, MUTATOR_INFO/GAME_MODE_INFO here), so they
  // change in the same place the feature does. tests/docs.spec.js fails on
  // an entry with no description.
  // The lists GayZ Features builds from code. All of them (guns, zombie
  // types, night events, items, game modes, mutators) were the old Map 1's
  // and went with it (2026-10-05) - a new list goes here as id -> {name,
  // about}, shown under a [data-feature-list] in index.html.
  _featureCatalogs() {
    return {}
  }

  _featureCounts() {
    return {
      achievements: ACHIEVEMENTS.length,
    }
  }

  // The numbers (and a few name lists) inside GayZ Features descriptions,
  // read from the constants the game itself uses. scripts/check-docs.mjs
  // fails a commit that types a new number into that page instead of
  // adding one here and wrapping it in <span data-feature-value="...">.
  _featureValues() {
    const joinAnd = (names) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
    const crate = (tier) => CRATE_TIERS[tier]?.cost.toLocaleString('en-US')
    const supported = LANGUAGES.filter((l) => SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
    const coming = LANGUAGES.filter((l) => !SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
    return {
      goals: MAX_GOALS,
      defenseWaves: DEFENSE_WAVES,
      bossEvery: BOSS_HUNT_EVERY,
      upgrades: PLAY_META_UPGRADES.length,
      crateWood: crate('wood'),
      crateIce: crate('ice'),
      crateGolden: crate('golden'),
      outfits: COIN_SHOP_ITEMS.filter((i) => i.section === 'outfits').length,
      hats: COIN_SHOP_ITEMS.filter((i) => i.section === 'hats').length,
      marketFee: Math.round(MARKET_FEE_RATE * 100),
      chatMuteMinutes: ChatUI.CHAT_MUTE_MS / 60000,
      loginDays: LOGIN_CALENDAR_DAYS,
      languages: LANGUAGES.length,
      languagesSupported: joinAnd(supported),
      languagesComing: joinAnd(coming),
    }
  }

  // Builds every [data-feature-list] from its catalog (hand-written
  // data-extra items, which have no single thing in code, stay at the end),
  // and the one-line summary above each list from the same names. An entry
  // with no name or description is still shown, marked data-missing, so
  // tests/docs.spec.js can name it.
  _syncFeatureLists() {
    const catalogs = this._featureCatalogs()
    const pretty = (id) => id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase())
    this.featuresContent.querySelectorAll('[data-feature-list]').forEach((list) => {
      const key = list.dataset.featureList
      const catalog = catalogs[key]
      if (!catalog) return
      list.querySelectorAll('.detail-item[data-id]').forEach((el) => el.remove())
      const firstExtra = list.querySelector('.detail-item[data-extra]')
      for (const [id, { name, about }] of Object.entries(catalog)) {
        const item = document.createElement('div')
        item.className = 'detail-item'
        item.dataset.id = id
        if (!name || !about) item.dataset.missing = ''
        const b = document.createElement('b')
        b.textContent = name || pretty(id)
        item.appendChild(b)
        if (about) item.append(` — ${about}`)
        list.insertBefore(item, firstExtra)
      }
      const line = this.featuresContent.querySelector(`[data-feature-list-line="${key}"]`)
      if (line) {
        line.textContent = Object.entries(catalog).map(([id, { name }]) => (name || pretty(id)).replace(/ \(boss\)$/, '')).join(', ')
      }
    })
  }

  // Also run on every open, so a rebound key (the grapple's) shows up.
  _refreshFeatureValues() {
    if (!this.featuresContent) return
    const featureValues = this._featureValues()
    this.featuresContent.querySelectorAll('[data-feature-value]').forEach((el) => {
      const v = featureValues[el.dataset.featureValue]
      // 0 means a lookup broke (nothing on that page is really zero) - keep the HTML's number.
      if (v !== undefined && v !== null && v !== '' && v !== 0) el.textContent = String(v)
    })
  }

  _bindFeaturesPanel() {
    if (!this.featuresContent) return
    const categories = this.featuresContent.querySelectorAll('section.category')

    // TOC - one pill button per category, scrolling the internal
    // #features-content scroll area (not the page - this panel is a
    // fixed-size overlay, a plain <a href="#id"> anchor jump doesn't
    // reliably target content inside one).
    if (this.featuresToc) {
      const tocLinks = []
      categories.forEach((section) => {
        const heading = section.querySelector('h2')
        const link = document.createElement('button')
        link.type = 'button'
        link.className = 'features-toc-link'
        link.textContent = heading.textContent
        if (section.id === 'coming-soon') link.classList.add('coming-link')
        // 'auto' (instant), not 'smooth' - every other tab/section switch
        // in this game jumps instantly (Settings tabs, Clan tabs, etc.),
        // and smooth scroll's animation depends on the compositor thread
        // actually running each frame, which isn't guaranteed the moment
        // right after a panel opens.
        link.addEventListener('click', () => {
          section.scrollIntoView({ block: 'start', behavior: 'auto' })
          // Immediate feedback rather than waiting on the observer below,
          // which only re-fires after the (instant, but still async)
          // scroll actually settles a frame later.
          tocLinks.forEach((l) => l.classList.toggle('active', l === link))
        })
        this.featuresToc.appendChild(link)
        tocLinks.push(link)
      })

      // Highlight whichever section is currently in view as you scroll,
      // same "you're here" behavior as a normal page table-of-contents -
      // previously only :hover lit a link up, so the active section had
      // no visual indicator once you scrolled past the first one.
      if (tocLinks.length && 'IntersectionObserver' in window) {
        if (this._featuresTocObserver) this._featuresTocObserver.disconnect()
        const visibleRatios = new Map()
        this._featuresTocObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              visibleRatios.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0)
            })
            let bestSection = null
            let bestRatio = 0
            categories.forEach((section) => {
              const ratio = visibleRatios.get(section) || 0
              if (ratio > bestRatio) { bestRatio = ratio; bestSection = section }
            })
            if (bestSection) {
              const idx = [...categories].indexOf(bestSection)
              tocLinks.forEach((l, i) => l.classList.toggle('active', i === idx))
            }
          },
          { root: this.featuresContent, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
        )
        categories.forEach((section) => this._featuresTocObserver.observe(section))
        tocLinks[0].classList.add('active')
      }
    }

    // Expandable cards (weapons, mutators, zombie types, etc.) - click the
    // heading to reveal a per-item breakdown.
    this.featuresContent.querySelectorAll('.feature.expandable > h3').forEach((h3) => {
      h3.addEventListener('click', () => h3.closest('.feature').classList.toggle('open'))
    })

    // The expandable lists, their one-line summaries, the counts in the
    // headings and the numbers inside descriptions all come from the game's
    // own data, so they can't go stale the way hand-typed ones did ("15
    // firearms", "30 zombie types", "4 bosses" naming only 3 - all wrong by
    // 2026-10-04). The HTML keeps the descriptions and a fallback.
    this._syncFeatureLists()
    const featureCounts = this._featureCounts()
    this.featuresContent.querySelectorAll('[data-feature-count]').forEach((el) => {
      const n = featureCounts[el.dataset.featureCount]
      if (Number.isFinite(n) && n > 0) el.textContent = String(n)
    })
    this._refreshFeatureValues()

    if (this.featuresStatLive && this.featuresStatSoon) {
      this.featuresStatLive.textContent = this.featuresContent.querySelectorAll('section.category:not(#coming-soon) .feature').length
      this.featuresStatSoon.textContent = this.featuresContent.querySelectorAll('#coming-soon .feature').length
    }

    if (this.featuresSearch && this.featuresSearchCount) {
      const allFeatures = this.featuresContent.querySelectorAll('.feature')
      this.featuresSearch.addEventListener('input', () => {
        const q = this.featuresSearch.value.trim().toLowerCase()
        if (!q) {
          allFeatures.forEach((f) => f.classList.remove('hidden-search'))
          categories.forEach((c) => c.classList.remove('hidden-search'))
          this.featuresSearchCount.style.display = 'none'
          return
        }
        let matches = 0
        categories.forEach((section) => {
          let sectionHasMatch = false
          section.querySelectorAll('.feature').forEach((f) => {
            const hit = f.textContent.toLowerCase().includes(q)
            f.classList.toggle('hidden-search', !hit)
            if (hit) { sectionHasMatch = true; matches++ }
          })
          section.classList.toggle('hidden-search', !sectionHasMatch)
        })
        this.featuresSearchCount.style.display = 'block'
        this.featuresSearchCount.textContent = `${matches} feature${matches === 1 ? '' : 's'} found`
      })
    }

  }

  // Shop - was just a Crates placeholder (see this file's git history for
  // that and the even older Weapon Attachments UI before it), then a
  // preview-only skin with no purchase logic at all. Now real: 10,000
  // Gems, tracked via this.ownsShopSkin (shopProgress, see
  // loadShopProgress/saveShopProgress), buying immediately equips it via
  // the same settings.customSkinDataUrl path skin upload already uses -
  // there's no multi-skin wardrobe here, just this one purchasable skin,
  // so "buy" and "equip" are the same action. Weapon attachment purchasing
  // still has no UI anywhere right now either - see the Settings/Upgrades
  // attachment guide lists for what those items do, and
  // WeaponSystem.applyAttachment / saveShopProgress for the still-live
  // persistence of any already-owned attachments from before that change.
  static SHOP_SKIN_PRICE = 10000

  _openShopPanel() {
    this._closeAllMenuPanels()
    // Opened from the pause overlay (still on screen, unlocked) as well as
    // the main menu now that crates are buyable mid-run - hide it
    // explicitly rather than relying on DOM/paint order, same reasoning
    // (and fix) as _openUpgradesPanel's own comment: #pause-overlay comes
    // after #shop-panel in index.html and would otherwise render on top
    // and eat every click meant for a crate underneath it.
    this.shopPanel.style.display = 'flex'
    this.shopPanelTitle.textContent = t('shopPanelTitle')
    if (this.shopSkinCanvas) {
      if (!this._shopSkinAvatar3D) {
        this._shopSkinAvatar3D = new MenuAvatar3D(this.shopSkinCanvas)
        loadSkinTexture(SHOP_SKIN_PREVIEW_DATA_URL).then((skin) => {
          if (this._shopSkinAvatar3D) this._shopSkinAvatar3D.setSkin(skin)
        }).catch(() => {
          if (this._shopSkinAvatar3D) this._shopSkinAvatar3D.reveal()
        })
      }
      this._shopSkinAvatar3D.start()
    }
    this._renderShopSkinState()
    this._renderCrateTiers()
  }

  _renderShopSkinState() {
    if (this.shopSkinBadge) this.shopSkinBadge.style.display = this.ownsShopSkin ? '' : 'none'
    if (!this.shopSkinBuyBtn) return
    if (this.ownsShopSkin) {
      this.shopSkinBuyBtn.style.display = 'none'
      return
    }
    this.shopSkinBuyBtn.style.display = ''
    const short = this.gems < Game.SHOP_SKIN_PRICE
    this.shopSkinBuyBtn.disabled = short
    this.shopSkinBuyBtn.textContent = short ? t('shopSkinNeedMoreGems', { need: Game.SHOP_SKIN_PRICE - this.gems }) : t('shopSkinBuyBtn')
  }

  async _buyShopSkin() {
    if (this.ownsShopSkin || this.gems < Game.SHOP_SKIN_PRICE) return
    if (!window.confirm(t('shopSkinBuyConfirm'))) return
    this.gems -= Game.SHOP_SKIN_PRICE
    this.ownsShopSkin = true
    saveShopProgress(this)
    this._renderCurrencyBar()
    // Equip immediately - same sequence _bindSkinUpload's own upload
    // handler uses (settings.customSkinDataUrl + menu avatar + corner
    // photo + third-person body), just sourced from the fixed shop skin
    // data URL instead of an uploaded file.
    this.settings.customSkinDataUrl = SHOP_SKIN_PREVIEW_DATA_URL
    saveSettings(this.settings)
    const skin = await loadSkinTexture(SHOP_SKIN_PREVIEW_DATA_URL)
    if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
    this._updateMenuAvatarPhoto(skin)
    this._renderShopSkinState()
    this._showHomepageToast(t('shopSkinBuySuccess'))
  }

  _closeShopPanel() {
    // _closeAllMenuPanels() calls this unconditionally as blanket cleanup
    // every time ANY panel opens mid-run (Settings, Upgrades, etc.), not
    // just when Shop was actually the one open. Without this guard, opening
    // Settings from the pause menu re-flexed #pause-overlay right after
    // _toggleSettings had just hidden it - both ended up visible at the
    // same z-index (15), and #pause-overlay (later in the DOM) silently ate
    // every click meant for a Settings control underneath it. Only restore
    // the pause overlay when Shop was genuinely the panel being closed.
    this.shopPanel.style.display = 'none'
    if (this._shopSkinAvatar3D) this._shopSkinAvatar3D.stop()
  }

  // What's New panel - split out from Credits (used to be one combined
  // panel/nav entry point for both) so the changelog/build info content
  // has its own dedicated place, distinct from the static dev-credits
  // prose.
  _openWhatsNewPanel() {
    if (!this.whatsNewPanel) return
    this._closeAllMenuPanels()
    this.whatsNewPanel.style.display = 'flex'
    if (this.whatsNewPanelTitle) this.whatsNewPanelTitle.textContent = t('whatsNewPanelTitle')
    if (this.buildVersionLine) this.buildVersionLine.textContent = t('buildVersionLine')
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

  _closeWhatsNewPanel() {
    if (this.whatsNewPanel) this.whatsNewPanel.style.display = 'none'
  }

  // Used to show only during an old Map 1 run (the old city kept running
  // behind the menu); with that gone it's the same as a homepage toast -
  // before this, every Settings copy/export message here was silent.
  _showLoreToast(text) {
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

    // Gems - earned per completed run from two independent sources, added
    // together: 1 gem per 5 nights survived (5=1, 10=2, 15=3...) and 1 gem
    // per 50 kills (50=1, 100=2, 150=3...). No shop use for them yet
    // (display-only for now, per direct request), same "build the earn
    // side now, spend side later" precedent as the empty Settings >
    // General tab. Dying before reaching either threshold naturally earns
    // 0 from that source (Math.floor of a value under the first tier is
    // 0) - no separate zero-case needed. Saved explicitly here rather
    // than relying on a later _updateStatsPanel() piggyback call, since
    // this runs strictly before that in both the death and survive-to-
    // dawn call sites.
    const nightsGems = Math.floor(this.night / 5)
    const killsGems = Math.floor(this.kills / 50)
    const gemsEarned = nightsGems + killsGems
    if (gemsEarned > 0) {
      this.gems += gemsEarned
      saveShopProgress(this)
    }
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

    // Cloud Save auto-sync - best-effort, only if already signed in (never
    // prompts here; a mid-game consent popup would be jarring). See
    // pushToCloud's own comment on why manual=false swallows errors.
    CloudSaveUI.pushToCloud(this, false)
    this._pushOnlineStats()
  }

  // Real Minecraft skin upload (see MenuAvatar3D.js's UV-mapping support)
  // - Upload Skin reads a PNG straight from the player's computer, Reset
  // goes back to the default flat-color character. Both buttons live in
  // the Profile panel, next to the character.
  _bindSkinUpload() {
    const uploadBtn = document.getElementById('upload-skin-btn')
    const input = document.getElementById('upload-skin-input')
    const resetBtn = document.getElementById('reset-skin-btn')
    if (!uploadBtn || !input || !resetBtn) return
    if (this.settings.customSkinDataUrl) resetBtn.style.display = ''

    uploadBtn.addEventListener('click', () => input.click())

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0]
      input.value = '' // lets the same filename be re-selected later
      if (!file) return
      let skin
      try {
        skin = await loadSkinTexture(file)
      } catch {
        this._showHomepageToast(t('skinUploadFailedToast'))
        return
      }
      // Every real Minecraft skin is 64px wide, 64px (modern) or 32px
      // (legacy) tall - anything else almost certainly isn't a skin file
      // and would just paint garbage across the character's faces.
      if (skin.width !== 64 || (skin.height !== 64 && skin.height !== 32)) {
        this._showHomepageToast(t('skinUploadWrongSizeToast'))
        return
      }
      let dataUrl
      try {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        dataUrl = `data:image/png;base64,${btoa(binary)}`
      } catch {
        this._showHomepageToast(t('skinUploadFailedToast'))
        return
      }
      this.settings.customSkinDataUrl = dataUrl
      saveSettings(this.settings)
      if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
      this._updateMenuAvatarPhoto(skin)
      resetBtn.style.display = ''
      this._showHomepageToast(t('skinUploadSuccessToast'))
    })

    resetBtn.addEventListener('click', async () => {
      this.settings.customSkinDataUrl = null
      saveSettings(this.settings)
      if (this._menuAvatar3D) this._menuAvatar3D.setSkin(null)
      resetBtn.style.display = 'none'
      this._showHomepageToast(t('skinResetToast'))
      // Corner photo badge has no flat-color fallback of its own (unlike
      // the 3D avatar) - re-derive it from the bundled default skin rather
      // than leaving the just-removed custom photo up on screen.
      await this._applyDefaultBundledSkin()
    })
  }

  // Crops the classic 8x8 "face" square (see MenuAvatar3D.js's
  // _partFaceRects - always at pixel (8,8) in every skin regardless of
  // legacy/modern format, since the overlay-compositing loop in
  // loadSkinTexture() pastes onto that same base position) out of an
  // already-loaded skin texture and puts it on the corner profile badge.
  // texture.image is a plain 2D <canvas> (see loadSkinTexture), so this is
  // a synchronous 2D crop - no extra render pass needed.
  _updateMenuAvatarPhoto(skin) {
    if (!this.menuAvatarPhoto) return
    const face = document.createElement('canvas')
    face.width = 64
    face.height = 64
    const fctx = face.getContext('2d')
    fctx.imageSmoothingEnabled = false
    fctx.drawImage(skin.texture.image, 8, 8, 8, 8, 0, 0, 64, 64)
    // Hat layer on top of the face - loadSkinTexture no longer flattens the
    // overlay onto the base, so the badge composites it itself (only when
    // the 3D character actually shows a hat, see overlayParts).
    if (skin.overlayParts && skin.overlayParts.has('head')) fctx.drawImage(skin.texture.image, 40, 8, 8, 8, 0, 0, 64, 64)
    const dataUrl = face.toDataURL('image/png')
    this.menuAvatarPhoto.src = dataUrl
    this.menuAvatarPhoto.classList.remove('loading')
    // Cached separately from settings.customSkinDataUrl (the full 64x64
    // skin file) - this is just the small pre-cropped face, read by
    // index.html's own inline anti-flash script on the very next load so
    // the corner badge never has to show the anonymous placeholder again.
    try {
      localStorage.setItem('gayz-avatar-face-cache', dataUrl)
    } catch {
      // Deliberately swallowed: this is just a nice-to-have pre-crop cache
      // (see comment above) - private browsing / storage-full / quota
      // errors here shouldn't block setting the avatar photo itself.
    }
    this.menuAvatarPhoto.style.display = ''
  }

  // Restores a previously-uploaded skin on page load - async (image
  // decode), so the avatar briefly shows the default character first,
  // same as any other image that takes a moment to load in.
  async _applyStoredSkin() {
    let skin
    try {
      skin = await loadSkinTexture(this.settings.customSkinDataUrl)
    } catch {
      // Corrupted/unreadable stored data - fall back to default rather
      // than getting stuck, and stop treating it as set so this doesn't
      // retry forever on every future load.
      this.settings.customSkinDataUrl = null
      saveSettings(this.settings)
      return
    }
    if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
    this._updateMenuAvatarPhoto(skin)
  }

  // The actual default look for every player who hasn't uploaded their
  // own skin - a real skin file (public/images/default-skin.png), not
  // the old hand-guessed flat-color character. That flat-color builder
  // (see MenuAvatar3D.js's buildCharacter with no skin argument) still
  // renders first and stays as the fallback if this fails to load, same
  // "briefly shows default, then swaps in" pattern as an uploaded skin.
  async _applyDefaultBundledSkin() {
    let skin
    try {
      // Embedded data URL, not a '/images/default-skin.png' network fetch -
      // no request round trip means this resolves within a frame or two
      // instead of tens/hundreds of ms, closing most of the gap where the
      // old flat-color placeholder used to be visible on reload (the rest
      // is covered by MenuAvatar3D's own hide-until-revealed canvas).
      skin = await loadSkinTexture(DEFAULT_SKIN_DATA_URL)
    } catch {
      if (this._menuAvatar3D) this._menuAvatar3D.reveal()
      return
    }
    if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
    this._updateMenuAvatarPhoto(skin)
  }

  // Local Profile screen - read-only aggregation of stats already
  // persisted elsewhere (careerStats/bestStats/achievements/prestige/
  // nemesis), no new tracking of its own besides the Nemesis record.
  async _openProfilePanel() {
    this._closeAllMenuPanels()
    this.profilePanel.style.display = 'flex'
    this.profilePanelTitle.textContent = t('profilePanelTitle')
    // Waits for the first real auth check (see _authReadyPromise's own
    // comment) before deciding signed-in vs signed-out - without this, a
    // player who opens Profile quickly after the page loads could see the
    // signed-out gate for a moment even though they're already signed in,
    // and clicking Login there would trigger a real (unnecessary) second
    // Google sign-in popup. Resolves instantly once the very first check
    // of the session has already happened, so this only ever adds a real
    // wait during that initial window.
    await this._authReadyPromise
    // Signed-out players get a black screen + typewriter Login/Register
    // prompt instead of the profile itself - everything below this branch
    // (stats, bio, highlights, the 3D avatar, etc.) is real profile
    // content that a guest no longer sees at all, not just cosmetically
    // hidden behind it.
    if (!this._cloudUid) {
      if (this.profileContent) this.profileContent.style.display = 'none'
      if (this.profileLoginGate) this.profileLoginGate.style.display = 'flex'
      if (this.profileLoginGateText) {
        this.profileLoginGateText.textContent = t('profileLoginGateText')
        // Re-trigger the CSS typewriter animation every time the gate is
        // shown (same remove/reflow/add trick #lore-toast uses) - it only
        // plays once per element by default, so re-opening Profile a
        // second time would otherwise show static already-typed text.
        this.profileLoginGateText.style.animation = 'none'
        void this.profileLoginGateText.offsetWidth
        this.profileLoginGateText.style.animation = ''
      }
      if (this.profileGateLoginBtn) this.profileGateLoginBtn.textContent = t('profileLoginBtn')
      if (this.profileGateRegisterBtn) this.profileGateRegisterBtn.textContent = t('profileRegisterBtn')
      return
    }
    if (this.profileContent) this.profileContent.style.display = ''
    if (this.profileLoginGate) this.profileLoginGate.style.display = 'none'
    this._renderPublicProfileSection()
    this._drawStatsDashboard()
    // Cosmetics counter - outfits+hats only.
    const cosmeticsOwned = this.ownedOutfits.size + this.ownedHats.size
    const cosmeticsTotal = COIN_SHOP_ITEMS.filter((i) => i.outfit || i.hat).length

    // Hall of Records - a single completion % averaging 4 existing
    // collection ratios (achievements/bestiary/cosmetics/weapon grandmaster)
    // into one number none of those systems compute on their own. Checked
    // here at display time, same "purely derived, no new tracking" pattern
    // the prestigeUnlocked toggle in _renderUpgradesOptions already uses.
    const totalGuns = this.weapons.weapons.filter((w) => !w.melee).length
    // Each ratio clamped to 1 - every Set behind these (achievements.unlocked,
    // bestiaryEncountered, ownedOutfits/ownedHats, weaponMastery.grandmastered)
    // is restored from localStorage with no validation against the real id
    // list (see CLAUDE.md's "every persisted stat is untrusted" note), so a
    // crafted Import Save file can inflate any one of them arbitrarily -
    // without this clamp, a single inflated ratio (e.g. 50x its real max)
    // would drag the averaged completionPct over 100 by itself and falsely
    // trigger the Hall of Records coin reward below even with the other 3
    // ratios still at 0.
    const completionRatios = [
      this.achievements.unlocked.size / ACHIEVEMENTS.length,
      this.bestiaryEncountered.size / Object.values(ZOMBIE_TYPES).length,
      cosmeticsTotal > 0 ? cosmeticsOwned / cosmeticsTotal : 0,
      totalGuns > 0 ? this.weaponMastery.grandmastered.size / totalGuns : 0,
    ].map((r) => Math.min(1, r))
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
      // Same tier color as the homepage's #menu-prestige-badge (see
      // _updatePrestigeBadge) - prestige only ever showed its color in that
      // one homepage spot before; this carries the same visual identity
      // into the Profile panel instead of a plain number.
      ['profilePrestige', t('profilePrestige'), this.metaProgress.prestigeLevel > 0
        ? `<span class="prestige-tier-${this.metaProgress.prestigeLevel >= 6 ? 3 : this.metaProgress.prestigeLevel >= 3 ? 2 : 1}">${_safeStatNumber(this.metaProgress.prestigeLevel)}</span>`
        : _safeStatNumber(this.metaProgress.prestigeLevel)],
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
    // Each category renders as its own card (see .profile-stat-card in
    // style.css) instead of a bare heading over a flat row list - the
    // previous version packed ~40 rows into one dense 5-column grid with
    // near-zero row spacing specifically to avoid extra scroll height, but
    // read as cramped (this panel already scrolls, so that tradeoff no
    // longer needs to be so extreme).
    this.profileOptions.innerHTML =
      (pinnedRow ? rowButton(pinnedRow) : '') +
      grouped.map(([labelKey, groupRows]) => `
        <div class="profile-stat-card">
          <h3 class="settings-section-heading">${t(labelKey)}</h3>
          ${groupRows.map(rowButton).join('')}
        </div>
      `).join('')
    this._animateStatCountUp()

    // Career Portrait - gated the same as Prestige (see _renderUpgradesOptions),
    // "beaten the game" being the bar for a capstone memento worth keeping.
    if (this.profileCareerPortraitBtn) {
      this.profileCareerPortraitBtn.style.display = this.achievements.unlocked.has('true_ending') ? 'block' : 'none'
      this.profileCareerPortraitBtn.textContent = t('profileCareerPortraitBtn')
    }

    this._renderProfileBio()
    this._renderProfileAccountRow()
    this._updateBestStatsDisplay()
    this._renderNearlyThereNudge()
    this._renderAnniversaryLine()
    this._renderProfileCreated()
    this._renderTodayLine()
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
    const statsDashboardHeading = document.getElementById('stats-dashboard-heading')
    if (statsDashboardHeading) statsDashboardHeading.textContent = t('statsDashboardHeading')
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
          if (this.settings.selectedGoals.length >= MAX_GOALS) this.settings.selectedGoals.shift()
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
  // right now. Written to two places - Profile's own copy and the
  // standalone Levels panel's copy - same markup, same data, so they can
  // never drift apart from each other.
  _renderRankRoadmap() {
    if (!this.rankRoadmapList && !this.levelsRoadmapList) return
    if (this.rankRoadmapHeading) this.rankRoadmapHeading.textContent = t('rankRoadmapHeading')
    const kills = _safeStatNumber(this.careerStats.totalKills)
    const html = CAREER_RANK_TITLES.map((tier, i) => {
      const reached = kills >= tier.min
      const isCurrent = reached && (i === CAREER_RANK_TITLES.length - 1 || kills < CAREER_RANK_TITLES[i + 1].min)
      return `
        <button class="perk-option${isCurrent ? ' active' : ''}" disabled>
          <span class="perk-name">${reached ? '✓ ' : ''}${t(tier.titleKey)}</span>
          <span class="perk-cost">${t('rankRoadmapThreshold', { n: tier.min.toLocaleString() })}</span>
        </button>
      `
    }).join('')
    if (this.rankRoadmapList) this.rankRoadmapList.innerHTML = html
    if (this.levelsRoadmapList) this.levelsRoadmapList.innerHTML = html
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

  // Public Profile section (see _openProfilePanel) - mirrors exactly what
  // CloudSync.pushLeaderboardEntry actually writes to the public-read
  // leaderboard/{uid} doc (name, bestNight, bestKills, bestKillStreak,
  // achievementCount, playerId, optional region/clanId), the same fields
  // _openOtherPlayerProfile shows a friend who looks this account up by
  // #ID. Deliberately reads this.bestStats/this.settings directly rather
  // than re-deriving anything, so it can never drift from what actually
  // gets pushed - if _pushOnlineStats' own entry object ever changes,
  // update this alongside it.
  _renderPublicProfileSection() {
    if (!this.profilePublicNameValue) return
    const name = this.settings.anonymousLeaderboard ? t('anonymousLeaderboardName') : (this.settings.nickname || t('menuPlayerTagDefault'))
    this.profilePublicNameValue.textContent = name
    this.profilePublicIdValue.textContent = this.settings.playerId ? `#${this.settings.playerId}` : '--'
    this.profilePublicBestnightValue.textContent = _safeStatNumber(this.bestStats.bestNight)
    this.profilePublicBestkillsValue.textContent = _safeStatNumber(this.bestStats.bestKills)
    this.profilePublicBeststreakValue.textContent = _safeStatNumber(this.bestStats.bestKillStreak)
    this.profilePublicAchievementsValue.textContent = this.achievements.unlocked.size
    // Same enum keys the region <select> already uses (see its own
    // auto-mapping table entry) - no new i18n keys needed.
    const REGION_LABEL_KEYS = { na: 'optRegionNa', eu: 'optRegionEu', asia: 'optRegionAsia', sa: 'optRegionSa', oceania: 'optRegionOceania', africa: 'optRegionAfrica' }
    const regionKey = REGION_LABEL_KEYS[this.settings.region]
    if (this.profilePublicRegionRow) this.profilePublicRegionRow.style.display = regionKey ? 'flex' : 'none'
    if (regionKey && this.profilePublicRegionValue) this.profilePublicRegionValue.textContent = t(regionKey)
    if (this.profilePublicClanRow) this.profilePublicClanRow.style.display = this.settings.clanTag ? 'flex' : 'none'
    if (this.settings.clanTag && this.profilePublicClanValue) this.profilePublicClanValue.textContent = this.settings.clanTag
  }

  // Profile bio - free text, capped at 250 chars (enforced both by the
  // textarea's own maxlength and here, since a paste can exceed maxlength).
  _renderProfileBio() {
    if (!this.profileBioInput) return
    if (this.profileBioHeading) this.profileBioHeading.textContent = t('profileBioHeading')
    this.profileBioInput.placeholder = t('profileBioPlaceholder')
    this.profileBioInput.value = this.settings.bio || ''
    this._renderProfileBioCounter()
  }

  _renderProfileBioCounter() {
    if (!this.profileBioCounter) return
    // No "/250" cap shown anymore (2026-09-23, "no limit, write as much
    // as you want") - just the running character count.
    this.profileBioCounter.textContent = `${(this.settings.bio || '').length}`
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
  // clearInterval). While signed in, uses Google's own account-creation
  // timestamp (CloudSync's accountCreatedAt on _cloudProfile) - a real
  // value from Google that's the same on every device and can't drift.
  // Signed out (or never signed in), falls back to
  // careerStats.accountCreatedAt - a real millisecond timestamp set once,
  // the very first time the game ever constructed on THIS device (see the
  // constructor, right after loadCareerStats()) - not firstPlayedDate
  // above, which only covers players who've finished at least one run and
  // has no time-of-day precision. Using the local one while signed in
  // used to be the only option, and looked like it "reset" whenever
  // cloud sync round-tripped through a different device/cleared storage.
  _renderProfileCreated() {
    if (!this.profileCreatedLine) return
    if (this.profileCreatedTitle) this.profileCreatedTitle.textContent = t('profileCreatedTitle')
    if (this._profileCreatedTickInterval) clearInterval(this._profileCreatedTickInterval)
    const tick = () => {
      const source = (this._cloudProfile && this._cloudProfile.accountCreatedAt) || this.careerStats.accountCreatedAt
      const elapsedMs = Math.max(0, Date.now() - _safeStatNumber(source))
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
    // Bio/Motto (now part of Shown to Public, see _pushOnlineStats) can be
    // edited without ever finishing a run - _pushOnlineStats otherwise only
    // fires on run-end (_recordRunEnd), which would leave a same-session
    // bio/motto edit stuck showing the old value to other players until
    // the player's next completed run. Firing it here too (closing the
    // panel is the natural "done editing" moment) covers that gap without
    // pushing on every keystroke.
    this._pushOnlineStats()
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
    const canvas = document.createElement('canvas')
    canvas.width = 1280
    canvas.height = 720
    const ctx = canvas.getContext('2d')
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height)
    bg.addColorStop(0, '#2a2418')
    bg.addColorStop(1, '#0d0b08')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)

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

    this._finalizeScreenshotCanvas(canvas)
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

  // Reads a ?importskin=<base64 PNG, no data: prefix> param - the GayZ
  // Character Skin Designer tool's "Send to GayZ" button builds this link
  // so a custom skin can be applied without a manual download+upload round
  // trip. loadSkinTexture() itself is the validation step here (rejects
  // anything that isn't a real decodable image), not a hand-rolled check -
  // same untrusted-URL-input caution as _checkBeatThisChallenge/
  // _checkSetupCode, just async since image decoding is.
  _checkImportSkinCode() {
    const raw = new URLSearchParams(location.search).get('importskin')
    if (!raw) return
    // decodeURIComponent here is redundant - URLSearchParams.get() already
    // decodes the param - but harmless on its own (a clean base64 string
    // has no % in it for this to act on). Kept rather than pulled, since a
    // real, separately-confirmed bug (see the dataUrl note below) was
    // initially mistaken for this on first read - worth a name to warn the
    // next person off going down that same dead end again.
    const raw2 = decodeURIComponent(raw)
    const dataUrl = `data:image/png;base64,${raw2}`
    this._applyImportedSkin(dataUrl).finally(() => {
      // One-shot - strip the (very long) param so a refresh doesn't try to
      // re-apply it and so the URL bar doesn't stay full of base64 forever.
      const clean = new URL(location.href)
      clean.searchParams.delete('importskin')
      history.replaceState(null, '', clean)
    })
  }

  // Shared by ?importskin= above and the embedded Skin Designer's
  // postMessage (see _bindSkinDesignerMessages).
  _applyImportedSkin(dataUrl) {
    return loadSkinTexture(dataUrl).then((skin) => {
      // Real report, 2026-09-27: the ?importskin= string this decodes to
      // was observed CORRUPTED (right length prefix/suffix, wrong overall
      // length) roughly every other real attempt - looked exactly like a
      // race, but never pinned to one exact line despite real effort (this
      // account has Cloud Save on, and its own async settings
      // pull/merge/push around this same page-load window was the leading
      // suspect, never fully confirmed). Rather than keep chasing an
      // intermittent race with no repro I fully control, storing
      // skin.texture.image (the plain <canvas> loadSkinTexture() already
      // built from the image THAT ACTUALLY, SUCCESSFULLY DECODED) instead
      // of the original transported dataUrl sidesteps the whole class of
      // "the string got mangled somewhere in transit" bug - whatever the
      // real cause turns out to be, this can't inherit its corruption,
      // since it's derived fresh from pixels the browser already proved
      // it could read correctly.
      const cleanDataUrl = skin.texture.image.toDataURL('image/png')
      this.settings.customSkinDataUrl = cleanDataUrl
      saveSettings(this.settings)
      if (this._menuAvatar3D) this._menuAvatar3D.setSkin(skin)
      this._updateMenuAvatarPhoto(skin)
      this._showHomepageToast(t('importSkinApplied'))
    }).catch(() => {
      this._showHomepageToast(t('importSkinFailed'))
    })
  }

  // "Send to GayZ" inside the embedded Skin Designer posts the skin here
  // instead of opening a second game tab - that second tab was how skins
  // got lost on phones (the original tab, still holding the old settings,
  // saved over the new skin when you went back to it). Only accepted from
  // our own designer iframe; loadSkinTexture() still validates the image.
  _bindSkinDesignerMessages() {
    window.addEventListener('message', (event) => {
      if (event.origin !== SKIN_DESIGNER_ORIGIN) return
      if (!this.skindesignerFrame || event.source !== this.skindesignerFrame.contentWindow) return
      const data = event.data
      if (!data || data.type !== 'gayz-import-skin' || typeof data.dataUrl !== 'string') return
      if (!data.dataUrl.startsWith('data:image/png;base64,') || data.dataUrl.length > 200000) return
      this._closeSkinDesignerPanel()
      this._applyImportedSkin(data.dataUrl)
    })
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
    // Show What's New Every Launch (General tab) - bypasses the normal
    // "only entries newer than my last visit" gate below and just shows
    // the most recent entries unconditionally, for anyone who wants the
    // reminder every time rather than only once per real update.
    let newEntries
    if (this.settings.whatsNewEveryLaunch) {
      newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry')).slice(0, 3)
    } else {
      const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
      if (!lastViewed) return
      newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry')).filter((el) => {
        const parsed = Date.parse(el.querySelector('.changelog-date')?.textContent || '')
        return !isNaN(parsed) && parsed > lastViewed
      })
    }
    if (!newEntries.length) return
    this.whatsNewDigestTitle.textContent = t('whatsNewDigestTitle', { n: newEntries.length })
    // Our own static patch notes (index.html), never player data - the
    // bullet lists are copied as they are.
    this.whatsNewDigestList.innerHTML = newEntries.map((el) => `<div class="changelog-text">${el.querySelector('.changelog-text')?.innerHTML || ''}</div>`).join('')
    this.whatsNewDigest.style.display = 'block'
    this.whatsNewDigest.classList.remove('fading')
    // Auto-fade after 10s if left untouched (2026-09-18) - it used to just
    // sit open indefinitely until the player noticed the X, which meant it
    // was still covering the corner of the screen in every homepage
    // screenshot from an entire play session. Cleared if the player closes
    // it manually first, and the Play button click handler below also
    // triggers this same fade immediately, so it never carries into an
    // actual run.
    this._whatsNewDigestFadeTimer = setTimeout(() => this._fadeOutWhatsNewDigest(), 10000)
  }

  // Shared by the 10s idle timer above and the Play button click handler -
  // fades instead of vanishing instantly (see .fading in style.css), then
  // actually hides it once the transition finishes so it's not sitting
  // there invisible-but-still-in-the-DOM. Deliberately does NOT mark the
  // digest as seen or touch the What's New dot, unlike the explicit X
  // close button - the player never actually read it, so it should still
  // show again next launch, same as if they'd never seen it at all.
  _fadeOutWhatsNewDigest() {
    if (!this.whatsNewDigest || this.whatsNewDigest.style.display === 'none') return
    clearTimeout(this._whatsNewDigestFadeTimer)
    this.whatsNewDigest.classList.add('fading')
    setTimeout(() => { this.whatsNewDigest.style.display = 'none' }, 600)
  }

  // Friend presence heartbeat - runs for the whole page lifetime (not just
  // while the Friends panel is open), so a friend can see you're online
  // even while you're mid-run. Skips the write entirely (rather than
  // writing an "invisible" flag for others to check) whenever signed out,
  // Cloud Save isn't configured, or the player has "Hide my online status
  // from friends" on - simplest way to actually hide: never publish a
  // fresh timestamp, so your last real one just ages past
  // FRIEND_OFFLINE_THRESHOLD_MS and you read as offline to everyone.
  _startPresenceHeartbeat() {
    const tick = () => {
      if (!this._cloudUid || !CloudSync.isConfigured() || this.settings.statusMode === 'offline') return
      CloudSync.updateLastActive(this._cloudUid, this.settings.statusMode === 'dnd', this.settings.statusMode === 'idle').catch(() => {})
    }
    tick()
    setInterval(tick, FRIEND_HEARTBEAT_INTERVAL_MS)
  }

  // Applies the player's chosen Status pill (Online/Idle/Do Not
  // Disturb/Offline) - highlights the active pick and immediately pushes
  // a fresh heartbeat so the change reflects to friends right away instead
  // of waiting for the next periodic tick.
  _applyStatusMode(mode) {
    this.settings.statusMode = mode
    saveSettings(this.settings)
    this._renderStatusPicker()
    if (this._cloudUid && CloudSync.isConfigured()) {
      if (mode === 'offline') return
      CloudSync.updateLastActive(this._cloudUid, mode === 'dnd', mode === 'idle').catch(() => {})
    }
  }

  _renderStatusPicker() {
    if (!this.statusPickBtns) return
    const mode = this.settings.statusMode
    for (const btn of this.statusPickBtns) {
      btn.classList.toggle('active', btn.dataset.status === mode)
    }
    const labels = { online: t('friendStatusOnline'), idle: t('friendStatusIdle'), dnd: t('friendStatusDnd'), offline: t('friendStatusOffline') }
    if (this.statusPickerDot) this.statusPickerDot.dataset.status = mode
    if (this.statusPickerLabel) this.statusPickerLabel.textContent = labels[mode] || labels.online
  }

  // Friend-beats-you notification - checks each saved friend's real public
  // leaderboard entry once per page load, bounded to the capped-at-5
  // savedFriends list. friendBeatNotified tracks {name, night} pairs
  // already shown so this doesn't re-toast the same fact on every visit -
  // only fires again if that friend's bestNight climbs even higher, and
  // clears once you catch back up (so a real future overtake notifies
  // again instead of staying silently suppressed forever).
  // Looks up by the friend's stable uid (fetchLeaderboardEntryByUid) when
  // one is on hand - every savedFriends entry added via the current
  // Accept Friend Request flow has one (see _respondToFriendRequest) - and
  // only falls back to the name-based query for a pre-uid legacy entry
  // (loadSettings' savedFriends normalizer sets uid: null for those). A
  // name lookup can silently match the WRONG account (nicknames aren't
  // unique - see fetchLeaderboardEntryByName's own comment) or stop
  // matching your actual friend the moment they rename, exactly the
  // ambiguity the uid field was added to avoid elsewhere.
  async _checkFriendBeatNotifications() {
    if (!CloudSync.isConfigured() || !this.settings.savedFriends.length) return
    const myNight = _safeStatNumber(this.bestStats.bestNight)
    const stillRelevant = []
    for (const f of this.settings.savedFriends) {
      const name = f.name
      let entry
      try {
        entry = f.uid ? await CloudSync.fetchLeaderboardEntryByUid(f.uid) : await CloudSync.fetchLeaderboardEntryByName(name)
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
    const w = this.weapons.getSummary().find((w) => w.id === bestId)
    return w ? t(w.nameKey) : bestId
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


  // Confetti burst on a new personal best (see _recordRunEnd's
  // _pendingConfetti flag) - a handful of plain colored divs falling and
  // fading via CSS, no canvas/library, auto-removed after the animation
  // ends. Skipped entirely under prefers-reduced-motion.
  _fireConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const colors = ['#e0c03e', '#7fd88f', '#6fa8dc', '#c9564a', '#b07cd6']
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

  // Prevents the sidebar nav buttons (General/Store/Upgrades/etc.) from
  // ever receiving keyboard-style focus from a mouse click at all -
  // reported as a stray rectangle appearing around the button after
  // clicking it (most visible against the Old theme's more ornate plaque
  // art, whose non-rectangular shape a plain focus rectangle never
  // followed anyway). An earlier CSS-only attempt
  // (#menu-nav-buttons button:focus:not(:focus-visible)) relies on the
  // browser's own mouse-vs-keyboard heuristic for :focus-visible, which
  // didn't reliably suppress it in the real browser this was reported
  // from even after a hard refresh confirmed the new CSS was loaded -
  // this is the more forceful, browser-heuristic-independent fix:
  // preventing default on mousedown stops the browser from ever moving
  // focus to the button in the first place for a mouse interaction, so
  // no focus-dependent style (this rule's own outline included) has
  // anything to key off. The click event itself still fires normally -
  // preventing mousedown's default only cancels the incidental focus
  // that comes with it, not the click. Real keyboard Tab navigation is
  // untouched (Tab never dispatches mousedown), so keyboard focus/
  // activation and the opt-in Focus Ring Mode setting both still work.
  _bindNavButtonFocusFix() {
    const nav = document.getElementById('menu-nav-buttons')
    if (!nav) return
    nav.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault()
    })
  }

  // Clan section (Hub panel) - see docs/superpowers/specs/
  // 2026-08-26-clan-system-design.md. Create/Join wiring here;
  // _refreshClanUi() (below) is the single source of truth for which of
  // the two UI states shows and what's in it.
  _bindClanSection() {
    // Click-outside-to-close, same pattern as #coming-soon-panel's own
    // listener - only the backdrop itself (not any inner content) closes it.
    if (this.clanPanel) {
      this.clanPanel.addEventListener('click', (e) => {
        if (e.target === this.clanPanel) this._closeClanPanel()
      })
    }

    if (this.clanCreateBtn) {
      this.clanCreateBtn.addEventListener('click', async () => {
        if (!this._cloudUid) return
        const name = this.clanCreateNameInput.value.trim()
        if (!name) return
        // Keyboard-only check mirrors the security rule's own name.matches()
        // pattern (see FIRESTORE_SECURITY_RULES) - catches it here with an
        // immediate message instead of a generic failure after a rejected
        // write.
        if (!/^[ -~]+$/.test(name)) {
          this.clanCreateTakenWarning.textContent = t('clanNameInvalidChars')
          this.clanCreateTakenWarning.style.display = 'block'
          return
        }
        const existing = await CloudSync.fetchClanByName(name).catch(() => null)
        if (existing) {
          this.clanCreateTakenWarning.textContent = t('clanNameTakenWarning')
          this.clanCreateTakenWarning.style.display = 'block'
          return
        }
        this.clanCreateTakenWarning.style.display = 'none'
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        const clanId = await CloudSync.createClan(this._cloudUid, nickname, name).catch(() => null)
        if (!clanId) return
        this.settings.clanId = clanId
        this.settings.clanName = name
        saveSettings(this.settings)
        this._renderPlayerTag()
        this._refreshClanUi()
      })
    }

    // "Make Clan" toggles the create-name/tag form open/closed rather
    // than navigating anywhere - the form and the all-clans list both
    // live in the same browse state.
    if (this.clanMakeBtn) {
      this.clanMakeBtn.addEventListener('click', () => {
        if (!this._cloudUid) return
        this.clanMakeForm.style.display = this.clanMakeForm.style.display === 'none' ? 'block' : 'none'
      })
    }

    // Request to Join by typing a clan's name (beside Make Clan) -
    // alternative to clicking a row in the all-clans list below, same
    // end result (a join request).
    if (this.clanRequestNameBtn) {
      this.clanRequestNameBtn.addEventListener('click', async () => {
        if (!this._cloudUid) return
        const name = this.clanRequestNameInput.value.trim()
        if (!name) return
        const clan = await CloudSync.fetchClanByName(name).catch(() => null)
        if (!clan) {
          this.clanRequestNameStatus.textContent = t('clanNotFound')
          this.clanRequestNameStatus.style.display = 'block'
          return
        }
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        await CloudSync.sendJoinRequest(clan.clanId, this._cloudUid, nickname).catch(() => {})
        this.clanRequestNameStatus.textContent = t('clanRequestSent')
        this.clanRequestNameStatus.style.display = 'block'
      })
    }

    // Request to Join, from the all-clans list (event delegation - the
    // list is re-rendered on every refresh, so per-row listeners would leak).
    if (this.clanAllList) {
      this.clanAllList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.clan-list-join-btn')
        if (!btn || !this._cloudUid) return
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        await CloudSync.sendJoinRequest(btn.dataset.clanId, this._cloudUid, nickname).catch(() => {})
        btn.textContent = t('clanRequestSent')
        btn.disabled = true
      })
    }

    // Incoming clan invites (browse state, not yet in a clan) - Accept
    // creates your own member doc (the security rule only allows this
    // because the invite doc exists), Decline just clears it.
    if (this.clanIncomingInvitesList) {
      this.clanIncomingInvitesList.addEventListener('click', async (e) => {
        const acceptBtn = e.target.closest('.clan-invite-accept-btn')
        const declineBtn = e.target.closest('.clan-invite-decline-btn')
        if (!this._cloudUid) return
        if (acceptBtn) {
          const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
          const result = await CloudSync.acceptClanInvite(acceptBtn.dataset.clanId, this._cloudUid, nickname).catch(() => ({ ok: false }))
          if (!result.ok) return
          this.settings.clanId = acceptBtn.dataset.clanId
          this.settings.clanName = acceptBtn.dataset.clanName
          saveSettings(this.settings)
          this._renderPlayerTag()
          this._refreshClanUi()
        } else if (declineBtn) {
          await CloudSync.declineClanInvite(declineBtn.dataset.clanId, this._cloudUid).catch(() => {})
          this._refreshClanUi()
        }
      })
    }

    // Send Clan Request (invite by Player ID) - Owner/Elder only (the
    // section itself is hidden for a plain Member, see _refreshClanUi).
    if (this.clanInviteSendBtn) {
      this.clanInviteSendBtn.addEventListener('click', async () => {
        if (!this._cloudUid || !this.settings.clanId) return
        const playerId = this.clanInviteIdInput.value.trim().toUpperCase()
        if (!playerId) return
        const target = await CloudSync.fetchLeaderboardEntryByPlayerId(playerId).catch(() => null)
        if (!target) {
          this.clanInviteStatus.textContent = t('clanInvitePlayerNotFound')
          this.clanInviteStatus.style.display = 'block'
          return
        }
        const clan = await CloudSync.fetchClanById(this.settings.clanId).catch(() => null)
        if (!clan) return
        await CloudSync.sendClanInvite(this.settings.clanId, clan.name, target.uid).catch(() => {})
        this.clanInviteStatus.textContent = t('clanInviteSent')
        this.clanInviteStatus.style.display = 'block'
        this.clanInviteIdInput.value = ''
      })
    }

    if (this.clanLeaveBtn) {
      this.clanLeaveBtn.addEventListener('click', async () => {
        if (!this._cloudUid || !this.settings.clanId) return
        // Button is disabled (unclickable) for an owner with other members
        // still present - see _refreshClanUi - so reaching here means
        // either a non-owner leaving, or the owner leaving as the last
        // member (which also deletes the clan itself, not just their own
        // membership - see deleteClan's own comment).
        const isSoleOwner = this._clanIsOwner && !this._clanOtherMembersPresent
        if (!window.confirm(t(isSoleOwner ? 'clanDisbandConfirm' : 'clanLeaveConfirm'))) return
        const clanId = this.settings.clanId
        await CloudSync.leaveClan(clanId, this._cloudUid).catch(() => {})
        if (isSoleOwner) await CloudSync.deleteClan(clanId).catch(() => {})
        this.settings.clanId = null
        this.settings.clanName = null
        saveSettings(this.settings)
        this._renderPlayerTag()
        this._refreshClanUi()
      })
    }

    // Kick/Promote/Demote, from the member list (event delegation - the
    // server-side rule is the real gate; buttons are also only rendered
    // for roles allowed to use them, see _refreshClanUi).
    if (this.clanMemberList) {
      this.clanMemberList.addEventListener('click', async (e) => {
        if (!this.settings.clanId) return
        const kickBtn = e.target.closest('.clan-kick-btn')
        const promoteBtn = e.target.closest('.clan-promote-btn')
        const demoteBtn = e.target.closest('.clan-demote-btn')
        const makeLeaderBtn = e.target.closest('.clan-make-leader-btn')
        if (kickBtn) {
          await CloudSync.kickClanMember(this.settings.clanId, kickBtn.dataset.uid).catch(() => {})
        } else if (promoteBtn) {
          await CloudSync.promoteToElder(this.settings.clanId, promoteBtn.dataset.uid, promoteBtn.dataset.nickname, Number(promoteBtn.dataset.joinedAt)).catch(() => {})
        } else if (demoteBtn) {
          await CloudSync.demoteToMember(this.settings.clanId, demoteBtn.dataset.uid, demoteBtn.dataset.nickname, Number(demoteBtn.dataset.joinedAt)).catch(() => {})
        } else if (makeLeaderBtn) {
          if (!window.confirm(t('clanMakeLeaderConfirm', { name: makeLeaderBtn.dataset.nickname }))) return
          await CloudSync.transferClanLeadership(
            this.settings.clanId,
            makeLeaderBtn.dataset.uid, makeLeaderBtn.dataset.nickname, Number(makeLeaderBtn.dataset.joinedAt),
            this._cloudUid, this._clanMyNickname, this._clanMyJoinedAt
          ).catch(() => {})
        } else {
          return
        }
        this._refreshClanUi()
      })
    }

    // Approve/Deny, from the join-requests list (Owner/Elder only - the
    // section itself is hidden for a plain Member).
    if (this.clanRequestsList) {
      this.clanRequestsList.addEventListener('click', async (e) => {
        if (!this.settings.clanId) return
        const approveBtn = e.target.closest('.clan-request-approve-btn')
        const denyBtn = e.target.closest('.clan-request-deny-btn')
        if (approveBtn) {
          await CloudSync.approveJoinRequest(this.settings.clanId, approveBtn.dataset.uid, approveBtn.dataset.nickname).catch(() => {})
          this._refreshClanUi()
        } else if (denyBtn) {
          await CloudSync.denyJoinRequest(this.settings.clanId, denyBtn.dataset.uid).catch(() => {})
          this._refreshClanUi()
        }
      })
    }
  }

  // "My Clan" subtab reads "Make Clan" until settings.clanId is actually
  // set - reuses the existing clanMakeBtn i18n string rather than a new key.
  _updateClanMyClanTabLabel() {
    if (this.clanSubtabMyClanBtn) this.clanSubtabMyClanBtn.textContent = this.settings.clanId ? t('clanSubtabMyClan') : t('clanMakeBtn')
  }

  // Reconciliation: settings.clanId is a local cache (see spec) - a live
  // members-subcollection check is the actual source of truth, since it
  // can drift (kicked while offline, left on another device). Called on
  // Hub panel open and after every create/join/leave/kick action.
  async _refreshClanUi() {
    if (!this.clanSigninGate) return
    // See _authReadyPromise's own comment (Game.js constructor) - same
    // false-signed-out race the Profile panel had.
    await this._authReadyPromise
    if (!this._cloudUid || !CloudSync.isConfigured()) {
      // Signed out: no "sign in to join/create" nag - just show nothing,
      // same as a signed-in player who hasn't joined a clan yet.
      this.clanBrowseState.style.display = 'none'
      this.clanInClanState.style.display = 'none'
      this._updateClanMyClanTabLabel()
      return
    }
    this.clanSigninGate.style.display = 'none'

    if (!this.settings.clanId) {
      // Before treating this as "never joined a clan", check whether I'm
      // actually the leader of an existing clan doc that my own browser
      // just has no local record of any more (settings.clanId wiped by a
      // past bug, before the members-doc self-heal below existed to catch
      // it) - the member-doc self-heal further down only ever runs once a
      // clanId is already known, so it can't reach this case on its own.
      // Restore it here and fall through into the normal in-clan render
      // path below instead of duplicating it.
      const ledClan = await CloudSync.fetchClanILead(this._cloudUid).catch(() => null)
      if (ledClan) {
        this.settings.clanId = ledClan.clanId
        this.settings.clanName = ledClan.name
        saveSettings(this.settings)
        this._renderPlayerTag()
      } else {
        ChatUI.updateChatTabAvailability(this)
        await this._renderClanIncomingInvites()
        this.clanBrowseState.style.display = 'block'
        this.clanInClanState.style.display = 'none'
        this._updateClanMyClanTabLabel()
        return
      }
    }

    let members = await CloudSync.fetchClanMembers(this.settings.clanId).catch(() => [])
    let me = members.find((m) => m.uid === this._cloudUid)
    if (!me) {
      // Before concluding I've actually left/been removed, check the clan
      // doc's own leaderId - a genuine "kicked while offline" always shows
      // leaderId belonging to someone else, but createClan writes the clan
      // doc and the owner's own member doc as two separate, non-atomic
      // calls (see its own comment) - if the second one was ever
      // interrupted, or any other past bug dropped just the member doc,
      // the clan doc survives with leaderId still mine while my own
      // member record is missing. Self-heal that instead of silently
      // kicking the real owner out to the Browse screen.
      const clan = await CloudSync.fetchClanById(this.settings.clanId).catch(() => null)
      if (clan && clan.leaderId === this._cloudUid) {
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        await CloudSync.restoreOwnerMembership(this.settings.clanId, this._cloudUid, nickname).catch(() => {})
        members = await CloudSync.fetchClanMembers(this.settings.clanId).catch(() => [])
        me = members.find((m) => m.uid === this._cloudUid)
      }
    }
    if (!me) {
      this.settings.clanId = null
      this.settings.clanName = null
      saveSettings(this.settings)
      this._renderPlayerTag()
      ChatUI.updateChatTabAvailability(this)
      await this._renderClanIncomingInvites()
      this.clanBrowseState.style.display = 'block'
      this.clanInClanState.style.display = 'none'
      this._updateClanMyClanTabLabel()
      return
    }

    this.clanBrowseState.style.display = 'none'
    this.clanInClanState.style.display = 'block'
    this._updateClanMyClanTabLabel()

    const clan = await CloudSync.fetchClanById(this.settings.clanId).catch(() => null)
    if (!clan) return
    // Backfill for an account whose settings.clanName wasn't cached yet
    // (e.g. joined before this caching existed) - keeps the homepage's
    // clan-name-above-nickname display (_renderPlayerTag) in sync without
    // it needing its own live fetch on every page load.
    if (this.settings.clanName !== clan.name) {
      this.settings.clanName = clan.name
      saveSettings(this.settings)
      this._renderPlayerTag()
    }

    this.clanDisplayName.textContent = clan.name

    const myRole = me.role || 'member'
    const canManage = myRole === 'owner' || myRole === 'elder'

    const stats = await CloudSync.fetchClanCombinedStats(this.settings.clanId).catch(() => ({ memberCount: members.length, totalKills: 0, totalBestNight: 0 }))
    this.clanStatsMembers.textContent = t('clanStatsMembers', { n: stats.memberCount, max: CloudSync.CLAN_MEMBER_CAP })
    this.clanStatsKills.textContent = t('clanStatsKills', { n: stats.totalKills })
    this.clanStatsNight.textContent = t('clanStatsNight', { n: stats.totalBestNight })

    // Send Clan Request (invite by Player ID) is management-only.
    this.clanSendInviteSection.style.display = canManage ? 'block' : 'none'

    const isOwner = myRole === 'owner'
    // Owner first, then Elder, then Member - no separate "Your role: X"
    // line any more (removed per request), so the hierarchy needs to read
    // directly from the list's own order instead.
    const roleOrder = { owner: 0, elder: 1, member: 2 }
    const sortedMembers = [...members].sort((a, b) => (roleOrder[a.role || 'member'] ?? 2) - (roleOrder[b.role || 'member'] ?? 2))
    this.clanMemberList.innerHTML = sortedMembers.map((m) => {
      const role = m.role || 'member'
      const canKickThis = canManage && role !== 'owner' && m.uid !== this._cloudUid
      const canPromoteThis = isOwner && role === 'member'
      const canDemoteThis = isOwner && role === 'elder'
      const canMakeLeaderThis = isOwner && m.uid !== this._cloudUid
      return `
        <div class="clan-member-row">
          <span class="clan-member-name-block">
            <span class="clan-member-role">${t(`clanRole_${role}`)}</span>
            <span class="clan-member-name">${_escapeHtml(m.nickname)}</span>
          </span>
          <span>
            ${canMakeLeaderThis ? `<button type="button" class="clan-make-leader-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanMakeLeaderBtn')}</button>` : ''}
            ${canPromoteThis ? `<button type="button" class="clan-promote-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanPromoteBtn')}</button>` : ''}
            ${canDemoteThis ? `<button type="button" class="clan-demote-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanDemoteBtn')}</button>` : ''}
            ${canKickThis ? `<button type="button" class="clan-kick-btn" data-uid="${m.uid}">${t('clanKickBtn')}</button>` : ''}
          </span>
        </div>
      `
    }).join('')

    // Join Requests - only fetched/shown for Owner/Elder (a plain Member
    // has no read permission on this subcollection anyway per the
    // security rule, so this also avoids a doomed-to-fail request).
    if (canManage) {
      const requests = await CloudSync.fetchJoinRequests(this.settings.clanId).catch(() => [])
      this.clanRequestsSection.style.display = 'block'
      this.clanRequestsList.innerHTML = requests.length
        ? requests.map((r) => `
          <div class="clan-request-row">
            <span>${_escapeHtml(r.nickname)}</span>
            <span>
              <button type="button" class="clan-request-approve-btn" data-uid="${r.uid}" data-nickname="${_escapeHtml(r.nickname)}">${t('clanApproveBtn')}</button>
              <button type="button" class="clan-request-deny-btn" data-uid="${r.uid}">${t('clanDenyBtn')}</button>
            </span>
          </div>
        `).join('')
        : `<p>${t('clanRequestsEmpty')}</p>`
    } else {
      this.clanRequestsSection.style.display = 'none'
    }

    const otherMembersPresent = members.length > 1
    this._clanOtherMembersPresent = otherMembersPresent
    this._clanIsOwner = isOwner
    this._clanMyNickname = me.nickname
    this._clanMyJoinedAt = me.joinedAt
    this.clanLeaveBtn.disabled = isOwner && otherMembersPresent
    this.clanLeaveBtn.textContent = t('clanLeaveBtn')
    this.clanLeaveDisabledHint.style.display = isOwner && otherMembersPresent ? 'block' : 'none'
    if (this.clanLeaveDisabledHint.style.display === 'block') this.clanLeaveDisabledHint.textContent = t('clanLeaderMustTransferFirst')
    ChatUI.updateChatTabAvailability(this)
  }

  // Invites addressed to this account, shown while browsing (not yet in
  // a clan) - see CloudSync.fetchIncomingClanInvites.
  async _renderClanIncomingInvites() {
    if (!this.clanIncomingInvitesList) return
    const invites = await CloudSync.fetchIncomingClanInvites(this._cloudUid).catch(() => [])
    this.clanIncomingInvitesList.innerHTML = invites.map((inv) => `
      <div class="clan-list-row">
        <span>${t('clanInviteRowLabel', { name: _escapeHtml(inv.clanName) })}</span>
        <span>
          <button type="button" class="clan-invite-accept-btn" data-clan-id="${inv.clanId}" data-clan-name="${_escapeHtml(inv.clanName)}">${t('clanAcceptBtn')}</button>
          <button type="button" class="clan-invite-decline-btn" data-clan-id="${inv.clanId}">${t('clanDeclineBtn')}</button>
        </span>
      </div>
    `).join('')
  }

  // Public directory of every clan that exists (see CloudSync.fetchAllClans),
  // ranked by total member kills (fetchClanCombinedStats - already existed,
  // previously only ever used for your OWN clan's stats card) - this used to
  // be an unordered join list, and one only reachable before you'd joined a
  // clan at all (clanBrowseState, whole thing hidden the moment you had one -
  // see _refreshClanUi). Now its own always-reachable sub-tab regardless of
  // membership, and genuinely ranked instead of just listed. Real cost
  // warning: this does 2 extra Firestore reads per clan (member count +
  // combined stats), so it's only called when this sub-tab is actually
  // clicked (see the click binding), never on every Clan-tab open.
  async _renderClanRanking() {
    if (!this.clanAllList) return
    this.clanAllList.innerHTML = ''
    const clans = await CloudSync.fetchAllClans().catch(() => [])
    if (!clans.length) {
      this.clanAllList.innerHTML = `<p>${t('clanListEmpty')}</p>`
      return
    }
    const [counts, stats] = await Promise.all([
      Promise.all(clans.map((c) => CloudSync.fetchClanMemberCount(c.clanId).catch(() => null))),
      Promise.all(clans.map((c) => CloudSync.fetchClanCombinedStats(c.clanId).catch(() => null))),
    ])
    const ranked = clans
      .map((c, i) => ({ ...c, memberCount: counts[i], totalKills: stats[i]?.totalKills ?? 0 }))
      .sort((a, b) => b.totalKills - a.totalKills)
    // Already in a clan - no server-side rule stops sending a join request to
    // a DIFFERENT clan while still a member of your own (sendJoinRequest just
    // writes a pending request doc), which would be a confusing way to end up
    // half-migrated. Only show Join when there's genuinely nowhere you
    // already belong; your own clan's row gets a plain label instead.
    const inClan = !!this.settings.clanId
    this.clanAllList.innerHTML = ranked.map((c, i) => {
      const isMine = inClan && c.clanId === this.settings.clanId
      const countLabel = c.memberCount == null ? '' : ` <span class="clan-list-count">(${c.memberCount}/${CloudSync.CLAN_MEMBER_CAP})</span>`
      const action = isMine
        ? `<span class="clan-list-your-clan">${t('clanRankingYourClan')}</span>`
        : inClan
          ? ''
          : `<button type="button" class="clan-list-join-btn mini-action-btn" data-clan-id="${c.clanId}">${t('clanJoinBtn')}</button>`
      return `
        <div class="clan-list-row clan-ranking-row${isMine ? ' clan-list-row-mine' : ''}">
          <span class="clan-list-rank">#${i + 1}</span>
          <span class="clan-list-name">${_escapeHtml(c.name)}${countLabel}</span>
          <span class="clan-list-kills">${t('clanRankingKillsLabel', { n: c.totalKills })}</span>
          ${action}
        </div>
      `
    }).join('')
  }

  // Rolled once per night-round: a chance of rain OR snow for the whole
  // round (mutually exclusive - one weather state at a time), lower
  // visibility (see the fog scaling in _applyFogState) plus the matching
  // screen overlay. Snow is deliberately lighter than rain (no thunder,
  // smaller fog reduction) so it reads as a calmer, colder night rather
  // than reskinned rain.
  // Real falling particles (was a tiled CSS background-position shift,
  // which reads as an obviously repeating pattern rather than rain/snow
  // actually descending from the sky, per direct follow-up feedback) -
  // built once, lazily, the first time weather actually rolls (idempotent
  // via the dataset flag, so re-rolling weather every night doesn't keep
  // appending more particles). Each particle gets its own randomized
  // left position, fall duration, and a negative animation-delay (so they
  // don't all start their fall in visible lockstep the moment the overlay
  // shows) - see .rain-particle/.snow-particle/@keyframes particle-fall
  // in style.css for the actual fall motion.
  _ensureWeatherParticles(el, count, className, durationRange, sway) {
    if (!el || el.dataset.particlesBuilt) return
    el.dataset.particlesBuilt = '1'
    const frag = document.createDocumentFragment()
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div')
      p.className = className
      const duration = durationRange[0] + Math.random() * (durationRange[1] - durationRange[0])
      p.style.left = `${Math.random() * 100}%`
      p.style.animationDuration = `${duration}s`
      p.style.animationDelay = `-${Math.random() * duration}s`
      if (sway) p.style.setProperty('--sway', `${(Math.random() * 2 - 1) * sway}px`)
      // Size varies via width/height, not a transform:scale() - the fall
      // animation below already owns `transform` (translate + sway), and
      // an inline transform here would fight it instead of combining.
      const size = 3 + Math.random() * 3
      p.style.width = `${size}px`
      p.style.height = `${size}px`
      frag.appendChild(p)
    }
    el.appendChild(frag)
  }

  // Light and hard rain/snow particles - also used by the Map Editor's
  // weather (BuildSky.js), which shows these same overlays.
  _ensureAllWeatherParticles() {
    this._ensureWeatherParticles(this.rainOverlayEl, 80, 'rain-particle', [0.7, 1.3])
    this._ensureWeatherParticles(this.rainOverlayHardEl, 160, 'rain-particle', [1.4, 2.6])
    this._ensureWeatherParticles(this.snowOverlayEl, 50, 'snow-particle', [5, 10], 15)
    this._ensureWeatherParticles(this.snowOverlayHardEl, 100, 'snow-particle', [9, 18], 15)
  }


  // Every render of the main scene goes through here - the per-frame one in
  // _tick, _warmUpShaders, and the screenshot/portrait captures - so they
  // all use the same path and therefore the same compiled shader variants
  // (three.js compiles a separate variant of every material for rendering
  // straight to the canvas vs. into a render target, since tone mapping/
  // color space conversion happen in-shader only for the former; warming up
  // one path and then playing on the other would compile every material
  // again on the first frames of a run).
  //
  // The composer only earns its keep when a post effect is actually on.
  // With bloom/AO/motion blur all off (the default - LOW_QUALITY_MODE keeps
  // bloom off, AO and motion blur are opt-in), it still rendered the whole
  // scene into an offscreen target and then copied that to the screen in a
  // second fullscreen OutputPass - an extra full-resolution read+write every
  // frame for an identical image, since rendering straight to the canvas
  // applies the same toneMapping/outputColorSpace OutputPass exists to apply
  // to an offscreen target.
  // Map editor auto resolution (Auto Quality setting) - holds 60 fps by
  // giving up high-DPI extra pixels when frames run slow, and taking them
  // back once there's headroom. Called every ~500ms with the average frame
  // time. Steps down fast (one slow sample), steps up slowly (after 6 good
  // samples, never within 20s of a step down), so it settles instead of
  // bouncing.
  _updateEditorResScale(msPerFrame, now) {
    if (!this.settings.autoQuality || now < (this._editorResHoldUntil || 0)) return
    const scale = this._editorResScale ?? 1
    // Slow = well over the frame time the player asked for (60 fps, or
    // their FPS Cap) - a 30 cap must not read as "too slow" forever.
    const targetMs = this.settings.fpsCap > 0 ? 1000 / this.settings.fpsCap : 1000 / 60
    // A step that wouldn't change the real pixel ratio (already at the
    // floor) is skipped entirely.
    const down = Math.max(0.25, scale - 0.125)
    if (msPerFrame > targetMs * 1.11 && scale > 0.25 && this._editorPixelRatio(down) < this._editorPixelRatio(scale) - 1e-3) {
      this._editorResScale = down
      this._editorResGood = 0
      this._editorResUpAfter = now + 20000
      // Draw straight away - a resize clears the canvas, and waiting for
      // the next frame would show one black frame.
      if (this._applyRenderScale()) this.buildMode.render()
    } else if (msPerFrame < targetMs * 1.05 && scale < 1) {
      this._editorResGood = (this._editorResGood || 0) + 1
      if (this._editorResGood >= 6 && now > (this._editorResUpAfter || 0)) {
        this._editorResScale = Math.min(1, scale + 0.125)
        this._editorResGood = 0
        if (this._applyRenderScale()) this.buildMode.render()
      }
    } else {
      this._editorResGood = 0
    }
  }

  // Everything Lite Textures shrinks: the game world, the Map Editor and
  // Try Map's gun scene.
  _liteTextureRoots() {
    // The gun models' pictures (Try Map, Inventory > Weapons) are the big
    // file textures now; the editor's block atlas is drawn by the game.
    return [this.buildMode?.scene, this.buildMode?.tryMode?._gunScene, ...Object.values(this.weapons?.viewmodels || {})].filter(Boolean)
  }

  _applyLiteTextures() {
    if (this.settings.liteTextures) shrinkTextures(this._liteTextureRoots())
    else restoreTextures(this._liteTextureRoots())
  }


  _tick() {
    // FPS Cap (Graphics tab, settings.fpsCap) - skips this frame entirely
    // (no update, no render) if not enough real time has passed since the
    // last one that actually ran. requestAnimationFrame itself still
    // fires at the display's native refresh rate regardless - this just
    // makes most of those calls no-ops once a cap is set.
    //
    // Paced against a running schedule with a small tolerance (2026-09-30
    // bug): the old strict "at least 16.67ms since the last frame" check
    // rejected any frame that arrived a hair early. On a 120Hz screen
    // (frames every 8.33ms) a 60 cap then only ran every *third* frame
    // (~25ms, ~40 fps), and on a 60Hz screen normal timer jitter dropped
    // frames the same way - a 60 cap gave 30-45 fps, never 60.
    if (this._fpsCapMinFrameMs) {
      const nowCap = performance.now()
      const last = this._lastCappedFrameAt || 0
      if (nowCap - last < this._fpsCapMinFrameMs - 1.5) return
      // Advance by exactly one frame interval so timing error doesn't
      // accumulate; resync if far behind (tab was hidden, long stall).
      this._lastCappedFrameAt = nowCap - last > this._fpsCapMinFrameMs * 2 ? nowCap : last + this._fpsCapMinFrameMs
    }
    // Graphics connection lost: the game waits (see the webglcontextlost
    // handler) instead of carrying on unseen.
    if (this._glLost) {
      this.timer.update()
      return
    }
    // Build Mode is a fully standalone sandbox (see BuildMode.js's own
    // comment) - while active, none of the normal survival tick logic
    // below runs at all, not even the FPS counter.
    if (this.buildMode.active) {
      const jsStart = performance.now()
      const dt = Math.min(this.timer.getDelta(), 0.1)
      this.buildMode.update(dt)
      this.buildMode.render()
      this._editorJsMs = (this._editorJsMs || 0) + (performance.now() - jsStart)
      // Same fps / ms readout the survival game shows (2026-09-30 request),
      // with the editor's own numbers.
      this._fpsFrameCount++
      const nowFpsBm = performance.now()
      const elapsedBm = nowFpsBm - this._fpsLastUpdate
      if (elapsedBm >= 500) {
        const fps = Math.round((this._fpsFrameCount * 1000) / elapsedBm)
        const msPerFrame = (elapsedBm / this._fpsFrameCount).toFixed(1)
        const fullRatio = Math.min(window.devicePixelRatio, 2) * this._userResScale
        const resPct = Math.round((this.renderer.getPixelRatio() / fullRatio) * 100)
        const resTag = (resPct < 100 ? ` / res ${resPct}%` : '') + (this.settings.fpsCap > 0 ? ` / cap ${this.settings.fpsCap}` : '')
        // "js": this page's own work per frame (building + sending the
        // frame). When fps is low but js is small, the time is going to
        // the GPU / browser compositor, not the game's code.
        const jsMs = (this._editorJsMs / this._fpsFrameCount).toFixed(1)
        this._editorJsMs = 0
        this.fpsEl.textContent = `${fps} fps / ${msPerFrame} ms / js ${jsMs} ms / ${this.buildMode.lastDrawCalls} draws / ${this.buildMode.blockCount} blocks${resTag} / ${this._gpuRendererString}`
        this._updateEditorResScale(Number(msPerFrame), nowFpsBm)
        this._fpsFrameCount = 0
        this._fpsLastUpdate = nowFpsBm
      }
      return
    }
    // The homepage draws nothing 3D (the menu's own picture covers the
    // canvas), so only the fps readout runs here.
    this.timer.update()
    this._fpsFrameCount++
    const nowFps = performance.now()
    const fpsElapsed = nowFps - this._fpsLastUpdate
    if (fpsElapsed >= 500) {
      const fps = Math.round((this._fpsFrameCount * 1000) / fpsElapsed)
      const msPerFrame = (fpsElapsed / this._fpsFrameCount).toFixed(1)
      this.fpsEl.textContent = `${fps} fps / ${msPerFrame} ms / ${this._gpuRendererString}`
      this._fpsFrameCount = 0
      this._fpsLastUpdate = nowFps
    }
  }
}

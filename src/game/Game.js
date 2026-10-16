import * as THREE from 'three'
import { LOW_QUALITY_MODE } from './QualitySettings.js'
import { WeaponCatalog } from './WeaponCatalog.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { Quests, QUESTS } from './Quests.js'
import { RollingQuests, EXPIRE_MS as ROLLING_QUEST_EXPIRE_MS } from './RollingQuests.js'

// The Skin Designer page, embedded in #skindesigner-frame. Served from this
// game's own site (public/skin-designer/) since 2026-09-30 - it used to be a
// separate gayzcharacterskindesigner.vercel.app project.
export const SKIN_DESIGNER_ORIGIN = window.location.origin
const SKIN_DESIGNER_URL = '/skin-designer/index.html'
// How long after the homepage is ready Design a Skin starts loading in the
// background (and how long it waits to try again while a game runs).
const SKIN_DESIGNER_PRELOAD_MS = 4000

// Store crates (Inventory > Crates opens them). Coming Soon: they used to
// hold the old Map 1's outfits and hats, which nothing shows any more, so
// they can't be bought or opened until they get new contents.
export const CRATES_COMING_SOON = true
export const CRATE_TIERS = {
  wood: { cost: 1000 },
  ice: { cost: 2000 },
  golden: { cost: 5000 },
}
// Same values as each .crate-tier-wood/-ice/-golden CSS class's own
// --crate-tier-color (src/style.css) - duplicated here since the
// purchase modal sets this as an inline style (there's no per-tier class
// on its single shared box to hang a CSS rule off instead).
export const CRATE_TIER_COLORS = { wood: '#c9915a', ice: '#8fd9f0', golden: '#f0c23e' }

// Same isometric 3-face icon markup as each .crate-card's own <svg> (see
// index.html), duplicated here as plain strings so the purchase modal
// (Game.js's _openCratePurchaseModal) can inject whichever tier was
// clicked at a bigger size. Gradient ids get a "-modal" suffix - reusing
// the plain tier names here would collide with the Shop/Inventory
// copies' own ids (that exact bug, and why it matters, is documented on
// the crate-icon SVG's own commit - duplicate SVG gradient ids are
// invalid HTML and rendered visibly wrong in one of the three places).
export const CRATE_ICON_SVG = {
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
import { playConfig, UPGRADE_PLAY, POINTS_PER_KILL, POINTS_PER_WAVE, DEFENSE_WAVES, BOSS_HUNT_EVERY, PLAY_GAME_MODES, EXTRACTION_WAVES, EXTRACTION_HOLD, SKELETON_FROM_WAVE } from './PlayRules.js'
import { BIOMES, seedFromText } from './OpenWorld.js'
import * as GalleryUI from './GalleryUI.js'
import { LANGUAGES, setLanguage, t, tHtml } from './i18n.js'
import * as MenuEasterEggs from './MenuEasterEggs.js'
import { MenuAvatar3D, loadSkinTexture, DEFAULT_SKIN_DATA_URL, SHOP_SKIN_PREVIEW_DATA_URL } from './MenuAvatar3D.js'
// BuildMode.js is deliberately NOT statically imported here - it's a big,
// self-contained system most visitors never touch (a whole separate
// scene/camera/90+ block types), so it's dynamically imported on first use
// instead (see _enterBuildMode) to keep it out of the initial page load.
import * as CloudSync from './CloudSync.js'
import * as CloudSaveUI from './CloudSaveUI.js'
import * as ChatUI from './ChatUI.js'
import * as InventoryUI from './InventoryUI.js'
import * as ClanUI from './ClanUI.js'
import * as OnlineUI from './OnlineUI.js'
import * as FriendsUI from './FriendsUI.js'
import * as SettingsUI from './SettingsUI.js'
import * as ServerBrowser from './ServerBrowser.js'
import { PlayNet } from './PlayNet.js'
import { setColorblindMode } from './Accessibility.js'
import { MARKET_SKINS, MARKET_PRICES } from './MarketSkins.js'
import { shrinkTextures, restoreTextures } from './LiteTextures.js'


// Starting stat tradeoffs, picked once on the main menu and applied a
// single time when a fresh run begins (see the playBtn click handler) -
// not reapplied on respawn, same as XP upgrades/perks.
// Nickname Font (see --nickname-font) - web-safe stacks only, no new font
// file loads (unlike the title's Black Ops One Google Font, already
// loaded regardless).
export const NICKNAME_FONT_STACKS = {
  default: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'Courier New', Courier, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  display: "'Bebas Neue', 'Segoe UI', sans-serif",
}


// Random Nickname Generator (see _generateRandomNickname) - a small
// adjective+noun word bank combined with a 2-digit suffix, plenty of
// distinct combinations without needing a name-generation service.
export const RANDOM_NICKNAME_ADJECTIVES = ['Rusty', 'Silent', 'Grim', 'Feral', 'Lucky', 'Rogue', 'Shady', 'Blunt', 'Sneaky', 'Iron']
export const RANDOM_NICKNAME_NOUNS = ['Wolf', 'Scav', 'Reaper', 'Nomad', 'Ghost', 'Viper', 'Ranger', 'Drifter', 'Hound', 'Raven']


// Leaderboard podium styling (ranks 1-3, see _renderLeaderboardRows/
// _renderWeeklyLeaderboardList) - plain ordinal text + a gold/silver/
// bronze CSS class, not emoji medals (this codebase has a documented
// no-emoji UI convention, see #profile-emblem-row's own comment).
export const PODIUM_MEDALS = ['1st', '2nd', '3rd']
// Cache Storage name for the saved weapon pictures (see _loadSavedWeaponThumbs).
export const WEAPON_THUMBS_CACHE = 'gayz-weapon-thumbs-v2'

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
  // Unlocked by ENDGAME_ACHIEVEMENT - see the diff-nightmare visibility
  // toggle right after Achievements loads.
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
      performanceMode: parsed.performanceMode ?? false,
      reduceFlashing: parsed.reduceFlashing ?? false,
      clanId: typeof parsed.clanId === 'string' ? parsed.clanId : null,
      clanTag: typeof parsed.clanTag === 'string' ? parsed.clanTag : null,
      clanName: typeof parsed.clanName === 'string' ? parsed.clanName : null,
      bigInteractPrompt: parsed.bigInteractPrompt ?? false,
      toastDuration: parsed.toastDuration ?? 100,
      crosshairColor: parsed.crosshairColor || '#ffffff',
      crosshairSize: parsed.crosshairSize ?? 100,
      autoQuality: parsed.autoQuality ?? true,
      fpsCap: parsed.fpsCap ?? 0,
      invertScrollWeaponSwitch: parsed.invertScrollWeaponSwitch ?? false,
      mutedChatPlayers: Array.isArray(parsed.mutedChatPlayers) ? parsed.mutedChatPlayers : [],
      // Private per-player notes (Other Profile popup) - keyed by the
      // OTHER player's stable playerId, never synced anywhere, only ever
      // read/written by this local client. A plain object (not an array)
      // since lookup is always "the note for THIS specific playerId."
      playerNotes: (parsed.playerNotes && typeof parsed.playerNotes === 'object') ? parsed.playerNotes : {},
      friendPresenceNotify: parsed.friendPresenceNotify ?? true,
      timeFormat: parsed.timeFormat === '24h' ? '24h' : '12h',
      autoSaveFrequencySec: parsed.autoSaveFrequencySec ?? 30,
      hudFpsCounter: parsed.hudFpsCounter ?? true,
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
      oneHandedLayout: parsed.oneHandedLayout ?? false,
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
      // Private notes (Profile > Hidden) - only ever shown to you, never published.
      privateNotes: typeof parsed.privateNotes === 'string' ? parsed.privateNotes.slice(0, 5000) : '',
      // Streaming-safe mode (see _updateStreamSafeVisibility) - hides the
      // fps/ms/draw-calls debug overlay specifically, leaving the rest of
      // the HUD untouched.
      streamSafeMode: parsed.streamSafeMode ?? false,
      defaultTag: parsed.defaultTag || null,
      companionRole: ['melee', 'medic'].includes(parsed.companionRole) ? parsed.companionRole : 'ranged',
      // Guest Mode (Local Sharing batch) - lets someone else play a run on
      // this save without it touching bestStats/careerStats/leaderboards
      // (see _recordRunEnd's own guard), so a shared/borrowed computer's
      // owner doesn't get their stats muddied by a one-off guest run.
      guestMode: parsed.guestMode ?? false,
      loadout: 'balanced', // Choose Class was removed (2026-10-11) - every run is Balanced
      // Game Modes grid (Choose Your Challenge) - 'classic' is plain
      // Zombie Survival, no special mutator. zombieDefense/bossHunt/
      // zombieRush/zombieExtraction are all real, built modes (PlayRules.js
      // PLAY_GAME_MODES) - see _bindGameModeSelect for how picking one
      // drives its matching settings.mutators.* flag.
      selectedGameMode: PLAY_GAME_MODES.includes(parsed.selectedGameMode) ? parsed.selectedGameMode : 'classic',
      // 3-slot hotbar (see Game.js's _bindHotbar) - slot 0 is whatever gun
      // was picked in the Play/Pause weapon picker, slots 1-2 are the fixed
      // M1911/Knife backup weapons every run starts with.
      hotbar: Array.isArray(parsed.hotbar) && parsed.hotbar.length === 3 ? parsed.hotbar : ['rifle', 'pistol', 'melee'],
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
      // No limit on how many friends (2026-10-10 - it used to keep 5).
      savedFriends: Array.isArray(parsed.savedFriends)
        ? parsed.savedFriends.map((f) => (typeof f === 'string' ? { name: f, uid: null } : f))
        : [],
      // Presence status the player picks in the Friends panel - one of
      // 'online'/'idle'/'dnd'/'offline' (see _computeFriendStatus).
      statusMode: ['online', 'idle', 'dnd', 'offline'].includes(parsed.statusMode) ? parsed.statusMode : 'online',
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
      // Graphics tab (see _bindGraphicsSettings). renderResolution is a
      // percentage fed into _basePixelRatio's pixel-ratio math, not a
      // separate render target size - docs/PERFORMANCE.md already ruled
      // resolution out as a fix for the real (CPU-bound) stutter, so this
      // is a genuine visual/GPU-cost lever, not a performance fix.
      renderResolution: parsed.renderResolution ?? 100,
      brightness: parsed.brightness ?? 100,
      contrast: parsed.contrast ?? 100,
      // Default false to match this build's existing out-of-box behavior
      // (LOW_QUALITY_MODE already keeps shadows off) - an explicit opt-in
      // still works, see _resolveShadowsEnabled's own comment on why.
      shadowsEnabled: parsed.shadowsEnabled ?? false,
      shadowQuality: parsed.shadowQuality || 'medium',
      viewDistance: ['auto', 'short', 'medium', 'far', 'max'].includes(parsed.viewDistance) ? parsed.viewDistance : 'auto',
      liteTextures: parsed.liteTextures ?? false,
      grainIntensity: parsed.grainIntensity ?? 100,
      panelFlickerEnabled: parsed.panelFlickerEnabled ?? true,
      // Off by default - an opt-in accessibility enhancement, not a
      // baseline change to every button/input's default focus styling.
      focusRingMode: parsed.focusRingMode ?? false,
      homepageFpsCounter: parsed.homepageFpsCounter ?? false,
      selectedGoals: Array.isArray(parsed.selectedGoals) ? parsed.selectedGoals.slice(0, MAX_GOALS) : [],
      underlineLinks: parsed.underlineLinks ?? false,
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
      navOrder: _loadNavOrder(parsed.navOrder),
      // Third features batch - Accessibility group.
      uiFont: parsed.uiFont || 'default',
      textSpacing: parsed.textSpacing ?? 100,
      buttonSize: parsed.buttonSize ?? 100,
      reduceTransparency: parsed.reduceTransparency ?? false,
      cursorTrail: parsed.cursorTrail ?? false,
      crtScanlines: parsed.crtScanlines ?? false,
      weatherParticles: parsed.weatherParticles ?? true,
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
      // The gun last picked at the start of a Map 1 run (PlayWeapons.js).
      playWeapon: typeof parsed.playWeapon === 'string' ? parsed.playWeapon : null,
      lastSeenBuildId: parsed.lastSeenBuildId || null,
      mutators: {
        hordeRush: parsed.mutators?.hordeRush ?? false,
        lootRush: parsed.mutators?.lootRush ?? false,
        bossRush: parsed.mutators?.bossRush ?? false,
        // Off by default - deliberately a toggle, not a replacement for
        // manual healing (medkits, safe-zone rest). See _updateHealthRegen's
        // own comment for why this stays optional rather than becoming the
        // new baseline.
        healthRegen: parsed.mutators?.healthRegen ?? false,
        ironMode: parsed.mutators?.ironMode ?? false,
        glassHouse: parsed.mutators?.glassHouse ?? false,
        zombieDefense: parsed.mutators?.zombieDefense ?? false,
        bossHunt: parsed.mutators?.bossHunt ?? false,
        zombieRush: parsed.mutators?.zombieRush ?? false,
        escalation: parsed.mutators?.escalation ?? false,
      },
    }
    // Repairs a hotbar with empty (null) slots - a real save could have
    // gotten into this state from _assignHotbarSlot's old overwrite bug
    // (fixed 2026-08-20, see that function's own comment: assigning a
    // weapon to an occupied slot used to just drop the previous occupant
    // instead of swapping it elsewhere). The array-shape check just above
    // only replaces the whole hotbar if it isn't a valid 3-length array,
    // so a save with e.g. ['rifle', null, null] passed through
    // untouched - backfill each null slot with the first default weapon
    // not already present elsewhere on the hotbar.
    // Guns that were removed (Nail Gun, Harpoon Gun, Glock 18 - 2026-10-10)
    // leave their slot empty, filled just below.
    settings.hotbar = settings.hotbar.map((id) => (['nailgun', 'harpoon', 'glock18'].includes(id) ? null : id))
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

// The 8 reorderable homepage buttons (Settings > Controls > Nav Order).
// 2026-10-09: Friend List moved under Global, then Quests, then Inventory.
const NAV_ORDER_DEFAULT = ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'friends-btn', 'quests-btn', 'menu-inventory-btn', 'achievements-btn']
// The default before that - a save still holding it never reordered
// anything, so it gets the new default instead.
const NAV_ORDER_OLD_DEFAULT = ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'menu-inventory-btn', 'quests-btn', 'friends-btn', 'achievements-btn']

function _loadNavOrder(saved) {
  if (!Array.isArray(saved) || saved.length !== 8) return [...NAV_ORDER_DEFAULT]
  if (saved.join() === NAV_ORDER_OLD_DEFAULT.join()) return [...NAV_ORDER_DEFAULT]
  return saved
}

export function defaultSettings() {
  return { language: 'en', playerId: _generatePlayerId(), masterVolume: 100, sfxVolume: 100, ambientVolume: 100, muteOnTabBlur: false, positionalAudio: true, difficulty: 'normal', sensitivity: 100, invertY: false, fov: 75, hudScale: 100, hudOpacity: 100, colorblindMode: 'off', autoQuality: true, fpsCap: 0, invertScrollWeaponSwitch: false, friendPresenceNotify: true, timeFormat: '12h', autoSaveFrequencySec: 30, hudFpsCounter: true, achievementToasts: true, rankUpToasts: true, leaderboardRankAlerts: true, weeklyChallengeReminder: true, lowCurrencyReminder: true, backupReminder: true, lastExportAt: 0, confirmSignOut: false, stayEmbedSignedIn: true, anonymousLeaderboard: false, shareTelemetry: true, autoDeclineFriendRequests: false, exactLastSeen: false, rememberSettingsTab: false, lastSettingsTab: 'general', confirmRemoveFriend: false, reduceBgEffects: false, oneHandedLayout: false, homepageGreeting: '', whatsNewEveryLaunch: false, reduceFlashing: false, clanId: null, clanTag: null, clanName: null, bigInteractPrompt: false, toastDuration: 100, crosshairColor: '#ffffff', crosshairSize: 100, nickname: '', nicknameColor: '#ffffff', customSkinDataUrl: null, bio: '', privateNotes: '', streamSafeMode: false, defaultTag: null, companionRole: 'ranged', guestMode: false, loadout: 'balanced', selectedGameMode: 'classic', performanceMode: false, hotbar: ['rifle', 'pistol', 'melee'], mutedBeforeVolumes: null, quickLanguageAlt: 'es', savedFriends: [], mutedChatPlayers: [], playerNotes: {}, statusMode: 'online', region: 'global', largeTextMode: false, highContrastMode: false, dyslexiaFont: false, bgMood: 'auto', renderResolution: 100, brightness: 100, contrast: 100, shadowsEnabled: false, shadowQuality: 'medium', viewDistance: 'auto', liteTextures: false, grainIntensity: 100, panelFlickerEnabled: true, focusRingMode: false, homepageFpsCounter: false, selectedGoals: [], underlineLinks: false, friendBeatNotified: [], accentColor: null, playBtnColor: null, nicknameFont: 'default', layoutDensity: 'cozy', pinnedStat: null, navOrder: [...NAV_ORDER_DEFAULT], uiFont: 'default', textSpacing: 100, buttonSize: 100, reduceTransparency: false, cursorTrail: false, crtScanlines: false, weatherParticles: true, hoverAudioCue: false, highVisCursor: false, captionBackground: false, themePreset: 'none', uiTheme: 'old', playWeapon: null, lastSeenBuildId: null, mutators: { hordeRush: false, lootRush: false, bossRush: false, healthRegen: false, ironMode: false, glassHouse: false, zombieDefense: false, bossHunt: false, zombieRush: false, escalation: false } }
}




// Weekly Challenge - a rotating kill-count goal: a cumulative target
// tracked across every Map 1 run played that week (see
// _checkWeeklyChallengeProgress), with a one-time coin reward.
const WEEKLY_CHALLENGES = [
  { id: 'headhunter', titleKey: 'weeklyHeadhunter', target: 300, rewardCoins: 200 },
  { id: 'exterminator', titleKey: 'weeklyExterminator', target: 500, rewardCoins: 300 },
  { id: 'sharpshooter', titleKey: 'weeklySharpshooter', target: 200, rewardCoins: 150 },
]

export function _thisWeekStr(date) {
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

function saveWeeklyChallenge(state) {
  try {
    localStorage.setItem(WEEKLY_CHALLENGE_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable - progress just won't persist.
  }
}


// Weekly Featured Mutator - a single mutator auto-picked via the same
// week-seed technique WEEKLY_CHALLENGES above already uses, nudging
// players toward trying a different mutator each week via a coin bonus -
// never forced, the player still has to check the box themselves.
// Only mutators with a block-city version (PlayRules.js's PLAY_MUTATORS).
const WEEKLY_FEATURED_MUTATORS = ['hordeRush', 'lootRush', 'bossRush', 'healthRegen', 'glassHouse', 'escalation']
const WEEKLY_FEATURED_MUTATOR_BONUS_COINS = 50
// Kill streak (kills without getting hurt) that earns Meat Grinder.
const MEAT_GRINDER_STREAK = 25
// Goals for the 2026-10-09 achievements (Achievements.js), all per run
// except ARSENAL_WEAPONS (different guns with a kill, ever - stored in
// localStorage[ARSENAL_KEY]).
const HEADHUNTER_HEADSHOTS = 25
const UP_CLOSE_KNIFE_KILLS = 25
const ARSENAL_WEAPONS = 5
const ARSENAL_KEY = 'gayz-ach-weapon-kills'
const SURVIVOR_20_WAVES = 20
const MARATHON_SECONDS = 20 * 60
const TREASURE_HUNTER_CHESTS = 10
const FULLY_LOADED_UPGRADES = 5
const DEEP_POCKETS_COINS = 1000
// Goals for the 2026-10-12 achievements (per run unless it says career).
const SURVIVOR_30_WAVES = 30
const MASSACRE_KILLS = 250
const UNTOUCHABLE_STREAK = 50
const SHARPSHOOTER_HEADSHOTS = 75
const BOSS_HUNTER_BOSSES = 5
const HARDENED_WAVES = 10
const APEX_PREDATOR_WAVES = 5
const MUTATOR_CHALLENGE_WAVES = 10
const EXTERMINATOR_CAREER_KILLS = 1000
const REGULAR_CAREER_RUNS = 25
const FORTUNE_HUNTER_COINS = 3000
// The achievement that counts as beating the game: it unlocks Nightmare
// difficulty, Prestige and the Career Portrait.
const ENDGAME_ACHIEVEMENT = 'survivor_10'
export const GLOBAL_KILLS_MILESTONE_STEP = 100000
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
  bossRush: 'mutatorBossRush',
  healthRegen: 'mutatorHealthRegen',
  ironMode: 'mutatorIronMode',
  glassHouse: 'mutatorGlassHouse',
  zombieDefense: 'mutatorZombieDefense',
  bossHunt: 'mutatorBossHunt',
  zombieRush: 'mutatorZombieRush',
  escalation: 'mutatorEscalation',
}


// Settings Code (export/import, see _exportSettingsCode/_importSettingsCode)
// - a deliberate whitelist of pure preference fields (audio/graphics/
// controls/accessibility), NOT the full settings object. Excludes
// identity-shaped fields (nickname, bio, colors tied to a
// player's identity) since this is meant to be pasted/shared with someone
// else, unlike Export Save's full-fidelity file backup.
export const SETTINGS_CODE_KEYS = [
  'masterVolume', 'sfxVolume', 'ambientVolume', 'sensitivity', 'invertY', 'fov', 'hudScale', 'hudOpacity',
  'colorblindMode', 'reduceFlashing', 
  'bigInteractPrompt', 'toastDuration', 'crosshairSize', 'largeTextMode',
  'highContrastMode', 'dyslexiaFont', 'focusRingMode', 
  'performanceMode', 'bgMood', 'renderResolution', 'brightness', 'contrast', 
  'shadowsEnabled', 'shadowQuality', 'viewDistance', 'liteTextures', 
  'grainIntensity',
  'panelFlickerEnabled',
]

function _weeklyFeaturedMutatorKey() {
  const weekStr = _thisWeekStr()
  // +7 offset so this doesn't land on the exact same hash bucket
  // WEEKLY_CHALLENGES' own index would for the same week string.
  let hash = 7
  for (let i = 0; i < weekStr.length; i++) hash = (hash * 31 + weekStr.charCodeAt(i)) | 0
  return WEEKLY_FEATURED_MUTATORS[Math.abs(hash) % WEEKLY_FEATURED_MUTATORS.length]
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
// Career rank-ups, announced once each from lifetime kills (a toast in
// _recordRunEnd) - no bonus of their own any more.
const VETERAN_PERKS = [
  { id: 'veteran_500', killThreshold: 500 },
  { id: 'veteran_2000', killThreshold: 2000 },
  { id: 'veteran_5000', killThreshold: 5000 },
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
      lifetimeCoinsEarned: parsed.lifetimeCoinsEarned || 0,
      // Lifetime Points quest tier (see Quests.js) - unlike this.points
      // itself (spent on perks/rerolls, goes back down), this only ever
      // grows, same never-reset shape as lifetimeCoinsEarned above. Every
      // points award routes through Game.js's _gainPoints so this can't
      // drift out of sync with a scattered set of individual += sites.
      lifetimePointsEarned: parsed.lifetimePointsEarned || 0,
      playtimeMilestonesGranted: parsed.playtimeMilestonesGranted || [],
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
      mutatorUseCounts: parsed.mutatorUseCounts || {},
      mostProfitableRun: parsed.mostProfitableRun || 0,
      playButtonClicks: parsed.playButtonClicks || 0,
    }
  } catch {
    return {
      totalKills: 0, totalRuns: 0, veteranPerksGranted: [],
      lifetimePlaytimeSeconds: 0, lifetimeCoinsEarned: 0, lifetimePointsEarned: 0,
      playtimeMilestonesGranted: [],
      totalDeaths: 0, difficultyStats: {}, firstPlayedDate: null, accountCreatedAt: null,
      longestSessionSeconds: 0, mutatorUseCounts: {},
      mostProfitableRun: 0,
      playButtonClicks: 0,
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

export function todayDateString() {
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
export const LEADERBOARD_KEY = 'gayz-leaderboard'
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


// Points/coins and everything bought with them (skins, Shop stat perks) used
// to be purely in-run state that reset on every page reload, same as
// health/inventory/kills. Split out into its own persisted slice so the
// currency balance and anything already owned survive a reload, without
// touching the rest of the run-state reset behavior on death/respawn.
const SHOP_PROGRESS_KEY = 'gayz-shop-progress'

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
    return { points: 0, coins: 0, cash: 0, gems: 0, ownsShopSkin: false, crateStock: {}, charSkins: {} }
  }
}

export function saveShopProgress(game) {
  try {
    const json = JSON.stringify({
      points: game.points,
      coins: game.coins,
      cash: game.cash,
      gems: game.gems,
      ownsShopSkin: game.ownsShopSkin,
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
export const FRIEND_ONLINE_THRESHOLD_MS = 2 * 60 * 1000
export const FRIEND_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000
export const FRIEND_STATUS_LABEL_KEYS = { online: 'friendStatusOnline', idle: 'friendStatusIdle', dnd: 'friendStatusDnd', offline: 'friendStatusOffline' }

// Reset All Progress - see _handleResetProgressClick's own comment for why
// this is a two-click arm/confirm instead of a single button.
export const RESET_PROGRESS_CONFIRM_MS = 4000
// Achievement toast queue - slightly longer than the toast's own 3.2s CSS
// animation (see #achievement-toast.show) so one fully fades before the
// next begins, instead of visually cutting it off mid-animation.
const ACHIEVEMENT_TOAST_GAP_MS = 3400
const MAX_GOALS = 3
const LOGIN_CALENDAR_DAYS = 7
const MARKET_FEE_RATE = 0.05
// Languages that are fully translated; the rest show "Coming soon".
export const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'zh', 'hi', 'es'])
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
export const CHANGELOG_LAST_VIEWED_KEY = 'gayz-changelog-last-viewed'
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
  { key: 'htpWavesShoot', headingKey: 'htpHeadingCombat', code: 'PLAY_WEAPONS' },
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
  'build-mode-gallery-btn-label': 'buildModeGalleryBtn',
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
  'chat-send-btn': 'chatSendBtn',
  'random-nickname-btn': 'randomNicknameBtn',
  'round-mode-hint': 'roundModeHint',
  'menu-player-tag': 'menuPlayerTagFallback',
  'settings-saved-indicator': 'settingsSavedIndicator',
  'fullscreen-label': 'fullscreenLabel',
  'fullscreen-btn': 'fullscreenBtn',
  'master-volume-label': 'masterVolumeLabel',
  'sfx-test-btn': 'sfxTestBtn',
  'gfx-resolution-label': 'gfxResolutionLabel',
  'gfx-brightness-label': 'gfxBrightnessLabel',
  'gfx-contrast-label': 'gfxContrastLabel',
  'gfx-shadows-label': 'gfxShadowsLabel',
  'gfx-shadow-quality-label': 'gfxShadowQualityLabel',
  'gfx-view-distance-label': 'gfxViewDistanceLabel',
  'gfx-grain-label': 'gfxGrainLabel',
  'gfx-panel-flicker-label': 'gfxPanelFlickerLabel',
  'gfx-lite-textures-label': 'gfxLiteTexturesLabel',
  'graphics-reconnecting-text': 'graphicsReconnecting',
  'reset-graphics-defaults-btn': 'resetGraphicsDefaultsBtnLabel',
  'invert-y-label': 'invertYLabel',
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
  'hub-tab-parkour': 'hubTabParkour',
  'hub-parkour-soon-label': 'hubParkourSoon',
  'hub-tab-custom': 'hubTabCustom',
  'server-tab-main': 'hubTabSurvival',
  'server-tab-deathmatch': 'hubTabDeathmatch',
  'server-tab-parkour': 'hubTabParkour',
  'server-tab-custom': 'hubTabCustom',
  'server-create-btn': 'serverCreateBtn',
  'server-chat-heading': 'serverChatHeading',
  'hub-custom-soon-label': 'hubCustomSoon',
  'achievements-tab-parkour': 'achievementsTabParkour',
  'quest-tab-rolling': 'questTabRolling',
  'quest-tab-monthly': 'questTabMonthly',
  'quest-tab-yearly': 'questTabYearly',
  'quest-tab-lifetime': 'questTabLifetime',
  'monthly-quests-placeholder': 'monthlyQuestsPlaceholder',
  'lifetime-quests-placeholder': 'monthlyQuestsPlaceholder',
  'yearly-quests-placeholder': 'yearlyQuestsPlaceholder',
  'achievements-tab-survival': 'achievementsTabSurvival',
  // Upgrades panel: one tab per game mode (2026-10-12) - only Zombie
  // Survival has upgrades so far.
  'upgrades-tab-upgrades': 'achievementsTabSurvival',
  'upgrades-tab-deathmatch': 'achievementsTabDeathmatch',
  'upgrades-tab-parkour': 'achievementsTabParkour',
  'upgrades-tab-custom': 'hubTabCustom',
  'upgrades-deathmatch-title': 'comingSoonTitle',
  'upgrades-parkour-title': 'comingSoonTitle',
  'upgrades-custom-title': 'comingSoonTitle',
  'upgrades-deathmatch-text': 'upgradesModeComingSoon',
  'upgrades-parkour-text': 'upgradesModeComingSoon',
  'upgrades-custom-text': 'upgradesModeComingSoon',
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
  'credits-body-text': 'creditsBodyText',
  'credits-contact-text': 'creditsContactText',
  'credits-weapons-title': 'creditsWeaponsTitle',
  'credits-privacy-link': 'creditsPrivacyLink',
  'credits-terms-link': 'creditsTermsLink',
  'friends-own-id-label': 'friendsOwnIdLabel',
  'touch-more-actions-hint': 'touchMoreActionsHint',
  'achievements-category-label': 'achievementsCategoryLabel',
  'achievements-sort-label': 'achievementsSortLabel',
  'clan-invite-id-label': 'clanInviteIdLabel',
  'clan-create-name-label': 'clanCreateNameLabel',
  'clan-request-name-label': 'clanRequestNameLabel',
  'cloudsave-panel-title': 'cloudsavePanelTitle',
  'settings-section-hud': 'settingsSectionHud',
  'settings-section-hud-2': 'settingsSectionHud',
  'settings-section-notifications': 'settingsSectionNotifications',
  'settings-section-account-data': 'settingsSectionAccountData',
  'settings-section-social': 'settingsSectionSocial',
  'settings-section-homepage': 'settingsSectionHomepage',
  'settings-section-homepage-2': 'settingsSectionHomepage',
  'settings-section-accessibility': 'settingsSectionAccessibility',
  'settings-section-accessibility-2': 'settingsSectionAccessibility',
  'settings-section-misc': 'settingsSectionMisc',
  'settings-section-performance': 'settingsSectionPerformance',
  'settings-section-rendering': 'settingsSectionRendering',
  'settings-section-movement-aim': 'settingsSectionMovementAim',
  'settings-section-personalization': 'settingsSectionPersonalization',
  'settings-section-theme': 'settingsSectionTheme',
  'community-maps-title': 'communityBuildsTitle',
  'chat-tab-global': 'chatTabGlobal',
  'chat-tab-clan': 'chatTabClan',
  'hub-section-difficulty': 'hubSectionDifficulty',
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
  'cloudsave-friend-input': 'cloudsaveFriendInputPlaceholder',
  'emoji-picker-search': 'emojiPickerSearchPlaceholder',
}

const SELECT_OPTION_I18N_KEYS = {
  'time-format-select': { '12h': 'optTimeFormat12h', '24h': 'optTimeFormat24h' },
  'fps-cap-select': { '0': 'optFpsUncapped', '60': 'optFps60', '120': 'optFps120', '144': 'optFps144' },
  'gfx-shadow-quality-select': { 'low': 'optShadowLow', 'medium': 'optShadowMedium', 'high': 'optShadowHigh' },
  'gfx-view-distance-select': { 'auto': 'optViewAuto', 'short': 'optViewShort', 'medium': 'optViewMedium', 'far': 'optViewFar', 'max': 'optViewMax' },
  'colorblind-mode-select': { 'off': 'optColorblindOff', 'redgreen': 'optColorblindRedGreen', 'blueyellow': 'optColorblindBlueYellow' },
  'ui-font-select': { 'default': 'optUiFontDefault', 'mono': 'optUiFontMono', 'serif': 'optUiFontSerif', 'display': 'optUiFontDisplay' },
  'theme-preset-select': { 'none': 'optThemePresetDefault', 'sepia': 'optThemePresetSepia', 'darker': 'optThemePresetDarker', 'lighter': 'optThemePresetLighter' },
  'nickname-font-select': { 'default': 'optNicknameFontDefault', 'mono': 'optNicknameFontMono', 'serif': 'optNicknameFontSerif', 'display': 'optNicknameFontDisplay' },
  'layout-density-select': { 'cozy': 'optLayoutCozy', 'compact': 'optLayoutCompact' },
  'bg-mood-select': { 'auto': 'optBgMoodAutoSeasonal', 'timeofday': 'optBgMoodAutoLocal', 'none': 'optBgMoodNight', 'bloodmoon': 'optBgMoodBloodMoon', 'foggy': 'optBgMoodFoggy', 'amber': 'optBgMoodAmber' },
  'achievements-category-select': { 'all': 'optAchCatAll', 'combat': 'optAchCatCombat', 'survival': 'optAchCatSurvival', 'story': 'optAchCatStory' },
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
  { id: 'goal_night10', titleKey: 'goalNight10', current: (g) => g.bestStats.bestNight, total: () => 10 },
  { id: 'goal_coins100k', titleKey: 'goalCoins100k', current: (g) => g.careerStats.lifetimeCoinsEarned, total: () => 100000 },
  { id: 'goal_playtime10h', titleKey: 'goalPlaytime10h', current: (g) => g.careerStats.lifetimePlaytimeSeconds, total: () => 36000 },
  { id: 'goal_runs50', titleKey: 'goalRuns50', current: (g) => g.careerStats.totalRuns, total: () => 50 },
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
export const POLL_ID = 'next-feature-2026'
export const POLL_OPTIONS = [
  { id: 'more_bosses', labelKey: 'pollOptionMoreBosses' },
  { id: 'new_map_area', labelKey: 'pollOptionNewMapArea' },
  { id: 'more_weapons', labelKey: 'pollOptionMoreWeapons' },
  { id: 'coop_multiplayer', labelKey: 'pollOptionCoop' },
]


// Simple line-icon silhouette per weapon (same 24x24/stroke-only visual
// language as every other icon in the game - .mode-icon, .class-icon -
// not a photorealistic render, since nothing else in this UI is). Used by
// _renderWeaponPickerOptions so the "Choose Your Weapon" screen shown
// right after clicking Play has a distinct image per card instead of
// name-only text.
export const WEAPON_ICON_PATHS = {
  rifle: '<line x1="2" y1="12" x2="22" y2="12"/><line x1="20" y1="12" x2="20" y2="9"/><line x1="2" y1="12" x2="1" y2="17"/><line x1="13" y1="12" x2="14" y2="17"/><path d="M10 12q0 6 3 7"/>',
  pistol: '<rect x="5" y="9" width="12" height="4" rx="1"/><line x1="17" y1="10.5" x2="20" y2="10.5"/><path d="M6 13v6h4v-6"/><path d="M9 13a3 3 0 0 0 3 3"/>',
  minigun: '<circle cx="9" cy="12" r="5"/><circle cx="9" cy="12" r="2.5"/><circle cx="9" cy="12" r="0.8" fill="currentColor" stroke="none"/><line x1="13.5" y1="12" x2="19" y2="12"/><line x1="16" y1="12" x2="16" y2="18"/>',
  shotgun: '<line x1="3" y1="10.5" x2="21" y2="10.5"/><line x1="3" y1="14" x2="15" y2="14"/><line x1="3" y1="10.5" x2="2" y2="17"/>',
  awp: '<line x1="2" y1="15" x2="21" y2="15"/><circle cx="11" cy="9" r="3"/><line x1="11" y1="12" x2="11" y2="15"/><line x1="2" y1="15" x2="2" y2="19"/><line x1="15" y1="15" x2="17" y2="19"/>',
  revolver: '<line x1="9" y1="10" x2="21" y2="10"/><circle cx="10" cy="11.5" r="2.5"/><path d="M7 11l-3 7h4l2-5"/><line x1="11" y1="14" x2="12.5" y2="16"/>',
  flamethrower: '<rect x="3" y="9" width="6" height="8" rx="1.5"/><line x1="9" y1="13" x2="14" y2="13"/><path d="M17.5 6.5c1.5 2 3 4 3 6.3a3.3 3.3 0 0 1-6.6 0c0-.9.4-1.8.9-2.7.3.7.7.9 1.2.6-.5-1.4 0-2.6 1.5-4.2z" fill="currentColor" stroke="none"/>',
  rocket: '<rect x="2" y="11" width="14" height="4" rx="0.5"/><polygon points="16,8.5 22,13 16,17.5" fill="currentColor" stroke="none"/><line x1="3" y1="15" x2="2" y2="19"/>',
  crossbow: '<path d="M3 4q7 8 0 16"/><line x1="3" y1="4" x2="3" y2="20"/><line x1="3" y1="12" x2="20" y2="12"/><line x1="14" y1="12" x2="14" y2="16"/>',
  launcher: '<rect x="4" y="10" width="9" height="5" rx="1"/><circle cx="16.5" cy="12.5" r="3.5"/><line x1="10" y1="15" x2="13" y2="19"/>',
  suppressedsmg: '<rect x="6" y="11" width="6" height="4"/><rect x="12" y="12" width="10" height="2" rx="1"/><line x1="3" y1="12.5" x2="6" y2="12.5"/><path d="M8 15v4h3v-4"/>',
  voidripper: '<polygon points="13,2 5,13 10,13 8,22 19,10 13,10 15,2" fill="currentColor" stroke="none"/>',
  gpmg: '<line x1="2" y1="12" x2="22" y2="12"/><rect x="6" y="10" width="7" height="4"/><line x1="18" y1="12" x2="17" y2="17"/><line x1="19" y1="12" x2="21" y2="17"/><line x1="2" y1="12" x2="2" y2="16"/>',
  tomahawk: '<line x1="4" y1="20" x2="16" y2="6"/><path d="M14 4l6 2-2 6-3-4z" fill="currentColor" stroke="none"/>',
}


export function formatTime(ms) {
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
// How long Play's fade to and from black takes (ms) - see _fadeScreen.
const PLAY_FADE_MS = 450
// Points the next Prestige needs, per level: 100k for level 1, 200k for 2...
const PRESTIGE_COST_STEP = 100000
// Extra Points per run for each Prestige level (%).
const PRESTIGE_BONUS_PERCENT = 10
// Opening the Map Editor: a quick dip to black. Fading back in on the map
// (Play or editor) is slow when the load took longer than FADE_LAG_LOAD_MS
// or a first frame took longer than FADE_LAG_FRAME_MS, fast otherwise.
const EDITOR_FADE_OUT_MS = 200
const FADE_LAG_LOAD_MS = 600
const FADE_LAG_FRAME_MS = 40
const FADE_IN_SLOW_MS = 900
const FADE_IN_FAST_MS = 250

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
  profileKillsPerMin: 'combat',
  profileTotalRuns: 'survival',
  profileBestNight: 'survival',
  profilePlaytime: 'survival',
  profileWinRate: 'survival',
  profileLongestSession: 'survival',
  profileAvgRunLength: 'survival',
  profileNetWorth: 'economy',
  profileTotalSpent: 'economy',
  profileCoinsRatio: 'economy',
  profileCoinsToday: 'economy',
  profileMostProfitableRun: 'economy',
  profileAchievements: 'socialMeta',
  profilePrestige: 'socialMeta',
  profileMostUsedMutator: 'socialMeta',
  profileLastPlayed: 'socialMeta',
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
// Last visit's save-driven homepage values (see _saveMenuPaintCache).
const MENU_PAINT_CACHE_KEY = 'menu-paint-cache'
// How long the clan list loaded when General opens stays fresh.
export const CLAN_RANKING_CACHE_MS = 60000
// The What's New update card fades away by itself after this long.
const UPDATE_BANNER_SHOW_MS = 12000
const UPDATE_BANNER_FADE_MS = 900
const MENU_PAINT_CACHE_ROOTS = ['menu-currency-bar', 'menu-player-badge', 'player-showcase-header', 'menu-hero', 'menu-nav-buttons', 'menu-links-row']

// Inventory > Character skins, in grid order (Kirka-style cards). Adding a
// skin to the game = one entry here: its 64x64 Minecraft-format texture,
// a rarity (colors the card's side bar) and how many the player owns
// (0 = not shown). An uploaded custom skin gets its own card on top of
// these while it's the one equipped (see _inventorySkinEntries).
export const INVENTORY_SKINS = [
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
export const SKIN_RARITIES = {
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
export function skinFrontIconURL(dataUrl) {
  if (_skinFrontIconCache.has(dataUrl)) return _skinFrontIconCache.get(dataUrl)
  const promise = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // k = real pixels per skin pixel (HD skins are 128/256 wide).
      const k = Math.max(1, Math.round(img.width / 64))
      const legacy = img.height / k < 64 // old 64x32 skins: left limbs mirror the right ones
      const canvas = document.createElement('canvas')
      canvas.width = 16 * k
      canvas.height = 32 * k
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingEnabled = false
      const part = (sx, sy, w, h, dx, dy, mirror = false) => {
        ;[sx, sy, w, h, dx, dy] = [sx, sy, w, h, dx, dy].map((n) => n * k)
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

    this.playBtn = document.getElementById('play-btn')
    this.statsDashboardCanvas = document.getElementById('stats-dashboard-canvas')
    this.rainOverlayEl = document.getElementById('rain-overlay')
    this.rainOverlayHardEl = document.getElementById('rain-overlay-hard')
    this.snowOverlayEl = document.getElementById('snow-overlay')
    this.snowOverlayHardEl = document.getElementById('snow-overlay-hard')
    this.sandstormOverlayEl = document.getElementById('sandstorm-overlay')
    this.lightningFlashEl = document.getElementById('lightning-flash')
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
    this.menuNewsTicker = document.getElementById('menu-news-ticker')
    this.weeklyFeaturedMutatorLine = document.getElementById('weekly-featured-mutator-line')
    // Homepage batch - Continue card, Recommended Difficulty hint, Loadout
    // Presets, quick-access icons, Achievement Showcase, Season Progress,
    // Spotlight ticker, Event Banner, What's New dot, How to Play, and the
    // Profile screenshot gallery. See each feature's own method for how
    // these get populated.
    this.recommendedDifficultyHint = document.getElementById('recommended-difficulty-hint')
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
    this.profileNotesInput = document.getElementById('profile-notes-input')
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
    this.cloudsaveFriendSuggestions = document.getElementById('cloudsave-friend-suggestions')
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
    this.difficultyBtns = document.querySelectorAll('.difficulty-btn')
    this.roleBtns = document.querySelectorAll('.role-btn')
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
    this.invertScrollToggle = document.getElementById('invert-scroll-toggle')
    this.colorblindModeSelect = document.getElementById('colorblind-mode-select')
    this.largeTextToggle = document.getElementById('large-text-toggle')
    this.highContrastToggle = document.getElementById('high-contrast-toggle')
    this.focusRingToggle = document.getElementById('focus-ring-toggle')
    this.underlineLinksToggle = document.getElementById('underline-links-toggle')
    this.homepageFpsToggle = document.getElementById('homepage-fps-toggle')
    this.bgMoodSelect = document.getElementById('bg-mood-select')
    this.dyslexiaFontToggle = document.getElementById('dyslexia-font-toggle')
    this.performanceToggle = document.getElementById('performance-toggle')
    this.reduceFlashingToggle = document.getElementById('reduce-flashing-toggle')
    // Graphics tab (see _bindGraphicsSettings)
    this.gfxResolutionSlider = document.getElementById('gfx-resolution-slider')
    this.gfxResolutionValue = document.getElementById('gfx-resolution-value')
    this.fpsCapSelect = document.getElementById('fps-cap-select')
    this.autoQualityToggle = document.getElementById('auto-quality-toggle')
    this.gfxBrightnessSlider = document.getElementById('gfx-brightness-slider')
    this.gfxBrightnessValue = document.getElementById('gfx-brightness-value')
    this.gfxContrastSlider = document.getElementById('gfx-contrast-slider')
    this.gfxContrastValue = document.getElementById('gfx-contrast-value')
    this.gfxShadowsToggle = document.getElementById('gfx-shadows-toggle')
    this.gfxShadowQualitySelect = document.getElementById('gfx-shadow-quality-select')
    this.gfxViewDistanceSelect = document.getElementById('gfx-view-distance-select')
    this.gfxLiteTexturesToggle = document.getElementById('gfx-lite-textures-toggle')
    this.gfxGrainSlider = document.getElementById('gfx-grain-slider')
    this.gfxGrainValue = document.getElementById('gfx-grain-value')
    this.gfxPanelFlickerToggle = document.getElementById('gfx-panel-flicker-toggle')
    this.resetGraphicsDefaultsBtn = document.getElementById('reset-graphics-defaults-btn')
    // General tab (see _bindGeneralSettings)
    this.friendPresenceNotifyToggle = document.getElementById('friend-presence-notify-toggle')
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
    this.settingsInfoOverlay = document.getElementById('settings-info-overlay')
    this.settingsInfoText = document.getElementById('settings-info-text')
    this.oneHandedToggle = document.getElementById('one-handed-toggle')
    this.fullscreenBtn = document.getElementById('fullscreen-btn')
    this.whatsNewEveryLaunchToggle = document.getElementById('whatsnew-every-launch-toggle')
    this.homepageGreetingEl = document.getElementById('homepage-greeting')
    this.streamSafeModeToggle = document.getElementById('stream-safe-mode-toggle')
    this.toastDurationSlider = document.getElementById('toast-duration-slider')
    this.toastDurationValue = document.getElementById('toast-duration-value')
    this.crosshairColorPicker = document.getElementById('crosshair-color-picker')
    this.crosshairSizeSlider = document.getElementById('crosshair-size-slider')
    this.crosshairSizeValue = document.getElementById('crosshair-size-value')
    this.nicknameColorPicker = document.getElementById('nickname-color-picker')
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
    this.guestModeToggle = document.getElementById('guest-mode-toggle')
    this.mutatorHordeRush = document.getElementById('mutator-horde-rush')
    this.mutatorLootRush = document.getElementById('mutator-loot-rush')
    this.mutatorBossRush = document.getElementById('mutator-boss-rush')
    this.mutatorEscalation = document.getElementById('mutator-escalation')
    this.mutatorHealthRegen = document.getElementById('mutator-health-regen')
    this.mutatorIronMode = document.getElementById('mutator-iron-mode')
    this.mutatorGlassHouse = document.getElementById('mutator-glass-house')
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
    this.loginStreak = loadLoginStreak()
    this.leaderboard = loadLeaderboard()
    this.bestRunPace = loadBestRunPace()
    this.nemesis = loadNemesis()

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
    this.stealthTakedowns = 0
    this.hasNightVision = false
    this.coins = this.shopProgress.coins
    // Cash - a 4th currency alongside Coins/Points/Gems, not yet spendable
    // anywhere (same as Gems currently isn't) and with no earning mechanic
    // wired up yet either - just the tracked value + display for now.
    this.cash = this.shopProgress.cash
    this.gems = this.shopProgress.gems
    this.ownsShopSkin = this.shopProgress.ownsShopSkin
    this.charSkins = this.shopProgress.charSkins
    // Landing camera dip (see _updateLandingDip) - a deliberate one-shot
    // downward snap-then-recover on hard falls, distinct from _shakeOffset's
    // random noise above.
    this.runStartedAt = performance.now()
    // Long-Term Goals batch (see _recordRunEnd) - per-run baselines used to
    // derive this run's contribution to the lifetime totals in careerStats.
    // _runStartCoins is a net-earned approximation (coins can be spent
    // mid-run too), not a true gross-earned ledger - fine for a flavor stat.
    this._runStartCoins = this.coins

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


    this.totalSpent = loadTotalSpent()
    this.weeklyChallenge = loadWeeklyChallenge()
    this.weeklyDef = WEEKLY_CHALLENGES[_weeklyChallengeIndex(this.weeklyChallenge.week)]
    this.metaProgress = loadMetaProgress()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    this.quests = new Quests()
    this.rollingQuests = new RollingQuests()
    if (this.achievements.unlocked.has(ENDGAME_ACHIEVEMENT)) {
      document.getElementById('diff-nightmare').style.display = ''
    }
    if (this.achievements.unlocked.has('nightmare_conqueror')) {
      document.getElementById('diff-apex').style.display = ''
    }
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
    this.prestigeCostLine = document.getElementById('prestige-cost-line')
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
    this.invRarityFilterBtn = document.getElementById('inv-rarity-filter-btn')
    this.invRarityFilterMenu = document.getElementById('inv-rarity-filter-menu')
    this._invRarity = 'all'
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
    // Player Market listings (CloudSync.fetchActiveMarketListings), fetched
    // in the background after boot and refreshed whenever the Market opens.
    // null = not loaded yet, 'error' = failed.
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
    this.goalsHeading = document.getElementById('goals-heading')
    this.goalsPicker = document.getElementById('goals-picker')
    this.goalsChecklist = document.getElementById('goals-checklist')
    this.creditsPanel = document.getElementById('credits-panel')
    this.creditsPanelTitle = document.getElementById('credits-panel-title')
    this.creditsPrivacyLink = document.getElementById('credits-privacy-link')
    this.creditsTermsLink = document.getElementById('credits-terms-link')
    this.levelsPanel = document.getElementById('levels-panel')
    this.galleryPanel = document.getElementById('gallery-panel')
    this.levelsPanelTitle = document.getElementById('levels-panel-title')
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
    this.featuresLayout = document.getElementById('features-layout')
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
    // Unopened crate stock (see loadShopProgress's own comment) - a plain
    // object, not a Set/Map, since it's just an integer count per tier,
    // not a collection of distinct owned ids.
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
    this._bindGameModeSelect()
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
    // Fetch the Map 1 / Map Editor code while the player looks at the
    // homepage, so Play opens the map straight away.
    // With a deadline: the homepage's rain and water redraw every frame, so
    // a busy device may never report itself idle - without one these never
    // ran and Play did all of it at once.
    const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 2500 }) : (fn) => setTimeout(fn, 1500)
    // Then build the editor ahead of time too (its own idle slice) - the
    // same object an exited editor leaves behind, so nothing else changes.
    // (Generating Map 1's city here as well was tried: on a slow device it
    // kept the page busy long enough to drop a player who had just joined
    // a server, so the city is still generated when Play is pressed.)
    idle(() => this._preloadBuildMode().then(({ BuildMode }) => {
      idle(() => {
        if (typeof this.buildMode.enter !== 'function' && !this._enteringBuildMode) this.buildMode = new BuildMode(this.renderer, this)
      })
    }).catch(() => { /* tried again on Play */ }))
    // The Market's listings too, so opening it shows them at once.
    setTimeout(() => idle(() => { if (this._marketListings === null) this._loadMarketListings() }), 3000)
    // And Design a Skin (2026-10-16, "when you reload the design a skin is
    // already reloaded for you"): its page loads in the hidden panel, so
    // opening it shows the finished tool at once.
    setTimeout(() => idle(() => this._preloadSkinDesigner()), SKIN_DESIGNER_PRELOAD_MS)
    // (The weapon pictures aren't drawn here: drawn one per break as blob
    // URLs they no longer freeze anything, so they start when the weapon
    // picker or Inventory first needs them - drawing them at page load
    // competed with a game that had just started on a slow device.)
    // Keep the next visit's first paint in step with this one.
    this._saveMenuPaintCache()
    window.addEventListener('pagehide', () => this._saveMenuPaintCache())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._saveMenuPaintCache()
    })

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
      // Black on the Old theme's paper, like the rest of Profile.
      ctx.fillStyle = document.documentElement.classList.contains('ui-theme-old') ? '#000' : 'rgba(232, 232, 232, 0.6)'
      ctx.font = '9px monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(run.kills), x + (barW - 4) / 2, h - 2)
    })
  }

  _bindEditableSliderValue(valueEl, sliderEl) { return SettingsUI._bindEditableSliderValue(this, valueEl, sliderEl) }

  _applyAllVolumes() { return SettingsUI._applyAllVolumes(this) }

  _bindSettings() { return SettingsUI._bindSettings(this) }

  _bindGraphicsSettings() { return SettingsUI._bindGraphicsSettings(this) }

  _bindGeneralSettings() { return SettingsUI._bindGeneralSettings(this) }


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
    // The player's own clock and time zone (the device's).
    if (!this._clockZoneShown) {
      this._clockZoneShown = true
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (zone) this.homepageClockEl.title = `${this.homepageClockEl.title || 'Current time'} (${zone.replace(/_/g, ' ')})`
    }
    if (this.settings.timeFormat === '24h') {
      this.homepageClockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    } else {
      const h24 = now.getHours()
      const h12 = h24 % 12 || 12
      this.homepageClockEl.textContent = `${h12}:${String(now.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
    }
  }

  _applyGrainIntensity() { return SettingsUI._applyGrainIntensity(this) }

  _resetGraphicsDefaults() { return SettingsUI._resetGraphicsDefaults(this) }

  _applyGraphicsFilters() { return SettingsUI._applyGraphicsFilters(this) }

  _resolveShadowsEnabled() { return SettingsUI._resolveShadowsEnabled(this) }

  _applyShadowQuality() { return SettingsUI._applyShadowQuality(this) }

  _renderNavOrderList() { return SettingsUI._renderNavOrderList(this) }

  _moveNavOrder(id, delta) { return SettingsUI._moveNavOrder(this, id, delta) }

  _applyNavOrder() { return SettingsUI._applyNavOrder(this) }

  _bindSettingsSearch() { return SettingsUI._bindSettingsSearch(this) }

  _bindControlsTab() { return SettingsUI._bindControlsTab(this) }

  _restoreDefaultSettings() { return SettingsUI._restoreDefaultSettings(this) }

  _handleResetProgressClick() { return SettingsUI._handleResetProgressClick(this) }

  _exportSave() { return SettingsUI._exportSave(this) }

  _copySaveToClipboard() { return SettingsUI._copySaveToClipboard(this) }

  _exportSettingsCode() { return SettingsUI._exportSettingsCode(this) }

  _importSettingsCode(code) { return SettingsUI._importSettingsCode(this, code) }

  _exportKeybindsCode() { return SettingsUI._exportKeybindsCode(this) }

  _importKeybindsCode(code) { return SettingsUI._importKeybindsCode(this, code) }

  _applyImportedSaveData(data) { return SettingsUI._applyImportedSaveData(this, data) }

  _importSaveFile(file) { return SettingsUI._importSaveFile(this, file) }

  _snapshotLocalSave() { return SettingsUI._snapshotLocalSave(this) }

  _renderCloudOnlineSection() { return OnlineUI._renderCloudOnlineSection(this) }

  _renderMyRank() { return OnlineUI._renderMyRank(this) }

  _renderRival() { return OnlineUI._renderRival(this) }

  _renderNearbyRank() { return OnlineUI._renderNearbyRank(this) }

  _renderFriendsCount() { return FriendsUI._renderFriendsCount(this) }

  _renderSavedFriends() { return FriendsUI._renderSavedFriends(this) }

  _openOtherPlayerProfile(uid, fallbackName) { return FriendsUI._openOtherPlayerProfile(this, uid, fallbackName) }

  _openOtherPlayerProfileById(playerId, fallbackName) { return FriendsUI._openOtherPlayerProfileById(this, playerId, fallbackName) }

  _showOtherProfileLoading(fallbackName) { return FriendsUI._showOtherProfileLoading(this, fallbackName) }

  _renderOtherProfileEntry(entry, fallbackName) { return FriendsUI._renderOtherProfileEntry(this, entry, fallbackName) }

  _renderOtherProfilePublicFields(entry) { return FriendsUI._renderOtherProfilePublicFields(this, entry) }

  _closeOtherPlayerProfile() { return FriendsUI._closeOtherPlayerProfile(this) }

  _fetchFriendPresences(friends) { return FriendsUI._fetchFriendPresences(this, friends) }

  _computeFriendStatus(presence) { return FriendsUI._computeFriendStatus(this, presence) }

  _findSavedFriend(...args) { return FriendsUI._findSavedFriend(this, ...args) }

  _sendFriendRequestClick() { return FriendsUI._sendFriendRequestClick(this) }

  _sendFriendRequestTo(entry) { return FriendsUI._sendFriendRequestTo(this, entry) }

  _searchFriendNames(text) { return FriendsUI._searchFriendNames(this, text) }

  _searchPlayerNames(text, who) { return FriendsUI._searchPlayerNames(this, text, who) }

  _showClanSuggestions(list) { return ClanUI._showClanSuggestions(this, list) }

  _sendClanInviteClick() { return ClanUI._sendClanInviteClick(this) }

  _sendClanInviteTo(target) { return ClanUI._sendClanInviteTo(this, target) }

  _showFriendSuggestions(list) { return FriendsUI._showFriendSuggestions(this, list) }

  _renderFriendRequests() { return FriendsUI._renderFriendRequests(this) }

  _respondToFriendRequest(fromUid, fromNickname, accept) { return FriendsUI._respondToFriendRequest(this, fromUid, fromNickname, accept) }

  _deleteAllFriendRequests() { return FriendsUI._deleteAllFriendRequests(this) }

  _updateFriendsDot() { return FriendsUI._updateFriendsDot(this) }

  _checkFriendAcceptedNotifications() { return FriendsUI._checkFriendAcceptedNotifications(this) }

  _markFriendAcceptedSeen() { return FriendsUI._markFriendAcceptedSeen(this) }

  _renderGlobalKills() { return OnlineUI._renderGlobalKills(this) }

  _renderLeaderboardRows(rows) { return OnlineUI._renderLeaderboardRows(this, rows) }

  _subscribeLeaderboard() { return OnlineUI._subscribeLeaderboard(this) }

  _renderAchievementsLeaderboard() { return OnlineUI._renderAchievementsLeaderboard(this) }

  _renderGlobalAverages() { return OnlineUI._renderGlobalAverages(this) }

  _renderWeeklyLeaderboardList() { return OnlineUI._renderWeeklyLeaderboardList(this) }

  _renderPoll() { return OnlineUI._renderPoll(this) }

  _castVote(option) { return OnlineUI._castVote(this, option) }

  _pushOnlineStats() { return OnlineUI._pushOnlineStats(this) }

  _handleCloudSignIn() { return OnlineUI._handleCloudSignIn(this) }

  _afterCloudSignIn(uid, profile) { return OnlineUI._afterCloudSignIn(this, uid, profile) }

  _checkForNewerCloudSave(_uid) { return OnlineUI._checkForNewerCloudSave(this, _uid) }

  _flushLocalSave() { return OnlineUI._flushLocalSave(this) }

  _hasMeaningfulLocalProgress() { return OnlineUI._hasMeaningfulLocalProgress(this) }

  _compareSaveFile(file) { return OnlineUI._compareSaveFile(this, file) }

  _updateStorageUsageLine() { return OnlineUI._updateStorageUsageLine(this) }

  _clearLeaderboardsOnly() { return OnlineUI._clearLeaderboardsOnly(this) }

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

  _renderControlsGrid() { return SettingsUI._renderControlsGrid(this) }

  _startRebind(btn, action) { return SettingsUI._startRebind(this, btn, action) }

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

  // The editor's code (BuildMode.js and everything it imports) - one
  // download shared by the idle preload and _enterBuildMode.
  _preloadBuildMode() {
    if (!this._buildModeImport) {
      this._buildModeImport = import('./BuildMode.js')
      this._buildModeImport.catch(() => { this._buildModeImport = null })
    }
    return this._buildModeImport
  }

  // Build Mode - a standalone block-placing sandbox (see BuildMode.js's own
  // comment), reachable from the homepage. Reuses this.menu's existing
  // hide/show pattern (same as starting a real run) rather than a new panel.
  // map: 'map3' opens the ready-made Map 3 city (Map3Generator.js); 'map2'
  // leaves it for the player's own slots. Omitted keeps the last slot.
  // play: start Play (zombie waves, BuildSurvival.js) on it straight away -
  // Game Mode's Map 3 + the Play button.
  // server: a server joined or made from the Global panel (ServerBrowser.js)
  // - the run is played with the others on it (PlayNet.js).
  async _enterBuildMode({ map, play = false, server = null } = {}) {
    // A second click while the code is still downloading does nothing.
    if (this._enteringBuildMode) return
    // No "Loading Map Editor..." screen any more (2026-10-10, Gaymi: "dont
    // make it loading game just load the game"): the homepage stays up
    // while the code loads (already fetched in the background, see
    // _preloadBuildMode) and is hidden in the same frame the map appears.
    // Play fades the screen to black first and does the heavy part (the
    // code, building Map 1) while it's dark, then fades back in on the map
    // - a smooth fade instead of the homepage freezing for a moment
    // (2026-10-10, "make it just slowly fade when it's loading instead of
    // making the page lag").
    this._enteringBuildMode = true
    try {
      // The Map Editor fades too (2026-10-12): a quick dip to black, then
      // a fade back in whose speed follows how heavy the load was.
      this._fadeStartedAt = performance.now()
      await this._fadeScreen(1, play ? PLAY_FADE_MS : EDITOR_FADE_OUT_MS)
      if (typeof this.buildMode.enter !== 'function') {
        const { BuildMode } = await this._preloadBuildMode()
        this.buildMode = new BuildMode(this.renderer, this)
      }
    } catch (e) {
      this._fadeScreen(0)
      throw e
    } finally {
      this._enteringBuildMode = false
    }
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
    this.menu.style.display = 'none'
    const current = this.buildMode.activeSlot
    const slot = map === 'map3' ? 'map3' : map === 'map2' && current === 'map3' ? 0 : undefined
    this.buildMode.enter({ slot })
    // Map 1's open world grows new land every game (OpenWorld.js) - the
    // same land for everyone on a server, made from its id.
    this.buildMode.world?.reseed(server?.serverId ? seedFromText(server.serverId) : undefined)
    // The 3D canvas isn't resized on the homepage (_onResize) - catch up now.
    if (this._sizeDirty) this._onResize()
    if (play) this.buildMode.survival.start({ fromMenu: true, net: server ? new PlayNet(this, server) : null })
    this._applyRenderScale()
    this._fadeScreen(0)
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
  }

  // Fades #play-fade (a black cover over everything) in (1) or out (0).
  // Resolves once the fade has finished and the screen has painted, so
  // work done after `await this._fadeScreen(1)` happens behind black. Fading
  // out waits two frames first, so the map's first frame is already drawn.
  async _fadeScreen(to, ms = PLAY_FADE_MS) {
    let el = document.getElementById('play-fade')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-fade'
      document.body.appendChild(el)
    }
    const frame = () => new Promise((r) => requestAnimationFrame((t) => r(t)))
    if (to) {
      el.style.transitionDuration = ms + 'ms'
      el.style.display = 'block'
      void el.offsetWidth
      el.classList.add('on')
      await new Promise((r) => setTimeout(r, ms))
      await frame()
      await frame()
      return
    }
    // Fading back in: slowly if the load was heavy or the first frames on
    // the map are still slow (it would stutter otherwise), quickly if not
    // (2026-10-12, "make it slowly fade in if it's lagging, if not just
    // make it fade in faster").
    const loadMs = performance.now() - (this._fadeStartedAt || performance.now())
    let last = await frame()
    let slowest = 0
    for (let i = 0; i < 4; i++) {
      const t = await frame()
      slowest = Math.max(slowest, t - last)
      last = t
    }
    const lagging = loadMs > FADE_LAG_LOAD_MS || slowest > FADE_LAG_FRAME_MS
    const inMs = lagging ? FADE_IN_SLOW_MS : FADE_IN_FAST_MS
    this._lastFadeIn = { loadMs: Math.round(loadMs), slowest: Math.round(slowest), inMs }
    el.style.transitionDuration = inMs + 'ms'
    el.classList.remove('on')
    setTimeout(() => {
      if (!el.classList.contains('on')) el.style.display = 'none'
    }, inMs)
  }

  // The run settings for a Map 1 run from the homepage: Game Mode's
  // Difficulty / Game Modes / Challenges & Mutators, plus
  // the Upgrades bought with Legacy Points (PlayRules.js).
  _playConfig() {
    return {
      ...playConfig({
        difficulty: DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal,
        gameMode: this.settings.selectedGameMode,
        mutators: this.settings.mutators,
        purchased: this.metaProgress.purchased,
      }),
      // Read by achievements (what the run was played on).
      difficulty: this.settings.difficulty,
    }
  }

  // What a homepage Map 1 run tells the game (BuildSurvival._report):
  // 'kill', 'wave', and 'end' once per run. Guest Mode saves none of it.
  // 'end' returns what the run earned, for the game-over card.
  _onPlayEvent(type, data) {
    if (this.settings.guestMode) return null
    if (type === 'kill') {
      this.rollingQuests.recordKill()
      this._checkWeeklyChallengeProgress()
      this.achievements.unlock('first_blood')
      if (data.boss) this.achievements.unlock('giant_slayer')
      if (data.weapon) this._recordArsenalKill(data.weapon)
      return null
    }
    if (type === 'wave') {
      const wave = data.wave
      this.rollingQuests.recordNight(wave)
      if (wave >= 5) this.achievements.unlock('survivor_5')
      if (wave >= 10) this.achievements.unlock('survivor_10')
      if (wave >= SURVIVOR_20_WAVES) this.achievements.unlock('survivor_20')
      if (this.settings.difficulty === 'nightmare' && wave >= 5) this.achievements.unlock('nightmare_survivor_5')
      if (wave >= SURVIVOR_30_WAVES) this.achievements.unlock('survivor_30')
      const hardOrHarder = ['hard', 'nightmare', 'apex'].includes(data.difficulty)
      if (hardOrHarder && wave >= HARDENED_WAVES) this.achievements.unlock('hardened')
      if (data.difficulty === 'apex' && wave >= APEX_PREDATOR_WAVES) this.achievements.unlock('apex_predator')
      const mutators = Array.isArray(data.mutators) ? data.mutators : []
      if (mutators.includes('glassHouse') && wave >= MUTATOR_CHALLENGE_WAVES) this.achievements.unlock('glass_cannon')
      if (mutators.includes('ironMode') && wave >= MUTATOR_CHALLENGE_WAVES) this.achievements.unlock('iron_will')
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
    this._runStartCoins = this.coins
    // The camp coins earned in the run go to your real coins too, plus
    // this week's featured mutator bonus.
    let coins = data.coins
    if (this.settings.mutators[_weeklyFeaturedMutatorKey()]) coins += WEEKLY_FEATURED_MUTATOR_BONUS_COINS
    this.coins += coins
    this.careerStats.lifetimePointsEarned = (this.careerStats.lifetimePointsEarned || 0) + points
    if (data.died) this.achievements.unlock('first_death')
    if (data.kills >= 100) this.achievements.unlock('centurion')
    if (data.bestStreak >= MEAT_GRINDER_STREAK) this.achievements.unlock('meat_grinder')
    if (data.won && this.settings.difficulty === 'nightmare') this.achievements.unlock('nightmare_conqueror')
    if (data.won && data.mode === 'zombieDefense') this.achievements.unlock('holding_the_line')
    if (data.headshots >= HEADHUNTER_HEADSHOTS) this.achievements.unlock('headhunter')
    if (data.meleeKills >= UP_CLOSE_KNIFE_KILLS) this.achievements.unlock('up_close')
    if (data.seconds >= MARATHON_SECONDS) this.achievements.unlock('marathon')
    if (data.chests >= TREASURE_HUNTER_CHESTS) this.achievements.unlock('treasure_hunter')
    if (data.upgrades >= FULLY_LOADED_UPGRADES) this.achievements.unlock('fully_loaded')
    if (data.coins >= DEEP_POCKETS_COINS) this.achievements.unlock('deep_pockets')
    if (data.kills >= MASSACRE_KILLS) this.achievements.unlock('massacre')
    if (data.bestStreak >= UNTOUCHABLE_STREAK) this.achievements.unlock('untouchable')
    if (data.headshots >= SHARPSHOOTER_HEADSHOTS) this.achievements.unlock('sharpshooter')
    if (data.bosses >= BOSS_HUNTER_BOSSES) this.achievements.unlock('boss_hunter')
    if (data.won && data.mode === 'zombieExtraction') this.achievements.unlock('get_to_the_chopper')
    if (data.coins >= FORTUNE_HUNTER_COINS) this.achievements.unlock('fortune_hunter')
    // +10% per Prestige level, as the Prestige line promises.
    const legacy = Math.floor(points * DEATH_POINTS_CONVERSION * (1 + (PRESTIGE_BONUS_PERCENT / 100) * Math.floor(_safeStatNumber(this.metaProgress.prestigeLevel))))
    this.metaProgress.legacyPoints += legacy
    saveMetaProgress(this.metaProgress)
    this._recordRunEnd(!data.died)
    // Career totals (_recordRunEnd just added this run to them).
    if (_safeStatNumber(this.careerStats.totalKills) >= EXTERMINATOR_CAREER_KILLS) this.achievements.unlock('exterminator')
    if (_safeStatNumber(this.careerStats.totalRuns) >= REGULAR_CAREER_RUNS) this.achievements.unlock('regular')
    saveShopProgress(this)
    this._renderCurrencyBar()
    this._updateUpgradesDot()
    this._updateQuestsDot()
    return { legacy, coins }
  }

  // Arsenal: remembers every gun you've killed a zombie with (ever).
  _recordArsenalKill(weaponId) {
    let used = []
    try {
      const raw = JSON.parse(localStorage.getItem(ARSENAL_KEY) || '[]')
      if (Array.isArray(raw)) used = raw.filter((id) => typeof id === 'string')
    } catch { /* bad data: start over */ }
    if (used.includes(weaponId)) return
    used.push(weaponId)
    try { localStorage.setItem(ARSENAL_KEY, JSON.stringify(used)) } catch { /* storage full */ }
    if (used.length >= ARSENAL_WEAPONS) this.achievements.unlock('arsenal')
  }

  // Weekly Challenge (WEEKLY_CHALLENGES) - every Map 1 kill counts toward
  // this week's target; finishing it pays its coins once.
  _checkWeeklyChallengeProgress() {
    if (!this.weeklyDef || this.weeklyChallenge.completed) return
    if (this.weeklyChallenge.week !== _thisWeekStr()) this.weeklyChallenge = loadWeeklyChallenge()
    this.weeklyChallenge.progress += 1
    if (this.weeklyChallenge.progress >= this.weeklyDef.target) {
      this.weeklyChallenge.completed = true
      this.coins += this.weeklyDef.rewardCoins
      saveShopProgress(this)
      this._showLoreToast(t('weeklyChallengeComplete', { title: t(this.weeklyDef.titleKey), coins: this.weeklyDef.rewardCoins }))
    }
    saveWeeklyChallenge(this.weeklyChallenge)
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
      // What's New on this page gets the new notes too, so the card never
      // shows a version the Patch Notes don't have yet (2026-10-12, Gaymi:
      // the card said v0.17 while What's New still said v0.16) - and both
      // only show entries whose day has started on the player's clock.
      const list = document.getElementById('changelog-list')
      if (list) {
        list.innerHTML = freshChangelogList.innerHTML
        this._gateChangelog()
      }
      // Only the newest entry - the card is small; the full list is one
      // click away in What's New.
      const entries = [...(list || freshChangelogList).querySelectorAll('.changelog-entry:not(.changelog-future)')].slice(0, 1)
      if (!entries.length) return
      this.updateAvailableChangelog.innerHTML = entries.map((entry) => entry.outerHTML).join('')
      this._pendingUpdateId = id
      if (this.updateAvailableTitleEl) this.updateAvailableTitleEl.textContent = t('navLinkWhatsNew')
      if (this.updateAvailableRefreshBtn) this.updateAvailableRefreshBtn.textContent = t('updateAvailableRefreshBtn')
      this.updateAvailableBanner.classList.remove('fading')
      this.updateAvailableBanner.style.display = 'flex'
      this._scheduleUpdateBannerFade()
    } catch {
      // A failed check (offline, blocked request, etc.) just means no
      // banner this time - not a player-facing error worth surfacing.
    }
  }

  // Patch Notes go live at 12am on each player's own clock (2026-10-12,
  // Gaymi: "each player sees a new v# at their time zone at 12am"): an
  // entry dated later than the player's local today is hidden until their
  // midnight, then shown without a reload.
  _gateChangelog() {
    const list = document.getElementById('changelog-list')
    if (!list) return
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const now = Date.now()
    for (const el of list.querySelectorAll('.changelog-entry')) {
      const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(el.querySelector('.changelog-date')?.textContent || '')
      const month = m ? MONTHS.indexOf(m[1]) : -1
      // Local midnight of the entry's date.
      const startsAt = month >= 0 ? new Date(Number(m[3]), month, Number(m[2])).getTime() : 0
      el.classList.toggle('changelog-future', startsAt > now)
    }
    clearTimeout(this._changelogMidnightTimer)
    const next = new Date()
    next.setHours(24, 0, 1, 0)
    this._changelogMidnightTimer = setTimeout(() => this._gateChangelog(), next.getTime() - now)
  }

  // Fades the What's New card out by itself after UPDATE_BANNER_SHOW_MS if
  // the player leaves it alone - the timer waits while the mouse is over it.
  _scheduleUpdateBannerFade() {
    const banner = this.updateAvailableBanner
    clearTimeout(this._updateBannerTimer)
    if (!banner._fadeBound) {
      banner._fadeBound = true
      banner.addEventListener('mouseenter', () => clearTimeout(this._updateBannerTimer))
      banner.addEventListener('mouseleave', () => this._scheduleUpdateBannerFade())
    }
    this._updateBannerTimer = setTimeout(() => this._hideUpdateBanner(), UPDATE_BANNER_SHOW_MS)
  }

  // Closed with the X or faded away: remember this version was seen, so
  // coming back to the homepage doesn't show the same card again (a newer
  // deploy still gets its own).
  _hideUpdateBanner() {
    const banner = this.updateAvailableBanner
    if (!banner || banner.style.display === 'none') return
    clearTimeout(this._updateBannerTimer)
    this.settings.lastSeenBuildId = this._pendingUpdateId
    saveSettings(this.settings)
    banner.classList.add('fading')
    setTimeout(() => {
      if (banner.classList.contains('fading')) banner.style.display = 'none'
    }, UPDATE_BANNER_FADE_MS)
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
        subTabs: this._subTabsFor('achievements-tab-', ['survival', 'deathmatch', 'parkour']),
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
      { slug: 'gallery', panel: this.galleryPanel, open: () => this._openGalleryPanel() },
      { slug: 'terms', panel: this.termsPanel, open: () => this._openTermsPanel() },
      { slug: 'privacy', panel: this.privacyPanel, open: () => this._openPrivacyPanel() },
      { slug: 'features', panel: this.featuresPanel, open: () => this._openFeaturesPanel() },
      { slug: 'design-a-skin', panel: this.skindesignerPanel, open: () => this._openSkinDesignerPanel() },
      { slug: 'how-to-play', panel: this.howtoplayPanel, open: () => this._openHowToPlayPanel() },
      { slug: 'whats-new', panel: this.whatsNewPanel, open: () => this._openWhatsNewPanel() },
      {
        slug: 'gamemode', panel: this.hubPanel, open: () => this._openHubPanel(),
        subTabs: this._subTabsFor('hub-tab-', ['survival', 'deathmatch', 'parkour', 'custom']),
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
    if (this.galleryPanel) this._closeGalleryPanel()
    if (this.termsPanel) this._closeTermsPanel()
    if (this.privacyPanel) this._closePrivacyPanel()
    if (this.featuresPanel) this._closeFeaturesPanel()
    if (this.skindesignerPanel) this._closeSkinDesignerPanel()
    if (this.shopPanel) this._closeShopPanel()
    if (this.marketPanel) this._closeMarketPanel()
    this._closeTradeDialog()
    if (this.whatsNewPanel) this._closeWhatsNewPanel()
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
    // The star at the top left is these Points - keep it in step with every
    // buy, respec and prestige (it used to only update after a run).
    this._renderCurrencyBar()
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
    const prestigeUnlocked = this.achievements.unlocked.has(ENDGAME_ACHIEVEMENT)
    this.prestigeSection.style.display = prestigeUnlocked ? 'block' : 'none'
    if (prestigeUnlocked) {
      this.prestigeLevelLine.textContent = t('prestigeLevelLine', { level: this.metaProgress.prestigeLevel, bonus: this.metaProgress.prestigeLevel * PRESTIGE_BONUS_PERCENT })
      // Each Prestige level costs more (2026-10-12, "100k points to
      // prestige to level 1 then 200k for level 2 and keep going").
      const cost = this._prestigeCost()
      this.prestigeBtn.textContent = t('prestigeBtn')
      this.prestigeBtn.disabled = this.metaProgress.legacyPoints < cost
      if (this.prestigeCostLine) this.prestigeCostLine.textContent = t('prestigeCostLine', { level: this.metaProgress.prestigeLevel + 1, cost: cost.toLocaleString(), have: Math.floor(_safeStatNumber(this.metaProgress.legacyPoints)).toLocaleString() })
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
  // Points needed for the next Prestige level: PRESTIGE_COST_STEP per level.
  _prestigeCost() {
    return (Math.floor(_safeStatNumber(this.metaProgress.prestigeLevel)) + 1) * PRESTIGE_COST_STEP
  }

  _prestige() {
    if (this.metaProgress.legacyPoints < this._prestigeCost()) return
    if (!window.confirm(t('prestigeConfirm'))) return
    this.metaProgress.prestigeLevel += 1
    this.metaProgress.legacyPoints = 0
    this.metaProgress.purchased = new Set()
    this.metaProgress.prestigeHistory.push({ level: this.metaProgress.prestigeLevel, ts: Date.now() })
    saveMetaProgress(this.metaProgress)
    this._showLoreToast(t('prestigeComplete', { level: this.metaProgress.prestigeLevel, bonus: this.metaProgress.prestigeLevel * PRESTIGE_BONUS_PERCENT }))
    this._renderUpgradesOptions()
    this._saveMenuPaintCache?.()
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
    // Lifetime quests are Coming Soon while QUESTS is empty.
    const lifetimeSoon = document.getElementById('lifetime-quests-placeholder')
    if (lifetimeSoon) {
      lifetimeSoon.textContent = t('monthlyQuestsPlaceholder')
      lifetimeSoon.style.display = QUESTS.length ? 'none' : ''
    }
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

  // Favicon Quest Badge - draws the real tab icon (favicon-64.png) onto an offscreen
  // canvas plus a small red count badge (capped display at "9+") when
  // quests are complete but not yet claimed, then swaps the <link
  // rel="icon"> href to the resulting data URL. Same-origin PNG, so the
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
    this.achievementsPanelTitle.textContent = `${t('achievementsPanelTitle')} (${this.achievements.unlocked.size}/${ACHIEVEMENTS.length})`
    if (this.achievementsFilterInput) this.achievementsFilterInput.placeholder = t('achievementsFilterPlaceholder')
    this._renderAchievementsPanel()
    this._markAchievementsSeen()
  }

  _renderAchievementsPanel() {
    // Deathmatch and Parkour have no achievements yet - a placeholder.
    const deathmatch = this._achievementsMode !== 'survival'
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
    // (replaced the old Unlock Date sort per direct request).
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

  _openClanPanel() { return ClanUI._openClanPanel(this) }

  _closeClanPanel() { return ClanUI._closeClanPanel(this) }

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
    this._renderFriendsCount()
    this._renderStatusPicker()
    if (this.friendsOwnId) this.friendsOwnId.textContent = this.settings.playerId ? `#${this.settings.playerId}` : ''
    this._markFriendAcceptedSeen()
  }

  _closeFriendsPanel() {
    if (this.friendsPanel) this.friendsPanel.style.display = 'none'
    if (this.statusPicker) this.statusPicker.classList.remove('open')
  }

  _openMenuInventoryPanel() { return InventoryUI._openMenuInventoryPanel(this) }

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

  _loadMarketListings() { return InventoryUI._loadMarketListings(this) }

  _openMarketPanel() { return InventoryUI._openMarketPanel(this) }

  // Items you can filter by: Character, then every weapon (Kirka's market
  // lists every weapon the same way). Market skins without a `kind` are
  // character skins.
  _marketItemOptions() {
    const weapons = this.weapons.getSummary()
      .map((w) => ({ id: w.id, label: t(w.nameKey) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return [{ id: 'character', label: t('marketItemCharacter') }, ...weapons]
  }

  _renderMarketFilters() { return InventoryUI._renderMarketFilters(this) }

  _renderRarityFilter(btn, menu, current) { return InventoryUI._renderRarityFilter(this, btn, menu, current) }

  _closeMarketFilterMenus() { return InventoryUI._closeMarketFilterMenus(this) }

  _toggleMarketFilterMenu(btn, menu) { return InventoryUI._toggleMarketFilterMenu(this, btn, menu) }

  _closeMarketPanel() { return InventoryUI._closeMarketPanel(this) }

  _renderShopMarket() { return InventoryUI._renderShopMarket(this) }

  _removeSkinFromInventory(id) { return InventoryUI._removeSkinFromInventory(this, id) }

  _addSkinToInventory(id) { return InventoryUI._addSkinToInventory(this, id) }

  _afterTradeChange() { return InventoryUI._afterTradeChange(this) }

  // Market fee: 5% of the asking price, taken from what the seller gets.
  _marketFee(price) {
    return Math.ceil(price * MARKET_FEE_RATE)
  }

  _openTradeDialog(mode, opts) { return InventoryUI._openTradeDialog(this, mode, opts) }

  _closeTradeDialog() { return InventoryUI._closeTradeDialog(this) }

  _tradeDialogPriceValue() {
    const n = Math.floor(Number(this.tradeDialogPrice.value))
    return Number.isFinite(n) ? Math.max(1, Math.min(10000000, n)) : 1
  }

  _updateTradeDialogFee() { return InventoryUI._updateTradeDialogFee(this) }

  _stepTradeDialogPrice(dir) { return InventoryUI._stepTradeDialogPrice(this, dir) }

  // Signed-in account needed for anything that touches the shared Market.
  async _marketUid() {
    await this._authReadyPromise
    if (!this._cloudUid) {
      this._showHomepageToast(t('marketSignInNeeded'))
      return null
    }
    return this._cloudUid
  }

  _confirmTradeDialog() { return InventoryUI._confirmTradeDialog(this) }

  _listSkinOnMarket(id, price) { return InventoryUI._listSkinOnMarket(this, id, price) }

  _buyMarketListing(listing) { return InventoryUI._buyMarketListing(this, listing) }

  _cancelMarketListing(listing) { return InventoryUI._cancelMarketListing(this, listing) }

  _claimMarketSales() { return InventoryUI._claimMarketSales(this) }

  _formatSkinPrice(currency, amount) {
    const n = Math.floor(amount).toLocaleString()
    return currency === 'gems' ? t('skinPriceGems', { n }) : t('skinPriceCoins', { n })
  }

  _equippedInventorySkinId() { return InventoryUI._equippedInventorySkinId(this) }

  _renderInventorySkins() { return InventoryUI._renderInventorySkins(this) }

  _renderInventorySkinPreview() { return InventoryUI._renderInventorySkinPreview(this) }

  _openInventorySkinMenu(card) { return InventoryUI._openInventorySkinMenu(this, card) }

  _closeInventorySkinMenu() { return InventoryUI._closeInventorySkinMenu(this) }

  _openSellDialog(id) { return InventoryUI._openSellDialog(this, id) }

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

  _openInspectDialog(kind, id) { return InventoryUI._openInspectDialog(this, kind, id) }

  _closeInspectDialog() { return InventoryUI._closeInspectDialog(this) }

  _equipInventorySkin(id) { return InventoryUI._equipInventorySkin(this, id) }

  _closeMenuInventoryPanel() { return InventoryUI._closeMenuInventoryPanel(this) }

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
    // The servers beside the chat (ServerBrowser.js) need no sign-in.
    ServerBrowser.openServerBrowser(this)
    await this._authReadyPromise
    ChatUI.renderServerChatSignInState(this)
  }

  _closeServerPanel() {
    if (this.serverPanel) this.serverPanel.style.display = 'none'
    ChatUI.unsubscribeServerChat(this)
    ServerBrowser.closeServerBrowser(this)
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
    const galleryLink = document.getElementById('nav-gallery-link')
    if (galleryLink) galleryLink.querySelector('span').textContent = t('galleryBtn')
    GalleryUI.renderTexts(this)
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
    if (this.friendsSigninBtn) this.friendsSigninBtn.textContent = t('signUpOrLoginBtn')
    if (this.menuInventoryBtn) this.menuInventoryBtn.querySelector('span').textContent = t('menuInventoryBtn')
    if (this.serverBtn) this.serverBtn.querySelector('span').textContent = t('serverBtn')



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
    document.getElementById('mutator-horde-rush-label').textContent = t('mutatorHordeRush')
    document.getElementById('mutator-loot-rush-label').textContent = t('mutatorLootRush')
    document.getElementById('mutator-boss-rush-label').textContent = t('mutatorBossRush')
    document.getElementById('mutator-escalation-label').textContent = t('mutatorEscalation')
    document.getElementById('mutator-health-regen-label').textContent = t('mutatorHealthRegen')
    document.getElementById('mutator-iron-mode-label').textContent = t('mutatorIronMode')
    document.getElementById('mutator-glass-house-label').textContent = t('mutatorGlassHouse')
    document.getElementById('ambient-volume-label').textContent = t('ambientVolumeLabel')
    document.getElementById('mute-on-blur-label').textContent = t('muteOnBlurLabel')
    document.getElementById('positional-audio-label').textContent = t('positionalAudioLabel')
    document.getElementById('invert-scroll-label').textContent = t('invertScrollLabel')
    document.getElementById('fps-cap-label').textContent = t('fpsCapLabel')
    document.getElementById('auto-quality-label').textContent = t('autoQualityLabel')
    document.getElementById('touch-controls-override-hint').textContent = t('touchControlsOverrideHint')
    document.getElementById('friend-presence-notify-label').textContent = t('friendPresenceNotifyLabel')
    document.getElementById('time-format-label').textContent = t('timeFormatLabel')
    document.getElementById('autosave-frequency-label').textContent = t('autosaveFrequencyLabel')
    document.getElementById('hud-fps-label').textContent = t('hudFpsLabel')
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
    document.getElementById('one-handed-label').textContent = t('oneHandedLabel')
    document.getElementById('whatsnew-every-launch-label').textContent = t('whatsNewEveryLaunchLabel')
    document.getElementById('reduce-flashing-label').textContent = t('reduceFlashingLabel')
    document.getElementById('stream-safe-mode-label').textContent = t('streamSafeModeLabel')
    document.getElementById('toast-duration-label').textContent = t('toastDurationLabel')
    document.getElementById('crosshair-color-label').textContent = t('crosshairColorLabel')
    document.getElementById('crosshair-size-label').textContent = t('crosshairSizeLabel')
    document.getElementById('nickname-color-label').textContent = t('nicknameColorLabel')

    this._updateBestStatsDisplay()
  }

  // Homepage corner currency bar (Coins/Points/Gems) - piggybacks on the
  // same two already-everywhere call sites _updateStatsPanel's own comment
  // describes (in-game HUD refresh + this homepage stats refresh) rather
  // than a save call/listener at each individual currency mutation site.
  _renderCurrencyBar() {
    if (this.currencyCoinsAmount) this.currencyCoinsAmount.textContent = _safeStatNumber(this.coins)
    // Points (the blue star) are what Upgrades cost - a share of every
    // run's kills and waves (2026-10-12; they were called Legacy Points, and
    // the star used to show only the last run's score).
    if (this.currencyPointsAmount) this.currencyPointsAmount.textContent = Math.round(_safeStatNumber(this.metaProgress?.legacyPoints))
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
      this._fillNameplate(this.playerShowcaseTitle)
      this._fitPlayerShowcaseTitle()
    }
  }

  // The player's nameplate - level box, name, clan tag - shown the same way
  // above the homepage character and Inventory's preview (2026-10-11,
  // Gaymi: "copy the inventory name, level and clan to the spinning one").
  // Each theme styles it (.nameplate in style.css).
  _fillNameplate(el) {
    const part = (cls) => el.querySelector(`.${cls}`)
    const level = part('nameplate-level')
    const name = part('nameplate-name')
    const clan = part('nameplate-clan')
    if (level) level.textContent = String(this._computeAvatarLevel())
    if (name) name.textContent = this.settings.nickname?.trim() || this._defaultNickname()
    if (clan) {
      const clanName = (this.settings.clanName || '').trim()
      clan.textContent = clanName
      clan.style.display = clanName ? '' : 'none'
      el.classList.toggle('has-clan', !!clanName)
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
    // The pencil on the right has an invisible twin on the left (style.css,
    // #player-showcase-header::before) so the name sits in the middle.
    const available = header.clientWidth - 2 * (pencil.offsetWidth + headerGap)
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
    // ENDGAME_ACHIEVEMENT; this homepage shortcut uses the same lower bar as
    // Play Again/Share above it (any completed run at all), since a
    // shareable stat card is reasonable to want well before the true
    // ending.
    if (this.updateAvailableRefreshBtn) this.updateAvailableRefreshBtn.addEventListener('click', () => window.location.reload())
    // The red X (was a Later button) - see _hideUpdateBanner.
    if (this.updateAvailableLaterBtn) this.updateAvailableLaterBtn.addEventListener('click', () => this._hideUpdateBanner())
    if (this.buildModeBtn) this.buildModeBtn.addEventListener('click', () => this._enterBuildMode())
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
    document.getElementById('build-mode-gallery-btn')?.addEventListener('click', () => this.buildMode.share.postToGallery())
    MenuEasterEggs.bindAll(this)
    window.addEventListener('online', () => CloudSaveUI.updateOnlineStatus(this))
    window.addEventListener('offline', () => CloudSaveUI.updateOnlineStatus(this))
    if (this.shortcutCheatsheetCloseBtn) {
      this.shortcutCheatsheetCloseBtn.addEventListener('click', () => { this.shortcutCheatsheet.style.display = 'none' })
    }

    if (this.profileNotesInput) {
      this.profileNotesInput.addEventListener('input', () => {
        this.settings.privateNotes = this.profileNotesInput.value.slice(0, 5000)
        saveSettings(this.settings)
      })
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
    this._fitMenuLayout()
  }

  // The homepage's measured layout - right column zoom, Play centering,
  // footer links - lives in index.html's inline window.__menuLayout, which
  // runs while the page is still being read (and on resize) so the first
  // paint is already the final layout. Called again here whenever text
  // the layout depends on changes.
  _fitMenuLayout() {
    window.__menuLayout?.fit()
  }

  // Remembers what the homepage shows - currencies, profile card, and every
  // label in the player's language - so index.html can paint it on the next
  // visit before the game has loaded (see __menuLayout there). Per root,
  // the text and inline display of each leaf element in document order,
  // plus their count: index.html only applies a root whose count still
  // matches, so a changed page never gets text in the wrong places.
  // Device-only key, never synced.
  _saveMenuPaintCache() {
    const roots = {}
    for (const rootId of MENU_PAINT_CACHE_ROOTS) {
      const root = document.getElementById(rootId)
      if (!root) continue
      const leaves = [...root.querySelectorAll('*')].filter((el) => !el.children.length && !el.closest('svg') && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE')
      const d = {}
      leaves.forEach((el, i) => { if (el.hasAttribute('style')) d[i] = el.style.display })
      roots[rootId] = { n: leaves.length, t: leaves.map((el) => el.textContent), d }
    }
    try {
      localStorage.setItem(MENU_PAINT_CACHE_KEY, JSON.stringify({ v: 2, roots }))
    } catch { /* storage full or blocked - next visit just waits for the game */ }
  }

  // Local leaderboard - see loadLeaderboard's own doc comment for how this
  // differs from bestStats above. Called once per run end (death or
  // dawn-survival) from _onPlayerDeath/the survive-to-dawn path.
  _recordLeaderboardEntry() {
    this.leaderboard.push({ night: this.night, kills: this.kills, points: this.points, date: Date.now() })
    this.leaderboard.sort((a, b) => (b.night - a.night) || (b.kills - a.kills) || (b.points - a.points))
    this.leaderboard = this.leaderboard.slice(0, LEADERBOARD_MAX_ENTRIES)
    saveLeaderboard(this.leaderboard)
  }

  _renderCrateTiers() { return InventoryUI._renderCrateTiers(this) }


  _openCrate(tier) { return InventoryUI._openCrate(this, tier) }


  _openCratePurchaseModal(tier) { return InventoryUI._openCratePurchaseModal(this, tier) }

  _closeCratePurchaseModal() { return InventoryUI._closeCratePurchaseModal(this) }

  _updateCratePurchaseModal() { return InventoryUI._updateCratePurchaseModal(this) }

  _confirmCratePurchase() { return InventoryUI._confirmCratePurchase(this) }

  _renderInventoryWeapons(...args) { return InventoryUI._renderInventoryWeapons(this, ...args) }

  _weaponThumbnails() { return InventoryUI._weaponThumbnails(this) }

  _weaponThumbnailsReady() { return InventoryUI._weaponThumbnailsReady(this) }

  _loadSavedWeaponThumbs() { return InventoryUI._loadSavedWeaponThumbs(this) }

  _saveWeaponThumbs(out) { return InventoryUI._saveWeaponThumbs(this, out) }

  _weaponDisplayClone(vm) { return InventoryUI._weaponDisplayClone(this, vm) }

  _onResize() {
    // Build Mode reuses this same renderer/canvas but owns its own camera
    // (see BuildMode.js), created once at startup with whatever
    // window.innerWidth/innerHeight was at page load and never touched
    // again - toggling browser fullscreen (or any window resize) while
    // inside Build Mode visibly stretched the view since the renderer's
    // output size changed but this camera's aspect didn't follow it.
    //
    // On the homepage the 3D canvas draws nothing, so it isn't resized
    // there at all - only marked, and _tick catches up the moment the map
    // opens (2026-10-12, "the homepage still lags crazy on mobile"): iPhone
    // and iPad Safari fire a resize on every frame its toolbar slides while
    // scrolling, and re-allocating this full-screen drawing buffer each
    // time made every scroll frame a long stall.
    this._fitPlayerShowcaseTitle()
    if (!this.buildMode?.active && this._sizedOnce) {
      this._sizeDirty = true
      return
    }
    this._sizedOnce = true
    this._sizeDirty = false
    if (this.buildMode?.camera) {
      this.buildMode.camera.aspect = window.innerWidth / window.innerHeight
      this.buildMode.camera.updateProjectionMatrix()
    }
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    // (The homepage layout re-fits itself on resize - __menuLayout.)
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

  // Levels panel - opened by the level coin on the profile card. Coming
  // Soon (2026-10-11, Gaymi: "delete everything and change it to coming
  // soon") - it used to repeat Profile's Rank Roadmap.
  _openLevelsPanel() {
    this._closeAllMenuPanels()
    this.levelsPanel.style.display = 'flex'
    const text = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key) }
    text('levels-panel-title', 'levelsPanelTitle')
    text('levels-coming-title', 'comingSoonTitle')
    text('levels-coming-text', 'levelsComingSoon')
  }

  _closeLevelsPanel() {
    this.levelsPanel.style.display = 'none'
  }

  // Gallery - its own panel since 2026-10-09 (was a toast), Coming Soon
  // until there's something to show in it.
  // The Gallery (2026-10-13) - GalleryUI.js.
  _openGalleryPanel(kind) {
    GalleryUI.openGallery(this, kind)
  }

  // Remembers the gun picked at the start of a Map 1 run (BuildSurvival's
  // weapon picker), so the next run highlights it.
  _setPlayWeapon(id) {
    this.settings.playWeapon = id
    saveSettings(this.settings)
  }

  _closeGalleryPanel() {
    this.galleryPanel.style.display = 'none'
  }

  // Terms of Use / Privacy Policy - used to be a plain link out to
  // /terms.html and /privacy.html (target="_blank"); moved in-panel
  // (same static-prose pattern as Credits above) at Gaymi's request. The
  // standalone terms.html/privacy.html pages themselves are left as-is
  // (still real, linkable URLs - just no longer linked to from here).
  // The signed-out Profile card: 'choose' (Sign Up or Login), 'signup' or
  // 'login'. Fills the words every time so a language change shows.
  _showAuthView(view) {
    const set = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key) }
    set('auth-choose-sub', 'authChooseSub')
    set('auth-choose-new', 'authChooseNew')
    set('profile-gate-register-btn', 'profileRegisterBtn')
    set('profile-gate-login-btn', 'profileLoginBtn')
    set('auth-signup-sub', 'authSignupSub')
    set('auth-signup-google-label', 'authSignupGoogle')
    set('auth-signup-note', 'authSignupNote')
    set('auth-login-sub', 'authLoginSub')
    set('auth-login-google-label', 'authContinueGoogle')
    set('auth-login-note', 'authPickup')
    set('auth-back-label', 'authBack')
    const termsHtml = _escapeHtml(t('authTerms'))
      .replace('{terms}', `<button type="button" class="auth-link open-terms-panel-link">${_escapeHtml(t('termsBtn'))}</button>`)
      .replace('{privacy}', `<button type="button" class="auth-link open-privacy-panel-link">${_escapeHtml(t('creditsPrivacyLink'))}</button>`)
    for (const id of ['auth-terms-signup', 'auth-terms-login']) {
      const el = document.getElementById(id)
      if (el) el.innerHTML = termsHtml
    }
    // The panel's own title says the welcome line while signed out; it's
    // set back to Profile when the profile itself shows.
    if (this.profilePanelTitle) this.profilePanelTitle.textContent = t(view === 'login' ? 'authWelcomeBack' : 'authWelcome')
    for (const v of ['choose', 'signup', 'login']) {
      const el = document.getElementById(`auth-view-${v}`)
      if (el) el.hidden = v !== view
    }
    const back = document.getElementById('auth-back-btn')
    if (back) back.hidden = view === 'choose'
  }

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
    this._loadSkinDesignerFrame()
  }

  _loadSkinDesignerFrame() {
    if (this.skindesignerFrame && this.skindesignerFrame.src === 'about:blank') {
      const theme = this.settings.uiTheme === 'old' ? 'old' : 'golden'
      this.skindesignerFrame.src = `${SKIN_DESIGNER_URL}?theme=${theme}`
    }
  }

  // Loads Design a Skin in its hidden panel ahead of time (2026-10-16), on
  // the homepage only - while a game is starting or running it waits and
  // tries again later, so it never competes with the map. Hidden, the
  // designer draws nothing (its canvas has no size).
  _preloadSkinDesigner() {
    if (this.buildMode?.active || this._enteringBuildMode || document.hidden) {
      setTimeout(() => this._preloadSkinDesigner(), SKIN_DESIGNER_PRELOAD_MS)
      return
    }
    this._loadSkinDesignerFrame()
  }

  _closeSkinDesignerPanel() {
    this.skindesignerPanel.style.display = 'none'
  }

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
    const supported = LANGUAGES.filter((l) => SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
    const coming = LANGUAGES.filter((l) => !SUPPORTED_LANGUAGE_CODES.has(l.code)).map((l) => l.name)
    return {
      goals: MAX_GOALS,
      defenseWaves: DEFENSE_WAVES,
      extractionWaves: EXTRACTION_WAVES,
      extractionHold: EXTRACTION_HOLD,
      bossEvery: BOSS_HUNT_EVERY,
      upgrades: PLAY_META_UPGRADES.length,
      prestigeBonus: PRESTIGE_BONUS_PERCENT,
      prestigeStep: PRESTIGE_COST_STEP.toLocaleString('en-US'),
      prestigeStep2: (PRESTIGE_COST_STEP * 2).toLocaleString('en-US'),
      biomes: Object.keys(BIOMES).length,
      skeletonWave: SKELETON_FROM_WAVE,
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
          // Only the list scrolls - the search bar above it stays put.
          const box = this.featuresLayout || this.featuresContent
          box.scrollTop += section.getBoundingClientRect().top - box.getBoundingClientRect().top
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
          { root: this.featuresLayout || this.featuresContent, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
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

  _openShopPanel() { return InventoryUI._openShopPanel(this) }

  _renderShopSkinState() { return InventoryUI._renderShopSkinState(this) }

  _buyShopSkin() { return InventoryUI._buyShopSkin(this) }

  _closeShopPanel() { return InventoryUI._closeShopPanel(this) }

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
      night: this.night, kills: this.kills, coins: Math.max(0, this.coins - this._runStartCoins), survived: !!survived,
      prestige: this.metaProgress.prestigeLevel, ts: Date.now(),
      difficulty: this.settings.difficulty, loadout: this.settings.loadout,
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
    this.careerStats.lifetimeCoinsEarned += Math.max(0, this.coins - this._runStartCoins)
    // Most Profitable Run (Profile panel) - a single-run coin delta, same
    // Math.max(0, ...) clamp lifetimeCoinsEarned above already uses (a
    // run that ended with fewer coins than it started, e.g. after a big
    // Coin Shop purchase mid-run, shouldn't count as negative profit).
    this.careerStats.mostProfitableRun = Math.max(this.careerStats.mostProfitableRun, Math.max(0, this.coins - this._runStartCoins))

    for (const m of PLAYTIME_MILESTONES) {
      if (this.careerStats.lifetimePlaytimeSeconds >= m.seconds && !this.careerStats.playtimeMilestonesGranted.includes(m.id)) {
        this.careerStats.playtimeMilestonesGranted.push(m.id)
        this.coins += m.rewardCoins
        this._showLoreToast(t('playtimeMilestoneToast', { hours: Math.round(m.seconds / 3600), coins: m.rewardCoins }))
      }
    }
    saveCareerStats(this.careerStats)

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
      if (skin.width !== 64 || (skin.height !== 64 && skin.height !== 32) || ![1, 2, 4, 8, 16].includes(skin.scale)) {
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
    const k = skin.scale || 1
    fctx.drawImage(skin.texture.image, 8 * k, 8 * k, 8 * k, 8 * k, 0, 0, 64, 64)
    // Hat layer on top of the face - loadSkinTexture no longer flattens the
    // overlay onto the base, so the badge composites it itself (only when
    // the 3D character actually shows a hat, see overlayParts).
    if (skin.overlayParts && skin.overlayParts.has('head')) fctx.drawImage(skin.texture.image, 40 * k, 8 * k, 8 * k, 8 * k, 0, 0, 64, 64)
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
    // Signed-out players get the Sign Up or Login card instead of the
    // profile - everything below this branch (stats, bio, highlights, the
    // 3D avatar, etc.) is real profile content that a guest doesn't see.
    if (!this._cloudUid) {
      if (this.profileContent) this.profileContent.style.display = 'none'
      if (this.profileLoginGate) this.profileLoginGate.style.display = 'flex'
      this._showAuthView('choose')
      return
    }
    if (this.profileContent) this.profileContent.style.display = ''
    if (this.profileLoginGate) this.profileLoginGate.style.display = 'none'
    this._renderPublicProfileSection()
    this._drawStatsDashboard()

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
      // Same tier color as the homepage's #menu-prestige-badge (see
      // _updatePrestigeBadge) - prestige only ever showed its color in that
      // one homepage spot before; this carries the same visual identity
      // into the Profile panel instead of a plain number.
      ['profilePrestige', t('profilePrestige'), this.metaProgress.prestigeLevel > 0
        ? `<span class="prestige-tier-${this.metaProgress.prestigeLevel >= 6 ? 3 : this.metaProgress.prestigeLevel >= 3 ? 2 : 1}">${_safeStatNumber(this.metaProgress.prestigeLevel)}</span>`
        : _safeStatNumber(this.metaProgress.prestigeLevel)],
      ['profileNetWorth', t('profileNetWorth'), _safeStatNumber(this.coins) + _safeStatNumber(this.metaProgress.legacyPoints)],
      ['profileTotalSpent', t('profileTotalSpent'), _safeStatNumber(this.totalSpent)],
      ['profilePlaytime', t('profilePlaytime'), `${Math.floor(_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 3600)}h`],
      ['profileWinRate', t('profileWinRate'), this.runHistory.length > 0 ? `${Math.round((this.runHistory.filter((r) => r.survived).length / this.runHistory.length) * 100)}%` : '—'],
      // 100-features batch - 4 more pure-derived rows, same "zero new
      // tracking" reasoning as completionPct/Career Almanac above.
      ['profileKillsPerMin', t('profileKillsPerMin'), _safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) > 0
        ? (_safeStatNumber(this.careerStats.totalKills) / (_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / 60)).toFixed(1)
        : '—'],
      ['profileCoinsRatio', t('profileCoinsRatio'), `${_safeStatNumber(this.careerStats.lifetimeCoinsEarned).toLocaleString()} / ${_safeStatNumber(this.totalSpent).toLocaleString()}`],
      // More-features batch - 5 more pure-derived rows (Personal Stats),
      // same "zero new tracking beyond what _recordRunEnd/_recordNemesis
      // already aggregate" reasoning as every row above.
      ['profileLongestSession', t('profileLongestSession'), _formatDurationShort(_safeStatNumber(this.careerStats.longestSessionSeconds))],
      ['profileAvgRunLength', t('profileAvgRunLength'), _safeStatNumber(this.careerStats.totalRuns) > 0
        ? _formatDurationShort(Math.round(_safeStatNumber(this.careerStats.lifetimePlaytimeSeconds) / this.careerStats.totalRuns))
        : '—'],
      ['profileMostUsedMutator', t('profileMostUsedMutator'), _escapeHtml(this._mostUsedMutatorLabel())],
      ['profileCoinsToday', t('profileCoinsToday'), `${_safeStatNumber(this._coinsToday()).toLocaleString()} (${t('profileCoinsWeeklyAvg', { n: _safeStatNumber(this._coinsWeeklyAvg()).toLocaleString() })})`],
      // Reuses loginStreak.previousDate (see _checkLoginStreak) - the
      // calendar date of the visit before this one, not today's own date
      // (which lastDate always reflects by the time this panel can open).
      ['profileLastPlayed', t('profileLastPlayed'), this.loginStreak.previousDate || t('profileLastPlayedFirstVisit')],
      ['profileBestStreakDate', t('profileBestStreakDate'), this.bestStats.bestKillStreakDate || '—'],
      ['profileMostProfitableRun', t('profileMostProfitableRun'), _safeStatNumber(this.careerStats.mostProfitableRun).toLocaleString()],
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
      this.profileCareerPortraitBtn.style.display = this.achievements.unlocked.has(ENDGAME_ACHIEVEMENT) ? 'block' : 'none'
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
    if (!this.rankRoadmapList) return
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
    if (this.profileNotesInput) {
      const heading = document.getElementById('profile-notes-heading')
      if (heading) heading.textContent = t('profileNotesHeading')
      this.profileNotesInput.placeholder = t('profileNotesPlaceholder')
      this.profileNotesInput.value = this.settings.privateNotes || ''
    }
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
    })
    this.profileBestRunCard.style.display = ''
  }

  _renderCompanionColorPreview() {
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

  // Career Portrait (Long-Term Goals batch, gated behind ENDGAME_ACHIEVEMENT - see
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
      // Design a Skin's Post to Gallery (2026-10-13).
      if (data && data.type === 'gayz-gallery-skin' && typeof data.dataUrl === 'string' && data.dataUrl.length <= 1500000) {
        this._closeSkinDesignerPanel()
        GalleryUI.startSkinPost(this, data.dataUrl, typeof data.name === 'string' ? data.name : '')
        return
      }
      if (!data || data.type !== 'gayz-import-skin' || typeof data.dataUrl !== 'string') return
      // HD skins (up to 1024 wide, 16x) are bigger files than 64-wide ones.
      if (!data.dataUrl.startsWith('data:image/png;base64,') || data.dataUrl.length > 1500000) return
      this._closeSkinDesignerPanel()
      this._applyImportedSkin(data.dataUrl)
    })
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
      newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).slice(0, 3)
    } else {
      const lastViewed = Number(localStorage.getItem(CHANGELOG_LAST_VIEWED_KEY))
      if (!lastViewed) return
      newEntries = Array.from(document.querySelectorAll('#changelog-list .changelog-entry:not(.changelog-future)')).filter((el) => {
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

  // Shared profile link's "Favorite weapon": the gun you carry in Map 1
  // (first hotbar slot - Try Map and Play hold it).
  _favoriteWeaponLabel() {
    const id = this.settings.hotbar?.[0]
    const w = this.weapons.getSummary().find((w) => w.id === id)
    return w ? t(w.nameKey) : t('profileFavoriteWeaponNone')
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

  _bindClanSection() { return ClanUI._bindClanSection(this) }

  _updateClanMyClanTabLabel() { return ClanUI._updateClanMyClanTabLabel(this) }

  _refreshClanUi() { return ClanUI._refreshClanUi(this) }

  _renderClanIncomingInvites() { return ClanUI._renderClanIncomingInvites(this) }

  _fetchClanRanking() { return ClanUI._fetchClanRanking(this) }

  _renderClanRanking() { return ClanUI._renderClanRanking(this) }

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
    const canLower = scale > 0.25 && this._editorPixelRatio(down) < this._editorPixelRatio(scale) - 1e-3
    if (msPerFrame > targetMs * 1.11 && canLower) {
      this._editorResScale = down
      this._editorResGood = 0
      this._editorResUpAfter = now + 20000
      // Draw straight away - a resize clears the canvas, and waiting for
      // the next frame would show one black frame.
      if (this._applyRenderScale()) this.buildMode.render()
    } else if (msPerFrame > targetMs * 1.11) {
      // Already at the lowest resolution: draw less of the map instead
      // (View Distance on Auto - see BuildMode.stepAutoView).
      this._editorResGood = 0
      if (this.buildMode.stepAutoView(-1)) {
        this._editorResHoldUntil = now + 2000
        this._editorResUpAfter = now + 20000
      }
    } else if (msPerFrame < targetMs * 1.05) {
      this._editorResGood = (this._editorResGood || 0) + 1
      if (this._editorResGood >= 6 && now > (this._editorResUpAfter || 0)) {
        this._editorResGood = 0
        // Give back what went last first: the view distance, then pixels.
        if (this.buildMode.stepAutoView(1)) {
          this._editorResUpAfter = now + 20000
        } else if (scale < 1) {
          this._editorResScale = Math.min(1, scale + 0.125)
          if (this._applyRenderScale()) this.buildMode.render()
        }
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
      if (this._sizeDirty) this._onResize()
      const jsStart = performance.now()
      // The clock has to tick here too (2026-10-12, "gameplay feels very
      // fast on iPad and phones"): without this update getDelta() kept
      // returning the last homepage frame's step, so a laggy homepage
      // (0.1s frames) made every game frame move 0.1s - several times
      // real speed at 60 fps - and a smooth one happened to look right.
      this.timer.update()
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

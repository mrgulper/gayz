import * as THREE from 'three'
import { LOW_QUALITY_MODE } from './QualitySettings.js'
import { WeaponCatalog } from './WeaponCatalog.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { Quests } from './Quests.js'
import { RollingQuests } from './RollingQuests.js'
import { DailyChallenge } from './DailyChallenge.js'

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
import { META_UPGRADES, loadMetaProgress } from './MetaProgress.js'
import { UPGRADE_PLAY, PLAY_GAME_MODES } from './PlayRules.js'
import * as GalleryUI from './GalleryUI.js'
import { TopBar } from './TopBar.js'
import { setLanguage, t } from './i18n.js'
import { CLEAN_DEFAULT_COLOR, normalizeHex, uiThemeOf } from './CleanTheme.js'
import { MenuAvatar3D, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
// BuildMode.js is deliberately NOT statically imported here - it's a big,
// self-contained system most visitors never touch (a whole separate
// scene/camera/90+ block types), so it's dynamically imported on first use
// instead (see _enterBuildMode) to keep it out of the initial page load.
import * as CloudSync from './CloudSync.js'
import * as CloudSaveUI from './CloudSaveUI.js'
import * as ChatUI from './ChatUI.js'
import * as HomeUI from './HomeUI.js'
import * as HomeExtras from './HomeExtras.js'
import * as PlayEntryUI from './PlayEntryUI.js'
import * as InfoPagesUI from './InfoPagesUI.js'
import * as ProgressUI from './ProgressUI.js'
import * as ProfileUI from './ProfileUI.js'
import * as TeamUI from './TeamUI.js'
import * as CosmeticsUI from './CosmeticsUI.js'
import * as InventoryUI from './InventoryUI.js'
import * as ClanUI from './ClanUI.js'
import { levelFromXp, starterXp } from './Xp.js'
import * as OnlineUI from './OnlineUI.js'
import * as FriendsUI from './FriendsUI.js'
import * as SettingsUI from './SettingsUI.js'
import { GRAPHICS_LEVELS, detectGraphicsLevel } from './GraphicsLevels.js'
import * as ServerBrowser from './ServerBrowser.js'
import { MARKET_PRICES } from './MarketSkins.js'
import { INVENTORY_SKINS, SKIN_RARITIES, skinFrontIconURL } from './InventorySkins.js'
export { INVENTORY_SKINS, SKIN_RARITIES, skinFrontIconURL }
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


// Random Nickname button (SettingsUI's randomNicknameBtn) - a small
// adjective+noun word bank combined with a 2-digit suffix, plenty of
// distinct combinations without needing a name-generation service.
export const RANDOM_NICKNAME_ADJECTIVES = ['Rusty', 'Silent', 'Grim', 'Feral', 'Lucky', 'Rogue', 'Shady', 'Blunt', 'Sneaky', 'Iron']
export const RANDOM_NICKNAME_NOUNS = ['Wolf', 'Scav', 'Reaper', 'Nomad', 'Ghost', 'Viper', 'Ranger', 'Drifter', 'Hound', 'Raven']


// Cache Storage name for the saved weapon pictures (see _loadSavedWeaponThumbs).
export const WEAPON_THUMBS_CACHE = 'gayz-weapon-thumbs-v2'

// Main-menu news ticker thresholds (see _updateMenuNewsTicker) - both read
// against bestStats.bestWave.
export const NEWS_TICKER_MID_NIGHT = 5
export const NEWS_TICKER_LATE_NIGHT = 15
// The Upgrades panel lists only the upgrades that do something in a Map 1
// run (PlayRules.js's UPGRADE_PLAY); the rest wait for a block-city version.
export const PLAY_META_UPGRADES = META_UPGRADES.filter((u) => UPGRADE_PLAY[u.id])

export const DIFFICULTY_PRESETS = {
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
      // This month's clan XP ({ month, clanId, xp }, Xp.js). Missing from
      // this list until 2026-10-26, so every reload dropped it and the next
      // leaderboard upload (a full replace) wiped it online too - clans sat
      // at 0 XP.
      clanXp: (parsed.clanXp && typeof parsed.clanXp === 'object' && typeof parsed.clanXp.clanId === 'string' && typeof parsed.clanXp.month === 'string')
        ? { month: parsed.clanXp.month, clanId: parsed.clanXp.clanId, xp: Math.max(0, Math.floor(Number(parsed.clanXp.xp) || 0)) }
        : null,
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
      disasterBreakAll: parsed.disasterBreakAll ?? false,
      // Settings added 2026-10-30 (GameplaySettings.js).
      crosshairStyle: ['cross', 'dot', 'circle'].includes(parsed.crosshairStyle) ? parsed.crosshairStyle : 'cross',
      damageNumbers: parsed.damageNumbers ?? true,
      zombieNameTags: parsed.zombieNameTags ?? true,
      autoPickup: parsed.autoPickup ?? true,
      confirmRareDrop: parsed.confirmRareDrop ?? true,
      darkAreaBoost: parsed.darkAreaBoost ?? false,
      colorblindRarity: parsed.colorblindRarity ?? false,
      sprintMode: parsed.sprintMode === 'toggle' ? 'toggle' : 'hold',
      // Added 2026-10-31: jump up 1-block steps by walking into them, and
      // how team battles are drawn (TeamBattle.js).
      autoJump: parsed.autoJump ?? false,
      battleView: parsed.battleView === '2d' ? '2d' : '3d',
      zombieVolume: Number.isFinite(parsed.zombieVolume) ? Math.max(0, Math.min(100, parsed.zombieVolume)) : 100,
      skinDesignerHighContrast: parsed.skinDesignerHighContrast ?? false,
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
      // Locked skins/guns in the Inventory ('character:<id>' / 'weapon:<id>',
      // InventoryUI.js): no Market or Sell while locked.
      lockedSkins: Array.isArray(parsed.lockedSkins) ? parsed.lockedSkins.filter((x) => typeof x === 'string' && x.length <= 80).slice(0, 1000) : [],
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
      // 3-slot hotbar - slot 0 is whatever gun
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
      // Hats & Capes worn (Cosmetics.js) - ids, '' for none.
      cosmeticHat: typeof parsed.cosmeticHat === 'string' ? parsed.cosmeticHat : '',
      cosmeticCape: typeof parsed.cosmeticCape === 'string' ? parsed.cosmeticCape : '',
      // Graphics tab (see _bindGraphicsSettings). renderResolution is a
      // percentage fed into _basePixelRatio's pixel-ratio math, not a
      // separate render target size - docs/PERFORMANCE.md already ruled
      // resolution out as a fix for the real (CPU-bound) stutter, so this
      // is a genuine visual/GPU-cost lever, not a performance fix.
      // Potato players still on its old 60% move to its new 40%.
      renderResolution: parsed.graphicsLevel === 'potato' && parsed.renderResolution === 60 ? 40 : parsed.renderResolution ?? 100,
      brightness: parsed.brightness ?? 100,
      contrast: parsed.contrast ?? 100,
      // Default false to match this build's existing out-of-box behavior
      // (LOW_QUALITY_MODE already keeps shadows off) - an explicit opt-in
      // still works, see _resolveShadowsEnabled's own comment on why.
      shadowsEnabled: parsed.shadowsEnabled ?? false,
      shadowQuality: parsed.shadowQuality || 'medium',
      viewDistance: ['auto', 'short', 'medium', 'far', 'max'].includes(parsed.viewDistance) ? parsed.viewDistance : 'auto',
      liteTextures: parsed.liteTextures ?? false,
      // Settings > Graphics level; null until the game picks one for the
      // device (Game constructor, detectGraphicsLevel).
      graphicsLevel: GRAPHICS_LEVELS.includes(parsed.graphicsLevel) ? parsed.graphicsLevel : null,
      // true: the level was picked by the game (it may step it down when
      // a game runs too slow, PlayEntryUI._autoLowerGraphics); false: by
      // the player. null: from before 2026-10-31 (auto if it's the one
      // the device would get).
      graphicsLevelAuto: typeof parsed.graphicsLevelAuto === 'boolean' ? parsed.graphicsLevelAuto : null,
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
      homeExtrasLayout: parsed.homeExtrasLayout === 'panel' ? 'panel' : 'cards',
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
      // Old by default; Clean when picked. Golden was deleted 2026-10-23 -
      // a saved 'golden' becomes Clean (CleanTheme.js uiThemeOf).
      uiTheme: uiThemeOf(parsed),
      // Clean theme's one colour (General > Theme), '#rrggbb'.
      cleanColor: normalizeHex(parsed.cleanColor) || CLEAN_DEFAULT_COLOR,
      // In a game, the screens wear the biome (on) or keep the theme (off).
      playBiomeLook: parsed.playBiomeLook ?? true,
      // The gun last picked at the start of a Map 1 run (PlayWeapons.js).
      playWeapon: typeof parsed.playWeapon === 'string' ? parsed.playWeapon : null,
      lastSeenBuildId: parsed.lastSeenBuildId || null,
      mutators: {
        hordeRush: parsed.mutators?.hordeRush ?? false,
        lootRush: parsed.mutators?.lootRush ?? false,
        bossRush: parsed.mutators?.bossRush ?? false,
        // Off by default - deliberately a toggle, not a replacement for
        // healing in the camp (BuildSurvival, REGEN_* in PlayRules.js).
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
    // gotten into this state from an old hotbar overwrite bug (fixed
    // 2026-08-20: assigning a weapon to an occupied slot used to just drop
    // the previous occupant instead of swapping it elsewhere). The array-shape check just above
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

// Homepage nav order (Settings > Controls > Homepage). Every button in
// #menu-nav-buttons can be moved; an empty list means "the order the
// buttons are written in index.html". A saved list only holds ids, and
// any button it doesn't mention yet (one added to the game later) is
// slotted in right after the button it follows in index.html - see
// SettingsUI._navOrderIds and the matching inline script in index.html.
// The two fixed 8-button lists below were the defaults before every
// button became movable - a save still holding one never reordered
// anything, so it follows index.html instead. (They hold the Store
// button's old id, coinshop-btn - see NAV_ID_RENAMES.)
const NAV_ORDER_OLD_DEFAULTS = [
  ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'friends-btn', 'quests-btn', 'menu-inventory-btn', 'achievements-btn'],
  ['hub-btn', 'coinshop-btn', 'upgrades-btn', 'server-btn', 'menu-inventory-btn', 'quests-btn', 'friends-btn', 'achievements-btn'],
]

// Homepage buttons whose id changed: a saved order keeps working.
export const NAV_ID_RENAMES = { 'coinshop-btn': 'store-btn' }

function _loadNavOrder(saved) {
  if (!Array.isArray(saved)) return []
  if (NAV_ORDER_OLD_DEFAULTS.some((d) => d.join() === saved.join())) return []
  return saved.filter((id) => typeof id === 'string').map((id) => NAV_ID_RENAMES[id] || id).slice(0, 40)
}

export function defaultSettings() {
  return { language: 'en', playerId: _generatePlayerId(), masterVolume: 100, sfxVolume: 100, ambientVolume: 100, muteOnTabBlur: false, positionalAudio: true, difficulty: 'normal', sensitivity: 100, invertY: false, fov: 75, colorblindMode: 'off', autoQuality: true, fpsCap: 0, invertScrollWeaponSwitch: false, friendPresenceNotify: true, timeFormat: '12h', autoSaveFrequencySec: 30, hudFpsCounter: true, achievementToasts: true, rankUpToasts: true, leaderboardRankAlerts: true, weeklyChallengeReminder: true, lowCurrencyReminder: true, backupReminder: true, lastExportAt: 0, confirmSignOut: false, stayEmbedSignedIn: true, anonymousLeaderboard: false, shareTelemetry: true, autoDeclineFriendRequests: false, exactLastSeen: false, rememberSettingsTab: false, lastSettingsTab: 'general', confirmRemoveFriend: false, reduceBgEffects: false, disasterBreakAll: false, crosshairStyle: 'cross', damageNumbers: true, zombieNameTags: true, autoPickup: true, confirmRareDrop: true, darkAreaBoost: false, colorblindRarity: false, sprintMode: 'hold', autoJump: false, battleView: '3d', zombieVolume: 100, skinDesignerHighContrast: false, oneHandedLayout: false, homepageGreeting: '', whatsNewEveryLaunch: false, reduceFlashing: false, clanId: null, clanTag: null, clanName: null, clanXp: null, toastDuration: 100, crosshairColor: '#ffffff', crosshairSize: 100, nickname: '', nicknameColor: '#ffffff', customSkinDataUrl: null, lockedSkins: [], bio: '', privateNotes: '', streamSafeMode: false, defaultTag: null, guestMode: false, loadout: 'balanced', selectedGameMode: 'classic', performanceMode: false, hotbar: ['rifle', 'pistol', 'melee'], mutedBeforeVolumes: null, quickLanguageAlt: 'es', savedFriends: [], mutedChatPlayers: [], playerNotes: {}, statusMode: 'online', region: 'global', largeTextMode: false, highContrastMode: false, dyslexiaFont: false, bgMood: 'auto', cosmeticHat: '', cosmeticCape: '', renderResolution: 100, brightness: 100, contrast: 100, shadowsEnabled: false, shadowQuality: 'medium', viewDistance: 'auto', liteTextures: false, graphicsLevel: null, graphicsLevelAuto: null, grainIntensity: 100, panelFlickerEnabled: true, focusRingMode: false, homepageFpsCounter: false, selectedGoals: [], underlineLinks: false, friendBeatNotified: [], accentColor: null, playBtnColor: null, nicknameFont: 'default', layoutDensity: 'cozy', homeExtrasLayout: 'cards', pinnedStat: null, navOrder: [], uiFont: 'default', textSpacing: 100, buttonSize: 100, reduceTransparency: false, cursorTrail: false, crtScanlines: false, weatherParticles: true, hoverAudioCue: false, highVisCursor: false, captionBackground: false, themePreset: 'none', uiTheme: 'old', cleanColor: CLEAN_DEFAULT_COLOR, playBiomeLook: true, playWeapon: null, lastSeenBuildId: null, mutators: { hordeRush: false, lootRush: false, bossRush: false, healthRegen: false, ironMode: false, glassHouse: false, zombieDefense: false, bossHunt: false, zombieRush: false, escalation: false } }
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
export function _daysUntilWeekReset() {
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
export const WEEKLY_FEATURED_MUTATOR_BONUS_COINS = 50
// Kill streak (kills without getting hurt) that earns Meat Grinder.
export const MEAT_GRINDER_STREAK = 25
// Goals for the 2026-10-09 achievements (Achievements.js), all per run
// except ARSENAL_WEAPONS (different guns with a kill, ever - stored in
// localStorage[ARSENAL_KEY]).
export const HEADHUNTER_HEADSHOTS = 25
export const UP_CLOSE_KNIFE_KILLS = 25
const ARSENAL_WEAPONS = 5
const ARSENAL_KEY = 'gayz-ach-weapon-kills'
export const SURVIVOR_20_WAVES = 20
export const MARATHON_SECONDS = 20 * 60
export const TREASURE_HUNTER_CHESTS = 10
export const FULLY_LOADED_UPGRADES = 5
export const DEEP_POCKETS_COINS = 1000
// Goals for the 2026-10-12 achievements (per run unless it says career).
export const SURVIVOR_30_WAVES = 30
export const MASSACRE_KILLS = 250
export const UNTOUCHABLE_STREAK = 50
export const SHARPSHOOTER_HEADSHOTS = 75
export const BOSS_HUNTER_BOSSES = 5
export const HARDENED_WAVES = 10
export const APEX_PREDATOR_WAVES = 5
export const MUTATOR_CHALLENGE_WAVES = 10
export const EXTERMINATOR_CAREER_KILLS = 1000
export const REGULAR_CAREER_RUNS = 25
export const FORTUNE_HUNTER_COINS = 3000
// Skeleton achievements (2026-10-16).
export const RATTLED_SKELETONS = 25
export const BONE_COLLECTOR_SKELETONS = 100
// The achievement that counts as beating the game: it unlocks Nightmare
// difficulty, Prestige and the Career Portrait.
export const ENDGAME_ACHIEVEMENT = 'survivor_10'
export const GLOBAL_KILLS_MILESTONE_STEP = 100000
// Renamed from WEEKLY_FEATURED_MUTATOR_LABEL_KEYS (Online Features batch)
// and extended to cover every mutator with a real i18n label - the
// homepage's mutator lines (HomeUI.js) need the full set, not just the
// 8 WEEKLY_FEATURED_MUTATORS covers.
// dailyChallenge deliberately excluded - it's its own distinct system
// already promoted separately (the daily-reset spotlight mode), not a
// "try this mutator" flavor pick.
export const MUTATOR_LABEL_KEYS = {
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
  'masterVolume', 'sfxVolume', 'ambientVolume', 'sensitivity', 'invertY', 'fov',
  'colorblindMode', 'reduceFlashing', 
  'toastDuration', 'crosshairSize', 'largeTextMode',
  'highContrastMode', 'dyslexiaFont', 'focusRingMode', 
  'performanceMode', 'bgMood', 'renderResolution', 'brightness', 'contrast', 
  'shadowsEnabled', 'shadowQuality', 'viewDistance', 'liteTextures', 'graphicsLevel',
  'grainIntensity', 'crosshairStyle', 'damageNumbers', 'zombieNameTags', 'autoPickup', 'confirmRareDrop',
  'darkAreaBoost', 'colorblindRarity', 'sprintMode', 'zombieVolume', 'skinDesignerHighContrast',
  'panelFlickerEnabled', 'autoJump', 'battleView',
]

export function _weeklyFeaturedMutatorKey() {
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
      // Called bestNight until 2026-10-17 (rounds were nights on the old
      // Map 1) - an older save (or cloud copy) has that name instead.
      bestWave: Math.max(Number(parsed.bestWave) || 0, Number(parsed.bestNight) || 0), bestKills: parsed.bestKills || 0, bestKillStreak: parsed.bestKillStreak || 0,
      // Third features batch - the calendar date the current bestKillStreak
      // record was actually set (see _recordRunEnd), not just the number.
      bestKillStreakDate: parsed.bestKillStreakDate || null,
    }
  } catch {
    return { bestWave: 0, bestKills: 0, bestKillStreak: 0, bestKillStreakDate: null }
  }
}

export function saveBestStats(stats) {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - best stats just won't persist across sessions.
  }
}

// Best-Run Pace - real elapsed time, recorded only when a new
// bestStats.bestWave record actually lands (see _recordRunEnd), shown with
// the run history (ProgressUI.js).
const BEST_RUN_PACE_KEY = 'gayz-best-run-pace'

function loadBestRunPace() {
  try {
    const raw = localStorage.getItem(BEST_RUN_PACE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveBestRunPace(pace) {
  try {
    localStorage.setItem(BEST_RUN_PACE_KEY, JSON.stringify(pace))
  } catch {
    // Storage unavailable - pace comparison just won't have a baseline yet.
  }
}






// Career Rank - a cumulative, NEVER-reset lifetime total (unlike bestStats'
// single-run bests, and unlike MetaProgress's prestigeLevel which is a
// deliberate reset-everything choice) - purely a "how much have you played,
// ever" number, feeding both a display title and the Veteran Perks below.
const CAREER_STATS_KEY = 'gayz-career-stats'
export const CAREER_RANK_TITLES = [
  { min: 0, titleKey: 'careerRankRookie' },
  { min: 1000, titleKey: 'careerRankSurvivor' },
  { min: 5000, titleKey: 'careerRankVeteran' },
  { min: 15000, titleKey: 'careerRankElite' },
  { min: 50000, titleKey: 'careerRankLegend' },
]
// Career rank-ups, announced once each from lifetime kills (a toast in
// _recordRunEnd) - no bonus of their own any more.
export const VETERAN_PERKS = [
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
      // grows, same never-reset shape as lifetimeCoinsEarned above. Added
      // once per run with the run's points (ProgressUI's _onPlayEvent).
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
      // Skeleton kills, in total and per kind (flat numbers so Cloud Save
      // adds them up across devices like totalKills).
      skeletonKills: parsed.skeletonKills || 0,
      skeletonKillsMinion: parsed.skeletonKillsMinion || 0,
      skeletonKillsRogue: parsed.skeletonKillsRogue || 0,
      skeletonKillsWarrior: parsed.skeletonKillsWarrior || 0,
      skeletonKillsMage: parsed.skeletonKillsMage || 0,
      // Assists on servers (BuildSurvival._countAssist), a flat number too.
      totalAssists: parsed.totalAssists || 0,
      // Lifetime XP (Xp.js) - sets your level. A save from before XP gets
      // starter XP from its lifetime kills and games.
      xp: typeof parsed.xp === 'number' ? parsed.xp : starterXp(parsed.totalKills, parsed.totalRuns),
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
      skeletonKills: 0, skeletonKillsMinion: 0, skeletonKillsRogue: 0, skeletonKillsWarrior: 0, skeletonKillsMage: 0,
      totalAssists: 0,
      xp: 0,
    }
  }
}

export function saveCareerStats(stats) {
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
export const PLAYTIME_MILESTONES = [
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
export const RUN_HISTORY_MAX = 25

function loadRunHistory() {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveRunHistory(list) {
  try {
    localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable - run history just won't persist across sessions.
  }
}


export function careerRankTitleKey(totalKills) {
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
export const LOGIN_STREAK_COIN_PER_DAY = 15
export const LOGIN_STREAK_MAX_BONUS_DAYS = 10
export const LOGIN_STREAK_MAX_FREEZES = 3

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

export function saveLoginStreak(state) {
  try {
    localStorage.setItem(LOGIN_STREAK_KEY, JSON.stringify(state))
  } catch {
    // Storage unavailable - streak just won't persist across sessions.
  }
}

export function todayDateString() {
  return new Date().toISOString().slice(0, 10)
}

export function yesterdayDateString() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Local leaderboard - a ranked history of runs, distinct from bestStats
// above (a single best-ever record with no history). Every run that ends
// (death or dawn-survival) adds one entry; kept sorted best-first and
// capped at LEADERBOARD_MAX_ENTRIES so this can't grow unbounded.
export const LEADERBOARD_KEY = 'gayz-leaderboard'
export const LEADERBOARD_MAX_ENTRIES = 10

function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLeaderboard(entries) {
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
    // Skip identical writes - this runs after nearly every points/coins
    // change, and a localStorage write is synchronous on
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

// Achievement toast queue - slightly longer than the toast's own 3.2s CSS
// animation (see #achievement-toast.show) so one fully fades before the
// next begins, instead of visually cutting it off mid-animation.
export const ACHIEVEMENT_TOAST_GAP_MS = 3400
export const MAX_GOALS = 3
export const LOGIN_CALENDAR_DAYS = 7
export const MARKET_FEE_RATE = 0.05
// Languages that are fully translated; the rest show "Coming soon".
export const SUPPORTED_LANGUAGE_CODES = new Set(['en', 'zh', 'hi', 'es'])
// How long the game waits for a lost graphics connection to come back
// before showing the full Reload message.
const GL_LOST_PANEL_MS = 12000
// Lite Textures: how often newly loaded models get shrunk too.
const LITE_TEXTURE_SWEEP_MS = 4000

// The "Auto (Seasonal)" background mood's date windows (_applyBgMood).
// Their homepage banner ("Something wicked stirs...") was removed
// 2026-10-23 - it sat on top of the words under the logo.
export const EVENT_BANNERS = [
  { month: 9, startDay: 20, endDay: 31, key: 'eventBannerHalloween', bgMood: 'amber' },
  { month: 11, startDay: 15, endDay: 31, key: 'eventBannerWinter', bgMood: 'foggy' },
]
export const WHATS_NEW_VERSION = '2026-07-29-homepage'
export const WHATS_NEW_SEEN_KEY = 'gayz-whatsnew-seen'
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
export const UPGRADES_SEEN_IDS_KEY = 'gayz-upgrades-seen-ids'
export const ACHIEVEMENTS_SEEN_IDS_KEY = 'gayz-achievements-seen-ids'
export const QUESTS_SEEN_IDS_KEY = 'gayz-quests-seen-ids'

export function _loadSeenIds(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function _saveSeenIds(key, idsIterable) {
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
export const HOWTOPLAY_STEPS = [
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
  'settings-section-gfx-level-text': 'settingsSectionGfxLevel',
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
  'home-extras-layout-label': 'homeExtrasLayoutLabel',
  'today-panel-title': 'homeExtrasToday',
  'bg-mood-label': 'bgMoodLabel',
  'weather-particles-label': 'weatherParticlesLabel',
  'disaster-break-all-label': 'disasterBreakAllLabel',
  'crosshair-style-label': 'crosshairStyleLabel',
  'damage-numbers-label': 'damageNumbersLabel',
  'zombie-name-tags-label': 'zombieNameTagsLabel',
  'auto-pickup-label': 'autoPickupLabel',
  'confirm-rare-drop-label': 'confirmRareDropLabel',
  'dark-area-boost-label': 'darkAreaBoostLabel',
  'colorblind-rarity-label': 'colorblindRarityLabel',
  'sprint-mode-label': 'sprintModeLabel',
  'auto-jump-label': 'autoJumpLabel',
  'battle-view-label': 'battleViewLabel',
  'zombie-volume-label': 'zombieVolumeLabel',
  'skin-designer-contrast-label': 'skinDesignerContrastLabel',
  'settings-section-gameplay': 'settingsSectionGameplay',
  'homepage-fps-label': 'homepageFpsLabel',
  'export-keybinds-btn': 'exportKeybindsBtn',
  'import-keybinds-btn': 'importKeybindsBtn',
  'import-keybinds-apply-btn': 'importKeybindsApplyBtn',
  'reset-audio-defaults-btn': 'resetAudioDefaultsBtn',
  'reset-controls-defaults-btn': 'resetControlsDefaultsBtn',
  'restore-defaults-btn': 'restoreDefaultsBtnLabel',
  'storage-quota-warning': 'storageQuotaWarning',
  'export-settings-code-btn': 'exportSettingsCodeBtn',
  'import-settings-code-btn': 'importSettingsCodeBtn',
  'import-settings-code-apply-btn': 'importSettingsCodeApplyBtn',
  'theme-picker-clean-label': 'optUiThemeClean',
  'theme-clean-color-label': 'themeCleanColorLabel',
  'theme-picker-old-label': 'optUiThemeOld',
  'play-biome-look-label': 'playBiomeLookLabel',
  'coming-soon-close-btn': 'comingSoonCloseBtn',
  // Friendship's tabs (Clan moved there from General, 2026-10-24).
  'friends-tab-friends': 'friendsTabList',
  'friends-tab-clan': 'generalTabClan',
  // General's Leaderboard tab, Settings' Theme tab (Theme moved there
  // from General, 2026-10-26), and Inventory's Pets tab (Coming Soon).
  'general-tab-general': 'cloudsaveLeaderboardTitle',
  'tab-theme': 'tabTheme',
  'inventory-tab-pets': 'inventoryPetsTitle',
  'inventory-tab-cosmetics': 'inventoryCosmeticsTitle',
  'inventory-pets-soon-title': 'inventoryPetsTitle',
  'inventory-pets-soon-text': 'inventoryPetsSoon',
  'inventory-pets-soon-tag': 'crateComingSoonTag',
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
  // World Map is its own game mode tab next to Zombie Survival (2026-10-24).
  'hub-tab-worldmap': 'topBarModeWorldMap',
  'hub-section-worldmap': 'topBarModeWorldMap',
  'hub-worldmap-hint': 'hubWorldMapHint',
  'achievements-tab-worldmap': 'topBarModeWorldMap',
  'upgrades-tab-worldmap': 'topBarModeWorldMap',
  'upgrades-worldmap-title': 'comingSoonTitle',
  'upgrades-worldmap-text': 'upgradesModeComingSoon',
  'quest-mode-survival': 'achievementsTabSurvival',
  'quest-mode-worldmap': 'topBarModeWorldMap',
  'worldmap-quests-placeholder': 'monthlyQuestsPlaceholder',
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
  'shop-skin-tryon-btn': 'skinInspect',
  'shop-tryon-label': 'shopTryOnLabel',
  'shop-tryon-back-btn': 'shopTryOnBack',
  'shop-skin-new-ribbon': 'shopNewRibbon',
  'shop-skin-rarity': 'skinRarityLegendary',
  'shop-soon-heading': 'comingSoonTitle',
  'shop-soon-daily-name': 'shopSoonDailyDeals',
  'shop-soon-daily-text': 'shopSoonDailyDealsText',
  'shop-soon-daily-tag': 'crateComingSoonTag',
  'shop-soon-skins-name': 'shopSoonNewSkins',
  'shop-soon-skins-text': 'shopSoonNewSkinsText',
  'shop-soon-skins-tag': 'crateComingSoonTag',
  'shop-soon-spin-name': 'shopSoonCrateSpin',
  'shop-soon-spin-text': 'shopSoonCrateSpinText',
  'shop-soon-spin-tag': 'crateComingSoonTag',
  'upload-skin-btn': 'uploadSkinBtn',
  'reset-skin-btn': 'resetSkinBtn',
  'profile-tab-public': 'profilePublicHeading',
  'profile-public-hint': 'profilePublicHint',
  'profile-public-id-label': 'profilePublicIdLabel',
  // Reusing #other-profile-panel's existing labels (already translated
  // into zh/hi/es) - same "Best Night"/"Best Kills"/"Achievements" text,
  // no reason to duplicate the key.
  'profile-public-bestwave-label': 'otherProfileBestwaveLabel',
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
  'cloudsave-use-cloud-btn': 'cloudsaveUseCloudBtnLabel',
  'cloudsave-use-local-btn': 'cloudsaveUseLocalBtnLabel',
  'status-pick-label-online': 'friendStatusOnline',
  'status-pick-label-idle': 'friendStatusIdle',
  'status-pick-label-dnd': 'friendStatusDnd',
  'status-pick-label-offline': 'friendStatusOffline',
  'other-profile-loading': 'otherProfileLoading',
  'other-profile-none': 'otherProfileNone',
  'other-profile-bestwave-label': 'otherProfileBestwaveLabel',
  'other-profile-bestkills-label': 'otherProfileBestkillsLabel',
  'other-profile-beststreak-label': 'profilePublicBeststreakLabel',
  'other-profile-achievements-label': 'otherProfileAchievementsLabel',
  'other-profile-region-label': 'profilePublicRegionLabel',
  'credits-body-text': 'creditsBodyText',
  'credits-contact-text': 'creditsContactText',
  'credits-privacy-link': 'creditsPrivacyLink',
  'credits-terms-link': 'creditsTermsLink',
  'friends-own-id-label': 'friendsOwnIdLabel',
  'touch-more-actions-hint': 'touchMoreActionsHint',
  'achievements-category-label': 'achievementsCategoryLabel',
  'achievements-sort-label': 'achievementsSortLabel',
  'clan-invite-id-label': 'clanInviteIdLabel',
  'clan-create-name-label': 'clanCreateNameLabel',
  'clan-request-name-label': 'clanRequestNameLabel',
  'settings-section-hud': 'settingsSectionHud',
  'settings-section-hud-2': 'settingsSectionHud',
  'settings-section-notifications': 'settingsSectionNotifications',
  'settings-section-account-data': 'settingsSectionAccountData',
  'settings-section-social': 'settingsSectionSocial',
  'settings-section-homepage': 'settingsSectionHomepage',
  'settings-section-key-bindings': 'settingsSectionKeyBindings',
  'settings-section-settings-log': 'settingsSectionSettingsLog',
  'settings-log-clear': 'settingsLogClear',
  'settings-section-accessibility': 'settingsSectionAccessibility',
  'settings-section-accessibility-2': 'settingsSectionAccessibility',
  'settings-section-misc': 'settingsSectionMisc',
  'settings-section-performance': 'settingsSectionPerformance',
  'settings-section-rendering': 'settingsSectionRendering',
  'settings-section-movement-aim': 'settingsSectionMovementAim',
  'settings-section-personalization': 'settingsSectionPersonalization',
  'settings-section-theme': 'settingsSectionTheme',
  'settings-section-save-backup': 'settingsSectionSaveBackup',
  'settings-section-danger-zone': 'settingsSectionDangerZone',
  'settings-section-danger-zone-general': 'settingsSectionDangerZone',
  'reset-general-defaults-btn': 'resetGeneralDefaultsBtn',
  'community-maps-title': 'communityBuildsTitle',
  'chat-tab-global': 'chatTabGlobal',
  'chat-tab-clan': 'chatTabClan',
  'hub-section-difficulty': 'hubSectionDifficulty',
  'hub-section-game-modes': 'hubSectionGameModes',
  'hub-section-challenges-mutators': 'hubSectionChallengesMutators',
}

const PLACEHOLDER_I18N_KEYS = {
  'settings-log-search': 'settingsLogSearch',
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
  'crosshair-style-select': { 'cross': 'optCrosshairCross', 'dot': 'optCrosshairDot', 'circle': 'optCrosshairCircle' },
  'sprint-mode-select': { 'hold': 'optSprintHold', 'toggle': 'optSprintToggle' },
  'battle-view-select': { '3d': 'optBattleView3d', '2d': 'optBattleView2d' },
  'colorblind-mode-select': { 'off': 'optColorblindOff', 'redgreen': 'optColorblindRedGreen', 'blueyellow': 'optColorblindBlueYellow' },
  'ui-font-select': { 'default': 'optUiFontDefault', 'mono': 'optUiFontMono', 'serif': 'optUiFontSerif', 'display': 'optUiFontDisplay' },
  'theme-preset-select': { 'none': 'optThemePresetDefault', 'sepia': 'optThemePresetSepia', 'darker': 'optThemePresetDarker', 'lighter': 'optThemePresetLighter' },
  'nickname-font-select': { 'default': 'optNicknameFontDefault', 'mono': 'optNicknameFontMono', 'serif': 'optNicknameFontSerif', 'display': 'optNicknameFontDisplay' },
  'layout-density-select': { 'cozy': 'optLayoutCozy', 'compact': 'optLayoutCompact' },
  'home-extras-layout-select': { 'cards': 'optHomeExtrasCards', 'panel': 'optHomeExtrasPanel' },
  'bg-mood-select': { 'auto': 'optBgMoodAutoSeasonal', 'timeofday': 'optBgMoodAutoLocal', 'sunny': 'optBgMoodSunny', 'none': 'optBgMoodNight', 'bloodmoon': 'optBgMoodBloodMoon', 'foggy': 'optBgMoodFoggy', 'amber': 'optBgMoodAmber' },
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
export const NEARLY_THERE_CANDIDATES = []

// Achievement chain previews (Achievements panel) - the handful of
// achievements that genuinely form a tiered sequence, hand-picked rather
// than inferred from naming (most achievements are standalone, not a
// series - guessing from id/title text would false-match unrelated ones).
export const ACHIEVEMENT_CHAINS = {
  survivor_5: 'survivor_10',
  nightmare_survivor_5: 'nightmare_conqueror',
}

// Goals checklist (Profile panel, see settings.selectedGoals) - a wider
// candidate pool than NEARLY_THERE_CANDIDATES since these are player-picked
// (not auto-surfaced achievement hints), so they don't need the same
// "genuinely persistent, always-visible" bar - any honestly-derivable
// lifetime metric with a sensible target qualifies. Pick any 3.
export const GOAL_CANDIDATES = [
  { id: 'goal_kills10k', titleKey: 'goalKills10k', current: (g) => g.careerStats.totalKills, total: () => 10000 },
  { id: 'goal_achievements50', titleKey: 'goalAchievements50', current: (g) => g.achievements.unlocked.size, total: () => ACHIEVEMENTS.length },
  { id: 'goal_rankElite', titleKey: 'goalRankElite', current: (g) => g.careerStats.totalKills, total: () => 15000 },
  { id: 'goal_night10', titleKey: 'goalWave10', current: (g) => g.bestStats.bestWave, total: () => 10 },
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
// not a photorealistic render, since nothing else in this UI is). The
// Inventory's weapon cards fall back to it when a weapon has no picture.
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
export const PLAY_FADE_MS = 450
// Points the next Prestige needs, per level: 100k for level 1, 200k for 2...
export const PRESTIGE_COST_STEP = 100000
// Extra Points per run for each Prestige level (%).
export const PRESTIGE_BONUS_PERCENT = 10
// Opening the Map Editor: a quick dip to black. Fading back in on the map
// (Play or editor) is slow when the load took longer than FADE_LAG_LOAD_MS
// or a first frame took longer than FADE_LAG_FRAME_MS, fast otherwise.
export const EDITOR_FADE_OUT_MS = 200
export const FADE_LAG_LOAD_MS = 600
export const FADE_LAG_FRAME_MS = 40
export const FADE_IN_SLOW_MS = 900
export const FADE_IN_FAST_MS = 250

export function _escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Coerces an untrusted value to a plain finite number before it's allowed
// anywhere near an innerHTML template - it reads
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
export function _formatDurationShort(totalSeconds) {
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
export const PROFILE_STAT_GROUPS = {
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
export const PROFILE_GROUP_ORDER = [
  ['combat', 'profileGroupCombat'],
  ['survival', 'profileGroupSurvival'],
  ['economy', 'profileGroupEconomy'],
  ['socialMeta', 'profileGroupSocialMeta'],
]

// Lowest resolution the map editor's auto resolution may drop to, in
// pixels per CSS pixel - only reached on devices too slow at 1.
const EDITOR_MIN_PIXEL_RATIO = 0.6
// Last visit's save-driven homepage values (see _saveMenuPaintCache).
export const MENU_PAINT_CACHE_KEY = 'menu-paint-cache'
// How long the clan list loaded when General opens stays fresh.
export const CLAN_RANKING_CACHE_MS = 60000
// The What's New update card fades away by itself after this long.
export const UPDATE_BANNER_SHOW_MS = 12000
export const UPDATE_BANNER_FADE_MS = 900
export const MENU_PAINT_CACHE_ROOTS = ['menu-currency-bar', 'menu-player-badge', 'player-showcase-header', 'menu-hero', 'menu-nav-buttons', 'menu-links-row']

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
    // The Map Editor / Map 1 show TopBar.js's bar instead.
    this._topBar = new TopBar(this)
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
    // multiplier from the removed automatic per-frame scaler. Placeholder
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
    this.profileAccountSignedIn = document.getElementById('profile-account-signed-in')
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
    this.profilePublicBestwaveValue = document.getElementById('profile-public-bestwave-value')
    this.profilePublicBestkillsValue = document.getElementById('profile-public-bestkills-value')
    this.profilePublicBeststreakValue = document.getElementById('profile-public-beststreak-value')
    this.profilePublicAchievementsValue = document.getElementById('profile-public-achievements-value')
    this.profilePublicRegionRow = document.getElementById('profile-public-region-row')
    this.profilePublicRegionValue = document.getElementById('profile-public-region-value')
    this.profilePublicClanRow = document.getElementById('profile-public-clan-row')
    this.profilePublicClanValue = document.getElementById('profile-public-clan-value')
    this.quickPerformanceBtn = document.getElementById('quick-performance-btn')
    this.quickLanguageBtn = document.getElementById('quick-language-btn')
    // Cloud Save (Google Sign-In + Drive appDataFolder, see CloudSync.js).
    this.quickCloudBtn = document.getElementById('quick-cloud-btn')
    this.cloudSignedInDot = document.getElementById('cloud-signed-in-dot')
    // Cloud Save is a section of General's General tab now, not its own panel.
    this.cloudsavePanel = document.getElementById('cloudsave-section')
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
    this.otherProfileBestWaveValue = document.getElementById('other-profile-bestwave-value')
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
    this.homeExtrasLayoutSelect = document.getElementById('home-extras-layout-select')
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
    this.resetGeneralDefaultsBtn = document.getElementById('reset-general-defaults-btn')
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
    this.themePickerClean = document.getElementById('theme-picker-clean')
    this.themeCleanColorInput = document.getElementById('theme-clean-color')
    this.themeCleanBgBtn = document.getElementById('theme-clean-bg-btn')
    this.themeCleanBgClear = document.getElementById('theme-clean-bg-clear')
    this.themeCleanBgFile = document.getElementById('theme-clean-bg-file')
    this.themePickerOld = document.getElementById('theme-picker-old')
    this.playBiomeLookToggle = document.getElementById('play-biome-look-toggle')
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
    this.clanStatsWave = document.getElementById('clan-stats-wave')
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
    this.restoreDefaultsBtn = document.getElementById('restore-defaults-btn')
    this._resetProgressArmed = false
    // Local Sharing batch.
    this.exportSaveBtn = document.getElementById('export-save-btn')
    this.importSaveBtn = document.getElementById('import-save-btn')
    this.importSaveInput = document.getElementById('import-save-input')
    this.storageUsageLine = document.getElementById('storage-usage-line')
    this.storageQuotaWarning = document.getElementById('storage-quota-warning')
    this.exportSettingsCodeBtn = document.getElementById('export-settings-code-btn')
    this.importSettingsCodeBtn = document.getElementById('import-settings-code-btn')
    this.importSettingsCodeInput = document.getElementById('import-settings-code-input')
    this.importSettingsCodeApplyBtn = document.getElementById('import-settings-code-apply-btn')
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

    this.wave = 1
    this.kills = 0
    // Records screen (see bestStats.bestKillStreak) - killStreak itself
    // resets to 0 on any hit taken, so this separately tracks the highest
    // it ever reached this run, checked against the persisted best at death.
    this.peakKillStreakThisRun = 0
    this.totalKills = 0
    this.totalDeaths = 0
    this.shopProgress = loadShopProgress()
    this.points = this.shopProgress.points
    this.xp = 0
    this.coins = this.shopProgress.coins
    // Cash - a 4th currency alongside Coins/Points/Gems, not yet spendable
    // anywhere (same as Gems currently isn't) and with no earning mechanic
    // wired up yet either - just the tracked value + display for now.
    this.cash = this.shopProgress.cash
    this.gems = this.shopProgress.gems
    this.ownsShopSkin = this.shopProgress.ownsShopSkin
    this.charSkins = this.shopProgress.charSkins
    this.runStartedAt = performance.now()
    // Long-Term Goals batch (see _recordRunEnd) - per-run baselines used to
    // derive this run's contribution to the lifetime totals in careerStats.
    // _runStartCoins is a net-earned approximation (coins can be spent
    // mid-run too), not a true gross-earned ledger - fine for a flavor stat.
    this._runStartCoins = this.coins

    // No preserveDrawingBuffer: it disables a fast path in most browsers and
    // isn't needed - anything that reads the canvas renders and reads it in
    // the same synchronous call, before any buffer swap/clear can happen.
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
      // Block chunks don't keep a copy for three.js to re-send (BlockChunks
      // dropAfterUpload) - they're made again from the blocks instead.
      this.buildMode._chunks?.rebuildAll()
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
    // The graphics level that fits this device (Settings > Graphics marks
    // it); picked for the player once, the first time (2026-10-24).
    this._deviceGraphicsLevel = detectGraphicsLevel(this._gpuRendererString)
    if (!this.settings.graphicsLevel) {
      this._applyGraphicsLevel(this._deviceGraphicsLevel)
      this.settings.graphicsLevelAuto = true
      saveSettings(this.settings)
    }
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
    this.dailyChallenge = new DailyChallenge()
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
    this.inventoryTabPets = document.getElementById('inventory-tab-pets')
    this.inventorySkinsList = document.getElementById('inventory-skins-list')
    this.invSkinSearch = document.getElementById('inv-skin-search')
    this.invRarityFilterBtn = document.getElementById('inv-rarity-filter-btn')
    this.invRarityFilterMenu = document.getElementById('inv-rarity-filter-menu')
    this._invRarity = 'all'
    this.invSkinMenu = document.getElementById('inv-skin-menu')
    this.invSkinMenuEquip = document.getElementById('inv-skin-menu-equip')
    this.invSkinMenuInspect = document.getElementById('inv-skin-menu-inspect')
    this.invSkinMenuSell = document.getElementById('inv-skin-menu-sell')
    this.invSkinMenuLock = document.getElementById('inv-skin-menu-lock')
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
    this.whatsNewPausedBanner = document.getElementById('whatsnew-paused-banner')
    this.storeBtn = document.getElementById('store-btn')
    this.gameStarted = false
    this.weapons = new WeaponCatalog()
    // Unopened crate stock (see loadShopProgress's own comment) - a plain
    // object, not a Set/Map, since it's just an integer count per tier,
    // not a collection of distinct owned ids.
    this.crateStock = { wood: 0, ice: 0, golden: 0, ...this.shopProgress.crateStock }

    this._applyAllVolumes()

    this._bindMenu()
    // Safety net alongside the save on every points/coins change - catches
    // a close/reload happening between the last save and now.
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
    this._bindGameModeSelect()
    this._checkImportSkinCode()
    TeamUI.bindTeamUI(this)
    CosmeticsUI.bindCosmeticsUI(this)
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
    // The gun models arrive after the game is built (WeaponCatalog.ready) -
    // a gun already in your hands by then was a stand-in box, so swap it.
    this.weapons.ready.then(() => {
      const tryMode = this.buildMode?.tryMode
      if (!tryMode?._gun) return
      tryMode._gunId = null
      if (tryMode._gun.visible) tryMode._showGun()
    })

    // Debug/QA hook - lets Playwright (or the browser console) drive real
    // game methods directly, since this project has no test suite.
    window.__game = this
    // Reveals the save-driven homepage values (see index.html's
    // html:not(.game-ready) rule).
    document.documentElement.classList.add('game-ready')
    // Opened from an Invite Friends link: straight into that game.
    setTimeout(() => ServerBrowser.joinFromLink(this), 0)
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
    // And the clan list, so General > Clan shows it at once (2026-10-24,
    // "make it load already when the game loads").
    setTimeout(() => idle(() => { if (navigator.onLine !== false) this._fetchClanRanking().catch(() => {}) }), 3000)
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

  _drawStatsDashboard() { return ProgressUI._drawStatsDashboard(this) }

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

  _updateHomepageClock() { return HomeUI._updateHomepageClock(this) }

  _applyGrainIntensity() { return SettingsUI._applyGrainIntensity(this) }

  _resetGraphicsDefaults() { return SettingsUI._resetGraphicsDefaults(this) }
  _resetSettingsTab(page) { return SettingsUI._resetSettingsTab(this, page) }

  _applyGraphicsFilters() { return SettingsUI._applyGraphicsFilters(this) }

  _resolveShadowsEnabled() { return SettingsUI._resolveShadowsEnabled(this) }

  _applyShadowQuality() { return SettingsUI._applyShadowQuality(this) }
  _applyGraphicsLevel(level) { return SettingsUI._applyGraphicsLevel(this, level) }
  _detectGraphicsLevel(gpu, env) { return detectGraphicsLevel(gpu, env) }

  _renderNavOrderList() { return SettingsUI._renderNavOrderList(this) }

  _moveNavOrder(id, delta) { return SettingsUI._moveNavOrder(this, id, delta) }

  _applyNavOrder() { return SettingsUI._applyNavOrder(this) }

  _bindSettingsSearch() { return SettingsUI._bindSettingsSearch(this) }

  _bindControlsTab() { return SettingsUI._bindControlsTab(this) }

  _restoreDefaultSettings() { return SettingsUI._restoreDefaultSettings(this) }


  _exportSave() { return SettingsUI._exportSave(this) }


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

  _handleCloudSignIn(provider) { return OnlineUI._handleCloudSignIn(this, provider) }

  _afterCloudSignIn(uid, profile) { return OnlineUI._afterCloudSignIn(this, uid, profile) }

  _checkForNewerCloudSave(_uid) { return OnlineUI._checkForNewerCloudSave(this, _uid) }

  _flushLocalSave() { return OnlineUI._flushLocalSave(this) }

  _hasMeaningfulLocalProgress() { return OnlineUI._hasMeaningfulLocalProgress(this) }


  _updateStorageUsageLine() { return OnlineUI._updateStorageUsageLine(this) }


  // In-game bug report (batch feature) - copies a plain-text report to the
  // clipboard (same navigator.clipboard pattern as the other Copy
  // buttons) with real live state auto-attached, so a player doesn't have to
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

  _bindDifficulty() { return PlayEntryUI._bindDifficulty(this) }

  _bindGameModeSelect() { return PlayEntryUI._bindGameModeSelect(this) }

  _checkLoginStreak() { return ProgressUI._checkLoginStreak(this) }

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

  _preloadBuildMode() { return PlayEntryUI._preloadBuildMode(this) }

  _enterBuildMode(...args) { return PlayEntryUI._enterBuildMode(this, ...args) }

  _fadeScreen(to, ms) { return PlayEntryUI._fadeScreen(this, to, ms) }

  _playConfig() { return PlayEntryUI._playConfig(this) }

  _onPlayEvent(type, data) { return ProgressUI._onPlayEvent(this, type, data) }

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

  _checkForUpdate() { return InfoPagesUI._checkForUpdate(this) }

  _gateChangelog() { return InfoPagesUI._gateChangelog(this) }

  _scheduleUpdateBannerFade() { return InfoPagesUI._scheduleUpdateBannerFade(this) }

  _hideUpdateBanner() { return InfoPagesUI._hideUpdateBanner(this) }

  _exitBuildMode() { return PlayEntryUI._exitBuildMode(this) }

  _renderRecentlyChangedList() { return HomeUI._renderRecentlyChangedList(this) }

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
  // most expensive effects (shadows, bloom), rather than touching gameplay-affecting
  // settings. Resolution is no longer part of that trade - confirmed
  // (2026-07-21) that cutting render resolution all the way down didn't
  // recover any fps in a genuinely severe case, meaning pixel count isn't
  // the bottleneck, so capping it below the display's real resolution was
  // pure downside (blur) for zero benefit. Always renders at the display's
  // true native pixel ratio now, in and out of Performance Mode alike.
  _basePixelRatio() {
    // Fixed, modest cut under LOW_QUALITY_MODE (bare-bones/minimum-
    // resource mode) - real GPU fill-rate win (fewer total shaded
    // pixels), unlike the removed dynamic per-frame scaler, which
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
    // manual, user-chosen setting - not the removed automatic per-frame
    // scaler.
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
  // individual _open...Panel functions below - _closeAllMenuPanels() (right
  // after this) already guarantees at most one of these is ever visible
  // at a time, since every _open...Panel calls it first, so "which one just
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
      {
        slug: 'friends', panel: this.friendsPanel, open: () => this._openFriendsPanel(),
        subTabs: this._subTabsFor('friends-tab-', ['friends', 'clan']),
      },
      {
        slug: 'achievements', panel: this.achievementsPanel, open: () => this._openAchievementsPanel(),
        subTabs: this._subTabsFor('achievements-tab-', ['survival', 'worldmap', 'deathmatch', 'parkour']),
      },
      {
        slug: 'inventory', panel: this.menuInventoryPanel, open: () => this._openMenuInventoryPanel(),
        subTabs: this._subTabsFor('inventory-tab-', ['character', 'crates', 'weapons', 'pets', 'cosmetics']),
      },
      { slug: 'global', panel: this.serverPanel, open: () => this._openServerPanel() },
      {
        slug: 'general', panel: this.clanPanel, open: () => this._openClanPanel(),
        subTabs: this._subTabsFor('general-tab-', ['general']),
      },
      {
        slug: 'settings', panel: this.settingsPanel, open: () => this._toggleSettings(true),
        subTabs: this._subTabsFor('tab-', ['general', 'language', 'audio', 'controls', 'graphics', 'theme']),
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
        subTabs: this._subTabsFor('hub-tab-', ['survival', 'worldmap', 'deathmatch', 'parkour', 'custom']),
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
    if (this._shopTryOn) this._endShopTryOn(false)
    if (this.upgradesPanel) this.upgradesPanel.style.display = 'none'
    if (this.howtoplayPanel) this.howtoplayPanel.style.display = 'none'
    HomeExtras.closeTodayPanel()
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

  _openUpgradesPanel() { return ProgressUI._openUpgradesPanel(this) }

  _renderUpgradesOptions() { return ProgressUI._renderUpgradesOptions(this) }

  _prestigeCost() { return ProgressUI._prestigeCost(this) }

  _prestige() { return ProgressUI._prestige(this) }

  _respecMetaUpgrades() { return ProgressUI._respecMetaUpgrades(this) }

  _closeUpgradesPanel() { return ProgressUI._closeUpgradesPanel(this) }

  _openQuestsPanel() { return ProgressUI._openQuestsPanel(this) }

  _renderQuestsPanel() { return ProgressUI._renderQuestsPanel(this) }

  _renderRollingQuestsPanel() { return ProgressUI._renderRollingQuestsPanel(this) }

  _closeQuestsPanel() { return ProgressUI._closeQuestsPanel(this) }

  _claimQuest(id) { return ProgressUI._claimQuest(this, id) }

  _claimRollingQuest(spawnedAt) { return ProgressUI._claimRollingQuest(this, spawnedAt) }

  _claimDailyChallenge() { return ProgressUI._claimDailyChallenge(this) }

  _updateFaviconQuestBadge() { return ProgressUI._updateFaviconQuestBadge(this) }

  _openAchievementsPanel() { return ProgressUI._openAchievementsPanel(this) }

  _renderAchievementsPanel() { return ProgressUI._renderAchievementsPanel(this) }

  _closeAchievementsPanel() { return ProgressUI._closeAchievementsPanel(this) }

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

  _confirmNicknameEdit() { return HomeUI._confirmNicknameEdit(this) }

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
    // Opens on the World Map tab when that's the picked mode.
    if (this.settings.selectedGameMode === 'worldMap') document.getElementById('hub-tab-worldmap')?.click()
  }

  _closeHubPanel() {
    if (this.hubPanel) this.hubPanel.style.display = 'none'
  }

  _closeComingSoonPanel() {
    if (this.comingSoonPanel) this.comingSoonPanel.style.display = 'none'
  }

  _openClanPanel() {
    ClanUI._openClanPanel(this)
    this._renderCloudSaveSection()
  }

  _closeClanPanel() {
    CloudSaveUI.closeCloudSavePanel(this)
    return ClanUI._closeClanPanel(this)
  }

  // General's General tab holds the Cloud Save section - refreshed every
  // time that tab shows, so it never shows a stale signed-in state.
  async _renderCloudSaveSection() {
    if (this.cloudsavePanelTitle) this.cloudsavePanelTitle.textContent = t('cloudsavePanelTitle')
    CloudSaveUI.updateOnlineStatus(this)
    await this._authReadyPromise
    CloudSaveUI.renderCloudSaveState(this)
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
    // Opens on Friend List every time, like the other panels' first tab.
    for (const tabEl of this.friendsPanel.querySelectorAll('.general-tab')) tabEl.classList.toggle('active', tabEl.dataset.generalPage === 'friends')
    for (const page of this.friendsPanel.querySelectorAll('.general-tab-page')) page.style.display = page.id === 'general-page-friends' ? 'block' : 'none'
    this._refreshClanUi()
    // Start loading the clan list now, so the Clan tab doesn't make you
    // wait for it (2026-10-09, "it takes so long to load").
    this._fetchClanRanking().catch(() => {})
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

  _renderSignInFooters() { return CloudSaveUI.renderSignInFooters(this) }

  // Items you can filter by: Character, then every weapon (Kirka's market
  // lists every weapon the same way). Market skins without a `kind` are
  // character skins.
  _marketItemOptions() {
    const weapons = this.weapons.getSummary()
      .map((w) => ({ id: w.id, label: t(w.nameKey) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    // Pets last, after the weapons (2026-10-24) - none to list yet.
    return [{ id: 'character', label: t('marketItemCharacter') }, ...weapons, { id: 'pets', label: t('inventoryPetsTitle') }]
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
  _toggleSkinLock(kind, id) { return InventoryUI._toggleSkinLock(this, kind, id) }

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
    this.storeBtn.querySelector('span').textContent = t('storeBtn')
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
    if (this.friendsSigninBtn) this.friendsSigninBtn.textContent = t('signInToUseFriends')
    if (this.menuInventoryBtn) this.menuInventoryBtn.querySelector('span').textContent = t('menuInventoryBtn')
    if (this.serverBtn) this.serverBtn.querySelector('span').textContent = t('serverBtn')



    document.getElementById('settings-title').textContent = t('settingsTitle')
    document.getElementById('tab-general').textContent = t('tabGeneral')
    document.getElementById('tab-language').textContent = t('tabLanguage')
    document.getElementById('tab-audio').textContent = t('tabAudio')
    document.getElementById('tab-controls').textContent = t('tabControls')
    document.getElementById('tab-graphics').textContent = t('tabGraphics')
    if (this.buildModeBtn) this.buildModeBtn.querySelector('span').textContent = t('mapEditorBtn')
    this._renderControlsGrid()
    // Local Sharing batch - static settings-panel labels.
    this.exportSaveBtn.textContent = t('exportSaveBtn')
    this.importSaveBtn.textContent = t('importSaveBtn')
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

  _renderCurrencyBar() { return HomeUI._renderCurrencyBar(this) }

  _updateBestStatsDisplay() { return ProgressUI._updateBestStatsDisplay(this) }

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
  // nameplate: your XP level (Xp.js), endless, from lifetime XP.
  _computeAvatarLevel() {
    return levelFromXp(this.careerStats.xp).level
  }

  // The 1-5 career rank tier (lifetime kills) - only the logo's blood tint
  // still uses it, now that the level number comes from XP.
  _computeCareerTier() {
    let tier = 1
    for (let i = 0; i < CAREER_RANK_TITLES.length; i++) {
      if (this.careerStats.totalKills >= CAREER_RANK_TITLES[i].min) tier = i + 1
    }
    return tier
  }

  _renderPlayerTag() { return HomeUI._renderPlayerTag(this) }

  _fillNameplate(el) { return HomeUI._fillNameplate(this, el) }

  _fitPlayerShowcaseTitle() { return HomeUI._fitPlayerShowcaseTitle(this) }

  _copyPlayerId() { return HomeUI._copyPlayerId(this) }

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

  _updateRecommendedDifficultyHint() { return PlayEntryUI._updateRecommendedDifficultyHint(this) }


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

  _applyBgMood() { return HomeUI._applyBgMood(this) }

  _updateWhatsNewDot() { return InfoPagesUI._updateWhatsNewDot(this) }

  _updateUpgradesDot() { return ProgressUI._updateUpgradesDot(this) }

  _markUpgradesSeen() { return ProgressUI._markUpgradesSeen(this) }

  _updateAchievementsDot() { return ProgressUI._updateAchievementsDot(this) }

  _markAchievementsSeen() { return ProgressUI._markAchievementsSeen(this) }

  _updateQuestsDot() { return ProgressUI._updateQuestsDot(this) }

  _updateQuestsNewDot() { return ProgressUI._updateQuestsNewDot(this) }

  _markQuestsSeen() { return ProgressUI._markQuestsSeen(this) }

  _openHowToPlayPanel() { return InfoPagesUI._openHowToPlayPanel(this) }

  _closeHowToPlayPanel() { return InfoPagesUI._closeHowToPlayPanel(this) }

  _bindHomepageBatch() { return HomeUI._bindHomepageBatch(this) }
  _bindHomeExtras() { return HomeExtras.bindHomeExtras(this) }
  _renderHomeExtras() { return HomeExtras.renderHomeExtras(this) }


  _updateMenuNewsTicker() { return HomeUI._updateMenuNewsTicker(this) }

  // The homepage's measured layout - right column zoom, Play centering,
  // footer links - lives in index.html's inline window.__menuLayout, which
  // runs while the page is still being read (and on resize) so the first
  // paint is already the final layout. Called again here whenever text
  // the layout depends on changes.
  _fitMenuLayout() {
    window.__menuLayout?.fit()
  }

  _saveMenuPaintCache() { return HomeUI._saveMenuPaintCache(this) }

  _recordLeaderboardEntry() { return ProgressUI._recordLeaderboardEntry(this) }

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

  _showAchievementToast(def) { return ProgressUI._showAchievementToast(this, def) }

  _drainAchievementToastQueue() { return ProgressUI._drainAchievementToastQueue(this) }

  _openCreditsPanel() { return InfoPagesUI._openCreditsPanel(this) }

  _closeCreditsPanel() { return InfoPagesUI._closeCreditsPanel(this) }

  _openLevelsPanel() { return ProfileUI._openLevelsPanel(this) }

  _closeLevelsPanel() { return ProfileUI._closeLevelsPanel(this) }

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

  _renderAuthCard() { return ProfileUI._renderAuthCard(this) }

  _openTermsPanel() { return InfoPagesUI._openTermsPanel(this) }

  _closeTermsPanel() { return InfoPagesUI._closeTermsPanel(this) }

  _openPrivacyPanel() { return InfoPagesUI._openPrivacyPanel(this) }

  _closePrivacyPanel() { return InfoPagesUI._closePrivacyPanel(this) }

  _openFeaturesPanel() { return InfoPagesUI._openFeaturesPanel(this) }

  _closeFeaturesPanel() { return InfoPagesUI._closeFeaturesPanel(this) }

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
      const theme = this.settings.uiTheme === 'clean' ? 'clean' : 'old'
      this.skindesignerFrame.src = `${SKIN_DESIGNER_URL}?theme=${theme}&color=${encodeURIComponent(this.settings.cleanColor)}`
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

  _featureCatalogs() { return InfoPagesUI._featureCatalogs(this) }

  _featureCounts() { return InfoPagesUI._featureCounts(this) }

  _featureValues() { return InfoPagesUI._featureValues(this) }

  _syncFeatureLists() { return InfoPagesUI._syncFeatureLists(this) }

  _refreshFeatureValues() { return InfoPagesUI._refreshFeatureValues(this) }

  _bindFeaturesPanel() { return InfoPagesUI._bindFeaturesPanel(this) }

  // Shop - was just a Crates placeholder (see this file's git history for
  // that and the even older Weapon Attachments UI before it), then a
  // preview-only skin with no purchase logic at all. Now real: 500
  // Gems (10,000 until 2026-10-23), tracked via this.ownsShopSkin (shopProgress, see
  // loadShopProgress/saveShopProgress), buying immediately equips it via
  // the same settings.customSkinDataUrl path skin upload already uses -
  // there's no multi-skin wardrobe here, just this one purchasable skin,
  // so "buy" and "equip" are the same action. Weapon attachment purchasing
  // still has no UI anywhere right now either - see the Settings/Upgrades
  // attachment guide lists for what those items do, and
  // WeaponSystem.applyAttachment / saveShopProgress for the still-live
  // persistence of any already-owned attachments from before that change.
  static SHOP_SKIN_PRICE = 500

  _openShopPanel() { return InventoryUI._openShopPanel(this) }

  _renderShopSkinState() { return InventoryUI._renderShopSkinState(this) }

  _buyShopSkin() { return InventoryUI._buyShopSkin(this) }

  _startShopTryOn() { return InventoryUI._startShopTryOn(this) }

  _endShopTryOn(reopenShop) { return InventoryUI._endShopTryOn(this, reopenShop) }

  _closeShopPanel() { return InventoryUI._closeShopPanel(this) }

  _openWhatsNewPanel() { return InfoPagesUI._openWhatsNewPanel(this) }

  _closeWhatsNewPanel() { return InfoPagesUI._closeWhatsNewPanel(this) }

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

  _recordRunEnd(survived) { return ProgressUI._recordRunEnd(this, survived) }

  _bindSkinUpload() { return ProfileUI._bindSkinUpload(this) }

  _updateMenuAvatarPhoto(skin) { return ProfileUI._updateMenuAvatarPhoto(this, skin) }

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

  _openProfilePanel() { return ProfileUI._openProfilePanel(this) }

  _renderRecentUnlocksStrip() { return HomeUI._renderRecentUnlocksStrip(this) }

  _renderPrestigeHistory() { return ProgressUI._renderPrestigeHistory(this) }

  _renderHighlightReel() { return HomeUI._renderHighlightReel(this) }

  _renderGoalsPicker() { return HomeUI._renderGoalsPicker(this) }

  _renderGoalsChecklist() { return HomeUI._renderGoalsChecklist(this) }

  _renderRankRoadmap() { return HomeUI._renderRankRoadmap(this) }

  _renderPublicProfileSection() { return ProfileUI._renderPublicProfileSection(this) }

  _renderProfileBio() { return ProfileUI._renderProfileBio(this) }

  _renderProfileBioCounter() { return ProfileUI._renderProfileBioCounter(this) }

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

  _renderFavoriteDifficultyLine() { return HomeUI._renderFavoriteDifficultyLine(this) }

  _renderBestRunCard() { return HomeUI._renderBestRunCard(this) }

  _renderNearlyThereNudge() { return HomeUI._renderNearlyThereNudge(this) }

  _renderProfileAccountRow() { return ProfileUI._renderProfileAccountRow(this) }

  _renderAnniversaryLine() { return HomeUI._renderAnniversaryLine(this) }

  _renderProfileCreated() { return ProfileUI._renderProfileCreated(this) }

  _closeProfilePanel() { return ProfileUI._closeProfilePanel(this) }

  _generateCareerPortrait() { return ProfileUI._generateCareerPortrait(this) }

  // Reads a ?importskin=<base64 PNG, no data: prefix> param - the GayZ
  // Character Skin Designer tool's "Send to GayZ" button builds this link
  // so a custom skin can be applied without a manual download+upload round
  // trip. loadSkinTexture() itself is the validation step here (rejects
  // anything that isn't a real decodable image), not a hand-rolled check -
  // same untrusted-URL-input caution as any other link parameter, just
  // async since image decoding is.
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

  _applyImportedSkin(dataUrl) { return ProfileUI._applyImportedSkin(this, dataUrl) }

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

  _maybeShowWhatsNewDigest() { return InfoPagesUI._maybeShowWhatsNewDigest(this) }

  _fadeOutWhatsNewDigest() { return InfoPagesUI._fadeOutWhatsNewDigest(this) }

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

  _renderStatusPicker() { return HomeUI._renderStatusPicker(this) }

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
    const myNight = _safeStatNumber(this.bestStats.bestWave)
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

  _animateStatCountUp() { return HomeUI._animateStatCountUp(this) }

  _renderPinnedStatSelect(rows) { return ProgressUI._renderPinnedStatSelect(this, rows) }

  // Deep-link a Settings tab (?settingstab=controls) - opens Settings and
  // clicks the real tab button (reuses its own click handler) rather than
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

  _checkUnclaimedQuestsReminder() { return ProgressUI._checkUnclaimedQuestsReminder(this) }

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

  _mostUsedMutatorLabel() { return HomeUI._mostUsedMutatorLabel(this) }

  // Coins today / weekly average helpers (see _openProfilePanel) - both
  // pure-derived from runHistory's own ts/coins fields, no new tracking. "Today"
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


  _fireConfetti() { return HomeUI._fireConfetti(this) }

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


  _updateEditorResScale(msPerFrame, now) { return PlayEntryUI._updateEditorResScale(this, msPerFrame, now) }

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
      this._topBar.update(performance.now())
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
        this._topBar.setFps(fps, this.fpsEl.textContent, msPerFrame, this._gpuRendererString)
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

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildWorld } from './World.js'
import { PlayerController } from './PlayerController.js'
import { WeaponSystem } from './WeaponSystem.js'
import { ZombieManager } from './ZombieManager.js'
import { PickupManager } from './Pickups.js'
import { PlayerState } from './PlayerState.js'
import { Inventory } from './Inventory.js'
import { DayNightCycle } from './DayNightCycle.js'
import { ChestManager } from './Chests.js'
import { BarricadeWindows, REPAIR_REWARD_SCRAP } from './BarricadeWindows.js'
import { Minimap } from './Minimap.js'
import { DecalManager } from './Decals.js'
import { Achievements, ACHIEVEMENTS } from './Achievements.js'
import { rollPerks, checkPerkSynergies } from './Perks.js'
import { rollXpUpgrades } from './XpUpgrades.js'
import { XpGemManager } from './XpGems.js'
import { AutoWeaponManager } from './AutoWeapons.js'
import { SKIN_DEFS } from './Skins.js'
import { COIN_SHOP_ITEMS } from './CoinShop.js'
import { pickNightEvent } from './NightEvents.js'
import { Companion } from './Companion.js'
import { PlayerBody } from './PlayerBody.js'
import { Vehicle } from './Vehicle.js'
import { META_UPGRADES, loadMetaProgress, saveMetaProgress, DEATH_SCRAP_CONVERSION } from './MetaProgress.js'
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
  uvlamp: () => t('toastUvlampAcquired'),
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
      mutators: {
        hordeRush: parsed.mutators?.hordeRush ?? false,
        lootRush: parsed.mutators?.lootRush ?? false,
        pureGunplay: parsed.mutators?.pureGunplay ?? false,
        bossRush: parsed.mutators?.bossRush ?? false,
        hordeMode: parsed.mutators?.hordeMode ?? false,
      },
    }
  } catch {
    return { language: 'en', musicVolume: 100, sfxVolume: 100, difficulty: 'normal', sensitivity: 100, fov: 75, colorblind: false, nickname: '', defaultTag: null, companionRole: 'ranged', scoreAttackMode: false, hardcoreMode: false, loadout: 'balanced', performanceMode: false, mutators: { hordeRush: false, lootRush: false, pureGunplay: false, bossRush: false, hordeMode: false } }
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

const NIGHT_DURATION_MS = 90000
const FLASHLIGHT_DRAIN_PER_SEC = 1.5
const GENERATOR_DRAIN_PER_SEC = 100 / 150
const GENERATOR_REFUEL_RADIUS = 2.5
const GENERATOR_PASSIVE_REFUEL_PER_SEC = 6
const GENERATOR_FUELCAN_AMOUNT = 35
const TRADER_INTERACT_RADIUS = 2.5
const AMMO_STATION_RADIUS = 2.2
const AMMO_STATION_HOLD_SECONDS = 10
const LIGHT_LURE_RADIUS = 20
const LIGHT_LURE_INTERVAL_MS = 2000
const LIGHT_LURE_ENRAGE_MS = 2500
const VEHICLE_INTERACT_RADIUS = 3
const VIREO_TERMINAL_RADIUS = 2.5
const PERK_REROLL_COST = 15
const COMBO_WINDOW_MS = 3000
const COMBO_MIN_DISPLAY = 2
const DEATH_CAM_MS = 900
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
const AIRDROP_WINDOW_MS = 75000
const AIRDROP_SPAWN_RADIUS = 30
const AIRDROP_CLAIM_RADIUS = 2
const BOSS_TIER_IDS = new Set(['colossus', 'patient_zero', 'titan'])
const WHEEL_RADIUS = 110
const WHEEL_DEADZONE = 18
const RESCUE_INTERACT_RADIUS = 2.5
const RESCUE_SCRAP_REWARD = 25

const SHOP_ITEMS = [
  { id: 'health', cost: 15, titleKey: 'shopHealthPack', give: (game) => game.inventory.addHealthPack(1) },
  { id: 'armor', cost: 18, titleKey: 'shopArmorPack', give: (game) => game.inventory.addArmorPack(1) },
  { id: 'grenade', cost: 20, titleKey: 'shopGrenade', give: (game) => game.inventory.addGrenade(1) },
  { id: 'fuelcan', cost: 10, titleKey: 'shopFuelCan', give: (game) => game.inventory.addFuelCan(1) },
  { id: 'noisemaker', cost: 8, titleKey: 'shopNoisemaker', give: (game) => game.inventory.addNoisemaker(1) },
  { id: 'barricade', cost: 25, titleKey: 'shopBarricade', give: (game) => game.inventory.addBarricade(1) },
  { id: 'trap', cost: 20, titleKey: 'shopTrap', give: (game) => game.inventory.addTrap(1) },
  {
    id: 'train_companion',
    cost: 30,
    titleKey: 'shopTrainCompanion',
    give: (game) => {
      game.companionTrainingLevel += 1
      game.companion.applyTraining(game.companionTrainingLevel)
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
    this.inventoryPanel = document.getElementById('inventory-panel')
    this.panelHealthCount = document.getElementById('panel-health-count')
    this.panelArmorCount = document.getElementById('panel-armor-count')
    this.panelNoisemakerCount = document.getElementById('panel-noisemaker-count')
    this.panelGrenadeCount = document.getElementById('panel-grenade-count')
    this.panelBarricadeCount = document.getElementById('panel-barricade-count')
    this.panelTrapCount = document.getElementById('panel-trap-count')
    this.panelWeaponsList = document.getElementById('panel-weapons-list')
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
    this.comboCount = 0
    this.comboResetAt = 0
    this.deathStats = document.getElementById('death-stats')
    this.deathLegacyScrap = document.getElementById('death-legacy-scrap')
    this.deathScoreAttack = document.getElementById('death-score-attack')
    this.endingPanel = document.getElementById('ending-panel')
    this.endingText = document.getElementById('ending-text')
    this.endingCredits = document.getElementById('ending-credits')
    this.endingContinueBtn = document.getElementById('ending-continue-btn')
    this.interactPrompt = document.getElementById('interact-prompt')
    this.ammoStationProgressWrap = document.getElementById('ammo-station-progress-wrap')
    this.ammoStationFill = document.getElementById('ammo-station-fill')
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

    this.night = 1
    this.kills = 0
    this.totalKills = 0
    this.totalDeaths = 0
    this.scrap = 0
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
    this.perksOwned = new Set()
    this.perkSynergiesUnlocked = new Set()
    this.tempCompanion = null
    this.tempCompanionExpiresAtNight = 0
    this.coins = 0
    this.coinShopPurchased = new Set()
    this._shakeOffset = new THREE.Vector3()
    this._shakeMagnitude = 0
    this._shakeDuration = 0
    this._shakeTime = 0
    this._hitstopUntil = 0
    this.runStartedAt = performance.now()
    this.nightStartedAt = performance.now()
    this.roundIntermissionUntil = 0
    this._scheduleNightEvent()
    this._rollWeather()
    this._rollFeaturedItem()

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

    const { colliders, solidMeshes, flickerLights, spawnPoints, hemiLight, sunLight, towerChestSpots, minigunSpot, generator, trader, ammoStation, vireoFacility } = buildWorld(this.scene)
    // Kept for _deployBarricade - both PlayerController and ZombieManager
    // hold this exact same array by reference (not a copy), so pushing a
    // new collider here is immediately respected by both without needing
    // to reconstruct anything.
    this.colliders = colliders
    this.solidMeshes = solidMeshes
    this.barricades = []
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
    this.activeBounty = null
    this.nearVireoTerminal = false
    this.vireoGuardian = null
    this.rescueSurvivor = null
    this.nearRescueSurvivor = false
    this.bestiaryEncountered = loadEncountered()
    this.traderPanelOpen = false
    this.nearTrader = false
    this.dayNight = new DayNightCycle(this.scene, hemiLight, sunLight)

    this.player = new PlayerController(this.camera, this.canvas, colliders, solidMeshes)
    this.scene.add(this.player.controls.object)

    this._addFlashlight()

    this.zombies = new ZombieManager(this.scene, this.difficulty.spawnRateMult, colliders, solidMeshes)
    // Fixed chokepoints spread along the avenue, clear of the generator
    // (1.5, 5), trader (-8, 33), and ammo station (8, -33).
    this.barricadeWindows = new BarricadeWindows(this.scene, [
      { x: 10, z: -20, rotY: -Math.PI / 2 },
      { x: -10, z: -2, rotY: Math.PI / 2 },
      { x: 10, z: 12, rotY: -Math.PI / 2 },
      { x: -10, z: 30, rotY: Math.PI / 2 },
    ])
    this.nearBarricadeWindow = null
    this.companion = new Companion(this.scene, 1.6, 7, this.settings.companionRole)
    this.playerBody = new PlayerBody(this.scene)
    this.vehicle = new Vehicle(this.scene, -6, -18, 0)
    this.driving = false
    this.nearVehicle = false
    this._vehicleSeatPos = new THREE.Vector3()
    this.pickups = new PickupManager(this.scene, spawnPoints)
    this.xpGems = new XpGemManager(this.scene)
    this.autoWeapons = new AutoWeaponManager(this.scene)
    this.pickups.spawnUnique('minigun', minigunSpot.x, minigunSpot.z, minigunSpot.y)
    this.pickups.spawnUnique('audiolog1', 0, -30, 0.5)
    this.pickups.spawnUnique('audiolog2', 0, 0, 0.5)
    this.pickups.spawnUnique('audiolog3', 0, 30, 0.5)
    this.pickups.spawnUnique('audiolog4', 5, 18, 0.5)
    this.pickups.spawnUnique('audiolog5', 0, 60, 0.5)
    this.pickups.spawnUnique('uvlamp', vireoFacility.uvLampSpot.x, vireoFacility.uvLampSpot.z, 0.5)
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
    this.killCountsByWeapon = {}
    this.achievementLabel = document.getElementById('achievement-label')
    this.achievementTitle = document.getElementById('achievement-title')
    this.achievementToast = document.getElementById('achievement-toast')
    this.loreToast = document.getElementById('lore-toast')
    this.companionBarkEl = document.getElementById('companion-bark')
    this.lowHealthBarked = false
    this.nextHeartbeatAt = 0
    this.statsScrap = document.getElementById('stats-scrap')
    this.perkPanel = document.getElementById('perk-panel')
    this.perkPanelTitle = document.getElementById('perk-panel-title')
    this.perkScrapLine = document.getElementById('perk-scrap-line')
    this.perkOptions = document.getElementById('perk-options')
    this.perkSkipBtn = document.getElementById('perk-skip-btn')
    this.perkRerollBtn = document.getElementById('perk-reroll-btn')
    this.traderPanel = document.getElementById('trader-panel')
    this.traderPanelTitle = document.getElementById('trader-panel-title')
    this.traderScrapLine = document.getElementById('trader-scrap-line')
    this.bountyLineEl = document.getElementById('bounty-line')
    this.traderOptions = document.getElementById('trader-options')
    this.traderHint = document.getElementById('trader-hint')
    this.upgradesBtn = document.getElementById('upgrades-btn')
    this.upgradesPanel = document.getElementById('upgrades-panel')
    this.upgradesPanelTitle = document.getElementById('upgrades-panel-title')
    this.upgradesScrapLine = document.getElementById('upgrades-scrap-line')
    this.upgradesOptions = document.getElementById('upgrades-options')
    this.upgradesCloseBtn = document.getElementById('upgrades-close-btn')
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
    this.skinsBtn = document.getElementById('skins-btn')
    this.skinsPanel = document.getElementById('skins-panel')
    this.skinsPanelTitle = document.getElementById('skins-panel-title')
    this.skinsScrapLine = document.getElementById('skins-scrap-line')
    this.skinsOptions = document.getElementById('skins-options')
    this.skinsCloseBtn = document.getElementById('skins-close-btn')
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
    this.gameStarted = false
    this.decals = new DecalManager(this.scene)
    this.minimap = new Minimap(this.minimapCanvas)
    this._camDir = new THREE.Vector3()

    const hud = {
      weaponName: document.getElementById('weapon-name'),
      ammo: document.getElementById('ammo'),
    }
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
    this.ownedSkins = new Set()
    this.equippedSkin = null
    if (this.achievements.unlocked.has('centurion')) {
      this.ownedSkins.add('gold')
      this.equippedSkin = 'gold'
      this.weapons.setWeaponSkin('pistol', 'gold')
    }

    audioEngine.setMusicVolume(this.settings.musicVolume / 100)
    audioEngine.setSfxVolume(this.settings.sfxVolume / 100)

    this._bindMenu()
    this._bindItemKeys()
    this._bindSettings()
    this._bindDifficulty()
    this._bindCompanionRole()
    this._bindLoadout()
    this._bindControlsTab()
    this.perkSkipBtn.addEventListener('click', () => this._closePerkPanel())
    this.perkRerollBtn.addEventListener('click', () => {
      if (this.scrap < PERK_REROLL_COST) return
      this.scrap -= PERK_REROLL_COST
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
      if (spawnMult !== this.difficulty.spawnRateMult) this.zombies.setDifficultyMultiplier(spawnMult)
      if (this.settings.mutators.hordeMode) this.zombies.setHordeMode(true)
      if (this.settings.mutators.bossRush) this.zombies.bossRushMode = true
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
      // state (scrap, inventory, kills...) while keeping everything that's
      // meant to be permanent (settings, achievements, legacy scrap,
      // bestiary, best stats), since those all live in localStorage anyway.
      if (this.settings.hardcoreMode) {
        window.location.reload()
        return
      }
      this.playerState.respawn()
      this.lowHealthBarked = false
      this.player.resetPosition()
      this.zombies.roundMode = this._isRoundMode()
      this.zombies.reset()
      if (this._isRoundMode()) this.zombies.startRound(1)
      this.roundIntermissionUntil = 0
      this.barricadeWindows.reset()
      this.chests.reset()
      this.xpGems.reset()
      this.companion.teleportTo(1.6, 7)
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
      this._updateHealthHud()
      this._updateProgressHud()
      this.deathScreen.style.display = 'none'
      this.player.controls.lock()
    })

    this.pauseResumeBtn.addEventListener('click', () => this.player.controls.lock())
    this.pauseSettingsBtn.addEventListener('click', () => this._toggleSettings(true))
    this.pauseQuitBtn.addEventListener('click', () => window.location.reload())

    this.player.controls.addEventListener('lock', () => {
      this.gameStarted = true
      this.pauseOverlay.style.display = 'none'
      this.menu.style.display = 'none'
      this.crosshair.style.display = this.driving ? 'none' : 'block'
      this.hudEl.style.display = this.driving ? 'none' : 'block'
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
      this.traderPanelOpen = false
      this.traderPanel.style.display = 'none'
      this.interactPrompt.style.display = 'none'
      this.infectionIndicator.style.display = 'none'
      if (!this.playerState.alive) return
      if (this.gameStarted) {
        this.pauseOverlayTitle.textContent = t('pauseOverlayTitle')
        this.pauseResumeBtn.textContent = t('pauseResumeBtn')
        this.pauseSettingsBtn.textContent = t('settingsBtn')
        this.pauseQuitBtn.textContent = t('pauseQuitBtn')
        this.pauseOverlay.style.display = 'flex'
      } else {
        this.menu.style.display = 'flex'
      }
      this.crosshair.style.display = 'none'
      this.hudEl.style.display = 'none'
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
      } else if (e.code === getKeyFor('interact')) {
        // Tracked independently of the rest of this branch (which only
        // fires the various one-shot interactions below) so the ammo
        // station's hold-to-charge check in _updateAmmoStation knows the
        // key is physically down, for as long as it's held.
        this.ammoStationKeyHeld = true
        if (this.driving) {
          this._exitVehicle()
        } else if (this.traderPanelOpen) {
          this._closeTraderPanel()
        } else if (this.nearTrader) {
          this._openTraderPanel()
        } else if (this.nearVehicle) {
          this._enterVehicle()
        } else if (this.nearVireoTerminal) {
          this._interactVireoTerminal()
        } else if (this.nearRescueSurvivor) {
          this._rescueSurvivor()
        } else if (this.nearBarricadeWindow) {
          const reward = this.barricadeWindows.repair(this.nearBarricadeWindow)
          if (reward > 0) {
            this.scrap += reward
            this._updateStatsPanel()
          }
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
      if (e.code === getKeyFor('interact')) this.ammoStationKeyHeld = false
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

  _takeScreenshot() {
    this.composer.render()
    const link = document.createElement('a')
    link.download = `gayz-${Date.now()}.png`
    link.href = this.canvas.toDataURL('image/png')
    link.click()
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
    this.achievementsBtn.addEventListener('click', () => this._openAchievementsPanel())
    this.achievementsCloseBtn.addEventListener('click', () => this._closeAchievementsPanel())
    this.bestiaryBtn.addEventListener('click', () => this._openBestiaryPanel())
    this.bestiaryCloseBtn.addEventListener('click', () => this._closeBestiaryPanel())
    this.skinsBtn.addEventListener('click', () => this._openSkinsPanel())
    this.skinsCloseBtn.addEventListener('click', () => this._closeSkinsPanel())
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
      if (e.code !== 'Escape') setBinding(action, e.code)
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
    // scrap-bought training so switching roles mid-run doesn't reset it.
    if (this.companionTrainingLevel > 0) this.companion.applyTraining(this.companionTrainingLevel)
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

  // Applied once per page load (not on respawn - inventory/scrap already
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
  // perks (see Perks.js) purchased with scrap earned from kills.
  _openPerkPanel() {
    this.perkPanelOpen = true
    this.perkPanel.style.display = 'flex'
    this.perkPanelTitle.textContent = t('perkPanelTitle')
    this.perkSkipBtn.textContent = t('perkSkip')
    this._renderPerkOptions(rollPerks(3))
  }

  _renderPerkOptions(perks) {
    this.perkScrapLine.textContent = t('scrapLabel', { n: this.scrap })
    this.perkRerollBtn.textContent = t('perkRerollLabel', { n: PERK_REROLL_COST })
    this.perkRerollBtn.disabled = this.scrap < PERK_REROLL_COST
    this.perkOptions.innerHTML = ''
    for (const perk of perks) {
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = this.scrap < perk.cost
      btn.innerHTML = `
        <span class="perk-name">${t(perk.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: perk.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.scrap < perk.cost) return
        this.scrap -= perk.cost
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
  // 3 free passive buffs (see XpUpgrades.js), distinct from the scrap-cost
  // night perks in Perks.js.
  _openXpLevelupPanel() {
    this.xpLevelupPanelOpen = true
    this.xpLevelupPanel.style.display = 'flex'
    this.xpLevelupPanelTitle.textContent = t('xpLevelupPanelTitle')
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
  }

  // Opened by pressing the interact key near the trader stall (see
  // World.js's buildTraderStall). Buying doesn't close the panel, so
  // multiple items can be bought in one visit - press interact again to leave.
  _openTraderPanel() {
    this.traderPanelOpen = true
    this.traderPanel.style.display = 'flex'
    this.traderPanelTitle.textContent = t('traderPanelTitle')
    this.traderHint.textContent = tHtml('traderHint')
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
    this.scrap += b.reward
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

  _renderTraderOptions() {
    this.traderScrapLine.textContent = t('scrapLabel', { n: this.scrap })
    this.traderOptions.innerHTML = ''

    if (this.featuredItem) {
      const item = this.featuredItem
      const cost = Math.round(item.cost * 0.7)
      const btn = document.createElement('button')
      btn.className = 'perk-option featured'
      btn.disabled = this.scrap < cost
      btn.innerHTML = `
        <span class="perk-name">${t('traderFeaturedLabel')}: ${t(item.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.scrap < cost) return
        this.scrap -= cost
        item.give(this)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }

    for (const item of SHOP_ITEMS) {
      if (item === this.featuredItem) continue
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = this.scrap < item.cost
      btn.innerHTML = `
        <span class="perk-name">${t(item.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: item.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.scrap < item.cost) return
        this.scrap -= item.cost
        item.give(this)
        this._updateStatsPanel()
        this._updateInventoryHud()
        this._renderTraderOptions()
      })
      this.traderOptions.appendChild(btn)
    }
  }

  _closeTraderPanel() {
    this.traderPanelOpen = false
    this.traderPanel.style.display = 'none'
  }

  // Opened from the main menu (not gameplay) - spends persistent Legacy
  // Scrap (see MetaProgress.js) on one-time permanent upgrades.
  _openUpgradesPanel() {
    this.upgradesPanel.style.display = 'flex'
    this.upgradesPanelTitle.textContent = t('upgradesPanelTitle')
    this.upgradesCloseBtn.textContent = t('upgradesClose')
    this._renderUpgradesOptions()
  }

  _renderUpgradesOptions() {
    this.upgradesScrapLine.textContent = t('legacyScrapLabel', { n: this.metaProgress.legacyScrap })
    this.upgradesOptions.innerHTML = ''
    for (const upgrade of META_UPGRADES) {
      const owned = this.metaProgress.purchased.has(upgrade.id)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = owned || this.metaProgress.legacyScrap < upgrade.cost
      btn.innerHTML = `
        <span class="perk-name">${t(upgrade.titleKey)}</span>
        <span class="perk-cost">${owned ? t('upgradesOwned') : t('perkCostLabel', { n: upgrade.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (owned || this.metaProgress.legacyScrap < upgrade.cost) return
        this.metaProgress.legacyScrap -= upgrade.cost
        this.metaProgress.purchased.add(upgrade.id)
        saveMetaProgress(this.metaProgress)
        this._renderUpgradesOptions()
      })
      this.upgradesOptions.appendChild(btn)
    }
  }

  _closeUpgradesPanel() {
    this.upgradesPanel.style.display = 'none'
  }

  // Cosmetic pistol skins bought with in-run scrap (see Skins.js) - visual
  // only, reset on page reload the same as the rest of the scrap economy.
  // 'gold' may already be owned+equipped for free via the Centurion
  // achievement (see the constructor).
  _openSkinsPanel() {
    this.skinsPanel.style.display = 'flex'
    this.skinsPanelTitle.textContent = t('skinsPanelTitle')
    this.skinsCloseBtn.textContent = t('upgradesClose')
    this._renderSkinsOptions()
  }

  _renderSkinsOptions() {
    this.skinsScrapLine.textContent = t('scrapLabel', { n: this.scrap })
    this.skinsOptions.innerHTML = ''

    const defaultBtn = document.createElement('button')
    defaultBtn.className = 'perk-option'
    defaultBtn.disabled = this.equippedSkin === null
    defaultBtn.innerHTML = `
      <span class="perk-name">${t('skinDefault')}</span>
      <span class="perk-cost">${this.equippedSkin === null ? t('skinEquipped') : t('skinEquip')}</span>
    `
    defaultBtn.addEventListener('click', () => {
      this.equippedSkin = null
      this.weapons.setWeaponSkin('pistol', null)
      this._renderSkinsOptions()
    })
    this.skinsOptions.appendChild(defaultBtn)

    for (const skin of SKIN_DEFS) {
      const owned = this.ownedSkins.has(skin.id)
      const equipped = this.equippedSkin === skin.id
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = equipped || (!owned && this.scrap < skin.cost)
      btn.innerHTML = `
        <span class="perk-name">${t(skin.titleKey)}</span>
        <span class="perk-cost">${equipped ? t('skinEquipped') : owned ? t('skinEquip') : t('perkCostLabel', { n: skin.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (equipped) return
        if (!owned) {
          if (this.scrap < skin.cost) return
          this.scrap -= skin.cost
          this.ownedSkins.add(skin.id)
          this._updateStatsPanel()
        }
        this.equippedSkin = skin.id
        this.weapons.setWeaponSkin('pistol', skin.id)
        this._renderSkinsOptions()
      })
      this.skinsOptions.appendChild(btn)
    }
  }

  _closeSkinsPanel() {
    this.skinsPanel.style.display = 'none'
  }

  _openCoinShopPanel() {
    this.coinshopPanel.style.display = 'flex'
    this.coinshopPanelTitle.textContent = t('coinshopPanelTitle')
    this.coinshopCloseBtn.textContent = t('upgradesClose')
    this._renderCoinShopOptions()
  }

  _renderCoinShopOptions() {
    this.coinshopCoinLine.textContent = t('coinsLabel', { n: this.coins })
    this.coinshopOptions.innerHTML = ''
    for (const item of COIN_SHOP_ITEMS) {
      const owned = item.isOwned(this)
      const btn = document.createElement('button')
      btn.className = 'perk-option'
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
      this.coinshopOptions.appendChild(btn)
    }
  }

  _closeCoinShopPanel() {
    this.coinshopPanel.style.display = 'none'
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
    this.skinsBtn.textContent = t('skinsBtn')
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

    document.getElementById('inventory-title').textContent = t('inventoryTitle')
    document.getElementById('panel-health-label').textContent = t('healthPackLabel')
    document.getElementById('panel-armor-label').textContent = t('armorPackLabel')
    document.getElementById('panel-noisemaker-label').textContent = t('noisemakerLabel')
    document.getElementById('panel-grenade-label').textContent = t('grenadeLabel')
    document.getElementById('panel-barricade-label').textContent = t('barricadeLabel')
    document.getElementById('panel-trap-label').textContent = t('trapLabel')
    document.getElementById('weapons-title').textContent = t('weaponsTitle')
    document.getElementById('inventory-hint').innerHTML = tHtml('inventoryHint')

    document.getElementById('stats-day-label').textContent = t('dayLabel')
    document.getElementById('stats-deaths-label').textContent = t('deathsLabel')
    document.getElementById('stats-kills-label').textContent = t('killsLabel')
    document.getElementById('stats-scrap-label').textContent = t('scrapStatLabel')

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

    this.panelWeaponsList.innerHTML = this.weapons
      .getSummary()
      .map((w) => {
        const name = t(w.nameKey)
        return `
        <div class="inv-panel-row">
          <span>${name}</span>
          <span>${w.unlocked ? `${w.ammoInMag} / ${w.ammoReserve}` : t('lockedLabel')}</span>
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

  _onZombieAttack(damage) {
    if (this.player.isDodging) return // brief invincibility window - see PlayerController's dodge
    this.playerState.takeDamage(damage * this.difficulty.damageMult)
    this._updateHealthHud()
    audioEngine.playZombieSnarl()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')
    this._triggerShake(0.12, 220)

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

  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite) {
    this.kills += 1
    this.totalKills += 1
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
    if (Math.random() < 0.25) {
      this.scrap += (2 + Math.floor(Math.random() * 4)) * lootMult
      this._updateStatsPanel()
    }

    // Coins: a separate, guaranteed-every-kill currency (unlike scrap's
    // 25%-chance drop) spent exclusively in the Coin Shop - see CoinShop.js.
    let coinsEarned
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      coinsEarned = 300 + Math.floor(Math.random() * 201)
    } else if (isElite) {
      coinsEarned = 20 + Math.floor(Math.random() * 181)
    } else {
      coinsEarned = 10 + Math.floor(Math.random() * 91)
    }
    this.coins += coinsEarned
    this._showCoinPopup(coinsEarned)
    this._updateStatsPanel()

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
    else if (zombieTypeId === 'patient_zero') this.pickups.spawnLootDrop('uvlamp', x, z)
  }

  _showAchievementToast(def) {
    this.achievementLabel.textContent = t('achievementUnlocked')
    this.achievementTitle.textContent = t(def.titleKey)
    this.achievementToast.classList.remove('show')
    void this.achievementToast.offsetWidth
    this.achievementToast.classList.add('show')

    if (def.id === 'centurion') this.weapons.setGoldenSkin('pistol', true)
  }

  _showLoreToast(text) {
    this.loreToast.textContent = text
    this.loreToast.classList.remove('show')
    void this.loreToast.offsetWidth
    this.loreToast.classList.add('show')
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

    const legacyEarned = Math.floor(this.scrap * DEATH_SCRAP_CONVERSION)
    this.metaProgress.legacyScrap += legacyEarned
    saveMetaProgress(this.metaProgress)
    this.deathLegacyScrap.textContent = t('deathLegacyScrap', { n: legacyEarned })

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

    this.respawnBtn.textContent = this.settings.hardcoreMode ? t('newAttemptBtn') : t('respawnBtn')

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
    } else if (type === 'uvlamp') {
      this.weapons.unlockWeapon('uvlamp')
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

  _updateProgressHud() {
    this.nightValueEl.textContent = t('hudNight', { n: this.night })
    this.timeValueEl.textContent = formatTime(performance.now() - this.runStartedAt)
    this.killsValueEl.textContent = t('hudKills', { n: this.kills })
  }

  _updateStaminaHud() {
    this.staminaFill.style.width = `${(this.player.stamina / this.player.maxStamina) * 100}%`
    this.staminaValue.textContent = Math.round(this.player.stamina)
  }

  _updateStatsPanel() {
    this.statsDay.textContent = this.dayNight ? this.dayNight.getDayNumber() : 1
    this.statsDeaths.textContent = this.totalDeaths
    this.statsKills.textContent = this.totalKills
    this.statsScrap.textContent = this.scrap
    this.statsCoins.textContent = this.coins

    if (this.dayNight) {
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
  // it claims a reward; letting it expire just removes the marker.
  _updateAirdrop() {
    const now = performance.now()
    if (this.airdrop && now >= this.airdrop.expiresAt) {
      this.scene.remove(this.airdrop.mesh)
      this._showLoreToast(t('airdropExpired'))
      this.airdrop = null
    }

    if (!this.airdrop && now >= this.nextAirdropAt) this._spawnAirdrop()

    if (this.airdrop) {
      const pos = this.player.controls.object.position
      const dist = Math.hypot(pos.x - this.airdrop.x, pos.z - this.airdrop.z)
      if (dist <= AIRDROP_CLAIM_RADIUS) this._claimAirdrop()
    }
  }

  _spawnAirdrop() {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random() * AIRDROP_SPAWN_RADIUS
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius

    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2a10, emissive: 0xffe680, emissiveIntensity: 1.6 })
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.2, 6), mat)
    mesh.position.set(x, 1.1, z)
    this.scene.add(mesh)
    const beam = new THREE.PointLight(0xffe680, 1.6, 10, 2)
    beam.position.set(0, 3, 0)
    mesh.add(beam)

    this.airdrop = { x, z, mesh, expiresAt: performance.now() + AIRDROP_WINDOW_MS }
    this.nextAirdropAt = performance.now() + AIRDROP_MIN_DELAY_MS + Math.random() * (AIRDROP_MAX_DELAY_MS - AIRDROP_MIN_DELAY_MS)
    this._showLoreToast(t('airdropIncoming'))
  }

  _claimAirdrop() {
    this.scene.remove(this.airdrop.mesh)
    this.scrap += 40
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

  _updateTrader(playerPos) {
    const dist = Math.hypot(playerPos.x - this.trader.x, playerPos.z - this.trader.z)
    this.nearTrader = dist <= TRADER_INTERACT_RADIUS
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

  // First-ever visit: reading the terminal wakes a guardian that must be
  // killed before it'll actually talk. Already unlocked the true ending?
  // Just re-read it any time, no fight.
  _interactVireoTerminal() {
    if (this.achievements.unlocked.has('true_ending')) {
      this._showLoreToast(t('loreVireoTerminal'))
      return
    }
    if (!this.vireoGuardian) {
      this.vireoGuardian = this.zombies.spawnGuardian(this.vireoTerminal.x, this.vireoTerminal.z - 3, ZOMBIE_TYPES.patient_zero)
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

  // A real top-of-screen bar while any boss (Colossus/Patient Zero/the VIREO
  // guardian) is alive, instead of just the same tiny floating sprite every
  // regular zombie gets.
  _updateBossHealthBar() {
    const boss = this.zombies.zombies.find((z) => z.isBoss && z.state !== 'dead')
    if (!boss) {
      this.bossHealthWrap.style.display = 'none'
      return
    }
    this.bossHealthWrap.style.display = 'block'
    this.bossNameEl.textContent = boss.config.label
    this.bossHealthFill.style.width = `${Math.max(0, boss.health / boss.maxHealth) * 100}%`
  }

  _rescueSurvivor() {
    this.scrap += RESCUE_SCRAP_REWARD
    this.inventory.addHealthPack(1)
    this._updateStatsPanel()
    this._updateInventoryHud()
    this._showLoreToast(t('survivorRescued', { reward: RESCUE_SCRAP_REWARD }))

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
    const minigunUnlocked = this.weapons.getSummary().find((w) => w.id === 'minigun')?.unlocked
    this.minimap.update(
      playerPos,
      facingRad,
      zombiePositions,
      this.chests.chests,
      minigunUnlocked ? null : this.minigunSpot,
      this.trader,
      this.ammoStation,
      this.airdrop
    )
  }

  _tick() {
    this.timer.update()
    let dt = Math.min(this.timer.getDelta(), 0.1)
    const elapsed = this.timer.getElapsed()
    if (performance.now() < this._hitstopUntil) dt = 0

    this.camera.position.sub(this._shakeOffset)

    this.dayNight.update()
    if (this.raining) {
      this.scene.fog.near *= 0.6
      this.scene.fog.far *= 0.6
    }
    this._updateFogPatch()
    this._updateFlicker(elapsed)

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
      this.zombies.update(
        dt,
        playerPos,
        (dmg) => this._onZombieAttack(dmg),
        (x, z) => this.pickups.spawnLootDrop('ammo', x, z), // boss-only guaranteed drop, see ZombieManager
        () => audioEngine.playAmbushShriek(),
        (zombieTypeId, weaponId, x, z, isElite) => this._onZombieKilled(zombieTypeId, weaponId, x, z, isElite),
        this.player.isCrouching
      )
      this.companion.update(dt, playerPos, this.zombies.zombies, (amount) => {
        this.playerState.heal(amount)
        this._updateHealthHud()
      })
      if (this.tempCompanion) this.tempCompanion.update(dt, playerPos, this.zombies.zombies, null)
      if (this.flashlightOn) this._updateLightLure(playerPos)
      this.pickups.update(dt, elapsed, playerPos, {
        onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
      })
      this.xpGems.update(dt, elapsed, playerPos, (value) => this._onXpGemCollected(value))
      this.autoWeapons.update(dt, playerPos, this.zombies.zombies, () => {
        this._triggerShake(0.04, 80)
        this._triggerHitstop(30)
      })

      this.chests.update(dt, elapsed, playerPos)
      this._updateGenerator(dt, playerPos)
      this._updateTrader(playerPos)
      this._updateAmmoStation(dt, playerPos)
      this._updateVehicleProximity(playerPos)
      this._updateVireoTerminal(playerPos)
      this._updateRescueSurvivor(playerPos)
      if (this.rescueSurvivor) this.rescueSurvivor.update(elapsed)
      this._updateBossHealthBar()

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
      } else if (this.nearVireoTerminal) {
        this.interactPrompt.innerHTML = tHtml('interactTerminal')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearRescueSurvivor) {
        this.interactPrompt.innerHTML = tHtml('interactRescue')
        this.interactPrompt.style.display = 'block'
      } else if (canRefuelGenerator) {
        this.interactPrompt.innerHTML = tHtml('interactRefuel')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearAmmoStation) {
        this.interactPrompt.innerHTML = tHtml('interactAmmoStation')
        this.interactPrompt.style.display = 'block'
      } else if (this.nearBarricadeWindow) {
        this.interactPrompt.innerHTML = `<b>F</b> repair barricade (+${REPAIR_REWARD_SCRAP} scrap)`
        this.interactPrompt.style.display = 'block'
      } else {
        this.interactPrompt.style.display = 'none'
      }
      this._updateMinimap(playerPos)
      this._updateCompass(playerPos)
      this._updateBarricades()
      this._updateTraps()
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

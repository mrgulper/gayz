import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { buildViewmodel, buildQuickMeleeKnifeModel } from './Viewmodels.js'
import { t, onLanguageChange } from './i18n.js'
import { getKeyFor } from './Keybinds.js'
import { flatMaterial } from './QualitySettings.js'

const VIEWMODEL_BASE = new THREE.Vector3(0.26, -0.22, -0.5)
// Was intensity 4 / distance 8 - blew out everything nearby on every shot.
const MUZZLE_FLASH_PEAK = 1.6
// Per-weapon muzzle color (see w.muzzleColor) - this is the previous single
// hardcoded color every weapon used to share, now just the fallback.
const DEFAULT_MUZZLE_COLOR = 0xfff2b0
const EXPLOSIVE_PROP_RADIUS = 5
const EXPLOSIVE_PROP_DAMAGE_MIN = 70
const EXPLOSIVE_PROP_DAMAGE_MAX = 160
const VIEWMODEL_ADS = new THREE.Vector3(0.02, -0.1, -0.32)
const ADS_LERP_SPEED = 9
// Bullet tracers - unit-height geometry shared across every tracer instance,
// stretched via mesh.scale.y per shot instead of rebuilding geometry every
// trigger pull (see _spawnTracer).
const TRACER_GEOMETRY = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true)
const TRACER_UP = new THREE.Vector3(0, 1, 0)
const TRACER_LIFETIME_MS = 80
const TRACER_MAX_RANGE = 60
const MAX_TRACERS = 20
// Aim Assist (accessibility, see this.aimAssist) - a small forgiving radius
// tried only when the precise shot missed every zombie, an 8-point ring in
// normalized device coordinates rather than actually widening spread for
// every shot (which would also make walls/props easier to snipe past, not
// just zombies).
const AIM_ASSIST_RADIUS = 0.02
const AIM_ASSIST_OFFSETS = [
  [AIM_ASSIST_RADIUS, 0], [-AIM_ASSIST_RADIUS, 0], [0, AIM_ASSIST_RADIUS], [0, -AIM_ASSIST_RADIUS],
  [AIM_ASSIST_RADIUS, AIM_ASSIST_RADIUS], [-AIM_ASSIST_RADIUS, -AIM_ASSIST_RADIUS],
  [AIM_ASSIST_RADIUS, -AIM_ASSIST_RADIUS], [-AIM_ASSIST_RADIUS, AIM_ASSIST_RADIUS],
]
// Idle weapon inspect - seconds of no movement/firing/aiming/reloading
// before the sway starts, then how long it takes to fade fully in.
const IDLE_INSPECT_DELAY_S = 5
const IDLE_INSPECT_FADE_S = 1.5
// Sprint FOV kick - degrees added on top of defaultFov while sprinting, a
// subtle sense-of-speed widen rather than a full sprint-specific FOV value.
const SPRINT_FOV_KICK = 8
const SPRINT_FOV_LERP_SPEED = 6

// The off-hand knife (buildQuickMeleeKnifeModel) rides along in the left
// hand for as long as any gun is equipped (hidden only for the melee slot
// itself, see _switchTo) - purely a held-ready visual now, not a separate
// instant-stab attack (that used to live on Digit1, retired since the
// hotbar - see Game.js - now owns Digit1-5 for slot switching).
const KNIFE_DAMAGE = 150
const IGNITE_DURATION_MS = 3000
const IGNITE_DPS = 8
// Weapon jamming - a small per-shot chance a gun (never melee, never while
// infiniteAmmo's killstreak reward is active) fails to cycle instead of
// firing; blocks the next trigger pull until JAM_CLEAR_MS passes, or until
// the player taps Reload early (see _reload's quick-clear check).
const JAM_CHANCE = 0.025
const JAM_CLEAR_MS = 1400
// Perfect Reload - pressing reload again in the last stretch before a
// reload finishes completes it instantly with a brief damage bonus,
// rewarding precise timing over just holding the trigger through it.
const PERFECT_RELOAD_WINDOW_S = 0.15
const PERFECT_RELOAD_DAMAGE_MULT = 1.15
const PERFECT_RELOAD_BONUS_DURATION_MS = 6000
// Acid/Electric Rounds attachments - see applyAttachment's w.corrodes/w.shocks.
const CORRODE_DURATION_MS = 4000
const ELECTRIC_CHAIN_RANGE = 6
const ELECTRIC_CHAIN_STUN_MS = 900
// Headshot bonus - geometric height check against hit.point rather than
// tagging every individual head mesh across every zombie body-builder
// variant (GLB/procedural/dinosaur-skulled bosses all differ). Reads each
// zombie's own getHeadWorldHeight() (see Zombie.js) instead of a single
// fixed height - that used to assume every type stands upright the same
// way, which was flat wrong for crawler-type zombies (genuinely low to
// the ground, not just a shorter standing humanoid) and meant headshots
// could never register correctly on them.
const HEADSHOT_HEIGHT_RATIO = 0.82
// Leg shots - the opposite end of the same height check headshots already
// use, reusing Zombie.weaken() (previously only ever triggered by the UV
// Baton melee variant) as the actual slow effect rather than inventing a
// parallel one.
const LEG_SHOT_HEIGHT_RATIO = 0.25
const LEG_SHOT_WEAKEN_MS = 2000
const HEADSHOT_DAMAGE_MULT = 1.75
// Melee combo chain
const MELEE_COMBO_WINDOW_MS = 2000
const MELEE_COMBO_THRESHOLD = 5
const MELEE_COMBO_BONUS_MULT = 1.8
// Held low on the off-hand (left) side, well clear of the equipped gun's
// own position (see VIEWMODEL_BASE, positive X).
const QUICK_MELEE_REST_POS = new THREE.Vector3(-0.36, -0.28, -0.28)
const QUICK_MELEE_REST_ROT = new THREE.Vector3(0.35, 0.55, -0.25)

const WEAPONS = [
  {
    id: 'melee',
    name: 'Knife',
    melee: true,
    auto: true,
    fireInterval: 0.45,
    range: 2.4,
    damage: KNIFE_DAMAGE,
    magSize: 0,
    reserve: 0,
    unlocked: true,
  },
  {
    id: 'rifle',
    name: 'AK-47',
    auto: true,
    fireInterval: 0.1,
    reloadTime: 0.8,
    magSize: 30,
    reserve: 90,
    damage: 14,
    unlocked: true,
    // Per-shot camera shake (see onWeaponFired) - light since this fires
    // fast and full-intensity auto-fire shake would just read as nausea.
    shakeIntensity: 0.035,
    shakeDuration: 70,
  },
  {
    id: 'pistol',
    name: 'M1911',
    auto: false,
    fireInterval: 0.32,
    reloadTime: 0.55,
    magSize: 12,
    reserve: 48,
    damage: 26,
    unlocked: true,
    shakeIntensity: 0.05,
    shakeDuration: 90,
  },
  {
    id: 'minigun',
    name: 'Minigun',
    auto: true,
    fireInterval: 0.06,
    reloadTime: 1.6,
    magSize: 150,
    reserve: 450,
    damage: 12,
    // Barely-there per-shot kick - at this fire rate it reads as a
    // continuous low rumble rather than distinct shake events.
    shakeIntensity: 0.02,
    shakeDuration: 50,
    // Shop-exclusive (see CoinShop.js) - no longer findable as loot.
    unlocked: false,
    // Overheat (see _fire/update's heat handling) - sustained fire builds
    // toward maxHeat, then forces the same jammedUntil cooldown a real jam
    // would, so ripping the trigger the whole fight has a real cost instead
    // of just "reload once every 150 rounds."
    overheats: true,
    heatPerShot: 0.09,
    maxHeat: 1,
    overheatCooldownMs: 2500,
  },
  {
    id: 'shotgun',
    name: 'Weatie',
    auto: false,
    fireInterval: 0.8,
    reloadTime: 1.3,
    magSize: 6,
    reserve: 24,
    damage: 22,
    pellets: 8,
    spread: 0.09,
    // Per-pellet damage drops from `near` at nearDist down to `far` at
    // farDist and beyond - a shotgun that's brutal at close range and weak
    // at a distance instead of one flat damage number regardless of range.
    damageFalloff: { near: 22, far: 6, nearDist: 4, farDist: 16 },
    unlocked: false,
    shakeIntensity: 0.09,
    shakeDuration: 150,
  },
  {
    id: 'awp',
    name: 'AWP',
    auto: false,
    fireInterval: 1.3,
    reloadTime: 1.8,
    magSize: 5,
    reserve: 20,
    damage: 140,
    hasScope: true,
    unlocked: false,
    // Heaviest kick of any hitscan gun - slow fire rate means it never
    // stacks into the nausea territory minigun/rifle have to avoid.
    shakeIntensity: 0.14,
    shakeDuration: 200,
  },
  {
    id: 'glock18',
    name: 'Glock 18',
    auto: true,
    fireInterval: 0.07,
    reloadTime: 0.5,
    magSize: 20,
    reserve: 80,
    damage: 10,
    unlocked: false,
    shakeIntensity: 0.03,
    shakeDuration: 60,
  },
  {
    id: 'flamethrower',
    name: 'Flamethrower',
    auto: true,
    fireInterval: 0.05,
    reloadTime: 2.2,
    magSize: 100,
    reserve: 200,
    // Low per-tick damage, very short range, wide cone (spread) - the fast
    // fireInterval above is what actually reads as "continuous stream"
    // rather than a real DoT/particle system, same "reuse the existing
    // hit-scan pipeline, just tuned differently" idea flamethrower.glb
    // doesn't need any new mechanic beyond stats for.
    damage: 4,
    range: 7,
    spread: 0.14,
    ignites: true,
    muzzleColor: 0xff6a1a,
    unlocked: false,
    shakeIntensity: 0.015,
    shakeDuration: 50,
  },
  {
    id: 'rocket',
    name: 'Rocket Launcher',
    auto: false,
    fireInterval: 1.8,
    reloadTime: 2.4,
    magSize: 1,
    reserve: 5,
    damage: 0, // unused - see w.explosive below, damage comes from explosiveDamageMin/Max instead
    explosive: true,
    explosiveRadius: 6,
    explosiveDamageMin: 120,
    explosiveDamageMax: 320,
    muzzleColor: 0xff5a2a,
    unlocked: false,
    shakeIntensity: 0.12,
    shakeDuration: 180,
  },
  {
    id: 'crossbow',
    name: 'Crossbow',
    auto: false,
    fireInterval: 1.1,
    reloadTime: 1.4,
    magSize: 1,
    reserve: 12,
    damage: 140,
    // suppressed baked in rather than attachment-granted (see applyAttachment) -
    // it's inherently the quiet option, not a gun that becomes quiet once upgraded.
    suppressed: true,
    // Retrieved bolt (see _fire's hitZombies loop) - a connecting hit has a
    // chance to refund straight to reserve, so it never fully runs dry the
    // way every other gun's ammo does.
    boltRetrieveChance: 0.6,
    unlocked: false,
    shakeIntensity: 0.04,
    shakeDuration: 80,
  },
  {
    id: 'launcher',
    name: 'Grenade Launcher',
    auto: false,
    fireInterval: 0.9,
    reloadTime: 2.0,
    magSize: 4,
    reserve: 12,
    damage: 0, // unused - see w.explosive below, same shape as the Rocket Launcher
    explosive: true,
    explosiveRadius: 4,
    explosiveDamageMin: 55,
    explosiveDamageMax: 130,
    muzzleColor: 0xff8a3a,
    unlocked: false,
    shakeIntensity: 0.1,
    shakeDuration: 160,
  },
  {
    id: 'suppressedsmg',
    name: 'Suppressed SMG',
    auto: true,
    fireInterval: 0.09,
    reloadTime: 1.1,
    magSize: 35,
    reserve: 140,
    damage: 9,
    // Always-suppressed by design (a cheap stealth spray weapon), distinct
    // from buying the suppressor attachment for an existing gun - see
    // CoinShop.js's own note on why this is a separate weapon, not a variant.
    suppressed: true,
    muzzleColor: 0x8ab0ff,
    unlocked: false,
    shakeIntensity: 0.025,
    shakeDuration: 60,
  },
  {
    id: 'nailgun',
    name: 'Nail Gun',
    auto: true,
    fireInterval: 0.15,
    reloadTime: 1.0,
    magSize: 40,
    reserve: 120,
    damage: 16,
    // Every connecting hit extends staggerUntil (see Zombie.stun) - sustained
    // fire keeps a target pinned in place instead of a one-off knockdown.
    stunMs: 350,
    muzzleColor: 0xd8d8d8,
    unlocked: false,
    shakeIntensity: 0.05,
    shakeDuration: 90,
  },
  {
    id: 'harpoon',
    name: 'Harpoon Gun',
    auto: false,
    fireInterval: 1.6,
    reloadTime: 2.0,
    magSize: 1,
    reserve: 8,
    damage: 90,
    // See _fire()'s hitZombies loop - yanks whatever it connects with toward
    // the player instead of just dealing damage in place.
    pullsTarget: true,
    muzzleColor: 0x6ad8ff,
    unlocked: false,
    shakeIntensity: 0.08,
    shakeDuration: 140,
  },
]

// Alternate stat blocks for the melee slot - see setMeleeVariant(). Found as
// loot, they replace the knife's stats/viewmodel in place rather than
// occupying a new weapon slot/key.
const MELEE_VARIANTS = {
  knife: { name: 'Knife', damage: KNIFE_DAMAGE, fireInterval: 0.45, range: 2.4 },
  bat: { name: 'Bat', damage: 75, fireInterval: 0.7, range: 2.2 },
  machete: { name: 'Machete', damage: 58, fireInterval: 0.3, range: 2.6 },
  uvbaton: { name: 'UV Baton', damage: 0, fireInterval: 0.5, range: 2.3 },
  // cleaveRadius: on top of the direct hit, deals reduced damage to any
  // other alive zombie within that radius of the swing's impact point -
  // see _fire()'s cleave pass below.
  fireaxe: { name: 'Fire Axe', damage: 95, fireInterval: 0.6, range: 2.3, cleaveRadius: 1.6 },
  // stunMs: extends the normal brief hit-reaction stagger into a real stun
  // (see Zombie.stun) on top of its already-high damage.
  sledgehammer: { name: 'Sledgehammer', damage: 130, fireInterval: 0.95, range: 2.2, stunMs: 1200 },
  // Longest reach of any melee weapon - trades damage for keeping zombies
  // at arm's length.
  spear: { name: 'Spear', damage: 48, fireInterval: 0.55, range: 3.2 },
  // Fastest swing of any melee weapon, shortest range - a flurry weapon
  // rather than a hard-hitting one.
  nunchaku: { name: 'Nunchaku', damage: 30, fireInterval: 0.22, range: 1.9 },
}

// Weapon charms - found as loot (see Game.js's toastCharmAdded), purely
// cosmetic (no stat effect, unlike every other loot pickup this game has).
// One small mesh built per palette entry rather than per gun model: it's
// parented directly to viewmodelRoot (see equipCharm below), so it stays
// visible near the grip no matter which weapon is currently equipped
// instead of needing bespoke integration into all 8+ viewmodel builders.
const WEAPON_CHARMS = {
  skull: { color: 0xe8e4d8, geometry: () => new THREE.OctahedronGeometry(0.03, 0) },
  star: { color: 0xffcf5c, geometry: () => new THREE.OctahedronGeometry(0.032, 0) },
  clover: { color: 0x5ca85c, geometry: () => new THREE.TorusGeometry(0.024, 0.012, 6, 10) },
  dice: { color: 0xd8483a, geometry: () => new THREE.BoxGeometry(0.04, 0.04, 0.04) },
  heart: { color: 0xd8485a, geometry: () => new THREE.SphereGeometry(0.028, 8, 6) },
  horseshoe: { color: 0xb8a068, geometry: () => new THREE.TorusGeometry(0.026, 0.01, 6, 10, Math.PI * 1.5) },
  gem: { color: 0x5ac8d8, geometry: () => new THREE.ConeGeometry(0.028, 0.045, 5) },
}
export const WEAPON_CHARM_IDS = Object.keys(WEAPON_CHARMS)

export class WeaponSystem {
  constructor(camera, scene, colliderMeshes, hud, zombieManager, onHitSurface, onZombieHit, onStealthTakedown, onDamageDealt = null, onWeaponFired = null, shouldShowHitFeedback = () => true) {
    this.camera = camera
    this.scene = scene
    this.colliderMeshes = colliderMeshes
    this.hud = hud
    this.zombieManager = zombieManager
    this.onHitSurface = onHitSurface
    this.onZombieHit = onZombieHit
    this.onStealthTakedown = onStealthTakedown
    // Damage Number Popups - separate from onZombieHit (a no-arg "something
    // died a little" hitmarker/UI trigger) since this needs the actual
    // world point and final (post-multiplier) damage number per zombie hit.
    this.onDamageDealt = onDamageDealt
    // Per-weapon camera shake profile (see w.shakeIntensity/shakeDuration)
    // and bullet tracers - both fire once per shot regardless of whether
    // it connects, unlike onDamageDealt/onZombieHit above which only ever
    // fire on a successful hit.
    this.onWeaponFired = onWeaponFired
    // Show Hit Feedback setting (see Game.js's hitFeedbackToggle) - a
    // getter, not a snapshotted boolean, so toggling it mid-game takes
    // effect on the very next shot without needing to rewire anything.
    this.shouldShowHitFeedback = shouldShowHitFeedback
    // Set post-construction via setRivalManager (see RivalScavenger.js) -
    // optional, so nothing else about this class needs to change if it's
    // never set.
    this.rivalManager = null

    // scopeOwned tracks a *permanent* scope (built-in on the AWP, or bought
    // via the Coin Shop's applyAttachment) separately from the transient
    // hasScope gameplay flag below - the Trader's in-run attachScope() also
    // flips hasScope for this run's ADS zoom, but must NOT be mistaken for a
    // permanent purchase when Game.js's saveShopProgress decides what to
    // persist (see applyAttachment's comment).
    // masteryMult: set by Game.js's weapon mastery system (see
    // WeaponMastery.js) once a weapon crosses its permanent kill threshold -
    // persists across runs, unlike rarityMult which resets with a fresh
    // weapon roll.
    this.weapons = WEAPONS.map((w) => ({ ...w, ammoInMag: w.magSize, ammoReserve: w.reserve, rarityMult: 1, rarityTier: null, hasExtMag: false, suppressed: !!w.suppressed, scopeOwned: !!w.hasScope, masteryMult: 1, upgradeMult: 1, jammedUntil: 0 }))
    this.currentIndex = 0
    this.meleeVariant = 'knife'
    // Global damage multiplier - the XP-gem level-up pool's damage upgrade
    // stacks additively onto this rather than needing to touch every
    // weapon's own damage stat (see _fire's onHit call).
    this.damageMult = 1
    // Cleaning Kit pickup (see Game.js's toastCleaningKit) - set/cleared
    // externally by a timer there, same pattern as every other timed effect.
    this.jamChanceMult = 1
    // Melee combo chain (see _fire's melee branch) - every
    // MELEE_COMBO_THRESHOLD consecutive swings within MELEE_COMBO_WINDOW_MS
    // of each other bonuses that hit, then resets.
    this.meleeComboCount = 0
    this.lastMeleeHitAt = 0
    // Melee Charge Bash - set every frame from Game.js (see update() below),
    // mirroring how isMoving already arrives as a param rather than this
    // class reaching into PlayerController itself.
    this.isSprinting = false
    // Minigun Overheat (see w.overheats in _fire) - builds per shot, decays
    // when not firing, and reuses the existing jam mechanic's jammedUntil/HUD
    // once it maxes out instead of adding a second cooldown state.
    this.heat = 0
    // Adrenaline shot (see Game.js's _useAdrenaline) - set/cleared externally
    // by a timer there, same pattern as every other timed effect.
    this.fireRateMult = 1
    // Killstreak reward (see Game.js's _checkKillstreakReward) - set/cleared
    // externally by a timer there, same pattern as fireRateMult above.
    this.infiniteAmmo = false
    // Riot shield (see Game.js's _toggleShield) - trades firing for damage
    // reduction while up, checked alongside triggerDown/hasAmmo below.
    this.shieldActive = false
    // Instakill power-up (see Game.js's _onPickup instakill) - set/cleared
    // externally by a timer there, same pattern as infiniteAmmo above.
    this.instakillActive = false

    this.triggerDown = false
    this.timeSinceLastShot = Infinity
    this.reloading = false
    this.reloadEndsAt = 0
    this.perfectReloadUntil = 0

    this.raycaster = new THREE.Raycaster()
    // Toned down from intensity 4 / distance 8, which blew out the whole
    // nearby scene on every shot - now a shorter-reaching, snappier flash
    // (see _fire's intensity=1.6 and the faster decay below) plus a small
    // flash-shape sprite (this.muzzleFlashSprite) so it still reads as a
    // gunshot up close without lighting up everything around it.
    this.muzzleLight = new THREE.PointLight(0xfff2b0, 0, 4.5)
    this.camera.add(this.muzzleLight)
    this.muzzleLight.position.set(0.26, -0.16, -0.85)

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0, depthWrite: false })
    this.muzzleFlashSprite = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.15, 6), flashMat)
    this.muzzleFlashSprite.rotation.x = -Math.PI / 2
    this.camera.add(this.muzzleFlashSprite)
    this.muzzleFlashSprite.position.copy(this.muzzleLight.position)
    this.muzzleFlashSprite.position.z -= 0.06

    this._time = 0
    this.recoil = 0
    this.aiming = false
    this.aimAmount = 0
    this.defaultFov = camera.fov
    this.aimFov = camera.fov * 0.6
    this._lerpedViewmodelPos = new THREE.Vector3()
    this._hitNormal = new THREE.Vector3()
    // Bullet tracers - capped, oldest-evicted array of short-lived streak
    // meshes (see _spawnTracer/_updateTracers), same shape as Decals.js's
    // puddle/decal arrays. Each tracer gets its own material instance (never
    // shared) since several can be fading concurrently under sustained fire.
    this.tracers = []
    this._idleTime = 0
    this._idleInspectAmount = 0
    // Hold-to-inspect key state (see _onKey/the keyup listener above).
    this.inspecting = false
    this._sprintFovAmount = 0
    // Toggle-to-ADS (accessibility, see the mousedown/mouseup listeners
    // below) - defaults to hold mode (false), set from Game.js's settings.
    this.toggleAds = false
    // Aim Assist (accessibility, see AIM_ASSIST_OFFSETS) - defaults off,
    // set from Game.js's settings.
    this.aimAssist = false
    this.viewmodelRoot = new THREE.Group()
    this.viewmodelRoot.position.copy(VIEWMODEL_BASE)
    this.camera.add(this.viewmodelRoot)

    this.viewmodels = {}
    for (const w of this.weapons) {
      const vm = buildViewmodel(w.id)
      vm.visible = false
      this.viewmodelRoot.add(vm)
      this.viewmodels[w.id] = vm
    }
    this.viewmodels[this.current.id].visible = true

    // Quick-melee's own knife, parented to the same viewmodelRoot as every
    // other weapon so it inherits the same camera-relative positioning.
    // Unlike every other viewmodel it isn't toggled by _switchTo alone -
    // it stays visible in the off-hand for as long as any gun is equipped
    // (hidden only when the melee slot itself is out, since that viewmodel
    // already shows a held knife/bat/machete).
    this.quickMeleeKnife = buildQuickMeleeKnifeModel()
    this.quickMeleeKnife.position.copy(QUICK_MELEE_REST_POS)
    this.quickMeleeKnife.rotation.setFromVector3(QUICK_MELEE_REST_ROT)
    this.quickMeleeKnife.visible = !this.current.melee
    this.viewmodelRoot.add(this.quickMeleeKnife)

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.triggerDown = true
      if (e.button === 2) {
        if (this.toggleAds) this.aiming = !this.aiming
        else this.aiming = true
      }
    })
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.triggerDown = false
      if (e.button === 2 && !this.toggleAds) this.aiming = false
    })
    window.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', (e) => this._onKey(e))
    window.addEventListener('keyup', (e) => {
      if (e.code === getKeyFor('weaponInspect')) this.inspecting = false
    })

    onLanguageChange(() => this._updateHud(this.reloading))

    this._updateHud()
  }

  get current() {
    return this.weapons[this.currentIndex]
  }

  // Marks a gun owned without switching to it - used to restore Coin Shop
  // purchases on page load (see Game.js's shopProgress.unlockedGuns), where
  // auto-equipping whichever gun happens to be last in the saved list would
  // silently override the player's actual last-equipped weapon.
  markUnlocked(id) {
    const w = this.weapons.find((w) => w.id === id)
    if (!w) return
    w.unlocked = true
    w.ammoInMag = w.magSize
    w.ammoReserve = w.reserve
  }

  // A fresh purchase (Coin Shop) both unlocks and equips the gun, since
  // that's what the player just spent coins on and expects to see in hand.
  unlockWeapon(id) {
    this.markUnlocked(id)
    const index = this.weapons.findIndex((w) => w.id === id)
    if (index !== -1) this._switchTo(index)
  }

  // See RivalScavenger.js's RivalManager - set post-construction (not a
  // constructor param) since it's optional and this class works fine
  // without one ever being set.
  setRivalManager(rivalManager) {
    this.rivalManager = rivalManager
  }

  // Trader in-run crafting (see Game.js's SHOP_ITEMS craft_scope) - only
  // flips the gameplay flag for this run/session, deliberately leaves
  // scopeOwned untouched so it doesn't get persisted as a permanent Coin
  // Shop attachment (see applyAttachment below).
  attachScope(id) {
    const w = this.weapons.find((w) => w.id === id)
    if (w) w.hasScope = true
  }

  // Coin Shop permanent attachments (see CoinShop.js's ATTACHMENT_TYPES and
  // Game.js's Weapons section) - distinct from the Trader's in-run, points-
  // bought scope/extended-mag crafting above: these are bought with coins,
  // apply to one specific owned gun, and persist across every future run
  // (see Game.js's shopProgress.attachments). Idempotent per weapon+id pair
  // so restoring from a save on page load never double-applies the mag bonus.
  applyAttachment(weaponId, attachmentId) {
    const w = this.weapons.find((w) => w.id === weaponId)
    if (!w) return
    if (attachmentId === 'scope') {
      w.hasScope = true
      w.scopeOwned = true
    } else if (attachmentId === 'extmag') {
      if (w.hasExtMag) return
      w.hasExtMag = true
      const magBonus = Math.round(w.magSize * 0.5)
      const reserveBonus = Math.round(w.reserve * 0.5)
      w.magSize += magBonus
      w.reserve += reserveBonus
      w.ammoInMag += magBonus
      w.ammoReserve += reserveBonus
    } else if (attachmentId === 'suppressor') {
      w.suppressed = true
    } else if (attachmentId === 'laser') {
      if (w.hasLaser) return
      w.hasLaser = true
      // Only meaningful on weapons with a hip-fire spread cone to begin
      // with (shotgun/flamethrower/minigun) - guns without one are already
      // pinpoint-accurate, so this is a no-op for them, same as a real
      // laser sight barely matters on an already-tight rifle.
      if (w.spread) w.spread *= 0.55
    } else if (attachmentId === 'incendiary') {
      // Reuses the exact ignite mechanic the Flamethrower already has (see
      // w.ignites in _fire's hitZombies loop) - this just grants that same
      // flag to a chosen gun instead of it being baked into one weapon.
      w.ignites = true
    } else if (attachmentId === 'ricochet') {
      w.ricochet = true
    } else if (attachmentId === 'armorpierce') {
      w.armorPierce = true
    } else if (attachmentId === 'precision') {
      w.critChance = 0.25
    } else if (attachmentId === 'electric') {
      w.shocks = true
    } else if (attachmentId === 'acid') {
      w.corrodes = true
    }
  }

  // See WEAPON_CHARMS' own doc comment - swaps in place rather than
  // stacking, so finding a second charm replaces the first instead of
  // cluttering the grip with several.
  equipCharm(charmId) {
    const charm = WEAPON_CHARMS[charmId]
    if (!charm) return
    if (this.charmMesh) this.viewmodelRoot.remove(this.charmMesh)
    const mat = flatMaterial({ color: charm.color, emissive: charm.color, emissiveIntensity: 0.4, roughness: 0.5 })
    this.charmMesh = new THREE.Mesh(charm.geometry(), mat)
    this.charmMesh.position.set(-0.11, -0.09, 0.08)
    this.viewmodelRoot.add(this.charmMesh)
    this.currentCharm = charmId
  }

  // Chest-found rarity upgrade (see Chests.js's rare_weapon/legendary_weapon
  // loot and Game.js's _onPickup) - takes the best tier found rather than
  // stacking multiplicatively, so finding two "rare" boosts on the same gun
  // doesn't quietly out-power a "legendary" one found elsewhere.
  applyRarityBoost(id, mult, tier) {
    const w = this.weapons.find((w) => w.id === id)
    if (!w || w.rarityMult >= mult) return false
    w.rarityMult = mult
    w.rarityTier = tier
    return true
  }

  // Picks a random currently-unlocked weapon id - used by rare/legendary
  // chest loot, which boosts whatever's already in the player's loadout
  // rather than a fixed slot.
  randomUnlockedWeaponId() {
    const unlocked = this.weapons.filter((w) => w.unlocked)
    if (unlocked.length === 0) return null
    return unlocked[Math.floor(Math.random() * unlocked.length)].id
  }

  // Swaps the melee slot's stats/viewmodel to an alternate found as loot -
  // replaces the knife in place rather than adding a new weapon slot/key.
  setMeleeVariant(variantId) {
    const stats = MELEE_VARIANTS[variantId]
    if (!stats) return
    const w = this.weapons[0]
    w.name = stats.name
    w.damage = stats.damage
    w.fireInterval = stats.fireInterval
    w.range = stats.range
    w.cleaveRadius = stats.cleaveRadius || null
    w.stunMs = stats.stunMs || null
    this.meleeVariant = variantId

    const variants = this.viewmodels.melee?.userData.meleeVariants
    if (variants) {
      for (const id in variants) variants[id].visible = id === variantId
    }
    this._updateHud()
  }

  // Cosmetic achievement reward (e.g. Centurion's gold pistol) - purely
  // visual, rebuilds just that one weapon's viewmodel with the skin applied.
  setWeaponSkin(weaponId, skinId) {
    const old = this.viewmodels[weaponId]
    if (!old) return
    const wasVisible = old.visible
    this.viewmodelRoot.remove(old)
    const vm = buildViewmodel(weaponId, { skinId })
    vm.visible = wasVisible
    this.viewmodelRoot.add(vm)
    this.viewmodels[weaponId] = vm
  }

  // Akimbo (see CoinShop.js) - pistol-only, permanent once purchased.
  // Halves fireInterval (stored once so a second call, e.g. from restoring
  // a past purchase on page load, can't keep halving it further) and swaps
  // to a distinct skin so the tradeoff is visible, not just felt.
  setAkimbo(enabled) {
    const w = this.weapons.find((w) => w.id === 'pistol')
    if (!w) return
    if (enabled && !w.akimbo) {
      w.akimbo = true
      w._baseFireInterval = w.fireInterval
      w.fireInterval /= 2
      this.setWeaponSkin('pistol', 'akimbo')
    } else if (!enabled && w.akimbo) {
      w.akimbo = false
      w.fireInterval = w._baseFireInterval
    }
  }

  // Dual-Wield Shotguns (see CoinShop.js) - same shape as setAkimbo above,
  // just targeting the shotgun slot. No dedicated "akimbo" skin exists for
  // it (unlike the pistol's), so this is stats-only - matching the same
  // "no bespoke viewmodel needed" precedent every fallback-to-buildPistol
  // weapon (flamethrower/rocket/crossbow/launcher/suppressedsmg) already
  // relies on.
  setShotgunAkimbo(enabled) {
    const w = this.weapons.find((w) => w.id === 'shotgun')
    if (!w) return
    if (enabled && !w.akimbo) {
      w.akimbo = true
      w._baseFireInterval = w.fireInterval
      w.fireInterval /= 2
    } else if (!enabled && w.akimbo) {
      w.akimbo = false
      w.fireInterval = w._baseFireInterval
    }
  }

  // Weapon Upgrade Machine (see Game.js's _tryUpgradeWeapon) - a real,
  // permanent-for-the-run damage multiplier on this specific weapon
  // instance, stacking with rarity/mastery multiplicatively rather than
  // replacing them, plus the same cosmetic reskin setWeaponSkin already
  // does for achievement/challenge rewards.
  boostUpgradeMult(weaponId, mult) {
    const w = this.weapons.find((w) => w.id === weaponId)
    if (!w) return
    w.upgradeMult *= mult
    this.setWeaponSkin(weaponId, 'packapunch')
  }

  // Coin Shop skins apply to every gun at once (melee excluded - it doesn't
  // read as a "gun" cosmetically) instead of just the pistol, so buying one
  // skin reskins the whole loadout.
  setSkinAllGuns(skinId) {
    for (const w of this.weapons) {
      if (w.melee) continue
      this.setWeaponSkin(w.id, skinId)
    }
  }

  // Settings hook: keeps ADS zoom math (which lerps from defaultFov) correct
  // after the player changes their base field of view.
  setBaseFov(value) {
    this.defaultFov = value
    this.aimFov = value * 0.6
  }

  // Perk hook: speeds up reload across every non-melee weapon at once.
  boostReloadSpeed(mult) {
    for (const w of this.weapons) {
      if (!w.melee) w.reloadTime *= mult
    }
  }

  // Boosts the currently-equipped weapon's magazine and reserve capacity,
  // immediately refilling the bonus into both.
  addMagBonus(amount) {
    const w = this.current
    w.magSize += amount
    w.ammoInMag += amount
    w.reserve += amount
    w.ammoReserve += amount
    this._updateHud()
  }

  refillReserveAmmo() {
    for (const w of this.weapons) {
      if (w.unlocked) w.ammoReserve = w.reserve
    }
    this._updateHud()
  }

  addAmmoToCurrent(amount) {
    this.current.ammoReserve += amount
    this._updateHud()
  }

  // The melee slot's displayed name depends on which variant (knife/bat/
  // machete) is currently equipped, not on the fixed weapon id - every
  // other slot's key is just "weapon" + capitalized id, as before.
  _nameKeyFor(w) {
    if (w.id === 'melee' && this.meleeVariant !== 'knife') {
      return `weapon${this.meleeVariant.charAt(0).toUpperCase()}${this.meleeVariant.slice(1)}`
    }
    return `weapon${w.id.charAt(0).toUpperCase()}${w.id.slice(1)}`
  }

  getSummary() {
    return this.weapons.map((w) => ({
      id: w.id,
      name: w.name,
      nameKey: this._nameKeyFor(w),
      unlocked: w.unlocked,
      ammoInMag: w.ammoInMag,
      ammoReserve: w.ammoReserve,
      hasScope: !!w.hasScope,
      scopeOwned: !!w.scopeOwned,
      hasExtMag: !!w.hasExtMag,
      suppressed: !!w.suppressed,
      masteryMult: w.masteryMult,
    }))
  }

  // Digit1-5 weapon switching lives in Game.js now (see _bindHotbar) since
  // which weapon each slot holds is player-assignable there, not a fixed
  // index - this only still owns keys that always mean the same thing
  // regardless of loadout.
  _onKey(e) {
    if (e.code === getKeyFor('reload')) this._reload()
    // Hold-to-inspect - reuses the same idle-sway visual as
    // _idleInspectAmount (see update()) instead of a separate animation,
    // just triggered on demand instead of only after 5s of standing still.
    else if (e.code === getKeyFor('weaponInspect') && !this.current.melee) this.inspecting = true
  }

  // Public entry point for switching by slot index - used by Game.js's
  // weapon wheel and hotbar, where the player picks a slot from a radial
  // UI or the bottom bar instead of a fixed number key.
  switchToIndex(index) {
    this._switchTo(index)
  }

  _switchTo(index) {
    if (index === this.currentIndex || index >= this.weapons.length) return
    if (!this.weapons[index].unlocked) return
    // Reload-cancel - switching away mid-reload aborts it instead of
    // blocking the switch. The weapon keeps whatever ammoInMag it already
    // had (see _reload/update()'s completion branch, which is what actually
    // grants the topped-up rounds) - so cancelling costs the remaining
    // reload time and nothing else, same tradeoff a real reload-cancel has.
    if (this.reloading) {
      this.reloading = false
      this._updateHud()
    }
    this.currentIndex = index
    // Overheat only ever applies to whichever gun is currently out, so
    // switching away always hands back a fully-cooled weapon rather than
    // carrying leftover heat onto an unrelated gun.
    this.heat = 0
    for (const id in this.viewmodels) this.viewmodels[id].visible = false
    this.viewmodels[this.weapons[index].id].visible = true
    // Off-hand knife rides along with every gun, hidden only for the melee
    // slot itself (that viewmodel already has its own knife/bat/machete in
    // hand).
    this.quickMeleeKnife.visible = !this.weapons[index].melee
    this.quickMeleeKnife.position.copy(QUICK_MELEE_REST_POS)
    this.quickMeleeKnife.rotation.setFromVector3(QUICK_MELEE_REST_ROT)
    this._updateHud()
  }

  _reload() {
    const w = this.current
    if (w.melee) return
    if (performance.now() / 1000 < w.jammedUntil) {
      w.jammedUntil = 0
      this._updateHud()
      return
    }
    if (this.reloading) {
      // Perfect Reload (see PERFECT_RELOAD_WINDOW_S's own comment) - a
      // press outside the window is just ignored, same as before.
      const remaining = this.reloadEndsAt - performance.now() / 1000
      if (remaining > 0 && remaining <= PERFECT_RELOAD_WINDOW_S) {
        const needed = w.magSize - w.ammoInMag
        const taken = Math.min(needed, w.ammoReserve)
        w.ammoInMag += taken
        w.ammoReserve -= taken
        this.reloading = false
        this.perfectReloadUntil = performance.now() + PERFECT_RELOAD_BONUS_DURATION_MS
        this._updateHud()
      }
      return
    }
    if (w.ammoInMag === w.magSize || w.ammoReserve === 0) return
    this.reloading = true
    // Tactical Reload - topping off a mag that still has rounds in it is
    // faster than working the slide from completely empty, rewarding a
    // reload before you're actually forced to rather than only after.
    const tacticalMult = w.ammoInMag > 0 ? 0.6 : 1
    this.reloadEndsAt = performance.now() / 1000 + w.reloadTime * tacticalMult
    this._updateHud(true)
  }

  update(dt, isMoving = false, isSprinting = false) {
    this.timeSinceLastShot += dt
    this._time += dt
    this.recoil = Math.max(0, this.recoil - dt * 6)
    this.isSprinting = isSprinting
    this._updateTracers()
    // Idle weapon inspect (see _updateViewmodelTransform) - resets the
    // instant the player does anything with the weapon, so it only ever
    // plays during genuine downtime between fights.
    const idling = !isMoving && !this.triggerDown && !this.aiming && !this.reloading && !this.current.melee
    this._idleTime = idling ? this._idleTime + dt : 0
    // Hold-to-inspect (see _onKey/the keyup listener) auto-cancels the
    // instant the player fires/aims/reloads/switches to melee, same
    // "resets instantly" behavior the passive idle version already has -
    // moving is still fine, matching most FPS games' "walk while checking
    // your gun" convention.
    if (this.inspecting && (this.triggerDown || this.aiming || this.reloading || this.current.melee)) this.inspecting = false
    const autoIdleAmount = THREE.MathUtils.clamp((this._idleTime - IDLE_INSPECT_DELAY_S) / IDLE_INSPECT_FADE_S, 0, 1)
    // Held-key inspect ramps in/out much faster (a deliberate action) than
    // the passive idle fade (an ambient fidget) - falls back to the
    // normal idle amount once released.
    const inspectTarget = this.inspecting ? 1 : autoIdleAmount
    const inspectRampSpeed = this.inspecting || !idling ? 8 : 1 / IDLE_INSPECT_FADE_S
    this._idleInspectAmount = THREE.MathUtils.damp(this._idleInspectAmount, inspectTarget, inspectRampSpeed, dt)
    // Overheat decay - only actually cools while not holding the trigger,
    // so spraying right up to the cooldown threshold and letting off for a
    // moment is a real way to avoid it instead of it being on a fixed timer.
    if (!this.triggerDown) this.heat = Math.max(0, this.heat - dt * 0.35)

    const aimTarget = this.aiming && !this.reloading && !this.current.melee ? 1 : 0
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, aimTarget, ADS_LERP_SPEED, dt)
    const aimFov = this.current.hasScope ? this.defaultFov * 0.35 : this.aimFov
    // Sprint FOV kick - fades out via the (1 - aimAmount) term below rather
    // than a hard gate, so it never fights the much larger ADS FOV pull.
    this._sprintFovAmount = THREE.MathUtils.damp(this._sprintFovAmount, isSprinting ? 1 : 0, SPRINT_FOV_LERP_SPEED, dt)
    const baseFov = THREE.MathUtils.lerp(this.defaultFov, aimFov, this.aimAmount)
    this.camera.fov = baseFov + this._sprintFovAmount * SPRINT_FOV_KICK * (1 - this.aimAmount)
    this.camera.updateProjectionMatrix()

    this._updateViewmodelTransform(isMoving)
    this._updateBarrelSpin(dt)

    if (this.reloading) {
      if (performance.now() / 1000 >= this.reloadEndsAt) {
        const w = this.current
        const needed = w.magSize - w.ammoInMag
        const taken = Math.min(needed, w.ammoReserve)
        w.ammoInMag += taken
        w.ammoReserve -= taken
        this.reloading = false
        this._updateHud()
      }
      this.muzzleLight.intensity = 0
      this.muzzleFlashSprite.material.opacity = 0
      return
    }

    if (this.muzzleLight.intensity > 0) {
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 14)
      this.muzzleFlashSprite.material.opacity = (this.muzzleLight.intensity / MUZZLE_FLASH_PEAK) * 0.85
    }

    const w = this.current
    const hasAmmo = w.melee || w.ammoInMag > 0
    const jammed = performance.now() / 1000 < w.jammedUntil
    const canFire = this.triggerDown && !this.shieldActive && !jammed && this.timeSinceLastShot >= w.fireInterval / this.fireRateMult && hasAmmo
    if (canFire) {
      this._fire()
      if (!w.auto) this.triggerDown = false
    } else if (this.triggerDown && !hasAmmo && this.timeSinceLastShot >= 0.25) {
      this.timeSinceLastShot = 0
      if (!w.auto) this.triggerDown = false
    }

    if (!w.melee && w.ammoInMag === 0 && w.ammoReserve > 0) this._reload()
  }

  _spawnTracer(start, end, color) {
    const dir = end.clone().sub(start)
    const len = dir.length()
    if (len < 0.001) return
    dir.normalize()
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
    const mesh = new THREE.Mesh(TRACER_GEOMETRY, mat)
    mesh.position.copy(start).addScaledVector(dir, len * 0.5)
    mesh.scale.set(1, len, 1)
    mesh.quaternion.setFromUnitVectors(TRACER_UP, dir)
    this.scene.add(mesh)
    this.tracers.push({ mesh, bornAt: performance.now() })
    if (this.tracers.length > MAX_TRACERS) {
      const oldest = this.tracers.shift()
      this.scene.remove(oldest.mesh)
      oldest.mesh.material.dispose()
    }
  }

  _updateTracers() {
    if (this.tracers.length === 0) return
    const now = performance.now()
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]
      const age = now - tr.bornAt
      if (age >= TRACER_LIFETIME_MS) {
        this.scene.remove(tr.mesh)
        tr.mesh.material.dispose()
        this.tracers.splice(i, 1)
        continue
      }
      tr.mesh.material.opacity = 0.85 * (1 - age / TRACER_LIFETIME_MS)
    }
  }

  _updateBarrelSpin(dt) {
    const barrelCluster = this.viewmodels[this.current.id]?.userData.barrelCluster
    if (!barrelCluster) return
    const spinning = this.triggerDown && !this.reloading
    this._barrelSpinSpeed = THREE.MathUtils.damp(this._barrelSpinSpeed || 0, spinning ? 22 : 0, 6, dt)
    barrelCluster.rotation.z += this._barrelSpinSpeed * dt
  }

  _updateViewmodelTransform(isMoving) {
    const steadiness = 1 - this.aimAmount * 0.75
    const bobSpeed = isMoving ? 9 : 2.2
    const bobAmpY = (isMoving ? 0.02 : 0.006) * steadiness
    const bobAmpX = (isMoving ? 0.012 : 0.003) * steadiness
    const bobX = Math.cos(this._time * bobSpeed * 0.5) * bobAmpX
    const bobY = Math.abs(Math.sin(this._time * bobSpeed)) * bobAmpY

    this._lerpedViewmodelPos.lerpVectors(VIEWMODEL_BASE, VIEWMODEL_ADS, this.aimAmount)

    // Idle weapon inspect (see this._idleInspectAmount, driven from update())
    // - a slow breathing sway layered on top of the combat bob above, never
    // replacing it, so it only ever reads during genuine downtime.
    const inspectAmt = this._idleInspectAmount
    const inspectY = inspectAmt > 0 ? Math.sin(this._time * 0.5) * 0.01 * inspectAmt : 0

    this.viewmodelRoot.position.set(
      this._lerpedViewmodelPos.x + bobX,
      this._lerpedViewmodelPos.y + bobY + inspectY,
      this._lerpedViewmodelPos.z + this.recoil * 0.12
    )
    this.viewmodelRoot.rotation.x = -this.recoil * 0.18
    this.viewmodelRoot.rotation.y = inspectAmt > 0 ? Math.sin(this._time * 0.6) * 0.06 * inspectAmt : 0
    this.viewmodelRoot.rotation.z = inspectAmt > 0 ? Math.sin(this._time * 0.35 + 1) * 0.04 * inspectAmt : 0
  }

  _fire() {
    const w = this.current
    this.timeSinceLastShot = 0
    if (!w.melee && !this.infiniteAmmo && Math.random() < JAM_CHANCE * this.jamChanceMult) {
      w.jammedUntil = performance.now() / 1000 + JAM_CLEAR_MS / 1000
      this._updateHud()
      return
    }
    let meleeComboBonus = 1
    // Melee Charge Bash - sprinting into a swing (see Game.js's update()
    // call passing player.isSprinting through) hits harder and shoves the
    // target back, on top of whatever the normal combo chain is doing.
    const chargeBash = w.melee && this.isSprinting
    if (chargeBash) meleeComboBonus *= 1.5
    if (w.melee) {
      this.recoil = 0.6
      audioEngine.playMelee()
      const nowMs = performance.now()
      if (nowMs - this.lastMeleeHitAt > MELEE_COMBO_WINDOW_MS) this.meleeComboCount = 0
      this.meleeComboCount += 1
      this.lastMeleeHitAt = nowMs
      if (this.meleeComboCount >= MELEE_COMBO_THRESHOLD) {
        meleeComboBonus = MELEE_COMBO_BONUS_MULT
        this.meleeComboCount = 0
      }
    } else {
      if (!this.infiniteAmmo) w.ammoInMag -= 1
      // Minigun Overheat (see w.overheats) - this shot itself still lands,
      // but if it pushes heat over the top the gun seizes right after,
      // reusing jammedUntil (and its existing HUD/jam-clear handling)
      // instead of a second parallel cooldown state.
      if (w.overheats) {
        this.heat += w.heatPerShot
        if (this.heat >= w.maxHeat) {
          this.heat = 0
          w.jammedUntil = performance.now() / 1000 + w.overheatCooldownMs / 1000
        }
      }
      // Suppressor attachment (see applyAttachment) dims the flash to a
      // fraction instead of hiding it outright - still a gun going off up
      // close, just not lighting up the street.
      const flashMult = w.suppressed ? 0.3 : 1
      this.muzzleLight.intensity = MUZZLE_FLASH_PEAK * flashMult
      // Per-weapon muzzle color (see w.muzzleColor) - falls back to the
      // original fixed warm-white for every weapon that doesn't set one,
      // so this is purely additive over the previous single shared color.
      this.muzzleLight.color.setHex(w.muzzleColor ?? DEFAULT_MUZZLE_COLOR)
      this.muzzleFlashSprite.material.color.setHex(w.muzzleColor ?? DEFAULT_MUZZLE_COLOR)
      this.muzzleFlashSprite.material.opacity = 0.85 * flashMult
      this.muzzleFlashSprite.rotation.z = Math.random() * Math.PI * 2
      this.recoil = 1
      this._updateHud()
      audioEngine.playShot(w.id, w.suppressed)
      if (this.onWeaponFired && w.shakeIntensity) this.onWeaponFired(w.shakeIntensity, w.shakeDuration)
    }

    const zombieMeshes = this.zombieManager ? this.zombieManager.hittableMeshes : []
    const rivalMeshes = this.rivalManager ? this.rivalManager.hittableMeshes : []
    const pelletCount = w.pellets || 1
    const spread = w.spread || 0
    // zombie -> { count, distance } instead of a plain Set, so a
    // multi-pellet weapon (see w.pellets, the shotgun) both stacks damage
    // per pellet that actually connects and can look up how close the
    // nearest connecting pellet was, for w.damageFalloff below.
    const hitZombies = new Map()
    let anyHit = false
    let meleeHitPoint = null

    for (let i = 0; i < pelletCount; i++) {
      const offset = new THREE.Vector2(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      )
      this.raycaster.setFromCamera(offset, this.camera)
      let hits = this.raycaster.intersectObjects([...zombieMeshes, ...rivalMeshes, ...this.colliderMeshes], true)
      // Aim Assist - only kicks in once the precise shot has already missed
      // every zombie (or hit a wall/prop first), so it never overrides a
      // shot that was genuinely lined up on something else.
      if (this.aimAssist && !w.melee && zombieMeshes.length > 0 && (hits.length === 0 || !hits[0].object.userData.zombie)) {
        for (const [dx, dy] of AIM_ASSIST_OFFSETS) {
          this.raycaster.setFromCamera(new THREE.Vector2(offset.x + dx, offset.y + dy), this.camera)
          const assistHits = this.raycaster.intersectObjects([...zombieMeshes, ...this.colliderMeshes], true)
          if (assistHits.length > 0 && assistHits[0].object.userData.zombie) {
            hits = assistHits
            break
          }
        }
      }
      // Tracer - only the first pellet gets one (a shotgun's other 7 would
      // just read as clutter), and it's spawned whether or not this pellet
      // actually connects, so a miss still visibly flies off into the distance.
      if (i === 0 && !w.melee) {
        const origin = this.muzzleLight.getWorldPosition(new THREE.Vector3())
        const end = hits.length > 0
          ? hits[0].point.clone()
          : this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, TRACER_MAX_RANGE)
        this._spawnTracer(origin, end, w.muzzleColor ?? DEFAULT_MUZZLE_COLOR)
      }
      if (hits.length === 0) continue
      if (w.melee && hits[0].distance > w.range) continue

      anyHit = true
      const hit = hits[0]
      if (w.melee) meleeHitPoint = hit.point

      // Rocket Launcher (see w.explosive) - the impact point (whatever it
      // hit, zombie or bare wall) becomes an AOE burst instead of a normal
      // per-zombie hit-scan hit, reusing the exact same falloff-damage
      // helper the killstreak airstrike already uses. Skips the rest of
      // this pellet's normal hit-accumulation below entirely - explosive
      // weapons never have more than 1 pellet anyway.
      if (w.explosive) {
        if (this.zombieManager) this.zombieManager.damageInRadius(hit.point.x, hit.point.z, w.explosiveRadius, w.explosiveDamageMin, w.explosiveDamageMax)
        continue
      }

      // Rival scavenger - a human NPC, not a zombie, so it gets a flat
      // damage hit here rather than joining hitZombies' per-pellet
      // falloff/stealth-takedown accounting below (none of that applies to
      // a squad member racing for an airdrop).
      const rivalHit = hit.object.userData.rival
      if (rivalHit) {
        rivalHit.onHit(w.damage * this.damageMult * w.rarityMult * w.masteryMult * w.upgradeMult)
        if (this.onZombieHit) this.onZombieHit()
      }

      const zombieHit = hit.object.userData.zombie
      if (zombieHit) {
        const hitHeight = hit.point.y - zombieHit.group.position.y
        const isHeadshot = hitHeight >= zombieHit.getHeadWorldHeight() * HEADSHOT_HEIGHT_RATIO
        const isLegShot = hitHeight <= zombieHit.getHeadWorldHeight() * LEG_SHOT_HEIGHT_RATIO
        const existing = hitZombies.get(zombieHit)
        if (existing) {
          existing.count += 1
          existing.distance = Math.min(existing.distance, hit.distance)
          existing.headshot = existing.headshot || isHeadshot
          existing.legShot = existing.legShot || isLegShot
        } else {
          hitZombies.set(zombieHit, { count: 1, distance: hit.distance, headshot: isHeadshot, legShot: isLegShot })
        }
        // Leg shot - weakens (slows) rather than dealing bonus damage, a
        // tradeoff pick against aiming for the headshot bonus instead.
        if (isLegShot) zombieHit.weaken(LEG_SHOT_WEAKEN_MS)
        // Flamethrower (see w.ignites) - a lingering burn on top of the
        // direct hit-scan tick, so backing off after a couple of ticks
        // still keeps dealing damage instead of the effect ending the
        // instant the stream stops touching them.
        if (w.ignites) zombieHit.ignite(IGNITE_DURATION_MS, IGNITE_DPS)
        // Acid Rounds attachment (see applyAttachment's w.corrodes).
        if (w.corrodes) zombieHit.corrode(CORRODE_DURATION_MS)
        // Electric Rounds attachment (see applyAttachment's w.shocks) -
        // chain-stuns (not damages) the single nearest OTHER living zombie
        // in range, same nearest-neighbor scan shape Ricochet/cleave below
        // already use, just a crowd-control effect instead of bounce damage.
        if (w.shocks && this.zombieManager) {
          let nearest = null
          let nearestDist = ELECTRIC_CHAIN_RANGE
          for (const other of this.zombieManager.zombies) {
            if (other === zombieHit || other.state !== 'alive') continue
            const d = Math.hypot(other.group.position.x - zombieHit.group.position.x, other.group.position.z - zombieHit.group.position.z)
            if (d < nearestDist) {
              nearestDist = d
              nearest = other
            }
          }
          if (nearest) nearest.stun(ELECTRIC_CHAIN_STUN_MS)
        }
        // Crossbow (see w.boltRetrieveChance) - a connecting hit has a
        // chance to refund the bolt straight to reserve.
        if (w.boltRetrieveChance && Math.random() < w.boltRetrieveChance) {
          w.ammoReserve += 1
          this._updateHud()
        }
        // Harpoon Gun (see w.pullsTarget) - yanks whatever it connects with
        // toward the player along the ground plane, clamped so it never
        // overshoots past them.
        if (w.pullsTarget) {
          const toPlayerX = this.camera.position.x - zombieHit.group.position.x
          const toPlayerZ = this.camera.position.z - zombieHit.group.position.z
          const dist = Math.hypot(toPlayerX, toPlayerZ)
          if (dist > 0.0001) {
            const pull = Math.min(3, Math.max(0, dist - 1.2))
            zombieHit.group.position.x += (toPlayerX / dist) * pull
            zombieHit.group.position.z += (toPlayerZ / dist) * pull
          }
        }
      }

      const explosive = hit.object.userData.explosive
      if (explosive && !explosive.exploded) {
        explosive.exploded = true
        explosive.mat.color.setHex(0x0a0a0a)
        explosive.mat.emissive?.setHex(0x1a0a00)
        if (this.zombieManager) this.zombieManager.explodeAt(explosive.x, explosive.z, EXPLOSIVE_PROP_RADIUS, EXPLOSIVE_PROP_DAMAGE_MIN, EXPLOSIVE_PROP_DAMAGE_MAX)
      }

      // Safe zone practice range target - a no-consequence hit (visual
      // flash handled by World.js's buildPracticeRange/Game.js's per-frame
      // decay, sound here since WeaponSystem already owns audioEngine),
      // never damage or loot - purely a way to feel out a weapon's spread/
      // recoil without spending real ammo pressure.
      const practiceTarget = hit.object.userData.practiceTarget
      if (practiceTarget) {
        practiceTarget.onHit()
        audioEngine.playTargetDing()
      }

      // Destructible shortcut wall (see Game.js's _buildDestructibleWall) -
      // a world prop with its own health pool, same "check a userData flag,
      // call its own onHit" shape as practiceTarget above.
      const destructibleWall = hit.object.userData.destructibleWall
      if (destructibleWall) destructibleWall.onHit(w.damage * this.damageMult)

      // Interactive World batch - two more world props following the exact
      // same "check a userData flag, call its own onHit" shape.
      const scaffolding = hit.object.userData.scaffolding
      if (scaffolding && scaffolding.onHit) scaffolding.onHit(w.damage * this.damageMult)
      const tacticalLight = hit.object.userData.tacticalLight
      if (tacticalLight && tacticalLight.onHit) tacticalLight.onHit()

      if (this.onHitSurface) {
        if (hit.face) {
          this._hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
        } else {
          this._hitNormal.set(0, 1, 0)
        }
        this.onHitSurface(hit.point, this._hitNormal, !!zombieHit)
      }
    }

    for (const [zombie, info] of hitZombies) {
      zombie.lastHitWeaponId = w.id
      if (w.id === 'melee' && this.meleeVariant === 'uvbaton') {
        zombie.weaken(1500)
      } else {
        // Distance-based falloff (see the Weatie shotgun's w.damageFalloff) -
        // per-pellet damage drops off linearly from full at nearDist to a
        // reduced minimum at farDist, before being multiplied by how many
        // pellets from this shot actually connected.
        let perHitDamage = w.damage
        if (w.damageFalloff) {
          const { near, far, nearDist, farDist } = w.damageFalloff
          const t = THREE.MathUtils.clamp((info.distance - nearDist) / (farDist - nearDist), 0, 1)
          perHitDamage = THREE.MathUtils.lerp(near, far, t)
        }
        let damage = perHitDamage * info.count * this.damageMult * w.rarityMult * w.masteryMult * w.upgradeMult
        // Headshot bonus (see HEADSHOT_HEIGHT_RATIO's own note) and melee
        // combo bonus (see _fire's melee branch) - both flat multipliers,
        // stack with each other and with everything else above.
        if (info.headshot) damage *= HEADSHOT_DAMAGE_MULT
        if (w.melee) damage *= meleeComboBonus
        // Perfect Reload bonus (see PERFECT_RELOAD_WINDOW_S's own comment) -
        // a flat window after the last perfect-timed reload, stacks with
        // everything else the same way headshot/combo above do.
        if (this.perfectReloadUntil && performance.now() < this.perfectReloadUntil) damage *= PERFECT_RELOAD_DAMAGE_MULT
        // Precision Rounds attachment (see applyAttachment's w.critChance) -
        // a flat per-shot chance at a bonus multiplier, independent of and
        // stacking with the headshot check above rather than replacing it.
        if (w.critChance && Math.random() < w.critChance) damage *= 1.75
        // Instakill power-up (see Game.js's _onPickup instakill) - a flat
        // override, same as the stealth takedown check right below it.
        if (this.instakillActive) damage = 99999
        // Stealth takedown: melee, and the zombie is facing away from the
        // player (its own forward vector points opposite the direction to
        // the player) - approaching from its blind side guarantees the kill
        // regardless of remaining health, rewarding flanking over head-on.
        if (w.melee) {
          const toPlayerX = this.camera.position.x - zombie.group.position.x
          const toPlayerZ = this.camera.position.z - zombie.group.position.z
          const toPlayerLen = Math.hypot(toPlayerX, toPlayerZ)
          if (toPlayerLen > 0.0001) {
            const facingX = Math.sin(zombie.group.rotation.y)
            const facingZ = Math.cos(zombie.group.rotation.y)
            const dot = (facingX * toPlayerX + facingZ * toPlayerZ) / toPlayerLen
            if (dot < -0.5) {
              damage = Math.max(damage, zombie.health)
              if (this.onStealthTakedown) this.onStealthTakedown()
            }
          }
        }
        // Stagger Execution: meleeing a target that's already genuinely
        // stunned (the >300ms threshold matches Zombie.js's own stunned-vs-
        // hit-flinch check) guarantees the kill, rewarding a Nail Gun/
        // Sledgehammer/EMP follow-up instead of just adding raw damage.
        if (w.melee && zombie.staggerUntil - performance.now() > 300) {
          damage = Math.max(damage, zombie.health)
        }
        zombie.onHit(damage, { bypassShield: !!w.armorPierce })
        if (w.stunMs) zombie.stun(w.stunMs)
        if (this.onDamageDealt) {
          const popupY = zombie.group.position.y + zombie.getHeadWorldHeight() * (info.headshot ? 1 : 0.6)
          this.onDamageDealt(zombie.group.position.x, popupY, zombie.group.position.z, Math.round(damage), info.headshot)
        }
        // Melee Charge Bash knockback - shoves the target straight back
        // along the player-to-zombie line, same direct-position-nudge
        // approach the Harpoon Gun's pull uses in the opposite direction.
        if (chargeBash) {
          const awayX = zombie.group.position.x - this.camera.position.x
          const awayZ = zombie.group.position.z - this.camera.position.z
          const awayLen = Math.hypot(awayX, awayZ)
          if (awayLen > 0.0001) {
            zombie.group.position.x += (awayX / awayLen) * 1.8
            zombie.group.position.z += (awayZ / awayLen) * 1.8
          }
        }
        // Ricochet Rounds attachment (see applyAttachment's w.ricochet) -
        // bounces to the single nearest other living zombie within range for
        // reduced damage, reusing the same nearest-neighbor scan shape the
        // cleave pass below already does for a fixed radius.
        if (w.ricochet && !w.melee && this.zombieManager) {
          let nearest = null
          let nearestDist = 6
          for (const z of this.zombieManager.zombies) {
            if (z === zombie || z.state !== 'alive') continue
            const d = Math.hypot(z.group.position.x - zombie.group.position.x, z.group.position.z - zombie.group.position.z)
            if (d < nearestDist) {
              nearest = z
              nearestDist = d
            }
          }
          if (nearest) nearest.onHit(damage * 0.5)
        }
      }
    }
    // Fire Axe cleave (see w.cleaveRadius) - a reduced-damage swing hitting
    // every other alive zombie near the impact point, on top of the direct
    // raycast hit already handled above.
    if (w.cleaveRadius && meleeHitPoint && this.zombieManager) {
      for (const z of this.zombieManager.zombies) {
        if (z.state !== 'alive' || hitZombies.has(z)) continue
        const d = Math.hypot(z.group.position.x - meleeHitPoint.x, z.group.position.z - meleeHitPoint.z)
        if (d <= w.cleaveRadius) z.onHit(w.damage * 0.6 * this.damageMult * w.rarityMult * w.masteryMult * w.upgradeMult)
      }
    }
    if (hitZombies.size > 0) {
      this._showHitmarker()
      if (this.onZombieHit) this.onZombieHit()
    }
    void anyHit
  }

  _showHitmarker() {
    if (!this.shouldShowHitFeedback()) return
    const marker = document.getElementById('hitmarker')
    marker.classList.remove('show')
    void marker.offsetWidth
    marker.classList.add('show')
  }

  _updateHud(reloadingLabel = false) {
    const w = this.current
    const jammed = !w.melee && performance.now() / 1000 < w.jammedUntil
    this.hud.weaponName.textContent = t(this._nameKeyFor(w))
    this.hud.ammo.textContent = w.melee
      ? t('ammoMelee')
      : jammed
        ? t('ammoJammed')
        : reloadingLabel
          ? t('ammoReloading')
          : `${w.ammoInMag} / ${w.ammoReserve}`
  }
}

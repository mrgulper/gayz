// Play: survive zombies on your own map (2026-10-04). Owned by BuildMode
// (`buildMode.survival`); runs on top of Try Map (BuildTryMode), which
// already does the walking, the gun and the shooting sound.
//
// You start on the map's Player Start block (or wherever you are, if it
// has none) with a full gun. Zombies come in waves from the Zombie
// Spawner blocks (or out of sight somewhere you can be reached, if there
// are none), find their way to you through the map - round walls, up
// stairs and ladders, through open doors, and they bash closed doors open
// after a few seconds - and hit you when they're close. Loot Chests give
// ammo and health once per wave. Each wave has more zombies, a little
// faster and tougher. Your best wave per map is remembered.
//
// The way to you is a flood fill (breadth-first search) over the cells a
// zombie can stand in, started from your feet and redone every
// PATH_REFRESH seconds; each zombie walks to whichever neighboring cell is
// one step closer to you.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { SKELETON_KINDS, loadSkeletons, makeSkeleton, skeletonsReady } from './SkeletonModels.js'
import { audioEngine } from './Audio.js'
import { xpToNextLevel } from './Xp.js'
import { getKeyFor } from './Keybinds.js'
import { t } from './i18n.js'
import { BuildCamp, COIN_PER_KILL, COIN_PER_WAVE } from './BuildCamp.js'
import { PLAY_WEAPONS, DEFAULT_PLAY_WEAPON, COMING_SOON_WEAPONS, ammoFor, canPlayWeapon, weaponBars } from './PlayWeapons.js'
import { PlayFx } from './PlayFx.js'
import { openSpawnMap, closeSpawnMap, findSpawn } from './SpawnMap.js'
import { LANDMARKS, LANDMARK_REACH } from './Landmarks.js'
import { CITIES, TOWN_R, TOWN_SPAWN, townStyleAt } from './Towns.js'
import { PlayInventory, ITEMS, ARMOR_SLOTS } from './PlayInventory.js'
import { PlayDrops } from './PlayDrops.js'
import { PlayThrow } from './PlayThrow.js'
import { PlayAnimals } from './PlayAnimals.js'
import { worldSeed, isEarthWorld } from './OpenWorld.js'
import { loadEarthTerrain } from './EarthTerrain.js'
import { BOTTOM } from './Underground.js'
import { ZOMBIE_TIERS, NAME_COUNT, TAG_W, TAG_H, rollZombieTier, rollZombieName, zombieTagMaterial, zombieGlow, pulseZombieGlows } from './ZombieNames.js'
import { LEAF_DROP_CHANCE, PLAY_DEFAULTS, EXTRACTION_WAVES, EXTRACTION_HOLD, EXTRACTION_RADIUS, EXTRACTION_MIN, EXTRACTION_MAX, DEFENSE_WAVES, BOSS_HEALTH_MULT, BOSS_DAMAGE_MULT, BOSS_SIZE, BOSS_COINS, ASSIST_SHARE, ASSIST_MIN_HURT, RUSH_WAVE_BREAK, RUSH_SPAWN_GAP_MULT, REGEN_DELAY, REGEN_PER_SECOND, SKELETON_FROM_WAVE, SKELETON_CHANCE, MONSTER_FROM_WAVE, MONSTER_CHANCE, MOB_HEIGHT, SPAWN_MIN_DIST } from './PlayRules.js'
import { MONSTER_KINDS, makeMonster } from './ZombieKinds.js'
import { PlayDamageNumbers } from './PlayDamageNumbers.js'
import { speechBubble, disposeBubble, fadeBubble, bubbleSeconds } from './SpeechBubble.js'
import { SHOOT_THROUGH } from './SpecialBlocks.js'
import { openLobby } from './ServerBrowser.js'

export const CHEST_LOOT = { ammo: 60, health: 35 }
// A zombie's name tag: blocks wide up close, then the same size on screen
// past ZOMBIE_TAG_NEAR blocks.
const ZOMBIE_TAG_SIZE = 1.5
const ZOMBIE_TAG_NEAR = 10
const HEAD_MULT = 2.4
// Drawn (and shot at) MOB_HEIGHT tall; they still walk through the 1.85
// gap a door or a two-block hole leaves.
const ZOMBIE_HEIGHT = MOB_HEIGHT
const ZOMBIE_FIT_HEIGHT = 1.85
const ZOMBIE_HALF = 0.3
// Special guns (PlayWeapons.js): Flamethrower burn damage per second,
// Void Ripper slow (zombies move at this share of their speed), and the
// Tomahawk's swing width (cos of the half-angle in front of you).
const BURN_DPS = 14
const VOID_SLOW = 0.5
const CLEAVE_COS = Math.cos(0.6)
// Burning wood (2026-10-17, Gaymi: "make fire able to fire up the wood",
// picked "burns away + spreads"): a wooden block the Flamethrower reaches
// catches fire, burns for FIRE_BURN_S, may set wooden neighbours alight
// (FIRE_SPREAD chance per second each), then breaks - through Try Map's
// breakBlock, so like every block broken while playing it comes back
// when the game ends and the saved map is never changed. At most
// FIRE_MAX blocks burn at once. Zombies in a burning block catch fire.
// Fire goes out in water or rain (anything with open sky above it while
// it rains), and races through trees: leaves burn fast and catch from
// leaves and logs next to them, corners included (FIRE_TREE_SPREAD).
const FIRE_BURN_S = 6
const FIRE_SPREAD = 0.12
const FIRE_TREE_SPREAD = 0.45
const FIRE_LEAF_BURN_S = 2.5
const FIRE_RAIN_OUT_S = 1.2
const FIRE_MAX = 48
// Flamethrower fire on the ground (2026-10-25, Gaymi: "make the fire
// thrower create fire ... and the fire goes [out] on rain or water"): a
// patch of flames where the stream lands, on any surface. It burns this
// long, sets zombies walking through it on fire, can catch wood next to
// it, and rain or water puts it out.
const GROUND_FIRE_S = 8
const GROUND_FIRE_MAX = 24
const GROUND_FIRE_CATCH = 0.15 // chance a second to light a wooden block it touches
const FIRE_NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const TREE_NEIGHBOURS = []
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (dx || dy || dz) TREE_NEIGHBOURS.push([dx, dy, dz])
const ATTACK_RANGE = 0.95
const ATTACK_COOLDOWN = 1
const DOOR_BASH_TIME = 3
const WAVE_BREAK = 6
// Waves (2026-10-18, Gaymi: "more zombies spawning everywhere ... make
// them spawn anywhere, just you need to kill a certain amount of zombies
// for the next wave"): each wave needs waveSize() kills (_toSpawn counts
// the kills still needed); zombies keep coming every SPAWN_GAP until it's
// reached, up to aliveCap() at once, and ones still alive when a wave is
// done stay for the next. Spawners in the map are used when one is within
// SPAWNER_RANGE blocks of a player; otherwise zombies come from anywhere
// around you, never closer than SPAWN_MIN_DIST blocks in a straight line
// to any player (path distance alone let them pop up right beside you
// round a corner; PlayRules.js).
const SPAWN_GAP = 0.7
const SPAWN_MAX_STEPS = 70
const MAX_ALIVE = 28
const SPAWNER_RANGE = 48
// Zombies further than this from every player vanish (no kill).
const DESPAWN_DIST = 96
// Placing blocks from the inventory: how far, and what chests can give.
const PLACE_REACH = 6
const CHEST_BLOCKS = ['cobblestone', 'oakplanks', 'oaklog', 'glass', 'stonebricks', 'dirt']
// Skeletons (2026-10-16, real animated 3D models - SkeletonModels.js) join
// the waves from SKELETON_FROM_WAVE with SKELETON_CHANCE per spawn
// (PlayRules.js; never a boss). They rise out of the ground (can't move or hit for
// SKELETON_RISE seconds), walk/run, punch, and on death play their fall
// and lie for SKELETON_LIE seconds before sinking away.
const SKELETON_RISE = 1.6
const SKELETON_LIE = 54
const SKELETON_SINK = 4
// Zombie brains (2026-10-17, Gaymi: "make all zombies have a brain where
// they move different directions to attack you but still stay low ms").
// On top of the flow field (which still finds the way around walls), each
// zombie gets a role when it first moves: rushers come straight in,
// flankers curve out to your left or right while they're still a way off
// (sides alternate, so a wave closes in around you instead of in a line),
// lungers sprint at you in short bursts once close. A brain only re-thinks
// every BRAIN_THINK seconds; bumping into a wall turns flanking off for
// FLANK_STUCK seconds so it never fights the path. Bosses keep coming
// straight.
const BRAIN_THINK = 0.3
const BRAIN_ROLES = [['rusher', 0.35], ['flanker', 0.5], ['lunger', 0.15]]
const FLANK_FAR = 16 // blocks: full curve this far out...
const FLANK_NEAR = 3 // ...none this close
const FLANK_STUCK = 1.2
const LUNGE_RANGE = 6
const LUNGE_TIME = 0.8
const LUNGE_EVERY = 3.5
const LUNGE_MULT = 1.45
const SKELETON_KIND_IDS = Object.keys(SKELETON_KINDS)
const MONSTER_KIND_IDS = Object.keys(MONSTER_KINDS).filter((k) => MONSTER_KINDS[k].waves !== false)
// Skeletons and monsters: their kind's hp/speed/damage.
const kindOf = (kind) => SKELETON_KINDS[kind] || MONSTER_KINDS[kind] || null
// Dead zombies (2026-10-12, "make the dead body fall on the ground and
// slowly fade gone"): they tip over away from the shot in CORPSE_FALL
// seconds, lie still for CORPSE_LIE, then fade out over CORPSE_FADE. At most
// MAX_CORPSES at once (the oldest goes first) - each is a few draw calls.
const CORPSE_FALL = 0.45
// 2026-10-18 (Gaymi: "zombie bodies will fade naturally in 1 minute to be
// fully gone, they can also use fire to make them fade faster"): a body
// lies for CORPSE_LIE and fades over CORPSE_FADE - a minute in all - and
// one the Flamethrower (or a burning block) reaches burns away in
// CORPSE_BURN_S.
const CORPSE_LIE = 40
const CORPSE_FADE = 19.5
const CORPSE_BURN_S = 3
// How fast a body killed in the air drops to the ground (blocks/s²).
const CORPSE_GRAVITY = 28
const MAX_CORPSES = 30
const PATH_REFRESH = 0.5
// The flow field is worked out a slice at a time, at most this many ms a
// frame, so an old phone never freezes on it (one full pass took ~65ms
// on a fast computer - several hundred on a phone - every half second).
const FLOW_BUDGET_MS = 3

// Cell -> one number (x/z within +-32768 - the World Map mode's Earth
// reaches +-21600; it was +-2048, which sent zombies to the wrong spots
// out there - y within -256..255, the underground goes down to -200),
// much cheaper as a Map key than an "x,y,z" string.
function cellKey(x, y, z) {
  return ((x + 32768) * 65536 + (z + 32768)) * 512 + (y + 256)
}

function cellOf(key) {
  const y = (key % 512) - 256
  const xz = Math.floor(key / 512)
  return [Math.floor(xz / 65536) - 32768, y, (xz % 65536) - 32768]
}
const PATH_MAX_NODES = 9000
const GRAVITY = 30
const JUMP = 8.8
const CLIMB = 3
const BEST_KEY = 'buildmode-play-best'

export function waveSize(wave) {
  return 6 + wave * 3
}

// How many zombies may be out at once in a wave.
export function aliveCap(wave) {
  return Math.min(MAX_ALIVE, 8 + wave * 2)
}
// escalation (the mutator): no top speed, and health climbs faster.
export function zombieSpeed(wave, escalation = false) {
  const speed = 2.1 + wave * 0.12
  return escalation ? speed : Math.min(3.6, speed)
}
export function zombieHealth(wave, escalation = false) {
  return 100 + (wave - 1) * (escalation ? 20 : 12)
}
export function zombieDamage(wave) {
  return 9 + wave
}

// The zombies' skin, made in GayZ's own Design a Skin (2026-10-05 - the
// first one copied Minecraft's zombie colors). Loaded once.
export const ZOMBIE_SKIN_URL = '/images/npc/zombie.png'
let _skinPromise = null
function zombieSkin() {
  if (!_skinPromise) _skinPromise = loadSkinTexture(ZOMBIE_SKIN_URL)
  return _skinPromise
}

// A homepage run saved from the pause menu (Save Progress / Back to Menu,
// 2026-10-17) - the next Play carries on from it (BuildSurvival.savedRun).
export const SAVED_RUN_KEY = 'gayz-play-saved-run'
const num = (v, lo, hi, d = lo) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d)

export class BuildSurvival {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.active = false
    this.dead = false
    this.zombies = []
    this._flow = new Map()
    this._flowAt = 0
    this._ray = new THREE.Ray()
    this._v = new THREE.Vector3()
  }

  // --- start / stop ---

  // fromMenu: started from the homepage's Play (Back goes to the homepage).
  // Those runs use the Game Mode panel's picks and the Upgrades bought
  // (Game._playConfig, PlayRules.js) and count toward stats and quests;
  // the Map Editor's own Play is a plain sandbox.
  // net: a PlayNet when playing on a server with others (PlayNet.js) -
  // then the waves are endless Zombie Survival and only the host runs
  // the zombies.
  start({ fromMenu = false, net = null } = {}) {
    const bm = this.bm
    this.cfg = { ...PLAY_DEFAULTS, ...(fromMenu ? bm.game?._playConfig?.() : null) }
    // A game still connected to a server leaves it first (see PlayNet's
    // one-connection rule).
    if (this.net && this.net !== net) this.net.leave()
    this.net = net
    this.lobby?.leave()
    this.lobby = null
    // Blocks placed (id) and broken ('') this game, by cell - sent to a
    // server made later on too (PlayNet.attach).
    this._edits = new Map()
    if (!this.damageNumbers) this.damageNumbers = new PlayDamageNumbers(this)
    this.damageNumbers.clear()
    this._spawnPick = null
    if (net) {
      net.attach(this)
      this.cfg.mode = 'classic'
    }
    this._zid = 0
    this._disposeExtraction()
    if (bm.tryMode.active) bm.toggleTryMode()
    if (bm.menuOpen) bm.toggleMenu()
    this.fromMenu = fromMenu
    const start = this._findBlocks('playerstart')[0] || this._defaultStart()
    if (start) {
      const [x, y, z] = start
      bm.camera.position.set((x + 0.5) * this.B, (y + 1.62) * this.B, (z + 0.5) * this.B)
      // Face the way its arrow points (facing 0 = toward +z).
      bm._yaw = Math.PI - (bm._stairFacing.get(bm._key(x, y, z)) || 0) * (Math.PI / 2)
      bm._pitch = 0
    }
    this.active = true
    this.dead = false
    this.health = this.cfg.maxHealth
    this.maxHealth = this.cfg.maxHealth
    this.armor = this.cfg.armor
    this.coins = this.cfg.startCoins
    this.upgrades = {}
    this.stats = { kills: 0, chests: 0, headshots: 0, meleeKills: 0, skeletonKills: 0, assists: 0 }
    this.streak = 0
    this.bestStreak = 0
    this.bosses = 0
    this._bossPending = 0
    this._ended = false
    this._won = false
    this._lifeStartWave = 0
    this._startedAt = performance.now()
    this._hurtAt = 0
    this._coinsEarned = 0
    bm.tryMode.speedMult = this.cfg.moveMult
    // The gun (PlayWeapons.js): a homepage run starts with the weapon
    // picker open (last pick highlighted); the editor's own Play just
    // uses the rifle.
    const saved = bm.game?.settings?.playWeapon
    this.weaponId = fromMenu && canPlayWeapon(saved) ? saved : DEFAULT_PLAY_WEAPON
    // Ammo left in each gun you've switched away from (pause > Switch
    // Weapon), so switching never refills a gun.
    this._ammoByWeapon = {}
    // The inventory (PlayInventory.js): filled when the gun is picked (or
    // from a saved game); blocks placed this game go again when it ends.
    if (!this.inv) this.inv = new PlayInventory(this)
    this.inv.reset(this.weaponId)
    this._invRestored = false
    this.holding = null
    this._placed = new Map()
    if (!this._drops) this._drops = new PlayDrops(this)
    this._drops.clear()
    // Day and night, and the weather, in games from the homepage.
    if (fromMenu) bm.sky?.forGame(true)
    this._nextShotAt = 0
    if (!this._fx) this._fx = new PlayFx(bm.scene, this.B)
    if (!this.throws) this.throws = new PlayThrow(this)
    this.throws.clear()
    if (!this.animals) this.animals = new PlayAnimals(this)
    this.animals.clear()
    this._fires = new Map()
    this._groundFires = []
    this.mag = this.magSize()
    this.reserve = this._startReserve()
    this.wave = 0
    this.kills = 0
    this._toSpawn = 0
    this._spawnTimer = 0
    this._breakTimer = 2
    this._reloadLeft = 0
    this._chestsUsed = new Set()
    this._flow = new Map()
    this._flowJob = null
    this._flowAt = 0
    bm.toggleTryMode()
    // Map 3's walled camp is a safe zone with NPCs (BuildCamp.js).
    this.camp?.dispose()
    const zone = bm.activeSlot === 'map3' ? bm._map3Base().map.safeZone : null
    this.camp = zone ? new BuildCamp(this, zone, this.B) : null
    this._ensureHud()
    this._hud.style.display = 'block'
    this._overEl.style.display = 'none'
    this._renderHud()
    document.getElementById('build-mode-play-btn-label')?.replaceChildren(t('buildModePlayStopBtn'))
    // A run saved from the pause menu carries on, if it was on the same
    // Game Mode and difficulty (otherwise it's dropped).
    const savedRun = fromMenu && !net ? BuildSurvival.savedRun() : null
    const resume = savedRun && savedRun.mode === String(this.cfg.mode || '') && savedRun.difficulty === String(this.cfg.difficulty || 'normal') ? savedRun : null
    if (savedRun && !resume) BuildSurvival.clearSavedRun()
    if (resume) this._resumeRun(resume)
    // World Map mode (a solo game from the homepage): the land follows the
    // real Earth, and you pick where on it to start first (SpawnMap.js),
    // then the weapon. The other modes start in the city camp as before.
    else if (this.cfg.mode === 'worldMap' && fromMenu && !net && bm.world?.active) {
      bm.world.setEarth(true)
      this._chooseSpawn()
    }
    else if (fromMenu) {
      // Joined through an invite link: start where the host did (once
      // a World Map game's real land has loaded).
      if (net?.world?.pick) {
        const pick = net.world.pick
        if (isEarthWorld()) loadEarthTerrain().then(() => { if (this.active) this._spawnAt(pick) })
        else this._spawnAt(pick)
      }
      this._openWeaponPicker()
    }
    else this._message(t('buildPlayGetReady'))
    zombieSkin().then((skin) => { this._skin = skin; this._warmShaders() }).catch(() => { this._skin = null })
    loadSkeletons().then((ok) => { if (ok) this._warmShaders(true) })
    // A solo game from the homepage is ready for friends straight away: its
    // address is the invite link (PlayNet's lobby).
    if (fromMenu && !net) openLobby(bm.game, this).catch(() => { /* offline: just solo */ })
  }

  // Gets the graphics card ready to draw zombies (and skeletons) while the
  // run starts, instead of on the frame the first one appears - that frame
  // froze for a moment on slow devices (2026-10-17 lag hunt). A skeleton is
  // only added for the moment the shaders are prepared, then removed.
  _warmShaders(skeleton = false) {
    const renderer = this.bm.renderer
    if (!this.active || !renderer?.compileAsync) return
    let skel = null
    if (skeleton) {
      skel = makeSkeleton(Object.keys(SKELETON_KINDS)[0], ZOMBIE_HEIGHT * this.B)
      this.bm.scene.add(skel.root)
    } else if (!this._zombieBatch()) return
    renderer.compileAsync(this.bm.scene, this.bm.camera).catch(() => {}).finally(() => {
      if (!skel) return
      this.bm.scene.remove(skel.root)
      // Kept (not disposed) until the run ends: disposing its materials now
      // would throw the prepared shader away again.
      this._warmSkel?.dispose()
      this._warmSkel = skel
    })
  }

  // leaveTry: false when Try Map itself is being left (T / Escape menu).
  // suspend: the run was just saved to carry on later (the pause menu's
  // Back to Menu), so it isn't counted yet.
  stop({ leaveTry = true, suspend = false } = {}) {
    if (!this.active) return
    // Leaving a run before dying still counts it (stats, quests).
    if (!this.dead && !suspend) this._endRun(false)
    this.active = false
    this.net?.leave()
    this.net = null
    this.lobby?.leave()
    this.lobby = null
    this.damageNumbers?.clear()
    if (this._ownBubble) disposeBubble(this._ownBubble.sprite)
    this._ownBubble = null
    this.bm.tryMode.speedMult = 1
    this.camp?.dispose()
    this.camp = null
    this._disposeExtraction()
    for (const z of this.zombies) this._removeZombie(z)
    this.zombies = []
    this._clearCorpses()
    this._fx?.clear()
    this.throws?.clear()
    this.animals?.clear()
    this._fires?.clear()
    this.bm.spectate?.exit()
    // Blocks placed this game go again (the saved map never changes).
    if (this._placed?.size) {
      const bm = this.bm
      bm._suppressUndoRecording = true
      for (const [key, type] of this._placed) {
        const [x, y, z] = key.split(',').map(Number)
        if (bm.getBlockAt(x, y, z) === type) bm.removeBlock(x, y, z)
      }
      bm._suppressUndoRecording = false
      this._placed.clear()
    }
    this.inv?.show(false)
    this._drops?.clear()
    this.holding = null
    this.bm.sky?.forGame(false)
    this.bm.world?.setEarth?.(false)
    this._disposeZombieBatch()
    if (this._hud) this._hud.style.display = 'none'
    if (this._overEl) this._overEl.style.display = 'none'
    this._closeWeaponPicker()
    closeSpawnMap()
    document.getElementById('build-mode-play-btn-label')?.replaceChildren(t('buildModePlayBtn'))
    if (leaveTry && this.bm.tryMode.active) this.bm.toggleTryMode()
  }

  // No Player Start: the nearest open spot under the sky to where the
  // camera is (so you don't start on a roof or inside a wall).
  _defaultStart() {
    const bm = this.bm
    const cx = Math.floor(bm.camera.position.x / this.B)
    const cz = Math.floor(bm.camera.position.z / this.B)
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of r ? [-r, r] : [0]) {
          for (const [x, z] of [[cx + dx, cz + dz], [cx + dz, cz + dx]]) {
            let top = null
            for (let y = 60; y >= -1; y--) {
              if (bm.getBlockAt(x, y, z)) {
                top = y
                break
              }
            }
            if (top === null || top > 1 || !this._standable(x, top + 1, z)) continue
            return [x, top + 1, z]
          }
        }
      }
    }
    return null
  }

  get weapon() {
    return PLAY_WEAPONS[this.weaponId] || PLAY_WEAPONS[DEFAULT_PLAY_WEAPON]
  }

  // Upgrades bought from the camp's Upgrader (BuildCamp.js): each Mag
  // level adds a third of the gun's own magazine (10 for the rifle).
  // The spare ammo a gun starts with - more with the Ammo Belt / Bandolier
  // upgrades (cfg.ammoMult). Melee's is Infinity, which stays Infinity.
  _startReserve() {
    return Math.round(this.weapon.reserve * (this.cfg?.ammoMult ?? 1))
  }

  magSize() {
    const base = this.weapon.mag
    if (!Number.isFinite(base)) return Infinity
    return base + Math.max(1, Math.round(base / 3)) * (this.upgrades?.mag || 0)
  }

  _reloadTime() {
    return this.weapon.reload * (1 - 0.2 * (this.upgrades?.reload || 0)) * (this.cfg?.reloadMult ?? 1)
  }

  // --- the spawn map (homepage solo games) ---

  async _chooseSpawn() {
    this._picking = true
    this._spawnPicking = true
    // (The real land loads while the map is open.)
    const [pick] = await Promise.all([openSpawnMap(), loadEarthTerrain()])
    this._spawnPicking = false
    if (!this.active) return
    if (pick) this._spawnAt(pick)
    // (A weapon may already have been picked while the map was open.)
    if (this._picking) this._openWeaponPicker()
  }

  // Moves you to the nearest world spot like the picked Earth place.
  _spawnAt(pick) {
    const spot = findSpawn(pick.lat, pick.lon, pick.biome)
    if (!spot) return false
    // Kept for Invite Friends (players joining start at the same place).
    this._spawnPick = { lat: pick.lat, lon: pick.lon, biome: pick.biome, country: pick.country || '', city: pick.city || '' }
    const bm = this.bm
    const tm = bm.tryMode
    // Near a real city: its block town, you on the main avenue facing the
    // middle, with the city's landmark in the plaza (or just past the
    // town for the huge ones). Elsewhere: the country's landmark, a short
    // walk north.
    // A city from the spawn map that isn't one of CITIES gets a town in the
    // look of its part of the world (no landmark).
    const city = pick.city && (CITIES.find((c) => c.name === pick.city) || { name: pick.city, lat: pick.lat, lon: pick.lon, style: townStyleAt(pick.lat, pick.lon, pick.biome) })
    const lm = city ? (city.landmark ? Object.values(LANDMARKS).find((l) => l.kind === city.landmark) : null) : LANDMARKS[pick.country]
    let landmark = null
    let town = null
    if (city) {
      const cx = spot.x
      const cz = spot.z - TOWN_SPAWN
      const reach = lm ? LANDMARK_REACH[lm.kind] : 0
      const inside = lm && reach <= 20
      if (lm && bm.world.addLandmark(lm.kind, cx, inside ? cz : cz - TOWN_R - reach - 8, lm.key)) landmark = t(lm.key)
      if (bm.world.addTown(city.style, cx, cz, inside ? reach + 4 : 10, city.name)) town = city.name
    } else if (lm) {
      const d = LANDMARK_REACH[lm.kind] + 24
      if (bm.world.addLandmark(lm.kind, spot.x, spot.z - d, lm.key)) landmark = t(lm.key)
    }
    // Grows the land there right now (your column and its neighbours).
    bm.world.update([{ x: spot.x + 0.5, z: spot.z + 0.5 }])
    let top = null
    for (let y = 160; y > BOTTOM && top === null; y--) if (bm.getBlockAt(spot.x, y, spot.z)) top = y
    if (top === null) return false
    tm.pos.set(spot.x + 0.5, top + 1, spot.z + 0.5)
    tm.vel?.set(0, 0, 0)
    tm._spawn.copy(tm.pos)
    // Paths and spawn spots start over from here (they were still around
    // the camp - zombies spawned there, thousands of blocks away).
    this._flow = new Map()
    this._flowJob = null
    this._flowKey = null
    this._flowAt = 0
    this._spawnedFar = true
    const name = t(`biome${spot.biome.charAt(0).toUpperCase()}${spot.biome.slice(1)}`)
    if (landmark || town) bm._yaw = 0
    const n = Math.round(Math.hypot(spot.x, spot.z))
    const text = town ? t('spawnArrivedCity', { city: town, n }) : landmark ? t('spawnArrivedLandmark', { biome: name, n, name: landmark }) : t('spawnArrived', { biome: name, n })
    this._message(text, landmark || town ? 6 : undefined)
    return true
  }

  // --- weapon picker (homepage runs) ---

  // switching: opened from the pause menu's Switch Weapon mid-run.
  _openWeaponPicker(switching = this._switching) {
    this._picking = true
    this._switching = !!switching
    let el = document.getElementById('play-weapon-pick')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-weapon-pick'
      document.body.appendChild(el)
      el.addEventListener('click', (e) => {
        const card = e.target.closest('[data-play-weapon]')
        if (card) this._pickWeapon(card.dataset.playWeapon)
      })
    }
    const game = this.bm.game
    // The pictures are drawn in the background after the page loads; if
    // they aren't done yet the cards fill in when they are.
    if (game && !game._weaponThumbCache && game._weaponThumbnailsReady) {
      game._weaponThumbnailsReady().then(() => { if (this._picking) this._openWeaponPicker() })
    }
    const thumbs = game?._weaponThumbCache || {}
    // Coming Soon guns go last, together (2026-10-18, Gaymi).
    const ids = (game?.weapons?.getSummary?.() || []).filter((w) => PLAY_WEAPONS[w.id]).sort((a, b) => COMING_SOON_WEAPONS.has(a.id) - COMING_SOON_WEAPONS.has(b.id))
    const bar = (label, v) => `<span class="pwp-bar"><span class="pwp-bar-label">${label}</span><span class="pwp-bar-track"><span style="width:${Math.round(v * 100)}%"></span></span></span>`
    el.innerHTML = `<div class="pwp-card-box">
      <h2>${t(this._switching ? 'playSwitchWeaponTitle' : 'playPickWeaponTitle')}</h2>
      <p class="pwp-hint">${t(this._switching ? 'playSwitchWeaponHint' : 'playPickWeaponHint')}</p>
      <div class="pwp-grid">${ids.map((w) => {
        const b = weaponBars(w.id)
        if (COMING_SOON_WEAPONS.has(w.id)) {
          return `<button type="button" class="pwp-weapon pwp-soon" disabled aria-disabled="true">
          <span class="pwp-name">${t(w.nameKey)}</span>
          ${thumbs[w.id] ? `<img alt="" draggable="false" src="${thumbs[w.id]}" />` : '<span class="pwp-noimg"></span>'}
          <span class="weapon-soon-tag">${t('crateComingSoonTag')}</span>
        </button>`
        }
        return `<button type="button" class="pwp-weapon${w.id === this.weaponId ? ' active' : ''}" data-play-weapon="${w.id}">
          <span class="pwp-name">${t(w.nameKey)}</span>
          ${thumbs[w.id] ? `<img alt="" draggable="false" src="${thumbs[w.id]}" />` : '<span class="pwp-noimg"></span>'}
          ${bar(t('playStatDamage'), b.damage)}${bar(t('playStatFireRate'), b.rate)}${bar(t('playStatAmmo'), b.ammo)}
        </button>`
      }).join('')}</div>
    </div>`
    el.style.display = 'flex'
    // The cursor has to be free to click a card.
    try { document.exitPointerLock() } catch { /* not locked */ }
  }

  _closeWeaponPicker() {
    this._picking = false
    this._switching = false
    const el = document.getElementById('play-weapon-pick')
    if (el) el.style.display = 'none'
  }

  _pickWeapon(id) {
    if (!canPlayWeapon(id) || !this.active) return
    if (this._spawnPicking) closeSpawnMap()
    const switching = this._switching
    const oldId = this.weaponId
    if (switching) this._ammoByWeapon[this.weaponId] = { mag: this.mag, reserve: this.reserve }
    this.weaponId = id
    this.bm.game?._setPlayWeapon?.(id)
    this._nextShotAt = 0
    this._reloadLeft = 0
    // Knives never run out, so there's nothing to keep for them.
    const kept = switching && Number.isFinite(this.weapon.mag) ? this._ammoByWeapon[id] : null
    this.mag = kept ? Math.min(kept.mag, this.magSize()) : this.magSize()
    this.reserve = kept ? kept.reserve : this._startReserve()
    this._closeWeaponPicker()
    // The inventory: a new game's starting kit, or this gun into the hand.
    if (!switching && !this._invRestored) this.inv?.reset(id)
    else if (!this._fromInventory) this.inv?.bringGun(id, oldId)
    this.holding = null
    this.bm.tryMode._showGun()
    if (this.bm.tryMode._gun) this.bm.tryMode._gun.visible = true
    const name = t(this.bm.game?.weapons?.getSummary?.().find((w) => w.id === id)?.nameKey || 'weaponRifle')
    if (switching || !this._spawnedFar) this._message(switching ? t('playWeaponSwitched', { name }) : t('buildPlayGetReady'))
    this._spawnedFar = false
    this._renderHud()
    // This click is a real user gesture, so the mouse can be captured again
    // (not while the inventory is open - you're still using the mouse).
    if (!this.bm.pickerOpen) {
      try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // A gun picked from the inventory's hotbar: switch to it (each gun
  // keeps its own ammo).
  _equipWeapon(id) {
    this._switching = true
    this._fromInventory = true
    this._pickWeapon(id)
    this._fromInventory = false
    this._switching = false
  }

  // --- Saved runs: the pause menu's Save Progress keeps where you are -
  // wave, kills, coins, health, upgrades, your gun and ammo, where you
  // stand and the land around the city - and the next Play from the
  // homepage carries on from there (the wave you were on starts again).
  // Never on a server. Counted (stats, quests) once, when the run ends. ---
  saveRun() {
    if (!this.active || !this.fromMenu || this.net || this.dead) return false
    const tm = this.bm.tryMode
    const run = {
      v: 1,
      at: Date.now(),
      mode: String(this.cfg.mode || ''),
      difficulty: String(this.cfg.difficulty || 'normal'),
      wave: Math.max(1, this.wave),
      kills: this.kills,
      coins: this.coins,
      coinsEarned: this._coinsEarned,
      health: this.health,
      armor: this.armor,
      upgrades: { ...this.upgrades },
      stats: { ...this.stats },
      bestStreak: this.bestStreak,
      bosses: this.bosses,
      weaponId: this.weaponId,
      mag: this.mag,
      reserve: this.reserve,
      ammoByWeapon: this._ammoByWeapon,
      inv: this.inv?.serialize(),
      seconds: (performance.now() - this._startedAt) / 1000,
      claimed: (this.camp?.quests || []).filter((q) => q.claimed).map((q) => q.id),
      pos: { x: tm.pos.x, y: tm.pos.y, z: tm.pos.z },
      yaw: this.bm._yaw,
      seed: this.bm.world?.active ? worldSeed() : null,
    }
    try {
      localStorage.setItem(SAVED_RUN_KEY, JSON.stringify(run))
      return true
    } catch {
      return false
    }
  }

  // The saved run, checked over (it's from storage, so anything could be
  // in it), or null.
  static savedRun() {
    let d
    try {
      d = JSON.parse(localStorage.getItem(SAVED_RUN_KEY) || 'null')
    } catch {
      return null
    }
    if (!d || typeof d !== 'object' || d.v !== 1) return null
    const ints = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k]) => /^\w{1,32}$/.test(k)).map(([k, v]) => [k, Math.round(num(v, 0, 1e6))]))
    const pos = d.pos && typeof d.pos === 'object' && [d.pos.x, d.pos.y, d.pos.z].every((v) => Number.isFinite(v) && Math.abs(v) < 1e5) ? { x: d.pos.x, y: d.pos.y, z: d.pos.z } : null
    return {
      mode: String(d.mode || '').slice(0, 40),
      difficulty: String(d.difficulty || 'normal').slice(0, 20),
      wave: Math.round(num(d.wave, 1, 9999, 1)),
      kills: Math.round(num(d.kills, 0, 1e7)),
      coins: Math.round(num(d.coins, 0, 1e9)),
      coinsEarned: Math.round(num(d.coinsEarned, 0, 1e9)),
      health: num(d.health, 1, 1e6, 100),
      armor: num(d.armor, 0, 100),
      upgrades: ints(d.upgrades),
      stats: ints(d.stats),
      bestStreak: Math.round(num(d.bestStreak, 0, 1e7)),
      bosses: Math.round(num(d.bosses, 0, 1e6)),
      weaponId: canPlayWeapon(d.weaponId) ? d.weaponId : DEFAULT_PLAY_WEAPON,
      inv: d.inv && typeof d.inv === 'object' ? d.inv : null,
      mag: Math.round(num(d.mag, 0, 1e5)),
      reserve: Math.round(num(d.reserve, 0, 1e7)),
      ammoByWeapon: Object.fromEntries(Object.keys(PLAY_WEAPONS).filter((id) => d.ammoByWeapon?.[id]).map((id) => [id, {
        mag: Math.round(num(d.ammoByWeapon[id].mag, 0, 1e5)),
        reserve: Math.round(num(d.ammoByWeapon[id].reserve, 0, 1e7)),
      }])),
      seconds: num(d.seconds, 0, 1e7),
      claimed: Array.isArray(d.claimed) ? d.claimed.filter((id) => typeof id === 'string').slice(0, 50) : [],
      pos,
      yaw: num(d.yaw, -1e3, 1e3, 0),
      seed: Number.isFinite(d.seed) ? d.seed : null,
    }
  }

  static clearSavedRun() {
    try {
      localStorage.removeItem(SAVED_RUN_KEY)
    } catch {
      // Nothing saved to clear.
    }
  }

  _resumeRun(r) {
    this.weaponId = r.weaponId
    this._ammoByWeapon = r.ammoByWeapon || {}
    if (r.inv && this.inv.restore(r.inv)) {
      this._invRestored = true
      this.inv.apply()
      this.inv.renderHotbar()
    } else this.inv.reset(r.weaponId)
    this.bm.tryMode._showGun()
    this.wave = r.wave - 1
    this.kills = r.kills
    this.coins = r.coins
    this._coinsEarned = r.coinsEarned
    this.upgrades = r.upgrades
    this.stats = { ...this.stats, ...r.stats }
    this.bestStreak = r.bestStreak
    this.bosses = r.bosses
    this.health = Math.min(this.maxHealth, r.health)
    this.armor = r.armor
    this.mag = Math.min(r.mag, this.magSize())
    this.reserve = r.reserve
    this._startedAt = performance.now() - r.seconds * 1000
    for (const q of this.camp?.quests || []) q.claimed = r.claimed.includes(q.id)
    if (r.pos) {
      this.bm.tryMode.pos.set(r.pos.x, r.pos.y, r.pos.z)
      this.bm._yaw = r.yaw
    }
    this._message(t('playResumed', { n: r.wave }))
    this._renderHud()
  }

  _damageMult() {
    // x a Strength Totem's boost (BuildSpecials.js).
    return (1 + 0.25 * (this.upgrades?.damage || 0)) * (this.cfg?.damageMult ?? 1) * this.bm.specials.damageMult()
  }

  // Coins come in through here, so Loot Rush doubles them all.
  _earn(n) {
    const got = Math.round(n * (this.cfg?.coinMult ?? 1))
    this.coins += got
    this._coinsEarned += got
  }

  // Tells Game.js about a homepage run (stats, quests, achievements).
  _report(type, data) {
    if (!this.fromMenu) return null
    return this.bm.game?._onPlayEvent?.(type, data) || null
  }

  // Remembered until the map changes (the open world makes the map big -
  // reading every block for each zombie spawned showed up as a hitch).
  _findBlocks(type) {
    const cache = this._foundBlocks || (this._foundBlocks = new Map())
    const hit = cache.get(type)
    if (hit && hit.version === this.bm._mapVersion) return hit.out
    const out = []
    for (const [key, t2] of this.bm._blocks) if (t2 === type) out.push(key.split(',').map(Number))
    cache.set(type, { version: this.bm._mapVersion, out })
    return out
  }

  // Left (-1) to right (1) of where you look, for a sound at (x, z) -
  // Settings > Audio > Positional Audio uses it (Audio.js, centred when
  // that's off).
  _panTo(x, z) {
    const p = this.bm.tryMode.pos
    const dx = x - p.x
    const dz = z - p.z
    const d = Math.hypot(dx, dz)
    if (d < 0.5) return 0
    const yaw = this.bm._yaw
    return Math.max(-1, Math.min(1, (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d))
  }

  // --- HUD ---

  _ensureHud() {
    if (this._hud) return
    const hud = document.createElement('div')
    hud.id = 'build-play-hud'
    hud.innerHTML = `
      <div id="build-play-wave"><span class="top-bar-ground" aria-hidden="true"></span><span class="top-bar-ground" aria-hidden="true"></span><span id="build-play-wave-text"></span></div>
      <div id="build-play-msg"></div>
      <div id="build-play-health"><div id="build-play-health-fill"></div><span id="build-play-health-text"></span></div>
      <div id="build-play-ammo"></div>
      <div id="build-play-hurt"></div>`
    document.body.appendChild(hud)
    this._hud = hud
    const over = document.createElement('div')
    over.id = 'build-play-over'
    over.innerHTML = `
      <div class="build-play-over-card">
        <h2 id="build-play-over-title"></h2>
        <p id="build-play-over-text"></p>
        <p id="build-play-over-best"></p>
        <div id="build-play-xp" style="display: none">
          <div class="build-play-xp-row"><b id="build-play-xp-level"></b><span id="build-play-xp-num"></span></div>
          <div class="build-play-xp-track"><i id="build-play-xp-fill"></i></div>
        </div>
        <div class="build-play-over-btns">
          <button type="button" id="build-play-again-btn"></button>
          <button type="button" id="build-play-back-btn"></button>
        </div>
      </div>
      <div id="build-play-levelup" role="dialog" aria-modal="true" style="display: none">
        <div class="build-play-levelup-card">
          <p id="build-play-levelup-title"></p>
          <div id="build-play-levelup-num"></div>
          <p id="build-play-levelup-reward"></p>
          <button type="button" id="build-play-levelup-ok"></button>
        </div>
      </div>`
    document.body.appendChild(over)
    this._overEl = over
    over.querySelector('#build-play-levelup-ok').addEventListener('click', () => {
      over.querySelector('#build-play-levelup').style.display = 'none'
    })
    over.querySelector('#build-play-again-btn').addEventListener('click', () => {
      // On a server: back on your feet in the same game.
      if (this.net && !this.net.closed) {
        this._respawn()
        try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
        return
      }
      const fromMenu = this.fromMenu
      this.stop()
      this.start({ fromMenu })
      try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    })
    over.querySelector('#build-play-back-btn').addEventListener('click', () => {
      const fromMenu = this.fromMenu
      this.stop()
      if (fromMenu && this.bm.game?._exitBuildMode) this.bm.game._exitBuildMode()
    })
  }

  _message(text, seconds = 2.5) {
    const el = document.getElementById('build-play-msg')
    if (!el) return
    el.textContent = text
    el.style.opacity = '1'
    this._msgLeft = seconds
  }

  _renderHud() {
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    // The kills this wave still needs.
    const alive = this._toSpawn
    const mode = this.cfg?.mode
    // World Map: no waves - where you are and how long you've explored.
    if (this.cfg?.noZombies) {
      const s = Math.floor((performance.now() - (this._startedAt || 0)) / 1000)
      set('build-play-wave-text', `${t('topBarModeWorldMap')} · ${t('buildPlayTime', { t: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` })}`)
    }
    const waveText = mode === 'zombieDefense' ? t('buildPlayWaveOf', { n: Math.max(1, this.wave), max: DEFENSE_WAVES }) : t('buildPlayWave', { n: Math.max(1, this.wave) })
    const secs = Math.floor((performance.now() - (this._startedAt || 0)) / 1000)
    const timeText = mode === 'zombieRush' ? ` · ${t('buildPlayTime', { t: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}` : ''
    let extractText = ''
    if (mode === 'zombieExtraction') {
      const ex = this._extract
      if (!ex) extractText = ` · ${t('extractionAfterWave', { n: EXTRACTION_WAVES })}`
      else if (ex.hold > 0) extractText = ` · ${t('extractionHolding', { s: Math.ceil(EXTRACTION_HOLD - ex.hold) })}`
      else extractText = ` · ${t('extractionDistance', { n: Math.round(ex.dist ?? 0) })}`
    }
    const serverText = this.net && !this.net.closed ? ` · ${t('serverHudLine', { name: this.net.name, n: this.net.players.size + 1 })}` : ''
    // Between waves: when the next one comes, not "0 left" (that read as
    // a wave over with nothing killed).
    const leftText = alive === 0 && this._breakTimer > 0 ? t('buildPlayNextWaveIn', { n: Math.ceil(this._breakTimer) }) : t('buildPlayZombiesLeft', { n: alive })
    if (!this.cfg?.noZombies) set('build-play-wave-text', `${waveText} · ${leftText} · ${t('buildPlayKills', { n: this.kills })}${this.camp ? ` · ${t('campCoins', { n: this.coins })}` : ''}${timeText}${extractText}${serverText}`)
    const fill = document.getElementById('build-play-health-fill')
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (this.health / (this.maxHealth || 100)) * 100))}%`
    set('build-play-health-text', `${Math.max(0, Math.ceil(this.health))}${this.armor > 0 ? ` + ${Math.ceil(this.armor)}` : ''}`)
    // The Flamethrower burns fuel, not bullets (2026-10-17): a fuel tank
    // bar and how many spare tanks are left instead of "99 / 300".
    const ammoEl = document.getElementById('build-play-ammo')
    if (this.weapon.fuel && ammoEl) {
      const pct = Math.max(0, Math.min(100, (this.mag / (this.magSize() || 1)) * 100))
      const tanks = Math.floor(this.reserve / (this.weapon.mag || 1))
      const label = this._reloadLeft > 0 ? t('buildPlayRefueling') : t('buildPlayFuel')
      ammoEl.innerHTML = `<span class="fuel-tank"><span class="fuel-label">${label}</span><span class="fuel-bar"><span style="width:${pct.toFixed(1)}%"></span></span><span class="fuel-spare">${t('buildPlayFuelSpare', { n: tanks })}</span></span>`
      return
    }
    const ammo = Number.isFinite(this.mag) ? `${this.mag} / ${this.reserve}` : t(this.bm.game?.weapons?.getSummary?.().find((w) => w.id === this.weaponId)?.nameKey || 'weaponMelee')
    set('build-play-ammo', this._reloadLeft > 0 ? t('buildPlayReloading') : ammo)
  }

  // --- shooting (BuildTryMode.fire calls this first) ---

  // false when the gun is empty or reloading (no shot happens).
  tryFire() {
    if (!this.active || this.dead) return true
    if (this._picking) return false
    // Holding a block or an item instead of a gun: no shot (a health pack
    // or ammo box is used instead).
    if (this.holding) {
      if (this.holding.kind === 'item') this.inv.useHeld()
      return false
    }
    if (this._reloadLeft > 0) return false
    // Each gun's own fire rate.
    const now = performance.now()
    if (now < this._nextShotAt) return false
    this._nextShotAt = now + this.weapon.rate * 1000
    if (!Number.isFinite(this.mag)) return true
    if (this.mag <= 0) {
      audioEngine.playLowAmmoTick?.()
      if (this.reserve > 0) this.reload()
      else this._message(t('buildPlayNoAmmo'))
      return false
    }
    this.mag--
    this._renderHud()
    return true
  }

  // The shot itself: the nearest zombie in front of the gun, if nothing
  // solid is in the way first. Returns true if a zombie took it.
  shoot() {
    if (!this.active || this.dead) return false
    const bm = this.bm
    const B = this.B
    const w = this.weapon
    // Knife and Tomahawk while aiming (right-click held): thrown, not
    // swung (PlayThrow.js).
    if (w.melee && bm.tryMode.aiming && this.throws) return this.throws.throw()
    // Echo Stones hear gunfire (BuildSpecials.js).
    if (!w.melee) bm.specials.onShot(bm.tryMode.pos)
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const center = bm._raycaster.ray.clone()
    const wall = bm._raycastGridAligned(SHOOT_THROUGH)
    const reach = Math.min(wall ? wall.t : Infinity, Number.isFinite(w.range) ? w.range * B : Infinity)
    const damage = w.damage * this._damageMult()
    const hits = new Map()
    const add = (z, amount) => hits.set(z, (hits.get(z) || 0) + amount)
    const box = new THREE.Box3()
    const hitPoint = this._v
    let impact = null
    // The Flamethrower's fire rolls out from just in front of you (below
    // the middle of the screen, where the nozzle is), hit or miss.
    if (w.burn) {
      // From the nozzle's side of the screen (right and low), a block and
      // a half out, so the nearest flames never fill the view.
      const side = new THREE.Vector3().crossVectors(center.direction, bm.camera.up).normalize()
      const from = center.origin.clone().addScaledVector(center.direction, 1.5 * B).addScaledVector(side, 0.3 * B)
      from.y -= 0.4 * B
      this._fx?.flameStream(from, center.direction, Math.min(w.range, reach / B))
      // The wall the flames reach catches fire if it's wood, and the
      // flames leave a fire burning where they land.
      if (wall && wall.t <= w.range * B && wall.existingBlock) {
        this.ignite(...wall.existingBlock)
        if (wall.placeAt) this.groundFire(...wall.placeAt)
      }
      // Bodies in the flames burn away.
      const reachF = Math.min(w.range * B, reach)
      for (const c of [...(this._corpses || []), ...(this._boneCorpses || [])]) {
        const d = c.group.position.clone().sub(center.origin)
        const len = d.length()
        if (len < reachF + 0.5 * B && d.dot(center.direction) / (len || 1) > Math.cos(0.45)) c.burnLeft ??= CORPSE_BURN_S
      }
    }
    // One ray per pellet (shotgun, flamethrower), fanned out by spread.
    const pellets = w.pellets || 1
    const ray = center.clone()
    for (let p = 0; p < pellets; p++) {
      ray.copy(center)
      if (p > 0 || pellets > 1) {
        // Aiming down the sights tightens the spread.
        const spread = (w.spread || 0) * (1 - 0.45 * (bm.tryMode.aimAmount || 0))
        ray.direction.x += (Math.random() - 0.5) * 2 * spread
        ray.direction.y += (Math.random() - 0.5) * 2 * spread
        ray.direction.z += (Math.random() - 0.5) * 2 * spread
        ray.direction.normalize()
      }
      // Every zombie on this ray before the wall, nearest first. Most
      // guns stop at the first; the Crossbow and AWP go through
      // (w.pierce zombies).
      const onRay = []
      for (const z of this.zombies) {
        const half = ZOMBIE_HALF * (z.size || 1) * (z.wide || 1)
        const height = ZOMBIE_HEIGHT * (z.size || 1) * (z.tall || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hitPoint)) continue
        const d = hitPoint.distanceTo(ray.origin)
        if (d < reach) onRay.push({ z, d, head: hitPoint.y / B > z.y + height * 0.76 })
      }
      onRay.sort((a, b) => a.d - b.d)
      const struck = onRay.slice(0, w.pierce || 1)
      for (const hit of struck) {
        if (hit.head) this.stats.headshots++
        add(hit.z, damage * (hit.head ? HEAD_MULT * (this.cfg?.headshotMult ?? 1) : 1))
      }
      if (struck.length) {
        if (!impact) impact = ray.at(struck[0].d, new THREE.Vector3())
      } else if (w.blast && !impact && Number.isFinite(reach)) {
        impact = ray.at(reach, new THREE.Vector3())
      }
    }
    // Tomahawk: the swing hits up to w.cleave zombies in front of you
    // within reach, not just the one in the middle of the screen.
    if (w.cleave) {
      const eye = center.origin
      const dir = center.direction
      const near = []
      for (const z of this.zombies) {
        if (hits.has(z)) continue
        const cx = z.x * B - eye.x
        const cy = (z.y + ZOMBIE_HEIGHT * 0.5 * (z.size || 1) * (z.tall || 1)) * B - eye.y
        const cz = z.z * B - eye.z
        const d = Math.hypot(cx, cy, cz)
        if (d > reach + ZOMBIE_HALF * B || (cx * dir.x + cy * dir.y + cz * dir.z) / (d || 1) < CLEAVE_COS) continue
        near.push({ z, d })
      }
      near.sort((a, b) => a.d - b.d)
      for (const n of near.slice(0, Math.max(0, w.cleave - hits.size))) add(n.z, damage)
    }
    // Rockets and grenades: everything near where it lands is hurt too,
    // less the further away.
    if (w.blast && impact) {
      try { audioEngine.playExplosion?.() } catch { /* no audio */ }
      // Pulled back towards you a little so the fireball isn't half
      // inside the wall it hit.
      this._fx?.explode(impact.clone().addScaledVector(center.direction, -0.8 * B), w.blast)
      // The screen shakes, harder the closer it went off.
      const near = 1 - impact.distanceTo(center.origin) / (14 * B)
      if (near > 0 && !document.body.classList.contains('reduce-flashing')) {
        const view = bm.renderer.domElement
        view.style.setProperty('--boom', `${(3 + near * 9).toFixed(1)}px`)
        view.classList.remove('boom-shake')
        void view.offsetWidth
        view.classList.add('boom-shake')
      }
      const radius = w.blast * B
      for (const z of this.zombies) {
        const cx = z.x * B
        const cy = (z.y + ZOMBIE_HEIGHT * 0.5 * (z.size || 1) * (z.tall || 1)) * B
        const cz = z.z * B
        const d = Math.hypot(cx - impact.x, cy - impact.y, cz - impact.z)
        if (d < radius) add(z, damage * 0.8 * (1 - d / radius))
      }
    }
    // No zombie hit: maybe an animal (PlayAnimals.js).
    if (!hits.size) return !!this.animals?.hitRay(center, reach, damage, this.weaponId)
    if (w.slow && impact) this._fx?.voidHit(impact)
    for (const [z, amount] of hits) {
      if (!this.zombies.includes(z)) continue
      // Flamethrower sets them on fire; Void Ripper slows them.
      if (w.burn) z.burn = w.burn
      if (w.slow) z.slow = w.slow
      this.damageNumbers?.atZombie(z, amount, this.weaponId, ZOMBIE_HEIGHT)
      // On a server and not the host: the host's zombie takes the hit
      // (and tells me if I killed it); here it just flashes.
      if (this.net && !this.net.isHost) {
        this.net.queueHit(`z${z.id}`, amount)
        z.flash = 0.12
      } else this.damageZombie(z, amount, center.direction)
    }
    const cross = document.getElementById('build-try-crosshair')
    if (cross) {
      cross.classList.remove('hit')
      void cross.offsetWidth
      cross.classList.add('hit')
    }
    return true
  }

  // One hit from something other than shoot()'s rays (a thrown knife or
  // tomahawk, PlayThrow.js): the same damage path, server and crosshair.
  get zombieHalf() { return ZOMBIE_HALF }
  get zombieHeight() { return ZOMBIE_HEIGHT }
  hitZombieWith(z, amount, dir, head = false) {
    if (!this.zombies.includes(z)) return
    if (head) this.stats.headshots++
    this.damageNumbers?.atZombie(z, amount, this.weaponId, ZOMBIE_HEIGHT)
    if (this.net && !this.net.isHost) {
      this.net.queueHit(`z${z.id}`, amount)
      z.flash = 0.12
    } else this.damageZombie(z, amount, dir)
    const cross = document.getElementById('build-try-crosshair')
    if (cross) {
      cross.classList.remove('hit')
      void cross.offsetWidth
      cross.classList.add('hit')
    }
  }

  // --- Burning wood (see FIRE_BURN_S) ---

  ignite(x, y, z) {
    const bm = this.bm
    if (!this._fires || this._fires.size >= FIRE_MAX) return false
    const key = bm._key(x, y, z)
    const type = bm.getBlockAt(x, y, z)
    if (this._fires.has(key) || !bm.isFlammable?.(type) || this._wetAt(x, y, z)) return false
    const leaf = bm.isTreeBlock(type) && !/log/.test(type)
    this._fires.set(key, { x, y, z, t: 0, life: (leaf ? FIRE_LEAF_BURN_S : FIRE_BURN_S) * (0.8 + Math.random() * 0.4), tree: bm.isTreeBlock(type) })
    return true
  }

  // Raining (or hailing) right now (the sky's weather)?
  _raining() {
    return /Rain$|^hail$/.test(this.bm.sky?._now || '')
  }

  // Open sky above a cell (nothing solid in the next 24 blocks up).
  _skyAbove(x, y, z) {
    for (let k = 1; k <= 24; k++) if (this.bm.getBlockAt(x, y + k, z)) return false
    return true
  }

  // Water next to (or in) a cell, or rain falling on it - no fire there.
  _wetAt(x, y, z) {
    const bm = this.bm
    if (bm.getBlockAt(x, y, z) === 'water') return true
    for (const [dx, dy, dz] of FIRE_NEIGHBOURS) if (bm.getBlockAt(x + dx, y + dy, z + dz) === 'water') return true
    return this._raining() && this._skyAbove(x, y, z)
  }

  // A Flamethrower fire in the empty cell (x, y, z), dropped onto whatever
  // is below it; an existing fire there just burns longer.
  groundFire(x, y, z) {
    const bm = this.bm
    if (!this._groundFires) return false
    for (let k = 0; k < 4 && !bm.getBlockAt(x, y - 1, z); k++) y--
    if (!bm.getBlockAt(x, y - 1, z) || bm.getBlockAt(x, y, z)) return false
    if (this._wetAt(x, y, z) || this._wetAt(x, y - 1, z)) return false
    const old = this._groundFires.find((f) => f.x === x && f.y === y && f.z === z)
    if (old) {
      old.t = Math.min(old.t, 1)
      return true
    }
    if (this._groundFires.length >= GROUND_FIRE_MAX) this._groundFires.shift()
    this._groundFires.push({ x, y, z, t: 0, life: GROUND_FIRE_S * (0.85 + Math.random() * 0.3) })
    return true
  }

  _updateGroundFires(dt) {
    const list = this._groundFires
    if (!list?.length) return
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i]
      f.wetCheck = (f.wetCheck || 0) - dt
      if (f.wetCheck <= 0) {
        f.wetCheck = 0.5
        f.wet = this._wetAt(f.x, f.y, f.z)
      }
      // Rain or water: out within a second or so; otherwise it burns down.
      f.t += f.wet ? dt * f.life / FIRE_RAIN_OUT_S : dt
      if (f.t >= f.life || !this.bm.getBlockAt(f.x, f.y - 1, f.z)) {
        list.splice(i, 1)
        continue
      }
      this._fx?.burnBlock(f.x, f.y - 1, f.z, Math.min(0.84, 0.25 + f.t / f.life))
      for (const z of this.zombies) {
        if (Math.floor(z.x) === f.x && Math.floor(z.z) === f.z && Math.abs(z.y - f.y) < 1.5) z.burn = Math.max(z.burn || 0, 2)
      }
      for (const c of this._corpses || []) {
        const p = c.group.position
        if (Math.floor(p.x / this.B) === f.x && Math.floor(p.z / this.B) === f.z && Math.abs(p.y / this.B - f.y) < 2) c.burnLeft ??= CORPSE_BURN_S
      }
      if (!f.wet && Math.random() < GROUND_FIRE_CATCH * dt) {
        const [dx, dy, dz] = FIRE_NEIGHBOURS[Math.floor(Math.random() * FIRE_NEIGHBOURS.length)]
        this.ignite(f.x + dx, f.y + dy, f.z + dz)
      }
    }
  }

  _updateFires(dt) {
    this._updateGroundFires(dt)
    if (!this._fires?.size) return
    const bm = this.bm
    for (const [key, f] of this._fires) {
      // Put out if the block went some other way (broken, map reset).
      if (!bm.isFlammable(bm.getBlockAt(f.x, f.y, f.z))) {
        this._fires.delete(key)
        continue
      }
      // Rain or water puts it out (the block stays, a little scorched).
      f.wetCheck = (f.wetCheck || 0) - dt
      if (f.wetCheck <= 0) {
        f.wetCheck = 0.5
        f.wet = this._wetAt(f.x, f.y, f.z)
      }
      if (f.wet) {
        f.out = (f.out || 0) + dt
        if (f.out >= FIRE_RAIN_OUT_S) {
          this._fires.delete(key)
          continue
        }
      }
      f.t += dt
      this._fx?.burnBlock(f.x, f.y, f.z, f.wet ? Math.min(0.9, f.t / f.life) * (1 - (f.out || 0) / FIRE_RAIN_OUT_S) : f.t / f.life)
      const near = f.tree ? TREE_NEIGHBOURS : FIRE_NEIGHBOURS
      if (!f.wet && Math.random() < (f.tree ? FIRE_TREE_SPREAD : FIRE_SPREAD) * dt * FIRE_NEIGHBOURS.length) {
        const [dx, dy, dz] = near[Math.floor(Math.random() * near.length)]
        this.ignite(f.x + dx, f.y + dy, f.z + dz)
      }
      for (const c of this._corpses || []) {
        const p = c.group.position
        if (Math.floor(p.x / this.B) === f.x && Math.floor(p.z / this.B) === f.z && Math.abs(p.y / this.B - f.y) < 2) c.burnLeft ??= CORPSE_BURN_S
      }
      for (const z of this.zombies) {
        if (Math.floor(z.x) === f.x && Math.floor(z.z) === f.z && Math.abs(z.y - f.y) < 1.5) z.burn = Math.max(z.burn || 0, 2)
      }
      if (f.t >= f.life) {
        this._fires.delete(key)
        if (bm.getBlockAt(f.x, f.y, f.z)) this._recordEdit(f.x, f.y, f.z, '')
        bm.tryMode.breakBlock(f.x, f.y, f.z)
      }
    }
  }

  // by: on a server, the other player whose shot this was (the kill is
  // theirs - it reaches them through PlayNet).
  damageZombie(z, amount, dir = null, by = null) {
    // Spectating, everyone's hits show (my own show where I fire).
    if (by && this.spectating) this.damageNumbers?.atZombie(z, amount, '', ZOMBIE_HEIGHT)
    // On a server, who did how much (for assists, _creditAssists). '' is me.
    if (this.net && amount > 0 && z.health > 0) {
      const hurtBy = z.hurtBy || (z.hurtBy = new Map())
      hurtBy.set(by || '', (hurtBy.get(by || '') || 0) + Math.min(amount, z.health))
    }
    // Lit by a Searchlight: hit harder (BuildSpecials.js).
    if (amount > 0) amount *= this.bm.specials.zombieHurtMult(z)
    z.health -= amount
    z.flash = 0.12
    if (z.skel && z.health > 0 && !z.rise && amount > 0) z.hitAnim = z.skel.play('hit', { once: true, fade: 0.05, timeScale: 1.6 })
    if (dir) {
      z.vx += dir.x * 3
      z.vz += dir.z * 3
    }
    if (z.health > 0) return
    // Lost (fell out, or wandered far from everyone): just removed, no kill.
    if (z.lost) {
      this._removeZombie(z)
      this.zombies = this.zombies.filter((o) => o !== z)
      this._renderHud()
      return
    }
    // Every kill counts toward the wave's target (see SPAWN_GAP).
    if (this._toSpawn > 0) this._toSpawn--
    audioEngine.playZombieDeath?.(1, this._panTo(z.x, z.z))
    const skeleton = SKELETON_KINDS[z.kind] ? z.kind : null
    if (by) this.net?.queueCredit(by, z.boss, skeleton, z.tier)
    else this._countKill(z.boss, skeleton, z.tier)
    this.bm.specials.onKill(z)
    this._creditAssists(z, by || '')
    // A bloater bursts instead of falling over.
    if (MONSTER_KINDS[z.kind]?.burst) this._burst(z)
    else this._spawnCorpse(z, dir)
    this._removeZombie(z)
    this.zombies = this.zombies.filter((o) => o !== z)
    this._renderHud()
  }

  // A bloater (ZombieKinds.js) bursts where it died: players and other
  // zombies close by are hurt, less the further away.
  _burst(z) {
    const r = MONSTER_KINDS[z.kind].burst
    const B = this.B
    const mid = z.y + ZOMBIE_HEIGHT * 0.5
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    this._fx?.explode(new THREE.Vector3(z.x * B, mid * B, z.z * B), r * 0.6)
    const hit = zombieDamage(this.wave) * this.cfg.zombieDamageMult * 1.6
    for (const p of this._targets()) {
      const d = Math.hypot(p.x - z.x, p.y + 1 - mid, p.z - z.z)
      if (d >= r) continue
      const amount = hit * (1 - d / r)
      if (p.remote) {
        if (!this.camp?.inside(p.x, p.z)) this.net?.queueHurt(p.remote, amount)
      } else this._hurtPlayer(amount)
    }
    for (const o of [...this.zombies]) {
      if (o === z || o.health <= 0 || !this.zombies.includes(o)) continue
      const d = Math.hypot(o.x - z.x, o.y - z.y, o.z - z.z)
      if (d < r) this.damageZombie(o, hit * 2 * (1 - d / r))
    }
  }

  // A kill of mine: stats, coins, the streak, achievements.
  // tier: its rarity (ZombieNames.js) - rarer ones pay more coins.
  _countKill(boss, skeleton = null, tier = 'common') {
    this.kills++
    this.stats.kills++
    if (skeleton) this.stats.skeletonKills = (this.stats.skeletonKills || 0) + 1
    if (this.weapon.melee) this.stats.meleeKills++
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this._earn(Math.round(COIN_PER_KILL * (ZOMBIE_TIERS[tier]?.coins ?? 1)))
    if (boss) {
      this.bosses++
      this._earn(BOSS_COINS)
      this._message(t('buildPlayBossDown', { n: Math.round(BOSS_COINS * (this.cfg?.coinMult ?? 1)) }))
    }
    this._report('kill', { boss: !!boss, streak: this.streak, weapon: this.weaponId, skeleton })
    this._renderHud()
  }

  // On a server the killing shot gets the full coins; everyone else who did
  // at least ASSIST_MIN_HURT of its health gets an assist (2026-10-26,
  // Gaymi: kill + assist, "at least 10% of its health").
  _creditAssists(z, killer) {
    if (!this.net || !z.hurtBy) return
    const need = (z.maxHealth || 0) * ASSIST_MIN_HURT
    for (const [who, hurt] of z.hurtBy) {
      if (who === killer || hurt < need) continue
      if (who) this.net.queueCredit(who, z.boss, null, z.tier, true)
      else this._countAssist(z.boss, z.tier)
    }
  }

  // An assist of mine: ASSIST_SHARE of what the kill paid (its rarity's
  // coins and a boss's bonus), a "+Assist" message and the assists stat.
  _countAssist(boss, tier = 'common') {
    const n = Math.round((COIN_PER_KILL * (ZOMBIE_TIERS[tier]?.coins ?? 1) + (boss ? BOSS_COINS : 0)) * ASSIST_SHARE)
    this._earn(n)
    this.stats.assists = (this.stats.assists || 0) + 1
    this._message(t('buildPlayAssist', { n: Math.round(n * (this.cfg?.coinMult ?? 1)) }))
    this._report('assist', { boss: !!boss, tier })
    this._renderHud()
  }

  reload() {
    if (!this.active || this.dead || this._reloadLeft > 0 || this.mag >= this.magSize() || this.reserve <= 0) return
    this._reloadLeft = this._reloadTime()
    try { audioEngine.playReload({ magSize: this.magSize() }) } catch { /* no audio */ }
    this._renderHud()
  }

  // E / right-click on a Loot Chest while playing: ammo and health, once
  // per chest per wave. Also used (as a no-op) while just trying the map.
  useChest(x, y, z) {
    if (!this.active || this.dead) return false
    const key = this.bm._key(x, y, z)
    if (this.bm._blocks.get(key) !== 'lootchest') return false
    if (this._chestsUsed.has(key)) {
      this._message(t('buildPlayChestEmpty'))
      return true
    }
    this._chestsUsed.add(key)
    this.stats.chests++
    // Ammo in this gun's own amounts (PlayWeapons.ammoFor).
    const ammo = ammoFor(this.weaponId, CHEST_LOOT.ammo)
    this.reserve += ammo
    this.health = Math.min(this.maxHealth, this.health + CHEST_LOOT.health)
    this._message(t('buildPlayChestLoot', { ammo, health: CHEST_LOOT.health }))
    // Items for the inventory too: health packs, ammo boxes, armor, blocks.
    const got = []
    const give = (item) => {
      if (this.inv.add(item) < item.n) got.push(item.kind === 'block' ? this.bm.blockName(item.id) : t(ITEMS[item.id].key))
    }
    if (Math.random() < 0.6) give({ kind: 'item', id: 'healthpack', n: 1 })
    if (Math.random() < 0.4) give({ kind: 'item', id: 'ammobox', n: 1 })
    if (Math.random() < 0.25) give({ kind: 'item', id: ARMOR_SLOTS[Math.floor(Math.random() * ARMOR_SLOTS.length)], n: 1 })
    if (Math.random() < 0.3) give({ kind: 'block', id: CHEST_BLOCKS[Math.floor(Math.random() * CHEST_BLOCKS.length)], n: 8 + Math.floor(Math.random() * 9) })
    if (got.length) setTimeout(() => this.active && this._message(t('invChestItems', { items: got.join(', ') })), 1800)
    this._renderHud()
    return true
  }

  // A block broken by hand in a game goes into the inventory.
  onBlockMined(type, x, y, z) {
    if (!this.active || !this.inv || !type) return
    this._recordEdit(x, y, z, '')
    const bm = this.bm
    // One you placed yourself: it's simply gone (not put back at the end).
    const key = bm._key(x, y, z)
    if (this._placed?.delete(key)) bm.tryMode._broken?.delete(key)
    if (bm._isWindowType(type) || /door|lootchest|zombiespawner|playerstart|invisible/.test(type)) return
    // Leaves only drop a leaf block half the time (2026-10-26, Gaymi).
    if (/leaves$/.test(type) && Math.random() >= LEAF_DROP_CHANCE) return
    // It pops out as a little block you pick up by walking near (PlayDrops).
    if (!this._drops.spawn(type, x, y, z) && this.inv.add({ kind: 'block', id: type, n: 1 }) > 0) this._message(t('invFull'))
  }

  // Right-click while holding a block: put it where you're looking.
  placeHeldBlock() {
    const held = this.holding
    if (!this.active || this.dead || held?.kind !== 'block') return false
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (!hit?.placeAt || hit.t > PLACE_REACH * this.B) return false
    const [x, y, z] = hit.placeAt
    if (bm.getBlockAt(x, y, z)) return false
    // Not inside you or a zombie.
    const p = bm.tryMode.pos
    const inBox = (bx, by, bz) => Math.floor(bx) === x && Math.floor(bz) === z && y >= Math.floor(by) && y <= Math.floor(by + 1.7)
    if (inBox(p.x, p.y, p.z) || this.zombies.some((zb) => inBox(zb.x, zb.y, zb.z))) return false
    bm._suppressUndoRecording = true
    bm.placeBlock(x, y, z, held.id, false)
    bm._suppressUndoRecording = false
    this._placed.set(bm._key(x, y, z), held.id)
    this._recordEdit(x, y, z, held.id)
    this.inv.usedBlock()
    audioEngine.playFootstep?.(false, 'default')
    return true
  }

  // Cells zombies stand in, for pressure plates.
  zombieCells() {
    return this.zombies.map((z) => [Math.floor(z.x), Math.floor(z.y + 0.01), Math.floor(z.z)])
  }

  onKeyDown(code) {
    if (code === getKeyFor('reload')) this.reload()
  }

  // --- the world: who can stand where ---

  // How solid a cell is (BuildMode._cellSolidTop), with ladders as -1.
  // While a flow pass runs, every cell is looked up once and remembered
  // for that pass (_memo) - the flood fill asks about each cell many times.
  _cellCode(x, y, z) {
    const memo = this._memo
    if (memo) {
      const k = cellKey(x, y, z)
      const v = memo.get(k)
      if (v !== undefined) return v
      const code = this.bm._cellIsLadder(x, y, z) ? -1 : this.bm._cellSolidTop(x, y, z)
      memo.set(k, code)
      return code
    }
    return this.bm._cellIsLadder(x, y, z) ? -1 : this.bm._cellSolidTop(x, y, z)
  }

  _solid(x, y, z) {
    return this._cellCode(x, y, z) > 0.5
  }

  _isLadder(x, y, z) {
    return this._cellCode(x, y, z) === -1
  }

  // A zombie can stand with its feet in this cell: it and the cell above
  // are open, and there's ground (or a ladder) under it.
  _standable(x, y, z) {
    if (this._solid(x, y, z) || this._solid(x, y + 1, z)) return false
    const below = this._cellCode(x, y - 1, z)
    return below > 0 || this._isLadder(x, y, z)
  }

  // Closed doors count as a way through (zombies bash them open), just a
  // longer one.
  _doorAt(x, y, z) {
    const type = this.bm._blocks.at(x, y, z)
    const shape = type && this.bm.constructor.blockShape(type)
    return shape === 'door' || shape === 'doortop'
  }

  _neighbors(x, y, z, out) {
    out.length = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const nz = z + dz
      // Through a closed door (zombies bash it open): a longer way round.
      if (this._doorAt(nx, y, nz) && this._solid(nx, y, nz) && this._solid(nx, y - 1, nz)) {
        out.push([nx, y, nz, 4])
        continue
      }
      // Same level, one up (a jump, needs head room), or down a drop of up
      // to three.
      if (this._standable(nx, y, nz)) out.push([nx, y, nz, 1])
      else if (this._standable(nx, y + 1, nz) && !this._solid(x, y + 2, z)) out.push([nx, y + 1, nz, 1.5])
      else if (!this._solid(nx, y, nz) && !this._solid(nx, y + 1, nz)) {
        for (let d = 1; d <= 3; d++) {
          if (this._solid(nx, y - d, nz)) break
          if (this._standable(nx, y - d, nz)) {
            out.push([nx, y - d, nz, 1 + d * 0.2])
            break
          }
        }
      }
    }
    // Up and down ladders.
    if (this._isLadder(x, y, z) || this._isLadder(x, y + 1, z)) {
      if (!this._solid(x, y + 2, z) && !this._solid(x, y + 1, z)) out.push([x, y + 1, z, 1])
    }
    if (this._isLadder(x, y - 1, z) && !this._solid(x, y - 1, z)) out.push([x, y - 1, z, 1])
    return out
  }

  // Flood fill outward from the player (cheapest-first with a simple
  // bucket queue; costs are small multiples of half a step). Done as a
  // job a slice at a time (_stepFlow); zombies keep following the last
  // finished field meanwhile. The very first one runs in one go.
  // sources: the cells of every player being chased (on a server, all of
  // them - each zombie then heads for whoever is nearest).
  _rebuildFlow(sources) {
    this._startFlow(sources)
    this._stepFlow(Infinity)
  }

  _startFlow(sources) {
    const flow = new Map()
    for (const [x, y, z] of sources) flow.set(cellKey(x, y, z), 0)
    this._flowJob = { flow, buckets: [sources.map((c) => [...c])], b: 0, i: 0, visited: 0, memo: new Map() }
  }

  // Works on the current job for up to budgetMs; true once it's done.
  _stepFlow(budgetMs) {
    const job = this._flowJob
    if (!job) return true
    const until = performance.now() + budgetMs
    const { flow, buckets } = job
    const nb = this._flowNb || (this._flowNb = [])
    this._memo = job.memo
    let n = 0
    try {
      for (; job.b < buckets.length && job.visited < PATH_MAX_NODES; job.b++, job.i = 0) {
        const list = buckets[job.b]
        if (!list) continue
        for (; job.i < list.length; job.i++) {
          if ((++n & 63) === 0 && performance.now() > until) return false
          const [x, y, z] = list[job.i]
          const here = flow.get(cellKey(x, y, z))
          if (here * 2 !== job.b) continue
          job.visited++
          for (const [nx, ny, nz, cost] of this._neighbors(x, y, z, nb)) {
            const key = cellKey(nx, ny, nz)
            const d = here + cost
            const old = flow.get(key)
            if (old !== undefined && old <= d) continue
            flow.set(key, d)
            const bi = Math.round(d * 2)
            ;(buckets[bi] || (buckets[bi] = [])).push([nx, ny, nz])
          }
        }
      }
    } finally {
      this._memo = null
    }
    this._flow = flow
    this._flowJob = null
    return true
  }

  _playerCell(p = this.bm.tryMode.pos) {
    let x = Math.floor(p.x)
    let y = Math.floor(p.y + 0.01)
    let z = Math.floor(p.z)
    // In the air: the cell under you.
    for (let i = 0; i < 4 && !this._standable(x, y, z); i++) y--
    if (!this._standable(x, y, z)) y = Math.floor(p.y + 0.01)
    return [x, y, z]
  }

  // --- zombies ---

  _spawnSpots() {
    const spots = []
    const players = [this.bodyPos(), ...(this.net && !this.net.closed ? this.net.targets() : [])]
    for (const [x, y, z] of this._findBlocks('zombiespawner')) {
      if (!players.some((p) => Math.hypot(p.x - x, p.z - z) < SPAWNER_RANGE)) continue
      // On top of it or right beside it.
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]) {
        if (this._standable(x + dx, y + dy, z + dz)) {
          spots.push([x + dx, y + dy, z + dz])
          break
        }
      }
    }
    if (spots.length) return spots
    // No spawners: somewhere a zombie can reach you from, at least
    // SPAWN_MIN_DIST from every player, preferably not a long walk away.
    const gap = (cell) => Math.min(...players.map((p) => Math.hypot(p.x - cell[0] - 0.5, p.z - cell[2] - 0.5)))
    const good = []
    const far = []
    let best = null
    let bestGap = -1
    for (const [key, d] of this._flow) {
      const cell = cellOf(key)
      const g = gap(cell)
      if (g >= SPAWN_MIN_DIST) (d <= SPAWN_MAX_STEPS ? good : far).push(cell)
      else if (g > bestGap) {
        bestGap = g
        best = cell
      }
    }
    if (good.length) return good
    if (far.length) return far
    // A small space: the furthest reachable spot.
    return best ? [best] : []
  }

  // spots: where it may appear (a Grave, BuildSpecials.js), else the usual.
  _spawnZombie(spots = this._spawnSpots()) {
    if (!spots.length) return false
    const open = this.camp ? spots.filter(([sx, , sz]) => !this.camp.inside(sx + 0.5, sz + 0.5, 1)) : spots
    if (!open.length) return false
    const [x, y, z] = open[Math.floor(Math.random() * open.length)]
    const boss = this._bossPending > 0
    if (boss) this._bossPending--
    let kind = !boss && this.wave >= SKELETON_FROM_WAVE && skeletonsReady() && Math.random() < SKELETON_CHANCE
      ? SKELETON_KIND_IDS[Math.floor(Math.random() * SKELETON_KIND_IDS.length)] : null
    if (!kind && !boss && this.wave >= MONSTER_FROM_WAVE && Math.random() < MONSTER_CHANCE) kind = MONSTER_KIND_IDS[Math.floor(Math.random() * MONSTER_KIND_IDS.length)]
    // Its rarity and silly name (ZombieNames.js): rarer = tougher.
    const tier = rollZombieTier(boss)
    const health = zombieHealth(this.wave, this.cfg.escalation) * this.cfg.zombieHealthMult * (boss ? BOSS_HEALTH_MULT : 1) * (kindOf(kind)?.hp ?? 1) * ZOMBIE_TIERS[tier].hp
    if (boss) this._message(t('buildPlayBossComing'))
    this._makeZombie(++this._zid, x + 0.5, y, z + 0.5, health, boss, kind, { tier, name: rollZombieName() })
    return true
  }

  // A zombie's body and state. id: the number the server knows it by
  // (the host's count - other players' copies use the host's ids).
  // kind: a skeleton kind (SKELETON_KINDS), a monster kind (MONSTER_KINDS)
  // or null for a zombie. look: { tier, name } (ZombieNames.js) - a common
  // one with a random name when missing.
  _makeZombie(id, x, y, z, health, boss, kind = null, look = null) {
    const group = new THREE.Group()
    const zombie = { id, x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, health, maxHealth: health, attackCd: 0.6, bash: 0, flash: 0, walk: Math.random() * 6, moan: 2 + Math.random() * 8, group, body: null, boss, size: boss ? BOSS_SIZE : 1 }
    const monster = MONSTER_KINDS[kind]
    const batch = monster || (kind && skeletonsReady()) ? null : this._zombieBatch()
    if (monster) {
      const m = makeMonster(kind, ZOMBIE_HEIGHT * this.B)
      group.add(m.root)
      zombie.monster = m
      zombie.kind = kind
      zombie.speedMult = monster.speed
      zombie.damageMult = monster.damage
      zombie.tall = monster.tall
      zombie.wide = monster.wide || 1
      zombie.climbs = !!monster.climbs
    } else if (kind && skeletonsReady()) {
      // A real animated skeleton (SkeletonModels.js), rising out of the
      // ground first.
      const skel = makeSkeleton(kind, ZOMBIE_HEIGHT * this.B)
      group.add(skel.root)
      zombie.skel = skel
      zombie.kind = kind
      zombie.speedMult = SKELETON_KINDS[kind].speed
      zombie.damageMult = SKELETON_KINDS[kind].damage
      zombie.rise = SKELETON_RISE
      skel.play('rise', { once: true, fade: 0, duration: SKELETON_RISE })
    } else if (batch) {
      // A copy of the shared body (same geometry and material): it only
      // carries the moving parts' positions - drawZombies() draws every
      // zombie's parts together, one draw per part.
      const body = batch.template.clone()
      const nodes = []
      body.traverse((o) => nodes.push(o))
      body.limbPivots = Object.fromEntries(Object.entries(batch.pivotIndex).map(([name, i]) => [name, nodes[i]]))
      zombie.parts = batch.partIndex.map((i) => nodes[i])
      for (const part of zombie.parts) part.visible = false
      const s = (ZOMBIE_HEIGHT * this.B * zombie.size) / 32
      body.scale.setScalar(s)
      body.position.y = 2 * s
      // Arms out in front, the classic zombie walk.
      body.limbPivots.armR.rotation.x = -Math.PI / 2
      body.limbPivots.armL.rotation.x = -Math.PI / 2
      group.add(body)
      zombie.body = body
    } else {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6 * this.B, ZOMBIE_HEIGHT * this.B, 0.6 * this.B), new THREE.MeshLambertMaterial({ color: 0x4f8a3a }))
      mesh.position.y = (ZOMBIE_HEIGHT * this.B) / 2
      group.add(mesh)
    }
    const tier = ZOMBIE_TIERS[look?.tier] ? look.tier : 'common'
    zombie.tier = tier
    zombie.nameIdx = Number.isInteger(look?.name) && look.name >= 0 && look.name < NAME_COUNT ? look.name : rollZombieName()
    zombie.speedMult = (zombie.speedMult || 1) * ZOMBIE_TIERS[tier].speed
    zombie.damageMult = (zombie.damageMult || 1) * ZOMBIE_TIERS[tier].damage
    // Name tag just over its head, and a glow round rare and rarer ones.
    const tag = new THREE.Sprite(zombieTagMaterial(zombie.nameIdx, tier))
    tag.center.set(0.5, 0)
    tag.position.y = (ZOMBIE_HEIGHT * zombie.size * (zombie.tall || 1) + 0.3) * this.B
    tag.renderOrder = 5
    group.add(tag)
    zombie.tag = tag
    const glow = zombieGlow(tier, 1.8 * zombie.size * (zombie.wide || 1) * this.B)
    if (glow) {
      glow.position.y = 0.04 * this.B
      group.add(glow)
    }
    this.bm.scene.add(group)
    this.zombies.push(zombie)
    return zombie
  }

  // Name tags stay readable: the same size on screen past ZOMBIE_TAG_NEAR
  // (like the animals'), hidden while the zombie rises from the ground.
  _sizeZombieTags() {
    const cam = this.bm.camera?.position
    if (!cam) return
    const B = this.B
    for (const z of this.zombies) {
      if (!z.tag) continue
      z.tag.visible = !z.rise
      const d = Math.hypot(z.x * B - cam.x, z.y * B - cam.y, z.z * B - cam.z) / B
      const w = ZOMBIE_TAG_SIZE * Math.max(1, d / ZOMBIE_TAG_NEAR) * B
      z.tag.scale.set(w, w * (TAG_H / TAG_W), 1)
    }
    pulseZombieGlows(performance.now() / 1000)
  }

  // Every zombie looks the same, so their bodies are drawn together: one
  // InstancedMesh per body part (head, torso, each limb...) instead of
  // about eight draws per zombie - a full wave used to add ~130 draws.
  _zombieBatch() {
    if (this._zBatch || !this._skin) return this._zBatch || null
    const template = buildTexturedCharacter(this._skin)
    const nodes = []
    template.traverse((o) => nodes.push(o))
    const partIndex = []
    nodes.forEach((o, i) => { if (o.isMesh) partIndex.push(i) })
    const pivotIndex = Object.fromEntries(Object.entries(template.limbPivots).map(([name, o]) => [name, nodes.indexOf(o)]))
    const size = MAX_ALIVE + 8
    const meshes = partIndex.map((i) => {
      const part = nodes[i]
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, size)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3).fill(1), 3)
      mesh.count = 0
      // The parts sit all over the map; their bounds aren't worth keeping.
      mesh.frustumCulled = false
      this.bm.scene.add(mesh)
      return mesh
    })
    this._zBatch = { template, partIndex, pivotIndex, meshes }
    return this._zBatch
  }

  // Called by BuildMode.render() just before drawing.
  drawZombies() {
    this._sizeZombieTags()
    const batch = this._zBatch
    if (!batch) return
    const list = this.zombies.filter((z) => z.parts)
    for (const z of list) z.group.updateMatrixWorld(true)
    batch.meshes.forEach((mesh, p) => {
      list.forEach((z, i) => {
        mesh.setMatrixAt(i, z.parts[p].matrixWorld)
        const red = z.lastRed > 0
        mesh.instanceColor.setXYZ(i, 1, red ? 0.35 : 1, red ? 0.35 : 1)
      })
      mesh.count = list.length
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
    })
  }

  _disposeZombieBatch() {
    this._warmSkel?.dispose()
    this._warmSkel = null
    const batch = this._zBatch
    if (!batch) return
    for (const mesh of batch.meshes) {
      this.bm.scene.remove(mesh)
      mesh.dispose()
    }
    batch.template.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [].concat(o.material)) m.dispose()
    })
    this._zBatch = null
  }

  // A copy of the dead zombie's body that falls over and fades away. Its
  // geometry is the shared zombie body's (never disposed here); the
  // materials are its own copies, so fading one never fades another.
  _spawnCorpse(z, dir) {
    if (z.skel) {
      this._skeletonCorpse(z, dir)
      return
    }
    if (z.monster) {
      this._monsterCorpse(z, dir)
      return
    }
    if (!z.body || !z.parts) return
    const B = this.B
    const body = z.body.clone()
    // Its arms (held out in front while walking) drop along the body as it
    // falls - lying on its back with arms in the air looked wrong.
    const nodes = []
    body.traverse((o) => nodes.push(o))
    const pivots = this._zBatch?.pivotIndex || {}
    const arms = ['armR', 'armL'].map((k) => nodes[pivots[k]]).filter(Boolean)
    const materials = []
    body.traverse((o) => {
      if (!o.isMesh) return
      o.visible = true
      o.material = [].concat(o.material).map((m) => {
        const c = m.clone()
        c.transparent = true
        materials.push(c)
        return c
      })
      if (o.material.length === 1) o.material = o.material[0]
    })
    // Falls away from the shot (or from me, when the host says it died).
    let fx = dir?.x ?? 0
    let fz = dir?.z ?? 0
    if (!fx && !fz) {
      const me = this.bm.tryMode.pos
      fx = z.x - me.x
      fz = z.z - me.z
    }
    const tilt = new THREE.Group()
    tilt.rotation.order = 'YXZ'
    tilt.rotation.y = Math.atan2(fx, fz) || 0
    const facing = new THREE.Group()
    facing.rotation.y = z.group.rotation.y - tilt.rotation.y
    facing.add(body)
    tilt.add(facing)
    tilt.position.copy(z.group.position)
    this.bm.scene.add(tilt)
    // Lying flat, the body's own thickness keeps it on top of the ground.
    const lift = 0.13 * B * (z.size || 1)
    this._corpses = this._corpses || []
    // Killed mid-jump, it drops to the ground under it (2026-10-12, "their
    // dead body flows - it should always be on the ground").
    const groundY = this._groundUnder(tilt.position.x / B, tilt.position.y / B, tilt.position.z / B) * B
    this._corpses.push({ group: tilt, materials, arms, armFrom: arms.map((a) => a.rotation.x), t: 0, lift, baseY: tilt.position.y, groundY, vy: 0 })
    while (this._corpses.length > MAX_CORPSES) this._dropCorpse(this._corpses[0])
  }

  // A dead monster (ZombieKinds.js) topples over away from the shot and
  // fades like a zombie's body - the body itself, not a copy.
  _monsterCorpse(z, dir) {
    z.corpseTaken = true
    let fx = dir?.x ?? 0
    let fz = dir?.z ?? 0
    if (!fx && !fz) {
      const me = this.bm.tryMode.pos
      fx = z.x - me.x
      fz = z.z - me.z
    }
    const tilt = new THREE.Group()
    tilt.rotation.order = 'YXZ'
    tilt.rotation.y = Math.atan2(fx, fz) || 0
    tilt.position.copy(z.group.position)
    z.group.position.set(0, 0, 0)
    z.group.rotation.y -= tilt.rotation.y
    tilt.add(z.group)
    this.bm.scene.add(tilt)
    for (const m of z.monster.materials) {
      m.transparent = true
      m.emissive.setRGB(0, 0, 0)
    }
    this._corpses = this._corpses || []
    const groundY = this._groundUnder(tilt.position.x / this.B, tilt.position.y / this.B, tilt.position.z / this.B) * this.B
    this._corpses.push({ group: tilt, materials: z.monster.materials, arms: [], armFrom: [], t: 0, lift: 0.2 * this.B * (z.tall || 1), baseY: tilt.position.y, groundY, vy: 0 })
    while (this._corpses.length > MAX_CORPSES) this._dropCorpse(this._corpses[0])
  }

  // A dead skeleton plays its own fall, lies there, then sinks into the
  // ground and is gone - the body itself, not a copy.
  _skeletonCorpse(z, dir) {
    z.corpseTaken = true
    if (dir && (dir.x || dir.z)) z.group.rotation.y = Math.atan2(-dir.x, -dir.z)
    const fall = z.skel.play('death', { once: true, fade: 0.08 })
    this._boneCorpses = this._boneCorpses || []
    this._boneCorpses.push({ group: z.group, skel: z.skel, t: 0, lie: fall + SKELETON_LIE, y: z.group.position.y })
    while (this._boneCorpses.length > MAX_CORPSES) this._dropBoneCorpse(this._boneCorpses[0])
  }

  _dropBoneCorpse(c) {
    this.bm.scene.remove(c.group)
    c.skel.dispose()
    this._boneCorpses = this._boneCorpses.filter((o) => o !== c)
  }

  _updateCorpses(dt) {
    for (const c of [...(this._boneCorpses || [])]) {
      c.t += dt
      c.skel.update(dt)
      // A burning skeleton sinks away fast, in flames.
      if (c.burnLeft !== undefined && c.lie > c.t) c.lie = c.t
      if (c.burnLeft !== undefined) this._fx?.burn({ x: c.group.position.x / this.B, y: c.group.position.y / this.B, z: c.group.position.z / this.B }, 1)
      const sink = c.t - c.lie
      if (sink > 0) {
        c.group.position.y = c.y - (sink / SKELETON_SINK) * 0.6 * this.B
        if (sink >= SKELETON_SINK) this._dropBoneCorpse(c)
      }
    }
    if (!this._corpses?.length) return
    for (const c of [...this._corpses]) {
      c.t += dt
      // Falls like it has weight: slow, then faster.
      const f = Math.min(1, c.t / CORPSE_FALL)
      c.group.rotation.x = (Math.PI / 2) * f * f
      if (c.baseY > c.groundY) {
        c.vy += CORPSE_GRAVITY * this.B * dt
        c.baseY = Math.max(c.groundY, c.baseY - c.vy * dt)
      }
      c.group.position.y = c.baseY + c.lift * f
      c.arms.forEach((a, i) => { a.rotation.x = c.armFrom[i] * (1 - f) })
      // Burning: flames all over it and gone in CORPSE_BURN_S (rain or
      // water puts it out - then it just fades as usual).
      if (c.burnLeft !== undefined) {
        const p = c.group.position
        const cell = [Math.floor(p.x / this.B), Math.floor(p.y / this.B + 0.3), Math.floor(p.z / this.B)]
        if ((c.wetIn = (c.wetIn || 0) - dt) <= 0) {
          c.wetIn = 0.5
          if (this._wetAt(...cell)) {
            c.burnLeft = undefined
            continue
          }
        }
        c.burnLeft -= dt
        this._fx?.burn({ x: p.x / this.B, y: p.y / this.B - 0.1, z: p.z / this.B }, 0.6)
        const o = Math.max(0, c.burnLeft / CORPSE_BURN_S)
        for (const m of c.materials) m.opacity = Math.min(m.opacity, o)
        if (o <= 0) this._dropCorpse(c)
        continue
      }
      const fadeT = c.t - CORPSE_FALL - CORPSE_LIE
      if (fadeT > 0) {
        const o = Math.max(0, 1 - fadeT / CORPSE_FADE)
        for (const m of c.materials) m.opacity = o
        if (o <= 0) this._dropCorpse(c)
      }
    }
  }

  // Top of the first solid block at or below (x, y, z), in blocks.
  _groundUnder(x, y, z) {
    const cx = Math.floor(x)
    const cz = Math.floor(z)
    for (let cy = Math.floor(y + 0.01); cy > y - 64; cy--) {
      const top = this.bm._cellSolidTop(cx, cy, cz)
      if (top > 0 && cy + top <= y + 0.01) return cy + top
    }
    return y
  }

  _dropCorpse(c) {
    this.bm.scene.remove(c.group)
    for (const m of c.materials) m.dispose()
    this._corpses = this._corpses.filter((o) => o !== c)
  }

  _clearCorpses() {
    for (const c of [...(this._corpses || [])]) this._dropCorpse(c)
    for (const c of [...(this._boneCorpses || [])]) this._dropBoneCorpse(c)
  }

  _removeZombie(z) {
    // A dead skeleton's body is still lying there (_skeletonCorpse).
    if (z.corpseTaken) return
    this.bm.scene.remove(z.group)
    if (z.skel) {
      z.skel.dispose()
      return
    }
    // A monster's geometry and pictures are shared with its kind.
    if (z.monster) {
      z.monster.dispose()
      return
    }
    // A batched body shares its geometry and material - nothing to free.
    if (z.parts) return
    z.group.traverse((o) => {
      if (!o.isMesh || o.userData.shared) return
      o.geometry.dispose()
      for (const m of [].concat(o.material)) m.dispose()
    })
  }

  _zombieHits(x, y, z) {
    // The camp counts as a wall to zombies.
    if (this.camp?.inside(x, z, ZOMBIE_HALF + 0.05)) return true
    return this.bm.tryMode._hits(x, y, z, ZOMBIE_FIT_HEIGHT)
  }

  _moveZombieAxis(zb, axis, amount) {
    if (!amount) return false
    const q = { x: zb.x, y: zb.y, z: zb.z }
    q[axis] += amount
    if (!this._zombieHits(q.x, q.y, q.z)) {
      zb[axis] = q[axis]
      return false
    }
    let lo = 0
    let hi = amount
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2
      q[axis] = zb[axis] + mid
      if (this._zombieHits(q.x, q.y, q.z)) hi = mid
      else lo = mid
    }
    zb[axis] += lo
    return true
  }

  _updateZombie(zb, dt, player, speed) {
    if (zb.skel) {
      zb.skel.update(dt)
      // Still climbing out of the ground: no moving or hitting yet.
      if (zb.rise > 0) {
        zb.rise -= dt
        zb.group.position.set(zb.x * this.B, zb.y * this.B, zb.z * this.B)
        if (zb.rise <= 0) {
          zb.rise = 0
          zb.skel.play('walk')
        }
        return
      }
      speed *= zb.speedMult || 1
    }
    if (zb.monster) speed *= zb.speedMult || 1
    if (zb.burn > 0) {
      zb.burn -= dt
      // Water or rain puts a burning zombie out.
      if ((zb._wetIn = (zb._wetIn || 0) - dt) <= 0) {
        zb._wetIn = 0.4
        if (this._wetAt(Math.floor(zb.x), Math.floor(zb.y), Math.floor(zb.z))) zb.burn = 0
      }
      zb.health -= BURN_DPS * this._damageMult() * dt
      zb.flash = Math.max(zb.flash || 0, 0.05)
      this._fx?.burn(zb, ZOMBIE_HEIGHT * (zb.size || 1))
    }
    if (zb.slow > 0) {
      zb.slow -= dt
      speed *= VOID_SLOW
    }
    // Special blocks it touches (spikes, a barricade...), BuildSpecials.js.
    speed *= this.bm.specials.zombieTick(zb, dt)
    const cx = Math.floor(zb.x)
    const cy = Math.floor(zb.y + 0.01)
    const cz = Math.floor(zb.z)
    // Where to go: the neighbor one step closer to you, else straight at you.
    let tx = player.x
    let tz = player.z
    let ty = player.y
    // Lured to a block (a bell, bait...): straight there, not by your path.
    const here = player.lure ? undefined : this._flow.get(cellKey(cx, cy, cz))
    if (here !== undefined) {
      let bestD = here
      for (const [nx, ny, nz] of this._neighbors(cx, cy, cz, this._nb || (this._nb = []))) {
        const d = this._flow.get(cellKey(nx, ny, nz))
        if (d !== undefined && d < bestD) {
          bestD = d
          tx = nx + 0.5
          ty = ny
          tz = nz + 0.5
        }
      }
    }
    let dx = tx - zb.x
    let dz = tz - zb.z
    const len = Math.hypot(dx, dz) || 1
    // The brain bends the way (flankers) and sets the pace (lungers).
    const pace = this._zombieBrain(zb, dt, player)
    if (zb.flank > 0) {
      // Forward plus a sideways part (left or right of the way in).
      const fx = dx / len
      const fz = dz / len
      dx = fx - fz * zb.side * zb.flank
      dz = fz + fx * zb.side * zb.flank
    }
    const dist = Math.hypot(dx, dz) || 1
    const want = speed * pace
    zb.vx = THREE.MathUtils.damp(zb.vx, (dx / dist) * want, 10, dt)
    zb.vz = THREE.MathUtils.damp(zb.vz, (dz / dist) * want, 10, dt)
    // Keep a little apart from each other.
    for (const o of this.zombies) {
      if (o === zb) continue
      const ox = zb.x - o.x
      const oz = zb.z - o.z
      const d = Math.hypot(ox, oz)
      if (d > 0.001 && d < 0.6) {
        zb.vx += (ox / d) * (0.6 - d) * 8 * dt * 10
        zb.vz += (oz / d) * (0.6 - d) * 8 * dt * 10
      }
    }
    const onLadder = this._isLadder(cx, cy, cz) || this._isLadder(cx, cy + 1, cz)
    if (onLadder && ty > zb.y - 0.2) zb.vy = CLIMB
    else zb.vy = Math.max(zb.vy - GRAVITY * dt, -40)
    let blocked = false
    let wall = false
    for (const axis of ['x', 'z']) {
      const amount = zb[`v${axis}`] * dt
      if (this._moveZombieAxis(zb, axis, amount)) {
        // A half-block step up happens by itself.
        const q = { x: zb.x, y: zb.y + 0.55, z: zb.z }
        q[axis] += amount
        if (zb.onGround && !this._zombieHits(q.x, q.y, q.z)) {
          zb.y += 0.55
          zb[axis] = q[axis]
          this._moveZombieAxis(zb, 'y', -0.55)
        } else {
          blocked = true
          // A real block in the way, not the camp's edge (that one goes
          // up forever, so a spider climbed it into the sky - 2026-10-26).
          const w = { x: zb.x, z: zb.z }
          w[axis] += Math.sign(amount) * 0.05
          if (this.bm.tryMode._hits(w.x, zb.y, w.z, ZOMBIE_FIT_HEIGHT)) wall = true
        }
      }
    }
    if (blocked) zb.stuck = FLANK_STUCK
    // Zombie spiders walk straight up a wall in the way (ZombieKinds.js).
    const climbing = zb.climbs && wall
    if (climbing) zb.vy = CLIMB * 1.3
    // Jump up a block when it's in the way, or the path goes up.
    if (zb.onGround && (blocked || ty > zb.y + 0.6) && !onLadder && !climbing) {
      zb.vy = JUMP
      zb.onGround = false
    }
    const falling = zb.vy <= 0
    const hitY = this._moveZombieAxis(zb, 'y', zb.vy * dt)
    zb.onGround = hitY && falling
    if (hitY) zb.vy = 0
    // Fell out of the world: gone, but it isn't a kill (2026-10-18 bug -
    // falls counted as kills and finished waves on their own).
    if (zb.y < BOTTOM - 16) {
      zb.lost = true
      zb.health = 0
    }

    // A closed door in the way gets bashed open.
    const ahead = [Math.floor(zb.x + Math.sign(dx) * 0.6), cy, Math.floor(zb.z + Math.sign(dz) * 0.6)]
    if (blocked && this._doorAt(...ahead) && !this.bm.isDoorOpenAt(ahead[0], this._doorBottomY(...ahead), ahead[2])) {
      zb.bash += dt
      if (zb.bash > DOOR_BASH_TIME) {
        zb.bash = 0
        this.bm.toggleDoor(...ahead)
      }
    } else zb.bash = Math.max(0, zb.bash - dt)

    // Hit you when close enough.
    zb.attackCd -= dt
    const px = player.x - zb.x
    const pz = player.z - zb.z
    if (!player.idle && Math.hypot(px, pz) < ATTACK_RANGE && Math.abs(player.y - zb.y) < 1.5 && zb.attackCd <= 0) {
      zb.attackCd = ATTACK_COOLDOWN
      const bite = zombieDamage(this.wave) * this.cfg.zombieDamageMult * (zb.boss ? BOSS_DAMAGE_MULT : 1) * (zb.damageMult || 1)
      if (zb.skel) zb.attackAnim = zb.skel.play('attack', { once: true, fade: 0.08, timeScale: 1.4 })
      // Another player on the server: the bite travels to them (nothing
      // reaches anyone inside the camp).
      if (player.remote) {
        if (!this.camp?.inside(player.x, player.z)) this.net?.queueHurt(player.remote, bite)
      } else this._hurtPlayer(bite)
    }

    // Draw it: facing where it walks, legs and arms swinging.
    const B = this.B
    zb.group.position.set(zb.x * B, zb.y * B, zb.z * B)
    const moveLen = Math.hypot(zb.vx, zb.vz)
    if (moveLen > 0.2) zb.group.rotation.y = Math.atan2(zb.vx, zb.vz)
    zb.walk += dt * moveLen * 3.2
    const swing = Math.sin(zb.walk) * Math.min(1, moveLen / 2) * 0.7
    if (zb.skel) this._skeletonGait(zb, dt, moveLen)
    zb.monster?.update(dt, moveLen)
    if (zb.body) {
      const lp = zb.body.limbPivots
      lp.legR.rotation.x = swing
      lp.legL.rotation.x = -swing
      lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
      lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
    }
    if (zb.flash > 0) zb.flash -= dt
    const red = zb.flash > 0 ? 0.6 : 0
    if (zb.lastRed !== red) {
      zb.lastRed = red
      // A batched body gets its red tint in drawZombies().
      if (!zb.parts) {
        zb.group.traverse((o) => {
          if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(red, 0, 0)
        })
      }
    }
    zb.moan -= dt
    if (zb.moan <= 0) {
      zb.moan = 6 + Math.random() * 10
      if (Math.hypot(px, pz) < 14) audioEngine.playZombieMoan?.(1, this._panTo(zb.x, zb.z))
    }
  }

  // Walk or run to match its speed, once a punch or flinch has played out.
  _skeletonGait(zb, dt, moveLen) {
    for (const key of ['attackAnim', 'hitAnim']) {
      if (zb[key] > 0) zb[key] -= dt
    }
    if (zb.attackAnim > 0 || zb.hitAnim > 0) return
    if (moveLen < 0.15) zb.skel.play('idle')
    else if (moveLen > 2.6) zb.skel.play('run', { timeScale: Math.min(1.4, moveLen / 3.4) })
    else zb.skel.play('walk', { timeScale: Math.max(0.6, Math.min(1.6, moveLen / 1.6)) })
  }

  _doorBottomY(x, y, z) {
    const type = this.bm._blocks.at(x, y, z)
    return this.bm.constructor.blockShape(type) === 'doortop' ? y - 1 : y
  }

  _hurtPlayer(amount) {
    // Spectating: flying about, nothing can hurt you.
    if (this.dead || this.spectating) return
    // Protected by an Infection Cleanser; less behind sandbags (BuildSpecials.js).
    if (this.bm.specials.shielded()) return
    amount *= this.bm.specials.hurtMult()
    // Worn armor (the inventory's armor slots) takes its share first.
    amount *= 1 - (this.inv?.damageCut() || 0)
    const p = this.bm.tryMode.pos
    // Nothing reaches you inside the camp.
    if (this.camp?.inside(p.x, p.z)) return
    this.streak = 0
    this._hurtAt = performance.now()
    // Armor (from the camp's Trader) takes the hit first.
    const soaked = Math.min(this.armor || 0, amount)
    this.armor = (this.armor || 0) - soaked
    this.health = Math.max(0, this.health - (amount - soaked))
    audioEngine.playPlayerHurt?.()
    const flash = document.getElementById('build-play-hurt')
    if (flash) {
      flash.classList.remove('show')
      void flash.offsetWidth
      flash.classList.add('show')
    }
    this._renderHud()
    if (this.health <= 0) this._die()
  }

  // Counts the run once (stats, quests, Legacy Points) - on death, on a
  // win, or when you leave mid-run. Returns what Game.js gave for it.
  _endRun(won) {
    if (this._ended || !this.active) return null
    this._ended = true
    // Counted now, so there's nothing left to carry on.
    if (this.fromMenu && !this.net) BuildSurvival.clearSavedRun()
    // After a respawn on a server only this life's waves count.
    const waves = Math.max(0, (won ? this.wave : this.wave - 1) - (this._lifeStartWave || 0))
    return this._report('end', {
      waves,
      kills: this.kills,
      bestStreak: this.bestStreak,
      headshots: this.stats.headshots,
      chests: this.stats.chests,
      meleeKills: this.stats.meleeKills,
      upgrades: Object.values(this.upgrades || {}).reduce((sum, n) => sum + n, 0),
      bosses: this.bosses,
      skeletonKills: this.stats.skeletonKills || 0,
      assists: this.stats.assists || 0,
      won,
      died: this.dead,
      mode: this.cfg.mode,
      difficulty: this.cfg.difficulty || 'normal',
      seconds: (performance.now() - this._startedAt) / 1000,
      coins: this._coinsEarned,
    })
  }

  _win() {
    this._won = true
    this._die(true)
  }

  _die(won = false) {
    // A Bed you slept in brings you back once (BuildSpecials.js).
    if (!won && this.bm.specials.tryRevive(this)) return
    this.dead = true
    const reward = this._endRun(won)
    const waves = won ? this.wave : Math.max(0, this.wave - 1)
    let best
    try {
      const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}')
      const slot = String(this.bm.activeSlot)
      best = Math.max(all[slot] || 0, waves)
      all[slot] = best
      localStorage.setItem(BEST_KEY, JSON.stringify(all))
    } catch {
      best = waves
    }
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    const extracted = won && this.cfg.mode === 'zombieExtraction'
    set('build-play-over-title', t(extracted ? 'extractionWinTitle' : won ? 'buildPlayOverWinTitle' : 'buildPlayOverTitle'))
    set('build-play-over-text', t(extracted ? 'extractionWinText' : won ? 'buildPlayOverWinText' : 'buildPlayOverText', { waves, kills: this.kills }))
    set('build-play-over-best', `${t('buildPlayOverBest', { n: best })}${reward?.legacy ? ` · ${t('buildPlayOverLegacy', { n: reward.legacy })}` : ''}${reward?.xp ? ` · ${t('buildPlayOverXp', { n: reward.xp })}` : ''}`)
    // Dying: the run goes on from a fresh spawn or you leave, so say that
    set('build-play-again-btn', t(won ? 'buildPlayAgainBtn' : 'buildPlayRespawnBtn'))
    set('build-play-back-btn', t(!this.fromMenu ? 'buildPlayBackBtn' : won ? 'buildPlayBackMenuBtn' : 'buildPlayLeaveBtn'))
    this._overEl.style.display = 'flex'
    if (document.pointerLockElement) document.exitPointerLock()
    this._showXpBar(reward)
  }

  // Kirka-style XP bar on the You Died card (2026-10-26, Gaymi): it fills
  // from where your level was to where it is now; each time it reaches
  // the end it starts again, and once it's done a LEVEL UP card pops up
  // with the new level and the coins it gave (ProgressUI 'end').
  _showXpBar(reward) {
    const box = document.getElementById('build-play-xp')
    if (!box) return
    cancelAnimationFrame(this._xpAnim || 0)
    document.getElementById('build-play-levelup').style.display = 'none'
    const from = reward?.levelBefore
    const to = reward?.levelAfter
    if (!from || !to || !reward.xp) { box.style.display = 'none'; return }
    box.style.display = ''
    const levelEl = document.getElementById('build-play-xp-level')
    const numEl = document.getElementById('build-play-xp-num')
    const fill = document.getElementById('build-play-xp-fill')
    const fmt = (n) => Math.round(n).toLocaleString()
    // One stretch per level the bar passes through: from a to b XP into it.
    const legs = []
    for (let lv = from.level; lv <= to.level; lv++) {
      legs.push({ lv, a: lv === from.level ? from.into : 0, b: lv === to.level ? to.into : xpToNextLevel(lv) })
    }
    const draw = (lv, into) => {
      const need = xpToNextLevel(lv)
      levelEl.textContent = t('levelsLevel', { n: lv })
      numEl.textContent = t('levelsProgress', { into: fmt(into), need: fmt(need), next: lv + 1 })
      fill.style.width = `${Math.min(100, (into / need) * 100)}%`
    }
    let leg = 0
    let start = performance.now()
    const LEG_MS = 900
    const step = (now) => {
      const L = legs[leg]
      const k = Math.min(1, (now - start) / LEG_MS)
      draw(L.lv, L.a + (L.b - L.a) * (1 - (1 - k) * (1 - k)))
      if (k < 1) { this._xpAnim = requestAnimationFrame(step); return }
      if (leg < legs.length - 1) {
        leg++
        start = now
        this._xpAnim = requestAnimationFrame(step)
        return
      }
      if (to.level > from.level) this._showLevelUp(to.level, reward.levelCoins)
    }
    draw(from.level, from.into)
    this._xpAnim = requestAnimationFrame(step)
  }

  _showLevelUp(level, coins) {
    const pop = document.getElementById('build-play-levelup')
    if (!pop) return
    document.getElementById('build-play-levelup-title').textContent = t('levelUpTitle')
    document.getElementById('build-play-levelup-num').textContent = String(level)
    document.getElementById('build-play-levelup-reward').textContent = coins ? t('levelUpReward', { n: coins.toLocaleString() }) : ''
    document.getElementById('build-play-levelup-ok').textContent = t('levelUpOk')
    pop.style.display = 'flex'
    try { audioEngine.playLevelUp?.() } catch { /* no audio */ }
  }

  // Each frame while playing (after Try Map has moved you).
  update(dt) {
    if (!this.active) return
    this._updateCorpses(Math.min(dt, 0.1))
    this._fx?.update(Math.min(dt, 0.1))
    this.damageNumbers?.update(Math.min(dt, 0.1))
    this._updateOwnBubble(Math.min(dt, 0.1))
    this.throws?.update(Math.min(dt, 0.1))
    // On a server the world goes on while you're dead or in the menu.
    const net = this.net && !this.net.closed ? this.net : null
    if (net) net.update(Math.min(dt, 0.25))
    if (!net && (this.dead || this.bm.menuOpen)) return
    // Nothing happens until a weapon has been picked.
    if (this._picking && !net) return
    dt = Math.min(dt, 1 / 20)
    const playing = !this.dead && !this.bm.menuOpen && !this._picking
    if (playing) this._updateMe(dt)
    if (playing) this._drops?.update(dt)
    // On a server the host runs the animals for everyone (even while dead
    // or in the menu); the others mirror them.
    if (net && !net.isHost) this.animals?.updateMirror(dt)
    else if (playing || net) this.animals?.update(dt)
    if (!this.bm.menuOpen) this._updateFires(dt)
    if (net && !net.isHost) {
      this._updateMirroredZombies(dt)
      return
    }
    this._updateWorld(dt, playing)
  }

  // My own things: firing held, the camp, healing, messages, reloading.
  _updateMe(dt) {
    // Automatic guns keep firing while the button is held.
    if (this.bm._fireHeld && this.weapon.auto && document.pointerLockElement) this.bm.tryMode.fire()
    if (this.camp) {
      this.camp.update(dt)
      this.camp.checkQuests()
    }
    // Healing: Health Regen out of combat, and inside Map 1's camp.
    const nowMs = performance.now()
    if (this.health < this.maxHealth) {
      const tp = this.bm.tryMode.pos
      let heal = 0
      if (this.cfg.regen && nowMs - this._hurtAt > REGEN_DELAY * 1000) heal += REGEN_PER_SECOND
      if (this.camp?.inside(tp.x, tp.z)) heal += this.cfg.campHealRate
      if (heal) {
        this.health = Math.min(this.maxHealth, this.health + heal * dt)
        this._renderHud()
      }
    }
    if ((this.cfg.mode === 'zombieRush' || this.cfg.noZombies) && Math.floor(nowMs / 1000) !== this._lastSecond) {
      this._lastSecond = Math.floor(nowMs / 1000)
      this._renderHud()
    }
    if (this._msgLeft > 0) {
      this._msgLeft -= dt
      if (this._msgLeft <= 0) {
        const el = document.getElementById('build-play-msg')
        if (el) el.style.opacity = '0'
      }
    }
    if (this._reloadLeft > 0) {
      this._reloadLeft -= dt
      if (this._reloadLeft <= 0) {
        const take = Math.min(this.magSize() - this.mag, this.reserve)
        this.mag += take
        this.reserve -= take
      }
      this._renderHud()
    }
  }

  // A zombie's brain (see BRAIN_ROLES): picks its role once, re-thinks every
  // BRAIN_THINK seconds, and returns its speed multiplier for this frame.
  _zombieBrain(zb, dt, player) {
    if (!zb.role) {
      let roll = Math.random()
      zb.role = 'rusher'
      for (const [role, chance] of BRAIN_ROLES) {
        if (roll < chance) {
          zb.role = role
          break
        }
        roll -= chance
      }
      if (zb.boss) zb.role = 'rusher'
      this._brainSide = -(this._brainSide || 1)
      zb.side = this._brainSide
      zb.flankAmt = 0.7 + Math.random() * 0.5
      zb.think = Math.random() * BRAIN_THINK
      zb.flank = 0
      zb.stuck = 0
      zb.lunge = 0
      zb.lungeCd = Math.random() * LUNGE_EVERY
    }
    zb.stuck = Math.max(0, zb.stuck - dt)
    zb.lungeCd -= dt
    zb.lunge = Math.max(0, zb.lunge - dt)
    zb.think -= dt
    if (zb.think <= 0) {
      zb.think = BRAIN_THINK
      const d = Math.hypot(player.x - zb.x, player.z - zb.z)
      const far = THREE.MathUtils.clamp((d - FLANK_NEAR) / (FLANK_FAR - FLANK_NEAR), 0, 1)
      zb.flank = zb.role === 'flanker' && !player.idle && zb.stuck <= 0 ? far * zb.flankAmt : 0
      if (zb.role === 'lunger' && !player.idle && d < LUNGE_RANGE && zb.lungeCd <= 0) {
        zb.lunge = LUNGE_TIME
        zb.lungeCd = LUNGE_EVERY
      }
    }
    if (zb.stuck > 0) zb.flank = 0
    return zb.lunge > 0 ? LUNGE_MULT : 1
  }

  // Where I stand for the zombies (and the server). Spectating, it's the
  // spot I flew off from - zombies can't see the free camera, so they
  // stop following it around (2026-10-18, Gaymi: "in spectating mode
  // don't make zombies be able to see you").
  bodyPos() {
    const saved = this.spectating && this.bm.spectate?._savedPos
    return saved || this.bm.tryMode.pos
  }

  // Who the zombies chase: me (unless dead) and, on a server, every other
  // living player. Each: { x, y, z, remote } in blocks (remote = their id).
  _targets() {
    const out = []
    if (!this.dead && !this._picking) {
      const p = this.bodyPos()
      out.push({ x: p.x, y: p.y, z: p.z, remote: null })
    }
    if (this.net && !this.net.closed) out.push(...this.net.targets())
    return out
  }

  // The zombies and the waves (alone, or as a server's host).
  _updateWorld(dt) {
    const targets = this._targets()
    const now = performance.now() / 1000
    const sources = targets.map((p) => this._playerCell(p))
    const key = sources.map((c) => c.join(',')).join(';')
    if (this._flowJob) {
      this._stepFlow(FLOW_BUDGET_MS)
    } else if (sources.length && (now - this._flowAt > PATH_REFRESH || this._flowKey !== key)) {
      this._flowAt = now
      this._flowKey = key
      // The first field is needed right away (zombies spawn from it).
      if (this._flow.size === 0) this._rebuildFlow(sources)
      else {
        this._startFlow(sources)
        this._stepFlow(FLOW_BUDGET_MS)
      }
    }
    // Waves (none in World Map - just exploring, NO_ZOMBIE_MODES).
    if (this.cfg.noZombies) {
      // Nothing to count down or spawn.
    } else if (this._toSpawn === 0) {
      if (this._breakTimer > 0) {
        const shown = Math.ceil(this._breakTimer)
        this._breakTimer -= dt
        if (this._breakTimer <= 0) this._startWave(this.wave + 1)
        else if (Math.ceil(this._breakTimer) !== shown) this._renderHud()
      } else {
        const rush = this.cfg.mode === 'zombieRush'
        this._breakTimer = rush ? RUSH_WAVE_BREAK : WAVE_BREAK
        if (this.wave > 0) {
          this._earn(COIN_PER_WAVE)
          // Zombie Defense: the last wave held is a win.
          if (this.cfg.mode === 'zombieDefense' && this.wave >= DEFENSE_WAVES) {
            this._win()
            return
          }
          // Zombie Extraction: the helicopter comes after enough waves.
          if (this.cfg.mode === 'zombieExtraction' && this.wave >= EXTRACTION_WAVES && !this._extract) this._placeExtraction()
          if (!rush) this._message(t('buildPlayWaveClear', { n: this.wave, s: WAVE_BREAK }))
        }
      }
    }
    if (this._toSpawn > 0 && this.zombies.length < aliveCap(this.wave) * Math.max(1, this.cfg.zombieCountMult) && sources.length) {
      this._spawnTimer -= dt
      if (this._spawnTimer <= 0 && this._skin !== undefined) {
        this._spawnTimer = SPAWN_GAP * (this.cfg.mode === 'zombieRush' ? RUSH_SPAWN_GAP_MULT : 1)
        this._spawnZombie()
        this._renderHud()
      }
    }
    if (this._extract && this._updateExtraction(dt)) return
    const speed = zombieSpeed(this.wave, this.cfg.escalation)
    for (const zb of [...this.zombies]) {
      // Each zombie goes for the nearest player.
      let target = null
      let best = Infinity
      for (const p of targets) {
        const d = (p.x - zb.x) ** 2 + (p.z - zb.z) ** 2 + (p.y - zb.y) ** 2
        if (d < best) {
          best = d
          target = p
        }
      }
      // Too far from every player (left behind): it goes, and a new one
      // comes from near you instead.
      if (targets.length && best > DESPAWN_DIST * DESPAWN_DIST) {
        zb.lost = true
        zb.health = 0
      } else this._updateZombie(zb, dt, this.bm.specials.zombieTarget(zb, target) || target || { x: zb.x, y: zb.y, z: zb.z, idle: true }, speed)
      if (zb.health <= 0 && this.zombies.includes(zb)) this.damageZombie(zb, 0)
      if (this.dead && !this.net) return
    }
  }

  _startWave(n) {
    this.wave = n
    this._toSpawn = Math.max(1, Math.round(waveSize(this.wave) * this.cfg.zombieCountMult))
    this._bossPending = this.cfg.bossEvery && this.wave % this.cfg.bossEvery === 0 ? 1 : 0
    this._chestsUsed.clear()
    this._message(t('buildPlayWaveStart', { n: this.wave }))
    this._report('wave', { wave: this.wave, difficulty: this.cfg.difficulty || 'normal', mutators: this.cfg.mutators || [], mode: this.cfg.mode })
    this._renderHud()
  }

  // --- Zombie Extraction ---

  // Where the helicopter lands: an open street cell (sky above it) that
  // zombies can walk to, EXTRACTION_MIN..MAX blocks of walking from you,
  // outside the camp. Falls back to the farthest reachable open cell.
  _placeExtraction() {
    const B = this.B
    // Open sky over the spot and room for the helicopter around it (a
    // 5x5 patch clear up high - it first landed in narrow alleys, half
    // inside the walls).
    const clear = (x, y, z, from) => {
      for (let dy = from; dy <= 14; dy++) if (this.bm.getBlockAt(x, y + dy, z)) return false
      return true
    }
    const open = (x, y, z) => {
      if (this.camp?.inside(x + 0.5, z + 0.5, 3)) return false
      if (!clear(x, y, z, 0)) return false
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) if (!clear(x + dx, y, z + dz, 1)) return false
      }
      return true
    }
    const good = []
    let far = null
    let farD = -1
    let any = null
    let anyD = -1
    for (const [key, d] of this._flow) {
      const [x, y, z] = cellOf(key)
      // A map with no open space at all still gets its helicopter.
      if (d > anyD && !this.camp?.inside(x + 0.5, z + 0.5, 1)) {
        anyD = d
        any = [x, y, z]
      }
      if (!open(x, y, z)) continue
      if (d >= EXTRACTION_MIN && d <= EXTRACTION_MAX) good.push([x, y, z])
      if (d > farD) {
        farD = d
        far = [x, y, z]
      }
    }
    const spot = good.length ? good[Math.floor(Math.random() * good.length)] : far || any
    if (!spot) return
    const [x, y, z] = spot
    const group = new THREE.Group()
    group.position.set((x + 0.5) * B, y * B, (z + 0.5) * B)
    // A glowing landing ring and a light beam you can see over the roofs.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(EXTRACTION_RADIUS * B * 0.86, EXTRACTION_RADIUS * B, 40),
      new THREE.MeshBasicMaterial({ color: 0xff4a2e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06 * B
    group.add(ring)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35 * B, 0.35 * B, 40 * B, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    beam.position.y = 20 * B
    group.add(beam)
    // The helicopter, hovering low over the ring: body, cockpit glass,
    // tail boom and fin, skids, and a turning rotor.
    const heli = new THREE.Group()
    const body = new THREE.MeshLambertMaterial({ color: 0x3d4a2c })
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1f1a })
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fb8c9, emissive: 0x22333a })
    const box = (w, h, d, mat, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(px * B, py * B, pz * B)
      heli.add(m)
      return m
    }
    box(2.2, 1.4, 3.4, body, 0, 1.2, 0)
    box(1.9, 0.9, 1.0, glass, 0, 1.45, 1.75)
    box(0.5, 0.5, 3.6, body, 0, 1.5, -3.4)
    box(0.15, 1.1, 0.8, body, 0, 2.0, -5.0)
    box(0.15, 0.15, 3.6, dark, -0.9, 0.2, 0)
    box(0.15, 0.15, 3.6, dark, 0.9, 0.2, 0)
    box(0.15, 0.45, 0.15, dark, -0.9, 0.45, 1)
    box(0.15, 0.45, 0.15, dark, 0.9, 0.45, 1)
    box(0.15, 0.45, 0.15, dark, -0.9, 0.45, -1)
    box(0.15, 0.45, 0.15, dark, 0.9, 0.45, -1)
    box(0.3, 0.4, 0.3, dark, 0, 2.1, 0)
    const rotor = new THREE.Group()
    rotor.position.y = 2.35 * B
    for (const r of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(7 * B, 0.06 * B, 0.35 * B), dark)
      blade.rotation.y = r
      rotor.add(blade)
    }
    heli.add(rotor)
    heli.position.y = 0.35 * B
    heli.rotation.y = Math.random() * Math.PI * 2
    group.add(heli)
    this.bm.scene.add(group)
    this._extract = { x: x + 0.5, y, z: z + 0.5, group, rotor, ring, hold: 0, dist: null }
    this._message(t('extractionReady'), 4)
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    this._renderHud()
  }

  // Each frame once the helicopter is down: spin the rotor, and count up
  // while you stand on the ring (alive). Leaving it starts the count over.
  // True once you're out (the run is won).
  _updateExtraction(dt) {
    const ex = this._extract
    ex.rotor.rotation.y += dt * 14
    ex.ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 200)
    const p = this.bm.tryMode.pos
    const dist = Math.hypot(p.x - ex.x, p.z - ex.z)
    const was = Math.round(ex.dist ?? -1)
    ex.dist = dist
    const on = !this.dead && dist <= EXTRACTION_RADIUS && Math.abs(p.y - ex.y) < 2.5
    const before = Math.ceil(EXTRACTION_HOLD - ex.hold)
    if (on) ex.hold += dt
    else ex.hold = 0
    if (ex.hold >= EXTRACTION_HOLD) {
      this._win()
      return true
    }
    if (Math.round(dist) !== was || Math.ceil(EXTRACTION_HOLD - ex.hold) !== before) this._renderHud()
    return false
  }

  _disposeExtraction() {
    const ex = this._extract
    this._extract = null
    if (!ex) return
    this.bm.scene.remove(ex.group)
    ex.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }

  // --- servers (PlayNet.js) ---

  // What the host sends: every zombie, keyed "z<id>".
  zombieSnapshot() {
    const out = {}
    for (const z of this.zombies) {
      out[`z${z.id}`] = { x: +z.x.toFixed(2), y: +z.y.toFixed(2), z: +z.z.toFixed(2), r: +z.group.rotation.y.toFixed(2), hp: Math.round(z.health), max: Math.round(z.maxHealth || z.health), boss: !!z.boss, ...(z.kind ? { k: z.kind } : {}), rt: z.tier || 'common', nm: z.nameIdx ?? 0 }
    }
    return out
  }

  // Not the host: the host's zombies (made, moved, removed) and wave.
  _applyZombieSnapshot(zs, wave) {
    const seen = new Set()
    for (const [key, d] of Object.entries(zs)) {
      const id = Number(key.slice(1))
      if (!Number.isFinite(id)) continue
      seen.add(id)
      let z = this.zombies.find((o) => o.id === id)
      if (!z) {
        z = this._makeZombie(id, d.x, d.y, d.z, d.hp, d.boss, kindOf(d.k) ? d.k : null, { tier: d.rt, name: d.nm })
        z.group.position.set(d.x * this.B, d.y * this.B, d.z * this.B)
      }
      z.tx = d.x
      z.ty = d.y
      z.tz = d.z
      z.tr = d.r
      if (d.hp < z.health) {
        z.flash = 0.12
        // Spectating, everyone's hits show (my own show where I fire).
        if (this.spectating) this.damageNumbers?.atZombie(z, z.health - d.hp, '', ZOMBIE_HEIGHT)
      }
      z.health = d.hp
      z.maxHealth = d.max
    }
    for (const z of [...this.zombies]) {
      if (seen.has(z.id)) continue
      this._spawnCorpse(z, null)
      this._removeZombie(z)
      this.zombies = this.zombies.filter((o) => o !== z)
    }
    if (wave !== this.wave) {
      // The waves I've lived through pay like my own.
      if (wave > this.wave && this.wave > 0) this._earn(COIN_PER_WAVE)
      if (wave > 0) this._startWave(wave)
      this._toSpawn = 0
    }
    this._renderHud()
  }

  // Not the host: slide the host's zombies to where they are, walking.
  _updateMirroredZombies(dt) {
    const k = 1 - Math.exp(-12 * dt)
    const B = this.B
    for (const z of this.zombies) {
      if (z.tx === undefined) continue
      const ox = z.x
      const oz = z.z
      z.x += (z.tx - z.x) * k
      z.y += (z.ty - z.y) * k
      z.z += (z.tz - z.z) * k
      z.group.position.set(z.x * B, z.y * B, z.z * B)
      let dr = (z.tr || 0) - z.group.rotation.y
      dr = Math.atan2(Math.sin(dr), Math.cos(dr))
      z.group.rotation.y += dr * k
      const moveLen = dt > 0 ? Math.hypot(z.x - ox, z.z - oz) / dt : 0
      if (z.skel) {
        z.skel.update(dt)
        if (z.rise > 0) {
          z.rise -= dt
          if (z.rise <= 0) z.skel.play('walk')
        } else this._skeletonGait(z, dt, moveLen)
      }
      z.monster?.update(dt, moveLen)
      z.walk += dt * moveLen * 3.2
      const swing = Math.sin(z.walk) * Math.min(1, moveLen / 2) * 0.7
      if (z.body) {
        const lp = z.body.limbPivots
        lp.legR.rotation.x = swing
        lp.legL.rotation.x = -swing
        lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
        lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
      }
      if (z.flash > 0) z.flash -= dt
      const red = z.flash > 0 ? 0.6 : 0
      if (z.skel && z.lastRed !== red) {
        for (const m of z.skel.materials) m.emissive?.setRGB(red, 0, 0)
      }
      if (z.monster && z.lastRed !== red) {
        for (const m of z.monster.materials) m.emissive.setRGB(red, 0, 0)
      }
      z.lastRed = red
    }
  }

  // The host: other players' hits on my zombies (and animals).
  _applyRemoteHits(hits) {
    for (const h of hits) {
      if (String(h.id)[0] === 'a') {
        this.animals?.remoteHit(h)
        continue
      }
      const id = Number(String(h.id).slice(1))
      const z = this.zombies.find((o) => o.id === id)
      if (z) this.damageZombie(z, Number(h.dmg) || 0, null, h.by)
    }
  }

  // I just became (or stopped being) the host.
  _onHostChange(isHost) {
    if (isHost) {
      // The sky and animals are mine to run now.
      this.bm.sky?.follow?.(null)
      this.animals?.takeOver()
      // Carry on with the zombies as they are now.
      this._zid = Math.max(this._zid || 0, ...this.zombies.map((z) => z.id))
      for (const z of this.zombies) {
        if (z.tx !== undefined) {
          z.x = z.tx
          z.y = z.ty
          z.z = z.tz
        }
        z.vx = 0
        z.vz = 0
        z.vy = 0
      }
      this._toSpawn = 0
      this._breakTimer = this.zombies.length ? 0 : WAVE_BREAK
      this._message(t('serverYouHost'))
    }
  }

  // The server closed or can't be reached: carry on alone.
  _onServerLost(text) {
    this.net = null
    this.bm.sky?.follow?.(null)
    this.animals?.takeOver()
    this._message(text, 4)
    for (const z of [...this.zombies]) this._removeZombie(z)
    this.zombies = []
    this._toSpawn = 0
    this._breakTimer = WAVE_BREAK
  }

  // A block placed (b: its id) or broken (b: '') - shared on a server.
  _recordEdit(x, y, z, b) {
    if (!this.active || !this._edits) return
    this._edits.set(this.bm._key(x, y, z), b || '')
    const net = this.net && !this.net.closed ? this.net : this.lobby && !this.lobby.closed ? this.lobby : null
    net?.queueEdit(x, y, z, b || '')
  }

  // Blocks the other players placed and broke (everything so far, the
  // first time).
  _applyRemoteEdits(list) {
    const bm = this.bm
    const tm = bm.tryMode
    bm._suppressUndoRecording = true
    try {
      for (const e of list) {
        const x = Math.round(e.x)
        const y = Math.round(e.y)
        const z = Math.round(e.z)
        const key = bm._key(x, y, z)
        const here = bm.getBlockAt(x, y, z)
        if (e.b) {
          if (here === e.b || !bm.knowsBlock(e.b)) continue
          if (here) tm.breakQuietly(x, y, z)
          bm.placeBlock(x, y, z, e.b, false)
          // It goes again when the game ends, like my own.
          this._placed.set(key, e.b)
        } else if (here) {
          if (this._placed.delete(key)) bm.removeBlock(x, y, z)
          else tm.breakQuietly(x, y, z)
          this._fires?.delete(key)
        } else if (bm.world?.active) {
          // Land that hasn't grown here yet: it never grows that cell.
          bm.world.touched(x, y, z, key, true)
          bm.world.removed.add(key)
        }
      }
    } finally {
      bm._suppressUndoRecording = false
    }
  }

  // Chat: what I said shows over my own body too (seen in the
  // third-person views) and goes to the others on a server.
  onChatSent(text) {
    if (!this.active || !text) return
    const net = this.net && !this.net.closed ? this.net : this.lobby && !this.lobby.closed ? this.lobby : null
    net?.say(text)
    if (this._ownBubble) disposeBubble(this._ownBubble.sprite)
    this._ownBubble = { sprite: speechBubble(text, this.B), left: bubbleSeconds(text) }
  }

  _updateOwnBubble(dt) {
    const b = this._ownBubble
    if (!b) return
    const group = this.bm.tryMode._body?.group
    if (group && b.sprite.parent !== group) group.add(b.sprite)
    if ((b.left -= dt) > 0) return fadeBubble(b.sprite, b.left)
    disposeBubble(b.sprite)
    this._ownBubble = null
  }

  // On a server, Play Again after dying: up again at the start, same game.
  _respawn() {
    const start = this._findBlocks('playerstart')[0] || this._defaultStart()
    if (start) {
      const [x, y, z] = start
      this.bm.tryMode.pos.set(x + 0.5, y, z + 0.5)
      this.bm.tryMode.vel.set(0, 0, 0)
    }
    this.dead = false
    // A new life: the run already counted at death starts over from here.
    this._ended = false
    this._lifeStartWave = Math.max(0, this.wave - 1)
    this._startedAt = performance.now()
    this.kills = 0
    this.stats = { kills: 0, chests: 0, headshots: 0, meleeKills: 0, skeletonKills: 0, assists: 0 }
    this.bestStreak = 0
    this.bosses = 0
    this._coinsEarned = 0
    this.health = this.maxHealth
    this.mag = this.magSize()
    this.reserve = this._startReserve()
    this._reloadLeft = 0
    this.streak = 0
    this._overEl.style.display = 'none'
    this._renderHud()
  }
}

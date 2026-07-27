import * as THREE from 'three'
import { flatMaterial, LOW_QUALITY_MODE } from './QualitySettings.js'
import { Zombie } from './Zombie.js'
import { pickZombieType, ZOMBIE_TYPES } from './ZombieTypes.js'
import { audioEngine } from './Audio.js'
import { getZoneAt } from './Zones.js'
import { CachedColliderGrid } from './ColliderGrid.js'

// Cut under LOW_QUALITY_MODE (bare-bones mode) - fewer simultaneous
// zombies to begin with, each one real per-frame AI/collision/animation
// cost, on top of (not instead of) the reactive performanceCap governor
// (see Game.js), which only kicks in after fps is already struggling.
const BASE_SPAWN_COUNT = LOW_QUALITY_MODE ? 5 : 9
const MAX_SPAWN_COUNT = LOW_QUALITY_MODE ? 10 : 18
const SPAWN_RADIUS_MIN = 20
const SPAWN_RADIUS_MAX = 44
const AMBUSH_RADIUS_MIN = 7
const AMBUSH_RADIUS_MAX = 26
// Hivemind boss aura proximity radius - matches Zombie.js's own
// HIVEMIND_SPEED_MULT value (kept as separate same-value constants rather
// than a shared export, same as every other small per-file magic number
// in this class).
const HIVEMIND_RADIUS = 14
// Burrower type (see ZombieTypes.js) - always ambushes, and much closer
// than even the normal ambush range, so it reads as a genuine "right on
// top of you" surprise instead of the standard hide-and-wait every other
// melee type already rolls for sometimes.
const BURROWER_RADIUS_MIN = 4
const BURROWER_RADIUS_MAX = 9
const BASE_AMBUSH_CHANCE = 0.55
const MAX_AMBUSH_CHANCE = 0.85
const BASE_RESPAWN_DELAY = 8
const MIN_RESPAWN_DELAY = 3
const REMOVE_AFTER_DEATH_MS = 3000
const PROJECTILE_HIT_RADIUS = 1.7
const MOAN_RADIUS = 26
const MOAN_MIN_DELAY_MS = 4500
const MOAN_MAX_DELAY_MS = 9500
const NOISEMAKER_THROW_SPEED = 14
const NOISEMAKER_DISTRACTION_MS = 9000
const GRENADE_THROW_SPEED = 16
const GRENADE_DAMAGE_RADIUS = 5
const GRENADE_DAMAGE_MIN = 80
const GRENADE_DAMAGE_MAX = 220
const KNIFE_SPEED = 30
const KNIFE_HIT_RADIUS = 1.4
const KNIFE_DAMAGE = 500
const MOLOTOV_THROW_SPEED = 15
const MOLOTOV_FIRE_RADIUS = 3.5
const MOLOTOV_FIRE_DURATION_MS = 6000
const MOLOTOV_TICK_MS = 500
const MOLOTOV_DAMAGE_PER_TICK = 12
const C4_THROW_SPEED = 15
const C4_DAMAGE_RADIUS = 6.5
const C4_DAMAGE_MIN = 140
const C4_DAMAGE_MAX = 320
const EMP_THROW_SPEED = 16
const EMP_STUN_RADIUS = 6
const EMP_STUN_DURATION_MS = 4500
const ELITE_CHANCE = 0.08
// Boss "adds" - periodically summons a handful of regular zombies while
// still alive, so a boss fight isn't purely a 1v1 damage race and
// barricades/traps stay relevant even during it. See _spawnBoss/
// spawnGuardian (which arm the timer) and the summon check in update().
const BOSS_ADD_FIRST_DELAY_MS = 18000
const BOSS_ADD_INTERVAL_MS = 22000
const BOSS_ADD_COUNT_MIN = 2
const BOSS_ADD_COUNT_MAX = 4
const BOSS_ADD_SPAWN_RADIUS = 5
const TITAN_CHECK_MIN_DELAY_MS = 90000
const TITAN_CHECK_MAX_DELAY_MS = 150000
const TITAN_SPAWN_CHANCE = 0.4
const HORDE_SPAWN_RADIUS_MIN = 10
const HORDE_SPAWN_RADIUS_MAX = 22

// Wandering horde event - a distinct pack that migrates across the map on
// its own schedule instead of being ambient population that always beelines
// the player. Shown as a minimap/compass marker (see Game.js's
// _updateMinimap/_updateCompass) so the player can choose to intercept it
// for a per-kill points bonus or just let it pass by.
const HORDE_EVENT_MIN_DELAY_MS = 60000
const HORDE_EVENT_MAX_DELAY_MS = 120000
const HORDE_EVENT_SIZE_MIN = 6
const HORDE_EVENT_SIZE_MAX = 10
const HORDE_EVENT_SPAWN_RADIUS = 40
const HORDE_EVENT_WANDER_SPEED = 1.6
const HORDE_EVENT_AGGRO_RADIUS = 16

// Round Mode (Obsidian Ops-style kill-to-advance loop, see Game.js's
// settings.mutators.roundMode): count scales roughly linearly with round
// number rather than the small fixed band timed-night difficulty uses, so
// it's capped well above MAX_SPAWN_COUNT to actually keep growing round over
// round without either exploding perf at high rounds or plateauing too soon.
// Cut under LOW_QUALITY_MODE - same reasoning as BASE_SPAWN_COUNT above.
const ROUND_SPAWN_COUNT_MULT = LOW_QUALITY_MODE ? 2 : 3.6
const ROUND_MAX_SPAWN_COUNT = LOW_QUALITY_MODE ? 20 : 50
const ROUND_HEALTH_RAMP_START = 10
const ROUND_HEALTH_RAMP_MULT = 1.1
// See startRound()'s own comment - caps the ramp's exponent (not the
// resulting multiplier) so it plateaus at 1.1^30 =~ 17.4x instead of
// compounding forever.
const ROUND_HEALTH_RAMP_EXPONENT_CAP = 30

const projectileMat = flatMaterial({
  color: 0x2f4a12,
  emissive: 0x9fe23f,
  emissiveIntensity: 1.8,
})

const noisemakerMat = flatMaterial({
  color: 0x8a8478,
  emissive: 0xd8cfa0,
  emissiveIntensity: 0.4,
  roughness: 0.5,
  metalness: 0.4,
})

const grenadeMat = flatMaterial({
  color: 0x3a4a2e,
  roughness: 0.6,
  metalness: 0.3,
})

const knifeMat = flatMaterial({
  color: 0xc4c4c0,
  roughness: 0.3,
  metalness: 0.8,
})

const molotovMat = flatMaterial({
  color: 0x3a2a1a,
  emissive: 0xff6a1a,
  emissiveIntensity: 0.6,
  roughness: 0.4,
})

const fireZoneMat = flatMaterial({
  color: 0xff4a1a,
  emissive: 0xff6a1a,
  emissiveIntensity: 2,
  transparent: true,
  opacity: 0.55,
  side: THREE.DoubleSide,
})

const c4Mat = flatMaterial({
  color: 0x2a2a2a,
  emissive: 0xff2222,
  emissiveIntensity: 0.5,
  roughness: 0.5,
  metalness: 0.4,
})

const empMat = flatMaterial({
  color: 0x2a3a44,
  emissive: 0x4ecfff,
  emissiveIntensity: 1.2,
  roughness: 0.3,
  metalness: 0.6,
})

const EXPLOSION_FX_MS = 350
const SCREAM_FX_MS = 450

export class ZombieManager {
  constructor(scene, spawnRateMult = 1, colliders = [], solidMeshes = []) {
    this.scene = scene
    // World collision/raycast geometry, the same lists PlayerController
    // uses - so zombies stop clipping through buildings/cars/tunnel walls,
    // and can't melee through a wall/floor they have no line of sight
    // through (see Zombie.js's _tryMove/_hasLineOfSight).
    this.colliders = colliders
    this.solidMeshes = solidMeshes
    // Performance: with 14 stages' worth of world geometry, `colliders` can
    // hold 900+ boxes, and every zombie's own _tryMove used to linear-scan
    // the ENTIRE array up to 3 times per frame (already-stuck check + X move
    // + Z move) - a real, CPU-side, purely-collision cost completely
    // separate from (and not fixed by) any rendering/culling optimization.
    // See ColliderGrid.js - PlayerController uses the exact same class for
    // the exact same reason.
    this._colliderGrid = new CachedColliderGrid(colliders)
    this.zombies = []
    this.projectiles = []
    this.explosionFx = []
    this.screamFx = []
    this.noisemakerThrows = []
    this.grenadeThrows = []
    this.knifeThrows = []
    this.molotovThrows = []
    this.fireZones = []
    this.c4Throws = []
    this.placedC4 = null
    this.empThrows = []
    this.empBursts = []
    this.distraction = null
    // Queued burst-spawns (round-clear waves, etc.) - see update()'s own
    // note on why these get spread across several frames instead of
    // constructing every zombie in one single-frame loop.
    this._pendingSpawns = 0
    // Same idea as _pendingSpawns above, but for location-targeted bursts
    // (see spawnAt) - a list of {x, z} spots instead of a plain count,
    // since each entry needs its own fixed position rather than a random
    // one near the player.
    this._pendingLocationSpawns = []
    // Real-fps-driven ceiling on simultaneous zombie count - see Game.js's
    // own note (its _tick sets this every ~500ms based on measured fps).
    // Matches ROUND_MAX_SPAWN_COUNT (effectively uncapped) until fps
    // actually says otherwise.
    this.performanceCap = ROUND_MAX_SPAWN_COUNT
    this.elapsed = 0
    this.lastPlayerPos = { x: 0, z: 0 }
    this.pendingRespawns = []

    this.spawnRateMult = spawnRateMult
    // Difficulty-preset knobs (Game.js sets these right after construction
    // and again live if the player changes difficulty mid-run) - default
    // to neutral so anything constructing a ZombieManager without setting
    // them (fake test stubs, etc.) behaves exactly as before this existed.
    this.healthMult = 1
    // Nightly mutation roll (see NightEvents.js's NIGHT_MUTATIONS) - reset
    // fresh every night rather than multiplied in place, so it can never
    // compound across nights.
    this.speedMult = 1
    this.eliteChanceMult = 1
    this.currentNight = 1
    this.bossSpawnedForNight = 0
    // Director AI multiplier (see Game.js's _updateDirectorAI, which calls
    // setDirectorMult) - 1 is neutral, applied on top of the normal
    // night-based curve in _recomputeDifficulty rather than replacing it.
    this.directorMult = 1
    this.targetCount = Math.round(BASE_SPAWN_COUNT * this.spawnRateMult)
    // Kept in sync with targetCount here too - _recomputeDifficulty only
    // runs on an explicit night-advance, which a fresh night-1 game may
    // never trigger, so _applyZoneDensity needs a real baseline from the
    // start rather than waiting on that to fire.
    this.baseTargetCount = this.targetCount
    this.respawnDelay = BASE_RESPAWN_DELAY
    this.ambushChance = BASE_AMBUSH_CHANCE
    this.nextMoanAt = performance.now() + this._randomMoanDelay()

    // Rare roaming threat, independent of the night-scheduled bosses - see
    // _maybeSpawnTitan. Re-rolls on its own timer rather than a fixed night,
    // so it can surprise the player instead of always being anticipated.
    this.titanAlive = false
    this.nextTitanCheckAt = performance.now() + this._randomTitanDelay()

    // Wandering horde event - see _maybeSpawnWanderingHorde.
    this.wanderingHorde = null
    this.nextHordeEventAt = performance.now() + HORDE_EVENT_MIN_DELAY_MS + Math.random() * (HORDE_EVENT_MAX_DELAY_MS - HORDE_EVENT_MIN_DELAY_MS)
    // Dead Silence perk (see Perks.js) - shrinks HORDE_EVENT_AGGRO_RADIUS
    // below for wandering zombies specifically. Doesn't affect zombies
    // already actively chasing (those always target the player directly,
    // no detection-radius concept applies to them) - this only ever helps
    // slip past ambient/wandering ones from further away.
    this.aggroRadiusMult = 1
    // Zombie Blood power-up (see the update() loop's zombieBloodActive
    // check above).
    this.invisibleUntil = 0

    // Pre-run mutators (see Game.js's settings.mutators) - both false by
    // default, set once at the "Click to Play" moment.
    this.bossRushMode = false
    this.bossRushSpawnCount = 0
    this.hordeMode = false

    // Round Mode - see startRound(). Left off by default so the constructor's
    // normal continuous-trickle spawn below still runs for every other mode.
    this.roundMode = false
    this.roundHealthMult = 1

    for (let i = 0; i < this.targetCount; i++) {
      this._spawnRandom()
    }
  }

  // Kills the normal continuous respawn-on-death trickle (targetCount = 0
  // means the pendingRespawns check in update() never has anything to top
  // up to) and instead spawns every zombie for the round in one burst, with
  // health scaled up once rounds run long. Game.js calls this both to start
  // round 1 and again after each round-clear intermission.
  startRound(roundNumber) {
    this.currentNight = roundNumber
    // Capped, not left to compound forever - uncapped this was
    // ROUND_HEALTH_RAMP_MULT^(round-10), which is fine through the first
    // few dozen rounds but becomes an effectively-unkillable bullet sponge
    // by round 50 and a mathematical absurdity (>10^7x) by round 200 - not
    // a deliberate "endgame wall," just an unbounded formula nobody had
    // reason to keep playing far enough to notice. Capping the EXPONENT
    // (not the multiplier directly) keeps the same early-round feel intact
    // while giving Endless Mode an actual sustainable long-run ceiling
    // (~17x at the cap) instead of a curve that guarantees eventual
    // impossibility.
    const rampExponent = Math.min(ROUND_HEALTH_RAMP_EXPONENT_CAP, Math.max(0, roundNumber - ROUND_HEALTH_RAMP_START))
    this.roundHealthMult = Math.pow(ROUND_HEALTH_RAMP_MULT, rampExponent)
    this.targetCount = 0
    const count = Math.min(ROUND_MAX_SPAWN_COUNT, Math.round(ROUND_SPAWN_COUNT_MULT * roundNumber))
    // Queued, not spawned immediately - see update()'s own note on why a
    // single-frame burst of up to ROUND_MAX_SPAWN_COUNT zombies was
    // causing a real stall every round transition.
    this._pendingSpawns += count

    // Round Mode never called applyDifficulty() (that's the timed-mode
    // path), so its own boss-spawn check never ran - meaning no scripted
    // boss EVER spawned in Round Mode despite _showNightBanner's "boss
    // incoming" text firing every 5th round regardless of mode. Mirrors
    // applyDifficulty's exact same dueForBoss logic (including the Boss
    // Rush mutator override) so the promise in that banner is actually
    // kept here too, not just in timed mode.
    const dueForBoss = this.bossRushMode ? this.bossSpawnedForNight !== roundNumber : roundNumber % 5 === 0
    if (dueForBoss && this.bossSpawnedForNight !== roundNumber) {
      this.bossSpawnedForNight = roundNumber
      this._spawnBoss()
    }
  }

  // Round-clear check for Game.js - "alive" rather than a bare array-length
  // check so lingering death-animation corpses (see REMOVE_AFTER_DEATH_MS)
  // don't delay the round-cleared moment by a few seconds after the last kill.
  aliveCount() {
    return this.zombies.filter((z) => z.state !== 'dead').length
  }

  _randomMoanDelay() {
    return MOAN_MIN_DELAY_MS + Math.random() * (MOAN_MAX_DELAY_MS - MOAN_MIN_DELAY_MS)
  }

  _randomTitanDelay() {
    return TITAN_CHECK_MIN_DELAY_MS + Math.random() * (TITAN_CHECK_MAX_DELAY_MS - TITAN_CHECK_MIN_DELAY_MS)
  }

  // Re-rolled on its own recurring timer (see the constructor/update) rather
  // than tied to a night number - only one Titan roams at a time.
  _maybeSpawnTitan() {
    this.nextTitanCheckAt = performance.now() + this._randomTitanDelay()
    if (this.titanAlive || Math.random() >= TITAN_SPAWN_CHANCE) return
    this.titanAlive = true
    const angle = Math.random() * Math.PI * 2
    const x = this.lastPlayerPos.x + Math.sin(angle) * SPAWN_RADIUS_MAX
    const z = this.lastPlayerPos.z + Math.cos(angle) * SPAWN_RADIUS_MAX
    const zombie = new Zombie(x, z, ZOMBIE_TYPES.titan, false, false, this.currentNight, this.healthMult, this.speedMult)
    zombie.deathHandled = false
    zombie.isBoss = true
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
  }

  // Spawns a distinct pack that migrates in a straight line across the map
  // on its own schedule (see the constructor/reset for the timer), rather
  // than ambient population that always beelines the player - see
  // update()'s per-zombie loop for the wander-vs-aggro targeting switch.
  _maybeSpawnWanderingHorde() {
    if (performance.now() < this.nextHordeEventAt) return
    this.nextHordeEventAt = performance.now() + HORDE_EVENT_MIN_DELAY_MS + Math.random() * (HORDE_EVENT_MAX_DELAY_MS - HORDE_EVENT_MIN_DELAY_MS)
    if (this.wanderingHorde) return // one at a time

    const angle = Math.random() * Math.PI * 2
    const startX = this.lastPlayerPos.x + Math.sin(angle) * HORDE_EVENT_SPAWN_RADIUS
    const startZ = this.lastPlayerPos.z + Math.cos(angle) * HORDE_EVENT_SPAWN_RADIUS
    // Walks straight across, passing near the player's current position
    // rather than the map's opposite edge - on a 750x750 map a literal
    // origin-mirrored target could easily be an event the player never
    // gets anywhere near.
    const targetX = this.lastPlayerPos.x - Math.sin(angle) * HORDE_EVENT_SPAWN_RADIUS
    const targetZ = this.lastPlayerPos.z - Math.cos(angle) * HORDE_EVENT_SPAWN_RADIUS

    const size = HORDE_EVENT_SIZE_MIN + Math.floor(Math.random() * (HORDE_EVENT_SIZE_MAX - HORDE_EVENT_SIZE_MIN + 1))
    // Members spawn gradually via _updateWanderingHorde's own drain below,
    // instead of all `size` (6-10) constructed synchronously here - a
    // smaller version of the same startRound/spawnSurge stall, and this
    // event repeats every 60-120s, so it was still a real periodic dip.
    this.wanderingHorde = { members: [], x: startX, z: startZ, targetX, targetZ, size, pendingSpawns: size }
  }

  // Advances the horde's waypoint toward its target edge and drops it once
  // every member is accounted for (killed or wandered off) or it reaches
  // its destination - called once per frame from update(), not per-zombie.
  // spawnBudget: what's left of update()'s single shared per-frame spawn
  // budget after the general _pendingSpawns queue already took its share -
  // draining this horde's own members from the SAME budget (not a second,
  // independent one) means a round-clear burst and a horde event landing
  // on the same frame still can't stack into a bigger spike than the
  // shared cap allows.
  _updateWanderingHorde(dt, spawnBudget) {
    const h = this.wanderingHorde
    if (!h) return

    while (spawnBudget > 0 && h.pendingSpawns > 0 && this.zombies.length < this.performanceCap) {
      h.pendingSpawns--
      spawnBudget--
      const ox = (Math.random() - 0.5) * 4
      const oz = (Math.random() - 0.5) * 4
      const zombie = new Zombie(h.x + ox, h.z + oz, pickZombieType(), false, false, this.currentNight, this.healthMult, this.speedMult)
      zombie.deathHandled = false
      zombie.isWandering = true
      h.members.push(zombie)
      this.zombies.push(zombie)
      this.scene.add(zombie.group)
    }

    const dx = h.targetX - h.x
    const dz = h.targetZ - h.z
    const dist = Math.hypot(dx, dz)
    if (dist > 1) {
      h.x += (dx / dist) * HORDE_EVENT_WANDER_SPEED * dt
      h.z += (dz / dist) * HORDE_EVENT_WANDER_SPEED * dt
    }
    h.members = h.members.filter((z) => this.zombies.includes(z) && z.state !== 'dead')
    // Only counts as "over" once every queued member has actually spawned
    // AND all of them are gone - otherwise a horde still mid-spawn (members
    // temporarily empty/small) would get cancelled before it even started.
    if ((h.members.length === 0 && h.pendingSpawns === 0) || dist <= 1) {
      this.wanderingHorde = null
    }
  }

  // Derives targetCount/respawnDelay/ambushChance from the current night
  // AND the Director's multiplier (see setDirectorMult) - split out from
  // applyDifficulty so the Director can re-derive these mid-night, without
  // re-running the boss-spawn check that only makes sense at a real night
  // transition.
  _recomputeDifficulty() {
    this.baseTargetCount = this.bossRushMode
      ? Math.round(4 * this.spawnRateMult) // a thin ambient crowd - bosses are the point, not exploration
      : Math.round(Math.min(MAX_SPAWN_COUNT, BASE_SPAWN_COUNT + (this.currentNight - 1)) * this.spawnRateMult * this.directorMult)
    this.targetCount = this.baseTargetCount
    this.respawnDelay = Math.max(MIN_RESPAWN_DELAY * 0.5, (BASE_RESPAWN_DELAY - (this.currentNight - 1) * 0.5) / this.directorMult)
    this.ambushChance = Math.min(MAX_AMBUSH_CHANCE, (BASE_AMBUSH_CHANCE + (this.currentNight - 1) * 0.03) * this.directorMult)
  }

  // Zone-tuned density (see Zones.js) - re-derives targetCount from the
  // night-based baseline every frame based on whichever zone the player is
  // currently standing in, so walking into a "high density" location (a
  // prison, a horde-favorite chokepoint) immediately raises the maintained
  // zombie count without needing its own separate spawn-position logic -
  // _spawnRandom's existing player-relative radius band still decides WHERE
  // they appear, this only changes HOW MANY are kept alive.
  _applyZoneDensity(isNight) {
    const zone = getZoneAt(this.lastPlayerPos.x, this.lastPlayerPos.z)
    let mult = 1
    if (zone) {
      const gated = (zone.dayOnly && isNight) || (zone.nightOnly && !isNight)
      mult = gated ? 1 : zone.densityMult
    }
    this.targetCount = Math.round(this.baseTargetCount * mult)
  }

  // Scales spawn count / respawn speed / ambush frequency up with night number.
  applyDifficulty(night) {
    this.currentNight = night
    this._recomputeDifficulty()

    while (this.zombies.length < this.targetCount) {
      this._spawnRandom()
    }

    // Boss Rush mutator: every night forces a boss instead of only every
    // 5th - see Game.js's settings.mutators.bossRush.
    const dueForBoss = this.bossRushMode ? this.bossSpawnedForNight !== night : night % 5 === 0
    if (dueForBoss && this.bossSpawnedForNight !== night) {
      this.bossSpawnedForNight = night
      this._spawnBoss()
    }
  }

  // Director AI hook (see Game.js's _updateDirectorAI) - re-derives the
  // three difficulty numbers with the new multiplier layered on top of the
  // current night's baseline. Raising targetCount immediately spawns the
  // difference (the "throw a horde" moment); lowering it just throttles
  // future respawns - existing zombies are never despawned, so easing off
  // can never feel like enemies vanished out from under the player.
  setDirectorMult(mult) {
    const clamped = Math.max(0.5, Math.min(1.5, mult))
    if (Math.abs(clamped - this.directorMult) < 0.03) return
    this.directorMult = clamped
    this._recomputeDifficulty()
    while (this.zombies.length < this.targetCount) {
      this._spawnRandom()
    }
  }

  // Bosses walk in from max spawn range rather than ambushing, and never
  // enter the normal weighted pool - see colossus's weight: 0 in ZombieTypes.
  _spawnBoss() {
    const angle = Math.random() * Math.PI * 2
    const x = this.lastPlayerPos.x + Math.sin(angle) * SPAWN_RADIUS_MAX
    const z = this.lastPlayerPos.z + Math.cos(angle) * SPAWN_RADIUS_MAX

    // Alternates colossus/broodmother - the slot patient_zero used to fill
    // before it was removed. bossRushSpawnCount existed pre-incremented-but-
    // unused specifically for this.
    const bossType = this.bossRushSpawnCount % 2 === 0 ? ZOMBIE_TYPES.colossus : ZOMBIE_TYPES.broodmother
    this.bossRushSpawnCount += 1
    const zombie = new Zombie(x, z, bossType, false, false, this.currentNight, this.healthMult, this.speedMult)
    zombie.deathHandled = false
    zombie.isBoss = true
    zombie.nextAddSummonAt = performance.now() + BOSS_ADD_FIRST_DELAY_MS
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
  }

  // One-off guardian spawn at a specific spot (the VIREO facility terminal
  // fight) rather than the normal random-radius boss walk-in - returns the
  // zombie instance so the caller can watch its state for "is it dead yet".
  spawnGuardian(x, z, typeConfig) {
    const zombie = new Zombie(x, z, typeConfig, false, false, this.currentNight, this.healthMult, this.speedMult)
    zombie.deathHandled = false
    zombie.isBoss = true
    zombie.nextAddSummonAt = performance.now() + BOSS_ADD_FIRST_DELAY_MS
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
    return zombie
  }

  // Boss adds: spawns a small burst around a boss's current position,
  // reusing the same visual/state setup as the summonOnDeath hybrid burst
  // below rather than a separate code path. Defaults to shambler (colossus/
  // titan's own behavior, unchanged); a boss can override via its own
  // config.addType (see broodmother, which summons sewer_dweller instead).
  // Queued (see _pendingLocationSpawns/spawnAt's own note) rather than
  // constructed immediately - this fires every BOSS_ADD_INTERVAL_MS during
  // a boss fight, so an unpaced burst here was a real recurring stutter.
  _spawnBossAdds(x, z, count, addType = ZOMBIE_TYPES.shambler) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * BOSS_ADD_SPAWN_RADIUS
      const sx = x + Math.sin(angle) * r
      const sz = z + Math.cos(angle) * r
      this._pendingLocationSpawns.push({ x: sx, z: sz, type: addType, isAmbush: false, isElite: false })
    }
  }

  // One-off burst for the underground station's first-visit ambush (see
  // Game.js's _updateStationEncounter) - a mixed batch like the normal
  // surface trickle (pickZombieType), not a single-type swarm like
  // _spawnBossAdds, since this is meant to read as a real encounter rather
  // than boss reinforcements. Scattered within a tighter radius than the
  // boss-add burst since the station hall is an enclosed room, not open
  // street.
  spawnStationAmbush(x, z, count) {
    for (let i = 0; i < count; i++) {
      const type = pickZombieType()
      const angle = Math.random() * Math.PI * 2
      const r = 2 + Math.random() * 4
      const sx = x + Math.sin(angle) * r
      const sz = z + Math.cos(angle) * r
      this._pendingLocationSpawns.push({ x: sx, z: sz, type, isAmbush: false, isElite: false })
    }
  }

  // Live-updates the Easy/Normal/Hard spawn-rate multiplier without
  // reconstructing the manager, re-applying it against the current night.
  setDifficultyMultiplier(mult) {
    this.spawnRateMult = mult
    this.applyDifficulty(this.currentNight)
  }

  reset() {
    // Same leak fix as the natural-death cleanup below - a restart while
    // zombies are still alive used to discard them without ever freeing
    // their material/shader GPU resources.
    for (const zombie of this.zombies) {
      this.scene.remove(zombie.group)
      zombie.dispose()
    }
    for (const p of this.projectiles) this.scene.remove(p.mesh)
    for (const fx of this.explosionFx) this.scene.remove(fx.mesh)
    for (const fx of this.screamFx) this.scene.remove(fx.mesh)
    for (const n of this.noisemakerThrows) this.scene.remove(n.mesh)
    for (const g of this.grenadeThrows) this.scene.remove(g.mesh)
    for (const m of this.molotovThrows) this.scene.remove(m.mesh)
    for (const f of this.fireZones) {
      this.scene.remove(f.mesh)
      this.scene.remove(f.light)
    }
    for (const c of this.c4Throws) this.scene.remove(c.mesh)
    if (this.placedC4) this.scene.remove(this.placedC4.mesh)
    for (const e of this.empThrows) this.scene.remove(e.mesh)
    for (const b of this.empBursts) {
      this.scene.remove(b.mesh)
      if (b.light) this.scene.remove(b.light)
    }
    this.zombies = []
    this.projectiles = []
    this.explosionFx = []
    this.screamFx = []
    this.noisemakerThrows = []
    this.grenadeThrows = []
    this.knifeThrows = []
    this.molotovThrows = []
    this.fireZones = []
    this.c4Throws = []
    this.placedC4 = null
    this.empThrows = []
    this.empBursts = []
    this.distraction = null
    this.pendingRespawns = []
    this.currentNight = 1
    this.bossSpawnedForNight = 0
    this.directorMult = 1
    this.respawnDelay = BASE_RESPAWN_DELAY
    this.ambushChance = BASE_AMBUSH_CHANCE
    this.nextMoanAt = performance.now() + this._randomMoanDelay()
    this.wanderingHorde = null
    this.nextHordeEventAt = performance.now() + HORDE_EVENT_MIN_DELAY_MS + Math.random() * (HORDE_EVENT_MAX_DELAY_MS - HORDE_EVENT_MIN_DELAY_MS)
    // Cleared here rather than only in the constructor - reset() also runs
    // on a same-session restart, where a previous game's still-unspawned
    // burst shouldn't carry over into the new one.
    this._pendingSpawns = 0
    this._pendingLocationSpawns = []
    // Round Mode starts its own round-1 burst via startRound() right after
    // reset() (see Game.js) instead of the normal continuous-trickle spawn.
    if (this.roundMode) {
      this.targetCount = 0
    } else {
      this.targetCount = Math.round(BASE_SPAWN_COUNT * this.spawnRateMult)
      // Queued, not spawned immediately - see update()'s own note.
      this._pendingSpawns += this.targetCount
    }
    // Keep in sync with targetCount here - _applyZoneDensity re-derives
    // targetCount from this baseline every frame, and would otherwise
    // immediately overwrite this reset with a stale pre-reset value.
    this.baseTargetCount = this.targetCount
  }

  // Horde Mode mutator (see Game.js's settings.mutators.hordeMode): spawns
  // much closer in so pressure never really lets up, instead of just
  // raising the count at the normal distance like the Horde Rush mutator.
  setHordeMode(enabled) {
    this.hordeMode = enabled
    if (enabled) this.respawnDelay = Math.min(this.respawnDelay, MIN_RESPAWN_DELAY)
  }

  _spawnRandom() {
    const type = pickZombieType()
    const isAmbush = type.burrower || (!type.ranged && Math.random() < this.ambushChance)

    const radiusMin = type.burrower ? BURROWER_RADIUS_MIN : this.hordeMode ? HORDE_SPAWN_RADIUS_MIN : (isAmbush ? AMBUSH_RADIUS_MIN : SPAWN_RADIUS_MIN)
    const radiusMax = type.burrower ? BURROWER_RADIUS_MAX : this.hordeMode ? HORDE_SPAWN_RADIUS_MAX : (isAmbush ? AMBUSH_RADIUS_MAX : SPAWN_RADIUS_MAX)
    const angle = Math.random() * Math.PI * 2
    const radius = radiusMin + Math.random() * (radiusMax - radiusMin)
    const x = this.lastPlayerPos.x + Math.sin(angle) * radius
    const z = this.lastPlayerPos.z + Math.cos(angle) * radius

    const isElite = Math.random() < ELITE_CHANCE * this.eliteChanceMult
    const zombie = new Zombie(x, z, type, isAmbush, isElite, this.currentNight, this.healthMult, this.speedMult)
    if (this.roundMode && this.roundHealthMult !== 1) {
      zombie.maxHealth *= this.roundHealthMult
      zombie.health = zombie.maxHealth
    }
    zombie.deathHandled = false
    this.zombies.push(zombie)
    this.scene.add(zombie.group)

    // Pack spawn (see ZombieTypes.js's packSize) - additional pack members
    // land immediately in a small cluster around the first, sharing its
    // ambush/elite roll rather than each rolling independently. Queued
    // (see _pendingLocationSpawns/spawnAt's own note) rather than
    // constructed here directly - the position/ambush/elite roll still
    // happens immediately (cheap), only the expensive construction itself
    // is paced.
    if (type.packSize) {
      for (let i = 1; i < type.packSize; i++) {
        const px = x + (Math.random() - 0.5) * 4
        const pz = z + (Math.random() - 0.5) * 4
        this._pendingLocationSpawns.push({ x: px, z: pz, type, isAmbush, isElite })
      }
    }
  }

  // Extra ambush-biased zombies, for the "Horde Surge" random night event -
  // a one-off punch rather than a sustained rate change. Queued (see
  // update()'s own note) rather than spawned immediately, same reasoning
  // as startRound - this is also a periodic, repeating event.
  spawnSurge(count) {
    this._pendingSpawns += count
  }

  // Location-targeted burst (vs spawnSurge's gradual, player-relative
  // queue) - used by the Survivor Camp Liberation night event so the
  // threat actually appears at the camp's coordinates instead of wherever
  // the player happens to be standing. Queued through the same per-frame
  // budget as _pendingSpawns (see update()'s own note) rather than
  // constructed immediately - a real zombie construction is expensive
  // enough that building all of them (e.g. CAMP_ATTACK_ZOMBIE_COUNT) in
  // one synchronous loop caused a multi-second stutter (measured: ~150ms+
  // per construction, stacking into several seconds of near-frozen frames
  // for a burst of just 6-15).
  spawnAt(x, z, count) {
    for (let i = 0; i < count; i++) {
      const ox = (Math.random() - 0.5) * 6
      const oz = (Math.random() - 0.5) * 6
      this._pendingLocationSpawns.push({ x: x + ox, z: z + oz, type: pickZombieType(), isAmbush: false, isElite: false })
    }
  }

  // Shared consumer for every location-targeted burst source (spawnAt,
  // spawnStationAmbush, _spawnBossAdds, pack spawns, summon-on-death) -
  // each producer already rolled the exact position/type/ambush/elite for
  // this specific zombie (cheap, so no need to pace that part) - this just
  // does the expensive part (the actual construction) one at a time.
  _spawnOneAt(spot) {
    const zombie = new Zombie(spot.x, spot.z, spot.type, spot.isAmbush, spot.isElite, this.currentNight, this.healthMult, this.speedMult)
    zombie.deathHandled = false
    this.zombies.push(zombie)
    this.scene.add(zombie.group)
  }

  // Shared explosion-damage logic - used by both thrown grenades and shot
  // explosive world props (parked cars, see WeaponSystem._fire).
  explodeAt(x, z, radius, damageMin, damageMax) {
    this._spawnExplosionFX(x, z)
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > radius) continue
      const falloff = 1 - dist / radius
      zombie.onHit(damageMin + (damageMax - damageMin) * falloff)
    }
  }

  get hittableMeshes() {
    return this.zombies
      .filter((z) => z.state === 'alive')
      .flatMap((z) => z.hittableMeshes)
  }

  _spawnProjectile(origin, targetSnapshot, damage, travelSpeed) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), projectileMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(targetSnapshot)
    const travelTime = Math.max(0.15, distance / travelSpeed)

    this.projectiles.push({ mesh, origin, target: targetSnapshot, damage, travelTime, t: 0 })
  }

  // Player-thrown decoy: arcs to the target point, then plays a loud sound
  // and marks that spot as a distraction zombies will investigate instead
  // of the player (see the targeting override in update() below).
  spawnNoisemakerThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), noisemakerMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.2, distance / NOISEMAKER_THROW_SPEED)

    this.noisemakerThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateNoisemakerThrows(dt) {
    this.noisemakerThrows = this.noisemakerThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this.distraction = { x: p.target.x, z: p.target.z, expiresAt: performance.now() + NOISEMAKER_DISTRACTION_MS }
        audioEngine.playNoisemaker()
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.2
      p.mesh.rotation.x += dt * 12
      return true
    })
  }

  // Player-thrown frag grenade: arcs to the target point, then explodes -
  // reuses the same explosion FX/sound as the Bloater zombie's detonation,
  // dealing falloff damage to every zombie within range. No player
  // self-damage for now, even at point-blank.
  spawnGrenadeThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), grenadeMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.25, distance / GRENADE_THROW_SPEED)

    this.grenadeThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  // Generic falloff-damage burst, same shape as the grenade explosion loop
  // below just without a thrown projectile leading into it - used by
  // Game.js's killstreak "airstrike" reward (a call-it-in strike centered
  // on the player rather than something thrown/aimed).
  damageInRadius(x, z, radius, minDamage, maxDamage) {
    this._spawnExplosionFX(x, z)
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > radius) continue
      const falloff = 1 - dist / radius
      zombie.onHit(minDamage + (maxDamage - minDamage) * falloff)
    }
  }

  // Nuke power-up (see Game.js's _onPickup nuke) - every currently-alive
  // zombie, no radius/falloff at all (distinct from damageInRadius above,
  // which every other explosive in this game uses).
  nukeAll() {
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      this._spawnExplosionFX(zombie.group.position.x, zombie.group.position.z)
      zombie.onHit(99999)
    }
  }

  // Throwing Knife - same arc-to-target-then-resolve shape as the grenade
  // above, just single-target instead of AOE falloff (closest zombie within
  // a small radius of the landing point, not everything in a blast ring)
  // and a flat one-hit-kill damage instead of scaled damage.
  spawnKnifeThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), knifeMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.12, distance / KNIFE_SPEED)

    this.knifeThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateKnifeThrows(dt) {
    this.knifeThrows = this.knifeThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        let nearest = null
        let nearestDist = KNIFE_HIT_RADIUS
        for (const zombie of this.zombies) {
          if (zombie.state !== 'alive') continue
          const dist = Math.hypot(zombie.group.position.x - p.target.x, zombie.group.position.z - p.target.z)
          if (dist < nearestDist) {
            nearest = zombie
            nearestDist = dist
          }
        }
        if (nearest) nearest.onHit(KNIFE_DAMAGE)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 0.8
      return true
    })
  }

  _updateGrenadeThrows(dt) {
    this.grenadeThrows = this.grenadeThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this._spawnExplosionFX(p.target.x, p.target.z)
        for (const zombie of this.zombies) {
          if (zombie.state !== 'alive') continue
          const dist = Math.hypot(zombie.group.position.x - p.target.x, zombie.group.position.z - p.target.z)
          if (dist > GRENADE_DAMAGE_RADIUS) continue
          const falloff = 1 - dist / GRENADE_DAMAGE_RADIUS
          zombie.onHit(GRENADE_DAMAGE_MIN + (GRENADE_DAMAGE_MAX - GRENADE_DAMAGE_MIN) * falloff)
        }
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.6
      return true
    })
  }

  // Player-thrown Molotov: arcs like a grenade, but on landing leaves a
  // burning zone that ticks damage to anything standing in it for
  // MOLOTOV_FIRE_DURATION_MS instead of one instant burst - area denial
  // rather than a direct hit, so it's strongest at a choke point/doorway a
  // horde has to path through.
  spawnMolotovThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), molotovMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.25, distance / MOLOTOV_THROW_SPEED)

    this.molotovThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateMolotovThrows(dt) {
    this.molotovThrows = this.molotovThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this._spawnFireZone(p.target.x, p.target.z)
        audioEngine.playExplosion()
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.6
      return true
    })
  }

  _spawnFireZone(x, z) {
    // Own material clone, not the shared fireZoneMat - _updateFireZones
    // mutates opacity every frame per-instance (for the flicker), and two
    // fire zones burning at once would otherwise fight over one shared
    // material's opacity, both flickering in lockstep to whichever zone's
    // update ran last that frame.
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(MOLOTOV_FIRE_RADIUS, 16), fireZoneMat.clone())
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.06, z)
    this.scene.add(mesh)
    // Added to the scene directly, NOT as a child of `mesh` - mesh is
    // rotated -90deg around X to lie flat, so a child's `position` is
    // local to that rotated frame, not world space. Parenting the light
    // here and setting its position to the world x/z (as this used to)
    // put it well off from the actual fire, warped through the parent's
    // rotation instead of floating above the fire like intended.
    const light = new THREE.PointLight(0xff6a1a, 1.6, MOLOTOV_FIRE_RADIUS * 2.5, 2)
    light.position.set(x, 1.2, z)
    this.scene.add(light)
    this.fireZones.push({ mesh, x, z, light, expiresAt: performance.now() + MOLOTOV_FIRE_DURATION_MS, nextTickAt: performance.now() })
  }

  _updateFireZones() {
    const now = performance.now()
    this.fireZones = this.fireZones.filter((f) => {
      if (now >= f.expiresAt) {
        this.scene.remove(f.mesh)
        this.scene.remove(f.light)
        return false
      }
      // Flicker the fire light/opacity for a "burning" read instead of a
      // flat static disc.
      const flicker = 0.8 + Math.sin(now * 0.02 + f.x) * 0.2
      f.light.intensity = 1.6 * flicker
      f.mesh.material.opacity = 0.45 * flicker + 0.1

      if (now >= f.nextTickAt) {
        f.nextTickAt = now + MOLOTOV_TICK_MS
        for (const zombie of this.zombies) {
          if (zombie.state !== 'alive') continue
          const dist = Math.hypot(zombie.group.position.x - f.x, zombie.group.position.z - f.z)
          if (dist > MOLOTOV_FIRE_RADIUS) continue
          zombie.onHit(MOLOTOV_DAMAGE_PER_TICK)
        }
      }
      return true
    })
  }

  // Player-thrown C4: arcs like a grenade but doesn't explode on landing -
  // it sits armed at the target point until detonateC4() is called (see
  // Game.js's _detonateC4, bound to a separate key). Only one live charge
  // at a time; throwing another while one's still armed detonates the old
  // one in place first rather than silently discarding it.
  spawnC4Throw(origin, target) {
    if (this.placedC4) this.detonateC4()

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.09), c4Mat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.2, distance / C4_THROW_SPEED)

    this.c4Throws.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateC4Throws(dt) {
    this.c4Throws = this.c4Throws.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        p.mesh.position.set(p.target.x, 0.05, p.target.z)
        p.mesh.rotation.x = 0
        // Throwing a second charge before the first lands detonates the
        // first at throw-time (see spawnC4Throw) - but that only catches
        // charges already landed *before* the new throw. Two charges both
        // still in flight when the second is thrown land independently
        // here, moments apart, and would otherwise silently orphan
        // whichever one lands first (overwritten below with no cleanup,
        // permanently stuck in the scene with no way to detonate or
        // remove it). Detonating any already-placed charge here too closes
        // that gap.
        if (this.placedC4) this.detonateC4()
        this.placedC4 = { mesh: p.mesh, x: p.target.x, z: p.target.z }
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.2
      p.mesh.rotation.x += dt * 8
      return true
    })
  }

  // Manual detonate - no-op (returns false) if nothing's armed, so Game.js
  // can tell the player "nothing to blow up" instead of silently failing.
  detonateC4() {
    if (!this.placedC4) return false
    const { mesh, x, z } = this.placedC4
    this.scene.remove(mesh)
    this.placedC4 = null
    this._spawnExplosionFX(x, z)
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > C4_DAMAGE_RADIUS) continue
      const falloff = 1 - dist / C4_DAMAGE_RADIUS
      zombie.onHit(C4_DAMAGE_MIN + (C4_DAMAGE_MAX - C4_DAMAGE_MIN) * falloff)
    }
    return true
  }

  _spawnExplosionFX(x, z) {
    const mat = flatMaterial({
      color: 0xffcc66,
      emissive: 0xffaa33,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 1,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), mat)
    mesh.position.set(x, 1.1, z)
    this.scene.add(mesh)
    this.explosionFx.push({ mesh, startedAt: performance.now() })
    audioEngine.playExplosion()
  }

  _updateExplosionFx() {
    this.explosionFx = this.explosionFx.filter((fx) => {
      const progress = Math.min(1, (performance.now() - fx.startedAt) / EXPLOSION_FX_MS)
      const scale = 1 + progress * 14
      fx.mesh.scale.setScalar(scale)
      fx.mesh.material.opacity = 1 - progress
      if (progress >= 1) {
        this.scene.remove(fx.mesh)
        return false
      }
      return true
    })
  }

  // Player-thrown EMP grenade: arcs like a grenade, but on landing deals
  // zero damage - it stuns/blinds every alive zombie within EMP_STUN_RADIUS
  // for EMP_STUN_DURATION_MS via Zombie.stun(). A crowd-control tool for
  // buying space or setting up a kill, not a damage source - deliberately a
  // different niche than an environmental hazard event (this is a choice
  // the player makes, not something that happens to them).
  spawnEmpThrow(origin, target) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), empMat)
    mesh.position.copy(origin)
    this.scene.add(mesh)

    const distance = origin.distanceTo(target)
    const travelTime = Math.max(0.25, distance / EMP_THROW_SPEED)

    this.empThrows.push({ mesh, origin: origin.clone(), target: target.clone(), travelTime, t: 0 })
  }

  _updateEmpThrows(dt) {
    this.empThrows = this.empThrows.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        this._detonateEmp(p.target.x, p.target.z)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 1.6
      return true
    })
  }

  _detonateEmp(x, z) {
    this._spawnEmpBurstFX(x, z)
    audioEngine.playEmpBurst()
    for (const zombie of this.zombies) {
      if (zombie.state !== 'alive') continue
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > EMP_STUN_RADIUS) continue
      zombie.stun(EMP_STUN_DURATION_MS)
    }
  }

  _spawnEmpBurstFX(x, z) {
    const mat = flatMaterial({
      color: 0x4ecfff,
      emissive: 0x4ecfff,
      emissiveIntensity: 3,
      transparent: true,
      opacity: 1,
      wireframe: true,
    })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 12), mat)
    mesh.position.set(x, 1.1, z)
    this.scene.add(mesh)
    this.empBursts.push({ mesh, startedAt: performance.now() })

    const light = new THREE.PointLight(0x4ecfff, 3, EMP_STUN_RADIUS * 2, 2)
    light.position.set(x, 1.5, z)
    this.scene.add(light)
    this.empBursts[this.empBursts.length - 1].light = light
  }

  _updateEmpBursts() {
    this.empBursts = this.empBursts.filter((fx) => {
      const progress = Math.min(1, (performance.now() - fx.startedAt) / EXPLOSION_FX_MS)
      const scale = 1 + progress * (EMP_STUN_RADIUS * 2)
      fx.mesh.scale.setScalar(scale)
      fx.mesh.material.opacity = 1 - progress
      if (fx.light) fx.light.intensity = 3 * (1 - progress)
      if (progress >= 1) {
        this.scene.remove(fx.mesh)
        if (fx.light) this.scene.remove(fx.light)
        return false
      }
      return true
    })
  }

  // A screamer's scream: instantly wakes every dormant (ambush) zombie in
  // radius and speeds up every alive zombie in radius for a few seconds.
  _onZombieScream(x, z, radius, enrageMs) {
    audioEngine.playAmbushShriek()
    this._spawnScreamFX(x, z)
    for (const zombie of this.zombies) {
      const dist = Math.hypot(zombie.group.position.x - x, zombie.group.position.z - z)
      if (dist > radius) continue
      if (zombie.state === 'dormant') zombie.forceWake()
      else if (zombie.state === 'alive') zombie.enrage(enrageMs)
    }
  }

  _spawnScreamFX(x, z) {
    const mat = flatMaterial({
      color: 0xb060e0,
      emissive: 0xb060e0,
      emissiveIntensity: 2.5,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.4, 24), mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.15, z)
    this.scene.add(mesh)
    this.screamFx.push({ mesh, startedAt: performance.now() })
  }

  _updateScreamFx() {
    this.screamFx = this.screamFx.filter((fx) => {
      const progress = Math.min(1, (performance.now() - fx.startedAt) / SCREAM_FX_MS)
      const scale = 1 + progress * 18
      fx.mesh.scale.setScalar(scale)
      fx.mesh.material.opacity = 0.8 * (1 - progress)
      if (progress >= 1) {
        this.scene.remove(fx.mesh)
        return false
      }
      return true
    })
  }

  _updateAmbientMoan(playerPos) {
    if (performance.now() < this.nextMoanAt) return

    const nearby = this.zombies.some((z) => {
      if (z.state !== 'alive' && z.state !== 'dormant') return false
      const dist = Math.hypot(playerPos.x - z.group.position.x, playerPos.z - z.group.position.z)
      return dist <= MOAN_RADIUS
    })

    if (nearby) audioEngine.playZombieMoan()
    this.nextMoanAt = performance.now() + this._randomMoanDelay()
  }

  _updateProjectiles(dt, playerPos, onPlayerDamage) {
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt / p.travelTime
      if (p.t >= 1) {
        this.scene.remove(p.mesh)
        const dist = Math.hypot(playerPos.x - p.target.x, playerPos.z - p.target.z)
        if (dist <= PROJECTILE_HIT_RADIUS && onPlayerDamage) onPlayerDamage(p.damage)
        return false
      }
      p.mesh.position.lerpVectors(p.origin, p.target, p.t)
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 0.6
      return true
    })
  }

  update(dt, playerPos, onPlayerDamage, onZombieLoot, onAmbushTrigger, onZombieKilled, playerCrouching = false, isNight = false) {
    this.elapsed += dt
    // Every spawn function below reads this instead of assuming the player
    // is near the map origin - true on the old 150x150 map, not on the
    // current 750x750 one, where the player could be anywhere.
    this.lastPlayerPos = playerPos
    this._applyZoneDensity(isNight)

    // Spread any queued burst-spawn (round-clear waves, the initial
    // reset() burst, the wandering horde event, spawnAt's location-targeted
    // bursts) across several frames instead of constructing them all in
    // one single-frame loop. Each zombie construction is real work
    // (skeleton clone + material setup + AnimationMixer creation) - one
    // shared budget per frame, not one budget PER burst source, so a
    // round-clear and a horde event landing on the same frame still can't
    // stack into a bigger spike than a single source alone would cause.
    // Capped at 1/frame (not 2) - even the paced version was still visibly
    // dipping, meaning a single zombie construction is itself a meaningful
    // cost on this hardware.
    const SPAWNS_PER_FRAME = 1
    let spawnBudget = SPAWNS_PER_FRAME
    // Also gated by performanceCap - a real-fps-driven ceiling on how many
    // can be ALIVE at once (see Game.js's own note), not just how fast a
    // wave trickles in. A round can still want its full difficulty-scaled
    // count queued in _pendingSpawns; if fps is struggling, spawning just
    // pauses once the cap is hit rather than the round permanently having
    // fewer zombies - it resumes on its own once either some die or fps
    // recovers and the cap loosens back up.
    while (spawnBudget > 0 && this._pendingSpawns > 0 && this.zombies.length < this.performanceCap) {
      this._pendingSpawns--
      this._spawnRandom()
      spawnBudget--
    }
    while (spawnBudget > 0 && this._pendingLocationSpawns.length > 0 && this.zombies.length < this.performanceCap) {
      const spot = this._pendingLocationSpawns.shift()
      this._spawnOneAt(spot)
      spawnBudget--
    }

    if (performance.now() >= this.nextTitanCheckAt) this._maybeSpawnTitan()
    this._maybeSpawnWanderingHorde()
    this._updateWanderingHorde(dt, spawnBudget)

    const distractionActive = this.distraction && performance.now() < this.distraction.expiresAt
    if (this.distraction && !distractionActive) this.distraction = null

    // Zombie Blood power-up (see Game.js's _onPickup zombie_blood) - full
    // invisibility, unlike Dead Silence's aggroRadiusMult above which only
    // ever affects wandering zombies deciding whether to notice the player
    // in the first place. This instead makes every zombie behave as if the
    // player isn't there at all, even ones already actively chasing.
    const zombieBloodActive = this.invisibleUntil && performance.now() < this.invisibleUntil

    // Hivemind boss aura (see Zombie.js's hivemindBuffUntil) - only bothers
    // scanning for nearby zombies when a boss is actually alive, which is
    // rare (0-1 at a time), so this stays a no-op the rest of the time.
    const aliveBosses = this.zombies.filter((z) => z.isBoss && z.state === 'alive')

    for (const zombie of this.zombies) {
      if (zombieBloodActive && zombie.state === 'alive') continue

      if (aliveBosses.length > 0 && !zombie.isBoss && zombie.state === 'alive') {
        for (const boss of aliveBosses) {
          const hivemindDist = Math.hypot(zombie.group.position.x - boss.group.position.x, zombie.group.position.z - boss.group.position.z)
          if (hivemindDist <= HIVEMIND_RADIUS) {
            zombie.hivemindBuffUntil = performance.now() + 500
            break
          }
        }
      }

      let targetPos = playerPos
      let attackCb = onPlayerDamage
      let spitCb = (origin, target, damage, speed) => this._spawnProjectile(origin, target, damage, speed)

      // Wandering horde members ignore the player entirely and drift toward
      // the horde's waypoint until the player closes to within aggro range -
      // at that point they fall through to the normal playerPos targeting
      // below like any other zombie.
      if (zombie.isWandering && zombie.state === 'alive') {
        const distToPlayer = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        if (distToPlayer > HORDE_EVENT_AGGRO_RADIUS * this.aggroRadiusMult && this.wanderingHorde) {
          targetPos = { x: this.wanderingHorde.x, z: this.wanderingHorde.z }
          attackCb = null
          spitCb = null
        }
      }

      // While a decoy is active, any zombie closer to it than to the real
      // player chases the noise instead - and can't actually deal damage
      // while doing so, since it isn't engaging the player at all.
      if (distractionActive && zombie.state === 'alive') {
        const distToPlayer = Math.hypot(playerPos.x - zombie.group.position.x, playerPos.z - zombie.group.position.z)
        const distToDecoy = Math.hypot(this.distraction.x - zombie.group.position.x, this.distraction.z - zombie.group.position.z)
        if (distToDecoy < distToPlayer) {
          targetPos = this.distraction
          attackCb = null
          spitCb = null
        }
      }

      // Only the colliders actually near this zombie right now - see
      // ColliderGrid.js's own comment for why (was the full, whole-map
      // colliders array, scanned up to 3x per zombie per frame).
      const nearbyColliders = this._colliderGrid.query(zombie.group.position.x, zombie.group.position.z)
      zombie.update(
        dt,
        this.elapsed,
        targetPos,
        attackCb,
        spitCb,
        onAmbushTrigger,
        (x, z) => this._spawnExplosionFX(x, z),
        playerCrouching,
        (x, z, radius, enrageMs) => this._onZombieScream(x, z, radius, enrageMs),
        nearbyColliders,
        this.solidMeshes,
        this.zombies
      )

      // Push back out to the safe zone's radius every frame - simple radial
      // clamp rather than a wall collider, since the entrance gap has no
      // collider of its own (the player needs to walk through it) and the
      // zombie's normal targeting would otherwise walk it straight through
      // that same opening.
      if (this.safeZone && zombie.state !== 'dead') {
        const sdx = zombie.group.position.x - this.safeZone.x
        const sdz = zombie.group.position.z - this.safeZone.z
        const sdist = Math.hypot(sdx, sdz)
        if (sdist < this.safeZone.radius) {
          const pushDist = this.safeZone.radius - sdist
          const nx = sdist > 0.001 ? sdx / sdist : 1
          const nz = sdist > 0.001 ? sdz / sdist : 0
          zombie.group.position.x += nx * pushDist
          zombie.group.position.z += nz * pushDist
        }
      }

      if (zombie.isBoss && zombie.state === 'alive' && zombie.nextAddSummonAt && performance.now() >= zombie.nextAddSummonAt) {
        zombie.nextAddSummonAt = performance.now() + BOSS_ADD_INTERVAL_MS
        const count = BOSS_ADD_COUNT_MIN + Math.floor(Math.random() * (BOSS_ADD_COUNT_MAX - BOSS_ADD_COUNT_MIN + 1))
        const addType = zombie.config.addType ? ZOMBIE_TYPES[zombie.config.addType] : undefined
        this._spawnBossAdds(zombie.group.position.x, zombie.group.position.z, count, addType)
      }

      if (zombie.state === 'dead' && !zombie.deathHandled) {
        zombie.deathHandled = true
        this.pendingRespawns.push({ at: performance.now() + REMOVE_AFTER_DEATH_MS + this.respawnDelay * 1000 })

        if (zombie.config.id === 'titan') this.titanAlive = false
        if (!zombie.config.explodes) audioEngine.playZombieDeath()
        if (onZombieKilled) onZombieKilled(zombie.config.id, zombie.lastHitWeaponId, zombie.group.position.x, zombie.group.position.z, zombie.isElite, !!zombie.isWandering)
        // Regular kills no longer roll a random loot chance here - see
        // Game.js's _onZombieKilled for the guaranteed every-10th-kill drop.
        // Bosses still always drop on top of that.
        if (onZombieLoot && zombie.isBoss) {
          onZombieLoot(zombie.group.position.x, zombie.group.position.z)
        }

        // screamer_swarmer-style hybrids (see ZombieTypes.js) release a
        // small burst of a weaker type on death instead of just dying quietly.
        if (zombie.config.summonOnDeath) {
          const summonType = ZOMBIE_TYPES[zombie.config.summonType]
          if (summonType) {
            for (let i = 0; i < zombie.config.summonOnDeath; i++) {
              const angle = Math.random() * Math.PI * 2
              const r = 1.5 + Math.random() * 1.5
              const sx = zombie.group.position.x + Math.sin(angle) * r
              const sz = zombie.group.position.z + Math.cos(angle) * r
              this._pendingLocationSpawns.push({ x: sx, z: sz, type: summonType, isAmbush: false, isElite: false })
            }
          }
        }

        setTimeout(() => {
          this.scene.remove(zombie.group)
          // See Zombie.js's own dispose() note - scene.remove() alone
          // doesn't free a single byte of GPU memory, only stops
          // rendering. Without this, every kill for the entire life of a
          // session was leaking its own material/shader GPU resources
          // permanently - the real cause of "gets laggier the longer you
          // play," independent of the population governor (which only
          // limits how many are alive AT ONCE, not what's leaked by ones
          // that already died).
          zombie.dispose()
          this.zombies = this.zombies.filter((z) => z !== zombie)
        }, REMOVE_AFTER_DEATH_MS)
      }
    }

    this._updateProjectiles(dt, playerPos, onPlayerDamage)
    this._updateExplosionFx()
    this._updateScreamFx()
    this._updateAmbientMoan(playerPos)
    this._updateNoisemakerThrows(dt)
    this._updateGrenadeThrows(dt)
    this._updateKnifeThrows(dt)
    this._updateMolotovThrows(dt)
    this._updateFireZones()
    this._updateC4Throws(dt)
    this._updateEmpThrows(dt)
    this._updateEmpBursts()

    this.pendingRespawns = this.pendingRespawns.filter((r) => {
      if (performance.now() < r.at) return true
      if (this.zombies.length < this.targetCount && this.zombies.length < this.performanceCap) this._spawnRandom()
      return false
    })
  }
}

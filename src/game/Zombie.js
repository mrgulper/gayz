import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { accessibility } from './Accessibility.js'
import { LOW_QUALITY_MATERIALS, flatMaterial, flattenedClone } from './QualitySettings.js'

// Phase 1 of the 3D asset overhaul (see 3D_ASSET_OVERHAUL.md) - real rigged
// GLB zombie behind a flag, alongside the original procedural builder, so
// this can be A/B'd and rolled back with a one-line change. Flip to false
// to fall back to the fully-procedural zombie unconditionally.
export const USE_GLB_ZOMBIES = true

// Loaded once (see preloadZombieModel, called from main.js before `new
// Game()` the same way preloadBuildingModels is) - every Zombie instance
// clones from this cache instead of hitting the network per-spawn.
let _zombieModelCache = null

export async function preloadZombieModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/zombie/zombie-phase1.glb')
    _zombieModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB zombie model failed to load, falling back to procedural zombies', err)
  }
}

// Skin detail textures (see _buildBodyFromGLB/_buildBodyFromTitanGLB) - the
// source GLBs ship one totally flat, untextured material per body, tinted
// only by a solid per-instance color (bodyTint). These add real surface
// detail (grime/wounds/wrinkles for zombies, overlapping scales for the
// Titan) as a *multiply* layer on top of that same tint, rather than
// replacing the tint system: drawn near-white with darker/reddish blotches,
// so `material.map * material.color` still lands on whatever random tone
// this instance picked, just no longer perfectly flat plastic. Built once
// at module scope and shared by every instance (like Build Mode's per-type
// canvas textures) - it's a detail layer, not a per-tone-specific skin, so
// one shared texture works for every zombie type/tone/Titan alike.
function _grimeBlobs(ctx, size, count, colorFn, radiusMin, radiusMax) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colorFn()
    const r = radiusMin + Math.random() * (radiusMax - radiusMin)
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function _buildZombieSkinTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#f2f0ea'
  ctx.fillRect(0, 0, size, size)
  // Grime/dirt patches - broad, soft, low-opacity.
  _grimeBlobs(ctx, size, 70, () => `rgba(40,35,25,${0.05 + Math.random() * 0.12})`, 6, 26)
  // Wounds/blood - a handful of smaller, more saturated reddish blotches.
  // These read as muted brownish-red against any tint, not pure red, since
  // multiply can only darken/tint toward the texture's own hue, never add
  // brightness the base tint doesn't already have.
  _grimeBlobs(ctx, size, 10, () => `rgba(120,20,15,${0.25 + Math.random() * 0.25})`, 4, 14)
  // Wrinkle/vein lines - thin, dark, low-opacity strokes.
  ctx.lineWidth = 1.4
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(30,25,18,${0.08 + Math.random() * 0.1})`
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 3; s++) {
      x += (Math.random() - 0.5) * 40
      y += (Math.random() - 0.5) * 40
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // Fine per-pixel grain - same cheap "isn't a flat computer-generated
  // plane" trick Build Mode's block textures use.
  const imgData = ctx.getImageData(0, 0, size, size)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 14
    d[i] = Math.max(0, Math.min(255, d[i] + jitter))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + jitter))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + jitter))
  }
  ctx.putImageData(imgData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function _buildTitanScaleTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#eef0e6'
  ctx.fillRect(0, 0, size, size)
  // Overlapping scale rows - each scale a small downward-curved arc, offset
  // every other row so they interlock like real reptile scales.
  const rows = 18
  const rowH = size / rows
  for (let r = 0; r < rows; r++) {
    const y = r * rowH
    const offset = r % 2 === 0 ? 0 : rowH * 0.5
    for (let x = -rowH; x < size + rowH; x += rowH) {
      ctx.strokeStyle = `rgba(35,40,25,${0.1 + Math.random() * 0.1})`
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x + offset, y, rowH * 0.55, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
    }
  }
  // Broad mottled patches for organic color variation, same technique as
  // the zombie skin texture's grime blobs.
  _grimeBlobs(ctx, size, 30, () => `rgba(30,35,20,${0.06 + Math.random() * 0.1})`, 10, 34)
  const imgData = ctx.getImageData(0, 0, size, size)
  const d = imgData.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 12
    d[i] = Math.max(0, Math.min(255, d[i] + jitter))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + jitter))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + jitter))
  }
  ctx.putImageData(imgData, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(3, 3)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

let _zombieSkinTexture = null
let _titanScaleTexture = null
function getZombieSkinTexture() {
  if (!_zombieSkinTexture) _zombieSkinTexture = _buildZombieSkinTexture()
  return _zombieSkinTexture
}
function getTitanScaleTexture() {
  if (!_titanScaleTexture) _titanScaleTexture = _buildTitanScaleTexture()
  return _titanScaleTexture
}

// Titan (dinosaur silhouette) - a real Quaternius T-Rex, entirely separate
// from the humanoid zombie rig/animations above (different skeleton, own
// walk/run/idle/attack/death/jump clips already baked in by the source
// pack, no Mixamo retargeting involved). See _buildBodyFromTitanGLB.
let _titanModelCache = null

export async function preloadTitanModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/titan/titan.glb')
    _titanModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB titan model failed to load, falling back to procedural titan', err)
  }
}

const DEATH_ANIM_MS = 550
const EXPLODE_LINGER_MS = 150
const HEALTH_BAR_W = 64
const HEALTH_BAR_H = 10
// Single source of truth for "how tall is this zombie's head, in local
// (pre-group-scale) units" - shared by the floating health bar
// (_buildHealthBar) and headshot detection (see getHeadWorldHeight below)
// so the two can never silently drift apart again. Crawler-type zombies
// (see ZombieTypes.js's crawler flag) are genuinely low to the ground, not
// just a shorter standing humanoid - this is the only posture that changes
// it today, but it's read through one method rather than duplicated so a
// future posture gets the same treatment automatically.
const HEAD_HEIGHT_LOCAL = 2.05
const HEAD_HEIGHT_LOCAL_CRAWLER = 0.85
// Acid/Corrosive Rounds - see corrode()'s own comment.
const CORRODE_DAMAGE_MULT = 1.2

const AMBUSH_TRIGGER_RANGE = 9
const AMBUSH_TRIGGER_RANGE_CROUCH = 4.5
const AMBUSH_MAX_WAIT_MS = 14000
const AMBUSH_POP_MS = 220
const AMBUSH_BURST_MS = 1900
const AMBUSH_BURST_SPEED_MULT = 2.3
const DEFAULT_ENRAGE_MULT = 1.4
// Boss enrage phases - permanent, health-triggered escalation distinct
// from the temporary scream-triggered enrage() above. Two thresholds
// give a real "phase 2/3" feel rather than one flat late-fight buff.
const BOSS_ENRAGE_PHASE1_HEALTH_FRACTION = 0.5
const BOSS_ENRAGE_PHASE2_HEALTH_FRACTION = 0.25
const BOSS_ENRAGE_PHASE1_SPEED_MULT = 1.3
const BOSS_ENRAGE_PHASE2_SPEED_MULT = 1.6
const BOSS_ENRAGE_PHASE1_COOLDOWN_MULT = 0.85
const BOSS_ENRAGE_PHASE2_COOLDOWN_MULT = 0.65
const DEFAULT_WEAKEN_MULT = 0.55
// Leg-shot crippling (see isCrippled) - a harsher, PERMANENT version of
// the temporary weaken() slow above. 2 leg hits to trigger.
const CRIPPLE_LEG_HITS = 2
const CRIPPLED_SPEED_MULT = 0.35
// Chase fatigue (batch 7 feature) - a zombie that's been chasing a long
// time visibly slows, ramping down from full speed to CHASE_FATIGUE_MIN_MULT
// over CHASE_FATIGUE_RAMP_MS once CHASE_FATIGUE_START_MS has passed since it
// first noticed the player. Bosses/wandering-horde/ambush types are exempt
// (see the fatigueMult read site) - a boss "giving up" would undercut the
// fight, and wandering/ambush zombies are auto-aware from spawn, so they'd
// otherwise fatigue almost immediately for reasons unrelated to a real chase.
const CHASE_FATIGUE_START_MS = 90000
const CHASE_FATIGUE_RAMP_MS = 60000
const CHASE_FATIGUE_MIN_MULT = 0.55
// Hivemind boss aura - a boss's mere presence speeds up everything near it
// (the actual radius check/constant lives in ZombieManager.js, next to the
// proximity scan itself), distinct from a Screamer's own enrage (a one-off
// scream pulse rather than a standing aura).
const HIVEMIND_SPEED_MULT = 1.3

// Varied hit-reaction stagger - a brief world-space knockback away from
// (roughly) the player, scaled by damage so a pistol tap barely registers
// and a shotgun blast visibly rocks the zombie back. Duration matches
// onHit's existing 200ms staggerUntil freeze so both settle together.
const HIT_REACT_DURATION_MS = 200
const HIT_REACT_MAX_PUSH = 0.12
const HIT_REACT_DAMAGE_FOR_MAX = 80

// Berserker last stand: any zombie below this health fraction goes into a
// desperate final rush - faster and hitting harder right before it dies,
// instead of just plodding along at the same pace all the way down to 0.
// Distinct from enrage (a screamer's buff to others) - this is purely
// self-triggered by the zombie's own remaining health.
const BERSERK_HEALTH_FRACTION = 0.2
const BERSERK_SPEED_MULT = 1.5
const BERSERK_DAMAGE_MULT = 1.3

// The Quaternius zombie model has slim, human-like proportions (see
// _buildBodyFromGLB) - widen X/Z only (not height) so it reads as a bulkier
// monster instead of a plain skinny person. Cheap stopgap ahead of possibly
// sourcing a stockier model later; titan (a T-Rex) doesn't need this.
const GLB_HUMANOID_WIDTH_MULT = 1.45

// Elite variants (see ZombieManager._spawnRandom) - tougher, hit harder,
// visibly gilded so the player can spot the threat before engaging.
const ELITE_HEALTH_MULT = 2.2
const ELITE_DAMAGE_MULT = 1.6
const ELITE_SCALE_MULT = 1.15
const ELITE_TINT_HEX = 0xffc94a
const ELITE_TINT_INTENSITY = 0.65

// Purely cosmetic escalation - as nights climb, regular zombies lerp their
// skin/clothes tones toward a sicklier color and pick up a faint corrupted
// glow, selling "things are getting worse" without any new geometry. Caps
// out by CORRUPTION_MAX_NIGHT so it doesn't keep drifting forever.
const CORRUPTION_MAX_NIGHT = 15
const CORRUPTION_COLOR = 0x3a5a1a
const CORRUPTION_EMISSIVE = 0x4a7a2a
const CORRUPTION_MAX_COLOR_MIX = 0.35
const CORRUPTION_MAX_EMISSIVE_MIX = 0.3

// Boss-only telegraphed ground slam (see _updateBossSpecial/_animate) - a
// wind-up window the player can see coming and step out of, on top of
// their normal quick melee swings.
const BOSS_SPECIAL_COOLDOWN_MS = 8000
const BOSS_SPECIAL_TELEGRAPH_MS = 1100
const BOSS_SPECIAL_RANGE = 5.5
const BOSS_SPECIAL_DAMAGE_MULT = 2.2

// Loose pack "formation": a light separation nudge away from nearby alive
// zombies, blended into the movement direction so a cluster spreads out
// into a rough loose group instead of stacking directly on top of each
// other while all beelining the same player position.
const SEPARATION_RADIUS = 1.1
const SEPARATION_WEIGHT = 0.5

// Pack flanking: when several zombies are converging on the player at once,
// curve each one's approach around a stable per-zombie angle instead of
// every zombie walking the exact same straight line - reads as "surrounding"
// rather than a single-file conga line. Fades out on final approach (see
// FLANK_FADE_DIST) so they still commit to melee range instead of orbiting
// forever.
const FLANK_MIN_PACK_SIZE = 2
const FLANK_RADIUS = 14
const FLANK_MAX_ANGLE = Math.PI / 3
const FLANK_FADE_DIST = 4
// Blind-spot flanking (see the flank block below) - a zombie the player is
// already facing gets pushed harder to the side to actually reach a blind
// spot, while one already roughly behind/beside the player (already in the
// blind spot) is let through more directly instead of wasting the detour.
const FLANK_FRONT_STRENGTH_MULT = 1.4
const FLANK_BLINDSPOT_STRENGTH_MULT = 0.4

// Pack alpha - the lowest-id (i.e. "been alive longest") zombie within
// FLANK_RADIUS of a real pack becomes that pack's alpha for the frame,
// recomputed continuously rather than assigned once, so it naturally
// hands off if the original alpha dies. Purely a speed/visual read on an
// otherwise-ordinary zombie, not a new type.
const ALPHA_SPEED_MULT = 1.2
const ALPHA_EYE_INTENSITY_MULT = 1.8
// "Last one flees" (see Game.js's _checkRoundModeSpecialEvents, which sets
// this.fleeing) - Round Mode only, the last surviving zombie of a wave
// runs rather than attacks.
const FLEE_SPEED_MULT = 1.3

// Corpse avoidance - alive zombies steer lightly around fresh corpses
// instead of walking straight through them, reusing the same separation-
// steering pass already scanning allZombies for pack separation (one more
// branch in that existing loop, not a second O(n^2) pass).
const CORPSE_AVOID_RADIUS = 0.9
const CORPSE_AVOID_WEIGHT = 0.35

// Chokepoint queueing (see the congestion calc in the pack-separation
// block) - a heavily-jostled zombie eases off toward this floor instead of
// shoving at full speed, reading as a funnel/queue at a narrow gap rather
// than a mosh pit. Never fully stops (would look stuck), just slows.
const CHOKEPOINT_MIN_SPEED_MULT = 0.5

// Awareness system (see _updateAwareness/_updateWander) - a regular street
// zombie spawns unaware and drifts on a slow ambient wander until it
// actually notices the player (sight, close proximity, or hearing gunfire -
// see Game.js's _alertNearbyZombiesToGunfire), then permanently switches to
// full hunting behavior. Deliberately one-way: a zombie "forgetting" the
// player mid-chase would read as a bug, not a feature. Ambush/boss/
// wandering-horde zombies already have their own dramatic reveal moment
// and skip straight to aware (see _updateAwareness).
const AWARENESS_SIGHT_RANGE = 18
const AWARENESS_PROXIMITY_RANGE = 6
const WANDER_SPEED_MULT = 0.35
const WANDER_RETARGET_MS = 4000
// Prone stealth (see PlayerController.js's isProne) - only shrinks the
// sight-based branch of _updateAwareness, not AWARENESS_PROXIMITY_RANGE
// (getting that close still wakes a zombie regardless of pose).
const PRONE_SIGHT_RANGE_MULT = 0.4
const CROUCH_SIGHT_RANGE_MULT = 0.7
// Smoke grenade (batch 4 feature)
const SMOKE_SIGHT_RANGE_MULT = 0.35

// Zombie climbing - see _tryMoveOrClimb/_tryClimb. Same height band as
// PlayerController's own MANTLE_MIN/MAX_HEIGHT (0.7-1.4) so zombies can
// climb exactly the same low obstacles the player vaults - previously a
// zombie that hit one of these (a low wall, a car hood, sandbags) just
// got stuck sliding along it forever, making "stand on/behind a
// mantle-height obstacle" a safe spot from melee. A scripted rise-and-
// fall arc back down to ground level on the far side (not a real per-
// frame climb, and not landing ON TOP of the obstacle to stay there -
// see the risk this posed to the "zombies are always at y=0" assumption
// several other systems read, e.g. LOS ray origin, the death-sink
// animation) - same "good enough, not a rigid simulation" spirit as the
// wrecking pendulum's own swing. Crawler/dinosaur (titan) types are
// excluded - different enough movement/animation shape that a generic
// arc would look wrong, and neither is common enough at these obstacles
// to be worth the extra design.
const ZOMBIE_CLIMB_MIN_HEIGHT = 0.7
const ZOMBIE_CLIMB_MAX_HEIGHT = 1.4
const ZOMBIE_CLIMB_LAND_DIST = 1.6
const ZOMBIE_CLIMB_DURATION_MS = 500

// Ranged strafe - spitters sidestep while in their attack band instead of
// planting themselves the instant they're in range, reusing the perpendicular
// of the existing toward-player direction rather than a second target system.
const RANGED_STRAFE_SPEED_MULT = 0.5

// Zombies always stand at group.position.y = 0 (see the constructor) and
// playerPos is the camera/eye position, which sits ~1.7 above the player's
// feet on ordinary flat ground (PlayerController's EYE_HEIGHT) - that gap
// is normal and must not count against melee reach. Only elevation *beyond*
// that (standing on a car roof, a ledge, etc.) should push the player out
// of a melee zombie's reach, so it stops trying to attack through the
// object it's standing under instead of freezing there uselessly.
const TYPICAL_EYE_HEIGHT = 1.7
// See _hasLineOfSight's own comment - how long a cached LOS result stays
// valid before the next call actually re-raycasts.
const LOS_CACHE_MS = 150
// Per-frame LOS raycast budget (see resetLosRaycastBudget/_hasLineOfSight) -
// each zombie's own 150ms cache already bounds ITS cost, but a burst of
// zombies (a pack spawn, a horde event) can still land all of their cache
// expiries on the same frame, spiking to dozens of raycasts at once. This
// spreads that spike across a few frames instead, same "shared per-frame
// budget" idea ZombieManager's own SPAWNS_PER_FRAME already uses for
// construction pacing.
const LOS_RAYCAST_BUDGET_PER_FRAME = 8
let _losRaycastBudgetThisFrame = LOS_RAYCAST_BUDGET_PER_FRAME

// Called once per frame from ZombieManager.update() - refills the shared
// budget every zombie's _hasLineOfSight draws from.
export function resetLosRaycastBudget() {
  _losRaycastBudgetThisFrame = LOS_RAYCAST_BUDGET_PER_FRAME
}

// Zombie Visual LOD (see _shouldFullyAnimate) - distance/occlusion
// thresholds and how often a throttled zombie still gets a real animation
// frame.
const ANIMATION_LOD_FAR_DISTANCE = 40
const ANIMATION_LOD_BEHIND_DISTANCE = 15
const ANIMATION_LOD_OCCLUSION_MIN_DISTANCE = 10
const ANIMATION_LOD_SKIP_FRAMES = 3

let zombieIdCounter = 0

// Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
// called once by a newly-migrated host (see Game.js's _performHostTakeover)
// so the NEXT freshly-spawned zombie's id can never collide with one it
// just inherited - this client's own zombieIdCounter has never tracked
// real in-use ids before now (every shared zombie's real id always came
// from the host, overwritten onto the local instance after construction).
export function bumpZombieIdCounterPast(maxKnownId) {
  if (maxKnownId >= zombieIdCounter) zombieIdCounter = maxKnownId + 1
}

function jitterGeometry(geometry, amount) {
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount,
      pos.getZ(i) + (Math.random() - 0.5) * amount
    )
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

export class Zombie {
  constructor(x, z, typeConfig, isAmbush = false, isElite = false, night = 1, healthMult = 1, speedMult = 1, isNetworkDriven = false) {
    this.id = zombieIdCounter++
    this.type = typeConfig.id
    this.config = typeConfig
    this.isAmbush = isAmbush
    this.isElite = isElite
    // Phase 3 multiplayer (see this class's applyNetworkState/onHit below,
    // and docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
    // true only for a guest's rendering of a zombie the HOST is actually
    // simulating. Everything else about construction (visuals, materials,
    // health bar) runs exactly the same either way; only update()
    // (never called for these) and onHit() (redirected below) differ.
    this.isNetworkDriven = isNetworkDriven
    // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
    // local timestamps applyNetworkState uses to replicate the
    // dormant->popping scale/eye-glow animation and the screamer's
    // throat-glow pulse, neither of which this class's real per-frame
    // update() ever runs for a network-driven instance. Purely cosmetic
    // local approximations - never sent over the network themselves.
    this._netPopStartedAt = 0
    this._netScreamPulseUntil = 0
    this._netWasScreaming = false

    // speedMult: Game.js's nightly mutation roll (see NightEvents.js's
    // NIGHT_MUTATIONS) - a whole-round modifier, distinct from the several
    // timed per-zombie multipliers effectiveSpeed already combines below
    // (burst/enrage/berserk/weaken).
    this.speed = (typeConfig.speedMin + Math.random() * (typeConfig.speedMax - typeConfig.speedMin)) * speedMult
    this.phase = Math.random() * Math.PI * 2
    this.twitchPhase = Math.random() * Math.PI * 2
    this.postureOffset = (Math.random() - 0.5) * 0.3
    this.asymmetrySide = Math.random() < 0.5 ? -1 : 1
    this.asymmetryAmount = 0.1 + Math.random() * 0.18
    this.stopDistance = typeConfig.ranged ? typeConfig.engageRange : typeConfig.meleeRange

    this.health = typeConfig.health * (isElite ? ELITE_HEALTH_MULT : 1) * healthMult
    this.maxHealth = this.health
    // Shielded type (see ZombieTypes.js's shielded/shieldHealth) - a
    // separate absorb pool that non-melee hits drain first; melee bypasses
    // it entirely (see onHit's blockedByShield check). 0 for every other
    // type, so the check there is always false without extra guards.
    this.shieldHealth = typeConfig.shielded ? typeConfig.shieldHealth : 0
    // alive states flow: dormant -> popping -> alive -> dying/exploding -> dead
    this.state = isAmbush ? 'dormant' : 'alive'
    this.dormantSince = performance.now()
    // Awareness system (see _updateAwareness/_updateWander) - starts false
    // for every zombie; ambush/boss/wandering-horde ones get auto-flipped
    // true the first time _updateAwareness runs (their own spawn is already
    // the "noticed you" moment), so isAmbush isn't read directly here.
    this.aware = false
    this.awareSince = 0
    this.wanderDirX = 0
    this.wanderDirZ = 1
    this.wanderRetargetAt = 0
    this.isPackAlpha = false
    this._congestion = 0
    // Jittered per-instance so a cluster of ambush zombies doesn't all pop
    // with the exact same timing - see the 'dormant'->'popping' transition
    // and forceWake().
    this.popDurationMs = AMBUSH_POP_MS * (0.7 + Math.random() * 0.6)
    this.burstDurationMs = AMBUSH_BURST_MS * (0.8 + Math.random() * 0.4)
    this.staggerUntil = 0
    // Varied hit-reaction (see onHit/_updateHitReact) - direction/magnitude
    // of the most recent non-lethal hit, decayed back to a zero offset every
    // frame rather than accumulated, same "recompute fresh, never just add"
    // discipline Game.js's own camera shake uses.
    this.hitReactX = 0
    this.hitReactZ = 1
    this.hitReactMagnitude = 0
    this.hitReactStartedAt = 0
    this._hitReactOffsetX = 0
    this._hitReactOffsetZ = 0
    this.attackCooldownUntil = 0
    this.attackAnimUntil = 0
    this.dieStartedAt = 0
    this.popStartedAt = 0
    this.burstUntil = 0
    this.pendingExplosion = false
    this.explodeStartedAt = 0
    this.screamCooldownUntil = performance.now() + (typeConfig.screams ? Math.random() * typeConfig.screamCooldown * 1000 : 0)
    this.screamPulseUntil = 0
    this.trailCooldownUntil = performance.now() + (typeConfig.leavesTrail ? Math.random() * typeConfig.trailIntervalMs : 0)
    this.leapCooldownUntil = 0
    this.enragedUntil = 0
    this.weakenedUntil = 0
    // Hivemind boss aura (see ZombieManager's own per-frame proximity
    // check) - continuously refreshed while within range of an alive
    // boss, same "refresh timer, don't stack" shape as enragedUntil.
    this.hivemindBuffUntil = 0
    // Limb damage (see WeaponSystem's isLegShot handling) - unlike the
    // existing brief weaken() slow, this is permanent once triggered:
    // enough leg hits and the zombie switches to the 'crawl' clip and
    // stays badly slowed for the rest of its life, not just 2 seconds.
    this.legHitCount = 0
    this.isCrippled = false
    // Boss enrage phases (see onHit's _checkEnragePhase call and
    // _bossPhaseSpeedMult/_bossPhaseCooldownMult below) - permanent once
    // triggered, unlike the temporary scream-triggered enrage() a regular
    // zombie can get. 0 = normal, 1 = below 50% health, 2 = below 25%.
    this.enragePhase = 0
    this.isBerserk = false
    this.specialCooldownUntil = 0
    this.specialTelegraphUntil = 0
    this._specialArmed = false

    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)

    // Reused every frame by _tryMove/_hasLineOfSight instead of allocating
    // fresh objects per zombie per frame - there can be a couple dozen of
    // these alive checking every frame.
    this._moveBox = new THREE.Box3()
    // Climbing (see _tryClimb/_tryMoveOrClimb) - isClimbing false the vast
    // majority of the time (only true for the brief scripted arc), the
    // rest just needs somewhere to live between _tryClimb and update()'s
    // own climbing branch.
    this.isClimbing = false
    this._climbStartX = 0
    this._climbStartZ = 0
    this._climbPeakY = 0
    this._climbTargetX = 0
    this._climbTargetZ = 0
    this._climbStartedAt = 0
    this._losRaycaster = new THREE.Raycaster()
    this._losOrigin = new THREE.Vector3()
    this._losDir = new THREE.Vector3()
    // Performance: _hasLineOfSight raycasts against the WHOLE solidMeshes
    // array (1000+ objects with 14 stages of world geometry) - cheap for
    // one zombie, but every zombie within melee/engage range does this
    // every single frame, and a horde fight is exactly the moment many
    // zombies are simultaneously that close. Line of sight to the player
    // doesn't meaningfully change frame-to-frame, so caching the result for
    // a short window cuts the real raycast frequency by ~90% with no
    // perceptible gameplay difference (worst case, a zombie's approach/
    // attack decision is up to LOS_CACHE_MS stale).
    this._losCachedResult = true
    this._losCacheUntil = 0

    this._buildBody()

    // GLB scale correction applied at this.group, not inside the GLB clone
    // itself - scaling a shared ancestor of both a SkinnedMesh and its own
    // skeleton bones double-applies in Three.js's skinning math (confirmed
    // empirically: a per-clone scale of S produced S^2 the expected size).
    // this.group sits outside that mesh+skeleton hierarchy entirely, so a
    // scale here behaves as a normal single-order transform, same as every
    // non-GLB zombie already relies on for baseScale.
    const glbCorrection = this.usingGLB ? this._glbScaleCorrection : 1
    const baseScale = typeConfig.scale * (isElite ? ELITE_SCALE_MULT : 1) * glbCorrection
    this.baseScale = baseScale
    // The humanoid GLB source model (Quaternius, no texture) reads as a
    // slim, plain person rather than a chunky monster - unlike titan
    // (a T-Rex, already naturally bulky) this widens X/Z only, leaving
    // height (Y) untouched, as a free/instant partial fix for that ahead
    // of possibly sourcing a stockier model later.
    const widthMult = this.usingGLB && !this.config.dinosaur ? GLB_HUMANOID_WIDTH_MULT : 1
    this.glbWidthMult = widthMult
    if (isAmbush) {
      this.group.scale.set(baseScale * widthMult, baseScale * 0.35, baseScale * widthMult)
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = 0.25
    } else {
      this.group.scale.set(baseScale * widthMult, baseScale, baseScale * widthMult)
    }

    if (isElite) {
      // Recolor every body material gold and bake that into materialDefaults
      // too, so onHit's white hit-flash still reverts to the gilded tint
      // instead of snapping back to the original dull color.
      for (const mat of this.materials) {
        mat.emissive.setHex(ELITE_TINT_HEX)
        mat.emissiveIntensity = ELITE_TINT_INTENSITY
        this.materialDefaults.set(mat, { hex: ELITE_TINT_HEX, intensity: ELITE_TINT_INTENSITY })
      }
    } else if (night > 1) {
      const progress = Math.min(1, (night - 1) / (CORRUPTION_MAX_NIGHT - 1))
      const corruptColor = new THREE.Color(CORRUPTION_COLOR)
      const corruptEmissive = new THREE.Color(CORRUPTION_EMISSIVE)
      for (const mat of this.materials) {
        mat.color.lerp(corruptColor, progress * CORRUPTION_MAX_COLOR_MIX)
        mat.emissive.lerp(corruptEmissive, progress * CORRUPTION_MAX_EMISSIVE_MIX)
        mat.emissiveIntensity = Math.max(mat.emissiveIntensity, progress * 0.4)
        this.materialDefaults.set(mat, { hex: mat.emissive.getHex(), intensity: mat.emissiveIntensity })
      }
    }

    this._buildHealthBar()
  }

  _buildBody() {
    // Titan (dinosaur silhouette) is an entirely different body plan
    // (elongated skull, tiny arms, tail, no hood/hair) - a real Quaternius
    // T-Rex, not a rescale/retint of the humanoid zombie rig. Falls back to
    // its old procedural body if that model failed to load.
    if (this.config.dinosaur) {
      if (USE_GLB_ZOMBIES && _titanModelCache) {
        this._buildBodyFromTitanGLB()
        return
      }
      this._buildBodyProcedural()
      return
    }
    if (USE_GLB_ZOMBIES && _zombieModelCache) {
      this._buildBodyFromGLB()
      return
    }
    this._buildBodyProcedural()
  }

  // Phase 1 GLB path - see preloadZombieModel/USE_GLB_ZOMBIES above. Clones
  // the cached rigged mesh + animation clips, populates the exact same
  // hittableMeshes/materials/materialDefaults/eyeMaterials contract the
  // procedural builder does (see the `track` helper in
  // _buildBodyProcedural) so onHit/elite-tint/corruption-tint keep working
  // unmodified regardless of which body a given instance has.
  _buildBodyFromGLB() {
    this.usingGLB = true
    // SkeletonUtils.clone() (not plain .clone(true)) - a plain clone
    // silently breaks skinned-mesh bone bindings, a documented gotcha for
    // this exact pipeline (see 3D_ASSET_OVERHAUL.md gotcha #2).
    const cloned = cloneSkeleton(_zombieModelCache.scene)
    // Corrective scale for a unit mismatch introduced somewhere in the
    // Quaternius FBX -> Blender -> glTF export chain. Deliberately the only
    // scale correction anywhere in this pipeline - an earlier attempt to
    // bake a correction into the Blender export itself (scaling the
    // armature + transform_apply) produced non-linear, unreliable results
    // at runtime, almost certainly because transform_apply on an animated
    // armature desyncs the animation keyframes' translation channels from
    // the newly-rescaled rest-pose bone lengths. This factor was derived
    // empirically against the clean unscaled export: this exact scene's
    // real Three.js Box3 height (8.188) divided into a real procedural
    // shambler's own measured height (1.947, via the same
    // Box3.setFromObject check) - the only ground truth that actually
    // matters for this game's zombies reading as a consistent size.
    // (scale applied via this.group instead - see the constructor, right
    // after _buildBody() returns - not here. See _glbScaleCorrection.)
    this._glbScaleCorrection = 0.2378

    this.hittableMeshes = []
    this.eyeMaterials = []
    this.materials = new Set()
    this.materialDefaults = new Map()

    // Per-type body tint - the source FBX has one flat untextured material,
    // so unlike the procedural body's separate skin/clothes materials this
    // is a single blended tone. Picked the same way _buildBodyProcedural
    // picks its skin tone (random from the type's palette) so instances of
    // the same type still read as slightly varied, not identical clones.
    const bodyTint = this.config.skinTones[Math.floor(Math.random() * this.config.skinTones.length)]
    // LOW_QUALITY_MATERIALS: one shared, cheap MeshLambertMaterial for the whole
    // zombie instead of the GLB's own (per-mesh-cloned) PBR material - real
    // GPU cost win with ~65 lights in the scene (Lambertian diffuse is much
    // cheaper per pixel than the Standard material's roughness/metalness
    // BRDF), on top of literally being "1 colour" as asked. Kept as a
    // simple flag rather than deleting the real-material path - see
    // QualitySettings.js.
    // map is included even under LOW_QUALITY_MATERIALS - Lambert genuinely
    // supports it (see flatMaterial's own comment), and it's still just
    // one shared texture object referenced here, not a per-instance
    // clone, so this doesn't reopen the performance cost this mode exists
    // to avoid. Without it, LOW_QUALITY_MATERIALS being the game's current
    // actual default (see QualitySettings.js) meant this whole skin-detail
    // feature would never actually be visible in the live game at all.
    const sharedLowQualityMat = LOW_QUALITY_MATERIALS ? new THREE.MeshLambertMaterial({ color: bodyTint, map: getZombieSkinTexture() }) : null

    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      if (LOW_QUALITY_MATERIALS) {
        child.material = sharedLowQualityMat
      } else {
        // GLTFLoader shares materials across every clone by default (the #1
        // recurring bug class in this codebase - see CLAUDE.md) - clone per
        // instance so this zombie's hit-flash/tint never fights another
        // zombie sharing the same source material.
        child.material = flattenedClone(child.material)
        child.material.color.setHex(bodyTint)
        // Shared grime/wound detail texture (see getZombieSkinTexture's own
        // comment) - multiplies against bodyTint above, so this still
        // reads as this instance's own random tone, just no longer a flat
        // plastic plane. Skipped in LOW_QUALITY_MATERIALS along with the rest
        // of the real-material path above.
        child.material.map = getZombieSkinTexture()
      }
      child.userData.zombie = this
      this.hittableMeshes.push(child)
      this.materials.add(child.material)
      this.materialDefaults.set(child.material, {
        hex: child.material.emissive ? child.material.emissive.getHex() : 0,
        intensity: child.material.emissiveIntensity || 0,
      })
    })

    // Gland/belly/throat FX spheres - same visual language as the
    // procedural body's (see _buildBodyProcedural's ranged/screams/
    // explodes blocks) but bone-parented instead of
    // hips-group-parented, per 3D_ASSET_OVERHAUL.md Phase 2's "keep them
    // procedural spheres parented to spine/head bones" guidance. Authored
    // in the bone's own (unscaled, ~4.2x oversized) local space so they
    // shrink to the right final size under the same group-level
    // _glbScaleCorrection the whole mesh already gets - see
    // _addGlbFxSphere.
    this._addTypeFxSpheres(cloned)

    this.group.add(cloned)
    this._glbRoot = cloned
    this.mixer = new THREE.AnimationMixer(cloned)
    this._glbActions = {}
    this._glbClipSource = _zombieModelCache.animations
    this._glbCurrentAction = null
    this._playGlbAction('idle', true)

    // _buildHealthBar (called right after _buildBody by the constructor)
    // just needs group.position-relative placement - no dependency on the
    // procedural rig's named parts, so it works unchanged for GLB too.
  }

  // Titan GLB path - a real Quaternius T-Rex (asset-source/build-titan.py),
  // entirely separate rig/animations from the humanoid zombie above. The
  // 'dying'/'popping' state handlers in update() are generic over any body
  // that sets usingGLB + populates _glbActions/mixer, so this only needs
  // its own body-building and animation-dispatch (_animateGLBTitan) - no
  // other shared code needed a titan-specific branch.
  _buildBodyFromTitanGLB() {
    this.usingGLB = true
    const cloned = cloneSkeleton(_titanModelCache.scene)
    // Empirically-measured, and NOT simply linear in this factor like the
    // zombie's correction is - this FBX bakes a literal (3,3,3) scale onto
    // its "Armature" node (confirmed via a getWorldScale trace over every
    // node), which sits *inside* the shared SkinnedMesh/Skeleton ancestor
    // chain and gets double-applied through Three.js's skin-matrix math,
    // the same mechanism as the zombie's original S^2 bug - except there
    // it was safe to relocate the correction outside that chain (to
    // this.group). Here the doubling is baked into the source armature
    // itself, not something this code introduces, so it can't be
    // sidestepped by choosing where to apply this.group's scale - and
    // resetting the Armature's own .scale post-clone at runtime would
    // desync it from the bindMatrixInverse GLTFLoader already computed at
    // bind time, warping the mesh rather than just resizing it. Simplest
    // safe fix: this constant is fit to counteract the actual measured
    // quadratic relationship (two real data points confirmed size ~
    // correction^2, not correction) rather than derived by division like
    // the zombie's. Calibrated so the GLB's standing height (Y) matches
    // the old procedural titan's real measured Box3 height (6.193). The
    // GLB's length (nose-to-tail Z) ends up proportionally longer than the
    // old boxy placeholder's Z - that's correct, not a bug: a real T-Rex
    // is just a longer shape than a crude box approximation, and gameplay
    // hitbox math (_hasLineOfSight's origin, the collider halfW/height)
    // reads this.config.scale directly, not this visual correction, so
    // it's unaffected either way.
    this._glbScaleCorrection = 0.10830

    this.hittableMeshes = []
    this.eyeMaterials = []
    this.materials = new Set()
    this.materialDefaults = new Map()

    // Only the "Green"/"LightGreen" materials are skin - "Black"/"Red"/
    // "LightYellow" are claws/eyes/teeth on this model and should keep
    // their own colors, unlike the zombie's single flat material.
    const bodyTint = this.config.skinTones[Math.floor(Math.random() * this.config.skinTones.length)]
    const SKIN_MATERIAL_NAMES = new Set(['Green', 'LightGreen'])

    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      const isSkin = SKIN_MATERIAL_NAMES.has(child.material.name)
      child.material = flattenedClone(child.material)
      if (isSkin) {
        child.material.color.setHex(bodyTint)
        // Shared scale-detail texture (see getTitanScaleTexture) - same
        // multiply-over-tint approach as the humanoid zombie's skin
        // texture, only on the actual skin materials so claws/eyes/teeth
        // keep their own flat colors untouched.
        child.material.map = getTitanScaleTexture()
      }
      child.userData.zombie = this
      this.hittableMeshes.push(child)
      this.materials.add(child.material)
      this.materialDefaults.set(child.material, {
        hex: child.material.emissive ? child.material.emissive.getHex() : 0,
        intensity: child.material.emissiveIntensity || 0,
      })
    })

    this.group.add(cloned)
    this._glbRoot = cloned
    this.mixer = new THREE.AnimationMixer(cloned)
    this._glbActions = {}
    this._glbClipSource = _titanModelCache.animations
    this._glbCurrentAction = null
    this._playGlbAction('idle', true)
  }

  // GLB path for titan's normal 'alive' state - separate from _animateGLB
  // because the clip set is different (walk/attack/death/idle/run/jump,
  // no crawl/punch/kick) and there's no punch-vs-kick split to make (it's
  // always the same bite/tail-swipe attack clip).
  _animateGLBTitan(dt, elapsed) {
    const attacking = performance.now() < this.attackAnimUntil
    this._playGlbAction(attacking ? 'attack' : 'walk', !attacking)
    this.mixer.update(dt)
  }

  // Attaches one emissive sphere to a named bone on the cloned GLB rig.
  // radius/localY are given in the bone's own (unscaled) local space - the
  // caller is responsible for the ~4.2x _glbScaleCorrection blow-up (see
  // _addTypeFxSpheres). Populates the same hittableMeshes/materials
  // contract every other GLB mesh does, so it's shootable and reverts
  // through the normal hit-flash path.
  _addGlbFxSphere(root, boneName, { radius, color, emissive, emissiveIntensity, localY = 0, squash = null }) {
    const bone = root.getObjectByName(boneName)
    if (!bone) return null
    const mat = flatMaterial({ color, emissive, emissiveIntensity, roughness: 0.65 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), mat)
    mesh.position.set(0, localY, 0)
    if (squash) mesh.scale.set(squash[0], squash[1], squash[2])
    mesh.castShadow = true
    mesh.userData.zombie = this
    bone.add(mesh)
    this.hittableMeshes.push(mesh)
    this.materials.add(mat)
    this.materialDefaults.set(mat, { hex: mat.emissive.getHex(), intensity: mat.emissiveIntensity })
    return { mesh, mat }
  }

  // Per-type gland/belly/throat FX, mirroring _buildBodyProcedural's
  // ranged/screams/explodes blocks - see _updateGlandFX for the shared
  // pulse animation both bodies drive off pulseMesh/throatMesh.
  _addTypeFxSpheres(root) {
    const cfg = this.config
    const INV_CORR = 1 / this._glbScaleCorrection

    // Belly/bloat/vein spheres deliberately sit close to the Spine bone
    // with little to no extra Y offset - a screenshot check during Phase 2
    // showed the original Spine1 + larger offset combination reading as a
    // floating orb around the *head*, not a torso bulge (the humanoid
    // rig's Spine-Neck bone spacing is short, so any generous upward
    // offset overshoots past the chest). Radii also trimmed ~15-20% off
    // the pure INV_CORR conversion - real bones carry a small extra scale
    // beyond the group-level correction (measured ~1.07-1.18x depending on
    // which bone), so an uncorrected conversion consistently overshoots.
    if (cfg.ranged) {
      const fx = this._addGlbFxSphere(root, 'Spine', {
        radius: 0.26 * INV_CORR, color: 0x1a2408, emissive: 0x9fe23f, emissiveIntensity: 1.1,
        localY: 0.05 * INV_CORR, squash: [1, 0.9, 0.85],
      })
      if (fx) { this.pulseMesh = fx.mesh; this.pulseBaseScale = fx.mesh.scale.clone() }
    }
    if (cfg.screams) {
      const fx = this._addGlbFxSphere(root, 'Neck', {
        radius: 0.14 * INV_CORR, color: 0x3a1a44, emissive: 0xb060e0, emissiveIntensity: 0.9,
        localY: 0.1 * INV_CORR, squash: [1, 0.8, 0.8],
      })
      if (fx) { this.throatMesh = fx.mesh; this.throatMat = fx.mat; this.throatBaseScale = fx.mesh.scale.clone() }
    }
    if (cfg.explodes) {
      const fx = this._addGlbFxSphere(root, 'Spine', {
        radius: 0.32 * INV_CORR, color: 0x3a4a12, emissive: 0xaadd44, emissiveIntensity: 0.7,
        localY: 0, squash: [1.1, 1, 0.95],
      })
      if (fx) { this.pulseMesh = fx.mesh; this.pulseBaseScale = fx.mesh.scale.clone() }
    }
  }

  _playGlbAction(name, loop) {
    let action = this._glbActions[name]
    if (!action) {
      // Built lazily on first use instead of all ~9 (zombie) / fewer
      // (titan) clips upfront in the constructor - most zombies never
      // play most of their niche clips (crawl/scream/kick/punch are all
      // type- or boss-gated), and mixer.clipAction() is a real per-call
      // cost (~0.1ms, measured) that used to be paid for every clip on
      // every single spawn regardless of whether it ever ran. Same
      // resulting AnimationAction either way once created - just created
      // when actually needed instead of speculatively.
      const clip = this._glbClipSource.find((c) => c.name === name)
      if (!clip) return
      action = this.mixer.clipAction(clip)
      this._glbActions[name] = action
    }
    if (this._glbCurrentAction === action) return
    action.reset()
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !loop
    action.fadeIn(0.15)
    if (this._glbCurrentAction) this._glbCurrentAction.fadeOut(0.15)
    action.play()
    this._glbCurrentAction = action
  }

  _buildBodyProcedural() {
    const cfg = this.config
    const isCrawler = !!cfg.crawler
    const skin = cfg.skinTones[Math.floor(Math.random() * cfg.skinTones.length)]
    const clothes = cfg.clothesTones[Math.floor(Math.random() * cfg.clothesTones.length)]

    // LOW_QUALITY_MATERIALS: one shared, cheap MeshLambertMaterial for every
    // body part instead of ~13 separate PBR materials - see the GLB path's
    // own note on why (much cheaper per-pixel lighting with ~65 scene
    // lights, plus literally "1 colour" as asked). Only reachable for the
    // dinosaur/Titan type or if the GLB zombie model failed to load - the
    // common case is _buildBodyFromGLB above. QualitySettings.js flag
    // controls this, real per-part materials untouched below it.
    const lowQualityMat = LOW_QUALITY_MATERIALS ? new THREE.MeshLambertMaterial({ color: skin }) : null
    const skinMat = lowQualityMat || flatMaterial({ color: skin, roughness: 0.98 })
    const skinMatAlt = lowQualityMat || flatMaterial({ color: shadeColor(skin, -0.12), roughness: 0.98 })
    const clothesMat = lowQualityMat || flatMaterial({ color: clothes, roughness: 1 })
    const woundMat = lowQualityMat || flatMaterial({ color: 0x4a0f0f, roughness: 0.75, emissive: 0x2a0505, emissiveIntensity: 0.3 })
    const grimeMat = lowQualityMat || flatMaterial({ color: 0x14120f, roughness: 1 })
    const clawMat = lowQualityMat || flatMaterial({ color: 0x1a1a16, roughness: 0.6 })
    const toothMat = lowQualityMat || flatMaterial({ color: 0xcfc7a8, roughness: 0.5 })
    const socketMat = lowQualityMat || flatMaterial({ color: 0x0c0c0a, roughness: 1 })
    const jointMat = lowQualityMat || flatMaterial({ color: 0x0a0a08, roughness: 1 })
    const hairMat = lowQualityMat || flatMaterial({ color: 0x0f0d0a, roughness: 1 })
    const hoodMat = lowQualityMat || flatMaterial({ color: 0x1c211c, roughness: 1 })
    const hoodInsideMat = lowQualityMat || flatMaterial({ color: 0x0a0c0a, roughness: 1 })
    const wetBloodMat = lowQualityMat || flatMaterial({ color: 0x5a0808, roughness: 0.25, metalness: 0.1 })

    this.hittableMeshes = []
    this.eyeMaterials = []
    this.materials = new Set()
    this.materialDefaults = new Map()

    const track = (mesh, mat) => {
      mesh.castShadow = true
      mesh.userData.zombie = this
      this.hittableMeshes.push(mesh)
      if (!this.materials.has(mat)) {
        this.materials.add(mat)
        this.materialDefaults.set(mat, { hex: mat.emissive.getHex(), intensity: mat.emissiveIntensity })
      }
      return mesh
    }

    const jointBand = (parent, y, radius) => {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.035, 6), jointMat)
      band.position.y = y
      parent.add(band)
    }

    this.hips = new THREE.Group()
    this.hips.position.y = isCrawler ? 0.52 : 1.0
    this.group.add(this.hips)

    const torsoGeo = jitterGeometry(new THREE.BoxGeometry(0.58, 0.78, 0.34, 2, 2, 2), 0.025)
    const torso = track(new THREE.Mesh(torsoGeo, clothesMat), clothesMat)
    torso.position.y = 0.42
    torso.rotation.z = this.postureOffset * 0.3
    this.hips.add(torso)
    this.torso = torso

    // Spine ridge bumps down the back.
    for (let i = 0; i < 4; i++) {
      const ridge = track(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.06), skinMatAlt), skinMatAlt)
      ridge.position.set((Math.random() - 0.5) * 0.06, 0.18 + i * 0.14, -0.19)
      ridge.rotation.x = (Math.random() - 0.5) * 0.3
      this.hips.add(ridge)
    }

    if (this.config.ranged) {
      const bellyMat = flatMaterial({
        color: 0x1a2408,
        emissive: 0x9fe23f,
        emissiveIntensity: 1.1,
      })
      const belly = track(new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), bellyMat), bellyMat)
      belly.position.set(0, 0.28, 0.12)
      belly.scale.set(1, 0.9, 0.85)
      this.hips.add(belly)
      this.pulseMesh = belly
      this.pulseBaseScale = belly.scale.clone()
    }

    if (this.config.screams) {
      const throatMat = flatMaterial({
        color: 0x3a1a44,
        emissive: 0xb060e0,
        emissiveIntensity: 0.9,
      })
      const throat = track(new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), throatMat), throatMat)
      throat.position.set(0, 0.68, 0.16)
      throat.scale.set(1, 0.8, 0.8)
      this.hips.add(throat)
      this.throatMesh = throat
      this.throatMat = throatMat
      this.throatBaseScale = throat.scale.clone()
    }

    if (this.config.explodes) {
      const bloatMat = flatMaterial({
        color: 0x3a4a12,
        emissive: 0xaadd44,
        emissiveIntensity: 0.7,
        roughness: 0.6,
      })
      const bloat = track(new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 10), bloatMat), bloatMat)
      bloat.position.set(0, 0.35, 0.08)
      bloat.scale.set(1.1, 1, 0.95)
      this.hips.add(bloat)
      this.pulseMesh = bloat
      this.pulseBaseScale = bloat.scale.clone()
    }


    for (let i = 0; i < 4; i++) {
      const strip = track(
        new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.05), clothesMat),
        clothesMat
      )
      strip.position.set(-0.22 + i * 0.15, 0.02, 0.16)
      strip.rotation.z = (Math.random() - 0.5) * 0.4
      strip.rotation.x = (Math.random() - 0.5) * 0.3
      this.hips.add(strip)
    }

    const woundCount = 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < woundCount; i++) {
      const mat = Math.random() < 0.6 ? woundMat : grimeMat
      const w = 0.08 + Math.random() * 0.2
      const h = 0.08 + Math.random() * 0.18
      const isFlap = Math.random() < 0.35
      const wound = track(new THREE.Mesh(new THREE.BoxGeometry(w, h, isFlap ? 0.02 : 0.045), mat), mat)
      wound.position.set(
        (Math.random() - 0.5) * 0.5,
        0.15 + Math.random() * 0.7,
        0.14 + Math.random() * 0.08
      )
      wound.rotation.z = (Math.random() - 0.5) * 0.6
      if (isFlap) wound.rotation.x = 0.6 + Math.random() * 0.5
      this.hips.add(wound)
    }

    // A rib or two poking through the worst wound, for anything without a bloated torso.
    if (!this.config.explodes) {
      const ribCount = 1 + Math.floor(Math.random() * 2)
      for (let i = 0; i < ribCount; i++) {
        const rib = track(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.02), toothMat), toothMat)
        rib.position.set(-0.1 + i * 0.11 + (Math.random() - 0.5) * 0.05, 0.32 + Math.random() * 0.12, 0.175)
        rib.rotation.z = (Math.random() - 0.5) * 0.35
        this.hips.add(rib)
      }
    }

    jointBand(this.hips, 0.82, 0.19)

    this.head = new THREE.Group()
    this.head.position.y = 0.95
    this.head.rotation.x = 0.15
    this.hips.add(this.head)

    // T-Rex-style elongated skull/snout instead of the usual rounded
    // humanoid head - longer on Z (front-to-back), flatter on Y.
    const skullGeo = jitterGeometry(new THREE.BoxGeometry(0.28, 0.34, 0.3, 2, 2, 2), 0.018)
    const skull = track(new THREE.Mesh(skullGeo, skinMat), skinMat)
    skull.scale.set(
      cfg.dinosaur ? 1.15 : 1,
      cfg.dinosaur ? 0.85 : 1,
      cfg.dinosaur ? 1.9 : 0.9
    )
    this.head.add(skull)

    // Sunken cheek indents.
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.1), socketMat)
      cheek.position.set(side * 0.13, -0.03, 0.09)
      this.head.add(cheek)
    }

    // Torn, uneven ears - reptiles don't have these.
    if (!cfg.dinosaur) for (const side of [-1, 1]) {
      const ear = track(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.09), skinMatAlt), skinMatAlt)
      ear.position.set(side * 0.145, 0.01, -0.01)
      ear.rotation.z = side * 0.35
      ear.rotation.x = (Math.random() - 0.5) * 0.4
      this.head.add(ear)
    }

    // Patchy hair tufts on the scalp - same, skip for a scaly dinosaur head.
    const tuftCount = cfg.dinosaur ? 0 : 3 + Math.floor(Math.random() * 3)
    for (let i = 0; i < tuftCount; i++) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 4), hairMat)
      tuft.position.set((Math.random() - 0.5) * 0.2, 0.17, (Math.random() - 0.5) * 0.15 - 0.02)
      tuft.rotation.set((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)
      this.head.add(tuft)
    }

    for (const side of [-1, 1]) {
      const socket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.06), socketMat)
      socket.position.set(side * 0.08, 0.04, 0.16)
      this.head.add(socket)

      const eyeMat = flatMaterial({ color: 0xc8d0d0, emissive: 0xd8e8ff, emissiveIntensity: 1.5 })
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), eyeMat)
      eye.position.set(side * 0.08, 0.04, 0.175)
      this.head.add(eye)
      this.eyeMaterials.push(eyeMat)
    }

    const jaw = track(new THREE.Mesh(jitterGeometry(new THREE.BoxGeometry(0.2, 0.13, 0.24, 2, 1, 2), 0.015), skinMat), skinMat)
    jaw.position.set(0, -0.21, 0.02)
    jaw.rotation.x = 0.35
    this.head.add(jaw)

    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 4), toothMat)
      tooth.rotation.x = Math.PI
      tooth.position.set(-0.06 + i * 0.04, -0.15, 0.13)
      this.head.add(tooth)
    }

    // Blood drips from the jaw corners, matching the wet-mouth reference look.
    for (const side of [-1, 1]) {
      const drip = track(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.09 + Math.random() * 0.06, 5), wetBloodMat), wetBloodMat)
      drip.position.set(side * 0.075, -0.24, 0.11)
      drip.rotation.z = side * 0.15
      this.head.add(drip)
    }

    jointBand(this.head, -0.19, 0.1)

    // Ragged hood framing the face, drooping down over the shoulders - not
    // for a dinosaur, obviously. this.hood is only ever read inside this
    // same block, so skipping it entirely is safe.
    if (!cfg.dinosaur) {
      this.hood = new THREE.Group()
      this.hood.position.y = 0.04
      this.head.add(this.hood)

      const hoodDome = track(new THREE.Mesh(new THREE.SphereGeometry(0.185, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), hoodMat), hoodMat)
      hoodDome.position.set(0, 0.11, -0.02)
      this.hood.add(hoodDome)

      const hoodInside = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hoodInsideMat)
      hoodInside.position.set(0, 0.09, 0.03)
      this.hood.add(hoodInside)

      for (const side of [-1, 1]) {
        const flap = track(new THREE.Mesh(jitterGeometry(new THREE.BoxGeometry(0.11, 0.42, 0.05, 1, 3, 1), 0.02), hoodMat), hoodMat)
        flap.position.set(side * 0.185, -0.24, 0.01)
        flap.rotation.z = side * 0.16
        flap.rotation.x = -0.05
        this.hood.add(flap)
      }
    }

    // Tiny T-Rex arms, full-length everywhere else.
    const armUpper = cfg.dinosaur ? 0.1 : isCrawler ? 0.24 : 0.27
    const armLower = cfg.dinosaur ? 0.08 : isCrawler ? 0.2 : 0.23
    const sleeveCuff = (shoulderGroup) => {
      const sleeve = track(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.095, 0.1, 6), clothesMat), clothesMat)
      sleeve.position.y = -0.04
      shoulderGroup.add(sleeve)
    }

    const armRadius = cfg.dinosaur ? 0.045 : 0.08
    const armShoulderX = cfg.dinosaur ? 0.22 : 0.36

    this.armL = this._buildLimb(armRadius, armUpper, armLower, skinMat, clawMat, jointMat, track, true)
    this.armL.shoulder.position.set(-armShoulderX, 0.72, 0.08)
    this.armL.shoulder.rotation.x = -1.15
    this.armL.shoulder.rotation.z = this.asymmetrySide === -1 ? this.asymmetryAmount * 0.6 : 0
    if (!cfg.dinosaur) sleeveCuff(this.armL.shoulder)
    this.hips.add(this.armL.shoulder)

    this.armR = this._buildLimb(armRadius, armUpper, armLower, skinMat, clawMat, jointMat, track, true)
    this.armR.shoulder.position.set(armShoulderX, 0.72, 0.08)
    this.armR.shoulder.rotation.x = -1.15
    this.armR.shoulder.rotation.z = this.asymmetrySide === 1 ? -this.asymmetryAmount * 0.6 : 0
    if (!cfg.dinosaur) sleeveCuff(this.armR.shoulder)
    this.hips.add(this.armR.shoulder)

    const legUpper = isCrawler ? 0.13 : 0.32
    const legLower = isCrawler ? 0.11 : 0.3

    const foot = (elbowGroup, lowerLen) => {
      const bootMat = grimeMat
      const f = track(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.23), bootMat), bootMat)
      f.position.set(0, -lowerLen - 0.02, 0.07)
      elbowGroup.add(f)
    }

    this.legL = this._buildLimb(0.1, legUpper, legLower, clothesMat, null, jointMat, track, false)
    this.legL.shoulder.position.set(-0.16, 0.05, 0)
    if (!isCrawler) foot(this.legL.elbow, legLower)
    this.hips.add(this.legL.shoulder)

    this.legR = this._buildLimb(0.1, legUpper, legLower, clothesMat, null, jointMat, track, false)
    this.legR.shoulder.position.set(0.16, 0.05, 0)
    if (!isCrawler) foot(this.legR.elbow, legLower)
    this.hips.add(this.legR.shoulder)

    // Tail: a tapering chain of segments extending backward (-Z, away from
    // the face - eyes/teeth sit at +Z) off the hips. Each segment is a child
    // of the last, offset by -segLen along its parent's local Z, so the
    // whole chain follows the hip's forward hunch and any future per-segment
    // animation without needing its own separate update logic. The one
    // silhouette element that reads as "dinosaur" more than anything else
    // here - nothing else in this rig has one.
    if (cfg.dinosaur) {
      const tailMat = skinMatAlt
      let parent = this.hips
      const segments = 5
      const segLen = 0.3
      for (let i = 0; i < segments; i++) {
        const t = i / (segments - 1)
        const segRadius = 0.15 * (1 - t * 0.75)
        const segGroup = new THREE.Group()
        segGroup.position.set(0, i === 0 ? 0.32 : 0, i === 0 ? -0.22 : -segLen)
        segGroup.rotation.x = i === 0 ? 0.18 : -0.08
        const seg = track(new THREE.Mesh(new THREE.CylinderGeometry(segRadius, segRadius * 0.8, segLen, 6), tailMat), tailMat)
        seg.rotation.x = Math.PI / 2
        segGroup.add(seg)
        parent.add(segGroup)
        parent = segGroup
      }
    }

    this.hips.rotation.x = isCrawler ? 0.95 : 0.3 + Math.abs(this.postureOffset)
  }

  _buildLimb(radius, upperLen, lowerLen, mat, clawMat, jointMat, track, withClaws) {
    const shoulder = new THREE.Group()

    const upper = track(
      new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, upperLen, 6), mat),
      mat
    )
    upper.position.y = -upperLen / 2
    shoulder.add(upper)

    const elbow = new THREE.Group()
    elbow.position.y = -upperLen
    shoulder.add(elbow)

    const joint = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 6, 6), jointMat)
    elbow.add(joint)

    const lower = track(
      new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.6, lowerLen, 6), mat),
      mat
    )
    lower.position.y = -lowerLen / 2
    elbow.add(lower)

    if (withClaws) {
      const wetBloodMat = flatMaterial({ color: 0x5a0808, roughness: 0.25, metalness: 0.1 })
      for (let i = -1; i <= 1; i++) {
        const claw = track(new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), clawMat), clawMat)
        claw.position.set(i * 0.045, -lowerLen - 0.02, 0.02)
        claw.rotation.x = Math.PI
        elbow.add(claw)

        const bloodTip = track(new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 5), wetBloodMat), wetBloodMat)
        bloodTip.position.set(i * 0.045, -lowerLen - 0.09, 0.02)
        elbow.add(bloodTip)
      }
      const palmBlood = track(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.03), wetBloodMat), wetBloodMat)
      palmBlood.position.set(0, -lowerLen + 0.03, 0.03)
      elbow.add(palmBlood)
    }

    return { shoulder, elbow }
  }

  _buildHealthBar() {
    const canvas = document.createElement('canvas')
    canvas.width = HEALTH_BAR_W
    canvas.height = HEALTH_BAR_H
    this._barCanvas = canvas
    this._barCtx = canvas.getContext('2d')

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, fog: false })
    this._barSprite = new THREE.Sprite(material)
    this._barSprite.scale.set(0.8, 0.13, 1)
    this._barSprite.position.set(0, this.config.crawler ? HEAD_HEIGHT_LOCAL_CRAWLER : HEAD_HEIGHT_LOCAL, 0)
    this._barSprite.renderOrder = 10
    this._barSprite.visible = false
    this.group.add(this._barSprite)

    this._redrawHealthBar()
  }

  _redrawHealthBar() {
    const ctx = this._barCtx
    const fraction = Math.max(0, this.health / this.maxHealth)

    ctx.clearRect(0, 0, HEALTH_BAR_W, HEALTH_BAR_H)
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, HEALTH_BAR_W, HEALTH_BAR_H)

    // Colorblind mode: redgreen swaps the classic green/red pair (hardest to
    // tell apart for protanopia/deuteranopia) for blue/amber/orange.
    // blueyellow keeps green and red (tritanopes see both fine) but swaps
    // the middle amber stop for magenta, since amber sits right on the
    // blue-yellow confusion axis that redgreen's own blue/amber pair
    // depends on - amber wouldn't actually help a tritanopic player.
    ctx.fillStyle = accessibility.colorblindMode === 'redgreen'
      ? (fraction > 0.5 ? '#4a9ecf' : fraction > 0.25 ? '#e0b23f' : '#e0813f')
      : accessibility.colorblindMode === 'blueyellow'
      ? (fraction > 0.5 ? '#5fcf4a' : fraction > 0.25 ? '#e0459e' : '#d64545')
      : (fraction > 0.5 ? '#5fcf4a' : fraction > 0.25 ? '#e0b23f' : '#d64545')
    ctx.fillRect(1, 1, (HEALTH_BAR_W - 2) * fraction, HEALTH_BAR_H - 2)

    this._barSprite.material.map.needsUpdate = true
  }

  update(dt, elapsed, playerPos, onAttack, onSpit, onAmbushTrigger, onExplode, playerCrouching = false, onScream = null, colliders = null, solidMeshes = null, allZombies = null, onTrail = null, playerForwardX = null, playerForwardZ = null, playerProne = false, playerInSmoke = false) {
    // Cached so onHit() - called from outside update(), with no player
    // position of its own - can still bias the hit-reaction knockback away
    // from roughly where the player is, without threading a direction
    // through every one of onHit's call sites across WeaponSystem/
    // ZombieManager/Game.
    this._lastPlayerX = playerPos.x
    this._lastPlayerZ = playerPos.z
    this._tickIgnite(dt)
    // Regenerator - heals back up over time, same "one flag, checked once a
    // frame regardless of movement branch" shape ignite already uses. Fire
    // suppresses it entirely rather than just outracing it, so an
    // Incendiary/Flamethrower hit is a real, readable counter.
    if (this.config.regenerates && this.state === 'alive' && !this.igniteUntil) {
      this.health = Math.min(this.maxHealth, this.health + this.config.regenPerSec * dt)
      this._redrawHealthBar()
    }
    if (this.state === 'dormant') {
      const dist = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z)
      const waited = performance.now() - this.dormantSince
      const triggerRange = playerCrouching ? AMBUSH_TRIGGER_RANGE_CROUCH : AMBUSH_TRIGGER_RANGE
      if (dist < triggerRange || waited > AMBUSH_MAX_WAIT_MS) {
        this.state = 'popping'
        this.popStartedAt = performance.now()
        this.burstUntil = performance.now() + this.popDurationMs + this.burstDurationMs
        if (onAmbushTrigger) onAmbushTrigger(this.group.position.x, this.group.position.z)
      }
      return
    }

    if (this.state === 'popping') {
      const progress = Math.min(1, (performance.now() - this.popStartedAt) / this.popDurationMs)
      // this.baseScale, not this.config.scale - the latter is the raw
      // per-type value and skips the GLB correction/elite multiplier baked
      // into this.baseScale at construction (see the constructor), so a
      // GLB zombie popping from ambush would balloon to ~4.2x too tall
      // and get stuck there once state flips to 'alive'.
      const baseScale = this.baseScale
      this.group.scale.y = THREE.MathUtils.lerp(baseScale * 0.35, baseScale, progress)
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = THREE.MathUtils.lerp(0.25, 2.4, progress)
      if (progress >= 1) {
        this.group.scale.y = baseScale
        this.state = 'alive'
      }
      return
    }

    if (this.pendingExplosion) {
      this.pendingExplosion = false
      this._explode(playerPos, onAttack, onExplode)
      return
    }

    if (this.state === 'exploding') {
      if (performance.now() - this.explodeStartedAt > EXPLODE_LINGER_MS) this.state = 'dead'
      return
    }

    if (this.state === 'dying') {
      const progress = Math.min(1, (performance.now() - this.dieStartedAt) / DEATH_ANIM_MS)
      if (this.usingGLB) {
        // update()'s state-machine early-returns skip the normal
        // _animate()/_animateGLB() call entirely while dying, so the death
        // clip has to be driven from right here instead.
        this._playGlbAction('death', false)
        this.mixer.update(dt)
      } else {
        this.hips.rotation.x = 0.16 + progress * 1.3
      }
      this.group.position.y = -progress * 0.4 * this.config.scale
      this.group.rotation.z = (this.fallLeanZ || 0) * progress
      this.group.position.x += (this.fallDriftX || 0) * progress * dt
      this.group.position.z += (this.fallDriftZ || 0) * progress * dt
      this._barSprite.visible = false
      if (progress >= 1) this.state = 'dead'
      return
    }
    if (this.state === 'dead') return

    if (this.isClimbing) {
      this._updateClimb(dt, elapsed)
      return
    }

    this._updateHitReact()

    const staggered = performance.now() < this.staggerUntil
    const dx = playerPos.x - this.group.position.x
    const dz = playerPos.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    let nx = dist > 0.0001 ? dx / dist : 0
    let nz = dist > 0.0001 ? dz / dist : 1

    // "Last one flees" (see Game.js's _checkRoundModeSpecialEvents) -
    // inverts the base toward-player direction to away-from-player right
    // here, before separation/flanking/pack logic below applies on top of
    // it same as always, rather than needing its own parallel movement path.
    if (this.fleeing) {
      nx = -nx
      nz = -nz
    }

    this._updateAwareness(playerPos, solidMeshes, dist, playerProne, playerCrouching, playerInSmoke)

    if (!this.aware) {
      // Ambient wander - hasn't noticed the player yet, so no pack
      // separation/flanking/attack dispatch at all, just a slow aimless
      // drift (see _updateWander). Still falls through to the shared
      // stealthy-opacity/_animate tail below like any other alive zombie.
      this._updateWander(dt, colliders)
      this.effectiveSpeed = this.speed * WANDER_SPEED_MULT
      this.isPackAlpha = false
    } else {
      if (allZombies) {
        let sepX = 0
        let sepZ = 0
        let packCount = 0
        let lowestNearbyId = this.id
        for (const other of allZombies) {
          if (other === this) continue
          if (other.state === 'dead') {
            // Corpse avoidance - a much lighter push than live-zombie
            // separation below, just enough to route around a fresh body
            // instead of walking straight through it.
            const cdx = this.group.position.x - other.group.position.x
            const cdz = this.group.position.z - other.group.position.z
            const cdist = Math.hypot(cdx, cdz)
            if (cdist > 0.0001 && cdist < CORPSE_AVOID_RADIUS) {
              const push = (CORPSE_AVOID_RADIUS - cdist) / CORPSE_AVOID_RADIUS
              sepX += (cdx / cdist) * push * CORPSE_AVOID_WEIGHT
              sepZ += (cdz / cdist) * push * CORPSE_AVOID_WEIGHT
            }
            continue
          }
          if (other.state !== 'alive') continue
          const odx = this.group.position.x - other.group.position.x
          const odz = this.group.position.z - other.group.position.z
          const odist = Math.hypot(odx, odz)
          if (odist < FLANK_RADIUS) {
            packCount++
            // Pack alpha (see ALPHA_SPEED_MULT) - the lowest-id zombie
            // within range of this pack, recomputed fresh every frame so
            // it naturally hands off if the current alpha dies.
            if (other.id < lowestNearbyId) lowestNearbyId = other.id
          }
          if (odist <= 0.0001) {
            // Exactly coincident (e.g. two zombies summoned on the same
            // spot) - there's no defined "away" direction, so nudge apart
            // using this zombie's own id as a stable pseudo-angle. Spread by
            // the golden angle (~137.5°) rather than id directly, since
            // summon bursts hand out consecutive ids and consecutive ids
            // would otherwise land within a degree of each other and drift
            // off together as a clump instead of separating.
            const angle = (this.id * 137.5 * (Math.PI / 180)) % (Math.PI * 2)
            sepX += Math.cos(angle)
            sepZ += Math.sin(angle)
          } else if (odist < SEPARATION_RADIUS) {
            const push = (SEPARATION_RADIUS - odist) / SEPARATION_RADIUS
            sepX += (odx / odist) * push
            sepZ += (odz / odist) * push
          }
        }
        this.isPackAlpha = packCount >= FLANK_MIN_PACK_SIZE && lowestNearbyId === this.id
        const preSepNx = nx
        const preSepNz = nz
        if (sepX !== 0 || sepZ !== 0) {
          nx += sepX * SEPARATION_WEIGHT
          nz += sepZ * SEPARATION_WEIGHT
          const len = Math.hypot(nx, nz)
          if (len > 0.0001) {
            nx /= len
            nz /= len
          }
        }
        // Chokepoint congestion (see CHOKEPOINT_MIN_SPEED_MULT) - how much
        // the separation push above deflected this zombie off its direct
        // line to the player. A doorway packed tight enough to jostle
        // everyone sideways reads as the group easing off and queueing
        // through instead of a mosh pit all shoving at full speed.
        this._congestion = Math.max(0, Math.min(1, 1 - (preSepNx * nx + preSepNz * nz)))

        // Pack flanking - only kicks in with company nearby, and fades out on
        // final approach so the group still commits to melee range instead of
        // circling. Angle is derived from this.id (same golden-angle trick as
        // the coincident-spawn separation above) so each zombie in a pack
        // consistently picks its own side rather than jittering frame to frame.
        if (packCount >= FLANK_MIN_PACK_SIZE && dist > FLANK_FADE_DIST) {
          const idAngle = (this.id * 137.5 * (Math.PI / 180)) % (Math.PI * 2)
          const side = Math.sin(idAngle) >= 0 ? 1 : -1
          // Blind-spot bias (see FLANK_FRONT_STRENGTH_MULT) - a zombie the
          // player is currently facing gets pushed harder to the side to
          // actually reach a blind spot; one already roughly behind/beside
          // the player is let through more directly instead of wasting the
          // detour. Falls back to a neutral 1x when no facing was passed in.
          let flankStrength = 1
          if (playerForwardX !== null) {
            const toZombieX = -nx
            const toZombieZ = -nz
            const facingDot = toZombieX * playerForwardX + toZombieZ * playerForwardZ
            flankStrength = facingDot > 0 ? FLANK_FRONT_STRENGTH_MULT : FLANK_BLINDSPOT_STRENGTH_MULT
          }
          const flankFade = Math.min(1, (dist - FLANK_FADE_DIST) / FLANK_FADE_DIST)
          const flankAngle = side * FLANK_MAX_ANGLE * flankFade * flankStrength
          const cosA = Math.cos(flankAngle)
          const sinA = Math.sin(flankAngle)
          const rx = nx * cosA - nz * sinA
          const rz = nx * sinA + nz * cosA
          nx = rx
          nz = rz
        }
      } else {
        this.isPackAlpha = false
        this._congestion = 0
      }

      const burstMult = performance.now() < this.burstUntil ? AMBUSH_BURST_SPEED_MULT : 1
      // Boss phase multiplier takes priority over the regular scream-
      // triggered one when both could apply (a boss is never also hit by
      // a screamer's own enrage() call in practice, but this keeps the
      // precedence explicit either way).
      const bossPhaseMult = this.enragePhase >= 2 ? BOSS_ENRAGE_PHASE2_SPEED_MULT
        : this.enragePhase >= 1 ? BOSS_ENRAGE_PHASE1_SPEED_MULT : null
      const enrageMult = performance.now() < this.enragedUntil
        ? (bossPhaseMult ?? this.config.screamEnrageMult ?? DEFAULT_ENRAGE_MULT)
        : 1
      const weakenMult = performance.now() < this.weakenedUntil ? DEFAULT_WEAKEN_MULT : 1
      const hivemindMult = performance.now() < this.hivemindBuffUntil ? HIVEMIND_SPEED_MULT : 1
      const alphaMult = this.isPackAlpha ? ALPHA_SPEED_MULT : 1
      // "Last one flees" (see Game.js's _checkRoundModeSpecialEvents) -
      // competes in the same Math.max boost group as burst/enrage/alpha
      // above rather than its own separate multiplier slot.
      const fleeMult = this.fleeing ? FLEE_SPEED_MULT : 1
      const chokepointMult = THREE.MathUtils.lerp(1, CHOKEPOINT_MIN_SPEED_MULT, this._congestion)
      this.isBerserk = this.health > 0 && this.health / this.maxHealth <= BERSERK_HEALTH_FRACTION
      const berserkMult = this.isBerserk ? BERSERK_SPEED_MULT : 1
      const crippledMult = this.isCrippled ? CRIPPLED_SPEED_MULT : 1
      // Chase fatigue (batch 7 feature) - see CHASE_FATIGUE_START_MS's own
      // comment for the exemptions.
      let fatigueMult = 1
      if (!this.isBoss && !this.isWandering && !this.isAmbush && this.awareSince > 0) {
        const chaseMs = performance.now() - this.awareSince
        if (chaseMs > CHASE_FATIGUE_START_MS) {
          const frac = Math.min(1, (chaseMs - CHASE_FATIGUE_START_MS) / CHASE_FATIGUE_RAMP_MS)
          fatigueMult = THREE.MathUtils.lerp(1, CHASE_FATIGUE_MIN_MULT, frac)
        }
      }
      this.effectiveSpeed = this.speed * Math.max(burstMult, enrageMult, berserkMult, hivemindMult, alphaMult, fleeMult) * weakenMult * chokepointMult * crippledMult * fatigueMult
      // Cryo Rounds attachment (batch 10 feature) - a full stop, applied
      // after every other multiplier above rather than folded into the
      // Math.max boost group or the other slow multipliers, since frozen
      // should always win regardless of what else is active (burst/enrage
      // included) rather than just being one more factor in the mix.
      if (this.frozenUntil && performance.now() < this.frozenUntil) this.effectiveSpeed = 0

      // Excess elevation beyond a normal standing eye height (e.g. the player
      // is up on a car roof) - added into the melee engagement check below
      // so a zombie stuck at the base can't melee through it. The exploder's
      // blast radius reaching a bit upward is left as-is (a real explosion
      // would); ranged spit attacks get their own line-of-sight check instead
      // (see _updateRanged) since a wall blocks a thrown projectile regardless
      // of height.
      const excessElevation = Math.max(0, playerPos.y - TYPICAL_EYE_HEIGHT - this.group.position.y)

      if (!staggered) {
        if (this.config.ranged) this._updateRanged(dt, dist, nx, nz, playerPos, onSpit, colliders, solidMeshes)
        else if (this.config.explodes) this._updateExploder(dt, dist, nx, nz, playerPos, onAttack, onExplode, colliders)
        else this._updateMelee(dt, Math.hypot(dist, excessElevation), nx, nz, onAttack, colliders, solidMeshes, playerPos)

        if (this.config.screams && onScream && performance.now() >= this.screamCooldownUntil) {
          this.screamCooldownUntil = performance.now() + this.config.screamCooldown * 1000
          this.screamPulseUntil = performance.now() + 500
          onScream(this.group.position.x, this.group.position.z, this.config.screamRadius, this.config.screamEnrageMs)
        }

        // Acid Trail (see leavesTrail) - same cooldown-gated callback shape as
        // screams/onScream above, just dropping a hazard puddle instead of
        // buffing nearby zombies.
        if (this.config.leavesTrail && onTrail && performance.now() >= this.trailCooldownUntil) {
          this.trailCooldownUntil = performance.now() + this.config.trailIntervalMs
          onTrail(this.group.position.x, this.group.position.z)
        }
      }
    }

    // Stalker (see stealthy) - ramps from mostly-transparent to fully
    // visible as the player closes to within revealRadius, regardless of
    // the staggered/attack branch above so it doesn't suddenly reappear
    // mid-hitstun.
    if (this.config.stealthy) {
      const targetOpacity = THREE.MathUtils.clamp(1 - dist / this.config.revealRadius, 0.12, 1)
      for (const mat of this.materials) {
        mat.transparent = true
        mat.opacity = THREE.MathUtils.damp(mat.opacity ?? targetOpacity, targetOpacity, 6, dt)
      }
    }

    if (this._shouldFullyAnimate(dist, dx, dz, playerPos, solidMeshes, playerForwardX, playerForwardZ)) {
      this._animate(dt, elapsed)
    }
  }

  // Called by ZombieManager when another zombie's scream reaches this one.
  // Frees this zombie's own GPU-side material resources - call right
  // before/after removing it from the scene on death. Materials only,
  // deliberately never geometry: GLB zombies' geometry is a shared
  // reference back to the cached source model (see _buildBodyFromGLB's
  // own note on why every clone shares the same buffers, not a copy),
  // so disposing it here would corrupt every OTHER zombie - alive or
  // not-yet-spawned - still using that same cached model. Materials,
  // unlike geometry, ARE created fresh per instance (cloned or built new
  // in _buildBodyFromGLB/_buildBodyProcedural), so those are safe and
  // actually the real leak: `scene.remove()` only stops something from
  // being rendered, it does NOT free its WebGL buffers - only an explicit
  // `.dispose()` call does that, and until now nothing ever called it for
  // a dead zombie, so every kill for the entire life of a session was
  // leaking its own material/shader-program GPU resources permanently.
  // Drives this zombie purely from network state instead of the normal
  // AI update() loop - only ever called for isNetworkDriven instances
  // (a guest's rendering of a zombie the host is really simulating).
  // Never touches pathfinding/aggro/attack-decision code at all - just
  // position, health bar, and the same walk/idle/death animation clips
  // the AI-driven path already uses. Called once per sync response
  // (Game.js's _renderSharedZombies), not every render frame - same
  // precedent as MinecraftPlayerBody's remote-player rendering, which
  // updates on the same cadence.
  applyNetworkState(x, z, rotY, health, maxHealth, state, localPlayerX = null, localPlayerZ = null, screaming = false) {
    const moved = Math.hypot(x - this.group.position.x, z - this.group.position.z)
    this.group.position.set(x, 0, z)
    this.group.rotation.y = rotY
    this.health = health
    this.maxHealth = maxHealth
    if (state === 'popping' && this.state === 'dormant') this._netPopStartedAt = performance.now()
    if (state !== this.state) {
      this.state = state
      if (state === 'dying' || state === 'dead') this._playGlbAction('death', false)
    }
    // Burrower (and any other shared type that happened to roll an ambush
    // spawn - see ZombieManager._spawnRandom's ambushChance, which applies
    // to every non-ranged type, not just burrower) - mirrors update()'s
    // own dormant->popping scale+eye-glow lerp, which never runs for a
    // network-driven instance since update() itself never runs for one.
    // Only Y scale changes - X/Z stay at the construction-time
    // baseScale*glbWidthMult, same as the AI-driven version.
    if (state === 'dormant') {
      this.group.scale.y = this.baseScale * 0.35
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = 0.25
    } else if (state === 'popping') {
      const progress = Math.min(1, (performance.now() - this._netPopStartedAt) / this.popDurationMs)
      this.group.scale.y = THREE.MathUtils.lerp(this.baseScale * 0.35, this.baseScale, progress)
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = THREE.MathUtils.lerp(0.25, 2.4, progress)
    } else if (state === 'alive') {
      this.group.scale.y = this.baseScale
    }
    if (state === 'alive' || state === 'popping') {
      this._barSprite.visible = true
      this._redrawHealthBar()
      this._playGlbAction(moved > 0.01 ? 'walk' : 'idle', true)
    }
    // Stalker - same distance-to-opacity fade update() already does for an
    // AI-driven instance (see this.config.stealthy in update()), computed
    // against the LOCAL viewer's own position (passed in by Game.js's
    // _renderSharedZombies) rather than the host's, so it fades in
    // correctly for whichever player is actually looking at it.
    if (this.config.stealthy && localPlayerX !== null && localPlayerZ !== null) {
      const dist = Math.hypot(localPlayerX - x, localPlayerZ - z)
      const targetOpacity = THREE.MathUtils.clamp(1 - dist / this.config.revealRadius, 0.12, 1)
      for (const mat of this.materials) {
        mat.transparent = true
        mat.opacity = targetOpacity
      }
    }
    // Screamer's throat-glow pulse - cosmetic only (the real effect, waking
    // nearby dormant zombies, is entirely host-side already and needs no
    // network changes at all). Simplified to a flat on/off glow rather
    // than replicating the sine-wave scale pulse _animate() does, since
    // this only updates a few times a second (sync cadence) anyway.
    if (this.throatMat) {
      if (screaming && !this._netWasScreaming) this._netScreamPulseUntil = performance.now() + 500
      this._netWasScreaming = screaming
      this.throatMat.emissiveIntensity = performance.now() < this._netScreamPulseUntil ? 2.4 : 0.9
    }
    const now = performance.now()
    const dt = Math.min(0.2, (now - (this._lastNetworkUpdateAt || now)) / 1000)
    this._lastNetworkUpdateAt = now
    if (this.mixer) this.mixer.update(dt)
  }

  dispose() {
    for (const mat of this.materials) mat.dispose()
    if (this.eyeMaterials) {
      for (const mat of this.eyeMaterials) mat.dispose()
    }
  }

  forceWake() {
    if (this.state !== 'dormant') return
    this.state = 'popping'
    this.popStartedAt = performance.now()
    this.burstUntil = performance.now() + this.popDurationMs + this.burstDurationMs
  }

  enrage(durationMs) {
    if (this.state !== 'alive') return
    this.enragedUntil = Math.max(this.enragedUntil, performance.now() + durationMs)
  }

  // Called from onHit whenever this boss takes damage - checks its OWN
  // health against the phase thresholds, rather than needing an external
  // trigger the way the temporary scream-triggered enrage() above does.
  // Permanent once reached (enragedUntil = Infinity), and only ever
  // escalates - taking more damage can't un-enrage a boss back down.
  _checkEnragePhase() {
    if (this.state !== 'alive' || this.maxHealth <= 0) return
    const frac = this.health / this.maxHealth
    if (frac <= BOSS_ENRAGE_PHASE2_HEALTH_FRACTION && this.enragePhase < 2) {
      this.enragePhase = 2
      this.enragedUntil = Infinity
    } else if (frac <= BOSS_ENRAGE_PHASE1_HEALTH_FRACTION && this.enragePhase < 1) {
      this.enragePhase = 1
      this.enragedUntil = Infinity
    }
  }

  // Shared by both attack-cooldown assignment sites below - an enraged
  // boss doesn't just move faster, it swings again sooner too.
  get bossPhaseCooldownMult() {
    if (this.enragePhase >= 2) return BOSS_ENRAGE_PHASE2_COOLDOWN_MULT
    if (this.enragePhase >= 1) return BOSS_ENRAGE_PHASE1_COOLDOWN_MULT
    return 1
  }

  // UV weapon effect: slows movement (see effectiveSpeed above) and softens
  // its own damage output while lit.
  weaken(durationMs) {
    if (this.state !== 'alive') return
    this.weakenedUntil = Math.max(this.weakenedUntil, performance.now() + durationMs)
  }

  // Called once per leg-shot hit (see WeaponSystem's isLegShot handling).
  // Bosses are exempt - permanently immobilizing a boss after 2 shots
  // would trivialize what's meant to be a real fight.
  onLegShot() {
    if (this.state !== 'alive' || this.isCrippled || this.isBoss) return
    this.legHitCount++
    if (this.legHitCount >= CRIPPLE_LEG_HITS) this.isCrippled = true
  }

  // EMP grenade (see ZombieManager's spawnEmpThrow) - reuses the same
  // staggerUntil freeze onHit already gives a brief 200ms hit-reaction for,
  // just held open much longer, so a stunned zombie neither moves nor
  // attacks (see the `staggered` check in update()) without needing a
  // separate state machine for it.
  stun(durationMs) {
    if (this.state !== 'alive') return
    this.staggerUntil = Math.max(this.staggerUntil, performance.now() + durationMs)
  }

  // Flamethrower burn (see WeaponSystem's w.ignites) - refreshes the
  // duration on every re-hit rather than stacking multiple independent
  // burns, same "one active effect, timer just extends" idea weaken/stun
  // above already use.
  ignite(durationMs, dps) {
    if (this.state !== 'alive') return
    this.igniteUntil = performance.now() + durationMs
    this.igniteDps = dps
  }

  // Acid/Corrosive Rounds attachment (see WeaponSystem's w.corrodes) -
  // a damage-TAKEN multiplier rather than a damage-over-time tick, so it
  // reads as "softened up" rather than duplicating ignite's burn effect.
  // Checked in onHit alongside the existing config.fragile multiplier.
  corrode(durationMs) {
    if (this.state !== 'alive') return
    this.corrodedUntil = Math.max(this.corrodedUntil || 0, performance.now() + durationMs)
  }

  // Cryo Rounds attachment (batch 10 feature, see WeaponSystem's w.freezes) -
  // a genuine full immobilize (effectiveSpeed forced to 0 - see that field's
  // own comment), distinct from weaken() (a partial slow) and stun() (a
  // brief ~200ms-1.5s hit-reaction freeze) by both duration and completeness.
  freeze(durationMs) {
    if (this.state !== 'alive') return
    this.frozenUntil = Math.max(this.frozenUntil || 0, performance.now() + durationMs)
  }

  // Called every frame from update() below - applies burn damage on a
  // fixed tick rather than every single frame, so it reads as distinct
  // "bursts" of damage rather than one smooth drain.
  _tickIgnite(dt) {
    if (!this.igniteUntil || this.state !== 'alive') return
    const now = performance.now()
    if (now > this.igniteUntil) {
      this.igniteUntil = 0
      return
    }
    this._igniteAccum = (this._igniteAccum || 0) + dt
    if (this._igniteAccum >= 0.5) {
      this._igniteAccum = 0
      this.onHit(this.igniteDps * 0.5)
    }
  }

  _updateMelee(dt, dist, nx, nz, onAttack, colliders, solidMeshes, playerPos) {
    if (this.isBoss && this._updateBossSpecial(dist, playerPos, onAttack) === 'busy') return

    // Leaper - closes most of the gap in one lunge instead of the normal
    // per-frame walk speed, on its own separate cooldown so it can't chain
    // lunges back to back.
    if (this.config.leaps && dist <= this.config.leapRange && dist > this.config.meleeRange &&
        this._hasLineOfSight(playerPos, solidMeshes) && performance.now() >= this.leapCooldownUntil) {
      this.leapCooldownUntil = performance.now() + this.config.leapCooldown * 1000
      this._tryMove(nx * (dist - this.config.meleeRange * 0.7), nz * (dist - this.config.meleeRange * 0.7), colliders)
      this.group.rotation.y = Math.atan2(nx, nz)
      return
    }

    // In range but no line of sight (a wall/floor between us and the
    // player) means "can't actually reach them" just as much as being too
    // far away - keep approaching instead of freezing into an attack that
    // should be impossible through solid geometry.
    if (dist > this.config.meleeRange || !this._hasLineOfSight(playerPos, solidMeshes)) {
      this._tryMoveOrClimb(nx, nz, dt, colliders)
      this.group.rotation.y = Math.atan2(nx, nz)
    } else if (performance.now() >= this.attackCooldownUntil) {
      this.attackCooldownUntil = performance.now() + this.config.attackCooldown * 1000 * this.bossPhaseCooldownMult
      this.attackAnimUntil = performance.now() + 260
      const weakened = performance.now() < this.weakenedUntil
      const damage = (this.config.damageMin + Math.random() * (this.config.damageMax - this.config.damageMin)) *
        (weakened ? DEFAULT_WEAKEN_MULT : 1) * (this.isElite ? ELITE_DAMAGE_MULT : 1) * (this.isBerserk ? BERSERK_DAMAGE_MULT : 1)
      if (onAttack) onAttack(damage)
      // Vampire - heals off a fraction of the damage it just landed.
      if (this.config.lifesteal) {
        this.health = Math.min(this.maxHealth, this.health + damage * this.config.lifestealFraction)
        this._redrawHealthBar()
      }
    }
  }

  // Boss-only wind-up + AoE slam, layered on top of the normal melee
  // swings above. Returns 'busy' while telegraphing/unleashing (freezes
  // movement and the regular attack for that frame - see _updateMelee),
  // 'idle' otherwise so normal melee behavior proceeds unaffected.
  _updateBossSpecial(dist, playerPos, onAttack) {
    const now = performance.now()

    if (this.specialTelegraphUntil > now) return 'busy'

    if (this._specialArmed) {
      this._specialArmed = false
      const distToPlayer = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z)
      if (distToPlayer <= BOSS_SPECIAL_RANGE) {
        const falloff = 1 - distToPlayer / BOSS_SPECIAL_RANGE
        const damage = (this.config.damageMin + this.config.damageMax) / 2 * BOSS_SPECIAL_DAMAGE_MULT * falloff * (this.isBerserk ? BERSERK_DAMAGE_MULT : 1)
        if (onAttack) onAttack(damage)
      }
      this.specialCooldownUntil = now + BOSS_SPECIAL_COOLDOWN_MS
      this.attackCooldownUntil = now + this.config.attackCooldown * 1000 * this.bossPhaseCooldownMult
      return 'busy'
    }

    if (dist <= BOSS_SPECIAL_RANGE * 1.3 && now >= this.specialCooldownUntil) {
      this.specialTelegraphUntil = now + BOSS_SPECIAL_TELEGRAPH_MS
      this._specialArmed = true
      return 'busy'
    }

    return 'idle'
  }

  _updateExploder(dt, dist, nx, nz, playerPos, onAttack, onExplode, colliders) {
    if (dist > this.config.meleeRange) {
      this._tryMoveOrClimb(nx, nz, dt, colliders)
      this.group.rotation.y = Math.atan2(nx, nz)
    } else {
      this._explode(playerPos, onAttack, onExplode)
    }
  }

  _explode(playerPos, onAttack, onExplode) {
    if (this.state === 'dead' || this.state === 'exploding') return

    const dist = Math.hypot(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z)
    if (dist <= this.config.explodeRadius) {
      const falloff = 1 - dist / this.config.explodeRadius
      const damage = (this.config.explodeDamageMin + (this.config.explodeDamageMax - this.config.explodeDamageMin) * falloff) *
        (this.isElite ? ELITE_DAMAGE_MULT : 1)
      if (onAttack) onAttack(damage)
    }
    if (onExplode) onExplode(this.group.position.x, this.group.position.z)

    this.state = 'exploding'
    this.explodeStartedAt = performance.now()
    this._barSprite.visible = false
    this.group.visible = false
  }

  _updateRanged(dt, dist, nx, nz, playerPos, onSpit, colliders, solidMeshes) {
    this.group.rotation.y = Math.atan2(nx, nz)

    // No line of sight (a wall/floor blocking the throw) counts the same as
    // being out of range - reposition instead of lobbing a projectile
    // through solid geometry.
    if (dist < this.config.retreatRange) {
      this._tryMove(-nx * this.effectiveSpeed * dt, -nz * this.effectiveSpeed * dt, colliders)
    } else if (dist > this.config.engageRange || !this._hasLineOfSight(playerPos, solidMeshes)) {
      this._tryMoveOrClimb(nx, nz, dt, colliders)
    } else if (performance.now() >= this.attackCooldownUntil) {
      this.attackCooldownUntil = performance.now() + this.config.spitCooldown * 1000
      this.attackAnimUntil = performance.now() + 300
      const weakened = performance.now() < this.weakenedUntil
      const damage = (this.config.damageMin + Math.random() * (this.config.damageMax - this.config.damageMin)) *
        (weakened ? DEFAULT_WEAKEN_MULT : 1) * (this.isElite ? ELITE_DAMAGE_MULT : 1)
      if (onSpit) {
        const origin = this.group.position.clone()
        origin.y += 1.3 * this.config.scale
        onSpit(origin, playerPos.clone(), damage, this.config.spitTravelSpeed)
      }
    } else {
      // Ranged strafe - sidesteps while waiting out its own attack cooldown
      // instead of just standing still in the open, using a per-instance
      // side (stable per zombie, same id-based trick separation/flanking
      // already use) so a pack of spitters doesn't all strafe in lockstep.
      const side = this.id % 2 === 0 ? 1 : -1
      const strafeX = -nz * side
      const strafeZ = nx * side
      this._tryMove(strafeX * this.effectiveSpeed * RANGED_STRAFE_SPEED_MULT * dt, strafeZ * this.effectiveSpeed * RANGED_STRAFE_SPEED_MULT * dt, colliders)
    }
  }

  // Per-axis move against world colliders (same list PlayerController uses),
  // mirroring its own _tryMove - resolving X and Z separately lets a zombie
  // slide along a wall/car it's approaching at an angle instead of just
  // stopping dead, without any real pathfinding. No colliders passed (e.g.
  // a caller that hasn't wired them up) falls back to unblocked movement.
  _tryMove(dx, dz, colliders) {
    if (!colliders || colliders.length === 0) {
      this.group.position.x += dx
      this.group.position.z += dz
      return
    }
    const halfW = 0.32 * this.config.scale
    const height = 1.8 * this.config.scale

    // Zombie spawn points aren't checked against building/wall footprints
    // (see ZombieManager._spawnRandom/_spawnBoss) - harmless before this
    // collision was added, since they'd just clip through unnoticed. Now
    // that movement can be blocked, a zombie that spawned embedded in a
    // wall needs to be able to walk itself free rather than softlocking in
    // place forever, so collision is only enforced once the zombie is
    // already clear of everything.
    this._moveBox.min.set(this.group.position.x - halfW, 0, this.group.position.z - halfW)
    this._moveBox.max.set(this.group.position.x + halfW, height, this.group.position.z + halfW)
    if (colliders.some((c) => this._moveBox.intersectsBox(c))) {
      this.group.position.x += dx
      this.group.position.z += dz
      return
    }

    if (dx !== 0) {
      const nx = this.group.position.x + dx
      this._moveBox.min.set(nx - halfW, 0, this.group.position.z - halfW)
      this._moveBox.max.set(nx + halfW, height, this.group.position.z + halfW)
      if (!colliders.some((c) => this._moveBox.intersectsBox(c))) this.group.position.x = nx
    }
    if (dz !== 0) {
      const nz = this.group.position.z + dz
      this._moveBox.min.set(this.group.position.x - halfW, 0, nz - halfW)
      this._moveBox.max.set(this.group.position.x + halfW, height, nz + halfW)
      if (!colliders.some((c) => this._moveBox.intersectsBox(c))) this.group.position.z = nz
    }
  }

  // Wraps _tryMove for the chase-toward-player callers (melee/ranged/
  // exploder approach) - falls through to the normal move, and only
  // probes for a climbable obstacle if that move made little/no progress
  // (cheap: most zombies most of the time ARE moving freely on open
  // streets, so the extra probe cost is paid only by the ones that are
  // actually stuck, not every zombie every frame).
  _tryMoveOrClimb(nx, nz, dt, colliders) {
    const beforeX = this.group.position.x
    const beforeZ = this.group.position.z
    const stepX = nx * this.effectiveSpeed * dt
    const stepZ = nz * this.effectiveSpeed * dt
    this._tryMove(stepX, stepZ, colliders)
    const intendedDist = Math.hypot(stepX, stepZ)
    if (intendedDist < 0.0001) return
    const movedDist = Math.hypot(this.group.position.x - beforeX, this.group.position.z - beforeZ)
    if (movedDist >= intendedDist * 0.3) return
    if (this.config.crawler || this.config.dinosaur) return
    this._tryClimb(nx, nz, colliders)
  }

  // Probes for a climbable obstacle directly ahead (same height-band idea
  // as PlayerController's own mantle probe: grounded near the zombie's
  // own feet, height within ZOMBIE_CLIMB_MIN/MAX) and starts the scripted
  // arc over it if one's found. No colliders/none found -> normal
  // _tryMove's own blocked/stuck behavior stands (sliding along the
  // obstacle, same as before this existed).
  _tryClimb(nx, nz, colliders) {
    if (this.isClimbing || !colliders || colliders.length === 0) return false
    const feetY = this.group.position.y
    const probeDist = 0.5 * this.config.scale
    const probeX = this.group.position.x + nx * probeDist
    const probeZ = this.group.position.z + nz * probeDist

    let obstacleTop = null
    for (const c of colliders) {
      if (probeX < c.min.x || probeX > c.max.x || probeZ < c.min.z || probeZ > c.max.z) continue
      if (c.min.y > feetY + 0.4) continue
      const height = c.max.y - feetY
      if (height < ZOMBIE_CLIMB_MIN_HEIGHT || height > ZOMBIE_CLIMB_MAX_HEIGHT) continue
      if (obstacleTop === null || c.max.y > obstacleTop) obstacleTop = c.max.y
    }
    if (obstacleTop === null) return false

    const landDist = ZOMBIE_CLIMB_LAND_DIST * this.config.scale
    this._climbStartX = this.group.position.x
    this._climbStartZ = this.group.position.z
    this._climbPeakY = obstacleTop + 0.1 * this.config.scale
    this._climbTargetX = this.group.position.x + nx * landDist
    this._climbTargetZ = this.group.position.z + nz * landDist
    this.group.rotation.y = Math.atan2(nx, nz)
    this.isClimbing = true
    this._climbStartedAt = performance.now()
    return true
  }

  // Scripted rise-and-fall arc, always returning to the SAME y it started
  // at (0, same as every alive zombie always is - see the constants'
  // own comment on why this doesn't land ON TOP of the obstacle to stay
  // there). Mirrors PlayerController's own isMantling branch shape - an
  // early return in update() bypassing all normal AI/movement/attack
  // logic for the duration, just driving position and the walk
  // animation directly instead.
  _updateClimb(dt, elapsed) {
    const frac = Math.min(1, (performance.now() - this._climbStartedAt) / ZOMBIE_CLIMB_DURATION_MS)
    this.group.position.x = THREE.MathUtils.lerp(this._climbStartX, this._climbTargetX, frac)
    this.group.position.z = THREE.MathUtils.lerp(this._climbStartZ, this._climbTargetZ, frac)
    // Sine arc (0 at start/end, 1 at the midpoint) - same "good enough,
    // not a rigid simulation" shape the wrecking pendulum's own swing
    // already uses, not a real per-frame climb.
    this.group.position.y = Math.sin(frac * Math.PI) * this._climbPeakY
    if (this.usingGLB) {
      this._playGlbAction('walk', true)
      this.mixer.update(dt)
    }
    if (frac >= 1) {
      this.isClimbing = false
      this.group.position.y = 0
    }
  }

  // Blocked line of sight (a wall/floor between here and the player) means
  // melee can't land even if the nominal 3D distance says "in range" - see
  // _updateMelee. No solidMeshes passed skips the check (treated as clear).
  _hasLineOfSight(playerPos, solidMeshes) {
    if (!solidMeshes || solidMeshes.length === 0) return true
    // See LOS_CACHE_MS's own comment - this is the actual real-raycast
    // throttle, called every frame from _updateMelee/_updateRanged whenever
    // a zombie is close enough to matter (exactly the horde-fight moment
    // where many zombies doing this at once adds up).
    const now = performance.now()
    if (now < this._losCacheUntil) return this._losCachedResult
    // Shared per-frame budget (see LOS_RAYCAST_BUDGET_PER_FRAME) - once
    // exhausted, every zombie whose cache expires this frame just keeps
    // its last known result for one more frame instead of all raycasting
    // at once. _losCacheUntil deliberately isn't extended here, so this
    // zombie tries again (and likely wins the budget) next frame.
    if (_losRaycastBudgetThisFrame <= 0) return this._losCachedResult
    _losRaycastBudgetThisFrame -= 1
    this._losCacheUntil = now + LOS_CACHE_MS

    this._losOrigin.copy(this.group.position)
    this._losOrigin.y += 1.0 * this.config.scale
    this._losDir.copy(playerPos).sub(this._losOrigin)
    const dist = this._losDir.length()
    if (dist < 0.001) {
      this._losCachedResult = true
      return true
    }
    this._losDir.normalize()
    this._losRaycaster.set(this._losOrigin, this._losDir)
    this._losRaycaster.far = dist - 0.15 // stop just short of the player so their own body isn't a false hit
    const hits = this._losRaycaster.intersectObjects(solidMeshes, true)
    this._losCachedResult = hits.length === 0
    return this._losCachedResult
  }

  // Awareness system - see the module-level comment above AWARENESS_SIGHT_
  // RANGE for the full rationale. Called every frame for every alive
  // zombie; a no-op the instant `aware` flips true since nothing here ever
  // clears it again.
  _updateAwareness(playerPos, solidMeshes, dist, playerProne = false, playerCrouching = false, playerInSmoke = false) {
    if (this.aware) return
    if (this.isBoss || this.isWandering || this.isAmbush) {
      this.aware = true
      this.awareSince = performance.now()
      return
    }
    // Crouch stealth bonus (batch 3 feature) - a smaller version of prone's
    // own sight-range reduction, only when not ALSO prone (prone already
    // wins with the bigger reduction - the two states aren't simultaneous
    // in PlayerController anyway, but this keeps the precedence explicit).
    let sightRange = playerProne
      ? AWARENESS_SIGHT_RANGE * PRONE_SIGHT_RANGE_MULT
      : playerCrouching
        ? AWARENESS_SIGHT_RANGE * CROUCH_SIGHT_RANGE_MULT
        : AWARENESS_SIGHT_RANGE
    // Smoke grenade (batch 4 feature) - stacks with (multiplies on top of)
    // whichever stance multiplier already applied above, so prone+smoke is
    // genuinely stealthier than either alone.
    if (playerInSmoke) sightRange *= SMOKE_SIGHT_RANGE_MULT
    if (dist <= AWARENESS_PROXIMITY_RANGE) {
      this.aware = true
    } else if (dist <= sightRange && this._hasLineOfSight(playerPos, solidMeshes)) {
      this.aware = true
    }
    // Chase fatigue (batch 7 feature) - awareSince timestamps the moment
    // this zombie first noticed the player, read by the fatigueMult in the
    // main movement update (see that field's own comment) - this function
    // never clears `aware` again (see the doc comment above), so this only
    // ever needs to fire once per zombie.
    if (this.aware) this.awareSince = performance.now()
  }

  // Ambient wander (see _updateAwareness) - a slow, aimless drift used
  // instead of the normal chase/attack dispatch while a zombie hasn't
  // noticed the player yet. Picks a new random heading every few seconds
  // (WANDER_RETARGET_MS) rather than every frame, so it reads as idle
  // shambling instead of jittering in place.
  _updateWander(dt, colliders) {
    const now = performance.now()
    if (now >= this.wanderRetargetAt) {
      const angle = Math.random() * Math.PI * 2
      this.wanderDirX = Math.sin(angle)
      this.wanderDirZ = Math.cos(angle)
      this.wanderRetargetAt = now + WANDER_RETARGET_MS * (0.7 + Math.random() * 0.6)
    }
    const wanderSpeed = this.speed * WANDER_SPEED_MULT
    this._tryMove(this.wanderDirX * wanderSpeed * dt, this.wanderDirZ * wanderSpeed * dt, colliders)
    this.group.rotation.y = Math.atan2(this.wanderDirX, this.wanderDirZ)
  }

  // Dodge-able tell for _updateBossSpecial's wind-up: a fast growing
  // shake plus a red eye flash, so the player can see the slam coming and
  // back out of BOSS_SPECIAL_RANGE before it lands.
  _animateBossTelegraph(elapsed) {
    const remaining = this.specialTelegraphUntil - performance.now()
    if (remaining <= 0) {
      this.group.scale.setScalar(this.baseScale)
      return false
    }
    const progress = 1 - Math.max(0, remaining) / BOSS_SPECIAL_TELEGRAPH_MS
    const pulse = 1 + Math.sin(elapsed * 24) * 0.07 * progress
    this.group.scale.setScalar(this.baseScale * pulse)
    for (const mat of this.eyeMaterials) {
      mat.emissive.setHex(0xff2020)
      mat.emissiveIntensity = 1.5 + progress * 1.5
    }
    return true
  }

  // GLB path for the normal 'alive' state - crawler gets its own clip,
  // everyone else walks except during the attack-lunge window (boss types
  // kick, regular types punch - see the design note this came from). Boss
  // telegraph twitch/breathing (the procedural path's finer polish) is
  // intentionally not replicated here yet - this is Phase 2's baseline
  // parity pass, not full parity.
  _animateGLB(dt, elapsed) {
    const attacking = performance.now() < this.attackAnimUntil
    if (this.config.crawler || this.isCrippled) {
      this._playGlbAction('crawl', true)
    } else if (attacking) {
      this._playGlbAction(this.isBoss ? 'kick' : 'punch', false)
    } else {
      this._playGlbAction('walk', true)
    }
    this.mixer.update(dt)
    this.group.rotation.z = Math.sin(elapsed * this.effectiveSpeed * 1.1 + this.phase) * 0.04 + this.postureOffset * 0.2
    this._updateGlandFX(elapsed)
  }

  // Zombie Visual LOD - decides whether this frame's animation blend is
  // worth its cost, using three factors that only ever gate the COSMETIC
  // _animate() call below, never movement/AI/combat (those already ran
  // unconditionally above this point in update() regardless of what this
  // returns - a throttled zombie still walks, attacks, and takes damage
  // exactly on schedule, it just visually stops updating its limbs for a
  // few frames while doing it):
  //  1. Far enough away that limb motion is imperceptible.
  //  2. Roughly behind the player's view (reuses playerForwardX/Z, already
  //     threaded through for blind-spot flanking - no new camera plumbing).
  //  3. Occluded (reuses _hasLineOfSight, itself already budget-limited -
  //     see LOS_RAYCAST_BUDGET_PER_FRAME - so this never adds unbounded cost).
  // Throttled zombies still animate every ANIMATION_LOD_SKIP_FRAMES'th
  // frame rather than freezing outright, so one briefly coming back into
  // clear view mid-throttle never reads as a broken mannequin.
  _shouldFullyAnimate(dist, dx, dz, playerPos, solidMeshes, playerForwardX, playerForwardZ) {
    this._animFrameCounter = (this._animFrameCounter || 0) + 1
    let throttle = false
    if (dist > ANIMATION_LOD_FAR_DISTANCE) {
      throttle = true
    } else if (dist > ANIMATION_LOD_BEHIND_DISTANCE && playerForwardX !== null) {
      const invDist = dist > 0.0001 ? 1 / dist : 0
      const towardZombieX = -dx * invDist
      const towardZombieZ = -dz * invDist
      const facingDot = towardZombieX * playerForwardX + towardZombieZ * playerForwardZ
      if (facingDot < -0.3) throttle = true
    }
    if (!throttle && dist > ANIMATION_LOD_OCCLUSION_MIN_DISTANCE && solidMeshes && !this._hasLineOfSight(playerPos, solidMeshes)) {
      throttle = true
    }
    return !throttle || this._animFrameCounter % ANIMATION_LOD_SKIP_FRAMES === 0
  }

  _animate(dt, elapsed) {
    if (this.usingGLB) {
      if (this.config.dinosaur) {
        this._animateGLBTitan(dt, elapsed)
      } else {
        this._animateGLB(dt, elapsed)
      }
      return
    }

    if (this.isBoss && this._animateBossTelegraph(elapsed)) return

    const t = elapsed * this.effectiveSpeed * 2.2 + this.phase

    // UV weapon tell: eyes wash violet while weakened, so the effect reads
    // clearly instead of only being felt through slower movement/damage.
    // EMP stun gets its own electric-blue tell too - staggerUntil doubles as
    // both the normal ~200ms on-hit flinch and the EMP's much longer freeze
    // (see stun()), so only the long version (>300ms remaining) counts as a
    // genuine stun for this - a plain hit-flinch shouldn't flash blue.
    const weak = performance.now() < this.weakenedUntil
    const stunned = this.staggerUntil - performance.now() > 300
    for (const mat of this.eyeMaterials) {
      if (stunned) {
        mat.emissive.setHex(0x4ecfff)
        mat.emissiveIntensity = 2.6
      } else if (this.isBerserk) {
        mat.emissive.setHex(0xff2200)
        mat.emissiveIntensity = 2.8
      } else {
        mat.emissive.setHex(weak ? 0x8b2fe0 : 0xd8e8ff)
        mat.emissiveIntensity = weak ? 2.2 : 1.5
      }
    }

    if (this.config.crawler) {
      const pull = Math.sin(t) * 0.9
      this.armL.shoulder.rotation.x = -1.15 + pull
      this.armR.shoulder.rotation.x = -1.15 - pull
      this.armL.elbow.rotation.x = Math.max(0, pull) * 0.6
      this.armR.elbow.rotation.x = Math.max(0, -pull) * 0.6
      this.legL.shoulder.rotation.x = Math.sin(t + 0.6) * 0.2
      this.legR.shoulder.rotation.x = -Math.sin(t + 0.6) * 0.2
      this.hips.position.y = 0.52 + Math.abs(Math.sin(t * 2)) * 0.04
    } else {
      const swing = Math.sin(t) * 0.55
      this.legL.shoulder.rotation.x = swing
      this.legR.shoulder.rotation.x = -swing
      this.legL.elbow.rotation.x = Math.max(0, -swing) * 0.8
      this.legR.elbow.rotation.x = Math.max(0, swing) * 0.8

      const attacking = performance.now() < this.attackAnimUntil
      const lunge = attacking ? -0.7 : 0
      this.armL.shoulder.rotation.x = -1.15 + Math.sin(t + Math.PI) * 0.12 + lunge
      this.armR.shoulder.rotation.x = -1.15 + Math.sin(t) * 0.12 + lunge

      this.hips.position.y = 1.0 + Math.abs(Math.sin(t)) * 0.05
    }

    this.group.rotation.z = Math.sin(t * 0.5) * 0.04 + this.postureOffset * 0.2

    // Small nervous twitch so idle/approaching zombies never look perfectly still.
    const twitch = Math.sin(elapsed * 16 + this.twitchPhase) * 0.05 * Math.max(0, Math.sin(elapsed * 3 + this.twitchPhase))
    this.head.rotation.y = twitch

    // Ragged breathing: torso creaks in and out, ranged/exploder bellies throb faster and harder.
    const breath = Math.sin(elapsed * 1.6 + this.twitchPhase)
    if (this.torso) this.torso.scale.z = 1 + breath * 0.035
    this._updateGlandFX(elapsed)
  }

  // Belly/throat/bloat/vein emissive-sphere pulsing - shared by the
  // procedural body (spheres parented to a THREE.Group hips bone) and the
  // GLB body (spheres parented to a real skeleton bone, see
  // _addGlbFxSphere). Same pulseMesh/throatMesh contract either way.
  _updateGlandFX(elapsed) {
    if (this.pulseMesh) {
      const pulse = 1 + (Math.sin(elapsed * 3.4 + this.twitchPhase) * 0.5 + 0.5) * 0.14
      this.pulseMesh.scale.set(
        this.pulseBaseScale.x * pulse,
        this.pulseBaseScale.y * pulse,
        this.pulseBaseScale.z * pulse
      )
      if (this.pulseMat) {
        this.pulseMat.emissiveIntensity = performance.now() < this.enragedUntil ? 2.4 : 0.8
      }
    }
    if (this.throatMesh) {
      const screaming = performance.now() < this.screamPulseUntil
      const pulse = screaming
        ? 1 + (Math.sin(elapsed * 20) * 0.5 + 0.5) * 0.6
        : 1 + (Math.sin(elapsed * 2.6 + this.twitchPhase) * 0.5 + 0.5) * 0.15
      this.throatMesh.scale.set(
        this.throatBaseScale.x * pulse,
        this.throatBaseScale.y * pulse,
        this.throatBaseScale.z * pulse
      )
      this.throatMat.emissiveIntensity = screaming ? 2.4 : 0.9
    }
  }

  // World-space height (above this.group's own ground position) of this
  // zombie's head right now - reads the LIVE group.scale.y rather than a
  // static config value, so it stays correct through pop-up/pulse
  // animations that temporarily scale the group too. See
  // HEAD_HEIGHT_LOCAL's own doc comment for why this is the one place
  // that decides "how tall is the head" instead of every caller guessing.
  getHeadWorldHeight() {
    const localHeight = this.config.crawler ? HEAD_HEIGHT_LOCAL_CRAWLER : HEAD_HEIGHT_LOCAL
    return localHeight * this.group.scale.y
  }

  // Recomputes this frame's knockback offset fresh from elapsed-since-hit
  // (never accumulates), subtracting last frame's contribution and adding
  // the new one - same discipline Game.js's camera shake uses, so repeated
  // hits can't drift the zombie's position permanently.
  _updateHitReact() {
    this.group.position.x -= this._hitReactOffsetX
    this.group.position.z -= this._hitReactOffsetZ
    const elapsed = performance.now() - this.hitReactStartedAt
    if (elapsed < HIT_REACT_DURATION_MS) {
      const easeOut = 1 - elapsed / HIT_REACT_DURATION_MS
      this._hitReactOffsetX = this.hitReactX * HIT_REACT_MAX_PUSH * this.hitReactMagnitude * easeOut
      this._hitReactOffsetZ = this.hitReactZ * HIT_REACT_MAX_PUSH * this.hitReactMagnitude * easeOut
    } else {
      this._hitReactOffsetX = 0
      this._hitReactOffsetZ = 0
    }
    this.group.position.x += this._hitReactOffsetX
    this.group.position.z += this._hitReactOffsetZ
  }

  // Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
  // everything needed for a migrated-in host to keep this zombie behaving
  // IDENTICALLY, not just visually similar - every player-facing state
  // machine field, status effect, and cooldown, beyond the thin
  // position/health/type already broadcast for rendering.
  //
  // Every *Until/*At field representing an UPCOMING event is exported as
  // a REMAINING DURATION IN MS, and every *Since/*StartedAt field
  // representing something that ALREADY happened is exported as an
  // ELAPSED DURATION IN MS - never the raw performance.now() value,
  // which is a per-tab-relative clock that means nothing on a different
  // browser (see this plan's own Global Constraints). restoreFullState
  // converts these back to real performance.now()-based timestamps using
  // the calling (i.e. newly-importing) client's own clock.
  //
  // Deliberately excluded: isPackAlpha/_congestion (recomputed fresh
  // every frame from neighboring zombies, never meaningful to carry
  // over), the brief hit-react knockback fields (hitReactX/Z/Magnitude/
  // StartedAt, _hitReactOffsetX/Z - HIT_REACT_DURATION_MS is 200ms, far
  // shorter than the ~2.5-3s a real host disconnect takes to detect, so
  // this has always already fully decayed by migration time), and every
  // LOS-raycasting scratch/cache field (_losCachedResult/_losCacheUntil/
  // _moveBox/_losRaycaster/_losOrigin/_losDir - safe to just recompute
  // fresh, carrying over a stale cached LOS result would be actively
  // wrong).
  exportFullState() {
    const now = performance.now()
    const remaining = (until) => (until ? Math.max(0, until - now) : 0)
    const elapsed = (since) => (since ? Math.max(0, now - since) : 0)
    return {
      // Tier/identity flags - not part of `type`, so a plain shared
      // zombie can't otherwise be told apart from an elite/golden/
      // wandering/carrier one.
      isWandering: !!this.isWandering,
      isGolden: !!this.isGolden,
      isCarrier: !!this.isCarrier,
      isAlpha: !!this.isAlpha,
      isBoss: !!this.isBoss,
      flankSide: this.flankSide ?? null,
      fleeing: !!this.fleeing,
      // Awareness/wander AI mode.
      aware: !!this.aware,
      awareSinceMs: elapsed(this.awareSince),
      wanderDirX: this.wanderDirX,
      wanderDirZ: this.wanderDirZ,
      wanderRetargetInMs: remaining(this.wanderRetargetAt),
      dormantSinceMs: elapsed(this.dormantSince),
      // Status effects with expiry.
      enragedInMs: remaining(this.enragedUntil),
      enragePhase: this.enragePhase,
      weakenedInMs: remaining(this.weakenedUntil),
      hivemindBuffInMs: remaining(this.hivemindBuffUntil),
      staggerInMs: remaining(this.staggerUntil),
      igniteInMs: remaining(this.igniteUntil),
      igniteDps: this.igniteDps ?? 0,
      corrodedInMs: remaining(this.corrodedUntil),
      frozenInMs: remaining(this.frozenUntil),
      isCrippled: !!this.isCrippled,
      legHitCount: this.legHitCount ?? 0,
      isBerserk: !!this.isBerserk,
      // Cooldowns.
      attackCooldownInMs: remaining(this.attackCooldownUntil),
      attackAnimInMs: remaining(this.attackAnimUntil),
      screamCooldownInMs: remaining(this.screamCooldownUntil),
      screamPulseInMs: remaining(this.screamPulseUntil),
      trailCooldownInMs: remaining(this.trailCooldownUntil),
      leapCooldownInMs: remaining(this.leapCooldownUntil),
      specialCooldownInMs: remaining(this.specialCooldownUntil),
      specialTelegraphInMs: remaining(this.specialTelegraphUntil),
      nextAddSummonInMs: remaining(this.nextAddSummonAt),
      // Shielded-type absorb pool.
      shieldHealth: this.shieldHealth,
      // Death/transition state.
      dieStartedMsAgo: elapsed(this.dieStartedAt),
      popStartedMsAgo: elapsed(this.popStartedAt),
      burstInMs: remaining(this.burstUntil),
      pendingExplosion: !!this.pendingExplosion,
      explodeStartedMsAgo: elapsed(this.explodeStartedAt),
      deathHandled: !!this.deathHandled,
      // Climbing (mid-arc obstacle traversal) - kept despite its short
      // 500ms duration (ZOMBIE_CLIMB_DURATION_MS), unlike hit-react above,
      // since this is real simulation state (not pure decoration): a
      // zombie mid-climb needs to actually finish its arc correctly, not
      // silently reset to standing on the ground mid-obstacle. In
      // practice, by the time migration completes the elapsed real time
      // will usually already exceed 500ms, so the new host's own
      // progress-based climb-completion check (elapsed/duration, clamped
      // to 1) naturally finishes the climb immediately - which is the
      // CORRECT seamless behavior, not a bug.
      isClimbing: !!this.isClimbing,
      climbStartX: this._climbStartX,
      climbStartZ: this._climbStartZ,
      climbPeakY: this._climbPeakY,
      climbTargetX: this._climbTargetX,
      climbTargetZ: this._climbTargetZ,
      climbStartedMsAgo: elapsed(this._climbStartedAt),
      // Combat bookkeeping.
      lastHitWeaponId: this.lastHitWeaponId ?? null,
      lastHitFromPlayerId: this._lastHitFromPlayerId ?? null,
    }
  }

  // The inverse of exportFullState() above - applies a previously-
  // exported snapshot onto this instance, converting every duration back
  // into a real performance.now()-based timestamp using THIS client's own
  // clock (the only correct way to do it - see exportFullState's comment).
  restoreFullState(data) {
    if (!data) return
    const now = performance.now()
    const inFuture = (ms) => (ms > 0 ? now + ms : 0)
    const inPast = (ms) => (ms > 0 ? now - ms : 0)
    this.isWandering = !!data.isWandering
    this.isGolden = !!data.isGolden
    this.isCarrier = !!data.isCarrier
    this.isAlpha = !!data.isAlpha
    this.isBoss = !!data.isBoss
    this.flankSide = data.flankSide ?? null
    this.fleeing = !!data.fleeing
    this.aware = !!data.aware
    this.awareSince = inPast(data.awareSinceMs)
    this.wanderDirX = data.wanderDirX
    this.wanderDirZ = data.wanderDirZ
    this.wanderRetargetAt = inFuture(data.wanderRetargetInMs)
    this.dormantSince = inPast(data.dormantSinceMs)
    this.enragedUntil = inFuture(data.enragedInMs)
    this.enragePhase = data.enragePhase ?? 0
    this.weakenedUntil = inFuture(data.weakenedInMs)
    this.hivemindBuffUntil = inFuture(data.hivemindBuffInMs)
    this.staggerUntil = inFuture(data.staggerInMs)
    this.igniteUntil = inFuture(data.igniteInMs)
    this.igniteDps = data.igniteDps ?? 0
    this.corrodedUntil = inFuture(data.corrodedInMs)
    this.frozenUntil = inFuture(data.frozenInMs)
    this.isCrippled = !!data.isCrippled
    this.legHitCount = data.legHitCount ?? 0
    this.isBerserk = !!data.isBerserk
    this.attackCooldownUntil = inFuture(data.attackCooldownInMs)
    this.attackAnimUntil = inFuture(data.attackAnimInMs)
    this.screamCooldownUntil = inFuture(data.screamCooldownInMs)
    this.screamPulseUntil = inFuture(data.screamPulseInMs)
    this.trailCooldownUntil = inFuture(data.trailCooldownInMs)
    this.leapCooldownUntil = inFuture(data.leapCooldownInMs)
    this.specialCooldownUntil = inFuture(data.specialCooldownInMs)
    this.specialTelegraphUntil = inFuture(data.specialTelegraphInMs)
    this.nextAddSummonAt = inFuture(data.nextAddSummonInMs)
    this.shieldHealth = data.shieldHealth ?? 0
    this.dieStartedAt = inPast(data.dieStartedMsAgo)
    this.popStartedAt = inPast(data.popStartedMsAgo)
    this.burstUntil = inFuture(data.burstInMs)
    this.pendingExplosion = !!data.pendingExplosion
    this.explodeStartedAt = inPast(data.explodeStartedMsAgo)
    this.deathHandled = !!data.deathHandled
    this.isClimbing = !!data.isClimbing
    this._climbStartX = data.climbStartX
    this._climbStartZ = data.climbStartZ
    this._climbPeakY = data.climbPeakY
    this._climbTargetX = data.climbTargetX
    this._climbTargetZ = data.climbTargetZ
    this._climbStartedAt = inPast(data.climbStartedMsAgo)
    this.lastHitWeaponId = data.lastHitWeaponId ?? null
    this._lastHitFromPlayerId = data.lastHitFromPlayerId ?? null
  }

  onHit(damage, opts = {}) {
    if (this.isNetworkDriven) {
      // Not authoritative - this instance is a guest's rendering of a
      // zombie the host is really simulating, so don't touch health
      // locally at all. Game.js sets _onNetworkHit right after
      // constructing one of these (see _renderSharedZombies) to queue
      // the hit for the next sync call instead.
      // Phase 3b shielded fix: the real (non-network) onHit below treats
      // a melee hit (this.lastHitWeaponId === 'melee', set by
      // WeaponSystem._fire right before every onHit call) as bypassing
      // the shield, same as opts.bypassShield (Armor-Piercing Rounds).
      // Without folding that in here too, a guest's melee hit against a
      // shared shielded zombie would be reported with bypassShield only
      // reflecting opts (never true for a plain melee swing), and the
      // host would incorrectly drain the shield pool instead of health
      // when it replays the report.
      if (typeof this._onNetworkHit === 'function') {
        const effectiveBypass = !!opts.bypassShield || this.lastHitWeaponId === 'melee'
        this._onNetworkHit(damage, { ...opts, bypassShield: effectiveBypass })
      }
      return
    }
    if (this.state !== 'alive' && this.state !== 'popping') return
    // Phase 5 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase5-reward-integrity-design.md) -
    // overwritten on every real hit regardless of source, so whichever
    // player's shot most recently reduced this zombie's health is who
    // gets credited if this hit is the one that kills it. null means the
    // host's own local shot (every existing onHit call site already omits
    // fromPlayerId, so this is the correct default with zero other
    // changes needed anywhere else in this file).
    this._lastHitFromPlayerId = opts.fromPlayerId ?? null
    // Shielded type: non-melee hits drain the shield pool first and never
    // touch health while it holds; melee (see lastHitWeaponId, set by
    // WeaponSystem._fire right before every onHit call) skips it entirely -
    // as does the Armor-Piercing Rounds attachment (opts.bypassShield),
    // which reads as "punches straight through like melee does" rather than
    // needing its own separate damage path.
    // Brittle - takes bonus damage from every source, applied here rather
    // than at each individual damage-source call site.
    if (this.config.fragile) damage *= this.config.fragileDamageMult
    if (this.corrodedUntil && performance.now() < this.corrodedUntil) damage *= CORRODE_DAMAGE_MULT
    const blockedByShield = this.shieldHealth > 0 && this.lastHitWeaponId !== 'melee' && !opts.bypassShield
    if (blockedByShield) {
      this.shieldHealth = Math.max(0, this.shieldHealth - damage)
    } else {
      this.health = Math.max(0, this.health - damage)
    }
    if (this.isBoss) this._checkEnragePhase()
    this.staggerUntil = performance.now() + 200

    // Varied hit-reaction (see _updateHitReact) - knocked away from roughly
    // where the player is, harder for a bigger hit. Falls back to whatever
    // direction the last hit already used if this zombie hasn't seen the
    // player yet this frame (e.g. hit within its very first update tick).
    const hrDx = this.group.position.x - (this._lastPlayerX ?? this.group.position.x - this.hitReactX)
    const hrDz = this.group.position.z - (this._lastPlayerZ ?? this.group.position.z - this.hitReactZ)
    const hrLen = Math.hypot(hrDx, hrDz)
    if (hrLen > 0.0001) {
      this.hitReactX = hrDx / hrLen
      this.hitReactZ = hrDz / hrLen
    }
    this.hitReactMagnitude = Math.min(1, damage / HIT_REACT_DAMAGE_FOR_MAX)
    this.hitReactStartedAt = performance.now()

    this._barSprite.visible = true
    this._redrawHealthBar()

    for (const mat of this.materials) {
      const original = this.materialDefaults.get(mat)
      mat.emissive.setHex(0xffffff)
      mat.emissiveIntensity = 1
      setTimeout(() => {
        if (this.state === 'dead' || this.state === 'exploding') return
        mat.emissive.setHex(original.hex)
        mat.emissiveIntensity = original.intensity
      }, 100)
    }

    if (this.health <= 0) {
      // explodeOnDeath (see spitter_bomber in ZombieTypes.js) reuses the
      // exploder's own _explode/pendingExplosion path even though this
      // zombie's live attack behavior is ranged, not proximity-explode.
      // Brittle's shatterOnMelee reuses the exact same path, gated on the
      // finishing blow specifically being melee.
      if (this.config.explodes || this.config.explodeOnDeath || (this.config.shatterOnMelee && this.lastHitWeaponId === 'melee')) {
        this.pendingExplosion = true
      } else {
        this.state = 'dying'
        this.dieStartedAt = performance.now()
        // Lightweight fake ragdoll (no physics engine in this project) - a
        // random per-corpse fall lean/drift layered on top of whichever
        // death animation already plays (GLB clip or the procedural hip
        // tip below), so corpses stop falling in an identical, uniform way
        // without needing a real rigid-body simulation.
        this.fallLeanZ = (Math.random() - 0.5) * 0.9
        this.fallDriftX = (Math.random() - 0.5) * 0.6
        this.fallDriftZ = (Math.random() - 0.5) * 0.6
      }
    }
  }
}

function shadeColor(hex, amount) {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 0xff) * (1 + amount)))
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 0xff) * (1 + amount)))
  const b = Math.max(0, Math.min(255, (hex & 0xff) * (1 + amount)))
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

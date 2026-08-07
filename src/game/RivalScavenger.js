import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { flatMaterial, flattenedClone } from './QualitySettings.js'

// Phase 3 of the 3D asset overhaul - real rigged GLB rival (Quaternius
// "BlueSoldier_Male", asset-source/build-humans.py), same rig/animation set
// as Companion.js's GLB, just a different palette. See Companion.js's own
// GLB comments for the general pattern.
export const USE_GLB_RIVAL = true
let _rivalModelCache = null

export async function preloadRivalModel() {
  try {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync('/models/humans/rival.glb')
    _rivalModelCache = { scene: gltf.scene, animations: gltf.animations }
  } catch (err) {
    console.warn('GLB rival model failed to load, falling back to procedural rival', err)
  }
}

// Same rig/raw height as Companion.js's model (confirmed via inspection -
// both exported from the same pack, near-identical bounds), so the same
// measured correction applies.
const GLB_SCALE_CORRECTION = 0.556

// A small human squad that races the player to a landed airdrop (see
// Game.js's _spawnAirdrop) - not zombies, so they don't touch any of the
// zombie-specific systems (bestiary, kill stats, achievements). If a member
// reaches the airdrop before the player does, the squad claims it and the
// player gets nothing; if the player gets close first, every member still
// alive stops and fights instead.
const MOVE_SPEED = 3.2
const ENGAGE_RANGE = 16
const FIRE_INTERVAL_MS = 1500
const DAMAGE_MIN = 8
const DAMAGE_MAX = 16
const MAX_HEALTH = 90
const TRACER_MS = 120
const CLAIM_RADIUS = 1.6

// Combat positioning (see update()'s engaged branch and _hasLineOfSight) -
// previously a rival just stood in place shooting the instant it was in
// ENGAGE_RANGE, hitting the player through walls with no LOS check at
// all. Now: no line of sight means no hit AND no standing around uselessly
// (advances to try to regain a clear shot instead), and a clear shot at
// close range backs the rival off while still firing rather than trading
// hits standing still. Real cover-point selection (finding and evaluating
// a specific nearby object to duck behind) was scoped out as too risky to
// get right without live playtesting - this is the safer "reads as
// tactical positioning" version. No per-frame raycast budget/cache like
// Zombie.js's own _hasLineOfSight needs - a squad is a handful of rivals,
// nowhere near the horde-sized counts that budget exists for.
const MIN_ENGAGE_DISTANCE = 6
const RETREAT_SPEED_MULT = 0.7

// Rivalry banter (see Game.js's _spawnAirdrop/_updateAirdrop/rival-update
// call site) - plain English rather than full i18n, same precedent as
// Game.js's own COMPANION_BARKS (flavor text, not mechanical UI). Only the
// squad's first member is ever named - enough for a recurring "rival" feel
// without tracking individual banter per squad member.
export const RIVAL_NAMES = [
  'Ghost Wolf', 'Iron Sable', 'Rook', 'Cinder', 'Marrow', 'Vex', 'Talon Grey', 'Old Static',
]
export const RIVAL_BANTER = {
  spotted: (name) => `${name}'s crew just showed up, racing you for it.`,
  claimed: (name) => `${name} grins and hoists the crate. Better luck next time.`,
  defeated: (name) => `${name}'s crew won't be racing anyone again.`,
}

class RivalScavenger {
  constructor(scene, x, z, targetX, targetZ) {
    this.scene = scene
    this.name = RIVAL_NAMES[Math.floor(Math.random() * RIVAL_NAMES.length)]
    this.health = MAX_HEALTH
    this.maxHealth = MAX_HEALTH
    this.state = 'alive'
    this.targetX = targetX
    this.targetZ = targetZ
    this.nextFireAt = 0
    this.tracers = []

    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    this._prevX = x
    this._prevZ = z
    this._glbAttackUntil = 0
    // Line of sight (see _hasLineOfSight) - reused every call instead of
    // allocating fresh, same pattern Zombie.js's own version uses.
    this._losRaycaster = new THREE.Raycaster()
    this._losOrigin = new THREE.Vector3()
    this._losDir = new THREE.Vector3()
    this._buildBody()
    scene.add(this.group)
  }

  // Blocked line of sight (a wall/building between here and the player)
  // means this rival can't land a hit even within ENGAGE_RANGE - see
  // update()'s own comment on why this exists. No solidMeshes passed skips
  // the check (treated as clear), matching Zombie.js's own precedent.
  _hasLineOfSight(playerPos, solidMeshes) {
    if (!solidMeshes || solidMeshes.length === 0) return true
    this._losOrigin.copy(this.group.position)
    this._losOrigin.y += 1.3
    this._losDir.copy(playerPos).sub(this._losOrigin)
    const dist = this._losDir.length()
    if (dist < 0.001) return true
    this._losDir.normalize()
    this._losRaycaster.set(this._losOrigin, this._losDir)
    this._losRaycaster.far = dist - 0.15
    return this._losRaycaster.intersectObjects(solidMeshes, true).length === 0
  }

  _buildBody() {
    if (USE_GLB_RIVAL && _rivalModelCache) {
      this._buildBodyFromGLB()
      return
    }
    this._buildBodyProcedural()
  }

  // See Companion.js's _buildBodyFromGLB - same pattern. Dark palette (the
  // "Main" material tinted near-black) + red emissive eyes bone-parented
  // to the Head bone, matching the doc's "dark palette + red emissive
  // eyes as bone-parented props" note for this NPC.
  _buildBodyFromGLB() {
    this.usingGLB = true
    const cloned = cloneSkeleton(_rivalModelCache.scene)
    this.group.scale.setScalar(GLB_SCALE_CORRECTION)

    cloned.traverse((child) => {
      if (!child.isMesh) return
      child.castShadow = true
      child.material = flattenedClone(child.material)
      if (child.material.name === 'Main') child.material.color.setHex(0x2a2420)
      child.userData.rival = this
    })
    this.hittableMeshes = []
    cloned.traverse((child) => { if (child.isMesh) this.hittableMeshes.push(child) })

    const headBone = cloned.getObjectByName('Head')
    if (headBone) {
      const eyeMat = flatMaterial({ color: 0x1a0505, emissive: 0xff3b1e, emissiveIntensity: 1.2 })
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat)
        eye.position.set(side * 0.11, 0.15, 0.14)
        headBone.add(eye)
      }
    }

    this.group.add(cloned)
    this._glbRoot = cloned
    this.mixer = new THREE.AnimationMixer(cloned)
    this._glbActions = {}
    for (const clip of _rivalModelCache.animations) {
      this._glbActions[clip.name] = this.mixer.clipAction(clip)
    }
    this._glbCurrentAction = null
    this._playGlbAction('idle', true)

    this._addWeaponProp()
  }

  _playGlbAction(name, loop) {
    const action = this._glbActions[name]
    if (!action || this._glbCurrentAction === action) return
    action.reset()
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !loop
    action.fadeIn(0.15)
    if (this._glbCurrentAction) this._glbCurrentAction.fadeOut(0.15)
    action.play()
    this._glbCurrentAction = action
  }

  // Shared weapon prop for both body types - see Companion.js's own version
  // of this same trick (world-space offsets divided by this.group.scale).
  _addWeaponProp() {
    const s = 1 / this.group.scale.x
    const weaponMat = flatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.4 })
    this.weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.14 * s, 0.32 * s), weaponMat)
    this.weaponProp.position.set(0.32 * s, 0.9 * s, 0.1 * s)
    this.group.add(this.weaponProp)
  }

  // Dark, hooded raider silhouette - deliberately not a Companion recolor
  // (jacket-only), so it reads as hostile at a glance rather than "friendly
  // NPC in the wrong color."
  _buildBodyProcedural() {
    const gearMat = flatMaterial({ color: 0x2a2420, roughness: 0.85 })
    const maskMat = flatMaterial({ color: 0x1a1a1a, roughness: 0.6 })
    const eyeMat = flatMaterial({ color: 0x1a0505, emissive: 0xff3b1e, emissiveIntensity: 1.2 })
    const weaponMat = flatMaterial({ color: 0x1c1c1a, roughness: 0.5, metalness: 0.4 })

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.64, 0.3), gearMat)
    torso.position.y = 1.15
    torso.castShadow = true
    this.group.add(torso)

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), maskMat)
    head.position.y = 1.63
    head.castShadow = true
    this.group.add(head)

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), eyeMat)
      eye.position.set(side * 0.06, 1.64, 0.15)
      this.group.add(eye)
    }

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), maskMat)
      leg.position.set(side * 0.13, 0.5, 0)
      leg.castShadow = true
      this.group.add(leg)

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), gearMat)
      arm.position.set(side * 0.32, 1.15, 0)
      arm.castShadow = true
      this.group.add(arm)
    }

    const weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.32), weaponMat)
    weaponProp.position.set(0.32, 0.9, 0.1)
    this.group.add(weaponProp)

    // Tagged for WeaponSystem's raycast (see its userData.rival check) -
    // torso and head only, matching the hit-area scope zombies use.
    torso.userData.rival = this
    head.userData.rival = this
    this.hittableMeshes = [torso, head]
  }

  onHit(damage) {
    if (this.state !== 'alive') return
    this.health -= damage
    if (this.health <= 0) {
      this.state = 'dead'
      this.group.visible = false
    }
  }

  // Returns true the frame this scavenger reaches the airdrop while still
  // alive - RivalManager.update turns that into "the squad claimed it."
  update(dt, playerPos, onAttack, solidMeshes) {
    if (this.state !== 'alive') return false

    const dx = playerPos.x - this.group.position.x
    const dz = playerPos.z - this.group.position.z
    const distToPlayer = Math.hypot(dx, dz)

    if (distToPlayer <= ENGAGE_RANGE) {
      this.group.rotation.y = Math.atan2(dx, dz)
      const hasLOS = this._hasLineOfSight(playerPos, solidMeshes)
      const nx = distToPlayer > 0.001 ? dx / distToPlayer : 0
      const nz = distToPlayer > 0.001 ? dz / distToPlayer : 1
      if (!hasLOS) {
        // Blocked - advance to try to regain a clear shot instead of
        // standing uselessly behind whatever's in the way.
        this.group.position.x += nx * MOVE_SPEED * dt
        this.group.position.z += nz * MOVE_SPEED * dt
      } else if (distToPlayer < MIN_ENGAGE_DISTANCE) {
        // Clear shot but too close for comfort - back off while still
        // facing/firing, rather than trading hits standing still.
        this.group.position.x -= nx * MOVE_SPEED * RETREAT_SPEED_MULT * dt
        this.group.position.z -= nz * MOVE_SPEED * RETREAT_SPEED_MULT * dt
      }
      if (hasLOS && performance.now() >= this.nextFireAt) {
        this.nextFireAt = performance.now() + FIRE_INTERVAL_MS + Math.random() * 400
        const damage = DAMAGE_MIN + Math.random() * (DAMAGE_MAX - DAMAGE_MIN)
        if (onAttack) onAttack(damage)
        this._spawnTracer(playerPos)
        this._glbAttackUntil = performance.now() + 400
        audioEngine.playShot('pistol', true)
      }
    } else {
      const tx = this.targetX - this.group.position.x
      const tz = this.targetZ - this.group.position.z
      const distToTarget = Math.hypot(tx, tz)
      if (distToTarget > 0.001) {
        const nx = tx / distToTarget
        const nz = tz / distToTarget
        this.group.position.x += nx * MOVE_SPEED * dt
        this.group.position.z += nz * MOVE_SPEED * dt
        this.group.rotation.y = Math.atan2(nx, nz)
      }
    }

    this._updateTracers()
    this._updateGlbLocomotion(dt)

    const tx = this.targetX - this.group.position.x
    const tz = this.targetZ - this.group.position.z
    return Math.hypot(tx, tz) < CLAIM_RADIUS
  }

  // See Companion.js's own version of this same helper.
  _updateGlbLocomotion(dt) {
    if (!this.usingGLB) return
    const moved = Math.hypot(this.group.position.x - this._prevX, this.group.position.z - this._prevZ)
    this._prevX = this.group.position.x
    this._prevZ = this.group.position.z
    const attacking = performance.now() < this._glbAttackUntil
    if (attacking) {
      this._playGlbAction('shoot', false)
    } else if (dt > 0 && moved / dt > 0.3) {
      this._playGlbAction('walk', true)
    } else {
      this._playGlbAction('idle', true)
    }
    this.mixer.update(dt)
  }

  _spawnTracer(targetPos) {
    const origin = this.group.position.clone()
    origin.y += 1.3
    const target = targetPos.clone()
    target.y += 0.9

    const geo = new THREE.BufferGeometry().setFromPoints([origin, target])
    const mat = new THREE.LineBasicMaterial({ color: 0xff8a5a, transparent: true, opacity: 0.9 })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.tracers.push({ line, startedAt: performance.now() })
  }

  _updateTracers() {
    this.tracers = this.tracers.filter((tr) => {
      const age = performance.now() - tr.startedAt
      tr.line.material.opacity = 0.9 * (1 - age / TRACER_MS)
      if (age >= TRACER_MS) {
        this.scene.remove(tr.line)
        tr.line.geometry.dispose()
        return false
      }
      return true
    })
  }

  dispose() {
    this.scene.remove(this.group)
    for (const tr of this.tracers) this.scene.remove(tr.line)
  }
}

export class RivalManager {
  constructor(scene) {
    this.scene = scene
    this.squads = []
  }

  // One squad, positioned in a rough ring around the target so they
  // converge on it from several directions instead of one clump. Two
  // callers: Game.js's _spawnAirdrop (type 'airdrop' - claims the crate if
  // they reach it before the player) and NightEvents.js's supply convoy
  // (type 'convoy' - guards a chest instead, see update()'s claimed check
  // below for why the two need to stay distinguishable).
  spawnSquad(targetX, targetZ, count = 2, type = 'airdrop') {
    const members = []
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 18 + Math.random() * 6
      const x = targetX + Math.cos(angle) * dist
      const z = targetZ + Math.sin(angle) * dist
      members.push(new RivalScavenger(this.scene, x, z, targetX, targetZ))
    }
    this.squads.push({ members, type })
    return members[0].name
  }

  get hittableMeshes() {
    const meshes = []
    for (const squad of this.squads) {
      for (const m of squad.members) {
        if (m.state === 'alive') meshes.push(...m.hittableMeshes)
      }
    }
    return meshes
  }

  // Returns { claimed, claimedByName, defeatedNames }: claimed is true if
  // any live member of an 'airdrop'-type squad reached its target this tick
  // (Game.js treats that as "the current airdrop just got claimed by
  // rivals" since there's only ever one airdrop active at a time; 'convoy'
  // squads reaching their target just means they've arrived to guard the
  // crate there, not a claim, so they're excluded). defeatedNames names
  // every squad whose last member died this exact tick, for a one-shot
  // rivalry banter line rather than one per individual member kill.
  update(dt, playerPos, onAttack, solidMeshes) {
    let claimed = false
    let claimedByName = null
    for (const squad of this.squads) {
      for (const m of squad.members) {
        const reachedTarget = m.update(dt, playerPos, onAttack, solidMeshes)
        if (reachedTarget && squad.type === 'airdrop') {
          claimed = true
          claimedByName = squad.members[0].name
        }
      }
    }
    const defeatedNames = []
    this.squads = this.squads.filter((squad) => {
      const allDead = squad.members.every((m) => m.state === 'dead')
      if (allDead) {
        defeatedNames.push(squad.members[0].name)
        for (const m of squad.members) m.dispose()
        return false
      }
      return true
    })
    return { claimed, claimedByName, defeatedNames }
  }

  reset() {
    for (const squad of this.squads) {
      for (const m of squad.members) m.dispose()
    }
    this.squads = []
  }
}

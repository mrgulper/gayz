import * as THREE from 'three'
import { accessibility } from './Accessibility.js'

const DEATH_ANIM_MS = 550
const EXPLODE_LINGER_MS = 150
const HEALTH_BAR_W = 64
const HEALTH_BAR_H = 10

const AMBUSH_TRIGGER_RANGE = 9
const AMBUSH_TRIGGER_RANGE_CROUCH = 4.5
const AMBUSH_MAX_WAIT_MS = 14000
const AMBUSH_POP_MS = 220
const AMBUSH_BURST_MS = 1900
const AMBUSH_BURST_SPEED_MULT = 2.3
const DEFAULT_ENRAGE_MULT = 1.4
const DEFAULT_WEAKEN_MULT = 0.55

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

// Zombies always stand at group.position.y = 0 (see the constructor) and
// playerPos is the camera/eye position, which sits ~1.7 above the player's
// feet on ordinary flat ground (PlayerController's EYE_HEIGHT) - that gap
// is normal and must not count against melee reach. Only elevation *beyond*
// that (standing on a car roof, a ledge, etc.) should push the player out
// of a melee zombie's reach, so it stops trying to attack through the
// object it's standing under instead of freezing there uselessly.
const TYPICAL_EYE_HEIGHT = 1.7

let zombieIdCounter = 0

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
  constructor(x, z, typeConfig, isAmbush = false, isElite = false, night = 1) {
    this.id = zombieIdCounter++
    this.type = typeConfig.id
    this.config = typeConfig
    this.isAmbush = isAmbush
    this.isElite = isElite

    this.speed = typeConfig.speedMin + Math.random() * (typeConfig.speedMax - typeConfig.speedMin)
    this.phase = Math.random() * Math.PI * 2
    this.twitchPhase = Math.random() * Math.PI * 2
    this.postureOffset = (Math.random() - 0.5) * 0.3
    this.asymmetrySide = Math.random() < 0.5 ? -1 : 1
    this.asymmetryAmount = 0.1 + Math.random() * 0.18
    this.stopDistance = typeConfig.ranged ? typeConfig.engageRange : typeConfig.meleeRange

    this.health = typeConfig.health * (isElite ? ELITE_HEALTH_MULT : 1)
    this.maxHealth = this.health
    // alive states flow: dormant -> popping -> alive -> dying/exploding -> dead
    this.state = isAmbush ? 'dormant' : 'alive'
    this.dormantSince = performance.now()
    // Jittered per-instance so a cluster of ambush zombies doesn't all pop
    // with the exact same timing - see the 'dormant'->'popping' transition
    // and forceWake().
    this.popDurationMs = AMBUSH_POP_MS * (0.7 + Math.random() * 0.6)
    this.burstDurationMs = AMBUSH_BURST_MS * (0.8 + Math.random() * 0.4)
    this.staggerUntil = 0
    this.attackCooldownUntil = 0
    this.attackAnimUntil = 0
    this.dieStartedAt = 0
    this.popStartedAt = 0
    this.burstUntil = 0
    this.pendingExplosion = false
    this.explodeStartedAt = 0
    this.screamCooldownUntil = performance.now() + (typeConfig.screams ? Math.random() * typeConfig.screamCooldown * 1000 : 0)
    this.screamPulseUntil = 0
    this.enragedUntil = 0
    this.weakenedUntil = 0
    this.specialCooldownUntil = 0
    this.specialTelegraphUntil = 0
    this._specialArmed = false

    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)

    // Reused every frame by _tryMove/_hasLineOfSight instead of allocating
    // fresh objects per zombie per frame - there can be a couple dozen of
    // these alive checking every frame.
    this._moveBox = new THREE.Box3()
    this._losRaycaster = new THREE.Raycaster()
    this._losOrigin = new THREE.Vector3()
    this._losDir = new THREE.Vector3()

    this._buildBody()

    const baseScale = typeConfig.scale * (isElite ? ELITE_SCALE_MULT : 1)
    this.baseScale = baseScale
    if (isAmbush) {
      this.group.scale.set(baseScale, baseScale * 0.35, baseScale)
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = 0.25
    } else {
      this.group.scale.setScalar(baseScale)
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
    const cfg = this.config
    const isCrawler = !!cfg.crawler
    const skin = cfg.skinTones[Math.floor(Math.random() * cfg.skinTones.length)]
    const clothes = cfg.clothesTones[Math.floor(Math.random() * cfg.clothesTones.length)]

    const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.98 })
    const skinMatAlt = new THREE.MeshStandardMaterial({ color: shadeColor(skin, -0.12), roughness: 0.98 })
    const clothesMat = new THREE.MeshStandardMaterial({ color: clothes, roughness: 1 })
    const woundMat = new THREE.MeshStandardMaterial({ color: 0x4a0f0f, roughness: 0.75, emissive: 0x2a0505, emissiveIntensity: 0.3 })
    const grimeMat = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 1 })
    const clawMat = new THREE.MeshStandardMaterial({ color: 0x1a1a16, roughness: 0.6 })
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xcfc7a8, roughness: 0.5 })
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0a, roughness: 1 })
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x0a0a08, roughness: 1 })
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x0f0d0a, roughness: 1 })
    const hoodMat = new THREE.MeshStandardMaterial({ color: 0x1c211c, roughness: 1 })
    const hoodInsideMat = new THREE.MeshStandardMaterial({ color: 0x0a0c0a, roughness: 1 })
    const wetBloodMat = new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.25, metalness: 0.1 })

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
      const bellyMat = new THREE.MeshStandardMaterial({
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
      const throatMat = new THREE.MeshStandardMaterial({
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
      const bloatMat = new THREE.MeshStandardMaterial({
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

    if (this.config.feedsOnLight) {
      const veinMat = new THREE.MeshStandardMaterial({
        color: 0x1a0a2a,
        emissive: 0x8b2fe0,
        emissiveIntensity: 0.8,
      })
      const veins = track(new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), veinMat), veinMat)
      veins.position.set(0, 0.3, 0.1)
      veins.scale.set(1.05, 1, 0.9)
      this.hips.add(veins)
      this.pulseMesh = veins
      this.pulseBaseScale = veins.scale.clone()
      this.pulseMat = veinMat
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

      const eyeMat = new THREE.MeshStandardMaterial({ color: 0xc8d0d0, emissive: 0xd8e8ff, emissiveIntensity: 1.5 })
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
      const wetBloodMat = new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.25, metalness: 0.1 })
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
    this._barSprite.position.set(0, this.config.crawler ? 0.85 : 2.05, 0)
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

    // Colorblind mode swaps the classic green/red pair (hardest to tell apart
    // for red-green colorblindness) for blue/orange, which stays readable
    // across deuteranopia, protanopia, and tritanopia.
    ctx.fillStyle = accessibility.colorblind
      ? (fraction > 0.5 ? '#4a9ecf' : fraction > 0.25 ? '#e0b23f' : '#e0813f')
      : (fraction > 0.5 ? '#5fcf4a' : fraction > 0.25 ? '#e0b23f' : '#d64545')
    ctx.fillRect(1, 1, (HEALTH_BAR_W - 2) * fraction, HEALTH_BAR_H - 2)

    this._barSprite.material.map.needsUpdate = true
  }

  update(dt, elapsed, playerPos, onAttack, onSpit, onAmbushTrigger, onExplode, playerCrouching = false, onScream = null, colliders = null, solidMeshes = null, allZombies = null) {
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
      const baseScale = this.config.scale
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
      this.hips.rotation.x = 0.16 + progress * 1.3
      this.group.position.y = -progress * 0.4 * this.config.scale
      this._barSprite.visible = false
      if (progress >= 1) this.state = 'dead'
      return
    }
    if (this.state === 'dead') return

    const staggered = performance.now() < this.staggerUntil
    const dx = playerPos.x - this.group.position.x
    const dz = playerPos.z - this.group.position.z
    const dist = Math.hypot(dx, dz)
    let nx = dist > 0.0001 ? dx / dist : 0
    let nz = dist > 0.0001 ? dz / dist : 1

    if (allZombies) {
      let sepX = 0
      let sepZ = 0
      for (const other of allZombies) {
        if (other === this || other.state !== 'alive') continue
        const odx = this.group.position.x - other.group.position.x
        const odz = this.group.position.z - other.group.position.z
        const odist = Math.hypot(odx, odz)
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
      if (sepX !== 0 || sepZ !== 0) {
        nx += sepX * SEPARATION_WEIGHT
        nz += sepZ * SEPARATION_WEIGHT
        const len = Math.hypot(nx, nz)
        if (len > 0.0001) {
          nx /= len
          nz /= len
        }
      }
    }

    const burstMult = performance.now() < this.burstUntil ? AMBUSH_BURST_SPEED_MULT : 1
    const enrageMult = performance.now() < this.enragedUntil ? (this.config.screamEnrageMult ?? DEFAULT_ENRAGE_MULT) : 1
    const weakenMult = performance.now() < this.weakenedUntil ? DEFAULT_WEAKEN_MULT : 1
    this.effectiveSpeed = this.speed * Math.max(burstMult, enrageMult) * weakenMult

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
    }

    this._animate(elapsed)
  }

  // Called by ZombieManager when another zombie's scream reaches this one.
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

  // UV weapon effect: slows movement (see effectiveSpeed above) and softens
  // its own damage output while lit.
  weaken(durationMs) {
    if (this.state !== 'alive') return
    this.weakenedUntil = Math.max(this.weakenedUntil, performance.now() + durationMs)
  }

  _updateMelee(dt, dist, nx, nz, onAttack, colliders, solidMeshes, playerPos) {
    if (this.isBoss && this._updateBossSpecial(dist, playerPos, onAttack) === 'busy') return

    // In range but no line of sight (a wall/floor between us and the
    // player) means "can't actually reach them" just as much as being too
    // far away - keep approaching instead of freezing into an attack that
    // should be impossible through solid geometry.
    if (dist > this.config.meleeRange || !this._hasLineOfSight(playerPos, solidMeshes)) {
      this._tryMove(nx * this.effectiveSpeed * dt, nz * this.effectiveSpeed * dt, colliders)
      this.group.rotation.y = Math.atan2(nx, nz)
    } else if (performance.now() >= this.attackCooldownUntil) {
      this.attackCooldownUntil = performance.now() + this.config.attackCooldown * 1000
      this.attackAnimUntil = performance.now() + 260
      const weakened = performance.now() < this.weakenedUntil
      const damage = (this.config.damageMin + Math.random() * (this.config.damageMax - this.config.damageMin)) *
        (weakened ? DEFAULT_WEAKEN_MULT : 1) * (this.isElite ? ELITE_DAMAGE_MULT : 1)
      if (onAttack) onAttack(damage)
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
        const damage = (this.config.damageMin + this.config.damageMax) / 2 * BOSS_SPECIAL_DAMAGE_MULT * falloff
        if (onAttack) onAttack(damage)
      }
      this.specialCooldownUntil = now + BOSS_SPECIAL_COOLDOWN_MS
      this.attackCooldownUntil = now + this.config.attackCooldown * 1000
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
      this._tryMove(nx * this.effectiveSpeed * dt, nz * this.effectiveSpeed * dt, colliders)
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
      this._tryMove(nx * this.effectiveSpeed * dt, nz * this.effectiveSpeed * dt, colliders)
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

  // Blocked line of sight (a wall/floor between here and the player) means
  // melee can't land even if the nominal 3D distance says "in range" - see
  // _updateMelee. No solidMeshes passed skips the check (treated as clear).
  _hasLineOfSight(playerPos, solidMeshes) {
    if (!solidMeshes || solidMeshes.length === 0) return true
    this._losOrigin.copy(this.group.position)
    this._losOrigin.y += 1.0 * this.config.scale
    this._losDir.copy(playerPos).sub(this._losOrigin)
    const dist = this._losDir.length()
    if (dist < 0.001) return true
    this._losDir.normalize()
    this._losRaycaster.set(this._losOrigin, this._losDir)
    this._losRaycaster.far = dist - 0.15 // stop just short of the player so their own body isn't a false hit
    const hits = this._losRaycaster.intersectObjects(solidMeshes, true)
    return hits.length === 0
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

  _animate(elapsed) {
    if (this.isBoss && this._animateBossTelegraph(elapsed)) return

    const t = elapsed * this.effectiveSpeed * 2.2 + this.phase

    // UV weapon tell: eyes wash violet while weakened, so the effect reads
    // clearly instead of only being felt through slower movement/damage.
    const weak = performance.now() < this.weakenedUntil
    for (const mat of this.eyeMaterials) {
      mat.emissive.setHex(weak ? 0x8b2fe0 : 0xd8e8ff)
      mat.emissiveIntensity = weak ? 2.2 : 1.5
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

  onHit(damage) {
    if (this.state !== 'alive' && this.state !== 'popping') return
    this.health = Math.max(0, this.health - damage)
    this.staggerUntil = performance.now() + 200

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
      if (this.config.explodes || this.config.explodeOnDeath) {
        this.pendingExplosion = true
      } else {
        this.state = 'dying'
        this.dieStartedAt = performance.now()
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

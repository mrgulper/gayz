// Animals out in the open world (2026-10-18, Gaymi: "make animals (pets)
// spawn naturally around the world", and picked all three of: peaceful
// wanderers, hunted for food, tamed as pets). Owned by BuildSurvival
// (`s.animals`), stepped from its update():
//
//   - cows, pigs, sheep and chickens appear in small groups on dry land
//     around you (up to MAX_WILD at a time) and wander about, pausing to
//     stand; ones left far behind go, so new ones keep turning up ahead;
//   - shoot or hit one and it runs away; killed, it drops Meat (a little
//     spinning item you walk over, PlayDrops) - click with it held to heal;
//   - press Use (E) while looking at one to tame it: it gets a red collar,
//     follows you (catching up if left far behind), is never hurt by your
//     shots and never goes away until the game ends.
// Zombies leave animals alone. Blocky models made from boxes, sizes like
// the real animals (smaller than a player). Meshes only, never a light;
// geometries and materials are shared per kind and never flashed.
import * as THREE from 'three'
import { t } from './i18n.js'

export const MAX_WILD = 12
const SPAWN_EVERY_S = 1.5
const SPAWN_MIN = 24 // blocks from you
const SPAWN_MAX = 56
const DESPAWN = 110
const WALK = 1.1 // blocks per second
const RUN = 4
const FLEE_S = 4
const TAME_REACH = 4.5
const PET_NEAR = 3 // a pet stops this close to you
const PET_TELEPORT = 30
const DIE_S = 0.9

// Body sizes in blocks: w (side to side), h (height), l (length), leg
// height; head size; colors; health; meat dropped.
const KINDS = {
  cow: { body: [0.9, 0.75, 1.4], leg: 0.55, head: [0.6, 0.6, 0.5], colors: { body: 0x5a3b26, spots: 0xf2eee6, head: 0x5a3b26, snout: 0xd8b49a, leg: 0x3a281a }, health: 50, meat: 2, chance: 0.3 },
  pig: { body: [0.75, 0.6, 1.0], leg: 0.35, head: [0.6, 0.55, 0.55], colors: { body: 0xeda3a3, spots: 0xe08f92, head: 0xeda3a3, snout: 0xd27a80, leg: 0xe08f92 }, health: 40, meat: 2, chance: 0.27 },
  sheep: { body: [0.85, 0.75, 1.2], leg: 0.5, head: [0.45, 0.5, 0.5], colors: { body: 0xeeeeea, spots: 0xdcdcd6, head: 0xc9b9a0, snout: 0xb8a68a, leg: 0xc9b9a0 }, health: 40, meat: 1, chance: 0.25 },
  chicken: { body: [0.4, 0.42, 0.5], leg: 0.3, head: [0.26, 0.34, 0.26], colors: { body: 0xf6f4ee, spots: 0xe8e4da, head: 0xf6f4ee, snout: 0xf0a020, leg: 0xf0a020 }, health: 20, meat: 1, chance: 0.18 },
}
const KIND_IDS = Object.keys(KINDS)
const NAME_KEYS = { cow: 'animalCow', pig: 'animalPig', sheep: 'animalSheep', chicken: 'animalChicken' }

// An 8x8 pixel texture: the base color with a few patches, so the boxes
// read as blocky fur/skin rather than flat plastic.
function patchTexture(base, spots, seed) {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`
  g.fillRect(0, 0, 8, 8)
  g.fillStyle = `#${spots.toString(16).padStart(6, '0')}`
  let r = seed
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 9; i++) g.fillRect(Math.floor(rand() * 8), Math.floor(rand() * 8), 1 + Math.floor(rand() * 2), 1)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class PlayAnimals {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._spawnIn = 0
    this._parts = {}
  }

  get bm() {
    return this.s.bm
  }

  // Shared boxes and materials for one kind (made once).
  _kindParts(kind) {
    if (this._parts[kind]) return this._parts[kind]
    const k = KINDS[kind]
    const B = this.s.B
    const mat = (color, tex) => new THREE.MeshLambertMaterial({ color: tex ? 0xffffff : color, map: tex || null })
    const box = (w, h, l) => new THREE.BoxGeometry(w * B, h * B, l * B)
    const [bw, bh, bl] = k.body
    const [hw, hh, hl] = k.head
    const legW = kind === 'chicken' ? 0.07 : Math.min(0.25, bw * 0.3)
    const p = {
      body: box(bw, bh, bl),
      head: box(hw, hh, hl),
      snout: box(hw * 0.55, hh * 0.35, kind === 'chicken' ? 0.12 : 0.12),
      leg: box(legW, k.leg, legW),
      collar: box(hw * 1.08, 0.08, hl * 0.5),
      bodyMat: mat(k.colors.body, patchTexture(k.colors.body, k.colors.spots, kind.length * 97)),
      headMat: mat(k.colors.head, patchTexture(k.colors.head, k.colors.spots, kind.length * 131)),
      snoutMat: mat(k.colors.snout),
      legMat: mat(k.colors.leg),
      eyeMat: mat(0x161616),
      eye: box(0.07, 0.07, 0.02),
      collarMat: mat(0xc0282a),
      legW,
    }
    this._parts[kind] = p
    return p
  }

  _build(kind) {
    const k = KINDS[kind]
    const p = this._kindParts(kind)
    const B = this.s.B
    const [bw, bh, bl] = k.body
    const [hw, hh, hl] = k.head
    const group = new THREE.Group()
    const body = new THREE.Mesh(p.body, p.bodyMat)
    body.position.y = (k.leg + bh / 2) * B
    group.add(body)
    // Head at the front (+z), a little above the body's middle.
    const head = new THREE.Group()
    head.position.set(0, (k.leg + bh * (kind === 'chicken' ? 0.95 : 0.75)) * B, (bl / 2 + hl * 0.35) * B)
    head.add(new THREE.Mesh(p.head, p.headMat))
    const snout = new THREE.Mesh(p.snout, p.snoutMat)
    snout.position.set(0, -hh * 0.18 * B, (hl / 2 + 0.05) * B)
    head.add(snout)
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(p.eye, p.eyeMat)
      eye.position.set(side * hw * 0.3 * B, hh * 0.15 * B, (hl / 2 + 0.01) * B)
      head.add(eye)
    }
    const collar = new THREE.Mesh(p.collar, p.collarMat)
    collar.position.set(0, -hh * 0.5 * B, -hl * 0.15 * B)
    collar.visible = false
    head.add(collar)
    group.add(head)
    // Four legs (two for a chicken), turning at the hip.
    const legs = []
    const spots = kind === 'chicken' ? [[-0.1, 0], [0.1, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (bw / 2 - p.legW / 2), sz * (bl / 2 - p.legW)])
    for (const [lx, lz] of spots) {
      const hip = new THREE.Group()
      hip.position.set(lx * B, k.leg * B, lz * B)
      const leg = new THREE.Mesh(p.leg, p.legMat)
      leg.position.y = (-k.leg / 2) * B
      hip.add(leg)
      group.add(hip)
      legs.push(hip)
    }
    return { group, head, legs, collar }
  }

  // --- each frame ---

  update(dt) {
    const bm = this.bm
    if (!bm.world?.active) return
    const s = this.s
    const here = bm.tryMode.pos // spawning follows the camera too (spectating)
    const me = s.bodyPos()
    this._spawnIn -= dt
    const wild = this.list.filter((a) => !a.tamed && !a.dying)
    if (this._spawnIn <= 0 && wild.length < MAX_WILD) {
      this._spawnIn = SPAWN_EVERY_S
      this._spawnGroup(here)
    }
    for (const a of [...this.list]) {
      if (a.dying) {
        a.dieT += dt
        a.group.rotation.z = Math.min(1, a.dieT / 0.35) * (Math.PI / 2)
        if (a.dieT > DIE_S) this._remove(a)
        continue
      }
      if (!a.tamed && Math.hypot(a.x - here.x, a.z - here.z) > DESPAWN) {
        this._remove(a)
        continue
      }
      this._step(a, dt, me)
    }
  }

  _step(a, dt, me) {
    const s = this.s
    const B = s.B
    let speed = 0
    const dx = me.x - a.x
    const dz = me.z - a.z
    const dist = Math.hypot(dx, dz)
    if (a.tamed) {
      if (dist > PET_TELEPORT) {
        // Left far behind: catches up at once, just behind you.
        a.x = me.x - (dx / dist) * 2
        a.z = me.z - (dz / dist) * 2
        a.y = s._groundUnder(a.x, me.y + 3, a.z)
      } else if (dist > PET_NEAR) {
        a.heading = Math.atan2(dx, dz)
        speed = dist > 8 ? RUN : WALK * 2
      }
    } else if (a.flee > 0) {
      a.flee -= dt
      a.heading = Math.atan2(-dx, -dz) + Math.sin(a.flee * 3) * 0.4
      speed = RUN
    } else {
      a.think -= dt
      if (a.think <= 0) {
        a.think = 2 + Math.random() * 4
        a.walking = Math.random() < 0.6
        if (a.walking) a.heading = Math.random() * Math.PI * 2
      }
      if (a.walking) speed = WALK
    }
    if (speed > 0) {
      const nx = a.x + Math.sin(a.heading) * speed * dt
      const nz = a.z + Math.cos(a.heading) * speed * dt
      const ground = s._groundUnder(nx, a.y + 1.1, nz)
      const wet = this.bm._cellIsLiquid(Math.floor(nx), Math.floor(ground + 0.01), Math.floor(nz))
      if (ground > a.y + 1.05 || ground < a.y - 3 || wet) {
        // A wall, a drop or water: turn and try another way.
        a.heading += Math.PI * (0.5 + Math.random())
        a.think = Math.min(a.think, 0.5)
      } else {
        a.x = nx
        a.z = nz
        a.groundY = ground
      }
    } else a.groundY = s._groundUnder(a.x, a.y + 0.5, a.z)
    // Falls, or steps up onto the next block.
    a.y += (a.groundY - a.y) * Math.min(1, dt * (a.groundY > a.y ? 14 : 8))
    a.walk += dt * speed * 5
    const swing = speed > 0 ? Math.sin(a.walk) * 0.7 : 0
    a.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? 1 : -1) * swing })
    // Turns smoothly toward where it's going; a hit makes it jolt.
    let turn = a.heading - a.group.rotation.y
    turn = Math.atan2(Math.sin(turn), Math.cos(turn))
    a.group.rotation.y += turn * Math.min(1, dt * 8)
    a.hurt = Math.max(0, a.hurt - dt)
    a.group.rotation.x = -a.hurt * 1.2
    a.head.rotation.x = speed === 0 && !a.tamed ? Math.max(0, Math.sin(a.walk * 0.1 + a.seed)) * 0.5 : 0
    a.group.position.set(a.x * B, a.y * B, a.z * B)
  }

  // A small group of one kind somewhere on dry land a way off.
  _spawnGroup(p) {
    const s = this.s
    let r = Math.random()
    let kind = KIND_IDS[0]
    for (const id of KIND_IDS) {
      if (r < KINDS[id].chance) {
        kind = id
        break
      }
      r -= KINDS[id].chance
    }
    const ang = Math.random() * Math.PI * 2
    const d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN)
    const cx = p.x + Math.cos(ang) * d
    const cz = p.z + Math.sin(ang) * d
    const n = 1 + Math.floor(Math.random() * 3)
    let made = 0
    for (let i = 0; i < n && this.list.length < MAX_WILD + 20; i++) {
      const x = cx + (Math.random() - 0.5) * 6
      const z = cz + (Math.random() - 0.5) * 6
      const y = s._groundUnder(x, p.y + 24, z)
      if (Math.abs(y - p.y) > 24) continue
      // Not in water, and room to stand.
      if (this.bm._cellIsLiquid(Math.floor(x), Math.floor(y + 0.01), Math.floor(z))) continue
      if (this.bm.getBlockAt(Math.floor(x), Math.floor(y + 0.01), Math.floor(z))) continue
      this.spawn(kind, x, y, z)
      made++
    }
    return made
  }

  spawn(kind, x, y, z) {
    const k = KINDS[kind]
    const built = this._build(kind)
    const a = {
      kind, x, y, z, groundY: y, heading: Math.random() * Math.PI * 2, think: Math.random() * 2,
      walking: false, walk: 0, flee: 0, hurt: 0, health: k.health, tamed: false, dying: false, dieT: 0,
      seed: Math.random() * 6, ...built,
    }
    a.group.rotation.y = a.heading
    a.group.position.set(x * this.s.B, y * this.s.B, z * this.s.B)
    this.bm.scene.add(a.group)
    this.list.push(a)
    return a
  }

  _remove(a) {
    a.group.removeFromParent()
    const i = this.list.indexOf(a)
    if (i >= 0) this.list.splice(i, 1)
  }

  // --- shots, throws and taming ---

  _box(a, box) {
    const k = KINDS[a.kind]
    const B = this.s.B
    const half = Math.max(k.body[0], k.body[2]) / 2
    box.min.set((a.x - half) * B, a.y * B, (a.z - half) * B)
    box.max.set((a.x + half) * B, (a.y + k.leg + k.body[1] + k.head[1] * 0.5) * B, (a.z + half) * B)
    return box
  }

  // The nearest animal on a ray (world units), within maxDist.
  _onRay(ray, maxDist, { wildOnly = false } = {}) {
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = maxDist
    for (const a of this.list) {
      if (a.dying || (wildOnly && a.tamed)) continue
      if (!ray.intersectBox(this._box(a, box), hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = a
      }
    }
    return best
  }

  // A shot or a thrown knife: true if it hit an animal (pets are never hurt).
  hitRay(ray, maxDist, damage) {
    const a = this._onRay(ray, maxDist, { wildOnly: true })
    if (!a) return false
    this.damage(a, damage)
    return true
  }

  damage(a, amount) {
    if (a.dying || a.tamed) return
    a.health -= amount
    a.hurt = 0.25
    a.flee = FLEE_S
    if (a.health > 0) return
    a.dying = true
    a.legs.forEach((leg) => { leg.rotation.x = 0 })
    // Meat pops out where it fell.
    for (let i = 0; i < KINDS[a.kind].meat; i++) this.s._drops?.spawnItem('meat', Math.floor(a.x), a.y, Math.floor(a.z))
  }

  // The Use key on an animal you're looking at: tamed.
  use() {
    const bm = this.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const a = this._onRay(bm._raycaster.ray, TAME_REACH * this.s.B, { wildOnly: true })
    if (!a) return false
    a.tamed = true
    a.flee = 0
    a.collar.visible = true
    this.s._message(t('animalTamed', { name: t(NAME_KEYS[a.kind]) }))
    return true
  }

  clear() {
    for (const a of [...this.list]) this._remove(a)
    this._spawnIn = 0
  }
}

// Animals out in the open world (2026-10-18, Gaymi: "make animals (pets)
// spawn naturally around the world", and picked all three of: peaceful
// wanderers, hunted for food, tamed as pets). Owned by BuildSurvival
// (`s.animals`), stepped from its update():
//
//   - animals that fit the biome (BIOME_ANIMALS: farm animals on the
//     plains, polar bears and penguins in the snow, camels in the desert,
//     giraffes on the savanna...) appear in small groups on dry land
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
import { sampleLand, inCity } from './OpenWorld.js'

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
// height; head size; colors; health; meat dropped. Optional: legs (2 or
// 4), legW, headAt ([y, z] of the head's middle), speed (x WALK/RUN),
// stripes (the body picture is striped, not patchy), and extras - more
// boxes on the 'body' (x, y, z from the feet) or the 'head' (from its
// middle), in a color or 'body' for the body's own picture.
const HORSE = { body: [0.7, 0.75, 1.5], leg: 0.9, head: [0.35, 0.4, 0.7], headAt: [1.95, 0.95], health: 60, meat: 2 }
const horseExtras = (mane) => [
  { on: 'body', size: [0.35, 0.7, 0.4], at: [0, 1.6, 0.6], color: 'body' },
  { on: 'body', size: [0.12, 0.75, 0.3], at: [0, 1.75, 0.5], color: mane },
  { on: 'body', size: [0.12, 0.6, 0.12], at: [0, 1.25, -0.8], color: mane },
]
const FOX = { body: [0.4, 0.38, 0.75], leg: 0.3, head: [0.38, 0.34, 0.34], headAt: [0.7, 0.5], health: 20, meat: 1 }
const foxExtras = (fur, tip) => [
  { on: 'head', size: [0.1, 0.14, 0.06], at: [-0.11, 0.22, -0.06], color: fur },
  { on: 'head', size: [0.1, 0.14, 0.06], at: [0.11, 0.22, -0.06], color: fur },
  { on: 'body', size: [0.18, 0.18, 0.5], at: [0, 0.55, -0.6], color: fur },
  { on: 'body', size: [0.19, 0.19, 0.12], at: [0, 0.55, -0.88], color: tip },
]
const pair = (on, size, [x, y, z], color) => [{ on, size, at: [-x, y, z], color }, { on, size, at: [x, y, z], color }]
const KINDS = {
  cow: { body: [0.9, 0.75, 1.4], leg: 0.55, head: [0.6, 0.6, 0.5], colors: { body: 0x5a3b26, spots: 0xf2eee6, head: 0x5a3b26, snout: 0xd8b49a, leg: 0x3a281a }, health: 50, meat: 2 },
  pig: { body: [0.75, 0.6, 1.0], leg: 0.35, head: [0.6, 0.55, 0.55], colors: { body: 0xeda3a3, spots: 0xe08f92, head: 0xeda3a3, snout: 0xd27a80, leg: 0xe08f92 }, health: 40, meat: 2 },
  sheep: { body: [0.85, 0.75, 1.2], leg: 0.5, head: [0.45, 0.5, 0.5], colors: { body: 0xeeeeea, spots: 0xdcdcd6, head: 0xc9b9a0, snout: 0xb8a68a, leg: 0xc9b9a0 }, health: 40, meat: 1 },
  chicken: { body: [0.4, 0.42, 0.5], leg: 0.3, legs: 2, legW: 0.07, head: [0.26, 0.34, 0.26], headAt: [0.7, 0.33], colors: { body: 0xf6f4ee, spots: 0xe8e4da, head: 0xf6f4ee, snout: 0xf0a020, leg: 0xf0a020 }, health: 20, meat: 1 },
  horse: { ...HORSE, colors: { body: 0x8a5a33, spots: 0x7a4e2c, head: 0x8a5a33, snout: 0x5e3e24, leg: 0x6b4528 }, extras: horseExtras(0x2b1d12) },
  zebra: { ...HORSE, stripes: true, colors: { body: 0xf2f2ee, spots: 0x1c1c1c, head: 0xf2f2ee, snout: 0x1c1c1c, leg: 0xe6e6e0 }, extras: horseExtras(0x1c1c1c) },
  deer: {
    body: [0.55, 0.6, 1.1], leg: 0.8, head: [0.35, 0.38, 0.45], headAt: [1.75, 0.68], health: 40, meat: 2,
    colors: { body: 0xa0703f, spots: 0xc9a57a, head: 0xa0703f, snout: 0x3a2a1e, leg: 0x7d5530 },
    extras: [
      { on: 'body', size: [0.25, 0.5, 0.3], at: [0, 1.45, 0.5], color: 'body' },
      ...pair('head', [0.06, 0.4, 0.06], [0.12, 0.38, -0.05], 0xd9c7a1),
      ...pair('head', [0.2, 0.06, 0.06], [0.2, 0.46, -0.05], 0xd9c7a1),
      { on: 'body', size: [0.12, 0.15, 0.1], at: [0, 1.3, -0.58], color: 0xf0e8dc },
    ],
  },
  rabbit: {
    body: [0.32, 0.3, 0.45], leg: 0.12, legW: 0.08, head: [0.26, 0.26, 0.26], headAt: [0.5, 0.25], health: 10, meat: 1, speed: 1.3,
    colors: { body: 0xb39a7c, spots: 0xd8c8b0, head: 0xb39a7c, snout: 0xe8b0b0, leg: 0xb39a7c },
    extras: [...pair('head', [0.07, 0.28, 0.05], [0.07, 0.25, -0.04], 0xb39a7c), { on: 'body', size: [0.12, 0.12, 0.1], at: [0, 0.32, -0.26], color: 0xf4f0ea }],
  },
  wolf: {
    body: [0.5, 0.5, 1.0], leg: 0.5, head: [0.45, 0.42, 0.4], headAt: [1.05, 0.62], health: 40, meat: 1,
    colors: { body: 0x8f8f8f, spots: 0xb5b5b5, head: 0x9a9a9a, snout: 0x5a5a5a, leg: 0x7d7d7d },
    extras: [...pair('head', [0.12, 0.15, 0.08], [0.12, 0.27, -0.08], 0x7d7d7d), { on: 'body', size: [0.12, 0.12, 0.5], at: [0, 0.85, -0.7], color: 0x8f8f8f }],
  },
  fox: { ...FOX, colors: { body: 0xd9762b, spots: 0xf2e6d8, head: 0xd9762b, snout: 0xf2e6d8, leg: 0x3a2a22 }, extras: foxExtras(0xd9762b, 0xf2e6d8) },
  arcticFox: { ...FOX, colors: { body: 0xeef2f5, spots: 0xd6dde3, head: 0xeef2f5, snout: 0xd6dde3, leg: 0xc8d0d8 }, extras: foxExtras(0xeef2f5, 0x3a3a3a) },
  polarBear: {
    body: [0.95, 0.9, 1.6], leg: 0.6, head: [0.55, 0.5, 0.55], headAt: [1.2, 0.98], health: 70, meat: 3, speed: 0.8,
    colors: { body: 0xf1efe6, spots: 0xe2ded0, head: 0xf1efe6, snout: 0xe2ded0, leg: 0xe2ded0 },
    extras: [...pair('head', [0.12, 0.12, 0.06], [0.2, 0.28, -0.1], 0xf1efe6), { on: 'head', size: [0.12, 0.08, 0.04], at: [0, -0.04, 0.4], color: 0x1e1e1e }],
  },
  penguin: {
    body: [0.45, 0.7, 0.4], leg: 0.12, legs: 2, legW: 0.1, head: [0.36, 0.3, 0.34], headAt: [0.98, 0.05], health: 15, meat: 1, speed: 0.6,
    colors: { body: 0x1d1f26, spots: 0x2a2d36, head: 0x1d1f26, snout: 0xf0a020, leg: 0xf0a020 },
    extras: [{ on: 'body', size: [0.32, 0.55, 0.05], at: [0, 0.45, 0.2], color: 0xf4f2ec }, ...pair('body', [0.06, 0.45, 0.25], [0.25, 0.5, 0], 0x1d1f26)],
  },
  goat: {
    body: [0.6, 0.6, 0.95], leg: 0.55, head: [0.35, 0.42, 0.42], headAt: [1.25, 0.6], health: 40, meat: 2,
    colors: { body: 0xe8e3d6, spots: 0xcfc7b4, head: 0xe8e3d6, snout: 0xcfc7b4, leg: 0xcfc7b4 },
    extras: [...pair('head', [0.08, 0.3, 0.08], [0.1, 0.32, -0.12], 0x8a7f6a), { on: 'head', size: [0.1, 0.18, 0.06], at: [0, -0.28, 0.18], color: 0xcfc7b4 }],
  },
  camel: {
    body: [0.75, 0.8, 1.6], leg: 1.0, head: [0.35, 0.35, 0.6], headAt: [2.2, 1.2], health: 60, meat: 2, speed: 0.9,
    colors: { body: 0xc9a063, spots: 0xb88f55, head: 0xc9a063, snout: 0xa67d48, leg: 0xb88f55 },
    extras: [
      { on: 'body', size: [0.3, 0.8, 0.35], at: [0, 1.85, 0.95], color: 'body' },
      { on: 'body', size: [0.5, 0.35, 0.45], at: [0, 1.95, 0.3], color: 'body' },
      { on: 'body', size: [0.5, 0.35, 0.45], at: [0, 1.95, -0.3], color: 'body' },
    ],
  },
  lizard: {
    body: [0.3, 0.16, 0.6], leg: 0.1, legW: 0.08, head: [0.22, 0.14, 0.25], headAt: [0.18, 0.4], health: 8, meat: 1, speed: 1.4,
    colors: { body: 0x7a8f3a, spots: 0x5e7030, head: 0x7a8f3a, snout: 0x6a7f30, leg: 0x5e7030 },
    extras: [{ on: 'body', size: [0.12, 0.1, 0.55], at: [0, 0.15, -0.56], color: 0x6a7f30 }],
  },
  giraffe: {
    body: [0.7, 0.8, 1.3], leg: 1.4, head: [0.3, 0.35, 0.55], headAt: [3.55, 0.95], health: 60, meat: 2, speed: 0.9,
    colors: { body: 0xe0b060, spots: 0x9a5f2a, head: 0xe0b060, snout: 0xc9984c, leg: 0xe0b060 },
    extras: [{ on: 'body', size: [0.3, 1.6, 0.3], at: [0, 2.85, 0.72], color: 'body' }, ...pair('head', [0.06, 0.15, 0.06], [0.08, 0.24, -0.12], 0x6a4020)],
  },
  panda: {
    body: [0.85, 0.75, 1.3], leg: 0.45, head: [0.55, 0.5, 0.5], headAt: [1.0, 0.82], health: 60, meat: 2, speed: 0.7,
    colors: { body: 0xf0efea, spots: 0xe4e3de, head: 0xf0efea, snout: 0xf0efea, leg: 0x1e1e1e },
    extras: [
      { on: 'body', size: [0.87, 0.77, 0.35], at: [0, 0.825, 0.35], color: 0x1e1e1e },
      ...pair('head', [0.14, 0.14, 0.08], [0.2, 0.28, -0.05], 0x1e1e1e),
      ...pair('head', [0.15, 0.15, 0.02], [0.165, 0.075, 0.255], 0x1e1e1e),
    ],
  },
  parrot: {
    body: [0.3, 0.4, 0.3], leg: 0.12, legs: 2, legW: 0.06, head: [0.24, 0.24, 0.24], headAt: [0.62, 0.1], health: 8, meat: 1,
    colors: { body: 0xd8262a, spots: 0xb81e22, head: 0xd8262a, snout: 0x3a3a3a, leg: 0x5a5a5a },
    extras: [...pair('body', [0.05, 0.32, 0.22], [0.17, 0.32, -0.02], 0x2a6fd0), { on: 'body', size: [0.12, 0.06, 0.3], at: [0, 0.22, -0.25], color: 0xf0c020 }],
  },
  frog: {
    body: [0.4, 0.22, 0.45], leg: 0.08, legW: 0.1, head: [0.38, 0.18, 0.25], headAt: [0.3, 0.26], health: 6, meat: 1,
    colors: { body: 0x5f9a3a, spots: 0x4a7d2c, head: 0x5f9a3a, snout: 0x4a7d2c, leg: 0x4a7d2c },
    extras: pair('head', [0.11, 0.1, 0.11], [0.12, 0.12, 0.02], 0x5f9a3a),
  },
  crab: {
    body: [0.55, 0.22, 0.4], leg: 0.15, legW: 0.06, head: [0.3, 0.1, 0.1], headAt: [0.32, 0.2], health: 8, meat: 1,
    colors: { body: 0xd4502a, spots: 0xb8401f, head: 0xd4502a, snout: 0xb8401f, leg: 0xb8401f },
    extras: pair('body', [0.14, 0.12, 0.18], [0.33, 0.25, 0.25], 0xd4502a),
  },
  turtle: {
    body: [0.7, 0.3, 0.8], leg: 0.12, head: [0.24, 0.2, 0.26], headAt: [0.25, 0.5], health: 30, meat: 1, speed: 0.4,
    colors: { body: 0x5a7a3a, spots: 0x3f5a28, head: 0x8fae5a, snout: 0x8fae5a, leg: 0x8fae5a },
    extras: [{ on: 'body', size: [0.55, 0.12, 0.65], at: [0, 0.48, 0], color: 0x4a6a30 }],
  },
}
// Which animals live in each biome, with how often each turns up
// (2026-10-23, Gaymi: a cow in the snowy mountains is wrong). Map 1's city
// and the plains get the farm animals; the open sea gets none.
const FARM = { cow: 3, pig: 2, sheep: 2, chicken: 2, horse: 1.5 }
export const BIOME_ANIMALS = {
  city: FARM,
  plains: FARM,
  forest: { pig: 2, chicken: 1, deer: 2, rabbit: 1, fox: 1 },
  birchForest: { deer: 2, rabbit: 2, chicken: 1 },
  darkForest: { wolf: 2, deer: 1 },
  cherryGrove: { rabbit: 2, sheep: 2, deer: 1 },
  taiga: { wolf: 2, fox: 2, deer: 1, rabbit: 1 },
  snowyTaiga: { wolf: 1, arcticFox: 2, polarBear: 1 },
  snowyPlains: { polarBear: 1, arcticFox: 2 },
  iceSpikes: { polarBear: 1, penguin: 2 },
  snowyBeach: { penguin: 3, polarBear: 1 },
  frozenOcean: { penguin: 2, polarBear: 1 },
  desert: { camel: 2, lizard: 2 },
  badlands: { lizard: 2, goat: 1 },
  savanna: { zebra: 2, giraffe: 2 },
  jungle: { parrot: 3, frog: 1 },
  bambooJungle: { panda: 3, parrot: 1 },
  swamp: { frog: 3, turtle: 1 },
  mangroveSwamp: { frog: 2, turtle: 2 },
  mushroomFields: { cow: 1, rabbit: 1 },
  mountains: { goat: 3, sheep: 1 },
  snowyPeaks: { goat: 2 },
  beach: { crab: 3, turtle: 2 },
  warmOcean: { turtle: 1, crab: 1 },
  river: { frog: 1 },
  ocean: {},
  deepOcean: {},
}
const nameKey = (kind) => `animal${kind[0].toUpperCase()}${kind.slice(1)}`

// An 8x8 pixel texture: the base color with a few patches, so the boxes
// read as blocky fur/skin rather than flat plastic.
function patchTexture(base, spots, seed, stripes = false) {
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const g = c.getContext('2d')
  g.fillStyle = `#${base.toString(16).padStart(6, '0')}`
  g.fillRect(0, 0, 8, 8)
  g.fillStyle = `#${spots.toString(16).padStart(6, '0')}`
  let r = seed
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280)
  if (stripes) for (let x = 0; x < 8; x += 2) g.fillRect(x, 0, 1, 8)
  else for (let i = 0; i < 9; i++) g.fillRect(Math.floor(rand() * 8), Math.floor(rand() * 8), 1 + Math.floor(rand() * 2), 1)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class PlayAnimals {
  // For tests.
  static BIOME_ANIMALS = BIOME_ANIMALS
  static KINDS = KINDS

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
    const legW = k.legW || Math.min(0.25, bw * 0.3)
    const bodyMat = mat(k.colors.body, patchTexture(k.colors.body, k.colors.spots, kind.length * 97, k.stripes))
    const colorMats = new Map()
    const p = {
      body: box(bw, bh, bl),
      head: box(hw, hh, hl),
      snout: box(hw * 0.55, hh * 0.35, 0.12),
      leg: box(legW, k.leg, legW),
      collar: box(hw * 1.08, 0.08, hl * 0.5),
      bodyMat,
      headMat: mat(k.colors.head, patchTexture(k.colors.head, k.colors.spots, kind.length * 131)),
      snoutMat: mat(k.colors.snout),
      legMat: mat(k.colors.leg),
      eyeMat: mat(0x161616),
      eye: box(0.07, 0.07, 0.02),
      collarMat: mat(0xc0282a),
      legW,
      // Extra boxes (ears, tails, necks, horns...), same order as k.extras.
      extras: (k.extras || []).map((e) => {
        if (e.color !== 'body' && !colorMats.has(e.color)) colorMats.set(e.color, mat(e.color))
        return { geo: box(...e.size), mat: e.color === 'body' ? bodyMat : colorMats.get(e.color) }
      }),
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
    const [headY, headZ] = k.headAt || [k.leg + bh * 0.75, bl / 2 + hl * 0.35]
    head.position.set(0, headY * B, headZ * B)
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
    ;(k.extras || []).forEach((e, i) => {
      const m = new THREE.Mesh(p.extras[i].geo, p.extras[i].mat)
      m.position.set(e.at[0] * B, e.at[1] * B, e.at[2] * B)
      ;(e.on === 'head' ? head : group).add(m)
    })
    // Four legs (two for birds), turning at the hip.
    const legs = []
    const spots = k.legs === 2 ? [[-bw * 0.25, 0], [bw * 0.25, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (bw / 2 - p.legW / 2), sz * (bl / 2 - p.legW)])
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
    speed *= KINDS[a.kind].speed || 1
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

  // Which kind turns up at a spot: one that lives in its biome (null on
  // the open sea).
  kindAt(x, z) {
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    const table = BIOME_ANIMALS[inCity(fx, fz) ? 'city' : sampleLand(fx, fz).biome] || {}
    const ids = Object.keys(table)
    let r = Math.random() * ids.reduce((sum, id) => sum + table[id], 0)
    for (const id of ids) {
      r -= table[id]
      if (r < 0) return id
    }
    return ids[0] || null
  }

  // A small group of one kind somewhere on dry land a way off.
  _spawnGroup(p) {
    const s = this.s
    const ang = Math.random() * Math.PI * 2
    const d = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN)
    const cx = p.x + Math.cos(ang) * d
    const cz = p.z + Math.sin(ang) * d
    const kind = this.kindAt(cx, cz)
    if (!kind) return 0
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
    const top = Math.max(k.leg + k.body[1], (k.headAt ? k.headAt[0] : k.leg + k.body[1] * 0.75) + k.head[1] / 2)
    box.max.set((a.x + half) * B, (a.y + top) * B, (a.z + half) * B)
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
    this.s._message(t('animalTamed', { name: t(nameKey(a.kind)) }))
    return true
  }

  clear() {
    for (const a of [...this.list]) this._remove(a)
    this._spawnIn = 0
  }
}

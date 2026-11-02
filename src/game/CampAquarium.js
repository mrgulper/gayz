// The camp's Aquarium (2026-11-02, Gaymi's idea list 5, quick wins: "a
// tank at camp showing fish you've caught while Fishing, rare ones
// glowing"). Owned by BuildCamp (`camp.aquarium`), only in Play.
//
// - Every Fish and Golden Fish you reel in (Fishing.js) is counted for
//   good (AQUARIUM_KEY, so Cloud Save carries it like the Zombie Book).
// - A glass tank on a wooden stand against a camp wall, next to the Trophy
//   Room: one little fish swims in it for every fish caught (up to
//   MAX_FISH), and the golden ones glow (up to MAX_GOLDEN). A sign says
//   how many you've caught; an empty tank says to go fishing.
// - Built from its own meshes (nothing in the map changes); each player
//   sees their own. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { findWallStrip, makeLabel } from './CampTrophies.js'

export const AQUARIUM_KEY = 'gayz-aquarium'
export const MAX_FISH = 14
export const MAX_GOLDEN = 6
const WIDE = 5
const DEEP = 2
// The trophy booth's width (CampTrophies WIDE), kept clear.
const TROPHY_WIDE = 8
const TANK = { w: 4.2, h: 1.6, d: 1.3, y: 1 }

// { fish, golden } caught so far. Never trusted when read back.
export function loadAquarium() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(AQUARIUM_KEY) || 'null')
  } catch {
    d = null
  }
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(1e6, Math.floor(Number(v))) : 0)
  return { fish: n(d?.fish), golden: n(d?.golden) }
}

// A Fish or Golden Fish was caught (Fishing.js) - once per catch, never per frame.
export function recordFish(id) {
  const a = loadAquarium()
  if (id === 'goldenFish') a.golden++
  else if (id === 'fish') a.fish++
  else return
  try {
    localStorage.setItem(AQUARIUM_KEY, JSON.stringify(a))
  } catch {
    // Full storage: it's just not remembered.
  }
}

export class CampAquarium {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.fish = []
    this._t = 0
  }

  build(trophySpot) {
    if (this.group) return
    const avoid = trophySpot ? [{ x: trophySpot.x, z: trophySpot.z, wide: TROPHY_WIDE }] : []
    this.spot = findWallStrip(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    const B = this.camp.B
    const g = new THREE.Group()
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    const zMid = DEEP / 2
    // Facing +z (into the camp) before it's turned. The stand, then the tank.
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4423 })
    box(TANK.w + 0.3, TANK.y, TANK.d + 0.3, wood, 0, TANK.y / 2, zMid)
    const sand = new THREE.MeshLambertMaterial({ color: 0xd9c27a })
    box(TANK.w, 0.15, TANK.d, sand, 0, TANK.y + 0.075, zMid)
    const water = new THREE.MeshLambertMaterial({ color: 0x3a8cd8, transparent: true, opacity: 0.35, depthWrite: false })
    box(TANK.w, TANK.h - 0.2, TANK.d, water, 0, TANK.y + 0.15 + (TANK.h - 0.2) / 2, zMid)
    const frame = new THREE.MeshLambertMaterial({ color: 0x2b2016 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, TANK.h, 0.08, frame, sx * TANK.w / 2, TANK.y + TANK.h / 2, zMid + sz * TANK.d / 2)
    box(TANK.w + 0.08, 0.08, TANK.d + 0.08, frame, 0, TANK.y + TANK.h, zMid)
    // Some weed.
    const weed = new THREE.MeshLambertMaterial({ color: 0x3f8a3a })
    for (const [x, h] of [[-1.6, 0.9], [-1.3, 0.6], [1.5, 1.0], [0.4, 0.5]]) box(0.1, h, 0.1, weed, x, TANK.y + 0.15 + h / 2, zMid - 0.3)
    // The fish.
    const a = loadAquarium()
    const n = Math.min(MAX_FISH, a.fish)
    const gold = Math.min(MAX_GOLDEN, a.golden)
    this.fish = []
    for (let i = 0; i < n + gold; i++) {
      const golden = i >= n
      const color = golden ? 0xffcf3a : [0xf08a3a, 0x5aa7d8, 0xe8443a, 0xb8f06a][i % 4]
      const mat = new THREE.MeshLambertMaterial({ color, emissive: golden ? 0x6b4a00 : 0 })
      const f = new THREE.Group()
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.32 * B, 0.18 * B, 0.08 * B), mat)
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, 0.16 * B, 0.04 * B), mat)
      tail.position.x = -0.2 * B
      f.add(body, tail)
      g.add(f)
      this.fish.push({ mesh: f, tail, phase: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.5, y: 0.25 + Math.random() * 0.9, z: (Math.random() - 0.5) * (TANK.d - 0.4) })
    }
    const sign = makeLabel(t('aquariumSign'), 512, 44, '#bfe6ff')
    sign.scale.set(2.6 * B, 0.5 * B, 1)
    sign.position.set(0, (TANK.y + TANK.h + 0.9) * B, zMid * B)
    g.add(sign)
    const count = makeLabel(a.fish + a.golden ? t('aquariumCount', { n: a.fish, g: a.golden }) : t('aquariumEmpty'), 512, 34, '#ffffff')
    count.scale.set(2.8 * B, 0.36 * B, 1)
    count.position.set(0, (TANK.y + TANK.h + 0.4) * B, zMid * B)
    g.add(count)
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // Every frame (BuildCamp.update): the fish swim back and forth.
  update(dt) {
    if (!this.group || !this.fish.length) return
    this._t += dt
    const B = this.camp.B
    const half = TANK.w / 2 - 0.3
    for (const f of this.fish) {
      const p = this._t * f.speed + f.phase
      const x = Math.sin(p) * half
      f.mesh.position.set(x * B, (TANK.y + 0.15 + f.y + Math.sin(p * 2.3) * 0.05) * B, (DEEP / 2 + f.z) * B)
      // Faces the way it's swimming.
      f.mesh.rotation.y = Math.cos(p) >= 0 ? 0 : Math.PI
      f.tail.rotation.y = Math.sin(this._t * 8 + f.phase) * 0.5
    }
  }

  dispose() {
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      o.material.map?.dispose?.()
      o.material.dispose()
    })
    this.group = null
    this.fish = []
  }
}

// The camp's Zombie Zoo (2026-11-02, Gaymi's idea list 6: "a fenced pen
// where the zombies you've caught walk around, like the Trophy Room and
// Aquarium"). Owned by BuildCamp (`camp.zoo`), only in Play.
//
// - A fenced grass pen against a camp wall, past the Trophy Room and the
//   Aquarium. Up to MAX_ZOO of the zombies you've caught with Catch Traps
//   (Creatures.js, newest first) shamble about in it, each with its name
//   over its head in its rarity's colour. Boss zombies are bigger.
// - A sign says how many zombies you've caught; an empty pen says to go
//   catch some.
// - Built from its own meshes (nothing in the map changes); each player
//   sees their own. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { findWallStrip, makeLabel } from './CampTrophies.js'
import { loadCreatures, creatureName, tierColor } from './Creatures.js'
import { zombieModel } from './TeamBattle.js'

export const MAX_ZOO = 8
const WIDE = 8
const DEEP = 5
const WALK = 0.7 // blocks/s

export class CampZoo {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.zombies = []
  }

  // avoid: the Trophy Room's and Aquarium's spots ({ x, z, wide }).
  build(avoid = []) {
    if (this.group) return
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
    // Facing +z (into the camp) before it's turned: the pen from z 0 to DEEP.
    const grass = new THREE.MeshLambertMaterial({ color: 0x5a8a3a })
    box(WIDE, 0.06, DEEP, grass, 0, 0.03, DEEP / 2)
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a4f2a })
    for (let x = -WIDE / 2; x <= WIDE / 2 + 0.01; x += 1) {
      box(0.14, 1.3, 0.14, wood, x, 0.65, 0.1)
      box(0.14, 1.3, 0.14, wood, x, 0.65, DEEP - 0.1)
    }
    for (let z = 1; z < DEEP; z += 1) for (const x of [-WIDE / 2, WIDE / 2]) box(0.14, 1.3, 0.14, wood, x, 0.65, z)
    for (const y of [0.45, 1.05]) {
      box(WIDE, 0.1, 0.08, wood, 0, y, 0.1)
      box(WIDE, 0.1, 0.08, wood, 0, y, DEEP - 0.1)
      for (const x of [-WIDE / 2, WIDE / 2]) box(0.08, 0.1, DEEP, wood, x, y, DEEP / 2)
    }
    // The zombies.
    const caught = loadCreatures().list.filter((c) => c.t === 'z').sort((a, b) => (b.at || 0) - (a.at || 0))
    this.zombies = []
    for (const c of caught.slice(0, MAX_ZOO)) {
      const m = zombieModel(c)
      m.group.scale.multiplyScalar(B)
      const tag = makeLabel(creatureName(c), 256, 30, tierColor(c.r))
      tag.scale.set(1.4, 0.2, 1)
      tag.position.y = 2.25
      m.group.add(tag)
      g.add(m.group)
      const zb = { ...m, x: (Math.random() - 0.5) * (WIDE - 1.4), z: 0.8 + Math.random() * (DEEP - 1.6), goal: null, walk: Math.random() * 6, wait: Math.random() * 2 }
      this.zombies.push(zb)
    }
    const sign = makeLabel(t('zooSign'), 512, 44, '#b8f06a')
    sign.scale.set(2.6 * B, 0.5 * B, 1)
    sign.position.set(0, 2.9 * B, 0.2 * B)
    g.add(sign)
    const count = makeLabel(caught.length ? t('zooCount', { n: caught.length }) : t('zooEmpty'), 512, 34, '#ffffff')
    count.scale.set(3.2 * B, 0.4 * B, 1)
    count.position.set(0, 2.4 * B, 0.2 * B)
    g.add(count)
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // Every frame (BuildCamp.update): they wander about the pen.
  update(dt) {
    if (!this.group) return
    const B = this.camp.B
    for (const zb of this.zombies) {
      if (zb.wait > 0) {
        zb.wait -= dt
      } else {
        if (!zb.goal) zb.goal = { x: (Math.random() - 0.5) * (WIDE - 1.4), z: 0.8 + Math.random() * (DEEP - 1.6) }
        const dx = zb.goal.x - zb.x
        const dz = zb.goal.z - zb.z
        const d = Math.hypot(dx, dz)
        if (d < 0.1) {
          zb.goal = null
          zb.wait = 1 + Math.random() * 3
        } else {
          const step = Math.min(d, WALK * dt)
          zb.x += (dx / d) * step
          zb.z += (dz / d) * step
          zb.group.rotation.y = Math.atan2(dx, dz)
          zb.walk += dt * 5
        }
      }
      const swing = zb.wait > 0 ? 0 : Math.sin(zb.walk) * 0.5
      zb.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing })
      zb.group.position.set(zb.x * B, 0.06 * B, zb.z * B)
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
    this.zombies = []
  }
}

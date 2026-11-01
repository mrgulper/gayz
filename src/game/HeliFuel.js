// Helicopter Escape's fuel cans (2026-10-31, Gaymi's idea list 2: "a
// helicopter escape mode" - the old Zombie Extraction, upgraded with
// "fuel + real flight"). Owned by BuildSurvival (`survival.fuel`), only in
// the zombieExtraction mode:
//
// - Once the first wave is on and the zombies' path field reaches far
//   enough, FUEL_CANS red cans appear on open, reachable ground
//   FUEL_MIN..FUEL_MAX blocks of walking from you, spread apart, each with
//   a yellow beam over the roofs (and a dot on the minimap).
// - Walk into one (FUEL_REACH) to pick it up. With all of them the
//   helicopter is called: it flies in (BuildSurvival._placeExtraction),
//   you hold its landing ring, then climb aboard and it takes off.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { FUEL_CANS, FUEL_MIN, FUEL_MAX, FUEL_REACH, FUEL_GAP } from './PlayRules.js'

export class HeliFuel {
  constructor(survival) {
    this.s = survival
    this.cans = [] // { x, y, z, group, beam }
    this.got = 0
    this.placed = false
  }

  get B() {
    return this.s.B
  }

  get done() {
    return this.got >= FUEL_CANS
  }

  // Tries to put the cans out (needs the path field). -> true once placed.
  place() {
    if (this.placed) return true
    const s = this.s
    if (!s._flow || s._flow.size < 50) return false
    const spots = []
    for (const [key, d] of s._flow) {
      if (d < FUEL_MIN || d > FUEL_MAX) continue
      const [x, y, z] = s._cellOf(key)
      if (s.camp?.inside(x + 0.5, z + 0.5, 2)) continue
      // Something to stand in: the cell and the one above are open.
      if (s.bm.getBlockAt(x, y, z) || s.bm.getBlockAt(x, y + 1, z)) continue
      spots.push([x, y, z])
    }
    if (spots.length < FUEL_CANS) return false
    // Spread apart: each next can as far as possible from the ones placed.
    const picked = [spots[Math.floor(Math.random() * spots.length)]]
    while (picked.length < FUEL_CANS) {
      let best = null
      let bestD = -1
      for (let i = 0; i < 200; i++) {
        const c = spots[Math.floor(Math.random() * spots.length)]
        const d = Math.min(...picked.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2])))
        if (d > bestD) {
          bestD = d
          best = c
        }
        if (d >= FUEL_GAP) break
      }
      picked.push(best)
    }
    for (const [x, y, z] of picked) this.cans.push(this._can(x + 0.5, y, z + 0.5))
    this.placed = true
    s._message(t('fuelPlaced', { n: FUEL_CANS }), 5)
    s._renderHud()
    return true
  }

  // A red jerry can with a yellow cap, and a beam you see from afar.
  _can(x, y, z) {
    const B = this.B
    const group = new THREE.Group()
    group.position.set(x * B, y * B, z * B)
    const red = new THREE.MeshLambertMaterial({ color: 0xc8261c })
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a1010 })
    const cap = new THREE.MeshLambertMaterial({ color: 0xffd23a, emissive: 0x553300 })
    const can = new THREE.Group()
    const box = (w, h, d, mat, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(px * B, py * B, pz * B)
      can.add(m)
    }
    box(0.5, 0.65, 0.22, red, 0, 0.36, 0)
    box(0.3, 0.06, 0.06, dark, -0.05, 0.74, 0)
    box(0.08, 0.12, 0.08, cap, 0.17, 0.74, 0)
    box(0.52, 0.04, 0.24, dark, 0, 0.36, 0)
    group.add(can)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 * B, 0.18 * B, 30 * B, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    beam.position.y = 15 * B
    group.add(beam)
    this.s.bm.scene.add(group)
    return { x, y, z, group, can, beam }
  }

  // Nearest can still out there, in blocks (null if none).
  nearest() {
    const p = this.s.bm.tryMode.pos
    let best = null
    for (const c of this.cans) {
      const d = Math.hypot(c.x - p.x, c.z - p.z)
      if (best === null || d < best) best = d
    }
    return best
  }

  update(dt) {
    if (!this.placed || this.done) return
    const s = this.s
    const p = s.bm.tryMode.pos
    const now = performance.now()
    let changed = false
    for (const c of [...this.cans]) {
      c.can.rotation.y += dt * 1.5
      c.can.position.y = (0.08 + Math.sin(now / 300 + c.x) * 0.06) * this.B
      c.beam.material.opacity = 0.18 + 0.1 * Math.sin(now / 250)
      if (s.dead || Math.hypot(c.x - p.x, c.z - p.z) > FUEL_REACH || Math.abs(c.y - p.y) > 2) continue
      this._drop(c)
      this.cans = this.cans.filter((o) => o !== c)
      this.got++
      changed = true
      try { audioEngine.playLevelUp?.() } catch { /* no audio */ }
      if (this.done) {
        s._message(t('fuelAll'), 4)
        s._placeExtraction()
      } else s._message(t('fuelGot', { n: this.got, m: FUEL_CANS }), 3)
    }
    // The distance on the top bar, kept fresh as you walk.
    const d = Math.round(this.nearest() ?? 0)
    if (changed || d !== this._shownD) {
      this._shownD = d
      s._renderHud()
    }
  }

  _drop(c) {
    c.group.removeFromParent()
    c.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }

  clear() {
    for (const c of this.cans) this._drop(c)
    this.cans = []
    this.got = 0
    this.placed = false
    this._shownD = null
  }
}

// The camp's Plaza (2026-11-06, Gaymi's idea list 8): one booth along a
// camp wall holding four stations, each opened with the Use key:
//
// - the Zombie Newspaper's newsstand (Newspaper.js),
// - the Lost & Found box (LostFound.js),
// - the Camp Arcade's Pinball machine and Chess table (CampArcade.js).
//
// Owned by BuildCamp (`camp.plaza`), only in Play, built from its own
// meshes (nothing in the map changes) on the first free wall strip clear
// of the other booths. Walk up to a station: a prompt says what Use does.
// Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { findWallStrip, makeLabel } from './CampTrophies.js'
import { openNewspaper } from './Newspaper.js'
import { openLostFound, loadLost } from './LostFound.js'
import { openPinball, openChess } from './CampArcade.js'

export const WIDE = 8
const DEEP = 2
const USE_R = 1.7

// [id, a (along the wall), sign color]
const STATIONS = [
  ['news', -2.7, '#fff4c8'],
  ['lost', -0.9, '#ffd9a8'],
  ['pinball', 0.9, '#ff9ae6'],
  ['chess', 2.7, '#d8f0ff'],
]

export class CampPlaza {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.stations = []
  }

  get B() {
    return this.camp.B
  }

  build(avoid = []) {
    if (this.group) return
    this.spot = findWallStrip(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z, emissive = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // The booth: a back wall and a striped awning.
    box(WIDE, 3, 0.2, 0x6a4a2c, 0, 1.5, 0.1)
    for (let i = 0; i < WIDE; i++) box(1, 0.16, DEEP + 0.3, i % 2 ? 0xf2efe6 : 0x2e8a7a, -WIDE / 2 + 0.5 + i, 3.05, DEEP / 2)
    const sign = makeLabel(t('plazaSign'), 512, 44, '#ffe9a8')
    sign.scale.set(3.4 * B, 0.6 * B, 1)
    sign.position.set(0, 3.6 * B, (DEEP + 0.2) * B)
    g.add(sign)
    // Newsstand: a rack with a stack of papers.
    box(1.2, 1, 0.6, 0x3a5a8a, -2.7, 0.5, 0.6)
    box(1.0, 0.08, 0.5, 0xf4f0e2, -2.7, 1.04, 0.6)
    box(1.0, 0.6, 0.06, 0xf4f0e2, -2.7, 1.5, 0.32)
    // Lost & Found: a wooden crate with a lid.
    box(1.1, 0.8, 0.8, 0x9a6a3a, -0.9, 0.4, 0.7)
    box(1.2, 0.1, 0.9, 0x6a4422, -0.9, 0.85, 0.7)
    box(0.5, 0.2, 0.05, 0xffe08a, -0.9, 0.5, 1.12)
    // Pinball: a tilted glowing table on legs, with a back box.
    box(0.9, 0.12, 1.4, 0xd03aa0, 0.9, 0.95, 0.85, 0x2a0020)
    for (const [dx, dz] of [[-0.35, 0.3], [0.35, 0.3], [-0.35, 1.4], [0.35, 1.4]]) box(0.1, 0.9, 0.1, 0x222222, 0.9 + dx, 0.45, dz)
    box(0.9, 0.9, 0.2, 0x2a1840, 0.9, 1.5, 0.2, 0x1a0030)
    // Chess: a little table with a checkered top and two stools.
    box(1.0, 0.75, 1.0, 0x5a3a20, 2.7, 0.375, 0.8)
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) box(0.22, 0.03, 0.22, (i + j) % 2 ? 0x222222 : 0xeeeeee, 2.7 - 0.33 + i * 0.22, 0.765, 0.8 - 0.33 + j * 0.22)
    box(0.4, 0.45, 0.4, 0x7a5030, 2.7, 0.225, 1.65)
    this.stations = STATIONS.map(([id, a, color]) => {
      const lab = makeLabel(t(`plaza_${id}`), 384, 40, color)
      lab.scale.set(1.6 * B, 0.3 * B, 1)
      lab.position.set(a * B, 2.35 * B, 0.9 * B)
      g.add(lab)
      // Where you stand to use it, in world blocks.
      const c = Math.cos(this.spot.rot)
      const sn = Math.sin(this.spot.rot)
      const lz = 1.6
      return { id, x: this.spot.x + a * c + lz * sn, z: this.spot.z - a * sn + lz * c }
    })
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // The station you're at (closest within USE_R).
  near() {
    if (!this.group) return null
    const p = this.camp.bm.tryMode.pos
    let best = null
    let bestD = USE_R
    for (const st of this.stations) {
      const d = Math.hypot(p.x - st.x, p.z - st.z)
      if (d < bestD && p.y < 3) {
        bestD = d
        best = st
      }
    }
    return best
  }

  // Use (BuildCamp.use). -> true when a station opened.
  use() {
    const st = this.near()
    if (!st) return false
    const s = this.camp.s
    // What it opened, kept for a test to look at.
    if (st.id === 'news') this.last = openNewspaper(s)
    else if (st.id === 'lost') this.last = openLostFound(s)
    else if (st.id === 'pinball') this.last = openPinball(s)
    else if (st.id === 'chess') this.last = openChess(s)
    return true
  }

  prompt(st) {
    if (st.id === 'lost') return t('plazaPrompt_lost', { n: loadLost().reduce((a, it) => a + it.n, 0) })
    return t(`plazaPrompt_${st.id}`)
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
    this.stations = []
    this.spot = null
  }
}

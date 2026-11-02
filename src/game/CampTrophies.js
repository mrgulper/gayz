// The camp's Trophy Room (2026-11-01, Gaymi's idea list 4: "trophy room",
// "both" - this and the Profile's Trophies tab, Trophies.js). Owned by
// BuildCamp (`camp.trophies`), only in Play.
//
// - An open-front booth against one of the camp walls: a back wall, a
//   roof with a "Trophy Room" sign, and two shelves with a cup for every
//   trophy - bronze, silver, gold, or dark grey while it's still locked.
// - Walk up close and look at a cup: its name and tier float over it.
// - Built from its own meshes (nothing in the map changes), on the first
//   strip along the walls with nothing in the way (after the camp farm's
//   Crop Plots are back). Each player sees their own trophies, on a server too.
import * as THREE from 'three'
import { t } from './i18n.js'
import { TIER_COLORS, TIER_NAMES, trophyList } from './Trophies.js'

// The booth along the wall (cells) and how far it reaches into the camp.
const WIDE = 8
const DEEP = 2
// A cup's label shows this close (blocks), for the cup nearest the middle
// of the screen (within LOOK_NDC of it).
const LABEL_NEAR = 5
const LOOK_NDC = 0.6
const PER_SHELF = 8

export class CampTrophies {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.labels = []
    this.spot = null
  }

  get B() {
    return this.camp.B
  }

  // The first free strip: along the back wall first (opposite the gate),
  // then the sides, then the gate's own wall. -> { x, z, rot } or null.
  _findSpot() {
    const zn = this.camp.zone
    const s = this.camp.s
    const npcs = Object.values(zn.npcSpots || {}).filter(Boolean)
    const free = (cells) => cells.every(([x, z]) => {
      for (let y = 0; y < 3; y++) if (s._solid(x, y, z)) return false
      return !npcs.some(([nx, nz]) => Math.abs(nx - x) <= 1 && Math.abs(nz - z) <= 1)
    })
    // Each wall: cells along it (a, fixed b) and which way is into the camp.
    const walls = {
      zmax: { along: 'x', lo: zn.x0 + 2, hi: zn.x1 - 2, at: zn.z1 - 1, into: -1, rot: Math.PI },
      zmin: { along: 'x', lo: zn.x0 + 2, hi: zn.x1 - 2, at: zn.z0 + 1, into: 1, rot: 0 },
      xmax: { along: 'z', lo: zn.z0 + 2, hi: zn.z1 - 2, at: zn.x1 - 1, into: -1, rot: -Math.PI / 2 },
      xmin: { along: 'z', lo: zn.z0 + 2, hi: zn.z1 - 2, at: zn.x0 + 1, into: 1, rot: Math.PI / 2 },
    }
    const back = { zmin: 'zmax', zmax: 'zmin', xmin: 'xmax', xmax: 'xmin' }[zn.facade] || 'zmax'
    const order = [back, ...Object.keys(walls).filter((w) => w !== back && w !== zn.facade), zn.facade].filter((w) => walls[w])
    for (const name of order) {
      const w = walls[name]
      const mid = Math.floor((w.lo + w.hi) / 2)
      // From the middle of the wall outwards.
      for (let i = 0; i <= w.hi - w.lo; i++) {
        const a0 = mid + (i % 2 ? -1 : 1) * Math.ceil(i / 2) - Math.floor(WIDE / 2)
        if (a0 < w.lo || a0 + WIDE - 1 > w.hi) continue
        const cells = []
        for (let a = a0; a < a0 + WIDE; a++) for (let d = 0; d < DEEP; d++) {
          const b = w.at + w.into * d
          cells.push(w.along === 'x' ? [a, b] : [b, a])
        }
        if (!free(cells)) continue
        // The booth's middle, at the wall side of its strip.
        const a = a0 + WIDE / 2
        const b = w.at + (w.into > 0 ? 0 : 1)
        return w.along === 'x' ? { x: a, z: b, rot: w.rot } : { x: b, z: a, rot: w.rot }
      }
    }
    return null
  }

  build() {
    if (this.group) return
    this.spot = this._findSpot()
    if (!this.spot) return
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z, emissive = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, emissive }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // Facing +z (into the camp) before it's turned: the back wall at z ~ 0.
    const wood = 0x7a4f2a
    const dark = 0x4e3218
    box(WIDE, 3, 0.2, 0x5b3a1e, 0, 1.5, 0.1)
    box(0.2, 3, DEEP, wood, -WIDE / 2 + 0.1, 1.5, DEEP / 2)
    box(0.2, 3, DEEP, wood, WIDE / 2 - 0.1, 1.5, DEEP / 2)
    box(WIDE + 0.4, 0.2, DEEP + 0.4, 0x8c2a22, 0, 3.1, DEEP / 2)
    // The shelves.
    for (const y of [0.55, 1.6]) box(WIDE - 0.5, 0.12, 0.7, dark, 0, y, 0.55)
    // The sign over the front.
    const sign = makeLabel(t('trophyRoomSign'), 512, 44, '#ffe9a8')
    sign.scale.set(3.2 * B, 0.6 * B, 1)
    sign.position.set(0, 3.6 * B, (DEEP + 0.2) * B)
    g.add(sign)
    this.labels = []
    const list = trophyList(this.camp.bm.game || {})
    list.forEach((tr, i) => {
      const row = Math.floor(i / PER_SHELF)
      const col = i % PER_SHELF
      const across = Math.min(PER_SHELF, list.length - row * PER_SHELF)
      const x = (col - (across - 1) / 2) * ((WIDE - 1) / PER_SHELF)
      const y = row ? 0.61 : 1.66
      const color = TIER_COLORS[tr.tier]
      const shine = tr.tier === 3 ? 0x3a2a00 : 0
      // A blocky cup: base, stem, bowl, two handles.
      box(0.4, 0.08, 0.3, 0x2b2016, x, y + 0.04, 0.55)
      box(0.08, 0.2, 0.08, color, x, y + 0.18, 0.55, shine)
      box(0.34, 0.26, 0.3, color, x, y + 0.41, 0.55, shine)
      box(0.06, 0.16, 0.06, color, x - 0.21, y + 0.44, 0.55, shine)
      box(0.06, 0.16, 0.06, color, x + 0.21, y + 0.44, 0.55, shine)
      const label = makeLabel(`${tr.name} · ${t(TIER_NAMES[tr.tier])}`, 512, 40, tr.tier ? '#ffffff' : '#bbbbbb')
      label.scale.set(2.4 * B, 0.33 * B, 1)
      label.position.set(x * B, (y + 0.78) * B, 0.6 * B)
      label.visible = false
      g.add(label)
      this.labels.push(label)
    })
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // Every frame (BuildCamp.update): the label of the cup you look at.
  update(me) {
    if (!this.group) return
    const near = Math.hypot(me.x - this.spot.x, me.z - this.spot.z) < LABEL_NEAR + WIDE / 2
    let pick = null
    if (near) {
      const cam = this.camp.bm.camera
      const v = this._v || (this._v = new THREE.Vector3())
      let best = LOOK_NDC
      for (const l of this.labels) {
        l.getWorldPosition(v).project(cam)
        const d = Math.hypot(v.x, v.y)
        if (v.z < 1 && d < best) {
          best = d
          pick = l
        }
      }
    }
    if (pick === this._shown) return
    if (this._shown) this._shown.visible = false
    if (pick) pick.visible = true
    this._shown = pick
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
    this.labels = []
    this._shown = null
  }
}

// Words on a see-through sprite, outlined so they read on anything.
function makeLabel(text, w, px, color) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = Math.round(px * 1.8)
  const ctx = c.getContext('2d')
  ctx.font = `bold ${px}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(4, px / 5)
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.strokeText(text, w / 2, c.height / 2, w - 8)
  ctx.fillStyle = color
  ctx.fillText(text, w / 2, c.height / 2, w - 8)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
}

// Settings > Controls > Gameplay > Loot Glow (idea 56, 2026-11-11; the
// other Gameplay settings are in GameplayAssist.js). Owned by
// BuildSurvival (`lootMarks`), updated every frame of a game.
import * as THREE from 'three'
import { isRareItem } from './PlayInventory.js'

const SCAN_EVERY_S = 1
const SCAN_R = 16 // blocks round you
const SCAN_Y = 8
const MAX_MARKS = 12
const BEAM_H = 9 // blocks
const CHEST_COLOR = 0xffd34d
const DROP_COLOR = 0x8fd8ff

let glowTex = null
function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,0.9)')
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

// Glows (and, with Beams, a tall see-through column) on Loot Chests you
// haven't opened this wave and on rare items lying on the ground. Meshes
// only, never a light.
export class LootMarks {
  constructor(survival) {
    this.s = survival
    this.marks = []
    this.found = []
    this.scanIn = 0
    this.t = 0
  }

  _mats() {
    if (this.mats) return this.mats
    const beam = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    const glow = (color) => new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })
    this.mats = { chest: { beam: beam(CHEST_COLOR), glow: glow(CHEST_COLOR) }, drop: { beam: beam(DROP_COLOR), glow: glow(DROP_COLOR) } }
    return this.mats
  }

  _mark(i) {
    if (this.marks[i]) return this.marks[i]
    if (!this.beamGeo) {
      this.beamGeo = new THREE.CylinderGeometry(0.14, 0.14, 1, 10, 1, true)
      this.beamGeo.translate(0, 0.5, 0)
    }
    const m = this._mats()
    const mark = { beam: new THREE.Mesh(this.beamGeo, m.chest.beam), glow: new THREE.Sprite(m.chest.glow) }
    mark.beam.renderOrder = mark.glow.renderOrder = 5
    mark.beam.frustumCulled = false
    this.s.bm.scene.add(mark.beam, mark.glow)
    this.marks[i] = mark
    return mark
  }

  _scan(p) {
    const bm = this.s.bm
    const out = []
    const cx = Math.floor(p.x)
    const cy = Math.floor(p.y)
    const cz = Math.floor(p.z)
    for (let x = cx - SCAN_R; x <= cx + SCAN_R; x++) {
      for (let z = cz - SCAN_R; z <= cz + SCAN_R; z++) {
        for (let y = cy - SCAN_Y; y <= cy + SCAN_Y; y++) {
          if (bm._blocks.get(`${x},${y},${z}`) === 'lootchest') out.push([x, y, z])
        }
      }
    }
    return out
  }

  update(dt) {
    const s = this.s
    const mode = s.bm.game?.settings?.lootHighlight || 'off'
    if (mode === 'off' || s.dead || !s.active) return this.hide()
    const p = s.bodyPos()
    this.scanIn -= dt
    if (this.scanIn <= 0) {
      this.scanIn = SCAN_EVERY_S
      this.found = this._scan(p)
    }
    const spots = []
    for (const [x, y, z] of this.found) {
      if (s._chestsUsed?.has(`${x},${y},${z}`)) continue
      spots.push({ kind: 'chest', x: x + 0.5, y: y + 1, z: z + 0.5 })
    }
    for (const d of s._drops?.list || []) {
      if (d.kind === 'item' && this._rare(d.type)) spots.push({ kind: 'drop', x: d.x, y: d.y, z: d.z })
    }
    for (const o of spots) o.d = Math.hypot(o.x - p.x, o.z - p.z)
    spots.sort((a, b) => a.d - b.d)
    this.t += dt
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 3)
    const B = s.B
    const m = this._mats()
    for (const k of ['chest', 'drop']) {
      m[k].beam.opacity = 0.28 * pulse
      m[k].glow.opacity = 0.8 * pulse
    }
    const n = Math.min(MAX_MARKS, spots.length)
    for (let i = 0; i < n; i++) {
      const o = spots[i]
      const mark = this._mark(i)
      mark.glow.material = m[o.kind].glow
      mark.glow.visible = true
      mark.glow.scale.setScalar((o.kind === 'chest' ? 1.6 : 1.1) * B)
      mark.glow.position.set(o.x * B, (o.kind === 'chest' ? o.y - 0.45 : o.y + 0.2) * B, o.z * B)
      mark.beam.visible = mode === 'beam'
      mark.beam.material = m[o.kind].beam
      mark.beam.position.set(o.x * B, (o.kind === 'chest' ? o.y - 1 : o.y) * B, o.z * B)
      mark.beam.scale.set(B, BEAM_H * B, B)
    }
    for (let i = n; i < this.marks.length; i++) this.marks[i].beam.visible = this.marks[i].glow.visible = false
    this.shown = n
  }

  _rare(id) {
    return isRareItem({ kind: 'item', id })
  }

  hide() {
    for (const mark of this.marks) mark.beam.visible = mark.glow.visible = false
    this.shown = 0
  }

  dispose() {
    for (const mark of this.marks) {
      mark.beam.removeFromParent()
      mark.glow.removeFromParent()
    }
    this.marks = []
    this.found = []
    this.shown = 0
  }
}

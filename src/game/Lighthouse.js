// The Lighthouse (2026-11-06, Gaymi's idea list 7: "sits on the coast, and
// its spinning beam lights up zombies and ships at night"). Owned by
// BuildSurvival (`s.lighthouse`), in the open world, in your own games (not
// a server guest's - like the Zombie Train).
//
// - Walking near the sea (SEA_LOOK), a red-and-white striped lighthouse
//   turns up on the shore NEAR..FAR blocks away (real blocks, put back when
//   the game ends - TempBlocks.js): a hollow tower TOWER_H tall with a
//   ladder up the inside, a railed balcony at the top and a glass lamp room.
//   Walk far away (MOVE_AT) and another coast gets the next one.
// - At night its lamp turns: a long beam of light sweeps round (one turn
//   every TURN_S seconds). Any zombie the beam passes over is lit up for
//   SPOT_S seconds - a glowing red marker over its head you can see from
//   far off - and a ghost pirate ship in the beam is called out.
// - Standing on the balcony, the beam lights up zombies for twice as long.
// Meshes only (the beam is a see-through cone), never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { TempBlocks } from './TempBlocks.js'

export const TOWER_H = 14
export const BEAM_L = 44
export const TURN_S = 8
export const SPOT_S = 6
const BEAM_HALF = 0.16 // radians either side of the beam
const SEA_LOOK = 36
const NEAR = 10
const FAR = 34
const MOVE_AT = 150
const CHECK_S = 4
const NIGHT = 0.45
const MARKS = 24

const isOcean = (x, z) => !inCity(Math.floor(x), Math.floor(z)) && /cean$/.test(sampleLand(Math.floor(x), Math.floor(z))?.biome || '')

export class Lighthouse {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.house = null // { x, y, z } - the tower's middle column and its floor
    this._check = 1
    this.angle = 0
    this._marks = []
  }

  get B() {
    return this.s.B
  }

  _allowed() {
    const s = this.s
    return !!s.bm.world?.active && !(s.net && !s.net.isHost) && !s.td && !s.escape && !s.party && !s.moon?.on
  }

  update(dt) {
    const s = this.s
    if (!this._allowed()) return
    const me = s.bodyPos()
    this._check -= dt
    if (this._check <= 0) {
      this._check = CHECK_S
      if (this.house && Math.hypot(me.x - this.house.x, me.z - this.house.z) > MOVE_AT) this.clear()
      if (!this.house) this._find(me)
    }
    if (!this.house) return
    const night = (s.bm.sky?.nightAmount?.() ?? 0) > NIGHT
    this.angle = (this.angle + (dt / TURN_S) * Math.PI * 2) % (Math.PI * 2)
    this._drawBeam(night)
    if (night) this._sweep()
    this._drawMarks()
  }

  // A shore spot: dry land with the open sea right beside it. -> built?
  _find(me) {
    const s = this.s
    let sea = false
    for (let i = 0; i < 8 && !sea; i++) {
      const a = (i / 8) * Math.PI * 2
      sea = isOcean(me.x + Math.cos(a) * SEA_LOOK, me.z + Math.sin(a) * SEA_LOOK)
    }
    if (!sea) return false
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d)
      const z = Math.floor(me.z + Math.sin(a) * d)
      if (isOcean(x, z) || s.camp?.inside?.(x + 0.5, z + 0.5, 4)) continue
      // The sea within 5 blocks on some side.
      const coast = [[5, 0], [-5, 0], [0, 5], [0, -5]].some(([dx, dz]) => isOcean(x + dx, z + dz))
      if (!coast) continue
      const y = this._flat(x, z, me.y)
      if (y === null) continue
      this.build(x, y, z)
      s._message(t('lighthouseNear'), 4)
      return true
    }
    return false
  }

  // The 3x3 base is dry and within a block of level -> its floor y, or null.
  _flat(x, z, nearY) {
    const s = this.s
    let lo = Infinity
    let hi = -Infinity
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const g = s._groundUnder(x + dx + 0.5, nearY + 20, z + dz + 0.5)
      if (g === nearY + 20) return null
      const top = s.bm.getBlockAt(x + dx, g - 1, z + dz)
      if (!top || top === 'water' || top === 'lava') return null
      lo = Math.min(lo, g)
      hi = Math.max(hi, g)
    }
    return hi - lo <= 1 ? hi : null
  }

  // x, z: the middle column; y: the first air cell over the ground.
  build(x, y, z) {
    const put = (dx, dy, dz, type) => this.cells.put(x + dx, y + dy, z + dz, type)
    const hole = (dx, dy, dz) => this.cells.clear(x + dx, y + dy, z + dz)
    // Clear room for it.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= TOWER_H + 4; dy++) hole(dx, dy, dz)
    // A stone foot, then the striped hollow tower (2 white, 2 red).
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      put(dx, -1, dz, 'stonebricks')
      if (!dx && !dz) continue
      for (let dy = 0; dy < TOWER_H; dy++) {
        // The door on the -z side.
        if (dz === -1 && !dx && dy < 2) continue
        put(dx, dy, dz, Math.floor(dy / 2) % 2 ? 'redconcrete' : 'whiteconcrete')
      }
    }
    // The ladder up the middle, through the balcony floor.
    for (let dy = 0; dy <= TOWER_H; dy++) put(0, dy, 0, 'ladder')
    // The balcony (5x5) with a rail, and the glass lamp room on it.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (dx || dz) put(dx, TOWER_H, dz, 'stonebricks')
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2
      if (edge) put(dx, TOWER_H + 1, dz, 'stonefence')
    }
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(dx, TOWER_H + 1, dz, 'glass')
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) put(dx, TOWER_H + 2, dz, 'glass')
    put(0, TOWER_H + 2, 0, 'sealantern')
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(dx, TOWER_H + 3, dz, 'redconcrete')
    this.house = { x: x + 0.5, y, z: z + 0.5 }
    this._meshes()
  }

  _meshes() {
    const B = this.B
    const g = new THREE.Group()
    // The beam: a long see-through cone lying on its side, pointing out
    // from the lamp; the group turns it.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(BEAM_HALF) * BEAM_L * B, BEAM_L * B, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }))
    cone.rotation.z = Math.PI / 2
    cone.position.x = (BEAM_L / 2) * B
    const beam = new THREE.Group()
    beam.add(cone)
    beam.position.set(this.house.x * B, (this.house.y + TOWER_H + 2.5) * B, this.house.z * B)
    g.add(beam)
    this._beam = beam
    this._group = g
    this.s.bm.scene.add(g)
  }

  _drawBeam(night) {
    if (!this._beam) return
    this._beam.visible = night
    // Group +x along the beam: turned by -angle about y.
    this._beam.rotation.y = -this.angle
  }

  // Is a spot (x, z) in the beam right now?
  inBeam(x, z) {
    const h = this.house
    const dx = x - h.x
    const dz = z - h.z
    const d = Math.hypot(dx, dz)
    if (d > BEAM_L || d < 1) return false
    let diff = Math.atan2(dz, dx) - this.angle
    diff = Math.atan2(Math.sin(diff), Math.cos(diff))
    return Math.abs(diff) < BEAM_HALF + 0.6 / d
  }

  // On the balcony?
  onTop(p) {
    const h = this.house
    return !!h && Math.abs(p.x - h.x) < 2.6 && Math.abs(p.z - h.z) < 2.6 && Math.abs(p.y - (h.y + TOWER_H + 1)) < 1.2
  }

  _sweep() {
    const s = this.s
    const long = this.onTop(s.bodyPos()) ? 2 : 1
    for (const zb of s.zombies || []) {
      if (zb.health <= 0 || !this.inBeam(zb.x, zb.z)) continue
      zb.spotted = SPOT_S * long
    }
    const ship = s.pirate?.ship
    if (ship && !this._shipSeen && this.inBeam(ship.x + 7, ship.z)) {
      this._shipSeen = true
      s._message(t('lighthouseShip'), 4)
    }
    if (!ship) this._shipSeen = false
  }

  // A glowing red diamond over every lit-up zombie (a small pool).
  _drawMarks() {
    const s = this.s
    const B = this.B
    let n = 0
    const now = performance.now() / 1000
    for (const zb of s.zombies || []) {
      if (!(zb.spotted > 0)) continue
      zb.spotted -= 1 / 60
      if (zb.health <= 0 || n >= MARKS) continue
      let m = this._marks[n]
      if (!m) {
        m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 * B), new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.85, depthTest: false }))
        m.renderOrder = 5
        this._group.add(m)
        this._marks.push(m)
      }
      m.visible = true
      m.position.set(zb.x * B, (zb.y + 2.6 * (zb.size || 1) + Math.sin(now * 4 + n) * 0.1) * B, zb.z * B)
      m.rotation.y = now * 2
      n++
    }
    for (let i = n; i < this._marks.length; i++) this._marks[i].visible = false
  }

  clear() {
    this.cells.restore()
    this._group?.removeFromParent()
    this._group?.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._group = null
    this._beam = null
    this._marks = []
    this.house = null
    this._shipSeen = false
    for (const zb of this.s.zombies || []) zb.spotted = 0
  }
}

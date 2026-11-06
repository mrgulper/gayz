// The camp's Treehouse (2026-11-06, Gaymi's idea list 7: "build a
// treehouse at camp, with a rope ladder you can pull up so zombies can't
// climb in"). Owned by BuildCamp (`camp.treehouse`), only in Play.
//
// - A big oak against a camp wall, clear of the Trophy Room, Aquarium, Zoo
//   and Lucky Wheel: a trunk up to a plank floor DECK_Y blocks up, railed
//   all round, with corner posts holding a leafy roof. Real blocks, put
//   back when the game ends (TempBlocks.js), so you can stand in it and
//   zombies path to it like anywhere else.
// - A ladder runs from the ground up through a hatch in the floor. Stand
//   by the hatch up top and press Use to pull the ladder up (the hatch
//   closes, a rolled-up rope lies beside it) - with no way up, zombies that
//   break into camp during a siege can't climb in. Use again lets it down.
// - The loot chest in the corner refills every wave, like any loot chest.
// Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findWallStrip } from './CampTrophies.js'
import { TempBlocks } from './TempBlocks.js'

export const DECK_Y = 6
const WIDE = 5
const DEEP = 5
const USE_R = 1.6

export class CampTreehouse {
  constructor(camp) {
    this.camp = camp
    this.cells = new TempBlocks(camp.s)
    this.spot = null
    this.up = false // the ladder pulled up?
  }

  get s() {
    return this.camp.s
  }

  // A cell in the booth's own frame (a: -2..2 along the wall, d: 0..4 out
  // from it) -> world { x, z } (whole blocks).
  _cell(a, d) {
    const sp = this.spot
    const c = Math.cos(sp.rot)
    const s = Math.sin(sp.rot)
    const lx = a
    const lz = d + 0.5
    return { x: Math.floor(sp.x + lx * c + lz * s), z: Math.floor(sp.z - lx * s + lz * c) }
  }

  build(avoid = []) {
    if (this.spot) return
    this.spot = findWallStrip(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    const s = this.s
    const g = this._cell(0, 2)
    this.y0 = s._groundUnder(g.x + 0.5, 20, g.z + 0.5)
    const put = (a, dy, d, type) => {
      const c = this._cell(a, d)
      this.cells.put(c.x, this.y0 + dy, c.z, type)
    }
    // The trunk, up through the middle of the floor to the roof.
    for (let dy = 0; dy <= DECK_Y + 3; dy++) put(0, dy, 2, 'oaklog')
    // The floor, with the hatch at the front.
    for (let a = -2; a <= 2; a++) for (let d = 0; d <= 4; d++) {
      if (a === 0 && d === 2) continue
      if (a === 0 && d === 4) continue
      put(a, DECK_Y, d, 'oakplanks')
    }
    // The rail round the edge (a gap over the hatch), corner posts, roof.
    for (let a = -2; a <= 2; a++) for (let d = 0; d <= 4; d++) {
      const edge = Math.abs(a) === 2 || d === 0 || d === 4
      if (!edge || (a === 0 && d === 4)) continue
      const corner = Math.abs(a) === 2 && (d === 0 || d === 4)
      if (corner) for (let dy = 1; dy <= 3; dy++) put(a, DECK_Y + dy, d, 'oaklog')
      else put(a, DECK_Y + 1, d, 'oakfence')
    }
    for (let a = -2; a <= 2; a++) for (let d = 0; d <= 4; d++) put(a, DECK_Y + 4, d, 'leaves')
    for (let a = -1; a <= 1; a++) for (let d = 1; d <= 3; d++) put(a, DECK_Y + 5, d, 'leaves')
    put(-2 + 1, DECK_Y + 1, 1, 'lootchest')
    this._setLadder(false)
    this.hatch = this._cell(0, 4)
    this._rope()
  }

  _setLadder(up) {
    const s = this.s
    this.up = up
    const c = this._cell(0, 4)
    const undo = s.bm._suppressUndoRecording
    s.bm._suppressUndoRecording = true
    for (let dy = 0; dy <= DECK_Y; dy++) {
      const key = s.bm._key(c.x, this.y0 + dy, c.z)
      if (up) {
        // The ladder goes; the hatch closes.
        if (dy === DECK_Y) this.cells.put(c.x, this.y0 + dy, c.z, 'oakplanks')
        else this.cells.back(key)
      } else this.cells.put(c.x, this.y0 + dy, c.z, 'ladder')
    }
    s.bm._suppressUndoRecording = undo
    if (this._coil) this._coil.visible = up
  }

  // A coil of rope beside the hatch, shown while the ladder's up.
  _rope() {
    const B = this.camp.B
    const c = this._cell(1, 4)
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.28 * B, 0.08 * B, 6, 14), new THREE.MeshLambertMaterial({ color: 0xc8a060 }))
    m.rotation.x = Math.PI / 2
    m.position.set((c.x + 0.5) * B, (this.y0 + DECK_Y + 1.08) * B, (c.z + 0.5) * B)
    m.visible = this.up
    this.camp.bm.scene.add(m)
    this._coil = m
  }

  // Up top, beside the hatch?
  near() {
    if (!this.spot || !this.hatch) return false
    const p = this.camp.bm.tryMode.pos
    return Math.hypot(p.x - (this.hatch.x + 0.5), p.z - (this.hatch.z + 0.5)) < USE_R && Math.abs(p.y - (this.y0 + DECK_Y + 1)) < 1.2
  }

  // The Use key (BuildCamp.use). -> true if it was the ladder.
  use() {
    if (!this.near()) return false
    const s = this.s
    // Never pull it up while you're standing in the hatch.
    const p = this.camp.bm.tryMode.pos
    if (!this.up && Math.floor(p.x) === this.hatch.x && Math.floor(p.z) === this.hatch.z) {
      s._message(t('treehouseStepOff'), 2)
      return true
    }
    this._setLadder(!this.up)
    s._message(t(this.up ? 'treehouseUp' : 'treehouseDown'), 3)
    try { audioEngine.playSpecial?.('twang') } catch { /* no audio */ }
    return true
  }

  dispose() {
    this.cells.restore()
    this._coil?.removeFromParent()
    this._coil?.geometry.dispose()
    this._coil?.material.dispose()
    this._coil = null
    this.spot = null
    this.hatch = null
  }
}

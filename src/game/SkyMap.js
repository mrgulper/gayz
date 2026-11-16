// The minimap up in a sky arena (2026-11-16, Gaymi: "the map its the camp
// for deathmatch the map should always show the real map no matter what
// gamemode"). The game modes are built of real blocks high in the sky
// (Deathmatch's town, Duel Arena, Laser Tag, Kart...), and the minimap used
// to draw the land far below them - the camp. Now, while you stand over
// one (blocks under you with nothing but air under them), the minimap
// draws that arena from above instead: the top block of each column, a
// little lighter the higher it is.
//
// Only blocks the game placed (BuildSurvival `_placed`) are drawn, so it's
// cheap: the picture is made again only when they change.
import { BLOCK_TYPES } from './BuildMode.js'

const LOOK_DOWN = 20 // blocks under your feet a floor is looked for
const AIR_UNDER = 15 // ...with this much air under it
const BAND = 22 // blocks above the floor drawn
const REACH = 140 // blocks round you drawn at most
const CHECK_MS = 400
const MIN_COLUMNS = 40 // fewer than this: not an arena

let COLORS = null
function colorOf(type) {
  if (!COLORS) COLORS = new Map(BLOCK_TYPES.map((b) => [b.id, b.color]))
  return COLORS.get(type) ?? 0x8a8a86
}

export class SkyMap {
  constructor(bm) {
    this.bm = bm
    this._checkAt = 0
    this._floor = null
    this._layer = null
    this._key = ''
  }

  // The floor of a floating arena under (x, y, z), or null.
  _floatFloor(x, y, z) {
    const bm = this.bm
    const fx = Math.floor(x)
    const fz = Math.floor(z)
    const fy = Math.floor(y + 0.05)
    let low = null
    for (let yy = fy - 1; yy >= fy - LOOK_DOWN; yy--) if (bm.getBlockAt(fx, yy, fz)) low = yy
    if (low === null) return null
    for (let yy = low - 1; yy >= low - AIR_UNDER; yy--) if (bm.getBlockAt(fx, yy, fz)) return null
    return low
  }

  // { canvas, x0, z0, w, h } to draw for someone at (x, y, z), or null
  // (the usual map).
  layer(x, y, z, now) {
    const placed = this.bm.survival?.active ? this.bm.survival._placed : null
    if (!placed || !placed.size) return null
    if (now - this._checkAt > CHECK_MS) {
      this._checkAt = now
      const f = this._floatFloor(x, y, z)
      const l = this._layer
      // Over a gap or jumping (or waiting under it in a kill cam): keep
      // the arena while still within it.
      const within = l && this._floor !== null && x >= l.x0 - 2 && x <= l.x0 + l.w + 2 && z >= l.z0 - 2 && z <= l.z0 + l.h + 2 && Math.abs(y - this._floor) < 40
      this._floor = f ?? (within ? this._floor : null)
    }
    if (this._floor === null) return null
    const key = `${placed.size}|${this._floor}`
    if (key !== this._key || (this._layer && Math.hypot(x - (this._layer.x0 + this._layer.w / 2), z - (this._layer.z0 + this._layer.h / 2)) > REACH)) {
      this._key = key
      this._layer = this._build(placed, x, z)
    }
    return this._layer
  }

  _build(placed, px, pz) {
    const y0 = this._floor
    const top = new Map()
    let x0 = Infinity
    let z0 = Infinity
    let x1 = -Infinity
    let z1 = -Infinity
    for (const [key, type] of placed) {
      const [x, y, z] = key.split(',').map(Number)
      if (y < y0 || y > y0 + BAND || Math.abs(x - px) > REACH || Math.abs(z - pz) > REACH) continue
      const c = `${x},${z}`
      const was = top.get(c)
      if (was && was.y >= y) continue
      top.set(c, { x, z, y, type })
      if (x < x0) x0 = x
      if (z < z0) z0 = z
      if (x > x1) x1 = x
      if (z > z1) z1 = z
    }
    if (top.size < MIN_COLUMNS) return null
    const w = x1 - x0 + 1
    const h = z1 - z0 + 1
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(w, h)
    for (const c of top.values()) {
      const col = colorOf(c.type)
      // Higher = lighter, so roofs and walls stand out from the floor.
      const lift = Math.min(0.45, (c.y - y0) * 0.06)
      const i = ((c.z - z0) * w + (c.x - x0)) * 4
      img.data[i] = Math.round(((col >> 16) & 255) * (1 - lift) + 255 * lift)
      img.data[i + 1] = Math.round(((col >> 8) & 255) * (1 - lift) + 255 * lift)
      img.data[i + 2] = Math.round((col & 255) * (1 - lift) + 255 * lift)
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    return { canvas, x0, z0, w, h }
  }
}

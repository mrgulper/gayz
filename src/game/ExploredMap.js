// Unexplored fog on the World Map mode's map (2026-11-09, Gaymi picked it
// from the world-map idea list): places you've never walked are under soft
// cloud on the map until you go there.
//
// The Earth is split into CELL x CELL block squares; walking reveals the
// squares within REVEAL of you. What you've seen is kept on this device
// (localStorage, saved a few seconds after it changes - never every
// frame). BIG squares count how many small ones inside are seen, so the
// map skips empty areas with one look-up.
//
// Since 2026-11-09 (Gaymi's world-map list 2): the higher you stand, the
// wider the circle you clear (CLIMB_*); it counts how much of each country
// and of the Earth you've seen (stats()); and on a server friends clear
// one fog together (addKeys / shareState, sent by PlayNet).
import { countryAt } from './EarthPlaces.js'
import { COUNTRY_W, COUNTRY_H } from './EarthCountries.js'

const CELL = 16
const BIG = 16 // small cells per side of a big one (256 blocks)
const REVEAL = 2 // cells round you on the ground (a ~80-block-wide window)
// Standing high: one more cell of reveal every CLIMB_PER blocks above
// CLIMB_FROM (sea level is -4), up to CLIMB_MOST cells (~340 blocks wide).
const CLIMB_FROM = 4
const CLIMB_PER = 9
const CLIMB_MOST = 10
// v1 kept every cell as a number in a list; v2 (2026-11-09) keeps them
// sorted, as gaps written in base 36 - about 2 letters a cell instead of 9,
// so far more fits. v1 is still read once if there's no v2 yet (and left
// alone).
const OLD_KEY = 'gayz-world-explored-v1'
const KEY = 'gayz-world-explored-v2'
const MAX_CELLS = 120000 // about 300 KB stored; past it nothing new is kept
const SAVE_AFTER_S = 5
const OFF = 4096
const ROW = 8192
const EARTH_DEG = 120 // blocks per degree (EarthGrid.js)
// The whole Earth in cells (the flat map: 360 x 180 degrees).
const EARTH_CELLS = ((360 * EARTH_DEG) / CELL) * ((180 * EARTH_DEG) / CELL)
// One country-grid square (half a degree) in cells.
const CELLS_PER_COUNTRY_SQUARE = (EARTH_DEG / 2 / CELL) ** 2
// Shared fog: cells per piece sent, and seconds between pieces.
const SHARE_CELLS = 400
const SHARE_EVERY_S = 0.5

const cellKey = (cx, cz) => (cx + OFF) * ROW + (cz + OFF)
const bigKey = (bx, bz) => (bx + OFF) * ROW + (bz + OFF)
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180

// Sorted cell numbers <-> "first,gap,gap..." in base 36.
export function packKeys(keys) {
  let prev = 0
  let out = ''
  for (let i = 0; i < keys.length; i++) {
    out += (i ? ',' : '') + (keys[i] - prev).toString(36)
    prev = keys[i]
  }
  return out
}
export function unpackKeys(text) {
  const out = []
  if (typeof text !== 'string' || !text) return out
  let k = 0
  for (const part of text.split(',')) {
    const d = parseInt(part, 36)
    if (!Number.isFinite(d) || d < 0) return out
    k += d
    if (k >= ROW * ROW) return out
    out.push(k)
  }
  return out
}

// The cell's middle, in blocks.
function cellMiddle(k) {
  return [(Math.floor(k / ROW) - OFF + 0.5) * CELL, ((k % ROW) - OFF + 0.5) * CELL]
}

let countryTotals = null
// How many cells each country covers (from the half-degree country grid).
function countryCells(country) {
  if (!countryTotals) {
    countryTotals = new Map()
    for (let j = 0; j < COUNTRY_H; j++) {
      for (let i = 0; i < COUNTRY_W; i++) {
        const c = countryAt(90 - (j + 0.5) / 2, (i + 0.5) / 2 - 180)
        if (c) countryTotals.set(c, (countryTotals.get(c) || 0) + 1)
      }
    }
  }
  return (countryTotals.get(country) || 0) * CELLS_PER_COUNTRY_SQUARE
}

// The country a spot (blocks) is in, '' at sea.
export function countryAtBlock(x, z) {
  return countryAt(-z / EARTH_DEG, wrapLon(x / EARTH_DEG))
}

// "4%", "0.3%", "0.01%", "<0.01%".
export function pctText(f) {
  const p = Math.max(0, Math.min(100, f * 100))
  if (p === 0) return '0%'
  if (p < 0.01) return '<0.01%'
  if (p < 1) return `${+p.toFixed(p < 0.1 ? 2 : 1)}%`
  return `${Math.floor(p)}%`
}

// Cells to reveal round you standing at height y (blocks).
export function revealFor(y) {
  return Math.min(CLIMB_MOST, REVEAL + Math.max(0, Math.floor((y - CLIMB_FROM) / CLIMB_PER)))
}

class Explored {
  constructor() {
    this.cells = null
    this.big = new Map()
    this.byCountry = new Map()
    this.version = 0
    this._saveIn = 0
    this._dirty = false
    this._lastCell = null
    this._lastR = 0
    // Other players on a server: where each last cleared round.
    this._others = new Map()
    this._share = null
    this._shareSeq = 0
  }

  _load() {
    if (this.cells) return
    this.cells = new Set()
    let list = []
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (raw && typeof raw.d === 'string') list = unpackKeys(raw.d)
      else {
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null')
        if (old && Array.isArray(old.c)) list = old.c
      }
    } catch {
      list = []
    }
    for (const k of list) if (Number.isInteger(k) && k >= 0 && this.cells.size < MAX_CELLS) this._add(k)
  }

  _add(k) {
    if (this.cells.has(k)) return false
    this.cells.add(k)
    const cx = Math.floor(k / ROW) - OFF
    const cz = (k % ROW) - OFF
    const b = bigKey(Math.floor(cx / BIG), Math.floor(cz / BIG))
    this.big.set(b, (this.big.get(b) || 0) + 1)
    const [x, z] = cellMiddle(k)
    const c = countryAtBlock(x, z)
    if (c) this.byCountry.set(c, (this.byCountry.get(c) || 0) + 1)
    return true
  }

  _changed() {
    this.version++
    if (!this._dirty) this._saveIn = SAVE_AFTER_S
    this._dirty = true
  }

  // Clears the circle of r cells round cell (cx, cz); true if any were new.
  _reveal(cx, cz, r) {
    let added = false
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (this.cells.size >= MAX_CELLS) return added
        if (dx * dx + dz * dz > r * r + 1) continue
        if (this._add(cellKey(cx + dx, cz + dz))) added = true
      }
    }
    return added
  }

  // You're at (x, z) blocks, standing at height y: reveal round you - more
  // the higher you are. Cheap when you haven't moved into a new cell.
  visit(x, z, dt, y = 0) {
    this._load()
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const here = cellKey(cx, cz)
    const r = revealFor(y)
    if (here !== this._lastCell || r > this._lastR) {
      this._lastCell = here
      this._lastR = r
      if (this._reveal(cx, cz, r)) this._changed()
    }
    if (this._dirty && (this._saveIn -= dt) <= 0) this.save()
  }

  // Another player on the server is at (x, y, z): they clear my fog too.
  visitOther(id, x, y, z) {
    this._load()
    if (![x, y, z].every(Number.isFinite)) return
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const r = revealFor(y)
    const key = `${cellKey(cx, cz)}:${r}`
    if (this._others.get(id) === key) return
    this._others.set(id, key)
    if (this._reveal(cx, cz, r)) this._changed()
  }

  forgetOther(id) {
    this._others.delete(id)
  }

  // Cells someone else had already seen (their shared pieces).
  addKeys(keys) {
    this._load()
    let added = false
    for (const k of keys) {
      if (this.cells.size >= MAX_CELLS) break
      if (Number.isInteger(k) && k >= 0 && this._add(k)) added = true
    }
    if (added) this._changed()
    return added
  }

  // Is the spot (blocks) cleared?
  seenAt(x, z) {
    this._load()
    return this.cells.has(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
  }

  // How much you've seen: of `country` (0..1, null at sea) and of the Earth.
  stats(country) {
    this._load()
    const total = country ? countryCells(country) : 0
    return {
      country: total ? Math.min(1, (this.byCountry.get(country) || 0) / total) : null,
      earth: this.cells.size / EARTH_CELLS,
    }
  }

  save() {
    if (!this._dirty || !this.cells) return
    this._dirty = false
    try {
      const keys = Float64Array.from(this.cells).sort()
      localStorage.setItem(KEY, JSON.stringify({ v: 2, d: packKeys(keys) }))
    } catch {
      // Storage full or blocked: the fog still works for this visit.
    }
  }

  // --- Shared fog on a server (PlayNet) ---
  // Someone new is here: send them everything I've seen, a piece at a time.
  startShare() {
    this._load()
    if (!this.cells.size) return
    this._share = { keys: Float64Array.from(this.cells).sort(), at: 0, piece: null, next: 0 }
  }

  // The piece to send with this sync ({ n, c }), kept the same until the
  // next one is due so nobody misses it; null once everything went.
  shareState(now = performance.now()) {
    const sh = this._share
    if (!sh) return null
    if (now >= sh.next) {
      if (sh.at >= sh.keys.length) {
        this._share = null
        return null
      }
      const part = Array.from(sh.keys.subarray(sh.at, sh.at + SHARE_CELLS))
      sh.at += part.length
      sh.piece = { n: ++this._shareSeq, c: packKeys(part) }
      sh.next = now + SHARE_EVERY_S * 1000
    }
    return sh.piece
  }

  // 0..1: how much of the square (x, z, size in blocks) has been seen.
  seenIn(x, z, size) {
    const cx0 = Math.floor(x / CELL)
    const cz0 = Math.floor(z / CELL)
    const cx1 = Math.floor((x + size - 0.001) / CELL)
    const cz1 = Math.floor((z + size - 0.001) / CELL)
    let seen = 0
    let all = 0
    for (let bx = Math.floor(cx0 / BIG); bx <= Math.floor(cx1 / BIG); bx++) {
      for (let bz = Math.floor(cz0 / BIG); bz <= Math.floor(cz1 / BIG); bz++) {
        const ax0 = Math.max(cx0, bx * BIG)
        const ax1 = Math.min(cx1, bx * BIG + BIG - 1)
        const az0 = Math.max(cz0, bz * BIG)
        const az1 = Math.min(cz1, bz * BIG + BIG - 1)
        const n = (ax1 - ax0 + 1) * (az1 - az0 + 1)
        all += n
        if (!this.big.get(bigKey(bx, bz))) continue
        for (let i = ax0; i <= ax1; i++) for (let j = az0; j <= az1; j++) if (this.cells.has(cellKey(i, j))) seen++
      }
    }
    return all ? seen / all : 0
  }

  // Draws the fog over the map: the view's top-left (ox, oz) and width
  // `span` in blocks, k canvas pixels per block. A small
  // picture (one pixel per patch of land) scaled up smoothly, so the edges
  // are soft; its cloudy texture is pinned to the world, not the screen.
  draw(ctx, ox, oz, span, k) {
    this._load()
    const n = 96
    const step = Math.max(CELL / 2, span / n)
    const gx0 = Math.floor(ox / step)
    const gz0 = Math.floor(oz / step)
    const cols = Math.ceil(span / step) + 2
    const ck = `${gx0},${gz0},${step},${cols},${this.version}`
    if (ck !== this._maskKey) {
      this._maskKey = ck
      if (!this._mask || this._mask.width !== cols) {
        this._mask = document.createElement('canvas')
        this._mask.width = this._mask.height = cols
      }
      const mctx = this._mask.getContext('2d')
      const img = mctx.createImageData(cols, cols)
      const d = img.data
      for (let j = 0; j < cols; j++) {
        for (let i = 0; i < cols; i++) {
          const wx = (gx0 + i) * step
          const wz = (gz0 + j) * step
          const seen = this.cells.size ? this.seenIn(wx, wz, step) : 0
          // Puffy clouds: a gentle wobble pinned to the world.
          const puff = 0.5 + 0.25 * Math.sin(wx * 0.011 + Math.sin(wz * 0.007) * 2) + 0.25 * Math.sin(wz * 0.013 + Math.sin(wx * 0.005) * 3)
          const o = (j * cols + i) * 4
          const shade = 222 + puff * 30
          d[o] = shade
          d[o + 1] = shade
          d[o + 2] = Math.min(255, shade + 8)
          d[o + 3] = Math.round(255 * (1 - seen) * (0.72 + 0.2 * puff))
        }
      }
      mctx.putImageData(img, 0, 0)
    }
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this._mask, (gx0 * step - ox) * k, (gz0 * step - oz) * k, cols * step * k, cols * step * k)
    ctx.restore()
  }
}

// The globe's fog (2026-11-09, Gaymi: "add the fog to the globe too"): the
// same soft cloud as the flat map, as a whole-world picture (longitude
// -180 on the left, north on top) that EarthGlobe wraps round the Earth.
// One pixel is ~21 blocks; the cloud texture is worked out once, then
// each redraw clears the pixels you've seen. Redrawn at most once a
// second, and only while the globe is showing.
const GLOBE_W = 2048
const GLOBE_H = 1024

Explored.prototype.globeCanvas = function () {
  this._load()
  const now = performance.now()
  if (this._globe && (this._globeVersion === this.version || now - this._globeAt < 1000)) return this._globe
  if (!this._globe) {
    this._globe = document.createElement('canvas')
    this._globe.width = GLOBE_W
    this._globe.height = GLOBE_H
    this._globeImg = this._globe.getContext('2d').createImageData(GLOBE_W, GLOBE_H)
    // The cloud with nothing seen, kept to start each redraw from. Same
    // puffs as the flat map, pinned to the same world spots.
    const base = (this._globeBase = new Uint8ClampedArray(GLOBE_W * GLOBE_H * 4))
    for (let j = 0; j < GLOBE_H; j++) {
      const wz = ((j + 0.5) / GLOBE_H * 180 - 90) * EARTH_DEG
      for (let i = 0; i < GLOBE_W; i++) {
        const wx = ((i + 0.5) / GLOBE_W * 360 - 180) * EARTH_DEG
        const puff = 0.5 + 0.25 * Math.sin(wx * 0.011 + Math.sin(wz * 0.007) * 2) + 0.25 * Math.sin(wz * 0.013 + Math.sin(wx * 0.005) * 3)
        const o = (j * GLOBE_W + i) * 4
        const shade = 222 + puff * 30
        base[o] = base[o + 1] = shade
        base[o + 2] = Math.min(255, shade + 8)
        // A little lighter than the flat map, so the countries still show.
        base[o + 3] = Math.round(255 * (0.62 + 0.2 * puff))
      }
    }
  }
  this._globeVersion = this.version
  this._globeAt = now
  const d = this._globeImg.data
  d.set(this._globeBase)
  const pxPerBlock = GLOBE_W / (360 * EARTH_DEG)
  const W = 360 * EARTH_DEG
  for (const k of this.cells) {
    const cx = Math.floor(k / ROW) - OFF
    const cz = (k % ROW) - OFF
    // The cell's middle, in blocks; x wraps round the world.
    let x = (cx + 0.5) * CELL + W / 2
    x = ((x % W) + W) % W
    const j = Math.floor(((cz + 0.5) * CELL + 90 * EARTH_DEG) * pxPerBlock)
    if (j < 0 || j >= GLOBE_H) continue
    d[(j * GLOBE_W + Math.floor(x * pxPerBlock)) * 4 + 3] = 0
  }
  this._globe.getContext('2d').putImageData(this._globeImg, 0, 0)
  // Tells EarthGlobe the picture changed.
  this._globe._drawnAt = now
  return this._globe
}

export const explored = new Explored()
// Leaving the page before the next save: keep the last few seconds too.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => explored.save())

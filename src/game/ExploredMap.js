// Unexplored fog on the World Map mode's map (2026-11-09, Gaymi picked it
// from the world-map idea list): places you've never walked are under soft
// cloud on the map until you go there.
//
// The Earth is split into CELL x CELL block squares; walking reveals the
// squares within REVEAL of you. What you've seen is kept on this device
// (localStorage, saved a few seconds after it changes - never every
// frame). BIG squares count how many small ones inside are seen, so the
// map skips empty areas with one look-up.
const CELL = 16
const BIG = 16 // small cells per side of a big one (256 blocks)
const REVEAL = 2 // cells round you (a ~80-block-wide window)
const KEY = 'gayz-world-explored-v1'
const MAX_CELLS = 30000 // about 300 KB stored; past it nothing new is kept
const SAVE_AFTER_S = 5
const OFF = 4096
const ROW = 8192

const cellKey = (cx, cz) => (cx + OFF) * ROW + (cz + OFF)
const bigKey = (bx, bz) => (bx + OFF) * ROW + (bz + OFF)

class Explored {
  constructor() {
    this.cells = null
    this.big = new Map()
    this.version = 0
    this._saveIn = 0
    this._dirty = false
    this._lastCell = null
  }

  _load() {
    if (this.cells) return
    this.cells = new Set()
    let list = []
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (raw && Array.isArray(raw.c)) list = raw.c
    } catch {
      list = []
    }
    for (const k of list) if (Number.isInteger(k) && k >= 0) this._add(k)
  }

  _add(k) {
    if (this.cells.has(k)) return false
    this.cells.add(k)
    const cx = Math.floor(k / ROW) - OFF
    const cz = (k % ROW) - OFF
    const b = bigKey(Math.floor(cx / BIG), Math.floor(cz / BIG))
    this.big.set(b, (this.big.get(b) || 0) + 1)
    return true
  }

  // You're at (x, z) blocks: reveal round you. Cheap when you haven't
  // moved into a new cell.
  visit(x, z, dt) {
    this._load()
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const here = cellKey(cx, cz)
    if (here !== this._lastCell) {
      this._lastCell = here
      let added = false
      if (this.cells.size < MAX_CELLS) {
        for (let dx = -REVEAL; dx <= REVEAL; dx++) {
          for (let dz = -REVEAL; dz <= REVEAL; dz++) {
            if (dx * dx + dz * dz > REVEAL * REVEAL + 1) continue
            if (this._add(cellKey(cx + dx, cz + dz))) added = true
          }
        }
      }
      if (added) {
        this.version++
        if (!this._dirty) this._saveIn = SAVE_AFTER_S
        this._dirty = true
      }
    }
    if (this._dirty && (this._saveIn -= dt) <= 0) this.save()
  }

  save() {
    if (!this._dirty || !this.cells) return
    this._dirty = false
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, c: [...this.cells] }))
    } catch {
      // Storage full or blocked: the fog still works for this visit.
    }
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

export const explored = new Explored()
// Leaving the page before the next save: keep the last few seconds too.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => explored.save())

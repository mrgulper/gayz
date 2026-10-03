// Minecraft-style flowing water and lava for the Map Editor. Owned by
// BuildMode (`buildMode.liquids`).
//
// A placed water/lava block is a *source*. Every water tick (0.25s) / lava
// tick (1.5s) the sources and the flowing cells around them spread:
// straight down first, and sideways along the ground - water up to 7
// blocks, lava 3 - heading for the nearest drop if there's one within
// reach (4 blocks for water, 2 for lava), like Minecraft. A flowing cell
// with nothing feeding it any more dries up, and two water sources side by
// side make a new source in between (infinite water). Lava touching water
// hardens: a lava source into obsidian, flowing lava into cobblestone.
//
// Flowing cells live in BuildMode's _blocks as plain 'water'/'lava' (so
// rendering, swimming and collision all treat them as the liquid), with
// their level kept here: 1-7 (water) / 2,4,6 (lava) for spreading, FALLING for
// falling. They're never saved (BuildMode._snapshot skips them) - the
// sources re-flow on load - can't be aimed at, and placing a block into
// one replaces it.
const KINDS = {
  water: { tick: 0.25, step: 1, max: 7, reach: 4 },
  lava: { tick: 1.5, step: 2, max: 6, reach: 2 },
}
const FALLING = 99 // a stream pouring straight down (never a spreading level)
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
// Never spreads past the 128x128 ground or below the bottom of the world.
const HALF = 64
const MIN_Y = -40
// A hard cap on flowing cells, so a huge flood can't swamp the editor.
const MAX_FLOW_CELLS = 30000
// Cell levels a surface is drawn at (fraction of a block): a source sits
// 2 pixels below the top, like Minecraft, and each step down the slope
// drops a little more.
const SOURCE_HEIGHT = 14 / 16

export class LiquidFlow {
  constructor(buildMode) {
    this.bm = buildMode
    this.levels = new Map() // cell key -> level, flowing cells only
    this.pending = { water: new Set(), lava: new Set() }
    this.timers = { water: 0, lava: 0 }
  }

  clear() {
    this.levels.clear()
    this.pending.water.clear()
    this.pending.lava.clear()
  }

  isFlow(key) {
    return this.levels.has(key)
  }

  // Surface height of a liquid cell (0-1 of a block), for the chunk mesher.
  heightAt(x, y, z) {
    const level = this.levels.get(`${x},${y},${z}`)
    if (level === undefined || level === FALLING) return SOURCE_HEIGHT
    return Math.max(0.12, ((8 - level) / 8) * SOURCE_HEIGHT)
  }

  // Something at (x, y, z) changed: it and its neighbors get another look
  // on the next tick of whichever liquid is around.
  changed(x, y, z) {
    this._schedule(x, y, z)
    this._schedule(x, y + 1, z)
    this._schedule(x, y - 1, z)
    for (const [dx, dz] of SIDES) this._schedule(x + dx, y, z + dz)
  }

  // After a whole map loads: every source gets a look (most are sealed in
  // and do nothing).
  scheduleAllSources() {
    for (const [key, type] of this.bm._blocks) {
      if (KINDS[type] && !this.levels.has(key)) this.pending[type].add(key)
    }
  }

  _schedule(x, y, z) {
    const type = this.bm.getBlockAt(x, y, z)
    if (KINDS[type]) this.pending[type].add(`${x},${y},${z}`)
  }

  update(dt) {
    for (const kind of Object.keys(KINDS)) {
      if (!this.pending[kind].size) {
        this.timers[kind] = 0
        continue
      }
      this.timers[kind] += dt
      if (this.timers[kind] < KINDS[kind].tick) continue
      this.timers[kind] = 0
      const cells = [...this.pending[kind]]
      this.pending[kind].clear()
      for (const key of cells) {
        const [x, y, z] = key.split(',').map(Number)
        this._updateCell(kind, x, y, z)
      }
    }
  }

  // --- One cell's turn ---
  _kindAt(x, y, z) {
    const type = this.bm.getBlockAt(x, y, z)
    return KINDS[type] ? type : null
  }

  // How "full" a liquid cell is for spreading: sources and falling cells
  // count as full (0).
  _spreadLevel(key) {
    const level = this.levels.get(key)
    return level === undefined || level === FALLING ? 0 : level
  }

  _isSource(x, y, z, kind) {
    return this._kindAt(x, y, z) === kind && !this.levels.has(`${x},${y},${z}`)
  }

  // Liquid can move into empty cells and into its own kind's thinner
  // flowing cells.
  _canEnter(x, y, z, kind, level) {
    if (x < -HALF || x >= HALF || z < -HALF || z >= HALF || y < MIN_Y) return false
    const type = this.bm.getBlockAt(x, y, z)
    if (!type) return true
    if (type !== kind) return false
    const cur = this.levels.get(`${x},${y},${z}`)
    return cur !== undefined && cur !== FALLING && cur > level
  }

  // Somewhere to pour into: empty, or this liquid's own flowing cells
  // (incl. a stream already pouring down).
  _canFallInto(x, y, z, kind) {
    if (y < MIN_Y) return false
    const type = this.bm.getBlockAt(x, y, z)
    return !type || (type === kind && this.levels.has(`${x},${y},${z}`))
  }

  _updateCell(kind, x, y, z) {
    const key = `${x},${y},${z}`
    if (this._kindAt(x, y, z) !== kind) return
    if (kind === 'lava' && this._hardenLava(x, y, z)) return
    const cfg = KINDS[kind]
    let level = this.levels.get(key)
    if (level !== undefined) {
      // A flowing cell takes its level from whatever feeds it.
      let want
      if (this._kindAt(x, y + 1, z) === kind) want = FALLING
      else {
        let best = Infinity
        let sources = 0
        for (const [dx, dz] of SIDES) {
          const nk = `${x + dx},${y},${z + dz}`
          if (this._kindAt(x + dx, y, z + dz) !== kind) continue
          const nl = this.levels.get(nk)
          if (nl === undefined) sources++
          best = Math.min(best, this._spreadLevel(nk))
        }
        // Two water sources beside a cell resting on something solid (or
        // on a source) fill it in: Minecraft's infinite water.
        const below = this.bm.getBlockAt(x, y - 1, z)
        if (kind === 'water' && sources >= 2 && below && (below !== 'water' || this._isSource(x, y - 1, z, 'water'))) {
          this._setLevel(x, y, z, kind, undefined)
          level = undefined
          want = null
        } else {
          want = best + cfg.step
        }
      }
      if (want !== null) {
        if (want > cfg.max && want !== FALLING) {
          this._remove(x, y, z)
          return
        }
        if (want !== level) {
          this._setLevel(x, y, z, kind, want)
          level = want
        }
      }
    }
    this._spread(kind, x, y, z, level)
  }

  _spread(kind, x, y, z, level) {
    const cfg = KINDS[kind]
    // Down first.
    if (this._canEnter(x, y - 1, z, kind, -1) && this.bm.getBlockAt(x, y - 1, z) !== kind) {
      this._place(x, y - 1, z, kind, FALLING)
      // Flowing water pouring over an edge only goes down; a source also
      // spreads along the top.
      if (level !== undefined) return
    } else if (this._kindAt(x, y - 1, z) === kind && this.levels.get(`${x},${y - 1},${z}`) !== undefined && level !== undefined) {
      // Already pouring into flowing liquid below.
      if (this.levels.get(`${x},${y - 1},${z}`) !== FALLING) this._setLevel(x, y - 1, z, kind, FALLING)
      return
    }
    const next = (level === undefined || level === FALLING ? 0 : level) + cfg.step
    if (next > cfg.max) return
    // Sideways, toward the nearest drop if there is one in reach.
    const open = SIDES.filter(([dx, dz]) => this._canEnter(x + dx, y, z + dz, kind, next))
    if (!open.length) return
    let bestDist = Infinity
    const dists = open.map(([dx, dz]) => {
      const d = this._dropDistance(kind, x + dx, y, z + dz, cfg.reach, [-dx, -dz])
      bestDist = Math.min(bestDist, d)
      return d
    })
    open.forEach(([dx, dz], i) => {
      if (bestDist !== Infinity && dists[i] !== bestDist) return
      this._place(x + dx, y, z + dz, kind, next)
    })
  }

  // How many steps along the ground from (x, y, z) until the liquid could
  // fall (0 = right here), within reach; Infinity if there's no drop.
  _dropDistance(kind, x, y, z, reach, from) {
    const seen = new Set([`${x},${z}`, `${x + from[0]},${z + from[1]}`])
    let frontier = [[x, z]]
    for (let d = 0; d <= reach && frontier.length; d++) {
      const nextFrontier = []
      for (const [fx, fz] of frontier) {
        if (this._canFallInto(fx, y - 1, fz, kind)) return d
        for (const [dx, dz] of SIDES) {
          const nx = fx + dx
          const nz = fz + dz
          const k = `${nx},${nz}`
          if (seen.has(k)) continue
          seen.add(k)
          if (this._canEnter(nx, y, nz, kind, 0)) nextFrontier.push([nx, nz])
        }
      }
      frontier = nextFrontier
    }
    return Infinity
  }

  // Lava next to water (on a side or underneath it) turns to stone.
  _hardenLava(x, y, z) {
    const touching = this._kindAt(x, y + 1, z) === 'water' || SIDES.some(([dx, dz]) => this._kindAt(x + dx, y, z + dz) === 'water')
    if (!touching) return false
    const source = !this.levels.has(`${x},${y},${z}`)
    this._remove(x, y, z)
    this._withoutUndo(() => this.bm.placeBlock(x, y, z, source ? 'obsidian' : 'cobblestone'))
    return true
  }

  // --- Changing cells ---
  _withoutUndo(fn) {
    const bm = this.bm
    const was = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    try {
      fn()
    } finally {
      bm._suppressUndoRecording = was
    }
  }

  _place(x, y, z, kind, level) {
    const key = `${x},${y},${z}`
    const type = this.bm.getBlockAt(x, y, z)
    if (type === kind) {
      this._setLevel(x, y, z, kind, level)
      return
    }
    if (type || this.levels.size >= MAX_FLOW_CELLS) return
    // Water flowing onto lava below hardens it (the lava's own update
    // does the rest).
    this.levels.set(key, level)
    this._withoutUndo(() => this.bm.placeBlock(x, y, z, kind, true))
    this._remeshAround(x, y, z)
    this.changed(x, y, z)
    if (kind === 'water') this._scheduleLavaAround(x, y, z)
  }

  _setLevel(x, y, z, kind, level) {
    const key = `${x},${y},${z}`
    if (level === undefined) this.levels.delete(key)
    else this.levels.set(key, level)
    this._remeshAround(x, y, z)
    this.changed(x, y, z)
  }

  _remove(x, y, z) {
    const key = `${x},${y},${z}`
    this.levels.delete(key)
    this._withoutUndo(() => this.bm.removeBlock(x, y, z))
  }

  _scheduleLavaAround(x, y, z) {
    for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      if (this._kindAt(x + dx, y + dy, z + dz) === 'lava') this.pending.lava.add(`${x + dx},${y + dy},${z + dz}`)
    }
  }

  // A surface's corners are shared with the cells around it, so a level
  // change reshapes the neighbors' meshes too.
  _remeshAround(x, y, z) {
    const chunks = this.bm._chunks
    chunks.markDirty(x, y, z)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) chunks.markDirty(x + dx, y, z + dz)
  }
}

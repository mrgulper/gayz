// Blocks a game swaps in for a while and puts back exactly as they were
// (2026-11-02): frozen lakes (Skateboards.js), sunken ruins and reefs
// (Reefs.js), the Moon (MoonTrip.js), hot springs (HotSprings.js), the
// haunted house (HauntedHouse.js) and minecart tunnels (Minecarts.js). Each swapped cell remembers what was
// there and whether it was the open world's own land; the new block goes
// in BuildSurvival `_placed`, so a save in the middle of a game never keeps
// it. restore() puts every cell back (water stays water, land stays land).
export class TempBlocks {
  constructor(survival) {
    this.s = survival
    this.cells = new Map() // key -> { x, y, z, was, terrain }
  }

  get size() {
    return this.cells.size
  }

  has(x, y, z) {
    return this.cells.has(this.s.bm._key(x, y, z))
  }

  put(x, y, z, type, state = null) {
    const s = this.s
    const bm = s.bm
    const key = bm._key(x, y, z)
    const was = bm.getBlockAt(x, y, z) || ''
    if (was === type) return false
    if (!this.cells.has(key)) this.cells.set(key, { x, y, z, was, terrain: !!bm.world?.isTerrain?.(key) })
    const undo = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    if (was) bm.removeBlock(x, y, z)
    bm.placeBlock(x, y, z, type, true, state)
    bm._suppressUndoRecording = undo
    s._placed.set(key, type)
    return true
  }

  // An empty cell for a while (Minecarts.js digs its tunnels): back() puts
  // the block back.
  clear(x, y, z) {
    const s = this.s
    const bm = s.bm
    const key = bm._key(x, y, z)
    const was = bm.getBlockAt(x, y, z) || ''
    if (!was) return false
    if (!this.cells.has(key)) this.cells.set(key, { x, y, z, was, terrain: !!bm.world?.isTerrain?.(key) })
    const undo = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = undo
    s._placed.delete(key)
    return true
  }

  // One cell back as it was.
  back(key) {
    const c = this.cells.get(key)
    if (!c) return
    const s = this.s
    const bm = s.bm
    this.cells.delete(key)
    const now = bm.getBlockAt(c.x, c.y, c.z)
    if (now && now === s._placed.get(key)) bm.removeBlock(c.x, c.y, c.z)
    s._placed.delete(key)
    if (c.was && !bm.getBlockAt(c.x, c.y, c.z)) bm.placeBlock(c.x, c.y, c.z, c.was, true)
    if (c.terrain && bm.world) {
      bm.world.removed?.delete(key)
      bm.world.terrainKeys?.add(key)
    }
  }

  restore() {
    if (!this.cells.size) return
    const bm = this.s.bm
    const undo = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    for (const key of [...this.cells.keys()]) this.back(key)
    bm._suppressUndoRecording = undo
  }
}

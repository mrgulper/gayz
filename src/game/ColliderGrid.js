// Uniform-grid spatial index over the world's Box3 colliders. With 14
// stages' worth of world geometry, the flat `colliders` array can hold
// 900+ boxes - anything checking movement against it (the player, every
// zombie, the drivable vehicle) used to linear-scan the WHOLE array every
// time, multiple times per frame. This narrows that down to just the boxes
// actually near a given position.
//
// Colliders can span multiple cells (a long wall), so they're inserted into
// every cell their own AABB overlaps; queries check the containing cell
// plus all 8 neighbors so a query box straddling a cell boundary still
// finds everything relevant. Cell size is intentionally much larger than
// any single frame's movement distance, so nothing legitimately nearby can
// ever fall outside the 3x3 neighborhood.
export const COLLIDER_GRID_CELL_SIZE = 20

function cellKey(cx, cz) {
  return `${cx},${cz}`
}

export function buildColliderGrid(colliders, cellSize = COLLIDER_GRID_CELL_SIZE) {
  const cells = new Map()
  for (const box of colliders) {
    const cxMin = Math.floor(box.min.x / cellSize)
    const cxMax = Math.floor(box.max.x / cellSize)
    const czMin = Math.floor(box.min.z / cellSize)
    const czMax = Math.floor(box.max.z / cellSize)
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cz = czMin; cz <= czMax; cz++) {
        const key = cellKey(cx, cz)
        let bucket = cells.get(key)
        if (!bucket) {
          bucket = []
          cells.set(key, bucket)
        }
        bucket.push(box)
      }
    }
  }
  return { cells, cellSize }
}

// Colliders spanning multiple cells can appear in more than one of the 9
// queried buckets - deduped here since the same handful of nearby colliders
// reappearing in intersectsBox checks would just waste cycles re-testing
// them, not cause any incorrect behavior, but dedup is cheap and keeps
// things honest.
export function queryColliderGrid(grid, x, z) {
  const cx = Math.floor(x / grid.cellSize)
  const cz = Math.floor(z / grid.cellSize)
  const result = []
  const seen = new Set()
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.cells.get(cellKey(cx + dx, cz + dz))
      if (!bucket) continue
      for (const box of bucket) {
        if (seen.has(box)) continue
        seen.add(box)
        result.push(box)
      }
    }
  }
  return result
}

// Small helper for any consumer that just wants "the grid, rebuilt only
// when the source array's length actually changed" - both PlayerController
// and ZombieManager need exactly this, and the array only ever changes via
// push/splice (a door unlocking, rubble dropping, a barricade placed or
// repaired), never an in-place reposition, so length-based invalidation is
// airtight without the consumer needing to know about any of those sites.
export class CachedColliderGrid {
  constructor(colliders, cellSize = COLLIDER_GRID_CELL_SIZE) {
    this.colliders = colliders
    this.cellSize = cellSize
    this.grid = null
    this.lastLength = -1
  }

  query(x, z) {
    if (this.colliders.length !== this.lastLength) {
      this.grid = buildColliderGrid(this.colliders, this.cellSize)
      this.lastLength = this.colliders.length
    }
    return queryColliderGrid(this.grid, x, z)
  }
}

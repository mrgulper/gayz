import * as THREE from 'three'

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
//
// `result`/`seen` are optional reusable scratch buffers - this is called
// many times per frame (every zombie, the player, possibly a driven
// vehicle), and allocating a fresh array+Set on every single call was
// producing enough garbage to cause real, periodic GC-pause stutters -
// exactly the kind of "screen freezes for a moment" symptom that's worse
// during movement specifically, since movement is what triggers most of
// these queries (standing still barely calls this at all). Both
// CachedColliderGrid/CachedMeshGrid below pass in their own persistent
// per-instance buffers; called without them (e.g. a one-off external
// caller) still works exactly as before, just allocates like it always did.
export function queryColliderGrid(grid, x, z, result = [], seen = new Set()) {
  const cx = Math.floor(x / grid.cellSize)
  const cz = Math.floor(z / grid.cellSize)
  result.length = 0
  seen.clear()
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
    // Reused every query() call instead of allocating fresh - see
    // queryColliderGrid's own note on why this matters.
    this._queryResult = []
    this._querySeen = new Set()
  }

  query(x, z) {
    if (this.colliders.length !== this.lastLength) {
      this.grid = buildColliderGrid(this.colliders, this.cellSize)
      this.lastLength = this.colliders.length
    }
    return queryColliderGrid(this.grid, x, z, this._queryResult, this._querySeen)
  }
}

// Same idea, but for raycasting against real mesh geometry (ground-height
// sampling) instead of testing against explicit Box3 colliders. Each mesh's
// own world AABB (via Box3.setFromObject, computed once per rebuild - not
// per frame) decides which cells it lands in. setFromObject can over-
// estimate a rotated mesh's true footprint (the same caveat World.js notes
// elsewhere), but that only ever adds a mesh to a few extra neighboring
// cells, never drops it from the cell it actually belongs in - and the real
// triangle-level raycast run afterward on this narrowed list is what
// decides the actual hit, so a wider candidate net here can't produce a
// wrong height, just a very slightly larger (and still tiny next to the
// full array) candidate list to raycast against.
const _meshGridBox = new THREE.Box3()

export function buildMeshGrid(meshes, cellSize = COLLIDER_GRID_CELL_SIZE) {
  const cells = new Map()
  for (const mesh of meshes) {
    _meshGridBox.setFromObject(mesh)
    const cxMin = Math.floor(_meshGridBox.min.x / cellSize)
    const cxMax = Math.floor(_meshGridBox.max.x / cellSize)
    const czMin = Math.floor(_meshGridBox.min.z / cellSize)
    const czMax = Math.floor(_meshGridBox.max.z / cellSize)
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cz = czMin; cz <= czMax; cz++) {
        const key = cellKey(cx, cz)
        let bucket = cells.get(key)
        if (!bucket) {
          bucket = []
          cells.set(key, bucket)
        }
        bucket.push(mesh)
      }
    }
  }
  return { cells, cellSize }
}

export class CachedMeshGrid {
  constructor(meshes, cellSize = COLLIDER_GRID_CELL_SIZE) {
    this.meshes = meshes
    this.cellSize = cellSize
    this.grid = null
    this.lastLength = -1
    // Reused every query() call instead of allocating fresh - see
    // queryColliderGrid's own note on why this matters.
    this._queryResult = []
    this._querySeen = new Set()
  }

  query(x, z) {
    if (this.meshes.length !== this.lastLength) {
      this.grid = buildMeshGrid(this.meshes, this.cellSize)
      this.lastLength = this.meshes.length
    }
    return queryColliderGrid(this.grid, x, z, this._queryResult, this._querySeen)
  }
}

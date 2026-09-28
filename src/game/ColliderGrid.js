import * as THREE from 'three'
import { ensureBoundsTrees } from './RaycastAccel.js'

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
      // Same "the list changed" signal is exactly when any new static world
      // mesh (deferred tile content, a spawned barricade) needs its raycast
      // BVH - see RaycastAccel.js. Already-built trees are skipped.
      ensureBoundsTrees(this.meshes)
    }
    return queryColliderGrid(this.grid, x, z, this._queryResult, this._querySeen)
  }

  // Every mesh registered in any grid cell the segment's XZ projection
  // passes through - a superset of every mesh a ray along that segment
  // could possibly hit: if the ray passes through a mesh's AABB, the point
  // where it does lies in some cell that AABB overlaps, and buildMeshGrid
  // registers each mesh in every cell its AABB overlaps. Cells are walked
  // along the segment (2D DDA), so a long ray visits ~length/cellSize
  // cells rather than the whole bounding rectangle.
  //
  // Used for zombie line-of-sight and weapon-fire rays, which used to
  // bounding-test every one of the ~2000 solidMeshes per ray (measured
  // 2026-09-28: zombie LOS was the single biggest per-frame CPU cost with a
  // horde up, ~3.7ms/frame at 20 zombies with 10ms spikes).
  querySegment(x0, z0, x1, z1) {
    this.query(x0, z0) // rebuilds (and BVHs) first if the list changed
    const grid = this.grid
    const size = grid.cellSize
    const result = this._queryResult
    const seen = this._querySeen
    result.length = 0
    seen.clear()
    let cx = Math.floor(x0 / size)
    let cz = Math.floor(z0 / size)
    const endCx = Math.floor(x1 / size)
    const endCz = Math.floor(z1 / size)
    const dx = x1 - x0
    const dz = z1 - z0
    const stepX = dx > 0 ? 1 : -1
    const stepZ = dz > 0 ? 1 : -1
    const tDeltaX = dx !== 0 ? Math.abs(size / dx) : Infinity
    const tDeltaZ = dz !== 0 ? Math.abs(size / dz) : Infinity
    let tMaxX = dx !== 0 ? ((stepX > 0 ? (cx + 1) * size - x0 : x0 - cx * size) / Math.abs(dx)) : Infinity
    let tMaxZ = dz !== 0 ? ((stepZ > 0 ? (cz + 1) * size - z0 : z0 - cz * size) / Math.abs(dz)) : Infinity
    // Hard cap as a safety net against a NaN/huge input looping forever -
    // the whole 750-unit map is under 40 cells across.
    for (let guard = 0; guard < 512; guard++) {
      const bucket = grid.cells.get(cellKey(cx, cz))
      if (bucket) {
        for (const mesh of bucket) {
          if (seen.has(mesh)) continue
          seen.add(mesh)
          result.push(mesh)
        }
      }
      if (cx === endCx && cz === endCz) break
      if (tMaxX < tMaxZ) {
        if (tMaxX > 1) break
        cx += stepX
        tMaxX += tDeltaX
      } else {
        if (tMaxZ > 1) break
        cz += stepZ
        tMaxZ += tDeltaZ
      }
    }
    return result
  }
}

// One shared grid per mesh list - PlayerController's ground sampling and
// every zombie's line-of-sight check all read the same solidMeshes array,
// so they share one grid (and one rebuild) instead of each building its own.
const _sharedMeshGrids = new WeakMap()
export function meshGridFor(meshes) {
  let grid = _sharedMeshGrids.get(meshes)
  if (!grid) {
    grid = new CachedMeshGrid(meshes)
    _sharedMeshGrids.set(meshes, grid)
  }
  return grid
}

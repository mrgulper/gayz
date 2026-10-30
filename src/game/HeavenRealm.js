// Heaven (2026-10-30, Gaymi: "Add a heaven and demon at 500 and -500
// height like make it 300-500 for heaven", reached by building up or
// climbing - "make very tall mountains", no portals). Owned by OpenWorld
// (`world.heaven`).
//
// High above the land, from HEAVEN_FLOOR to HEAVEN_TOP:
//  - a cloud floor at y = HEAVEN_FLOOR you can walk on (white wool, puffed
//    up here and there, a few holes to fall through), with a gap wherever
//    a Heaven's Peak (OpenWorld.peakLift) comes up through it;
//  - floating islands up to HEAVEN_TOP: cloud islands, gardens, gold
//    islands and little quartz temples with a glowing roof;
//  - a cloud staircase winding up from the floor to every island.
// Angels live here (ZombieKinds.js, BuildSurvival._spawnZombie).
//
// Like the land, it comes out of the world seed and is never saved. It is
// only grown while you're up high (above SHOW_Y), a 16x16 column at a time
// around you, nearest first, and all of it goes again once you're back
// down below HIDE_Y - so the ground game never pays for it. Broken blocks
// (`world.removed`) stay broken if it grows again.
import { hash2, fbm, peakLift } from './OpenWorld.js'

const CHUNK = 16
export const HEAVEN_FLOOR = 300
export const HEAVEN_TOP = 500
const SHOW_Y = 220
const HIDE_Y = 180
// Columns grown this far round you (in columns), and dropped past +2.
const RADIUS = 6
const BUDGET_MS = 3
// One island may float in each ISLAND_GRID square.
const ISLAND_GRID = 40
const ISLAND_CHANCE = 0.55
const ISLAND_MIN_Y = 318
const ISLAND_MAX_Y = 490
// Each step of a staircase: around a 3x3 ring, one block up per step.
const RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
const KINDS = ['cloud', 'garden', 'gold', 'temple']

// The island (if any) in grid square (gx, gz).
function islandIn(gx, gz) {
  if (hash2(gx, gz, 401) > ISLAND_CHANCE) return null
  const x = gx * ISLAND_GRID + 10 + Math.floor(hash2(gx, gz, 402) * (ISLAND_GRID - 20))
  const z = gz * ISLAND_GRID + 10 + Math.floor(hash2(gx, gz, 403) * (ISLAND_GRID - 20))
  const y = ISLAND_MIN_Y + Math.floor(hash2(gx, gz, 404) * (ISLAND_MAX_Y - ISLAND_MIN_Y))
  const r = 5 + Math.floor(hash2(gx, gz, 405) * 7)
  const kind = KINDS[Math.floor(hash2(gx, gz, 406) * KINDS.length)]
  // The staircase starts just outside the island's edge.
  const a = hash2(gx, gz, 407) * Math.PI * 2
  const sx = Math.round(x + Math.cos(a) * (r + 3))
  const sz = Math.round(z + Math.sin(a) * (r + 3))
  return { x, y, z, r, kind, sx, sz, gx, gz }
}

export class HeavenRealm {
  static FLOOR = HEAVEN_FLOOR

  constructor(world) {
    this.world = world
    this.cols = new Map() // "cx,cz" -> { keys: [] }
  }

  get bm() {
    return this.world.bm
  }

  // In Heaven (for the fog, the sky and which zombies come)?
  static inHeaven(y) {
    return y >= HEAVEN_FLOOR - 4
  }

  dropAll() {
    for (const key of [...this.cols.keys()]) this._drop(key)
  }

  // Grows Heaven round p (blocks) while you're up high, drops it below.
  update(p) {
    if (!p || !Number.isFinite(p.y)) return
    if (p.y < HIDE_Y) {
      if (this.cols.size) this.dropAll()
      return
    }
    if (p.y < SHOW_Y && !this.cols.size) return
    const pcx = Math.floor(p.x / CHUNK)
    const pcz = Math.floor(p.z / CHUNK)
    const wanted = []
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        if (dx * dx + dz * dz > RADIUS * RADIUS + 1) continue
        if (!this.cols.has(`${pcx + dx},${pcz + dz}`)) wanted.push([dx * dx + dz * dz, pcx + dx, pcz + dz])
      }
    }
    wanted.sort((a, b) => a[0] - b[0])
    const until = performance.now() + BUDGET_MS
    for (const [, cx, cz] of wanted) {
      if (performance.now() > until) break
      this._grow(cx, cz)
    }
    if ((this._tick = (this._tick || 0) + 1) % 30 === 0) {
      for (const key of [...this.cols.keys()]) {
        const [cx, cz] = key.split(',').map(Number)
        if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) > RADIUS + 2) this._drop(key)
      }
    }
  }

  _grow(cx, cz) {
    const key = `${cx},${cz}`
    const rec = { keys: [] }
    this.cols.set(key, rec)
    const bm = this.bm
    const world = this.world
    const touched = new Set()
    const put = (x, y, z, type) => {
      const k = `${x},${y},${z}`
      if (world.removed.has(k) || bm._blocks.has(k)) return
      bm._setTerrainBlock(k, x, y, z, type)
      world.terrainKeys.add(k)
      rec.keys.push(k)
      touched.add(`${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)},${Math.floor(z / CHUNK)}`)
    }
    const x0 = cx * CHUNK
    const z0 = cz * CHUNK
    // The cloud floor.
    for (let x = x0; x < x0 + CHUNK; x++) {
      for (let z = z0; z < z0 + CHUNK; z++) {
        // A Heaven's Peak comes up through here.
        if (peakLift(x, z) >= HEAVEN_FLOOR - 3) continue
        const n = fbm(x, z, 1 / 24, 2, 411)
        if (n < -0.62) continue // a hole down to the land
        put(x, HEAVEN_FLOOR, z, 'whitewool')
        // Puffs: soft lumps on top.
        if (n > 0.28) put(x, HEAVEN_FLOOR + 1, z, 'whitewool')
        if (n > 0.48) put(x, HEAVEN_FLOOR + 2, z, 'whitewool')
      }
    }
    // Islands whose middle is in this column.
    const gx0 = Math.floor(x0 / ISLAND_GRID)
    const gz0 = Math.floor(z0 / ISLAND_GRID)
    for (let gx = gx0; gx <= Math.floor((x0 + CHUNK - 1) / ISLAND_GRID); gx++) {
      for (let gz = gz0; gz <= Math.floor((z0 + CHUNK - 1) / ISLAND_GRID); gz++) {
        const isl = islandIn(gx, gz)
        if (isl && isl.x >= x0 && isl.x < x0 + CHUNK && isl.z >= z0 && isl.z < z0 + CHUNK) this._island(isl, put)
      }
    }
    if (touched.size) {
      const chunks = bm._chunks
      for (const ck of touched) {
        chunks.markLazy(ck)
        const [a, b, c] = ck.split(',').map(Number)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) chunks.markLazy(`${a + dx},${b},${c + dz}`)
      }
    }
  }

  // One floating island, its staircase and what stands on it.
  _island(isl, put) {
    const { x: ix, y: iy, z: iz, r, kind } = isl
    const top = kind === 'cloud' ? 'whitewool' : kind === 'garden' ? 'grass' : kind === 'gold' ? 'calcite' : 'smoothquartz'
    const body = kind === 'cloud' ? 'whitewool' : 'quartzbricks'
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const x = ix + dx
        const z = iz + dz
        // A wobbly round edge.
        const d = Math.hypot(dx, dz) / (r * (1 + fbm(x, z, 1 / 6, 1, 413) * 0.2))
        if (d > 1) continue
        put(x, iy, z, top)
        // Underneath: a hanging cone, deepest in the middle.
        const depth = Math.round((1 - d) * r * 0.9 + 1 + hash2(x, z, 415) * 2)
        for (let k = 1; k <= depth; k++) {
          const y = iy - k
          const gold = kind === 'gold' && hash2(x + y, z, 417) < 0.12
          put(x, y, z, gold ? 'gold' : k === depth && kind !== 'cloud' ? 'whitewool' : body)
        }
        if (kind === 'garden' && d < 0.8 && hash2(x, z, 419) < 0.05) put(x, iy + 1, z, 'glowstone')
        if (kind === 'gold' && d < 0.5 && hash2(x, z, 421) < 0.1) put(x, iy + 1, z, 'gold')
      }
    }
    if (kind === 'temple') this._temple(ix, iy, iz, Math.min(3, r - 2), put)
    // The staircase up from the cloud floor: a quartz post with steps of
    // cloud winding round it, the last one level with the island's top.
    const steps = iy - HEAVEN_FLOOR
    for (let i = 1; i <= steps; i++) {
      const [ox, oz] = RING[i % RING.length]
      put(isl.sx + ox, HEAVEN_FLOOR + i, isl.sz + oz, 'whitewool')
      put(isl.sx, HEAVEN_FLOOR + i, isl.sz, 'quartzpillar')
    }
    // From the top step to the island's edge: a short cloud bridge.
    const [lx, lz] = RING[steps % RING.length]
    const fx = isl.sx + lx
    const fz = isl.sz + lz
    const len = Math.ceil(Math.hypot(ix - fx, iz - fz))
    for (let s = 1; s < len; s++) put(Math.round(fx + ((ix - fx) * s) / len), iy, Math.round(fz + ((iz - fz) * s) / len), 'whitewool')
  }

  // A little open temple: four pillars, a quartz roof with glowstone in
  // the middle, a gold altar.
  _temple(x, y, z, h, put) {
    const half = Math.max(2, h)
    for (const [sx, sz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      for (let k = 1; k <= 4; k++) put(x + sx, y + k, z + sz, 'quartzpillar')
    }
    for (let dx = -half; dx <= half; dx++) {
      for (let dz = -half; dz <= half; dz++) put(x + dx, y + 5, z + dz, dx === 0 && dz === 0 ? 'glowstone' : 'quartzbricks')
    }
    put(x, y + 1, z, 'gold')
  }

  _drop(key) {
    const rec = this.cols.get(key)
    if (!rec) return
    this.cols.delete(key)
    const world = this.world
    for (const k of rec.keys) {
      if (!world.terrainKeys.has(k)) continue
      world.terrainKeys.delete(k)
      this.bm._dropTerrainBlock(k)
    }
  }
}

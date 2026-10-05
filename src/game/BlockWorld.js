// Runs the real survival game on a block map (2026-10-05, Gaymi: "bring
// all the current features in map 1 to map editor and map 3"). Game.js's
// _enterBlockWorld lends the Map Editor's meshes for the map (BuildMode's
// worldRoot) to the game scene, far away from Map 1's city, and this file
// turns the map's blocks into what Map 1's systems already read:
//
// - colliders: Box3 walls for PlayerController/ZombieManager, merged into
//   as few boxes as possible (a building wall is one box, not hundreds).
//   Each box stops BOX_EPS short of its top and bottom, so standing on a
//   block (feet exactly on its top) or walking under a 2-block doorway
//   (head exactly at the lintel) doesn't count as touching it.
// - surfaces: the meshes the player stands on and bullets hit.
// - a street grid for zombies: where they may spawn (open street outside
//   the camp) and a walking-distance field from the player, so they walk
//   around buildings instead of into them (Map 1's zombies walk straight).
// - ladders: block ladders the player can climb (PlayerController's
//   nearLadder, which Map 1 only sets at the Elevator Tower).
import * as THREE from 'three'

// World units per block. The player is 2 units tall with eyes at 1.7 -
// 1.2 lets them through Map 3's 2-block doors and 2-high ground floors,
// and a half-block step (0.6) is still a walkable stair step.
export const BLOCK_WORLD_SCALE = 1.2
// Far from Map 1's city (about +-375), so nothing of Map 1 is ever in
// view (the camera only sees ~155 units) or close enough to trigger.
export const BLOCK_WORLD_ORIGIN = new THREE.Vector3(3000, 0, 3000)
const BOX_EPS = 0.02
const FIELD_INTERVAL_S = 0.4
const LADDER_REACH = 0.9 // world units from a ladder's cell center
const CAMP_SPAWN_MARGIN = 6 // cells kept clear of zombies around the camp

export class BlockWorld {
  constructor(buildMode, { map3Zone = null } = {}) {
    this.bm = buildMode
    this.S = BLOCK_WORLD_SCALE
    this.origin = BLOCK_WORLD_ORIGIN
    this.colliders = []
    this.ladders = new Map() // "x,z" -> { x, z, bottomY, topY } in world units
    this._solid = new Set()
    this._readBlocks()
    this.surfaces = buildMode.gameSurfaceMeshes()
    this.zone = map3Zone
    this.safeZone = map3Zone ? this._safeZoneFromCamp(map3Zone) : null
    this._buildStreetGrid()
    this.start = this._findStart()
    this._field = null
    this._fieldAge = Infinity
    this._fieldFrom = ''
  }

  // --- coordinates ---
  toWorld(x, z) {
    return [this.origin.x + (x + 0.5) * this.S, this.origin.z + (z + 0.5) * this.S]
  }

  toCell(wx, wz) {
    return [Math.floor((wx - this.origin.x) / this.S), Math.floor((wz - this.origin.z) / this.S)]
  }

  // --- blocks -> colliders ---
  _readBlocks() {
    const bm = this.bm
    const layers = new Map() // y -> Set of "x,z"
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    const ladderCells = []
    for (const [key, type] of bm._blocks) {
      const kind = bm.gameCellKind(type)
      const [x, y, z] = key.split(',').map(Number)
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (z < z0) z0 = z
      if (z > z1) z1 = z
      if (kind === 'ladder') ladderCells.push([x, y, z])
      if (kind !== 'solid') continue
      this._solid.add(key)
      let layer = layers.get(y)
      if (!layer) layers.set(y, (layer = new Set()))
      layer.add(`${x},${z}`)
    }
    this.bounds = { x0, x1, z0, z1 }
    this._mergeColliders(layers)
    this._readLadders(ladderCells)
  }

  // Each layer is cut into rectangles (runs along x, stacked along z), then
  // identical rectangles on consecutive layers become one tall box.
  _mergeColliders(layers) {
    const open = new Map() // "x0,x1,z0,z1" -> { y0, y1 }
    const ys = [...layers.keys()].sort((a, b) => a - b)
    const close = (k, box) => {
      const [ax0, ax1, az0, az1] = k.split(',').map(Number)
      const S = this.S
      this.colliders.push(new THREE.Box3(
        new THREE.Vector3(this.origin.x + ax0 * S, box.y0 * S + BOX_EPS, this.origin.z + az0 * S),
        new THREE.Vector3(this.origin.x + (ax1 + 1) * S, (box.y1 + 1) * S - BOX_EPS, this.origin.z + (az1 + 1) * S),
      ))
    }
    let prevY = null
    for (const y of ys) {
      const rects = this._layerRects(layers.get(y))
      const seen = new Set()
      for (const r of rects) {
        const k = r.join(',')
        seen.add(k)
        const box = open.get(k)
        if (box && prevY === y - 1) box.y1 = y
        else {
          if (box) close(k, box)
          open.set(k, { y0: y, y1: y })
        }
      }
      for (const [k, box] of open) {
        if (!seen.has(k)) {
          close(k, box)
          open.delete(k)
        }
      }
      prevY = y
    }
    for (const [k, box] of open) close(k, box)
  }

  _layerRects(cells) {
    const rows = new Map() // z -> sorted xs
    for (const c of cells) {
      const [x, z] = c.split(',').map(Number)
      let row = rows.get(z)
      if (!row) rows.set(z, (row = []))
      row.push(x)
    }
    const rects = []
    const active = new Map() // "x0,x1" -> rect [x0, x1, z0, z1]
    for (const z of [...rows.keys()].sort((a, b) => a - b)) {
      const xs = rows.get(z).sort((a, b) => a - b)
      const runs = []
      for (let i = 0; i < xs.length; i++) {
        let j = i
        while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
        runs.push(`${xs[i]},${xs[j]}`)
        i = j
      }
      const next = new Map()
      for (const run of runs) {
        const r = active.get(run)
        if (r && r[3] === z - 1) {
          r[3] = z
          next.set(run, r)
        } else {
          const [a, b] = run.split(',').map(Number)
          const nr = [a, b, z, z]
          rects.push(nr)
          next.set(run, nr)
        }
      }
      active.clear()
      for (const [k, v] of next) active.set(k, v)
    }
    return rects
  }

  // A ladder column: its lowest cell to one above its top (so you climb
  // out onto the floor it leads to).
  _readLadders(cells) {
    const cols = new Map()
    for (const [x, y, z] of cells) {
      const k = `${x},${z}`
      const c = cols.get(k) || { lo: y, hi: y }
      c.lo = Math.min(c.lo, y)
      c.hi = Math.max(c.hi, y)
      cols.set(k, c)
    }
    for (const [k, c] of cols) {
      const [x, z] = k.split(',').map(Number)
      const [wx, wz] = this.toWorld(x, z)
      // Where to step off at the top: a neighbor with floor at the
      // ladder's top and room to stand.
      let exit = null
      const top = c.hi + 1
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.isSolid(x + dx, top - 1, z + dz) || this.isSolid(x + dx, top, z + dz) || this.isSolid(x + dx, top + 1, z + dz)) continue
        const [ex, ez] = this.toWorld(x + dx, z + dz)
        exit = { x: ex, z: ez }
        break
      }
      this.ladders.set(k, { x: wx, z: wz, bottomY: c.lo * this.S, topY: top * this.S, exit })
    }
  }

  isSolid(x, y, z) {
    return this._solid.has(`${x},${y},${z}`)
  }

  // The ladder the player is standing at, or null.
  ladderNear(wx, wz, feetY) {
    const [cx, cz] = this.toCell(wx, wz)
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = this.ladders.get(`${cx + dx},${cz + dz}`)
      if (!l || feetY < l.bottomY - 0.5 || feetY > l.topY + 0.2) continue
      if (Math.hypot(wx - l.x, wz - l.z) <= LADDER_REACH) return l
    }
    return null
  }

  // --- camp ---
  _safeZoneFromCamp(z) {
    const S = this.S
    const halfX = ((z.x1 - z.x0) / 2) * S
    const halfZ = ((z.z1 - z.z0) / 2) * S
    const cx = this.origin.x + ((z.x0 + z.x1 + 1) / 2) * S
    const cz = this.origin.z + ((z.z0 + z.z1 + 1) / 2) * S
    // Map 1's safe zone is a circle (ZombieManager pushes zombies out of
    // it) - the camp's inner circle, so zombies stop at the walls.
    return { x: cx, z: cz, radius: Math.min(halfX, halfZ) - 0.5, halfX, halfZ, guardSpots: [] }
  }

  inCamp(x, z, margin = 0) {
    const zone = this.zone
    return !!zone && x >= zone.x0 - margin && x <= zone.x1 + margin && z >= zone.z0 - margin && z <= zone.z1 + margin
  }

  // --- streets ---
  // A street cell: solid ground under it and two empty cells above (a
  // zombie is about 1.5 blocks tall).
  _buildStreetGrid() {
    const { x0, x1, z0, z1 } = this.bounds
    this.gw = x1 - x0 + 1
    this.gh = z1 - z0 + 1
    this.walk = new Uint8Array(this.gw * this.gh)
    this.spawnCells = []
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (this.isSolid(x, 0, z) || this.isSolid(x, 1, z) || !this.isSolid(x, -1, z)) continue
      this.walk[(x - x0) * this.gh + (z - z0)] = 1
      if (!this.inCamp(x, z, CAMP_SPAWN_MARGIN) && x > x0 + 2 && x < x1 - 2 && z > z0 + 2 && z < z1 - 2) this.spawnCells.push([x, z])
    }
  }

  isStreet(x, z) {
    const { x0, z0 } = this.bounds
    const i = x - x0
    const j = z - z0
    return i >= 0 && j >= 0 && i < this.gw && j < this.gh && this.walk[i * this.gh + j] === 1
  }

  // Street spots as world points (Map 1's spawnPoints shape).
  spawnPoints(count = 40) {
    const out = []
    const step = Math.max(1, Math.floor(this.spawnCells.length / count))
    for (let i = 0; i < this.spawnCells.length && out.length < count; i += step) {
      const [wx, wz] = this.toWorld(...this.spawnCells[i])
      out.push(new THREE.Vector3(wx, 0, wz))
    }
    return out
  }

  // A random open street spot (airdrops and the like), as world x/z.
  randomStreetPoint() {
    const [x, z] = this.spawnCells[Math.floor(Math.random() * this.spawnCells.length)] || [0, 0]
    return this.toWorld(x, z)
  }

  // Moves a new zombie to the nearest open street outside the camp.
  fixSpawn(wx, wz) {
    const [cx, cz] = this.toCell(wx, wz)
    for (let r = 0; r <= 24; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const x = cx + dx
        const z = cz + dz
        if (this.isStreet(x, z) && !this.inCamp(x, z, 1)) return this.toWorld(x, z)
      }
    }
    const [x, z] = this.spawnCells[Math.floor(Math.random() * this.spawnCells.length)] || [0, 0]
    return this.toWorld(x, z)
  }

  // Walking distance (in cells) from the player over the streets,
  // refreshed a few times a second.
  updateField(dt, playerX, playerZ) {
    this._fieldAge += dt
    const [px, pz] = this.toCell(playerX, playerZ)
    const from = `${px},${pz}`
    if (this._fieldAge < FIELD_INTERVAL_S || (from === this._fieldFrom && this._field)) return
    this._fieldAge = 0
    this._fieldFrom = from
    const { x0, z0 } = this.bounds
    const n = this.gw * this.gh
    const dist = this._field && this._field.length === n ? this._field : new Uint16Array(n)
    dist.fill(65535)
    const queue = new Int32Array(n)
    let head = 0
    let tail = 0
    // Start from the street cells nearest the player (they may be indoors).
    for (let r = 0; r <= 6 && tail === 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.isStreet(px + dx, pz + dz)) continue
        const i = (px + dx - x0) * this.gh + (pz + dz - z0)
        dist[i] = r
        queue[tail++] = i
      }
    }
    while (head < tail) {
      const i = queue[head++]
      const ci = Math.floor(i / this.gh)
      const cj = i % this.gh
      const d = dist[i] + 1
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di
        const nj = cj + dj
        if (ni < 0 || nj < 0 || ni >= this.gw || nj >= this.gh) continue
        const k = ni * this.gh + nj
        if (this.walk[k] !== 1 || dist[k] <= d) continue
        dist[k] = d
        queue[tail++] = k
      }
    }
    this._field = dist
  }

  // Which way a zombie at (wx, wz) should walk, or null to go straight
  // (close to the player, or off the street grid).
  steer(wx, wz) {
    const dist = this._field
    if (!dist) return null
    const [cx, cz] = this.toCell(wx, wz)
    const { x0, z0 } = this.bounds
    const i = cx - x0
    const j = cz - z0
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return null
    const here = dist[i * this.gh + j]
    if (here === 65535 || here <= 2) return null
    let best = here
    let bx = 0
    let bz = 0
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di
      const nj = j + dj
      if (ni < 0 || nj < 0 || ni >= this.gw || nj >= this.gh) continue
      // No cutting a corner past a wall.
      if (di && dj && (this.walk[(i + di) * this.gh + j] !== 1 || this.walk[i * this.gh + j + dj] !== 1)) continue
      const d = dist[ni * this.gh + nj]
      if (d < best) {
        best = d
        bx = di
        bz = dj
      }
    }
    if (best === here) return null
    // Aim at the next cell's center, so zombies stay off the walls.
    const [tx, tz] = this.toWorld(cx + bx, cz + bz)
    const ax = tx - wx
    const az = tz - wz
    const len = Math.hypot(ax, az) || 1
    return [ax / len, az / len]
  }

  // --- where the player starts ---
  _findStart() {
    for (const [key, type] of this.bm._blocks) {
      if (type !== 'playerstart') continue
      const [x, y, z] = key.split(',').map(Number)
      const [wx, wz] = this.toWorld(x, z)
      return { x: wx, y: y * this.S, z: wz }
    }
    const [x, z] = this.spawnCells[0] || [0, 0]
    const [wx, wz] = this.toWorld(x, z)
    return { x: wx, y: 0, z: wz }
  }

  // A camp spot (Map 3's npcSpots, in cells) as a world point.
  campSpot(id) {
    const spot = this.zone?.npcSpots?.[id]
    if (!spot) return null
    const [wx, wz] = this.toWorld(spot[0], spot[1])
    return { x: wx, z: wz }
  }
}

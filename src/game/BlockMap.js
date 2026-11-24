// Every placed block, stored small (memory batch 3, 2026-11-24).
//
// Before: a Map of "x,y,z" text -> type, a second Map of the same blocks by
// number (fast lookups), a Set of text keys per 16x16x16 chunk (what the
// chunk mesher walks) and another Set of text keys for the open world's
// land - about 120 bytes per block, 113 MB after a ride at max view.
//
// Now each 16x16x16 chunk is one Uint16Array (2 bytes a cell) holding a
// number from a type list (the "palette": 1 = the first type ever stored,
// 2 = the next, ...; 0 = empty). The land marks are one bit per cell in the
// same chunk. Text keys are only made when something asks for them.
//
// The outside looks the same as before:
//   _blocks       Map-style: get/has/set/delete/clear/size/at/setAt and
//                 iteration as [key, type] ("x,y,z" keys).
//   _blocks.land  Set-style view of the land marks (OpenWorld.terrainKeys).
//   _blocks.cells Map-style read-only view "cx,cy,cz" -> that chunk's cube
//                 cells (BuildMode._chunkCells; BlockChunks.flush/_build).
// Iteration order is by chunk, then by cell - no longer the order blocks
// were placed in.

const SIZE = 16
const VOL = SIZE * SIZE * SIZE

// One whole-number cell as a single number (x, z within +-2^20, y within
// +-512) - the open world keeps its columns' cell lists like this.
const CELL_SPAN = 2 ** 21
const CELL_HALF = 2 ** 20
export function cellNumber(x, y, z) {
  return ((x + CELL_HALF) * CELL_SPAN + (z + CELL_HALF)) * 1024 + (y + 512)
}
// cellNumber backwards, into out = [x, y, z].
export function cellOfNumber(n, out) {
  const y = n % 1024
  const r = (n - y) / 1024
  const z = r % CELL_SPAN
  out[0] = (r - z) / CELL_SPAN - CELL_HALF
  out[1] = y - 512
  out[2] = z - CELL_HALF
  return out
}

function chunkId(cx, cy, cz) {
  return ((cx + 65536) * 131072 + (cz + 65536)) * 4096 + (cy + 2048)
}

// "x,y,z" (or "cx,cy,cz") -> PX, PY, PZ. False for anything that isn't
// three whole numbers.
let PX = 0, PY = 0, PZ = 0
function parse(key) {
  if (typeof key !== 'string') return false
  const a = key.indexOf(',')
  const b = key.indexOf(',', a + 1)
  if (a < 0 || b < 0) return false
  PX = +key.slice(0, a)
  PY = +key.slice(a + 1, b)
  PZ = +key.slice(b + 1)
  return (PX | 0) === PX && (PY | 0) === PY && (PZ | 0) === PZ
}
const whole = (x, y, z) => (x | 0) === x && (y | 0) === y && (z | 0) === z
const cellIndex = (x, y, z) => (x & 15) | ((z & 15) << 4) | ((y & 15) << 8)

class Chunk {
  constructor(cx, cy, cz, id) {
    this.cx = cx
    this.cy = cy
    this.cz = cz
    this.id = id
    this.types = new Uint16Array(VOL)
    this.count = 0 // blocks
    this.cubes = 0 // blocks the chunk mesher draws (BlockMap.setCubeTest)
    this.land = null // Uint8Array(512) bitset, made on the first land mark
    this.landCount = 0
    this._ck = null
    this._cells = null
  }
  get ck() {
    return this._ck || (this._ck = `${this.cx},${this.cy},${this.cz}`)
  }
  keyOf(i) {
    return `${this.cx * SIZE + (i & 15)},${this.cy * SIZE + (i >> 8)},${this.cz * SIZE + ((i >> 4) & 15)}`
  }
}

export class BlockMap {
  constructor() {
    this._chunks = new Map() // chunkId -> Chunk
    this._palette = [undefined] // number -> type
    this._index = new Map() // type -> number
    this._cube = [false] // number -> drawn by the chunk mesher
    this._isCube = null
    this._size = 0
    this._landSize = 0
    this._lastId = -1
    this._last = null
    this.land = new LandMarks(this)
    this.cells = new ChunkCellsView(this)
  }

  // Which types count as chunk cells (BlockChunks.isChunkType).
  setCubeTest(fn) {
    this._isCube = fn
    for (let i = 1; i < this._palette.length; i++) this._cube[i] = !!fn(this._palette[i])
    for (const c of this._chunks.values()) {
      let n = 0
      for (let i = 0; i < VOL; i++) if (this._cube[c.types[i]]) n++
      c.cubes = n
    }
  }

  _typeNumber(type) {
    let n = this._index.get(type)
    if (n === undefined) {
      n = this._palette.length
      if (n > 0xffff) throw new Error('BlockMap: too many block types')
      this._palette.push(type)
      this._index.set(type, n)
      this._cube.push(this._isCube ? !!this._isCube(type) : false)
    }
    return n
  }

  _chunk(x, y, z, make) {
    const cx = x >> 4, cy = y >> 4, cz = z >> 4
    const id = chunkId(cx, cy, cz)
    if (id === this._lastId) return this._last
    let c = this._chunks.get(id)
    if (!c) {
      if (!make) return undefined
      c = new Chunk(cx, cy, cz, id)
      this._chunks.set(id, c)
    }
    this._lastId = id
    this._last = c
    return c
  }

  _dropIfEmpty(c) {
    if (c.count || c.landCount) return
    this._chunks.delete(c.id)
    if (this._last === c) {
      this._last = null
      this._lastId = -1
    }
  }

  get size() {
    return this._size
  }

  at(x, y, z) {
    // Whole numbers only - anything else can't be a block cell.
    if (!whole(x, y, z)) return undefined
    const c = this._chunk(x, y, z, false)
    return c ? this._palette[c.types[cellIndex(x, y, z)]] : undefined
  }

  get(key) {
    return parse(key) ? this.at(PX, PY, PZ) : undefined
  }

  has(key) {
    return this.get(key) !== undefined
  }

  set(key, type) {
    if (parse(key)) this.setAt(key, PX, PY, PZ, type)
    return this
  }

  // set() when x, y, z are already known (key is not read).
  setAt(key, x, y, z, type) {
    if (type == null) return void this.deleteAt(x, y, z)
    if (!whole(x, y, z)) return
    const n = this._typeNumber(type)
    const c = this._chunk(x, y, z, true)
    const i = cellIndex(x, y, z)
    const old = c.types[i]
    if (old === n) return
    if (old === 0) {
      c.count++
      this._size++
    } else if (this._cube[old]) c.cubes--
    if (this._cube[n]) c.cubes++
    c.types[i] = n
  }

  delete(key) {
    return parse(key) ? this.deleteAt(PX, PY, PZ) : false
  }

  deleteAt(x, y, z) {
    if (!whole(x, y, z)) return false
    const c = this._chunk(x, y, z, false)
    if (!c) return false
    const i = cellIndex(x, y, z)
    const old = c.types[i]
    if (!old) return false
    c.types[i] = 0
    c.count--
    this._size--
    if (this._cube[old]) c.cubes--
    this._dropIfEmpty(c)
    return true
  }

  clear() {
    this._chunks.clear()
    this._size = 0
    this._landSize = 0
    this._last = null
    this._lastId = -1
  }

  // fn(x, y, z, type) for every block, no text keys made.
  forEachCell(fn) {
    const pal = this._palette
    for (const c of [...this._chunks.values()]) {
      if (!c.count) continue
      const t = c.types
      const bx = c.cx * SIZE, by = c.cy * SIZE, bz = c.cz * SIZE
      for (let i = 0; i < VOL; i++) if (t[i]) fn(bx + (i & 15), by + (i >> 8), bz + ((i >> 4) & 15), pal[t[i]])
    }
  }

  *entries() {
    const pal = this._palette
    for (const c of [...this._chunks.values()]) {
      if (!c.count) continue
      const t = c.types
      for (let i = 0; i < VOL; i++) if (t[i]) yield [c.keyOf(i), pal[t[i]]]
    }
  }

  *keys() {
    for (const [k] of this.entries()) yield k
  }

  *values() {
    for (const [, v] of this.entries()) yield v
  }

  [Symbol.iterator]() {
    return this.entries()
  }

  forEach(fn, thisArg) {
    for (const [k, v] of this.entries()) fn.call(thisArg, v, k, this)
  }

  // Bytes held by the block storage (memory measuring).
  bytes() {
    let n = 0
    for (const c of this._chunks.values()) n += VOL * 2 + (c.land ? 512 : 0) + 96
    return n
  }
}

// The open world's land marks: which cells its generator put down (they're
// left out of saves and grow back from the seed). Set-style, "x,y,z" keys.
class LandMarks {
  constructor(map) {
    this.m = map
  }
  get size() {
    return this.m._landSize
  }
  hasAt(x, y, z) {
    if (!whole(x, y, z)) return false
    const c = this.m._chunk(x, y, z, false)
    if (!c?.land) return false
    const i = cellIndex(x, y, z)
    return (c.land[i >> 3] & (1 << (i & 7))) !== 0
  }
  has(key) {
    return parse(key) && this.hasAt(PX, PY, PZ)
  }
  addAt(x, y, z) {
    if (!whole(x, y, z)) return this
    const c = this.m._chunk(x, y, z, true)
    if (!c.land) c.land = new Uint8Array(VOL / 8)
    const i = cellIndex(x, y, z)
    const bit = 1 << (i & 7)
    if (!(c.land[i >> 3] & bit)) {
      c.land[i >> 3] |= bit
      c.landCount++
      this.m._landSize++
    }
    return this
  }
  add(key) {
    if (parse(key)) this.addAt(PX, PY, PZ)
    return this
  }
  deleteAt(x, y, z) {
    if (!whole(x, y, z)) return false
    const c = this.m._chunk(x, y, z, false)
    if (!c?.land) return false
    const i = cellIndex(x, y, z)
    const bit = 1 << (i & 7)
    if (!(c.land[i >> 3] & bit)) return false
    c.land[i >> 3] &= ~bit
    this.m._landSize--
    if (--c.landCount === 0) c.land = null
    this.m._dropIfEmpty(c)
    return true
  }
  delete(key) {
    return parse(key) ? this.deleteAt(PX, PY, PZ) : false
  }
  clear() {
    for (const c of [...this.m._chunks.values()]) {
      if (!c.land) continue
      c.land = null
      c.landCount = 0
      this.m._dropIfEmpty(c)
    }
    this.m._landSize = 0
  }
  *values() {
    for (const c of [...this.m._chunks.values()]) {
      const l = c.land
      if (!l) continue
      for (let i = 0; i < VOL; i++) if (l[i >> 3] & (1 << (i & 7))) yield c.keyOf(i)
    }
  }
  keys() {
    return this.values()
  }
  *entries() {
    for (const k of this.values()) yield [k, k]
  }
  [Symbol.iterator]() {
    return this.values()
  }
  forEach(fn, thisArg) {
    for (const k of this.values()) fn.call(thisArg, k, k, this)
  }
}

// One chunk's cube cells (read-only, Set-style "x,y,z" keys).
class ChunkCells {
  constructor(map, c) {
    this.m = map
    this.c = c
  }
  get size() {
    return this.c.cubes
  }
  has(key) {
    if (!parse(key) || PX >> 4 !== this.c.cx || PY >> 4 !== this.c.cy || PZ >> 4 !== this.c.cz) return false
    return !!this.m._cube[this.c.types[cellIndex(PX, PY, PZ)]]
  }
  // Writes x, y, z of every cell into out (an Int32Array of 3 * 4096) and
  // returns how many - the chunk mesher's no-text way in.
  coords(out) {
    const { c } = this
    const t = c.types, cube = this.m._cube
    const bx = c.cx * SIZE, by = c.cy * SIZE, bz = c.cz * SIZE
    let n = 0
    for (let i = 0; i < VOL; i++) {
      if (!cube[t[i]]) continue
      out[n * 3] = bx + (i & 15)
      out[n * 3 + 1] = by + (i >> 8)
      out[n * 3 + 2] = bz + ((i >> 4) & 15)
      n++
    }
    return n
  }
  *values() {
    const { c } = this
    const t = c.types, cube = this.m._cube
    for (let i = 0; i < VOL; i++) if (cube[t[i]]) yield c.keyOf(i)
  }
  keys() {
    return this.values()
  }
  [Symbol.iterator]() {
    return this.values()
  }
  forEach(fn, thisArg) {
    for (const k of this.values()) fn.call(thisArg, k, k, this)
  }
}

// "cx,cy,cz" -> ChunkCells, for chunks with at least one cube cell.
class ChunkCellsView {
  constructor(map) {
    this.m = map
  }
  _of(c) {
    return c.cubes ? c._cells || (c._cells = new ChunkCells(this.m, c)) : undefined
  }
  get(ck) {
    if (!parse(ck)) return undefined
    const c = this.m._chunks.get(chunkId(PX, PY, PZ))
    return c && this._of(c)
  }
  has(ck) {
    return this.get(ck) !== undefined
  }
  get size() {
    let n = 0
    for (const c of this.m._chunks.values()) if (c.cubes) n++
    return n
  }
  *entries() {
    for (const c of [...this.m._chunks.values()]) if (c.cubes) yield [c.ck, this._of(c)]
  }
  *keys() {
    for (const [k] of this.entries()) yield k
  }
  *values() {
    for (const [, v] of this.entries()) yield v
  }
  [Symbol.iterator]() {
    return this.entries()
  }
  forEach(fn, thisArg) {
    for (const [k, v] of this.entries()) fn.call(thisArg, v, k, this)
  }
}

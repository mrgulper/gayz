// Real heights, lakes and rivers for the World Map game mode (2026-10-23,
// Gaymi: "the map is based on real life geographies like rivers mountains
// all should be based on real life ... not just random generated").
// Made by scripts/make-earth-terrain.py: public/earth/height.png (0.25
// degree heights) and public/earth/water.json (Natural Earth lakes and
// rivers). Loaded once, only when the World Map mode starts
// (loadEarthTerrain); OpenWorld's sampleLand reads it through the
// functions below, all in latitude / longitude degrees.
const Q = 4
const W = 360 * Q
const H = 180 * Q
// Lakes and rivers are filed by the 1-degree square they touch.
const cellOf = (lat, lon) => (Math.floor(90 - lat) * 360) + Math.floor(lon + 180)
// How far from a river's middle line it is looked for (degrees): wider than
// the widest river plus its banks.
const RIVER_REACH = 0.1

let heights = null // Float32Array of metres, sea negative
let lakeCells = null // cell -> [lake, ...]
let riverCells = null // cell -> Float32Array of [x1, y1, x2, y2, size] * n
let loading = null

export function earthTerrainReady() {
  return !!heights
}

// Starts loading (once); resolves true when ready, false if it failed (the
// World Map mode then keeps its made-up hills).
export function loadEarthTerrain() {
  if (!loading) {
    loading = Promise.all([loadHeights(), loadWater()])
      .then(() => true)
      .catch((e) => {
        console.warn('Earth terrain did not load', e)
        heights = null
        loading = null
        return false
      })
  }
  return loading
}

async function loadHeights() {
  const blob = await (await fetch('/earth/height.png')).blob()
  const img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  // (No document in the map's tile worker, MapTileWorker.js.)
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  img.close?.()
  const px = ctx.getImageData(0, 0, W, H).data
  canvas.width = canvas.height = 0
  const out = new Float32Array(W * H)
  for (let i = 0; i < out.length; i++) {
    const v = px[i * 4]
    out[i] = v >= 128 ? 8848 * ((v - 128) / 127) ** 2 : -11000 * ((127 - v) / 127) ** 2
  }
  heights = out
}

function decode(coded) {
  const pts = new Float32Array(coded.length)
  let x = 0
  let y = 0
  for (let k = 0; k < coded.length; k += 2) {
    x += coded[k]
    y += coded[k + 1]
    pts[k] = x / 100
    pts[k + 1] = y / 100
  }
  return pts
}

async function loadWater() {
  const data = await (await fetch('/earth/water.json')).json()
  const lc = new Map()
  for (const [level, ...coded] of data.l) {
    const rings = coded.map(decode)
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity
    for (let k = 0; k < rings[0].length; k += 2) {
      w = Math.min(w, rings[0][k]); e = Math.max(e, rings[0][k])
      s = Math.min(s, rings[0][k + 1]); n = Math.max(n, rings[0][k + 1])
    }
    const lake = { level, rings, w, e, s, n }
    for (let la = Math.floor(s); la <= Math.floor(n); la++) {
      for (let lo = Math.floor(w); lo <= Math.floor(e); lo++) {
        const c = cellOf(la + 0.5, lo + 0.5)
        if (!lc.has(c)) lc.set(c, [])
        lc.get(c).push(lake)
      }
    }
  }
  const rc = new Map()
  for (const [size, coded] of data.r) {
    const p = decode(coded)
    for (let k = 0; k + 3 < p.length; k += 2) {
      const x1 = p[k], y1 = p[k + 1], x2 = p[k + 2], y2 = p[k + 3]
      for (let la = Math.floor(Math.min(y1, y2) - RIVER_REACH); la <= Math.floor(Math.max(y1, y2) + RIVER_REACH); la++) {
        for (let lo = Math.floor(Math.min(x1, x2) - RIVER_REACH); lo <= Math.floor(Math.max(x1, x2) + RIVER_REACH); lo++) {
          const c = cellOf(la + 0.5, lo + 0.5)
          if (!rc.has(c)) rc.set(c, [])
          rc.get(c).push(x1, y1, x2, y2, size)
        }
      }
    }
  }
  for (const [c, list] of rc) rc.set(c, Float32Array.from(list))
  lakeCells = lc
  riverCells = rc
}

function heightPx(i, j) {
  const ii = ((i % W) + W) % W
  const jj = j < 0 ? 0 : j >= H ? H - 1 : j
  return heights[jj * W + ii]
}

// The real height (metres, negative = sea depth), blended smoothly
// between the 0.25-degree pixels.
export function earthHeight(lat, lon) {
  if (!heights) return 0
  const fx = (lon + 180) * Q - 0.5
  const fy = (90 - lat) * Q - 0.5
  const i = Math.floor(fx)
  const j = Math.floor(fy)
  const tx = fx - i
  const ty = fy - j
  const top = heightPx(i, j) * (1 - tx) + heightPx(i + 1, j) * tx
  const bottom = heightPx(i, j + 1) * (1 - tx) + heightPx(i + 1, j + 1) * tx
  return top * (1 - ty) + bottom * ty
}

function inRing(r, x, y) {
  let c = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const yi = r[i + 1], yj = r[j + 1]
    if ((yi > y) !== (yj > y) && x < ((r[j] - r[i]) * (y - yi)) / (yj - yi) + r[i]) c = !c
  }
  return c
}

// The lake at a spot (its surface height in metres) or null. Islands
// (the inner rings) are dry.
export function earthLakeAt(lat, lon) {
  const list = lakeCells?.get(cellOf(lat, lon))
  if (!list) return null
  for (const lake of list) {
    if (lon < lake.w || lon > lake.e || lat < lake.s || lat > lake.n) continue
    if (!inRing(lake.rings[0], lon, lat)) continue
    let island = false
    for (let k = 1; k < lake.rings.length && !island; k++) island = inRing(lake.rings[k], lon, lat)
    if (!island) return lake.level
  }
  return null
}

// Whether there is any lake in this spot's 1-degree square (cheap check).
export function earthLakeNear(lat, lon) {
  return !!lakeCells?.has(cellOf(lat, lon))
}

const nearest = { d: 0, size: 0 }
// The nearest river to a spot: { d: distance in degrees, size: 0 (big)
// .. 3 (small) } (the same object every call), or null if none is within
// RIVER_REACH.
export function earthRiverNear(lat, lon) {
  const segs = riverCells?.get(cellOf(lat, lon))
  if (!segs) return null
  let best = RIVER_REACH * RIVER_REACH
  let size = -1
  for (let k = 0; k < segs.length; k += 5) {
    const ax = segs[k], ay = segs[k + 1], bx = segs[k + 2], by = segs[k + 3]
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    let t = len ? ((lon - ax) * dx + (lat - ay) * dy) / len : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = ax + dx * t - lon
    const ey = ay + dy * t - lat
    const d = ex * ex + ey * ey
    if (d < best) {
      best = d
      size = segs[k + 4]
    }
  }
  if (size < 0) return null
  nearest.d = Math.sqrt(best)
  nearest.size = size
  return nearest
}

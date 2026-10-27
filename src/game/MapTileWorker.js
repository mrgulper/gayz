// Draws the big map's sharp tiles off the main thread (2026-10-26: a
// 128x128 tile took ~15 ms, so zoomed out the edges stayed blurry for
// seconds and drawing them slowed the game). The same land as the game's
// (OpenWorld.js sampleLand / tilePixels, same seed and mode); what only the
// game knows - planned villages, castles, paths and the city's tracks -
// comes with each request (OpenWorld._tileOverlay).
//
// in:  { type: 'init', colors }  every block's colour
//      { type: 'draw', id, gen, key, tx, tz, T, S, seed, flat, earth,
//        earthReady, built, paths, track }
// out: { id, gen, key, S, pixels } (RGBA, S x S), pixels null if this
//      land can't be drawn here
import { sampleLand, groundColor, builtColor, tilePixels, inCity, setWorldSeed, worldSeed, setFlatWorld, setEarthWorld } from './OpenWorld.js'
import { loadEarthTerrain, earthTerrainReady } from './EarthTerrain.js'

let colors = {}
const typeColor = (type) => colors[type] ?? 0x55aa44

// One at a time, in order (the Earth's heights may need loading first).
let queue = Promise.resolve()
self.onmessage = (e) => {
  const d = e.data
  if (d.type === 'init') colors = d.colors || {}
  else if (d.type === 'draw') queue = queue.then(() => draw(d))
}

async function draw(d) {
  let pixels = null
  try {
    if (worldSeed() !== d.seed) setWorldSeed(d.seed)
    setFlatWorld(d.flat)
    setEarthWorld(d.earth)
    // The game has the real Earth's heights: so must this.
    if (d.earthReady && !earthTerrainReady()) await loadEarthTerrain()
    if (!d.earthReady || earthTerrainReady()) pixels = tilePixels(d.tx, d.tz, d.T, d.S, cellFrom(d)).buffer
  } catch {
    pixels = null
  }
  self.postMessage({ id: d.id, gen: d.gen, key: d.key, S: d.S, pixels }, pixels ? [pixels] : [])
}

// A cell's colour, height and kind, as OpenWorld._cellColor.
function cellFrom(d) {
  const built = new Map()
  const paths = new Map()
  const track = new Set()
  for (let k = 0; k < d.built.length; k += 4) built.set(`${d.built[k]},${d.built[k + 1]}`, [d.built[k + 2], d.built[k + 3]])
  for (let k = 0; k < d.paths.length; k += 3) paths.set(`${d.paths[k]},${d.paths[k + 1]}`, d.paths[k + 2])
  for (let k = 0; k < d.track.length; k += 2) track.add(`${d.track[k]},${d.track[k + 1]}`)
  const any = built.size || paths.size || track.size
  return (x, z, out) => {
    if (inCity(x, z)) {
      out.c = -1
      return
    }
    const s = sampleLand(x, z)
    const key = any ? `${x},${z}` : ''
    const b = any ? built.get(key) : undefined
    out.h = b ? b[0] : Math.max(s.h, s.w)
    out.wet = b ? 2 : s.h < s.w ? 1 : 0
    if (b && b[1] >= 0) {
      out.c = builtColor(b[1], b[0])
      return
    }
    const p = any ? paths.get(key) : undefined
    if (p !== undefined && s.h >= s.w) {
      out.wet = 2
      out.c = p
      return
    }
    const onPath = s.h >= s.w && any && track.has(key)
    if (onPath) out.wet = 2
    out.c = groundColor(s, x, z, onPath, typeColor)
  }
}

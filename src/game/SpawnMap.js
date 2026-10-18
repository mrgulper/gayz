// The spawn map (2026-10-17, Gaymi: "make a world map before spawning,
// they can click where on the earth they wanna spawn", picked "real Earth
// map"). Before a solo game from the homepage (not a saved game being
// carried on, not a server) a blocky map of Earth opens: each 1-degree cell
// is the GayZ biome that fits that real place (EarthMapData.js). Click a
// spot and Spawn Here, or Start in the City Camp as before.
//
// GayZ's land isn't a copy of Earth - it's its own seeded world with the
// same biomes - so picking a place means "start in land like that": the
// map point gives a starting guess in the world (x = longitude, z = minus
// latitude, DEG blocks a degree - so east on the map is east in the game)
// and findSpawn() searches outward from there for the nearest spot of that
// biome (then a similar one, then any dry land). Clicking the sea starts
// you on the nearest beach.
import { t } from './i18n.js'
import { BIOMES, SEA, sampleLand } from './OpenWorld.js'
import { EARTH_W, EARTH_H, EARTH_BIOMES, EARTH_RLE } from './EarthMapData.js'

const DEG = 120 // world blocks per degree for the starting guess
const SEARCH_STEP = 48
const SEARCH_MAX = 4800
const CITY_KEEP_OUT = 200 // never "spawn" right next to the city - that's the camp button

// Map colours per biome.
const COLORS = {
  ocean: [40, 80, 170], deepOcean: [20, 50, 130], frozenOcean: [120, 150, 200], warmOcean: [50, 120, 190],
  beach: [230, 215, 150], snowyBeach: [225, 225, 215], river: [50, 100, 200], plains: [120, 180, 70],
  forest: [60, 130, 50], birchForest: [110, 160, 80], darkForest: [40, 90, 40], cherryGrove: [240, 170, 200],
  taiga: [70, 110, 80], snowyTaiga: [170, 190, 190], snowyPlains: [240, 245, 250], iceSpikes: [190, 220, 250],
  desert: [225, 200, 120], savanna: [180, 170, 80], badlands: [200, 110, 60], jungle: [30, 140, 40],
  bambooJungle: [90, 170, 50], swamp: [70, 90, 60], mangroveSwamp: [80, 100, 50], mushroomFields: [150, 100, 150],
  mountains: [130, 130, 130], snowyPeaks: [220, 220, 230],
}
const WATER = new Set(['ocean', 'deepOcean', 'frozenOcean', 'warmOcean', 'river'])
// Close enough when the exact biome isn't near.
const SIMILAR = {
  desert: ['badlands', 'savanna'], badlands: ['desert', 'savanna'], savanna: ['desert', 'plains'],
  jungle: ['bambooJungle', 'mangroveSwamp', 'swamp'], bambooJungle: ['jungle'], swamp: ['mangroveSwamp', 'jungle'], mangroveSwamp: ['swamp', 'jungle'],
  snowyPlains: ['iceSpikes', 'snowyTaiga', 'snowyBeach'], iceSpikes: ['snowyPlains', 'snowyPeaks'], snowyTaiga: ['taiga', 'snowyPlains'],
  taiga: ['snowyTaiga', 'darkForest', 'forest'], mountains: ['snowyPeaks', 'taiga'], snowyPeaks: ['mountains', 'iceSpikes'],
  forest: ['birchForest', 'darkForest', 'plains'], birchForest: ['forest'], darkForest: ['forest'], cherryGrove: ['forest', 'birchForest'],
  plains: ['forest', 'savanna'], beach: ['snowyBeach', 'plains'], snowyBeach: ['beach', 'snowyPlains'], mushroomFields: ['plains'],
}

let grid = null
function cells() {
  if (grid) return grid
  grid = new Uint8Array(EARTH_W * EARTH_H)
  let i = 0
  for (const m of EARTH_RLE.matchAll(/(\d*)([a-z])/g)) {
    const n = Number(m[1] || 1)
    const b = m[2].charCodeAt(0) - 97
    grid.fill(b, i, i + n)
    i += n
  }
  return grid
}

// The Earth biome at a latitude / longitude.
export function earthBiome(lat, lon) {
  const i = Math.min(EARTH_W - 1, Math.max(0, Math.floor(lon + 180)))
  const j = Math.min(EARTH_H - 1, Math.max(0, Math.floor(90 - lat)))
  return EARTH_BIOMES[cells()[j * EARTH_W + i]]
}

// The nearest world spot (block x, z) of the biome for a map point, or null.
export function findSpawn(lat, lon, biome) {
  const want = WATER.has(biome) ? 'beach' : biome
  const tiers = [new Set([want]), new Set(SIMILAR[want] || [])]
  const x0 = Math.round(lon * DEG)
  const z0 = Math.round(-lat * DEG)
  let anyLand = null
  for (const tier of tiers) {
    if (!tier.size) continue
    for (let r = 0; r <= SEARCH_MAX; r += SEARCH_STEP) {
      const n = Math.max(1, Math.round((2 * Math.PI * r) / SEARCH_STEP))
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2
        const x = Math.round(x0 + Math.cos(a) * r)
        const z = Math.round(z0 + Math.sin(a) * r)
        if (Math.hypot(x, z) < CITY_KEEP_OUT) continue
        const s = sampleLand(x, z)
        if (s.h <= SEA || WATER.has(s.biome)) continue
        if (tier.has(s.biome)) return { x, z, biome: s.biome }
        if (!anyLand) anyLand = { x, z, biome: s.biome }
      }
    }
  }
  return anyLand
}

const fmt = (lat, lon) => `${Math.abs(Math.round(lat))}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(Math.round(lon))}°${lon >= 0 ? 'E' : 'W'}`
const biomeLabel = (b) => (BIOMES[b] ? t(BIOMES[b].key) : b)

// Opens the map. Resolves { lat, lon, biome } for a picked spot, or null
// for the city camp.
export function openSpawnMap() {
  let el = document.getElementById('spawn-map')
  if (!el) {
    el = document.createElement('div')
    el.id = 'spawn-map'
    el.innerHTML = `<div class="spawn-map-box">
      <h2 id="spawn-map-title"></h2>
      <p id="spawn-map-hint"></p>
      <div class="spawn-map-frame"><canvas id="spawn-map-canvas" width="${EARTH_W}" height="${EARTH_H}"></canvas><span id="spawn-map-pin" hidden></span></div>
      <p id="spawn-map-info"></p>
      <div class="spawn-map-buttons">
        <button type="button" id="spawn-map-camp"></button>
        <button type="button" id="spawn-map-go" disabled></button>
      </div>
    </div>`
    document.body.appendChild(el)
    const canvas = el.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(EARTH_W, EARTH_H)
    const g = cells()
    for (let i = 0; i < g.length; i++) {
      const c = COLORS[EARTH_BIOMES[g[i]]] || [0, 0, 0]
      img.data.set([c[0], c[1], c[2], 255], i * 4)
    }
    ctx.putImageData(img, 0, 0)
  }
  const set = (id, text) => { el.querySelector(id).textContent = text }
  set('#spawn-map-title', t('spawnMapTitle'))
  set('#spawn-map-hint', t('spawnMapHint'))
  set('#spawn-map-camp', t('spawnMapCamp'))
  set('#spawn-map-go', t('spawnMapGo'))
  set('#spawn-map-info', '')
  const canvas = el.querySelector('canvas')
  const pin = el.querySelector('#spawn-map-pin')
  const go = el.querySelector('#spawn-map-go')
  pin.hidden = true
  go.disabled = true
  el.style.display = 'flex'
  try { document.exitPointerLock() } catch { /* not locked */ }
  return new Promise((resolve) => {
    let picked = null
    const at = (e) => {
      const r = canvas.getBoundingClientRect()
      const fx = Math.min(0.9999, Math.max(0, (e.clientX - r.left) / r.width))
      const fy = Math.min(0.9999, Math.max(0, (e.clientY - r.top) / r.height))
      const lon = fx * 360 - 180
      const lat = 90 - fy * 180
      return { lat, lon, fx, fy, biome: earthBiome(lat, lon) }
    }
    const describe = (p) => (WATER.has(p.biome) ? t('spawnMapSea') : `${biomeLabel(p.biome)} · ${fmt(p.lat, p.lon)}`)
    const onMove = (e) => { if (!picked) set('#spawn-map-info', describe(at(e))) }
    const onClick = (e) => {
      picked = at(e)
      pin.style.left = `${picked.fx * 100}%`
      pin.style.top = `${picked.fy * 100}%`
      pin.hidden = false
      go.disabled = false
      set('#spawn-map-info', describe(picked))
    }
    const done = (value) => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('click', onClick)
      el.querySelector('#spawn-map-camp').onclick = null
      go.onclick = null
      el.style.display = 'none'
      el._close = null
      resolve(value)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('click', onClick)
    el.querySelector('#spawn-map-camp').onclick = () => done(null)
    go.onclick = () => { if (picked) done({ lat: picked.lat, lon: picked.lon, biome: picked.biome }) }
    // Something else started the game (a test, or a weapon picked some
    // other way): close as the camp.
    el._close = () => done(null)
  })
}

export function closeSpawnMap() {
  document.getElementById('spawn-map')?._close?.()
}

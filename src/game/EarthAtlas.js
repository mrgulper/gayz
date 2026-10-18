// The real-world map on M (2026-10-18, Gaymi: "after spawning in when
// clicking m the map should be real based on the real world map", picked
// "a real-looking M map" - a map like an atlas, the game's own buildings
// stay). In the World Map game mode the big map in the middle (M twice)
// shows Earth once it's zoomed out past ATLAS_FROM blocks: real
// coastlines, natural land colours, country borders and names, real
// cities, and the latitude/longitude lines. Zoomed in closer it's the
// block map as before. World block (x, z) is longitude x / EARTH_DEG,
// latitude -z / EARTH_DEG (EarthGrid.js), so you sit where you spawned.
//
// Drawn from the same data as the spawn map (EarthMapData.js's biomes,
// EarthCountries.js's half-degree countries, Towns.js's cities), once,
// into one picture (PX pixels a degree) that every draw crops.
import { EARTH_W, EARTH_BIOMES } from './EarthMapData.js'
import { earthCells, EARTH_DEG } from './EarthGrid.js'
import { COUNTRY_W, COUNTRY_H, EARTH_COUNTRIES, COUNTRY_RLE } from './EarthCountries.js'
import { CITIES } from './Towns.js'

// Blocks across the map past which it's the atlas instead of blocks (the block map's own
// widest zoom, MAP_MAX_SPAN in BuildTryMode.js).
export const ATLAS_FROM = 960
// Blocks across the map when it opens in the World Map mode (~30 degrees).
export const ATLAS_OPEN_SPAN = 30 * EARTH_DEG
// The whole Earth across.
export const ATLAS_MAX_SPAN = 360 * EARTH_DEG
const PX = 8

// Natural colours, like a printed atlas (lighter than the spawn map's
// block colours): sea blues, greens for forests, sand for deserts, white
// for snow and ice.
const LAND = {
  // Beaches are too thin to see at this scale: the land beside them.
  beach: [176, 206, 132], snowyBeach: [150, 182, 140], plains: [176, 206, 132], forest: [118, 168, 102],
  birchForest: [150, 190, 120], darkForest: [92, 140, 88], cherryGrove: [170, 200, 130], taiga: [128, 160, 120],
  snowyTaiga: [196, 212, 206], snowyPlains: [244, 247, 250], iceSpikes: [232, 242, 250], desert: [238, 214, 160],
  savanna: [214, 206, 140], badlands: [214, 160, 112], jungle: [96, 160, 86], bambooJungle: [120, 176, 96],
  swamp: [120, 150, 104], mangroveSwamp: [110, 148, 100], mushroomFields: [176, 196, 140], mountains: [176, 166, 148],
  snowyPeaks: [236, 236, 240],
}
const SEA = [120, 176, 222]
const SEA_DEEP = [86, 146, 204]
const SEA_ICE = [196, 220, 238]

let countryGrid = null
function countryCells() {
  if (countryGrid) return countryGrid
  countryGrid = new Uint8Array(COUNTRY_W * COUNTRY_H)
  let i = 0
  for (const run of COUNTRY_RLE.split(' ')) {
    const [n, c] = run.split('.')
    const count = n ? parseInt(n, 16) : 1
    countryGrid.fill(parseInt(c, 16), i, i + count)
    i += count
  }
  return countryGrid
}

let atlas = null
let labels = null

// The whole Earth, 360 * PX by 180 * PX pixels.
function atlasCanvas() {
  if (atlas) return atlas
  const g = earthCells()
  const cc = countryCells()
  // Half-degree land colours and a land mask, each scaled up smoothly;
  // then every pixel is land where the smoothed mask is over half - curved,
  // crisp coasts instead of half-degree steps or a blur.
  const small = document.createElement('canvas')
  small.width = COUNTRY_W
  small.height = COUNTRY_H
  const sctx = small.getContext('2d')
  const img = sctx.createImageData(COUNTRY_W, COUNTRY_H)
  for (let j = 0; j < COUNTRY_H; j++) {
    for (let i = 0; i < COUNTRY_W; i++) {
      const k = j * COUNTRY_W + i
      const biome = EARTH_BIOMES[g[(j >> 1) * EARTH_W + (i >> 1)]]
      // Land and sea follow the half-degree countries (sharper than the
      // 1-degree biomes); the mask rides in the alpha channel.
      const c = cc[k] ? LAND[biome] || LAND.plains : biome === 'deepOcean' ? SEA_DEEP : biome === 'frozenOcean' ? SEA_ICE : SEA
      img.data.set([c[0], c[1], c[2], cc[k] ? 255 : 0], k * 4)
    }
  }
  // Land colours blended with their land neighbours (two passes), so
  // biomes fade into each other instead of showing 1-degree squares.
  const d0 = img.data
  for (let pass = 0; pass < 2; pass++) {
    const src = new Uint8ClampedArray(d0)
    for (let j = 0; j < COUNTRY_H; j++) {
      for (let i = 0; i < COUNTRY_W; i++) {
        const k = (j * COUNTRY_W + i) * 4
        if (!src[k + 3]) continue
        let r = 0
        let gr = 0
        let b = 0
        let n = 0
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di
            const jj = j + dj
            if (ii < 0 || jj < 0 || ii >= COUNTRY_W || jj >= COUNTRY_H) continue
            const q = (jj * COUNTRY_W + ii) * 4
            if (!src[q + 3]) continue
            r += src[q]
            gr += src[q + 1]
            b += src[q + 2]
            n++
          }
        }
        d0[k] = r / n
        d0[k + 1] = gr / n
        d0[k + 2] = b / n
      }
    }
  }
  sctx.putImageData(img, 0, 0)
  atlas = document.createElement('canvas')
  atlas.width = 360 * PX
  atlas.height = 180 * PX
  const ctx = atlas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, atlas.width, atlas.height)
  const big = ctx.getImageData(0, 0, atlas.width, atlas.height)
  const d = big.data
  for (let p = 0; p < d.length; p += 4) {
    if (d[p + 3] >= 128) {
      // Smoothing darkens colours next to see-through pixels - undo it.
      const a = d[p + 3] / 255
      d[p] = Math.min(255, d[p] / a)
      d[p + 1] = Math.min(255, d[p + 1] / a)
      d[p + 2] = Math.min(255, d[p + 2] / a)
    } else {
      // Sea (its colour from the smoothed sea cells, the land's bleed
      // taken out): a little lighter near the coast, like shallows.
      const near = d[p + 3] / 128
      d[p] = SEA[0] + (170 - SEA[0]) * near * 0.5
      d[p + 1] = SEA[1] + (210 - SEA[1]) * near * 0.5
      d[p + 2] = SEA[2] + (236 - SEA[2]) * near * 0.5
    }
    d[p + 3] = 255
  }
  ctx.putImageData(big, 0, 0)
  // Latitude / longitude lines every 15 degrees.
  ctx.strokeStyle = 'rgba(40, 80, 130, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let lon = -165; lon < 180; lon += 15) {
    ctx.moveTo((lon + 180) * PX + 0.5, 0)
    ctx.lineTo((lon + 180) * PX + 0.5, atlas.height)
  }
  for (let lat = -75; lat < 90; lat += 15) {
    ctx.moveTo(0, (90 - lat) * PX + 0.5)
    ctx.lineTo(atlas.width, (90 - lat) * PX + 0.5)
  }
  ctx.stroke()
  // Country borders (dashed grey-brown), along the edges between
  // half-degree cells.
  const h = PX / 2
  const edges = (test) => {
    ctx.beginPath()
    for (let j = 0; j < COUNTRY_H; j++) {
      for (let i = 0; i < COUNTRY_W; i++) {
        const k = j * COUNTRY_W + i
        if (i + 1 < COUNTRY_W && test(cc[k], cc[k + 1])) {
          ctx.moveTo((i + 1) * h, j * h)
          ctx.lineTo((i + 1) * h, (j + 1) * h)
        }
        if (j + 1 < COUNTRY_H && test(cc[k], cc[k + COUNTRY_W])) {
          ctx.moveTo(i * h, (j + 1) * h)
          ctx.lineTo((i + 1) * h, (j + 1) * h)
        }
      }
    }
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(110, 80, 70, 0.75)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 2])
  edges((a, b) => a && b && a !== b)
  ctx.setLineDash([])
  return atlas
}

// Each country's name and middle - the middle of its biggest piece of
// land, so France is named in France, not between it and French Guiana -
// and its size, so small ones are only named zoomed in.
function countryLabels() {
  if (labels) return labels
  const cc = countryCells()
  const seen = new Uint8Array(cc.length)
  const best = EARTH_COUNTRIES.map(() => null)
  const stack = []
  for (let start = 0; start < cc.length; start++) {
    const c = cc[start]
    if (!c || seen[start]) continue
    let x = 0
    let y = 0
    let n = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const k = stack.pop()
      const i = k % COUNTRY_W
      const j = (k - i) / COUNTRY_W
      x += i
      y += j
      n++
      for (const q of [i > 0 ? k - 1 : -1, i < COUNTRY_W - 1 ? k + 1 : -1, k - COUNTRY_W, k + COUNTRY_W]) {
        if (q >= 0 && q < cc.length && !seen[q] && cc[q] === c) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    if (!best[c - 1] || n > best[c - 1].n) best[c - 1] = { x: x / n, y: y / n, n }
  }
  labels = best.map((b, i) => (b ? { name: EARTH_COUNTRIES[i], lon: (b.x + 0.5) / 2 - 180, lat: 90 - (b.y + 0.5) / 2, size: b.n } : null)).filter(Boolean)
  return labels
}

// Draws the atlas onto a square canvas of `s` pixels showing `span`
// blocks from world (ox, oz) at its top-left corner.
export function drawEarthAtlas(ctx, s, ox, oz, span) {
  const map = atlasCanvas()
  const k = s / span
  const pxPerBlock = PX / EARTH_DEG
  ctx.fillStyle = `rgb(${SEA.join(',')})`
  ctx.fillRect(0, 0, s, s)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Source rectangle in atlas pixels (clipped to the picture).
  const sx0 = (ox + 180 * EARTH_DEG) * pxPerBlock
  const sy0 = (oz + 90 * EARTH_DEG) * pxPerBlock
  const sw = span * pxPerBlock
  const cx0 = Math.max(0, sx0)
  const cy0 = Math.max(0, sy0)
  const cx1 = Math.min(map.width, sx0 + sw)
  const cy1 = Math.min(map.height, sy0 + sw)
  if (cx1 > cx0 && cy1 > cy0) {
    const f = s / sw
    ctx.drawImage(map, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx0) * f, (cy0 - sy0) * f, (cx1 - cx0) * f, (cy1 - cy0) * f)
  }
  const deg = span / EARTH_DEG
  const at = (lat, lon) => [(lon * EARTH_DEG - ox) * k, (-lat * EARTH_DEG - oz) * k]
  const text = (str, x, y, size, color, weight = 600) => {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`
    ctx.lineWidth = Math.max(2, size / 4)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.strokeText(str, x, y)
    ctx.fillStyle = color
    ctx.fillText(str, x, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Country names: big countries when zoomed out, all of them closer in.
  const base = Math.max(10, Math.min(22, s / 42))
  const minSize = deg > 150 ? 900 : deg > 70 ? 250 : deg > 35 ? 60 : 0
  for (const l of countryLabels()) {
    if (l.size < minSize) continue
    const [x, y] = at(l.lat, l.lon)
    if (x < -50 || y < -20 || x > s + 50 || y > s + 20) continue
    text(l.name.toUpperCase(), x, y, base * (l.size > 900 ? 1 : 0.8), 'rgba(90, 60, 50, 0.9)', 700)
  }
  // Real cities: a dot and the name, once zoomed in a bit.
  if (deg <= 90) {
    for (const c of CITIES) {
      const [x, y] = at(c.lat, c.lon)
      if (x < -40 || y < -20 || x > s + 40 || y > s + 20) continue
      const r = Math.max(2.5, s / 220)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = Math.max(1.2, r / 2)
      ctx.strokeStyle = '#3a2a22'
      ctx.stroke()
      if (deg <= 45) {
        ctx.textAlign = 'left'
        text(c.name, x + r + 4, y, base * 0.8, '#2a1d16')
        ctx.textAlign = 'center'
      }
    }
  }
}

// The country at a world block ('' at sea).
export function atlasCountryAt(x, z) {
  const lon = x / EARTH_DEG
  const lat = -z / EARTH_DEG
  const i = Math.min(COUNTRY_W - 1, Math.max(0, Math.floor((lon + 180) * 2)))
  const j = Math.min(COUNTRY_H - 1, Math.max(0, Math.floor((90 - lat) * 2)))
  const c = countryCells()[j * COUNTRY_W + i]
  return c ? EARTH_COUNTRIES[c - 1] : ''
}

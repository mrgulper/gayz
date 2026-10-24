// The real-world map on M (2026-10-18, Gaymi: "after spawning in when
// clicking m the map should be real based on the real world map"; then "dont
// make a 3d circle actually just make a square map but you can move it ...
// each land must be full"). In the World Map game mode the big map in the
// middle (M twice) is this atlas at every zoom - real coastlines, natural
// land colours, country borders and names, real cities, latitude lines,
// and closer in the states/provinces and cities of where you are
// (EarthPlaces.js). It never turns into the block map. World block (x, z)
// is longitude x / EARTH_DEG, latitude -z / EARTH_DEG (EarthGrid.js), so you
// sit where you spawned. The spawn map (SpawnMap.js) draws it too.
//
// Drawn from the same data as the spawn map (EarthMapData.js's biomes,
// EarthCountries.js's half-degree countries, Towns.js's cities), once,
// into one picture (PX pixels a degree) that every draw crops.
import { EARTH_W, EARTH_H, EARTH_BIOMES } from './EarthMapData.js'
import { earthCells } from './EarthGrid.js'
import { COUNTRY_W, COUNTRY_H, EARTH_COUNTRIES, COUNTRY_RLE } from './EarthCountries.js'
import { CITIES } from './Towns.js'

const PX = 8
// Land colour pixels a degree, how far (degrees) biome edges wobble, and
// the blur radius (pixels) that softens them.
const Q = 2
const WOBBLE = 3.5
const BLUR_R = 4

// Smooth random wobble, -1..1, the same every time.
function noise2(x, y) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const h = (a, b) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263)
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295
  }
  const fx = x - xi
  const fy = y - yi
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const top = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx
  const bottom = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx
  return (top + (bottom - top) * sy) * 2 - 1
}
function wobble(lon, lat, seed) {
  return noise2(lon / 6 + seed, lat / 6) * 0.55 + noise2(lon / 2.2 + seed, lat / 2.2 + 31) * 0.3 + noise2(lon / 0.8 + seed, lat / 0.8 + 77) * 0.15
}

// Natural colours, like a printed atlas (lighter than the spawn map's
// block colours): sea blues, greens for forests, sand for deserts, white
// for snow and ice.
const LAND = {
  // Beaches are too thin to see at this scale: the land beside them.
  beach: [176, 206, 132], snowyBeach: [206, 218, 214], plains: [176, 206, 132], forest: [118, 168, 102],
  birchForest: [150, 190, 120], darkForest: [92, 140, 88], cherryGrove: [170, 200, 130], taiga: [128, 160, 120],
  snowyTaiga: [196, 212, 206], snowyPlains: [244, 247, 250], iceSpikes: [232, 242, 250], desert: [238, 214, 160],
  savanna: [214, 206, 140], badlands: [206, 172, 124], jungle: [96, 160, 86], bambooJungle: [120, 176, 96],
  swamp: [120, 150, 104], mangroveSwamp: [110, 148, 100], mushroomFields: [176, 196, 140], mountains: [172, 168, 136],
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
  // Land colours at a quarter degree, from the 1-degree biomes looked up a
  // little off the real spot (a smooth random wobble, up to WOBBLE
  // degrees) so their edges are wavy like real nature, not 1-degree
  // squares (2026-10-18, Gaymi: "dont just make the biome big squares or
  // rectangles make them look more nature"), then blurred among land
  // pixels. The land mask (half-degree countries) rides in the alpha
  // channel; scaled up smoothly and thresholded below.
  const SW = 360 * Q
  const SH = 180 * Q
  const small = document.createElement('canvas')
  small.width = SW
  small.height = SH
  const sctx = small.getContext('2d')
  const img = sctx.createImageData(SW, SH)
  const d0 = img.data
  const biomeAt = (lat, lon) => EARTH_BIOMES[g[Math.min(EARTH_H - 1, Math.max(0, Math.floor(90 - lat))) * EARTH_W + ((Math.floor(lon + 180) % EARTH_W) + EARTH_W) % EARTH_W]]
  for (let j = 0; j < SH; j++) {
    for (let i = 0; i < SW; i++) {
      const k = j * SW + i
      const lat = 90 - (j + 0.5) / Q
      const lon = (i + 0.5) / Q - 180
      const land = cc[Math.floor(j / (Q / 2)) * COUNTRY_W + Math.floor(i / (Q / 2))]
      let c
      if (land) {
        const wl = wobble(lon, lat, 0)
        const wo = wobble(lon, lat, 57)
        c = LAND[biomeAt(lat + wl * WOBBLE, lon + wo * WOBBLE)] || LAND[biomeAt(lat, lon)] || LAND.plains
      } else {
        const biome = biomeAt(lat, lon)
        c = biome === 'deepOcean' ? SEA_DEEP : biome === 'frozenOcean' ? SEA_ICE : SEA
      }
      d0[k * 4] = c[0]
      d0[k * 4 + 1] = c[1]
      d0[k * 4 + 2] = c[2]
      d0[k * 4 + 3] = land ? 255 : 0
    }
  }
  // Blurred among land pixels only (box blur, across then down, 3 times).
  const blur = (dx, dy) => {
    const src = new Uint8ClampedArray(d0)
    const R = BLUR_R
    for (let j = 0; j < SH; j++) {
      for (let i = 0; i < SW; i++) {
        const k = (j * SW + i) * 4
        if (!src[k + 3]) continue
        let r = 0
        let gr = 0
        let b = 0
        let n = 0
        for (let t = -R; t <= R; t++) {
          const ii = (i + t * dx + SW) % SW
          const jj = j + t * dy
          if (jj < 0 || jj >= SH) continue
          const q = (jj * SW + ii) * 4
          if (!src[q + 3]) continue
          r += src[q]
          gr += src[q + 1]
          b += src[q + 2]
          n++
        }
        d0[k] = r / n
        d0[k + 1] = gr / n
        d0[k + 2] = b / n
      }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    blur(1, 0)
    blur(0, 1)
  }
  // Sea pixels next to land take the land's colour (so the smooth scale-up
  // doesn't tint coasts blue); the coast itself comes from the mask.
  const src = new Uint8ClampedArray(d0)
  for (let j = 0; j < SH; j++) {
    for (let i = 0; i < SW; i++) {
      const k = (j * SW + i) * 4
      d0[k + 3] = 255
      if (src[k + 3]) continue
      let r = 0
      let gr = 0
      let b = 0
      let n = 0
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          const jj = j + dj
          if (jj < 0 || jj >= SH) continue
          const q = (jj * SW + ((i + di + SW) % SW)) * 4
          if (!src[q + 3]) continue
          r += src[q]
          gr += src[q + 1]
          b += src[q + 2]
          n++
        }
      }
      if (n) {
        d0[k] = r / n
        d0[k + 1] = gr / n
        d0[k + 2] = b / n
      }
    }
  }
  sctx.putImageData(img, 0, 0)
  // The land mask at the countries' half degree, scaled up smoothly 4x so
  // the threshold below gives curved coasts.
  const maskSmall = document.createElement('canvas')
  maskSmall.width = COUNTRY_W
  maskSmall.height = COUNTRY_H
  const mctx = maskSmall.getContext('2d')
  const mimg = mctx.createImageData(COUNTRY_W, COUNTRY_H)
  for (let k = 0; k < cc.length; k++) mimg.data.set([255, 255, 255, cc[k] ? 255 : 0], k * 4)
  mctx.putImageData(mimg, 0, 0)
  atlas = document.createElement('canvas')
  atlas.width = 360 * PX
  atlas.height = 180 * PX
  const ctx = atlas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(maskSmall, 0, 0, atlas.width, atlas.height)
  const mask = ctx.getImageData(0, 0, atlas.width, atlas.height).data
  ctx.clearRect(0, 0, atlas.width, atlas.height)
  ctx.drawImage(small, 0, 0, atlas.width, atlas.height)
  const big = ctx.getImageData(0, 0, atlas.width, atlas.height)
  const d = big.data
  for (let p = 0; p < d.length; p += 4) {
    if (mask[p + 3] < 128) {
      // Sea: a little lighter near the coast, like shallows.
      const near = mask[p + 3] / 128
      d[p] = SEA[0] + (170 - SEA[0]) * near * 0.5
      d[p + 1] = SEA[1] + (210 - SEA[1]) * near * 0.5
      d[p + 2] = SEA[2] + (236 - SEA[2]) * near * 0.5
    }
    d[p + 3] = 255
  }
  ctx.putImageData(big, 0, 0)
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

// Draws the atlas onto a canvas area w x h whose top-left corner is at
// longitude `west`, latitude `north`, `dpp` degrees per pixel. Options:
// countries (names), cities (Towns.js's, with names once close enough).
export function drawEarthView(ctx, w, h, west, north, dpp, { countries = true, cities = true } = {}) {
  const map = atlasCanvas()
  ctx.fillStyle = `rgb(${SEA.join(',')})`
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Source rectangle in atlas pixels (clipped to the picture).
  const sx0 = (west + 180) * PX
  const sy0 = (90 - north) * PX
  const sw = w * dpp * PX
  const sh = h * dpp * PX
  const cx0 = Math.max(0, sx0)
  const cy0 = Math.max(0, sy0)
  const cx1 = Math.min(map.width, sx0 + sw)
  const cy1 = Math.min(map.height, sy0 + sh)
  if (cx1 > cx0 && cy1 > cy0) {
    const f = 1 / (dpp * PX)
    ctx.drawImage(map, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx0) * f, (cy0 - sy0) * f, (cx1 - cx0) * f, (cy1 - cy0) * f)
  }
  const deg = w * dpp
  const at = (lat, lon) => [(lon - west) / dpp, (north - lat) / dpp]
  // Latitude / longitude lines (every 15 degrees, every 5 closer in), drawn
  // thin at any zoom.
  const step = deg > 60 ? 15 : 5
  ctx.strokeStyle = deg > 150 ? 'rgba(40, 80, 130, 0.1)' : 'rgba(40, 80, 130, 0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let lon = Math.ceil(west / step) * step; lon <= west + deg; lon += step) {
    const x = Math.round((lon - west) / dpp) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let lat = Math.floor(north / step) * step; lat >= north - h * dpp; lat -= step) {
    const y = Math.round((north - lat) / dpp) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const base = Math.max(10, Math.min(22, Math.min(w, h) / 42))
  if (countries) {
    // Country names: big countries when zoomed out, all of them closer in.
    const minSize = deg > 150 ? 900 : deg > 70 ? 250 : deg > 35 ? 60 : 0
    for (const l of countryLabels()) {
      if (l.size < minSize) continue
      const [x, y] = at(l.lat, l.lon)
      if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue
      mapText(ctx, l.name.toUpperCase(), x, y, base * (l.size > 900 ? 1 : 0.8), 'rgba(90, 60, 50, 0.9)', 700)
    }
  }
  // Real cities: a dot and the name, once zoomed in a bit.
  if (cities && deg <= 90) {
    for (const c of CITIES) {
      const [x, y] = at(c.lat, c.lon)
      if (x < -40 || y < -20 || x > w + 40 || y > h + 20) continue
      const r = Math.max(2.5, Math.min(w, h) / 220)
      cityDot(ctx, x, y, r)
      if (deg <= 45) {
        ctx.textAlign = 'left'
        mapText(ctx, c.name, x + r + 4, y, base * 0.8, '#2a1d16')
        ctx.textAlign = 'center'
      }
    }
  }
}

// Map text with a white halo, so it reads over land and sea.
export function mapText(ctx, str, x, y, size, color, weight = 600) {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`
  ctx.lineWidth = Math.max(2, size / 4)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  ctx.strokeText(str, x, y)
  ctx.fillStyle = color
  ctx.fillText(str, x, y)
}

export function cityDot(ctx, x, y, r, fill = '#ffffff') {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = Math.max(1.2, r / 2)
  ctx.strokeStyle = '#3a2a22'
  ctx.stroke()
}

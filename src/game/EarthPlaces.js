// The real world's states/provinces and cities (scripts/make-provinces.mjs,
// public/earth/<code>.json), shared by the spawn map (SpawnMap.js) and the
// in-game map and place name (BuildTryMode.js).
import { PROVINCE_FILES } from './EarthProvinces.js'
import { COUNTRY_W, COUNTRY_H, EARTH_COUNTRIES, COUNTRY_RLE } from './EarthCountries.js'

// --- States/provinces and cities (scripts/make-provinces.mjs) ---

const provinceCache = new Map()
// A country's provinces and cities, or null (no file, or offline and
// never loaded).
export async function loadProvinces(country) {
  const code = PROVINCE_FILES[country]
  if (!code) return null
  if (!provinceCache.has(code)) {
    provinceCache.set(code, fetch(`/earth/${code}.json`).then((r) => (r.ok ? r.json() : null)).then((d) => (d ? decodeProvinces(d) : null)).catch(() => null))
  }
  const got = await provinceCache.get(code)
  if (!got) provinceCache.delete(code)
  return got
}

function decodeProvinces(d) {
  const provinces = d.p.map(([name, type, packed]) => {
    const rings = packed.map((r) => {
      const pts = []
      let x = 0
      let y = 0
      for (let i = 0; i < r.length; i += 2) {
        x = i ? x + r[i] : r[i]
        y = i ? y + r[i + 1] : r[i + 1]
        pts.push([x / 100, y / 100])
      }
      return pts
    })
    const box = boxOf(rings.flat())
    // Label at the middle of the biggest ring.
    const big = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0] || [])
    const mid = big.reduce((m, p) => [m[0] + p[0] / big.length, m[1] + p[1] / big.length], [0, 0])
    return { name, type, rings, box, mid }
  })
  const cities = d.c.map(([name, lat, lon, prov, cap]) => ({ name, lat: lat / 100, lon: lon / 100, prov, cap }))
  return { provinces, cities, box: boxOf(provinces.flatMap((p) => p.rings.flat())) }
}

// [west, south, east, north] of [lon, lat] points.
export function boxOf(pts) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of pts) {
    if (x < b[0]) b[0] = x
    if (y < b[1]) b[1] = y
    if (x > b[2]) b[2] = x
    if (y > b[3]) b[3] = y
  }
  return b
}

function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export const inProvince = (p, lon, lat) => lon >= p.box[0] && lon <= p.box[2] && lat >= p.box[1] && lat <= p.box[3] && p.rings.some((r) => inRing(lon, lat, r))


let grid = null
// The spawn map's country at a latitude / longitude ('' at sea).
export function countryAt(lat, lon) {
  if (!grid) {
    grid = new Uint8Array(COUNTRY_W * COUNTRY_H)
    let i = 0
    for (const run of COUNTRY_RLE.split(' ')) {
      const [n, c] = run.split('.')
      const count = n ? parseInt(n, 16) : 1
      grid.fill(parseInt(c, 16), i, i + count)
      i += count
    }
  }
  const i = Math.min(COUNTRY_W - 1, Math.max(0, Math.floor((lon + 180) * 2)))
  const j = Math.min(COUNTRY_H - 1, Math.max(0, Math.floor((90 - lat) * 2)))
  const c = grid[j * COUNTRY_W + i]
  return c ? EARTH_COUNTRIES[c - 1] : ''
}

// The provinces data already loaded for a country (null while it loads -
// this starts loading it - or if there is none).
const ready = new Map()
export function provincesNow(country) {
  if (!country || !PROVINCE_FILES[country]) return null
  if (!ready.has(country)) {
    ready.set(country, null)
    loadProvinces(country).then((d) => { if (d) ready.set(country, d); else ready.delete(country) })
  }
  return ready.get(country)
}

// "Country · Province · City" for a spot (2026-10-18, Gaymi: "for the place
// name it country provenice then city on the map to the side"): the city
// is the nearest one within CITY_NEAR_DEG. Parts not known yet (still
// loading, at sea) are left out.
const CITY_NEAR_DEG = 0.6
export function placeNameAt(lat, lon) {
  const country = countryAt(lat, lon)
  if (!country) return ''
  const d = provincesNow(country)
  if (!d) return country
  const pi = d.provinces.findIndex((p) => inProvince(p, lon, lat))
  let city = ''
  let best = CITY_NEAR_DEG
  for (const c of d.cities) {
    const dist = Math.hypot(c.lat - lat, (c.lon - lon) * Math.cos((lat * Math.PI) / 180))
    if (dist < best) {
      best = dist
      city = c.name
    }
  }
  return [country, pi >= 0 ? d.provinces[pi].name : '', city].filter(Boolean).join(' · ')
}

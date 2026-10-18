// Makes the spawn map's states/provinces and cities (2026-10-18, Gaymi:
// "when clicking a country make it go into ... for canada its territories
// and provinces and when they click it the cities in that territories and
// provinces will pop up and they can pick to spawn there", every country).
//
// From Natural Earth (public domain): ne_10m_admin_1_states_provinces,
// simplified first with mapshaper so it's small -
//   mapshaper ne_10m_admin_1_states_provinces.geojson \
//     -filter-fields name,adm0_a3,admin,type_en -simplify 4% keep-shapes \
//     -o precision=0.01 format=geojson admin1s.geojson
// and ne_10m_populated_places_simple.geojson as it comes. Then:
//   node scripts/make-provinces.mjs admin1s.geojson places.geojson
//
// Writes public/earth/<code>.json per country (loaded when its country is
// clicked) and src/game/EarthProvinces.js (which spawn-map country has
// which file). Each file: { p: [[name, type, rings], ...], c: [[name,
// lat100, lon100, province index, capital], ...] } - rings are
// [lon100, lat100, dlon, dlat, ...] (hundredths of a degree, each point
// after the first as a step from the one before).
import fs from 'fs'
import path from 'path'
import { COUNTRY_W, COUNTRY_H, EARTH_COUNTRIES, COUNTRY_RLE } from '../src/game/EarthCountries.js'

const [adminPath, placesPath] = process.argv.slice(2)
const admin = JSON.parse(fs.readFileSync(adminPath, 'utf8')).features
const places = JSON.parse(fs.readFileSync(placesPath, 'utf8')).features
const CITIES_PER_PROVINCE = 14

const grid = new Uint8Array(COUNTRY_W * COUNTRY_H)
let gi = 0
for (const run of COUNTRY_RLE.split(' ')) {
  const [n, c] = run.split('.')
  const count = n ? parseInt(n, 16) : 1
  grid.fill(parseInt(c, 16), gi, gi + count)
  gi += count
}
const countryAt = (lat, lon) => {
  const i = Math.min(COUNTRY_W - 1, Math.max(0, Math.floor((lon + 180) * 2)))
  const j = Math.min(COUNTRY_H - 1, Math.max(0, Math.floor((90 - lat) * 2)))
  return grid[j * COUNTRY_W + i]
}

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [])

// Which spawn-map country each Natural Earth country code is: a vote of
// every province point that lands on the map's country grid.
const votes = new Map()
for (const f of admin) {
  if (!f.geometry) continue
  const a3 = f.properties.adm0_a3
  const v = votes.get(a3) || new Map()
  for (const poly of polysOf(f.geometry)) {
    for (const [lon, lat] of poly[0]) {
      const c = countryAt(lat, lon)
      if (c) v.set(c, (v.get(c) || 0) + 1)
    }
  }
  votes.set(a3, v)
}
const codeFor = {}
for (const [a3, v] of votes) {
  const best = [...v.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) continue
  const name = EARTH_COUNTRIES[best[0] - 1]
  // A country made of several codes keeps the one with the most points.
  if (!codeFor[name] || (votes.get(codeFor[name]).get(best[0]) || 0) < best[1]) codeFor[name] = a3
}

const inRing = (x, y, ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const outDir = path.resolve('public/earth')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const index = {}
let total = 0
for (const [name, a3] of Object.entries(codeFor).sort()) {
  const provs = admin.filter((f) => f.properties.adm0_a3 === a3 && f.geometry)
  const p = provs.map((f) => {
    const rings = []
    for (const poly of polysOf(f.geometry)) {
      const ring = poly[0]
      if (ring.length < 4) continue
      const out = []
      let px = 0
      let py = 0
      ring.forEach(([lon, lat], k) => {
        const x = Math.round(lon * 100)
        const y = Math.round(lat * 100)
        if (k === 0) out.push(x, y)
        else if (x !== px || y !== py) out.push(x - px, y - py)
        px = x
        py = y
      })
      rings.push(out)
    }
    return [f.properties.name || '?', f.properties.type_en || '', rings]
  })
  const geo = provs.map((f) => polysOf(f.geometry))
  // Cities: in this country's provinces (by where they are, not by name -
  // the two datasets spell some differently), biggest first.
  const byProv = p.map(() => [])
  for (const f of places) {
    const q = f.properties
    const lat = q.latitude
    const lon = q.longitude
    let k = geo.findIndex((polys) => polys.some((poly) => inRing(lon, lat, poly[0])))
    if (k < 0 && q.adm0_a3 === a3) k = p.findIndex((pr) => pr[0] === q.adm1name)
    if (k < 0) continue
    byProv[k].push([q.nameascii || q.name, Math.round(lat * 100), Math.round(lon * 100), k, q.adm0cap ? 2 : q.featurecla === 'Admin-1 capital' ? 1 : 0, q.pop_max || 0])
  }
  const c = []
  for (const list of byProv) {
    list.sort((a, b) => b[4] - a[4] || b[5] - a[5])
    for (const city of list.slice(0, CITIES_PER_PROVINCE)) c.push(city.slice(0, 5))
  }
  const json = JSON.stringify({ p, c })
  fs.writeFileSync(path.join(outDir, `${a3}.json`), json)
  index[name] = a3
  total += json.length
}
fs.writeFileSync('src/game/EarthProvinces.js', `// Made by scripts/make-provinces.mjs - don't edit by hand.
// Spawn-map country -> its states/provinces and cities file,
// public/earth/<code>.json (Natural Earth, public domain).
export const PROVINCE_FILES = ${JSON.stringify(index)}
`)
console.log(Object.keys(index).length, 'countries,', Math.round(total / 1024), 'KB')

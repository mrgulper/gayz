// The spawn map (2026-10-17, Gaymi: "make a world map before spawning,
// they can click where on the earth they wanna spawn", picked "real Earth
// map"). Before a solo game from the homepage (not a saved game being
// carried on, not a server) a blocky map of Earth opens: each 1-degree cell
// is the GayZ biome that fits that real place (EarthMapData.js). Click a
// spot and Spawn Here, or Spawn Randomly. (World Map mode only - the
// other modes start in the city camp.)
//
// GayZ's land isn't a copy of Earth - it's its own seeded world with the
// same biomes - so picking a place means "start in land like that": the
// map point gives a starting guess in the world (x = longitude, z = minus
// latitude, DEG blocks a degree - so east on the map is east in the game)
// and findSpawn() searches outward from there for the nearest spot of that
// biome (then a similar one, then any dry land). Clicking the sea starts
// you on the nearest beach.
//
// Countries (2026-10-18, Gaymi: "the world map with countries and make real
// buildings that are there in the world of that country ... if you don't
// want to pick add a spawn randomly button"): borders are drawn on the
// map from EarthCountries.js, the country under the pointer is named, and
// spawning in a country with a landmark (Landmarks.js - the Eiffel Tower in
// France, Big Ben in the UK...) builds it a short walk ahead of you. Spawn
// Randomly picks a random spot on land.
import { t } from './i18n.js'
import { BIOMES, SEA, sampleLand } from './OpenWorld.js'
import { earthBiome, EARTH_DEG } from './EarthGrid.js'
import { drawEarthView, mapText, cityDot } from './EarthAtlas.js'
import { loadProvinces, inProvince } from './EarthPlaces.js'
import { COUNTRY_W, COUNTRY_H, EARTH_COUNTRIES, COUNTRY_RLE } from './EarthCountries.js'
import { LANDMARKS } from './Landmarks.js'
import { cityNear } from './Towns.js'

const DEG = EARTH_DEG // world blocks per degree (EarthGrid.js)
const SEARCH_STEP = 48
const SEARCH_MAX = 4800
const CITY_KEEP_OUT = 200 // never "spawn" right next to the city - that's the camp button

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

// The country at a latitude / longitude ('' for the sea).
export function earthCountry(lat, lon) {
  const i = Math.min(COUNTRY_W - 1, Math.max(0, Math.floor((lon + 180) * 2)))
  const j = Math.min(COUNTRY_H - 1, Math.max(0, Math.floor((90 - lat) * 2)))
  const c = countryCells()[j * COUNTRY_W + i]
  return c ? EARTH_COUNTRIES[c - 1] : ''
}

// A random spot on land: { lat, lon, biome, country }.
export function randomLandPick(rand = Math.random) {
  for (let tries = 0; tries < 400; tries++) {
    const lat = Math.asin(rand() * 2 - 1) * (180 / Math.PI) * 0.92
    const lon = rand() * 360 - 180
    const biome = earthBiome(lat, lon)
    if (!WATER.has(biome) && lat > -60) return { lat, lon, biome, country: earthCountry(lat, lon), city: cityNear(lat, lon)?.name || '' }
  }
  return { lat: 23, lon: 10, biome: 'desert', country: earthCountry(23, 10) }
}

// The Earth biome at a latitude / longitude.
export { earthBiome }

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

// Opens the map (2026-10-18 rework, Gaymi: "remove the old panel behind it
// make the whole map take the page ... dont just make the biome big
// squares ... when clicking a country make it go into ... territories and
// provinces and when they click it the cities ... will pop up and they can
// pick to spawn there"). The whole page is the real-world atlas
// (EarthAtlas.js). Click a country: it zooms in and shows its states /
// provinces; click one: its cities appear on the map and in a list; pick
// one and Spawn Here. Back goes up a level. A country without province
// data (or offline before it was ever loaded) is picked by clicking a spot
// in it, like a province without cities. Resolves { lat, lon, biome,
// country, city, province } or null (closed some other way).
export function openSpawnMap() {
  let el = document.getElementById('spawn-map')
  if (!el) {
    el = document.createElement('div')
    el.id = 'spawn-map'
    el.innerHTML = `<canvas id="spawn-map-canvas"></canvas>
      <div class="spawn-map-top">
        <button type="button" id="spawn-map-back" hidden></button>
        <div class="spawn-map-heading"><h2 id="spawn-map-title"></h2><p id="spawn-map-hint"></p></div>
      </div>
      <div id="spawn-map-list" hidden></div>
      <div class="spawn-map-bottom">
        <p id="spawn-map-info"></p>
        <div class="spawn-map-buttons">
          <button type="button" id="spawn-map-random"></button>
          <button type="button" id="spawn-map-go" disabled></button>
        </div>
      </div>`
    document.body.appendChild(el)
  }
  const set = (id, text) => { el.querySelector(id).textContent = text }
  const canvas = el.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const go = el.querySelector('#spawn-map-go')
  const back = el.querySelector('#spawn-map-back')
  const list = el.querySelector('#spawn-map-list')
  set('#spawn-map-title', t('spawnMapTitle'))
  set('#spawn-map-go', t('spawnMapGo'))
  set('#spawn-map-random', t('spawnMapRandom'))
  set('#spawn-map-back', t('spawnMapBack'))
  el.style.display = 'block'
  try { document.exitPointerLock() } catch { /* not locked */ }

  // What's shown: level 'world' | 'country' | 'province'.
  const st = { level: 'world', country: '', data: null, prov: -1, hoverProv: -1, picked: null, hoverText: '' }
  // The view: top-left corner (west, north) and degrees per canvas pixel;
  // `to` is where it's sliding to.
  let W = 1
  let H = 1
  let view = null
  let to = null
  let anim = 0
  const worldView = () => {
    const dpp = Math.max(360 / W, 170 / H)
    return { west: -dpp * W / 2, north: 5 + dpp * H / 2, dpp }
  }
  const fit = (b, pad = 1.25) => {
    const dpp = Math.max(((b[2] - b[0]) * pad) / W, ((b[3] - b[1]) * pad) / (H * 0.78), 0.004)
    const cx = (b[0] + b[2]) / 2
    // A little room under it for the buttons.
    const cy = (b[1] + b[3]) / 2 - H * 0.04 * dpp
    return { west: cx - (dpp * W) / 2, north: cy + (dpp * H) / 2, dpp }
  }
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    W = Math.max(1, Math.round(el.clientWidth * ratio))
    H = Math.max(1, Math.round(el.clientHeight * ratio))
    canvas.width = W
    canvas.height = H
    const target = st.level === 'world' ? worldView() : st.level === 'country' ? fit(st.data.box) : fit(st.data.provinces[st.prov].box, 1.4)
    view = { ...target }
    to = null
    draw()
  }
  const slideTo = (target) => {
    to = target
    const from = { ...view }
    const start = performance.now()
    cancelAnimationFrame(anim)
    const step = (now) => {
      const k = Math.min(1, (now - start) / 450)
      const e = 1 - (1 - k) ** 3
      // Zoom in log space so it doesn't rush the last part.
      const dpp = Math.exp(Math.log(from.dpp) + (Math.log(to.dpp) - Math.log(from.dpp)) * e)
      const cx = from.west + (from.dpp * W) / 2 + (to.west + (to.dpp * W) / 2 - from.west - (from.dpp * W) / 2) * e
      const cy = from.north - (from.dpp * H) / 2 + (to.north - (to.dpp * H) / 2 - from.north + (from.dpp * H) / 2) * e
      view = { west: cx - (dpp * W) / 2, north: cy + (dpp * H) / 2, dpp }
      draw()
      if (k < 1) anim = requestAnimationFrame(step)
    }
    anim = requestAnimationFrame(step)
  }
  const toScreen = (lon, lat) => [(lon - view.west) / view.dpp, (view.north - lat) / view.dpp]
  const fromEvent = (e) => {
    const r = canvas.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    const y = ((e.clientY - r.top) / r.height) * H
    return { x, y, lon: view.west + x * view.dpp, lat: view.north - y * view.dpp }
  }
  const ratio = () => W / Math.max(1, el.clientWidth)

  const ringPath = (path, ring) => {
    ring.forEach(([lon, lat], i) => {
      const [x, y] = toScreen(lon, lat)
      if (i) path.lineTo(x, y)
      else path.moveTo(x, y)
    })
    path.closePath()
  }
  const provincePath = (p) => {
    const path = new Path2D()
    for (const r of p.rings) ringPath(path, r)
    return path
  }

  function draw() {
    if (!view) return
    const r = ratio()
    drawEarthView(ctx, W, H, view.west, view.north, view.dpp, { countries: st.level === 'world', cities: st.level === 'world' })
    if (st.data) {
      const { provinces, cities } = st.data
      // Everything outside the country dimmed.
      const shade = new Path2D()
      shade.rect(0, 0, W, H)
      const paths = provinces.map((p) => provincePath(p))
      for (const p of paths) shade.addPath(p)
      ctx.fillStyle = 'rgba(16, 24, 34, 0.45)'
      ctx.fill(shade, 'evenodd')
      paths.forEach((path, i) => {
        if (i === st.prov || i === st.hoverProv) {
          ctx.fillStyle = i === st.prov ? 'rgba(255, 215, 94, 0.28)' : 'rgba(255, 255, 255, 0.22)'
          ctx.fill(path)
        }
      })
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(70, 50, 40, 0.8)'
      ctx.lineWidth = 1.4 * r
      for (const path of paths) ctx.stroke(path)
      if (st.prov >= 0) {
        ctx.strokeStyle = '#ffd75e'
        ctx.lineWidth = 2.6 * r
        ctx.stroke(paths[st.prov])
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const size = 13 * r
      // Names never cover each other: one that would is left out (the
      // first ones - capitals, the biggest cities - win).
      const taken = []
      const fits = (x0, y0, w, h) => {
        if (taken.some((b) => x0 < b[2] && x0 + w > b[0] && y0 < b[3] && y0 + h > b[1])) return false
        taken.push([x0, y0, x0 + w, y0 + h])
        return true
      }
      // Province names (when they fit), at the country level.
      if (st.level === 'country') {
        for (const p of provinces) {
          const [x, y] = toScreen(p.mid[0], p.mid[1])
          const wide = (p.box[2] - p.box[0]) / view.dpp
          ctx.font = `700 ${size}px system-ui, sans-serif`
          const tw = ctx.measureText(p.name).width
          if (tw > wide * 1.3 && provinces.length > 1) continue
          if (!fits(x - tw / 2, y - size / 2, tw, size)) continue
          mapText(ctx, p.name, x, y, size, '#3a2416', 700)
        }
      }
      // Cities of the picked province.
      if (st.level === 'province') {
        for (const c of cities) {
          if (c.prov !== st.prov) continue
          const [x, y] = toScreen(c.lon, c.lat)
          const on = st.picked?.city === c.name
          cityDot(ctx, x, y, (on ? 7 : c.cap ? 5.5 : 4.5) * r, on ? '#ffd75e' : c.cap ? '#ffe9e0' : '#ffffff')
          const cs = (c.cap ? 14 : 12.5) * r
          ctx.font = `${c.cap ? 800 : 600} ${cs}px system-ui, sans-serif`
          if (!on && !fits(x + 9 * r, y - cs / 2, ctx.measureText(c.name).width, cs)) continue
          ctx.textAlign = 'left'
          mapText(ctx, c.name, x + 9 * r, y, cs, '#2a1d16', c.cap ? 800 : 600)
        }
      }
    }
    // A spot picked without a city.
    if (st.picked && !st.picked.city) {
      const [x, y] = toScreen(st.picked.lon, st.picked.lat)
      cityDot(ctx, x, y, 7 * r, '#ffd75e')
    }
  }

  const describe = (p) => {
    if (!p) return ''
    const lm = LANDMARKS[p.country]
    const city = p.city ? t('spawnMapCity', { name: p.city }) : ''
    return [city, p.province, p.country, biomeLabel(p.biome), fmt(p.lat, p.lon), !city && lm ? t('spawnMapLandmark', { name: t(lm.key) }) : ''].filter(Boolean).join(' · ')
  }
  const showInfo = () => set('#spawn-map-info', st.picked ? describe(st.picked) : st.hoverText)
  const pickAt = (lat, lon, extra = {}) => {
    st.picked = { lat, lon, biome: earthBiome(lat, lon), country: st.country || earthCountry(lat, lon), city: '', province: '', ...extra }
    go.disabled = false
    showInfo()
    draw()
  }
  const unpick = () => {
    st.picked = null
    go.disabled = true
  }
  const renderList = () => {
    if (st.level !== 'province') {
      list.hidden = true
      return
    }
    const cities = st.data.cities.filter((c) => c.prov === st.prov)
    list.hidden = !cities.length
    list.innerHTML = cities.map((c) => `<button type="button" class="${st.picked?.city === c.name ? 'active' : ''}${c.cap ? ' capital' : ''}" data-city="${st.data.cities.indexOf(c)}"></button>`).join('')
    list.querySelectorAll('button').forEach((b) => { b.textContent = st.data.cities[Number(b.dataset.city)].name })
  }
  const setLevel = (level) => {
    st.level = level
    back.hidden = level === 'world'
    const p = st.prov >= 0 && st.data ? st.data.provinces[st.prov] : null
    const cities = p ? st.data.cities.filter((c) => c.prov === st.prov) : []
    set('#spawn-map-hint', level === 'world' ? t('spawnMapHint') : level === 'country' ? (st.data ? t('spawnMapPickProvince', { country: st.country }) : t('spawnMapPickSpot')) : cities.length ? t('spawnMapPickCity', { province: p.name }) : t('spawnMapPickSpot'))
    renderList()
  }
  const pickCity = (c) => {
    const p = st.data.provinces[c.prov]
    pickAt(c.lat, c.lon, { city: c.name, province: p?.name || '' })
    renderList()
  }
  const openCountry = async (country, lat, lon) => {
    st.country = country
    st.hoverText = ''
    const data = await loadProvinces(country)
    if (st.country !== country) return
    st.data = data
    st.prov = -1
    unpick()
    if (data) {
      setLevel('country')
      slideTo(fit(data.box))
    } else {
      // No states/provinces to show: zoom in around the spot and pick it.
      setLevel('country')
      slideTo({ west: lon - 6 * (W / H), north: lat + 6, dpp: 12 / H })
      pickAt(lat, lon)
    }
  }
  const openProvince = (i) => {
    st.prov = i
    unpick()
    setLevel('province')
    slideTo(fit(st.data.provinces[i].box, 1.4))
    showInfo()
  }
  const goBack = () => {
    unpick()
    if (st.level === 'province') {
      st.prov = -1
      setLevel('country')
      slideTo(fit(st.data.box))
    } else {
      st.country = ''
      st.data = null
      st.prov = -1
      setLevel('world')
      slideTo(worldView())
    }
    showInfo()
  }

  const onMove = (e) => {
    const at = fromEvent(e)
    let hover = -1
    let text = ''
    if (st.level === 'world') {
      const c = earthCountry(at.lat, at.lon)
      text = c ? [c, biomeLabel(earthBiome(at.lat, at.lon))].join(' · ') : t('spawnMapSea')
    } else if (st.data) {
      hover = st.data.provinces.findIndex((p) => inProvince(p, at.lon, at.lat))
      if (hover >= 0) text = [st.data.provinces[hover].name, st.data.provinces[hover].type].filter(Boolean).join(' · ')
    }
    canvas.style.cursor = st.level === 'province' || hover >= 0 || (st.level === 'world' && earthCountry(at.lat, at.lon)) ? 'pointer' : 'default'
    if (hover !== st.hoverProv) {
      st.hoverProv = hover
      draw()
    }
    st.hoverText = text
    if (!st.picked) showInfo()
  }
  const onClick = (e) => {
    const at = fromEvent(e)
    if (st.level === 'world') {
      const c = earthCountry(at.lat, at.lon)
      if (c) openCountry(c, at.lat, at.lon)
      return
    }
    if (!st.data) {
      // A country without provinces: any spot on land in it.
      if (earthCountry(at.lat, at.lon) === st.country) pickAt(at.lat, at.lon)
      return
    }
    if (st.level === 'province') {
      // The nearest city dot within reach, else a spot in the province.
      const r = ratio()
      let best = null
      let bestD = 16 * r
      for (const c of st.data.cities) {
        if (c.prov !== st.prov) continue
        const [x, y] = toScreen(c.lon, c.lat)
        const d = Math.hypot(x - at.x, y - at.y)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (best) return pickCity(best)
      if (inProvince(st.data.provinces[st.prov], at.lon, at.lat)) {
        pickAt(at.lat, at.lon, { province: st.data.provinces[st.prov].name })
        renderList()
        return
      }
    }
    const i = st.data.provinces.findIndex((p) => inProvince(p, at.lon, at.lat))
    if (i >= 0) openProvince(i)
    else if (st.level === 'province') goBack()
  }
  const onList = (e) => {
    const b = e.target.closest('[data-city]')
    if (b) pickCity(st.data.cities[Number(b.dataset.city)])
  }

  setLevel('world')
  unpick()
  showInfo()
  resize()
  window.addEventListener('resize', resize)
  return new Promise((resolve) => {
    const done = (value) => {
      cancelAnimationFrame(anim)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('click', onClick)
      list.removeEventListener('click', onList)
      back.onclick = null
      el.querySelector('#spawn-map-random').onclick = null
      go.onclick = null
      el.style.display = 'none'
      el._close = null
      el._clientAt = null
      resolve(value)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('click', onClick)
    list.addEventListener('click', onList)
    back.onclick = goBack
    el.querySelector('#spawn-map-random').onclick = () => done(randomLandPick())
    go.onclick = () => {
      const p = st.picked
      if (p) done({ lat: p.lat, lon: p.lon, biome: p.biome, country: p.country, city: p.city, province: p.province })
    }
    // Something else started the game (a test, or a weapon picked some
    // other way): close as the camp.
    el._close = () => done(null)
    // Where a place is on the page right now (for tests).
    el._clientAt = (lat, lon) => {
      const r = canvas.getBoundingClientRect()
      const [x, y] = toScreen(lon, lat)
      return [r.left + (x / W) * r.width, r.top + (y / H) * r.height]
    }
  })
}

export function closeSpawnMap() {
  document.getElementById('spawn-map')?._close?.()
}

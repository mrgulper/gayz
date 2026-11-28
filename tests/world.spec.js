// Open world: biomes, places, underground, sky and weather.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { sampleLand, BIOMES } from '../src/game/OpenWorld.js'

// The editor's weather (BuildSky.js): rain and snow fall in the 3D world
// (BuildWeather.js) instead of the old screen overlays - only the
// sandstorm haze is still an overlay - the sky greys, the light dims and
// the fog comes in, and it's all gone once the editor closes. Random is
// the default and fits the biome (no snow in the desert).
test('Map Editor weather falls in the world and fits the biome', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const sky = g.buildMode.sky
    const w3 = sky.weather3d
    const shown = () => ['rain-overlay', 'rain-overlay-hard', 'snow-overlay', 'snow-overlay-hard', 'sandstorm-overlay'].filter((id) => document.getElementById(id).style.display === 'block' && document.getElementById(id).style.opacity !== '0') // (the sandstorm haze fades out)
    const out = { defaultWeather: sky.weather }
    for (const w of ['clear', 'lightRain', 'hardRain', 'lightSnow', 'hardSnow', 'hail', 'fog', 'sandstorm', 'eclipse']) {
      sky.weather = w
      sky._pickWeather()
      sky.apply()
      // Long enough for the old weather to fade out and the new one in.
      for (let i = 0; i < 400; i++) sky.update(1 / 30)
      out[w] = [shown().join(), w3.kind || '', w3.points.visible, sky.fogFactor < 0.99, sky._light < 0.99]
    }
    g._exitBuildMode()
    out.afterExit = [shown().join(), w3.kind || '', w3.points.visible]
    // Snow while standing somewhere dry re-rolls to weather a dry place can have.
    sky._climateAt = () => 'dry'
    const rolls = new Set()
    sky.weather = 'random'
    for (let i = 0; i < 40; i++) {
      sky._pickWeather()
      rolls.add(sky._now)
    }
    out.dryRolls = [...rolls].every((k) => ['clear', 'sandstorm', 'duststorm', 'heatwave'].includes(k))
    return out
  })

  expect(r).toEqual({
    defaultWeather: 'random',
    clear: ['', '', false, false, false],
    // Only fog, sandstorms and hard snow close the view in (2026-10-25).
    lightRain: ['', 'lightRain', true, false, true],
    hardRain: ['', 'hardRain', true, true, true],
    lightSnow: ['', 'lightSnow', true, false, true],
    hardSnow: ['', 'hardSnow', true, true, true],
    hail: ['', 'hail', true, false, true],
    fog: ['', '', false, true, true],
    // Its sand blows through the world too (2026-10-30).
    sandstorm: ['sandstorm-overlay', 'sandstorm', true, true, true],
    eclipse: ['', '', false, false, true],
    afterExit: ['', '', false],
    dryRolls: true,
  })
})

// Weather on the ground (2026-10-25): rain soaks the open ground and
// splashes, snow piles up, hail leaves ice, and it all goes again after;
// Potato draws half the rain, no splashes, no low clouds and no grass
// tufts; In Real Life grows grass tufts on grass blocks.
test('weather wets and whitens the ground, Potato stays light', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    g._applyGraphicsLevel('irl')
    await g._enterBuildMode()
    const bm = g.buildMode
    const sky = bm.sky
    const w3 = sky.weather3d
    const fx = bm._chunks.fx
    bm._applyGraphicsLook()
    const run = (s) => { for (let i = 0; i < s * 30; i++) { sky.update(1 / 30); bm.grassTufts.update(1 / 30) } }
    const set = (w) => { sky.weather = w; sky._pickWeather(); sky.apply() }
    const out = {}
    set('hardRain')
    run(40)
    out.rain = { wet: fx.wet.value > 0.9, splash: w3.splash.visible, low: sky.bodies.lowClouds.visible, tufts: bm.grassTufts.mesh.count > 0 }
    set('clear')
    run(200)
    out.dried = fx.wet.value
    set('hardSnow')
    run(120)
    out.snow = fx.snow.value > 0.9
    set('hail')
    run(60)
    out.hail = fx.ice.value > 0.9
    set('clear')
    run(300)
    out.melted = [fx.snow.value, fx.ice.value, fx.wet.value]
    g._applyGraphicsLevel('potato')
    bm._applyGraphicsLook()
    set('hardRain')
    run(10)
    sky.bodies.update(0.1, bm.camera, 0, 0.95, 1, sky._sky)
    out.potato = { drops: w3.points.geometry.drawRange.count * 2 === w3._count, splash: w3.splash.visible, low: sky.bodies.lowClouds.visible, tufts: bm.grassTufts.mesh.visible, pixels: g.renderer.domElement.style.imageRendering }
    g._exitBuildMode()
    out.afterExit = [fx.wet.value, w3.splash.visible]
    return out
  })

  expect(r).toEqual({
    rain: { wet: true, splash: true, low: true, tufts: true },
    dried: 0,
    snow: true,
    hail: true,
    melted: [0, 0, 0],
    potato: { drops: true, splash: false, low: false, tufts: false, pixels: 'pixelated' },
    afterExit: [0, false],
  })
})

// Map 1's open world (OpenWorld.js): land grows around the city out of
// seeded noise (a new seed every game, shared on a server), the roads leave
// through open gates, nothing out there is saved, and every biome is
// somewhere out there.
test('Map 1 has an open world with biomes around it', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = { active: w.active, gates: w._paths.size > 0 }
    // Grow the land just outside the east gate.
    w.update([{ x: 90, z: 2 }])
    out.columns = w.columns.size
    const surface = (x, z) => {
      for (let y = 80; y > -40; y--) if (b._blocks.has(`${x},${y},${z}`)) return [y, b._blocks.get(`${x},${y},${z}`)]
      return null
    }
    out.landOutside = !!surface(90, 2)
    // A road leaves the city at each gate and carries on as a track.
    const gate = b._map3Base().map.gates.find((gt) => gt.x > 40)
    const tx = Math.floor(gate.x + 0.5 + gate.dx * 8)
    const tz = Math.floor(gate.z + 0.5 + gate.dz * 8)
    w.update([{ x: tx, z: tz }])
    // A frayed edge may keep the land's own top, so look across the track.
    out.trackOutside = [-2, -1, 0, 1, 2].some((w) => ['dirtpath', 'gravel', 'coarsedirt', 'spruceplanks'].includes(surface(tx + Math.round(gate.dz * w), tz - Math.round(gate.dx * w))?.[1]))
    // The city isn't a square any more (CityShape.js): its corners are
    // land, grown in the city's own chunk columns, and no land is ever
    // grown on a city cell.
    w.update([{ x: -60, z: -60 }])
    out.cornerIsLand = !b._map3Base().map.blocks.some((bl) => bl.x === -62 && bl.z === -62) && w.isTerrain(`-62,${surface(-62, -62)?.[0]},-62`)
    // (Cave walls under the city are terrain too - Underground.js - so only
    // the surface counts.)
    out.noLandInCity = ![...w.terrainKeys].some((k) => { const [x, y, z] = k.split(',').map(Number); return y >= -1 && x >= -64 && x < 64 && z >= -64 && z < 64 && b._map3Base().map.blocks.some((bl) => bl.x === x && bl.z === z) })
    out.cityIrregular = b._map3Base().map.blocks.every((bl) => bl.x > -64 && bl.x < 63 && bl.z > -64 && bl.z < 63)
    // The land is never saved...
    const snap = b._snapshot().blocks
    out.landNotSaved = !snap.some((k) => k.x > 70)
    // ...and neither is anything changed out there (the land is new next game).
    const [y] = surface(90, 2)
    b.removeBlock(90, y, 2)
    b.placeBlock(91, y + 1, 2, 'brick')
    const diff = b._map3Diff()
    out.outsideNotSaved = !diff.removed.some((k) => +k.split(',')[0] > 63) && !diff.placed.some((k) => k.x > 63)
    // The same seed grows the same land (everyone on a server), another one
    // different land, and the brick out there is gone with the old land.
    w.reseed(1234)
    w.update([{ x: 90, z: 2 }])
    const first = []
    for (let x = 66; x < 110; x += 5) first.push(JSON.stringify(surface(x, 9)))
    out.brickGone = b._blocks.get(`91,${y + 1},2`) !== 'brick'
    w.reseed(1234)
    w.update([{ x: 90, z: 2 }])
    const again = []
    for (let x = 66; x < 110; x += 5) again.push(JSON.stringify(surface(x, 9)))
    out.sameLand = first.join() === again.join()
    w.reseed(98765)
    w.update([{ x: 90, z: 2 }])
    const other = []
    for (let x = 66; x < 110; x += 5) other.push(JSON.stringify(surface(x, 9)))
    out.newLand = other.join() !== first.join()
    out.cityKept = !!surface(0, 0)
    // Far columns are dropped again once you leave.
    w.update([{ x: 1500, z: 1500 }])
    for (let i = 0; i < 30; i++) w.update([{ x: 1500, z: 1500 }])
    out.dropped = !w.columns.has('5,0')
    // The biome under you shows by the minimap.
    b.toggleTryMode()
    b.tryMode.pos.set(1500.5, 60, 1500.5)
    b.tryMode._mapDrawAt = 0
    b.tryMode._drawMap(performance.now() + 1e6, 1500.5, 1500.5)
    out.biomeShown = document.getElementById('build-try-biome')?.textContent || ''
    // You can walk out of the old 128x128 square.
    b.tryMode.update(0.016, new Set())
    out.notClamped = b.tryMode.pos.x > 100
    // The big map in the middle frees the mouse and can be dragged and zoomed.
    const tm = b.tryMode
    while (tm._mapEl.dataset.size !== 'center') tm.cycleMap()
    out.mapInteractive = tm._mapEl.classList.contains('interactive') && !!document.getElementById('build-try-map-hint').textContent
    const c = tm._mapCanvas
    const box = c.getBoundingClientRect()
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + 100, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + 160, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: box.left + 160, clientY: box.top + 100, bubbles: true, pointerId: 1 }))
    out.panned = tm._mapPan.x < 0
    tm._mapEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    out.zoomedOut = tm._mapZoom > tm._mapOpenZoom()
    tm._mapDrawAt = 0
    tm._drawMap(performance.now() + 2e6, 1500.5, 1500.5)
    tm.cycleMap()
    out.mapBack = !tm._mapEl.classList.contains('interactive') && tm._mapZoom === 1 && tm._mapPan.x === 0
    b.toggleTryMode()
    g._exitBuildMode()
    return out
  })

  expect(r.mapInteractive).toBe(true)
  expect(r.panned).toBe(true)
  expect(r.zoomedOut).toBe(true)
  expect(r.mapBack).toBe(true)
  expect(r.active).toBe(true)
  expect(r.gates).toBe(true)
  expect(r.columns).toBeGreaterThan(0)
  expect(r.landOutside).toBe(true)
  expect(r.trackOutside).toBe(true)
  expect(r.cornerIsLand).toBe(true)
  expect(r.noLandInCity).toBe(true)
  expect(r.cityIrregular).toBe(true)
  expect(r.landNotSaved).toBe(true)
  expect(r.outsideNotSaved).toBe(true)
  expect(r.brickGone).toBe(true)
  expect(r.sameLand).toBe(true)
  expect(r.newLand).toBe(true)
  expect(r.cityKept).toBe(true)
  expect(r.dropped).toBe(true)
  expect(r.biomeShown.length).toBeGreaterThan(0)
  expect(r.notClamped).toBe(true)

})

// Villages, castles and bridges out in the land (WorldStructures.js): they
// grow with the land around them, say their name under the minimap, and
// trees keep clear of them.
test('the open world has villages, castles and bridges', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = {}
    for (let seed = 1; seed < 40 && Object.keys(out).length < 4; seed++) {
      w.reseed(seed)
      for (const p of w.placesNear(0, 0, 500)) {
        if (out[p.kind]) continue
        const plan = w._plansOver(p.x, p.z, p.x, p.z).find((q) => q.kind === p.kind)
        w.update([{ x: p.x, z: p.z }])
        for (let i = 0; i < 40; i++) w.update([{ x: p.x, z: p.z }])
        // Every block of its column under the player is in the world.
        const list = plan.byColumn.get(`${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`) || []
        let placed = 0
        for (let i = 0; i < list.length; i += 4) if (b._blocks.get(`${list[i]},${list[i + 1]},${list[i + 2]}`) === list[i + 3]) placed++
        out[p.kind] = { blocks: list.length / 4, placed, name: w.placeName(p.x, p.z), tree: w._claimed(p.x, p.z) }
      }
    }
    g._exitBuildMode()
    return out
  })
  expect(Object.keys(r).sort()).toEqual(['bridge', 'castle', 'pyramid', 'village'])
  for (const [kind, v] of Object.entries(r)) {
    expect(v.placed, kind).toBe(v.blocks)
    expect(v.name.length, kind).toBeGreaterThan(0)
    expect(v.tree, kind).toBe(true)
  }
})

// All 26 biomes are out there, within a long walk of the city.
test('Map 1 has 500 layers underground with ores, caves, walk-in entrances and the Demon Realm', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const u = w.under
    w.reseed(4242)
    const out = {}
    // A shaft dug straight down always has walls (the rock appears as
    // you dig), passes through different layers and ends on bedrock.
    const dig = (x, z) => {
      const types = new Set()
      let holes = 0
      let y = 60
      while (y > -1 && !b._blocks.has(`${x},${y},${z}`)) y--
      for (; y >= -505; y--) {
        // Fallen into a cave: its walls (and floor) grow around you.
        if (!b._blocks.has(`${x},${y},${z}`)) u._grow(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16))
        const type = b._blocks.get(`${x},${y},${z}`)
        if (!type) continue
        types.add(type)
        if (type === 'bedrock' && y <= -500) break
        b.removeBlock(x, y, z)
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${y},${z + dz}`
          // (The Demon Realm's caverns are open on purpose.)
          if (!b._blocks.has(k)) holes += y > -300 ? 1 : 0
          else types.add(b._blocks.get(k))
        }
      }
      return { types: [...types], holes, end: y }
    }
    w.update([{ x: 90, z: 2 }])
    const land = dig(90, 2)
    const city = dig(3, 5)
    const all = new Set([...land.types, ...city.types])
    out.endsOnBedrock = land.end === -500 && city.end === -500
    out.layers = ['stone', 'tuff', 'deepslate', 'smoothbasalt', 'blackstone', 'netherrack', 'bedrock'].filter((t) => !all.has(t))
    out.ore = [...all].some((t) => /ore$/.test(t))
    // (A cave crossing the shaft is a real opening, not a hole.)
    out.fewHoles = land.holes + city.holes < 40
    // Nothing dug or revealed there is saved with the map.
    out.notSaved = !b._snapshot().blocks.some((bl) => bl.y < -3)
    // Caves: walls grow around you underground.
    for (let i = 0; i < 300; i++) w.update([{ x: 100, y: -60, z: 20 }])
    let walls = 0
    for (const rec of u.chunks.values()) walls += rec.keys.length
    out.caveWalls = walls > 0
    let open = 0
    for (let i = 0; i < 3000; i++) {
      const x = 80 + (i % 40)
      const y = -30 - ((i * 7) % 120)
      const z = (i * 13) % 60
      if (!u.implicitSolid(x, y, z, `${x},${y},${z}`)) open++
    }
    out.caves = open > 30
    // ...but never under the city's ground until well below it.
    let cityCut = 0
    for (let x = -30; x <= 30; x += 3) for (let z = -30; z <= 30; z += 3) for (let y = -15; y <= -2; y++) {
      if (u.bottomAt(x, z) === -1 && !u.implicitSolid(x, y, z, `${x},${y},${z}`) && !w.removed.has(`${x},${y},${z}`) && !(x === 3 && z === 5)) cityCut++
    }
    out.cityCut = cityCut
    // Entrances: a mouth open to the sky out in the land, away from the
    // city and every village, castle and bridge, sloping down into rock.
    const ents = []
    for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) { const e = u._entrance(gx, gz); if (e) ents.push(e) }
    out.entrances = ents.length
    const e = ents[0]
    w.update([{ x: e.sx, z: e.sz }])
    out.mouthOpen = !b._blocks.has(`${e.sx},${e.sy - 1},${e.sz}`)
    out.awayFromPlaces = ents.every((en) => !w._plansOver(en.x0, en.z0, en.x1, en.z1).length && u.bottomAt(en.sx, en.sz) !== -1)
    const mx = Math.floor(e.sx + e.dx * 0.6)
    const my = Math.floor(e.sy + e.dy * 0.6)
    const mz = Math.floor(e.sz + e.dz * 0.6)
    w.update([{ x: mx, z: mz }])
    let floor = null
    for (let y = my; y > my - 5; y--) if (b._blocks.has(`${mx},${y},${mz}`)) { floor = y; break }
    out.tunnelHasFloor = floor !== null
    // The bar along the top: GayZ | mode | FPS | x y z. (Top Bar Tech
    // Info starts off on a new device, like this test's browser.)
    window.__game.settings.topBarTech = true
    await new Promise((res) => setTimeout(res, 400))
    const bar = document.getElementById('top-bar')
    out.bar = bar && getComputedStyle(bar).display !== 'none' ? bar.innerText.replace(/\s+/g, ' ') : ''
    out.debugLineHidden = getComputedStyle(document.getElementById('fps-counter')).display === 'none'
    return out
  })
  expect(r.endsOnBedrock).toBe(true)
  expect(r.layers).toEqual([])
  expect(r.ore).toBe(true)
  expect(r.fewHoles).toBe(true)
  expect(r.notSaved).toBe(true)
  expect(r.caveWalls).toBe(true)
  expect(r.caves).toBe(true)
  expect(r.cityCut).toBe(0)
  expect(r.entrances).toBeGreaterThan(0)
  expect(r.mouthOpen).toBe(true)
  expect(r.awayFromPlaces).toBe(true)
  expect(r.tunnelHasFloor).toBe(true)
  expect(r.bar).toMatch(/^GayZ Map Editor FPS \S+ MS \S+ -?\d+\.\d\d -?\d+\.\d\d -?\d+\.\d\d( .+)?$/)
  expect(r.debugLineHidden).toBe(true)
})

test('every open world biome is within reach of Map 1', () => {
  const found = new Set()
  for (let r = 80; r < 2600; r += 8) {
    for (let a = 0; a < 360; a += 2) {
      found.add(sampleLand(Math.round(Math.cos((a * Math.PI) / 180) * r), Math.round(Math.sin((a * Math.PI) / 180) * r)).biome)
    }
  }
  expect([...found].sort()).toEqual(Object.keys(BIOMES).sort())
})

// 2026-10-17 (third batch): the spawn map before a solo game (a real
// Earth place picks the biome you start in), no world edge, pyramids in
// deserts, underground cities, and ms + the graphics chip in the top bar.
test('spawn map, endless world, pyramids, underground cities and the top bar', async ({ page }) => {
  // The pure parts, straight from the source.
  const { earthBiome, findSpawn } = await import('../src/game/SpawnMap.js')
  expect([earthBiome(23, 10), earthBiome(-3, -60), earthBiome(-80, 0), earthBiome(0, -140)]).toEqual(['desert', 'jungle', 'snowyPlains', 'deepOcean'])
  expect(['desert', 'badlands', 'savanna']).toContain(findSpawn(23, 10, 'desert')?.biome)
  const { WORLD_LIMIT } = await import('../src/game/OpenWorld.js')
  expect(WORLD_LIMIT).toBe(Infinity)
  const { citiesOver, cityCell } = await import('../src/game/UnderCity.js')
  const c = citiesOver(-2000, -2000, 2000, 2000)[0]
  expect(!!c).toBe(true)
  expect(cityCell(c, c.x, c.floor + 9, c.z)).toBe('sealantern')
  expect(cityCell(c, c.x + 1, c.floor + 4, c.z + 4)).toBe(null)

  await gotoAndWaitForGame(page)
  // The spawn map is the World Map game mode's (2026-10-18).
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    const map = document.getElementById('spawn-map')
    out.mapFirst = [getComputedStyle(map).display, s._picking]
    out.spawned = s._spawnAt({ lat: 23, lon: 10, biome: 'desert' })
    const p = bm.tryMode.pos
    out.standsOnLand = !!bm.getBlockAt(Math.floor(p.x), Math.round(p.y) - 1, Math.floor(p.z))
    // Choosing the weapon closes the map (as the camp if nothing was picked).
    s._pickWeapon('rifle')
    out.mapClosed = getComputedStyle(map).display === 'none' && !s._picking
    // M twice: the big map in the middle opens as the block map and stays
    // it zoomed in (2026-10-23; zooming out to the atlas and globe is in
    // the real-land test at the end).
    const tm = bm.tryMode
    tm.cycleMap()
    tm.cycleMap()
    tm._drawMap(performance.now() + 1000)
    const atlas = tm._mapEl.classList.contains('atlas')
    for (let i = 0; i < 20; i++) tm.zoomMap(0.7)
    tm._drawMap(performance.now() + 2000)
    out.atlas = [atlas, tm._mapEl.classList.contains('atlas')]
    tm.cycleMap()
    // A pyramid in Egypt's desert (World Map pyramids are only where real
    // ones are - Egypt is about x 3000..4200, z -2640..-3780).
    let pyramid = null
    for (let gx = 36; gx < 54 && !pyramid; gx++) for (let gz = -48; gz < -32 && !pyramid; gz++) {
      const pl = bm.world._plan(gx, gz)
      if (pl?.kind === 'pyramid') pyramid = pl
    }
    out.pyramid = !!pyramid && [...pyramid.top.values()].some((t) => t.type === 'gold')
    out.topBar = ['top-bar-fps', 'top-bar-ms', 'top-bar-chip'].every((id) => !!document.getElementById(id))
    out.credits = !document.getElementById('credits-weapons-list') && !document.querySelector('.credits-tab')
    return out
  })
  expect(r).toEqual({ mapFirst: ['block', true], spawned: true, standsOnLand: true, mapClosed: true, atlas: [false, false], pyramid: true, topBar: true, credits: true })
})

// 2026-10-18: countries and landmarks on the spawn map, Spawn Randomly,
// waves that need a number of kills with zombies from anywhere, bodies
// that fade in a minute (or burn away), and fire that goes out in water
// and rain but races through trees.
test('countries, landmarks, kill-count waves, fading bodies and fire rules', async ({ page }) => {
  const { earthCountry, randomLandPick } = await import('../src/game/SpawnMap.js')
  expect([earthCountry(48.8, 2.3), earthCountry(40.7, -100), earthCountry(-23, 135), earthCountry(0, -140)]).toEqual(['France', 'United States of America', 'Australia', ''])
  const rp = randomLandPick()
  expect(['ocean', 'deepOcean', 'frozenOcean', 'warmOcean']).not.toContain(rp.biome)

  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const first = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    out.randomBtn = !!document.getElementById('spawn-map-random')
    // France: spawning builds the Eiffel Tower ahead.
    out.spawned = s._spawnAt({ lat: 48.8, lon: 2.3, biome: 'forest', country: 'France' })
    out.landmark = bm.world._landmarks.length === 1 && bm.world._landmarks[0].nameKey === 'landmarkEiffel'
    s._pickWeapon('rifle')
    return out
  })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate((out) => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    // A wave needs kills, not an empty map: zombies stay, kills count down.
    s._breakTimer = 0
    s._startWave(1)
    const need = s._toSpawn
    const pp = bm.tryMode.pos
    for (let i = 0; i < 5; i++) s._makeZombie(++s._zid, pp.x + 3 + i, pp.y, pp.z + 3, 100, false)
    const z = s.zombies[0]
    s.damageZombie(z, 1e9)
    out.wave = [need >= 9, s._toSpawn === need - 1, s.zombies.length >= 4]
    // Bodies: still there after 30 s, gone after a minute; burning ones go fast.
    const c = s._corpses?.[s._corpses.length - 1]
    s._updateCorpses(30)
    out.corpse30 = s._corpses.includes(c)
    s._updateCorpses(31)
    out.corpse61 = !s._corpses.includes(c)
    s.damageZombie(s.zombies[0], 1e9)
    const c2 = s._corpses[s._corpses.length - 1]
    c2.burnLeft = 3
    s._updateCorpses(1)
    s._updateCorpses(2.5)
    out.burntBody = !s._corpses.includes(c2)
    // Fire: leaves burn, water stops it, rain on open sky stops it.
    const p = bm.tryMode.pos
    const x = Math.floor(p.x) + 4
    const y = Math.floor(p.y) + 8
    const zz = Math.floor(p.z)
    bm.placeBlock(x, y, zz, 'leaves', false)
    bm.placeBlock(x + 3, y, zz, 'oakplanks', false)
    bm.placeBlock(x + 4, y, zz, 'water', false)
    bm.sky._now = 'clear'
    out.leavesLit = s.ignite(x, y, zz)
    out.wetNotLit = s.ignite(x + 3, y, zz) === false
    bm.sky._now = 'hardRain'
    for (let i = 0; i < 20; i++) s._updateFires(0.1)
    out.rainedOut = !s._fires.has(`${x},${y},${zz}`) && bm.getBlockAt(x, y, zz) === 'leaves'
    bm.sky._now = 'clear'
    return out
  }, first)
  expect(r).toEqual({ randomBtn: true, spawned: true, landmark: true, wave: [true, true, true], corpse30: true, corpse61: true, burntBody: true, leavesLit: true, wetNotLit: true, rainedOut: true })
})

// 2026-10-18 (second batch): the game's inventory (Tab), the Map Editor's
// half-and-half Tab panel, real-city towns, and zombies lost far away or
// falling out of the world no longer count as kills.
test('inventory, editor block storage, city towns and lost zombies', async ({ page }) => {
  const { cityNear } = await import('../src/game/Towns.js')
  expect(cityNear(48.9, 2.4)?.name).toBe('Paris')
  expect(cityNear(0, -140)).toBe(null)

  await gotoAndWaitForGame(page)
  const editor = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    g.buildMode.togglePicker()
    const out = { split: document.getElementById('build-picker').classList.contains('split'), store: document.querySelectorAll('#build-picker .bp-store .bp-slot').length, hotbar: document.querySelectorAll('#build-picker .bp-hotbar .bp-slot').length }
    g.buildMode.togglePicker()
    g._exitBuildMode()
    return out
  })
  expect(editor).toEqual({ split: true, store: 100, hotbar: 0 })

  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const first = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const out = {}
    out.town = s._spawnAt({ lat: 40.7, lon: -74, biome: 'plains', country: 'United States of America', city: 'New York' })
    out.townPlan = window.__game.buildMode.world._landmarks.some((p) => p.kind === 'town' && p.placeName === 'New York')
    s._pickWeapon('rifle')
    return out
  })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate((out) => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const inv = s.inv
    // Starting kit: just the picked gun in slot 1 (no other guns, no health
    // pack), and the Catch Traps in the last slot (PlayCatch.js).
    out.kit = [inv.hotbar[0]?.id, inv.grid.filter(Boolean).length + inv.hotbar.filter(Boolean).length]
    // Tab opens the inventory panel with 100 + 10 + 5 slots.
    bm.togglePicker()
    out.panel = [document.querySelectorAll('#play-inventory .inv-grid .inv-slot').length, document.querySelectorAll('#play-inventory .inv-hotbar .inv-slot').length, document.querySelectorAll('#play-inventory .inv-armor .inv-slot').length]
    bm.togglePicker()
    // A broken block pops out and is picked up when you're near; a held
    // block is placed and the stack drops.
    const pp = bm.tryMode.pos
    s.onBlockMined('oakplanks', Math.floor(pp.x), Math.floor(pp.y), Math.floor(pp.z))
    out.dropped = s._drops.list.length === 1
    for (let i = 0; i < 40; i++) s._drops.update(1 / 20)
    out.pickedUp = s._drops.list.length === 0
    const slot = inv.hotbar.findIndex((it) => it?.id === 'oakplanks')
    inv.select(slot)
    out.holding = s.holding?.id
    // Look down at the ground nearby (a few directions, in case something
    // is in the way) and place it.
    let placed = false
    for (const yaw of [0, 1.6, 3.2, 4.7]) {
      for (const pitch of [-1.3, -0.9, -0.6]) {
        if (placed) break
        bm._yaw = yaw
        bm._pitch = pitch
        for (let i = 0; i < 3; i++) bm.update(1 / 30)
        placed = s.placeHeldBlock()
      }
    }
    out.placed = placed && !inv.hotbar[slot]
    // Armor in its slot cuts damage.
    inv.add({ kind: 'item', id: 'chestplate', n: 1 })
    const ci = inv.hotbar.findIndex((it) => it?.id === 'chestplate')
    out.wrongSlot = inv.moveItem('hotbar', ci, 'armor', 0) === false
    inv.moveItem('hotbar', ci, 'armor', 1)
    out.cut = +inv.damageCut().toFixed(2)
    // Saved and restored.
    const saved = JSON.parse(JSON.stringify(inv.serialize()))
    inv.reset('pistol')
    inv.restore(saved)
    out.restored = inv.armor[1]?.id
    // A zombie that falls out of the world isn't a kill.
    inv.select(0)
    const kills = s.kills
    const left = s._toSpawn = 5
    const p = bm.tryMode.pos
    s._makeZombie(++s._zid, p.x + 3, p.y, p.z, 100, false)
    const z = s.zombies[s.zombies.length - 1]
    z.lost = true
    s.damageZombie(z, 1e9)
    out.lost = [s.kills === kills, s._toSpawn === left, !s.zombies.includes(z)]
    return out
  }, first)
  expect(r).toEqual({ town: true, townPlan: true, kit: ['rifle', 2], panel: [100, 10, 5], dropped: true, pickedUp: true, holding: 'oakplanks', placed: true, wrongSlot: true, cut: 0.16, restored: 'chestplate', lost: [true, true, true] })
})

// 2026-10-18 (third batch): World Map is its own game mode - the land
// follows the real Earth and the map only shows there; Classic starts in
// the camp with no map; towns aren't square.
test('World Map mode follows the real Earth; Classic skips the map', async ({ page }) => {
  const { setEarthWorld, sampleLand } = await import('../src/game/OpenWorld.js')
  setEarthWorld(true)
  const sea = (lat, lon) => sampleLand(Math.round(lon * 120), Math.round(-lat * 120)).h < -4
  // Mid-Atlantic and mid-Pacific are sea; inland Africa, Brazil, Siberia are land.
  expect([sea(30, -40), sea(0, -150), sea(10, 20), sea(-10, -55), sea(62, 100)]).toEqual([true, true, false, false, false])
  expect(['desert', 'badlands', 'savanna']).toContain(sampleLand(Math.round(25 * 120), Math.round(-23 * 120)).biome)
  setEarthWorld(false)

  await gotoAndWaitForGame(page)
  const classic = await page.evaluate(async () => {
    const g = window.__game
    g.careerStats.totalRuns = 1
    g.settings.selectedGameMode = 'classic'
    g.playBtn.click()
    for (let i = 0; i < 300 && !g.buildMode?.survival?.active; i++) await new Promise((r) => setTimeout(r, 200))
    const out = { map: document.getElementById('spawn-map')?.style.display === 'block', picker: document.getElementById('play-weapon-pick')?.style.display === 'flex' }
    g.buildMode.survival._pickWeapon('rifle')
    g.buildMode.survival.stop()
    g._exitBuildMode()
    return out
  })
  expect(classic).toEqual({ map: false, picker: true })
  await page.waitForTimeout(1000)
  const world = await page.evaluate(async () => {
    const g = window.__game
    g.settings.selectedGameMode = 'worldMap'
    g.playBtn.click()
    for (let i = 0; i < 300 && !g.buildMode?.survival?.active; i++) await new Promise((r) => setTimeout(r, 200))
    const s = g.buildMode.survival
    const out = { map: document.getElementById('spawn-map')?.style.display === 'block', camp: !!document.getElementById('spawn-map-camp'), mode: s.cfg.mode }
    s._spawnAt({ lat: 48.85, lon: 2.35, biome: 'forest', country: 'France', city: 'Paris' })
    const town = g.buildMode.world._landmarks.find((p) => p.kind === 'town')
    // Not a square: the corners of its box are empty.
    out.notSquare = !!town && ![...town.top.keys()].some((k) => { const [x, z] = k.split(',').map(Number); return x <= town.x0 + 2 && z <= town.z0 + 2 })
    s._pickWeapon('rifle')
    return out
  })
  expect(world).toEqual({ map: true, camp: false, mode: 'worldMap', notSquare: true })
})

// 2026-10-18 (second batch): bridges stand clear of the water, so a
// player fits under them.
test('bridges are high enough over the water to walk under', async () => {
  const { sampleLand, hash2, SEA, cityDistance, setWorldSeed, setEarthWorld } = await import('../src/game/OpenWorld.js')
  const { planStructure } = await import('../src/game/WorldStructures.js')
  setEarthWorld(false)
  let bridges = 0
  let low = 0
  for (const seed of [11, 222, 3333]) {
    setWorldSeed(seed)
    for (let gx = -6; gx <= 6; gx++) {
      for (let gz = -6; gz <= 6; gz++) {
        const plan = planStructure(gx, gz, { land: sampleLand, hash: hash2, sea: SEA, cityDistance, chunk: 16 })
        if (!plan || plan.kind !== 'bridge') continue
        bridges++
        // Over water, every block of the bridge is either a whole pier
        // column (down to the bed) or 3+ blocks above the water.
        const cols = new Map()
        for (const list of plan.byColumn.values()) {
          for (let i = 0; i < list.length; i += 4) {
            const k = `${list[i]},${list[i + 2]}`
            if (!cols.has(k)) cols.set(k, [])
            cols.get(k).push(list[i + 1])
          }
        }
        for (const [k, ys] of cols) {
          const [x, z] = k.split(',').map(Number)
          const bed = sampleLand(x, z).h
          if (bed >= SEA) continue
          const pier = ys.includes(bed + 1)
          if (!pier && Math.min(...ys) <= SEA + 3) low++
        }
      }
    }
  }
  expect(bridges).toBeGreaterThan(0)
  expect(low).toBe(0)
})

// 2026-10-18 (second batch): animals wander, die to shots and drop meat
// that heals, can be tamed with Use and then follow you; a block from the
// inventory shows in your hand; the top bar shows the weather and time;
// spectating has no banner; the What's New card reaches the profile card's
// bottom and fades when you click elsewhere.
test('animals, held blocks, sky top bar, no spectate banner, What\'s New card', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await gotoAndWaitForGame(page)
  const card = await page.evaluate(() => {
    const g = window.__game
    const banner = g.updateAvailableBanner
    g.updateAvailableChangelog.innerHTML = document.querySelector('#changelog-list .changelog-entry').outerHTML
    banner.classList.remove('fading')
    banner.style.display = 'flex'
    g._scheduleUpdateBannerFade()
    window.dispatchEvent(new Event('resize'))
    const b = banner.getBoundingClientRect()
    const p = document.getElementById('menu-player-badge').getBoundingClientRect()
    const out = { reaches: Math.abs(b.bottom - p.bottom) < 2 }
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.fading = banner.classList.contains('fading')
    return out
  })
  expect(card).toEqual({ reaches: true, fading: true })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const B = s.B
    const out = {}
    const A = s.animals
    // Natural spawning around you.
    for (let i = 0; i < 40; i++) A.update(0.5)
    out.spawned = A.list.length > 0
    // Each animal only in a biome that fits it (2026-10-23): no cows in the
    // snow, polar bears in the snow, camels in the desert, none at sea.
    const T = A.constructor.BIOME_ANIMALS
    out.snow = Object.keys(T.snowyPlains).sort()
    out.desert = Object.keys(T.desert).sort()
    // Since 2026-10-24 the sea has its own animals, and all of them swim.
    out.sea = Object.keys(T.ocean).length > 0 && Object.keys(T.ocean).every((k) => A.constructor.KINDS[k].swim)
    out.allBuilt = Object.values(T).every((t) => Object.keys(t).every((k) => A.constructor.KINDS[k]))
    out.cowsOnlyWarm = Object.entries(T).filter(([, t]) => t.cow).map(([b]) => b).sort()
    // One right in front of you: shot, it dies and drops meat.
    A.clear()
    bm._pitch = -0.25
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const tp = bm.tryMode.pos
    const ax = tp.x + dir.x * 3
    const az = tp.z + dir.z * 3
    const cow = A.spawn('cow', ax, s._groundUnder(ax, tp.y + 2, az), az)
    const start = [cow.x, cow.z]
    for (let i = 0; i < 60; i++) A._step(cow, 1 / 30, s.bodyPos())
    out.stillHere = Math.hypot(cow.x - start[0], cow.z - start[1]) < 6
    // Taming: Use on it.
    cow.x = ax
    cow.z = az
    cow.group.position.set(ax * B, cow.y * B, az * B)
    cow.group.updateMatrixWorld()
    out.tamed = A.use() && cow.tamed && cow.collar.visible
    // A pet isn't hurt by your shots and follows you.
    A.damage(cow, 999)
    out.petSafe = !cow.dying
    cow.x += 12
    for (let i = 0; i < 120; i++) A._step(cow, 1 / 30, s.bodyPos())
    out.follows = Math.hypot(cow.x - s.bodyPos().x, cow.z - s.bodyPos().z) < 6
    // A wild pig shot dies and drops meat.
    const pig = A.spawn('pig', ax, cow.y, az)
    const before = s._drops.list.length
    A.damage(pig, 999)
    out.meat = s._drops.list.filter((d) => d.kind === 'item' && d.type === 'meat_pig').length - before >= 1
    // Picked up and eaten: heals.
    s.inv.add({ kind: 'item', id: 'meat', n: 1 })
    const slot = s.inv.hotbar.findIndex((it) => it?.id === 'meat')
    s.inv.select(slot)
    s.health = 50
    s.inv.useHeld()
    out.healed = s.health === 75
    // A block from the inventory is drawn in the hand.
    s.inv.hotbar[5] = { kind: 'block', id: 'leaves', n: 3 }
    s.inv.select(5)
    bm.render()
    out.handBlock = bm.tryMode._handType === 'leaves'
    // The top bar: weather and time.
    window.__game._topBar.update(performance.now() + 1000)
    out.weather = document.getElementById('top-bar-weather').textContent.length > 2
    out.time = /\d/.test(document.getElementById('top-bar-time').textContent)
    out.nightVar = document.getElementById('top-bar').style.getPropertyValue('--tb-night') !== ''
    // Spectating: no banner.
    s.inv.select(0)
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    out.noBanner = !document.getElementById('play-spectate-bar')
    bm.toggleMenu()
    return out
  })
  expect(r).toEqual({ spawned: true, snow: ['arcticFox', 'hare', 'husky', 'lemming', 'mammoth', 'muskox', 'polarBear', 'ptarmigan', 'reindeer', 'sabertooth', 'saiga', 'snowyOwl'], desert: ['armadillo', 'camel', 'caracal', 'cobra', 'coyote', 'fennecFox', 'gecko', 'gerbil', 'gilaMonster', 'hyrax', 'jackal', 'jackalope', 'jerboa', 'lizard', 'manticore', 'oryx', 'phoenix', 'rattlesnake', 'roadrunner', 'sandCat', 'scorpion', 'snake', 'tarantula', 'tortoise', 'vulture'], sea: true, allBuilt: true, cowsOnlyWarm: ['city', 'mushroomFields', 'plains'], stillHere: true, tamed: true, petSafe: true, follows: true, meat: true, healed: true, handBlock: true, weather: true, time: true, nightVar: true, noBanner: true })
})

// The spawn map's countries -> states/provinces -> cities (2026-10-18):
// Canada shows its provinces and territories, Ontario its cities, and
// Spawn Here starts you in the picked city's town.
test('the spawn map goes from a country to its provinces and cities', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await page.waitForFunction(() => document.getElementById('spawn-map')?.style.display === 'block', null, { timeout: 60000 })
  const clickAt = async (lat, lon) => {
    const [x, y] = await page.evaluate(([la, lo]) => document.getElementById('spawn-map')._clientAt(la, lo), [lat, lon])
    await page.mouse.click(x, y)
  }
  await clickAt(56, -100)
  await expect(page.locator('#spawn-map-hint')).toContainText('Canada')
  await expect(page.locator('#spawn-map-back')).toBeVisible()
  await page.waitForTimeout(600)
  await clickAt(50, -86)
  await expect(page.locator('#spawn-map-hint')).toContainText('Ontario')
  await expect(page.locator('#spawn-map-list button')).toContainText(['Ottawa', 'Toronto'])
  await page.locator('#spawn-map-list button', { hasText: 'Toronto' }).click()
  await expect(page.locator('#spawn-map-info')).toContainText('Toronto')
  await page.click('#spawn-map-go')
  await page.waitForFunction(() => document.getElementById('spawn-map').style.display === 'none', null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const p = s.bm.tryMode.pos
    return { lat: Math.round(-p.z / 120), lon: Math.round(p.x / 120), town: !!s.bm.world._landmarks.find((l) => l.kind === 'town') }
  })
  expect(r).toEqual({ lat: 44, lon: -79, town: true })
  // The map's label: country · province · city (EarthPlaces.placeNameAt).
  await page.waitForFunction(() => document.getElementById('build-try-biome')?.textContent === 'Canada · Ontario · Toronto', null, { timeout: 20000 })
})

// The World Map mode's real land (2026-10-23): real heights, lakes and
// rivers (EarthTerrain.js) - no snow on Kazakhstan's steppe, snow on
// Everest, water in Lake Balkhash and the Nile. Zombies never appear
// closer than 30 blocks (out here too - path cells used to wrap past
// 2048). M's middle map is the block map (never the atlas), drawn ahead,
// and turns into the globe when zoomed far out (2026-10-24).
// No zombies in World Map since 2026-10-26 (just exploring).
test('the World Map mode has real land, no zombies and a block map at every zoom', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await page.waitForFunction(() => document.getElementById('spawn-map')?.style.display === 'block', null, { timeout: 60000 })
  const clickAt = async (lat, lon) => {
    const [x, y] = await page.evaluate(([la, lo]) => document.getElementById('spawn-map')._clientAt(la, lo), [lat, lon])
    await page.mouse.click(x, y)
    await page.waitForTimeout(700)
  }
  await clickAt(48, 68)
  await clickAt(48.7, 71.6)
  await page.locator('#spawn-map-list button', { hasText: 'Atasu' }).click()
  await page.click('#spawn-map-go')
  await page.waitForFunction(() => document.getElementById('spawn-map').style.display === 'none', null, { timeout: 30000 })
  // Past the first wave's countdown: still nobody coming.
  await page.waitForTimeout(5000)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const at = (lat, lon) => g.buildMode.world.landAt(Math.round(lon * 120), Math.round(-lat * 120))
    const steppe = at(48.68, 71.64)
    const everest = at(27.99, 86.93)
    const balkhash = at(46.5, 74.5)
    const nile = at(24.09, 32.89)
    const p = s.bodyPos()
    const noZombies = s.zombies.length === 0 && s.wave === 0 && s._toSpawn === 0
    const hud = document.getElementById('build-play-wave-text').textContent
    const tm = g.buildMode.tryMode
    const el = document.getElementById('build-try-map')
    tm.cycleMap()
    tm.cycleMap()
    const frame = () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)))
    await frame()
    const views = []
    const look = () => (el.classList.contains('globe') ? 'globe' : el.classList.contains('atlas') ? 'atlas' : 'blocks')
    views.push(look())
    for (let i = 0; i < 30; i++) {
      tm.zoomMap(1.25)
      await frame()
      if (views.at(-1) !== look()) views.push(look())
    }
    // Drawn ahead in the background: the biggest tiles around you are there.
    const world = g.buildMode.world
    const ahead = await new Promise((done) => {
      const t0 = performance.now()
      const check = () => (world._prewarm?.i > 200 || performance.now() - t0 > 20000 ? done(world._prewarm?.i > 200) : setTimeout(check, 100))
      check()
    })
    return {
      ahead,
      lat: Math.round(-p.z / 120),
      steppe: steppe.biome !== 'snowyPeaks' && steppe.biome !== 'snowyPlains' && steppe.h >= steppe.w,
      everest: everest.biome,
      balkhash: balkhash.h < balkhash.w,
      nile: nile.h < nile.w,
      noZombies,
      hud: /^World Map · /.test(hud),
      size: el.dataset.size,
      views,
    }
  })
  expect(r).toEqual({ lat: 49, steppe: true, everest: 'snowyPeaks', balkhash: true, nile: true, noZombies: true, hud: true, size: 'center', views: ['blocks', 'globe'], ahead: true })
})

// 2026-10-26: in a game the screens wear the biome (readable: the box in
// the biome's colour, the text in the opposite colour) unless Settings >
// Theme > Game Screens Follow the Biome is off; the homepage never does.
test('Game screens follow the biome only in games and only when the setting is on', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { localStorage.removeItem('gayz-play-saved-run'); window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  await page.waitForFunction(() => document.documentElement.classList.contains('ui-theme-biome'), null, { timeout: 10000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const cl = document.documentElement.classList
    const wait = (ms) => new Promise((res) => setTimeout(res, ms))
    const st = document.documentElement.style
    const out = { ink: st.getPropertyValue('--biome-ink-rgb'), bg: st.getPropertyValue('--biome-bg-rgb') }
    const tg = document.getElementById('play-biome-look-toggle')
    tg.checked = false
    tg.dispatchEvent(new Event('change'))
    await wait(400)
    out.off = cl.contains('ui-theme-biome')
    out.themeBack = cl.contains('ui-theme-old') || cl.contains('ui-theme-clean')
    tg.checked = true
    tg.dispatchEvent(new Event('change'))
    await wait(400)
    out.onAgain = cl.contains('ui-theme-biome')
    g.buildMode.toggleMenu()
    document.getElementById('play-pause-leave-btn').click()
    await wait(800)
    out.homeBiome = cl.contains('ui-theme-biome')
    out.homeTheme = cl.contains('ui-theme-old') || cl.contains('ui-theme-clean')
    return out
  })
  expect(r.ink).toMatch(/\d+, \d+, \d+/)
  expect(r.bg).toMatch(/\d+, \d+, \d+/)
  expect(r.off).toBe(false)
  expect(r.themeBack).toBe(true)
  expect(r.onAgain).toBe(true)
  expect(r.homeBiome).toBe(false)
  expect(r.homeTheme).toBe(true)
})

// 2026-10-26 (Gaymi: "check all the gamemodes do they work for zombie
// survival"): each of the 5 zombie modes started from the homepage like a
// player would - zombies really come, the wave clears and the next one
// starts, and each mode's own rule works (Defense's last wave wins, Boss
// Hunt's 3rd wave has a boss, Rush's short break and timer, Extraction's
// helicopter has its own test above); dying ends the run with its screen.
for (const [mode, button] of [['classic', 'game-mode-classic'], ['zombieDefense', 'game-mode-zombie-defense'], ['bossHunt', 'game-mode-boss-hunt'], ['zombieRush', 'game-mode-zombie-rush'], ['zombieExtraction', 'game-mode-zombie-extraction']]) {
  test(`${mode}: starts, spawns zombies, clears waves and ends`, async ({ page }) => {
    await gotoAndWaitForGame(page)
    const unlocked = await page.evaluate((id) => {
      const g = window.__game
      g.settings.guestMode = false
      const btn = document.getElementById(id)
      btn.click()
      g.playBtn.click()
      return !btn.disabled
    }, button)
    expect(unlocked).toBe(true)
    await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
    await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
    // Real play: the first wave starts and zombies walk in on their own.
    await page.waitForFunction(() => window.__game.buildMode.survival.zombies.length > 0, null, { timeout: 30000 })
    const r = await page.evaluate(async (m) => {
      const s = window.__game.buildMode.survival
      const out = { mode: s.cfg.mode, wave1: s.wave, hud: document.getElementById('build-play-wave-text').textContent }
      // Every zombie in wave 1 shot down.
      const killAll = () => {
        s._toSpawn = 0
        for (const z of [...s.zombies]) s.damageZombie(z, 1e6)
      }
      killAll()
      out.killsAfter = s.kills
      // The break, then wave 2 by itself - counted in game time, stepped
      // right here (a slow test machine draws ~1 frame a second, so real
      // seconds said nothing about the break: 6 game seconds took 30+).
      let gameSecs = 0
      for (let i = 0; i < 600 && s.wave < 2; i++) {
        // A cleared wave offers perk cards and waits for a pick (RunPerks.js).
        if (s.perks?.open) s.perks.pick(s.perks.offer[0])
        s.bm.update(0.05)
        gameSecs += 0.05
      }
      out.wave2 = s.wave
      out.breakSecs = Math.round(gameSecs)
      if (m === 'bossHunt') {
        s._startWave(3)
        s._spawnZombie()
        out.boss = s.zombies.some((z) => z.boss)
      }
      if (m === 'zombieDefense') {
        killAll()
        s.wave = 10
        s._breakTimer = 0
        s._updateWorld(0.01)
        out.won = !!s._won && s.dead
        out.title = document.getElementById('build-play-over-title').textContent
        return out
      }
      if (m === 'zombieRush') out.timer = /Time|\d+:\d\d/.test(document.getElementById('build-play-wave-text').textContent)
      // Dying ends the run.
      const runs0 = window.__game.careerStats.totalRuns
      s.health = 1
      s.armor = 0
      s._hurtPlayer(1000)
      if (!s.dead) s._die()
      // (The death replay plays first - skipped here, DeathReplay.js.)
      s.replay?.stop()
      out.dead = s.dead
      out.title = document.getElementById('build-play-over-title').textContent
      out.overShown = s._overEl.style.display !== 'none'
      out.counted = window.__game.careerStats.totalRuns === runs0 + 1
      return out
    }, mode)
    console.log(mode, JSON.stringify(r))
    expect(r.mode).toBe(mode)
    expect(r.wave1).toBe(1)
    expect(r.killsAfter).toBeGreaterThan(0)
    expect(r.wave2).toBe(2)
    if (mode === 'zombieRush') {
      // Rush's short break vs the normal ~6s one (game seconds).
      expect(r.breakSecs).toBeLessThanOrEqual(3)
      expect(r.timer).toBe(true)
    }
    if (mode === 'bossHunt') expect(r.boss).toBe(true)
    if (mode === 'zombieDefense') {
      expect(r.won).toBe(true)
      expect(r.title).toBe('You held the city!')
    } else {
      expect(r.dead).toBe(true)
      expect(r.overShown).toBe(true)
      expect(r.counted).toBe(true)
    }
  })
}

// 2026-10-26: a 1 in 10 rainbow when rain clears in the daytime.
test('a rainbow can follow the rain', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const sky = window.__game.buildMode.sky
    const orig = Math.random
    const rolls = { yes: 0, no: 0 }
    // The last rain step clears: a roll under 0.1 brings a rainbow.
    for (const [roll, key] of [[0.05, 'yes'], [0.5, 'no']]) {
      sky._clock = 1440 * 0.1
      sky._rainbowIn = 0
      // Rain ends as drizzle (2026-10-30).
      sky._now = 'drizzle'
      sky._goal = 'clear'
      sky._stepIn = 0
      Math.random = () => roll
      sky.update(0.01)
      Math.random = orig
      rolls[key] = sky._rainbowIn
    }
    sky.showRainbow()
    for (let i = 0; i < 200; i++) sky.update(0.1)
    const shown = sky.bodies.rainbow.visible
    // Rain again: it fades away.
    sky._now = sky._goal = 'lightRain'
    sky.apply()
    for (let i = 0; i < 300; i++) sky.update(0.1)
    return { yes: rolls.yes > 0, no: rolls.no, shown, gone: !sky.bodies.rainbow.visible }
  })
  expect(r).toEqual({ yes: true, no: 0, shown: true, gone: true })
})

test('castles fly cloth flags on poles, acacia trees stand on their trunks', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    const w = b.world
    const out = {}
    for (let seed = 1; seed < 40 && !out.castle; seed++) {
      w.reseed(seed)
      const p = w.placesNear(0, 0, 600).find((q) => q.kind === 'castle')
      if (!p) continue
      for (let i = 0; i < 40; i++) w.update([{ x: p.x, z: p.z }])
      const plan = w._plansOver(p.x, p.z, p.x, p.z).find((q) => q.kind === 'castle')
      // No block flags (wool) left, five cloth flags, drawn near you.
      // The old block flags (a log pole) are gone from the tower tops.
      let wool = 0
      for (const f of plan.flags) for (let y = f.y; y < f.y + 6; y++) if (b._blocks.get(`${f.x},${y},${f.z}`)) wool++
      b.camera.position.set(p.x * b._chunks.blockSize, 40, p.z * b._chunks.blockSize)
      b.castleFlags._wait = 0
      b.castleFlags.update(0.1)
      const group = b.castleFlags.shown.get(plan)
      out.castle = { wool, flags: plan.flags.length, design: plan.flagDesign, drawn: !!group, visible: group ? group.userData.parts.filter((q) => q.meshes[0].visible).length : 0 }
    }
    // Acacia trunks: every log touches another log or the ground face to face.
    const logs = [...b._blocks.entries()].filter(([, t]) => t === 'acacialog').map(([k]) => k.split(',').map(Number))
    const has = (x, y, z) => b._blocks.has(`${x},${y},${z}`)
    out.acaciaLoose = logs.filter(([x, y, z]) => ![[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => has(x + dx, y + dy, z + dz))).length
    g._exitBuildMode()
    out.cleared = b.castleFlags.shown.size
    return out
  })
  expect(r.castle).toMatchObject({ wool: 0, flags: 5, drawn: true, visible: 5 })
  expect(['logo', 'banner', 'skull']).toContain(r.castle.design)
  expect(r.acaciaLoose).toBe(0)
  expect(r.cleared).toBe(0)
})

// 2026-10-26: grass 100 blocks out (since 2026-10-30: as far as the land
// is drawn, growing over time), crack on every face (on the lumps
// too), puffy leaves, falling leaves and half-chance leaf drops, a
// friendly spider out of the waves, 16 more animals and 20 rare
// dinosaurs whose meat-eaters chase and bite.
test('far grass, cracks on bumpy tops, puffy and falling leaves, dinosaurs', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    const out = {}
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    // A flat field of grass 60 blocks out from x=0: tufts reach it.
    for (let x = -2; x <= 70; x++) for (let z = -2; z <= 2; z++) bm._placeBlockInner(x, 0, z, 'grass')
    bm.camera.position.set(0.5 * B, 2.6 * B, 0.5 * B)
    const gt = bm.grassTufts
    gt.clear()
    // Grass starts bare and grows (2026-10-30): only the first few tiny
    // sprouts after a few seconds, then a full field once its time has passed.
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.bareAtFirst = gt.mesh.count
    gt.grow(30)
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.sprouting = gt.mesh.count
    gt.grow(400)
    for (let i = 0; i < 200; i++) gt.update(1 / 60)
    out.grown = gt.mesh.count
    let far = 0
    const m = new (bm.camera.matrix.constructor)()
    for (let i = 0; i < gt.mesh.count; i++) {
      gt.mesh.getMatrixAt(i, m)
      far = Math.max(far, m.elements[12] / B)
    }
    out.grassFar = Math.round(far)
    // Leaves: puffed out (points beyond the block's face), no flat cards.
    bm._placeBlockInner(-20, 5, -20, 'leaves')
    const ch = bm._chunks
    ch.flush(bm._chunkCells)
    let puff = 0
    for (const c of ch.chunks.values()) {
      const mesh = c.meshes.find((mm) => mm.material === ch.materials.cutout)
      const pos = mesh?.geometry.attributes.position
      if (!pos) continue
      for (let i = 0; i < pos.count; i++) {
        const x = (pos.getX(i) + mesh.position.x) / B
        const y = (pos.getY(i) + mesh.position.y) / B
        const z = (pos.getZ(i) + mesh.position.z) / B
        if (x < -21 || x > -18 || z < -21 || z > -18) continue
        puff = Math.max(puff, y - 6, -20 - x, x + 19)
      }
    }
    out.leafPuff = Math.round(puff * 100) / 100
    // Breaking crack: it follows the block's real top. On Detailed that's
    // the lumpy cube top (above 1.0). On In Real Life clay is real ground
    // (since the real-ground batches): a lone block is rounded off, its top
    // well under 1.0, and the crack sits a hair outside that instead.
    bm._placeBlockInner(5, 3, 5, 'clay')
    const crackOf = () => {
      bm.tryMode._showDigCrack({ x: 5, y: 3, z: 5, type: 'stone' }, 0.5)
      const pos = bm.tryMode._digMesh.geometry.attributes.position
      let top = 0
      for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i) / B + 0.5)
      return { top, count: pos.count }
    }
    const realCrack = crackOf()
    let drawnTop = 0
    for (const f of ch.realFaceGrids(5, 3, 5) || []) for (const p of f) drawnTop = Math.max(drawnTop, p[1])
    out.crackRealTop = realCrack.top
    out.crackRealDrawn = drawnTop
    g._applyGraphicsLevel('detailed')
    bm._applyGraphicsLook()
    const lumpyCrack = crackOf()
    out.crackTop = lumpyCrack.top
    out.crackFaces = lumpyCrack.count
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    // Water corners: never cut out any more.
    out.waterCut = String(ch.materials.water.onBeforeCompile).includes('discard')
    // Falling leaves come off the leaf block above and land.
    const fl = bm.fallingLeaves
    fl.clear()
    bm.camera.position.set(-19.5 * B, 3 * B, -19.5 * B)
    for (let x = -24; x <= -16; x++) for (let z = -24; z <= -16; z++) bm._placeBlockInner(x, 6, z, 'leaves')
    for (let i = 0; i < 5000 && !fl.leaves.length; i++) fl._spawnTry()
    out.leafFalls = fl.leaves.length > 0
    out.leafShape = fl.leaves[0]?.shape
    // Each tree its own leaf shape.
    out.leafShapes = Object.keys(fl.meshes).length
    const first = fl.leaves[0]
    // Wide enough that a leaf drifting sideways still lands on it.
    for (let x = -30; x <= -10; x++) for (let z = -30; z <= -10; z++) bm._placeBlockInner(x, 1, z, 'grass')
    for (let i = 0; i < 300 && !first.down; i++) fl.update(1 / 30)
    out.leafLanded = first.down && Math.abs(first.y - 2.02) < 0.05
    // Start a game: animals.
    bm.placeBlock(0, 1, 0, 'playerstart', false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const A = s.animals
    const K = A.constructor.KINDS
    out.dinos = Object.values(K).filter((k) => k.dino).length
    out.newAnimals = ['bison', 'yak', 'llama', 'alpaca', 'capybara', 'sloth', 'anteater', 'redPanda', 'jaguar', 'lynx', 'snowLeopard', 'gazelle', 'wildebeest', 'boar', 'tapir', 'mouse'].every((id) => K[id])
    // Leaf blocks always drop (2026-10-30).
    s._drops.clear?.()
    let drops = 0
    for (let i = 0; i < 400; i++) {
      const before = s._drops.list.length
      s.onBlockMined('leaves', 30, 1, 30)
      if (s._drops.list.length > before) drops++
      s._drops.list.forEach((d) => d.mesh.removeFromParent())
      s._drops.list.length = 0
    }
    out.leafDropShare = drops / 400
    // The spider: an animal, not a wave zombie.
    out.spiderAnimal = !!K.spider && K.spider.body[0] > 0.5
    s.wave = 3
    for (let i = 0; i < 200; i++) s._spawnZombie()
    out.zombiesMade = s.zombies.length
    out.waveSpiders = s.zombies.filter((z) => z.kind === 'spider').length
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    // A T. rex right next to you chases and bites; you can't tame it.
    A.clearAll()
    const me = s.bodyPos()
    const rex = A.spawn('tRex', me.x + 12, me.y, me.z)
    s.health = 100
    for (let i = 0; i < 200; i++) A.update(1 / 30, { wild: false })
    out.rexCame = Math.hypot(rex.x - me.x, rex.z - me.z) < 12
    out.bitten = s.health < 100
    s.health = 100
    // Shot: angry, doesn't run.
    A.damage(rex, 10)
    out.rexAngry = rex.angry > 0 && rex.flee === 0
    // A T. rex is about 8 blocks tall (made huge 2026-10-30), a Brachiosaurus about 13.
    const tallOf = (kind) => { const k = K[kind]; return Math.max(k.leg + k.body[1], k.headAt[0] + k.head[1] / 2) }
    out.rexTall = tallOf('tRex')
    out.brachioTall = tallOf('brachiosaurus')
    return out
  })
  // Dinosaurs are rare: about 1 in 100 picks in a dino biome. Picked on
  // Map 1's land (a Plain map is void since 2026-11-16 - no biomes).
  Object.assign(r, await page.evaluate(async () => {
    const g = window.__game
    g._exitBuildMode?.()
    await g._enterBuildMode({ map: 'map3' })
    const A = g.buildMode.survival.animals
    const K = A.constructor.KINDS
    let dinoPicks = 0
    let picks = 0
    for (let i = 0; i < 40000; i++) {
      const id = A.kindAt((i * 137) % 6000 - 3000, Math.floor(i / 44) * 7 - 3000)
      if (!id) continue
      picks++
      if (K[id].dino) dinoPicks++
    }
    return { dinoShare: dinoPicks / picks, dinoSeen: dinoPicks > 0 }
  }))
  expect(r.grassFar).toBeGreaterThan(55)
  expect(r.bareAtFirst).toBeLessThan(r.grown * 0.03)
  expect(r.sprouting).toBeGreaterThan(r.bareAtFirst)
  expect(r.grown).toBeGreaterThan(r.sprouting)
  expect(r.leafShape).toBe('maple')
  expect(r.leafShapes).toBeGreaterThanOrEqual(9)
  expect(r.leafPuff).toBeGreaterThan(0.08)
  expect(r.crackTop).toBeGreaterThan(1.02)
  expect(r.crackFaces).toBeGreaterThan(24)
  expect(r.crackRealDrawn).toBeGreaterThan(0.3)
  expect(r.crackRealDrawn).toBeLessThan(1)
  expect(Math.abs(r.crackRealTop - r.crackRealDrawn - 0.006)).toBeLessThan(0.003)
  expect(r.waterCut).toBe(false)
  expect(r.leafFalls).toBe(true)
  expect(r.leafLanded).toBe(true)
  expect(r.dinos).toBe(20)
  expect(r.newAnimals).toBe(true)
  expect(r.dinoSeen).toBe(true)
  expect(r.dinoShare).toBeLessThan(0.02)
  expect(r.zombiesMade).toBeGreaterThan(20)
  expect(r.leafDropShare).toBe(1)
  expect(r.spiderAnimal).toBe(true)
  expect(r.waveSpiders).toBe(0)
  expect(r.rexCame).toBe(true)
  expect(r.bitten).toBe(true)
  expect(r.rexAngry).toBe(true)
  expect(r.rexTall).toBeGreaterThan(7)
  expect(r.rexTall).toBeLessThan(9)
  expect(r.brachioTall).toBeGreaterThan(12)
})

// 2026-10-30: weather eases from step to step, new kinds (drizzle, sleet,
// freezing rain, ice storms, thunderstorms, snowstorms, blizzards, frost,
// cold snaps, heatwaves, dust storms), wind that pushes you, lightning in
// the sky, frost on the screen's edges, natural disasters, and 10x luck
// after an impact.
test('smooth weather, wind, sky lightning, disasters and impact luck', async ({ page }) => {
  test.setTimeout(240000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const sky = bm.sky
    const w3 = sky.weather3d
    const D = sky.disasters
    const out = {}
    const run = (s) => { for (let i = 0; i < s * 10; i++) sky.update(0.1) }
    // Random: a step down eases over many seconds, not at once.
    sky.weather = 'random'
    sky._now = sky._goal = 'lightRain'
    sky.apply()
    w3.setSlow(false)
    for (let i = 0; i < 100; i++) w3.update(0.1)
    sky._goal = 'clear'
    sky._stepIn = 0
    sky._rerollIn = 999
    sky.update(0.01)
    out.stepped = sky._now
    const before = w3._density
    run(2)
    out.gentle = before - w3._density < 0.08
    // Every new weather shows (the editor's own pick: straight there).
    const kinds = ['drizzle', 'thunderstorm', 'freezingRain', 'iceStorm', 'snowstorm', 'blizzard', 'sleet', 'frost', 'coldSnap', 'heatwave', 'duststorm']
    out.kinds = {}
    for (const k of kinds) {
      sky.weather = k
      sky._pickWeather()
      sky.apply()
      run(15)
      out.kinds[k] = [sky._now, w3.kind || '']
    }
    // Wind: soft when clear, a gale in a blizzard, pushing you out in it.
    sky.weather = 'clear'
    sky._pickWeather()
    sky.apply()
    run(10)
    out.clearWind = sky.wind.length() < 0.5
    sky.weather = 'blizzard'
    sky._pickWeather()
    sky.apply()
    run(10)
    sky._sheltered = false
    out.blizzardWind = sky.wind.length() > 4
    const v = { set(x, y) { this.x = x; this.y = y; return this } }
    out.pushes = sky.windPush(v, true).x !== 0
    // ...but a clear day's breeze never slides you along the ground.
    sky.wind.set(0.25, 0)
    out.breezeStill = sky.windPush(v, true).x === 0
    // Frost on the screen's edges in a cold snap.
    sky.weather = 'coldSnap'
    sky._pickWeather()
    sky.apply()
    run(12)
    out.frost = Number(document.querySelector('#weather-screen .ws-frost')?.style.opacity) > 0.3
    // Lightning: a bolt in the sky and the sky lighting up.
    sky.weather = 'thunderstorm'
    sky._pickWeather()
    sky.apply()
    sky._lightningIn = 0.05
    sky.update(0.1)
    sky.update(0.02)
    out.lightning = sky.lightning.flash > 0 && sky._thunder.length > 0
    // Every disaster runs start to finish without trouble.
    out.disasters = {}
    for (const k of D.kinds) {
      D.start(k)
      let n = 0
      let shook = 0
      // (a drought lasts a whole game day, an aurora five hours)
      const step = k === 'drought' || k === 'geomagneticStorm' ? 1 : 0.1
      while (D.active && n < 3000) {
        sky.update(step)
        shook = Math.max(shook, D.shake)
        n++
      }
      bm.survival.health = bm.survival.maxHealth
      out.disasters[k] = !D.active
      if (k === 'earthquake') out.quakeShakes = shook > 0.1
    }
    // A disaster goes out with the sky on servers.
    D.start('earthquake')
    out.synced = sky.skyState().d?.k
    D.end()
    // Builds are safe unless "Disasters Can Break Anything" is on.
    const p = bm.tryMode.pos
    // (well outside the camp, which nothing ever touches)
    const x = Math.floor(p.x) + 60
    const y = Math.floor(p.y) + 30
    const z = Math.floor(p.z) + 60
    bm.placeBlock(x, y, z, 'oakplanks')
    out.safe = D.canChange(x, y, z)
    window.__game.settings.disasterBreakAll = true
    out.breakAll = D.canChange(x, y, z)
    window.__game.settings.disasterBreakAll = false
    // An impact: 10x luck for 24 game hours, shown on a chip; rarer
    // animals turn up far more often.
    const luck = sky.luck
    const animals = bm._animals()
    // Spots spread over many biomes: one fixed spot's biome comes from the
    // world's random seed, and some biomes have no rare animals at all
    // (0 vs 0 failed about half the runs).
    const rare = () => { let n = 0; for (let i = 0; i < 3000; i++) { const k = animals.kindAt(((i * 7919) % 4000) - 2000, ((i * 104729) % 4000) - 2000); if (k && !['common', 'uncommon'].includes(animals.constructor.rarityOf(k))) n++ } return n }
    luck.stop()
    const plain = rare()
    D.start('meteoroid')
    out.luck = luck.mult()
    out.luckLeft = Math.round(luck.left())
    sky.update(0.1)
    out.chip = document.getElementById('luck-badge')?.style.display === 'block' && /10x/.test(document.getElementById('luck-badge').textContent)
    out.luckier = rare() > plain * 1.5
    D.end()
    luck.stop()
    return out
  })
  expect(r.stepped).toBe('veryLightRain')
  expect(r).toMatchObject({
    gentle: true,
    kinds: {
      drizzle: ['drizzle', 'drizzle'], thunderstorm: ['thunderstorm', 'thunderstorm'], freezingRain: ['freezingRain', 'freezingRain'],
      iceStorm: ['iceStorm', 'iceStorm'], snowstorm: ['snowstorm', 'snowstorm'], blizzard: ['blizzard', 'blizzard'], sleet: ['sleet', 'sleet'],
      frost: ['frost', ''], coldSnap: ['coldSnap', 'coldSnap'], heatwave: ['heatwave', ''], duststorm: ['duststorm', 'duststorm'],
    },
    clearWind: true,
    blizzardWind: true,
    pushes: true,
    breezeStill: true,
    frost: true,
    lightning: true,
    quakeShakes: true,
    synced: 'earthquake',
    safe: false,
    breakAll: true,
    luck: 10,
    luckLeft: 1440,
    chip: true,
    luckier: true,
  })
  expect(Object.values(r.disasters).every(Boolean)).toBe(true)
})

// 2026-10-30: Q drops the held item and Lock keeps it; Heaven (cloud
// floor, islands) grows up high and goes again below; giant Heaven's
// Peaks reach it; the Demon Realm under y -300 with bedrock at -500; and
// angels, demons and sea zombies where they live.
test('drop key and item lock, Heaven, Heaven\'s Peaks, the Demon Realm and realm zombies', async ({ page }) => {
  test.setTimeout(180000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const inv = s.inv
    const out = {}
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    // --- Drop (Q) and Lock ---
    inv.hotbar[3] = { kind: 'block', id: 'stone', n: 5 }
    inv.select(3)
    const drops = s._drops.list.length
    s.onKeyDown('KeyQ')
    out.dropped = inv.hotbar[3]?.n === 4 && s._drops.list.length === drops + 1
    out.waits = s._drops.list[s._drops.list.length - 1].wait > 2
    inv.toggleLock('hotbar', 3)
    out.lockedStays = inv.drop() === false && inv.hotbar[3].n === 4
    out.saveKeepsLock = (() => {
      const saved = inv.serialize()
      inv.hotbar[3] = null
      inv.restore(saved)
      return inv.hotbar[3]?.lk === 1
    })()
    inv.show(true)
    out.lockIcon = !!document.querySelector('#play-inventory .inv-slot[data-where="hotbar"][data-i="3"] .inv-slot-lock')
    inv.show(false)
    inv.toggleLock('hotbar', 3)
    out.unlockedDrops = inv.drop() === true && inv.hotbar[3].n === 3
    inv.select(0)
    out.gunStays = inv.drop() === false && inv.hotbar[0]?.kind === 'gun'
    inv.hotbar[3] = { kind: 'item', id: 'healthpack', n: 1 }
    out.itemDrops = inv.drop('hotbar', 3) === true && inv.hotbar[3] === null
    // --- Heaven ---
    const world = bm.world
    const peakIn = world.peakIn
    const sampleLand = (x, z) => world.landAt(x, z)
    const HEAVEN_FLOOR = world.heaven.constructor.FLOOR
    const { BOTTOM, DEMON_TOP, rockAt, demonOpen } = world.under.constructor
    const me = s.bodyPos()
    const hx = Math.floor(me.x) + 2000
    const hz = Math.floor(me.z)
    for (let i = 0; i < 600 && world.heaven.cols.size < 113; i++) world.heaven.update({ x: hx, y: 330, z: hz })
    let cloud = 0
    let other = new Set()
    for (let x = hx - 90; x < hx + 90; x++) {
      for (let z = hz - 90; z < hz + 90; z++) {
        if (Math.abs(x - hx) < 40 && Math.abs(z - hz) < 40 && bm.getBlockAt(x, HEAVEN_FLOOR, z) === 'whitewool') cloud++
        for (let y = 318; y <= 490; y += 1) {
          const b = bm.getBlockAt(x, y, z)
          if (b) other.add(b)
        }
      }
    }
    out.cloudFloor = cloud > 80 * 80 * 0.6
    out.islands = other.has('quartzpillar') && (other.has('smoothquartz') || other.has('calcite') || other.has('grass'))
    world.heaven.update({ x: hx, y: 100, z: hz })
    out.heavenGoes = world.heaven.cols.size === 0 && !bm.getBlockAt(hx, HEAVEN_FLOOR, hz)
    // --- Heaven's Peaks ---
    let peak = null
    for (let gx = -3; gx <= 3 && !peak; gx++) for (let gz = -3; gz <= 3 && !peak; gz++) {
      const p = peakIn(gx, gz)
      if (p && sampleLand(p.x, p.z).h > HEAVEN_FLOOR) peak = p
    }
    out.peak = !!peak
    if (peak) {
      const h = (dx) => sampleLand(peak.x + dx, peak.z).h
      out.peakTall = h(0) > HEAVEN_FLOOR && h(0) < 380
      // Climbable: roughly a block up per cell on at least one side (the
      // world's seed is random and one side of about 1 peak in 8 has
      // cliffs - checked over 120 worlds, the best side never had more
      // than 9 steps over 2 blocks).
      const steepOn = (ux, uz) => {
        let n = 0
        for (let d = 20; d < 300; d++) if (Math.abs(sampleLand(peak.x + ux * d, peak.z + uz * d).h - sampleLand(peak.x + ux * (d + 1), peak.z + uz * (d + 1)).h) > 2) n++
        return n
      }
      out.peakClimbable = Math.min(steepOn(1, 0), steepOn(-1, 0), steepOn(0, 1), steepOn(0, -1)) < 15
    }
    // --- the Demon Realm ---
    out.bottom = BOTTOM === -500 && DEMON_TOP === -300
    out.bedrock = rockAt(hx, BOTTOM, hz) === 'bedrock' && rockAt(hx, -250, hz) !== 'bedrock'
    out.demonRock = ['netherrack', 'soulsand', 'blackstone', 'magmablock', 'netherbrick'].includes(rockAt(hx, -400, hz))
    let openCells = 0
    let n = 0
    for (let x = 0; x < 200; x += 7) for (let y = -480; y < -310; y += 5) for (let z = 0; z < 200; z += 7) { n++; if (demonOpen(hx + x, y, hz + z)) openCells++ }
    out.caverns = openCells / n > 0.25 && openCells / n < 0.75
    out.noDemonUpHigh = !demonOpen(hx, -150, hz)
    // --- realm zombies ---
    const kinds = (realm) => {
      const seen = new Set()
      for (let i = 0; i < 40; i++) if (s._spawnZombie([realm])) seen.add(s.zombies[s.zombies.length - 1].kind)
      for (const z of [...s.zombies]) s._removeZombie(z)
      s.zombies = []
      return [...seen].sort()
    }
    out.heavenKinds = kinds([hx, HEAVEN_FLOOR + 1, hz])
    out.demonKinds = kinds([hx, -400, hz])
    // (Away from the camp - nothing comes up inside it.)
    const wx = Math.floor(me.x) + 300
    const wz = Math.floor(me.z) + 6
    const wy = 200
    bm._placeBlockInner(wx, wy, wz, 'water')
    bm._placeBlockInner(wx, wy + 1, wz, 'water')
    const sea = kinds([wx, wy, wz])
    out.oceanKinds = sea.filter((k) => ['drowned', 'sharkman', 'jelly', 'angler'].includes(k)).length >= 2
    // Every new kind is built, moves, and stands about 2 blocks tall.
    const sizes = {}
    for (const k of [...out.heavenKinds, ...out.demonKinds, 'drowned', 'sharkman', 'jelly', 'angler']) {
      const zb = s._makeZombie(9100, me.x + 4, me.y, me.z + 4, 100, false, k)
      zb.group.position.set(zb.x * s.B, zb.y * s.B, zb.z * s.B)
      zb.monster.update(0.1, 1)
      zb.monster.root.updateMatrixWorld(true)
      let box = null
      zb.monster.root.traverse((o) => {
        if (!o.isMesh) return
        o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)
        box = box ? box.union(b) : b
      })
      // From its feet to the top of its head (floating ones hang above).
      sizes[k] = Math.round((box.max.y / s.B - zb.y) * 10) / 10
      s._removeZombie(zb)
    }
    s.zombies = []
    out.tallEnough = Object.entries(sizes).filter(([k, h]) => k !== 'hellhound' && (h < 1.7 || h > 2.6)).map(([k, h]) => `${k} ${h}`)
    return out
  })
  expect(r).toEqual({
    dropped: true, waits: true, lockedStays: true, saveKeepsLock: true, lockIcon: true, unlockedDrops: true, gunStays: true, itemDrops: true,
    cloudFloor: true, islands: true, heavenGoes: true,
    peak: true, peakTall: true, peakClimbable: true,
    bottom: true, bedrock: true, demonRock: true, caverns: true, noDemonUpHigh: true,
    heavenKinds: ['angel', 'archangel', 'cherub', 'seraph'],
    demonKinds: ['demon', 'fiend', 'hellhound', 'imp'],
    oceanKinds: true, tallEnough: [],
  })
})

test('real place names, real-place pyramids and towns sized to their country', async ({ page }) => {
  const { featureAt, FEATURE_IDS } = await import('../src/game/EarthFeatures.js')
  expect([
    featureAt(-3.1, -60, { river: true }), featureAt(30, 31.2, { river: true, water: true }), featureAt(27.98, 86.9),
    featureAt(23, 13), featureAt(40, -30, { water: true }), featureAt(35, 18, { water: true }), featureAt(48.85, 2.35),
  ]).toEqual(['amazonRiver', 'nile', 'everest', 'sahara', 'atlantic', 'mediterranean', ''])
  const { STRINGS } = await import('../src/game/i18n.js')
  for (const lang of ['en', 'zh', 'hi', 'es']) for (const id of FEATURE_IDS) expect(STRINGS[lang][`feat_${id}`], `${lang} ${id}`).toBeTruthy()
  const { planStructure, planTown } = await import('../src/game/WorldStructures.js')
  const hash = (a, b, s) => { const x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453; return x - Math.floor(x) }
  const kinds = (placeAt, biome) => {
    const k = new Set()
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) k.add(planStructure(i, j, { land: () => ({ h: 5, biome, c: 0.5 }), hash, sea: 0, cityDistance: () => 1e9, chunk: 16, placeAt })?.kind)
    return k
  }
  expect(kinds(null, 'desert').has('pyramid')).toBe(true)
  expect(kinds(() => ({ country: 'China', lat: 40, lon: 85 }), 'desert').has('pyramid')).toBe(false)
  expect(kinds(() => ({ country: 'Egypt', lat: 27, lon: 30 }), 'desert').has('pyramid')).toBe(true)
  expect(kinds(() => ({ country: 'Kenya', lat: 0, lon: 37 }), 'savanna').has('castle')).toBe(false)
  expect(kinds(() => ({ country: 'France', lat: 47, lon: 2 }), 'plains').has('castle')).toBe(true)
  const { townStyleFor } = await import('../src/game/Towns.js')
  expect([townStyleFor('latin', 'Mali'), townStyleFor('asian', 'India'), townStyleFor('modern', 'Japan')]).toEqual(['rural', 'asian-low', 'modern'])
  const tallest = (style) => Math.max(...[...planTown(style, 0, 0, 10, 7, { land: () => ({ h: 5, biome: 'plains' }), chunk: 16 }).top.values()].map((v) => v.y))
  expect(tallest('rural')).toBeLessThan(tallest('modern'))
  expect(tallest('modern-low')).toBeLessThan(tallest('modern'))

  // In the game: the spawn map fills the screen pole to pole, and Mount
  // Everest's name goes under the map and up as a big title.
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap'; window.__game.playBtn.click() })
  await page.waitForFunction(() => document.getElementById('spawn-map')?.style.display === 'block', null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const map = document.getElementById('spawn-map')
    const box = map.getBoundingClientRect()
    const [, top] = map._clientAt(89.9, 0)
    const [, bottom] = map._clientAt(-89.9, 0)
    const tm = window.__game.buildMode.tryMode
    const name = tm._featureName(Math.floor(86.9 * 120), Math.floor(-27.98 * 120))
    const title = document.getElementById('build-place-title')
    return { fills: Math.abs(top - box.top) < 4 && Math.abs(bottom - box.bottom) < 4, name, title: title?.textContent, shown: title?.classList.contains('show') }
  })
  expect(r).toEqual({ fills: true, name: 'Mount Everest', title: 'Mount Everest', shown: true })
})

// 3D flicker fixes (ThreeFixes.js): moved instances keep being drawn, and
// our own shaders join the sharper (logarithmic) depth.
test('moved things stay drawn and close surfaces get sharp depth', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const bm = g.buildMode
    const THREE = window.__three
    const out = { logDepth: g.renderer.capabilities.logarithmicDepthBuffer }
    if (!THREE) return { ...out, noThree: true }
    // An instance moved far away, after it was first drawn.
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 1)
    mesh.setMatrixAt(0, new THREE.Matrix4())
    bm.scene.add(mesh)
    g.renderer.render(bm.scene, bm.camera)
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(500, 0, 0))
    mesh.instanceMatrix.needsUpdate = true
    g.renderer.render(bm.scene, bm.camera)
    out.boundsFollow = mesh.boundingSphere.center.x > 400
    bm.scene.remove(mesh)
    // A plain ShaderMaterial picks up the depth code.
    const mat = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' })
    const shader = { vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader }
    mat.onBeforeCompile(shader, g.renderer)
    out.shaderDepth = shader.vertexShader.includes('vFragDepth') && shader.fragmentShader.includes('logdepthbuf_fragment')
    return out
  })
  expect(r).toEqual({ logDepth: true, boundsFollow: true, shaderDepth: true })
})

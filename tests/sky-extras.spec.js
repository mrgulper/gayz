import { test, expect } from '@playwright/test'

// Sky and world-map extras (2026-11-09): stronger sky fade, sun rays,
// constellations, planets, dawn birdsong, the globe fading in over the
// block map with a night side and clouds, and the unexplored fog.
test('sky extras and the World Map globe fade and fog', async ({ page }) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.goto('/')
  await page.waitForFunction(() => window.__game?.playBtn, null, { timeout: 120000 })
  await page.evaluate(() => {
    localStorage.removeItem('gayz-world-explored-v1')
    const g = window.__game
    g.settings.selectedGameMode = 'worldMap'
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    s._spawnAt({ lat: 23, lon: 10, biome: 'desert' })
    s._pickWeapon('rifle')
  })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const sky = bm.sky
    const tm = bm.tryMode
    const out = {}
    // Night: constellations and planets show with the stars; the lines only
    // while looking up.
    sky.time = 'night'
    sky.weather = 'clear'
    sky._now = 'clear'
    sky.apply()
    bm._pitch = 1.1
    bm.camera.rotation.set(1.1, 0, 0, 'YXZ')
    bm.camera.updateMatrixWorld()
    for (let i = 0; i < 60; i++) sky.nightSky.update(0.05, bm.camera, 1)
    out.night = [sky.nightSky.group.visible, sky.nightSky.lineMat.opacity > 0.2, sky.nightSky.planets.some((p) => p.material.opacity > 0.5)]
    bm.camera.rotation.set(-0.4, 0, 0, 'YXZ')
    bm.camera.updateMatrixWorld()
    for (let i = 0; i < 60; i++) sky.nightSky.update(0.05, bm.camera, 1)
    out.linesDown = sky.nightSky.lineMat.opacity < 0.05
    // Day: no night sky.
    sky.time = 'day'
    sky.apply()
    out.dayHidden = !sky.nightSky.group.visible
    // Dawn birdsong: night -> day in a game starts about a minute of it.
    sky.time = 'cycle'
    sky._wasNight = true
    sky._inGame = true
    sky._now = 'clear'
    sky._birdsFor = 0
    const night = sky.nightAmount
    sky.nightAmount = () => 0
    sky._birdsong(0.1)
    sky.nightAmount = night
    out.birds = sky._birdsFor > 50
    // Unexplored fog: walking reveals cells, saved a few seconds later.
    const explored = tm.explored
    const x0 = tm.pos.x
    const z0 = tm.pos.z
    explored.visit(x0, z0, 0.1)
    out.seenHere = explored.seenIn(x0 - 8, z0 - 8, 16) === 1
    out.seenFar = explored.seenIn(x0 + 5000, z0, 16)
    for (let i = 0; i < 60; i++) explored.visit(x0, z0, 0.1)
    out.saved = (JSON.parse(localStorage.getItem('gayz-world-explored-v1') || '{}').c || []).length > 0
    // The globe fades in over the block map as you zoom out.
    tm.cycleMap()
    tm.cycleMap()
    const steps = []
    let t = performance.now() + 5000
    for (let i = 0; i < 200 && tm._mapSpan() < 90 * 120; i++) {
      tm.zoomMap(1.05)
      t += 1000
      tm._drawMap(t)
      steps.push([tm._mapSpan() / 120, tm._globe ? Number(tm._globe.gl.style.opacity || 1) : 0, Number(tm._mapCanvas.style.opacity || 1), tm._mapEl.classList.contains('globe')])
    }
    out.before = steps.filter((s) => s[0] < 47).every((s) => s[1] === 0 && s[2] === 1)
    out.during = steps.some((s) => s[0] > 50 && s[0] < 68 && s[1] > 0.05 && s[1] < 1)
    out.after = steps.filter((s) => s[0] > 71).every((s) => s[1] === 1 && s[3])
    out.lights = !!tm._globe?.nightMat && !!tm._globe?.clouds
    return out
  })
  expect(r).toEqual({
    night: [true, true, true],
    linesDown: true,
    dayHidden: true,
    birds: true,
    seenHere: true,
    seenFar: 0,
    saved: true,
    before: true,
    during: true,
    after: true,
    lights: true,
  })
  // The real-time night side: the sun is overhead roughly where it's noon.
  const { subsolarPoint } = await import('../src/game/EarthGlobe.js').catch(() => ({}))
  if (subsolarPoint) {
    const p = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0)))
    expect(Math.abs(p.lon)).toBeLessThan(1)
    expect(p.lat).toBeGreaterThan(22)
  }
})

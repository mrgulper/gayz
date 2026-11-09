import { test, expect } from '@playwright/test'
import { fakeServerDb } from './fakeServerDb.js'
import { createServer, joinServer, syncServer } from '../api/_lib/servers.js'

// World Map travel (2026-11-09): passport stamps, the explored counter,
// climbing to see further, fast travel, the travel journal and shared fog.

test('world travel: shared fog pieces pass through the server', async () => {
  const db = fakeServerDb()
  const t0 = 1_000_000
  const a = await createServer(db, { name: 'Trip', nickname: 'Ann' }, t0)
  const b = await joinServer(db, { serverId: a.serverId, nickname: 'Bo' }, t0 + 10)
  await syncServer(db, { ...b, state: { x: 1, y: 2, z: 3, fog: { n: 4, c: '2k0f,1,1,8' } } }, t0 + 20)
  let ra = await syncServer(db, { ...a, state: { x: 0, y: 0, z: 0 } }, t0 + 30)
  expect(ra.players[b.playerId].fog).toEqual({ n: 4, c: '2k0f,1,1,8' })
  // Anything else is dropped.
  await syncServer(db, { ...b, state: { x: 1, y: 2, z: 3, fog: { n: 5, c: '<img>' } } }, t0 + 40)
  ra = await syncServer(db, { ...a, state: { x: 0, y: 0, z: 0 } }, t0 + 50)
  expect(ra.players[b.playerId].fog).toBeNull()
  await syncServer(db, { ...b, state: { x: 1, y: 2, z: 3, fog: { n: 6, c: Array(401).fill('1').join(',') } } }, t0 + 60)
  ra = await syncServer(db, { ...a, state: { x: 0, y: 0, z: 0 } }, t0 + 70)
  expect(ra.players[b.playerId].fog).toBeNull()
})

test('world travel: passport, counter, climbing, fast travel, journal, fog sharing', async ({ page }) => {
  test.setTimeout(300000)
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.goto('/')
  await page.waitForFunction(() => window.__game?.playBtn, null, { timeout: 120000 })
  await page.evaluate(() => {
    for (const k of ['gayz-world-explored-v1', 'gayz-world-explored-v2', 'gayz-passport-v1', 'gayz-world-journal-v1']) localStorage.removeItem(k)
    const g = window.__game
    g.settings.selectedGameMode = 'worldMap'
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 120000 })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    const explored = tm.explored
    for (const a of document.querySelectorAll('audio, video')) a.muted = true
    s._spawnAt({ lat: 40.2, lon: -3.7, biome: 'plains' })
    s._pickWeapon('rifle')
    const out = {}
    const ex = tm.worldTravel
    const { passport, journal } = ex
    const ft = ex

    // Passport: Spain's stamp, a big welcome with the coins line.
    tm._worldTravel(0.1)
    const title = document.getElementById('build-place-title')
    out.stamp = passport.has('Spain')
    out.welcome = [title?.lastChild?.textContent, title?.classList.contains('big'), !!title?.querySelector('.place-sub')?.textContent.includes('15')]
    out.coins = s.coins
    // Walking back in later isn't a new stamp.
    passport.reset()
    passport.update(tm.pos.x + 40, tm.pos.z, tm, s)
    out.coinsAgain = s.coins

    // Climbing: far off, standing low clears little, standing high a lot.
    out.reveal = [ex.revealFor(0), ex.revealFor(40), ex.revealFor(400)]
    const fx = tm.pos.x + 3000
    const fz = tm.pos.z
    explored.visit(fx, fz, 0.1, 0)
    out.lowFar = explored.seenAt(fx + 120, fz)
    explored.visit(fx, fz, 0.1, 120)
    out.highFar = explored.seenAt(fx + 120, fz)

    // Counter: under the big middle map, with the Passport button.
    tm.cycleMap()
    tm.cycleMap()
    tm._exploredAt = 0
    tm._drawMap(performance.now() + 5000)
    const bar = document.getElementById('world-map-bar')
    out.bar = [getComputedStyle(bar).display, bar.querySelector('.world-map-seen').textContent]
    out.cornerHidden = getComputedStyle(document.getElementById('world-explored')).display === 'none'
    bar.querySelector('button').click()
    const book = document.getElementById('world-passport')
    out.book = [book.classList.contains('open'), [...book.querySelectorAll('.passport-stamp b')].map((b) => b.textContent)]
    book.querySelector('[data-close]').click()
    out.bookClosed = !book.classList.contains('open')

    // Fast travel: to a cleared spot in France.
    const tx = 2.4 * 120
    const tz = -46.6 * 120
    out.unexplored = ft.travelInfo(s, tx, tz).why
    explored.visit(tx, tz, 0.1, 0)
    // The pin menu offers it.
    s.pins.list.push({ id: 99, x: tx, z: tz, vis: 'm', color: '#f00' })
    s.pins._open = s.pins.list[s.pins.list.length - 1]
    tm._drawMap(performance.now() + 9000)
    out.pinButton = document.querySelector('#map-pin-menu button.map-travel')?.textContent || ''
    s.coins = 3
    out.poor = ft.travelInfo(s, tx, tz).why
    s.coins = 100
    const cost = ft.travelInfo(s, tx, tz).cost
    out.flew = ft.flyTo(s, tx, tz)
    out.landed = [Math.abs(tm.pos.x - tx) < 2, Math.abs(tm.pos.z - tz) < 2, s.coins === 100 - cost]
    out.wait = ft.travelInfo(s, tx + 10, tz).why
    s._travelAt = -1e9
    const sx = -20 * 120
    const sz = -40 * 120
    explored.visit(sx, sz, 0.1, 0)
    out.sea = ft.travelInfo(s, sx, sz).why

    // The globe: the middle of the picture is where it faces.
    tm._mapMode = 2
    tm._applyMapMode()
    for (let i = 0; i < 120 && !tm._mapEl.classList.contains('globe'); i++) {
      tm.zoomMap(1.08)
      tm._drawMap(performance.now() + 20000 + i * 1000)
    }
    const spot = tm._globe?.pick(0.5, 0.5)
    out.globe = spot ? [Math.abs(spot.lat - -tm.pos.z / 120) < 2, Math.abs(spot.lon - tm.pos.x / 120) < 2] : null
    out.offGlobe = tm._globe?.pick(0.01, 0.01)
    tm._mapMode = 0
    tm._applyMapMode()

    // Journal: a trail point every few steps, a new colour for a new
    // day, a chest, then a skull on death.
    const before = journal.trail.length
    const day = journal.day
    for (let i = 0; i < 10; i++) journal.update(tm.pos.x + i * 13, tm.pos.z, 1, 0.1)
    journal.update(tm.pos.x + 140, tm.pos.z, 2, 0.1)
    out.trail = [journal.trail.length - before >= 10, journal.day === day + 1]
    journal.loot(tm.pos.x, tm.pos.z)
    journal.loot(tm.pos.x + 1, tm.pos.z)
    out.chests = journal.chests.length
    tm.cycleMap()
    tm._drawMap(performance.now() + 60000)
    tm._mapMode = 0
    tm._applyMapMode()

    // Shared fog: packing round-trips, pieces stay up until the next is due,
    // other players' pieces and walking clear my fog.
    out.pack = ex.unpackKeys(ex.packKeys([5, 9, 100, 4000]))
    explored.startShare()
    const p1 = explored.shareState(1000)
    const p1again = explored.shareState(1200)
    const p2 = explored.shareState(1600)
    out.share = [!!p1 && p1 === p1again, !!p2 && p2.n === p1.n + 1]
    const far = [-120 * 120, 30 * 120]
    const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096)
    explored.addKeys([key(Math.floor(far[0] / 16), Math.floor(far[1] / 16))])
    out.added = explored.seenAt(far[0], far[1])
    explored.visitOther('p9', 100 * 120, 0, -10 * 120)
    out.other = explored.seenAt(100 * 120, -10 * 120)

    // Saved: the passport now, the journal and fog a few seconds later.
    journal.save()
    explored.save()
    out.saved = [!!JSON.parse(localStorage.getItem('gayz-passport-v1') || '{}').s?.Spain, (JSON.parse(localStorage.getItem('gayz-world-journal-v1') || '{}').t || '').length > 0, (JSON.parse(localStorage.getItem('gayz-world-explored-v2') || '{}').d || '').length > 0]

    // Dying leaves a skull.
    s.health = 0
    s._die()
    out.skulls = journal.skulls.length
    return out
  })
  expect(r.stamp).toBe(true)
  expect(r.welcome).toEqual(['Welcome to Spain!', true, true])
  expect(r.coins).toBe(15)
  expect(r.coinsAgain).toBe(15)
  expect(r.reveal).toEqual([2, 6, 10])
  expect(r.lowFar).toBe(false)
  expect(r.highFar).toBe(true)
  expect(r.bar[0]).toBe('flex')
  expect(r.bar[1]).toMatch(/^You've seen .+% of Spain · .+% of Earth$/)
  expect(r.cornerHidden).toBe(true)
  expect(r.book).toEqual([true, ['Spain']])
  expect(r.bookClosed).toBe(true)
  expect(r.unexplored).toBe('Explore it first')
  expect(r.pinButton).toMatch(/^Fly here · \d+ coins$/)
  expect(r.poor).toMatch(/^Need \d+ coins$/)
  expect(r.flew).toBe(true)
  expect(r.landed).toEqual([true, true, true])
  expect(r.wait).toMatch(/^Next trip in \d:\d\d$/)
  expect(r.sea).toBe('Pick a spot on land')
  expect(r.globe).toEqual([true, true])
  expect(r.offGlobe).toBeNull()
  expect(r.trail).toEqual([true, true])
  expect(r.chests).toBe(1)
  expect(r.pack).toEqual([5, 9, 100, 4000])
  expect(r.share).toEqual([true, true])
  expect(r.added).toBe(true)
  expect(r.other).toBe(true)
  expect(r.saved).toEqual([true, true, true])
  expect(r.skulls).toBe(1)

  // Phone, portrait: the bar sits under the big map, inside the screen,
  // clear of the close button; the passport stays inside the map.
  await page.setViewportSize({ width: 375, height: 812 })
  const m = await page.evaluate(() => {
    const tm = window.__game.buildMode.tryMode
    const s = window.__game.buildMode.survival
    s.dead = false
    document.body.classList.add('touch-play-on')
    tm._mapMode = 2
    tm._applyMapMode()
    tm._exploredAt = 0
    tm._drawMap(performance.now() + 90000)
    const rect = (id) => document.getElementById(id).getBoundingClientRect()
    const bar = rect('world-map-bar')
    const map = rect('build-try-map')
    const close = rect('build-try-map-close')
    document.querySelector('#world-map-bar button').click()
    const book = rect('world-passport')
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    return { inScreen: bar.left >= 0 && bar.right <= 375 && bar.bottom <= 812, below: bar.top >= map.bottom, clearOfClose: !overlap(bar, close), bookInMap: book.left >= map.left && book.right <= map.right && book.bottom <= map.bottom }
  })
  expect(m).toEqual({ inScreen: true, below: true, clearOfClose: true, bookInMap: true })
})

test('world travel: a friend on the server clears my fog and gets mine', async ({ page }) => {
  test.setTimeout(240000)
  const db = fakeServerDb()
  const { listServers, leaveServer } = await import('../api/_lib/servers.js')
  const fns = { list: () => listServers(db), create: (b) => createServer(db, b), join: (b) => joinServer(db, b), leave: (b) => leaveServer(db, b), sync: (b) => syncServer(db, b) }
  await page.exposeFunction('__srv', async (name, body) => {
    try {
      return { ok: await fns[name](body) }
    } catch (err) {
      return { err: err.code || 'server' }
    }
  })
  await page.goto('/')
  await page.waitForFunction(() => window.__game?.playBtn, null, { timeout: 120000 })
  await page.evaluate(() => {
    localStorage.removeItem('gayz-world-explored-v2')
    const call = async (name, body) => {
      const r = await window.__srv(name, body)
      if (r.err) throw Object.assign(new Error(r.err), { code: r.err })
      return r.ok
    }
    const g = window.__game
    g.__serversBackendForTests = { list: () => call('list'), create: (b) => call('create', b), join: (b) => call('join', b), leave: (b) => call('leave', b), sync: (b) => call('sync', b) }
    g.settings.selectedGameMode = 'worldMap'
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 120000 })
  await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    s._spawnAt({ lat: 40.2, lon: -3.7, biome: 'plains' })
    s._pickWeapon('rifle')
    window.__game.buildMode.tryMode._worldTravel(0.1)
  })
  await page.waitForFunction(() => !!window.__game.buildMode.survival.lobby, null, { timeout: 60000 })
  const serverId = Object.keys(db.root.servers || {})[0]
  const b = await joinServer(db, { serverId, nickname: 'Bo' })
  // A cell far away that only Bo has seen, and Bo standing somewhere else.
  const cell = (x, z) => (Math.floor(x / 16) + 4096) * 8192 + (Math.floor(z / 16) + 4096)
  const seenByBo = [60 * 120, -20 * 120]
  const boAt = [-60 * 120, -10 * 120]
  await syncServer(db, { ...b, state: { x: boAt[0], y: 0, z: boAt[1], fog: { n: 1, c: cell(...seenByBo).toString(36) } } })
  const r = await page.evaluate(async ([seenByBo, boAt]) => {
    const s = window.__game.buildMode.survival
    const explored = window.__game.buildMode.tryMode.explored
    const before = [explored.seenAt(...seenByBo), explored.seenAt(...boAt)]
    s.lobby._lastLobbySync = 0
    await s.lobby._sync()
    const net = s.net || s.lobby
    net._lastLobbySync = 0
    const after = [explored.seenAt(...seenByBo), explored.seenAt(...boAt)]
    // Bo is new to me: I start sending what I've seen.
    const sharing = !!explored._share
    await net._sync()
    return { before, after, sharing }
  }, [seenByBo, boAt])
  expect(r).toEqual({ before: [false, false], after: [true, true], sharing: true })
  // ...and it reached the server for Bo.
  const rb = await syncServer(db, { ...b, state: { x: boAt[0], y: 0, z: boAt[1] } })
  const mine = Object.values(rb.players).find((p) => p.fog)
  expect(mine?.fog?.c?.length).toBeGreaterThan(0)
})

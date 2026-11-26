// Map 1 play: guns, controls, pause, spectate, phone.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { PLAY_WEAPONS } from '../src/game/PlayWeapons.js'

// Play (BuildSurvival.js): waves spawn at the Zombie Spawner, zombies find
// a way round a wall to you, shots kill them, chests give loot once.
test('Play mode spawns zombie waves that reach you and can be shot', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 14, 'zombiespawner')
    bm.placeBlock(2, 0, 1, 'lootchest', false, { facing: 0 })
    // A wall between the spawner and you, with a gap at one end.
    for (let x = -6; x <= 4; x++) for (let y = 0; y < 3; y++) bm.placeBlock(x, y, 7, 'stone')
    // Where each zombie appears (checked there, not after it has had time
    // to walk off - that made the check depend on the machine's speed).
    const spawnedAt = []
    const make = s._makeZombie.bind(s)
    s._makeZombie = (...args) => {
      const z = make(...args)
      spawnedAt.push(z.z)
      return z
    }
    s.start()
    // The zombie skin is painted and loaded in the background.
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    const out = { started: s.active && bm.tryMode.active }
    out.startCell = [Math.floor(bm.tryMode.pos.x), Math.floor(bm.tryMode.pos.z)]
    // Run the game forward without real frames.
    const step = (secs) => { for (let i = 0; i < secs * 20; i++) { bm.tryMode.update(0.05, new Set()); s.update(0.05) } }
    step(4)
    out.wave = s.wave
    out.spawned = s.zombies.length
    out.spawnNearSpawner = spawnedAt.length > 0 && spawnedAt.every((z) => Math.abs(z - 14.5) < 1.5)
    s.health = 1e9
    step(14)
    const p = bm.tryMode.pos
    out.closest = Math.min(...s.zombies.map((z) => Math.hypot(z.x - p.x, z.z - p.z)))
    out.wentRound = s.zombies.some((z) => z.z < 7)
    // Shoot the one in front - not a bloater: its burst kills the zombies
    // bunched up beside it, so the kill count jumped by more than one.
    const target = s.zombies.find((z) => z.kind !== 'bloater') || s.zombies[0]
    const killsBefore = s.kills
    const bodiesBefore = (s._corpses || []).length
    // (Rare tiers and cave zombies have up to ~8x the health - keep hitting.)
    for (let i = 0; i < 200 && s.zombies.includes(target); i++) s.damageZombie(target, 34)
    out.killed = s.kills === killsBefore + 1
    // Its body falls over and fades away (own material copies - the live
    // zombies' shared ones are never touched). (Zombies burning in the sun
    // may have left bodies already - this one is the newest.)
    const corpse = (s._corpses || [])[bodiesBefore]
    out.corpse = !!corpse && s._corpses.length === bodiesBefore + 1
    out.ownMaterials = !!corpse && corpse.materials.length > 0 && corpse.materials.every((m) => !s._zBatch.meshes.some((mesh) => [].concat(mesh.material).includes(m)))
    // Falls, bounces once and settles (the comic flop, 2026-10-31).
    step(1.1)
    out.fell = !!corpse && Math.abs(corpse.group.rotation.x - Math.PI / 2) < 0.01
    // Bodies lie for 40 s, then fade over the rest of a minute (2026-10-18).
    s._updateCorpses(45)
    out.fading = !!corpse && corpse.materials[0].opacity > 0 && corpse.materials[0].opacity < 1
    s._updateCorpses(16)
    out.corpseGone = (s._corpses || []).length === 0
    out.mag = s.mag
    out.fired = s.tryFire() && s.mag === out.mag - 1
    const reserve = s.reserve
    out.chest = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    out.chestOnce = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    s.health = 5
    s._hurtPlayer(10)
    // (The death replay plays first - skipped here, DeathReplay.js.)
    s.replay?.stop()
    out.dead = s.dead && document.getElementById('build-play-over').style.display === 'flex'
    s.stop()
    out.stopped = !s.active && !bm.tryMode.active && s.zombies.length === 0
    g._exitBuildMode()
    return out
  })

  expect(r.started).toBe(true)
  expect(r.startCell).toEqual([0, 0])
  expect(r.wave).toBe(1)
  expect(r.spawned).toBeGreaterThan(0)
  expect(r.spawnNearSpawner).toBe(true)
  expect(r.wentRound).toBe(true)
  expect(r.closest).toBeLessThan(2)
  expect(r.killed).toBe(true)
  expect(r.corpse).toBe(true)
  expect(r.ownMaterials).toBe(true)
  expect(r.fell).toBe(true)
  expect(r.fading).toBe(true)
  expect(r.corpseGone).toBe(true)
  expect(r.fired).toBe(true)
  expect(r.chest).toBe(true)
  expect(r.chestOnce).toBe(true)
  expect(r.dead).toBe(true)
  expect(r.stopped).toBe(true)
})

// Map 3's walled camp in Play (BuildCamp.js): a safe zone with a Trader,
// Upgrader, Ammo Refill and Quest Board.
test('Map 3 Play starts in a safe camp with working NPCs', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    // A returning player (a first game starts at the gate, PlayOnboarding).
    g.careerStats.totalRuns = 1
    await g._enterBuildMode({ map: 'map3', play: true })
    // Play fades to black while Map 1 loads and back in once it's drawn.
    const fade = document.getElementById('play-fade')
    const cleared = () => !!fade && !fade.classList.contains('on') && fade.style.display === 'none'
    for (let i = 0; i < 100 && !cleared(); i++) await new Promise((res) => setTimeout(res, 100))
    const faded = cleared()
    const s = g.buildMode.survival
    const c = s.camp
    const p = g.buildMode.tryMode.pos
    const out = { faded, camp: !!c, startsInside: !!c && c.inside(p.x, p.z), npcs: c ? c.npcs.map((n) => n.id).sort().join() : '' }
    // Zombies can't step into the camp, and can't hurt you there.
    out.wall = s._zombieHits(c.zone.cx + 0.5, 0, c.zone.cz + 0.5)
    // The last row along the far (+x/+z) walls is camp too - zombies used
    // to spawn there (inside() shrank those sides when given a margin).
    const zn = c.zone
    out.farRows = [[zn.x1 - 0.5, zn.cz + 0.5], [zn.cx + 0.5, zn.z1 - 0.5], [zn.x1 - 0.5, zn.z1 - 0.5]]
      .every(([x, z]) => c.inside(x, z, 1) && s._zombieHits(x, 0, z))
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    s.wave = 6
    s._breakTimer = 999
    for (let i = 0; i < 60; i++) s._spawnZombie()
    let inCamp = 0
    for (let f = 0; f < 240; f++) {
      s.health = 100
      s.update(1 / 30)
      inCamp += s.zombies.filter((z) => c.inside(z.x, z.z)).length
    }
    out.inCamp = inCamp
    const hp = s.health
    s._hurtPlayer(30)
    out.safe = s.health === hp
    s.coins = 1000
    s.shop._act('buy', 'armor')
    out.armor = s.armor
    s.shop._act('upgrade', 'mag')
    out.mag = s.magSize()
    s.mag = 0
    s.reserve = 0
    s.shop._act('fill', 'fill')
    out.filled = s.mag === s.magSize() && s.reserve > 0
    s.stats.kills = 15
    s.shop._act('claim', 'kill15')
    out.coinsLeft = s.coins
    out.nextQuests = s.shop.activeQuests().map((q) => q.id).join()
    // The board closes on a click outside it, and stays open on one inside.
    c.npcs.length && s.shop.openPanel('trader')
    document.getElementById('play-npc-list').click()
    out.insideKeepsOpen = s.shop.panelOpen
    document.getElementById('play-npc-panel').click()
    out.outsideCloses = !s.shop.panelOpen
    s.stop()
    out.cleaned = !s.camp
    g._exitBuildMode()
    return out
  })

  expect(r.faded).toBe(true)
  expect(r.camp).toBe(true)
  expect(r.startsInside).toBe(true)
  expect(r.npcs).toBe('ammo,quest,trader,upgrader')
  expect(r.wall).toBe(true)
  expect(r.farRows).toBe(true)
  expect(r.inCamp).toBe(0)
  expect(r.safe).toBe(true)
  expect(r.armor).toBe(50)
  expect(r.mag).toBe(40)
  expect(r.filled).toBe(true)
  expect(r.coinsLeft).toBe(1000 - 75 - 90 + 100)
  expect(r.nextQuests).toBe('chest3,head10,wave5')
  expect(r.insideKeepsOpen).toBe(true)
  expect(r.outsideCloses).toBe(true)
  expect(r.cleaned).toBe(true)
})

// The same camp NPCs also stand in Map 3's camp in the Map Editor (just to
// look at - no panels), and step aside for Play's own camp.
test('Map 3 camp NPCs show in the Map Editor too', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    const out = { npcs: b._campDisplay ? b._campDisplay.npcs.map((n) => n.id).sort().join() : '' }
    // The camp's wall has exactly one way in: the three-wide main gate.
    const { map } = b._map3Base()
    const z = map.safeZone
    const solid = new Set(map.blocks.filter((k) => k.y >= 0 && k.y <= 1).map((k) => `${k.x},${k.y},${k.z}`))
    let gaps = 0
    for (let x = z.x0; x <= z.x1; x++) for (let zz = z.z0; zz <= z.z1; zz++) {
      if (x !== z.x0 && x !== z.x1 && zz !== z.z0 && zz !== z.z1) continue
      if (!solid.has(`${x},0,${zz}`) || !solid.has(`${x},1,${zz}`)) gaps++
    }
    out.wallGaps = gaps
    // The NPCs' skins (made in Design a Skin) have loaded.
    for (let i = 0; i < 40 && b._campDisplay.npcs.some((n) => !n.body); i++) await new Promise((res) => setTimeout(res, 250))
    out.bodies = b._campDisplay.npcs.filter((n) => n.body).length
    b.survival.start()
    b.update(0.016)
    out.duringPlay = !!b._campDisplay
    out.playCamp = !!b.survival.camp
    b.survival.stop()
    b.update(0.016)
    out.back = !!b._campDisplay
    g._exitBuildMode()
    out.afterExit = !!b._campDisplay
    return out
  })

  expect(r).toEqual({ npcs: 'ammo,quest,trader,upgrader', wallGaps: 3, bodies: 4, duringPlay: false, playCamp: true, back: true, afterExit: false })
})

// The homepage Play button starts the block city's zombie waves - the old
// Map 1 city is gone and the block city is Map 1 now (internal slot 'map3').
// Its run uses the Game Mode panel's picks and the Upgrades bought
// (PlayRules.js), and a finished run is recorded (stats, Legacy Points).
test('Play starts the block city (Map 1) zombie waves', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.difficulty = 'hard'
    g.settings.selectedGameMode = 'bossHunt'
    g.settings.mutators.glassHouse = true
    g.metaProgress.purchased.add('vitality')
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    const before = { runs: g.careerStats.totalRuns, legacy: g.metaProgress.legacyPoints }
    const out = {
      slot: g.buildMode.activeSlot,
      shown: ['upgrades-btn', 'quests-btn', 'server-btn'].every((id) => getComputedStyle(document.getElementById(id)).display !== 'none'),
      maps: [...document.querySelectorAll('#map-select-grid [data-map]')].map((b) => b.dataset.map).join(),
      // 100, + Vitality's 50.
      maxHealth: s.maxHealth,
      mode: s.cfg.mode,
      bossEvery: s.cfg.bossEvery,
      // Glass House doubles damage both ways.
      glass: s.cfg.damageMult === 2 && s.cfg.zombieDamageMult === 2 * 1.4,
    }
    s.kills = 10
    s.wave = 3
    s.health = 0
    s._die()
    out.runs = g.careerStats.totalRuns - before.runs
    // (10 kills x 10 + 2 waves x 50) x 0.2
    out.legacy = g.metaProgress.legacyPoints - before.legacy
    return out
  })
  expect(r).toEqual({ slot: 'map3', shown: true, maps: 'map3', maxHealth: 150, mode: 'bossHunt', bossEvery: 3, glass: true, runs: 1, legacy: 40 })
})

// A homepage run opens the weapon picker first (2026-10-09, "make the
// weapons choosable, pickable at the start when joining a game"): nothing
// spawns until a gun is picked, and the gun's own stats take over.
test('a Map 1 run starts with the weapon picker and uses the picked gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  // A returning player (a first game skips the picker, PlayOnboarding).
  await page.evaluate(() => { window.__game.careerStats.totalRuns = 1; window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    const pick = document.getElementById('play-weapon-pick')
    const out = {
      pickerShown: getComputedStyle(pick).display !== 'none',
      // Coming Soon guns (COMING_SOON_WEAPONS) are shown but can't be picked.
      cards: pick.querySelectorAll('[data-play-weapon]').length,
      soon: pick.querySelectorAll('.pwp-soon[disabled]').length,
      waitsForPick: s._picking === true,
    }
    // Nothing spawns while the picker is open.
    s.update(0.5)
    out.spawnedWhilePicking = s.zombies.length + s._toSpawn
    s._pickWeapon('minigun')
    out.soonRefused = s._picking === true
    pick.querySelector('[data-play-weapon="shotgun"]').click()
    out.pickerHidden = getComputedStyle(pick).display === 'none'
    out.weapon = s.weaponId
    out.ammo = [s.mag, s.reserve]
    out.gun = g.buildMode.tryMode._gunId
    out.saved = g.settings.playWeapon
    // Its fire rate: a second shot straight after the first is refused.
    out.shots = [s.tryFire(), s.tryFire()]
    // A zombie three blocks straight ahead takes the pellets.
    const B = s.B
    const cam = g.buildMode.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    dir.y = 0
    dir.normalize()
    const fake = { x: cam.position.x / B + dir.x * 3, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * 3, size: 1, health: 100000, vx: 0, vz: 0 }
    s.zombies.push(fake)
    g.buildMode._pitch = 0
    s._nextShotAt = 0
    s.shoot()
    out.damaged = fake.health < 100000
    s.zombies = s.zombies.filter((z) => z !== fake)
    return out
  })
  expect(r).toEqual({ pickerShown: true, cards: 10, soon: 5, waitsForPick: true, spawnedWhilePicking: 0, soonRefused: true, pickerHidden: true, weapon: 'shotgun', ammo: [8, 24], gun: 'shotgun', saved: 'shotgun', shots: [true, false], damaged: true })
})

test('View Distance hides far chunks and zombies are drawn in one batch', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__game.settings.viewDistance = 'short'
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  // A homepage run opens the weapon picker first.
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  // The zombie skin loads a moment after Play starts.
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    bm.render()
    const chunks = [...bm._chunks.chunks.values()]
    const short = chunks.filter((c) => c.shown).length
    const fogFar = bm.scene.fog.far
    g.settings.viewDistance = 'max'
    bm.render()
    const max = chunks.filter((c) => c.shown).length
    // A few zombies: their bodies are instanced, not one mesh each.
    s._toSpawn = 3
    for (let i = 0; i < 300 && s.zombies.filter((z) => z.parts).length < 3; i++) { s._toSpawn = Math.max(s._toSpawn, 1); s._spawnTimer = 0; bm.update(1 / 30) }
    bm.render()
    const batch = s._zBatch
    return {
      short,
      max,
      fogFar,
      // Only plain zombies share the batch: monsters, skeletons and Golden /
      // Diamond ones draw their own bodies, and which kinds turn up is random.
      plain: s.zombies.filter((z) => z.parts).length,
      batched: !!batch && batch.meshes.every((m) => m.count === s.zombies.filter((z) => z.parts).length),
      ownMeshesHidden: s.zombies.filter((z) => z.parts).every((z) => z.parts.every((p) => !p.visible)),
    }
  })
  expect(r.short).toBeGreaterThan(0)
  expect(r.short).toBeLessThan(r.max)
  expect(r.fogFar).toBeLessThan(100)
  expect(r.plain).toBeGreaterThanOrEqual(3)
  expect(r.batched).toBe(true)
  expect(r.ownMeshesHidden).toBe(true)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('Map 1 shows touch controls that move, look and use the buttons', async ({ page }) => {
    await gotoAndWaitForGame(page)
    await page.evaluate(() => window.__game.playBtn.click())
    await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
    await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
    await page.waitForFunction(() => getComputedStyle(document.getElementById('touch-play') || document.body).display === 'block', null, { timeout: 30000 })
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const center = (sel) => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, sel)
    // Look: drag on the right half.
    const yaw0 = await page.evaluate(() => window.__game.buildMode._yaw)
    await touch('touchStart', [{ x: 500, y: 200, id: 1 }])
    await touch('touchMove', [{ x: 560, y: 200, id: 1 }])
    await touch('touchEnd', [])
    // Move: the stick on the left half, pushed forward.
    await touch('touchStart', [{ x: 150, y: 250, id: 2 }])
    await touch('touchMove', [{ x: 150, y: 220, id: 2 }])
    const stick = await page.evaluate(() => window.__game.buildMode._touchMove)
    await touch('touchEnd', [])
    // Reload and Pause buttons.
    const reload = await center('.tp-reload')
    await page.evaluate(() => { window.__game.buildMode.survival.mag = 5 })
    await touch('touchStart', [{ x: reload.x, y: reload.y, id: 3 }])
    await touch('touchEnd', [])
    const reloading = await page.evaluate(() => window.__game.buildMode.survival._reloadLeft > 0)
    const pause = await center('.tp-pause')
    await touch('touchStart', [{ x: pause.x, y: pause.y, id: 4 }])
    await touch('touchEnd', [])
    const r = await page.evaluate(() => ({
      yaw: window.__game.buildMode._yaw,
      paused: window.__game.buildMode.menuOpen,
      hidden: getComputedStyle(document.getElementById('touch-play')).display === 'none',
      noWords: [...document.querySelectorAll('#touch-play .tp-btn')].every((b) => b.textContent.trim() === '' && b.querySelector('svg')),
    }))
    expect(r.yaw).not.toBe(yaw0)
    expect(stick?.y).toBeGreaterThan(0)
    expect(reloading).toBe(true)
    expect(r.paused).toBe(true)
    expect(r.hidden).toBe(true)
    expect(r.noWords).toBe(true)
  })
})

test('Helicopter Escape: find the fuel cans, the helicopter flies in, hold the ring and it takes off with you', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    document.getElementById('game-mode-zombie-extraction').click()
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    s._pickWeapon('rifle')
    const out = { mode: s.cfg.mode, label: document.getElementById('game-mode-zombie-extraction').textContent.trim() }
    const p = s.bm.tryMode.pos
    s._rebuildFlow([s._playerCell(p)])
    // Wave 1 on: the cans go out, spread apart, none in the camp.
    s.wave = 1
    s._toSpawn = 0
    s._updateWorld(0.01)
    const f = s.fuel
    out.cans = f.cans.length
    out.hud = document.getElementById('build-play-wave-text').textContent
    out.noHeliYet = !s._extract
    out.inCamp = f.cans.some((c) => s.camp?.inside(c.x, c.z))
    // Walk into each can.
    for (const c of [...f.cans]) {
      p.set(c.x, c.y, c.z)
      f.update(0.01)
    }
    out.got = f.got
    const ex = s._extract
    out.called = !!ex
    // Flying in: the ring doesn't count until it has landed.
    out.startHigh = ex.heli.position.y / s.B
    p.set(ex.x, ex.y, ex.z)
    s._updateExtraction(2)
    out.holdWhileFlying = ex.hold
    out.lower = ex.heli.position.y / s.B < out.startHigh
    s._updateExtraction(5)
    out.landed = ex.landed
    // Away from it: no count. On the ring: counts, stepping off resets it.
    p.set(ex.x + 10, ex.y, ex.z)
    s._updateExtraction(1)
    out.awayHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    s._updateExtraction(4)
    out.onHold = ex.hold
    p.set(ex.x + 10, ex.y, ex.z)
    s._updateExtraction(0.1)
    out.resetHold = ex.hold
    p.set(ex.x, ex.y, ex.z)
    for (let i = 0; i < 11 && ex.takeoff == null; i++) s._updateExtraction(1)
    // Aboard: you ride it up and nothing can hurt you.
    out.aboard = ex.takeoff != null && !s.dead
    s._updateExtraction(2)
    out.riding = !!s._ride && s._ride.y > ex.y + 3
    const hp = s.health
    s._hurtPlayer(50)
    out.safe = s.health === hp
    const runs0 = g.careerStats.totalRuns
    for (let i = 0; i < 5 && !s.dead; i++) s._updateExtraction(1)
    out.won = s._won && s.dead
    out.title = document.getElementById('build-play-over-title').textContent
    out.counted = g.careerStats.totalRuns === runs0 + 1
    return out
  })
  expect(r.mode).toBe('zombieExtraction')
  expect(r.label).toContain('Helicopter Escape')
  expect(r.cans).toBe(3)
  expect(r.hud).toContain('Fuel 0/3')
  expect(r.noHeliYet).toBe(true)
  expect(r.inCamp).toBe(false)
  expect(r.got).toBe(3)
  expect(r.called).toBe(true)
  expect(r.startHigh).toBeGreaterThan(30)
  expect(r.holdWhileFlying).toBe(0)
  expect(r.lower).toBe(true)
  expect(r.landed).toBe(true)
  expect(r.awayHold).toBe(0)
  expect(r.onHold).toBe(4)
  expect(r.resetHold).toBe(0)
  expect(r.aboard).toBe(true)
  expect(r.riding).toBe(true)
  expect(r.safe).toBe(true)
  expect(r.won).toBe(true)
  expect(r.title).toBe('You got out!')
  expect(r.counted).toBe(true)
})

test('right-click aims down the sights and the Inspect key turns the gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    s._pickWeapon('rifle')
    const tm = bm.tryMode
    const frames = (n) => { for (let i = 0; i < n; i++) tm.update(0.05, bm._keys) }
    frames(10)
    const out = { fov0: bm.camera.fov, gunX0: tm._gun.position.x }
    tm.setAim(true)
    frames(20)
    out.aim = tm.aimAmount
    out.fovAim = bm.camera.fov
    out.gunXAim = tm._gun.position.x
    // Right-click no longer uses things in Try Map; E still does.
    let used = 0
    const orig = bm._tryUseFromCamera
    bm._tryUseFromCamera = () => { used++ }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
    bm._tryUseFromCamera = orig
    out.used = used
    tm.setAim(false)
    frames(20)
    out.aimBack = tm.aimAmount
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', bubbles: true }))
    frames(8)
    out.inspectTurn = tm._gun.rotation.y
    frames(60)
    out.inspectDone = tm._gun.rotation.y
    return out
  })
  expect(r.aim).toBeGreaterThan(0.95)
  expect(r.fovAim).toBeLessThan(r.fov0 - 15)
  expect(Math.abs(r.gunXAim)).toBeLessThan(0.03)
  expect(r.gunX0).toBeGreaterThan(0.2)
  expect(r.used).toBe(1)
  expect(r.aimBack).toBeLessThan(0.05)
  expect(r.inspectTurn).toBeGreaterThan(0.6)
  expect(Math.abs(r.inspectDone)).toBeLessThan(0.01)
})

// Settings > Controls only lists what Map 1 uses, and changing a key there
// really changes it in the game (Try Map used to read W/A/S/D directly).
test('Settings > Controls keys drive walking in Map 1', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const result = await page.evaluate(async () => {
    const g = window.__game
    g._renderControlsGrid()
    const ids = [...g.controlsGrid.querySelectorAll('.control-key-btn')].map((b) => b.dataset.action)
    const rebind = (action, code) => {
      g.controlsGrid.querySelector(`[data-action="${action}"]`).click()
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    }
    rebind('moveForward', 'KeyH')
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.toggleTryMode()
    const speedWith = (code) => {
      bm._keys.clear()
      bm.tryMode.vel.set(0, 0, 0)
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
      for (let i = 0; i < 20; i++) bm.tryMode.update(0.05, bm._keys)
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
      return Math.hypot(bm.tryMode.vel.x, bm.tryMode.vel.z)
    }
    const withW = speedWith('KeyW')
    const withI = speedWith('KeyH')
    const withArrow = speedWith('ArrowUp')
    bm.toggleTryMode()
    g._exitBuildMode()
    rebind('moveForward', 'KeyW')
    return { ids, withW, withI, withArrow }
  })
  expect(result.ids).toEqual(['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch', 'reload', 'use', 'inspectWeapon', 'cycleMap', 'cameraView', 'dropItem', 'emote', 'shop', 'spray', 'bingo', 'ringBag', 'autoRun', 'hideHud', 'saveClip'])
  // W no longer walks (a tiny slide on uneven ground is fine; walking is ~4).
  expect(result.withW).toBeLessThan(0.5)
  expect(result.withI).toBeGreaterThan(2)
  expect(result.withArrow).toBeGreaterThan(2)
})

// Windows crack and break in more than one way (2026-10-12): five crack
// pictures, four ways of shattering, several shard shapes.
test('windows crack and shatter in different ways', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const tm = bm.tryMode
    // Every crack picture is its own.
    const pics = new Set()
    for (let look = 0; look < 5; look++) {
      const img = tm._crackTexture(look).image
      pics.add(img.getContext('2d').getImageData(0, 0, 16, 16).data.join(','))
    }
    // Cracked windows with different looks are all drawn.
    for (let i = 0; i < 5; i++) {
      bm.placeBlock(i, 1, 4, 'glass')
      tm._cracked.set(bm._key(i, 1, 4), { x: i, y: 1, z: 4, look: i })
    }
    tm._rebuildCracks()
    const crackMeshes = tm._crackMeshes.length
    // Each way of shattering, by its shard count and sizes.
    const looks = new Map()
    for (let k = 0; k < 4; k++) {
      tm._clearShards()
      tm._spawnShards(0, 1, 4, 'glass', k)
      looks.set(tm._lastBreakLook, { n: tm._shards.length, shapes: new Set(tm._shards.map((s) => s.mesh.geometry.uuid)).size })
    }
    tm.forgetWindows()
    g._exitBuildMode()
    return { pics: pics.size, crackMeshes, looks: [...looks.entries()] }
  })
  expect(r.pics).toBe(5)
  expect(r.crackMeshes).toBe(5)
  expect(r.looks.map(([name]) => name).sort()).toEqual(['blast', 'burst', 'chunks', 'collapse'])
  expect(new Set(r.looks.map(([, v]) => v.n)).size).toBeGreaterThan(2)
  expect(r.looks.every(([, v]) => v.shapes >= 2)).toBe(true)
})

// Water you can get out of (2026-10-12): Space + walking into a ledge one
// block above the water springs you out; a body killed in the air drops to
// the ground.
test('you can climb out of water onto a ledge, and bodies drop to the ground', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const b = g.buildMode
    // A pool high in the air: stone floor, one block of water, a ledge two blocks high.
    for (let x = 36; x <= 46; x++) for (let z = 36; z <= 44; z++) b.placeBlock(x, 29, z, 'stone')
    for (let x = 36; x <= 41; x++) for (let z = 36; z <= 44; z++) b.placeBlock(x, 30, z, 'water')
    for (let x = 42; x <= 46; x++) for (let z = 36; z <= 44; z++) { b.placeBlock(x, 30, z, 'stone'); b.placeBlock(x, 31, z, 'stone') }
    b.liquids.update(0)
    b.toggleTryMode()
    const tm = b.tryMode
    tm.pos.set(39.5, 30, 40.5)
    tm.vel.set(0, 0, 0)
    b._yaw = -Math.PI / 2
    b._pitch = 0
    const keys = new Set(['KeyW', 'Space'])
    for (let i = 0; i < 100 && tm.pos.x < 43; i++) tm.update(1 / 60, keys)
    // Let go and land on the ledge.
    for (let i = 0; i < 60; i++) tm.update(1 / 60, new Set())
    const out = { x: tm.pos.x, y: tm.pos.y }
    b.toggleTryMode()
    // A body left in the air falls onto the stone.
    const s = b.survival
    const B = s.B
    const ground = s._groundUnder(44.5, 40, 40.5)
    const fake = { group: { rotation: { x: 0 }, position: { y: 40 * B } }, materials: [], arms: [], armFrom: [], t: 0, lift: 0, baseY: 40 * B, groundY: ground * B, vy: 0 }
    s._corpses = [fake]
    for (let i = 0; i < 120; i++) s._updateCorpses(1 / 60)
    out.ground = ground
    out.bodyY = fake.group.position.y / B
    g._exitBuildMode()
    return out
  })
  expect(r.x).toBeGreaterThan(42)
  expect(r.y).toBeGreaterThanOrEqual(31.99)
  expect(r.ground).toBe(32)
  expect(r.bodyY).toBeCloseTo(32, 1)
})

// One server connection per page: starting another game on a server leaves
// the first one, so it can't keep sending your spot under an old id (a copy
// of you following you around, 2026-10-12).
test('a new server game closes the old connection', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const left = []
    g.__serversBackendForTests = {
      sync: async () => ({ host: 'a', isHost: true, wave: 1, players: {}, skins: {}, zombies: {}, hurt: [], credits: [], hits: [] }),
      leave: async (auth) => { left.push(auth.playerId); return {} },
    }
    await g._enterBuildMode({ map: 'map3', play: true, server: { serverId: 'S1', playerId: 'a', token: 't', host: 'a', name: 'x' } })
    const first = g.buildMode.survival.net
    g._exitBuildMode()
    await g._enterBuildMode({ map: 'map3', play: true, server: { serverId: 'S1', playerId: 'b', token: 't', host: 'b', name: 'x' } })
    const second = g.buildMode.survival.net
    // Even a stray second connection made while one is open closes it.
    const Net = second.constructor
    const third = new Net(g, { serverId: 'S1', playerId: 'c', token: 't', host: 'c', name: 'x' })
    const out = { firstClosed: first.closed, secondClosed: second.closed, thirdOpen: !third.closed, left: left.join() }
    third.leave()
    g._exitBuildMode()
    return out
  })
  expect(r.firstClosed).toBe(true)
  expect(r.secondClosed).toBe(true)
  expect(r.thirdOpen).toBe(true)
  expect(r.left).toBe('a,b')
})

// The camera key (P) cycles first person -> third person behind -> in
// front, like bloxd.io; the camera only steps out for the drawing.
test('the camera key switches between first and third person', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.toggleTryMode()
    const tm = b.tryMode
    for (let i = 0; i < 40 && !tm._armSkin; i++) await new Promise((res) => setTimeout(res, 100))
    const out = { views: [] }
    const press = (code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
    for (let i = 0; i < 3; i++) {
      press('KeyP')
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyP', bubbles: true }))
      b.update(0.016)
      const before = b.camera.position.clone()
      const restore = tm.applyView()
      const moved = b.camera.position.distanceTo(before)
      restore?.()
      out.views.push({ view: tm.view, bodyShown: !!tm._body?.group.visible, moved: moved > 0.05, back: b.camera.position.distanceTo(before) < 1e-6 })
    }
    // No aiming in third person.
    tm.cycleView()
    tm.setAim(true)
    out.aimInThird = tm.aiming
    b.toggleTryMode()
    g._exitBuildMode()
    return out
  })
  expect(r.views.map((v) => v.view)).toEqual([1, 2, 0])
  expect(r.views.map((v) => v.bodyShown)).toEqual([true, true, false])
  expect(r.views.map((v) => v.moved)).toEqual([true, true, false])
  expect(r.views.every((v) => v.back)).toBe(true)
  expect(r.aimInThird).toBe(false)
})

// 2026-10-17: right-click aims only while held, the zoom key zooms much
// further while playing, and holding fire on a block breaks it after its
// material's time (stone slower than wood); broken blocks come back.
test('hold right-click to aim, the zoom key zooms far, blocks break by material', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(async () => { localStorage.removeItem('gayz-play-saved-run'); await window.__game._enterBuildMode({ map: 'map3', play: true }) })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const tm = bm.tryMode
    const s = bm.survival
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    s._toSpawn = 0
    s._breakTimer = 999
    const out = {}
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => bm.renderer.domElement })
    bm.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
    out.held = tm.aiming
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2, bubbles: true }))
    out.released = tm.aiming
    delete document.pointerLockElement
    bm._keys.add('KeyV')
    for (let i = 0; i < 40; i++) tm.update(0.05, bm._keys)
    out.zoomFov = bm.camera.fov
    bm._keys.delete('KeyV')
    for (let i = 0; i < 40; i++) tm.update(0.05, bm._keys)
    out.backFov = bm.camera.fov
    out.times = Object.fromEntries(['oakplanks', 'stone', 'dirt', 'leaves', 'obsidian', 'oakslab', 'lootchest', 'water'].map((id) => [id, bm.breakSeconds(id)]))
    // Dig a plank and a stone block placed right in front of the eye.
    const B = tm.B
    const px = Math.floor(tm.pos.x)
    const py = Math.floor(tm.pos.y) + 2
    const pz = Math.floor(tm.pos.z)
    const dig = (type) => {
      bm.removeBlock(px, py, pz - 2)
      bm.placeBlock(px, py, pz - 2, type)
      bm.camera.rotation.set(0, 0, 0)
      bm._fireHeld = true
      let t = 0
      while (bm.getBlockAt(px, py, pz - 2) === type && t < 20) {
        bm.camera.position.set((px + 0.5) * B, (py + 0.5) * B, (pz + 0.5) * B)
        bm.camera.updateMatrixWorld()
        tm._updateDigging(0.05)
        t += 0.05
      }
      bm._fireHeld = false
      tm._updateDigging(0.05)
      return t
    }
    out.plank = dig('oakplanks')
    out.stone = dig('stone')
    out.brokenSaved = bm._snapshot().blocks.some((b) => b.x === px && b.y === py && b.z === pz - 2)
    bm.toggleTryMode()
    out.back = bm.getBlockAt(px, py, pz - 2)
    return out
  })
  expect(r.held).toBe(true)
  expect(r.released).toBe(false)
  expect(r.zoomFov).toBeLessThan(15)
  expect(r.backFov).toBeGreaterThan(60)
  expect(r.times.stone).toBeGreaterThan(r.times.oakplanks)
  expect(r.times.oakplanks).toBeGreaterThan(r.times.dirt)
  expect(r.times.dirt).toBeGreaterThan(r.times.leaves)
  expect(r.times.obsidian).toBeGreaterThan(r.times.stone)
  expect(r.times.oakslab).toBe(r.times.oakplanks)
  expect(r.times.lootchest).toBe(Infinity)
  expect(r.times.water).toBe(Infinity)
  expect(Math.abs(r.plank - r.times.oakplanks)).toBeLessThan(0.11)
  expect(Math.abs(r.stone - r.times.stone)).toBeLessThan(0.11)
  expect(r.brokenSaved).toBe(true)
  expect(r.back).toBe('stone')
})

// 2026-10-17: Escape while playing a game from the homepage opens the
// game's own pause menu (never the Map Editor's); Back to Game carries on
// (2026-10-26); Save Progress keeps the game and the next Play carries on
// from it; Leave Game ends it (counted) and drops the save.
test("Escape while playing opens the game's pause menu; saved games carry on", async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { localStorage.removeItem('gayz-play-saved-run'); window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const a = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    s._pickWeapon('shotgun')
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true }))
    const out = { stillPlaying: s.active && bm.tryMode.active }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.paused = bm.menuOpen
    out.game = getComputedStyle(document.getElementById('play-pause-menu')).display
    out.editor = getComputedStyle(document.getElementById('build-menu')).display
    document.getElementById('play-pause-settings-btn').click()
    out.settings = g.settingsOpen && document.getElementById('play-pause-menu').style.display === 'none'
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.backFromSettings = !g.settingsOpen && document.getElementById('play-pause-menu').style.display === 'flex'
    s.wave = 4
    s.kills = 23
    s.coins = 77
    s.upgrades = { damage: 2 }
    out.runs0 = g.careerStats.totalRuns
    document.getElementById('play-pause-save-btn').click()
    out.saveText = document.getElementById('play-pause-status').textContent
    // Back to Game just closes the pause screen and carries on.
    document.getElementById('play-pause-back-btn').click()
    out.backToGame = !bm.menuOpen && bm.active && s.active && getComputedStyle(document.getElementById('play-pause-menu')).display === 'none'
    // A saved game is still there next time (as after closing the tab).
    bm.closeMenuQuietly()
    s.stop({ suspend: true })
    g._exitBuildMode()
    await new Promise((res) => setTimeout(res, 300))
    out.home = !bm.active
    out.counted = g.careerStats.totalRuns - out.runs0
    out.saved = !!localStorage.getItem('gayz-play-saved-run')
    return out
  })
  expect(a.stillPlaying).toBe(true)
  expect(a.paused).toBe(true)
  expect(a.game).toBe('flex')
  expect(a.editor).toBe('none')
  expect(a.settings).toBe(true)
  expect(a.backFromSettings).toBe(true)
  expect(a.saveText.length).toBeGreaterThan(0)
  expect(a.backToGame).toBe(true)
  expect(a.home).toBe(true)
  expect(a.counted).toBe(0)
  expect(a.saved).toBe(true)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const b = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const out = { wave: s.wave, kills: s.kills, coins: s.coins, damage: s.upgrades.damage, weapon: s.weaponId, picking: !!s._picking }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    const runs0 = g.careerStats.totalRuns
    document.getElementById('play-pause-leave-btn').click()
    await new Promise((res) => setTimeout(res, 300))
    out.home = !g.buildMode.active
    out.counted = g.careerStats.totalRuns - runs0
    out.saved = !!localStorage.getItem('gayz-play-saved-run')
    return out
  })
  expect(b).toEqual({ wave: 3, kills: 23, coins: 77, damage: 2, weapon: 'shotgun', picking: false, home: true, counted: 1, saved: false })
})

// The gun's kick is a spring (BuildTryMode._kick/_updateKick): it eases back
// over a few frames and glides home instead of snapping, and a shot leaves
// a muzzle flash and smoke (GunFx.js). Zombies get brains
// (BuildSurvival._zombieBrain): rushers, flankers that curve out to a side
// (alternating sides), lungers that sprint when close.
test('smooth gun kick with flash and smoke; zombies get brains', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    if (document.getElementById('play-weapon-pick')?.style.display !== 'none') s._pickWeapon('rifle')
    const out = {}
    tm._recoil = 0
    tm._kickVel = 0
    s._nextShotAt = 0
    tm.fire()
    const curve = []
    for (let i = 0; i < 30; i++) {
      tm._updateKick(1 / 60)
      curve.push(tm._recoil)
    }
    const peak = curve.indexOf(Math.max(...curve))
    out.eases = curve[0] < curve[peak] && peak >= 2
    out.home = Math.abs(curve[29]) < 0.05
    out.muzzle = !!tm._muzzle && !!tm._fx && tm._fx.flash.visible
    tm._fx.update(0.1)
    out.smoke = tm._fx._smoke.some((p) => p.visible)
    tm._fx.update(1)
    out.smokeGone = tm._fx._smoke.every((p) => !p.visible) && !tm._fx.flash.visible
    // Brains: every zombie gets a role, sides alternate, far flankers curve.
    const player = { x: 12, y: 0, z: 0 }
    const zombies = Array.from({ length: 30 }, () => ({ x: 0, y: 0, z: 0 }))
    for (const zb of zombies) s._zombieBrain(zb, 0.5, player)
    const roles = new Set(zombies.map((z) => z.role))
    out.roles = ['rusher', 'flanker', 'lunger'].filter((k) => roles.has(k)).length >= 2
    out.sides = new Set(zombies.map((z) => z.side)).size === 2
    out.flankersCurve = zombies.filter((z) => z.role === 'flanker').every((z) => z.flank > 0) && roles.has('flanker')
    out.rushersStraight = zombies.filter((z) => z.role === 'rusher').every((z) => z.flank === 0)
    return out
  })
  expect(r).toEqual({ eases: true, home: true, muzzle: true, smoke: true, smokeGone: true, roles: true, sides: true, flankersCurve: true, rushersStraight: true })
})

// 2026-10-17: the pause menu's Switch Weapon (each gun keeps its own ammo)
// and the special guns' powers - Crossbow/AWP go through zombies, the
// Tomahawk hits several, the Flamethrower sets them burning (and burning
// hurts), the Void Ripper slows them, and launchers explode with a
// fireball.
test('Switch Weapon in the pause menu and the special guns\' powers', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    s.mag = 7
    bm.toggleMenu()
    document.getElementById('play-pause-weapon-btn').click()
    const pick = document.getElementById('play-weapon-pick')
    out.picker = [getComputedStyle(pick).display !== 'none', bm.menuOpen, s._picking]
    s._pickWeapon('flamethrower')
    out.flame = [s.weaponId, s.mag, bm.tryMode._gunId]
    bm.toggleMenu()
    document.getElementById('play-pause-weapon-btn').click()
    s._pickWeapon('rifle')
    out.rifleKept = s.mag
    // Fake zombies in a line straight ahead.
    const B = s.B
    const cam = bm.camera
    bm._pitch = 0
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    dir.y = 0
    dir.normalize()
    const mk = (dist, side = 0) => ({ x: cam.position.x / B + dir.x * dist - dir.z * side, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * dist + dir.x * side, size: 1, health: 100000, vx: 0, vz: 0 })
    const shot = (weapon, fakes) => {
      s.weaponId = weapon
      s.mag = s.magSize()
      s._nextShotAt = 0
      const real = s.zombies
      s.zombies = fakes
      cam.updateMatrixWorld()
      s.shoot()
      s.zombies = real
      return fakes.map((f) => (f.health < 100000 ? 1 : 0)).join('')
    }
    out.rifle = shot('rifle', [mk(3), mk(4), mk(5)])
    out.crossbow = shot('crossbow', [mk(3), mk(4), mk(5), mk(6)])
    out.awp = shot('awp', [mk(3), mk(4), mk(5), mk(6), mk(7)])
    out.tomahawk = shot('tomahawk', [mk(1.5), mk(1.8, 0.6), mk(2, -0.6), mk(2.2, 0.3)])
    const burning = mk(3)
    shot('flamethrower', [burning])
    out.burn = burning.burn
    const slowed = mk(3)
    shot('voidripper', [slowed])
    out.slow = slowed.slow
    const fx = () => s._fx._sprites.filter((p) => p.userData.t < p.userData.life).length
    s._fx.clear()
    shot('launcher', [mk(5)])
    out.fireball = fx() > 0
    s.weaponId = 'rifle'
    s.mag = s.magSize()
    return out
  })
  expect(r).toEqual({
    picker: [true, false, true], flame: ['flamethrower', 100, 'flamethrower'], rifleKept: 7,
    rifle: '100', crossbow: '1110', awp: '11110', tomahawk: '1110', burn: 3, slow: 2, fireball: true,
  })
})

// 2026-10-17 (second batch): Spectate from the pause screen freezes the
// game and gives back the camera; the Flamethrower shows fuel and sets
// wood on fire, which spreads and burns away (and comes back after the
// game); games run the day-night cycle with sun, moon and clouds.
test('Spectate, fuel, burning wood and the day-night sky', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('flamethrower'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    out.sky = [bm.sky.time, bm.sky.weather, bm.sky.bodies.clouds.visible]
    out.fuel = !!document.querySelector('#build-play-ammo .fuel-bar')
    // Spectate: frozen, camera free, Escape (toggleMenu) comes back.
    const before = bm.camera.position.clone()
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    out.spectating = [bm.spectate.active, s.spectating, bm.menuOpen]
    // The game keeps going while spectating and nothing can hurt you.
    const hp = s.health
    s._hurtPlayer(50)
    out.noHurt = s.health === hp
    bm._keys.add('KeyW')
    for (let i = 0; i < 20; i++) bm.update(1 / 30)
    bm._keys.delete('KeyW')
    out.flew = bm.camera.position.distanceTo(before) > 1
    bm.toggleMenu()
    out.back = [bm.spectate.active, s.spectating, bm.menuOpen, bm.camera.position.distanceTo(before) < 0.01]
    bm.toggleMenu()
    // Burning wood: a plank wall next to a plank, set alight, burns away.
    const p = bm.tryMode.pos
    const x = Math.floor(p.x) + 3
    const y = Math.floor(p.y) + 5
    const z = Math.floor(p.z)
    bm.placeBlock(x, y, z, 'oakplanks', false)
    bm.placeBlock(x + 1, y, z, 'oakplanks', false)
    bm.placeBlock(x, y + 1, z, 'stone', false)
    out.lit = s.ignite(x, y, z)
    out.stoneLit = s.ignite(x, y + 1, z)
    for (let i = 0; i < 400; i++) s._updateFires(1 / 30)
    out.burnt = bm.getBlockAt(x, y, z) === null || bm.getBlockAt(x, y, z) === undefined
    out.stoneStays = bm.getBlockAt(x, y + 1, z) === 'stone'
    out.restorable = bm.tryMode.brokenWindows().some((b) => b.x === x && b.y === y && b.z === z)
    return out
  })
  expect(r).toEqual({
    sky: ['cycle', 'random', true], fuel: true, spectating: [true, true, false], noHurt: true, flew: true,
    back: [false, false, true, true], lit: true, stoneLit: false, burnt: true, stoneStays: true, restorable: true,
  })
})

// 2026-10-18: spectating, zombies go for where you left (not the camera),
// game keys still work, the camera stops on a bedrock floor at the bottom;
// the Knife thrown while aiming flies and hits; the inventory shows one
// picture while dragging and only the chosen hotbar slot has a dark box.
test('Spectate keeps zombies off the camera, bedrock floor, thrown knife, inventory drag', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { window.__game.careerStats.totalRuns = 1; window.__game.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const B = s.B
    const out = {}
    const start = bm.tryMode.pos.clone()
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    bm._keys.add('KeyW')
    bm._keys.add('Space')
    for (let i = 0; i < 30; i++) bm.update(1 / 30)
    bm._keys.clear()
    const me = s._targets()[0]
    out.targetStays = Math.hypot(me.x - start.x, me.y - start.y, me.z - start.z) < 0.01
    out.cameraMoved = bm.tryMode.pos.distanceTo(start) > 3
    // Reload works while flying.
    s.mag = 1
    bm._onKeyDown({ code: 'KeyR', repeat: false, target: document.body, preventDefault() {} })
    out.reloading = s._reloadLeft > 0
    s._reloadLeft = 0
    // Down to the bottom: stops on the bedrock floor.
    bm.camera.position.y = -800 * B
    bm.update(1 / 30)
    const floor = bm.scene.getObjectByName('spectate-bedrock-floor')
    out.floor = [!!floor?.visible, bm.camera.position.y / B > -500, bm.camera.position.y / B < -499]
    bm.toggleMenu()
    out.floorHidden = !floor.visible
    bm.toggleMenu()
    // Thrown knife: aim, click, it flies and hits a zombie ahead.
    s.weaponId = 'melee'
    s._nextShotAt = 0
    bm._pitch = 0
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const fake = { x: cam.position.x / B + dir.x * 4, y: cam.position.y / B - 1.4, z: cam.position.z / B + dir.z * 4, size: 1, health: 1000 }
    const real = s.zombies
    const realDamage = s.damageZombie
    s.zombies = [fake]
    s.damageZombie = (z, a) => { z.health -= a }
    bm.tryMode.aiming = true
    bm.tryMode.fire()
    out.thrown = s.throws.list.length
    out.handEmpty = bm.tryMode._gun ? !bm.tryMode._gun.visible : true
    for (let i = 0; i < 30; i++) s.throws.update(1 / 60)
    out.hit = fake.health < 1000
    s.zombies = real
    s.damageZombie = realDamage
    bm.tryMode.aiming = false
    // Inventory: drag hides the picture in the slot it left.
    s.inv.hotbar[0] = { kind: 'gun', id: 'rifle', n: 1 }
    s.inv.select(1)
    bm.togglePicker()
    const slot = document.querySelector('#play-inventory .inv-hotbar .inv-slot[data-i="0"]')
    const rect = slot.getBoundingClientRect()
    slot.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5 }))
    out.oneImage = [document.querySelectorAll('.inv-ghost').length, getComputedStyle(slot.querySelector('img')).visibility]
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 0 }))
    const head = document.querySelector('#play-inventory .inv-head b').getBoundingClientRect()
    const box = document.querySelector('#play-inventory .inv-box').getBoundingClientRect()
    out.titleCentered = Math.abs(head.x + head.width / 2 - (box.x + box.width / 2)) < 4
    bm.togglePicker()
    const slots = [...document.querySelectorAll('#build-hotbar .build-hotbar-slot')]
    out.hotbarBoxes = slots.map((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' ? 1 : 0).join('')
    out.barBg = getComputedStyle(document.getElementById('build-hotbar')).backgroundColor
    return out
  })
  expect(r).toEqual({
    targetStays: true, cameraMoved: true, reloading: true, floor: [true, true, true], floorHidden: true,
    thrown: 1, handEmpty: true, hit: true, oneImage: [1, 'hidden'], titleCentered: true,
    hotbarBoxes: '0000000000', barBg: 'rgba(0, 0, 0, 0)',
  })
})

// 2026-10-31: the go-kart - parked near you, Use hops in, the keys drive
// it, it runs zombies over, Use hops out beside it.
test('go-kart: hop in, drive, run zombies over, hop out', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    const k = s.kart
    const out = { parked: !!k.group }
    // Too far: Use does nothing. Next to it: in.
    bm.tryMode.pos.set(k.x + 10, k.y, k.z)
    out.farUse = k.use()
    bm.tryMode.pos.set(k.x + 1, k.y, k.z)
    out.inUse = bm._tryUseFromCamera() && k.driving
    // Face +z and hold forward: it speeds up and moves.
    k.heading = 0
    const z0 = k.z
    for (let i = 0; i < 40; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.moved = k.z - z0 > 5
    out.fast = k.speed > 10
    out.meWithKart = Math.abs(bm.tryMode.pos.z - k.z) < 0.01
    // A zombie straight ahead gets run over.
    const zb = s._makeZombie(990, k.x, k.y, k.z + 3, 10000, false, null)
    zb.speedMult = 0
    for (let i = 0; i < 10; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.rammed = zb.health < 10000
    // Steering turns it.
    const h0 = k.heading
    for (let i = 0; i < 10; i++) bm.tryMode.update(0.05, new Set(['KeyW', 'KeyA']))
    out.turned = k.heading > h0 + 0.3
    // Out: standing beside it, not driving.
    out.outUse = k.use() && !k.driving
    out.beside = Math.hypot(bm.tryMode.pos.x - k.x, bm.tryMode.pos.z - k.z) > 1
    s.stop()
    out.gone = !k.group
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ parked: true, farUse: false, inUse: true, moved: true, fast: true, meWithKart: true, rammed: true, turned: true, outUse: true, beside: true, gone: true })
})

// 2026-10-31: right-clicking the kart hops in, it drives up a 1-block
// step, Settings > Auto Jump hops you up one, and walking eases in and the
// view glides up a step.
test('go-kart right-click and steps; auto jump; smoother walking', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const B = bm._chunks.blockSize
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    const k = s.kart
    const tm = bm.tryMode
    const out = {}
    const look = (x, y, z) => {
      const d = { x: x - bm.camera.position.x / B, y: y - bm.camera.position.y / B, z: z - bm.camera.position.z / B }
      bm._yaw = Math.atan2(-d.x, -d.z)
      bm._pitch = Math.atan2(d.y, Math.hypot(d.x, d.z))
      bm._applyCameraRotation?.()
      bm.camera.rotation.set(bm._pitch, bm._yaw, 0, 'YXZ')
      bm.camera.updateMatrixWorld()
    }
    // Right-click while looking away: nothing. Looking at it: in.
    tm.pos.set(k.x + 2, k.y, k.z)
    tm.update(0.016, new Set())
    look(k.x + 10, k.y + 1, k.z)
    out.awayClick = k.rightClick()
    look(k.x, k.y + 0.4, k.z)
    out.lookClick = k.rightClick() && k.driving
    // A one-block step across its way: it drives up onto it.
    const y0 = k.y
    const fx = Math.floor(k.x)
    const fz = Math.floor(k.z)
    for (let x = fx - 4; x <= fx + 4; x++) for (let z = fz + 4; z <= fz + 12; z++) bm.placeBlock(x, Math.round(y0), z, 'grass', true)
    k.heading = 0
    k.x = fx + 0.5
    let top = y0
    for (let i = 0; i < 60; i++) {
      tm.update(0.05, new Set(['KeyW']))
      top = Math.max(top, k.y)
    }
    out.kartClimbed = Math.round(top - y0)
    k.use()
    // Walking speeds up over a moment instead of at once.
    s.kart.dispose()
    tm.pos.set(20.5, 1.01, -20.5)
    tm.vel.set(0, 0, 0)
    bm._yaw = Math.PI // facing +z
    for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
    tm.update(0.016, new Set(['KeyW']))
    out.easesIn = Math.hypot(tm.vel.x, tm.vel.z) < 2
    // Auto Jump off: walking into a 1-block step stops you.
    for (let x = 18; x <= 23; x++) for (let z = -17; z <= -10; z++) bm.placeBlock(x, 1, z, 'grass', true)
    g.settings.autoJump = false
    for (let i = 0; i < 90; i++) tm.update(0.016, new Set(['KeyW']))
    out.offStuck = tm.pos.y < 1.5
    // On: it hops up.
    tm.pos.set(20.5, 1.01, -20.5)
    g.settings.autoJump = true
    let lagSeen = false
    for (let i = 0; i < 120; i++) tm.update(0.016, new Set(['KeyW']))
    out.onClimbed = tm.pos.y > 1.9
    g.settings.autoJump = false
    // A slab step up: the view lags behind, then catches up.
    tm.pos.set(30.5, 1.01, 0.5)
    for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
    bm.placeBlock(30, 1, 2, 'stonebricksslab', true)
    for (let i = 0; i < 60; i++) {
      tm.update(0.016, new Set(['KeyW']))
      if (tm._stepLag < -0.05) lagSeen = true
    }
    out.glide = lagSeen
    out.settled = Math.abs(tm._stepLag) < 0.01
    // 2026-11-01: a slow frame rate walks as far as a fast one (steady
    // steps, not slow motion), and landing dips the view.
    const walkFor = (frameDt) => {
      tm.pos.set(-20.5, 1.01, 10.5)
      tm.vel.set(0, 0, 0)
      for (let i = 0; i < 5; i++) tm.update(0.016, new Set())
      const z0 = tm.pos.z
      for (let i = 0; i < Math.round(1 / frameDt); i++) tm.update(frameDt, new Set(['KeyW']))
      return tm.pos.z - z0
    }
    const fast = walkFor(1 / 60)
    const slow = walkFor(1 / 10)
    out.sameSpeed = fast > 2 && Math.abs(slow - fast) / fast < 0.1
    tm.pos.set(-20.5, 6, 10.5)
    tm.vel.set(0, 0, 0)
    let dipSeen = false
    for (let i = 0; i < 80; i++) {
      tm.update(0.016, new Set())
      if (tm._landDip > 0.05) dipSeen = true
    }
    out.landDip = dipSeen
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ awayClick: false, lookClick: true, kartClimbed: 1, easesIn: true, offStuck: true, onClimbed: true, glide: true, settled: true, sameSpeed: true, landDip: true })
})


// 2026-10-30: real-life ammo, GayZ's own gun names, the AWP's scope, and
// no zoom when aiming without a gun.
test('gun names, real ammo, the scope and no zoom without a gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('awp'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    const out = {}
    out.names = ['rifle', 'awp', 'shotgun', 'melee'].map((id) => s.inv._label({ kind: 'gun', id }))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    const base = tm._baseFov
    const run = () => { for (let i = 0; i < 60; i++) tm.updateHands(1 / 30, new Set()) }
    // The AWP: aiming looks through the scope, zoomed four times.
    tm.setAim(true)
    run()
    const scope = document.getElementById('play-scope')
    out.scoped = !!scope?.classList.contains('on') && document.body.classList.contains('scope-on')
    out.scopeFov = Math.round(bm.camera.fov)
    out.slowLook = tm.aimLookScale() < 0.3
    tm.setAim(false)
    run()
    out.scopeOff = !scope.classList.contains('on') && Math.round(bm.camera.fov) === Math.round(base)
    // Holding a block: right-click doesn't zoom.
    const inv = s.inv
    inv.add({ kind: 'block', id: 'stone', n: 4 })
    inv.select(inv.hotbar.findIndex((it) => it?.id === 'stone'))
    tm.setAim(true)
    run()
    out.blockFov = Math.round(bm.camera.fov)
    out.blockScope = scope.classList.contains('on')
    tm.setAim(false)
    out.base = Math.round(base)
    return out
  })
  expect(r.names).toEqual(['Havoc', 'Farsight', 'Boomstick', 'Fang'])
  expect(['rifle', 'pistol', 'shotgun', 'awp', 'rocket'].map((id) => [PLAY_WEAPONS[id].mag, PLAY_WEAPONS[id].reserve])).toEqual([[30, 210], [7, 42], [8, 24], [5, 40], [1, 4]])
  expect(r.scoped).toBe(true)
  expect(r.scopeFov).toBeLessThan(r.base / 3)
  expect(r.slowLook).toBe(true)
  expect(r.scopeOff).toBe(true)
  expect(r.blockFov).toBe(r.base)
  expect(r.blockScope).toBe(false)
})

// New-player polish (2026-10-31): a first game skips the picker, starts
// outside the camp gate with a zombie close by and a fading hint; hits
// show a marker and kills pop coins; a sun-only death isn't your kill;
// You Died shows the next unlock; a game-picked graphics level steps down
// when a game stays slow.
test('first game, hit feedback, sun kills, next unlock, auto graphics', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const out = { first: s.onboard.active, picker: !!s._picking }
    const p = bm.tryMode.pos
    out.outsideCamp = !!s.camp && !s.camp.inside(p.x, p.z)
    // Run the game forward without real frames until the starter comes.
    s.health = 1e9
    for (let i = 0; i < 20 * 8 && !s.onboard.starter; i++) { bm.tryMode.update(0.05, new Set()); s.update(0.05) }
    const z = s.onboard.starter
    out.starterNear = !!z && Math.hypot(z.x - p.x, z.z - p.z) <= 17
    out.starterNoSun = !!z && z.noSun === true
    const hint = document.getElementById('play-first-hint')
    out.hint = !!hint && getComputedStyle(hint).display !== 'none' && hint.textContent.length > 0
    s.hitZombieWith(z, 1, null, true)
    out.headMark = document.getElementById('play-hitmark')?.className
    const kills = s.kills
    for (let i = 0; i < 100 && s.zombies.includes(z); i++) s.hitZombieWith(z, 40, { x: 0, y: 0, z: 1 })
    out.killMark = document.getElementById('play-hitmark')?.className
    out.killed = s.kills === kills + 1
    out.coins = document.querySelectorAll('#play-damage-numbers .play-coins').length > 0
    // Burned up in the sun with no hit: not a kill, no coins.
    const before = { kills: s.kills, coins: s.coins }
    s._spawnZombie()
    const sunny = s.zombies[s.zombies.length - 1]
    sunny.sunlit = true
    sunny.health = 0
    s.damageZombie(sunny, 0)
    out.sunKill = { gone: !s.zombies.includes(sunny), kills: s.kills - before.kills, coins: s.coins - before.coins }
    // Auto graphics: still slow with nothing left to lower.
    g.settings.autoQuality = true
    g.settings.graphicsLevel = 'balanced'
    g.settings.graphicsLevelAuto = true
    g.settings.viewDistance = 'short'
    g._editorResScale = 0.25
    g._gfxLowerHold = 0
    g._gfxSlow = 0
    let now = performance.now() + 60000
    for (let i = 0; i < 45; i++) g._updateEditorResScale(40, (now += 500))
    out.lowered = g.settings.graphicsLevel
    g.settings.graphicsLevelAuto = false
    g._gfxLowerHold = 0
    for (let i = 0; i < 45; i++) g._updateEditorResScale(40, (now += 500))
    out.pickedStays = g.settings.graphicsLevel
    // You Died: the next hat or cape.
    s.health = 1
    s._hurtPlayer(50)
    out.unlock = document.getElementById('build-play-over-unlock').textContent
    out.hintGone = getComputedStyle(hint).display === 'none'
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toMatchObject({
    first: true, picker: false, outsideCamp: true, starterNear: true, starterNoSun: true, hint: true,
    headMark: 'head', killMark: 'kill', killed: true, coins: true,
    sunKill: { gone: true, kills: 0, coins: 0 },
    lowered: 'simple', pickedStays: 'simple', hintGone: true,
  })
  expect(r.unlock).toMatch(/Propeller Cap/)
  // The daily challenge is in the Quests, no longer a card on the homepage.
  expect(await page.evaluate(() => document.getElementById('home-daily'))).toBeNull()
})

// 2026-11-15: an animal's body-part drop shows as a little 3D model in your
// hands, and eating one lifts it to your mouth for 3 bites that chew
// pieces out of it (HeldFood.js).
test('a held animal drop is a 3D model in the hands, bitten while eaten', async ({ page }) => {
  test.setTimeout(180000)
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    s.inv.hotbar[2] = { kind: 'item', id: 'meat_elephant', n: 2 }
    s.inv.select(2)
  })
  await page.waitForFunction(() => window.__game.buildMode.tryMode._food?.group.visible, null, { timeout: 60000 })
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tm = bm.tryMode
    const food = tm._food
    const count = () => food.mesh.geometry.attributes.position.count
    const whole = count()
    const out = { whole: whole > 300 }
    // Eaten away from a fire (by one, it's cooked instead).
    s.hunger.nearFire = () => false
    s.health = 40
    out.used = s.inv.useHeld() && s.inv.hotbar[2]?.n === 1
    out.eating = food.eating?.id === 'meat_elephant'
    // Jump to just after the last bite and draw one frame.
    food.eating.at = performance.now() - 1300
    tm.drawFood(bm.renderer, 'meat_elephant')
    out.bites = food.eating?.bites === 3
    out.bitten = count() < whole * 0.9
    out.lifted = tm._hand.position.y > 0.01
    // Done: the next one in the stack is whole again, crumbs gone.
    food.eating.at = performance.now() - 5000
    tm.drawFood(bm.renderer, 'meat_elephant')
    out.whole2 = food._key === 'meat_elephant|0'
    // A gun in hand: no model, no crumbs left over.
    out.gun = tm.drawFood(bm.renderer, null) === false && food._crumbs.length === 0
    return out
  })
  expect(r).toEqual({ whole: true, used: true, eating: true, bites: true, bitten: true, lifted: true, whole2: true, gun: true })
})

test('Save Clip keeps the last ~30 s and saves a video (K and the pause screen)', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__clipTest = true
    localStorage.removeItem('gayz-play-saved-run')
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  const a = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const c = s.clips
    const out = { on: c.on, recs: c._recs.length }
    // Too young to save: K says so.
    c._recs[0].age = 0.5
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', bubbles: true }))
    out.tooYoung = document.getElementById('pill-clip')?.textContent
    // Overlapping recordings: a new one every 15 s, thrown away at 45 s,
    // and a save uses the youngest that's 30 s or older.
    c._recs[0].age = 16
    c.update()
    out.afterStagger = c._recs.length
    c._recs[0].age = 31
    c._recs[1].age = 16
    c.update()
    out.three = c._recs.length
    out.pickAge = Math.floor(c._pick().age)
    c._recs[0].age = 46
    c.update()
    out.afterLife = c._recs.length
    return out
  })
  expect(a.on).toBe(true)
  expect(a.recs).toBe(1)
  expect(a.tooYoung).toBe('Nothing to save yet - play a few seconds first')
  expect(a.afterStagger).toBe(2)
  expect(a.three).toBe(3)
  expect(a.pickAge).toBe(31)
  expect(a.afterLife).toBe(2)
  // A real second of video, then Save Clip from the pause screen.
  await page.waitForTimeout(1500)
  const paused = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    c._recs.forEach((r) => (r.age = Math.max(r.age, 3)))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    return { paused: c.paused, states: c._recs.map((r) => r.rec.state), btn: getComputedStyle(document.getElementById('play-pause-clip-btn')).display }
  })
  expect(paused.paused).toBe(true)
  expect(paused.states.every((st) => st === 'paused')).toBe(true)
  expect(paused.btn).not.toBe('none')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(() => document.getElementById('play-pause-clip-btn').click()),
  ])
  expect(download.suggestedFilename()).toMatch(/^gayz-clip-\d{4}-\d\d-\d\d-\d{6}\.(mp4|webm)$/)
  const b = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    return { size: c.lastClip?.size || 0, left: c._recs.length, status: document.getElementById('play-pause-status').textContent }
  })
  expect(b.size).toBeGreaterThan(0)
  expect(b.left).toBeGreaterThan(0)
  expect(b.status).toMatch(/^Clip saved!/)
  // Leaving the game stops every recording.
  const end = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    document.getElementById('play-pause-leave-btn').click()
    return { on: s.clips.on, recs: s.clips._recs.length }
  })
  expect(end).toEqual({ on: false, recs: 0 })
})

test('Clip Options: Video or GIF, length, Custom, sound, GIF size - and a GIF saves', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__clipTest = true
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-clip-options')
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  // The pause screen's Clip Options: pick 10 s, then Custom 7 s, sound off.
  const a = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    const out = { mode: c.mode, keep: c.keep, sound: c._stream?.getAudioTracks().length === (window.__audioEngine?.ctx ? 1 : 0) }
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    document.getElementById('play-pause-clipopts-btn').click()
    out.panel = !document.getElementById('play-clip').hidden && document.getElementById('play-pause-buttons').hidden
    const chip = (opt, val) => document.querySelector(`#play-clip-rows button[data-opt="${opt}"][data-val="${val}"]`)
    out.labels = [...document.querySelectorAll('#play-clip-rows button')].map((b) => b.textContent)
    chip('len', '10').click()
    out.tenOn = chip('len', '10').classList.contains('on')
    chip('len', 'custom').click()
    document.getElementById('play-clip-custom').value = '7'
    chip('sound', 'off').click()
    out.customKept = document.getElementById('play-clip-custom').value
    document.getElementById('play-clip-done').click()
    out.after = { ...c.options, keep: c.keep, stagger: c.stagger, life: c.life, paused: c.paused, recs: c._recs.length }
    out.status = document.getElementById('play-pause-status').textContent
    out.stored = JSON.parse(localStorage.getItem('gayz-clip-options'))
    // Out of range: kept between 5 and 60.
    c.setOptions({ ...c.options, len: 999 })
    out.capped = c.keep
    return out
  })
  expect(a.mode).toBe('video')
  expect(a.keep).toBe(30)
  expect(a.sound).toBe(true)
  expect(a.panel).toBe(true)
  expect(a.labels).toEqual(['Video', 'GIF', '10 s', '20 s', '30 s', 'Custom', '1x', '0.5x', '0.25x', 'Custom', 'On', 'Off', 'Circle', 'Behind', 'Top-down', 'Side', 'Custom'])
  expect(a.tenOn).toBe(true)
  expect(a.customKept).toBe('7')
  expect(a.after).toMatchObject({ type: 'video', len: 7, sound: false, keep: 7, stagger: 5, life: 12, paused: true, recs: 1 })
  expect(a.status).toBe('Clip options saved - recording starts fresh')
  expect(a.stored).toMatchObject({ type: 'video', len: 7, sound: false, gifSize: 'small', speed: 1, angle: 'circle' })
  expect(a.capped).toBe(60)
  // GIF, 10 s, Big.
  const b = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    document.getElementById('play-pause-clipopts-btn').click()
    const chip = (opt, val) => document.querySelector(`#play-clip-rows button[data-opt="${opt}"][data-val="${val}"]`)
    chip('type', 'gif').click()
    const out = { soundRow: !!chip('sound', 'on'), sizeRow: !!chip('gifSize', 'big'), note: document.querySelector('#play-clip .play-clip-note')?.textContent }
    chip('gifSize', 'big').click()
    chip('len', '10').click()
    document.getElementById('play-clip-done').click()
    out.mode = c.mode
    out.recs = c._recs.length
    out.opts = c.options
    // Back to the game.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    out.paused = c.paused
    return out
  })
  expect(b).toMatchObject({ soundRow: false, sizeRow: true, mode: 'gif', recs: 0, paused: false })
  expect(b.note).toMatch(/^GIFs have no sound/)
  expect(b.opts).toMatchObject({ type: 'gif', len: 10, sound: false, gifSize: 'big', speed: 1 })
  await page.waitForFunction(() => window.__game.buildMode.survival.clips._gif?.video.videoWidth > 0, null, { timeout: 30000 })
  // 25 pictures (2.5 s), each made into GIF bytes by the worker; the slow
  // test machine's frame rate doesn't matter, they're grabbed here.
  await page.waitForFunction(() => window.__game.buildMode.survival.clips._gif?.frames.length > 0, null, { timeout: 30000 })
  const c1 = await page.evaluate(async () => {
    const c = window.__game.buildMode.survival.clips
    const g = c._gif
    // Hold the game's own grabbing still so only these count.
    c.paused = true
    if (g.pending) await new Promise((resolve) => g.flushers.push(resolve))
    const out0 = g.frames.length
    g.frames = []
    for (let i = 0; i < 25; i++) {
      c._grabGif(0.1)
      if (g.pending) await new Promise((resolve) => g.flushers.push(resolve))
    }
    const f = g.frames[0]
    const out = { grabbedByGame: out0 > 0, frames: g.frames.length, w: f.w, h: f.h, worker: !!g.worker }
    // Only the last 10 s (100 pictures) are kept.
    for (let i = 0; i < 120; i++) c._gifDone(g, g.frames[g.frames.length - 1])
    out.capped = g.frames.length
    g.frames.splice(0, 75)
    return out
  })
  expect(c1.grabbedByGame).toBe(true)
  expect(c1.frames).toBe(25)
  expect(Math.max(c1.w, c1.h)).toBe(480)
  expect(c1.worker).toBe(true)
  expect(c1.capped).toBe(100)
  const [download, saved] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(async () => {
      const c = window.__game.buildMode.survival.clips
      const r = await c.save()
      const head = new TextDecoder().decode(new Uint8Array(await r.blob.slice(0, 6).arrayBuffer()))
      const img = new Image()
      img.src = URL.createObjectURL(r.blob)
      await img.decode()
      return { head, seconds: r.seconds, type: r.blob.type, w: img.naturalWidth, h: img.naturalHeight, cw: c.lastClip.w, ch: c.lastClip.h, pill: document.getElementById('pill-clip')?.textContent, kept: c._gif.frames.length }
    }),
  ])
  expect(download.suggestedFilename()).toMatch(/^gayz-clip-\d{4}-\d\d-\d\d-\d{6}\.gif$/)
  expect(saved).toMatchObject({ head: 'GIF89a', seconds: 3, type: 'image/gif', kept: 25 })
  expect([saved.w, saved.h]).toEqual([saved.cw, saved.ch])
  expect(saved.pill).toBe('GIF saved! (3 s)')
  // Leaving stops the GIF side too.
  const end = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    document.getElementById('play-pause-leave-btn').click()
    return { on: c.on, gif: c._gif }
  })
  expect(end).toEqual({ on: false, gif: null })
})

test('Clip Maker 3: Speed, slow-mo GIF and video, Replay Clip camera angles and cancel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__clipTest = true
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-clip-options')
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 90000 })
  // Clip Options: Speed Custom 0.35x, Replay Camera Custom with sliders.
  const a = await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    const out = { replayBtn: getComputedStyle(document.getElementById('play-pause-replay-btn')).display, replayLabel: document.getElementById('play-pause-replay-label').textContent }
    document.getElementById('play-pause-clipopts-btn').click()
    const chip = (opt, val) => document.querySelector(`#play-clip-rows button[data-opt="${opt}"][data-val="${val}"]`)
    chip('speed', '0.5').click()
    out.halfOn = chip('speed', '0.5').classList.contains('on')
    out.soundRowWhenSlow = !!chip('sound', 'on')
    out.slowNote = document.querySelector('#play-clip .play-clip-note')?.textContent
    chip('speed', 'custom').click()
    document.getElementById('play-clip-speed-custom').value = '0.35'
    chip('angle', 'custom').click()
    out.sliders = document.querySelectorAll('#play-clip-rows input[type=range]').length
    const turn = document.querySelector('#play-clip-rows input[data-cam="turn"]')
    turn.value = '90'
    turn.dispatchEvent(new Event('input', { bubbles: true }))
    out.turnLabel = document.querySelector('[data-cam-val="turn"]').textContent
    out.speedKept = document.getElementById('play-clip-speed-custom').value
    document.getElementById('play-clip-done').click()
    out.opts = c.options
    // Odd values are kept in range.
    c.setOptions({ ...c.options, speed: 0.01, cam: { dist: 99, height: -4, turn: 'x' } })
    out.capped = { speed: c.options.speed, cam: c.options.cam }
    return out
  })
  expect(a.replayBtn).not.toBe('none')
  expect(a.replayLabel).toBe('Replay Clip')
  expect(a.halfOn).toBe(true)
  expect(a.soundRowWhenSlow).toBe(false)
  expect(a.slowNote).toMatch(/^Slow-mo clips have no sound/)
  expect(a.sliders).toBe(3)
  expect(a.turnLabel).toBe('90°')
  expect(a.speedKept).toBe('0.35')
  expect(a.opts).toMatchObject({ speed: 0.35, angle: 'custom', cam: { dist: 5, height: 2, turn: 90 } })
  expect(a.capped).toEqual({ speed: 0.1, cam: { dist: 15, height: 0, turn: 45 } })

  // Slow-mo GIF: each picture waits twice as long at 0.5x (checked in
  // the saved file below).
  await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    c.setOptions({ ...c.options, type: 'gif', speed: 0.5, len: 5 })
  })
  await page.waitForFunction(() => window.__game.buildMode.survival.clips._gif?.video.videoWidth > 0, null, { timeout: 30000 })
  const [gifDl, gifSaved] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.evaluate(async () => {
      const c = window.__game.buildMode.survival.clips
      const gg = c._gif
      c.paused = true
      if (gg.pending) await new Promise((resolve) => gg.flushers.push(resolve))
      gg.frames = []
      for (let i = 0; i < 25; i++) {
        c._grabGif(0.1)
        if (gg.pending) await new Promise((resolve) => gg.flushers.push(resolve))
      }
      const r = await c.save()
      const buf = new Uint8Array(await r.blob.arrayBuffer())
      // The first picture's timing note sits right after the 32-byte head.
      return { seconds: r.seconds, delay: buf[19 + 13 + 4] + buf[19 + 13 + 5] * 256, pill: document.getElementById('pill-clip')?.textContent }
    }),
  ])
  expect(gifDl.suggestedFilename()).toMatch(/\.gif$/)
  expect(gifSaved).toEqual({ seconds: 5, delay: 20, pill: 'GIF saved! (5 s)' })

  // Slow-mo video: about 1.5 s of real video at 0.5x is played back and
  // recorded again (so ~3 s to make), with a % pill on the way.
  await page.evaluate(() => {
    const c = window.__game.buildMode.survival.clips
    c.setOptions({ ...c.options, type: 'video', speed: 0.5, len: 5 })
    c.setPaused(false)
  })
  await page.waitForTimeout(1500)
  const [vidDl, vid] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.evaluate(async () => {
      const c = window.__game.buildMode.survival.clips
      c._recs.forEach((r) => (r.age = Math.max(r.age, 3)))
      const pills = new Set()
      const watch = setInterval(() => pills.add(document.getElementById('pill-clip')?.textContent || ''), 100)
      const r = await c.save()
      clearInterval(watch)
      return { seconds: r?.seconds, size: r?.blob.size || 0, type: r?.blob.type, making: [...pills].some((p) => /^Making slow-mo clip\.\.\. \d+%$/.test(p)), pill: document.getElementById('pill-clip')?.textContent }
    }),
  ])
  expect(vidDl.suggestedFilename()).toMatch(/^gayz-clip-.*\.(mp4|webm)$/)
  expect(vid.seconds).toBe(6)
  expect(vid.size).toBeGreaterThan(0)
  expect(vid.making).toBe(true)
  expect(vid.pill).toBe('Clip saved! (6 s)')

  // Replay Clip: the world rewinds while the pause screen is up (hidden),
  // the camera sits where the Replay Camera says, and a file comes out.
  const replayDl = page.waitForEvent('download', { timeout: 60000 })
  const r1 = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const c = s.clips
    c.setOptions({ ...c.options, type: 'video', speed: 1, len: 5, angle: 'side' })
    // Five seconds "recorded" where I stand.
    s.replay._frames = []
    for (let i = 0; i < 120; i++) {
      s.replay._acc = 1
      s.replay.record(0.05)
    }
    if (!s.bm.menuOpen) s.bm.toggleMenu()
    const menu = s.bm.menuOpen
    document.getElementById('play-pause-replay-btn').click()
    await new Promise((r) => setTimeout(r, 300))
    const rp = s.replay
    const out = { menu, active: rp.active, recorded: Math.round(rp.recorded()), cls: document.body.classList.contains('play-replay'), pauseHidden: getComputedStyle(document.getElementById('play-pause-card')).visibility, tag: document.querySelector('#play-replay-tag b').textContent, cancel: document.getElementById('play-replay-skip').textContent }
    // Side: the camera is 5 blocks to my right, looking at me.
    const cam = s.bm.camera
    const restore = rp.applyView(cam)
    const cx = rp._cam.center
    const B = s.B
    const fx = -Math.sin(rp._camYaw)
    const fz = -Math.cos(rp._camYaw)
    out.side = Math.round(((cam.position.x - cx.x) * -fz + (cam.position.z - cx.z) * fx) / B)
    restore()
    // Skip ahead to the end so the slow test machine doesn't wait.
    rp._t = rp._len - 0.05
    return out
  })
  expect(r1).toMatchObject({ menu: true, active: true, recorded: 6, cls: true, pauseHidden: 'hidden', cancel: 'Cancel', side: 5 })
  expect(r1.tag).toMatch(/^REPLAY CLIP \d+%$/)
  expect((await replayDl).suggestedFilename()).toMatch(/^gayz-replay-.*\.(mp4|webm)$/)
  await page.waitForFunction(() => !window.__game.buildMode.survival.clips.saving, null, { timeout: 30000 })
  const r2 = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    return { active: s.replay.active, cls: document.body.classList.contains('play-replay'), menu: s.bm.menuOpen, status: document.getElementById('play-pause-status').textContent, last: s.clips.lastClip, kept: s.replay.recorded() > 0 }
  })
  expect(r2).toMatchObject({ active: false, cls: false, menu: true, status: 'Replay clip saved! (5 s)', kept: true })
  expect(r2.last.replay).toBe(true)
  expect(r2.last.size).toBeGreaterThan(0)

  // Cancel with Escape: no file, zombies back, still paused.
  const r3 = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const c = s.clips
    c.setOptions({ ...c.options, angle: 'top' })
    let downloads = 0
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) downloads++
    }
    const p = c.saveReplay()
    await new Promise((r) => setTimeout(r, 200))
    const cam = s.bm.camera
    const restore = s.replay.applyView(cam)
    const above = Math.round((cam.position.y - s.replay._cam.center.y) / s.B)
    restore()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))
    const res = await p
    HTMLAnchorElement.prototype.click = click
    return { above, res, downloads, active: s.replay.active, menu: s.bm.menuOpen, status: document.getElementById('play-pause-status').textContent }
  })
  expect(r3).toEqual({ above: 14, res: null, downloads: 0, active: false, menu: true, status: 'Replay clip cancelled' })

  // Not on a server: the button hides and it says why.
  const r4 = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    // All in one go, so no game frame sees the pretend server.
    s.net = { closed: false }
    s.bm.gameMenu._refresh()
    const btn = getComputedStyle(document.getElementById('play-pause-replay-btn')).display
    s.clips.saveReplay()
    const pill = document.getElementById('pill-clip')?.textContent
    s.net = null
    s.bm.gameMenu._refresh()
    return { btn, pill }
  })
  expect(r4).toEqual({ btn: 'none', pill: 'Replay Clip works in solo games only' })
})

// PC pause screen (2026-11-20): wide, two columns, Back/Leave full width,
// no scrolling on a small laptop; a phone keeps one column.
test('the pause screen uses two columns on PC and one on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await gotoAndWaitForGame(page)
  await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    g.buildMode.toggleMenu()
  })
  const measure = () => page.evaluate(() => {
    const shown = [...document.querySelectorAll('#play-pause-buttons > button')].filter((b) => b.offsetParent)
    const lefts = new Set(shown.map((b) => Math.round(b.getBoundingClientRect().left)))
    const width = (id) => Math.round(document.getElementById(id).getBoundingClientRect().width)
    const menu = document.getElementById('play-pause-menu')
    return { columns: lefts.size, backFull: width('play-pause-back-btn') === width('play-pause-leave-btn'), cardWide: width('play-pause-card') >= 700, scrolls: menu.scrollHeight > menu.clientHeight + 1 }
  })
  expect(await measure()).toEqual({ columns: 2, backFull: true, cardWide: true, scrolls: false })
  await page.setViewportSize({ width: 390, height: 844 })
  const phone = await measure()
  expect(phone.columns).toBe(1)
  expect(phone.cardWide).toBe(false)
})

// Walk trails (WalkTrails.js, 2026-11-25): walking leaves footprints (flat
// prints that fade) or sparkles behind me - only one I own, and not while
// dead. My pick rides in my server state so others see it.
test('Walk trails: footprints and sparkles behind me as I walk', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    g.shopCosmetics = { footprintTrail: 1, sparkleTrail: 1 }
    g.settings.walkTrail = 'footprintTrail'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const scene = g.buildMode.scene
    const prints = () => scene.children.filter((o) => o.isMesh && o.renderOrder === 2 && o.visible && o.userData.age < 4).length
    const pos = g.buildMode.tryMode.pos
    // Walk 4 blocks along x, one game frame per small step.
    const walk = (n) => {
      for (let i = 0; i < n; i++) {
        pos.x += 0.2
        s.update(0.05)
      }
    }
    walk(20)
    const footprints = prints()
    g.settings.walkTrail = 'sparkleTrail'
    const sparks = () => s._fx._sprites.filter((sp) => sp.userData.life > 0 && sp.userData.t < sp.userData.life && sp.userData.t >= 0).length
    const before = sparks()
    walk(20)
    const sparkles = sparks() - before
    // Not owned: nothing.
    g.shopCosmetics = {}
    g.settings.walkTrail = 'footprintTrail'
    for (const o of scene.children) if (o.renderOrder === 2 && o.isMesh) o.visible = false
    walk(20)
    const unowned = prints()
    g._exitBuildMode()
    return { footprints, sparkles, unowned }
  })
  expect(r.footprints).toBeGreaterThan(3)
  expect(r.sparkles).toBeGreaterThan(3)
  expect(r.unowned).toBe(0)
})

// Gun skins (GunSkins.js, 2026-11-25): one skin paints every gun - the gun
// in my hands and the one my own body holds in third person - only if I
// own it, and back to the model's own colours with none.
test('Gun skins: my gun in hand and on my body wear my skin', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    g.shopCosmetics = { lavaGun: 1 }
    g.settings.gunSkin = 'lavaGun'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    await g.weapons.ready
    s._pickWeapon('rifle')
    const tm = g.buildMode.tryMode
    // A skin's picture is a drawn canvas; the models' own are images.
    const painted = (root) => {
      const out = []
      root?.traverse((o) => { if (o.isMesh) out.push(o.material.map?.image instanceof HTMLCanvasElement) })
      return out.length ? out.every(Boolean) ? 'all' : out.some(Boolean) ? 'some' : 'none' : 'empty'
    }
    tm._showGun()
    const hand = painted(tm._gunModel)
    // The body needs my skin's picture, which loads on its own.
    for (let i = 0; i < 100 && !tm._armSkin; i++) await new Promise((res) => setTimeout(res, 100))
    tm.view = 1
    tm._updateBody(0.016)
    const body = painted(tm._body?.gun)
    g.settings.gunSkin = ''
    tm._showGun()
    tm._updateBody(0.016)
    const handOff = painted(tm._gunModel)
    const bodyOff = painted(tm._body?.gun)
    // Not owned: not worn.
    g.shopCosmetics = {}
    g.settings.gunSkin = 'goldGun'
    tm._showGun()
    const unowned = painted(tm._gunModel)
    tm.view = 0
    g._exitBuildMode()
    return { hand, body, handOff, bodyOff, unowned }
  })
  expect(r).toEqual({ hand: 'all', body: 'all', handOff: 'none', bodyOff: 'none', unowned: 'none' })
})

// Pet + ride looks (PetRideLooks.js, 2026-11-25): my pet hat and paint go
// on the Pet Zombie and my tamed animals, my ride paint on the go-kart -
// only if I own them; taking the look off puts the pet's own colours back.
test('Pet and ride looks: hats and paint on my pets, paint on my kart', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    g.shopCosmetics = { petCrown: 1, petGold: 1, rideNeon: 1 }
    Object.assign(g.settings, { petHat: 'petCrown', petPaint: 'petGold', ridePaint: 'rideNeon' })
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    const gold = (o) => o.material?.color?.getHexString?.()
    const out = {}
    // The kart: its red frame is neon now, the black wheels stay black.
    s.kart.dispose()
    const me = s.bodyPos()
    s.kart.placeAt(me.x + 3, me.y, me.z + 3, 0)
    const kartCols = new Set()
    s.kart.group.traverse((o) => { if (o.isMesh) kartCols.add(gold(o)) })
    out.kartNeon = s.kart.group.userData.paintId === 'rideNeon' && !kartCols.has('c0392b') && kartCols.has('151515')
    s.kart.dispose()
    // The Pet Zombie: wears the crown (no bow), painted.
    s.pet.data = { name: 0 }
    s.pet._despawn()
    for (let i = 0; i < 50 && !s.pet.pet; i++) {
      s.pet._spawn(me.x + 1, me.y, me.z + 1)
      if (!s.pet.pet) await new Promise((res) => setTimeout(res, 100))
    }
    out.petHat = !!s.pet.pet?.look.petHat
    out.petPainted = s.pet.pet?.group.userData.paintId === 'petGold'
    s.pet.release()
    // A tamed cow: crown on its head, painted; looks come off with none.
    const a = s.animals.placeAt({ kind: 'cow', x: me.x + 2, y: me.y, z: me.z })
    a.tamed = true
    s.animals._dressPet(a)
    out.cowHat = !!a.petHat && a.petHat.parent === a.head
    out.cowPainted = a.group.userData.paintId === 'petGold'
    let shared = false
    a.group.traverse((o) => { if (o.isMesh && o.material === a.parts.bodyMat) shared = true })
    out.cowOwnMats = !shared
    g.settings.petPaint = ''
    g.settings.petHat = ''
    s.animals._dressPet(a)
    let back = false
    a.group.traverse((o) => { if (o.isMesh && o.material === a.parts.bodyMat) back = true })
    out.cowBack = back && !a.petHat
    // Not owned: not worn.
    g.shopCosmetics = {}
    g.settings.petHat = 'petCrown'
    s.animals._dressPet(a)
    out.unowned = !a.petHat
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({ kartNeon: true, petHat: true, petPainted: true, cowHat: true, cowPainted: true, cowOwnMats: true, cowBack: true, unowned: true })
})

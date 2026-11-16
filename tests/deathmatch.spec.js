// Deathmatch and Team Deathmatch.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Deathmatch (2026-11-16): free for all with bots up to 8, endless ammo,
// kills, deaths and respawns, the kill feed, and the most kills winning.
test('Deathmatch: bots, kills, respawns and the winner', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'deathmatch'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pm = s.party
    const D = pm.ext
    out.endlessAmmo = s.reserve === Infinity && document.getElementById('build-play-ammo')?.textContent.includes('∞')
    // Straight into the arena - no wait in the camp first.
    pm.update(0.05)
    out.noWait = pm.phase === 'play'
    pm.update(0.05)
    const me = pm.myId
    out.topBar = document.getElementById('dm-top')?.classList.contains('on') && /#\d+ of 8/.test(document.getElementById('dm-top').textContent)
    out.eightFighters = pm.phase === 'play' && pm.bots.size === 7 && D.hp.size === 8 && D.hp.get(me) === 100
    out.inArena = s.bm.tryMode.pos.y > 186 && D._inside(s.bm.tryMode.pos.x, s.bm.tryMode.pos.z)
    out.healthBar = document.getElementById('build-play-health-text')?.textContent === '100'
    // Shoot a bot down: a kill, a line in the feed, the bot back at full health.
    D.prot.clear()
    const bot = [...pm.bots.keys()][0]
    D._hit(bot, 40, me)
    out.botHit = D.hp.get(bot) === 60
    D._hit(bot, 100, me)
    pm.update(0.05)
    out.kill = pm.score[me] === 1 && D.deaths[bot] === 1 && D.hp.get(bot) === 100 && D.feed.at(-1)?.k === me && document.querySelectorAll('#dm-feed .dm-feed-row').length === 1
    out.spawnSafe = D.prot.has(bot)
    // A second kill straight after: "Double Kill!".
    D.prot.clear()
    D._hit([...pm.bots.keys()][2], 100, me)
    pm.update(0.05)
    out.streak = document.getElementById('dm-streak')?.textContent === 'Double Kill!' && document.getElementById('dm-streak').classList.contains('on')
    pm.score[me] = 1
    // A bot gets me: I respawn at a spawn point with full health.
    D.prot.clear()
    const other = [...pm.bots.keys()][1]
    D._hit(me, 70, other)
    pm.update(0.05)
    out.myHealthShown = document.getElementById('build-play-health-text')?.textContent === '30'
    D._hit(me, 70, other)
    pm.update(0.05)
    // The kill cam: their name, no moving or shooting, my body safe under
    // the floor; RESPAWN_S later I'm back in the arena.
    const cam = document.getElementById('dm-killcam')
    out.killCam = !!D._cam && cam.classList.contains('on') && cam.textContent.includes(pm._name(other)) && s.bm.tryMode.hideGun === true && s.bm.tryMode.speedMult === 0 && s.tryFire() === false && s.bm.tryMode.pos.y < 186 && D.prot.has(me)
    D._cam.start -= 6000
    pm.update(0.05)
    out.iRespawned = !D._cam && !cam.classList.contains('on') && !s.bm.tryMode.hideGun && D.deaths[me] === 1 && D.hp.get(me) === 100 && pm.score[other] === 1 && s.bm.tryMode.pos.y > 186
    // A player joining takes a bot's place.
    const realPeople = pm._people
    pm._people = function () {
      const list = realPeople.call(this)
      return [...list, { id: 'Guest1', x: list[0].x, y: list[0].y, z: list[0].z }]
    }
    pm.update(0.05)
    out.botLeavesForPlayer = pm.bots.size === 6 && D.hp.has('Guest1')
    pm._people = realPeople
    pm.update(0.05)
    // The host's sync carries it to a guest.
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    const copy = new D.constructor(pm)
    copy.apply(snap.x)
    out.snap = copy.hp.get(me) === 100 && copy.deaths[me] === 1 && copy.feed.length === 3 && copy.feedN === D.feedN
    copy.dispose()
    // Time's up: the most kills wins.
    pm.score[me] = 5
    pm.left = 0.01
    pm.update(0.05)
    out.winner = pm.phase === 'end' && pm.winner === me && document.getElementById('dm-board')?.classList.contains('on')
    s.stop?.()
    g._exitBuildMode?.()
    await new Promise((res) => setTimeout(res, 200))
    out.cleanedUp = !document.getElementById('dm-feed') && !document.getElementById('dm-board') && !document.getElementById('dm-killcam') && !document.getElementById('dm-top')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Sky-arena modes start IN their arena, never in the zombie camp first;
// no animals in Deathmatch; spectating keeps its own camera (2026-11-16).
test('Arena modes start in the arena, Deathmatch has no animals, spectate camera holds', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      return s
    }
    // Straight after start - gun picker still open, round not begun.
    for (const [mode, y] of [['floorLava', 230], ['musicalChairs', 220], ['deathmatch', 186]]) {
      const s = await start(mode)
      const tm = s.bm.tryMode
      out[`${mode}InArena`] = s.party.phase === 'wait' && tm.pos.y > y && s.bm.camera.position.y / s.B > y && s._groundUnder(tm.pos.x, tm.pos.y + 0.5, tm.pos.z) > y - 1
      if (mode !== 'deathmatch') s.stop()
    }
    const s = g.buildMode.survival
    s._pickWeapon('rifle')
    const pm = s.party
    const D = pm.ext
    for (let i = 0; i < 40; i++) s.update(0.05)
    out.noAnimals = s._noAnimals && s.animals.list.length === 0
    out.sameArena = pm.phase === 'play' && s.bm.tryMode.pos.y > 186 && D._inside(s.bm.tryMode.pos.x, s.bm.tryMode.pos.z)
    // Spectate: fly off; a respawn (or a fall check) can't pull the camera back.
    const sp = s.bm.spectate
    sp.enter()
    s.bm.camera.position.set(0, 300 * s.B, 0)
    D.prot.clear()
    const bot = [...pm.bots.keys()][0]
    D._hit(pm.myId, 999, bot)
    out.notHurt = D.hp.get(pm.myId) === 100
    // Killed anyway (a hit sent before I started spectating): the kill cam
    // and respawn want the camera - the free camera keeps it.
    s.spectating = false
    D._hit(pm.myId, 999, bot)
    s.spectating = true
    let jumps = 0
    for (let i = 0; i < 40; i++) {
      const was = s.bm.camera.position.clone()
      s.bm.update(0.05)
      if (s.bm.camera.position.distanceTo(was) > 0.01) jumps++
    }
    out.camHeld = jumps === 0 && Math.abs(s.bm.camera.position.y / s.B - 300) < 1 && Math.abs(s.bm.camera.position.x) < 1
    sp.exit()
    s.stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Deathmatch's Small Town (2026-11-16): a 121 x 121 named map, bots that
// hold and fire a real gun, find their way round buildings, and the
// minimap drawing the arena (not the camp far below).
test('Deathmatch: Small Town map, bots hold guns, minimap shows the arena', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'deathmatch'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pm = s.party
    const D = pm.ext
    pm.update(0.05)
    pm.update(0.05)
    out.named = D.mapId === 'smallTown' && D.mapName() === 'Small Town' && D.startText().startsWith('Map: Small Town')
    // 121 x 121 (was 81 x 81): floor out to near the sides, void past the uneven edge
    // (2026-11-16, was trees and a wall).
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const bm = s.bm
    out.bigFloor = !!bm.getBlockAt(hx + 33, 186, hz) && !!bm.getBlockAt(hx - 33, 186, hz) && !!bm.getBlockAt(hx, 186, hz + 33) && !!bm.getBlockAt(hx + 48, 186, hz) && !bm.getBlockAt(hx + 61, 186, hz) && !bm.getBlockAt(hx + 61, 192, hz) && !bm.getBlockAt(hx, 192, hz + 61) && !bm.getBlockAt(hx + 60, 186, hz + 60) && D._inside(hx + 60, hz - 60)
    out.streets = bm.getBlockAt(hx + 20, 186, hz + 1) === 'asphalt' && bm.getBlockAt(hx + 1, 186, hz - 20) === 'asphalt'
    // Every bot carries a gun from the list, held in its right hand.
    const bots = [...pm.bots.values()]
    // (their skins load first)
    for (let i = 0; i < 100 && !bots.every((b) => b.gun); i++) {
      pm.update(0.05)
      await new Promise((res) => setTimeout(res, 50))
    }
    out.botsHoldGuns = bots.length === 7 && bots.every((b) => b.w && b.gun && b.gunId === b.w && b.gun.parent === b.body.limbPivots.armR)
    // A bot shooting: turns to its target, raises the gun, flashes, and
    // the shot count reaches guests with its gun.
    const b = bots[0]
    const before = b.fireN || 0
    pm._botFired(b)
    b.faceT = 1
    pm.update(0.01)
    out.firePose = b.fireN === before + 1 && !!b.flash && b.flash.parent === b.gun && b.body.limbPivots.armR.rotation.x < -1.3
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    out.snapGun = snap.bots[b.id].w === b.w && snap.bots[b.id].fs === b.fireN && snap.x.mp === 'smallTown'
    // Bots find a way round buildings: a path step towards a target
    // across the town, on walkable ground.
    const grid = D._navGrid()
    const target = { id: 'X', x: hx + 12.5, y: 187, z: hz + 29.5 }
    b.x = hx - 30.5
    b.z = hz + 0.5
    b.y = 187
    b.nav = null
    const step = D._navStep(b, target, 0.05)
    out.nav = !!grid && grid.reduce((a, v) => a + v, 0) > 3000 && !!step && Math.hypot(step.x - b.x, step.z - b.z) <= 4
    // The minimap: the arena from above, its name where the biome shows.
    const tm = s.bm.tryMode
    tm._drawMap(performance.now() + 1e6)
    out.skyMap = !!tm._skyMap?._layer && tm._skyMap._layer.w >= 100 && tm._skyMap._layer.w <= 121 && document.getElementById('build-try-biome')?.textContent === 'Small Town'
    s.stop?.()
    g._exitBuildMode?.()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Deathmatch map picker (2026-11-16): Game Mode > Deathmatch picks the
// map (Small Town unless picked); the Military Base builds with its
// helipad and uneven edge, every spawn has room to stand, and switching
// maps (a guest learning the host's pick) clears the old map's blocks.
test('Deathmatch: map picker, Military Base, void edge, falling off is a death', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    out.defaultTown = g.settings.dmMap === 'smallTown' && document.getElementById('dm-map-smallTown').classList.contains('active')
    g.settings.selectedGameMode = 'classic'
    document.getElementById('dm-map-militaryBase').click()
    out.picked = g.settings.dmMap === 'militaryBase' && g.settings.selectedGameMode === 'deathmatch' && document.getElementById('dm-map-militaryBase').classList.contains('active') && !document.getElementById('dm-map-smallTown').classList.contains('active')
    out.label = document.getElementById('dm-map-militaryBase').textContent === 'Military Base'
    localStorage.removeItem('gayz-play-saved-run')
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    const pm = s.party
    const D = pm.ext
    const t0 = performance.now()
    pm.update(0.05)
    out.buildMs = Math.round(performance.now() - t0)
    pm.update(0.05)
    out.named = D.mapId === 'militaryBase' && D.mapName() === 'Military Base' && D.startText().startsWith('Map: Military Base') && pm.snapshot().x.mp === 'militaryBase'
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const bm = s.bm
    const at = (x, y, z) => bm.getBlockAt(hx + x, 186 + y, hz + z)
    // The helipad's H and the helicopter on it.
    out.helipad = at(3, 0, 2) === 'whiteconcrete' && at(0, 0, 0) === 'whiteconcrete' && at(0, 4, 3) === 'blackconcrete'
    // The edge is void (2026-11-16): no wall, cliff, trees or water - the
    // outer ring and the cut corners are empty from under the floor up.
    let water = 0
    let ring = 0
    for (let x = -61; x <= 61; x++) {
      for (let z = -61; z <= 61; z++) {
        if (at(x, 0, z) === 'water') water++
        if (Math.abs(x) !== 61 && Math.abs(z) !== 61) continue
        for (let y = -3; y <= 17; y++) if (at(x, y, z)) ring++
      }
    }
    out.edge = water === 0 && ring === 0 && !at(-60, 0, -58) && !at(60, 0, 58) && !!at(15, 0, 0) && !!at(-25, 0, -49)
    // Falling off: a death for nobody, "fell" in the feed, the fall view.
    pm.update(0.05)
    const me = pm.myId
    D.prot.clear()
    const tm = bm.tryMode
    tm.pos.set(pm.home.x + 65, 186 - 12, pm.home.z)
    pm.update(0.05)
    pm.update(0.05)
    const f = D.feed.at(-1)
    out.fellDeath = D.deaths[me] === 1 && f?.k === me && f?.v === me && !pm.score[me]
    out.fellFeed = /fell$/.test(document.querySelector('#dm-feed .dm-feed-row:last-child')?.textContent || '')
    out.fellCam = !!D._cam && document.querySelector('#dm-killcam .dm-kc-name')?.textContent === 'You fell into the void'
    D._endCam(true)
    out.backIn = tm.pos.y > 186
    // A bot that falls: a death too, straight back in.
    const bot = [...pm.bots.values()][0]
    D.prot.clear()
    bot.y = 186 - 12
    pm.update(0.05)
    out.botFell = D.deaths[bot.id] === 1 && bot.y > 186
    // Every spawn: floor under, room for a body above.
    out.spawns = D.map.spawns.every(([x, z, h]) => s._solid(hx + x, 186 + h, hz + z) && !s._solid(hx + x, 187 + h, hz + z) && !s._solid(hx + x, 188 + h, hz + z))
    // Bots find their way across the base.
    const grid = D._navGrid()
    out.nav = !!grid && grid.reduce((a, v) => a + v, 0) > 2500
    // Switching to Small Town clears the base's blocks.
    D.mapId = 'smallTown'
    D.draw()
    out.switched = !at(0, 4, 3) && at(20, 0, 1) === 'asphalt' && !at(3, 0, 2)?.includes('white')
    s.stop?.()
    g._exitBuildMode?.()
    g.settings.dmMap = 'smallTown'
    return out
  })
  console.log('Military Base build ms:', r.buildMs)
  for (const [k, v] of Object.entries(r)) if (k !== 'buildMs') expect(v, k).toBe(true)
})

// Detailed buildings (2026-11-16): the Deathmatch maps use real stairs
// (turned the right way), slabs and ladders, and their Jump Pads, Speed
// Pads, Teleporter Pads and Wind Tunnels work in a round.
test('Deathmatch buildings: stairs, slabs, ladders and working pads', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'deathmatch'
    g.settings.dmMap = 'smallTown'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    const pm = s.party
    const D = pm.ext
    pm.update(0.05)
    pm.update(0.05)
    const bm = s.bm
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const at = (x, y, z) => bm.getBlockAt(hx + x, 186 + y, hz + z)
    const face = (x, y, z) => bm._stairFacing.get(bm._key(hx + x, 186 + y, hz + z))
    const check = (name) => {
      // Every block the map asked for is really there (no unknown ids).
      let missing = 0
      for (const key of D._arenaKeys) {
        const [x, y, z] = key.split(',').map(Number)
        if (bm.getBlockAt(x, y, z) !== s._placed.get(key)) missing++
      }
      out[name + 'AllPlaced'] = missing === 0 && D._arenaKeys.size > 5000
      // Every spawn still has floor under and room above.
      out[name + 'Spawns'] = D.map.spawns.every(([x, z, h]) => s._solid(hx + x, 186 + h, hz + z) && !s._solid(hx + x, 187 + h, hz + z) && !s._solid(hx + x, 188 + h, hz + z))
    }
    check('town')
    // Pews face away from the door, the roofs are stairs rising to the
    // ridge, the store's steps go up northward, a ladder up the tower.
    out.pew = at(9, 1, -31) === 'darkoakplanksstairs' && face(9, 1, -31) === 0
    out.roof = at(-19, 5, -16) === 'thatchstairs' && face(-19, 5, -16) === 0 && at(-19, 5, -6) === 'thatchstairs' && face(-19, 5, -6) === 2
    out.storeSteps = at(22, 1, -11) === 'stonestairs' && face(22, 1, -11) === 2 && at(22, 2, -12) === 'stonestairs'
    out.ladders = at(-10, 5, -31) === 'ladder' && at(12, 5, -23) === 'ladder'
    out.slabs = at(12, 1, -33) === 'gold' && at(10, 1, -33) === 'quartzslab'
    // The pads are live special blocks.
    const tm = bm.tryMode
    const sp = bm.specials
    out.specialsOn = sp.active && sp.entryAt(hx - 20, 187, hz - 3)?.def.id === 'jumppad' && sp.entryAt(hx - 6, 186, hz + 18)?.def.id === 'windtunnel'
    D.prot.clear()
    // Jump Pad: launched up.
    tm.pos.set(hx - 19.5, 187.01, hz - 2.5)
    tm.vel.set(0, 0, 0)
    sp._onPadKey = null
    sp._padCd = 0
    sp.update(0.02, tm.pos)
    out.jumpPad = tm.vel.y >= 15
    // Teleporter Pad in the park: off to the parking lot.
    tm.pos.set(hx - 25.5, 187.01, hz + 32.5)
    tm.vel.set(0, 0, 0)
    sp._onPadKey = null
    sp._padCd = 0
    sp.update(0.02, tm.pos)
    out.teleport = Math.floor(tm.pos.x) === hx + 35 && Math.floor(tm.pos.z) === hz - 27
    // Wind Tunnel by the Town Hall: floats you up.
    tm.pos.set(hx - 5.5, 187.01, hz + 18.5)
    tm.vel.set(0, 0, 0)
    sp.update(0.02, tm.pos)
    out.tunnel = tm.vel.y > 3
    // The Military Base: ladders up the watchtowers, stairs to the HQ roof.
    s.stop?.()
    g._exitBuildMode?.()
    g.settings.dmMap = 'militaryBase'
    localStorage.removeItem('gayz-play-saved-run')
    await g._enterBuildMode({ map: 'map3', play: true })
    const s2 = g.buildMode.survival
    for (let i = 0; i < 100 && !s2.active; i++) await new Promise((res) => setTimeout(res, 100))
    const pm2 = s2.party
    const D2 = pm2.ext
    pm2.update(0.05)
    pm2.update(0.05)
    const hx2 = Math.floor(pm2.home.x)
    const hz2 = Math.floor(pm2.home.z)
    const at2 = (x, y, z) => bm.getBlockAt(hx2 + x, 186 + y, hz2 + z)
    out.base = D2.mapId === 'militaryBase' && at2(-23, 4, -22) === 'ladder' && at2(9, 1, -23) === 'grayconcretestairs' && at2(-34, 9, -28) !== undefined
    out.baseSpecials = bm.specials.entryAt(hx2 + 30, 187, hz2 - 14)?.def.id === 'teleporterpad' && bm.specials.entryAt(hx2 + 22, 187, hz2 + 34)?.def.id === 'jumppad'
    let missing = 0
    for (const key of D2._arenaKeys) {
      const [x, y, z] = key.split(',').map(Number)
      if (bm.getBlockAt(x, y, z) !== s2._placed.get(key)) missing++
    }
    out.baseAllPlaced = missing === 0
    out.baseSpawns = D2.map.spawns.every(([x, z, h]) => s2._solid(hx2 + x, 186 + h, hz2 + z) && !s2._solid(hx2 + x, 187 + h, hz2 + z) && !s2._solid(hx2 + x, 188 + h, hz2 + z))
    s2.stop?.()
    g._exitBuildMode?.()
    g.settings.dmMap = 'smallTown'
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Docks (2026-11-16): the third Deathmatch map - picked from Game Mode >
// Deathmatch; the sea along the east (water, not void), the ship you walk
// onto, the cranes and the warehouse catwalk; every spawn has room.
test('Deathmatch: Docks map, sea, ship, cranes, warehouse', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    document.getElementById('dm-map-docks').click()
    out.picked = g.settings.dmMap === 'docks' && document.getElementById('dm-map-docks').classList.contains('active') && document.getElementById('dm-map-docks').textContent === 'Docks'
    localStorage.removeItem('gayz-play-saved-run')
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    const pm = s.party
    const D = pm.ext
    const t0 = performance.now()
    pm.update(0.05)
    out.buildMs = Math.round(performance.now() - t0)
    pm.update(0.05)
    out.named = D.mapId === 'docks' && D.mapName() === 'Docks' && pm.snapshot().x.mp === 'docks'
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const bm = s.bm
    const at = (x, y, z) => bm.getBlockAt(hx + x, 186 + y, hz + z)
    // The sea: water over sand past the yellow quay line, a quay wall.
    out.sea = at(24, -1, 20) === 'water' && at(24, -3, 20) === 'sand' && !at(24, 0, 20) && at(22, 0, 20) === 'yellowconcrete' && at(22, -2, 20) === 'stonebricks' && at(23, 0, 18) === 'ladder'
    // The ship: deck, gangway stairs, a hold under it, the bridge ladder.
    out.ship = at(29, 2, -10) === 'spruceplanks' && at(25, 2, -6) === 'spruceplanksstairs' && !at(29, 0, -10) && at(29, -3, -10) === 'blackconcrete' && at(27, 0, -11) === 'ladder' && at(30, 5, 12) === 'ladder'
    // A crane's ladder and boom, the warehouse catwalk and its stairs.
    out.cranes = at(13, 10, -15) === 'ladder' && at(30, 14, -12) === 'metal' && at(30, 14, 19) === 'metal'
    out.warehouse = at(-20, 5, 0) === 'spruceplanks' && at(-15, 5, 2) === 'spruceplanksstairs' && at(-35, 3, 20) === 'ladder' && at(-36, 4, 5) === 'brick'
    out.specials = bm.specials.entryAt(hx - 30, 187, hz - 14)?.def.id === 'teleporterpad' && bm.specials.entryAt(hx - 4, 187, hz - 32)?.def.id === 'jumppad'
    let missing = 0
    for (const key of D._arenaKeys) {
      const [x, y, z] = key.split(',').map(Number)
      if (bm.getBlockAt(x, y, z) !== s._placed.get(key)) missing++
    }
    out.allPlaced = missing === 0
    out.spawns = D.map.spawns.every(([x, z, h]) => s._solid(hx + x, 186 + h, hz + z) && !s._solid(hx + x, 187 + h, hz + z) && !s._solid(hx + x, 188 + h, hz + z))
    s.stop?.()
    g._exitBuildMode?.()
    g.settings.dmMap = 'smallTown'
    return out
  })
  console.log('docks build ms', r.buildMs)
  delete r.buildMs
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Team Deathmatch (2026-11-16): Red against Blue, 2v2 / 4v4 / Custom,
// bots fill both teams, no team damage, team kills win.
test('Team Deathmatch: size picker, even teams, no team damage, team wins', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    // The size row on Game Mode > Deathmatch: 4v4, then Custom 3, then 2v2.
    const btn = (v) => document.querySelector(`#tdm-size-row [data-tdm-size="${v}"]`)
    btn('4').click()
    out.pick4 = g.settings.tdmSize === 4 && g.settings.selectedGameMode === 'teamDeathmatch' && btn('4').classList.contains('active')
    btn('custom').click()
    const box = document.getElementById('tdm-size-input')
    box.value = '9'
    box.dispatchEvent(new Event('change'))
    out.customClamped = !box.hidden && g.settings.tdmSize === 4 && btn('custom').classList.contains('active')
    box.value = '3'
    box.dispatchEvent(new Event('change'))
    out.custom3 = g.settings.tdmSize === 3
    btn('2').click()
    out.pick2 = g.settings.tdmSize === 2 && box.hidden
    localStorage.removeItem('gayz-play-saved-run')
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pm = s.party
    const D = pm.ext
    out.endlessAmmo = s.reserve === Infinity
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    pm.update(0.05)
    const me = pm.myId
    const count = () => { const n = { r: 0, b: 0 }; for (const p of pm._people()) n[pm.teams.get(p.id)]++; return n }
    let n = count()
    out.twoVsTwo = pm.phase === 'play' && pm.bots.size === 3 && n.r === 2 && n.b === 2 && D.hp.size === 4
    // My side of the arena: Red west, Blue east.
    const dx = s.bm.tryMode.pos.x - pm.home.x
    out.mySide = pm.myTeam === 'r' ? dx < 0 : dx > 0
    const mate = [...pm.bots.keys()].find((id) => pm.teams.get(id) === pm.myTeam)
    const foe = [...pm.bots.keys()].find((id) => pm.teams.get(id) !== pm.myTeam)
    out.markColors = D.markColor(mate) === D.markColor(me) && D.markColor(foe) !== D.markColor(me)
    // No team damage; an enemy kill counts for my team.
    D.prot.clear()
    D._hit(mate, 50, me)
    out.noTeamDamage = D.hp.get(mate) === 100
    D._hit(foe, 100, me)
    pm.update(0.05)
    out.teamKill = pm.score[pm.myTeam] === 1 && D.kills[me] === 1 && D.deaths[foe] === 1 && pm.hudText().includes(pm.myTeam === 'r' ? 'Red 1 - 0 Blue' : 'Red 0 - 1 Blue')
    // A real player joining takes a bot's place and teams stay even.
    const realPeople = pm._people
    pm._people = function () {
      const list = realPeople.call(this)
      return [...list, { id: 'Guest1', x: list[0].x, y: list[0].y, z: list[0].z }]
    }
    pm.update(0.05)
    n = count()
    out.joinEven = pm.bots.size === 2 && n.r === 2 && n.b === 2 && pm.teams.has('Guest1')
    pm._people = realPeople
    pm.update(0.05)
    // The host's sync carries size, kills and teams.
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    const copy = new D.constructor(pm)
    copy.size = 4
    copy.apply(snap.x)
    out.snap = copy.size === 2 && copy.kills[me] === 1
    copy.dispose()
    // Time's up: the team with more kills wins.
    pm.score = { r: 3, b: 7 }
    pm.left = 0.01
    pm.update(0.05)
    out.teamWins = pm.phase === 'end' && pm.winner === 'b' && pm._won() === (pm.myTeam === 'b') && document.getElementById('dm-board')?.classList.contains('on')
    out.boardTitle = document.querySelector('#dm-board h3')?.textContent === 'Red 3 - 7 Blue'
    s.stop?.()
    g._exitBuildMode?.()
    await new Promise((res) => setTimeout(res, 200))
    out.cleanedUp = !document.getElementById('dm-feed')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Deathmatch fixes (2026-11-16): the maps' stairs show straight away (a
// bulk build left their bounds stale, so they were culled), no random
// disasters in an arena and a shake always dies down, bots' names have no
// "(bot)", and every map grew to 121 x 121 with an outer ring of places.
test('Deathmatch: stairs show, no stuck shake, plain bot names, bigger maps', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'deathmatch'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pm = s.party
    const D = pm.ext
    pm.update(0.05)
    pm.update(0.05)
    const bm = s.bm
    const B = s.B
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    const at = (x, y, z) => bm.getBlockAt(hx + x, 186 + y, hz + z)
    // Every stair in the arena sits inside its mesh's bounds once drawn.
    bm._flushBounds()
    const THREE = bm.camera.position.constructor
    let stairs = 0
    let outside = 0
    for (const [type, mesh] of Object.entries(bm._instancedMeshes)) {
      if (!type.endsWith('stairs') || !mesh.count) continue
      const keys = bm._instanceKeyByIndex[type] || []
      for (let i = 0; i < mesh.count; i++) {
        const [x, y, z] = String(keys[i]).split(',').map(Number)
        if (y < 186) continue
        stairs++
        const c = new THREE((x + 0.5) * B, (y + 0.5) * B, (z + 0.5) * B)
        if (!mesh.boundingSphere || mesh.boundingSphere.distanceToPoint(c) > 0.01) outside++
      }
    }
    out.stairsInBounds = stairs > 100 && outside === 0
    // No disaster rolls in an arena; a leftover shake fades on its own.
    const dis = bm.sky.disasters
    out.noDisasters = dis.inGame() === false
    dis.shake = 0.05
    for (let i = 0; i < 60; i++) dis.update(1 / 30, bm.camera)
    out.shakeFades = dis.shake === 0
    // The kill cam holds the camera: third person can't pull it away.
    bm.tryMode.view = 1
    bm.tryMode.camHeld = true
    out.camHeld = bm.tryMode.applyView() === null
    bm.tryMode.camHeld = false
    bm.tryMode.view = 0
    // Bot name tags are just the name.
    const tags = []
    for (const b of pm.bots.values()) b.group.traverse((o) => { if (o.userData?.text) tags.push(o.userData.text) })
    const names = [...pm.bots.values()].map((b) => pm._name(b.id))
    out.plainNames = names.length === 7 && names.every((n) => !/bot/i.test(n)) && tags.every((t) => !/\(bot\)/i.test(t))
    // 121 x 121: Small Town's ring road and outer places.
    out.townRing = D.map.half === 60 && at(43, 0, 10) === 'asphalt' && at(-49, 12, -28) === 'grayconcrete' && at(-22, 1, -50) === 'oakslab' && !!at(9, 1, -51) && at(50, 0, -32) === 'water'
    // Military Base: the plane you walk through, the control tower.
    D.mapId = 'militaryBase'
    D.draw()
    out.baseRing = !at(-5, 2, -49) && !at(-5, 3, -49) && at(-5, 1, -49) === 'lightgrayconcrete' && at(-5, 2, -45) === 'lightgrayconcrete' && at(34, 10, -52) === 'grayconcrete' && at(-40, 3, 47) === 'greenwool' && at(36, 12, -50) === 'metal'
    out.tagsSeen = tags.length === 7
    // Docks: the sea fort out on its island, reached by the long pier.
    D.mapId = 'docks'
    D.draw()
    out.docksRing = at(43, 0, 15) === 'oakplanks' && at(45, 0, 0) === 'sand' && at(52, 2, 0) === 'stonebricks' && !at(43, 1, 8) && at(-49, 3, -38) === 'coalblock'
    const sp = D.map.spawns
    out.spawnsOpen = sp.every(([x, z, y]) => !at(x, y + 1, z) && !at(x, y + 2, z) && !!at(x, y, z))
    s.stop?.()
    g._exitBuildMode?.()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

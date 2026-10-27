import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The special blocks (SpecialBlocks.js / BuildSpecials.js): each batch's
// blocks placed in a real map and their effects checked while playing.

// Every check below runs inside the page: enter the editor, place a
// Player Start and a far-away spawner, then the batch's blocks.
test('special blocks batch 1: bell, repeller, bait, spikes, barricade, campfire, teleporter, crops, disco, scoreboard', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    const out = {}
    const ids = ['alarmbell', 'zombierepeller', 'baitblock', 'spikeblock', 'reinforcedbarricade', 'campfire', 'teleporterpad', 'cropplot', 'discoblock', 'scoreboard']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).game && bm.blockIcon(id).startsWith('data:'))
    out.noSlabs = ids.every((id) => !bm.isBlockType(`${id}slab`) && !bm.isBlockType(`${id}stairs`))
    out.unbreakable = ids.every((id) => bm.breakSeconds(id) === Infinity)
    bm.placeBlock(20, 0, 0, 'alarmbell')
    bm.placeBlock(-20, 0, 0, 'zombierepeller')
    bm.placeBlock(0, 0, -30, 'baitblock')
    bm.placeBlock(30, 0, 30, 'spikeblock')
    bm.placeBlock(-30, 0, 30, 'reinforcedbarricade')
    bm.placeBlock(3, 0, 3, 'campfire')
    bm.placeBlock(5, 0, 0, 'teleporterpad', false, { facing: 0 })
    bm.placeBlock(-5, 0, -5, 'teleporterpad', false, { facing: 0 })
    bm.placeBlock(2, 0, -3, 'cropplot')
    bm.placeBlock(-2, 0, 3, 'discoblock')
    bm.placeBlock(-3, 0, -2, 'scoreboard')
    out.indexed = ids.every((id) => [...bm.specials._at.values()].some((e) => e.type === id))
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    out.running = sp.active
    const zombie = (x, z) => s._makeZombie(`t${Math.random()}`, x, 0, z, 1000, false)
    const target = { x: 0, y: 0, z: 0 }

    // Alarm Bell: rung, it pulls a zombie 30 blocks away.
    const zb = zombie(10, 10)
    out.bellIdle = sp.zombieTarget(zb, target) === null
    out.bellUsed = sp.use(20, 0, 0)
    const bt = sp.zombieTarget(zb, target)
    out.bellPulls = !!bt && bt.x === 20.5 && bt.lure && bt.idle
    out.bellCooldown = sp.use(20, 0, 0) && sp._st.get('20,0,0').cdUntil > sp._time

    // Zombie Repeller: a zombie 2 blocks off is pushed out of the ring.
    const zr = zombie(-18, 0)
    for (let i = 0; i < 40; i++) sp.zombieTick(zr, 0.05)
    out.repelled = Math.hypot(zr.x + 19.5, zr.z - 0.5) >= 4.9

    // The bell's 15 seconds are over.
    sp._st.get('20,0,0').until = 0
    // Bait: always pulls a zombie within 14 blocks (unless right next to you).
    const zbait = zombie(0, -20)
    const bait = sp.zombieTarget(zbait, { x: 0, y: 0, z: 0 })
    out.bait = !!bait && bait.z === -29.5
    out.baitNotWhenClose = sp.zombieTarget(zbait, { x: 0, y: 0, z: -21 }) === null

    // Spikes: a zombie standing on top loses health.
    const zs = zombie(30.5, 30.5)
    zs.y = 1
    const hp = zs.health
    sp.zombieTick(zs, 1)
    out.spikes = zs.health <= hp - 24

    // Barricade: a zombie against it is shoved away.
    const zbar = zombie(-29.5, 31.3)
    const before = zbar.z
    sp.zombieTick(zbar, 0.2)
    out.shoved = zbar.z > before

    // Campfire: heals you nearby; burns a zombie that touches it.
    s.health = 50
    for (let i = 0; i < 10; i++) sp.update(0.1, { x: 3.5, y: 0, z: 1.5 })
    out.healed = s.health > 53 && s.health <= 54.01
    const zc = zombie(3.5, 4.3)
    sp.zombieTick(zc, 0.05)
    out.burns = zc.burn > 0

    // Teleporter: stepping onto one pad sends you to the other.
    const tm = bm.tryMode
    tm.pos.set(5.5, 0.07, 0.5)
    sp._onPadKey = null
    sp._padCd = 0
    sp.update(0.05, tm.pos)
    out.teleported = Math.floor(tm.pos.x) === -5 && Math.floor(tm.pos.z) === -5
    // Standing on the arrival pad doesn't bounce you back.
    sp.update(0.05, tm.pos)
    out.noBounce = Math.floor(tm.pos.x) === -5

    // Crop Plot: plant, wait, harvest vegetables.
    out.planted = sp.use(2, 0, -3) && sp._st.get('2,0,-3').plantedAt !== undefined
    sp._time += 46
    const veggies = () => [...s.inv.hotbar, ...s.inv.grid].filter((it) => it?.id === 'veggies').reduce((n, it) => n + it.n, 0)
    const before2 = veggies()
    sp.use(2, 0, -3)
    const after2 = veggies()
    out.harvested = after2 === before2 + 2

    // Disco and Scoreboard draw their looks nearby.
    sp._overlaysDirty = true
    sp.update(0.05, { x: 0, y: 0, z: 0 })
    const disco = sp._overlays.get('-2,0,3')
    out.disco = !!disco && disco.material.color.getHex() !== 0xffffff
    const board = sp._overlays.get('-3,0,-2')
    out.score = !!board && /1|Wave/.test(board.userData.text || '')

    // Leaving Play clears the looks; removing a block drops it from the index.
    s.stop()
    out.stopped = !sp.active && sp._group === null
    bm.removeBlock(20, 0, 0)
    out.unindexed = !sp._at.has('20,0,0')
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, noSlabs: true, unbreakable: true, indexed: true, running: true,
    bellIdle: true, bellUsed: true, bellPulls: true, bellCooldown: true,
    repelled: true, bait: true, baitNotWhenClose: true, spikes: true, shoved: true,
    healed: true, burns: true, teleported: true, noBounce: true,
    planted: true, harvested: true, disco: true, score: true, stopped: true, unindexed: true,
  })
})

test('special blocks batch 2: siren, tripwire, wind chime, doorbell, megaphone, radio, echo, silence, horn, piano', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['sirentower', 'tripwirechime', 'windchime', 'doorbell', 'megaphone', 'radioblock', 'echostone', 'silenceblock', 'hornblock', 'pianoblock']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    bm.placeBlock(40, 0, 0, 'sirentower')
    bm.placeBlock(-20, 0, 20, 'tripwirechime')
    bm.placeBlock(4, 0, 4, 'windchime')
    bm.placeBlock(10, 0, -10, 'doorbell')
    bm.placeBlock(12, 0, -10, 'oakdoor')
    bm.placeBlock(-10, 0, -10, 'megaphone')
    bm.placeBlock(-4, 0, 4, 'radioblock')
    bm.placeBlock(3, 0, -3, 'echostone')
    bm.placeBlock(-40, 0, -40, 'silenceblock')
    bm.placeBlock(25, 0, 25, 'hornblock')
    bm.placeBlock(2, 0, 2, 'pianoblock')
    bm.placeBlock(3, 0, 2, 'pianoblock')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, z) => s._makeZombie(`t${Math.random()}`, x, 0, z, 1000, false)
    const me = { x: 0, y: 0, z: 0 }

    // Siren: reaches much further than the bell.
    const zf = zombie(-30, 0)
    sp.use(40, 0, 0)
    out.siren = sp._lastSound === 'siren' && sp.zombieTarget(zf, me)?.x === 40.5
    sp._st.get('40,0,0').until = 0

    // Tripwire: a zombie walking by sets it off (once, then it waits).
    const zt = zombie(-19, 21)
    sp._lastSound = null
    sp.update(0.05, me)
    out.tripwire = sp._lastSound === 'chime' && sp._st.get('-20,0,20').cdUntil > sp._time
    s._removeZombie?.(zt)
    if (s.zombies.includes(zt)) s.zombies.splice(s.zombies.indexOf(zt), 1)

    // Wind chime: rattles a warning with a zombie close by.
    sp._lastSound = null
    const zw = zombie(8, 8)
    sp.update(0.05, { x: 4, y: 0, z: 2 })
    out.windWarn = sp._lastSound === 'warn'
    s.zombies.splice(s.zombies.indexOf(zw), 1)

    // Doorbell: rings and opens the door next to it, then it shuts.
    sp.use(10, 0, -10)
    out.doorOpens = sp._lastSound === 'dingdong' && bm._doorState.get('12,0,-10')?.open === true
    sp._time += 4
    sp.update(0.05, me)
    out.doorShuts = bm._doorState.get('12,0,-10')?.open === false

    // Megaphone: lures nearby zombies and shows HEY! over it.
    const zm = zombie(-15, -15)
    sp.use(-10, 0, -10)
    out.megaphone = sp.zombieTarget(zm, me)?.x === -9.5
    sp._overlaysDirty = true
    sp.update(0.05, me)
    out.hey = sp._overlays.get('-10,0,-10')?.visible === true
    sp._st.get('-10,0,-10').until = 0

    // Radio: station 1, 2, 3, off - and it plays while on.
    sp.use(-4, 0, 4)
    sp._lastSound = null
    sp.update(0.05, me)
    out.radioPlays = sp._lastSound === 'radio1'
    sp.use(-4, 0, 4); sp.use(-4, 0, 4); sp.use(-4, 0, 4)
    out.radioOff = sp._st.get('-4,0,4').station === 0

    // Echo Stone: a shot near it echoes and pulls zombies to it.
    const ze = zombie(10, -3)
    sp.onShot({ x: 1, y: 0, z: -1 })
    sp._time += 0.6
    sp.update(0.05, me)
    out.echo = sp._lastSound === 'echo' && sp.zombieTarget(ze, me)?.x === 3.5

    // Silence: standing by it, a far zombie loses you; a near one doesn't.
    sp._st.get('3,0,-3').until = 0
    const quiet = { x: -39.5, y: 0, z: -38 }
    const far = zombie(-10, -40)
    const near = zombie(-37, -38)
    const ft = sp.zombieTarget(far, quiet)
    out.silenceFar = !!ft && ft.x === far.x && ft.idle
    out.silenceNear = sp.zombieTarget(near, quiet) === null

    // Horn: blows a nearby zombie back.
    const zh = zombie(27.5, 25.5)
    sp.use(25, 0, 25)
    for (let i = 0; i < 10; i++) sp.zombieTick(zh, 0.05)
    out.horn = sp._lastSound === 'honk' && zh.x > 31

    // Piano: two keys side by side play different notes when stepped on.
    const tm = bm.tryMode
    tm.onGround = true
    sp.update(0.05, { x: 2.5, y: 1, z: 2.5 })
    const n1 = sp._lastSound
    sp.update(0.05, { x: 3.5, y: 1, z: 2.5 })
    const n2 = sp._lastSound
    out.piano = /^note/.test(n1) && /^note/.test(n2) && n1 !== n2
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, siren: true, tripwire: true, windWarn: true, doorOpens: true, doorShuts: true,
    megaphone: true, hey: true, radioPlays: true, radioOff: true, echo: true,
    silenceFar: true, silenceNear: true, horn: true, piano: true,
  })
})

test('special blocks batch 3: garlic, holy lantern, cage, counter, fake player, grave, cleanser, wave bell, cursed, time slow', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['garlicblock', 'holylantern', 'cageblock', 'zombiecounter', 'fakeplayer', 'graveblock', 'infectioncleanser', 'wavebell', 'cursedblock', 'timeslow']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    const at = { garlicblock: [20, 0], holylantern: [-20, 0], cageblock: [0, 20], zombiecounter: [3, 3], fakeplayer: [0, -40], graveblock: [-30, -30], infectioncleanser: [2, -2], wavebell: [-2, 2], cursedblock: [30, 30], timeslow: [-30, 30] }
    for (const [id, [x, z]] of Object.entries(at)) bm.placeBlock(x, 0, z, id)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, z) => s._makeZombie(`t${Math.random()}`, x, 0, z, 1000, false)
    const me = { x: 0, y: 0, z: 0 }
    const near = (id, dx = 1.5, dz = 0.5) => zombie(at[id][0] + dx, at[id][1] + dz)

    out.garlic = sp.zombieTick(near('garlicblock'), 0.05) === 0.5
    const zl = near('holylantern')
    sp.zombieTick(zl, 1)
    out.lantern = zl.health <= 994.01
    // Cage: holds the first zombie, then resets.
    const zc = zombie(0.5, 21.3)
    sp.zombieTick(zc, 0.05)
    out.caged = zc._held > 5 && sp.zombieTick(zc, 0.05) === 0
    const zc2 = zombie(0.5, 21.3)
    sp.zombieTick(zc2, 0.05)
    out.cageResets = !(zc2._held > 0)
    // Counter: says how many zombies are near it.
    s.zombies.length = 0
    zombie(5, 5); zombie(6, 6)
    sp._overlaysDirty = true
    sp.update(0.05, me)
    out.counter = /2/.test(sp._overlays.get('3,0,3')?.userData.text || '')
    s.zombies.length = 0
    // Fake Player lures.
    out.fake = sp.zombieTarget(zombie(0, -30), me)?.z === -39.5
    // Grave: at night a zombie climbs out on top of it.
    s.zombies.length = 0
    bm.sky.nightAmount = () => 1
    sp._state(sp.entryAt(-30, 0, -30)).next = 0
    sp.update(0.05, me)
    out.grave = s.zombies.some((zb) => Math.floor(zb.x) === -30 && Math.floor(zb.z) === -30 && zb.y >= 1)
    s.zombies.length = 0
    // Cleanser: no damage while protected.
    s.health = 50
    sp.use(2, 0, -2)
    s._hurtPlayer(20)
    out.shielded = s.health === 50
    sp._time += 9
    s._hurtPlayer(20)
    out.shieldEnds = s.health < 50
    // Wave Bell: only between waves; starts the next one early with coins.
    s._toSpawn = 3
    sp.use(-2, 0, 2)
    out.waveBusy = s._toSpawn === 3
    s._toSpawn = 0
    s._breakTimer = 5
    const coins = s.coins ?? s.runCoins ?? 0
    sp.use(-2, 0, 2)
    out.waveEarly = s._breakTimer < 0.1
    // Cursed: tougher zombies that pay extra.
    const zx = near('cursedblock')
    sp.zombieTick(zx, 0.05)
    out.cursed = zx.cursed === 2 && zx.health === 1500
    // Time Slow.
    out.timeSlow = sp.zombieTick(near('timeslow'), 0.05) === 0.4
    void coins
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, garlic: true, lantern: true, caged: true, cageResets: true, counter: true, fake: true,
    grave: true, shielded: true, shieldEnds: true, waveBusy: true, waveEarly: true, cursed: true, timeSlow: true,
  })
})

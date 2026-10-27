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

test('special blocks batch 4: bear trap, trapdoor pit, fire trap, sticky floor, blade, mine, net, crumble, ice, flame jet', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['beartrap', 'trapdoorpit', 'firetrap', 'stickyfloor', 'swingingblade', 'landmine', 'netlauncher', 'crumbleblock', 'iceslick', 'flamejet']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    const at = { beartrap: [20, 0], trapdoorpit: [-20, 0], firetrap: [0, 20], stickyfloor: [0, -20], swingingblade: [20, 20], landmine: [-20, -20], netlauncher: [-20, 20], crumbleblock: [5, 5], iceslick: [20, -20], flamejet: [-5, 5] }
    for (const [id, [x, z]] of Object.entries(at)) bm.placeBlock(x, 0, z, id, false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, y, z) => s._makeZombie(`t${Math.random()}`, x, y, z, 1000, false)
    const on = (id, y = 1) => zombie(at[id][0] + 0.5, y, at[id][1] + 0.5)
    const me = { x: 0, y: 0, z: 0 }

    const zb = on('beartrap', 0)
    sp.zombieTick(zb, 0.05)
    out.bear = zb.health === 980 && zb._held > 4 && sp.zombieTick(zb, 0.05) === 0
    const zp = on('trapdoorpit')
    sp.zombieTick(zp, 0.05)
    out.pit = zp.health === 940
    const zf = zombie(0.5, 0, 21.3)
    sp.zombieTick(zf, 0.05)
    out.fire = zf.burn > 5
    out.sticky = sp.zombieTick(on('stickyfloor'), 0.05) === 0.3
    // Blade: hits zombies close to it once a swing.
    const zs = zombie(21.5, 0, 20.5)
    sp._state(sp.entryAt(20, 0, 20)).next = 0
    sp.update(0.05, me)
    out.blade = zs.health === 970
    // Mine: hurts every zombie around it.
    const zm1 = on('landmine', 0)
    const zm2 = zombie(-18, 0, -20)
    sp.zombieTick(zm1, 0.05)
    out.mine = zm1.health === 920 && zm2.health === 920 && sp._lastSound === 'explosion'
    // Net: catches the nearest zombie.
    s.zombies.length = 0
    const zn = zombie(-15, 0, 20.5)
    sp.update(0.05, me)
    out.net = zn._held > 2
    s.zombies.length = 0
    // Ice: zombies fall over; slippery for you.
    const zi = on('iceslick')
    sp.zombieTick(zi, 0.05)
    out.iceZombie = zi._held > 1
    const tm = bm.tryMode
    tm.onGround = true
    sp.update(0.05, { x: 20.5, y: 1, z: -19.5 })
    out.iceYou = sp.gripMult < 0.2
    sp.update(0.05, { x: 0.5, y: 1, z: -19.5 })
    out.stickyYou = sp.speedMult === 0.5
    // Crumble: gone after a moment of standing on it, back later.
    for (let i = 0; i < 10; i++) sp.update(0.1, { x: 5.5, y: 1, z: 5.5 })
    out.crumbled = bm.getBlockAt(5, 0, 5) === null
    sp._time += 6
    sp.update(0.05, { x: 0, y: 0, z: 0 })
    out.crumbleBack = bm.getBlockAt(5, 0, 5) === 'crumbleblock'
    // Flame Jet: burns zombies on it while firing.
    const zj = on('flamejet')
    let burnt = false
    for (let i = 0; i < 40 && !burnt; i++) {
      sp._time += 0.1
      sp.zombieTick(zj, 0.01)
      burnt = zj.burn > 0
    }
    out.flamejet = burnt
    // Leaving puts a fallen crumble block back too.
    for (let i = 0; i < 10; i++) sp.update(0.1, { x: 5.5, y: 1, z: 5.5 })
    s.stop()
    out.restoredOnStop = bm.getBlockAt(5, 0, 5) === 'crumbleblock'
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, bear: true, pit: true, fire: true, sticky: true, blade: true, mine: true, net: true,
    iceZombie: true, iceYou: true, stickyYou: true, crumbled: true, crumbleBack: true, flamejet: true, restoredOnStop: true,
  })
})

test('special blocks batch 5: smoke, sound trap, shield, barbed wire, sandbag, watchtower, oil pot, cannon, catapult, murder hole', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['smokebomb', 'soundtrap', 'shieldgen', 'barbedwire', 'sandbag', 'watchtower', 'oilpot', 'cannonblock', 'catapult', 'murderhole']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    const at = { smokebomb: [-40, -40], soundtrap: [-40, 40], shieldgen: [40, 40], barbedwire: [10, 10], sandbag: [2, 0], watchtower: [-5, -5], oilpot: [40, -40], cannonblock: [20, 0], catapult: [0, -20], murderhole: [0, 5] }
    for (const [id, [x, z]] of Object.entries(at)) bm.placeBlock(x, 0, z, id)
    for (let y = 1; y <= 4; y++) bm.placeBlock(-5, y, -5, 'stone')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, z, y = 0) => s._makeZombie(`t${Math.random()}`, x, y, z, 1000, false)
    const tm = bm.tryMode
    // A trap ignores the Use key (its timer isn't touched).
    out.trapIgnoresUse = sp.use(-40, 0, 40) === false
    // Smoke: you inside the cloud, a zombie outside loses you.
    sp.use(-40, 0, -40)
    const inSmoke = { x: -39.5, y: 0, z: -38 }
    const zo = zombie(-20, -40)
    out.smoke = sp.zombieTarget(zo, inSmoke)?.x === zo.x
    // Sound Trap: pulls zombies in and cages the first.
    const zt = zombie(-40.5, 30)
    out.soundLure = sp.zombieTarget(zt, { x: 0, y: 0, z: 0 })?.z === 40.5
    const zt2 = zombie(-39.5, 41.3)
    sp.zombieTick(zt2, 0.05)
    out.soundCage = zt2._held > 3
    // Shield Generator: a zombie inside the bubble is pushed out.
    sp.use(40, 0, 40)
    const zsh = zombie(41.5, 40.5)
    for (let i = 0; i < 40; i++) sp.zombieTick(zsh, 0.05)
    out.shield = Math.hypot(zsh.x - 40.5, zsh.z - 40.5) >= 3.9
    // Barbed wire slows and hurts.
    const zw = zombie(10.5, 11.3)
    out.wireSlow = sp.zombieTick(zw, 1) === 0.6 && zw.health <= 995.01
    // Sandbag: crouching by it takes less damage.
    tm.pos.set(3.5, 0, 0.5)
    tm._crouch = true
    s.health = 100
    s._hurtPlayer(10)
    out.sandbag = Math.abs(s.health - 94) < 0.01
    tm._crouch = false
    // Watchtower: up to the top of the stack.
    sp.use(-5, 0, -5)
    out.watchtower = Math.floor(tm.pos.y) === 5 && Math.floor(tm.pos.x) === -5
    // Oil pot: zombies below/around it burn.
    const zoil = zombie(42, -40)
    sp.use(40, 0, -40)
    out.oil = zoil.health === 940 && zoil.burn > 0
    // Cannon: fires away from you along a line.
    tm.pos.set(18.5, 0, 0.5)
    const zc1 = zombie(30.5, 0.5)
    const zc2 = zombie(30.5, 6)
    sp.use(20, 0, 0)
    out.cannon = zc1.health === 900 && zc2.health === 1000
    // Catapult: the boulder lands 20 blocks out.
    tm.pos.set(0.5, 0, -18.5)
    const zk = zombie(0.5, -39.5)
    sp.use(0, 0, -20)
    out.catapult = zk.health === 920
    // Murder Hole: bullets fly through it.
    const B = bm._chunks.blockSize
    bm.camera.position.set(0.5 * B, 0.5 * B, 8 * B)
    bm.camera.lookAt(0.5 * B, 0.5 * B, 0)
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const plain = bm._raycastGridAligned()
    const shot = bm._raycastGridAligned(new Set(['murderhole']))
    out.murderHole = plain?.existingBlock[2] === 5 && (!shot || shot.existingBlock[2] !== 5)
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, trapIgnoresUse: true, smoke: true, soundLure: true, soundCage: true, shield: true, wireSlow: true, sandbag: true,
    watchtower: true, oil: true, cannon: true, catapult: true, murderHole: true,
  })
})

test('special blocks batch 6: generator, solar, wire, battery, button, timer, motion, light sensor, logic gate, arrow shooter', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['generator', 'solarpanel', 'wireblock', 'battery', 'buttonblock', 'timerblock', 'motionsensor', 'lightsensor', 'logicgate', 'arrowshooter']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    // A generator, a line of 12 wires and an arrow shooter at the far end.
    bm.placeBlock(40, 0, 0, 'generator')
    for (let i = 1; i <= 12; i++) bm.placeBlock(40 + i, 0, 0, 'wireblock')
    bm.placeBlock(60, 0, 0, 'arrowshooter')
    bm.placeBlock(40, 0, 3, 'oakdoor')
    bm.placeBlock(-40, 0, 0, 'battery')
    bm.placeBlock(-42, 0, 0, 'buttonblock')
    bm.placeBlock(0, 0, 40, 'timerblock')
    bm.placeBlock(0, 0, -40, 'motionsensor')
    bm.placeBlock(-40, 0, 40, 'lightsensor')
    bm.placeBlock(40, 0, 40, 'solarpanel')
    bm.placeBlock(-40, 0, -40, 'logicgate')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, z) => s._makeZombie(`t${Math.random()}`, x, 0, z, 1000, false)
    const me = { x: 0, y: 0, z: 0 }
    const tick = (secs = 0.15) => { sp._time += secs; sp.update(0.01, me) }
    const on = (x, y, z) => sp._on.has(`${x},${y},${z}`)
    // Generator: off until used; on, it powers the wire line to the shooter and opens the door.
    tick()
    const shooter = sp.entryAt(60, 0, 0)
    out.offAtFirst = !on(40, 0, 0) && !sp.powered(shooter)
    sp.use(40, 0, 0)
    tick()
    out.genOn = on(40, 0, 0) && on(52, 0, 0) && sp.powered(shooter)
    out.doorOpened = bm._doorState.get('40,0,3')?.open === true
    // The shooter hits a zombie it can see.
    const za = zombie(66.5, 0.5)
    sp._state(shooter).next = 0
    tick()
    out.shot = za.health === 985 && sp._lastSound === 'twang'
    // ...but not one behind a wall.
    for (let y = 0; y < 3; y++) for (let z = -2; z <= 2; z++) bm.placeBlock(63, y, z, 'stone')
    za.health = 1000
    sp._state(shooter).next = 0
    tick()
    out.wallBlocks = za.health === 1000
    sp.use(40, 0, 0)
    tick()
    out.genOff = !on(40, 0, 0) && !on(45, 0, 0)
    // Button: a short burst that charges the battery, which then holds.
    sp.use(-42, 0, 0)
    tick()
    out.button = on(-42, 0, 0) && on(-40, 0, 0)
    tick(2)
    out.batteryHolds = !on(-42, 0, 0) && on(-40, 0, 0)
    tick(31)
    tick(0.15)
    out.batteryEmpty = !on(-40, 0, 0)
    // Timer pulses on its own.
    let pulses = 0
    let was = false
    for (let i = 0; i < 80; i++) { tick(0.15); const now = on(0, 0, 40); if (now && !was) pulses++; was = now }
    out.timer = pulses >= 2
    // Motion sensor: on with you near it.
    sp._time += 0.2
    sp.update(0.01, { x: 0.5, y: 0, z: -38 })
    out.motion = on(0, 0, -40)
    // Light sensor / solar panel: night vs day.
    bm.sky.nightAmount = () => 1
    tick()
    out.night = on(-40, 0, 40) && !on(40, 0, 40)
    bm.sky.nightAmount = () => 0
    tick()
    out.day = !on(-40, 0, 40) && on(40, 0, 40)
    // Logic gate: NOT is on with nothing near; AND needs two.
    sp.use(-40, 0, -40) // OR
    sp.use(-40, 0, -40) // NOT
    tick()
    out.gateNot = on(-40, 0, -40)
    sp.use(-40, 0, -40) // AND
    bm.placeBlock(-38, 0, -40, 'generator')
    bm.placeBlock(-42, 0, -40, 'generator')
    sp.use(-38, 0, -40)
    tick()
    const one = on(-40, 0, -40)
    sp.use(-42, 0, -40)
    tick()
    out.gateAnd = !one && on(-40, 0, -40)
    s.stop()
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, offAtFirst: true, genOn: true, doorOpened: true, shot: true, wallBlocks: true, genOff: true,
    button: true, batteryHolds: true, batteryEmpty: true, timer: true, motion: true, night: true, day: true, gateNot: true, gateAnd: true,
  })
})

test('special blocks batch 7: electric fence, turret, searchlight, repair, gate, pistons, conveyor, fan, magnet', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['electricfence', 'autoturret', 'searchlight', 'repairstation', 'gateblock', 'piston', 'stickypiston', 'conveyorbelt', 'fanpusher', 'magnetblock']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    // One powered corner: a generator with a fence, searchlight and fan pusher near it.
    bm.placeBlock(40, 0, 0, 'generator')
    bm.placeBlock(43, 0, 0, 'electricfence')
    bm.placeBlock(40, 0, 4, 'searchlight')
    bm.placeBlock(36, 0, 0, 'fanpusher')
    bm.placeBlock(-40, 0, 0, 'autoturret')
    bm.placeBlock(20, 0, 20, 'repairstation')
    for (let y = 0; y < 2; y++) for (let x = -2; x <= 2; x++) bm.placeBlock(x, y, -20, 'gateblock')
    bm.placeBlock(-20, 0, 20, 'piston')
    bm.placeBlock(-20, 0, 30, 'stickypiston')
    bm.placeBlock(-22, 0, 20, 'buttonblock')
    bm.placeBlock(-22, 0, 30, 'buttonblock')
    bm.placeBlock(10, 0, -5, 'conveyorbelt', false, { facing: 0 })
    bm.placeBlock(-30, 0, -30, 'magnetblock')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const zombie = (x, z) => s._makeZombie(`t${Math.random()}`, x, 0, z, 1000, false)
    const me = { x: 0, y: 0, z: 0 }
    const tick = (secs = 0.15, at = me) => { sp._time += secs; sp.update(0.01, at) }
    // Unpowered: the fence does nothing.
    tick()
    const zf = zombie(43.5, 1.3)
    sp.zombieTick(zf, 0.05)
    out.fenceOff = zf.health === 1000
    sp.use(40, 0, 0)
    tick()
    zf._zapCd = 0
    sp.zombieTick(zf, 0.05)
    out.fenceZaps = zf.health === 980 && zf._knock > 0
    // Searchlight: zombies near it take more damage while powered.
    const zl = zombie(40.5, 8)
    tick()
    s.damageZombie(zl, 40)
    out.searchlight = zl.health === 950
    // Fan pusher: blows zombies out to 6 blocks.
    const zfan = zombie(36.5, 2.5)
    for (let i = 0; i < 60; i++) sp.zombieTick(zfan, 0.05)
    out.fan = Math.hypot(zfan.x - 36.5, zfan.z - 0.5) >= 5.9
    // Turret: shoots and loads ammo.
    s.zombies.length = 0
    const zt = zombie(-35, 0.5)
    tick()
    out.turret = zt.health === 988 && sp._st.get('-40,0,0').ammo === 19
    const reserve = s.reserve
    sp.use(-40, 0, 0)
    out.turretLoad = sp._st.get('-40,0,0').ammo === 19 + Math.min(30, reserve) && s.reserve === reserve - Math.min(30, reserve)
    s.zombies.length = 0
    // Repair: a block broken near it comes back.
    bm.placeBlock(22, 0, 20, 'stone')
    bm.tryMode.breakBlock(22, 0, 20)
    const gone = bm.getBlockAt(22, 0, 20) === null
    sp._state(sp.entryAt(20, 0, 20)).next = 0
    tick()
    out.repair = gone && bm.getBlockAt(22, 0, 20) === 'stone'
    // Gate: the whole gate opens, then shuts after 5 s.
    sp.use(0, 0, -20)
    out.gateOpen = [-2, -1, 0, 1, 2].every((x) => bm.getBlockAt(x, 0, -20) === null && bm.getBlockAt(x, 1, -20) === null)
    tick(6)
    out.gateShut = [-2, -1, 0, 1, 2].every((x) => bm.getBlockAt(x, 0, -20) === 'gateblock' && bm.getBlockAt(x, 1, -20) === 'gateblock')
    // Pistons: kick out / pull in when their button powers them.
    const zp = zombie(-18.5, 20.5)
    const zs = zombie(-15, 30.5)
    sp.use(-22, 0, 20)
    sp.use(-22, 0, 30)
    tick()
    for (let i = 0; i < 10; i++) { sp.zombieTick(zp, 0.05); sp.zombieTick(zs, 0.05) }
    out.piston = zp.x > -16
    out.sticky = zs.x < -17
    // Conveyor: carries a zombie along the way it faces (-z for facing 0).
    const zc = zombie(10.5, -4.5)
    zc.y = 0.07 // standing on the belt's top
    const z0 = zc.z
    for (let i = 0; i < 10; i++) sp.zombieTick(zc, 0.05)
    out.conveyor = zc.z < z0 - 0.8 // carried off its one-block belt
    // Magnet: drops near it come to you when you stand by it.
    s._drops.spawn('stone', -25, 0, -30)
    const d = s._drops.list[s._drops.list.length - 1]
    const before = Math.hypot(d.x + 29, d.z + 29)
    tick(0.15, { x: -29, y: 0, z: -29 })
    out.magnet = Math.hypot(d.x + 29, d.z + 29) < before
    s.stop()
    out.gatesBackOnStop = bm.getBlockAt(0, 0, -20) === 'gateblock'
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    inPicker: true, fenceOff: true, fenceZaps: true, searchlight: true, fan: true, turret: true, turretLoad: true,
    repair: true, gateOpen: true, gateShut: true, piston: true, sticky: true, conveyor: true, magnet: true, gatesBackOnStop: true,
  })
})

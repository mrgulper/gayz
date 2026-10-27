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

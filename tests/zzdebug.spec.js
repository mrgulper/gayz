import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The special blocks (SpecialBlocks.js / BuildSpecials.js): each batch's
// blocks placed in a real map and their effects checked while playing.

// Every check below runs inside the page: enter the editor, place a
// Player Start and a far-away spawner, then the batch's blocks.
test('special blocks batch 9: fan, elevator, zipline, bounce, slide, rope, rails, launch cannon, wind tunnel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 90, 'zombiespawner')
    const out = {}
    const ids = ['fanblock', 'elevatorblock', 'ziplinepost', 'bounceblock', 'slideblock', 'ropeanchor', 'railtrack', 'launchcannon', 'windtunnel', 'speedrail']
    out.inPicker = ids.every((id) => bm.isBlockType(id) && bm.blockTypeOf(id).desc && bm.blockIcon(id).startsWith('data:'))
    bm.placeBlock(20, 0, 0, 'fanblock')
    bm.placeBlock(-20, 0, 0, 'elevatorblock')
    bm.placeBlock(-20, 6, 0, 'elevatorblock')
    bm.placeBlock(0, 0, 20, 'ziplinepost')
    bm.placeBlock(0, 3, 40, 'ziplinepost')
    bm.placeBlock(20, 0, 20, 'bounceblock')
    bm.placeBlock(-20, 0, 20, 'slideblock')
    // A ledge 5 high with the rope anchor on its edge.
    for (let y = 0; y < 5; y++) bm.placeBlock(30, y, -30, 'stone')
    bm.placeBlock(30, 5, -30, 'ropeanchor')
    bm.placeBlock(10, 0, -10, 'railtrack', false, { facing: 0 })
    bm.placeBlock(12, 0, -10, 'speedrail', false, { facing: 0 })
    bm.placeBlock(-30, 0, -30, 'launchcannon')
    bm.placeBlock(40, 0, 40, 'windtunnel')
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    s._toSpawn = 0
    s._breakTimer = 999
    const sp = bm.specials
    const tm = bm.tryMode
    const at = (x, y, z) => { tm.pos.set(x, y, z); return tm.pos }
    // Fan: pushes you away.
    sp.update(0.1, at(22.5, 0, 0.5))
    out.fan = tm.pos.x > 22.5
    // Elevator: up to the one above.
    at(-19.5, 1, 0.5)
    sp.use(-20, 0, 0)
    out.elevator = Math.floor(tm.pos.y) === 7
    // Zipline: ride to the other post.
    at(0.5, 1, 19)
    sp.use(0, 0, 20)
    for (let i = 0; i < 40; i++) sp.update(0.1, tm.pos)
    out.zipline = Math.floor(tm.pos.z) === 40 && Math.floor(tm.pos.y) === 4 && !sp._ride
    // Bounce: a fall turns into a jump.
    tm.onGround = false
    tm.vel.y = -15
    sp.update(0.02, at(20.5, 2, 20.5))
    tm.vel.y = 0
    tm.onGround = true
    sp._onUnderKey = null
    sp.update(0.02, at(20.5, 1, 20.5))
    out.bounce = tm.vel.y >= 13
    // Slide: fast and slippery.
    sp._onUnderKey = null
    tm.onGround = true
    sp.update(0.02, at(-19.5, 1, 20.5))
    out.slide = sp.speedMult === 1.4 && sp.gripMult === 0.15
    // Rope: down to the ground beside the ledge.
    at(30.5, 6, -30.5)
    sp.use(30, 5, -30)
    out.rope = Math.floor(tm.pos.y) === 0 && Math.abs(tm.pos.x - 30.5) + Math.abs(tm.pos.z + 29.5) === 1
    // Rails: carry you along (-z for facing 0); the speed rail faster.
    at(10.5, 0.07, -9.5)
    sp._onPadKey = null
    sp.update(0.1, tm.pos)
    const rail = -9.5 - tm.pos.z
    at(12.5, 0.07, -9.5)
    sp.update(0.1, tm.pos)
    const fast = -9.5 - tm.pos.z
    out.rails = rail > 0.5 && fast > rail
    // Launch cannon: fired off fast the way you face.
    bm._yaw = 0
    sp.use(-30, 0, -30)
    out.launch = tm.vel.y === 13 && tm.vel.z < -15
    // ...and with real movement frames you really fly a long way.
    const z0 = tm.pos.z
    // (The game updates the special blocks every frame too - that keeps the
    // air slippery while you're launched.)
    for (let i = 0; i < 40; i++) {
      sp.update(0.05, tm.pos)
      tm.update(0.05, new Set())
    }
    out.launchFar = [z0, tm.pos.z, tm.pos.y, String(s._skin), tm.onGround, s.active]
    // Wind tunnel: lifts you in the column above it.
    tm.vel.y = -3
    sp.update(0.02, at(40.5, 3, 40.5))
    out.tunnel = tm.vel.y === 6
    s.stop()
    g._exitBuildMode()
    return out
  })
  console.log('LAUNCHDBG', JSON.stringify(r)); expect(r).toEqual({
    inPicker: true, fan: true, elevator: true, zipline: true, bounce: true, slide: true, rope: true, rails: true, launch: true, launchFar: true, tunnel: true,
  })
})

test('zz fps probe', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const info = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 300 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    const samples = []
    for (let i = 0; i < 10; i++) { await new Promise((res) => setTimeout(res, 1000)); samples.push(g.fpsEl.textContent) }
    return { cores: navigator.hardwareConcurrency, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, samples }
  })
  console.log('FPSDBG', JSON.stringify(info, null, 1))
})

// Camp and survival extras: crafting, farm, vehicles, zone.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Batch 2 (2026-10-31): crafting, the goo disguise, the camp farm and the
// camp's survivors, each through the real game objects.
async function startCampGame(page) {
  await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
  })
}

test('Crafting: the Crafting tab makes gear and blocks from what you carry', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    const count = (kind, id) => [...inv.hotbar, ...inv.grid].reduce((n, it) => n + (it && it.kind === kind && it.id === id ? it.n : 0), 0)
    inv.add({ kind: 'block', id: 'oaklog', n: 3 })
    inv.add({ kind: 'block', id: 'cobblestone', n: 4 })
    inv.add({ kind: 'item', id: 'zombieGoo', n: 3 })
    window.__game.buildMode.togglePicker()
    document.querySelector('#play-inventory .inv-tab[data-tab="craft"]').click()
    document.querySelector('#play-inventory .inv-tab[data-tab="craft"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    const out = { rows: document.querySelectorAll('#play-inventory .craft-row').length }
    const btn = (id) => document.querySelector(`#play-inventory .craft-btn[data-craft="${id}"]`)
    out.ammoReady = !btn('ammobox').disabled
    out.helmetReady = !btn('helmet').disabled
    btn('ammobox').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.ammo = count('item', 'ammobox')
    out.stoneLeft = count('block', 'cobblestone')
    out.logLeft = count('block', 'oaklog')
    out.ammoNow = !btn('ammobox').disabled
    btn('oakplanks').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.planks = count('block', 'oakplanks')
    btn('gooDisguise').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.disguise = count('item', 'gooDisguise')
    out.goo = count('item', 'zombieGoo')
    // The recipe list takes the bag's room: switching tabs keeps the panel's size.
    const box = () => document.querySelector('#play-inventory .inv-box').getBoundingClientRect()
    const craftBox = box()
    document.querySelector('#play-inventory .inv-tab[data-tab="bag"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    const bagBox = box()
    out.sizes = [craftBox.width, craftBox.height, bagBox.width, bagBox.height].map(Math.round)
    out.boxSame = Math.abs(craftBox.height - bagBox.height) < 3 && Math.abs(craftBox.width - bagBox.width) < 3
    // A wide screen shows both at once: crafting on the left, the bag on the right.
    out.wasOpen = window.__game.buildMode.pickerOpen
    if (!window.__game.buildMode.pickerOpen) window.__game.buildMode.togglePicker()
    const col = (sel) => document.querySelector(`#play-inventory ${sel}`).getBoundingClientRect()
    out.sides = [col('.inv-craft-col').left, col('.inv-craft-col').right, col('.inv-craft-col').width, col('.inv-bag-col').left, col('.inv-bag-col').width, innerWidth].map(Math.round)
    out.sideBySide = col('.inv-craft-col').width > 0 && col('.inv-bag-col').width > 0 && col('.inv-craft-col').right <= col('.inv-bag-col').left
    window.__game.buildMode.togglePicker()
    // Killed zombies drop Zombie Goo sometimes.
    const p = s.bodyPos()
    let drops = 0
    for (let i = 0; i < 20; i++) {
      s._makeZombie(9100 + i, p.x + 8, p.y, p.z, 10, false)
      const z = s.zombies[s.zombies.length - 1]
      const before = s._drops.list.filter((d) => d.type === 'zombieGoo').length
      s.damageZombie(z, 1e6)
      drops += s._drops.list.filter((d) => d.type === 'zombieGoo').length - before
    }
    out.gooDrops = drops
    return out
  })
  // 43 out of winter (the Snowball recipe only shows December to February).
  expect(r.rows).toBe(new Date().getMonth() % 11 < 2 ? 44 : 43)
  expect(r.ammoReady).toBe(true)
  expect(r.helmetReady).toBe(false)
  expect(r.ammo).toBe(1)
  expect(r.stoneLeft).toBe(0)
  expect(r.logLeft).toBe(2)
  expect(r.ammoNow).toBe(false)
  expect(r.planks).toBe(4)
  expect(r.disguise).toBe(1)
  expect(r.goo).toBe(0)
  expect(r.boxSame, String(r.sizes)).toBe(true)
  expect(r.sideBySide, String(r.sides)).toBe(true)
  expect(r.gooDrops).toBeGreaterThan(0)
  expect(r.gooDrops).toBeLessThan(20)
})

test('Goo Disguise: zombies ignore you until it wears off or you attack', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    inv.hotbar[1] = { kind: 'item', id: 'gooDisguise', n: 2 }
    inv.select(1)
    const out = { targetsBefore: s._targets().length }
    out.used = inv.useHeld()
    out.left = inv.hotbar[1]?.n
    out.targetsDuring = s._targets().length
    out.vignette = document.getElementById('goo-vignette')?.classList.contains('on')
    out.twice = inv.useHeld()
    s.disguise.update(10)
    out.stillOn = s.disguise.active
    s.disguise.update(25)
    out.woreOff = !s.disguise.active && s._targets().length === 1
    inv.useHeld()
    inv.select(0)
    s.shoot()
    out.brokeOnShot = !s.disguise.active
    return out
  })
  expect(r.targetsBefore).toBe(1)
  expect(r.used).toBe(true)
  expect(r.left).toBe(1)
  expect(r.targetsDuring).toBe(0)
  expect(r.vignette).toBe(true)
  expect(r.twice).toBe(false)
  expect(r.stillOn).toBe(true)
  expect(r.woreOff).toBe(true)
  expect(r.brokeOnShot).toBe(true)
})

test('Camp Farm: a Crop Plot in the camp is kept between games and grows in real time', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.removeItem('gayz-camp-farm'))
  await startCampGame(page)
  const spot = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const bm = s.bm
    const zn = s.camp.zone
    // An empty cell on the camp floor.
    for (let x = zn.x0 + 3; x < zn.x1 - 2; x++) {
      for (let z = zn.z0 + 3; z < zn.z1 - 2; z++) {
        const y = Math.floor(s._groundUnder(x + 0.5, bm.tryMode.pos.y + 4, z + 0.5))
        if (!bm.getBlockAt(x, y, z) && !bm.getBlockAt(x, y + 1, z) && bm.getBlockAt(x, y - 1, z)) {
          bm.placeBlock(x, y, z, 'cropplot', false)
          s._placed.set(bm._key(x, y, z), 'cropplot')
          s.farm.onPlaced('cropplot', x, y, z)
          return { x, y, z }
        }
      }
    }
    return null
  })
  expect(spot).not.toBeNull()
  const planted = await page.evaluate(({ x, y, z }) => {
    const s = window.__game.buildMode.survival
    const sp = s.bm.specials
    const out = { saved: JSON.parse(localStorage.getItem('gayz-camp-farm')).plots.length }
    // (A first game's big messages wait while the controls hint is up -
    // close it so this test reads its own message.)
    s.onboard._hintShown = true
    s.onboard._hideHint(true)
    s._msgQueue.length = 0
    sp.use(x, y, z)
    out.msg = document.getElementById('build-play-msg')?.textContent || ''
    out.at = JSON.parse(localStorage.getItem('gayz-camp-farm')).plots[0].at > 0
    // Six minutes ago, as if the game had been closed meanwhile.
    const farm = JSON.parse(localStorage.getItem('gayz-camp-farm'))
    farm.plots[0].at = Date.now() - 6 * 60 * 1000
    localStorage.setItem('gayz-camp-farm', JSON.stringify(farm))
    window.__game._exitBuildMode()
    out.goneAfter = !s.bm.getBlockAt(x, y, z)
    return out
  }, spot)
  await startCampGame(page)
  const back = await page.evaluate(({ x, y, z }) => {
    const s = window.__game.buildMode.survival
    const inv = s.inv
    const count = (id) => [...inv.hotbar, ...inv.grid].reduce((n, it) => n + (it && it.kind === 'item' && it.id === id ? it.n : 0), 0)
    const out = { there: s.bm.getBlockAt(x, y, z) }
    s.farm.update()
    const entry = s.bm.specials._at.get(`${x},${y},${z}`)
    out.ready = s.farm.secondsLeft(entry) === 0
    s.bm.specials.use(x, y, z)
    out.veggies = count('veggies')
    out.fiber = count('plantFiber')
    out.emptyAgain = JSON.parse(localStorage.getItem('gayz-camp-farm')).plots[0].at === 0
    return out
  }, spot)
  expect(planted.saved).toBe(1)
  expect(planted.msg).toContain('5:00')
  expect(planted.at).toBe(true)
  expect(planted.goneAfter).toBe(true)
  expect(back.there).toBe('cropplot')
  expect(back.ready).toBe(true)
  expect(back.veggies).toBe(2)
  expect(back.fiber).toBe(2)
  expect(back.emptyAgain).toBe(true)
})

test('Survivors: rescued ones live at camp, guard it and take Follow / Hold orders', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.setItem('gayz-camp-survivors', JSON.stringify({ list: [{ skin: 0 }, { skin: 1 }, { skin: 'x' }] })))
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const sv = s.survivors
    const out = { guards: sv.helpers.length, holding: sv.helpers.every((h) => h.order === 'hold'), inCamp: sv.helpers.every((h) => s.camp.inside(h.x, h.z, 1)) }
    // Look straight at the first one, close up, and press Use.
    const h = sv.helpers[0]
    const p = s.bm.tryMode.pos
    p.set(h.x, h.y, h.z + 2)
    s.bm._yaw = 0
    out.used = s.bm._tryUseFromCamera()
    out.following = h.order === 'follow'
    sv.update(0.1)
    out.prompt = document.getElementById('play-survivor-prompt')?.textContent || ''
    // Walk away: the follower comes along, the other one stays.
    const other = sv.helpers[1]
    const ox = other.x
    p.set(h.x + 8, h.y, h.z + 2)
    for (let i = 0; i < 20; i++) sv.update(0.1)
    out.followed = Math.hypot(h.x - p.x, h.z - p.z) < 4
    out.stayed = other.x === ox
    // Use again: hold.
    p.set(h.x, h.y, h.z + 2)
    s.bm._yaw = 0
    s.bm._tryUseFromCamera()
    out.holdAgain = h.order === 'hold'
    // A new rescue moves in too.
    const w = sv._person({ x: p.x + 1, y: p.y, z: p.z })
    w.beam = new (h.group.constructor)()
    w.beam.geometry = { dispose() {} }
    w.beam.material = { dispose() {} }
    sv._rescue(w)
    out.roster = JSON.parse(localStorage.getItem('gayz-camp-survivors')).list.length
    return out
  })
  expect(r.guards).toBe(3)
  expect(r.holding).toBe(true)
  expect(r.inCamp).toBe(true)
  expect(r.used).toBe(true)
  expect(r.following).toBe(true)
  expect(r.prompt).toContain('Hold here')
  expect(r.followed).toBe(true)
  expect(r.stayed).toBe(true)
  expect(r.holdAgain).toBe(true)
  expect(r.roster).toBe(4)
})

// 2026-11-01: crafted boats and helicopters (Vehicles.js) - crafted from
// the Crafting tab, put down, ridden; the helicopter climbs with Jump,
// burns fuel, refills from Heli Fuel you carry, and won't let you out up high.
// 2026-11-01: B opens the Shop (the camp's people + traps) on any map,
// cleared waves no longer hand out traps, Z opens the emote wheel, and
// you sit in vehicles and can right-click / Crouch out of them.
test('Shop on B, emote wheel on Z, sitting in and getting off vehicles', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const key = (code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }))
    }
    const out = {}
    // --- the Shop
    key('KeyB')
    out.shopOpen = s.shop.panelOpen
    out.tabs = [...document.querySelectorAll('#play-shop-tabs [data-shop-tab]')].map((b) => b.dataset.shopTab).join()
    document.querySelector('[data-shop-tab="traps"]').click()
    out.trapRows = document.querySelectorAll('#play-npc-list button[data-act="trap"]').length
    s.coins = 100
    s.shop._panelKey = ''
    s.shop._renderPanel()
    const mines = () => [...s.inv.hotbar, ...s.inv.grid].reduce((n, it) => n + (it?.id === 'landmine' ? it.n : 0), 0)
    const had = mines()
    document.querySelector('#play-npc-list button[data-act="trap"][data-id="landmine"]').click()
    out.boughtMine = mines() === had + 2 && s.coins === 100 - s.shop._price({ cost: 45 }) ? true : [had, mines(), s.coins]
    key('KeyB')
    out.shopClosed = !s.shop.panelOpen
    // Talking to a camp person opens the Shop on their tab.
    s.shop.openPanel('upgrader')
    out.npcTab = s.shop.tab
    s.shop.closePanel(false)
    // --- no free traps for a cleared wave any more
    const traps = () => ['spikeblock', 'baitblock', 'landmine', 'beartrap', 'explosivebarrel'].reduce((n, id) => n + [...s.inv.hotbar, ...s.inv.grid].reduce((m, it) => m + (it?.id === id ? it.n : 0), 0), 0)
    const before = traps()
    s.zombies.forEach((z) => s._removeZombie(z))
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 0
    for (let i = 0; i < 5; i++) s.update(0.05)
    out.noWaveTraps = traps() === before
    s._breakTimer = 1e9
    // --- the emote wheel
    key('KeyZ')
    out.wheelOpen = s.emotes.open
    out.wheelButtons = document.querySelectorAll('#emote-wheel [data-emote]').length
    // (Slices are SVG: a real click event, not .click().)
    document.querySelector('#emote-wheel [data-emote="cheer"] path').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    out.cheer = s.emotes.current === 'cheer' && !s.emotes.open
    // The 10th emote is on 0; the 11th+ have no key.
    key('KeyZ')
    out.key0 = s.emotes.pick('Digit0') && s.emotes.current === 'heart'
    // Your face changes while emoting, and goes back after.
    const tmv = bm.tryMode
    const view = tmv.view
    tmv.view = 1 // third person, so your body is drawn
    tmv.vel?.set?.(0, 0, 0)
    s.emotes.current = 'laugh'
    s.emotes._left = 5
    tmv._updateBody(0.016)
    const face = tmv._body?.char.userData.emoteFace
    out.faceOn = !!face?.pivot.visible
    s.emotes.stop()
    tmv._updateBody(0.016)
    out.faceOff = face ? !face.pivot.visible : 'no face'
    tmv.view = view
    // No dark backdrop; held keys survive opening the wheel (keep walking).
    bm._keys.add('KeyW')
    key('KeyZ')
    out.wheelClear = getComputedStyle(document.getElementById('emote-wheel')).backgroundImage === 'none'
    out.keysKept = bm._keys.has('KeyW')
    s.emotes.close(false)
    bm._keys.delete('KeyW')
    // Emoting in first person: the camera glides round to your front and
    // your body shows; walking keeps the emote going with walking legs.
    tmv.view = 0
    tmv._emoteCam = 0
    tmv.vel.set(0, 0, 0)
    s.emotes.play('wave')
    for (let i = 0; i < 40; i++) tmv._updateBody(0.05)
    out.camFront = tmv._emoteCam > 0.9 && !!tmv._body?.group.visible
    const eye = bm.camera.position.clone()
    const back = tmv.applyView()
    out.camMoved = bm.camera.position.distanceTo(eye) > 2 * tmv.B
    back?.()
    tmv.vel.set(3, 0, 0)
    for (let i = 0; i < 5; i++) tmv._updateBody(0.05)
    out.walkEmote = s.emotes.current === 'wave' && Math.abs(tmv._body.char.limbPivots.legR.rotation.x) > 0.01
    for (let i = 0; i < 40; i++) tmv._updateBody(0.05)
    out.camBack = tmv._emoteCam < 0.05
    tmv.vel.set(0, 0, 0)
    s.emotes.stop()
    // A plain Minecraft-size body again (2026-11-22, was chunkier): arms
    // flush against the 8-wide torso (slim skins sit half a unit closer).
    out.wide = Math.abs(tmv._body.char.limbPivots.armR.position.x) >= 5.5
    // Plain Minecraft-size head on the neck, and the emote face sits on its front.
    const head = tmv._body.char.children.find((c) => c.isMesh && c.userData.isHead)
    out.bigHead = head.scale.x === 1 && head.position.y === 26 && tmv._body.char.userData.emoteFace?.pivot.position.y === 26
    // The wheel's hover target stays put while the lit slice slides out
    // (a sliding target flickered under a mouse near its edge).
    // (Animations are skipped to their end, not waited on: CI draws 2-3 fps,
    // so a timed wait could still catch the pop-in growing the ring.)
    const finishAnims = () => document.getElementById('emote-wheel').getAnimations({ subtree: true }).forEach((a) => { try { a.finish() } catch { /* endless - leave it */ } })
    key('KeyZ')
    finishAnims() // the pop-in is done
    const slice = document.querySelector('#emote-wheel .emote-slice')
    s.emotes._hover(slice.dataset.emote)
    const hitBox = slice.querySelector('.emote-hit').getBoundingClientRect()
    finishAnims() // the lit slice has slid out
    const hitAfter = slice.querySelector('.emote-hit').getBoundingClientRect()
    out.hitStill = hitBox.x === hitAfter.x && hitBox.y === hitAfter.y && getComputedStyle(slice.querySelector('.emote-look')).transform !== 'none'
    s.emotes.close(false)
    // --- the go-kart: sit in it, right-click out, Crouch out
    const k = s.kart
    const tm = bm.tryMode
    tm.pos.set(k.x + 1, k.y, k.z)
    out.in = k.use() && k.driving
    tm.update(0.05, new Set())
    out.seated = tm._seatEye > 0.5
    tm.view = 1
    tm._updateBody(0.05)
    out.legsOut = Math.abs(tm._body?.char.limbPivots.legR.rotation.x + Math.PI / 2) < 0.01
    tm.view = 0
    out.rightClickOut = k.rightClick() && !k.driving
    tm.pos.set(k.x + 1, k.y, k.z)
    k.use()
    tm.update(0.05, new Set())
    tm.update(0.05, new Set(['KeyC']))
    out.crouchOut = !k.driving
    tm.update(0.05, new Set())
    out.standing = tm._seatEye === 0
    return out
  })
  expect(r).toEqual({
    shopOpen: true, tabs: 'items,traps,upgrades,ammo,quests', trapRows: 5, boughtMine: true, shopClosed: true, npcTab: 'upgrades',
    noWaveTraps: true, wheelOpen: true, wheelButtons: 14, cheer: true, key0: true, faceOn: true, faceOff: true,
    wheelClear: true, keysKept: true, camFront: true, camMoved: true, walkEmote: true, camBack: true, wide: true, bigHead: true, hitStill: true,
    in: true, seated: true, legsOut: true, rightClickOut: true, crouchOut: true, standing: true,
  })
})

test('boats and helicopters: craft, put down, ride, fly on fuel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 80, 'zombiespawner')
    for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    // A pond in front (+z): stone bed, water on top.
    for (let x = -4; x <= 4; x++) {
      for (let z = 3; z <= 16; z++) {
        bm.removeBlock?.(x, 0, z)
        bm.placeBlock(x, -1, z, 'stone', true)
        bm.placeBlock(x, 0, z, 'water', true)
      }
    }
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    s.update(0.05)
    s.kart.dispose()
    const v = s.vehicles
    const inv = s.inv
    const out = {}
    // Crafting: the three recipes are there and make the items.
    inv.add({ kind: 'item', id: 'zombieGoo', n: 12 })
    inv.add({ kind: 'block', id: 'oakplanks', n: 10 })
    inv.add({ kind: 'block', id: 'oaklog', n: 4 })
    inv.add({ kind: 'block', id: 'stone', n: 12 })
    inv.add({ kind: 'block', id: 'glass', n: 2 })
    out.html = ['boat', 'helicopter', 'heliFuel'].every((id) => inv.crafting.html().includes(`data-craft="${id}"`))
    out.crafted = inv.crafting.craft('boat') && inv.crafting.craft('helicopter') && inv.crafting.craft('heliFuel')
    const hold = (id) => {
      inv.hotbar[0] = { kind: 'item', id, n: 1 }
      inv.active = 0
      inv.apply()
    }
    // Facing +z (the pond) from dry land: a boat goes on the water.
    bm._yaw = Math.PI
    bm.tryMode.pos.set(0.5, 1, 1.5)
    hold('boat')
    out.boatPlaced = inv.useHeld() && v.list.length === 1 && v.list[0].kind === 'boat'
    const boat = v.list[0]
    out.boatOnWater = boat.y > 0.5 && boat.y < 1.1
    // Facing -z (dry grass): no boat.
    bm._yaw = 0
    hold('boat')
    out.boatNeedsWater = !inv.useHeld()
    // In, forward: it moves over the water; the shore stops it.
    bm._yaw = Math.PI
    bm.tryMode.pos.set(boat.x, boat.y, boat.z - 1)
    out.boatIn = bm._tryUseFromCamera() && v.riding === boat
    boat.heading = 0
    const z0 = boat.z
    for (let i = 0; i < 30; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.boatMoved = boat.z - z0 > 3
    for (let i = 0; i < 80; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.boatStaysOnWater = boat.z < 17.2
    out.boatOut = v.use() && !v.riding
    // A helicopter on the grass behind (-z).
    bm._yaw = 0
    bm.tryMode.pos.set(0.5, 1, -2)
    hold('helicopter')
    out.heliPlaced = inv.useHeld() && v.list.some((o) => o.kind === 'heli')
    const heli = v.list.find((o) => o.kind === 'heli')
    out.heliFull = heli.fuel === 60
    bm.tryMode.pos.set(heli.x + 1, heli.y, heli.z)
    out.heliIn = v.use() && v.riding === heli
    // Jump climbs; fuel burns.
    const y0 = heli.y
    for (let i = 0; i < 40; i++) bm.tryMode.update(0.05, new Set(['Space']))
    out.climbed = heli.y - y0 > 8
    out.burned = heli.fuel < 59
    out.meInSeat = Math.abs(bm.tryMode.pos.y - heli.y) < 0.1
    out.fuelHud = document.getElementById('vehicle-fuel')?.classList.contains('on')
    // Up high you can't get out.
    out.noExitHigh = (v.use(), v.riding === heli)
    // Forward flies the way you look (-z here).
    const hz = heli.z
    for (let i = 0; i < 30; i++) bm.tryMode.update(0.05, new Set(['KeyW']))
    out.flewForward = heli.z < hz - 4
    // Empty tank with Heli Fuel on you: it refills itself.
    for (const list of [inv.hotbar, inv.grid]) list.forEach((it, i) => { if (it?.id === 'heliFuel') list[i] = null })
    inv.hotbar[3] = { kind: 'item', id: 'heliFuel', n: 1 }
    heli.fuel = 0.01
    bm.tryMode.update(0.05, new Set(['Space']))
    out.autoRefuel = heli.fuel > 50 && !inv.hotbar.some((it) => it?.id === 'heliFuel') && !inv.grid.some((it) => it?.id === 'heliFuel')
    // Empty with none: it sinks to the ground, then you can get out.
    heli.fuel = 0.01
    const yHigh = heli.y
    for (let i = 0; i < 300; i++) bm.tryMode.update(0.05, new Set(['Space']))
    out.sank = heli.y < yHigh - 5
    out.landedOut = v.use() && !v.riding
    out.snapshot = v.snapshot().map((d) => d.k).sort().join('')
    s.stop()
    out.gone = v.list.length === 0
    g._exitBuildMode()
    return out
  })
  expect(r).toEqual({
    html: true, crafted: true, boatPlaced: true, boatOnWater: true, boatNeedsWater: true, boatIn: true, boatMoved: true, boatStaysOnWater: true, boatOut: true,
    heliPlaced: true, heliFull: true, heliIn: true, climbed: true, burned: true, meInSeat: true, fuelHud: true, noExitHigh: true, flewForward: true, autoRefuel: true, sank: true, landedOut: true, snapshot: 'bh', gone: true,
  })
})

// 2026-11-01: Shrinking Zone mode (ShrinkZone.js) - picked in Game Modes,
// a ring that shrinks stage by stage, toxic fog and faster zombies
// outside it, and surviving the last circle wins.
test('shrinking zone: ring, fog outside, faster zombies, win at the end', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    g.settings.guestMode = false
    document.getElementById('game-mode-shrinking-zone').click()
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival.zone?.started, null, { timeout: 30000 })
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const z = s.zone
    s.health = 1e9
    const out = { mode: s.cfg.mode, wall: !!z.wall?.parent }
    const n0 = z.now()
    out.firstR = n0.r
    out.hud = /Zone 1\/6/.test(document.getElementById('build-play-wave-text').textContent)
    // Inside: no fog. Far outside: fog, and zombies there are faster.
    const me = s.bm.tryMode.pos
    me.set(n0.x, me.y, n0.z)
    z.update(0.01)
    out.fogInside = document.getElementById('zone-fog').classList.contains('on')
    me.set(n0.x + n0.r + 30, me.y, n0.z)
    z.update(0.01)
    out.fogOutside = document.getElementById('zone-fog').classList.contains('on')
    out.fogText = /\d+ blocks/.test(document.getElementById('zone-fog').textContent)
    out.fastOut = z.zombieMult({ x: n0.x + n0.r + 5, z: n0.z })
    out.normalIn = z.zombieMult({ x: n0.x, z: n0.z })
    me.set(n0.x, me.y, n0.z)
    // Halfway through the first shrink: smaller, still bigger than the next.
    z.t = 45 + 10
    const mid = z.now()
    out.shrinking = mid.shrinking && mid.r < 100 && mid.r > 70
    // Every next circle sits inside the one before.
    out.nested = z.centers.every((c, i) => i === 0 || Math.hypot(c.x - z.centers[i - 1].x, c.z - z.centers[i - 1].z) + [100, 70, 45, 28, 15, 7][i] <= [100, 70, 45, 28, 15, 7][i - 1] + 0.01)
    out.rings = z.mapRings().length
    // Same seed and start, same zone (what a server's guests rebuild).
    const copy = new z.constructor(s)
    copy.applySnapshot(z.snapshot())
    out.sameOnGuests = copy.centers.every((c, i) => Math.abs(c.x - z.centers[i].x) < 0.01 && Math.abs(c.z - z.centers[i].z) < 0.01)
    copy.dispose()
    // The end: standing in the last circle when time's up wins.
    const last = z.centers[z.centers.length - 1]
    me.set(last.x, me.y, last.z)
    z.t = 1e9
    z.update(0.01)
    s.replay?.stop()
    out.won = !!s._won && s.dead
    out.title = document.getElementById('build-play-over-title').textContent
    return out
  })
  expect(r).toEqual({ mode: 'shrinkingZone', wall: true, firstR: 100, hud: true, fogInside: false, fogOutside: true, fogText: true, fastOut: 1.7, normalIn: 1, shrinking: true, nested: true, rings: 2, sameOnGuests: true, won: true, title: 'You outlasted the zone!' })
})

// Quick wins (2026-11-01): the Golden Runner world event (catch it for a
// coin burst), Fishing (the Trader's rod, cast, bite, catch), Zombie
// Radios (walk up for a broadcast) and spray tags (draw in Spray Paint,
// spray on a block, others' sprays from a server, hidden when muted/off).
test('Golden Runner, fishing, zombie radios and spray tags', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ map: 'map3', play: true }))
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 60 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    // (A first game's big messages wait while the controls hint is up -
    // close it so this test reads its own message.)
    s.onboard._hintShown = true
    s.onboard._hideHint(true)
    s._msgQueue.length = 0
    const out = {}
    const me = bm.tryMode.pos
    const home = { x: me.x, y: me.y, z: me.z }
    // --- Golden Runner: it runs off; touching it bursts into coins.
    s._startWave(2)
    out.goldenStarted = s.events.start('golden')
    const run = s.events._run
    const r0 = { x: run.runner.x, z: run.runner.z }
    for (let i = 0; i < 20; i++) s.events.update(0.05)
    out.goldenMoved = Math.hypot(run.runner.x - r0.x, run.runner.z - r0.z) > 0.2
    const coins = s.coins
    me.set(run.runner.x, run.runner.y, run.runner.z)
    s.events.update(0.05)
    out.goldenCaught = !!run.runner.caught
    out.goldenCoins = s.coins - coins >= 100
    for (let i = 0; i < 60 && s.events._run; i++) s.events.update(0.05)
    out.goldenGone = !s.events._run
    me.set(home.x, home.y, home.z)
    // --- Fishing: buy the rod from the Trader, hold it, cast, wait, reel in.
    s.coins = 500
    s.shop._act('buy', 'fishingRod')
    out.hasRod = s.inv.has('fishingRod')
    out.paid = s.coins === 440
    const slot = s.inv.hotbar.findIndex((it) => it?.id === 'fishingRod')
    s.inv.select(slot)
    s.inv.apply()
    // Pretend the middle of the screen points at water a few blocks ahead.
    s.fishing._waterInView = () => ({ x: me.x + 4, y: me.y, z: me.z, cx: Math.floor(me.x + 4), cz: Math.floor(me.z) })
    s.inv.useHeld()
    out.cast = s.fishing.out
    out.rodKept = s.inv.has('fishingRod')
    s.fishing.bob.wait = 0.1
    for (let i = 0; i < 20 && !(s.fishing.bob?.bite > 0); i++) s.fishing.update(0.05)
    out.bite = s.fishing.bob?.bite > 0
    const before = JSON.stringify([...s.inv.hotbar, ...s.inv.grid].filter(Boolean))
    const coinsBefore = s.coins
    const zombiesBefore = s.zombies.length
    s.inv.useHeld()
    out.reeled = !s.fishing.out
    const after = JSON.stringify([...s.inv.hotbar, ...s.inv.grid].filter(Boolean))
    out.gotSomething = after !== before || s.coins > coinsBefore || s.zombies.length > zombiesBefore
    // --- Zombie Radio: one turns up; walking up plays it.
    const radio = s.radios._place(me)
    out.radioPlaced = !!radio
    if (radio) {
      me.set(radio.x, radio.y, radio.z)
      s.radios.update(0.05)
      out.radioPlayed = radio.played
      out.radioMsg = document.getElementById('build-play-msg').textContent.startsWith('\u{1F4FB}')
      me.set(home.x, home.y, home.z)
    }
    // --- Spray tags: spray the block under my feet.
    const bx = Math.floor(me.x)
    const bz = Math.floor(me.z)
    let by = Math.floor(me.y) - 1
    while (!bm.getBlockAt(bx, by, bz) && by > -60) by--
    bm._raycastGridAligned = () => ({ existingBlock: [bx, by, bz], placeAt: [bx, by + 1, bz], t: 1 })
    out.sprayed = s.sprays.spray()
    out.mine = s.sprays.mine.length
    const snap = s.sprays.snapshot()
    out.snap = snap && snap.p.length === 256 && snap.s[0].f === 2
    // Someone else's spray from a server.
    const players = new Map([['p1', { nick: 'Bob', spray: { p: snap.p, s: [{ x: bx, y: by, z: bz, f: 0 }] } }]])
    s.sprays.syncRemote(players)
    out.remote = s.sprays.remote.get('p1')?.list.length
    g.settings.mutedChatPlayers = ['Bob']
    s.sprays.syncRemote(players)
    out.mutedHidden = !s.sprays.remote.has('p1')
    g.settings.mutedChatPlayers = []
    g.settings.showOtherSprays = false
    s.sprays.syncRemote(players)
    out.offHidden = !s.sprays.remote.has('p1')
    g.settings.showOtherSprays = true
    // A bad picture from the network never shows.
    s.sprays.syncRemote(new Map([['p2', { nick: 'Eve', spray: { p: '<b>', s: [{ x: bx, y: by, z: bz, f: 0 }] } }]]))
    out.badIgnored = !s.sprays.remote.has('p2')
    // Spray Paint in the pause screen: paint a square, Done keeps it.
    bm.toggleMenu()
    document.getElementById('play-pause-spray-btn').click()
    out.padShown = !document.getElementById('play-spray').hidden && document.getElementById('play-pause-buttons').hidden
    document.querySelector('#play-spray-colors [data-paint="3"]').click()
    const pad = document.getElementById('play-spray-pad')
    const box = pad.getBoundingClientRect()
    pad.dispatchEvent(new PointerEvent('pointerdown', { clientX: box.left + 2, clientY: box.top + 2, bubbles: true, pointerId: 1 }))
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    document.getElementById('play-spray-done').click()
    out.saved = (localStorage.getItem('gayz-spray-v1') || '')[0]
    out.buttonsBack = !document.getElementById('play-pause-buttons').hidden
    return out
  })
  expect(r).toEqual({
    goldenStarted: true, goldenMoved: true, goldenCaught: true, goldenCoins: true, goldenGone: true,
    hasRod: true, paid: true, cast: true, rodKept: true, bite: true, reeled: true, gotSomething: true,
    radioPlaced: true, radioPlayed: true, radioMsg: true,
    sprayed: true, mine: 1, snap: true, remote: 1, mutedHidden: true, offHidden: true, badIgnored: true,
    padShown: true, saved: '3', buttonsBack: true,
  })
})

test('Pinata zombie, snowballs, metal detector, riding, potions and jetpack', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game._enterBuildMode({ map: 'map3', play: true }))
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 60 && !s.active; i++) await new Promise((res) => setTimeout(res, 250))
    s._pickWeapon('rifle')
    const out = {}
    const me = bm.tryMode.pos
    const hold = (id) => {
      let slot = s.inv.hotbar.findIndex((it) => it?.id === id)
      if (slot < 0) {
        s.inv.hotbar[8] = { kind: 'item', id, n: s.inv.grid.find((it) => it?.id === id)?.n || 1 }
        slot = 8
      }
      s.inv.select(slot)
      s.inv.apply()
    }
    // --- Pinata zombie: candy and coins for the kill.
    s.zombies.forEach((z) => { z.health = 0 })
    const zp = s._makeZombie(9001, me.x + 3, me.y, me.z, 10, false, null, { tier: 'common', name: 0, shine: 'pinata' })
    out.pinataTag = !!zp.shine
    const coins = s.coins
    s.damageZombie(zp, 999)
    s._pinataLoot()
    out.pinataCandy = s.inv.has('candy')
    out.pinataCoins = s.coins > coins
    // --- Snowballs: on with the setting, a wave hands them out, one freezes a zombie.
    g.settings.snowballsAllYear = true
    s._startWave(1)
    out.snowballs = s.inv.has('snowball')
    const zf = s._makeZombie(9002, me.x, me.y, me.z - 4, 500, false, null, { tier: 'common', name: 0 })
    s.snowballs.freeze(zf)
    out.frozen = zf.frozen > 0
    s.snowballs.update(0.05)
    out.ice = s.snowballs.ice.has(zf)
    hold('snowball')
    const before = s.inv.selected().n
    s.snowballs._nextAt = 0
    out.thrown = s.inv.useHeld() && s.inv.selected().n === before - 1 && s.snowballs.list.length > 0
    g.settings.snowballsAllYear = false
    out.recipeHidden = !s.inv.crafting?.html().includes('data-craft="snowball"') || new Date().getMonth() % 11 < 2
    // --- Metal detector: hide a spot, stand on it, dig.
    s.inv.add({ kind: 'item', id: 'metalDetector', n: 1 })
    hold('metalDetector')
    const spot = s.detector.hide(me)
    out.spot = !!spot
    out.signalFar = s.detector.signal({ x: spot.x + 30, z: spot.z }) < s.detector.signal({ x: spot.x + 2, z: spot.z })
    me.set(spot.x, spot.y, spot.z)
    const c2 = s.coins
    s.inv.useHeld()
    out.dug = s.coins > c2 && s.stats.dug === 1
    out.keptDetector = s.inv.has('metalDetector')
    // --- Potions: speed and giant, through the special blocks' buffs.
    s.inv.add({ kind: 'item', id: 'potionSpeed', n: 1 })
    hold('potionSpeed')
    out.drank = s.inv.useHeld() && bm.specials._buff('speed') > 1
    out.potionLeft = s.potions.left('potionSpeed') > 25
    s.potions.drink('potionGiant')
    out.giant = bm.specials.bodySize() > 1.5
    s.potions.drink('potionTiny')
    out.tiny = bm.specials.bodySize() < 1
    // --- Jetpack: Jump held in the air climbs and burns fuel.
    s.inv.add({ kind: 'item', id: 'jetpack', n: 1 })
    s.jetpack.clear()
    let vy = 0
    for (let i = 0; i < 10; i++) vy = s.jetpack.thrust(0.05, true, false, vy)
    out.jetUp = vy > 1 && s.jetpack.fuel < 1
    s.jetpack.fuel = 0
    s.inv.add({ kind: 'item', id: 'jetFuel', n: 1 })
    s.jetpack.thrust(0.05, true, false, 0)
    out.jetRefuelled = s.jetpack.fuel > 0.9 && !s.inv.has('jetFuel')
    // --- Riding: a tamed horse, Use climbs on, keys move it, Use gets off.
    // On a flat stone pad high up: the world is random, and now and then
    // a wall or a slope right ahead stopped the horse (seen on CI).
    const padY = Math.floor(me.y) + 60
    for (let dx = -10; dx <= 10; dx++) for (let dz = -10; dz <= 10; dz++) bm.placeBlock(Math.floor(me.x) + dx, padY - 1, Math.floor(me.z) + dz, 'stone', true)
    s.bm.tryMode.pos.set(me.x, padY, me.z)
    const a = s.animals.placeAt({ kind: 'horse', x: me.x + 2, y: padY, z: me.z })
    out.horse = !!a
    if (a) {
      a.tamed = true
      bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
      s.animals._onRay = () => a
      out.mounted = s.riding.use() && s.riding.on && a.ridden
      const x0 = a.x
      const z0 = a.z
      for (let i = 0; i < 10; i++) s.riding.drive(0.05, { fwd: true })
      out.rode = Math.hypot(a.x - x0, a.z - z0) > 1
      out.seat = s.riding.seat().y > a.y + 1
      s.riding.use()
      out.off = !s.riding.on && !a.ridden
    }
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Speedrun: clock, best time and ghost path', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-speedrun-best')
    g.settings.selectedGameMode = 'speedrun'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const out = { mode: s.cfg.mode === 'speedrun', made: !!s.speedrun }
    s._startWave(1)
    const sr = s.speedrun
    out.running = sr.running
    for (let i = 0; i < 20; i++) sr.update(0.1)
    out.timed = sr.t > 1.9 && sr.path.length >= 9
    out.pill = document.getElementById('pill-speedrun')?.classList.contains('on')
    const res = sr.finish()
    out.best = res.isBest && JSON.parse(localStorage.getItem('gayz-speedrun-best')).ms === res.ms
    out.text = sr.text().length > 5
    // A slower second run doesn't replace the best.
    sr.result = null
    sr.start()
    sr.t = res.ms / 1000 + 5
    out.slower = !sr.finish().isBest
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Treasure maps, kites and the camp aquarium', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-aquarium')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Three pieces craft a map; the map marks an X, then digs it up.
    s.inv.add({ kind: 'item', id: 'mapPiece', n: 3 })
    out.crafted = s.inv.crafting.craft('treasureMap') && s.inv.has('treasureMap') && !s.inv.has('mapPiece')
    out.picked = pick('treasureMap')
    s.inv.useHeld()
    const spot = s.treasure.spot
    out.marked = !!spot && s.inv.has('treasureMap')
    s.pins.update(1)
    out.compassX = (document.getElementById('pin-compass')?.textContent || '').includes('X')
    s.inv.useHeld()
    out.stillMap = s.inv.has('treasureMap') && !!s.treasure.spot
    s.bm.tryMode.pos.set(spot.x, spot.y, spot.z)
    const coins = s._coinsEarned
    const gems = g.gems
    s.inv.useHeld()
    out.dug = !s.treasure.spot && !s.inv.has('treasureMap') && s._coinsEarned > coins && g.gems > gems
    // The kite: up, pulls with the wind, slows a fall, reels in.
    s.inv.add({ kind: 'item', id: 'kite', n: 1 })
    out.kitePicked = pick('kite')
    s.inv.useHeld()
    for (let i = 0; i < 20; i++) s.kite.update(0.1)
    out.kiteUp = s.kite.up && !!s.kite.mesh?.parent && s.inv.has('kite')
    const pull = s.kite.pull()
    out.kitePull = !!pull && Math.hypot(pull.x, pull.z) > 0.1
    out.kiteGlide = s.kite.fall(-20) > -5
    s.inv.useHeld()
    out.kiteDown = !s.kite.up && !s.kite.mesh
    // The aquarium counts catches (a sure Fish off the rod) and fills the tank.
    const rnd = Math.random
    Math.random = () => 0
    const me = s.bodyPos()
    s.fishing.bob = { x: me.x, y: me.y, z: me.z }
    s.fishing._land()
    s.fishing._land()
    Math.random = rnd
    out.counted = JSON.parse(localStorage.getItem('gayz-aquarium') || '{}').fish === 2
    localStorage.setItem('gayz-aquarium', JSON.stringify({ fish: 2, golden: 1 }))
    const camp = s.camp
    for (let i = 0; i < 20 && !camp?.aquarium; i++) await new Promise((res) => setTimeout(res, 100))
    out.campAquarium = !!camp?.aquarium
    const Aquarium = camp.aquarium.constructor
    camp.aquarium.dispose()
    camp.aquarium = new Aquarium(camp)
    camp.aquarium.build(camp.trophies?.spot)
    out.tank = !!camp.aquarium.group && camp.aquarium.fish.length === 3
    out.apart = !camp.trophies?.spot || Math.hypot(camp.aquarium.spot.x - camp.trophies.spot.x, camp.aquarium.spot.z - camp.trophies.spot.z) > 4
    s.stop?.()
    g._exitBuildMode?.()
    localStorage.removeItem('gayz-aquarium')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Dungeons: rooms underground, a way in, and the Boss Room', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const bm = g.buildMode
    const s = bm.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const out = {}
    const under = bm.world.under
    // Dungeons near the city, and at least one with a way in from the land.
    const list = under.dungeonsNear(-600, -600, 600, 600)
    out.some = list.length > 0
    const withWay = list.filter((d) => under._dungeonEntrance(d))
    out.ways = withWay.length > 0
    const d = withWay[0] || list[0]
    if (!d) return out
    const room = d.rooms.find((o) => o.boss)
    const cx = d.x0 + room.x0 + 2
    const cz = d.z0 + room.z0 + 2
    // The rock knows the room is open and its floor is solid.
    out.airInside = !under.implicitSolid(cx, d.floor + 1, cz, `${cx},${d.floor + 1},${cz}`) || bm.getBlockAt(cx, d.floor + 1, cz) === null
    out.floorSolid = under.implicitSolid(cx, d.floor, cz, `${cx},${d.floor},${cz}`) || !!bm.getBlockAt(cx, d.floor, cz)
    // Walk in: its walls get built, the dungeon is noticed, the boss wakes.
    bm.tryMode.pos.set(cx + 0.5, d.floor + 1, cz + 0.5)
    for (let i = 0; i < 40; i++) {
      bm.tryMode.pos.set(cx + 0.5, d.floor + 1, cz + 0.5)
      await new Promise((res) => setTimeout(res, 150))
    }
    let bricks = 0
    for (let x = d.x0; x < d.x0 + 36; x++) for (let z = d.z0; z < d.z0 + 36; z++) if (/stonebricks/.test(bm.getBlockAt(x, d.floor, z) || '')) bricks++
    out.built = bricks > 20
    const zs = s.zombies.length
    s._dungeonCheckIn = 0
    s._checkDungeon(0.1)
    out.seen = s._dungeonsSeen.has(d.id)
    // (It may have woken already while we stood there.)
    out.boss = s._dungeonBosses.has(d.id) && (s.zombies.length > zs || s.zombies.some((z) => z.boss))
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// 2026-11-02: run perks (RunPerks.js), escort missions (EscortMission.js),
// camp sieges (CampSiege.js) and Tower Defense mode (TowerDefense.js).
test('run perks, an escort mission and a camp siege in Zombie Survival', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { const g = window.__game; g.settings.guestMode = false; g.settings.selectedGameMode = 'classic'; g.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    s.health = s.maxHealth = 1e6
    s._breakTimer = 9999
    const out = {}
    // A cleared wave: three cards, the break waits, "2" picks the middle one.
    s.wave = 1
    s._toSpawn = 0
    s._breakTimer = 0
    for (const z of [...s.zombies]) s.damageZombie(z, 1e6)
    s._updateWorld(0.01)
    s._updateWorld(0.01)
    out.cards = document.querySelectorAll('#play-perk-pick .perk-card').length
    const wait = s._breakTimer
    s._updateWorld(1)
    out.waits = s._breakTimer === wait
    const middle = s.perks.offer[1]
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', bubbles: true }))
    out.picked = s.perks.n(middle) === 1 && !s.perks.open
    // The random middle card may have been Hard Hitter already, so check
    // one more step of +20% on top of however many there are.
    s.perks.offer = ['hardHitter']
    const had = s.perks.n('hardHitter')
    const dmg = s._damageMult()
    s.perks.pick('hardHitter')
    out.harder = +(s._damageMult() / dmg).toFixed(2) === +((1 + 0.2 * (had + 1)) / (1 + 0.2 * had)).toFixed(2)
    // An escort: someone to walk to an exit, that zombies go for.
    s._breakTimer = 9999
    out.escort = s.events.start('escort')
    const run = s.events._run
    out.path = run?.escort.path.length >= 20
    const zb = s._extraZombie(run.escort.x + 3, run.escort.y, run.escort.z)
    out.chases = !!run.target(zb)?.hurt
    run.hurt(1e6)
    out.lost = run.escort.over === 'lost'
    // A siege (only with the camp): the camp isn't safe until it's over.
    if (s.camp) {
      s.wave = 5
      out.siege = s.siege.start()
      const c = s.siege.center()
      out.unsafe = !s._campSafe(c.x, c.z)
      for (let i = 0; i < 80 && s.siege.toSend > 0; i++) s.siege.update(0.5)
      for (const z of [...s.siege.zombies]) s.damageZombie(z, 1e6)
      s.siege.update(0.1)
      out.held = !s.siege.active && s.stats.sieges === 1 && s._campSafe(c.x, c.z)
    }
    return out
  })
  expect(r).toEqual({ cards: 3, waits: true, picked: true, harder: true, escort: true, path: true, chases: true, lost: true, ...(r.siege !== undefined ? { siege: true, unsafe: true, held: true } : {}) })
})

// Six ideas batch 2 (2026-11-27): Pet Races at camp - pick your pet, bet on
// any racer at its odds, the race runs on a sky track and you come back.
test('Pet Races: odds, a bet, the sky track, cheering and the payout', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    // The camp builds its booths on its first update (stepped by hand: CI is slow).
    for (let i = 0; i < 50 && !s.camp.race; i++) {
      s.camp.update(0.05)
      await new Promise((res) => setTimeout(res, 50))
    }
    const R = s.camp.race
    const RM = R.lib
    const out = { post: !!R?.group }
    // No pets yet: the screen says so.
    localStorage.removeItem('gayz-creatures')
    R.openPick()
    out.noPets = document.querySelectorAll('#camp-screen .race-pet').length === 0 && !!document.querySelector('#camp-screen .camp-screen-btn')
    const mine = { t: 'z', k: null, r: 'rare', n: 0, b: false, l: 5, id: 1 }
    const bots = RM.botPets(mine)
    out.bots = bots.length === 5 && new Set(bots.map((b) => `${b.t}${b.k}`)).size === 5
    // Odds: always in range; a much faster field makes my pet a long shot.
    const odds = RM.oddsFor([mine, ...bots], 0)
    out.odds = odds.length === 6 && odds.every((o) => o >= RM.ODDS_MIN && o <= RM.ODDS_MAX)
    out.bets = RM.cleanBet(9999, 2000) === RM.MAX_BET && RM.cleanBet(50, 20) === 20 && RM.cleanBet('x', 100) === 0 && RM.payout(50, 2.5) === 125
    // The bet screen: tap a racer and an amount, then Start.
    s.coins = 300
    R.openBet(mine, bots)
    out.rows = document.querySelectorAll('#camp-screen .race-row').length
    document.querySelectorAll('#camp-screen .race-row')[0].click()
    document.querySelector('#camp-screen .race-amount[data-n="100"]').click()
    out.sum = /100/.test(document.querySelector('#camp-screen .race-sum').textContent)
    const home = { x: s.bm.tryMode.pos.x, z: s.bm.tryMode.pos.z }
    document.querySelector('#camp-screen .race-go').click()
    const race = R.race
    out.started = !document.getElementById('camp-screen') && !!race && s.coins === 200
    out.sky = s.bm.tryMode.pos.y > RM.RACE_Y && s.bm.getBlockAt(race.ox + 5, RM.RACE_Y, race.oz + 1) === 'whiteconcrete'
    out.cheerBtn = !!document.getElementById('pet-race-cheer')
    out.saveHome = s.camp.race.home().x === home.x
    for (let i = 0; i < 31; i++) R.update(0.1)
    out.cheer = race.phase === 'run' && s.camp.use() === true && race.run[0].boost > 0
    race.run[0].p = 100 // my pet wins
    for (let i = 0; i < 400 && race.phase === 'run'; i++) R.update(0.1)
    out.won = race.order[0] === 0 && s.coins === 200 + RM.payout(100, race.odds[0])
    for (let i = 0; i < 50 && R.race; i++) R.update(0.1)
    out.back = !R.race && Math.abs(s.bm.tryMode.pos.x - home.x) < 0.01 && !s.bm.getBlockAt(race.ox + 5, RM.RACE_Y, race.oz + 1) && !document.getElementById('pet-race-cheer')
    return out
  })
  expect(r).toEqual({ post: true, noPets: true, bots: true, odds: true, bets: true, rows: 6, sum: true, started: true, sky: true, cheerBtn: true, saveHome: true, cheer: true, won: true, back: true })
})

// Six ideas batch 3 (2026-11-27): Fossil digs - underground blocks may hold a
// dinosaur bone (Bone Block pockets always), skeletons fill the Museum's
// Fossil Hall up in the sky, a finished one pays coins.
test('Fossil digs: bones underground, the Fossil Hall and a finished skeleton', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const bm = s.bm
    const tm = bm.tryMode
    for (let i = 0; i < 50 && !s.camp.fossils; i++) {
      s.camp.update(0.05)
      await new Promise((res) => setTimeout(res, 50))
    }
    localStorage.removeItem('gayz-fossils')
    const bones = () => Object.values(JSON.parse(localStorage.getItem('gayz-fossils') || '{}')).flat().length
    const out = {}
    // A Bone Block of the world's own rock, underground: a bone.
    const dig = (type, y, terrain) => {
      const key = bm._key(3, y, 3)
      tm._broken.set(key, { x: 3, y, z: 3, type, terrain })
      s.onBlockMined(type, 3, y, 3)
    }
    dig('boneblock', -20, true)
    out.dug = bones()
    // Above ground, or one somebody placed: nothing.
    dig('boneblock', 5, true)
    dig('boneblock', -20, false)
    out.noExtra = bones()
    // Four T. rex bones, then the fifth finishes it: coins.
    localStorage.setItem('gayz-fossils', JSON.stringify({ tRex: ['skull', 'ribs', 'spine', 'legs'] }))
    const coins = s.coins
    s.camp.fossils.lib.digForBone(s, 'boneblock', -20, true, () => 0)
    out.tRex = JSON.parse(localStorage.getItem('gayz-fossils')).tRex?.length
    out.paid = s.coins - coins
    // The Museum's screen: the Fossil Hall section and the Visit button.
    const m = s.camp.museum
    tm.pos.set(m.door.x, 1, m.door.z)
    m.use()
    const go = document.querySelector('#camp-screen .museum-fossil-go')
    out.button = !!go
    const home = { x: tm.pos.x, z: tm.pos.z }
    go?.click()
    const F = s.camp.fossils
    out.inside = F.inside && tm.pos.y > 120
    out.skeletons = F.layout().spots.length
    out.floor = !!bm.getBlockAt(Math.floor(tm.pos.x), Math.floor(tm.pos.y) - 1, Math.floor(tm.pos.z))
    // Use: back down, the sky blocks gone.
    const hall = F.hall
    s.camp.use()
    out.back = !F.inside && Math.abs(tm.pos.x - home.x) < 0.01 && Math.abs(tm.pos.z - home.z) < 0.01
    out.cleared = !bm.getBlockAt(hall.ox + 3, 130, hall.oz + 3)
    return out
  })
  expect(r.dug).toBe(1)
  expect(r.noExtra).toBe(1)
  expect(r.tRex).toBe(5)
  expect(r.paid).toBe(150)
  expect(r.button).toBe(true)
  expect(r.inside).toBe(true)
  expect(r.skeletons).toBeGreaterThanOrEqual(20)
  expect(r.floor).toBe(true)
  expect(r.back).toBe(true)
  expect(r.cleared).toBe(true)
})

// Six ideas batch 4 (2026-11-27): the Bug Net catches a bug into a jar,
// fills the Bug Book (milestone coins), and jars sell at the Shop.
test('Bug Net: catch a bug in a jar, fill the Bug Book, sell the jars', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const lib = s.bugNet.lib
    localStorage.removeItem(lib.KEY)
    const out = { kinds: lib.BUG_IDS.length }
    // Bought from the Shop's Items tab.
    s.coins = 500
    s.shop._act('buy', 'bugNet')
    out.bought = s.inv.has('bugNet')
    // Crafting knows it too.
    out.recipe = !!s.inv.crafting?.html().includes('data-craft="bugNet"')
    // Hold it and face a butterfly just ahead.
    s.inv.hotbar[0] = { kind: 'item', id: 'bugNet', n: 1 }
    s.inv.active = 0
    s.inv.apply()
    const cam = s.bm.camera
    cam.updateMatrixWorld()
    const dir = new cam.position.constructor()
    cam.getWorldDirection(dir)
    const me = s.bodyPos()
    const a = s.animals.spawn('butterfly', me.x + dir.x * 1.5, me.y + 1.2, me.z + dir.z * 1.5)
    const coins = g.coins || 0
    s.bugNet._nextAt = 0
    out.used = s.inv.useHeld()
    out.gone = !s.animals.list.includes(a)
    out.jar = s.inv.has('jar_butterfly')
    out.book = lib.loadBugBook().n.butterfly
    out.keptNet = s.inv.has('bugNet')
    // A milestone: catching enough kinds pays homepage coins.
    const need = Math.ceil(lib.BUG_IDS.length * 0.25)
    for (const k of lib.BUG_IDS.slice(1, need)) lib.recordBug(k, g)
    out.prize = (g.coins || 0) - coins
    // Jars sell at the Shop.
    s.inv.add({ kind: 'item', id: 'jar_bee', n: 2 })
    const before = s.coins
    s.shop._act('sellBugs', 'jars')
    out.sold = s.coins - before
    out.jarsLeft = s.inv.has('jar_butterfly') || s.inv.has('jar_bee')
    // The Bug Book tab on the homepage.
    lib.renderBugBook()
    out.cards = document.querySelectorAll('#bug-book-grid .bug-book-card').length
    out.caughtCards = document.querySelectorAll('#bug-book-grid .bug-book-card:not(.unmet)').length
    return out
  })
  expect(r.kinds).toBeGreaterThanOrEqual(25)
  expect(r.bought).toBe(true)
  expect(r.recipe).toBe(true)
  expect(r.used).toBe(true)
  expect(r.gone).toBe(true)
  expect(r.jar).toBe(true)
  expect(r.book).toBe(1)
  expect(r.keptNet).toBe(true)
  expect(r.prize).toBe(100)
  expect(r.sold).toBeGreaterThan(0)
  expect(r.jarsLeft).toBe(false)
  expect(r.cards).toBe(r.kinds)
  expect(r.caughtCards).toBeGreaterThanOrEqual(7)
})

// Grappling Hook (2026-11-28): bought or crafted, zip to a wall, land on
// top of a low one, no grappling in party games.
test('Grappling Hook: zip to a wall, onto a ledge, not in party games', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    const s = g.buildMode.survival
    const bm = s.bm
    const B = s.B
    const tm = bm.tryMode
    const out = {}
    s.coins = 500
    s.shop._act('buy', 'grappleHook')
    out.bought = s.inv.has('grappleHook')
    out.recipe = !!s.inv.crafting?.html().includes('data-craft="grappleHook"')
    s.inv.hotbar[0] = { kind: 'item', id: 'grappleHook', n: 1 }
    s.inv.active = 0
    s.inv.apply()
    // Up in the open sky, a wall 8 blocks straight ahead (-Z).
    const fx = Math.floor(tm.pos.x)
    const fz = Math.floor(tm.pos.z)
    const fy = 120
    const aimAt = () => {
      tm.pos.set(fx + 0.5, fy, fz + 0.5)
      bm.camera.position.set((fx + 0.5) * B, (fy + 1.6) * B, (fz + 0.5) * B)
      bm.camera.quaternion.identity()
      bm.camera.updateMatrixWorld()
    }
    const run = () => {
      for (let i = 0; i < 200 && s.grapple.zipping; i++) s.grapple.update(0.05)
    }
    for (let y = fy; y <= fy + 3; y++) bm.placeBlock(fx, y, fz - 8, 'stone', true)
    aimAt()
    s.grapple._readyAt = 0
    out.used = s.inv.useHeld()
    run()
    out.wallZ = tm.pos.z
    out.wallY = tm.pos.y
    out.kept = s.inv.has('grappleHook')
    // Straight away again: still cooling down.
    aimAt()
    out.cool = s.grapple.use()
    // A low wall (2 tall): land on top of it.
    for (const y of [fy + 2, fy + 3]) bm.removeBlock(fx, y, fz - 8)
    aimAt()
    s.grapple._readyAt = 0
    out.ledge = s.grapple.use()
    run()
    out.ledgeY = tm.pos.y
    out.ledgeZ = tm.pos.z
    // Nothing in range.
    aimAt()
    bm.camera.quaternion.setFromAxisAngle(new bm.camera.up.constructor(0, 1, 0), Math.PI)
    bm.camera.updateMatrixWorld()
    s.grapple._readyAt = 0
    out.miss = s.grapple.use()
    // Party games say no.
    aimAt()
    s.grapple._readyAt = 0
    const party = s.party
    s.party = { hudText: () => '' }
    out.party = s.grapple.use()
    s.party = party
    out.rope = !!s.grapple.rope
    return { ...out, fy, fz, lib: s.grapple.lib }
  })
  expect(r.bought).toBe(true)
  expect(r.recipe).toBe(true)
  expect(r.used).toBe(true)
  expect(r.kept).toBe(true)
  // Stopped just short of the wall (its face is at fz - 7).
  expect(r.wallZ).toBeGreaterThan(r.fz - 7)
  expect(r.wallZ).toBeLessThan(r.fz - 5.5)
  expect(r.cool).toBe(false)
  expect(r.ledge).toBe(true)
  expect(r.ledgeY).toBeGreaterThan(r.fy + 1.9)
  expect(r.ledgeZ).toBeLessThan(r.fz - 7)
  expect(r.miss).toBe(false)
  expect(r.party).toBe(false)
  expect(r.rope).toBe(false)
})

// Six ideas batch 5 (2026-11-27): the camp Shop Stand - put spare loot on it
// at a price, survivors walk up and buy, haggle once or walk off.
test('Shop Stand: prices, a sale, a haggle and walking off', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startCampGame(page)
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    for (let i = 0; i < 50 && !s.camp.stand; i++) {
      s.camp.update(0.05)
      await new Promise((res) => setTimeout(res, 50))
    }
    const S = s.camp.stand
    const L = S.lib
    const out = { stand: !!S?.group }
    // Prices and what a customer does.
    out.prices = L.priceFor('meat', 'cheap') === 4 && L.priceFor('meat', 'fair') === 6 && L.priceFor('meat', 'pricey') === 9 && L.priceFor('meat', 'custom', '12') === 12 && L.priceFor('meat', 'custom', 'x') === 0
    out.decide = L.decide(5, 10, 0).act === 'buy' && L.decide(10, 10, 0).act === 'haggle' && L.decide(10, 10, 0).offer === 7 && L.decide(50, 10, 1).act === 'leave'
    out.gearNot = L.fairOf('fishingRod') === 0 && L.fairOf('meat_cow') === 6
    // A bag with meat and a locked fish: only the meat is sellable.
    s.inv.add({ kind: 'item', id: 'meat', n: 3 })
    s.inv.add({ kind: 'item', id: 'goldenFish', n: 1, lk: 1 })
    out.sellable = L.sellable(s.inv).some((b) => b.id === 'meat') && !L.sellable(s.inv).some((b) => b.id === 'goldenFish')
    // The screen: pick meat, Fair, All, put it on.
    S.open()
    document.querySelector('#camp-screen .stand-bag .stand-row[data-id="meat"]').click()
    document.querySelector('#camp-screen .stand-preset[data-p="fair"]').click()
    document.querySelector('#camp-screen .stand-amount[data-n="all"]').click()
    document.querySelector('#camp-screen .stand-put').click()
    out.listed = S.list.length === 1 && S.list[0].price === 6 && !!document.querySelector('#camp-screen .stand-on .stand-row[data-id="meat"]')
    document.querySelector('#camp-screen .camp-screen-x').click()
    // Stand right by it so customers come.
    const m = S._mid()
    s.bm.tryMode.pos.x = m.x
    s.bm.tryMode.pos.z = m.z + 3
    // A customer who buys (cheap price).
    S.list[0].price = 1
    const coins = s.coins
    S.next = 0
    S.update(0.1)
    S.next = 1e9 // one customer at a time here
    out.came = S.customers.length === 1
    for (let i = 0; i < 200 && S.customers[0]?.phase !== 'leave'; i++) S.update(0.1)
    out.sold = s.coins > coins && L.countIn(s.inv, 'meat') === 2
    for (let i = 0; i < 200 && S.customers.length; i++) S.update(0.1)
    out.gone = S.customers.length === 0
    // A haggle: a price a bit over what they'd pay, accepted.
    S.list[0].price = 6
    const rnd = Math.random
    Math.random = () => 0 // the least they'd pay: 4
    S.next = 0
    S.update(0.1)
    S.next = 1e9 // one customer at a time here
    S.customers[0].x = S.customers[0].to.x
    S.customers[0].z = S.customers[0].to.z
    for (let i = 0; i < 40 && !S.haggle; i++) S.update(0.1)
    Math.random = rnd
    out.haggle = !!S.haggle && S.haggle.offer === 4
    const before = s.coins
    S.answer(true)
    out.accepted = s.coins > before && L.countIn(s.inv, 'meat') === 1
    for (let i = 0; i < 200 && S.customers.length; i++) S.update(0.1)
    // Far too pricey: they walk off, nothing sold.
    S.list[0].price = 500
    S.next = 0
    S.update(0.1)
    S.next = 1e9 // one customer at a time here
    const c = S.customers[0]
    c.x = c.to.x
    c.z = c.to.z
    for (let i = 0; i < 40 && c.phase !== 'leave'; i++) S.update(0.1)
    out.walked = c.phase === 'leave' && L.countIn(s.inv, 'meat') === 1 && !S.haggle
    return out
  })
  expect(r).toEqual({ stand: true, prices: true, decide: true, gearNot: true, sellable: true, listed: true, came: true, sold: true, gone: true, haggle: true, accepted: true, walked: true })
})

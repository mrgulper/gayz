import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Couch Co-op (CouchCoop.js, 2026-11-14): the homepage tag starts a game
// split in two; Player 2 joins with a controller, walks, shoots, gets
// knocked down and revived. Game time is stepped by hand (b.update), so
// a slow test machine runs it the same.
test('couch co-op: split screen, Player 2 joins, fights, revives', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const tag = document.getElementById('home-couch-tag')
    out.tagShown = tag.style.display !== 'none' && tag.textContent.length > 0
    const tr = tag.getBoundingClientRect()
    out.tagCentre = Math.round((tr.left + tr.right) / 2 - innerWidth / 2)
    // A fake controller (the browser only lists real ones after a press).
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    // The tag's own path (Buddy), without waiting for the real Play loading.
    g._couchNext = 'buddy'
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    step(4)
    const c = s.couch
    out.couch = !!c
    out.noLobby = !s.lobby
    out.split = document.body.classList.contains('couch-split')
    out.waiting = document.getElementById('couch-p2-msg').textContent.length > 0
    // Before Player 2 picks it, the controller doesn't move Player 1.
    out.p1PadFree = !b._padMove
    // Any button joins.
    hold(0, true)
    step(2)
    hold(0, false)
    step(2)
    out.joined = c.joined
    // Player 1's HUD keeps to the left half; Player 2's to the right.
    const inHalf = (id, left) => {
      const el = document.getElementById(id)
      if (!el || getComputedStyle(el).display === 'none') return true
      const r = el.getBoundingClientRect()
      return left ? r.right <= innerWidth / 2 + 1 : r.left >= innerWidth / 2 - 1
    }
    out.leftHud = ['build-hotbar', 'build-try-map', 'build-play-health', 'build-play-ammo', 'build-try-crosshair'].filter((id) => !inHalf(id, true))
    out.rightHud = ['couch-p2-health', 'couch-p2-ammo', 'couch-p2-crosshair'].filter((id) => !inHalf(id, false))
    out.twoTargets = s._targets().filter((t) => !t.remote).length
    // The left stick walks Player 2 (not Player 1).
    const p1Before = { ...s.bodyPos() }
    const p2Before = { x: c.p2.x, z: c.p2.z }
    pad.axes[1] = -1
    step(20)
    pad.axes[1] = 0
    step(10)
    out.p2Walked = Math.hypot(c.p2.x - p2Before.x, c.p2.z - p2Before.z) > 1.5
    out.p1Stayed = Math.hypot(s.bodyPos().x - p1Before.x, s.bodyPos().z - p1Before.z) < 0.5
    // Right trigger fires (a bullet gone), RB switches guns.
    c.p2.nextShotAt = 0
    const mag = c._ammo().mag
    hold(7, true)
    step(1)
    hold(7, false)
    step(1)
    out.fired = c._ammo().mag < mag
    const gun = c._weaponId()
    hold(5, true)
    step(1)
    hold(5, false)
    step(1)
    out.switched = c._weaponId() !== gun
    // A zombie put right under Player 2's crosshair takes the hit.
    c.p2.pitch = 0
    c._placeCamera()
    const zz = s.zombies.find((o) => !o.boss && (o.tall || 1) >= 1)
    if (zz) {
      const cam = c.camera.position.clone().divideScalar(s.B)
      const dir = c.camera.getWorldDirection(c.camera.position.clone())
      const at = cam.addScaledVector(dir, 7)
      zz.x = at.x
      zz.z = at.z
      zz.y = at.y - 1
      const before = zz.health
      c._shoot({ damage: 30 })
      out.hit = !s.zombies.includes(zz) || zz.health < before
    } else out.hit = 'no zombie yet'
    // Knocked down and revived (out of the camp's safety for this).
    const safe = s._campSafe
    s._campSafe = () => false
    try {
      for (const o of s.zombies) { o.x += 300; o.z += 300 }
      c._spawnNearP1()
      c.hurtP2(1000)
      out.p2Down = c.p2.isDown
      out.p2NotChased = !s._targets().some((t) => t.hurt)
      step(70)
      out.p2Revived = !c.p2.isDown && c.p2.health > 0
      s.armor = 0
      s.health = 1
      s._hurtPlayer(50)
      out.p1Down = c.p1Down && !s.dead
      out.p1CantShoot = s.tryFire() === false
      step(70)
      out.p1Revived = !c.p1Down && s.health > 0
      // Both down: game over, back to one screen.
      s.armor = 0
      s.health = 1
      s._hurtPlayer(50)
      c.hurtP2(1000)
      step(2)
      out.over = s.dead
      out.oneScreen = !document.body.classList.contains('couch-split')
    } finally {
      s._campSafe = safe
    }
    s.stop()
    out.cleaned = !document.getElementById('couch-hud') && !s.couch
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r).toMatchObject({
    tagShown: true, tagCentre: 0, couch: true, noLobby: true, split: true, waiting: true, p1PadFree: true,
    joined: true, leftHud: [], rightHud: [], twoTargets: 2, p2Walked: true, p1Stayed: true, fired: true, switched: true,
    p2Down: true, p2NotChased: true, p2Revived: true, p1Down: true, p1CantShoot: true, p1Revived: true,
    over: true, oneScreen: true, cleaned: true,
  })
  expect([true, 'no zombie yet']).toContain(r.hit)
})

// Equal Player 2 (CouchGear.js, Batch 4c-2a): the tag asks Buddy or Equal;
// Player 2 picks a skin on joining, earns their own coins (Player 1's kills
// untouched), and uses their own Shop and Backpack with the controller.
test('couch co-op: equal Player 2 has their own coins, shop and backpack', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    // The tag turns into two tags, Buddy and Equal, in the same spot.
    const tag = document.getElementById('home-couch-tag')
    const play = document.getElementById('play-btn')
    let played = 0
    const count = () => { played++ }
    play.addEventListener('click', count, true)
    tag.click()
    const pick = document.getElementById('home-couch-pick')
    out.pickShown = !pick.hidden && pick.querySelectorAll('[data-couch]').length === 2
    const pr = pick.getBoundingClientRect()
    out.pickCentre = Math.round((pr.left + pr.right) / 2 - innerWidth / 2)
    out.pickTexts = [...pick.querySelectorAll('[data-couch]')].every((b) => b.textContent.length > 0 && b.title.length > 0)
    document.body.click()
    out.pickClosed = pick.hidden && tag.style.visibility === ''
    out.notStarted = played === 0
    play.removeEventListener('click', count, true)

    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    g._couchNext = 'equal'
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    const press = (i) => { hold(i, true); step(1); hold(i, false); step(1) }
    step(4)
    const c = s.couch
    const gear = c.gear
    out.equal = c.equal && !!gear
    press(0)
    out.joined = c.joined
    // Joining: pick a skin (every account owns Gaymi and Alisa).
    const menu = document.getElementById('couch-menu')
    out.skinPick = gear.menu?.screen === 'skin' && menu.style.display !== 'none' && menu.querySelectorAll('.couch-row').length >= 2
    const mr = menu.getBoundingClientRect()
    out.menuInRightHalf = mr.left >= innerWidth / 2 - 1
    press(13)
    press(0)
    out.skinPicked = gear.skinId !== 'default' && !gear.menuOpen
    // A kill by Player 2 pays Player 2, not Player 1.
    const p1Kills = s.kills
    const p1Coins = s.coins
    const p2Coins = gear.coins
    c.p2.pitch = 0
    c._placeCamera()
    const zz = s.zombies.find((o) => !o.boss && (o.tall || 1) >= 1)
    if (zz) {
      const cam = c.camera.position.clone().divideScalar(s.B)
      const dir = c.camera.getWorldDirection(c.camera.position.clone())
      const at = cam.addScaledVector(dir, 7)
      zz.x = at.x
      zz.z = at.z
      zz.y = at.y - 1
      zz.health = 1
      c._shoot({ damage: 50 })
      out.p2Kill = gear.kills === 1 && gear.coins > p2Coins && s.kills === p1Kills && s.coins === p1Coins
    } else out.p2Kill = 'no zombie yet'
    // Back opens the wheel; down + A = the Shop; A buys a Med Kit.
    gear.coins = 1000
    press(8)
    out.wheel = gear.menu?.screen === 'wheel'
    press(13)
    press(0)
    out.shop = gear.menu?.screen === 'shop' && gear.menu.tab === 'items'
    press(0)
    out.bought = gear.hot.some((x) => x?.id === 'medkit' && x.n === 1) && gear.coins < 1000
    // RB twice (past Traps): Upgrades tab; A buys Damage.
    press(5)
    press(5)
    press(0)
    out.upgraded = gear.upgrades.damage === 1
    // The stick doesn't walk Player 2 while their menu is open.
    const p2At = { x: c.p2.x, z: c.p2.z }
    pad.axes[1] = -1
    step(10)
    pad.axes[1] = 0
    out.stoodStill = Math.hypot(c.p2.x - p2At.x, c.p2.z - p2At.z) < 0.2
    // B back to the wheel, A on Backpack, down to the Med Kit, A uses it.
    press(1)
    out.backToWheel = gear.menu?.screen === 'wheel'
    press(12)
    press(0)
    out.pack = gear.menu?.screen === 'pack'
    for (let i = 0; i < c.weapons.length; i++) press(13)
    c.p2.health = 30
    press(0)
    out.healed = c.p2.health === 80 && !gear.hot.some((x) => x?.id === 'medkit')
    press(1)
    press(1)
    out.closed = !gear.menuOpen && menu.style.display === 'none'
    out.coinsShown = document.getElementById('couch-p2-coins').textContent.length > 0
    // Game over: the results say what Player 2 did (not saved).
    const safe = s._campSafe
    s._campSafe = () => false
    try {
      s.armor = 0
      s.health = 1
      s._hurtPlayer(50)
      c.hurtP2(1000)
      step(2)
      const line = document.getElementById('build-play-over-p2')
      out.results = s.dead && !line.hidden && line.textContent.length > 0
    } finally {
      s._campSafe = safe
    }
    // Play Again keeps Equal, the controller and the skin.
    const skin = gear.skinId
    document.getElementById('build-play-again-btn').click()
    if (s._picking) s._pickWeapon('rifle')
    step(4)
    out.againEqual = !!s.couch?.gear && s.couch.joined && s.couch.gear.skinId === skin && !s.couch.gear.menuOpen
    s.stop()
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r).toMatchObject({
    pickShown: true, pickCentre: 0, pickTexts: true, pickClosed: true, notStarted: true,
    equal: true, joined: true, skinPick: true, menuInRightHalf: true, skinPicked: true,
    wheel: true, shop: true, bought: true, upgraded: true, stoodStill: true, backToWheel: true,
    pack: true, healed: true, closed: true, coinsShown: true, results: true, againEqual: true,
  })
  expect([true, 'no zombie yet']).toContain(r.p2Kill)
})

// Equal Player 2 builds, digs, drives and picks things up (CouchHands.js,
// Batch 4c-2b) with a normal controller player's buttons.
test('couch co-op: equal Player 2 builds, digs, drives and picks up drops', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    g._couchNext = 'equal'
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    const press = (i) => { hold(i, true); step(1); hold(i, false); step(1) }
    step(4)
    const c = s.couch
    const gear = c.gear
    const hands = c.hands
    press(0)
    if (gear.menuOpen) press(1)
    out.ready = c.joined && !!hands && !gear.menuOpen
    // The hotbar: 10 slots on Player 2's half, the gun in slot 1, nothing
    // on top of the health bar or the ammo.
    const bar = document.getElementById('couch-p2-hotbar')
    out.slots = bar.querySelectorAll('.couch-hot-slot').length
    out.gunFirst = gear.hot[0]?.kind === 'gun' && gear.holdingGun()
    const box = (id) => document.getElementById(id).getBoundingClientRect()
    const hit = (a, z) => a.width && z.width && a.left < z.right && z.left < a.right && a.top < z.bottom && z.top < a.bottom
    out.barInRightHalf = box('couch-p2-hotbar').left >= innerWidth / 2 - 1
    out.noOverlap = !hit(box('couch-p2-hotbar'), box('couch-p2-ammo')) && !hit(box('couch-p2-hotbar'), box('couch-p2-health')) && !hit(box('couch-p2-ammo'), box('couch-p2-health'))
    // D-pad right opens the Shop; RB to Traps; A buys a pack of spikes.
    gear.coins = 1000
    press(15)
    out.shop = gear.menu?.screen === 'shop'
    press(5)
    out.trapsTab = gear.menu?.tab === 'traps'
    press(0)
    const spikes = gear.hot.findIndex((x) => x?.kind === 'block' && x.id === 'spikeblock')
    out.bought = spikes > 0 && gear.hot[spikes].n === 4 && gear.coins < 1000
    press(1)
    press(1)
    // RB holds the spikes: no gun in hand, the HUD names them.
    while (gear.active !== spikes) press(5)
    out.holdingBlock = gear.held()?.id === 'spikeblock' && !c.body?.gun && document.getElementById('couch-p2-weapon').textContent.length > 0
    // RT puts one down where Player 2 aims (a few looks down until one fits).
    const placedBefore = s._placed.size
    let placed = null
    for (const pitch of [-0.35, -0.3, -0.4, -0.25, -0.45, -0.5, -0.2]) {
      c.p2.pitch = pitch
      c._placeCamera()
      const aim = hands._aim()
      press(7)
      if (s._placed.size > placedBefore) {
        placed = aim?.placeAt
        break
      }
    }
    out.placed = !!placed && gear.hot[spikes].n === 3 && b.getBlockAt(...placed) === 'spikeblock'
    // A dirt block put down the same way (traps can't be broken, by
    // anyone), then LB back to the gun and holding RT on it breaks it.
    gear.add({ kind: 'block', id: 'dirt', n: 1 })
    gear.select(gear.hot.findIndex((x) => x?.id === 'dirt'))
    placed = null
    const before2 = s._placed.size
    for (const pitch of [-0.35, -0.3, -0.4, -0.25, -0.45, -0.5, -0.2, -0.15]) {
      c.p2.pitch = pitch
      c._placeCamera()
      const aim = hands._aim()
      press(7)
      if (s._placed.size > before2) {
        placed = aim?.placeAt
        break
      }
    }
    while (gear.active !== 0) press(4)
    if (placed) {
      c.p2.ammo = {}
      let progress = 0
      hold(7, true)
      for (let i = 0; i < 400 && b.getBlockAt(...placed); i++) {
        step(1)
        progress = Math.max(progress, hands.digProgress())
      }
      hold(7, false)
      step(1)
      out.dug = !b.getBlockAt(...placed) && progress > 0
    } else out.dug = 'not placed'
    // A drop at Player 2's feet flies to them, not Player 1.
    const p1Dirt = () => [...s.inv.hotbar, ...s.inv.grid].filter((x) => x?.id === 'dirt').reduce((n, x) => n + x.n, 0)
    const p2Dirt = () => [...gear.hot, ...gear.bag].filter((x) => x?.id === 'dirt').reduce((n, x) => n + x.n, 0)
    const p1Had = p1Dirt()
    const p2Had = p2Dirt()
    s._drops.spawn('dirt', Math.floor(c.p2.x), Math.floor(c.p2.y), Math.floor(c.p2.z))
    step(40)
    out.pickedUp = p2Dirt() === p2Had + 1 && p1Dirt() === p1Had
    // D-pad down throws the held block (not Player 1's: no Lost & Found).
    gear.select(spikes)
    const n = gear.hot[spikes]?.n || 0
    const drops = s._drops.list.length
    press(13)
    out.dropped = (gear.hot[spikes]?.n || 0) === n - 1 && s._drops.list.length === drops + 1 && s._drops.list.at(-1).mine === false
    // The go-kart: Y next to it gets in; the stick drives; Player 1 can't
    // take it; Y gets out beside it.
    gear.select(0)
    s.kart.park(s.bodyPos())
    c.p2.x = s.kart.x + 1.2
    c.p2.z = s.kart.z
    c.p2.y = s.kart.y
    press(3)
    out.inKart = hands.ride?.kind === 'kart' && s.kart.p2 === true
    out.p1CantTake = s.kart.use() === false && !s.kart.driving
    const k0 = { x: s.kart.x, z: s.kart.z }
    pad.axes[1] = -1
    step(30)
    pad.axes[1] = 0
    step(5)
    out.drove = Math.hypot(s.kart.x - k0.x, s.kart.z - k0.z) > 1 && Math.hypot(c.p2.x - s.kart.x, c.p2.z - s.kart.z) < 0.01
    press(3)
    out.outOfKart = !hands.ride && !s.kart.p2
    // A helicopter Player 1 put down: Player 2 gets in with Y (if there was
    // room for one here).
    if (s.vehicles.place('heli')) {
      const v = s.vehicles.list.at(-1)
      c.p2.x = v.x + 1.5
      c.p2.z = v.z
      c.p2.y = v.y
      press(3)
      out.inHeli = hands.ride?.v === v && s.vehicles.p2Riding === v && !s.vehicles.riding
      out.fuelShown = document.getElementById('couch-p2-ride').textContent.length > 0
      hands.leave(true)
      out.outOfHeli = !hands.ride && !s.vehicles.p2Riding
    } else {
      out.inHeli = out.fuelShown = out.outOfHeli = 'no room'
    }
    s.stop()
    out.cleaned = !s.kart?.p2 && !document.getElementById('couch-hud')
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r).toMatchObject({
    ready: true, slots: 10, gunFirst: true, barInRightHalf: true, noOverlap: true, shop: true, trapsTab: true, bought: true,
    holdingBlock: true, placed: true, dug: true, pickedUp: true, dropped: true,
    inKart: true, p1CantTake: true, drove: true, outOfKart: true, cleaned: true,
  })
  for (const k of ['inHeli', 'fuelShown', 'outOfHeli']) expect([true, 'no room']).toContain(r[k])
})

// Batch 4c-2c: equal Player 2 crafts, opens their own chests, fishes,
// farms and emotes. Aiming at a block is covered above, so here Player 2's
// aim is pointed straight at the block under test (hands._aim).
test('couch co-op: equal Player 2 crafts, opens chests, fishes, farms and emotes', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    g._couchNext = 'equal'
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    const press = (i) => { hold(i, true); step(1); hold(i, false); step(1) }
    step(4)
    const c = s.couch
    const gear = c.gear
    const hands = c.hands
    press(0)
    if (gear.menuOpen) press(1)
    const count = (list, id) => list.filter((x) => x?.id === id).reduce((n, x) => n + x.n, 0)
    const p2Has = (id) => count([...gear.hot, ...gear.bag], id)
    const p1Has = (id) => count([...s.inv.hotbar, ...s.inv.grid], id)
    const aimAt = (x, y, z) => { hands._aim = () => ({ existingBlock: [x, y, z] }) }
    const msg = () => document.getElementById('couch-p2-msg')?.textContent || ''

    // The menu wheel (Back) now has Crafting and Emotes.
    press(8)
    out.wheel = gear._rows().map((row) => row.name)
    // Crafting: two logs -> planks, from Player 2's own bag.
    gear.add({ kind: 'block', id: 'oaklog', n: 2 })
    press(13)
    press(13)
    press(0)
    out.craftScreen = gear.menu?.screen === 'craft'
    const rows = gear._rows()
    const planks = rows.findIndex((row) => row.name.includes(b.blockName('oakplanks')))
    gear.menu.focus = planks
    const p1Logs = p1Has('oaklog')
    press(0)
    out.crafted = p2Has('oakplanks') === 4 && p2Has('oaklog') === 1 && p1Has('oaklog') === p1Logs
    out.craftShown = !!document.querySelector('#couch-menu .couch-row')
    press(1)
    press(1)

    // Items: a crafted helmet is worn (armour), a guitar is Player 1's.
    gear.add({ kind: 'item', id: 'helmet', n: 1 })
    gear.select(gear.hot.findIndex((x) => x?.id === 'helmet'))
    press(7)
    out.helmet = gear.armor === 25 && p2Has('helmet') === 0
    gear.add({ kind: 'item', id: 'guitar', n: 1 })
    gear.select(gear.hot.findIndex((x) => x?.id === 'guitar'))
    press(7)
    out.p1Only = p2Has('guitar') === 1 && msg().length > 0
    // A crafted helicopter goes down in front of Player 2 (if there's room).
    gear.add({ kind: 'item', id: 'helicopter', n: 1 })
    gear.select(gear.hot.findIndex((x) => x?.id === 'helicopter'))
    const vehicles = s.vehicles.list.length
    press(7)
    out.heli = s.vehicles.list.length === vehicles + 1 ? p2Has('helicopter') === 0 : 'no room'
    // (Taken away again: Y next to a vehicle gets in before it opens a chest.)
    if (s.vehicles.list.length > vehicles) s.vehicles._remove(s.vehicles.list.at(-1))

    // Loot chest: Player 2's own loot, once a wave; Player 1 still gets theirs.
    const cx = Math.floor(c.p2.x) + 2
    const cz = Math.floor(c.p2.z)
    let cy = Math.floor(c.p2.y)
    while (b.getBlockAt(cx, cy, cz) && cy < c.p2.y + 3) cy++
    b.placeBlock(cx, cy, cz, 'lootchest', false)
    aimAt(cx, cy, cz)
    gear.select(0)
    const reserve = c._ammo().reserve
    press(3)
    out.chest = gear.chests === 1 && c._ammo().reserve > reserve && !s._chestsUsed.has(b._key(cx, cy, cz))
    press(3)
    out.chestOnce = gear.chests === 1
    out.p1Chest = s.useChest(cx, cy, cz) && s._chestsUsed.has(b._key(cx, cy, cz))
    out.chestQuest = gear.quests.some((q) => q.stat === 'chests')
    b.removeBlock?.(cx, cy, cz)

    // Farming: a Crop Plot placed in the camp joins Player 1's saved farm;
    // Player 2 plants it, and the harvest goes in Player 2's Backpack.
    const zn = s.camp.zone
    let plot = null
    for (let dx = 2; dx < 12 && !plot; dx++) {
      for (let dz = 2; dz < 12 && !plot; dz++) {
        const x = Math.floor((zn.x0 + zn.x1) / 2) + dx
        const z = Math.floor((zn.z0 + zn.z1) / 2) + dz
        if (!s.camp.inside(x + 0.5, z + 0.5)) continue
        const y = Math.floor(s._groundUnder(x + 0.5, 80, z + 0.5))
        const before = s.farm.plots.length
        if (s.placeBlockAt(x, y, z, 'cropplot') && s.farm.plots.length === before + 1) plot = [x, y, z]
      }
    }
    if (plot) {
      Object.assign(c.p2, { x: plot[0] + 1.5, y: plot[1], z: plot[2] + 0.5 })
      aimAt(...plot)
      press(3)
      const fp = s.farm._plotAt(...plot)
      out.planted = !!fp?.at
      fp.at = Date.now() - 3600 * 1000
      s.farm._sync()
      const p1Veg = p1Has('veggies')
      press(3)
      out.harvested = p2Has('veggies') > 0 && p2Has('plantFiber') > 0 && p1Has('veggies') === p1Veg && fp.at === 0
    } else out.planted = out.harvested = 'no spot'
    delete hands._aim

    // Fishing: the rod from Player 2's Shop, RT casts, RT on the bite reels in.
    gear.coins = 1000
    press(15)
    while (gear.menu.tab !== 'items') press(5)
    gear.menu.focus = gear._rows().findIndex((row) => row.name === gear.label({ kind: 'item', id: 'fishingRod' }))
    press(0)
    out.rodBought = p2Has('fishingRod') === 1
    out.oneRod = gear._rows()[gear.menu.focus].off === true
    press(1)
    press(1)
    gear.select(gear.hot.findIndex((x) => x?.id === 'fishingRod'))
    hands.fishing._waterInView = () => ({ x: c.p2.x + 4, y: c.p2.y, z: c.p2.z, cx: Math.floor(c.p2.x + 4), cz: Math.floor(c.p2.z) })
    press(7)
    out.cast = hands.fishing.out && !s.fishing.out
    for (let i = 0; i < 300 && !(hands.fishing.bob?.bite > 0); i++) step(1)
    out.bite = hands.fishing.bob?.bite > 0 && msg().length > 0
    const aq = JSON.parse(localStorage.getItem('gayz-aquarium') || '{}').fish || 0
    const rand = Math.random
    Math.random = () => 0.1
    try { press(7) } finally { Math.random = rand }
    out.caught = p2Has('fish') === 1 && p1Has('fish') === 0 && !hands.fishing.out
    out.aquarium = (JSON.parse(localStorage.getItem('gayz-aquarium') || '{}').fish || 0) === aq + 1

    // Emotes: D-pad left, A plays one; walking stops it.
    gear.select(0)
    press(14)
    out.emoteList = gear.menu?.screen === 'emote' && gear._rows().length === 6
    press(0)
    // (Player 2's body loads its skin first.)
    for (let i = 0; i < 60 && !c.body; i++) await new Promise((res) => setTimeout(res, 50))
    step(3)
    out.emoting = gear.emote?.id === 'dance' && !gear.menuOpen && Math.abs(c.body.char.limbPivots.armR.rotation.x) > 0.2
    pad.axes[1] = -1
    step(10)
    pad.axes[1] = 0
    step(2)
    out.emoteStopped = !gear.emote

    s.stop()
    out.cleaned = !document.getElementById('couch-hud')
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r.wheel).toHaveLength(5)
  expect(r).toMatchObject({
    craftScreen: true, crafted: true, craftShown: true, helmet: true, p1Only: true,
    chest: true, chestOnce: true, p1Chest: true, chestQuest: true, planted: true, harvested: true,
    rodBought: true, oneRod: true, cast: true, bite: true, caught: true, aquarium: true,
    emoteList: true, emoting: true, emoteStopped: true, cleaned: true,
  })
  expect([true, 'no room']).toContain(r.heli)
})

// Batch 5a (CouchToys.js): equal Player 2's potions, jetpack, wingsuit,
// kite, skateboard, sled, bike and hoverboard - their own, never Player 1's.
test('couch co-op: equal Player 2 drinks potions, flies and rides', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    g._couchNext = 'equal'
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    const press = (i) => { hold(i, true); step(1); hold(i, false); step(1) }
    step(4)
    const c = s.couch
    const gear = c.gear
    const toys = c.toys
    press(0)
    if (gear.menuOpen) press(1)
    const count = (list, id) => list.filter((x) => x?.id === id).reduce((n, x) => n + x.n, 0)
    const p2Has = (id) => count([...gear.hot, ...gear.bag], id)
    const holdItem = (id) => {
      gear.add({ kind: 'item', id, n: 1 })
      gear.select(gear.hot.findIndex((x) => x?.id === id))
    }
    // Zombies stay away while we look (only the items are tested here).
    for (const z of s.zombies || []) z.hp = 0

    // Potions: Speed is Player 2's own (Player 1 gets no buff).
    holdItem('potionSpeed')
    press(7)
    out.speedOn = toys.speedMult() > 1 && !b.specials._buff('speed') && p2Has('potionSpeed') === 0
    out.potionPill = (document.getElementById('couch-p2-ride')?.textContent || '').length > 0
    // Giant: bigger body and harder hits; Tiny cancels it.
    holdItem('potionGiant')
    press(7)
    step(20)
    out.giant = toys.size > 1.5 && c.group.scale.x > 1.3 && gear.damageMult() > 1 && c._height() > 2.5
    holdItem('potionTiny')
    press(7)
    out.tiny = toys.size < 1 && !toys.buffs.grow
    // Invisible: no longer a zombie target.
    holdItem('potionInvis')
    press(7)
    out.invisible = c.target() === null && toys.invisible
    // They wear off.
    step(Math.ceil(31 / 0.1), 0.1)
    out.wornOff = toys.speedMult() === 1 && toys.size === 1 && !!c.target()

    // Jetpack in the bag: A held in the air flies Player 2 up.
    gear.select(0)
    gear.add({ kind: 'item', id: 'jetpack', n: 1 })
    c.p2.y += 4
    c.p2.vy = 0
    c.p2.onGround = false
    const y0 = c.p2.y
    hold(0, true)
    step(20)
    hold(0, false)
    out.jetpack = c.p2.y > y0 && toys.jet.fuel < 1 && s.jetpack.fuel === 1
    gear.add({ kind: 'item', id: 'jetFuel', n: 1 })
    gear.select(gear.hot.findIndex((x) => x?.id === 'jetFuel'))
    press(7)
    out.refuel = toys.jet.fuel === 1 && p2Has('jetFuel') === 0
    step(30)

    // Kite: held and used with RT; Player 1's stays down.
    holdItem('kite')
    press(7)
    step(2)
    out.kite = toys.kite.up && !s.kite?.up && !!toys.kite.mesh
    gear.select(0)
    step(2)
    out.kiteReeled = !toys.kite.up

    // Skateboard: faster on it, coins for tricks go to Player 2.
    holdItem('skateboard')
    press(7)
    out.skate = toys.skate.on && !s.skate?.on && !!toys.glide(true)?.speed
    const coins = gear.coins
    toys.skate.landed = ['kickflip']
    toys.skate._air = true
    c.p2.onGround = true
    step(1)
    out.trickCoins = gear.coins > coins
    gear.select(0)
    step(2)
    out.skateOff = !toys.skate.on

    // Sled, bike and hoverboard.
    holdItem('sled')
    press(7)
    out.sled = toys.sled.on && !s.sled?.on
    gear.select(0)
    step(2)
    holdItem('bike')
    press(7)
    out.bike = toys.rides.on === 'bike' && !s.rides?.on && c.target()?.quiet === true
    gear.select(0)
    step(2)
    holdItem('hoverboard')
    press(7)
    out.hover = toys.rides.on === 'hover'
    gear.select(0)
    step(2)
    out.ridesOff = !toys.rides.on && !c.target()?.quiet

    // Wingsuit: falling from high up opens it and glides Player 2 forward.
    gear.add({ kind: 'item', id: 'wingsuit', n: 1 })
    c.p2.y += 40
    c.p2.vy = -20
    c.p2.onGround = false
    step(3)
    out.wing = toys.wing.open && !s.wing?.open
    toys.stop()

    // The Backpack: a kite says "hold it", the jetpack "works from the bag".
    const rows = gear._packRows()
    const about = (id) => rows.find((row) => row.name.startsWith(gear.label({ kind: 'item', id })))?.detail || ''
    out.packText = about('kite').length > 0 && about('jetpack').length > 0 && about('kite') !== about('jetpack')

    s.stop()
    out.cleaned = !document.getElementById('couch-hud') && !toys.kite.mesh
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r).toEqual({
    speedOn: true, potionPill: true, giant: true, tiny: true, invisible: true, wornOff: true,
    jetpack: true, refuel: true, kite: true, kiteReeled: true, skate: true, trickCoins: true, skateOff: true,
    sled: true, bike: true, hover: true, ridesOff: true, wing: true, packText: true, cleaned: true,
  })
})

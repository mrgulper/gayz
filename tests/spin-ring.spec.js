// Spin ring.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// The spin ring (SpinRing.js, 2026-11-15): zombie modes have no guns - items
// spin round you, spread with attack, pull in with defend, hurt zombies and
// heal you. (Tests keep guns unless they set window.__ringForTests.)
async function startRingGame(page) {
  await page.evaluate(() => {
    const g = window.__game
    window.__ringForTests = true
    localStorage.removeItem('gayz-play-saved-run')
    g.careerStats.totalRuns = 1
    g.settings.selectedGameMode = 'classic'
    g.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
}

test('Spin ring: no guns in zombie modes, spread / pull in, hits, heals, works in Spectate', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await startRingGame(page)
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const ring = s.ring
    const out = {}
    out.ring = !!ring && ring.items.map((it) => it.id).join(',')
    out.noPicker = !s._picking && getComputedStyle(document.getElementById('play-weapon-pick') || document.body).display !== 'flex'
    out.noGun = ![...s.inv.hotbar, ...s.inv.grid].some((it) => it?.kind === 'gun') && s.holding?.kind === 'none'
    out.gunAdd = s.inv.add({ kind: 'gun', id: 'rifle', n: 1 }) === 0 && ![...s.inv.hotbar, ...s.inv.grid].some((it) => it?.kind === 'gun')
    out.noShot = s.tryFire() === false
    out.bar = getComputedStyle(document.getElementById('play-ring-bar')).display === 'flex' && document.querySelectorAll('#play-ring-bar .ring-slot svg').length === 3
    out.ammoHidden = getComputedStyle(document.getElementById('build-play-ammo')).display === 'none'
    // Overlaps on a computer: the ring bar is clear of the hotbar.
    const a = document.getElementById('play-ring-bar').getBoundingClientRect()
    const h = document.getElementById('build-hotbar').getBoundingClientRect()
    out.clearOfHotbar = a.left >= h.right - 1 && a.right <= innerWidth
    // Spread, pull in, back to normal.
    const step = (n) => { for (let i = 0; i < n; i++) ring.update(1 / 30) }
    bm._fireHeld = true
    step(45)
    out.spread = +ring.radius.toFixed(2)
    bm._fireHeld = false
    bm._ringPull = true
    step(45)
    out.pulled = +ring.radius.toFixed(2)
    bm._onPointerUp({ button: 2 })
    step(45)
    out.normal = +ring.radius.toFixed(2)
    // A zombie standing in the ring's path gets hit.
    const p = s.bodyPos()
    const z = s.zombies[0] || s._makeZombie(++s._zid, p.x + 5, p.y, p.z, 100, false)
    if (!s.zombies.includes(z)) s.zombies.push(z)
    z.health = z.maxHealth = 1000
    for (let i = 0; i < 90; i++) {
      z.x = p.x + ring.radius
      z.z = p.z
      z.y = p.y
      ring.update(1 / 30)
    }
    out.hurtZombie = z.health < 1000
    // The Bandage heals you when you're hurt, then grows back.
    s.health = 40
    step(30)
    out.healed = s.health > 40
    out.bandageCd = ring.items.find((it) => it.id === 'bandage').cd > 0
    // Spectate: the ring stays round your body, not the camera.
    bm.toggleMenu()
    out.noSwitch = getComputedStyle(document.getElementById('play-pause-weapon-btn')).display === 'none'
    document.getElementById('play-pause-spectate-btn').click()
    bm._keys.add('KeyW')
    for (let i = 0; i < 30; i++) bm.update(1 / 30)
    bm._keys.clear()
    step(5)
    const body = s.bodyPos()
    const it = ring.items[0]
    out.spectateBody = Math.abs(Math.hypot(it.wx - body.x, it.wz - body.z) - it.r) < 0.05 && bm.tryMode.pos.distanceTo(body) > 2
    out.spectateShown = ring.group.visible
    return out
  })
  expect(r).toEqual({
    ring: 'brick,sawblade,bandage', noPicker: true, noGun: true, gunAdd: true, noShot: true, bar: true, ammoHidden: true, clearOfHotbar: true,
    spread: 3.4, pulled: 1, normal: 1.8, hurtZombie: true, healed: true, bandageCd: true, noSwitch: true, spectateBody: true, spectateShown: true,
  })
  // Party games keep their guns.
  const party = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    s.stop()
    await g._exitBuildMode?.()
    g.settings.selectedGameMode = 'laserTag'
    g.playBtn.click()
    for (let i = 0; i < 600 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    return { active: s.active, ring: !!s.ring, bar: !!document.getElementById('play-ring-bar') }
  })
  expect(party).toEqual({ active: true, ring: false, bar: false })
})

// Spin ring Batch 2 (RingItems.js, RingLoot.js, RingEditor.js): 9 items x 6
// rarities, every zombie drops one, the bag saves, the editor swaps items.
test('Spin ring items: drops for every zombie, the bag, the ring editor, item tricks, Spectate', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.removeItem('gayz-ring-bag')
    localStorage.removeItem('gayz-ring-loadout')
  })
  await startRingGame(page)
  const r = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const out = {}
    const RI = s.ring.constructor.lib
    out.items = RI.ITEM_IDS.length
    out.rarities = RI.RARITIES.join(',')
    // Rarer = stronger.
    out.stronger = RI.itemStats('brick', 'mythic').damage > RI.itemStats('brick', 'rare').damage && RI.itemStats('brick', 'rare').damage > RI.itemStats('brick', 'common').damage
    // Rolls: always something; bosses Rare or better.
    let rolls = 0
    let bossOk = true
    for (let i = 0; i < 300; i++) {
      if (RI.parseKey(RI.rollDrop(false))) rolls++
      if (RI.rarityIndex(RI.parseKey(RI.rollDrop(true)).rarity) < 2) bossOk = false
    }
    out.rolls = rolls
    out.bossOk = bossOk
    // Kill a zombie: a drop appears, and walking into it puts it in the bag.
    const p = s.bodyPos()
    const z = s._makeZombie(++s._zid, p.x + 3, p.y, p.z, 100, false)
    s.zombies.push(z)
    z.tier = 'common'
    const before = s.ringLoot.list.length
    s.damageZombie(z, 99999, null)
    out.dropped = s.ringLoot.list.length === before + 1
    const d = s.ringLoot.list[s.ringLoot.list.length - 1]
    const key = d.key
    d.x = p.x + 0.3
    d.z = p.z
    d.y = p.y + 0.8
    d.age = 5
    for (let i = 0; i < 20; i++) s.ringLoot.update(1 / 30)
    out.picked = !s.ringLoot.list.includes(d) && RI.owned(key) >= 1
    out.saved = JSON.parse(localStorage.getItem('gayz-ring-bag'))[key] >= 1
    // The editor: open with the key, put a Rare Ice Cube in slot 2.
    RI.addToBag('icecube:rare', 1)
    s.onKeyDown('KeyI')
    const ed = s.ringEditor
    out.open = ed.isOpen && getComputedStyle(document.getElementById('play-ring-editor')).display === 'flex'
    out.mouseScreen = bm.mouseScreenOpen()
    out.bagShows = !!document.querySelector('.ring-ed-item[data-key="icecube:rare"]')
    document.querySelector('.ring-ed-slot[data-i="1"]').click()
    document.querySelector('.ring-ed-item[data-key="icecube:rare"]').click()
    out.swapped = s.ring.keys.join(',')
    out.ringItems = s.ring.items.map((it) => it.key).join(',')
    out.savedRing = localStorage.getItem('gayz-ring-loadout')
    out.info = document.querySelector('.ring-ed-info').textContent.includes('Ice Cube')
    // Can't add a 2nd copy you don't own: it moves instead.
    document.querySelector('.ring-ed-slot[data-i="2"]').click()
    document.querySelector('.ring-ed-item[data-key="icecube:rare"]').click()
    out.oneCopy = s.ring.keys.filter((k) => k === 'icecube:rare').length
    // Take out.
    document.querySelector('.ring-ed-out').click()
    out.emptied = s.ring.keys[2] === '' && s.ring.items.length === 2
    out.emptyBarSlot = !!document.querySelector('#play-ring-bar .ring-slot-empty')
    s.onKeyDown('KeyI')
    out.closed = !ed.isOpen
    // Item tricks.
    const zz = s._makeZombie(++s._zid, p.x + 9, p.y, p.z, 100, false)
    s.zombies.push(zz)
    zz.health = zz.maxHealth = 5000
    // Ice Cube slows.
    s.ring.setLoadout(['icecube:rare', '', ''])
    const ice = s.ring.items[0]
    ice.wx = zz.x; ice.wy = zz.y + 1; ice.wz = zz.z
    s.ring._touch(ice)
    out.slowed = zz.slow > 0 && ice.cd > 0
    // Shield soaks a bite (out of the camp, where nothing can hurt you).
    s._campSafe = () => false
    if (s.skills) s.skills.blocksHit = () => false
    s.ring.setLoadout(['shield:common', '', ''])
    s.health = 100
    s._hurtPlayer(10)
    out.shielded = s.health === 100 && s.ring.items[0].cd > 0
    s._hurtPlayer(10)
    out.thenHurt = s.health < 100
    // Cactus pricks back.
    s.ring.setLoadout(['cactus:common', '', ''])
    const h0 = zz.health
    s.ring.onBitten(zz)
    out.thorns = zz.health < h0
    // Battery jumps to a neighbour.
    const z2 = s._makeZombie(++s._zid, zz.x + 1.5, zz.y, zz.z, 100, false)
    s.zombies.push(z2)
    z2.health = z2.maxHealth = 5000
    s.ring.setLoadout(['battery:common', '', ''])
    const bat = s.ring.items[0]
    bat.wx = zz.x; bat.wy = zz.y + 1; bat.wz = zz.z
    s.ring._touch(bat)
    out.zapped = z2.health < 5000
    // Firecracker hurts both.
    const a0 = zz.health
    const b0 = z2.health
    s.ring.setLoadout(['firecracker:common', '', ''])
    const fc = s.ring.items[0]
    fc.wx = zz.x; fc.wy = zz.y + 1; fc.wz = zz.z
    s.ring._touch(fc)
    out.blast = zz.health < a0 && z2.health < b0
    // Magnet: pulls from further.
    s.ring.setLoadout(['magnet:common', '', ''])
    out.magnet = s.ring.pullRange(2.2) >= 6
    // Ring bar click opens the editor; the pause menu has Ring & Bag.
    document.getElementById('play-ring-bar').click()
    out.barOpens = ed.isOpen
    ed.close(false)
    bm.toggleMenu()
    const ringBtn = document.getElementById('play-pause-ring-btn')
    out.pauseBtn = getComputedStyle(ringBtn).display !== 'none' && ringBtn.textContent.trim() === 'Ring & Bag'
    // Spectate: the editor still opens.
    document.getElementById('play-pause-spectate-btn').click()
    out.spectating = !!bm.spectate.active
    s.onKeyDown('KeyI')
    out.spectateEditor = ed.isOpen
    ed.close(false)
    // Game over: drops cleared.
    s.stop()
    out.cleared = !document.querySelector('#play-ring-bar') && !s.ringLoot
    return out
  })
  expect(r).toEqual({
    items: 9, rarities: 'common,uncommon,rare,epic,legendary,mythic', stronger: true, rolls: 300, bossOk: true,
    dropped: true, picked: true, saved: true, open: true, mouseScreen: true, bagShows: true,
    swapped: 'brick:common,icecube:rare,bandage:common', ringItems: 'brick:common,icecube:rare,bandage:common',
    savedRing: '["brick:common","icecube:rare","bandage:common"]', info: true, oneCopy: 1, emptied: true, emptyBarSlot: true, closed: true,
    slowed: true, shielded: true, thenHurt: true, thorns: true, zapped: true, blast: true, magnet: true,
    barOpens: true, pauseBtn: true, spectating: true, spectateEditor: true, cleared: true,
  })
})

// Spin ring Batch 3: merge 5 -> 1, the Shop's Ring tab (Points), slots 3 -> 10.
test('Spin ring tutorial: step by step, waits for each, Skip, once only, balance numbers', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    window.__ringTutorialForTests = true
    localStorage.removeItem('gayz-ring-tutorial')
    localStorage.removeItem('gayz-ring-bag')
    localStorage.removeItem('gayz-ring-loadout')
  })
  await startRingGame(page)
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const tut = s.ringTutorial
    const out = { steps: [] }
    const el = () => document.getElementById('play-ring-tutorial')
    const run = (sec) => { for (let i = 0; i < sec * 30; i++) tut.update(1 / 30) }
    out.on = !!tut?.active && getComputedStyle(el()).display === 'flex'
    out.steps.push(tut.name)
    out.text1 = el().querySelector('.ring-tut-text').textContent
    // Waits: nothing pressed, nothing moves on.
    bm._fireHeld = false
    bm._ringPull = false
    run(3)
    out.waits = tut.name === 'spread'
    // Hold attack: spread done.
    bm._fireHeld = true
    run(1)
    out.ticked = el().classList.contains('ring-tut-ticked')
    run(1)
    bm._fireHeld = false
    out.steps.push(tut.name)
    // Hold defend: pull done.
    bm._ringPull = true
    run(2)
    bm._ringPull = false
    out.steps.push(tut.name)
    // A wrong-step hook does nothing.
    tut.did('swap')
    out.wrongIgnored = tut.name === 'pickup'
    // Pick up a drop.
    const RI = s.ring.constructor.lib
    const p = s.bodyPos()
    const z = s._makeZombie(++s._zid, p.x + 3, p.y, p.z, 100, false)
    s.zombies.push(z)
    z.tier = 'common'
    s.damageZombie(z, 99999, null)
    const d = s.ringLoot.list[s.ringLoot.list.length - 1]
    d.x = p.x + 0.3
    d.z = p.z
    d.y = p.y + 0.8
    d.age = 5
    for (let i = 0; i < 20; i++) s.ringLoot.update(1 / 30)
    run(1)
    out.steps.push(tut.name)
    // Open the bag.
    s.onKeyDown('KeyI')
    run(1)
    out.steps.push(tut.name)
    out.aboveBag = Number(getComputedStyle(el()).zIndex) > Number(getComputedStyle(document.getElementById('play-ring-editor')).zIndex)
    // Swap an item in.
    RI.addToBag('icecube:rare', 1)
    s.ringEditor.render()
    document.querySelector('.ring-ed-slot[data-i="1"]').click()
    document.querySelector('.ring-ed-item[data-key="icecube:rare"]').click()
    run(1)
    out.steps.push(tut.name)
    out.saved = localStorage.getItem('gayz-ring-tutorial')
    out.noSkipLast = getComputedStyle(el().querySelector('.ring-tut-skip')).display === 'none'
    s.onKeyDown('KeyI')
    run(7)
    out.gone = !tut.active && !el()
    // Skip: a fresh one, the Skip button ends it for good.
    localStorage.removeItem('gayz-ring-tutorial')
    const t2 = new tut.constructor(s)
    s.ringTutorial = t2
    el().querySelector('.ring-tut-skip').click()
    out.skipped = !t2.active && !el() && localStorage.getItem('gayz-ring-tutorial') === '1'
    // Balance pass numbers.
    out.slot4 = RI.SLOT_COSTS[0]
    out.weights = Math.round(RI.DROP_WEIGHTS.reduce((a, b) => a + b, 0))
    out.box = RI.BOX_COST
    return out
  })
  expect(r.on).toBe(true)
  expect(r.text1).toContain('Left Click')
  expect(r.waits).toBe(true)
  expect(r.ticked).toBe(true)
  expect(r.wrongIgnored).toBe(true)
  expect(r.steps).toEqual(['spread', 'pull', 'pickup', 'bag', 'swap', 'done'])
  expect(r.aboveBag).toBe(true)
  expect(r.saved).toBe('1')
  expect(r.noSkipLast).toBe(true)
  expect(r.gone).toBe(true)
  expect(r.skipped).toBe(true)
  expect(r.slot4).toBe(250)
  expect(r.weights).toBe(1000)
  expect(r.box).toBe(300)
})

test('Spin ring merge, Ring Shop for Points, more slots, Spectate', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.removeItem('gayz-ring-bag')
    localStorage.removeItem('gayz-ring-loadout')
    localStorage.removeItem('gayz-ring-shop')
  })
  await startRingGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const bm = g.buildMode
    const s = bm.survival
    const RI = s.ring.constructor.lib
    g.settings.confirmBuyOver = 'never'
    const out = {}
    // Merge: 12 Common Bricks -> Merge = 7 + 1 Uncommon; Merge All = 2 + 2.
    RI.addToBag('brick:common', 12)
    s.onKeyDown('KeyI')
    const ed = s.ringEditor
    document.querySelector('.ring-ed-item[data-key="brick:common"]').click()
    const btns = () => [...document.querySelectorAll('.ring-ed-merge button')]
    out.mergeBtns = btns().length
    btns()[0].click()
    out.afterOne = [RI.loadBag()['brick:common'], RI.loadBag()['brick:uncommon']].join()
    document.querySelector('.ring-ed-item[data-key="brick:common"]').click()
    out.noAll = btns().length
    btns()[0].click()
    out.afterTwo = [RI.loadBag()['brick:common'], RI.loadBag()['brick:uncommon']].join()
    out.direct = RI.mergeItem('brick:common', Infinity).made
    RI.addToBag('cactus:mythic', 7)
    out.mythicNo = RI.mergesAvailable('cactus:mythic')
    // Shop button in the Ring Bag -> Shop on the Ring tab.
    document.querySelector('.ring-ed-shop').click()
    out.shopRing = s.shop.panelOpen && s.shop.tab === 'ring' && !ed.isOpen
    out.tabs = s.shop.tabs()[0]
    // Points.
    g.metaProgress.legacyPoints = 100000
    g.metaProgress.ringSlotsBought = 0
    s.shop._panelKey = ''
    s.shop._renderPanel()
    out.pointsLine = document.getElementById('play-npc-coins').textContent.includes('100,000')
    // Buy x5 Common Saw Blades.
    document.querySelector('[data-act="ringQty"][data-id="5"]').click()
    document.querySelector('[data-act="ringPick"][data-id="sawblade"]').click()
    document.querySelector('[data-act="ringBuy"][data-id="sawblade:common"]').click()
    out.bought5 = RI.loadBag()['sawblade:common']
    out.paid = g.metaProgress.legacyPoints === 100000 - 5 * RI.SHOP_PRICES[0]
    out.savedPoints = JSON.parse(localStorage.getItem('gayz-meta-progress')).legacyPoints === g.metaProgress.legacyPoints
    // Custom amount.
    document.querySelector('[data-act="ringQty"][data-id="custom"]').click()
    const inp = document.getElementById('ring-shop-qty')
    inp.value = '3'
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('[data-act="ringBuy"][data-id="sawblade:common"]').click()
    out.boughtCustom = RI.loadBag()['sawblade:common']
    // Epic and up: in stock some days, one each, then sold out.
    const day = RI.todayKey()
    const stocked = RI.ITEM_IDS.map((id) => `${id}:epic`).find((k) => RI.stockOf(k, day) === 'today')
    if (stocked) {
      document.querySelector(`[data-act="ringPick"][data-id="${stocked.split(':')[0]}"]`).click()
      document.querySelector(`[data-act="ringBuy"][data-id="${stocked}"]`).click()
      out.rareOnce = RI.stockOf(stocked, day) === 'sold' && RI.loadBag()[stocked] === 1 && document.querySelector(`[data-act="ringBuy"][data-id="${stocked}"]`).disabled
    } else out.rareOnce = true
    // Over 30 days, Mythic is in stock less often than Epic.
    let epic = 0
    let myth = 0
    for (let d = 1; d <= 30; d++) for (const id of RI.ITEM_IDS) {
      if (RI.stockOf(`${id}:epic`, `2026-01-${d}`) !== 'none') epic++
      if (RI.stockOf(`${id}:mythic`, `2026-01-${d}`) !== 'none') myth++
    }
    out.rarer = epic > myth
    // Mystery Box.
    const bagSize = () => Object.values(RI.loadBag()).reduce((a, b) => a + b, 0)
    const before = bagSize()
    document.querySelector('[data-act="ringBox"]').click()
    out.box = bagSize() === before + 1 && !!document.querySelector('.ring-shop-got')
    // Slots: buy up to 10, the ring and its bar grow, then maxed.
    for (let i = 0; i < 7; i++) document.querySelector('[data-act="ringSlot"]').click()
    out.slots = RI.ringSlots()
    out.ringKeys = s.ring.keys.length
    out.barSlots = document.querySelectorAll('#play-ring-bar .ring-slot').length
    out.barMany = document.getElementById('play-ring-bar').classList.contains('ring-many')
    out.maxed = document.querySelector('[data-act="ringSlot"]').disabled
    out.savedSlots = JSON.parse(localStorage.getItem('gayz-meta-progress')).ringSlotsBought
    s.shop.closePanel(false)
    // The editor shows 10 slots, and slot 10 takes an item.
    s.onKeyDown('KeyI')
    out.edSlots = document.querySelectorAll('.ring-ed-slot').length
    document.querySelector('.ring-ed-slot[data-i="9"]').click()
    document.querySelector('.ring-ed-item[data-key="sawblade:common"]').click()
    out.slot10 = s.ring.keys[9] === 'sawblade:common' && s.ring.items.some((it) => it.slot === 9)
    ed.close(false)
    // Desktop bar stays on screen with 10 slots.
    const bar = document.getElementById('play-ring-bar').getBoundingClientRect()
    out.barOnScreen = bar.right <= innerWidth && bar.top >= 0
    // Spectate: the Shop opens, Ring tab only.
    bm.toggleMenu()
    document.getElementById('play-pause-spectate-btn').click()
    s.onKeyDown('KeyB')
    out.spectateShop = s.shop.panelOpen && s.shop.tabs().join() === 'ring'
    s.shop.closePanel(false)
    return out
  })
  expect(r).toEqual({
    mergeBtns: 2, afterOne: '7,1', noAll: 1, afterTwo: '2,2', direct: 0, mythicNo: 0,
    shopRing: true, tabs: 'ring', pointsLine: true, bought5: 5, paid: true, savedPoints: true, boughtCustom: 8,
    rareOnce: true, rarer: true, box: true,
    slots: 10, ringKeys: 10, barSlots: 10, barMany: true, maxed: true, savedSlots: 7, edSlots: 10, slot10: true, barOnScreen: true,
    spectateShop: true,
  })
})

test.describe('spin ring on a phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test('Spread and Pull In buttons, ring bar clear of the buttons both ways', async ({ page }) => {
    await gotoAndWaitForGame(page)
    await startRingGame(page)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('touch-play') || document.body).display === 'block', null, { timeout: 30000 })
    await page.waitForFunction(() => document.querySelector('#touch-play .tp-fire.tp-ring'), null, { timeout: 10000 })
    const cdp = await page.context().newCDPSession(page)
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const center = (sel) => page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, sel)
    const flags = () => page.evaluate(() => ({ spread: !!window.__game.buildMode._ringSpreadTouch, pull: !!window.__game.buildMode._ringPull }))
    const fire = await center('.tp-fire')
    await touch('touchStart', [{ x: fire.x, y: fire.y, id: 1 }])
    const spreading = await flags()
    await touch('touchEnd', [])
    const afterSpread = await flags()
    const pull = await center('.tp-reload')
    await touch('touchStart', [{ x: pull.x, y: pull.y, id: 2 }])
    const pulling = await flags()
    await touch('touchEnd', [])
    const afterPull = await flags()
    expect({ spreading, afterSpread, pulling, afterPull }).toEqual({
      spreading: { spread: true, pull: false }, afterSpread: { spread: false, pull: false },
      pulling: { spread: false, pull: true }, afterPull: { spread: false, pull: false },
    })
    const overlaps = () => page.evaluate(() => {
      const bar = document.getElementById('play-ring-bar').getBoundingClientRect()
      const hit = (r) => r.width > 0 && !(r.right <= bar.left || r.left >= bar.right || r.bottom <= bar.top || r.top >= bar.bottom)
      const others = [...document.querySelectorAll('#touch-play .tp-btn'), document.getElementById('build-try-map'), document.getElementById('build-play-health'), document.getElementById('build-play-wave')]
      return {
        shown: bar.width > 0 && getComputedStyle(document.getElementById('play-ring-bar')).display === 'flex',
        onScreen: bar.left >= 0 && bar.right <= innerWidth && bar.top >= 0 && bar.bottom <= innerHeight,
        overlaps: others.filter((el) => el && getComputedStyle(el).display !== 'none' && hit(el.getBoundingClientRect())).map((el) => el.id || el.className),
      }
    })
    expect(await overlaps()).toEqual({ shown: true, onScreen: true, overlaps: [] })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(500)
    expect(await overlaps()).toEqual({ shown: true, onScreen: true, overlaps: [] })
    // Tapping the ring bar opens the Ring Bag, which fits the upright phone.
    const bar = await center('#play-ring-bar')
    await touch('touchStart', [{ x: bar.x, y: bar.y, id: 3 }])
    await touch('touchEnd', [])
    await page.waitForTimeout(300)
    const ed = await page.evaluate(() => {
      const box = document.querySelector('#play-ring-editor .build-share-box').getBoundingClientRect()
      return {
        open: !!window.__game.buildMode.survival.ringEditor?.isOpen,
        fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
        touchHidden: getComputedStyle(document.getElementById('touch-play')).display === 'none',
        hint: document.querySelector('.ring-ed-hint').textContent.includes('tap'),
      }
    })
    expect(ed).toEqual({ open: true, fits: true, touchHidden: true, hint: true })
    // Batch 3: 10 slots still clear of everything, both ways; the Shop's
    // Ring tab fits the upright phone.
    await page.evaluate(() => {
      const g = window.__game
      const s = g.buildMode.survival
      s.ringEditor.close(false)
      g.metaProgress.ringSlotsBought = 7
      localStorage.setItem('gayz-meta-progress', JSON.stringify({ ...JSON.parse(localStorage.getItem('gayz-meta-progress') || '{}'), ringSlotsBought: 7 }))
      s.ring.setLoadout(s.ring.constructor.lib.fitLoadout(s.ring.keys))
    })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.querySelectorAll('#play-ring-bar .ring-slot').length)).toBe(10)
    expect(await overlaps()).toEqual({ shown: true, onScreen: true, overlaps: [] })
    await page.setViewportSize({ width: 844, height: 390 })
    await page.waitForTimeout(500)
    expect(await overlaps()).toEqual({ shown: true, onScreen: true, overlaps: [] })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(300)
    const shop = await page.evaluate(() => {
      const s = window.__game.buildMode.survival
      s.shop.openPanel('', 'ring')
      const box = document.querySelector('#play-npc-panel .build-share-box').getBoundingClientRect()
      const items = document.querySelector('.ring-shop-items').getBoundingClientRect()
      return { open: s.shop.panelOpen, fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, itemsFit: items.right <= box.right }
    })
    expect(shop).toEqual({ open: true, fits: true, itemsFit: true })
  })

  test('ring tutorial: phone wording, clear of the HUD both ways, Skip by tap', async ({ page }) => {
    await gotoAndWaitForGame(page)
    await page.evaluate(() => {
      window.__ringTutorialForTests = true
      localStorage.removeItem('gayz-ring-tutorial')
    })
    await startRingGame(page)
    await page.waitForFunction(() => getComputedStyle(document.getElementById('touch-play') || document.body).display === 'block', null, { timeout: 30000 })
    const check = () => page.evaluate(() => {
      const el = document.getElementById('play-ring-tutorial')
      const t = el.getBoundingClientRect()
      const hit = (r) => r.width > 0 && !(r.right <= t.left || r.left >= t.right || r.bottom <= t.top || r.top >= t.bottom)
      const others = [...document.querySelectorAll('#touch-play .tp-btn'), document.getElementById('play-ring-bar'), document.getElementById('build-try-map'), document.getElementById('build-play-health'), document.getElementById('build-play-wave')]
      return {
        shown: getComputedStyle(el).display === 'flex',
        onScreen: t.left >= 0 && t.right <= innerWidth && t.top >= 0 && t.bottom <= innerHeight,
        overlaps: others.filter((o) => o && getComputedStyle(o).display !== 'none' && hit(o.getBoundingClientRect())).map((o) => o.id || o.className),
        touchText: el.textContent.includes('Spread button'),
      }
    })
    const want = { shown: true, onScreen: true, overlaps: [], touchText: true }
    expect(await check()).toEqual(want)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(500)
    expect(await check()).toEqual(want)
    const cdp = await page.context().newCDPSession(page)
    const skip = await page.evaluate(() => {
      const r = document.querySelector('#play-ring-tutorial .ring-tut-skip').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: skip.x, y: skip.y, id: 1 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => ({ gone: !document.getElementById('play-ring-tutorial'), saved: localStorage.getItem('gayz-ring-tutorial') }))).toEqual({ gone: true, saved: '1' })
  })
})

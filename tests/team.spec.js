import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Catching zombies and animals with Catch Traps, the Team page (Inventory >
// Pets) and team battles (2026-10-31, PlayCatch.js / Creatures.js / TeamUI.js
// / TeamBattle.js), and health bars over mobs (MobHealthBars.js).

test('Catch Traps catch an animal and zombie at full health; an unlucky throw breaks free', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.removeItem('gayz-creatures'))
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const B = s.B
    const inv = s.inv
    const out = {}
    const last = inv.hotbar.length - 1
    out.startTraps = { ...inv.hotbar[last] }
    s.animals.clear()
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    bm._pitch = -0.25
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const tp = bm.tryMode.pos
    const ax = tp.x + dir.x * 3
    const az = tp.z + dir.z * 3
    const rand = Math.random
    const throwAt = () => {
      inv.active = last
      s.catcher._nextAt = 0
      const used = inv.useHeld()
      for (let i = 0; i < 60 && s.catcher.list.some((tr) => !tr.shake); i++) s.catcher.update(1 / 60)
      return used
    }
    // Unlucky: it breaks free (and the trap is used up).
    const cow = s.animals.spawn('cow', ax, s._groundUnder(ax, tp.y + 2, az), az)
    cow.group.updateMatrixWorld()
    Math.random = () => 0.99
    out.thrown1 = throwAt()
    out.cowStillHere = s.animals.list.includes(cow)
    out.trapsLeft1 = inv.hotbar[last]?.n
    // Still at full health: caught anyway.
    cow.x = ax
    cow.z = az
    out.cowFull = cow.health === window.__game.buildMode.survival.animals.constructor.KINDS.cow.health
    cow.flee = 0
    cow.group.position.set(ax * B, cow.y * B, az * B)
    cow.group.updateMatrixWorld()
    Math.random = () => 0.01
    out.thrown2 = throwAt()
    out.cowGone = !s.animals.list.includes(cow)
    // A zombie at full health.
    const z = s._makeZombie(++s._zid, ax, cow.y, az, 100, false)
    if (!s.zombies.includes(z)) s.zombies.push(z)
    out.zombieFull = z.health === z.maxHealth
    out.thrown3 = throwAt()
    out.zombieGone = !s.zombies.includes(z)
    Math.random = rand
    // Out of traps now: the slot is empty.
    out.slotAfter = inv.hotbar[last]
    const saved = JSON.parse(localStorage.getItem('gayz-creatures'))
    out.saved = saved.list.map((c) => c.t + ':' + (c.k || ''))
    out.team = saved.team.length
    return out
  })
  expect(r).toEqual({
    startTraps: { kind: 'item', id: 'catchTrap', n: 3 },
    thrown1: true,
    cowStillHere: true,
    trapsLeft1: 2,
    cowFull: true,
    thrown2: true,
    cowGone: true,
    thrown3: true,
    zombieFull: true,
    zombieGone: true,
    slotAfter: null,
    saved: ['a:cow', 'z:'],
    team: 2,
  })
})

test('a hurt zombie or animal shows a health bar for a few seconds; rarer ones are harder to catch', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const tp = window.__game.buildMode.tryMode.pos
    s.animals.clear()
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    const z = s._makeZombie(++s._zid, tp.x + 4, tp.y, tp.z, 100, false)
    if (!s.zombies.includes(z)) s.zombies.push(z)
    const cow = s.animals.spawn('cow', tp.x - 4, s._groundUnder(tp.x - 4, tp.y + 2, tp.z), tp.z)
    const out = {}
    s.hpBars.update(1 / 60)
    out.before = !!z._hpBar || !!cow._hpBar
    z.health = z.maxHealth * 0.4
    s.animals.damage(cow, 5)
    s.hpBars.update(1 / 60)
    out.zombieBar = !!z._hpBar && z._hpBar.sprite.parent === z.group
    out.cowBar = !!cow._hpBar && cow._hpBar.sprite.parent === cow.group
    // 40% left: the yellow part is 40% of the bar.
    out.zombieFill = z._hpBar.px
    for (let i = 0; i < 40; i++) s.hpBars.update(0.1)
    out.after = !!z._hpBar || !!cow._hpBar
    // The same middling luck catches a Common one but not a Legendary one.
    const rand = Math.random
    Math.random = () => 0.5
    const legend = s._makeZombie(++s._zid, tp.x + 4, tp.y, tp.z + 3, 100, false)
    if (!s.zombies.includes(legend)) s.zombies.push(legend)
    legend.tier = 'legendary'
    out.legendCaught = s.catcher._rollZombie(legend)
    z.tier = 'common'
    out.commonCaught = s.catcher._rollZombie(z)
    Math.random = rand
    return out
  })
  expect(r).toEqual({ before: false, zombieBar: true, cowBar: true, zombieFill: 24, after: false, legendCaught: false, commonCaught: true })
})

test('Team page lists catches, picks the team, and a battle plays to a win or loss', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  // No network for the ghost team: the made-up Wild Team is used.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1 },
        { id: 2, t: 'z', k: null, r: 'epic', n: 3, b: false, at: 2 },
        { id: 3, t: 'z', k: 'brute', r: 'common', n: 7, b: true, at: 3 },
        { id: 4, t: 'a', k: 'cow', r: 'common', at: 4 },
        // Junk from a hand-edited save is dropped.
        { id: 5, t: 'a', k: '<img src=x onerror=alert(1)>', r: 'rare' },
      ],
      team: [1, 2, 99],
      wins: 0,
      losses: 0,
      nextId: 6,
    }))
  })
  // No Team button on the homepage any more: it's Inventory > Pets.
  expect(await page.locator('#team-btn').count()).toBe(0)
  await page.click('#menu-inventory-btn')
  await page.click('#inventory-tab-pets')
  const panel = await page.evaluate(() => {
    const cards = (sel) => [...document.querySelectorAll(`${sel} .team-card[data-id]`)].map((c) => Number(c.dataset.id))
    return {
      open: getComputedStyle(document.getElementById('inventory-page-pets')).display,
      slots: cards('#team-slots'),
      empties: document.querySelectorAll('#team-slots .team-card.empty').length,
      grid: cards('#team-grid'),
      emptyNoteHidden: document.getElementById('team-empty').style.display === 'none',
    }
  })
  expect(panel).toEqual({ open: 'block', slots: [1, 2], empties: 8, grid: [4, 3, 2, 1], emptyNoteHidden: true })
  // Clicking a caught one adds it; clicking a team one takes it off.
  await page.click('#team-grid .team-card[data-id="3"]')
  await page.click('#team-grid .team-card[data-id="1"]')
  await page.click('#team-grid .team-card[data-id="1"]')
  const team = await page.evaluate(() => JSON.parse(localStorage.getItem('gayz-creatures')).team)
  expect(team).toEqual([2, 3, 1])

  const coinsBefore = await page.evaluate(() => window.__game.coins)
  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const battle = await page.evaluate(async () => {
    const b = window.__game._teamBattle
    const out = { mine: b.fighters.filter((f) => f.side === 'mine').length, foes: b.fighters.filter((f) => f.side === 'foe').length, foe: b.foe }
    out.view = b.view
    out.powers = b.fighters.map((f) => f.power)
    // Flip to 2D mid-fight: the flat board shows, the choice is remembered.
    document.querySelector('#team-battle .tb-view').click()
    out.flat = getComputedStyle(document.querySelector('#team-battle .tb-canvas-2d')).display !== 'none'
    out.saved = window.__game.settings.battleView
    // It fights by itself until it's over (the round clock ends it at the latest).
    for (let i = 0; i < 4000 && !b.over; i++) {
      b._draw()
      b._step(0.05)
      if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 900))
    out.over = b.over
    out.result = getComputedStyle(document.querySelector('#team-battle .tb-result')).display
    out.title = document.querySelector('#team-battle .tb-result-title').textContent
    return out
  })
  expect(battle.mine).toBe(3)
  expect(battle.foes).toBe(3)
  expect(battle.foe).toBe('Wild Team')
  expect(battle.view).toBe('3d')
  expect(battle.flat).toBe(true)
  expect(battle.saved).toBe('2d')
  expect(battle.powers.every((p) => ['horde', 'bones', 'rage', 'stomp', 'pounce', 'roar', 'hide', 'heal'].includes(p))).toBe(true)
  expect(battle.over).toBe(true)
  expect(battle.result).toBe('flex')
  expect(['You won!', 'You lost']).toContain(battle.title)
  const after = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('gayz-creatures'))
    return { games: d.wins + d.losses, coins: window.__game.coins }
  })
  expect(after.games).toBe(1)
  expect(after.coins - coinsBefore).toBe(battle.title === 'You won!' ? 30 : 5)
  await page.click('#team-battle .tb-back')
  expect(await page.locator('#team-battle').count()).toBe(0)
  expect(await page.textContent('#team-record')).toMatch(/Wins: [01] · Losses: [01]/)
})

test('levels, evolution, level 5 trigger powers and types', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        // Level 9, one battle from level 10 (1080 XP): evolves Common -> Uncommon.
        { id: 1, t: 'a', k: 'wolf', r: 'common', at: 1, x: 1079 },
        // Level 5 (280 XP): a plain zombie, so Last Groan.
        { id: 2, t: 'z', k: null, r: 'common', n: 3, b: false, at: 2, x: 280 },
        // Level 1: no trigger yet.
        { id: 3, t: 'z', k: 'minion', r: 'common', n: 4, b: false, at: 3 },
      ],
      team: [1, 2, 3],
      wins: 0,
      losses: 0,
      nextId: 4,
    }))
  })
  await page.click('#menu-inventory-btn')
  await page.click('#inventory-tab-pets')
  const page1 = await page.evaluate(() => {
    const card = (id) => document.querySelector(`#team-slots .team-card[data-id="${id}"]`)
    return {
      lv1: card(1).querySelector('.team-card-level').textContent,
      lv2: card(2).querySelector('.team-card-level').textContent,
      trig2: card(2).querySelector('.team-card-power.trig').textContent,
      locked3: card(3).querySelector('.team-card-power.trig').classList.contains('locked'),
      type3: card(3).querySelector('.team-card-type').textContent,
      guide: document.getElementById('team-guide').textContent,
    }
  })
  expect(page1.lv1).toBe('Lv 9')
  expect(page1.lv2).toBe('Lv 5')
  expect(page1.trig2).toBe('Last Groan')
  expect(page1.locked3).toBe(true)
  expect(page1.type3).toContain('Skeleton')
  expect(page1.guide).toContain('Zombies beat Animals')
  expect(page1.guide).toContain('Last Groan')

  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const battle = await page.evaluate(async () => {
    const b = window.__game._teamBattle
    const mine = b.fighters.filter((f) => f.side === 'mine')
    const out = { trigs: mine.map((f) => f.trig) }
    // Type: a skeleton hits a plain zombie for 30% more than an animal of the same attack.
    const skel = mine.find((f) => f.c.id === 3)
    const zom = mine.find((f) => f.c.id === 2)
    const wolf = mine.find((f) => f.c.id === 1)
    const rand = Math.random
    Math.random = () => 0.5
    const hpZ = zom.hp
    const hpW = wolf.hp
    zom.power = null
    wolf.power = null
    skel.atkMul = 1
    b._hit(skel, zom)
    b._hit(skel, wolf)
    Math.random = rand
    out.toZombie = hpZ - zom.hp
    out.toAnimal = hpW - wolf.hp
    zom.hp = hpZ
    wolf.hp = hpW
    // Last Groan: the zombie falls and a mini zombie gets up on my side.
    const before = b.fighters.length
    zom.hp = 0
    b._down(zom)
    const mini = b.fighters[b.fighters.length - 1]
    out.spawned = b.fighters.length - before
    out.mini = { side: mini.side, mini: mini.mini, alive: mini.alive, hp: mini.s.hp, of: zom.s.hp, power: mini.power, trig: mini.trig }
    for (let i = 0; i < 4000 && !b.over; i++) {
      b._draw()
      b._step(0.05)
      if (i % 40 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 900))
    out.title = document.querySelector('#team-battle .tb-result-title').textContent
    out.news = [...document.querySelectorAll('#team-battle .tb-result-news li')].map((li) => li.textContent)
    return out
  })
  expect(battle.trigs).toEqual(['second', 'groan', null])
  expect(battle.toZombie).toBe(Math.round(battle.toAnimal * 1.3) === battle.toZombie ? battle.toZombie : -1)
  expect(battle.spawned).toBe(1)
  expect(battle.mini).toEqual({ side: 'mine', mini: true, alive: true, hp: Math.round(battle.mini.of * 0.5), of: battle.mini.of, power: null, trig: null })
  const won = battle.title === 'You won!'
  expect(battle.news[0]).toBe(`+${won ? 30 : 12} XP for every creature on your team`)
  expect(battle.news).toContain('Wolf reached level 10!')
  expect(battle.news).toContain('Wolf evolved to Uncommon!')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gayz-creatures')).list)
  expect(saved.find((c) => c.id === 1)).toMatchObject({ r: 'uncommon', x: 1079 + (won ? 30 : 12) })
  expect(saved.find((c) => c.id === 3).x).toBe(won ? 30 : 12)
  await page.click('#team-battle .tb-back')
  expect(await page.textContent('#team-slots .team-card[data-id="1"] .team-card-level')).toBe('Lv 10')
})

test('team combos, snacks and shiny creatures', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        // 3 skeletons: Bone Crew (+10% speed). One is shiny.
        { id: 1, t: 'z', k: 'minion', r: 'common', n: 1, b: false, at: 1, s: true },
        { id: 2, t: 'z', k: 'minion', r: 'common', n: 2, b: false, at: 2 },
        { id: 3, t: 'z', k: 'minion', r: 'common', n: 3, b: false, at: 3 },
        // 2 plain zombies: Zombie Pack not on yet (2/3).
        { id: 4, t: 'z', k: null, r: 'common', n: 4, b: false, at: 4 },
        { id: 5, t: 'z', k: null, r: 'common', n: 5, b: false, at: 5 },
        // Not on the team: can't eat.
        { id: 6, t: 'a', k: 'cow', r: 'common', at: 6, s: 'yes' },
      ],
      team: [1, 2, 3, 4, 5],
      wins: 0,
      losses: 0,
      nextId: 7,
    }))
    window.__game.coins = 200
  })
  await page.click('#menu-inventory-btn')
  await page.click('#inventory-tab-pets')
  const p1 = await page.evaluate(() => {
    const card = (id) => document.querySelector(`#team-slots .team-card[data-id="${id}"]`)
    return {
      combos: [...document.querySelectorAll('#team-combos .team-combo')].map((el) => ({ on: el.classList.contains('on'), text: el.querySelector('b').textContent, count: el.querySelector('.team-combo-count').textContent })),
      shiny1: card(1).classList.contains('shiny') && !!card(1).querySelector('.team-card-shiny'),
      shiny2: card(2).classList.contains('shiny'),
      // Only true counts as shiny (a hand-edited save can't fake it).
      shiny6: document.querySelector('#team-grid .team-card[data-id="6"]').classList.contains('shiny'),
      snacks: document.querySelectorAll('#team-snacks .team-snack').length,
      guide: document.getElementById('team-guide').textContent,
    }
  })
  expect(p1.combos).toEqual([
    { on: true, text: 'Bone Crew ★', count: '3/5' },
    { on: false, text: 'Zombie Pack', count: '2/3' },
  ])
  expect(p1.shiny1).toBe(true)
  expect(p1.shiny2).toBe(false)
  expect(p1.shiny6).toBe(false)
  expect(p1.snacks).toBe(4)
  expect(p1.guide).toContain('Bone Crew (3 / 5 / 7)')
  expect(p1.guide).toContain('Shield Cookie')
  expect(p1.guide).toContain('1 in 200')

  // Feed: Steak to 4, Shield Cookie to 5, Bandage to 1 (50 + 60 + 80 = 190).
  const feed = async (snack, id) => {
    await page.click(`#team-snacks .team-snack[data-snack="${snack}"]`)
    await page.click(`.team-card[data-id="${id}"]`)
  }
  await feed('steak', 4)
  await feed('cookie', 5)
  await feed('bandage', 1)
  // Not on the team, already fed, not enough coins left: nothing happens
  // (Candy stays picked through all three).
  await feed('candy', 6)
  await page.click('#team-slots .team-card[data-id="4"]')
  await page.click('#team-slots .team-card[data-id="2"]')
  await page.click('#team-snacks .team-snack[data-snack="candy"]') // un-pick
  const p2 = await page.evaluate(() => ({
    coins: window.__game.coins,
    sn: JSON.parse(localStorage.getItem('gayz-creatures')).list.map((c) => c.sn || null),
    icon4: !!document.querySelector('#team-slots .team-card[data-id="4"] .team-card-snack'),
    armed: document.querySelectorAll('#team-snacks .team-snack.armed').length,
  }))
  expect(p2).toEqual({ coins: 10, sn: ['bandage', null, null, 'steak', 'cookie', null], icon4: true, armed: 0 })
  // Clicking a card with no snack picked still takes it on and off the team.
  await page.click('#team-slots .team-card[data-id="3"]')
  await page.click('#team-grid .team-card[data-id="3"]')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gayz-creatures')).team)).toEqual([1, 2, 4, 5, 3])

  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const b1 = await page.evaluate(() => {
    const b = window.__game._teamBattle
    const f = (id) => b.fighters.find((o) => o.side === 'mine' && o.c.id === id)
    const out = {}
    // Snacks are eaten as soon as the battle starts.
    out.saved = JSON.parse(localStorage.getItem('gayz-creatures')).list.map((c) => c.sn || null)
    out.combos = document.querySelector('#team-battle .tb-combos-mine').textContent.trim()
    out.speed2 = f(2).s.speed
    out.atk4 = +f(4).atkMul.toFixed(3)
    out.shinyLabel = !!f(1).label.querySelector('.tb-label-shiny')
    out.shinyCard = document.querySelectorAll('#team-battle .tb-mine .tb-card.shiny').length
    out.snackCards = document.querySelectorAll('#team-battle .tb-mine .tb-card-snack').length
    // Shield Cookie: the first hit does nothing, the second hurts.
    const foe = b.fighters.find((o) => o.side === 'foe')
    const hp5 = f(5).hp
    b._hit(foe, f(5))
    out.cookieBlocked = f(5).hp === hp5 && f(5).snack === null
    b._hit(foe, f(5))
    out.cookieGone = f(5).hp < hp5
    // Bandage: falls, gets back up at half health, then falls for real.
    const one = f(1)
    one.hp = 0
    b._down(one)
    out.bandage = { alive: one.alive, hp: one.hp, half: Math.round(one.s.hp * 0.5), snack: one.snack }
    one.hp = 0
    b._down(one)
    out.downAfter = one.alive
    return out
  })
  expect(b1.saved).toEqual([null, null, null, null, null, null])
  expect(b1.combos).toBe('Bone Crew ★')
  expect(b1.atk4).toBeCloseTo(1.25 * (1 + 0.06), 3) // Steak, and Horde for the other plain zombie
  expect(b1.shinyLabel).toBe(true)
  expect(b1.shinyCard).toBe(1)
  expect(b1.snackCards).toBe(3)
  expect(b1.cookieBlocked).toBe(true)
  expect(b1.cookieGone).toBe(true)
  expect(b1.bandage).toEqual({ alive: true, hp: b1.bandage.half, half: b1.bandage.half, snack: null })
  expect(b1.downAfter).toBe(false)
  await page.click('#team-battle .tb-leave')
  // Bone Crew: with only 2 skeletons left it's off, and they're 10% slower.
  await page.click('#team-slots .team-card[data-id="3"]')
  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const b2 = await page.evaluate(() => {
    const b = window.__game._teamBattle
    return { speed2: b.fighters.find((o) => o.side === 'mine' && o.c.id === 2).s.speed, combos: document.querySelector('#team-battle .tb-combos-mine').textContent.trim() }
  })
  expect(b2.combos).toBe('')
  expect(b1.speed2 / b2.speed2).toBeCloseTo(1.1, 5)
  await page.click('#team-battle .tb-leave')
})

test('on a server a guest\'s trap waits for the host, and the host rolls it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => localStorage.removeItem('gayz-creatures'))
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const bm = window.__game.buildMode
    const s = bm.survival
    const inv = s.inv
    const out = {}
    const realNet = s.net
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    bm._pitch = -0.25
    bm.update(1 / 60)
    const cam = bm.camera
    cam.updateMatrixWorld()
    const dir = cam.getWorldDirection(cam.position.clone())
    const tp = bm.tryMode.pos
    const ax = tp.x + dir.x * 3
    const az = tp.z + dir.z * 3
    const gy = s._groundUnder(ax, tp.y + 2, az)
    // A guest: the trap is sent to the host and waits, shaking.
    const sent = []
    s.net = { closed: false, isHost: false, players: new Map(), queueCatch: (id) => sent.push(id) }
    const z = s._makeZombie(41, ax, gy, az, 100, false)
    if (!s.zombies.includes(z)) s.zombies.push(z)
    inv.active = inv.hotbar.length - 1
    s.catcher._nextAt = 0
    inv.useHeld()
    for (let i = 0; i < 30; i++) s.catcher.update(1 / 60)
    out.sent = sent
    out.waiting = s.catcher._waiting.length
    out.zombieStill = s.zombies.includes(z)
    // The host's answer: caught - kept here.
    s.catcher.remoteResult({ ok: true, t: 'z', k: 'brute', r: 'epic', n: 12, b: false })
    out.saved = JSON.parse(localStorage.getItem('gayz-creatures')).list.map((c) => `${c.t}:${c.k}:${c.r}`)
    out.waitingAfter = s.catcher._waiting.length
    // The host: another player's trap on my weakened zombie - rolled, gone,
    // and the answer queued for them (nothing kept here).
    const answers = []
    s.net = { closed: false, isHost: true, players: new Map(), queueCatchResult: (to, res) => answers.push({ to, ...res }) }
    z.health = 1
    const rand = Math.random
    Math.random = () => 0.01
    s._applyRemoteHits([{ id: `z${z.id}`, dmg: 0, by: 'p2', catch: true }, { id: 'z999', dmg: 0, by: 'p2', catch: true }])
    Math.random = rand
    out.answers = answers
    out.hostGone = !s.zombies.includes(z)
    out.hostKept = JSON.parse(localStorage.getItem('gayz-creatures')).list.length
    s.net = realNet
    return out
  })
  expect(r).toEqual({
    sent: ['z41'],
    waiting: 1,
    zombieStill: true,
    saved: ['z:brute:epic'],
    waitingAfter: 0,
    answers: [{ to: 'p2', ok: true, t: 'z', k: null, r: 'common', n: expect.any(Number), b: false }, { to: 'p2', ok: false }],
    hostGone: true,
    hostKept: 1,
  })
})

// 2026-11-02: the Weekly Team Tournament (TeamTournament.js).
test('Weekly Team Tournament: enter, win three rounds for the Champion badge', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [{ id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1 }, { id: 2, t: 'z', k: null, r: 'common', n: 3, at: 1 }], team: [1, 2], wins: 0, losses: 0, nextId: 3 }))
    localStorage.removeItem('gayz-tournament')
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = { enter: document.getElementById('tourney-btn').textContent }
    const coins = g.coins
    const play = async () => {
      for (let i = 0; i < 80 && !(g._teamBattle?.root && !g._teamBattle.over); i++) await new Promise((res) => setTimeout(res, 100))
      out.foes = (out.foes || 0) + (document.querySelector('#team-battle .tb-foe-name').textContent ? 1 : 0)
      g._teamBattle._finish(true)
    }
    document.getElementById('tourney-btn').click()
    await play()
    out.next = document.querySelector('#team-battle .tb-again').textContent
    document.querySelector('#team-battle .tb-again').click()
    await play()
    document.querySelector('#team-battle .tb-again').click()
    await play()
    out.last = document.querySelector('#team-battle .tb-again').textContent
    document.querySelector('#team-battle .tb-back').click()
    const saved = JSON.parse(localStorage.getItem('gayz-tournament'))
    out.entrants = saved.cur.entrants.length
    out.place = saved.cur.place
    out.badges = saved.badges.map((b) => b.place)
    out.coins = g.coins - coins
    out.btn = document.getElementById('tourney-btn').disabled
    out.bracketCols = document.querySelectorAll('#tourney-bracket .tourney-col').length
    out.badgeShown = /Champion/.test(document.getElementById('tourney-badges').textContent)
    return out
  })
  expect(r).toEqual({ enter: 'Enter Tournament', foes: 3, next: 'Next Round', last: 'Back to Bracket', entrants: 8, place: 'champion', badges: ['champion'], coins: 320, btn: true, bracketCols: 4, badgeShown: true })
})

// Pack Leaders (2026-11-11, PackLeaders.js / PackLeaderWorld.js).
test('Pack Leaders: a ladder of 26, beat the next for a badge and coins; met in the world too', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [{ id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1 }, { id: 2, t: 'z', k: null, r: 'common', n: 3, at: 1 }], team: [1, 2], wins: 0, losses: 0, nextId: 3 }))
    localStorage.removeItem('gayz-pack-leaders')
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const P = g._packLeaders
    const C = P
    const byId = (id) => document.getElementById(id)
    const out = {}
    const powers = P.LEADERS.map((L, i) => C.power(P.leaderTeam(i)))
    out.count = P.LEADERS.length
    out.rising = powers.every((p, i) => !i || p > powers[i - 1])
    out.sizes = [P.leaderTeam(0).length, P.leaderTeam(25).length]
    out.title = byId('leaders-title').textContent
    out.btn = byId('leaders-btn').textContent
    out.badges = [...document.querySelectorAll('.leader-badge')].map((b) => b.className.replace('leader-badge ', ''))
    out.states = [out.badges[0], out.badges[1]]
    delete out.badges
    // Lose first: no badge, 5 coins.
    let coins = g.coins
    byId('leaders-btn').click()
    out.foe = document.querySelector('#team-battle .tb-foe-name').textContent
    g._teamBattle._finish(false)
    out.lostCoins = g.coins - coins
    out.lostAgain = document.querySelector('#team-battle .tb-again').textContent
    document.querySelector('#team-battle .tb-back').click()
    out.afterLoss = P.loadLeaders().beaten.length
    // Then win: badge, 100 coins, a Next Leader button.
    coins = g.coins
    byId('leaders-btn').click()
    g._teamBattle._finish(true)
    out.wonCoins = g.coins - coins
    out.nextBtn = document.querySelector('#team-battle .tb-again').textContent
    document.querySelector('#team-battle .tb-again').click()
    out.nextFoe = document.querySelector('#team-battle .tb-foe-name').textContent
    g._teamBattle._leave()
    out.beaten = P.loadLeaders().beaten
    out.title2 = byId('leaders-title').textContent
    out.states2 = [...document.querySelectorAll('.leader-badge')].slice(0, 3).map((b) => b.className.replace('leader-badge ', ''))
    // A locked leader can't be fought.
    out.locked = P.startLeaderBattle(g, 5) === null
    return out
  })
  expect(r).toEqual({
    count: 26, rising: true, sizes: [2, 10],
    title: 'Pack Leaders · 0/26 badges', btn: 'Challenge Hank!', states: ['next', 'locked'],
    foe: 'Hank, Leader of the Plains', lostCoins: 5, lostAgain: 'Battle Again', afterLoss: 0,
    wonCoins: 100, nextBtn: 'Next Leader', nextFoe: 'Coral, Leader of the Beach',
    beaten: ['plains'], title2: 'Pack Leaders · 1/26 badges', states2: ['beaten', 'next', 'locked'], locked: true,
  })

  // In a game: Coral stands on the beach; Use next to her starts the battle,
  // nothing hurts you while it's up, and winning gives her badge.
  await page.evaluate(() => {
    document.getElementById('inventory-panel')?.querySelector('.close-btn, .panel-close')?.click()
    window.__game.playBtn.click()
  })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  const w = await page.evaluate(async () => {
    const g = window.__game
    const s = g.buildMode.survival
    const out = {}
    const me = s.bodyPos()
    s.leaders.clear()
    s.leaders._place(1, { x: me.x + 1, y: me.y, z: me.z }, false)
    out.tag = !!s.leaders.leader.person.group
    s.leaders.update(0.05)
    out.pill = document.getElementById('pill-leader')?.textContent || ''
    out.used = s.leaders.use()
    out.battling = s.leaders.battling
    out.open = !!g._teamBattle?.root
    out.mouseFree = g.buildMode.mouseScreenOpen()
    const hp = s.health
    s._hurtPlayer(20)
    out.hurt = hp - s.health
    g._teamBattle._finish(true)
    out.again = getComputedStyle(document.querySelector('#team-battle .tb-again')).display
    document.querySelector('#team-battle .tb-back').click()
    s.leaders.update(0.05)
    out.after = s.leaders.battling
    out.beaten = JSON.parse(localStorage.getItem('gayz-pack-leaders')).beaten
    // Now she says you have her badge.
    s.leaders.update(0.05)
    out.pill2 = document.getElementById('pill-leader')?.textContent || ''
    return out
  })
  expect(w).toEqual({
    tag: true, pill: expect.stringContaining('Coral, Leader of the Beach · press'), used: true, battling: true, open: true, mouseFree: true,
    hurt: 0, again: 'none', after: false, beaten: ['plains', 'beach'], pill2: 'Coral, Leader of the Beach · you have this badge',
  })
})

// Gauntlet (2026-11-11, Gauntlet.js): its own run with a shop, merges and
// 3 lives; caught creatures are never touched.
test('Gauntlet: buy, merge, sell, reroll, win for coins, three losses end the run', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [{ id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1 }], team: [1], wins: 0, losses: 0, nextId: 2 }))
    localStorage.removeItem('gayz-gauntlet')
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const G = g._gauntlet
    const byId = (id) => document.getElementById(id)
    const out = {}
    const creatures = localStorage.getItem('gayz-creatures')
    // Merging: 3 of a kind -> 2 stars, one rarity above the best.
    const tm = [{ t: 'a', k: 'wolf', r: 'common' }, { t: 'a', k: 'wolf', r: 'uncommon' }, { t: 'a', k: 'wolf', r: 'common' }, { t: 'a', k: 'bear', r: 'common' }]
    G.mergeAll(tm)
    out.merged = tm.map((c) => `${c.k}:${c.r}:${G.starsOf(c)}`)
    out.slots = [1, 2, 3, 9, 12].map(G.slots)
    // A bot can merge 3 copies, so its size is anything from 1 to the slots.
    out.botSizes = [1, 10].map((b) => Array.from({ length: 5 }, () => G.botRun(b).length).every((n) => n >= 1 && n <= G.slots(b)))
    out.botStronger = G.power(G.botRun(10)) > G.power(G.botRun(1))
    // A run through the buttons.
    out.start = byId('gauntlet-btn').textContent
    byId('gauntlet-btn').click()
    out.shop = document.querySelectorAll('#gauntlet [data-gt-buy]').length
    // Bats only (Picnic: no gold when sold), so the gold below is fixed.
    const sd = JSON.parse(localStorage.getItem('gayz-gauntlet'))
    sd.run.shop = sd.run.shop.map(() => ({ t: 'a', k: 'bat', r: 'common' }))
    localStorage.setItem('gayz-gauntlet', JSON.stringify(sd))
    g._renderTeamPanel()
    document.querySelector('#gauntlet [data-gt-buy]').click()
    document.querySelector('#gauntlet [data-gt-buy]').click()
    out.gold = G.loadGauntlet().run.gold
    document.querySelector('#gauntlet [data-gt-sell]').click()
    byId('gauntlet-reroll').click()
    out.gold2 = G.loadGauntlet().run.gold
    const wait = async () => { for (let i = 0; i < 80 && !(g._teamBattle?.root && !g._teamBattle.over); i++) await new Promise((res) => setTimeout(res, 100)) }
    const coins = g.coins
    byId('gauntlet-btn').click()
    await wait()
    const foe = document.querySelector('#team-battle .tb-foe-name').textContent
    g._teamBattle._leave()
    byId('gauntlet-btn').click()
    await wait()
    out.sameFoe = foe === document.querySelector('#team-battle .tb-foe-name').textContent
    g._teamBattle._finish(true)
    out.again = document.querySelector('#team-battle .tb-again').style.display
    document.querySelector('#team-battle .tb-back').click()
    out.coins = g.coins - coins
    const run = G.loadGauntlet().run
    out.after = [run.battle, run.wins, run.lives, run.gold]
    for (let i = 0; i < 3; i++) {
      byId('gauntlet-btn').click()
      await wait()
      g._teamBattle._finish(false)
      document.querySelector('#team-battle .tb-back').click()
    }
    const d = G.loadGauntlet()
    out.end = [d.run, d.best, d.last.wins]
    out.endBtn = byId('gauntlet-btn').textContent
    out.untouched = creatures === localStorage.getItem('gayz-creatures')
    return out
  })
  expect(r).toEqual({
    merged: ['wolf:rare:2', 'bear:common:1'],
    slots: [3, 3, 4, 7, 7],
    botSizes: [true, true],
    botStronger: true,
    start: 'Start a Gauntlet run',
    shop: 5,
    gold: 4,
    gold2: 4,
    sameFoe: true,
    again: 'none',
    coins: 15,
    after: [2, 1, 3, 14],
    end: [null, 1, 1],
    endBtn: 'Start a Gauntlet run',
    untouched: true,
  })
})

// Gauntlet shop upgrade + daily Pet Shop (2026-11-23): shop tiers, food
// (fruit for the run, snacks for one battle), freeze, reorder, and pets
// for coins on the Pets tab.
test('Gauntlet food, freeze, tiers, reorder; daily Pet Shop', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const G = g._gauntlet
    const byId = (id) => document.getElementById(id)
    const out = {}
    localStorage.removeItem('gayz-gauntlet')
    localStorage.removeItem('gayz-pet-shop')
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [], team: [], wins: 0, losses: 0, nextId: 1 }))
    g._openMenuInventoryPanel()
    byId('inventory-tab-pets').click()
    out.tiers = [1, 2, 3, 5, 9, 15].map(G.shopTier)
    out.tier1Only = Array.from({ length: 40 }, () => G.rollShop(1, [])).flat().every((c) => !['brute', 'triceratops', 'bear'].includes(c.k))
    byId('gauntlet-btn').click()
    document.querySelector('#gauntlet [data-gt-buy]').click()
    document.querySelector('#gauntlet [data-gt-buy]').click()
    // Freeze keeps a slot through a reroll.
    document.querySelector('[data-gt-freeze="s4"]').click()
    const kept = JSON.stringify(G.loadGauntlet().run.shop[4])
    byId('gauntlet-reroll').click()
    out.frozenKept = JSON.stringify(G.loadGauntlet().run.shop[4]) === kept
    // Fruit: tap the food, then a team creature.
    const d = JSON.parse(localStorage.getItem('gayz-gauntlet'))
    d.run.food = ['apple', 'steak']
    d.run.gold = 10
    localStorage.setItem('gayz-gauntlet', JSON.stringify(d))
    g._renderTeamPanel()
    document.querySelector('[data-gt-food="0"]').click()
    document.querySelector('#gauntlet-team [data-gt-sell="0"]').click()
    document.querySelector('[data-gt-food="1"]').click()
    document.querySelector('#gauntlet-team [data-gt-sell="1"]').click()
    let run = G.loadGauntlet().run
    out.fed = [run.team.length, run.team[0].bh, run.team[1].sn, run.gold]
    // Reorder.
    const k = run.team.map((c) => c.k)
    G.moveTeam(1, 0)
    out.moved = JSON.stringify(G.loadGauntlet().run.team.map((c) => c.k)) === JSON.stringify([k[1], k[0]])
    // A fight eats the snack, keeps the fruit.
    byId('gauntlet-btn').click()
    for (let i = 0; i < 80 && !(g._teamBattle?.root && !g._teamBattle.over); i++) await new Promise((res) => setTimeout(res, 100))
    run = G.loadGauntlet().run
    // (>= 15: an end-of-round shop power may have added more.)
    out.afterFight = [run.team.some((c) => c.sn), run.team.some((c) => c.bh >= 15)]
    // Shop powers (Batch B): when bought, when sold, end of a shop round,
    // times the stars.
    const z = (k, l) => ({ t: 'z', k, r: 'common', n: 0, b: false, ...(l ? { l } : {}) })
    const tm = [z(null), { t: 'a', k: 'bat', r: 'common' }]
    G.shopPower(z(null), 'buy', tm)
    const tm2 = [z('beast'), { t: 'a', k: 'triceratops', r: 'common' }]
    G.endRound(tm2)
    out.shopPowers = [G.shopPowerOf(z('minion')).id, G.shopPower(z('minion'), 'sell', []), G.shopPower(z('minion', 10), 'sell', []), tm[0].bh, tm[1].bh || 0, tm2[0].ba, G.shopPower(z('minion'), 'buy', [])]
    out.cardPower = document.querySelectorAll('#gauntlet .gt-sp').length > 0 && !!document.querySelector('#team-guide')?.textContent.includes('Share the Hunt')
    g._teamBattle._leave()
    // Pet Shop: same stock all day, buying adds a creature and costs coins.
    const P = g._petShop
    out.cards = document.querySelectorAll('#pet-shop [data-ps-buy]').length
    g.coins = 5000
    const coins = g.coins
    document.querySelector('#pet-shop [data-ps-buy="0"]').click()
    out.bought = [JSON.parse(localStorage.getItem('gayz-creatures')).list.length, coins - g.coins > 0, document.querySelectorAll('#pet-shop [data-ps-buy]').length]
    out.sameDay = JSON.stringify(P.stock('2026-01-01')) === JSON.stringify(P.stock('2026-01-01')) && JSON.stringify(P.stock('2026-01-01')) !== JSON.stringify(P.stock('2026-01-02'))
    return out
  })
  expect(r).toMatchObject({
    tiers: [1, 1, 2, 3, 5, 5],
    tier1Only: true,
    frozenKept: true,
    fed: [2, 15, 'steak', 4],
    moved: true,
    afterFight: [false, true],
    shopPowers: ['scrap', 1, 2, 4, 0, 1, -1],
    cardPower: true,
    cards: 4,
    bought: [1, true, 3],
    sameDay: true,
  })
})

// Nicknames (2026-11-23, TeamUI.renderRename / Creatures.renameCreature).
test('nicknames: rename a creature, show its kind, bad words swapped, sent with the team', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const g = window.__game
    const byId = (id) => document.getElementById(id)
    const saved = () => JSON.parse(localStorage.getItem('gayz-creatures')).list
    const out = {}
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'common', at: 1 },
        { id: 2, t: 'z', k: null, r: 'rare', n: 3, b: false, at: 2 },
      ],
      team: [1, 2], wins: 0, losses: 0, nextId: 3,
    }))
    g._openMenuInventoryPanel()
    byId('inventory-tab-pets').click()
    const rename = (id, name, kind) => {
      document.querySelector('#team-rename [data-rename=arm]').click()
      document.querySelector(`#team-slots .team-card[data-id="${id}"]`).click()
      byId('team-rename-input').value = name
      byId('team-rename-kind').checked = kind
      document.querySelector('[data-rename=save]').click()
    }
    rename(1, `  Sir Moo ${'a'.repeat(80)}`, true)
    out.long = saved()[0].nm.length
    out.nk = saved()[0].nk
    out.team = JSON.parse(localStorage.getItem('gayz-creatures')).team
    out.kindShown = document.querySelector('#team-slots .team-card[data-id="1"] .team-card-kind')?.textContent
    rename(2, 'shit head', false)
    out.swapped = saved()[1].nm
    out.noKind = !document.querySelector('#team-slots .team-card[data-id="2"] .team-card-kind')
    // Remove nickname.
    document.querySelector('#team-rename [data-rename=arm]').click()
    document.querySelector('#team-slots .team-card[data-id="2"]').click()
    document.querySelector('[data-rename=clear]').click()
    out.cleared = saved()[1].nm === undefined
    out.boxClosed = !byId('team-rename-input')
    return out
  })
  expect(r.long).toBe(50)
  expect(r.nk).toBe(true)
  expect(r.team).toEqual([1, 2]) // tapping to rename doesn't change the team
  expect(r.kindShown).toBe('Cow')
  expect(r.swapped).toBe('crap head')
  expect(r.noKind).toBe(true)
  expect(r.cleared).toBe(true)
  expect(r.boxClosed).toBe(true)
  // Ghost teams carry the nickname; one from another player gets cleaned.
  const t = await page.evaluate(() => {
    const { packTeam, unpackTeam } = window.__game._creatures
    return {
      packed: packTeam([{ t: 'a', k: 'cow', r: 'common', nm: 'Bob', nk: true }])[0],
      ghost: unpackTeam([{ t: 'a', k: 'cow', r: 'common', nm: `fuck‮ ${'x'.repeat(80)}` }])[0].nm,
    }
  })
  expect(t.packed.nm).toBe('Bob')
  expect(t.packed.nk).toBe(true)
  expect(t.ghost.startsWith('fudge x')).toBe(true)
  expect([...t.ghost].length).toBe(50)
})

test('held items: give, swap, take off, what they do in battle, drops, ghost teams, Gauntlet shop', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.removeItem('gayz-pack-leaders')
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'common', at: 1 },
        { id: 2, t: 'z', k: null, r: 'common', n: 2, b: false, at: 2 },
        { id: 3, t: 'a', k: 'wolf', r: 'common', at: 3, hi: 'not-an-item' },
      ],
      team: [1, 2, 3], wins: 0, losses: 0, nextId: 4,
      items: { fang: 1, collar: 1, bone: 1, nope: 4, horn: -2 },
    }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('gayz-creatures')))
  const give = async (item, id) => {
    await page.click(`#team-items .team-snack[data-item="${item}"]`)
    await page.click(`#team-slots .team-card[data-id="${id}"]`)
  }
  const p1 = await page.evaluate(() => ({
    bag: [...document.querySelectorAll('#team-items .team-snack[data-item]')].map((b) => b.dataset.item),
    guide: document.getElementById('team-guide').textContent,
  }))
  expect(p1.bag).toEqual(['fang', 'collar', 'bone', 'off']) // bad ones dropped
  expect(p1.guide).toContain('Spirit Totem')
  await give('fang', 1)
  let s = await saved()
  expect(s.list[0].hi).toBe('fang')
  expect(s.items).toEqual({ collar: 1, bone: 1 })
  expect(s.list[2].hi).toBeUndefined() // a made-up item is dropped
  // Swap: the old one goes back in the bag.
  await give('collar', 1)
  s = await saved()
  expect(s.list[0].hi).toBe('collar')
  expect(s.items).toEqual({ bone: 1, fang: 1 })
  // Take off.
  await give('off', 1)
  s = await saved()
  expect(s.list[0].hi).toBeUndefined()
  expect(s.items).toEqual({ bone: 1, fang: 1, collar: 1 })
  expect(s.team).toEqual([1, 2, 3]) // tapping to give doesn't change the team
  await give('fang', 1)
  await give('collar', 2)
  await give('bone', 3)
  s = await saved()
  expect(s.list.map((c) => c.hi)).toEqual(['fang', 'collar', 'bone'])
  expect(s.items).toEqual({})
  expect(await page.evaluate(() => ({
    icons: document.querySelectorAll('#team-slots .team-card-item').length,
    none: !!document.querySelector('#team-items .team-item-none'),
  }))).toEqual({ icons: 3, none: true })

  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const b = await page.evaluate(() => {
    const B = window.__game._teamBattle
    const f = (id) => B.fighters.find((o) => o.side === 'mine' && o.c.id === id)
    const foe = B.fighters.find((o) => o.side === 'foe')
    foe.item = null
    foe.hp = foe.s.hp = 100000
    const out = {}
    out.items = [f(1).item, f(2).item, f(3).item]
    out.labels = document.querySelectorAll('#team-battle .tb-label-item').length
    out.cards = document.querySelectorAll('#team-battle .tb-mine .tb-card-item').length
    // Spiked Collar: the hitter takes 20% back.
    let before = f(2).hp
    let foeBefore = foe.hp
    B._hit(foe, f(2))
    const dmg = before - f(2).hp
    out.collar = { back: foeBefore - foe.hp, want: Math.max(1, Math.round(dmg * 0.2)) }
    // Lucky Bone: the knock-out hit misses once, the next one lands.
    f(3).hp = 1
    B._hit(foe, f(3))
    out.bone1 = { alive: f(3).alive, hp: f(3).hp }
    B._hit(foe, f(3))
    out.bone2 = f(3).alive
    // Spirit Totem: back up once with 30%.
    const one = f(1)
    one.item = 'totem'
    one.hp = 0
    B._down(one)
    out.totem = { alive: one.alive, hp: one.hp, want: Math.round(one.s.hp * 0.3) }
    // Vampire Tooth heals the hitter; Stun Horn's first hit stuns.
    foe.item = 'tooth'
    foe.hp = 10
    one.hp = one.s.hp
    B._hit(foe, one)
    out.tooth = foe.hp > 10
    foe.item = 'horn'
    foe.itemUsed = false
    B._hit(foe, one)
    out.horn = one.stun
    return out
  })
  expect(b.items).toEqual(['fang', 'collar', 'bone'])
  expect(b.labels).toBe(3)
  expect(b.cards).toBe(3)
  expect(b.collar.back).toBe(b.collar.want)
  expect(b.bone1).toEqual({ alive: true, hp: 1 })
  expect(b.bone2).toBe(false)
  expect(b.totem).toEqual({ alive: true, hp: b.totem.want, want: b.totem.want })
  expect(b.tooth).toBe(true)
  expect(b.horn).toBe(2)
  await page.click('#team-battle .tb-leave')

  // A Pack Leader win can drop one (Math.random 0: always, the first item).
  const d = await page.evaluate(() => {
    document.getElementById('leaders-btn').click()
    const real = Math.random
    Math.random = () => 0
    try { window.__game._teamBattle._finish(true) } finally { Math.random = real }
    const news = document.querySelector('#team-battle .tb-result-news').textContent
    document.querySelector('#team-battle .tb-back').click()
    return { news, bag: JSON.parse(localStorage.getItem('gayz-creatures')).items }
  })
  expect(d.news).toContain('Found a held item: Fang Necklace!')
  expect(d.bag).toEqual({ fang: 1 })

  // Ghost teams carry held items; a bad one from another player is dropped.
  const g = await page.evaluate(() => {
    const { packTeam, unpackTeam } = window.__game._creatures
    const G = window.__game._gauntlet
    const wolf = { t: 'a', k: 'wolf', r: 'common' }
    return {
      packed: packTeam([{ ...wolf, hi: 'bone' }])[0].hi,
      kept: unpackTeam([{ ...wolf, hi: 'horn' }])[0].hi,
      bad: unpackTeam([{ ...wolf, hi: 'rocket' }])[0].hi ?? null,
      // Gauntlet: items in the food row from tier 2, never in tier 1.
      food3: G.rollFood(3, () => 0),
      food1: G.rollFood(1, () => 0).some((id) => G.FOODS[id].held),
      foodOnly: G.FOOD_IDS.every((id) => !G.FOODS[id].held),
      name: G.foodName('fang'),
      merged: G.mergeAll([{ ...wolf }, { ...wolf, hi: 'claws' }, { ...wolf }])[0].hi,
    }
  })
  expect(g.packed).toBe('bone')
  expect(g.kept).toBe('horn')
  expect(g.bad).toBe(null)
  expect(g.food3).toEqual(['fang', 'fang'])
  expect(g.food1).toBe(false)
  expect(g.foodOnly).toBe(true)
  expect(g.name).toBe('Fang Necklace')
  expect(g.merged).toBe('claws')
})

test('arena hazards: rolled 1 in 3, fair layout, lava / mud / bounce / flowers, flyers float over, banner + guide', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'common', at: 1 },
        { id: 2, t: 'a', k: 'eagle', r: 'common', at: 2 },
      ],
      team: [1, 2], wins: 0, losses: 0, nextId: 3,
    }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const guide = await page.evaluate(() => document.getElementById('team-guide').textContent)
  expect(guide).toContain('Arena hazards')
  expect(guide).toContain('Healing Flowers')
  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const r = await page.evaluate(() => {
    const TB = window.__game._teamBattle.constructor
    const mine = window.__game._teamBattle.mine
    const theirs = window.__game._teamBattle.theirs
    window.__game._teamBattle.close()
    const out = {}
    // The roll: Math.random 0 -> the first hazard; 0.5 -> none.
    const real = Math.random
    try {
      Math.random = () => 0
      out.rollYes = new TB({ mine, theirs, foe: 'x' }).hazard
      Math.random = () => 0.5
      out.rollNo = new TB({ mine, theirs, foe: 'x' }).hazard
    } finally { Math.random = real }
    // Every layout is inside the fence and the same turned round the middle.
    out.fair = ['lava', 'mud', 'bounce', 'flowers'].map((id) => {
      const cells = new TB({ mine, theirs, foe: 'x', hazard: id }).hazardCells
      return cells.size > 0 && [...cells].every((k) => {
        const [x, z] = k.split(',').map(Number)
        return cells.has(`${-x - 1},${-z - 1}`) && Math.abs(x + 0.5) < 11 && Math.abs(z + 0.5) < 11
      })
    })
    out.badId = new TB({ mine, theirs, foe: 'x', hazard: 'rocket' }).hazard
    const run = (id, fn) => {
      const B = new TB({ mine, theirs, foe: 'x', hazard: id, onEnd: () => 0 })
      B.open()
      const [k] = B.hazardCells
      const [x, z] = k.split(',').map(Number)
      const cow = B.fighters.find((o) => o.side === 'mine' && o.c.k === 'cow')
      const bat = B.fighters.find((o) => o.side === 'mine' && o.c.k === 'eagle')
      for (const f of [cow, bat]) { f.x = x + 0.5; f.z = z + 0.5; f.s.hp = f.hp = 1000 }
      const res = fn(B, cow, bat)
      res.banner = B.root.querySelector('.tb-hazard')?.textContent || null
      B.close()
      return res
    }
    out.lava = run('lava', (B, cow, bat) => {
      B._hazardStep(cow, 0.01, true)
      B._hazardStep(bat, 0.01, true)
      const before = { cow: cow.hp, bat: bat.hp }
      B._hazardStep(cow, 0.01, false) // not before the fight starts
      return { cow: before.cow, bat: before.bat, waited: cow.hp }
    })
    out.mud = run('mud', (B, cow, bat) => ({ cow: B._hazardStep(cow, 0.01, true), bat: B._hazardStep(bat, 0.01, true) }))
    out.flowers = run('flowers', (B, cow) => {
      cow.hp = 500
      B._hazardStep(cow, 1, true)
      return { hp: cow.hp }
    })
    out.bounce = run('bounce', (B, cow, bat) => {
      B._hazardStep(cow, 0.01, true)
      B._hazardStep(bat, 0.01, true)
      const res = { air: cow.air > 0, push: Math.hypot(cow.vx, cow.vz), batAir: bat.air }
      B._setView('2d', false)
      B._draw() // the 2D board draws the pads without throwing
      return res
    })
    out.none = (() => {
      const B = new TB({ mine, theirs, foe: 'x', hazard: null })
      B.open()
      const res = { banner: !!B.root.querySelector('.tb-hazard'), slow: B._hazardStep(B.fighters[0], 0.01, true) }
      B.close()
      return res
    })()
    return out
  })
  expect(r.rollYes).toBe('lava')
  expect(r.rollNo).toBe(null)
  expect(r.fair).toEqual([true, true, true, true])
  expect(r.badId).toBe(null)
  expect(r.lava).toEqual({ cow: 970, bat: 1000, waited: 970, banner: 'Arena: Lava Cracks - standing on them burns 6% health a second.' })
  expect(r.mud.cow).toBe(0.5)
  expect(r.mud.bat).toBe(1)
  expect(r.flowers.hp).toBe(540)
  expect(r.bounce.air).toBe(true)
  expect(r.bounce.push).toBeCloseTo(12, 5)
  expect(r.bounce.batAir).toBe(0)
  expect(r.none).toEqual({ banner: false, slow: 1 })
})

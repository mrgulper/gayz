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
    // (Every battle's dice come from its seed now - Batch J replays.)
    const rand = b.rand
    b.rand = () => 0.5
    const hpZ = zom.hp
    const hpW = wolf.hp
    zom.power = null
    wolf.power = null
    skel.atkMul = 1
    b._hit(skel, zom)
    b._hit(skel, wolf)
    b.rand = rand
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

// Pet eggs (Batch F, PetEggs.js): found in Loot Chests, the first 3 warm up
// as you walk, rarer ones walk further, a ready one hatches into a creature.
test('pet eggs: chest finds, walking warms the first 3, hatching, Eggs section', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [], team: [], wins: 0, losses: 0, nextId: 1,
      // A made-up rarity is dropped; d is clamped to a whole number.
      eggs: [{ r: 'common', d: 295.7 }, { r: 'nope', d: 1 }, { r: 'rare', d: 0 }, { r: 'epic', d: 10 }, { r: 'mythic', d: 0 }],
    }))
  })
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('gayz-creatures')))
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  await page.waitForFunction(() => window.__game.buildMode.survival._skin !== undefined, null, { timeout: 30000 })
  const r = await page.evaluate(() => {
    const s = window.__game.buildMode.survival
    const b = window.__game.buildMode
    const out = {}
    const p = b.tryMode.pos
    const msgs = []
    const say = s._message.bind(s)
    s._message = (text, sec) => { msgs.push(text); say(text, sec) }
    // Walk 10 blocks in 1-block steps (no real moving: CI is slow).
    s.eggs.last = null
    for (let i = 0; i <= 10; i++) {
      p.x += i ? 1 : 0
      s.eggs.update()
    }
    // A 50-block jump is a teleport: it doesn't count.
    p.x += 50
    s.eggs.update()
    s.eggs.flush()
    out.eggs = JSON.parse(localStorage.getItem('gayz-creatures')).eggs
    out.list = JSON.parse(localStorage.getItem('gayz-creatures')).list
    out.hatchSaid = msgs.length
    // A Loot Chest with a lucky roll gives an egg.
    const cx = Math.floor(p.x) + 2
    const cz = Math.floor(p.z)
    let cy = Math.floor(p.y)
    while (b.getBlockAt(cx, cy, cz) && cy < p.y + 3) cy++
    b.placeBlock(cx, cy, cz, 'lootchest', false)
    const rand = Math.random
    Math.random = () => 0.01
    try { out.chest = s.useChest(cx, cy, cz) } finally { Math.random = rand }
    out.afterChest = JSON.parse(localStorage.getItem('gayz-creatures')).eggs.length
    b.removeBlock?.(cx, cy, cz)
    return out
  })
  // Saved every 5 blocks: the common egg hatched after the first 5 (295 +
  // 5 = 300), the bad one is gone, rare and epic warmed all 10; the mythic
  // waited, then took the common's place for the last 5.
  expect(r.list.length).toBe(1)
  expect(r.list[0].r).toBe('common')
  expect(r.eggs).toEqual([{ r: 'rare', d: 10 }, { r: 'epic', d: 20 }, { r: 'mythic', d: 5 }])
  expect(r.chest).toBe(true)
  expect(r.afterChest).toBe(4)

  // The Eggs section on Inventory > Pets.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('gayz-creatures'))
    d.eggs = [{ r: 'rare', d: 600 }, { r: 'epic', d: 20 }, { r: 'common', d: 0 }, { r: 'mythic', d: 0 }]
    localStorage.setItem('gayz-creatures', JSON.stringify(d))
    window.__game.buildMode.survival._message = () => {}
  })
  await page.evaluate(() => {
    window.__game._openMenuInventoryPanel?.()
    document.getElementById('inventory-tab-pets').click()
  })
  await page.waitForSelector('#team-eggs .team-egg')
  const ui = await page.evaluate(() => ({
    title: document.querySelector('#team-eggs .team-section-title').textContent,
    warm: [...document.querySelectorAll('#team-eggs .team-egg')].map((e) => e.classList.contains('warm')),
    ready: document.querySelector('#team-eggs .team-egg[data-egg="0"]').classList.contains('armed'),
  }))
  expect(ui.title).toContain('4/13')
  expect(ui.warm).toEqual([true, true, true, false])
  expect(ui.ready).toBe(true)
  // Tap the waiting mythic: it takes the last warming place.
  await page.click('#team-eggs .team-egg[data-egg="3"]')
  let s = await saved()
  expect(s.eggs.map((e) => e.r)).toEqual(['rare', 'epic', 'mythic', 'common'])
  // Tap the ready rare egg: it hatches into a rare creature.
  const before = s.list.length
  await page.click('#team-eggs .team-egg[data-egg="0"]')
  s = await saved()
  expect(s.list.length).toBe(before + 1)
  expect(s.list[s.list.length - 1].r).toBe('rare')
  expect(s.eggs.map((e) => e.r)).toEqual(['epic', 'mythic', 'common'])
})

test('friend battles: same fight on both screens, challenge, invite, yes / no, record, online list', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    const g = window.__game
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    Object.defineProperty(g, '_cloudUid', { get: () => 'uB', set: () => {}, configurable: true })
    g.settings.savedFriends = [{ name: 'Alex', uid: 'uA' }, { name: 'Sam', uid: 'uS' }]
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'common', at: 1, sn: 'steak' },
        { id: 2, t: 'z', k: null, r: 'epic', n: 3, b: false, at: 2, hi: 'claws' },
        { id: 3, t: 'z', k: 'brute', r: 'common', n: 7, b: true, at: 3 },
      ],
      team: [1, 2, 3], wins: 4, losses: 2, nextId: 4,
    }))
    // A pretend Firestore: invites in memory, listeners called by hand.
    const docs = {}
    const watchers = {}
    const fb = {
      docs, calls: [], inviteCb: null,
      createPetDuel: async (from, fromName, to, a) => { const id = `d${Object.keys(docs).length + 1}`; docs[id] = { from, fromName, to, state: 'ask', at: Date.now(), a, b: [], seed: 0 }; return id },
      answerPetDuel: async (id, yes, b = [], seed = 0) => { fb.calls.push({ id, yes, b, seed }); const d = docs[id]; if (!d || d.state !== 'ask') return null; const was = { ...d, id }; Object.assign(d, yes ? { state: 'go', b, seed } : { state: 'no' }); return was },
      deletePetDuel: async (id) => { delete docs[id]; fb.calls.push({ del: id }) },
      watchPetDuel: (id, cb) => { watchers[id] = cb; return () => { delete watchers[id] } },
      subscribePetDuelInvites: (uid, cb) => { fb.inviteCb = cb; return () => { fb.inviteCb = null } },
      fetchPresence: async (uid) => (uid === 'uA' ? { lastActiveAt: Date.now() } : null),
      fire: (id) => watchers[id]?.(docs[id] ? { ...docs[id], id } : null),
    }
    g.__petDuelBackendForTests = fb
    window.__fb = fb
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })

  // 1. The same seed and teams give the same fight, seen from either side.
  const same = await page.evaluate(async () => {
    const g = window.__game
    const FB = g._friendBattle
    const TB = FB.TeamBattle
    const C = g._creatures
    const d = C.loadCreatures()
    const team = d.team.map((id) => d.list.find((c) => c.id === id))
    const packed = FB.packLive(team)
    const foes = FB.packLive([{ t: 'a', k: 'wolf', r: 'rare' }, { t: 'z', k: null, r: 'rare', n: 2, b: false }, { t: 'a', k: 'eagle', r: 'common' }])
    const run = async (me) => {
      let won = 'none'
      const B = new TB({ mine: FB.unpackLive(packed), theirs: FB.unpackLive(foes), foe: 'x', view: '2d', live: { seed: 4242, me, ids: [] }, onEnd: (w) => { won = w; return 0 }, againKey: () => false })
      B.open()
      cancelAnimationFrame(B._raf)
      const speedShown = getComputedStyle(B.root.querySelector('.tb-speed')).display !== 'none'
      const myCards = B.root.querySelectorAll('.tb-mine .tb-card').length
      for (let i = 0; i < 60 * 125 && B._winner === undefined && !B.over; i++) B._step(1 / 60)
      const snap = B.fighters.map((f) => [Math.round(f.hp * 1000), Math.round(f.x * 1000), Math.round(f.z * 1000)].join(','))
      const hazard = B.hazard
      await new Promise((r) => setTimeout(r, 900))
      const text = B.root.querySelector('.tb-result-text').textContent
      const again = B.root.querySelector('.tb-again').style.display
      B.close()
      return { won, snap, hazard, speedShown, myCards, text, again }
    }
    const a = await run('mine')
    const b = await run('foe')
    return { a, b, snapEq: JSON.stringify(a.snap) === JSON.stringify(b.snap), snacks: FB.unpackLive(packed).map((c) => c.sn || ''), badSnack: FB.unpackLive([{ t: 'a', k: 'cow', r: 'common', sn: '__proto__' }])[0].sn }
  })
  expect(same.snapEq).toBe(true)
  expect(same.a.hazard).toBe(same.b.hazard)
  expect(typeof same.a.won).toBe('boolean')
  expect(same.b.won).toBe(!same.a.won)
  expect(same.a.speedShown).toBe(false)
  // Each screen shows its own player's team as "mine" (3 vs 3 here).
  expect(same.a.myCards).toBe(3)
  expect(same.b.myCards).toBe(3)
  expect(same.a.text).toContain('XP only')
  expect(same.a.again).toBe('none')
  expect(same.snacks).toEqual(['steak', '', ''])
  expect(same.badSnack).toBeUndefined()

  // 2. Challenging Alex: waiting box, then Alex says no.
  const no = await page.evaluate(async () => {
    const g = window.__game
    const fb = window.__fb
    await g._friendBattle.challengeFriend(g, 'uA')
    const box = document.getElementById('pet-duel-box')
    const waiting = !box.hidden && box.textContent
    const sent = fb.docs.d1
    await fb.answerPetDuel('d1', false)
    fb.fire('d1')
    await new Promise((r) => setTimeout(r, 50))
    return { waiting, sentTo: sent.to, sentTeam: sent.a.length, sentSnack: sent.a[0].sn, boxHidden: box.hidden, gone: !fb.docs.d1, busy: !!g._petDuel }
  })
  expect(no.waiting).toContain('Waiting for Alex')
  expect(no.sentTo).toBe('uA')
  expect(no.sentTeam).toBe(3)
  expect(no.sentSnack).toBe('steak')
  expect(no.boxHidden).toBe(true)
  expect(no.gone).toBe(true)
  expect(no.busy).toBe(false)

  // 3. Challenging again: Alex says yes - the battle starts on my side.
  const yes = await page.evaluate(async () => {
    const g = window.__game
    const fb = window.__fb
    const coins = g.coins
    await g._friendBattle.challengeFriend(g, 'uA')
    const id = Object.keys(fb.docs)[0]
    await fb.answerPetDuel(id, true, g._friendBattle.packLive([{ t: 'a', k: 'wolf', r: 'rare' }]), 777)
    fb.fire(id)
    const B = g._teamBattle
    const out = { open: !!B?.root, me: B?.me, seed: B?.live?.seed, foe: B?.root?.querySelector('.tb-foe-name').textContent, gone: !fb.docs[id] }
    B._finish(true)
    const d = g._creatures.loadCreatures()
    out.fw = d.fw
    out.wins = d.wins
    out.coins = g.coins - coins
    B.close()
    out.record = document.getElementById('team-friend-record').textContent
    return out
  })
  expect(yes.open).toBe(true)
  expect(yes.me).toBe('mine')
  expect(yes.seed).toBe(777)
  expect(yes.foe).toContain('Alex')
  expect(yes.gone).toBe(true)
  expect(yes.fw).toBe(1)
  expect(yes.wins).toBe(4)
  expect(yes.coins).toBe(0)
  expect(yes.record).toContain('1 wins, 0 losses')

  // 4. An invite to me: strangers ignored, waits while playing, yes starts it turned round.
  const inv = await page.evaluate(async () => {
    const g = window.__game
    const fb = window.__fb
    const FB = g._friendBattle
    FB.watchPetDuels(g, 'uB')
    const team = FB.packLive([{ t: 'a', k: 'wolf', r: 'rare' }, { t: 'a', k: 'eagle', r: 'common' }])
    fb.docs.x1 = { from: 'uStranger', fromName: 'Stranger', to: 'uB', state: 'ask', at: Date.now(), a: team, b: [], seed: 0 }
    fb.inviteCb([{ ...fb.docs.x1, id: 'x1' }])
    const box = () => document.getElementById('pet-duel-box')
    const stranger = !box() || box().hidden
    // Playing in the world: it waits.
    g._enteringBuildMode = true
    fb.docs.x2 = { from: 'uA', fromName: 'Alex', to: 'uB', state: 'ask', at: Date.now(), a: team, b: [], seed: 0 }
    fb.inviteCb([{ ...fb.docs.x1, id: 'x1' }, { ...fb.docs.x2, id: 'x2' }])
    const waitedInGame = box().hidden
    g._enteringBuildMode = false
    FB.inviteTick(g)
    const text = box().hidden ? '' : box().textContent
    box().querySelector('.pet-duel-yes').click()
    await new Promise((r) => setTimeout(r, 50))
    const call = fb.calls.filter((c) => c.id === 'x2').pop()
    const B = g._teamBattle
    const out = { stranger, waitedInGame, text, yes: call?.yes, b: call?.b.length, seedOk: Number.isInteger(call?.seed) && call.seed > 0, me: B?.me, myCards: B?.root?.querySelectorAll('.tb-mine .tb-card').length, mineInside: B?.mine.length }
    B._finish(true) // the challenger's side won: I lost
    out.fl = g._creatures.loadCreatures().fl
    B.close()
    // Old ones run out after INVITE_S.
    fb.inviteCb([{ ...fb.docs.x1, id: 'x1' }, { ...fb.docs.x2, id: 'x3' }])
    FB.inviteTick(g, Date.now() + (FB.INVITE_S + 1) * 1000)
    out.expired = box().hidden && g._petInvites.length === 0
    FB.watchPetDuels(g, null)
    return out
  })
  expect(inv.stranger).toBe(true)
  expect(inv.waitedInGame).toBe(true)
  expect(inv.text).toContain('Alex wants a pet battle')
  expect(inv.yes).toBe(true)
  expect(inv.b).toBe(3)
  expect(inv.seedOk).toBe(true)
  expect(inv.me).toBe('foe')
  expect(inv.myCards).toBe(3)
  expect(inv.mineInside).toBe(2)
  expect(inv.fl).toBe(1)
  expect(inv.expired).toBe(true)

  // 5. Pets tab: Battle a Friend lists online friends; the profile button.
  await page.click('#friend-battle-btn')
  await page.waitForSelector('#friend-battle-list [data-duel-uid]')
  const list = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#friend-battle-list .friend-battle-row')].map((r) => r.textContent),
    profileBtn: document.getElementById('friend-petduel-btn')?.textContent,
  }))
  expect(list.rows.length).toBe(1)
  expect(list.rows[0]).toContain('Alex')
  expect(list.profileBtn).toBe('Pet Battle')
})

test('cheer: meter fills from hits, three picks, bots cheer, friend battles land on the same step, guide', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true })
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'common', at: 1 },
        { id: 2, t: 'z', k: null, r: 'rare', n: 2, b: false, at: 2 },
      ],
      team: [1, 2], wins: 0, losses: 0, nextId: 3,
    }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const guide = await page.evaluate(() => document.getElementById('team-guide').textContent)
  expect(guide).toContain('Cheer')
  expect(guide).toContain('Team hits 30% harder')
  const r = await page.evaluate(async () => {
    const g = window.__game
    const FB = g._friendBattle
    const TB = FB.TeamBattle
    const mine = FB.unpackLive(FB.packLive([{ t: 'a', k: 'cow', r: 'rare' }, { t: 'z', k: null, r: 'rare', n: 2, b: false }]))
    const theirs = FB.unpackLive(FB.packLive([{ t: 'a', k: 'wolf', r: 'rare' }, { t: 'a', k: 'pig', r: 'rare' }]))
    const out = {}
    const go = (B, s) => { for (let i = 0; i < s * 60; i++) B._step(1 / 60) }

    // 1. On my own: empty meter = no cheer; hits fill it; a full one picks.
    const B = new TB({ mine, theirs, foe: 'x', view: '2d', hazard: null, botCheer: false, xp: false })
    B.open()
    cancelAnimationFrame(B._raf)
    go(B, 2.5)
    B._cheerUI()
    out.emptyDisabled = B.root.querySelector('.tb-cheer-btn').disabled
    out.emptyCheer = B.cheer('atk')
    const before = B.meter.mine
    const f0 = B.fighters.find((f) => f.side === 'mine')
    B._hit(B.fighters.find((f) => f.side === 'foe'), f0)
    out.fills = B.meter.mine > before
    B.meter.mine = 1
    B._cheerUI()
    out.readyBtn = !B.root.querySelector('.tb-cheer-btn').disabled
    B.root.querySelector('.tb-cheer-btn').click()
    out.pickShown = !B.root.querySelector('.tb-cheer-pick').hidden
    out.pickCount = B.root.querySelectorAll('.tb-cheer-opt').length
    B.root.querySelector('.tb-cheer-opt[data-cheer="atk"]').click()
    B._step(1 / 60)
    out.atk = B.fighters.filter((f) => f.side === 'mine' && f.alive).every((f) => f.cheer === 'atk')
    out.meterAfter = B.meter.mine
    out.say = B.root.querySelector('.tb-msg').textContent
    go(B, 5.2)
    out.wornOff = B.fighters.filter((f) => f.side === 'mine').every((f) => !f.cheer)
    // Heal: health back now.
    const hurt = B.fighters.find((f) => f.side === 'mine' && f.alive)
    hurt.hp = Math.max(1, Math.round(hurt.s.hp * 0.3))
    const low = hurt.hp
    B.meter.mine = 1
    B.cheer('heal')
    B._step(1 / 60)
    out.healed = hurt.hp > low
    B.close()

    // 2. Bot teams cheer a little after their meter fills.
    const C = new TB({ mine, theirs, foe: 'x', view: '2d', hazard: null, xp: false })
    C.open()
    cancelAnimationFrame(C._raf)
    go(C, 2.5)
    C.meter.foe = 1
    go(C, 3.2)
    out.botCheered = (C.cheers?.foe || 0) === 1 && C.meter.foe < 1
    C.close()

    // 3. A friend battle: my cheer is sent, lands CHEER_LEAD steps later;
    // the friend's screen gets it and the fight stays the same on both.
    const sent = []
    const run = async (me, cheerFrom) => {
      const L = new TB({ mine: FB.unpackLive(FB.packLive(mine)), theirs: FB.unpackLive(FB.packLive(theirs)), foe: 'x', view: '2d', live: { seed: 777, me, ids: [] }, onEnd: () => 0, againKey: () => false, onCheer: async (kind, at) => { sent.push({ kind, at }); return true } })
      L.open()
      cancelAnimationFrame(L._raf)
      for (let i = 0; i < 60 * 125 && L._winner === undefined && !L.over; i++) {
        L._step(1 / 60)
        if (L.time > 2.5 && L.steps === 200) {
          L.meter.mine = 1
          L.meter.foe = 1
          if (cheerFrom === me) {
            L.cheer('atk')
            await new Promise((res) => setTimeout(res, 0))
          } else {
            const s = sent[sent.length - 1]
            if (s) L.friendCheer(s.kind, s.at)
          }
        }
      }
      const snap = L.fighters.map((f) => [Math.round(f.hp * 1000), Math.round(f.x * 1000)].join(',')).join('|')
      const cheers = L.cheers?.mine || 0
      L.close()
      return { snap, cheers }
    }
    const a = await run('mine', 'mine')
    const b = await run('foe', 'mine')
    out.liveSent = sent.length === 1 && sent[0].at === 200 + 90
    out.liveSame = a.snap === b.snap
    out.liveCheered = a.cheers === 1 && b.cheers === 1
    // A cheer that can't be sent does nothing and keeps the meter.
    const F = new TB({ mine, theirs, foe: 'x', view: '2d', live: { seed: 5, me: 'mine', ids: [] }, onEnd: () => 0, onCheer: async () => false })
    F.open()
    cancelAnimationFrame(F._raf)
    go(F, 2.5)
    F.meter.mine = 1
    F.cheer('speed')
    await new Promise((res) => setTimeout(res, 0))
    go(F, 2)
    out.failKeeps = F.meter.mine === 1 && !F.cheerWait.mine && F.fighters.every((f) => !f.cheer)
    F.close()
    return out
  })
  expect(r.emptyDisabled).toBe(true)
  expect(r.emptyCheer).toBe(false)
  expect(r.fills).toBe(true)
  expect(r.readyBtn).toBe(true)
  expect(r.pickShown).toBe(true)
  expect(r.pickCount).toBe(3)
  expect(r.atk).toBe(true)
  expect(r.meterAfter).toBe(0)
  expect(r.say).toContain('You cheered: Attack')
  expect(r.wornOff).toBe(true)
  expect(r.healed).toBe(true)
  expect(r.botCheered).toBe(true)
  expect(r.liveSent).toBe(true)
  expect(r.liveSame).toBe(true)
  expect(r.liveCheered).toBe(true)
  expect(r.failKeeps).toBe(true)
})

test('after-battle stats: damage, healing, taken, knockouts per pet + Best Pet award', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => {
    const FB = window.__game._friendBattle
    const TB = FB.TeamBattle
    const mine = FB.unpackLive(FB.packLive([{ t: 'a', k: 'cow', r: 'rare' }, { t: 'z', k: null, r: 'rare', n: 2, b: false }]))
    const theirs = FB.unpackLive(FB.packLive([{ t: 'a', k: 'wolf', r: 'common' }, { t: 'a', k: 'pig', r: 'common' }]))
    const B = new TB({ mine, theirs, foe: 'x', view: '2d', hazard: null, botCheer: false, xp: false })
    B.open()
    cancelAnimationFrame(B._raf)
    for (let i = 0; i < 200 * 60 && !B.over; i++) B._step(1 / 60)
    const sum = (side, k) => B.fighters.filter((f) => f.side === side).reduce((s, f) => s + f.st[k], 0)
    const downs = (side) => B.fighters.filter((f) => f.side === side && !f.alive).length
    // Healing only counts what it really gave.
    const f = B.fighters[0]
    f.hp = f.s.hp - 3
    const before = f.st.heal
    B._heal(f, 50)
    const out = {
      over: B.over,
      mineDmg: sum('mine', 'dmg'), foeTook: sum('foe', 'took'),
      foeDmg: sum('foe', 'dmg'), mineTook: sum('mine', 'took'),
      mineKo: sum('mine', 'ko'), foeDowns: downs('foe'),
      foeKo: sum('foe', 'ko'), mineDowns: downs('mine'),
      healGain: f.st.heal - before, fullHp: f.hp === f.s.hp,
      shown: B.root.querySelector('.tb-result').style.display,
      rows: B.root.querySelectorAll('.tb-stats-table tbody tr:not(.tb-stats-team)').length,
      teams: B.root.querySelectorAll('.tb-stats-team').length,
      best: B.root.querySelectorAll('.tb-stats-best').length,
      award: B.root.querySelector('.tb-stats-award').textContent,
    }
    B.close()
    return out
  })
  expect(r.over).toBe(true)
  expect(r.shown).toBe('flex')
  expect(r.mineDmg).toBeGreaterThan(0)
  expect(r.mineDmg).toBe(r.foeTook)
  expect(r.foeDmg).toBe(r.mineTook)
  expect(r.mineKo).toBe(r.foeDowns)
  expect(r.foeKo).toBe(r.mineDowns)
  expect(r.healGain).toBe(3)
  expect(r.fullHp).toBe(true)
  expect(r.rows).toBe(4)
  expect(r.teams).toBe(2)
  expect(r.best).toBe(1)
  expect(r.award).toContain('Best pet:')
})

test('replays: the same fight again (cheers too), watch / save / delete, 10 max, pause, skip', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.removeItem('gayz-pet-replays')
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'rare', at: 1 },
        { id: 2, t: 'z', k: null, r: 'rare', n: 2, b: false, at: 2 },
      ],
      team: [1, 2], wins: 0, losses: 0, nextId: 3,
    }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const { TeamBattle: TB, playReplay, loadReplays, saveReplay, SAVED_MAX } = g._replays
    const mine = [{ id: 1, t: 'a', k: 'cow', r: 'rare' }, { id: 2, t: 'z', k: null, r: 'rare', n: 2, b: false }]
    const theirs = [{ t: 'a', k: 'wolf', r: 'rare' }, { t: 'a', k: 'pig', r: 'rare' }, { t: 'z', k: null, r: 'common', n: 1, b: false }]
    const out = {}
    // Runs to the end; my cheer goes off as soon as my meter is full.
    const run = (B, cheer) => {
      for (let i = 0; i < 9000 && !B.over && B._winner === undefined; i++) {
        if (cheer && B.meter.mine >= 1 && B._canCheer()) B.cheer('atk')
        B._step(1 / 60)
      }
      if (!B.over) B._finish(B._winner === undefined ? true : B._winner)
      return JSON.stringify({ steps: B.steps, cheers: B.cheers, hp: B.fighters.map((f) => Math.round(f.hp * 1000)), st: B.fighters.map((f) => f.st) })
    }
    const B = new TB({ mine, theirs, foe: 'Bot', view: '2d', xp: false, onEnd: () => 0 })
    B.open()
    out.first = run(B, true)
    out.rec = { seed: Number.isInteger(B.rec.seed), ch: B.rec.ch.length, won: typeof B.rec.won }
    out.last = !!loadReplays().last
    // The result screen: Watch Replay and Save Replay.
    out.watchBtn = !!B.root.querySelector('.tb-replay-watch')
    B.root.querySelector('.tb-replay-save').click()
    out.saveText = B.root.querySelector('.tb-replay-save').textContent
    out.savedN = loadReplays().saved.length
    B.root.querySelector('.tb-replay-watch').click()
    const R = g._teamBattle
    out.isReplay = !!R.replay && R !== B
    out.tag = !!R.root.querySelector('.tb-replay-tag')
    out.cheerHidden = R.root.querySelector('.tb-cheer').hidden
    out.again = run(R, false)
    out.same = out.again === out.first
    out.replayText = R.root.querySelector('.tb-result-text').textContent
    out.noXpNews = R.root.querySelector('.tb-result-news').children.length === 0
    R.close()
    // Skip to end lands on the same result.
    const S = playReplay(loadReplays().last, { view: '2d' })
    S._skip()
    out.skipOver = S.over
    out.skipTitle = S.root.querySelector('.tb-result-title').textContent
    out.firstTitle = B.rec.won ? 'won' : 'lost'
    S.close()
    // Pause: no steps while paused.
    const P = playReplay(loadReplays().last, { view: '2d' })
    P.root.querySelector('.tb-replay-pause').click()
    const at = P.steps
    await new Promise((res) => setTimeout(res, 400))
    out.pausedSteps = P.steps - at
    out.pauseText = P.root.querySelector('.tb-replay-pause').textContent
    P.close()
    // 10 at most.
    const rec = loadReplays().last
    for (let i = 1; i <= SAVED_MAX; i++) saveReplay({ ...rec, t: rec.t + i })
    out.fullN = loadReplays().saved.length
    out.full = saveReplay({ ...rec, t: rec.t + 99 })
    return out
  })
  expect(r.rec).toEqual({ seed: true, ch: expect.any(Number), won: 'boolean' })
  expect(r.last).toBe(true)
  expect(r.watchBtn).toBe(true)
  expect(r.saveText).toBe('Saved!')
  expect(r.savedN).toBe(1)
  expect(r.isReplay).toBe(true)
  expect(r.tag).toBe(true)
  expect(r.cheerHidden).toBe(true)
  expect(r.same).toBe(true)
  expect(r.replayText).toBe('Replay over.')
  expect(r.noXpNews).toBe(true)
  expect(r.skipOver).toBe(true)
  expect(r.skipTitle.toLowerCase()).toContain(r.firstTitle === 'won' ? 'won' : 'lost')
  expect(r.pausedSteps).toBe(0)
  expect(r.pauseText).toBe('Play')
  expect(r.fullN).toBe(10)
  expect(r.full).toBe('full')

  // The Pets tab list: last battle + saved ones; delete takes two taps.
  await page.evaluate(() => { window.__game._openMenuInventoryPanel(); document.getElementById('inventory-tab-pets').click() })
  await page.click('#replays-btn')
  const list = await page.evaluate(() => {
    const el = document.getElementById('replays-list')
    const rows = () => el.querySelectorAll('.replay-row').length
    const out = { open: !el.hidden, rows: rows(), last: el.textContent.includes('Last battle'), count: el.textContent.includes('Saved: 10 / 10') }
    const del = () => el.querySelector('[data-replay-del]')
    del().click()
    out.sure = del().textContent
    out.afterOne = rows()
    del().click()
    out.afterTwo = rows()
    return out
  })
  expect(list).toEqual({ open: true, rows: 11, last: true, count: true, sure: 'Sure?', afterOne: 11, afterTwo: 10 })
})

test('collection book: old pets count, new catches, ??? pages, groups, search, milestone coins once', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({
      list: [
        { id: 1, t: 'a', k: 'cow', r: 'rare', at: 5000, x: 500 },
        { id: 2, t: 'a', k: 'cow', r: 'common', at: 3000, s: true },
        { id: 3, t: 'z', k: 'mage', r: 'rare', n: 2, b: false, at: 4000 },
      ],
      team: [1, 2, 3], wins: 0, losses: 0, nextId: 4,
      // A made-up kind and a bad count are dropped.
      book: { 'a:nope': { n: 3 }, 'z:': { n: 'x' } },
    }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(() => {
    const g = window.__game
    const pb = g._petBook
    const out = {}
    const saved = () => JSON.parse(localStorage.getItem('gayz-creatures'))
    document.getElementById('pet-book-btn').click()
    const box = document.getElementById('pet-book')
    out.open = !box.hidden
    out.total = pb.bookKinds().length
    out.cards = box.querySelectorAll('.pet-book-card').length
    out.unmet = box.querySelectorAll('.pet-book-card.unmet').length
    out.book = saved().book
    out.count = document.getElementById('pet-book-count').textContent
    // A ??? page: dark picture, where to find it.
    box.querySelector('.pet-book-card.unmet').click()
    out.unmetPage = document.getElementById('pet-book-page').textContent.replace(/\s+/g, ' ')
    out.pageH1 = document.getElementById('pet-book-page').offsetHeight
    box.querySelector('[data-book-key="a:cow"]').click()
    out.cowPage = document.getElementById('pet-book-page').textContent.replace(/\s+/g, ' ')
    out.pageH2 = document.getElementById('pet-book-page').offsetHeight
    // Groups and search.
    box.querySelector('[data-book-group="skeleton"]').click()
    out.skel = box.querySelectorAll('.pet-book-card').length
    box.querySelector('[data-book-group="all"]').click()
    const search = document.getElementById('pet-book-search')
    search.value = 'cow'
    search.dispatchEvent(new Event('input'))
    out.search = [...box.querySelectorAll('.pet-book-card .team-card-name')].map((e) => e.textContent)
    search.value = ''
    search.dispatchEvent(new Event('input'))
    // A new catch counts.
    pb.addCreature({ t: 'a', k: 'pig', r: 'common' })
    out.pig = saved().book['a:pig']
    // Milestone: catching 25% of the kinds pays once.
    const coins0 = g.coins
    const kinds = pb.bookKinds()
    const d = g._creatures.loadCreatures()
    for (const c of kinds.slice(0, Math.ceil(kinds.length / 4) + 1)) d.book[`${c.t}:${c.k || ''}`] = { n: 1, f: 1, lv: 1 }
    g._creatures.saveCreatures(d)
    pb.updateBook(g)
    out.paid = g.coins - coins0
    pb.updateBook(g)
    out.paidAgain = g.coins - coins0
    out.bp = saved().bp
    pb.state.open = null
    return out
  })
  expect(r.open).toBe(true)
  expect(r.total).toBeGreaterThan(100)
  expect(r.cards).toBe(r.total)
  expect(r.unmet).toBe(r.total - 2)
  // Old pets fill their pages: 2 cows (best level, earliest date, shiny), the mage.
  expect(r.book['a:cow'].n).toBe(2)
  expect(r.book['a:cow'].f).toBe(3000)
  expect(r.book['a:cow'].lv).toBeGreaterThan(1)
  expect(r.book['a:cow'].s).toBe(true)
  expect(r.book['z:mage'].n).toBe(1)
  expect(r.book['a:nope']).toBeUndefined()
  expect(r.book['z:']).toBeUndefined()
  expect(r.count).toContain(`2 of ${r.total}`)
  expect(r.unmetPage).toContain('???')
  expect(r.unmetPage).toContain('Where:')
  expect(r.cowPage).toContain('Cow')
  expect(r.cowPage).toContain('Caught 2')
  expect(r.cowPage).toContain('Shiny caught')
  // Same box height with or without a page open.
  expect(r.pageH1).toBe(r.pageH2)
  expect(r.skel).toBe(4)
  expect(r.search).toEqual(['Cow'])
  expect(r.pig.n).toBe(1)
  expect(r.paid).toBe(150)
  expect(r.paidAgain).toBe(150)
  expect(r.bp).toEqual([25])
})

test('weekly challenge: one rule a week, 5 bot battles in a row, prize + badge once', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [{ id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1, x: 900, sn: 'steak' }, { id: 2, t: 'z', k: null, r: 'common', n: 3, at: 1 }], team: [1, 2], wins: 0, losses: 0, nextId: 3 }))
    localStorage.removeItem('gayz-weekly-challenge')
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const r = await page.evaluate(() => {
    const g = window.__game
    const W = g._weekly
    const byId = (id) => document.getElementById(id)
    const out = {}
    // Ten weeks = all ten rules, then round again.
    out.rules = new Set(Array.from({ length: 10 }, (_, i) => W.ruleOf(i).id)).size
    out.wraps = W.ruleOf(3).id === W.ruleOf(13).id
    const rule = (id) => W.RULES.find((x) => x.id === id)
    // Rules on a team: copies, saved pets unchanged.
    const lv1 = W.applyRule(rule('level1'), [{ id: 1, t: 'a', k: 'wolf', r: 'rare', x: 900 }])[0]
    out.lv1 = [lv1.x, lv1.l, lv1.id]
    const bare = W.applyRule(rule('bare'), [{ t: 'a', k: 'wolf', r: 'rare', sn: 'steak', hi: 'fang' }])[0]
    out.bare = [bare.sn, bare.hi]
    out.common = W.applyRule(rule('common'), [{ t: 'a', k: 'wolf', r: 'mythic' }])[0].r
    // No dinos owned: 5 loaners. Lucky Dip: the same team all week.
    const dino = W.weeklyTeam(rule('dino'), 100)
    out.loaners = [dino.length, dino.every((c) => c.loan && c.l === 1)]
    out.dip = JSON.stringify(W.weeklyTeam(rule('random'), 100)) === JSON.stringify(W.weeklyTeam(rule('random'), 100))
    out.trio = W.weeklyTeam(rule('trio'), 100).length
    // Bots follow the rule and land near the power asked for.
    const foe = W.foeTeam(rule('level1'), 100, 2, 400, 5)
    out.foeLv1 = foe.every((c) => c.l === 1)
    const foe2 = W.foeTeam(rule('skeleton'), 100, 4, 600, 5)
    out.foeNear = Math.abs(W.power(foe2) / 600 - 1) < 0.35
    out.foeSkel = foe2.every((c) => c.t === 'z')
    // The Pets tab section.
    out.title = byId('weekly-challenge').querySelector('h3').textContent
    out.dots = document.querySelectorAll('.weekly-dot').length
    out.btn = byId('weekly-btn').textContent
    // Lose: 5 coins, still battle 1.
    let coins = g.coins
    byId('weekly-btn').click()
    out.foe = document.querySelector('#team-battle .tb-foe-name').textContent
    g._teamBattle._finish(false)
    out.lostCoins = g.coins - coins
    document.querySelector('#team-battle .tb-back').click()
    out.afterLoss = W.loadWeekly().step
    // Win all 5 (the Next battle button each time).
    coins = g.coins
    const items = () => Object.values(JSON.parse(localStorage.getItem('gayz-creatures')).items || {}).reduce((a, b) => a + b, 0)
    const before = items()
    byId('weekly-btn').click()
    for (let i = 0; i < 5; i++) {
      g._teamBattle._finish(true)
      const again = document.querySelector('#team-battle .tb-again')
      if (i < 4) {
        if (i === 0) out.nextBtn = again.textContent
        again.click()
      } else out.lastAgain = again ? getComputedStyle(again).display : 'none'
    }
    document.querySelector('#team-battle .tb-back').click()
    out.wonCoins = g.coins - coins
    out.itemGot = items() - before
    const d = W.loadWeekly()
    out.step = d.step
    out.badges = d.badges.length
    out.badgeShown = document.querySelectorAll('.weekly-badge').length
    out.doneBtn = byId('weekly-btn').disabled
    // Saved pets untouched by the rules.
    out.wolf = JSON.parse(localStorage.getItem('gayz-creatures')).list[0].x >= 900
    return out
  })
  expect(r.rules).toBe(10)
  expect(r.wraps).toBe(true)
  expect(r.lv1).toEqual([undefined, 1, 1])
  expect(r.bare).toEqual([undefined, undefined])
  expect(r.common).toBe('common')
  expect(r.loaners).toEqual([5, true])
  expect(r.dip).toBe(true)
  expect(r.trio).toBe(2)
  expect(r.foeLv1).toBe(true)
  expect(r.foeNear).toBe(true)
  expect(r.foeSkel).toBe(true)
  expect(r.title).toContain('Weekly Challenge')
  expect(r.dots).toBe(5)
  expect(r.btn).toContain('1/5')
  expect(r.foe).toContain('1/5')
  expect(r.lostCoins).toBe(5)
  expect(r.afterLoss).toBe(0)
  expect(r.nextBtn).toBe('Next battle')
  expect(r.lastAgain).toBe('none')
  expect(r.wonCoins).toBe(25 * 5 + 500)
  expect(r.itemGot).toBe(1)
  expect(r.step).toBe(5)
  expect(r.badges).toBe(1)
  expect(r.badgeShown).toBe(1)
  expect(r.doneBtn).toBe(true)
  expect(r.wolf).toBe(true)
})

test('pet battle leaderboard: trophies, rank badge, All-time / This week / Friends lists', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [{ id: 1, t: 'a', k: 'wolf', r: 'rare', at: 1 }], team: [1], wins: 0, losses: 0, nextId: 2, tr: 790, tw: { w: 1, n: 99 } }))
    window.__game._openMenuInventoryPanel()
    document.getElementById('inventory-tab-pets').click()
  })
  const math = await page.evaluate(() => {
    const R = window.__game._petRank
    return {
      even: [R.trophyChange(true, 100, 100), R.trophyChange(false, 100, 100)],
      strong: [R.trophyChange(true, 100, 500), R.trophyChange(false, 100, 500)],
      weak: [R.trophyChange(true, 500, 100), R.trophyChange(false, 500, 100)],
      ranks: [0, 299, 300, 800, 1500, 2500, 4000].map((n) => R.rankOf(n).id),
      line: document.getElementById('pet-rank-line').textContent.replace(/\s+/g, ' ').trim(),
    }
  })
  expect(math.even).toEqual([20, -10])
  expect(math.strong).toEqual([40, -5])
  expect(math.weak).toEqual([10, -20])
  expect(math.ranks).toEqual(['bronze', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion'])
  // An old week's trophies don't count as this week's.
  expect(math.line).toBe('Silver 790 trophies · this week: 0')

  // A Battle-button win: trophies + the rank up in the result news.
  await page.click('#team-battle-btn')
  await page.waitForSelector('#team-battle canvas')
  const won = await page.evaluate(async () => {
    const b = window.__game._teamBattle
    b._finish(true)
    const d = JSON.parse(localStorage.getItem('gayz-creatures'))
    return { news: [...document.querySelectorAll('#team-battle .tb-result-news li')].map((li) => li.textContent), tr: d.tr, week: d.tw.n }
  })
  expect(won.tr).toBeGreaterThanOrEqual(800)
  expect(won.week).toBe(won.tr - 790)
  expect(won.news.slice(-2)).toEqual([`+${won.tr - 790} trophies`, 'New rank: Gold!'])
  await page.evaluate(() => document.querySelector('#team-battle .tb-back').click())

  // The lists, with a pretend Firestore (never the live one in tests).
  const lists = await page.evaluate(async () => {
    const g = window.__game
    const sent = []
    g._cloudUid = 'me'
    g.settings.savedFriends = [{ uid: 'f1', name: 'Pal' }]
    g._petRankCache = null
    g._petRankPushed = false
    g.__petRankBackendForTests = {
      isConfigured: () => true,
      savePetTrophies: async (uid, week, e) => { sent.push({ uid, ...e }) },
      fetchPetTrophyTop: async (week) => (week == null
        ? [{ uid: 'a', nickname: 'Ace', tr: 4200 }, { uid: 'me', nickname: 'Me', tr: 810 }]
        : [{ uid: 'b', nickname: '<b>Bee</b>', tr: 300, n: 150 }]),
      fetchPetTrophyRank: async (week) => (week == null ? 2 : 5),
      fetchPetTrophies: async () => [{ uid: 'f1', nickname: 'Pal', tr: 2600, n: 40 }],
    }
    const rows = () => [...document.querySelectorAll('#pet-rank-list .pet-rank-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim())
    const wait = () => new Promise((r) => setTimeout(r, 50))
    const out = {}
    document.getElementById('pet-rank-btn').click()
    await wait()
    out.all = rows()
    out.me = document.getElementById('pet-rank-me').textContent
    out.meRow = document.querySelectorAll('#pet-rank-list .pet-rank-row.me').length
    out.h1 = document.getElementById('pet-rank-list').getBoundingClientRect().height
    document.querySelector('[data-rank-tab="week"]').click()
    await wait()
    out.week = rows()
    out.weekMe = document.getElementById('pet-rank-me').textContent
    out.noTags = !document.querySelector('#pet-rank-list b')
    document.querySelector('[data-rank-tab="friends"]').click()
    await wait()
    out.friends = rows()
    out.h2 = document.getElementById('pet-rank-list').getBoundingClientRect().height
    out.sent = sent
    return out
  })
  expect(lists.all).toEqual(['#1 Champion Ace 4200', '#2 Gold Me (you) 810'])
  expect(lists.me).toBe('Your place: #2')
  expect(lists.meRow).toBe(1)
  expect(lists.week).toEqual(['#1 Silver <b>Bee</b> 150'])
  expect(lists.weekMe).toBe('Your place: #5')
  expect(lists.noTags).toBe(true)
  expect(lists.friends[0]).toBe('#1 Diamond Pal 2600')
  expect(lists.friends[1]).toMatch(/^#2 Gold .* \(you\) 8\d\d$/)
  // Same height on every tab.
  expect(lists.h1).toBe(lists.h2)
  // Opening it sent my trophies first (signed in).
  expect(lists.sent.length).toBe(1)
  expect(lists.sent[0].uid).toBe('me')
  expect(lists.sent[0].tr).toBe(won.tr)
})

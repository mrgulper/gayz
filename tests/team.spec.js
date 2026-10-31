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
    // Walk toward them and keep hitting, until it's over (the round clock
    // ends it at the latest).
    b.keys.add('f')
    b.attackHeld = true
    for (let i = 0; i < 4000 && !b.over; i++) {
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

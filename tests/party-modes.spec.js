// Party and fun modes.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// 2026-10-26: on a server the killing shot gets its rarity's coins and
// everyone else who did 10%+ of its health an assist (25%); the big map's
// sharp tiles are drawn by workers, the same picture as before.
test('kill + assist coins on servers, map tiles drawn off the main thread', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    const out = {}
    bm.placeBlock(0, 1, 0, 'playerstart', false, { facing: 0 })
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    // As the host: A did 30%, me 5%, B 15%, C finished it.
    const credits = []
    s.net = { isHost: true, players: new Map(), queueCredit: (to, boss, skeleton, tier, assist) => credits.push([to, tier, !!assist]), queueHurt() {}, targets: () => [] }
    const z1 = s._makeZombie(901, 5, 1, 5, 1000, false, null, { tier: 'epic', name: 1 })
    s.damageZombie(z1, 300, null, 'A')
    s.damageZombie(z1, 50)
    s.damageZombie(z1, 150, null, 'B')
    s.damageZombie(z1, 9999, null, 'C')
    out.credits = credits.splice(0)
    // My 20% of a boss someone else finished: a quarter of its coins.
    const before = s.coins
    const z2 = s._makeZombie(902, 6, 1, 6, 1000, true, null, { tier: 'legendary', name: 2 })
    s.damageZombie(z2, 200)
    s.damageZombie(z2, 9999, null, 'A')
    out.assistCoins = s.coins - before
    out.assists = s.stats.assists
    out.msg = document.getElementById('build-play-msg').textContent
    // As a guest: an assist credit for a rare one pays a quarter of its coins.
    s.net = null
    const c0 = s.coins
    s._countAssist(false, 'rare')
    out.guestAssist = s.coins - c0
    s.net = null
    s.stop()
    return out
  })
  // The map: a worker's tile is the same picture as one drawn here.
  await page.evaluate(() => { window.__game.settings.selectedGameMode = 'worldMap' })
  await page.evaluate(() => window.__game.playBtn.click())
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active && window.__game.buildMode.world.active, null, { timeout: 60000 })
  const m = await page.evaluate(async () => {
    const bm = window.__game.buildMode
    bm.survival._spawnAt({ lat: 46, lon: 7, biome: 'mountains' })
    const w = bm.world
    const p = bm.tryMode.pos
    const out = []
    for (const T of [32, 128, 1024]) {
      const tx = Math.floor(p.x / T)
      const tz = Math.floor(p.z / T)
      // Asked again each time, as the map does each draw (a tile drawn for
      // land that changed meanwhile - the real heights arriving - is dropped).
      let tile = null
      for (let i = 0; i < 400 && !(tile = w.mapTile(tx, tz, true, T)); i++) await new Promise((res) => setTimeout(res, 25))
      const S = tile.canvas.width
      const a = tile.canvas.getContext('2d').getImageData(0, 0, S, S).data
      const b = w._drawTile(tx, tz, T, S).getContext('2d').getImageData(0, 0, S, S).data
      out.push(a.every((v, i) => v === b[i]))
    }
    return { worker: !!w._tileWorkers, same: out }
  })
  expect(r.credits).toEqual([['C', 'epic', false], ['A', 'epic', true], ['B', 'epic', true]])
  expect(r.assistCoins).toBe(43)
  expect(r.assists).toBe(1)
  expect(r.msg).toContain('43')
  expect(r.guestAssist).toBe(6)
  expect(m).toEqual({ worker: true, same: [true, true, true] })
})

// Infection mode on your own (Infection.js): bots fill the game, one turns,
// tags spread it, a shot stuns, and the round ends when everyone's turned.
test('Infection: bots, tags, stuns and the round ending', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    // Solo: no server for the lobby.
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'infection'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const inf = s.infection
    const out = { mode: s.cfg.mode, noZombies: s.cfg.noZombies, phase0: inf.phase }
    inf.update(0.05)
    out.bots = inf.bots.size
    const start = [...inf.bots.values()].map((b) => [b.x, b.z])
    // The wait runs out: a round starts with one infected.
    for (let i = 0; i < 200 && inf.phase === 'wait'; i++) inf.update(0.05)
    out.phase1 = inf.phase
    out.infected1 = inf.infected.size
    // Bots move and stay on the ground (not NaN, not falling forever).
    for (let i = 0; i < 40; i++) inf.update(0.05)
    out.botsMoved = [...inf.bots.values()].some((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 0.5)
    out.botsOk = [...inf.bots.values()].every((b) => Number.isFinite(b.y) && Math.abs(b.y - s._groundUnder(b.x, b.y + 0.05, b.z)) < 1.5)
    // Make one bot the only zombie, right on top of me: I'm tagged.
    const [first] = inf.bots.values()
    inf.infected = new Set([first.id])
    inf.stunned.clear()
    const me = s.bodyPos()
    first.x = me.x
    first.y = me.y
    first.z = me.z
    inf.update(0.02)
    out.meInfected = inf.meInfected
    out.speed = s.bm.tryMode.speedMult
    out.vignette = document.getElementById('infection-vignette')?.className
    out.hud = document.getElementById('build-play-wave-text')?.textContent || ''
    // Infected can't stun; a human can.
    const ray = s.bm._raycaster.ray.clone()
    const B = s.B
    ray.origin.set((first.x + 4) * B, (first.y + 1) * B, first.z * B)
    ray.direction.set(-1, 0, 0)
    out.shotWhileInfected = inf.shoot(ray, 40 * B)
    inf.infected.delete(inf.myId)
    out.shotAsHuman = inf.shoot(ray, 40 * B)
    out.stunned = inf.stunned.has(first.id)
    // Everyone turned: the zombies win and I (a zombie) get coins.
    const coins = g.coins
    for (const p of inf._people()) inf.infected.add(p.id)
    inf.update(0.02)
    out.phase2 = inf.phase
    out.winner = inf.winner
    out.coins = g.coins - coins
    // Then a new round.
    for (let i = 0; i < 200 && inf.phase === 'end'; i++) inf.update(0.05)
    out.phase3 = inf.phase
    out.round = inf.round
    out.zombies = s.zombies.length
    g._exitBuildMode()
    out.vignetteGone = !document.getElementById('infection-vignette')
    out.botsGone = !g.buildMode.scene.children.some((c) => c === first.group)
    return out
  })
  expect(r.mode).toBe('infection')
  expect(r.noZombies).toBe(true)
  expect(r.phase0).toBe('wait')
  expect(r.bots).toBe(5)
  expect(r.phase1).toBe('play')
  expect(r.infected1).toBe(1)
  expect(r.botsMoved).toBe(true)
  expect(r.botsOk).toBe(true)
  expect(r.meInfected).toBe(true)
  expect(r.speed).toBeGreaterThan(1.1)
  expect(r.vignette).toBe('on')
  expect(r.hud).toContain('Infection')
  expect(r.shotWhileInfected).toBe(false)
  expect(r.shotAsHuman).toBe(true)
  expect(r.stunned).toBe(true)
  expect(r.phase2).toBe('end')
  expect(r.winner).toBe('z')
  expect(r.coins).toBe(15)
  expect(r.phase3).toBe('wait')
  expect(r.round).toBe(2)
  expect(r.zombies).toBe(0)
  expect(r.vignetteGone).toBe(true)
  expect(r.botsGone).toBe(true)
})

test('Party modes: hide and seek, capture the flag, king of the hill, zombie soccer, hot potato, bowling', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    for (const mode of ['hideSeek', 'captureFlag', 'kingHill', 'zombieSoccer', 'hotPotato', 'zombieBowling']) {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      const p = s.party
      out[`${mode}Made`] = !!p && s.cfg.noZombies
      for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
      out[`${mode}Playing`] = p.phase === 'play' && p.bots.size === 5
      const start = [...p.bots.values()].map((b) => [b.x, b.z])
      for (let i = 0; i < 60; i++) p.update(0.05)
      out[`${mode}BotsMove`] = [...p.bots.values()].some((b, i) => Math.hypot(b.x - start[i][0], b.z - start[i][1]) > 0.5) || mode === 'hideSeek'
      out[`${mode}BotsOk`] = [...p.bots.values()].every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))
      out[`${mode}Hud`] = (document.getElementById('build-play-wave-text')?.textContent || '').length > 5
      const snap = JSON.parse(JSON.stringify(p.snapshot()))
      out[`${mode}Snap`] = snap.k === mode && snap.ph === 'play' && !!snap.h
      if (mode === 'hideSeek') {
        p.seekers = new Set([p.myId])
        p.left = 10
        const [b] = p.bots.values()
        const me = s.bodyPos()
        b.x = me.x
        b.z = me.z
        b.y = me.y
        p._run(0.01)
        out.found = p.seekers.has(b.id)
        for (const o of p.bots.values()) p.seekers.add(o.id)
        p._run(0.01)
        out.seekersWin = p.phase === 'end' && p.winner === 's'
      }
      if (mode === 'captureFlag') {
        const mine = p.myTeam
        const enemy = mine === 'r' ? 'b' : 'r'
        for (const b of p.bots.values()) b.x += 500
        const ef = p.flags[enemy]
        s.bm.tryMode.pos.set(ef.x, ef.y, ef.z)
        p._run(0.01)
        out.carrying = ef.at === 'carried' && ef.by === p.myId
        const home = p.spot(mine)
        s.bm.tryMode.pos.set(home.x, home.y, home.z)
        p._run(0.01)
        out.captured = p.score[mine] === 1 && ef.at === 'base'
      }
      if (mode === 'kingHill') {
        for (const b of p.bots.values()) b.x += 500
        const hill = p.spot('hill')
        s.bm.tryMode.pos.set(hill.x, hill.y, hill.z)
        // A bot may have just stunned me (stunned players don't score).
        p.stunned.clear()
        for (let i = 0; i < 5; i++) p._run(0.5)
        out.kingPoints = (p.score[p.myId] || 0) >= 2
      }
      if (mode === 'zombieSoccer') {
        for (const b of p.bots.values()) b.x += 500
        const ball = p.ball
        const x0 = ball.x
        s.bm.tryMode.pos.set(ball.x - 0.5, ball.y, ball.z)
        p._run(0.05)
        for (let i = 0; i < 5; i++) p._run(0.05)
        out.kicked = ball.x - x0 > 0.3
        ball.x = p.home.x + 40
        ball.z = p.home.z
        p._run(0.01)
        out.goal = p.score.r === 1
      }
      if (mode === 'hotPotato') {
        out.potatoHolder = !!p.holder && p.fuse > 0
        for (const b of p.bots.values()) b.x += 500
        p.holder = p.myId
        p._passCd = 0
        // (No pass-back rule in the way: whoever had it before doesn't matter here.)
        p._from = ''
        const [b] = p.bots.values()
        const me = s.bodyPos()
        Object.assign(b, { x: me.x + 0.3, y: me.y, z: me.z })
        p._run(0.01)
        out.potatoPassed = p.holder === b.id
        p.fuse = 0.001
        p._run(0.01)
        out.potatoBoom = p.out.has(b.id) && !!p.holder && p.holder !== b.id
        out.potatoSnap = JSON.parse(JSON.stringify(p.snapshot())).ou.includes(b.id)
      }
      if (mode === 'zombieBowling') {
        out.bowlTurn = !!p.turn && p.order.length === 6
        for (const b of p.bots.values()) b.x += 500
        p._startTurn(p.myId)
        const ball = p.ball
        s.bm.tryMode.pos.set(ball.x - 0.5, ball.y, ball.z)
        p._run(0.05)
        out.bowlRolled = p.rolled && ball.vx > 1
        s.bm.tryMode.pos.set(ball.x - 50, ball.y, ball.z)
        // A pin in the ball's way falls.
        const pin = p.pinSpot(0)
        Object.assign(ball, { x: pin.x, y: pin.y, z: pin.z, vx: 6, vz: 0 })
        p._run(0.01)
        out.bowlPinDown = p.pinsDown[0]
        for (let i = 0; i < 400 && p.turn === p.myId; i++) p._run(0.05)
        out.bowlScored = p.rolls[p.myId] === 1 && p.score[p.myId] >= 1
      }
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Mode voting (PartyVote.js): the end screen shows 3 modes, my vote and
// the bots' are counted, and the winner becomes the next round's mode -
// out of a sky arena back onto the ground.
test('Party modes: vote for the next mode', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'floorLava'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const p = s.party
    for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
    out.skyY = s.bodyPos().y > 200
    p.phase = 'end'
    p.winner = 'tie'
    p.left = 3
    p.update(0.05)
    const v = p.nextVote
    out.opts = v.opts.length === 3 && v.opts[0] === 'floorLava' && new Set(v.opts).size === 3
    out.longer = p.left > 10
    const el = document.getElementById('party-vote')
    out.buttons = !!el && el.querySelectorAll('button').length === 3 && /again/i.test(el.textContent)
    // Everyone (bots too) votes for option 2; the next round is that mode.
    const want = v.opts[1]
    v._botAt.clear()
    for (const id of p.bots.keys()) v.picks.set(id, 1)
    el.querySelectorAll('button')[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    out.mine = v.mine === 1 && v.counts[1] === p.bots.size + 1
    out.snap = JSON.stringify(p.snapshot().nv.slice(3)) === JSON.stringify(v.counts)
    p.left = 0.01
    for (let i = 0; i < 5 && s.party === p; i++) {
      p.update(0.05)
      if (p.switchTo) s.switchPartyMode(p.switchTo)
    }
    out.switched = s.party !== p && s.party.kind === want && s.cfg.mode === want && s.party.phase === 'wait'
    out.voteGone = !document.getElementById('party-vote')
    out.grounded = s.party.sky || s.bodyPos().y < 200
    // A tie: one of the tied modes.
    const q = s.party
    q.phase = 'end'
    q.update(0.05)
    q.nextVote._botAt.clear()
    q.nextVote.picks.clear()
    q.nextVote.picks.set('x1', 0)
    q.nextVote.picks.set('x2', 2)
    q.nextVote._count()
    out.tie = [q.nextVote.opts[0], q.nextVote.opts[2]].includes(q.nextVote.winner())
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Tower Defense: its own map, zombies walk the path, towers, lives and the win', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => { const g = window.__game; g.settings.guestMode = false; g.settings.selectedGameMode = 'towerDefense'; g.playBtn.click() })
  await page.waitForFunction(() => window.__game.buildMode?.survival?.active, null, { timeout: 60000 })
  await page.evaluate(() => window.__game.buildMode.survival._pickWeapon('rifle'))
  const r = await page.evaluate(async () => {
    const s = window.__game.buildMode.survival
    const bm = s.bm
    const td = s.td
    const out = { mode: s.cfg.mode, coins: s.coins, tab: s.shop.tab }
    out.map = bm.getBlockAt(0, 200, 3) === 'grass' && bm.getBlockAt(0, 200, 0) === 'dirtpath'
    out.noBuildPath = td.protects(0, 201, 0) && !td.protects(0, 201, 3)
    // Saving mid-game never keeps the map.
    bm.save()
    const edits = JSON.parse(localStorage.getItem('buildmode-map3-v8-edits') || '{"placed":[]}').placed
    out.notSaved = !edits.some((b) => b.y === 200 && b.x === 0 && b.z === 3)
    // A tower from the shop.
    s.shop._act('trap', 'autoturret')
    out.bought = s.coins === out.coins - 60
    // A zombie at the base costs a life and counts toward the wave.
    s._startWave(1)
    s._spawnZombie()
    const zb = s.zombies[0]
    out.atPortal = Math.abs(zb.x - (td.ox - 16 + 0.5)) < 0.01
    zb.tdAt = 9
    zb.x = td.ox + 16.5
    zb.z = td.oz + 14.5
    const left = s._toSpawn
    s._updateWorld(0.01)
    out.lives = td.lives
    out.counted = s._toSpawn === left - 1
    out.hud = /Lives: 19\/20/.test(document.getElementById('build-play-wave-text').textContent)
    // The last wave held wins.
    for (const z of [...s.zombies]) { z.lost = true; z.health = 0 }
    s._updateWorld(0.01)
    s.wave = 15
    s._toSpawn = 0
    s._breakTimer = 0
    s._updateWorld(0.01)
    out.won = !!s._won
    out.title = document.getElementById('build-play-over-title').textContent
    s.stop()
    out.gone = bm.getBlockAt(0, 200, 3) === null
    return out
  })
  expect(r).toEqual({ mode: 'towerDefense', coins: 200, tab: 'towers', map: true, noBuildPath: true, notSaved: true, bought: true, atPortal: true, lives: 19, counted: true, hud: true, won: true, title: 'Base Defended!', gone: true })
})

test('Tornado, skateboards, frozen lakes and the Dance-Off', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const tm = s.bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Skateboard: crafted, on, faster and slipperier, a ramp launches, a trick pays.
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 3 })
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 2 })
    out.boardCrafted = s.inv.crafting.craft('skateboard') && s.inv.has('skateboard')
    out.boardPicked = pick('skateboard')
    s.inv.useHeld()
    out.boardOn = s.skate.on && !!s.skate.mesh?.parent
    const m = s.skate.mods(true, tm.pos)
    out.boardFast = !!m && m.speed > 1.5 && m.grip < 1
    tm.vel.set(9, 0, 0)
    s.skate.ramp(tm)
    out.ramp = tm.vel.y > 8
    const coins = s.coins
    tm.onGround = false
    tm._spaceWasDown = false
    s.skate.update(0.05)
    tm._spaceWasDown = true
    s.skate.update(0.05)
    out.trickStarted = !!s.skate.trick
    for (let i = 0; i < 12; i++) s.skate.update(0.05)
    tm.onGround = true
    s.skate.update(0.05)
    out.trickPaid = s.coins > coins
    s.inv.useHeld()
    out.boardOff = !s.skate.on && !s.skate.mesh
    // Ice is slippery even on foot.
    const p = tm.pos
    const fx = Math.floor(p.x)
    const fy = Math.floor(p.y - 0.05)
    const fz = Math.floor(p.z)
    const was = s.bm.getBlockAt(fx, fy, fz)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'ice')
    const ice = s.skate.mods(true, p)
    out.iceSlippery = !!ice && ice.grip < 0.5 && ice.speed > 1
    s.bm.removeBlock(fx, fy, fz)
    if (was) s.bm.placeBlock(fx, fy, fz, was)
    // Winter freezes still water near you, and it thaws back at the end.
    g.settings.snowballsAllYear = true
    const wx = fx + 3
    const wy = Math.floor(p.y)
    s.bm.removeBlock(wx, wy, fz)
    s.bm.removeBlock(wx, wy + 1, fz)
    s.bm.placeBlock(wx, wy, fz, 'water')
    s.skate._freezeIn = 0
    s.skate._freeze(0.1)
    out.frozen = s.bm.getBlockAt(wx, wy, fz) === 'ice'
    s.skate._thaw()
    out.thawed = s.bm.getBlockAt(wx, wy, fz) === 'water'
    s.bm.removeBlock(wx, wy, fz)
    g.settings.snowballsAllYear = false
    // Dance-Off: the boombox starts it, zombies stop and copy, hits fill the groove.
    s.inv.add({ kind: 'item', id: 'boombox', n: 1 })
    out.boxPicked = pick('boombox')
    const me = s.bodyPos()
    const zb = s._makeZombie(++s._zid, me.x + 3, me.y, me.z, 100, false)
    s.inv.useHeld()
    out.danceOn = s.dance.on && !!document.getElementById('dance-off')
    s.dance.update(0.05)
    out.zombieFrozen = zb.frozen > 0 && zb.dancing
    const n = s.dance.notes[0]
    s.dance.time = n.at
    const groove = s.dance.groove
    s.dance.press(n.lane)
    out.hit = n.done && s.dance.groove > groove && s.dance.hits === 1
    out.danceKeysBlocked = tm.speedMult === 0
    // Missing everything ends it.
    for (let i = 0; i < 10 && s.dance.on; i++) s.dance._miss(0)
    out.danceLost = !s.dance.on && !document.getElementById('dance-off') && tm.speedMult > 0
    s.dance.start()
    s.dance.time = 29.99
    for (const note of s.dance.notes) note.done = true
    const c2 = s.coins
    s.dance.update(0.05)
    out.danceWon = !s.dance.on && s.coins > c2 && zb.frozen >= 4
    // The disco ball event.
    out.disco = s.events.start('disco') && !!s.dance._disco
    s.events._endRun()
    out.discoGone = !s.dance._disco
    // Tornado: in the list, pulls, throws zombies up the funnel.
    const sky = s.bm.sky
    out.tornadoListed = sky.disasters.kinds.includes('tornado')
    sky.disasters.start('tornado', { x: me.x, z: me.z, quiet: true })
    const run = sky.disasters.active
    run.cx = me.x + 1
    run.cz = me.z
    run.t = 10
    zb.x = run.cx
    zb.z = run.cz + 0.5
    zb.y = me.y
    zb.frozen = 0
    for (let i = 0; i < 10; i++) sky.disasters.update(0.05, s.bm.camera)
    out.tornadoPulls = sky.disasters.push.length() > 0.5
    out.zombieLifted = zb.y > me.y + 1
    sky.disasters.end()
    out.tornadoEnded = !sky.disasters.active
    g.buildMode.survival.stop?.()
    g._exitBuildMode?.()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Paint Wars, Build Battle and Escape Rooms', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    // Paint Wars: teams, bots paint, a shot paints, the sync carries it.
    let s = await start('paintWars')
    let p = s.party
    out.paintMade = !!p && s.cfg.noZombies
    for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
    out.paintTeams = p.phase === 'play' && p.teams.size === 6
    for (let i = 0; i < 60; i++) p.update(0.05)
    out.botsPaint = p.paint.size > 5
    p.paint.clear()
    const h = p.home
    p.splat(h.x, h.z, p.myTeam)
    out.splat = p.paintCounts()[p.myTeam === 'r' ? 0 : 1] >= 5
    const snap = JSON.parse(JSON.stringify(p.snapshot()))
    out.paintSnap = snap.pa.length > 0 && /^[0rb]+$/.test(snap.pa)
    const n = p.paint.size
    p.paint.clear()
    p._paintFrom(snap.pa)
    out.paintBack = p.paint.size === n
    p._drawArena()
    out.paintDrawn = p._paintMesh?.count === n
    p.left = 0.01
    p._run(0.05)
    out.paintWinner = p.phase === 'end' && ['r', 'b', 'tie'].includes(p.winner)
    await stop()
    // Build Battle: a platform, a plot each, bot builds, my blocks only on my plot, voting.
    s = await start('buildBattle')
    p = s.party
    for (let i = 0; i < 200 && p.phase === 'wait'; i++) p.update(0.05)
    p.update(0.05)
    out.bbPlaying = p.phase === 'play' && p.sub === 'build' && p.plots.size === 6
    const mine = p.plotAt(p.plots.get(p.myId))
    out.platform = s.bm.getBlockAt(mine.x, 220, mine.z) === 'smoothquartz'
    out.onMyPlot = Math.abs(s.bm.tryMode.pos.y - 221) < 0.5
    out.palette = s.inv.hotbar.some((it) => it?.kind === 'block' && it.id === 'oak')
    out.canBuildMine = !s._protects(mine.x + 2, 221, mine.z + 2)
    const other = p.plotAt((p.plots.get(p.myId) + 1) % 8)
    out.cantBuildOthers = s._protects(other.x + 2, 221, other.z + 2) && s._protects(mine.x, 220, mine.z)
    p.left = 60
    p._run(0.05)
    const bot = [...p.bots.values()][0]
    out.botBuilt = p._plotBlocks(p.plots.get(bot.id)) > 10
    p.left = 0.001
    p._run(0.05)
    p.update(0.05)
    out.voting = p.sub === 'vote' && !!document.getElementById('bb-vote') && s.bm.tryMode.speedMult === 0
    out.bagBack = !s.inv.hotbar.some((it) => it?.kind === 'block' && it.id === 'sealantern')
    for (let i = 0; i < 400 && p.phase === 'play'; i++) {
      if (p._voteOwner() !== p.myId) p.vote(4)
      p._run(0.25)
      p.update(0.01)
    }
    out.bbEnded = p.phase === 'end' && !!p.winner && Object.values(p.score).some((v) => v > 0)
    out.voteGone = !document.getElementById('bb-vote')
    await stop()
    // Escape Rooms: rooms in the sky, levers, the code, the buttons, out.
    s = await start('escapeRoom')
    const e = s.escape
    out.escMade = !!e && s.cfg.noZombies && !s.party
    out.inRoom1 = Math.abs(s.bm.tryMode.pos.y - 241) < 0.5 && !!document.getElementById('escape-bar')
    out.mapSafe = s._protects(e._roomX(0), 241, e.oz)
    // A floor to stand on and a boarded door (2026-11-09: both used block
    // names that don't exist, so neither was there).
    out.floorAndDoor = s.bm.getBlockAt(e._roomX(0) + 3, 240, e.oz) === 'oakplanks' && s.bm.getBlockAt(e._roomX(0) + 4, 241, e.oz - 5) === 'darkoakplanks'
    e.update(0.1)
    e.pattern.forEach((on, i) => { if (on) s.bm.gadgets.setLever(...e._levers[i], true) })
    e.update(0.1)
    out.leversOpen = e.solved[0] && !s.bm.getBlockAt(...e._exits[0][0])
    s.bm.tryMode.pos.set(e._roomX(1) + 5, 241, e.oz)
    e.update(0.1)
    out.room2 = e.room === 1
    e.useBlock(...e._keypad)
    out.keypad = !!document.getElementById('escape-keypad')
    for (const d of e.code) [...document.querySelectorAll('#escape-keypad .escape-pad-keys button')].find((b) => b.textContent === String(d)).click()
    out.codeOpen = e.solved[1] && !document.getElementById('escape-keypad')
    s.bm.tryMode.pos.set(e._roomX(2) + 5, 241, e.oz)
    e.update(0.1)
    e._showing = null
    const doorWas = e.doorLeft[2]
    e._pressSimon((e.simon[0] + 1) % 4)
    out.simonWrong = e.doorLeft[2] < doorWas - 5
    e._showing = null
    for (const k of e.simon) e._pressSimon(k)
    out.simonOpen = e.solved[2]
    // The door bursts when its time runs out.
    e.doorLeft[2] = 0.01
    e.solved[2] = false
    e.update(0.1)
    out.brokeIn = e.broke[2] && s.zombies.length >= 3
    e.solved[2] = true
    s.bm.tryMode.pos.set(e._roomX(3) + 2, 241, e.oz)
    e.update(0.1)
    out.escaped = e.done && s.dead && (document.getElementById('build-play-over-title')?.textContent || '').length > 3
    await stop()
    out.mapGone = !g.buildMode.getBlockAt(0, 240, 0)
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Submarine, sunken ruins, the ghost pirate ship, the Zombie Train and the Moon', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const bm = s.bm
    const tm = bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // A pool of water far off in the sky to dive in: 9 x 9, 6 deep.
    const P = { x: 4000, y: 150, z: 4000 }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      bm.placeBlock(P.x + x, P.y - 7, P.z + z, 'stone')
      for (let y = P.y - 6; y < P.y; y++) bm.placeBlock(P.x + x, y, P.z + z, 'water')
    }
    bm.placeBlock(P.x - 6, P.y - 1, P.z, 'stone')
    tm.pos.set(P.x - 5.5, P.y, P.z + 0.5)
    tm.vel.set(0, 0, 0)
    bm._yaw = -Math.PI / 2
    // Submarine: crafted, in the water, in, dives, out.
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 14 })
    s.inv.add({ kind: 'block', id: 'glass', n: 3 })
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 4 })
    s.inv.add({ kind: 'item', id: 'zombieGoo', n: 3 })
    out.subCrafted = s.inv.crafting.craft('submarine') && s.inv.has('submarine')
    out.subPicked = pick('submarine')
    s.inv.useHeld()
    const sub = s.vehicles.list.find((v) => v.kind === 'sub')
    out.subPlaced = !!sub
    tm.pos.set(sub.x - 1, sub.y, sub.z)
    out.subIn = s.vehicles.use() && s.vehicles.riding === sub
    const y0 = sub.y
    for (let i = 0; i < 40; i++) s.vehicles.drive(0.05, { down: true })
    out.subDives = sub.y < y0 - 1.5
    for (let i = 0; i < 20; i++) s.vehicles.drive(0.05, { fwd: true })
    out.subMoves = Math.hypot(sub.x - P.x, sub.z - P.z) < 6
    out.subSnap = s.vehicles.snapshot().some((d) => d.k === 's')
    s.vehicles.use()
    out.subOut = !s.vehicles.riding
    // A sunken ruin on the pool's floor: prismarine, a chest, sea zombies.
    const zBefore = s.zombies.length
    const ruin = s.reefs.build(P.x, P.y - 7, P.z)
    out.ruin = !!ruin && bm.getBlockAt(P.x + 1, P.y - 6, P.z + 1) === 'lootchest' && /prismarine/.test(bm.getBlockAt(P.x + 3, P.y - 7, P.z) || '')
    out.seaZombies = s.zombies.length - zBefore === 3
    out.ruinNotSaved = s._placed.has(bm._key(P.x + 1, P.y - 6, P.z + 1))
    s.reefs.clear()
    out.ruinGone = bm.getBlockAt(P.x + 1, P.y - 6, P.z + 1) === 'water' && bm.getBlockAt(P.x + 3, P.y - 7, P.z) === 'stone'
    // The ghost pirate ship: blocks on the water, pirates, the captain's chest.
    const Q = { x: 4100, y: 150, z: 4100 }
    for (let x = -1; x <= 16; x++) for (let z = -5; z <= 5; z++) for (let y = Q.y - 4; y <= Q.y; y++) bm.placeBlock(Q.x + x, y, Q.z + z, 'water')
    const zb2 = s.zombies.length
    s.pirate._build(Q.x, Q.y, Q.z)
    out.ship = bm.getBlockAt(Q.x + 7, Q.y + 1, Q.z) === 'darkoakplanks' && bm.getBlockAt(Q.x + 6, Q.y + 8, Q.z) === 'darkoaklog'
    out.pirates = s.zombies.length - zb2 === 4 && s.zombies.slice(-4).every((z) => z.pirate)
    const coins = s.coins
    out.chestOpened = s.useChest(Q.x + 2, Q.y + 2, Q.z)
    out.captainsLoot = s.coins >= coins + 80 && s.inv.has('treasureMap')
    out.shipFades = s.pirate._update(1) === true && (s.pirate.ship.left = 0.01, s.pirate._update(0.05) === false)
    s.pirate.clear()
    out.shipGone = bm.getBlockAt(Q.x + 7, Q.y, Q.z) === 'water' && !bm.getBlockAt(Q.x + 6, Q.y + 8, Q.z)
    // The pirate event only when the sea is near.
    out.pirateEventKind = typeof s.pirate.possible() === 'boolean'
    // The Zombie Train: a loop, stations, riding, zombies in the wagons.
    const tr = s.train
    let laid = tr.on
    for (let i = 0; i < 8 && !laid; i++) laid = tr.setup({ x: 300 * Math.cos(i), y: 70, z: 300 * Math.sin(i) })
    out.trainLaid = laid && tr.stations.length === 3 && tr._cars.length === 4
    // It never runs through a building the game made: none of the places
    // round it has a block column on (or right beside) the rail.
    const near = bm.world._plansOver(tr.cx - 90, tr.cz - 90, tr.cx + 90, tr.cz + 90)
    let hits = 0
    for (let d = 0; d < tr.perim; d += 0.5) {
      const p = tr.at(d)
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${Math.floor(p.x + p.nx * dx * 1.5)},${Math.floor(p.z + p.nz * dz * 1.5)}`
        if (near.some((pl) => pl.top?.has(k))) hits++
      }
    }
    out.trainMissesPlaces = hits === 0
    // A building put right where the plain circle runs: the loop goes round it.
    const bx = Math.round(tr.cx + 55)
    const bz = Math.round(tr.cz)
    const top = new Map()
    for (let x = bx - 5; x <= bx + 5; x++) for (let z = bz - 6; z <= bz + 6; z++) top.set(`${x},${z}`, { y: 70, type: 'stone' })
    const fake = { kind: 'test', cx: bx, cz: bz, x0: bx - 5, x1: bx + 5, z0: bz - 6, z1: bz + 6, top }
    bm.world._landmarks.push(fake)
    const t0 = performance.now()
    const radii = tr._route(tr.cx, tr.cz)
    const routeMs = performance.now() - t0
    console.log(`train route ${Math.round(routeMs)} ms`)
    out.routeQuick = routeMs < 2000
    bm.world._landmarks.splice(bm.world._landmarks.indexOf(fake), 1)
    const r0 = radii ? radii[0] : 55
    out.trainGoesRound = !!radii && (tr.cx + r0 < bx - 5 - 3 || tr.cx + r0 > bx + 5 + 3)
    // Buildings that pop up later keep off it.
    const p0 = tr.at(tr.perim / 2)
    out.trackSaysTaken = tr.overlaps(p0.x - 2, p0.z - 2, p0.x + 2, p0.z + 2) && !tr.overlaps(tr.cx - 3, tr.cz - 3, tr.cx + 3, tr.cz + 3)
    // Detailed graphics and up: the real-looking track; lower: the plain one.
    const lvlWas = g.settings.graphicsLevel
    g.settings.graphicsLevel = 'ultra'
    tr._lookIn = 0
    tr.update(0.01)
    const realKids = tr._track.children.length
    out.realTrack = tr._trackReal === true && realKids >= 9
    g.settings.graphicsLevel = 'simple'
    tr._lookIn = 0
    tr.update(0.01)
    out.plainTrack = tr._trackReal === false && tr._track.children.length < realKids
    g.settings.graphicsLevel = lvlWas
    const startHead = tr.head
    tr.wait = 0
    for (let i = 0; i < 20; i++) tr.update(0.05)
    out.trainRuns = tr.head > startHead
    const spot = tr._spot(6, 0)
    tm.pos.set(spot.x + 1, spot.y, spot.z)
    out.boarded = tr.use() && !!tr.aboard
    const seat = tr.seat()
    out.seat = Math.hypot(seat.x - spot.x, seat.z - spot.z) < 3
    const z3 = s.zombies.length
    tr.wait = 0.01
    tr.update(0.05)
    out.trainZombies = s.zombies.length > z3 && tr.riders.length > 0
    const rider = tr.riders[0]
    const offWas = rider.trainOff
    tr.update(0.5)
    out.ridersCome = Math.abs(rider.trainOff - tr.aboard.off) < Math.abs(offWas - tr.aboard.off)
    tr.speed = 0
    tr.leave()
    out.jumpedOff = !tr.aboard
    // The Moon: a rocket, the trip, low gravity, space-suit zombies, home.
    s.inv.add({ kind: 'item', id: 'rocket', n: 1 })
    out.rocketPicked = pick('rocket')
    tm.pos.set(P.x - 30.5, P.y + 20, P.z + 0.5)
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) bm.placeBlock(P.x - 30 + x, P.y + 19, P.z + z, 'stone')
    bm._yaw = Math.PI / 2
    s.inv.useHeld()
    out.rocketStands = !!s.moon.rocket && !s.inv.has('rocket')
    const rk = s.moon.rocket
    tm.pos.set(rk.x + 1, rk.y, rk.z)
    out.launch = s.moon.use() && !!s.moon.trip
    for (let i = 0; i < 160 && s.moon.trip; i++) s.moon.update(0.05)
    out.onMoon = s.moon.on && Math.abs(tm.pos.y - 301) < 3 && s.moon.built && !s._ride
    s.moon.update(0.05)
    out.lowGravity = tm.gravityMult === 0.3 && s.moon._sky.visible
    out.moonGround = /tuff|calcite|endstone/.test(bm.getBlockAt(Math.floor(s.moon.cx + 10), 300, Math.floor(s.moon.cz)) || '') || !!s.moon.spawnSpots().length
    out.craterSpawns = s._spawnSpots().every(([, y]) => y > 290)
    const mz = s._makeZombie(++s._zid, tm.pos.x + 2, tm.pos.y, tm.pos.z, 100, false)
    s.moon.update(0.05)
    out.spaceSuit = !!mz.suit
    const home = s.moon.home
    tm.pos.set(home.x + 1, home.y, home.z)
    out.goHome = s.moon.use()
    for (let i = 0; i < 160 && s.moon.trip; i++) s.moon.update(0.05)
    s.moon.update(0.05)
    out.backOnEarth = !s.moon.on && tm.pos.y < 200 && tm.gravityMult === 1
    g.buildMode.survival.stop?.()
    g._exitBuildMode?.()
    out.moonGone = !g.buildMode.getBlockAt(0, 300, 0)
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Sleds, hot springs, the Zombie Zoo and Floor is Lava', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    localStorage.setItem('gayz-creatures', JSON.stringify({ list: [1, 2, 3].map((id) => ({ id, t: 'z', k: 'walker', r: 'common', n: id, at: id })), team: [], nextId: 4 }))
    let s = await start('classic')
    const tm = s.bm.tryMode
    const pick = (id) => {
      s.inv.active = s.inv.hotbar.findIndex((it) => it?.id === id)
      return s.inv.active >= 0
    }
    // Sled: crafted, on, glides on snow, drags off it, a drop speeds it up, a run pays.
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 4 })
    s.inv.add({ kind: 'item', id: 'plantFiber', n: 1 })
    out.sledCrafted = s.inv.crafting.craft('sled') && s.inv.has('sled')
    out.sledPicked = pick('sled')
    s.inv.useHeld()
    out.sledOn = s.sled.on && !!s.sled.mesh?.parent
    const p = tm.pos
    const fx = Math.floor(p.x)
    const fy = Math.floor(p.y - 0.05)
    const fz = Math.floor(p.z)
    const was = s.bm.getBlockAt(fx, fy, fz)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'stone')
    const drag = s.sled.mods(true, p)
    s.bm.removeBlock(fx, fy, fz)
    s.bm.placeBlock(fx, fy, fz, 'snow')
    const glide = s.sled.mods(true, p)
    out.sledSnow = !!glide && !!drag && glide.speed > 1.3 && glide.grip < 0.5 && drag.speed < 1
    tm.onGround = true
    s.sled.update(0.05)
    const y0 = p.y
    p.y -= 2
    s.bm.placeBlock(fx, Math.floor(p.y - 0.05), fz, 'snow')
    s.sled.update(0.05)
    out.sledFaster = s.sled.boost > 0.3
    p.y = y0
    const coins = s.coins
    s.sled.run = 40
    s.sled.top = 9
    s.inv.useHeld()
    out.sledRunPaid = !s.sled.on && !s.sled.mesh && s.coins > coins
    s.bm.removeBlock(fx, fy, fz)
    if (was) s.bm.placeBlock(fx, fy, fz, was)
    // Hot spring: a pool of water, steam, and it heals you in it.
    const gy = s._groundUnder(p.x, p.y + 1, p.z) - 1
    const sp = s.springs.build(fx, gy, fz)
    out.springPool = s.bm.getBlockAt(fx, gy, fz) === 'water' && s.bm.getBlockAt(fx, gy - 1, fz) === 'water' && sp.puffs.length > 0
    tm.pos.set(fx + 0.5, gy, fz + 0.5)
    s.health = 10
    s.springs.update(1)
    out.springHeals = s.health > 10 && s.springs.inSpring(s.bodyPos())
    s.springs.clear()
    out.springGone = s.bm.getBlockAt(fx, gy, fz) !== 'water'
    // Zombie Zoo: the caught zombies walk about in a pen at camp.
    const camp = s.camp
    for (let i = 0; i < 20 && !camp?.zoo; i++) await new Promise((res) => setTimeout(res, 100))
    out.zoo = !!camp?.zoo
    if (camp?.zoo) {
      const Zoo = camp.zoo.constructor
      camp.zoo.dispose()
      camp.zoo = new Zoo(camp)
      camp.zoo.build([camp.trophies?.spot && { ...camp.trophies.spot, wide: 8 }].filter(Boolean))
      out.zooPen = !!camp.zoo.group && camp.zoo.zombies.length === 3
      const x0 = camp.zoo.zombies[0].x
      const z0 = camp.zoo.zombies[0].z
      camp.zoo.zombies[0].wait = 0
      for (let i = 0; i < 10; i++) camp.zoo.update(0.1)
      out.zooWalks = camp.zoo.zombies[0].x !== x0 || camp.zoo.zombies[0].z !== z0
    }
    await stop()
    localStorage.removeItem('gayz-creatures')
    // Floor is Lava: a floor in the sky, tiles glow then melt, falling = out.
    s = await start('floorLava')
    const pm = s.party
    out.lavaMade = !!pm?.ext && s.cfg.noZombies
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const L = pm.ext
    out.lavaFloor = pm.phase === 'play' && s.bm.getBlockAt(Math.floor(L.tileMid(0).x), 230, Math.floor(L.tileMid(0).z)) !== null && s.bm.tryMode.pos.y > 229
    for (let i = 0; i < 80; i++) pm.update(0.05)
    out.lavaGlows = L.tiles.some((st) => st > 0)
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    out.lavaSnap = typeof snap.x?.tl === 'string' && snap.x.tl.length === 81
    const bot = [...pm.bots.values()][0]
    bot.y = 200
    pm._run(0.05)
    out.lavaBotOut = pm.out.has(bot.id) && bot.y > 229
    for (const b of pm.bots.values()) pm.out.add(b.id)
    pm._run(0.05)
    out.lavaWin = pm.phase === 'end' && pm.winner === pm.myId
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('Laser Tag, Kart Racing, the Obstacle Course, minecarts and the haunted house', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const toPlay = (pm) => { for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05) }
    // Laser Tag: teams in a sky arena, a tag scores and knocks out.
    let s = await start('laserTag')
    let pm = s.party
    toPlay(pm)
    out.laserTeams = pm.phase === 'play' && pm.teams.size === 6 && s.bm.tryMode.pos.y > 190
    out.laserArena = s.bm.getBlockAt(Math.floor(pm.home.x), 190, Math.floor(pm.home.z)) !== null
    const enemy = [...pm.bots.values()].find((b) => pm.teams.get(b.id) !== pm.myTeam)
    pm.stun(enemy.id, pm.myId)
    out.laserScore = pm.score[pm.myTeam] === 1 && pm.stunned.get(enemy.id) === 3
    const friend = [...pm.bots.values()].find((b) => pm.teams.get(b.id) !== pm.myTeam)
    pm.stun(pm.myId, friend.id)
    out.laserKo = pm.ext.speed() === 0
    await stop()
    // Kart Racing: in a kart on the grid, bots drive, items, laps.
    s = await start('kartRace')
    pm = s.party
    toPlay(pm)
    const K = pm.ext
    out.kartIn = !!s.kart.driving && s.kart.lockedIn && Math.abs(s.kart.y - 211) < 0.6
    s.kart.leave()
    out.kartLocked = s.kart.driving
    const bot = [...pm.bots.values()][0]
    const ks = bot.ks
    for (let i = 0; i < 20; i++) pm.update(0.05)
    out.kartBotsDrive = bot.ks > ks + 1 && !!bot.kartMesh
    K.item = 'boost'
    out.kartBoost = K.shoot() && s.kart.boostT > 0 && !K.item
    K.item = 'banana'
    K.shoot()
    out.kartBanana = K.bananas.length >= 1
    const L = 4 * 20 + 2 * Math.PI * 13
    K.prog.set(bot.id, { s: L * 0.95, laps: 2, cp: true })
    bot.ks = L * 3 + 1
    pm._run(0.05)
    out.kartWin = pm.phase === 'end' && pm.winner === bot.id
    out.kartSnap = !!JSON.parse(JSON.stringify(pm.snapshot())).x?.pr
    await stop()
    // Obstacle Course: no bots, checkpoints, falling back, the finish and best time.
    localStorage.removeItem('gayz-parkour-best')
    s = await start('obstacleCourse')
    pm = s.party
    toPlay(pm)
    const P = pm.ext
    const tm = s.bm.tryMode
    out.parkourStart = pm.phase === 'play' && pm.bots.size === 0 && Math.abs(tm.pos.y - 261) < 0.5
    const hx = Math.floor(pm.home.x)
    const hz = Math.floor(pm.home.z)
    // No moving blocks: fixed purple stones where the sliding platforms were.
    pm.update(0.05)
    const stone = () => [[57, 5, 0], [60, 6, 1], [63, 6, -1], [86, 8, 1], [86, 9, 4]].every(([x, y, z]) => s.bm.getBlockAt(hx + x, 260 + y, hz + z) === 'purpurblock')
    const stoneBefore = stone()
    for (let i = 0; i < 80; i++) pm.update(0.05)
    out.parkourStill = stoneBefore && stone() && P.moverAt === undefined
    tm.pos.set(hx + 26.5, 264, hz + 0.5)
    pm.update(0.05)
    out.parkourCheckpoint = P.cp === 1
    tm.pos.set(hx + 30, 240, hz)
    pm.update(0.05)
    out.parkourBack = Math.abs(tm.pos.x - (hx + 26.5)) < 0.1 && tm.pos.y > 263
    tm.pos.set(hx + 105.5, 270, hz + 0.5)
    pm.update(0.05)
    out.parkourDone = P.done > 0 && pm.phase === 'end' && Number(localStorage.getItem('gayz-parkour-best')) === P.done
    await stop()
    localStorage.removeItem('gayz-parkour-best')
    // Minecarts: the world's own mine lines (MineTracks.js) get rails and a
    // cart when you come near; a ride to the end pays; nothing is dug.
    s = await start('classic')
    const me = s.bodyPos()
    for (let r = 0; r < 8 && !s.carts.tracks.length; r++) for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (!s.carts.tracks.length) s.carts.sync({ x: me.x + ox * r * 100, z: me.z + oz * r * 100 })
    const tr = s.carts.tracks[0]
    if (tr) {
      const under = s.bm.world.under
      const at = (dy, k = 5) => [Math.floor(tr.x0 + tr.dx * k), tr.y + dy, Math.floor(tr.z0 + tr.dz * k)]
      const solid = (c) => under.implicitSolid(c[0], c[1], c[2], c.join(','))
      // A bed under it, room to stand, deep underground.
      out.cartLaid = tr.len >= 30 && tr.y < -20 && solid(at(-1)) && !solid(at(0)) && !solid(at(2))
      // The same line comes back for the same world.
      const again = s.carts.tracks.map((o) => o.id).join()
      s.carts.clear()
      s.carts.sync({ x: tr.mid.x, z: tr.mid.z })
      out.cartSameAgain = s.carts.tracks.some((o) => o.id === tr.id && o.x0 === tr.x0 && o.len === tr.len) && !!again
      const t2 = s.carts.tracks.find((o) => o.id === tr.id)
      const coins = s.coins
      t2.armed = true
      tm.pos.set(t2.x0, t2.y, t2.z0)
      s.carts.update(0.05)
      out.cartRiding = !!s.carts.riding
      for (let i = 0; i < 200 && s.carts.riding; i++) s.carts.ride(0.05)
      out.cartArrived = !s.carts.riding && t2.at === t2.len && s.coins > coins && !s._ride
      s.carts.clear()
      out.cartCleared = s.carts.tracks.length === 0
    }
    // Heavy guns slow you a bit (PlayWeapons `heavy`); others don't.
    // On a stone block high in the sky (nothing else up there).
    const px = Math.floor(me.x)
    const pz = Math.floor(me.z)
    s.bm.placeBlock(px, 200, pz, 'stone')
    const pad = { x: px + 0.5, y: 201, z: pz + 0.5 }
    const topSpeed = (gun) => {
      s.weaponId = gun
      s.holding = null
      tm.vel.set(0, 0, 0)
      // Back on the pad each step, so it never walks off.
      for (let i = 0; i < 40; i++) tm.pos.set(pad.x, pad.y, pad.z), tm._walk(0.05, new Set(), { fwd: true, back: false, left: false, right: false, stick: null, mx: 0, mz: -1 })
      return Math.hypot(tm.vel.x, tm.vel.z)
    }
    const light = topSpeed('rifle')
    const heavy = topSpeed('minigun')
    out.heavySlower = light > 3.9 && heavy < light * 0.9 && heavy > light * 0.8
    // Only the Minigun and GPMG are heavy (2026-11-16) - the Rocket and
    // Flamethrower go full speed.
    out.onlyTwoHeavy = topSpeed('gpmg') < light * 0.9 && topSpeed('rocket') > light * 0.98 && topSpeed('flamethrower') > light * 0.98
    // Letting go stops you quickly (no sliding on).
    for (let i = 0; i < 4; i++) tm.pos.set(pad.x, pad.y, pad.z), tm._walk(0.05, new Set(), { fwd: false, back: false, left: false, right: false, stick: null, mx: 0, mz: 0 })
    out.quickStop = tm.onGround && Math.hypot(tm.vel.x, tm.vel.z) < 0.05
    s.weaponId = 'rifle'
    // The haunted house: only at night, ghosts, the attic chest pays.
    s.haunted.clear()
    const gy = s._groundUnder(me.x + 25, me.y + 15, me.z)
    s.haunted.build(Math.floor(me.x + 25), gy, Math.floor(me.z))
    const h = s.haunted.house
    out.hauntBuilt = !!h && s.bm.getBlockAt(h.x0 + 4, h.y0 + 10, h.z0 + 4) === 'lootchest' && s.haunted.ghosts.length === 5
    const c0 = s.coins
    s.haunted.onChest(s.haunted.chest)
    out.hauntLoot = s.coins === c0 + 100
    s.haunted._scare()
    out.hauntScare = document.getElementById('haunt-scare')?.classList.contains('on')
    s.haunted.clear()
    out.hauntGone = s.bm.getBlockAt(h.x0 + 4, h.y0 + 10, h.z0 + 4) !== 'lootchest'
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

test('UFO abduction, the dragon boss and the Duel Arena', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const tm = s.bm.tryMode
    // A copy: bodyPos() is your live position.
    const me = { ...s.bodyPos() }
    // UFO: beams a zombie up, then takes you; beat the aliens, the pad takes you home.
    const run = s.ufo.event(me)
    const u = s.ufo.ufo
    out.ufoCame = !!run && !!s.ufo._group
    u.gx = me.x + 40
    u.gz = me.z
    run.update(0.05)
    const zb = s._extraZombie(u.x, s._groundUnder(u.x, me.y + 10, u.z), u.z)
    s.ufo._beamUp()
    for (let i = 0; i < 40; i++) run.update(0.05)
    out.ufoBeamsUp = !!zb && !s.zombies.includes(zb)
    const coins = s.coins
    for (let i = 0; i < 40 && !s.ufo.aboard; i++) {
      tm.pos.set(u.x, s._groundUnder(u.x, me.y + 10, u.z), u.z)
      run.update(0.05)
    }
    const ab = s.ufo.aboard
    out.ufoTaken = !!ab && tm.pos.y > 340 && ab.aliens.length === 4
    for (const a of ab?.aliens || []) a.health = 0
    run.update(0.05)
    out.ufoPad = !!ab?.open
    if (ab) tm.pos.set(ab.cx + 0.5, 341, ab.cz + 0.5)
    const done = run.update(0.05)
    out.ufoHome = done === false && !s.ufo.aboard && tm.pos.y < 300 && s.coins === coins + 90
    s.ufo.clear()
    // Dragon: a lair, fireballs hurt, shots bring it down, the hoard pays.
    s.wave = 3
    tm.pos.set(me.x, me.y, me.z)
    // (Its lair next to you: a test's world is only loaded round the camp.)
    const drun = s.dragon.event(me, { x: Math.floor(me.x) + 20, y: Math.floor(me.y), z: Math.floor(me.z) })
    const d = s.dragon.d
    out.dragonCame = !!drun && !!d && document.getElementById('dragon-bar')?.style.display === 'flex'
    drun.update(0.05)
    s.health = s.maxHealth
    s.dragon._breathe(s.bodyPos())
    out.dragonBreathes = s.dragon.fireballs.length === 1
    // One coming straight at you from close by.
    const ball = s.dragon.fireballs[0]
    const at = s.bodyPos()
    ball.p.set(at.x, at.y + 1, at.z + 3)
    ball.v.set(0, 0, -16)
    for (let i = 0; i < 20 && s.dragon.fireballs.length; i++) s.dragon._fire(0.05)
    out.dragonFire = s.health < s.maxHealth
    const B = s.B
    const ray = s.bm._raycaster.ray.clone()
    ray.origin.set(d.x * B, (d.y + 20) * B, d.z * B)
    ray.direction.set(0, -1, 0)
    out.dragonHit = s.dragon.shoot(ray, 1e9, 100) && d.hp < 1500
    const c1 = s.coins
    const gems = g.gems || 0
    s.dragon.shoot(ray, 1e9, 5000)
    out.dragonSlain = d.dying > 0 && s.coins === c1 + 300 && g.gems === gems + 3
    s.dragon.clear()
    out.dragonGone = !s.dragon.d && document.getElementById('dragon-bar')?.style.display === 'none'
    await stop()
    // Duel Arena: you against a bot, a hit takes duel health, a win moves the rating.
    localStorage.removeItem('gayz-duel')
    s = await start('duelArena')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const D = pm.ext
    out.duelFighters = pm.phase === 'play' && D.fighters.length === 2 && D.fighters.includes(pm.myId) && D.hp.get(pm.myId) === 100 && s.bm.tryMode.pos.y > 170
    const foe = D._other(pm.myId)
    D._hit(foe, 30, pm.myId)
    out.duelHit = D.hp.get(foe) === 70
    const snap = JSON.parse(JSON.stringify(pm.snapshot()))
    out.duelSnap = snap.x?.hp?.[foe] === 70 && snap.x.fi.includes('|')
    D._hit(foe, 100, pm.myId)
    pm.update(0.05)
    const rating = JSON.parse(localStorage.getItem('gayz-duel') || '{}')
    out.duelWon = pm.phase === 'end' && pm.winner === pm.myId && rating.rating === 1020 && rating.wins === 1
    await stop()
    localStorage.removeItem('gayz-duel')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 1 (2026-11-06): Zombie Mini-Golf, Freeze Tag and the
// camp's Daily Lucky Wheel.
test('Zombie Mini-Golf, Freeze Tag and the Lucky Wheel', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const toPlay = (pm) => { for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05) }
    // Mini-Golf: a course in the sky, a ball each, putts count, zombies, holes.
    let s = await start('miniGolf')
    let pm = s.party
    toPlay(pm)
    const G = pm.ext
    const tee = G.tee()
    out.golfCourse = pm.phase === 'play' && s.bm.tryMode.pos.y > 240 && !!s.bm.getBlockAt(Math.floor(tee.x), 240, Math.floor(tee.z)) && G.balls.size === 6
    const ball = G.balls.get(pm.myId)
    s.bm.tryMode.pos.set(ball.x, 241, ball.z - 3)
    out.golfPutt = G.shoot({ direction: { x: 0, y: 0, z: 1 } }) === true && pm.score[pm.myId] === 1 && ball.vz > 0
    out.golfNoDoublePutt = G.shoot({ direction: { x: 0, y: 0, z: 1 } }) === false && pm.score[pm.myId] === 1
    const z0 = ball.z
    // (The course's zombies step aside for this: one wandering across the
    // lane knocked the ball back now and then - checked on its own below.)
    const zombieX = G.zombies.map((zb) => zb.x)
    for (const zb of G.zombies) zb.x = -1e4
    for (let i = 0; i < 40; i++) pm.update(0.05)
    out.golfRolls = ball.z > z0 + 1
    G.zombies.forEach((zb, i) => { zb.x = zombieX[i] })
    for (let i = 0; i < 120; i++) pm.update(0.05)
    out.golfBotsPutt = [...pm.bots.values()].some((b) => (pm.score[b.id] || 0) >= 1)
    // A zombie in the way knocks a ball off.
    const zb = G.zombies[0]
    const other = [...G.balls.values()].find((b) => !b.cup)
    other.x = zb.x + 0.3
    other.z = zb.z
    other.vx = other.vz = 0
    pm._run(0.01)
    out.golfZombieKnock = Math.hypot(other.vx, other.vz) > 3
    out.golfSnap = !!JSON.parse(JSON.stringify(pm.snapshot())).x?.bx
    for (const b of G.balls.values()) b.cup = true
    pm._run(0.05)
    out.golfNextHole = G.hole === 1 && [...G.balls.values()].every((b) => !b.cup)
    G.hole = 2
    for (const b of G.balls.values()) b.cup = true
    for (const id of Object.keys(pm.score)) pm.score[id] = 9
    pm.score[pm.myId] = 3
    pm._run(0.05)
    out.golfFewestWins = pm.phase === 'end' && pm.winner === pm.myId
    await stop()
    // Freeze Tag: a Tagger freezes on touch, a friend thaws, all frozen = Taggers win.
    s = await start('freezeTag')
    pm = s.party
    toPlay(pm)
    const F = pm.ext
    out.freezeTaggers = pm.phase === 'play' && pm.seekers.size === 2
    const tagger = [...pm.seekers][0]
    const runners = pm._people().filter((p) => !pm.seekers.has(p.id) && p.bot)
    const tg = pm.bots.get(tagger) || null
    const victim = runners[0].bot
    if (tg) {
      victim.x = tg.x + 0.5
      victim.z = tg.z
      victim.y = tg.y
    } else {
      const me = s.bodyPos()
      victim.x = me.x + 0.5
      victim.z = me.z
      victim.y = me.y
    }
    F.run(pm._people(), 0.05)
    out.freezeTag = F.frozen.has(victim.id)
    // Move everyone else far away, a friend stands by the frozen one.
    for (const b of pm.bots.values()) if (b !== victim) { b.x += 40; b.z += 40 }
    s.bm.tryMode.pos.x += 60
    const helper = runners[1].bot
    // Nothing else in play: the helper free, every Tagger far off (one
    // left close by froze the helper again now and then).
    F.frozen.delete(helper.id)
    for (const id of pm.seekers) { const b = pm.bots.get(id); if (b) b.x += 200 }
    helper.x = victim.x + 1
    helper.z = victim.z
    helper.y = victim.y
    for (let i = 0; i < 70; i++) F.run(pm._people(), 0.05)
    out.freezeThaw = !F.frozen.has(victim.id)
    for (const p of pm._people()) if (!pm.seekers.has(p.id)) F.frozen.add(p.id)
    F.run(pm._people(), 0.05)
    out.freezeTaggersWin = pm.phase === 'end' && pm.winner === 's'
    out.freezeMeSpeed = typeof F.speed() === 'number'
    await stop()
    // The Lucky Wheel at camp: one spin a day, a prize, Spin Again.
    localStorage.removeItem('gayz-lucky-wheel')
    s = await start('classic')
    const camp = s.camp
    for (let i = 0; i < 30 && !camp?.wheel; i++) await new Promise((res) => setTimeout(res, 100))
    const W = camp?.wheel
    out.wheelBuilt = !!W?.group
    if (W?.group) {
      const m = W._mid()
      s.bm.tryMode.pos.set(m.x, s.bm.tryMode.pos.y, m.z)
      out.wheelNear = W.near()
      const coins = g.coins || 0
      W.use()
      out.wheelSpins = !!W.spin
      W.spin.prize = 6 // 250 coins
      for (let i = 0; i < 50; i++) W.update(0.1)
      out.wheelPrize = !W.spin && (g.coins || 0) === coins + 250
      W.use()
      out.wheelOncePerDay = !W.spin
      localStorage.removeItem('gayz-lucky-wheel')
      W.use()
      W.spin.prize = 7 // Spin Again
      for (let i = 0; i < 50; i++) W.update(0.1)
      W.use()
      out.wheelAgain = !!W.spin
      for (let i = 0; i < 50; i++) W.update(0.1)
    }
    await stop()
    localStorage.removeItem('gayz-lucky-wheel')
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 2 (2026-11-06): the graveyard, the lighthouse, the
// camp treehouse and Bomb Defuse.
test('Graveyard Midnight, the lighthouse, the treehouse and Bomb Defuse', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    // A flat stone floor far off in the sky to build on.
    const P = { x: 4200, y: 150, z: 4200 }
    for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    // Graveyard: fence, graves, the dead rise when you walk in, a coffin.
    const gy = s.graveyard
    gy.build(P.x - 5, P.y, P.z - 5)
    out.graveBuilt = bm.getBlockAt(P.x - 5, P.y, P.z - 5) === 'stonefence' && gy.graves.length === 8 && bm.getBlockAt(P.x - 3, P.y + 1, P.z - 1) === 'chiseledstonebricks'
    const zb0 = s.zombies.length
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    for (let i = 0; i < 100; i++) gy._update(0.1)
    const risen = s.zombies.slice(zb0)
    out.graveRise = risen.length === 8 && gy.yard.risen.length === 8
    out.graveSkeletons = risen.some((z) => z.skel || z.kind) || risen.length === 8
    for (const z of risen) s._removeZombie(z)
    s.zombies = s.zombies.filter((z) => !risen.includes(z))
    gy._update(0.1)
    out.graveCoffin = gy.yard.cleared && bm.getBlockAt(P.x, P.y, P.z) === 'lootchest'
    const coins = s.coins
    s.useChest(P.x, P.y, P.z)
    out.graveLoot = s.coins >= coins + 90
    gy.clear()
    out.graveGone = !bm.getBlockAt(P.x - 5, P.y, P.z - 5) && bm.getBlockAt(P.x, P.y - 1, P.z) === 'stone'
    // Lighthouse: a striped tower with a ladder; the beam marks zombies.
    const L = s.lighthouse
    L.build(P.x, P.y, P.z)
    out.lhTower = bm.getBlockAt(P.x + 1, P.y + 3, P.z) === 'redconcrete' && bm.getBlockAt(P.x, P.y + 5, P.z) === 'ladder' && bm.getBlockAt(P.x, P.y + 16, P.z) === 'sealantern'
    const zb = s._extraZombie(P.x + 10.5, P.y, P.z + 0.5, null)
    L.angle = 0
    out.lhInBeam = L.inBeam(zb.x, zb.z) && !L.inBeam(P.x - 10.5, P.z + 0.5)
    L._sweep()
    out.lhSpotted = zb.spotted > 0
    L._drawMarks()
    out.lhMarker = L._marks.length >= 1 && L._marks[0].visible
    tm.pos.set(P.x + 1.5, P.y + 15, P.z + 0.5)
    zb.spotted = 0
    L._sweep()
    out.lhTopLonger = L.onTop(s.bodyPos()) && zb.spotted > 6
    L.clear()
    out.lhGone = !bm.getBlockAt(P.x + 1, P.y + 3, P.z)
    s._removeZombie(zb)
    s.zombies = s.zombies.filter((z) => z !== zb)
    // Treehouse at camp: a deck up the tree, the ladder pulls up and down.
    const camp = s.camp
    for (let i = 0; i < 30 && !camp?.treehouse; i++) await new Promise((res) => setTimeout(res, 100))
    const T = camp?.treehouse
    out.treeBuilt = !!T?.spot
    if (T?.spot) {
      const h = T.hatch
      out.treeLadder = bm.getBlockAt(h.x, T.y0 + 2, h.z) === 'ladder'
      const deck = T._cell(0, 3)
      tm.pos.set(deck.x + 0.5, T.y0 + 7, deck.z + 0.5)
      out.treeNear = T.near()
      camp.use()
      out.treeUp = T.up && !bm.getBlockAt(h.x, T.y0 + 2, h.z) && bm.getBlockAt(h.x, T.y0 + 6, h.z) === 'oakplanks'
      camp.use()
      out.treeDown = !T.up && bm.getBlockAt(h.x, T.y0 + 2, h.z) === 'ladder'
    }
    await stop()
    // Bomb Defuse: plant on a site, tick, defuse; time out = Blue.
    s = await start('bombDefuse')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const Bx = pm.ext
    out.bombTeams = pm.phase === 'play' && pm.teams.size === 6 && s.bm.tryMode.pos.y > 275
    const red = [...pm.bots.values()].filter((b) => pm.teams.get(b.id) === 'r')
    const blue = [...pm.bots.values()].filter((b) => pm.teams.get(b.id) === 'b')
    // Hold everyone else back at their ends.
    const park = () => {
      for (const b of pm.bots.values()) { b.x = pm.home.x - 18; b.z = pm.home.z; b.y = 276 }
      s.bm.tryMode.pos.set(pm.home.x - 18, 276, pm.home.z + 3)
    }
    park()
    const site = Bx.site(0)
    red[0].x = site.x
    red[0].z = site.z
    for (let i = 0; i < 50; i++) Bx.run(pm._people(), 0.1)
    out.bombPlanted = Bx.planted === 0 && Bx.bombT > 30
    park()
    if (blue.length) {
      blue[0].x = site.x
      blue[0].z = site.z
      for (let i = 0; i < 60 && pm.phase === 'play'; i++) Bx.run(pm._people(), 0.1)
      out.bombDefused = pm.phase === 'end' && pm.winner === 'b'
    }
    out.bombSnap = JSON.parse(JSON.stringify(pm.snapshot())).x?.pl === 0
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Idea list 7, batch 3 (2026-11-06): the Vault Heist, the Theme Park, the
// Time Machine and Werewolf Night.
test('the Vault Heist, the Theme Park, the Time Machine and Werewolf Night', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -18; x <= 18; x++) for (let z = -18; z <= 18; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    const killAll = (list) => {
      for (const z of list) s._removeZombie(z)
      s.zombies = s.zombies.filter((z) => !list.includes(z))
    }
    // Vault Heist: sleeping guards, noise wakes them, the vault's gold.
    const H = s.heist
    H.build(P.x - 6, P.y, P.z - 5)
    out.heistBank = bm.getBlockAt(P.x - 6, P.y + 1, P.z - 5) === 'stonebricks' && bm.getBlockAt(P.x, P.y, P.z + 4) === 'lootchest' && bm.getBlockAt(P.x - 3, P.y, P.z + 1) === 'iron'
    out.heistAsleep = H.bank.guards.length === 4 && H.bank.guards.every((zb) => zb.asleep && zb.frozen > 1000)
    tm.pos.set(P.x + 0.5, P.y, P.z - 3)
    tm._crouch = true
    tm.vel.set(0, 0, 0)
    H._update(0.5)
    out.heistQuiet = H.noiseLevel === 0
    // A perfect heist: open the vault with everyone asleep.
    let coins = s.coins
    s.useChest(P.x, P.y, P.z + 4)
    out.heistSneaky = s.coins >= coins + 240
    H.clear()
    killAll(s.zombies.filter((z) => z.asleep !== undefined))
    H.build(P.x - 6, P.y, P.z - 5)
    tm.pos.set(P.x + 0.5, P.y, P.z - 3)
    for (let i = 0; i < 3; i++) H.noise(40)
    H._update(0.05)
    out.heistAlarm = H.bank.alarm && H.bank.guards.length === 7 && H.bank.guards.every((zb) => !zb.asleep && !(zb.frozen > 0))
    coins = s.coins
    // (A loot chest opens once a wave - this is the same spot as before.)
    s._chestsUsed.clear()
    s.useChest(P.x, P.y, P.z + 4)
    out.heistLoud = s.coins >= coins + 120 && s.coins < coins + 240
    const guards = [...H.bank.guards]
    H.clear()
    killAll(guards)
    tm._crouch = false
    // Theme Park: rides you sit in, Whack-a-Zombie pays coins.
    const K = s.park
    out.parkSpot = K.spot() === null || Number.isFinite(K.spot().x)
    K.build(P.x, P.y, P.z)
    out.parkPlaza = bm.getBlockAt(P.x - 15, P.y, P.z) === 'oakfence' && !!bm.getBlockAt(P.x, P.y - 1, P.z) && !!K._group
    const bottom = K._cabin(0, 0)
    tm.pos.set(K.park.x + bottom.x + 1, P.y, K.park.z + bottom.z)
    out.parkFerris = K.use() && K.ride?.kind === 'ferris'
    for (let i = 0; i < 150; i++) K._rideStep(0.1)
    out.parkFerrisHigh = !!s._ride && s._ride.y > P.y + 10
    for (let i = 0; i < 200 && K.ride; i++) K._rideStep(0.1)
    out.parkFerrisOff = !K.ride && !s._ride
    const st = K.trackPoint(0)
    tm.pos.set(K.park.x + st.x + 1.6, P.y, K.park.z + st.z)
    out.parkCoaster = K.use() && K.ride?.kind === 'coaster'
    let top = 0
    for (let i = 0; i < 600 && K.ride; i++) {
      K._rideStep(0.05)
      if (s._ride) top = Math.max(top, s._ride.y)
    }
    out.parkCoasterHills = top > P.y + 7 && !K.ride
    tm.pos.set(K.park.x + 6, P.y, K.park.z - 7.6)
    out.parkWhack = K.use() && !!K.game
    const head = K._heads[0]
    head.up = 1
    const THREE = { Ray: bm._raycaster.ray.constructor, V: bm.camera.position.constructor }
    const target = new THREE.V((K.park.x + head.x) * s.B, (K.park.y + head.y) * s.B, (K.park.z + head.z) * s.B)
    const from = new THREE.V(target.x, target.y, target.z - 3 * s.B)
    const ray = new THREE.Ray(from, target.clone().sub(from).normalize())
    out.parkWhackHit = s.park.shoot(ray) && K.game.hits === 1
    coins = s.coins
    K.game.left = 0.01
    K._gameStep(0.05)
    out.parkWhackCoins = !K.game && s.coins === coins + 4
    K.clear()
    out.parkGone = !bm.getBlockAt(P.x - 15, P.y, P.z)
    // Time Machine: craft, put down, need a pass, go to the Ice Age, home.
    localStorage.removeItem('gayz-time-eras')
    s.inv.add({ kind: 'block', id: 'cobblestone', n: 16 })
    s.inv.add({ kind: 'block', id: 'glass', n: 4 })
    s.inv.add({ kind: 'item', id: 'heliFuel', n: 2 })
    s.inv.add({ kind: 'item', id: 'zombieGoo', n: 7 })
    s.inv.add({ kind: 'block', id: 'oakplanks', n: 1 })
    out.timeCrafted = s.inv.crafting.craft('timeMachine') && s.inv.has('timeMachine') && s.inv.crafting.craft('timePass') && s.inv.has('timePass')
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    bm._yaw = 0
    const T = s.time
    out.timePlaced = T.place() && !!T.machine
    tm.pos.set(T.machine.x + 1, T.machine.y, T.machine.z)
    out.timePick = T.use() && T.pickOpen && document.querySelectorAll('#time-pick button').length === 6
    s.inv.takeItem('timePass')
    out.timeNeedsPass = T.go('ice') === false && !T.away
    s.inv.add({ kind: 'item', id: 'timePass', n: 1 })
    const zb0 = s.zombies.length
    out.timeGo = T.go('ice') === true && T.away && !T.pickOpen && Math.abs(tm.pos.y - 421) < 1 && !s.inv.has('timePass')
    const trip = T.trips.get('ice')
    const ec = { x: T.cx, z: T.cz }
    out.timeEraWorld = !!bm.getBlockAt(Math.floor(T.cx), 419, Math.floor(T.cz)) && trip?.sky?.visible !== undefined
    out.timeIceZombies = s.zombies.length - zb0 === 5 && trip.zombies.every((zb) => zb.frozen > 0 && zb.era === 'ice')
    out.timeSpawnSpots = s._spawnSpots().every(([, y]) => y === 421)
    const zx = Math.floor(trip.zombies[0].x)
    const zz = Math.floor(trip.zombies[0].z)
    out.timeIceBlock = bm.getBlockAt(zx, 421, zz) === 'ice'
    for (let i = 0; i < 40; i++) T._iceStep(trip, 0.1)
    out.timeIceBreaks = bm.getBlockAt(zx, 421, zz) !== 'ice'
    coins = s.coins
    trip.left = 0.01
    T.update(0.05)
    out.timeHome = !T.away && Math.abs(tm.pos.y - T.machine.y) < 1 && s.coins === coins + 60 && JSON.parse(localStorage.getItem('gayz-time-eras')).includes('ice')
    out.timeEraGone = !bm.getBlockAt(Math.floor(ec.x), 419, Math.floor(ec.z)) && T.trips.size === 0 && trip.zombies.every((zb) => !s.zombies.includes(zb))
    localStorage.removeItem('gayz-time-eras')
    await stop()
    // Werewolf Night: a secret Werewolf, a knock-out at night, the day's vote.
    s = await start('werewolfNight')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const W = pm.ext
    out.wolfOne = pm.phase === 'play' && pm.seekers.size === 1 && W.sub === 'night'
    const wolf = W.wolf
    const people = pm._people()
    const a = people.find((p) => p.id === wolf)
    const victim = people.find((p) => p.id !== wolf && p.bot)
    victim.bot.x = a.x + 1
    victim.bot.z = a.z
    out.wolfClaw = W.claw(wolf, victim.id) && pm.out.has(victim.id)
    out.wolfOncePerNight = !W.claw(wolf, people.find((p) => p.id !== wolf && p.id !== victim.id).id)
    W.subLeft = 0
    W.run(pm._people(), 0.05)
    out.wolfDay = W.sub === 'day'
    for (const p of pm._people()) if (!pm.out.has(p.id) && p.id !== wolf) W.vote(p.id, wolf)
    W.vote(wolf, pm._people().find((p) => p.id !== wolf && !pm.out.has(p.id)).id)
    W.subLeft = 0
    W.run(pm._people(), 0.05)
    out.wolfCaught = pm.phase === 'end' && pm.winner === 'h'
    out.wolfSnap = typeof JSON.parse(JSON.stringify(pm.snapshot())).x?.vs === 'string'
    await stop()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('the camp Plaza (newspaper, lost and found, pinball, chess), the Pet Zombie and the Water Gun', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    localStorage.removeItem('gayz-lost-found')
    localStorage.removeItem('gayz-pet-zombie')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    for (let i = 0; i < 50 && !s._skin; i++) await new Promise((res) => setTimeout(res, 100))
    const bm = s.bm
    const tm = bm.tryMode
    s.camp.update(0.016)
    const plaza = s.camp.plaza
    out.plazaBuilt = !!plaza?.spot && plaza.stations.length === 4
    const at = (id) => {
      const st = plaza.stations.find((x) => x.id === id)
      tm.pos.set(st.x, 0, st.z)
      return plaza.near()?.id === id
    }
    // The newspaper.
    out.newsNear = at('news')
    out.newsOpens = plaza.use() && !!document.querySelector('#camp-screen .news-headline')?.textContent && bm.mouseScreenOpen()
    document.querySelector('#camp-screen .camp-screen-x').click()
    out.newsCloses = !document.getElementById('camp-screen') && !bm.mouseScreenOpen()
    // Lost & Found: a dropped item that's never picked up again.
    s.inv.hotbar[3] = { kind: 'item', id: 'zombieGoo', n: 2 }
    s.inv.active = 3
    s.inv.drop()
    const d = s._drops.list.find((x) => x.type === 'zombieGoo')
    out.lostMarked = !!d?.mine
    d.age = 1000
    s._drops.update(0.016)
    out.lostSaved = JSON.parse(localStorage.getItem('gayz-lost-found') || '[]').some((v) => v[1] === 'zombieGoo')
    out.lostNear = at('lost')
    plaza.use()
    const take = [...document.querySelectorAll('#camp-screen button')].find((b) => b.className === 'camp-screen-btn')
    take.click()
    out.lostBack = s.inv.hotbar[3]?.n === 2 && JSON.parse(localStorage.getItem('gayz-lost-found')).length === 0 && !document.getElementById('camp-screen')
    // Pinball: a bumper scores, a ball drains.
    at('pinball')
    plaza.use()
    const P = plaza.last
    out.pinLaunch = P.launch() && !!P.ball
    P.ball.x = 100
    P.ball.y = 110
    P.ball.vx = 0
    P.ball.vy = 300
    for (let i = 0; i < 20; i++) P.step(0.005)
    out.pinBumper = P.score >= 100
    P.ball.x = 150
    P.ball.y = 470
    P.ball.vx = 0
    P.ball.vy = 400
    for (let i = 0; i < 40; i++) P.step(0.005)
    out.pinDrain = !P.ball && P.balls === 2
    document.querySelector('#camp-screen .camp-screen-x').click()
    // Chess: 20 first moves, Fool's mate, the zombie answers.
    at('chess')
    plaza.use()
    const C = plaza.last
    out.chess20 = C.legal().length === 20
    C.play(53, 45)
    C.play(12, 28)
    C.play(54, 38)
    C.play(3, 39)
    out.chessMate = C.result() === 'mate'
    document.querySelector('#camp-screen .camp-screen-x').click()
    at('chess')
    plaza.use()
    const C2 = plaza.last
    C2.tap(52)
    C2.tap(36)
    await new Promise((res) => setTimeout(res, 600))
    out.chessReply = C2.S.turn === 'w' && C2.S.b[36] === 'P' && C2.legal().length > 0
    document.querySelector('#camp-screen .camp-screen-x').click()
    // Pet Zombie: a Brain Snack on a zombie in front of you.
    const P0 = { x: 4300, y: 150, z: 4300 }
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) bm.placeBlock(P0.x + x, P0.y - 1, P0.z + z, 'stone')
    tm.pos.set(P0.x + 0.5, P0.y, P0.z + 0.5)
    bm._yaw = 0
    bm._pitch = 0
    bm.camera.position.set((P0.x + 0.5) * s.B, (P0.y + 1.62) * s.B, (P0.z + 0.5) * s.B)
    bm.camera.rotation.set(0, 0, 0)
    bm.camera.updateMatrixWorld()
    const z1 = s._makeZombie(++s._zid, P0.x + 0.5, P0.y, P0.z - 2.5, 100, false)
    s.zombies.push(z1)
    s.inv.hotbar[4] = { kind: 'item', id: 'brainSnack', n: 1 }
    s.inv.active = 4
    s.inv.apply?.()
    out.petTamed = s.inv.useHeld() && !!s.pet.pet && !s.zombies.includes(z1) && !!localStorage.getItem('gayz-pet-zombie') && !s.inv.hotbar[4]
    const z2 = s._makeZombie(++s._zid, s.pet.pet.x + 1, P0.y, s.pet.pet.z, 100, false)
    s.zombies.push(z2)
    for (let i = 0; i < 40; i++) s.pet.update(0.05)
    out.petBites = z2.health < 100
    s.pet.release()
    out.petReleased = !s.pet.pet && !localStorage.getItem('gayz-pet-zombie')
    // Water Gun: soaks a zombie, puts out a fire, empties and refills.
    const z3 = s._makeZombie(++s._zid, P0.x + 0.5, P0.y, P0.z - 4, 100, false)
    z3.burn = 3
    s.zombies.push(z3)
    s.inv.hotbar[5] = { kind: 'item', id: 'waterGun', n: 1 }
    s.inv.active = 5
    s.inv.apply?.()
    out.waterSquirt = s.inv.useHeld() && s.water.tank === 24 && !!s.inv.hotbar[5]
    for (let i = 0; i < 30; i++) s.water.update(0.016)
    out.waterSoak = z3.soaked > 0 && !(z3.burn > 0)
    s._groundFires = s._groundFires || []
    s._groundFires.push({ x: P0.x, y: P0.y, z: P0.z - 6, t: 0, life: 20 })
    out.waterDouse = s.water.douse(P0.x + 0.5, P0.y + 0.3, P0.z - 5.5) >= 1 && !s._groundFires.some((f) => f.z === P0.z - 6)
    s.water.tank = 0
    s.water._nextAt = 0
    out.waterEmpty = !s.water.squirt()
    s.stop?.()
    g._exitBuildMode?.()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('the Wingsuit, Dodgeball, Musical Chairs and Simon Says', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const play = (pm) => {
      for (let i = 0; i < 300 && pm.phase === 'wait'; i++) pm.update(0.05)
      return pm.phase === 'play'
    }
    // Wingsuit: opens on a long fall, glides, rings pay.
    let s = await start('classic')
    const bm = s.bm
    const tm = bm.tryMode
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    s.inv.add({ kind: 'item', id: 'wingsuit', n: 1 })
    const W = s.wing
    tm.pos.set(P.x + 0.5, P.y + 40, P.z + 0.5)
    tm.vel.set(0, -15, 0)
    bm._yaw = 0
    bm._pitch = 0
    W.fly(tm.vel, 0.016, false, false)
    out.wingOpens = W.open && W.rings.length === 6
    for (let i = 0; i < 60; i++) W.fly(tm.vel, 0.016, false, false)
    out.wingGlides = tm.vel.z < -12 && Math.abs(tm.vel.x) < 1 && tm.vel.y > -4 && tm.vel.y < -1
    const ring = W.rings[0]
    let coins = s.coins
    tm.pos.set(ring.c.x, ring.c.y - 1, ring.c.z + 0.5)
    W.update(0.016)
    tm.pos.set(ring.c.x, ring.c.y - 1, ring.c.z - 0.5)
    W.update(0.016)
    out.wingRing = ring.got && s.coins === coins + 5
    W.fly(tm.vel, 0.016, false, true)
    out.wingCrouchCloses = !W.open
    W.fly(tm.vel, 0.016, true, false)
    out.wingLands = W.rings.length === 0
    await stop()
    // Dodgeball: teams, a ball hit scores, the middle line holds.
    s = await start('dodgeball')
    let pm = s.party
    out.dodgePlay = play(pm)
    const D = pm.ext
    const mine = pm.myTeam
    const foe = [...pm.bots.values()].find((b) => pm.teams.get(b.id) && pm.teams.get(b.id) !== mine)
    out.dodgeTeams = !!mine && !!foe
    D.balls = []
    D._throw({ x: foe.x - (mine === 'r' ? 1.2 : -1.2), y: foe.y + 1, z: foe.z }, { x: mine === 'r' ? 1 : -1, y: 0, z: 0 }, mine, pm.myId, true)
    D.balls[0].vy = 0
    for (let i = 0; i < 5; i++) D._fly(0.02)
    out.dodgeHit = pm.stunned.has(foe.id) && pm.score[mine] === 1
    const hf = D.half(mine)
    s.bm.tryMode.pos.set(pm.home.x + (mine === 'r' ? 5 : -5), 181, pm.home.z)
    D.events({ phase: 'play', round: pm.round })
    out.dodgeLine = s.bm.tryMode.pos.x >= hf.lo && s.bm.tryMode.pos.x <= hf.hi
    out.dodgeSnap = Array.isArray(JSON.parse(JSON.stringify(pm.snapshot())).x?.db)
    await stop()
    // Musical Chairs: one fewer chair, whoever's left standing is out.
    s = await start('musicalChairs')
    pm = s.party
    out.chairsPlay = play(pm)
    const C = pm.ext
    const n0 = pm._people().length
    out.chairsCount = C.n === n0 - 1 && C.sub === 'music'
    C.subLeft = 0
    C.run(pm._people(), 0.05)
    out.chairsGrab = C.sub === 'grab'
    const bots = [...pm.bots.values()]
    const c0 = C.chair(0)
    s.bm.tryMode.pos.set(c0.x, 221, c0.z)
    bots.forEach((b, i) => {
      const c = i < C.n - 1 ? C.chair(i + 1) : { x: pm.home.x + 9, z: pm.home.z }
      b.x = b.tx = c.x
      b.z = b.tz = c.z
      b.y = b.ty = 221
    })
    C.run(pm._people(), 0.05)
    out.chairsOut = pm.out.size === 1 && pm.out.has(bots[bots.length - 1].id) && C.n === n0 - 2 && C.sub === 'music'
    await stop()
    // Simon Says: do it when Simon says, don't when he doesn't.
    s = await start('simonSays')
    pm = s.party
    out.simonPlay = play(pm)
    const S = pm.ext
    S.subLeft = 0
    S.run(pm._people(), 0.05)
    out.simonOrder = S.sub === 'cmd' && !!S.cmd
    out.simonPads = S.padAt(pm.home.x + 6, pm.home.z + 6) === 'yellow' && S.padAt(pm.home.x, pm.home.z) === ''
    const ids = pm._people().map((p) => p.id)
    S._say()
    S.cmd = 'jump'
    S.simon = true
    for (const id of ids) S.track.set(id, { x: 0, z: 0, y0: -100, moved: 0, rose: id !== ids[1] })
    S.subLeft = -1
    const people = pm._people().map((p) => ({ ...p, y: -1000 }))
    S.run(people, 0)
    out.simonSaysOut = pm.out.size === 1 && pm.out.has(ids[1])
    pm.out.clear()
    S._say()
    S.cmd = 'freeze'
    S.simon = false
    for (const id of ids) S.track.set(id, { x: 0, z: 0, y0: 100, moved: id === ids[2] ? 0 : 10, rose: false })
    S.subLeft = -1
    S.run(pm._people().map((p) => ({ ...p, x: 0, z: 0, y: -1000 })), 0)
    out.simonNotSaysOut = pm.out.size === 1 && pm.out.has(ids[2])
    out.simonSnap = typeof JSON.parse(JSON.stringify(pm.snapshot())).x?.sc === 'string'
    await stop()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Hardcore Survival and cooking, the Zombie Museum and the Story Campaign', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    for (const k of ['gayz-play-saved-run', 'gayz-museum', 'gayz-campaign']) localStorage.removeItem(k)
    g.settings.selectedGameMode = 'classic'
    g.settings.mutators.hardcore = true
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    g.settings.mutators.hardcore = false
    const bm = s.bm
    const tm = bm.tryMode
    const H = s.hunger
    out.hungerCfg = s.cfg.hunger === true
    H.start()
    const bag = [...s.inv.hotbar, ...s.inv.grid]
    out.hungerCampfire = H.on && bag.some((it) => it?.kind === 'block' && it.id === 'campfire')
    H.food = 50
    H.update(60)
    out.hungerDrains = H.food < 50 && H.food > 40
    // Eating at full health while hungry.
    const P = { x: 4300, y: 150, z: 4300 }
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) bm.placeBlock(P.x + x, P.y - 1, P.z + z, 'stone')
    tm.pos.set(P.x + 0.5, P.y, P.z + 0.5)
    s.health = s.maxHealth
    H.food = 50
    s.inv.hotbar[6] = { kind: 'item', id: 'veggies', n: 1 }
    s.inv.active = 6
    out.hungerEats = s.inv.useHeld() && Math.round(H.food) === 75
    // Cooking by a campfire.
    out.hungerNoFire = !H.nearFire()
    bm.placeBlock(P.x + 2, P.y, P.z, 'campfire')
    bm.specials?.rebuild?.()
    out.hungerFire = H.nearFire()
    s.inv.hotbar[6] = { kind: 'item', id: 'meat', n: 1 }
    s.inv.active = 6
    s.inv.useHeld()
    out.hungerCooks = [...s.inv.hotbar, ...s.inv.grid].some((it) => it?.id === 'cookedMeat') && !s.inv.hotbar[6]
    // Starving.
    H.food = 0
    s.health = 50
    H.update(3.2)
    out.hungerStarves = s.health <= 48 && s.health >= 46
    H.food = 100
    // The Museum: a rare find, a boss beaten.
    s.camp.update(0.016)
    const M = s.camp.museum
    out.museumBuilt = !!M?.spot
    s.inv.add({ kind: 'item', id: 'goldenFish', n: 1 })
    out.museumItem = JSON.parse(localStorage.getItem('gayz-museum')).items.includes('goldenFish')
    const boss = s._makeZombie(++s._zid, P.x + 3, P.y, P.z + 3, 10, true)
    s.zombies.push(boss)
    s.damageZombie(boss, 1e6)
    out.museumBoss = JSON.parse(localStorage.getItem('gayz-museum')).bosses.includes('waveBoss')
    M._checkIn = 0
    M.update()
    out.museumCounts = M.counts().items === 1 && M.counts().bosses === 1
    tm.pos.set(M.door.x, 0, M.door.z)
    out.museumOpens = M.use() && document.querySelectorAll('#camp-screen .museum-list div').length > 10
    document.querySelector('#camp-screen .camp-screen-x').click()
    // The Story Campaign.
    const L = s.camp.lab
    out.labBuilt = !!L?.spot
    tm.pos.set(L.door.x, 0, L.door.z)
    out.storyStarts = L.use() && L.story.ch === 0 && L.story.started && !!document.querySelector('#camp-screen .story-line')
    const next = () => [...document.querySelectorAll('#camp-screen button')].find((b) => b.className === 'camp-screen-btn')
    for (let i = 0; i < 6 && document.getElementById('camp-screen'); i++) next().click()
    out.storySceneEnds = !document.getElementById('camp-screen')
    let coins = s.coins
    out.storyMoon = !L.reached(0) && L._finish(0) && L.story.done && s.coins >= coins + 100
    L.use()
    out.storyNextChapter = L.story.ch === 1 && L.story.started && !L.story.done
    document.querySelector('#camp-screen .camp-screen-x').click()
    tm.pos.y = 302
    out.storyHeaven = L.reached(1)
    tm.pos.set(L.door.x, 0, L.door.z)
    L.story = { ch: 4, started: true, done: false }
    coins = s.coins
    s.inv.add({ kind: 'item', id: 'theCure', n: 1 })
    out.storyCure = L.use() && L.story.ch === 5 && s.coins >= coins + 500 && !s.inv.has('theCure') && JSON.parse(localStorage.getItem('gayz-campaign')).ch === 5
    document.querySelector('#camp-screen .camp-screen-x')?.click()
    s.stop?.()
    g._exitBuildMode?.()
    for (const k of ['gayz-museum', 'gayz-campaign']) localStorage.removeItem(k)
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Prop Hunt, bikes and hoverboards, finds and ghost teammates', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    const toPlay = (pm) => { for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05) }
    // --- Prop Hunt ---
    let s = await start('propHunt')
    const pm = s.party
    toPlay(pm)
    const P = pm.ext
    out.propSeekers = pm.phase === 'play' && pm.seekers.size === 2 && P.props.size === 4
    pm.update(0.05)
    out.propDecoys = P.decoys.length === 28
    // Hiders wear a prop (body hidden), seekers blindfolded and still.
    const hiderBot = [...pm.bots.values()].find((b) => P.isHider(b.id))
    out.propWorn = !!hiderBot && !!P._worn.get(hiderBot.id) && hiderBot.body?.visible !== true
    out.propBlindSeeker = !pm.seekers.has(pm.myId) || (P.blind() > 0 && P.speed() === 0)
    // No finds while hiding; after: a seeker touching a hider finds them.
    const seeker = pm._people().find((p) => pm.seekers.has(p.id))
    hiderBot.x = seeker.x + 0.4
    hiderBot.z = seeker.z
    hiderBot.y = seeker.y
    P.run(pm._people(), 0.05)
    out.propSafeWhileHiding = P.isHider(hiderBot.id)
    pm.left = 100
    hiderBot.x = seeker.x + 0.4
    hiderBot.z = seeker.z
    hiderBot.y = seeker.y
    P.run(pm._people(), 0.05)
    out.propFoundByTouch = pm.seekers.has(hiderBot.id) && !P.isHider(hiderBot.id)
    pm.update(0.05)
    out.propUnworn = !P._worn.get(hiderBot.id)
    // A guest's new disguise and find arrive as hits.
    const hider2 = [...pm.bots.values()].find((b) => P.isHider(b.id))
    const before = P.props.get(hider2.id)
    pm.remoteHit({ id: `q${(before + 1) % 8}`, by: hider2.id })
    out.propRemoteDisguise = P.props.get(hider2.id) === (before + 1) % 8
    // Everyone found: the Seekers win; the sync carries props.
    out.propSnap = Object.keys(JSON.parse(JSON.stringify(pm.snapshot())).x.pr).length >= 1
    for (const p of pm._people()) pm.seekers.add(p.id)
    P.run(pm._people(), 0.05)
    out.propSeekersWin = pm.phase === 'end' && pm.winner === 's'
    await stop()
    // --- Bike / hoverboard / finds in a normal game ---
    s = await start('classic')
    const hold = (id) => {
      s.inv.hotbar[1] = { kind: 'item', id, n: 1 }
      s.inv.select(1)
    }
    hold('bike')
    s.inv.useHeld()
    out.bikeOn = s.rides.on === 'bike' && !!s.rides.mesh && s.rides.mods(true).speed > 1.5 && s.rides.quiet
    const fake = { x: s.bodyPos().x, y: s.bodyPos().y, z: s.bodyPos().z, remote: null }
    const far = { x: fake.x + 30, y: fake.y, z: fake.z }
    out.bikeQuiet = !!s.bm.specials.zombieTarget(far, fake)?.idle
    s.inv.useHeld()
    out.bikeOff = s.rides.on === '' && !s.rides.mesh
    hold('hoverboard')
    s.inv.useHeld()
    const tm = s.bm.tryMode
    tm.onGround = false
    tm.vel.y = -20
    s.rides.update(0.05)
    out.hoverFloats = s.rides.on === 'hover' && tm.vel.y >= -3.01
    s.inv.useHeld()
    // Finds: one turns up near you; walking into it picks it up.
    s.finds.next = 0
    s.finds.update(0.05)
    const f = s.finds.find
    out.findPlaced = !!f && ['bike', 'hoverboard', 'bungeeCord'].includes(f.id) && !s.inv.has(f.id) && Math.hypot(f.x - s.bodyPos().x, f.z - s.bodyPos().z) >= 13
    if (f) {
      tm.pos.set(f.x, f.y, f.z)
      s.finds.update(0.05)
      out.findPicked = !s.finds.find && s.inv.has(f.id)
    }
    // --- Ghosts (a stand-in server with one friend alive) ---
    const friendGroup = s.bm.scene.clone(false)
    const friend = { seen: true, dead: false, x: 0, y: 0, z: 0, nick: 'Pal', group: friendGroup }
    const realNet = s.net
    const booed = []
    s.net = { players: new Map([['Pal123', friend]]), isHost: false, closed: false, queueBoo: (id) => booed.push(id) }
    const me = s.bodyPos()
    friend.x = me.x + 40
    friend.y = me.y
    friend.z = me.z
    s.health = 0
    s._die()
    out.ghostStarted = s.dead && s.ghosts.on && document.getElementById('ghost-hud').classList.contains('on') && s._overEl.style.display !== 'flex'
    const snap = s.ghosts.snapshot()
    out.ghostSnap = Array.isArray(snap?.g) && snap.g.length === 3
    // Boo the zombie in front of the camera.
    const cam = s.bm.camera
    const B = s.B
    const o = cam.getWorldPosition(cam.position.clone()).divideScalar(B)
    const d = cam.getWorldDirection(cam.position.clone())
    const zb = { id: 4242, x: o.x + d.x * 6, y: o.y + d.y * 6 - 1, z: o.z + d.z * 6, dead: false }
    s.zombies.push(zb)
    out.ghostBoo = s.ghosts.boo() === true && booed[0] === 'z4242' && s.ghosts.marks.has(4242)
    out.ghostBooCooldown = s.ghosts.boo() === false
    s.ghosts._drawMarks()
    out.ghostMark = s.ghosts._markMeshes.has(4242)
    s.zombies.splice(s.zombies.indexOf(zb), 1)
    // The friend comes to the grave: revived there.
    const gv = s.ghosts.grave
    friend.x = gv.x + 0.5
    friend.z = gv.z
    friend.y = gv.y
    for (let i = 0; i < 100 && s.dead; i++) s.ghosts._ghostly(0.05)
    out.ghostRevived = !s.dead && !s.ghosts.on && Math.hypot(s.bodyPos().x - gv.x, s.bodyPos().z - gv.z) < 0.5 && s.health > 0 && s.health <= s.maxHealth / 2 + 1
    // Alone on a server: no ghost, the card shows.
    friend.dead = true
    s._die()
    out.ghostNeedsFriend = !s.ghosts.on
    s.net = realNet
    s._respawn()
    await stop()
    return out
  })
  for (const [k, v] of Object.entries(r)) expect(v, k).toBe(true)
})

// Names of big real places, pyramids and castles only where real ones are,
// and towns sized to their country (World Map mode).
test('the Zombie Blimp, Zombie Bingo, Pizza Delivery, Tug of War and Quiz Show', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    g.__serversBackendForTests = { create: async () => { throw new Error('offline') }, leave: async () => ({}) }
    const out = {}
    const start = async (mode) => {
      localStorage.removeItem('gayz-play-saved-run')
      g.settings.selectedGameMode = mode
      await g._enterBuildMode({ map: 'map3', play: true })
      const s = g.buildMode.survival
      for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
      s._pickWeapon('rifle')
      return s
    }
    const stop = async () => {
      g.buildMode.survival.stop?.()
      g._exitBuildMode?.()
      await new Promise((res) => setTimeout(res, 200))
    }
    let s = await start('classic')
    const tm = s.bm.tryMode
    const B = s.B
    // --- Zombie Bingo: a card is dealt; a full card pays every line + the big prize ---
    s.update(0.05)
    const bingo = s.bingo
    out.bingoDealt = bingo.card?.length === 25 && bingo.card[12] === null && bingo.card.filter(Boolean).length === 24 && new Set(bingo.card.filter(Boolean).map((x) => x.id)).size === 24
    out.bingoPill = /Bingo/.test(document.getElementById('pill-bingo')?.textContent || '')
    bingo.card = bingo.card.map((x, i) => (i === 12 ? null : { id: 'fish', ev: 'fish', n: 1 }))
    let coins = s.coins
    const gems = g.gems || 0
    s.bingo.note('fish')
    out.bingoFull = bingo.full && bingo.lines.size === 12 && s.coins >= coins + 12 * 100 + 1000 && (g.gems || 0) === gems + 10
    bingo.toggle()
    out.bingoCard = document.querySelectorAll('#camp-screen .bingo-cell').length === 25 && document.querySelectorAll('#camp-screen .bingo-cell.done').length === 25
    bingo.toggle()
    out.bingoCloses = !document.getElementById('camp-screen')
    // --- the Zombie Blimp: drops parachute zombies, shot down it crashes with loot ---
    out.blimpCame = s.events.start('blimp') && !!s.blimp.b && !!s.blimp.group
    const zBefore = s.zombies.length
    for (let i = 0; i < 400 && s.zombies.length === zBefore; i++) s.events.update(0.05)
    out.blimpChutes = s.blimp.b?.drops >= 1 && s.zombies.length > zBefore
    const b = s.blimp.b
    const ray = s.bm._raycaster.ray.clone()
    ray.origin.set(b.x * B, (b.y - 20) * B, b.z * B)
    ray.direction.set(0, 1, 0)
    coins = s.coins
    out.blimpHit = s.blimp.shoot(ray, Infinity, 500) && b.hp === 400 && !b.falling
    s.blimp.shoot(ray, Infinity, 500)
    out.blimpFalls = b.falling === true
    for (let i = 0; i < 400 && s.blimp.b; i++) s.events.update(0.05)
    out.blimpCrashed = !s.blimp.b && !s.blimp.group && s.coins >= coins + 200
    // --- Pizza Delivery: the camp counter, a hot delivery, the smell ---
    for (let i = 0; i < 5; i++) s.update(0.05)
    const P = s.pizza
    out.pizzaCounter = !!P.group && !!P.front
    tm.pos.set(P.front.x, tm.pos.y, P.front.z)
    out.pizzaPrompt = P.near() && P.use() && P.job?.drops.length >= 1
    const d = P.job.drops[0]
    coins = s.coins
    const smellBefore = s.zombies.length
    for (let i = 0; i < 6 && P.job.smelled === 0; i++) {
      P.job.smellIn = 0
      P.update(0.05)
    }
    out.pizzaSmell = P.job.smelled >= 1 && s.zombies.length > smellBefore
    tm.pos.set(d.x, d.y, d.z)
    P.update(0.05)
    out.pizzaDelivered = d.done === true && s.coins >= coins + 40
    await stop()
    // --- Tug of War: teams on the rope, the pull, the pit ---
    s = await start('tugOfWar')
    const pm = s.party
    for (let i = 0; i < 200 && pm.phase === 'wait'; i++) pm.update(0.05)
    const T = pm.ext
    out.tugTeams = pm.phase === 'play' && T.members('r').length === 3 && T.members('b').length === 3
    pm.update(0.05)
    const mine = T.slot(pm.myId)
    out.tugHoldsRope = !!mine && Math.abs(s.bm.tryMode.pos.x - mine.x) < 0.01 && T.speed() === 0
    const h = pm.home
    out.tugPit = !s.bm.getBlockAt(h.x, 205, h.z) && s.bm.getBlockAt(h.x, 200, h.z) === 'smoothstone'
    // A guest's presses arrive as hits.
    const blue = T.members('b')[0]
    T.pull.set(blue, 0)
    pm.remoteHit({ id: 'u3', by: blue })
    out.tugRemote = T.pull.get(blue) === 3
    // Red pulls hard: the rope goes their way and Blue goes in the pit.
    for (let i = 0; i < 600 && pm.phase === 'play'; i++) {
      for (const id of T.members('r')) T._add(id, 1)
      pm.update(0.05)
    }
    out.tugRedWins = pm.phase === 'end' && pm.winner === 'r' && T.rope <= -5
    out.tugSnap = JSON.parse(JSON.stringify(pm.snapshot())).x.ur <= -5
    await stop()
    // --- Quiz Show: pads, a question, points for the right pad, 10 and done ---
    s = await start('quizShow')
    const qm = s.party
    for (let i = 0; i < 200 && qm.phase === 'wait'; i++) qm.update(0.05)
    const Q = qm.ext
    out.quizPlay = qm.phase === 'play' && Q.sub === 'ready' && Q.picks.length === 10
    const qh = qm.home
    out.quizPads = Q.padAt(qh.x - 6, qh.z - 6) === 'red' && Q.padAt(qh.x + 6, qh.z + 6) === 'yellow' && Q.padAt(qh.x, qh.z) === '' && s.bm.getBlockAt(qh.x - 6, 205, qh.z - 6) === 'redwool'
    Q.subLeft = 0
    qm.update(0.05)
    out.quizAsk = Q.sub === 'ask' && Q.n === 1 && Q.answerOn(Q.rightPad) === Q.current.answers[0]
    const card = document.getElementById('quiz-card')
    out.quizCard = !!card && card.style.display !== 'none' && card.querySelectorAll('.quiz-a').length === 4 && card.querySelector('.quiz-q').textContent.length > 3
    // Straight above a camp NPC in the sky arena: no camp prompt, and the
    // use key doesn't open the shop down below.
    const npc = s.camp?.npcs?.[0]
    if (npc) {
      const tmq = s.bm.tryMode
      const keep = tmq.pos.clone()
      tmq.pos.set(npc.x + 1, 206, npc.z)
      s.bm._yaw = Math.PI / 2
      s.camp.update(0.05)
      const pr = document.getElementById('play-npc-prompt')
      out.quizNoCampPrompt = !pr || pr.style.display === 'none'
      out.quizNoCampUse = s.camp.use() === false && !s.shop?.panelOpen
      tmq.pos.copy(keep)
    } else out.quizNoCampPrompt = out.quizNoCampUse = true
    out.quizSigns = Q._signs.length === 4 && Q._signs.every((sp) => sp.visible)
    // Me on the right pad from the start: full points plus the speed bonus.
    const rp = Q.padMiddle(Q.rightPad)
    s.bm.tryMode.pos.set(rp.x, 206, rp.z)
    Q.track.set(qm.myId, { pad: Q.rightPad, at: 14 })
    Q.subLeft = 0.01
    qm.update(0.05)
    out.quizScored = Q.sub === 'reveal' && qm.score[qm.myId] === 150 && Q.gain[qm.myId] === 150
    out.quizResult = card.querySelector('.quiz-result').classList.contains('good') && card.querySelectorAll('.quiz-a.dim').length === 3
    // A guest gets the same question and order from the sync.
    const qsnap = JSON.parse(JSON.stringify(qm.snapshot())).x
    const order0 = Q.order.join('')
    Q.apply({ ...qsnap, qo: '0123' })
    out.quizApplyOrder = Q.order.join('') === '0123'
    Q.apply(qsnap)
    out.quizApply = Q.order.join('') === order0 && Q.n === 1 && Q.sub === 'reveal'
    // Run through the rest: 10 questions, then the round ends.
    for (let i = 0; i < 2000 && qm.phase === 'play'; i++) {
      Q.subLeft = Math.min(Q.subLeft, 0.01)
      qm.update(0.05)
    }
    out.quizDone = qm.phase === 'end' && Q.n === 10
    await stop()
    out.quizCardGone = !document.getElementById('quiz-card')
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

test('Bungee Jump, the Jet Ski, the Zombie Diner and zombies that learn', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.removeItem('gayz-play-saved-run')
    g.settings.selectedGameMode = 'classic'
    await g._enterBuildMode({ map: 'map3', play: true })
    const s = g.buildMode.survival
    for (let i = 0; i < 100 && !s.active; i++) await new Promise((res) => setTimeout(res, 100))
    s._pickWeapon('rifle')
    const bm = s.bm
    const tm = bm.tryMode
    const me = s.bodyPos()
    const X = Math.floor(me.x)
    const Z = Math.floor(me.z)
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
    }
    const hold = (id) => {
      s.inv.hotbar[1] = { kind: 'item', id, n: 1 }
      s.inv.select(1)
    }
    // --- Bungee: a pillar 12 up over a stone pad in the sky ---
    for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) put(X + x, 240, Z + z, 'stone')
    put(X, 252, Z, 'stone')
    tm.pos.set(X + 0.5, 253, Z + 0.5)
    tm.vel.set(0, 0, 0)
    tm.onGround = true
    bm._yaw = -Math.PI / 2
    hold('bungeeCord')
    const zb0 = s.zombies.length
    s.inv.useHeld()
    out.bungeeClipped = s.bungee.state === 'clipped' && !!s.bungee.bag && s.zombies.length >= zb0 + 1
    tm.onGround = false
    let coins = s.coins
    tm.pos.set(X + 2, 250, Z + 0.5)
    s.bungee.update(0.05)
    out.bungeeFalls = s.bungee.state === 'fall'
    tm.pos.set(X + 2, 242, Z + 0.5)
    s.bungee.update(0.05)
    out.bungeeHangs = s.bungee.state === 'hang' && !s.bungee.bag && s.coins >= coins + 60
    for (let i = 0; i < 80 && s.bungee.state; i++) s.bungee.update(0.05)
    out.bungeeBack = s.bungee.state === '' && Math.abs(tm.pos.y - 253) < 0.5 && !s.bungee.cordMesh
    // A too-low spot says to find a high edge.
    tm.pos.set(X + 0.5, 241, Z + 0.5)
    tm.onGround = true
    s.inv.useHeld()
    out.bungeeNeedsEdge = s.bungee.state === ''
    // --- the Jet Ski: a long pool in the sky ---
    for (let x = -2; x <= 60; x++) {
      for (let z = -4; z <= 4; z++) {
        put(X + x, 219, Z + z, 'stone')
        put(X + x, 220, Z + z, 'water')
      }
    }
    tm.pos.set(X + 0.5, 221, Z + 0.5)
    bm._yaw = -Math.PI / 2
    hold('jetSki')
    s.inv.useHeld()
    const v = s.vehicles.list.find((o) => o.kind === 'jetski')
    out.jetPlaced = !!v
    tm.pos.set(v.x, v.y + 0.5, v.z)
    out.jetIn = s.vehicles.use() && s.vehicles.riding === v
    v.heading = Math.PI / 2
    let air = 0
    for (let i = 0; i < 70; i++) {
      s.vehicles.drive(0.05, { fwd: true })
      air = Math.max(air, v.air || 0)
    }
    out.jetFast = v.speed > 12 || air > 0
    out.jetHops = air > 0.2
    v.x = X + 8
    v.z = Z + 0.5
    v.heading = Math.PI / 2
    v.seaIn = 0
    const z0 = s.zombies.length
    s.vehicles.drive(0.05, {})
    out.jetSeaZombie = s.zombies.length === z0 + 1
    const sz = s.zombies[s.zombies.length - 1]
    v.air = 0
    v.airV = 0
    v.grab = 0
    sz.x = v.x
    sz.z = v.z
    sz.y = v.y
    s.vehicles.drive(0.05, { fwd: true })
    out.jetGrabbed = v.grab > 0 && v.speed <= 5
    s.vehicles.leave(true)
    // --- the Zombie Diner on a pad in the sky ---
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) put(X + x, 199, Z + z, 'stone')
    const D = s.diner
    D._build({ x: X, y: 200, z: Z })
    out.dinerBuilt = bm.getBlockAt(X + 3, 200, Z - 3) === 'furnace' && bm.getBlockAt(X - 4, 200, Z) === 'redconcrete'
    tm.pos.set(X + 0.5, 200, Z + 0.5)
    D.nextIn = 0
    D.update(0.05)
    const c = D.customers[0]
    out.dinerCustomer = !!c && D.customers.length === 1
    c.zombie = false
    c.dish = 'soup'
    // At the stove: the menu cooks a dish.
    tm.pos.set(D.stove.x, 200, D.stove.z)
    out.dinerMenu = D.use() && document.querySelectorAll('#camp-screen .diner-dish').length === 4
    document.querySelector('#camp-screen .diner-dish[data-dish="soup"]').click()
    out.dinerCooked = D.holding === 'soup' && !document.getElementById('camp-screen')
    // Serve from behind the counter, facing them.
    tm.pos.set(c.x, 200, c.z - 2)
    bm._yaw = Math.PI
    coins = s.coins
    out.dinerServed = D.use() && c.gone === true && s.coins >= coins + 30 && D.holding === ''
    // A zombie in disguise: thrown out with empty hands.
    D.nextIn = 0
    D.update(0.05)
    const zc = D.customers[0]
    zc.zombie = true
    tm.pos.set(zc.x, 200, zc.z - 2)
    const zbs = s.zombies.length
    coins = s.coins
    out.dinerSpotted = D.use() && zc.gone && s.zombies.length === zbs + 1 && s.coins >= coins + 40
    D.clear()
    out.dinerPutBack = bm.getBlockAt(X + 3, 200, Z - 3) !== 'furnace'
    // --- zombies that learn: guns all the time -> helmets ---
    const L = s.learn
    L.clear()
    for (let i = 0; i < 20; i++) L.onKill()
    out.learnGun = L.level.gun === 1 && /Zombies learned/.test(document.getElementById('pill-learn')?.textContent || '')
    L.level.gun = 3
    let geared = null
    for (let i = 0; i < 40 && !geared; i++) {
      const z = s._extraZombie(me.x + 3, s._groundUnder(me.x + 3, me.y + 10, me.z), me.z)
      if (z?.gear === 'gun') geared = z
    }
    out.learnHelmet = !!geared && geared.group.children.some((o) => o.material?.color?.getHex?.() === 0x5a6b4a)
    geared.health = 1000
    s.damageZombie(geared, 100)
    out.learnHalf = Math.abs(geared.health - 950) < 1
    s._pickWeapon('melee')
    s.damageZombie(geared, 100)
    out.learnSwitch = Math.abs(geared.health - 850) < 1
    L.recent = new Array(20).fill('melee')
    L.forgetIn = 0
    L.update(0.05)
    out.learnForgets = L.level.gun === 2
    // Headshots -> steel visors (headshots on them do half).
    L.clear()
    L.level.melee = 3
    s._hitHead = true
    for (let i = 0; i < 20; i++) L.onKill()
    s._hitHead = false
    out.learnHead = L.level.head === 1 && /Visors 1/.test(document.getElementById('pill-learn')?.textContent || '')
    L.level.melee = 0
    L.level.head = 3
    let visored = null
    for (let i = 0; i < 40 && !visored; i++) {
      const z = s._extraZombie(me.x + 3, s._groundUnder(me.x + 3, me.y + 10, me.z), me.z)
      if (z?.visor) visored = z
    }
    visored.health = 1000
    s._hitHead = true
    s.damageZombie(visored, 100)
    s._hitHead = false
    out.learnVisorHalf = Math.abs(visored.health - 950) < 1
    s.damageZombie(visored, 100)
    out.learnVisorBody = Math.abs(visored.health - 850) < 1
    // Camping in one spot -> ladders that climb walls.
    L.clear()
    for (let i = 0; i < 620 && !L.level.camp; i++) L.update(0.1)
    out.learnCamp = L.level.camp === 1 && /Ladders 1/.test(document.getElementById('pill-learn')?.textContent || '')
    L.level.camp = 3
    let laddered = null
    for (let i = 0; i < 40 && !laddered; i++) {
      const z = s._extraZombie(me.x + 3, s._groundUnder(me.x + 3, me.y + 10, me.z), me.z)
      if (z?.ladder) laddered = z
    }
    out.learnLadder = !!laddered && laddered.climbs === true
    // Moved away: they forget the ladders.
    tm.pos.x += 20
    L.forgetIn = 0
    L.update(0.05)
    out.learnCampForgets = L.level.camp === 2
    L.clear()
    // Hidden pace tuning: easy wave -> a bit tougher, hard wave -> easier.
    const P = s.pace
    P.clear()
    s.health = s.maxHealth
    P.onWaveStart(2)
    const fake = { health: 100, maxHealth: 100 }
    P.apply(fake)
    out.paceUp = Math.abs(P.level - 0.05) < 1e-6 && Math.abs(fake.maxHealth - 105) < 1e-6 && Math.abs(fake.paceMult - 1.025) < 1e-6
    P.onHurt(s.maxHealth * 0.7)
    P.onWaveStart(3)
    out.paceDown = Math.abs(P.level + 0.03) < 1e-6
    for (let i = 0; i < 20; i++) P.onWaveStart(4 + i)
    out.paceCapped = Math.abs(P.level - 0.15) < 1e-6
    P.clear()
    s.stop?.()
    g._exitBuildMode?.()
    return out
  })
  expect(Object.keys(r).filter((k) => r[k] !== true)).toEqual([])
})

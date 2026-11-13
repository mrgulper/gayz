import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'
import { fakeServerDb } from './fakeServerDb.js'
import { publicConfig, adminState, ADMIN_ACTIONS, DROP_KINDS } from '../api/_lib/admin.js'

// 2026-11-13: live tuning (multipliers with a timer) and world drops
// (a world event / disaster every running game starts once).
test('tuning and world drops on the server', async () => {
  const db = fakeServerDb()
  const A = ADMIN_ACTIONS
  const t0 = Date.now()
  expect(DROP_KINDS).toContain('random')
  expect(DROP_KINDS).toContain('ufo')
  expect(DROP_KINDS).toContain('tornado')
  // Out of range / bad timers are refused.
  await expect(A.tuning(db, { values: { zombieSpeed: 3 }, minutes: 60 })).rejects.toThrow()
  await expect(A.tuning(db, { values: { coins: -1 }, minutes: 60 })).rejects.toThrow()
  await expect(A.tuning(db, { values: { coins: 2 }, minutes: 2 })).rejects.toThrow()
  await expect(A.tuning(db, { values: { coins: 2 }, minutes: 999999 })).rejects.toThrow()
  // Nothing set: players get null.
  expect((await publicConfig(db, {})).tuning).toBe(null)
  await A.tuning(db, { values: { zombieSpeed: 1.5, drops: 2, coins: 3, shopPrices: 0.5, homePrices: 2 }, minutes: 90 })
  let cfg = await publicConfig(db, {})
  expect(cfg.tuning).toMatchObject({ zombieSpeed: 1.5, drops: 2, coins: 3, shopPrices: 0.5, homePrices: 2 })
  // Ends by itself after its timer.
  expect((await publicConfig(db, {}, Date.now() + 91 * 60000)).tuning).toBe(null)
  // Until reset (0 minutes), then Reset.
  await A.tuning(db, { values: { coins: 2 }, minutes: 0 })
  cfg = await publicConfig(db, {}, t0 + 400 * 86400000)
  expect(cfg.tuning).toMatchObject({ coins: 2, zombieSpeed: 1, until: 0 })
  await A.tuning(db, { reset: true })
  expect((await publicConfig(db, {})).tuning).toBe(null)
  // World drop.
  await expect(A.worldDrop(db, { kind: 'nope', minutes: 5 })).rejects.toThrow()
  await expect(A.worldDrop(db, { kind: 'ufo', minutes: 0 })).rejects.toThrow()
  await expect(A.worldDrop(db, { kind: 'ufo', minutes: 2000 })).rejects.toThrow()
  await A.worldDrop(db, { kind: 'tornado', who: 'servers', minutes: 15 })
  cfg = await publicConfig(db, {})
  expect(cfg.worldDrop).toMatchObject({ kind: 'tornado', who: 'servers' })
  expect((await publicConfig(db, {}, Date.now() + 16 * 60000)).worldDrop).toBe(null)
  const st = await adminState(db, null)
  expect(st.worldDrop.kind).toBe('tornado')
  expect(st.tuneLimits.zombieSpeed).toEqual([0.5, 2])
  expect(st.dropKinds.events).toContain('blimp')
  await A.worldDrop(db, { cancel: true })
  expect((await publicConfig(db, {})).worldDrop).toBe(null)
  const lines = (await adminState(db, null)).history.map((h) => h.text).join('\n')
  for (const s of ['Tuning saved: Zombie speed 150%, Drops 200%, Coins 300%, In-game shop 50%, Homepage shop 200% for 90 min', 'Tuning saved: Zombie speed 100%, Drops 100%, Coins 200%, In-game shop 100%, Homepage shop 100% until reset', 'Tuning back to normal', 'Dropped tornado into every server (for 15 min)', 'World event drop stopped']) expect(lines).toContain(s)
})

test('tuning changes prices and coins; a world drop starts once in a running game', async ({ page }) => {
  await page.addInitScript(() => {
    window.__liveCfg = { banner: null, events: {}, ends: {}, sale: null, staffMsg: null, gift: null, mapWeek: null, daily: {}, hidden: { maps: [], builds: [] }, ban: null, off: [], maintenance: null, mute: null, warnings: [], tuning: { zombieSpeed: 1.5, drops: 5, coins: 3, shopPrices: 2, homePrices: 0.5, until: 0 }, worldDrop: null }
    window.__liveConfigForTests = async () => window.__liveCfg
  })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    await g.__liveAsk()
    const out = { speed: g.__liveTune('zombieSpeed'), market: g.__liveSalePrice(1000) }
    // An ended timer means normal again.
    window.__liveCfg = { ...window.__liveCfg, tuning: { ...window.__liveCfg.tuning, until: Date.now() - 1 } }
    await g.__liveAsk()
    out.endedSpeed = g.__liveTune('zombieSpeed')
    window.__liveCfg = { ...window.__liveCfg, tuning: { ...window.__liveCfg.tuning, until: 0 } }
    await g.__liveAsk()
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 60, 'zombiespawner')
    for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) if (x || z) bm.placeBlock(x, 0, z, 'grass', true)
    s.start()
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    if (s._picking) s._pickWeapon('rifle')
    for (const z of [...s.zombies]) s._removeZombie(z)
    s.zombies = []
    s._toSpawn = 0
    s._breakTimer = 1e9
    s.health = 1e9
    out.medkit = s.shop._price({ cost: 40 })
    const c0 = s.coins
    s._earn(10)
    out.earned = s.coins - c0
    // Servers-only drop: nothing for a game alone.
    window.__liveCfg = { ...window.__liveCfg, worldDrop: { id: 'd1', kind: 'golden', who: 'servers', until: Date.now() + 600000 } }
    await g.__liveAsk()
    out.soloSkipped = !s.events._run
    // Every game: starts once.
    window.__liveCfg = { ...window.__liveCfg, worldDrop: { id: 'd2', kind: 'golden', who: 'all', until: Date.now() + 600000 } }
    await g.__liveAsk()
    out.started = !!s.events._run
    s.events._endRun()
    await g.__liveAsk()
    window.dispatchEvent(new Event('gayz-live'))
    out.notAgain = !s.events._run
    // A disaster.
    window.__liveCfg = { ...window.__liveCfg, worldDrop: { id: 'd3', kind: 'tornado', who: 'all', until: Date.now() + 600000 } }
    await g.__liveAsk()
    out.disaster = bm.sky.disasters.active?.kind || null
    bm.sky.disasters.end?.()
    s.stop?.()
    return out
  })
  expect(r.speed).toBe(1.5)
  expect(r.market).toBe(500)
  expect(r.endedSpeed).toBe(1)
  expect(r.medkit).toBe(80)
  expect(r.earned).toBe(30)
  expect(r.soloSkipped).toBe(true)
  expect(r.started).toBe(true)
  expect(r.notAgain).toBe(true)
  expect(r.disaster).toBe('tornado')
})

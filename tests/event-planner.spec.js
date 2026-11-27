import { test, expect } from '@playwright/test'
import { fakeServerDb } from './fakeServerDb.js'
import { publicConfig, adminState, onlineClosed, ADMIN_ACTIONS } from '../api/_lib/admin.js'
import { runPlanner } from '../api/_lib/planner.js'

// 2026-11-27: the Console's Event Planner - planned banner, message of the
// day, off-switches, maintenance (worked out on every ask) and giveaways
// (winners picked by the site-check poke, given only on the Console's OK).
test('event planner: planned things switch on and off by themselves', async () => {
  const db = fakeServerDb()
  const A = ADMIN_ACTIONS
  const h = 3600000
  const t0 = Date.now()
  await A.banner(db, { text: 'Own banner' })
  await A.motd(db, { lines: ['Own line'] })
  await A.scheduleAdd(db, { what: 'banner', start: t0 + h, end: t0 + 2 * h, text: 'Planned banner', style: 'celebrate' })
  await A.scheduleAdd(db, { what: 'motd', start: t0 + h, end: t0 + 2 * h, text: 'Planned line' })
  await A.scheduleAdd(db, { what: 'off', start: t0 + h, end: t0 + 2 * h, ids: ['chat', 'nope'] })
  await A.scheduleAdd(db, { what: 'maintenance', start: t0 + 3 * h, end: t0 + 4 * h, text: 'Back soon' })
  await expect(A.scheduleAdd(db, { what: 'banner', start: t0 + h, end: t0 + 2 * h, text: '' })).rejects.toThrow()
  await expect(A.scheduleAdd(db, { what: 'off', start: t0 + h, end: t0 + 2 * h, ids: [] })).rejects.toThrow()
  // Before: the Console's own things.
  let cfg = await publicConfig(db, {}, t0)
  expect(cfg.banner.text).toBe('Own banner')
  expect(cfg.motd).toBe('Own line')
  expect(cfg.off).toEqual([])
  expect(cfg.maintenance).toBe(null)
  // During: the planned ones win; off adds up.
  cfg = await publicConfig(db, {}, t0 + 1.5 * h)
  expect(cfg.banner).toMatchObject({ text: 'Planned banner', style: 'celebrate', until: t0 + 2 * h })
  expect(cfg.motd).toBe('Planned line')
  expect(cfg.off).toEqual(['chat'])
  expect(await onlineClosed(db, t0 + 1.5 * h)).toBe(false)
  // Maintenance closes online servers while it's on.
  cfg = await publicConfig(db, {}, t0 + 3.5 * h)
  expect(cfg.maintenance.text).toBe('Back soon')
  expect(await onlineClosed(db, t0 + 3.5 * h)).toBe(true)
  // After: back to normal.
  cfg = await publicConfig(db, {}, t0 + 5 * h)
  expect(cfg.banner.text).toBe('Own banner')
  expect(cfg.off).toEqual([])
  expect(cfg.maintenance).toBe(null)
  const st = await adminState(db, null)
  expect(st.schedule.map((e) => e.what).sort()).toEqual(['banner', 'maintenance', 'motd', 'off'])
  expect(st.off).toEqual([])
})

test('event planner: giveaway picks winners on the poke, gives only on OK', async () => {
  const db = fakeServerDb()
  const A = ADMIN_ACTIONS
  const t0 = Date.now()
  await db.update({ 'pidIps/AAAA1': { ip1: t0 - 1000 }, 'pidIps/BBBB2': { ip1: t0 - 2000 }, 'pidIps/CCCC3': { ip1: t0 - 20 * 86400000 } })
  await expect(A.planGiveaway(db, { at: t0 + 60000, winners: 2 })).rejects.toThrow()
  const { id } = await A.planGiveaway(db, { at: t0 + 60000, winners: 5, days: 7, coins: 300, text: 'Well done' })
  // Not time yet: nothing picked.
  await runPlanner(db, t0)
  let g = (await adminState(db, null)).plannedGiveaways[0]
  expect(g.state).toBe('planned')
  await expect(A.planGiveawayGive(db, { id })).rejects.toThrow()
  // Time comes: the two recent players win (the old one doesn't), no gift yet.
  await runPlanner(db, t0 + 120000)
  g = (await adminState(db, null)).plannedGiveaways[0]
  expect(g.state).toBe('picked')
  expect(g.picked.map((p) => p.pid).sort()).toEqual(['AAAA1', 'BBBB2'])
  expect(await db.get('playerGifts')).toBe(null)
  // A second poke doesn't pick again.
  await runPlanner(db, t0 + 240000)
  expect((await adminState(db, null)).plannedGiveaways[0].pickedAt).toBe(g.pickedAt)
  // Give: each winner gets one gift; a second Give is refused.
  const r = await A.planGiveawayGive(db, { id })
  expect(r).toMatchObject({ given: 2, of: 2 })
  expect(Object.keys((await db.get('playerGifts')) || {}).sort()).toEqual(['AAAA1', 'BBBB2'])
  await expect(A.planGiveawayGive(db, { id })).rejects.toThrow()
  expect((await adminState(db, null)).plannedGiveaways[0].state).toBe('given')
})

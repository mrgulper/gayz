import { test, expect } from '@playwright/test'
import { fakeServerDb } from './fakeServerDb.js'
import { publicConfig, adminState, playerCard, reportPlayer, ADMIN_ACTIONS, BACKUP_PATHS } from '../api/_lib/admin.js'
import { watchBoards } from '../api/_lib/watchList.js'

// 2026-11-27: the team's watch list - alerts when a flagged Player ID
// comes back online, enters a top 10, or is reported again.
test('watch list: online, report and leaderboard alerts', async () => {
  const db = fakeServerDb()
  const A = ADMIN_ACTIONS
  const h = 3600000
  const t0 = Date.now()
  await expect(A.watch(db, { pid: 'AAAA1', days: 3 })).rejects.toThrow()
  await A.watch(db, { pid: 'AAAA1', name: 'Sneaky', why: 'alt account?', days: 7 })
  expect(BACKUP_PATHS).toContain('watchList')

  // Opening the game right after being flagged: no ping (seen starts now).
  await publicConfig(db, { pid: 'AAAA1' }, t0 + 10 * 60000)
  let st = await adminState(db, null)
  expect(st.watch.list.map((w) => w.pid)).toEqual(['AAAA1'])
  expect(st.watch.alerts).toEqual([])
  // Two hours away, then back: one "online" alert. Asking again soon after: none.
  await publicConfig(db, { pid: 'AAAA1' }, t0 + 3 * h)
  await publicConfig(db, { pid: 'AAAA1' }, t0 + 3 * h + 10 * 60000)
  st = await adminState(db, null)
  expect(st.watch.alerts.map((a) => a.kind)).toEqual(['online'])
  expect(st.watch.alerts[0].text).toContain('Sneaky #AAAA1')
  // Someone not on the list never makes alerts.
  await publicConfig(db, { pid: 'BBBB2' }, t0 + 3 * h)

  // Reported again.
  await reportPlayer(db, { target: 'AAAA1', by: 'CCCC3', byName: 'Reporter', text: 'spamming' })
  await reportPlayer(db, { target: 'BBBB2', by: 'CCCC3', byName: 'Reporter', text: 'hi' })
  st = await adminState(db, null)
  expect(st.watch.alerts.filter((a) => a.kind === 'report').length).toBe(1)

  // Leaderboard: entering a top 10 pings once; staying doesn't; leaving and coming back does.
  const boards = { night: [{ pid: 'ZZZZ9' }, { pid: 'AAAA1' }], kills: [] }
  expect(await watchBoards(db, boards, { night: 'Best night' })).toBe(1)
  expect(await watchBoards(db, boards, { night: 'Best night' })).toBe(0)
  expect(await watchBoards(db, { night: [], kills: [] })).toBe(0)
  expect(await watchBoards(db, boards, { night: 'Best night' })).toBe(1)
  st = await adminState(db, null)
  expect(st.watch.alerts.find((a) => a.kind === 'board').text).toContain('#2 on Best night')

  // Card shows it; clear one alert, then all; unwatch.
  expect((await playerCard(db, null, 'AAAA1')).watch.why).toBe('alt account?')
  expect((await playerCard(db, null, 'BBBB2')).watch).toBe(null)
  await A.watchClear(db, { id: st.watch.alerts[0].id })
  expect((await adminState(db, null)).watch.alerts.length).toBe(st.watch.alerts.length - 1)
  await A.watchClear(db, { all: true })
  expect((await adminState(db, null)).watch.alerts).toEqual([])
  await A.unwatch(db, { pid: 'AAAA1', name: 'Sneaky' })
  expect((await adminState(db, null)).watch.list).toEqual([])
  expect((await adminState(db, null)).history[0].text).toContain('off the watch list')
})

test('watch list: drops off after its days are up', async () => {
  const db = fakeServerDb()
  const t0 = Date.now()
  await ADMIN_ACTIONS.watch(db, { pid: 'AAAA1', days: 7 }, t0)
  await ADMIN_ACTIONS.watch(db, { pid: 'DDDD4', days: 0 })
  const later = t0 + 8 * 86400000
  await publicConfig(db, { pid: 'AAAA1' }, later)
  const st = await adminState(db, null, later)
  expect(st.watch.list.map((w) => w.pid)).toEqual(['DDDD4'])
  expect(st.watch.alerts).toEqual([])
})

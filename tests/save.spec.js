import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Save export/import round-trip and malformed-file handling.
//
// Scope note: _applyImportedSaveData() (the real import path) clears
// localStorage, writes the new data, then calls window.location.reload()
// synchronously - CLAUDE.md documents this as unreliable to drive through
// a real reload inside page.evaluate() (a real reload firing mid-evaluate
// reliably throws "Execution context was destroyed" and can silently kill
// later checks in the same call). Rather than fight that, this test
// verifies the two safely-testable halves: export produces a real
// snapshot of current storage, and a malformed file is rejected before
// ever reaching the reload path (JSON.parse fails first, inside a
// try/catch, well before any reload could happen).
test('export snapshot matches current localStorage contents', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(() => {
    const g = window.__game
    const snapshot = g._snapshotLocalSave()
    const realKeys = Object.keys(localStorage)
    return {
      isObject: typeof snapshot === 'object' && snapshot !== null,
      hasSettingsKey: 'gayz-settings' in snapshot,
      keyCountMatches: Object.keys(snapshot).length === realKeys.length,
    }
  })

  expect(result.isObject).toBe(true)
  expect(result.hasSettingsKey).toBe(true)
  expect(result.keyCountMatches).toBe(true)
})

test('a malformed save file is rejected without crashing or reloading', async ({ page }) => {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    const badFile = new File(['this is not valid json {{{'], 'bad-save.json', { type: 'application/json' })
    let threw = false
    try {
      await g._importSaveFile(badFile)
    } catch {
      threw = true
    }
    // Still on the same page / same window.__game instance means no
    // reload happened - a malformed file must fail before that path.
    return { threw, stillSameGame: window.__game === g }
  })

  expect(result.threw).toBe(false)
  expect(result.stillSameGame).toBe(true)
  expect(errors).toEqual([])
})

// --- Cloud Save merging (CloudMerge.js, 2026-10-23 audit) ---
// Pure rules first (no browser), then the real sync flow with an in-memory
// fake cloud (game.__cloudBackendForTests / window.__cloudPreBootBackendForTests).

test('cloud merge: totals add up, records take the higher, lists stay in order', async () => {
  const { mergeSaves, isMaxField, readBase, writeBase, syncableSnapshot } = await import('../src/game/CloudMerge.js')
  const j = (o) => JSON.stringify(o)
  const base = { 'gayz-career-stats': j({ totalKills: 10, lifetimeCoinsEarned: 100, lifetimePlaytimeSeconds: 600, mostProfitableRun: 50, longestSessionSeconds: 300 }) }
  // Each device played once since they last agreed.
  const local = { 'gayz-career-stats': j({ totalKills: 15, lifetimeCoinsEarned: 140, lifetimePlaytimeSeconds: 900, mostProfitableRun: 40, longestSessionSeconds: 300 }) }
  const remote = { 'gayz-career-stats': j({ totalKills: 13, lifetimeCoinsEarned: 130, lifetimePlaytimeSeconds: 700, mostProfitableRun: 60, longestSessionSeconds: 500 }) }
  const career = JSON.parse(mergeSaves(base, local, remote, true)['gayz-career-stats'])
  expect(career).toEqual({ totalKills: 18, lifetimeCoinsEarned: 170, lifetimePlaytimeSeconds: 1000, mostProfitableRun: 60, longestSessionSeconds: 500 })
  expect(['lifetimeCoinsEarned', 'lifetimePlaytimeSeconds', 'coins', 'xp'].map(isMaxField)).toEqual([false, false, false, false])
  expect(['mostProfitableRun', 'bestWave', 'prestigeLevel', 'accountCreatedAt', 'veteranPerksGranted'].map(isMaxField)).toEqual([true, true, true, true, true])

  // Run history from two devices: newest first, capped, nothing newer lost.
  const runs = (from, n) => Array.from({ length: n }, (_, i) => ({ ts: from + i * 10, night: i }))
  const both = runs(1000, 3)
  const merged = JSON.parse(mergeSaves({ 'gayz-run-history': j(both) }, { 'gayz-run-history': j([...runs(5000, 20), ...both]) }, { 'gayz-run-history': j([...runs(9000, 20), ...both]) }, true)['gayz-run-history'])
  expect(merged).toHaveLength(25)
  expect(merged[0].ts).toBe(9190)
  expect(merged.map((r) => r.ts)).toEqual([...merged.map((r) => r.ts)].sort((a, b) => b - a))

  // The merge base remembers its account.
  const store = new Map()
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
  writeBase(storage, { 'gayz-settings': '{}' }, 'alice')
  expect(readBase(storage, 'alice')).toEqual({ base: { 'gayz-settings': '{}' }, foreign: false })
  expect(readBase(storage, 'bob').foreign).toBe(true)
  expect(syncableSnapshot({ length: 2, key: (i) => ['gayz-cloud-base-uid', 'gayz-coins'][i], getItem: () => 'x' })).toEqual({ 'gayz-coins': 'x' })
})

// A fake cloud in the page: one account's save, with every upload counted.
async function installFakeCloud(page, uid, cloudData) {
  await page.evaluate(({ uid, cloudData }) => {
    const g = window.__game
    const cloud = { data: cloudData, modifiedTime: 1 }
    window.__fakeCloud = { cloud, pushes: 0 }
    g.__cloudBackendForTests = {
      fetchCloudSave: async () => (cloud.data ? { data: { ...cloud.data }, modifiedTime: cloud.modifiedTime } : null),
      pushCloudSaveIfUnchanged: async (_uid, data, expected) => {
        if (expected !== (cloud.data ? cloud.modifiedTime : null)) return false
        window.__fakeCloud.pushes++
        cloud.data = { ...data }
        cloud.modifiedTime++
        return cloud.modifiedTime
      },
    }
    Object.defineProperty(g, '_cloudUid', { value: uid, writable: true, configurable: true })
  }, { uid, cloudData })
}

test('cloud sync: waits for the keep-which-save answer, never mixes two accounts', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const otherAccount = { 'gayz-shop-progress': JSON.stringify({ coins: 999 }) }
  await installFakeCloud(page, 'bob', otherAccount)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    // This device last synced with alice's account.
    localStorage.setItem('gayz-cloud-base', JSON.stringify({ 'gayz-shop-progress': JSON.stringify({ coins: 5 }) }))
    localStorage.setItem('gayz-cloud-base-uid', 'alice')
    localStorage.setItem('gayz-shop-progress', JSON.stringify({ coins: 7 }))
    // The background sync a signed-in page runs (upload-only).
    await g._checkForNewerCloudSave()
    out.pending = !!g._cloudPendingConflict
    // While the question is open, background syncs do nothing.
    await g._checkForNewerCloudSave()
    out.pushes = window.__fakeCloud.pushes
    out.cloudCoins = JSON.parse(window.__fakeCloud.cloud.data['gayz-shop-progress']).coins
    out.localCoins = JSON.parse(localStorage.getItem('gayz-shop-progress')).coins
    return out
  })
  expect(r.pending).toBe(true)
  expect(r.pushes).toBe(0)
  expect(r.cloudCoins).toBe(999)
  expect(r.localCoins).toBe(7)
})

// Signing back in to the account this device last synced with merges - no
// "use cloud or keep this device" question that would throw one side away.
test('cloud sync: signing back in to the same account keeps both sides', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const j = (o) => JSON.stringify(o)
  // Last agreed: 10 kills. Since then this device (signed out) got to 14,
  // another device got the cloud to 13.
  await installFakeCloud(page, 'alice', { 'gayz-career-stats': j({ totalKills: 13 }) })
  await page.evaluate(({ base, local }) => {
    localStorage.setItem('gayz-cloud-base', JSON.stringify(base))
    localStorage.setItem('gayz-cloud-base-uid', 'alice')
    localStorage.setItem('gayz-career-stats', local)
    window.__game.careerStats.totalKills = 14
  }, { base: { 'gayz-career-stats': j({ totalKills: 10 }) }, local: j({ totalKills: 14 }) })
  const reloaded = page.waitForEvent('framenavigated')
  await page.evaluate(() => { window.__game._afterCloudSignIn('alice', { name: 'Alice' }) })
  await reloaded
  await page.waitForFunction(() => window.__game, null, { timeout: 120000 })
  const after = await page.evaluate(() => ({
    kills: JSON.parse(localStorage.getItem('gayz-career-stats')).totalKills,
    baseUid: localStorage.getItem('gayz-cloud-base-uid'),
  }))
  expect(after.kills).toBe(17)
  expect(after.baseUid).toBe('alice')
})

// Signed in (on page load) to a different account than this device last
// synced with: the pull before the game starts leaves this device alone.
test('cloud pre-boot pull skips another account\'s save', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    window.__preBootFetches = 0
    localStorage.setItem('gayz-cloud-last-sync', '1')
    localStorage.setItem('gayz-cloud-base', JSON.stringify({ 'gayz-shop-progress': JSON.stringify({ coins: 5 }) }))
    localStorage.setItem('gayz-cloud-base-uid', 'alice')
    localStorage.setItem('gayz-shop-progress', JSON.stringify({ coins: 7 }))
    window.__cloudPreBootBackendForTests = {
      getUid: async () => 'bob',
      fetchCloudSave: async () => { window.__preBootFetches++; return { data: { 'gayz-shop-progress': JSON.stringify({ coins: 999 }) }, modifiedTime: 1 } },
    }
  })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => ({ fetches: window.__preBootFetches, coins: JSON.parse(localStorage.getItem('gayz-shop-progress')).coins }))
  expect(r.fetches).toBe(0)
  expect(r.coins).toBe(7)
})

// Import Save keeps this device's own Cloud Save bookkeeping, so the
// imported progress counts as a change made here (and gets uploaded)
// instead of the cloud copy winning on the next sync.
test('import save keeps this device\'s cloud sync state', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await page.evaluate(() => {
    localStorage.setItem('gayz-cloud-base', '{"gayz-x":"1"}')
    localStorage.setItem('gayz-cloud-base-uid', 'alice')
    localStorage.setItem('gayz-cloud-last-sync', '123')
  })
  const reloaded = page.waitForEvent('framenavigated')
  await page.evaluate(() => {
    window.__game._applyImportedSaveData({
      'gayz-shop-progress': JSON.stringify({ coins: 50 }),
      'gayz-cloud-base': '{"from":"another device"}',
      'gayz-cloud-base-uid': 'bob',
      'gayz-cloud-last-sync': '999',
      'gayz-last-local-change': '5',
    })
  })
  await reloaded
  await page.waitForFunction(() => window.__game, null, { timeout: 120000 })
  const r = await page.evaluate(() => ({
    coins: JSON.parse(localStorage.getItem('gayz-shop-progress')).coins,
    base: localStorage.getItem('gayz-cloud-base'),
    uid: localStorage.getItem('gayz-cloud-base-uid'),
    lastSync: localStorage.getItem('gayz-cloud-last-sync'),
    changedRecently: Date.now() - Number(localStorage.getItem('gayz-last-local-change')) < 120000,
  }))
  expect(r).toEqual({ coins: 50, base: '{"gayz-x":"1"}', uid: 'alice', lastSync: '123', changedRecently: true })
})

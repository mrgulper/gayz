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
  await page.evaluate(({ cloudData }) => {
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
    // No background sync left over from boot (a 5s change timer or one
    // already running) may land in the middle of the test - on a slow test
    // machine one often did, before the test's own sync.
    clearTimeout(g._changeSyncTimer)
    return g._cloudSyncInFlight
  }, { cloudData })
  await page.evaluate(({ uid, cloudData }) => {
    const g = window.__game
    clearTimeout(g._changeSyncTimer)
    window.__fakeCloud.cloud.data = cloudData
    window.__fakeCloud.cloud.modifiedTime = 1
    window.__fakeCloud.pushes = 0
    // Fixed for the test: the page's own sign-in check (Firebase's auth
    // answer, "signed out") can land after this on a slow machine and
    // used to wipe it (seen on CI: uid null).
    Object.defineProperty(g, '_cloudUid', { get: () => uid, set: () => {}, configurable: true })
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
    out.before = { inFlight: !!g._cloudSyncInFlight, importing: !!g._importingSave, uid: g._cloudUid }
    await g._checkForNewerCloudSave()
    out.pending = !!g._cloudPendingConflict
    out.after = { importing: !!g._importingSave, base: localStorage.getItem('gayz-cloud-base-uid'), cloud: JSON.stringify(window.__fakeCloud.cloud) }
    // While the question is open, background syncs do nothing.
    await g._checkForNewerCloudSave()
    out.pushes = window.__fakeCloud.pushes
    out.cloudCoins = JSON.parse(window.__fakeCloud.cloud.data['gayz-shop-progress']).coins
    out.localCoins = JSON.parse(localStorage.getItem('gayz-shop-progress')).coins
    return out
  })
  expect(r.pending, JSON.stringify(r)).toBe(true)
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

// Signing in to an account whose save differs from this device's progress
// (2026-10-23): the "which save to keep?" question shows on General's
// General tab (Cloud Save lives there now), nothing syncs until it's
// answered, and "Keep This Device's Save" uploads this device's save as-is.
test('sign-in question opens on General; keeping this device uploads it', async ({ page }) => {
  await gotoAndWaitForGame(page)
  await installFakeCloud(page, 'bob', { 'gayz-shop-progress': JSON.stringify({ coins: 999 }) })
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    localStorage.setItem('gayz-shop-progress', JSON.stringify({ coins: 7 }))
    g._hasMeaningfulLocalProgress = () => true
    await g._afterCloudSignIn('bob', { name: 'Bob' })
    await new Promise((res) => setTimeout(res, 50))
    const conflict = document.getElementById('cloudsave-conflict')
    out.generalOpen = getComputedStyle(g.clanPanel).display
    out.questionShown = conflict.offsetParent !== null
    out.inGeneral = !!conflict.closest('#general-page-general')
    out.pushesBefore = window.__fakeCloud.pushes
    document.getElementById('cloudsave-use-local-btn').click()
    for (let i = 0; i < 40 && window.__fakeCloud.pushes === 0; i++) await new Promise((res) => setTimeout(res, 50))
    out.pending = !!g._cloudPendingConflict
    out.questionHidden = getComputedStyle(conflict).display === 'none'
    out.cloudCoins = JSON.parse(window.__fakeCloud.cloud.data['gayz-shop-progress']).coins
    return out
  })
  expect(r.generalOpen).toBe('flex')
  expect(r.questionShown).toBe(true)
  expect(r.inGeneral).toBe(true)
  expect(r.pushesBefore).toBe(0)
  expect(r.pending).toBe(false)
  expect(r.questionHidden).toBe(true)
  expect(r.cloudCoins).toBe(7)
})

// Map Editor builds in Cloud Save (CloudBuilds.js, 2026-11-20): pure rules
// with an in-memory "two devices + one cloud" setup - no browser needed.
test('cloud builds: two devices end up with every build, none lost', async () => {
  const { syncBuilds, decideBuildKey, mergePlayBest, mergeMap3Edits, hashValue } = await import('../src/game/CloudBuilds.js')
  expect(decideBuildKey('a', 'a', undefined)).toBe('same')
  expect(decideBuildKey('a', 'b', 'a')).toBe('pull')
  expect(decideBuildKey('b', 'a', 'a')).toBe('push')
  expect(decideBuildKey(null, 'a', undefined)).toBe('pull')
  expect(decideBuildKey('a', null, undefined)).toBe('push')
  expect(decideBuildKey('a', 'b', undefined)).toBe('clash')
  expect(JSON.parse(mergePlayBest('{"1":5,"2":9}', '{"1":7,"3":2}'))).toEqual({ 1: 7, 2: 9, 3: 2 })
  const m3 = JSON.parse(mergeMap3Edits(
    JSON.stringify({ removed: ['1,1,1'], placed: [{ x: 0, y: 0, z: 0, type: 'stone' }] }),
    JSON.stringify({ removed: ['2,2,2'], placed: [{ x: 0, y: 0, z: 0, type: 'dirt' }, { x: 5, y: 0, z: 5, type: 'wood' }] }),
  ))
  expect(m3.removed.sort()).toEqual(['1,1,1', '2,2,2'])
  expect(m3.placed).toEqual([{ x: 0, y: 0, z: 0, type: 'stone' }, { x: 5, y: 0, z: 5, type: 'wood' }])

  // One fake cloud, two fake devices.
  const cloud = { index: {}, docs: {} }
  const backend = {
    fetchBuildIndex: async () => JSON.parse(JSON.stringify(cloud.index)),
    fetchBuildDocs: async (_uid, keys) => Object.fromEntries(keys.map((k) => [k, cloud.docs[k] ?? null])),
    pushBuild: async (_uid, key, value, expected, h) => {
      if ((cloud.index[key]?.h ?? null) !== expected) return false
      const at = Date.now()
      cloud.index[key] = { h: value === null ? null : h, at }
      if (value === null) delete cloud.docs[key]
      else cloud.docs[key] = value
      return at
    },
  }
  const device = (init) => {
    const m = new Map(Object.entries(init))
    const storage = { get length() { return m.size }, key: (i) => [...m.keys()][i], getItem: (k) => (m.has(k) ? m.get(k) : null) }
    const io = { storage, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), uid: 'alice', backend }
    return { m, sync: (opts = {}) => syncBuilds({ ...io, ...opts }) }
  }
  // Both devices had a build in slot 0 before syncing existed, plus best waves.
  const pc = device({ 'buildmode-slot-0': 'PC castle', 'buildmode-thumb-0': 'pc.jpg', 'buildmode-play-best': '{"0":4}', 'gayz-coins': '1' })
  const phone = device({ 'buildmode-slot-0': 'Phone house', 'buildmode-thumb-0': 'phone.jpg', 'buildmode-play-best': '{"0":9}' })
  const r1 = await pc.sync()
  expect(r1.pushed).toBe(3)
  expect(Object.keys(cloud.docs).sort()).toEqual(['buildmode-play-best', 'buildmode-slot-0', 'buildmode-thumb-0'])
  // The phone keeps both castles: the cloud's in slot 0, its own moved to slot 1.
  await phone.sync()
  expect(phone.m.get('buildmode-slot-0')).toBe('PC castle')
  expect(phone.m.get('buildmode-thumb-0')).toBe('pc.jpg')
  expect(phone.m.get('buildmode-slot-1')).toBe('Phone house')
  expect(phone.m.get('buildmode-thumb-1')).toBe('phone.jpg')
  expect(JSON.parse(phone.m.get('buildmode-play-best'))).toEqual({ 0: 9 })
  expect(cloud.docs['buildmode-slot-1']).toBe('Phone house')
  // Back on the PC: the phone's house and best wave arrive.
  await pc.sync()
  expect(pc.m.get('buildmode-slot-1')).toBe('Phone house')
  expect(JSON.parse(pc.m.get('buildmode-play-best'))).toEqual({ 0: 9 })
  // Upload-only (background) syncs never write into the device.
  phone.m.set('buildmode-slot-2', 'Phone tower')
  await phone.sync()
  pc.m.delete('buildmode-slot-1')
  const bg = await pc.sync({ apply: false })
  expect(bg.applied).toBe(0)
  expect(pc.m.has('buildmode-slot-2')).toBe(false)
  // ...and deleting a slot on one device deletes it everywhere.
  expect(cloud.docs['buildmode-slot-1']).toBeUndefined()
  await phone.sync()
  expect(phone.m.has('buildmode-slot-1')).toBe(false)
  // Download-only (before the game starts) never uploads.
  pc.m.set('buildmode-sky', 'night')
  const pre = await pc.sync({ push: false })
  expect(pre.pushed).toBe(0)
  expect(pc.m.get('buildmode-slot-2')).toBe('Phone tower')
  expect(cloud.docs['buildmode-sky']).toBeUndefined()
  // Too big for one cloud doc: stays on the device, reported.
  pc.m.set('buildmode-slot-3', 'x'.repeat(950000))
  expect((await pc.sync()).tooBig).toEqual(['buildmode-slot-3'])
  // Non-build keys are never touched by this sync.
  expect(cloud.docs['gayz-coins']).toBeUndefined()
  expect(hashValue('abc')).toBe(hashValue('abc'))
})

// In the real game: a signed-in player's build change is uploaded by the
// normal background sync, and the signed-out warning sits on the
// character only while signed out.
test('cloud builds: a saved build uploads; warning only when signed out', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const warn = await page.evaluate(async () => {
    const g = window.__game
    await g._authReadyPromise
    g._renderSignInFooters()
    const el = document.getElementById('home-signin-warning')
    return { hidden: el.hidden, text: el.textContent }
  })
  // The test page is signed out.
  expect(warn.hidden).toBe(false)
  expect(warn.text).toContain('not signed in')
  await installFakeCloud(page, 'alice', null)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const cloud = { index: {}, docs: {} }
    Object.assign(g.__cloudBackendForTests, {
      fetchBuildIndex: async () => JSON.parse(JSON.stringify(cloud.index)),
      fetchBuildDocs: async (_u, keys) => Object.fromEntries(keys.map((k) => [k, cloud.docs[k] ?? null])),
      pushBuild: async (_u, key, value, expected, h) => {
        if ((cloud.index[key]?.h ?? null) !== expected) return false
        cloud.index[key] = { h, at: Date.now() }
        cloud.docs[key] = value
        return Date.now()
      },
    })
    localStorage.setItem('buildmode-slot-4', 'my build')
    clearTimeout(g._changeSyncTimer)
    const dirty = JSON.parse(localStorage.getItem('gayz-build-sync')).dirty['buildmode-slot-4'] > 0
    // The same upload-only sync a signed-in page runs in the background.
    await g._checkForNewerCloudSave()
    g._renderSignInFooters()
    return { dirty, uploaded: cloud.docs['buildmode-slot-4'], meta: JSON.parse(localStorage.getItem('gayz-build-sync')), warnHidden: document.getElementById('home-signin-warning').hidden, synced: Object.keys(window.__fakeCloud.cloud.data || {}).includes('gayz-build-sync') }
  })
  expect(r.dirty).toBe(true)
  expect(r.uploaded).toBe('my build')
  expect(r.meta.dirty['buildmode-slot-4']).toBeUndefined()
  // Signed in now: no warning; the bookkeeping key never goes into the main save.
  expect(r.warnHidden).toBe(true)
  expect(r.synced).toBe(false)
})

// Another device's build arrives when the page loads (before the game is
// built), with nothing uploaded during that pull.
test('cloud builds: page load brings in another device\'s build', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('gayz-cloud-last-sync', '1')
    window.__buildPushes = 0
    window.__cloudPreBootBackendForTests = {
      getUid: async () => 'alice',
      fetchCloudSave: async () => null,
      fetchBuildIndex: async () => ({ 'buildmode-slot-7': { h: 'from-phone', at: 5 } }),
      fetchBuildDocs: async (_u, keys) => Object.fromEntries(keys.map((k) => [k, k === 'buildmode-slot-7' ? 'phone build' : null])),
      pushBuild: async () => { window.__buildPushes++; return 1 },
    }
  })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(() => ({ slot: localStorage.getItem('buildmode-slot-7'), pushes: window.__buildPushes, base: JSON.parse(localStorage.getItem('gayz-build-sync')).base['buildmode-slot-7'] }))
  expect(r).toEqual({ slot: 'phone build', pushes: 0, base: 'from-phone' })
})

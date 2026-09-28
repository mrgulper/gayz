// Cloud Save's pull step, run once per page load BEFORE the game is built
// (from main.js, alongside the model preloads).
//
// Why (2026-09-28 report, twice: "when I refresh, it refreshes itself 2-3
// times or more"): the merge sync used to run after the game had already
// loaded, and when it found changes from another device it had to write
// them and reload the page so every system re-read them - and the reloaded
// page's own sync could find something new again. Merging here, before
// anything has read localStorage, means incoming changes are just there
// when the game starts - no reload at all. After boot, automatic syncs only
// upload (see CloudSaveUI.syncWithCloud); only an explicit click (Sign In,
// Sync Now, the conflict prompt) may still apply-and-reload.
//
// Only imports CloudSync/CloudMerge (never Game.js), so it can run before
// the game module's own state is touched.
import * as CloudSync from './CloudSync.js'
import { CLOUD_BASE_KEY, mergeSaves, stripDeviceOnly, syncableSnapshot } from './CloudMerge.js'

const CLOUD_LAST_SYNC_KEY = 'gayz-cloud-last-sync'
const LAST_LOCAL_CHANGE_KEY = 'gayz-last-local-change'
// Never hold the game back longer than this - a slow or offline connection
// just skips the pull (the upload-only syncs after boot keep this device's
// own changes flowing, and the next load tries again).
const PRE_BOOT_TIMEOUT_MS = 6000

function loadBase() {
  try {
    const raw = localStorage.getItem(CLOUD_BASE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function firstAuthState() {
  return new Promise((resolve, reject) => {
    let done = false
    let unsubscribe = null
    CloudSync.onAuthChange((session) => {
      if (done) return
      done = true
      if (unsubscribe) unsubscribe()
      resolve(session)
    }).then((unsub) => {
      unsubscribe = unsub
      if (done) unsub()
    }, reject)
  })
}

// Resolves once finished, skipped or timed out - never rejects, never
// blocks longer than PRE_BOOT_TIMEOUT_MS. `backend` is a test seam
// (window.__cloudPreBootBackendForTests: { getUid, fetchCloudSave }).
export function preBootCloudSync() {
  const testBackend = window.__cloudPreBootBackendForTests
  // Only devices that have synced before - everyone else never signed in,
  // and shouldn't pay for loading Firebase on every page load.
  if (!testBackend && (!CloudSync.isConfigured() || !localStorage.getItem(CLOUD_LAST_SYNC_KEY))) {
    return Promise.resolve('skipped')
  }
  let cancelled = false
  const work = (async () => {
    const uid = testBackend ? await testBackend.getUid() : (await firstAuthState())?.uid
    if (!uid || cancelled) return 'signed-out'
    const cloud = await (testBackend || CloudSync).fetchCloudSave(uid)
    if (!cloud || cancelled) return 'no-cloud'
    const local = syncableSnapshot(localStorage)
    const remote = stripDeviceOnly(cloud.data)
    const localChangeTime = Number(localStorage.getItem(LAST_LOCAL_CHANGE_KEY)) || 0
    const merged = mergeSaves(loadBase(), local, remote, localChangeTime >= (cloud.modifiedTime || 0))
    if (cancelled) return 'timeout'
    // Synchronous from here on: nothing else can run in between, so the
    // game can never start half-way through these writes.
    for (const key of Object.keys(local)) if (!(key in merged)) localStorage.removeItem(key)
    for (const [key, value] of Object.entries(merged)) {
      if (local[key] !== value) localStorage.setItem(key, value)
    }
    // Base = exactly what the cloud holds, NOT the merged result: this
    // device's own not-yet-uploaded changes then still count as changes
    // made here, so the first sync after boot uploads them (and totals
    // are only added once - see CloudMerge.js).
    localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(remote))
    return 'ok'
  })().catch(() => 'failed')
  const timeout = new Promise((resolve) => setTimeout(() => {
    cancelled = true
    resolve('timeout')
  }, PRE_BOOT_TIMEOUT_MS))
  return Promise.race([work, timeout])
}

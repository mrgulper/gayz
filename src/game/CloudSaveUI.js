// Cloud Save panel UI - open/close, sign-in state rendering, sync status,
// conflict resolution, sign-out. Extracted from Game.js (see CLAUDE.md's
// "Game.js split" notes) - plain exported functions taking `game` as an
// explicit first parameter, matching Keybinds.js/CloudSync.js/
// MenuEasterEggs.js's convention for UI-adjacent modules with no per-frame
// update() of their own, rather than an instantiated class.
//
// Deliberately does NOT include the "Online Features" cascade
// (leaderboard/rank/rival/nearby-rank/friends/poll - see
// _renderCloudOnlineSection and everything it calls in Game.js) - that's a
// much larger, more deeply interconnected cluster and a separate future
// slice; renderCloudSaveState below still calls back into it via
// game._renderCloudOnlineSection() same as before.
import { t } from './i18n.js'
import * as CloudSync from './CloudSync.js'
import * as ChatUI from './ChatUI.js'
import { CLOUD_LAST_SYNC_KEY, LAST_LOCAL_CHANGE_KEY, _formatRelativeTime, _safeStatNumber, saveSettings } from './Game.js'
import { CLOUD_BASE_KEY, isSyncedKey, mergeSaves, sameData, stripDeviceOnly, syncableSnapshot } from './CloudMerge.js'

export function openCloudSavePanel(game) {
  game.cloudsavePanel.style.display = 'flex'
  game.cloudsavePanelTitle.textContent = t('cloudsavePanelTitle')
  renderCloudSaveState(game)
  updateOnlineStatus(game)
}

// Online/Offline indicator (Cloud Save panel) - navigator.onLine plus the
// real online/offline events (registered once, see bindCloudSave's caller
// in Game.js's _bindHomepageBatch) rather than only checking at panel-open
// time, so the warning also appears/clears if connectivity changes while
// the panel is already open.
export function updateOnlineStatus(game) {
  if (!game.cloudsaveOfflineWarning) return
  const offline = !navigator.onLine
  game.cloudsaveOfflineWarning.style.display = offline ? '' : 'none'
  for (const btn of [game.cloudsaveSigninBtn, game.cloudsaveSyncNowBtn]) {
    if (btn) btn.disabled = offline
  }
}

export function closeCloudSavePanel(game) {
  game.cloudsavePanel.style.display = 'none'
  if (game._leaderboardUnsubscribe) {
    game._leaderboardUnsubscribe()
    game._leaderboardUnsubscribe = null
  }
}

// Session restore on page load - Firebase persists auth state itself
// (IndexedDB), so onAuthChange fires immediately with the real signed-in
// user (or null) with no popup and no manual token-caching of our own.
// Also the single ongoing source of truth: fires again on every future
// sign-in/sign-out too, so _cloudProfile/_cloudUid never drift from
// Firebase's own notion of the session.
export function restoreCloudSession(game) {
  if (!game.quickCloudBtn || !CloudSync.isConfigured()) {
    // Cloud Save isn't configured (fresh clone/fork with no Firebase
    // project set up - see CloudSync.isConfigured()'s own comment) - there
    // will never be a real onAuthChange callback to resolve
    // game._authReadyPromise, so any panel awaiting it (Profile/Clan/
    // Friends) would otherwise hang open forever. Resolve it here instead.
    game._resolveAuthReady?.()
    return
  }
  // Tracks whether this is the very first time this callback has fired
  // this page load - distinguishes Firebase silently resuming an already-
  // signed-in session (this device never explicitly signed in just now)
  // from a session that just changed because the player clicked Sign In
  // in this same page life. The latter already triggers a full
  // _afterCloudSignIn directly from _handleCloudSignIn - only the former
  // needs the new silent catch-up check below, or a fresh sign-in would
  // fire it twice.
  let isFirstCall = true
  CloudSync.onAuthChange((session) => {
    game._cloudProfile = session ? session.profile : null
    game._cloudUid = session ? session.uid : null
    // Resolves game._authReadyPromise on the first call only (a promise's
    // resolve function is a no-op on every call after the first) - see
    // that field's own comment in Game.js's constructor.
    game._resolveAuthReady?.()
    updateCloudQuickIcon(game, !!session)
    // Friend Requests - a persistent live subscription (not gated to a
    // panel being open, unlike the leaderboard one below) so the Friends
    // nav dot can light up without ever opening the panel. Restarted on
    // every auth change so it always points at the current account.
    if (game._friendRequestsUnsubscribe) {
      game._friendRequestsUnsubscribe()
      game._friendRequestsUnsubscribe = null
    }
    if (session) {
      game._friendRequestsUnsubscribe = CloudSync.subscribeIncomingFriendRequests(session.uid, (requests) => {
        // Auto-Decline Friend Requests (General tab) - declines every
        // incoming request as soon as it's seen, before it ever reaches
        // the visible list, rather than hiding-but-keeping them pending.
        if (game.settings.autoDeclineFriendRequests && requests.length) {
          for (const r of requests) CloudSync.respondToFriendRequest(session.uid, r.fromUid).catch(() => {})
          requests = []
        }
        game._incomingFriendRequests = requests
        game._updateFriendsDot()
        if (game.friendsPanel && getComputedStyle(game.friendsPanel).display !== 'none') {
          game._renderFriendRequests()
        }
      })
      // See _checkForNewerCloudSave's own comment (Game.js) for why this
      // exists - without it, a device that's already signed in never
      // notices anything pushed from elsewhere after its own first sign-in.
      if (isFirstCall) game._checkForNewerCloudSave(session.uid).catch(() => {})
    } else {
      game._incomingFriendRequests = []
      game._updateFriendsDot()
    }
    isFirstCall = false
    if (game.cloudsavePanel && getComputedStyle(game.cloudsavePanel).display !== 'none') {
      renderCloudSaveState(game)
    }
  }).catch(() => {
    // onAuthChange itself failed (e.g. the Firebase chunks failed to load)
    // before ever calling back once - resolve anyway so an awaiting panel
    // doesn't hang open forever (see this function's other early-return).
    game._resolveAuthReady?.()
  })
}

export function updateCloudQuickIcon(game, signedIn) {
  if (game.quickCloudBtn) game.quickCloudBtn.classList.toggle('signed-in', signedIn)
  if (game.cloudSignedInDot) game.cloudSignedInDot.style.display = signedIn ? '' : 'none'
  // The corner badge shows the player's Minecraft skin face (see
  // Game.js's _updateMenuAvatarPhoto, called whenever a skin loads/
  // changes) - deliberately untouched here regardless of sign-in state.
  // The signed-in Google photo is never used for it (kept private to the
  // Cloud Save panel's own account row instead), so signing in doesn't
  // silently put a real photo on the public-facing homepage.
}

export function renderCloudSaveState(game) {
  const signedIn = !!game._cloudProfile
  if (game.cloudsaveSignedOut) game.cloudsaveSignedOut.style.display = signedIn ? 'none' : 'flex'
  if (game.cloudsaveSignedIn) game.cloudsaveSignedIn.style.display = signedIn ? 'flex' : 'none'
  if (!CloudSync.isConfigured() && game.cloudsaveSignedOutDesc) {
    game.cloudsaveSignedOutDesc.textContent = t('cloudsaveNotConfigured')
  } else if (game.cloudsaveSignedOutDesc) {
    game.cloudsaveSignedOutDesc.textContent = t('cloudsaveSignedOutDesc')
  }
  if (game.cloudsaveSigninBtn) {
    game.cloudsaveSigninBtn.textContent = t('signUpOrLoginBtn')
    game.cloudsaveSigninBtn.disabled = !CloudSync.isConfigured()
  }
  // Friends panel - Add Friend / Friend Requests (see Game.js's
  // _openFriendsPanel) need the same Cloud Save account, so it mirrors
  // this exact signed-in toggle rather than tracking its own state.
  if (game.friendsSignedOut) game.friendsSignedOut.style.display = signedIn ? 'none' : 'flex'
  if (game.friendsSignedIn) game.friendsSignedIn.style.display = signedIn ? 'flex' : 'none'
  if (game.friendsSigninBtn) game.friendsSigninBtn.disabled = !CloudSync.isConfigured()
  // Global panel chat (#server-panel) - same reasoning as Friends above,
  // updates live if the panel happens to be open while sign-in state
  // changes (see ChatUI.js's renderServerChatSignInState).
  ChatUI.renderServerChatSignInState(game)
  if (game.serverChatSigninBtn) game.serverChatSigninBtn.disabled = !CloudSync.isConfigured()
  if (!signedIn) return
  if (game.cloudsaveAvatar) game.cloudsaveAvatar.src = game._cloudProfile.picture || ''
  if (game.cloudsaveAccountName) game.cloudsaveAccountName.textContent = game._cloudProfile.name || game._cloudProfile.email || ''
  renderCloudSyncStatus(game)
  if (game.cloudsaveSyncNowBtn) game.cloudsaveSyncNowBtn.textContent = t('cloudsaveSyncNowBtn')
  if (game.cloudsaveSignoutBtn) game.cloudsaveSignoutBtn.textContent = t('cloudsaveSignoutBtn')
  game._renderCloudOnlineSection()
}

export function renderCloudSyncStatus(game) {
  if (!game.cloudsaveSyncStatus) return
  const last = localStorage.getItem(CLOUD_LAST_SYNC_KEY)
  game.cloudsaveSyncStatus.textContent = last
    ? t('cloudsaveLastSynced', { time: _formatRelativeTime(Math.max(0, Date.now() - Number(last))) })
    : t('cloudsaveNeverSynced')
  // Also on the homepage cloud icon itself (see #7 of the Online Features
  // ask - a "glance" without permanent new homepage UI).
  if (game.quickCloudBtn) {
    game.quickCloudBtn.title = game._cloudProfile
      ? t('cloudQuickIconTooltip', { name: game._cloudProfile.name || game._cloudProfile.email, status: last ? _formatRelativeTime(Math.max(0, Date.now() - Number(last))) : t('cloudsaveNeverSynced') })
      : ''
  }
}

export function renderCloudConflict(game, data) {
  if (!game.cloudsaveConflict) return
  const safeParse = (raw, fallback) => {
    try {
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  }
  const cloudCareer = safeParse(data['gayz-career-stats'], {})
  const cloudBest = safeParse(data['gayz-best-stats'], {})
  game.cloudsaveConflictDesc.textContent = t('cloudsaveConflictDesc', {
    localKills: _safeStatNumber(game.careerStats.totalKills),
    localNight: _safeStatNumber(game.bestStats.bestNight),
    cloudKills: _safeStatNumber(cloudCareer.totalKills),
    cloudNight: _safeStatNumber(cloudBest.bestNight),
  })
  game.cloudsaveConflict.style.display = 'flex'
  if (game.cloudsaveUseCloudBtn) game.cloudsaveUseCloudBtn.textContent = t('cloudsaveUseCloudBtn')
  if (game.cloudsaveUseLocalBtn) game.cloudsaveUseLocalBtn.textContent = t('cloudsaveUseLocalBtn')
}

// Firebase Auth's own session lives in IndexedDB, not localStorage, so it
// survives _applyImportedSaveData's localStorage.clear() on its own - no
// need to manually re-inject an account marker the way the earlier
// Drive-based design had to. Just carry the sync timestamp forward so the
// status line doesn't flash back to "Not synced yet" for one frame after
// reload. Shared by resolveCloudConflict's "use cloud" choice and
// Game.js's _afterCloudSignIn auto-apply path (same account should read
// the same on every device without needing this picked manually every
// time - see that function's own comment for when it still asks first).
export function applyCloudSaveData(game, data) {
  // Same guards _applyImportedSaveData uses (see its comment): nothing on
  // this page may write its stale in-memory state back over the data below
  // before the reload lands. Unlike that function, this only replaces the
  // game's own synced keys - device-only keys (Auto Quality level, sync
  // bookkeeping) and anything that isn't the game's (Firebase's own
  // storage) are left exactly as they are rather than cleared.
  game._importingSave = true
  if (game._autoSaveTimer) clearInterval(game._autoSaveTimer)
  const synced = stripDeviceOnly(data)
  for (const key of Object.keys(syncableSnapshot(localStorage))) {
    if (!(key in synced)) localStorage.removeItem(key)
  }
  for (const [key, value] of Object.entries(synced)) localStorage.setItem(key, value)
  // The applied content now exactly matches the cloud, so it's this
  // device's merge base (see CloudMerge.js).
  localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(synced))
  localStorage.setItem(CLOUD_LAST_SYNC_KEY, String(Date.now()))
  markSyncReload()
  window.location.reload()
}

// Reload-loop guard (2026-09-28 report: "when I refresh it refreshes
// itself 2-3 times or more"): applying synced data means reloading, and a
// reload-triggered sync that finds yet more changes (another device - or
// an old tab still running the previous version - uploading in between)
// would reload again, and again. At most one sync-triggered reload per
// SYNC_RELOAD_COOLDOWN_MS: within that window a sync still uploads this
// device's changes when it safely can, but defers applying anything
// incoming until the next load or the next time the tab comes back into
// view. sessionStorage: per tab, survives the reload, gone when the tab is.
const SYNC_RELOAD_KEY = 'gayz-sync-reloaded-at'
const SYNC_RELOAD_COOLDOWN_MS = 20000
function markSyncReload() {
  try {
    sessionStorage.setItem(SYNC_RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable - no guard, same as before.
  }
}
function reloadedBySyncRecently() {
  try {
    return Date.now() - (Number(sessionStorage.getItem(SYNC_RELOAD_KEY)) || 0) < SYNC_RELOAD_COOLDOWN_MS
  } catch {
    return false
  }
}

function loadBase() {
  try {
    const raw = localStorage.getItem(CLOUD_BASE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// The one sync path (see CloudMerge.js for the bug this replaced): read the
// cloud, three-way merge it with this device's data against the last
// content they agreed on, upload the result only if the cloud still is
// what was just read (retrying the whole read+merge if another device got
// there first), and - when the merge picked up changes from elsewhere -
// write them into this device's storage and reload so every system
// re-reads them. Returns 'ok' | 'deferred' | 'failed'.
//
// allowApply=false - every automatic sync (see CloudPreBoot.js): changes
// from other devices are never written into this page (that would need a
// reload); this device's own changes are still uploaded, merged on top of
// the cloud's. Only explicit clicks (Sign In, Sync Now, the conflict
// prompt) pass allowApply=true. Never throws.
export async function syncWithCloud(game, { manual = false, allowApply = true } = {}) {
  // __cloudBackendForTests: Playwright swaps in an in-memory fake with the
  // same two functions, so the merge flow can be exercised across two
  // simulated devices without touching a real Firestore save.
  const backend = game.__cloudBackendForTests || CloudSync
  // Already applying a merge (the page is about to reload with it).
  if (game._importingSave) return 'reloading'
  if (!game._cloudUid || (!game.__cloudBackendForTests && !CloudSync.isConfigured())) return 'failed'
  if (game._cloudSyncInFlight) return game._cloudSyncInFlight
  if (allowApply && reloadedBySyncRecently()) allowApply = false
  game._cloudSyncInFlight = (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const cloud = await backend.fetchCloudSave(game._cloudUid)
        const local = syncableSnapshot(localStorage)
        const base = loadBase()
        const remote = cloud ? stripDeviceOnly(cloud.data) : {}
        const localChangeTime = Number(localStorage.getItem(LAST_LOCAL_CHANGE_KEY)) || 0
        const merged = cloud ? mergeSaves(base, local, remote, localChangeTime >= (cloud.modifiedTime || 0)) : local
        const localChanged = !sameData(merged, local)
        const remoteChanged = !cloud || !sameData(merged, remote)
        if (localChanged && !allowApply) {
          // Upload-only: the cloud gets everything (this device's changes
          // included) without touching this page's storage, and the base
          // becomes this device's current content - "the cloud has all of
          // this, plus more" - so the next load's pre-boot pull brings the
          // rest in, and any change made here meanwhile still merges on top
          // (totals included: M - L equals the other devices' deltas).
          if (remoteChanged) {
            const result = await backend.pushCloudSaveIfUnchanged(game._cloudUid, merged, cloud ? cloud.modifiedTime ?? null : null)
            if (result === false) continue
            game._cloudSyncing = true
            try {
              localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(local))
              localStorage.setItem(CLOUD_LAST_SYNC_KEY, String(Date.now()))
            } finally {
              game._cloudSyncing = false
            }
            game._cloudLastUpdatedAt = result
            renderCloudSyncStatus(game)
          }
          return 'deferred'
        }
        let newUpdatedAt = cloud ? cloud.modifiedTime : null
        if (remoteChanged) {
          const result = await backend.pushCloudSaveIfUnchanged(game._cloudUid, merged, cloud ? cloud.modifiedTime ?? null : null)
          if (result === false) continue // another device uploaded first - re-read and re-merge
          newUpdatedAt = result
        }
        if (localChanged) {
          applyCloudSaveData(game, merged)
          return 'ok'
        }
        game._cloudSyncing = true
        try {
          localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(merged))
          localStorage.setItem(CLOUD_LAST_SYNC_KEY, String(Date.now()))
        } finally {
          game._cloudSyncing = false
        }
        game._cloudLastUpdatedAt = newUpdatedAt
        renderCloudSyncStatus(game)
        if (manual) game._showHomepageToast(t('cloudsaveSynced'))
        return 'ok'
      }
      if (manual) game._showHomepageToast(t('cloudsaveError'))
      return 'failed'
    } catch (err) {
      // Kept for diagnostics (Copy Error Log / Playwright) - a failed sync
      // is otherwise silent unless it was a manual Sync Now.
      game._lastCloudSyncError = String(err && (err.stack || err.message || err))
      if (manual) game._showHomepageToast(t('cloudsaveError'))
      return 'failed'
    } finally {
      game._cloudSyncInFlight = null
    }
  })()
  return game._cloudSyncInFlight
}

// Change tracking - every localStorage write of synced data (not just
// settings, which was all the old LAST_LOCAL_CHANGE_KEY stamp covered)
// marks this device as having unsynced changes and schedules a sync a few
// seconds later, so progress made between runs (shop, quests, coins)
// reaches the cloud without waiting for the next finished run. Patched
// once on Storage.prototype because this game has ~50 separate save
// functions across a dozen files, and missing even one is exactly how
// progress silently stays on one device. Writes that don't change the
// stored value are ignored (the settings autosave timer rewrites unchanged
// settings every ~30s). Mid-run, nothing is synced until the run ends
// (the run-end sync picks it all up), so an in-progress run is never
// reloaded underneath the player.
const CHANGE_SYNC_DELAY_MS = 5000

// Background upload a few seconds from now - or, mid-run, as soon as the
// player is back out of the run (checked every few seconds). Background
// syncs never reload the page (allowApply: false): they upload this
// device's changes whenever the cloud hasn't moved on, and anything another
// device changed is picked up at the next load or when this tab comes back
// into view (see installChangeTracking's visibilitychange handler) - the
// natural moments someone switches devices. Letting every background sync
// reload is what turned two open devices into a reload ping-pong.
export function scheduleSyncWhenIdle(game) {
  clearTimeout(game._changeSyncTimer)
  const tick = () => {
    if (!game._cloudUid) return
    if (game.gameStarted) {
      game._changeSyncTimer = setTimeout(tick, CHANGE_SYNC_DELAY_MS)
      return
    }
    syncWithCloud(game, { allowApply: false })
  }
  game._changeSyncTimer = setTimeout(tick, CHANGE_SYNC_DELAY_MS)
}

export function installChangeTracking(game) {
  if (Storage.prototype.__gayzTracked) return
  Storage.prototype.__gayzTracked = true
  const origSet = Storage.prototype.setItem
  const origRemove = Storage.prototype.removeItem
  const onChange = (storage, key) => {
    if (storage !== window.localStorage || !isSyncedKey(key) || game._cloudSyncing || game._importingSave) return
    try {
      origSet.call(storage, LAST_LOCAL_CHANGE_KEY, String(Date.now()))
    } catch {
      // Storage full/unavailable - nothing to track.
    }
    if (!game._cloudUid) return
    scheduleSyncWhenIdle(game)
  }
  Storage.prototype.setItem = function (key, value) {
    const changed = this.getItem(key) !== String(value)
    origSet.call(this, key, value)
    if (changed) onChange(this, String(key))
  }
  Storage.prototype.removeItem = function (key) {
    const existed = this.getItem(key) !== null
    origRemove.call(this, key)
    if (existed) onChange(this, String(key))
  }
  // Leaving the page / switching apps (the moment someone picks up another
  // device) - flush in-memory stats to storage and push them right away.
  // Best effort: the browser may not finish the request, in which case the
  // next load's sync still has them.
  //
  // Coming back to the tab uploads too, but never applies/reloads - the
  // next page load's pre-boot pull brings in other devices' changes.
  document.addEventListener('visibilitychange', () => {
    if (!game._cloudUid || game._importingSave) return
    if (document.visibilityState === 'hidden') {
      game._flushLocalSave?.()
      syncWithCloud(game, { allowApply: false })
    } else if (document.visibilityState === 'visible') {
      syncWithCloud(game, { allowApply: false })
    }
  })
}

export function resolveCloudConflict(game, choice) {
  if (!game._cloudPendingConflict) return
  if (choice === 'cloud') {
    const data = game._cloudPendingConflict
    game._cloudPendingConflict = null
    applyCloudSaveData(game, data)
  } else {
    // "Keep this device's save": making the cloud's current content this
    // device's merge base means every key where the two differ counts as a
    // change made HERE, so the sync below uploads this device's data as-is
    // (see CloudMerge.js) rather than combining the two.
    const cloudData = game._cloudPendingConflict
    game._cloudPendingConflict = null
    if (game.cloudsaveConflict) game.cloudsaveConflict.style.display = 'none'
    game._cloudSyncing = true
    try {
      localStorage.setItem(CLOUD_BASE_KEY, JSON.stringify(stripDeviceOnly(cloudData)))
    } finally {
      game._cloudSyncing = false
    }
    pushToCloud(game, true)
  }
}

// manual=true shows a toast; manual=false is the best-effort post-run
// auto-sync - swallows errors quietly rather than interrupting the
// death/results flow.
// Kept as the name every existing caller uses (run end, settings changes,
// Sync Now) - now a full merge-sync rather than a blind overwrite (see
// syncWithCloud). Only a manual click on the homepage applies incoming
// changes (with a reload); automatic calls upload only.
export async function pushToCloud(game, manual) {
  return syncWithCloud(game, { manual, allowApply: !!manual && !game.gameStarted })
}

export async function handleCloudSignOut(game) {
  // Confirm Before Signing Out (General tab) - off by default, matching
  // this action's existing no-confirmation behavior for anyone who never
  // opens that setting.
  if (game.settings.confirmSignOut && !window.confirm(t('confirmSignOutMessage'))) return
  // The local sign-out (clearing _cloudProfile/_cloudUid, updating the UI)
  // must happen regardless of whether the remote Firebase signOut call
  // itself succeeds - a network hiccup shouldn't leave the player stuck
  // unable to sign out on their own device.
  try {
    await CloudSync.signOut()
  } catch {
    // Best-effort - local state still clears below either way.
  }
  game._cloudProfile = null
  game._cloudUid = null
  game._cloudPendingConflict = null
  game._cloudGlobalRank = null
  if (game._leaderboardUnsubscribe) {
    game._leaderboardUnsubscribe()
    game._leaderboardUnsubscribe = null
  }
  updateCloudQuickIcon(game, false)
  if (game.cloudsaveConflict) game.cloudsaveConflict.style.display = 'none'
  renderCloudSaveState(game)
  game._renderPlayerTag()
}

export function bindCloudSave(game) {
  if (game.quickCloudBtn) game.quickCloudBtn.addEventListener('click', () => openCloudSavePanel(game))
  if (game.cloudsavePanel) {
    game.cloudsavePanel.addEventListener('click', (e) => {
      if (e.target === game.cloudsavePanel) closeCloudSavePanel(game)
    })
  }
  if (game.cloudsaveSigninBtn) game.cloudsaveSigninBtn.addEventListener('click', () => game._openProfilePanel())
  if (game.cloudsaveSignoutBtn) game.cloudsaveSignoutBtn.addEventListener('click', () => handleCloudSignOut(game))
  if (game.cloudsaveSyncNowBtn) game.cloudsaveSyncNowBtn.addEventListener('click', () => pushToCloud(game, true))
  if (game.cloudsaveUseCloudBtn) game.cloudsaveUseCloudBtn.addEventListener('click', () => resolveCloudConflict(game, 'cloud'))
  if (game.cloudsaveUseLocalBtn) game.cloudsaveUseLocalBtn.addEventListener('click', () => resolveCloudConflict(game, 'local'))
  if (game.sendFriendRequestBtn) game.sendFriendRequestBtn.addEventListener('click', () => game._sendFriendRequestClick())
  if (game.deleteAllRequestsBtn) game.deleteAllRequestsBtn.addEventListener('click', () => game._deleteAllFriendRequests())
  if (game.statusPickBtns) {
    game._renderStatusPicker()
    for (const btn of game.statusPickBtns) {
      btn.addEventListener('click', () => game._applyStatusMode(btn.dataset.status))
    }
  }
  if (game.cloudsaveRegionSelect) {
    game.cloudsaveRegionSelect.addEventListener('change', () => {
      game.settings.region = game.cloudsaveRegionSelect.value
      saveSettings(game.settings)
      game._subscribeLeaderboard()
    })
  }
  if (game.cloudsaveFriendInput) {
    game.cloudsaveFriendInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') game._sendFriendRequestClick()
      if (e.key === 'Escape') game._showFriendSuggestions([])
    })
    // Typing a name shows everyone whose name starts with it.
    let searchTimer = null
    game.cloudsaveFriendInput.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => game._searchFriendNames(game.cloudsaveFriendInput.value), 300)
    })
  }
  if (game.cloudsaveFriendSuggestions) {
    game.cloudsaveFriendSuggestions.addEventListener('click', (e) => {
      const row = e.target.closest('.friend-suggest-row')
      const entry = row && game._friendSuggestions?.[Number(row.dataset.index)]
      if (!entry) return
      game._sendFriendRequestTo(entry).catch(() => { game.cloudsaveFriendResult.textContent = t('cloudsaveError') })
    })
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#cloudsave-friend-row, #cloudsave-friend-suggestions')) game._showFriendSuggestions([])
    })
  }
  // Applies a chosen avatar preset immediately even if Cloud Save isn't
  // configured (see restoreCloudSession's own early-return guard) or the
  // async auth check hasn't resolved yet.
  updateCloudQuickIcon(game, false)
  restoreCloudSession(game)
}

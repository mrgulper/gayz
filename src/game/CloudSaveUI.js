// Cloud Save panel UI - open/close, sign-in state rendering, sync status,
// conflict resolution, sign-out. Extracted from Game.js (see its own
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
import { CLOUD_LAST_SYNC_KEY, _formatRelativeTime, _safeStatNumber, saveSettings } from './Game.js'

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
  if (!game.quickCloudBtn || !CloudSync.isConfigured()) return
  CloudSync.onAuthChange((session) => {
    game._cloudProfile = session ? session.profile : null
    game._cloudUid = session ? session.uid : null
    updateCloudQuickIcon(game, !!session)
    if (game.cloudsavePanel && getComputedStyle(game.cloudsavePanel).display !== 'none') {
      renderCloudSaveState(game)
    }
  }).catch(() => {})
}

export function updateCloudQuickIcon(game, signedIn) {
  if (game.quickCloudBtn) game.quickCloudBtn.classList.toggle('signed-in', signedIn)
  if (game.cloudSignedInDot) game.cloudSignedInDot.style.display = signedIn ? '' : 'none'
  // Avatar precedence: a chosen preset (see _renderProfileAvatarPicker)
  // wins, otherwise a plain anonymous hooded-silhouette image - the
  // signed-in Google photo is deliberately never used here (kept private
  // to the Cloud Save panel's own account row instead), so signing in
  // doesn't silently put a real photo on the public-facing homepage.
  if (game.menuAvatarPhoto) {
    const presetUrls = { male: '/images/avatar-male.png', female: '/images/avatar-female.png' }
    game.menuAvatarPhoto.src = presetUrls[game.settings.avatarChoice] || '/images/avatar-anonymous.png'
    game.menuAvatarPhoto.style.display = ''
  }
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
    game.cloudsaveSigninBtn.textContent = t('cloudsaveSigninBtn')
    game.cloudsaveSigninBtn.disabled = !CloudSync.isConfigured()
  }
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

export function resolveCloudConflict(game, choice) {
  if (!game._cloudPendingConflict) return
  if (choice === 'cloud') {
    // Firebase Auth's own session lives in IndexedDB, not localStorage, so
    // it survives _applyImportedSaveData's localStorage.clear() on its own
    // - no need to manually re-inject an account marker the way the
    // earlier Drive-based design had to. Just carry the sync timestamp
    // forward so the status line doesn't flash back to "Not synced yet"
    // for one frame after reload.
    const data = { ...game._cloudPendingConflict, [CLOUD_LAST_SYNC_KEY]: String(Date.now()) }
    game._cloudPendingConflict = null
    game._applyImportedSaveData(data)
  } else {
    game._cloudPendingConflict = null
    if (game.cloudsaveConflict) game.cloudsaveConflict.style.display = 'none'
    pushToCloud(game, true)
  }
}

// manual=true shows a toast; manual=false is the best-effort post-run
// auto-sync - swallows errors quietly rather than interrupting the
// death/results flow.
export async function pushToCloud(game, manual) {
  if (!game._cloudUid || !CloudSync.isConfigured()) return
  try {
    await CloudSync.pushCloudSave(game._cloudUid, game._snapshotLocalSave())
    localStorage.setItem(CLOUD_LAST_SYNC_KEY, String(Date.now()))
    renderCloudSyncStatus(game)
    if (manual) game._showLoreToast(t('cloudsaveSynced'))
  } catch {
    if (manual) game._showLoreToast(t('cloudsaveError'))
  }
}

export async function handleCloudSignOut(game) {
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
  if (game.cloudsaveSigninBtn) game.cloudsaveSigninBtn.addEventListener('click', () => game._handleCloudSignIn())
  if (game.cloudsaveSignoutBtn) game.cloudsaveSignoutBtn.addEventListener('click', () => handleCloudSignOut(game))
  if (game.cloudsaveSyncNowBtn) game.cloudsaveSyncNowBtn.addEventListener('click', () => pushToCloud(game, true))
  if (game.cloudsaveUseCloudBtn) game.cloudsaveUseCloudBtn.addEventListener('click', () => resolveCloudConflict(game, 'cloud'))
  if (game.cloudsaveUseLocalBtn) game.cloudsaveUseLocalBtn.addEventListener('click', () => resolveCloudConflict(game, 'local'))
  if (game.cloudsaveFriendCompareBtn) game.cloudsaveFriendCompareBtn.addEventListener('click', () => game._handleFriendCompare())
  if (game.cloudsaveRandomOpponentBtn) game.cloudsaveRandomOpponentBtn.addEventListener('click', () => game._compareVsRandomOpponent())
  if (game.cloudsaveFriendSaveBtn) game.cloudsaveFriendSaveBtn.addEventListener('click', () => game._saveFriend())
  if (game.cloudsaveRegionSelect) {
    game.cloudsaveRegionSelect.addEventListener('change', () => {
      game.settings.region = game.cloudsaveRegionSelect.value
      saveSettings(game.settings)
      game._subscribeLeaderboard()
    })
  }
  if (game.cloudsaveFriendInput) {
    game.cloudsaveFriendInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') game._handleFriendCompare()
    })
  }
  // Applies a chosen avatar preset immediately even if Cloud Save isn't
  // configured (see restoreCloudSession's own early-return guard) or the
  // async auth check hasn't resolved yet.
  updateCloudQuickIcon(game, false)
  restoreCloudSession(game)
}

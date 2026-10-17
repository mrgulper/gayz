// Friend List and other players' profiles: saved friends, friend requests,
// presence/status, the name search behind Add a Friend, and the profile view
// of another player.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as CloudSync from './CloudSync.js'
import { FRIEND_OFFLINE_THRESHOLD_MS, FRIEND_ONLINE_THRESHOLD_MS, FRIEND_STATUS_LABEL_KEYS, _escapeHtml, _formatRelativeTime, _safeStatNumber, formatTime, saveSettings, todayDateString } from './Game.js'
import { t } from './i18n.js'

// "Your Friends" list - now populated only by accepting an incoming
// friend request (see _respondToFriendRequest), not by manually typing a
// name any more (that was the removed Save/Compare flow). Each row shows
// a live presence status (see _fetchFriendPresences/_computeFriendStatus)
// fetched right after the list itself renders, since the status read is
// its own async Firestore call per friend, not part of settings.
// "Your Friends (#)", like Friend Requests' count (2026-10-10).
export function _renderFriendsCount(game) {
  const count = document.getElementById('friends-count')
  if (count) count.textContent = t('friendRequestsCount', { n: game.settings.savedFriends.length })
}

export function _renderSavedFriends(game) {
  if (!game.cloudsaveSavedFriends) return
  const friends = game.settings.savedFriends
  game._renderFriendsCount()
  game.cloudsaveSavedFriends.innerHTML = friends.map((f) => `
    <div class="saved-friend-row" data-uid="${_escapeHtml(f.uid || '')}" data-name="${_escapeHtml(f.name)}" title="Click to view profile">
      <span class="friend-status-dot" data-status="offline"></span>
      <span class="friend-name">${_escapeHtml(f.name)}${f.playerId ? ` <span class="friend-id">#${_escapeHtml(f.playerId)}</span>` : ''}</span>
      <span class="friend-status-label">${t('friendStatusOffline')}</span>
      <span class="saved-friend-remove" data-remove="${_escapeHtml(f.name)}">×</span>
    </div>
  `).join('')
  for (const btn of game.cloudsaveSavedFriends.querySelectorAll('.saved-friend-remove')) {
    btn.addEventListener('click', () => {
      if (game.settings.confirmRemoveFriend && !window.confirm(t('confirmRemoveFriendMessage', { name: btn.dataset.remove }))) return
      game.settings.savedFriends = game.settings.savedFriends.filter((f) => f.name !== btn.dataset.remove)
      saveSettings(game.settings)
      game._renderSavedFriends()
    })
  }
  game._fetchFriendPresences(friends)
}

// Viewing another player's live profile - a small public read-only panel
// (name/id/best stats, all already-public leaderboard fields, see
// CloudSync.fetchLeaderboardEntryByUid) opened by clicking a row in
// "Your Friends". Distinct from the existing static ?viewprofile= share
// link (a snapshot someone posts elsewhere) - this always reflects their
// CURRENT live stats since it fetches fresh on every open.
export async function _openOtherPlayerProfile(game, uid, fallbackName) {
  if (!game.otherProfilePanel) return
  game._showOtherProfileLoading(fallbackName)
  let entry = null
  try {
    entry = await CloudSync.fetchLeaderboardEntryByUid(uid)
  } catch {
    // Best-effort - falls through to the "hasn't completed a run yet"
    // state below, same as a genuine null result.
  }
  // The panel may have been closed (or reopened for someone else) while
  // game fetch was in flight - don't clobber whatever's showing now.
  if (game.otherProfilePanel.style.display === 'none') return
  game._renderOtherProfileEntry(entry, fallbackName)
}

// Same panel, reached by pasting a Player ID into chat instead of
// clicking a Friends row (see ChatUI.bindChatContextActions/ChatUI.bindServerChat's
// .chat-message-id-link handler) - looked up by playerId
// (fetchLeaderboardEntryByPlayerId) rather than uid, everything else
// about opening/rendering the panel is identical.
export async function _openOtherPlayerProfileById(game, playerId, fallbackName) {
  if (!game.otherProfilePanel) return
  game._showOtherProfileLoading(fallbackName)
  const entry = await CloudSync.fetchLeaderboardEntryByPlayerId(playerId).catch(() => null)
  if (game.otherProfilePanel.style.display === 'none') return
  game._renderOtherProfileEntry(entry, fallbackName)
}

export function _showOtherProfileLoading(game, fallbackName) {
  game.otherProfilePanel.style.display = 'flex'
  game.otherProfileName.textContent = fallbackName || '???'
  game._otherProfileIdText = null
  game._otherProfileCurrentPlayerId = null
  game.otherProfileId.textContent = ''
  game.otherProfileStats.style.display = 'none'
  game.otherProfileNone.style.display = 'none'
  game.otherProfileLoading.style.display = 'block'
  // Bio/Motto/Notes column - hidden during loading/no-data states (see
  // _renderOtherProfileEntry's own !entry branch), only shown once
  // there's an actual entry+playerId to attach a Notes key to.
  if (game.otherProfileBioMotto) game.otherProfileBioMotto.style.display = 'none'
}

// Same field set as the Profile panel's own "Shown to Public" tab (see
// _renderPublicProfileSection) minus Clan - a leaderboard entry only
// carries the other player's clanId, not a resolvable tag/name, and
// showing a raw id wouldn't mean anything to whoever's looking.
export function _renderOtherProfileEntry(game, entry, fallbackName) {
  game.otherProfileLoading.style.display = 'none'
  if (!entry) {
    game.otherProfileNone.style.display = 'block'
    return
  }
  game.otherProfileName.textContent = entry.name || fallbackName || '???'
  // Notes needs a stable key to save under - no playerId, no Notes
  // section (matches _showOtherProfileLoading's own default-hidden
  // state, just never un-hidden in game rare case).
  game._otherProfileCurrentPlayerId = entry.playerId || null
  if (entry.playerId) {
    game._otherProfileIdText = `#${entry.playerId}`
    game.otherProfileId.textContent = game._otherProfileIdText
  }
  game.otherProfileBestNightValue.textContent = _safeStatNumber(entry.bestNight)
  game.otherProfileBestKillsValue.textContent = _safeStatNumber(entry.bestKills)
  game.otherProfileBestStreakValue.textContent = _safeStatNumber(entry.bestKillStreak)
  game.otherProfileAchievementsValue.textContent = _safeStatNumber(entry.achievementCount)
  // Same enum keys the region <select> and _renderPublicProfileSection
  // already use - no new i18n keys needed.
  const REGION_LABEL_KEYS = { na: 'optRegionNa', eu: 'optRegionEu', asia: 'optRegionAsia', sa: 'optRegionSa', oceania: 'optRegionOceania', africa: 'optRegionAfrica' }
  const regionKey = REGION_LABEL_KEYS[entry.region]
  if (game.otherProfileRegionRow) game.otherProfileRegionRow.style.display = regionKey ? 'flex' : 'none'
  if (regionKey && game.otherProfileRegionValue) game.otherProfileRegionValue.textContent = t(regionKey)
  game._renderOtherProfilePublicFields(entry)
  game.otherProfileStats.style.display = 'block'
}

// The read side of moving Bio/Motto/Your Stats to Shown to Public (see
// _pushOnlineStats' own comment on the write side) - every field here
// is raw/structured (never pre-rendered text) coming off the fetched
// leaderboard entry, formatted/translated through the VIEWER's own t(),
// same as _updateBestStatsDisplay does for the profile owner's own
// view. Every field is optional (an old doc synced before this shipped
// won't have any of them) - each row/line hides itself rather than
// showing a misleading "0"/"--" when its source field is just absent.
export function _renderOtherProfilePublicFields(game, entry) {
  if (game.otherProfileTotalKillsValue) {
    const kd = (_safeStatNumber(entry.totalKills) / Math.max(1, _safeStatNumber(entry.totalDeaths))).toFixed(1)
    game.otherProfileTotalKillsValue.textContent = `${_safeStatNumber(entry.totalKills)} (K/D ${kd})`
  }
  if (game.otherProfileRunsPlayedValue) {
    const hours = (_safeStatNumber(entry.lifetimePlaytimeSeconds) / 3600).toFixed(1)
    game.otherProfileRunsPlayedValue.textContent = `${_safeStatNumber(entry.totalRuns)} · ${hours}h played`
  }
  if (game.otherProfileLongestSurvivalValue) {
    game.otherProfileLongestSurvivalValue.textContent = entry.longestSurvivalMs ? formatTime(_safeStatNumber(entry.longestSurvivalMs)) : '--'
  }
  if (game.otherProfileLastRunValue) {
    game.otherProfileLastRunValue.textContent = ('lastRunNight' in entry)
      ? t(entry.lastRunSurvived ? 'runHistorySurvived' : 'runHistoryDied', { night: _safeStatNumber(entry.lastRunNight), kills: _safeStatNumber(entry.lastRunKills), coins: _safeStatNumber(entry.lastRunCoins) })
      : '--'
  }
  if (game.otherProfileAnniversaryLine) {
    if (entry.firstPlayedDate) {
      const days = Math.max(0, Math.round((new Date(todayDateString()) - new Date(entry.firstPlayedDate)) / 86400000))
      game.otherProfileAnniversaryLine.textContent = t('otherProfileAnniversaryLine', { n: days })
      game.otherProfileAnniversaryLine.style.display = ''
    } else {
      game.otherProfileAnniversaryLine.style.display = 'none'
    }
  }
  if (game.otherProfileTodayLine) {
    if ('todayKills' in entry) {
      game.otherProfileTodayLine.textContent = t('todayLine', { kills: _safeStatNumber(entry.todayKills), minutes: _safeStatNumber(entry.todayMinutes) })
      game.otherProfileTodayLine.style.display = ''
    } else {
      game.otherProfileTodayLine.style.display = 'none'
    }
  }
  if (game.otherProfileFavoriteDifficultyLine) {
    if (entry.favoriteDifficulty) {
      const btn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === entry.favoriteDifficulty)
      game.otherProfileFavoriteDifficultyLine.textContent = t('favoriteDifficultyLine', { difficulty: btn ? btn.textContent : entry.favoriteDifficulty })
      game.otherProfileFavoriteDifficultyLine.style.display = ''
    } else {
      game.otherProfileFavoriteDifficultyLine.style.display = 'none'
    }
  }
  if (game.otherProfileBestRunCard) {
    if ('bestRunNight' in entry) {
      if (game.otherProfileBestRunTitle) game.otherProfileBestRunTitle.textContent = t('profileBestRunTitle')
      const diffBtn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === entry.bestRunDifficulty)
      game.otherProfileBestRunLine.textContent = t('profileBestRunLine', {
        night: _safeStatNumber(entry.bestRunNight),
        kills: _safeStatNumber(entry.bestRunKills),
        coins: _safeStatNumber(entry.bestRunCoins),
        difficulty: diffBtn ? diffBtn.textContent : (entry.bestRunDifficulty || '?'),
      })
      game.otherProfileBestRunCard.style.display = ''
    } else {
      game.otherProfileBestRunCard.style.display = 'none'
    }
  }
  if (game.otherProfileCreatedLine) {
    if (entry.accountCreatedAt) {
      const elapsedMs = Math.max(0, Date.now() - _safeStatNumber(entry.accountCreatedAt))
      const totalSeconds = Math.floor(elapsedMs / 1000)
      const days = Math.floor(totalSeconds / 86400)
      const hours = Math.floor((totalSeconds % 86400) / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      game.otherProfileCreatedLine.textContent = t('profileCreatedLine', { days, hours, minutes, seconds })
      game.otherProfileCreatedLine.style.display = ''
    } else {
      game.otherProfileCreatedLine.style.display = 'none'
    }
  }
  if (game.otherProfileBioMotto) {
    // .trim() before checking .length - a whitespace-only bio (e.g. a
    // single stray space) used to count as "has a bio" and render as an
    // empty-looking box (real report, 2026-09-22 - same class of bug as
    // the untrimmed-nickname fix from the same day).
    const bioTrimmed = typeof entry.bio === 'string' ? entry.bio.trim() : ''
    const hasBio = bioTrimmed.length > 0
    // Bio always shows now (real text, or a "game user has no bio"
    // fallback) instead of hiding the whole Bio/Motto/Notes column
    // whenever neither was set - Notes below needs to be reachable
    // even for a player with nothing else here, and an always-present
    // Bio row reads better than the column silently vanishing.
    if (game.otherProfileBioHeading) {
      game.otherProfileBioHeading.textContent = t('profileBioHeading')
      game.otherProfileBioHeading.style.display = ''
    }
    // .textContent, not innerHTML - bio/motto are untrusted freeform
    // text from another player's own doc, same "every persisted stat
    // is untrusted" rule as everywhere else in game file (see
    // CLAUDE.md's own recurring-bug-class note on game).
    if (game.otherProfileBioText) {
      game.otherProfileBioText.textContent = hasBio ? bioTrimmed : t('otherProfileNoBio')
      game.otherProfileBioText.style.display = ''
    }
    // Notes - private, local-only, keyed by game player's playerId (see
    // _otherProfileCurrentPlayerId, set right before game function runs).
    // Only shown at all when there's actually a playerId to key by.
    const notesAvailable = !!game._otherProfileCurrentPlayerId
    if (game.otherProfileNotesHeading) {
      game.otherProfileNotesHeading.textContent = t('otherProfileNotesHeading')
      game.otherProfileNotesHeading.style.display = notesAvailable ? '' : 'none'
    }
    if (game.otherProfileNotesHint) {
      game.otherProfileNotesHint.textContent = t('otherProfileNotesHint')
      game.otherProfileNotesHint.style.display = notesAvailable ? '' : 'none'
    }
    if (game.otherProfileNotesInput) {
      game.otherProfileNotesInput.placeholder = t('otherProfileNotesPlaceholder')
      game.otherProfileNotesInput.style.display = notesAvailable ? '' : 'none'
      game.otherProfileNotesInput.value = notesAvailable ? (game.settings.playerNotes[game._otherProfileCurrentPlayerId] || '') : ''
    }
    game.otherProfileBioMotto.style.display = ''
  }
}

export function _closeOtherPlayerProfile(game) {
  if (game.otherProfilePanel) game.otherProfilePanel.style.display = 'none'
}

// Fetches each friend's live status (see _computeFriendStatus) by their
// stored uid - index-paired with the rows _renderSavedFriends just built
// rather than re-querying by a data-uid attribute selector, simplest way
// to avoid needing to escape uid for use in a CSS selector. A friend
// saved before this presence system existed has uid: null (see
// loadSettings' savedFriends normalizer) and is skipped, staying at the
// default "Offline" the row already renders.
export async function _fetchFriendPresences(game, friends) {
  if (!CloudSync.isConfigured() || !game.cloudsaveSavedFriends) return
  const rows = game.cloudsaveSavedFriends.querySelectorAll('.saved-friend-row')
  if (!game._lastFriendStatuses) game._lastFriendStatuses = {}
  let learnedIds = false
  await Promise.all(friends.map(async (f, i) => {
    if (!f.uid) return
    // Friends added before IDs were shown get theirs looked up once.
    if (!f.playerId) {
      try {
        const entry = await CloudSync.fetchLeaderboardEntryByUid(f.uid)
        if (entry && typeof entry.playerId === 'string') {
          f.playerId = entry.playerId
          learnedIds = true
          const nameEl = rows[i]?.querySelector('.friend-name')
          if (nameEl) nameEl.innerHTML = `${_escapeHtml(f.name)} <span class="friend-id">#${_escapeHtml(f.playerId)}</span>`
        }
      } catch {
        // Best-effort - the row just shows no ID.
      }
    }
    try {
      const presence = await CloudSync.fetchPresence(f.uid)
      const status = game._computeFriendStatus(presence)
      // Friend Online/Offline Alerts (General tab) - fires only on an
      // actual offline->online transition (not idle/dnd shuffling, and
      // not the very first read game session, which would otherwise
      // fire once for every already-online friend the moment the panel
      // opens - _lastFriendStatuses starting undefined for a uid is
      // exactly that "first read" case).
      const prevStatus = game._lastFriendStatuses[f.uid]
      if (game.settings.friendPresenceNotify && prevStatus === 'offline' && status !== 'offline') {
        game._showHomepageToast(t('friendCameOnlineToast', { name: f.name || t('friendStatusOnline') }))
      }
      game._lastFriendStatuses[f.uid] = status
      const row = rows[i]
      if (!row) return
      row.querySelector('.friend-status-dot').dataset.status = status
      const label = row.querySelector('.friend-status-label')
      // Offline shows how long ago they were last seen instead of a bare
      // "Offline" - falls back to the plain label if we never got a
      // timestamp at all (e.g. they've never synced).
      label.textContent = status === 'offline' && presence && presence.lastActiveAt
        ? t('friendStatusOfflineAgo', {
          time: game.settings.exactLastSeen
            ? new Date(presence.lastActiveAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', hour12: game.settings.timeFormat === '12h' })
            : _formatRelativeTime(Date.now() - presence.lastActiveAt),
        })
        : t(FRIEND_STATUS_LABEL_KEYS[status])
    } catch {
      // Best-effort - stays "Offline" default on a failed read.
    }
  }))
  if (learnedIds) saveSettings(game.settings)
}

// Online: heartbeat seen in the last 2 min. Idle: seen more than 2 but
// less than 5 min ago. Offline: no heartbeat at all, or older than 5 min
// (this wins over Do Not Disturb even if that flag is still set from
// their last active session - a friend who's actually gone offline
// shouldn't show as "busy," they should show as gone).
export function _computeFriendStatus(_game, presence) {
  if (!presence || !presence.lastActiveAt) return 'offline'
  const elapsed = Date.now() - presence.lastActiveAt
  if (elapsed > FRIEND_OFFLINE_THRESHOLD_MS) return 'offline'
  if (presence.doNotDisturb) return 'dnd'
  if (presence.manualIdle) return 'idle'
  return elapsed < FRIEND_ONLINE_THRESHOLD_MS ? 'online' : 'idle'
}

// Send Friend Request - by the recipient's stable random playerId (see
// CloudSync.fetchLeaderboardEntryByPlayerId), or by name (2026-10-10):
// typing shows a list of players whose name starts with it
// (_searchFriendNames), and Add Friend with a name sends straight away
// when exactly one player has that name, otherwise opens the list to pick
// from. Requires being signed in, same gate the rest of this panel has.
// The saved friend matching a player by account, #ID or (case-insensitive)
// name - older entries may only have a name.
export function _findSavedFriend(game, { uid, playerId, name } = {}) {
  const id = playerId ? String(playerId).toUpperCase() : ''
  const lower = name ? String(name).toLowerCase() : ''
  return game.settings.savedFriends.find((f) =>
    (uid && f.uid === uid) ||
    (id && f.playerId && String(f.playerId).toUpperCase() === id) ||
    (lower && f.name && String(f.name).toLowerCase() === lower)) || null
}

export async function _sendFriendRequestClick(game) {
  if (!game.cloudsaveFriendInput || !game.cloudsaveFriendResult || !game._cloudUid) return
  const text = game.cloudsaveFriendInput.value.trim().replace(/^#/, '')
  if (!text) return
  const id = text.toUpperCase()
  if (id === game.settings.playerId) {
    game.cloudsaveFriendResult.textContent = t('friendRequestSelfError')
    return
  }
  // Typing a friend's #ID or name says they're already your friend
  // straight away (2026-10-10).
  const known = game._findSavedFriend({ playerId: id, name: text })
  if (known) {
    game.cloudsaveFriendResult.textContent = t('friendAlreadyFriend', { name: known.name || known.playerId || text })
    return
  }
  game.cloudsaveFriendResult.textContent = t('cloudsaveConnecting')
  try {
    const entry = await CloudSync.fetchLeaderboardEntryByPlayerId(id)
    if (entry && entry.uid) {
      await game._sendFriendRequestTo(entry)
      return
    }
    const matches = await game._searchFriendNames(text)
    const exact = matches.filter((m) => String(m.name || '').toLowerCase() === text.toLowerCase())
    if (exact.length === 1) await game._sendFriendRequestTo(exact[0])
    else if (matches.length) game.cloudsaveFriendResult.textContent = t('friendSearchPick')
    else game.cloudsaveFriendResult.textContent = t('cloudsaveFriendNotFound')
  } catch {
    game.cloudsaveFriendResult.textContent = t('cloudsaveError')
  }
}

export async function _sendFriendRequestTo(game, entry) {
  if (!entry?.uid || !game._cloudUid) return
  if (entry.uid === game._cloudUid) {
    game.cloudsaveFriendResult.textContent = t('friendRequestSelfError')
    return
  }
  game._showFriendSuggestions([])
  const name = entry.name || entry.playerId || ''
  if (game._findSavedFriend(entry)) {
    game.cloudsaveFriendResult.textContent = t('friendAlreadyFriend', { name })
    return
  }
  try {
    // The rules allow 1-16 characters (create-only, see friendRequests in
    // FIRESTORE_SECURITY_RULES).
    const from = String(game.settings.nickname || 'Player').slice(0, 16)
    await CloudSync.sendFriendRequest(entry.uid, game._cloudUid, from)
  } catch (e) {
    // A request is create-only: sending one again while the first is
    // still waiting is refused. Say so instead of "Cloud Save ran into a
    // problem" (2026-10-10 report).
    if (e?.code === 'permission-denied') {
      game.cloudsaveFriendResult.textContent = t('friendRequestAlreadySent', { name })
      return
    }
    throw e
  }
  game.cloudsaveFriendResult.textContent = t('friendRequestSent', { name })
}

// Players whose name starts with the typed text, shown as a pick list
// under the box (name + #ID, yourself left out). Returns the matches.
export async function _searchFriendNames(game, text) {
  const matches = await game._searchPlayerNames(text, 'friend')
  if (matches !== null) game._showFriendSuggestions(matches)
  return matches || []
}

// The name search behind Add a Friend and the clan invite: [] for text
// too short to search, null when a newer search (same `who`) has started.
export async function _searchPlayerNames(game, text, who) {
  const query = String(text || '').trim().replace(/^#/, '')
  const seqs = game._nameSearchSeq || (game._nameSearchSeq = {})
  const seq = (seqs[who] = (seqs[who] || 0) + 1)
  if (query.length < 2 || !game._cloudUid) return []
  let matches
  try {
    matches = (await CloudSync.searchLeaderboardByName(query)).filter((m) => m.uid !== game._cloudUid && m.name)
  } catch {
    matches = []
  }
  // A newer keystroke's search wins.
  if (seq !== seqs[who]) return null
  matches.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return matches
}

export function _showFriendSuggestions(game, list) {
  const box = game.cloudsaveFriendSuggestions
  if (!box) return
  game._friendSuggestions = list
  box.innerHTML = list.map((m, i) => `
    <button type="button" class="friend-suggest-row" data-index="${i}" role="option">
      <span class="friend-suggest-name">${_escapeHtml(m.name)}</span>
      ${typeof m.playerId === 'string' ? `<span class="friend-id">#${_escapeHtml(m.playerId)}</span>` : ''}
    </button>`).join('')
  box.classList.toggle('open', list.length > 0)
}

// Incoming Friend Requests - _incomingFriendRequests is kept live by the
// subscribeIncomingFriendRequests listener started in restoreCloudSession
// (CloudSaveUI.js), so this is just a render of already-current state,
// not a fetch of its own.
export function _renderFriendRequests(game) {
  if (!game.friendRequestsList) return
  if (game.friendRequestsHeading) game.friendRequestsHeading.textContent = t('friendRequestsHeading')
  const requests = game._incomingFriendRequests
  if (game.friendRequestsCount) game.friendRequestsCount.textContent = t('friendRequestsCount', { n: requests.length })
  if (game.deleteAllRequestsBtn) {
    game.deleteAllRequestsBtn.textContent = t('deleteAllRequestsBtn')
    game.deleteAllRequestsBtn.style.display = requests.length ? '' : 'none'
  }
  game.friendRequestsList.innerHTML = requests.length
    ? requests.map((r) => `
        <div class="friend-request-row" data-from-uid="${_escapeHtml(r.fromUid)}">
          <span>${_escapeHtml(r.fromNickname || '???')}</span>
          <span>
            <button class="mini-action-btn friend-request-accept" data-from-uid="${_escapeHtml(r.fromUid)}" data-from-name="${_escapeHtml(r.fromNickname || '')}" type="button">${t('friendRequestAccept')}</button>
            <button class="mini-action-btn friend-request-decline" data-from-uid="${_escapeHtml(r.fromUid)}" type="button">${t('friendRequestDecline')}</button>
          </span>
        </div>
      `).join('')
    : `<p class="nearly-there-line">${t('friendRequestNone')}</p>`
  for (const btn of game.friendRequestsList.querySelectorAll('.friend-request-accept')) {
    btn.addEventListener('click', () => game._respondToFriendRequest(btn.dataset.fromUid, btn.dataset.fromName, true))
  }
  for (const btn of game.friendRequestsList.querySelectorAll('.friend-request-decline')) {
    btn.addEventListener('click', () => game._respondToFriendRequest(btn.dataset.fromUid, null, false))
  }
}

export async function _respondToFriendRequest(game, fromUid, fromNickname, accept) {
  if (!game._cloudUid) return
  if (accept && fromNickname && !game.settings.savedFriends.some((f) => f.uid === fromUid)) {
    game.settings.savedFriends.push({ name: fromNickname, uid: fromUid })
    saveSettings(game.settings)
    game._renderSavedFriends()
  }
  try {
    await CloudSync.respondToFriendRequest(game._cloudUid, fromUid)
    // Lets the ORIGINAL SENDER find out their request was accepted even
    // if they're not online right now (see CloudSync.notifyFriendAccepted)
    // - only on accept, a decline stays silent same as before.
    if (accept) await CloudSync.notifyFriendAccepted(fromUid, game._cloudUid)
  } catch {
    // Best-effort - the live subscription will resync the list either
    // way the next time it fires.
  }
}

export async function _deleteAllFriendRequests(game) {
  if (!game._cloudUid || !game._incomingFriendRequests.length) return
  try {
    await Promise.all(game._incomingFriendRequests.map((r) => CloudSync.respondToFriendRequest(game._cloudUid, r.fromUid)))
  } catch {
    // Best-effort - same reasoning as _respondToFriendRequest above.
  }
}

export function _updateFriendsDot(game) {
  if (!game.friendsRequestDot) return
  game.friendsRequestDot.style.display = game._incomingFriendRequests.length ? '' : 'none'
}

// Friends nav dot - gold, lights up if someone accepted a friend request
// you sent them (see CloudSync.notifyFriendAccepted/fetchAcceptedNotifications).
// A one-off fetch (not a live subscription like incoming requests) run
// alongside the other homepage nav dots, not on its own timer.
export async function _checkFriendAcceptedNotifications(game) {
  if (!game._cloudUid || !CloudSync.isConfigured() || !game.friendsAcceptedDot) return
  try {
    game._friendAcceptedNotifications = await CloudSync.fetchAcceptedNotifications(game._cloudUid)
  } catch {
    return // Best-effort - leaves the dot at whatever it last showed.
  }
  game.friendsAcceptedDot.style.display = game._friendAcceptedNotifications.length ? '' : 'none'
}

// Clears every accepted-notification doc once the player has opened
// Friends to see it - mirrors the other panels' _markXSeen pattern,
// just against Firestore docs instead of a localStorage seen-id set.
export async function _markFriendAcceptedSeen(game) {
  if (!game._cloudUid || !game._friendAcceptedNotifications.length) return
  const notifications = game._friendAcceptedNotifications
  game._friendAcceptedNotifications = []
  if (game.friendsAcceptedDot) game.friendsAcceptedDot.style.display = 'none'
  try {
    await Promise.all(notifications.map((n) => CloudSync.clearAcceptedNotification(game._cloudUid, n.accepterUid)))
  } catch {
    // Best-effort - a leftover doc just gets re-fetched (and re-cleared)
    // next time the dot check runs.
  }
}

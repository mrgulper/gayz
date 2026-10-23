// Online features on the homepage: leaderboards (top, weekly, achievements,
// nearby, rival, global rank and averages), the global kill counter, the poll,
// pushing this player's stats online, and signing in to Google (Cloud Save's
// restore-on-sign-in, newer-save checks, storage usage).
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as CloudSaveUI from './CloudSaveUI.js'
import * as CloudSync from './CloudSync.js'
import { CLOUD_BASE_UID_KEY, readBase } from './CloudMerge.js'
import { ACHIEVEMENTS } from './Achievements.js'
import { GLOBAL_KILLS_MILESTONE_STEP, PODIUM_MEDALS, POLL_ID, POLL_OPTIONS, _escapeHtml, _safeStatNumber, _thisWeekStr, saveShopProgress } from './Game.js'
import { t } from './i18n.js'
import { clanMonthKey, currentClanXp } from './Xp.js'

// Cloud Save panel open/close - a normal modal, same shared z-index/
// display:flex rule every other panel uses.
// Online Features - global leaderboard, weekly-challenge ranking, friend
// comparison, global kill counter, community poll. All read-only fetches
// here (writes happen once per run in _pushOnlineStats, not on every
// panel open) - best-effort, a failed fetch just leaves that section
// showing its previous/empty state rather than blocking the rest of the
// panel.
export async function _renderCloudOnlineSection(game) {
  if (!game.cloudsaveOnlineSection || !CloudSync.isConfigured()) return
  game._renderGlobalKills()
  game._renderMyRank()
  game._renderRival()
  game._renderNearbyRank()
  game._renderGlobalAverages()
  game._subscribeLeaderboard()
  game._renderAchievementsLeaderboard()
  game._renderWeeklyLeaderboardList()
  game._renderPoll()
  game._renderSavedFriends()
  if (game.sendFriendRequestBtn) game.sendFriendRequestBtn.textContent = t('sendFriendRequestBtn')
  if (game.cloudsaveFriendInput) game.cloudsaveFriendInput.placeholder = t('cloudsaveFriendPlaceholder')
  if (game.cloudsaveLeaderboardTitle) game.cloudsaveLeaderboardTitle.textContent = t('cloudsaveLeaderboardTitle')
  if (game.cloudsaveAchievementsLeaderboardTitle) game.cloudsaveAchievementsLeaderboardTitle.textContent = t('cloudsaveAchievementsLeaderboardTitle')
  if (game.cloudsaveFriendTitle) game.cloudsaveFriendTitle.textContent = t('cloudsaveFriendTitle')
  if (game.addFriendHeading) game.addFriendHeading.textContent = t('addFriendHeading')
  if (game.cloudsaveRegionSelect) game.cloudsaveRegionSelect.value = game.settings.region
}

// Global rank badge - also mirrored onto the homepage player tag (see
// _updateBestStatsDisplay) once fetched, so signing in and opening this
// panel is what refreshes that homepage line rather than a live
// subscription (a rank that's a few minutes stale is fine for this).
export async function _renderMyRank(game) {
  if (!game.cloudsaveRankLine) return
  try {
    const newRank = await CloudSync.fetchMyGlobalRank(_safeStatNumber(game.bestStats.bestWave))
    // Leaderboard Rank Change Alerts (General tab) - only a real
    // improvement (lower rank number), not the first fetch game
    // session, and not a worsening (someone else beating your old
    // score isn't something to nag about here).
    if (game.settings.leaderboardRankAlerts && game._cloudGlobalRank !== undefined && newRank < game._cloudGlobalRank) {
      game._showHomepageToast(t('leaderboardRankUpToast', { rank: newRank }))
    }
    game._cloudGlobalRank = newRank
    game.cloudsaveRankLine.textContent = t('cloudsaveRankLine', { rank: game._cloudGlobalRank })
    if (game.menuPlayerTag) game._renderPlayerTag()
  } catch {
    game.cloudsaveRankLine.textContent = ''
  }
}

export async function _renderRival(game) {
  if (!game.cloudsaveRivalLine) return
  try {
    const rival = await CloudSync.fetchNearestRivalAbove(_safeStatNumber(game.bestStats.bestWave))
    if (!rival) {
      game.cloudsaveRivalLine.textContent = t('cloudsaveRivalNone')
      return
    }
    const gap = _safeStatNumber(rival.bestNight) - _safeStatNumber(game.bestStats.bestWave)
    game.cloudsaveRivalLine.textContent = t('cloudsaveRivalLine', { n: gap, name: rival.name || '???' })
    // Urgent variant - a toast (not just the panel text above) when the
    // gap is genuinely small, once per session per rival name so it
    // doesn't refire every time the Cloud Save panel happens to open.
    if (gap <= 2 && game._urgentRivalToastedFor !== rival.name) {
      game._urgentRivalToastedFor = rival.name
      game._showHomepageToast(t('urgentRivalToast', { name: rival.name || '???', n: gap }))
    }
  } catch {
    game.cloudsaveRivalLine.textContent = ''
  }
}

// Nearby Rank mini-leaderboard - 3 entries above you, 3 below (see
// CloudSync.fetchNearbyRank), reversing "above" so the combined list
// reads highest-to-lowest, same order as the main leaderboard.
export async function _renderNearbyRank(game) {
  if (!game.cloudsaveNearbyRankList) return
  if (game.cloudsaveNearbyRankTitle) game.cloudsaveNearbyRankTitle.textContent = t('cloudsaveNearbyRankTitle')
  try {
    const { above, below } = await CloudSync.fetchNearbyRank(_safeStatNumber(game.bestStats.bestWave), 3)
    const mine = { name: game.settings.nickname || t('menuPlayerTagDefault'), bestNight: game.bestStats.bestWave, bestKills: game.careerStats.totalKills, __me: true }
    const combined = [...above.reverse(), mine, ...below]
    game.cloudsaveNearbyRankList.innerHTML = combined.map((r) => `
      <div class="cloud-leaderboard-row${r.__me ? ' me' : ''}"><span>${_escapeHtml(r.name || '???')}</span><span>${t('cloudsaveLeaderboardRow', { night: _safeStatNumber(r.bestNight), kills: _safeStatNumber(r.bestKills) })}</span></div>
    `).join('')
  } catch {
    game.cloudsaveNearbyRankList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
  }
}

export async function _renderGlobalKills(game) {
  if (!game.cloudsaveGlobalKills) return
  try {
    const total = await CloudSync.fetchGlobalKills()
    game.cloudsaveGlobalKills.textContent = total === null ? '' : t('cloudsaveGlobalKillsLine', { n: total.toLocaleString() })
    // Server-wide milestone bulletin - a one-time homepage toast the
    // first time game session's fetch sees the global total past a
    // round 100k mark, rather than a permanent new homepage line (game
    // menu's own zero-scroll height budget is a real, easy thing to
    // break - see the menu-redesign notes - so a toast is the safer
    // way to surface game).
    if (total !== null) {
      const milestone = Math.floor(total / GLOBAL_KILLS_MILESTONE_STEP) * GLOBAL_KILLS_MILESTONE_STEP
      if (milestone > 0 && game._globalKillsMilestoneToastedFor !== milestone) {
        game._globalKillsMilestoneToastedFor = milestone
        game._showHomepageToast(t('globalKillsMilestoneToast', { n: milestone.toLocaleString() }))
      }
    }
  } catch {
    game.cloudsaveGlobalKills.textContent = ''
  }
}

export function _renderLeaderboardRows(game, rows) {
  if (!game.cloudsaveLeaderboardList) return
  // rows is `null` on a subscription error (see CloudSync.subscribeTopLeaderboard's
  // own comment) - distinct from a real empty array, which just means no
  // entries yet. Without game check an error left the "Connecting..."
  // placeholder _subscribeLeaderboard sets up on open showing forever,
  // most commonly hit by the region filter (a region + bestNight compound
  // query needs a Firestore index game project never had created).
  if (rows === null) {
    game.cloudsaveLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
    return
  }
  // Podium styling (ranks 1-3) - PODIUM_MEDALS below, same treatment
  // _renderWeeklyLeaderboardList uses.
  game.cloudsaveLeaderboardList.innerHTML = rows.length
    ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === game.settings.nickname ? ' me' : ''}${i < 3 ? ` podium-${i + 1}` : ''}"><span>${PODIUM_MEDALS[i] || `${i + 1}.`} ${_escapeHtml(r.name || '???')}</span><span>${t('cloudsaveLeaderboardRow', { night: _safeStatNumber(r.bestNight), kills: _safeStatNumber(r.bestKills) })}</span></div>`).join('')
    : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
}

// Live-subscribed (see CloudSync.subscribeTopLeaderboard) rather than a
// one-shot fetch - only while this panel is actually open (subscribed
// here, unsubscribed when it closes or you sign out) so
// the read cost stays bounded to "panel is visible," not indefinite.
// Re-subscribes with the new filter whenever the region select changes.
export function _subscribeLeaderboard(game) {
  if (!game.cloudsaveLeaderboardList) return
  if (game._leaderboardUnsubscribe) game._leaderboardUnsubscribe()
  game.cloudsaveLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveConnecting')}</p>`
  game._leaderboardUnsubscribe = CloudSync.subscribeTopLeaderboard(10, game.settings.region, (rows) => game._renderLeaderboardRows(rows))
}

export async function _renderAchievementsLeaderboard(game) {
  if (!game.cloudsaveAchievementsLeaderboardList) return
  try {
    const rows = await CloudSync.fetchTopByAchievements(10)
    game.cloudsaveAchievementsLeaderboardList.innerHTML = rows.length
      ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === game.settings.nickname ? ' me' : ''}"><span>${i + 1}. ${_escapeHtml(r.name || '???')}</span><span>${_safeStatNumber(r.achievementCount)}/${ACHIEVEMENTS.length}</span></div>`).join('')
      : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
  } catch {
    game.cloudsaveAchievementsLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
  }
}

export async function _renderGlobalAverages(game) {
  if (!game.cloudsaveAvgLine) return
  try {
    const { avgKills, avgNight } = await CloudSync.fetchGlobalAverages()
    const myKills = _safeStatNumber(game.careerStats.totalKills)
    const myNight = _safeStatNumber(game.bestStats.bestWave)
    game.cloudsaveAvgLine.textContent = t('cloudsaveAvgLine', {
      myKills, avgKills: Math.round(avgKills), myNight, avgNight: avgNight.toFixed(1),
    })
    // Bar-chart visual (see #cloudsave-avg-bars) - same numbers the text
    // line above already computed, just also drawn as two you-vs-average
    // bars scaled to whichever side of each pair is larger.
    if (game.cloudsaveAvgBars) {
      const killsMax = Math.max(myKills, avgKills, 1)
      game.cloudsaveAvgBars.innerHTML = `
        <div class="avg-bar-row"><span class="avg-bar-label">${t('avgBarYou')}</span><div class="mini-progress-track"><div class="mini-progress-fill" style="width: ${(myKills / killsMax) * 100}%"></div></div><span class="avg-bar-value">${myKills.toLocaleString()}</span></div>
        <div class="avg-bar-row"><span class="avg-bar-label">${t('avgBarAverage')}</span><div class="mini-progress-track"><div class="mini-progress-fill" style="width: ${(avgKills / killsMax) * 100}%"></div></div><span class="avg-bar-value">${Math.round(avgKills).toLocaleString()}</span></div>
      `
    }
  } catch {
    game.cloudsaveAvgLine.textContent = ''
    if (game.cloudsaveAvgBars) game.cloudsaveAvgBars.innerHTML = ''
  }
}

// "Most Improved This Week" is just a badge on the #1 entry here, not a
// separate tracked metric - this week's weekly-challenge progress
// already represents "how much you've contributed this week," so the
// top entry IS the most-improved player by that same measure.
export async function _renderWeeklyLeaderboardList(game) {
  if (!game.cloudsaveWeeklyLeaderboardList) return
  if (game.cloudsaveWeeklyLeaderboardTitle) game.cloudsaveWeeklyLeaderboardTitle.textContent = t('cloudsaveWeeklyLeaderboardTitle')
  try {
    const weekStr = _thisWeekStr()
    const rows = await CloudSync.fetchTopWeeklyLeaderboard(weekStr, 10)
    game.cloudsaveWeeklyLeaderboardList.innerHTML = rows.length
      ? rows.map((r, i) => `<div class="cloud-leaderboard-row${r.name === game.settings.nickname ? ' me' : ''}${i < 3 ? ` podium-${i + 1}` : ''}"><span>${PODIUM_MEDALS[i] || `${i + 1}.`} ${_escapeHtml(r.name || '???')}${i === 0 ? ` ${t('mostImprovedBadge')}` : ''}</span><span>${_safeStatNumber(r.progress)}</span></div>`).join('')
      : `<p class="cloud-leaderboard-empty">${t('cloudsaveLeaderboardEmpty')}</p>`
  } catch {
    game.cloudsaveWeeklyLeaderboardList.innerHTML = `<p class="cloud-leaderboard-empty">${t('cloudsaveError')}</p>`
  }
}

// Community Poll - renders each option as a bar showing its live vote
// share; once this account has voted (existing vote checked on render),
// every option becomes non-interactive so a vote can't be changed
// (matches the create-only security rule, which would reject a second
// vote from the server side anyway - this just avoids the round trip).
export async function _renderPoll(game) {
  if (!game.cloudsavePollOptions || !game._cloudUid) return
  game.cloudsavePollTitle.textContent = t('pollQuestionNextFeature')
  try {
    const [myVote, counts] = await Promise.all([
      CloudSync.fetchMyPollVote(POLL_ID, game._cloudUid),
      CloudSync.fetchPollResults(POLL_ID, POLL_OPTIONS.map((o) => o.id)),
    ])
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    game.cloudsavePollOptions.innerHTML = POLL_OPTIONS.map((o) => {
      const n = counts[o.id] || 0
      const pct = total > 0 ? Math.round((n / total) * 100) : 0
      const voted = myVote === o.id
      return `<button type="button" class="poll-option-btn${voted ? ' voted' : ''}" data-option="${o.id}" style="--poll-pct: ${myVote ? pct : 0}%">
        <span class="poll-option-label">${voted ? '✓ ' : ''}${_escapeHtml(t(o.labelKey))}</span>
        <span class="poll-option-pct">${myVote ? `${pct}%` : ''}</span>
      </button>`
    }).join('')
    game.cloudsavePollHint.textContent = myVote ? t('pollVotedHint', { n: total }) : t('pollNotVotedHint')
    if (!myVote) {
      for (const btn of game.cloudsavePollOptions.querySelectorAll('.poll-option-btn')) {
        btn.addEventListener('click', () => game._castVote(btn.dataset.option))
      }
    }
  } catch {
    game.cloudsavePollOptions.innerHTML = ''
    game.cloudsavePollHint.textContent = t('cloudsaveError')
  }
}

export async function _castVote(game, option) {
  if (!game._cloudUid) return
  try {
    await CloudSync.castPollVote(POLL_ID, game._cloudUid, option)
    game._renderPoll()
  } catch {
    game._showLoreToast(t('cloudsaveError'))
  }
}

// Pushed once per completed run (see _recordRunEnd), alongside the save
// sync - separate Firestore writes (leaderboard/weekly/global-kills) so
// a failure in one doesn't block the others, all best-effort/silent
// like the save push itself.
export async function _pushOnlineStats(game) {
  if (!game._cloudUid || !CloudSync.isConfigured()) return
  // Anonymous Mode (General tab) - only swaps the displayed name; every
  // other field (playerId, stats) still writes normally, so Friend
  // Compare/lookup-by-ID keeps working even while anonymous on the
  // public leaderboard itself.
  const name = game.settings.anonymousLeaderboard ? t('anonymousLeaderboardName') : (game.settings.nickname || t('menuPlayerTagDefault'))
  const entry = {
    name,
    bestNight: _safeStatNumber(game.bestStats.bestWave),
    bestKills: _safeStatNumber(game.bestStats.bestKills),
    bestKillStreak: _safeStatNumber(game.bestStats.bestKillStreak),
    achievementCount: game.achievements.unlocked.size,
    // Synced so Add Friend can look someone up by their stable random ID
    // instead of their (changeable, non-unique) nickname - see
    // CloudSync.fetchLeaderboardEntryByPlayerId.
    playerId: game.settings.playerId,
    // Career-rank source of truth (see CAREER_RANK_TITLES, Game.js ~1208)
    // wasn't previously exposed to the public leaderboard doc at all -
    // added so external readers (the Discord bot's rank-role feature)
    // can compute the same Rookie/Survivor/Veteran/Elite/Legend tier the
    // game itself shows, instead of reinventing a second rank scale.
    // Not covered by FIRESTORE_SECURITY_RULES' explicit per-field checks
    // yet (that rule has no `hasOnly()`, so an unlisted field isn't
    // rejected) - fine for a read-only display number with no gameplay
    // effect if spoofed, but add real bounds validation there too if
    // game field ever gates something that matters.
    totalKills: _safeStatNumber(game.careerStats.totalKills),
  }
  // region is omitted entirely when unset ('global' = no preference
  // picked) rather than defaulted to some region - the security rule's
  // own enum check only applies when the field is present at all.
  if (game.settings.region && game.settings.region !== 'global') entry.region = game.settings.region
  // game.settings.clanId is the local membership cache (see
  // _refreshClanUi) - denormalized onto the player's own leaderboard doc
  // so fetchClanCombinedStats can sum a clan's kills/night with one
  // where('clanId', ...) query instead of a per-member fetch.
  if (game.settings.clanId) entry.clanId = game.settings.clanId
  // This month's clan XP (Xp.js) - the clan board adds these up for the
  // members whose clanXpClan/clanXpMonth match the clan and this month,
  // so a new month (or a different clan) counts as 0 without deleting
  // anything.
  if (game.settings.clanId && game.settings.clanXp) {
    entry.clanXp = currentClanXp(game.settings.clanXp, game.settings.clanId)
    entry.clanXpClan = game.settings.clanId
    entry.clanXpMonth = clanMonthKey()
  }
  entry.xp = _safeStatNumber(game.careerStats.xp)
  // Bio/Motto/Your Stats moved from Hidden to Shown to Public
  // (2026-09-22, explicit request) - these fields make that real rather
  // than just relabeling a tab: raw/structured values only (never
  // pre-rendered/translated text), same reasoning as everywhere else in
  // game file - the VIEWING client's own t() formats it in their own
  // language, not the profile owner's. _renderOtherProfileEntry is the
  // read side of game same change.
  entry.bio = (game.settings.bio || '').slice(0, 5000)
  entry.totalDeaths = _safeStatNumber(game.careerStats.totalDeaths)
  entry.totalRuns = _safeStatNumber(game.careerStats.totalRuns)
  entry.lifetimePlaytimeSeconds = _safeStatNumber(game.careerStats.lifetimePlaytimeSeconds)
  entry.longestSurvivalMs = game.bestRunPace ? _safeStatNumber(game.bestRunPace.elapsedMs) : 0
  {
    const diffEntries = Object.entries(game.careerStats.difficultyStats)
    if (diffEntries.length > 0) {
      const [favoriteId] = diffEntries.reduce((best, cur) => (cur[1].runs > best[1].runs ? cur : best))
      entry.favoriteDifficulty = favoriteId
    }
  }
  {
    const last = game.runHistory[0]
    if (last) {
      entry.lastRunSurvived = !!last.survived
      entry.lastRunNight = _safeStatNumber(last.night)
      entry.lastRunKills = _safeStatNumber(last.kills)
      entry.lastRunCoins = _safeStatNumber(last.coins)
    }
  }
  {
    const best = game.runHistory.find((r) => _safeStatNumber(r.night) === _safeStatNumber(game.bestStats.bestWave))
    if (best) {
      entry.bestRunNight = _safeStatNumber(best.night)
      entry.bestRunKills = _safeStatNumber(best.kills)
      entry.bestRunCoins = _safeStatNumber(best.coins)
      if (best.difficulty) entry.bestRunDifficulty = best.difficulty
      if (best.loadout) entry.bestRunLoadout = best.loadout
    }
  }
  if (game.careerStats.firstPlayedDate) entry.firstPlayedDate = game.careerStats.firstPlayedDate
  // Same source/priority _renderProfileCreated uses for the OWN profile's
  // "Created" line - was wrongly hardcoded to careerStats.accountCreatedAt
  // (game device's own first-launch timestamp) here, while the owner's own
  // view prefers the signed-in Google account's real creation date. Real
  // bug (2026-09-22): another player's looked-up profile showed a wildly
  // different "Created X ago" than the owner's own Profile panel did for
  // the exact same account.
  entry.accountCreatedAt = _safeStatNumber((game._cloudProfile && game._cloudProfile.accountCreatedAt) || game.careerStats.accountCreatedAt)
  // "Today" is deliberately session-local/never-persisted everywhere
  // else in game codebase (see _renderTodayLine's own comment) - synced
  // here anyway per explicit request despite that, so it WILL read
  // stale (frozen at whatever it was on the last sync) until game
  // player's next _pushOnlineStats call, unlike every other field above.
  entry.todayKills = _safeStatNumber(game._sessionKills)
  entry.todayMinutes = Math.round((performance.now() - game._sessionStartTime) / 60000)
  CloudSync.pushLeaderboardEntry(game._cloudUid, entry).catch(() => {})
  CloudSync.pushWeeklyLeaderboardEntry(_thisWeekStr(), game._cloudUid, {
    name,
    progress: _safeStatNumber(game.weeklyChallenge.progress),
  }).catch(() => {})
  CloudSync.incrementGlobalKills(_safeStatNumber(game.kills)).catch(() => {})
}

// Popup-based (see CloudSync.signIn's own comment for why the
// redirect version tried 2026-09-15 got reverted the same day: Chrome's
// bounce-tracking mitigation can silently wipe the Firebase auth
// handler's storage mid-redirect, with no error at all - confirmed live
// via a "Chrome may soon delete state for intermediate websites in a
// recent navigation chain" DevTools warning during the actual failure).
// Popup's own known risk (ad blockers/privacy extensions breaking the
// popup<->opener channel) at least surfaces as a real caught error code
// below instead of a silent no-op.
export async function _handleCloudSignIn(game) {
  if (!CloudSync.isConfigured()) {
    game._showLoreToast(t('cloudsaveNotConfigured'))
    return
  }
  if (game.cloudsaveSigninBtn) game.cloudsaveSigninBtn.textContent = t('cloudsaveConnecting')
  try {
    const { uid, profile } = await CloudSync.signIn()
    await game._afterCloudSignIn(uid, profile)
  } catch (err) {
    game._showLoreToast(err && err.code === 'auth/network-request-failed' ? t('cloudsaveNetworkError') : t('cloudsaveError'))
    CloudSaveUI.renderCloudSaveState(game)
  }
}

export async function _afterCloudSignIn(game, uid, profile) {
  // The onAuthChange listener (CloudSync.js) will also fire from
  // game same sign-in and set _cloudProfile/_cloudUid again - setting
  // them here too just means the very next lines (fetchCloudSave)
  // don't have to wait a tick for that callback to run first.
  game._cloudProfile = profile
  game._cloudUid = uid
  CloudSaveUI.updateCloudQuickIcon(game, true)
  CloudSaveUI.renderCloudSaveState(game)
  game._renderProfileAccountRow()
  // Signed in with Profile open on Sign Up or Login: show the profile
  // (and its Profile title) straight away.
  if (game.profilePanel?.style.display === 'flex' && game.profileLoginGate?.style.display !== 'none') game._openProfilePanel()

  // Retry safeguard (kept from the earlier investigation, still cheap
  // insurance regardless of the popup/redirect root cause above): a
  // false "empty" here is destructive - falling through to pushToCloud
  // would silently overwrite a real cloud save with game device's blank
  // one - so don't believe "no save exists" off a single fetch.
  //
  // Real bug fixed 2026-09-26: fetchCloudSave itself had no try/catch
  // anywhere in game chain, and neither did game loop - a genuine fetch
  // failure (thrown exception - a real network hiccup, not a clean
  // "no document") propagated straight out of game whole function,
  // skipping BOTH the push-if-first-time branch below AND the pull/
  // conflict branch after it. Net effect on a real device: sign-in
  // itself succeeded (so it looked "signed in"), but the save never
  // got pulled OR pushed - the device just silently kept its own
  // freshly-generated playerId/nickname/zero stats, with no error
  // shown anywhere. Now every attempt is individually caught, and a
  // clean "no document" (worth trusting) is tracked separately from a
  // thrown error (worth retrying, then telling the player about if it
  // never recovers) - `!cloud` alone can no longer mean either one.
  let cloud = null
  let fetchFailed = false
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      cloud = await (game.__cloudBackendForTests || CloudSync).fetchCloudSave(uid)
      fetchFailed = false
      if (cloud) break
    } catch {
      fetchFailed = true
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800))
  }
  if (fetchFailed) {
    // Every attempt genuinely failed - never guess here. Falling
    // through to pushToCloud would risk overwriting a real cloud save
    // with game device's own (possibly blank) local state; silently
    // doing nothing would repeat the exact silent-wrong-identity bug
    // game replaced. Tell the player plainly instead - they're still
    // signed in and can retry (re-open Cloud Save, or reload) once
    // their connection is better.
    // _showHomepageToast, not _showLoreToast - sign-in almost always
    // happens from the homepage, before gameStarted is true, and
    // _showLoreToast silently no-ops in that case (see its own
    // gameStarted guard) - game message would never have shown at all.
    game._showHomepageToast(t('cloudsaveRestoreFailed'))
    return
  }
  if (!cloud) {
    // Confirmed (not just assumed) no cloud save exists yet - first
    // time signing in on any device.
    await CloudSaveUI.pushToCloud(game, false)
    return
  }
  // Same account should read the same everywhere, automatically -
  // requiring a manual "cloud or local" pick on every single sign-in
  // was exactly the confusing step game whole investigation kept
  // running into. Auto-apply the cloud save directly UNLESS game
  // device already has real progress of its own that a silent
  // overwrite would actually lose - in that one case, still show the
  // same compare-and-choose prompt as before rather than discarding a
  // device someone's genuinely been playing on without asking.
  //
  // Signing back in to the account this device last synced with (2026-10-23):
  // no question - the normal merge already knows what changed on each side
  // since then (CloudMerge.js), so progress made here while signed out and
  // progress made on other devices both survive. Either answer to the
  // question would have thrown one side away.
  const { base, foreign } = readBase(localStorage, uid)
  if (base && !foreign && localStorage.getItem(CLOUD_BASE_UID_KEY) === uid) {
    await CloudSaveUI.syncWithCloud(game, { allowApply: true })
    return
  }
  if (game._hasMeaningfulLocalProgress()) {
    game._cloudPendingConflict = cloud.data
    CloudSaveUI.renderCloudConflict(game, cloud.data)
    // The question is in the Cloud Save panel - open it so it's answered
    // (until it is, nothing syncs).
    CloudSaveUI.openCloudSavePanel(game)
  } else {
    CloudSaveUI.applyCloudSaveData(game, cloud.data)
  }
}

// Silent background counterpart to _afterCloudSignIn, called once per
// page load when Firebase resumes an ALREADY-signed-in session (see
// CloudSaveUI.restoreCloudSession) rather than a fresh Sign In click.
//
// Root problem this fixes: before this existed, a device that was
// already signed in never checked the cloud again after its very first
// sign-in - editing something that isn't tied to finishing a run (bio,
// nickname, anything Settings-only) never reached a second device that
// was never explicitly signed out and back in again. Two devices could
// drift apart forever, each only ever showing its own edits, with
// nothing ever telling either one to catch up.
//
// Deliberately much narrower than _afterCloudSignIn: no conflict
// prompt, no push-if-missing branch, and any failure is silent - this
// runs unprompted on every single load, so it must never interrupt
// with a popup or error toast the way an explicit Sign In click can.
//
// Real bug found 2026-09-27, same day this function shipped: comparing
// only the cloud's timestamp against this device's own last SYNC time
// (ignoring whether this device had made any edit since then) meant an
// edit made just before a reload - too recent for its own debounced
// push to have fired yet - could get silently overwritten if another
// device happened to push in that same narrow window. Now also tracks
// whether THIS device has an edit newer than its last sync
// (LAST_LOCAL_CHANGE_KEY, stamped by saveSettings on every call) before
// deciding what to do, instead of only ever considering the cloud side.
//
// Replaced 2026-09-28 by the three-way merge sync (see CloudMerge.js):
// the timestamp comparison here could only ever pick ONE whole side -
// whichever device's save "won" silently discarded everything the other
// device had done - and its "unpushed change" signal only covered
// settings, not stats/coins/purchases. uid is unused now (the sync reads
// this._cloudUid) but kept so the caller didn't need to change.
//
// Upload-only since the reload-loop fix (see CloudPreBoot.js): the pull
// half already happened before the game was built.
export async function _checkForNewerCloudSave(game, _uid) {
  await CloudSaveUI.syncWithCloud(game, { allowApply: false })
}

// In-memory state that's normally only written on page close
// (beforeunload) - flushed early when the tab is hidden, so Cloud Save's
// on-hide sync uploads it too (see CloudSaveUI.installChangeTracking).
export function _flushLocalSave(game) {
  if (game._importingSave) return
  saveShopProgress(game)
}

// See _afterCloudSignIn's own comment - the one condition under which a
// fresh sign-in still asks before overwriting local with cloud. Cheap
// real-progress signals only (not exhaustive) - a device that's never
// actually been played on genuinely has nothing worth protecting.
export function _hasMeaningfulLocalProgress(game) {
  return _safeStatNumber(game.careerStats.totalKills) > 0
    || _safeStatNumber(game.bestStats.bestWave) > 0
    || (Array.isArray(game.runHistory) && game.runHistory.length > 0)
}

export function _updateStorageUsageLine(game) {
  if (!game.storageUsageLine) return
  let totalChars = 0
  let count = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    totalChars += key.length + (localStorage.getItem(key) || '').length
    count++
  }
  game.storageUsageLine.textContent = t('storageUsageLine', { kb: (totalChars / 1024).toFixed(1), count })
  // Quota warning - most browsers cap localStorage around 5MB/origin
  // (varies, some allow more); warns approaching that rather than only
  // failing silently later (every save() in game codebase already
  // catches quota errors and just skips persisting, so a save actually
  // failing has no other visible symptom without game).
  if (game.storageQuotaWarning) {
    game.storageQuotaWarning.style.display = totalChars > 4 * 1024 * 1024 ? '' : 'none'
  }
}

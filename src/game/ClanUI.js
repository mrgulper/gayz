// Clans: the Clan panel (create/join/leave, members, invites by name or
// #ID, incoming invites, the clan ranking) and its tab label.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as ChatUI from './ChatUI.js'
import * as CloudSync from './CloudSync.js'
import { CLAN_RANKING_CACHE_MS, _escapeHtml, saveSettings } from './Game.js'
import { t } from './i18n.js'

export function _showClanSuggestions(game, list) {
  const box = document.getElementById('clan-invite-suggestions')
  if (!box || list === null) return
  game._clanSuggestions = list
  box.innerHTML = list.map((m, i) => `
    <button type="button" class="friend-suggest-row" data-index="${i}" role="option">
      <span class="friend-suggest-name">${_escapeHtml(m.name)}</span>
      ${typeof m.playerId === 'string' ? `<span class="friend-id">#${_escapeHtml(m.playerId)}</span>` : ''}
    </button>`).join('')
  box.classList.toggle('open', list.length > 0)
}

// Send Clan Request: a Player ID, or a name (sent straight away when
// exactly one player has it, otherwise the list to pick from).
export async function _sendClanInviteClick(game) {
  if (!game._cloudUid || !game.settings.clanId) return
  const raw = game.clanInviteIdInput.value.trim()
  if (!raw) return
  const say = (key, params) => {
    game.clanInviteStatus.textContent = t(key, params)
    game.clanInviteStatus.style.display = 'block'
  }
  const asId = raw.replace(/^#/, '').toUpperCase()
  let target = /^[A-Z0-9]{4,10}$/.test(asId) ? await CloudSync.fetchLeaderboardEntryByPlayerId(asId).catch(() => null) : null
  if (!target) {
    const matches = (await game._searchPlayerNames(raw, 'clan')) || []
    const exact = matches.filter((m) => String(m.name).toLowerCase() === raw.toLowerCase())
    if (exact.length === 1 || matches.length === 1) target = exact[0] || matches[0]
    else if (matches.length) {
      game._showClanSuggestions(matches)
      return say('clanInvitePickOne')
    }
  }
  if (!target) return say('clanInvitePlayerNotFound')
  await game._sendClanInviteTo(target)
}

export async function _sendClanInviteTo(game, target) {
  game._showClanSuggestions([])
  const clan = await CloudSync.fetchClanById(game.settings.clanId).catch(() => null)
  if (!clan || !target?.uid) return
  await CloudSync.sendClanInvite(game.settings.clanId, clan.name, target.uid).catch(() => {})
  game.clanInviteStatus.textContent = t('clanInviteSent')
  game.clanInviteStatus.style.display = 'block'
  game.clanInviteIdInput.value = ''
}

// The sidebar's HUB nav button opens this (see hubBtn's listener) -
// distinct from _openHubPanel(), an older, differently-scoped panel
// (Player/Difficulty/Choose Class/Game Modes/Challenges) only reachable
// from the homepage's "Game Mode" button, not the sidebar at all.
export function _openClanPanel(game) {
  if (!game.clanPanel) return
  game._closeAllMenuPanels()
  game.clanPanel.style.display = 'flex'
  if (game.clanPanelTitle) game.clanPanelTitle.textContent = t('hubBtn')
  // Defaults to the General tab every time the panel opens, same
  // "always reopen on the first tab" convention as Inventory's tabs.
  for (const tabEl of document.querySelectorAll('.general-tab')) tabEl.classList.toggle('active', tabEl.dataset.generalPage === 'general')
  for (const page of document.querySelectorAll('.general-tab-page')) page.style.display = page.id === 'general-page-general' ? 'block' : 'none'
  game._refreshClanUi()
  // Start loading the clan list now, so the Clan tab doesn't make you
  // wait for it (2026-10-09, "it takes so long to load").
  game._fetchClanRanking().catch(() => {})
}

export function _closeClanPanel(game) {
  if (game.clanPanel) game.clanPanel.style.display = 'none'
}

// Clan section (Hub panel) - see docs/superpowers/specs/
// 2026-08-26-clan-system-design.md. Create/Join wiring here;
// _refreshClanUi() (below) is the single source of truth for which of
// the two UI states shows and what's in it.
export function _bindClanSection(game) {
  // Click-outside-to-close, same pattern as #coming-soon-panel's own
  // listener - only the backdrop itself (not any inner content) closes it.
  if (game.clanPanel) {
    game.clanPanel.addEventListener('click', (e) => {
      if (e.target === game.clanPanel) game._closeClanPanel()
    })
  }

  if (game.clanCreateBtn) {
    game.clanCreateBtn.addEventListener('click', async () => {
      if (!game._cloudUid) return
      const name = game.clanCreateNameInput.value.trim()
      if (!name) return
      // Keyboard-only check mirrors the security rule's own name.matches()
      // pattern (see FIRESTORE_SECURITY_RULES) - catches it here with an
      // immediate message instead of a generic failure after a rejected
      // write.
      if (!/^[ -~]+$/.test(name)) {
        game.clanCreateTakenWarning.textContent = t('clanNameInvalidChars')
        game.clanCreateTakenWarning.style.display = 'block'
        return
      }
      const existing = await CloudSync.fetchClanByName(name).catch(() => null)
      if (existing) {
        game.clanCreateTakenWarning.textContent = t('clanNameTakenWarning')
        game.clanCreateTakenWarning.style.display = 'block'
        return
      }
      game.clanCreateTakenWarning.style.display = 'none'
      const nickname = game.settings.nickname || t('playerShowcaseTitleDefault')
      const clanId = await CloudSync.createClan(game._cloudUid, nickname, name).catch(() => null)
      if (!clanId) return
      game.settings.clanId = clanId
      game._clanRankingCache = null
      game.settings.clanName = name
      saveSettings(game.settings)
      game._renderPlayerTag()
      game._refreshClanUi()
    })
  }

  // "Make Clan" toggles the create-name/tag form open/closed rather
  // than navigating anywhere - the form and the all-clans list both
  // live in the same browse state.
  if (game.clanMakeBtn) {
    game.clanMakeBtn.addEventListener('click', () => {
      if (!game._cloudUid) return
      game.clanMakeForm.style.display = game.clanMakeForm.style.display === 'none' ? 'block' : 'none'
    })
  }

  // Request to Join by typing a clan's name (beside Make Clan) -
  // alternative to clicking a row in the all-clans list below, same
  // end result (a join request).
  if (game.clanRequestNameBtn) {
    game.clanRequestNameBtn.addEventListener('click', async () => {
      if (!game._cloudUid) return
      const name = game.clanRequestNameInput.value.trim()
      if (!name) return
      const clan = await CloudSync.fetchClanByName(name).catch(() => null)
      if (!clan) {
        game.clanRequestNameStatus.textContent = t('clanNotFound')
        game.clanRequestNameStatus.style.display = 'block'
        return
      }
      const nickname = game.settings.nickname || t('playerShowcaseTitleDefault')
      await CloudSync.sendJoinRequest(clan.clanId, game._cloudUid, nickname).catch(() => {})
      game.clanRequestNameStatus.textContent = t('clanRequestSent')
      game.clanRequestNameStatus.style.display = 'block'
    })
  }

  // Request to Join, from the all-clans list (event delegation - the
  // list is re-rendered on every refresh, so per-row listeners would leak).
  if (game.clanAllList) {
    game.clanAllList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.clan-list-join-btn')
      if (!btn || !game._cloudUid) return
      const nickname = game.settings.nickname || t('playerShowcaseTitleDefault')
      await CloudSync.sendJoinRequest(btn.dataset.clanId, game._cloudUid, nickname).catch(() => {})
      btn.textContent = t('clanRequestSent')
      btn.disabled = true
    })
  }

  // Incoming clan invites (browse state, not yet in a clan) - Accept
  // creates your own member doc (the security rule only allows game
  // because the invite doc exists), Decline just clears it.
  if (game.clanIncomingInvitesList) {
    game.clanIncomingInvitesList.addEventListener('click', async (e) => {
      const acceptBtn = e.target.closest('.clan-invite-accept-btn')
      const declineBtn = e.target.closest('.clan-invite-decline-btn')
      if (!game._cloudUid) return
      if (acceptBtn) {
        const nickname = game.settings.nickname || t('playerShowcaseTitleDefault')
        const result = await CloudSync.acceptClanInvite(acceptBtn.dataset.clanId, game._cloudUid, nickname).catch(() => ({ ok: false }))
        if (!result.ok) return
        game.settings.clanId = acceptBtn.dataset.clanId
        game._clanRankingCache = null
        game.settings.clanName = acceptBtn.dataset.clanName
        saveSettings(game.settings)
        game._renderPlayerTag()
        game._refreshClanUi()
      } else if (declineBtn) {
        await CloudSync.declineClanInvite(declineBtn.dataset.clanId, game._cloudUid).catch(() => {})
        game._refreshClanUi()
      }
    })
  }

  // Send Clan Request - Owner/Elder only (the section itself is hidden
  // for a plain Member, see _refreshClanUi). By name or Player ID, like
  // Add a Friend (2026-10-13): typing a name lists everyone whose name
  // starts with it; picking one sends the request.
  if (game.clanInviteSendBtn) {
    game.clanInviteSendBtn.addEventListener('click', () => game._sendClanInviteClick())
    game.clanInviteIdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') game._sendClanInviteClick()
      if (e.key === 'Escape') game._showClanSuggestions([])
    })
    let clanSearchTimer = null
    game.clanInviteIdInput.addEventListener('input', () => {
      clearTimeout(clanSearchTimer)
      clanSearchTimer = setTimeout(async () => game._showClanSuggestions(await game._searchPlayerNames(game.clanInviteIdInput.value, 'clan')), 300)
    })
    document.getElementById('clan-invite-suggestions')?.addEventListener('click', (e) => {
      const row = e.target.closest('.friend-suggest-row')
      const entry = row && game._clanSuggestions?.[Number(row.dataset.index)]
      if (entry) game._sendClanInviteTo(entry)
    })
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('#clan-invite-row')) game._showClanSuggestions([])
    })
  }

  if (game.clanLeaveBtn) {
    game.clanLeaveBtn.addEventListener('click', async () => {
      if (!game._cloudUid || !game.settings.clanId) return
      // Button is disabled (unclickable) for an owner with other members
      // still present - see _refreshClanUi - so reaching here means
      // either a non-owner leaving, or the owner leaving as the last
      // member (which also deletes the clan itself, not just their own
      // membership - see deleteClan's own comment).
      const isSoleOwner = game._clanIsOwner && !game._clanOtherMembersPresent
      if (!window.confirm(t(isSoleOwner ? 'clanDisbandConfirm' : 'clanLeaveConfirm'))) return
      const clanId = game.settings.clanId
      await CloudSync.leaveClan(clanId, game._cloudUid).catch(() => {})
      if (isSoleOwner) await CloudSync.deleteClan(clanId).catch(() => {})
      game.settings.clanId = null
      game._clanRankingCache = null
      game.settings.clanName = null
      saveSettings(game.settings)
      game._renderPlayerTag()
      game._refreshClanUi()
    })
  }

  // Kick/Promote/Demote, from the member list (event delegation - the
  // server-side rule is the real gate; buttons are also only rendered
  // for roles allowed to use them, see _refreshClanUi).
  if (game.clanMemberList) {
    game.clanMemberList.addEventListener('click', async (e) => {
      if (!game.settings.clanId) return
      const kickBtn = e.target.closest('.clan-kick-btn')
      const promoteBtn = e.target.closest('.clan-promote-btn')
      const demoteBtn = e.target.closest('.clan-demote-btn')
      const makeLeaderBtn = e.target.closest('.clan-make-leader-btn')
      if (kickBtn) {
        await CloudSync.kickClanMember(game.settings.clanId, kickBtn.dataset.uid).catch(() => {})
      } else if (promoteBtn) {
        await CloudSync.promoteToElder(game.settings.clanId, promoteBtn.dataset.uid, promoteBtn.dataset.nickname, Number(promoteBtn.dataset.joinedAt)).catch(() => {})
      } else if (demoteBtn) {
        await CloudSync.demoteToMember(game.settings.clanId, demoteBtn.dataset.uid, demoteBtn.dataset.nickname, Number(demoteBtn.dataset.joinedAt)).catch(() => {})
      } else if (makeLeaderBtn) {
        if (!window.confirm(t('clanMakeLeaderConfirm', { name: makeLeaderBtn.dataset.nickname }))) return
        await CloudSync.transferClanLeadership(
          game.settings.clanId,
          makeLeaderBtn.dataset.uid, makeLeaderBtn.dataset.nickname, Number(makeLeaderBtn.dataset.joinedAt),
          game._cloudUid, game._clanMyNickname, game._clanMyJoinedAt
        ).catch(() => {})
      } else {
        return
      }
      game._refreshClanUi()
    })
  }

  // Approve/Deny, from the join-requests list (Owner/Elder only - the
  // section itself is hidden for a plain Member).
  if (game.clanRequestsList) {
    game.clanRequestsList.addEventListener('click', async (e) => {
      if (!game.settings.clanId) return
      const approveBtn = e.target.closest('.clan-request-approve-btn')
      const denyBtn = e.target.closest('.clan-request-deny-btn')
      if (approveBtn) {
        await CloudSync.approveJoinRequest(game.settings.clanId, approveBtn.dataset.uid, approveBtn.dataset.nickname).catch(() => {})
        game._refreshClanUi()
      } else if (denyBtn) {
        await CloudSync.denyJoinRequest(game.settings.clanId, denyBtn.dataset.uid).catch(() => {})
        game._refreshClanUi()
      }
    })
  }
}

// "My Clan" subtab reads "Make Clan" until settings.clanId is actually
// set - reuses the existing clanMakeBtn i18n string rather than a new key.
export function _updateClanMyClanTabLabel(game) {
  if (game.clanSubtabMyClanBtn) game.clanSubtabMyClanBtn.textContent = game.settings.clanId ? t('clanSubtabMyClan') : t('clanMakeBtn')
}

// Reconciliation: settings.clanId is a local cache (see spec) - a live
// members-subcollection check is the actual source of truth, since it
// can drift (kicked while offline, left on another device). Called on
// Hub panel open and after every create/join/leave/kick action.
export async function _refreshClanUi(game) {
  if (!game.clanSigninGate) return
  // See _authReadyPromise's own comment (Game.js constructor) - same
  // false-signed-out race the Profile panel had.
  await game._authReadyPromise
  if (!game._cloudUid || !CloudSync.isConfigured()) {
    // Signed out: no "sign in to join/create" nag - just show nothing,
    // same as a signed-in player who hasn't joined a clan yet.
    game.clanBrowseState.style.display = 'none'
    game.clanInClanState.style.display = 'none'
    game._updateClanMyClanTabLabel()
    return
  }
  game.clanSigninGate.style.display = 'none'

  if (!game.settings.clanId) {
    // Before treating game as "never joined a clan", check whether I'm
    // actually the leader of an existing clan doc that my own browser
    // just has no local record of any more (settings.clanId wiped by a
    // past bug, before the members-doc self-heal below existed to catch
    // it) - the member-doc self-heal further down only ever runs once a
    // clanId is already known, so it can't reach game case on its own.
    // Restore it here and fall through into the normal in-clan render
    // path below instead of duplicating it.
    const ledClan = await CloudSync.fetchClanILead(game._cloudUid).catch(() => null)
    if (ledClan) {
      game.settings.clanId = ledClan.clanId
      game._clanRankingCache = null
      game.settings.clanName = ledClan.name
      saveSettings(game.settings)
      game._renderPlayerTag()
    } else {
      ChatUI.updateChatTabAvailability(game)
      await game._renderClanIncomingInvites()
      game.clanBrowseState.style.display = 'block'
      game.clanInClanState.style.display = 'none'
      game._updateClanMyClanTabLabel()
      return
    }
  }

  let members = await CloudSync.fetchClanMembers(game.settings.clanId).catch(() => [])
  let me = members.find((m) => m.uid === game._cloudUid)
  if (!me) {
    // Before concluding I've actually left/been removed, check the clan
    // doc's own leaderId - a genuine "kicked while offline" always shows
    // leaderId belonging to someone else, but createClan writes the clan
    // doc and the owner's own member doc as two separate, non-atomic
    // calls (see its own comment) - if the second one was ever
    // interrupted, or any other past bug dropped just the member doc,
    // the clan doc survives with leaderId still mine while my own
    // member record is missing. Self-heal that instead of silently
    // kicking the real owner out to the Browse screen.
    const clan = await CloudSync.fetchClanById(game.settings.clanId).catch(() => null)
    if (clan && clan.leaderId === game._cloudUid) {
      const nickname = game.settings.nickname || t('playerShowcaseTitleDefault')
      await CloudSync.restoreOwnerMembership(game.settings.clanId, game._cloudUid, nickname).catch(() => {})
      members = await CloudSync.fetchClanMembers(game.settings.clanId).catch(() => [])
      me = members.find((m) => m.uid === game._cloudUid)
    }
  }
  if (!me) {
    game.settings.clanId = null
    game._clanRankingCache = null
    game.settings.clanName = null
    saveSettings(game.settings)
    game._renderPlayerTag()
    ChatUI.updateChatTabAvailability(game)
    await game._renderClanIncomingInvites()
    game.clanBrowseState.style.display = 'block'
    game.clanInClanState.style.display = 'none'
    game._updateClanMyClanTabLabel()
    return
  }

  game.clanBrowseState.style.display = 'none'
  game.clanInClanState.style.display = 'block'
  game._updateClanMyClanTabLabel()

  const clan = await CloudSync.fetchClanById(game.settings.clanId).catch(() => null)
  if (!clan) return
  // Backfill for an account whose settings.clanName wasn't cached yet
  // (e.g. joined before game caching existed) - keeps the homepage's
  // clan-name-above-nickname display (_renderPlayerTag) in sync without
  // it needing its own live fetch on every page load.
  if (game.settings.clanName !== clan.name) {
    game.settings.clanName = clan.name
    saveSettings(game.settings)
    game._renderPlayerTag()
  }

  game.clanDisplayName.textContent = clan.name

  const myRole = me.role || 'member'
  const canManage = myRole === 'owner' || myRole === 'elder'

  const stats = await CloudSync.fetchClanCombinedStats(game.settings.clanId).catch(() => ({ memberCount: members.length, totalKills: 0, totalBestWave: 0 }))
  game.clanStatsMembers.textContent = t('clanStatsMembers', { n: stats.memberCount, max: CloudSync.CLAN_MEMBER_CAP })
  game.clanStatsKills.textContent = t('clanStatsKills', { n: avgKillsText(stats.totalKills, stats.memberCount) })
  game.clanStatsWave.textContent = t('clanStatsWave', { n: stats.totalBestWave })

  // Send Clan Request (invite by Player ID) is management-only.
  game.clanSendInviteSection.style.display = canManage ? 'block' : 'none'

  const isOwner = myRole === 'owner'
  // Owner first, then Elder, then Member - no separate "Your role: X"
  // line any more (removed per request), so the hierarchy needs to read
  // directly from the list's own order instead.
  const roleOrder = { owner: 0, elder: 1, member: 2 }
  const sortedMembers = [...members].sort((a, b) => (roleOrder[a.role || 'member'] ?? 2) - (roleOrder[b.role || 'member'] ?? 2))
  game.clanMemberList.innerHTML = sortedMembers.map((m) => {
    const role = m.role || 'member'
    const canKickThis = canManage && role !== 'owner' && m.uid !== game._cloudUid
    const canPromoteThis = isOwner && role === 'member'
    const canDemoteThis = isOwner && role === 'elder'
    const canMakeLeaderThis = isOwner && m.uid !== game._cloudUid
    return `
      <div class="clan-member-row">
        <span class="clan-member-name-block">
          <span class="clan-member-role">${t(`clanRole_${role}`)}</span>
          <span class="clan-member-name">${_escapeHtml(m.nickname)}</span>
        </span>
        <span>
          ${canMakeLeaderThis ? `<button type="button" class="clan-make-leader-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanMakeLeaderBtn')}</button>` : ''}
          ${canPromoteThis ? `<button type="button" class="clan-promote-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanPromoteBtn')}</button>` : ''}
          ${canDemoteThis ? `<button type="button" class="clan-demote-btn" data-uid="${m.uid}" data-nickname="${_escapeHtml(m.nickname)}" data-joined-at="${m.joinedAt}">${t('clanDemoteBtn')}</button>` : ''}
          ${canKickThis ? `<button type="button" class="clan-kick-btn" data-uid="${m.uid}">${t('clanKickBtn')}</button>` : ''}
        </span>
      </div>
    `
  }).join('')

  // Join Requests - only fetched/shown for Owner/Elder (a plain Member
  // has no read permission on game subcollection anyway per the
  // security rule, so game also avoids a doomed-to-fail request).
  if (canManage) {
    const requests = await CloudSync.fetchJoinRequests(game.settings.clanId).catch(() => [])
    game.clanRequestsSection.style.display = 'block'
    game.clanRequestsList.innerHTML = requests.length
      ? requests.map((r) => `
        <div class="clan-request-row">
          <span>${_escapeHtml(r.nickname)}</span>
          <span>
            <button type="button" class="clan-request-approve-btn" data-uid="${r.uid}" data-nickname="${_escapeHtml(r.nickname)}">${t('clanApproveBtn')}</button>
            <button type="button" class="clan-request-deny-btn" data-uid="${r.uid}">${t('clanDenyBtn')}</button>
          </span>
        </div>
      `).join('')
      : `<p>${t('clanRequestsEmpty')}</p>`
  } else {
    game.clanRequestsSection.style.display = 'none'
  }

  const otherMembersPresent = members.length > 1
  game._clanOtherMembersPresent = otherMembersPresent
  game._clanIsOwner = isOwner
  game._clanMyNickname = me.nickname
  game._clanMyJoinedAt = me.joinedAt
  game.clanLeaveBtn.disabled = isOwner && otherMembersPresent
  game.clanLeaveBtn.textContent = t('clanLeaveBtn')
  game.clanLeaveDisabledHint.style.display = isOwner && otherMembersPresent ? 'block' : 'none'
  if (game.clanLeaveDisabledHint.style.display === 'block') game.clanLeaveDisabledHint.textContent = t('clanLeaderMustTransferFirst')
  ChatUI.updateChatTabAvailability(game)
}

// Invites addressed to this account, shown while browsing (not yet in
// a clan) - see CloudSync.fetchIncomingClanInvites.
export async function _renderClanIncomingInvites(game) {
  if (!game.clanIncomingInvitesList) return
  const invites = await CloudSync.fetchIncomingClanInvites(game._cloudUid).catch(() => [])
  game.clanIncomingInvitesList.innerHTML = invites.map((inv) => `
    <div class="clan-list-row">
      <span>${t('clanInviteRowLabel', { name: _escapeHtml(inv.clanName) })}</span>
      <span>
        <button type="button" class="clan-invite-accept-btn" data-clan-id="${inv.clanId}" data-clan-name="${_escapeHtml(inv.clanName)}">${t('clanAcceptBtn')}</button>
        <button type="button" class="clan-invite-decline-btn" data-clan-id="${inv.clanId}">${t('clanDeclineBtn')}</button>
      </span>
    </div>
  `).join('')
}

// Public directory of every clan that exists (see CloudSync.fetchAllClans),
// ranked by total member kills (fetchClanCombinedStats - already existed,
// previously only ever used for your OWN clan's stats card) - this used to
// be an unordered join list, and one only reachable before you'd joined a
// clan at all (clanBrowseState, whole thing hidden the moment you had one -
// see _refreshClanUi). Now its own always-reachable sub-tab regardless of
// membership, and genuinely ranked instead of just listed.
// Every clan with its member count and total kills, best first. Three
// Firestore reads per clan, so the result is shared for
// CLAN_RANKING_CACHE_MS - opening General starts it, the Clan tab reuses
// it - and dropped whenever this player's own clan changes.
export function _fetchClanRanking(game) {
  const cached = game._clanRankingCache
  if (cached && Date.now() - cached.at < CLAN_RANKING_CACHE_MS) return cached.promise
  const promise = (async () => {
    const clans = await CloudSync.fetchAllClans().catch(() => [])
    const [counts, stats] = await Promise.all([
      Promise.all(clans.map((c) => CloudSync.fetchClanMemberCount(c.clanId).catch(() => null))),
      Promise.all(clans.map((c) => CloudSync.fetchClanCombinedStats(c.clanId).catch(() => null))),
    ])
    return clans
      .map((c, i) => ({ ...c, memberCount: counts[i], totalKills: stats[i]?.totalKills ?? 0, avgKills: avgKills(stats[i]?.totalKills ?? 0, stats[i]?.memberCount) }))
      .sort((a, b) => b.avgKills - a.avgKills)
  })()
  game._clanRankingCache = { at: Date.now(), promise }
  // A failed or empty load isn't worth keeping - try again next time.
  promise.then((list) => { if (!list.length && game._clanRankingCache?.promise === promise) game._clanRankingCache = null })
  return promise
}

// Clans rank by their members' average career zombie kills (2026-10-18,
// Gaymi: "it should be based on every members average kill so you can use
// decimals"), shown to one decimal place.
function avgKills(total, members) {
  return (Number(total) || 0) / Math.max(1, Number(members) || 1)
}
function avgKillsText(total, members) {
  return avgKills(total, members).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export async function _renderClanRanking(game) {
  if (!game.clanAllList) return
  game.clanAllList.innerHTML = ''
  const ranked = await game._fetchClanRanking()
  if (!ranked.length) {
    game.clanAllList.innerHTML = `<p>${t('clanListEmpty')}</p>`
    return
  }
  // Already in a clan - no server-side rule stops sending a join request to
  // a DIFFERENT clan while still a member of your own (sendJoinRequest just
  // writes a pending request doc), which would be a confusing way to end up
  // half-migrated. Only show Join when there's genuinely nowhere you
  // already belong; your own clan's row gets a plain label instead.
  const inClan = !!game.settings.clanId
  game.clanAllList.innerHTML = ranked.map((c, i) => {
    const isMine = inClan && c.clanId === game.settings.clanId
    const countLabel = c.memberCount == null ? '' : ` <span class="clan-list-count">(${c.memberCount}/${CloudSync.CLAN_MEMBER_CAP})</span>`
    const action = isMine
      ? `<span class="clan-list-your-clan">${t('clanRankingYourClan')}</span>`
      : inClan
        ? ''
        : `<button type="button" class="clan-list-join-btn mini-action-btn" data-clan-id="${c.clanId}">${t('clanJoinBtn')}</button>`
    return `
      <div class="clan-list-row clan-ranking-row${isMine ? ' clan-list-row-mine' : ''}">
        <span class="clan-list-rank">#${i + 1}</span>
        <span class="clan-list-name">${_escapeHtml(c.name)}${countLabel}</span>
        ${isMine ? action : ''}
        <span class="clan-list-kills">${t('clanRankingKillsLabel', { n: avgKillsText(c.totalKills, c.memberCount) })}</span>
        ${isMine ? '' : action}
      </div>
    `
  }).join('')
}

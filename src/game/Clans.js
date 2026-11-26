// Clans - the `clans` collection and what hangs off it: create, look up,
// members and roles, join requests, invites, leave/kick/delete, and the
// combined stats (monthly clan XP + Clan War points). Moved out of
// CloudSync.js (2026-11-26); CloudSync.js re-exports all of it, so callers
// still use CloudSync.xxx. Clan chat stayed in CloudSync.js next to the
// other chat rooms (they share the history limit and name-style helper).
// ensureApp comes back from CloudSync.js - the circular import is fine
// because it's only called at run time, never while modules load.
import { ensureApp } from './CloudSync.js'
import { clanMonthKey, entryClanXp } from './Xp.js'
import { entryWar } from './ClanWar.js'

// Clans (lightweight "Crew" - see docs/superpowers/specs/2026-08-26-clan-system-design.md).
// clanId is a Firestore auto-generated doc id, not a player-chosen slug -
// avoids needing any uniqueness check on the id itself. The leader's own
// membership doc is created in the SAME call (not left to a separate
// joinClan call) so a freshly created clan never has zero members even
// for a moment.
export async function createClan(leaderUid, leaderNickname, name) {
  const { db, fsMod } = await ensureApp()
  const clanRef = fsMod.doc(fsMod.collection(db, 'clans'))
  // nameLower makes the uniqueness check (fetchClanByName) case-insensitive -
  // "Fire", "FIRE", and "fire" are all the same taken name. Firestore has no
  // case-insensitive query operator, so this is the standard workaround:
  // store a normalized copy, query against that instead of the display name.
  await fsMod.setDoc(clanRef, { name, nameLower: name.toLowerCase(), leaderId: leaderUid, leaderNickname, createdAt: Date.now() })
  try {
    await fsMod.setDoc(fsMod.doc(db, 'clans', clanRef.id, 'members', leaderUid), { nickname: leaderNickname, joinedAt: Date.now(), role: 'owner' })
  } catch (err) {
    // Two separate writes, not one atomic transaction - if the second one
    // fails (network hiccup, tab closed mid-creation), roll back the first
    // rather than leaving an orphaned clan doc whose leaderId points at a
    // member record that was never created. See restoreOwnerMembership /
    // _refreshClanUi's self-heal for what happens if this is ever missed.
    await fsMod.deleteDoc(clanRef).catch(() => {})
    throw err
  }
  return clanRef.id
}

// Recreates the leader's own member doc when the clan doc still says they're
// the leader but their member record is missing (an interrupted createClan,
// or any other past inconsistency) - see _refreshClanUi's self-heal. Reuses
// the exact same write/security-rule path createClan's second step already
// uses, just callable on its own.
export async function restoreOwnerMembership(clanId, uid, nickname) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt: Date.now(), role: 'owner' })
}

export async function fetchClanByName(name) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'clans'), fsMod.where('nameLower', '==', name.toLowerCase()), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : { ...snap.docs[0].data(), clanId: snap.docs[0].id }
}

export async function fetchClanById(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'clans', clanId))
  return snap.exists() ? { ...snap.data(), clanId: snap.id } : null
}

// Finds a clan by its leaderId - used by _refreshClanUi's self-heal for
// the case where a player's OWN browser has no settings.clanId at all any
// more (so the members-doc-missing self-heal above never even gets a
// chance to run, since that one only fires once a clanId is already
// known) but they're still the real owner of an existing clan doc.
export async function fetchClanILead(uid) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'clans'), fsMod.where('leaderId', '==', uid), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : { ...snap.docs[0].data(), clanId: snap.docs[0].id }
}

// Public directory of every clan - newest first, capped at 50 (same
// "bound the read cost" reasoning as every other list-fetching query in
// this file) so the browse list stays cheap to load regardless of how
// many clans eventually exist.
export async function fetchAllClans() {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'clans'), fsMod.orderBy('createdAt', 'desc'), fsMod.limit(50))
  const snap = await fsMod.getDocs(q)
  return snap.docs.map((d) => ({ ...d.data(), clanId: d.id }))
}

export async function fetchClanMembers(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDocs(fsMod.collection(db, 'clans', clanId, 'members'))
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}

export async function fetchClanMemberCount(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getCountFromServer(fsMod.collection(db, 'clans', clanId, 'members'))
  return snap.data().count
}

// Membership cap (100) is enforced HERE, client-side, not in security
// rules - a rare race letting a 101st member slip through under
// simultaneous joins is an accepted non-security edge case (see spec).
// Exported so the UI (the "{n}/100 members" stats line) can't drift out
// of sync with the real enforced number.
export const CLAN_MEMBER_CAP = 100

// Join Requests - self-created, one per requester (doc id = requester's
// own uid, same "can only ever touch your own doc" pattern as
// friendRequests below). Owner/Elder read the list and either approve
// (create the real member doc + delete the request) or deny (just
// delete it) - see approveJoinRequest/denyJoinRequest.
export async function sendJoinRequest(clanId, uid, nickname) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'joinRequests', uid), { nickname, requestedAt: Date.now() })
}

export async function fetchJoinRequests(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDocs(fsMod.collection(db, 'clans', clanId, 'joinRequests'))
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}

export async function approveJoinRequest(clanId, uid, nickname) {
  const count = await fetchClanMemberCount(clanId)
  if (count >= CLAN_MEMBER_CAP) return { ok: false, reason: 'full' }
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt: Date.now(), role: 'member' })
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'joinRequests', uid))
  return { ok: true }
}

export async function denyJoinRequest(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'joinRequests', uid))
}

// Clan Invites - Owner/Elder invites a specific player by their stable
// playerId-looked-up uid, writing into THEIR inbox (mirrors
// friendRequests/{toUid}/incoming/{fromUid} exactly, just keyed by
// clanId instead of the inviter's own uid, capping one outstanding
// invite per clan per target). The invitee accepts (creates their own
// member doc, which the security rule only allows because this invite
// doc exists) or declines (just deletes it).
export async function sendClanInvite(clanId, clanName, toUid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clanInvites', toUid, 'incoming', clanId), { clanName, invitedAt: Date.now() })
}

export async function fetchIncomingClanInvites(uid) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDocs(fsMod.collection(db, 'clanInvites', uid, 'incoming'))
  return snap.docs.map((d) => ({ clanId: d.id, ...d.data() }))
}

export async function acceptClanInvite(clanId, uid, nickname) {
  const count = await fetchClanMemberCount(clanId)
  if (count >= CLAN_MEMBER_CAP) return { ok: false, reason: 'full' }
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt: Date.now(), role: 'member' })
  await fsMod.deleteDoc(fsMod.doc(db, 'clanInvites', uid, 'incoming', clanId))
  return { ok: true }
}

export async function declineClanInvite(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clanInvites', uid, 'incoming', clanId))
}

// Roles - Owner only (enforced by the security rule, not just this
// client call).
export async function promoteToElder(clanId, uid, nickname, joinedAt) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt, role: 'elder' })
}

export async function demoteToMember(clanId, uid, nickname, joinedAt) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt, role: 'member' })
}

// Leadership transfer - Owner only, and only onto someone else already in
// the clan (enforced by the security rule). Three writes, in this order
// specifically because each one's rule re-checks the CALLER's own
// current role live: promoting the new leader has to happen first, while
// the caller's own member doc still says 'owner'; demoting the caller's
// own doc to elder comes next (still allowed - that same live check is
// still true); the clans-doc leaderId flip comes last since its rule
// requires the new leaderId to already hold role 'owner' in members/,
// which is only true once step one has landed. Skipping the demote step
// would leave two members both reading 'owner' until the old leader
// separately calls leaveClan().
export async function transferClanLeadership(clanId, newLeaderUid, newLeaderNickname, newLeaderJoinedAt, oldLeaderUid, oldLeaderNickname, oldLeaderJoinedAt) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', newLeaderUid), { nickname: newLeaderNickname, joinedAt: newLeaderJoinedAt, role: 'owner' })
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', oldLeaderUid), { nickname: oldLeaderNickname, joinedAt: oldLeaderJoinedAt, role: 'elder' })
  await fsMod.updateDoc(fsMod.doc(db, 'clans', clanId), { leaderId: newLeaderUid, leaderNickname: newLeaderNickname })
}

export async function leaveClan(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'members', uid))
}

// Deletes the clan itself (the clans/{clanId} doc) - only ever called
// right after the owner's own leaveClan(), and only when they were the
// last member. Without this, the doc would sit around forever with zero
// members (see the Firebase Console clan-cleanup notes) - "leave clan"
// for a solo owner now really deletes the clan instead of orphaning it.
export async function deleteClan(clanId) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId))
}

export async function kickClanMember(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'members', uid))
}

// Combined clan stats - queries the EXISTING leaderboard collection
// filtered by clanId and sums client-side, rather than maintaining a
// separate shared-counter doc (see spec's "Existing prior art" section
// on why this deliberately avoids that added complexity).
export async function fetchClanCombinedStats(clanId) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('clanId', '==', clanId))
  const snap = await fsMod.getDocs(q)
  // Clans rank by the XP their members earned for them this month
  // (2026-10-23, kirka-style) - every clan is back at 0 on the 1st.
  const month = clanMonthKey()
  let monthXp = 0
  // Clan War (ClanWar.js): the same docs, so no extra reads.
  const war = { weekPts: 0, monthPts: 0, lastWeekPts: 0, lastMonthPts: 0 }
  const now = Date.now()
  for (const d of snap.docs) {
    monthXp += entryClanXp(d.data(), clanId, month)
    const w = entryWar(d.data(), clanId, now)
    war.weekPts += w.week
    war.monthPts += w.month
    war.lastWeekPts += w.lastWeek
    war.lastMonthPts += w.lastMonth
  }
  return { memberCount: snap.size, monthXp, ...war }
}

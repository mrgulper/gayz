// Leaderboards - the public `leaderboard` collection (one doc per player)
// and the Weekly Challenge boards: pushing your entry, the top lists
// (nights, speedrun, parkour, duels, achievements), name/ID lookups, rank,
// nearby rank and global averages. Moved out of CloudSync.js (2026-11-26);
// CloudSync.js re-exports all of it, so callers still use CloudSync.xxx.
// ensureApp comes back from CloudSync.js - the circular import is fine
// because it's only called at run time, never while modules load.
import { ensureApp } from './CloudSync.js'
import { isHidden, hiddenPlayerCount, switchedOff, switchedOffError } from './LiveConfig.js'


// Global Leaderboard - one doc per player, overwritten wholesale each push
// (not appended), so a player only ever has one entry regardless of how
// many times they've synced. entry: { name, bestNight, bestKills,
// bestKillStreak }, validated server-side by FIRESTORE_SECURITY_RULES.
// The rules want whole numbers (`is int`); playtime and run times are
// measured in fractions, and one decimal made Firestore reject the whole
// write - nobody's leaderboard doc (or clan XP) updated from ~2026-10-10
// until this rounding (2026-10-24, "i got xp and its still 0").
export function wholeNumbers(entry) {
  const out = {}
  for (const [k, v] of Object.entries(entry)) out[k] = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : v
  return out
}

export async function pushLeaderboardEntry(uid, entry) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'leaderboard', uid), { ...wholeNumbers(entry), updatedAt: Date.now() })
}

// One direct doc read by uid, returning the FULL public leaderboard doc
// (unlike fetchPresence above, which only pulls out the presence fields) -
// used to view another player's profile (see Game.js's
// _openOtherPlayerProfile) from a friends-list click. Same doc
// fetchLeaderboardEntryByName/ByPlayerId already read, just by uid
// directly since a saved friend's uid is already on hand (no query
// needed). A friend who's never completed a run has no leaderboard doc at
// all - null, same "not an error" precedent as fetchPresence.
export async function fetchLeaderboardEntryByUid(uid) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'leaderboard', uid))
  return snap.exists() ? { ...snap.data(), uid } : null
}

// Accounts the team hid from the leaderboards (a cheated score,
// LiveConfig isHidden('player', uid)) are left out of every list. Each
// query asks for a few extra so the list stays full.
const boardLimit = (n) => n + Math.min(hiddenPlayerCount(), 20)
const shownRows = (rows, n) => rows.filter((r) => !isHidden('player', r.uid)).slice(0, n)

// region: optional, one of REGION_OPTIONS (Game.js) - omitted or 'global'
// means worldwide, no filter applied.
export async function fetchTopLeaderboard(n, region) {
  if (switchedOff('leaderboards', { quiet: true })) throw switchedOffError('leaderboards')
  const { db, fsMod } = await ensureApp()
  const constraints = [fsMod.orderBy('bestNight', 'desc'), fsMod.limit(boardLimit(n))]
  if (region && region !== 'global') constraints.unshift(fsMod.where('region', '==', region))
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), ...constraints)
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map((d) => ({ ...d.data(), uid: d.id })), n)
}

// Live subscription variant of fetchTopLeaderboard - used only while the
// Cloud Save panel's leaderboard list is actually visible (subscribed on
// open, unsubscribed on close/sign-out) rather than left running
// indefinitely, to keep the read cost bounded. Returns an unsubscribe
// function; callback fires once immediately with current data and again
// on every future change.
// callback is invoked with `null` (never an empty array, which means "no
// entries yet" - a real, valid state) on a subscription error so the
// caller can show an actual error instead of leaving its "Connecting..."
// placeholder up forever - found via a QA pass: a region + bestNight
// compound query needs a Firestore composite index that was never
// created for this project (same class of gotcha as this file's own
// getAggregateFromServer note, just for a plain query instead of an
// aggregate one - the console error names the exact missing index and
// links straight to a pre-filled "create it" page), and the old bare
// `() => {}` error handler swallowed that (or any other subscription
// error - a network blip, quota, anything) completely silently.
// Leaderboard and weekly docs are keyed by the player's uid; rows carry it
// so clicking a name can open that player's profile (2026-10-24).
const withUid = (d) => ({ ...d.data(), uid: d.id })

export function subscribeTopLeaderboard(n, region, callback) {
  if (switchedOff('leaderboards', { quiet: true })) {
    callback(null)
    return () => {}
  }
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    const constraints = [fsMod.orderBy('bestNight', 'desc'), fsMod.limit(boardLimit(n))]
    if (region && region !== 'global') constraints.unshift(fsMod.where('region', '==', region))
    const q = fsMod.query(fsMod.collection(db, 'leaderboard'), ...constraints)
    unsub = fsMod.onSnapshot(q, (snap) => callback(shownRows(snap.docs.map(withUid), n)), () => callback(null))
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// Achievement-count leaderboard - same collection, sorted by a different
// field (achievementCount, pushed alongside bestNight/bestKills/
// bestKillStreak - see pushLeaderboardEntry's caller in Game.js).
// Speedrun mode's fastest times (Speedrun.js): leaderboard docs with a
// speedrunMs, lowest first (a single-field order, no index needed).
export async function fetchTopSpeedruns(n) {
  if (switchedOff('leaderboards', { quiet: true })) throw switchedOffError('leaderboards')
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.orderBy('speedrunMs', 'asc'), fsMod.limit(boardLimit(n)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid).filter((e) => Number.isFinite(e.speedrunMs)), n)
}

// The Obstacle Course's fastest times (PartyParkour.js), lowest first.
export async function fetchTopParkour(n) {
  if (switchedOff('leaderboards', { quiet: true })) throw switchedOffError('leaderboards')
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.orderBy('parkourMs', 'asc'), fsMod.limit(boardLimit(n)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid).filter((e) => Number.isFinite(e.parkourMs)), n)
}

// The Duel Arena's best ratings (PartyDuel.js), highest first.
export async function fetchTopDuels(n) {
  if (switchedOff('leaderboards', { quiet: true })) throw switchedOffError('leaderboards')
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.orderBy('duelRating', 'desc'), fsMod.limit(boardLimit(n)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid).filter((e) => Number.isFinite(e.duelRating)), n)
}

export async function fetchTopByAchievements(n) {
  if (switchedOff('leaderboards', { quiet: true })) throw switchedOffError('leaderboards')
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.orderBy('achievementCount', 'desc'), fsMod.limit(boardLimit(n)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid), n)
}

// Global average comparison - a real server-side AVG aggregation (not a
// download-every-doc-and-average-client-side), same cheap-query shape as
// the COUNT-based rank/rival lookups above. Two separate single-field
// aggregate calls, not one combined { avgKills, avgNight } call - the
// combined form made Firestore demand a composite index (a one-time
// Console step); two independent single-field averages need no index at
// all, so this stays zero-setup like every other read here.
export async function fetchGlobalAverages() {
  const { db, fsMod } = await ensureApp()
  const coll = fsMod.collection(db, 'leaderboard')
  const [killsSnap, nightSnap] = await Promise.all([
    fsMod.getAggregateFromServer(coll, { avgKills: fsMod.average('bestKills') }),
    fsMod.getAggregateFromServer(coll, { avgNight: fsMod.average('bestNight') }),
  ])
  return { avgKills: killsSnap.data().avgKills || 0, avgNight: nightSnap.data().avgNight || 0 }
}

// Friend/Rival comparison - reuses the same public leaderboard collection
// (name is already public data there) rather than a separate "friends"
// system with its own lookup/storage. Exact, case-sensitive match on the
// nickname the friend chose - simplest thing that works without a
// dedicated username index. uid comes from the doc's own ID (leaderboard
// docs are keyed by uid, see pushLeaderboardEntry - never a stored field),
// needed by sendFriendRequest below to know who to actually send to.
export async function fetchLeaderboardEntryByName(name) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('name', '==', name), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : { ...snap.docs[0].data(), uid: snap.docs[0].id }
}

// Add a Friend by name (2026-10-10, Gaymi: "they can also use names ...
// a list will pop up showing all the names"): players whose leaderboard
// name starts with what was typed. Firestore has no case-insensitive
// search and the leaderboard doc carries no lowercase copy of the name, so
// it asks for the typed text as-is, Capitalized, lower and UPPER case and
// merges the results - one plain range query on `name` each, no index.
export async function searchLeaderboardByName(text, n = 8) {
  const raw = String(text || '').trim()
  if (!raw) return []
  const { db, fsMod } = await ensureApp()
  const variants = [...new Set([raw, raw[0].toUpperCase() + raw.slice(1), raw.toLowerCase(), raw.toUpperCase()])]
  const found = new Map()
  await Promise.all(variants.map(async (v) => {
    const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('name', '>=', v), fsMod.where('name', '<', v + '\uf8ff'), fsMod.limit(n))
    const snap = await fsMod.getDocs(q)
    for (const d of snap.docs) found.set(d.id, { ...d.data(), uid: d.id })
  }))
  return [...found.values()].slice(0, n * 2)
}

// Add Friend by ID - same shape as fetchLeaderboardEntryByName above, just
// keyed on the stable random playerId (see Game.js's _generatePlayerId)
// instead of the nickname, since a nickname can change and isn't
// guaranteed unique. playerId is only present on a leaderboard doc once
// its owner has completed at least one run (see _pushOnlineStats in
// Game.js, same as every other field on this doc) - a brand new signed-in
// account with zero runs can't be found by ID yet, same existing
// limitation nickname lookup already has.
export async function fetchLeaderboardEntryByPlayerId(playerId) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('playerId', '==', playerId), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : { ...snap.docs[0].data(), uid: snap.docs[0].id }
}

// Global rank - a COUNT aggregation (how many players have a strictly
// better bestNight than mine, +1), not a full download-and-sort of the
// whole leaderboard. Same sort key fetchTopLeaderboard already uses, so
// "rank" here always means the same thing the Leaderboard list shows.
export async function fetchMyGlobalRank(bestNight) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '>', bestNight))
  const snap = await fsMod.getCountFromServer(q)
  return snap.data().count + 1
}

// Nearest rival - the single leaderboard entry with the smallest
// bestNight that's still strictly above mine (i.e. whoever's directly
// above me in rank), for the "N nights to pass X" nudge.
export async function fetchNearestRivalAbove(bestNight) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '>', bestNight), fsMod.orderBy('bestNight', 'asc'), fsMod.limit(boardLimit(1)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid), 1)[0] || null
}

// Nearby Rank mini-leaderboard (Cloud Save panel) - same two-directional
// query shape as fetchNearestRivalAbove, just n docs each way instead of
// 1, run in parallel. "above" comes back ascending (nearest-to-you
// first), "below" descending (also nearest-to-you first) - the caller
// reverses "above" before rendering so the combined list reads
// highest-to-lowest top to bottom, same as the main leaderboard.
export async function fetchNearbyRank(bestNight, n) {
  const { db, fsMod } = await ensureApp()
  const [aboveSnap, belowSnap] = await Promise.all([
    fsMod.getDocs(fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '>', bestNight), fsMod.orderBy('bestNight', 'asc'), fsMod.limit(boardLimit(n)))),
    fsMod.getDocs(fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '<', bestNight), fsMod.orderBy('bestNight', 'desc'), fsMod.limit(boardLimit(n)))),
  ])
  return {
    above: shownRows(aboveSnap.docs.map(withUid), n),
    below: shownRows(belowSnap.docs.map(withUid), n),
  }
}

// Weekly Challenge cloud leaderboard - a fresh sub-collection per week
// (weekStr matches _thisWeekStr()'s own format, e.g. "2026-W31"), so old
// weeks' rankings stay intact rather than getting overwritten every week.
export async function pushWeeklyLeaderboardEntry(weekStr, uid, entry) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'weeklyLeaderboard', weekStr, 'entries', uid), { ...wholeNumbers(entry), updatedAt: Date.now() })
}

export async function fetchTopWeeklyLeaderboard(weekStr, n) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'weeklyLeaderboard', weekStr, 'entries'), fsMod.orderBy('progress', 'desc'), fsMod.limit(boardLimit(n)))
  const snap = await fsMod.getDocs(q)
  return shownRows(snap.docs.map(withUid), n)
}

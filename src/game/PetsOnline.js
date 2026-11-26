// Pets online - pet battle trophies (all-time + weekly boards), friend pet
// battles and co-op raids (petDuels / petRaids), battle cheers, and pet
// trading (petTrades). Moved out of CloudSync.js (2026-11-26); CloudSync.js
// re-exports all of it, so callers still use CloudSync.xxx. "The ... rules
// above" in the comments below means the rules notes at the top of
// CloudSync.js. Ghost teams and Gauntlet teams stayed in CloudSync.js.
// ensureApp comes back from CloudSync.js - the circular import is fine
// because it's only called at run time, never while modules load.
import { ensureApp } from './CloudSync.js'

// Pet battle leaderboard (PetRank.js, Batch M; see the petTrophies rules
// above). Both docs at once: all-time and this week's.
export async function savePetTrophies(uid, week, { nickname, tr, n }) {
  const { db, fsMod } = await ensureApp()
  const at = fsMod.serverTimestamp()
  await Promise.all([
    fsMod.setDoc(fsMod.doc(db, 'petTrophies', uid), { nickname, tr, at }),
    fsMod.setDoc(fsMod.doc(db, 'petTrophyWeeks', String(week), 'entries', uid), { nickname, n, tr, at }),
  ])
}

// The top n: all-time (week null, by tr) or one week's (by n).
function petTrophyCol(fsMod, db, week) {
  return week == null ? fsMod.collection(db, 'petTrophies') : fsMod.collection(db, 'petTrophyWeeks', String(week), 'entries')
}
export async function fetchPetTrophyTop(week, n = 50) {
  const { db, fsMod } = await ensureApp()
  const field = week == null ? 'tr' : 'n'
  const snap = await fsMod.getDocs(fsMod.query(petTrophyCol(fsMod, db, week), fsMod.orderBy(field, 'desc'), fsMod.limit(n)))
  return snap.docs.map((d) => ({ ...d.data(), uid: d.id }))
}

// My place: how many have more (a COUNT, not a download), +1.
export async function fetchPetTrophyRank(week, score) {
  const { db, fsMod } = await ensureApp()
  const field = week == null ? 'tr' : 'n'
  const snap = await fsMod.getCountFromServer(fsMod.query(petTrophyCol(fsMod, db, week), fsMod.where(field, '>', score)))
  return snap.data().count + 1
}

// Some players' docs (friends): all-time, plus this week's n.
export async function fetchPetTrophies(uids, week) {
  const { db, fsMod } = await ensureApp()
  return Promise.all(uids.map(async (uid) => {
    const [a, w] = await Promise.all([
      fsMod.getDoc(fsMod.doc(db, 'petTrophies', uid)),
      fsMod.getDoc(fsMod.doc(db, 'petTrophyWeeks', String(week), 'entries', uid)),
    ])
    return a.exists() ? { ...a.data(), n: w.exists() ? w.data().n : 0, uid } : null
  })).then((rows) => rows.filter(Boolean))
}

// Friend pet battles (FriendBattle.js, see the petDuels rules above).
// A new invite from me to a friend; returns its id. raid: a co-op boss
// raid invite instead (petRaids, Batch O) - raid = the boss's week.
export async function createPetDuel(from, fromName, to, team, raid = null) {
  const { db, fsMod } = await ensureApp()
  const ref = fsMod.doc(fsMod.collection(db, raid === null ? 'petDuels' : 'petRaids'))
  await fsMod.setDoc(ref, { from, fromName, to, state: 'ask', at: Date.now(), a: team, b: [], seed: 0, ...(raid === null ? {} : { boss: raid }) })
  return ref.id
}

// The friend's answer: yes (with their team and the dice seed) or no.
// Returns the invite as it was, or null if it was gone or already answered.
// col: 'petDuels' or 'petRaids' (and below).
export async function answerPetDuel(id, yes, team = [], seed = 0, col = 'petDuels') {
  const { db, fsMod } = await ensureApp()
  const ref = fsMod.doc(db, col, id)
  return fsMod.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    const d = snap.exists() ? snap.data() : null
    if (!d || d.state !== 'ask') return null
    tx.update(ref, yes ? { state: 'go', b: team, seed } : { state: 'no' })
    return { ...d, id }
  })
}

export async function deletePetDuel(id, col = 'petDuels') {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, col, id))
}

// callback(invite | null) whenever my invite changes (null = deleted).
export function watchPetDuel(id, callback, col = 'petDuels') {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    unsub = fsMod.onSnapshot(fsMod.doc(db, col, id), (snap) => callback(snap.exists() ? { ...snap.data(), id } : null), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// callback(invites) - the ones waiting for my answer, on every change.
export function subscribePetDuelInvites(uid, callback, col = 'petDuels') {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    const q = fsMod.query(fsMod.collection(db, col), fsMod.where('to', '==', uid), fsMod.where('state', '==', 'ask'), fsMod.limit(20))
    unsub = fsMod.onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// Friend battle cheers (see the petCheers rules above): my whole list of
// cheers so far in battle `duel`, as step * 4 + which cheer.
export async function sendPetCheers(duel, from, to, list) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'petCheers', `${duel}_${from}`), { duel, from, to, c: list.slice(0, 20), at: Date.now() })
}

export async function deletePetCheers(duel, from) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'petCheers', `${duel}_${from}`))
}

// Pet trading (PetTrade.js, see the petTrades rules above). side is 'a'
// (the one who asked) or 'b' (the friend).
const PET_TRADE_FIELDS = { state: 'ask', a: [], b: [], v: 0, ra: -1, rb: -1, ca: -1, cb: -1, ga: false, gb: false }

export async function createPetTrade(from, fromName, to) {
  const { db, fsMod } = await ensureApp()
  const ref = fsMod.doc(fsMod.collection(db, 'petTrades'))
  await fsMod.setDoc(ref, { from, fromName, to, at: Date.now(), ...PET_TRADE_FIELDS })
  return ref.id
}

async function petTradeTx(id, fn) {
  const { db, fsMod } = await ensureApp()
  const ref = fsMod.doc(db, 'petTrades', id)
  return fsMod.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    return fn(snap.exists() ? { ...snap.data(), id } : null, tx, ref)
  })
}

// The friend's answer. Returns the trade, or null if it was gone or taken.
export function answerPetTrade(id, yes) {
  return petTradeTx(id, (d, tx, ref) => {
    if (!d || d.state !== 'ask') return null
    tx.update(ref, { state: yes ? 'open' : 'no' })
    return { ...d, state: yes ? 'open' : 'no' }
  })
}

// My offer changed: returns the new v, or null.
export function setPetTradeOffer(id, side, list) {
  return petTradeTx(id, (d, tx, ref) => {
    if (!d || d.state !== 'open') return null
    tx.update(ref, { [side]: list, v: d.v + 1 })
    return d.v + 1
  })
}

// Ready on the offers as they were at v. True if it counted.
export function readyPetTrade(id, side, v) {
  return petTradeTx(id, (d, tx, ref) => {
    if (!d || d.state !== 'open' || d.v !== v) return false
    tx.update(ref, { [`r${side}`]: v })
    return true
  })
}

// Confirm (both Ready on v): 'done' when the other side had confirmed
// already, 'ok' when it's still their turn, null if it didn't count.
export function confirmPetTrade(id, side, v) {
  const other = side === 'a' ? 'b' : 'a'
  return petTradeTx(id, (d, tx, ref) => {
    if (!d || d.state !== 'open' || d.v !== v || d.ra !== v || d.rb !== v) return null
    const done = d[`c${other}`] === v
    tx.update(ref, done ? { [`c${side}`]: v, state: 'done' } : { [`c${side}`]: v })
    return done ? 'done' : 'ok'
  })
}

// My side of a finished trade, once (two devices can't both collect).
// The last one to collect deletes it. Returns the trade or null.
export function claimPetTrade(id, side) {
  const other = side === 'a' ? 'b' : 'a'
  return petTradeTx(id, (d, tx, ref) => {
    if (!d || d.state !== 'done' || d[`g${side}`]) return null
    if (d[`g${other}`]) tx.delete(ref)
    else tx.update(ref, { [`g${side}`]: true })
    return d
  })
}

export async function deletePetTrade(id) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'petTrades', id))
}

export function watchPetTrade(id, callback) {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    unsub = fsMod.onSnapshot(fsMod.doc(db, 'petTrades', id), (snap) => callback(snap.exists() ? { ...snap.data(), id } : null), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// callback(invites) - trade invites waiting for my answer.
export function subscribePetTradeInvites(uid, callback) {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    const q = fsMod.query(fsMod.collection(db, 'petTrades'), fsMod.where('to', '==', uid), fsMod.where('state', '==', 'ask'), fsMod.limit(20))
    unsub = fsMod.onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// Every trade I'm in (checked once at sign-in: finished ones not yet
// collected, and old ones to tidy away).
export async function fetchMyPetTrades(uid) {
  const { db, fsMod } = await ensureApp()
  const col = fsMod.collection(db, 'petTrades')
  const [a, b] = await Promise.all([
    fsMod.getDocs(fsMod.query(col, fsMod.where('from', '==', uid), fsMod.limit(20))),
    fsMod.getDocs(fsMod.query(col, fsMod.where('to', '==', uid), fsMod.limit(20))),
  ])
  return [...a.docs, ...b.docs].map((d) => ({ ...d.data(), id: d.id }))
}

// callback(list) whenever my friend's cheers in battle `duel` change.
export function watchPetCheers(duel, from, callback) {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    unsub = fsMod.onSnapshot(fsMod.doc(db, 'petCheers', `${duel}_${from}`), (snap) => callback(snap.exists() && Array.isArray(snap.data().c) ? snap.data().c : []), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

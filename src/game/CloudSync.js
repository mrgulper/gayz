// Cloud Save - Firebase Authentication (Google Sign-In) + Firestore.
//
// Firebase's free "Spark" plan needs no credit card and no billing account
// at all - Authentication and Firestore both have generous free quotas
// well beyond what a hobby game's save-sync needs. This replaced an
// earlier Google-Identity-Services-plus-Drive-appDataFolder design after
// hitting Google Cloud Console's separate "$300 free trial" onboarding
// wall (a different product, gated behind phone/card verification) -
// Firebase Console (console.firebase.google.com) doesn't have that wall.
//
// SETUP (one-time, done by the project owner, not by players):
// 1. https://console.firebase.google.com/ -> "Create a project" -> name it
//    (e.g. "gayz") -> you can decline Google Analytics, it's not needed.
// 2. Left sidebar -> "Build" -> "Authentication" -> "Get started" ->
//    "Sign-in method" tab -> enable "Google" -> pick a support email -> Save.
//    Firebase configures the underlying OAuth client for you - no manual
//    consent-screen setup needed.
// 3. Left sidebar -> "Build" -> "Firestore Database" -> "Create database" ->
//    pick any region close to your players -> start in **production mode**
//    (not test mode - production mode denies all access by default, which
//    is the safe starting point; see FIRESTORE_SECURITY_RULES below for the
//    exact rules this project needs, paste them into the "Rules" tab).
// 4. Project Settings (gear icon, top left) -> "General" tab -> scroll to
//    "Your apps" -> click the Web icon (</>) -> register an app (any
//    nickname) -> Firebase shows a `firebaseConfig` object. Copy every
//    field into FIREBASE_CONFIG below.
// 5. None of these values are secrets - Firebase's web config only says
//    "which project is this," not "who's allowed in." Real security comes
//    from the Firestore Security Rules (step 3), which is why those matter
//    much more than keeping this object private.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCCA9e3NAWk6MQJS-pnl-Lzq1Yn3nCZwVY',
  authDomain: 'gayz-aa69c.firebaseapp.com',
  projectId: 'gayz-aa69c',
  storageBucket: 'gayz-aa69c.firebasestorage.app',
  messagingSenderId: '539710194511',
  appId: '1:539710194511:web:51a5db83526e9445843b3a',
}

// Paste this exactly into Firebase Console -> Firestore Database -> Rules
// (replaces the earlier saves-only version - this is additive, saves/
// still works the same way). Online Features batch: global leaderboard,
// weekly-challenge leaderboard, a single incrementing global kill
// counter, and one-vote-per-account community poll voting.
//
// - leaderboard/{uid} and weeklyLeaderboard/{week}/entries/{uid}: public
//   read (that's the point of a leaderboard), but only the account that
//   owns a doc can write it, and only with plausible values - a client-
//   side edit could still lie about its own single entry, but can't
//   touch anyone else's or write absurd numbers.
// - stats/global: public read, signed-in write, but ONLY as a small
//   incremental bump to totalKills (never a full overwrite) - the
//   pre-existing value must be a number, the new value must be strictly
//   higher, and the jump per write is capped so one call can't fake a
//   huge spike. This doc must be created once by hand (Firestore Console
//   -> Start collection -> "stats" -> doc ID "global" -> field
//   totalKills, type number, value 0) since `allow create: if false`
//   deliberately blocks clients from creating it themselves.
// - polls/{pollId}/votes/{uid}: a vote is a doc whose ID IS the voter's
//   uid, and `allow create` (never update/delete) is what actually
//   enforces one-vote-per-account - once that doc exists, the same rule
//   that let them create it now blocks them from creating it again.
//   Results are read via a COUNT aggregation query (see
//   fetchPollResults), never by downloading every vote, so read access
//   can stay public without leaking who voted for what beyond "a doc
//   with their uid exists."
// - stats/telemetry: same increment-only shape as stats/global, but
//   deliberately does NOT require request.auth != null - unlike the kill
//   counter, this is meant to capture usage from every visitor, not just
//   signed-in ones. hasOnly(TELEMETRY_FIELDS) caps which fields a write
//   can touch (keep this list and incrementTelemetry's TELEMETRY_FIELDS
//   in sync by hand), each field must independently be strictly
//   increasing and capped per write, same reasoning as totalKills. This
//   doc also must be created once by hand (Firestore Console -> Start
//   collection -> "stats" -> doc ID "telemetry" -> 5 number fields,
//   settingsOpened/mutatorUsed/challengeStarted/shareUsed/crtEnabled,
//   each set to 0) since `allow create: if false` blocks clients here too.
export const FIRESTORE_SECURITY_RULES = `rules_version = '2';
service cloud.firestore {
  // Shared by stats/telemetry below - one field changed per write (see
  // incrementTelemetry, always a single-field updateDoc call), each field
  // independently must be a strictly-increasing int, capped per write so
  // one call can't fake a huge spike. Small cap (5, vs totalKills' 500) -
  // these are coarse UI-action counters, not per-run kill totals.
  function validTelemetryBump(field) {
    return resource.data[field] is int
      && request.resource.data[field] is int
      && request.resource.data[field] > resource.data[field]
      && request.resource.data[field] <= resource.data[field] + 5;
  }

  match /databases/{database}/documents {
    match /saves/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /leaderboard/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId
        && request.resource.data.bestNight is int && request.resource.data.bestNight >= 0 && request.resource.data.bestNight < 1000
        && request.resource.data.bestKills is int && request.resource.data.bestKills >= 0 && request.resource.data.bestKills < 1000000
        && request.resource.data.bestKillStreak is int && request.resource.data.bestKillStreak >= 0 && request.resource.data.bestKillStreak < 100000
        && request.resource.data.achievementCount is int && request.resource.data.achievementCount >= 0 && request.resource.data.achievementCount <= 19
        && (!('region' in request.resource.data) || request.resource.data.region in ['na', 'eu', 'asia', 'sa', 'oceania', 'africa']);
    }

    match /weeklyLeaderboard/{week}/entries/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId
        && request.resource.data.progress is int && request.resource.data.progress >= 0 && request.resource.data.progress < 1000000;
    }

    match /stats/global {
      allow read: if true;
      allow create: if false;
      allow update: if request.auth != null
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['totalKills'])
        && resource.data.totalKills is int
        && request.resource.data.totalKills is int
        && request.resource.data.totalKills > resource.data.totalKills
        && request.resource.data.totalKills <= resource.data.totalKills + 500;
    }

    match /stats/telemetry {
      allow read: if true;
      allow create: if false;
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['settingsOpened', 'mutatorUsed', 'challengeStarted', 'shareUsed', 'crtEnabled'])
        && request.resource.data.diff(resource.data).affectedKeys().size() == 1
        && (!('settingsOpened' in request.resource.data.diff(resource.data).affectedKeys()) || validTelemetryBump('settingsOpened'))
        && (!('mutatorUsed' in request.resource.data.diff(resource.data).affectedKeys()) || validTelemetryBump('mutatorUsed'))
        && (!('challengeStarted' in request.resource.data.diff(resource.data).affectedKeys()) || validTelemetryBump('challengeStarted'))
        && (!('shareUsed' in request.resource.data.diff(resource.data).affectedKeys()) || validTelemetryBump('shareUsed'))
        && (!('crtEnabled' in request.resource.data.diff(resource.data).affectedKeys()) || validTelemetryBump('crtEnabled'));
    }

    match /polls/{pollId}/votes/{userId} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == userId;
      allow update, delete: if false;
    }
  }
}`

export function isConfigured() {
  return !FIREBASE_CONFIG.apiKey.startsWith('REPLACE_WITH_')
}

let appPromise = null

// Firebase's SDK is only imported (and its ~lazy-loaded chunk fetched) once
// actually needed, not on every page load - most visitors never open the
// Cloud Save panel, so there's no reason to pay for this bundle up front.
async function ensureApp() {
  if (appPromise) return appPromise
  appPromise = (async () => {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])
    const app = initializeApp(FIREBASE_CONFIG)
    const auth = authMod.getAuth(app)
    const db = fsMod.getFirestore(app)
    return { app, auth, db, authMod, fsMod }
  })()
  return appPromise
}

export async function signIn() {
  const { auth, authMod } = await ensureApp()
  const provider = new authMod.GoogleAuthProvider()
  const result = await authMod.signInWithPopup(auth, provider)
  const user = result.user
  return { uid: user.uid, profile: { name: user.displayName, email: user.email, picture: user.photoURL } }
}

export async function signOut() {
  const { auth, authMod } = await ensureApp()
  await authMod.signOut(auth)
}

// Fires immediately with the current user (or null) and again on every
// sign-in/sign-out/session-restore - Firebase persists auth state itself
// (IndexedDB), so unlike a raw OAuth access token this survives a page
// reload without needing our own "cached profile + silent re-auth" logic.
export async function onAuthChange(callback) {
  const { auth, authMod } = await ensureApp()
  return authMod.onAuthStateChanged(auth, (user) => {
    callback(user ? { uid: user.uid, profile: { name: user.displayName, email: user.email, picture: user.photoURL } } : null)
  })
}

// Returns { data, modifiedTime } or null if this account has never synced
// before. `data` is the same untrusted-JSON blob _exportSave()/
// _importSaveFile() already treat as untrusted (see CLAUDE.md's Import
// Save note) - a Firestore document the player's own account controls is
// no more trustworthy than a file they picked off disk.
export async function fetchCloudSave(uid) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'saves', uid))
  if (!snap.exists()) return null
  const doc = snap.data()
  return { data: doc.data, modifiedTime: doc.updatedAt }
}

export async function pushCloudSave(uid, dataObj) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'saves', uid), { data: dataObj, updatedAt: Date.now() })
}

// Global Leaderboard - one doc per player, overwritten wholesale each push
// (not appended), so a player only ever has one entry regardless of how
// many times they've synced. entry: { name, bestNight, bestKills,
// bestKillStreak }, validated server-side by FIRESTORE_SECURITY_RULES.
export async function pushLeaderboardEntry(uid, entry) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'leaderboard', uid), { ...entry, updatedAt: Date.now() })
}

// region: optional, one of REGION_OPTIONS (Game.js) - omitted or 'global'
// means worldwide, no filter applied.
export async function fetchTopLeaderboard(n, region) {
  const { db, fsMod } = await ensureApp()
  const constraints = [fsMod.orderBy('bestNight', 'desc'), fsMod.limit(n)]
  if (region && region !== 'global') constraints.unshift(fsMod.where('region', '==', region))
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), ...constraints)
  const snap = await fsMod.getDocs(q)
  return snap.docs.map((d) => d.data())
}

// Live subscription variant of fetchTopLeaderboard - used only while the
// Cloud Save panel's leaderboard list is actually visible (subscribed on
// open, unsubscribed on close/sign-out) rather than left running
// indefinitely, to keep the read cost bounded. Returns an unsubscribe
// function; callback fires once immediately with current data and again
// on every future change.
export function subscribeTopLeaderboard(n, region, callback) {
  let unsub = () => {}
  let cancelled = false
  ensureApp().then(({ db, fsMod }) => {
    if (cancelled) return
    const constraints = [fsMod.orderBy('bestNight', 'desc'), fsMod.limit(n)]
    if (region && region !== 'global') constraints.unshift(fsMod.where('region', '==', region))
    const q = fsMod.query(fsMod.collection(db, 'leaderboard'), ...constraints)
    unsub = fsMod.onSnapshot(q, (snap) => callback(snap.docs.map((d) => d.data())), () => {})
  })
  return () => {
    cancelled = true
    unsub()
  }
}

// Achievement-count leaderboard - same collection, sorted by a different
// field (achievementCount, pushed alongside bestNight/bestKills/
// bestKillStreak - see pushLeaderboardEntry's caller in Game.js).
export async function fetchTopByAchievements(n) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.orderBy('achievementCount', 'desc'), fsMod.limit(n))
  const snap = await fsMod.getDocs(q)
  return snap.docs.map((d) => d.data())
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
// dedicated username index.
export async function fetchLeaderboardEntryByName(name) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('name', '==', name), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : snap.docs[0].data()
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

// Total leaderboard size - a plain, unfiltered COUNT, used only to turn
// a rank number into a percentile (see Game.js's _renderPercentileLine).
export async function fetchLeaderboardTotalCount() {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getCountFromServer(fsMod.collection(db, 'leaderboard'))
  return snap.data().count
}

// Nearest rival - the single leaderboard entry with the smallest
// bestNight that's still strictly above mine (i.e. whoever's directly
// above me in rank), for the "N nights to pass X" nudge.
export async function fetchNearestRivalAbove(bestNight) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '>', bestNight), fsMod.orderBy('bestNight', 'asc'), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : snap.docs[0].data()
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
    fsMod.getDocs(fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '>', bestNight), fsMod.orderBy('bestNight', 'asc'), fsMod.limit(n))),
    fsMod.getDocs(fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('bestNight', '<', bestNight), fsMod.orderBy('bestNight', 'desc'), fsMod.limit(n))),
  ])
  return {
    above: aboveSnap.docs.map((d) => d.data()),
    below: belowSnap.docs.map((d) => d.data()),
  }
}

// Weekly Challenge cloud leaderboard - a fresh sub-collection per week
// (weekStr matches _thisWeekStr()'s own format, e.g. "2026-W31"), so old
// weeks' rankings stay intact rather than getting overwritten every week.
export async function pushWeeklyLeaderboardEntry(weekStr, uid, entry) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'weeklyLeaderboard', weekStr, 'entries', uid), { ...entry, updatedAt: Date.now() })
}

export async function fetchTopWeeklyLeaderboard(weekStr, n) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'weeklyLeaderboard', weekStr, 'entries'), fsMod.orderBy('progress', 'desc'), fsMod.limit(n))
  const snap = await fsMod.getDocs(q)
  return snap.docs.map((d) => d.data())
}

// Global Kill Counter - a single doc, bumped via Firestore's atomic
// increment() (not a read-then-write) so concurrent players incrementing
// at the same moment can't clobber each other's contribution. Requires
// stats/global to already exist (see FIRESTORE_SECURITY_RULES' own
// comment on the one-time manual setup) - silently no-ops if it doesn't,
// since a missing global counter shouldn't ever block a real run from
// ending.
export async function incrementGlobalKills(amount) {
  if (amount <= 0) return
  const { db, fsMod } = await ensureApp()
  try {
    await fsMod.updateDoc(fsMod.doc(db, 'stats', 'global'), { totalKills: fsMod.increment(amount) })
  } catch {
    // Doc doesn't exist yet, or this single call exceeded the per-write
    // sanity cap in the security rules - either way, not worth surfacing
    // to the player over a flavor counter.
  }
}

export async function fetchGlobalKills() {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'stats', 'global'))
  return snap.exists() ? snap.data().totalKills : null
}

// Anonymous usage telemetry - Foundation Update: coarse counters (how many
// times has Settings ever been opened, a mutator used, etc. - no per-user
// breakdown, no personal data, nothing tied to an account) to get real
// usage signal on which of the ~400 features this project has shipped are
// actually used, instead of guessing. Same atomic-increment doc pattern as
// incrementGlobalKills above, but deliberately does NOT require
// request.auth != null (see FIRESTORE_SECURITY_RULES) - unlike the kill
// counter, this needs to work for every visitor, including the majority
// who never sign in, since "opened Settings" happens before anyone would.
// TELEMETRY_FIELDS is the one place both this function and the security
// rule's hasOnly(...) list need to agree on - keep them in sync by hand
// if a new field is ever added.
export const TELEMETRY_FIELDS = ['settingsOpened', 'mutatorUsed', 'challengeStarted', 'shareUsed', 'crtEnabled']

export async function incrementTelemetry(field) {
  if (!TELEMETRY_FIELDS.includes(field)) return
  const { db, fsMod } = await ensureApp()
  try {
    await fsMod.updateDoc(fsMod.doc(db, 'stats', 'telemetry'), { [field]: fsMod.increment(1) })
  } catch {
    // Doc doesn't exist yet (see this project's own manual-setup step,
    // same as stats/global) or hit the per-write cap - either way, never
    // worth surfacing to the player over a background usage counter.
  }
}

// Community Poll - one vote doc per account (id = uid), `create`-only
// permission is what makes this one-vote-per-account (see
// FIRESTORE_SECURITY_RULES' own comment). Results are read via a COUNT
// aggregation query per option rather than downloading every vote.
export async function castPollVote(pollId, uid, option) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'polls', pollId, 'votes', uid), { option, votedAt: Date.now() })
}

export async function fetchMyPollVote(pollId, uid) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'polls', pollId, 'votes', uid))
  return snap.exists() ? snap.data().option : null
}

export async function fetchPollResults(pollId, options) {
  const { db, fsMod } = await ensureApp()
  const counts = {}
  for (const option of options) {
    const q = fsMod.query(fsMod.collection(db, 'polls', pollId, 'votes'), fsMod.where('option', '==', option))
    const snap = await fsMod.getCountFromServer(q)
    counts[option] = snap.data().count
  }
  return counts
}

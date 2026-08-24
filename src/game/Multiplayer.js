// Multiplayer (Phase 1: invite link + lobby) - Firebase Realtime Database,
// not Firestore (Cloud Save's product) - RTDB is built for fast streaming
// updates, which is what a live player list (and later, live zombie/loot
// state) needs. Same Firebase project as Cloud Save, different product.
//
// SETUP (one-time, done by the project owner):
// 1. Firebase Console -> Build -> Realtime Database -> Create Database ->
//    locked mode. Copy the databaseURL it shows you into
//    MULTIPLAYER_DATABASE_URL below.
// 2. Firebase Console -> Build -> Authentication -> Sign-in method -> add
//    the Anonymous provider.
// 3. Realtime Database -> Rules tab -> paste MULTIPLAYER_SECURITY_RULES
//    (exported below) -> Publish.
import { FIREBASE_CONFIG } from './CloudSync.js'

const MULTIPLAYER_DATABASE_URL = 'https://gayz-aa69c-default-rtdb.firebaseio.com'

// Every rule below keys off auth.uid (the real Firebase Auth identity, see
// ensureSignedIn() below) - never a client-supplied nickname/ID, since a
// client could claim to be anyone. A player who's already Google-signed-in
// for Cloud Save uses that same uid here too (ensureSignedIn() only signs
// in anonymously if nobody's signed in yet).
//
// .read is a plain "any signed-in user" check, not gated on already being
// a player - a first version required already being listed in `players`
// to read a session at all, which made it impossible for a brand-new
// guest to ever read the session to check its status before joining
// (joinSession's own get() call was rejected by this exact rule, caught
// live via a real two-browser test). Sessions hold nothing sensitive
// (nicknames + game state), so open read access is a safe simplification.
export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      "$sessionId": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('host').val() === auth.uid)",
        "host": {
          ".validate": "!data.parent().parent().child('host').exists() || newData.val() === data.parent().parent().child('host').val()"
        },
        "players": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".read": "auth != null"
          }
        },
        "playerState": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".read": "auth != null"
          }
        }
      }
    }
  }
}`

export function isConfigured() {
  return MULTIPLAYER_DATABASE_URL !== 'REPLACE_WITH_DATABASE_URL'
}

let contextPromise = null

// Mirrors CloudSync.js's ensureApp() lazy-import pattern, but MUST NOT call
// initializeApp() unconditionally - CloudSync.js's own ensureApp() may have
// already initialized the default Firebase app (e.g. the player opened
// Cloud Save or Friends before ever touching multiplayer). Calling
// initializeApp() twice for the same unnamed app throws
// `Firebase: Firebase App named '[DEFAULT]' already exists`. getApps()
// lets both modules safely share one instance regardless of which one
// runs first.
async function ensureContext() {
  if (contextPromise) return contextPromise
  contextPromise = (async () => {
    if (!isConfigured()) throw new Error('Multiplayer is not configured yet - see Multiplayer.js setup comment')
    const [appMod, authMod, dbMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ])
    const existing = appMod.getApps()
    const app = existing.length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG)
    const auth = authMod.getAuth(app)
    const db = dbMod.getDatabase(app, MULTIPLAYER_DATABASE_URL)
    return { app, auth, authMod, db, dbMod }
  })()
  return contextPromise
}

// The security rules require auth != null on every read/write - a player
// who's already Google-signed-in (Cloud Save) already satisfies that, but
// most players never sign in at all, so this signs them in anonymously the
// first time multiplayer is actually used. Anonymous auth has to be turned
// on in Firebase Console (see setup comment above) or this throws.
export async function ensureSignedIn() {
  const { auth, authMod } = await ensureContext()
  if (auth.currentUser) return auth.currentUser.uid
  const result = await authMod.signInAnonymously(auth)
  return result.user.uid
}

// Same character set and length range as Game.js's own _generatePlayerId
// (friend/leaderboard IDs) - one consistent "short code" shape across the
// whole game rather than inventing a second format just for this.
const SESSION_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateSessionId() {
  const length = 6 + Math.floor(Math.random() * 5) // 6-10 inclusive
  let id = ''
  for (let i = 0; i < length; i++) id += SESSION_ID_CHARS[Math.floor(Math.random() * SESSION_ID_CHARS.length)]
  return id
}

// Returns { sessionId, uid } - callers need their own uid back (not just
// the session), e.g. to compare against a session's `host` field to decide
// whether to show the Start button.
export async function createSession(nickname) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const sessionId = generateSessionId()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  await dbMod.set(sessionRef, {
    host: uid,
    createdAt: dbMod.serverTimestamp(),
    status: 'lobby',
    players: {
      [uid]: { nickname, joinedAt: dbMod.serverTimestamp(), connected: true },
    },
  })
  // Presence: if this tab closes/loses connection, flip connected false
  // automatically - Firebase runs this server-side the moment the socket
  // drops, no client-side cleanup code required.
  const presenceRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}/connected`)
  dbMod.onDisconnect(presenceRef).set(false)
  return { sessionId, uid }
}

// Returns { uid } for the same reason createSession does.
export async function joinSession(sessionId, nickname) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists()) throw new Error('Session not found')
  if (snapshot.val().status !== 'lobby') throw new Error('Session already started')
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.set(playerRef, { nickname, joinedAt: dbMod.serverTimestamp(), connected: true })
  const presenceRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}/connected`)
  dbMod.onDisconnect(presenceRef).set(false)
  return { uid }
}

export async function leaveSession(sessionId) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.remove(playerRef)
}

export async function subscribeToSession(sessionId, callback) {
  const { db, dbMod } = await ensureContext()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const unsubscribe = dbMod.onValue(sessionRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null)
      return
    }
    const val = snapshot.val()
    const players = Object.entries(val.players || {}).map(([uid, p]) => ({
      uid, nickname: p.nickname, connected: p.connected !== false,
    }))
    callback({ host: val.host, status: val.status, players })
  })
  return unsubscribe
}

export async function startSession(sessionId) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists() || snapshot.val().host !== uid) throw new Error('Only the host can start the session')
  await dbMod.update(sessionRef, { status: 'active' })
}

// Phase 2 (see docs/superpowers/specs/2026-08-21-multiplayer-design.md) -
// streamed a few times a second while a shared run is active (see
// Game.js's _tick() throttle) - one player's own position/facing/weapon/
// firing state. updatedAt lets a future phase detect a stale/stuck
// player (e.g. one whose tab froze) without needing presence tracking
// beyond what players/{uid}/connected already gives.

// Tracks which sessionId already has an onDisconnect() cleanup hook
// registered, so updatePlayerState (called ~10x/second from _tick()'s
// throttle) doesn't re-register it on every single call.
const _disconnectHookRegisteredFor = new Set()

export async function updatePlayerState(sessionId, state) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const stateRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState/${uid}`)
  if (!_disconnectHookRegisteredFor.has(sessionId)) {
    _disconnectHookRegisteredFor.add(sessionId)
    // This is the reliable cleanup path, not the explicit removePlayerState()
    // call Game.js makes on a graceful Quit to Menu - that call races
    // against _quitRunWithLegacyPayout()'s own window.location.reload()
    // (a real, already-documented hazard in this codebase - a reload can
    // tear down the page before an in-flight async write finishes) and
    // wouldn't fire at all for a closed tab or crashed browser. RTDB runs
    // onDisconnect() hooks server-side the moment the connection actually
    // drops, regardless of why - same pattern Phase 1 already uses for
    // players/{uid}/connected.
    dbMod.onDisconnect(stateRef).remove()
  }
  await dbMod.set(stateRef, { ...state, updatedAt: dbMod.serverTimestamp() })
}

export async function subscribeToPlayerStates(sessionId, callback) {
  const { db, dbMod } = await ensureContext()
  const statesRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState`)
  const unsubscribe = dbMod.onValue(statesRef, (snapshot) => {
    callback(snapshot.val() || {})
  })
  return unsubscribe
}

export async function removePlayerState(sessionId) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const stateRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState/${uid}`)
  await dbMod.remove(stateRef)
}

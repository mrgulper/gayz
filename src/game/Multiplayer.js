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

// REPLACE_WITH_DATABASE_URL - fill this in after creating the Realtime
// Database in Firebase Console (see setup steps above). isConfigured()
// stays false, and every function below throws a clear error, until this
// is set to the real URL.
const MULTIPLAYER_DATABASE_URL = 'REPLACE_WITH_DATABASE_URL'

export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      "$sessionId": {
        ".read": "auth != null && (data.child('players').child(auth.uid).exists() || !data.exists())",
        ".write": "auth != null && (!data.exists() || data.child('host').val() === auth.uid || (data.child('status').val() === 'lobby' && !data.child('players').child(auth.uid).exists() === false))",
        "host": {
          ".validate": "!data.parent().parent().child('host').exists() || newData.val() === data.parent().parent().child('host').val()"
        },
        "players": {
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

let dbPromise = null

// Mirrors CloudSync.js's ensureApp() lazy-import pattern, but MUST NOT call
// initializeApp() unconditionally - CloudSync.js's own ensureApp() may have
// already initialized the default Firebase app (e.g. the player opened
// Cloud Save or Friends before ever touching multiplayer). Calling
// initializeApp() twice for the same unnamed app throws
// `Firebase: Firebase App named '[DEFAULT]' already exists`. getApps()
// lets both modules safely share one instance regardless of which one
// runs first.
export async function ensureDatabase() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    if (!isConfigured()) throw new Error('Multiplayer is not configured yet - see Multiplayer.js setup comment')
    const [appMod, dbMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/database'),
    ])
    const existing = appMod.getApps()
    const app = existing.length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG)
    const db = dbMod.getDatabase(app, MULTIPLAYER_DATABASE_URL)
    return { app, db, dbMod }
  })()
  return dbPromise
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

export async function createSession(uid, nickname) {
  const { db, dbMod } = await ensureDatabase()
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
  return sessionId
}

export async function joinSession(sessionId, uid, nickname) {
  const { db, dbMod } = await ensureDatabase()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists()) throw new Error('Session not found')
  if (snapshot.val().status !== 'lobby') throw new Error('Session already started')
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.set(playerRef, { nickname, joinedAt: dbMod.serverTimestamp(), connected: true })
  const presenceRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}/connected`)
  dbMod.onDisconnect(presenceRef).set(false)
}

export async function leaveSession(sessionId, uid) {
  const { db, dbMod } = await ensureDatabase()
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.remove(playerRef)
}

export async function subscribeToSession(sessionId, callback) {
  const { db, dbMod } = await ensureDatabase()
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

export async function startSession(sessionId, uid) {
  const { db, dbMod } = await ensureDatabase()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists() || snapshot.val().host !== uid) throw new Error('Only the host can start the session')
  await dbMod.update(sessionRef, { status: 'active' })
}

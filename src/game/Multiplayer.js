// Multiplayer - routes everything through this site's own /api/multiplayer/*
// serverless functions instead of talking to Firebase directly from the
// browser. This exists specifically because ad blockers / privacy
// extensions commonly block firebaseio.com (Firebase Realtime Database's
// domain), which silently broke position-syncing for some players even
// though nothing about this traffic is ad- or tracking-related - see
// docs/superpowers/specs/2026-08-24-multiplayer-proxy-design.md.
//
// The actual data still lives in the same Firebase Realtime Database
// project as before - only the PATH there changed. The server-side half
// of this (api/_lib/firebaseAdmin.js + api/multiplayer/*.js) is what now
// talks to Firebase, using an admin credential that never reaches the
// browser, so no browser-side ad blocker can ever see or block it.
//
// Player identity is a random ID our own create/join endpoints hand out
// (replacing Firebase Anonymous Auth) - remembered here per session, the
// same role auth.uid used to play. This module stores it in _playerIdFor
// rather than requiring every caller in Game.js to track and pass it
// around themselves.

// SETUP (one-time, done by the project owner):
// 1. Firebase Console -> gear icon -> Project settings -> Service
//    accounts tab -> Generate new private key.
// 2. Vercel dashboard -> this project -> Settings -> Environment
//    Variables -> add FIREBASE_SERVICE_ACCOUNT_KEY, value = the entire
//    contents of that downloaded key file, for all three environments.
// 3. Realtime Database -> Rules tab -> paste MULTIPLAYER_SECURITY_RULES
//    (exported below) -> Publish. Safe to do any time after the server
//    endpoints are deployed and working - the Admin SDK bypasses these
//    rules entirely, they only ever governed direct client access, which
//    no longer happens at all.

// Deny-all: only the server's Admin SDK touches this data now (see the
// setup comment above) - there is no longer any legitimate reason for a
// browser to read or write this data directly, so this closes that off
// entirely rather than leaving an unused, unnecessarily-open door.
export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      ".read": false,
      ".write": false
    }
  }
}`

async function _apiCall(path, body) {
  const res = await fetch(`/api/multiplayer/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// sessionId -> playerId, set by createSession/joinSession, read by
// syncPlayerState/leave/leaveBeacon - this is this module's replacement
// for Firebase Auth's "who am I" concept, scoped per session instead of
// per browser tab.
const _playerIdFor = new Map()

export async function createSession(nickname) {
  const { sessionId, playerId } = await _apiCall('create', { nickname })
  _playerIdFor.set(sessionId, playerId)
  return { sessionId, uid: playerId }
}

export async function joinSession(sessionId, nickname) {
  const { playerId } = await _apiCall('join', { sessionId, nickname })
  _playerIdFor.set(sessionId, playerId)
  return { uid: playerId }
}

// Writes this player's own state and returns everyone else's current
// state in the same round trip - replaces the old separate
// updatePlayerState (write) + subscribeToPlayerStates (live subscribe)
// pair. There's no persistent connection any more; the caller (Game.js's
// _tick() throttle) is expected to call this repeatedly, a few times a
// second, and re-render from whatever it gets back each time.
// state may include zombies (host's snapshot) and/or hits (a guest's
// self-reported shots) alongside the usual position fields - see
// docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md.
// Returns the whole response now (states/zombies/pendingHits), not just
// states, since callers need all three.
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {},
  }
}

export async function leave(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) return
  await _apiCall('leave', { sessionId, playerId })
  _playerIdFor.delete(sessionId)
}

// Synchronous, fire-and-forget version of leave() specifically for the
// "quitting the game" moment - navigator.sendBeacon() is a browser
// feature guaranteed to actually deliver the request even as the page is
// closing/reloading, unlike a normal fetch() (which can and does lose
// that race - see this codebase's own documented window.location.reload()
// hazard). No .catch() needed - sendBeacon doesn't return a promise to
// reject, just a boolean for whether the browser accepted queuing it.
export function leaveBeacon(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) return
  const blob = new Blob([JSON.stringify({ sessionId, playerId })], { type: 'application/json' })
  navigator.sendBeacon('/api/multiplayer/leave', blob)
  _playerIdFor.delete(sessionId)
}

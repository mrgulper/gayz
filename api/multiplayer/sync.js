// POST { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring,
//        zombies?, hits? }
//   -> { states, zombies, pendingHits }
// Merges what used to be two separate calls (updatePlayerState +
// subscribeToPlayerStates) into one round trip: write your own state,
// read everyone else's, in the same request. There's no live push
// connection any more (that's what made this whole feature reachable by
// ad blockers) - the client just calls this a few times a second and
// gets a fresh answer every time (polling).
//
// Phase 3 (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md)
// adds zombie state to this same call rather than a new endpoint: the
// host includes its current zombie snapshot (zombies), and a guest
// includes any shots it resolved locally since its last sync (hits) - a
// guest's own game trusts its own hit-detection instead of the host
// re-validating every shot, a deliberate simplicity choice documented in
// that spec. The server decides who's the host from the session's own
// stored `host` field, never from a client claim, so a guest can't just
// send a zombies snapshot and have it accepted.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// A player who hasn't sent an update in this long is treated as gone -
// the fallback for a crash/dropped connection that never got to send an
// explicit "leave" call. Deliberately short (see this project's spec,
// "Disconnect Handling") since a normal quit uses navigator.sendBeacon
// via the leave endpoint instead and doesn't rely on this timeout at all.
const STALE_MS = 2500

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const now = Date.now()

  await sessionRef.child(`playerState/${playerId}`).set({
    x, y, z, rotY, currentWeapon, isFiring, updatedAt: now,
  })

  const hostSnapshot = await sessionRef.child('host').once('value')
  const isHost = hostSnapshot.val() === playerId

  if (isHost && Array.isArray(zombies)) {
    const zombiesById = {}
    for (const zb of zombies) {
      zombiesById[zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type,
        // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
        // drives a guest-side cosmetic throat-glow pulse for the screamer
        // type only; harmless/ignored for every other type.
        screaming: !!zb.screaming, updatedAt: now,
      }
    }
    await sessionRef.child('world/zombies').set(zombiesById)
  }

  if (!isHost && Array.isArray(hits) && hits.length) {
    // Guests append to a shared inbox the host drains on its own next
    // sync call below - never applied here server-side. The host's own
    // game is what actually calls the zombie's real damage method, this
    // endpoint just relays the report.
    const updates = {}
    for (const hit of hits) {
      const key = sessionRef.child('world/pendingHits').push().key
      updates[`world/pendingHits/${key}`] = {
        zombieId: hit.zombieId, damage: hit.damage, bypassShield: !!hit.bypassShield, fromPlayerId: playerId,
      }
    }
    await sessionRef.update(updates)
  }

  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }

  const [stateSnapshot, playersSnapshot, zombiesSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
  ])
  const allStates = stateSnapshot.val() || {}
  const allPlayers = playersSnapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player' }
  }

  res.status(200).json({ states, zombies: zombiesSnapshot.val() || {}, pendingHits })
}

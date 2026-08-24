// POST { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring }
//   -> { states: { [otherPlayerId]: {...} } }
// Merges what used to be two separate calls (updatePlayerState +
// subscribeToPlayerStates) into one round trip: write your own state,
// read everyone else's, in the same request. There's no live push
// connection any more (that's what made this whole feature reachable by
// ad blockers) - the client just calls this a few times a second and
// gets a fresh answer every time (polling).
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// A player who hasn't sent an update in this long is treated as gone -
// the fallback for a crash/dropped connection that never got to send an
// explicit "leave" call. Deliberately short (see this project's spec,
// "Disconnect Handling") since a normal quit uses navigator.sendBeacon
// via the leave endpoint instead and doesn't rely on this timeout at all.
const STALE_MS = 2500

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const now = Date.now()

  await sessionRef.child(`playerState/${playerId}`).set({
    x, y, z, rotY, currentWeapon, isFiring, updatedAt: now,
  })

  const snapshot = await sessionRef.child('playerState').once('value')
  const all = snapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(all)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = state
  }

  res.status(200).json({ states })
}

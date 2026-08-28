// POST { sessionId, playerId } -> { skinDataUrl }
// A dedicated one-off lookup, deliberately NOT folded into sync.js's own
// per-tick response - a player's skin never changes mid-session (see
// create.js/join.js, where it's written once), so Game.js's
// _renderRemotePlayers only ever calls this once per remote player id,
// the first time it's newly seen, rather than resending a several-KB
// image on every ~100ms sync poll for the whole session.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const snapshot = await db.ref(`multiplayerSessions/${sessionId}/players/${playerId}/skinDataUrl`).once('value')
  res.status(200).json({ skinDataUrl: snapshot.val() || null })
}

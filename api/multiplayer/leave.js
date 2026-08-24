// POST { sessionId, playerId } -> { ok: true }
// Called two ways from the game: a normal fetch() when leaving
// deliberately mid-session, and navigator.sendBeacon() specifically for
// the "quitting the game" moment (see Task 4) - sendBeacon is guaranteed
// by the browser to actually deliver even as the page is closing, unlike
// a normal fetch() racing a reload.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  await Promise.all([
    sessionRef.child(`players/${playerId}`).remove(),
    sessionRef.child(`playerState/${playerId}`).remove(),
  ])

  res.status(200).json({ ok: true })
}

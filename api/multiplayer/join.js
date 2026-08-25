// POST { sessionId, nickname } -> { playerId }
// Joinable any time after a session is created - no lobby/status gate
// (removed earlier this project at Gaymi's request; see Multiplayer.js's
// own history for that decision).
import { randomUUID } from 'node:crypto'
import { getAdminDb } from '../_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, nickname } = req.body || {}
  if (!sessionId || !nickname) {
    return res.status(400).json({ error: 'sessionId and nickname are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const snapshot = await sessionRef.once('value')
  if (!snapshot.exists()) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const playerId = randomUUID()
  const joinedAt = Date.now()
  await sessionRef.child(`players/${playerId}`).set({ nickname, joinedAt })

  res.status(200).json({ playerId, joinedAt })
}

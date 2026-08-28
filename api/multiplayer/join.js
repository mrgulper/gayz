// POST { sessionId, nickname } -> { playerId }
// Joinable any time after a session is created - no lobby/status gate
// (removed earlier this project at Gaymi's request; see Multiplayer.js's
// own history for that decision).
import { randomUUID } from 'node:crypto'
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// See create.js's own comment on this same cap/shape check.
const MAX_SKIN_DATA_URL_LENGTH = 50000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, nickname, skinDataUrl } = req.body || {}
  if (!sessionId || !nickname) {
    return res.status(400).json({ error: 'sessionId and nickname are required' })
  }
  const validSkin = typeof skinDataUrl === 'string' && skinDataUrl.startsWith('data:image/') && skinDataUrl.length <= MAX_SKIN_DATA_URL_LENGTH
    ? skinDataUrl
    : null

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const snapshot = await sessionRef.once('value')
  if (!snapshot.exists()) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const playerId = randomUUID()
  const joinedAt = Date.now()
  const playerEntry = { nickname, joinedAt }
  if (validSkin) playerEntry.skinDataUrl = validSkin
  await sessionRef.child(`players/${playerId}`).set(playerEntry)

  res.status(200).json({ playerId, joinedAt })
}

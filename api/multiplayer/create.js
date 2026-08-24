// POST { nickname } -> { sessionId, playerId }
// playerId is a random ID this endpoint mints - it replaces Firebase
// Anonymous Auth's uid. The browser never signs in to Firebase at all
// any more; this ID is the only thing proving "which player is this" on
// every later call (sync, leave), same spirit as a private room code.
import { randomUUID, randomInt } from 'node:crypto'
import { getAdminDb } from '../_lib/firebaseAdmin.js'

const SESSION_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generateSessionId() {
  const length = 6 + randomInt(5) // 6-10 inclusive, same shape as the old client-side generator
  let id = ''
  for (let i = 0; i < length; i++) id += SESSION_ID_CHARS[randomInt(SESSION_ID_CHARS.length)]
  return id
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { nickname } = req.body || {}
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'nickname is required' })
  }

  const db = getAdminDb()
  const sessionId = generateSessionId()
  const playerId = randomUUID()
  const now = Date.now()

  await db.ref(`multiplayerSessions/${sessionId}`).set({
    host: playerId,
    createdAt: now,
    players: {
      [playerId]: { nickname, joinedAt: now },
    },
  })

  res.status(200).json({ sessionId, playerId })
}

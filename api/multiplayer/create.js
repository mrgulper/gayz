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

// Data-URL PNGs only (see loadSkinTexture's own two accepted source
// shapes) - a plain string field on the same players/{playerId} node
// nickname already lives on, read back once per remote player by
// player-skin.js rather than attached to every sync response (a 64x64
// skin is a few KB - resending it every ~100ms poll for every player in
// the session would add up fast for something that essentially never
// changes mid-match, unlike position). Capped well above any real skin's
// encoded size purely as a sanity bound against a malformed/huge value.
const MAX_SKIN_DATA_URL_LENGTH = 50000

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { nickname, skinDataUrl } = req.body || {}
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'nickname is required' })
  }
  const validSkin = typeof skinDataUrl === 'string' && skinDataUrl.startsWith('data:image/') && skinDataUrl.length <= MAX_SKIN_DATA_URL_LENGTH
    ? skinDataUrl
    : null

  const db = getAdminDb()
  const sessionId = generateSessionId()
  const playerId = randomUUID()
  const now = Date.now()

  const playerEntry = { nickname, joinedAt: now }
  if (validSkin) playerEntry.skinDataUrl = validSkin

  await db.ref(`multiplayerSessions/${sessionId}`).set({
    host: playerId,
    createdAt: now,
    players: {
      [playerId]: playerEntry,
    },
  })

  res.status(200).json({ sessionId, playerId, joinedAt: now })
}

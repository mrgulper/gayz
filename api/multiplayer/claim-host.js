// POST { sessionId, playerId } -> { ok: true } | { ok: false, reason }
// Called by whichever remaining player's own client independently computed
// itself as the correct successor (see Game.js's _tryClaimHost/
// _onHostConfirmedGone, docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md)
// once the current host appears to have disconnected. Never trusts the
// claim blindly - independently re-verifies the CURRENT host is actually
// stale before granting it, and uses a transaction on the `host` field so
// two near-simultaneous claims from different clients can't both succeed.
// This is also what protects the "old host was just a brief network blip,
// not really gone" case: if the real host's own next update lands before a
// claim is granted, that claim is rejected here.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// Same value as api/multiplayer/sync.js's own STALE_MS - duplicated rather
// than imported across files for one shared constant (these are separate
// serverless functions, no shared module between them today).
const STALE_MS = 2500

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)

  const hostSnapshot = await sessionRef.child('host').once('value')
  const currentHostId = hostSnapshot.val()
  if (!currentHostId) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const now = Date.now()
  const hostStateSnapshot = await sessionRef.child(`playerState/${currentHostId}`).once('value')
  const hostState = hostStateSnapshot.val()
  const hostIsStale = !hostState || now - hostState.updatedAt > STALE_MS
  if (!hostIsStale) {
    return res.status(200).json({ ok: false, reason: 'host-still-active' })
  }

  // The claiming player needs to actually be a real, currently-active
  // member of this session too (not itself stale/departed) - same
  // staleness check, just against the claimant instead of the host. This
  // project's established trust model (Phase 3's own spec) doesn't need
  // this to independently re-derive "the exact correct election winner" -
  // a wrong-but-active claimant is a benign wrong-host choice among
  // trusted friends, not a security problem.
  const claimantStateSnapshot = await sessionRef.child(`playerState/${playerId}`).once('value')
  const claimantState = claimantStateSnapshot.val()
  if (!claimantState || now - claimantState.updatedAt > STALE_MS) {
    return res.status(200).json({ ok: false, reason: 'claimant-not-active' })
  }

  const txResult = await sessionRef.child('host').transaction((current) => {
    // Abort if someone else's claim already won between the read above
    // and this transaction actually running - the standard optimistic-
    // concurrency guard, and the real tie-breaker if two clients' own
    // election computations briefly disagreed.
    if (current !== currentHostId) return undefined
    return playerId
  })

  if (!txResult.committed) {
    return res.status(200).json({ ok: false, reason: 'lost-race' })
  }

  res.status(200).json({ ok: true })
}

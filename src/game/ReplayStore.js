// Pet battle replays (pet battles round 4, Batch J, 2026-11-24): where
// they're kept. Only on this device (Gaymi picked): the last battle is
// always kept, plus up to SAVED_MAX the player saves. A replay is just
// the two teams, the dice's seed, the hazard and the cheers (with the
// step each one went off) - TeamBattle.js runs the same fight again from
// that. Written only when a battle ends or a button is pressed (never per
// frame). Read back as untrusted: TeamBattle escapes every name.
export const REPLAY_KEY = 'gayz-pet-replays'
export const SAVED_MAX = 10
export const REPLAY_V = 1

function ok(r) {
  return !!r && typeof r === 'object' && r.v === REPLAY_V && Number.isInteger(r.seed) &&
    Array.isArray(r.mine) && Array.isArray(r.theirs) && r.mine.length > 0 && r.theirs.length > 0 &&
    Array.isArray(r.ch) && Number.isFinite(r.t)
}

export function loadReplays() {
  try {
    const d = JSON.parse(localStorage.getItem(REPLAY_KEY) || 'null')
    return {
      last: ok(d?.last) ? d.last : null,
      saved: Array.isArray(d?.saved) ? d.saved.filter(ok).slice(0, SAVED_MAX) : [],
    }
  } catch {
    return { last: null, saved: [] }
  }
}

function store(d) {
  try {
    localStorage.setItem(REPLAY_KEY, JSON.stringify(d))
    return true
  } catch {
    return false // storage full or blocked: the replay just isn't kept
  }
}

// A battle just ended: it becomes the "last battle".
export function setLastReplay(rec) {
  if (!ok(rec)) return false
  const d = loadReplays()
  d.last = rec
  return store(d)
}

export const isSaved = (rec) => !!rec && loadReplays().saved.some((r) => r.t === rec.t)

// -> 'saved' | 'already' | 'full' | 'error'
export function saveReplay(rec) {
  if (!ok(rec)) return 'error'
  const d = loadReplays()
  if (d.saved.some((r) => r.t === rec.t)) return 'already'
  if (d.saved.length >= SAVED_MAX) return 'full'
  d.saved.unshift(rec)
  return store(d) ? 'saved' : 'error'
}

export function deleteReplay(t) {
  const d = loadReplays()
  d.saved = d.saved.filter((r) => r.t !== t)
  return store(d)
}

// Cloud Save merging - pure functions, no DOM/Firebase, so the rules can be
// tested directly.
//
// Why this exists (real report, 2026-09-28: "signed in with the same
// Google account on my iPad/iPhone and some stats aren't the same as my
// main device"): Cloud Save used to upload this device's ENTIRE local save
// over the cloud copy - blindly, with no check that another device had
// uploaded since this one last synced - and it did so every time settings
// were saved, which the settings autosave timer does every ~30s whether or
// not anything changed. So any device merely left open on the homepage
// kept re-uploading its own stale copy, silently undoing progress another
// device had just uploaded. Meanwhile real progress made between runs
// (shop purchases, quest claims, coins) was never uploaded at all until
// the next finished run.
//
// The fix is a normal three-way merge: every device remembers the exact
// cloud content it last synced with (the "base"). On sync, each key is
// compared across base / this device / the cloud, and only real changes
// from each side are combined - an untouched device can never overwrite
// anything, and changes made on two devices both survive.

// Never synced: bookkeeping about THIS device's own sync state, or state
// that only makes sense per device (Auto Quality's level is a measurement
// of this device's GPU; the avatar face cache is a render of local state).
export const CLOUD_BASE_KEY = 'gayz-cloud-base'
export const DEVICE_ONLY_KEYS = new Set([
  'gayz-cloud-last-sync',
  'gayz-last-local-change',
  CLOUD_BASE_KEY,
  'gayz-auto-quality-level',
  'gayz-avatar-face-cache',
])

// Keys whose numeric fields are running totals/balances - when both devices
// changed the same number, both changes are applied (base + both deltas):
// 100 coins earned on one device and 50 spent on the other nets +50, not
// "whichever device synced last". Numbers that are records or timestamps
// (see MAX_FIELD) take the higher value instead.
const ADDITIVE_KEYS = new Set([
  'gayz-shop-progress',
  'gayz-career-stats',
  'gayz-meta-progress',
  'gayz-weapon-mastery',
  'gayz-total-spent',
  'gayz-narrative-stats',
])
// Settings-like keys: a conflicting field goes to whichever device changed
// more recently. Their arrays are ordered, fixed-meaning lists (hotbar
// slots, nav order) where combining two versions would produce nonsense.
const NEWEST_WINS_KEYS = new Set(['gayz-settings', 'gayz-keybinds'])

const MAX_FIELD = /best|max|highest|longest|peak|record|streak|level|date|time|last|first|At$/i

// Only this game's own keys are account data. Anything else in
// localStorage belongs to a library (Firebase Auth writes/removes a
// "__sak" availability probe on every load and may keep its own session
// keys) - syncing those would upload one device's auth state to the cloud
// and write it onto other devices, and tracking them made every page load
// look like "progress changed" (part of the 2026-09-28 reload-loop report).
export function isSyncedKey(key) {
  return typeof key === 'string' && key.startsWith('gayz-') && !DEVICE_ONLY_KEYS.has(key)
}

export function syncableSnapshot(storage) {
  const data = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!isSyncedKey(key)) continue
    data[key] = storage.getItem(key)
  }
  return data
}

export function stripDeviceOnly(data) {
  const out = {}
  for (const key of Object.keys(data || {})) if (isSyncedKey(key)) out[key] = data[key]
  return out
}

export function sameData(a, b) {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (a[k] !== b[k]) return false
  return true
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function parse(raw) {
  if (raw === undefined) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

// b = base (undefined when this device has no base, or the field is new),
// l = this device, r = the cloud. undefined means "absent/deleted".
function mergeValue(b, l, r, ctx, field, hasBase) {
  // Totals first, before the "both sides agree" shortcut: two devices that
  // each finished one run both go 5 -> 6, and the right answer is 7. With
  // a base, "same new value on both sides" can only mean both changed it
  // independently (a device that had synced the other's change would have
  // it as its base). Also correct when only one side changed.
  if (ctx.additive && hasBase && typeof l === 'number' && typeof r === 'number' && typeof b === 'number' &&
      !MAX_FIELD.test(field) && l <= 1e12 && r <= 1e12) {
    return b + (l - b) + (r - b)
  }
  if (deepEqual(l, r)) return l
  if (hasBase) {
    if (deepEqual(l, b)) return r // only the cloud changed it
    if (deepEqual(r, b)) return l // only this device changed it
  }
  // Both sides changed (or there's no base to tell who did).
  if (l === undefined) return r
  if (r === undefined) return l
  if (isPlainObject(l) && isPlainObject(r)) {
    const bo = isPlainObject(b) ? b : {}
    const out = {}
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = mergeValue(bo[k], l[k], r[k], ctx, k, hasBase && isPlainObject(b))
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (typeof l === 'number' && typeof r === 'number') {
    if (ctx.newestWins) return ctx.preferLocal ? l : r
    if (MAX_FIELD.test(field) || l > 1e12 || r > 1e12) return Math.max(l, r)
    if (ctx.additive && hasBase && typeof b === 'number') return b + (l - b) + (r - b)
    return Math.max(l, r)
  }
  if (Array.isArray(l) && Array.isArray(r) && !ctx.newestWins) {
    // Unlocked achievements, owned skins, run history... - keep everything
    // either device has.
    const out = [...l]
    const seen = new Set(l.map((v) => JSON.stringify(v)))
    for (const v of r) {
      const s = JSON.stringify(v)
      if (!seen.has(s)) {
        seen.add(s)
        out.push(v)
      }
    }
    return out
  }
  if (typeof l === 'boolean' && typeof r === 'boolean' && !ctx.newestWins) {
    // One-way flags (tutorial seen, ending seen, purchased) - true wins.
    return l || r
  }
  return ctx.preferLocal ? l : r
}

// base: the {key: string} content this device last synced (null if it
// never has). preferLocal: this device's latest change is newer than the
// cloud's latest upload - decides settings-style conflicts (ignored
// without a base, see below).
export function mergeSaves(base, local, remote, preferLocal) {
  const hasBase = !!base
  // A device with no base has never synced (new device, or its browser
  // storage was wiped): everything it holds was just generated - a random
  // Player ID, a "Survivor####" name - so it never wins a conflict, however
  // recent its writes are. Letting it win (it always looks newest) replaced
  // a real account's ID and name with a fresh one, while coins survived
  // (they merge by max) - 2026-09-30 report.
  preferLocal = hasBase && preferLocal
  const out = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    if (!isSyncedKey(key)) continue
    const lRaw = local[key]
    const rRaw = remote[key]
    const bRaw = hasBase ? base[key] : undefined
    // (Totals keys skip this shortcut when both sides moved off the base -
    // see mergeValue's own first check.)
    if (lRaw === rRaw && !(ADDITIVE_KEYS.has(key) && hasBase && lRaw !== bRaw)) {
      if (lRaw !== undefined) out[key] = lRaw
      continue
    }
    if (hasBase && lRaw === bRaw) {
      if (rRaw !== undefined) out[key] = rRaw
      continue
    }
    if (hasBase && rRaw === bRaw) {
      if (lRaw !== undefined) out[key] = lRaw
      continue
    }
    const lp = parse(lRaw)
    const rp = parse(rRaw)
    const bp = parse(bRaw)
    if (!lp.ok || !rp.ok || !bp.ok) {
      // Plain (non-JSON) string values - nothing to combine field by field.
      const v = preferLocal ? (lRaw ?? rRaw) : (rRaw ?? lRaw)
      if (v !== undefined) out[key] = v
      continue
    }
    const ctx = { additive: ADDITIVE_KEYS.has(key), newestWins: NEWEST_WINS_KEYS.has(key), preferLocal }
    const merged = mergeValue(bp.value, lp.value, rp.value, ctx, key, hasBase)
    if (merged !== undefined) out[key] = JSON.stringify(merged)
  }
  return out
}

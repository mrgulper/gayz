// Cloud Save for Map Editor builds (2026-11-20, "whatever you do on your
// computer you will also see on your other device"). The main Cloud Save
// (CloudMerge.js) only takes `gayz-*` keys and lives in ONE Firestore doc
// (1 MiB cap); builds are big, so each build key gets its own doc under
// saves/{uid}/builds/{key}, plus one small `_index` doc listing every key's
// content hash. A normal page load reads only the index; a build's doc is
// downloaded only when its hash differs from what this device has.
//
// Builds are never field-merged (half of one device's map + half of
// another's would be a broken map): each key is a whole value. The merge
// base is the hash this device last agreed with the cloud on, per key:
//   - only the cloud changed  -> take the cloud's
//   - only this device changed -> upload
//   - both changed (or no base yet, e.g. two devices with builds from
//     before this existed): a save slot takes the cloud's version and this
//     device's version moves to a free slot, so neither build is lost;
//     Play best waves keep the higher per map; Map 1 edits keep both
//     devices' edits; anything else, the newer change wins.
// Same timing rules as the main save: pulled before the game is built
// (CloudPreBoot.js) or on an explicit click (then the page reloads);
// background syncs only upload.
//
// Imports nothing, so CloudPreBoot can use it before the game is built.

export const BUILD_SYNC_KEY = 'gayz-build-sync' // device-only (CloudMerge.DEVICE_ONLY_KEYS)
const SLOT_PREFIX = 'buildmode-slot-'
const THUMB_PREFIX = 'buildmode-thumb-'
const PLAY_BEST_KEY = 'buildmode-play-best'
const MAP3_EDITS_KEY = 'buildmode-map3-v8-edits'
const SINGLE_KEYS = new Set([MAP3_EDITS_KEY, PLAY_BEST_KEY, 'buildmode-sky', 'buildmode-shared-info'])
const NUMBERED_SLOTS = 10 // BuildSaves.SAVE_SLOT_COUNT
// One Firestore doc holds at most 1 MiB; leave room for the field names.
export const MAX_BUILD_CHARS = 900000

export function isBuildKey(key) {
  return typeof key === 'string' && (key.startsWith(SLOT_PREFIX) || key.startsWith(THUMB_PREFIX) || SINGLE_KEYS.has(key))
}

// Short content fingerprint (cyrb53 + length). null = no value.
export function hashValue(v) {
  if (v === null || v === undefined) return null
  const s = String(v)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + s.length
}

// { uid, base: {key: hash|null}, dirty: {key: changedAtMs} }. A base saved
// for another account is dropped (its builds then merge as "no base").
export function readBuildMeta(storage, uid) {
  let meta
  try {
    meta = JSON.parse(storage.getItem(BUILD_SYNC_KEY) || 'null')
  } catch {
    meta = null
  }
  if (!meta || typeof meta !== 'object') meta = {}
  const base = meta.base && typeof meta.base === 'object' ? meta.base : {}
  const dirty = meta.dirty && typeof meta.dirty === 'object' ? meta.dirty : {}
  if (uid && meta.uid && meta.uid !== uid) return { uid, base: {}, dirty }
  return { uid: uid || meta.uid || null, base, dirty }
}

export function writeBuildMeta(setItem, meta) {
  try {
    setItem(BUILD_SYNC_KEY, JSON.stringify(meta))
  } catch {
    // Storage full - the next sync just re-checks everything.
  }
}

// Called for every local write of a build key (CloudSaveUI's change
// tracking): remembers when, so a "both changed" clash can tell which side
// is newer. `setItem` must be the unpatched one.
export function markBuildChanged(storage, setItem, key) {
  const meta = readBuildMeta(storage, null)
  meta.dirty[key] = Date.now()
  writeBuildMeta(setItem, meta)
}

function localBuilds(storage) {
  const out = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (isBuildKey(key)) out[key] = storage.getItem(key)
  }
  return out
}

const isNumberedSlot = (key) => key.startsWith(SLOT_PREFIX) && /^\d+$/.test(key.slice(SLOT_PREFIX.length))

// Pure decision per key - exported for the tests.
// Returns 'same' | 'pull' | 'push' | 'clash'.
export function decideBuildKey(localHash, remoteHash, baseHash) {
  if (localHash === remoteHash) return 'same'
  const hasBase = baseHash !== undefined
  if (hasBase && localHash === baseHash) return 'pull'
  if (hasBase && remoteHash === baseHash) return 'push'
  // Both moved (or no base): one side being empty isn't a clash - keep
  // whichever side has something, so nothing is ever deleted by a merge.
  if (localHash === null) return 'pull'
  if (remoteHash === null) return 'push'
  return 'clash'
}

// Best wave per map: the higher one from either device.
export function mergePlayBest(a, b) {
  const read = (v) => {
    try {
      const o = JSON.parse(v)
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  const x = read(a)
  const y = read(b)
  const out = { ...x }
  for (const [k, v] of Object.entries(y)) {
    const n = Number(v) || 0
    if (!(Number(out[k]) >= n)) out[k] = n
  }
  return JSON.stringify(out)
}

// Map 1 edits from two devices: every block either removed, plus every
// block either placed (the newer side wins a spot both placed on).
export function mergeMap3Edits(newer, older) {
  let n
  let o
  try {
    n = JSON.parse(newer)
    o = JSON.parse(older)
  } catch {
    return newer
  }
  if (!n || !o || !Array.isArray(n.removed) || !Array.isArray(n.placed) || !Array.isArray(o.removed) || !Array.isArray(o.placed)) return newer
  const spot = (b) => `${b?.x},${b?.y},${b?.z}`
  const placed = new Map()
  for (const b of o.placed) placed.set(spot(b), b)
  for (const b of n.placed) placed.set(spot(b), b)
  const removed = [...new Set([...o.removed, ...n.removed])].filter((k) => typeof k === 'string')
  return JSON.stringify({ ...n, removed, placed: [...placed.values()] })
}

// The one entry point. backend: { fetchBuildIndex, fetchBuildDocs,
// pushBuild } (CloudSync, or a test fake) - a backend without them (older
// test fakes) skips build syncing. apply=false: upload only (background
// syncs). push=false: download only (the pre-boot pull). isCancelled: the
// pre-boot timeout. Returns { status, applied, pushed, tooBig }.
export async function syncBuilds({ storage, setItem, removeItem, uid, backend, apply = true, push = true, isCancelled = () => false }) {
  const result = { status: 'ok', applied: 0, pushed: 0, tooBig: [] }
  if (!uid || !backend || typeof backend.fetchBuildIndex !== 'function') return { ...result, status: 'unsupported' }
  const index = (await backend.fetchBuildIndex(uid)) || {}
  if (isCancelled()) return { ...result, status: 'cancelled' }
  const meta = readBuildMeta(storage, uid)
  const local = localBuilds(storage)
  const remoteHash = (k) => (index[k] && typeof index[k].h === 'string' ? index[k].h : null)
  const keys = new Set([...Object.keys(local), ...Object.keys(index).filter(isBuildKey)])

  const pulls = []
  const pushes = []
  const clashes = []
  for (const key of keys) {
    const lh = hashValue(local[key] ?? null)
    const rh = remoteHash(key)
    const d = decideBuildKey(lh, rh, key in meta.base ? meta.base[key] : undefined)
    if (d === 'same') {
      meta.base[key] = lh
      delete meta.dirty[key]
    } else if (d === 'pull') pulls.push(key)
    else if (d === 'push') pushes.push(key)
    else clashes.push(key)
  }

  // Downloads (and clashes, which need the cloud's value to settle).
  const writes = {}
  if (apply && (pulls.length || clashes.length)) {
    const wanted = new Set([...pulls, ...clashes])
    // A slot clash also needs the cloud's picture for that slot.
    for (const k of clashes) if (isNumberedSlot(k)) wanted.add(THUMB_PREFIX + k.slice(SLOT_PREFIX.length))
    const remote = (await backend.fetchBuildDocs(uid, [...wanted])) || {}
    if (isCancelled()) return { ...result, status: 'cancelled' }
    const handled = new Set()
    // Slots first, so a slot that moves takes its picture with it.
    clashes.sort((a, b) => isNumberedSlot(b) - isNumberedSlot(a))
    const taken = (i) => local[SLOT_PREFIX + i] != null || remoteHash(SLOT_PREFIX + i) !== null || (SLOT_PREFIX + i) in writes
    for (const key of clashes) {
      if (handled.has(key)) continue
      const lv = local[key]
      const rv = remote[key] ?? null
      if (rv === null) {
        pushes.push(key)
        continue
      }
      const localAt = Number(meta.dirty[key]) || 0
      const remoteAt = Number(index[key]?.at) || 0
      if (isNumberedSlot(key)) {
        let free = -1
        for (let i = 0; i < NUMBERED_SLOTS; i++) if (!taken(i)) { free = i; break }
        if (free >= 0) {
          // Cloud's build stays in this slot; this device's moves to `free`.
          const n = key.slice(SLOT_PREFIX.length)
          writes[key] = rv
          writes[SLOT_PREFIX + free] = lv
          const lThumb = local[THUMB_PREFIX + n]
          if (lThumb != null) writes[THUMB_PREFIX + free] = lThumb
          writes[THUMB_PREFIX + n] = remote[THUMB_PREFIX + n] ?? null
          handled.add(THUMB_PREFIX + n)
          pushes.push(SLOT_PREFIX + free)
          if (lThumb != null) pushes.push(THUMB_PREFIX + free)
          meta.base[key] = remoteHash(key)
          meta.base[THUMB_PREFIX + n] = remoteHash(THUMB_PREFIX + n)
          continue
        }
      }
      if (key === PLAY_BEST_KEY) {
        writes[key] = mergePlayBest(lv, rv)
        pushes.push(key)
      } else if (key === MAP3_EDITS_KEY) {
        writes[key] = localAt >= remoteAt ? mergeMap3Edits(lv, rv) : mergeMap3Edits(rv, lv)
        pushes.push(key)
      } else if (remoteAt > localAt) {
        writes[key] = rv
        meta.base[key] = remoteHash(key)
      } else {
        pushes.push(key)
      }
    }
    for (const key of pulls) {
      if (handled.has(key)) continue
      writes[key] = remote[key] ?? null
      meta.base[key] = remoteHash(key)
      delete meta.dirty[key]
    }
    // Synchronous: nothing else runs between these writes.
    for (const [key, value] of Object.entries(writes)) {
      if (value === null) removeItem(key)
      else setItem(key, value)
      result.applied++
    }
    for (const key of pushes) if (key in writes) delete meta.base[key] // still to upload
  }
  writeBuildMeta(setItem, meta)

  if (push) {
    for (const key of new Set(pushes)) {
      const value = storage.getItem(key)
      if (value !== null && value.length > MAX_BUILD_CHARS) {
        result.tooBig.push(key)
        continue
      }
      const h = hashValue(value)
      const at = await backend.pushBuild(uid, key, value, remoteHash(key), h)
      // false = another device uploaded this key first: the next sync
      // sees it as a clash and settles it.
      if (at === false) continue
      const fresh = readBuildMeta(storage, uid)
      // Changed again while uploading - leave it to be uploaded next time.
      if (storage.getItem(key) === value) {
        fresh.base[key] = h
        delete fresh.dirty[key]
      }
      writeBuildMeta(setItem, fresh)
      result.pushed++
    }
  }
  return result
}

import { t } from './i18n.js'
import { generateMap3 } from './Map3Generator.js'
import { inCity as cityCell, setFlatWorld } from './OpenWorld.js'
import { VALID_TYPE_IDS, BLOCK_BY_ID } from './BlockTypes.js'
import { FACED_SHAPES } from './BlockShapes.js'

// Build Mode's saving and loading: the save slots, slot pictures, Map 3's
// edits, shared maps, export/import and clearing the map. Moved out of
// BuildMode.js (2026-11-16) as-is - these are still BuildMode's own
// methods (addSaveMethods copies them onto it), so `this` is Build Mode.

// A new Plain map's platform (cells a side), void all round it.
const PLAIN_GROUND = 32
// Plain maps saved before 2026-11-16 have the old 128x128 grass ground
// saved in them (15,360 ground cells outside the middle 32x32). More than
// this many ground cells outside it = an old map, so it's cut down to the
// middle 32x32 on load (2026-11-25, Gaymi: anything built outside is lost,
// that's OK). A new map with a few blocks out in the void is left alone.
const OLD_PLAIN_GROUND_CELLS = 2000

// True if (x, z) is on the Plain platform (the middle 32x32).
const onPlainPlatform = (x, z) => x >= -PLAIN_GROUND / 2 && x < PLAIN_GROUND / 2 && z >= -PLAIN_GROUND / 2 && z < PLAIN_GROUND / 2

// An old 128x128 Plain map cut down to the middle 32x32 (blocks and
// animals outside it dropped), or null if it isn't an old one.
export function cropOldPlainMap(parsed) {
  const blocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.blocks) ? parsed.blocks : null
  if (!blocks) return null
  let outside = 0
  for (const b of blocks) {
    if (b && b.y === GROUND_LAYER_Y && !onPlainPlatform(Math.trunc(b.x), Math.trunc(b.z))) outside++
  }
  if (outside <= OLD_PLAIN_GROUND_CELLS) return null
  const kept = blocks.filter((b) => b && typeof b === 'object' && onPlainPlatform(Math.trunc(b.x), Math.trunc(b.z)))
  if (Array.isArray(parsed)) return kept
  const out = { ...parsed, blocks: kept }
  if (Array.isArray(parsed.animals)) out.animals = parsed.animals.filter((a) => a && onPlainPlatform(Math.floor(a.x), Math.floor(a.z)))
  return out
}

const SAVE_KEY = 'gayz-build-mode'
// Multiple save slots (see switchSlot/save/load) - was a single fixed key
// (v1's deliberately-scoped-down "one save slot" design). SAVE_SLOTS_KEY
// holds an array of SAVE_SLOT_COUNT entries (null = empty slot, or a
// snapshot object); SAVE_KEY itself is kept only as a one-time migration
// source (see _loadActiveSlot) so a build saved before slots existed isn't lost.
const SAVE_SLOTS_KEY = 'gayz-build-mode-slots'
export const SAVE_SLOT_COUNT = 10
// Since 2026-10-02 each slot is its own compact entry (rows of the same
// block stored once: see _encodeSlot). The old single array under
// SAVE_SLOTS_KEY held every slot as a plain block list - ~650 KB per map
// with the 128x128 ground, so a few saved maps already overran the
// browser's ~5 MB storage and Cloud Save's 1 MB document. Not gayz- keys:
// builds stay on the device (Export/Import still moves them).
const SLOT_KEY_PREFIX = 'buildmode-slot-'
const SLOTS_MIGRATED_KEY = 'buildmode-slots-migrated'
// Slot pictures (_saveSlotThumb), one small JPEG per slot.
const SLOT_THUMB_PREFIX = 'buildmode-thumb-'
const SLOT_THUMB_W = 96
const SLOT_THUMB_H = 54
// Map 3 (Map3Generator.js) is a ready-made city opened as its own slot.
// The map itself is regenerated every time (it's deterministic), so only
// the player's changes to it are stored: {removed: [keys], placed:
// [entries]}. Not a gayz- key on purpose - the whole map is ~42k blocks,
// and a player who clears it would push a huge list into Cloud Save.
export const MAP3_SLOT = 'map3'
// A map opened from a share code, Community Maps or a Build Together room
// (BuildShare.js / BuildTogether.js) - its own slot, so opening one never
// overwrites your own.
export const SHARED_SLOT = 'shared'
export const SHARED_INFO_KEY = 'buildmode-shared-info'
// Bumped (v2, v3) whenever the map changes - old edits wouldn't line up.
const MAP3_EDITS_KEY = 'buildmode-map3-v8-edits'
// When each slot was last saved, for the pause screen's Quick Info (not a
// gayz- key: it's per device and not worth syncing).
const SAVED_AT_KEY = 'buildmode-saved-at'

// The ground layer sits one cell below the walkable surface (y=0) - a
// block "at y" occupies the space from y to y+1, so a block at y=-1 has
// its top face flush with y=0, matching where the old static ground mesh's
// top surface used to sit.
const GROUND_LAYER_Y = -1
const GROUND_BLOCK_TYPE = 'grass'
// Removed/renamed block ids -> what old saves load them as.
const LEGACY_TYPE_IDS = { tnt: 'c4', tntslab: 'c4slab' }

class BuildSaves {
  // A small picture of the open map for its slot button (2026-10-04),
  // taken when the pause screen opens, before switching slots and on exit.
  // Device-only (not a gayz- key, so it never goes into Cloud Save).
  _saveSlotThumb(render = true) {
    if (!this.active) return
    if (this.activeSlot !== MAP3_SLOT && !this._slotExists(this.activeSlot)) return
    try {
      if (render) {
        this._noHand = true
        this.render()
        this._noHand = false
      }
      const src = this.renderer.domElement
      const c = document.createElement('canvas')
      c.width = SLOT_THUMB_W
      c.height = SLOT_THUMB_H
      const ctx = c.getContext('2d')
      // Crop the middle of the view to the thumbnail's shape.
      const scale = Math.min(src.width / SLOT_THUMB_W, src.height / SLOT_THUMB_H)
      const w = SLOT_THUMB_W * scale
      const h = SLOT_THUMB_H * scale
      ctx.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, SLOT_THUMB_W, SLOT_THUMB_H)
      const url = c.toDataURL('image/jpeg', 0.6)
      localStorage.setItem(SLOT_THUMB_PREFIX + this.activeSlot, url)
      // The open slot's button shows the new picture right away.
      const btn = this._slotsEl?.querySelector('.build-slot-btn.active')
      if (btn) {
        btn.classList.add('has-thumb')
        btn.style.backgroundImage = `url(${url})`
      }
    } catch {
      // Storage full or no canvas - the slot just shows its number.
    }
  }

  _slotThumb(slot) {
    try {
      return localStorage.getItem(SLOT_THUMB_PREFIX + slot)
    } catch {
      return null
    }
  }

  _slotName(slot = this.activeSlot) {
    if (slot === SHARED_SLOT) return this.sharedInfo?.name ? t('buildSharedSlotNamed', { name: this.sharedInfo.name }) : t('buildSharedSlot')
    return slot === MAP3_SLOT ? t('buildMap3Slot') : t('buildSlotName', { n: slot + 1 })
  }

  // What Share Map / Build Together send: Map 3 as just your changes to
  // it (it regenerates the same everywhere), anything else as the slot's
  // compact save string.
  _shareData() {
    const snapshot = this._snapshot()
    if (this.activeSlot === MAP3_SLOT) {
      return { base: 'map3', data: JSON.stringify(this._map3Diff()), blockCount: snapshot.blocks.length }
    }
    return { base: 'blank', data: this._encodeSlot(snapshot), blockCount: snapshot.blocks.length }
  }

  // Opens a map from someone else (untrusted data) in the Shared Map slot.
  // parsed: an already-decoded {blocks, hotbar} (older Community Builds).
  // False if the data can't be read.
  loadSharedData(base, data, info, parsed = null) {
    let build = parsed
    let diff = null
    try {
      if (!build && base === 'map3') {
        const d = JSON.parse(data)
        if (!d || !Array.isArray(d.removed) || !Array.isArray(d.placed)) return false
        diff = { removed: d.removed.filter((k) => typeof k === 'string'), placed: d.placed.filter((b) => b && typeof b === 'object'), hotbar: Array.isArray(d.hotbar) ? d.hotbar : undefined }
      } else if (!build) {
        build = this._decodeSlot(data)
      }
    } catch {
      return false
    }
    if (!diff && (!build || !Array.isArray(build.blocks))) return false
    if (this.tryMode.active) this.toggleTryMode()
    this._joiningRoom = true
    if (this.activeSlot !== SHARED_SLOT) {
      this.switchSlot(SHARED_SLOT)
    }
    this._joiningRoom = false
    this.clearAllBlocks()
    this.sharedInfo = { name: String(info?.name || '').slice(0, 30), creatorNickname: String(info?.creatorNickname || '').slice(0, 24), code: info?.code || null }
    try {
      localStorage.setItem(SHARED_INFO_KEY, JSON.stringify(this.sharedInfo))
    } catch {
      // Only the slot's name is lost.
    }
    if (diff) this._applyMap3(diff)
    else this._applyBuild(build)
    this.save()
    this._renderSlots()
    return true
  }

  _savedAgoText(at) {
    if (!at) return t('buildMenuNeverSaved')
    const mins = Math.floor((Date.now() - at) / 60000)
    if (mins < 1) return t('buildMenuSavedJustNow')
    if (mins < 60) return t('buildMenuSavedMinutes', { n: mins })
    return t('buildMenuSavedHours', { n: Math.floor(mins / 60) })
  }

  _savedAtFor(slot) {
    try {
      return JSON.parse(localStorage.getItem(SAVED_AT_KEY) || '{}')[slot] || null
    } catch {
      return null
    }
  }

  // A slot as one compact string: a palette of block ids, then every
  // horizontal run of the same block along x as "y,z,x,length,paletteIndex"
  // (the whole flat ground is a handful of runs per row), with doors - the
  // only blocks carrying state - listed on their own.
  _encodeSlot(snapshot) {
    const palette = []
    const pIndex = new Map()
    const pi = (type) => {
      if (!pIndex.has(type)) {
        pIndex.set(type, palette.length)
        palette.push(type)
      }
      return pIndex.get(type)
    }
    const doors = []
    const signs = []
    const rows = new Map()
    for (const b of snapshot.blocks) {
      // Signs carry their words too (a list of their own).
      if (typeof b.text === 'string' && b.text) {
        signs.push([b.x, b.y, b.z, pi(b.type), b.facing || 0, b.text])
        continue
      }
      if (b.facing !== undefined) {
        doors.push([b.x, b.y, b.z, pi(b.type), b.facing, b.open ? 1 : 0])
        continue
      }
      const rk = `${b.y},${b.z}`
      if (!rows.has(rk)) rows.set(rk, [])
      rows.get(rk).push([b.x, pi(b.type)])
    }
    const runs = []
    for (const [rk, cells] of rows) {
      cells.sort((a, b) => a[0] - b[0])
      let start = cells[0]
      let len = 1
      for (let i = 1; i <= cells.length; i++) {
        const c = cells[i]
        if (c && c[0] === start[0] + len && c[1] === start[1]) {
          len++
          continue
        }
        runs.push(`${rk},${start[0]},${len},${start[1]}`)
        start = c
        len = 1
      }
    }
    const animals = (snapshot.animals || []).map((a) => [a.kind, a.x, a.y, a.z])
    return JSON.stringify({ v: 2, p: palette, r: runs.join(';'), d: doors, ...(signs.length ? { s: signs } : {}), ...(animals.length ? { a: animals } : {}), h: snapshot.hotbar })
  }

  _decodeSlot(raw) {
    const data = JSON.parse(raw)
    if (!data || data.v !== 2 || !Array.isArray(data.p)) return data
    const blocks = []
    if (typeof data.r === 'string' && data.r) {
      for (const run of data.r.split(';')) {
        const [y, z, x, len, p] = run.split(',').map(Number)
        const type = data.p[p]
        if (!type || !(len > 0)) continue
        for (let i = 0; i < len; i++) blocks.push({ x: x + i, y, z, type })
      }
    }
    for (const d of Array.isArray(data.d) ? data.d : []) {
      const [x, y, z, p, facing, open] = d
      if (data.p[p]) blocks.push({ x, y, z, type: data.p[p], facing, open: open === 1 })
    }
    for (const sg of Array.isArray(data.s) ? data.s : []) {
      const [x, y, z, p, facing, text] = sg
      if (data.p[p]) blocks.push({ x, y, z, type: data.p[p], facing, text: String(text ?? '') })
    }
    const animals = (Array.isArray(data.a) ? data.a : []).filter(Array.isArray).map(([kind, x, y, z]) => ({ kind, x, y, z }))
    return { blocks, hotbar: data.h, animals }
  }

  // Moves builds from the old storage (one array under SAVE_SLOTS_KEY, or
  // the even older single SAVE_KEY) into per-slot entries, once.
  _migrateSlots() {
    try {
      if (localStorage.getItem(SLOTS_MIGRATED_KEY)) return
      let old = null
      try {
        const parsed = JSON.parse(localStorage.getItem(SAVE_SLOTS_KEY) || 'null')
        if (Array.isArray(parsed)) old = parsed
      } catch {
        // Malformed - nothing to move.
      }
      if (!old) {
        old = []
        try {
          const legacy = localStorage.getItem(SAVE_KEY)
          if (legacy) old[0] = JSON.parse(legacy)
        } catch {
          // Malformed legacy save - slot 1 starts empty.
        }
      }
      old.slice(0, SAVE_SLOT_COUNT).forEach((snap, i) => {
        const blocks = Array.isArray(snap) ? snap : snap?.blocks
        if (Array.isArray(blocks)) localStorage.setItem(SLOT_KEY_PREFIX + i, this._encodeSlot({ blocks: blocks.filter((b) => b && typeof b === 'object'), hotbar: snap?.hotbar }))
      })
      localStorage.removeItem(SAVE_SLOTS_KEY)
      localStorage.setItem(SLOTS_MIGRATED_KEY, '1')
    } catch {
      // Storage unavailable - nothing to migrate.
    }
  }

  _slotExists(i) {
    this._migrateSlots()
    try {
      return !!localStorage.getItem(SLOT_KEY_PREFIX + i)
    } catch {
      return false
    }
  }

  // A slot's saved build ({blocks, hotbar}), or null if it has none.
  _slotData(i) {
    this._migrateSlots()
    try {
      const raw = localStorage.getItem(SLOT_KEY_PREFIX + i)
      return raw ? this._decodeSlot(raw) : null
    } catch {
      return null
    }
  }

  _writeSlot(i, snapshot) {
    try {
      localStorage.setItem(SLOT_KEY_PREFIX + i, this._encodeSlot(snapshot))
    } catch {
      // Storage full/unavailable - the build just won't persist.
    }
  }

  save() {
    clearTimeout(this._autosaveTimer)
    this._autosaveTimer = null
    try {
      const at = JSON.parse(localStorage.getItem(SAVED_AT_KEY) || '{}')
      at[this.activeSlot] = Date.now()
      localStorage.setItem(SAVED_AT_KEY, JSON.stringify(at))
    } catch {
      // Storage unavailable - Quick Info just won't know when.
    }
    if (this.activeSlot === MAP3_SLOT) {
      this._saveMap3Edits()
      return
    }
    this._writeSlot(this.activeSlot, this._snapshot({ skipPlay: true }))
  }

  // Switches to a different slot: saves the current build into whichever
  // slot is active now (so work in progress is never silently lost by
  // switching away from it), then loads the target slot's data into a
  // freshly-cleared scene. No-op if already on that slot.
  switchSlot(index) {
    if (index === this.activeSlot) return
    if (index !== MAP3_SLOT && index !== SHARED_SLOT && !(Number.isInteger(index) && index >= 0 && index < SAVE_SLOT_COUNT)) return
    // Switching away from a Build Together map leaves the room.
    if (this.together.active && !this._joiningRoom) this.together.leave()
    this.save()
    this._saveSlotThumb()
    this.clearAllBlocks()
    this.activeSlot = index
    this._loadActiveSlot()
  }

  // Shared by save() (local persistence) and exportMap() (downloadable
  // file) - one source of truth for "what does a saved build contain."
  // skipPlay: leave out what a game put down (BuildSurvival._placed - its
  // blocks, traps, towers and Tower Defense's whole map go again when it
  // ends) - for saving, which can happen mid-game (switching tabs).
  _snapshot({ skipPlay = false } = {}) {
    const blocks = []
    const play = skipPlay && this.survival?.active ? this.survival._placed : null
    const land = this._blocks.land
    this._blocks.forEachCell((x, y, z, type) => {
      // Not the open world's land (it grows back from its seed).
      if (land.hasAt(x, y, z)) return
      const key = `${x},${y},${z}`
      if (play?.get(key) === type) return
      const shape = BLOCK_BY_ID.get(type)?.shape
      // A door's top half is rebuilt from its bottom half on load, and
      // flowing water/lava from its sources.
      if (shape === 'doortop' || this.liquids.isFlow(key)) return
      const door = shape === 'door' && this._doorState.get(key)
      const faced = FACED_SHAPES.has(shape) && this._stairFacing.has(key) && this.gadgets.stateOf(key)
      blocks.push(door ? { x, y, z, type, facing: door.facing, open: door.open } : faced && (faced.facing || faced.open || faced.text) ? { x, y, z, type, ...faced } : { x, y, z, type })
    })
    // Windows shot out and blocks broken while trying the map are only
    // gone for that try - saves and exports still have them.
    for (const b of this.tryMode?.brokenWindows() || []) {
      if (!this._blocks.has(this._key(b.x, b.y, b.z))) blocks.push({ x: b.x, y: b.y, z: b.z, type: b.type, ...b.state })
    }
    return { blocks, hotbar: this.hotbar, ...(this.animalSpots?.length ? { animals: this.animalSpots } : {}) }
  }

  load() {
    this._loadActiveSlot()
  }

  _loadActiveSlot() {
    if (this.activeSlot === MAP3_SLOT) {
      this._applyMap3(this._loadMap3Edits())
      return
    }
    // An old 128x128 Plain map is saved again right away at 32x32.
    if (this._applyBuild(this._slotData(this.activeSlot))) this._writeSlot(this.activeSlot, this._snapshot({ skipPlay: true }))
  }

  // A saved build is exactly what it says - including ground the player
  // dug out or built over. The grass ground layer is only filled in for a
  // slot that has never been saved (or old/shared data with no ground in
  // it at all). Refilling it on every load was what kept bringing the
  // grass back over broken or replaced ground.
  // Returns true if it was an old 128x128 Plain map cut to 32x32.
  _applyBuild(parsed) {
    // Void around it (OpenWorld.js, setFlatWorld).
    setFlatWorld(true)
    this.world.start()
    const cropped = cropOldPlainMap(parsed)
    if (cropped) parsed = cropped
    this._applyParsedData(parsed)
    const blocks = Array.isArray(parsed) ? parsed : parsed?.blocks
    const hasGround = Array.isArray(blocks) && blocks.some((b) => b && b.y === GROUND_LAYER_Y)
    if (!hasGround) this._ensureGroundLayer()
    return !!cropped
  }

  // --- Map 3 (see MAP3_SLOT) ---
  _map3Base() {
    if (!this._map3BaseCache) {
      const map = generateMap3()
      const byKey = new Map()
      for (const b of map.blocks) byKey.set(this._key(b.x, b.y, b.z), b)
      this._map3BaseCache = { map, byKey }
    }
    return this._map3BaseCache
  }

  _loadMap3Edits() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MAP3_EDITS_KEY) || 'null')
      if (parsed && Array.isArray(parsed.removed) && Array.isArray(parsed.placed)) return parsed
    } catch {
      // Malformed - start from the untouched map.
    }
    return { removed: [], placed: [] }
  }

  // The city comes with the open world around it (OpenWorld.js); terrain
  // broken by the player is in the same removed list.
  _applyMap3(edits) {
    const { map } = this._map3Base()
    const removed = new Set(edits.removed.filter((k) => typeof k === 'string'))
    const blocks = map.blocks.filter((b) => !removed.has(this._key(b.x, b.y, b.z)))
    setFlatWorld(false)
    this.world.start()
    // Only the city's own changes are kept - the land around it is new
    // every game (OpenWorld.js).
    const placed = edits.placed.filter((b) => b && cityCell(b.x, b.z))
    this._applyParsedData({ blocks: blocks.concat(placed), hotbar: edits.hotbar || map.hotbar, animals: edits.animals })
    this.world.cityLoaded(map.gates)
  }

  // Stores how the current scene differs from the generated map: cells
  // that are gone or hold something else go in removed, and whatever is
  // there now instead goes in placed.
  _saveMap3Edits() {
    try {
      localStorage.setItem(MAP3_EDITS_KEY, JSON.stringify(this._map3Diff()))
    } catch {
      // Storage full - the edits just won't persist.
    }
  }

  _map3Diff() {
    const { byKey } = this._map3Base()
    const sig = (b) => (b ? `${b.type}|${b.facing ?? ''}|${b.open ? 1 : 0}|${b.text ?? ''}` : '')
    const current = new Map()
    for (const b of this._snapshot({ skipPlay: true }).blocks) if (cityCell(b.x, b.z)) current.set(this._key(b.x, b.y, b.z), b)
    const removed = []
    const placed = []
    for (const [k, base] of byKey) {
      if (sig(current.get(k)) !== sig(base)) removed.push(k)
    }
    for (const [k, b] of current) {
      if (sig(b) !== sig(byKey.get(k))) placed.push(b)
    }
    return { removed, placed, hotbar: this.hotbar, ...(this.animalSpots?.length ? { animals: this.animalSpots } : {}) }
  }

  // Shared by load() (local storage, called on entering Build Mode with an
  // already-empty scene) and importMapFile() (an uploaded file, called
  // into a scene that may already have a build in it - the caller clears
  // first, see clearAllBlocks). Save format used to be a bare array of
  // block entries, before the hotbar existed - keep reading those the same
  // way rather than silently dropping every build saved before that change.
  _applyParsedData(parsed) {
    if (!parsed) return
    const blocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.blocks) ? parsed.blocks : null
    if (blocks) {
      // Same bulk-fill deferral as _ensureGroundLayer - a saved build can
      // touch many different block types, so track which meshes actually
      // received a placement and recompute bounds once per type afterward,
      // rather than once per block placed.
      const touchedTypes = new Set()
      for (const entry of blocks) {
        if (!entry || typeof entry !== 'object') continue
        const { x, y, z } = entry
        const type = LEGACY_TYPE_IDS[entry.type] || entry.type
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
        if (!VALID_TYPE_IDS.has(type)) continue
        const shape = BLOCK_BY_ID.get(type).shape
        const state = shape === 'door' ? { facing: entry.facing, open: entry.open === true } : FACED_SHAPES.has(shape) && (entry.facing !== undefined || entry.text) ? { facing: entry.facing, open: entry.open === true, text: typeof entry.text === 'string' ? entry.text : undefined } : null
        this.placeBlock(Math.trunc(x), Math.trunc(y), Math.trunc(z), type, true, state)
        touchedTypes.add(type)
        if (state) touchedTypes.add(`${type}top`)
      }
      // Ladders loaded before the wall behind them couldn't see it yet.
      if (touchedTypes.has('ladder')) this._refreshAllLadders()
      for (const type of touchedTypes) {
        const mesh = this._instancedMeshes[type]
        if (mesh) mesh.computeBoundingSphere()
      }
    }
    const hotbar = parsed?.hotbar
    if (Array.isArray(hotbar) && hotbar.length === 10) {
      this.hotbar = hotbar.map((raw) => {
        const id = LEGACY_TYPE_IDS[raw] || raw
        return id === null || (VALID_TYPE_IDS.has(id) && !BLOCK_BY_ID.get(id).hidden) ? id : null
      })
      // Hold whatever's in the highlighted slot of the loaded hotbar - it
      // used to stay empty-handed (nothing in hand, clicks placed nothing)
      // until you switched slots.
      this.selectedType = this.hotbar[this.activeHotbarIndex]
      this._updateInvisibleGhost()
      this._renderHotbar()
    }
    // Its animals, once the blocks (and water) they stand in are there.
    this._setAnimalSpots(parsed.animals)
  }

  // Downloads the current build (same shape save() writes to localStorage)
  // as a JSON file, matching Game.js's own _exportSave() Blob-download
  // pattern for the main survival-game save.
  exportMap() {
    const data = this._snapshot()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const link = document.createElement('a')
    link.download = `gayz-build-${Date.now()}.json`
    link.href = URL.createObjectURL(blob)
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  // Wipes every currently-placed block (including the ground layer) back
  // to a truly empty InstancedMesh/sparse-map state - needed before
  // importing a file into a scene that may already have a build in it,
  // since placeBlock only ever adds (see its own occupied-cell no-op).
  // Every real call site (Reset Map, switchSlot, importMapFile, Community
  // Builds Download) is swapping in a wholly different build right after -
  // undo/redo entries from before the swap would reference block positions/
  // types that no longer correspond to what's on screen, so they're
  // cleared here too rather than at each of those 4 call sites separately.
  clearAllBlocks() {
    this.tryMode?.forgetWindows()
    this.liquids?.clear()
    for (const type in this._instancedMeshes) {
      const mesh = this._instancedMeshes[type]
      mesh.count = 0
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      this._instanceKeyByIndex[type] = []
    }
    this._blocks.clear()
    this.world?.reset()
    this.animalSpots = []
    this.survival?.animals?.clearAll()
    this._mapVersion++
    this._invisibleKeys.clear()
    this._invisShadowDirty = true
    this._doorState.clear()
    this._stairFacing.clear()
    this.gadgets.clear()
    this.specials.clear()
    // (_chunkCells is a view of _blocks, emptied above.)
    this._chunks.clear()
    this._shadowsDirty = true
    this._undoStack.length = 0
    this._redoStack.length = 0
    this._updateUndoRedoButtons()
  }

  // Returns true on a successful import (caller shows its own toast/error
  // UI) - unlike the main game's save import, this doesn't need a page
  // reload: Build Mode's own scene/sparse-map is the only place this data
  // lives, so re-populating it directly is enough.
  async importMapFile(file) {
    if (!file) return false
    let parsed
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      return false
    }
    const blocks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.blocks) ? parsed.blocks : null
    if (!blocks) return false
    this.clearAllBlocks()
    this._applyBuild(parsed)
    this.save()
    return true
  }


  // Backfills any still-empty ground-level (y=GROUND_LAYER_Y) cell across
  // the whole GROUND_SIZE x GROUND_SIZE footprint with grass - runs after
  // loading (or failing to load) a save, so a fresh Build Mode always
  // starts with real, breakable ground instead of nothing, while never
  // overwriting a cell the player (or a saved build) already explicitly
  // placed something in - placeBlock already no-ops on an occupied cell,
  // so this is just "call it for every cell and let that guard do the work."
  // A fresh Plain map is a PLAIN_GROUND x PLAIN_GROUND platform in the
  // void (2026-11-16, was the whole 128x128); saved maps keep their own.
  _ensureGroundLayer() {
    const half = PLAIN_GROUND / 2
    for (let x = -half; x < half; x++) {
      for (let z = -half; z < half; z++) {
        this.placeBlock(x, GROUND_LAYER_Y, z, GROUND_BLOCK_TYPE, true)
      }
    }
    // One bounds recompute for the whole fill instead of one per cell (see
    // placeBlock's skipBoundsUpdate comment) - this single call is what
    // actually collapses the ~10 second stall down to instant.
    const groundMesh = this._instancedMeshes[GROUND_BLOCK_TYPE]
    if (groundMesh) groundMesh.computeBoundingSphere()
  }
}

// Puts every method above onto BuildMode, exactly as if written there.
export function addSaveMethods(BuildMode) {
  for (const name of Object.getOwnPropertyNames(BuildSaves.prototype)) {
    if (name === 'constructor') continue
    Object.defineProperty(BuildMode.prototype, name, Object.getOwnPropertyDescriptor(BuildSaves.prototype, name))
  }
}

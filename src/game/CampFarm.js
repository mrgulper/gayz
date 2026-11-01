// Farming at camp (2026-10-31, Gaymi's idea list 2: "farming at camp",
// picked "grow food + materials"). Owned by BuildSurvival
// (`survival.farm`), only when the game has a camp (Map 1).
//
// - A Crop Plot (crafted, PlayCrafting.js) placed inside the camp walls
//   joins your farm: it's saved (FARM_KEY) and put back in every later
//   game, even though other blocks placed in a game go away at the end.
// - Planted (Use on it, like any Crop Plot) it grows in real time,
//   FARM_GROW_S from planting - also while you're away or the game is
//   closed. Sprinklers / Greenhouse Glass still speed it up.
// - Harvest gives Veggies (heal) and Plant Fiber (crafting) - the Crop
//   Plot's own code (BuildSpecials._useCrop) - and it's ready to plant again.
// - Breaking one takes it off the farm.
// Saved values are untrusted: whole numbers inside the camp only, at most
// FARM_MAX plots.
import { t } from './i18n.js'

export const FARM_KEY = 'gayz-camp-farm'
export const FARM_GROW_S = 300
const FARM_MAX = 30
const CROP = 'cropplot'

export class CampFarm {
  constructor(survival) {
    this.s = survival
    this.plots = [] // { x, y, z, at } - at: planted time (ms), 0 = empty
  }

  get bm() {
    return this.s.bm
  }

  _keyOf(x, y, z) {
    return `${x},${y},${z}`
  }

  _load() {
    const camp = this.s.camp
    let raw
    try {
      raw = JSON.parse(localStorage.getItem(FARM_KEY) || 'null')
    } catch {
      raw = null
    }
    const list = Array.isArray(raw?.plots) ? raw.plots : []
    const now = Date.now()
    const seen = new Set()
    const out = []
    for (const p of list) {
      if (out.length >= FARM_MAX || !p || typeof p !== 'object') continue
      const [x, y, z] = [p.x, p.y, p.z].map(Number)
      if (![x, y, z].every(Number.isInteger) || !camp.inside(x + 0.5, z + 0.5)) continue
      const key = this._keyOf(x, y, z)
      if (seen.has(key)) continue
      seen.add(key)
      const at = Number(p.at)
      out.push({ x, y, z, at: Number.isFinite(at) && at > 0 && at <= now ? at : 0 })
    }
    return out
  }

  _save() {
    try {
      localStorage.setItem(FARM_KEY, JSON.stringify({ plots: this.plots.map(({ x, y, z, at }) => ({ x, y, z, at })) }))
    } catch { /* storage full or blocked: the farm just isn't kept */ }
  }

  // A game with a camp started: the farm's plots go back in place.
  start() {
    this.plots = []
    if (!this.s.camp) return
    const bm = this.bm
    const kept = []
    bm._suppressUndoRecording = true
    for (const p of this._load()) {
      const here = bm.getBlockAt(p.x, p.y, p.z)
      // Something else is there now (the map was edited): the plot's gone.
      if (here && here !== CROP) continue
      if (!here) {
        bm.placeBlock(p.x, p.y, p.z, CROP, false)
        // Taken away again at the end like other placed blocks - the saved
        // map never changes; the farm puts it back next game.
        this.s._placed?.set(bm._key(p.x, p.y, p.z), CROP)
      }
      kept.push(p)
    }
    bm._suppressUndoRecording = false
    this.plots = kept
    this._save()
    this._sync()
  }

  stop() {
    this.plots = []
  }

  _plotAt(x, y, z) {
    return this.plots.find((p) => p.x === x && p.y === y && p.z === z) || null
  }

  owns(entry) {
    return !!(entry && this._plotAt(entry.x, entry.y, entry.z))
  }

  // A Crop Plot placed by hand (BuildSurvival.placeHeldBlock).
  onPlaced(type, x, y, z) {
    if (type !== CROP || !this.s.camp?.inside(x + 0.5, z + 0.5) || this._plotAt(x, y, z)) return
    if (this.plots.length >= FARM_MAX) {
      this.s._message(t('farmFull', { n: FARM_MAX }), 3)
      return
    }
    this.plots.push({ x, y, z, at: 0 })
    this._save()
    this.s._message(t('farmAdded'), 4)
  }

  // A block broken by hand (BuildSurvival.onBlockMined).
  onMined(x, y, z) {
    const p = this._plotAt(x, y, z)
    if (!p) return
    this.plots = this.plots.filter((o) => o !== p)
    this._save()
    this.s._message(t('farmRemoved'), 3)
  }

  // Planted (BuildSpecials._useCrop): growing from now.
  onPlant(entry) {
    const p = this._plotAt(entry.x, entry.y, entry.z)
    if (!p) return
    p.at = Date.now()
    this._save()
  }

  onHarvest(entry) {
    const p = this._plotAt(entry.x, entry.y, entry.z)
    if (!p) return
    p.at = 0
    this._save()
  }

  // Seconds until a farm plot is ready (0 = ready).
  secondsLeft(entry) {
    const p = this._plotAt(entry.x, entry.y, entry.z)
    if (!p?.at) return FARM_GROW_S
    const rate = this.bm.specials._growRate?.(entry) || 1
    return Math.max(0, FARM_GROW_S / rate - (Date.now() - p.at) / 1000)
  }

  // Every frame: each farm plot's growth comes from its planting time
  // (not the in-game timer the other Crop Plots use).
  update() {
    this._sync()
  }

  _sync() {
    const sp = this.bm.specials
    for (const p of this.plots) {
      const entry = sp._at.get(this.bm._key(p.x, p.y, p.z))
      if (!entry) continue
      const st = sp._state(entry)
      const grow = entry.def.fx.grow
      st.planted = !!p.at
      st.grown = p.at ? Math.min(grow, grow * (1 - this.secondsLeft(entry) / (FARM_GROW_S / (sp._growRate?.(entry) || 1)))) : 0
    }
  }
}

// Pet eggs (Batch F, 2026-11-23). Gaymi picked: found in Loot Chests,
// rarer eggs need a longer walk, 3 warm at once (the rest wait, EGG_MAX in
// all), rarer eggs are more often shiny.
//
// A Loot Chest has an egg EGG_CHANCE of the time (rollChestEgg, from
// BuildSurvival.useChest), its rarity as often as a zombie's (ZOMBIE_TIERS
// chance). The first EGG_WARM eggs in the list are warming: every block
// you walk in a game (EggWalker, stepped from BuildSurvival.update) counts
// for all of them. At EGG_WALK blocks it hatches into a random zombie,
// skeleton, monster or animal of that rarity (EGG_SHINY: 1 in n shiny).
// Kept in the creatures save (Creatures.js `eggs`), so Cloud Save carries it.
// The Pets tab's "Eggs" section is TeamUI.renderEggs.
import { loadCreatures, saveCreatures, addCreature, creatureName, rarityName, pixelIconURL, MAX_CREATURES, EGG_MAX } from './Creatures.js'
import { PlayAnimals } from './PlayAnimals.js'
import { ZOMBIE_TIERS, ZOMBIE_TIER_IDS, NAME_COUNT, tierColor } from './ZombieNames.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { t } from './i18n.js'

// All a guess to start with.
export const EGG_CHANCE = 0.05
export const EGG_WARM = 3
// Blocks to walk, by rarity.
export const EGG_WALK = { common: 300, uncommon: 450, rare: 600, epic: 900, legendary: 1200, mythic: 1500 }
// 1 in n hatch shiny (a normal catch is 1 in SHINY_ODDS = 200).
export const EGG_SHINY = { common: 200, uncommon: 100, rare: 50, epic: 25, legendary: 10, mythic: 10 }
// Walked blocks are saved every this many (not every frame).
const FLUSH = 5
// A jump further than this in one frame is a teleport or a respawn.
const MAX_STEP = 4

export const eggNeed = (r) => EGG_WALK[r] || EGG_WALK.common
export const eggName = (r) => t('eggName', { r: rarityName(r) })
export const isWarm = (i) => i < EGG_WARM

// A rarity, as often as a zombie's.
export function rollEggTier(rand = Math.random) {
  let roll = rand()
  for (const id of ZOMBIE_TIER_IDS) {
    roll -= ZOMBIE_TIERS[id].chance
    if (roll < 0) return id
  }
  return 'common'
}

// A Loot Chest opened: maybe an egg. -> the egg kept, or null.
export function rollChestEgg(rand = Math.random) {
  if (rand() >= EGG_CHANCE) return null
  return addEgg(rollEggTier(rand))
}

// -> { r, d } kept, or null when the egg list is full.
export function addEgg(r) {
  const data = loadCreatures()
  if (data.eggs.length >= EGG_MAX || !ZOMBIE_TIER_IDS.includes(r)) return null
  const egg = { r, d: 0 }
  data.eggs.push(egg)
  saveCreatures(data)
  return egg
}

// What hatches: any zombie, skeleton, monster or animal, of rarity r.
export function hatchCreature(r, rand = Math.random) {
  const kinds = [
    ...[null, ...Object.keys(MONSTER_KINDS), ...Object.keys(SKELETON_KINDS)].map((k) => ({ t: 'z', k })),
    ...Object.keys(PlayAnimals.KINDS).map((k) => ({ t: 'a', k })),
  ]
  const base = kinds[Math.floor(rand() * kinds.length)]
  return base.t === 'a' ? { t: 'a', k: base.k, r } : { t: 'z', k: base.k, r, n: Math.floor(rand() * NAME_COUNT), b: false }
}

// Hatches egg i if it has walked far enough. -> the creature, 'walk' (not
// yet), 'full' (no room for more creatures) or 'gone'.
export function hatchEgg(i, rand = Math.random) {
  const data = loadCreatures()
  const egg = data.eggs[i]
  if (!egg) return 'gone'
  if (egg.d < eggNeed(egg.r)) return 'walk'
  if (data.list.length >= MAX_CREATURES) return 'full'
  const kept = addCreature(hatchCreature(egg.r, rand), rand, EGG_SHINY[egg.r] || EGG_SHINY.common)
  if (!kept) return 'full'
  // addCreature saved the list; take the egg out of a fresh copy.
  const now = loadCreatures()
  now.eggs.splice(i, 1)
  saveCreatures(now)
  return kept
}

// Walked n blocks: the warming eggs count them, and any that are ready
// hatch. -> { hatched: [{ r, c }], full: an egg is ready but there's no
// room, left: eggs still kept }.
export function walkEggs(n, rand = Math.random) {
  const data = loadCreatures()
  if (!data.eggs.length) return { hatched: [], full: false, left: 0 }
  data.eggs.forEach((e, i) => {
    if (isWarm(i)) e.d = Math.min(eggNeed(e.r), e.d + n)
  })
  saveCreatures(data)
  const hatched = []
  let full = false
  for (let i = 0; i < Math.min(EGG_WARM, loadCreatures().eggs.length); i++) {
    const e = loadCreatures().eggs[i]
    if (e.d < eggNeed(e.r)) continue
    const res = hatchEgg(i, rand)
    if (res === 'full') full = true
    else if (typeof res === 'object') {
      hatched.push({ r: e.r, c: res })
      i-- // the next egg moved into this place
    }
  }
  return { hatched, full, left: loadCreatures().eggs.length }
}

// A waiting egg moved into the last warming place (that one waits instead,
// keeping its blocks). -> true when it moved.
export function warmEgg(i) {
  const data = loadCreatures()
  if (isWarm(i) || !data.eggs[i]) return false
  const last = Math.min(EGG_WARM, data.eggs.length) - 1
  const [egg] = data.eggs.splice(i, 1)
  const out = data.eggs.splice(last, 1, egg)[0]
  data.eggs.splice(i, 0, out)
  saveCreatures(data)
  return true
}

// The message for one hatch.
export const hatchText = (h) => (h.c.s
  ? t('eggHatchedShiny', { egg: eggName(h.r), name: creatureName(h.c) })
  : t('eggHatched', { egg: eggName(h.r), name: creatureName(h.c) }))

// An egg's picture: 10x10 pixel art in its rarity's colour.
const EGG_ROWS = ['....ss....', '...sccs...', '..sccccs..', '..scwccs..', '.sccccccs.', '.sccccwcs.', '.scwccccs.', '.sccccccs.', '..sccccs..', '...ssss...']
export function eggIconURL(r) {
  const c = tierColor(r)
  return pixelIconURL(`egg-${c}`, { c: { s: '#2a2018', c, w: '#ffffff' }, rows: EGG_ROWS })
}

// Counts the blocks you walk in a game (BuildSurvival.update). Only flat
// distance (not up and down), not while dead or spectating.
export class EggWalker {
  constructor(survival) {
    this.s = survival
    this.last = null
    this.walked = 0
    this.has = loadCreatures().eggs.length > 0
    this._fullSaid = false
  }

  // A Loot Chest gave one (so the counting starts).
  onEgg() {
    this.has = true
  }

  update() {
    const s = this.s
    if (!this.has || s.dead || s.spectating || s.bm.menuOpen) {
      this.last = null
      return
    }
    const p = s.bodyPos()
    if (!p) return
    const last = this.last
    this.last = { x: p.x, z: p.z }
    if (!last) return
    const step = Math.hypot(p.x - last.x, p.z - last.z)
    if (step > MAX_STEP) return
    this.walked += step
    if (this.walked >= FLUSH) this.flush()
  }

  flush() {
    const n = Math.floor(this.walked)
    if (n <= 0) return
    this.walked -= n
    const res = walkEggs(n)
    this.has = res.left > 0
    res.hatched.forEach((h, k) => setTimeout(() => this.s.active && this.s._message(hatchText(h), 5), k * 5200))
    if (res.full && !this._fullSaid) {
      this._fullSaid = true
      this.s._message(t('eggFull', { n: MAX_CREATURES }), 5)
    }
  }
}

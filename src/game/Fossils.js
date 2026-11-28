// Fossil digs (2026-11-27, Gaymi's six ideas, batch 3: "dinosaur bones
// underground; dig them up and build full skeletons in the Camp Museum").
// The bones you've found, kept on this device (KEY), and the digging.
// The hall that shows them is CampFossils.js.
//
// Gaymi's answers: bones come both ways - any underground block you break
// has a small chance (BONE_CHANCE) to hold one, and rare Bone Block
// pockets in the rock (Underground.js ORES, the "fossil spots") give one
// for every block. Every dinosaur in DinoKinds.js gets a skeleton (new
// dinosaurs join by themselves), the FAMOUS six first. Each skeleton has
// PARTS (5 bones); finishing one pays FINISH_COINS camp coins.
//
// A bone found is always one you're missing (a random dinosaur and part),
// so nothing is wasted; once every skeleton is done, no more drop.
// Numbers are a guess.
import { DINO_KINDS } from './DinoKinds.js'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const KEY = 'gayz-fossils'
export const PARTS = ['skull', 'ribs', 'spine', 'legs', 'tail']
export const FAMOUS = ['tRex', 'triceratops', 'stegosaurus', 'velociraptor', 'brachiosaurus', 'pteranodon']
export const DINO_IDS = [...FAMOUS.filter((id) => DINO_KINDS[id]), ...Object.keys(DINO_KINDS).filter((id) => !FAMOUS.includes(id))]
export const BONE_CHANCE = 0.01 // any underground block
export const DIG_TOP = -3 // underground: this deep or deeper
export const FOSSIL_BLOCK = 'boneblock'
export const FINISH_COINS = 150

export const dinoName = (id) => t(`animal${id[0].toUpperCase()}${id.slice(1)}`)
export const partName = (p) => t(`fossilPart_${p}`)

// { dino: [parts found] } - only real dinosaurs and parts.
export function loadFossils() {
  let d
  try {
    d = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    d = {}
  }
  const out = {}
  if (!d || typeof d !== 'object') return out
  for (const id of DINO_IDS) {
    const v = d[id]
    if (!Array.isArray(v)) continue
    const parts = PARTS.filter((p) => v.includes(p))
    if (parts.length) out[id] = parts
  }
  return out
}

function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch { /* not kept */ }
}

export const isDone = (d, id) => (d[id]?.length || 0) >= PARTS.length

export function fossilCounts(d = loadFossils()) {
  let bones = 0
  for (const id of DINO_IDS) bones += d[id]?.length || 0
  return { bones, bonesMax: DINO_IDS.length * PARTS.length, done: DINO_IDS.filter((id) => isDone(d, id)).length, doneMax: DINO_IDS.length }
}

// One missing bone, picked at random. -> { dino, part, n, done } or null
// when every skeleton is finished. rand is for tests.
export function addBone(rand = Math.random) {
  const d = loadFossils()
  const missing = []
  for (const id of DINO_IDS) for (const p of PARTS) if (!d[id]?.includes(p)) missing.push([id, p])
  if (!missing.length) return null
  const [dino, part] = missing[Math.min(missing.length - 1, Math.floor(rand() * missing.length))]
  d[dino] = PARTS.filter((p) => p === part || d[dino]?.includes(p))
  save(d)
  return { dino, part, n: d[dino].length, done: d[dino].length >= PARTS.length }
}

// A block broken while playing (BuildSurvival.onBlockMined). Only the
// world's own underground blocks count, never ones somebody put there.
// -> the bone found, or null.
export function digForBone(s, type, y, terrain, rand = Math.random) {
  if (!terrain || y > DIG_TOP) return null
  if (type !== FOSSIL_BLOCK && rand() >= BONE_CHANCE) return null
  const b = addBone(rand)
  if (!b) return null
  const name = dinoName(b.dino)
  if (b.done) {
    if (typeof s.coins === 'number') s.coins += FINISH_COINS
    s._message?.(t('fossilDone', { name, coins: FINISH_COINS }), 4)
    try { audioEngine.playSpecial?.('bell') } catch { /* no audio */ }
  } else {
    s._message?.(t('fossilFound', { name, part: partName(b.part), n: b.n, max: PARTS.length }), 3)
    try { audioEngine.playSpecial?.('detectorFound') } catch { /* no audio */ }
  }
  return b
}

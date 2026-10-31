// Caught creatures and your battle team (2026-10-31, Gaymi's own idea:
// "catch zombies and animals, build a team, battle other players' ghost
// teams"; picked "weaken, then throw a trap" and "you control one
// creature"). Catching happens in a game (PlayCatch.js); the Team page on
// Inventory's Pets tab (TeamUI.js) picks up to TEAM_SIZE of them, and a battle
// (TeamBattle.js) puts them against another player's saved team.
//
// Saved in localStorage (CREATURES_KEY), so Cloud Save carries it like the
// rest of the save. A creature is { id, t: 'z' | 'a', k: kind, r: tier,
// n: name number (zombies), b: boss, at: when caught }. Its battle stats
// come from what it was in the game (stats()), never stored, so a balance
// change reaches creatures already caught.
import { PlayAnimals, animalNameKey, animalIconURL } from './PlayAnimals.js'
import { ZOMBIE_TIERS, ZOMBIE_TIER_IDS, zombieName, tierColor, NAME_COUNT } from './ZombieNames.js'
import { MONSTER_KINDS } from './ZombieKinds.js'
import { SKELETON_KINDS } from './SkeletonModels.js'
import { t } from './i18n.js'

export const CREATURES_KEY = 'gayz-creatures'
export const MAX_CREATURES = 200
// Gaymi (2026-10-31): "make it 10 slots" (was 3).
export const TEAM_SIZE = 10

// Zombies: the game's zombie, times its kind's and tier's numbers.
const ZOMBIE_BASE = { hp: 110, atk: 13, speed: 2.6 }
const BOSS = { hp: 1.8, atk: 1.4 }
// Animals: their game health stretched to a zombie's range (4-70 -> 50-160).
const ANIMAL_HP = (h) => 44 + h * 1.65
const ANIMAL_SPEED = 3.1
const DINO = { hp: 1.5, atk: 1.3 }

const KINDS = () => PlayAnimals.KINDS

function blank() {
  return { list: [], team: [], wins: 0, losses: 0, nextId: 1 }
}

// Never trusted (it came from localStorage, maybe a shared save file).
export function loadCreatures() {
  let data
  try {
    data = JSON.parse(localStorage.getItem(CREATURES_KEY) || 'null')
  } catch {
    data = null
  }
  const out = blank()
  if (!data || typeof data !== 'object') return out
  const list = Array.isArray(data.list) ? data.list : []
  for (const c of list.slice(0, MAX_CREATURES)) {
    const clean = cleanCreature(c)
    if (clean && Number.isInteger(c.id) && c.id > 0) out.list.push({ ...clean, id: c.id })
  }
  const ids = new Set(out.list.map((c) => c.id))
  out.team = (Array.isArray(data.team) ? data.team : []).filter((id) => ids.has(id)).slice(0, TEAM_SIZE)
  out.team = [...new Set(out.team)]
  out.wins = Number.isInteger(data.wins) && data.wins >= 0 ? data.wins : 0
  out.losses = Number.isInteger(data.losses) && data.losses >= 0 ? data.losses : 0
  out.nextId = Math.max(1, ...out.list.map((c) => c.id + 1), Number.isInteger(data.nextId) ? data.nextId : 1)
  return out
}

export function saveCreatures(data) {
  try {
    localStorage.setItem(CREATURES_KEY, JSON.stringify(data))
  } catch {
    // Full storage: the catch just isn't kept.
  }
}

// One creature's fields checked (a ghost team from another player too):
// null when it isn't a real zombie or animal.
export function cleanCreature(c) {
  if (!c || typeof c !== 'object') return null
  const r = ZOMBIE_TIER_IDS.includes(c.r) ? c.r : 'common'
  if (c.t === 'a') {
    if (typeof c.k !== 'string' || !Object.hasOwn(KINDS(), c.k)) return null
    return { t: 'a', k: c.k, r, at: Number.isFinite(c.at) ? c.at : 0 }
  }
  if (c.t !== 'z') return null
  const k = typeof c.k === 'string' && (Object.hasOwn(MONSTER_KINDS, c.k) || Object.hasOwn(SKELETON_KINDS, c.k)) ? c.k : null
  const n = Number.isInteger(c.n) && c.n >= 0 && c.n < NAME_COUNT ? c.n : 0
  return { t: 'z', k, r, n, b: !!c.b, at: Number.isFinite(c.at) ? c.at : 0 }
}

// Adds a catch. false when there's no room left.
export function addCreature(c) {
  const data = loadCreatures()
  if (data.list.length >= MAX_CREATURES) return false
  const clean = cleanCreature({ ...c, at: Date.now() })
  if (!clean) return false
  data.list.push({ ...clean, id: data.nextId++ })
  // The first ones caught fill the team by themselves.
  if (data.team.length < TEAM_SIZE) data.team.push(data.nextId - 1)
  saveCreatures(data)
  return true
}

export function creatureCount() {
  return loadCreatures().list.length
}

// Battle numbers: hp, atk (a hit), speed (blocks a second), reach (blocks)
// and rate (seconds between hits).
export function stats(c) {
  const tier = ZOMBIE_TIERS[c.r] || ZOMBIE_TIERS.common
  if (c.t === 'a') {
    const k = KINDS()[c.k]
    const dino = k.dino ? DINO : { hp: 1, atk: 1 }
    const atk = (k.hunts ? 10 + (k.bite || 8) : 7 + k.health / 9) * dino.atk * tier.damage
    const size = Math.max(k.body[0], k.body[2])
    return {
      hp: Math.round(ANIMAL_HP(k.health) * dino.hp * tier.hp),
      atk: Math.round(atk),
      speed: ANIMAL_SPEED * tier.speed * (size > 2.5 ? 0.8 : 1),
      reach: Math.max(1.3, size * 0.6 + 0.6),
      rate: 1.1,
    }
  }
  const kind = MONSTER_KINDS[c.k] || SKELETON_KINDS[c.k] || { hp: 1, speed: 1, damage: 1 }
  const boss = c.b ? BOSS : { hp: 1, atk: 1 }
  return {
    hp: Math.round(ZOMBIE_BASE.hp * kind.hp * tier.hp * boss.hp),
    atk: Math.round(ZOMBIE_BASE.atk * kind.damage * tier.damage * boss.atk),
    speed: ZOMBIE_BASE.speed * Math.min(1.5, kind.speed) * tier.speed,
    reach: 1.4,
    rate: 1.2,
  }
}

// How strong a whole team is (for matching ghost teams fairly).
export function power(team) {
  return Math.round(team.reduce((sum, c) => {
    const s = stats(c)
    return sum + Math.sqrt(s.hp * s.atk / s.rate)
  }, 0))
}

export function creatureName(c) {
  if (c.t === 'a') return t(animalNameKey(c.k))
  return zombieName(c.n)
}

// What it is, for the card under its name ("Zombie", "Boss Zombie", "Cow").
export function creatureType(c) {
  if (c.t === 'a') return t('teamTypeAnimal')
  return t(c.b ? 'teamTypeBoss' : 'teamTypeZombie')
}

export function rarityName(r) {
  return t(`rarity${r[0].toUpperCase()}${r.slice(1)}`)
}

export { tierColor }

// A small picture: the animal's own (PlayAnimals), or a blocky zombie face.
const _zIcons = new Map()
export function creatureIconURL(c) {
  if (c.t === 'a') return animalIconURL(c.k)
  const key = `${c.k || ''}:${c.b ? 1 : 0}`
  if (_zIcons.has(key)) return _zIcons.get(key)
  const S = 16
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')
  const skin = SKELETON_KINDS[c.k] ? '#e8e0c8' : MONSTER_KINDS[c.k] ? '#7a9a4a' : '#5f9a52'
  const rows = [
    '................',
    '..hhhhhhhhhhhh..',
    '..hsssssssssss..',
    '..ssssssssssss..',
    '..ssssssssssss..',
    '..sseesssseess..',
    '..sseesssseess..',
    '..ssssssssssss..',
    '..sssssddsssss..',
    '..ssssssssssss..',
    '..ssmmmmmmmmss..',
    '..ssmwmmwmmmss..',
    '..ssssssssssss..',
    '..ssssssssssss..',
    '................',
    '................',
  ]
  const col = { h: c.b ? '#c0282a' : '#3a2a1a', s: skin, e: '#151515', d: '#2a3a20', m: '#3a1010', w: '#f2ecdc' }
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    g.fillStyle = col[ch]
    g.fillRect(x, y, 1, 1)
  }))
  const url = cv.toDataURL()
  _zIcons.set(key, url)
  return url
}

// --- teams to battle when nobody else's ghost team can be found ---

const BOT_ANIMALS = ['wolf', 'bear', 'boar', 'fox', 'horse', 'cow', 'polarBear', 'camel', 'lion', 'tiger', 'crocodile', 'gorilla']
const BOT_ZOMBIES = [null, null, null, 'hunched', 'beast', 'skinny', 'brute', 'crawler']

// A made-up team about as strong as mine (target: power()), as many as
// mine (size).
export function botTeam(target, size = TEAM_SIZE, rand = Math.random) {
  const kinds = BOT_ANIMALS.filter((k) => Object.hasOwn(KINDS(), k))
  const pick = (list) => list[Math.floor(rand() * list.length)]
  let best = null
  for (let i = 0; i < 12; i++) {
    const team = []
    for (let j = 0; j < Math.max(1, Math.min(TEAM_SIZE, size)); j++) {
      const r = ZOMBIE_TIER_IDS[Math.min(ZOMBIE_TIER_IDS.length - 1, Math.floor(rand() * rand() * 4))]
      team.push(rand() < 0.5 && kinds.length
        ? { t: 'a', k: pick(kinds), r }
        : { t: 'z', k: pick(BOT_ZOMBIES), r, n: Math.floor(rand() * NAME_COUNT), b: false })
    }
    const diff = Math.abs(power(team) - target)
    if (!best || diff < best.diff) best = { team, diff }
  }
  return best.team
}

// The short form sent to Firestore for a ghost team (ghostTeams/{uid}).
export function packTeam(team) {
  return team.map((c) => (c.t === 'a' ? { t: 'a', k: c.k, r: c.r } : { t: 'z', k: c.k || '', r: c.r, n: c.n, b: !!c.b }))
}

export function unpackTeam(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, TEAM_SIZE).map((c) => cleanCreature(c && c.t === 'z' && c.k === '' ? { ...c, k: null } : c)).filter(Boolean)
}

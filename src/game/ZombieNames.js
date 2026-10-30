// Names and rarity for everything that attacks you (2026-10-26, Gaymi:
// "make the enemy that attack you like zombies and stuff also have names
// and rarity" - picked funny names, and rarer = stronger). Every zombie,
// skeleton and monster gets a silly name ("Grumpy Gary") and one of the
// animals' six rarity tiers (NewAnimalKinds RARITIES, same colours), shown
// on a tag over its head. Rarer ones have more health, bite harder, move a
// little faster, pay more coins and glow in their tier's colour.
//
// The name is one number (nameIdx: adjective x NAMES + name), so a server
// sends it with the tier and every player sees the same zombie.
import * as THREE from 'three'
import { t } from './i18n.js'
import { RARITIES } from './NewAnimalKinds.js'
import { luck, luckFor } from './Luck.js'

// chance: how often a zombie rolls this tier. hp / damage / speed / coins:
// times a common one's.
export const ZOMBIE_TIERS = {
  common: { chance: 0.55, hp: 1, damage: 1, speed: 1, coins: 1 },
  uncommon: { chance: 0.25, hp: 1.3, damage: 1.1, speed: 1, coins: 1.5 },
  rare: { chance: 0.12, hp: 1.7, damage: 1.2, speed: 1.05, coins: 2.5 },
  epic: { chance: 0.055, hp: 2.3, damage: 1.35, speed: 1.1, coins: 4 },
  legendary: { chance: 0.02, hp: 3.2, damage: 1.5, speed: 1.15, coins: 7 },
  mythic: { chance: 0.005, hp: 4.5, damage: 1.8, speed: 1.2, coins: 12 },
}
export const ZOMBIE_TIER_IDS = Object.keys(ZOMBIE_TIERS)

// i18n keys `zombieAdj<Word>`; the first names stay as they are in every
// language.
export const ADJECTIVES = ['Grumpy', 'Smelly', 'Wobbly', 'Sleepy', 'Hungry', 'Crusty', 'Moldy', 'Stinky', 'Lumpy', 'Soggy', 'Cranky', 'Drooly', 'Sneaky', 'Clumsy', 'Gloomy', 'Squishy', 'Toothless', 'Rusty', 'Burpy', 'Fancy']
export const NAMES = ['Gary', 'Steve', 'Doris', 'Bob', 'Linda', 'Kevin', 'Mildred', 'Frank', 'Bertha', 'Larry', 'Gus', 'Nancy', 'Herbert', 'Pam', 'Chad', 'Edna', 'Walter', 'Sue', 'Norman', 'Gertrude', 'Dave', 'Marge', 'Phil', 'Agnes', 'Earl']
export const NAME_COUNT = ADJECTIVES.length * NAMES.length

// A boss is always legendary or mythic.
export function rollZombieTier(boss, r = Math.random()) {
  if (boss) return r < 0.7 ? 'legendary' : 'mythic'
  // With 10x luck (Luck.js) the rarer tiers weigh far more (out of the
  // new total).
  const m = luck.mult()
  if (m > 1) {
    const w = (id) => ZOMBIE_TIERS[id].chance * luckFor(id, m)
    r *= ZOMBIE_TIER_IDS.reduce((sum, id) => sum + w(id), 0)
    for (const id of ZOMBIE_TIER_IDS) {
      if (r < w(id)) return id
      r -= w(id)
    }
    return 'common'
  }
  for (const id of ZOMBIE_TIER_IDS) {
    if (r < ZOMBIE_TIERS[id].chance) return id
    r -= ZOMBIE_TIERS[id].chance
  }
  return 'common'
}

export function rollZombieName() {
  return Math.floor(Math.random() * NAME_COUNT)
}

export function zombieName(nameIdx) {
  const i = ((Math.floor(nameIdx) % NAME_COUNT) + NAME_COUNT) % NAME_COUNT
  const adj = ADJECTIVES[Math.floor(i / NAMES.length)]
  return t('zombieNameFormat', { adj: t(`zombieAdj${adj}`), name: NAMES[i % NAMES.length] })
}

// The tag over its head: the name in white, the tier in its colour, on a
// soft dark plate - like the animals' tags. One picture per name + tier.
export const TAG_W = 256
export const TAG_H = 80
const tagCache = new Map()
export function zombieTagMaterial(nameIdx, tier) {
  const name = zombieName(nameIdx)
  const label = t(`rarity${tier[0].toUpperCase()}${tier.slice(1)}`)
  const key = `${name}|${label}|${tier}`
  if (tagCache.has(key)) return tagCache.get(key)
  const c = document.createElement('canvas')
  c.width = TAG_W
  c.height = TAG_H
  const g = c.getContext('2d')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 34px sans-serif'
  const w = Math.min(TAG_W - 4, Math.max(g.measureText(name).width, 90) + 28)
  g.fillStyle = 'rgba(0, 0, 0, 0.45)'
  g.beginPath()
  g.roundRect((TAG_W - w) / 2, 2, w, TAG_H - 4, 16)
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  g.fillStyle = '#ffffff'
  g.strokeText(name, TAG_W / 2, 27, TAG_W - 12)
  g.fillText(name, TAG_W / 2, 27, TAG_W - 12)
  g.font = 'bold 28px sans-serif'
  g.fillStyle = RARITIES[tier].color
  g.strokeText(label, TAG_W / 2, 60, TAG_W - 12)
  g.fillText(label, TAG_W / 2, 60, TAG_W - 12)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
  // Many names over a long game: keep the newest few hundred.
  if (tagCache.size > 300) {
    const [oldKey, old] = tagCache.entries().next().value
    tagCache.delete(oldKey)
    old.map.dispose()
    old.dispose()
  }
  tagCache.set(key, mat)
  return mat
}

// Rare and up glow: a soft ring of their colour on the ground round their
// feet that pulses. Geometry and one material per tier are shared
// (userData.shared - never disposed with the zombie).
let ringGeo = null
const ringMats = new Map()
export function zombieGlow(tier, size) {
  if (ZOMBIE_TIER_IDS.indexOf(tier) < ZOMBIE_TIER_IDS.indexOf('rare')) return null
  if (!ringGeo) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    const grad = g.createRadialGradient(32, 32, 6, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,255,255,0.0)')
    grad.addColorStop(0.55, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
    ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    ringGeo.userData.tex = new THREE.CanvasTexture(c)
  }
  if (!ringMats.has(tier)) {
    ringMats.set(tier, new THREE.MeshBasicMaterial({ map: ringGeo.userData.tex, color: new THREE.Color(RARITIES[tier].color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  }
  const ring = new THREE.Mesh(ringGeo, ringMats.get(tier))
  ring.userData.shared = true
  ring.scale.setScalar(size)
  ring.renderOrder = 3
  return ring
}

// Every glow breathes in and out together (one material per tier).
export function pulseZombieGlows(time) {
  for (const [tier, mat] of ringMats) mat.opacity = 0.55 + 0.35 * Math.sin(time * (2 + ZOMBIE_TIER_IDS.indexOf(tier) * 0.6))
}

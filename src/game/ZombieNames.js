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

// Settings > Controls > Colourblind-Friendly Zombie Rarity Glows
// (2026-10-30): the tag's tier word and the ground glow use colours that
// stay apart for red-green and blue-yellow colourblindness (a blue to
// orange to yellow run, with white for common) instead of the rainbow.
const CB_COLORS = { common: '#ffffff', uncommon: '#56b4e9', rare: '#0072b2', epic: '#cc79a7', legendary: '#e69f00', mythic: '#f0e442' }
let colorblind = false
export function tierColor(tier) {
  return (colorblind ? CB_COLORS[tier] : RARITIES[tier]?.color) || '#ffffff'
}
export function setColorblindRarity(on) {
  if (colorblind === on) return
  colorblind = on
  for (const [tier, mat] of ringMats) mat.color.set(tierColor(tier))
  // New zombies get tags in the new colours (old ones keep theirs).
  tagCache.clear()
}

// The tag over its head: the name in white, the tier in its colour, on a
// soft dark plate - like the animals' tags. One picture per name + tier.
export const TAG_W = 256
export const TAG_H = 80
const tagCache = new Map()
export function zombieTagMaterial(nameIdx, tier) {
  const name = zombieName(nameIdx)
  const label = t(`rarity${tier[0].toUpperCase()}${tier.slice(1)}`)
  const key = `${name}|${label}|${tier}|${colorblind}`
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
  g.fillStyle = tierColor(tier)
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
    ringMats.set(tier, new THREE.MeshBasicMaterial({ map: ringGeo.userData.tex, color: new THREE.Color(tierColor(tier)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
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

// Golden and Diamond zombies (2026-10-30, Gaymi: "make both rare big
// reward and very rare huge reward, make the very rarer even more shiny").
// A shine is rolled on top of the rarity tier, so any zombie - even a
// Common one or a boss - can come out shiny. coins: times what it would
// pay anyway. tint: its body colour, times its picture (shineBody).
export const ZOMBIE_SHINES = {
  gold: { chance: 1 / 200, coins: 10, color: '#ffd23f', tint: [1.35, 1.05, 0.3] },
  diamond: { chance: 1 / 1000, coins: 50, color: '#8ff7ff', tint: [0.75, 1.25, 1.45] },
  // The Disco Zombie (2026-10-31, Gaymi's funny-zombies list): glows
  // every colour, dances (FunnyZombies.js), and goes out in confetti with
  // loot for whoever got it (BuildSurvival._discoLoot).
  disco: { chance: 1 / 250, coins: 15, color: '#ff5ce1', tint: [1.25, 1.2, 1.3] },
}
const RAINBOW = ['#ff7ad9', '#ffd23f', '#7dff8a', '#8ff7ff', '#a98bff']
export const ZOMBIE_SHINE_IDS = Object.keys(ZOMBIE_SHINES)

// Diamond is checked first, so it really is 1 in 1000.
export function rollZombieShine(r = Math.random()) {
  if (r < ZOMBIE_SHINES.diamond.chance) return 'diamond'
  if (r < ZOMBIE_SHINES.diamond.chance + ZOMBIE_SHINES.gold.chance) return 'gold'
  if (r < ZOMBIE_SHINES.diamond.chance + ZOMBIE_SHINES.gold.chance + ZOMBIE_SHINES.disco.chance) return 'disco'
  return null
}

export function shineCoins(shine) {
  return ZOMBIE_SHINES[shine]?.coins ?? 1
}

// A shiny zombie's own body: the shared zombie body's parts with their
// own copies of its material, tinted and glowing (a batched body can only
// be darkened, and the green skin never looked gold). Returns the copied
// materials, so the zombie can light them up and free them.
export function shineBody(parts, shine) {
  const s = ZOMBIE_SHINES[shine]
  const mats = []
  for (const part of parts) {
    part.visible = true
    const mat = part.material.clone()
    mat.color.setRGB(...s.tint)
    if (mat.emissive) mat.emissive.set(s.color).multiplyScalar(0.3)
    part.material = mat
    part.userData.shared = true
    mats.push(mat)
  }
  return mats
}

// Its glow this frame: a Golden one flickers a little like a coin; a
// Diamond one slowly runs through icy rainbow colours. hurt: the red hit
// flash wins.
export function glowShineBody(mats, shine, time, id = 0, hurt = false) {
  const s = ZOMBIE_SHINES[shine]
  if (!s) return
  for (const mat of mats) {
    if (!mat.emissive) continue
    if (hurt) mat.emissive.setRGB(0.6, 0, 0)
    else if (shine === 'diamond') mat.emissive.setHSL((time * 0.15 + id * 0.13) % 1, 0.8, 0.3)
    // Disco: flashes through every colour, fast, like a dance floor.
    else if (shine === 'disco') mat.emissive.setHSL((Math.floor(time * 4) * 0.17 + id * 0.13) % 1, 1, 0.35)
    else mat.emissive.set(s.color).multiplyScalar(0.25 + 0.1 * Math.sin(time * 6 + id))
  }
}

// The tag's second line for a shiny zombie: its shine word instead of the
// tier, gold or rainbow letters with a glowing outline.
export function shineTagMaterial(nameIdx, shine) {
  const name = zombieName(nameIdx)
  const label = t(shine === 'diamond' ? 'zombieShineDiamond' : shine === 'disco' ? 'zombieShineDisco' : 'zombieShineGold')
  const key = `${name}|${label}|shine-${shine}`
  if (tagCache.has(key)) return tagCache.get(key)
  const c = document.createElement('canvas')
  c.width = TAG_W
  c.height = TAG_H
  const g = c.getContext('2d')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 34px sans-serif'
  const w = Math.min(TAG_W - 4, Math.max(g.measureText(name).width, 120) + 28)
  g.fillStyle = 'rgba(0, 0, 0, 0.55)'
  g.beginPath()
  g.roundRect((TAG_W - w) / 2, 2, w, TAG_H - 4, 16)
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = ZOMBIE_SHINES[shine].color
  g.stroke()
  g.lineWidth = 5
  g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  g.fillStyle = '#ffffff'
  g.strokeText(name, TAG_W / 2, 27, TAG_W - 12)
  g.fillText(name, TAG_W / 2, 27, TAG_W - 12)
  g.font = 'bold 28px sans-serif'
  let fill = ZOMBIE_SHINES.gold.color
  if (shine === 'diamond' || shine === 'disco') {
    fill = g.createLinearGradient(TAG_W / 2 - 80, 0, TAG_W / 2 + 80, 0)
    RAINBOW.forEach((col, i) => fill.addColorStop(i / 4, col))
  }
  g.shadowColor = ZOMBIE_SHINES[shine].color
  g.shadowBlur = 10
  g.strokeText(label, TAG_W / 2, 60, TAG_W - 12)
  g.fillStyle = fill
  g.fillText(label, TAG_W / 2, 60, TAG_W - 12)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })
  tagCache.set(key, mat)
  return mat
}

// The shine round its body: a soft halo, sparkles circling it and a big
// ground glow. A Diamond one also gets a beam of light up into the sky,
// so you can spot it from across the map. Pictures and materials are
// shared (userData.shared); the group is the zombie's own, so it can spin.
let sparkTex = null
const shineMats = new Map()
function softDot() {
  if (sparkTex) return sparkTex
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  sparkTex = new THREE.CanvasTexture(c)
  return sparkTex
}
function shineMat(id, color, opacity) {
  if (!shineMats.has(id)) {
    const mat = new THREE.SpriteMaterial({ map: softDot(), color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    mat.userData.base = opacity
    shineMats.set(id, mat)
  }
  return shineMats.get(id)
}
let beamGeo = null
let beamMat = null
export function zombieShineFx(shine, width, height) {
  const s = ZOMBIE_SHINES[shine]
  if (!s) return null
  const diamond = shine === 'diamond'
  const rainbow = diamond || shine === 'disco'
  const fx = new THREE.Group()
  fx.userData.shine = shine
  const halo = new THREE.Sprite(shineMat(`${shine}-halo`, s.color, diamond ? 0.55 : 0.4))
  halo.scale.set(width * (diamond ? 2.6 : 2), height * (diamond ? 1.6 : 1.3), 1)
  halo.position.y = height * 0.5
  halo.userData.shared = true
  fx.add(halo)
  const count = rainbow ? 14 : 8
  for (let i = 0; i < count; i++) {
    const spark = new THREE.Sprite(shineMat(rainbow ? `${shine}-spark-${i % 5}` : 'gold-spark', rainbow ? RAINBOW[i % 5] : '#fff2a8', 0.95))
    const a = (i / count) * Math.PI * 2
    const r = width * (0.8 + (i % 3) * 0.15)
    spark.position.set(Math.cos(a) * r, height * (0.15 + ((i * 0.37) % 1) * 0.85), Math.sin(a) * r)
    spark.scale.setScalar(width * (diamond ? 0.28 : 0.22))
    spark.userData.shared = true
    spark.userData.phase = i
    spark.userData.baseY = spark.position.y
    fx.add(spark)
  }
  const ring = zombieGlow('mythic', width * (diamond ? 4 : 3))
  if (ring) {
    const id = `${shine}-ring`
    if (!shineMats.has(id)) {
      const mat = ring.material.clone()
      mat.color.set(s.color)
      mat.userData.base = 0.85
      shineMats.set(id, mat)
    }
    ring.material = shineMats.get(id)
    ring.position.y = 0.02 * height
    fx.add(ring)
  }
  if (diamond) {
    if (!beamGeo) {
      beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true)
      beamGeo.translate(0, 0.5, 0)
      beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(s.color), transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    }
    const beam = new THREE.Mesh(beamGeo, beamMat)
    beam.scale.set(width * 0.9, height * 40, width * 0.9)
    beam.userData.shared = true
    beam.renderOrder = 2
    fx.add(beam)
  }
  return fx
}

// Spins the sparkles and makes everything twinkle. One call a frame.
export function animateShineFx(fx, time) {
  fx.rotation.y = time * (fx.userData.shine === 'disco' ? 2.6 : fx.userData.shine === 'diamond' ? 1.6 : 1.1)
  for (const o of fx.children) {
    if (o.userData.phase !== undefined) o.position.y = o.userData.baseY + Math.sin(time * 3 + o.userData.phase) * o.scale.x * 0.6
  }
}
export function pulseShines(time) {
  for (const [id, mat] of shineMats) {
    const base = mat.userData.base
    if (id.includes('spark')) mat.opacity = base * (0.55 + 0.45 * Math.abs(Math.sin(time * 5 + id.length)))
    else mat.opacity = base * (0.75 + 0.25 * Math.sin(time * 3))
    if (id.startsWith('diamond') && !id.includes('spark')) mat.color.setHSL((time * 0.15) % 1, 0.8, 0.7)
    if (id.startsWith('disco') && !id.includes('spark')) mat.color.setHSL((Math.floor(time * 4) * 0.17) % 1, 1, 0.65)
  }
  if (beamMat) {
    beamMat.color.setHSL((time * 0.15) % 1, 0.8, 0.7)
    beamMat.opacity = 0.16 + 0.08 * Math.sin(time * 2)
  }
}

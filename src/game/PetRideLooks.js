// Pet + ride looks (2026-11-25, big shop plan batch 5). Gaymi picked:
// pet hats AND real pet recolours (a bought paint is the one exception to
// "a pet looks exactly like it did wild"), on every pet (Pet Zombie, tamed
// animals, the homepage pet), and one paint job for every ride (go-kart,
// bike, hoverboard, boat, jet ski, submarine, helicopter, balloon) - like
// gun skins paint every gun.
//
// Three Shop sections (ShopEffects EFFECT_KINDS petHat / petPaint /
// ridePaint), bought with coins, owned in game.shopCosmetics, the one used
// is settings.petHat / petPaint / ridePaint, picked in the Shop or
// Inventory > Cosmetics. Online: PlayNet state `phat`, `ppaint`, `rpaint`
// (the server passes them), so others see your pets' and rides' looks.
// Prices are a guess (Gaymi can change them here).
import * as THREE from 'three'
import { ownsShopCosmetic } from './Cosmetics.js'
import { makeHat, disposeHat, HAT_BOX_COLORS } from './FunnyZombies.js'
import { t } from './i18n.js'

// Pet hats: one of the hat shapes in FunnyZombies' HAT_BOXES.
export const PET_HATS = {
  petPartyHat: { price: 10000, hat: 'party' },
  petBunnyEars: { price: 10000, hat: 'bunnyEars' },
  petCowboyHat: { price: 15000, hat: 'cowboyHat' },
  petTopHat: { price: 15000, hat: 'topHat' },
  petSantaHat: { price: 20000, hat: 'santaHat' },
  petWizardHat: { price: 25000, hat: 'wizardHat' },
  petHalo: { price: 35000, hat: 'halo' },
  petCrown: { price: 50000, hat: 'crown' },
}
// Paints: a colour (rainbow: cycles through every colour; glow: shines).
export const PET_PAINTS = {
  petPink: { price: 15000, color: '#ff7ac0' },
  petFrost: { price: 15000, color: '#9fe4ff' },
  petToxic: { price: 25000, color: '#7dff4a', glow: 0.25 },
  petShadow: { price: 25000, color: '#3a2f52' },
  petGold: { price: 50000, color: '#f5c542', glow: 0.12 },
  petRainbow: { price: 100000, rainbow: true },
}
export const RIDE_PAINTS = {
  rideBlue: { price: 10000, color: '#2f7dff' },
  rideLime: { price: 10000, color: '#8cff3a' },
  ridePink: { price: 15000, color: '#ff4fa8' },
  rideMidnight: { price: 25000, color: '#2a2246' },
  rideGold: { price: 50000, color: '#f5c542', glow: 0.12 },
  rideNeon: { price: 75000, color: '#22f0ff', glow: 0.6 },
  rideRainbow: { price: 100000, rainbow: true },
}
export const PET_HAT_IDS = Object.keys(PET_HATS)
export const PET_PAINT_IDS = Object.keys(PET_PAINTS)
export const RIDE_PAINT_IDS = Object.keys(RIDE_PAINTS)
const PAINTS = { ...PET_PAINTS, ...RIDE_PAINTS }

const cap = (id) => id.charAt(0).toUpperCase() + id.slice(1)
export const petHatName = (id) => t(`look${cap(id)}`)
export const petPaintName = (id) => t(`look${cap(id)}`)
export const ridePaintName = (id) => t(`look${cap(id)}`)

export const cleanPetHat = (id) => (typeof id === 'string' && PET_HATS[id] ? id : '')
export const cleanPetPaint = (id) => (typeof id === 'string' && PET_PAINTS[id] ? id : '')
export const cleanRidePaint = (id) => (typeof id === 'string' && RIDE_PAINTS[id] ? id : '')

// What I use: my pick, if I really own it.
const mine = (game, setting, clean) => {
  const id = clean(game?.settings?.[setting])
  return id && ownsShopCosmetic(id) ? id : ''
}
export const myPetHat = (game) => mine(game, 'petHat', cleanPetHat)
export const myPetPaint = (game) => mine(game, 'petPaint', cleanPetPaint)
export const myRidePaint = (game) => mine(game, 'ridePaint', cleanRidePaint)
export const myPetLook = (game) => ({ hat: myPetHat(game), paint: myPetPaint(game) })

// --- pictures for the Shop and Inventory cards (48 x 48, drawn once) ---

const icons = new Map()
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
function iconOf(id, draw) {
  if (icons.has(id)) return icons.get(id)
  const c = document.createElement('canvas')
  c.width = c.height = 48
  draw(c.getContext('2d'))
  const url = c.toDataURL()
  icons.set(id, url)
  return url
}
// A paint's fill: its colour, or rainbow stripes.
function fillOf(g, id, x, w) {
  const p = PAINTS[id]
  if (!p.rainbow) return p.color
  const grad = g.createLinearGradient(x, 0, x + w, 0)
  ;['#ff3b3b', '#ff9a2b', '#ffe14d', '#3be87a', '#2fa8ff', '#9b5cff'].forEach((c, i) => grad.addColorStop(i / 5, c))
  return grad
}
// A hat on a little furry head.
export const petHatIcon = (id) => iconOf(id, (g) => {
  g.fillStyle = '#a0703f'
  g.fillRect(12, 32, 24, 14)
  g.fillStyle = '#1e1e1e'
  g.fillRect(17, 37, 3, 3)
  g.fillRect(28, 37, 3, 3)
  for (const [w, h, , y, col, x = 0] of HAT_BOX_COLORS(PET_HATS[id].hat)) {
    g.fillStyle = hex(col)
    g.fillRect(24 + (x - w / 2) * 2.4, 32 - (y + h / 2) * 2.4, w * 2.4, h * 2.4)
  }
})
// A blocky dog side-on, in the paint.
export const petPaintIcon = (id) => iconOf(id, (g) => {
  g.fillStyle = fillOf(g, id, 6, 36)
  g.fillRect(8, 20, 26, 12) // body
  g.fillRect(30, 12, 12, 12) // head
  g.fillRect(10, 32, 5, 10) // legs
  g.fillRect(27, 32, 5, 10)
  g.fillRect(4, 18, 6, 4) // tail
  g.fillStyle = '#1e1e1e'
  g.fillRect(37, 15, 3, 3)
  g.fillStyle = 'rgba(0,0,0,0.2)'
  g.fillRect(8, 29, 26, 3)
})
// A go-kart side-on, in the paint.
export const ridePaintIcon = (id) => iconOf(id, (g) => {
  g.fillStyle = fillOf(g, id, 4, 40)
  g.fillRect(6, 24, 36, 8) // frame
  g.fillRect(30, 18, 10, 6) // nose
  g.fillStyle = '#2a2a2a'
  g.fillRect(14, 14, 8, 10) // seat
  g.fillStyle = '#151515'
  for (const x of [8, 32]) g.fillRect(x, 30, 10, 10)
  g.fillStyle = '#bbbbbb'
  for (const x of [11, 35]) g.fillRect(x, 33, 4, 4)
})

// --- painting a model ---

const _c = new THREE.Color()
const _hsl = {}
const lum = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
// How bright a picture is on average (0-1), worked out once per picture.
const texLums = new WeakMap()
function texLum(map) {
  if (texLums.has(map)) return texLums.get(map)
  let l = 0.6
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 8
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(map.image, 0, 0, 8, 8)
    const d = g.getImageData(0, 0, 8, 8).data
    let sum = 0
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue
      sum += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
      n++
    }
    if (n) l = sum / n
  } catch { /* not drawable yet */ }
  l = Math.max(0.12, l)
  texLums.set(map, l)
  return l
}
function paintColor(mat, base, p, i, now) {
  const textured = !!base.map
  // A picture (fur, a mob skin) multiplies the colour, so a dark one gets
  // a brighter tint to land on the paint's own colour; its spots and
  // shading still show. Plain boxes keep their light and dark parts.
  const l = textured ? 0.6 : lum(base.color)
  const lift = textured ? Math.min(3, 0.7 / texLum(base.map)) : Math.min(1.35, 0.45 + l * 1.1)
  if (p.rainbow) {
    _c.setHSL(((now / 4000) + i * 0.09) % 1, 0.85, 0.3 + l * 0.35)
    if (textured) _c.multiplyScalar(lift)
  } else {
    _c.set(p.color).multiplyScalar(lift)
  }
  mat.color.copy(_c)
  if (mat.emissive && (p.glow || p.rainbow)) mat.emissive.copy(_c).multiplyScalar(p.glow || 0.15)
}

// Which meshes take the paint. 'pet': everything but the darkest bits
// (eyes, noses). 'ride': only the coloured parts (frames, hulls, seats
// stay as they are: greys, blacks and whites are left alone) plus any
// part marked userData.paint.
function paints(mesh, base, mode) {
  if (mesh.userData.noPaint || !base.color) return false
  if (mode === 'pet') return !!base.map || lum(base.color) > 0.08
  if (mesh.userData.paint) return true
  base.color.getHSL(_hsl)
  return _hsl.s > 0.25 && _hsl.l > 0.12 && _hsl.l < 0.9
}

// Paints root's meshes with paint id ('' takes it off). mode 'pet' or
// 'ride'. ownMats: the meshes own their materials (rides) - the old ones
// are disposed right away and the paint can't be taken off. Otherwise
// (shared kind materials, like PlayAnimals') each mesh gets clones and
// remembers its own materials in userData.paintBase for unpaint().
// -> root.
export function paintModel(root, id, mode, ownMats = false) {
  if (!root) return root
  const p = PAINTS[id] || null
  if ((root.userData.paintId || '') === (p ? id : '')) return root
  if (!ownMats) unpaint(root)
  root.userData.paintId = p ? id : ''
  if (!p) return root
  let i = 0
  root.traverse((o) => {
    if (!o.isMesh || o.userData.paintBase) return
    // A hat or anything else marked keeps its own colours.
    for (let q = o; q && q !== root; q = q.parent) if (q.userData.noPaint) return
    const bases = [].concat(o.material)
    if (!bases.some((m) => paints(o, m, mode))) return
    const made = bases.map((m) => {
      if (!paints(o, m, mode)) return m
      const c = m.clone()
      paintColor(c, m, p, i, performance.now())
      return c
    })
    const idx = i++
    // Rainbow needs the old colours each frame, so it keeps them.
    if (ownMats && !p.rainbow) {
      for (const m of bases) if (!made.includes(m)) m.dispose()
    } else {
      o.userData.paintBase = o.material
    }
    o.material = Array.isArray(o.material) ? made : made[0]
    if (p.rainbow) {
      o.userData.paintPrev = o.onBeforeRender
      o.onBeforeRender = (...args) => {
        o.userData.paintPrev?.(...args)
        const now = performance.now()
        made.forEach((m, j) => { if (m !== bases[j]) paintColor(m, bases[j], p, idx + j, now) })
      }
      o.userData.paintRainbow = true
    }
  })
  return root
}

// Takes the paint off (only for models painted with ownMats false).
export function unpaint(root) {
  if (!root) return
  root.traverse((o) => {
    if (!o.isMesh || !o.userData.paintBase) return
    const base = [].concat(o.userData.paintBase)
    for (const m of [].concat(o.material)) if (!base.includes(m)) m.dispose()
    o.material = o.userData.paintBase
    delete o.userData.paintBase
    if (o.userData.paintRainbow) {
      o.onBeforeRender = o.userData.paintPrev || (() => {})
      delete o.userData.paintPrev
      delete o.userData.paintRainbow
    }
  })
  root.userData.paintId = ''
}

// A pet hat for a head. parent: what it sits on; top: the head's top
// (parent units); width: the head's width (parent units). FunnyZombies'
// hats are made for a head 8 across with its top at HEAD_TOP, so it goes
// in a holder that undoes both. -> the holder (or null).
export function addPetHat(parent, id, top, width) {
  const kind = PET_HATS[id]?.hat
  const hat = kind && makeHat(kind)
  if (!hat) return null
  const holder = new THREE.Group()
  holder.name = 'petHat'
  holder.userData.noPaint = true
  const sc = (width * 1.05) / 8
  holder.scale.setScalar(sc)
  holder.position.y = top - hat.position.y * sc
  holder.add(hat)
  parent.add(holder)
  return holder
}
export function removePetHat(holder) {
  if (!holder) return
  holder.removeFromParent()
  disposeHat(holder)
}

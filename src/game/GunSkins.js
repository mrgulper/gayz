// Gun skins (2026-11-25, shop plan batch "Gun skins"; Gaymi: one paint job
// for ALL your guns, everyone online sees it, and the Gallery's Weapon tab
// shows them). Bought in Shop > Gun Skins for coins (ShopEffects.js, same
// cards as Kill Effects), owned ones live in game.shopCosmetics, the one you
// use is settings.gunSkin, picked in the Shop or Inventory > Cosmetics.
//
// A skin swaps every gun material for its own: a small drawn pattern
// (camo blobs, lava cracks, stars...) laid over the model's own UVs, with
// the model's normal map kept so its shape details still show. Glowing
// skins carry an emissive map; Rainbow slides its stripes and Lava / Neon
// pulse (material.onBeforeRender - no per-frame code anywhere else).
//
// Shown on: the gun in your hands (BuildTryMode._showGun), your own body
// and other players' bodies (HeldWeapon.holdWeapon - PlayNet sends `gskin`),
// Inventory > Weapons' Inspect view and a thrown gun (PlayThrow).
// Prices are a guess (Gaymi can change them here).
import * as THREE from 'three'
import { ownsShopCosmetic } from './Cosmetics.js'
import { t } from './i18n.js'

// Cheapest first - the Shop and Gallery show them in this order.
export const GUN_SKINS = {
  camoGun: { price: 10000, colors: ['#4b5a2a', '#6f7d3c', '#3a3020', '#8c8a58'] },
  arcticGun: { price: 10000, colors: ['#eef2f6', '#c4ccd4', '#97a2ad', '#6c7681'] },
  neonGun: { price: 25000, colors: ['#140a22', '#ff2bd6', '#22f0ff'] },
  goldGun: { price: 50000, colors: ['#e9b231', '#ffd866', '#b8841c'] },
  lavaGun: { price: 50000, colors: ['#1c100c', '#2c1610', '#ff6a00', '#ffc23a'] },
  galaxyGun: { price: 75000, colors: ['#160b2e', '#3a1a6a', '#7b3fc4', '#ffffff'] },
  rainbowGun: { price: 100000, colors: ['#ff3b3b', '#ff9a2b', '#ffe14d', '#3be87a', '#2fa8ff', '#9b5cff'] },
  diamondGun: { price: 150000, colors: ['#a6ecff', '#d9f8ff', '#6fd3f5', '#ffffff'] },
}
export const GUN_SKIN_IDS = Object.keys(GUN_SKINS)

export const cleanGunSkin = (id) => (GUN_SKINS[id] ? id : '')

// The skin my guns wear: my pick, if I really own it.
export function myGunSkin(game) {
  const id = cleanGunSkin(game?.settings?.gunSkin)
  return id && ownsShopCosmetic(id) ? id : ''
}

export function gunSkinName(id) {
  return t(`gunSkin${id.charAt(0).toUpperCase()}${id.slice(1)}`)
}

// A seeded random, so every pattern is drawn the same each time.
function seeded(seed) {
  return () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
}

// The skin's pictures, drawn once: `color` (what you see) and, for glowing
// ones, `glow` (black except where it shines).
const SIZE = 128
const drawn = new Map()
function canvases(id) {
  if (drawn.has(id)) return drawn.get(id)
  const make = () => {
    const c = document.createElement('canvas')
    c.width = c.height = SIZE
    return c
  }
  const color = make()
  const g = color.getContext('2d')
  const cols = GUN_SKINS[id].colors
  const rnd = seeded(id.length * 131 + id.charCodeAt(0))
  let glow = null
  // Soft blobs that wrap round the edges (the picture repeats).
  const blobs = (palette, count, rMin, rMax) => {
    for (let i = 0; i < count; i++) {
      const x = rnd() * SIZE
      const y = rnd() * SIZE
      const r = rMin + rnd() * (rMax - rMin)
      g.fillStyle = palette[i % palette.length]
      for (const dx of [-SIZE, 0, SIZE]) for (const dy of [-SIZE, 0, SIZE]) {
        g.beginPath()
        g.ellipse(x + dx, y + dy, r, r * (0.55 + rnd() * 0.3), rnd() * Math.PI, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  g.fillStyle = cols[0]
  g.fillRect(0, 0, SIZE, SIZE)
  if (id === 'camoGun' || id === 'arcticGun') {
    blobs(cols.slice(1), 26, 8, 20)
  } else if (id === 'goldGun') {
    // Brushed lines.
    for (let y = 0; y < SIZE; y += 2) {
      g.fillStyle = cols[1 + Math.floor(rnd() * 2)]
      g.globalAlpha = 0.25 + rnd() * 0.35
      g.fillRect(0, y, SIZE, 1)
    }
    g.globalAlpha = 1
  } else if (id === 'diamondGun') {
    // Facets: triangles in four icy shades.
    const n = 8
    const s = SIZE / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      for (const half of [0, 1]) {
        g.fillStyle = cols[Math.floor(rnd() * cols.length)]
        g.beginPath()
        if (half) { g.moveTo(x * s, y * s); g.lineTo((x + 1) * s, y * s); g.lineTo((x + 1) * s, (y + 1) * s) } else { g.moveTo(x * s, y * s); g.lineTo(x * s, (y + 1) * s); g.lineTo((x + 1) * s, (y + 1) * s) }
        g.fill()
      }
    }
  } else if (id === 'rainbowGun') {
    // Stripes across, so sliding the picture runs the colours along.
    const band = SIZE / cols.length
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * band, 0, band + 1, SIZE) })
  } else {
    // Glowing skins: draw the shining parts on the colour picture and on
    // a black glow picture.
    glow = make()
    const gg = glow.getContext('2d')
    gg.fillStyle = '#000'
    gg.fillRect(0, 0, SIZE, SIZE)
    const both = (fn) => { fn(g); fn(gg) }
    if (id === 'neonGun') {
      // Diagonal pink and cyan stripes.
      for (let i = -SIZE; i < SIZE * 2; i += 32) {
        both((c) => {
          c.strokeStyle = i % 64 === 0 ? cols[1] : cols[2]
          c.lineWidth = 5
          c.beginPath()
          c.moveTo(i, 0)
          c.lineTo(i + SIZE, SIZE)
          c.stroke()
        })
      }
    } else if (id === 'lavaGun') {
      blobs([cols[1]], 18, 10, 22)
      // Cracks: jagged lines that glow orange-yellow.
      for (let k = 0; k < 9; k++) {
        let x = rnd() * SIZE
        let y = rnd() * SIZE
        const pts = [[x, y]]
        for (let s = 0; s < 6; s++) {
          x += (rnd() - 0.5) * 34
          y += (rnd() - 0.5) * 34
          pts.push([x, y])
        }
        both((c) => {
          c.strokeStyle = k % 3 ? cols[2] : cols[3]
          c.lineWidth = 2 + (k % 2)
          c.lineJoin = 'round'
          c.beginPath()
          pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
          c.stroke()
        })
      }
    } else if (id === 'galaxyGun') {
      blobs([cols[1], cols[2]], 14, 10, 26)
      g.globalAlpha = 1
      for (let k = 0; k < 60; k++) {
        const x = rnd() * SIZE
        const y = rnd() * SIZE
        const r = rnd() < 0.15 ? 1.6 : 0.8
        both((c) => {
          c.fillStyle = cols[3]
          c.beginPath()
          c.arc(x, y, r, 0, Math.PI * 2)
          c.fill()
        })
      }
    }
  }
  const out = { color, glow }
  drawn.set(id, out)
  return out
}

// How each skin's material is set up (on top of its pictures).
const LOOKS = {
  camoGun: { roughness: 0.85, metalness: 0.1 },
  arcticGun: { roughness: 0.8, metalness: 0.1 },
  neonGun: { roughness: 0.4, metalness: 0.2, glow: 1.4, pulse: 0.35 },
  goldGun: { roughness: 0.28, metalness: 0.75, emissive: 0x3a2600, glowAmount: 0.35 },
  lavaGun: { roughness: 0.7, metalness: 0.1, glow: 1.6, pulse: 0.5 },
  galaxyGun: { roughness: 0.45, metalness: 0.2, glow: 1.2 },
  rainbowGun: { roughness: 0.4, metalness: 0.15, emissive: 0x222222, glowAmount: 0.6, slide: true },
  diamondGun: { roughness: 0.12, metalness: 0.35, emissive: 0x1a5a78, glowAmount: 0.45 },
}

const textures = new Map()
function texturesFor(id) {
  if (textures.has(id)) return textures.get(id)
  const { color, glow } = canvases(id)
  const tex = (c) => {
    const tx = new THREE.CanvasTexture(c)
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping
    tx.repeat.set(2, 2)
    tx.colorSpace = THREE.SRGBColorSpace
    // Gun models' pictures are read with the glTF way up.
    tx.flipY = false
    return tx
  }
  const out = { map: tex(color), glowMap: glow ? tex(glow) : null }
  textures.set(id, out)
  return out
}

// The skin's material for one of the model's own materials (shared by
// every gun that had that material - never disposed).
const SKINNED = new Map()
export function gunSkinMaterial(base, id) {
  if (!GUN_SKINS[id] || !base) return base
  let byBase = SKINNED.get(id)
  if (!byBase) SKINNED.set(id, (byBase = new WeakMap()))
  let m = byBase.get(base)
  if (m) return m
  const look = LOOKS[id]
  const tx = texturesFor(id)
  m = new THREE.MeshStandardMaterial({
    map: tx.map,
    color: 0xffffff,
    roughness: look.roughness,
    metalness: look.metalness,
    normalMap: base.normalMap || null,
    side: base.side ?? THREE.FrontSide,
    transparent: !!base.transparent,
    opacity: base.opacity ?? 1,
    alphaTest: base.alphaTest || 0,
  })
  if (base.normalScale) m.normalScale.copy(base.normalScale)
  if (tx.glowMap) {
    m.emissive.set(0xffffff)
    m.emissiveMap = tx.glowMap
    m.emissiveIntensity = look.glow
  } else if (look.emissive) {
    m.emissive.set(look.emissive)
    m.emissiveMap = tx.map
    m.emissiveIntensity = look.glowAmount || 0.3
  }
  m.userData.gunSkin = id
  const full = m.emissiveIntensity
  if (look.slide || look.pulse) {
    // `this` is whichever material is drawn (HeldWeapon copies it).
    m.onBeforeRender = function () {
      const now = performance.now() / 1000
      if (look.slide) tx.map.offset.x = (now * 0.12) % 1
      if (look.pulse) this.emissiveIntensity = full * (1 - look.pulse + look.pulse * (0.5 + 0.5 * Math.sin(now * 2.4)))
    }
  }
  byBase.set(base, m)
  return m
}

// Paints a gun model (a copy of a viewmodel) with skin `id`, or back to its
// own colours with ''. Each mesh remembers its own material, so painting
// again with another skin (or none) always starts from the original.
export function paintGun(root, id) {
  if (!root) return
  const skin = cleanGunSkin(id)
  root.traverse((o) => {
    if (!o.isMesh) return
    if (!o.userData.gunBaseMaterial) o.userData.gunBaseMaterial = o.material
    const base = o.userData.gunBaseMaterial
    o.material = !skin ? base : Array.isArray(base) ? base.map((b) => gunSkinMaterial(b, skin)) : gunSkinMaterial(base, skin)
  })
}

// A small flat picture for the Shop, Inventory and Gallery cards: a gun
// shape filled with the skin's pattern (data URL).
const icons = new Map()
const SHAPE = [[4, 20, 10, 9], [12, 18, 22, 8], [34, 20, 11, 3], [22, 26, 5, 9], [14, 26, 5, 8], [20, 15, 6, 3]]
export function gunSkinIcon(id) {
  if (icons.has(id)) return icons.get(id)
  if (!GUN_SKINS[id]) return ''
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')
  // A dark outline one pixel round the shape...
  g.fillStyle = '#111'
  for (const [x, y, w, h] of SHAPE) g.fillRect(x - 1, y - 1, w + 2, h + 2)
  // ...then the shape, filled with the skin's colour picture (and its
  // glow on top, so the glowing bits read bright).
  const shape = document.createElement('canvas')
  shape.width = shape.height = 48
  const s = shape.getContext('2d')
  s.fillStyle = '#fff'
  for (const [x, y, w, h] of SHAPE) s.fillRect(x, y, w, h)
  s.globalCompositeOperation = 'source-in'
  const { color, glow } = canvases(id)
  s.drawImage(color, 0, 0, SIZE, SIZE, 0, 0, 48, 48)
  if (glow) {
    s.globalCompositeOperation = 'lighter'
    s.drawImage(glow, 0, 0, SIZE, SIZE, 0, 0, 48, 48)
    // Cut back to the shape - one fill for all its parts (each separate
    // fill would cut away the parts before it).
    s.globalCompositeOperation = 'destination-in'
    s.fillStyle = '#fff'
    s.beginPath()
    for (const [x, y, w, h] of SHAPE) s.rect(x, y, w, h)
    s.fill()
  }
  g.drawImage(shape, 0, 0)
  const url = c.toDataURL()
  icons.set(id, url)
  return url
}

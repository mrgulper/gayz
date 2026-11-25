// Walk trails (2026-11-25, shop plan batch 5; Gaymi: bought in the Shop,
// everyone online sees them). Sparkles, footprints or snow puffs left
// behind as you walk. Bought in Shop > Walk Trails for coins (prices a
// guess to start with), owned ones live in game.shopCosmetics (shop save),
// the one you use is settings.walkTrail, picked in the Shop or Inventory >
// Hats & Capes. Online: my pick rides in my PlayNet state (`trail`), and
// every screen leaves the same trail behind each player (PlayNet._drawPlayer).
//
// Sparkles and snow puffs are PlayFx particles; footprints lie flat on the
// ground, so they're their own small pool of flat squares per scene that
// fade out (one material each so each fades on its own).
import * as THREE from 'three'
import { ownsShopCosmetic } from './Cosmetics.js'
import { t } from './i18n.js'

export const TRAILS = {
  sparkleTrail: { price: 2000, step: 0.45, colors: [0xffd23f, 0xff5ca8, 0x5cc8ff, 0xffffff] },
  footprintTrail: { price: 1500, step: 0.8, colors: [0x3a2a1e] },
  snowTrail: { price: 2000, step: 0.5, colors: [0xffffff, 0xe6f4ff] },
}
export const TRAIL_IDS = Object.keys(TRAILS)

export const cleanTrail = (id) => (TRAILS[id] ? id : '')

// What trail I leave: my pick, if I really own it.
export function myTrail(game) {
  const id = cleanTrail(game?.settings?.walkTrail)
  return id && ownsShopCosmetic(id) ? id : ''
}

export function trailName(id) {
  return t(`trail${id.charAt(0).toUpperCase()}${id.slice(1)}`)
}

// --- footprints: a pool of flat prints per scene ---
const PRINTS = 48
const PRINT_LIFE = 4
let printTex = null
function printTexture() {
  if (printTex) return printTex
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#ffffff'
  // A blocky shoe print: the sole, a gap, the heel.
  g.fillRect(6, 4, 20, 34)
  g.fillRect(8, 44, 16, 16)
  printTex = new THREE.CanvasTexture(c)
  printTex.magFilter = THREE.NearestFilter
  return printTex
}

const pools = new WeakMap()
function poolFor(scene, B) {
  let pool = pools.get(scene)
  if (pool) return pool
  const geo = new THREE.PlaneGeometry(0.26 * B, 0.5 * B)
  geo.rotateX(-Math.PI / 2)
  const meshes = []
  for (let i = 0; i < PRINTS; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: printTexture(), color: TRAILS.footprintTrail.colors[0], transparent: true, opacity: 0, depthWrite: false }))
    m.visible = false
    m.renderOrder = 2
    m.userData.age = PRINT_LIFE
    scene.add(m)
    meshes.push(m)
  }
  pool = { meshes, next: 0, last: performance.now() }
  pools.set(scene, pool)
  return pool
}

// Fades every print by the real time passed since the last call (several
// players' trails call this each frame; only the first one moves time on).
function agePrints(pool) {
  const now = performance.now()
  const dt = Math.min(0.25, (now - pool.last) / 1000)
  pool.last = now
  if (dt <= 0) return
  for (const m of pool.meshes) {
    if (!m.visible) continue
    m.userData.age += dt
    const k = m.userData.age / PRINT_LIFE
    if (k >= 1) m.visible = false
    else m.material.opacity = 0.55 * (1 - k * k)
  }
}

function dropPrint(scene, B, x, y, z, yaw, side) {
  const pool = poolFor(scene, B)
  const m = pool.meshes[pool.next]
  pool.next = (pool.next + 1) % PRINTS
  // A little to the left or right of the middle, like two feet.
  const off = 0.16 * side
  m.position.set((x + Math.cos(yaw) * off) * B, y * B + 0.02 * B, (z - Math.sin(yaw) * off) * B)
  m.rotation.y = yaw
  m.userData.age = 0
  m.material.opacity = 0.55
  m.visible = true
}

// Hides every print (a game ending).
export function clearTrails(scene) {
  const pool = scene && pools.get(scene)
  if (pool) for (const m of pool.meshes) m.visible = false
}

// One walker's trail. step() every frame with where their feet are (in
// blocks) and how fast they move; drops a bit of trail every few steps.
export class TrailMaker {
  constructor() {
    this.x = null
    this.y = 0
    this.z = 0
    this.gone = 0
    this.side = 1
  }

  step(s, id, x, y, z, dt) {
    const scene = s?.bm?.scene
    const pool = scene && pools.get(scene)
    if (pool) agePrints(pool)
    const trail = TRAILS[id]
    if (!trail || !scene || this.x === null) {
      this.x = x
      this.y = y
      this.z = z
      this.gone = 0
      return
    }
    const dx = x - this.x
    const dz = z - this.z
    const moved = Math.hypot(dx, dz)
    const yaw = Math.atan2(dx, dz)
    const onGround = Math.abs(y - this.y) < 0.05
    this.x = x
    this.y = y
    this.z = z
    // A teleport or a fast ride: start over, no line of prints across it.
    if (moved > 3 || dt <= 0) {
      this.gone = 0
      return
    }
    this.gone += moved
    if (this.gone < trail.step) return
    this.gone = 0
    const B = s.B
    const fx = s._fx
    const c = trail.colors
    if (id === 'footprintTrail') {
      if (!onGround) return
      dropPrint(scene, B, x, y, z, yaw, this.side)
      this.side = -this.side
    } else if (id === 'sparkleTrail' && fx) {
      for (let i = 0; i < 3; i++) {
        fx.spark((x + (Math.random() - 0.5) * 0.5) * B, (y + 0.2 + Math.random() * 0.8) * B, (z + (Math.random() - 0.5) * 0.5) * B,
          { life: 0.7 + Math.random() * 0.4, from: 0.22, to: 0.04, alpha: 0.95, color: c[Math.floor(Math.random() * c.length)], vel: new THREE.Vector3(0, 0.6 * B, 0) })
      }
    } else if (id === 'snowTrail' && fx && onGround) {
      for (let i = 0; i < 4; i++) {
        fx.spark((x + (Math.random() - 0.5) * 0.4) * B, (y + 0.1) * B, (z + (Math.random() - 0.5) * 0.4) * B,
          { life: 0.6 + Math.random() * 0.3, from: 0.3, to: 0.6, alpha: 0.6, drag: 3, color: c[i % c.length], vel: new THREE.Vector3((Math.random() - 0.5) * 1.5 * B, (0.6 + Math.random()) * B, (Math.random() - 0.5) * 1.5 * B) })
      }
    }
  }
}

// A small flat picture for the Shop and Inventory cards (data URL).
const icons = new Map()
export function trailIcon(id) {
  if (icons.has(id)) return icons.get(id)
  const c = document.createElement('canvas')
  c.width = c.height = 48
  const g = c.getContext('2d')
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
  const colors = TRAILS[id]?.colors || [0xffffff]
  // Ground, and a trail going up-right across it.
  g.fillStyle = id === 'snowTrail' ? '#9fb8cc' : '#6b8f4a'
  g.fillRect(0, 30, 48, 18)
  for (let i = 0; i < 5; i++) {
    const x = 4 + i * 9
    const y = 42 - i * 3
    g.fillStyle = hex(colors[i % colors.length])
    if (id === 'footprintTrail') g.fillRect(x, y + (i % 2 ? -3 : 0), 4, 6)
    else if (id === 'snowTrail') {
      g.fillRect(x - 2, y - 2, 6, 4)
      g.fillRect(x, y - 4, 2, 2)
    } else {
      g.fillRect(x, y - 6, 2, 6)
      g.fillRect(x - 2, y - 4, 6, 2)
    }
  }
  const url = c.toDataURL()
  icons.set(id, url)
  return url
}

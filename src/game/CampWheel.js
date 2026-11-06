// The camp's Daily Lucky Wheel (2026-11-06, Gaymi's idea list 7: "spin
// once a day for coins, skins or potions"). Owned by BuildCamp
// (`camp.wheel`), only in Play.
//
// - A big wheel of SEGMENTS coloured slices on a wooden stand against a
//   camp wall, clear of the Trophy Room, the Aquarium and the Zombie Zoo.
//   Look at it and press Use: it spins for SPIN_S seconds and the arrow at
//   the top picks a prize - shop coins (kept for good), a potion, candy,
//   snowballs, Jetpack Fuel, or Spin Again.
// - One spin a day (the day it was spun is kept in WHEEL_KEY; Spin Again
//   gives one more today). Skins aren't on it: GayZ's hats and capes unlock
//   from your career, not from luck.
// - Built from its own meshes (nothing in the map changes); each player
//   has their own. Never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findWallStrip, makeLabel } from './CampTrophies.js'
import { saveShopProgress, todayDateString } from './Game.js'

export const WHEEL_KEY = 'gayz-lucky-wheel'
export const SPIN_S = 4
const WIDE = 4
const DEEP = 2
const R = 1.5 // the wheel's radius (blocks)
const USE_R = 3.5
// Each slice: what it gives and how likely it is (weights).
export const PRIZES = [
  { id: 'coins', n: 25, w: 22, color: '#e8c14a' },
  { id: 'potion', w: 14, color: '#6fc23a' },
  { id: 'coins', n: 50, w: 16, color: '#e8862a' },
  { id: 'candy', n: 3, w: 14, color: '#e8b49a' },
  { id: 'coins', n: 100, w: 9, color: '#d8352a' },
  { id: 'snowball', n: 5, w: 10, color: '#5aa7d8' },
  { id: 'coins', n: 250, w: 3, color: '#a060ff' },
  { id: 'again', w: 12, color: '#3a5fa8' },
]
export const BIG_PRIZE = 250
const POTIONS = ['potionSpeed', 'potionInvis', 'potionGiant', 'potionTiny']

// Has today's spin been used? (Untrusted when read back: only an exact
// date string counts.)
export function spunToday() {
  try {
    return localStorage.getItem(WHEEL_KEY) === todayDateString()
  } catch {
    return false
  }
}

function markSpun(on) {
  try {
    if (on) localStorage.setItem(WHEEL_KEY, todayDateString())
    else localStorage.removeItem(WHEEL_KEY)
  } catch { /* storage full or blocked */ }
}

// A prize slice by its weight.
export function pickPrize(rand = Math.random) {
  const all = PRIZES.reduce((n, p) => n + p.w, 0)
  let r = rand() * all
  for (let i = 0; i < PRIZES.length; i++) {
    r -= PRIZES[i].w
    if (r < 0) return i
  }
  return 0
}

export class CampWheel {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.spin = null // { t, from, to, prize }
    this.angle = 0
  }

  get s() {
    return this.camp.s
  }

  build(avoid = []) {
    if (this.group) return
    this.spot = findWallStrip(this.camp, WIDE, DEEP, avoid)
    if (!this.spot) return
    const B = this.camp.B
    const g = new THREE.Group()
    const wood = new THREE.MeshLambertMaterial({ color: 0x7a4f2a })
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // Two legs and a crossbar, the wheel on its axle in front.
    box(0.25, 3.4, 0.25, wood, -1.3, 1.7, 0.5)
    box(0.25, 3.4, 0.25, wood, 1.3, 1.7, 0.5)
    box(2.9, 0.25, 0.25, wood, 0, 0.3, 0.5)
    // The rim (a disc behind) and the face (flat, facing into the camp, so
    // the slices sit exactly where wheelTexture() drew them).
    const rim = new THREE.Mesh(new THREE.CylinderGeometry((R + 0.08) * B, (R + 0.08) * B, 0.14 * B, 48), new THREE.MeshLambertMaterial({ color: 0x2b2016 }))
    rim.rotation.x = Math.PI / 2
    const face = new THREE.Mesh(new THREE.CircleGeometry(R * B, 48), new THREE.MeshLambertMaterial({ map: wheelTexture() }))
    face.position.z = 0.08 * B
    this.wheel = new THREE.Group()
    this.wheel.add(rim, face)
    this.wheel.position.set(0, 2.1 * B, 0.75 * B)
    g.add(this.wheel)
    // The arrow at the top.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2 * B, 0.45 * B, 4), new THREE.MeshLambertMaterial({ color: 0xd8352a }))
    arrow.rotation.z = Math.PI
    arrow.position.set(0, (2.1 + R + 0.15) * B, 0.9 * B)
    g.add(arrow)
    const sign = makeLabel(t('wheelSign'), 512, 44, '#ffd23f')
    sign.scale.set(2.6 * B, 0.5 * B, 1)
    sign.position.set(0, 4.3 * B, 0.5 * B)
    g.add(sign)
    this.sub = makeLabel(t(spunToday() ? 'wheelComeBack' : 'wheelReady'), 512, 32, '#ffffff')
    this.sub.scale.set(3, 0.38 * B, 1)
    this.sub.position.set(0, 3.85 * B, 0.5 * B)
    g.add(this.sub)
    g.position.set(this.spot.x * B, 0, this.spot.z * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  // Where the wheel's middle is, in blocks.
  _mid() {
    const sp = this.spot
    return { x: sp.x + Math.sin(sp.rot) * 0.75, z: sp.z + Math.cos(sp.rot) * 0.75 }
  }

  // Standing close and looking at it?
  near() {
    if (!this.group) return false
    const p = this.camp.bm.tryMode.pos
    const m = this._mid()
    const dx = m.x - p.x
    const dz = m.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > USE_R) return false
    if (d < 0.6) return true
    const yaw = this.camp.bm._yaw
    return (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > 0.5
  }

  // The Use key (BuildCamp.use). -> true if it was the wheel.
  use() {
    if (!this.near()) return false
    if (this.spin) return true
    if (spunToday()) {
      this.s._message(t('wheelComeBack'), 3)
      return true
    }
    markSpun(true)
    const prize = pickPrize()
    // Land the arrow (at the top) in the middle of that slice, after a
    // few whole turns.
    const slice = (Math.PI * 2) / PRIZES.length
    const target = -(prize + 0.5) * slice
    const turns = Math.PI * 2 * 5
    const from = this.angle
    let to = target + Math.ceil((from - target + turns) / (Math.PI * 2)) * Math.PI * 2
    if (to - from < turns) to += Math.PI * 2
    this.spin = { t: 0, from, to, prize }
    this._setSub('wheelSpinning')
    try { audioEngine.playSpecial?.('drum') } catch { /* no audio */ }
    return true
  }

  _setSub(key, params) {
    if (!this.sub) return
    const B = this.camp.B
    const next = makeLabel(t(key, params), 512, 32, '#ffffff')
    next.scale.copy(this.sub.scale)
    next.scale.y = 0.38 * B
    next.position.copy(this.sub.position)
    this.sub.parent?.add(next)
    this.sub.removeFromParent()
    this.sub.material.map?.dispose()
    this.sub.material.dispose()
    this.sub = next
  }

  // Every frame (BuildCamp.update).
  update(dt) {
    if (!this.group || !this.spin) return
    const sp = this.spin
    sp.t += dt
    const k = Math.min(1, sp.t / SPIN_S)
    // Fast, then slowing to a stop.
    this.angle = sp.from + (sp.to - sp.from) * (1 - (1 - k) ** 3)
    this.wheel.rotation.z = -this.angle
    if (Math.floor(this.angle / ((Math.PI * 2) / PRIZES.length)) !== this._lastTick) {
      this._lastTick = Math.floor(this.angle / ((Math.PI * 2) / PRIZES.length))
      if (k < 0.97) try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    }
    if (k < 1) return
    this.spin = null
    this._give(PRIZES[sp.prize])
  }

  _give(p) {
    const s = this.s
    const game = s.bm.game
    let text
    if (p.id === 'coins') {
      if (game) {
        game.coins = (game.coins || 0) + p.n
        saveShopProgress(game)
        game._renderCurrencyBar?.()
      }
      text = t('wheelWonCoins', { n: p.n })
    } else if (p.id === 'potion') {
      s.inv?.add({ kind: 'item', id: POTIONS[Math.floor(Math.random() * POTIONS.length)], n: 1 })
      text = t('wheelWonPotion')
    } else if (p.id === 'candy') {
      s.inv?.add({ kind: 'item', id: 'candy', n: p.n })
      text = t('wheelWonCandy', { n: p.n })
    } else if (p.id === 'snowball') {
      s.inv?.add({ kind: 'item', id: 'snowball', n: p.n })
      text = t('wheelWonSnowballs', { n: p.n })
    } else {
      markSpun(false)
      text = t('wheelWonAgain')
    }
    s._renderHud?.()
    s._message(text, 4)
    this._setSub(spunToday() ? 'wheelComeBack' : 'wheelReady')
    try { audioEngine.playSpecial?.(p.n >= BIG_PRIZE ? 'firework' : 'chime') } catch { /* no audio */ }
  }

  dispose() {
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        m.map?.dispose?.()
        m.dispose()
      }
    })
    this.group = null
    this.spin = null
  }
}

// The wheel's face: coloured slices with what each one gives. Slice 0
// starts at the top and they go round clockwise.
function wheelTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')
  const n = PRIZES.length
  const slice = (Math.PI * 2) / n
  PRIZES.forEach((p, i) => {
    const a0 = -Math.PI / 2 + i * slice
    g.beginPath()
    g.moveTo(256, 256)
    g.arc(256, 256, 250, a0, a0 + slice)
    g.closePath()
    g.fillStyle = p.color
    g.fill()
    g.strokeStyle = '#2b2016'
    g.lineWidth = 4
    g.stroke()
    g.save()
    g.translate(256, 256)
    g.rotate(a0 + slice / 2)
    g.fillStyle = '#ffffff'
    g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    g.lineWidth = 5
    g.font = 'bold 30px sans-serif'
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    const label = p.id === 'coins' ? String(p.n) : t(`wheelSlice_${p.id}`)
    g.strokeText(label, 230, 0, 150)
    g.fillText(label, 230, 0, 150)
    g.restore()
  })
  g.beginPath()
  g.arc(256, 256, 30, 0, Math.PI * 2)
  g.fillStyle = '#2b2016'
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

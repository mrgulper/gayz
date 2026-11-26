// Jump + death effects (2026-11-25, big shop plan batch 6; Gaymi: like
// Kill Effects - bought in the Shop, everyone online sees them).
// Jump: a little burst at your feet every time you jump (Cloud Puff,
// Hearts, Lightning, Rainbow Ring). Death: something where you fall when
// you die (Tombstone, Ghost, Firework, Explosion - looks only, no damage).
// Bought in Shop > Jump Effects / Death Effects for coins (10k-100k, the
// Kill Effects ladder - Gaymi), owned ones live in game.shopCosmetics, the
// ones used are settings.jumpEffect / settings.deathEffect, picked in the
// Shop or Inventory > Cosmetics.
//
// Online: my picks ride in my PlayNet state (`jfx`, `dfx`) with a jump
// count (`jn`); a screen plays my jump effect when the count goes up and
// my death effect when I go from alive to dead (PlayNet).
//
// Particles are PlayFx (`s._fx`); the ghost and the tombstone are small
// box models that live a few seconds (updateDeathProps, each frame).
import * as THREE from 'three'
import { ownsShopCosmetic } from './Cosmetics.js'
import { t } from './i18n.js'

const RAINBOW = [0xff3b3b, 0xff9a2e, 0xffe14d, 0x4dff7a, 0x3bb8ff, 0x8a5cff]

export const JUMP_EFFECTS = {
  cloudJump: { price: 10000, colors: [0xffffff, 0xe8f2ff] },
  heartJump: { price: 25000, colors: [0xff5ca8, 0xff8fc4, 0xff2e6e] },
  zapJump: { price: 50000, colors: [0xffe14d, 0xfff6b0, 0x7fd8ff] },
  rainbowJump: { price: 100000, colors: RAINBOW },
}
export const JUMP_EFFECT_IDS = Object.keys(JUMP_EFFECTS)

export const DEATH_EFFECTS = {
  tombDeath: { price: 10000, colors: [0x8a8f96, 0x5a5f66] },
  ghostDeath: { price: 25000, colors: [0xf4f8ff, 0x1a1a1a] },
  fireworkDeath: { price: 50000, colors: [0xff5ca8, 0xffd23f, 0x5cc8ff, 0x7dff8a] },
  boomDeath: { price: 100000, colors: [0xff7a1a, 0xffd23f, 0x4a4038] },
}
export const DEATH_EFFECT_IDS = Object.keys(DEATH_EFFECTS)

export const cleanJumpEffect = (id) => (JUMP_EFFECTS[id] ? id : '')
export const cleanDeathEffect = (id) => (DEATH_EFFECTS[id] ? id : '')

// My picks, if I really own them.
export function myJumpEffect(game) {
  const id = cleanJumpEffect(game?.settings?.jumpEffect)
  return id && ownsShopCosmetic(id) ? id : ''
}
export function myDeathEffect(game) {
  const id = cleanDeathEffect(game?.settings?.deathEffect)
  return id && ownsShopCosmetic(id) ? id : ''
}

const cap = (id) => `${id.charAt(0).toUpperCase()}${id.slice(1)}`
export const jumpEffectName = (id) => t(`jumpFx${cap(id)}`)
export const deathEffectName = (id) => t(`deathFx${cap(id)}`)

// --- jump: x, y, z = the feet, in blocks ---
export function playJumpEffect(s, id, x, y, z) {
  const fx = s?._fx
  if (!fx || !JUMP_EFFECTS[id]) return
  const B = s.B
  const wx = x * B
  const wy = (y + 0.05) * B
  const wz = z * B
  const colors = JUMP_EFFECTS[id].colors
  const V = (vx, vy, vz) => new THREE.Vector3(vx * B, vy * B, vz * B)
  if (id === 'cloudJump') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      fx.emit('puff', wx, wy + 0.1 * B, wz, { life: 0.6 + Math.random() * 0.2, from: 0.35, to: 0.75, alpha: 0.85, drag: 3, color: colors[i % 2], vel: V(Math.cos(a) * 2.2, 0.3, Math.sin(a) * 2.2) })
    }
  } else if (id === 'heartJump') {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2
      fx.emit('heart', wx, wy + 0.2 * B, wz, { life: 0.9 + Math.random() * 0.4, from: 0.3, to: 0.22, gravity: -1.2, drag: 1.5, stretch: 1, color: colors[i % colors.length], delay: i * 0.03, vel: V(Math.cos(a) * 1.2, 1 + Math.random(), Math.sin(a) * 1.2) })
    }
  } else if (id === 'zapJump') {
    fx.emit('flash', wx, wy + 0.2 * B, wz, { life: 0.12, from: 0.6, to: 1.2, alpha: 0.7 })
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2
      const out = 3 + Math.random() * 3
      fx.spark(wx, wy + 0.1 * B, wz, { life: 0.25 + Math.random() * 0.15, from: 0.18, to: 0.05, drag: 4, color: colors[i % colors.length], vel: V(Math.cos(a) * out, 1 + Math.random() * 3, Math.sin(a) * out) })
    }
  } else if (id === 'rainbowJump') {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      fx.spark(wx, wy + 0.1 * B, wz, { life: 0.55, from: 0.22, to: 0.12, drag: 1.5, color: colors[i % colors.length], vel: V(Math.cos(a) * 3, 0.15, Math.sin(a) * 3) })
    }
  }
}

// --- death: x, y, z = the feet, in blocks ---
export function playDeathEffect(s, id, x, y, z) {
  const fx = s?._fx
  if (!fx || !DEATH_EFFECTS[id]) return
  const B = s.B
  const colors = DEATH_EFFECTS[id].colors
  const V = (vx, vy, vz) => new THREE.Vector3(vx * B, vy * B, vz * B)
  if (id === 'tombDeath' || id === 'ghostDeath') {
    addProp(s, id, x, y, z)
    fx.emit('puff', x * B, (y + 0.2) * B, z * B, { life: 0.7, from: 0.5, to: 1.2, alpha: 0.7, color: 0xdddddd })
  } else if (id === 'fireworkDeath') {
    // A rocket shoots up from the body and pops in colours.
    const top = y + 6
    for (let i = 0; i < 14; i++) {
      fx.spark(x * B, (y + 0.5 + (i / 14) * 5.5) * B, z * B, { life: 0.35, from: 0.2, to: 0.05, color: 0xffd23f, delay: i * 0.035 })
    }
    const pop = 0.5
    fx.emit('flash', x * B, top * B, z * B, { life: 0.2, from: 1.5, to: 3, alpha: 0.8, delay: pop })
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const up = Math.random() * 2 - 1
      const out = 4 + Math.random() * 2
      const flat = Math.sqrt(1 - up * up)
      fx.spark(x * B, top * B, z * B, { life: 1 + Math.random() * 0.5, from: 0.3, to: 0.08, gravity: 2.5, drag: 1.4, color: colors[i % colors.length], delay: pop, vel: V(Math.cos(a) * flat * out, up * out, Math.sin(a) * flat * out) })
    }
  } else if (id === 'boomDeath') {
    // Looks only - nothing is hurt or broken.
    fx.explode(new THREE.Vector3(x * B, y * B, z * B), 1.6)
  }
}

// --- the ghost + tombstone models ---
let geoBox = null
function box(w, h, d, color, opacity = 1) {
  if (!geoBox) geoBox = new THREE.BoxGeometry(1, 1, 1)
  const m = new THREE.Mesh(geoBox, new THREE.MeshLambertMaterial({ color, transparent: true, opacity }))
  m.scale.set(w, h, d)
  return m
}

function addProp(s, id, x, y, z) {
  const B = s.B
  const g = new THREE.Group()
  if (id === 'tombDeath') {
    const stone = box(0.7 * B, 0.9 * B, 0.22 * B, 0x8a8f96)
    stone.position.y = 0.45 * B
    const cap = box(0.5 * B, 0.15 * B, 0.22 * B, 0x8a8f96)
    cap.position.y = 0.95 * B
    const crossV = box(0.08 * B, 0.4 * B, 0.03 * B, 0x4a4f56)
    crossV.position.set(0, 0.6 * B, 0.12 * B)
    const crossH = box(0.26 * B, 0.08 * B, 0.03 * B, 0x4a4f56)
    crossH.position.set(0, 0.66 * B, 0.12 * B)
    g.add(stone, cap, crossV, crossH)
  } else {
    const body = box(0.6 * B, 0.75 * B, 0.45 * B, 0xf4f8ff, 0.8)
    body.position.y = 0.4 * B
    const eyeL = box(0.1 * B, 0.14 * B, 0.03 * B, 0x1a1a1a, 0.9)
    eyeL.position.set(-0.13 * B, 0.52 * B, 0.23 * B)
    const eyeR = eyeL.clone()
    eyeR.material = eyeL.material.clone()
    eyeR.position.x = 0.13 * B
    g.add(body, eyeL, eyeR)
  }
  g.position.set(x * B, y * B, z * B)
  g.rotation.y = Math.random() * Math.PI * 2
  s.bm.scene.add(g)
  if (!s._deathProps) s._deathProps = []
  s._deathProps.push({ id, g, t: 0, life: id === 'tombDeath' ? 6 : 3, y: y * B })
}

// Each frame: the ghost floats up and fades; the tombstone pops up out of
// the ground, stays, then sinks back.
export function updateDeathProps(s, dt) {
  const list = s?._deathProps
  if (!list?.length) return
  const B = s.B
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i]
    p.t += dt
    const k = p.t / p.life
    if (k >= 1) {
      removeProp(p)
      list.splice(i, 1)
      continue
    }
    if (p.id === 'tombDeath') {
      const up = Math.min(1, p.t / 0.3)
      const down = Math.max(0, (p.t - (p.life - 0.6)) / 0.6)
      p.g.position.y = p.y - (1 - up + down) * 1.1 * B
    } else {
      p.g.position.y = p.y + p.t * 1.2 * B
      p.g.position.x += Math.sin(p.t * 4) * 0.4 * B * dt
      const fade = 1 - k
      p.g.children.forEach((c, j) => { c.material.opacity = (j === 0 ? 0.8 : 0.9) * fade })
    }
  }
}

function removeProp(p) {
  p.g.parent?.remove(p.g)
  p.g.children.forEach((c) => c.material.dispose())
}

export function clearDeathProps(s) {
  for (const p of s?._deathProps || []) removeProp(p)
  if (s) s._deathProps = []
}

// --- small flat pictures for the Shop and Inventory cards ---
const icons = new Map()
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
function iconCanvas(key, draw) {
  if (icons.has(key)) return icons.get(key)
  const c = document.createElement('canvas')
  c.width = c.height = 48
  draw(c.getContext('2d'))
  const url = c.toDataURL()
  icons.set(key, url)
  return url
}

function drawGuy(g, y = 14) {
  g.fillStyle = '#5c9fd6'
  g.fillRect(19, y + 8, 10, 12)
  g.fillStyle = '#e8b48a'
  g.fillRect(19, y, 10, 8)
  g.fillStyle = '#3a3a5a'
  g.fillRect(19, y + 20, 4, 6)
  g.fillRect(25, y + 20, 4, 6)
}

export function jumpEffectIcon(id) {
  return iconCanvas(`j:${id}`, (g) => {
    const colors = JUMP_EFFECTS[id]?.colors || [0xffffff]
    drawGuy(g, 6)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const x = 24 + Math.cos(a) * 16
      const y = 42 + Math.sin(a) * 4
      g.fillStyle = hex(colors[i % colors.length])
      if (id === 'cloudJump') { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill() }
      else if (id === 'heartJump') { g.fillRect(x - 3, y - 6, 3, 3); g.fillRect(x, y - 6, 3, 3); g.fillRect(x - 2, y - 3, 4, 3) }
      else if (id === 'zapJump') { g.fillRect(x - 1, y - 5, 2, 5); g.fillRect(x, y - 1, 2, 5) }
      else g.fillRect(x - 2, y - 2, 4, 4)
    }
  })
}

export function deathEffectIcon(id) {
  return iconCanvas(`d:${id}`, (g) => {
    const colors = DEATH_EFFECTS[id]?.colors || [0xffffff]
    if (id === 'tombDeath') {
      g.fillStyle = '#8a8f96'
      g.fillRect(14, 12, 20, 30)
      g.fillRect(17, 9, 14, 4)
      g.fillStyle = '#4a4f56'
      g.fillRect(23, 16, 3, 14)
      g.fillRect(19, 20, 11, 3)
      g.fillStyle = '#4c7a3a'
      g.fillRect(8, 42, 32, 4)
    } else if (id === 'ghostDeath') {
      g.fillStyle = '#f4f8ff'
      g.fillRect(14, 10, 20, 26)
      g.fillRect(14, 36, 5, 4)
      g.fillRect(22, 36, 5, 4)
      g.fillRect(29, 36, 5, 4)
      g.fillStyle = '#1a1a1a'
      g.fillRect(18, 18, 4, 5)
      g.fillRect(26, 18, 4, 5)
    } else if (id === 'fireworkDeath') {
      g.fillStyle = '#ffd23f'
      for (let y = 30; y < 46; y += 4) g.fillRect(23, y, 2, 2)
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        g.fillStyle = hex(colors[i % colors.length])
        g.fillRect(24 + Math.cos(a) * 13 - 2, 18 + Math.sin(a) * 13 - 2, 4, 4)
      }
    } else {
      g.fillStyle = '#4a4038'
      g.beginPath(); g.arc(24, 30, 16, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ff7a1a'
      g.beginPath(); g.arc(24, 28, 12, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#ffd23f'
      g.beginPath(); g.arc(24, 28, 6, 0, Math.PI * 2); g.fill()
    }
  })
}

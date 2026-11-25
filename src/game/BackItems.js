// Back items (2026-11-25, big shop plan batch 3; Gaymi picked a new Back
// slot, 4 wings that flap + 4 backpacks). Bought in Shop > Back Items
// (ShopCosmetics.js), worn from Inventory > Cosmetics, seen by everyone
// online (PlayNet state `back`). Worn WITH a hat and a cape: when a cape
// is on, the back item sits a little further out so they don't clip.
//
// Built from boxes in the blocky body's units (MenuAvatar3D: torso y
// 10-22, 8 wide, its back at z = -2). Boxes: [w, h, d, x, y, z, colour,
// extra]; z is how far out from the back (negative = away from the body).
// Wings: `wing` is the RIGHT wing, from its root on the upper back
// (x out, y up); the left one is its mirror. They sweep back a little and
// flap - gently standing still, harder while you move.
// Packs: `boxes` hang straight; `tilt` turns them (radians) around y = `pivot`.
// extra 'flame' flickers (the jetpack's fire).
import * as THREE from 'three'
import { BODY_WIDE } from './MenuAvatar3D.js'

export const BACK_ITEMS = {
  angelWings: {
    wing: [[3, 5, 0.8, 1.5, 0, 0, 0xffffff], [3, 7, 0.8, 4.5, 0.5, 0, 0xffffff], [3, 8, 0.8, 7.5, 1, 0, 0xf0f4ff], [2.5, 6, 0.8, 10, 2, 0, 0xe0e8ff]],
  },
  batWings: {
    wing: [[3, 3, 0.6, 1.5, 1, 0, 0x2a1a2a], [3, 6, 0.6, 4.5, 0, 0, 0x4a2a4a], [3, 8, 0.6, 7.5, -0.5, 0, 0x4a2a4a], [2, 9, 0.6, 10, 0, 0, 0x3a1f3a], [12, 0.8, 0.8, 6, 4.2, 0, 0x2a1a2a]],
  },
  butterflyWings: {
    wing: [[5, 6, 0.5, 3.5, 2.5, 0, 0xff5ca8], [3, 4, 0.5, 7, 4, 0, 0xffa3d0], [4, 4, 0.5, 3, -3, 0, 0x5cc8ff], [1.6, 1.6, 0.6, 4, 3, 0, 0xffd23f], [1.2, 1.2, 0.6, 3, -3, 0, 0xffffff]],
  },
  dragonWings: {
    wing: [[3, 3, 0.6, 1.5, 1, 0, 0x1f6a2a], [3, 6, 0.6, 4.5, 0, 0, 0x7a1a1a], [3, 8, 0.6, 7.5, -0.5, 0, 0xb82a1a], [2, 9, 0.6, 10, 0, 0, 0x7a1a1a], [12, 0.8, 0.8, 6, 4.2, 0, 0x1f6a2a], [1, 1.6, 1, 12.2, 5, 0, 0xe8e0c8]],
  },
  survivalPack: {
    boxes: [[6, 8, 3, 0, 15, -1.5, 0x5a6a3a], [4, 3, 1, 0, 13, -3.3, 0x4a5a2a], [7, 2, 2, 0, 20, -1.5, 0x8a5a2e], [1, 1, 0.4, 0, 14, -3.9, 0xd4a52c]],
  },
  jetpack: {
    boxes: [
      [2.6, 8, 2.6, -1.6, 15, -1.6, 0x9aa4ae], [2.6, 8, 2.6, 1.6, 15, -1.6, 0x9aa4ae],
      [2, 1, 2, -1.6, 19.5, -1.6, 0xe0284f], [2, 1, 2, 1.6, 19.5, -1.6, 0xe0284f],
      [1.6, 1.2, 1.6, -1.6, 10.4, -1.6, 0x3a3a3a], [1.6, 1.2, 1.6, 1.6, 10.4, -1.6, 0x3a3a3a],
      [1.2, 2, 1.2, -1.6, 8.8, -1.6, 0xffa31a, 'flame'], [1.2, 2, 1.2, 1.6, 8.8, -1.6, 0xffa31a, 'flame'],
    ],
  },
  teddyPack: {
    boxes: [
      [5, 6, 2.6, 0, 14, -1.3, 0x9a6a3a], [4, 4, 3, 0, 19, -1.5, 0x9a6a3a],
      [1.4, 1.4, 1, -1.8, 21.2, -1.5, 0x7a4a2a], [1.4, 1.4, 1, 1.8, 21.2, -1.5, 0x7a4a2a],
      [1.6, 1.2, 0.6, 0, 18.4, -3.2, 0xd8b48a], [0.6, 0.6, 0.3, -1, 19.6, -3.05, 0x1a1a1a], [0.6, 0.6, 0.3, 1, 19.6, -3.05, 0x1a1a1a],
    ],
  },
  guitar: {
    tilt: 0.55,
    pivot: 16,
    boxes: [
      [5, 5, 1.6, 0, 12, -1, 0xd4702a], [4, 3, 1.6, 0, 15.5, -1, 0xd4702a], [1.4, 1.4, 0.3, 0, 14, -1.9, 0x2a1a0e],
      [1, 9, 1, 0, 21.5, -1, 0x5a3a1e], [1.6, 2, 1, 0, 27, -1, 0x3a2414],
    ],
  },
}
export const BACK_IDS = Object.keys(BACK_ITEMS)

const geoCache = new Map()
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d))
  return geoCache.get(key)
}

function addBox(parent, [w, h, d, x, y, z, color, extra], mirror = 1) {
  const mesh = new THREE.Mesh(boxGeo(w, h, d), new THREE.MeshLambertMaterial({ color }))
  mesh.position.set(x * mirror, y, z)
  mesh.userData.shared = true // shared geometry: never disposed
  if (extra === 'flame') {
    // A flickering flame (a frame behind - nobody can tell).
    mesh.onBeforeRender = () => {
      const f = 0.75 + Math.random() * 0.5
      mesh.scale.set(f, f, f)
    }
  }
  parent.add(mesh)
  return mesh
}

// Where wings sit on the back, and how far they sweep back.
const WING_ROOT_Y = 18
const WING_SWEEP = 0.25

// The back item as a group, ready to add to a blocky body (Cosmetics).
export function makeBack(id) {
  const item = BACK_ITEMS[id]
  if (!item) return null
  const group = new THREE.Group()
  group.name = 'cosmeticBack'
  group.position.z = -BODY_WIDE * 2
  if (item.wing) {
    const wings = [1, -1].map((side) => {
      const pivot = new THREE.Group()
      pivot.position.set(side * 1, WING_ROOT_Y, -0.6)
      for (const box of item.wing) addBox(pivot, box, side)
      group.add(pivot)
      return pivot
    })
    // Flap: gently while standing, harder while moving (how far the body
    // went since the last frame). Runs on the first box's draw.
    const ticker = wings[0].children[0]
    const here = new THREE.Vector3()
    let last = null
    let lastT = 0
    let speed = 0
    ticker.onBeforeRender = () => {
      const now = performance.now()
      const dt = (now - lastT) / 1000
      if (dt > 0.008) {
        group.getWorldPosition(here)
        if (last && dt < 0.5) speed += (Math.min(1, last.distanceTo(here) / dt / 3) - speed) * Math.min(1, dt * 4)
        last = (last || new THREE.Vector3()).copy(here)
        lastT = now
      }
      const flap = Math.sin(now / (speed > 0.3 ? 110 : 320)) * (0.12 + speed * 0.4)
      wings[0].rotation.y = WING_SWEEP + flap
      wings[1].rotation.y = -WING_SWEEP - flap
    }
  } else {
    const holder = new THREE.Group()
    const pivotY = item.pivot || 0
    holder.position.y = pivotY
    holder.rotation.z = item.tilt || 0
    for (const [w, h, d, x, y, z, color, extra] of item.boxes) addBox(holder, [w, h, d, x, y - pivotY, z, color, extra])
    group.add(holder)
  }
  return group
}

// A cape is on: push the back item out past it (wings sit high, where the
// cape is still close; packs hang lower, where it flares out).
export function placeBack(group, id, capeOn) {
  if (!group) return
  const out = !capeOn ? 0 : BACK_ITEMS[id]?.wing ? 1.4 : 2.2
  group.position.z = -BODY_WIDE * 2 - out
}

// Its flat picture (Inventory / Shop card), seen from behind over a grey
// body. Drawn on a 48px canvas.
export function drawBackIcon(g, id) {
  const item = BACK_ITEMS[id]
  if (!item) return
  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`
  // Wings are wide: the whole body fits. Packs: zoomed in on the back.
  const s = item.wing ? 1.6 : 2.2
  const midY = item.wing ? 18 : 17
  const px = (x) => 24 + x * s
  const py = (y) => 24 - (y - midY) * s
  g.fillStyle = 'rgba(120,120,120,0.55)'
  g.fillRect(px(-4), py(30), 8 * s, 8 * s) // head
  g.fillRect(px(-4), py(22), 8 * s, 12 * s) // torso
  const rect = (w, h, x, y, color) => {
    g.fillStyle = hex(color)
    g.fillRect(px(x - w / 2), py(y + h / 2), w * s, h * s)
  }
  if (item.wing) {
    for (const side of [1, -1]) {
      for (const [w, h, , x, y, , color] of item.wing) rect(w * 0.75, h, side * (1 + x * 0.75), WING_ROOT_Y + y, color)
    }
  } else {
    const pivotY = item.pivot || 0
    g.save()
    g.translate(px(0), py(pivotY))
    g.rotate(-(item.tilt || 0))
    g.translate(-px(0), -py(pivotY))
    for (const [w, h, , x, y, , color] of item.boxes) rect(w, h, x, y, color)
    g.restore()
  }
}

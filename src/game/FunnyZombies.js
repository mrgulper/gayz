// Sillier zombies (2026-10-31, Gaymi: "make gayz more funny based instead
// of looking so cold"):
//
// - hats: about one zombie in HAT_EVERY wears a party hat, a traffic cone
//   or a tiny crown. Picked from the zombie's id, so on a server everyone
//   sees the same hat on the same zombie without sending anything. Built
//   from boxes like everything else, in the body's own units (the head's
//   top is at y = HEAD_TOP), so it rides along when the body is copied
//   for its corpse and fades with it.
// - goofs: now and then a moan comes out as a burp or a hiccup instead
//   (GOOF_CHANCE; Audio.playZombieGoof).
// - disco: the Disco Zombie (a shine, ZombieNames.js) dances instead of
//   walking with its arms out - one arm points up, then the other, and it
//   bobs to the beat (poseZombieLimbs).
import * as THREE from 'three'

export const HAT_EVERY = 7
export const HAT_KINDS = ['party', 'cone', 'crown']
export const GOOF_CHANCE = 0.2
const HEAD_TOP = 30

// Which hat (or null) a zombie wears: the same answer for the same id on
// every player's screen.
export function zombieHat(id) {
  const h = Math.imul((id | 0) ^ 0x5bd1e995, 0x27d4eb2d) >>> 0
  if (h % HAT_EVERY !== 0) return null
  return HAT_KINDS[(h >>> 8) % HAT_KINDS.length]
}

// [width, height, depth, y, colour] boxes stacked up from the head's top,
// all centred over it (body units: the head is 8 across).
const HAT_BOXES = {
  party: [
    [6, 2, 6, 1, 0xff5ca8], [4.6, 2, 4.6, 3, 0x5cc8ff], [3.2, 2, 3.2, 5, 0xffd23f],
    [1.8, 2, 1.8, 7, 0xff5ca8], [1.6, 1.6, 1.6, 8.8, 0xffffff],
  ],
  cone: [
    [9, 1, 9, 0.5, 0x2a2a2a], [6, 2.5, 6, 2.25, 0xff7a1a], [4.6, 1.5, 4.6, 4.25, 0xffffff],
    [3.6, 2.5, 3.6, 6.25, 0xff7a1a], [2.2, 1.5, 2.2, 8.25, 0xff7a1a],
  ],
  crown: [
    [5, 1.4, 5, 0.7, 0xf2c94c],
    [1, 1.6, 1, 2.2, 0xf8d870, -2, -2], [1, 1.6, 1, 2.2, 0xf8d870, 2, -2],
    [1, 1.6, 1, 2.2, 0xf8d870, -2, 2], [1, 1.6, 1, 2.2, 0xf8d870, 2, 2],
    [1, 1, 1, 1, 0xe0284f, 0, -2.6],
  ],
  // Players' hats only (Cosmetics.js) - zombies wear HAT_KINDS.
  propeller: [
    [8.4, 2, 8.4, 1, 0xe0284f], [8.4, 0.6, 3, 0.3, 0x2a62d8, 0, 5], [0.8, 1.4, 0.8, 2.7, 0xffd23f],
    [7, 0.4, 1, 3.6, 0x5cc8ff, 0, 0, 'spin'],
  ],
  chicken: [
    [7, 4, 7, 2, 0xf6f4ee], [1.4, 1.6, 4, 4.8, 0xe0284f], [2, 1, 2, 2.5, 0xf2b234, 0, 4.4],
    [1, 1, 1, 3.2, 0x1a1a1a, -2.4, 3.2], [1, 1, 1, 3.2, 0x1a1a1a, 2.4, 3.2],
  ],
}
// The boxes of a hat, for its Inventory picture (Cosmetics.cosmeticIcon).
export const HAT_BOX_COLORS = (kind) => HAT_BOXES[kind] || []

const geoCache = new Map()
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d))
  return geoCache.get(key)
}

// A hat for a zombie's body (child of the body, in its units). Each hat
// has its own materials, so fading one corpse never fades another hat;
// the geometry is shared (userData.shared: never disposed).
export function makeHat(kind) {
  const boxes = HAT_BOXES[kind]
  if (!boxes) return null
  const hat = new THREE.Group()
  hat.name = 'zombieHat'
  // Tipped a little, at a jaunty angle.
  hat.rotation.z = kind === 'crown' ? 0.12 : -0.18
  hat.position.y = HEAD_TOP
  for (const [w, h, d, y, color, x = 0, z = 0, spin] of boxes) {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), new THREE.MeshLambertMaterial({ color }))
    mesh.position.set(x, y, z)
    mesh.userData.shared = true
    // A propeller turns all by itself (a frame behind - nobody can tell).
    if (spin) mesh.onBeforeRender = () => { mesh.rotation.y = performance.now() / 90 }
    hat.add(mesh)
  }
  return hat
}

export function disposeHat(hat) {
  hat?.traverse((o) => {
    if (o.isMesh) for (const m of [].concat(o.material)) m.dispose()
  })
}

// A zombie body's arms and legs this frame. swing: the walk's swing.
// disco: the Disco Zombie, dancing (t: seconds, id: its own offset).
// -> how far its body bobs up (body units), 0 when not dancing.
export function poseZombieLimbs(lp, swing, disco = false, t = 0, id = 0) {
  if (!disco) {
    lp.legR.rotation.x = swing
    lp.legL.rotation.x = -swing
    lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
    lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
    lp.armR.rotation.z = 0
    lp.armL.rotation.z = 0
    return 0
  }
  const beat = t * 4.2 + id
  // Point up on one side, hand on hip on the other, then swap.
  const up = Math.sin(beat * 0.5) > 0
  lp.armR.rotation.x = up ? -Math.PI * 0.95 : -0.3
  lp.armL.rotation.x = up ? -0.3 : -Math.PI * 0.95
  lp.armR.rotation.z = up ? 0.35 : -0.5
  lp.armL.rotation.z = up ? 0.5 : -0.35
  const step = Math.sin(beat) * 0.35
  lp.legR.rotation.x = step + swing * 0.5
  lp.legL.rotation.x = -step - swing * 0.5
  return Math.abs(Math.sin(beat)) * 1.2
}

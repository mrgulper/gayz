// A plain person standing somewhere (2026-11-09, for Pizza Delivery's
// customers and the Zombie Diner's): a name tag at once, and a blocky body
// (MOB_HEIGHT tall) in one of the camp people's skins once it loads.
// Meshes only, never a light. disposePerson() takes it away again.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { nameTag, NPC_SKINS } from './BuildCamp.js'
import { MOB_HEIGHT } from './PlayRules.js'

const SKINS = Object.values(NPC_SKINS)

// -> { group, body (null until it loads), x, y, z }. onBody(body) runs once
// the body is in (for extra bits like a zombie's green hands).
export function makePerson(s, at, name, onBody = null) {
  const B = s.B
  const group = new THREE.Group()
  group.position.set(at.x * B, at.y * B, at.z * B)
  if (name) group.add(nameTag(name, B))
  s.bm.scene.add(group)
  const p = { x: at.x, y: at.y, z: at.z, group, body: null }
  loadSkinTexture(SKINS[Math.floor(Math.random() * SKINS.length)]).then((skin) => {
    if (!group.parent) return
    const body = buildTexturedCharacter(skin)
    const sc = (MOB_HEIGHT * B) / 32
    body.scale.setScalar(sc)
    body.position.y = 2 * sc
    group.add(body)
    p.body = body
    onBody?.(body, sc)
  }).catch(() => { /* just the name */ })
  return p
}

export function disposePerson(p) {
  const g = p?.group
  if (!g) return
  g.removeFromParent()
  g.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    // (A skin's texture is shared - only a sprite's own one goes.)
    for (const m of [].concat(o.material)) {
      if (o.isSprite) m.map?.dispose?.()
      m.dispose()
    }
  })
}

// A box mesh in blocks (w, h, d, colour, x, y, z) added to `parent`.
export function boxIn(parent, B, w, h, d, color, x, y, z, extra = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color, ...extra }))
  m.position.set(x * B, y * B, z * B)
  parent.add(m)
  return m
}

export function disposeGroup(g) {
  if (!g) return
  g.removeFromParent()
  g.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    // (A skin's texture is shared - only a sprite's own one goes.)
    for (const m of [].concat(o.material)) {
      if (o.isSprite) m.map?.dispose?.()
      m.dispose()
    }
  })
}

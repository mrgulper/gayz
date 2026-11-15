// Other players' spin rings on a server (2026-11-15, spin ring plan
// Batch 4, Gaymi: "other players see your ring"). Each player's sync
// carries their ring (SpinRing.netState: the items and how far out it
// sits); here it's drawn spinning round their avatar, the same items with
// the same rarity bands, spreading and pulling in as they do. Only a
// picture: their hits are worked out on their own screen and reach the
// host (zombies) or you (friendly fire) through the server.
//
// Called from PlayNet._drawPlayer / _removePlayer. Meshes only.
import * as THREE from 'three'
import { parseKey, makeItemMesh, rarityBand } from './RingItems.js'
import { SPIN, RING_Y, R_EASE } from './SpinRing.js'

const KEY_RE = /^[a-z]{1,16}:[a-z]{1,10}$/

// A ring from the sync -> { k: [keys], r } or null.
export function cleanRemoteRing(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.k)) return null
  const k = v.k.slice(0, 10).filter((key) => typeof key === 'string' && KEY_RE.test(key) && parseKey(key))
  if (!k.length) return null
  const r = Number(v.r)
  return { k, r: Number.isFinite(r) ? Math.max(0, Math.min(5, r)) : 1.8 }
}

function build(s, p) {
  disposeRemoteRing(s, p)
  const B = s.B
  const group = new THREE.Group()
  group.name = 'remote-ring'
  const items = []
  for (const key of p.ring.k) {
    const it = parseKey(key)
    const mesh = makeItemMesh(it.id, B)
    const band = rarityBand(it.rarity, B)
    band.position.y = -0.2 * B
    mesh.add(band)
    group.add(mesh)
    items.push({ id: it.id, mesh })
  }
  s.bm.scene.add(group)
  p.ringView = { key: p.ring.k.join(','), group, items, spin: Math.random() * Math.PI * 2, r: p.ring.r }
}

// Each frame: their ring follows them round (hidden while they're dead or
// wear none).
export function drawRemoteRing(s, p, dt) {
  const want = p.ring && !p.dead ? p.ring.k.join(',') : ''
  if (!want) {
    if (p.ringView) p.ringView.group.visible = false
    return
  }
  if (!p.ringView || p.ringView.key !== want) build(s, p)
  const v = p.ringView
  v.group.visible = true
  v.spin = (v.spin + SPIN * dt) % (Math.PI * 2)
  v.r += (p.ring.r - v.r) * Math.min(1, R_EASE * dt)
  const B = s.B
  const n = v.items.length
  v.items.forEach((it, i) => {
    const a = v.spin + (i / n) * Math.PI * 2
    it.mesh.position.set((p.x + Math.cos(a) * v.r) * B, (p.y + RING_Y) * B, (p.z + Math.sin(a) * v.r) * B)
    it.mesh.rotation.y = it.id === 'sawblade' ? v.spin * 6 : -a
  })
}

export function disposeRemoteRing(s, p) {
  const v = p.ringView
  if (!v) return
  p.ringView = null
  s?.bm?.scene.remove(v.group)
  v.group.traverse((o) => {
    if (!o.isMesh) return
    o.geometry?.dispose?.()
    o.material?.dispose?.()
  })
}

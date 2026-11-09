// Prop Hunt (2026-11-09, Gaymi's idea list 9: "hiders turn into a block or
// a piece of furniture and try to blend in. Seekers have 3 minutes to find
// them" - servers + bots, like the other party modes). Plugs into
// PartyMode (PartyModes.js) as its `ext`.
//
// Played on the ground round where the round began. One Seeker (two from 6
// players). Everyone else is a Hider and turns into a prop (PROPS: a crate,
// hay bale, barrel, pumpkin, bush, stone, chair or table). DECOYS real props
// are scattered round the middle (DECOY_R) so there's something to blend in
// with - the same ones on every screen (seeded by the round and the spot).
// For HIDE_S the Seekers are blindfolded and can't move; then they have
// SEEK_S to find everyone. A Hider's shot (click / fire button) swaps their
// disguise to the next prop. A Seeker finds a Hider by touching them or by
// shooting them; shooting a decoy instead slows the Seeker down for
// MISS_SLOW_S. A found Hider turns back into themselves and joins the
// Seekers. Everyone found = the Seekers win; anyone still hidden when the
// clock runs out = the Hiders win. Seekers are PartyMode's `seekers`
// (synced as `sk`); the first ones are `first` (only they win as Seekers).
// Guests: `s` + who (a find) and `q` + prop number (a new disguise) go to
// the host as hits. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const HIDE_S = 30
export const SEEK_S = 180
export const DECOYS = 28
export const DECOY_R = 15
export const MISS_SLOW_S = 2
const TAG_DIST = 1.2
const BOT_LOOK_R = 14
const BOT_HIDER_CHANCE = 0.3 // how often a Seeker bot heads for a real Hider

// [name key, width, height, build(group, B)] - sizes in blocks.
const wood = 0x9a6b3a
const darkWood = 0x6e4a26
export const PROPS = [
  ['propCrate', 0.9, 0.9, (g, B) => {
    box(g, B, 0.9, 0.9, 0.9, 0, 0.45, 0, wood)
    for (const y of [0.08, 0.82]) box(g, B, 0.94, 0.12, 0.94, 0, y, 0, darkWood)
  }],
  ['propHay', 0.95, 0.8, (g, B) => {
    box(g, B, 0.95, 0.8, 0.95, 0, 0.4, 0, 0xd9b84a)
    for (const z of [-0.25, 0.25]) box(g, B, 0.97, 0.82, 0.06, 0, 0.4, z, 0xa8862a)
  }],
  ['propBarrel', 0.8, 1, (g, B) => {
    cyl(g, B, 0.4, 1, 0, 0.5, 0, darkWood)
    for (const y of [0.15, 0.85]) cyl(g, B, 0.42, 0.08, 0, y, 0, 0x55575c)
  }],
  ['propPumpkin', 0.85, 0.9, (g, B) => {
    box(g, B, 0.85, 0.75, 0.85, 0, 0.375, 0, 0xe07a1a)
    box(g, B, 0.12, 0.18, 0.12, 0, 0.84, 0, 0x3f7a2a)
  }],
  ['propBush', 0.95, 0.95, (g, B) => {
    box(g, B, 0.95, 0.8, 0.95, 0, 0.42, 0, 0x3f8f3a)
    box(g, B, 0.6, 0.25, 0.6, 0.1, 0.9, -0.05, 0x4fa548)
  }],
  ['propStone', 0.9, 0.7, (g, B) => {
    box(g, B, 0.9, 0.6, 0.85, 0, 0.3, 0, 0x8a8a8a)
    box(g, B, 0.55, 0.2, 0.5, -0.1, 0.68, 0.05, 0x9c9c9c)
  }],
  ['propChair', 0.7, 1.3, (g, B) => {
    box(g, B, 0.7, 0.1, 0.7, 0, 0.55, 0, wood)
    box(g, B, 0.7, 0.75, 0.1, 0, 0.95, -0.3, wood)
    for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) box(g, B, 0.1, 0.55, 0.1, x, 0.275, z, darkWood)
  }],
  ['propTable', 1, 0.85, (g, B) => {
    box(g, B, 1, 0.12, 1, 0, 0.8, 0, wood)
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) box(g, B, 0.12, 0.75, 0.12, x, 0.375, z, darkWood)
  }],
]

function box(g, B, w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
  m.position.set(x * B, y * B, z * B)
  g.add(m)
}

function cyl(g, B, r, h, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * B, r * B, h * B, 12), new THREE.MeshLambertMaterial({ color }))
  m.position.set(x * B, y * B, z * B)
  g.add(m)
}

export function propMesh(i, B) {
  const g = new THREE.Group()
  g.userData.prop = true
  PROPS[((i % PROPS.length) + PROPS.length) % PROPS.length][3](g, B)
  return g
}

function dispose(root) {
  root.removeFromParent()
  root.traverse((o) => {
    if (!o.isMesh) return
    o.geometry.dispose()
    o.material.dispose()
  })
}

// A tiny seeded random (the same decoys on every screen).
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), 1 | a)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export class PartyProps {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.props = new Map() // hider id -> prop number
    this.first = new Set() // who started as a Seeker
    this.decoys = [] // { x, y, z, p, mesh }
    this._decoysFor = ''
    this._worn = new Map() // id -> { group, prop, hid: [[child, wasVisible]] }
    this._mine = null // { p, until } my own new disguise, until the host's sync has it
    this._wasHider = false
    this._wasFound = false
  }

  get B() {
    return this.s.B
  }

  hideLeft() {
    const pm = this.pm
    return pm.phase === 'play' ? pm.left - SEEK_S : 0
  }

  hiding() {
    return this.hideLeft() > 0
  }

  // Seekers wait blindfolded while the Hiders hide (PartyMode shows it).
  blind() {
    const pm = this.pm
    return pm.seekers.has(pm.myId) && this.hiding() ? this.hideLeft() : 0
  }

  begin(people, shuffled) {
    const pm = this.pm
    this.props.clear()
    this.first.clear()
    pm.seekers.clear()
    for (const id of shuffled.slice(0, people.length >= 6 ? 2 : 1)) {
      pm.seekers.add(id)
      this.first.add(id)
    }
    for (const id of shuffled) if (!pm.seekers.has(id)) this.props.set(id, Math.floor(Math.random() * PROPS.length))
  }

  isHider(id) {
    return this.pm.phase === 'play' && this.props.has(id) && !this.pm.seekers.has(id)
  }

  propOf(id) {
    if (id === this.pm.myId && this._mine && performance.now() < this._mine.until) return this._mine.p
    return this.props.get(id) ?? 0
  }

  _find(id, by) {
    const pm = this.pm
    if (!this.isHider(id) || this.hiding()) return
    pm.seekers.add(id)
    pm._say = { k: 'propFound', name: id }
    void by
  }

  run(people) {
    const pm = this.pm
    if (pm.phase !== 'play') return
    for (const id of [...this.props.keys()]) if (!people.some((p) => p.id === id)) this.props.delete(id)
    if (!pm.seekers.size && people.length) {
      pm.seekers.add(people[0].id)
      this.first.add(people[0].id)
    }
    if (this.hiding()) return
    // Touches.
    for (const sk of people.filter((p) => pm.seekers.has(p.id))) {
      for (const h of people) {
        if (!this.isHider(h.id)) continue
        if (Math.hypot(sk.x - h.x, sk.z - h.z) < TAG_DIST && Math.abs(sk.y - h.y) < 1.6) this._find(h.id, sk.id)
      }
    }
    if (!people.some((p) => this.isHider(p.id))) pm._end('s')
  }

  timeUp() {
    this.pm._end('h')
  }

  won() {
    const pm = this.pm
    if (pm.winner === 's') return this.first.has(pm.myId)
    return pm.winner === 'h' && this.isHiderAtEnd(pm.myId)
  }

  isHiderAtEnd(id) {
    return this.props.has(id) && !this.pm.seekers.has(id)
  }

  winText(w) {
    return t(w === 's' ? 'propSeekersWin' : 'propHidersWin')
  }

  // Seekers wait, then don't move while blindfolded.
  speed() {
    const pm = this.pm
    if (pm.phase !== 'play') return 1
    return pm.seekers.has(pm.myId) && this.hiding() ? 0 : 1
  }

  markColor(id) {
    return this.pm.seekers.has(id) ? 0xa060ff : null
  }

  // My shot. A Hider: the next disguise. A Seeker: checks the first thing
  // on the ray - a Hider is found, a decoy slows me down.
  shoot(ray, reach, wall) {
    const pm = this.pm
    if (pm.phase !== 'play') return false
    const me = pm.myId
    if (this.isHider(me)) {
      const p = (this.propOf(me) + 1) % PROPS.length
      this._mine = { p, until: performance.now() + 1500 }
      if (pm.runs) this.props.set(me, p)
      else this.s.net?.queueHit(`q${p}`, 0)
      try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
      this.s._message(t('propYouAre', { prop: t(PROPS[p][0]) }), 1.5)
      return true
    }
    if (!pm.seekers.has(me) || this.hiding() || pm.stunned.has(me)) return false
    const B = this.B
    const bx = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = Math.min(reach, wall ? wall.t : Infinity)
    const test = (x, y, z, i, what) => {
      const [, w, h] = PROPS[i]
      bx.min.set((x - w / 2) * B, y * B, (z - w / 2) * B)
      bx.max.set((x + w / 2) * B, (y + h) * B, (z + w / 2) * B)
      if (!ray.intersectBox(bx, hit)) return
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = what
      }
    }
    for (const p of pm._people()) if (p.id !== me && this.isHider(p.id)) test(p.x, p.y, p.z, this.propOf(p.id), { id: p.id })
    for (const d of this.decoys) test(d.x, d.y, d.z, d.p, { decoy: true })
    if (!best) return false
    if (best.decoy) {
      pm.stunned.set(me, MISS_SLOW_S)
      this.s._message(t('propMiss'), 1.5)
      try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
      return true
    }
    if (pm.runs) this._find(best.id, me)
    else this.s.net?.queueHit(`s${best.id}`, 0)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    return true
  }

  // A guest's find (s + who) or new disguise (q + prop).
  remoteHit(h) {
    const id = String(h.id)
    const by = String(h.by || '')
    if (id[0] === 'q') {
      const p = Number(id.slice(1))
      if (Number.isInteger(p) && p >= 0 && p < PROPS.length && this.isHider(by)) this.props.set(by, p)
      return
    }
    if (id[0] === 's' && this.pm.seekers.has(by)) this._find(id.slice(1), by)
  }

  // Bots: Hiders sneak next to a decoy and keep still; Seekers wait, then
  // check one prop after another (sometimes a real Hider).
  botGoal(b, people) {
    const pm = this.pm
    if (this.isHider(b.id)) {
      if (!b.propSpot && this.decoys.length) {
        const d = this.decoys[Math.floor(Math.random() * this.decoys.length)]
        const a = Math.random() * Math.PI * 2
        b.propSpot = { x: d.x + Math.cos(a) * 1.3, z: d.z + Math.sin(a) * 1.3 }
      }
      const s = b.propSpot
      if (!s) return { x: b.x, z: b.z, stay: true }
      return Math.hypot(s.x - b.x, s.z - b.z) > 0.5 ? s : { x: b.x, z: b.z, stay: true }
    }
    b.propSpot = null
    if (!pm.seekers.has(b.id) || this.hiding()) return { x: b.x, z: b.z, stay: true }
    const at = b.propLook
    if (at?.id && !this.isHider(at.id)) b.propLook = null
    if (!b.propLook || Math.hypot(b.propLook.x - b.x, b.propLook.z - b.z) < 1) {
      const hiders = people.filter((p) => this.isHider(p.id) && Math.hypot(p.x - b.x, p.z - b.z) < BOT_LOOK_R)
      const near = this.decoys.filter((d) => Math.hypot(d.x - b.x, d.z - b.z) < BOT_LOOK_R)
      if (hiders.length && (Math.random() < BOT_HIDER_CHANCE || !near.length)) {
        const h = hiders[Math.floor(Math.random() * hiders.length)]
        b.propLook = { id: h.id, x: h.x, z: h.z }
      } else if (near.length) {
        const d = near[Math.floor(Math.random() * near.length)]
        b.propLook = { x: d.x, z: d.z }
      } else return null
    }
    if (b.propLook.id) {
      const h = people.find((p) => p.id === b.propLook.id)
      if (h) Object.assign(b.propLook, { x: h.x, z: h.z })
    }
    return b.propLook
  }

  // The decoys, the same on every screen.
  _decoys() {
    const pm = this.pm
    const key = pm.home && pm.phase !== 'wait' ? `${pm.round},${pm.home.x},${pm.home.z}` : ''
    if (key === this._decoysFor) return
    this._decoysFor = key
    for (const d of this.decoys) dispose(d.mesh)
    this.decoys = []
    if (!key) return
    const r = rng(pm.round * 7919 + Math.floor(pm.home.x) * 131 + Math.floor(pm.home.z))
    const B = this.B
    for (let i = 0; i < DECOYS; i++) {
      const a = r() * Math.PI * 2
      const dist = 3 + r() * (DECOY_R - 3)
      const x = Math.floor(pm.home.x + Math.cos(a) * dist) + 0.5
      const z = Math.floor(pm.home.z + Math.sin(a) * dist) + 0.5
      const p = Math.floor(r() * PROPS.length)
      const y = this.s._groundUnder(x, pm.home.y + 8, z)
      const mesh = propMesh(p, B)
      mesh.position.set(x * B, y * B, z * B)
      mesh.rotation.y = Math.floor(r() * 4) * (Math.PI / 2)
      pm.arena.add(mesh)
      this.decoys.push({ x, y, z, p, mesh })
    }
  }

  // Who's drawn where: bots and other players by their group; me by my
  // third-person body.
  _groups() {
    const pm = this.pm
    const out = new Map()
    for (const b of pm.bots.values()) out.set(b.id, b.group)
    for (const [pid, p] of this.s.net?.players || []) if (p.group) out.set(pid, p.group)
    const mine = this.s.bm.tryMode?._body?.group
    if (mine) out.set(pm.myId, mine)
    return out
  }

  // Hiders wear their prop: everything else on them (body, name, marks)
  // is hidden until they're found or the round ends.
  draw() {
    this._decoys()
    const B = this.B
    const groups = this._groups()
    const want = new Map()
    for (const [id, g] of groups) if (this.isHider(id)) want.set(id, { g, p: this.propOf(id) })
    for (const [id, w] of [...this._worn]) {
      const k = want.get(id)
      if (k && k.g === w.group && k.p === w.p) continue
      for (const [c, vis] of w.hid) c.visible = vis
      dispose(w.prop)
      this._worn.delete(id)
    }
    for (const [id, { g, p }] of want) {
      let w = this._worn.get(id)
      if (!w) {
        const prop = propMesh(p, B)
        const hid = g.children.map((c) => [c, c.visible])
        g.add(prop)
        w = { group: g, prop, p, hid }
        this._worn.set(id, w)
      }
      // (A body that finished loading after the prop went on hides too.)
      for (const c of g.children) if (c !== w.prop && !w.hid.some(([x]) => x === c)) w.hid.push([c, c.visible])
      for (const [c] of w.hid) c.visible = false
      // Props sit square to the world, whichever way their wearer faces.
      w.prop.rotation.y = -g.rotation.y + Math.round(g.rotation.y / (Math.PI / 2)) * (Math.PI / 2)
    }
  }

  events(was) {
    const pm = this.pm
    const me = pm.myId
    const hider = this.isHider(me)
    if (pm.phase === 'play' && this._wasHider && !hider && pm.seekers.has(me)) {
      this.s._message(t('propYouFound'), 3)
      try { audioEngine.playSpecial?.('warn') } catch { /* no audio */ }
    }
    if (pm.phase === 'play' && pm.seekers.has(me) && this._wasHiding && !this.hiding()) this.s._message(t('propSeekNow'), 3)
    this._wasHider = hider
    this._wasHiding = this.hiding()
    void was
  }

  startText() {
    const pm = this.pm
    if (pm.seekers.has(pm.myId)) return t('propYouSeek', { n: HIDE_S })
    return t('propYouHide', { prop: t(PROPS[this.propOf(pm.myId)][0]), n: HIDE_S })
  }

  hud() {
    const pm = this.pm
    const people = pm._people()
    const left = people.filter((p) => this.isHider(p.id)).length
    let mid = t('propHud', { n: left })
    if (pm.phase === 'play') {
      const me = pm.myId
      mid += ` · ${this.isHider(me) ? t(PROPS[this.propOf(me)][0]) : t('propSeekerTag')}`
      if (this.hiding()) mid += ` · ${t('propHideClock', { n: Math.ceil(this.hideLeft()) })}`
    }
    return mid
  }

  snap() {
    const pr = {}
    for (const [id, p] of this.props) pr[this.pm._out(id)] = p
    return { pr, f: [...this.first].map((id) => this.pm._out(id)) }
  }

  apply(d) {
    const ok = (id) => typeof id === 'string' && /^(?:b\d{1,4}|[A-Za-z0-9]{4,40}|me)$/.test(id)
    this.props = new Map(Object.entries(d.pr || {}).filter(([id, p]) => ok(id) && Number.isInteger(p) && p >= 0 && p < PROPS.length))
    this.first = new Set([].concat(d.f || []).filter(ok))
  }

  dispose() {
    for (const w of this._worn.values()) {
      for (const [c, vis] of w.hid) c.visible = vis
      dispose(w.prop)
    }
    this._worn.clear()
    for (const d of this.decoys) dispose(d.mesh)
    this.decoys = []
  }
}

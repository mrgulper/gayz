// Ghost teammates (2026-11-09, Gaymi's idea list 9: "in multiplayer, when
// you die you float around as a ghost instead of just watching. You can
// mark zombies or 'boo' one to slow it down so your friends can escape" -
// Gaymi picked "friends revive you").
//
// On a server with someone else still alive, dying makes you a ghost
// instead of showing the You Died card at once. A gravestone stays where
// you fell. As a ghost:
// - you float about (Jump rises, Crouch sinks, up to GHOST_HIGH over your
//   grave); zombies ignore you and you can't shoot, build or pick things up;
// - fire at a zombie (BOO_REACH) to Boo it: it's slowed for BOO_S and
//   marked with a red "!" everyone can see for MARK_S (BOO_CD between boos);
// - a living friend standing at your grave (REVIVE_R) for REVIVE_S brings
//   you back there with REVIVE_HP of your health. Walking off slowly
//   undoes it.
// - after GHOST_WAIT_S with nobody coming, the You Died card shows (its
//   Respawn button still works as before), and you stay a ghost behind it.
//
// Others see a little floating sheet ghost instead of your body, your
// gravestone and your marks: `gh` ({ g: grave [x, y, z], m: marked zombie
// ids }, api/_lib/servers.js). A guest's boo goes to the host as a zombie
// hit with `boo` (PlayNet.queueBoo). Meshes only, never a light. Owned by
// BuildSurvival (`s.ghosts`).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const BOO_S = 4
export const BOO_CD = 5
export const BOO_REACH = 14
export const MARK_S = 10
export const REVIVE_R = 2
export const REVIVE_S = 4
export const REVIVE_HP = 0.5
export const GHOST_WAIT_S = 45
const GHOST_HIGH = 20
const GHOST_RISE = 5
const MAX_MARKS = 4

export class Ghosts {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.grave = null // { x, y, z }
    this.marks = new Map() // zombie id -> seconds left (mine)
    this.revive = 0 // my revive progress (s)
    this.waited = 0
    this._cd = 0
    this._remote = new Map() // player id -> { ghost, grave }
    this._markMeshes = new Map() // zombie id -> mesh
    this._myGrave = null
    this._hud = null
    this._helpSaid = new Set()
  }

  get B() {
    return this.s.B
  }

  // BuildSurvival._die: become a ghost? Only on a server with someone
  // else alive to come and get you.
  start() {
    const s = this.s
    const net = s.net
    if (!net || net.closed || s.td || s.party) return false
    if (![...net.players.values()].some((p) => p.seen && !p.dead && !p.gh)) return false
    const p = s.bodyPos()
    this.on = true
    this.grave = { x: p.x, y: p.y, z: p.z }
    this.revive = 0
    this.waited = 0
    this._cd = 0
    this._myGrave = this._graveMesh()
    this._place(this._myGrave, this.grave)
    s.bm.scene.add(this._myGrave)
    this._showHud()
    s._message(t('ghostStart', { n: REVIVE_S }), 5)
    try { audioEngine.playSpecial?.('hum') } catch { /* no audio */ }
    return true
  }

  // Back to life (revived, or Respawn on the card).
  end() {
    if (!this.on) return
    this.on = false
    this.grave = null
    this.marks.clear()
    this._drop(this._myGrave)
    this._myGrave = null
    this._showHud()
  }

  // My shot while dead (BuildTryMode.fire): Boo the zombie I'm looking at.
  boo() {
    const s = this.s
    if (!this.on) return false
    if (this._cd > 0) {
      s._message(t('ghostBooWait', { n: Math.ceil(this._cd) }), 1.2)
      return false
    }
    const cam = s.bm.camera
    const B = this.B
    const o = cam.getWorldPosition(new THREE.Vector3()).divideScalar(B)
    const d = cam.getWorldDirection(new THREE.Vector3())
    let best = null
    let bestT = BOO_REACH
    for (const z of s.zombies || []) {
      if (z.dead) continue
      const cx = z.x - o.x
      const cy = z.y + MOB_HEIGHT * 0.55 * (z.size || 1) - o.y
      const cz = z.z - o.z
      const along = cx * d.x + cy * d.y + cz * d.z
      if (along <= 0 || along > bestT) continue
      const off = Math.hypot(cx - d.x * along, cy - d.y * along, cz - d.z * along)
      if (off > 0.9 * (z.size || 1)) continue
      bestT = along
      best = z
    }
    if (!best) return false
    this._cd = BOO_CD
    if (!s.net || s.net.isHost) this.scare(best)
    else s.net.queueBoo(`z${best.id}`)
    this.marks.set(best.id, MARK_S)
    while (this.marks.size > MAX_MARKS) this.marks.delete(this.marks.keys().next().value)
    s._message(t('ghostBoo'), 1.5)
    try { audioEngine.playSpecial?.('hiccup') } catch { /* no audio */ }
    return true
  }

  // The host: a boo slows this zombie down.
  scare(z) {
    z.slow = Math.max(z.slow || 0, BOO_S)
  }

  snapshot() {
    if (!this.on || !this.grave) return null
    const r = (n) => Math.round(n * 10) / 10
    return { g: [r(this.grave.x), r(this.grave.y), r(this.grave.z)], m: [...this.marks.keys()].slice(0, MAX_MARKS) }
  }

  update(dt) {
    const s = this.s
    this._cd = Math.max(0, this._cd - dt)
    for (const [id, left] of this.marks) {
      if (left - dt <= 0) this.marks.delete(id)
      else this.marks.set(id, left - dt)
    }
    if (this.on && !s.dead) this.end()
    if (this.on) this._ghostly(dt)
    this._drawRemote(dt)
    this._drawMarks()
    this._helpOthers()
  }

  // Floating about, my revive, and the card if nobody comes.
  _ghostly(dt) {
    const s = this.s
    const tm = s.bm.tryMode
    const rise = tm._spaceWasDown ? GHOST_RISE : tm._crouch ? -GHOST_RISE : 0
    tm.vel.y = rise
    if (tm.pos.y > this.grave.y + GHOST_HIGH) tm.vel.y = Math.min(0, tm.vel.y)
    // Someone alive at my grave?
    const g = this.grave
    let helper = null
    for (const p of s.net?.players?.values() || []) {
      if (!p.seen || p.dead || p.gh) continue
      if (Math.hypot(p.x - g.x, p.z - g.z) < REVIVE_R && Math.abs(p.y - g.y) < 2.5) helper = p
    }
    this.revive = helper ? this.revive + dt : Math.max(0, this.revive - dt * 0.5)
    if (this.revive >= REVIVE_S) return this._revived(helper)
    this.waited += dt
    if (this.waited >= GHOST_WAIT_S && !this._cardShown) {
      this._cardShown = true
      s._showOver?.()
    }
    this._renderHud(helper)
    if (this._myGrave) this._myGrave.rotation.y = 0
  }

  _revived(helper) {
    const s = this.s
    const g = this.grave
    s._respawn()
    const tm = s.bm.tryMode
    tm.pos.set(g.x, g.y, g.z)
    tm.vel.set(0, 0, 0)
    s.health = Math.max(1, Math.round(s.maxHealth * REVIVE_HP))
    s._renderHud()
    this.end()
    s._message(t('ghostRevived', { name: helper?.nick || 'Survivor' }), 3)
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
    try { s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
  }

  // Alive and standing at a friend's grave: tell me it's working.
  _helpOthers() {
    const s = this.s
    if (s.dead || !s.net) return
    const me = s.bodyPos()
    for (const [pid, p] of s.net.players) {
      const g = p.gh?.g
      if (!g) {
        this._helpSaid.delete(pid)
        continue
      }
      const near = Math.hypot(me.x - g[0], me.z - g[2]) < REVIVE_R && Math.abs(me.y - g[1]) < 2.5
      if (near && !this._helpSaid.has(pid)) {
        this._helpSaid.add(pid)
        s._message(t('ghostReviving', { name: p.nick || 'Survivor', n: REVIVE_S }), REVIVE_S)
      } else if (!near) this._helpSaid.delete(pid)
    }
  }

  // Other players' ghosts and graves.
  _drawRemote() {
    const s = this.s
    const B = this.B
    const seen = new Set()
    for (const [pid, p] of s.net?.players || []) {
      if (!p.gh || !p.seen) continue
      seen.add(pid)
      let r = this._remote.get(pid)
      if (!r) {
        r = { ghost: this._ghostMesh(), grave: this._graveMesh() }
        p.group.add(r.ghost)
        s.bm.scene.add(r.grave)
        this._remote.set(pid, r)
      }
      if (r.ghost.parent !== p.group) p.group.add(r.ghost)
      if (p.body) p.body.visible = false
      r.ghost.position.y = (0.3 + Math.sin(performance.now() / 400 + pid.length) * 0.15) * B
      this._place(r.grave, { x: p.gh.g[0], y: p.gh.g[1], z: p.gh.g[2] })
    }
    for (const [pid, r] of [...this._remote]) {
      if (seen.has(pid)) continue
      const p = s.net?.players?.get(pid)
      if (p?.body) p.body.visible = true
      this._drop(r.ghost)
      this._drop(r.grave)
      this._remote.delete(pid)
    }
  }

  // A red "!" over every zombie a ghost marked (mine and everyone's).
  _drawMarks() {
    const s = this.s
    const B = this.B
    const ids = new Set(this.marks.keys())
    for (const p of s.net?.players?.values() || []) for (const id of p.gh?.m || []) ids.add(id)
    const t0 = performance.now() / 1000
    for (const id of ids) {
      const z = (s.zombies || []).find((o) => o.id === id && !o.dead)
      if (!z) continue
      let m = this._markMeshes.get(id)
      if (!m) {
        m = this._markMesh()
        s.bm.scene.add(m)
        this._markMeshes.set(id, m)
      }
      m.position.set(z.x * B, (z.y + MOB_HEIGHT * (z.size || 1) + 0.6 + Math.sin(t0 * 4) * 0.08) * B, z.z * B)
      m.rotation.y = t0 * 2
    }
    for (const [id, m] of [...this._markMeshes]) {
      if (ids.has(id) && (s.zombies || []).some((o) => o.id === id && !o.dead)) continue
      this._drop(m)
      this._markMeshes.delete(id)
    }
  }

  _place(mesh, at) {
    const B = this.B
    mesh.position.set(at.x * B, at.y * B, at.z * B)
  }

  _ghostMesh() {
    const B = this.B
    const g = new THREE.Group()
    const sheet = new THREE.MeshLambertMaterial({ color: 0xeef4ff, emissive: 0x8fb4ff, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 1.2 * B, 0.8 * B), sheet)
    body.position.y = 0.9 * B
    g.add(body)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7 * B, 0.35 * B, 0.7 * B), sheet.clone())
    head.position.y = 1.65 * B
    g.add(head)
    // Wavy hem.
    for (const [x, z] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3 * B, 0.25 * B, 0.3 * B), sheet.clone())
      tail.position.set(x * B, 0.2 * B, z * B)
      g.add(tail)
    }
    const eye = new THREE.MeshBasicMaterial({ color: 0x1a1a2a })
    for (const x of [-0.15, 0.15]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, 0.18 * B, 0.02 * B), eye.clone())
      // The group faces away (PlayNet turns it by a half turn).
      e.position.set(x * B, 1.25 * B, -0.41 * B)
      g.add(e)
    }
    eye.dispose()
    return g
  }

  _graveMesh() {
    const B = this.B
    const g = new THREE.Group()
    const stone = new THREE.MeshLambertMaterial({ color: 0x8a8a92 })
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.7 * B, 0.9 * B, 0.18 * B), stone)
    slab.position.y = 0.45 * B
    g.add(slab)
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5 * B, 0.15 * B, 0.18 * B), stone.clone())
    top.position.y = 0.97 * B
    g.add(top)
    const cross = new THREE.MeshLambertMaterial({ color: 0x55555c })
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.08 * B, 0.4 * B, 0.02 * B), cross)
    v.position.set(0, 0.6 * B, 0.1 * B)
    g.add(v)
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.26 * B, 0.08 * B, 0.02 * B), cross.clone())
    h.position.set(0, 0.68 * B, 0.1 * B)
    g.add(h)
    // A soft ring on the ground: stand in it to revive.
    const ring = new THREE.Mesh(new THREE.RingGeometry((REVIVE_R - 0.15) * B, REVIVE_R * B, 32), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.04 * B
    g.add(ring)
    return g
  }

  _markMesh() {
    const B = this.B
    const g = new THREE.Group()
    const red = new THREE.MeshLambertMaterial({ color: 0xff3a2a, emissive: 0xff3a2a, emissiveIntensity: 0.6 })
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14 * B, 0.4 * B, 0.14 * B), red)
    bar.position.y = 0.3 * B
    g.add(bar)
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.14 * B, 0.14 * B, 0.14 * B), red.clone())
    g.add(dot)
    return g
  }

  _drop(root) {
    if (!root) return
    root.removeFromParent()
    root.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }

  // The ghost bar at the top of the screen.
  _showHud() {
    if (!this._hud) {
      const el = document.createElement('div')
      el.id = 'ghost-hud'
      el.innerHTML = '<p class="ghost-title"></p><p class="ghost-help"></p><div class="ghost-bar"><span></span></div>'
      document.body.appendChild(el)
      this._hud = el
    }
    this._hud.classList.toggle('on', this.on)
    document.body.classList.toggle('ghost-on', this.on)
    this._cardShown = false
  }

  _renderHud(helper) {
    const el = this._hud
    if (!el) return
    el.querySelector('.ghost-title').textContent = t('ghostTitle')
    el.querySelector('.ghost-help').textContent = helper ? t('ghostBeingRevived', { name: helper.nick || 'Survivor' }) : this._cd > 0 ? t('ghostBooWait', { n: Math.ceil(this._cd) }) : t('ghostHelp', { n: REVIVE_S })
    el.querySelector('.ghost-bar span').style.width = `${Math.min(100, (this.revive / REVIVE_S) * 100)}%`
  }

  clear() {
    this.end()
    for (const [pid, r] of this._remote) {
      const p = this.s.net?.players?.get(pid)
      if (p?.body) p.body.visible = true
      this._drop(r.ghost)
      this._drop(r.grave)
    }
    this._remote.clear()
    for (const m of this._markMeshes.values()) this._drop(m)
    this._markMeshes.clear()
    this._helpSaid.clear()
  }
}

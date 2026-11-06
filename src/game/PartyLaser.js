// Laser Tag (2026-11-02, Gaymi's idea list 6: "a dark arena with glowing
// vests, where a hit knocks you out for 3 seconds and the team with the
// most tags wins" - a party mode, servers + bots). Plugs into PartyMode
// (PartyModes.js) as its `ext`.
//
// Red against Blue in a dark, roofed arena high in the sky (LT_Y), lit only
// by glowing strips on the walls, with pillars and low walls for cover.
// Everyone wears a vest glowing in their team's colour. Your gun fires a
// laser: hit an enemy and they're knocked out for KO_S seconds (they can't
// move or shoot) and your team gets a tag. Bots tag too. The team with the
// most tags when the time runs out wins.
//
// The arena is real blocks (BuildSurvival `_placed`, gone when the game
// ends), put in on every screen. Meshes only, never a light.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const LT_Y = 190
export const KO_S = 3
export const LT_W = 32 // along x (the bases are at each end)
export const LT_D = 24
const H = 5
const TEAM_COLORS = { r: 0xe8443a, b: 0x3a7be8 }
// Cover inside the arena: [dx, dz, w, d, h] from the middle.
const COVER = [
  [-9, -6, 1, 1, 3], [-9, 6, 1, 1, 3], [9, -6, 1, 1, 3], [9, 6, 1, 1, 3],
  [-4, 0, 1, 5, 2], [4, 0, 1, 5, 2], [0, -8, 4, 1, 2], [0, 8, 4, 1, 2],
  [-13, -3, 1, 2, 2], [13, 3, 1, 2, 2], [0, 0, 2, 2, 3],
]

export class PartyLaser {
  constructor(pm) {
    this.pm = pm
    this.s = pm.s
    this.teams = true
    this.botsStun = true
    this.stunS = KO_S
    this._builtFor = ''
    this._vests = new Map()
    this._beams = []
  }

  get B() {
    return this.s.B
  }

  home(me) {
    return { x: Math.round(me.x), y: LT_Y + 1, z: Math.round(me.z) }
  }

  _x0() {
    return Math.floor(this.pm.home.x) - LT_W / 2
  }

  _z0() {
    return Math.floor(this.pm.home.z) - LT_D / 2
  }

  // A spot at a team's end of the arena.
  base(tm) {
    const h = this.pm.home
    return { x: h.x + (tm === 'r' ? -1 : 1) * (LT_W / 2 - 3), z: h.z + (Math.random() - 0.5) * (LT_D - 6) }
  }

  placeBot(b) {
    const at = this.base(this.pm.teams.get(b.id) || 'r')
    b.x = b.tx = at.x
    b.z = b.tz = at.z
    b.y = b.ty = LT_Y + 1
    b.vy = 0
  }

  run() {}

  // A bot: closes in on the nearest enemy that's still up, then circles.
  botGoal(b, people) {
    const pm = this.pm
    if (pm.stunned.has(b.id)) return { x: b.x, z: b.z, stay: true }
    const tm = pm.teams.get(b.id)
    let best = null
    let bestD = Infinity
    for (const p of people) {
      if (p.id === b.id || pm.teams.get(p.id) === tm || pm.stunned.has(p.id)) continue
      const d = Math.hypot(p.x - b.x, p.z - b.z)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (!best) return null
    if (bestD > 6) return best
    // Close enough: side-step round them.
    const a = Math.atan2(b.z - best.z, b.x - best.x) + 0.6
    return { x: best.x + Math.cos(a) * 5, z: best.z + Math.sin(a) * 5 }
  }

  // A tag: the tagger's team scores.
  onStun(id, by) {
    const pm = this.pm
    const tm = pm.teams.get(by)
    if (!tm || pm.teams.get(id) === tm || pm.phase !== 'play') return
    pm.score[tm] = (pm.score[tm] || 0) + 1
    pm._say = { k: 'laserTagged', name: id, team: tm }
  }

  speed() {
    return this.pm.stunned.has(this.pm.myId) ? 0 : 1
  }

  // My laser: the first enemy on the ray is knocked out.
  shoot(ray, reach, wall) {
    const pm = this.pm
    if (pm.phase !== 'play' || pm.stunned.has(pm.myId)) return false
    const B = this.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    const myTeam = pm.myTeam
    let best = null
    let bestD = Math.min(reach, wall ? wall.t : Infinity)
    for (const p of pm._people()) {
      if (p.id === pm.myId || (myTeam && pm.teams.get(p.id) === myTeam)) continue
      box.min.set((p.x - 0.4) * B, p.y * B, (p.z - 0.4) * B)
      box.max.set((p.x + 0.4) * B, (p.y + MOB_HEIGHT) * B, (p.z + 0.4) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    this._beam(ray, bestD, TEAM_COLORS[myTeam] || 0xffffff)
    try { audioEngine.playSpecial?.('zap') } catch { /* no audio */ }
    if (!best) return true
    if (pm.runs) pm.stun(best.id, pm.myId)
    else {
      this.s.net.queueHit(`s${best.id}`, 0)
      pm.stunned.set(best.id, KO_S)
    }
    return true
  }

  // A thin glowing line along my shot for a moment.
  _beam(ray, len, color) {
    const B = this.B
    const L = Math.min(len, 60 * B)
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04 * B, 0.04 * B, L), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }))
    const from = ray.origin.clone().addScaledVector(ray.direction, 0.6 * B).add(new THREE.Vector3(0, -0.15 * B, 0))
    m.position.copy(from).addScaledVector(ray.direction, L / 2)
    m.lookAt(from.clone().addScaledVector(ray.direction, L))
    this.pm.arena.add(m)
    this._beams.push({ mesh: m, left: 0.15 })
  }

  // The arena, put in once per spot; vests on everyone; beams fade.
  draw() {
    const pm = this.pm
    if (!pm.home) return
    const key = `${pm.home.x},${pm.home.z}`
    if (this._builtFor !== key) {
      this._builtFor = key
      this._blocks()
    }
    const dt = 1 / 60
    for (const b of this._beams) {
      b.left -= dt
      b.mesh.material.opacity = Math.max(0, b.left / 0.15)
    }
    for (const b of this._beams.filter((x) => x.left <= 0)) {
      b.mesh.removeFromParent()
      b.mesh.geometry.dispose()
      b.mesh.material.dispose()
    }
    this._beams = this._beams.filter((x) => x.left > 0)
    for (const b of pm.bots.values()) this._vest(b.id, b.group)
    for (const [pid, p] of this.s.net?.players || []) if (p.group) this._vest(pid, p.group)
  }

  _vest(id, group) {
    const tm = this.pm.teams.get(id)
    let v = this._vests.get(id)
    if (!v || v.parent !== group) {
      v?.removeFromParent()
      const B = this.B
      v = new THREE.Mesh(new THREE.BoxGeometry(0.62 * B, 0.55 * B, 0.4 * B), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }))
      v.position.y = MOB_HEIGHT * 0.62 * B
      group.add(v)
      this._vests.set(id, v)
    }
    v.visible = !!tm && this.pm.phase !== 'wait'
    if (!tm) return
    // Knocked out: the vest blinks.
    const ko = this.pm.stunned.has(id) && Math.floor(performance.now() / 150) % 2
    v.material.color.set(ko ? 0x222222 : TEAM_COLORS[tm])
  }

  _blocks() {
    const s = this.s
    const bm = s.bm
    const x0 = this._x0()
    const z0 = this._z0()
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z) === type) return
      if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
      bm.placeBlock(x, y, z, type, true)
      s._placed.set(bm._key(x, y, z), type)
    }
    bm._suppressUndoRecording = true
    for (let x = x0 - 1; x <= x0 + LT_W; x++) {
      for (let z = z0 - 1; z <= z0 + LT_D; z++) {
        const edge = x === x0 - 1 || x === x0 + LT_W || z === z0 - 1 || z === z0 + LT_D
        put(x, LT_Y, z, (x + z) % 2 ? 'blackconcrete' : 'polishedblackstone')
        put(x, LT_Y + H + 1, z, 'blackconcrete')
        if (!edge) continue
        for (let y = LT_Y + 1; y <= LT_Y + H; y++) put(x, y, z, y === LT_Y + 3 && (x + z) % 3 === 0 ? 'sealantern' : 'blackconcrete')
      }
    }
    // The team ends: a coloured strip on the floor.
    for (let z = z0; z < z0 + LT_D; z++) {
      put(x0, LT_Y, z, 'redconcrete')
      put(x0 + LT_W - 1, LT_Y, z, 'blueconcrete')
    }
    const hx = Math.floor(this.pm.home.x)
    const hz = Math.floor(this.pm.home.z)
    for (const [dx, dz, w, d, h] of COVER) {
      for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) for (let y = 1; y <= h; y++) put(hx + dx + x, LT_Y + y, hz + dz + z - Math.floor(d / 2), y === h ? 'glowstone' : 'blackconcrete')
    }
    bm._suppressUndoRecording = false
  }

  events(was) {
    const pm = this.pm
    if (pm.phase === 'play' && (was.phase !== 'play' || was.round !== pm.round)) {
      const at = this.base(pm.myTeam || 'r')
      const s = this.s
      const tm = s.bm.tryMode
      tm.pos.set(at.x, LT_Y + 1, at.z)
      tm.vel?.set(0, 0, 0)
      s.bm.camera.position.set(at.x * this.B, (LT_Y + 1 + 1.62) * this.B, at.z * this.B)
      s.bm._yaw = pm.myTeam === 'b' ? Math.PI / 2 : -Math.PI / 2
    }
    if (pm.phase === 'play' && pm.stunned.has(pm.myId) && !this._ko) this.s._message(t('laserYouKo', { n: KO_S }), 2)
    this._ko = pm.stunned.has(pm.myId)
  }

  startText() {
    const tm = this.pm.myTeam
    return t('laserStart', { team: t(tm === 'b' ? 'partyBlue' : 'partyRed'), n: KO_S })
  }

  hud() {
    const pm = this.pm
    let mid = `${t('partyRed')} ${pm.score.r || 0} - ${pm.score.b || 0} ${t('partyBlue')}`
    if (pm.myTeam) mid += ` · ${t('partyYourTeam', { team: t(pm.myTeam === 'r' ? 'partyRed' : 'partyBlue') })}`
    if (pm.stunned.has(pm.myId)) mid += ` · ${t('laserKoTag')}`
    return mid
  }

  protects(x, y, z) {
    const pm = this.pm
    if (!pm.home || y < LT_Y - 1 || y > LT_Y + H + 2) return false
    return x >= this._x0() - 2 && x <= this._x0() + LT_W + 1 && z >= this._z0() - 2 && z <= this._z0() + LT_D + 1
  }

  dispose() {
    for (const v of this._vests.values()) {
      v.removeFromParent()
      v.geometry.dispose()
      v.material.dispose()
    }
    this._vests.clear()
    this._beams = []
  }
}

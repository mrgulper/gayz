// Tower Defense mode (2026-11-02, Gaymi's idea list 4: "Zombies walk along
// a set path and you stop them with the Auto Turrets, Cannons and
// Catapults the game already has" - Gaymi picked "own map, solo +
// servers"). Owned by BuildSurvival (`s.td`) when cfg.mode is
// 'towerDefense' (server mode 'td').
//
// The map: a grass field (ARENA x ARENA) high up at TD_Y, the same spot
// for everyone (so a server's players all build the same one themselves),
// put in when the game starts and gone again when it ends (BuildSurvival
// `_placed`). A 3-wide dirt path winds across it in five rows (PATH),
// from a purple portal to your red base; low stone walls go round it.
//
// The waves come out of the portal and walk the path (not after you - they
// never bite, and the sun doesn't burn them). One reaching the base costs a life (a boss LEAK_BOSS); no
// lives left = the base falls (alone: game over; on a server everyone
// starts over from wave 1). Hold TD_WAVES waves to win.
//
// You buy towers in the Shop's Towers tab (PlayShop SHOP_TOWERS) and put
// them anywhere off the path (it, and the map itself, can't be built on or
// broken). Auto Turrets never run out here, and Cannons and Catapults fire
// on their own every `cd` seconds at the zombie furthest along within
// range. You can shoot too. Coins: START_COINS, plus kills and waves.
// The breaks between waves are longer (FIRST_BREAK, BREAK) to build.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'

export const TD_Y = 200
export const ARENA = 33
export const TD_WAVES = 15
export const LIVES = 20
export const LEAK_BOSS = 5
export const START_COINS = 200
export const FIRST_BREAK = 25
export const BREAK = 15
const HALF = (ARENA - 1) / 2
// The path's corners (blocks from the middle): five rows across.
export const PATH = [[-HALF, -14], [14, -14], [14, -7], [-14, -7], [-14, 0], [14, 0], [14, 7], [-14, 7], [-14, 14], [HALF, 14]]
const WAYPOINT_R = 0.6
const FALL_Y = TD_Y - 6
const SPAWN = [0, 3]
const BEAM_H = 24

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })

export class TowerDefense {
  constructor(survival) {
    this.s = survival
    this.lives = LIVES
    this.over = false
    this._cool = new Map() // cannon / catapult key -> seconds left
    this._group = new THREE.Group()
    survival.bm.scene.add(this._group)
    this.ox = 0
    this.oz = 0
    this._cells = this._pathCells()
    this._arena = new Set()
    this._build()
    this._markers()
    this.placePlayer()
  }

  get runs() {
    const n = this.s.net
    return !n || n.isHost
  }

  // The path's cells ("x,z", in blocks from the middle), 3 wide.
  _pathCells() {
    const out = new Set()
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, az] = PATH[i]
      const [bx, bz] = PATH[i + 1]
      const n = Math.max(Math.abs(bx - ax), Math.abs(bz - az))
      for (let k = 0; k <= n; k++) {
        const x = Math.round(ax + ((bx - ax) * k) / n)
        const z = Math.round(az + ((bz - az) * k) / n)
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(x + dx) <= HALF && Math.abs(z + dz) <= HALF) out.add(`${x + dx},${z + dz}`)
        }
      }
    }
    return out
  }

  onPath(x, z) {
    return this._cells.has(`${x - this.ox},${z - this.oz}`)
  }

  // The field, the path and the walls, as real blocks (gone at the end).
  _build() {
    const bm = this.s.bm
    const put = (x, y, z, type) => {
      const key = bm._key(x, y, z)
      this._arena.add(key)
      if (bm.getBlockAt(x, y, z) === type) return
      bm.placeBlock(x, y, z, type, true)
      this.s._placed.set(key, type)
    }
    bm._suppressUndoRecording = true
    const W = HALF + 1
    for (let x = -W; x <= W; x++) {
      for (let z = -W; z <= W; z++) {
        const wx = this.ox + x
        const wz = this.oz + z
        put(wx, TD_Y - 1, wz, 'dirt')
        const edge = Math.abs(x) === W || Math.abs(z) === W
        put(wx, TD_Y, wz, edge ? 'stonebricks' : this._cells.has(`${x},${z}`) ? 'dirtpath' : 'grass')
        if (edge) {
          put(wx, TD_Y + 1, wz, 'stonebricks')
          put(wx, TD_Y + 2, wz, 'stonebricks')
        }
      }
    }
    bm._suppressUndoRecording = false
  }

  // The portal (purple) and the base (red): beams and posts, meshes only.
  _markers() {
    const B = this.s.B
    const mark = ([x, z], color) => {
      const g = new THREE.Group()
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.6 * B, BEAM_H * B, 2.6 * B), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }))
      beam.position.y = (BEAM_H / 2) * B
      g.add(beam)
      for (const dz of [-1.6, 1.6]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.4 * B, 3.2 * B, 0.4 * B), lambert(color, { emissive: color, emissiveIntensity: 0.3 }))
        post.position.set(0, 1.6 * B, dz * B)
        g.add(post)
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.4 * B, 0.4 * B, 3.6 * B), lambert(color, { emissive: color, emissiveIntensity: 0.3 }))
      top.position.y = 3.2 * B
      g.add(top)
      g.position.set((this.ox + x + 0.5) * B, (TD_Y + 1) * B, (this.oz + z + 0.5) * B)
      this._group.add(g)
    }
    mark(PATH[0], 0xa040ff)
    mark(PATH[PATH.length - 1], 0xff4040)
  }

  // You start on the grass between two rows of the path.
  placePlayer() {
    const bm = this.s.bm
    const [x, z] = SPAWN
    bm.camera.position.set((this.ox + x + 0.5) * this.s.B, (TD_Y + 1 + 1.62) * this.s.B, (this.oz + z + 0.5) * this.s.B)
    bm._yaw = Math.PI
    bm._pitch = -0.2
    if (bm.tryMode.active) {
      bm.tryMode.pos.set(this.ox + x + 0.5, TD_Y + 1, this.oz + z + 0.5)
      if (bm.tryMode.vel) bm.tryMode.vel.set(0, 0, 0)
    }
  }

  // Blocks that are the map's own: never broken, never built on (the path
  // and the air over it either).
  protects(x, y, z) {
    if (this._arena.has(this.s.bm._key(x, y, z))) return true
    return y > TD_Y && y <= TD_Y + 3 && this.onPath(x, z)
  }

  // Where zombies come from (BuildSurvival._spawnSpots).
  spawnSpots() {
    const [x, z] = PATH[0]
    return [[this.ox + x, TD_Y + 1, this.oz + z]]
  }

  // Where a zombie walks: the next corner of the path. Reaching the base
  // costs a life.
  target(zb) {
    if (zb.tdAt === undefined) {
      zb.tdAt = 1
      // Out in the open all the way: the sun would burn every wave down.
      zb.noSun = true
    }
    let [x, z] = PATH[zb.tdAt]
    let wx = this.ox + x + 0.5
    let wz = this.oz + z + 0.5
    if (Math.hypot(zb.x - wx, zb.z - wz) < WAYPOINT_R) {
      zb.tdAt++
      if (zb.tdAt >= PATH.length) {
        this._leak(zb)
        return { x: zb.x, y: zb.y, z: zb.z, idle: true, lure: true }
      }
      ;[x, z] = PATH[zb.tdAt]
      wx = this.ox + x + 0.5
      wz = this.oz + z + 0.5
    }
    return { x: wx, y: TD_Y + 1, z: wz, idle: true, lure: true }
  }

  // How far along the path it is (for aiming).
  _progress(zb) {
    const i = zb.tdAt ?? 1
    const [x, z] = PATH[Math.min(i, PATH.length - 1)]
    return i * 1000 - Math.hypot(zb.x - (this.ox + x + 0.5), zb.z - (this.oz + z + 0.5))
  }

  _leak(zb) {
    if (zb.lost || zb.health <= 0) return
    zb.lost = true
    zb.health = 0
    if (!this.runs || this.over) return
    // It still counts toward the wave being over (a lost zombie isn't a kill).
    if (this.s._toSpawn > 0 && !zb.extra) this.s._toSpawn--
    this.lives = Math.max(0, this.lives - (zb.boss ? LEAK_BOSS : 1))
    try { audioEngine.playPlayerHurt?.() } catch { /* no audio */ }
    this.s._message(t('tdLeak', { n: this.lives }), 2)
    if (this.lives <= 0) this._fall()
    this.s._renderHud()
  }

  // No lives left.
  _fall() {
    const s = this.s
    if (s.net) {
      // A server goes on: everyone starts over from the first wave.
      s._message(t('tdFallServer'), 6)
      for (const zb of s.zombies) {
        zb.lost = true
        zb.health = 0
      }
      this.lives = LIVES
      s.wave = 0
      s._toSpawn = 0
      s._breakTimer = FIRST_BREAK
      return
    }
    this.over = true
    s._die(false)
  }

  // Every frame (everyone): the towers, and no falling off the map.
  update(dt) {
    const s = this.s
    const p = s.bm.tryMode.pos
    if (s.bm.tryMode.active && p.y < FALL_Y && !s.spectating) this.placePlayer()
    if (!this.runs) return
    const specials = s.bm.specials
    // Auto Turrets never run dry here.
    for (const e of specials.kind('turret')) {
      const st = specials._state(e)
      if ((st.ammo ?? 0) < 20) st.ammo = 20
    }
    // Cannons and Catapults fire by themselves.
    for (const kind of ['cannon', 'catapult']) {
      for (const e of specials.kind(kind)) {
        const left = (this._cool.get(e.key) ?? 0) - dt
        this._cool.set(e.key, left)
        if (left > 0) continue
        if (this._fire(e)) this._cool.set(e.key, e.def.fx.cd)
      }
    }
  }

  // One shot from a cannon or catapult at the zombie furthest along within
  // its range. -> false if there was nothing to shoot.
  _fire(e) {
    const s = this.s
    const fx = e.def.fx
    const cx = e.x + 0.5
    const cz = e.z + 0.5
    let best = null
    let bestP = -Infinity
    for (const zb of s.zombies) {
      if (zb.health <= 0 || Math.abs(zb.y - e.y) > 4) continue
      const d = Math.hypot(zb.x - cx, zb.z - cz)
      if (d > fx.range || d < 1) continue
      const pr = this._progress(zb)
      if (pr > bestP) {
        bestP = pr
        best = zb
      }
    }
    if (!best) return false
    const B = s.B
    const dx = (best.x - cx) / (Math.hypot(best.x - cx, best.z - cz) || 1)
    const dz = (best.z - cz) / (Math.hypot(best.x - cx, best.z - cz) || 1)
    if (fx.kind === 'cannon') {
      // Everything along the shot's line.
      for (const zb of s.zombies) {
        const rx = zb.x - cx
        const rz = zb.z - cz
        const along = rx * dx + rz * dz
        if (along < 0 || along > fx.range || Math.abs(rx * dz - rz * dx) > fx.width || Math.abs(zb.y - e.y) > 3) continue
        zb.health -= fx.dmg
        zb.flash = 0.12
      }
      s._fx?.explode(new THREE.Vector3(best.x * B, (best.y + 1) * B, best.z * B), 1.2)
    } else {
      // A boulder on the zombie it aimed at.
      for (const zb of s.zombies) {
        if (Math.hypot(zb.x - best.x, zb.z - best.z) > fx.blast || Math.abs(zb.y - best.y) > 4) continue
        zb.health -= fx.dmg
        zb.flash = 0.12
      }
      s._fx?.explode(new THREE.Vector3(best.x * B, best.y * B, best.z * B), fx.blast)
    }
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    return true
  }

  hudText() {
    return t('tdLives', { n: this.lives, max: LIVES })
  }

  // The host's state, for the others on a server (PlayNet, `td` in
  // api/_lib/servers.js).
  snapshot() {
    return { l: this.lives }
  }

  applySnapshot(d) {
    if (!d || this.runs) return
    const l = Math.round(Number(d.l))
    if (Number.isFinite(l) && l !== this.lives) {
      if (l < this.lives) this.s._message(t('tdLeak', { n: l }), 2)
      this.lives = Math.max(0, Math.min(LIVES, l))
      this.s._renderHud()
    }
  }

  dispose() {
    this._group.removeFromParent()
    this._group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    this._cool.clear()
  }
}

// The Training Ground (2026-11-23, Gaymi picked it from the tutorial
// ideas: "a small, safe practice map with stops along a path"). Owned by
// BuildSurvival (`s.training`) when cfg.mode is 'training' - started from
// the How to Play panel or the first-visit "New here?" popup
// (TrainingEntry.js), never from the Game Mode panel and never on a server.
//
// Four rooms in a row high in the sky (TRAIN_Y), put in when the game
// starts and gone when it ends (BuildSurvival `_placed`), like Escape
// Rooms. One tip at a time at the top (like RingTutorial); each step waits
// until you've actually done it, then ticks green. A room's far wall opens
// when its steps are done.
//
//   Room 1 (moving):   look -> walk (to the green beam) -> jump (the low wall)
//   Room 2 (shooting): shoot (3 frozen target zombies) -> reload
//   Room 3 (building): break (3 dirt blocks) -> place (3 blocks)
//   Room 4 (fight):    fight (3 slow zombies) -> done
//
// Totally safe (Gaymi's pick): nothing hurts you (BuildSurvival._hurtPlayer)
// and falling off puts you back in the room you're in. Finishing gives
// TRAIN_COINS coins the first time only (so it can't be farmed) and the
// Trained achievement (ProgressUI). "Skip step" ticks the step you're on,
// so nobody gets stuck.
//
// Meshes only, never a light. The map's blocks can't be broken or built
// on (protects), except the dirt pile in room 3.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { zombieHealth } from './BuildSurvival.js'
import { getKeyFor, keyLabel } from './Keybinds.js'

export const TRAIN_Y = 240
export const STEPS = ['look', 'walk', 'jump', 'shoot', 'reload', 'break', 'place', 'fight', 'done']
// The step that ends each room (its far wall opens after it).
const ROOM_END = { jump: 0, reload: 1, place: 2 }
export const TRAIN_COINS = 100
export const TARGETS = 3
export const DIRT = 3
export const PLACE = 3
export const FIGHTERS = 3
// How far you turn (radians) for the look step.
const LOOK_TURN = 1.2
// Fighters walk this fast (x a normal zombie).
const FIGHTER_SPEED = 0.5
const DONE_KEY = 'gayz-training-done'
const W = 10 // a room's step along x (9 inside + a wall)
const HALF = 4 // inside: z from -4 to 4
const WALL_H = 3
const GAP_S = 0.9
const DONE_S = 3

export function trainingDone() {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}

function markDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* storage blocked: the coins may come again */ }
}

export class TrainingGround {
  constructor(survival) {
    this.s = survival
    this.step = 0
    this.room = 0
    this.done = false
    this._gap = 0
    this._left = 0
    this._turned = 0
    this._lastYaw = null
    this._count = 0
    this._targets = []
    this._fighters = []
    this._map = new Set()
    this._dirt = new Set()
    this._gates = []
    this._group = new THREE.Group()
    survival.bm.scene.add(this._group)
    this._build()
    this.placePlayer()
    this._render()
  }

  get name() {
    return STEPS[this.step]
  }

  _roomX(i) {
    return i * W
  }

  // A block of the map (kept safe unless `breakable`).
  _put(x, y, z, type, breakable = false) {
    const s = this.s
    const bm = s.bm
    const key = bm._key(x, y, z)
    if (breakable) this._dirt.add(key)
    else this._map.add(key)
    if (bm.getBlockAt(x, y, z) === type) return
    if (bm.getBlockAt(x, y, z)) bm.removeBlock(x, y, z)
    bm.placeBlock(x, y, z, type, true)
    s._placed.set(key, type)
  }

  _build() {
    const bm = this.s.bm
    const Y = TRAIN_Y
    bm._suppressUndoRecording = true
    const x1 = this._roomX(4)
    for (let x = 0; x <= x1; x++) {
      for (let z = -HALF - 1; z <= HALF + 1; z++) {
        this._put(x, Y, z, x < W ? 'grass' : x < 2 * W ? 'oakplanks' : x < 3 * W ? 'grass' : 'stonebricks')
        const wallX = x % W === 0
        const wallZ = Math.abs(z) === HALF + 1
        if (!wallX && !wallZ) continue
        // Side walls are glass, so the sky stays in view.
        for (let y = Y + 1; y <= Y + WALL_H; y++) this._put(x, y, z, wallX ? 'stonebricks' : 'glass')
      }
    }
    // The gate in each of the first three rooms' far walls: 3 wide x 2 high.
    for (let i = 0; i < 3; i++) {
      const x = this._roomX(i + 1)
      const cells = []
      for (let z = -1; z <= 1; z++) for (let y = Y + 1; y <= Y + 2; y++) {
        this._put(x, y, z, 'reinforceddeepslate')
        cells.push([x, y, z])
      }
      this._gates.push(cells)
    }
    // Room 1: the low wall to jump (one block, wall to wall).
    this._jumpX = this._roomX(0) + 7
    for (let z = -HALF; z <= HALF; z++) this._put(this._jumpX, Y + 1, z, 'haybale')
    this._walkTo = [this._roomX(0) + 5, 0]
    // Room 2: a low fence the targets stand behind.
    for (let z = -HALF; z <= HALF; z++) this._put(this._roomX(1) + 6, Y + 1, z, 'stonebricks')
    // Room 3: the dirt pile (the only blocks you can break).
    const r2 = this._roomX(2)
    for (let i = 0; i < DIRT + 1; i++) this._put(r2 + 5, Y + 1, -1 + i, 'dirt', true)
    bm._suppressUndoRecording = false
    // A green beam: where to walk to.
    const B = this.s.B
    this._beam = new THREE.Mesh(new THREE.BoxGeometry(1.4 * B, 12 * B, 1.4 * B), new THREE.MeshBasicMaterial({ color: 0x4aff7a, transparent: true, opacity: 0.22, depthWrite: false }))
    this._beam.position.set((this._walkTo[0] + 0.5) * B, (Y + 6) * B, (this._walkTo[1] + 0.5) * B)
    this._group.add(this._beam)
  }

  // Where you start (and come back after falling): the room you're in.
  placePlayer() {
    const bm = this.s.bm
    const B = this.s.B
    const x = this._roomX(this.room) + 2.5
    const z = 0.5
    bm.camera.position.set(x * B, (TRAIN_Y + 1 + 1.62) * B, z * B)
    // Facing +x (down the row of rooms).
    bm._yaw = -Math.PI / 2
    bm._pitch = 0
    if (bm.tryMode.active) {
      bm.tryMode.pos.set(x, TRAIN_Y + 1, z)
      bm.tryMode.vel?.set(0, 0, 0)
    }
  }

  protects(x, y, z) {
    return this._map.has(this.s.bm._key(x, y, z))
  }

  // A block placed (id) or broken ('') this game (BuildSurvival._recordEdit).
  onEdit(x, y, z, id) {
    if (this.done || this._gap > 0) return
    const key = this.s.bm._key(x, y, z)
    if (this.name === 'break' && !id && this._dirt.has(key)) {
      this._dirt.delete(key)
      this._bump(DIRT)
    } else if (this.name === 'place' && id) this._bump(PLACE)
  }

  _bump(need) {
    this._count++
    this._render()
    if (this._count >= need) this._next()
  }

  _next() {
    this._gap = GAP_S
    this._el?.classList.add('ring-tut-ticked')
    try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
  }

  // Skip step: ticks the one you're on.
  skip() {
    if (this.done || this._gap > 0) return
    this._next()
  }

  // Each frame from BuildSurvival.update.
  update(dt) {
    const s = this.s
    if (!s.active || this.done) return
    const shown = !s.dead && !s.bm.menuOpen && !s._picking
    if (this._el) this._el.style.display = shown ? 'flex' : 'none'
    const p = s.bodyPos()
    // Fell off: back in the room.
    if (p.y < TRAIN_Y - 6) this.placePlayer()
    if (this._gap > 0) {
      this._gap -= dt
      if (this._gap <= 0) this._advance()
      return
    }
    switch (this.name) {
      case 'look': {
        const yaw = s.bm._yaw
        if (this._lastYaw !== null) {
          let d = yaw - this._lastYaw
          d = Math.atan2(Math.sin(d), Math.cos(d))
          this._turned += Math.abs(d)
        }
        this._lastYaw = yaw
        if (this._turned >= LOOK_TURN) this._next()
        break
      }
      case 'walk':
        if (Math.hypot(p.x - (this._walkTo[0] + 0.5), p.z - (this._walkTo[1] + 0.5)) < 1.6) this._next()
        break
      case 'jump':
        if (p.x > this._jumpX + 1.2 && p.x < this._roomX(1)) this._next()
        break
      case 'shoot':
        if (!this._targets.length) this._spawnTargets()
        if (this._targets.every((zb) => this._gone(zb))) this._next()
        break
      case 'reload':
        // Guns that never run out (and knives) have nothing to reload.
        if (!Number.isFinite(s.mag) || s.reserve <= 0) this._next()
        else if (s._reloadLeft > 0) this._next()
        break
      case 'fight':
        if (!this._fighters.length) this._spawnFighters()
        if (this._fighters.every((zb) => this._gone(zb))) this._next()
        break
      case 'done':
        this._left -= dt
        if (this._left <= 0) this._finish()
        break
    }
  }

  _advance() {
    const s = this.s
    const was = this.name
    // Skipped while zombies still stood: they go.
    if (was === 'shoot') this._clear(this._targets)
    if (was === 'fight') this._clear(this._fighters)
    if (ROOM_END[was] !== undefined) this._openGate(ROOM_END[was])
    this.step++
    this._count = 0
    if (this.name === 'walk') this._beam.visible = true
    else this._beam.visible = false
    if (this.name === 'reload' && Number.isFinite(s.mag) && s.mag >= s.magSize?.()) {
      // A full gun can't reload: leave one bullet in it.
      s.mag = Math.min(s.mag, 1)
      s._renderHud?.()
    }
    if (this.name === 'done') this._left = DONE_S
    this._render()
  }

  // Gone for good: killed (or never made).
  _gone(zb) {
    return !(zb.health > 0) || !this.s.zombies.includes(zb)
  }

  _clear(list) {
    const s = this.s
    for (const zb of list) {
      if (!s.zombies.includes(zb)) continue
      s._removeZombie(zb)
      s.zombies = s.zombies.filter((o) => o !== zb)
    }
  }

  _openGate(i) {
    const s = this.s
    const bm = s.bm
    this.room = i + 1
    bm._suppressUndoRecording = true
    for (const [x, y, z] of this._gates[i]) {
      const key = bm._key(x, y, z)
      bm.removeBlock(x, y, z)
      s._placed.delete(key)
      this._map.delete(key)
    }
    bm._suppressUndoRecording = false
    try { audioEngine.playSpecial?.('crumble') } catch { /* no audio */ }
  }

  _zombie(x, z) {
    const s = this.s
    const zb = s._makeZombie(++s._zid, x, TRAIN_Y + 1, z, zombieHealth(1), false)
    zb.extra = true
    zb.noSun = true
    return zb
  }

  // Three target zombies behind room 2's fence that never move.
  _spawnTargets() {
    const x = this._roomX(1) + 8.5
    for (let i = 0; i < TARGETS; i++) {
      const zb = this._zombie(x, -2.5 + i * 2.5)
      if (!zb) continue
      zb.frozen = 1e9
      this._targets.push(zb)
    }
  }

  // Three slow zombies at the far end of room 4.
  _spawnFighters() {
    const x = this._roomX(3) + 8.5
    for (let i = 0; i < FIGHTERS; i++) {
      const zb = this._zombie(x, -2.5 + i * 2.5)
      if (!zb) continue
      zb.speedMult = (zb.speedMult || 1) * FIGHTER_SPEED
      this._fighters.push(zb)
    }
  }

  _finish() {
    if (this.done) return
    this.done = true
    const s = this.s
    const first = !trainingDone()
    markDone()
    if (first) s._earn(TRAIN_COINS)
    this.firstFinish = first
    this._el?.remove()
    this._el = null
    try { audioEngine.playSpecial?.('firework') } catch { /* no audio */ }
    s._win()
  }

  _text() {
    const touch = this.s.bm.touch?.enabled
    const key = (id) => keyLabel(getKeyFor(id))
    const k = {
      look: touch ? 'trainLookTouch' : 'trainLook',
      walk: touch ? 'trainWalkTouch' : 'trainWalk',
      jump: touch ? 'trainJumpTouch' : 'trainJump',
      shoot: touch ? 'trainShootTouch' : 'trainShoot',
      reload: touch ? 'trainReloadTouch' : 'trainReload',
      break: touch ? 'trainBreakTouch' : 'trainBreak',
      place: touch ? 'trainPlaceTouch' : 'trainPlace',
      fight: 'trainFight',
      done: 'trainDone',
    }[this.name]
    const need = { shoot: TARGETS, break: DIRT, place: PLACE, fight: FIGHTERS }[this.name]
    const text = t(k, { jump: key('jump'), reload: key('reload'), n: TRAIN_COINS })
    return need ? `${text} (${this._progress()}/${need})` : text
  }

  _progress() {
    if (this.name === 'shoot') return this._targets.filter((zb) => this._gone(zb)).length
    if (this.name === 'fight') return this._fighters.filter((zb) => this._gone(zb)).length
    return this._count
  }

  _render() {
    let el = this._el
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-training-tip'
      el.setAttribute('role', 'status')
      el.innerHTML = '<span class="ring-tut-step"></span><span class="ring-tut-text"></span><button type="button" class="ring-tut-skip"></button>'
      const btn = el.querySelector('.ring-tut-skip')
      btn.onclick = (e) => {
        e.stopPropagation()
        this.skip()
      }
      btn.onpointerdown = (e) => e.stopPropagation()
      btn.ontouchstart = (e) => e.stopPropagation()
      document.body.appendChild(el)
      this._el = el
    }
    el.classList.remove('ring-tut-ticked')
    const last = this.name === 'done'
    el.querySelector('.ring-tut-step').textContent = last ? '' : `${this.step + 1}/${STEPS.length - 1}`
    el.querySelector('.ring-tut-text').textContent = this._text()
    const btn = el.querySelector('.ring-tut-skip')
    btn.textContent = t('trainSkip')
    btn.style.display = last ? 'none' : ''
  }

  // The shoot and fight counters go up as zombies fall.
  onKill() {
    if (this.name === 'shoot' || this.name === 'fight') this._render()
  }

  hudText() {
    return t('trainHud', { n: Math.min(this.step + 1, STEPS.length - 1), max: STEPS.length - 1 })
  }

  dispose() {
    this._el?.remove()
    this._el = null
    this._group.removeFromParent()
    this._group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }
}

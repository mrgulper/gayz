// Couch Co-op (2026-11-14, Batch 4c-1): two players on one computer, the
// screen split down the middle. Player 1 plays as normal with the mouse
// and keyboard on the left half; Player 2 is on the right half with a
// controller - their own body, health, guns and ammo. They walk, jump,
// aim, shoot, reload and switch guns. Two kinds, picked on the homepage tag:
//   - Buddy: the shop, building, the inventory and vehicles stay Player
//     1's, and Player 2's kills and coins go to Player 1.
//   - Equal (Batch 4c-2a, CouchGear.js): Player 2 also has their own coins,
//     shop, backpack, hotbar and skin (a guest: nothing saved), and (Batch
//     4c-2b, CouchHands.js) digs, builds, places traps, drives vehicles
//     and picks up drops with a normal player's controller buttons.
//
// Started from the homepage's Couch Co-op tag (HomeExtras.js), which sets
// game._couchNext before pressing Play; BuildSurvival.start makes one of
// these. Player 2 joins by pressing any button on a controller.
//
// Zombies chase whichever of you is nearer (BuildSurvival._targets).
// Running out of health knocks a player down instead of ending the game:
// the other one stands next to them for REVIVE_TIME seconds to pick them
// back up. Both down at once = game over.
//
// Player 2's view is over the shoulder (their own body in front of the
// camera), so there's no first-person gun picture to draw twice.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { holdWeapon, poseArms } from './HeldWeapon.js'
import { poseEmote } from './Emotes.js'
import { nameTag, COIN_PER_WAVE } from './BuildCamp.js'
import { CouchGear } from './CouchGear.js'
import { CouchHands } from './CouchHands.js'
import { CouchToys } from './CouchToys.js'
import { PLAY_WEAPONS, canPlayWeapon, DEFAULT_PLAY_WEAPON } from './PlayWeapons.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { applyDeadzone, setCouchPad } from './ControlSettings.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { money } from './SocialSettings.js'

// Player 2's body, in blocks (the same as Player 1's, BuildTryMode.js).
const HEIGHT = 1.8
const EYE = 1.62
const WALK = 4
const SPRINT = 7
// Equal Player 2 holding B (Crouch) sneaks.
const SNEAK = 0.4
const GRAVITY = 30
const JUMP = 8.8
const MAX_FALL = 60
const GRIP = 18
const AIR_GRIP = 9
const SWIM_UP = 4
// Right stick look speed at 100% sensitivity, radians per second.
const LOOK = 3.4
const PITCH_MAX = Math.PI / 2 - 0.05
// Over the shoulder: back, up and to the right of the eyes.
const CAM_BACK = 3
const CAM_UP = 0.5
const CAM_SIDE = 0.6
// Aiming (left trigger) zooms in.
const FOV = 70
const AIM_FOV = 45
// Health, revives.
const MAX_HEALTH = 100
const REVIVE_TIME = 3
const REVIVE_RANGE = 2.2
const REVIVE_HEALTH = 0.4
// A new wave tops Player 2 up a bit (Player 1 has the shop for that).
const WAVE_HEAL = 30
// Too far from Player 1 (the world only loads around them): brought back.
const LEASH = 56
// Shots.
const HEAD_MULT = 2.4
const ZOMBIE_HALF = 0.3
const ZOMBIE_HEIGHT = MOB_HEIGHT
const MAX_RANGE = 120
const TRIGGER_AT = 0.4
// Standard controller buttons.
const B_A = 0
const B_BACK = 8
const B_X = 2
const B_Y = 3
const B_LB = 4
const B_RB = 5
const B_LT = 6
const B_RT = 7
const B_START = 9
const B_L3 = 10

const playable = () => Object.keys(PLAY_WEAPONS).filter(canPlayWeapon)

export class CouchCoop {
  // padIndex: Play Again keeps Player 2's controller (no need to rejoin).
  // equal: Player 2 has their own coins, shop and backpack (CouchGear.js).
  // skinId: Play Again keeps equal Player 2's skin (no pick again).
  constructor(survival, { padIndex = -1, equal = false, skinId = null } = {}) {
    this.s = survival
    this.bm = survival.bm
    this.active = true
    this.equal = !!equal
    this.maxHealth = MAX_HEALTH
    this.padIndex = padIndex
    this.joined = false
    this.down = new Set()
    const weapons = playable()
    this.weapons = weapons.length ? weapons : [DEFAULT_PLAY_WEAPON]
    const start = this.weapons.indexOf(DEFAULT_PLAY_WEAPON)
    this.p2 = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false,
      health: MAX_HEALTH, isDown: false, weaponIdx: Math.max(0, start), ammo: {},
      reloadLeft: 0, nextShotAt: 0, run: false, aim: 0, recoil: 0, walk: 0, hurtFlash: 0,
    }
    this.p1Down = false
    this.reviveP1 = 0
    this.reviveP2 = 0
    this._wave = survival.wave
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2000)
    this.camera.rotation.order = 'YXZ'
    this.body = null
    this.group = new THREE.Group()
    this.tag = nameTag(t('couchPlayer2'), survival.B)
    this.group.add(this.tag)
    this.group.visible = false
    this.bm.scene.add(this.group)
    this.setSkin(DEFAULT_SKIN_DATA_URL)
    this.gear = this.equal ? new CouchGear(this, skinId) : null
    this.hands = this.equal ? new CouchHands(this) : null
    // Potions, jetpack, kite, boards, rides (CouchToys.js).
    this.toys = this.equal ? new CouchToys(this) : null
    this._note = null
    // P1 never borrows a controller until Player 2 has picked theirs.
    setCouchPad(padIndex >= 0 ? padIndex : 'waiting')
    this._buildHud()
    document.body.classList.add('couch-split')
  }

  // Player 2's body in a skin (a data URL). A newer pick wins over a
  // slower older one.
  setSkin(dataUrl) {
    const ticket = (this._skinTicket = (this._skinTicket || 0) + 1)
    loadSkinTexture(dataUrl).then((skin) => {
      if (!this.active || ticket !== this._skinTicket) return
      const B = this.s.B
      const char = buildTexturedCharacter(skin)
      const sc = (MOB_HEIGHT * B) / 32
      char.scale.setScalar(sc)
      char.position.y = 2 * sc
      const old = this.body?.char
      if (old) {
        if (this.body.gun) this.body.gun.parent?.remove(this.body.gun)
        this.group.remove(old)
        old.traverse((o) => {
          if (!o.isMesh) return
          o.geometry?.dispose?.()
          for (const m of [].concat(o.material)) m?.dispose?.()
        })
      }
      this.group.add(char)
      this.body = { char, gun: null, gunId: null, melee: false }
    }).catch(() => { /* no picture: keep the last one */ })
  }

  // A short note on Player 2's half (a finished quest...).
  p2Message(text, secs = 2.5) {
    this._note = { text, until: performance.now() + secs * 1000 }
    this._renderHud()
  }

  // Equal Player 2 picks a gun from their Backpack.
  holdWeapon(idx) {
    const p = this.p2
    if (idx < 0 || idx >= this.weapons.length) return
    p.weaponIdx = idx
    p.reloadLeft = 0
    p.nextShotAt = performance.now() + 250
  }

  // ---------- Who the zombies chase ----------

  // Player 2 as one of BuildSurvival._targets' players.
  target() {
    const p = this.p2
    if (!this.joined || p.isDown) return null
    // An Invisibility Potion: zombies can't find Player 2 (CouchToys.js).
    if (this.toys?.invisible) return null
    // Player 2's Goo Disguise: zombies wander past them (CouchToys.js).
    if (this.toys?.disguised) return null
    return { x: p.x, y: p.y, z: p.z, remote: null, p2: true, quiet: !!this.toys?.quiet, hurt: (amount) => this.hurtP2(amount) }
  }

  hurtP2(amount) {
    const p = this.p2
    if (!this.joined || p.isDown || this.s.dead) return
    if (this.s._campSafe(p.x, p.z)) return
    // Equal Player 2's own armor takes its share first.
    if (this.gear) amount = this.gear.soak(amount)
    this.gear?.stopEmote()
    p.health = Math.max(0, p.health - amount)
    p.hurtFlash = 0.45
    this._rumble(Math.min(1, 0.35 + amount / 40), 180)
    try { audioEngine.playPlayerHurt?.() } catch { /* no audio */ }
    if (p.health <= 0) this._p2Fall()
    this._renderHud()
  }

  // Player 1's health ran out (BuildSurvival._hurtPlayer). True when
  // they're only knocked down - Player 2 is still up to revive them.
  p1Fall() {
    if (!this.joined || this.p2.isDown) return false
    this.p1Down = true
    this.reviveP1 = 0
    this.s._message(t('couchP1Down'), 3)
    this._renderHud()
    return true
  }

  _p2Fall() {
    const p = this.p2
    // Both down: the game's over.
    if (this.p1Down) {
      this.p1Down = false
      this.s.health = 0
      this.s._die()
      return
    }
    this.hands?.leave(true)
    this.toys?.stop()
    p.isDown = true
    p.vx = p.vz = 0
    this.reviveP2 = 0
    this.s._message(t('couchP2Down'), 3)
  }

  // ---------- Every frame (BuildSurvival.update) ----------

  update(dt) {
    if (!this.active || !this.s.active) return
    // Game over: back to one full screen for the replay and the results.
    const over = this.s.dead
    document.body.classList.toggle('couch-split', !over)
    if (this.hud) this.hud.style.display = over ? 'none' : ''
    if (over) {
      this._wasOver = true
      this.hands?.leave(true)
      this.toys?.stop()
      return
    }
    // Respawned after a game over: both of you back up, side by side.
    if (this._wasOver) {
      this._wasOver = false
      this.p1Down = false
      Object.assign(this.p2, { isDown: false, health: MAX_HEALTH })
      if (this.joined) this._spawnNearP1()
    }
    const gp = this._findPad()
    if (!this.joined) {
      if (gp) this._join(gp)
      this._renderHud()
      return
    }
    const p = this.p2
    p.hurtFlash = Math.max(0, p.hurtFlash - dt)
    p.recoil = Math.max(0, p.recoil - dt * 6)
    p.hitFlash = Math.max(0, (p.hitFlash || 0) - dt)
    // A new wave: a little health and full spare ammo.
    if (this.s.wave !== this._wave) {
      // Equal Player 2 is paid for a cleared wave too.
      if (this.gear && this._wave > 0 && this.s.wave > this._wave) this.gear.earn(COIN_PER_WAVE)
      this._wave = this.s.wave
      if (!p.isDown) p.health = Math.min(MAX_HEALTH, p.health + WAVE_HEAL)
      for (const id of Object.keys(p.ammo)) p.ammo[id].reserve = PLAY_WEAPONS[id].reserve
      // Winter snowballs, a summer water gun (CouchToys.js).
      this.toys?.onWave(this.s.wave)
    }
    const paused = this.bm.menuOpen || this.bm.pickerOpen || this.s._picking
    if (gp) this._buttons(gp, paused)
    // Player 2's own menu open: they stand still (the game goes on).
    const busy = !!this.gear?.menuOpen
    if (!paused) {
      if (gp && !p.isDown && !busy) this._sticks(gp, dt)
      else this._move = null
      // Equal Player 2 in a vehicle drives it instead of walking.
      if (this.hands?.ride) this.hands.drive(dt)
      else this._physics(dt, !p.isDown && gp && !busy ? this._move : null)
      this._reload(dt)
      this.toys?.update(dt)
      const trigger = !p.isDown && !!gp && !busy && this.down.has(B_RT)
      // Holding RT on a block breaks it (CouchHands.js).
      this.hands?.update(dt, trigger)
      if (trigger && this._weapon().auto && (!this.gear || this.gear.holdingGun())) this._fire()
      this._revives(dt)
      this._leash()
    }
    this._drawBody(dt)
    this.gear?.render()
    this.gear?.renderHotbar()
    this._renderHud()
  }

  _findPad() {
    let list
    try { list = navigator.getGamepads?.() || [] } catch { return null }
    if (this.padIndex >= 0) {
      const gp = list[this.padIndex]
      if (gp?.connected) return gp
      // Unplugged: wait for any controller to press a button again.
      this.padIndex = -1
      setCouchPad('waiting')
      return null
    }
    for (const gp of list) {
      if (gp?.connected && gp.buttons.some((b) => b.pressed)) {
        this.padIndex = gp.index
        setCouchPad(gp.index)
        // The press that picked it doesn't also jump or fire.
        gp.buttons.forEach((b, i) => { if (b.pressed) this.down.add(i) })
        return gp
      }
    }
    return null
  }

  // Player 2 arrives next to Player 1.
  _join() {
    this.joined = true
    this._spawnNearP1()
    this.s._message(t('couchJoined'), 2.5)
    this._rumble(0.4, 150)
    this.gear?.pickSkinOnJoin()
  }

  _spawnNearP1() {
    this.hands?.leave(true)
    const p = this.p2
    const p1 = this.s.bodyPos()
    const tm = this.bm.tryMode
    p.x = p1.x
    p.y = p1.y
    p.z = p1.z
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
      if (!tm._hits(p1.x + dx, p1.y, p1.z + dz, HEIGHT)) {
        p.x = p1.x + dx
        p.z = p1.z + dz
        break
      }
    }
    p.vx = p.vy = p.vz = 0
    p.yaw = this.bm._yaw
    p.pitch = 0
  }

  _pressed(gp, i) {
    const b = gp.buttons[i]
    if (!b) return false
    return i === B_LT || i === B_RT ? b.value > TRIGGER_AT || (b.pressed && b.value === 0) : b.pressed
  }

  _buttons(gp, paused) {
    const n = Math.min(gp.buttons.length, 16)
    for (let i = 0; i < n; i++) {
      const on = this._pressed(gp, i)
      if (on && !this.down.has(i)) {
        this.down.add(i)
        this._onPress(i, paused)
      } else if (!on && this.down.has(i)) this.down.delete(i)
    }
  }

  _onPress(i, paused) {
    const p = this.p2
    // Start pauses (and unpauses) the game for both of you.
    if (i === B_START) {
      this.bm.toggleMenu?.()
      return
    }
    if (paused) return
    // Equal Player 2: Back opens their menu; while it's open, the buttons
    // move around it (CouchGear.js).
    if (this.gear && (this.gear.menuOpen || (i === B_BACK && !p.isDown))) {
      this.gear.onPress(i)
      return
    }
    if (p.isDown) return
    // Equal Player 2's hotbar, building, items and vehicles (CouchHands.js).
    if (this.hands?.onPress(i)) return
    if (i === B_A) this._jumpPressed = true
    else if (i === B_X) this._startReload()
    else if (i === B_RB || i === B_Y) this._switch(1)
    else if (i === B_LB) this._switch(-1)
    else if (i === B_L3) p.run = !p.run
    else if (i === B_RT) this._fire()
  }

  _sticks(gp, dt) {
    const set = this.bm.game?.settings || {}
    const p = this.p2
    const dzRaw = Number(set.stickDeadzone)
    const dz = Math.max(0, Math.min(0.9, (Number.isFinite(dzRaw) ? dzRaw : 15) / 100))
    const mv = applyDeadzone(gp.axes[0] || 0, gp.axes[1] || 0, dz)
    if (mv.m <= 0) p.run = false
    this._move = mv.m > 0 ? { x: mv.x, y: -mv.y, m: mv.m } : null
    // Aiming is for a held gun on foot (LT also gets in, out and places).
    p.aim = this._pressed(gp, B_LT) && !this.hands?.ride && (!this.gear || this.gear.holdingGun()) ? 1 : 0
    const lk = applyDeadzone(gp.axes[2] || 0, gp.axes[3] || 0, dz)
    if (lk.m > 0) {
      const rate = LOOK * ((set.sensitivity ?? 100) / 100) * (p.aim ? 0.55 : 1) * dt * lk.m
      p.yaw -= lk.x * rate
      p.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, p.pitch - lk.y * rate * (set.invertY ? -1 : 1)))
    }
  }

  // Walking, jumping and falling, bumping into blocks like Player 1.
  _physics(dt, move) {
    const p = this.p2
    const tm = this.bm.tryMode
    dt = Math.min(dt, 1 / 30)
    const fx = -Math.sin(p.yaw)
    const fz = -Math.cos(p.yaw)
    let mx = 0
    let mz = 0
    if (move) {
      mx = fx * move.y - fz * move.x
      mz = fz * move.y + fx * move.x
    }
    const len = Math.hypot(mx, mz)
    const inLiquid = this.bm._cellIsLiquid(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z))
    let speed = (p.run && move && move.y > 0.3 ? SPRINT : WALK) * (inLiquid ? 0.7 : 1)
    if (PLAY_WEAPONS[this._weaponId()]?.heavy) speed *= PLAY_WEAPONS[this._weaponId()].heavy
    const crouch = !!this.hands?.sneaking()
    if (crouch) speed *= SNEAK
    // Equal Player 2's potions and rides (CouchToys.js), like BuildTryMode's.
    const toys = this.toys
    if (toys) speed *= toys.speedMult()
    const glide = toys && !inLiquid ? toys.glide(p.onGround) : null
    if (glide) speed *= glide.speed
    const want = len ? (speed * Math.min(1, move.m)) / len : 0
    const grip = (p.onGround ? GRIP : AIR_GRIP) * (glide?.grip ?? 1)
    const kite = toys && !inLiquid ? toys.kite.pull() : null
    p.vx = THREE.MathUtils.damp(p.vx, mx * want + (kite?.x || 0), grip, dt)
    p.vz = THREE.MathUtils.damp(p.vz, mz * want + (kite?.z || 0), grip, dt)
    const jumpHeld = this.down.has(B_A)
    if (inLiquid) {
      p.vy = jumpHeld ? SWIM_UP : Math.max(p.vy - GRAVITY * 0.2 * dt, -2)
      toys?.wing.land()
    } else {
      if (this._jumpPressed && p.onGround) p.vy = JUMP
      p.vy = Math.max(p.vy - GRAVITY * dt, -MAX_FALL)
      // Jetpack, kite and wingsuit in the air.
      toys?.air(dt, jumpHeld, crouch)
    }
    const HEIGHT = this._height()
    this._jumpPressed = false
    // Sideways, one axis at a time; walking into a one-block step hops up it.
    let bumped = false
    for (const axis of ['x', 'z']) {
      const amount = (axis === 'x' ? p.vx : p.vz) * dt
      if (!amount) continue
      const q = { x: p.x, y: p.y, z: p.z }
      q[axis] += amount
      if (!tm._hits(q.x, q.y, q.z, HEIGHT)) p[axis] = q[axis]
      else {
        bumped = true
        // A half-step (slab) is stepped onto straight away.
        if (p.onGround && !tm._hits(q.x, q.y + 0.55, q.z, HEIGHT) && !tm._hits(p.x, p.y + 0.55, p.z, HEIGHT)) {
          p.y += 0.55
          p[axis] = q[axis]
          // Rolling up it on a skateboard: a ramp launches Player 2.
          this.toys?.skate.ramp(this.toys.body)
        } else if (axis === 'x') p.vx = 0
        else p.vz = 0
      }
    }
    if (bumped && p.onGround && len > 0 && !tm._hits(p.x + mx * 0.4, p.y + 1.05, p.z + mz * 0.4, HEIGHT)) p.vy = JUMP
    // Up and down.
    const ny = p.y + p.vy * dt
    if (!tm._hits(p.x, ny, p.z, HEIGHT)) {
      p.y = ny
      p.onGround = false
    } else {
      if (p.vy < 0) {
        // Settle on top of the block below.
        let lo = 0
        let hi = p.vy * dt
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2
          if (tm._hits(p.x, p.y + mid, p.z, HEIGHT)) hi = mid
          else lo = mid
        }
        p.y += lo
        p.onGround = true
      }
      p.vy = 0
    }
    // Fell out of the world: back next to Player 1.
    if (p.y < -64) this._spawnNearP1()
  }

  // Giant / Tiny Potion (CouchToys.js): Player 2's size, and how tall they are.
  _size() {
    return this.toys?.size || 1
  }

  _height() {
    return HEIGHT * this._size()
  }

  _leash() {
    const p = this.p2
    const p1 = this.s.bodyPos()
    if (Math.hypot(p.x - p1.x, p.z - p1.z) > LEASH) {
      this._spawnNearP1()
      this.s._message(t('couchTooFar'), 2.5)
    }
  }

  // Standing next to a downed partner picks them up.
  _revives(dt) {
    const p = this.p2
    const p1 = this.s.bodyPos()
    const near = Math.hypot(p.x - p1.x, p.z - p1.z) < REVIVE_RANGE && Math.abs(p.y - p1.y) < 1.6
    if (this.p1Down) {
      this.reviveP1 = !p.isDown && near ? this.reviveP1 + dt : Math.max(0, this.reviveP1 - dt)
      if (this.reviveP1 >= REVIVE_TIME) {
        this.p1Down = false
        this.reviveP1 = 0
        this.s.health = Math.max(this.s.health, Math.round((this.s.maxHealth || 100) * REVIVE_HEALTH))
        this.s._message(t('couchRevived'), 2)
        this.s._renderHud()
      }
    }
    if (p.isDown) {
      this.reviveP2 = !this.p1Down && !this.s.dead && near ? this.reviveP2 + dt : Math.max(0, this.reviveP2 - dt)
      if (this.reviveP2 >= REVIVE_TIME) {
        p.isDown = false
        this.reviveP2 = 0
        p.health = Math.round(MAX_HEALTH * REVIVE_HEALTH)
        this.s._message(t('couchRevived'), 2)
      }
    }
  }

  // ---------- Guns ----------

  _weaponId() {
    return this.weapons[this.p2.weaponIdx] || DEFAULT_PLAY_WEAPON
  }

  _weapon() {
    return PLAY_WEAPONS[this._weaponId()]
  }

  _ammo() {
    const id = this._weaponId()
    const w = PLAY_WEAPONS[id]
    return (this.p2.ammo[id] ||= { mag: this._magSize(w), reserve: w.reserve })
  }

  // Equal Player 2's own Bigger Magazine and Reload Speed upgrades.
  _magSize(w) {
    return this.gear ? this.gear.magSize(w) : w.mag
  }

  _switch(dir) {
    const p = this.p2
    const n = this.weapons.length
    p.weaponIdx = (((p.weaponIdx + dir) % n) + n) % n
    p.reloadLeft = 0
    p.nextShotAt = performance.now() + 250
  }

  _startReload() {
    const a = this._ammo()
    const w = this._weapon()
    if (!Number.isFinite(a.mag) || this.p2.reloadLeft > 0 || a.mag >= this._magSize(w) || a.reserve <= 0) return
    this.p2.reloadLeft = this.gear ? this.gear.reloadTime(w) : w.reload
    try { audioEngine.playReload?.() } catch { /* no audio */ }
  }

  _reload(dt) {
    const p = this.p2
    if (p.reloadLeft <= 0) return
    p.reloadLeft -= dt
    if (p.reloadLeft > 0) return
    p.reloadLeft = 0
    const a = this._ammo()
    const w = this._weapon()
    const take = Math.min(this._magSize(w) - a.mag, a.reserve)
    a.mag += take
    a.reserve -= take
  }

  _fire() {
    const p = this.p2
    if (p.isDown || p.reloadLeft > 0 || this.s.dead) return
    const now = performance.now()
    if (now < p.nextShotAt) return
    const w = this._weapon()
    const a = this._ammo()
    if (Number.isFinite(a.mag)) {
      if (a.mag <= 0) {
        this._startReload()
        return
      }
      a.mag--
      if (a.mag <= 0 && a.reserve > 0) this._startReload()
    }
    p.nextShotAt = now + w.rate * 1000
    p.recoil = 1
    try { audioEngine.playShot(this._weaponId()) } catch { /* no audio */ }
    this._rumble(0.25, 70)
    this._shoot(w)
  }

  // The first solid block along a ray (in blocks), or MAX_RANGE.
  _wallDistance(o, d, max) {
    const bm = this.bm
    for (let s = 0.2; s < max; s += 0.1) {
      const x = o.x + d.x * s
      const y = o.y + d.y * s
      const z = o.z + d.z * s
      const cy = Math.floor(y)
      const top = bm._cellSolidTop(Math.floor(x), cy, Math.floor(z))
      if (top > 0 && y - cy < top) return s
    }
    return max
  }

  // The same shot as Player 1's (BuildSurvival.shoot), from Player 2's
  // eyes along their aim: pellets, piercing and blasts, headshots.
  _shoot(w) {
    const s = this.s
    const p = this.p2
    const B = s.B
    // Attacking washes Player 2's own Goo Disguise off (not Player 1's).
    this.toys?.breakGoo()
    // Straight down the middle of Player 2's screen (the crosshair),
    // starting level with their head so nothing behind them is hit.
    const camAt = this.camera.position.clone().divideScalar(B)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const head = new THREE.Vector3(p.x, p.y + EYE * this._size(), p.z)
    const eye = camAt.addScaledVector(dir, Math.max(0, head.sub(camAt).dot(dir)))
    const range = Math.min(Number.isFinite(w.range) ? w.range : MAX_RANGE, MAX_RANGE)
    const reach = this._wallDistance(eye, dir, range)
    // Equal Player 2 hits with their own Damage upgrade, not Player 1's.
    const damage = w.damage * (this.gear ? this.gear.damageMult() : (s._damageMult?.() ?? 1))
    const hits = new Map()
    const heads = new Set()
    const add = (z, amount) => hits.set(z, (hits.get(z) || 0) + amount)
    const box = new THREE.Box3()
    const hp = new THREE.Vector3()
    const ray = new THREE.Ray()
    let impact = null
    const pellets = w.pellets || 1
    for (let i = 0; i < pellets; i++) {
      ray.origin.copy(eye)
      ray.direction.copy(dir)
      if (pellets > 1 || w.spread) {
        const spread = (w.spread || 0) * (1 - 0.45 * p.aim)
        ray.direction.x += (Math.random() - 0.5) * 2 * spread
        ray.direction.y += (Math.random() - 0.5) * 2 * spread
        ray.direction.z += (Math.random() - 0.5) * 2 * spread
        ray.direction.normalize()
      }
      const onRay = []
      for (const z of s.zombies) {
        const half = ZOMBIE_HALF * (z.size || 1) * (z.wide || 1)
        const height = ZOMBIE_HEIGHT * (z.size || 1) * (z.tall || 1)
        box.min.set(z.x - half, z.y, z.z - half)
        box.max.set(z.x + half, z.y + height, z.z + half)
        if (!ray.intersectBox(box, hp)) continue
        const d = hp.distanceTo(ray.origin)
        if (d < reach) onRay.push({ z, d, head: hp.y > z.y + height * 0.76 })
      }
      onRay.sort((a, b) => a.d - b.d)
      const struck = onRay.slice(0, w.pierce || 1)
      for (const h of struck) {
        if (h.head) heads.add(h.z)
        add(h.z, damage * (h.head ? HEAD_MULT * (s.cfg?.headshotMult ?? 1) : 1))
      }
      if (struck.length && !impact) impact = ray.at(struck[0].d, new THREE.Vector3())
      else if (!struck.length && w.blast && !impact && reach < range) impact = ray.at(reach, new THREE.Vector3())
    }
    if (w.blast && impact) {
      try { audioEngine.playExplosion?.() } catch { /* no audio */ }
      s._fx?.explode(impact.clone().addScaledVector(dir, -0.8).multiplyScalar(B), w.blast)
      for (const z of s.zombies) {
        const d = Math.hypot(z.x - impact.x, z.y + ZOMBIE_HEIGHT * 0.5 - impact.y, z.z - impact.z)
        if (d < w.blast) add(z, damage * 0.8 * (1 - d / w.blast))
      }
    }
    if (w.burn && s._fx?.flameStream) {
      const from = eye.clone().addScaledVector(dir, 1.2).multiplyScalar(B)
      s._fx.flameStream(from, dir, Math.min(w.range || 7, reach))
    }
    const push = new THREE.Vector3(dir.x, 0, dir.z).normalize()
    // Hit like Player 1's shots (BuildSurvival.hitZombieWith), minus the
    // hit mark over Player 1's crosshair: Player 2 gets their own flash.
    for (const [z, amount] of hits) {
      if (!s.zombies.includes(z)) continue
      if (w.burn) z.burn = w.burn
      if (w.slow) z.slow = w.slow
      const head = heads.has(z)
      if (head) {
        if (this.gear) this.gear.onHeadshot()
        else s.stats.headshots++
      }
      s.damageNumbers?.atZombie(z, amount, this._weaponId(), ZOMBIE_HEIGHT)
      s._hitHead = head
      // Equal Player 2's kills pay them (BuildSurvival.damageZombie).
      s._p2Shot = !!this.gear
      try {
        s.damageZombie(z, amount, push)
      } finally {
        s._hitHead = false
        s._p2Shot = false
      }
      this.p2.hitFlash = s.zombies.includes(z) ? 0.15 : 0.3
    }
  }

  _rumble(strength, ms) {
    if (this.bm.game?.settings?.controllerVibration === false || this.padIndex < 0) return
    try {
      const gp = navigator.getGamepads?.()[this.padIndex]
      gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.2) })?.catch?.(() => {})
    } catch { /* this controller can't rumble */ }
  }

  // ---------- Drawing ----------

  _drawBody(dt) {
    const p = this.p2
    const B = this.s.B
    this.group.visible = this.joined
    this.group.position.set(p.x * B, p.y * B, p.z * B)
    this.group.rotation.y = p.yaw + Math.PI
    const size = this._size()
    if (Math.abs(this.group.scale.x - size) > 0.001) this.group.scale.setScalar(THREE.MathUtils.damp(this.group.scale.x, size, 8, dt))
    const body = this.body
    if (!body) return
    body.char.rotation.x = p.isDown ? -Math.PI / 2 : 0
    const lp = body.char.limbPivots
    if (!lp) return
    // Equal Player 2 holding a block or an item: no gun in hand.
    const id = this.gear && !this.gear.holdingGun() ? null : this._weaponId()
    if (body.gunId !== id) {
      const held = holdWeapon(this.bm.game, body.char, id, body.gun)
      body.gun = held.gun
      body.melee = held.melee
      body.gunId = id
    }
    // Equal Player 2's emote (CouchGear.playEmote): posed like Player 1's.
    if (body.baseY === undefined) body.baseY = body.char.position.y
    body.char.position.y = body.baseY
    const emote = this.gear?.emote
    const bob = emote && !p.isDown ? poseEmote(lp, emote.id, performance.now() / 1000) : null
    if (bob !== null) {
      body.char.position.y += bob * body.char.scale.y
      return
    }
    const speed = Math.hypot(p.vx, p.vz)
    p.walk += dt * speed * 3.2
    const swing = p.isDown ? 0 : Math.sin(p.walk) * Math.min(1, speed / 2) * 0.7
    lp.legR.rotation.x = swing
    lp.legL.rotation.x = -swing
    poseArms(lp, { holding: !!body.gun, melee: body.melee, firing: p.recoil > 0.3, swing })
  }

  // Where Player 2's camera goes this frame: over their right shoulder,
  // pulled in front of any wall behind them.
  _placeCamera() {
    const p = this.p2
    const B = this.s.B
    const cam = this.camera
    cam.rotation.set(p.isDown ? -0.6 : p.pitch, p.yaw, 0, 'YXZ')
    cam.updateMatrixWorld()
    const eye = new THREE.Vector3(p.x, p.y + (p.isDown ? 0.6 : EYE * this._size()), p.z)
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(cam.quaternion)
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
    const want = eye.clone().addScaledVector(side, CAM_SIDE).addScaledVector(back, CAM_BACK)
    want.y += CAM_UP
    const dir = want.clone().sub(eye)
    const len = dir.length()
    dir.normalize()
    const dist = Math.max(0.4, Math.min(len, this._wallDistance(eye, dir, len) - 0.3))
    cam.position.copy(eye.addScaledVector(dir, dist)).multiplyScalar(B)
    const fov = THREE.MathUtils.lerp(FOV, AIM_FOV, p.aim)
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov = THREE.MathUtils.lerp(cam.fov, fov, 0.25)
    cam.updateMatrixWorld()
  }

  // BuildMode.render: the left half is Player 1's own drawing (drawLeft),
  // then Player 2's view goes on the right.
  drawFrame(renderer, drawLeft) {
    const size = renderer.getSize(new THREE.Vector2())
    const half = Math.floor(size.x / 2)
    const cam1 = this.bm.camera
    const aspect = cam1.aspect
    const tm = this.bm.tryMode
    // Player 1's own body shows to Player 2, never in first person.
    const p1Body = tm._body?.group
    const p1BodyShown = p1Body?.visible
    if (p1Body && !tm.view) p1Body.visible = false
    renderer.setScissorTest(true)
    renderer.setViewport(0, 0, half, size.y)
    renderer.setScissor(0, 0, half, size.y)
    cam1.aspect = half / size.y
    cam1.updateProjectionMatrix()
    const tagShown = this.tag.visible
    try {
      drawLeft()
      if (this.joined) {
        // ...lying down while knocked out.
        if (p1Body) {
          p1Body.visible = true
          if (tm._body?.char) tm._body.char.rotation.x = this.p1Down ? -Math.PI / 2 : 0
        }
        this.tag.visible = false
        renderer.setViewport(half, 0, size.x - half, size.y)
        renderer.setScissor(half, 0, size.x - half, size.y)
        this.camera.aspect = (size.x - half) / size.y
        this.camera.near = cam1.near
        this.camera.far = cam1.far
        this.camera.updateProjectionMatrix()
        this._placeCamera()
        const toneMapping = renderer.toneMapping
        renderer.toneMapping = THREE.NoToneMapping
        const shadowMap = renderer.shadowMap
        const auto = shadowMap.autoUpdate
        shadowMap.autoUpdate = false
        renderer.render(this.bm.scene, this.camera)
        shadowMap.autoUpdate = auto
        renderer.toneMapping = toneMapping
      } else {
        // Waiting for Player 2: their half is a plain dark panel with the
        // "press any button" note on it (the HUD).
        renderer.setViewport(half, 0, size.x - half, size.y)
        renderer.setScissor(half, 0, size.x - half, size.y)
        renderer.setClearColor(0x101010, 1)
        renderer.clear(true, true, false)
      }
    } finally {
      this.tag.visible = tagShown
      if (p1Body) p1Body.visible = p1BodyShown
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, size.x, size.y)
      cam1.aspect = aspect
      cam1.updateProjectionMatrix()
    }
  }

  // ---------- Player 2's HUD (the right half) ----------

  _buildHud() {
    let el = document.getElementById('couch-hud')
    el?.remove()
    el = document.createElement('div')
    el.id = 'couch-hud'
    el.innerHTML = `
      <div id="couch-p1-msg" class="couch-msg"></div>
      <div id="couch-p2">
        <div id="couch-p2-hurt"></div>
        <div id="couch-p2-crosshair"></div>
        <div id="couch-p2-msg" class="couch-msg"></div>
        <div id="couch-p2-coins"></div>
        <div id="couch-p2-name"></div>
        <div id="couch-p2-health"><div id="couch-p2-health-fill"></div><span id="couch-p2-health-text"></span></div>
        <div id="couch-p2-ammo"><span id="couch-p2-weapon"></span><span id="couch-p2-count"></span></div>
        <div id="couch-p2-dig"><div id="couch-p2-dig-fill"></div></div>
        <div id="couch-p2-ride"></div>
        <div id="couch-p2-hotbar"></div>
        <div id="couch-menu" style="display: none"></div>
      </div>`
    document.body.appendChild(el)
    this.hud = el
    this._hudKey = ''
  }

  _reviveText(left) {
    return t('couchReviveHint', { n: Math.max(0, Math.round((left / REVIVE_TIME) * 100)) })
  }

  _renderHud() {
    if (!this.hud) return
    const p = this.p2
    const a = this.joined ? this._ammo() : null
    const id = this._weaponId()
    const nameKey = this.bm.game?.weapons?.getSummary?.().find((w) => w.id === id)?.nameKey
    const p2Msg = !this.joined
      ? `${t('couchPressToJoin')}\n\n${t('couchSlowWarning')}`
      : p.isDown
        ? `${t('couchYouAreDown')}\n${this._reviveText(this.reviveP2)}`
        : this.p1Down
          ? `${t('couchGoRevive')}\n${this._reviveText(this.reviveP1)}`
          : this._note && performance.now() < this._note.until ? this._note.text : ''
    const p1Msg = this.p1Down ? `${t('couchYouAreDown')}\n${this._reviveText(this.reviveP1)}` : p.isDown ? `${t('couchGoRevive')}\n${this._reviveText(this.reviveP2)}` : ''
    const g = this.gear
    // Equal Player 2 holding a block or an item: its name and how many.
    const held = g && !g.holdingGun() ? g.held() : null
    const heldOther = !!g && !g.holdingGun()
    const count = !a ? '' : heldOther ? (held && held.n > 1 ? `×${held.n}` : '') : p.reloadLeft > 0 ? t('buildPlayReloading') : Number.isFinite(a.mag) ? `${a.mag} / ${a.reserve}` : ''
    const heldName = heldOther ? g.label(held) : nameKey ? t(nameKey) : ''
    const dig = this.hands ? Math.round(this.hands.digProgress() * 20) : 0
    const ride = [this.hands?.rideText(), this.toys?.statusText()].filter(Boolean).join(' · ')
    const coins = g && this.joined ? `${t('campCoins', { n: money(this.bm.game?.settings, g.coins) })}${g.armor > 0 ? ` · ${t('couchArmor', { n: Math.ceil(g.armor) })}` : ''}\n${t('couchMenuOpen')}` : ''
    const key = [this.joined, Math.ceil(p.health), p2Msg, p1Msg, heldName, count, p.hurtFlash > 0, p.aim, p.hitFlash > 0, coins, !!g?.menuOpen, dig, ride].join('|')
    if (key === this._hudKey) return
    this._hudKey = key
    const $ = (sel) => this.hud.querySelector(sel)
    this.hud.classList.toggle('joined', this.joined)
    this.hud.classList.toggle('p2-down', p.isDown)
    this.hud.classList.toggle('p2-menu', !!g?.menuOpen)
    $('#couch-p2-coins').textContent = coins
    $('#couch-p2-msg').textContent = p2Msg
    $('#couch-p1-msg').textContent = p1Msg
    $('#couch-p2-name').textContent = t('couchPlayer2')
    $('#couch-p2-health-fill').style.width = `${Math.max(0, Math.min(100, (p.health / MAX_HEALTH) * 100))}%`
    $('#couch-p2-health-text').textContent = String(Math.max(0, Math.ceil(p.health)))
    $('#couch-p2-weapon').textContent = heldName
    $('#couch-p2-count').textContent = count
    this.hud.classList.toggle('p2-equal', !!g)
    $('#couch-p2-dig').classList.toggle('show', dig > 0)
    $('#couch-p2-dig-fill').style.width = `${dig * 5}%`
    $('#couch-p2-ride').textContent = ride
    $('#couch-p2-hurt').classList.toggle('show', p.hurtFlash > 0)
    $('#couch-p2-crosshair').classList.toggle('aim', !!p.aim)
    $('#couch-p2-crosshair').classList.toggle('hit', p.hitFlash > 0)
  }

  dispose() {
    if (!this.active) return
    this.active = false
    setCouchPad(null)
    this.hands?.dispose()
    this.toys?.dispose()
    document.body.classList.remove('couch-split')
    this.hud?.remove()
    this.hud = null
    if (this.body?.gun) this.body.gun.parent?.remove(this.body.gun)
    this.bm.scene.remove(this.group)
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        m?.map?.dispose?.()
        m?.dispose?.()
      }
    })
  }
}

// What the special blocks (SpecialBlocks.js) do, 2026-10-27. Owned by
// BuildMode (`bm.specials`):
// - onPlace/onRemove/clear keep an index of where every special block is
//   (cheap: only special types are kept), so nothing scans the whole map.
// - start()/stop() run with Try Map (and so with Play, which runs on top
//   of it); update() is called every frame by BuildTryMode (your body) and
//   by PlaySpectate (no body - only the zombie and look effects run).
// - BuildSurvival asks zombieTarget() who a zombie should walk to (a bell,
//   bait...) and zombieTick() for its speed and the blocks it touches.
// - use() is E / right-click / the phone's use button on a block.
//
// Each block's `fx.kind` picks its code below. State a block has while
// you play (cooldowns, a growing crop) lives in _st and is not saved with
// the map - it starts fresh every try.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { PlayFx } from './PlayFx.js'
import { SPECIAL_BY_ID } from './SpecialBlocks.js'
import { LINK_RANGE } from './BuildGadgets.js'

const OVERLAY_RANGE = 48 // blocks: look effects (disco, crops, text) only this near you
const OVERLAY_REFRESH = 2 // seconds between re-picking which blocks get them
const MAX_OVERLAYS = 64
const PLAYER_HEIGHT = 1.8
const ZOMBIE_HEIGHT = 2
const TOUCH = 0.4 // blocks between a body and a block that counts as touching
const HURT_EVERY = 0.5 // seconds: a hurting block bites you in steps, not every frame
const BEST_KEY = 'buildmode-play-best'

export class BuildSpecials {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this._at = new Map() // "x,y,z" -> { key, x, y, z, type, def }
    this._byKind = new Map() // fx.kind -> Set of entries
    this._st = new Map() // "x,y,z" -> this run's state for that block
    this.active = false
    this._time = 0
    this._group = null
    // How the block under you changes your walking (BuildTryMode).
    this.speedMult = 1
    this.gripMult = 1
    this._crumbled = [] // Crumble Blocks fallen away: { x, y, z, type, back }
  }

  // ---- the index ----

  onPlace(key, x, y, z, type) {
    const def = SPECIAL_BY_ID.get(type)
    if (!def) {
      if (this._at.has(key)) this.onRemove(key)
      return
    }
    if (this._at.has(key)) this.onRemove(key)
    const entry = { key, x, y, z, type, def }
    this._at.set(key, entry)
    const kind = def.fx.kind
    if (!this._byKind.has(kind)) this._byKind.set(kind, new Set())
    this._byKind.get(kind).add(entry)
    if (this.active) this._overlaysDirty = true
  }

  onRemove(key) {
    const entry = this._at.get(key)
    if (!entry) return
    this._at.delete(key)
    this._byKind.get(entry.def.fx.kind)?.delete(entry)
    this._st.delete(key)
    this._dropOverlay(key)
  }

  clear() {
    for (const key of [...this._at.keys()]) this.onRemove(key)
  }

  kind(kind) {
    return this._byKind.get(kind) || EMPTY
  }

  entryAt(x, y, z) {
    const type = this.bm.getBlockAt(x, y, z)
    return type && SPECIAL_BY_ID.has(type) ? this._at.get(`${x},${y},${z}`) || null : null
  }

  _state(entry) {
    let st = this._st.get(entry.key)
    if (!st) this._st.set(entry.key, (st = {}))
    return st
  }

  // ---- running ----

  start() {
    this.active = true
    this._time = 0
    this._st.clear()
    this._group = new THREE.Group()
    this.bm.scene.add(this._group)
    this._overlays = new Map()
    this._overlaysDirty = true
    this._overlayTimer = 0
    this._fxTimer = 0
    this._hurtAcc = 0
    this._onPadKey = null
    this._onUnderKey = null
    this._padCd = 0
    this._shieldUntil = 0
    this._standT = 0
    this._crumbled = []
    this._gates = [] // gates standing open: { cells, anchor, byPower, closeAt }
    this._on = new Set() // power: keys of blocks giving power right now
    this._powerAt = -1
  }

  stop() {
    if (!this.active) return
    this._restoreCrumbled(true)
    this._closeGates(true)
    this.active = false
    this.speedMult = 1
    this.gripMult = 1
    for (const key of [...(this._overlays?.keys() || [])]) this._dropOverlay(key)
    if (this._group) this.bm.scene.remove(this._group)
    this._group = null
    this._fx?.clear()
    this._st.clear()
  }

  _play() {
    const s = this.bm.survival
    return s?.active && !s.dead ? s : null
  }

  _msg(text) {
    const s = this.bm.survival
    if (s?.active) s._message(text)
    else this.bm.game?._showHomepageToast?.(text)
  }

  // Plays one of Audio.js's special sounds (remembered for the tests).
  _sound(kind) {
    this._lastSound = kind
    audioEngine.playSpecial?.(kind)
  }

  _effects() {
    if (!this._fx) this._fx = new PlayFx(this.bm.scene, this.B)
    return this._fx
  }

  // Every frame while trying/playing. me: your feet position in blocks
  // (null while spectating - you have no body then).
  update(dt, me) {
    if (!this.active) return
    dt = Math.min(dt, 0.1)
    this._time += dt
    if (me && !this.bm.survival?.spectating) this._updateMe(dt, me)
    this._tickBlocks(me || this._camFeet())
    this._fxTimer -= dt
    if (this._fxTimer <= 0) {
      this._fxTimer = 0.12
      this._emitLooks(me || this._camFeet())
    }
    this._fx?.update(dt)
    this._overlayTimer -= dt
    if (this._overlaysDirty || this._overlayTimer <= 0) {
      this._overlayTimer = OVERLAY_REFRESH
      this._overlaysDirty = false
      this._pickOverlays(me || this._camFeet())
    }
    this._updateOverlays(dt)
  }

  // Blocks that do things over time, near you.
  _tickBlocks(me) {
    const s = this.bm.survival
    const zombies = s?.active ? s.zombies : []
    const now = this._time
    if (now - this._powerAt >= POWER_STEP) {
      const elapsed = this._powerAt < 0 ? POWER_STEP : now - this._powerAt
      this._powerAt = now
      this._tickPower(me, zombies, elapsed)
    }
    // Arrow Shooters fire at the nearest zombie they can see, when powered.
    for (const e of this.kind('arrows')) {
      const st = this._state(e)
      if (st.next > now || !this.powered(e)) continue
      const fx = e.def.fx
      let best = null
      let bestD = fx.r
      for (const zb of zombies) {
        const d = dist3(zb, e.x + 0.5, e.y, e.z + 0.5)
        if (d < bestD && this._clearLine(e, zb)) {
          best = zb
          bestD = d
        }
      }
      if (!best) continue
      st.next = now + fx.every
      best.health -= fx.dmg
      best.flash = 0.12
      this._sound('twang')
      this._trail(e, best, 0xe0c890)
    }
    // Auto Turrets shoot while they have ammo (no power needed).
    for (const e of this.kind('turret')) {
      const st = this._state(e)
      if (st.ammo === undefined) st.ammo = e.def.fx.start
      if (st.next > now || st.ammo <= 0) continue
      const fx = e.def.fx
      let best = null
      let bestD = fx.r
      for (const zb of zombies) {
        const d = dist3(zb, e.x + 0.5, e.y, e.z + 0.5)
        if (d < bestD && this._clearLine(e, zb)) {
          best = zb
          bestD = d
        }
      }
      if (!best) continue
      st.next = now + fx.every
      st.ammo--
      best.health -= fx.dmg
      best.flash = 0.12
      this._sound('turret')
      this._trail(e, best, 0xffe080)
    }
    // Searchlights mark zombies in their light (they take more damage).
    for (const e of this.kind('searchlight')) {
      if (!this.powered(e)) continue
      for (const zb of zombies) if (dist3(zb, e.x + 0.5, e.y, e.z + 0.5) <= e.def.fx.r) zb._litUntil = now + 0.5
    }
    // Repair Stations put back blocks broken near them, one at a time.
    for (const e of this.kind('repair')) {
      const st = this._state(e)
      if (st.next > now) continue
      st.next = now + e.def.fx.every
      this._repairNear(e)
    }
    // Gates: open while powered; a used gate closes again by itself.
    for (const e of this.kind('gate')) if (this.powered(e)) this._openGate(e, true)
    this._closeGates()
    // Pistons kick when their power comes on.
    for (const e of this.kind('piston')) {
      const st = this._state(e)
      const p = this.powered(e)
      if (p && !st.was) this._pistonKick(e, me)
      st.was = p
    }
    // Magnets: stand by one and loose drops around it come to you.
    const drops = s?._drops?.list || []
    if (me && drops.length) {
      for (const e of this.kind('magnet')) {
        if (dist3(me, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.near) continue
        for (const d of drops) {
          if (Math.hypot(d.x - e.x - 0.5, d.z - e.z - 0.5) > e.def.fx.r) continue
          d.x += (me.x - d.x) * 0.2
          d.z += (me.z - d.z) * 0.2
          d.y = Math.max(d.y, me.y + 0.4)
        }
      }
    }
    for (const e of this.kind('tripwire')) {
      const st = this._state(e)
      if (st.cdUntil > now) continue
      const r = e.def.fx.r
      if (!zombies.some((zb) => Math.abs(zb.y - e.y) < 3 && Math.hypot(zb.x - e.x - 0.5, zb.z - e.z - 0.5) < r)) continue
      st.cdUntil = now + e.def.fx.cd
      this._sound('chime')
      this._msg(t('specialTripwire', { name: e.def.name }))
      this._burst(e, 0xfff0a0, 5)
    }
    for (const e of this.kind('windchime')) {
      const st = this._state(e)
      if (dist3(me, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.hear) continue
      // Rattles low when zombies are close (right away when one first
      // comes), tinkles softly otherwise.
      const warn = zombies.some((zb) => dist3(zb, e.x + 0.5, e.y, e.z + 0.5) < e.def.fx.warn)
      const fresh = warn && !st.warned
      st.warned = warn
      if (st.next > now && !fresh) continue
      this._sound(warn ? 'warn' : 'chime')
      st.next = now + (warn ? 1.2 : 4 + Math.random() * 4)
    }
    this._restoreCrumbled()
    // Net Launchers catch the nearest zombie in range.
    for (const e of this.kind('net')) {
      const st = this._state(e)
      if (st.cdUntil > now) continue
      let best = null
      let bestD = e.def.fx.r
      for (const zb of zombies) {
        const d = dist3(zb, e.x + 0.5, e.y, e.z + 0.5)
        if (d < bestD && !(zb._held > 0)) {
          best = zb
          bestD = d
        }
      }
      if (!best) continue
      st.cdUntil = now + e.def.fx.cd
      best._held = e.def.fx.hold
      this._sound('whoosh')
      this._burst({ x: best.x - 0.5, y: best.y, z: best.z - 0.5 }, 0xe0d8b0, 8)
    }
    // Swinging Blades hit everything close, once a swing.
    for (const e of this.kind('blade')) {
      const st = this._state(e)
      if (st.next > now) continue
      st.next = now + e.def.fx.every
      for (const zb of zombies) {
        if (Math.hypot(zb.x - e.x - 0.5, zb.z - e.z - 0.5) > e.def.fx.r || Math.abs(zb.y - e.y) > 2) continue
        zb.health -= e.def.fx.dmg
        zb.flash = 0.12
      }
    }
    // Graves: at night a zombie climbs out now and then (Play only).
    const night = (this.bm.sky?.nightAmount?.() ?? 0) > 0.5
    for (const e of this.kind('grave')) {
      const st = this._state(e)
      if (st.next === undefined) st.next = now + e.def.fx.every * Math.random()
      if (!s?.active || s.dead || s._skin === undefined || !night || st.next > now) continue
      st.next = now + e.def.fx.every
      if (s.zombies.length >= e.def.fx.cap || this.bm.getBlockAt(e.x, e.y + 1, e.z)) continue
      if (s._spawnZombie([[e.x, e.y + 1, e.z]])) this._burst(e, 0x6b4a30, 10)
    }
    for (const e of this.kind('doorbell')) {
      const st = this._st.get(e.key)
      if (st?.closeAt && st.closeAt <= now) {
        st.closeAt = 0
        this.bm.gadgets.setDoorsNear(e.x, e.y, e.z, false)
      }
    }
    for (const e of this.kind('radio')) {
      const st = this._st.get(e.key)
      if (!st?.station || st.next > now) continue
      st.next = now + e.def.fx.every
      if (dist3(me, e.x + 0.5, e.y, e.z + 0.5) <= e.def.fx.hear) this._sound(`radio${st.station}`)
    }
    for (const e of this.kind('echo')) {
      const st = this._st.get(e.key)
      if (!st?.echoAt || st.echoAt > now) continue
      st.echoAt = 0
      st.until = now + e.def.fx.time
      this._sound('echo')
      this._burst(e, 0xb0c8ff, 6)
    }
  }

  _camFeet() {
    const c = this.bm.camera.position
    return { x: c.x / this.B, y: c.y / this.B - 1.6, z: c.z / this.B }
  }

  // ---- you ----

  _updateMe(dt, me) {
    const play = this._play()
    // Standing on a pad (the cell your feet are in).
    const fx = Math.floor(me.x)
    const fy = Math.floor(me.y + 0.01)
    const fz = Math.floor(me.z)
    const pad = this.entryAt(fx, fy, fz)
    this._padCd = Math.max(0, this._padCd - dt)
    const padKey = pad?.key || null
    if (padKey !== this._onPadKey) {
      this._onPadKey = padKey
      if (pad) this._stepOn(pad, me)
    }
    // ...and the block under your feet (a piano key).
    const under = this.bm.tryMode.onGround === false ? null : this.entryAt(fx, fy - 1, fz)
    const underKey = under?.key || null
    if (underKey !== this._onUnderKey) {
      this._onUnderKey = underKey
      this._standT = 0
      if (under) this._stepOn(under, me)
    }
    // Walking on it: sticky, slippery...
    const ufx = (under || pad)?.def.fx
    this.speedMult = ufx?.pspeed ?? 1
    this.gripMult = ufx?.pgrip ?? 1
    // A conveyor belt carries you along (not into walls).
    if (pad?.def.fx.kind === 'conveyor') {
      const tm = this.bm.tryMode
      const [cx, cz] = this._facingDir(pad)
      const nx = tm.pos.x + cx * pad.def.fx.speed * dt
      const nz = tm.pos.z + cz * pad.def.fx.speed * dt
      if (!tm._hits(nx, tm.pos.y, nz)) tm.pos.set(nx, tm.pos.y, nz)
    }
    // A Crumble Block gives way a moment after you stand on it.
    if (under?.def.fx.kind === 'crumble') {
      this._standT += dt
      if (this._standT >= under.def.fx.after) this._crumble(under)
    }
    // A Flame Jet that's firing burns you.
    if (play && (under || pad)?.def.fx.kind === 'flamejet' && this._jetOn(under || pad)) {
      this._jetHurt = (this._jetHurt || 0) + dt
      if (this._jetHurt >= HURT_EVERY) {
        this._jetHurt = 0
        play._hurtPlayer(ufx.pdps * HURT_EVERY)
      }
    }
    // Healing near campfires.
    if (play && play.health < play.maxHealth) {
      let heal = 0
      for (const e of this.kind('campfire')) {
        if (dist3(me, e.x + 0.5, e.y, e.z + 0.5) <= e.def.fx.r) heal = Math.max(heal, e.def.fx.heal)
      }
      if (heal) {
        play.health = Math.min(play.maxHealth, play.health + heal * dt)
        play._renderHud()
      }
    }
    // Blocks that hurt you while you touch them (spikes), in steps.
    if (play) {
      let dps = 0
      this._touching(me, PLAYER_HEIGHT, (e) => {
        if (e.def.fx.pdps) dps = Math.max(dps, e.def.fx.pdps)
      })
      this._hurtAcc = dps ? this._hurtAcc + dt : 0
      if (dps && this._hurtAcc >= HURT_EVERY) {
        this._hurtAcc = 0
        play._hurtPlayer(dps * HURT_EVERY)
      }
    }
  }

  // Your feet just went into a pad's cell.
  _stepOn(entry, me) {
    if (entry.def.fx.kind === 'piano') {
      this._playKey(entry)
      return
    }
    if (entry.def.fx.kind === 'teleport' && this._padCd <= 0) {
      let best = null
      let bestD = Infinity
      for (const e of this.kind('teleport')) {
        if (e === entry || e.type !== entry.type) continue
        const d = (e.x - entry.x) ** 2 + (e.y - entry.y) ** 2 + (e.z - entry.z) ** 2
        if (d < bestD) {
          bestD = d
          best = e
        }
      }
      if (!best) {
        this._msg(t('specialNoPair', { name: entry.def.name }))
        return
      }
      const tm = this.bm.tryMode
      tm.pos.set(best.x + 0.5, best.y + 0.07, best.z + 0.5)
      tm.vel?.set(0, 0, 0)
      this._onPadKey = best.key
      this._padCd = entry.def.fx.cd
      this._sound('whoosh')
      this._burst(entry, 0xc08aff, 10)
      this._burst(best, 0xc08aff, 10)
      void me
    }
  }

  // ---- falling away and coming back (Crumble Block) ----

  _crumble(entry) {
    const bm = this.bm
    const { x, y, z, type } = entry
    this._crumbled.push({ x, y, z, type, back: this._time + entry.def.fx.back })
    bm._suppressUndoRecording = true
    bm.removeBlock(x, y, z)
    bm._suppressUndoRecording = false
    this._sound('crumble')
    this._burst({ x, y: y - 0.5, z }, 0x9a8a70, 10)
  }

  // Puts fallen Crumble Blocks back when their time is up (all of them
  // when the try ends), unless something stands in the way.
  _restoreCrumbled(all = false) {
    if (!this._crumbled.length) return
    const bm = this.bm
    const p = bm.tryMode.pos
    this._crumbled = this._crumbled.filter((c) => {
      if (!all && c.back > this._time) return true
      if (bm.getBlockAt(c.x, c.y, c.z)) return false
      const inside = Math.floor(p.x) === c.x && Math.floor(p.z) === c.z && c.y >= Math.floor(p.y) && c.y <= Math.floor(p.y + 1.7)
      if (inside && !all) return true
      bm._suppressUndoRecording = true
      bm.placeBlock(c.x, c.y, c.z, c.type)
      bm._suppressUndoRecording = false
      return false
    })
  }

  // A Flame Jet fires for `on` seconds out of every `every`.
  _jetOn(entry) {
    const fx = entry.def.fx
    return (this._time + (entry.x + entry.z) * 0.37) % fx.every < fx.on
  }

  // ---- using a block (E / right-click / phone use button) ----

  // True if (x, y, z) is a special block that did something.
  use(x, y, z) {
    if (!this.active) return false
    const entry = this.entryAt(x, y, z)
    if (!entry) return false
    const fx = entry.def.fx
    // Only blocks made to be used react (a trap's timer isn't touched).
    if (!USE_KINDS.has(fx.kind) && !(fx.kind === 'lure' && fx.on === 'use')) return false
    const st = this._state(entry)
    if (fx.cd && st.cdUntil > this._time) {
      this._msg(t('specialCooldown', { name: entry.def.name, s: Math.ceil(st.cdUntil - this._time) }))
      return true
    }
    if (fx.kind === 'lure' && fx.on === 'use') {
      st.until = this._time + fx.time
      st.cdUntil = this._time + fx.cd
      if (fx.sound) this._sound(fx.sound)
      this._msg(t('specialLured', { name: entry.def.name, s: fx.time }))
      this._burst(entry, 0xffe08a, 12)
      return true
    }
    if (fx.kind === 'crop') return this._useCrop(entry, st)
    if (fx.cd) st.cdUntil = this._time + fx.cd
    if (fx.kind === 'doorbell') {
      this._sound('dingdong')
      // Opens the doors around it for a moment, like someone answering.
      this.bm.gadgets.setDoorsNear(x, y, z, true)
      st.closeAt = this._time + fx.open
      return true
    }
    if (fx.kind === 'radio') {
      st.station = ((st.station || 0) + 1) % (fx.stations + 1)
      st.next = this._time
      this._msg(st.station ? t('specialRadioOn', { n: st.station }) : t('specialRadioOff'))
      this._overlaysDirty = true
      return true
    }
    if (fx.kind === 'horn') {
      this._sound('honk')
      const s = this.bm.survival
      for (const zb of s?.active ? s.zombies : []) {
        const dx = zb.x - (x + 0.5)
        const dz = zb.z - (z + 0.5)
        const d = Math.hypot(dx, dz)
        if (d > fx.r || Math.abs(zb.y - y) > 4) continue
        // Pushed straight away over a moment (zombieTick moves it).
        zb._knock = 0.35
        zb._kx = (dx / (d || 1)) * (fx.push / 0.35)
        zb._kz = (dz / (d || 1)) * (fx.push / 0.35)
      }
      this._burst(entry, 0xffffff, 8)
      return true
    }
    if (fx.kind === 'piano') {
      this._playKey(entry)
      return true
    }
    if (fx.kind === 'turret') {
      const s = this._play()
      const take = s ? Math.min(fx.load, s.reserve || 0) : fx.load
      if (s) s.reserve -= take
      st.ammo = (st.ammo ?? fx.start) + take
      s?._renderHud()
      this._sound('pop')
      this._msg(t('specialTurretAmmo', { n: st.ammo }))
      return true
    }
    if (fx.kind === 'gate') {
      this._openGate(entry)
      return true
    }
    if (fx.kind === 'power') {
      if (fx.src === 'generator') {
        st.on = !st.on
        this._sound(st.on ? 'hum' : 'pop')
        this._msg(t(st.on ? 'specialGenOn' : 'specialGenOff'))
      } else if (fx.src === 'button') {
        st.until = this._time + fx.pulse
        this._sound('pop')
      } else if (fx.src === 'gate') {
        st.mode = ((st.mode || 0) + 1) % GATE_MODES.length
        this._sound('pop')
        this._msg(t('specialGateMode', { mode: GATE_MODES[st.mode] }))
      } else return false
      this._powerAt = -1
      return true
    }
    if (fx.kind === 'smoke' || fx.kind === 'shieldgen') {
      st.until = this._time + fx.time
      this._sound(fx.kind === 'smoke' ? 'crumble' : 'chime')
      this._msg(t(fx.kind === 'smoke' ? 'specialSmoke' : 'specialShieldUp', { s: fx.time }))
      return true
    }
    if (fx.kind === 'watchtower') {
      // To the top of whatever is stacked on it.
      let top = y + 1
      while (top < y + 64 && this.bm.getBlockAt(x, top, z)) top++
      if (top === y + 1) {
        if (fx.cd) st.cdUntil = 0
        this._msg(t('specialStackFirst'))
        return true
      }
      const tm = this.bm.tryMode
      tm.pos.set(x + 0.5, top, z + 0.5)
      tm.vel?.set(0, 0, 0)
      this._sound('whoosh')
      return true
    }
    if (fx.kind === 'oilpot') {
      const s = this.bm.survival
      for (const zb of s?.active ? s.zombies : []) {
        if (Math.hypot(zb.x - x - 0.5, zb.z - z - 0.5) > fx.r || zb.y > y + 1 || zb.y < y - 8) continue
        zb.health -= fx.dmg
        zb.burn = Math.max(zb.burn || 0, fx.burn)
        zb.flash = 0.12
      }
      for (let i = 0; i < 8; i++) this._effects().flame((x + Math.random()) * this.B, y * this.B, (z + Math.random()) * this.B)
      this._sound('whoosh')
      return true
    }
    if (fx.kind === 'cannon' || fx.kind === 'catapult') {
      // Fires away from you, the way you face it.
      const p = this.bm.tryMode.pos
      let dx = x + 0.5 - p.x
      let dz = z + 0.5 - p.z
      const len = Math.hypot(dx, dz) || 1
      dx /= len
      dz /= len
      const s = this.bm.survival
      const zombies = s?.active ? s.zombies : []
      const B = this.B
      if (fx.kind === 'cannon') {
        // Everything along the shot's line.
        for (const zb of zombies) {
          const rx = zb.x - x - 0.5
          const rz = zb.z - z - 0.5
          const along = rx * dx + rz * dz
          if (along < 0 || along > fx.range || Math.abs(rx * dz - rz * dx) > fx.width || Math.abs(zb.y - y) > 3) continue
          zb.health -= fx.dmg
          zb.flash = 0.12
        }
        const end = new THREE.Vector3((x + 0.5 + dx * fx.range) * B, (y + 0.5) * B, (z + 0.5 + dz * fx.range) * B)
        this._effects().explode(end, 1.5)
      } else {
        // A boulder landing a way off.
        const lx = x + 0.5 + dx * fx.range
        const lz = z + 0.5 + dz * fx.range
        for (const zb of zombies) {
          if (Math.hypot(zb.x - lx, zb.z - lz) > fx.blast || Math.abs(zb.y - y) > 6) continue
          zb.health -= fx.dmg
          zb.flash = 0.12
        }
        this._effects().explode(new THREE.Vector3(lx * B, y * B, lz * B), fx.blast)
      }
      audioEngine.playExplosion?.()
      this._lastSound = 'explosion'
      return true
    }
    if (fx.kind === 'cleanser') {
      this._shieldUntil = this._time + fx.time
      this._sound('chime')
      this._msg(t('specialShielded', { s: fx.time }))
      this._burst(entry, 0x80ffd0, 14)
      return true
    }
    if (fx.kind === 'wavebell') {
      const s = this._play()
      if (!s || s._toSpawn > 0 || !(s._breakTimer > 0)) {
        if (fx.cd) st.cdUntil = 0
        this._msg(t('specialWaveBusy'))
        return true
      }
      s._breakTimer = 0.01
      s._earn(fx.coins)
      this._sound('bell')
      this._msg(t('specialWaveEarly', { n: fx.coins }))
      return true
    }
    return false
  }

  // A piano block's note: its own step of the scale, by where it sits, so
  // a row of them plays a tune.
  _playKey(entry) {
    const step = ((entry.x + entry.z) % 8 + 8) % 8
    this._lastSound = `note${SCALE[step]}`
    audioEngine.playNote?.(SCALE[step])
    this._burst(entry, 0xfff4c0, 3)
  }

  // Protected from every hit right now (Infection Cleanser).
  shielded() {
    return this.active && this._shieldUntil > this._time
  }

  // A zombie died (BuildSurvival.damageZombie): cursed ones pay extra.
  onKill(zb) {
    if (!this.active || !zb.cursed) return
    this.bm.survival?._earn?.(zb.cursed)
  }

  // A shot was fired (BuildSurvival.shoot): Echo Stones near you repeat
  // it a moment later and pull zombies to themselves for a moment.
  onShot(pos) {
    if (!this.active) return
    for (const e of this.kind('echo')) {
      if (dist3(pos, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.hear) continue
      const st = this._state(e)
      if (st.echoAt > this._time) continue
      st.echoAt = this._time + e.def.fx.delay
    }
  }

  _useCrop(entry, st) {
    const fx = entry.def.fx
    if (st.plantedAt === undefined) {
      st.plantedAt = this._time
      this._sound('pop')
      this._msg(t('specialCropPlanted', { s: fx.grow }))
      this._overlaysDirty = true
      return true
    }
    const left = st.plantedAt + fx.grow - this._time
    if (left > 0) {
      this._msg(t('specialCropGrowing', { s: Math.ceil(left) }))
      return true
    }
    st.plantedAt = undefined
    const play = this._play()
    const kept = play?.inv ? fx.n - play.inv.add({ kind: 'item', id: fx.give, n: fx.n }) : 0
    this._sound('pop')
    this._msg(play ? t('specialCropHarvest', { n: kept }) : t('specialCropHarvestTry'))
    this._burst(entry, 0x7ad04a, 8)
    return true
  }

  // ---- zombies (BuildSurvival, on the host) ----

  // Where this zombie should walk instead of at its player, or null. A
  // returned target is `idle` (no biting from afar) and `lure` (walked to
  // straight, not by the player's path field).
  zombieTarget(zb, target) {
    if (!this.active) return null
    // Pushed off by repellers (and shields that are up) first.
    for (const e of this._repellers()) {
      const cx = e.x + 0.5
      const cz = e.z + 0.5
      const d = Math.hypot(zb.x - cx, zb.z - cz)
      if (d < e.def.fx.r + 1 && Math.abs(zb.y - e.y) < 6) {
        const k = (e.def.fx.r + 3) / (d || 1)
        return { x: cx + (zb.x - cx) * k, y: zb.y, z: cz + (zb.z - cz) * k, idle: true, lure: true }
      }
    }
    // Near a Silence Block you can't be heard: zombies far off lose you.
    if (target && !target.lure) {
      for (const e of this.kind('silence')) {
        if (dist3(target, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.r) continue
        if (Math.hypot(target.x - zb.x, target.z - zb.z) > e.def.fx.hear) return { x: zb.x, y: zb.y, z: zb.z, idle: true, lure: true }
      }
    }
    // Inside a smoke cloud you can't be seen from outside it.
    if (target && !target.lure) {
      for (const e of this.kind('smoke')) {
        if (!(this._st.get(e.key)?.until > this._time)) continue
        const r = e.def.fx.r
        if (dist3(target, e.x + 0.5, e.y, e.z + 0.5) <= r && dist3(zb, e.x + 0.5, e.y, e.z + 0.5) > r) return { x: zb.x, y: zb.y, z: zb.z, idle: true, lure: true }
      }
    }
    let best = null
    let bestD = Infinity
    for (const e of this.kind('echo')) {
      if (!(this._st.get(e.key)?.until > this._time)) continue
      const d = dist3(zb, e.x + 0.5, e.y, e.z + 0.5)
      if (d <= e.def.fx.r && d < bestD) {
        best = e
        bestD = d
      }
    }
    for (const e of this.kind('lure')) {
      const fx = e.def.fx
      if (fx.on === 'use' && !(this._st.get(e.key)?.until > this._time)) continue
      const d = dist3(zb, e.x + 0.5, e.y, e.z + 0.5)
      if (d > fx.r || d >= bestD) continue
      // Bait doesn't pull a zombie off someone right next to it.
      if (fx.on === 'always' && target && Math.hypot(target.x - zb.x, target.z - zb.z) < 2.5) continue
      best = e
      bestD = d
    }
    if (!best) return null
    return { x: best.x + 0.5, y: best.y, z: best.z + 0.5, idle: true, lure: true }
  }

  // Each frame for each zombie: hurts and shoves from blocks it touches.
  // Returns a speed multiplier.
  zombieTick(zb, dt) {
    if (!this.active) return 1
    let speed = 1
    // Blown back (Horn Block).
    if (zb._knock > 0) {
      const k = Math.min(dt, zb._knock)
      zb._knock -= dt
      this._push(zb, zb._kx * k, zb._kz * k)
      speed = 0
    }
    this._touching(zb, ZOMBIE_HEIGHT * (zb.size || 1), (e, dx, dz) => {
      const fx = e.def.fx
      if (fx.zdps) {
        zb.health -= fx.zdps * dt
        zb.flash = Math.max(zb.flash || 0, 0.05)
      }
      if (fx.kind === 'campfire' && !(zb.burn > 0)) zb.burn = 4
      if (fx.zspeed) speed = Math.min(speed, fx.zspeed)
      if (fx.kind === 'efence' && !(zb._zapCd > 0) && this.powered(e)) {
        zb._zapCd = fx.every
        zb.health -= fx.dmg
        zb.flash = 0.12
        const len = Math.hypot(dx, dz) || 1
        zb._knock = 0.25
        zb._kx = (dx / len) * (fx.push / 0.25)
        zb._kz = (dz / len) * (fx.push / 0.25)
        this._sound('zap')
        this._burst(e, 0x80c0ff, 5)
      }
      if (fx.kind === 'conveyor' && Math.floor(zb.y + 0.01) === e.y) {
        const [cx, cz] = this._facingDir(e)
        this._push(zb, cx * fx.speed * dt, cz * fx.speed * dt)
      }
      if (fx.kind === 'ice' && !(zb._slipCd > 0)) {
        zb._slipCd = fx.every
        zb._held = fx.fall
      }
      if (fx.kind === 'flamejet' && this._jetOn(e)) zb.burn = Math.max(zb.burn || 0, fx.burn)
      if (fx.kind === 'trap' || fx.trap) {
        const st = this._state(e)
        if (!(st.cdUntil > this._time)) {
          st.cdUntil = this._time + fx.cd
          if (fx.hold) zb._held = fx.hold
          if (fx.burn) zb.burn = Math.max(zb.burn || 0, fx.burn)
          if (fx.blast) this._explode(e, fx)
          else if (fx.dmg) zb.health -= fx.dmg
          zb.flash = 0.12
          if (!fx.blast) this._sound(fx.sound || 'clank')
          this._burst(e, 0xd0d0d8, 6)
        }
      }
      if (fx.kind === 'shove') {
        // Back the way it came, away from the block's middle.
        const len = Math.hypot(dx, dz) || 1
        this._push(zb, (dx / len) * fx.push * dt, (dz / len) * fx.push * dt)
        speed = Math.min(speed, 0.3)
      }
    })
    // Blocks that work on every zombie near them.
    for (const e of this.kind('zaura')) {
      const fx = e.def.fx
      if (dist3(zb, e.x + 0.5, e.y, e.z + 0.5) > fx.r) continue
      if (fx.slow) speed = Math.min(speed, fx.slow)
      if (fx.dps) {
        zb.health -= fx.dps * dt
        zb.flash = Math.max(zb.flash || 0, 0.05)
      }
      if (fx.curse && !zb.cursed) {
        zb.cursed = fx.coins
        zb.health *= fx.curse
        zb.maxHealth *= fx.curse
      }
    }
    if (zb._slipCd > 0) zb._slipCd -= dt
    if (zb._zapCd > 0) zb._zapCd -= dt
    // Held in place (Cage).
    if (zb._held > 0) {
      zb._held -= dt
      speed = 0
    }
    // A repeller's ring is a wall to zombies.
    for (const e of this._repellers()) {
      const cx = e.x + 0.5
      const cz = e.z + 0.5
      const d = Math.hypot(zb.x - cx, zb.z - cz)
      const r = e.def.fx.r
      if (d < r && Math.abs(zb.y - e.y) < 6) {
        const push = Math.min(r - d, (e.def.fx.push || 4) * dt)
        this._push(zb, ((zb.x - cx) / (d || 1)) * push, ((zb.z - cz) / (d || 1)) * push)
      }
    }
    return speed
  }

  // A mine going off: every zombie within fx.blast blocks takes fx.dmg.
  _explode(e, fx) {
    const s = this.bm.survival
    const B = this.B
    for (const zb of s?.active ? s.zombies : []) {
      if (dist3(zb, e.x + 0.5, e.y, e.z + 0.5) > fx.blast) continue
      zb.health -= fx.dmg
      zb.flash = 0.12
    }
    this._effects().explode(new THREE.Vector3((e.x + 0.5) * B, e.y * B, (e.z + 0.5) * B), fx.blast)
    audioEngine.playExplosion?.()
    this._lastSound = 'explosion'
  }

  // ---- power (generators, wires, sensors, gates) ----

  // Which power blocks are on, every POWER_STEP. Levers that are on and
  // pressed plates count as power too. Doors near a source open while it's
  // on, like they do for a lever.
  _tickPower(me, zombies, elapsed) {
    const now = this._time
    const night = (this.bm.sky?.nightAmount?.() ?? 0) > 0.5
    const on = new Set()
    const sources = [] // [x, y, z] of everything giving power
    const g = this.bm.gadgets
    for (const key of g.leverOn) sources.push(key.split(',').map(Number))
    for (const key of g._plateDown.keys()) sources.push(key.split(',').map(Number))
    const power = this.kind('power')
    const bySrc = (src) => [...power].filter((e) => e.def.fx.src === src)
    for (const e of power) {
      const fx = e.def.fx
      const st = this._state(e)
      let lit = false
      if (fx.src === 'generator') lit = !!st.on
      else if (fx.src === 'solar') lit = !night
      else if (fx.src === 'light') lit = night
      else if (fx.src === 'button') lit = st.until > now
      else if (fx.src === 'timer') lit = (now + (e.x + e.z) * 0.1) % fx.every < fx.pulse
      else if (fx.src === 'motion') {
        const near = (p) => p && dist3(p, e.x + 0.5, e.y, e.z + 0.5) <= fx.r
        lit = near(me) || zombies.some(near)
      }
      if (lit) {
        on.add(e.key)
        sources.push([e.x, e.y, e.z])
      }
    }
    const reaches = (e, [x, y, z]) => !(x === e.x && y === e.y && z === e.z) && Math.hypot(x - e.x, y - e.y, z - e.z) <= LINK_RANGE
    // Batteries charge from any power near them and give it back later.
    for (const e of bySrc('battery')) {
      const st = this._state(e)
      const fed = sources.some((c) => reaches(e, c))
      st.charge = fed ? e.def.fx.hold : Math.max(0, (st.charge || 0) - elapsed)
      if (st.charge > 0) {
        on.add(e.key)
        if (!fed) sources.push([e.x, e.y, e.z])
      }
    }
    // Logic gates count the power around them.
    for (const e of bySrc('gate')) {
      const n = sources.filter((c) => reaches(e, c)).length
      const mode = GATE_MODES[this._state(e).mode || 0]
      if (mode === 'AND' ? n >= 2 : mode === 'OR' ? n >= 1 : n === 0) on.add(e.key)
    }
    for (const e of bySrc('gate')) if (on.has(e.key)) sources.push([e.x, e.y, e.z])
    // Wires carry it along: a wire touching power (or a powered wire) is on.
    const wires = bySrc('wire')
    let grew = true
    while (grew) {
      grew = false
      for (const e of wires) {
        if (on.has(e.key)) continue
        if (sources.some(([x, y, z]) => Math.abs(x - e.x) <= 1 && Math.abs(y - e.y) <= 1 && Math.abs(z - e.z) <= 1 && !(x === e.x && y === e.y && z === e.z))) {
          on.add(e.key)
          sources.push([e.x, e.y, e.z])
          grew = true
        }
      }
    }
    // Doors near a source that just switched.
    for (const e of power) {
      if (e.def.fx.src === 'wire' || on.has(e.key) === this._on.has(e.key)) continue
      g.setDoorsNear(e.x, e.y, e.z, on.has(e.key))
    }
    this._on = on
    this._sources = sources
  }

  // True when power reaches this block (within LINK_RANGE of anything on).
  powered(e) {
    return (this._sources || []).some(([x, y, z]) => !(x === e.x && y === e.y && z === e.z) && Math.hypot(x - e.x, y - e.y, z - e.z) <= LINK_RANGE)
  }

  // Nothing solid between a block's middle and a zombie's chest.
  _clearLine(e, zb) {
    const ax = e.x + 0.5
    const ay = e.y + 0.5
    const az = e.z + 0.5
    const bx = zb.x
    const by = zb.y + 1.2
    const bz = zb.z
    const n = Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) * 3)
    for (let i = 1; i < n; i++) {
      const k = i / n
      const x = Math.floor(ax + (bx - ax) * k)
      const y = Math.floor(ay + (by - ay) * k)
      const z = Math.floor(az + (bz - az) * k)
      if (x === e.x && y === e.y && z === e.z) continue
      if (this.bm.getBlockAt(x, y, z)) return false
    }
    return true
  }

  // A line of sparks from a block to a zombie (a shot).
  _trail(e, zb, color) {
    const B = this.B
    const n = 8
    for (let i = 0; i < n; i++) {
      const k = i / n
      this._effects().spark((e.x + 0.5 + (zb.x - e.x - 0.5) * k) * B, (e.y + 0.6 + (zb.y + 1.2 - e.y - 0.6) * k) * B, (e.z + 0.5 + (zb.z - e.z - 0.5) * k) * B, { color, life: 0.25, from: 0.15, to: 0.05 })
    }
  }

  // ---- machines (batch 7) ----

  // Extra damage a zombie takes (lit by a Searchlight).
  zombieHurtMult(zb) {
    return this.active && zb._litUntil > this._time ? SEARCHLIGHT_MULT : 1
  }

  // Puts back one block broken during this try within reach of a Repair
  // Station (not the open world's own land, not where you stand).
  _repairNear(e) {
    const bm = this.bm
    const tm = bm.tryMode
    const p = tm.pos
    for (const [key, b] of tm._broken || []) {
      if (b.terrain || dist3(b, e.x, e.y, e.z) > e.def.fx.r || bm.getBlockAt(b.x, b.y, b.z)) continue
      if (Math.floor(p.x) === b.x && Math.floor(p.z) === b.z && b.y >= Math.floor(p.y) && b.y <= Math.floor(p.y + 1.7)) continue
      bm._suppressUndoRecording = true
      bm.placeBlock(b.x, b.y, b.z, b.type, false, b.state)
      bm._suppressUndoRecording = false
      tm._broken.delete(key)
      this._burst({ x: b.x, y: b.y - 0.5, z: b.z }, 0x80ff90, 6)
      this._sound('pop')
      return true
    }
    return false
  }

  // Opens a gate: it and every gate block joined to it go away (powered:
  // until the power stops; used: for fx.open seconds).
  _openGate(e, byPower = false) {
    const bm = this.bm
    const group = []
    const seen = new Set([e.key])
    const todo = [e]
    while (todo.length && group.length < 64) {
      const g = todo.pop()
      group.push(g)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = this.entryAt(g.x + dx, g.y + dy, g.z + dz)
        if (n && n.type === e.type && !seen.has(n.key)) {
          seen.add(n.key)
          todo.push(n)
        }
      }
    }
    const cells = group.map(({ x, y, z, type }) => ({ x, y, z, type }))
    bm._suppressUndoRecording = true
    for (const c of cells) bm.removeBlock(c.x, c.y, c.z)
    bm._suppressUndoRecording = false
    this._gates.push({ cells, anchor: { x: e.x, y: e.y, z: e.z, key: e.key }, byPower, closeAt: this._time + e.def.fx.open })
    this._sound('clank')
  }

  _closeGates(all = false) {
    if (!this._gates?.length) return
    const bm = this.bm
    const p = bm.tryMode.pos
    this._gates = this._gates.filter((g) => {
      if (!all && (g.byPower ? this.powered(g.anchor) : g.closeAt > this._time)) return true
      const blocked = g.cells.some((c) => Math.floor(p.x) === c.x && Math.floor(p.z) === c.z && c.y >= Math.floor(p.y) && c.y <= Math.floor(p.y + 1.7))
      if (blocked && !all) return true
      bm._suppressUndoRecording = true
      for (const c of g.cells) if (!bm.getBlockAt(c.x, c.y, c.z)) bm.placeBlock(c.x, c.y, c.z, c.type)
      bm._suppressUndoRecording = false
      return false
    })
  }

  // A piston's kick: pushes (or, sticky, pulls) zombies - and you - near it.
  _pistonKick(e, me) {
    const fx = e.def.fx
    const s = this.bm.survival
    const sign = fx.pull ? -1 : 1
    for (const zb of s?.active ? s.zombies : []) {
      const dx = zb.x - e.x - 0.5
      const dz = zb.z - e.z - 0.5
      const d = Math.hypot(dx, dz)
      if (d > fx.r || Math.abs(zb.y - e.y) > 2) continue
      zb._knock = 0.3
      zb._kx = sign * (dx / (d || 1)) * (Math.min(fx.push, fx.pull ? d - 1 : fx.push) / 0.3)
      zb._kz = sign * (dz / (d || 1)) * (Math.min(fx.push, fx.pull ? d - 1 : fx.push) / 0.3)
    }
    if (me && !fx.pull && Math.hypot(me.x - e.x - 0.5, me.z - e.z - 0.5) <= fx.r * 0.6) {
      const tm = this.bm.tryMode
      const dx = me.x - e.x - 0.5
      const dz = me.z - e.z - 0.5
      const d = Math.hypot(dx, dz) || 1
      tm.vel.x += (dx / d) * 12
      tm.vel.z += (dz / d) * 12
      tm.vel.y = Math.max(tm.vel.y, 5)
    }
    this._sound('thud')
    this._burst(e, 0xc0c0c0, 6)
  }

  // Moves a zombie sideways, stopping at walls.
  _push(zb, dx, dz) {
    const s = this.bm.survival
    if (s?._moveZombieAxis) {
      s._moveZombieAxis(zb, 'x', dx)
      s._moveZombieAxis(zb, 'z', dz)
    } else {
      zb.x += dx
      zb.z += dz
    }
  }

  // Which way a faced block (a conveyor) points: [dx, dz].
  _facingDir(e) {
    const a = (this.bm._stairFacing.get(e.key) || 0) * (Math.PI / 2)
    return [-Math.round(Math.sin(a)), -Math.round(Math.cos(a))]
  }

  // Repellers, plus Shield Generators while their bubble is up.
  _repellers() {
    const out = [...this.kind('repel')]
    for (const e of this.kind('shieldgen')) if (this._st.get(e.key)?.until > this._time) out.push(e)
    for (const e of this.kind('fan')) if (!e.def.fx.power || this.powered(e)) out.push(e)
    return out
  }

  // How much of a hit gets through: crouching right by a sandbag takes less.
  hurtMult() {
    if (!this.active || !this.bm.tryMode._crouch) return 1
    const p = this.bm.tryMode.pos
    let mult = 1
    for (const e of this.kind('sandbag')) {
      if (Math.hypot(p.x - e.x - 0.5, p.z - e.z - 0.5) <= e.def.fx.r && Math.abs(p.y - e.y) < 2) mult = Math.min(mult, e.def.fx.mult)
    }
    return mult
  }

  // Calls fn(entry, dx, dz) for each special block touching a body (feet
  // at pos, `height` tall); dx/dz point from the block's middle to it.
  _touching(pos, height, fn) {
    const x0 = Math.floor(pos.x - 0.75)
    const x1 = Math.floor(pos.x + 0.75)
    const z0 = Math.floor(pos.z - 0.75)
    const z1 = Math.floor(pos.z + 0.75)
    const y0 = Math.floor(pos.y) - 1
    const y1 = Math.floor(pos.y + height)
    const blocks = this.bm._blocks
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
          const type = blocks.at(x, y, z)
          if (!type || !SPECIAL_BY_ID.has(type)) continue
          const ex = Math.max(x - pos.x, 0, pos.x - (x + 1))
          const ez = Math.max(z - pos.z, 0, pos.z - (z + 1))
          const ey = Math.max(y - (pos.y + height), 0, pos.y - (y + 1))
          if (Math.hypot(ex, ey, ez) > TOUCH) continue
          const entry = this._at.get(`${x},${y},${z}`)
          if (entry) fn(entry, pos.x - (x + 0.5), pos.z - (z + 0.5))
        }
      }
    }
  }

  // ---- looks: particles, overlays, floating text ----

  _burst(entry, color, n) {
    const fx = this._effects()
    const B = this.B
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3).multiplyScalar(B)
      fx.spark((entry.x + 0.5) * B, (entry.y + 1) * B, (entry.z + 0.5) * B, { color, life: 0.6 + Math.random() * 0.4, from: 0.35, to: 0.05, vel: v })
    }
  }

  // Little ongoing effects for blocks near you (every ~0.12 s).
  _emitLooks(me) {
    const B = this.B
    const near = (e) => (e.x - me.x) ** 2 + (e.z - me.z) ** 2 < 32 * 32
    for (const e of this.kind('campfire')) {
      if (!near(e)) continue
      this._effects().flame((e.x + 0.3 + Math.random() * 0.4) * B, (e.y + 1.05) * B, (e.z + 0.3 + Math.random() * 0.4) * B)
    }
    for (const e of this.kind('smoke')) {
      if (!(this._st.get(e.key)?.until > this._time) || !near(e)) continue
      const r = e.def.fx.r
      for (let i = 0; i < 3; i++) this._effects().smoke((e.x + 0.5 + (Math.random() - 0.5) * r * 1.6) * B, (e.y + 0.5 + Math.random() * 2) * B, (e.z + 0.5 + (Math.random() - 0.5) * r * 1.6) * B)
    }
    for (const e of this.kind('shieldgen')) {
      if (!(this._st.get(e.key)?.until > this._time) || !near(e)) continue
      const a = Math.random() * Math.PI * 2
      const r = e.def.fx.r
      this._effects().spark((e.x + 0.5 + Math.cos(a) * r) * B, (e.y + 0.5 + Math.random() * 2.5) * B, (e.z + 0.5 + Math.sin(a) * r) * B, { color: 0x60c8ff, life: 0.6, from: 0.3, to: 0.1 })
    }
    for (const e of this.kind('flamejet')) {
      if (!near(e) || !this._jetOn(e)) continue
      for (let i = 0; i < 2; i++) this._effects().flame((e.x + 0.2 + Math.random() * 0.6) * B, (e.y + 1) * B, (e.z + 0.2 + Math.random() * 0.6) * B)
    }
    for (const e of this.kind('zaura')) {
      if (!near(e) || Math.random() < 0.7) continue
      const v = new THREE.Vector3(0, 0.6 * B, 0)
      this._effects().spark((e.x + Math.random()) * B, (e.y + 1) * B, (e.z + Math.random()) * B, { color: e.def.fx.tint, life: 1, from: 0.2, to: 0.05, vel: v })
    }
    if (this.shielded() && me) this._effects().spark(me.x * B, (me.y + 1 + Math.random()) * B, me.z * B, { color: 0x80ffd0, life: 0.5, from: 0.25, to: 0.05 })
    for (const e of this.kind('teleport')) {
      if (!near(e) || Math.random() < 0.6) continue
      const v = new THREE.Vector3(0, 1.2 * B, 0)
      this._effects().spark((e.x + 0.2 + Math.random() * 0.6) * B, (e.y + 0.1) * B, (e.z + 0.2 + Math.random() * 0.6) * B, { color: 0xc08aff, life: 0.9, from: 0.18, to: 0.04, vel: v })
    }
    for (const e of this.kind('lure')) {
      if (e.def.fx.on !== 'use' || !(this._st.get(e.key)?.until > this._time) || !near(e)) continue
      if (Math.random() < 0.5) this._burst(e, 0xffe08a, 1)
    }
  }

  // Which blocks get an overlay (disco glow, crop sprouts, floating text):
  // the nearest MAX_OVERLAYS within OVERLAY_RANGE.
  _pickOverlays(me) {
    const want = []
    for (const kind of ['disco', 'crop', 'score', 'radio', 'lure', 'counter', 'blade', 'power', 'turret', 'searchlight']) {
      for (const e of this.kind(kind)) {
        if (kind === 'lure' && !e.def.fx.label) continue
        const d = (e.x - me.x) ** 2 + (e.y - me.y) ** 2 + (e.z - me.z) ** 2
        if (d < OVERLAY_RANGE * OVERLAY_RANGE) want.push([d, e])
      }
    }
    want.sort((a, b) => a[0] - b[0])
    const keep = new Set(want.slice(0, MAX_OVERLAYS).map(([, e]) => e.key))
    for (const key of [...this._overlays.keys()]) if (!keep.has(key)) this._dropOverlay(key)
    for (const [, e] of want.slice(0, MAX_OVERLAYS)) if (!this._overlays.has(e.key)) this._makeOverlay(e)
  }

  _makeOverlay(e) {
    const B = this.B
    const kind = e.def.fx.kind
    let obj = null
    if (kind === 'disco' || kind === 'power') {
      obj = new THREE.Mesh(sharedBox(), new THREE.MeshBasicMaterial({ color: kind === 'power' ? 0xffe040 : 0xffffff, transparent: true, opacity: kind === 'power' ? 0.3 : 0.4, depthWrite: false }))
      obj.scale.setScalar(1.02 * B)
      obj.position.set((e.x + 0.5) * B, (e.y + 0.5) * B, (e.z + 0.5) * B)
    } else if (kind === 'blade') {
      // A long steel bar spinning over the block.
      obj = new THREE.Mesh(sharedBox(), new THREE.MeshLambertMaterial({ color: 0xc8ccd4 }))
      obj.scale.set(e.def.fx.r * 2 * B, 0.06 * B, 0.16 * B)
      obj.position.set((e.x + 0.5) * B, (e.y + 1.4) * B, (e.z + 0.5) * B)
    } else if (kind === 'crop') {
      obj = new THREE.Group()
      const mat = new THREE.MeshBasicMaterial({ color: 0x5aa83a, side: THREE.DoubleSide })
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(sharedPlane(), mat)
        leaf.position.set(((i % 3) - 1) * 0.28 * B, 0.5 * B, (Math.floor(i / 3) - 0.5) * 0.4 * B)
        leaf.rotation.y = i * 1.1
        obj.add(leaf)
      }
      obj.position.set((e.x + 0.5) * B, (e.y + 1) * B, (e.z + 0.5) * B)
      obj.userData.mat = mat
    } else if (kind === 'searchlight') {
      // A pale beam sweeping round.
      const geo = new THREE.CylinderGeometry(0.05, 1, 1, 10, 1, true)
      geo.rotateZ(Math.PI / 2)
      geo.translate(0.5, 0, 0)
      obj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }))
      obj.scale.set(e.def.fx.r * B, 2 * B, 2 * B)
      obj.position.set((e.x + 0.5) * B, (e.y + 1.1) * B, (e.z + 0.5) * B)
    } else if (kind === 'score' || kind === 'radio' || kind === 'counter' || kind === 'turret' || e.def.fx.label) {
      obj = textSprite()
      obj.position.set((e.x + 0.5) * B, (e.y + 1.7) * B, (e.z + 0.5) * B)
      obj.scale.set(3 * B, 0.75 * B, 1)
    }
    if (!obj) return
    obj.userData.entry = e
    this._group?.add(obj)
    this._overlays.set(e.key, obj)
  }

  _dropOverlay(key) {
    const obj = this._overlays?.get(key)
    if (!obj) return
    this._overlays.delete(key)
    obj.parent?.remove(obj)
    obj.traverse((o) => {
      if (o.material && o.material !== obj.userData.mat) {
        o.material.map?.dispose()
        o.material.dispose()
      }
    })
    obj.userData.mat?.dispose()
  }

  _updateOverlays() {
    if (!this._overlays) return
    const play = this._play() || (this.bm.survival?.active ? this.bm.survival : null)
    for (const obj of this._overlays.values()) {
      const e = obj.userData.entry
      const kind = e.def.fx.kind
      if (kind === 'power') {
        obj.visible = this._on.has(e.key)
      } else if (kind === 'searchlight') {
        obj.visible = this.powered(e)
        obj.rotation.y = this._time * 0.8
      } else if (kind === 'turret') {
        setSpriteText(obj, t('specialTurretAmmo', { n: this._st.get(e.key)?.ammo ?? e.def.fx.start }))
      } else if (kind === 'blade') {
        obj.rotation.y = this._time * Math.PI * 2 / e.def.fx.every
      } else if (kind === 'disco') {
        obj.material.color.setHSL((this._time * 0.35 + (e.x + e.z) * 0.07) % 1, 0.9, 0.55)
      } else if (kind === 'crop') {
        const st = this._st.get(e.key)
        const k = st?.plantedAt === undefined ? 0 : Math.min(1, (this._time - st.plantedAt) / e.def.fx.grow)
        obj.visible = k > 0
        obj.scale.setScalar(0.25 + k * 0.75)
        obj.userData.mat.color.setHex(k >= 1 ? 0xd8c040 : 0x5aa83a)
      } else if (kind === 'counter') {
        const r2 = e.def.fx.r ** 2
        const n = (this.bm.survival?.active ? this.bm.survival.zombies : []).filter((zb) => (zb.x - e.x - 0.5) ** 2 + (zb.z - e.z - 0.5) ** 2 < r2).length
        setSpriteText(obj, t('specialZombieCount', { n }))
      } else if (kind === 'radio') {
        const n = this._st.get(e.key)?.station
        obj.visible = !!n
        if (n) setSpriteText(obj, `\u266A ${t('specialRadioOn', { n })}`)
      } else if (e.def.fx.label) {
        obj.visible = this._st.get(e.key)?.until > this._time
        if (obj.visible) setSpriteText(obj, t(e.def.fx.label))
      } else if (kind === 'score') {
        let text
        if (play) text = t('specialScore', { wave: play.wave || 0, kills: play.kills || 0 })
        else text = t('specialScoreBest', { n: this._bestWave() })
        setSpriteText(obj, text)
      }
    }
  }

  _bestWave() {
    if (this._bestRead !== undefined) return this._bestRead
    try {
      const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}')
      this._bestRead = all[String(this.bm.activeSlot)] || 0
    } catch {
      this._bestRead = 0
    }
    return this._bestRead
  }
}

const EMPTY = new Set()
const SEARCHLIGHT_MULT = 1.25
const POWER_STEP = 0.1 // seconds between power updates
const GATE_MODES = ['AND', 'OR', 'NOT']
// Kinds that do something when used (plus lures with on: 'use').
const USE_KINDS = new Set(['turret', 'gate', 'power', 'crop', 'doorbell', 'radio', 'horn', 'piano', 'cleanser', 'wavebell', 'smoke', 'shieldgen', 'watchtower', 'oilpot', 'cannon', 'catapult'])
// Piano Block notes: a major scale from middle C.
const SCALE = [262, 294, 330, 349, 392, 440, 494, 523]

function dist3(p, x, y, z) {
  return Math.hypot(p.x - x, p.y - y, p.z - z)
}

let _box = null
function sharedBox() {
  return _box || (_box = new THREE.BoxGeometry(1, 1, 1))
}

let _plane = null
function sharedPlane() {
  if (!_plane) {
    _plane = new THREE.PlaneGeometry(0.12, 0.5)
    _plane.translate(0, 0, 0)
  }
  return _plane
}

// A floating label (canvas sprite) whose words change now and then.
function textSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.userData.canvas = canvas
  sprite.userData.text = null
  return sprite
}

function setSpriteText(sprite, text) {
  if (sprite.userData.text === text) return
  sprite.userData.text = text
  const canvas = sprite.userData.canvas
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.font = 'bold 54px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = Math.min(canvas.width - 8, ctx.measureText(text).width + 40)
  ctx.fillStyle = 'rgba(20, 18, 24, 0.72)'
  ctx.fillRect((canvas.width - w) / 2, 14, w, 100)
  ctx.fillStyle = '#7af07a'
  ctx.fillText(text, canvas.width / 2, 66, canvas.width - 24)
  sprite.material.map.needsUpdate = true
}

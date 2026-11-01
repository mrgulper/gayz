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
import { ITEMS, ARMOR_SLOTS } from './PlayInventory.js'

const OVERLAY_RANGE = 48 // blocks: look effects (disco, crops, text) only this near you
const OVERLAY_REFRESH = 2 // seconds between re-picking which blocks get them
const MAX_OVERLAYS = 64
const PLAYER_HEIGHT = 1.8
const ZOMBIE_HEIGHT = 2
const TOUCH = 0.4 // blocks between a body and a block that counts as touching
const HURT_EVERY = 0.5 // seconds: a hurting block bites you in steps, not every frame
const BEST_KEY = 'buildmode-play-best'
// Plant Fiber from each Crop Plot harvested in a game (for crafting).
const CROP_FIBER = 2

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
    this._buffs = {}
    this._bench = 0
    this._ride = null
    this._bed = null
    this._bedUsed = false
    this._gates = [] // gates standing open: { cells, anchor, byPower, closeAt }
    this._temp = [] // blocks grown this try (trees): { x, y, z, type }
    this._on = new Set() // power: keys of blocks giving power right now
    this._powerAt = -1
  }

  stop() {
    if (!this.active) return
    this._restoreCrumbled(true)
    this._closeGates(true)
    this._clearTemp()
    for (const e of this.kind('blacklight')) this._showHidden(e, false)
    this._race = null
    if (this._skyWas && this.bm.sky) {
      Object.assign(this.bm.sky, this._skyWas)
      this.bm.sky._rerollIn = 0
      this.bm.sky._pickWeather()
      this.bm.sky.apply()
    }
    this._skyWas = null
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
    this._tickBlocks(me || this._camFeet(), dt)
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
  _tickBlocks(me, dt = 0) {
    const s = this.bm.survival
    const zombies = s?.active ? s.zombies : []
    const now = this._time
    for (const e of this.kind('arcade')) {
      const st = this._st.get(e.key)
      if (st?.phase === 'wait' && st.goAt <= now) {
        st.phase = 'now'
        st.show = t('specialArcadeNow')
        this._sound('chime')
      }
    }
    for (const e of this.kind('countdown')) {
      const st = this._st.get(e.key)
      if (!st?.goAt || st.until < now) continue
      const left = Math.ceil(st.goAt - now)
      st.show = left > 0 ? String(left) : t('specialGo')
      if (left < st.beeped) {
        st.beeped = left
        this._sound(left > 0 ? 'pop' : 'bell')
      }
    }
    // Crops grow (faster by sprinklers and under greenhouse glass).
    for (const e of this.kind('crop')) {
      const st = this._st.get(e.key)
      if (st?.planted && st.grown < e.def.fx.grow) st.grown += dt * this._growRate(e)
    }
    // Saplings grow into trees while you play.
    for (const e of this.kind('sapling')) {
      const st = this._state(e)
      if (st.grownTree || !s?.active) continue
      st.age = (st.age || 0) + dt
      if (st.age >= e.def.fx.grow) {
        st.grownTree = true
        this._growTree(e)
      }
    }
    // Rain Collectors fill while it rains on them.
    for (const e of this.kind('rain')) {
      const st = this._state(e)
      if ((st.level || 0) >= e.def.fx.max || !this._rainingOn(e)) continue
      st.fill = (st.fill || 0) + dt
      if (st.fill >= e.def.fx.every) {
        st.fill = 0
        st.level = (st.level || 0) + 1
      }
    }
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
    const tm = this.bm.tryMode
    // Riding a zipline: carried along the line, nothing else.
    if (this._ride) {
      const r = this._ride
      r.t = Math.min(1, r.t + dt / r.dur)
      const sag = Math.sin(r.t * Math.PI) * r.sag
      tm.pos.set(r.from.x + (r.to.x - r.from.x) * r.t, r.from.y + (r.to.y - r.from.y) * r.t - sag, r.from.z + (r.to.z - r.from.z) * r.t)
      tm.vel.set(0, 0, 0)
      if (r.t >= 1) this._ride = null
      return
    }
    // Fan Blocks blow you away from them (not into walls).
    for (const e of this.kind('fan')) {
      if (!e.def.fx.you) continue
      const dx = me.x - e.x - 0.5
      const dz = me.z - e.z - 0.5
      const d = Math.hypot(dx, dz)
      if (d > e.def.fx.r || Math.abs(me.y - e.y) > 2) continue
      const k = (e.def.fx.push * dt) / (d || 1)
      const nx = tm.pos.x + dx * k
      const nz = tm.pos.z + dz * k
      if (!tm._hits(nx, tm.pos.y, nz)) tm.pos.set(nx, tm.pos.y, nz)
    }
    // Gravity Flip: near it you fall upward.
    for (const e of this.kind('gravity')) {
      if (Math.hypot(me.x - e.x - 0.5, me.z - e.z - 0.5) > e.def.fx.r || me.y < e.y || me.y > e.y + e.def.fx.h) continue
      tm.vel.y = Math.min(e.def.fx.max, tm.vel.y + e.def.fx.pull * dt)
      tm.onGround = false
    }
    // Wind Tunnels float you up the column above them.
    for (const e of this.kind('tunnel')) {
      if (Math.abs(me.x - e.x - 0.5) > 0.8 || Math.abs(me.z - e.z - 0.5) > 0.8) continue
      if (me.y < e.y + 0.9 || me.y > e.y + 1 + e.def.fx.h) continue
      tm.vel.y = Math.max(tm.vel.y, me.y > e.y + e.def.fx.h ? 0 : e.def.fx.lift)
      tm.onGround = false
    }
    this._prevVy = this._lastVy || 0
    this._lastVy = tm.vel.y
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
    // Walking on it: sticky, slippery... (and a speed boost on top).
    const ufx = (under || pad)?.def.fx
    this.speedMult = (ufx?.pspeed ?? 1) * (this._buff('speed') || 1)
    this.gripMult = ufx?.pgrip ?? 1
    // Fired from a Launch Cannon: keep flying until you land.
    if (this._launched) {
      if (tm.onGround && this._time > this._launched) this._launched = 0
      else this.gripMult = 0.02
    }
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
    // Sauna Stones build up armor while you sit by them.
    if (play) {
      for (const e of this.kind('sauna')) {
        if (dist3(me, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.r || (play.armor || 0) >= e.def.fx.max) continue
        play.armor = Math.min(e.def.fx.max, (play.armor || 0) + e.def.fx.rate * dt)
        play._renderHud()
        break
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
    const sfx = entry.def.fx
    if (sfx.kind === 'body') {
      // Growing back needs room overhead.
      this._setBuff(sfx.buff, sfx.size, sfx.time)
      this._sound(sfx.buff === 'shrink' ? 'pop' : 'hum')
      this._msg(t(sfx.buff === 'shrink' ? 'specialShrunk' : 'specialGrown', { s: sfx.time }))
      this._burst(entry, sfx.buff === 'shrink' ? 0xff80d0 : 0x80ff80, 10)
      return
    }
    if (sfx.kind === 'invisible' && !(this._invisCd > this._time)) {
      this._setBuff('invisible', 1, sfx.time)
      this._invisCd = this._time + sfx.cd
      this._sound('whoosh')
      this._msg(t('specialInvisible', { s: sfx.time }))
      return
    }
    if (sfx.kind === 'drum') {
      this._sound('drum')
      this._burst(entry, 0xffd080, 3)
      return
    }
    if (sfx.kind === 'race') {
      this._raceLine(entry)
      return
    }
    if (sfx.kind === 'checkpoint') {
      this._setCheckpoint(entry)
      return
    }
    if (sfx.kind === 'portal' && !(this._portalCd > this._time)) {
      const others = [...this.kind('portal')].filter((e) => e !== entry)
      if (!others.length) return
      const dest = others[Math.floor(Math.random() * others.length)]
      const tm = this.bm.tryMode
      tm.pos.set(dest.x + 0.5, dest.y + 1, dest.z + 0.5)
      tm.vel.set(0, 0, 0)
      this._onUnderKey = dest.key
      this._portalCd = this._time + sfx.cd
      this._sound('whoosh')
      this._burst(dest, 0x60f0c0, 14)
      return
    }
    if (sfx.kind === 'bounce') {
      const tm = this.bm.tryMode
      tm.vel.y = Math.max(sfx.min, -(this._prevVy || 0) * sfx.keep)
      tm.onGround = false
      this._sound('pop')
      return
    }
    if (sfx.kind === 'boost') {
      if (sfx.speed) this._setBuff('speed', sfx.speed, sfx.time)
      if (sfx.jump) {
        const tm = this.bm.tryMode
        tm.vel.y = sfx.jump
        tm.onGround = false
      }
      this._sound('whoosh')
      this._burst(entry, sfx.speed ? 0x60f0ff : 0x90ff60, 8)
      return
    }
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
    if (fx.kind === 'drum') {
      this._sound('drum')
      return true
    }
    if (fx.kind === 'weather' || fx.kind === 'daynight') {
      const sky = this.bm.sky
      if (!sky) return false
      // Put back as it was when the try ends (not saved as your pick).
      if (!this._skyWas) this._skyWas = { time: sky.time, weather: sky.weather }
      if (fx.kind === 'weather') {
        const i = (fx.list.indexOf(sky._now) + 1) % fx.list.length
        sky.weather = fx.list[i]
        sky._rerollIn = 0
        sky._pickWeather()
      } else {
        sky.time = sky.nightAmount() > 0.5 ? 'day' : 'night'
        sky._clock = 0
      }
      sky.apply()
      this._sound('chime')
      return true
    }
    if (fx.kind === 'dice') {
      st.show = String(1 + Math.floor(Math.random() * 6))
      st.until = this._time + 4
      this._sound('pop')
      this._msg(t('specialDice', { n: st.show }))
      return true
    }
    if (fx.kind === 'blacklight') {
      st.on = !st.on
      this._showHidden(entry, st.on)
      this._sound(st.on ? 'hum' : 'pop')
      return true
    }
    if (fx.kind === 'countdown') {
      st.goAt = this._time + fx.from
      st.until = st.goAt + 1.5
      st.beeped = fx.from + 1
      return true
    }
    if (fx.kind === 'arcade') {
      const s = this._play()
      if (st.phase === 'wait') {
        // Pressed before NOW!
        st.phase = 'done'
        st.show = t('specialArcadeEarly')
        st.until = this._time + 2
        this._sound('warn')
        return true
      }
      if (st.phase === 'now') {
        const late = this._time - st.goAt > fx.window
        st.phase = 'done'
        st.show = late ? t('specialArcadeSlow') : t('specialArcadeWin', { n: fx.coins })
        st.until = this._time + 2.5
        if (!late && s) {
          s.coins = (s.coins || 0) + fx.coins
          s._renderHud()
        }
        this._sound(late ? 'pop' : 'chime')
        return true
      }
      st.phase = 'wait'
      st.goAt = this._time + 1 + Math.random() * 2.5
      st.show = t('specialArcadeWait')
      st.until = st.goAt + 5
      this._sound('pop')
      return true
    }
    if (fx.kind === 'hoop') {
      const p = this.bm.tryMode.pos
      const d = Math.hypot(p.x - x - 0.5, p.z - z - 0.5)
      if (d < fx.min) {
        this._msg(t('specialHoopBack'))
        return true
      }
      const scored = Math.random() < Math.max(0.2, Math.min(0.9, 1.4 - d * 0.2))
      st.score = (st.score || 0) + (scored ? 1 : 0)
      st.until = this._time + 999
      this._sound(scored ? 'chime' : 'thud')
      this._msg(scored ? t('specialHoopIn', { n: st.score }) : t('specialHoopMiss'))
      return true
    }
    if (fx.kind === 'photo') {
      if (this._photo()) {
        this._sound('pop')
        this._msg(t('specialPhoto'))
      }
      return true
    }
    if (fx.kind === 'lamp') {
      st.color = ((st.color || 0) + 1) % LAMP_COLORS.length
      this._sound('pop')
      return true
    }
    if (fx.kind === 'machine') {
      st.on = !st.on
      this._sound(st.on ? 'hum' : 'pop')
      return true
    }
    if (fx.kind === 'firework' || fx.kind === 'confetti') {
      this._celebrate(entry, fx.kind)
      return true
    }
    if (fx.kind === 'hologram') {
      st.pick = ((st.pick ?? 0) + 1) % HOLO_BLOCKS.length
      this._sound('pop')
      return true
    }
    if (fx.kind === 'producer') {
      // Makes something every fx.every seconds; use it to collect.
      if (st.readyAt === undefined) st.readyAt = this._time + fx.every
      if (fx.water && !this._nearWater(entry)) {
        this._msg(t('specialNeedWater'))
        return true
      }
      if (st.readyAt > this._time) {
        this._msg(t('specialNotReady', { s: Math.ceil(st.readyAt - this._time) }))
        return true
      }
      st.readyAt = this._time + fx.every
      const s = this._play()
      if (fx.heal) {
        if (s) {
          s.health = Math.min(s.maxHealth, s.health + fx.heal)
          s._renderHud()
        }
        this._msg(t('invHealed', { n: fx.heal }))
      } else if (s?.inv) {
        s.inv.add({ kind: 'item', id: fx.give, n: fx.n })
        this._msg(t('specialGot', { item: t(ITEMS[fx.give].key), n: fx.n }))
      } else this._msg(t('specialPlayOnly'))
      this._sound('pop')
      this._burst(entry, 0xffe080, 8)
      return true
    }
    if (fx.kind === 'compost') {
      let n = 0
      for (const c of this.kind('crop')) {
        const cst = this._st.get(c.key)
        if (cst?.planted && dist3(c, x, y, z) <= fx.r) {
          cst.grown = c.def.fx.grow
          n++
        }
      }
      if (!n) {
        st.cdUntil = 0
        this._msg(t('specialNoCrops'))
        return true
      }
      this._sound('pop')
      this._msg(t('specialCompost', { n }))
      return true
    }
    if (fx.kind === 'flowerpot') {
      st.flower = ((st.flower || 0) + 1) % FLOWER_COLORS.length
      this._sound('pop')
      this._overlaysDirty = true
      return true
    }
    if (fx.kind === 'rain') {
      if (!st.level) {
        this._msg(t('specialRainEmpty'))
        return true
      }
      st.level--
      const s = this._play()
      if (s) {
        s.health = Math.min(s.maxHealth, s.health + fx.heal)
        s._renderHud()
      }
      this._msg(t('invHealed', { n: fx.heal }))
      this._sound('pop')
      return true
    }
    if (['cook', 'armor', 'trash', 'shop', 'gamble', 'slots', 'clone'].includes(fx.kind)) {
      const s = this._play()
      if (!s?.inv) {
        st.cdUntil = 0
        this._msg(t('specialPlayOnly'))
        return true
      }
      const inv = s.inv
      const held = inv.selected()
      if (fx.kind === 'cook') {
        if (held?.id !== fx.item) {
          this._msg(t('specialHoldMeat'))
          return true
        }
        inv._take(inv.hotbar, inv.active, 1)
        s.health = Math.min(s.maxHealth, s.health + fx.heal)
        this._msg(t('invHealed', { n: fx.heal }))
        this._sound('pop')
      } else if (fx.kind === 'armor') {
        if ((s.armor || 0) >= fx.max) {
          st.cdUntil = 0
          this._msg(t('specialBenchMax'))
          return true
        }
        s.armor = Math.min(fx.max, (s.armor || 0) + fx.add)
        this._msg(t('specialArmor', { n: Math.ceil(s.armor) }))
        this._sound('clank')
      } else if (fx.kind === 'trash') {
        if (!held || held.kind === 'gun') {
          this._msg(t('specialHoldItem'))
          return true
        }
        inv._take(inv.hotbar, inv.active, held.n)
        this._msg(t('specialTrashed'))
        this._sound('crumble')
      } else if (fx.kind === 'shop' || fx.kind === 'gamble') {
        if (!this._pay(s, fx.cost)) {
          st.cdUntil = 0
          return true
        }
        this._msg(this._prize(s, fx.table))
        this._sound('pop')
      } else if (fx.kind === 'slots') {
        if (!this._pay(s, fx.cost)) return true
        const roll = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)])
        st.show = roll.join(' ')
        st.until = this._time + 4
        const same = new Set(roll).size
        const win = same === 1 ? fx.three : same === 2 ? fx.two : 0
        if (win) s.coins = (s.coins || 0) + win
        this._msg(win ? `${st.show} - ${t('specialWonCoins', { n: win })}` : `${st.show} - ${t('specialNothing')}`)
        this._sound(win ? 'chime' : 'pop')
        this._overlaysDirty = true
      } else if (fx.kind === 'clone') {
        const top = this.bm.getBlockAt(x, y + 1, z)
        const def = top && this.bm.blockTypeOf(top)
        if (!def || def.game || def.hidden || def.shape === 'doortop') {
          st.cdUntil = 0
          this._msg(t('specialCloneNeedTop'))
          return true
        }
        inv.add({ kind: 'block', id: top, n: fx.n })
        this._msg(t('specialGot', { item: this.bm.blockName(top), n: fx.n }))
        this._sound('pop')
      }
      s._renderHud()
      this._burst(entry, 0xffe080, 6)
      return true
    }
    if (fx.kind === 'checkpoint') {
      this._setCheckpoint(entry)
      return true
    }
    if (fx.kind === 'store') return this._useStore(entry, st)
    if (fx.kind === 'weaponrack') {
      const s = this._play()
      if (!s) {
        this._msg(t('specialPlayOnly'))
        return true
      }
      s._openWeaponPicker?.(true)
      return true
    }
    if (fx.kind === 'ammo') {
      const s = this._play()
      if (!s) {
        st.cdUntil = 0
        this._msg(t('specialPlayOnly'))
        return true
      }
      const n = Math.round(s.magSize() * fx.mags)
      s.reserve += n
      s._renderHud()
      this._sound('pop')
      this._msg(t('specialAmmo', { n }))
      return true
    }
    if (fx.kind === 'bench') {
      const s = this._play()
      if (!s) {
        this._msg(t('specialPlayOnly'))
        return true
      }
      if (this._bench >= fx.max) {
        this._msg(t('specialBenchMax'))
        return true
      }
      if ((s.coins || 0) < fx.cost) {
        this._msg(t('specialNeedCoins', { n: fx.cost }))
        return true
      }
      s.coins -= fx.cost
      this._bench++
      s._renderHud()
      this._sound('hum')
      this._msg(t('specialBench', { n: Math.round(this._bench * BENCH_STEP * 100) }))
      return true
    }
    if (fx.kind === 'recycler') {
      const s = this._play()
      const held = s?.inv?.selected()
      if (!held || held.kind !== 'block') {
        this._msg(t('specialHoldBlocks'))
        return true
      }
      const coins = Math.floor(held.n / fx.per)
      if (!coins) {
        this._msg(t('specialHoldBlocks'))
        return true
      }
      s.inv._take(s.inv.hotbar, s.inv.active, coins * fx.per)
      s.coins = (s.coins || 0) + coins
      s._renderHud()
      this._sound('pop')
      this._msg(t('specialRecycled', { n: coins }))
      return true
    }
    if (fx.kind === 'boat') {
      this._setBuff('boat', fx.mult, fx.time)
      this._sound('pop')
      this._msg(t('specialBoat', { s: fx.time }))
      return true
    }
    if (fx.kind === 'elevator') {
      // To the next elevator straight above (or, if none, below).
      const tm = this.bm.tryMode
      let dest = null
      for (let dy = 1; dy <= 64 && !dest; dy++) if (this.entryAt(x, y + dy, z)?.type === entry.type) dest = y + dy
      for (let dy = 1; dy <= 64 && dest === null; dy++) if (this.entryAt(x, y - dy, z)?.type === entry.type) dest = y - dy
      if (dest === null) {
        this._msg(t('specialNoPair', { name: entry.def.name }))
        return true
      }
      tm.pos.set(x + 0.5, dest + 1, z + 0.5)
      tm.vel.set(0, 0, 0)
      this._sound('pop')
      return true
    }
    if (fx.kind === 'zipline') {
      let best = null
      let bestD = fx.r
      for (const e of this.kind('zipline')) {
        if (e === entry) continue
        const d = Math.hypot(e.x - x, e.y - y, e.z - z)
        if (d < bestD) {
          best = e
          bestD = d
        }
      }
      if (!best) {
        this._msg(t('specialNoPair', { name: entry.def.name }))
        return true
      }
      const from = { x: x + 0.5, y: y + 0.2, z: z + 0.5 }
      const to = { x: best.x + 0.5, y: best.y + 1, z: best.z + 0.5 }
      this._ride = { from, to, t: 0, dur: bestD / fx.speed, sag: Math.min(2, bestD / 12) }
      this._sound('whoosh')
      return true
    }
    if (fx.kind === 'rope') {
      // Down the side of the anchor to the ground.
      const bm = this.bm
      const tm = bm.tryMode
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (bm.getBlockAt(x + dx, y, z + dz)) continue
        for (let fy = y - 1; fy > y - 96; fy--) {
          if (bm.getBlockAt(x + dx, fy, z + dz)) {
            if (fy + 1 >= y) break
            tm.pos.set(x + dx + 0.5, fy + 1, z + dz + 0.5)
            tm.vel.set(0, 0, 0)
            this._sound('whoosh')
            return true
          }
        }
      }
      this._msg(t('specialNoDrop'))
      return true
    }
    if (fx.kind === 'launcher') {
      const tm = this.bm.tryMode
      const yaw = this.bm._yaw
      tm.pos.set(x + 0.5, y + 1.05, z + 0.5)
      tm.vel.set(-Math.sin(yaw) * fx.speed, fx.up, -Math.cos(yaw) * fx.speed)
      tm.onGround = false
      this._launched = this._time + 0.3
      audioEngine.playExplosion?.()
      this._lastSound = 'explosion'
      this._burst(entry, 0xffa040, 12)
      return true
    }
    if (fx.kind === 'heal') {
      const s = this._play()
      if (s) {
        s.health = fx.full ? s.maxHealth : Math.min(s.maxHealth, s.health + fx.heal)
        s._renderHud()
      }
      this._sound('chime')
      this._msg(fx.full ? t('specialHealedFull') : t('invHealed', { n: fx.heal }))
      this._burst(entry, 0xff8080, 10)
      return true
    }
    if (fx.kind === 'give') {
      const s = this._play()
      const left = s?.inv ? s.inv.add({ kind: 'item', id: fx.id, n: fx.n }) : fx.n
      if (s && left >= fx.n) {
        st.cdUntil = 0
        this._msg(t('invFull'))
        return true
      }
      this._sound('pop')
      this._msg(t('specialGot', { item: t(fx.key), n: fx.n }))
      return true
    }
    if (fx.kind === 'buff') {
      this._setBuff(fx.buff, fx.mult, fx.time)
      this._sound(fx.buff === 'damage' ? 'hum' : 'pop')
      this._msg(t(fx.buff === 'damage' ? 'specialStronger' : 'specialFaster', { s: fx.time }))
      this._burst(entry, fx.buff === 'damage' ? 0xff6040 : 0x60f0ff, 10)
      return true
    }
    if (fx.kind === 'bed') {
      this._bed = { x, y, z }
      this._bedUsed = false
      this._sound('chime')
      this._msg(t('specialBedSet'))
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

  // Where you come back if you fall off the map.
  _setCheckpoint(e) {
    const tm = this.bm.tryMode
    if (tm._spawn.x === e.x + 0.5 && tm._spawn.z === e.z + 0.5 && tm._spawn.y === e.y + 1) return
    tm._spawn.set(e.x + 0.5, e.y + 1, e.z + 0.5)
    this._sound('chime')
    this._msg(t('specialCheckpoint'))
    this._burst(e, 0xf0e060, 10)
  }

  // ---- storing things (Locker, Shared Chest) ----

  // Use with something held: puts the held stack in (if there's room);
  // with nothing held (or a gun): takes the last stack out.
  _useStore(entry, st) {
    const s = this._play()
    if (!s?.inv) {
      this._msg(t('specialPlayOnly'))
      return true
    }
    const inv = s.inv
    const fx = entry.def.fx
    // A Safe asks for its code (set the first time).
    if (fx.code) {
      if (!st.code) {
        const code = String(window.prompt(t('specialSafeSet')) ?? '').replace(/\D/g, '').slice(0, 8)
        if (!code) return true
        st.code = code
        this._msg(t('specialSafeLocked'))
        return true
      }
      const tried = String(window.prompt(t('specialSafeAsk')) ?? '').replace(/\D/g, '')
      if (tried !== st.code) {
        if (tried) this._msg(t('specialSafeWrong'))
        return true
      }
    }
    // A Mailbox keeps its stacks on this device between games.
    if (fx.keep && !st.items) st.items = this._loadMail(entry)
    st.items = st.items || []
    const held = inv.selected()
    if (held && held.kind !== 'gun' && st.items.length < entry.def.fx.slots) {
      st.items.push({ ...held })
      inv._take(inv.hotbar, inv.active, held.n)
      if (fx.keep) this._saveMail(entry, st.items)
      this._sound('pop')
      this._msg(t('specialStored', { n: st.items.length, max: entry.def.fx.slots }))
      return true
    }
    if (held && held.kind !== 'gun') {
      this._msg(t('specialStoreFull'))
      return true
    }
    if (!st.items.length) {
      this._msg(t('specialStoreEmpty'))
      return true
    }
    const it = st.items.pop()
    const left = inv.add(it)
    if (left > 0) st.items.push({ ...it, n: left })
    if (fx.keep) this._saveMail(entry, st.items)
    this._sound('pop')
    this._msg(t('specialTookOut'))
    return true
  }

  // Mailbox contents, per map slot and spot, on this device. Read back
  // as untrusted: only real items and blocks, sensible amounts.
  _mailKey(e) {
    return `${MAIL_KEY}:${this.bm.activeSlot}:${e.key}`
  }

  _loadMail(e) {
    try {
      const raw = JSON.parse(localStorage.getItem(this._mailKey(e)) || '[]')
      if (!Array.isArray(raw)) return []
      return raw.filter((it) => it && (it.kind === 'item' ? !!ITEMS[it.id] : it.kind === 'block' && this.bm.isBlockType(it.id)) && Number.isInteger(it.n) && it.n > 0 && it.n <= 999)
        .slice(0, e.def.fx.slots).map((it) => ({ kind: it.kind, id: it.id, n: it.n }))
    } catch {
      return []
    }
  }

  _saveMail(e, items) {
    try {
      localStorage.setItem(this._mailKey(e), JSON.stringify(items.map(({ kind, id, n }) => ({ kind, id, n }))))
    } catch {
      // Storage full or blocked: it just isn't kept.
    }
  }

  // Pays `cost` coins from this game's coins; false (and says so) if short.
  _pay(s, cost) {
    if ((s.coins || 0) < cost) {
      this._msg(t('specialNeedCoins', { n: cost }))
      return false
    }
    s.coins -= cost
    s._renderHud()
    return true
  }

  // Gives a random prize from a table of [weight, prize]; returns its text.
  _prize(s, table) {
    let roll = Math.random() * table.reduce((n, [w]) => n + w, 0)
    let prize = table[table.length - 1][1]
    for (const [w, p] of table) {
      if ((roll -= w) < 0) {
        prize = p
        break
      }
    }
    if (prize.item) {
      const id = prize.item === 'armor' ? ARMOR_SLOTS[Math.floor(Math.random() * ARMOR_SLOTS.length)] : prize.item
      s.inv.add({ kind: 'item', id, n: prize.n || 1 })
      return t('specialGot', { item: t(ITEMS[id].key), n: prize.n || 1 })
    }
    if (prize.block) {
      s.inv.add({ kind: 'block', id: prize.block, n: prize.n })
      return t('specialGot', { item: this.bm.blockName(prize.block), n: prize.n })
    }
    if (prize.coins) {
      s.coins = (s.coins || 0) + prize.coins
      return t('specialWonCoins', { n: prize.coins })
    }
    if (prize.heal) {
      s.health = s.maxHealth
      return t('specialHealedFull')
    }
    if (prize.mags) {
      s.reserve += s.magSize() * prize.mags
      return t('specialAmmo', { n: s.magSize() * prize.mags })
    }
    return t('specialNothing')
  }

  // ---- buffs (Speed Pad, Strength Totem, Coffee Machine) ----

  _setBuff(name, mult, time) {
    this._buffs[name] = { mult, until: this._time + time }
  }

  // The buff's multiplier while it lasts, else 0. Shrunk, you stay small
  // past the time until there's room to stand up.
  _buff(name) {
    const b = this._buffs?.[name]
    if (!this.active || !b) return 0
    if (b.until > this._time) return b.mult
    if (name === 'shrink') {
      const tm = this.bm.tryMode
      if (tm.active && tm._hits(tm.pos.x, tm.pos.y, tm.pos.z, 1.8)) return b.mult
    }
    return 0
  }

  // Your damage multiplier (BuildSurvival._damageMult).
  damageMult() {
    return (this._buff('damage') || 1) * (this._buff('grow') ? GROW_DAMAGE : 1) * (1 + (this._bench || 0) * BENCH_STEP)
  }

  // Your body's size (Shrink / Grow Pad): BuildTryMode scales your eyes by
  // it, and (when smaller) your height.
  bodySize() {
    if (!this.active) return 1
    return this._buff('shrink') || this._buff('grow') || 1
  }

  // A zombie just bit you: a Mirror Block near you sends some back.
  onBitten(zb, bite) {
    if (!this.active) return
    const p = this.bm.tryMode.pos
    for (const e of this.kind('mirror')) {
      if (dist3(p, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.r) continue
      zb.health -= bite * e.def.fx.back
      zb.flash = 0.12
      this._burst(e, 0xd0f0ff, 5)
      return
    }
  }

  // Players (you and others on a server) standing on a Voting Block.
  _votes() {
    const s = this.bm.survival
    const bodies = [this.bm.tryMode.pos, ...(s?.net && !s.net.closed ? s.net.targets() : [])]
    let n = 0
    for (const p of bodies) {
      const e = this.entryAt(Math.floor(p.x), Math.floor(p.y + 0.01) - 1, Math.floor(p.z))
      if (e?.def.fx.kind === 'vote') n++
    }
    return n
  }

  // A random plain full block (Random Block).
  randomType() {
    if (!this._randomPool) {
      this._randomPool = this.bm.constructor.randomBlockPool?.() || ['stone']
    }
    return this._randomPool[Math.floor(Math.random() * this._randomPool.length)]
  }

  // Dying (BuildSurvival._die): a Bed you used brings you back there once
  // per game, with half your health. True if it did.
  tryRevive(s) {
    const bed = this._bed
    if (!this.active || !bed || this._bedUsed || !this.bm.getBlockAt(bed.x, bed.y, bed.z)) return false
    this._bedUsed = true
    s.health = Math.ceil(s.maxHealth / 2)
    const tm = this.bm.tryMode
    tm.pos.set(bed.x + 0.5, bed.y + 1, bed.z + 0.5)
    tm.vel.set(0, 0, 0)
    s._renderHud()
    this._msg(t('specialRevived'))
    this._sound('chime')
    return true
  }

  // Protected from every hit right now (Infection Cleanser).
  shielded() {
    return this.active && this._shieldUntil > this._time
  }

  // A zombie died (BuildSurvival.damageZombie): cursed ones pay extra.
  onKill(zb) {
    if (!this.active) return
    const s = this.bm.survival
    if (zb.cursed) s?._earn?.(zb.cursed)
    // Lucky Clover near you: bonus coins.
    const p = this.bm.tryMode.pos
    for (const e of this.kind('clover')) {
      if (dist3(p, e.x + 0.5, e.y, e.z + 0.5) > e.def.fx.r) continue
      s?._earn?.(e.def.fx.coins)
      break
    }
  }

  // Water touching this block (a Fish Trap).
  _nearWater(e) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (this.bm._cellIsLiquid(e.x + dx, e.y + dy, e.z + dz) && this.bm.getBlockAt(e.x + dx, e.y + dy, e.z + dz) !== 'lava') return true
    }
    return false
  }

  // A firework (a rocket of sparks that bursts high up) or a confetti pop.
  _celebrate(e, kind) {
    const fx = this._effects()
    const B = this.B
    const cx = (e.x + 0.5) * B
    const cz = (e.z + 0.5) * B
    const colors = [0xff4060, 0xffd040, 0x40e080, 0x40a0ff, 0xd060ff, 0xffffff]
    if (kind === 'firework') {
      const top = (e.y + 12) * B
      for (let i = 0; i < 10; i++) fx.spark(cx, (e.y + 1 + i * 1.1) * B, cz, { color: 0xffe0a0, life: 0.3, from: 0.2, to: 0.05, delay: i * 0.05 })
      const c = colors[Math.floor(Math.random() * colors.length)]
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2
        const b = Math.acos(Math.random() * 2 - 1)
        const v = new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)).multiplyScalar(6 * B)
        fx.spark(cx, top, cz, { color: i % 3 ? c : 0xffffff, life: 1.2, from: 0.35, to: 0.05, vel: v, delay: 0.55 })
      }
      this._sound('firework')
    } else {
      for (let i = 0; i < 50; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 5, 4 + Math.random() * 5, (Math.random() - 0.5) * 5).multiplyScalar(B)
        fx.spark(cx, (e.y + 1) * B, cz, { color: colors[i % colors.length], life: 1.5, from: 0.18, to: 0.12, vel: v, drag: 1.5 })
      }
      this._sound('pop')
    }
  }

  // A Start/Finish Line: the first one you cross starts the clock, any
  // other one stops it (your best time on this map is kept on this device).
  _raceLine(e) {
    const r = this._race
    if (!r) {
      this._race = { from: e.key, start: this._time }
      this._sound('chime')
      this._msg(t('specialRaceGo'))
      return
    }
    if (r.from === e.key) return
    const secs = Math.round((this._time - r.start) * 10) / 10
    this._race = null
    let best = secs
    try {
      const all = JSON.parse(localStorage.getItem(RACE_KEY) || '{}')
      const slot = String(this.bm.activeSlot)
      const old = Number(all[slot])
      if (Number.isFinite(old) && old > 0 && old < secs) best = old
      all[slot] = best
      localStorage.setItem(RACE_KEY, JSON.stringify(all))
    } catch {
      // Not kept - still shown.
    }
    this._lastRace = secs
    this._sound('bell')
    this._msg(t('specialRaceTime', { s: secs.toFixed(1), best: best.toFixed(1) }))
  }

  // Black Light: outlines of Invisible Blocks around it, while it's on.
  _showHidden(e, on) {
    const st = this._state(e)
    if (st.outlines) {
      this._group?.remove(st.outlines)
      st.outlines.traverse((o) => o.material?.dispose())
      st.outlines = null
    }
    if (!on || !this._group) return
    const B = this.B
    const r = e.def.fx.r
    const group = new THREE.Group()
    const mat = new THREE.LineBasicMaterial({ color: 0xc060ff })
    const edges = sharedEdges()
    for (let x = e.x - r; x <= e.x + r && group.children.length < 200; x++) {
      for (let y = e.y - r; y <= e.y + r; y++) {
        for (let z = e.z - r; z <= e.z + r; z++) {
          if (this.bm._blocks.at(x, y, z) !== 'invisible') continue
          const line = new THREE.LineSegments(edges, mat)
          line.scale.setScalar(B * 1.01)
          line.position.set((x + 0.5) * B, (y + 0.5) * B, (z + 0.5) * B)
          group.add(line)
        }
      }
    }
    group.userData.mat = mat
    this._group.add(group)
    st.outlines = group
  }

  // Photo Booth: saves a picture of what you see.
  _photo() {
    const bm = this.bm
    const r = bm.renderer
    if (!r) return false
    try {
      r.render(bm.scene, bm.camera)
      const url = r.domElement.toDataURL('image/png')
      const a = document.createElement('a')
      a.href = url
      a.download = `gayz-photo-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      this._lastPhoto = url.length
    } catch {
      return false
    }
    return true
  }

  // Raining, with open sky over this block.
  _rainingOn(e) {
    const s = this.bm.survival
    if (!s?._raining?.()) return false
    for (let y = e.y + 1; y < e.y + 24; y++) if (this.bm.getBlockAt(e.x, y, e.z)) return false
    return true
  }

  // A Tree Sapling's tree: a trunk on top of it and a ball of leaves, only
  // in empty cells; taken away again when the try ends (_temp).
  _growTree(e) {
    const bm = this.bm
    const fx = e.def.fx
    const put = (x, y, z, type) => {
      if (bm.getBlockAt(x, y, z)) return
      bm._suppressUndoRecording = true
      bm.placeBlock(x, y, z, type)
      bm._suppressUndoRecording = false
      this._temp.push({ x, y, z, type })
    }
    const top = e.y + fx.trunk
    for (let y = e.y + 1; y <= top; y++) put(e.x, y, e.z, fx.log)
    for (let dy = -1; dy <= 1; dy++) {
      const r = dy === 1 ? 1 : 2
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.abs(dx) + Math.abs(dz) <= r + 1) put(e.x + dx, top + dy, e.z + dz, fx.leaves)
    }
    put(e.x, top + 2, e.z, fx.leaves)
    this._sound('pop')
    this._burst({ x: e.x, y: top, z: e.z }, 0x60c040, 14)
  }

  // Blocks this try put into the world (trees) come out again; one you
  // broke meanwhile isn't put back by Try Map either.
  _clearTemp() {
    const bm = this.bm
    bm._suppressUndoRecording = true
    for (const c of this._temp || []) {
      bm.tryMode._broken?.delete(`${c.x},${c.y},${c.z}`)
      if (bm.getBlockAt(c.x, c.y, c.z) === c.type) bm.removeBlock(c.x, c.y, c.z)
    }
    bm._suppressUndoRecording = false
    this._temp = []
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

  // How fast a crop grows: x2 for each Sprinkler / Greenhouse Glass near it.
  _growRate(e) {
    let rate = 1
    for (const kind of ['sprinkler', 'greenhouse']) {
      for (const g of this.kind(kind)) {
        if (dist3(g, e.x, e.y, e.z) <= g.def.fx.r) {
          rate *= g.def.fx.mult
          break
        }
      }
    }
    return rate
  }

  _useCrop(entry, st) {
    const fx = entry.def.fx
    // One of your camp farm's plots grows in real time (CampFarm.js).
    const farm = this._play()?.farm
    const farmed = !!farm?.owns(entry)
    const timeText = (secs) => (farmed ? t('farmTime', { m: Math.floor(secs / 60), s: String(Math.ceil(secs) % 60).padStart(2, '0') }) : `${Math.ceil(secs)}s`)
    if (!st.planted) {
      st.planted = true
      st.grown = 0
      if (farmed) farm.onPlant(entry)
      this._sound('pop')
      this._msg(t('specialCropPlantedIn', { t: timeText(farmed ? farm.secondsLeft(entry) : fx.grow / this._growRate(entry)) }))
      this._overlaysDirty = true
      return true
    }
    const left = farmed ? farm.secondsLeft(entry) : (fx.grow - st.grown) / this._growRate(entry)
    if (left > 0) {
      this._msg(t('specialCropGrowingIn', { t: timeText(left) }))
      return true
    }
    st.planted = false
    const play = this._play()
    const kept = play?.inv ? fx.n - play.inv.add({ kind: 'item', id: fx.give, n: fx.n }) : 0
    // Plant Fiber too, for crafting (PlayCrafting.js).
    const fiber = play?.inv ? CROP_FIBER - play.inv.add({ kind: 'item', id: 'plantFiber', n: CROP_FIBER }) : 0
    play?.farm?.onHarvest(entry)
    this._sound('pop')
    this._msg(play ? t('specialCropHarvestFiber', { n: kept, f: fiber }) : t('specialCropHarvestTry'))
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
    // Invisible (Invisibility Pad): zombies can't find you.
    if (target && !target.remote && !target.lure && this._buff('invisible')) return { x: zb.x, y: zb.y, z: zb.z, idle: true, lure: true }
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
      if (fx.kind === 'conveyor' && !fx.noZombies && Math.floor(zb.y + 0.01) === e.y) {
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

  // A shot hit a block (BuildSurvival.shoot): an Explosive Barrel goes
  // off. -> true if it did.
  shootBlock(x, y, z) {
    const e = this.entryAt(x, y, z)
    if (e?.def.fx.kind !== 'barrel') return false
    this._blowBarrel(e)
    return true
  }

  // The barrel breaks, the blast hurts zombies (and you, less the further
  // away), and barrels in the blast go off too.
  _blowBarrel(e) {
    const fx = e.def.fx
    const play = this.bm.survival
    this.bm.tryMode.breakBlock(e.x, e.y, e.z)
    play?._recordEdit?.(e.x, e.y, e.z, '')
    this._explode(e, fx)
    const me = this.bm.tryMode.pos
    const d = dist3(me, e.x + 0.5, e.y, e.z + 0.5)
    if (play?.active && !play.dead && d < fx.blast) play._hurtPlayer(fx.pdmg * (1 - d / fx.blast))
    for (const o of [...this.kind('barrel')]) {
      if (this._at.get(o.key) === o && dist3({ x: o.x + 0.5, y: o.y, z: o.z + 0.5 }, e.x + 0.5, e.y, e.z + 0.5) < fx.blast) this._blowBarrel(o)
    }
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
    for (const e of this.kind('trophy')) {
      if (near(e) && Math.random() < 0.3) this._effects().spark((e.x + Math.random()) * B, (e.y + 1 + Math.random() * 0.5) * B, (e.z + Math.random()) * B, { color: 0xffe060, life: 0.6, from: 0.12, to: 0.02 })
    }
    for (const e of this.kind('torch')) {
      if (near(e) && Math.random() < 0.6) this._effects().flame((e.x + 0.4 + Math.random() * 0.2) * B, (e.y + 1.02) * B, (e.z + 0.4 + Math.random() * 0.2) * B)
    }
    for (const e of this.kind('machine')) {
      if (!near(e) || !this._st.get(e.key)?.on) continue
      const r = e.def.fx.r
      const px = (e.x + 0.5 + (Math.random() - 0.5) * r * 2) * B
      const pz = (e.z + 0.5 + (Math.random() - 0.5) * r * 2) * B
      if (e.def.fx.make === 'fog') this._effects().smoke(px, (e.y + 0.5 + Math.random()) * B, pz)
      else for (let i = 0; i < 3; i++) this._effects().spark((e.x + 0.5 + (Math.random() - 0.5) * r * 2) * B, (e.y + 5) * B, (e.z + 0.5 + (Math.random() - 0.5) * r * 2) * B, { color: 0xffffff, life: 2.5, from: 0.14, to: 0.1, vel: new THREE.Vector3(0, -2 * B, 0), drag: 0 })
    }
    for (const e of this.kind('bubbles')) {
      if (!near(e) || Math.random() < 0.4) continue
      this._effects().spark((e.x + 0.2 + Math.random() * 0.6) * B, (e.y + 1) * B, (e.z + 0.2 + Math.random() * 0.6) * B, { color: 0xa0e0ff, life: 2, from: 0.12, to: 0.25, vel: new THREE.Vector3(0, 1.5 * B, 0), drag: 0, alpha: 0.7 })
    }
    for (const e of this.kind('sprinkler')) {
      if (!near(e) || Math.random() < 0.4) continue
      const a = Math.random() * Math.PI * 2
      this._effects().spark((e.x + 0.5) * B, (e.y + 1.1) * B, (e.z + 0.5) * B, { color: 0x80c8ff, life: 0.7, from: 0.15, to: 0.05, vel: new THREE.Vector3(Math.cos(a) * 3 * B, 2 * B, Math.sin(a) * 3 * B) })
    }
    for (const e of this.kind('producer')) {
      if (!near(e) || e.def.fx.give !== undefined || Math.random() < 0.8) continue
      this._effects().spark((e.x + Math.random()) * B, (e.y + 1 + Math.random() * 0.6) * B, (e.z + Math.random()) * B, { color: 0xf0c020, life: 0.8, from: 0.1, to: 0.06, vel: new THREE.Vector3((Math.random() - 0.5) * B, 0, (Math.random() - 0.5) * B) })
    }
    for (const e of this.kind('sauna')) {
      if (!near(e) || Math.random() < 0.5) continue
      this._effects().spark((e.x + Math.random()) * B, (e.y + 1) * B, (e.z + Math.random()) * B, { color: 0xf0f0f0, life: 1.2, from: 0.3, to: 0.6, vel: new THREE.Vector3(0, 0.8 * B, 0), alpha: 0.5 })
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
    for (const kind of ['disco', 'crop', 'score', 'radio', 'lure', 'counter', 'blade', 'power', 'turret', 'searchlight', 'slots', 'flowerpot', 'rain', 'lamp', 'flicker', 'hologram', 'dice', 'arcade', 'countdown', 'hoop', 'trophy', 'race', 'pulse', 'vote']) {
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
    if (kind === 'disco' || kind === 'power' || kind === 'lamp' || kind === 'flicker' || kind === 'pulse') {
      obj = new THREE.Mesh(sharedBox(), new THREE.MeshBasicMaterial({ color: kind === 'power' ? 0xffe040 : kind === 'flicker' ? 0xfff0c0 : 0xffffff, transparent: true, opacity: kind === 'power' ? 0.3 : 0.4, depthWrite: false }))
      obj.scale.setScalar(1.02 * B)
      obj.position.set((e.x + 0.5) * B, (e.y + 0.5) * B, (e.z + 0.5) * B)
    } else if (kind === 'hologram') {
      // A small see-through block spinning over it.
      obj = new THREE.Mesh(sharedBox(), new THREE.MeshBasicMaterial({ color: 0x80e0ff, transparent: true, opacity: 0.55, depthWrite: false }))
      obj.scale.setScalar(0.5 * B)
      obj.position.set((e.x + 0.5) * B, (e.y + 1.6) * B, (e.z + 0.5) * B)
    } else if (kind === 'flowerpot') {
      // A stem with a flower head on top.
      obj = new THREE.Group()
      const stem = new THREE.Mesh(sharedBox(), new THREE.MeshLambertMaterial({ color: 0x4a9a3a }))
      stem.scale.set(0.08 * B, 0.5 * B, 0.08 * B)
      stem.position.y = 0.25 * B
      const head = new THREE.Mesh(sharedBox(), new THREE.MeshLambertMaterial({ color: FLOWER_COLORS[0] }))
      head.scale.setScalar(0.28 * B)
      head.position.y = 0.6 * B
      obj.add(stem, head)
      obj.userData.head = head
      obj.position.set((e.x + 0.5) * B, (e.y + 1) * B, (e.z + 0.5) * B)
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
    } else if (kind === 'score' || kind === 'radio' || kind === 'counter' || kind === 'turret' || kind === 'slots' || kind === 'rain' || LABEL_KINDS.has(kind) || e.def.fx.label) {
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
      if (kind === 'lamp') {
        obj.material.color.setHex(LAMP_COLORS[this._st.get(e.key)?.color || 0])
      } else if (kind === 'flicker') {
        // Mostly on, with quick random dips.
        const st = this._state(e)
        if (!(st.next > this._time)) {
          st.next = this._time + 0.05 + Math.random() * 0.25
          st.level = Math.random() < 0.25 ? Math.random() * 0.1 : 0.35 + Math.random() * 0.15
        }
        obj.material.opacity = st.level
      } else if (kind === 'hologram') {
        const type = HOLO_BLOCKS[this._st.get(e.key)?.pick || 0]
        obj.material.color.setHex(this.bm.constructor.blockColor(type) ?? 0x80e0ff)
        obj.rotation.y = this._time * 1.5
        obj.rotation.x = 0.4
        obj.position.y = (e.y + 1.6 + Math.sin(this._time * 2) * 0.1) * this.B
      } else if (kind === 'power') {
        obj.visible = this._on.has(e.key)
      } else if (kind === 'searchlight') {
        obj.visible = this.powered(e)
        obj.rotation.y = this._time * 0.8
      } else if (kind === 'flowerpot') {
        obj.userData.head.material.color.setHex(FLOWER_COLORS[this._st.get(e.key)?.flower || 0])
      } else if (kind === 'rain') {
        setSpriteText(obj, t('specialRainLevel', { n: this._st.get(e.key)?.level || 0, max: e.def.fx.max }))
      } else if (kind === 'pulse') {
        obj.material.color.setHex(e.def.fx.tint)
        obj.material.opacity = 0.25 + Math.sin(this._time * 2 + e.x) * 0.2
      } else if (kind === 'vote') {
        setSpriteText(obj, t('specialVotes', { n: this._votes() }))
      } else if (kind === 'trophy') {
        setSpriteText(obj, t('specialScoreBest', { n: this._bestWave() }))
      } else if (kind === 'race') {
        const r = this._race
        obj.visible = !!r || this._lastRace !== undefined
        if (obj.visible) setSpriteText(obj, r ? `${(this._time - r.start).toFixed(1)}s` : t('specialRaceLast', { s: this._lastRace.toFixed(1) }))
      } else if (kind === 'hoop') {
        const n = this._st.get(e.key)?.score
        obj.visible = n !== undefined
        if (obj.visible) setSpriteText(obj, t('specialHoopScore', { n }))
      } else if (kind === 'dice' || kind === 'arcade' || kind === 'countdown') {
        const st = this._st.get(e.key)
        obj.visible = st?.until > this._time && !!st.show
        if (obj.visible) setSpriteText(obj, st.show)
      } else if (kind === 'slots') {
        const st = this._st.get(e.key)
        obj.visible = st?.until > this._time
        if (obj.visible) setSpriteText(obj, st.show)
      } else if (kind === 'turret') {
        setSpriteText(obj, t('specialTurretAmmo', { n: this._st.get(e.key)?.ammo ?? e.def.fx.start }))
      } else if (kind === 'blade') {
        obj.rotation.y = this._time * Math.PI * 2 / e.def.fx.every
      } else if (kind === 'disco') {
        obj.material.color.setHSL((this._time * 0.35 + (e.x + e.z) * 0.07) % 1, 0.9, 0.55)
      } else if (kind === 'crop') {
        const st = this._st.get(e.key)
        const k = !st?.planted ? 0 : Math.min(1, st.grown / e.def.fx.grow)
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
// Kinds that show a floating label (besides score/radio/counter...).
const LABEL_KINDS = new Set(['dice', 'arcade', 'countdown', 'hoop', 'trophy', 'race', 'vote'])
const SEARCHLIGHT_MULT = 1.25
const LAMP_COLORS = [0xffffff, 0xff4040, 0xffa030, 0xffe040, 0x50e060, 0x40c0ff, 0x7060ff, 0xff60d0]
const HOLO_BLOCKS = ['diamondblock', 'gold', 'emeraldblock', 'grass', 'stone', 'oaklog', 'amethystblock', 'c4']
const FLOWER_COLORS = [0xf04060, 0xf0d040, 0x6080f0, 0xf080d0, 0xffffff, 0xf08030]
const RACE_KEY = 'gayz-race-best' // best Start/Finish time per map slot
const MAIL_KEY = 'gayz-mailbox' // + map slot + block spot (Mailbox)
const SLOT_SYMBOLS = ['7', '$', '*', '@']
const GROW_DAMAGE = 1.3 // damage while big (Grow Pad)
const BENCH_STEP = 0.1 // damage added per Workbench Upgrade
const POWER_STEP = 0.1 // seconds between power updates
const GATE_MODES = ['AND', 'OR', 'NOT']
// Kinds that do something when used (plus lures with on: 'use').
const USE_KINDS = new Set(['weather', 'daynight', 'drum', 'dice', 'blacklight', 'countdown', 'arcade', 'hoop', 'photo', 'lamp', 'machine', 'firework', 'confetti', 'hologram', 'producer', 'compost', 'flowerpot', 'rain', 'cook', 'armor', 'trash', 'shop', 'gamble', 'slots', 'clone', 'checkpoint', 'store', 'weaponrack', 'ammo', 'bench', 'recycler', 'boat', 'elevator', 'zipline', 'rope', 'launcher', 'heal', 'give', 'buff', 'bed', 'turret', 'gate', 'power', 'crop', 'doorbell', 'radio', 'horn', 'piano', 'cleanser', 'wavebell', 'smoke', 'shieldgen', 'watchtower', 'oilpot', 'cannon', 'catapult'])
// Piano Block notes: a major scale from middle C.
const SCALE = [262, 294, 330, 349, 392, 440, 494, 523]

function dist3(p, x, y, z) {
  return Math.hypot(p.x - x, p.y - y, p.z - z)
}

let _edges = null
function sharedEdges() {
  return _edges || (_edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)))
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

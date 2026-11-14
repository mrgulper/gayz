// Couch Co-op's equal Player 2 builds, digs and drives (2026-11-14, Batch
// 4c-2b; Gaymi: "player two should be able to do everything player 1 is
// able to do", with the same controller buttons as a normal player -
// ControlSettings.js PAD_KEYS). Made by CouchCoop.js next to CouchGear.js
// (only when Player 2 is Equal):
//   - RT: shoot (gun held), place the held block or trap, use the held item.
//     Holding RT on a block within DIG_REACH breaks it, like Player 1's
//     left click; what breaks pops out and flies to the nearer player.
//   - LT: get in / out of a vehicle in front of you; holding a block,
//     place it; otherwise aim (CouchCoop._sticks).
//   - LB / RB: the hotbar slot (CouchGear.js). D-pad down: drop the held
//     thing. D-pad right: Player 2's Shop.
//   - Y (Use): get in / out of the nearest vehicle; else use the block
//     you're looking at (2026-11-14, Batch 4c-2c: open a Loot Chest - your
//     own loot, BuildSurvival.useChestP2 - plant / harvest a Crop Plot,
//     ring a doorbell, open a door...); else, with Auto Pick-Up off, pick
//     up drops near you.
//   - D-pad left (Emote): the emote list (CouchGear.js). Moving, shooting
//     or getting hurt stops it.
//   - RT holding a Fishing Rod: cast / reel in (Fishing.js, Player 2's
//     own `fishing` - "Something's biting! Press RT!").
//   - B (Crouch): sneak (slower); gets out of the go-kart and boats.
// Vehicles: the go-kart and any boat, helicopter, hot-air balloon,
// submarine or jet ski either of you has put down - one driver each
// (since 4c-2c Player 2 crafts and puts down their own too). The left stick drives, A climbs, B goes down (the
// same as Player 1's Jump and Crouch), and a helicopter flies where Player
// 2 looks. Vehicles keep their own code (GoKart.js / Vehicles.js
// enterP2 / driveP2 / leaveP2).
// Ground drops (PlayDrops.js) go to whichever of you is nearer
// (collector()).
import * as THREE from 'three'
import { t } from './i18n.js'
import { DIG_REACH } from './BuildTryMode.js'
import { KART_EYE } from './GoKart.js'
import { Fishing } from './Fishing.js'
import { ITEMS } from './PlayInventory.js'

// Controller buttons (the same numbers as CouchCoop.js).
const B_A = 0
const B_B = 1
const B_Y = 3
const B_LB = 4
const B_RB = 5
const B_LT = 6
const B_RT = 7
const DOWN = 13
const LEFT = 14
const RIGHT = 15
// Player 2's eyes above their feet (CouchCoop.js EYE).
const EYE = 1.62
// Placing reach (blocks) - the same as Player 1's (BuildSurvival PLACE_REACH).
const PLACE_REACH = 6
// How near (blocks) and how much in front a vehicle must be for LT.
const ENTER_REACH = 3.5
const FACING = 0.7
// Vehicles that burn fuel show it on Player 2's half.
const FUELLED = new Set(['heli', 'balloon'])

export class CouchHands {
  constructor(couch) {
    this.c = couch
    this.s = couch.s
    this.gear = couch.gear
    // The block being broken: { key, x, y, z, type, t, need }.
    this.dig = null
    // In a vehicle: { kind: 'kart' } or { kind: 'veh', v }.
    this.ride = null
    // Player 2's own fishing line (Fishing.js with them as the angler).
    const c = couch
    const gear = this.gear
    this.fishing = new Fishing(this.s, {
      get camera() { return c.camera },
      body: () => c.p2,
      holdingRod: () => {
        const it = gear.held()
        return it?.kind === 'item' && !!ITEMS[it.id]?.rod && !this.ride
      },
      dead: () => !c.joined || c.p2.isDown || this.s.dead,
      say: (text, secs) => c.p2Message(text, secs),
      add: (item) => gear.add(item),
      earn: (n) => gear.earn(n),
      biteText: () => t('couchFishBite'),
    })
  }

  // RT with the Fishing Rod held.
  fish() {
    if (this.ride) return false
    this.c._placeCamera()
    return this.fishing.use()
  }

  get bm() {
    return this.s.bm
  }

  get p() {
    return this.c.p2
  }

  // Where ground drops fly to for Player 2 (PlayDrops.update), or null.
  collector() {
    const c = this.c
    const p = this.p
    if (!c.active || !c.joined || p.isDown) return null
    return { x: p.x, y: p.y, z: p.z, gear: this.gear }
  }

  // ---------- Buttons (CouchCoop._onPress) ----------

  // true when the press was Player 2's building / driving / item button.
  onPress(i) {
    const g = this.gear
    // Dancing (a Boombox): the D-pad hits the arrows (CouchToys.js).
    if (this.c.toys?.dancePress(i)) return true
    if (i === B_RB || i === B_LB) {
      g.cycle(i === B_RB ? 1 : -1)
      this.dig = null
      return true
    }
    if (i === B_Y) {
      if (this.ride) this.leave()
      // The Cure to Dr. Goo first (CouchToys.handInCure).
      else if (!this.c.toys?.handInCure() && !this.enter(false) && !this.useBlock()) this.s._drops?.pickUpNear(this.p, g)
      return true
    }
    if (i === LEFT) {
      g.open('emote')
      return true
    }
    if (i === B_B) {
      // Crouch gets out of the go-kart and boats (like Player 1's).
      const kind = this.ride?.kind === 'kart' ? 'kart' : this.ride?.v?.kind
      if (kind === 'kart' || kind === 'boat') this.leave()
      return true
    }
    if (i === DOWN) {
      if (!this.ride) g.dropHeld()
      return true
    }
    if (i === RIGHT) {
      g.open('shop')
      return true
    }
    if (i === B_LT) {
      if (this.ride) this.leave()
      else if (!this.enter(true) && g.held()?.kind === 'block') this.place()
      return true
    }
    if (i === B_RT) {
      g.stopEmote()
      const it = g.held()
      if (!it || it.kind === 'gun') this.c._fire()
      else if (it.kind === 'block') {
        if (!this.ride) this.place()
      } else g.useHeld()
      return true
    }
    // A while driving climbs (held - drive()), it doesn't jump.
    if (i === B_A && this.ride) return true
    return false
  }

  // ---------- Every frame (CouchCoop.update, while Player 2 can act) ----------

  update(dt, triggerHeld) {
    this.fishing.update(dt)
    const em = this.gear.emote
    if (em && ((em.left -= dt) <= 0 || this.p.isDown || this.ride || Math.hypot(this.p.vx, this.p.vz) > 0.5)) this.gear.stopEmote()
    if (this.ride) {
      this.dig = null
      return
    }
    // (Holding the rod, RT is for fishing, not digging.)
    if (triggerHeld && !this.fishing.angler.holdingRod()) this._digStep(dt)
    else this.dig = null
  }

  // Y on the block Player 2 is looking at: their own Loot Chest, a Crop
  // Plot (what's harvested goes in their Backpack), a doorbell, radio...
  // (BuildSpecials.use), a door. true if something happened.
  useBlock() {
    const s = this.s
    const bm = this.bm
    const hit = this._aim()
    if (!hit) return false
    const [x, y, z] = hit.existingBlock
    if (this._reach(x, y, z) > PLACE_REACH) return false
    if (s.useChestP2(x, y, z, this.c)) return true
    // Special blocks talk to Player 1's inventory and message line: for
    // this one call they're Player 2's.
    const inv = s.inv
    const message = s._message
    s.inv = { add: (item) => this.gear.add(item), has: (id) => this.gear.has(id) }
    s._message = (text, secs) => this.c.p2Message(text, secs)
    let used
    try {
      used = !!bm.gadgets?.use(x, y, z, true) || !!bm.specials?.use(x, y, z)
    } finally {
      s.inv = inv
      s._message = message
    }
    if (used) return true
    return !!bm.toggleDoor?.(x, y, z)
  }

  // B held on foot: sneaking (CouchCoop._physics).
  sneaking() {
    return !this.ride && this.c.down.has(B_B)
  }

  // ---------- Aiming at blocks ----------

  // The block under Player 2's crosshair (BuildMode's grid ray from their
  // camera), or null.
  _aim() {
    const bm = this.bm
    const cam = this.c.camera
    this.c._placeCamera()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, cam)
    return bm._raycastGridAligned()
  }

  // How far a cell's middle is from Player 2's eyes (blocks).
  _reach(x, y, z) {
    const p = this.p
    return Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + EYE), z + 0.5 - p.z)
  }

  // Holding RT on a block: it cracks, then breaks after its break time
  // (the same as Player 1's, BuildTryMode._updateDigging).
  _digStep(dt) {
    const bm = this.bm
    const s = this.s
    const hit = this._aim()
    if (!hit) {
      this.dig = null
      return
    }
    let [x, y, z] = hit.existingBlock
    if (bm.shapeOf?.(bm.getBlockAt(x, y, z)) === 'doortop') y -= 1
    const type = bm.getBlockAt(x, y, z)
    const need = type ? bm.breakSeconds(type) : Infinity
    if (!Number.isFinite(need) || this._reach(x, y, z) > DIG_REACH || s._protects(x, y, z)) {
      this.dig = null
      return
    }
    const key = bm._key(x, y, z)
    if (this.dig?.key !== key || this.dig.type !== type) this.dig = { key, x, y, z, type, t: 0, need }
    this.dig.t += dt
    if (this.dig.t < need) return
    this.dig = null
    bm.tryMode.breakBlock(x, y, z)
    s.onBlockMined(type, x, y, z, this.gear)
  }

  // 0..1 of the block being broken (Player 2's HUD), or 0.
  digProgress() {
    return this.dig ? Math.min(1, this.dig.t / Math.max(0.01, this.dig.need)) : 0
  }

  // Puts the held block where Player 2 is aiming.
  place() {
    const it = this.gear.held()
    if (it?.kind !== 'block') return false
    const hit = this._aim()
    if (!hit?.placeAt) return false
    const [x, y, z] = hit.placeAt
    if (this._reach(x, y, z) > PLACE_REACH) return false
    if (!this.s.placeBlockAt(x, y, z, it.id)) return false
    this.gear.usedHeld()
    return true
  }

  // ---------- Vehicles ----------

  // Is (x, y, z) in front of Player 2's view?
  _facing(x, y, z) {
    const cam = this.c.camera
    const B = this.s.B
    const look = cam.getWorldDirection(new THREE.Vector3())
    const to = new THREE.Vector3(x * B, y * B, z * B).sub(cam.position).normalize()
    return look.dot(to) >= FACING
  }

  // Into the go-kart or the nearest free vehicle. lookAt: only one in
  // front (LT), not just near (Y). true if Player 2 got in.
  enter(lookAt) {
    const s = this.s
    const p = this.p
    if (this.ride || s.dead) return false
    const kart = s.kart
    const kartD = kart?.group && !kart.driving && !kart.p2 ? Math.hypot(kart.x - p.x, kart.z - p.z) : Infinity
    const v = s.vehicles?._nearest(ENTER_REACH, p) || null
    const vD = v ? Math.hypot(v.x - p.x, v.z - p.z) : Infinity
    if (lookAt) this.c._placeCamera()
    const tryKart = () => kartD <= ENTER_REACH && (!lookAt || this._facing(kart.x, kart.y + 0.4, kart.z)) && kart.enterP2(p)
    const tryVeh = () => v && (!lookAt || this._facing(v.x, v.y + 0.6, v.z)) && s.vehicles.enterP2(p)
    let got = null
    if (kartD <= vD) got = tryKart() ? { kind: 'kart' } : null
    if (!got) {
      const in2 = tryVeh()
      if (in2) got = { kind: 'veh', v: in2 }
    }
    if (!got && kartD > vD && tryKart()) got = { kind: 'kart' }
    if (!got) return false
    this.ride = got
    this.dig = null
    p.vx = p.vy = p.vz = 0
    this.c.p2Message(t('couchRideHint'), 4)
    return true
  }

  // Out, standing beside it. force: even a helicopter up high (knocked
  // down, game over).
  leave(force = false) {
    const r = this.ride
    if (!r) return
    const s = this.s
    let at = null
    if (r.kind === 'kart') at = s.kart?.p2 ? s.kart.leaveP2() : null
    else if (s.vehicles?.p2Riding === r.v) {
      at = s.vehicles.leaveP2(force)
      if (!at && !force) {
        this.c.p2Message(t('vehicleLandFirst'), 2)
        return
      }
    }
    this.ride = null
    const p = this.p
    if (at) {
      p.x = at.x
      p.y = at.y
      p.z = at.z
    }
    p.vx = p.vy = p.vz = 0
  }

  // Driving (CouchCoop.update instead of walking): the left stick, A up,
  // B down; Player 2 sits in the seat.
  drive(dt) {
    const r = this.ride
    const s = this.s
    const p = this.p
    // Gone from under them (the run ended, too many out...).
    if (r.kind === 'kart' ? !s.kart?.p2 : s.vehicles?.p2Riding !== r.v) {
      this.ride = null
      return
    }
    const mv = p.isDown ? null : this.c._move
    const input = { stick: mv ? { x: mv.x, y: mv.y } : null, up: !p.isDown && this.c.down.has(B_A), down: !p.isDown && this.c.down.has(B_B) }
    let seat
    if (r.kind === 'kart') {
      const kart = s.kart
      // Running zombies over pays Player 2 (BuildSurvival.damageZombie).
      s._p2Shot = true
      try {
        kart.drive(dt, input)
      } finally {
        s._p2Shot = false
      }
      seat = { x: kart.x, y: kart.y + (kart.lift || 0), z: kart.z, eye: KART_EYE }
    } else {
      s.vehicles.driveP2(dt, p.yaw, input, (text, secs) => this.c.p2Message(text, secs))
      seat = s.vehicles.seat(r.v)
    }
    if (!seat) return
    p.x = seat.x
    p.y = seat.y + seat.eye - EYE
    p.z = seat.z
    p.vx = p.vy = p.vz = 0
    p.onGround = true
  }

  // A line for Player 2's HUD while driving (fuel left), or ''.
  rideText() {
    const v = this.ride?.v
    if (!v || !FUELLED.has(v.kind)) return ''
    return t('couchFuel', { n: Math.max(0, Math.ceil(v.fuel || 0)) })
  }

  dispose() {
    this.fishing.clear()
    const s = this.s
    if (s.kart?.p2) s.kart.p2 = false
    if (s.vehicles) s.vehicles.p2Riding = null
    this.ride = null
    this.dig = null
  }
}

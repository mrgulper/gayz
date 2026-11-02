// Riding animals (2026-11-01, Gaymi's idea list 3: "you can already tame
// animals, but you can't ride them yet"). Look at one of your own tamed
// pets that's big enough (rideable: no swimmers, flyers or dinosaurs,
// and at least MIN_HEIGHT blocks tall - horses, cows, camels, bears...)
// and press Use (E) to climb on; Use again to get off. While riding, the
// move keys / stick run it where you look (RIDE_SPEED x its own speed),
// Jump hops (JUMP_V), and it steps up one block like it does on foot.
// Shooting and looking round go on as usual. You get off on your own if
// you die or start spectating.
//
// Alone or as a server's host only (a guest's pets are run by the host).
// Owned by BuildSurvival (`s.riding`); BuildTryMode.update hands it the
// keys and seats you (drive / seat), BuildMode's Use goes to use().
import { t } from './i18n.js'
import { animalKind, animalNameKey } from './PlayAnimals.js'

const REACH = 4.5
export const MIN_HEIGHT = 1.2
export const RIDE_SPEED = 7.5 // blocks per second
const BACK_SPEED = 3
const JUMP_V = 8
const GRAVITY = 24
const EYE = 1.15 // above its back

export function rideable(kind) {
  const k = animalKind(kind)
  return !!k && !k.swim && !k.fly && !k.dino && k.leg + k.body[1] >= MIN_HEIGHT
}

export class AnimalRiding {
  constructor(survival) {
    this.s = survival
    this.mount = null
    this._vy = 0
  }

  get on() {
    return !!this.mount
  }

  // Use (E): off if riding, else onto my own tamed pet in view. -> true if handled.
  use() {
    const s = this.s
    if (this.mount) {
      this.leave()
      return true
    }
    if (s.net && !s.net.isHost) return false
    const animals = s.animals
    if (!animals) return false
    const bm = s.bm
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const a = animals._onRay(bm._raycaster.ray, REACH * s.B)
    if (!a || !a.tamed || a.owner) return false
    if (!rideable(a.kind)) {
      s._message(t('rideTooSmall', { name: t(animalNameKey(a.kind)) }), 3)
      return true
    }
    this.mount = a
    a.ridden = true
    this._vy = 0
    s._message(t('rideOn', { name: t(animalNameKey(a.kind)) }), 3)
    return true
  }

  leave() {
    const a = this.mount
    if (!a) return
    a.ridden = false
    this.mount = null
    // Step off beside it.
    const s = this.s
    const side = a.heading + Math.PI / 2
    const x = a.x + Math.sin(side) * 1.2
    const z = a.z + Math.cos(side) * 1.2
    const y = s._groundUnder(x, a.y + 2, z)
    s.bm.tryMode.pos.set(x, Math.abs(y - a.y) < 2 ? y : a.y, z)
  }

  // The keys this frame (BuildTryMode.update).
  drive(dt, { fwd, back, left, right, stick, jump }) {
    const a = this.mount
    if (!a) return
    const s = this.s
    const k = animalKind(a.kind)
    if (a.dying || s.dead || s.spectating || !s.animals.list.includes(a)) {
      this.leave()
      return
    }
    const yaw = s.bm._yaw
    let push = 0
    let sideways = 0
    if (fwd) push += 1
    if (back) push -= 1
    if (right) sideways += 1
    if (left) sideways -= 1
    if (stick) {
      push += stick.y
      sideways += stick.x
    }
    push = Math.max(-1, Math.min(1, push))
    sideways = Math.max(-1, Math.min(1, sideways))
    // It faces where you look; the side keys sidestep a little.
    a.heading = yaw + Math.PI
    const speed = push >= 0 ? push * RIDE_SPEED * (k.speed || 1) : push * BACK_SPEED
    const fx = Math.sin(a.heading)
    const fz = Math.cos(a.heading)
    const mx = fx * speed + fz * sideways * -2.5
    const mz = fz * speed - fx * sideways * -2.5
    const moving = Math.hypot(mx, mz) > 0.05
    const onGround = a.y <= (a.groundY ?? a.y) + 0.02
    if (jump && onGround) this._vy = JUMP_V
    if (moving) {
      for (const [dx, dz] of [[mx * dt, mz * dt], [mx * dt, 0], [0, mz * dt]]) {
        const nx = a.x + dx
        const nz = a.z + dz
        const ground = s._groundUnder(nx, a.y + 1.1, nz)
        const wet = s.bm._cellIsLiquid(Math.floor(nx), Math.floor(ground + 0.01), Math.floor(nz))
        if (ground > a.y + 1.05 || wet) continue
        // Room for its body (and you on top).
        let blocked = false
        for (let dy = 1; dy < 3 && !blocked; dy++) blocked = s.bm._cellSolidTop(Math.floor(nx), Math.floor(Math.max(ground, a.y) + 0.01) + dy, Math.floor(nz)) > 0
        if (blocked) continue
        a.x = nx
        a.z = nz
        break
      }
    }
    a.groundY = s._groundUnder(a.x, a.y + 1.1, a.z)
    this._vy -= GRAVITY * dt
    a.y += this._vy * dt
    // Lands, or steps up onto the next block.
    if (a.y <= a.groundY) {
      a.y = a.groundY
      this._vy = 0
    }
    a.walk = (a.walk || 0) + dt * Math.hypot(mx, mz) * 3
    const swing = moving ? Math.sin(a.walk) * 0.8 : 0
    a.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? 1 : -1) * swing })
    a.group.rotation.y = a.heading
    a.group.rotation.x = 0
    a.group.position.set(a.x * s.B, a.y * s.B, a.z * s.B)
  }

  // Where you sit: on its back.
  seat() {
    const a = this.mount
    if (!a) return null
    const k = animalKind(a.kind)
    return { x: a.x, y: a.y + k.leg + k.body[1] * 0.85, z: a.z, eye: EYE }
  }

  clear() {
    if (this.mount) this.mount.ridden = false
    this.mount = null
  }
}

// The Golden Runner (2026-11-01, Gaymi's idea list: "a rare shiny zombie
// that runs away from you - catch it and a pile of coins bursts out").
// One of the random world events (WorldEvents.js `golden`): a glowing gold
// zombie turns up NEAR..FAR blocks away under a gold light beam and runs
// from you. Every few seconds it stops to dance and taunt you, and it
// tires as it goes (RUN_SPEED down to TIRED_SPEED), so a sprint catches it.
// Touch it (CATCH_R) and it bursts into coins - COINS + COINS_PER_WAVE x
// the wave, through BuildSurvival._earn (so a Blood Moon doubles them).
// After LIFE_S it digs into the ground and escapes.
//
// It can't be shot (it isn't one of the zombies) - you catch it by running.
// Alone or a server's host only, like the other world events (the others
// on a server don't see it). Meshes only, never a light.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { nameTag } from './BuildCamp.js'

const NEAR = 12
const FAR = 20
export const LIFE_S = 50
const RUN_SPEED = 6.2 // blocks / s: faster than walking (4), not sprinting (7)
const TIRED_SPEED = 4.6
const RUN_S = [2.2, 3.6] // runs this long...
const TAUNT_S = [1.1, 1.8] // ...then stops to dance this long
const CATCH_R = 1.4
const SCARED_R = 18 // further away than this it just wanders
export const COINS = 100
export const COINS_PER_WAVE = 20
const BURST = 24 // coins flying out
const DIG_S = 1.2

const between = ([a, b]) => a + Math.random() * (b - a)

function gold() {
  return new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x6b4a00 })
}

// A blocky 2-block-tall body: legs, body, arms and head.
function makeBody(B) {
  const g = new THREE.Group()
  const part = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
    m.position.set(x * B, y * B, z * B)
    return m
  }
  const pivot = (x, y) => {
    const p = new THREE.Group()
    p.position.set(x * B, y * B, 0)
    return p
  }
  const legL = pivot(-0.13, 0.75)
  legL.add(part(0.24, 0.75, 0.24, 0, -0.375, 0, gold()))
  const legR = pivot(0.13, 0.75)
  legR.add(part(0.24, 0.75, 0.24, 0, -0.375, 0, gold()))
  const armL = pivot(-0.38, 1.45)
  armL.add(part(0.22, 0.7, 0.22, 0, -0.33, 0, gold()))
  const armR = pivot(0.38, 1.45)
  armR.add(part(0.22, 0.7, 0.22, 0, -0.33, 0, gold()))
  const body = part(0.52, 0.75, 0.3, 0, 1.125, 0, gold())
  const head = part(0.5, 0.5, 0.5, 0, 1.75, 0, gold())
  // A cheeky face: two dark eyes and a grin, on the front (+z).
  const dark = new THREE.MeshBasicMaterial({ color: 0x3a2400 })
  const eyeL = part(0.09, 0.09, 0.02, -0.11, 1.8, 0.26, dark)
  const eyeR = part(0.09, 0.09, 0.02, 0.11, 1.8, 0.26, dark.clone())
  const grin = part(0.26, 0.05, 0.02, 0, 1.64, 0.26, dark.clone())
  g.add(legL, legR, armL, armR, body, head, eyeL, eyeR, grin)
  g.userData.limbs = { legL, legR, armL, armR }
  return g
}

function dispose(obj) {
  obj.removeFromParent()
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    o.material.map?.dispose()
    o.material.dispose()
  })
}

// Starts one near `me` for BuildSurvival `s`. -> the event's run
// ({ update(dt) -> false when over, dispose() }), or null if there's
// nowhere to put it.
export function goldenRunner(s, me) {
  const B = s.B
  let spot = null
  for (let i = 0; i < 12 && !spot; i++) {
    const a = Math.random() * Math.PI * 2
    const d = NEAR + Math.random() * (FAR - NEAR)
    const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
    const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
    if (s.camp?.inside(x, z, 2)) continue
    const y = s._groundUnder(x, me.y + 12, z)
    if (Math.abs(y - me.y) > 8 || s.bm._cellIsLiquid(Math.floor(x), Math.floor(y - 0.5), Math.floor(z))) continue
    spot = { x, y, z }
  }
  if (!spot) return null
  const scene = s.bm.scene
  const group = new THREE.Group()
  const body = makeBody(B)
  const tag = nameTag(t('goldenRunnerName'), B)
  // A gold light beam shows where it is from far away (unlit, see-through).
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3 * B, 30 * B, 0.3 * B), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.3, depthWrite: false }))
  beam.position.y = 17 * B
  group.add(body, tag, beam)
  scene.add(group)
  const r = { ...spot, heading: Math.random() * Math.PI * 2, age: 0, phase: 'run', phaseLeft: between(RUN_S), digging: 0, coins: [], done: false }
  s._message(t('goldenRunnerAppeared'), 5)
  try { audioEngine.playSpecial?.('goldZombie') } catch { /* no audio */ }

  const place = () => {
    group.position.set(r.x * B, r.y * B, r.z * B)
    body.rotation.y = r.heading
  }
  place()

  // Can it step onto (nx, nz)? -> the ground's height there, or null.
  const stepTo = (nx, nz) => {
    if (s.camp?.inside(nx, nz, 1)) return null
    const gy = s._groundUnder(nx, r.y + 1.2, nz)
    if (gy > r.y + 1.1 || gy < r.y - 3) return null
    // Two blocks of room for its body.
    for (let dy = 0; dy < 2; dy++) if (s.bm._cellSolidTop(Math.floor(nx), Math.floor(gy + 0.01) + dy, Math.floor(nz)) > 0) return null
    if (s.bm._cellIsLiquid(Math.floor(nx), Math.floor(gy - 0.5), Math.floor(nz))) return null
    return gy
  }

  const burst = () => {
    const n = COINS + COINS_PER_WAVE * (s.wave || 0)
    const before = s._coinsEarned
    s._earn(n)
    s._message(t('goldenRunnerCaught', { n: s._coinsEarned - before }), 5)
    s._renderHud()
    try { audioEngine.playSpecial?.('diamondZombie') } catch { /* no audio */ }
    body.visible = false
    tag.visible = false
    beam.visible = false
    const geo = new THREE.BoxGeometry(0.22 * B, 0.22 * B, 0.06 * B)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0x7a5200 })
    r.coinGeo = geo
    r.coinMat = mat
    for (let i = 0; i < BURST; i++) {
      const m = new THREE.Mesh(geo, mat)
      const a = Math.random() * Math.PI * 2
      const out = 2 + Math.random() * 3
      m.position.set(0, 1.2 * B, 0)
      group.add(m)
      r.coins.push({ m, vx: Math.cos(a) * out, vy: 5 + Math.random() * 4, vz: Math.sin(a) * out, t: 0, spin: 6 + Math.random() * 8 })
    }
    r.caught = true
  }

  // The coins pop out, fall, then fly into you.
  const updateCoins = (dt, me) => {
    let left = 0
    for (const c of r.coins) {
      if (!c.m.visible) continue
      c.t += dt
      c.m.rotation.y += c.spin * dt
      if (c.t < 0.7) {
        c.vy -= 18 * dt
        c.m.position.x += c.vx * dt * B
        c.m.position.y = Math.max(0.15 * B, c.m.position.y + c.vy * dt * B)
        c.m.position.z += c.vz * dt * B
      } else {
        const to = new THREE.Vector3((me.x - r.x) * B, (me.y - r.y + 1) * B, (me.z - r.z) * B)
        const step = Math.min(1, dt * 7)
        c.m.position.lerp(to, step)
        if (c.m.position.distanceTo(to) < 0.3 * B || c.t > 2.2) c.m.visible = false
      }
      left++
    }
    return left > 0
  }

  return {
    // Where it is and how it's doing (tests).
    runner: r,
    update: (dt) => {
      const me = s.bodyPos()
      if (r.caught) return updateCoins(dt, me)
      r.age += dt
      beam.material.opacity = 0.22 + Math.sin(performance.now() / 250) * 0.08
      const time = performance.now() / 1000
      const lp = body.userData.limbs
      // Out of time: it digs into the ground and is gone.
      if (r.age >= LIFE_S) {
        if (!r.digging) s._message(t('goldenRunnerEscaped'), 4)
        r.digging += dt
        body.position.y = -2 * B * (r.digging / DIG_S)
        body.rotation.y += dt * 12
        return r.digging < DIG_S
      }
      const dx = r.x - me.x
      const dz = r.z - me.z
      const dist = Math.hypot(dx, dz)
      if (!s.dead && dist < CATCH_R && Math.abs(me.y - r.y) < 2) {
        burst()
        return true
      }
      r.phaseLeft -= dt
      if (r.phaseLeft <= 0) {
        r.phase = r.phase === 'run' ? 'taunt' : 'run'
        r.phaseLeft = between(r.phase === 'run' ? RUN_S : TAUNT_S)
      }
      if (r.phase === 'taunt') {
        // Faces you and dances, arms up.
        r.heading = Math.atan2(-dx, -dz)
        lp.armL.rotation.x = -Math.PI * 0.9 + Math.sin(time * 14) * 0.3
        lp.armR.rotation.x = -Math.PI * 0.9 - Math.sin(time * 14) * 0.3
        lp.legL.rotation.x = 0
        lp.legR.rotation.x = 0
        body.position.y = Math.abs(Math.sin(time * 9)) * 0.25 * B
        place()
        return true
      }
      // Runs away from you (wanders when you're far), wobbling a bit.
      const want = dist < SCARED_R ? Math.atan2(dx, dz) + Math.sin(time * 1.7) * 0.6 : r.heading + Math.sin(time * 0.8) * 0.02
      let diff = want - r.heading
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      r.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 5)
      const tired = Math.min(1, r.age / LIFE_S)
      const speed = (RUN_SPEED + (TIRED_SPEED - RUN_SPEED) * tired) * (dist < SCARED_R ? 1 : 0.4)
      const nx = r.x + Math.sin(r.heading) * speed * dt
      const nz = r.z + Math.cos(r.heading) * speed * dt
      const gy = stepTo(nx, nz)
      if (gy === null) {
        // A wall, a drop or water: try another way.
        r.heading += (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 3 + Math.random() * Math.PI / 3)
      } else {
        r.x = nx
        r.z = nz
        r.y += (gy - r.y) * Math.min(1, dt * 12)
      }
      const swing = Math.sin(time * 16) * 0.9
      lp.legL.rotation.x = swing
      lp.legR.rotation.x = -swing
      lp.armL.rotation.x = -swing
      lp.armR.rotation.x = swing
      body.position.y = 0
      place()
      return true
    },
    dispose: () => {
      dispose(group)
      r.coinGeo?.dispose()
      r.coinMat?.dispose()
    },
  }
}

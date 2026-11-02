// Escort missions (2026-11-02, Gaymi's idea list 4: "Protect a slow
// survivor or bus all the way to the exit while zombies go after it
// instead of you" - Gaymi picked "both, as a random event"). One of the
// random world events (WorldEvents.js `escort`), alone or a server's host.
//
// A survivor (or a yellow school bus, half the time) turns up next to you
// and needs to get to an exit EXIT_STEPS..EXIT_FAR walking steps away,
// marked by a green beam. The way there is worked out once, along the
// cells zombies can walk (BuildSurvival._neighbors), ending outside the
// camp. It only moves while you stay within FOLLOW_R blocks, and waits for
// you otherwise. Every zombie within PULL_R blocks of it goes for it
// instead of you (WorldEvents.target), and more keep coming (EXTRA_EVERY
// seconds, up to EXTRA_MAX at once). Its health shows in a bar at the top.
//
// Gets there: coins (COINS[kind] + COINS_PER_WAVE x the wave) and BONUS_XP
// at the end of the game. Its health runs out: the mission is lost, nothing
// else happens. Meshes only, never a light.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { nameTag } from './BuildCamp.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { MOB_HEIGHT } from './PlayRules.js'

export const KINDS = ['survivor', 'bus']
export const SPEED = { survivor: 2.2, bus: 1.7 } // blocks / s
export const HEALTH = { survivor: 150, bus: 400 }
export const COINS = { survivor: 150, bus: 250 }
export const COINS_PER_WAVE = 15
export const BONUS_XP = 75
export const EXIT_STEPS = 45
export const EXIT_FAR = 70
export const FOLLOW_R = 12
export const PULL_R = 26
export const EXTRA_EVERY = 5
export const EXTRA_MAX = 8
const MIN_STEPS = 20
const SEARCH_MAX = 30000
const EXIT_R = 1.5
const BEAM_H = 30

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra })

function dispose(obj) {
  obj.removeFromParent()
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    o.material.map?.dispose()
    o.material.dispose()
  })
}

// A blocky yellow school bus, 2 wide and 4 long, facing +z.
function makeBus(B) {
  const g = new THREE.Group()
  const box = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
    m.position.set(x * B, y * B, z * B)
    g.add(m)
    return m
  }
  box(2, 1.5, 4, 0, 1.05, 0, lambert(0xf2c12e))
  box(2.02, 0.12, 4.02, 0, 0.55, 0, lambert(0x1e1e1e))
  box(2.02, 0.12, 4.02, 0, 1.2, 0, lambert(0x1e1e1e))
  // Windows down both sides and the windscreen.
  const glass = lambert(0x9ad4ee)
  for (let i = 0; i < 4; i++) {
    box(0.04, 0.45, 0.6, -1.01, 1.5, -1.4 + i * 0.85, glass)
    box(0.04, 0.45, 0.6, 1.01, 1.5, -1.4 + i * 0.85, glass)
  }
  box(1.7, 0.5, 0.04, 0, 1.5, 2.01, glass)
  const wheel = lambert(0x222222)
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) box(0.25, 0.6, 0.6, x, 0.3, z, wheel)
  return g
}

// A survivor in the default skin (the body arrives once it has loaded).
function makeSurvivor(B, group) {
  loadSkinTexture(DEFAULT_SKIN_DATA_URL).then((skin) => {
    if (!group.parent) return
    const body = buildTexturedCharacter(skin)
    const sc = (MOB_HEIGHT * B) / 32
    body.scale.setScalar(sc)
    body.position.y = 2 * sc
    group.add(body)
  }).catch(() => {
    // No skin: a plain blocky body instead.
    if (!group.parent) return
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6 * B, MOB_HEIGHT * B, 0.4 * B), lambert(0x4a7ab0))
    m.position.y = (MOB_HEIGHT / 2) * B
    group.add(m)
  })
}

// The way from `from` (a cell) to a cell EXIT_STEPS..EXIT_FAR steps off,
// or the farthest one found if it's at least MIN_STEPS. -> [[x, y, z], ...]
export function findEscortPath(s, from) {
  const key = (x, y, z) => `${x},${y},${z}`
  const prev = new Map([[key(...from), null]])
  const cells = new Map([[key(...from), from]])
  let ring = [from]
  let steps = 0
  let best = null
  const out = []
  const want = EXIT_STEPS + Math.floor(Math.random() * (EXIT_FAR - EXIT_STEPS))
  while (ring.length && steps < want && prev.size < SEARCH_MAX) {
    const next = []
    for (const c of ring) {
      for (const [x, y, z] of s._neighbors(c[0], c[1], c[2], out)) {
        const k = key(x, y, z)
        if (prev.has(k) || s.bm._cellIsLiquid?.(x, y - 1, z)) continue
        prev.set(k, key(...c))
        cells.set(k, [x, y, z])
        next.push([x, y, z])
      }
    }
    if (!next.length) break
    steps++
    ring = next
    best = ring
  }
  if (!best || steps < MIN_STEPS) return null
  // Of the farthest ring (outside the camp), the cell farthest from the
  // start in a straight line (so it doesn't just wind round the block).
  const open = best.filter((c) => !s.camp?.inside(c[0] + 0.5, c[2] + 0.5, 2))
  if (!open.length) return null
  let end = open[0]
  let endD = -1
  for (const c of open) {
    const d = (c[0] - from[0]) ** 2 + (c[2] - from[2]) ** 2
    if (d > endD) {
      endD = d
      end = c
    }
  }
  const path = []
  for (let k = key(...end); k; k = prev.get(k)) path.push(cells.get(k))
  return path.reverse()
}

// Starts one near `me` for BuildSurvival `s`. -> the event's run
// ({ update(dt) -> false when over, dispose(), target(zb) }), or null.
export function escortMission(s, me, kind = KINDS[Math.floor(Math.random() * KINDS.length)]) {
  const path = findEscortPath(s, s._playerCell(me))
  if (!path) return null
  const B = s.B
  const scene = s.bm.scene
  const start = path[Math.min(2, path.length - 1)]
  const r = {
    kind,
    x: start[0] + 0.5,
    y: start[1],
    z: start[2] + 0.5,
    heading: 0,
    health: HEALTH[kind],
    max: HEALTH[kind],
    i: Math.min(3, path.length - 1),
    path,
    extraIn: EXTRA_EVERY,
    extras: [],
    waiting: false,
    over: '',
    endT: 0,
  }
  const group = new THREE.Group()
  const model = new THREE.Group()
  group.add(model)
  if (kind === 'bus') model.add(makeBus(B))
  else makeSurvivor(B, model)
  const tag = nameTag(t(kind === 'bus' ? 'escortBusName' : 'escortSurvivorName'), B)
  if (kind === 'bus') tag.position.y += 0.6 * B
  group.add(tag)
  scene.add(group)
  // The exit: a green beam and a flag.
  const end = path[path.length - 1]
  const exit = new THREE.Group()
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5 * B, BEAM_H * B, 0.5 * B), new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.3, depthWrite: false }))
  beam.position.y = (BEAM_H / 2) * B
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1 * B, 2.6 * B, 0.1 * B), lambert(0xdddddd))
  pole.position.y = 1.3 * B
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.8 * B, 0.5 * B, 0.04 * B), lambert(0x33cc66))
  flag.position.set(0.42 * B, 2.3 * B, 0)
  exit.add(beam, pole, flag)
  exit.position.set((end[0] + 0.5) * B, end[1] * B, (end[2] + 0.5) * B)
  scene.add(exit)
  // The health bar at the top of the screen.
  const bar = document.createElement('div')
  bar.id = 'escort-bar'
  bar.innerHTML = '<span class="escort-name"></span><span class="escort-track"><span></span></span><span class="escort-left"></span>'
  document.body.appendChild(bar)
  const renderBar = () => {
    bar.querySelector('.escort-name').textContent = t(kind === 'bus' ? 'escortBusName' : 'escortSurvivorName')
    bar.querySelector('.escort-track span').style.width = `${Math.max(0, (r.health / r.max) * 100)}%`
    bar.querySelector('.escort-left').textContent = r.waiting ? t('escortWaiting') : t('escortLeft', { n: Math.max(0, path.length - 1 - r.i) })
  }
  renderBar()
  s._message(t(kind === 'bus' ? 'escortBusStart' : 'escortSurvivorStart'), 6)
  try { audioEngine.playSpecial?.('goldZombie') } catch { /* no audio */ }

  const place = () => {
    group.position.set(r.x * B, r.y * B, r.z * B)
    model.rotation.y = r.heading
  }
  place()

  const finish = (won) => {
    r.over = won ? 'won' : 'lost'
    r.endT = 2.5
    if (won) {
      const before = s._coinsEarned
      s._earn(COINS[kind] + COINS_PER_WAVE * (s.wave || 0))
      s._bonusXp = (s._bonusXp || 0) + BONUS_XP
      s.stats.escorts = (s.stats.escorts || 0) + 1
      s._message(t('escortWon', { n: s._coinsEarned - before, xp: BONUS_XP }), 6)
      try { audioEngine.playSpecial?.('diamondZombie') } catch { /* no audio */ }
    } else {
      s._message(t(kind === 'bus' ? 'escortBusLost' : 'escortSurvivorLost'), 6)
      if (kind === 'bus') s._fx?.explode(new THREE.Vector3(r.x * B, (r.y + 1) * B, r.z * B), 3)
      model.visible = false
      tag.visible = false
    }
    // Its zombies go back to chasing you.
    for (const zb of s.zombies) if (zb.escortFor === r) zb.escortFor = null
    s._renderHud()
  }

  // More zombies come for it now and then, from a little way off.
  const sendExtra = () => {
    r.extras = r.extras.filter((zb) => s.zombies.includes(zb))
    if (r.extras.length >= EXTRA_MAX) return
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2
      const d = 14 + Math.random() * 6
      const x = Math.floor(r.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(r.z + Math.sin(a) * d) + 0.5
      if (s.camp?.inside(x, z, 2)) continue
      const y = s._groundUnder(x, r.y + 8, z)
      if (!Number.isFinite(y) || Math.abs(y - r.y) > 6) continue
      const zb = s._extraZombie(x, y, z)
      if (zb) {
        zb.escortFor = r
        r.extras.push(zb)
      }
      return
    }
  }

  // A zombie's bite.
  const hurt = (n) => {
    if (r.over) return
    r.health -= n
    model.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(0.5, 0, 0) })
    r.flash = 0.15
    renderBar()
    if (r.health <= 0) finish(false)
  }

  return {
    escort: r,
    hurt,
    // Where a zombie heads: at it, if it's close enough (WorldEvents.target).
    target: (zb) => {
      if (r.over) return null
      if (zb.escortFor !== r && Math.hypot(zb.x - r.x, zb.z - r.z) > PULL_R) return null
      zb.escortFor = r
      return { x: r.x, y: r.y, z: r.z, lure: true, reach: kind === 'bus' ? 2.1 : 1.1, hurt }
    },
    update: (dt) => {
      if (r.over) {
        r.endT -= dt
        bar.style.opacity = String(Math.max(0, r.endT / 2.5))
        return r.endT > 0
      }
      if (r.flash > 0 && (r.flash -= dt) <= 0) model.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(0, 0, 0) })
      beam.material.opacity = 0.22 + Math.sin(performance.now() / 250) * 0.08
      if ((r.extraIn -= dt) <= 0) {
        r.extraIn = EXTRA_EVERY
        sendExtra()
      }
      const me = s.bodyPos()
      const wasWaiting = r.waiting
      r.waiting = s.dead || Math.hypot(me.x - r.x, me.z - r.z) > FOLLOW_R
      if (!r.waiting) {
        let move = SPEED[kind] * dt
        while (move > 0 && r.i < path.length) {
          const [cx, cy, cz] = path[r.i]
          const tx = cx + 0.5
          const tz = cz + 0.5
          const dx = tx - r.x
          const dz = tz - r.z
          const d = Math.hypot(dx, dz)
          if (d > 0.01) {
            const want = Math.atan2(dx, dz)
            let diff = want - r.heading
            diff = Math.atan2(Math.sin(diff), Math.cos(diff))
            r.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * (kind === 'bus' ? 3 : 8))
          }
          const step = Math.min(d, move)
          r.x += (dx / (d || 1)) * step
          r.z += (dz / (d || 1)) * step
          r.y += (cy - r.y) * Math.min(1, dt * 10)
          move -= step
          if (d - step < 0.05) r.i++
        }
        // The walk.
        const body = model.children[0]
        if (body && kind === 'survivor') body.position.y = Math.abs(Math.sin(performance.now() / 140)) * 0.06 * B + (MOB_HEIGHT * B) / 16
        else if (body) body.position.y = Math.sin(performance.now() / 90) * 0.03 * B
      }
      place()
      if (wasWaiting !== r.waiting || Math.random() < dt * 4) renderBar()
      if (r.i >= path.length || Math.hypot(r.x - end[0] - 0.5, r.z - end[2] - 0.5) < EXIT_R * 0.3) finish(true)
      return true
    },
    dispose: () => {
      for (const zb of s.zombies) if (zb.escortFor === r) zb.escortFor = null
      dispose(group)
      dispose(exit)
      bar.remove()
    },
  }
}

// Play: survive zombies on your own map (2026-10-04). Owned by BuildMode
// (`buildMode.survival`); runs on top of Try Map (BuildTryMode), which
// already does the walking, the gun and the shooting sound.
//
// You start on the map's Player Start block (or wherever you are, if it
// has none) with a full gun. Zombies come in waves from the Zombie
// Spawner blocks (or out of sight somewhere you can be reached, if there
// are none), find their way to you through the map - round walls, up
// stairs and ladders, through open doors, and they bash closed doors open
// after a few seconds - and hit you when they're close. Loot Chests give
// ammo and health once per wave. Each wave has more zombies, a little
// faster and tougher. Your best wave per map is remembered.
//
// The way to you is a flood fill (breadth-first search) over the cells a
// zombie can stand in, started from your feet and redone every
// PATH_REFRESH seconds; each zombie walks to whichever neighboring cell is
// one step closer to you.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { audioEngine } from './Audio.js'
import { getKeyFor } from './Keybinds.js'
import { t } from './i18n.js'
import { BuildCamp, COIN_PER_KILL, COIN_PER_WAVE } from './BuildCamp.js'
import { PLAY_DEFAULTS, DEFENSE_WAVES, BOSS_HEALTH_MULT, BOSS_DAMAGE_MULT, BOSS_SIZE, BOSS_COINS, RUSH_WAVE_BREAK, RUSH_SPAWN_GAP_MULT, REGEN_DELAY, REGEN_PER_SECOND } from './PlayRules.js'

export const PLAY_START = { health: 100, mag: 30, reserve: 120 }
export const CHEST_LOOT = { ammo: 60, health: 35 }
const MAG_SIZE = 30
const RELOAD_TIME = 1.6
const SHOT_DAMAGE = 34
const HEAD_MULT = 2.4
const ZOMBIE_HEIGHT = 1.85
const ZOMBIE_HALF = 0.3
const ATTACK_RANGE = 0.95
const ATTACK_COOLDOWN = 1
const DOOR_BASH_TIME = 3
const WAVE_BREAK = 6
const SPAWN_GAP = 1.1
const MAX_ALIVE = 16
const PATH_REFRESH = 0.5
const PATH_MAX_NODES = 9000
const GRAVITY = 30
const JUMP = 8.8
const CLIMB = 3
const BEST_KEY = 'buildmode-play-best'

export function waveSize(wave) {
  return 3 + wave * 2
}
// escalation (the mutator): no top speed, and health climbs faster.
export function zombieSpeed(wave, escalation = false) {
  const speed = 2.1 + wave * 0.12
  return escalation ? speed : Math.min(3.6, speed)
}
export function zombieHealth(wave, escalation = false) {
  return 100 + (wave - 1) * (escalation ? 20 : 12)
}
export function zombieDamage(wave) {
  return 9 + wave
}

// The zombies' skin, made in GayZ's own Design a Skin (2026-10-05 - the
// first one copied Minecraft's zombie colors). Loaded once.
export const ZOMBIE_SKIN_URL = '/images/npc/zombie.png'
let _skinPromise = null
function zombieSkin() {
  if (!_skinPromise) _skinPromise = loadSkinTexture(ZOMBIE_SKIN_URL)
  return _skinPromise
}

export class BuildSurvival {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.active = false
    this.dead = false
    this.zombies = []
    this._flow = new Map()
    this._flowAt = 0
    this._ray = new THREE.Ray()
    this._v = new THREE.Vector3()
  }

  // --- start / stop ---

  // fromMenu: started from the homepage's Play (Back goes to the homepage).
  // Those runs use the Game Mode panel's picks and the Upgrades bought
  // (Game._playConfig, PlayRules.js) and count toward stats and quests;
  // the Map Editor's own Play is a plain sandbox.
  start({ fromMenu = false } = {}) {
    const bm = this.bm
    this.cfg = { ...PLAY_DEFAULTS, ...(fromMenu ? bm.game?._playConfig?.() : null) }
    if (bm.tryMode.active) bm.toggleTryMode()
    if (bm.menuOpen) bm.toggleMenu()
    this.fromMenu = fromMenu
    const start = this._findBlocks('playerstart')[0] || this._defaultStart()
    if (start) {
      const [x, y, z] = start
      bm.camera.position.set((x + 0.5) * this.B, (y + 1.62) * this.B, (z + 0.5) * this.B)
      // Face the way its arrow points (facing 0 = toward +z).
      bm._yaw = Math.PI - (bm._stairFacing.get(bm._key(x, y, z)) || 0) * (Math.PI / 2)
      bm._pitch = 0
    }
    this.active = true
    this.dead = false
    this.health = this.cfg.maxHealth
    this.maxHealth = this.cfg.maxHealth
    this.armor = this.cfg.armor
    this.coins = this.cfg.startCoins
    this.upgrades = {}
    this.stats = { kills: 0, chests: 0, headshots: 0 }
    this.streak = 0
    this.bestStreak = 0
    this.bosses = 0
    this._bossPending = 0
    this._ended = false
    this._won = false
    this._startedAt = performance.now()
    this._hurtAt = 0
    this._coinsEarned = 0
    bm.tryMode.speedMult = this.cfg.moveMult
    this.mag = PLAY_START.mag
    this.reserve = PLAY_START.reserve
    this.wave = 0
    this.kills = 0
    this._toSpawn = 0
    this._spawnTimer = 0
    this._breakTimer = 2
    this._reloadLeft = 0
    this._chestsUsed = new Set()
    this._flow.clear()
    this._flowAt = 0
    bm.toggleTryMode()
    // Map 3's walled camp is a safe zone with NPCs (BuildCamp.js).
    this.camp?.dispose()
    const zone = bm.activeSlot === 'map3' ? bm._map3Base().map.safeZone : null
    this.camp = zone ? new BuildCamp(this, zone, this.B) : null
    this._ensureHud()
    this._hud.style.display = 'block'
    this._overEl.style.display = 'none'
    this._message(t('buildPlayGetReady'))
    this._renderHud()
    document.getElementById('build-mode-play-btn-label')?.replaceChildren(t('buildModePlayStopBtn'))
    zombieSkin().then((skin) => { this._skin = skin }).catch(() => { this._skin = null })
  }

  // leaveTry: false when Try Map itself is being left (T / Escape menu).
  stop({ leaveTry = true } = {}) {
    if (!this.active) return
    // Leaving a run before dying still counts it (stats, quests).
    if (!this.dead) this._endRun(false)
    this.active = false
    this.bm.tryMode.speedMult = 1
    this.camp?.dispose()
    this.camp = null
    for (const z of this.zombies) this._removeZombie(z)
    this.zombies = []
    if (this._hud) this._hud.style.display = 'none'
    if (this._overEl) this._overEl.style.display = 'none'
    document.getElementById('build-mode-play-btn-label')?.replaceChildren(t('buildModePlayBtn'))
    if (leaveTry && this.bm.tryMode.active) this.bm.toggleTryMode()
  }

  // No Player Start: the nearest open spot under the sky to where the
  // camera is (so you don't start on a roof or inside a wall).
  _defaultStart() {
    const bm = this.bm
    const cx = Math.floor(bm.camera.position.x / this.B)
    const cz = Math.floor(bm.camera.position.z / this.B)
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dz of r ? [-r, r] : [0]) {
          for (const [x, z] of [[cx + dx, cz + dz], [cx + dz, cz + dx]]) {
            let top = null
            for (let y = 60; y >= -1; y--) {
              if (bm.getBlockAt(x, y, z)) {
                top = y
                break
              }
            }
            if (top === null || top > 1 || !this._standable(x, top + 1, z)) continue
            return [x, top + 1, z]
          }
        }
      }
    }
    return null
  }

  // Upgrades bought from the camp's Upgrader (BuildCamp.js).
  magSize() {
    return MAG_SIZE + 10 * (this.upgrades?.mag || 0)
  }

  _reloadTime() {
    return RELOAD_TIME * (1 - 0.2 * (this.upgrades?.reload || 0)) * (this.cfg?.reloadMult ?? 1)
  }

  _damageMult() {
    return (1 + 0.25 * (this.upgrades?.damage || 0)) * (this.cfg?.damageMult ?? 1)
  }

  // Coins come in through here, so Loot Rush doubles them all.
  _earn(n) {
    const got = Math.round(n * (this.cfg?.coinMult ?? 1))
    this.coins += got
    this._coinsEarned += got
  }

  // Tells Game.js about a homepage run (stats, quests, achievements).
  _report(type, data) {
    if (!this.fromMenu) return null
    return this.bm.game?._onPlayEvent?.(type, data) || null
  }

  _findBlocks(type) {
    const out = []
    for (const [key, t2] of this.bm._blocks) if (t2 === type) out.push(key.split(',').map(Number))
    return out
  }

  // --- HUD ---

  _ensureHud() {
    if (this._hud) return
    const hud = document.createElement('div')
    hud.id = 'build-play-hud'
    hud.innerHTML = `
      <div id="build-play-wave"></div>
      <div id="build-play-msg"></div>
      <div id="build-play-health"><div id="build-play-health-fill"></div><span id="build-play-health-text"></span></div>
      <div id="build-play-ammo"></div>
      <div id="build-play-hurt"></div>`
    document.body.appendChild(hud)
    this._hud = hud
    const over = document.createElement('div')
    over.id = 'build-play-over'
    over.innerHTML = `
      <div class="build-play-over-card">
        <h2 id="build-play-over-title"></h2>
        <p id="build-play-over-text"></p>
        <p id="build-play-over-best"></p>
        <div class="build-play-over-btns">
          <button type="button" id="build-play-again-btn"></button>
          <button type="button" id="build-play-back-btn"></button>
        </div>
      </div>`
    document.body.appendChild(over)
    this._overEl = over
    over.querySelector('#build-play-again-btn').addEventListener('click', () => {
      const fromMenu = this.fromMenu
      this.stop()
      this.start({ fromMenu })
      try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    })
    over.querySelector('#build-play-back-btn').addEventListener('click', () => {
      const fromMenu = this.fromMenu
      this.stop()
      if (fromMenu && this.bm.game?._exitBuildMode) this.bm.game._exitBuildMode()
    })
  }

  _message(text, seconds = 2.5) {
    const el = document.getElementById('build-play-msg')
    if (!el) return
    el.textContent = text
    el.style.opacity = '1'
    this._msgLeft = seconds
  }

  _renderHud() {
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    const alive = this.zombies.length + this._toSpawn
    const mode = this.cfg?.mode
    const waveText = mode === 'zombieDefense' ? t('buildPlayWaveOf', { n: Math.max(1, this.wave), max: DEFENSE_WAVES }) : t('buildPlayWave', { n: Math.max(1, this.wave) })
    const secs = Math.floor((performance.now() - (this._startedAt || 0)) / 1000)
    const timeText = mode === 'zombieRush' ? ` · ${t('buildPlayTime', { t: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}` : ''
    set('build-play-wave', `${waveText} · ${t('buildPlayZombiesLeft', { n: alive })} · ${t('buildPlayKills', { n: this.kills })}${this.camp ? ` · ${t('campCoins', { n: this.coins })}` : ''}${timeText}`)
    const fill = document.getElementById('build-play-health-fill')
    if (fill) fill.style.width = `${Math.max(0, this.health)}%`
    set('build-play-health-text', `${Math.max(0, Math.ceil(this.health))}${this.armor > 0 ? ` + ${Math.ceil(this.armor)}` : ''}`)
    set('build-play-ammo', this._reloadLeft > 0 ? t('buildPlayReloading') : `${this.mag} / ${this.reserve}`)
  }

  // --- shooting (BuildTryMode.fire calls this first) ---

  // false when the gun is empty or reloading (no shot happens).
  tryFire() {
    if (!this.active || this.dead) return true
    if (this._reloadLeft > 0) return false
    if (this.mag <= 0) {
      audioEngine.playLowAmmoTick?.()
      if (this.reserve > 0) this.reload()
      else this._message(t('buildPlayNoAmmo'))
      return false
    }
    this.mag--
    this._renderHud()
    return true
  }

  // The shot itself: the nearest zombie in front of the gun, if nothing
  // solid is in the way first. Returns true if a zombie took it.
  shoot() {
    if (!this.active || this.dead) return false
    const bm = this.bm
    const B = this.B
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const ray = bm._raycaster.ray
    const wall = bm._raycastGridAligned()
    const wallT = wall ? wall.t : Infinity
    let best = null
    let bestT = Infinity
    const box = new THREE.Box3()
    const hitPoint = this._v
    for (const z of this.zombies) {
      const half = ZOMBIE_HALF * (z.size || 1)
      const height = ZOMBIE_HEIGHT * (z.size || 1)
      box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
      box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
      if (!ray.intersectBox(box, hitPoint)) continue
      const d = hitPoint.distanceTo(ray.origin)
      if (d < bestT && d < wallT) {
        bestT = d
        best = { z, head: hitPoint.y / B > z.y + height * 0.76 }
      }
    }
    if (!best) return false
    if (best.head) this.stats.headshots++
    this.damageZombie(best.z, SHOT_DAMAGE * this._damageMult() * (best.head ? HEAD_MULT : 1), ray.direction)
    const cross = document.getElementById('build-try-crosshair')
    if (cross) {
      cross.classList.remove('hit')
      void cross.offsetWidth
      cross.classList.add('hit')
    }
    return true
  }

  damageZombie(z, amount, dir = null) {
    z.health -= amount
    z.flash = 0.12
    if (dir) {
      z.vx += dir.x * 3
      z.vz += dir.z * 3
    }
    if (z.health > 0) return
    audioEngine.playZombieDeath?.(1)
    this.kills++
    this.stats.kills++
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this._earn(COIN_PER_KILL)
    if (z.boss) {
      this.bosses++
      this._earn(BOSS_COINS)
      this._message(t('buildPlayBossDown', { n: Math.round(BOSS_COINS * (this.cfg?.coinMult ?? 1)) }))
    }
    this._report('kill', { boss: !!z.boss, streak: this.streak })
    this._removeZombie(z)
    this.zombies = this.zombies.filter((o) => o !== z)
    this._renderHud()
  }

  reload() {
    if (!this.active || this.dead || this._reloadLeft > 0 || this.mag >= this.magSize() || this.reserve <= 0) return
    this._reloadLeft = this._reloadTime()
    try { audioEngine.playReload({ magSize: this.magSize() }) } catch { /* no audio */ }
    this._renderHud()
  }

  // E / right-click on a Loot Chest while playing: ammo and health, once
  // per chest per wave. Also used (as a no-op) while just trying the map.
  useChest(x, y, z) {
    if (!this.active || this.dead) return false
    const key = this.bm._key(x, y, z)
    if (this.bm._blocks.get(key) !== 'lootchest') return false
    if (this._chestsUsed.has(key)) {
      this._message(t('buildPlayChestEmpty'))
      return true
    }
    this._chestsUsed.add(key)
    this.stats.chests++
    this.reserve += CHEST_LOOT.ammo
    this.health = Math.min(this.maxHealth, this.health + CHEST_LOOT.health)
    this._message(t('buildPlayChestLoot', { ammo: CHEST_LOOT.ammo, health: CHEST_LOOT.health }))
    this._renderHud()
    return true
  }

  // Cells zombies stand in, for pressure plates.
  zombieCells() {
    return this.zombies.map((z) => [Math.floor(z.x), Math.floor(z.y + 0.01), Math.floor(z.z)])
  }

  onKeyDown(code) {
    if (code === getKeyFor('reload')) this.reload()
  }

  // --- the world: who can stand where ---

  _solid(x, y, z) {
    return this.bm._cellSolidTop(x, y, z) > 0.5
  }

  _isLadder(x, y, z) {
    return this.bm._cellIsLadder(x, y, z)
  }

  // A zombie can stand with its feet in this cell: it and the cell above
  // are open, and there's ground (or a ladder) under it.
  _standable(x, y, z) {
    if (this._solid(x, y, z) || this._solid(x, y + 1, z)) return false
    return this._solid(x, y - 1, z) || this.bm._cellSolidTop(x, y - 1, z) > 0 || this._isLadder(x, y, z)
  }

  // Closed doors count as a way through (zombies bash them open), just a
  // longer one.
  _doorAt(x, y, z) {
    const type = this.bm._blocks.get(this.bm._key(x, y, z))
    const shape = type && this.bm.constructor.blockShape(type)
    return shape === 'door' || shape === 'doortop'
  }

  _neighbors(x, y, z, out) {
    out.length = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const nz = z + dz
      // Through a closed door (zombies bash it open): a longer way round.
      if (this._doorAt(nx, y, nz) && this._solid(nx, y, nz) && this._solid(nx, y - 1, nz)) {
        out.push([nx, y, nz, 4])
        continue
      }
      // Same level, one up (a jump, needs head room), or down a drop of up
      // to three.
      if (this._standable(nx, y, nz)) out.push([nx, y, nz, 1])
      else if (this._standable(nx, y + 1, nz) && !this._solid(x, y + 2, z)) out.push([nx, y + 1, nz, 1.5])
      else if (!this._solid(nx, y, nz) && !this._solid(nx, y + 1, nz)) {
        for (let d = 1; d <= 3; d++) {
          if (this._solid(nx, y - d, nz)) break
          if (this._standable(nx, y - d, nz)) {
            out.push([nx, y - d, nz, 1 + d * 0.2])
            break
          }
        }
      }
    }
    // Up and down ladders.
    if (this._isLadder(x, y, z) || this._isLadder(x, y + 1, z)) {
      if (!this._solid(x, y + 2, z) && !this._solid(x, y + 1, z)) out.push([x, y + 1, z, 1])
    }
    if (this._isLadder(x, y - 1, z) && !this._solid(x, y - 1, z)) out.push([x, y - 1, z, 1])
    return out
  }

  // Flood fill outward from the player (cheapest-first with a simple
  // bucket queue; costs are small multiples of half a step).
  _rebuildFlow(px, py, pz) {
    const flow = this._flow
    flow.clear()
    const startKey = `${px},${py},${pz}`
    flow.set(startKey, 0)
    const buckets = [[[px, py, pz]]]
    const nb = []
    let visited = 0
    for (let b = 0; b < buckets.length && visited < PATH_MAX_NODES; b++) {
      const list = buckets[b]
      if (!list) continue
      for (const [x, y, z] of list) {
        const here = flow.get(`${x},${y},${z}`)
        if (here * 2 !== b) continue
        visited++
        for (const [nx, ny, nz, cost] of this._neighbors(x, y, z, nb)) {
          const key = `${nx},${ny},${nz}`
          const d = here + cost
          if (flow.has(key) && flow.get(key) <= d) continue
          flow.set(key, d)
          const bi = Math.round(d * 2)
          ;(buckets[bi] || (buckets[bi] = [])).push([nx, ny, nz])
        }
      }
    }
  }

  _playerCell() {
    const p = this.bm.tryMode.pos
    let x = Math.floor(p.x)
    let y = Math.floor(p.y + 0.01)
    let z = Math.floor(p.z)
    // In the air: the cell under you.
    for (let i = 0; i < 4 && !this._standable(x, y, z); i++) y--
    if (!this._standable(x, y, z)) y = Math.floor(p.y + 0.01)
    return [x, y, z]
  }

  // --- zombies ---

  _spawnSpots() {
    const spots = []
    for (const [x, y, z] of this._findBlocks('zombiespawner')) {
      // On top of it or right beside it.
      for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]) {
        if (this._standable(x + dx, y + dy, z + dz)) {
          spots.push([x + dx, y + dy, z + dz])
          break
        }
      }
    }
    if (spots.length) return spots
    // No spawners: somewhere a zombie can reach you from, not too close.
    const far = []
    const near = []
    for (const [key, d] of this._flow) {
      if (d < 14) continue
      const cell = key.split(',').map(Number)
      if (d <= 40) far.push(cell)
      else near.push(cell)
    }
    if (far.length) return far
    if (near.length) return near
    // A small space: anywhere a little way off.
    const any = [...this._flow].filter(([, d]) => d >= 5).map(([key]) => key.split(',').map(Number))
    return any.length ? any : [...this._flow.keys()].map((key) => key.split(',').map(Number))
  }

  _spawnZombie() {
    const spots = this._spawnSpots()
    if (!spots.length) return false
    const open = this.camp ? spots.filter(([sx, , sz]) => !this.camp.inside(sx + 0.5, sz + 0.5, 1)) : spots
    if (!open.length) return false
    const [x, y, z] = open[Math.floor(Math.random() * open.length)]
    const group = new THREE.Group()
    const boss = this._bossPending > 0
    if (boss) this._bossPending--
    const health = zombieHealth(this.wave, this.cfg.escalation) * this.cfg.zombieHealthMult * (boss ? BOSS_HEALTH_MULT : 1)
    const zombie = { x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, onGround: false, health, attackCd: 0.6, bash: 0, flash: 0, walk: Math.random() * 6, moan: 2 + Math.random() * 8, group, body: null, boss, size: boss ? BOSS_SIZE : 1 }
    if (boss) this._message(t('buildPlayBossComing'))
    if (this._skin) {
      const body = buildTexturedCharacter(this._skin)
      const s = (ZOMBIE_HEIGHT * this.B * zombie.size) / 32
      body.scale.setScalar(s)
      body.position.y = 2 * s
      // Arms out in front, the classic zombie walk.
      body.limbPivots.armR.rotation.x = -Math.PI / 2
      body.limbPivots.armL.rotation.x = -Math.PI / 2
      group.add(body)
      zombie.body = body
    } else {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6 * this.B, ZOMBIE_HEIGHT * this.B, 0.6 * this.B), new THREE.MeshLambertMaterial({ color: 0x4f8a3a }))
      mesh.position.y = (ZOMBIE_HEIGHT * this.B) / 2
      group.add(mesh)
    }
    this.bm.scene.add(group)
    this.zombies.push(zombie)
    return true
  }

  _removeZombie(z) {
    this.bm.scene.remove(z.group)
    z.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [].concat(o.material)) m.dispose()
    })
  }

  _zombieHits(x, y, z) {
    // The camp counts as a wall to zombies.
    if (this.camp?.inside(x, z, ZOMBIE_HALF + 0.05)) return true
    return this.bm.tryMode._hits(x, y, z, ZOMBIE_HEIGHT)
  }

  _moveZombieAxis(zb, axis, amount) {
    if (!amount) return false
    const q = { x: zb.x, y: zb.y, z: zb.z }
    q[axis] += amount
    if (!this._zombieHits(q.x, q.y, q.z)) {
      zb[axis] = q[axis]
      return false
    }
    let lo = 0
    let hi = amount
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2
      q[axis] = zb[axis] + mid
      if (this._zombieHits(q.x, q.y, q.z)) hi = mid
      else lo = mid
    }
    zb[axis] += lo
    return true
  }

  _updateZombie(zb, dt, player, speed) {
    const cx = Math.floor(zb.x)
    const cy = Math.floor(zb.y + 0.01)
    const cz = Math.floor(zb.z)
    // Where to go: the neighbor one step closer to you, else straight at you.
    let tx = player.x
    let tz = player.z
    let ty = player.y
    const here = this._flow.get(`${cx},${cy},${cz}`)
    if (here !== undefined) {
      let bestD = here
      for (const [nx, ny, nz] of this._neighbors(cx, cy, cz, this._nb || (this._nb = []))) {
        const d = this._flow.get(`${nx},${ny},${nz}`)
        if (d !== undefined && d < bestD) {
          bestD = d
          tx = nx + 0.5
          ty = ny
          tz = nz + 0.5
        }
      }
    }
    const dx = tx - zb.x
    const dz = tz - zb.z
    const dist = Math.hypot(dx, dz) || 1
    const want = speed
    zb.vx = THREE.MathUtils.damp(zb.vx, (dx / dist) * want, 10, dt)
    zb.vz = THREE.MathUtils.damp(zb.vz, (dz / dist) * want, 10, dt)
    // Keep a little apart from each other.
    for (const o of this.zombies) {
      if (o === zb) continue
      const ox = zb.x - o.x
      const oz = zb.z - o.z
      const d = Math.hypot(ox, oz)
      if (d > 0.001 && d < 0.6) {
        zb.vx += (ox / d) * (0.6 - d) * 8 * dt * 10
        zb.vz += (oz / d) * (0.6 - d) * 8 * dt * 10
      }
    }
    const onLadder = this._isLadder(cx, cy, cz) || this._isLadder(cx, cy + 1, cz)
    if (onLadder && ty > zb.y - 0.2) zb.vy = CLIMB
    else zb.vy = Math.max(zb.vy - GRAVITY * dt, -40)
    let blocked = false
    for (const axis of ['x', 'z']) {
      const amount = zb[`v${axis}`] * dt
      if (this._moveZombieAxis(zb, axis, amount)) {
        // A half-block step up happens by itself.
        const q = { x: zb.x, y: zb.y + 0.55, z: zb.z }
        q[axis] += amount
        if (zb.onGround && !this._zombieHits(q.x, q.y, q.z)) {
          zb.y += 0.55
          zb[axis] = q[axis]
          this._moveZombieAxis(zb, 'y', -0.55)
        } else blocked = true
      }
    }
    // Jump up a block when it's in the way, or the path goes up.
    if (zb.onGround && (blocked || ty > zb.y + 0.6) && !onLadder) {
      zb.vy = JUMP
      zb.onGround = false
    }
    const falling = zb.vy <= 0
    const hitY = this._moveZombieAxis(zb, 'y', zb.vy * dt)
    zb.onGround = hitY && falling
    if (hitY) zb.vy = 0
    if (zb.y < -40) zb.health = 0

    // A closed door in the way gets bashed open.
    const ahead = [Math.floor(zb.x + Math.sign(dx) * 0.6), cy, Math.floor(zb.z + Math.sign(dz) * 0.6)]
    if (blocked && this._doorAt(...ahead) && !this.bm.isDoorOpenAt(ahead[0], this._doorBottomY(...ahead), ahead[2])) {
      zb.bash += dt
      if (zb.bash > DOOR_BASH_TIME) {
        zb.bash = 0
        this.bm.toggleDoor(...ahead)
      }
    } else zb.bash = Math.max(0, zb.bash - dt)

    // Hit you when close enough.
    zb.attackCd -= dt
    const px = player.x - zb.x
    const pz = player.z - zb.z
    if (Math.hypot(px, pz) < ATTACK_RANGE && Math.abs(player.y - zb.y) < 1.5 && zb.attackCd <= 0) {
      zb.attackCd = ATTACK_COOLDOWN
      this._hurtPlayer(zombieDamage(this.wave) * this.cfg.zombieDamageMult * (zb.boss ? BOSS_DAMAGE_MULT : 1))
    }

    // Draw it: facing where it walks, legs and arms swinging.
    const B = this.B
    zb.group.position.set(zb.x * B, zb.y * B, zb.z * B)
    const moveLen = Math.hypot(zb.vx, zb.vz)
    if (moveLen > 0.2) zb.group.rotation.y = Math.atan2(zb.vx, zb.vz)
    zb.walk += dt * moveLen * 3.2
    const swing = Math.sin(zb.walk) * Math.min(1, moveLen / 2) * 0.7
    if (zb.body) {
      const lp = zb.body.limbPivots
      lp.legR.rotation.x = swing
      lp.legL.rotation.x = -swing
      lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
      lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
    }
    if (zb.flash > 0) zb.flash -= dt
    const red = zb.flash > 0 ? 0.6 : 0
    if (zb.lastRed !== red) {
      zb.lastRed = red
      zb.group.traverse((o) => {
        if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(red, 0, 0)
      })
    }
    zb.moan -= dt
    if (zb.moan <= 0) {
      zb.moan = 6 + Math.random() * 10
      if (Math.hypot(px, pz) < 14) audioEngine.playZombieMoan?.(1)
    }
  }

  _doorBottomY(x, y, z) {
    const type = this.bm._blocks.get(this.bm._key(x, y, z))
    return this.bm.constructor.blockShape(type) === 'doortop' ? y - 1 : y
  }

  _hurtPlayer(amount) {
    if (this.dead) return
    const p = this.bm.tryMode.pos
    // Nothing reaches you inside the camp.
    if (this.camp?.inside(p.x, p.z)) return
    this.streak = 0
    this._hurtAt = performance.now()
    // Armor (from the camp's Trader) takes the hit first.
    const soaked = Math.min(this.armor || 0, amount)
    this.armor = (this.armor || 0) - soaked
    this.health -= amount - soaked
    audioEngine.playPlayerHurt?.()
    const flash = document.getElementById('build-play-hurt')
    if (flash) {
      flash.classList.remove('show')
      void flash.offsetWidth
      flash.classList.add('show')
    }
    this._renderHud()
    if (this.health <= 0) this._die()
  }

  // Counts the run once (stats, quests, Legacy Points) - on death, on a
  // win, or when you leave mid-run. Returns what Game.js gave for it.
  _endRun(won) {
    if (this._ended || !this.active) return null
    this._ended = true
    const waves = won ? this.wave : Math.max(0, this.wave - 1)
    return this._report('end', {
      waves,
      kills: this.kills,
      bestStreak: this.bestStreak,
      headshots: this.stats.headshots,
      bosses: this.bosses,
      won,
      died: this.dead,
      mode: this.cfg.mode,
      seconds: (performance.now() - this._startedAt) / 1000,
      coins: this._coinsEarned,
    })
  }

  _win() {
    this._won = true
    this._die(true)
  }

  _die(won = false) {
    this.dead = true
    const reward = this._endRun(won)
    const waves = won ? this.wave : Math.max(0, this.wave - 1)
    let best
    try {
      const all = JSON.parse(localStorage.getItem(BEST_KEY) || '{}')
      const slot = String(this.bm.activeSlot)
      best = Math.max(all[slot] || 0, waves)
      all[slot] = best
      localStorage.setItem(BEST_KEY, JSON.stringify(all))
    } catch {
      best = waves
    }
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    set('build-play-over-title', t(won ? 'buildPlayOverWinTitle' : 'buildPlayOverTitle'))
    set('build-play-over-text', t(won ? 'buildPlayOverWinText' : 'buildPlayOverText', { waves, kills: this.kills }))
    set('build-play-over-best', `${t('buildPlayOverBest', { n: best })}${reward?.legacy ? ` · ${t('buildPlayOverLegacy', { n: reward.legacy })}` : ''}`)
    set('build-play-again-btn', t('buildPlayAgainBtn'))
    set('build-play-back-btn', t(this.fromMenu ? 'buildPlayBackMenuBtn' : 'buildPlayBackBtn'))
    this._overEl.style.display = 'flex'
    if (document.pointerLockElement) document.exitPointerLock()
  }

  // Each frame while playing (after Try Map has moved you).
  update(dt) {
    if (!this.active || this.dead || this.bm.menuOpen) return
    dt = Math.min(dt, 1 / 20)
    if (this.camp) {
      this.camp.update(dt)
      this.camp.checkQuests()
    }
    // Healing: Health Regen out of combat, and inside Map 1's camp.
    const nowMs = performance.now()
    if (this.health < this.maxHealth) {
      const tp = this.bm.tryMode.pos
      let heal = 0
      if (this.cfg.regen && nowMs - this._hurtAt > REGEN_DELAY * 1000) heal += REGEN_PER_SECOND
      if (this.camp?.inside(tp.x, tp.z)) heal += this.cfg.campHealRate
      if (heal) {
        this.health = Math.min(this.maxHealth, this.health + heal * dt)
        this._renderHud()
      }
    }
    if (this.cfg.mode === 'zombieRush' && Math.floor(nowMs / 1000) !== this._lastSecond) {
      this._lastSecond = Math.floor(nowMs / 1000)
      this._renderHud()
    }
    if (this._msgLeft > 0) {
      this._msgLeft -= dt
      if (this._msgLeft <= 0) {
        const el = document.getElementById('build-play-msg')
        if (el) el.style.opacity = '0'
      }
    }
    if (this._reloadLeft > 0) {
      this._reloadLeft -= dt
      if (this._reloadLeft <= 0) {
        const take = Math.min(this.magSize() - this.mag, this.reserve)
        this.mag += take
        this.reserve -= take
      }
      this._renderHud()
    }
    const now = performance.now() / 1000
    const [px, py, pz] = this._playerCell()
    if (now - this._flowAt > PATH_REFRESH || this._flowKey !== `${px},${py},${pz}`) {
      this._flowAt = now
      this._flowKey = `${px},${py},${pz}`
      this._rebuildFlow(px, py, pz)
    }
    // Waves.
    if (this._toSpawn === 0 && this.zombies.length === 0) {
      if (this._breakTimer > 0) {
        this._breakTimer -= dt
        if (this._breakTimer <= 0) {
          this.wave++
          this._toSpawn = Math.max(1, Math.round(waveSize(this.wave) * this.cfg.zombieCountMult))
          this._bossPending = this.cfg.bossEvery && this.wave % this.cfg.bossEvery === 0 ? 1 : 0
          this._chestsUsed.clear()
          this._message(t('buildPlayWaveStart', { n: this.wave }))
          this._report('wave', { wave: this.wave })
          this._renderHud()
        }
      } else {
        const rush = this.cfg.mode === 'zombieRush'
        this._breakTimer = rush ? RUSH_WAVE_BREAK : WAVE_BREAK
        if (this.wave > 0) {
          this._earn(COIN_PER_WAVE)
          // Zombie Defense: the last wave held is a win.
          if (this.cfg.mode === 'zombieDefense' && this.wave >= DEFENSE_WAVES) {
            this._win()
            return
          }
          if (!rush) this._message(t('buildPlayWaveClear', { n: this.wave, s: WAVE_BREAK }))
        }
      }
    }
    if (this._toSpawn > 0 && this.zombies.length < MAX_ALIVE) {
      this._spawnTimer -= dt
      if (this._spawnTimer <= 0 && this._skin !== undefined) {
        this._spawnTimer = SPAWN_GAP * (this.cfg.mode === 'zombieRush' ? RUSH_SPAWN_GAP_MULT : 1)
        if (this._spawnZombie()) this._toSpawn--
        this._renderHud()
      }
    }
    const p = this.bm.tryMode.pos
    const speed = zombieSpeed(this.wave, this.cfg.escalation)
    for (const zb of [...this.zombies]) {
      this._updateZombie(zb, dt, p, speed)
      if (zb.health <= 0 && this.zombies.includes(zb)) this.damageZombie(zb, 0)
      if (this.dead) return
    }
  }
}

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
import { PLAY_WEAPONS, DEFAULT_PLAY_WEAPON, ammoFor, weaponBars } from './PlayWeapons.js'
import { PLAY_DEFAULTS, EXTRACTION_WAVES, EXTRACTION_HOLD, EXTRACTION_RADIUS, EXTRACTION_MIN, EXTRACTION_MAX, DEFENSE_WAVES, BOSS_HEALTH_MULT, BOSS_DAMAGE_MULT, BOSS_SIZE, BOSS_COINS, RUSH_WAVE_BREAK, RUSH_SPAWN_GAP_MULT, REGEN_DELAY, REGEN_PER_SECOND } from './PlayRules.js'

export const CHEST_LOOT = { ammo: 60, health: 35 }
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
// The flow field is worked out a slice at a time, at most this many ms a
// frame, so an old phone never freezes on it (one full pass took ~65ms
// on a fast computer - several hundred on a phone - every half second).
const FLOW_BUDGET_MS = 3

// Cell -> one number (x/z within +-2048, y within -64..191), much
// cheaper as a Map key than an "x,y,z" string.
function cellKey(x, y, z) {
  return ((x + 2048) * 4096 + (z + 2048)) * 256 + (y + 64)
}

function cellOf(key) {
  const y = (key % 256) - 64
  const xz = Math.floor(key / 256)
  return [Math.floor(xz / 4096) - 2048, y, (xz % 4096) - 2048]
}
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
  // net: a PlayNet when playing on a server with others (PlayNet.js) -
  // then the waves are endless Zombie Survival and only the host runs
  // the zombies.
  start({ fromMenu = false, net = null } = {}) {
    const bm = this.bm
    this.cfg = { ...PLAY_DEFAULTS, ...(fromMenu ? bm.game?._playConfig?.() : null) }
    this.net = net
    if (net) {
      net.attach(this)
      this.cfg.mode = 'classic'
    }
    this._zid = 0
    this._disposeExtraction()
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
    this.stats = { kills: 0, chests: 0, headshots: 0, meleeKills: 0 }
    this.streak = 0
    this.bestStreak = 0
    this.bosses = 0
    this._bossPending = 0
    this._ended = false
    this._won = false
    this._lifeStartWave = 0
    this._startedAt = performance.now()
    this._hurtAt = 0
    this._coinsEarned = 0
    bm.tryMode.speedMult = this.cfg.moveMult
    // The gun (PlayWeapons.js): a homepage run starts with the weapon
    // picker open (last pick highlighted); the editor's own Play just
    // uses the rifle.
    const saved = bm.game?.settings?.playWeapon
    this.weaponId = fromMenu && PLAY_WEAPONS[saved] ? saved : DEFAULT_PLAY_WEAPON
    this._nextShotAt = 0
    this.mag = this.magSize()
    this.reserve = this.weapon.reserve
    this.wave = 0
    this.kills = 0
    this._toSpawn = 0
    this._spawnTimer = 0
    this._breakTimer = 2
    this._reloadLeft = 0
    this._chestsUsed = new Set()
    this._flow = new Map()
    this._flowJob = null
    this._flowAt = 0
    bm.toggleTryMode()
    // Map 3's walled camp is a safe zone with NPCs (BuildCamp.js).
    this.camp?.dispose()
    const zone = bm.activeSlot === 'map3' ? bm._map3Base().map.safeZone : null
    this.camp = zone ? new BuildCamp(this, zone, this.B) : null
    this._ensureHud()
    this._hud.style.display = 'block'
    this._overEl.style.display = 'none'
    this._renderHud()
    document.getElementById('build-mode-play-btn-label')?.replaceChildren(t('buildModePlayStopBtn'))
    if (fromMenu) this._openWeaponPicker()
    else this._message(t('buildPlayGetReady'))
    zombieSkin().then((skin) => { this._skin = skin }).catch(() => { this._skin = null })
  }

  // leaveTry: false when Try Map itself is being left (T / Escape menu).
  stop({ leaveTry = true } = {}) {
    if (!this.active) return
    // Leaving a run before dying still counts it (stats, quests).
    if (!this.dead) this._endRun(false)
    this.active = false
    this.net?.leave()
    this.net = null
    this.bm.tryMode.speedMult = 1
    this.camp?.dispose()
    this.camp = null
    this._disposeExtraction()
    for (const z of this.zombies) this._removeZombie(z)
    this.zombies = []
    this._disposeZombieBatch()
    if (this._hud) this._hud.style.display = 'none'
    if (this._overEl) this._overEl.style.display = 'none'
    this._closeWeaponPicker()
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

  get weapon() {
    return PLAY_WEAPONS[this.weaponId] || PLAY_WEAPONS[DEFAULT_PLAY_WEAPON]
  }

  // Upgrades bought from the camp's Upgrader (BuildCamp.js): each Mag
  // level adds a third of the gun's own magazine (10 for the rifle).
  magSize() {
    const base = this.weapon.mag
    if (!Number.isFinite(base)) return Infinity
    return base + Math.max(1, Math.round(base / 3)) * (this.upgrades?.mag || 0)
  }

  _reloadTime() {
    return this.weapon.reload * (1 - 0.2 * (this.upgrades?.reload || 0)) * (this.cfg?.reloadMult ?? 1)
  }

  // --- weapon picker (homepage runs) ---

  _openWeaponPicker() {
    this._picking = true
    let el = document.getElementById('play-weapon-pick')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-weapon-pick'
      document.body.appendChild(el)
      el.addEventListener('click', (e) => {
        const card = e.target.closest('[data-play-weapon]')
        if (card) this._pickWeapon(card.dataset.playWeapon)
      })
    }
    const game = this.bm.game
    if (game && !game._weaponThumbCache && game._weaponThumbnails) game._weaponThumbCache = game._weaponThumbnails()
    const thumbs = game?._weaponThumbCache || {}
    const ids = (game?.weapons?.getSummary?.() || []).filter((w) => PLAY_WEAPONS[w.id])
    const bar = (label, v) => `<span class="pwp-bar"><span class="pwp-bar-label">${label}</span><span class="pwp-bar-track"><span style="width:${Math.round(v * 100)}%"></span></span></span>`
    el.innerHTML = `<div class="pwp-card-box">
      <h2>${t('playPickWeaponTitle')}</h2>
      <p class="pwp-hint">${t('playPickWeaponHint')}</p>
      <div class="pwp-grid">${ids.map((w) => {
        const b = weaponBars(w.id)
        return `<button type="button" class="pwp-weapon${w.id === this.weaponId ? ' active' : ''}" data-play-weapon="${w.id}">
          <span class="pwp-name">${t(w.nameKey)}</span>
          ${thumbs[w.id] ? `<img alt="" draggable="false" src="${thumbs[w.id]}" />` : '<span class="pwp-noimg"></span>'}
          ${bar(t('playStatDamage'), b.damage)}${bar(t('playStatFireRate'), b.rate)}${bar(t('playStatAmmo'), b.ammo)}
        </button>`
      }).join('')}</div>
    </div>`
    el.style.display = 'flex'
    // The cursor has to be free to click a card.
    try { document.exitPointerLock() } catch { /* not locked */ }
  }

  _closeWeaponPicker() {
    this._picking = false
    const el = document.getElementById('play-weapon-pick')
    if (el) el.style.display = 'none'
  }

  _pickWeapon(id) {
    if (!PLAY_WEAPONS[id] || !this.active) return
    this.weaponId = id
    this.bm.game?._setPlayWeapon?.(id)
    this._nextShotAt = 0
    this._reloadLeft = 0
    this.mag = this.magSize()
    this.reserve = this.weapon.reserve
    this._closeWeaponPicker()
    this.bm.tryMode._showGun()
    this._message(t('buildPlayGetReady'))
    this._renderHud()
    // This click is a real user gesture, so the mouse can be captured again.
    try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
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
      // On a server: back on your feet in the same game.
      if (this.net && !this.net.closed) {
        this._respawn()
        try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
        return
      }
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
    let extractText = ''
    if (mode === 'zombieExtraction') {
      const ex = this._extract
      if (!ex) extractText = ` · ${t('extractionAfterWave', { n: EXTRACTION_WAVES })}`
      else if (ex.hold > 0) extractText = ` · ${t('extractionHolding', { s: Math.ceil(EXTRACTION_HOLD - ex.hold) })}`
      else extractText = ` · ${t('extractionDistance', { n: Math.round(ex.dist ?? 0) })}`
    }
    const serverText = this.net && !this.net.closed ? ` · ${t('serverHudLine', { name: this.net.name, n: this.net.players.size + 1 })}` : ''
    set('build-play-wave', `${waveText} · ${t('buildPlayZombiesLeft', { n: alive })} · ${t('buildPlayKills', { n: this.kills })}${this.camp ? ` · ${t('campCoins', { n: this.coins })}` : ''}${timeText}${extractText}${serverText}`)
    const fill = document.getElementById('build-play-health-fill')
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, (this.health / (this.maxHealth || 100)) * 100))}%`
    set('build-play-health-text', `${Math.max(0, Math.ceil(this.health))}${this.armor > 0 ? ` + ${Math.ceil(this.armor)}` : ''}`)
    const ammo = Number.isFinite(this.mag) ? `${this.mag} / ${this.reserve}` : t(this.bm.game?.weapons?.getSummary?.().find((w) => w.id === this.weaponId)?.nameKey || 'weaponMelee')
    set('build-play-ammo', this._reloadLeft > 0 ? t('buildPlayReloading') : ammo)
  }

  // --- shooting (BuildTryMode.fire calls this first) ---

  // false when the gun is empty or reloading (no shot happens).
  tryFire() {
    if (!this.active || this.dead) return true
    if (this._picking) return false
    if (this._reloadLeft > 0) return false
    // Each gun's own fire rate.
    const now = performance.now()
    if (now < this._nextShotAt) return false
    this._nextShotAt = now + this.weapon.rate * 1000
    if (!Number.isFinite(this.mag)) return true
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
    const w = this.weapon
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const center = bm._raycaster.ray.clone()
    const wall = bm._raycastGridAligned()
    const reach = Math.min(wall ? wall.t : Infinity, Number.isFinite(w.range) ? w.range * B : Infinity)
    const damage = w.damage * this._damageMult()
    const hits = new Map()
    const add = (z, amount) => hits.set(z, (hits.get(z) || 0) + amount)
    const box = new THREE.Box3()
    const hitPoint = this._v
    let impact = null
    // One ray per pellet (shotgun, flamethrower), fanned out by spread.
    const pellets = w.pellets || 1
    const ray = center.clone()
    for (let p = 0; p < pellets; p++) {
      ray.copy(center)
      if (p > 0 || pellets > 1) {
        // Aiming down the sights tightens the spread.
        const spread = (w.spread || 0) * (1 - 0.45 * (bm.tryMode.aimAmount || 0))
        ray.direction.x += (Math.random() - 0.5) * 2 * spread
        ray.direction.y += (Math.random() - 0.5) * 2 * spread
        ray.direction.z += (Math.random() - 0.5) * 2 * spread
        ray.direction.normalize()
      }
      let best = null
      let bestT = reach
      for (const z of this.zombies) {
        const half = ZOMBIE_HALF * (z.size || 1)
        const height = ZOMBIE_HEIGHT * (z.size || 1)
        box.min.set((z.x - half) * B, z.y * B, (z.z - half) * B)
        box.max.set((z.x + half) * B, (z.y + height) * B, (z.z + half) * B)
        if (!ray.intersectBox(box, hitPoint)) continue
        const d = hitPoint.distanceTo(ray.origin)
        if (d < bestT) {
          bestT = d
          best = { z, head: hitPoint.y / B > z.y + height * 0.76 }
        }
      }
      if (best) {
        if (best.head) this.stats.headshots++
        add(best.z, damage * (best.head ? HEAD_MULT : 1))
        if (!impact) impact = ray.at(bestT, new THREE.Vector3())
      } else if (w.blast && !impact && Number.isFinite(reach)) {
        impact = ray.at(reach, new THREE.Vector3())
      }
    }
    // Rockets and grenades: everything near where it lands is hurt too,
    // less the further away.
    if (w.blast && impact) {
      try { audioEngine.playExplosion?.() } catch { /* no audio */ }
      const radius = w.blast * B
      for (const z of this.zombies) {
        const cx = z.x * B
        const cy = (z.y + ZOMBIE_HEIGHT * 0.5 * (z.size || 1)) * B
        const cz = z.z * B
        const d = Math.hypot(cx - impact.x, cy - impact.y, cz - impact.z)
        if (d < radius) add(z, damage * 0.8 * (1 - d / radius))
      }
    }
    if (!hits.size) return false
    for (const [z, amount] of hits) {
      if (!this.zombies.includes(z)) continue
      // On a server and not the host: the host's zombie takes the hit
      // (and tells me if I killed it); here it just flashes.
      if (this.net && !this.net.isHost) {
        this.net.queueHit(`z${z.id}`, amount)
        z.flash = 0.12
      } else this.damageZombie(z, amount, center.direction)
    }
    const cross = document.getElementById('build-try-crosshair')
    if (cross) {
      cross.classList.remove('hit')
      void cross.offsetWidth
      cross.classList.add('hit')
    }
    return true
  }

  // by: on a server, the other player whose shot this was (the kill is
  // theirs - it reaches them through PlayNet).
  damageZombie(z, amount, dir = null, by = null) {
    z.health -= amount
    z.flash = 0.12
    if (dir) {
      z.vx += dir.x * 3
      z.vz += dir.z * 3
    }
    if (z.health > 0) return
    audioEngine.playZombieDeath?.(1)
    if (by) this.net?.queueCredit(by, z.boss)
    else this._countKill(z.boss)
    this._removeZombie(z)
    this.zombies = this.zombies.filter((o) => o !== z)
    this._renderHud()
  }

  // A kill of mine: stats, coins, the streak, achievements.
  _countKill(boss) {
    this.kills++
    this.stats.kills++
    if (this.weaponId === 'melee') this.stats.meleeKills++
    this.streak++
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this._earn(COIN_PER_KILL)
    if (boss) {
      this.bosses++
      this._earn(BOSS_COINS)
      this._message(t('buildPlayBossDown', { n: Math.round(BOSS_COINS * (this.cfg?.coinMult ?? 1)) }))
    }
    this._report('kill', { boss: !!boss, streak: this.streak, weapon: this.weaponId })
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
    // Ammo in this gun's own amounts (PlayWeapons.ammoFor).
    const ammo = ammoFor(this.weaponId, CHEST_LOOT.ammo)
    this.reserve += ammo
    this.health = Math.min(this.maxHealth, this.health + CHEST_LOOT.health)
    this._message(t('buildPlayChestLoot', { ammo, health: CHEST_LOOT.health }))
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

  // How solid a cell is (BuildMode._cellSolidTop), with ladders as -1.
  // While a flow pass runs, every cell is looked up once and remembered
  // for that pass (_memo) - the flood fill asks about each cell many times.
  _cellCode(x, y, z) {
    const memo = this._memo
    if (memo) {
      const k = cellKey(x, y, z)
      const v = memo.get(k)
      if (v !== undefined) return v
      const code = this.bm._cellIsLadder(x, y, z) ? -1 : this.bm._cellSolidTop(x, y, z)
      memo.set(k, code)
      return code
    }
    return this.bm._cellIsLadder(x, y, z) ? -1 : this.bm._cellSolidTop(x, y, z)
  }

  _solid(x, y, z) {
    return this._cellCode(x, y, z) > 0.5
  }

  _isLadder(x, y, z) {
    return this._cellCode(x, y, z) === -1
  }

  // A zombie can stand with its feet in this cell: it and the cell above
  // are open, and there's ground (or a ladder) under it.
  _standable(x, y, z) {
    if (this._solid(x, y, z) || this._solid(x, y + 1, z)) return false
    const below = this._cellCode(x, y - 1, z)
    return below > 0 || this._isLadder(x, y, z)
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
  // bucket queue; costs are small multiples of half a step). Done as a
  // job a slice at a time (_stepFlow); zombies keep following the last
  // finished field meanwhile. The very first one runs in one go.
  // sources: the cells of every player being chased (on a server, all of
  // them - each zombie then heads for whoever is nearest).
  _rebuildFlow(sources) {
    this._startFlow(sources)
    this._stepFlow(Infinity)
  }

  _startFlow(sources) {
    const flow = new Map()
    for (const [x, y, z] of sources) flow.set(cellKey(x, y, z), 0)
    this._flowJob = { flow, buckets: [sources.map((c) => [...c])], b: 0, i: 0, visited: 0, memo: new Map() }
  }

  // Works on the current job for up to budgetMs; true once it's done.
  _stepFlow(budgetMs) {
    const job = this._flowJob
    if (!job) return true
    const until = performance.now() + budgetMs
    const { flow, buckets } = job
    const nb = this._flowNb || (this._flowNb = [])
    this._memo = job.memo
    let n = 0
    try {
      for (; job.b < buckets.length && job.visited < PATH_MAX_NODES; job.b++, job.i = 0) {
        const list = buckets[job.b]
        if (!list) continue
        for (; job.i < list.length; job.i++) {
          if ((++n & 63) === 0 && performance.now() > until) return false
          const [x, y, z] = list[job.i]
          const here = flow.get(cellKey(x, y, z))
          if (here * 2 !== job.b) continue
          job.visited++
          for (const [nx, ny, nz, cost] of this._neighbors(x, y, z, nb)) {
            const key = cellKey(nx, ny, nz)
            const d = here + cost
            const old = flow.get(key)
            if (old !== undefined && old <= d) continue
            flow.set(key, d)
            const bi = Math.round(d * 2)
            ;(buckets[bi] || (buckets[bi] = [])).push([nx, ny, nz])
          }
        }
      }
    } finally {
      this._memo = null
    }
    this._flow = flow
    this._flowJob = null
    return true
  }

  _playerCell(p = this.bm.tryMode.pos) {
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
      const cell = cellOf(key)
      if (d <= 40) far.push(cell)
      else near.push(cell)
    }
    if (far.length) return far
    if (near.length) return near
    // A small space: anywhere a little way off.
    const any = [...this._flow].filter(([, d]) => d >= 5).map(([key]) => cellOf(key))
    return any.length ? any : [...this._flow.keys()].map((key) => cellOf(key))
  }

  _spawnZombie() {
    const spots = this._spawnSpots()
    if (!spots.length) return false
    const open = this.camp ? spots.filter(([sx, , sz]) => !this.camp.inside(sx + 0.5, sz + 0.5, 1)) : spots
    if (!open.length) return false
    const [x, y, z] = open[Math.floor(Math.random() * open.length)]
    const boss = this._bossPending > 0
    if (boss) this._bossPending--
    const health = zombieHealth(this.wave, this.cfg.escalation) * this.cfg.zombieHealthMult * (boss ? BOSS_HEALTH_MULT : 1)
    if (boss) this._message(t('buildPlayBossComing'))
    this._makeZombie(++this._zid, x + 0.5, y, z + 0.5, health, boss)
    return true
  }

  // A zombie's body and state. id: the number the server knows it by
  // (the host's count - other players' copies use the host's ids).
  _makeZombie(id, x, y, z, health, boss) {
    const group = new THREE.Group()
    const zombie = { id, x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, health, maxHealth: health, attackCd: 0.6, bash: 0, flash: 0, walk: Math.random() * 6, moan: 2 + Math.random() * 8, group, body: null, boss, size: boss ? BOSS_SIZE : 1 }
    const batch = this._zombieBatch()
    if (batch) {
      // A copy of the shared body (same geometry and material): it only
      // carries the moving parts' positions - drawZombies() draws every
      // zombie's parts together, one draw per part.
      const body = batch.template.clone()
      const nodes = []
      body.traverse((o) => nodes.push(o))
      body.limbPivots = Object.fromEntries(Object.entries(batch.pivotIndex).map(([name, i]) => [name, nodes[i]]))
      zombie.parts = batch.partIndex.map((i) => nodes[i])
      for (const part of zombie.parts) part.visible = false
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
    return zombie
  }

  // Every zombie looks the same, so their bodies are drawn together: one
  // InstancedMesh per body part (head, torso, each limb...) instead of
  // about eight draws per zombie - a full wave used to add ~130 draws.
  _zombieBatch() {
    if (this._zBatch || !this._skin) return this._zBatch || null
    const template = buildTexturedCharacter(this._skin)
    const nodes = []
    template.traverse((o) => nodes.push(o))
    const partIndex = []
    nodes.forEach((o, i) => { if (o.isMesh) partIndex.push(i) })
    const pivotIndex = Object.fromEntries(Object.entries(template.limbPivots).map(([name, o]) => [name, nodes.indexOf(o)]))
    const size = MAX_ALIVE + 8
    const meshes = partIndex.map((i) => {
      const part = nodes[i]
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, size)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3).fill(1), 3)
      mesh.count = 0
      // The parts sit all over the map; their bounds aren't worth keeping.
      mesh.frustumCulled = false
      this.bm.scene.add(mesh)
      return mesh
    })
    this._zBatch = { template, partIndex, pivotIndex, meshes }
    return this._zBatch
  }

  // Called by BuildMode.render() just before drawing.
  drawZombies() {
    const batch = this._zBatch
    if (!batch) return
    const list = this.zombies.filter((z) => z.parts)
    for (const z of list) z.group.updateMatrixWorld(true)
    batch.meshes.forEach((mesh, p) => {
      list.forEach((z, i) => {
        mesh.setMatrixAt(i, z.parts[p].matrixWorld)
        const red = z.lastRed > 0
        mesh.instanceColor.setXYZ(i, 1, red ? 0.35 : 1, red ? 0.35 : 1)
      })
      mesh.count = list.length
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
    })
  }

  _disposeZombieBatch() {
    const batch = this._zBatch
    if (!batch) return
    for (const mesh of batch.meshes) {
      this.bm.scene.remove(mesh)
      mesh.dispose()
    }
    batch.template.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      for (const m of [].concat(o.material)) m.dispose()
    })
    this._zBatch = null
  }

  _removeZombie(z) {
    this.bm.scene.remove(z.group)
    // A batched body shares its geometry and material - nothing to free.
    if (z.parts) return
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
    const here = this._flow.get(cellKey(cx, cy, cz))
    if (here !== undefined) {
      let bestD = here
      for (const [nx, ny, nz] of this._neighbors(cx, cy, cz, this._nb || (this._nb = []))) {
        const d = this._flow.get(cellKey(nx, ny, nz))
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
    if (!player.idle && Math.hypot(px, pz) < ATTACK_RANGE && Math.abs(player.y - zb.y) < 1.5 && zb.attackCd <= 0) {
      zb.attackCd = ATTACK_COOLDOWN
      const bite = zombieDamage(this.wave) * this.cfg.zombieDamageMult * (zb.boss ? BOSS_DAMAGE_MULT : 1)
      // Another player on the server: the bite travels to them (nothing
      // reaches anyone inside the camp).
      if (player.remote) {
        if (!this.camp?.inside(player.x, player.z)) this.net?.queueHurt(player.remote, bite)
      } else this._hurtPlayer(bite)
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
      // A batched body gets its red tint in drawZombies().
      if (!zb.parts) {
        zb.group.traverse((o) => {
          if (o.isMesh && o.material.emissive) o.material.emissive.setRGB(red, 0, 0)
        })
      }
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
    this.health = Math.max(0, this.health - (amount - soaked))
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
    // After a respawn on a server only this life's waves count.
    const waves = Math.max(0, (won ? this.wave : this.wave - 1) - (this._lifeStartWave || 0))
    return this._report('end', {
      waves,
      kills: this.kills,
      bestStreak: this.bestStreak,
      headshots: this.stats.headshots,
      chests: this.stats.chests,
      meleeKills: this.stats.meleeKills,
      upgrades: Object.values(this.upgrades || {}).reduce((sum, n) => sum + n, 0),
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
    const extracted = won && this.cfg.mode === 'zombieExtraction'
    set('build-play-over-title', t(extracted ? 'extractionWinTitle' : won ? 'buildPlayOverWinTitle' : 'buildPlayOverTitle'))
    set('build-play-over-text', t(extracted ? 'extractionWinText' : won ? 'buildPlayOverWinText' : 'buildPlayOverText', { waves, kills: this.kills }))
    set('build-play-over-best', `${t('buildPlayOverBest', { n: best })}${reward?.legacy ? ` · ${t('buildPlayOverLegacy', { n: reward.legacy })}` : ''}`)
    set('build-play-again-btn', t('buildPlayAgainBtn'))
    set('build-play-back-btn', t(this.fromMenu ? 'buildPlayBackMenuBtn' : 'buildPlayBackBtn'))
    this._overEl.style.display = 'flex'
    if (document.pointerLockElement) document.exitPointerLock()
  }

  // Each frame while playing (after Try Map has moved you).
  update(dt) {
    if (!this.active) return
    // On a server the world goes on while you're dead or in the menu.
    const net = this.net && !this.net.closed ? this.net : null
    if (net) net.update(Math.min(dt, 0.25))
    if (!net && (this.dead || this.bm.menuOpen)) return
    // Nothing happens until a weapon has been picked.
    if (this._picking && !net) return
    dt = Math.min(dt, 1 / 20)
    const playing = !this.dead && !this.bm.menuOpen && !this._picking
    if (playing) this._updateMe(dt)
    if (net && !net.isHost) {
      this._updateMirroredZombies(dt)
      return
    }
    this._updateWorld(dt, playing)
  }

  // My own things: firing held, the camp, healing, messages, reloading.
  _updateMe(dt) {
    // Automatic guns keep firing while the button is held.
    if (this.bm._fireHeld && this.weapon.auto && document.pointerLockElement) this.bm.tryMode.fire()
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
  }

  // Who the zombies chase: me (unless dead) and, on a server, every other
  // living player. Each: { x, y, z, remote } in blocks (remote = their id).
  _targets() {
    const out = []
    if (!this.dead && !this._picking) {
      const p = this.bm.tryMode.pos
      out.push({ x: p.x, y: p.y, z: p.z, remote: null })
    }
    if (this.net && !this.net.closed) out.push(...this.net.targets())
    return out
  }

  // The zombies and the waves (alone, or as a server's host).
  _updateWorld(dt) {
    const targets = this._targets()
    const now = performance.now() / 1000
    const sources = targets.map((p) => this._playerCell(p))
    const key = sources.map((c) => c.join(',')).join(';')
    if (this._flowJob) {
      this._stepFlow(FLOW_BUDGET_MS)
    } else if (sources.length && (now - this._flowAt > PATH_REFRESH || this._flowKey !== key)) {
      this._flowAt = now
      this._flowKey = key
      // The first field is needed right away (zombies spawn from it).
      if (this._flow.size === 0) this._rebuildFlow(sources)
      else {
        this._startFlow(sources)
        this._stepFlow(FLOW_BUDGET_MS)
      }
    }
    // Waves.
    if (this._toSpawn === 0 && this.zombies.length === 0) {
      if (this._breakTimer > 0) {
        this._breakTimer -= dt
        if (this._breakTimer <= 0) this._startWave(this.wave + 1)
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
          // Zombie Extraction: the helicopter comes after enough waves.
          if (this.cfg.mode === 'zombieExtraction' && this.wave >= EXTRACTION_WAVES && !this._extract) this._placeExtraction()
          if (!rush) this._message(t('buildPlayWaveClear', { n: this.wave, s: WAVE_BREAK }))
        }
      }
    }
    if (this._toSpawn > 0 && this.zombies.length < MAX_ALIVE && sources.length) {
      this._spawnTimer -= dt
      if (this._spawnTimer <= 0 && this._skin !== undefined) {
        this._spawnTimer = SPAWN_GAP * (this.cfg.mode === 'zombieRush' ? RUSH_SPAWN_GAP_MULT : 1)
        if (this._spawnZombie()) this._toSpawn--
        this._renderHud()
      }
    }
    if (this._extract && this._updateExtraction(dt)) return
    const speed = zombieSpeed(this.wave, this.cfg.escalation)
    for (const zb of [...this.zombies]) {
      // Each zombie goes for the nearest player.
      let target = null
      let best = Infinity
      for (const p of targets) {
        const d = (p.x - zb.x) ** 2 + (p.z - zb.z) ** 2 + (p.y - zb.y) ** 2
        if (d < best) {
          best = d
          target = p
        }
      }
      this._updateZombie(zb, dt, target || { x: zb.x, y: zb.y, z: zb.z, idle: true }, speed)
      if (zb.health <= 0 && this.zombies.includes(zb)) this.damageZombie(zb, 0)
      if (this.dead && !this.net) return
    }
  }

  _startWave(n) {
    this.wave = n
    this._toSpawn = Math.max(1, Math.round(waveSize(this.wave) * this.cfg.zombieCountMult))
    this._bossPending = this.cfg.bossEvery && this.wave % this.cfg.bossEvery === 0 ? 1 : 0
    this._chestsUsed.clear()
    this._message(t('buildPlayWaveStart', { n: this.wave }))
    this._report('wave', { wave: this.wave })
    this._renderHud()
  }

  // --- Zombie Extraction ---

  // Where the helicopter lands: an open street cell (sky above it) that
  // zombies can walk to, EXTRACTION_MIN..MAX blocks of walking from you,
  // outside the camp. Falls back to the farthest reachable open cell.
  _placeExtraction() {
    const B = this.B
    // Open sky over the spot and room for the helicopter around it (a
    // 5x5 patch clear up high - it first landed in narrow alleys, half
    // inside the walls).
    const clear = (x, y, z, from) => {
      for (let dy = from; dy <= 14; dy++) if (this.bm.getBlockAt(x, y + dy, z)) return false
      return true
    }
    const open = (x, y, z) => {
      if (this.camp?.inside(x + 0.5, z + 0.5, 3)) return false
      if (!clear(x, y, z, 0)) return false
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) if (!clear(x + dx, y, z + dz, 1)) return false
      }
      return true
    }
    const good = []
    let far = null
    let farD = -1
    let any = null
    let anyD = -1
    for (const [key, d] of this._flow) {
      const [x, y, z] = cellOf(key)
      // A map with no open space at all still gets its helicopter.
      if (d > anyD && !this.camp?.inside(x + 0.5, z + 0.5, 1)) {
        anyD = d
        any = [x, y, z]
      }
      if (!open(x, y, z)) continue
      if (d >= EXTRACTION_MIN && d <= EXTRACTION_MAX) good.push([x, y, z])
      if (d > farD) {
        farD = d
        far = [x, y, z]
      }
    }
    const spot = good.length ? good[Math.floor(Math.random() * good.length)] : far || any
    if (!spot) return
    const [x, y, z] = spot
    const group = new THREE.Group()
    group.position.set((x + 0.5) * B, y * B, (z + 0.5) * B)
    // A glowing landing ring and a light beam you can see over the roofs.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(EXTRACTION_RADIUS * B * 0.86, EXTRACTION_RADIUS * B, 40),
      new THREE.MeshBasicMaterial({ color: 0xff4a2e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06 * B
    group.add(ring)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35 * B, 0.35 * B, 40 * B, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    beam.position.y = 20 * B
    group.add(beam)
    // The helicopter, hovering low over the ring: body, cockpit glass,
    // tail boom and fin, skids, and a turning rotor.
    const heli = new THREE.Group()
    const body = new THREE.MeshLambertMaterial({ color: 0x3d4a2c })
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1f1a })
    const glass = new THREE.MeshLambertMaterial({ color: 0x8fb8c9, emissive: 0x22333a })
    const box = (w, h, d, mat, px, py, pz) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(px * B, py * B, pz * B)
      heli.add(m)
      return m
    }
    box(2.2, 1.4, 3.4, body, 0, 1.2, 0)
    box(1.9, 0.9, 1.0, glass, 0, 1.45, 1.75)
    box(0.5, 0.5, 3.6, body, 0, 1.5, -3.4)
    box(0.15, 1.1, 0.8, body, 0, 2.0, -5.0)
    box(0.15, 0.15, 3.6, dark, -0.9, 0.2, 0)
    box(0.15, 0.15, 3.6, dark, 0.9, 0.2, 0)
    box(0.15, 0.45, 0.15, dark, -0.9, 0.45, 1)
    box(0.15, 0.45, 0.15, dark, 0.9, 0.45, 1)
    box(0.15, 0.45, 0.15, dark, -0.9, 0.45, -1)
    box(0.15, 0.45, 0.15, dark, 0.9, 0.45, -1)
    box(0.3, 0.4, 0.3, dark, 0, 2.1, 0)
    const rotor = new THREE.Group()
    rotor.position.y = 2.35 * B
    for (const r of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(7 * B, 0.06 * B, 0.35 * B), dark)
      blade.rotation.y = r
      rotor.add(blade)
    }
    heli.add(rotor)
    heli.position.y = 0.35 * B
    heli.rotation.y = Math.random() * Math.PI * 2
    group.add(heli)
    this.bm.scene.add(group)
    this._extract = { x: x + 0.5, y, z: z + 0.5, group, rotor, ring, hold: 0, dist: null }
    this._message(t('extractionReady'), 4)
    try { audioEngine.playExplosion?.() } catch { /* no audio */ }
    this._renderHud()
  }

  // Each frame once the helicopter is down: spin the rotor, and count up
  // while you stand on the ring (alive). Leaving it starts the count over.
  // True once you're out (the run is won).
  _updateExtraction(dt) {
    const ex = this._extract
    ex.rotor.rotation.y += dt * 14
    ex.ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 200)
    const p = this.bm.tryMode.pos
    const dist = Math.hypot(p.x - ex.x, p.z - ex.z)
    const was = Math.round(ex.dist ?? -1)
    ex.dist = dist
    const on = !this.dead && dist <= EXTRACTION_RADIUS && Math.abs(p.y - ex.y) < 2.5
    const before = Math.ceil(EXTRACTION_HOLD - ex.hold)
    if (on) ex.hold += dt
    else ex.hold = 0
    if (ex.hold >= EXTRACTION_HOLD) {
      this._win()
      return true
    }
    if (Math.round(dist) !== was || Math.ceil(EXTRACTION_HOLD - ex.hold) !== before) this._renderHud()
    return false
  }

  _disposeExtraction() {
    const ex = this._extract
    this._extract = null
    if (!ex) return
    this.bm.scene.remove(ex.group)
    ex.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
  }

  // --- servers (PlayNet.js) ---

  // What the host sends: every zombie, keyed "z<id>".
  zombieSnapshot() {
    const out = {}
    for (const z of this.zombies) {
      out[`z${z.id}`] = { x: +z.x.toFixed(2), y: +z.y.toFixed(2), z: +z.z.toFixed(2), r: +z.group.rotation.y.toFixed(2), hp: Math.round(z.health), max: Math.round(z.maxHealth || z.health), boss: !!z.boss }
    }
    return out
  }

  // Not the host: the host's zombies (made, moved, removed) and wave.
  _applyZombieSnapshot(zs, wave) {
    const seen = new Set()
    for (const [key, d] of Object.entries(zs)) {
      const id = Number(key.slice(1))
      if (!Number.isFinite(id)) continue
      seen.add(id)
      let z = this.zombies.find((o) => o.id === id)
      if (!z) {
        z = this._makeZombie(id, d.x, d.y, d.z, d.hp, d.boss)
        z.group.position.set(d.x * this.B, d.y * this.B, d.z * this.B)
      }
      z.tx = d.x
      z.ty = d.y
      z.tz = d.z
      z.tr = d.r
      if (d.hp < z.health) z.flash = 0.12
      z.health = d.hp
      z.maxHealth = d.max
    }
    for (const z of [...this.zombies]) {
      if (seen.has(z.id)) continue
      this._removeZombie(z)
      this.zombies = this.zombies.filter((o) => o !== z)
    }
    if (wave !== this.wave) {
      // The waves I've lived through pay like my own.
      if (wave > this.wave && this.wave > 0) this._earn(COIN_PER_WAVE)
      if (wave > 0) this._startWave(wave)
      this._toSpawn = 0
    }
    this._renderHud()
  }

  // Not the host: slide the host's zombies to where they are, walking.
  _updateMirroredZombies(dt) {
    const k = 1 - Math.exp(-12 * dt)
    const B = this.B
    for (const z of this.zombies) {
      if (z.tx === undefined) continue
      const ox = z.x
      const oz = z.z
      z.x += (z.tx - z.x) * k
      z.y += (z.ty - z.y) * k
      z.z += (z.tz - z.z) * k
      z.group.position.set(z.x * B, z.y * B, z.z * B)
      let dr = (z.tr || 0) - z.group.rotation.y
      dr = Math.atan2(Math.sin(dr), Math.cos(dr))
      z.group.rotation.y += dr * k
      const moveLen = dt > 0 ? Math.hypot(z.x - ox, z.z - oz) / dt : 0
      z.walk += dt * moveLen * 3.2
      const swing = Math.sin(z.walk) * Math.min(1, moveLen / 2) * 0.7
      if (z.body) {
        const lp = z.body.limbPivots
        lp.legR.rotation.x = swing
        lp.legL.rotation.x = -swing
        lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
        lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
      }
      if (z.flash > 0) z.flash -= dt
      z.lastRed = z.flash > 0 ? 0.6 : 0
    }
  }

  // The host: other players' hits on my zombies.
  _applyRemoteHits(hits) {
    for (const h of hits) {
      const id = Number(String(h.id).slice(1))
      const z = this.zombies.find((o) => o.id === id)
      if (z) this.damageZombie(z, Number(h.dmg) || 0, null, h.by)
    }
  }

  // I just became (or stopped being) the host.
  _onHostChange(isHost) {
    if (isHost) {
      // Carry on with the zombies as they are now.
      this._zid = Math.max(this._zid || 0, ...this.zombies.map((z) => z.id))
      for (const z of this.zombies) {
        if (z.tx !== undefined) {
          z.x = z.tx
          z.y = z.ty
          z.z = z.tz
        }
        z.vx = 0
        z.vz = 0
        z.vy = 0
      }
      this._toSpawn = 0
      this._breakTimer = this.zombies.length ? 0 : WAVE_BREAK
      this._message(t('serverYouHost'))
    }
  }

  // The server closed or can't be reached: carry on alone.
  _onServerLost(text) {
    this.net = null
    this._message(text, 4)
    for (const z of [...this.zombies]) this._removeZombie(z)
    this.zombies = []
    this._toSpawn = 0
    this._breakTimer = WAVE_BREAK
  }

  // On a server, Play Again after dying: up again at the start, same game.
  _respawn() {
    const start = this._findBlocks('playerstart')[0] || this._defaultStart()
    if (start) {
      const [x, y, z] = start
      this.bm.tryMode.pos.set(x + 0.5, y, z + 0.5)
      this.bm.tryMode.vel.set(0, 0, 0)
    }
    this.dead = false
    // A new life: the run already counted at death starts over from here.
    this._ended = false
    this._lifeStartWave = Math.max(0, this.wave - 1)
    this._startedAt = performance.now()
    this.kills = 0
    this.stats = { kills: 0, chests: 0, headshots: 0, meleeKills: 0 }
    this.bestStreak = 0
    this.bosses = 0
    this._coinsEarned = 0
    this.health = this.maxHealth
    this.mag = this.magSize()
    this.reserve = this.weapon.reserve
    this._reloadLeft = 0
    this.streak = 0
    this._overEl.style.display = 'none'
    this._renderHud()
  }
}

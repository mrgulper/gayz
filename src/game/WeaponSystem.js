import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { buildViewmodel, buildQuickMeleeKnifeModel } from './Viewmodels.js'
import { t, onLanguageChange } from './i18n.js'
import { getKeyFor } from './Keybinds.js'

const VIEWMODEL_BASE = new THREE.Vector3(0.26, -0.22, -0.5)
const EXPLOSIVE_PROP_RADIUS = 5
const EXPLOSIVE_PROP_DAMAGE_MIN = 70
const EXPLOSIVE_PROP_DAMAGE_MAX = 160
const VIEWMODEL_ADS = new THREE.Vector3(0.02, -0.1, -0.32)
const ADS_LERP_SPEED = 9

// Quick-melee: an always-available instant stab, independent of whatever
// gun is currently equipped - no weapon switch, no ammo, just a short
// cooldown. See WeaponSystem._quickMelee.
const QUICK_MELEE_DAMAGE = 150
const QUICK_MELEE_RANGE = 2.4
const QUICK_MELEE_COOLDOWN_MS = 500
const QUICK_MELEE_ANIM_MS = 220
const QUICK_MELEE_REST_POS = new THREE.Vector3(0.16, -0.32, -0.28)
const QUICK_MELEE_STAB_POS = new THREE.Vector3(0.02, -0.08, -0.55)

const WEAPONS = [
  {
    id: 'melee',
    name: 'Knife',
    melee: true,
    auto: true,
    fireInterval: 0.45,
    range: 2.4,
    damage: 45,
    magSize: 0,
    reserve: 0,
    unlocked: true,
  },
  {
    id: 'rifle',
    name: 'Rifle',
    auto: true,
    fireInterval: 0.1,
    reloadTime: 0.8,
    magSize: 30,
    reserve: 90,
    damage: 14,
    unlocked: true,
  },
  {
    id: 'pistol',
    name: 'Pistol',
    auto: false,
    fireInterval: 0.32,
    reloadTime: 0.55,
    magSize: 12,
    reserve: 48,
    damage: 26,
    unlocked: true,
  },
  {
    id: 'minigun',
    name: 'Minigun',
    auto: true,
    fireInterval: 0.06,
    reloadTime: 1.6,
    magSize: 150,
    reserve: 450,
    damage: 12,
    unlocked: false,
  },
  {
    id: 'uvlamp',
    name: 'UV Lamp',
    auto: true,
    fireInterval: 0.15,
    reloadTime: 1.0,
    magSize: 40,
    reserve: 120,
    damage: 0,
    unlocked: false,
  },
]

// Alternate stat blocks for the melee slot - see setMeleeVariant(). Found as
// loot, they replace the knife's stats/viewmodel in place rather than
// occupying a new weapon slot/key.
const MELEE_VARIANTS = {
  knife: { name: 'Knife', damage: 45, fireInterval: 0.45, range: 2.4 },
  bat: { name: 'Bat', damage: 75, fireInterval: 0.7, range: 2.2 },
  machete: { name: 'Machete', damage: 58, fireInterval: 0.3, range: 2.6 },
  uvbaton: { name: 'UV Baton', damage: 0, fireInterval: 0.5, range: 2.3 },
}

export class WeaponSystem {
  constructor(camera, scene, colliderMeshes, hud, zombieManager, onHitSurface, onZombieHit, onStealthTakedown) {
    this.camera = camera
    this.scene = scene
    this.colliderMeshes = colliderMeshes
    this.hud = hud
    this.zombieManager = zombieManager
    this.onHitSurface = onHitSurface
    this.onZombieHit = onZombieHit
    this.onStealthTakedown = onStealthTakedown

    this.weapons = WEAPONS.map((w) => ({ ...w, ammoInMag: w.magSize, ammoReserve: w.reserve, rarityMult: 1, rarityTier: null }))
    this.currentIndex = 0
    this.meleeVariant = 'knife'
    // Global damage multiplier - the XP-gem level-up pool's damage upgrade
    // stacks additively onto this rather than needing to touch every
    // weapon's own damage stat (see _fire's onHit call).
    this.damageMult = 1

    this.triggerDown = false
    this.timeSinceLastShot = Infinity
    this.reloading = false
    this.reloadEndsAt = 0

    this.raycaster = new THREE.Raycaster()
    this.muzzleLight = new THREE.PointLight(0xfff2b0, 0, 8)
    this.camera.add(this.muzzleLight)
    this.muzzleLight.position.set(0.26, -0.16, -0.85)

    this._time = 0
    this.recoil = 0
    this.aiming = false
    this.aimAmount = 0
    this.defaultFov = camera.fov
    this.aimFov = camera.fov * 0.6
    this._lerpedViewmodelPos = new THREE.Vector3()
    this._hitNormal = new THREE.Vector3()
    this.viewmodelRoot = new THREE.Group()
    this.viewmodelRoot.position.copy(VIEWMODEL_BASE)
    this.camera.add(this.viewmodelRoot)

    this.viewmodels = {}
    for (const w of this.weapons) {
      const vm = buildViewmodel(w.id)
      vm.visible = false
      this.viewmodelRoot.add(vm)
      this.viewmodels[w.id] = vm
    }
    this.viewmodels[this.current.id].visible = true

    // Quick-melee's own knife, parented to the same viewmodelRoot as every
    // other weapon so it inherits the same camera-relative positioning, but
    // never goes through _switchTo - it's an overlay that lunges into view
    // and back regardless of which weapon viewmodel is currently showing.
    this.quickMeleeKnife = buildQuickMeleeKnifeModel()
    this.quickMeleeKnife.position.copy(QUICK_MELEE_REST_POS)
    this.quickMeleeKnife.visible = false
    this.viewmodelRoot.add(this.quickMeleeKnife)
    this.quickMeleeCooldownUntil = 0
    this.quickMeleeAnimUntil = 0

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.triggerDown = true
      if (e.button === 2) this.aiming = true
    })
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.triggerDown = false
      if (e.button === 2) this.aiming = false
    })
    window.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', (e) => this._onKey(e))

    onLanguageChange(() => this._updateHud(this.reloading))

    this._updateHud()
  }

  get current() {
    return this.weapons[this.currentIndex]
  }

  unlockWeapon(id) {
    const index = this.weapons.findIndex((w) => w.id === id)
    if (index === -1) return
    this.weapons[index].unlocked = true
    this.weapons[index].ammoInMag = this.weapons[index].magSize
    this.weapons[index].ammoReserve = this.weapons[index].reserve
    this._switchTo(index)
  }

  attachScope(id) {
    const w = this.weapons.find((w) => w.id === id)
    if (w) w.hasScope = true
  }

  // Chest-found rarity upgrade (see Chests.js's rare_weapon/legendary_weapon
  // loot and Game.js's _onPickup) - takes the best tier found rather than
  // stacking multiplicatively, so finding two "rare" boosts on the same gun
  // doesn't quietly out-power a "legendary" one found elsewhere.
  applyRarityBoost(id, mult, tier) {
    const w = this.weapons.find((w) => w.id === id)
    if (!w || w.rarityMult >= mult) return false
    w.rarityMult = mult
    w.rarityTier = tier
    return true
  }

  // Picks a random currently-unlocked weapon id - used by rare/legendary
  // chest loot, which boosts whatever's already in the player's loadout
  // rather than a fixed slot.
  randomUnlockedWeaponId() {
    const unlocked = this.weapons.filter((w) => w.unlocked)
    if (unlocked.length === 0) return null
    return unlocked[Math.floor(Math.random() * unlocked.length)].id
  }

  // Swaps the melee slot's stats/viewmodel to an alternate found as loot -
  // replaces the knife in place rather than adding a new weapon slot/key.
  setMeleeVariant(variantId) {
    const stats = MELEE_VARIANTS[variantId]
    if (!stats) return
    const w = this.weapons[0]
    w.name = stats.name
    w.damage = stats.damage
    w.fireInterval = stats.fireInterval
    w.range = stats.range
    this.meleeVariant = variantId

    const variants = this.viewmodels.melee?.userData.meleeVariants
    if (variants) {
      for (const id in variants) variants[id].visible = id === variantId
    }
    this._updateHud()
  }

  // Cosmetic achievement reward (e.g. Centurion's gold pistol) - purely
  // visual, rebuilds just that one weapon's viewmodel with the skin applied.
  setWeaponSkin(weaponId, skinId) {
    const old = this.viewmodels[weaponId]
    if (!old) return
    const wasVisible = old.visible
    this.viewmodelRoot.remove(old)
    const vm = buildViewmodel(weaponId, { skinId })
    vm.visible = wasVisible
    this.viewmodelRoot.add(vm)
    this.viewmodels[weaponId] = vm
  }

  // Settings hook: keeps ADS zoom math (which lerps from defaultFov) correct
  // after the player changes their base field of view.
  setBaseFov(value) {
    this.defaultFov = value
    this.aimFov = value * 0.6
  }

  // Perk hook: speeds up reload across every non-melee weapon at once.
  boostReloadSpeed(mult) {
    for (const w of this.weapons) {
      if (!w.melee) w.reloadTime *= mult
    }
  }

  // Boosts the currently-equipped weapon's magazine and reserve capacity,
  // immediately refilling the bonus into both.
  addMagBonus(amount) {
    const w = this.current
    w.magSize += amount
    w.ammoInMag += amount
    w.reserve += amount
    w.ammoReserve += amount
    this._updateHud()
  }

  refillReserveAmmo() {
    for (const w of this.weapons) {
      if (w.unlocked) w.ammoReserve = w.reserve
    }
    this._updateHud()
  }

  addAmmoToCurrent(amount) {
    this.current.ammoReserve += amount
    this._updateHud()
  }

  // The melee slot's displayed name depends on which variant (knife/bat/
  // machete) is currently equipped, not on the fixed weapon id - every
  // other slot's key is just "weapon" + capitalized id, as before.
  _nameKeyFor(w) {
    if (w.id === 'melee' && this.meleeVariant !== 'knife') {
      return `weapon${this.meleeVariant.charAt(0).toUpperCase()}${this.meleeVariant.slice(1)}`
    }
    return `weapon${w.id.charAt(0).toUpperCase()}${w.id.slice(1)}`
  }

  getSummary() {
    return this.weapons.map((w) => ({
      id: w.id,
      name: w.name,
      nameKey: this._nameKeyFor(w),
      unlocked: w.unlocked,
      ammoInMag: w.ammoInMag,
      ammoReserve: w.ammoReserve,
    }))
  }

  _onKey(e) {
    if (e.code === 'Digit1') this._quickMelee()
    if (e.code === 'Digit2') this._switchTo(1)
    if (e.code === 'Digit3') this._switchTo(2)
    if (e.code === 'Digit4') this._switchTo(3)
    if (e.code === 'Digit5') this._switchTo(4)
    if (e.code === getKeyFor('reload')) this._reload()
  }

  // Public entry point for switching by slot index - used by Game.js's
  // weapon wheel, where the player picks a slot from a radial UI instead
  // of pressing its number key directly.
  switchToIndex(index) {
    this._switchTo(index)
  }

  _switchTo(index) {
    if (index === this.currentIndex || index >= this.weapons.length) return
    if (!this.weapons[index].unlocked) return
    if (this.reloading) return
    this.currentIndex = index
    for (const id in this.viewmodels) this.viewmodels[id].visible = false
    this.viewmodels[this.weapons[index].id].visible = true
    this._updateHud()
  }

  _reload() {
    const w = this.current
    if (w.melee) return
    if (this.reloading) return
    if (w.ammoInMag === w.magSize || w.ammoReserve === 0) return
    this.reloading = true
    this.reloadEndsAt = performance.now() / 1000 + w.reloadTime
    this._updateHud(true)
  }

  update(dt, isMoving = false) {
    this.timeSinceLastShot += dt
    this._time += dt
    this.recoil = Math.max(0, this.recoil - dt * 6)

    const aimTarget = this.aiming && !this.reloading ? 1 : 0
    this.aimAmount = THREE.MathUtils.damp(this.aimAmount, aimTarget, ADS_LERP_SPEED, dt)
    const aimFov = this.current.hasScope ? this.defaultFov * 0.35 : this.aimFov
    this.camera.fov = THREE.MathUtils.lerp(this.defaultFov, aimFov, this.aimAmount)
    this.camera.updateProjectionMatrix()

    this._updateViewmodelTransform(isMoving)
    this._updateBarrelSpin(dt)
    this._updateQuickMeleeAnim()

    if (this.reloading) {
      if (performance.now() / 1000 >= this.reloadEndsAt) {
        const w = this.current
        const needed = w.magSize - w.ammoInMag
        const taken = Math.min(needed, w.ammoReserve)
        w.ammoInMag += taken
        w.ammoReserve -= taken
        this.reloading = false
        this._updateHud()
      }
      this.muzzleLight.intensity = 0
      return
    }

    if (this.muzzleLight.intensity > 0) {
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 25)
    }

    const w = this.current
    const hasAmmo = w.melee || w.ammoInMag > 0
    const canFire = this.triggerDown && this.timeSinceLastShot >= w.fireInterval && hasAmmo
    if (canFire) {
      this._fire()
      if (!w.auto) this.triggerDown = false
    } else if (this.triggerDown && !hasAmmo && this.timeSinceLastShot >= 0.25) {
      this.timeSinceLastShot = 0
      if (!w.auto) this.triggerDown = false
    }

    if (!w.melee && w.ammoInMag === 0 && w.ammoReserve > 0) this._reload()
  }

  _updateBarrelSpin(dt) {
    const barrelCluster = this.viewmodels[this.current.id]?.userData.barrelCluster
    if (!barrelCluster) return
    const spinning = this.triggerDown && !this.reloading
    this._barrelSpinSpeed = THREE.MathUtils.damp(this._barrelSpinSpeed || 0, spinning ? 22 : 0, 6, dt)
    barrelCluster.rotation.z += this._barrelSpinSpeed * dt
  }

  _updateViewmodelTransform(isMoving) {
    const steadiness = 1 - this.aimAmount * 0.75
    const bobSpeed = isMoving ? 9 : 2.2
    const bobAmpY = (isMoving ? 0.02 : 0.006) * steadiness
    const bobAmpX = (isMoving ? 0.012 : 0.003) * steadiness
    const bobX = Math.cos(this._time * bobSpeed * 0.5) * bobAmpX
    const bobY = Math.abs(Math.sin(this._time * bobSpeed)) * bobAmpY

    this._lerpedViewmodelPos.lerpVectors(VIEWMODEL_BASE, VIEWMODEL_ADS, this.aimAmount)

    this.viewmodelRoot.position.set(
      this._lerpedViewmodelPos.x + bobX,
      this._lerpedViewmodelPos.y + bobY,
      this._lerpedViewmodelPos.z + this.recoil * 0.12
    )
    this.viewmodelRoot.rotation.x = -this.recoil * 0.18
  }

  _fire() {
    const w = this.current
    this.timeSinceLastShot = 0
    if (w.melee) {
      this.recoil = 0.6
      audioEngine.playMelee()
    } else {
      w.ammoInMag -= 1
      this.muzzleLight.intensity = 4
      this.recoil = 1
      this._updateHud()
      audioEngine.playShot(w.id)
    }

    const zombieMeshes = this.zombieManager ? this.zombieManager.hittableMeshes : []
    const pelletCount = w.pellets || 1
    const spread = w.spread || 0
    const hitZombies = new Set()
    let anyHit = false

    for (let i = 0; i < pelletCount; i++) {
      const offset = new THREE.Vector2(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread
      )
      this.raycaster.setFromCamera(offset, this.camera)
      const hits = this.raycaster.intersectObjects([...zombieMeshes, ...this.colliderMeshes], true)
      if (hits.length === 0) continue
      if (w.melee && hits[0].distance > w.range) continue

      anyHit = true
      const hit = hits[0]
      const zombieHit = hit.object.userData.zombie
      if (zombieHit) hitZombies.add(zombieHit)

      const explosive = hit.object.userData.explosive
      if (explosive && !explosive.exploded) {
        explosive.exploded = true
        explosive.mat.color.setHex(0x0a0a0a)
        explosive.mat.emissive?.setHex(0x1a0a00)
        if (this.zombieManager) this.zombieManager.explodeAt(explosive.x, explosive.z, EXPLOSIVE_PROP_RADIUS, EXPLOSIVE_PROP_DAMAGE_MIN, EXPLOSIVE_PROP_DAMAGE_MAX)
      }

      if (this.onHitSurface) {
        if (hit.face) {
          this._hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
        } else {
          this._hitNormal.set(0, 1, 0)
        }
        this.onHitSurface(hit.point, this._hitNormal, !!zombieHit)
      }
    }

    for (const zombie of hitZombies) {
      zombie.lastHitWeaponId = w.id
      if (w.id === 'uvlamp' || (w.id === 'melee' && this.meleeVariant === 'uvbaton')) {
        zombie.weaken(1500)
      } else {
        let damage = w.damage * this.damageMult * w.rarityMult
        // Stealth takedown: melee, and the zombie is facing away from the
        // player (its own forward vector points opposite the direction to
        // the player) - approaching from its blind side guarantees the kill
        // regardless of remaining health, rewarding flanking over head-on.
        if (w.melee) {
          const toPlayerX = this.camera.position.x - zombie.group.position.x
          const toPlayerZ = this.camera.position.z - zombie.group.position.z
          const toPlayerLen = Math.hypot(toPlayerX, toPlayerZ)
          if (toPlayerLen > 0.0001) {
            const facingX = Math.sin(zombie.group.rotation.y)
            const facingZ = Math.cos(zombie.group.rotation.y)
            const dot = (facingX * toPlayerX + facingZ * toPlayerZ) / toPlayerLen
            if (dot < -0.5) {
              damage = Math.max(damage, zombie.health)
              if (this.onStealthTakedown) this.onStealthTakedown()
            }
          }
        }
        zombie.onHit(damage)
      }
    }
    if (hitZombies.size > 0) {
      this._showHitmarker()
      if (this.onZombieHit) this.onZombieHit()
    }
    void anyHit
  }

  // Panic-button knife stab - fixed damage/range, doesn't touch
  // this.currentIndex or ammo, works no matter which gun is out. See the
  // QUICK_MELEE_* constants and _updateQuickMeleeAnim for the lunge visual.
  _quickMelee() {
    const now = performance.now()
    if (now < this.quickMeleeCooldownUntil) return
    this.quickMeleeCooldownUntil = now + QUICK_MELEE_COOLDOWN_MS
    this.quickMeleeAnimUntil = now + QUICK_MELEE_ANIM_MS
    this.quickMeleeKnife.visible = true
    audioEngine.playMelee()

    const zombieMeshes = this.zombieManager ? this.zombieManager.hittableMeshes : []
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    const hits = this.raycaster.intersectObjects([...zombieMeshes, ...this.colliderMeshes], true)
    if (hits.length === 0 || hits[0].distance > QUICK_MELEE_RANGE) return

    const hit = hits[0]
    const zombieHit = hit.object.userData.zombie
    if (zombieHit) {
      zombieHit.lastHitWeaponId = 'quickmelee'
      zombieHit.onHit(QUICK_MELEE_DAMAGE * this.damageMult)
      this._showHitmarker()
      if (this.onZombieHit) this.onZombieHit()
    }

    if (this.onHitSurface) {
      if (hit.face) {
        this._hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
      } else {
        this._hitNormal.set(0, 1, 0)
      }
      this.onHitSurface(hit.point, this._hitNormal, !!zombieHit)
    }
  }

  // Lunges the quick-melee knife into view and back over QUICK_MELEE_ANIM_MS,
  // independent of whatever weapon viewmodel is currently shown/animating.
  _updateQuickMeleeAnim() {
    if (!this.quickMeleeKnife.visible) return
    const now = performance.now()
    const remaining = this.quickMeleeAnimUntil - now
    if (remaining <= 0) {
      this.quickMeleeKnife.visible = false
      return
    }
    const t = 1 - remaining / QUICK_MELEE_ANIM_MS
    // Lunge out over the first half, snap back over the second.
    const stabT = t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2
    this.quickMeleeKnife.position.lerpVectors(QUICK_MELEE_REST_POS, QUICK_MELEE_STAB_POS, stabT)
  }

  _showHitmarker() {
    const marker = document.getElementById('hitmarker')
    marker.classList.remove('show')
    void marker.offsetWidth
    marker.classList.add('show')
  }

  _updateHud(reloadingLabel = false) {
    const w = this.current
    this.hud.weaponName.textContent = t(this._nameKeyFor(w))
    this.hud.ammo.textContent = w.melee
      ? t('ammoMelee')
      : reloadingLabel
        ? t('ammoReloading')
        : `${w.ammoInMag} / ${w.ammoReserve}`
  }
}

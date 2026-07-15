import * as THREE from 'three'
import { buildWorld } from './World.js'
import { PlayerController } from './PlayerController.js'
import { WeaponSystem } from './WeaponSystem.js'
import { ZombieManager } from './ZombieManager.js'
import { PickupManager } from './Pickups.js'
import { PlayerState } from './PlayerState.js'
import { Inventory } from './Inventory.js'
import { DayNightCycle } from './DayNightCycle.js'
import { ChestManager } from './Chests.js'
import { Minimap } from './Minimap.js'
import { DecalManager } from './Decals.js'
import { Achievements } from './Achievements.js'
import { rollPerks } from './Perks.js'
import { pickNightEvent } from './NightEvents.js'
import { ACTIONS, getKeyFor, setBinding, resetBindings, keyLabel } from './Keybinds.js'
import { audioEngine } from './Audio.js'
import { LANGUAGES, setLanguage, t, tHtml } from './i18n.js'
import { setColorblind } from './Accessibility.js'

const PICKUP_LABELS = {
  health: (label, isLoot, count = 1) =>
    count > 1 ? t('toastHealthAddedCount', { count }) : t('toastHealthAdded'),
  armor: () => t('toastArmorAdded'),
  ammo: (label, isLoot, count) => {
    if (isLoot) return t('toastAmmoScavenged')
    if (count && count > 1) return t('toastAmmoCratesCollected', { count })
    return t('toastAmmoCrateCollected')
  },
  minigun: () => t('toastMinigunAcquired'),
  battery: () => t('toastBatteryAdded'),
  noisemaker: () => t('toastNoisemakerAdded'),
  grenade: () => t('toastGrenadeAdded'),
  scope: () => t('toastScopeAdded'),
  fuelcan: () => t('toastFuelCanAdded'),
  extended_mag: () => t('toastMagAdded'),
  melee_bat: () => t('toastBatAdded'),
  melee_machete: () => t('toastMacheteAdded'),
}

const DIFFICULTY_PRESETS = {
  easy: { damageMult: 0.7, spawnRateMult: 0.75 },
  normal: { damageMult: 1, spawnRateMult: 1 },
  hard: { damageMult: 1.4, spawnRateMult: 1.3 },
}

const SETTINGS_STORAGE_KEY = 'gayz-settings'

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      language: parsed.language || 'en',
      musicVolume: parsed.musicVolume ?? 100,
      sfxVolume: parsed.sfxVolume ?? 100,
      difficulty: DIFFICULTY_PRESETS[parsed.difficulty] ? parsed.difficulty : 'normal',
      sensitivity: parsed.sensitivity ?? 100,
      fov: parsed.fov ?? 75,
      colorblind: parsed.colorblind ?? false,
    }
  } catch {
    return { language: 'en', musicVolume: 100, sfxVolume: 100, difficulty: 'normal', sensitivity: 100, fov: 75, colorblind: false }
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage unavailable (e.g. private browsing) - setting just won't persist.
  }
}

const BEST_STATS_KEY = 'gayz-best-stats'

function loadBestStats() {
  try {
    const raw = localStorage.getItem(BEST_STATS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return { bestNight: parsed.bestNight || 0, bestKills: parsed.bestKills || 0 }
  } catch {
    return { bestNight: 0, bestKills: 0 }
  }
}

function saveBestStats(stats) {
  try {
    localStorage.setItem(BEST_STATS_KEY, JSON.stringify(stats))
  } catch {
    // Storage unavailable - best stats just won't persist across sessions.
  }
}

const NIGHT_DURATION_MS = 90000
const FLASHLIGHT_DRAIN_PER_SEC = 1.5
const GENERATOR_DRAIN_PER_SEC = 100 / 150
const GENERATOR_REFUEL_RADIUS = 2.5
const GENERATOR_PASSIVE_REFUEL_PER_SEC = 6
const GENERATOR_FUELCAN_AMOUNT = 35

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000)
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
  const ss = String(totalSec % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('scene')
    this.menu = document.getElementById('menu')
    this.playBtn = document.getElementById('play-btn')
    this.crosshair = document.getElementById('crosshair')
    this.hudEl = document.getElementById('hud')
    this.statusHud = document.getElementById('status-hud')
    this.healthFill = document.getElementById('health-fill')
    this.healthValue = document.getElementById('health-value')
    this.armorFill = document.getElementById('armor-fill')
    this.armorValue = document.getElementById('armor-value')
    this.damageFlash = document.getElementById('damage-flash')
    this.pickupToast = document.getElementById('pickup-toast')
    this.deathScreen = document.getElementById('death-screen')
    this.respawnBtn = document.getElementById('respawn-btn')
    this.inventoryHud = document.getElementById('inventory-hud')
    this.healthPackCount = document.getElementById('health-pack-count')
    this.armorPackCount = document.getElementById('armor-pack-count')
    this.noisemakerCount = document.getElementById('noisemaker-count')
    this.grenadeCount = document.getElementById('grenade-count')
    this.inventoryPanel = document.getElementById('inventory-panel')
    this.panelHealthCount = document.getElementById('panel-health-count')
    this.panelArmorCount = document.getElementById('panel-armor-count')
    this.panelNoisemakerCount = document.getElementById('panel-noisemaker-count')
    this.panelGrenadeCount = document.getElementById('panel-grenade-count')
    this.panelWeaponsList = document.getElementById('panel-weapons-list')
    this.inventoryOpen = false
    this.staminaFill = document.getElementById('stamina-fill')
    this.batteryFill = document.getElementById('battery-fill')
    this.staminaValue = document.getElementById('stamina-value')
    this.progressHud = document.getElementById('progress-hud')
    this.nightValueEl = document.getElementById('night-value')
    this.timeValueEl = document.getElementById('time-value')
    this.killsValueEl = document.getElementById('kills-value')
    this.nightBanner = document.getElementById('night-banner')
    this.deathStats = document.getElementById('death-stats')
    this.interactPrompt = document.getElementById('interact-prompt')
    this.infectionIndicator = document.getElementById('infection-indicator')
    this.statsPanel = document.getElementById('stats-panel')
    this.phaseRow = document.getElementById('phase-row')
    this.phaseLabel = document.getElementById('phase-label')
    this.phaseTime = document.getElementById('phase-time')
    this.statsDay = document.getElementById('stats-day')
    this.statsDeaths = document.getElementById('stats-deaths')
    this.statsKills = document.getElementById('stats-kills')
    this.minimapWrap = document.getElementById('minimap-wrap')
    this.minimapCanvas = document.getElementById('minimap')
    this.menuBestStats = document.getElementById('menu-best-stats')
    this.difficultyBtns = document.querySelectorAll('.difficulty-btn')
    this.settingsBtn = document.getElementById('settings-btn')
    this.settingsPanel = document.getElementById('settings-panel')
    this.languageGrid = document.getElementById('language-grid')
    this.musicVolumeSlider = document.getElementById('music-volume')
    this.musicVolumeValue = document.getElementById('music-volume-value')
    this.sfxVolumeSlider = document.getElementById('sfx-volume')
    this.sfxVolumeValue = document.getElementById('sfx-volume-value')
    this.sensitivitySlider = document.getElementById('sensitivity-slider')
    this.sensitivityValue = document.getElementById('sensitivity-value')
    this.fovSlider = document.getElementById('fov-slider')
    this.fovValue = document.getElementById('fov-value')
    this.colorblindToggle = document.getElementById('colorblind-toggle')
    this.controlsGrid = document.getElementById('controls-grid')
    this.resetBindsBtn = document.getElementById('reset-binds-btn')
    this.rebindingAction = null
    this.settingsOpen = false
    this.settings = loadSettings()
    setLanguage(this.settings.language)
    this.difficulty = DIFFICULTY_PRESETS[this.settings.difficulty] || DIFFICULTY_PRESETS.normal
    this.bestStats = loadBestStats()

    this.night = 1
    this.kills = 0
    this.totalKills = 0
    this.totalDeaths = 0
    this.scrap = 0
    this.healthPackHealAmount = 200
    this.perkPanelOpen = false
    this.runStartedAt = performance.now()
    this.nightStartedAt = performance.now()
    this._scheduleNightEvent()

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200)

    const { colliders, solidMeshes, flickerLights, spawnPoints, hemiLight, sunLight, towerChestSpots, minigunSpot, generator } = buildWorld(this.scene)
    this.flickerLights = flickerLights
    this.minigunSpot = minigunSpot
    this.generator = generator
    this.spawnPoints = spawnPoints
    this.generatorFuel = 100
    this.maxGeneratorFuel = 100
    this.dayNight = new DayNightCycle(this.scene, hemiLight, sunLight)

    this.player = new PlayerController(this.camera, this.canvas, colliders, solidMeshes)
    this.scene.add(this.player.controls.object)

    this._addFlashlight()

    this.zombies = new ZombieManager(this.scene, this.difficulty.spawnRateMult)
    this.pickups = new PickupManager(this.scene, spawnPoints)
    this.pickups.spawnUnique('minigun', minigunSpot.x, minigunSpot.z, minigunSpot.y)
    this.pickups.spawnUnique('audiolog1', 0, -30, 0.5)
    this.pickups.spawnUnique('audiolog2', 0, 0, 0.5)
    this.pickups.spawnUnique('audiolog3', 0, 30, 0.5)
    this.chests = new ChestManager(this.scene, towerChestSpots)
    this.playerState = new PlayerState()
    this.inventory = new Inventory()
    this.achievements = new Achievements((def) => this._showAchievementToast(def))
    this.killCountsByWeapon = {}
    this.achievementLabel = document.getElementById('achievement-label')
    this.achievementTitle = document.getElementById('achievement-title')
    this.achievementToast = document.getElementById('achievement-toast')
    this.loreToast = document.getElementById('lore-toast')
    this.statsScrap = document.getElementById('stats-scrap')
    this.perkPanel = document.getElementById('perk-panel')
    this.perkPanelTitle = document.getElementById('perk-panel-title')
    this.perkScrapLine = document.getElementById('perk-scrap-line')
    this.perkOptions = document.getElementById('perk-options')
    this.perkSkipBtn = document.getElementById('perk-skip-btn')
    this.decals = new DecalManager(this.scene)
    this.minimap = new Minimap(this.minimapCanvas)
    this._camDir = new THREE.Vector3()

    const hud = {
      weaponName: document.getElementById('weapon-name'),
      ammo: document.getElementById('ammo'),
    }
    this.weapons = new WeaponSystem(
      this.camera,
      this.scene,
      solidMeshes,
      hud,
      this.zombies,
      (point, normal, isZombie) => this.decals.spawn(point, normal, isZombie)
    )

    audioEngine.setMusicVolume(this.settings.musicVolume / 100)
    audioEngine.setSfxVolume(this.settings.sfxVolume / 100)

    this._bindMenu()
    this._bindItemKeys()
    this._bindSettings()
    this._bindDifficulty()
    this._bindControlsTab()
    this.perkSkipBtn.addEventListener('click', () => this._closePerkPanel())
    this._applyLanguage()
    this._updateHealthHud()
    this._updateInventoryHud()
    this._updateProgressHud()
    this._updateStaminaHud()
    this._updateStatsPanel()
    this._onResize()
    window.addEventListener('resize', () => this._onResize())

    this.timer = new THREE.Timer()
    this.timer.connect(document)
    this.renderer.setAnimationLoop(() => this._tick())
  }

  _addFlashlight() {
    this.flashlight = new THREE.SpotLight(0xfff4dd, 3.2, 35, THREE.MathUtils.degToRad(38), 0.5, 1.3)
    this.flashlight.position.set(0, 0, 0)
    this.camera.add(this.flashlight)

    this.flashlightTarget = new THREE.Object3D()
    this.flashlightTarget.position.set(0, 0, -1)
    this.camera.add(this.flashlightTarget)
    this.flashlight.target = this.flashlightTarget

    this.flashlightOn = true
    this.flashlightBattery = 100
    this.maxFlashlightBattery = 100
  }

  _updateFlashlightBattery(dt) {
    if (this.flashlightOn && this.flashlightBattery > 0) {
      this.flashlightBattery = Math.max(0, this.flashlightBattery - FLASHLIGHT_DRAIN_PER_SEC * dt)
      if (this.flashlightBattery === 0) this.flashlightOn = false
    }
    this.flashlight.visible = this.flashlightOn
    this.batteryFill.style.width = `${(this.flashlightBattery / this.maxFlashlightBattery) * 100}%`
  }

  _bindMenu() {
    this.playBtn.addEventListener('click', () => {
      audioEngine.init()
      audioEngine.resume()
      audioEngine.startAmbient()
      audioEngine.startMusic()
      this.player.controls.lock()
    })

    this.respawnBtn.addEventListener('click', () => {
      this.playerState.respawn()
      this.player.resetPosition()
      this.zombies.reset()
      this.chests.reset()
      this.night = 1
      this.kills = 0
      this.runStartedAt = performance.now()
      this.nightStartedAt = performance.now()
      this._scheduleNightEvent()
      this._updateHealthHud()
      this._updateProgressHud()
      this.deathScreen.style.display = 'none'
      this.player.controls.lock()
    })

    this.player.controls.addEventListener('lock', () => {
      this.menu.style.display = 'none'
      this.crosshair.style.display = 'block'
      this.hudEl.style.display = 'block'
      this.statusHud.style.display = 'flex'
      this.inventoryHud.style.display = 'flex'
      this.progressHud.style.display = 'flex'
      this.statsPanel.style.display = 'flex'
      this.minimapWrap.style.display = 'block'
    })

    this.player.controls.addEventListener('unlock', () => {
      this.inventoryOpen = false
      this.inventoryPanel.style.display = 'none'
      this.interactPrompt.style.display = 'none'
      this.infectionIndicator.style.display = 'none'
      if (!this.playerState.alive) return
      this.menu.style.display = 'flex'
      this.crosshair.style.display = 'none'
      this.hudEl.style.display = 'none'
      this.statusHud.style.display = 'none'
      this.inventoryHud.style.display = 'none'
      this.progressHud.style.display = 'none'
      this.statsPanel.style.display = 'none'
      this.minimapWrap.style.display = 'none'
    })
  }

  _bindItemKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.player.controls.isLocked || !this.playerState.alive) return

      if (e.code === 'Tab') {
        e.preventDefault()
        this.inventoryOpen = !this.inventoryOpen
        this.inventoryPanel.style.display = this.inventoryOpen ? 'flex' : 'none'
        if (this.inventoryOpen) this._refreshInventoryPanel()
        return
      }

      if (this.inventoryOpen) return

      if (e.code === getKeyFor('heal')) {
        if (this.inventory.useHealthPack()) {
          this.playerState.heal(this.healthPackHealAmount)
          this.playerState.cureInfection()
          this._updateHealthHud()
          this._updateInventoryHud()
        }
      } else if (e.code === getKeyFor('armor')) {
        if (this.inventory.useArmorPack()) {
          this.playerState.addArmor(50)
          this._updateHealthHud()
          this._updateInventoryHud()
        }
      } else if (e.code === getKeyFor('flashlight')) {
        if (!this.flashlightOn && this.flashlightBattery <= 0) return
        this.flashlightOn = !this.flashlightOn
      } else if (e.code === getKeyFor('noisemaker')) {
        this._throwNoisemaker()
      } else if (e.code === getKeyFor('grenade')) {
        this._throwGrenade()
      } else if (e.code === getKeyFor('interact')) {
        const loot = this.chests.tryInteract()
        if (loot) {
          this._onPickup(loot.type, loot.label, false, loot.count)
          this.interactPrompt.style.display = 'none'
        } else if (this.nearGenerator && this.inventory.useFuelCan()) {
          this.generatorFuel = Math.min(this.maxGeneratorFuel, this.generatorFuel + GENERATOR_FUELCAN_AMOUNT)
        }
      } else if (e.code === getKeyFor('screenshot')) {
        this._takeScreenshot()
      }
    })
  }

  _takeScreenshot() {
    this.renderer.render(this.scene, this.camera)
    const link = document.createElement('a')
    link.download = `gayz-${Date.now()}.png`
    link.href = this.canvas.toDataURL('image/png')
    link.click()
  }

  _throwNoisemaker() {
    if (!this.inventory.useNoisemaker()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 8)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnNoisemakerThrow(origin, target)
    this._updateInventoryHud()
  }

  _throwGrenade() {
    if (!this.inventory.useGrenade()) return
    this.camera.getWorldDirection(this._camDir)
    const origin = this.player.controls.object.position.clone()
    const target = origin.clone().addScaledVector(this._camDir, 10)
    target.y = 0.3
    origin.y -= 0.3
    this.zombies.spawnGrenadeThrow(origin, target)
    this._updateInventoryHud()
  }

  _bindSettings() {
    this.languageGrid.innerHTML = LANGUAGES.map((lang) => `
      <button class="language-btn${lang.code === this.settings.language ? ' active' : ''}" data-lang="${lang.code}">
        <span class="lang-name">${lang.name}</span>
        <span class="lang-native">${lang.native}</span>
      </button>
    `).join('')

    this.languageGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.language-btn')
      if (!btn) return
      this.settings.language = btn.dataset.lang
      saveSettings(this.settings)
      setLanguage(this.settings.language)
      this._applyLanguage()
      for (const el of this.languageGrid.querySelectorAll('.language-btn')) {
        el.classList.toggle('active', el === btn)
      }
    })

    for (const tab of document.querySelectorAll('.settings-tab')) {
      tab.addEventListener('click', () => {
        for (const tabEl of document.querySelectorAll('.settings-tab')) tabEl.classList.toggle('active', tabEl === tab)
        for (const page of document.querySelectorAll('.settings-page')) {
          page.style.display = page.id === `settings-page-${tab.dataset.page}` ? 'block' : 'none'
        }
      })
    }

    this.musicVolumeSlider.value = this.settings.musicVolume
    this.musicVolumeValue.textContent = `${this.settings.musicVolume}%`
    this.sfxVolumeSlider.value = this.settings.sfxVolume
    this.sfxVolumeValue.textContent = `${this.settings.sfxVolume}%`

    this.musicVolumeSlider.addEventListener('input', () => {
      const value = Number(this.musicVolumeSlider.value)
      this.musicVolumeValue.textContent = `${value}%`
      this.settings.musicVolume = value
      audioEngine.setMusicVolume(value / 100)
      saveSettings(this.settings)
    })

    this.sfxVolumeSlider.addEventListener('input', () => {
      const value = Number(this.sfxVolumeSlider.value)
      this.sfxVolumeValue.textContent = `${value}%`
      this.settings.sfxVolume = value
      audioEngine.setSfxVolume(value / 100)
      saveSettings(this.settings)
    })

    this.sensitivitySlider.value = this.settings.sensitivity
    this.sensitivityValue.textContent = `${this.settings.sensitivity}%`
    this.player.controls.pointerSpeed = this.settings.sensitivity / 100

    this.fovSlider.value = this.settings.fov
    this.fovValue.textContent = `${this.settings.fov}`
    this.camera.fov = this.settings.fov
    this.camera.updateProjectionMatrix()
    this.weapons.setBaseFov(this.settings.fov)

    this.sensitivitySlider.addEventListener('input', () => {
      const value = Number(this.sensitivitySlider.value)
      this.sensitivityValue.textContent = `${value}%`
      this.settings.sensitivity = value
      this.player.controls.pointerSpeed = value / 100
      saveSettings(this.settings)
    })

    this.fovSlider.addEventListener('input', () => {
      const value = Number(this.fovSlider.value)
      this.fovValue.textContent = `${value}`
      this.settings.fov = value
      this.camera.fov = value
      this.camera.updateProjectionMatrix()
      this.weapons.setBaseFov(value)
      saveSettings(this.settings)
    })

    this.colorblindToggle.checked = this.settings.colorblind
    setColorblind(this.settings.colorblind)

    this.colorblindToggle.addEventListener('change', () => {
      this.settings.colorblind = this.colorblindToggle.checked
      setColorblind(this.settings.colorblind)
      saveSettings(this.settings)
    })

    this.settingsBtn.addEventListener('click', () => this._toggleSettings(!this.settingsOpen))

    // Click anywhere outside the settings content (the backdrop itself, not
    // a descendant) to close, in addition to toggling the Settings button.
    this.settingsPanel.addEventListener('click', (e) => {
      if (e.target === this.settingsPanel) this._toggleSettings(false)
    })
  }

  _bindControlsTab() {
    this._renderControlsGrid()
    this.resetBindsBtn.addEventListener('click', () => {
      resetBindings()
      this._renderControlsGrid()
    })
  }

  _renderControlsGrid() {
    this.controlsGrid.innerHTML = ACTIONS.map((a) => `
      <span class="control-label">${t(a.labelKey)}</span>
      <button class="control-key-btn" data-action="${a.id}">${keyLabel(getKeyFor(a.id))}</button>
    `).join('')

    for (const btn of this.controlsGrid.querySelectorAll('.control-key-btn')) {
      btn.addEventListener('click', () => this._startRebind(btn, btn.dataset.action))
    }
  }

  // Puts one button into "listening" mode, capturing the next keydown
  // anywhere as the new binding for that action (Escape cancels).
  _startRebind(btn, action) {
    if (this.rebindingAction) return
    this.rebindingAction = action
    btn.textContent = t('pressAnyKey')
    btn.classList.add('listening')

    const handler = (e) => {
      e.preventDefault()
      window.removeEventListener('keydown', handler, true)
      this.rebindingAction = null
      if (e.code !== 'Escape') setBinding(action, e.code)
      this._renderControlsGrid()
    }
    window.addEventListener('keydown', handler, true)
  }

  _bindDifficulty() {
    for (const btn of this.difficultyBtns) {
      btn.classList.toggle('active', btn.dataset.difficulty === this.settings.difficulty)
      btn.addEventListener('click', () => {
        const id = btn.dataset.difficulty
        if (!DIFFICULTY_PRESETS[id]) return
        this.settings.difficulty = id
        saveSettings(this.settings)
        this.difficulty = DIFFICULTY_PRESETS[id]
        this.zombies.setDifficultyMultiplier(this.difficulty.spawnRateMult)
        for (const b of this.difficultyBtns) b.classList.toggle('active', b === btn)
      })
    }
  }

  _toggleSettings(open) {
    this.settingsOpen = open
    this.settingsPanel.style.display = open ? 'flex' : 'none'
  }

  // Fires on every night transition: pauses gameplay and offers 3 random
  // perks (see Perks.js) purchased with scrap earned from kills.
  _openPerkPanel() {
    this.perkPanelOpen = true
    this.perkPanel.style.display = 'flex'
    this.perkPanelTitle.textContent = t('perkPanelTitle')
    this.perkSkipBtn.textContent = t('perkSkip')
    this._renderPerkOptions(rollPerks(3))
  }

  _renderPerkOptions(perks) {
    this.perkScrapLine.textContent = t('scrapLabel', { n: this.scrap })
    this.perkOptions.innerHTML = ''
    for (const perk of perks) {
      const btn = document.createElement('button')
      btn.className = 'perk-option'
      btn.disabled = this.scrap < perk.cost
      btn.innerHTML = `
        <span class="perk-name">${t(perk.titleKey)}</span>
        <span class="perk-cost">${t('perkCostLabel', { n: perk.cost })}</span>
      `
      btn.addEventListener('click', () => {
        if (this.scrap < perk.cost) return
        this.scrap -= perk.cost
        perk.apply(this)
        this._updateStatsPanel()
        this._closePerkPanel()
      })
      this.perkOptions.appendChild(btn)
    }
  }

  _closePerkPanel() {
    this.perkPanelOpen = false
    this.perkPanel.style.display = 'none'
  }

  // Re-renders every static UI string in the current language. Called once
  // at startup and again whenever the player picks a different language.
  _applyLanguage() {
    document.getElementById('menu-subtitle').textContent = t('menuSubtitle')
    document.getElementById('menu-subhint').textContent = t('menuSubhint')
    this.playBtn.textContent = t('playBtn')
    this.settingsBtn.textContent = t('settingsBtn')

    document.getElementById('ctrl-line-1').innerHTML = tHtml('ctrlLine1')
    document.getElementById('ctrl-line-2').innerHTML = tHtml('ctrlLine2')
    document.getElementById('ctrl-line-3').innerHTML = tHtml('ctrlLine3')
    document.getElementById('ctrl-line-4').innerHTML = tHtml('ctrlLine4')
    document.getElementById('ctrl-line-5').innerHTML = tHtml('ctrlLine5')

    this.interactPrompt.innerHTML = tHtml('interactPrompt')

    document.getElementById('settings-title').textContent = t('settingsTitle')
    document.getElementById('tab-language').textContent = t('tabLanguage')
    document.getElementById('tab-audio').textContent = t('tabAudio')
    document.getElementById('tab-controls').textContent = t('tabControls')
    this.resetBindsBtn.textContent = t('resetBinds')
    this._renderControlsGrid()
    document.getElementById('music-label').textContent = t('musicLabel')
    document.getElementById('sfx-label').textContent = t('sfxLabel')
    document.getElementById('sensitivity-label').textContent = t('sensitivityLabel')
    document.getElementById('fov-label').textContent = t('fovLabel')
    document.getElementById('colorblind-label').textContent = t('colorblindLabel')
    document.getElementById('infection-label').textContent = t('infectionLabel')
    document.getElementById('settings-hint').innerHTML = tHtml('settingsHint')

    document.getElementById('death-title').textContent = t('deathTitle')
    this.respawnBtn.textContent = t('respawnBtn')

    document.getElementById('inventory-title').textContent = t('inventoryTitle')
    document.getElementById('panel-health-label').textContent = t('healthPackLabel')
    document.getElementById('panel-armor-label').textContent = t('armorPackLabel')
    document.getElementById('panel-noisemaker-label').textContent = t('noisemakerLabel')
    document.getElementById('panel-grenade-label').textContent = t('grenadeLabel')
    document.getElementById('weapons-title').textContent = t('weaponsTitle')
    document.getElementById('inventory-hint').innerHTML = tHtml('inventoryHint')

    document.getElementById('stats-day-label').textContent = t('dayLabel')
    document.getElementById('stats-deaths-label').textContent = t('deathsLabel')
    document.getElementById('stats-kills-label').textContent = t('killsLabel')
    document.getElementById('stats-scrap-label').textContent = t('scrapStatLabel')

    document.getElementById('diff-easy').textContent = t('difficultyEasy')
    document.getElementById('diff-normal').textContent = t('difficultyNormal')
    document.getElementById('diff-hard').textContent = t('difficultyHard')

    this._updateBestStatsDisplay()
    if (this.inventoryOpen) this._refreshInventoryPanel()
    this._updateProgressHud()
  }

  _updateBestStatsDisplay() {
    const { bestNight, bestKills } = this.bestStats
    if (bestNight === 0 && bestKills === 0) {
      this.menuBestStats.textContent = ''
      return
    }
    this.menuBestStats.textContent =
      `${t('bestLabel')}: ${t('hudNight', { n: bestNight })} · ${t('hudKills', { n: bestKills })}`
  }

  _refreshInventoryPanel() {
    this.panelHealthCount.textContent = this.inventory.healthPacks
    this.panelArmorCount.textContent = this.inventory.armorPacks
    this.panelNoisemakerCount.textContent = this.inventory.noisemakers
    this.panelGrenadeCount.textContent = this.inventory.grenades

    this.panelWeaponsList.innerHTML = this.weapons
      .getSummary()
      .map((w) => {
        const name = t(w.nameKey)
        return `
        <div class="inv-panel-row">
          <span>${name}</span>
          <span>${w.unlocked ? `${w.ammoInMag} / ${w.ammoReserve}` : t('lockedLabel')}</span>
        </div>
      `
      })
      .join('')
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  _onZombieAttack(damage) {
    this.playerState.takeDamage(damage * this.difficulty.damageMult)
    this._updateHealthHud()
    audioEngine.playZombieSnarl()
    this.damageFlash.classList.remove('hit')
    void this.damageFlash.offsetWidth
    this.damageFlash.classList.add('hit')

    if (!this.playerState.alive) this._onPlayerDeath()
  }

  _onZombieKilled(zombieTypeId, weaponId) {
    this.kills += 1
    this.totalKills += 1
    this.achievements.unlock('first_blood')
    if (this.totalKills >= 100) this.achievements.unlock('centurion')
    if (zombieTypeId === 'brute' && weaponId === 'melee') this.achievements.unlock('brute_knife')
    if (weaponId === 'minigun') {
      this.killCountsByWeapon.minigun = (this.killCountsByWeapon.minigun || 0) + 1
      if (this.killCountsByWeapon.minigun >= 50) this.achievements.unlock('meat_grinder')
    }
    if (Math.random() < 0.25) {
      this.scrap += 2 + Math.floor(Math.random() * 4)
      this._updateStatsPanel()
    }
  }

  _showAchievementToast(def) {
    this.achievementLabel.textContent = t('achievementUnlocked')
    this.achievementTitle.textContent = t(def.titleKey)
    this.achievementToast.classList.remove('show')
    void this.achievementToast.offsetWidth
    this.achievementToast.classList.add('show')
  }

  _showLoreToast(text) {
    this.loreToast.textContent = text
    this.loreToast.classList.remove('show')
    void this.loreToast.offsetWidth
    this.loreToast.classList.add('show')
  }

  _onPlayerDeath() {
    this.player.controls.unlock()
    this.crosshair.style.display = 'none'
    this.hudEl.style.display = 'none'
    this.statusHud.style.display = 'none'
    this.inventoryHud.style.display = 'none'
    this.progressHud.style.display = 'none'
    this.interactPrompt.style.display = 'none'
    this.statsPanel.style.display = 'none'
    this.minimapWrap.style.display = 'none'
    this.totalDeaths += 1
    this._updateStatsPanel()
    if (this.totalDeaths === 1) this.achievements.unlock('first_death')

    let improved = false
    if (this.night > this.bestStats.bestNight) { this.bestStats.bestNight = this.night; improved = true }
    if (this.kills > this.bestStats.bestKills) { this.bestStats.bestKills = this.kills; improved = true }
    if (improved) {
      saveBestStats(this.bestStats)
      this._updateBestStatsDisplay()
    }

    const elapsed = formatTime(performance.now() - this.runStartedAt)
    this.deathStats.textContent = t('deathStats', { night: this.night, kills: this.kills, time: elapsed })
    this.deathScreen.style.display = 'flex'
  }

  _onPickup(type, label, isLoot, count) {
    if (type === 'health') this.inventory.addHealthPack(count || 1)
    else if (type === 'armor') this.inventory.addArmorPack(1)
    else if (type === 'ammo') {
      if (isLoot) this.weapons.addAmmoToCurrent(12)
      else if (count) this.weapons.addAmmoToCurrent(12 * count)
      else this.weapons.refillReserveAmmo()
    } else if (type === 'minigun') {
      this.weapons.unlockWeapon('minigun')
      this.achievements.unlock('minigun_unlocked')
    }
    else if (type === 'battery') {
      this.flashlightBattery = Math.min(this.maxFlashlightBattery, this.flashlightBattery + 40)
    } else if (type === 'noisemaker') this.inventory.addNoisemaker(count || 1)
    else if (type === 'grenade') this.inventory.addGrenade(count || 1)
    else if (type === 'scope') this.weapons.attachScope('rifle')
    else if (type === 'extended_mag') this.weapons.addMagBonus(this.weapons.current.id === 'minigun' ? 50 : 10)
    else if (type === 'fuelcan') this.inventory.addFuelCan(count || 1)
    else if (type === 'melee_bat') this.weapons.setMeleeVariant('bat')
    else if (type === 'melee_machete') this.weapons.setMeleeVariant('machete')
    else if (type.startsWith('audiolog')) {
      audioEngine.playAudioLog()
      this._showLoreToast(t(`lore${type.charAt(0).toUpperCase()}${type.slice(1)}`))
      return
    }

    this._updateInventoryHud()
    const format = PICKUP_LABELS[type] || (() => label)
    this.pickupToast.textContent = format(label, isLoot, count)
    this.pickupToast.classList.remove('show')
    void this.pickupToast.offsetWidth
    this.pickupToast.classList.add('show')
  }

  _updateInventoryHud() {
    this.healthPackCount.textContent = this.inventory.healthPacks
    this.armorPackCount.textContent = this.inventory.armorPacks
    this.noisemakerCount.textContent = this.inventory.noisemakers
    this.grenadeCount.textContent = this.inventory.grenades
  }

  _updateHealthHud() {
    const s = this.playerState
    this.healthFill.style.width = `${(s.health / s.maxHealth) * 100}%`
    this.healthValue.textContent = Math.round(s.health)
    this.armorFill.style.width = `${(s.armor / s.maxArmor) * 100}%`
    this.armorValue.textContent = Math.round(s.armor)
    this.damageFlash.classList.toggle('low-health', s.health > 0 && s.health < 30)
    this.infectionIndicator.style.display = s.infected ? 'flex' : 'none'
  }

  _updateProgressHud() {
    this.nightValueEl.textContent = t('hudNight', { n: this.night })
    this.timeValueEl.textContent = formatTime(performance.now() - this.runStartedAt)
    this.killsValueEl.textContent = t('hudKills', { n: this.kills })
  }

  _updateStaminaHud() {
    this.staminaFill.style.width = `${(this.player.stamina / this.player.maxStamina) * 100}%`
    this.staminaValue.textContent = Math.round(this.player.stamina)
  }

  _updateStatsPanel() {
    this.statsDay.textContent = this.dayNight ? this.dayNight.getDayNumber() : 1
    this.statsDeaths.textContent = this.totalDeaths
    this.statsKills.textContent = this.totalKills
    this.statsScrap.textContent = this.scrap

    if (this.dayNight) {
      const { phase, remainingMs } = this.dayNight.getPhaseInfo()
      this.phaseLabel.textContent = phase === 'Day' ? t('dayLabel') : t('nightLabel')
      this.phaseTime.textContent = formatTime(remainingMs)
      this.phaseRow.classList.toggle('is-day', phase === 'Day')
      this.phaseRow.classList.toggle('is-night', phase === 'Night')
    }
  }

  _showNightBanner() {
    const nightText = t('hudNight', { n: this.night })
    this.nightBanner.textContent = this.night % 5 === 0 ? `${nightText} — ${t('bossWarning')}` : nightText
    this.nightBanner.classList.remove('show')
    void this.nightBanner.offsetWidth
    this.nightBanner.classList.add('show')
  }

  // Picks a random moment within the current night-round for a random event
  // to fire (see NIGHT_EVENTS) - called whenever a round starts/restarts.
  _scheduleNightEvent() {
    this.nextEventAt = this.nightStartedAt + 10000 + Math.random() * (NIGHT_DURATION_MS - 15000)
    this.eventTriggeredForNight = false
  }

  _updateFlicker(elapsed) {
    // Streetlights fade out during the day rather than staying lit - and
    // stay dark regardless of time of day if the generator has run dry.
    if (this.generatorFuel <= 0) {
      for (const f of this.flickerLights) f.light.intensity = 0
      return
    }
    const nightStrength = 1 - this.dayNight.dayFactor * 0.9
    for (const f of this.flickerLights) {
      const n = Math.sin(elapsed * 9 + f.seed) * Math.sin(elapsed * 3.7 + f.seed)
      f.light.intensity = f.base * (0.65 + 0.35 * Math.max(0, n)) * nightStrength
    }
  }

  _updateGenerator(dt, playerPos) {
    const dist = Math.hypot(playerPos.x - this.generator.x, playerPos.z - this.generator.z)
    this.generatorFuel = Math.max(0, this.generatorFuel - GENERATOR_DRAIN_PER_SEC * dt)
    if (dist <= GENERATOR_REFUEL_RADIUS) {
      this.generatorFuel = Math.min(this.maxGeneratorFuel, this.generatorFuel + GENERATOR_PASSIVE_REFUEL_PER_SEC * dt)
    }

    const fraction = this.generatorFuel / this.maxGeneratorFuel
    const mat = this.generator.indicatorMat
    if (this.generatorFuel <= 0) {
      mat.color.setHex(0x2a0505)
      mat.emissive.setHex(0xff2a1e)
    } else if (fraction < 0.3) {
      mat.color.setHex(0x2a2005)
      mat.emissive.setHex(0xffcf3e)
    } else {
      mat.color.setHex(0x0a2a0a)
      mat.emissive.setHex(0x2aff3e)
    }

    this.nearGenerator = dist <= GENERATOR_REFUEL_RADIUS
  }

  _updateMinimap(playerPos) {
    this.camera.getWorldDirection(this._camDir)
    const facingRad = Math.atan2(this._camDir.x, -this._camDir.z)
    const zombiePositions = this.zombies.zombies
      .filter((z) => z.state === 'alive')
      .map((z) => ({ x: z.group.position.x, z: z.group.position.z }))
    const minigunUnlocked = this.weapons.getSummary().find((w) => w.id === 'minigun')?.unlocked
    this.minimap.update(
      playerPos,
      facingRad,
      zombiePositions,
      this.chests.chests,
      minigunUnlocked ? null : this.minigunSpot
    )
  }

  _tick() {
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.1)
    const elapsed = this.timer.getElapsed()

    this.dayNight.update()
    this._updateFlicker(elapsed)

    if (this.player.controls.isLocked && this.playerState.alive && !this.inventoryOpen && !this.perkPanelOpen) {
      this.player.update(dt)
      const isMoving = this.player.onGround && (
        this.player.input.forward || this.player.input.back ||
        this.player.input.left || this.player.input.right
      )
      this.weapons.update(dt, isMoving)
      this._updateStaminaHud()
      this._updateFlashlightBattery(dt)

      this.playerState.tickInfection(dt)
      this._updateHealthHud()

      if (!this.eventTriggeredForNight && performance.now() >= this.nextEventAt) {
        this.eventTriggeredForNight = true
        const event = pickNightEvent()
        event.apply(this)
        this._showLoreToast(t(event.labelKey))
      }

      if (performance.now() - this.nightStartedAt > NIGHT_DURATION_MS) {
        this.night += 1
        this.nightStartedAt = performance.now()
        this._scheduleNightEvent()
        this.zombies.applyDifficulty(this.night)
        this._showNightBanner()
        if (this.night >= 5) this.achievements.unlock('survivor_5')
        if (this.night >= 10) this.achievements.unlock('survivor_10')
        this._openPerkPanel()
      }
      this._updateProgressHud()
      this._updateStatsPanel()

      const playerPos = this.player.controls.object.position
      this.zombies.update(
        dt,
        playerPos,
        (dmg) => this._onZombieAttack(dmg),
        (x, z) => this.pickups.spawnLootDrop('ammo', x, z),
        () => audioEngine.playAmbushShriek(),
        (zombieTypeId, weaponId) => this._onZombieKilled(zombieTypeId, weaponId),
        this.player.isCrouching
      )
      this.pickups.update(dt, elapsed, playerPos, {
        onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
      })

      this.chests.update(dt, elapsed, playerPos)
      this._updateGenerator(dt, playerPos)

      const canRefuelGenerator = this.nearGenerator && this.inventory.fuelCans > 0 && this.generatorFuel < this.maxGeneratorFuel
      if (this.chests.nearbyChest) {
        this.interactPrompt.innerHTML = tHtml('interactPrompt')
        this.interactPrompt.style.display = 'block'
      } else if (canRefuelGenerator) {
        this.interactPrompt.innerHTML = tHtml('interactRefuel')
        this.interactPrompt.style.display = 'block'
      } else {
        this.interactPrompt.style.display = 'none'
      }
      this._updateMinimap(playerPos)
    }

    this.renderer.render(this.scene, this.camera)
  }
}

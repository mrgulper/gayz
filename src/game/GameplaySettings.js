// Ten settings added together (2026-10-30, Gaymi's list): crosshair style,
// damage numbers, zombie name tags, auto pick-up, confirm before dropping
// rare items, brighter caves and Demon Realm, colourblind-friendly zombie
// rarity colours, hold- or tap-to-sprint, a Zombie Noises volume, and
// Design a Skin's High Contrast (moved here from the designer's toolbar).
// Each row is one control in Settings (index.html) and one key in
// game.settings; the game reads the keys where they matter (PlayDrops,
// PlayInventory, BuildTryMode, BuildMode's fog, ZombieNames, Audio).
import { saveSettings } from './Game.js'
import { audioEngine } from './Audio.js'
import { setColorblindRarity } from './ZombieNames.js'

const ROWS = [
  { id: 'crosshair-style-select', key: 'crosshairStyle' },
  { id: 'damage-numbers-toggle', key: 'damageNumbers' },
  { id: 'zombie-name-tags-toggle', key: 'zombieNameTags' },
  // Other players' spray tags on servers (Sprays.js, 2026-11-01).
  { id: 'show-other-sprays-toggle', key: 'showOtherSprays' },
  { id: 'sprint-mode-select', key: 'sprintMode' },
  { id: 'auto-jump-toggle', key: 'autoJump' },
  { id: 'battle-view-select', key: 'battleView' },
  { id: 'auto-pickup-toggle', key: 'autoPickup' },
  { id: 'confirm-rare-drop-toggle', key: 'confirmRareDrop' },
  { id: 'skin-designer-contrast-toggle', key: 'skinDesignerHighContrast' },
  { id: 'dark-area-boost-toggle', key: 'darkAreaBoost' },
  { id: 'colorblind-rarity-toggle', key: 'colorblindRarity' },
]

// Design a Skin (public/skin-designer/index.html, same origin) reads this
// key on load and on the 'storage' event, so a change shows straight away.
const DESIGNER_CONTRAST_KEY = 'skindesigner-avatar-pixel-editor-high-contrast'

export function applyGameplaySettings(game) {
  const s = game.settings
  document.body.dataset.crosshair = s.crosshairStyle || 'cross'
  setColorblindRarity(!!s.colorblindRarity)
  try {
    localStorage.setItem(DESIGNER_CONTRAST_KEY, s.skinDesignerHighContrast ? '1' : '0')
  } catch {
    // Storage blocked - the designer just keeps its own look.
  }
  audioEngine.setZombieVolume((s.zombieVolume ?? 100) / 100)
}

export function bindGameplaySettings(game) {
  // The designer's old toolbar button saved its own choice: keep it.
  try {
    if (localStorage.getItem(DESIGNER_CONTRAST_KEY) === '1' && !game.settings.skinDesignerHighContrast) {
      game.settings.skinDesignerHighContrast = true
      saveSettings(game.settings)
    }
  } catch {
    // Storage blocked.
  }
  for (const { id, key } of ROWS) {
    const el = document.getElementById(id)
    if (!el) continue
    if (el.type === 'checkbox') el.checked = !!game.settings[key]
    else el.value = game.settings[key]
    el.addEventListener('change', () => {
      game.settings[key] = el.type === 'checkbox' ? el.checked : el.value
      applyGameplaySettings(game)
      saveSettings(game.settings)
    })
  }
  const slider = document.getElementById('zombie-volume')
  const shown = document.getElementById('zombie-volume-value')
  if (slider) {
    slider.value = game.settings.zombieVolume ?? 100
    if (shown) shown.textContent = `${slider.value}%`
    slider.addEventListener('input', () => {
      game.settings.zombieVolume = Number(slider.value)
      if (shown) shown.textContent = `${slider.value}%`
      applyGameplaySettings(game)
      saveSettings(game.settings)
    })
    if (shown) game._bindEditableSliderValue?.(shown, slider)
  }
  applyGameplaySettings(game)
}

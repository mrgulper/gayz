// Loadout Presets - extends the existing hotbarPresets (weapon slots only)
// with up to 3 named saves of class+difficulty+companion role, the 3
// selections in the "Choose Class"/"Difficulty" panels. Click Save Setup to
// add one (round-robin once all 3 slots are full); click a chip to load it;
// double-click to rename; click a chip's duplicate/x to copy/delete it.
//
// Plain exported functions taking `game` as an explicit first parameter,
// same shape as MenuEasterEggs.js/Keybinds.js - this is homepage UI state
// (a settings-backed list + its rendering), not a simulation entity with a
// per-frame lifecycle. Zero THREE.js coupling: loading a preset works by
// calling .click() on the real difficulty/loadout/role buttons rather than
// duplicating their logic, so every other listener tied to those clicks
// still fires normally and this module can't drift out of sync with what
// those buttons actually do.
import { t } from './i18n.js'
import { LOADOUT_LABEL_KEYS, saveSettings } from './Game.js'

export function saveMenuPreset(game) {
  // Reads the difficulty button's own current (already-translated) label
  // rather than a new i18n key map - DIFFICULTY_LABEL_KEYS doesn't exist in
  // this codebase (only the flavor-text DIFFICULTY_FLAVOR_KEYS does).
  const diffBtn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === game.settings.difficulty)
  const preset = {
    difficulty: game.settings.difficulty,
    loadout: game.settings.loadout,
    companionRole: game.settings.companionRole,
    label: (diffBtn ? diffBtn.textContent : game.settings.difficulty) + ' · ' + t(LOADOUT_LABEL_KEYS[game.settings.loadout]),
  }
  if (game.settings.menuPresets.length >= 3) game.settings.menuPresets.shift()
  game.settings.menuPresets.push(preset)
  saveSettings(game.settings)
  renderMenuPresets(game)
}

export function loadMenuPreset(game, i) {
  const preset = game.settings.menuPresets[i]
  if (!preset) return
  const diffBtn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === preset.difficulty)
  if (diffBtn && diffBtn.style.display !== 'none') diffBtn.click()
  const loadoutBtn = Array.from(game.loadoutBtns).find((b) => b.dataset.loadout === preset.loadout)
  if (loadoutBtn) loadoutBtn.click()
  const roleBtn = Array.from(game.roleBtns).find((b) => b.dataset.role === preset.companionRole)
  if (roleBtn) roleBtn.click()
}

// Surprise Me - picks a random visible difficulty + random role + random
// loadout, then clicks each real button (same .click() trick loadMenuPreset
// uses above) so every other listener tied to those clicks still fires
// normally, rather than setting state directly.
export function surpriseMe(game) {
  const visibleDiffBtns = Array.from(game.difficultyBtns).filter((b) => b.style.display !== 'none')
  if (visibleDiffBtns.length) visibleDiffBtns[Math.floor(Math.random() * visibleDiffBtns.length)].click()
  const roleBtns = Array.from(game.roleBtns)
  if (roleBtns.length) roleBtns[Math.floor(Math.random() * roleBtns.length)].click()
  const loadoutBtns = Array.from(game.loadoutBtns)
  if (loadoutBtns.length) loadoutBtns[Math.floor(Math.random() * loadoutBtns.length)].click()
}

export function deleteMenuPreset(game, i) {
  game.settings.menuPresets.splice(i, 1)
  saveSettings(game.settings)
  renderMenuPresets(game)
}

export function renderMenuPresets(game) {
  if (!game.menuPresetChips) return
  game.menuPresetChips.innerHTML = ''
  game.settings.menuPresets.forEach((preset, i) => {
    const chip = document.createElement('div')
    chip.className = 'preset-chip'
    // Favorite Loadout Pin - a starred preset, visible right here on the
    // homepage (this chip row already lives outside any panel) rather than
    // needing a second display somewhere else.
    const pin = document.createElement('span')
    pin.className = `preset-pin${game.settings.pinnedPreset === i ? ' active' : ''}`
    pin.textContent = '★'
    pin.title = t('pinPresetTooltip')
    pin.addEventListener('click', (e) => {
      e.stopPropagation()
      game.settings.pinnedPreset = game.settings.pinnedPreset === i ? null : i
      saveSettings(game.settings)
      renderMenuPresets(game)
    })
    const label = document.createElement('span')
    label.textContent = preset.label
    label.title = t('presetClickToLoad')
    label.addEventListener('click', () => loadMenuPreset(game, i))
    // Rename via inline edit (double-click) - a real <input> swapped in for
    // the span, not window.prompt(); this codebase has no existing prompt()
    // usage anywhere else and consistently uses real inputs instead (see
    // the Settings Code paste flow's own comment on the same choice).
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'preset-rename-input'
      input.value = preset.label
      input.maxLength = 40
      const commit = () => {
        const trimmed = input.value.trim().slice(0, 40)
        if (trimmed) {
          game.settings.menuPresets[i] = { ...preset, label: trimmed }
          saveSettings(game.settings)
        }
        renderMenuPresets(game)
      }
      input.addEventListener('blur', commit)
      input.addEventListener('keydown', (ke) => { if (ke.key === 'Enter') input.blur() })
      label.replaceWith(input)
      input.focus()
      input.select()
    })
    const dup = document.createElement('span')
    dup.className = 'preset-chip-dup'
    dup.textContent = '⎘'
    dup.title = t('presetDuplicateTooltip')
    dup.addEventListener('click', (e) => {
      e.stopPropagation()
      if (game.settings.menuPresets.length >= 3) game.settings.menuPresets.shift()
      game.settings.menuPresets.push({ ...preset, label: t('presetCopyLabel', { label: preset.label }) })
      saveSettings(game.settings)
      renderMenuPresets(game)
    })
    const del = document.createElement('span')
    del.className = 'preset-chip-delete'
    del.textContent = '×'
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteMenuPreset(game, i) })
    chip.appendChild(pin)
    chip.appendChild(label)
    chip.appendChild(dup)
    chip.appendChild(del)
    game.menuPresetChips.appendChild(chip)
  })
}

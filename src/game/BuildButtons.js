import { t } from './i18n.js'
import { MAP3_SLOT } from './BuildSaves.js'

// Build Mode's toolbar buttons (Together, Play, Mirror, Line, Copy, Paste,
// Fill, Replace, Shape, Undo/Redo, Reset, Try, menu close), the block
// picker's search bar + category dropdown, the hotbar and the save-slot row.
// Moved out of BuildMode's constructor (2026-11-16) as-is:
// setupBuildButtons(bm) wires the same buttons and sets the same
// bm._pickerEl, bm._hotbarEl, bm._undoBtnEl... it used to.

// The picker's block-type dropdown (2026-10-03). Special is first - just
// the Invisible Block for now - and its blocks lead the All list too.
const PICKER_CATEGORIES = [
  ['special', 'Special'],
  ['wood', 'Wood'],
  ['stone', 'Stone'],
  ['ore', 'Ores & Metals'],
  ['nature', 'Dirt & Nature'],
  ['glass', 'Glass'],
  ['color', 'Wool & Concrete'],
  ['terracotta', 'Terracotta'],
  ['nether', 'Nether & End'],
  ['light', 'Light & Liquids'],
  ['slab', 'Slabs'],
  ['stairs', 'Stairs'],
  ['parts', 'Doors, Fences & Ladders'],
  ['other', 'Other'],
  // Not blocks: animals to put down (placingAnimal, 2026-10-24).
  ['animals', 'Animals'],
]

export function setupBuildButtons(bm) {
  document.getElementById('build-mode-together-btn')?.addEventListener('click', () => bm.together.openPanel())
  document.getElementById('build-mode-play-btn')?.addEventListener('click', () => {
    if (bm.survival.active) bm.survival.stop()
    else bm.survival.start()
  })

  bm._pickerEl = document.getElementById('build-picker')
  if (bm._pickerEl) {
    bm._pickerEl.innerHTML = ''
    // Search bar and a block-type dropdown side by side, inside the
    // picker's frame (the same oval search bar as everywhere else).
    const toolbar = document.createElement('div')
    toolbar.className = 'build-picker-toolbar'
    bm._pickerSearchInput = document.createElement('input')
    bm._pickerSearchInput.type = 'text'
    bm._pickerSearchInput.className = 'nickname-input search-bar build-picker-search'
    bm._pickerSearchInput.placeholder = 'Search blocks...'
    bm._pickerSearchInput.addEventListener('click', (e) => e.stopPropagation())
    bm._pickerSearchInput.addEventListener('input', () => bm._renderPickerGrid())
    toolbar.appendChild(bm._pickerSearchInput)
    bm._pickerCategorySelect = document.createElement('select')
    bm._pickerCategorySelect.className = 'nickname-input build-picker-category'
    for (const [value, label] of [['all', 'All blocks'], ...PICKER_CATEGORIES]) {
      const opt = document.createElement('option')
      opt.value = value
      opt.textContent = label
      bm._pickerCategorySelect.appendChild(opt)
    }
    bm._pickerCategorySelect.addEventListener('click', (e) => e.stopPropagation())
    bm._pickerCategorySelect.addEventListener('change', () => bm._renderPickerGrid())
    toolbar.appendChild(bm._pickerCategorySelect)
    bm._pickerEl.appendChild(toolbar)
    bm._pickerGridEl = document.createElement('div')
    bm._pickerGridEl.className = 'build-picker-grid'
    bm._pickerEl.appendChild(bm._pickerGridEl)
  }
  // The grid is drawn when the picker opens (togglePicker), not here -
  // drawing its ~400 block icons while BuildMode was being made in the
  // background was a hitch on whatever the player clicked meanwhile.

  // Always-on-screen quick-select bar (Minecraft-style, Digit1-9/0) - 10
  // slots you assign yourself from the Tab picker (see
  // _assignToActiveSlot), not pre-filled.
  bm._hotbarEl = document.getElementById('build-hotbar')
  bm._renderHotbar()

  // Save-slot picker (see switchSlot) - a small always-visible row of
  // SAVE_SLOT_COUNT buttons, not tucked inside a menu, since switching
  // slots is meant to be a quick one-click action mid-build.
  bm._slotsEl = document.getElementById('build-slots')
  bm._renderSlots()

  // Mirror toggle button (see toggleMirror) - the N key does the same
  // thing, this is just the discoverable/clickable equivalent.
  bm._mirrorBtnEl = document.getElementById('build-mode-mirror-btn')
  if (bm._mirrorBtnEl) bm._mirrorBtnEl.addEventListener('click', () => bm.toggleMirror())

  // Line tool toggle button (see toggleLineTool) - the L key does the
  // same thing.
  bm._lineToolBtnEl = document.getElementById('build-mode-line-btn')
  if (bm._lineToolBtnEl) bm._lineToolBtnEl.addEventListener('click', () => bm.toggleLineTool())

  // Copy tool + Paste buttons (see toggleCopyTool/pasteClipboard) - C and
  // P keys do the same things.
  bm._copyToolBtnEl = document.getElementById('build-mode-copy-btn')
  if (bm._copyToolBtnEl) bm._copyToolBtnEl.addEventListener('click', () => bm.toggleCopyTool())
  bm._pasteBtnEl = document.getElementById('build-mode-paste-btn')
  if (bm._pasteBtnEl) bm._pasteBtnEl.addEventListener('click', () => bm.pasteClipboard())
  document.getElementById('build-mode-rotate-btn')?.addEventListener('click', () => bm.tools.rotateClipboard())
  document.getElementById('build-mode-fill-btn')?.addEventListener('click', () => bm.tools.setMode('fill'))
  document.getElementById('build-mode-replace-btn')?.addEventListener('click', () => bm.tools.setMode('replace'))
  document.getElementById('build-mode-shape-btn')?.addEventListener('click', () => bm.tools.cycleShape())

  // Undo/Redo buttons (see undo()/redo() and _updateUndoRedoButtons) -
  // disabled whenever their stack is empty rather than a silent no-op.
  bm._undoBtnEl = document.getElementById('build-mode-undo-btn')
  if (bm._undoBtnEl) bm._undoBtnEl.addEventListener('click', () => bm.undo())
  bm._redoBtnEl = document.getElementById('build-mode-redo-btn')
  if (bm._redoBtnEl) bm._redoBtnEl.addEventListener('click', () => bm.redo())
  bm._updateUndoRedoButtons()

  // Reset Map - confirms first (same window.confirm convention as
  // Import/Download, both of which also replace the current build with
  // no way back), then wipes to a bare ground layer, matching
  // importMapFile's own clear-then-repopulate-ground-then-save sequence.
  bm._resetBtnEl = document.getElementById('build-mode-reset-btn')
  if (bm._resetBtnEl) {
    bm._resetBtnEl.addEventListener('click', () => {
      if (!window.confirm(t(bm.activeSlot === MAP3_SLOT ? 'buildResetMap3Confirm' : 'buildResetConfirm'))) return
      bm.clearAllBlocks()
      // Map 3 resets back to the generated city, a slot to bare ground.
      if (bm.activeSlot === MAP3_SLOT) bm._applyMap3({ removed: [], placed: [] })
      else bm._ensureGroundLayer()
      bm.save()
    })
  }

  document.getElementById('build-mode-try-btn')?.addEventListener('click', () => bm.toggleTryMode())
  document.getElementById('build-menu-close')?.addEventListener('click', () => {
    if (bm.menuOpen) bm.toggleMenu()
  })
}

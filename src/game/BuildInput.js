import { t } from './i18n.js'
import { OWNER_KEY } from './OwnerPowers.js'
import { FIXED_KEYS, getKeyFor, keysFor } from './Keybinds.js'
import { lookBy, startUse, endUse } from './ControlSettings.js'
import { toggleHideHud } from './HudSettings.js'

// Build Mode's keyboard, mouse and scroll-wheel handlers. Moved out of
// BuildMode's constructor (2026-11-16) as-is: setupBuildInput(bm) makes the
// same bm._onKeyDown, _onPointerDown, _onWheel... it used to, and BuildMode
// still adds/removes them as listeners itself.

const LOOK_SENSITIVITY = 0.0022
// Walking keys (Settings > Controls) whose browser default (scrolling the
// page on Space/arrows) is blocked while trying the map.
const TRY_MOVE_ACTIONS = ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'jump', 'sprint', 'crouch']
// Minecraft-style hotbar key mapping - Digit1-9 are slots 0-8, Digit0 is
// slot 9 (the 10th slot), matching the real keyboard row's left-to-right
// order rather than numeric value.
const DIGIT_KEY_TO_HOTBAR_INDEX = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4,
  Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9,
}

export function setupBuildInput(bm) {
  // preventDefault on the movement keys specifically - Space's browser
  // default is "scroll the page down a viewport height", which was never
  // suppressed here. It fired right alongside the camera's own upward
  // movement, so the page (with the canvas inside it) could visibly
  // scroll out from under the camera - easy to misread as "falling" when
  // flying high enough that the drop is dramatic, and confusing to
  // recover from since a second Space press scrolls further rather than
  // undoing the first.
  const MOVEMENT_KEY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'])
  // Double-tap Space hops the camera straight up exactly one block -
  // instant, not a held/continuous ascend (a hands-free continuous-fly
  // toggle was tried here first and explicitly asked to be removed: it
  // kept climbing until double-tapped again, which read as "flying away"
  // rather than a quick vertical nudge). Each Space press within
  // DOUBLE_TAP_WINDOW_MS of the previous one triggers the hop; a slow,
  // isolated tap never does, same detection window as before.
  const DOUBLE_TAP_WINDOW_MS = 300
  bm._lastSpaceTapAt = 0
  bm._onKeyDown = (e) => {
    // Without bm, typing a block name into the picker's search box
    // (see _pickerSearchInput) both flew the camera around on every W/A/
    // S/D keystroke and silently ate the character itself, since
    // preventDefault() on a movement key stops the input from ever
    // receiving it - bm guard was needed even before the search box
    // existed (the picker's Tab-toggle key handling never blocked
    // movement input while open), the search box just made it obvious.
    // The Drop key with a game's inventory open: the item under the pointer.
    if (bm.pickerOpen && bm.survival.active && bm.survival.inv?.open && e.code === getKeyFor('dropItem') && !e.repeat) {
      bm.survival.inv.dropHovered()
      return
    }
    if (bm.pickerOpen) return
    // Typing in a text box over the game (Settings from the pause
    // screen) doesn't move you or press game keys.
    if (e.target?.closest?.('input, textarea, select')) return
    // The owner's menu (OwnerPowers.js): its key or Escape closes it,
    // and no game keys while it's open.
    const ownerPanel = bm.survival?.ownerPanel
    if (ownerPanel && !e.repeat && (e.code === OWNER_KEY || (ownerPanel.open && e.code === 'Escape'))) {
      e.preventDefault()
      ownerPanel.toggle()
      return
    }
    if (ownerPanel?.open) return
    // (Not while playing a game from the homepage - that would drop you
    // into the Map Editor.)
    if (e.code === FIXED_KEYS.buildTry && !e.repeat && !e.ctrlKey && !e.metaKey && !bm.gameMenu.forGame) {
      bm.toggleTryMode()
      return
    }
    // While trying the map, keys move the player (see BuildTryMode) -
    // the building tools stay off.
    // Spectating works like playing (2026-10-18, Gaymi: "every feature
    // that works regularly in game should work in spectating"): reload,
    // Use (doors, chests - or the next player on a server), inspect and
    // the map key all still work while flying.
    if (bm.spectate.active) {
      // The Shop (PlayShop.js) is open: only its own key closes it here.
      if (bm.survival.shop?.panelOpen) {
        if (e.code === getKeyFor('shop') && !e.repeat) bm.survival.shop.closePanel()
        return
      }
      // The ring editor (RingEditor.js) is open: its key or Escape closes it.
      if (bm.survival.ringEditor?.isOpen) {
        if ((e.code === getKeyFor('ringBag') || e.code === 'Escape') && !e.repeat) bm.survival.ringEditor.close()
        return
      }
      if (!e.repeat && bm.spectate.photo) {
        if (e.code === 'KeyP' || e.code === 'Enter') bm.spectate.snap()
        // Selfie Cam: F turns the camera round to you; the Emote key opens
        // the wheel while it's on.
        else if (e.code === 'KeyF') bm.spectate.setSelfie(!bm.spectate.selfie)
        else if (bm.spectate.selfie && e.code === getKeyFor('emote')) bm.spectate.toggleEmotes()
      } else if (!e.repeat) {
        if (e.code === getKeyFor('use') && bm.spectate.hasPlayers()) bm.spectate.onKey(e.code)
        else if (e.code === getKeyFor('use')) startUse(bm)
        if (bm.survival.active) bm.survival.onKeyDown(e.code)
        if (e.code === getKeyFor('inspectWeapon')) bm.tryMode.inspect()
        if (e.code === getKeyFor('cycleMap')) bm.tryMode.cycleMap()
        if (e.code === getKeyFor('hideHud')) toggleHideHud(bm.game)
      }
      if (e.code === getKeyFor('hideHud')) e.preventDefault()
      bm._keys.add(e.code)
      if (MOVEMENT_KEY_CODES.has(e.code) || TRY_MOVE_ACTIONS.some((a) => keysFor(a).includes(e.code))) e.preventDefault()
      return
    }
    if (bm.tryMode.active) {
      // The Shop (PlayShop.js) is open: only its own key closes it here.
      if (bm.survival.shop?.panelOpen) {
        if (e.code === getKeyFor('shop') && !e.repeat) bm.survival.shop.closePanel()
        return
      }
      // The ring editor (RingEditor.js) is open: its key or Escape closes it.
      if (bm.survival.ringEditor?.isOpen) {
        if ((e.code === getKeyFor('ringBag') || e.code === 'Escape') && !e.repeat) bm.survival.ringEditor.close()
        return
      }
      if (bm.survival.active && !e.repeat) bm.survival.onKeyDown(e.code)
      // Settings > Controls > Hold to Interact: maybe after a hold.
      if (e.code === getKeyFor('use') && !e.repeat) startUse(bm)
      if (e.code === getKeyFor('autoRun') && !e.repeat) bm.tryMode.toggleAutoRun()
      if (e.code === getKeyFor('inspectWeapon') && !e.repeat) bm.tryMode.inspect()
      if (e.code === getKeyFor('cycleMap') && !e.repeat) bm.tryMode.cycleMap()
      if (e.code === getKeyFor('cameraView') && !e.repeat) bm.tryMode.cycleView()
      // Hide HUD (F1, which would open the browser's help without preventDefault).
      if (e.code === getKeyFor('hideHud')) {
        e.preventDefault()
        if (!e.repeat && bm.survival.active) toggleHideHud(bm.game)
      }
      bm._keys.add(e.code)
      if (MOVEMENT_KEY_CODES.has(e.code) || TRY_MOVE_ACTIONS.some((a) => keysFor(a).includes(e.code))) e.preventDefault()
      return
    }
    // Ctrl/Cmd shortcuts (shown in the Escape menu's Shortcuts box).
    if ((e.ctrlKey || e.metaKey) && !e.repeat) {
      if (e.code === 'KeyZ') {
        e.preventDefault()
        if (e.shiftKey) bm.redo()
        else bm.undo()
        return
      }
      if (e.code === 'KeyY') {
        e.preventDefault()
        bm.redo()
        return
      }
      if (e.code === 'KeyS') {
        e.preventDefault()
        bm.save()
        bm.game?._showHomepageToast?.(t('buildMenuSavedToast'))
        if (bm.menuOpen) bm._refreshMenuInfo()
        return
      }
      return
    }
    if (e.code === FIXED_KEYS.buildMirror && !e.repeat) {
      bm.toggleMirror()
      return
    }
    if (e.code === 'KeyL' && !e.repeat) {
      bm.toggleLineTool()
      return
    }
    if (e.code === 'KeyC' && !e.repeat) {
      bm.toggleCopyTool()
      return
    }
    if (e.code === 'KeyP' && !e.repeat) {
      bm.pasteClipboard()
      return
    }
    if (!e.repeat && (e.code === FIXED_KEYS.buildFill || e.code === FIXED_KEYS.buildReplace)) {
      bm.tools.setMode(e.code === FIXED_KEYS.buildFill ? 'fill' : 'replace')
      return
    }
    if (e.code === FIXED_KEYS.buildShape && !e.repeat) {
      bm.tools.cycleShape()
      return
    }
    if (e.code === FIXED_KEYS.buildRotate && !e.repeat) {
      bm.tools.rotateClipboard()
      return
    }
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now()
      if (now - bm._lastSpaceTapAt < DOUBLE_TAP_WINDOW_MS) bm._hopUp()
      bm._lastSpaceTapAt = now
    }
    // "V" for a zoomed-in "look further" view (narrows FOV, doesn't
    // change render distance) - hold to zoom in, release to smoothly
    // return to normal, same feel as a scope. No special-case handling
    // needed here beyond the generic _keys.add(e.code) below - update()
    // reads _keys.has('KeyV') every frame and damps the FOV toward
    // whichever target that implies, the same way it already damps
    // movement velocity toward its own target.
    bm._keys.add(e.code)
    if (MOVEMENT_KEY_CODES.has(e.code)) e.preventDefault()
  }
  bm._onKeyUp = (e) => {
    bm._keys.delete(e.code)
    if (e.code === getKeyFor('use')) endUse(bm)
  }
  bm._onMouseMove = (e) => {
    if (document.pointerLockElement !== bm.renderer.domElement) return
    // Settings > Controls: Mouse Sensitivity and Invert Look.
    // Aiming down the sights turns the view slower, like zooming in
    // (much slower through a scope; not at all without a gun).
    const sens = LOOK_SENSITIVITY * ((bm.game?.settings?.sensitivity ?? 100) / 100) * bm.tryMode.aimLookScale()
    // Mouse Smoothing (ControlSettings.lookBy) may spread it over frames.
    lookBy(bm, -e.movementX * sens, -e.movementY * sens * (bm.game?.settings?.invertY ? -1 : 1))
  }

  bm._onPointerDown = (e) => {
    if (document.pointerLockElement !== bm.renderer.domElement) {
      if (bm.mouseScreenOpen()) return
      // Cursor is free (Build Mode no longer auto-locks the instant you
      // enter, see Game.js's _enterBuildMode - it was disorienting to
      // have the mouse captured before you'd even gotten oriented).
      // Clicking into the viewport re-acquires it instead of placing/
      // removing a block, so bm first click is never mistaken for a
      // build action.
      try { bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available in bm environment */ }
      return
    }
    // Trying the map: clicks shoot (and, held on a block, break it -
    // BuildTryMode._updateDigging); nothing gets built.
    // Spectating: on a server a click watches the next player; alone it
    // shoots like normal.
    // Photo Mode: a click takes the picture (once the mouse is locked).
    if (bm.spectate.active && bm.spectate.photo) {
      if (e.button === 0 && document.pointerLockElement === bm.renderer.domElement) bm.spectate.snap()
      return
    }
    if (bm.spectate.active && bm.spectate.hasPlayers() && e.button === 0) {
      bm.spectate.cycle(1)
      return
    }
    if (bm.tryMode.active) {
      if (e.button === 0) {
        // Held down, an automatic gun keeps firing (BuildSurvival.update).
        bm._fireHeld = true
        bm.tryMode.fire()
      }
      // Right-click aims down the sights while it's held and stops when
      // it's let go (2026-10-17, Gaymi: "if you stop clicking right
      // click it stops aiming") - doors, chests and NPCs are on the Use
      // key (E).
      // Holding a block from the inventory: right-click places it.
      // Right-clicking the go-kart hops in (GoKart.js).
      else if (e.button === 2 && bm.survival?.active && (bm.survival.kart?.rightClick() || bm.survival.vehicles?.rightClick())) return
      else if (e.button === 2 && bm.survival?.holding?.kind === 'block') bm.survival.placeHeldBlock()
      // Spin ring games (SpinRing.js): held right-click pulls the ring in
      // tight (left click spreads it - _fireHeld).
      else if (e.button === 2 && bm.survival?.active && bm.survival.ring) bm._ringPull = true
      else if (e.button === 2) bm.tryMode.setAim(true)
      return
    }
    if (e.button === 2) {
      if (bm.tools.mode) bm.tools.click()
      else if (bm.lineToolMode) bm._lineToolClick()
      else if (bm.copyToolMode) bm._copyToolClick()
      else bm._placeFromCamera()
    } else if (e.button === 0) bm._removeFromCamera()
  }
  bm._onContextMenu = (e) => { if (bm.active) e.preventDefault() }

  bm._onKeyDownHotbar = (e) => {
    // Same reasoning as _onKeyDown's guard - without it, typing a digit
    // while searching the picker (e.g. "TNT" has none, but plenty of
    // names could) would also switch the active hotbar slot underneath.
    if (bm.pickerOpen) return
    const digitIndex = DIGIT_KEY_TO_HOTBAR_INDEX[e.code]
    if (digitIndex === undefined) return
    // With the emote bar open, 1-3 pick an emote instead (Emotes.js).
    if (bm.survival?.active && bm.survival.emotes?.pick(e.code)) return
    if (bm.survival?.active && bm.survival.inv) bm.survival.inv.select(digitIndex)
    else bm._selectHotbarSlot(digitIndex)
  }

  // Mouse wheel / trackpad scroll steps through the hotbar like
  // Minecraft (down = next slot). Trackpads send many small deltas, so
  // they're added up and one slot moves per ~one wheel notch.
  bm._wheelAccum = 0
  bm._onWheel = (e) => {
    if (!bm.active || bm.pickerOpen || bm.menuOpen) return
    if (e.target?.closest?.('#build-picker, #build-menu, #community-maps-panel, #build-together-panel, #build-try-map')) return
    // Photo Mode: the wheel zooms the camera (PlaySpectate.wheel).
    if (bm.spectate?.active && bm.spectate.photo) {
      bm.spectate.wheel(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY)
      return
    }
    bm._wheelAccum += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
    const steps = Math.trunc(bm._wheelAccum / 60)
    if (!steps) return
    bm._wheelAccum -= steps * 60
    const dir = Math.sign(steps) * (bm.game?.settings?.invertScrollWeaponSwitch ? -1 : 1)
    if (bm.survival?.active && bm.survival.inv) {
      const inv = bm.survival.inv
      inv.select((((inv.active + dir) % 10) + 10) % 10)
      return
    }
    const next = (((bm.activeHotbarIndex + dir) % 10) + 10) % 10
    bm._selectHotbarSlot(next)
  }

  bm._onKeyDownPicker = (e) => {
    // The emote wheel is up (Emotes.js): Escape closes it.
    if (e.code === 'Escape' && bm.survival?.emotes?.open) {
      bm.survival.emotes.close()
      return
    }
    // An NPC's shop is open: Escape closes it, nothing else happens.
    if (bm.survival?.shop?.panelOpen) {
      if (e.code === 'Escape') bm.survival.shop.closePanel()
      return
    }
    if (bm.survival?.ringEditor?.isOpen) {
      if (e.code === 'Escape' || e.code === getKeyFor('ringBag')) bm.survival.ringEditor.close()
      return
    }
    if (e.code === 'Tab') {
      e.preventDefault()
      bm.togglePicker()
    } else if (e.code === 'Escape' && bm.pickerOpen) {
      bm.togglePicker()
    } else if (e.code === 'Escape' && bm.gameMenu.settingsOpen) {
      // Settings over the game's pause screen: back to the pause screen
      // (unless Escape was cancelling a key change in it).
      if (!e.defaultPrevented) bm.gameMenu.closeSettings()
    } else if (e.code === 'Escape') {
      // Opens/closes the action menu (see toggleMenu) - which also
      // releases/reacquires pointer lock as part of that, so bm
      // replaces what used to be a bare exitPointerLock() call here.
      bm.toggleMenu()
    }
  }

  // Click anywhere outside the picker's own grid to close it - the
  // picker has no backdrop element of its own (it's just the centered
  // grid, position:fixed with nothing behind it), so bm listens on
  // document and checks the click target instead of adding one.
  bm._onPickerBackdropClick = (e) => {
    if (!bm.pickerOpen || !bm._pickerEl) return
    if (!bm._pickerEl.contains(e.target)) bm.togglePicker()
  }
}

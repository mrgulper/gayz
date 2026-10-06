// Touch controls for playing Map 1 (and Try Map) on a phone or tablet
// (2026-10-06, "make the controls for mobile simple, icons not words").
// Shown only on touch devices while walking the map - building in the
// Map Editor stays a keyboard/mouse thing.
//
// - Left side: a floating stick (it appears where your thumb lands);
//   pushed to the edge it runs.
// - Anywhere else: drag to look around.
// - Right side: Fire (hold to keep firing), Jump, Reload, Use (doors,
//   chests, camp NPCs), Crouch (tap to toggle); Pause at the top.
// Everything goes through the same paths the keyboard and mouse use
// (BuildMode._keys, _yaw/_pitch, tryMode.fire(), survival.reload(),
// _tryUseFromCamera(), toggleMenu()), so nothing behaves differently.

// The stick's reach in px, and how far out (0-1) counts as running.
const STICK_RADIUS = 56
const RUN_AT = 0.92
// Look speed in radians per px of drag, at 100% Mouse Sensitivity.
const LOOK_PER_PX = 0.0055
// Held Fire shoots this often.
const FIRE_REPEAT_S = 0.16

const ICONS = {
  fire: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
  reload: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/></svg>',
  use: '<svg viewBox="0 0 24 24"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7l-2.6-4a1.5 1.5 0 0 1 2.5-1.6L9 14"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><path d="M12 5v10M6 11l6 6 6-6"/><path d="M5 20h14"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
}

export function isTouchDevice() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
}

export class BuildTouch {
  constructor(buildMode) {
    this.bm = buildMode
    this.enabled = isTouchDevice()
    this.shown = false
    this._stick = null // { id, x0, y0, dx, dy }
    this._look = null // { id, x, y }
    this._fireId = null
    this._fireIn = 0
    this._jumpId = null
    this._crouch = false
    this._el = null
  }

  // Builds the overlay the first time it's needed.
  _ensureDom() {
    if (this._el) return
    const el = document.createElement('div')
    el.id = 'touch-play'
    el.innerHTML = `
      <div class="tp-look"></div>
      <div class="tp-stick"><div class="tp-stick-knob"></div></div>
      <button type="button" class="tp-btn tp-pause" data-tp="pause" aria-label="Pause">${ICONS.pause}</button>
      <button type="button" class="tp-btn tp-fire" data-tp="fire" aria-label="Fire">${ICONS.fire}</button>
      <button type="button" class="tp-btn tp-jump" data-tp="jump" aria-label="Jump">${ICONS.jump}</button>
      <button type="button" class="tp-btn tp-reload" data-tp="reload" aria-label="Reload">${ICONS.reload}</button>
      <button type="button" class="tp-btn tp-use" data-tp="use" aria-label="Use">${ICONS.use}</button>
      <button type="button" class="tp-btn tp-crouch" data-tp="crouch" aria-label="Crouch">${ICONS.crouch}</button>`
    document.body.appendChild(el)
    this._el = el
    this._stickEl = el.querySelector('.tp-stick')
    this._knobEl = el.querySelector('.tp-stick-knob')
    this._crouchEl = el.querySelector('.tp-crouch')
    const opts = { passive: false }
    el.addEventListener('touchstart', (e) => this._onStart(e), opts)
    el.addEventListener('touchmove', (e) => this._onMove(e), opts)
    el.addEventListener('touchend', (e) => this._onEnd(e), opts)
    el.addEventListener('touchcancel', (e) => this._onEnd(e), opts)
    // Long-press menus and double-tap zoom have no place over a game.
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  _onStart(e) {
    e.preventDefault()
    for (const tch of e.changedTouches) {
      const btn = tch.target.closest?.('[data-tp]')
      if (btn) {
        this._press(btn.dataset.tp, tch.identifier, btn)
        continue
      }
      // Left 45% of the screen moves; the rest looks.
      if (!this._stick && tch.clientX < window.innerWidth * 0.45) {
        this._stick = { id: tch.identifier, x0: tch.clientX, y0: tch.clientY, dx: 0, dy: 0 }
        this._stickEl.style.left = `${tch.clientX}px`
        this._stickEl.style.top = `${tch.clientY}px`
        this._stickEl.classList.add('on')
        this._knobEl.style.transform = 'translate(-50%, -50%)'
      } else if (!this._look) {
        this._look = { id: tch.identifier, x: tch.clientX, y: tch.clientY }
      }
    }
  }

  _onMove(e) {
    e.preventDefault()
    for (const tch of e.changedTouches) {
      if (this._stick?.id === tch.identifier) {
        let dx = tch.clientX - this._stick.x0
        let dy = tch.clientY - this._stick.y0
        const len = Math.hypot(dx, dy)
        if (len > STICK_RADIUS) {
          dx *= STICK_RADIUS / len
          dy *= STICK_RADIUS / len
        }
        this._stick.dx = dx
        this._stick.dy = dy
        this._knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
      } else if (this._look?.id === tch.identifier) {
        this._lookBy(tch.clientX - this._look.x, tch.clientY - this._look.y)
        this._look.x = tch.clientX
        this._look.y = tch.clientY
      }
    }
  }

  _onEnd(e) {
    e.preventDefault()
    for (const tch of e.changedTouches) {
      const id = tch.identifier
      if (this._stick?.id === id) {
        this._stick = null
        this._stickEl.classList.remove('on')
      }
      if (this._look?.id === id) this._look = null
      if (this._fireId === id) this._fireId = null
      if (this._jumpId === id) {
        this._jumpId = null
        this.bm._keys.delete('Space')
      }
      this._el.querySelector(`[data-tp-id="${id}"]`)?.classList.remove('down')
    }
  }

  _press(action, id, btn) {
    btn.classList.add('down')
    btn.dataset.tpId = id
    const bm = this.bm
    if (action === 'fire') {
      this._fireId = id
      this._fireIn = FIRE_REPEAT_S
      bm.tryMode.fire()
    } else if (action === 'jump') {
      this._jumpId = id
      bm._keys.add('Space')
    } else if (action === 'reload') {
      if (bm.survival.active) bm.survival.reload()
    } else if (action === 'use') {
      bm._tryUseFromCamera()
    } else if (action === 'crouch') {
      this._crouch = !this._crouch
      this._crouchEl.classList.toggle('on', this._crouch)
      if (this._crouch) bm._keys.add('KeyC')
      else bm._keys.delete('KeyC')
    } else if (action === 'pause') {
      this._release()
      bm.toggleMenu()
    }
  }

  _lookBy(dx, dy) {
    const bm = this.bm
    const s = bm.game?.settings
    const sens = LOOK_PER_PX * ((s?.sensitivity ?? 100) / 100)
    bm._yaw -= dx * sens
    bm._pitch -= dy * sens * (s?.invertY ? -1 : 1)
    bm._pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, bm._pitch))
  }

  // Lets go of everything (pause, a panel opening, leaving the map).
  _release() {
    this._stick = null
    this._look = null
    this._fireId = null
    this._jumpId = null
    this.bm._keys.delete('Space')
    this.bm._touchMove = null
    if (this._el) {
      this._stickEl.classList.remove('on')
      for (const b of this._el.querySelectorAll('.down')) b.classList.remove('down')
    }
  }

  // Every frame (BuildMode.update): show or hide, move, keep firing.
  update(dt) {
    if (!this.enabled) return
    const bm = this.bm
    const inMap = bm.active && bm.tryMode.active
    // The phone layout (no hotbar/chat, small minimap) stays while you're
    // in the map; the buttons hide under the pause menu, a panel or the
    // game-over screen.
    if (inMap !== this._inMap) {
      this._inMap = inMap
      document.body.classList.toggle('touch-play-on', inMap)
    }
    const want = inMap && !bm.menuOpen && !bm.pickerOpen && !bm.survival.camp?.panelOpen && !bm.survival.dead
    if (want !== this.shown) {
      this.shown = want
      if (want) this._ensureDom()
      else this._release()
      if (this._el) this._el.style.display = want ? 'block' : 'none'
      if (!want && this._crouch) {
        this._crouch = false
        bm._keys.delete('KeyC')
        this._crouchEl?.classList.remove('on')
      }
    }
    if (!want) return
    // The stick: strafe/forward amounts (-1..1), read by BuildTryMode.
    const st = this._stick
    if (st && (st.dx || st.dy)) {
      const r = Math.hypot(st.dx, st.dy) / STICK_RADIUS
      bm._touchMove = { x: st.dx / STICK_RADIUS, y: -st.dy / STICK_RADIUS, run: r >= RUN_AT }
    } else {
      bm._touchMove = null
    }
    if (this._fireId !== null) {
      this._fireIn -= dt
      if (this._fireIn <= 0) {
        this._fireIn += FIRE_REPEAT_S
        bm.tryMode.fire()
      }
    }
  }
}

// One pop-up screen over the game for the camp's newer stations
// (2026-11-06): the Zombie Newspaper, the Lost & Found box, the Pinball
// machine and the Chess table (CampPlaza.js), the Museum's plaques
// (CampMuseum.js) and the Story Campaign's scenes (Campaign.js).
//
// While one is open the mouse is free (BuildMode.mouseScreenOpen asks
// screenOpen()), every key goes to the screen and not to the game (so the
// arrow keys play pinball instead of walking), and Escape or the close
// button shuts it. Only one at a time.
import { t } from './i18n.js'

let _open = null

export function screenOpen() {
  return !!_open
}

// build(body, close): fills the screen. onKey(e, down): keys while open
// (return true when used). onClose(): after it shuts. wide: a bigger box.
export function openScreen(s, { title, build, onKey = null, onClose = null, wide = false }) {
  closeScreen(false)
  const bm = s.bm
  bm._keys?.clear?.()
  bm._fireHeld = false
  if (document.pointerLockElement) document.exitPointerLock()
  const el = document.createElement('div')
  el.id = 'camp-screen'
  el.className = wide ? 'wide' : ''
  const head = document.createElement('div')
  head.className = 'camp-screen-head'
  const h = document.createElement('b')
  h.textContent = title
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'camp-screen-x'
  x.setAttribute('aria-label', t('campScreenClose'))
  x.textContent = '✕'
  head.append(h, x)
  const body = document.createElement('div')
  body.className = 'camp-screen-body'
  el.append(head, body)
  document.body.appendChild(el)
  const state = { el, s, onClose, onKey }
  const key = (down) => (e) => {
    if (_open !== state) return
    // Typing in the chat box still works.
    if (e.target?.closest?.('input, textarea')) return
    if (down && e.code === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeScreen()
      return
    }
    state.onKey?.(e, down)
    e.preventDefault()
    e.stopPropagation()
  }
  state.down = key(true)
  state.up = key(false)
  window.addEventListener('keydown', state.down, true)
  window.addEventListener('keyup', state.up, true)
  _open = state
  const close = () => closeScreen()
  x.addEventListener('click', close)
  build(body, close)
  return state
}

export function closeScreen(relock = true) {
  const st = _open
  if (!st) return
  _open = null
  window.removeEventListener('keydown', st.down, true)
  window.removeEventListener('keyup', st.up, true)
  st.el.remove()
  st.onClose?.()
  st.s.bm._keys?.clear?.()
  if (relock && st.s.active && !st.s.dead) {
    try { st.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
  }
}

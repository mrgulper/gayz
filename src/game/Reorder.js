// Drag to reorder (2026-11-23): the Team page's picked team and the
// Gauntlet team. Mouse: press and drag. Touch: hold a moment, then drag
// (a quick swipe still scrolls the Pets tab). Drop on another card to take
// its place. Pointer events, so it works the same on phones and computers.
//
// bindReorder(root, game, { selector, index(el), onMove(from, to) }) -
// root stays put while its cards are redrawn (delegated). game._teamDragged
// is true for a moment after a drop, so the click that follows the drop
// isn't taken as a tap (tap = sell / take off the team).
const MOVE_PX = 8
const HOLD_MS = 300

export function bindReorder(root, game, { selector, index, onMove }) {
  let d = null // { el, id, x, y, pointer, on, hold, over }

  const clear = () => {
    if (!d) return
    clearTimeout(d.hold)
    if (d.on) {
      d.el.classList.remove('reorder-dragging')
      d.el.style.transform = ''
      d.over?.classList.remove('reorder-over')
    }
    d = null
  }
  const begin = () => {
    d.on = true
    d.el.classList.add('reorder-dragging')
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const el = e.target.closest(selector)
    if (!el || !root.contains(el)) return
    clear()
    d = { el, x: e.clientX, y: e.clientY, pointer: e.pointerId, on: false, over: null }
    if (e.pointerType === 'touch') d.hold = setTimeout(() => d && begin(), HOLD_MS)
  })

  window.addEventListener('pointermove', (e) => {
    if (!d || e.pointerId !== d.pointer) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.on) {
      if (Math.hypot(dx, dy) < MOVE_PX) return
      // Touch moved before the hold: it's a scroll, not a drag.
      if (e.pointerType === 'touch') return clear()
      begin()
    }
    d.el.style.transform = `translate(${dx}px, ${dy}px)`
    // What's under the finger (the dragged card ignores the pointer).
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest(selector)
    const over = under && under !== d.el && root.contains(under) && under.parentElement === d.el.parentElement ? under : null
    if (over !== d.over) {
      d.over?.classList.remove('reorder-over')
      over?.classList.add('reorder-over')
      d.over = over
    }
  })

  const end = (e) => {
    if (!d || e.pointerId !== d.pointer) return
    if (d.on) {
      const from = index(d.el)
      const to = d.over ? index(d.over) : -1
      game._teamDragged = true
      setTimeout(() => { game._teamDragged = false }, 60)
      clear()
      if (to >= 0 && from >= 0 && from !== to) onMove(from, to)
      return
    }
    clear()
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', (e) => {
    if (d && e.pointerId === d.pointer) clear()
  })
  // While dragging on a phone the page mustn't scroll.
  root.addEventListener('touchmove', (e) => {
    if (d?.on) e.preventDefault()
  }, { passive: false })
  // A long press would open the phone's own menu over the card.
  root.addEventListener('contextmenu', (e) => {
    if (d?.on || e.target.closest(selector)) e.preventDefault()
  })
}

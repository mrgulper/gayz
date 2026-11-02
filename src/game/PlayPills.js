// Small status pills over the hotbar (2026-11-01): the metal detector's
// signal, jetpack fuel, potion timers. One shared stack (#play-pills,
// play-pause.css), one pill per id, made when first needed.
// show(id, text, low) puts it up (low = red); hide(id) takes it down.
let box = null
const pills = new Map()

function el(id) {
  if (!box || !box.isConnected) {
    box = document.createElement('div')
    box.id = 'play-pills'
    document.body.appendChild(box)
    pills.clear()
  }
  let p = pills.get(id)
  if (!p) {
    p = document.createElement('div')
    p.className = 'play-pill'
    p.id = `pill-${id}`
    box.appendChild(p)
    pills.set(id, p)
  }
  return p
}

export function showPill(id, text, low = false) {
  const p = el(id)
  if (p.textContent !== text) p.textContent = text
  p.classList.add('on')
  p.classList.toggle('low', !!low)
}

export function hidePill(id) {
  pills.get(id)?.classList.remove('on')
}

export function hideAllPills() {
  for (const p of pills.values()) p.classList.remove('on')
}

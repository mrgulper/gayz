// Map pins and the compass (2026-11-01, Gaymi's idea list 4, quick wins:
// "map pins and compass"; on servers "they can pick like make an option
// beside the map after the pin").
//
// - On the big map in the middle (M twice, or tap the corner map on a
//   phone) a click / tap drops a pin there - up to MAX_PINS, the oldest
//   goes when you drop another. Clicking a pin opens its little menu again.
// - Beside a new pin a menu pops up: on a server, who sees it (Everyone,
//   Friends, Only me - Friends is matched by nickname against your saved
//   friends on their side), and Remove. Playing alone it only has Remove.
// - A compass strip along the top while any pin is out: N / E / S / W and
//   every pin (yours and the ones others share with you) with how far.
// Owned by BuildSurvival (`s.pins`); BuildTryMode draws them on the map
// and hands over taps; PlayNet sends snapshot() and passes the others'.
import { t } from './i18n.js'

export const MAX_PINS = 3
// A tap this close (CSS px) to a pin opens it instead of dropping a new one.
const HIT_PX = 14
// Who sees a pin: 'a' everyone, 'f' friends, 'm' only me (never sent).
const VIS = ['a', 'f', 'm']
const VIS_KEY = { a: 'pinVisAll', f: 'pinVisFriends', m: 'pinVisMe' }
// Mine get these colours, in the order they were dropped; other players'
// are white.
const COLORS = ['#ff4a3a', '#3a8cff', '#3adf5a']
const OTHER_COLOR = '#f4f0e0'
// The compass shows this much to either side (radians) over its width.
const COMPASS_HALF = Math.PI / 2
const COMPASS_EVERY_S = 0.1
// Other players' names are theirs to pick: never raw into HTML.
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export class MapPins {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._n = 0
    this._open = null
    this._menuEl = null
    this._compassEl = null
    this._compassIn = 0
  }

  get bm() {
    return this.s.bm
  }

  get online() {
    return !!(this.s.net && !this.s.net.closed)
  }

  clear() {
    this.list = []
    this._open = null
    this._menuEl?.remove()
    this._menuEl = null
    this._compassEl?.remove()
    this._compassEl = null
  }

  // A tap on the big map at world spot (x, z); `near(pin)` -> the tap's
  // distance to a pin in CSS px. Opens a pin that's right there, else drops one.
  tap(x, z, near) {
    const hit = this.list.find((p) => near(p) < HIT_PX)
    if (hit) {
      this._open = this._open === hit ? null : hit
      return
    }
    if (this._open) {
      this._open = null
      return
    }
    if (this.list.length >= MAX_PINS) this.list.shift()
    const pin = { id: ++this._n, x, z, vis: this._lastVis || 'a', color: this._freeColor() }
    this.list.push(pin)
    this._open = pin
    this.s._message(t('pinDropped'), 2)
  }

  _freeColor() {
    return COLORS.find((c) => !this.list.some((p) => p.color === c)) || COLORS[0]
  }

  remove(pin) {
    this.list = this.list.filter((p) => p !== pin)
    if (this._open === pin) this._open = null
  }

  // Other players' pins I'm allowed to see: { x, z, name }.
  _theirs() {
    const net = this.online ? this.s.net : null
    if (!net) return []
    const friends = new Set((this.bm.game?.settings?.savedFriends || []).map((f) => String(f.name || '').toLowerCase()))
    const out = []
    for (const p of net.players.values()) {
      for (const pin of p.pins || []) {
        if (pin.v === 'f' && !friends.has(String(p.nick || '').toLowerCase())) continue
        out.push({ x: pin.x, z: pin.z, name: p.nick || '' })
      }
    }
    return out
  }

  // What the other players need (PlayNet, each sync): only shared pins.
  snapshot() {
    return this.list.filter((p) => p.vis !== 'm').map((p) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), v: p.vis }))
  }

  // On the map (BuildTryMode._drawMap): canvas spot = (x - ox) * k.
  // `el` is the map's box, for the menu beside the open pin.
  draw(ctx, ox, oz, k, s, el) {
    // The globe (World Map mode, zoomed far out): no pins, no menu.
    if (!ctx) return this._renderMenu(null)
    const r = Math.max(5, s / 40)
    const line = Math.max(1.5, s / 160)
    const pinAt = (x, z, color, label) => {
      const px = (x - ox) * k
      const pz = (z - oz) * k
      // A drop shape: round head, point at the spot.
      ctx.beginPath()
      ctx.moveTo(px, pz)
      ctx.lineTo(px - r * 0.7, pz - r * 1.4)
      ctx.arc(px, pz - r * 1.9, r, Math.PI * 0.8, Math.PI * 0.2)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.strokeStyle = '#1a1408'
      ctx.lineWidth = line
      ctx.fill()
      ctx.stroke()
      if (label) {
        ctx.font = `700 ${Math.round(r * 1.2)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#1a1408'
        ctx.fillText(label, px, pz - r * 1.9)
      }
    }
    for (const p of this._theirs()) pinAt(p.x, p.z, OTHER_COLOR, p.name.slice(0, 1).toUpperCase())
    this.list.forEach((p) => pinAt(p.x, p.z, p.color, ''))
    this._renderMenu(el, ox, oz, k, s)
  }

  // The little menu beside the open pin (only while the big map is open).
  _renderMenu(el, ox, oz, k, s) {
    const pin = this._open && el?.classList.contains('interactive') ? this._open : null
    if (!pin) {
      if (this._menuEl) this._menuEl.style.display = 'none'
      return
    }
    if (!this._menuEl || this._menuEl.parentElement !== el) {
      this._menuEl?.remove()
      this._menuEl = document.createElement('div')
      this._menuEl.id = 'map-pin-menu'
      // Taps on the menu never reach the map under it.
      for (const ev of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel']) this._menuEl.addEventListener(ev, (e) => e.stopPropagation())
      this._menuEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button')
        if (!btn || !this._open) return
        if (btn.dataset.vis) {
          this._open.vis = btn.dataset.vis
          this._lastVis = btn.dataset.vis
          this._menuKey = ''
        } else if (btn.dataset.remove) this.remove(this._open)
        else this._open = null
      })
      el.appendChild(this._menuEl)
    }
    const online = this.online
    const key = `${pin.id}|${pin.vis}|${online}`
    if (key !== this._menuKey) {
      this._menuKey = key
      const vis = online ? `<div class="map-pin-title">${t('pinWhoSees')}</div><div class="map-pin-vis">${VIS.map((v) => `<button type="button" data-vis="${v}" class="${pin.vis === v ? 'on' : ''}">${t(VIS_KEY[v])}</button>`).join('')}</div>` : ''
      this._menuEl.innerHTML = `${vis}<div class="map-pin-row"><button type="button" data-remove="1">${t('pinRemove')}</button><button type="button" data-close="1">${t('pinDone')}</button></div>`
    }
    this._menuEl.style.display = ''
    // Beside the pin (in CSS px inside the map box), kept on the map.
    const scale = el.clientWidth / s
    const mw = this._menuEl.offsetWidth
    const mh = this._menuEl.offsetHeight
    let left = (pin.x - ox) * k * scale + 16
    let top = (pin.z - oz) * k * scale - mh / 2
    if (left + mw > el.clientWidth - 6) left = (pin.x - ox) * k * scale - mw - 16
    left = Math.max(6, Math.min(el.clientWidth - mw - 6, left))
    top = Math.max(6, Math.min(el.clientHeight - mh - 6, top))
    this._menuEl.style.left = `${Math.round(left)}px`
    this._menuEl.style.top = `${Math.round(top)}px`
  }

  // Every frame (BuildSurvival): the compass, ~10 times a second.
  update(dt) {
    if ((this._compassIn -= dt) > 0) return
    this._compassIn = COMPASS_EVERY_S
    const pins = [...this.list.map((p) => ({ x: p.x, z: p.z, color: p.color, label: '' })), ...this._theirs().map((p) => ({ x: p.x, z: p.z, color: OTHER_COLOR, label: p.name.slice(0, 1).toUpperCase() }))]
    const on = pins.length > 0
    if (!this._compassEl) {
      if (!on) return
      this._compassEl = document.createElement('div')
      this._compassEl.id = 'pin-compass'
      this._compassEl.innerHTML = '<div class="pin-compass-tick"></div><div class="pin-compass-marks"></div>'
      document.body.appendChild(this._compassEl)
    }
    this._compassEl.classList.toggle('on', on)
    if (!on) return
    // Under the top bar when they'd overlap (it's wide on a narrow window).
    const bar = document.getElementById('top-bar')?.getBoundingClientRect()
    const me0 = this._compassEl.getBoundingClientRect()
    const top = bar && bar.height && bar.left < me0.right && bar.right > me0.left ? Math.round(bar.bottom + 6) : 0
    if (top !== this._compassTop) {
      this._compassTop = top
      this._compassEl.style.top = top ? `${top}px` : ''
    }
    const me = this.bm.tryMode.pos
    const yaw = this.bm._yaw
    const w = this._compassEl.clientWidth || 260
    // Where on the strip something at heading `a` goes (null: behind you).
    const at = (a) => {
      let d = a - yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      if (Math.abs(d) > COMPASS_HALF) return null
      return w / 2 - (d / COMPASS_HALF) * (w / 2)
    }
    let html = ''
    for (const [a, key] of [[0, 'compassN'], [-Math.PI / 2, 'compassE'], [Math.PI, 'compassS'], [Math.PI / 2, 'compassW']]) {
      const x = at(a)
      if (x !== null) html += `<span class="pin-compass-dir" style="left:${x.toFixed(0)}px">${t(key)}</span>`
    }
    for (const p of pins) {
      const dx = p.x - me.x
      const dz = p.z - me.z
      const dist = Math.round(Math.hypot(dx, dz))
      // Facing yaw looks along (-sin yaw, -cos yaw).
      let x = at(Math.atan2(-dx, -dz))
      // Behind you: stuck to the nearer edge, so you know which way to turn.
      const behind = x === null
      if (behind) {
        let d = Math.atan2(-dx, -dz) - yaw
        d = Math.atan2(Math.sin(d), Math.cos(d))
        x = d > 0 ? 8 : w - 8
      }
      html += `<span class="pin-compass-pin${behind ? ' behind' : ''}" style="left:${x.toFixed(0)}px;--pin:${p.color}"><i>${esc(p.label)}</i><b>${dist}</b></span>`
    }
    if (html !== this._compassHtml) {
      this._compassHtml = html
      this._compassEl.querySelector('.pin-compass-marks').innerHTML = html
    }
  }

  dispose() {
    this.clear()
  }
}

// A `pins` list from the server, made safe (PlayNet._apply).
export function cleanPins(list) {
  if (!Array.isArray(list)) return []
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return list.slice(0, MAX_PINS).filter((d) => d && (d.v === 'a' || d.v === 'f')).map((d) => ({ x: n(d.x), z: n(d.z), v: d.v }))
}

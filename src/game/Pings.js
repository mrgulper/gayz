// The ping wheel (2026-11-28, Gaymi picked it from the new ideas: "Ping
// wheel"; answers: team only, the 6 basics, H + a phone button). Tap the
// Ping key (H, Settings > Controls) for a quick "Look here" where you're
// looking; hold it and a wheel of the 6 pings opens round the middle -
// point at one and let go (or click it, or press 1-6). On a phone the
// ping button opens the wheel; tap one.
//
// A ping is a little marker that floats over the spot for PING_S seconds,
// seen through walls: Look here / Zombies! / Loot here go where you aim,
// Help me! / Follow me / Thanks! go on you. You have one at a time - a new
// one takes the old one's place.
//
// On a server the others see yours too: it rides along with your position
// (PlayNet state `ping`, cleaned by api/_lib/servers.js cleanPing) and
// they get a chat line ("Sam: Zombies!") and a soft sound. In a party
// mode with teams only your own team sees them; in a party mode without
// teams (everyone for themselves) they're only yours. A muted player's
// (Settings > Social > Muted Players) never show.
//
// Owned by BuildSurvival (`s.pings`). Sprites only, never a light; each
// marker's texture and material are its own (freed when it goes). Markers
// ignore fog and walls, so a ping always shows.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { addChatSystemLine } from './ChatUI.js'

export const PINGS = ['look', 'zombie', 'loot', 'help', 'follow', 'thanks']
// These go where you aim; the rest go on you.
const AIMED = new Set(['look', 'zombie', 'loot'])
// Each ping's colour and icon: line drawings on a 24 x 24 grid (SVG path
// data, also drawn on the markers' canvas with Path2D). No emoji (the
// project's lint rule).
const LOOK = {
  look: { color: '#4ab8ff', icon: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z' },
  zombie: { color: '#ff4a3a', icon: 'M5 11a7 7 0 0 1 14 0v4h-3v4H8v-4H5z M9 11h.01 M15 11h.01 M11 15h2' },
  loot: { color: '#ffcf3a', icon: 'M4 10h16v9H4z M4 10l2-4h12l2 4 M12 10v4' },
  help: { color: '#ff8a1a', icon: 'M12 3l10 18H2z M12 10v5 M12 18h.01' },
  follow: { color: '#3adf6a', icon: 'M5 12h14 M13 6l6 6-6 6' },
  thanks: { color: '#ff6fb5', icon: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z' },
}
export const PING_S = 8 // how long a marker stays (a guess, 2026-11-28)
const FADE_S = 1 // the last second it fades out
const HOLD_MS = 250 // holding the key this long opens the wheel
const COOLDOWN_S = 0.8 // no spamming
const FAR = 40 // blocks: aiming at the sky puts it this far out
const ABOVE = 0.3 // blocks over the spot (the badge's pointer tip sits here)
const MARK_W = 0.28 // screen size of a marker (sizeAttenuation off): ~130 px on a 720 px tall screen

const keyOf = (id) => `ping${id.charAt(0).toUpperCase()}${id.slice(1)}`

// A ping from another player's state, or null. { k, x, y, z, n } in blocks;
// n counts up with each new ping, so a new one shows even on the same spot.
export function cleanPing(v) {
  if (!v || typeof v !== 'object' || !PINGS.includes(v.k)) return null
  const num = (n, lo, hi) => (Number.isFinite(Number(n)) ? Math.max(lo, Math.min(hi, Number(n))) : null)
  const x = num(v.x, -1e5, 1e5)
  const y = num(v.y, -520, 520)
  const z = num(v.z, -1e5, 1e5)
  const n = Number.isInteger(v.n) && v.n >= 0 && v.n < 1e9 ? v.n : null
  if (x === null || y === null || z === null || n === null) return null
  return { k: v.k, x, y, z, n }
}

// The marker's picture: a round badge in the ping's colour with its icon,
// the words under it and (another player's) their name.
function markCanvas(id, name) {
  const look = LOOK[id] || LOOK.look
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const g = c.getContext('2d')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // A little pointer under the badge, down to the spot.
  g.fillStyle = look.color
  g.beginPath()
  g.moveTo(108, 112)
  g.lineTo(148, 112)
  g.lineTo(128, 140)
  g.closePath()
  g.fill()
  g.beginPath()
  g.arc(128, 70, 52, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.stroke()
  // The icon: 24-unit lines, scaled up into the badge.
  g.save()
  g.translate(128 - 36, 70 - 36)
  g.scale(3, 3)
  g.strokeStyle = '#fff'
  g.lineWidth = 2.4
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (typeof Path2D !== 'undefined') g.stroke(new Path2D(look.icon))
  g.restore()
  const label = t(keyOf(id))
  g.font = 'bold 32px sans-serif'
  g.lineWidth = 7
  g.strokeStyle = 'rgba(0,0,0,0.75)'
  g.strokeText(label, 128, 176, 248)
  g.fillStyle = '#fff'
  g.fillText(label, 128, 176, 248)
  if (name) {
    g.font = 'bold 24px sans-serif'
    g.lineWidth = 6
    g.strokeText(name, 128, 216, 248)
    g.fillStyle = look.color
    g.fillText(name, 128, 216, 248)
  }
  return c
}

export class Pings {
  constructor(survival) {
    this.s = survival
    this.mine = null // { k, x, y, z, n, age, sprite }
    this.remote = new Map() // pid -> { n, age, sprite }
    this._n = 0
    this._coolUntil = 0 // performance.now() ms
    this._holdTimer = 0
    this._holding = false
    this._wheel = null
    this._hovered = ''
    this._closing = 0
  }

  get B() {
    return this.s.B
  }

  get open() {
    return !!this._wheel && !this._wheel.hidden && !this._wheel.classList.contains('closing')
  }

  // ---------- Keys and buttons ----------

  // The Ping key went down: a quick tap pings "Look here", holding it
  // opens the wheel (keyUp decides).
  keyDown() {
    if (!this.s.active) return
    if (this.open) return this.close()
    if (this._holding) return
    this._holding = true
    clearTimeout(this._holdTimer)
    this._holdTimer = setTimeout(() => {
      if (this._holding) this.openWheel(true)
    }, HOLD_MS)
  }

  keyUp() {
    if (!this._holding) return
    this._holding = false
    clearTimeout(this._holdTimer)
    if (!this._byHold) {
      // Let go before the wheel opened: a quick "Look here".
      if (!this.open) this.send('look')
      return
    }
    this._byHold = false
    // Let go over a ping: that one. Over nothing: the wheel stays up to click.
    if (this.open && this._hovered) this.send(this._hovered)
  }

  // The phone's ping button: opens or closes the wheel.
  toggleWheel() {
    if (this.open) return this.close()
    this.openWheel(false)
  }

  openWheel(byHold = false) {
    if (!this.s.active) return
    this._byHold = byHold
    this._ensureWheel()
    clearTimeout(this._closing)
    this._wheel.classList.remove('closing')
    this._wheel.hidden = false
    this._wheel.classList.remove('opening')
    void this._wheel.offsetWidth
    this._wheel.classList.add('opening')
    this._hover('')
    // The real mouse, to point at one; held keys stay held (like Emotes).
    if (document.pointerLockElement) document.exitPointerLock()
  }

  close(relock = true) {
    this._byHold = false
    if (!this.open) return
    const wheel = this._wheel
    wheel.classList.add('closing')
    clearTimeout(this._closing)
    this._closing = setTimeout(() => {
      wheel.hidden = true
      wheel.classList.remove('closing')
    }, 150)
    if (relock && this.s.active && !this.s.dead) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // A number key while the wheel is up picks that ping (1-6). -> true if used.
  pick(code) {
    if (!this.open) return false
    const m = /^Digit([1-6])$/.exec(code)
    if (!m) return false
    this.send(PINGS[Number(m[1]) - 1])
    return true
  }

  // ---------- Pinging ----------

  // Where a ping goes, in blocks: the spot you aim at, or you.
  _spot(id) {
    const s = this.s
    const bm = s.bm
    if (!AIMED.has(id)) {
      const p = s.bodyPos()
      return { x: p.x, y: p.y + 2, z: p.z }
    }
    const B = this.B
    bm.camera.updateMatrixWorld()
    bm._raycaster.setFromCamera({ x: 0, y: 0 }, bm.camera)
    const hit = bm._raycastGridAligned()
    if (hit?.placeAt) {
      const [x, y, z] = hit.placeAt
      return { x: x + 0.5, y: y + 0.2, z: z + 0.5 }
    }
    // The sky: FAR blocks out along the view.
    const o = bm._raycaster.ray.origin
    const d = bm._raycaster.ray.direction
    return { x: o.x / B + d.x * FAR, y: o.y / B + d.y * FAR, z: o.z / B + d.z * FAR }
  }

  send(id) {
    if (!PINGS.includes(id) || !this.s.active) return false
    this.close()
    const now = performance.now()
    if (now < this._coolUntil) return false
    this._coolUntil = now + COOLDOWN_S * 1000
    const spot = this._spot(id)
    this._dropMine()
    const n = ++this._n
    this.mine = { k: id, ...spot, n, age: 0, sprite: this._sprite(id, '', spot) }
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    return true
  }

  // For PlayNet's state: my ping while it's up (null: none, or nobody
  // should see it).
  snapshot() {
    const p = this.mine
    if (!p || !this._shareable()) return null
    return { k: p.k, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1), n: p.n }
  }

  // A party mode without teams is everyone for themselves: no sharing.
  _shareable() {
    const pm = this.s.party
    return !pm || !!pm.myTeam
  }

  // May I see this player's pings? Team modes: only my team's.
  _canSee(pid, nick) {
    if ((this.s.bm.game?.settings?.mutedChatPlayers || []).includes(nick)) return false
    const pm = this.s.party
    if (!pm) return true
    const mine = pm.myTeam
    return !!mine && pm.teams.get(pid) === mine
  }

  // After each server sync (players: PlayNet's Map of pid -> { nick, ping }).
  syncRemote(players) {
    for (const [pid, p] of players) {
      const ping = p.ping
      const had = this.remote.get(pid)
      if (!ping) continue
      if (had && had.n === ping.n) continue
      if (had) this._drop(had)
      if (!this._canSee(pid, p.nick)) {
        // Remembered, so it doesn't pop up later if teams change.
        this.remote.set(pid, { n: ping.n, age: PING_S, sprite: null })
        continue
      }
      const name = String(p.nick || 'Survivor').slice(0, 20)
      this.remote.set(pid, { n: ping.n, age: 0, sprite: this._sprite(ping.k, name, ping) })
      addChatSystemLine(this.s.bm.game, t('pingChatLine', { name, ping: t(keyOf(ping.k)) }))
      try { audioEngine.playSpecial?.('chatPing') } catch { /* no audio */ }
    }
    for (const pid of [...this.remote.keys()]) if (!players.has(pid)) this.dropRemote(pid)
  }

  // A player left the server.
  dropRemote(pid) {
    const had = this.remote.get(pid)
    if (had) this._drop(had)
    this.remote.delete(pid)
  }

  update(dt) {
    if (this.open && !this.s.active) this.close(false)
    const tick = (p) => {
      p.age += dt
      if (!p.sprite) return
      const left = PING_S - p.age
      if (left <= 0) return this._drop(p)
      p.sprite.material.opacity = Math.min(1, left / FADE_S)
    }
    if (this.mine) {
      tick(this.mine)
      if (!this.mine.sprite) this.mine = null
    }
    for (const p of this.remote.values()) tick(p)
  }

  clear() {
    this._holding = false
    clearTimeout(this._holdTimer)
    this.close(false)
    this._dropMine()
    for (const p of this.remote.values()) this._drop(p)
    this.remote.clear()
  }

  _dropMine() {
    if (this.mine) this._drop(this.mine)
    this.mine = null
  }

  _drop(p) {
    if (!p?.sprite) return
    p.sprite.parent?.remove(p.sprite)
    p.sprite.material.map?.dispose()
    p.sprite.material.dispose()
    p.sprite = null
  }

  _sprite(id, name, spot) {
    const B = this.B
    const tex = new THREE.CanvasTexture(markCanvas(id, name))
    tex.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false })
    const sprite = new THREE.Sprite(mat)
    // The badge's pointer tip is a bit above the picture's middle: lift it.
    sprite.center.set(0.5, 0.45)
    sprite.scale.set(MARK_W, MARK_W, 1)
    sprite.renderOrder = 999
    sprite.position.set(spot.x * B, (spot.y + ABOVE) * B, spot.z * B)
    sprite.userData.ping = id
    this.s.bm.scene.add(sprite)
    return sprite
  }

  // ---------- The wheel ----------

  // A pie of 6 slices (SVG, viewBox -100..100), like the emote wheel: each
  // an icon in its own colour, the pointed-at one lit and nudged out.
  _ensureWheel() {
    if (this._wheel) {
      this._label()
      return
    }
    const n = PINGS.length
    const step = (Math.PI * 2) / n
    const R1 = 38
    const R2 = 96
    const pt = (r, a) => `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`
    const slices = PINGS.map((id, i) => {
      const a0 = (i - 0.5) * step
      const a1 = (i + 0.5) * step
      const mid = i * step
      const d = `M${pt(R1, a0)} L${pt(R2, a0)} A${R2} ${R2} 0 0 1 ${pt(R2, a1)} L${pt(R1, a1)} A${R1} ${R1} 0 0 0 ${pt(R1, a0)}Z`
      const [ix, iy] = pt(63, mid).split(' ')
      const [kx, ky] = pt(87, mid).split(' ')
      // As on the emote wheel: the see-through .ping-hit never moves, only
      // .ping-look slides out (so the hovered slice can't flicker).
      return `<g class="ping-slice" data-ping="${id}" role="button" tabindex="0" style="--i:${i}; --c:${LOOK[id].color}; --dx:${(Math.sin(mid) * 4).toFixed(2)}px; --dy:${(-Math.cos(mid) * 4).toFixed(2)}px">`
        + `<path class="ping-hit" d="${d}"/><g class="ping-look"><path d="${d}"/><path class="ping-icon" transform="translate(${ix} ${iy}) scale(1.1) translate(-12 -12)" d="${LOOK[id].icon}"/><text class="ping-key" x="${kx}" y="${ky}">${i + 1}</text></g></g>`
    }).join('')
    const wheel = document.createElement('div')
    wheel.id = 'ping-wheel'
    wheel.hidden = true
    wheel.innerHTML = `<div class="ping-ring"><svg viewBox="-100 -100 200 200">${slices}</svg><div class="ping-mid"><span></span></div></div>`
    wheel.addEventListener('click', (e) => {
      const slice = e.target.closest('[data-ping]')
      if (slice) this.send(slice.dataset.ping)
      else this.close()
    })
    wheel.addEventListener('keydown', (e) => {
      const slice = e.target.closest?.('[data-ping]')
      if (slice && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        this.send(slice.dataset.ping)
      }
    })
    wheel.addEventListener('pointerover', (e) => this._hover(e.target.closest('[data-ping]')?.dataset.ping || ''))
    wheel.addEventListener('focusin', (e) => this._hover(e.target.closest?.('[data-ping]')?.dataset.ping || ''))
    document.body.appendChild(wheel)
    this._wheel = wheel
    this._label()
  }

  _hover(id) {
    if (!this._wheel) return
    if (id !== this._hovered) {
      this._wheel.querySelector('.is-hot')?.classList.remove('is-hot')
      if (id) this._wheel.querySelector(`[data-ping="${id}"]`)?.classList.add('is-hot')
      if (id) try { audioEngine.playUiHover?.() } catch { /* no audio */ }
      this._hovered = id
    }
    const mid = this._wheel.querySelector('.ping-mid span')
    if (mid) mid.textContent = id ? t(keyOf(id)) : t('actionPing')
  }

  _label() {
    for (const g of this._wheel.querySelectorAll('[data-ping]')) g.setAttribute('aria-label', t(keyOf(g.dataset.ping)))
    this._hovered = null
    this._hover('')
  }
}

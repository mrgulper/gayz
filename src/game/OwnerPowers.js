// Owner powers in the game (2026-11-15, Gaymi: "give bigger and more
// admin powers"). Only for the owner dropped into a server (OwnerDropIn.js,
// visible or invisible): a gold crown button (and the \ key) opens the
// Owner menu -
//   Players: Go to (fly right over them), Bring (pulls them to you),
//            Freeze / Unfreeze (they can look round but not move)
//   Give:    coins, gems and a skin to one player
//   Zombies: a horde of 5 / 10 / 20 or a boss next to you, or clear them all
//   Sky:     day or night, and the weather
//   Announce: a big message on everyone's screen
//   Close the server: everyone in it is sent back to the homepage
// The server only takes these from a player it marked as the owner
// (api/_lib/ownerPowers.js); this file also does what lands on everyone
// else's side (being pulled, frozen, given a gift, the announcement) and
// on the host's (the zombies and sky - the others see them through it).
import { t } from './i18n.js'
import { MARKET_SKINS } from './MarketSkins.js'
import { receiveGift } from './LiveConfig.js'

// The same lists the server checks (api/_lib/ownerPowers.js).
export const HORDE_SIZES = [5, 10, 20]
export const OWNER_WEATHERS = ['clear', 'lightRain', 'thunderstorm', 'lightSnow', 'blizzard', 'fog', 'heatwave', 'sandstorm']
const GIFT_SKINS = [{ id: 'gaygarx', name: 'GaygarX' }, ...MARKET_SKINS.map((k) => ({ id: k.id, name: k.name }))]
export const OWNER_KEY = 'Backslash'
const ANN_SECONDS = 8

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// --- Everyone's side (PlayNet._apply) ---

// What the server handed this player: queued orders, frozen or not, the
// announcement, and (the host) the zombie / sky orders.
export function applyOwnerDeliveries(net, res) {
  const s = net.survival
  if (!s?.active) return
  for (const c of res.oq || []) {
    if (c.k === 'tp') pullHere(s, c)
    else if (c.k === 'give') receiveGift(net.game, c, 'ownerGiftGot')
  }
  const frozen = res.frz === 1
  if (frozen !== !!s.adminFrozen) {
    s.adminFrozen = frozen
    if (frozen) {
      s.kart?.leave()
      s.vehicles?.leave(true)
    }
    s._message(t(frozen ? 'ownerFrozenYou' : 'ownerUnfrozenYou'), 3)
  }
  if (res.ann && res.ann.n !== net._annN) {
    net._annN = res.ann.n
    showAnnouncement(String(res.ann.text || ''))
  }
  if (net.isHost) for (const c of res.hq || []) hostOrder(net, s, c)
}

// The owner pulled me over to them.
function pullHere(s, c) {
  const x = Number(c.x)
  const y = Number(c.y)
  const z = Number(c.z)
  if (![x, y, z].every(Number.isFinite)) return
  if (s.spectating) s.bm.spectate?.exit()
  s.kart?.leave()
  s.vehicles?.leave(true)
  s.passenger?.leave?.()
  // Standing on the ground under that spot (the owner may be flying).
  const gy = s._groundUnder(x + 1, y + 1, z)
  const tm = s.bm.tryMode
  tm.pos.set(x + 1, Number.isFinite(gy) ? gy : y, z)
  tm.vel?.set(0, 0, 0)
  s._message(t('ownerPulledYou'), 3)
}

// The host runs the zombies and sky for everyone.
function hostOrder(net, s, c) {
  // No spot (sent from the owner's tools): next to a random player.
  let spot = Number.isFinite(Number(c.x)) ? { x: Number(c.x), y: Number(c.y), z: Number(c.z) } : null
  if (!spot && (c.k === 'horde' || c.k === 'boss')) {
    const people = [s.bodyPos(), ...net.targets()]
    const p = people[Math.floor(Math.random() * people.length)]
    spot = { x: p.x, y: p.y, z: p.z }
  }
  if (c.k === 'horde') {
    const n = HORDE_SIZES.includes(Number(c.n)) ? Number(c.n) : 5
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
      const r = 4 + Math.random() * 4
      const x = spot.x + Math.cos(a) * r
      const z = spot.z + Math.sin(a) * r
      s._extraZombie(x, s._groundUnder(x, spot.y + 4, z), z)
    }
    s._message(t('ownerHordeComing'), 3)
  } else if (c.k === 'boss') {
    const x = spot.x + 5
    s._ownerBoss(x, s._groundUnder(x, spot.y + 4, spot.z), spot.z)
  } else if (c.k === 'clear') {
    s._ownerClearZombies()
  } else if (c.k === 'sky') {
    s.bm.sky?.ownerSet?.({ time: c.time, weather: c.weather })
  }
}

let annEl = null
let annTimer = 0
export function showAnnouncement(text) {
  if (!text) return
  if (!annEl) {
    annEl = document.createElement('div')
    annEl.id = 'owner-announcement'
    annEl.setAttribute('role', 'status')
    document.body.appendChild(annEl)
  }
  annEl.innerHTML = `<small>${esc(t('ownerAnnounceFrom'))}</small><b>${esc(text)}</b>`
  annEl.hidden = false
  clearTimeout(annTimer)
  annTimer = setTimeout(() => {
    annEl.hidden = true
  }, ANN_SECONDS * 1000)
}

// --- The owner's side ---

export class OwnerPanel {
  constructor(game, survival, net) {
    this.game = game
    this.s = survival
    this.net = net
    this.open = false
    this._frozen = new Set()
    this._confirmClose = 0
    this._btn = document.createElement('button')
    this._btn.type = 'button'
    this._btn.id = 'owner-powers-btn'
    this._btn.title = t('ownerPanelTitle')
    this._btn.setAttribute('aria-label', t('ownerPanelTitle'))
    this._btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 4l4.5 8L21 8l-2 11H5z" fill="currentColor"/></svg>'
    this._btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggle()
    })
    document.body.appendChild(this._btn)
    this._el = document.createElement('div')
    this._el.id = 'owner-panel'
    this._el.style.display = 'none'
    this._el.addEventListener('click', (e) => this._onClick(e))
    // Clicks in the menu never reach the game (no shots, no relock).
    this._el.addEventListener('pointerdown', (e) => e.stopPropagation())
    document.body.appendChild(this._el)
    this._refresh = setInterval(() => {
      if (this.open) this._renderPlayers()
      if (this.open && (!this.s.active || this.net.closed)) this.close(false)
    }, 1000)
  }

  toggle() {
    if (this.open) this.close()
    else this.show()
  }

  show() {
    if (this.open || !this.s.active) return
    this.open = true
    this.s.bm._keys?.clear()
    if (document.pointerLockElement) document.exitPointerLock()
    this._render()
    this._el.style.display = 'flex'
  }

  close(relock = true) {
    if (!this.open) return
    this.open = false
    this._el.style.display = 'none'
    if (relock && this.s.active) {
      try { this.s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  dispose() {
    this.close(false)
    clearInterval(this._refresh)
    this._btn.remove()
    this._el.remove()
  }

  // Where I am: the free camera while invisible, else my body.
  _spot() {
    const bm = this.s.bm
    if (this.s.spectating) {
      const B = this.s.B
      return { x: bm.camera.position.x / B, y: bm.camera.position.y / B - 1.6, z: bm.camera.position.z / B }
    }
    const p = bm.tryMode.pos
    return { x: p.x, y: p.y, z: p.z }
  }

  _send(cmd, withSpot = false) {
    this.net.ownerCommand(withSpot ? { ...cmd, ...this._spot() } : cmd)
    this.s._message(t('ownerSent'), 2)
  }

  // Fly right over a player.
  _goTo(pid) {
    const p = this.net.players.get(pid)
    if (!p) return
    const bm = this.s.bm
    const B = this.s.B
    if (this.s.spectating) {
      if (bm.spectate) bm.spectate._watch = -1
      bm.camera.position.set(p.x * B, (p.y + 4) * B, (p.z + 3) * B)
    } else {
      bm.tryMode.pos.set(p.x, p.y + 2.5, p.z)
      bm.tryMode.vel?.set(0, 0, 0)
    }
    this.close()
  }

  _onClick(e) {
    const b = e.target.closest('[data-act]')
    if (!b) {
      if (e.target === this._el) this.close()
      return
    }
    const act = b.dataset.act
    const pid = b.dataset.pid
    const q = (id) => this._el.querySelector(`#${id}`)
    if (act === 'close') this.close()
    else if (act === 'goto') this._goTo(pid)
    else if (act === 'pull') this._send({ k: 'pull', to: pid }, true)
    else if (act === 'freeze') {
      const on = !this._frozen.has(pid)
      if (on) this._frozen.add(pid)
      else this._frozen.delete(pid)
      this._send({ k: 'freeze', to: pid, on })
      this._renderPlayers()
    } else if (act === 'give') {
      const to = q('owner-give-to').value
      const coins = Math.max(0, Math.floor(Number(q('owner-give-coins').value) || 0))
      const gems = Math.max(0, Math.floor(Number(q('owner-give-gems').value) || 0))
      const skin = q('owner-give-skin').value
      if (!to || (!coins && !gems && !skin)) return this.s._message(t('ownerGiveEmpty'), 2)
      this._send({ k: 'give', to, coins, gems, skins: skin ? [skin] : [] })
    } else if (act === 'horde') this._send({ k: 'horde', n: Number(b.dataset.n) }, true)
    else if (act === 'boss') this._send({ k: 'boss' }, true)
    else if (act === 'clear') this._send({ k: 'clear' })
    else if (act === 'time') this._send({ k: 'sky', time: b.dataset.time })
    else if (act === 'weather') this._send({ k: 'sky', weather: q('owner-weather').value })
    else if (act === 'ann') {
      const input = q('owner-ann-text')
      const text = input.value.trim()
      if (!text) return
      this._send({ k: 'ann', text })
      input.value = ''
    } else if (act === 'shut') {
      // Two clicks within 4 seconds: a slip doesn't close it.
      if (Date.now() - this._confirmClose > 4000) {
        this._confirmClose = Date.now()
        b.textContent = t('ownerCloseSure')
        return
      }
      this._send({ k: 'close' })
      this.close(false)
    }
  }

  _render() {
    const weathers = OWNER_WEATHERS.map((w) => `<option value="${w}">${esc(t(`buildWeather_${w}`))}</option>`).join('')
    const skins = GIFT_SKINS.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')
    this._el.innerHTML = `
      <div class="build-share-box owner-box">
        <h2>${esc(t('ownerPanelTitle'))}</h2>
        <h3>${esc(t('ownerPlayers'))}</h3>
        <div id="owner-players" class="owner-list"></div>
        <h3>${esc(t('ownerGive'))}</h3>
        <div class="owner-row">
          <select id="owner-give-to" aria-label="${esc(t('ownerGiveTo'))}"></select>
          <input type="number" id="owner-give-coins" min="0" max="100000" placeholder="${esc(t('ownerCoins'))}" aria-label="${esc(t('ownerCoins'))}" />
          <input type="number" id="owner-give-gems" min="0" max="1000" placeholder="${esc(t('ownerGems'))}" aria-label="${esc(t('ownerGems'))}" />
          <select id="owner-give-skin" aria-label="${esc(t('ownerSkin'))}"><option value="">${esc(t('ownerNoSkin'))}</option>${skins}</select>
          <button type="button" data-act="give">${esc(t('ownerSend'))}</button>
        </div>
        <h3>${esc(t('ownerZombies'))}</h3>
        <div class="owner-row">
          ${HORDE_SIZES.map((n) => `<button type="button" data-act="horde" data-n="${n}">${esc(t('ownerHorde', { n }))}</button>`).join('')}
          <button type="button" data-act="boss">${esc(t('ownerBoss'))}</button>
          <button type="button" data-act="clear">${esc(t('ownerClear'))}</button>
        </div>
        <h3>${esc(t('ownerSky'))}</h3>
        <div class="owner-row">
          <button type="button" data-act="time" data-time="day">${esc(t('buildTime_day'))}</button>
          <button type="button" data-act="time" data-time="night">${esc(t('buildTime_night'))}</button>
          <select id="owner-weather" aria-label="${esc(t('ownerWeather'))}">${weathers}</select>
          <button type="button" data-act="weather">${esc(t('ownerSetWeather'))}</button>
        </div>
        <h3>${esc(t('ownerAnnounce'))}</h3>
        <div class="owner-row">
          <input type="text" id="owner-ann-text" maxlength="120" autocomplete="off" placeholder="${esc(t('ownerAnnouncePh'))}" />
          <button type="button" data-act="ann">${esc(t('ownerSend'))}</button>
        </div>
        <div class="owner-row owner-bottom">
          <button type="button" data-act="shut" class="owner-danger">${esc(t('ownerCloseServer'))}</button>
          <button type="button" data-act="close">${esc(t('ownerDone'))}</button>
        </div>
        <p class="owner-hint">${esc(t('ownerHint'))}</p>
      </div>`
    this._renderPlayers()
  }

  _renderPlayers() {
    const list = this._el.querySelector('#owner-players')
    const pick = this._el.querySelector('#owner-give-to')
    if (!list || !pick) return
    const people = [...this.net.players.entries()].filter(([, p]) => p.seen)
    for (const pid of [...this._frozen]) if (!this.net.players.has(pid)) this._frozen.delete(pid)
    const key = people.map(([pid, p]) => `${pid}:${p.nick}:${this._frozen.has(pid)}`).join('|')
    if (key === this._playersKey) return
    this._playersKey = key
    list.innerHTML = people.length
      ? people.map(([pid, p]) => `<div class="owner-player"><b>${esc(p.nick || 'Survivor')}</b><span>
          <button type="button" data-act="goto" data-pid="${esc(pid)}">${esc(t('ownerGoTo'))}</button>
          <button type="button" data-act="pull" data-pid="${esc(pid)}">${esc(t('ownerBring'))}</button>
          <button type="button" data-act="freeze" data-pid="${esc(pid)}">${esc(t(this._frozen.has(pid) ? 'ownerUnfreeze' : 'ownerFreeze'))}</button>
        </span></div>`).join('')
      : `<p>${esc(t('ownerNobody'))}</p>`
    const was = pick.value
    pick.innerHTML = people.map(([pid, p]) => `<option value="${esc(pid)}">${esc(p.nick || 'Survivor')}</option>`).join('')
    if (people.some(([pid]) => pid === was)) pick.value = was
  }
}

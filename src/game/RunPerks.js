// Run perks (2026-11-02, Gaymi's idea list 4: "Between waves you pick 1 of
// 3 power-up cards, like 'bullets bounce' or 'zombies drop double coins.'
// Every run plays out differently"). Owned by BuildSurvival (`s.perks`) in
// every game with waves, except Speedrun (its clock should be fair).
//
// Each cleared wave shows three random cards (#play-perk-pick, styled like
// the weapon picker). Click one, tap it or press 1/2/3. Alone, the wave
// break waits for your pick; on a server the world goes on, and if the
// next wave starts first a random card is picked for you. Picking the
// same perk again stacks it (up to its `max`). Your perks show as small
// badges under the wave text (#play-perk-row) and are kept in a run saved
// from the pause menu. They only last for that game.
//
// BuildSurvival asks this module how much to change things by (damage,
// coins, reload, magazine, speed) and tells it about kills, bites and shots.
import * as THREE from 'three'
import { t } from './i18n.js'

// id, its icon, the most stacks, and what each stack does.
export const PERKS = [
  { id: 'bounce', icon: '↯', max: 3 }, // a hit jumps to BOUNCE_N more zombies nearby
  { id: 'doubleCoins', icon: '◎', max: 2 }, // every coin x2 (x3 at two stacks)
  { id: 'tough', icon: '♥', max: 4 }, // +TOUGH_HP max health (and healed that much)
  { id: 'quickHands', icon: '⟳', max: 3 }, // reload RELOAD_CUT faster
  { id: 'hardHitter', icon: '✊', max: 4 }, // +HIT_UP damage
  { id: 'vampire', icon: '✚', max: 3 }, // heal VAMPIRE_HP per kill
  { id: 'swift', icon: '»', max: 3 }, // move SWIFT_UP faster
  { id: 'bigMag', icon: '▤', max: 3 }, // +MAG_UP magazine
  { id: 'boomKill', icon: '✸', max: 2 }, // kills blow up (BOOM_DMG within BOOM_R)
  { id: 'thorns', icon: '✶', max: 3 }, // a zombie biting you takes THORNS_DMG
  { id: 'scavenger', icon: '◆', max: 3 }, // SCAVENGE_AMMO spare ammo per kill
  { id: 'lucky', icon: '★', max: 3 }, // LUCKY_CHANCE of a x3 hit
]
export const CARDS = 3
export const BOUNCE_R = 6
export const BOUNCE_MULT = 0.5
export const TOUGH_HP = 25
export const RELOAD_CUT = 0.2
export const HIT_UP = 0.2
export const VAMPIRE_HP = 3
export const SWIFT_UP = 0.1
export const MAG_UP = 0.5
export const BOOM_R = 3
export const BOOM_DMG = 40
export const THORNS_DMG = 30
export const SCAVENGE_AMMO = 3
export const LUCKY_CHANCE = 0.12
const BY_ID = new Map(PERKS.map((p) => [p.id, p]))
const ZAP_S = 0.18

// The perks this game's mode plays with.
export function perksFor(cfg) {
  return !cfg.noZombies && cfg.mode !== 'speedrun'
}

export class RunPerks {
  constructor(survival) {
    this.s = survival
    this.stacks = {}
    this.offer = null
    this._zaps = []
    this._onKey = (e) => {
      if (!this.offer) return
      const i = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) % 3
      if (i < 0 || !this.offer[i]) return
      e.preventDefault()
      e.stopPropagation()
      this.pick(this.offer[i])
    }
  }

  // A new game: no perks.
  reset(enabled = true) {
    this.enabled = enabled
    this.stacks = {}
    this.close()
    this._renderRow()
  }

  n(id) {
    return this.stacks[id] || 0
  }

  get open() {
    return !!this.offer
  }

  // --- what BuildSurvival multiplies by ---

  damageMult() {
    return 1 + HIT_UP * this.n('hardHitter')
  }

  coinMult() {
    return 1 + this.n('doubleCoins')
  }

  reloadMult() {
    return Math.max(0.3, 1 - RELOAD_CUT * this.n('quickHands'))
  }

  magMult() {
    return 1 + MAG_UP * this.n('bigMag')
  }

  moveMult() {
    return 1 + SWIFT_UP * this.n('swift')
  }

  extraHealth() {
    return TOUGH_HP * this.n('tough')
  }

  // A shot's damage: now and then a lucky x3.
  shotDamage(amount) {
    return this.n('lucky') && Math.random() < LUCKY_CHANCE * this.n('lucky') ? amount * 3 : amount
  }

  // --- the cards ---

  // A wave was cleared: three cards to pick from.
  offerCards() {
    if (!this.enabled || this.offer || !this.s.active) return false
    const pool = PERKS.filter((p) => this.n(p.id) < p.max)
    if (!pool.length) return false
    const out = []
    while (out.length < CARDS && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id)
    this.offer = out
    this._render()
    return true
  }

  // The next wave started before you picked (a server): one for you.
  onWaveStart() {
    if (this.offer) this.pick(this.offer[Math.floor(Math.random() * this.offer.length)], true)
  }

  pick(id, auto = false) {
    const p = BY_ID.get(id)
    if (!p || !this.offer?.includes(id) || this.n(id) >= p.max) return false
    this.stacks[id] = this.n(id) + 1
    const s = this.s
    if (id === 'tough') {
      s.maxHealth += TOUGH_HP
      s.health = Math.min(s.maxHealth, s.health + TOUGH_HP)
    }
    if (id === 'swift') this.applySpeed()
    if (id === 'bigMag') s.mag = Math.min(s.mag, s.magSize())
    this.close()
    this._renderRow()
    s._message(t(auto ? 'perkAutoPicked' : 'perkPicked', { name: t(`perk_${id}`) }), 3)
    s._renderHud()
    // The click is a real gesture: the mouse can be caught again.
    if (!auto && !s.bm.pickerOpen && !s.bm.menuOpen) {
      try { s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
    return true
  }

  applySpeed() {
    this.s.bm.tryMode.speedMult = (this.s.cfg?.moveMult ?? 1) * this.moveMult() * (this.s.skills?.speedMult() ?? 1)
  }

  close() {
    this.offer = null
    document.removeEventListener('keydown', this._onKey, true)
    const el = document.getElementById('play-perk-pick')
    if (el) el.style.display = 'none'
  }

  _render() {
    let el = document.getElementById('play-perk-pick')
    if (!el) {
      el = document.createElement('div')
      el.id = 'play-perk-pick'
      document.body.appendChild(el)
      el.addEventListener('click', (e) => {
        const card = e.target.closest('[data-perk]')
        if (card) this.pick(card.dataset.perk)
      })
    }
    el.innerHTML = `<div class="pwp-card-box">
      <h2>${t('perkPickTitle')}</h2>
      <p class="pwp-hint">${t(this.s.net ? 'perkPickHintServer' : 'perkPickHint')}</p>
      <div class="pwp-grid perk-grid">${this.offer.map((id, i) => {
        const p = BY_ID.get(id)
        const have = this.n(id)
        return `<button type="button" class="pwp-weapon perk-card" data-perk="${id}">
          <span class="perk-key">${i + 1}</span>
          <span class="perk-icon" aria-hidden="true">${p.icon}</span>
          <span class="pwp-name">${t(`perk_${id}`)}</span>
          <span class="perk-desc">${t(`perkDesc_${id}`)}</span>
          ${have ? `<span class="perk-have">${t('perkStack', { n: have + 1, max: p.max })}</span>` : ''}
        </button>`
      }).join('')}</div>
    </div>`
    el.style.display = 'flex'
    document.addEventListener('keydown', this._onKey, true)
    try { document.exitPointerLock() } catch { /* not locked */ }
  }

  // The small badges under the wave text.
  _renderRow() {
    let row = document.getElementById('play-perk-row')
    const ids = Object.keys(this.stacks)
    if (!row) {
      if (!ids.length) return
      row = document.createElement('div')
      row.id = 'play-perk-row'
      document.body.appendChild(row)
    }
    row.innerHTML = ids.map((id) => `<span class="perk-badge" title="${t(`perk_${id}`)}"><i aria-hidden="true">${BY_ID.get(id).icon}</i>${this.stacks[id] > 1 ? `<b>x${this.stacks[id]}</b>` : ''}</span>`).join('')
    row.style.display = ids.length && this.s.active ? 'flex' : 'none'
  }

  // --- what happens in play ---

  // Hits from one shot (zombie -> damage): Bounce sends part of each on to
  // the nearest zombies not hit yet. -> the extra hits to add.
  bounces(hits) {
    const n = this.n('bounce')
    if (!n) return []
    const s = this.s
    const out = []
    const taken = new Set(hits.keys())
    for (const [z, amount] of hits) {
      let from = z
      for (let i = 0; i < n; i++) {
        let best = null
        let bestD = BOUNCE_R * BOUNCE_R
        for (const o of s.zombies) {
          if (taken.has(o) || o.health <= 0) continue
          const d = (o.x - from.x) ** 2 + (o.y - from.y) ** 2 + (o.z - from.z) ** 2
          if (d < bestD) {
            bestD = d
            best = o
          }
        }
        if (!best) break
        taken.add(best)
        out.push([best, amount * BOUNCE_MULT])
        this._zap(from, best)
        from = best
      }
    }
    return out
  }

  // One of my kills was counted (alone, host or a server's guest).
  onKill() {
    const s = this.s
    if (this.n('vampire') && s.health > 0) {
      s.health = Math.min(s.maxHealth, s.health + VAMPIRE_HP * this.n('vampire'))
    }
    if (this.n('scavenger') && Number.isFinite(s.reserve)) s.reserve += SCAVENGE_AMMO * this.n('scavenger')
  }

  // A zombie I killed fell here (alone or the host - a guest's kills
  // happen on the host, which doesn't know their perks).
  onKillAt(z) {
    const s = this.s
    if (this.n('boomKill')) {
      s._fx?.explode(new THREE.Vector3(z.x * s.B, (z.y + 1) * s.B, z.z * s.B), BOOM_R * 0.6)
      const dmg = BOOM_DMG * this.n('boomKill')
      for (const o of [...s.zombies]) {
        if (o === z || o.health <= 0) continue
        const d = Math.hypot(o.x - z.x, o.y - z.y, o.z - z.z)
        if (d < BOOM_R) this._hitOther(o, dmg * (1 - d / BOOM_R))
      }
    }
  }

  // A zombie bit me.
  onBitten(zb) {
    if (this.n('thorns') && zb.health > 0) this._hitOther(zb, THORNS_DMG * this.n('thorns'))
  }

  // Hurts a zombie the way my shots do (the host's on a server).
  _hitOther(z, amount) {
    const s = this.s
    if (!s.zombies.includes(z)) return
    s.damageNumbers?.atZombie(z, amount, '', s.zombieHeight)
    if (s.net && !s.net.isHost) {
      s.net.queueHit(`z${z.id}`, amount)
      z.flash = 0.12
    } else s.damageZombie(z, amount)
  }

  // A blue spark line from one zombie to the next (Bounce).
  _zap(a, b) {
    const B = this.s.B
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x * B, (a.y + 1.2) * B, a.z * B),
      new THREE.Vector3(b.x * B, (b.y + 1.2) * B, b.z * B),
    ])
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 1 }))
    this.s.bm.scene.add(line)
    this._zaps.push({ line, t: ZAP_S })
  }

  update(dt) {
    for (const z of this._zaps) {
      z.t -= dt
      z.line.material.opacity = Math.max(0, z.t / ZAP_S)
      if (z.t <= 0) this._dropZap(z)
    }
    this._zaps = this._zaps.filter((z) => z.t > 0)
  }

  _dropZap(z) {
    z.line.removeFromParent()
    z.line.geometry.dispose()
    z.line.material.dispose()
  }

  // For a run saved from the pause menu.
  serialize() {
    return { ...this.stacks }
  }

  // The saved stacks (from storage: checked).
  restore(stacks) {
    this.stacks = {}
    for (const p of PERKS) {
      const v = Math.round(Number(stacks?.[p.id]) || 0)
      if (v > 0) this.stacks[p.id] = Math.min(p.max, v)
    }
    this.s.maxHealth = this.s.cfg.maxHealth + this.extraHealth()
    this.applySpeed()
    this._renderRow()
  }

  // The game ended.
  clear() {
    this.close()
    for (const z of this._zaps) this._dropZap(z)
    this._zaps = []
    this.stacks = {}
    const row = document.getElementById('play-perk-row')
    if (row) row.style.display = 'none'
  }
}

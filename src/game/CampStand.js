// The camp Shop Stand (2026-11-27, Gaymi's six ideas, batch 5: "sell spare
// loot (food, materials, extra items) to the NPC survivors walking by. You
// set a price; too high and they walk away"). Owned by BuildCamp
// (`camp.stand`).
//
// Gaymi's answers: use-up things only (food, materials, potions, fuel,
// ammo boxes, med kits - not gear you keep, guns or armour; FAIR lists
// them); each item has a fair price and you pick Cheap / Fair / Pricey or
// Custom; a customer who finds it too dear haggles once (accept or say no -
// no and they walk off); sales pay the game's camp coins.
//
// - A little market stall stands on open ground in the camp. Use it: a
//   screen with what's on the stand and what in your bag could go on it
//   (up to SLOTS kinds, each with its price and how many to sell).
// - While something's on the stand and you're within CUSTOMER_R blocks, a
//   survivor walks up every CUSTOMER_EVERY seconds (MAX_AT_ONCE at a
//   time), looks at one thing and thinks of what it's worth to them (fair x
//   WANT_LO..WANT_HI). Your price or less: they buy one (taken from your
//   bag then - locked slots are never sold). Up to HAGGLE_UP x that: they
//   offer their price instead and wait HAGGLE_S seconds for you to answer
//   at the stand. More: they shake their head and leave.
// - Items stay in your bag until sold, so eating one just sells one less.
//   The stand's list isn't saved with the game.
// Meshes only, never a light. Numbers are a guess.
import * as THREE from 'three'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { findCampSpot, makeLabel } from './CampTrophies.js'
import { openScreen, closeScreen, screenOpen } from './CampScreen.js'
import { showPill, hidePill } from './PlayPills.js'
import { makePerson, disposePerson } from './NpcPeople.js'
import { speechBubble, disposeBubble } from './SpeechBubble.js'
import { itemName, itemIcon } from './PlayInventory.js'
import { MOB_HEIGHT } from './PlayRules.js'

// What each use-up item is worth to a customer, in camp coins.
export const FAIR = {
  healthpack: 20,
  ammobox: 12,
  meat: 6,
  veggies: 5,
  cookedMeat: 12,
  cookedFish: 10,
  fish: 8,
  goldenFish: 40,
  candy: 4,
  brainSnack: 10,
  zombieGoo: 4,
  plantFiber: 3,
  mapPiece: 15,
  treasureMap: 50,
  gooDisguise: 18,
  catchTrap: 15,
  heliFuel: 15,
  jetFuel: 15,
  snowball: 2,
  oldBoot: 2,
  timePass: 30,
  potionSpeed: 25,
  potionInvis: 25,
  potionGiant: 25,
  potionTiny: 25,
}
// Every animal's own meat ('meat_<kind>') sells like Meat.
export const fairOf = (id) => FAIR[id] ?? (String(id).startsWith('meat_') ? FAIR.meat : 0)

export const PRESETS = { cheap: 0.7, fair: 1, pricey: 1.5 }
export const AMOUNTS = [1, 5] // and All
export const SLOTS = 4
export const MAX_PRICE = 9999
export const WANT_LO = 0.75
export const WANT_HI = 1.3
export const HAGGLE_UP = 1.5
export const HAGGLE_S = 15
export const CUSTOMER_EVERY = 6
export const MAX_AT_ONCE = 2
export const CUSTOMER_R = 14
const WALK = 2.2 // blocks a second
const COME_FROM = [6, 9] // how far away they start walking (shorter if needed)
const THINK_S = 1.2
const SAY_S = 2.2
const USE_R = 2.4

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sfx = (id) => { try { audioEngine.playSpecial?.(id) } catch { /* no audio */ } }

// A price from a preset (or a typed number for Custom). -> whole coins, 1+.
export function priceFor(id, preset, custom = 0) {
  if (preset === 'custom') {
    const v = Math.floor(Number(custom))
    return Number.isFinite(v) && v >= 1 ? Math.min(v, MAX_PRICE) : 0
  }
  return Math.max(1, Math.round(fairOf(id) * (PRESETS[preset] ?? 1)))
}

// What a customer does at `price` for an item worth `fair`, with their own
// want (a roll 0..1). -> { act: 'buy' | 'haggle' | 'leave', offer }
export function decide(price, fair, roll = Math.random()) {
  const most = Math.max(1, Math.floor(fair * (WANT_LO + (WANT_HI - WANT_LO) * roll)))
  if (price <= most) return { act: 'buy', offer: price }
  if (price <= most * HAGGLE_UP) return { act: 'haggle', offer: most }
  return { act: 'leave', offer: 0 }
}

// How many unlocked `id` items are in the bag.
export function countIn(inv, id) {
  let n = 0
  for (const list of [inv?.grid || [], inv?.hotbar || []]) for (const it of list) if (it?.kind === 'item' && it.id === id && !it.lk) n += it.n
  return n
}

// The bag's sellable kinds: [{ id, n }].
export function sellable(inv) {
  const seen = new Map()
  for (const list of [inv?.grid || [], inv?.hotbar || []]) {
    for (const it of list) {
      if (it?.kind !== 'item' || it.lk || !fairOf(it.id)) continue
      seen.set(it.id, (seen.get(it.id) || 0) + it.n)
    }
  }
  return [...seen].map(([id, n]) => ({ id, n }))
}

// Takes one unlocked `id` from the bag (the grid first). -> true if there was one.
function takeOne(inv, id) {
  for (const list of [inv.grid, inv.hotbar]) {
    const i = list.findIndex((it) => it?.kind === 'item' && it.id === id && !it.lk)
    if (i < 0) continue
    inv._take(list, i, 1)
    return true
  }
  return false
}

export class CampStand {
  constructor(camp) {
    this.camp = camp
    this.group = null
    this.spot = null
    this.list = [] // on the stand: { id, price, left } (left Infinity = all)
    this.customers = []
    this.next = 2 // seconds to the next customer
    this.haggle = null // the customer waiting for an answer
  }

  get s() {
    return this.camp.s
  }

  get B() {
    return this.camp.B
  }

  build(avoid = []) {
    if (this.group) return
    const s = this.s
    if (s.party || s.td || s.escape) return
    this.spot = findCampSpot(this.camp, 2, 1, avoid)
    if (!this.spot) return
    const B = this.B
    const g = new THREE.Group()
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), new THREE.MeshLambertMaterial({ color }))
      m.position.set(x * B, y * B, z * B)
      g.add(m)
      return m
    }
    // A wooden counter, four posts and a striped awning.
    box(2, 0.9, 0.8, 0x8a5a2e, 0, 0.45, 0)
    box(2.1, 0.08, 0.9, 0x6b4321, 0, 0.94, 0)
    for (const [x, z] of [[-0.95, -0.35], [0.95, -0.35], [-0.95, 0.35], [0.95, 0.35]]) box(0.1, 2.3, 0.1, 0x5a3a1e, x, 1.15, z)
    for (let i = 0; i < 6; i++) box(0.36, 0.08, 1.1, i % 2 ? 0xf4f4f4 : 0xd94a3a, -0.9 + i * 0.36, 2.34, 0.05)
    // A few crates on the counter.
    box(0.35, 0.3, 0.35, 0xc8a064, -0.55, 1.13, 0)
    box(0.3, 0.25, 0.3, 0x7fbf5a, 0.1, 1.1, 0.05)
    box(0.32, 0.28, 0.32, 0xe0b040, 0.6, 1.12, -0.05)
    const sign = makeLabel(t('standSign'), 512, 44, '#ffd23f')
    sign.scale.set(2.4 * B, 0.45 * B, 1)
    sign.position.set(0, 2.8 * B, 0.2 * B)
    g.add(sign)
    g.position.set((this.spot.x + 0.5) * B, 0, (this.spot.z + 0.5) * B)
    g.rotation.y = this.spot.rot
    this.camp.bm.scene.add(g)
    this.group = g
  }

  _mid() {
    return { x: this.spot.x + 0.5, z: this.spot.z + 0.5 }
  }

  // Where a customer stands: just in front of the counter.
  _front(i = 0) {
    const m = this._mid()
    const r = this.spot.rot || 0
    const side = (i % 2 ? 0.6 : -0.6)
    return { x: m.x + Math.sin(r) * 1.4 + Math.cos(r) * side, z: m.z + Math.cos(r) * 1.4 - Math.sin(r) * side }
  }

  near() {
    if (!this.group) return false
    const p = this.camp.bm.tryMode.pos
    const m = this._mid()
    const dx = m.x - p.x
    const dz = m.z - p.z
    const d = Math.hypot(dx, dz)
    if (d > USE_R) return false
    if (d < 0.8) return true
    const yaw = this.camp.bm._yaw
    return (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > 0.5
  }

  prompt() {
    return t(this.haggle ? 'standPromptOffer' : 'standPrompt')
  }

  // The Use key (BuildCamp.use). -> true if it was the stand.
  use() {
    if (!this.near()) return false
    if (this.haggle) this.openHaggle()
    else this.open()
    return true
  }

  // --- The stand's screen ---

  open(pickId = null) {
    const s = this.s
    this._prune()
    const st = { id: pickId, preset: 'fair', custom: '', amount: Infinity }
    this.screen = st
    openScreen(s, {
      title: t('standTitle'),
      wide: true,
      onClose: () => { if (this.screen === st) this.screen = null },
      build: (body) => {
        const note = document.createElement('p')
        note.className = 'camp-screen-note'
        note.textContent = t('standNote')
        body.appendChild(note)
        // On the stand now.
        const onH = document.createElement('b')
        onH.className = 'stand-head'
        onH.textContent = t('standOnHead', { n: this.list.length, max: SLOTS })
        body.appendChild(onH)
        const on = document.createElement('div')
        on.className = 'race-rows stand-on'
        if (!this.list.length) {
          const none = document.createElement('p')
          none.className = 'camp-screen-note'
          none.textContent = t('standEmpty')
          on.appendChild(none)
        }
        for (const l of this.list) {
          const row = document.createElement('div')
          row.className = 'race-row stand-row on'
          row.dataset.id = l.id
          const left = l.left === Infinity ? t('standAll') : String(l.left)
          row.innerHTML = `<img src="${itemIcon(l.id)}" alt="" draggable="false" /><span class="race-row-name">${esc(itemName(l.id))} <em>${esc(t('standLeft', { n: left, have: countIn(s.inv, l.id) }))}</em></span><b class="race-row-odds">${esc(t('standEach', { n: l.price }))}</b>`
          const off = document.createElement('button')
          off.type = 'button'
          off.className = 'race-amount stand-off'
          off.textContent = t('standTakeOff')
          off.addEventListener('click', () => {
            this.list = this.list.filter((x) => x !== l)
            this.open()
          })
          row.appendChild(off)
          on.appendChild(row)
        }
        body.appendChild(on)
        // From your bag.
        const bagH = document.createElement('b')
        bagH.className = 'stand-head'
        bagH.textContent = t('standBagHead')
        body.appendChild(bagH)
        const bag = sellable(s.inv).filter((b) => !this.list.some((l) => l.id === b.id))
        const rows = document.createElement('div')
        rows.className = 'race-rows stand-bag'
        if (!bag.length) {
          const none = document.createElement('p')
          none.className = 'camp-screen-note'
          none.textContent = t('standNothing')
          rows.appendChild(none)
        }
        for (const b of bag) {
          const row = document.createElement('button')
          row.type = 'button'
          row.className = `race-row stand-row${st.id === b.id ? ' pick' : ''}`
          row.dataset.id = b.id
          row.innerHTML = `<img src="${itemIcon(b.id)}" alt="" draggable="false" /><span class="race-row-name">${esc(itemName(b.id))} <em>×${b.n}</em></span><b class="race-row-odds">${esc(t('standFair', { n: fairOf(b.id) }))}</b>`
          row.addEventListener('click', () => {
            st.id = st.id === b.id ? null : b.id
            render()
          })
          rows.appendChild(row)
        }
        body.appendChild(rows)
        // The picked item's price and amount.
        const edit = document.createElement('div')
        edit.className = 'stand-edit'
        const prices = document.createElement('div')
        prices.className = 'race-amounts'
        const custom = document.createElement('input')
        custom.type = 'number'
        custom.min = '1'
        custom.max = String(MAX_PRICE)
        custom.inputMode = 'numeric'
        custom.className = 'nickname-input race-custom stand-custom'
        custom.placeholder = t('standCustom')
        for (const p of Object.keys(PRESETS)) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'race-amount stand-preset'
          b.dataset.p = p
          b.addEventListener('click', () => {
            st.preset = p
            custom.value = ''
            render()
          })
          prices.appendChild(b)
        }
        custom.addEventListener('focus', () => {
          st.preset = 'custom'
          render()
        })
        custom.addEventListener('input', () => {
          st.preset = 'custom'
          st.custom = custom.value
          render()
        })
        prices.appendChild(custom)
        const amounts = document.createElement('div')
        amounts.className = 'race-amounts'
        for (const n of [...AMOUNTS, Infinity]) {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'race-amount stand-amount'
          b.dataset.n = n === Infinity ? 'all' : String(n)
          b.textContent = n === Infinity ? t('standAll') : String(n)
          b.addEventListener('click', () => {
            st.amount = n
            render()
          })
          amounts.appendChild(b)
        }
        const sum = document.createElement('p')
        sum.className = 'camp-screen-note stand-sum'
        const put = document.createElement('button')
        put.type = 'button'
        put.className = 'camp-screen-btn stand-put'
        put.textContent = t('standPut')
        put.addEventListener('click', () => {
          if (!this.add(st.id, priceFor(st.id, st.preset, st.custom), st.amount)) return
          this.open()
        })
        edit.append(prices, amounts, sum, put)
        body.appendChild(edit)
        const render = () => {
          rows.querySelectorAll('.stand-row').forEach((el) => el.classList.toggle('pick', el.dataset.id === st.id))
          edit.style.display = st.id ? '' : 'none'
          if (!st.id) return
          prices.querySelectorAll('.stand-preset').forEach((el) => {
            el.classList.toggle('pick', el.dataset.p === st.preset)
            el.textContent = t(`standPreset_${el.dataset.p}`, { n: priceFor(st.id, el.dataset.p) })
          })
          custom.classList.toggle('pick', st.preset === 'custom')
          amounts.querySelectorAll('.stand-amount').forEach((el) => el.classList.toggle('pick', el.dataset.n === (st.amount === Infinity ? 'all' : String(st.amount))))
          const price = priceFor(st.id, st.preset, st.custom)
          const full = this.list.length >= SLOTS
          sum.textContent = full ? t('standFull', { max: SLOTS }) : price ? t('standSum', { name: itemName(st.id), n: price, fair: fairOf(st.id) }) : t('standNoPrice')
          put.disabled = full || !price
        }
        render()
      },
    })
    return st
  }

  // Puts an item on the stand. -> true if it went on.
  add(id, price, amount = Infinity) {
    if (!id || !fairOf(id) || !(price >= 1) || this.list.length >= SLOTS) return false
    if (this.list.some((l) => l.id === id) || !countIn(this.s.inv, id)) return false
    const left = amount === Infinity ? Infinity : Math.max(1, Math.floor(amount))
    this.list.push({ id, price: Math.min(MAX_PRICE, Math.floor(price)), left })
    sfx('pop')
    return true
  }

  // Drops listings that are sold out or no longer in the bag.
  _prune() {
    this.list = this.list.filter((l) => l.left > 0 && countIn(this.s.inv, l.id) > 0)
  }

  // --- Haggling ---

  openHaggle() {
    const c = this.haggle
    if (!c) return
    openScreen(this.s, {
      title: t('standTitle'),
      build: (body, close) => {
        const note = document.createElement('p')
        note.className = 'camp-screen-note stand-offer'
        note.textContent = t('standOfferNote', { name: itemName(c.item.id), offer: c.offer, price: c.item.price })
        const yes = document.createElement('button')
        yes.type = 'button'
        yes.className = 'camp-screen-btn stand-yes'
        yes.textContent = t('standAccept', { n: c.offer })
        yes.addEventListener('click', () => {
          close()
          this.answer(true)
        })
        const no = document.createElement('button')
        no.type = 'button'
        no.className = 'camp-screen-btn stand-no'
        no.textContent = t('standDecline')
        no.addEventListener('click', () => {
          close()
          this.answer(false)
        })
        const btns = document.createElement('div')
        btns.className = 'race-btns'
        btns.append(no, yes)
        body.append(note, btns)
      },
    })
  }

  // Yes or no to the waiting offer. -> coins got.
  answer(yes) {
    const c = this.haggle
    if (!c) return 0
    this.haggle = null
    hidePill('stand-offer')
    if (!yes) {
      this._say(c, t('standSayNo'))
      this._goAway(c)
      return 0
    }
    return this._sell(c, c.offer)
  }

  // --- Customers ---

  _sell(c, coins) {
    const s = this.s
    const l = c.item
    if (!this.list.includes(l) || !takeOne(s.inv, l.id)) {
      this._say(c, t('standSayGone'))
      this._goAway(c)
      this._prune()
      return 0
    }
    l.left -= 1
    const before = s._coinsEarned
    s._earn(coins, 'stand')
    const got = s._coinsEarned - before
    s._message(t('standSold', { name: itemName(l.id), n: got }), 2.5)
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
    this._say(c, t('standSayThanks'))
    this._goAway(c)
    this._prune()
    return got
  }

  // A free spot COME_FROM blocks off with a clear straight walk to `to`.
  _startSpot(to) {
    const s = this.s
    const clear = (x, z) => !s._solid(Math.floor(x), 0, Math.floor(z)) && !s._solid(Math.floor(x), 1, Math.floor(z)) && this.camp.inside(x, z)
    // Only from the front side, so nobody walks through the counter.
    const m = this._mid()
    const r = this.spot.rot || 0
    const fx = Math.sin(r)
    const fz = Math.cos(r)
    // Far first, then shorter walks if the camp's crowded there.
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const far = Math.max(2, COME_FROM[1] - (i / 40) * (COME_FROM[1] - 2))
      const d = Math.max(2, far - Math.random() * (COME_FROM[1] - COME_FROM[0]))
      const x = to.x + Math.cos(a) * d
      const z = to.z + Math.sin(a) * d
      let ok = (x - m.x) * fx + (z - m.z) * fz > 2
      for (let k = 0; ok && k <= d * 2; k++) {
        const f = k / (d * 2)
        const px = x + (to.x - x) * f
        const pz = z + (to.z - z) * f
        if (!clear(px, pz)) ok = false
      }
      if (ok) return { x, z }
    }
    return { x: to.x, z: to.z }
  }

  _customer() {
    const slot = [0, 1].find((i) => !this.customers.some((c) => c.slot === i))
    if (slot === undefined) return null
    const item = this.list[Math.floor(Math.random() * this.list.length)]
    if (!item) return null
    const to = this._front(slot)
    const from = this._startSpot(to)
    const person = makePerson(this.s, { x: from.x, y: 0, z: from.z }, t('standCustomer'))
    const c = { slot, item, person, x: from.x, z: from.z, from, to, phase: 'walk', t: 0, offer: 0 }
    this.customers.push(c)
    return c
  }

  _say(c, text) {
    if (c.bubble) disposeBubble(c.bubble)
    c.bubble = speechBubble(text, this.B)
    c.person.group.add(c.bubble)
    c.sayLeft = SAY_S
  }

  _goAway(c) {
    c.phase = 'leave'
    c.t = 0
  }

  _arrive(c) {
    c.phase = 'think'
    c.t = 0
    if (!this.list.includes(c.item)) c.item = this.list[Math.floor(Math.random() * this.list.length)]
    if (!c.item) {
      this._say(c, t('standSayGone'))
      return this._goAway(c)
    }
    const d = decide(c.item.price, fairOf(c.item.id))
    c.act = d.act
    c.offer = d.offer
    if (d.act === 'haggle' && this.haggle) c.act = 'leave'
    this._say(c, t('standSayLook', { name: itemName(c.item.id) }))
  }

  _decided(c) {
    if (c.act === 'buy') return this._sell(c, c.item.price)
    if (c.act === 'haggle') {
      c.phase = 'wait'
      c.t = 0
      this.haggle = c
      this._say(c, t('standSayOffer', { n: c.offer }))
      sfx('bell')
      return
    }
    this._say(c, t('standSayPricey'))
    this.s._message(t('standWalkedOff', { name: itemName(c.item.id) }), 2.5)
    this._goAway(c)
  }

  _walk(c, to, dt) {
    const dx = to.x - c.x
    const dz = to.z - c.z
    const d = Math.hypot(dx, dz)
    const step = Math.min(d, WALK * dt)
    if (d > 0.001) {
      c.x += (dx / d) * step
      c.z += (dz / d) * step
      c.person.group.rotation.y = Math.atan2(dx, dz)
    }
    c.person.group.position.set(c.x * this.B, 0, c.z * this.B)
    const lp = c.person.body?.limbPivots
    if (lp) {
      const sw = Math.sin(c.t * 8) * 0.6
      lp.legR.rotation.x = sw
      lp.legL.rotation.x = -sw
      lp.armR.rotation.x = -sw * 0.6
      lp.armL.rotation.x = sw * 0.6
    }
    return d - step < 0.05
  }

  _still(c) {
    const lp = c.person.body?.limbPivots
    if (lp) for (const k of ['legR', 'legL', 'armR', 'armL']) lp[k].rotation.x = 0
    // Facing the counter.
    const m = this._mid()
    c.person.group.rotation.y = Math.atan2(m.x - c.x, m.z - c.z)
  }

  _remove(c) {
    if (c.bubble) disposeBubble(c.bubble)
    disposePerson(c.person)
    this.customers = this.customers.filter((x) => x !== c)
    if (this.haggle === c) {
      this.haggle = null
      hidePill('stand-offer')
    }
  }

  update(dt) {
    if (!this.group) return
    const s = this.s
    const p = this.camp.bm.tryMode.pos
    const m = this._mid()
    const here = Math.hypot(p.x - m.x, p.z - m.z) <= CUSTOMER_R && !s.dead && !this.camp.race?.active && !this.camp.fossils?.inside
    if (this.list.length && here) {
      this.next -= dt
      if (this.next <= 0 && this.customers.length < MAX_AT_ONCE) {
        this._prune()
        if (this.list.length) this._customer()
        this.next = CUSTOMER_EVERY * (0.7 + Math.random() * 0.6)
      }
    }
    for (const c of [...this.customers]) {
      c.t += dt
      if (c.bubble && (c.sayLeft -= dt) <= 0 && c.phase !== 'wait') {
        disposeBubble(c.bubble)
        c.bubble = null
      }
      if (c.phase === 'walk') {
        if (this._walk(c, c.to, dt)) {
          this._still(c)
          this._arrive(c)
        }
      } else if (c.phase === 'think') {
        if (c.t >= THINK_S) this._decided(c)
      } else if (c.phase === 'wait') {
        // Walked off (or the time's up): no deal.
        if (c.t >= HAGGLE_S || !here) {
          this.haggle = null
          hidePill('stand-offer')
          if (screenOpen() && !this.screen) closeScreen()
          this._say(c, t('standSayBye'))
          this._goAway(c)
        }
      } else if (c.phase === 'leave') {
        if (c.t > 0.6 && this._walk(c, c.from, dt)) this._remove(c)
      }
    }
    if (this.haggle) showPill('stand-offer', t('standOfferPill', { n: this.haggle.offer, name: itemName(this.haggle.item.id), s: Math.ceil(HAGGLE_S - this.haggle.t) }))
  }

  dispose() {
    for (const c of [...this.customers]) this._remove(c)
    hidePill('stand-offer')
    if (this.screen) closeScreen(false)
    this.screen = null
    if (!this.group) return
    this.group.removeFromParent()
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        m.map?.dispose?.()
        m.dispose()
      }
    })
    this.group = null
  }
}

// The stand's maths, for tests driving the built game (`camp.stand.lib`).
CampStand.prototype.lib = { FAIR, fairOf, priceFor, decide, countIn, sellable, PRESETS, SLOTS, HAGGLE_S, MOB_HEIGHT }

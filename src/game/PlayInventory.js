// The inventory in a game (2026-10-18, Gaymi: "for inventory when clicking
// tab make it like bloxd but 10x10 squares", and picked everything for
// what goes in it). Owned by BuildSurvival (`survival.inv`):
//
//   - 5 armor slots on top (helmet, chestplate, leggings, boots, shield):
//     worn armor takes ARMOR_PER_POINT of every hit per point (capped);
//   - a 10 x 10 grid, and the 10-slot hotbar under it (keys 1-0 / wheel);
//   - your gun: only the one picked at the start, in hotbar slot 1 (2026-10-18,
//     Gaymi: "only the first gun should be in your inventory, not all guns,
//     but when you switch it will change") - Switch Weapon swaps it;
//   - blocks you break (stacks of BLOCK_STACK) - hold one and right-click
//     to place it; blocks placed in a game go away again when it ends,
//     like broken ones come back;
//   - loot from chests: health packs (click to heal), ammo boxes (click to
//     refill the held gun) and armor pieces.
// Tab opens it (BuildMode.togglePicker); drag items between slots with the
// mouse or a finger, Shift-click moves an item between the hotbar and the
// grid. Saved with the game (serialize / restore).
// Pointing at an item (in the panel or on the hotbar) shows a card with its
// name and what it does (#play-item-tip, 2026-10-26); on phones, holding a
// finger on it shows the card for a moment.
// Drop and Lock (2026-10-30, Gaymi: "a Q for dropping items in game" and a
// lock so "you can't drop unless you unlock it"): the Drop key (Q, Settings >
// Controls) throws one of the held item forward - or, with the panel open,
// one of the item under the pointer. Right-click a slot (double-tap on
// phones) locks it: a lock shows on its corner and it can't be dropped.
// Guns are never dropped (you carry just the one).
import { t } from './i18n.js'
import { getKeyFor, keyLabel } from './Keybinds.js'
import { PLAY_WEAPONS, DEFAULT_PLAY_WEAPON, canPlayWeapon } from './PlayWeapons.js'

// How long the item card stays after a finger lets go (phones).
const TIP_TOUCH_MS = 1600
// Two taps on the same slot this close together lock / unlock it (phones).
const DOUBLE_TAP_MS = 350
const LOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2.5" y="7" width="11" height="8" rx="1.5" fill="currentColor"/></svg>'

export const GRID_SIZE = 100
export const HOTBAR_SIZE = 10
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots', 'shield']
// Blocks and items stack up to 999 a slot (2026-10-19, Gaymi: "the hotbar
// max at 999 not just 8"); guns and armour stay one each.
const BLOCK_STACK = 999
export const START_TRAPS = 3
const ITEM_STACK = 999
const ARMOR_PER_POINT = 0.04
const MAX_ARMOR_CUT = 0.6

// Items that aren't guns or blocks.
export const ITEMS = {
  healthpack: { key: 'invHealthPack', heal: 40 },
  // From animals (PlayAnimals.js): click with it held to eat it.
  meat: { key: 'invMeat', heal: 25 },
  // From a Crop Plot (SpecialBlocks.js).
  veggies: { key: 'invVeggies', heal: 15 },
  ammobox: { key: 'invAmmoBox', ammo: 0.5 },
  // Thrown to catch a weakened zombie or animal (PlayCatch.js).
  catchTrap: { key: 'invTrap', trap: true },
  helmet: { key: 'invHelmet', armor: 2, slot: 0 },
  chestplate: { key: 'invChestplate', armor: 4, slot: 1 },
  leggings: { key: 'invLeggings', armor: 3, slot: 2 },
  boots: { key: 'invBoots', armor: 1, slot: 3 },
  shield: { key: 'invShield', armor: 2, slot: 4 },
}

// Each animal's own raw meat ('meat_<kind>', PlayAnimals.js): eaten like
// Meat. key names it ({animal} = its translated animal name), icon is
// which picture it uses.
export function addAnimalMeat(id, { key, animalKey, icon }) {
  ITEMS[id] = { key, animalKey, icon, heal: ITEMS.meat.heal }
}

// Worth a second press before dropping (Confirm Before Dropping Rare
// Items): armor and prize items - not food, ammo or health packs.
const RARE_DROP_CONFIRM_MS = 3000
export function isRareItem(it) {
  const def = it?.kind === 'item' ? ITEMS[it.id] : null
  return !!def && (!!def.armor || !(def.heal || def.ammo || def.trap))
}

// An item's name in the current language.
export function itemName(id) {
  const def = ITEMS[id]
  if (!def) return t(id)
  return def.animalKey ? t(def.key, { animal: t(def.animalKey) }) : t(def.key)
}

// Little pixel pictures for the items (16 x 16, drawn once).
const ICON_PIXELS = {
  healthpack: ['................', '..############..', '.#wwwwwwwwwwww#.', '.#wwwwwrrwwwww#.', '.#wwwwwrrwwwww#.', '.#wwwrrrrrrwww#.', '.#wwwrrrrrrwww#.', '.#wwwwwrrwwwww#.', '.#wwwwwrrwwwww#.', '.#wwwwwwwwwwww#.', '..############..'],
  veggies: ['................', '.......gg.g.....', '......gggg......', '.......gg.......', '......oooo......', '.....oooooo.....', '.....oooooo.....', '......oooo......', '......oooo......', '.......oo.......', '.......oo.......'],
  meat: ['................', '..........ww....', '.........wwww...', '........wwww....', '.....mmmmww.....', '....mmmmmm......', '...mmmmmmmm.....', '...mmmmmmmm.....', '...mmmmmmmm.....', '....mmmmmm......', '.....mmmm.......'],
  poultry: ['................', '...........ww...', '..........wwww..', '.........wwww...', '.....ppppww.....', '....pppppp......', '...pppppppp.....', '...pppppppp.....', '....pppppp......', '.....pppp.......'],
  fishMeat: ['................', '................', '..fffffffff.....', '.ffwfffwfffff...', '.fffffffffffff..', '.ffwfffwffffff..', '..ffffffffff....', '................'],
  bugMeat: ['................', '.....nn..nn.....', '......nnnn......', '....nnnnnnnn....', '...nnwnnnnwnn...', '...nnnnnnnnnn...', '....nnnnnnnn....', '......nnnn......'],
  ammobox: ['................', '................', '...yy.yy.yy.....', '...yy.yy.yy.....', '...yy.yy.yy.....', '.##############.', '.#gggggggggggg#.', '.#ggg######ggg#.', '.#gggggggggggg#.', '.#gggggggggggg#.', '.##############.'],
  helmet: ['................', '....########....', '...#iiiiiiii#...', '..#iiiiiiiiii#..', '..#iiiiiiiiii#..', '..#ii######ii#..', '..#i#......#i#..', '..##........##..'],
  chestplate: ['..###....###....', '.#iii#..#iii#...', '.#iiii##iiii#...', '..#iiiiiiii#....', '..#iiiiiiii#....', '..#iiiiiiii#....', '..#iiiiiiii#....', '..##########....'],
  leggings: ['..##########....', '..#iiiiiiii#....', '..#iiiiiiii#....', '..#iii##iii#....', '..#iii##iii#....', '..#iii##iii#....', '..#iii##iii#....', '..#####..####...'],
  boots: ['................', '..###....###....', '..#i#....#i#....', '..#i#....#i#....', '..#ii##..#ii##..', '..#iiii#.#iiii#.', '..######.######.'],
  catchTrap: ['................', '...##########...', '...#yyyyyyyy#...', '...##########...', '...#i.i..i.i#...', '...#i.i..i.i#...', '...#i.i..i.i#...', '...#i.i..i.i#...', '...##########...', '...#yyyyyyyy#...', '...##########...'],
  shield: ['....########....', '...#bbbbbbbb#...', '...#bbbyybbb#...', '...#byyyyyyb#...', '...#bbbyybbb#...', '....#bbyybb#....', '.....#bbbb#.....', '......####......'],
}
const ICON_COLORS = { p: '#e8b49a', f: '#f08a5a', n: '#8aa83a', o: '#e8862a', m: '#b5452e', '#': '#2b2016', w: '#f2f0ea', r: '#d8352a', y: '#e8c14a', g: '#5d6b3a', i: '#c9ccd2', b: '#3a5fa8' }
const iconCache = new Map()
function itemIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id)
  const url = itemIconCanvas(id).toDataURL()
  iconCache.set(id, url)
  return url
}

// The same picture as a canvas (for an item lying on the ground, PlayDrops).
export function itemIconCanvas(id) {
  const rows = ICON_PIXELS[ITEMS[id]?.icon || id] || []
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')
  const top = Math.floor((16 - rows.length) / 2)
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return
    g.fillStyle = ICON_COLORS[ch]
    g.fillRect(x, top + y, 1, 1)
  }))
  return c
}

const stackOf = (it) => (it.kind === 'block' ? BLOCK_STACK : it.kind === 'gun' || ITEMS[it.id]?.armor ? 1 : ITEM_STACK)
const same = (a, b) => a && b && a.kind === b.kind && a.id === b.id

export class PlayInventory {
  constructor(survival) {
    this.s = survival
    this.grid = new Array(GRID_SIZE).fill(null)
    this.hotbar = new Array(HOTBAR_SIZE).fill(null)
    this.armor = new Array(ARMOR_SLOTS.length).fill(null)
    this.active = 0
    this.open = false
    this._el = null
    this._drag = null
  }

  get bm() {
    return this.s.bm
  }

  // A new game: just the picked gun, in hotbar slot 1 (no health pack -
  // those come from chests).
  reset(weaponId) {
    this.grid.fill(null)
    this.hotbar.fill(null)
    this.armor.fill(null)
    this.active = 0
    this.hotbar[0] = { kind: 'gun', id: weaponId, n: 1 }
    // A few Catch Traps to start with, in the last slot (PlayCatch.js).
    this.hotbar[this.hotbar.length - 1] = { kind: 'item', id: 'catchTrap', n: START_TRAPS }
    this.renderHotbar()
  }

  // Puts items in: the hotbar first (filling stacks, then empty slots),
  // then the grid. Returns how many didn't fit.
  add(item) {
    let left = item.n
    const lists = [this.hotbar, this.grid]
    const max = stackOf(item)
    for (const list of lists) {
      for (const it of list) {
        if (left <= 0) break
        if (same(it, item) && it.n < max) {
          const k = Math.min(left, max - it.n)
          it.n += k
          left -= k
          if (item.lk) it.lk = 1
        }
      }
    }
    for (const list of lists) {
      for (let i = 0; i < list.length && left > 0; i++) {
        if (list[i]) continue
        const k = Math.min(left, max)
        list[i] = { kind: item.kind, id: item.id, n: k, ...(item.lk ? { lk: 1 } : {}) }
        left -= k
      }
    }
    this.renderHotbar()
    if (this.open) this.render()
    return left
  }

  selected() {
    return this.hotbar[this.active]
  }

  // Keys 1-0 / the wheel / a hotbar click.
  select(i) {
    this.active = Math.max(0, Math.min(HOTBAR_SIZE - 1, i))
    this.apply()
    this.renderHotbar()
  }

  // Holds what's in the active slot: a gun switches to it (keeping each
  // gun's ammo), a block or item is held in the hand instead of a gun.
  apply() {
    const it = this.selected()
    const s = this.s
    if (it?.kind === 'gun') {
      s.holding = null
      if (it.id !== s.weaponId) s._equipWeapon(it.id)
    } else s.holding = it ? { ...it } : { kind: 'none' }
    this.bm.tryMode._showGun?.()
    if (this.bm.tryMode._gun) this.bm.tryMode._gun.visible = !s.holding
  }

  // A gun picked with Switch Weapon: it takes the old gun's place (you
  // carry one gun), and goes in your hand.
  bringGun(id, oldId) {
    for (const list of [this.hotbar, this.grid]) {
      const it = list.find((x) => x?.kind === 'gun' && x.id === oldId)
      if (it) {
        it.id = id
        break
      }
    }
    for (const [where, list] of [['hotbar', this.hotbar], ['grid', this.grid]]) {
      const i = list.findIndex((it) => it?.kind === 'gun' && it.id === id)
      if (i < 0) continue
      if (!(where === 'hotbar' && i === this.active)) this.moveItem(where, i, 'hotbar', this.active)
      this.renderHotbar()
      if (this.open) this.render()
      return
    }
    // Not carrying a gun at all: it goes in.
    this.add({ kind: 'gun', id, n: 1 })
  }

  // Uses one of the held item (health pack, ammo box, a thrown Catch
  // Trap). true if used.
  useHeld() {
    const it = this.selected()
    const s = this.s
    if (!it || it.kind !== 'item') return false
    const def = ITEMS[it.id]
    if (def?.heal) {
      if (s.health >= s.maxHealth) {
        s._message(t('invFullHealth'))
        return false
      }
      s.health = Math.min(s.maxHealth, s.health + def.heal)
      s._message(t('invHealed', { n: def.heal }))
    } else if (def?.ammo) {
      const gun = PLAY_WEAPONS[s.weaponId]
      if (!gun || !Number.isFinite(gun.reserve)) return false
      const n = Math.round(gun.reserve * def.ammo)
      s.reserve += n
      s._message(t('invAmmoAdded', { n }))
    } else if (def?.trap) {
      if (!s.catcher?.throw()) return false
    } else return false
    this._take(this.hotbar, this.active, 1)
    s._renderHud()
    return true
  }

  // One less of a held block (after placing it).
  usedBlock() {
    const it = this.selected()
    if (it?.kind !== 'block') return
    this._take(this.hotbar, this.active, 1)
  }

  _take(list, i, n) {
    const it = list[i]
    if (!it) return
    it.n -= n
    if (it.n <= 0) list[i] = null
    if (list === this.hotbar && i === this.active) this.apply()
    this.renderHotbar()
    if (this.open) this.render()
  }

  // Locks or unlocks a slot's item (right-click / double-tap).
  toggleLock(where, i) {
    const it = this._list(where)[i]
    if (!it) return false
    if (it.lk) delete it.lk
    else it.lk = 1
    this.s._message(t(it.lk ? 'invLocked' : 'invUnlocked', { name: this._label(it) }))
    this.renderHotbar()
    if (this.open) this.render()
    return true
  }

  // The Drop key: one of the item in a slot (the held one by default)
  // thrown forward on the ground. Locked items and guns stay.
  drop(where = 'hotbar', i = this.active) {
    const it = this._list(where)[i]
    if (!it || this.s.dead) return false
    if (it.lk) {
      this.s._message(t('invDropLocked'))
      return false
    }
    if (it.kind === 'gun') {
      this.s._message(t('invDropGun'))
      return false
    }
    // Settings > Controls > Confirm Before Dropping Rare Items
    // (2026-10-30): armor and prize items need the Drop key twice within
    // RARE_DROP_CONFIRM_MS - no pop-up, so the game keeps going.
    if (isRareItem(it) && this.bm.game?.settings?.confirmRareDrop !== false) {
      const now = performance.now()
      const asked = this._rareDropAsk
      if (!asked || asked.it !== it || now - asked.at > RARE_DROP_CONFIRM_MS) {
        this._rareDropAsk = { it, at: now }
        this.s._message(t('invDropRareConfirm', { name: this._label(it), key: keyLabel(getKeyFor('dropItem')) }))
        return false
      }
      this._rareDropAsk = null
    }
    const drops = this.s._drops
    const tm = this.bm.tryMode
    if (!drops || !tm?.pos) return false
    const yaw = this.bm._yaw || 0
    const toss = { dx: -Math.sin(yaw), dz: -Math.cos(yaw) }
    const x = tm.pos.x + toss.dx * 0.6
    const y = tm.pos.y + 1.1
    const z = tm.pos.z + toss.dz * 0.6
    const ok = it.kind === 'block' ? drops.spawn(it.id, x, y, z, toss) : drops.spawnItem(it.id, x, y, z, toss)
    if (!ok) return false
    this._take(this._list(where), i, 1)
    return true
  }

  // Q with the panel open: the item under the pointer (or the held one).
  dropHovered() {
    const h = this._hover
    if (h && this._list(h.where)[h.i]) return this.drop(h.where, h.i)
    return this.drop()
  }

  // Worn armor's share of a hit taken away.
  damageCut() {
    const pts = this.armor.reduce((sum, it) => sum + (it ? ITEMS[it.id]?.armor || 0 : 0), 0)
    return Math.min(MAX_ARMOR_CUT, pts * ARMOR_PER_POINT)
  }

  serialize() {
    const one = (it) => (it ? (it.lk ? [it.kind, it.id, it.n, 1] : [it.kind, it.id, it.n]) : 0)
    return { g: this.grid.map(one), h: this.hotbar.map(one), a: this.armor.map(one), act: this.active }
  }

  // From a saved game (untrusted: only known ids, sane counts).
  restore(d) {
    if (!d || typeof d !== 'object') return false
    const ok = (v) => {
      if (!Array.isArray(v)) return null
      const [kind, id, n, lk] = v
      const count = Math.max(1, Math.min(BLOCK_STACK, Math.floor(Number(n) || 1)))
      const lock = lk === 1 ? { lk: 1 } : {}
      if (kind === 'gun' && PLAY_WEAPONS[id]) return { kind, id: canPlayWeapon(id) ? id : DEFAULT_PLAY_WEAPON, n: 1, ...lock }
      if (kind === 'item' && ITEMS[id]) return { kind, id, n: Math.min(count, stackOf({ kind, id })), ...lock }
      if (kind === 'block' && typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id) && this.bm.isBlockType(id)) return { kind, id, n: count, ...lock }
      return null
    }
    const fill = (list, src) => list.forEach((_, i) => { list[i] = ok(Array.isArray(src) ? src[i] : null) })
    fill(this.grid, d.g)
    fill(this.hotbar, d.h)
    fill(this.armor, d.a)
    this.armor.forEach((it, i) => { if (it && ITEMS[it.id]?.slot !== i) this.armor[i] = null })
    this.active = Math.max(0, Math.min(HOTBAR_SIZE - 1, Math.floor(Number(d.act) || 0)))
    return true
  }

  // --- pictures ---

  _icon(it) {
    if (!it) return ''
    if (it.kind === 'gun') return this.bm.game?._weaponThumbCache?.[it.id] || ''
    if (it.kind === 'block') return this.bm.blockIcon(it.id)
    return itemIcon(it.id)
  }

  _label(it) {
    if (!it) return ''
    if (it.kind === 'gun') return t(this.bm.game?.weapons?.getSummary?.().find((w) => w.id === it.id)?.nameKey || 'weaponRifle')
    if (it.kind === 'block') return this.bm.blockName(it.id)
    return itemName(it.id)
  }

  // The item card's second line: what it does.
  _about(it) {
    if (it.kind === 'block') return t('invTipBlock')
    if (it.kind === 'gun') {
      const w = PLAY_WEAPONS[it.id]
      if (!w) return ''
      const d = Math.round(w.damage * (w.pellets || 1))
      const r = Math.round((1 / w.rate) * 10) / 10
      return w.melee ? t('invTipMelee', { d, r }) : t('invTipGun', { d, r, m: w.mag })
    }
    const item = ITEMS[it.id]
    if (!item) return ''
    if (item.armor) return t('invTipArmor', { n: `${Math.round(item.armor * ARMOR_PER_POINT * 100)}%` })
    if (it.id === 'ammobox') return t('invTipAmmoBox')
    if (item.trap) return t('invTipTrap')
    return t(it.id === 'meat' || it.id === 'veggies' || ITEMS[it.id]?.animalKey ? 'invTipMeat' : 'invTipHealthPack', { n: item.heal })
  }

  // The item card beside the pointer (x, y), or beside a slot on phones.
  _showTip(it, x, y) {
    if (!it || this._drag) return this._hideTip()
    let el = this._tip
    if (!el?.isConnected) {
      el = this._tip = document.createElement('div')
      el.id = 'play-item-tip'
      el.setAttribute('role', 'tooltip')
      el.innerHTML = '<b></b><span></span>'
      document.body.appendChild(el)
    }
    el.firstChild.textContent = this._label(it)
    el.lastChild.textContent = this._about(it)
    el.style.display = 'flex'
    // Kept on screen: flips to the other side of the pointer near an edge.
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = x + 16 + w > innerWidth - 8 ? x - 16 - w : x + 16
    const top = Math.min(innerHeight - 8 - h, Math.max(8, y - h - 12))
    el.style.left = `${Math.max(8, left)}px`
    el.style.top = `${top}px`
  }

  _hideTip() {
    clearTimeout(this._tipTimer)
    if (this._tip) this._tip.style.display = 'none'
  }

  // Mouse: follows the pointer over a slot. Touch: shows for a moment.
  _tipFor(e, it, slotEl) {
    if (e.pointerType === 'touch') {
      const box = slotEl.getBoundingClientRect()
      this._showTip(it, box.left + box.width / 2, box.top)
      clearTimeout(this._tipTimer)
      this._tipTimer = setTimeout(() => this._hideTip(), TIP_TOUCH_MS)
      return
    }
    this._showTip(it, e.clientX, e.clientY)
  }

  _slotHtml(it, where, i, extra = '') {
    const icon = this._icon(it)
    const count = it && it.n > 1 ? `<span class="inv-slot-count">${it.n}</span>` : ''
    const img = icon ? `<img src="${icon}" alt="" draggable="false">` : ''
    const lock = it?.lk ? `<span class="inv-slot-lock">${LOCK_SVG}</span>` : ''
    const title = it ? ` aria-label="${this._label(it).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"` : ''
    return `<div class="inv-slot${it?.kind === 'gun' ? ' gun' : ''}${it?.lk ? ' locked' : ''}${extra}" data-where="${where}" data-i="${i}"${title}>${img}${count}${lock}</div>`
  }

  // The always-on-screen hotbar (#build-hotbar) in a game.
  renderHotbar() {
    const el = this.bm._hotbarEl
    if (!el || !this.s.active) return
    el.innerHTML = ''
    this.hotbar.forEach((it, i) => {
      const slot = document.createElement('div')
      slot.className = 'build-hotbar-slot' + (i === this.active ? ' selected' : '')
      const icon = this._icon(it)
      if (icon) slot.style.backgroundImage = `url(${icon})`
      if (it) slot.setAttribute('aria-label', this._label(it))
      slot.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') this._tipFor(e, this.hotbar[i], slot) })
      slot.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this._hideTip() })
      slot.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this._tipFor(e, this.hotbar[i], slot) })
      const num = document.createElement('span')
      num.className = 'build-hotbar-slot-num'
      num.textContent = i === 9 ? '0' : String(i + 1)
      slot.appendChild(num)
      if (it && it.n > 1) {
        const c = document.createElement('span')
        c.className = 'inv-slot-count'
        c.textContent = String(it.n)
        slot.appendChild(c)
      }
      if (it?.lk) slot.insertAdjacentHTML('beforeend', `<span class="inv-slot-lock">${LOCK_SVG}</span>`)
      slot.addEventListener('click', () => this.select(i))
      el.appendChild(slot)
    })
  }

  // --- the panel ---

  show(on) {
    this.open = on
    if (!this._el) this._build()
    this._el.style.display = on ? 'flex' : 'none'
    this._hideTip()
    if (on) this.render()
    else this._endDrag()
  }

  _build() {
    const el = document.createElement('div')
    el.id = 'play-inventory'
    document.body.appendChild(el)
    this._el = el
    el.addEventListener('pointerdown', (e) => this._down(e))
    window.addEventListener('pointermove', (e) => this._move(e))
    window.addEventListener('pointerup', (e) => this._up(e))
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    // The item card while pointing at a slot (mouse); touch in _down.
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return
      const slot = e.target.closest('.inv-slot')
      this._hover = slot ? { where: slot.dataset.where, i: Number(slot.dataset.i) } : null
      if (!slot) return this._hideTip()
      this._showTip(this._list(slot.dataset.where)[Number(slot.dataset.i)], e.clientX, e.clientY)
    })
    el.addEventListener('pointerleave', () => {
      this._hover = null
      this._hideTip()
    })
  }

  render() {
    if (!this._el) return
    const armor = this.armor.map((it, i) => this._slotHtml(it, 'armor', i, it ? '' : ` empty-${ARMOR_SLOTS[i]}`)).join('')
    const grid = this.grid.map((it, i) => this._slotHtml(it, 'grid', i)).join('')
    const bar = this.hotbar.map((it, i) => this._slotHtml(it, 'hotbar', i, i === this.active ? ' active' : '')).join('')
    const cut = Math.round(this.damageCut() * 100)
    this._el.innerHTML = `<div class="inv-box">
      <div class="inv-head"><b>${t('invTitle')}</b><span>${t('invArmorLine', { n: cut })}</span><button type="button" class="inv-close" aria-label="Close">&times;</button></div>
      <div class="inv-armor">${armor}</div>
      <div class="inv-grid">${grid}</div>
      <div class="inv-hotbar">${bar}</div>
      <p class="inv-hint">${t('invHint', { drop: keyLabel(getKeyFor('dropItem')) })}</p>
    </div>`
  }

  _list(where) {
    return where === 'armor' ? this.armor : where === 'hotbar' ? this.hotbar : this.grid
  }

  _down(e) {
    if (e.target.closest('.inv-close')) {
      this.bm.togglePicker()
      return
    }
    const slot = e.target.closest('.inv-slot')
    if (!slot) return
    const list = this._list(slot.dataset.where)
    const i = Number(slot.dataset.i)
    const it = list[i]
    // Tapping a hotbar slot picks it (phones have no number keys).
    if (!it && slot.dataset.where === 'hotbar') {
      this.select(i)
      this.render()
      return
    }
    if (!it) return
    e.preventDefault()
    // Right-click: lock / unlock.
    if (e.button === 2) {
      this.toggleLock(slot.dataset.where, i)
      return
    }
    // Shift-click: straight between the hotbar and the grid (armor goes on).
    if (e.shiftKey) {
      this._quickMove(slot.dataset.where, i)
      return
    }
    const ghost = document.createElement('div')
    ghost.className = 'inv-ghost'
    ghost.innerHTML = `<img src="${this._icon(it)}" alt="">`
    document.body.appendChild(ghost)
    // Only one picture while it moves: the slot it left shows empty
    // (2026-10-18, Gaymi: "there should only be 1 image of the gun").
    slot.classList.add('dragging')
    this._drag = { where: slot.dataset.where, i, ghost, slot }
    this._place(e)
  }

  _place(e) {
    if (!this._drag) return
    this._drag.ghost.style.left = `${e.clientX}px`
    this._drag.ghost.style.top = `${e.clientY}px`
  }

  _move(e) {
    this._place(e)
  }

  _up(e) {
    const d = this._drag
    if (!d) return
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('#play-inventory .inv-slot')
    this._endDrag()
    if (!target) return
    // Let go on the same hotbar slot (a tap): pick it. A finger's tap also
    // shows the item card.
    if (target.dataset.where === d.where && Number(target.dataset.i) === d.i) {
      if (d.where === 'hotbar') {
        this.select(d.i)
        this.render()
      }
      // A finger's second tap on the same slot locks / unlocks it.
      if (e.pointerType === 'touch') {
        const now = performance.now()
        const last = this._lastTap
        this._lastTap = { where: d.where, i: d.i, at: now }
        if (last && last.where === d.where && last.i === d.i && now - last.at < DOUBLE_TAP_MS) {
          this._lastTap = null
          this.toggleLock(d.where, d.i)
          return
        }
      }
      if (e.pointerType === 'touch') {
        const slot = this._el.querySelector(`.inv-slot[data-where="${d.where}"][data-i="${d.i}"]`)
        if (slot) this._tipFor(e, this._list(d.where)[d.i], slot)
      }
      return
    }
    this.moveItem(d.where, d.i, target.dataset.where, Number(target.dataset.i))
  }

  _endDrag() {
    this._hideTip()
    this._drag?.ghost.remove()
    this._drag?.slot?.classList.remove('dragging')
    this._drag = null
  }

  _quickMove(where, i) {
    const list = this._list(where)
    const it = list[i]
    if (!it) return
    if (ITEMS[it.id]?.armor && where !== 'armor') {
      this.moveItem(where, i, 'armor', ITEMS[it.id].slot)
      return
    }
    const to = where === 'hotbar' ? this.grid : this.hotbar
    const toName = where === 'hotbar' ? 'grid' : 'hotbar'
    const free = to.findIndex((x) => !x)
    if (free >= 0) this.moveItem(where, i, toName, free)
  }

  // Moves (or merges, or swaps) one slot's item onto another. Armor slots
  // only take their own kind of armor.
  moveItem(fromWhere, fi, toWhere, ti) {
    const from = this._list(fromWhere)
    const to = this._list(toWhere)
    if (from === to && fi === ti) return false
    const a = from[fi]
    const b = to[ti]
    if (!a) return false
    if (toWhere === 'armor' && ITEMS[a.id]?.slot !== ti) return false
    if (fromWhere === 'armor' && b && ITEMS[b.id]?.slot !== fi) return false
    if (same(a, b) && b.n < stackOf(b)) {
      const k = Math.min(a.n, stackOf(b) - b.n)
      b.n += k
      a.n -= k
      if (a.n <= 0) from[fi] = null
    } else {
      from[fi] = b
      to[ti] = a
    }
    if ((fromWhere === 'hotbar' && fi === this.active) || (toWhere === 'hotbar' && ti === this.active)) this.apply()
    this.renderHotbar()
    if (this.open) this.render()
    return true
  }
}

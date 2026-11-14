// Couch Co-op's equal Player 2 (2026-11-14, Batch 4c-2a). Picked on the
// homepage's Couch Co-op tag ("Buddy or Equal?"); CouchCoop.js makes one of
// these when it's Equal. Player 2 then has their own:
//   - coins: their own kills and every cleared wave pay into them;
//   - Shop (Items, Traps, Upgrades, Ammo, Quests; Towers in Tower
//     Defense) - like PlayShop.js, with Player 2's own upgrades and quests;
//   - a 10-slot hotbar (2026-11-14, Batch 4c-2b) on their half, like
//     Player 1's: their gun, blocks they break or pick up, traps and
//     things they buy. LB/RB picks a slot; what's held is used with the
//     triggers (CouchHands.js: shoot, place a block, use an item). What
//     doesn't fit goes in their bag;
//   - Backpack: every gun to pick from, and everything in the hotbar and
//     bag - A holds it (or uses an item straight away);
//   - skin: picked from the account's owned skins when they join.
// Player 2 is a guest (Gaymi's pick): their coins, kills and headshots only
// last for the game and show on the results screen - nothing is saved to
// the account, and Player 1's stats and quests don't get Player 2's kills.
//
// Everything is driven by Player 2's controller: Back opens the menu wheel
// on their half of the screen; D-pad up/down moves, left/right (or LB/RB)
// changes tab, A picks, B goes back / closes. Player 1 keeps playing.
import { t } from './i18n.js'
import { money } from './SocialSettings.js'
import { ammoFor, PLAY_WEAPONS } from './PlayWeapons.js'
import { tune } from './LiveConfig.js'
import { audioEngine } from './Audio.js'
import { SHOP_ITEMS, UPGRADES, CAMP_QUESTS, AMMO_FILL_COOLDOWN } from './PlayShop.js'
import { INVENTORY_SKINS, skinFrontIconURL } from './InventorySkins.js'
import { SHOP_TRAPS, SHOP_TOWERS } from './PlayShop.js'
import { ITEMS } from './PlayInventory.js'

// Standard gamepad buttons (the same numbers as CouchCoop.js).
const B_A = 0
const B_B = 1
const B_LB = 4
const B_RB = 5
const B_BACK = 8
const UP = 12
const DOWN = 13
const LEFT = 14
const RIGHT = 15

// What Player 2's shop sells: the Shop's own items minus the Fishing Rod
// (Player 2 can't fish). They go in the Backpack, used with A.
const P2_ITEMS = SHOP_ITEMS.filter((i) => !i.item)
// Player 2's quests: no chests (only Player 1 opens them).
const P2_QUESTS = CAMP_QUESTS.filter((q) => q.stat !== 'chests')
const QUESTS_SHOWN = 3
export const P2_TABS = ['items', 'traps', 'upgrades', 'ammo', 'quests']
const ITEM_STACK = 99
const BLOCK_STACK = 999
const MAX_ARMOR = 100
export const P2_HOTBAR = 10
// The bag behind the hotbar (Player 1's is 10 x 10).
const BAG_SIZE = 90
// Player 2's own shop items, drawn with the inventory's pictures.
const ICON_FOR = { medkit: 'healthpack', armor: 'chestplate', ammobox: 'ammobox' }
const stackOf = (it) => (it.kind === 'gun' ? 1 : it.kind === 'block' ? BLOCK_STACK : ITEM_STACK)
const same = (a, b) => a && b && a.kind === b.kind && a.id === b.id

export class CouchGear {
  // skinId: kept from the last game (Play Again) - no pick on joining.
  constructor(couch, skinId = null) {
    this.c = couch
    this.s = couch.s
    this.coins = this.s.cfg?.startCoins || 0
    this.kills = 0
    this.headshots = 0
    this.armor = 0
    this.upgrades = { damage: 0, reload: 0, mag: 0 }
    // The hotbar and bag: { kind: 'gun'|'block'|'item', id, n }. Items
    // are Player 2's shop's (SHOP_ITEMS ids) or ones picked up (PlayInventory
    // ITEMS ids). Their gun starts in slot 1, like Player 1's.
    this.hot = new Array(P2_HOTBAR).fill(null)
    this.hot[0] = { kind: 'gun', id: couch._weaponId(), n: 1 }
    this.bag = []
    this.active = 0
    this.quests = P2_QUESTS.map((q) => ({ ...q, claimed: false }))
    this._noted = new Set()
    this._ammoReadyAt = 0
    // The open menu: null, or { screen: 'wheel'|'shop'|'pack'|'skin', tab, focus }.
    this.menu = null
    this.skinId = 'default'
    this._keptSkin = false
    const kept = skinId && INVENTORY_SKINS.find((s) => s.id === skinId)
    if (kept?.dataUrl) {
      this.skinId = kept.id
      this._keptSkin = true
      couch.setSkin(kept.dataUrl)
    }
    this._key = ''
  }

  get bm() {
    return this.s.bm
  }

  get menuOpen() {
    return !!this.menu
  }

  // ---------- The hotbar and bag ----------

  held() {
    return this.hot[this.active] || null
  }

  holdingGun() {
    return this.held()?.kind === 'gun'
  }

  // Puts things in: stacks first, then empty hotbar slots, then the bag.
  // Returns how many didn't fit.
  add(item) {
    let left = item.n || 1
    const max = stackOf(item)
    for (const it of [...this.hot, ...this.bag]) {
      if (left <= 0) break
      if (same(it, item) && it.n < max) {
        const k = Math.min(left, max - it.n)
        it.n += k
        left -= k
      }
    }
    for (let i = 0; i < this.hot.length && left > 0; i++) {
      if (this.hot[i]) continue
      const k = Math.min(left, max)
      this.hot[i] = { kind: item.kind, id: item.id, n: k }
      left -= k
      if (i === this.active) this._apply()
    }
    while (left > 0 && this.bag.length < BAG_SIZE) {
      const k = Math.min(left, max)
      this.bag.push({ kind: item.kind, id: item.id, n: k })
      left -= k
    }
    return left
  }

  // LB / RB: the next / last hotbar slot.
  cycle(dir) {
    this.select((((this.active + dir) % P2_HOTBAR) + P2_HOTBAR) % P2_HOTBAR)
  }

  select(i) {
    this.active = Math.max(0, Math.min(P2_HOTBAR - 1, i))
    this._apply()
  }

  // Holding a gun: it's the one Player 2 fires (CouchCoop's weaponIdx).
  _apply() {
    const it = this.held()
    if (it?.kind !== 'gun') return
    const idx = this.c.weapons.indexOf(it.id)
    if (idx >= 0 && idx !== this.c.p2.weaponIdx) this.c.holdWeapon(idx)
  }

  // One of what's in slot `i` of `list` used up.
  _takeFrom(list, i, n = 1) {
    const it = list[i]
    if (!it) return
    it.n -= n
    if (it.n > 0) return
    if (list === this.bag) list.splice(i, 1)
    else list[i] = null
  }

  // A block placed (CouchHands.js).
  usedHeld() {
    this._takeFrom(this.hot, this.active)
  }

  // Backpack: pick a gun. Player 2 carries one, like Player 1 - it swaps
  // to the new one and goes in hand.
  equipGun(idx) {
    const id = this.c.weapons[idx]
    if (!id) return
    let at = this.hot.findIndex((it) => it?.kind === 'gun')
    if (at < 0) {
      const b = this.bag.findIndex((it) => it?.kind === 'gun')
      if (b >= 0) this.bag.splice(b, 1)
      at = this._freeHotSlot()
      if (this.hot[at]) this.bag.push(this.hot[at])
      this.hot[at] = { kind: 'gun', id, n: 1 }
    }
    this.hot[at].id = id
    this.select(at)
    this.c.holdWeapon(idx)
  }

  // An empty hotbar slot, or the held one (if it's not the gun), or the last.
  _freeHotSlot() {
    const free = this.hot.findIndex((it) => !it)
    if (free >= 0) return free
    return this.holdingGun() ? P2_HOTBAR - 1 : this.active
  }

  // Backpack: hold something from the bag (it swaps into the hotbar) or
  // the hotbar (that slot's picked).
  hold(where, i) {
    if (where === 'hot') {
      this.select(i)
      return
    }
    const it = this.bag[i]
    if (!it) return
    const at = this._freeHotSlot()
    this.bag.splice(i, 1)
    if (this.hot[at]) this.bag.push(this.hot[at])
    this.hot[at] = it
    this.select(at)
  }

  // A picture for a slot (the inventory's own).
  icon(it) {
    if (!it) return ''
    const inv = this.s.inv
    if (!inv?._icon) return ''
    try {
      return inv._icon(it.kind === 'item' && ICON_FOR[it.id] ? { kind: 'item', id: ICON_FOR[it.id] } : it)
    } catch {
      return ''
    }
  }

  label(it) {
    if (!it) return ''
    if (it.kind === 'item' && P2_ITEMS.some((x) => x.id === it.id)) return t(`campItem_${it.id}`)
    try {
      return this.s.inv?._label?.(it) || it.id
    } catch {
      return it.id
    }
  }

  // ---------- Coins and stats ----------

  // Coins in, with the same boosts as Player 1's (Loot Rush, Blood Moon,
  // Double Coins) but not Player 1's run perks.
  earn(n) {
    const got = Math.round(n * (this.s._coinMult?.(false) ?? 1))
    this.coins += got
    this._checkQuests()
    return got
  }

  onKill() {
    this.kills++
    this._checkQuests()
  }

  onHeadshot() {
    this.headshots++
  }

  _statValue(stat) {
    if (stat === 'wave') return this.s.wave
    if (stat === 'kills') return this.kills
    if (stat === 'headshots') return this.headshots
    return 0
  }

  _activeQuests() {
    return this.quests.filter((q) => !q.claimed).slice(0, QUESTS_SHOWN)
  }

  _checkQuests() {
    for (const q of this._activeQuests()) {
      if (this._statValue(q.stat) >= q.goal && !this._noted.has(q.id)) {
        this._noted.add(q.id)
        this.c.p2Message(t('campQuestDone'))
      }
    }
  }

  // ---------- Player 2's own upgrades (like BuildSurvival's) ----------

  damageMult() {
    return (1 + 0.25 * this.upgrades.damage) * (this.s.cfg?.damageMult ?? 1) * (this.bm.specials?.damageMult?.() ?? 1)
  }

  magSize(w) {
    if (!Number.isFinite(w.mag)) return Infinity
    return Math.round((w.mag + Math.max(1, Math.round(w.mag / 3)) * this.upgrades.mag) * (this.s.cfg?.magMult ?? 1))
  }

  reloadTime(w) {
    return w.reload * (1 - 0.2 * this.upgrades.reload) * (this.s.cfg?.reloadMult ?? 1)
  }

  // Armor takes a hit before health. Returns what's left for health.
  soak(amount) {
    const soaked = Math.min(this.armor, amount)
    this.armor -= soaked
    return amount - soaked
  }

  // ---------- Prices (the same as the Shop's) ----------

  _price(item) {
    return Math.round(item.cost * (1 - (this.s.cfg?.discount || 0)) * tune('shopPrices'))
  }

  _upCost(up) {
    const c = up.costs[this.upgrades[up.id] || 0]
    return c === undefined ? undefined : Math.max(1, Math.round(c * tune('shopPrices')))
  }

  // ---------- The menu ----------

  open(screen = 'wheel') {
    if (!this.s.active || this.s.dead) return
    this.menu = { screen, tab: this.menu?.tab || this.tabs()[0], focus: 0 }
    this._key = ''
    this.c._move = null
    this.render()
  }

  close() {
    this.menu = null
    this._key = ''
    this.render()
  }

  // A button press while the menu is open (CouchCoop._onPress).
  onPress(i) {
    const m = this.menu
    if (!m) {
      if (i === B_BACK) this.open('wheel')
      return
    }
    const rows = this._rows()
    if (i === UP) m.focus = Math.max(0, m.focus - 1)
    else if (i === DOWN) m.focus = Math.min(Math.max(0, rows.length - 1), m.focus + 1)
    else if (m.screen === 'shop' && (i === LEFT || i === RIGHT || i === B_LB || i === B_RB)) {
      const tabs = this.tabs()
      const at = Math.max(0, tabs.indexOf(m.tab))
      const dir = i === LEFT || i === B_LB ? -1 : 1
      m.tab = tabs[(at + dir + tabs.length) % tabs.length]
      m.focus = 0
    } else if (i === B_A) {
      const row = rows[m.focus]
      if (row && !row.off) row.act()
    } else if (i === B_B || i === B_BACK) {
      // Back up to the wheel, then closed. (The skin pick on joining just closes.)
      if (m.screen === 'wheel' || this._joinPick) this.close()
      else this.open('wheel')
      this._joinPick = false
      return
    }
    this.render()
  }

  // The rows the current screen shows: { name, detail, btn, off, act }.
  _rows() {
    const m = this.menu
    if (!m) return []
    if (m.screen === 'wheel') {
      return [
        { name: t('couchMenuPack'), act: () => this.open('pack') },
        { name: t('couchMenuShop'), act: () => this.open('shop') },
        { name: t('couchMenuSkin'), act: () => this.open('skin') },
      ]
    }
    if (m.screen === 'skin') return this._skinRows()
    if (m.screen === 'pack') return this._packRows()
    return this._shopRows(m.tab)
  }

  _skinRows() {
    const g = this.bm.game || {}
    return INVENTORY_SKINS.filter((s) => {
      try { return s.count(g) > 0 } catch { return false }
    }).map((s) => ({
      name: s.name || t(s.nameKey || ''),
      skin: s,
      btn: s.id === this.skinId ? t('couchEquipped') : t('couchEquip'),
      off: s.id === this.skinId,
      act: () => {
        this.skinId = s.id
        this.c.setSkin(s.dataUrl)
        if (this._joinPick) {
          this._joinPick = false
          this.close()
        }
      },
    }))
  }

  // Shown on joining when the account owns more than one skin.
  pickSkinOnJoin() {
    if (this._keptSkin || this._skinRows().length < 2) return
    this.open('skin')
    this._joinPick = true
    this.render()
  }

  // Every gun to pick, then the hotbar and the bag.
  _packRows() {
    const c = this.c
    const gun = this.hot.find((it) => it?.kind === 'gun') || this.bag.find((it) => it?.kind === 'gun')
    const rows = c.weapons.map((id, idx) => {
      const nameKey = this.bm.game?.weapons?.getSummary?.().find((w) => w.id === id)?.nameKey
      const held = gun?.id === id && this.holdingGun()
      return {
        name: nameKey ? t(nameKey) : id,
        detail: '',
        btn: held ? t('couchEquipped') : t('couchEquip'),
        off: held,
        act: () => this.equipGun(idx),
      }
    })
    const add = (where, list) => list.forEach((it, i) => {
      if (!it || it.kind === 'gun') return
      const def = this._useDef(it)
      const held = where === 'hot' && i === this.active
      rows.push({
        name: `${this.label(it)} ×${it.n}`,
        detail: def ? this._itemAbout(def) : it.kind === 'block' ? t('couchBlockTip') : '',
        btn: def ? t('couchUse') : held ? t('couchEquipped') : t('couchHold'),
        off: def ? !this._canUse(def) : held,
        act: () => (def ? this._useAt(list, i) : this.hold(where, i)),
      })
    })
    add('hot', this.hot)
    add('bag', this.bag)
    return rows
  }

  // What using an item does: one of Player 2's shop items, or food /
  // a health pack picked up (it heals). null: it's held, not used.
  _useDef(it) {
    if (it?.kind !== 'item') return null
    const own = P2_ITEMS.find((x) => x.id === it.id)
    if (own) return own
    const heal = ITEMS[it.id]?.heal
    return heal ? { id: it.id, health: heal, picked: true } : null
  }

  _itemAbout(item) {
    if (item.picked) return t('couchHeals', { n: item.health })
    return t(`campItem_${item.id}_about`, { n: item.health || item.armor || ammoFor(this.c._weaponId(), item.ammo) })
  }

  _canUse(item) {
    const p = this.c.p2
    if (item.health) return p.health < this.c.maxHealth
    if (item.armor) return this.armor < MAX_ARMOR
    if (item.ammo) return Number.isFinite(PLAY_WEAPONS[this.c._weaponId()]?.reserve)
    return false
  }

  // Uses one of list[i] (a hotbar slot or the bag).
  _useAt(list, i) {
    const it = list[i]
    const item = this._useDef(it)
    if (!item || !this._canUse(item)) return false
    const p = this.c.p2
    if (item.health) p.health = Math.min(this.c.maxHealth, p.health + item.health)
    if (item.armor) this.armor = Math.min(MAX_ARMOR, this.armor + item.armor)
    if (item.ammo) this.c._ammo().reserve += ammoFor(this.c._weaponId(), item.ammo)
    this._takeFrom(list, i)
    try { audioEngine.playUi?.('click') } catch { /* no audio */ }
    return true
  }

  // Right trigger with an item held.
  useHeld() {
    return this._useAt(this.hot, this.active)
  }

  // D-pad down: throw one of the held thing in front (not the gun, and not
  // Player 2's own shop items - those are only for using).
  dropHeld() {
    const it = this.held()
    const drops = this.s._drops
    if (!it || !drops || this.s.dead) return false
    if (it.kind === 'gun') {
      this.c.p2Message(t('invDropGun'))
      return false
    }
    if (it.kind === 'item' && (P2_ITEMS.some((x) => x.id === it.id) || !ITEMS[it.id])) {
      this.c.p2Message(t('couchNoDrop'))
      return false
    }
    const p = this.c.p2
    const toss = { dx: -Math.sin(p.yaw), dz: -Math.cos(p.yaw) }
    const x = p.x + toss.dx * 0.6
    const y = p.y + 1.1
    const z = p.z + toss.dz * 0.6
    const ok = it.kind === 'block' ? drops.spawn(it.id, x, y, z, toss, false) : drops.spawnItem(it.id, x, y, z, toss, false)
    if (!ok) return false
    this._takeFrom(this.hot, this.active)
    return true
  }

  _shopRows(tab) {
    const iron = !!this.s.cfg?.ironMode && (tab === 'items' || tab === 'upgrades')
    const rows = []
    if (iron) rows.push({ name: t('campIronMode'), off: true, note: true, act: () => {} })
    if (tab === 'items') {
      for (const item of P2_ITEMS) {
        const cost = this._price(item)
        rows.push({ name: t(`campItem_${item.id}`), detail: this._itemAbout(item), btn: t('campBuy', { n: cost }), off: iron || this.coins < cost, act: () => this._buy(item) })
      }
    } else if (tab === 'traps' || tab === 'towers') {
      for (const trap of tab === 'traps' ? SHOP_TRAPS : SHOP_TOWERS) {
        const cost = this._price(trap)
        rows.push({ name: `${this.bm.blockName?.(trap.id) || trap.id} ×${trap.n}`, detail: t(`shopTrap_${trap.id}`), btn: t('campBuy', { n: cost }), off: this.coins < cost, act: () => this._buyBlocks(trap) })
      }
    } else if (tab === 'upgrades') {
      for (const up of UPGRADES) {
        const level = this.upgrades[up.id] || 0
        const cost = this._upCost(up)
        const maxed = cost === undefined
        rows.push({ name: `${t(`campUp_${up.id}`)} ${t('campLevel', { n: level, max: up.costs.length })}`, detail: t(`campUp_${up.id}_about`), btn: maxed ? t('campMaxed') : t('campBuy', { n: cost }), off: iron || maxed || this.coins < cost, act: () => this._upgrade(up) })
      }
    } else if (tab === 'ammo') {
      const wait = Math.max(0, Math.ceil(this._ammoReadyAt - performance.now() / 1000))
      rows.push({ name: t('campFillUp'), detail: t('campFillUp_about', { s: AMMO_FILL_COOLDOWN }), btn: wait ? t('campWait', { s: wait }) : t('campFree'), off: wait > 0, act: () => this._fill() })
    } else if (tab === 'quests') {
      const active = this._activeQuests()
      if (!active.length) rows.push({ name: t('campQuestsAllDone'), off: true, note: true, act: () => {} })
      for (const q of active) {
        const have = Math.min(q.goal, this._statValue(q.stat))
        const done = have >= q.goal
        rows.push({ name: t(`campQuest_${q.stat}`, { n: q.goal }), detail: `${have} / ${q.goal} · ${t('campReward', { n: q.reward })}`, btn: done ? t('campClaim') : t('campNotYet'), off: !done, act: () => this._claim(q) })
      }
    }
    return rows
  }

  _buy(item) {
    const cost = this._price(item)
    if (this.s.cfg?.ironMode || this.coins < cost) return
    if (this.add({ kind: 'item', id: item.id, n: 1 }) > 0) {
      this.c.p2Message(t('invFull'))
      return
    }
    this.coins -= cost
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  }

  // A pack of traps (or Tower Defense towers): blocks to place.
  _buyBlocks(trap) {
    const cost = this._price(trap)
    if (this.coins < cost) return
    const left = this.add({ kind: 'block', id: trap.id, n: trap.n })
    // No room for any of it: nothing bought. Some: the rest is lost, like
    // Player 1's full inventory.
    if (left >= trap.n) {
      this.c.p2Message(t('invFull'))
      return
    }
    this.coins -= cost
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  }

  // The Shop's tabs (Tower Defense puts Towers first, like Player 1's).
  tabs() {
    return this.s.td ? ['towers', ...P2_TABS] : P2_TABS
  }

  _upgrade(up) {
    const cost = this._upCost(up)
    if (this.s.cfg?.ironMode || cost === undefined || this.coins < cost) return
    this.coins -= cost
    this.upgrades[up.id]++
    // A bigger magazine shows straight away; a smaller cap never overfills.
    const a = this.c._ammo()
    a.mag = Math.min(a.mag, this.magSize(this.c._weapon()))
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  }

  _fill() {
    const now = performance.now() / 1000
    if (now < this._ammoReadyAt) return
    this._ammoReadyAt = now + AMMO_FILL_COOLDOWN
    const w = this.c._weapon()
    const a = this.c._ammo()
    const size = this.magSize(w)
    if (!Number.isFinite(size)) return
    a.mag = size
    a.reserve = Math.max(a.reserve, size * 5)
  }

  _claim(q) {
    if (q.claimed || this._statValue(q.stat) < q.goal) return
    q.claimed = true
    this.earn(q.reward)
  }

  // ---------- Drawing (inside #couch-p2) ----------

  // Every frame: only rebuilt when something shown changed.
  render() {
    const el = this.c.hud?.querySelector('#couch-menu')
    if (!el) return
    const m = this.menu
    if (!m) {
      if (this._key !== 'closed') el.style.display = 'none'
      this._key = 'closed'
      return
    }
    const rows = this._rows()
    m.focus = Math.min(m.focus, Math.max(0, rows.length - 1))
    const key = [m.screen, m.tab, m.focus, this.coins, ...rows.map((r) => `${r.name}|${r.detail}|${r.btn}|${r.off}`)].join('~')
    if (key === this._key) return
    this._key = key
    el.style.display = ''
    const title = m.screen === 'wheel' ? t('couchPlayer2') : m.screen === 'shop' ? t('shopTitle') : m.screen === 'pack' ? t('couchMenuPack') : t('couchPickSkin')
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
    const tabs = m.screen === 'shop' ? `<div class="couch-menu-tabs">${this.tabs().map((tab) => `<span class="play-shop-tab${tab === m.tab ? ' active' : ''}">${esc(t(`shopTab_${tab}`))}</span>`).join('')}</div>` : ''
    const list = rows.length
      ? rows.map((r, i) => r.note
        ? `<p class="play-npc-empty">${esc(r.name)}</p>`
        : `<div class="play-npc-row couch-row${i === m.focus ? ' focus' : ''}${r.off ? ' off' : ''}">${r.skin ? `<img class="couch-skin-icon" alt="" data-skin="${esc(r.skin.id)}">` : ''}<div class="play-npc-info"><b>${esc(r.name)}</b>${r.detail ? `<span>${esc(r.detail)}</span>` : ''}</div>${r.btn ? `<span class="couch-row-btn">${esc(r.btn)}</span>` : ''}</div>`).join('')
      : `<p class="play-npc-empty">${esc(t('couchPackEmpty'))}</p>`
    el.innerHTML = `<div class="build-share-box">
      <h2>${esc(title)}</h2>
      <p class="couch-menu-coins">${esc(t('campCoins', { n: money(this.bm.game?.settings, this.coins) }))}</p>
      ${tabs}
      <div class="couch-menu-list">${list}</div>
      <p class="couch-menu-hint">${esc(m.screen === 'shop' ? t('couchMenuHintTabs') : t('couchMenuHint'))}</p>
    </div>`
    // Skin pictures: the flat front view (cached).
    for (const img of el.querySelectorAll('img[data-skin]')) {
      const skin = INVENTORY_SKINS.find((s) => s.id === img.dataset.skin)
      if (skin?.dataUrl) skinFrontIconURL(skin.dataUrl).then((url) => { if (url) img.src = url }).catch(() => {})
    }
    el.querySelector('.couch-row.focus')?.scrollIntoView?.({ block: 'nearest' })
  }

  // Player 2's hotbar along the bottom of their half (#couch-p2-hotbar):
  // only rebuilt when it changes.
  renderHotbar() {
    const el = this.c.hud?.querySelector('#couch-p2-hotbar')
    if (!el) return
    const key = [this.active, ...this.hot.map((it) => (it ? `${it.kind}:${it.id}:${it.n}` : ''))].join('|')
    if (key === this._hotKey) return
    this._hotKey = key
    el.innerHTML = this.hot.map((it, i) => {
      const icon = this.icon(it)
      const label = this.label(it).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch])
      const count = it && it.n > 1 ? `<span class="inv-slot-count">${it.n}</span>` : ''
      return `<div class="couch-hot-slot${i === this.active ? ' selected' : ''}"${it ? ` aria-label="${label}"` : ''}>${icon ? `<img src="${icon}" alt="" draggable="false">` : ''}${count}</div>`
    }).join('')
  }

  // The results screen's line about Player 2 (guest: shown, not saved).
  resultsLine() {
    return t('couchP2Results', { kills: this.kills, coins: money(this.bm.game?.settings, this.coins) })
  }
}

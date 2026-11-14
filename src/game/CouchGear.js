// Couch Co-op's equal Player 2 (2026-11-14, Batch 4c-2a). Picked on the
// homepage's Couch Co-op tag ("Buddy or Equal?"); CouchCoop.js makes one of
// these when it's Equal. Player 2 then has their own:
//   - coins: their own kills and every cleared wave pay into them;
//   - Shop (Items, Upgrades, Ammo, Quests) - like PlayShop.js, with
//     Player 2's own upgrades and quests. Traps wait for building (4c-2b);
//   - Backpack: their guns and what they bought (Med Kits, Armor, Ammo
//     Boxes) - A on one holds the gun or uses the item;
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
export const P2_TABS = ['items', 'upgrades', 'ammo', 'quests']
const ITEM_STACK = 99
const MAX_ARMOR = 100

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
    // Bought things: { id, n } (ids from SHOP_ITEMS).
    this.pack = []
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
    this.menu = { screen, tab: this.menu?.tab || 'items', focus: 0 }
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
      const at = P2_TABS.indexOf(m.tab)
      const dir = i === LEFT || i === B_LB ? -1 : 1
      m.tab = P2_TABS[(at + dir + P2_TABS.length) % P2_TABS.length]
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

  _packRows() {
    const c = this.c
    const rows = c.weapons.map((id, idx) => {
      const nameKey = this.bm.game?.weapons?.getSummary?.().find((w) => w.id === id)?.nameKey
      const held = idx === c.p2.weaponIdx
      return {
        name: nameKey ? t(nameKey) : id,
        detail: '',
        btn: held ? t('couchEquipped') : t('couchEquip'),
        off: held,
        act: () => c.holdWeapon(idx),
      }
    })
    for (const it of this.pack) {
      const item = P2_ITEMS.find((x) => x.id === it.id)
      if (!item) continue
      rows.push({
        name: `${t(`campItem_${it.id}`)} ×${it.n}`,
        detail: this._itemAbout(item),
        btn: t('couchUse'),
        off: !this._canUse(item),
        act: () => this._use(it.id),
      })
    }
    return rows
  }

  _itemAbout(item) {
    return t(`campItem_${item.id}_about`, { n: item.health || item.armor || ammoFor(this.c._weaponId(), item.ammo) })
  }

  _canUse(item) {
    const p = this.c.p2
    if (item.health) return p.health < this.c.maxHealth
    if (item.armor) return this.armor < MAX_ARMOR
    if (item.ammo) return Number.isFinite(PLAY_WEAPONS[this.c._weaponId()]?.reserve)
    return false
  }

  _use(id) {
    const at = this.pack.findIndex((x) => x.id === id)
    const item = P2_ITEMS.find((x) => x.id === id)
    if (at < 0 || !item || !this._canUse(item)) return
    const p = this.c.p2
    if (item.health) p.health = Math.min(this.c.maxHealth, p.health + item.health)
    if (item.armor) this.armor = Math.min(MAX_ARMOR, this.armor + item.armor)
    if (item.ammo) this.c._ammo().reserve += ammoFor(this.c._weaponId(), item.ammo)
    if (--this.pack[at].n <= 0) this.pack.splice(at, 1)
    try { audioEngine.playUi?.('click') } catch { /* no audio */ }
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
    let slot = this.pack.find((x) => x.id === item.id)
    if (slot && slot.n >= ITEM_STACK) return
    this.coins -= cost
    if (!slot) this.pack.push((slot = { id: item.id, n: 0 }))
    slot.n++
    try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
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
    const tabs = m.screen === 'shop' ? `<div class="couch-menu-tabs">${P2_TABS.map((tab) => `<span class="play-shop-tab${tab === m.tab ? ' active' : ''}">${esc(t(`shopTab_${tab}`))}</span>`).join('')}</div>` : ''
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

  // The results screen's line about Player 2 (guest: shown, not saved).
  resultsLine() {
    return t('couchP2Results', { kills: this.kills, coins: money(this.bm.game?.settings, this.coins) })
  }
}

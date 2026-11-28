// The Shop (2026-11-01, Gaymi: "when press b it will open a shop ... move
// the npc in camp to b when you press b you can use all those features").
// Owned by BuildSurvival (`survival.shop`) in every Zombie Survival game,
// on every map. Press the Shop key (B, Settings > Controls) - or the cart
// touch button on a phone - and one panel holds everything the Map 3 camp
// people used to sell, plus traps:
//   - Items: Med Kit, Armor, an Ammo Box and a Fishing Rod (Fishing.js).
//   - Traps: the trap packs a cleared wave used to hand out for free
//     (Gaymi picked "shop only" - chests can still have one).
//   - Upgrades: Damage, Reload Speed and Bigger Magazine, three levels each.
//   - Ammo: fills your gun and spare ammo for free, then needs a short
//     rest (AMMO_FILL_COOLDOWN).
//   - Towers (Tower Defense only, TowerDefense.js): Auto Turrets,
//     Cannons and Catapults to put down beside the zombies' path.
//   - Quests: up to three at a time (kill zombies, open chests, headshots,
//     reach a wave); finished ones are claimed here for coins and the next
//     one takes their place.
// The camp's four people (BuildCamp.js) still stand there; talking to one
// opens this shop on their tab.
//   - Ring (spin ring games only, 2026-11-15, Batch 3 of the spin ring
//     plan): ring items for Points (kept forever, not this game's coins) -
//     pick an item, then a rarity. Common, Uncommon and Rare are always for
//     sale (buy 1, 5 or a Custom amount); Epic and up only some days, one
//     each (RingItems.stockOf). Also the Mystery Box and more ring slots
//     (3 -> 10). It's the only tab in Spectate (the ring keeps going).
// Coins come from kills (COIN_PER_KILL) and cleared waves (COIN_PER_WAVE),
// and only last for that game of Play.
import { money } from './SocialSettings.js'
import { ammoFor } from './PlayWeapons.js'
import { t } from './i18n.js'
import { ROD_COST } from './Fishing.js'
import { NET_COST, jarsIn, sellJars } from './BugNet.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { tune } from './LiveConfig.js'
import { audioEngine } from './Audio.js'
import { saveMetaProgress } from './MetaProgress.js'
import { ITEM_IDS, RARITIES, ICONS, MAX_SLOTS, BOX_COST, ALWAYS_STOCKED, parseKey, itemStats, shopPrice, stockOf, markBought, rollBox, addToBag, ringSlots, nextSlotCost, fitLoadout, saveLoadout, rarityColor, rarityIndex, todayKey } from './RingItems.js'
import { itemLabel } from './SpinRing.js'

// The Ring tab's amount picker (Common to Rare): 1, 5 or Custom (1-99).
const RING_QTYS = ['1', '5', 'custom']
const RING_QTY_MAX = 99

// Settings > Gameplay > Confirm Buying Over: the first click turns the
// button into "Sure? N" for this long; a second click buys.
const SURE_MS = 3000

export const AMMO_FILL_COOLDOWN = 30
export const SHOP_ITEMS = [
  { id: 'medkit', cost: 40, health: 50 },
  { id: 'armor', cost: 75, armor: 50 },
  { id: 'ammobox', cost: 25, ammo: 60 },
  // Goes in the inventory (PlayInventory ITEMS).
  { id: 'fishingRod', cost: ROD_COST, item: 'fishingRod' },
  // The Bug Net (BugNet.js) - Player 1's only (not Couch Co-op's shop).
  { id: 'bugNet', cost: NET_COST, item: 'bugNet', p1Only: true },
]
// Trap packs (SpecialBlocks.js blocks): [block, how many, coins].
export const SHOP_TRAPS = [
  { id: 'spikeblock', n: 4, cost: 30 },
  { id: 'beartrap', n: 2, cost: 35 },
  { id: 'landmine', n: 2, cost: 45 },
  { id: 'explosivebarrel', n: 3, cost: 40 },
  { id: 'baitblock', n: 1, cost: 20 },
]
// Tower Defense's towers (TowerDefense.js): [block, how many, coins].
export const SHOP_TOWERS = [
  { id: 'autoturret', n: 1, cost: 60 },
  { id: 'cannonblock', n: 1, cost: 120 },
  { id: 'catapult', n: 1, cost: 150 },
]
export const UPGRADES = [
  { id: 'damage', costs: [120, 240, 400] },
  { id: 'reload', costs: [100, 200, 350] },
  { id: 'mag', costs: [90, 180, 300] },
]
export const CAMP_QUESTS = [
  { id: 'kill15', stat: 'kills', goal: 15, reward: 100 },
  { id: 'chest3', stat: 'chests', goal: 3, reward: 60 },
  { id: 'head10', stat: 'headshots', goal: 10, reward: 150 },
  { id: 'wave5', stat: 'wave', goal: 5, reward: 250 },
  { id: 'kill50', stat: 'kills', goal: 50, reward: 300 },
  { id: 'wave10', stat: 'wave', goal: 10, reward: 600 },
]
const QUESTS_SHOWN = 3
export const SHOP_TABS = ['items', 'traps', 'upgrades', 'ammo', 'quests']
// The camp person -> their tab.
const NPC_TAB = { trader: 'items', upgrader: 'upgrades', ammo: 'ammo', quest: 'quests' }

export class PlayShop {
  constructor(survival) {
    this.s = survival
    this.panelOpen = false
    this.tab = 'items'
    this._ringPick = ITEM_IDS[0]
    this._ringQty = '1'
    this._ringCustom = 10
    this._ringLast = ''
    this.reset()
  }

  get bm() {
    return this.s.bm
  }

  // A new game: quests from the start, the ammo refill ready.
  reset() {
    this.closePanel(false)
    this.tab = this.s.td ? 'towers' : this.s.ring ? 'ring' : 'items'
    this._ringLast = ''
    this.quests = CAMP_QUESTS.map((q) => ({ ...q, claimed: false }))
    this._notified = new Set()
    this._ammoReadyAt = 0
  }

  // --- quests ---

  _statValue(stat) {
    if (stat === 'wave') return this.s.wave
    return this.s.stats[stat] || 0
  }

  activeQuests() {
    return this.quests.filter((q) => !q.claimed).slice(0, QUESTS_SHOWN)
  }

  // After anything that can finish a quest: a note the first time.
  checkQuests() {
    for (const q of this.activeQuests()) {
      if (this._statValue(q.stat) >= q.goal && !this._notified.has(q.id)) {
        this._notified.add(q.id)
        this.s._message(t('campQuestDone'))
      }
    }
  }

  // --- the panel ---

  // The Shop key: open, or close if it's open.
  toggle() {
    if (this.panelOpen) return this.closePanel()
    // Spectate: only the Ring tab (spin ring games), nothing else.
    if (!this.s.active || this.s.dead || (this.s.spectating && !this.s.ring)) return
    this.openPanel()
  }

  // npcId: a camp person was talked to - open on their tab. tab: open on
  // that tab (the Ring Bag's Shop button opens 'ring').
  openPanel(npcId = '', tab = '') {
    if (!this.s.active || this.s.dead) return
    this._ensureDom()
    if (NPC_TAB[npcId]) this.tab = NPC_TAB[npcId]
    if (tab) this.tab = tab
    if (!this.tabs().includes(this.tab)) this.tab = this.tabs()[0]
    this.panelOpen = true
    this._panelKey = ''
    this.bm._keys.clear()
    if (document.pointerLockElement) document.exitPointerLock()
    this._panel.style.display = 'flex'
    this._renderPanel()
  }

  closePanel(relock = true) {
    if (!this.panelOpen) return
    this.panelOpen = false
    this._panel.style.display = 'none'
    if (relock) {
      try { this.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
    }
  }

  // Every frame (BuildSurvival): quest notes, and the open panel's numbers.
  update() {
    this.checkQuests()
    if (this.panelOpen && (!this.s.active || this.s.dead)) this.closePanel(false)
    if (this.panelOpen) this._renderPanel()
  }

  _ensureDom() {
    this._panel = document.getElementById('play-npc-panel')
    if (!this._panel) {
      this._panel = document.createElement('div')
      this._panel.id = 'play-npc-panel'
      this._panel.style.display = 'none'
      // GayZ panel style: a red X in the top corner, and a click anywhere
      // outside the box closes it too (2026-10-05).
      this._panel.innerHTML = `<div class="build-share-box">
        <button type="button" id="play-npc-close" class="panel-close-btn">&times;</button>
        <h2 id="play-npc-title"></h2>
        <p id="play-npc-coins"></p>
        <div id="play-shop-tabs" role="tablist"></div>
        <div id="play-npc-list"></div>
      </div>`
      document.body.appendChild(this._panel)
    }
    this._panel.onclick = (e) => {
      if (!e.target.closest('.build-share-box')) return this.closePanel()
      const tab = e.target.closest('[data-shop-tab]')
      if (tab) {
        this.tab = tab.dataset.shopTab
        this._panelKey = ''
        this._renderPanel()
        return
      }
      const btn = e.target.closest('button[data-act]')
      if (btn && !btn.disabled) this._click(btn.dataset.act, btn.dataset.id)
    }
    this._panel.querySelector('#play-npc-close').onclick = () => this.closePanel()
    // The Ring tab's Custom amount: kept when you finish typing.
    this._panel.onchange = (e) => {
      if (e.target.id !== 'ring-shop-qty') return
      this._ringCustom = Math.max(1, Math.min(RING_QTY_MAX, Math.floor(Number(e.target.value) || 1)))
      this._panelKey = ''
      this._renderPanel()
    }
    // Typing a number never moves you or opens anything behind the panel.
    this._panel.onkeydown = (e) => {
      if (e.target.id === 'ring-shop-qty') e.stopPropagation()
    }
  }

  _renderPanel() {
    const s = this.s
    if (!this.tabs().includes(this.tab)) this.tab = this.tabs()[0]
    const id = this.tab
    if (id === 'ring') return this._renderRing()
    const now = performance.now() / 1000
    const ammoWait = Math.max(0, Math.ceil(this._ammoReadyAt - now))
    // Only redraw when something shown changed (it's called every frame).
    const sure = this._sureNow()
    const key = [id, s.coins, s.health, s.armor, s.mag, s.reserve, JSON.stringify(s.upgrades), ammoWait, sure ? `${sure.act}:${sure.id}` : '', this.quests.map((q) => q.claimed).join(), this.activeQuests().map((q) => this._statValue(q.stat)).join()].join('|')
    if (key === this._panelKey) return
    this._panelKey = key
    const set = (sel, text) => {
      const el = this._panel.querySelector(sel)
      if (el) el.textContent = text
    }
    set('#play-npc-title', t('shopTitle'))
    set('#play-npc-coins', t('campCoins', { n: money(this.bm.game?.settings, s.coins) }))
    this._panel.querySelector('#play-npc-close').setAttribute('aria-label', t('communityBuildsCloseBtn'))
    this._panel.querySelector('#play-shop-tabs').innerHTML = this.tabs().map((tab) => `<button type="button" role="tab" class="play-shop-tab${tab === id ? ' active' : ''}" data-shop-tab="${tab}" aria-selected="${tab === id}">${t(`shopTab_${tab}`)}</button>`).join('')
    const rows = []
    const row = (name, detail, btnText, act, itemId, disabled) => {
      const asking = !disabled && sure?.act === act && sure.id === itemId
      if (asking) btnText = t('buyConfirmSure', { n: this._costOf(act, itemId) })
      return `<div class="play-npc-row"><div class="play-npc-info"><b>${name}</b><span>${detail}</span></div><button type="button" data-act="${act}" data-id="${itemId}"${asking ? ' class="buy-sure"' : ''} ${disabled ? 'disabled' : ''}>${btnText}</button></div>`
    }
    const buying = id === 'items' || id === 'traps' || id === 'towers' || id === 'upgrades'
    // Iron Mode (a Game Mode mutator): no buying in the shop.
    const iron = !!s.cfg?.ironMode && buying
    if (iron) rows.push(`<p class="play-npc-empty">${t('campIronMode')}</p>`)
    // Settings > General > Low Coins Reminder: say so when nothing here is
    // affordable yet.
    if (!iron && buying && this.bm.game?.settings?.lowCurrencyReminder !== false) {
      const costs = id === 'items' ? SHOP_ITEMS.map((item) => this._price(item)) : id === 'traps' || id === 'towers' ? (id === 'traps' ? SHOP_TRAPS : SHOP_TOWERS).map((trap) => this._price(trap)) : UPGRADES.map((up) => this._upCost(up, s.upgrades[up.id] || 0)).filter((c) => c !== undefined)
      if (costs.length && s.coins < Math.min(...costs)) rows.push(`<p class="play-npc-empty">${t('campLowCoins', { n: s.coins })}</p>`)
    }
    if (id === 'items') {
      for (const item of SHOP_ITEMS) {
        const cost = this._price(item)
        rows.push(row(t(`campItem_${item.id}`), t(`campItem_${item.id}_about`, { n: item.health || item.armor || ammoFor(s.weaponId, item.ammo) }), t('campBuy', { n: cost }), 'buy', item.id, iron || s.coins < cost))
      }
      // Bug Jars from the Bug Net (BugNet.js) are sold here (Iron Mode too).
      const jars = jarsIn(s.inv)
      rows.push(row(t('bugSellTitle'), jars.count ? t('bugSellAbout', { n: jars.count }) : t('bugSellNone'), t('bugSellBtn', { n: Math.round(jars.coins * s._coinMult()) }), 'sellBugs', 'jars', !jars.count))
    } else if (id === 'traps' || id === 'towers') {
      for (const trap of id === 'traps' ? SHOP_TRAPS : SHOP_TOWERS) {
        const cost = this._price(trap)
        rows.push(row(`${this.bm.blockName(trap.id)} ×${trap.n}`, t(`shopTrap_${trap.id}`), t('campBuy', { n: cost }), 'trap', trap.id, iron || s.coins < cost))
      }
    } else if (id === 'upgrades') {
      for (const up of UPGRADES) {
        const level = s.upgrades[up.id] || 0
        const maxed = level >= up.costs.length
        rows.push(row(`${t(`campUp_${up.id}`)} ${t('campLevel', { n: level, max: up.costs.length })}`, t(`campUp_${up.id}_about`), maxed ? t('campMaxed') : t('campBuy', { n: this._upCost(up, level) }), 'upgrade', up.id, iron || maxed || s.coins < this._upCost(up, level)))
      }
    } else if (id === 'ammo') {
      rows.push(row(t('campFillUp'), t('campFillUp_about', { s: AMMO_FILL_COOLDOWN }), ammoWait ? t('campWait', { s: ammoWait }) : t('campFree'), 'fill', 'fill', ammoWait > 0))
    } else if (id === 'quests') {
      const active = this.activeQuests()
      if (!active.length) rows.push(`<p class="play-npc-empty">${t('campQuestsAllDone')}</p>`)
      for (const q of active) {
        const have = Math.min(q.goal, this._statValue(q.stat))
        const done = have >= q.goal
        rows.push(row(t(`campQuest_${q.stat}`, { n: q.goal }), `${have} / ${q.goal} · ${t('campReward', { n: q.reward })}`, done ? t('campClaim') : t('campNotYet'), 'claim', q.id, !done))
      }
    }
    // Every piece of text here is the game's own (i18n) plus numbers.
    this._panel.querySelector('#play-npc-list').innerHTML = rows.join('')
  }

  // The tabs: Towers first in Tower Defense; Ring in spin ring games (and
  // only Ring while you spectate).
  tabs() {
    if (this.s.ring && this.s.spectating) return ['ring']
    const ring = this.s.ring ? ['ring'] : []
    return this.s.td ? ['towers', ...ring, ...SHOP_TABS] : [...ring, ...SHOP_TABS]
  }

  // --- the Ring tab (Batch 3) ---

  get points() {
    return Math.max(0, Math.floor(Number(this.bm.game?.metaProgress?.legacyPoints) || 0))
  }

  _spendPoints(cost) {
    const meta = this.bm.game?.metaProgress
    if (!meta || this.points < cost) return false
    meta.legacyPoints -= cost
    saveMetaProgress(meta)
    return true
  }

  // How many one Buy click gets (Common to Rare; rarer ones are one each).
  _ringQtyFor(key) {
    const p = parseKey(key)
    if (!p || rarityIndex(p.rarity) >= ALWAYS_STOCKED) return 1
    return this._ringQty === 'custom' ? this._ringCustom : Number(this._ringQty)
  }

  _ringCost(act, id) {
    if (act === 'ringBuy') return shopPrice(parseKey(id)?.rarity) * this._ringQtyFor(id)
    if (act === 'ringBox') return BOX_COST
    if (act === 'ringSlot') return nextSlotCost() || 0
    return 0
  }

  _renderRing() {
    const day = todayKey()
    const slots = ringSlots()
    const sure = this._sureNow()
    const stocks = RARITIES.map((r) => stockOf(`${this._ringPick}:${r}`, day)).join()
    const key = ['ring', this.points, slots, this._ringPick, this._ringQty, this._ringCustom, this._ringLast, stocks, sure ? `${sure.act}:${sure.id}` : '', this.tabs().join()].join('|')
    if (key === this._panelKey) return
    this._panelKey = key
    const q = (sel) => this._panel.querySelector(sel)
    q('#play-npc-title').textContent = t('shopTitle')
    q('#play-npc-coins').textContent = t('legacyScrapLabel', { n: this.points.toLocaleString() })
    q('#play-npc-close').setAttribute('aria-label', t('communityBuildsCloseBtn'))
    q('#play-shop-tabs').innerHTML = this.tabs().map((tab) => `<button type="button" role="tab" class="play-shop-tab${tab === 'ring' ? ' active' : ''}" data-shop-tab="${tab}" aria-selected="${tab === 'ring'}">${t(`shopTab_${tab}`)}</button>`).join('')
    const pts = (n) => t('ringShopPoints', { n: n.toLocaleString() })
    const row = (name, detail, btnText, act, itemId, disabled, extra = '') => {
      const asking = !disabled && sure?.act === act && sure.id === itemId
      if (asking) btnText = t('buyConfirmSure', { n: pts(this._ringCost(act, itemId)) })
      return `<div class="play-npc-row${extra}"><div class="play-npc-info"><b>${name}</b><span>${detail}</span></div><button type="button" data-act="${act}" data-id="${itemId}"${asking ? ' class="buy-sure"' : ''} ${disabled ? 'disabled' : ''}>${btnText}</button></div>`
    }
    const rows = [`<p class="ring-shop-note">${t('ringShopNote')}</p>`]
    // More slots.
    const slotCost = nextSlotCost(slots)
    rows.push(row(t('ringShopSlots', { n: slots, max: MAX_SLOTS }), slotCost ? t('ringShopSlotsAbout', { n: slots + 1 }) : t('ringShopSlotsMaxed'), slotCost ? pts(slotCost) : t('campMaxed'), 'ringSlot', 'slot', !slotCost || this.points < slotCost))
    // The Mystery Box (and what the last one gave).
    const last = this._ringLast ? `<br><span class="ring-shop-got">${t('ringBoxGot', { name: itemLabel(this._ringLast) })}</span>` : ''
    rows.push(row(t('ringBox'), t('ringBoxAbout') + last, pts(BOX_COST), 'ringBox', 'box', this.points < BOX_COST))
    // Pick an item...
    rows.push(`<div class="ring-shop-items" role="group" aria-label="${t('ringShopPick')}">${ITEM_IDS.map((id) => `<button type="button" class="ring-shop-item${id === this._ringPick ? ' picked' : ''}" data-act="ringPick" data-id="${id}" aria-pressed="${id === this._ringPick}" title="${t(itemStats(id, 'common').nameKey)}" aria-label="${t(itemStats(id, 'common').nameKey)}">${ICONS[id] || ''}</button>`).join('')}</div>`)
    rows.push(`<p class="ring-shop-about"><b>${t(itemStats(this._ringPick, 'common').nameKey)}</b> - ${t(itemStats(this._ringPick, 'common').aboutKey)}</p>`)
    // ...how many (Common to Rare)...
    const custom = this._ringQty === 'custom'
    rows.push(`<div class="ring-shop-qty" role="group" aria-label="${t('ringShopQty')}"><span>${t('ringShopQty')}</span>${RING_QTYS.map((v) => `<button type="button" class="play-shop-tab${v === this._ringQty ? ' active' : ''}" data-act="ringQty" data-id="${v}" aria-pressed="${v === this._ringQty}">${v === 'custom' ? t('ringShopCustom') : `×${v}`}</button>`).join('')}${custom ? `<input id="ring-shop-qty" type="number" inputmode="numeric" min="1" max="${RING_QTY_MAX}" value="${this._ringCustom}" aria-label="${t('ringShopCustom')}">` : ''}</div>`)
    // ...and a rarity.
    for (const r of RARITIES) {
      const k = `${this._ringPick}:${r}`
      const st = stockOf(k, day)
      const n = this._ringQtyFor(k)
      const cost = shopPrice(r) * n
      const out = st === 'none' || st === 'sold'
      const name = `<span style="color:${rarityColor(r)}">${itemLabel(k)}</span>${n > 1 ? ` ×${n}` : ''}`
      rows.push(row(name, t(`ringStock_${st}`), out ? t('ringShopSoldOut') : pts(cost), 'ringBuy', k, out || this.points < cost, ' ring-shop-row'))
    }
    q('#play-npc-list').innerHTML = rows.join('')
  }

  _ringAct(act, id) {
    const s = this.s
    if (act === 'ringPick') {
      if (ITEM_IDS.includes(id)) this._ringPick = id
    } else if (act === 'ringQty') {
      if (RING_QTYS.includes(id)) this._ringQty = id
    } else if (act === 'ringSlot') {
      const cost = nextSlotCost()
      const meta = this.bm.game?.metaProgress
      if (!cost || !meta || !this._spendPoints(cost)) return
      meta.ringSlotsBought = (meta.ringSlotsBought || 0) + 1
      saveMetaProgress(meta)
      if (s.ring) {
        const keys = fitLoadout(s.ring.keys)
        saveLoadout(keys)
        s.ring.setLoadout(keys)
      }
      s._message(t('ringSlotBought', { n: ringSlots() }), 2.5)
      try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
    } else if (act === 'ringBox') {
      if (!this._spendPoints(BOX_COST)) return
      const key = rollBox()
      addToBag(key)
      this._ringLast = key
      const rare = rarityIndex(parseKey(key).rarity) >= 2
      s._message(t(rare ? 'ringLootRare' : 'ringLootGot', { name: itemLabel(key) }), rare ? 3 : 1.5)
      try { audioEngine.playUi?.('unbox') } catch { /* no audio */ }
    } else if (act === 'ringBuy') {
      const p = parseKey(id)
      const st = stockOf(id)
      if (!p || st === 'none' || st === 'sold') return
      const n = this._ringQtyFor(id)
      if (!this._spendPoints(shopPrice(p.rarity) * n)) return
      addToBag(id, n)
      if (st === 'today') markBought(id)
      s._message(t('ringLootGot', { name: `${itemLabel(id)}${n > 1 ? ` ×${n}` : ''}` }), 1.5)
      try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
    }
    s.ringEditor?.refresh()
    this._panelKey = ''
    if (this.panelOpen) this._renderPanel()
  }

  // A price after the Trader Discount upgrade (PlayRules.js) and the
  // team's live Shop Prices tuning (LiveConfig.js tune).
  _price(item) {
    return Math.round(item.cost * (1 - (this.s.cfg?.discount || 0)) * tune('shopPrices'))
  }

  // An upgrade's next level price (undefined once maxed), with the live
  // Shop Prices tuning.
  _upCost(up, level) {
    const c = up.costs[level]
    return c === undefined ? undefined : Math.max(1, Math.round(c * tune('shopPrices')))
  }

  // What a buy button costs (0 for free ones: ammo fill, quest claims).
  _costOf(act, id) {
    const s = this.s
    if (act.startsWith('ring')) return this._ringCost(act, id)
    if (act === 'buy') {
      const item = SHOP_ITEMS.find((i) => i.id === id)
      return item ? this._price(item) : 0
    }
    if (act === 'trap') {
      const trap = [...SHOP_TRAPS, ...(s.td ? SHOP_TOWERS : [])].find((x) => x.id === id)
      return trap ? this._price(trap) : 0
    }
    if (act === 'upgrade') {
      const up = UPGRADES.find((u) => u.id === id)
      return (up && this._upCost(up, s.upgrades[id] || 0)) || 0
    }
    return 0
  }

  _sureNow() {
    return this._sure && performance.now() < this._sure.until ? this._sure : null
  }

  _click(act, id) {
    const cost = this._costOf(act, id)
    const sure = this._sureNow()
    if (cost > 0 && needsBuyConfirm(this.bm.game?.settings, cost) && !(sure?.act === act && sure.id === id)) {
      this._sure = { act, id, until: performance.now() + SURE_MS }
      clearTimeout(this._sureTimer)
      this._sureTimer = setTimeout(() => { if (this.panelOpen) this._renderPanel() }, SURE_MS + 50)
      this._renderPanel()
      return
    }
    this._sure = null
    this._act(act, id)
  }

  _act(act, id) {
    const s = this.s
    if (act.startsWith('ring')) return this._ringAct(act, id)
    if ((act === 'buy' || act === 'trap' || act === 'upgrade') && s.cfg?.ironMode) return
    if (act === 'buy') {
      const item = SHOP_ITEMS.find((i) => i.id === id)
      if (!item || s.coins < this._price(item)) return
      s.coins -= this._price(item)
      try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
      if (item.health) s.health = Math.min(s.maxHealth, s.health + item.health)
      if (item.armor) s.armor = Math.min(100, s.armor + item.armor)
      // Ammo in the picked gun's own amounts (PlayWeapons.ammoFor).
      if (item.ammo) s.reserve += ammoFor(s.weaponId, item.ammo)
      if (item.item && s.inv?.add({ kind: 'item', id: item.item, n: 1 })) {
        // No room: the coins back.
        s.coins += this._price(item)
        s._message(t('invFull'))
      } else s._coinStat?.('campOut', 'items', this._price(item))
    } else if (act === 'trap') {
      const trap = [...SHOP_TRAPS, ...(s.td ? SHOP_TOWERS : [])].find((x) => x.id === id)
      if (!trap || s.coins < this._price(trap)) return
      // add() hands back what didn't fit; nothing fit -> the coins back.
      const left = s.inv?.add({ kind: 'block', id: trap.id, n: trap.n }) ?? trap.n
      if (left >= trap.n) s._message(t('invFull'))
      else {
        s.coins -= this._price(trap)
        s._coinStat?.('campOut', 'traps', this._price(trap))
        try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
      }
    } else if (act === 'upgrade') {
      const up = UPGRADES.find((u) => u.id === id)
      const level = s.upgrades[id] || 0
      if (!up || level >= up.costs.length || s.coins < this._upCost(up, level)) return
      s.coins -= this._upCost(up, level)
      s._coinStat?.('campOut', 'upgrades', this._upCost(up, level))
      try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
      s.upgrades[id] = level + 1
      if (id === 'mag') s.mag = Math.min(s.mag, s.magSize())
    } else if (act === 'fill') {
      const now = performance.now() / 1000
      if (now < this._ammoReadyAt) return
      this._ammoReadyAt = now + AMMO_FILL_COOLDOWN
      s.mag = s.magSize()
      s.reserve = Math.max(s.reserve, s.magSize() * 5)
    } else if (act === 'sellBugs') {
      const got = sellJars(s)
      if (got) s._message(t('bugSold', { n: got }), 3)
    } else if (act === 'claim') {
      const q = this.quests.find((x) => x.id === id)
      if (!q || q.claimed || this._statValue(q.stat) < q.goal) return
      q.claimed = true
      s._earn(q.reward, 'quests')
    }
    s._renderHud()
    if (this.panelOpen) this._renderPanel()
  }
}

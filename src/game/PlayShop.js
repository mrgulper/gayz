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
//   - Quests: up to three at a time (kill zombies, open chests, headshots,
//     reach a wave); finished ones are claimed here for coins and the next
//     one takes their place.
// The camp's four people (BuildCamp.js) still stand there; talking to one
// opens this shop on their tab.
// Coins come from kills (COIN_PER_KILL) and cleared waves (COIN_PER_WAVE),
// and only last for that game of Play.
import { ammoFor } from './PlayWeapons.js'
import { t } from './i18n.js'
import { ROD_COST } from './Fishing.js'

export const AMMO_FILL_COOLDOWN = 30
export const SHOP_ITEMS = [
  { id: 'medkit', cost: 40, health: 50 },
  { id: 'armor', cost: 75, armor: 50 },
  { id: 'ammobox', cost: 25, ammo: 60 },
  // Goes in the inventory (PlayInventory ITEMS).
  { id: 'fishingRod', cost: ROD_COST, item: 'fishingRod' },
]
// Trap packs (SpecialBlocks.js blocks): [block, how many, coins].
export const SHOP_TRAPS = [
  { id: 'spikeblock', n: 4, cost: 30 },
  { id: 'beartrap', n: 2, cost: 35 },
  { id: 'landmine', n: 2, cost: 45 },
  { id: 'explosivebarrel', n: 3, cost: 40 },
  { id: 'baitblock', n: 1, cost: 20 },
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
    this.reset()
  }

  get bm() {
    return this.s.bm
  }

  // A new game: quests from the start, the ammo refill ready.
  reset() {
    this.closePanel(false)
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
    if (!this.s.active || this.s.dead || this.s.spectating) return
    this.openPanel()
  }

  // npcId: a camp person was talked to - open on their tab.
  openPanel(npcId = '') {
    this._ensureDom()
    if (NPC_TAB[npcId]) this.tab = NPC_TAB[npcId]
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
      if (btn && !btn.disabled) this._act(btn.dataset.act, btn.dataset.id)
    }
    this._panel.querySelector('#play-npc-close').onclick = () => this.closePanel()
  }

  _renderPanel() {
    const s = this.s
    const id = this.tab
    const now = performance.now() / 1000
    const ammoWait = Math.max(0, Math.ceil(this._ammoReadyAt - now))
    // Only redraw when something shown changed (it's called every frame).
    const key = [id, s.coins, s.health, s.armor, s.mag, s.reserve, JSON.stringify(s.upgrades), ammoWait, this.quests.map((q) => q.claimed).join(), this.activeQuests().map((q) => this._statValue(q.stat)).join()].join('|')
    if (key === this._panelKey) return
    this._panelKey = key
    const set = (sel, text) => {
      const el = this._panel.querySelector(sel)
      if (el) el.textContent = text
    }
    set('#play-npc-title', t('shopTitle'))
    set('#play-npc-coins', t('campCoins', { n: s.coins }))
    this._panel.querySelector('#play-npc-close').setAttribute('aria-label', t('communityBuildsCloseBtn'))
    this._panel.querySelector('#play-shop-tabs').innerHTML = SHOP_TABS.map((tab) => `<button type="button" role="tab" class="play-shop-tab${tab === id ? ' active' : ''}" data-shop-tab="${tab}" aria-selected="${tab === id}">${t(`shopTab_${tab}`)}</button>`).join('')
    const rows = []
    const row = (name, detail, btnText, act, itemId, disabled) => `<div class="play-npc-row"><div class="play-npc-info"><b>${name}</b><span>${detail}</span></div><button type="button" data-act="${act}" data-id="${itemId}" ${disabled ? 'disabled' : ''}>${btnText}</button></div>`
    const buying = id === 'items' || id === 'traps' || id === 'upgrades'
    // Iron Mode (a Game Mode mutator): no buying in the shop.
    const iron = !!s.cfg?.ironMode && buying
    if (iron) rows.push(`<p class="play-npc-empty">${t('campIronMode')}</p>`)
    // Settings > General > Low Coins Reminder: say so when nothing here is
    // affordable yet.
    if (!iron && buying && this.bm.game?.settings?.lowCurrencyReminder !== false) {
      const costs = id === 'items' ? SHOP_ITEMS.map((item) => this._price(item)) : id === 'traps' ? SHOP_TRAPS.map((trap) => this._price(trap)) : UPGRADES.map((up) => up.costs[s.upgrades[up.id] || 0]).filter((c) => c !== undefined)
      if (costs.length && s.coins < Math.min(...costs)) rows.push(`<p class="play-npc-empty">${t('campLowCoins', { n: s.coins })}</p>`)
    }
    if (id === 'items') {
      for (const item of SHOP_ITEMS) {
        const cost = this._price(item)
        rows.push(row(t(`campItem_${item.id}`), t(`campItem_${item.id}_about`, { n: item.health || item.armor || ammoFor(s.weaponId, item.ammo) }), t('campBuy', { n: cost }), 'buy', item.id, iron || s.coins < cost))
      }
    } else if (id === 'traps') {
      for (const trap of SHOP_TRAPS) {
        const cost = this._price(trap)
        rows.push(row(`${this.bm.blockName(trap.id)} ×${trap.n}`, t(`shopTrap_${trap.id}`), t('campBuy', { n: cost }), 'trap', trap.id, iron || s.coins < cost))
      }
    } else if (id === 'upgrades') {
      for (const up of UPGRADES) {
        const level = s.upgrades[up.id] || 0
        const maxed = level >= up.costs.length
        rows.push(row(`${t(`campUp_${up.id}`)} ${t('campLevel', { n: level, max: up.costs.length })}`, t(`campUp_${up.id}_about`), maxed ? t('campMaxed') : t('campBuy', { n: up.costs[level] }), 'upgrade', up.id, iron || maxed || s.coins < up.costs[level]))
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

  // A price after the Trader Discount upgrade (PlayRules.js).
  _price(item) {
    return Math.round(item.cost * (1 - (this.s.cfg?.discount || 0)))
  }

  _act(act, id) {
    const s = this.s
    if ((act === 'buy' || act === 'trap' || act === 'upgrade') && s.cfg?.ironMode) return
    if (act === 'buy') {
      const item = SHOP_ITEMS.find((i) => i.id === id)
      if (!item || s.coins < this._price(item)) return
      s.coins -= this._price(item)
      if (item.health) s.health = Math.min(s.maxHealth, s.health + item.health)
      if (item.armor) s.armor = Math.min(100, s.armor + item.armor)
      // Ammo in the picked gun's own amounts (PlayWeapons.ammoFor).
      if (item.ammo) s.reserve += ammoFor(s.weaponId, item.ammo)
      if (item.item && s.inv?.add({ kind: 'item', id: item.item, n: 1 })) {
        // No room: the coins back.
        s.coins += this._price(item)
        s._message(t('invFull'))
      }
    } else if (act === 'trap') {
      const trap = SHOP_TRAPS.find((x) => x.id === id)
      if (!trap || s.coins < this._price(trap)) return
      // add() hands back what didn't fit; nothing fit -> the coins back.
      const left = s.inv?.add({ kind: 'block', id: trap.id, n: trap.n }) ?? trap.n
      if (left >= trap.n) s._message(t('invFull'))
      else s.coins -= this._price(trap)
    } else if (act === 'upgrade') {
      const up = UPGRADES.find((u) => u.id === id)
      const level = s.upgrades[id] || 0
      if (!up || level >= up.costs.length || s.coins < up.costs[level]) return
      s.coins -= up.costs[level]
      s.upgrades[id] = level + 1
      if (id === 'mag') s.mag = Math.min(s.mag, s.magSize())
    } else if (act === 'fill') {
      const now = performance.now() / 1000
      if (now < this._ammoReadyAt) return
      this._ammoReadyAt = now + AMMO_FILL_COOLDOWN
      s.mag = s.magSize()
      s.reserve = Math.max(s.reserve, s.magSize() * 5)
    } else if (act === 'claim') {
      const q = this.quests.find((x) => x.id === id)
      if (!q || q.claimed || this._statValue(q.stat) < q.goal) return
      q.claimed = true
      s._earn(q.reward)
    }
    s._renderHud()
    if (this.panelOpen) this._renderPanel()
  }
}

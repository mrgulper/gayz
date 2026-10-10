// Map 3's safe zone in Play (2026-10-04, Gaymi: "make this place the safe
// zone and add npc the npc will be minecraft character and make a trader,
// upgrader, and ammo fill also make a place for quest"). Owned by
// BuildSurvival (`survival.camp`), set up only on Map 3, whose generator
// reports the walled camp and where each NPC stands (Map3Generator.js's
// `safeZone`).
//
// - Inside the camp walls zombies can't reach you: they don't spawn there,
//   can't walk in (BuildSurvival stops them at the edge) and can't hit you.
// - Four NPCs (skins made in Design a Skin, NPC_SKINS) stand in front of
//   the tents and the quest board, each with a name tag; walk up, look at one and press the use
//   key to talk:
//   - Trader: Med Kit, Armor and an Ammo Box for coins.
//   - Upgrader: Damage, Reload Speed and Bigger Magazine, three levels each.
//   - Ammo Refill: fills your gun and spare ammo for free, then needs a
//     short rest (AMMO_FILL_COOLDOWN).
//   - Quest Board: up to three quests at a time (kill zombies, open
//     chests, headshots, reach a wave); finished ones are claimed here for
//     coins and the next one takes their place.
// - Coins come from kills (COIN_PER_KILL) and cleared waves
//   (COIN_PER_WAVE), and only last for that game of Play.
import * as THREE from 'three'
import { ammoFor } from './PlayWeapons.js'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { t } from './i18n.js'

export const COIN_PER_KILL = 10
export const COIN_PER_WAVE = 50
export const AMMO_FILL_COOLDOWN = 30
const TALK_RANGE = 3.2 // blocks
export const SHOP_ITEMS = [
  { id: 'medkit', cost: 40, health: 50 },
  { id: 'armor', cost: 75, armor: 50 },
  { id: 'ammobox', cost: 25, ammo: 60 },
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
// Each NPC's skin, made in GayZ's own Design a Skin (2026-10-05, Gaymi:
// "remake these characters go on gayz design a skin" - the first ones were
// plain painted Minecraft-style colors).
export const NPC_SKINS = {
  trader: '/images/npc/trader.png',
  upgrader: '/images/npc/upgrader.png',
  ammo: '/images/npc/ammo.png',
  quest: '/images/npc/quest.png',
}

export function nameTag(text, B) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 8, 256, 48)
  ctx.fillStyle = '#ffe9a8'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.scale.set(1.7 * B, 0.42 * B, 1)
  sprite.position.y = 2.2 * B
  return sprite
}

export class BuildCamp {
  // display: just the NPCs standing in the camp while building in the
  // Map Editor (BuildMode keeps one while Map 3 is open and Play isn't) -
  // no shop, no prompt; they only turn to watch the camera.
  constructor(survival, zone, blockSize, { display = false, buildMode = null } = {}) {
    this.s = survival
    this.bm = buildMode || survival.bm
    this.display = display
    this.zone = zone
    this.B = blockSize
    this.npcs = []
    this.panelOpen = false
    this._building = true
    this.quests = CAMP_QUESTS.map((q) => ({ ...q, claimed: false }))
    this._notified = new Set()
    this._ammoReadyAt = 0
    if (!display) this._ensureDom()
    this._spawnNpcs()
  }

  // Strictly inside the camp's walls (cells, x/z in blocks).
  inside(x, z, margin = 0) {
    const zn = this.zone
    return x > zn.x0 + 1 - margin && x < zn.x1 - margin && z > zn.z0 + 1 - margin && z < zn.z1 - margin
  }

  _spawnNpcs() {
    const spots = this.zone.npcSpots || {}
    for (const id of Object.keys(NPC_SKINS)) {
      const spot = spots[id]
      if (!spot) continue
      const group = new THREE.Group()
      const [x, z] = spot
      const npc = { id, x: x + 0.5, z: z + 0.5, y: 0, group, body: null, t: Math.random() * 6 }
      group.position.set(npc.x * this.B, 0, npc.z * this.B)
      group.add(nameTag(t(`campNpc_${id}`), this.B))
      this.bm.scene.add(group)
      this.npcs.push(npc)
      // Each body arrives when its skin has loaded.
      loadSkinTexture(NPC_SKINS[id]).then((skin) => {
        if (!this.npcs.includes(npc)) return
        const body = buildTexturedCharacter(skin)
        const sc = (1.8 * this.B) / 32
        body.scale.setScalar(sc)
        body.position.y = 2 * sc
        group.add(body)
        npc.body = body
      }).catch(() => {
        // No skin: just the name tag.
      })
    }
  }

  dispose() {
    this.closePanel(false)
    for (const npc of this.npcs) {
      this.bm.scene.remove(npc.group)
      npc.group.traverse((o) => {
        if (!o.isMesh && !o.isSprite) return
        o.geometry?.dispose?.()
        for (const m of [].concat(o.material)) {
          if (o.isSprite) m.map?.dispose()
          m.dispose()
        }
      })
    }
    this.npcs = []
    if (this._prompt) this._prompt.style.display = 'none'
  }

  // --- coins, quests ---

  addCoins(n) {
    this.s.coins += n
    this.s._renderHud()
  }

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

  // --- talking to NPCs ---

  // The NPC you're looking at, close enough to talk to.
  _facingNpc() {
    const p = this.bm.tryMode.pos
    const yaw = this.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let best = null
    let bestD = TALK_RANGE
    for (const npc of this.npcs) {
      const dx = npc.x - p.x
      const dz = npc.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > bestD || d < 0.01) continue
      if ((dx * fx + dz * fz) / d < 0.6) continue
      best = npc
      bestD = d
    }
    return best
  }

  // The use key / right-click while playing. True if an NPC was there.
  use() {
    if (this.panelOpen) return true
    const npc = this._facingNpc()
    if (!npc) return false
    this.openPanel(npc.id)
    return true
  }

  update(dt) {
    const cam = this.bm.camera.position
    const p = this.display ? { x: cam.x / this.B, z: cam.z / this.B } : this.bm.tryMode.pos
    const view = this.bm.viewDistance?.() ?? Infinity
    for (const npc of this.npcs) {
      npc.t += dt
      // Turn to watch you when you're close; breathe a little.
      const dx = p.x - npc.x
      const dz = p.z - npc.z
      // Past the view distance (in the fog) they aren't drawn at all.
      npc.group.visible = Math.hypot(dx, dz) <= view
      if (Math.hypot(dx, dz) < 8) npc.group.rotation.y = THREE.MathUtils.lerp(npc.group.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 4))
      if (npc.body) {
        const lp = npc.body.limbPivots
        const sway = Math.sin(npc.t * 1.6) * 0.06
        lp.armR.rotation.x = sway
        lp.armL.rotation.x = -sway
      }
    }
    if (this.display) return
    const npc = this.panelOpen ? null : this._facingNpc()
    if (this._prompt) {
      this._prompt.style.display = npc ? 'block' : 'none'
      if (npc && this._promptFor !== npc.id) {
        this._promptFor = npc.id
        this._prompt.textContent = t('campTalk', { name: t(`campNpc_${npc.id}`) })
      }
    }
    if (this.panelOpen) this._renderPanel()
  }

  // --- the shop/quest panel ---

  _ensureDom() {
    this._prompt = document.getElementById('play-npc-prompt')
    if (!this._prompt) {
      this._prompt = document.createElement('div')
      this._prompt.id = 'play-npc-prompt'
      this._prompt.style.display = 'none'
      document.body.appendChild(this._prompt)
    }
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
        <div id="play-npc-list"></div>
      </div>`
      document.body.appendChild(this._panel)
    }
    this._panel.onclick = (e) => {
      if (!e.target.closest('.build-share-box')) return this.closePanel()
      const btn = e.target.closest('button[data-act]')
      if (btn && !btn.disabled) this._act(btn.dataset.act, btn.dataset.id)
    }
    this._panel.querySelector('#play-npc-close').onclick = () => this.closePanel()
  }

  openPanel(id) {
    this.panelOpen = true
    this._panelFor = id
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

  _renderPanel() {
    const s = this.s
    const id = this._panelFor
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
    set('#play-npc-title', t(`campNpc_${id}`))
    set('#play-npc-coins', t('campCoins', { n: s.coins }))
    this._panel.querySelector('#play-npc-close').setAttribute('aria-label', t('communityBuildsCloseBtn'))
    const rows = []
    const row = (name, detail, btnText, act, itemId, disabled) => `<div class="play-npc-row"><div class="play-npc-info"><b>${name}</b><span>${detail}</span></div><button type="button" data-act="${act}" data-id="${itemId}" ${disabled ? 'disabled' : ''}>${btnText}</button></div>`
    // Iron Mode (a Game Mode mutator): no buying from the Trader or Upgrader.
    const iron = !!s.cfg?.ironMode && (id === 'trader' || id === 'upgrader')
    if (iron) rows.push(`<p class="play-npc-empty">${t('campIronMode')}</p>`)
    if (id === 'trader') {
      for (const item of SHOP_ITEMS) {
        const cost = this._price(item)
        rows.push(row(t(`campItem_${item.id}`), t(`campItem_${item.id}_about`, { n: item.health || item.armor || ammoFor(s.weaponId, item.ammo) }), t('campBuy', { n: cost }), 'buy', item.id, iron || s.coins < cost))
      }
    } else if (id === 'upgrader') {
      for (const up of UPGRADES) {
        const level = s.upgrades[up.id] || 0
        const maxed = level >= up.costs.length
        rows.push(row(`${t(`campUp_${up.id}`)} ${t('campLevel', { n: level, max: up.costs.length })}`, t(`campUp_${up.id}_about`), maxed ? t('campMaxed') : t('campBuy', { n: up.costs[level] }), 'upgrade', up.id, iron || maxed || s.coins < up.costs[level]))
      }
    } else if (id === 'ammo') {
      rows.push(row(t('campFillUp'), t('campFillUp_about', { s: AMMO_FILL_COOLDOWN }), ammoWait ? t('campWait', { s: ammoWait }) : t('campFree'), 'fill', 'fill', ammoWait > 0))
    } else if (id === 'quest') {
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

  // A Trader price after the Trader Discount upgrade (PlayRules.js).
  _price(item) {
    return Math.round(item.cost * (1 - (this.s.cfg?.discount || 0)))
  }

  _act(act, id) {
    const s = this.s
    if ((act === 'buy' || act === 'upgrade') && s.cfg?.ironMode) return
    if (act === 'buy') {
      const item = SHOP_ITEMS.find((i) => i.id === id)
      if (!item || s.coins < this._price(item)) return
      s.coins -= this._price(item)
      if (item.health) s.health = Math.min(s.maxHealth, s.health + item.health)
      if (item.armor) s.armor = Math.min(100, s.armor + item.armor)
      // Ammo in the picked gun's own amounts (PlayWeapons.ammoFor).
      if (item.ammo) s.reserve += ammoFor(s.weaponId, item.ammo)
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
    this._renderPanel()
  }
}

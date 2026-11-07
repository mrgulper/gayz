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
//   the tents and the quest board, each with a name tag; walk up, look at
//   one and press the use key to talk: it opens the Shop (PlayShop.js) on
//   their tab - Items, Upgrades, Ammo or Quests. Since 2026-11-01 the Shop
//   key (B) opens the same thing anywhere, on every map.
// - Coins come from kills (COIN_PER_KILL) and cleared waves
//   (COIN_PER_WAVE), and only last for that game of Play.
// - A Trophy Room against one wall (CampTrophies.js, 2026-11-01).
// - Now and then a siege makes it unsafe for a while (CampSiege.js).
// - A Daily Lucky Wheel (CampWheel.js, 2026-11-06) and a Treehouse
//   (CampTreehouse.js, 2026-11-06).
// - The Plaza: the Zombie Newspaper, the Lost & Found box, Pinball and
//   Chess (CampPlaza.js, 2026-11-06).
// - The Zombie Museum (CampMuseum.js) and Dr. Goo's lab, where the Story
//   Campaign is told (Campaign.js), 2026-11-06.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { t } from './i18n.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { CampTrophies } from './CampTrophies.js'
import { CampAquarium } from './CampAquarium.js'
import { CampZoo } from './CampZoo.js'
import { CampWheel } from './CampWheel.js'
import { CampTreehouse } from './CampTreehouse.js'
import { CampPlaza, WIDE as PLAZA_WIDE } from './CampPlaza.js'
import { CampMuseum, WIDE as MUSEUM_WIDE } from './CampMuseum.js'
import { Campaign } from './Campaign.js'

export const COIN_PER_KILL = 10
export const COIN_PER_WAVE = 50
const TALK_RANGE = 3.2 // blocks
// Each NPC's skin, made in GayZ's own Design a Skin (2026-10-05, Gaymi:
// "remake these characters go on gayz design a skin" - the first ones were
// plain painted Minecraft-style colors).
export const NPC_SKINS = {
  trader: '/images/npc/trader.png',
  upgrader: '/images/npc/upgrader.png',
  ammo: '/images/npc/ammo.png',
  quest: '/images/npc/quest.png',
}

// A name over someone's head: just the words, with a dark outline so they
// read on any sky (2026-10-26, Gaymi: "just write the name above the
// player, don't add the colour rectangle behind it"). Used for the camp's
// people, the players on a server (PlayNet) and in Build Together.
export function nameTag(text, B) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.strokeText(text, 128, 32)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.scale.set(1.7 * B, 0.42 * B, 1)
  sprite.position.y = (MOB_HEIGHT + 0.4) * B
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
    this._building = true
    if (!display) this._ensureDom()
    this._spawnNpcs()
  }

  // Strictly inside the camp's walls (x/z in blocks: the open ground runs
  // from x0 + 1 up to x1, the wall cells' own edges). margin grows it the
  // same amount on every side - it used to shrink the far (+x/+z) sides
  // instead, so zombies spawned in the camp's last row along those walls
  // (2026-10-16, "dont make these zombies etc come into safe zone").
  inside(x, z, margin = 0) {
    const zn = this.zone
    return x > zn.x0 + 1 - margin && x < zn.x1 + margin && z > zn.z0 + 1 - margin && z < zn.z1 + margin
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
        const sc = (MOB_HEIGHT * this.B) / 32
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
    this.trophies?.dispose()
    this.trophies = null
    this.aquarium?.dispose()
    this.aquarium = null
    this.zoo?.dispose()
    this.zoo = null
    this.wheel?.dispose()
    this.wheel = null
    this.treehouse?.dispose()
    this.treehouse = null
    this.plaza?.dispose()
    this.plaza = null
    this.museum?.dispose()
    this.museum = null
    this.lab?.dispose()
    this.lab = null
    if (this._prompt) this._prompt.style.display = 'none'
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
    const shop = this.s.shop
    if (!shop) return false
    if (shop.panelOpen) return true
    // The Lucky Wheel (CampWheel.js).
    if (this.wheel?.use()) return true
    // The Treehouse's ladder (CampTreehouse.js).
    if (this.treehouse?.use()) return true
    // The Plaza's stations (CampPlaza.js).
    if (this.plaza?.use()) return true
    // The Museum and Dr. Goo's lab (CampMuseum.js, Campaign.js).
    if (this.museum?.use()) return true
    if (this.lab?.use()) return true
    const npc = this._facingNpc()
    if (!npc) return false
    shop.openPanel(npc.id)
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
    // The Trophy Room goes up on the first frame, once the camp farm's
    // Crop Plots are back in (they'd be in its way).
    if (!this.trophies) {
      this.trophies = new CampTrophies(this)
      this.trophies.build()
      // The Aquarium beside it (CampAquarium.js).
      this.aquarium = new CampAquarium(this)
      this.aquarium.build(this.trophies.spot)
      // And the Zombie Zoo, clear of both (CampZoo.js).
      this.zoo = new CampZoo(this)
      const taken = [this.trophies.spot && { ...this.trophies.spot, wide: 8 }, this.aquarium.spot && { ...this.aquarium.spot, wide: 5 }].filter(Boolean)
      this.zoo.build(taken)
      // The Lucky Wheel, clear of all three (CampWheel.js).
      if (this.zoo.spot) taken.push({ ...this.zoo.spot, wide: 8 })
      this.wheel = new CampWheel(this)
      this.wheel.build(taken)
      // And the Treehouse (CampTreehouse.js).
      if (this.wheel.spot) taken.push({ ...this.wheel.spot, wide: 4 })
      this.treehouse = new CampTreehouse(this)
      this.treehouse.build(taken)
      // And the Plaza (CampPlaza.js).
      if (this.treehouse.spot) taken.push({ ...this.treehouse.spot, wide: 5 })
      this.plaza = new CampPlaza(this)
      this.plaza.build(taken)
      if (this.plaza.spot) taken.push({ ...this.plaza.spot, wide: PLAZA_WIDE })
      // The Museum and Dr. Goo's lab (CampMuseum.js, Campaign.js).
      this.museum = new CampMuseum(this)
      this.museum.build(taken)
      if (this.museum.spot) taken.push({ ...this.museum.spot, wide: MUSEUM_WIDE })
      this.lab = new Campaign(this)
      this.lab.build(taken)
      this.taken = taken
    }
    this.museum?.update()
    this.lab?.update(dt)
    this.trophies.update(p)
    this.aquarium?.update(dt)
    this.zoo?.update(dt)
    this.wheel?.update(dt)
    const npc = this.s.shop?.panelOpen ? null : this._facingNpc()
    const wheel = !npc && !this.s.shop?.panelOpen && !!this.wheel?.near()
    const tree = !npc && !wheel && !this.s.shop?.panelOpen && !!this.treehouse?.near()
    const st = !npc && !wheel && !tree && !this.s.shop?.panelOpen ? this.plaza?.near() : null
    const mus = !npc && !wheel && !tree && !st && !this.s.shop?.panelOpen && !!this.museum?.near()
    const lab = !npc && !wheel && !tree && !st && !mus && !this.s.shop?.panelOpen && !!this.lab?.near()
    if (this._prompt) {
      this._prompt.style.display = npc || wheel || tree || st || mus || lab ? 'block' : 'none'
      if (npc && this._promptFor !== npc.id) {
        this._promptFor = npc.id
        this._prompt.textContent = t('campTalk', { name: t(`campNpc_${npc.id}`) })
      } else if (wheel && this._promptFor !== 'wheel') {
        this._promptFor = 'wheel'
        this._prompt.textContent = t('wheelPrompt')
      } else if (tree && this._promptFor !== `tree${this.treehouse.up}`) {
        this._promptFor = `tree${this.treehouse.up}`
        this._prompt.textContent = t(this.treehouse.up ? 'treehousePromptDown' : 'treehousePromptUp')
      } else if (st && this._promptFor !== `plaza${st.id}`) {
        this._promptFor = `plaza${st.id}`
        this._prompt.textContent = this.plaza.prompt(st)
      } else if (mus && this._promptFor !== 'museum') {
        this._promptFor = 'museum'
        this._prompt.textContent = t('museumPrompt')
      } else if (lab && this._promptFor !== `lab${this.lab.story.ch}${this.lab.story.started}${this.lab.story.done}`) {
        this._promptFor = `lab${this.lab.story.ch}${this.lab.story.started}${this.lab.story.done}`
        this._prompt.textContent = this.lab.prompt()
      }
    }
  }

  _ensureDom() {
    this._prompt = document.getElementById('play-npc-prompt')
    if (!this._prompt) {
      this._prompt = document.createElement('div')
      this._prompt.id = 'play-npc-prompt'
      this._prompt.style.display = 'none'
      document.body.appendChild(this._prompt)
    }
  }
}

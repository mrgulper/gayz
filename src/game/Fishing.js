// Fishing (2026-11-01, Gaymi's idea list: "a rod - catch fish, junk,
// treasure chests or the odd zombie fish"; Gaymi picked "buy the rod from
// the shop"). The camp's Trader sells a Fishing Rod (BuildCamp SHOP_ITEMS),
// and now and then a loot chest has one. Hold it and click (or the phone's
// use button) looking at water up to CAST_REACH blocks away: the bobber
// flies out on a line and floats. After WAIT_S something bites - the
// bobber dips, a sound plays and "Click now!" shows - and a click within
// BITE_S reels it in. Too slow and it gets away (the bobber stays out for
// the next bite). Clicking before a bite reels in empty.
//
// What comes up (CATCHES): a Fish or a rare Golden Fish (eaten to heal),
// an Old Boot (junk), a treasure chest (coins and an item) or a Zombie
// Fish - a zombie leaps out of the water at you (alone or as a server's
// host, in a game with zombies; otherwise it's just a fish).
//
// Owned by BuildSurvival (`s.fishing`). Each player's own (nothing to
// sync). Meshes and one line, never a light.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { itemName } from './PlayInventory.js'

// The Trader's price (BuildCamp SHOP_ITEMS).
export const ROD_COST = 60
const CAST_REACH = 14 // blocks
const RAY_STEP = 0.2
const FLY_S = 0.45
const WAIT_S = [3, 9]
const BITE_S = 1.3
const LEAVE_R = 22 // walk this far from the bobber and it reels itself in
export const CATCHES = [
  ['fish', 50],
  ['oldBoot', 16],
  ['treasure', 14],
  ['zombieFish', 13],
  ['goldenFish', 7],
]
const TREASURE_COINS = [40, 90]
const TREASURE_ITEMS = ['healthpack', 'ammobox', 'catchTrap']

const between = ([a, b]) => a + Math.random() * (b - a)

export function rollCatch(r = Math.random()) {
  const total = CATCHES.reduce((sum, [, w]) => sum + w, 0)
  let x = r * total
  for (const [id, w] of CATCHES) {
    if ((x -= w) < 0) return id
  }
  return CATCHES[0][0]
}

export class Fishing {
  constructor(survival) {
    this.s = survival
    this.bob = null
  }

  get bm() {
    return this.s.bm
  }

  get B() {
    return this.s.B
  }

  // Out on the water now.
  get out() {
    return !!this.bob
  }

  _isWater(x, y, z) {
    const type = this.bm.getBlockAt(x, y, z)
    return type === 'water' || (!!type && type !== 'lava' && this.bm._cellIsLiquid(x, y, z))
  }

  // Clicked with the rod: cast, or reel in. -> true (the rod is never used up).
  use() {
    if (this.bob) {
      this._reel()
      return true
    }
    const spot = this._waterInView()
    if (!spot) {
      this.s._message(t('fishNeedWater'))
      return true
    }
    this._cast(spot)
    return true
  }

  // The first water the middle of the screen points at, within reach:
  // where on its top the bobber lands.
  _waterInView() {
    const bm = this.bm
    const B = this.B
    bm.camera.updateMatrixWorld()
    const from = bm.camera.position.clone().divideScalar(B)
    const dir = new THREE.Vector3()
    bm.camera.getWorldDirection(dir)
    for (let d = 0.5; d <= CAST_REACH; d += RAY_STEP) {
      const x = from.x + dir.x * d
      const y = from.y + dir.y * d
      const z = from.z + dir.z * d
      const cx = Math.floor(x)
      let cy = Math.floor(y)
      const cz = Math.floor(z)
      if (this._isWater(cx, cy, cz)) {
        while (this._isWater(cx, cy + 1, cz) && cy < y + 8) cy++
        return { x, y: cy + 1, z, cx, cz }
      }
      if (bm._cellSolidTop(cx, cy, cz) > 0) return null
    }
    return null
  }

  _cast(spot) {
    const B = this.B
    const scene = this.bm.scene
    const group = new THREE.Group()
    const red = new THREE.MeshLambertMaterial({ color: 0xe03a2a })
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f0ea })
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.18 * B, 0.12 * B, 0.18 * B), red)
    top.position.y = 0.06 * B
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.18 * B, 0.12 * B, 0.18 * B), white)
    bottom.position.y = -0.06 * B
    group.add(top, bottom)
    scene.add(group)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2f0ea }))
    line.frustumCulled = false
    scene.add(line)
    const me = this.s.bodyPos()
    this.bob = { ...spot, from: { x: me.x, y: me.y + 1.4, z: me.z }, fly: 0, wait: between(WAIT_S), bite: 0, group, line }
    try { audioEngine.playSpecial?.('whoosh') } catch { /* no audio */ }
  }

  _reel() {
    const b = this.bob
    if (b.bite > 0) this._land()
    else this.s._message(t('fishReeledEmpty'))
    this.clear()
  }

  // Something on the line: what is it?
  _land() {
    const s = this.s
    const b = this.bob
    let id = rollCatch()
    const zombiesOk = !s.cfg?.noZombies && (!s.net || s.net.isHost)
    if (id === 'zombieFish' && !zombiesOk) id = 'fish'
    try { audioEngine.playSpecial?.('pop') } catch { /* no audio */ }
    if (id === 'zombieFish') {
      // It leaps out of the water and lands beside you.
      const me = s.bodyPos()
      const a = Math.atan2(b.x - me.x, b.z - me.z)
      const x = me.x + Math.sin(a) * 2.5
      const z = me.z + Math.cos(a) * 2.5
      const zb = s._extraZombie(x, s._groundUnder(x, me.y + 3, z), z)
      s._message(t(zb ? 'fishZombie' : 'fishGotAway'), 3)
      if (zb) try { audioEngine.playZombieScream?.(0) } catch { /* no audio */ }
      return
    }
    if (id === 'treasure') {
      const n = Math.round(between(TREASURE_COINS))
      const before = s._coinsEarned
      s._earn(n)
      const item = TREASURE_ITEMS[Math.floor(Math.random() * TREASURE_ITEMS.length)]
      const fits = s.inv.add({ kind: 'item', id: item, n: 1 }) === 0
      s._message(t('fishTreasure', { n: s._coinsEarned - before, item: fits ? itemName(item) : t('invFull') }), 4)
      s._renderHud()
      return
    }
    const fits = s.inv.add({ kind: 'item', id, n: 1 }) === 0
    s._message(fits ? t(id === 'goldenFish' ? 'fishCaughtGolden' : 'fishCaught', { item: itemName(id) }) : t('invFull'), 3)
    if (id === 'goldenFish') try { audioEngine.playSpecial?.('goldZombie') } catch { /* no audio */ }
  }

  update(dt) {
    const b = this.bob
    if (!b) return
    const s = this.s
    const B = this.B
    const held = s.holding
    const me = s.bodyPos()
    // Put the rod away, died, or walked off: it reels itself in.
    if (s.dead || held?.kind !== 'item' || held.id !== 'fishingRod' || Math.hypot(me.x - b.x, me.z - b.z) > LEAVE_R) {
      this.clear()
      return
    }
    const time = performance.now() / 1000
    let y = b.y
    if (b.fly < FLY_S) {
      // Flying out in an arc.
      b.fly += dt
      const k = Math.min(1, b.fly / FLY_S)
      b.group.position.set((b.from.x + (b.x - b.from.x) * k) * B, (b.from.y + (b.y - b.from.y) * k + Math.sin(k * Math.PI) * 2) * B, (b.from.z + (b.z - b.from.z) * k) * B)
      if (k >= 1) try { audioEngine.playSpecial?.('echo') } catch { /* no audio */ }
    } else if (b.bite > 0) {
      // A bite: it dips under and jiggles.
      b.bite -= dt
      y -= 0.22 + Math.sin(time * 30) * 0.05
      if (b.bite <= 0) {
        s._message(t('fishGotAway'))
        b.wait = between(WAIT_S)
      }
      b.group.position.set(b.x * B, y * B, b.z * B)
    } else {
      b.wait -= dt
      y += Math.sin(time * 2.5) * 0.04
      if (b.wait <= 0) {
        b.bite = BITE_S
        s._message(t('fishBite'), BITE_S)
        try { audioEngine.playSpecial?.('twang') } catch { /* no audio */ }
      }
      b.group.position.set(b.x * B, y * B, b.z * B)
    }
    // The line: from just below and right of your eye to the bobber.
    const cam = this.bm.camera
    const start = new THREE.Vector3(0.35 * B, -0.3 * B, -0.6 * B).applyQuaternion(cam.quaternion).add(cam.position)
    const pos = b.line.geometry.attributes.position
    pos.setXYZ(0, start.x, start.y, start.z)
    pos.setXYZ(1, b.group.position.x, b.group.position.y + 0.1 * B, b.group.position.z)
    pos.needsUpdate = true
  }

  clear() {
    const b = this.bob
    if (!b) return
    this.bob = null
    b.group.removeFromParent()
    b.group.traverse((o) => {
      if (!o.isMesh) return
      o.geometry.dispose()
      o.material.dispose()
    })
    b.line.removeFromParent()
    b.line.geometry.dispose()
    b.line.material.dispose()
  }
}

// Coral reefs and sunken ruins (2026-11-02, Gaymi's idea list 5: "dive in
// a craftable sub and explore sea-floor ruins full of the Sea Zombies you
// already have"). Owned by BuildSurvival (`s.reefs`), open world only.
//
// While you ride a submarine over the sea (an ocean biome), every CHECK_S
// seconds, if there's no ruin within RUIN_GAP blocks, one is found on the
// sea floor AHEAD blocks in front of you (where the water is at least
// MIN_DEPTH deep): a reef of coral blocks and coral plants REEF_R blocks
// round, and in the middle the broken walls of an old prismarine building
// with pillars, a sea lantern and a loot chest. SEA_ZOMBIES sea zombies
// (ZombieKinds REALM_KINDS.ocean) guard it - they're not part of the wave.
// At most MAX_RUINS a game. Everything is put back as it was when the
// game ends (TempBlocks.js), and the zombies only come where the game runs
// (alone or a server's host).
import { t } from './i18n.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { REALM_KINDS } from './ZombieKinds.js'
import { TempBlocks } from './TempBlocks.js'

export const MAX_RUINS = 8
const CHECK_S = 3
export const RUIN_GAP = 70
const AHEAD = [24, 34]
const MIN_DEPTH = 5
export const REEF_R = 8
export const SEA_ZOMBIES = 3
const NOTICE_R = 18
const CORAL_BLOCKS = ['tubecoralblock', 'braincoralblock', 'bubblecoralblock', 'firecoralblock', 'horncoralblock']
const CORAL_PLANTS = ['tubecoral', 'braincoral', 'bubblecoral', 'firecoral', 'horncoral', 'seagrass']

export class Reefs {
  constructor(survival) {
    this.s = survival
    this.cells = new TempBlocks(survival)
    this.ruins = []
    this._in = CHECK_S
  }

  _ocean(x, z) {
    return !inCity(Math.floor(x), Math.floor(z)) && /cean$/.test(sampleLand(Math.floor(x), Math.floor(z))?.biome || '')
  }

  // The top of the sea floor in a column (the floor block's y), looking down
  // from `from`, and how deep the water over it is.
  _floor(x, z, from) {
    const bm = this.s.bm
    let depth = 0
    for (let y = Math.floor(from); y > from - 60; y--) {
      const b = bm.getBlockAt(x, y, z)
      if (b === 'water') {
        depth++
        continue
      }
      if (b) return { y, depth }
    }
    return null
  }

  update(dt) {
    const s = this.s
    if (!s.active || !s.bm.world?.active) return
    const v = s.vehicles?.riding
    // Finding the ruins near you.
    const me = s.bodyPos()
    for (const r of this.ruins) {
      if (!r.seen && Math.hypot(me.x - r.x, me.z - r.z) < NOTICE_R) {
        r.seen = true
        s._message(t('reefRuinFound'), 4)
      }
    }
    if (!v || v.kind !== 'sub' || this.ruins.length >= MAX_RUINS) return
    this._in -= dt
    if (this._in > 0) return
    this._in = CHECK_S
    if (!this._ocean(v.x, v.z) || this.ruins.some((r) => Math.hypot(r.x - v.x, r.z - v.z) < RUIN_GAP)) return
    const d = AHEAD[0] + Math.random() * (AHEAD[1] - AHEAD[0])
    const x = Math.floor(v.x + Math.sin(v.heading) * d)
    const z = Math.floor(v.z + Math.cos(v.heading) * d)
    if (!this._ocean(x, z)) return
    const f = this._floor(x, z, v.y + 2)
    if (!f || f.depth < MIN_DEPTH) return
    this.build(x, f.y, z)
  }

  // A reef and a ruin round (cx, floorY, cz).
  build(cx, floorY, cz) {
    const s = this.s
    const pick = (list) => list[Math.floor(Math.random() * list.length)]
    // The reef: coral blocks set into the floor, coral and seagrass on top.
    for (let x = cx - REEF_R; x <= cx + REEF_R; x++) {
      for (let z = cz - REEF_R; z <= cz + REEF_R; z++) {
        const d = Math.hypot(x - cx, z - cz)
        if (d > REEF_R || d < 4.5 || Math.random() > 0.55) continue
        const f = this._floor(x, z, floorY + 6)
        if (!f || f.depth < 2) continue
        this.cells.put(x, f.y, z, pick(CORAL_BLOCKS))
        if (Math.random() < 0.6) this.cells.put(x, f.y + 1, z, pick(CORAL_PLANTS))
        if (Math.random() < 0.15 && f.depth > 3) this.cells.put(x, f.y + 2, z, pick(CORAL_BLOCKS))
      }
    }
    // The ruin: a 7 x 7 floor, broken walls, corner pillars, a lantern and a chest.
    const y0 = floorY
    for (let x = cx - 3; x <= cx + 3; x++) {
      for (let z = cz - 3; z <= cz + 3; z++) {
        this.cells.put(x, y0, z, Math.random() < 0.3 ? 'darkprismarine' : 'prismarinebricks')
        const edge = Math.abs(x - cx) === 3 || Math.abs(z - cz) === 3
        if (!edge) continue
        const corner = Math.abs(x - cx) === 3 && Math.abs(z - cz) === 3
        const door = x === cx && z === cz - 3
        const h = corner ? 4 : door ? 0 : Math.floor(Math.random() * 3.4)
        for (let k = 1; k <= h; k++) this.cells.put(x, y0 + k, z, corner && k === h ? 'sealantern' : Math.random() < 0.35 ? 'darkprismarine' : 'prismarinebricks')
      }
    }
    this.cells.put(cx, y0 + 1, cz, 'sealantern')
    this.cells.put(cx + 1, y0 + 1, cz + 1, 'lootchest')
    const ruin = { x: cx + 0.5, y: y0 + 1, z: cz + 0.5, seen: false }
    this.ruins.push(ruin)
    // Its guards.
    if (!s.net || s.net.isHost) {
      const kinds = REALM_KINDS.ocean
      for (let i = 0; i < SEA_ZOMBIES; i++) {
        const a = (i / SEA_ZOMBIES) * Math.PI * 2
        s._extraZombie?.(cx + 0.5 + Math.cos(a) * 1.5, y0 + 1, cz + 0.5 + Math.sin(a) * 1.5, kinds.length ? pick(kinds) : null)
      }
    }
    return ruin
  }

  clear() {
    this.cells.restore()
    this.ruins = []
    this._in = CHECK_S
  }
}

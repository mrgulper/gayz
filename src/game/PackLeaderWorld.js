// Pack Leaders standing in the world (2026-11-11, Team Battle batch 3;
// Gaymi picked "both": on the Pets tab and met in their biome). Owned by
// BuildSurvival (`s.leaders`), in the open world.
//
// Every CHECK_S seconds: in a biome that has a leader (PackLeaders.LEADERS)
// and none is out yet, theirs turns up NEAR..FAR blocks away in that same
// biome - a person (NpcPeople) with a name tag and a beam in their badge's
// colour (no beam once beaten). In the water biomes they stand on a raft.
// Walk far away (MOVE_AT) and they go. Close by, a pill says who they are;
// press Use next to them: the next leader on the ladder battles you (the
// same TeamBattle as the Pets tab, its prize and badge too), a locked one
// says who to beat first, a beaten one says you have their badge.
// While the battle is up nothing hurts you (BuildSurvival._hurtPlayer) and
// the mouse stays free (BuildMode.mouseScreenOpen). Each player's own;
// meshes only, never a light. Zombies never notice them.
import * as THREE from 'three'
import { t } from './i18n.js'
import { sampleLand, inCity } from './OpenWorld.js'
import { showPill, hidePill } from './PlayPills.js'
import { makePerson, disposePerson, boxIn, disposeGroup } from './NpcPeople.js'
import { LEADERS, leaderIndex, leaderStatus, leaderTitle, startLeaderBattle } from './PackLeaders.js'

export const NEAR = 12
export const FAR = 30
export const MOVE_AT = 120
export const CHECK_S = 4
export const USE_R = 3
const PILL_R = 9
const BEAM_H = 22

export class PackLeaderWorld {
  constructor(survival) {
    this.s = survival
    this.leader = null // { i, x, y, z, person, mark, beam }
    this.battling = false
    this._check = 1
  }

  get B() {
    return this.s.B
  }

  _allowed() {
    const s = this.s
    return !!s.bm.world?.active && !s.td && !s.escape && !s.party && !s.moon?.on
  }

  update(dt) {
    const s = this.s
    // The battle closed: back to the game.
    if (this.battling && !s.bm.game?._teamBattle?.root) {
      this.battling = false
      if (s.active && !s.dead) {
        try { s.bm.renderer.domElement.requestPointerLock()?.catch(() => {}) } catch { /* not available */ }
      }
    }
    if (!this._allowed()) {
      if (this.leader) this.clear()
      return
    }
    const me = s.bodyPos()
    this._check -= dt
    if (this._check <= 0) {
      this._check = CHECK_S
      if (this.leader && Math.hypot(me.x - this.leader.x, me.z - this.leader.z) > MOVE_AT) this.clear()
      if (!this.leader) this._find(me)
    }
    const L = this.leader
    if (!L) return
    if (L.person.body) L.person.group.rotation.y = Math.atan2(me.x - L.x, me.z - L.z)
    if (L.beam) L.beam.material.opacity = 0.22 + Math.sin(performance.now() / 300) * 0.08
    if (Math.hypot(me.x - L.x, me.z - L.z) < PILL_R && !s.dead) showPill('leader', this.prompt())
    else hidePill('leader')
  }

  prompt() {
    const i = this.leader.i
    const st = leaderStatus(i)
    if (st === 'next') return t('leaderPillNext', { name: leaderTitle(i) })
    if (st === 'beaten') return t('leaderPillBeaten', { name: leaderTitle(i) })
    return t('leaderPillLocked', { name: leaderTitle(i) })
  }

  // The leader of the biome I'm in, somewhere near in that biome.
  _find(me) {
    if (inCity(Math.floor(me.x), Math.floor(me.z))) return
    const biome = sampleLand(Math.floor(me.x), Math.floor(me.z))?.biome
    const i = leaderIndex(biome)
    if (i < 0) return
    const s = this.s
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      const fx = Math.floor(x)
      const fz = Math.floor(z)
      if (inCity(fx, fz) || sampleLand(fx, fz)?.biome !== biome) continue
      if (s.camp?.inside?.(x, z, 3)) continue
      let y = s._groundUnder(x, me.y + 20, z)
      if (!Number.isFinite(y) || Math.abs(y - me.y) > 16) continue
      // Water on top: stand on a raft on its surface.
      let cy = Math.floor(y)
      let wet = false
      while (cy < me.y + 24 && s.bm.getBlockAt(fx, cy, fz) === 'water') {
        cy++
        wet = true
      }
      if (wet) y = cy
      else {
        const under = s.bm.getBlockAt(fx, Math.floor(y) - 1, fz)
        if (!under || under === 'lava') continue
      }
      this._place(i, { x, y, z }, wet)
      return
    }
  }

  _place(i, at, raft) {
    const B = this.B
    const mark = new THREE.Group()
    mark.position.set(at.x * B, at.y * B, at.z * B)
    if (raft) {
      for (let k = 0; k < 4; k++) boxIn(mark, B, 0.45, 0.2, 2, k % 2 ? 0x8a5a32 : 0x6b4424, -0.7 + k * 0.47, -0.1, 0)
    }
    let beam = null
    if (leaderStatus(i) !== 'beaten') {
      beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2 * B, 0.35 * B, BEAM_H * B, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(LEADERS[i].color), transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      )
      beam.position.y = (BEAM_H / 2) * B
      mark.add(beam)
    }
    this.s.bm.scene.add(mark)
    const person = makePerson(this.s, at, t('leaderTag', { name: LEADERS[i].name }))
    this.leader = { i, ...at, person, mark, beam }
  }

  near() {
    const L = this.leader
    if (!L) return false
    const p = this.s.bodyPos()
    return Math.hypot(p.x - L.x, p.z - L.z) < USE_R && Math.abs(p.y - L.y) < 4
  }

  // Use next to the leader. -> true if one was there.
  use() {
    if (!this.near()) return false
    const s = this.s
    if (s.dead || this.battling) return true
    const game = s.bm.game
    if (!game) return true
    const say = (text) => s._message(text, 4)
    s.bm._keys?.clear?.()
    s.bm._fireHeld = false
    const battle = startLeaderBattle(game, this.leader.i, { world: true, say })
    if (battle) {
      this.battling = true
      if (document.pointerLockElement) document.exitPointerLock()
      hidePill('leader')
    }
    return true
  }

  clear() {
    const L = this.leader
    if (L) {
      disposePerson(L.person)
      disposeGroup(L.mark)
    }
    this.leader = null
    hidePill('leader')
  }
}

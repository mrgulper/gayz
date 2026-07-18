import * as THREE from 'three'

// Obsidian Ops-style defense mini-game: fixed boarded-window chokepoints
// along the street. Zombies that wander close enough tear a plank off over
// time; walking up and pressing the interact key re-boards one plank for a
// small points reward (capped per round so it can't be farmed indefinitely).
// Self-contained (own props, own state) - Game.js just calls update()/repair()
// and reacts to the onBreach callback, the same shape as Chests/XpGems.

const MAX_PLANKS = 5
const TEAR_RADIUS = 4.5
const TEAR_INTERVAL_MS = 2200
const TEAR_COOLDOWN_RATE = 500
// A group hitting the same window tears it down faster than a single
// zombie would - each extra attacker (beyond the first) speeds up tearing,
// capped so a real horde doesn't make a window vanish in one tick.
const TEAR_MULT_PER_EXTRA_ATTACKER = 0.4
const MAX_TEAR_MULT = 3
const REPAIR_RADIUS = 3.5
export const REPAIR_REWARD_POINTS = 10
export const REPAIR_REWARD_CAP_PER_ROUND = 100

const FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x1e1a14, roughness: 0.9 })
const PLANK_MAT = new THREE.MeshStandardMaterial({ color: 0x4a3a24, roughness: 0.85 })
const BREACH_GLOW_MAT = new THREE.MeshStandardMaterial({ color: 0x120302, emissive: 0x5a0e08, emissiveIntensity: 0.8, roughness: 1 })

export class BarricadeWindows {
  constructor(scene, positions) {
    this.scene = scene
    this.windows = positions.map((p) => this._buildWindow(p))
    this.rewardEarnedThisRound = 0
  }

  _buildWindow({ x, z, rotY = 0 }) {
    const group = new THREE.Group()
    group.position.set(x, 1.55, z)
    group.rotation.y = rotY
    this.scene.add(group)

    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.7, 0.08), FRAME_MAT)
    group.add(frame)

    const opening = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.4), BREACH_GLOW_MAT)
    opening.position.z = -0.03
    opening.visible = false
    group.add(opening)

    const plankMeshes = []
    for (let i = 0; i < MAX_PLANKS; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.22, 0.1), PLANK_MAT)
      plank.position.set(0, -0.62 + i * 0.32, 0.06)
      plank.rotation.z = (Math.random() - 0.5) * 0.05
      plank.castShadow = true
      group.add(plank)
      plankMeshes.push(plank)
    }

    const window = { x, z, group, opening, planks: MAX_PLANKS, maxPlanks: MAX_PLANKS, plankMeshes, tearProgress: 0 }
    this._syncVisuals(window)
    return window
  }

  _syncVisuals(w) {
    for (let i = 0; i < w.plankMeshes.length; i++) w.plankMeshes[i].visible = i < w.planks
    w.opening.visible = w.planks <= 0
  }

  // Called on respawn and each new round/night - fully re-boards every
  // window (a fresh run shouldn't start with last run's damage) and clears
  // the per-round points-earned cap.
  reset() {
    for (const w of this.windows) {
      w.planks = w.maxPlanks
      w.tearProgress = 0
      this._syncVisuals(w)
    }
    this.rewardEarnedThisRound = 0
  }

  // Just the earn-cap, called at the start of every subsequent round/night
  // (reset() above already covers the very first one) so repairing stays a
  // meaningful income source each round rather than a one-time-ever cap.
  onRoundStart() {
    this.rewardEarnedThisRound = 0
  }

  update(dt, zombies, onBreach) {
    for (const w of this.windows) {
      if (w.planks <= 0) continue
      let attackerCount = 0
      for (const z of zombies) {
        if (z.state !== 'alive') continue
        const d = Math.hypot(z.group.position.x - w.x, z.group.position.z - w.z)
        if (d <= TEAR_RADIUS) attackerCount++
      }
      if (attackerCount > 0) {
        const tearMult = Math.min(MAX_TEAR_MULT, 1 + (attackerCount - 1) * TEAR_MULT_PER_EXTRA_ATTACKER)
        w.tearProgress += dt * 1000 * tearMult
        if (w.tearProgress >= TEAR_INTERVAL_MS) {
          w.tearProgress = 0
          w.planks -= 1
          this._syncVisuals(w)
          if (w.planks <= 0 && onBreach) onBreach(w)
        }
      } else {
        w.tearProgress = Math.max(0, w.tearProgress - dt * TEAR_COOLDOWN_RATE)
      }
    }
  }

  // Nearest damaged (repairable) window within range of playerPos, or null.
  nearestRepairable(playerPos) {
    let nearest = null
    let nearestDist = REPAIR_RADIUS
    for (const w of this.windows) {
      if (w.planks >= w.maxPlanks) continue
      const d = Math.hypot(playerPos.x - w.x, playerPos.z - w.z)
      if (d < nearestDist) {
        nearest = w
        nearestDist = d
      }
    }
    return nearest
  }

  // Re-boards one plank and returns the points reward earned (0 once this
  // round's cap is hit, so repairing stays useful but not a farmable loop).
  repair(w) {
    if (!w || w.planks >= w.maxPlanks) return 0
    w.planks += 1
    w.tearProgress = 0
    this._syncVisuals(w)
    if (this.rewardEarnedThisRound >= REPAIR_REWARD_CAP_PER_ROUND) return 0
    const reward = Math.min(REPAIR_REWARD_POINTS, REPAIR_REWARD_CAP_PER_ROUND - this.rewardEarnedThisRound)
    this.rewardEarnedThisRound += reward
    return reward
  }
}

import * as THREE from 'three'

const DAY_MS = 12 * 60 * 1000
const NIGHT_MS = 12 * 60 * 1000
const CYCLE_MS = DAY_MS + NIGHT_MS
const DAY_FRACTION = DAY_MS / CYCLE_MS
const TRANSITION = 0.02 // ~29s fade in/out of the day fraction

const NIGHT = {
  background: 0x161c22,
  fog: 0x161c22,
  fogNear: 18,
  fogFar: 90,
  skyColor: 0x7f93ab,
  groundColor: 0x20201a,
  hemiIntensity: 0.85,
  sunColor: 0xc3d2ec,
  sunIntensity: 1.0,
  sunPos: new THREE.Vector3(30, 45, -15),
}

const DAY = {
  background: 0x9db4c8,
  fog: 0x9db4c8,
  fogNear: 34,
  fogFar: 140,
  skyColor: 0xcfe0ee,
  groundColor: 0x6b6352,
  hemiIntensity: 1.35,
  sunColor: 0xfff2d0,
  sunIntensity: 1.9,
  sunPos: new THREE.Vector3(45, 55, 12),
}

const _c1 = new THREE.Color()
const _c2 = new THREE.Color()

export class DayNightCycle {
  constructor(scene, hemiLight, sunLight) {
    this.scene = scene
    this.hemi = hemiLight
    this.sun = sunLight
    this.dayFactor = 0
    this.startedAt = performance.now()
  }

  getDayNumber() {
    const elapsed = performance.now() - this.startedAt
    return Math.floor(elapsed / CYCLE_MS) + 1
  }

  // Current phase label and time remaining until it flips, for the HUD clock.
  getPhaseInfo() {
    const elapsed = performance.now() - this.startedAt
    const pos = elapsed % CYCLE_MS
    if (pos < DAY_MS) {
      return { phase: 'Day', remainingMs: DAY_MS - pos }
    }
    return { phase: 'Night', remainingMs: CYCLE_MS - pos }
  }

  update() {
    const elapsed = performance.now() - this.startedAt
    const pos = (elapsed % CYCLE_MS) / CYCLE_MS

    let dayFactor
    if (pos < TRANSITION) {
      dayFactor = pos / TRANSITION
    } else if (pos < DAY_FRACTION - TRANSITION) {
      dayFactor = 1
    } else if (pos < DAY_FRACTION + TRANSITION) {
      dayFactor = 1 - (pos - (DAY_FRACTION - TRANSITION)) / (2 * TRANSITION)
    } else {
      dayFactor = 0
    }
    this.dayFactor = dayFactor

    _c1.setHex(NIGHT.background)
    _c2.setHex(DAY.background)
    _c1.lerp(_c2, dayFactor)
    this.scene.background.copy(_c1)

    _c1.setHex(NIGHT.fog)
    _c2.setHex(DAY.fog)
    _c1.lerp(_c2, dayFactor)
    this.scene.fog.color.copy(_c1)
    this.scene.fog.near = THREE.MathUtils.lerp(NIGHT.fogNear, DAY.fogNear, dayFactor)
    this.scene.fog.far = THREE.MathUtils.lerp(NIGHT.fogFar, DAY.fogFar, dayFactor)

    _c1.setHex(NIGHT.skyColor)
    _c2.setHex(DAY.skyColor)
    _c1.lerp(_c2, dayFactor)
    this.hemi.color.copy(_c1)

    _c1.setHex(NIGHT.groundColor)
    _c2.setHex(DAY.groundColor)
    _c1.lerp(_c2, dayFactor)
    this.hemi.groundColor.copy(_c1)

    this.hemi.intensity = THREE.MathUtils.lerp(NIGHT.hemiIntensity, DAY.hemiIntensity, dayFactor)

    _c1.setHex(NIGHT.sunColor)
    _c2.setHex(DAY.sunColor)
    _c1.lerp(_c2, dayFactor)
    this.sun.color.copy(_c1)
    this.sun.intensity = THREE.MathUtils.lerp(NIGHT.sunIntensity, DAY.sunIntensity, dayFactor)
    this.sun.position.lerpVectors(NIGHT.sunPos, DAY.sunPos, dayFactor)
  }
}

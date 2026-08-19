import * as THREE from 'three'

const DAY_MS = 12 * 60 * 1000
const NIGHT_MS = 12 * 60 * 1000
const CYCLE_MS = DAY_MS + NIGHT_MS
const DAY_FRACTION = DAY_MS / CYCLE_MS
const TRANSITION = 0.02 // ~29s fade in/out of the day fraction

// Grounded, desaturated moonlight instead of the neon purple/cyan cast -
// the cool tone here is meant to contrast against the warm practical
// lights (streetlamps, flashlight, muzzle flash) for a real warm/cool
// cinematic split rather than a single-hue wash.
// Brightened from the original 0.7/0.95 (see git history) - these were
// tuned assuming bloom's glow was still active to help sell "dark but
// readable" night. LOW_QUALITY_MODE (QualitySettings.js) disables bloom
// entirely and has been permanently on in production since before this
// fix, which left night reading as almost solid black outside of
// emissive-only objects (a zombie's glowing eyes, etc.) - confirmed via
// a live screenshot, not just a values guess. Kept as a genuinely darker
// mood than day (not brought up to day brightness), just no longer
// unreadable without bloom's help.
const NIGHT = {
  background: 0x1c2230,
  fog: 0x1e2530,
  fogNear: 20,
  fogFar: 90,
  skyColor: 0x6b7d94,
  groundColor: 0x1a1c18,
  hemiIntensity: 1.15,
  sunColor: 0xa7bfe0,
  sunIntensity: 1.3,
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

  // Sleep-to-skip-to-morning (batch feature) - jumps straight to the start
  // of the next day. Computed from the current day NUMBER rather than just
  // resetting startedAt to now, so getDayNumber() correctly advances by one
  // instead of resetting back to day 1.
  skipToMorning() {
    const dayNumber = this.getDayNumber()
    this.startedAt = performance.now() - dayNumber * CYCLE_MS
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

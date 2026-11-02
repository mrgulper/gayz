// Speedrun mode (2026-11-01, Gaymi's idea list 3: "a timer, ghost replays
// of your best run, and a leaderboard"). Game mode `speedrun` (PlayRules
// PLAY_GAME_MODES), alone only: clear SPEEDRUN_WAVES waves as fast as you
// can, with Zombie Rush's short breaks. The clock starts with wave 1 and
// stops when the last wave is cleared (BuildSurvival -> finish()).
//
// While you run, where you are is written down every STEP_S (up to
// MAX_SAMPLES). Beat your best and that path is kept (localStorage
// BEST_KEY, read back as untrusted) - next time a see-through blue ghost
// of you runs it alongside you, so you can see if you're ahead. Your best
// time goes up with your leaderboard entry (`speedrunMs`, OnlineUI) when
// you're signed in, and the win screen shows the world's fastest
// (CloudSync.fetchTopSpeedruns). Owned by BuildSurvival (`s.speedrun`).
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'

export const SPEEDRUN_WAVES = 5
export const BEST_KEY = 'gayz-speedrun-best'
const STEP_S = 0.2
const MAX_SAMPLES = 3000 // 10 minutes
export const TOP_N = 5
const GHOST_OPACITY = 0.35

// m:ss.t
export function runTime(ms) {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`
}

// The kept best run: { ms, path: [[x, y, z, yaw], ...] }, or null.
export function loadBest() {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) || 'null')
    if (!v || !Number.isFinite(v.ms) || v.ms < 1000 || !Array.isArray(v.path)) return null
    const path = v.path.slice(0, MAX_SAMPLES).filter((p) => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite))
    return { ms: Math.round(v.ms), path }
  } catch {
    return null
  }
}

export class Speedrun {
  constructor(survival) {
    this.s = survival
    this.best = loadBest()
    this.running = false
    this.t = 0
    this.path = []
    this._sampleIn = 0
    this.result = null
    this.top = null
    this.ghost = null
    if (this.best?.path.length) this._makeGhost()
  }

  _makeGhost() {
    const group = new THREE.Group()
    group.visible = false
    this.s.bm.scene.add(group)
    this.ghost = group
    loadSkinTexture(DEFAULT_SKIN_DATA_URL).then((skin) => {
      if (!this.ghost || !skin) return
      const body = buildTexturedCharacter(skin)
      const B = this.s.B
      const sc = (MOB_HEIGHT * B) / 32
      body.scale.setScalar(sc)
      body.position.y = 2 * sc
      body.traverse((o) => {
        if (!o.isMesh) return
        o.material = o.material.clone()
        o.material.transparent = true
        o.material.opacity = GHOST_OPACITY
        o.material.depthWrite = false
        o.material.color?.setRGB(0.55, 0.75, 1.3)
      })
      group.add(body)
    }).catch(() => { /* no ghost body */ })
  }

  // Wave 1 began: the clock starts.
  start() {
    if (this.running || this.result) return
    this.running = true
    this.t = 0
    this.path = []
    this._sampleIn = 0
  }

  update(dt) {
    if (!this.running) {
      if (!this.result) hidePill('speedrun')
      return
    }
    const s = this.s
    if (s.dead) return
    this.t += dt
    this._sampleIn -= dt
    if (this._sampleIn <= 0 && this.path.length < MAX_SAMPLES) {
      this._sampleIn = STEP_S
      const p = s.bodyPos()
      this.path.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), +s.bm._yaw.toFixed(2)])
    }
    const best = this.best
    showPill('speedrun', `⏱ ${runTime(this.t * 1000)}${best ? ` · ${t('speedrunBest')} ${runTime(best.ms)}` : ''}`, !!best && this.t * 1000 > best.ms)
    this._moveGhost()
  }

  // The ghost: where the best run was at this moment.
  _moveGhost() {
    const g = this.ghost
    const path = this.best?.path
    if (!g || !path?.length) return
    const f = this.t / STEP_S
    const i = Math.floor(f)
    if (i >= path.length - 1) {
      g.visible = false
      return
    }
    const a = path[i]
    const b = path[i + 1]
    const k = f - i
    const B = this.s.B
    g.visible = true
    g.position.set((a[0] + (b[0] - a[0]) * k) * B, (a[1] + (b[1] - a[1]) * k) * B, (a[2] + (b[2] - a[2]) * k) * B)
    g.rotation.y = a[3] + Math.PI
  }

  // The last wave was cleared. -> { ms, isBest, best }.
  finish() {
    if (!this.running) return this.result
    this.running = false
    const ms = Math.round(this.t * 1000)
    const isBest = !this.best || ms < this.best.ms
    if (isBest) {
      this.best = { ms, path: this.path }
      try { localStorage.setItem(BEST_KEY, JSON.stringify(this.best)) } catch { /* storage full */ }
    }
    this.result = { ms, isBest, best: this.best.ms }
    hidePill('speedrun')
    if (this.ghost) this.ghost.visible = false
    this._fetchTop()
    return this.result
  }

  // The world's fastest, for the win screen (online only).
  async _fetchTop() {
    try {
      const CloudSync = await import('./CloudSync.js')
      if (!CloudSync.isConfigured()) return
      this.top = await CloudSync.fetchTopSpeedruns(TOP_N)
      this.s._showSpeedrunResult?.()
    } catch { /* offline */ }
  }

  // The win screen's line: this time, the best and the world's top.
  text() {
    const r = this.result
    if (!r) return ''
    let out = `${t('speedrunTime', { t: runTime(r.ms) })}${r.isBest ? ` · ${t('speedrunNewBest')}` : ` · ${t('speedrunBest')} ${runTime(r.best)}`}`
    if (this.top?.length) out += ` · ${t('speedrunWorldTop')} ${this.top.map((e, i) => `${i + 1}. ${String(e.name || '?').slice(0, 20)} ${runTime(e.speedrunMs)}`).join(', ')}`
    return out
  }

  dispose() {
    hidePill('speedrun')
    if (this.ghost) {
      this.ghost.removeFromParent()
      this.ghost.traverse((o) => { if (o.isMesh) o.material.dispose() })
      this.ghost = null
    }
  }
}

// Playable instruments (2026-11-09, Gaymi's idea list 9: "hold a guitar or
// drums and play notes with number keys, and jam with friends at camp" -
// found in the world, WorldFinds.js).
//
// Hold a Guitar or Drums and use it to start playing (use again, or put it
// away, to stop). While playing, keys 1-8 play its 8 notes instead of
// picking a hotbar slot, and a pad of 8 buttons shows over the hotbar for
// phones (and mouse players). The Guitar plays a pentatonic scale (any
// notes sound fine together); the Drums are a kick, snare, toms, hi-hat,
// clap and crash. Each note floats a little coloured note up over you.
//
// On a server the others hear you (quieter further off, up to HEAR_R
// blocks) and see the notes: what you played since the last sync goes out
// as `jam` ({ i: 'g' | 'd', n: count, k: '1352' }, api/_lib/servers.js).
// Two or more people playing close together (JAM_R) is a Jam Session.
// Meshes / sprites only, never a light. Owned by BuildSurvival (`s.music`).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

export const NOTES = 8
export const HEAR_R = 30
export const JAM_R = 8
const JAM_SAY_EVERY_S = 60
// C major pentatonic, two octaves' worth.
const GUITAR_HZ = [196, 220, 262, 294, 330, 392, 440, 523]
const DRUM_KEYS = ['drumKick', 'drumSnare', 'drumTomLow', 'drumTomHigh', 'drumHat', 'drumClap', 'drumCrash', 'drumRim']
export const INSTRUMENT_ITEMS = { guitar: 'g', drums: 'd' }
const NOTE_COLORS = ['#ff6b6b', '#ffb54a', '#ffe14a', '#7ad04a', '#4ad0c4', '#5aa7d8', '#a07aff', '#ff7ad6']

let _noise = null
function noiseBuffer(ctx) {
  if (_noise && _noise.sampleRate === ctx.sampleRate) return _noise
  _noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate)
  const d = _noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return _noise
}

// One note of an instrument ('g' / 'd', note 0-7), `vol` 0-1.
export function playInstrument(i, n, vol = 1) {
  const ctx = audioEngine.ctx
  if (!ctx || vol <= 0.01) return
  const out = audioEngine.sfxGain
  const now = ctx.currentTime
  const tone = (hz, type, gain, len, endHz = hz) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(hz, now)
    if (endHz !== hz) o.frequency.exponentialRampToValueAtTime(endHz, now + len)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(gain * vol, now + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, now + len)
    o.connect(g).connect(out)
    o.start(now)
    o.stop(now + len + 0.02)
  }
  const hiss = (type, hz, gain, len) => {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx)
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = hz
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain * vol, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + len)
    src.connect(f).connect(g).connect(out)
    src.start(now)
    src.stop(now + len + 0.02)
  }
  if (i === 'g') {
    // A plucked string: bright at first, fading out.
    const hz = GUITAR_HZ[n]
    tone(hz, 'sawtooth', 0.09, 1.1)
    tone(hz, 'triangle', 0.16, 1.4)
    tone(hz * 2, 'sine', 0.05, 0.5)
    return
  }
  if (n === 0) tone(150, 'sine', 0.6, 0.35, 45)
  else if (n === 1) { hiss('highpass', 1500, 0.35, 0.18); tone(190, 'triangle', 0.2, 0.1) }
  else if (n === 2) tone(110, 'sine', 0.45, 0.4, 70)
  else if (n === 3) tone(180, 'sine', 0.4, 0.3, 120)
  else if (n === 4) hiss('highpass', 7000, 0.2, 0.06)
  else if (n === 5) { hiss('bandpass', 1200, 0.4, 0.12); hiss('bandpass', 1400, 0.25, 0.2) }
  else if (n === 6) hiss('highpass', 4000, 0.3, 1.2)
  else tone(800, 'square', 0.12, 0.05)
}

function noteTexture(color) {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')
  g.font = 'bold 28px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 4
  g.strokeStyle = 'rgba(0,0,0,0.55)'
  g.strokeText('♪', 16, 17)
  g.fillStyle = color
  g.fillText('♪', 16, 17)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Instruments {
  constructor(survival) {
    this.s = survival
    this.on = '' // 'g' | 'd' | ''
    this._queue = ''
    this._sent = { i: '', n: 0, k: '' }
    this._floaters = []
    this._mats = null
    this._remoteN = new Map() // player id -> last jam count heard
    this._jamSaidAt = -Infinity
    this._time = 0
    this._pad = null
  }

  get held() {
    const it = this.s.inv?.selected()
    return (it?.kind === 'item' && INSTRUMENT_ITEMS[it.id]) || ''
  }

  // Used (PlayInventory.useHeld): start or stop playing.
  use() {
    const s = this.s
    if (!s.active || s.dead) return
    if (this.on) return this.off()
    const i = this.held
    if (!i) return
    this.on = i
    this._showPad()
    s._message(t(i === 'g' ? 'musicGuitarOn' : 'musicDrumsOn'), 3)
  }

  off() {
    if (!this.on) return
    this.on = ''
    this._showPad()
  }

  // BuildMode's hotbar keys: 1-8 play a note while playing.
  key(code) {
    if (!this.on) return false
    const m = /^Digit([1-8])$/.exec(code)
    if (!m) return false
    this.play(Number(m[1]) - 1)
    return true
  }

  play(n) {
    if (!this.on || n < 0 || n >= NOTES) return
    playInstrument(this.on, n, 1)
    const me = this.s.bodyPos()
    this._float(me.x, me.y, me.z, n)
    this._queue = (this._queue + String(n + 1)).slice(-16)
    this._playedAt = this._time
  }

  // My jam for the next sync: the notes since the last one.
  snapshot() {
    if (this._queue) {
      this._sent = { i: this.on || this._sent.i || 'g', n: (this._sent.n + 1) % 1e6, k: this._queue }
      this._queue = ''
    }
    return this._sent.n ? this._sent : null
  }

  // Everyone else's notes (PlayNet, each sync).
  syncRemote(players) {
    const me = this.s.bodyPos()
    for (const [pid, p] of players) {
      const j = p.jam
      if (!j || !p.seen) continue
      const last = this._remoteN.get(pid)
      this._remoteN.set(pid, j.n)
      if (last === undefined || last === j.n) continue
      p.jamAt = this._time
      const d = Math.hypot(p.x - me.x, p.z - me.z)
      const vol = Math.max(0, 1 - d / HEAR_R)
      // Spread the batch over the time between syncs.
      ;[...j.k].forEach((ch, k) => {
        const n = Number(ch) - 1
        setTimeout(() => {
          if (!this.s.active) return
          playInstrument(j.i, n, vol)
          this._float(p.x, p.y, p.z, n)
        }, k * 110)
      })
    }
  }

  update(dt) {
    const s = this.s
    this._time += dt
    if (this.on && (!s.active || s.dead || this.held !== this.on)) this.off()
    this._drawFloaters(dt)
    this._jam()
  }

  // Two or more playing close together: a Jam Session.
  _jam() {
    const s = this.s
    if (!this.on || this._time - (this._playedAt ?? -99) > 4 || this._time - this._jamSaidAt < JAM_SAY_EVERY_S) return
    const me = s.bodyPos()
    for (const [, p] of s.net?.players || []) {
      if (!p.seen || this._time - (p.jamAt ?? -99) > 4) continue
      if (Math.hypot(p.x - me.x, p.z - me.z) > JAM_R) continue
      this._jamSaidAt = this._time
      s._message(t('musicJam', { name: p.nick || 'Survivor' }), 3)
      try { audioEngine.playSpecial?.('chime') } catch { /* no audio */ }
      return
    }
  }

  _float(x, y, z, n) {
    const B = this.s.B
    if (!this._mats) this._mats = NOTE_COLORS.map((c) => new THREE.SpriteMaterial({ map: noteTexture(c), transparent: true, depthWrite: false }))
    const sp = new THREE.Sprite(this._mats[n].clone())
    sp.scale.setScalar(0.45 * B)
    const a = Math.random() * Math.PI * 2
    sp.position.set((x + Math.cos(a) * 0.4) * B, (y + 2.1) * B, (z + Math.sin(a) * 0.4) * B)
    this.s.bm.scene.add(sp)
    this._floaters.push({ sp, left: 1.2 })
    while (this._floaters.length > 40) this._dropFloater(this._floaters.shift())
  }

  _drawFloaters(dt) {
    const B = this.s.B
    for (const f of this._floaters) {
      f.left -= dt
      f.sp.position.y += dt * 1.1 * B
      f.sp.material.opacity = Math.max(0, f.left / 1.2)
    }
    for (const f of this._floaters.filter((x) => x.left <= 0)) this._dropFloater(f)
    this._floaters = this._floaters.filter((x) => x.left > 0)
  }

  _dropFloater(f) {
    f.sp.removeFromParent()
    f.sp.material.dispose()
  }

  // 8 buttons over the hotbar while playing (phones, and mouse players).
  _showPad() {
    if (!this._pad) {
      const el = document.createElement('div')
      el.id = 'music-pad'
      for (let n = 0; n < NOTES; n++) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.n = String(n)
        b.style.setProperty('--note', NOTE_COLORS[n])
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          e.stopPropagation()
          this.play(n)
        })
        el.appendChild(b)
      }
      document.body.appendChild(el)
      this._pad = el
    }
    this._pad.classList.toggle('on', !!this.on)
    this._pad.classList.toggle('drums', this.on === 'd')
    this._pad.querySelectorAll('button').forEach((b, n) => {
      b.textContent = this.on === 'd' ? `${n + 1} ${t(DRUM_KEYS[n])}` : `${n + 1} ♪`
      b.title = this.on === 'd' ? t(DRUM_KEYS[n]) : ''
    })
  }

  clear() {
    this.off()
    for (const f of this._floaters) this._dropFloater(f)
    this._floaters = []
    this._remoteN.clear()
    this._queue = ''
  }
}

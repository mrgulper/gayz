// Clip Maker, Batch 1 (2026-11-19, big-ideas plan): the game keeps the
// last ~30 seconds of what you see, and Save Clip (K, or the pause
// screen's button) saves them as a video file.
//
// How: the game's canvas is turned into a live video (captureStream) and
// MediaRecorder writes it. A video file can't have its start cut off, so
// instead of one long recording there are a few overlapping ones: a new
// one starts every STAGGER seconds and each lives LIFE seconds. When you
// save, the youngest one that's already KEEP seconds old is stopped and
// becomes the file (KEEP to LIFE seconds long); the others carry on.
// Only the 3D picture is in the clip - no buttons or bars - and no sound
// yet (Batch 2 brings options). Recording pauses while the pause screen
// is up or the tab is hidden, so the clip is all gameplay.
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'

export const KEEP = 30 // seconds a saved clip is at least (once there's that much)
const STAGGER = 15 // a new recording every this many seconds
const LIFE = KEEP + STAGGER // each recording is thrown away after this
const MIN_AGE = 2 // shorter than this isn't worth a file
const FPS = 30
const BITRATE = 4_000_000
// MP4 first (plays straight away on phones and in chat apps), then WebM.
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

export function clipsSupported() {
  return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

function pickType() {
  for (const type of TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // Older browsers throw on unknown strings.
    }
  }
  return ''
}

export class ClipMaker {
  constructor(survival) {
    this.s = survival
    this.on = false
    this.paused = false
    this.saving = false
    this._recs = [] // { rec, age, chunks }
    this._stream = null
    this._last = 0
    this._type = ''
    this._pillTimer = 0
  }

  // A run starts: begin keeping the last seconds. Automated test browsers
  // skip it (three video encoders would slow every other test) unless a
  // test asks for it with window.__clipTest.
  begin() {
    this.end()
    if (!clipsSupported()) return
    if (navigator.webdriver && !window.__clipTest) return
    const canvas = this.s.bm.renderer?.domElement
    if (!canvas) return
    try {
      this._stream = canvas.captureStream(FPS)
    } catch {
      this._stream = null
      return
    }
    this._type = pickType()
    this.on = true
    this.paused = false
    this._last = performance.now()
    this._spawn()
  }

  // The run is over: every recording stops and is thrown away.
  end() {
    for (const r of this._recs) this._drop(r)
    this._recs = []
    this._stream?.getTracks().forEach((tr) => tr.stop())
    this._stream = null
    this.on = false
  }

  // The pause screen opens or closes.
  setPaused(on) {
    on = !!on
    if (this.paused === on) return
    this.paused = on
    for (const r of this._recs) {
      try {
        if (on && r.rec.state === 'recording') r.rec.pause()
        else if (!on && r.rec.state === 'paused') r.rec.resume()
      } catch {
        // A recording that already stopped.
      }
    }
  }

  // Every frame of the run (BuildSurvival.update). Ages are real seconds
  // of recording, not game time (a slow machine's game time runs slow).
  update() {
    if (!this.on) return
    const now = performance.now()
    const d = Math.min((now - this._last) / 1000, 0.5)
    this._last = now
    const hidden = typeof document !== 'undefined' && document.hidden
    if (hidden !== this._hidden) {
      this._hidden = hidden
      this.setPaused(hidden || !!this.s.bm.menuOpen)
    }
    if (this.paused) return
    for (const r of this._recs) r.age += d
    for (const r of this._recs.filter((x) => x.age >= LIFE)) this._drop(r)
    this._recs = this._recs.filter((x) => x.age < LIFE)
    const newest = this._recs[this._recs.length - 1]
    if (!newest || newest.age >= STAGGER) this._spawn()
  }

  // How many seconds a clip saved now would hold (0 = nothing yet).
  available() {
    return this._pick()?.age ?? 0
  }

  // Save Clip: the last ~30 s become a video file. Resolves to the clip's
  // { blob, seconds, name } (or null when there's nothing to save).
  async save() {
    if (!clipsSupported()) {
      this._say(t('clipNoSupport'))
      return null
    }
    if (this.saving) return null
    const r = this._pick()
    if (!this.on || !r || r.age < MIN_AGE) {
      this._say(t('clipNotYet'))
      return null
    }
    this.saving = true
    this._recs = this._recs.filter((x) => x !== r)
    // Something always keeps recording for the next clip.
    if (!this._recs.length) this._spawn()
    this._say(t('clipSaving'), 0)
    const seconds = Math.round(r.age)
    const blob = await new Promise((resolve) => {
      r.rec.onstop = () => resolve(new Blob(r.chunks, { type: r.rec.mimeType || this._type || 'video/webm' }))
      try {
        if (r.rec.state === 'paused') r.rec.resume()
        r.rec.stop()
      } catch {
        resolve(null)
      }
    })
    this.saving = false
    if (!blob || !blob.size) {
      this._say(t('clipNotYet'))
      return null
    }
    const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm'
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const name = `gayz-clip-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`
    this._download(blob, name)
    this._say(t('clipSaved', { n: seconds }))
    this.lastClip = { size: blob.size, seconds, name, type: blob.type }
    return { blob, seconds, name }
  }

  // The recording a save would use: the youngest that's already KEEP
  // seconds old, or the oldest when none is yet.
  _pick() {
    const ready = this._recs.filter((r) => r.age >= KEEP)
    if (ready.length) return ready[ready.length - 1]
    return this._recs[0] || null
  }

  _spawn() {
    if (!this._stream) return
    let rec
    try {
      const opts = { videoBitsPerSecond: BITRATE }
      if (this._type) opts.mimeType = this._type
      rec = new MediaRecorder(this._stream, opts)
    } catch {
      try {
        rec = new MediaRecorder(this._stream)
      } catch {
        return
      }
    }
    const r = { rec, age: 0, chunks: [] }
    rec.ondataavailable = (e) => {
      if (e.data?.size) r.chunks.push(e.data)
    }
    try {
      rec.start()
      if (this.paused) rec.pause()
    } catch {
      return
    }
    this._recs.push(r)
  }

  _drop(r) {
    r.rec.ondataavailable = null
    r.rec.onstop = null
    try {
      if (r.rec.state !== 'inactive') r.rec.stop()
    } catch {
      // Already stopped.
    }
    r.chunks = []
  }

  _download(blob, name) {
    try {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch {
      // Downloads blocked - nothing more to do.
    }
  }

  // A pill over the hotbar (and the pause screen's status line when it's
  // up); hides itself after a moment unless ms is 0.
  _say(text, ms = 2600) {
    showPill('clip', text)
    const status = document.getElementById('play-pause-status')
    if (status && this.s.bm.menuOpen) status.textContent = text
    clearTimeout(this._pillTimer)
    if (ms) this._pillTimer = setTimeout(() => hidePill('clip'), ms)
  }
}

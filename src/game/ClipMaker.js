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
// Only the 3D picture is in the clip - no buttons or bars. Recording
// pauses while the pause screen is up or the tab is hidden, so the clip is
// all gameplay.
//
// Batch 2 (2026-11-19): Clip Options on the pause screen (PlayPauseMenu.js)
// - Video or GIF, length 10 / 20 / 30 s or Custom (5-60 s), sound on or
// off (videos only - the game's own sound, at your volume), and for GIFs
// Small (320 px) or Big (480 px). Kept on this device in
// localStorage 'gayz-clip-options'. A video is the length you picked up
// to half as long again (see above); a GIF is exactly it (ClipGif.js).
// Changing an option starts the recording fresh.
//
// Batch 3 (2026-11-19): Speed (1x, 0.5x, 0.25x or Custom 0.1-1x) and
// Replay Clip. A slow GIF just waits longer on each picture; a slow video
// is played back slowly in a hidden player and recorded again (so it
// takes clip length / speed to make, and has no sound). Replay Clip
// (solo only) rewinds the last seconds with DeathReplay.js and films them
// from the Replay Camera you picked: circle, behind, top-down, side or
// custom. Both kinds are at most REPLAY_MAX_FILM seconds of film.
import { t } from './i18n.js'
import { showPill, hidePill } from './PlayPills.js'
import { audioEngine } from './Audio.js'
import { GIF_FPS, encodeGifFrame, gifBlob, slowGifFrame } from './ClipGif.js'
import { REPLAY_ANGLES } from './DeathReplay.js'

export const KEEP = 30 // the default length (seconds)
export const CLIP_LENGTHS = [10, 20, 30]
export const CLIP_LEN_MIN = 5
export const CLIP_LEN_MAX = 60
export const GIF_SIZES = { small: 320, big: 480 } // the long side, in pixels
export const CLIP_SPEEDS = [1, 0.5, 0.25]
export const CLIP_SPEED_MIN = 0.1
export const CLIP_SPEED_MAX = 1
export const CAM_LIMITS = { dist: [2, 15], height: [0, 15], turn: [0, 355] }
export const REPLAY_MAX_FILM = 60 // seconds of film a replay can make
const OPTIONS_KEY = 'gayz-clip-options'
const MIN_AGE = 2 // shorter than this isn't worth a file
const FPS = 30
const BITRATE = 4_000_000
// MP4 first (plays straight away on phones and in chat apps), then WebM.
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
const TYPES_SOUND = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']

// Recording needs the canvas as a live video; videos also need
// MediaRecorder (without it, clips are GIFs).
export function clipsSupported() {
  return typeof window !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

function videoSupported() {
  return typeof window.MediaRecorder === 'function'
}

export function defaultClipOptions() {
  return { type: 'video', len: KEEP, sound: true, gifSize: 'small', speed: 1, angle: 'circle', cam: { dist: 5, height: 2, turn: 45 } }
}

const clamp = (v, [lo, hi], d) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// Anything odd in storage falls back to the defaults.
export function cleanClipOptions(o) {
  const d = defaultClipOptions()
  if (!o || typeof o !== 'object') return d
  const len = Math.round(Number(o.len))
  const cam = o.cam && typeof o.cam === 'object' ? o.cam : {}
  return {
    type: o.type === 'gif' ? 'gif' : 'video',
    len: Number.isFinite(len) ? Math.min(CLIP_LEN_MAX, Math.max(CLIP_LEN_MIN, len)) : d.len,
    sound: o.sound !== false,
    gifSize: o.gifSize === 'big' ? 'big' : 'small',
    // Hundredths are plenty (0.35x).
    speed: Math.round(clamp(o.speed ?? 1, [CLIP_SPEED_MIN, CLIP_SPEED_MAX], 1) * 100) / 100,
    angle: REPLAY_ANGLES.includes(o.angle) ? o.angle : d.angle,
    cam: {
      dist: Math.round(clamp(cam.dist, CAM_LIMITS.dist, d.cam.dist)),
      height: Math.round(clamp(cam.height, CAM_LIMITS.height, d.cam.height)),
      turn: Math.round(clamp(cam.turn, CAM_LIMITS.turn, d.cam.turn)),
    },
  }
}

export function loadClipOptions() {
  try {
    return cleanClipOptions(JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null'))
  } catch {
    return defaultClipOptions()
  }
}

function storeClipOptions(o) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o))
  } catch {
    // Storage full or blocked - the options last this visit only.
  }
}

function pickType(types) {
  for (const type of types) {
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
    this.options = loadClipOptions()
    this.mode = 'video'
    this._audioDest = null
    this._gif = null
    this._setLength()
  }

  // A video is KEEP to LIFE seconds: a new recording every STAGGER seconds
  // (half the length, 5-15 s, so a short clip isn't much longer than asked
  // for and a long one doesn't run too many recordings at once).
  _setLength() {
    this.keep = this.options.len
    this.stagger = Math.min(15, Math.max(5, Math.round(this.keep / 2)))
    this.life = this.keep + this.stagger
  }

  // Clip Options' Done: keep the new picks and start recording fresh with
  // them (when anything changed).
  setOptions(o) {
    const next = cleanClipOptions(o)
    const same = JSON.stringify(next) === JSON.stringify(this.options)
    this.options = next
    storeClipOptions(next)
    this._setLength()
    if (same || !this.on) return same
    const menu = !!this.s.bm.menuOpen
    this.begin()
    this.setPaused(menu)
    return same
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
    this.mode = this.options.type === 'gif' || !videoSupported() ? 'gif' : 'video'
    this.on = true
    this.paused = false
    this._hidden = false
    this._last = performance.now()
    if (this.mode === 'gif') {
      this._startGif()
      return
    }
    // Sound: everything the game plays meets at audioEngine.outGain on its
    // way to the speakers; a copy of it goes into the clip too.
    const ae = audioEngine
    if (this.options.sound && this.options.speed >= 1 && ae.ctx && ae.outGain && typeof ae.ctx.createMediaStreamDestination === 'function') {
      try {
        this._audioDest = ae.ctx.createMediaStreamDestination()
        ae.outGain.connect(this._audioDest)
        this._stream = new MediaStream([...this._stream.getVideoTracks(), ...this._audioDest.stream.getAudioTracks()])
      } catch {
        this._unhookSound()
      }
    }
    this._type = pickType(this._audioDest ? TYPES_SOUND : TYPES)
    this._spawn()
  }

  _unhookSound() {
    if (!this._audioDest) return
    try {
      audioEngine.outGain?.disconnect(this._audioDest)
    } catch {
      // Already apart.
    }
    this._audioDest = null
  }

  // --- GIF: a picture every 1/GIF_FPS s from the live video, shrunk,
  // turned into GIF bytes (in a worker when the browser has them) and kept
  // for the last `len` seconds.
  _startGif() {
    this._gif = this._newGif(this._stream, Math.round(this.keep * GIF_FPS))
  }

  // A GIF maker for a live video: its pictures, at most max of them.
  _newGif(stream, max) {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    video.play?.()?.catch?.(() => {})
    const canvas = document.createElement('canvas')
    const g = { video, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), frames: [], pending: 0, wait: 0, nextId: 0, worker: null, flushers: [], max }
    try {
      g.worker = new Worker(new URL('./ClipGifWorker.js', import.meta.url), { type: 'module' })
      g.worker.onmessage = (e) => {
        const { bytes, w, h } = e.data
        bytes.w = w
        bytes.h = h
        this._gifDone(g, bytes)
      }
      g.worker.onerror = () => {
        g.worker?.terminate()
        g.worker = null
        g.pending = 0
        this._gifFlushed(g)
      }
    } catch {
      g.worker = null
    }
    return g
  }

  _gifDone(g, bytes) {
    g.pending = Math.max(0, g.pending - 1)
    // A picture of a different size (the window was resized) can't share a
    // file with the others: start over from it.
    if (g.frames.length && (g.frames[0].w !== bytes.w || g.frames[0].h !== bytes.h)) g.frames = []
    g.frames.push(bytes)
    const max = g.max ?? Math.round(this.keep * GIF_FPS)
    if (g.frames.length > max) g.frames.splice(0, g.frames.length - max)
    this._gifFlushed(g)
  }

  _gifFlushed(g) {
    if (g.pending) return
    for (const f of g.flushers.splice(0)) f()
  }

  _grabGif(d, g = this._gif) {
    if (!g) return
    g.wait += d
    if (g.wait < 1 / GIF_FPS) return
    g.wait = Math.min(g.wait - 1 / GIF_FPS, 1 / GIF_FPS)
    const v = g.video
    if (!v.videoWidth || !v.videoHeight) return
    // A slow machine: skip a picture rather than pile them up.
    if (g.pending > 3) return
    const long = GIF_SIZES[this.options.gifSize] || GIF_SIZES.small
    const scale = Math.min(1, long / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.max(2, Math.round(v.videoWidth * scale))
    const h = Math.max(2, Math.round(v.videoHeight * scale))
    if (g.canvas.width !== w || g.canvas.height !== h) {
      g.canvas.width = w
      g.canvas.height = h
    }
    let data
    try {
      g.ctx.drawImage(v, 0, 0, w, h)
      data = g.ctx.getImageData(0, 0, w, h).data
    } catch {
      return
    }
    g.pending++
    if (g.worker) {
      g.worker.postMessage({ id: g.nextId++, data: data.buffer, w, h }, [data.buffer])
    } else {
      const bytes = encodeGifFrame(data, w, h)
      bytes.w = w
      bytes.h = h
      this._gifDone(g, bytes)
    }
  }

  _stopGif(g = this._gif) {
    if (!g) return
    g.worker?.terminate()
    try {
      g.video.pause()
      g.video.srcObject = null
    } catch {
      // Already stopped.
    }
    for (const f of g.flushers.splice(0)) f()
    if (g === this._gif) this._gif = null
  }

  async _saveGif() {
    const g = this._gif
    if (!g || g.frames.length < MIN_AGE * GIF_FPS) {
      this._say(t('clipNotYet'))
      return null
    }
    this.saving = true
    this._say(t('clipMakingGif'), 0)
    // The last few pictures still being made.
    if (g.pending) await new Promise((resolve) => g.flushers.push(resolve))
    const speed = this.options.speed
    const frames = speed < 1 ? g.frames.map((f) => slowGifFrame(f, speed)) : g.frames.slice()
    const { w, h } = g.frames[g.frames.length - 1]
    const blob = gifBlob(frames, w, h)
    this.saving = false
    const seconds = Math.round(frames.length / GIF_FPS / speed)
    const name = this._fileName('gif')
    this._download(blob, name)
    this._say(t('clipSavedGif', { n: seconds }))
    this.lastClip = { size: blob.size, seconds, name, type: blob.type, w, h }
    return { blob, seconds, name }
  }

  _fileName(ext) {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `gayz-clip-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`
  }

  // The run is over: every recording stops and is thrown away.
  end() {
    for (const r of this._recs) this._drop(r)
    this._recs = []
    this._stopGif()
    this._unhookSound()
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
    // A Replay Clip being filmed as a GIF (it plays while the pause
    // screen is up, so before the pause check).
    const film = this._film
    if (film?.g) {
      const t0 = performance.now()
      this._grabGif(Math.min((t0 - film.last) / 1000, 0.5), film.g)
      film.last = t0
    }
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
    if (this.mode === 'gif') {
      this._grabGif(d)
      return
    }
    for (const r of this._recs) r.age += d
    for (const r of this._recs.filter((x) => x.age >= this.life)) this._drop(r)
    this._recs = this._recs.filter((x) => x.age < this.life)
    const newest = this._recs[this._recs.length - 1]
    if (!newest || newest.age >= this.stagger) this._spawn()
  }

  // How many seconds a clip saved now would hold (0 = nothing yet).
  available() {
    if (this.mode === 'gif') return (this._gif?.frames.length || 0) / GIF_FPS
    return this._pick()?.age ?? 0
  }

  // Save Clip: the last seconds become a video (or GIF) file. Resolves to the clip's
  // { blob, seconds, name } (or null when there's nothing to save).
  async save() {
    if (!clipsSupported()) {
      this._say(t('clipNoSupport'))
      return null
    }
    if (this.saving) return null
    if (this.on && this.mode === 'gif') return this._saveGif()
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
    let seconds = Math.round(r.age)
    let blob = await new Promise((resolve) => {
      r.rec.onstop = () => resolve(new Blob(r.chunks, { type: r.rec.mimeType || this._type || 'video/webm' }))
      try {
        if (r.rec.state === 'paused') r.rec.resume()
        r.rec.stop()
      } catch {
        resolve(null)
      }
    })
    const speed = this.options.speed
    if (blob?.size && speed < 1) {
      blob = await this._slowVideo(blob, speed, seconds)
      seconds = Math.round(seconds / speed)
    }
    this.saving = false
    if (!blob || !blob.size) {
      this._say(t('clipNotYet'))
      return null
    }
    const name = this._fileName(/mp4/.test(blob.type) ? 'mp4' : 'webm')
    this._download(blob, name)
    this._say(t('clipSaved', { n: seconds }))
    this.lastClip = { size: blob.size, seconds, name, type: blob.type }
    return { blob, seconds, name }
  }

  // Slow-mo for a video: it's played at `speed` in a hidden player, drawn
  // onto a canvas and recorded again (no sound - slowed sound is a
  // growl). Takes seconds / speed to make; the pill counts it up. Resolves
  // to the slow video, or null when the browser can't.
  async _slowVideo(blob, speed, seconds) {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    // Some phones only play a video that's on the page.
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none'
    document.body.appendChild(video)
    let rec = null
    let stream = null
    let timer = 0
    const done = () => {
      clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
      video.pause()
      video.remove()
      URL.revokeObjectURL(url)
    }
    try {
      video.src = url
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve
        video.onerror = reject
      })
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')
      stream = canvas.captureStream(FPS)
      const type = pickType(TYPES)
      rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE })
      const chunks = []
      rec.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data)
      }
      const stopped = new Promise((resolve) => (rec.onstop = resolve))
      video.defaultPlaybackRate = speed
      video.playbackRate = speed
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      rec.start()
      await video.play()
      const total = Math.max(1, seconds / speed)
      const t0 = performance.now()
      // A timer, not animation frames: those stop in a hidden tab.
      await new Promise((resolve) => {
        video.onended = resolve
        timer = setInterval(() => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const gone = (performance.now() - t0) / 1000
          this._say(t('clipMakingSlow', { p: Math.min(99, Math.round((gone / total) * 100)) }), 0)
          // A video that never says it ended.
          if (gone > total + 10) resolve()
        }, 1000 / FPS)
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      rec.stop()
      await stopped
      done()
      const out = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' })
      return out.size ? out : null
    } catch {
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        // Already stopped.
      }
      done()
      return null
    }
  }

  // Replay Clip (solo games, from the pause screen): the last seconds are
  // rewound and played back slowly (DeathReplay.js) from the Replay
  // Camera, and that is filmed - as a video, or a GIF if that's picked.
  // Escape, Space, Enter or a tap cancels. Resolves like save().
  async saveReplay() {
    const s = this.s
    if (!clipsSupported()) {
      this._say(t('clipNoSupport'))
      return null
    }
    if (this.saving || this._film || s.replay?.active) return null
    const online = (s.net && !s.net.closed) || (s.lobby && !s.lobby.closed)
    if (online || s.dead || !s.replay) {
      this._say(t('clipReplaySolo'))
      return null
    }
    if (s.replay.recorded() < MIN_AGE) {
      this._say(t('clipNotYet'))
      return null
    }
    const o = this.options
    const span = Math.min(o.len, REPLAY_MAX_FILM * o.speed)
    const canvas = s.bm.renderer?.domElement
    let stream
    try {
      stream = canvas.captureStream(FPS)
    } catch {
      this._say(t('clipNoSupport'))
      return null
    }
    const film = { stream, last: performance.now(), g: null, rec: null, chunks: [] }
    if (o.type === 'gif' || !videoSupported()) {
      film.g = this._newGif(stream, REPLAY_MAX_FILM * GIF_FPS)
    } else {
      try {
        const type = pickType(TYPES)
        film.rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: BITRATE } : { videoBitsPerSecond: BITRATE })
        film.rec.ondataavailable = (e) => {
          if (e.data?.size) film.chunks.push(e.data)
        }
        film.rec.start()
      } catch {
        stream.getTracks().forEach((tr) => tr.stop())
        this._say(t('clipNoSupport'))
        return null
      }
    }
    this.saving = true
    this._film = film
    // The world holds still behind the (hidden) pause screen.
    if (!s.bm.menuOpen) s.bm.toggleMenu()
    const finished = await new Promise((resolve) => {
      if (!s.replay.start((ok) => resolve(ok), '', { span, speed: o.speed, angle: o.angle, cam: o.cam, clip: true })) resolve(null)
    })
    this._film = null
    let blob = null
    if (film.rec) {
      const stopped = new Promise((resolve) => (film.rec.onstop = resolve))
      try {
        film.rec.stop()
        await stopped
      } catch {
        // Already stopped.
      }
      if (finished) blob = new Blob(film.chunks, { type: film.rec.mimeType || 'video/webm' })
    } else if (finished && film.g.frames.length) {
      if (film.g.pending) await new Promise((resolve) => film.g.flushers.push(resolve))
      const last = film.g.frames[film.g.frames.length - 1]
      blob = gifBlob(film.g.frames, last.w, last.h)
    }
    if (film.g) this._stopGif(film.g)
    stream.getTracks().forEach((tr) => tr.stop())
    this.saving = false
    if (finished === false) {
      this._say(t('clipReplayCancelled'))
      return null
    }
    if (!blob || !blob.size) {
      this._say(t('clipNotYet'))
      return null
    }
    const seconds = Math.round(span / o.speed)
    const name = this._fileName(blob.type === 'image/gif' ? 'gif' : /mp4/.test(blob.type) ? 'mp4' : 'webm').replace('gayz-clip-', 'gayz-replay-')
    this._download(blob, name)
    this._say(t('clipReplaySaved', { n: seconds }))
    this.lastClip = { size: blob.size, seconds, name, type: blob.type, replay: true }
    return { blob, seconds, name }
  }

  // The recording a save would use: the youngest that's already the
  // picked length, or the oldest when none is yet.
  _pick() {
    const ready = this._recs.filter((r) => r.age >= this.keep)
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

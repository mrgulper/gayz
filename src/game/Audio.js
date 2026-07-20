// Lightweight synthesized SFX via the Web Audio API, so the game needs no
// external sound files. Must call init() from a user-gesture handler
// (browsers block AudioContext creation before user interaction).

const SHOT_PRESETS = {
  pistol: { toneFreq: 1900, toneQ: 0.7, duration: 0.14, gain: 0.55, thumpFreq: 90 },
  rifle: { toneFreq: 1500, toneQ: 0.6, duration: 0.09, gain: 0.42, thumpFreq: 110 },
  minigun: { toneFreq: 1300, toneQ: 0.5, duration: 0.06, gain: 0.38, thumpFreq: 130 },
}

// Background music track. "Oldschool Horror Theme" by josepharaoh99 (CC0,
// opengameart.org/content/oldschool-horror-theme) - public domain, no
// attribution required, credited here anyway.
const MUSIC_URL = '/audio/oldschool-horror-theme.mp3'
const MUSIC_VOLUME = 0.32
const MUSIC_FADE_MS = 2500

// "Zombies Sound Pack" by artisticdude (CC0, opengameart.org/content/zombies-sound-pack).
// Split by clip length into snarl/moan/death pools since the pack ships with
// no per-file categorization.
const ZOMBIE_SOUND_DIR = '/audio/zombies/'
const ZOMBIE_SOUND_FILES = {
  attack: ['zombie-24.wav', 'zombie-5.wav', 'zombie-11.wav', 'zombie-6.wav', 'zombie-13.wav', 'zombie-3.wav', 'zombie-7.wav'],
  moan: ['zombie-14.wav', 'zombie-22.wav', 'zombie-2.wav', 'zombie-4.wav', 'zombie-10.wav', 'zombie-8.wav', 'zombie-23.wav', 'zombie-1.wav', 'zombie-9.wav', 'zombie-15.wav', 'zombie-12.wav', 'zombie-20.wav', 'zombie-19.wav'],
  death: ['zombie-21.wav', 'zombie-18.wav', 'zombie-16.wav', 'zombie-17.wav'],
}

class AudioEngine {
  constructor() {
    this.ctx = null
    this.ambientStarted = false
    this.music = null
    this.musicStarted = false
    this.zombieBuffers = { attack: [], moan: [], death: [] }
    this.sfxVolume = 1
    this.musicVolume = 1
    // Threat-based dynamic intensity (see Game.js's _updateMusicIntensity) -
    // 0 at rest, up to 1 when zombies are close/a boss is up/health is low.
    // Modulates the same single music track's volume and playback rate
    // rather than crossfading between separate intensity-tier tracks, since
    // this game has no such tracks to crossfade between.
    this.musicIntensity = 0
  }

  init() {
    if (this.ctx) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = this.sfxVolume
    this.sfxGain.connect(this.ctx.destination)
    this._loadZombieSounds()
  }

  _loadZombieSounds() {
    for (const [pool, files] of Object.entries(ZOMBIE_SOUND_FILES)) {
      for (const file of files) {
        fetch(ZOMBIE_SOUND_DIR + file)
          .then((res) => res.arrayBuffer())
          .then((data) => this.ctx.decodeAudioData(data))
          .then((buffer) => this.zombieBuffers[pool].push(buffer))
          .catch(() => {})
      }
    }
  }

  // Plays a random sample from the given zombie sound pool with slight pitch
  // jitter so 4-13 clips per pool don't sound like an obvious loop.
  _playZombieSample(pool, gain) {
    const buffers = this.zombieBuffers[pool]
    if (!buffers.length) return false

    const ctx = this.ctx
    const source = ctx.createBufferSource()
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)]
    source.playbackRate.value = 0.9 + Math.random() * 0.2

    const gainNode = ctx.createGain()
    gainNode.gain.value = gain

    source.connect(gainNode).connect(this.sfxGain)
    source.start()
    return true
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume()
  }

  // Suspends the whole AudioContext - music and every SFX voice route
  // through it, so this silences everything in one call instead of tracking
  // down each sound source individually. resume() undoes it.
  pause() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend()
  }

  // `suppressed` (Coin Shop attachment, see WeaponSystem.applyAttachment)
  // shortens the crack, pulls the tone up into a duller "pfft" register
  // instead of the sharp bandpass bark, and drops both layers' gain hard -
  // still audible up close, not the room-filling crack of an unsuppressed
  // shot.
  playShot(weaponId, suppressed = false) {
    if (!this.ctx) return
    const preset = SHOT_PRESETS[weaponId] || SHOT_PRESETS.pistol
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = suppressed ? preset.duration * 0.5 : preset.duration
    const gain = suppressed ? preset.gain * 0.35 : preset.gain
    const toneFreq = suppressed ? preset.toneFreq * 1.6 : preset.toneFreq
    const toneQ = suppressed ? preset.toneQ * 2 : preset.toneQ

    // Crack: filtered noise burst.
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = toneFreq
    bandpass.Q.value = toneQ

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(gain, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)

    // Thump: low-frequency punch for weight - skipped when suppressed,
    // since a suppressor kills most of the low-end body along with the bark.
    if (!suppressed) {
      const thump = ctx.createOscillator()
      thump.type = 'triangle'
      thump.frequency.setValueAtTime(preset.thumpFreq, now)
      thump.frequency.exponentialRampToValueAtTime(preset.thumpFreq * 0.5, now + 0.08)

      const thumpGain = ctx.createGain()
      thumpGain.gain.setValueAtTime(preset.gain * 0.8, now)
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)

      thump.connect(thumpGain).connect(this.sfxGain)
      thump.start(now)
      thump.stop(now + 0.1)
    }
  }

  // Blade whoosh for the melee swing.
  playMelee() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.16

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(2200, now)
    bandpass.frequency.exponentialRampToValueAtTime(600, now + duration)
    bandpass.Q.value = 0.9

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.35, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
  }

  // Low-health tension cue: a "lub-dub" double thump, synced to the
  // low-health screen pulse (see Game.js's _updateHealthHud/#damage-flash's
  // low-health CSS animation, which shares the same ~1.6s cadence).
  playHeartbeat() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime

    const beat = (delay, freq, gainAmount) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + delay)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + delay + 0.12)

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(gainAmount, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.16)

      osc.connect(gain).connect(this.sfxGain)
      osc.start(now + delay)
      osc.stop(now + delay + 0.16)
    }

    beat(0, 70, 0.5)
    beat(0.18, 60, 0.4)
  }

  // Dry mechanical double-click for critically low ammo - deliberately not
  // another heartbeat (that's low health's cue, see playHeartbeat above) so
  // the two tension states read as distinct problems at a glance/listen
  // instead of blurring into one generic "danger" sound.
  playLowAmmoTick() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime

    const click = (delay) => {
      const duration = 0.05
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 2600
      bandpass.Q.value = 8

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.3, now + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + duration)

      noise.connect(bandpass).connect(gain).connect(this.sfxGain)
      noise.start(now + delay)
      noise.stop(now + delay + duration)
    }

    click(0)
    click(0.09)
  }

  // Rare rain-night event (see Game.js's _triggerLightning): a bright crack
  // followed by a rolling low rumble.
  playThunder() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const crackDuration = 0.25
    const rumbleDuration = 1.6

    const crackBuffer = ctx.createBuffer(1, ctx.sampleRate * crackDuration, ctx.sampleRate)
    const crackData = crackBuffer.getChannelData(0)
    for (let i = 0; i < crackData.length; i++) crackData[i] = Math.random() * 2 - 1
    const crack = ctx.createBufferSource()
    crack.buffer = crackBuffer
    const crackFilter = ctx.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.value = 800
    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(0.6, now)
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + crackDuration)
    crack.connect(crackFilter).connect(crackGain).connect(this.sfxGain)
    crack.start(now)
    crack.stop(now + crackDuration)

    const rumbleBuffer = ctx.createBuffer(1, ctx.sampleRate * rumbleDuration, ctx.sampleRate)
    const rumbleData = rumbleBuffer.getChannelData(0)
    for (let i = 0; i < rumbleData.length; i++) rumbleData[i] = Math.random() * 2 - 1
    const rumble = ctx.createBufferSource()
    rumble.buffer = rumbleBuffer
    const rumbleFilter = ctx.createBiquadFilter()
    rumbleFilter.type = 'lowpass'
    rumbleFilter.frequency.value = 220
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.setValueAtTime(0.0001, now)
    rumbleGain.gain.linearRampToValueAtTime(0.35, now + 0.1)
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDuration)
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.sfxGain)
    rumble.start(now)
    rumble.stop(now + rumbleDuration)
  }

  // Thrown noisemaker landing: a cluster of metallic clatters plus a low
  // ringing thud, loud enough to read as a deliberate decoy sound.
  // Radio static burst settling into a soft two-note chime, for finding a
  // lore audio log - no synthesized speech available, so this plays as the
  // "found a recording" cue while the lore text shows as a toast.
  playAudioLog() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const staticDuration = 0.5

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * staticDuration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = 2600
    bandpass.Q.value = 0.7

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.18, now)
    noiseGain.gain.linearRampToValueAtTime(0.001, now + staticDuration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + staticDuration)

    for (const [i, freq] of [[0, 660], [1, 880]]) {
      const t0 = now + 0.35 + i * 0.16
      const chime = ctx.createOscillator()
      chime.type = 'sine'
      chime.frequency.value = freq
      const chimeGain = ctx.createGain()
      chimeGain.gain.setValueAtTime(0.001, t0)
      chimeGain.gain.linearRampToValueAtTime(0.22, t0 + 0.03)
      chimeGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5)
      chime.connect(chimeGain).connect(this.sfxGain)
      chime.start(t0)
      chime.stop(t0 + 0.5)
    }
  }

  playNoisemaker() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime

    for (let i = 0; i < 5; i++) {
      const t0 = now + i * 0.055 + Math.random() * 0.02
      const clickDuration = 0.08
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * clickDuration, ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let j = 0; j < data.length; j++) data[j] = Math.random() * 2 - 1

      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer

      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = 1800 + Math.random() * 1200
      bandpass.Q.value = 6

      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.5, t0)
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + clickDuration)

      noise.connect(bandpass).connect(gain).connect(this.sfxGain)
      noise.start(t0)
      noise.stop(t0 + clickDuration)
    }

    const duration = 0.5
    const ring = ctx.createOscillator()
    ring.type = 'triangle'
    ring.frequency.setValueAtTime(300, now)
    ring.frequency.exponentialRampToValueAtTime(120, now + duration)

    const ringGain = ctx.createGain()
    ringGain.gain.setValueAtTime(0.4, now)
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    ring.connect(ringGain).connect(this.sfxGain)
    ring.start(now)
    ring.stop(now + duration)
  }

  // Guttural shriek/growl burst for a zombie ambush trigger.
  playAmbushShriek() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.45

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(280, now)
    bandpass.frequency.exponentialRampToValueAtTime(1400, now + 0.35)
    bandpass.Q.value = 4

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.001, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.6, now + 0.06)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)

    const growl = ctx.createOscillator()
    growl.type = 'sawtooth'
    growl.frequency.setValueAtTime(70, now)
    growl.frequency.exponentialRampToValueAtTime(220, now + 0.3)
    growl.frequency.exponentialRampToValueAtTime(50, now + duration)

    const growlGain = ctx.createGain()
    growlGain.gain.setValueAtTime(0.35, now)
    growlGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    growl.connect(growlGain).connect(this.sfxGain)
    growl.start(now)
    growl.stop(now + duration)
  }

  // Low boom for the exploder zombie's detonation.
  playExplosion() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.6

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.setValueAtTime(1800, now)
    lowpass.frequency.exponentialRampToValueAtTime(140, now + duration)

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.8, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(lowpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)

    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(120, now)
    thump.frequency.exponentialRampToValueAtTime(30, now + 0.35)

    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(0.9, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)

    thump.connect(thumpGain).connect(this.sfxGain)
    thump.start(now)
    thump.stop(now + 0.4)
  }

  // Electric zap/discharge for the EMP grenade's landing burst - no boom
  // (it deals no damage), just a rising-then-crackling zap read.
  playEmpBurst() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.5

    const zap = ctx.createOscillator()
    zap.type = 'sawtooth'
    zap.frequency.setValueAtTime(80, now)
    zap.frequency.exponentialRampToValueAtTime(2200, now + 0.12)
    zap.frequency.exponentialRampToValueAtTime(600, now + duration)

    const zapGain = ctx.createGain()
    zapGain.gain.setValueAtTime(0.001, now)
    zapGain.gain.exponentialRampToValueAtTime(0.5, now + 0.1)
    zapGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    zap.connect(zapGain).connect(this.sfxGain)
    zap.start(now)
    zap.stop(now + duration)

    const crackleDuration = 0.35
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * crackleDuration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 3000

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.35, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + crackleDuration)

    noise.connect(highpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + crackleDuration)
  }

  // Bright bell "ding" for a practice range target hit (see World.js's
  // buildPracticeRange) - the only purely positive-feedback SFX in this
  // file, everything else here is either combat or a danger cue.
  playTargetDing() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.35

    const bell = ctx.createOscillator()
    bell.type = 'sine'
    bell.frequency.setValueAtTime(1400, now)
    bell.frequency.exponentialRampToValueAtTime(1100, now + duration)

    const bellGain = ctx.createGain()
    bellGain.gain.setValueAtTime(0.4, now)
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    bell.connect(bellGain).connect(this.sfxGain)
    bell.start(now)
    bell.stop(now + duration)

    const overtone = ctx.createOscillator()
    overtone.type = 'sine'
    overtone.frequency.setValueAtTime(2100, now)

    const overtoneGain = ctx.createGain()
    overtoneGain.gain.setValueAtTime(0.15, now)
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.6)

    overtone.connect(overtoneGain).connect(this.sfxGain)
    overtone.start(now)
    overtone.stop(now + duration * 0.6)
  }

  // Low, mournful groan for ambient zombie presence (not an attack cue).
  // Uses a triangle tone (not sawtooth) through vowel-like formant filters
  // so it reads as a vocal "aaahh" rather than a buzzy raspberry.
  playZombieMoan() {
    if (!this.ctx) return
    if (this._playZombieSample('moan', 0.45)) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 1.4 + Math.random() * 0.8
    const baseFreq = 100 + Math.random() * 40

    const moan = ctx.createOscillator()
    moan.type = 'triangle'
    moan.frequency.setValueAtTime(baseFreq, now)
    moan.frequency.linearRampToValueAtTime(baseFreq * 0.8, now + duration * 0.6)
    moan.frequency.linearRampToValueAtTime(baseFreq * 0.68, now + duration)

    const vibrato = ctx.createOscillator()
    vibrato.frequency.value = 4.5
    const vibratoGain = ctx.createGain()
    vibratoGain.gain.value = 3
    vibrato.connect(vibratoGain).connect(moan.frequency)
    vibrato.start(now)
    vibrato.stop(now + duration)

    const formant1 = ctx.createBiquadFilter()
    formant1.type = 'bandpass'
    formant1.frequency.value = 650
    formant1.Q.value = 3

    const formant2 = ctx.createBiquadFilter()
    formant2.type = 'bandpass'
    formant2.frequency.value = 1100
    formant2.Q.value = 2

    const moanGain = ctx.createGain()
    moanGain.gain.setValueAtTime(0.001, now)
    moanGain.gain.linearRampToValueAtTime(0.2, now + duration * 0.25)
    moanGain.gain.linearRampToValueAtTime(0.001, now + duration)

    moan.connect(formant1)
    moan.connect(formant2)
    formant1.connect(moanGain)
    formant2.connect(moanGain)
    moanGain.connect(this.sfxGain)
    moan.start(now)
    moan.stop(now + duration)

    // Breathy noise layer under the tone for a rasping, vocal texture.
    const breathBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const breathData = breathBuffer.getChannelData(0)
    for (let i = 0; i < breathData.length; i++) breathData[i] = Math.random() * 2 - 1

    const breath = ctx.createBufferSource()
    breath.buffer = breathBuffer

    const breathFilter = ctx.createBiquadFilter()
    breathFilter.type = 'bandpass'
    breathFilter.frequency.value = 800
    breathFilter.Q.value = 1.2

    const breathGain = ctx.createGain()
    breathGain.gain.setValueAtTime(0.001, now)
    breathGain.gain.linearRampToValueAtTime(0.035, now + duration * 0.3)
    breathGain.gain.linearRampToValueAtTime(0.001, now + duration)

    breath.connect(breathFilter).connect(breathGain).connect(this.sfxGain)
    breath.start(now)
    breath.stop(now + duration)
  }

  // Sharp snarl/bite burst when a zombie actually lands a hit on the player.
  playZombieSnarl() {
    if (!this.ctx) return
    if (this._playZombieSample('attack', 0.55)) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.22

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = 900 + Math.random() * 400
    bandpass.Q.value = 2.5

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.5, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)

    const snarl = ctx.createOscillator()
    snarl.type = 'sawtooth'
    snarl.frequency.setValueAtTime(180 + Math.random() * 60, now)
    snarl.frequency.exponentialRampToValueAtTime(60, now + duration)

    const snarlGain = ctx.createGain()
    snarlGain.gain.setValueAtTime(0.4, now)
    snarlGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    snarl.connect(snarlGain).connect(this.sfxGain)
    snarl.start(now)
    snarl.stop(now + duration)
  }

  // Short death rattle when a zombie is killed (not used for the exploder,
  // which has its own detonation sound).
  playZombieDeath() {
    if (!this.ctx) return
    if (this._playZombieSample('death', 0.5)) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.5

    // Gurgling rattle: filtered noise with a falling resonant sweep, not a
    // sustained low tone (which reads as a buzz rather than a death rattle).
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const noiseData = noiseBuffer.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1

    const rattle = ctx.createBufferSource()
    rattle.buffer = noiseBuffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(420, now)
    bandpass.frequency.exponentialRampToValueAtTime(140, now + duration)
    bandpass.Q.value = 3.5

    const rattleGain = ctx.createGain()
    rattleGain.gain.setValueAtTime(0.28, now)
    rattleGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    rattle.connect(bandpass).connect(rattleGain).connect(this.sfxGain)
    rattle.start(now)
    rattle.stop(now + duration)
  }

  // Distant metallic creak/groan — implies the city settling, not a threat.
  playDistantCreak() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 1.4 + Math.random() * 1.2

    const creak = ctx.createOscillator()
    creak.type = 'triangle'
    const startFreq = 220 + Math.random() * 180
    creak.frequency.setValueAtTime(startFreq, now)
    creak.frequency.linearRampToValueAtTime(startFreq * (0.6 + Math.random() * 0.3), now + duration)

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.value = startFreq
    bandpass.Q.value = 8

    const creakGain = ctx.createGain()
    creakGain.gain.setValueAtTime(0.001, now)
    creakGain.gain.linearRampToValueAtTime(0.05, now + duration * 0.3)
    creakGain.gain.linearRampToValueAtTime(0.001, now + duration)

    creak.connect(bandpass).connect(creakGain).connect(this.sfxGain)
    creak.start(now)
    creak.stop(now + duration)
  }

  // Faint, muffled distant scream — implies you're not alone out there.
  playDistantScream() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.9 + Math.random() * 0.4

    const scream = ctx.createOscillator()
    scream.type = 'sawtooth'
    const peakFreq = 500 + Math.random() * 250
    scream.frequency.setValueAtTime(peakFreq * 0.5, now)
    scream.frequency.linearRampToValueAtTime(peakFreq, now + duration * 0.3)
    scream.frequency.exponentialRampToValueAtTime(peakFreq * 0.4, now + duration)

    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 900 // muffled, "far away" quality

    const screamGain = ctx.createGain()
    screamGain.gain.setValueAtTime(0.001, now)
    screamGain.gain.linearRampToValueAtTime(0.09, now + duration * 0.25)
    screamGain.gain.linearRampToValueAtTime(0.001, now + duration)

    scream.connect(lowpass).connect(screamGain).connect(this.sfxGain)
    scream.start(now)
    scream.stop(now + duration)
  }

  // Self-scheduling loop of random distant creaks/screams, layered under the
  // constant drone/wind for a city that never quite feels empty.
  _scheduleAmbientScare() {
    const delay = 14000 + Math.random() * 22000
    setTimeout(() => {
      if (!this.ambientStarted) return
      if (Math.random() < 0.6) this.playDistantCreak()
      else this.playDistantScream()
      this._scheduleAmbientScare()
    }, delay)
  }

  // Continuous low drone + wind hiss for background dread. Call once.
  startAmbient() {
    if (!this.ctx || this.ambientStarted) return
    this.ambientStarted = true
    const ctx = this.ctx
    const now = ctx.currentTime

    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.065
    droneGain.connect(this.sfxGain)

    const drone1 = ctx.createOscillator()
    drone1.type = 'sine'
    drone1.frequency.value = 54
    drone1.connect(droneGain)
    drone1.start(now)

    const drone2 = ctx.createOscillator()
    drone2.type = 'sine'
    drone2.frequency.value = 57.5
    drone2.connect(droneGain)
    drone2.start(now)

    const windBuffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const data = windBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const wind = ctx.createBufferSource()
    wind.buffer = windBuffer
    wind.loop = true

    const windFilter = ctx.createBiquadFilter()
    windFilter.type = 'lowpass'
    windFilter.frequency.value = 450

    const windGain = ctx.createGain()
    windGain.gain.value = 0.034

    const windLfo = ctx.createOscillator()
    windLfo.frequency.value = 0.06
    const windLfoGain = ctx.createGain()
    windLfoGain.gain.value = 0.012
    windLfo.connect(windLfoGain).connect(windGain.gain)
    windLfo.start(now)

    wind.connect(windFilter).connect(windGain).connect(this.sfxGain)
    wind.start(now)

    this._scheduleAmbientScare()
  }

  // Looping background music, faded in from silence. Independent of the
  // synthesized ambient bed above - plays via a plain <audio> element rather
  // than the Web Audio graph.
  startMusic() {
    if (this.musicStarted) return
    this.musicStarted = true

    this.music = new Audio(MUSIC_URL)
    this.music.loop = true
    this.music.volume = 0

    const fadeStart = performance.now()
    const fade = () => {
      const t = Math.min(1, (performance.now() - fadeStart) / MUSIC_FADE_MS)
      this.music.volume = t * MUSIC_VOLUME * this.musicVolume
      if (t < 1) requestAnimationFrame(fade)
    }

    this.music.play().then(fade).catch(() => {})
  }

  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume))
    this._applyMusicVolume()
  }

  _applyMusicVolume() {
    if (!this.music) return
    // Louder (not just faster) at high threat, on top of whatever the base
    // fade-in/settings-slider volume already is - capped well under 1 so it
    // never clips or drowns out SFX even at max intensity.
    this.music.volume = MUSIC_VOLUME * this.musicVolume * (0.85 + this.musicIntensity * 0.3)
  }

  setMusicIntensity(intensity) {
    this.musicIntensity = Math.max(0, Math.min(1, intensity))
    this._applyMusicVolume()
    if (this.music) this.music.playbackRate = 1 + this.musicIntensity * 0.12
  }

  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume))
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume
  }
}

export const audioEngine = new AudioEngine()

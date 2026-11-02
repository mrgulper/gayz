// Lightweight synthesized SFX via the Web Audio API, so the game needs no
// external sound files. Must call init() from a user-gesture handler
// (browsers block AudioContext creation before user interaction).

const SHOT_PRESETS = {
  pistol: { toneFreq: 1900, toneQ: 0.7, duration: 0.14, gain: 0.55, thumpFreq: 90 },
  rifle: { toneFreq: 1500, toneQ: 0.6, duration: 0.09, gain: 0.42, thumpFreq: 110 },
  minigun: { toneFreq: 1300, toneQ: 0.5, duration: 0.06, gain: 0.38, thumpFreq: 130 },
}

// "Zombies Sound Pack" by artisticdude (CC0, opengameart.org/content/zombies-sound-pack).
// Split by clip length into snarl/moan/death pools since the pack ships with
// no per-file categorization.
const ZOMBIE_SOUND_DIR = '/audio/zombies/'
const ZOMBIE_SOUND_FILES = {
  attack: ['zombie-24.wav', 'zombie-5.wav', 'zombie-11.wav', 'zombie-6.wav', 'zombie-13.wav', 'zombie-3.wav', 'zombie-7.wav'],
  moan: ['zombie-14.wav', 'zombie-22.wav', 'zombie-2.wav', 'zombie-4.wav', 'zombie-10.wav', 'zombie-8.wav', 'zombie-23.wav', 'zombie-1.wav', 'zombie-9.wav', 'zombie-15.wav', 'zombie-12.wav', 'zombie-20.wav', 'zombie-19.wav'],
  death: ['zombie-21.wav', 'zombie-18.wav', 'zombie-16.wav', 'zombie-17.wav'],
}

// Weather ambience (batch 2026-08-20, at the user's request - the rain/snow
// bandpassed-noise bed in startAmbient was too quiet/thin to actually read
// as rain or snow, and snow had no dedicated layer of its own at all).
// "Rain (loopable)" by qubodup (CC0, opengameart.org/content/rain-loopable) -
// the longest (45s) of its 4 clips, picked for the least noticeable loop
// seam. "wind whoosh loop" by qubodup (CC0,
// opengameart.org/content/wind-whoosh-loop) doubles as the snow bed - snow
// itself is silent, what you actually hear in a snowfall is the cold wind,
// which is exactly what this clip is.
const RAIN_AMBIENCE_URL = '/audio/weather/rain-ambience.mp3'
const SNOW_AMBIENCE_URL = '/audio/weather/snow-wind-ambience.ogg'

// playSpecial's recipes (see there).
const SPECIAL_SOUNDS = {
  bell: { notes: [[523, 0, 2.4, 'sine', 0.3], [1046, 0, 1.8, 'sine', 0.12], [1569, 0, 1.2, 'sine', 0.07], [523, 0.9, 2.2, 'sine', 0.22], [1046, 0.9, 1.5, 'sine', 0.08]] },
  whoosh: { noise: [0.45, 300, 3200, 0.3], notes: [[220, 0, 0.4, 'sine', 0.1, 880]] },
  pop: { notes: [[660, 0, 0.09, 'triangle', 0.25, 990], [990, 0.07, 0.1, 'triangle', 0.18, 1320]] },
  siren: { notes: [[500, 0, 0.9, 'sawtooth', 0.12, 900], [900, 0.9, 0.9, 'sawtooth', 0.12, 500], [500, 1.8, 0.9, 'sawtooth', 0.12, 900], [900, 2.7, 0.9, 'sawtooth', 0.1, 500]] },
  chime: { notes: [[1568, 0, 0.9, 'sine', 0.08], [2093, 0.12, 0.8, 'sine', 0.06], [1760, 0.27, 0.9, 'sine', 0.05]] },
  warn: { notes: [[392, 0, 0.5, 'sine', 0.12], [370, 0.18, 0.5, 'sine', 0.12], [392, 0.36, 0.5, 'sine', 0.1]] },
  dingdong: { notes: [[659, 0, 0.9, 'sine', 0.25], [523, 0.45, 1.2, 'sine', 0.25]] },
  shout: { noise: [0.35, 600, 1400, 0.25], notes: [[180, 0, 0.35, 'sawtooth', 0.12, 220]] },
  radio1: { notes: [[523, 0, 0.25, 'square', 0.05], [659, 0.3, 0.25, 'square', 0.05], [784, 0.6, 0.25, 'square', 0.05], [659, 0.9, 0.25, 'square', 0.05], [523, 1.2, 0.5, 'square', 0.05]] },
  radio2: { notes: [[392, 0, 0.4, 'triangle', 0.1], [440, 0.45, 0.4, 'triangle', 0.1], [494, 0.9, 0.4, 'triangle', 0.1], [587, 1.35, 0.8, 'triangle', 0.1]] },
  radio3: { notes: [[110, 0, 0.2, 'sawtooth', 0.08], [110, 0.5, 0.2, 'sawtooth', 0.08], [147, 1, 0.2, 'sawtooth', 0.08], [131, 1.5, 0.3, 'sawtooth', 0.08]], noise: [0.1, 4000, 6000, 0.08] },
  echo: { noise: [0.3, 900, 300, 0.12] },
  // A Golden / Diamond zombie showing up or going down (ZombieNames.js).
  goldZombie: { notes: [[1319, 0, 0.25, 'triangle', 0.16], [1568, 0.08, 0.25, 'triangle', 0.14], [2093, 0.16, 0.6, 'sine', 0.12]] },
  diamondZombie: { notes: [[1047, 0, 0.3, 'sine', 0.14], [1319, 0.07, 0.3, 'sine', 0.13], [1568, 0.14, 0.3, 'sine', 0.12], [2093, 0.21, 0.4, 'sine', 0.12], [2637, 0.28, 0.9, 'sine', 0.1], [3136, 0.4, 1, 'triangle', 0.05]], noise: [0.6, 5000, 9000, 0.05] },
  // Disco Zombie: a quick funky bass line and a cymbal splash.
  discoZombie: { notes: [[110, 0, 0.12, 'square', 0.12], [220, 0.12, 0.12, 'square', 0.1], [165, 0.24, 0.12, 'square', 0.12], [330, 0.36, 0.12, 'square', 0.1], [880, 0.5, 0.4, 'triangle', 0.08, 1320]], noise: [0.5, 7000, 9000, 0.08] },
  // Snowballs (Snowballs.js): a whoosh, and a soft crunchy splat.
  snowThrow: { noise: [0.12, 1800, 3500, 0.08] },
  snowSplat: { noise: [0.18, 600, 2400, 0.14] },
  // Metal detector beep (MetalDetector.js).
  detectorBeep: { notes: [[1760, 0, 0.06, 'square', 0.06]] },
  detectorFound: { notes: [[880, 0, 0.12, 'square', 0.08], [1320, 0.12, 0.12, 'square', 0.08], [1760, 0.24, 0.3, 'square', 0.07]] },
  // Drinking a potion (Potions.js), a jetpack's hiss (Jetpack.js).
  potionGulp: { notes: [[330, 0, 0.08, 'sine', 0.1], [262, 0.1, 0.08, 'sine', 0.1], [392, 0.22, 0.2, 'sine', 0.1]] },
  jetpack: { noise: [0.28, 900, 2600, 0.07] },
  // Pinata Zombie: a paper pop and a happy little toot.
  pinataZombie: { notes: [[784, 0.05, 0.12, 'triangle', 0.12], [988, 0.15, 0.12, 'triangle', 0.12], [1175, 0.25, 0.3, 'triangle', 0.1]], noise: [0.15, 2500, 5000, 0.18] },
  // A zombie's goofs (FunnyZombies.js): a long low burp, a little hiccup.
  burp: { notes: [[120, 0, 0.5, 'sawtooth', 0.14, 70], [180, 0, 0.45, 'square', 0.04, 95]], noise: [0.45, 350, 140, 0.1] },
  hiccup: { notes: [[330, 0, 0.09, 'triangle', 0.22, 780], [360, 0.5, 0.08, 'triangle', 0.18, 820]] },
  clank: { noise: [0.15, 2500, 900, 0.3], notes: [[180, 0, 0.12, 'square', 0.12, 90]] },
  crumble: { noise: [0.5, 500, 120, 0.3] },
  thud: { noise: [0.2, 300, 80, 0.35], notes: [[90, 0, 0.25, 'sine', 0.3, 45]] },
  hum: { notes: [[60, 0, 0.8, 'sawtooth', 0.1, 120], [120, 0.1, 0.7, 'square', 0.04]] },
  twang: { notes: [[700, 0, 0.12, 'triangle', 0.15, 250]], noise: [0.08, 3000, 1200, 0.12] },
  zap: { noise: [0.2, 5000, 1500, 0.25], notes: [[90, 0, 0.2, 'sawtooth', 0.15, 60]] },
  turret: { noise: [0.06, 2500, 800, 0.25] },
  firework: { notes: [[300, 0, 0.5, 'sine', 0.06, 1200]], noise: [0.9, 2000, 300, 0.3] },
  drum: { notes: [[110, 0, 0.25, 'sine', 0.4, 50]], noise: [0.08, 900, 300, 0.2] },
  honk: { notes: [[220, 0, 0.3, 'sawtooth', 0.15], [277, 0, 0.3, 'sawtooth', 0.12], [220, 0.35, 0.45, 'sawtooth', 0.15], [277, 0.35, 0.45, 'sawtooth', 0.12]] },
}

class AudioEngine {
  constructor() {
    this.ctx = null
    this.ambientStarted = false
    this.zombieBuffers = { attack: [], moan: [], death: [] }
    this._rainBuffer = null
    this._snowBuffer = null
    this.sfxVolume = 1
    this.ambientVolume = 1
    this.zombieVolume = 1
    this.positionalAudioEnabled = true
  }

  init() {
    if (this.ctx) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.sfxGain = this.ctx.createGain()
    this.sfxGain.gain.value = this.sfxVolume
    this.sfxGain.connect(this.ctx.destination)
    // Separate from sfxGain - only the continuous ambient bed (drone +
    // wind, see startAmbient) routes through here, so it has its own
    // volume slider independent of weapon/UI sound effects. One-shot
    // ambient event sounds (distant creaks/screams) stay on sfxGain -
    // they're closer to immersion stingers than the ambient bed itself.
    this.ambientGain = this.ctx.createGain()
    this.ambientGain.gain.value = this.ambientVolume
    this.ambientGain.connect(this.ctx.destination)
    // Every zombie sound (moans, bites, deaths)
    // goes through here first: Settings > Audio > Zombie Noises, on top of
    // Sound Effects (2026-10-30).
    this.zombieGain = this.ctx.createGain()
    this.zombieGain.gain.value = this.zombieVolume
    this.zombieGain.connect(this.sfxGain)
    this._loadZombieSounds()
    this._loadWeatherSounds()
  }

  // Same fetch+decodeAudioData pattern as _loadZombieSounds. Kicked off here
  // (well before startAmbient/setWeatherAudio ever run) so the buffers are
  // usually already decoded by the time a rainy/snowy night actually rolls;
  // startAmbient wires up the gain nodes immediately regardless and
  // _startWeatherSource (called from both startAmbient and, if it missed
  // the buffer, setWeatherAudio) attaches the real source whenever the
  // buffer becomes available.
  _loadWeatherSounds() {
    fetch(RAIN_AMBIENCE_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => { this._rainBuffer = buffer; this._startWeatherSource('rain') })
      .catch(() => {})
    fetch(SNOW_AMBIENCE_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => this.ctx.decodeAudioData(data))
      .then((buffer) => { this._snowBuffer = buffer; this._startWeatherSource('snow') })
      .catch(() => {})
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
  // jitter so 4-13 clips per pool don't sound like an obvious loop, times an
  // optional per-type pitchMult (see _pitchForScale) so a titan doesn't
  // sound identical to a feral dog. pan (-1 left to 1 right, camera-
  // relative) is only actually applied when settings.positionalAudio is
  // on (see setPositionalAudio) - centered otherwise.
  _playZombieSample(pool, gain, pitchMult = 1, pan = 0) {
    const buffers = this.zombieBuffers[pool]
    if (!buffers.length) return false

    const ctx = this.ctx
    const source = ctx.createBufferSource()
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)]
    source.playbackRate.value = (0.9 + Math.random() * 0.2) * pitchMult

    const gainNode = ctx.createGain()
    gainNode.gain.value = gain

    if (this.positionalAudioEnabled && pan !== 0) {
      const panner = ctx.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      source.connect(gainNode).connect(panner).connect(this.zombieGain)
    } else {
      source.connect(gainNode).connect(this.zombieGain)
    }
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

  // Reload - two short mechanical clacks (mag out, mag in) rather than a
  // hand-tuned preset per weapon (14 of them, vs. playShot's 3) - pitch
  // and spacing derive from stats every weapon already has (magSize,
  // reloadTime), so a heavy weapon with a big mag (minigun, rocket) reads
  // as a slower, deeper mechanism than a snappy pistol reload, without
  // needing to author a table by hand.
  playReload(weapon) {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    // Bigger mags -> lower-pitched, slightly longer clacks (a bigger
    // piece of metal). Clamped so an absurd magSize/reloadTime can't push
    // this into an inaudible sub-bass thud or a silent dog-whistle click.
    const sizeFactor = Math.max(0.6, Math.min(1.6, 8 / (weapon.magSize || 8)))
    const clackFreq = 900 * sizeFactor
    const clackDuration = 0.05 * sizeFactor
    // Spacing between the two clacks scales with the weapon's own
    // reloadTime (bounded so a very slow weapon - AWP, rocket - doesn't
    // leave an awkwardly long silent gap) instead of a fixed delay.
    const gap = Math.max(0.12, Math.min(0.5, (weapon.reloadTime || 1.5) * 0.35))

    const playClack = (t, freq, gain) => {
      const noiseBuffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * clackDuration), ctx.sampleRate)
      const data = noiseBuffer.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = noiseBuffer
      const bandpass = ctx.createBiquadFilter()
      bandpass.type = 'bandpass'
      bandpass.frequency.value = freq
      bandpass.Q.value = 3.5
      const noiseGain = ctx.createGain()
      noiseGain.gain.setValueAtTime(gain, t)
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + clackDuration)
      noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
      noise.start(t)
      noise.stop(t + clackDuration)
    }

    playClack(now, clackFreq, 0.3) // mag out
    playClack(now + gap, clackFreq * 1.15, 0.32) // mag in, a touch higher/sharper
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

  // Player hurt grunt - the player had no voice at all before this (only
  // the damage-flash visual + zombie snarl SFX cued a hit landing). Same
  // filtered-noise synthesis technique as playMelee above, just a lower,
  // shorter, downward-swept "oof" instead of a swing whoosh.
  playPlayerHurt() {
    if (!this.ctx) return
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
    bandpass.frequency.setValueAtTime(420, now)
    bandpass.frequency.exponentialRampToValueAtTime(140, now + duration)
    bandpass.Q.value = 1.1

    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0.3, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(bandpass).connect(noiseGain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
  }

  // Low-health tension cue: a "lub-dub" double thump (~1.6s cadence).
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

  // Lightning in a storm (BuildWeather.js): a bright crack
  // followed by a rolling low rumble.
  // opts (2026-10-30, lightning up in the sky): gain (0..1, far strikes
  // are quieter), soft (a flash inside the clouds - no crack, just a long
  // low roll).
  playThunder(opts = {}) {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const loud = opts.gain ?? 1
    const crackDuration = opts.soft ? 0.01 : 0.25
    const rumbleDuration = opts.soft ? 3.2 : 1.6 + (1 - loud) * 1.6

    const crackBuffer = ctx.createBuffer(1, ctx.sampleRate * crackDuration, ctx.sampleRate)
    const crackData = crackBuffer.getChannelData(0)
    for (let i = 0; i < crackData.length; i++) crackData[i] = Math.random() * 2 - 1
    const crack = ctx.createBufferSource()
    crack.buffer = crackBuffer
    const crackFilter = ctx.createBiquadFilter()
    crackFilter.type = 'highpass'
    crackFilter.frequency.value = 800
    const crackGain = ctx.createGain()
    crackGain.gain.setValueAtTime(opts.soft ? 0.0001 : 0.6 * loud * loud, now)
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + crackDuration)
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
    rumbleFilter.frequency.value = opts.soft ? 140 : 220 - (1 - loud) * 90
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.setValueAtTime(0.0001, now)
    rumbleGain.gain.linearRampToValueAtTime(0.35 * (opts.soft ? 0.45 : 0.4 + 0.6 * loud), now + (opts.soft ? 0.6 : 0.1))
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDuration)
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(this.sfxGain)
    rumble.start(now)
    rumble.stop(now + rumbleDuration)
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

  // Map Editor's Try Map windows: a short, sharp tick when a shot cracks
  // the glass, and a bright shatter with tinkling bits when it breaks.
  _glassNoise(duration, freq, gain, now) {
    const ctx = this.ctx
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + duration)
    noise.connect(highpass).connect(g).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
  }

  _glassTink(freq, at, gain) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, at)
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, at)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.12)
    osc.connect(g).connect(this.sfxGain)
    osc.start(at)
    osc.stop(at + 0.12)
  }

  playGlassCrack() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this._glassNoise(0.08, 3200, 0.5, now)
    this._glassTink(2600 + Math.random() * 600, now, 0.12)
  }

  playGlassBreak() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    this._glassNoise(0.45, 2200, 0.7, now)
    for (let i = 0; i < 7; i++) this._glassTink(2400 + Math.random() * 3000, now + 0.03 + Math.random() * 0.35, 0.06 + Math.random() * 0.06)
  }

  // Vocal variety by size (the zombie's scale, also used for its visual
  // size) - bigger zombies get a deeper voice, smaller ones a higher
  // one, out of the SAME sample pool (no new audio assets needed).
  // Clamped so even a titan (scale 3.4) or feral dog (scale 0.55) still
  // reads as a recognizable moan, not a chipmunk or a demon.
  _pitchForScale(scale) {
    if (!scale) return 1
    return Math.max(0.65, Math.min(1.4, 1 / Math.pow(scale, 0.4)))
  }

  // Low, mournful groan for ambient zombie presence (not an attack cue).
  // Uses a triangle tone (not sawtooth) through vowel-like formant filters
  // so it reads as a vocal "aaahh" rather than a buzzy raspberry.
  playZombieMoan(scale, pan = 0) {
    if (!this.ctx) return
    if (this._playZombieSample('moan', 0.45, this._pitchForScale(scale), pan)) return
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
    moanGain.connect(this.zombieGain)
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

    breath.connect(breathFilter).connect(breathGain).connect(this.zombieGain)
    breath.start(now)
    breath.stop(now + duration)
  }

  // Short death rattle when a zombie is killed (not used for the exploder,
  // which has its own detonation sound).
  playZombieDeath(scale, pan = 0) {
    if (!this.ctx) return
    if (this._playZombieSample('death', 0.5, this._pitchForScale(scale), pan)) return
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

    rattle.connect(bandpass).connect(rattleGain).connect(this.zombieGain)
    rattle.start(now)
    rattle.stop(now + duration)
  }

  // A shot landing on a zombie (2026-10-31, "juicy core": "a few
  // different hit sounds"). kind: 'body' (one of three thuds, picked at
  // random so a burst doesn't repeat), 'head' (a bright ping on top) or
  // 'kill' (a heavier crunch).
  playHit(kind = 'body') {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const THUDS = [[210, 0.07], [160, 0.09], [260, 0.06]]
    const [hz, len] = kind === 'kill' ? [120, 0.16] : THUDS[Math.floor(Math.random() * THUDS.length)]
    // A short body thump: noise through a low band, a quick drop.
    const n = Math.max(1, Math.floor(ctx.sampleRate * len))
    const buf = ctx.createBuffer(1, n, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.setValueAtTime(hz * 4, now)
    band.frequency.exponentialRampToValueAtTime(hz, now + len)
    band.Q.value = 1.4
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(kind === 'kill' ? 0.5 : 0.32, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + len)
    src.connect(band).connect(gain).connect(this.sfxGain)
    src.start(now)
    src.stop(now + len)
    if (kind === 'body') return
    // The ping (headshot) or the crunch's low knock (kill).
    const osc = ctx.createOscillator()
    osc.type = kind === 'head' ? 'triangle' : 'square'
    osc.frequency.setValueAtTime(kind === 'head' ? 1650 : 140, now)
    osc.frequency.exponentialRampToValueAtTime(kind === 'head' ? 1250 : 55, now + 0.12)
    const og = ctx.createGain()
    og.gain.setValueAtTime(kind === 'head' ? 0.16 : 0.12, now)
    og.gain.exponentialRampToValueAtTime(0.001, now + (kind === 'head' ? 0.18 : 0.14))
    osc.connect(og).connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + 0.2)
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

  // A cargo plane passing over (a supply drop, WorldEvents.js): a low
  // propeller drone that swells and fades over a few seconds.
  playPlaneFlyby() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(0.08, now + duration * 0.5)
    gain.gain.linearRampToValueAtTime(0.001, now + duration)
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 420
    low.connect(gain).connect(this.sfxGain)
    for (const f of [72, 75.5]) {
      const osc = ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(f * 1.06, now)
      osc.frequency.linearRampToValueAtTime(f * 0.94, now + duration)
      osc.connect(low)
      osc.start(now)
      osc.stop(now + duration)
    }
  }

  // A screamer's scream (ZombieTricks.js): close and loud, unlike the
  // muffled distant one above - a rising shriek over a raspy noise burst.
  playZombieScream(pan = 0) {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 1.3
    const out = ctx.createStereoPanner ? ctx.createStereoPanner() : null
    if (out) {
      out.pan.value = Math.max(-1, Math.min(1, pan))
      out.connect(this.sfxGain)
    }
    const dest = out || this.sfxGain
    for (const [type, f, g] of [['sawtooth', 700, 0.12], ['square', 1050, 0.05]]) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(f * 0.6, now)
      osc.frequency.linearRampToValueAtTime(f, now + 0.25)
      // A wavering shriek.
      for (let i = 1; i < 8; i++) osc.frequency.linearRampToValueAtTime(f * (i % 2 ? 1.08 : 0.95), now + 0.25 + i * 0.1)
      osc.frequency.exponentialRampToValueAtTime(f * 0.45, now + duration)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.001, now)
      gain.gain.linearRampToValueAtTime(g, now + 0.15)
      gain.gain.setValueAtTime(g, now + duration * 0.7)
      gain.gain.linearRampToValueAtTime(0.001, now + duration)
      osc.connect(gain).connect(dest)
      osc.start(now)
      osc.stop(now + duration)
    }
    // Rasp: a short burst of filtered noise.
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1800
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.06, now)
    ng.gain.linearRampToValueAtTime(0.001, now + duration)
    noise.connect(band).connect(ng).connect(dest)
    noise.start(now)
  }

  // Ambient audio storytelling (batch 8 feature) - a garbled radio
  // transmission drifting by, distinct from the wordless creak/scream above:
  // white-noise "static" with a bandpass sweep and choppy on/off gating
  // (implying cut-off speech) rather than a single tonal cue. No actual
  // words - genuinely synthesizing intelligible speech is out of scope for
  // this project's oscillator-based SFX, so this leans into "barely
  // readable transmission" rather than faking clarity it can't deliver.
  playRadioChatter() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 1.8 + Math.random() * 1.4

    const bufferSize = ctx.sampleRate * duration
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer

    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(1400, now)
    bandpass.frequency.linearRampToValueAtTime(2200, now + duration)
    bandpass.Q.value = 3

    // Choppy gating - a handful of on/off gain steps across the duration,
    // reading as cut-off, garbled transmission rather than a clean tone.
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    let t = now
    const stepCount = 5 + Math.floor(Math.random() * 4)
    for (let i = 0; i < stepCount; i++) {
      const on = Math.random() < 0.7
      gain.gain.setValueAtTime(on ? 0.05 + Math.random() * 0.03 : 0, t)
      t += duration / stepCount
    }
    gain.gain.linearRampToValueAtTime(0.0001, now + duration)

    noise.connect(bandpass).connect(gain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
  }

  // Self-scheduling loop of random distant creaks/screams/radio chatter,
  // layered under the constant drone/wind for a city that never quite
  // feels empty.
  _scheduleAmbientScare() {
    const delay = 14000 + Math.random() * 22000
    setTimeout(() => {
      if (!this.ambientStarted) return
      const roll = Math.random()
      if (roll < 0.45) this.playDistantCreak()
      else if (roll < 0.75) this.playDistantScream()
      else this.playRadioChatter()
      this._scheduleAmbientScare()
    }, delay)
  }

  // Continuous low drone + wind hiss for background dread. Call once.
  startAmbient() {
    if (!this.ctx || this.ambientStarted) return
    this.ambientStarted = true
    const ctx = this.ctx
    const now = ctx.currentTime

    // Directional zombie presence (see updateZombiePresence, called
    // periodically from Game.js) - both the constant base drone below and
    // the density-scaled boost route through this shared panner, so a
    // nearby horde shifts the whole ambient bed toward its direction
    // instead of needing a second, competing drone system.
    const dronePanner = ctx.createStereoPanner()
    dronePanner.connect(this.ambientGain)

    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.065
    droneGain.connect(dronePanner)

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

    const presenceGain = ctx.createGain()
    presenceGain.gain.value = 0
    presenceGain.connect(dronePanner)
    const presenceOsc = ctx.createOscillator()
    presenceOsc.type = 'sawtooth'
    presenceOsc.frequency.value = 50
    presenceOsc.connect(presenceGain)
    presenceOsc.start(now)
    this._dronePanner = dronePanner
    this._presenceGain = presenceGain

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

    wind.connect(windFilter).connect(windGain).connect(this.ambientGain)
    wind.start(now)

    // Ambient variety by zone (see updateAmbientZone). Kept as
    // instance refs so that call can smoothly ramp them instead of
    // needing to rebuild the whole ambient graph per transition.
    this._windFilter = windFilter
    this._windGainNode = windGain
    this._ambientIndoorAmount = 0

    // Weather-reactive audio (see setWeatherAudio, called by the Map
    // Editor's weather, BuildWeather.js) - real recorded rain/wind loops now (see
    // RAIN_AMBIENCE_URL/SNOW_AMBIENCE_URL's own comment for why - the
    // previous bandpassed-noise-buffer version read as too thin/quiet to
    // register as actual weather). Gain nodes are created here,
    // unconditionally, so setWeatherAudio always has something to ramp;
    // the real BufferSource gets attached to each whenever its buffer
    // finishes decoding (_startWeatherSource, called from both
    // _loadWeatherSounds and here in case it's already decoded by now).
    const rainGain = ctx.createGain()
    rainGain.gain.value = 0
    rainGain.connect(this.ambientGain)
    this._rainGainNode = rainGain

    const snowGain = ctx.createGain()
    snowGain.gain.value = 0
    snowGain.connect(this.ambientGain)
    this._snowGainNode = snowGain

    this._startWeatherSource('rain')
    this._startWeatherSource('snow')

    this._scheduleAmbientScare()
  }

  // Attaches the decoded rain/snow buffer to its (already-connected) gain
  // node and starts looped playback - a no-op until the buffer has finished
  // loading, and guarded against running twice for the same kind.
  _startWeatherSource(kind) {
    if (!this.ctx || !this.ambientStarted) return
    const buffer = kind === 'rain' ? this._rainBuffer : this._snowBuffer
    const gainNode = kind === 'rain' ? this._rainGainNode : this._snowGainNode
    if (!buffer || !gainNode || gainNode._sourceStarted) return
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(gainNode)
    source.start(this.ctx.currentTime)
    gainNode._sourceStarted = true
  }

  // Weather-reactive audio mix - ramps the real rain/wind ambience beds
  // in/out (see startAmbient above) and muffles the SFX bus the same way
  // indoor spaces already do (see setIndoorAmount's lowpass idea), so
  // gunfire genuinely sounds duller in a storm instead of weather only
  // being a visual/gameplay-vision effect. Snow's wind bed is a good deal
  // quieter than rain's - matching how the visual weather system already
  // treats snow as calmer than rain (no thunder, less fog) - but it's a
  // real audible layer now, not silence.
  // raining / snowing: true/false, or how hard (0..1) - the weather now
  // eases from one strength to the next (2026-10-30), over `ramp` seconds.
  setWeatherAudio(raining, snowing, ramp = 2) {
    if (!this.ctx || !this._rainGainNode || !this.sfxGain) return
    const now = this.ctx.currentTime
    const targetRainGain = 0.4 * Math.min(1, Number(raining) || 0)
    this._rainGainNode.gain.cancelScheduledValues(now)
    this._rainGainNode.gain.setValueAtTime(this._rainGainNode.gain.value, now)
    this._rainGainNode.gain.linearRampToValueAtTime(targetRainGain, now + ramp)
    if (this._snowGainNode) {
      const targetSnowGain = 0.22 * Math.min(1.6, Number(snowing) || 0)
      this._snowGainNode.gain.cancelScheduledValues(now)
      this._snowGainNode.gain.setValueAtTime(this._snowGainNode.gain.value, now)
      this._snowGainNode.gain.linearRampToValueAtTime(targetSnowGain, now + ramp)
    }
    if (!this._weatherMuffleFilter) {
      const f = this.ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 22000
      this.sfxGain.disconnect()
      this.sfxGain.connect(f).connect(this.ctx.destination)
      this._weatherMuffleFilter = f
    }
    const targetCutoff = raining ? 22000 - 16800 * Math.min(1, Number(raining)) : snowing ? 9000 : 22000
    this._weatherMuffleFilter.frequency.cancelScheduledValues(now)
    this._weatherMuffleFilter.frequency.setValueAtTime(this._weatherMuffleFilter.frequency.value, now)
    this._weatherMuffleFilter.frequency.linearRampToValueAtTime(targetCutoff, now + ramp)
  }

  // Natural disasters (Disasters.js, 2026-10-30): one looping noise bed
  // whose sound is set by `tone` - 'rumble' (earthquake, eruption, deep
  // and shaking), 'roar' (rushing water, avalanche, a wall of wind),
  // 'crackle' (fire: a hiss with pops) - at `level` (0 = off), eased.
  disasterBed(level, tone = 'rumble') {
    if (!this.ctx || !this.sfxGain) return
    const ctx = this.ctx
    const now = ctx.currentTime
    if (!this._bed) {
      const len = ctx.sampleRate * 4
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = buf.getChannelData(0)
      // Brown-ish noise (deep) with sparse clicks mixed in for fire pops.
      let last = 0
      for (let i = 0; i < len; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985
        d[i] = last * 3 + (Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0)
      }
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()
      gain.gain.value = 0
      // A slow wobble on the level so a rumble swells and shakes.
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.frequency.value = 0.7
      lfoGain.gain.value = 0
      lfo.connect(lfoGain).connect(gain.gain)
      src.connect(filter).connect(gain).connect(this.sfxGain)
      src.start()
      lfo.start()
      this._bed = { filter, gain, lfoGain, lfo }
    }
    const b = this._bed
    const shape = { rumble: ['lowpass', 120, 0.7], roar: ['lowpass', 900, 0.15], crackle: ['highpass', 1400, 0.35] }[tone] || ['lowpass', 120, 0.7]
    b.filter.type = shape[0]
    b.filter.frequency.setTargetAtTime(shape[1], now, 0.3)
    b.lfo.frequency.setTargetAtTime(tone === 'crackle' ? 3.1 : 0.7, now, 0.3)
    const g = Math.max(0, Math.min(1, level)) * (tone === 'crackle' ? 0.5 : 0.8)
    b.gain.gain.setTargetAtTime(g, now, 0.8)
    b.lfoGain.gain.setTargetAtTime(g * shape[2], now, 0.8)
  }

  // A deep boom with a long rolling tail - a meteor's impact, a volcano's
  // blast, a sonic boom (gain 0..1; far ones are quieter and duller).
  playBoom(gain = 1) {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 1.2 + gain * 3
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(300 + gain * 1500, now)
    lp.frequency.exponentialRampToValueAtTime(60, now + duration)
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.0001, now)
    ng.gain.linearRampToValueAtTime(0.9 * gain, now + 0.04)
    ng.gain.exponentialRampToValueAtTime(0.001, now + duration)
    noise.connect(lp).connect(ng).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
    const thump = ctx.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(70, now)
    thump.frequency.exponentialRampToValueAtTime(22, now + 0.9)
    const tg = ctx.createGain()
    tg.gain.setValueAtTime(gain, now)
    tg.gain.exponentialRampToValueAtTime(0.001, now + 1)
    thump.connect(tg).connect(this.sfxGain)
    thump.start(now)
    thump.stop(now + 1)
  }

  // Underground/indoor spaces (sewer, subway, buildings) get a duller,
  // more muffled wind bed - the same low-cutoff-lowpass idea playFootstep
  // already uses for muffled footsteps, applied to the constant ambient
  // wind instead of a one-shot sound. Smoothly ramped (not snapped) so
  // walking through a doorway doesn't click between two ambient beds.
  updateAmbientZone(indoors) {
    if (!this._windFilter) return
    const target = indoors ? 1 : 0
    // 0.114 per call at ~10 calls/sec is the same glide speed the old 0.02 per call had at 60fps:
    // 1 - (1 - 0.02)^6 ~= 0.114.
    this._ambientIndoorAmount += (target - this._ambientIndoorAmount) * 0.114
    const freq = 450 - this._ambientIndoorAmount * 280 // 450 outdoor -> 170 indoor
    const gain = 0.034 - this._ambientIndoorAmount * 0.012 // slightly quieter indoors
    const now = this.ctx.currentTime
    this._windFilter.frequency.setTargetAtTime(freq, now, 0.5)
    this._windGainNode.gain.setTargetAtTime(gain, now, 0.5)
  }

  setSfxVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume))
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume
  }

  setZombieVolume(volume) {
    this.zombieVolume = Math.max(0, Math.min(1, volume))
    if (this.zombieGain) this.zombieGain.gain.value = this.zombieVolume
  }

  setAmbientVolume(volume) {
    this.ambientVolume = Math.max(0, Math.min(1, volume))
    if (this.ambientGain) this.ambientGain.gain.value = this.ambientVolume
  }

  setPositionalAudio(enabled) {
    this.positionalAudioEnabled = enabled
  }

  // Footstep - a short filtered noise burst, same shape as playMelee's noise
  // hit but shorter/quieter. muffled (see Game.js's isIndoors) darkens the
  // filter cutoff instead of just lowering volume, reading as "under a roof"
  // rather than just "further away."
  // surface: 'default' (concrete/asphalt - the original sound, unchanged)
  // or 'grass' (softer, duller - a lower lowpass cutoff and slightly
  // longer/quieter decay reads as a muted thud on turf instead of a crisp
  // crunch on pavement). See PlayerController's groundSurfaceType for how
  // this gets picked.
  playFootstep(muffled = false, surface = 'default') {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const onGrass = surface === 'grass'
    const duration = onGrass ? 0.13 : 0.09

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const noise = ctx.createBufferSource()
    noise.buffer = noiseBuffer

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = muffled ? 320 : (onGrass ? 380 : 850)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime((muffled ? 0.1 : 0.16) * (onGrass ? 0.85 : 1), now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

    noise.connect(filter).connect(gain).connect(this.sfxGain)
    noise.start(now)
    noise.stop(now + duration)
  }

  // Directional zombie presence (see startAmbient's own doc comment for the
  // gain/panner nodes this reads) - a boost layered on top of the always-on
  // base drone rather than a second parallel drone system, scaled by nearby
  // zombie density and panned toward the nearest one. intensity: 0-1. pan:
  // -1 (left) to 1 (right), the nearest zombie's bearing relative to camera.
  updateZombiePresence(intensity, pan) {
    if (!this._presenceGain) return
    const now = this.ctx.currentTime
    this._presenceGain.gain.setTargetAtTime(Math.min(0.14, intensity * 0.14), now, 0.6)
    this._dronePanner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.4)
  }

  // Homepage Audio Cue on Hover/Focus (Controls tab) - a short, quiet
  // synthesized blip, same "no external file needed" approach as every
  // other sound here rather than a new audio asset.
  // Level up (2026-10-26): a short rising four-note fanfare.
  playLevelUp() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    ;[523, 659, 784, 1047].forEach((freq, i) => {
      const at = now + i * 0.11
      const osc = this.ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, at)
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, at + (i === 3 ? 0.6 : 0.18))
      osc.connect(g).connect(this.sfxGain)
      osc.start(at)
      osc.stop(at + 0.62)
    })
  }

  // A burp or a hiccup instead of a moan (FunnyZombies.js), on the
  // zombie sound slider like the moans, panned to where it came from.
  playZombieGoof(kind, pan = 0) {
    if (!this.ctx) return
    this.playSpecial(kind, this.zombieGain, pan)
  }

  // The special blocks' sounds (SpecialBlocks.js): each a few synth
  // notes - [hz, start s, length s, wave, loudness, end hz] - and/or a
  // puff of filtered noise. No sound files, so nothing extra to load.
  // out: where it plays (the effects slider unless said); pan: -1..1.
  playSpecial(kind, out = this.sfxGain, pan = 0) {
    if (!this.ctx) return
    const recipe = SPECIAL_SOUNDS[kind]
    if (!recipe) return
    const ctx = this.ctx
    let dest = out
    if (pan && ctx.createStereoPanner) {
      dest = ctx.createStereoPanner()
      dest.pan.value = Math.max(-1, Math.min(1, pan))
      dest.connect(out)
    }
    const now = ctx.currentTime
    for (const [hz, at, len, type = 'sine', gain = 0.2, endHz = hz] of recipe.notes || []) {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(hz, now + at)
      if (endHz !== hz) osc.frequency.exponentialRampToValueAtTime(endHz, now + at + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, now + at)
      g.gain.exponentialRampToValueAtTime(gain, now + at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + len)
      osc.connect(g).connect(dest)
      osc.start(now + at)
      osc.stop(now + at + len + 0.02)
    }
    if (recipe.noise) {
      const [len, from, to, gain = 0.25] = recipe.noise
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      const src = ctx.createBufferSource()
      src.buffer = buf
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.setValueAtTime(from, now)
      band.frequency.exponentialRampToValueAtTime(to, now + len)
      const g = ctx.createGain()
      g.gain.setValueAtTime(gain, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + len)
      src.connect(band).connect(g).connect(dest)
      src.start(now)
    }
  }

  // One soft piano-ish note (the Piano Block).
  playNote(hz) {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    for (const [mult, gain] of [[1, 0.22], [2, 0.06]]) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(hz * mult, now)
      const g = ctx.createGain()
      g.gain.setValueAtTime(gain, now)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
      osc.connect(g).connect(this.sfxGain)
      osc.start(now)
      osc.stop(now + 0.92)
    }
  }

  playUiHover() {
    if (!this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const duration = 0.05
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 900
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.12, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    osc.connect(gain).connect(this.sfxGain)
    osc.start(now)
    osc.stop(now + duration)
  }
}

export const audioEngine = new AudioEngine()
// Same debug-hook convention as Game.js's own `window.__game = this` (see
// that file's comment) - lets tests/tools drive or inspect real audio state
// (e.g. this.sfxVolume) without reaching into module scope.
if (typeof window !== 'undefined') window.__audioEngine = audioEngine

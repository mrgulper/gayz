// A lighter homepage for touch devices (2026-10-12, Gaymi on an iPad: "the
// homepage when just opening gayz it was lagging crazy but the game play
// fps was normal"). Measured with a 4x-slowed CPU at iPad size: the
// full-screen rain and road-water canvases, the spinning character and
// the drifting fog/ash layers together held the homepage under 10 fps.
// On a touch device (no mouse to hover - phones and tablets) the canvases
// draw at one pixel per CSS pixel, the water redraws at most 30 times a
// second, there are fewer raindrops, fog and ash hold still
// (html.lite-home, set by index.html's first script) and the rain and
// water only start once the game has loaded, so they don't fight the
// loading for the same few CPU cores. Computers are unchanged.
export const LITE_HOME = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches

// Lite effects draw about 30 times a second: a frame is skipped until this
// much time has passed (just under two 60 Hz frames, so timer jitter never
// drops it to 20).
export const LITE_FRAME_MS = 30

// How long after the game is ready the homepage effects start (lite only).
const START_AFTER_READY_MS = 600

// Calls start() now, or - on a lite homepage - once Game.js has marked the
// page ready (html.game-ready) and a moment has passed.
export function startWhenLight(start) {
  if (!LITE_HOME) return start()
  const root = document.documentElement
  const go = () => setTimeout(start, START_AFTER_READY_MS)
  if (root.classList.contains('game-ready')) return go()
  const watch = new MutationObserver(() => {
    if (!root.classList.contains('game-ready')) return
    watch.disconnect()
    go()
  })
  watch.observe(root, { attributes: true, attributeFilter: ['class'] })
}

// One clock for every homepage effect (2026-10-16, "the homepage lags on
// both mobile and keyboard devices"). The rain, the road water and the
// spinning character each ran their own requestAnimationFrame loop, so
// their redraws landed on different frames and the browser re-blended the
// whole stack of full-screen background layers far more often than any of
// them changed. Now they all draw in the same frame: 30 times a second on
// touch devices (and slow computers, below), 60 on computers.
// A computer whose homepage still can't keep up (an old laptop, a school
// Chromebook) switches to the same lighter homepage once the game has
// loaded: frames slower than SLOW_FRAME_MS on average over SLOW_SAMPLE
// frames add html.home-slow (no photo zoom, still fog/ash/embers - see
// style.css) and the 30-a-second beat.
const SLOW_FRAME_MS = 24
const SLOW_SAMPLE = 90
let homeFrameMs = LITE_HOME ? LITE_FRAME_MS : 15
let slowChecked = LITE_HOME
let slowStart = 0
let slowFrames = 0

const homeJobs = new Set()
let homeLast = -Infinity
let homeRunning = false

function checkSlow(now) {
  const root = document.documentElement
  // Only once the game is built (loading itself makes long frames) and
  // while the homepage is what's on screen.
  if (!root.classList.contains('game-ready') || document.hidden || !document.getElementById('menu')?.getClientRects().length) {
    slowFrames = 0
    return
  }
  if (slowFrames === 0) slowStart = now
  slowFrames++
  if (slowFrames < SLOW_SAMPLE) return
  slowChecked = true
  if ((now - slowStart) / (slowFrames - 1) > SLOW_FRAME_MS) {
    homeFrameMs = LITE_FRAME_MS
    root.classList.add('home-slow')
  }
}

// True while a map is open (BuildMode.enter/exit, 2026-10-17 lag hunt):
// the homepage is hidden then, so its rain, water and character skip the
// frame here instead of each asking the page whether they're on screen -
// that question made the browser lay the page out again every frame
// during play. A job with duringPlay set (other previews) still runs.
let homePaused = false
export function setHomePaused(paused) {
  homePaused = !!paused
}

function homeFrame(now) {
  requestAnimationFrame(homeFrame)
  if (!slowChecked) checkSlow(now)
  const due = now - homeLast >= homeFrameMs
  if (due) homeLast = now
  for (const job of homeJobs) {
    // Other previews (Inventory, Shop) can be open over a game and keep going.
    if (homePaused && !job.duringPlay) continue
    try {
      job(now, due)
    } catch (err) {
      console.error(err)
    }
  }
}

// Runs job(now, due) on every animation frame; `due` is true on the shared
// beat, when the effect should redraw. Returns a function
// that stops it.
export function onHomeFrame(job) {
  homeJobs.add(job)
  if (!homeRunning) {
    homeRunning = true
    requestAnimationFrame(homeFrame)
  }
  return () => homeJobs.delete(job)
}

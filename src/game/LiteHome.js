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

// Tiny shared flag so visual code that lives outside Game.js (zombie health
// bars, etc.) can react to the colorblind-mode setting without each needing
// its own wiring back to Game.js's settings object.
export const accessibility = { colorblind: false }

export function setColorblind(enabled) {
  accessibility.colorblind = enabled
  // html.colorblind-mode - lets plain CSS (damage numbers, health/armor
  // bars) react too, not just the JS-driven zombie health bars this flag
  // originally existed for. Colorblind Mode previously only touched those,
  // per this project's own notes ("distinct from Colorblind Mode which
  // only affects zombie health-bar coloring") - this extends the same
  // toggle to cover the other places red/green alone carries meaning.
  document.documentElement.classList.toggle('colorblind-mode', enabled)
}

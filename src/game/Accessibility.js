// Tiny shared flag so visual code that lives outside Game.js (zombie health
// bars, etc.) can react to the colorblind-mode setting without each needing
// its own wiring back to Game.js's settings object.
export const accessibility = { colorblind: false }

export function setColorblind(enabled) {
  accessibility.colorblind = enabled
}

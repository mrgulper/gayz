// Tiny shared flag so visual code that lives outside Game.js (zombie health
// bars, etc.) can react to the colorblind-mode setting without each needing
// its own wiring back to Game.js's settings object.
export const accessibility = { colorblindMode: 'off' }

// mode: 'off' | 'redgreen' (protanopia/deuteranopia) | 'blueyellow' (tritanopia)
export function setColorblindMode(mode) {
  accessibility.colorblindMode = mode
  // data-colorblind lets plain CSS (damage numbers, health/armor bars)
  // react too, not just the JS-driven zombie health bars this flag
  // originally existed for - see style.css's html[data-colorblind=...]
  // rules. A data attribute (not two boolean classes) so "which mode" is
  // always a single unambiguous source of truth, never two classes
  // disagreeing with each other.
  document.documentElement.dataset.colorblind = mode
}

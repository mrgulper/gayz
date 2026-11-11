// Settings added from Gaymi's 80-idea list (2026-11-11; the list is in
// docs/notes/ui-and-menu.md > "Settings ideas (to do)"). One line each:
// MoreSettings.js builds the row in Settings, loads/saves the value,
// adds it to that tab's Reset and to the Settings Code, and calls the
// hook-ups registered with onMoreSetting. No imports here on purpose -
// Game.js reads this list while it is still loading.
//
// Text keys (i18n/more-settings-<lang>.js): <key>Label, <key>InfoText,
// and <key>Opt_<value> for each choice of a list.
// type: 'range' (min, max, step, unit), 'toggle', 'select' (opts).
// page: the Settings tab; before: the element the row goes in front of.
export const MORE_SETTINGS = [
  // --- Audio (ideas 1-10) ---
  { key: 'musicVolume', type: 'range', def: 100, min: 0, max: 100, unit: '%', page: 'audio', before: 'mute-on-blur-toggle' },
  { key: 'uiVolume', type: 'range', def: 50, min: 0, max: 100, unit: '%', page: 'audio', before: 'mute-on-blur-toggle' },
  { key: 'footstepVolume', type: 'range', def: 100, min: 0, max: 100, unit: '%', page: 'audio', before: 'mute-on-blur-toggle' },
  { key: 'weaponVolume', type: 'range', def: 100, min: 0, max: 100, unit: '%', page: 'audio', before: 'mute-on-blur-toggle' },
  { key: 'monoAudio', type: 'toggle', def: false, page: 'audio', before: 'reset-audio-defaults-btn' },
  { key: 'lowHealthHeartbeat', type: 'toggle', def: true, page: 'audio', before: 'reset-audio-defaults-btn' },
  { key: 'duckNearZombies', type: 'toggle', def: false, page: 'audio', before: 'reset-audio-defaults-btn' },
  { key: 'chatPing', type: 'toggle', def: true, page: 'audio', before: 'reset-audio-defaults-btn' },
  { key: 'soundSubtitles', type: 'toggle', def: false, page: 'audio', before: 'reset-audio-defaults-btn' },
  { key: 'quietHours', type: 'select', def: 'off', opts: ['off', '20', '21', '22', '23'], page: 'audio', before: 'reset-audio-defaults-btn' },
  // --- Controls (ideas 11-24; hook-ups in ControlSettings.js, BuildTouch,
  // BuildTryMode; #15 Auto-Run is a key in Key Bindings) ---
  { key: 'crouchMode', type: 'select', def: 'hold', opts: ['hold', 'toggle'], page: 'controls', before: 'settings-section-hud-2' },
  { key: 'aimSensitivity', type: 'range', def: 100, min: 10, max: 200, step: 5, unit: '%', page: 'controls', before: 'settings-section-hud-2' },
  { key: 'mouseSmoothing', type: 'range', def: 0, min: 0, max: 100, step: 5, unit: '%', page: 'controls', before: 'settings-section-hud-2' },
  { key: 'cameraSmoothness', type: 'range', def: 0, min: 0, max: 100, step: 5, unit: '%', page: 'controls', before: 'settings-section-hud-2' },
  { key: 'defaultCameraView', type: 'select', def: 'first', opts: ['first', 'back', 'front'], page: 'controls', before: 'settings-section-hud-2' },
  { key: 'holdToInteract', type: 'select', def: '0', opts: ['0', '0.3', '0.6', '1'], page: 'controls', before: 'settings-section-hud-2' },
  { key: 'controllerSupport', type: 'toggle', def: true, page: 'controls', before: 'settings-section-hud-2' },
  { key: 'controllerVibration', type: 'toggle', def: true, page: 'controls', before: 'settings-section-hud-2' },
  { key: 'stickDeadzone', type: 'range', def: 15, min: 0, max: 40, unit: '%', page: 'controls', before: 'settings-section-hud-2' },
  { key: 'leftHandedMobile', type: 'toggle', def: false, page: 'controls', before: 'settings-section-hud-2' },
  { key: 'joystickMode', type: 'select', def: 'floating', opts: ['floating', 'fixed'], page: 'controls', before: 'settings-section-hud-2' },
  { key: 'doubleTapSprint', type: 'toggle', def: false, page: 'controls', before: 'settings-section-hud-2' },
  { key: 'gyroAim', type: 'toggle', def: false, page: 'controls', before: 'settings-section-hud-2' },
]

export const MORE_SETTING_KEYS = MORE_SETTINGS.map((s) => s.key)

export function moreKeysForPage(page) {
  return MORE_SETTINGS.filter((s) => s.page === page).map((s) => s.key)
}

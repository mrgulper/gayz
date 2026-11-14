// Settings added from Gaymi's 80-idea list (2026-11-11; the list is in
// docs/notes/ui-and-menu/settings-ideas-todo.md). One line each:
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
  { key: 'menuMusic', type: 'toggle', def: true, page: 'audio', before: 'mute-on-blur-toggle' },
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
  // --- HUD (ideas 25-38; hook-ups in HudSettings.js) ---
  { key: 'hudScale', type: 'range', def: 100, min: 60, max: 140, step: 5, unit: '%', page: 'controls', before: 'settings-section-gameplay' },
  { key: 'hideHud', type: 'toggle', def: false, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'minimapSize', type: 'select', def: 'normal', opts: ['small', 'normal', 'big'], page: 'controls', before: 'settings-section-gameplay' },
  { key: 'minimapRotate', type: 'select', def: 'north', opts: ['north', 'turn'], page: 'controls', before: 'settings-section-gameplay' },
  { key: 'killFeed', type: 'toggle', def: true, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'hitMarker', type: 'toggle', def: true, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'lowAmmoWarning', type: 'toggle', def: true, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'showPing', type: 'toggle', def: true, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'hudClock', type: 'select', def: 'off', opts: ['off', 'real', 'game'], page: 'controls', before: 'settings-section-gameplay' },
  { key: 'showCoords', type: 'toggle', def: false, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'compassBar', type: 'toggle', def: false, page: 'controls', before: 'settings-section-gameplay' },
  { key: 'chatOpacity', type: 'range', def: 100, min: 20, max: 100, step: 5, unit: '%', page: 'controls', before: 'settings-section-gameplay' },
  { key: 'chatFade', type: 'select', def: 'off', opts: ['off', '5', '10', '20', '30'], page: 'controls', before: 'settings-section-gameplay' },
  { key: 'healthDisplay', type: 'select', def: 'both', opts: ['both', 'bar', 'number'], page: 'controls', before: 'settings-section-gameplay' },
  // --- Graphics (ideas 39-50; hook-ups in GraphicsSettings.js) ---
  { key: 'screenShake', type: 'range', def: 100, min: 0, max: 200, step: 10, unit: '%', page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'particleAmount', type: 'select', def: 'high', opts: ['low', 'medium', 'high'], page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'grassTufts', type: 'toggle', def: true, page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'cloudsEnabled', type: 'toggle', def: true, page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'weatherEffects', type: 'toggle', def: true, page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'bloodStyle', type: 'select', def: 'normal', opts: ['normal', 'goo', 'off'], page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'zombieOutline', type: 'toggle', def: false, page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'batterySaver', type: 'select', def: 'auto', opts: ['off', 'on', 'auto'], page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'gamma', type: 'range', def: 100, min: 50, max: 150, step: 5, unit: '%', page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'saturation', type: 'range', def: 100, min: 0, max: 200, step: 5, unit: '%', page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'sharpen', type: 'range', def: 0, min: 0, max: 100, step: 5, unit: '%', page: 'graphics', before: 'reset-graphics-defaults-btn' },
  { key: 'handFov', type: 'range', def: 70, min: 50, max: 110, step: 1, unit: '°', page: 'graphics', before: 'reset-graphics-defaults-btn' },
  // --- Gameplay (ideas 51-62, #52 skipped; hook-ups in GameplayAssist.js) ---
  { key: 'autoReload', type: 'toggle', def: true, page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'autoSortInventory', type: 'toggle', def: false, page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'confirmSell', type: 'toggle', def: true, page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'confirmBuyOver', type: 'select', def: '100', opts: ['always', '50', '100', '250', '500', '1000', 'never'], page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'lootHighlight', type: 'select', def: 'off', opts: ['off', 'glow', 'beam'], page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'gameTips', type: 'select', def: 'silly', opts: ['off', 'silly', 'helpful', 'both'], page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'pauseWhenHidden', type: 'toggle', def: true, page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'afkPause', type: 'select', def: 'off', opts: ['off', '1', '2', '5', '10'], page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'spoilerFreeStory', type: 'toggle', def: false, page: 'controls', before: 'settings-section-accessibility-2' },
  // type 'button': a row with one button (text key <key>Btn) - no value,
  // so not saved, reset or in the Settings Code.
  { key: 'replayTutorial', type: 'button', page: 'controls', before: 'settings-section-accessibility-2' },
  { key: 'resetHints', type: 'button', page: 'controls', before: 'settings-section-accessibility-2' },
  // --- Social & Safety (ideas 63-72; #66 muted list and #68 appear
  // offline were already there; hook-ups in SocialSettings.js) ---
  { key: 'chatFilter', type: 'select', def: 'normal', opts: ['normal', 'strict'], page: 'general', before: 'settings-section-homepage' },
  { key: 'hideChat', type: 'toggle', def: false, page: 'general', before: 'settings-section-homepage' },
  { key: 'friendsOnlyChat', type: 'toggle', def: false, page: 'general', before: 'settings-section-homepage' },
  { key: 'friendRequestsFrom', type: 'select', def: 'everyone', opts: ['everyone', 'clan'], page: 'general', before: 'settings-section-homepage' },
  { key: 'hideClan', type: 'toggle', def: false, page: 'general', before: 'settings-section-homepage' },
  { key: 'hideCurrency', type: 'toggle', def: false, page: 'general', before: 'settings-section-homepage' },
  { key: 'serverAccess', type: 'select', def: 'anyone', opts: ['anyone', 'link', 'nobody'], page: 'general', before: 'settings-section-homepage' },
  { key: 'postcardsFrom', type: 'select', def: 'friends', opts: ['friends', 'nobody'], page: 'general', before: 'settings-section-homepage' },
  // --- Wellbeing & Misc (ideas 73-80; hook-ups in Wellbeing.js and
  // SettingsPresets.js). Wellbeing has its own heading in index.html. ---
  { key: 'breakReminder', type: 'select', def: 'off', opts: ['off', '30', '45', '60', '90', '120'], page: 'general', before: 'settings-section-misc' },
  { key: 'sessionTimer', type: 'toggle', def: false, page: 'general', before: 'settings-section-misc' },
  { key: 'bedtimeReminder', type: 'select', def: 'off', opts: ['off', '20', '21', '22', '23', '0'], page: 'general', before: 'settings-section-misc' },
  { key: 'dataSaver', type: 'toggle', def: false, page: 'general', before: 'reset-general-defaults-btn' },
  { key: 'sillyOfDay', type: 'toggle', def: false, page: 'general', before: 'reset-general-defaults-btn' },
  { key: 'settingsPresets', type: 'button', page: 'general', before: 'reset-general-defaults-btn' },
  { key: 'settingsQr', type: 'button', page: 'general', before: 'reset-general-defaults-btn' },
  { key: 'undoSettingChange', type: 'button', page: 'general', before: 'reset-general-defaults-btn' },
]

const VALUED = MORE_SETTINGS.filter((s) => s.type !== 'button')

export const MORE_SETTING_KEYS = VALUED.map((s) => s.key)

export function moreKeysForPage(page) {
  return VALUED.filter((s) => s.page === page).map((s) => s.key)
}

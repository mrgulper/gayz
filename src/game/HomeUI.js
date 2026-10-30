// The homepage's own widgets: the clock and greeting, the nameplate and
// player tag, the currency bar, the background mood, the paint cache that
// makes the first paint final, goals, the news ticker and the cards
// (best run, highlights, rank roadmap, recently changed, nearly there...).
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import * as CloudSaveUI from './CloudSaveUI.js'
import * as MenuEasterEggs from './MenuEasterEggs.js'
import { setColorblindMode } from './Accessibility.js'
import { ACHIEVEMENTS } from './Achievements.js'
import { CAREER_RANK_TITLES, EVENT_BANNERS, GOAL_CANDIDATES, MAX_GOALS, MENU_PAINT_CACHE_KEY, MENU_PAINT_CACHE_ROOTS, MUTATOR_LABEL_KEYS, NEARLY_THERE_CANDIDATES, NEWS_TICKER_LATE_NIGHT, NEWS_TICKER_MID_NIGHT, WEEKLY_FEATURED_MUTATOR_BONUS_COINS, _escapeHtml, _safeStatNumber, _weeklyFeaturedMutatorKey, saveSettings, todayDateString } from './Game.js'
import { setLanguage, t } from './i18n.js'

// Homepage clock (General tab, settings.timeFormat) - the only place
// in the game that shows an absolute (not relative/countdown) local
// time, so it's the one thing the 12h/24h setting actually controls.
export function _updateHomepageClock(game) {
  const now = new Date()
  // The player's own clock and time zone (the device's).
  if (!game._clockZoneShown) {
    game._clockZoneShown = true
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone) game.homepageClockEl.title = `${game.homepageClockEl.title || 'Current time'} (${zone.replace(/_/g, ' ')})`
  }
  if (game.settings.timeFormat === '24h') {
    game.homepageClockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  } else {
    const h24 = now.getHours()
    const h12 = h24 % 12 || 12
    game.homepageClockEl.textContent = `${h12}:${String(now.getMinutes()).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
  }
}

// Diffs the live settings object against the snapshot taken when the
// panel was opened (see _toggleSettings) - shallow key comparison, good
// enough since nearly every settings field is a primitive; the handful
// of object/array fields (mutators, navOrder, etc.) just compare by
// JSON string equality, which still correctly detects "did this change."
// lastSettingsTab is excluded on purpose - it's written on every single
// tab click (see the .settings-tab handler), so without this exclusion
// just browsing tabs (with zero real settings touched) would flag it as
// a "change." A REAL change (language, a slider, etc.) still legitimately
// shows this banner - #settings-status-row/#recently-changed-list.show
// (style.css) reserve fixed space for it via visibility rather than
// display:none, so the panel-box itself never resizes either way (it
// used to - a language switch, which touches settings.language/
// quickLanguageAlt, made the whole panel visibly grow).
// Returns whether anything real actually changed - saveSettings() (Game.js
// module scope, above the class) reuses this to decide whether its own
// "Saved" pulse indicator is warranted, so the two never disagree about
// what counts as a real change.
export function _renderRecentlyChangedList(game) {
  if (!game.recentlyChangedList || !game._settingsOpenSnapshot) return false
  const before = JSON.parse(game._settingsOpenSnapshot)
  const changed = Object.keys(game.settings)
    .filter((k) => k !== 'lastSettingsTab')
    .filter((k) => JSON.stringify(game.settings[k]) !== JSON.stringify(before[k]))
  if (!changed.length) {
    game.recentlyChangedList.classList.remove('show')
    return false
  }
  game.recentlyChangedList.classList.add('show')
  // Raw camelCase setting keys (exactLastSeen, toastDuration, ...) read as a
  // developer's own field name, not a sentence - capitalizing just the
  // first letter (ExactLastSeen) is a one-line, no-translation-needed
  // way to make the list read a little more like a real label without
  // needing a display-name lookup table kept in sync with 150+ settings
  // keys.
  const displayList = changed.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(', ')
  game.recentlyChangedList.innerHTML = `<p>${t('recentlyChangedLabel', { list: displayList })}</p><button id="undo-settings-session-btn" class="mini-action-btn" type="button">${t('undoSettingsBtn')}</button>`
  document.getElementById('undo-settings-session-btn')?.addEventListener('click', () => game._undoSettingsSession())
  return true
}

// Confirms whatever's currently in the nickname box (typed or a Random
// preview) as the real saved nickname, then closes the editor row.
export function _confirmNicknameEdit(game) {
  if (!game.nicknameRow || !game.nicknameInput) return
  // .trim() - see the live 'input' listener's own comment on game same
  // fix, right below #nickname-input's other binding.
  game.settings.nickname = game.nicknameInput.value.trim()
  saveSettings(game.settings)
  game._renderPlayerTag()
  game.nicknameRow.style.display = 'none'
  game.nicknameInput.blur()
}

// Homepage corner currency bar (Coins/Points/Gems) - piggybacks on the
// homepage stats refresh rather
// than a save call/listener at each individual currency mutation site.
export function _renderCurrencyBar(game) {
  if (game.currencyCoinsAmount) game.currencyCoinsAmount.textContent = _safeStatNumber(game.coins)
  // Points (the blue star) are what Upgrades cost - a share of every
  // run's kills and waves (2026-10-12; they were called Legacy Points, and
  // the star used to show only the last run's score).
  if (game.currencyPointsAmount) game.currencyPointsAmount.textContent = Math.round(_safeStatNumber(game.metaProgress?.legacyPoints))
  if (game.currencyCashAmount) game.currencyCashAmount.textContent = _safeStatNumber(game.cash)
  if (game.currencyGemsAmount) game.currencyGemsAmount.textContent = _safeStatNumber(game.gems)
}

export function _renderPlayerTag(game) {
  if (!game.menuPlayerTag) return
  // Motto removed (2026-09-23, explicit request) - used to append
  // `"{motto}"` after the ID here; just the ID now.
  game.menuPlayerTag.textContent = game.settings.playerId ? `#${game.settings.playerId}` : t('menuPlayerTagDefault')
  // The "Player" section heading above the 3D avatar - shows the
  // player's own chosen nickname once they've set one, falls back to
  // the generic "Player" label otherwise (same default the heading
  // ships with in index.html). Level number goes in front of the name
  // (reusing the same tier already shown on the avatar-corner badge,
  // not a separate deeper level system); the clan name (if any, see
  // settings.clanName) shows on its own line above, simple plain text
  // rather than the boxed badge/pill look from the reference image.
  if (game.playerShowcaseTitle) {
    game._fillNameplate(game.playerShowcaseTitle)
    game._fitPlayerShowcaseTitle()
  }
}

// The player's nameplate - level box, name, clan tag - shown the same way
// above the homepage character and Inventory's preview (2026-10-11,
// Gaymi: "copy the inventory name, level and clan to the spinning one").
// Each theme styles it (.nameplate in style.css).
export function _fillNameplate(game, el) {
  const part = (cls) => el.querySelector(`.${cls}`)
  const level = part('nameplate-level')
  const name = part('nameplate-name')
  const clan = part('nameplate-clan')
  if (level) level.textContent = String(game._computeAvatarLevel())
  if (name) name.textContent = game.settings.nickname?.trim() || game._defaultNickname()
  if (clan) {
    const clanName = (game.settings.clanName || '').trim()
    clan.textContent = clanName
    clan.style.display = clanName ? '' : 'none'
    el.classList.toggle('has-clan', !!clanName)
  }
}

// "Lvl 1 [name]" must stay pinned to the exact same spot no matter how
// long the name is (#menu-col-left is bottom-anchored - see its own CSS
// comment - so letting this text wrap onto a 2nd line pushes everything
// above it, including this same title, further up the screen). Instead
// of wrapping or truncating, shrink the font just enough to keep it on
// one line - reset to the CSS default first (so it grows back once the
// name/level shrinks again), then scale down only if it still overflows
// the space actually available next to the pencil button.
export function _fitPlayerShowcaseTitle(game) {
  const title = game.playerShowcaseTitle
  const header = title?.closest('#player-showcase-header')
  const pencil = game.playerShowcaseRenameBtn
  if (!title || !header || !pencil) return
  title.style.fontSize = ''
  const headerGap = parseFloat(getComputedStyle(header).columnGap || getComputedStyle(header).gap) || 0
  // The pencil on the right has an invisible twin on the left (style.css,
  // #player-showcase-header::before) so the name sits in the middle.
  const available = header.clientWidth - 2 * (pencil.offsetWidth + headerGap)
  if (available <= 0) return
  const naturalWidth = title.scrollWidth
  if (naturalWidth <= available) return
  const baseFontSize = parseFloat(getComputedStyle(title).fontSize)
  const minFontSize = 11
  const scaledSize = Math.floor(baseFontSize * (available / naturalWidth))
  title.style.fontSize = `${Math.max(minFontSize, scaledSize)}px`
}

export function _copyPlayerId(game) {
  if (!game.settings.playerId || !navigator.clipboard || !navigator.clipboard.writeText) return
  // A small oval "Copied" badge right above the ID you clicked, not the
  // shared homepage toast - a dedicated confirmation for a copy action
  // reads clearer than reusing the same banner used for lore/milestones.
  navigator.clipboard.writeText(`#${game.settings.playerId}`).then(() => game._showCopiedBadge(game.menuPlayerTag)).catch(() => {})
}

// Homepage Background Mood (Settings panel) - 'auto' follows the same
// EVENT_BANNERS date windows as the banner above (falling back to no
// filter outside any window), any other settings.bgMood value is an
// explicit user override that always wins regardless of date. Applies
// via a class on <html>, matching the large-text-mode/high-contrast-mode
// convention, so it's a single CSS filter swap - no new DOM elements.
export function _applyBgMood(game) {
  let mood = game.settings.bgMood
  if (mood === 'auto') {
    const now = new Date()
    const active = EVENT_BANNERS.find((ev) => now.getMonth() === ev.month && now.getDate() >= ev.startDay && now.getDate() <= ev.endDay)
    mood = active ? active.bgMood : 'none'
  } else if (mood === 'timeofday') {
    // Reuses the same 3 existing tint classes (no new art) mapped to the
    // player's real local hour rather than a fixed/seasonal schedule -
    // late night keeps the default night-photo look as-is since there's
    // no separate daytime photo asset to switch to.
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 8) mood = 'foggy'
    else if (hour >= 8 && hour < 17) mood = 'amber'
    else if (hour >= 17 && hour < 22) mood = 'bloodmoon'
    else mood = 'none'
  }
  for (const cls of ['bg-mood-bloodmoon', 'bg-mood-foggy', 'bg-mood-amber']) {
    document.documentElement.classList.remove(cls)
  }
  if (mood !== 'none') document.documentElement.classList.add(`bg-mood-${mood}`)
}

// Homepage batch - every quick-action/one-shot listener that isn't
// already covered by its own bind method (the difficulty buttons keep
// _bindDifficulty - Play Again clicks those same real buttons rather
// than duplicating their apply logic).
export function _bindHomepageBatch(game) {
  // Reuses _generateCareerPortrait() as-is (see its own comment - it
  // already composites a styled stat-card image, not a plain
  // screenshot). The Profile panel's own button stays gated behind
  // ENDGAME_ACHIEVEMENT; game homepage shortcut uses the same lower bar as
  // Play Again/Share above it (any completed run at all), since a
  // shareable stat card is reasonable to want well before the true
  // ending.
  if (game.updateAvailableRefreshBtn) game.updateAvailableRefreshBtn.addEventListener('click', () => window.location.reload())
  // The red X (was a Later button) - see _hideUpdateBanner.
  if (game.updateAvailableLaterBtn) game.updateAvailableLaterBtn.addEventListener('click', () => game._hideUpdateBanner())
  // Map Editor asks first: Worlds (Map 1 and the biomes) or Plain
  // (endless flat grass) - 2026-10-24, Gaymi.
  const pick = document.getElementById('editor-pick-dialog')
  const closePick = () => { if (pick) pick.style.display = 'none' }
  if (game.buildModeBtn) {
    game.buildModeBtn.addEventListener('click', () => {
      if (!pick) { game._enterBuildMode(); return }
      document.getElementById('editor-pick-title').textContent = t('editorPickTitle')
      for (const [id, key] of [['editor-pick-worlds-name', 'editorPickWorlds'], ['editor-pick-worlds-text', 'editorPickWorldsText'], ['editor-pick-plain-name', 'editorPickPlain'], ['editor-pick-plain-text', 'editorPickPlainText']]) {
        document.getElementById(id).textContent = t(key)
      }
      pick.style.display = 'flex'
    })
  }
  pick?.addEventListener('click', (e) => { if (e.target === pick) closePick() })
  document.getElementById('editor-pick-close')?.addEventListener('click', closePick)
  for (const btn of pick?.querySelectorAll('.editor-pick-option') || []) {
    btn.addEventListener('click', () => {
      closePick()
      game._enterBuildMode({ map: btn.dataset.map })
    })
  }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pick?.style.display === 'flex') closePick() })
  game._renderMapSelect()
  const buildExitBtn = document.getElementById('build-mode-exit-btn')
  if (buildExitBtn) buildExitBtn.addEventListener('click', () => game._exitBuildMode())
  const buildSaveBtn = document.getElementById('build-mode-save-btn')
  if (buildSaveBtn) buildSaveBtn.addEventListener('click', () => game.buildMode.save())
  const buildExportBtn = document.getElementById('build-mode-export-btn')
  if (buildExportBtn) buildExportBtn.addEventListener('click', () => game.buildMode.exportMap())
  const buildImportBtn = document.getElementById('build-mode-import-btn')
  const buildImportInput = document.getElementById('build-mode-import-input')
  if (buildImportBtn && buildImportInput) {
    buildImportBtn.addEventListener('click', () => buildImportInput.click())
    buildImportInput.addEventListener('change', async () => {
      const file = buildImportInput.files[0]
      buildImportInput.value = ''
      if (!file) return
      if (!window.confirm(t('buildImportConfirm'))) return
      const ok = await game.buildMode.importMapFile(file)
      // _showLoreToast no-ops here - it's gated on gameStarted, which
      // Build Mode deliberately sets false (see _enterBuildMode). This is
      // the same "homepage-safe" ungated variant used elsewhere for
      // toasts that genuinely belong to a pre-gameStarted context.
      game._showHomepageToast(t(ok ? 'buildImportSuccess' : 'buildImportInvalid'))
    })
  }
  // Share Map / Community Maps (BuildShare.js).
  document.getElementById('build-mode-publish-btn')?.addEventListener('click', () => game.buildMode.share.shareCurrent())
  document.getElementById('build-mode-browse-btn')?.addEventListener('click', () => game.buildMode.share.open())
  document.getElementById('build-mode-gallery-btn')?.addEventListener('click', () => game.buildMode.share.postToGallery())
  MenuEasterEggs.bindAll(game)
  window.addEventListener('online', () => CloudSaveUI.updateOnlineStatus(game))
  window.addEventListener('offline', () => CloudSaveUI.updateOnlineStatus(game))
  if (game.shortcutCheatsheetCloseBtn) {
    game.shortcutCheatsheetCloseBtn.addEventListener('click', () => { game.shortcutCheatsheet.style.display = 'none' })
  }

  if (game.profileNotesInput) {
    game.profileNotesInput.addEventListener('input', () => {
      game.settings.privateNotes = game.profileNotesInput.value.slice(0, 5000)
      saveSettings(game.settings)
    })
  }
  if (game.profileBioInput) {
    game.profileBioInput.addEventListener('input', () => {
      game.settings.bio = game.profileBioInput.value.slice(0, 5000)
      if (game.profileBioInput.value.length > 5000) game.profileBioInput.value = game.settings.bio
      saveSettings(game.settings)
      game._renderProfileBioCounter()
    })
  }

  if (game.quickMuteBtn) {
    game.quickMuteBtn.classList.toggle('active', !!game.settings.mutedBeforeVolumes)
    game.quickMuteBtn.addEventListener('click', () => {
      if (game.settings.mutedBeforeVolumes) {
        game.settings.sfxVolume = game.settings.mutedBeforeVolumes.sfx
        game.settings.mutedBeforeVolumes = null
      } else {
        game.settings.mutedBeforeVolumes = { sfx: game.settings.sfxVolume }
        game.settings.sfxVolume = 0
      }
      game._applyAllVolumes()
      if (game.sfxVolumeSlider) { game.sfxVolumeSlider.value = game.settings.sfxVolume; game.sfxVolumeValue.textContent = `${game.settings.sfxVolume}%` }
      saveSettings(game.settings)
      game.quickMuteBtn.classList.toggle('active', !!game.settings.mutedBeforeVolumes)
    })
  }

  if (game.quickColorblindBtn) {
    game.quickColorblindBtn.classList.toggle('active', game.settings.colorblindMode !== 'off')
    // Quick on/off, not a 3-way cycle - picking WHICH mode (redgreen vs
    // blueyellow) is a one-time setup choice that belongs in the real
    // Settings dropdown, not something to hunt for via repeated clicks on
    // a homepage icon. Remembers whichever mode was last selected there
    // (defaulting to redgreen, the more common form) and just flips it on/off.
    game.quickColorblindBtn.addEventListener('click', () => {
      if (game.settings.colorblindMode !== 'off') {
        game._lastColorblindMode = game.settings.colorblindMode
        game.settings.colorblindMode = 'off'
      } else {
        game.settings.colorblindMode = game._lastColorblindMode || 'redgreen'
      }
      setColorblindMode(game.settings.colorblindMode)
      if (game.colorblindModeSelect) game.colorblindModeSelect.value = game.settings.colorblindMode
      saveSettings(game.settings)
      game.quickColorblindBtn.classList.toggle('active', game.settings.colorblindMode !== 'off')
    })
  }

  if (game.quickPerformanceBtn) {
    game.quickPerformanceBtn.classList.toggle('active', game.settings.performanceMode)
    game.quickPerformanceBtn.addEventListener('click', () => {
      game.settings.performanceMode = !game.settings.performanceMode
      game._applyPerformanceMode(game.settings.performanceMode)
      if (game.performanceToggle) game.performanceToggle.checked = game.settings.performanceMode
      saveSettings(game.settings)
      game.quickPerformanceBtn.classList.toggle('active', game.settings.performanceMode)
    })
  }

  // Quick Language toggle - flips between English and settings.
  // quickLanguageAlt (the most recent non-English language picked via
  // the full grid in Settings, see _bindSettings' language-btn handler)
  // rather than cycling all 20 LANGUAGES one at a time, and rather than
  // just reopening Settings (which already defaults to the Language tab
  // - a second icon doing the exact same thing would be a pure duplicate).
  if (game.quickLanguageBtn) {
    game.quickLanguageBtn.addEventListener('click', () => {
      const next = game.settings.language === 'en' ? game.settings.quickLanguageAlt : 'en'
      game.settings.language = next
      saveSettings(game.settings)
      setLanguage(next)
      game._applyLanguage()
      if (game.languageGrid) {
        for (const el of game.languageGrid.querySelectorAll('.language-btn')) {
          el.classList.toggle('active', el.dataset.lang === next)
        }
      }
    })
  }

  if (game.howtoplayBtn) game.howtoplayBtn.addEventListener('click', () => game._openHowToPlayPanel())
  if (game.howtoplayPanel) {
    game.howtoplayPanel.addEventListener('click', (e) => {
      if (e.target === game.howtoplayPanel) game._closeHowToPlayPanel()
    })
  }
}

// Main-menu news ticker - tied to bestStats.bestWave (already persisted,
// no new tracking needed), framed as the world worsening the further
// you've ever gotten rather than reacting to any single run's outcome.
export function _updateMenuNewsTicker(game) {
  if (!game.menuNewsTicker) return
  const n = game.bestStats.bestWave
  const key = n >= NEWS_TICKER_LATE_NIGHT ? 'newsTickerLate' : n >= NEWS_TICKER_MID_NIGHT ? 'newsTickerMid' : 'newsTickerEarly'
  game.menuNewsTicker.textContent = t(key)
  if (game.weeklyFeaturedMutatorLine) {
    const mutatorKey = _weeklyFeaturedMutatorKey()
    game.weeklyFeaturedMutatorLine.textContent = t('weeklyFeaturedMutatorLine', {
      mutator: t(MUTATOR_LABEL_KEYS[mutatorKey]),
      coins: WEEKLY_FEATURED_MUTATOR_BONUS_COINS,
    })
  }
  game._fitMenuLayout()
}

// Remembers what the homepage shows - currencies, profile card, and every
// label in the player's language - so index.html can paint it on the next
// visit before the game has loaded (see __menuLayout there). Per root,
// the text and inline display of each leaf element in document order,
// plus their count: index.html only applies a root whose count still
// matches, so a changed page never gets text in the wrong places.
// Device-only key, never synced.
export function _saveMenuPaintCache(_game) {
  const roots = {}
  for (const rootId of MENU_PAINT_CACHE_ROOTS) {
    const root = document.getElementById(rootId)
    if (!root) continue
    const leaves = [...root.querySelectorAll('*')].filter((el) => !el.children.length && !el.closest('svg') && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE')
    const d = {}
    leaves.forEach((el, i) => { if (el.hasAttribute('style')) d[i] = el.style.display })
    roots[rootId] = { n: leaves.length, t: leaves.map((el) => el.textContent), d }
  }
  try {
    localStorage.setItem(MENU_PAINT_CACHE_KEY, JSON.stringify({ v: 2, roots }))
  } catch { /* storage full or blocked - next visit just waits for the game */ }
}

// Recently Unlocked strip (Profile panel) - a persistent list, not just
// one line - getRecentUnlocks(n) with n=5.
export function _renderRecentUnlocksStrip(game) {
  if (!game.recentUnlocksList) return
  if (game.recentUnlocksHeading) game.recentUnlocksHeading.textContent = t('recentUnlocksHeading')
  const recent = game.achievements.getRecentUnlocks(5)
  game.recentUnlocksList.innerHTML = recent.length
    ? recent.map((ach) => `<button class="perk-option" disabled><span class="perk-name">${t(ach.titleKey)}</span></button>`).join('')
    : `<p class="nearly-there-line">${t('recentUnlocksEmpty')}</p>`
}

// Highlight Reel - auto-picks the 3 most impressive numbers from a
// curated candidate list, ranked by value/benchmark ratio (not just
// raw magnitude, which would always favor whichever stat happens to
// use the smallest unit). "Benchmark" is a round, clearly-labeled
// reference point for each stat (not a hidden fabricated threshold),
// shown alongside the value so the ranking is legible, not mysterious.
export function _renderHighlightReel(game) {
  if (!game.highlightReelList) return
  if (game.highlightReelHeading) game.highlightReelHeading.textContent = t('highlightReelHeading')
  const statsDashboardHeading = document.getElementById('stats-dashboard-heading')
  if (statsDashboardHeading) statsDashboardHeading.textContent = t('statsDashboardHeading')
  const candidates = [
    { labelKey: 'profileTotalKills', value: _safeStatNumber(game.careerStats.totalKills), benchmark: 5000 },
    { labelKey: 'profilePlaytime', value: Math.floor(_safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) / 3600), benchmark: 20 },
    { labelKey: 'profileBestKillStreak', value: _safeStatNumber(game.bestStats.bestKillStreak), benchmark: 30 },
    { labelKey: 'profileTotalRuns', value: _safeStatNumber(game.careerStats.totalRuns), benchmark: 100 },
    { labelKey: 'profileMostProfitableRun', value: _safeStatNumber(game.careerStats.mostProfitableRun), benchmark: 5000 },
  ]
  const top3 = candidates
    .filter((c) => c.value > 0)
    .sort((a, b) => (b.value / b.benchmark) - (a.value / a.benchmark))
    .slice(0, 3)
  game.highlightReelList.innerHTML = top3.length
    ? top3.map((c) => `
        <button class="perk-option" disabled>
          <span class="perk-name">${t(c.labelKey)}</span>
          <span class="perk-cost">${Math.round(c.value).toLocaleString()}</span>
        </button>
      `).join('')
    : `<p class="nearly-there-line">${t('highlightReelEmpty')}</p>`
}

// Goals picker - toggleable chips, one per GOAL_CANDIDATES entry, capped
// at 3 selected (oldest bumped on a 4th pick, same "cap and shift"
// precedent settings.savedFriends/menuPresets already use).
export function _renderGoalsPicker(game) {
  if (!game.goalsPicker) return
  if (game.goalsHeading) game.goalsHeading.textContent = t('goalsHeading')
  game.goalsPicker.innerHTML = GOAL_CANDIDATES.map((goal) => `
    <button class="goal-chip${game.settings.selectedGoals.includes(goal.id) ? ' active' : ''}" data-goal="${goal.id}">${t(goal.titleKey)}</button>
  `).join('')
  for (const btn of game.goalsPicker.querySelectorAll('.goal-chip')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.goal
      if (game.settings.selectedGoals.includes(id)) {
        game.settings.selectedGoals = game.settings.selectedGoals.filter((g) => g !== id)
      } else {
        if (game.settings.selectedGoals.length >= MAX_GOALS) game.settings.selectedGoals.shift()
        game.settings.selectedGoals.push(id)
      }
      saveSettings(game.settings)
      game._renderGoalsPicker()
      game._renderGoalsChecklist()
    })
  }
}

export function _renderGoalsChecklist(game) {
  if (!game.goalsChecklist) return
  game.goalsChecklist.innerHTML = game.settings.selectedGoals.map((id) => {
    const goal = GOAL_CANDIDATES.find((g) => g.id === id)
    if (!goal) return ''
    const total = goal.total(game)
    const current = Math.min(goal.current(game), total)
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    return `
      <div class="nearly-there-item">
        <p class="nearly-there-line">${_escapeHtml(t('goalProgressLine', { title: t(goal.titleKey), current: current.toLocaleString(), total: total.toLocaleString() }))}${pct >= 100 ? ` ${t('goalCompleteBadge')}` : ''}</p>
        <div class="mini-progress-track" aria-hidden="true"><div class="mini-progress-fill" style="width: ${pct}%"></div></div>
      </div>
    `
  }).join('') || `<p class="nearly-there-line">${t('goalsEmpty')}</p>`
}

// Rank Roadmap - all CAREER_RANK_TITLES tiers at once (the homepage/
// spotlight ticker only ever shows the CURRENT tier one at a time), with
// the reached ones checked off and the current one highlighted, so a
// player can see the whole ladder rather than just where they stand
// right now. Written to two places - Profile's own copy and the
// standalone Levels panel's copy - same markup, same data, so they can
// never drift apart from each other.
export function _renderRankRoadmap(game) {
  if (!game.rankRoadmapList) return
  if (game.rankRoadmapHeading) game.rankRoadmapHeading.textContent = t('rankRoadmapHeading')
  const kills = _safeStatNumber(game.careerStats.totalKills)
  const html = CAREER_RANK_TITLES.map((tier, i) => {
    const reached = kills >= tier.min
    const isCurrent = reached && (i === CAREER_RANK_TITLES.length - 1 || kills < CAREER_RANK_TITLES[i + 1].min)
    return `
      <button class="perk-option${isCurrent ? ' active' : ''}" disabled>
        <span class="perk-name">${reached ? '✓ ' : ''}${t(tier.titleKey)}</span>
        <span class="perk-cost">${t('rankRoadmapThreshold', { n: tier.min.toLocaleString() })}</span>
      </button>
    `
  }).join('')
  if (game.rankRoadmapList) game.rankRoadmapList.innerHTML = html
}

export function _renderFavoriteDifficultyLine(game) {
  if (!game.profileFavoriteDifficultyLine) return
  const entries = Object.entries(game.careerStats.difficultyStats)
  if (entries.length === 0) {
    game.profileFavoriteDifficultyLine.style.display = 'none'
    return
  }
  const [favoriteId] = entries.reduce((best, cur) => (cur[1].runs > best[1].runs ? cur : best))
  const btn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === favoriteId)
  game.profileFavoriteDifficultyLine.textContent = t('favoriteDifficultyLine', { difficulty: btn ? btn.textContent : favoriteId })
  game.profileFavoriteDifficultyLine.style.display = ''
}

// Best Run card - the runHistory entry matching bestStats.bestWave
// (the same "single best-ever run" bestStats already is the source of
// truth for), showing the difficulty/loadout/companion fields
// _recordRunEnd already captures on every entry (see CLAUDE.md's note
// on why those were added) rather than tracking a new "best run"
// snapshot separately.
export function _renderBestRunCard(game) {
  if (!game.profileBestRunCard) return
  const best = game.runHistory.find((r) => _safeStatNumber(r.night) === _safeStatNumber(game.bestStats.bestWave))
  if (!best) {
    game.profileBestRunCard.style.display = 'none'
    return
  }
  game.profileBestRunTitle.textContent = t('profileBestRunTitle')
  const diffBtn = Array.from(game.difficultyBtns).find((b) => b.dataset.difficulty === best.difficulty)
  game.profileBestRunLine.textContent = t('profileBestRunLine', {
    night: _safeStatNumber(best.night),
    kills: _safeStatNumber(best.kills),
    coins: _safeStatNumber(best.coins),
    difficulty: diffBtn ? diffBtn.textContent : (best.difficulty || '?'),
  })
  game.profileBestRunCard.style.display = ''
}

// Nearly There nudge - the single closest-to-unlocking achievement among
// a small curated set of *persistent, numeric* achievements (most
// achievement conditions are per-run counters that reset, so aren't
// meaningful to show as a lifetime "so close" hint).
// Shows every currently-qualifying candidate (sorted closest-first),
// not a fixed "top 3" - NEARLY_THERE_CANDIDATES only has 2 entries
// right now (see its own comment on why most achievements can't back
// this honestly), so this naturally shows 0-2 lines rather than
// padding to a number that doesn't reflect what's actually trackable.
export function _renderNearlyThereNudge(game) {
  if (!game.profileNearlyThereList) return
  const rows = []
  for (const c of NEARLY_THERE_CANDIDATES) {
    if (game.achievements.unlocked.has(c.achievementId)) continue
    const total = c.total(game)
    if (total <= 0) continue
    const current = Math.min(c.current(game), total)
    rows.push({ ...c, current, total, ratio: current / total })
  }
  rows.sort((a, b) => b.ratio - a.ratio)
  game.profileNearlyThereList.innerHTML = rows.map((r) => {
    const def = ACHIEVEMENTS.find((a) => a.id === r.achievementId)
    const pct = Math.round(r.ratio * 100)
    return `
      <div class="nearly-there-item">
        <p class="nearly-there-line">${_escapeHtml(t('nearlyThereLine', { title: t(def.titleKey), current: r.current, total: r.total }))}</p>
        <div class="mini-progress-track" aria-hidden="true"><div class="mini-progress-fill" style="width: ${pct}%"></div></div>
      </div>
    `
  }).join('')
}

// "X days since your first run" - careerStats.firstPlayedDate is set
// once, on the very first completed run (see _recordRunEnd), never
// touched again. Hidden entirely before that first run exists (a
// brand-new save has nothing to anniversary yet).
export function _renderAnniversaryLine(game) {
  if (!game.profileAnniversaryLine) return
  if (!game.careerStats.firstPlayedDate) {
    game.profileAnniversaryLine.style.display = 'none'
    return
  }
  const days = Math.max(0, Math.round((new Date(todayDateString()) - new Date(game.careerStats.firstPlayedDate)) / 86400000))
  game.profileAnniversaryLine.textContent = t('anniversaryLine', { n: days })
  game.profileAnniversaryLine.style.display = ''
}

export function _renderStatusPicker(game) {
  if (!game.statusPickBtns) return
  const mode = game.settings.statusMode
  for (const btn of game.statusPickBtns) {
    btn.classList.toggle('active', btn.dataset.status === mode)
  }
  const labels = { online: t('friendStatusOnline'), idle: t('friendStatusIdle'), dnd: t('friendStatusDnd'), offline: t('friendStatusOffline') }
  if (game.statusPickerDot) game.statusPickerDot.dataset.status = mode
  if (game.statusPickerLabel) game.statusPickerLabel.textContent = labels[mode] || labels.online
  // No Status heading since it moved in front of the friend box (2026-10-30).
  const toggle = document.getElementById('status-picker-toggle')
  if (toggle) toggle.title = t('statusRowHeading')
}

// Count-up animation for Profile stat numbers - only touches values
// that are a plain whole number (with optional thousands commas), so
// percentages/ratios/dates/text values are left exactly as rendered
// rather than mangled by a naive count-up. Skipped under reduced-motion
// (the real final value is already on screen from the synchronous
// render above, nothing more to do).
export function _animateStatCountUp(game) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (const el of game.profileOptions.querySelectorAll('.perk-cost')) {
    const text = el.textContent
    if (!/^[\d,]+$/.test(text)) continue
    const target = Number(text.replace(/,/g, ''))
    if (!Number.isFinite(target) || target <= 0) continue
    const duration = 500
    const start = performance.now()
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      el.textContent = Math.round(target * progress).toLocaleString()
      if (progress < 1) requestAnimationFrame(step)
      else el.textContent = target.toLocaleString()
    }
    requestAnimationFrame(step)
  }
}

// Most-used mutator helper (see _openProfilePanel) - the single highest
// tally in careerStats.mutatorUseCounts (see _recordRunEnd).
export function _mostUsedMutatorLabel(game) {
  let bestId = null
  let bestCount = 0
  for (const [id, count] of Object.entries(game.careerStats.mutatorUseCounts)) {
    if (count > bestCount) { bestCount = count; bestId = id }
  }
  if (!bestId) return t('profileMostUsedMutatorNone')
  return t('profileMostUsedMutatorValue', { name: t(MUTATOR_LABEL_KEYS[bestId] || bestId), n: bestCount })
}

// Confetti burst on a new personal best (see _recordRunEnd's
// _pendingConfetti flag) - a handful of plain colored divs falling and
// fading via CSS, no canvas/library, auto-removed after the animation
// ends. Skipped entirely under prefers-reduced-motion.
export function _fireConfetti(_game) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#e0c03e', '#7fd88f', '#6fa8dc', '#c9564a', '#b07cd6']
  for (let i = 0; i < 24; i++) {
    const piece = document.createElement('div')
    piece.className = 'confetti-piece'
    piece.style.left = `${Math.random() * 100}vw`
    piece.style.background = colors[Math.floor(Math.random() * colors.length)]
    piece.style.animationDelay = `${Math.random() * 0.3}s`
    piece.style.animationDuration = `${1.8 + Math.random() * 0.8}s`
    document.body.appendChild(piece)
    piece.addEventListener('animationend', () => piece.remove())
  }
}

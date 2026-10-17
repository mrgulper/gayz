// Your Profile: the signed-out Sign Up / Login card, account row, bio, public
// profile fields, career portrait, skin upload/import and the menu avatar
// photo, plus the Levels panel.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import { ACHIEVEMENTS } from './Achievements.js'
import { ENDGAME_ACHIEVEMENT, PROFILE_GROUP_ORDER, PROFILE_STAT_GROUPS, _escapeHtml, _formatDurationShort, _safeStatNumber, careerRankTitleKey, saveSettings } from './Game.js'
import { loadSkinTexture } from './MenuAvatar3D.js'
import { t } from './i18n.js'

// Levels panel - opened by the level coin on the profile card. Coming
// Soon (2026-10-11, Gaymi: "delete everything and change it to coming
// soon") - it used to repeat Profile's Rank Roadmap.
export function _openLevelsPanel(game) {
  game._closeAllMenuPanels()
  game.levelsPanel.style.display = 'flex'
  const text = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key) }
  text('levels-panel-title', 'levelsPanelTitle')
  text('levels-coming-title', 'comingSoonTitle')
  text('levels-coming-text', 'levelsComingSoon')
}

export function _closeLevelsPanel(game) {
  game.levelsPanel.style.display = 'none'
}

// Terms of Use / Privacy Policy - used to be a plain link out to
// /terms.html and /privacy.html (target="_blank"); moved in-panel
// (same static-prose pattern as Credits above) at Gaymi's request. The
// standalone terms.html/privacy.html pages themselves are left as-is
// (still real, linkable URLs - just no longer linked to from here).
// The signed-out Profile card: 'choose' (Sign Up or Login), 'signup' or
// 'login'. Fills the words every time so a language change shows.
export function _showAuthView(game, view) {
  const set = (id, key) => { const el = document.getElementById(id); if (el) el.textContent = t(key) }
  set('auth-choose-sub', 'authChooseSub')
  set('auth-choose-new', 'authChooseNew')
  set('profile-gate-register-btn', 'profileRegisterBtn')
  set('profile-gate-login-btn', 'profileLoginBtn')
  set('auth-signup-sub', 'authSignupSub')
  set('auth-signup-google-label', 'authSignupGoogle')
  set('auth-signup-note', 'authSignupNote')
  set('auth-login-sub', 'authLoginSub')
  set('auth-login-google-label', 'authContinueGoogle')
  set('auth-login-note', 'authPickup')
  set('auth-back-label', 'authBack')
  const termsHtml = _escapeHtml(t('authTerms'))
    .replace('{terms}', `<button type="button" class="auth-link open-terms-panel-link">${_escapeHtml(t('termsBtn'))}</button>`)
    .replace('{privacy}', `<button type="button" class="auth-link open-privacy-panel-link">${_escapeHtml(t('creditsPrivacyLink'))}</button>`)
  for (const id of ['auth-terms-signup', 'auth-terms-login']) {
    const el = document.getElementById(id)
    if (el) el.innerHTML = termsHtml
  }
  // The panel's own title says the welcome line while signed out; it's
  // set back to Profile when the profile itself shows.
  if (game.profilePanelTitle) game.profilePanelTitle.textContent = t(view === 'login' ? 'authWelcomeBack' : 'authWelcome')
  for (const v of ['choose', 'signup', 'login']) {
    const el = document.getElementById(`auth-view-${v}`)
    if (el) el.hidden = v !== view
  }
  const back = document.getElementById('auth-back-btn')
  if (back) back.hidden = view === 'choose'
}

// Real Minecraft skin upload (see MenuAvatar3D.js's UV-mapping support)
// - Upload Skin reads a PNG straight from the player's computer, Reset
// goes back to the default flat-color character. Both buttons live in
// the Profile panel, next to the character.
export function _bindSkinUpload(game) {
  const uploadBtn = document.getElementById('upload-skin-btn')
  const input = document.getElementById('upload-skin-input')
  const resetBtn = document.getElementById('reset-skin-btn')
  if (!uploadBtn || !input || !resetBtn) return
  if (game.settings.customSkinDataUrl) resetBtn.style.display = ''

  uploadBtn.addEventListener('click', () => input.click())

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0]
    input.value = '' // lets the same filename be re-selected later
    if (!file) return
    let skin
    try {
      skin = await loadSkinTexture(file)
    } catch {
      game._showHomepageToast(t('skinUploadFailedToast'))
      return
    }
    // Every real Minecraft skin is 64px wide, 64px (modern) or 32px
    // (legacy) tall - anything else almost certainly isn't a skin file
    // and would just paint garbage across the character's faces.
    if (skin.width !== 64 || (skin.height !== 64 && skin.height !== 32) || ![1, 2, 4, 8, 16].includes(skin.scale)) {
      game._showHomepageToast(t('skinUploadWrongSizeToast'))
      return
    }
    let dataUrl
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      dataUrl = `data:image/png;base64,${btoa(binary)}`
    } catch {
      game._showHomepageToast(t('skinUploadFailedToast'))
      return
    }
    game.settings.customSkinDataUrl = dataUrl
    saveSettings(game.settings)
    if (game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
    game._updateMenuAvatarPhoto(skin)
    resetBtn.style.display = ''
    game._showHomepageToast(t('skinUploadSuccessToast'))
  })

  resetBtn.addEventListener('click', async () => {
    game.settings.customSkinDataUrl = null
    saveSettings(game.settings)
    if (game._menuAvatar3D) game._menuAvatar3D.setSkin(null)
    resetBtn.style.display = 'none'
    game._showHomepageToast(t('skinResetToast'))
    // Corner photo badge has no flat-color fallback of its own (unlike
    // the 3D avatar) - re-derive it from the bundled default skin rather
    // than leaving the just-removed custom photo up on screen.
    await game._applyDefaultBundledSkin()
  })
}

// Crops the classic 8x8 "face" square (see MenuAvatar3D.js's
// _partFaceRects - always at pixel (8,8) in every skin regardless of
// legacy/modern format, since the overlay-compositing loop in
// loadSkinTexture() pastes onto that same base position) out of an
// already-loaded skin texture and puts it on the corner profile badge.
// texture.image is a plain 2D <canvas> (see loadSkinTexture), so this is
// a synchronous 2D crop - no extra render pass needed.
export function _updateMenuAvatarPhoto(game, skin) {
  if (!game.menuAvatarPhoto) return
  const face = document.createElement('canvas')
  face.width = 64
  face.height = 64
  const fctx = face.getContext('2d')
  fctx.imageSmoothingEnabled = false
  const k = skin.scale || 1
  fctx.drawImage(skin.texture.image, 8 * k, 8 * k, 8 * k, 8 * k, 0, 0, 64, 64)
  // Hat layer on top of the face - loadSkinTexture no longer flattens the
  // overlay onto the base, so the badge composites it itself (only when
  // the 3D character actually shows a hat, see overlayParts).
  if (skin.overlayParts && skin.overlayParts.has('head')) fctx.drawImage(skin.texture.image, 40 * k, 8 * k, 8 * k, 8 * k, 0, 0, 64, 64)
  const dataUrl = face.toDataURL('image/png')
  game.menuAvatarPhoto.src = dataUrl
  game.menuAvatarPhoto.classList.remove('loading')
  // Cached separately from settings.customSkinDataUrl (the full 64x64
  // skin file) - game is just the small pre-cropped face, read by
  // index.html's own inline anti-flash script on the very next load so
  // the corner badge never has to show the anonymous placeholder again.
  try {
    localStorage.setItem('gayz-avatar-face-cache', dataUrl)
  } catch {
    // Deliberately swallowed: game is just a nice-to-have pre-crop cache
    // (see comment above) - private browsing / storage-full / quota
    // errors here shouldn't block setting the avatar photo itself.
  }
  game.menuAvatarPhoto.style.display = ''
}

// Local Profile screen - read-only aggregation of stats already
// persisted elsewhere (careerStats/bestStats/achievements/prestige/
// nemesis), no new tracking of its own besides the Nemesis record.
export async function _openProfilePanel(game) {
  game._closeAllMenuPanels()
  game.profilePanel.style.display = 'flex'
  game.profilePanelTitle.textContent = t('profilePanelTitle')
  // Waits for the first real auth check (see _authReadyPromise's own
  // comment) before deciding signed-in vs signed-out - without game, a
  // player who opens Profile quickly after the page loads could see the
  // signed-out gate for a moment even though they're already signed in,
  // and clicking Login there would trigger a real (unnecessary) second
  // Google sign-in popup. Resolves instantly once the very first check
  // of the session has already happened, so game only ever adds a real
  // wait during that initial window.
  await game._authReadyPromise
  // Signed-out players get the Sign Up or Login card instead of the
  // profile - everything below game branch (stats, bio, highlights, the
  // 3D avatar, etc.) is real profile content that a guest doesn't see.
  if (!game._cloudUid) {
    if (game.profileContent) game.profileContent.style.display = 'none'
    if (game.profileLoginGate) game.profileLoginGate.style.display = 'flex'
    game._showAuthView('choose')
    return
  }
  if (game.profileContent) game.profileContent.style.display = ''
  if (game.profileLoginGate) game.profileLoginGate.style.display = 'none'
  game._renderPublicProfileSection()
  game._drawStatsDashboard()

  // _safeStatNumber on every plain-numeric field, _escapeHtml on the 2
  // computed-string ones (nemesis label, favorite weapon's unmatched-id
  // fallback) - every field in game grid ultimately traces back to
  // localStorage, all of which Import Save (Local Sharing batch) lets an
  // uploaded file overwrite wholesale, so none of it can be trusted to
  // already be the right type by the time it reaches game render.
  // Each row now carries a stable id (the i18n key itself, language-
  // independent) as its first element - Pin a Stat (see
  // _renderPinnedStatSelect) needs something durable to store in
  // settings.pinnedStat, and a translated label isn't stable across a
  // language switch.
  let rows = [
    ['profileTotalRuns', t('profileTotalRuns'), _safeStatNumber(game.careerStats.totalRuns)],
    ['profileTotalKills', t('profileTotalKills'), _safeStatNumber(game.careerStats.totalKills)],
    ['profileBestNight', t('profileBestNight'), _safeStatNumber(game.bestStats.bestNight)],
    ['profileBestKills', t('profileBestKills'), _safeStatNumber(game.bestStats.bestKills)],
    ['profileBestKillStreak', t('profileBestKillStreak'), _safeStatNumber(game.bestStats.bestKillStreak)],
    ['profileAchievements', t('profileAchievements'), `${game.achievements.unlocked.size}/${ACHIEVEMENTS.length}`],
    // Same tier color as the homepage's #menu-prestige-badge (see
    // _updatePrestigeBadge) - prestige only ever showed its color in that
    // one homepage spot before; game carries the same visual identity
    // into the Profile panel instead of a plain number.
    ['profilePrestige', t('profilePrestige'), game.metaProgress.prestigeLevel > 0
      ? `<span class="prestige-tier-${game.metaProgress.prestigeLevel >= 6 ? 3 : game.metaProgress.prestigeLevel >= 3 ? 2 : 1}">${_safeStatNumber(game.metaProgress.prestigeLevel)}</span>`
      : _safeStatNumber(game.metaProgress.prestigeLevel)],
    ['profileNetWorth', t('profileNetWorth'), _safeStatNumber(game.coins) + _safeStatNumber(game.metaProgress.legacyPoints)],
    ['profileTotalSpent', t('profileTotalSpent'), _safeStatNumber(game.totalSpent)],
    ['profilePlaytime', t('profilePlaytime'), `${Math.floor(_safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) / 3600)}h`],
    ['profileWinRate', t('profileWinRate'), game.runHistory.length > 0 ? `${Math.round((game.runHistory.filter((r) => r.survived).length / game.runHistory.length) * 100)}%` : '—'],
    // 100-features batch - 4 more pure-derived rows, same "zero new
    // tracking" reasoning as completionPct/Career Almanac above.
    ['profileKillsPerMin', t('profileKillsPerMin'), _safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) > 0
      ? (_safeStatNumber(game.careerStats.totalKills) / (_safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) / 60)).toFixed(1)
      : '—'],
    ['profileCoinsRatio', t('profileCoinsRatio'), `${_safeStatNumber(game.careerStats.lifetimeCoinsEarned).toLocaleString()} / ${_safeStatNumber(game.totalSpent).toLocaleString()}`],
    // More-features batch - 5 more pure-derived rows (Personal Stats),
    // same "zero new tracking beyond what _recordRunEnd/_recordNemesis
    // already aggregate" reasoning as every row above.
    ['profileLongestSession', t('profileLongestSession'), _formatDurationShort(_safeStatNumber(game.careerStats.longestSessionSeconds))],
    ['profileAvgRunLength', t('profileAvgRunLength'), _safeStatNumber(game.careerStats.totalRuns) > 0
      ? _formatDurationShort(Math.round(_safeStatNumber(game.careerStats.lifetimePlaytimeSeconds) / game.careerStats.totalRuns))
      : '—'],
    ['profileMostUsedMutator', t('profileMostUsedMutator'), _escapeHtml(game._mostUsedMutatorLabel())],
    ['profileCoinsToday', t('profileCoinsToday'), `${_safeStatNumber(game._coinsToday()).toLocaleString()} (${t('profileCoinsWeeklyAvg', { n: _safeStatNumber(game._coinsWeeklyAvg()).toLocaleString() })})`],
    // Reuses loginStreak.previousDate (see _checkLoginStreak) - the
    // calendar date of the visit before game one, not today's own date
    // (which lastDate always reflects by the time game panel can open).
    ['profileLastPlayed', t('profileLastPlayed'), game.loginStreak.previousDate || t('profileLastPlayedFirstVisit')],
    ['profileBestStreakDate', t('profileBestStreakDate'), game.bestStats.bestKillStreakDate || '—'],
    ['profileMostProfitableRun', t('profileMostProfitableRun'), _safeStatNumber(game.careerStats.mostProfitableRun).toLocaleString()],
    ['profileFavoriteDayOfWeek', t('profileFavoriteDayOfWeek'), game._favoriteDayOfWeekLabel()],
    ['profilePlayClicks', t('profilePlayClicks'), _safeStatNumber(game.careerStats.playButtonClicks).toLocaleString()],
  ]
  game._renderPinnedStatSelect(rows)
  // Pinned stat (if any) is pulled out and rendered first, same "always
  // the very first thing in the panel" position it already had before
  // grouping existed - it stays a single ungrouped row up top rather
  // than getting its own heading or appearing a second time inside its
  // normal category below.
  let pinnedRow = null
  if (game.settings.pinnedStat) {
    const pinnedIndex = rows.findIndex((r) => r[0] === game.settings.pinnedStat)
    if (pinnedIndex >= 0) {
      pinnedRow = rows[pinnedIndex]
      rows = [...rows.slice(0, pinnedIndex), ...rows.slice(pinnedIndex + 1)]
    }
  }
  const rowButton = ([, label, value]) => `
    <button class="perk-option" disabled>
      <span class="perk-name">${label}</span>
      <span class="perk-cost">${value}</span>
    </button>
  `
  const grouped = PROFILE_GROUP_ORDER.map(([groupId, labelKey]) => [
    labelKey,
    rows.filter((r) => (PROFILE_STAT_GROUPS[r[0]] || 'socialMeta') === groupId),
  ]).filter(([, groupRows]) => groupRows.length > 0)
  // Each category renders as its own card (see .profile-stat-card in
  // style.css) instead of a bare heading over a flat row list - the
  // previous version packed ~40 rows into one dense 5-column grid with
  // near-zero row spacing specifically to avoid extra scroll height, but
  // read as cramped (game panel already scrolls, so that tradeoff no
  // longer needs to be so extreme).
  game.profileOptions.innerHTML =
    (pinnedRow ? rowButton(pinnedRow) : '') +
    grouped.map(([labelKey, groupRows]) => `
      <div class="profile-stat-card">
        <h3 class="settings-section-heading">${t(labelKey)}</h3>
        ${groupRows.map(rowButton).join('')}
      </div>
    `).join('')
  game._animateStatCountUp()

  // Career Portrait - gated the same as Prestige (see _renderUpgradesOptions),
  // "beaten the game" being the bar for a capstone memento worth keeping.
  if (game.profileCareerPortraitBtn) {
    game.profileCareerPortraitBtn.style.display = game.achievements.unlocked.has(ENDGAME_ACHIEVEMENT) ? 'block' : 'none'
    game.profileCareerPortraitBtn.textContent = t('profileCareerPortraitBtn')
  }

  game._renderProfileBio()
  game._renderProfileAccountRow()
  game._updateBestStatsDisplay()
  game._renderNearlyThereNudge()
  game._renderAnniversaryLine()
  game._renderProfileCreated()
  game._renderTodayLine()
  game._renderFavoriteDifficultyLine()
  game._renderBestRunCard()
  game._renderRankRoadmap()
  game._renderGoalsPicker()
  game._renderGoalsChecklist()
  game._renderHighlightReel()
  game._renderRecentUnlocksStrip()
  game._renderPrestigeHistory()
}

// Public Profile section (see _openProfilePanel) - mirrors exactly what
// CloudSync.pushLeaderboardEntry actually writes to the public-read
// leaderboard/{uid} doc (name, bestNight, bestKills, bestKillStreak,
// achievementCount, playerId, optional region/clanId), the same fields
// _openOtherPlayerProfile shows a friend who looks this account up by
// #ID. Deliberately reads this.bestStats/this.settings directly rather
// than re-deriving anything, so it can never drift from what actually
// gets pushed - if _pushOnlineStats' own entry object ever changes,
// update this alongside it.
export function _renderPublicProfileSection(game) {
  if (!game.profilePublicNameValue) return
  const name = game.settings.anonymousLeaderboard ? t('anonymousLeaderboardName') : (game.settings.nickname || t('menuPlayerTagDefault'))
  game.profilePublicNameValue.textContent = name
  game.profilePublicIdValue.textContent = game.settings.playerId ? `#${game.settings.playerId}` : '--'
  game.profilePublicBestnightValue.textContent = _safeStatNumber(game.bestStats.bestNight)
  game.profilePublicBestkillsValue.textContent = _safeStatNumber(game.bestStats.bestKills)
  game.profilePublicBeststreakValue.textContent = _safeStatNumber(game.bestStats.bestKillStreak)
  game.profilePublicAchievementsValue.textContent = game.achievements.unlocked.size
  // Same enum keys the region <select> already uses (see its own
  // auto-mapping table entry) - no new i18n keys needed.
  const REGION_LABEL_KEYS = { na: 'optRegionNa', eu: 'optRegionEu', asia: 'optRegionAsia', sa: 'optRegionSa', oceania: 'optRegionOceania', africa: 'optRegionAfrica' }
  const regionKey = REGION_LABEL_KEYS[game.settings.region]
  if (game.profilePublicRegionRow) game.profilePublicRegionRow.style.display = regionKey ? 'flex' : 'none'
  if (regionKey && game.profilePublicRegionValue) game.profilePublicRegionValue.textContent = t(regionKey)
  if (game.profilePublicClanRow) game.profilePublicClanRow.style.display = game.settings.clanTag ? 'flex' : 'none'
  if (game.settings.clanTag && game.profilePublicClanValue) game.profilePublicClanValue.textContent = game.settings.clanTag
}

// Profile bio - free text, capped at 250 chars (enforced both by the
// textarea's own maxlength and here, since a paste can exceed maxlength).
export function _renderProfileBio(game) {
  if (!game.profileBioInput) return
  if (game.profileBioHeading) game.profileBioHeading.textContent = t('profileBioHeading')
  game.profileBioInput.placeholder = t('profileBioPlaceholder')
  game.profileBioInput.value = game.settings.bio || ''
  game._renderProfileBioCounter()
  if (game.profileNotesInput) {
    const heading = document.getElementById('profile-notes-heading')
    if (heading) heading.textContent = t('profileNotesHeading')
    game.profileNotesInput.placeholder = t('profileNotesPlaceholder')
    game.profileNotesInput.value = game.settings.privateNotes || ''
  }
}

export function _renderProfileBioCounter(game) {
  if (!game.profileBioCounter) return
  // No "/250" cap shown anymore (2026-09-23, "no limit, write as much
  // as you want") - just the running character count.
  game.profileBioCounter.textContent = `${(game.settings.bio || '').length}`
}

// Profile panel account row - Login/Register when signed out, Sign Out
// when signed in. Reuses CloudSync/_handleCloudSignIn/_handleCloudSignOut
// wholesale (see their own comments) rather than a second auth path -
// this is just a second place to trigger the exact same sign-in/out flow
// the Cloud Save panel already has, not a parallel system.
export function _renderProfileAccountRow(game) {
  const signedIn = !!game._cloudUid
  if (game.profileAccountSignedOut) game.profileAccountSignedOut.style.display = signedIn ? 'none' : 'flex'
  if (game.profileAccountSignedIn) game.profileAccountSignedIn.style.display = signedIn ? 'flex' : 'none'
  if (game.profileLoginBtn) game.profileLoginBtn.textContent = t('profileLoginBtn')
  if (game.profileRegisterBtn) game.profileRegisterBtn.textContent = t('profileRegisterBtn')
  if (game.profileSignoutBtn) game.profileSignoutBtn.textContent = t('profileSignoutBtn')
}

// "Created" - replaces the old Login Streak calendar. Ticks live every
// second while the panel is open (see _closeProfilePanel's matching
// clearInterval). While signed in, uses Google's own account-creation
// timestamp (CloudSync's accountCreatedAt on _cloudProfile) - a real
// value from Google that's the same on every device and can't drift.
// Signed out (or never signed in), falls back to
// careerStats.accountCreatedAt - a real millisecond timestamp set once,
// the very first time the game ever constructed on THIS device (see the
// constructor, right after loadCareerStats()) - not firstPlayedDate
// above, which only covers players who've finished at least one run and
// has no time-of-day precision. Using the local one while signed in
// used to be the only option, and looked like it "reset" whenever
// cloud sync round-tripped through a different device/cleared storage.
export function _renderProfileCreated(game) {
  if (!game.profileCreatedLine) return
  if (game.profileCreatedTitle) game.profileCreatedTitle.textContent = t('profileCreatedTitle')
  if (game._profileCreatedTickInterval) clearInterval(game._profileCreatedTickInterval)
  const tick = () => {
    const source = (game._cloudProfile && game._cloudProfile.accountCreatedAt) || game.careerStats.accountCreatedAt
    const elapsedMs = Math.max(0, Date.now() - _safeStatNumber(source))
    const totalSeconds = Math.floor(elapsedMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    game.profileCreatedLine.textContent = t('profileCreatedLine', { days, hours, minutes, seconds })
  }
  tick()
  game._profileCreatedTickInterval = setInterval(tick, 1000)
}

export function _closeProfilePanel(game) {
  game.profilePanel.style.display = 'none'
  if (game._profileCreatedTickInterval) {
    clearInterval(game._profileCreatedTickInterval)
    game._profileCreatedTickInterval = null
  }
  // Bio/Motto (now part of Shown to Public, see _pushOnlineStats) can be
  // edited without ever finishing a run - _pushOnlineStats otherwise only
  // fires on run-end (_recordRunEnd), which would leave a same-session
  // bio/motto edit stuck showing the old value to other players until
  // the player's next completed run. Firing it here too (closing the
  // panel is the natural "done editing" moment) covers that gap without
  // pushing on every keystroke.
  game._pushOnlineStats()
}

// Career Portrait (Long-Term Goals batch, gated behind ENDGAME_ACHIEVEMENT - see
// _openProfilePanel) - draws straight from the live WebGL canvas rather
// than routing through screenshotCropImage's async <img> load like the
// manual screenshot tool does (see _buildScreenshotCanvas's own comment):
// that intermediate exists to support crop-selection UI, which this
// capstone memento doesn't need, so skipping it keeps this synchronous
// with no onload race. Still finishes through the shared
// _finalizeScreenshotCanvas so it gets the same watermark+download step.
export function _generateCareerPortrait(game) {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height)
  bg.addColorStop(0, '#2a2418')
  bg.addColorStop(1, '#0d0b08')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const bannerH = Math.max(70, Math.round(canvas.height * 0.14))
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, 0, canvas.width, bannerH)
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const titleSize = Math.max(18, Math.round(canvas.width * 0.03))
  ctx.font = `bold ${titleSize}px sans-serif`
  ctx.fillText(t(careerRankTitleKey(game.careerStats.totalKills)), 16, 12)
  const lineSize = Math.max(12, Math.round(canvas.width * 0.016))
  ctx.font = `${lineSize}px sans-serif`
  ctx.fillText(t('careerPortraitStatsLine', { kills: game.careerStats.totalKills, prestige: game.metaProgress.prestigeLevel, runs: game.careerStats.totalRuns }), 16, titleSize + 24)

  game._finalizeScreenshotCanvas(canvas)
}

// Shared by ?importskin= above and the embedded Skin Designer's
// postMessage (see _bindSkinDesignerMessages).
export function _applyImportedSkin(game, dataUrl) {
  return loadSkinTexture(dataUrl).then((skin) => {
    // Real report, 2026-09-27: the ?importskin= string game decodes to
    // was observed CORRUPTED (right length prefix/suffix, wrong overall
    // length) roughly every other real attempt - looked exactly like a
    // race, but never pinned to one exact line despite real effort (game
    // account has Cloud Save on, and its own async settings
    // pull/merge/push around game same page-load window was the leading
    // suspect, never fully confirmed). Rather than keep chasing an
    // intermittent race with no repro I fully control, storing
    // skin.texture.image (the plain <canvas> loadSkinTexture() already
    // built from the image THAT ACTUALLY, SUCCESSFULLY DECODED) instead
    // of the original transported dataUrl sidesteps the whole class of
    // "the string got mangled somewhere in transit" bug - whatever the
    // real cause turns out to be, game can't inherit its corruption,
    // since it's derived fresh from pixels the browser already proved
    // it could read correctly.
    const cleanDataUrl = skin.texture.image.toDataURL('image/png')
    game.settings.customSkinDataUrl = cleanDataUrl
    saveSettings(game.settings)
    if (game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
    game._updateMenuAvatarPhoto(skin)
    game._showHomepageToast(t('importSkinApplied'))
  }).catch(() => {
    game._showHomepageToast(t('importSkinFailed'))
  })
}

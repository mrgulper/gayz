// The Settings panel: every tab's controls (General, Graphics, Audio, Controls,
// Accessibility...), the settings search, nav order, keybinds, save/settings
// codes and Import/Export Save.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Same convention as
// ChatUI.js/CloudSaveUI.js: plain functions taking `game`, all state on the Game
// instance; Game.js keeps a one-line stand-in for each, so callers are unchanged.
import * as CloudSaveUI from './CloudSaveUI.js'
import * as CloudSync from './CloudSync.js'
import * as GalleryUI from './GalleryUI.js'
import * as OnlineUI from './OnlineUI.js'
import { setColorblindMode } from './Accessibility.js'
import { ACHIEVEMENTS } from './Achievements.js'
import { audioEngine } from './Audio.js'
import { CHANGELOG_LAST_VIEWED_KEY, LAST_LOCAL_CHANGE_KEY, NAV_ID_RENAMES, CRATES_COMING_SOON, CRATE_TIERS, INVENTORY_SKINS, NICKNAME_FONT_STACKS, RANDOM_NICKNAME_ADJECTIVES, RANDOM_NICKNAME_NOUNS, SETTINGS_CODE_KEYS, SKIN_DESIGNER_ORIGIN, SUPPORTED_LANGUAGE_CODES, _escapeHtml, _safeStatNumber, defaultSettings, saveSettings } from './Game.js'
import { DEVICE_ONLY_KEYS } from './CloudMerge.js'
import { ACTIONS, getAllBindings, getKeyFor, keyLabel, resetBindings, setAllBindings, setBinding } from './Keybinds.js'
import { LANGUAGES, setLanguage, t } from './i18n.js'
import { bindHoverMenus } from './HoverMenus.js'
import { bindSettingsLog, logSettingChange } from './SettingsLog.js'
import { bindGameplaySettings } from './GameplaySettings.js'
import { GRAPHICS_LEVELS, LEVEL_LOOK } from './GraphicsLevels.js'
import { applyUiTheme, cleanVars, normalizeHex, rememberCleanVars, getCleanBgImage, applyCleanBgImage, cropToScreen, CLEAN_BG_IMAGE_KEY } from './CleanTheme.js'

// Swaps a slider's value label for a temporary <input type="number"> on
// click, so a precise number can be typed in instead of fighting the
// drag precision of a 0-100 (or 20-300) range - commits by re-dispatching
// the slider's own 'input' event so audio/FOV/sensitivity update through
// the exact same path a drag would use, no separate update logic to keep
// in sync.
export function _bindEditableSliderValue(_game, valueEl, sliderEl) {
  valueEl.classList.add('audio-value-editable')
  valueEl.title = 'Click to type an exact value'
  valueEl.addEventListener('click', () => {
    if (valueEl.dataset.editing) return
    valueEl.dataset.editing = '1'
    const min = Number(sliderEl.min)
    const max = Number(sliderEl.max)
    const step = Number(sliderEl.step) || 1
    const current = Number(sliderEl.value)

    // Custom up/down buttons instead of the native <input type="number">
    // spinner (removed via -webkit-appearance: none on the spin-button
    // pseudo-elements below) - that native spinner's own chrome doesn't
    // reliably respect game input's custom dark background/border
    // across browsers, but the up/down clicking itself was a real,
    // wanted feature (flagged the moment it silently disappeared with
    // the spinner during a styling pass, 2026-09-21) - rebuilt as two
    // plain buttons so both the dark theme and the clickable steppers
    // hold regardless of platform.
    const wrap = document.createElement('span')
    wrap.className = 'audio-value-input-wrap'
    const input = document.createElement('input')
    input.type = 'number'
    input.min = min
    input.max = max
    input.step = step
    input.value = current
    input.className = 'audio-value-input'
    const stepUp = document.createElement('button')
    stepUp.type = 'button'
    stepUp.className = 'audio-value-step audio-value-step-up'
    stepUp.tabIndex = -1
    stepUp.setAttribute('aria-label', 'Increase')
    const stepDown = document.createElement('button')
    stepDown.type = 'button'
    stepDown.className = 'audio-value-step audio-value-step-down'
    stepDown.tabIndex = -1
    stepDown.setAttribute('aria-label', 'Decrease')
    wrap.append(input, stepUp, stepDown)
    valueEl.replaceWith(wrap)
    input.focus()
    input.select()

    let settled = false
    const finish = (commit) => {
      if (settled) return
      settled = true
      if (commit) {
        let v = Number(input.value)
        if (Number.isNaN(v)) v = current
        v = Math.max(min, Math.min(max, Math.round(v / step) * step))
        sliderEl.value = v
        sliderEl.dispatchEvent(new Event('input'))
      }
      delete valueEl.dataset.editing
      wrap.replaceWith(valueEl)
    }
    // mousedown preventDefault keeps focus on the <input> (a plain
    // click would otherwise blur it first, firing finish(true) before
    // the step buttons' own click handler ever runs).
    const nudge = (dir) => {
      let v = Number(input.value)
      if (Number.isNaN(v)) v = current
      input.value = Math.max(min, Math.min(max, v + dir * step))
    }
    stepUp.addEventListener('mousedown', (e) => e.preventDefault())
    stepDown.addEventListener('mousedown', (e) => e.preventDefault())
    stepUp.addEventListener('click', () => nudge(1))
    stepDown.addEventListener('click', () => nudge(-1))

    input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { e.preventDefault(); finish(true) }
      else if (e.code === 'Escape') { e.preventDefault(); finish(false) }
    })
    input.addEventListener('blur', () => finish(true))
  })
}

// Master Volume - a multiplier on top of the three independent channel
// sliders (SFX/Ambient), not a third channel of its own. Keeps whatever
// balance the player already set between channels while still giving a
// single "turn everything up/down" control. Called after any of the
// three volume settings changes, rather than each slider computing its
// own effective value inline in three separate places.
export function _applyAllVolumes(game) {
  const master = game.settings.masterVolume / 100
  audioEngine.setSfxVolume(master * (game.settings.sfxVolume / 100))
  audioEngine.setAmbientVolume(master * (game.settings.ambientVolume / 100))
}

export function _bindSettings(game) {
  // Only these 4 are being called properly supported right now (product
  // call, 2026-09-11) - every language DOES have translated strings in
  // i18n.js (see that file's own standing rule - a one-time catch-up
  // already covered every key), but that hasn't been enough for a
  // "supported" bar yet, so every other language is flagged as coming
  // soon here rather than silently implying it's equally ready.
  game._renderLanguageGrid = () => {
    game.languageGrid.innerHTML = LANGUAGES.map((lang) => `
      <button class="language-btn${lang.code === game.settings.language ? ' active' : ''}" data-lang="${lang.code}">
        <span class="lang-name">${t(lang.nameKey)}</span>
        <span class="lang-native">${lang.native}</span>
        ${SUPPORTED_LANGUAGE_CODES.has(lang.code) ? '' : `<span class="lang-coming-soon">${t('languageComingSoonTag')}</span>`}
      </button>
    `).join('')
  }
  game._renderLanguageGrid()

  game.languageGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.language-btn')
    if (!btn) return
    // The button already shows its own "Coming soon" tag, but until now
    // game handler applied the switch anyway - every language DOES have
    // a real i18n block (see game function's own comment above), just
    // not synced to the 1798-key bar the 4 supported languages are held
    // to, so actually switching to one showed a jarring mix of real
    // translations and English fallback throughout the app while still
    // *looking* fully selected (active state, persisted to settings).
    // A toast instead of a Coming Soon panel - which would close the
    // whole Settings panel via _closeAllMenuPanels() - keeps the
    // language list open so the player can keep browsing it.
    if (!SUPPORTED_LANGUAGE_CODES.has(btn.dataset.lang)) {
      game._showHomepageToast(t('comingSoonBody'))
      return
    }
    const oldLang = LANGUAGES.find((l) => l.code === game.settings.language)
    game.settings.language = btn.dataset.lang
    // Remembered for #quick-language-btn's English<->alt toggle.
    if (btn.dataset.lang !== 'en') game.settings.quickLanguageAlt = btn.dataset.lang
    // setLanguage/_applyLanguage BEFORE saveSettings, not after - saveSettings
    // triggers the "Saved" pulse + a live _renderRecentlyChangedList() re-render
    // (see that function's own comment), which used to fire on the OLD
    // language (currentLang hadn't been updated yet) and never got a second
    // chance to re-render in the new one - "Changed game session: ..." stayed
    // in whatever language you switched FROM, every other language string on
    // screen already correctly in the new one.
    setLanguage(game.settings.language)
    game._applyLanguage()
    game._renderNavOrderList() // its labels are read from the nav buttons
    saveSettings(game.settings)
    if (oldLang?.code !== btn.dataset.lang) logSettingChange(t('tabLanguage'), oldLang ? t(oldLang.nameKey) : '', btn.querySelector('.lang-name')?.textContent || btn.dataset.lang)
  })
  bindSettingsLog(document.getElementById('settings-panel'))
  bindGameplaySettings(game)

  for (const tab of document.querySelectorAll('.settings-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.settings-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.settings-page')) {
        page.style.display = page.id === `settings-page-${tab.dataset.page}` ? 'block' : 'none'
      }
      // Reopen Settings to Last-Used Tab (General tab) - recorded on
      // every click regardless of whether the setting is on, so turning
      // it on later immediately has a real tab to restore rather than
      // needing one more click first.
      game.settings.lastSettingsTab = tab.dataset.page
      saveSettings(game.settings)
      if (tab.dataset.page === 'controls') game._renderNavOrderList()
    })
  }

  // Quests panel tab strip - same pattern as .settings-tab above, kept as
  // a separate class/loop so quest tabs don't get swept into the
  // settings-tab handler's global .settings-tab/.settings-page queries.
  for (const tab of document.querySelectorAll('.quest-tab[data-quest-page]')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.quest-tab[data-quest-page]')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.quest-tab-page')) {
        page.style.display = page.id === `quests-page-${tab.dataset.questPage}` ? 'flex' : 'none'
      }
    })
  }
  // Quests' game mode row (Zombie Survival/World Map, 2026-10-24): World
  // Map has no quests yet, so its tab hides Zombie Survival's quest tabs.
  for (const tab of document.querySelectorAll('.quest-tab[data-quest-mode]')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.quest-tab[data-quest-mode]')) tabEl.classList.toggle('active', tabEl === tab)
      const survival = tab.dataset.questMode === 'survival'
      const pageTabs = document.getElementById('quest-page-tabs')
      if (pageTabs) pageTabs.style.display = survival ? '' : 'none'
      if (survival) document.querySelector('.quest-tab[data-quest-page].active')?.click()
      else for (const page of document.querySelectorAll('.quest-tab-page')) page.style.display = page.id === 'quests-page-worldmap' ? 'flex' : 'none'
    })
  }

  // Upgrades panel tab strip (Upgrades/Special Ammo Guide) - same isolated
  // class/loop pattern as the quest tabs above.
  for (const tab of document.querySelectorAll('.upgrades-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.upgrades-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.upgrades-tab-page')) {
        page.style.display = page.id === `upgrades-page-${tab.dataset.upgradesPage}` ? 'flex' : 'none'
      }
    })
  }

  // Profile panel tab strip (Shown to Public/Hidden) - same isolated
  // class/loop pattern as the Upgrades tabs above.
  for (const tab of document.querySelectorAll('.profile-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.profile-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.profile-tab-page')) {
        page.style.display = page.id === `profile-page-${tab.dataset.profilePage}` ? 'flex' : 'none'
      }
    })
  }

  // Hub panel tab strip (Zombie Survival/Deathmatch) - same isolated
  // class/loop pattern as the quest tabs above.
  for (const tab of document.querySelectorAll('#hub-panel .hub-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('#hub-panel .hub-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.hub-tab-page')) {
        page.style.display = page.id === `hub-page-${tab.dataset.hubPage}` ? 'flex' : 'none'
      }
    })
  }

  // Inventory panel tab strip (Character/Crates/Weapons/Theme) - same
  // isolated class/loop pattern as the quest/hub tabs above.
  for (const tab of document.querySelectorAll('.inventory-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.inventory-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.inventory-tab-page')) {
        page.style.display = page.id === `inventory-page-${tab.dataset.inventoryPage}` ? 'block' : 'none'
      }
      // The weapon pictures are only drawn once the Weapons tab is
      // actually looked at - never in the click that opens Inventory.
      if (tab.dataset.inventoryPage === 'weapons') game._renderInventoryWeapons({ draw: true })
    })
  }

  // Shop crate cards - ONE listener per card (not a separate button-level
  // listener plus a card-level one) and explicitly scoped to
  // #shop-crate-tier-grid, not `.crate-card`/`.crate-open-btn` globally.
  // Inventory > Crates reuses those exact same class names purely for
  // matching visual styling (see _renderInventorySkins/that tab's own
  // markup) - its crates are deliberately free/cost-nothing (explicit
  // request), but the OLD unscoped `document.querySelectorAll('.crate-
  // open-btn')` matched Inventory's copies too, silently charging real
  // coins to open them (real regression, caught 2026-09-21). The old
  // split into two separate global listeners (one per button, one per
  // card, relying on event-bubbling + e.target.closest() to route
  // between them) also intermittently failed to fire the button's own
  // handler on a fresh page load for reasons never fully root-caused
  // despite extensive live testing - consolidating into one listener
  // per card removes that whole class of failure, since there's only
  // ever one handler deciding what a click meant, not two racing/
  // depending on each other.
  for (const card of document.querySelectorAll('#shop-crate-tier-grid .crate-card')) {
    card.addEventListener('click', (e) => {
      if (CRATES_COMING_SOON) return
      const tierClass = [...card.classList].find((c) => c.startsWith('crate-tier-'))
      if (!tierClass) return
      const tier = tierClass.slice('crate-tier-'.length)
      const btn = e.target.closest('.crate-open-btn')
      if (btn) {
        if (!btn.disabled) game._openCrate(tier)
      } else {
        game._openCratePurchaseModal(tier)
      }
    })
  }


  if (game.cratePurchaseQtyMinus) {
    game.cratePurchaseQtyMinus.addEventListener('click', () => {
      game._cratePurchaseQty = Math.max(1, game._cratePurchaseQty - 1)
      game._updateCratePurchaseModal()
    })
  }
  if (game.cratePurchaseQtyPlus) {
    game.cratePurchaseQtyPlus.addEventListener('click', () => {
      game._cratePurchaseQty += 1
      game._updateCratePurchaseModal()
    })
  }
  if (game.cratePurchaseQtyValue) {
    // Live total-price feedback while typing, without re-clamping or
    // overwriting the input's own value mid-keystroke (that would
    // fight the user's typing - e.g. snapping "1" back while they're
    // still in the middle of typing "10").
    game.cratePurchaseQtyValue.addEventListener('input', () => {
      const raw = parseInt(game.cratePurchaseQtyValue.value, 10)
      if (!Number.isFinite(raw) || raw < 1) return
      game._cratePurchaseQty = raw
      const tierConfig = CRATE_TIERS[game._cratePurchaseTier]
      if (tierConfig) game.cratePurchaseTotalAmount.textContent = tierConfig.cost * raw
    })
    // Final clamp once they're actually done (blur/Enter/spinner) -
    // game is where an out-of-range typed value gets corrected back.
    game.cratePurchaseQtyValue.addEventListener('change', () => game._updateCratePurchaseModal())
  }
  if (game.cratePurchaseConfirmBtn) {
    game.cratePurchaseConfirmBtn.addEventListener('click', () => game._confirmCratePurchase())
  }
  if (game.cratePurchaseCloseBtn) {
    game.cratePurchaseCloseBtn.addEventListener('click', () => game._closeCratePurchaseModal())
  }
  if (game.cratePurchaseModal) {
    game.cratePurchaseModal.addEventListener('click', (e) => {
      if (e.target === game.cratePurchaseModal) game._closeCratePurchaseModal()
    })
  }

  // Shared red-X close button on every .panel-box panel (Settings, Shop,
  // What's New, How to Play, etc). #crate-purchase-close-btn shares game
  // class for the look but keeps its own handler above, so skip it here.
  for (const btn of document.querySelectorAll('.panel-close-btn')) {
    if (btn.id === 'crate-purchase-close-btn' || btn.id === 'update-available-later-btn') continue
    btn.addEventListener('click', () => {
      if (btn.closest('#other-profile-panel')) game._closeOtherPlayerProfile()
      else game._closeAllMenuPanels()
    })
  }

  // Character tab's skin list (see _renderInventorySkins) - one
  // delegated listener since the rows get fully replaced on every
  // render, same reasoning as chat's own click-to-mute delegation.
  // Clicking a card opens its Equip/Inspect menu next to it (Kirka's
  // inventory does the same); clicking anywhere else closes it.
  if (game.inventorySkinsList) {
    game.inventorySkinsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-inventory-skin]')
      if (!card) return
      e.stopPropagation()
      game._openInventorySkinMenu(card)
    })
  }
  if (game.inventoryWeaponsList) {
    game.inventoryWeaponsList.addEventListener('click', (e) => {
      const card = e.target.closest('[data-weapon-card]')
      if (!card) return
      e.stopPropagation()
      game._openInventorySkinMenu(card)
    })
  }
  document.getElementById('inspect-close')?.addEventListener('click', () => game._closeInspectDialog())
  document.getElementById('inspect-dialog')?.addEventListener('click', (e) => {
    if (e.target.id === 'inspect-dialog') game._closeInspectDialog()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && game._inspectViewer) game._closeInspectDialog()
  })
  if (game.invSkinMenu) {
    game.invSkinMenu.addEventListener('click', (e) => e.stopPropagation())
    game.invSkinMenuEquip.addEventListener('click', () => {
      const id = game._invSkinMenuFor
      const kind = game._invSkinMenuKind
      game._closeInventorySkinMenu()
      if (id && kind === 'character') game._equipInventorySkin(id)
    })
    game.invSkinMenuInspect.addEventListener('click', () => {
      const id = game._invSkinMenuFor
      const kind = game._invSkinMenuKind
      game._closeInventorySkinMenu()
      if (id) game._openInspectDialog(kind, id)
    })
    const tradeClick = (btn, open) => btn?.addEventListener('click', () => {
      const id = game._invSkinMenuFor
      game._closeInventorySkinMenu()
      if (!id) return
      if (btn.classList.contains('locked')) {
        game._showHomepageToast(t(btn.dataset.why || 'marketCantTrade'))
        return
      }
      open(id)
    })
    game.invSkinMenuLock?.addEventListener('click', () => {
      const id = game._invSkinMenuFor
      const kind = game._invSkinMenuKind
      game._closeInventorySkinMenu()
      if (id) game._toggleSkinLock(kind, id)
    })
    tradeClick(game.invSkinMenuSell, (id) => game._openSellDialog(id))
    tradeClick(game.invSkinMenuMarket, (id) => game._openListDialog(id))
    document.addEventListener('click', () => game._closeInventorySkinMenu())
  }
  if (game.invSkinSearch) game.invSkinSearch.addEventListener('input', () => game._renderInventorySkins())
  if (game.invRarityFilterBtn && game.invRarityFilterMenu) {
    game.invRarityFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      game._toggleMarketFilterMenu(game.invRarityFilterBtn, game.invRarityFilterMenu)
    })
    game.invRarityFilterMenu.addEventListener('click', (e) => {
      e.stopPropagation()
      const opt = e.target.closest('[data-market-rarity]')
      if (!opt) return
      game._invRarity = opt.dataset.marketRarity
      game._closeMarketFilterMenus()
      game._renderInventorySkins()
    })
  }
  game.shopMarketGrid?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-market-listing]')
    if (!card || !Array.isArray(game._marketListings)) return
    const listing = game._marketListings.find((l) => l.id === card.dataset.marketListing)
    const entry = listing && INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
    if (!entry) return
    const name = entry.nameKey ? t(entry.nameKey) : entry.name
    if (game._cloudUid && listing.sellerUid === game._cloudUid) {
      game._openTradeDialog('cancel', { listing, name })
      return
    }
    const price = _safeStatNumber(listing.price)
    if (game.coins < price) {
      game._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - game.coins).toLocaleString() }))
      return
    }
    game._openTradeDialog('buy', { listing, name, seller: String(listing.sellerName || '').slice(0, 24), priceLabel: game._formatSkinPrice('coins', price) })
  })
  if (game.tradeDialog) {
    document.getElementById('trade-dialog-close').addEventListener('click', () => game._closeTradeDialog())
    game.tradeDialog.addEventListener('click', (e) => { if (e.target === game.tradeDialog) game._closeTradeDialog() })
    document.getElementById('trade-dialog-minus').addEventListener('click', () => game._stepTradeDialogPrice(-1))
    document.getElementById('trade-dialog-plus').addEventListener('click', () => game._stepTradeDialogPrice(1))
    game.tradeDialogPrice.addEventListener('input', () => game._updateTradeDialogFee())
    game.tradeDialogAction.addEventListener('click', () => game._confirmTradeDialog())
  }
  game.marketSearch?.addEventListener('input', () => {
    game._marketQuery = game.marketSearch.value
    game._renderShopMarket()
  })
  if (game.marketItemFilterBtn && game.marketItemFilterMenu) {
    game.marketItemFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      game._toggleMarketFilterMenu(game.marketItemFilterBtn, game.marketItemFilterMenu)
    })
    // Ticking stays open so several items can be changed in one go.
    game.marketItemFilterMenu.addEventListener('click', (e) => {
      e.stopPropagation()
      const opt = e.target.closest('[data-market-item]')
      if (!opt) return
      const all = game._marketItemOptions().map((i) => i.id)
      const ticked = game._marketItems || new Set(all)
      const id = opt.dataset.marketItem
      if (ticked.has(id)) ticked.delete(id)
      else ticked.add(id)
      game._marketItems = ticked.size === all.length ? null : ticked
      game._renderMarketFilters()
      game._renderShopMarket()
    })
  }
  if (game.marketRarityFilterBtn && game.marketRarityFilterMenu) {
    game.marketRarityFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      game._toggleMarketFilterMenu(game.marketRarityFilterBtn, game.marketRarityFilterMenu)
    })
    game.marketRarityFilterMenu.addEventListener('click', (e) => {
      e.stopPropagation()
      const opt = e.target.closest('[data-market-rarity]')
      if (!opt) return
      game._marketRarity = opt.dataset.marketRarity
      game._closeMarketFilterMenus()
      game._renderMarketFilters()
      game._renderShopMarket()
    })
  }
  document.addEventListener('click', () => game._closeMarketFilterMenus())

  // Friendship's tab strip (Friend List/Clan; it was General's General/
  // Clan tabs until 2026-10-24) and General's (Leaderboard/Theme) - same
  // isolated class/loop pattern as the other tab strips above, each strip
  // only switching the pages in its own panel.
  for (const tab of document.querySelectorAll('.general-tab')) {
    tab.addEventListener('click', () => {
      const box = tab.closest('.panel-box')
      for (const tabEl of box.querySelectorAll('.general-tab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of box.querySelectorAll('.general-tab-page')) {
        page.style.display = page.id === `general-page-${tab.dataset.generalPage}` ? 'block' : 'none'
      }
      if (tab.dataset.generalPage === 'clan') {
        game._refreshClanUi()
        // The Clan tab always opens on Clans, not My Clan (2026-10-09).
        document.getElementById('clan-subtab-ranking')?.click()
      }
    })
  }

  // Clan tab's own sub-tabs (Clans/My Clan) - fixes a real gap where the
  // "All Clans" list used to live only inside the not-in-a-clan browse
  // state, so once you'd joined a clan there was no way to see any other
  // clan at all, ranking included. The ranking is fetched when General
  // opens and kept for CLAN_RANKING_CACHE_MS (see _fetchClanRanking), so
  // clicking Clan shows it right away.
  for (const tab of document.querySelectorAll('.clan-subtab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.clan-subtab')) tabEl.classList.toggle('active', tabEl === tab)
      for (const page of document.querySelectorAll('.clan-subtab-page')) {
        page.style.display = page.id === `clan-subpage-${tab.dataset.clanSubpage}` ? 'block' : 'none'
      }
      if (tab.dataset.clanSubpage === 'ranking') game._renderClanRanking()
      // My Clan reloads every time, so it's never left blank or out of date.
      else game._refreshClanUi()
    })
  }

  // Achievements panel mode tabs (Zombie Survival/Deathmatch) - no
  // achievement is tagged to a mode (Deathmatch itself is still locked/
  // "Coming Soon" everywhere else in the game, see the Hub's own
  // deathmatch tab), so Zombie Survival just shows the existing full
  // list and Deathmatch shows a plain placeholder in its place.
  for (const tab of document.querySelectorAll('.achievements-mode-tab')) {
    tab.addEventListener('click', () => {
      for (const tabEl of document.querySelectorAll('.achievements-mode-tab')) tabEl.classList.toggle('active', tabEl === tab)
      game._achievementsMode = tab.dataset.achievementsMode
      game._renderAchievementsPanel()
    })
  }

  game.masterVolumeSlider.value = game.settings.masterVolume
  game.masterVolumeValue.textContent = `${game.settings.masterVolume}%`
  game.sfxVolumeSlider.value = game.settings.sfxVolume
  game.sfxVolumeValue.textContent = `${game.settings.sfxVolume}%`
  game.ambientVolumeSlider.value = game.settings.ambientVolume
  game.ambientVolumeValue.textContent = `${game.settings.ambientVolume}%`
  game._applyAllVolumes()

  game.masterVolumeSlider.addEventListener('input', () => {
    const value = Number(game.masterVolumeSlider.value)
    game.masterVolumeValue.textContent = `${value}%`
    game.settings.masterVolume = value
    game._applyAllVolumes()
    saveSettings(game.settings)
  })

  game.sfxVolumeSlider.addEventListener('input', () => {
    const value = Number(game.sfxVolumeSlider.value)
    game.sfxVolumeValue.textContent = `${value}%`
    game.settings.sfxVolume = value
    game._applyAllVolumes()
    saveSettings(game.settings)
  })

  game.ambientVolumeSlider.addEventListener('input', () => {
    const value = Number(game.ambientVolumeSlider.value)
    game.ambientVolumeValue.textContent = `${value}%`
    game.settings.ambientVolume = value
    game._applyAllVolumes()
    saveSettings(game.settings)
  })

  game.muteOnBlurToggle.checked = game.settings.muteOnTabBlur
  game.muteOnBlurToggle.addEventListener('change', () => {
    game.settings.muteOnTabBlur = game.muteOnBlurToggle.checked
    saveSettings(game.settings)
  })
  // Belongs here rather than a per-tab bind since it needs to keep
  // working regardless of which settings tab (or panel) is open when
  // the player alt-tabs away - checked live off game.settings each
  // time, not captured once at bind time.
  document.addEventListener('visibilitychange', () => {
    if (!game.settings.muteOnTabBlur) return
    if (document.hidden) audioEngine.pause()
    else audioEngine.resume()
  })

  game.positionalAudioToggle.checked = game.settings.positionalAudio
  audioEngine.setPositionalAudio(game.settings.positionalAudio)
  game.positionalAudioToggle.addEventListener('change', () => {
    game.settings.positionalAudio = game.positionalAudioToggle.checked
    audioEngine.setPositionalAudio(game.settings.positionalAudio)
    saveSettings(game.settings)
  })

  game.sensitivitySlider.value = game.settings.sensitivity
  game.sensitivityValue.textContent = `${game.settings.sensitivity}%`
  game.invertYToggle.checked = game.settings.invertY

  game.fovSlider.value = game.settings.fov
  game.fovValue.textContent = `${game.settings.fov}`

  game.sensitivitySlider.addEventListener('input', () => {
    const value = Number(game.sensitivitySlider.value)
    game.sensitivityValue.textContent = `${value}%`
    game.settings.sensitivity = value
    saveSettings(game.settings)
  })

  game.invertYToggle.addEventListener('change', () => {
    game.settings.invertY = game.invertYToggle.checked
    saveSettings(game.settings)
  })

  game.fovSlider.addEventListener('input', () => {
    const value = Number(game.fovSlider.value)
    game.fovValue.textContent = `${value}`
    game.settings.fov = value
    saveSettings(game.settings)
  })


  game.invertScrollToggle.checked = game.settings.invertScrollWeaponSwitch
  game.invertScrollToggle.addEventListener('change', () => {
    game.settings.invertScrollWeaponSwitch = game.invertScrollToggle.checked
    saveSettings(game.settings)
  })


  // On-Screen Text Duration (accessibility) - a CSS custom property the
  // toast/lore-toast animations read their duration from (see style.css),
  // set here like the crosshair's.
  game.toastDurationSlider.value = game.settings.toastDuration
  game.toastDurationValue.textContent = `${game.settings.toastDuration}%`
  document.documentElement.style.setProperty('--toast-duration-mult', game.settings.toastDuration / 100)
  game.toastDurationSlider.addEventListener('input', () => {
    const value = Number(game.toastDurationSlider.value)
    game.toastDurationValue.textContent = `${value}%`
    game.settings.toastDuration = value
    document.documentElement.style.setProperty('--toast-duration-mult', value / 100)
    saveSettings(game.settings)
  })

  // Customizable Crosshair (accessibility) - --crosshair-color/size are
  // read by #crosshair's own CSS (see style.css).
  game.crosshairColorPicker.value = game.settings.crosshairColor
  document.documentElement.style.setProperty('--crosshair-color', game.settings.crosshairColor)
  game.crosshairColorPicker.addEventListener('input', () => {
    game.settings.crosshairColor = game.crosshairColorPicker.value
    document.documentElement.style.setProperty('--crosshair-color', game.settings.crosshairColor)
    saveSettings(game.settings)
  })

  // Nickname color - a plain CSS custom property, same technique as
  // crosshair color above, read by the .nickname-tag class wrapped around
  // every nickname display site (Hardcore Memorial, Kill Feed).
  game.nicknameColorPicker.value = game.settings.nicknameColor
  // The default white lets each theme colour the nameplate its own way.
  const applyNicknameColor = () => {
    document.documentElement.style.setProperty('--nickname-color', game.settings.nicknameColor)
    document.documentElement.classList.toggle('custom-name-color', String(game.settings.nicknameColor).toLowerCase() !== '#ffffff')
  }
  applyNicknameColor()
  game.nicknameColorPicker.addEventListener('input', () => {
    game.settings.nicknameColor = game.nicknameColorPicker.value
    applyNicknameColor()
    saveSettings(game.settings)
  })

  // Homepage Accent Color - overrides --menu-gold on #menu itself
  // (inline style beats the stylesheet's own #menu rule), recoloring
  // every gold highlight/border/active-state across the homepage at
  // once. Reset restores the original gold by clearing the override.
  if (game.accentColorPicker) {
    const defaultAccent = '#d9bc4a'
    game.accentColorPicker.value = game.settings.accentColor || defaultAccent
    if (game.settings.accentColor && game.menu) game.menu.style.setProperty('--menu-gold', game.settings.accentColor)
    game.accentColorPicker.addEventListener('input', () => {
      game.settings.accentColor = game.accentColorPicker.value
      if (game.menu) game.menu.style.setProperty('--menu-gold', game.settings.accentColor)
      saveSettings(game.settings)
    })
    if (game.accentColorResetBtn) {
      game.accentColorResetBtn.addEventListener('click', () => {
        game.settings.accentColor = null
        game.accentColorPicker.value = defaultAccent
        if (game.menu) game.menu.style.removeProperty('--menu-gold')
        saveSettings(game.settings)
      })
    }
  }

  // Play Button Color - a dedicated CSS var (--play-btn-color) the
  // #play-btn gradient reads, independent of the accent color above so
  // the two can be set separately.
  if (game.playBtnColorPicker) {
    const defaultPlayColor = '#d9bc4a'
    game.playBtnColorPicker.value = game.settings.playBtnColor || defaultPlayColor
    if (game.settings.playBtnColor) document.documentElement.style.setProperty('--play-btn-color', game.settings.playBtnColor)
    game.playBtnColorPicker.addEventListener('input', () => {
      game.settings.playBtnColor = game.playBtnColorPicker.value
      document.documentElement.style.setProperty('--play-btn-color', game.settings.playBtnColor)
      saveSettings(game.settings)
    })
    if (game.playBtnColorResetBtn) {
      game.playBtnColorResetBtn.addEventListener('click', () => {
        game.settings.playBtnColor = null
        game.playBtnColorPicker.value = defaultPlayColor
        document.documentElement.style.removeProperty('--play-btn-color')
        saveSettings(game.settings)
      })
    }
  }

  if (game.nicknameFontSelect) {
    game.nicknameFontSelect.value = game.settings.nicknameFont
    // Default lets each theme pick the nameplate's font (.nameplate-name).
    const applyNicknameFont = () => {
      document.documentElement.style.setProperty('--nickname-font', NICKNAME_FONT_STACKS[game.settings.nicknameFont] || NICKNAME_FONT_STACKS.default)
      document.documentElement.classList.toggle('custom-name-font', !!NICKNAME_FONT_STACKS[game.settings.nicknameFont] && game.settings.nicknameFont !== 'default')
    }
    applyNicknameFont()
    game.nicknameFontSelect.addEventListener('change', () => {
      game.settings.nicknameFont = game.nicknameFontSelect.value
      applyNicknameFont()
      saveSettings(game.settings)
    })
  }

  if (game.layoutDensitySelect) {
    game.layoutDensitySelect.value = game.settings.layoutDensity
    document.documentElement.classList.toggle('layout-compact', game.settings.layoutDensity === 'compact')
    game.layoutDensitySelect.addEventListener('change', () => {
      game.settings.layoutDensity = game.layoutDensitySelect.value
      document.documentElement.classList.toggle('layout-compact', game.settings.layoutDensity === 'compact')
      saveSettings(game.settings)
    })
  }

  if (game.randomNicknameBtn) {
    game.randomNicknameBtn.addEventListener('click', () => {
      // Only previews a candidate name in the box - doesn't save/apply it.
      // Player can click Random again to reroll, then confirm via the
      // pencil icon (see _confirmNicknameEdit) once they like one.
      const adj = RANDOM_NICKNAME_ADJECTIVES[Math.floor(Math.random() * RANDOM_NICKNAME_ADJECTIVES.length)]
      const noun = RANDOM_NICKNAME_NOUNS[Math.floor(Math.random() * RANDOM_NICKNAME_NOUNS.length)]
      const suffix = Math.floor(Math.random() * 90) + 10
      game.nicknameInput.value = `${adj}${noun}${suffix}`.slice(0, 16)
      game.nicknameInput.focus()
    })
  }
  game.crosshairSizeSlider.value = game.settings.crosshairSize
  game.crosshairSizeValue.textContent = `${game.settings.crosshairSize}%`
  document.documentElement.style.setProperty('--crosshair-size', game.settings.crosshairSize / 100)
  game.crosshairSizeSlider.addEventListener('input', () => {
    const value = Number(game.crosshairSizeSlider.value)
    game.crosshairSizeValue.textContent = `${value}%`
    game.settings.crosshairSize = value
    document.documentElement.style.setProperty('--crosshair-size', value / 100)
    saveSettings(game.settings)
  })

  // Reduce Flashing Effects (accessibility) - a body-level class every
  // flash/throb keyframe (critical-blood-overlay, damage-flash, etc.)
  // reads via CSS to swap to a slower/static variant, see style.css.
  game.reduceFlashingToggle.checked = game.settings.reduceFlashing
  document.body.classList.toggle('reduce-flashing', game.settings.reduceFlashing)
  game.reduceFlashingToggle.addEventListener('change', () => {
    game.settings.reduceFlashing = game.reduceFlashingToggle.checked
    document.body.classList.toggle('reduce-flashing', game.settings.reduceFlashing)
    saveSettings(game.settings)
  })

  // Streaming-safe mode (see _updateStreamSafeVisibility).
  game.streamSafeModeToggle.checked = game.settings.streamSafeMode
  game._updateStreamSafeVisibility()
  game.streamSafeModeToggle.addEventListener('change', () => {
    game.settings.streamSafeMode = game.streamSafeModeToggle.checked
    game._updateStreamSafeVisibility()
    saveSettings(game.settings)
  })


  // Click any of the four value labels above to type an exact number
  // instead of dragging the slider - the slider itself stays as the
  // primary control, game just re-dispatches its own 'input' event so
  // every existing listener (audio engine, saveSettings, HUD text) fires
  // exactly the same way it would from a drag.
  game._bindEditableSliderValue(game.masterVolumeValue, game.masterVolumeSlider)
  game._bindEditableSliderValue(game.sfxVolumeValue, game.sfxVolumeSlider)
  game._bindEditableSliderValue(game.sensitivityValue, game.sensitivitySlider)
  game._bindEditableSliderValue(game.fovValue, game.fovSlider)
  game._bindEditableSliderValue(game.toastDurationValue, game.toastDurationSlider)
  game._bindEditableSliderValue(game.crosshairSizeValue, game.crosshairSizeSlider)

  game.colorblindModeSelect.value = game.settings.colorblindMode
  setColorblindMode(game.settings.colorblindMode)

  game.colorblindModeSelect.addEventListener('change', () => {
    game.settings.colorblindMode = game.colorblindModeSelect.value
    setColorblindMode(game.settings.colorblindMode)
    if (game.quickColorblindBtn) game.quickColorblindBtn.classList.toggle('active', game.settings.colorblindMode !== 'off')
    saveSettings(game.settings)
  })

  // Large Text / High Contrast modes - two more accessibility toggles
  // alongside colorblind, applied as classes on <html> (document.
  // documentElement) so the CSS can be a couple of scoped rules rather
  // than per-element style overrides.
  if (game.largeTextToggle) {
    game.largeTextToggle.checked = game.settings.largeTextMode
    document.documentElement.classList.toggle('large-text-mode', game.settings.largeTextMode)
    game.largeTextToggle.addEventListener('change', () => {
      game.settings.largeTextMode = game.largeTextToggle.checked
      document.documentElement.classList.toggle('large-text-mode', game.settings.largeTextMode)
      saveSettings(game.settings)
    })
  }
  if (game.highContrastToggle) {
    game.highContrastToggle.checked = game.settings.highContrastMode
    document.documentElement.classList.toggle('high-contrast-mode', game.settings.highContrastMode)
    game.highContrastToggle.addEventListener('change', () => {
      game.settings.highContrastMode = game.highContrastToggle.checked
      document.documentElement.classList.toggle('high-contrast-mode', game.settings.highContrastMode)
      saveSettings(game.settings)
    })
  }
  if (game.focusRingToggle) {
    game.focusRingToggle.checked = game.settings.focusRingMode
    document.documentElement.classList.toggle('focus-ring-mode', game.settings.focusRingMode)
    game.focusRingToggle.addEventListener('change', () => {
      game.settings.focusRingMode = game.focusRingToggle.checked
      document.documentElement.classList.toggle('focus-ring-mode', game.settings.focusRingMode)
      saveSettings(game.settings)
    })
  }
  if (game.homepageFpsToggle) {
    game.homepageFpsToggle.checked = game.settings.homepageFpsCounter
    if (game.settings.homepageFpsCounter) game.fpsEl.style.opacity = '1'
    game.homepageFpsToggle.addEventListener('change', () => {
      game.settings.homepageFpsCounter = game.homepageFpsToggle.checked
      game.fpsEl.style.opacity = (game.settings.homepageFpsCounter || game.gameStarted) ? '1' : '0'
      saveSettings(game.settings)
    })
  }
  if (game.underlineLinksToggle) {
    game.underlineLinksToggle.checked = game.settings.underlineLinks
    document.documentElement.classList.toggle('underline-links', game.settings.underlineLinks)
    game.underlineLinksToggle.addEventListener('change', () => {
      game.settings.underlineLinks = game.underlineLinksToggle.checked
      document.documentElement.classList.toggle('underline-links', game.settings.underlineLinks)
      saveSettings(game.settings)
    })
  }
  if (game.uiFontSelect) {
    game.uiFontSelect.value = game.settings.uiFont
    document.documentElement.style.setProperty('--ui-font', NICKNAME_FONT_STACKS[game.settings.uiFont] || NICKNAME_FONT_STACKS.default)
    game.uiFontSelect.addEventListener('change', () => {
      game.settings.uiFont = game.uiFontSelect.value
      document.documentElement.style.setProperty('--ui-font', NICKNAME_FONT_STACKS[game.settings.uiFont] || NICKNAME_FONT_STACKS.default)
      saveSettings(game.settings)
    })
  }
  if (game.textSpacingSlider) {
    game.textSpacingSlider.value = game.settings.textSpacing
    game.textSpacingValue.textContent = `${game.settings.textSpacing}%`
    document.documentElement.style.setProperty('--text-spacing', game.settings.textSpacing)
    document.documentElement.classList.toggle('text-spacing-active', game.settings.textSpacing !== 100)
    game.textSpacingSlider.addEventListener('input', () => {
      const value = Number(game.textSpacingSlider.value)
      game.textSpacingValue.textContent = `${value}%`
      game.settings.textSpacing = value
      document.documentElement.style.setProperty('--text-spacing', value)
      document.documentElement.classList.toggle('text-spacing-active', value !== 100)
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.textSpacingValue, game.textSpacingSlider)
  }
  if (game.buttonSizeSlider) {
    const applyButtonSize = (value) => {
      document.documentElement.classList.toggle('button-size-scaled', value !== 100)
      document.documentElement.style.setProperty('--button-size-scale', value / 100)
    }
    game.buttonSizeSlider.value = game.settings.buttonSize
    game.buttonSizeValue.textContent = `${game.settings.buttonSize}%`
    applyButtonSize(game.settings.buttonSize)
    game.buttonSizeSlider.addEventListener('input', () => {
      const value = Number(game.buttonSizeSlider.value)
      game.buttonSizeValue.textContent = `${value}%`
      game.settings.buttonSize = value
      applyButtonSize(value)
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.buttonSizeValue, game.buttonSizeSlider)
  }
  if (game.reduceTransparencyToggle) {
    game.reduceTransparencyToggle.checked = game.settings.reduceTransparency
    document.documentElement.classList.toggle('reduce-transparency', game.settings.reduceTransparency)
    game.reduceTransparencyToggle.addEventListener('change', () => {
      game.settings.reduceTransparency = game.reduceTransparencyToggle.checked
      document.documentElement.classList.toggle('reduce-transparency', game.settings.reduceTransparency)
      saveSettings(game.settings)
    })
  }
  if (game.hoverAudioCueToggle) {
    game.hoverAudioCueToggle.checked = game.settings.hoverAudioCue
    game.hoverAudioCueToggle.addEventListener('change', () => {
      game.settings.hoverAudioCue = game.hoverAudioCueToggle.checked
      saveSettings(game.settings)
    })
  }
  if (game.highVisCursorToggle) {
    game.highVisCursorToggle.checked = game.settings.highVisCursor
    document.documentElement.classList.toggle('high-vis-cursor', game.settings.highVisCursor)
    game.highVisCursorToggle.addEventListener('change', () => {
      game.settings.highVisCursor = game.highVisCursorToggle.checked
      document.documentElement.classList.toggle('high-vis-cursor', game.settings.highVisCursor)
      saveSettings(game.settings)
    })
  }
  if (game.captionBackgroundToggle) {
    game.captionBackgroundToggle.checked = game.settings.captionBackground
    document.documentElement.classList.toggle('caption-background', game.settings.captionBackground)
    game.captionBackgroundToggle.addEventListener('change', () => {
      game.settings.captionBackground = game.captionBackgroundToggle.checked
      document.documentElement.classList.toggle('caption-background', game.settings.captionBackground)
      saveSettings(game.settings)
    })
  }
  if (game.themePresetSelect) {
    const applyTheme = (preset) => {
      for (const cls of ['theme-sepia', 'theme-darker', 'theme-lighter']) document.documentElement.classList.remove(cls)
      if (preset !== 'none') document.documentElement.classList.add(`theme-${preset}`)
    }
    game.themePresetSelect.value = game.settings.themePreset
    applyTheme(game.settings.themePreset)
    game.themePresetSelect.addEventListener('change', () => {
      game.settings.themePreset = game.themePresetSelect.value
      applyTheme(game.settings.themePreset)
      saveSettings(game.settings)
    })
  }
  // Theme (General > Theme, Inventory > Theme until 2026-10-24): Old or Clean, as two clickable cards.
  // Old's look is html.ui-theme-old, Clean's html.ui-theme-clean plus the
  // colour variables CleanTheme.js puts on <html>. Clean's colour is
  // picked with the round swatch, applied live (the hex text box was
  // removed 2026-10-23). Clean can also have a homepage picture from the
  // player's computer (Upload picture), kept on this device only.
  if (game.themePickerClean && game.themePickerOld) {
    const syncUiTheme = () => {
      applyUiTheme(game.settings)
      const clean = game.settings.uiTheme === 'clean'
      game.themePickerClean.classList.toggle('active', clean)
      game.themePickerOld.classList.toggle('active', !clean)
      game.themePickerClean.style.setProperty('--clean-preview', game.settings.cleanColor)
      game.themePickerClean.style.setProperty('--clean-preview-fg', cleanVars(game.settings.cleanColor)['--clean-fg'])
      if (game.themeCleanColorInput) game.themeCleanColorInput.value = game.settings.cleanColor
      if (game.themeCleanBgClear) game.themeCleanBgClear.style.display = getCleanBgImage() ? '' : 'none'
      // The picture icons' names (they have no words of their own).
      for (const [btn, key] of [[game.themeCleanBgBtn, 'themeCleanBgUpload'], [game.themeCleanBgClear, 'themeCleanBgRemove']]) {
        if (btn) { btn.title = t(key); btn.setAttribute('aria-label', t(key)) }
      }
      // Keep the Skin Designer panel in sync too, for the case where it's
      // already open (its iframe src is only ever set once - see
      // _openSkinDesignerPanel - so it can't pick up a fresh ?theme=).
      if (game.skindesignerFrame && game.skindesignerFrame.src !== 'about:blank') {
        game.skindesignerFrame.contentWindow.postMessage({ type: 'gayz-set-theme', theme: clean ? 'clean' : 'old', color: game.settings.cleanColor }, SKIN_DESIGNER_ORIGIN)
      }
    }
    syncUiTheme()
    rememberCleanVars(game.settings)
    const themeName = (theme) => document.getElementById(`theme-picker-${theme}-label`)?.textContent || theme
    const pick = (theme) => {
      if (game.settings.uiTheme !== theme) logSettingChange(t('tabTheme'), themeName(game.settings.uiTheme || 'old'), themeName(theme))
      game.settings.uiTheme = theme
      syncUiTheme()
      saveSettings(game.settings)
    }
    game.themePickerClean.addEventListener('click', () => pick('clean'))
    game.themePickerOld.addEventListener('click', () => pick('old'))
    // Picking a colour also switches to Clean - it's Clean's colour.
    const setColor = (value, save) => {
      const hex = normalizeHex(value)
      if (!hex) return false
      game.settings.cleanColor = hex
      game.settings.uiTheme = 'clean'
      syncUiTheme()
      if (save) {
        saveSettings(game.settings)
        rememberCleanVars(game.settings)
      }
      return true
    }
    game.themeCleanColorInput?.addEventListener('input', () => setColor(game.themeCleanColorInput.value, false))
    game.themeCleanColorInput?.addEventListener('change', () => setColor(game.themeCleanColorInput.value, true))
    game.themeCleanBgBtn?.addEventListener('click', () => game.themeCleanBgFile?.click())
    game.themeCleanBgFile?.addEventListener('change', async () => {
      const file = game.themeCleanBgFile.files && game.themeCleanBgFile.files[0]
      game.themeCleanBgFile.value = ''
      if (!file) return
      try {
        localStorage.setItem(CLEAN_BG_IMAGE_KEY, await cropToScreen(file))
      } catch {
        game._showHomepageToast(t('themeCleanBgError'))
        return
      }
      applyCleanBgImage()
      if (game.themeCleanBgClear) game.themeCleanBgClear.style.display = ''
      if (game.settings.uiTheme === 'clean') syncUiTheme()
      else pick('clean')
    })
    game.themeCleanBgClear?.addEventListener('click', () => {
      try { localStorage.removeItem(CLEAN_BG_IMAGE_KEY) } catch { /* storage blocked */ }
      syncUiTheme()
    })
  }
  // Audio Cue on Hover/Focus - a single delegated listener on #menu
  // (event bubbling from focusin, which - unlike focus - does bubble)
  // covers every current and future homepage button without needing
  // one listener per element.
  if (game.menu) {
    game.menu.addEventListener('mouseover', (e) => {
      if (game.settings.hoverAudioCue && e.target.closest('button')) audioEngine.playUiHover?.()
    })
    game.menu.addEventListener('focusin', (e) => {
      if (game.settings.hoverAudioCue && e.target.closest('button')) audioEngine.playUiHover?.()
    })
  }

  if (game.cursorTrailToggle) {
    game.cursorTrailToggle.checked = game.settings.cursorTrail
    game.cursorTrailToggle.addEventListener('change', () => {
      game.settings.cursorTrail = game.cursorTrailToggle.checked
      saveSettings(game.settings)
    })
  }
  // Cursor Trail Effect - one throttled listener, homepage-only
  // (checks !game.gameStarted, same guard the idle-animation/Konami
  // listeners already use), spawns a small fading dot per movement,
  // capped by a timestamp check rather than a per-frame budget.
  if (game.menu) {
    let lastTrailAt = 0
    game.menu.addEventListener('mousemove', (e) => {
      if (!game.settings.cursorTrail || game.gameStarted) return
      const now = performance.now()
      if (now - lastTrailAt < 40) return
      lastTrailAt = now
      const dot = document.createElement('div')
      dot.className = 'cursor-trail-dot'
      dot.style.left = `${e.clientX}px`
      dot.style.top = `${e.clientY}px`
      document.body.appendChild(dot)
      dot.addEventListener('animationend', () => dot.remove())
    })
  }
  if (game.crtScanlinesToggle) {
    game.crtScanlinesToggle.checked = game.settings.crtScanlines
    document.documentElement.classList.toggle('crt-scanlines', game.settings.crtScanlines)
    game.crtScanlinesToggle.addEventListener('change', () => {
      game.settings.crtScanlines = game.crtScanlinesToggle.checked
      document.documentElement.classList.toggle('crt-scanlines', game.settings.crtScanlines)
      saveSettings(game.settings)
      if (game.settings.crtScanlines && game.settings.shareTelemetry) CloudSync.incrementTelemetry('crtEnabled').catch(() => {})
    })
  }
  // Theme > Game Screens Follow the Biome (2026-10-26, Gaymi: "can we do
  // both add that in settings but default is keep biome"). TopBar reads it
  // every frame in a game, so a change shows at once.
  if (game.playBiomeLookToggle) {
    game.playBiomeLookToggle.checked = game.settings.playBiomeLook !== false
    game.playBiomeLookToggle.addEventListener('change', () => {
      game.settings.playBiomeLook = game.playBiomeLookToggle.checked
      saveSettings(game.settings)
    })
  }
  if (game.weatherParticlesToggle) {
    const applyWeather = (on) => {
      if (game.menuBgRain) game.menuBgRain.style.display = on ? '' : 'none'
      if (game.menuBgAsh) game.menuBgAsh.style.display = on ? '' : 'none'
    }
    game.weatherParticlesToggle.checked = game.settings.weatherParticles
    applyWeather(game.settings.weatherParticles)
    game.weatherParticlesToggle.addEventListener('change', () => {
      game.settings.weatherParticles = game.weatherParticlesToggle.checked
      applyWeather(game.settings.weatherParticles)
      saveSettings(game.settings)
    })
  }
  if (game.dyslexiaFontToggle) {
    game.dyslexiaFontToggle.checked = game.settings.dyslexiaFont
    document.documentElement.classList.toggle('dyslexia-font', game.settings.dyslexiaFont)
    game.dyslexiaFontToggle.addEventListener('change', () => {
      game.settings.dyslexiaFont = game.dyslexiaFontToggle.checked
      document.documentElement.classList.toggle('dyslexia-font', game.settings.dyslexiaFont)
      saveSettings(game.settings)
    })
  }
  if (game.bgMoodSelect) {
    game.bgMoodSelect.value = game.settings.bgMood
    game._applyBgMood()
    game.bgMoodSelect.addEventListener('change', () => {
      game.settings.bgMood = game.bgMoodSelect.value
      game._applyBgMood()
      saveSettings(game.settings)
    })
  }
  if (game.sfxTestBtn) {
    game.sfxTestBtn.addEventListener('click', () => {
      audioEngine.init()
      audioEngine.resume()
      audioEngine.playShot('pistol')
    })
  }

  game.performanceToggle.checked = game.settings.performanceMode
  game._applyPerformanceMode(game.settings.performanceMode)
  // Mobile GPUs are generally much weaker than desktop - entering touch
  // mode turns on Performance Mode (reduced shadows/bloom/render scale/
  // draw distance, see _applyPerformanceMode) for game session only,
  // same "don't overwrite the saved preference" reasoning as the aim
  // assist default above. The checkbox/quick-toggle still shows and
  // controls the real settings.performanceMode value underneath -
  // toggling it off during a touch session turns game back off too,
  // exactly like any other setting change would.

  game.performanceToggle.addEventListener('change', () => {
    game.settings.performanceMode = game.performanceToggle.checked
    game._applyPerformanceMode(game.settings.performanceMode)
    saveSettings(game.settings)
  })


  game.guestModeToggle.checked = game.settings.guestMode
  game.guestModeToggle.addEventListener('change', () => {
    game.settings.guestMode = game.guestModeToggle.checked
    saveSettings(game.settings)
  })


  game.mutatorHordeRush.checked = game.settings.mutators.hordeRush
  game.mutatorHordeRush.addEventListener('change', () => {
    game.settings.mutators.hordeRush = game.mutatorHordeRush.checked
    saveSettings(game.settings)
  })
  game.mutatorLootRush.checked = game.settings.mutators.lootRush
  game.mutatorLootRush.addEventListener('change', () => {
    game.settings.mutators.lootRush = game.mutatorLootRush.checked
    saveSettings(game.settings)
  })
  game.mutatorBossRush.checked = game.settings.mutators.bossRush
  game.mutatorBossRush.addEventListener('change', () => {
    game.settings.mutators.bossRush = game.mutatorBossRush.checked
    saveSettings(game.settings)
  })
  game.mutatorEscalation.checked = game.settings.mutators.escalation
  game.mutatorEscalation.addEventListener('change', () => {
    game.settings.mutators.escalation = game.mutatorEscalation.checked
    saveSettings(game.settings)
  })
  game.mutatorHealthRegen.checked = game.settings.mutators.healthRegen
  game.mutatorHealthRegen.addEventListener('change', () => {
    game.settings.mutators.healthRegen = game.mutatorHealthRegen.checked
    saveSettings(game.settings)
  })
  game.mutatorIronMode.checked = game.settings.mutators.ironMode
  game.mutatorIronMode.addEventListener('change', () => {
    game.settings.mutators.ironMode = game.mutatorIronMode.checked
    saveSettings(game.settings)
  })
  game.mutatorGlassHouse.checked = game.settings.mutators.glassHouse
  game.mutatorGlassHouse.addEventListener('change', () => {
    game.settings.mutators.glassHouse = game.mutatorGlassHouse.checked
    saveSettings(game.settings)
  })
  game.nicknameInput.value = game.settings.nickname

  game.nicknameInput.addEventListener('input', () => {
    // Standard keyboard characters only (letters, numbers, punctuation) -
    // strips emoji/other unicode a player might paste in.
    const filtered = game.nicknameInput.value.replace(/[^\x20-\x7E]/g, '')
    if (filtered !== game.nicknameInput.value) game.nicknameInput.value = filtered
    // .trim() only on the SAVED value, not the input box itself - a
    // trailing space while still mid-typing is harmless and shouldn't
    // be yanked out from under the cursor, but a leading/trailing
    // space that makes it into settings.nickname (what actually gets
    // synced/displayed/used for chat lookups elsewhere) is a real,
    // silent footgun - caught 2026-09-22 live-debugging a "can't
    // copy/block a friend in chat" report: their chat nickname
    // rendered as "Tazbot " (trailing space, from not having game
    // trim), which would break the by-NAME lookup fallback specifically
    // if it's ever reached. Not confirmed as the actual cause of that
    // report (their by-UID lookup failing first is equally explained by
    // them not having completed a run yet - no leaderboard doc to find
    // by either key) but worth fixing regardless, on its own merits.
    game.settings.nickname = game.nicknameInput.value.trim()
    saveSettings(game.settings)
    game._renderPlayerTag()
  })

  game.settingsBtn.addEventListener('click', () => game._toggleSettings(!game.settingsOpen))
  // Recently Viewed Panel quick-return (see the shortcut cheat sheet's
  // "R" row) - remembers whichever of these 6 nav-reachable panels was
  // opened most recently, so it can be reopened with one keypress
  // without re-navigating the homepage nav row.
  const trackAndOpen = (openFn) => { game._lastPanelOpener = openFn; openFn() }
  game.upgradesBtn.addEventListener('click', () => trackAndOpen(() => game._openUpgradesPanel()))
  game.prestigeBtn.addEventListener('click', () => game._prestige())
  game.respecBtn.addEventListener('click', () => game._respecMetaUpgrades())
  game.questsBtn.addEventListener('click', () => trackAndOpen(() => game._openQuestsPanel()))
  game.questsOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-quest-id]')
    if (btn && !btn.disabled) game._claimQuest(btn.dataset.questId)
  })
  // Quests' search box and All rarities menu (2026-10-30).
  const questRarityBtn = document.getElementById('quest-rarity-filter-btn')
  const questRarityMenu = document.getElementById('quest-rarity-filter-menu')
  document.getElementById('quest-search')?.addEventListener('input', () => game._renderRollingQuestsPanel())
  if (questRarityBtn && questRarityMenu) {
    questRarityBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      game._toggleMarketFilterMenu(questRarityBtn, questRarityMenu)
    })
    questRarityMenu.addEventListener('click', (e) => {
      e.stopPropagation()
      const opt = e.target.closest('[data-market-rarity]')
      if (!opt) return
      game._questRarity = opt.dataset.marketRarity
      game._closeMarketFilterMenus()
      game._renderRollingQuestsPanel()
    })
  }
  game.rollingQuestsOptions.addEventListener('click', (e) => {
    const daily = e.target.closest('button[data-daily]')
    if (daily && !daily.disabled) game._claimDailyChallenge()
    const btn = e.target.closest('button[data-spawned-at]')
    if (btn && !btn.disabled) game._claimRollingQuest(Number(btn.dataset.spawnedAt))
  })
  if (game.hubBtn) game.hubBtn.addEventListener('click', () => trackAndOpen(() => game._openClanPanel()))
  if (game.gamemodeBtn) game.gamemodeBtn.addEventListener('click', () => trackAndOpen(() => game._openHubPanel()))
  if (game.comingSoonCloseBtn) game.comingSoonCloseBtn.addEventListener('click', () => game._closeComingSoonPanel())
  if (game.howtoplayNavLink) game.howtoplayNavLink.addEventListener('click', () => game._openHowToPlayPanel())
  if (game.whatsNewLink) game.whatsNewLink.addEventListener('click', () => trackAndOpen(() => game._openWhatsNewPanel()))
  bindHoverMenus(game)
  if (game.friendsBtn) game.friendsBtn.addEventListener('click', () => trackAndOpen(() => game._openFriendsPanel()))
  if (game.statusPickerToggle) {
    game.statusPickerToggle.addEventListener('click', (e) => {
      e.stopPropagation()
      game.statusPicker.classList.toggle('open')
    })
  }
  for (const btn of game.statusPickBtns) {
    btn.addEventListener('click', () => {
      game._applyStatusMode(btn.dataset.status)
      game.statusPicker.classList.remove('open')
    })
  }
  document.addEventListener('click', (e) => {
    if (game.statusPicker && game.statusPicker.classList.contains('open') && !game.statusPicker.contains(e.target)) {
      game.statusPicker.classList.remove('open')
    }
  })
  if (game.friendsSigninBtn) game.friendsSigninBtn.addEventListener('click', () => game._openProfilePanel())
  if (game.menuInventoryBtn) game.menuInventoryBtn.addEventListener('click', () => trackAndOpen(() => game._openMenuInventoryPanel()))
  if (game.serverBtn) game.serverBtn.addEventListener('click', () => trackAndOpen(() => game._openServerPanel()))
  game.achievementsBtn.addEventListener('click', () => trackAndOpen(() => game._openAchievementsPanel()))
  document.getElementById('nav-gallery-link')?.addEventListener('click', () => game._openGalleryPanel())
  GalleryUI.bindGallery(game)
  if (game.achievementsFilterInput) {
    game.achievementsFilterInput.addEventListener('click', (e) => e.stopPropagation())
    game.achievementsFilterInput.addEventListener('input', () => game._renderAchievementsPanel())
  }
  if (game.achievementsCategorySelect) {
    game.achievementsCategorySelect.addEventListener('click', (e) => e.stopPropagation())
    game.achievementsCategorySelect.addEventListener('change', () => game._renderAchievementsPanel())
  }
  if (game.achievementsSortSelect) {
    game.achievementsSortSelect.addEventListener('click', (e) => e.stopPropagation())
    game.achievementsSortSelect.addEventListener('change', () => game._renderAchievementsPanel())
  }
  if (game.printAchievementsBtn) {
    game.printAchievementsBtn.addEventListener('click', () => {
      if (!game.printStatsSheet) return
      // Rebuilds clean print-only markup (name/status pairs in a
      // 2-column grid) instead of cloning achievementsOptions.innerHTML
      // verbatim (2026-09-21) - the live cards are `.perk-option`
      // buttons built for the dark in-game panel, and reusing that
      // markup for print left every field stacked on its own
      // underlined line with no sections/summary, unreadable on paper.
      // Every achievement, whatever filter the panel shows (2026-10-24,
      // Gaymi: "should have every single achievement in it"), as an 8x9
      // grid on one landscape page.
      const buildRow = (name, unlocked, status) =>
        `<div class="print-ach-row ${unlocked ? 'unlocked' : 'locked'}"><span class="print-ach-name">${_escapeHtml(name)}</span><span class="print-ach-status">${_escapeHtml(status)}</span></div>`
      const achRows = ACHIEVEMENTS
        .map((ach) => {
          const unlocked = game.achievements.unlocked.has(ach.id)
          const name = unlocked ? t(ach.titleKey) : '???'
          const status = unlocked ? t('achievementUnlockedShort') : (ach.hintKey ? t(ach.hintKey) : t('achievementLocked'))
          return buildRow(name, unlocked, status)
        })
        .join('')

      const achSummary = t('printAchievementsSummary', { unlocked: game.achievements.unlocked.size, total: ACHIEVEMENTS.length })
      game.printStatsSheet.innerHTML = `
        <h2 class="print-ach-section">${_escapeHtml(t('printAchievementsTitle'))} — ${_escapeHtml(achSummary)}</h2><div class="print-ach-grid">${achRows}</div>
      `
      document.documentElement.classList.add('print-achievements')
      window.addEventListener('afterprint', () => document.documentElement.classList.remove('print-achievements'), { once: true })
      window.print()
    })
  }
  game.menuPlayerBadge.addEventListener('click', () => game._openProfilePanel())
  game.menuPlayerBadge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      game._openProfilePanel()
    }
  })
  if (game.menuAvatarLevel) {
    game.menuAvatarLevel.addEventListener('click', (e) => {
      e.stopPropagation()
      game._openLevelsPanel()
    })
  }
  // Pencil icon in the Player showcase panel reveals the same
  // #nickname-row (hidden by default since the old always-visible
  // Player Setup form was replaced with just "Player" + the big avatar).
  // The corner ID tag has no editor of its own - it's not editable,
  // it's a stable random id - clicking it copies it instead (see below),
  // stopPropagation so that doesn't also trigger the parent badge's
  // "open profile" click.
  if (game.menuPlayerTag) {
    game.menuPlayerTag.addEventListener('click', (e) => {
      e.stopPropagation()
      game._copyPlayerId()
    })
  }
  if (game.playerShowcaseRenameBtn) {
    // Toggle: first click opens the editor, a second click (while it's
    // already open) confirms whatever's in the box - including a random
    // suggestion the player hasn't typed themselves - and closes it.
    game.playerShowcaseRenameBtn.addEventListener('click', () => {
      if (game.nicknameRow && game.nicknameRow.style.display !== 'none') {
        game._confirmNicknameEdit()
      } else {
        game._revealNicknameEditor()
      }
    })
  }
  if (game.nicknameInput && game.nicknameRow) {
    // Short delay before hiding on blur so a click on the adjacent
    // Random button (which also steals focus) has time to register
    // first - a plain synchronous hide would swallow that click.
    game.nicknameInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (document.activeElement !== game.nicknameInput) game.nicknameRow.style.display = 'none'
      }, 150)
    })
    game.nicknameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') game.nicknameInput.blur()
    })
  }
  if (game.whatsNewDigestCloseBtn) {
    game.whatsNewDigestCloseBtn.addEventListener('click', () => {
      clearTimeout(game._whatsNewDigestFadeTimer)
      game.whatsNewDigest.style.display = 'none'
      try { localStorage.setItem(CHANGELOG_LAST_VIEWED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
      game._updateWhatsNewDot()
    })
  }
  // Every sign-in button on the signed-out Profile card names its site in
  // data-provider (see CloudSync.signIn).
  game.profileLoginGate?.addEventListener('click', (e) => {
    const signIn = e.target.closest('[data-provider]')
    if (signIn) game._handleCloudSignIn(signIn.dataset.provider)
    else if (e.target.closest('.open-terms-panel-link')) game._openTermsPanel()
    else if (e.target.closest('.open-privacy-panel-link')) game._openPrivacyPanel()
  })
  if (game.profileSignoutBtn) {
    game.profileSignoutBtn.addEventListener('click', async () => {
      await CloudSaveUI.handleCloudSignOut(game)
      game._renderProfileAccountRow()
      if (game.profilePanel?.style.display === 'flex') game._openProfilePanel()
    })
  }
  if (game.profileCareerPortraitBtn) game.profileCareerPortraitBtn.addEventListener('click', () => game._generateCareerPortrait())
  if (game.reportBugBtn) game.reportBugBtn.addEventListener('click', () => game._reportBug())
  game.creditsBtn.addEventListener('click', () => trackAndOpen(() => game._openCreditsPanel()))
  if (game.termsBtn) game.termsBtn.addEventListener('click', () => trackAndOpen(() => game._openTermsPanel()))
  const navPrivacyLink = document.getElementById('nav-privacy-link')
  if (navPrivacyLink) navPrivacyLink.addEventListener('click', () => trackAndOpen(() => game._openPrivacyPanel()))
  if (game.creditsTermsLink) game.creditsTermsLink.addEventListener('click', () => trackAndOpen(() => game._openTermsPanel()))
  if (game.creditsPrivacyLink) game.creditsPrivacyLink.addEventListener('click', () => trackAndOpen(() => game._openPrivacyPanel()))
  if (game.gayzFeaturesBtn) game.gayzFeaturesBtn.addEventListener('click', () => trackAndOpen(() => game._openFeaturesPanel()))
  if (game.skindesignerBtn) game.skindesignerBtn.addEventListener('click', () => trackAndOpen(() => game._openSkinDesignerPanel()))
  game._bindSkinDesignerMessages()
  game._bindFeaturesPanel()
  // Cross-reference links inside the Terms/Privacy body text themselves
  // (event delegation - each doc only has 1-3 of these, but delegating
  // keeps game binding in one place rather than querying per-instance).
  if (game.privacyContent) {
    game.privacyContent.addEventListener('click', (e) => {
      if (e.target.closest('.open-terms-panel-link')) game._openTermsPanel()
    })
  }
  if (game.termsContent) {
    game.termsContent.addEventListener('click', (e) => {
      if (e.target.closest('.open-privacy-panel-link')) game._openPrivacyPanel()
    })
  }
  game.storeBtn.addEventListener('click', () => trackAndOpen(() => game._openShopPanel()))
  game.marketBtn?.addEventListener('click', () => trackAndOpen(() => game._openMarketPanel()))
  game._bindHomepageBatch()
  CloudSaveUI.bindCloudSave(game)
  CloudSaveUI.installChangeTracking(game)
  game._startPresenceHeartbeat()
  game._gateChangelog()
  game._maybeShowWhatsNewDigest()
  game._checkFriendBeatNotifications()
  game._checkSettingsTabDeepLink()
  game._checkWeeklyResetImminent()
  game._checkUnclaimedQuestsReminder()

  // A click on an open panel's backdrop that lands on one of the
  // homepage's right-side buttons (the profile card or a nav button)
  // presses that button instead of only closing the panel (2026-10-10,
  // "you can also click anything on the right side panel" - same as the
  // footer links, which sit above the backdrop). The right column can't
  // be lifted above the panels like the links: it's inside #menu-layout's
  // own stacking layer, with the hero. Capture phase, so the backdrop's
  // own close handler below never sees it.
  document.addEventListener('click', (e) => {
    const backdrop = e.target
    if (!(backdrop instanceof HTMLElement) || !/-panel$/.test(backdrop.id) || !backdrop.querySelector(':scope > .panel-box')) return
    // The level coin first: it sits inside the profile card but opens
    // Levels, not Profile (it used to open Profile from a panel).
    const TARGETS = '#menu-avatar-level, #menu-nav-buttons button, #menu-player-badge'
    const under = document.elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.closest?.(TARGETS))
    const button = under?.closest('#menu-avatar-level') || under?.closest(TARGETS)
    if (!button || button.offsetParent === null) return
    e.stopImmediatePropagation()
    e.preventDefault()
    game._closeAllMenuPanels()
    button.click()
  }, true)
  // The same for hover (2026-10-11, "when your mouse is on anything on
  // the sidebar it doesnt go bright"): the backdrop gets the real :hover,
  // so the button under the mouse gets .nav-hover, styled like :hover.
  let navHovered = null
  const setNavHover = (el) => {
    if (el === navHovered) return
    navHovered?.classList.remove('nav-hover')
    navHovered = el
    el?.classList.add('nav-hover')
  }
  document.addEventListener('mousemove', (e) => {
    const backdrop = e.target
    if (!(backdrop instanceof HTMLElement) || !/-panel$/.test(backdrop.id) || !backdrop.querySelector(':scope > .panel-box')) {
      if (navHovered) { setNavHover(null); if (backdrop instanceof HTMLElement) backdrop.style.cursor = '' }
      return
    }
    const under = document.elementsFromPoint(e.clientX, e.clientY)
      .find((el) => el.closest?.('#menu-nav-buttons button, #menu-player-badge'))
    const target = under?.closest('#menu-nav-buttons button, #menu-player-badge') || null
    setNavHover(target && target.offsetParent !== null ? target : null)
    backdrop.style.cursor = navHovered ? 'pointer' : ''
  }, { passive: true })
  document.addEventListener('mouseleave', () => setNavHover(null))
  document.addEventListener('click', () => setNavHover(null))
  // NavCurrent (2026-10-23): while a panel is open, only the right-column
  // button that opened it stays lit (html.menu-panel-open in style.css).
  // Capture phase, so the backdrop's own button.click() above counts too;
  // a page opened any other way (Game Mode, a bottom link) lights none.
  const NAV = '#menu-nav-buttons > button, #menu-player-badge'
  let navCurrent = null
  const setNavCurrent = (el) => {
    navCurrent?.classList.remove('nav-current')
    navCurrent = el
    el?.classList.add('nav-current')
  }
  document.addEventListener('click', (e) => {
    const nav = e.target.closest?.(NAV)
    if (nav) setNavCurrent(nav)
    else if (e.target.closest?.('#menu-links-row, #gamemode-btn, #settings-btn')) setNavCurrent(null)
  }, true)
  const menuPanels = [...document.querySelectorAll('[id$="-panel"]')].filter((p) => p.querySelector(':scope > .panel-box'))
  const syncPanelOpen = () => {
    const open = menuPanels.some((p) => p.style.display && p.style.display !== 'none')
    document.documentElement.classList.toggle('menu-panel-open', open)
    if (!open) setNavCurrent(null)
  }
  const panelWatch = new MutationObserver(syncPanelOpen)
  for (const p of menuPanels) panelWatch.observe(p, { attributes: true, attributeFilter: ['style'] })

  // Click anywhere outside the settings content (the backdrop itself, not
  // a descendant) to close, in addition to toggling the Settings button.
  game.settingsPanel.addEventListener('click', (e) => {
    if (e.target === game.settingsPanel) game._toggleSettings(false)
  })
  game.upgradesPanel.addEventListener('click', (e) => {
    if (e.target === game.upgradesPanel) game._closeUpgradesPanel()
  })
  game.questsPanel.addEventListener('click', (e) => {
    if (e.target === game.questsPanel) game._closeQuestsPanel()
  })
  game.achievementsPanel.addEventListener('click', (e) => {
    if (e.target === game.achievementsPanel) game._closeAchievementsPanel()
  })
  if (game.hubPanel) {
    game.hubPanel.addEventListener('click', (e) => {
      if (e.target === game.hubPanel) game._closeHubPanel()
    })
  }
  if (game.comingSoonPanel) {
    game.comingSoonPanel.addEventListener('click', (e) => {
      if (e.target === game.comingSoonPanel) game._closeComingSoonPanel()
    })
  }
  if (game.friendsPanel) {
    game.friendsPanel.addEventListener('click', (e) => {
      if (e.target === game.friendsPanel) game._closeFriendsPanel()
    })
  }
  if (game.menuInventoryPanel) {
    game.menuInventoryPanel.addEventListener('click', (e) => {
      if (e.target === game.menuInventoryPanel) game._closeMenuInventoryPanel()
    })
  }
  if (game.serverPanel) {
    game.serverPanel.addEventListener('click', (e) => {
      if (e.target === game.serverPanel) game._closeServerPanel()
    })
  }
  game.profilePanel.addEventListener('click', (e) => {
    if (e.target === game.profilePanel) game._closeProfilePanel()
  })
  game.creditsPanel.addEventListener('click', (e) => {
    if (e.target === game.creditsPanel) game._closeCreditsPanel()
  })
  if (game.galleryPanel) {
    game.galleryPanel.addEventListener('click', (e) => {
      if (e.target === game.galleryPanel) game._closeGalleryPanel()
    })
  }
  if (game.levelsPanel) {
    game.levelsPanel.addEventListener('click', (e) => {
      if (e.target === game.levelsPanel) game._closeLevelsPanel()
    })
  }
  if (game.termsPanel) {
    game.termsPanel.addEventListener('click', (e) => {
      if (e.target === game.termsPanel) game._closeTermsPanel()
    })
  }
  if (game.privacyPanel) {
    game.privacyPanel.addEventListener('click', (e) => {
      if (e.target === game.privacyPanel) game._closePrivacyPanel()
    })
  }
  if (game.featuresPanel) {
    game.featuresPanel.addEventListener('click', (e) => {
      if (e.target === game.featuresPanel) game._closeFeaturesPanel()
    })
  }
  if (game.skindesignerPanel) {
    game.skindesignerPanel.addEventListener('click', (e) => {
      if (e.target === game.skindesignerPanel) game._closeSkinDesignerPanel()
    })
  }
  game.shopPanel.addEventListener('click', (e) => {
    if (e.target === game.shopPanel) game._closeShopPanel()
  })
  game.marketPanel?.addEventListener('click', (e) => {
    if (e.target === game.marketPanel) game._closeMarketPanel()
  })
  if (game.shopSkinBuyBtn) game.shopSkinBuyBtn.addEventListener('click', () => game._buyShopSkin())
  // Inspect (was Try On, 2026-10-24): GaygarX big in the Inspect window.
  document.getElementById('shop-skin-tryon-btn')?.addEventListener('click', () => game._openInspectDialog('character', 'gaygarx'))
  document.getElementById('shop-tryon-back-btn')?.addEventListener('click', () => game._endShopTryOn(true))
  if (game.otherProfilePanel) {
    game.otherProfilePanel.addEventListener('click', (e) => {
      if (e.target === game.otherProfilePanel) game._closeOtherPlayerProfile()
    })
  }
  if (game.friendsOwnId) {
    game.friendsOwnId.addEventListener('click', () => {
      if (!game.settings.playerId) return
      navigator.clipboard.writeText(`#${game.settings.playerId}`).then(() => game._showCopiedBadge(game.friendsOwnId)).catch(() => {})
    })
  }
  // Nothing outside a text box can be selected or dragged (see the
  // user-select note at the top of style.css) - game catches what CSS
  // alone misses (a selection or drag started some other way).
  const editable = (t) => t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]')
  document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault() })
  document.addEventListener('dragstart', (e) => { if (!editable(e.target)) e.preventDefault() })
  if (game.otherProfileId) {
    game.otherProfileId.addEventListener('click', () => {
      if (!game._otherProfileIdText) return
      navigator.clipboard.writeText(game._otherProfileIdText).then(() => game._showCopiedBadge(game.otherProfileId)).catch(() => {})
    })
  }
  // Private note about whichever player the popup is CURRENTLY showing
  // (_otherProfileCurrentPlayerId, set fresh by _renderOtherProfileEntry
  // every time it renders someone) - bound once here rather than
  // re-bound per render, so it always saves against whoever is live in
  // the popup right now, not whoever was showing when game listener was
  // first attached. Local-only (settings.playerNotes), never synced -
  // "only you can see game" per the popup's own hint text.
  if (game.otherProfileNotesInput) {
    game.otherProfileNotesInput.addEventListener('input', () => {
      if (!game._otherProfileCurrentPlayerId) return
      const text = game.otherProfileNotesInput.value.slice(0, 250)
      game.settings.playerNotes[game._otherProfileCurrentPlayerId] = text
      saveSettings(game.settings)
    })
  }
  // Delegated (one listener survives every _renderSavedFriends re-render,
  // rather than needing to rebind per row) - clicking a friend's row
  // opens their public profile, clicking the × still just removes them.
  // Names on General's leaderboards open that player's profile.
  OnlineUI.bindLeaderboardClicks(game)
  if (game.cloudsaveSavedFriends) {
    game.cloudsaveSavedFriends.addEventListener('click', (e) => {
      if (e.target.closest('.saved-friend-remove')) return
      const row = e.target.closest('.saved-friend-row')
      if (!row || !row.dataset.uid) return
      game._openOtherPlayerProfile(row.dataset.uid, row.dataset.name)
    })
  }
  if (game.whatsNewPanel) {
    game.whatsNewPanel.addEventListener('click', (e) => {
      if (e.target === game.whatsNewPanel) game._closeWhatsNewPanel()
    })
  }
}

// Graphics tab (Settings > Graphics, beside Controls) - Rendering/
// Effects/Damage Indicator/Damage Numbers sections. Every control here
// is a real, working setting (not placeholder UI) - see each one's own
// comment for what it actually wires into.
export function _bindGraphicsSettings(game) {
  if (game.gfxResolutionSlider) {
    game.gfxResolutionSlider.value = game.settings.renderResolution
    game.gfxResolutionValue.textContent = `${game.settings.renderResolution}%`
    game.gfxResolutionSlider.addEventListener('input', () => {
      const value = Number(game.gfxResolutionSlider.value)
      game.gfxResolutionValue.textContent = `${value}%`
      game.settings.renderResolution = value
      game._userResScale = value / 100
      game._applyRenderScale()
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.gfxResolutionValue, game.gfxResolutionSlider)
  }
  // FPS Cap - throttles how often _tick's requestAnimationFrame loop
  // actually renders (see the frame-skip check there), not a real
  // browser-level VSync toggle (no such API exists for a web page -
  // the browser always syncs requestAnimationFrame to the display's own
  // refresh rate already). A cap is the closest meaningful equivalent:
  // caps GPU/battery usage same as VSync would for a player who doesn't
  // want or need every frame their monitor can show.
  if (game.fpsCapSelect) {
    game.fpsCapSelect.value = String(game.settings.fpsCap)
    game._fpsCapMinFrameMs = game.settings.fpsCap > 0 ? 1000 / game.settings.fpsCap : 0
    game.fpsCapSelect.addEventListener('change', () => {
      const value = Number(game.fpsCapSelect.value)
      game.settings.fpsCap = value
      game._fpsCapMinFrameMs = value > 0 ? 1000 / value : 0
      saveSettings(game.settings)
    })
  }
  // Auto Quality - turning it off snaps the Map Editor / Map 1 straight
  // back to full sharpness; on, it lowers resolution and view distance
  // when the game is slow (Game._updateEditorResScale).
  if (game.autoQualityToggle) {
    game.autoQualityToggle.checked = game.settings.autoQuality
    game.autoQualityToggle.addEventListener('change', () => {
      game.settings.autoQuality = game.autoQualityToggle.checked
      // Off: back to full sharpness in the editor right away.
      if (!game.settings.autoQuality) game._editorResScale = 1
      game._applyRenderScale()
      saveSettings(game.settings)
    })
  }
  // Brightness/Contrast - a CSS filter on the actual <canvas> element
  // (not the DOM-wide #app filter "High Contrast Mode" already uses in
  // the Controls tab - that's a separate accessibility toggle, game is
  // a continuous rendering-level control, the two compound rather than
  // conflict). Applied via _applyGraphicsFilters so both sliders share
  // one filter string instead of overwriting each other.
  if (game.gfxBrightnessSlider) {
    game.gfxBrightnessSlider.value = game.settings.brightness
    game.gfxBrightnessValue.textContent = `${game.settings.brightness}%`
    game.gfxBrightnessSlider.addEventListener('input', () => {
      const value = Number(game.gfxBrightnessSlider.value)
      game.gfxBrightnessValue.textContent = `${value}%`
      game.settings.brightness = value
      game._applyGraphicsFilters()
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.gfxBrightnessValue, game.gfxBrightnessSlider)
  }
  if (game.gfxContrastSlider) {
    game.gfxContrastSlider.value = game.settings.contrast
    game.gfxContrastValue.textContent = `${game.settings.contrast}%`
    game.gfxContrastSlider.addEventListener('input', () => {
      const value = Number(game.gfxContrastSlider.value)
      game.gfxContrastValue.textContent = `${value}%`
      game.settings.contrast = value
      game._applyGraphicsFilters()
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.gfxContrastValue, game.gfxContrastSlider)
  }
  game._applyGraphicsFilters()


  // Shadows - ORs with Performance Mode/LOW_QUALITY_MODE the same way
  // _applyPerformanceMode already does (both of those force shadows off
  // regardless of game toggle - see _resolveShadowsEnabled), so game
  // and the existing "FPS Optimized" checkbox can't silently fight.
  if (game.gfxShadowsToggle) {
    game.gfxShadowsToggle.checked = game.settings.shadowsEnabled
    game.gfxShadowsToggle.addEventListener('change', () => {
      game.settings.shadowsEnabled = game.gfxShadowsToggle.checked
      game.renderer.shadowMap.enabled = game._resolveShadowsEnabled()
      saveSettings(game.settings)
    })
  }
  if (game.gfxShadowQualitySelect) {
    game.gfxShadowQualitySelect.value = game.settings.shadowQuality
    game.gfxShadowQualitySelect.addEventListener('change', () => {
      game.settings.shadowQuality = game.gfxShadowQualitySelect.value
      game._applyShadowQuality()
      saveSettings(game.settings)
    })
    game._applyShadowQuality()
  }
  // View Distance - read by BuildMode.viewDistance() every frame.
  if (game.gfxViewDistanceSelect) {
    game.gfxViewDistanceSelect.value = game.settings.viewDistance
    game.gfxViewDistanceSelect.addEventListener('change', () => {
      game.settings.viewDistance = game.gfxViewDistanceSelect.value
      if (game.buildMode) game.buildMode._autoView = null
      saveSettings(game.settings)
    })
  }

  // Graphics level cards (GraphicsLevels.js) - drawn again whenever the
  // Graphics tab opens, so they're in the current language.
  _renderGraphicsLevels(game)
  document.getElementById('tab-graphics')?.addEventListener('click', () => _renderGraphicsLevels(game))

  // Lite Textures - smaller block/model textures (Game._applyLiteTextures).
  if (game.gfxLiteTexturesToggle) {
    game.gfxLiteTexturesToggle.checked = !!game.settings.liteTextures
    game.gfxLiteTexturesToggle.addEventListener('change', () => {
      game.settings.liteTextures = game.gfxLiteTexturesToggle.checked
      saveSettings(game.settings)
      game._applyLiteTextures()
    })
  }


  // Film Grain - regenerates the shared --grain-texture SVG data URI with
  // a scaled alpha (0.1 is the original always-on strength) and sets it
  // on :root, rather than adding a per-usage opacity wrapper around each
  // of the 4 places --grain-texture is layered into a background-image
  // list - inline style on :root already beats the stylesheet's own
  // --grain-texture declaration, so every usage picks it up for free.
  if (game.gfxGrainSlider) {
    game.gfxGrainSlider.value = game.settings.grainIntensity
    game.gfxGrainValue.textContent = `${game.settings.grainIntensity}%`
    game._applyGrainIntensity()
    game.gfxGrainSlider.addEventListener('input', () => {
      const value = Number(game.gfxGrainSlider.value)
      game.gfxGrainValue.textContent = `${value}%`
      game.settings.grainIntensity = value
      game._applyGrainIntensity()
      saveSettings(game.settings)
    })
    game._bindEditableSliderValue(game.gfxGrainValue, game.gfxGrainSlider)
  }

  // Menu Panel Flicker - the panelFlicker animation on .menu-panel/
  // .menu-card has no toggle of its own (only prefers-reduced-motion
  // covers it, see the media query game same batch also extended to
  // include it); game lets it be turned off regardless of OS setting.
  if (game.gfxPanelFlickerToggle) {
    game.gfxPanelFlickerToggle.checked = game.settings.panelFlickerEnabled
    document.documentElement.classList.toggle('no-panel-flicker', !game.settings.panelFlickerEnabled)
    game.gfxPanelFlickerToggle.addEventListener('change', () => {
      game.settings.panelFlickerEnabled = game.gfxPanelFlickerToggle.checked
      document.documentElement.classList.toggle('no-panel-flicker', !game.settings.panelFlickerEnabled)
      saveSettings(game.settings)
    })
  }

  if (game.resetGraphicsDefaultsBtn) {
    game.resetGraphicsDefaultsBtn.addEventListener('click', () => game._resetGraphicsDefaults())
  }
}

// General tab (Settings > General) - HUD/Notifications/Account &amp; Data
// sections. Was an empty "Coming soon" placeholder before this batch.
export function _bindGeneralSettings(game) {


  if (game.friendPresenceNotifyToggle) {
    game.friendPresenceNotifyToggle.checked = game.settings.friendPresenceNotify
    game.friendPresenceNotifyToggle.addEventListener('change', () => {
      game.settings.friendPresenceNotify = game.friendPresenceNotifyToggle.checked
      saveSettings(game.settings)
    })
  }



  if (game.timeFormatSelect) {
    game.timeFormatSelect.value = game.settings.timeFormat
    game.timeFormatSelect.addEventListener('change', () => {
      game.settings.timeFormat = game.timeFormatSelect.value
      saveSettings(game.settings)
      game._updateHomepageClock()
    })
  }
  if (game.homepageClockEl) {
    game._updateHomepageClock()
    setInterval(() => game._updateHomepageClock(), 1000)
  }

  if (game.autosaveFrequencySlider) {
    game.autosaveFrequencySlider.value = game.settings.autoSaveFrequencySec
    game.autosaveFrequencyValue.textContent = `${game.settings.autoSaveFrequencySec}s`
    game._restartAutoSaveTimer()
    game.autosaveFrequencySlider.addEventListener('input', () => {
      const value = Number(game.autosaveFrequencySlider.value)
      game.autosaveFrequencyValue.textContent = `${value}s`
      game.settings.autoSaveFrequencySec = value
      saveSettings(game.settings)
      game._restartAutoSaveTimer()
    })
  }

  if (game.settings.weeklyChallengeReminder && game.weeklyChallenge.progress === 0) {
    game._showHomepageToast(t('weeklyChallengeReminderToast'))
  }

  if (game.hudFpsToggle) {
    game.hudFpsToggle.checked = game.settings.hudFpsCounter
    game.hudFpsToggle.addEventListener('change', () => {
      game.settings.hudFpsCounter = game.hudFpsToggle.checked
      saveSettings(game.settings)
    })
  }


  if (game.achievementToastToggle) {
    game.achievementToastToggle.checked = game.settings.achievementToasts
    game.achievementToastToggle.addEventListener('change', () => {
      game.settings.achievementToasts = game.achievementToastToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.rankUpToastToggle) {
    game.rankUpToastToggle.checked = game.settings.rankUpToasts
    game.rankUpToastToggle.addEventListener('change', () => {
      game.settings.rankUpToasts = game.rankUpToastToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.leaderboardRankToggle) {
    game.leaderboardRankToggle.checked = game.settings.leaderboardRankAlerts
    game.leaderboardRankToggle.addEventListener('change', () => {
      game.settings.leaderboardRankAlerts = game.leaderboardRankToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.weeklyReminderToggle) {
    game.weeklyReminderToggle.checked = game.settings.weeklyChallengeReminder
    game.weeklyReminderToggle.addEventListener('change', () => {
      game.settings.weeklyChallengeReminder = game.weeklyReminderToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.lowCurrencyToggle) {
    game.lowCurrencyToggle.checked = game.settings.lowCurrencyReminder
    game.lowCurrencyToggle.addEventListener('change', () => {
      game.settings.lowCurrencyReminder = game.lowCurrencyToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.backupReminderToggle) {
    game.backupReminderToggle.checked = game.settings.backupReminder
    game.backupReminderToggle.addEventListener('change', () => {
      game.settings.backupReminder = game.backupReminderToggle.checked
      saveSettings(game.settings)
    })
    // Nudges at most once a week - lastExportAt is set by _exportSave().
    const DAYS_MS = 7 * 24 * 60 * 60 * 1000
    if (game.settings.backupReminder && Date.now() - (game.settings.lastExportAt || 0) > DAYS_MS) {
      game._showHomepageToast(t('backupReminderToast'))
    }
  }

  if (game.saveSizeValueEl) {
    let totalChars = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      totalChars += key.length + (localStorage.getItem(key) || '').length
    }
    game.saveSizeValueEl.textContent = totalChars > 1024 ? `${(totalChars / 1024).toFixed(1)} KB` : `${totalChars} B`
  }

  if (game.clearCacheBtn) {
    game.clearCacheBtn.addEventListener('click', () => {
      if (!window.confirm(t('clearCacheConfirm'))) return
      // Only genuinely disposable caches - never the save itself
      // (settings/careerStats/achievements/etc, none of which are
      // prefixed 'gayz-cache-') and never keybinds.
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('gayz-cache-')) keys.push(key)
      }
      for (const key of keys) localStorage.removeItem(key)
      game._showHomepageToast(t('clearCacheDoneToast', { n: keys.length }))
    })
  }

  if (game.confirmSignoutToggle) {
    game.confirmSignoutToggle.checked = game.settings.confirmSignOut
    game.confirmSignoutToggle.addEventListener('change', () => {
      game.settings.confirmSignOut = game.confirmSignoutToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.staySignedinToggle) {
    game.staySignedinToggle.checked = game.settings.stayEmbedSignedIn
    game.staySignedinToggle.addEventListener('change', () => {
      game.settings.stayEmbedSignedIn = game.staySignedinToggle.checked
      saveSettings(game.settings)
      CloudSync.setAuthPersistence(game.settings.stayEmbedSignedIn).catch(() => {})
    })
  }

  if (game.anonymousLeaderboardToggle) {
    game.anonymousLeaderboardToggle.checked = game.settings.anonymousLeaderboard
    game.anonymousLeaderboardToggle.addEventListener('change', () => {
      game.settings.anonymousLeaderboard = game.anonymousLeaderboardToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.shareTelemetryToggle) {
    game.shareTelemetryToggle.checked = game.settings.shareTelemetry
    game.shareTelemetryToggle.addEventListener('change', () => {
      game.settings.shareTelemetry = game.shareTelemetryToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.autoDeclineToggle) {
    game.autoDeclineToggle.checked = game.settings.autoDeclineFriendRequests
    game.autoDeclineToggle.addEventListener('change', () => {
      game.settings.autoDeclineFriendRequests = game.autoDeclineToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.exactLastseenToggle) {
    game.exactLastseenToggle.checked = game.settings.exactLastSeen
    game.exactLastseenToggle.addEventListener('change', () => {
      game.settings.exactLastSeen = game.exactLastseenToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.rememberSettingsTabToggle) {
    game.rememberSettingsTabToggle.checked = game.settings.rememberSettingsTab
    game.rememberSettingsTabToggle.addEventListener('change', () => {
      game.settings.rememberSettingsTab = game.rememberSettingsTabToggle.checked
      saveSettings(game.settings)
    })
  }

  if (game.confirmRemoveFriendToggle) {
    game.confirmRemoveFriendToggle.checked = game.settings.confirmRemoveFriend
    game.confirmRemoveFriendToggle.addEventListener('change', () => {
      game.settings.confirmRemoveFriend = game.confirmRemoveFriendToggle.checked
      saveSettings(game.settings)
    })
  }

  // Natural disasters may wreck builds too, not just the ground (Disasters.js).
  const breakAll = document.getElementById('disaster-break-all-toggle')
  if (breakAll) {
    breakAll.checked = !!game.settings.disasterBreakAll
    breakAll.addEventListener('change', () => {
      game.settings.disasterBreakAll = breakAll.checked
      saveSettings(game.settings)
    })
  }

  if (game.reduceBgEffectsToggle) {
    game.reduceBgEffectsToggle.checked = game.settings.reduceBgEffects
    document.body.classList.toggle('reduce-bg-effects', game.settings.reduceBgEffects)
    game.reduceBgEffectsToggle.addEventListener('change', () => {
      game.settings.reduceBgEffects = game.reduceBgEffectsToggle.checked
      document.body.classList.toggle('reduce-bg-effects', game.settings.reduceBgEffects)
      saveSettings(game.settings)
    })
  }

  if (game.homepageGreetingInput) {
    game.homepageGreetingInput.value = game.settings.homepageGreeting
    game._updateHomepageGreeting()
    game.homepageGreetingInput.addEventListener('input', () => {
      game.settings.homepageGreeting = game.homepageGreetingInput.value.slice(0, 40)
      game._updateHomepageGreeting()
      saveSettings(game.settings)
    })
  }


  if (game.oneHandedToggle) {
    game.oneHandedToggle.checked = game.settings.oneHandedLayout
    game.oneHandedToggle.addEventListener('change', () => {
      game.settings.oneHandedLayout = game.oneHandedToggle.checked
      saveSettings(game.settings)
    })
  }
  // One-Handed Key Layout - rather than remapping keyboard keys (the
  // right half of a full keyboard has more bound actions than the left
  // half has free keys to receive them, so a genuine full remap doesn't
  // fit), extra mouse buttons (4/5 - Back/Forward on most mice) trigger
  // Use/Reload while walking Map 1 with it enabled, reusing the real bound key via a
  // synthetic keydown/keyup pair rather than duplicating each action's
  // own handler logic. The same hand already on the mouse can reach
  // these without ever touching the keyboard.
  window.addEventListener('mousedown', (e) => {
    if (!game.settings.oneHandedLayout || !game.buildMode?.tryMode?.active) return
    const action = e.button === 3 ? 'use' : e.button === 4 ? 'reload' : null
    if (!action) return
    e.preventDefault()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: getKeyFor(action) }))
  })
  window.addEventListener('mouseup', (e) => {
    if (!game.settings.oneHandedLayout || !game.buildMode?.tryMode?.active) return
    const action = e.button === 3 ? 'use' : e.button === 4 ? 'reload' : null
    if (!action) return
    window.dispatchEvent(new KeyboardEvent('keyup', { code: getKeyFor(action) }))
  })

  // Fullscreen button - a real button instead of expecting players to
  // know the F11 shortcut. Label/state driven off the actual
  // document.fullscreenElement, not a settings flag - fullscreen can also
  // be exited via Esc or F11 outside game button, and there's no reliable
  // way to auto-re-enter it on page load anyway (Fullscreen API requires
  // a real user gesture), so game deliberately isn't a persisted setting.
  if (game.fullscreenBtn) {
    const updateFullscreenBtnLabel = () => {
      game.fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Enter Fullscreen'
    }
    updateFullscreenBtnLabel()
    document.addEventListener('fullscreenchange', updateFullscreenBtnLabel)
    game.fullscreenBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      } else {
        // Rejects (rather than throwing) if fullscreen isn't allowed here
        // - e.g. embedded in an iframe without the allowfullscreen
        // attribute - nothing useful to do about that from inside the
        // page, so just swallow it rather than showing a broken toast.
        document.documentElement.requestFullscreen().catch(() => {})
      }
    })
  }

  // Fullscreen visibly enlarges the homepage - no browser chrome left to
  // subtract from the viewport, and it's often a genuinely wider screen
  // than whatever window the player was just looking at. #menu-layout's
  // width/max-width (see that rule's own comment) is meant to just avoid
  // forcing horizontal overflow on a narrow screen, not to actively grow
  // things on a wide one, so game wasn't intentional. Rather than
  // guessing one fixed "not too big" cap, zoom #menu back down on
  // entering fullscreen so it renders at the exact same size it was
  // just before - same viewport-independent-size intent as
  // html.large-text-mode's fixed zoom elsewhere, just computed live here
  // instead of a constant. Triggers on fullscreenchange (not the
  // button's own click handler above) so it applies the same way
  // whether fullscreen was entered via that button, F11, or the
  // browser's own menu/shortcut.
  //
  // Measures #menu-layout's own rendered WIDTH, not window.innerWidth -
  // a straight viewport-width ratio undershoots badly, because
  // #menu-layout/#menu-title-img/#play-btn each have their own
  // min()/percentage caps that kick in at different breakpoints (e.g.
  // the logo is already pinned to its 850px ceiling well before 1600px
  // wide, but nowhere near it at 900px) - the relationship between
  // viewport width and any given element's rendered width isn't linear,
  // so only measuring the actual element before/after gives the right
  // factor.
  let _lastMenuLayoutWidth = null
  const _trackMenuLayoutWidth = () => {
    if (!document.fullscreenElement && game.menuLayout) {
      _lastMenuLayoutWidth = game.menuLayout.getBoundingClientRect().width
    }
  }
  game.menuLayout = document.getElementById('menu-layout')
  _trackMenuLayoutWidth()
  window.addEventListener('resize', _trackMenuLayoutWidth)
  document.addEventListener('fullscreenchange', () => {
    if (!game.menu || !game.menuLayout) return
    if (document.fullscreenElement) {
      // Clear any stale zoom first so the next frame's measurement is
      // the natural (unzoomed) fullscreen size, then compute the ratio
      // against it.
      game.menu.style.zoom = ''
      requestAnimationFrame(() => {
        const naturalWidth = game.menuLayout.getBoundingClientRect().width
        if (_lastMenuLayoutWidth && naturalWidth) {
          game.menu.style.zoom = Math.min(1, _lastMenuLayoutWidth / naturalWidth)
        }
      })
    } else {
      game.menu.style.zoom = ''
    }
  })


  if (game.whatsNewEveryLaunchToggle) {
    game.whatsNewEveryLaunchToggle.checked = game.settings.whatsNewEveryLaunch
    game.whatsNewEveryLaunchToggle.addEventListener('change', () => {
      game.settings.whatsNewEveryLaunch = game.whatsNewEveryLaunchToggle.checked
      saveSettings(game.settings)
    })
  }

}

export function _applyGrainIntensity(game) {
  const alpha = ((game.settings.grainIntensity ?? 100) / 100) * 0.1
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 ${alpha} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
  document.documentElement.style.setProperty('--grain-texture', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
}

// Scoped to just the sliders/toggles this batch's Graphics tab actually
// owns (not nickname/audio/controls) - reload is the same low-risk
// pattern _restoreDefaultSettings already uses, simpler and more
// reliable than re-applying every live graphics effect by hand.
// "Reset <tab> to Defaults" - every tab but Language has one at its
// bottom. Each list is the settings shown on that tab (keep it in step
// when a setting is added to or moved between tabs). Saves then reloads,
// same reload-to-resync reason as _restoreDefaultSettings below.
export const TAB_RESET_KEYS = {
  general: ['hudFpsCounter', 'friendPresenceNotify', 'achievementToasts', 'rankUpToasts', 'leaderboardRankAlerts',
    'weeklyChallengeReminder', 'lowCurrencyReminder', 'timeFormat', 'autoSaveFrequencySec', 'backupReminder',
    'confirmSignOut', 'stayEmbedSignedIn', 'anonymousLeaderboard', 'shareTelemetry', 'autoDeclineFriendRequests',
    'exactLastSeen', 'rememberSettingsTab', 'confirmRemoveFriend', 'reduceBgEffects', 'disasterBreakAll', 'homepageGreeting',
    'oneHandedLayout', 'whatsNewEveryLaunch'],
  audio: ['masterVolume', 'sfxVolume', 'ambientVolume', 'zombieVolume', 'muteOnTabBlur', 'positionalAudio', 'mutedBeforeVolumes'],
  graphics: ['performanceMode', 'renderResolution', 'fpsCap', 'autoQuality', 'brightness', 'contrast', 'shadowsEnabled',
    'shadowQuality', 'viewDistance', 'grainIntensity', 'panelFlickerEnabled', 'liteTextures', 'graphicsLevel'],
  controls: ['sensitivity', 'invertY', 'fov', 'invertScrollWeaponSwitch', 'crosshairColor', 'crosshairSize',
    'crosshairStyle', 'damageNumbers', 'zombieNameTags', 'sprintMode', 'autoJump', 'battleView', 'autoPickup', 'confirmRareDrop',
    'skinDesignerHighContrast', 'darkAreaBoost', 'colorblindRarity',
    'colorblindMode', 'largeTextMode', 'dyslexiaFont',
    'highContrastMode', 'focusRingMode', 'underlineLinks', 'textSpacing', 'buttonSize', 'reduceTransparency',
    'hoverAudioCue', 'highVisCursor', 'captionBackground', 'reduceFlashing', 'streamSafeMode', 'toastDuration',
    'uiFont', 'themePreset', 'cursorTrail', 'crtScanlines', 'nicknameColor', 'accentColor', 'playBtnColor',
    'nicknameFont', 'layoutDensity', 'navOrder', 'bgMood', 'weatherParticles', 'homepageFpsCounter'],
}

export function _resetSettingsTab(game, page) {
  const keys = TAB_RESET_KEYS[page]
  if (!keys) return
  const defaults = defaultSettings()
  for (const key of keys) game.settings[key] = defaults[key]
  saveSettings(game.settings)
  if (page === 'controls') resetBindings()
  logSettingChange(t('settingsLogResetTab', { tab: document.getElementById(`tab-${page}`)?.textContent || page }), '', '')
  window.location.reload()
}

export function _resetGraphicsDefaults(game) {
  _resetSettingsTab(game, 'graphics')
}

export function _applyGraphicsFilters(game) {
  if (!game.canvas) return
  // No filter at all at the defaults - even an identity CSS filter
  // (brightness(100%) contrast(100%)) makes the browser run the whole
  // canvas through an extra filter pass every frame (2026-09-30).
  const neutral = Number(game.settings.brightness) === 100 && Number(game.settings.contrast) === 100
  game.canvas.style.filter = neutral ? 'none' : `brightness(${game.settings.brightness}%) contrast(${game.settings.contrast}%)`
}

// Shadows are forced off by Performance Mode/LOW_QUALITY_MODE regardless
// of the Graphics tab's own toggle (same precedent as bloom/render-scale
// in _applyPerformanceMode) - this is the single source of truth both
// that method and the Graphics toggle's own change handler call into,
// so they can't disagree.
// Deliberately does NOT also check !LOW_QUALITY_MODE (unlike bloom/AA/
// materials, which stay hardcoded off under it) - LOW_QUALITY_MODE is
// true in this build (see QualitySettings.js), and shadowsEnabled's own
// default is false to match its previous always-off behavior, so
// out-of-box nothing changes for anyone who never opens the Graphics
// tab. But a real user-facing "Shadows" checkbox that can never
// actually turn shadows on is inert UI, not a real setting - so an
// explicit opt-in here is allowed to win, same as it would with
// LOW_QUALITY_MODE off. Performance Mode still forces shadows off
// regardless, same precedent as before.
export function _resolveShadowsEnabled(game) {
  return game.settings.shadowsEnabled && !game.settings.performanceMode
}

// Settings > Graphics level: the level plus the Graphics tab options it
// sets (they stay changeable afterwards). BuildMode follows the rest
// (graphicsLook) on its next frame.
export function _applyGraphicsLevel(game, level) {
  const look = LEVEL_LOOK[level]
  if (!look) return
  const s = game.settings
  if (s.graphicsLevel !== level) logSettingChange(t('settingsLogGraphicsLevel'), s.graphicsLevel ? t(`gfxLevel${s.graphicsLevel.charAt(0).toUpperCase()}${s.graphicsLevel.slice(1)}`) : '', t(`gfxLevel${level.charAt(0).toUpperCase()}${level.slice(1)}`))
  s.graphicsLevel = level
  s.viewDistance = look.view
  s.shadowsEnabled = look.shadows
  s.shadowQuality = look.shadowQuality
  s.renderResolution = look.res ?? 100
  // (Not yet while the game is still being built - it reads this then.)
  if (game.buildMode) {
    game._userResScale = s.renderResolution / 100
    game._applyRenderScale?.()
  }
  if (game.gfxResolutionSlider) {
    game.gfxResolutionSlider.value = s.renderResolution
    game.gfxResolutionValue.textContent = `${s.renderResolution}%`
  }
  if (game.gfxViewDistanceSelect) game.gfxViewDistanceSelect.value = s.viewDistance
  if (game.gfxShadowsToggle) game.gfxShadowsToggle.checked = s.shadowsEnabled
  if (game.gfxShadowQualitySelect) game.gfxShadowQualitySelect.value = s.shadowQuality
  if (game.renderer) game.renderer.shadowMap.enabled = _resolveShadowsEnabled(game)
  _applyShadowQuality(game)
  if (game.buildMode) {
    game.buildMode._autoView = null
    game.buildMode._shadowsDirty = true
  }
  saveSettings(s)
  _renderGraphicsLevels(game)
}

// One card per level: a real picture of the game at that level, its name,
// what it adds, and a tag on the one that fits this device.
export function _renderGraphicsLevels(game) {
  const box = document.getElementById('gfx-level-cards')
  if (!box) return
  const cap = (id) => id[0].toUpperCase() + id.slice(1)
  box.replaceChildren(...GRAPHICS_LEVELS.map((id) => {
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'gfx-level-card'
    card.dataset.level = id
    card.setAttribute('role', 'radio')
    const on = game.settings.graphicsLevel === id
    card.setAttribute('aria-checked', String(on))
    card.classList.toggle('active', on)
    const pic = document.createElement('span')
    pic.className = 'gfx-level-pic'
    pic.style.backgroundImage = `url('/images/graphics-${id}.webp')`
    const name = document.createElement('span')
    name.className = 'gfx-level-name'
    name.textContent = t(`gfxLevel${cap(id)}`)
    const text = document.createElement('span')
    text.className = 'gfx-level-text'
    text.textContent = t(`gfxLevel${cap(id)}Text`)
    card.append(pic, name, text)
    if (game._deviceGraphicsLevel === id) {
      const tag = document.createElement('span')
      tag.className = 'gfx-level-tag'
      tag.textContent = t('gfxLevelRecommended')
      card.append(tag)
    }
    card.addEventListener('click', () => {
      game.settings.graphicsLevelAuto = false
      _applyGraphicsLevel(game, id)
    })
    return card
  }))
}

export function _applyShadowQuality(game) {
  const sizes = { low: 512, medium: 1024, high: 2048 }
  const size = sizes[game.settings.shadowQuality] || 1024
  const sun = game.buildMode?.sunLight
  if (sun && sun.shadow) {
    sun.shadow.mapSize.set(size, size)
    // mapSize only takes effect once the shadow map's own render target
    // is (re)built - forcing that via needsUpdate.
    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }
    sun.shadow.needsUpdate = true
    game.buildMode._shadowsDirty = true
  }
}

// Homepage Nav Order (Controls tab) - up/down reordering of the homepage
// buttons, applied purely via CSS `order` on the real buttons
// (#menu-nav-buttons is already flex-column, see style.css) rather than
// touching the DOM structure, so every button's own click
// listener/id/state is untouched. The list is read from the real
// buttons every time, so a button added to index.html later shows up
// here (and keeps its index.html spot) without anyone updating a list.
function _navButtons() {
  const nav = document.getElementById('menu-nav-buttons')
  return nav ? [...nav.children].filter((el) => el.tagName === 'BUTTON' && el.id) : []
}

// The saved order (ids) merged with the buttons that really exist: ids
// that no longer exist are dropped, and a button the save doesn't know
// yet goes right after the button it follows in index.html. Same
// algorithm as the inline nav anti-flash script in index.html.
export function _navOrderIds(game) {
  const domIds = _navButtons().map((b) => b.id)
  const out = (game.settings.navOrder || []).map((id) => NAV_ID_RENAMES[id] || id).filter((id, i, arr) => domIds.includes(id) && arr.indexOf(id) === i)
  domIds.forEach((id, i) => {
    if (out.includes(id)) return
    let k = -1
    for (let p = i - 1; p >= 0 && k < 0; p--) k = out.indexOf(domIds[p])
    out.splice(k + 1, 0, id)
  })
  return out
}

function _navLabel(id) {
  const span = document.querySelector(`#${id} > span:not(.nav-badge-dot):not(.coming-soon-pill)`)
  return span ? span.textContent.trim() : id
}

export function _renderNavOrderList(game) {
  if (!game.navOrderList) return
  const ids = _navOrderIds(game)
  game.navOrderList.innerHTML = ids.map((id, i) => `
    <div class="nav-order-row" data-id="${id}">
      <span>${_escapeHtml(_navLabel(id))}</span>
      <div class="nav-order-btns">
        <button class="mini-action-btn nav-order-up" type="button" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="mini-action-btn nav-order-down" type="button" ${i === ids.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    </div>
  `).join('')
  for (const row of game.navOrderList.querySelectorAll('.nav-order-row')) {
    const id = row.dataset.id
    row.querySelector('.nav-order-up').addEventListener('click', () => game._moveNavOrder(id, -1))
    row.querySelector('.nav-order-down').addEventListener('click', () => game._moveNavOrder(id, 1))
  }
}

export function _moveNavOrder(game, id, delta) {
  const ids = _navOrderIds(game)
  const i = ids.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  game.settings.navOrder = ids
  saveSettings(game.settings)
  game._renderNavOrderList()
  game._applyNavOrder()
}

export function _applyNavOrder(game) {
  _navOrderIds(game).forEach((id, i) => {
    const btn = document.getElementById(id)
    if (btn) btn.style.order = i
  })
}

// Settings Search - filters .audio-row rows within whichever tab is
// currently active by their <label> text (case-insensitive substring),
// same filter-by-visible-text approach the Achievements/Bestiary filter
// boxes already use. Doesn't cross tabs - a match on a different tab's
// setting stays hidden until that tab is opened, same as this panel's
// existing tab-based organization.
export function _bindSettingsSearch(game) {
  if (!game.settingsSearchInput) return
  game.settingsSearchInput.addEventListener('click', (e) => e.stopPropagation())
  game.settingsSearchInput.addEventListener('input', () => {
    const filter = game.settingsSearchInput.value.trim().toLowerCase()
    const activePage = document.querySelector('.settings-page:not([style*="display: none"])')
    if (!activePage) return
    for (const row of activePage.querySelectorAll('.audio-row')) {
      const label = row.querySelector('label')?.textContent.toLowerCase() || ''
      const matches = !filter || label.includes(filter)
      row.style.display = matches ? '' : 'none'
      // A <details> (see the Advanced disclosure in Personalization)
      // hides its content via the UA's own collapsed state, ignoring a
      // child's own `display` override entirely - a real filter match
      // inside one would otherwise stay invisible even though game loop
      // just un-hid it. Auto-expand on a real match; leave collapsed
      // state alone when the search is cleared rather than re-collapsing
      // it out from under someone who opened it on purpose.
      const details = row.closest('details')
      if (details && matches && filter) details.open = true
    }
  })
}

export function _bindControlsTab(game) {
  // Nothing in Settings can be selected (2026-10-17, Gaymi: "make all not
  // be able to select the text but still clickable"): the rest of the page
  // already can't be (style.css), and in its text boxes - codes, names,
  // search - you can still click, type and paste, but a selection
  // collapses straight away.
  document.getElementById('settings-panel')?.addEventListener('select', (e) => {
    const box = e.target
    if (typeof box?.setSelectionRange !== 'function' || box.selectionStart === box.selectionEnd) return
    try {
      box.setSelectionRange(box.selectionEnd, box.selectionEnd)
    } catch {
      // Not a text box (number/colour inputs have no selection).
    }
  }, true)
  game._renderControlsGrid()
  game._renderNavOrderList()
  game._applyNavOrder()
  game._bindSettingsSearch()
  game.restoreDefaultsBtn.addEventListener('click', () => game._restoreDefaultSettings())
  if (game.exportKeybindsBtn) game.exportKeybindsBtn.addEventListener('click', () => game._exportKeybindsCode())
  if (game.importKeybindsBtn) {
    game.importKeybindsBtn.addEventListener('click', () => {
      game.importKeybindsInput.style.display = 'inline-block'
      game.importKeybindsApplyBtn.style.display = 'inline-block'
      game.importKeybindsInput.focus()
    })
  }
  if (game.importKeybindsApplyBtn) {
    game.importKeybindsApplyBtn.addEventListener('click', () => game._importKeybindsCode(game.importKeybindsInput.value))
  }
  // Per-tab resets (General/Audio/Controls; Graphics has its own button
  // bound in the Graphics tab) - see _resetSettingsTab.
  if (game.resetGeneralDefaultsBtn) game.resetGeneralDefaultsBtn.addEventListener('click', () => game._resetSettingsTab('general'))
  if (game.resetAudioDefaultsBtn) game.resetAudioDefaultsBtn.addEventListener('click', () => game._resetSettingsTab('audio'))
  if (game.resetControlsDefaultsBtn) game.resetControlsDefaultsBtn.addEventListener('click', () => game._resetSettingsTab('controls'))
  bindResetConfirms()
  game._updateStorageUsageLine()
  game.exportSaveBtn.addEventListener('click', () => game._exportSave())
  game.importSaveBtn.addEventListener('click', () => game.importSaveInput.click())
  game.importSaveInput.addEventListener('change', () => game._importSaveFile(game.importSaveInput.files[0]))
  if (game.exportSettingsCodeBtn) game.exportSettingsCodeBtn.addEventListener('click', () => game._exportSettingsCode())
  if (game.importSettingsCodeBtn) {
    game.importSettingsCodeBtn.addEventListener('click', () => {
      game.importSettingsCodeInput.style.display = 'inline-block'
      game.importSettingsCodeApplyBtn.style.display = 'inline-block'
      game.importSettingsCodeInput.focus()
    })
  }
  if (game.importSettingsCodeApplyBtn) {
    game.importSettingsCodeApplyBtn.addEventListener('click', () => game._importSettingsCode(game.importSettingsCodeInput.value))
  }
}

// Restore Default Settings - a full reload after saving the defaults, so
// every scattered per-slider/per-checkbox UI-sync call (there's no single
// "apply all settings to the DOM" function to call instead) re-runs
// correctly from a clean construction, same reload-to-resync precedent
// Hardcore Mode's respawn already uses.
export function _restoreDefaultSettings(game) {
  // playerId carried over explicitly - unlike nickname (which
  // legitimately goes back to blank here, an existing precedent),
  // wiping the account's corner-badge ID on a settings reset would be
  // a surprising identity change, not just a preference reset.
  // Locked skins stay locked too - that's about your stuff, not a setting.
  saveSettings({ ...defaultSettings(), playerId: game.settings.playerId, lockedSkins: game.settings.lockedSkins })
  logSettingChange(t('settingsLogResetAll'), '', '')
  window.location.reload()
}

// Local Sharing batch - Save Export/Import/Compare, all built on the
// fact that this page uses localStorage for nothing else - a full
// backup is just every key/value pair, no need to enumerate every
// individual system's own storage key.
export function _exportSave(game) {
  const data = game._snapshotLocalSave()
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const link = document.createElement('a')
  link.download = `gayz-save-${Date.now()}.json`
  link.href = URL.createObjectURL(blob)
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  game._showLoreToast(t('saveExported'))
  game.settings.lastExportAt = Date.now()
  saveSettings(game.settings)
}

// Shareable Settings Code - just the whitelisted preference fields (see
// SETTINGS_CODE_KEYS), base64-encoded. Distinct from Export Save (full
// fidelity, includes progress/identity, downloads a file) - this is
// meant to be pasted into a chat message.
export function _exportSettingsCode(game) {
  const payload = {}
  for (const key of SETTINGS_CODE_KEYS) payload[key] = game.settings[key]
  const code = btoa(JSON.stringify(payload))
  if (!navigator.clipboard) {
    game._showLoreToast(t('clipboardCopyUnsupported'))
    return
  }
  navigator.clipboard.writeText(code)
    .then(() => game._showLoreToast(t('settingsCodeCopied')))
    .catch(() => game._showLoreToast(t('clipboardCopyUnsupported')))
}

export function _importSettingsCode(game, code) {
  let payload
  try {
    payload = JSON.parse(atob(code.trim()))
  } catch {
    game._showLoreToast(t('settingsCodeInvalid'))
    return
  }
  for (const key of SETTINGS_CODE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) game.settings[key] = payload[key]
  }
  saveSettings(game.settings)
  window.location.reload()
}

// Export/Import Keybinds Code - just the rebindable action->key map
// (see Keybinds.js's getAllBindings/setAllBindings), separate from the
// wider Settings Code above (which deliberately excludes keybinds
// entirely - two different things to share independently).
export function _exportKeybindsCode(game) {
  const code = btoa(JSON.stringify(getAllBindings()))
  if (!navigator.clipboard) {
    game._showLoreToast(t('clipboardCopyUnsupported'))
    return
  }
  navigator.clipboard.writeText(code)
    .then(() => game._showLoreToast(t('keybindsCodeCopied')))
    .catch(() => game._showLoreToast(t('clipboardCopyUnsupported')))
}

export function _importKeybindsCode(game, code) {
  let payload
  try {
    payload = JSON.parse(atob(code.trim()))
  } catch {
    game._showLoreToast(t('keybindsCodeInvalid'))
    return
  }
  setAllBindings(payload)
  game._renderControlsGrid()
  game._applyLanguage() // text shows keys via {key:...} - refresh it
  game._showLoreToast(t('keybindsCodeApplied'))
}

// Overwrites every current key - same "irreversible, needs a real
// confirm dialog" bar as Prestige/Respec, plus a full reload afterward
// (every system reads its state fresh from localStorage at
// construction, not via some live-refresh path). Shared with the
// Cloud Save "Use Cloud Save" flow -
// one path for "replace all local data with this parsed blob and
// reload", regardless of whether the blob came from an uploaded file or
// Google Drive.
// Real bug found 2026-09-26 while investigating a report of stats being
// wrong right after a cloud restore: this function's own reload triggers
// the beforeunload event below, and that handler unconditionally saves
// shopProgress/careerStats from THIS PAGE'S in-memory (pre-restore)
// values - silently overwriting the data/coins just written a moment
// earlier, before the reload actually takes effect. The periodic
// settings autosave timer is the same hazard on a longer fuse. Both are
// real writes to localStorage that race the reload, not just something
// that looks wrong and self-corrects - reproduced directly (not just
// theorized) by calling this with mock cloud data and checking what
// localStorage actually held after the reload: the restored coins value
// was gone, replaced by the old pre-restore one. _importingSave is
// checked by both beforeunload handlers below to skip their save while
// this is in flight, and the timer is stopped outright since there's no
// reason for it to fire again before the reload completes anyway.
export function _applyImportedSaveData(game, data) {
  game._importingSave = true
  if (game._autoSaveTimer) clearInterval(game._autoSaveTimer)
  // This device's own Cloud Save bookkeeping stays (2026-10-23): a file
  // exported elsewhere carries that device's sync state, and with it the
  // next sync treated the imported progress as "already in the cloud" and
  // let the cloud copy win. Kept as this device's, the import counts as a
  // change made here now, so it's what gets uploaded.
  const deviceOnly = {}
  for (const key of DEVICE_ONLY_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) deviceOnly[key] = value
  }
  localStorage.clear()
  for (const [key, value] of Object.entries(data)) if (!DEVICE_ONLY_KEYS.has(key)) localStorage.setItem(key, value)
  for (const [key, value] of Object.entries(deviceOnly)) localStorage.setItem(key, value)
  localStorage.setItem(LAST_LOCAL_CHANGE_KEY, String(Date.now()))
  window.location.reload()
}

export async function _importSaveFile(game, file) {
  if (!file) return
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    game._showLoreToast(t('saveFileInvalid'))
    return
  }
  if (!window.confirm(t('saveImportConfirm'))) return
  game._applyImportedSaveData(data)
}

// Same {key: stringValue} snapshot _exportSave() downloads as a file,
// just returned in-memory for Cloud Save's push instead - one source of
// truth for "what does a save blob contain."
export function _snapshotLocalSave(_game) {
  const data = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    data[key] = localStorage.getItem(key)
  }
  return data
}

export function _renderControlsGrid(game) {
  game.controlsGrid.innerHTML = ACTIONS.map((a) => `
    <span class="control-label">${t(a.labelKey)}</span>
    <button class="control-key-btn" data-action="${a.id}">${keyLabel(getKeyFor(a.id))}</button>
  `).join('')

  for (const btn of game.controlsGrid.querySelectorAll('.control-key-btn')) {
    btn.addEventListener('click', () => game._startRebind(btn, btn.dataset.action))
  }
}

// Puts one button into "listening" mode, capturing the next keydown
// anywhere as the new binding for that action (Escape cancels).
export function _startRebind(game, btn, action) {
  if (game.rebindingAction) return
  game.rebindingAction = action
  btn.textContent = t('pressAnyKey')
  btn.classList.add('listening')

  const handler = (e) => {
    e.preventDefault()
    window.removeEventListener('keydown', handler, true)
    game.rebindingAction = null
    // Digit1-9/0 (the hotbar) and Tab are hardcoded key.code checks outside the rebindable
    // ACTIONS list - allowing an action to be remapped onto one of them
    // wouldn't move it there, it would just make both fire together on
    // every press (e.g. rebinding Reload to "1" would reload AND switch
    // to hotbar slot 1 every time). Treated the same as Escape: cancels
    // the rebind and keeps the previous key instead.
    const reserved = e.code === 'Tab' || /^Digit[1-5]$/.test(e.code)
    // Keybind collision detection - previously two actions could silently
    // share one key (only the first in the dispatch if/else-if chain
    // would ever actually fire), with no warning at rebind time.
    const collision = ACTIONS.find((a) => a.id !== action && getKeyFor(a.id) === e.code)
    if (e.code !== 'Escape' && !reserved) {
      if (collision) game._showLoreToast(t('keybindCollision', { key: keyLabel(e.code) }))
      else {
        const was = getKeyFor(action)
        setBinding(action, e.code)
        if (was !== e.code) logSettingChange(t(ACTIONS.find((a) => a.id === action)?.labelKey || action), keyLabel(was), keyLabel(e.code))
      }
    }
    game._renderControlsGrid()
    game._applyLanguage() // text shows keys via {key:...} - refresh it
  }
  window.addEventListener('keydown', handler, true)
}

// Reset warning (2026-10-17, Gaymi: "add a warning when reseting something
// then they can reset"). A capture listener on each reset button runs
// before its own click handler and swallows the first click, opening the
// themed #reset-confirm-modal; Reset re-clicks the button with the flag
// set so the button's normal handler runs untouched.
const RESET_CONFIRMS = {
  'reset-general-defaults-btn': 'resetConfirmGeneral',
  'reset-audio-defaults-btn': 'resetConfirmAudio',
  'reset-graphics-defaults-btn': 'resetConfirmGraphics',
  'reset-controls-defaults-btn': 'resetConfirmControls',
  'restore-defaults-btn': 'resetConfirmAll',
  'accent-color-reset-btn': 'resetConfirmAccent',
  'play-btn-color-reset-btn': 'resetConfirmPlayBtn',
}

let resetConfirmAction = null

function closeResetConfirm() {
  const modal = document.getElementById('reset-confirm-modal')
  if (modal) modal.classList.remove('open')
  resetConfirmAction = null
}

export function openResetConfirm(message, onYes) {
  const modal = document.getElementById('reset-confirm-modal')
  if (!modal) { onYes(); return }
  document.getElementById('reset-confirm-title').textContent = t('resetConfirmTitle')
  document.getElementById('reset-confirm-text').textContent = message
  document.getElementById('reset-confirm-cancel-btn').textContent = t('resetConfirmCancel')
  document.getElementById('reset-confirm-ok-btn').textContent = t('resetConfirmOk')
  resetConfirmAction = onYes
  modal.classList.add('open')
  document.getElementById('reset-confirm-cancel-btn').focus()
}

function bindResetConfirms() {
  const modal = document.getElementById('reset-confirm-modal')
  if (!modal || modal.dataset.bound) return
  modal.dataset.bound = '1'
  document.getElementById('reset-confirm-cancel-btn').addEventListener('click', closeResetConfirm)
  document.getElementById('reset-confirm-ok-btn').addEventListener('click', () => {
    const action = resetConfirmAction
    closeResetConfirm()
    if (action) action()
  })
  // Clicking the dark backdrop or pressing Escape cancels. Escape is
  // stopped here so it doesn't also close the Settings panel behind.
  modal.addEventListener('click', (e) => { if (e.target === modal) closeResetConfirm() })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !modal.classList.contains('open')) return
    e.stopImmediatePropagation()
    e.preventDefault()
    closeResetConfirm()
  }, true)
  for (const [id, key] of Object.entries(RESET_CONFIRMS)) {
    const btn = document.getElementById(id)
    if (!btn) continue
    btn.addEventListener('click', (e) => {
      if (btn.dataset.resetConfirmed) { delete btn.dataset.resetConfirmed; return }
      e.stopImmediatePropagation()
      e.preventDefault()
      openResetConfirm(t(key), () => { btn.dataset.resetConfirmed = '1'; btn.click() })
    }, true)
  }
}

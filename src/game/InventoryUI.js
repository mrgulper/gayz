// Inventory, Store and the player-to-player Market: skin and weapon card
// grids, Equip/Market/Sell/Inspect, the trade dialog, market listings and
// sales, store skins, crates, and the weapon pictures the cards show.
//
// Moved out of Game.js (2026-10-16, bit by bit - see CLAUDE.md). Plain functions
// taking `game`, all state on the Game instance; Game.js keeps a one-line
// stand-in for each, so callers are unchanged.
import { WEAPON_THUMB_IDS, WEAPON_THUMBS_VERSION } from './weaponThumbs.js'
import * as CloudSync from './CloudSync.js'
import * as THREE from 'three'
import { Game, CRATES_COMING_SOON, CRATE_ICON_SVG, CRATE_TIERS, CRATE_TIER_COLORS, INVENTORY_SKINS, SKIN_RARITIES, WEAPON_ICON_PATHS, WEAPON_THUMBS_CACHE, _escapeHtml, _safeStatNumber, saveSettings, saveShopProgress, skinFrontIconURL } from './Game.js'
import { InspectViewer } from './InspectViewer.js'
import { MenuAvatar3D, SHOP_SKIN_PREVIEW_DATA_URL, buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { addGunLights, cloneViewmodel } from './Viewmodels.js'
import { COMING_SOON_WEAPONS } from './PlayWeapons.js'
import { t } from './i18n.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

// Inventory - homepage placeholder only for now, no functionality yet
// (distinct from the in-game Tab inventory - #inventory-panel - which
// already exists and does something different: managing the run's
// equipped weapons/hotbar mid-game).
export function _openMenuInventoryPanel(game) {
  if (!game.menuInventoryPanel) return
  game._closeAllMenuPanels()
  game.menuInventoryPanel.style.display = 'flex'
  game._claimMarketSales()
  if (game.menuInventoryPanelTitle) game.menuInventoryPanelTitle.textContent = t('menuInventoryPanelTitle')
  if (game.inventoryTabCharacter) game.inventoryTabCharacter.textContent = t('inventorySkinsTitle')
  if (game.inventoryTabCrates) game.inventoryTabCrates.textContent = t('inventoryCratesTitle')
  if (game.inventoryTabWeapons) game.inventoryTabWeapons.textContent = t('inventoryWeaponsTitle')
  if (game.inventoryTabPets) game.inventoryTabPets.textContent = t('inventoryPetsTitle')
  game._renderCrateTiers()
  if (game.invSkinSearch) {
    game.invSkinSearch.value = ''
    game.invSkinSearch.placeholder = t('inventorySkinSearch')
  }
  game._renderInventorySkins()
  game._renderInventorySkinPreview()
  game._renderInventoryWeapons()
  // Always reopen on the Character tab - simpler than remembering the
  // last-used one, and matches game panel's own approved design.
  for (const tabEl of document.querySelectorAll('.inventory-tab')) tabEl.classList.toggle('active', tabEl === game.inventoryTabCharacter)
  for (const page of document.querySelectorAll('.inventory-tab-page')) page.style.display = page.id === 'inventory-page-character' ? 'block' : 'none'
}

export async function _loadMarketListings(game) {
  if (!game.__marketBackendForTests && !CloudSync.isConfigured()) {
    game._marketListings = 'error'
    game._renderShopMarket()
    return
  }
  try {
    game._marketListings = await game._marketApi().fetchActiveMarketListings()
  } catch (err) {
    console.warn('Market listings failed to load', err)
    game._marketListings = 'error'
  }
  if (game.marketPanel?.style.display !== 'none') game._renderShopMarket()
}

// Market panel (its own nav button, right under Store): opened like every
// other menu panel.
export function _openMarketPanel(game) {
  game._closeAllMenuPanels()
  if (!game.marketPanel) return
  game.marketPanel.style.display = 'flex'
  if (game.marketPanelTitle) game.marketPanelTitle.textContent = t('skinModeMarket')
  game._authReadyPromise?.then(() => game._renderSignInFooters())
  game._marketQuery = ''
  game._marketItems = null
  game._marketRarity = 'all'
  if (game.marketSearch) {
    game.marketSearch.value = ''
    game.marketSearch.placeholder = t('marketSearchPlaceholder')
  }
  game._closeMarketFilterMenus()
  game._renderMarketFilters()
  // The listings fetched in the background (or on the last visit) show
  // straight away and are refreshed underneath - no "Loading the
  // Market..." line first (2026-10-11). A failed earlier fetch is
  // retried instead of shown.
  if (game._marketListings === 'error') game._marketListings = null
  game._renderShopMarket()
  game._loadMarketListings()
  game._claimMarketSales()
}

export function _renderMarketFilters(game) {
  const items = game._marketItemOptions()
  const ticked = game._marketItems || new Set(items.map((i) => i.id))
  if (game.marketItemFilterBtn) {
    const count = items.filter((i) => ticked.has(i.id)).length
    game.marketItemFilterBtn.textContent = count === items.length
      ? t('marketItemsAll')
      : t('marketItemsCount', { n: count })
  }
  if (game.marketItemFilterMenu) {
    game.marketItemFilterMenu.innerHTML = items.map((i) =>
      `<button type="button" class="market-filter-option${ticked.has(i.id) ? ' checked' : ''}" data-market-item="${_escapeHtml(i.id)}">`
      + `<span class="market-check"></span><span>${_escapeHtml(i.label)}</span></button>`).join('')
  }
  game._renderRarityFilter(game.marketRarityFilterBtn, game.marketRarityFilterMenu, game._marketRarity)
}

// The All rarities dropdown - the Market's, and Inventory > Character's
// beside its search bar (2026-10-10).
export function _renderRarityFilter(_game, btn, menu, current) {
  // Mythic left out - no skin uses it.
  const rarities = ['all', ...Object.keys(SKIN_RARITIES).filter((r) => r !== 'mythic')]
  const rarityLabel = (r) => (r === 'all' ? t('marketRarityAll') : t(SKIN_RARITIES[r].key))
  if (btn) btn.textContent = rarityLabel(current)
  if (menu) {
    menu.innerHTML = rarities.map((r) =>
      `<button type="button" class="market-filter-option${r === current ? ' active' : ''}" data-market-rarity="${r}"`
      + (r === 'all' ? '' : ` style="color: ${SKIN_RARITIES[r].color}"`) + `>${_escapeHtml(rarityLabel(r))}</button>`).join('')
  }
}

export function _closeMarketFilterMenus(game) {
  for (const [btn, menu] of [[game.marketItemFilterBtn, game.marketItemFilterMenu], [game.marketRarityFilterBtn, game.marketRarityFilterMenu], [game.invRarityFilterBtn, game.invRarityFilterMenu], [document.getElementById('quest-rarity-filter-btn'), document.getElementById('quest-rarity-filter-menu')]]) {
    if (menu) menu.style.display = 'none'
    if (btn) btn.classList.remove('open')
  }
}

export function _toggleMarketFilterMenu(game, btn, menu) {
  const opening = menu.style.display === 'none'
  game._closeMarketFilterMenus()
  if (opening) {
    menu.style.display = 'block'
    btn.classList.add('open')
  }
}

export function _closeMarketPanel(game) {
  if (game.marketPanel) game.marketPanel.style.display = 'none'
}

// Market panel grid: a card per skin with its price (or Owned); clicking
// one buys it. Same card look as Inventory > Character.
export function _renderShopMarket(game) {
  if (!game.shopMarketGrid) return
  if (game._marketListings === null) {
    game.shopMarketGrid.innerHTML = ''
    return
  }
  if (game._marketListings === 'error') {
    game.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('marketError'))}</p>`
    return
  }
  if (!game._marketListings.length) {
    game.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('marketEmpty'))}</p>`
    return
  }
  const query = game._marketQuery.trim().toLowerCase()
  const entries = game._marketSkinEntries().filter((skin) =>
    (!query || skin.name.toLowerCase().includes(query))
    && (!game._marketItems || game._marketItems.has(skin.kind || 'character'))
    && (game._marketRarity === 'all' || skin.rarity === game._marketRarity))
  if (!entries.length) {
    game.shopMarketGrid.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('skinNoMatch'))}</p>`
    return
  }
  // Seller names come from other players' writes - escaped like any
  // other untrusted text.
  game.shopMarketGrid.innerHTML = entries.map((skin) => {
    const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
    const classes = ['inv-skin-card']
    if (skin.mine) classes.push('owned')
    else if (game.coins < skin.price) classes.push('cant-afford')
    const label = skin.mine ? t('marketYours') : game._formatSkinPrice('coins', skin.price)
    const listingId = String(skin.listing.id).replace(/[^A-Za-z0-9_-]/g, '')
    return `<button type="button" class="${classes.join(' ')}" data-market-listing="${listingId}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${skin.name} - ${t(rarity.key)}`)}">`
      + `<span class="inv-skin-card-name">${_escapeHtml(skin.name)}</span>`
      + '<img class="inv-skin-card-img" alt="" draggable="false" />'
      + `<span class="market-card-seller">${_escapeHtml(t('marketSellerBy', { name: String(skin.listing.sellerName || '').slice(0, 24) }))}</span>`
      + `<span class="inv-skin-card-price">${_escapeHtml(skin.mine ? `${label} · ${game._formatSkinPrice('coins', skin.price)}` : label)}</span>`
      + '</button>'
  }).join('')
  for (const skin of entries) {
    skinFrontIconURL(skin.dataUrl).then((url) => {
      const listingId = String(skin.listing.id).replace(/[^A-Za-z0-9_-]/g, '')
      const img = game.shopMarketGrid.querySelector(`[data-market-listing="${listingId}"] .inv-skin-card-img`)
      if (img && url) img.src = url
    })
  }
}

// Takes one copy of a skin out of / puts one into this player's own save.
export async function _removeSkinFromInventory(game, id) {
  if (id === game._equippedInventorySkinId()) await game._equipInventorySkin('default')
  if (id === 'gaygarx') game.ownsShopSkin = false
  else game.charSkins[id] = Math.max(0, (Number(game.charSkins[id]) || 0) - 1)
}

export function _addSkinToInventory(game, id) {
  if (id === 'gaygarx') game.ownsShopSkin = true
  else game.charSkins[id] = (Number(game.charSkins[id]) || 0) + 1
}

export function _afterTradeChange(game) {
  saveShopProgress(game)
  game._renderCurrencyBar()
  if (game._renderShopSkinState) game._renderShopSkinState()
  if (game.menuInventoryPanel?.style.display !== 'none') {
    game._renderInventorySkins()
    game._renderInventorySkinPreview()
  }
  if (game.marketPanel?.style.display !== 'none') game._renderShopMarket()
}

// One Kirka-style dialog for every trade action. mode: 'list' (price
// picker), 'sell' (sell to the game), 'buy' or 'cancel' (a listing).
export function _openTradeDialog(game, mode, opts) {
  if (!game.tradeDialog) return
  game._tradeDialogState = { mode, ...opts }
  const priceMode = mode === 'list'
  game.tradeDialogPriceRow.style.display = priceMode ? '' : 'none'
  game.tradeDialogFee.style.display = priceMode ? '' : 'none'
  game.tradeDialogAction.className = `trade-action-${mode}`
  if (priceMode) {
    game.tradeDialogPrice.value = String(opts.startPrice)
    game.tradeDialogTitle.textContent = t('marketListTitle', { name: opts.name })
    game.tradeDialogAction.textContent = t('marketAddBtn')
    game._updateTradeDialogFee()
  } else if (mode === 'sell') {
    game.tradeDialogTitle.textContent = t('marketSellTitle', { name: opts.name, price: opts.priceLabel })
    game.tradeDialogAction.textContent = t('marketSellBtn')
  } else if (mode === 'buy') {
    game.tradeDialogTitle.textContent = t('marketBuyTitle', { name: opts.name, seller: opts.seller, price: opts.priceLabel })
    game.tradeDialogAction.textContent = t('marketBuyBtn')
  } else {
    game.tradeDialogTitle.textContent = t('marketCancelTitle', { name: opts.name })
    game.tradeDialogAction.textContent = t('marketCancelBtn')
  }
  game.tradeDialogAction.disabled = false
  game.tradeDialog.style.display = 'flex'
}

export function _closeTradeDialog(game) {
  if (game.tradeDialog) game.tradeDialog.style.display = 'none'
  game._tradeDialogState = null
}

export function _updateTradeDialogFee(game) {
  const fee = game._marketFee(game._tradeDialogPriceValue())
  game.tradeDialogFee.textContent = t('marketFee', { fee: fee.toLocaleString() })
}

export function _stepTradeDialogPrice(game, dir) {
  const p = game._tradeDialogPriceValue()
  const step = p >= 100000 ? 10000 : p >= 10000 ? 1000 : p >= 1000 ? 100 : 10
  game.tradeDialogPrice.value = String(Math.max(1, Math.min(10000000, p + dir * step)))
  game._updateTradeDialogFee()
}

export async function _confirmTradeDialog(game) {
  const st = game._tradeDialogState
  if (!st) return
  game.tradeDialogAction.disabled = true
  try {
    if (st.mode === 'sell') await game._sellSkinToGame(st.id)
    else if (st.mode === 'list') await game._listSkinOnMarket(st.id, game._tradeDialogPriceValue())
    else if (st.mode === 'buy') await game._buyMarketListing(st.listing)
    else if (st.mode === 'cancel') await game._cancelMarketListing(st.listing)
  } finally {
    game._closeTradeDialog()
  }
}

export async function _listSkinOnMarket(game, id, price) {
  const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
  if (!entry?.sell || !(entry.count(game) > 0) || _isSkinLocked(game, 'character', id)) return
  const uid = await game._marketUid()
  if (!uid) return
  const name = entry.nameKey ? t(entry.nameKey) : entry.name
  // Out of the inventory first, so it can't be equipped/sold twice while
  // the listing is being written; put back if the write fails.
  await game._removeSkinFromInventory(id)
  game._afterTradeChange()
  try {
    const seller = (game.settings.nickname || '').trim().slice(0, 24) || game._defaultNickname().slice(0, 24)
    await game._marketApi().createMarketListing(uid, seller, id, price)
    game._showHomepageToast(t('marketListedToast', { name }))
  } catch (err) {
    console.warn('Listing failed', err)
    game._addSkinToInventory(id)
    game._afterTradeChange()
    game._showHomepageToast(t('marketError'))
  }
}

export async function _buyMarketListing(game, listing) {
  const entry = INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
  const price = _safeStatNumber(listing.price)
  if (!entry || !(price > 0)) return
  if (game.coins < price) {
    game._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - game.coins).toLocaleString() }))
    return
  }
  const uid = await game._marketUid()
  if (!uid) return
  let bought
  try {
    bought = await game._marketApi().buyMarketListing(listing.id, uid)
  } catch (err) {
    console.warn('Buying failed', err)
    game._showHomepageToast(t('marketError'))
    return
  }
  if (!bought) {
    game._showHomepageToast(t('marketAlreadySold'))
  } else {
    game.coins -= price
    game._addSkinToInventory(entry.id)
    game._afterTradeChange()
    game._showHomepageToast(t('skinBoughtToast', { name: entry.nameKey ? t(entry.nameKey) : entry.name }))
  }
  game._loadMarketListings()
}

export async function _cancelMarketListing(game, listing) {
  const uid = await game._marketUid()
  if (!uid) return
  let cancelled
  try {
    cancelled = await game._marketApi().cancelMarketListing(listing.id, uid)
  } catch (err) {
    console.warn('Cancel failed', err)
    game._showHomepageToast(t('marketError'))
    return
  }
  const entry = INVENTORY_SKINS.find((skin) => skin.id === listing.skinId)
  if (cancelled && entry) {
    game._addSkinToInventory(entry.id)
    game._afterTradeChange()
    game._showHomepageToast(t('marketCancelledToast', { name: entry.nameKey ? t(entry.nameKey) : entry.name }))
  } else if (!cancelled) {
    game._showHomepageToast(t('marketAlreadySold'))
  }
  game._loadMarketListings()
}

// Pays the seller for listings other players bought while they were away
// - each sale is claimed in a transaction, so it pays out exactly once
// even with two devices open. Runs when the Market or Inventory opens.
export async function _claimMarketSales(game) {
  if (game._claimingMarketSales || (!game.__marketBackendForTests && !CloudSync.isConfigured())) return
  game._claimingMarketSales = true
  try {
    await game._authReadyPromise
    const uid = game._cloudUid
    if (!uid) return
    const sales = await game._marketApi().fetchUnclaimedMarketSales(uid)
    for (const sale of sales) {
      const claimed = await game._marketApi().claimMarketSale(sale.id, uid).catch(() => null)
      if (!claimed) continue
      const price = _safeStatNumber(claimed.price)
      const earned = Math.max(0, price - game._marketFee(price))
      game.coins += earned
      saveShopProgress(game)
      game._renderCurrencyBar()
      const entry = INVENTORY_SKINS.find((skin) => skin.id === claimed.skinId)
      const name = entry ? (entry.nameKey ? t(entry.nameKey) : entry.name) : String(claimed.skinId)
      game._showHomepageToast(t('marketSoldToast', { name, price: game._formatSkinPrice('coins', earned) }))
    }
  } catch (err) {
    console.warn('Collecting Market sales failed', err)
  } finally {
    game._claimingMarketSales = false
  }
}

// Lock (2026-10-30, Gaymi: a lock "under sell and above inspect" so the
// skin stays in your inventory): a locked card shows a lock on its top
// corner and can't go on the Market or be sold until it's unlocked.
const LOCK_ICON = '<svg class="inv-skin-card-lock" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2.5" y="7" width="11" height="8" rx="1.5" fill="currentColor"/></svg>'

export function _isSkinLocked(game, kind, id) {
  return (game.settings.lockedSkins || []).includes(`${kind}:${id}`)
}

export function _toggleSkinLock(game, kind, id) {
  const key = `${kind}:${id}`
  const list = (game.settings.lockedSkins || []).filter((k) => k !== key)
  const locking = list.length === (game.settings.lockedSkins || []).length
  if (locking) list.push(key)
  game.settings.lockedSkins = list
  saveSettings(game.settings)
  game._showHomepageToast(t(locking ? 'skinLockedToast' : 'skinUnlockedToast'))
  game._renderInventorySkins()
  _renderInventoryWeapons(game)
}

export function _equippedInventorySkinId(game) {
  const custom = game.settings.customSkinDataUrl
  if (!custom) return 'default'
  return INVENTORY_SKINS.find((skin) => skin.dataUrl === custom)?.id || 'custom'
}

export function _renderInventorySkins(game) {
  if (!game.inventorySkinsList) return
  game._closeInventorySkinMenu()
  const equippedId = game._equippedInventorySkinId()
  const query = (game.invSkinSearch?.value || '').trim().toLowerCase()
  game._renderRarityFilter(game.invRarityFilterBtn, game.invRarityFilterMenu, game._invRarity)
  const entries = game._inventorySkinEntries().filter((skin) => (!query || skin.name.toLowerCase().includes(query))
    && (game._invRarity === 'all' || skin.rarity === game._invRarity))
  if (!entries.length) {
    game.inventorySkinsList.innerHTML = `<p class="inv-skin-empty">${_escapeHtml(t('skinNoMatch'))}</p>`
    return
  }
  game.inventorySkinsList.innerHTML = entries.map((skin) => {
    const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
    const classes = ['inv-skin-card']
    if (skin.id === equippedId) classes.push('equipped')
    const locked = _isSkinLocked(game, 'character', skin.id)
    if (locked) classes.push('locked')
    return `<button type="button" class="${classes.join(' ')}" data-inventory-skin="${skin.id}" style="--rarity: ${rarity.color}" title="${_escapeHtml(`${skin.name} - ${t(rarity.key)}`)}">`
      + (locked ? LOCK_ICON : '')
      + `<span class="inv-skin-card-name">${_escapeHtml(skin.name)}</span>`
      + '<img class="inv-skin-card-img" alt="" draggable="false" />'
      + `<span class="inv-skin-card-count">${_safeStatNumber(skin.owned)}</span>`
      + '</button>'
  }).join('')
  // Pictures fill in as they're drawn (cached after the first time).
  for (const skin of entries) {
    skinFrontIconURL(skin.dataUrl).then((url) => {
      const img = game.inventorySkinsList.querySelector(`[data-inventory-skin="${skin.id}"] .inv-skin-card-img`)
      if (img && url) img.src = url
    })
  }
}

// Big 3D preview on the left: the equipped skin.
export async function _renderInventorySkinPreview(game) {
  const entries = game._inventorySkinEntries()
  const shownId = game._equippedInventorySkinId()
  const skin = entries.find((entry) => entry.id === shownId) || entries[0]
  const skinEl = document.getElementById('inv-skin-preview-skin')
  const titleEl = document.getElementById('inv-skin-preview-title')
  if (titleEl) game._fillNameplate(titleEl)
  if (skinEl && skin) {
    const rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
    skinEl.innerHTML = `${_escapeHtml(skin.name)} <span style="color: ${rarity.color}">${_escapeHtml(t(rarity.key))}</span>`
  }
  if (!game.invSkinPreviewCanvas || !skin) return
  if (!game._invSkinAvatar3D) {
    // Its 3D view is made after the panel has drawn, not in the click.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    if (game._invSkinAvatar3D) return game._renderInventorySkinPreview()
    game._invSkinAvatar3D = new MenuAvatar3D(game.invSkinPreviewCanvas)
    // Stands still - only the homepage character spins on its own.
    game._invSkinAvatar3D.noSpin = true
    game._invSkinAvatar3D.start()
  }
  const token = (game._invSkinPreviewToken = (game._invSkinPreviewToken || 0) + 1)
  try {
    const texture = await loadSkinTexture(skin.dataUrl)
    if (token === game._invSkinPreviewToken && game._invSkinAvatar3D) game._invSkinAvatar3D.setSkin(texture)
  } catch {
    // Unreadable texture - keep whatever the preview showed before.
  }
}

// The same menu serves Character cards and Weapons cards (kind
// 'weapon': every weapon only has its Default skin so far - always
// equipped, not tradable).
export function _openInventorySkinMenu(game, card) {
  if (!game.invSkinMenu) return
  const kind = card.dataset.weaponCard ? 'weapon' : 'character'
  const id = kind === 'weapon' ? card.dataset.weaponCard : card.dataset.inventorySkin
  if (game._invSkinMenuFor === id && game._invSkinMenuKind === kind && game.invSkinMenu.style.display !== 'none') {
    game._closeInventorySkinMenu()
    return
  }
  game._invSkinMenuFor = id
  game._invSkinMenuKind = kind
  const entry = kind === 'character' ? INVENTORY_SKINS.find((skin) => skin.id === id) : null
  const owned = entry ? entry.count(game) : 0
  const equipped = kind === 'weapon' || id === game._equippedInventorySkinId()
  // Market (list for other players) and Sell (to the game) only on your
  // own tradable skins - never Default or an uploaded custom skin.
  game.invSkinMenuEquip.textContent = equipped ? t('skinEquipped') : t('skinEquip')
  game.invSkinMenuEquip.disabled = equipped
  game.invSkinMenuInspect.textContent = t('skinInspect')
  // Always all four buttons, like Kirka; on a skin that can't be traded
  // (Default, an uploaded skin) Market/Sell are faded and say why.
  // A locked card can't be traded either (Unlock first).
  const locked = _isSkinLocked(game, kind, id)
  const tradable = !!entry?.sell && owned > 0 && !locked
  for (const [btn, key] of [[game.invSkinMenuMarket, 'marketListBtn'], [game.invSkinMenuSell, 'marketSellBtn']]) {
    if (!btn) continue
    btn.textContent = t(key)
    btn.classList.toggle('locked', !tradable)
    btn.setAttribute('aria-disabled', tradable ? 'false' : 'true')
    btn.dataset.why = locked ? 'skinLockedNoTrade' : 'marketCantTrade'
  }
  if (game.invSkinMenuLock) {
    game.invSkinMenuLock.textContent = t(locked ? 'skinUnlock' : 'skinLock')
    game.invSkinMenuLock.classList.toggle('on', locked)
  }
  // Lives next to whichever grid the card is in, and always fits inside
  // the card itself (below its name, never past its bottom edge).
  const host = card.closest('#inv-skins-side, #inventory-page-weapons') || game.invSkinMenu.parentElement
  if (game.invSkinMenu.parentElement !== host) host.appendChild(game.invSkinMenu)
  const side = host.getBoundingClientRect()
  const rect = card.getBoundingClientRect()
  game.invSkinMenu.style.display = 'flex'
  const menuH = game.invSkinMenu.offsetHeight
  const top = Math.max(rect.top + 4, Math.min(rect.top + 26, rect.bottom - menuH - 6))
  game.invSkinMenu.style.left = `${rect.left - side.left + host.scrollLeft + rect.width / 2}px`
  game.invSkinMenu.style.top = `${top - side.top + host.scrollTop}px`
}

export function _closeInventorySkinMenu(game) {
  if (game.invSkinMenu) game.invSkinMenu.style.display = 'none'
  game._invSkinMenuFor = null
  game._invSkinMenuKind = null
}

// Sell to the game for the fixed price (half the old shop price;
// GaygarX: gems) - the confirm box is the Kirka-style trade dialog.
export function _openSellDialog(game, id) {
  const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
  if (!entry?.sell || !(entry.count(game) > 0) || _isSkinLocked(game, 'character', id)) return
  const name = entry.nameKey ? t(entry.nameKey) : entry.name
  game._openTradeDialog('sell', { id, name, priceLabel: game._formatSkinPrice(entry.sell.currency, entry.sell.amount) })
}

// Kirka-style Inspect window: the item big in 3D (InspectViewer.js) -
// drag to turn it, scroll/pinch to zoom. kind 'character' is a skin id,
// 'weapon' a weapon id. A fresh canvas every time, since the viewer
// releases its WebGL context on close and a canvas can't get one back.
function _inspectSkin(game, id) {
  const owned = game._inventorySkinEntries().find((entry) => entry.id === id)
  if (owned) return owned
  const skin = INVENTORY_SKINS.find((entry) => entry.id === id)
  return skin && { ...skin, owned: 0 }
}

export async function _openInspectDialog(game, kind, id) {
  const dialog = document.getElementById('inspect-dialog')
  const stage = document.getElementById('inspect-stage')
  if (!dialog || !stage) return
  game._closeInspectDialog()
  let name
  let rarity = SKIN_RARITIES.common
  let owned = 1
  if (kind === 'weapon') {
    const w = game.weapons.getSummary().find((entry) => entry.id === id)
    if (!w || !game.weapons.viewmodels?.[id]) return
    name = `${t(w.nameKey)} - ${t('skinDefault')}`
  } else {
    // A skin you don't own yet (the Shop's Inspect) comes from the full list.
    const skin = _inspectSkin(game, id)
    if (!skin) return
    name = skin.name
    rarity = SKIN_RARITIES[skin.rarity] || SKIN_RARITIES.common
    owned = skin.owned
  }
  document.getElementById('inspect-title').textContent = t('inspectTitle', { name })
  const rarityEl = document.getElementById('inspect-rarity')
  rarityEl.textContent = t(rarity.key)
  rarityEl.style.background = rarity.color
  document.getElementById('inspect-count').textContent = t('inspectOwned', { n: Math.floor(_safeStatNumber(owned)).toLocaleString() })
  document.getElementById('inspect-hint').textContent = t('inspectHint')
  const canvas = document.createElement('canvas')
  canvas.id = 'inspect-canvas'
  stage.appendChild(canvas)
  dialog.style.display = 'flex'
  const viewer = new InspectViewer(canvas)
  game._inspectViewer = viewer
  game._inspectCharacter = null
  if (kind === 'weapon') {
    // Barrel pointing left, side-on - like Kirka's.
    viewer.setObject(game._weaponDisplayClone(game.weapons.viewmodels[id]), { yaw: Math.PI / 2, pitch: 0.12 })
    // Opened before the gun models finished loading: show the real one
    // as soon as it arrives (WeaponCatalog.ready).
    game.weapons.ready.then(() => {
      if (game._inspectViewer === viewer) viewer.setObject(game._weaponDisplayClone(game.weapons.viewmodels[id]), { yaw: Math.PI / 2, pitch: 0.12 })
    })
  } else {
    const skin = _inspectSkin(game, id)
    try {
      const texture = await loadSkinTexture(skin.dataUrl)
      if (game._inspectViewer !== viewer) return
      game._inspectCharacter = buildTexturedCharacter(texture)
      viewer.setObject(game._inspectCharacter, { yaw: 0.5, lighting: 'character' })
    } catch {
      // Unreadable texture - the window just stays empty.
    }
  }
  viewer.start()
}

export function _closeInspectDialog(game) {
  const dialog = document.getElementById('inspect-dialog')
  if (dialog) dialog.style.display = 'none'
  if (game._inspectViewer) {
    game._inspectViewer.dispose()
    game._inspectViewer = null
  }
  // The character is built just for game window; a weapon is a clone
  // sharing the game's own geometry/materials, so it's left alone.
  if (game._inspectCharacter) {
    game._inspectCharacter.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    })
    game._inspectCharacter = null
  }
  document.getElementById('inspect-canvas')?.remove()
}

// Same skin-apply sequence _buyShopSkin/_bindSkinUpload's Reset button
// already each use on their own equip/reset paths - kept as its own
// separate function rather than refactoring those two (both already
// shipped/working, each with its own extra step around this - currency
// deduction + confirm dialog for buying, the default-bundled-skin
// re-fetch for resetting) to avoid touching either for this.
export async function _equipInventorySkin(game, id) {
  if (id === 'custom') return
  // Any INVENTORY_SKINS entry the player owns (other than Default) -
  // no per-skin code needed for a new one.
  const entry = INVENTORY_SKINS.find((skin) => skin.id === id)
  if (entry && id !== 'default') {
    if (!(entry.count(game) > 0)) return
    game.settings.customSkinDataUrl = entry.dataUrl
    saveSettings(game.settings)
    const skin = await loadSkinTexture(entry.dataUrl)
    if (game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
    game._updateMenuAvatarPhoto(skin)
  } else {
    game.settings.customSkinDataUrl = null
    saveSettings(game.settings)
    if (game._menuAvatar3D) game._menuAvatar3D.setSkin(null)
    await game._applyDefaultBundledSkin()
  }
  // Profile's own Reset to Default button (see _bindSkinUpload) shows/
  // hides based on game same customSkinDataUrl - keep it in sync too,
  // even though it's on a different panel, since both reflect one
  // shared piece of state.
  const resetBtn = document.getElementById('reset-skin-btn')
  if (resetBtn) resetBtn.style.display = game.settings.customSkinDataUrl ? '' : 'none'
  game._renderInventorySkins()
  game._renderInventorySkinPreview()
}

export function _closeMenuInventoryPanel(game) {
  if (game.menuInventoryPanel) game.menuInventoryPanel.style.display = 'none'
  game._closeInspectDialog()
}

// Crate tier cards - there are two copies in the DOM (Inventory's Crates
// tab, cost-free per the project owner's request, and the Shop panel,
// which shows cost - amount + coin icon, right on the button itself -
// since that's the actual place to buy them), both sharing the same
// class/data-crate-tier markup rather than each getting their own cached
// element set - a plain querySelectorAll here updates every copy in one
// pass. The two copies' buttons only differ by whether they still have
// the .crate-open-btn-amount child (Shop's markup) or not (Inventory's,
// reverted back to plain "Open" text) - that presence check is what
// decides which label a given button gets, so a future 3rd copy needs no
// changes here, just whichever markup shape it should follow.
export function _renderCrateTiers(game) {
  // Tier-name labels (just "Wood"/"Ice"/...) stay unscoped - both the
  // Shop's real crates and Inventory > Crates' cost-free display copies
  // (see the click-binding's own comment, above where game is called
  // from) need game same translation, and there's no price/affordability
  // concept involved here to leak between them.
  for (const el of document.querySelectorAll('.crate-tier-name[data-crate-tier]')) {
    el.textContent = t(`crateTier${el.dataset.crateTier.charAt(0).toUpperCase()}${el.dataset.crateTier.slice(1)}`)
  }
  // Price/affordability, unlike the tier names above, is Shop-only -
  // scoped to #shop-crate-tier-grid so Inventory's plain "Open" buttons
  // (same classes/data-crate-tier, reused purely for visual styling)
  // never get disabled by an affordability check they have no price to
  // justify (real regression, caught 2026-09-21 - see the click
  // handler's own comment for the matching fix on that side).
  for (const btn of document.querySelectorAll('#shop-crate-tier-grid .crate-open-btn[data-crate-tier]')) {
    const tier = CRATE_TIERS[btn.dataset.crateTier]
    if (!tier) continue
    btn.disabled = CRATES_COMING_SOON || game.coins < tier.cost
    // .querySelector('span'), not btn.textContent, for the Shop's
    // version specifically - it also has an <svg> icon child that a
    // plain textContent set would silently wipe out (see the Menu
    // redesign notes' own recurring gotcha on game exact pattern).
    const amountEl = btn.querySelector('.crate-open-btn-amount')
    if (amountEl) amountEl.textContent = tier.cost
    else btn.textContent = t('crateOpenBtn')
  }
  // Inventory > Crates' own plain "Open" buttons - excluded from the
  // Shop-scoped loop above (no price to check/show), but still need
  // their label translated on language switch, same as everywhere else.
  // Disabled when crateStock is 0 for that tier - nothing owned yet to
  // open (2026-09-21, part of the buy/open split).
  for (const btn of document.querySelectorAll('#inventory-page-crates .crate-open-btn[data-crate-tier]')) {
    btn.textContent = t('crateOpenBtn')
    btn.disabled = CRATES_COMING_SOON || (game.crateStock[btn.dataset.crateTier] || 0) <= 0
  }
  // Star-shaped stock badge on each Inventory crate card, "x3"-style
  // text (reverted back from a plain-number-only pass per explicit
  // request). Hidden entirely at 0 rather than shown as "x0" (see
  // .crate-stock-count's own CSS comment).
  for (const el of document.querySelectorAll('#inventory-page-crates .crate-stock-count[data-crate-tier]')) {
    const count = game.crateStock[el.dataset.crateTier] || 0
    el.textContent = `x${count}`
    // '' (not 'block') when shown - the CSS class's own display:flex
    // centers the number inside the star shape; an inline 'block'
    // here would override it right back to left-aligned/uncentered.
    el.style.display = count > 0 && !CRATES_COMING_SOON ? '' : 'none'
  }
  // Coming Soon tag on every crate card in both grids (the Monthly Chest
  // has its own in the markup).
  for (const card of document.querySelectorAll('.crate-card:not(.crate-tier-monthly)')) {
    let tag = card.querySelector('.crate-coming-soon-tag')
    if (CRATES_COMING_SOON && !tag) {
      tag = document.createElement('span')
      tag.className = 'crate-coming-soon-tag'
      card.prepend(tag)
    }
    if (tag) {
      tag.textContent = t('crateComingSoonTag')
      tag.style.display = CRATES_COMING_SOON ? '' : 'none'
    }
  }
}

// Buys 1 crate - adds it to crateStock, unopened, rather than instantly
// rolling a reward (2026-09-21, per explicit request to separate buying
// from opening so Inventory can show a real "how many do I have" count). Mirrors
// _buyShopSkin's own afford-check/deduct/persist/toast shape.
export function _openCrate(game, tier) {
  if (CRATES_COMING_SOON) return
  const tierConfig = CRATE_TIERS[tier]
  if (!tierConfig) return
  if (game.coins < tierConfig.cost) {
    game._showHomepageToast(t('crateNotEnoughCoins'))
    return
  }
  game.coins -= tierConfig.cost
  game.crateStock[tier] = (game.crateStock[tier] || 0) + 1
  game._showHomepageToast(t('crateBought', { n: 1, name: t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`) }))
  saveShopProgress(game)
  game._renderCurrencyBar()
  game._renderCrateTiers()
}

// Bulk-purchase modal (2026-09-21) - opened by clicking a crate card
// anywhere other than its own Open button (see the click binding in
// _bindMenu). Lets a player pick a quantity and buy several crates in
// one confirm instead of one _openCrate() click at a time.
export function _openCratePurchaseModal(game, tier) {
  const tierConfig = CRATE_TIERS[tier]
  if (!tierConfig || !game.cratePurchaseModal) return
  if (game.coins < tierConfig.cost) {
    game._showHomepageToast(t('crateNotEnoughCoins'))
    return
  }
  game._cratePurchaseTier = tier
  game._cratePurchaseQty = 1
  game.cratePurchaseIconWrap.innerHTML = CRATE_ICON_SVG[tier] || ''
  game.cratePurchaseTierName.textContent = t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`)
  game.cratePurchaseBox.style.setProperty('--crate-tier-color', CRATE_TIER_COLORS[tier] || '#e3c23c')
  game.cratePurchaseModal.style.display = 'flex'
  game._updateCratePurchaseModal()
}

export function _closeCratePurchaseModal(game) {
  if (game.cratePurchaseModal) game.cratePurchaseModal.style.display = 'none'
}

// Recomputes the quantity clamp (1..whatever this.coins can actually
// afford - no fixed upper cap anymore, per explicit request to allow
// buying as many as you can afford in one purchase) - re-run after
// every +/- click and right after opening, since "what's affordable"
// can only ever shrink relative to when the modal opened, never grow,
// but re-deriving it fresh here rather than caching it once is what
// makes that safe regardless of when coins last changed.
export function _updateCratePurchaseModal(game) {
  const tier = game._cratePurchaseTier
  const tierConfig = CRATE_TIERS[tier]
  if (!tierConfig) return
  const maxAffordable = Math.floor(game.coins / tierConfig.cost)
  const maxQty = Math.max(1, maxAffordable)
  game._cratePurchaseQty = Math.min(game._cratePurchaseQty, maxQty)
  game.cratePurchaseQtyValue.value = game._cratePurchaseQty
  game.cratePurchaseQtyValue.max = maxQty
  game.cratePurchaseQtyMinus.disabled = game._cratePurchaseQty <= 1
  game.cratePurchaseQtyPlus.disabled = game._cratePurchaseQty >= maxQty
  const total = tierConfig.cost * game._cratePurchaseQty
  game.cratePurchaseTotalAmount.textContent = total
  game.cratePurchaseConfirmBtn.disabled = game.coins < total
}

// Buys the chosen quantity, adding all of it to crateStock unopened -
// no per-crate reward rolling here. One combined "Bought Nx Tier Crate" toast instead
// of the old per-reward summary, since there's no longer a reward to
// summarize at buy time.
export function _confirmCratePurchase(game) {
  const tier = game._cratePurchaseTier
  const tierConfig = CRATE_TIERS[tier]
  if (!tierConfig) return
  // Clamps game._cratePurchaseQty for real - the qty input's own
  // 'input' listener updates it live while typing WITHOUT clamping
  // (see its own comment), so clicking Confirm before ever blurring a
  // just-typed out-of-range value would otherwise reach here
  // unclamped.
  game._updateCratePurchaseModal()
  const qty = game._cratePurchaseQty
  const totalCost = tierConfig.cost * qty
  if (game.coins < totalCost) {
    game._showHomepageToast(t('crateNotEnoughCoins'))
    return
  }
  game.coins -= totalCost
  game.crateStock[tier] = (game.crateStock[tier] || 0) + qty
  game._showHomepageToast(t('crateBought', { n: qty, name: t(`crateTier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`) }))
  saveShopProgress(game)
  game._renderCurrencyBar()
  game._renderCrateTiers()
  game._closeCratePurchaseModal()
}

// Inventory panel's Weapons tab - every weapon's mastery progress in one
// place. The hotbar only ever shows the 3 currently-equipped weapons,
// so
// there was previously no way to check mastery progress on a weapon
// that isn't in your hotbar right now. Read-only by design - this tab's
// job is showing progress, not reassigning loadouts (the Loadout panel
// and this same Inventory panel's hotbar-assign buttons already do that).
// Inventory > Weapons (2026-10-01): a card per weapon's Default skin, in
// the same Kirka-style grid as Character - the old list of names with
// mastery kill counts ("0/75") is gone from here. Pictures are rendered
// once from each weapon's own viewmodel (_weaponThumbnails).
export function _renderInventoryWeapons(game, { draw = false } = {}) {
  if (!game.inventoryWeaponsList) return
  if (game._invSkinMenuKind === 'weapon') game._closeInventorySkinMenu()
  const weapons = game.weapons
    .getSummary()
    .sort((a, b) => COMING_SOON_WEAPONS.has(a.id) - COMING_SOON_WEAPONS.has(b.id) || t(a.nameKey).localeCompare(t(b.nameKey)))
  const rarity = SKIN_RARITIES.common
  const thumbs = game._weaponThumbCache || {}
  game.inventoryWeaponsList.innerHTML = weapons.map((w) => {
    const name = t(w.nameKey)
    const icon = WEAPON_ICON_PATHS[w.id]
    const picture = thumbs[w.id]
      ? `<img class="inv-weapon-card-img" alt="" draggable="false" src="${thumbs[w.id]}" />`
      : icon ? `<svg class="inv-weapon-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>` : ''
    // Coming Soon guns: greyed out, tagged, and no menu on click.
    const soon = COMING_SOON_WEAPONS.has(w.id)
    const locked = !soon && _isSkinLocked(game, 'weapon', w.id)
    return `<div class="inv-skin-card inv-weapon-card${soon ? ' inv-weapon-soon' : ''}${locked ? ' locked' : ''}" ${soon ? 'aria-disabled="true"' : `data-weapon-card="${w.id}"`} style="--rarity: ${rarity.color}" title="${_escapeHtml(`${name} - ${soon ? t('crateComingSoonTag') : t('skinDefault')}`)}">`
      + (locked ? LOCK_ICON : '')
      + `<span class="inv-skin-card-name">${_escapeHtml(name)}</span>`
      + (soon ? `<span class="weapon-soon-tag">${_escapeHtml(t('crateComingSoonTag'))}</span>` : '')
      + picture
      + `<span class="inv-weapon-card-skin">${_escapeHtml(t('skinDefault'))}</span>`
      + '<span class="inv-skin-card-count">1</span>'
      + '</div>'
  }).join('')
  // Pictures saved by an earlier visit load straight away; drawing them
  // fresh waits for the Weapons tab (draw). Never waits on them - the
  // cards fill in once they're ready.
  if (!game._weaponThumbCache && (draw || game._weaponThumbsSaved !== false)) {
    const job = draw ? game._weaponThumbnailsReady() : game._loadSavedWeaponThumbs()
    job.then((out) => {
      if (out && game.menuInventoryPanel?.style.display !== 'none') game._renderInventoryWeapons()
    })
  }
}

// Side-view picture of every weapon, drawn once with a small throwaway
// renderer (its own canvas, so the game's renderer and frame are never
// touched) and kept as blob URLs. Hands are left out.
export async function _weaponThumbnails(game) {
  const out = {}
  let renderer
  // A break before each heavy step (2026-10-10, "a tick" opening Inventory
  // the first time): the panel paints first, then the renderer, then the
  // reflection map - none of it in the click that opened the panel.
  // While a game runs with its weapon picker closed nothing is drawn at
  // all (see the per-gun break below) - a busy page there can miss its
  // server syncs and be dropped.
  const pause = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    while (game.buildMode?.active && !game.buildMode.survival?._picking) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  try {
    await pause()
    const canvas = document.createElement('canvas')
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    renderer.setSize(240, 140, false)
    renderer.setClearColor(0x000000, 0)
    await pause()
    const scene = new THREE.Scene()
    // Most guns are fully metallic (metalness 1), which only shows what it
    // reflects - without an environment they render pure black.
    const pmrem = new THREE.PMREMGenerator(renderer)
    // 64px is plenty for 240x140 pictures - the default 256 made game the
    // slowest step by far.
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 64 }).texture
    pmrem.dispose()
    await pause()
    // Bright, even studio light - most guns are dark metal and would
    // otherwise read as black silhouettes on the dark cards.
    addGunLights(scene)
    const camera = new THREE.PerspectiveCamera(30, 240 / 140, 0.01, 50)
    const box = new THREE.Box3()
    const meshBox = new THREE.Box3()
    for (const [id, vm] of Object.entries(game.weapons.viewmodels || {})) {
      const model = game._weaponDisplayClone(vm)
      scene.add(model)
      model.updateMatrixWorld(true)
      // Bounds of what's actually visible (hidden parts like scopes or
      // alternate melee variants would otherwise stretch the framing).
      box.makeEmpty()
      model.traverse((o) => {
        if (!o.isMesh || !o.geometry) return
        for (let p = o; p; p = p.parent) if (!p.visible) return
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        meshBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
        box.union(meshBox)
      })
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        // Guns point along -Z, so look from the side (+X) with the
        // barrel running left-right; fit the longer of length/height.
        const fitH = Math.max(size.y, size.z / camera.aspect) * 1.15
        const dist = fitH / 2 / Math.tan((camera.fov * Math.PI) / 360) + size.x
        camera.position.set(center.x + dist, center.y + dist * 0.12, center.z)
        camera.lookAt(center)
        renderer.render(scene, camera)
        // A blob URL, encoded off the main thread - toDataURL's PNG
        // encode for all 15 at once froze the page for a moment.
        out[id] = await new Promise((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/png'))
        if (!out[id]) delete out[id]
      }
      scene.remove(model)
      // One weapon per break, so the page keeps drawing in between - and
      // none while a game is being played (only its weapon picker shows
      // them), where a slow device would stutter or, on a server, miss
      // its syncs and be dropped.
      await new Promise((resolve) => setTimeout(resolve, 0))
      while (game.buildMode?.active && !game.buildMode.survival?._picking) await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } catch (err) {
    console.warn('Weapon pictures failed, using icons instead', err)
  } finally {
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
  return out
}

// The weapon pictures, drawn once in the background (started the first
// time Inventory or Map 1's weapon picker needs them) and shared by both.
// Drawing all 15 at once when Play was clicked froze the game for a
// moment before the map appeared (2026-10-10, "it lags then loads").
export function _weaponThumbnailsReady(game) {
  if (!game._weaponThumbJob) {
    game._weaponThumbJob = game._loadSavedWeaponThumbs().then(async (saved) => {
      if (saved) return saved
      const out = await game._weaponThumbnails()
      game._weaponThumbCache = out
      game._saveWeaponThumbs(out)
      return out
    })
  }
  return game._weaponThumbJob
}

// The pictures are kept in the browser's Cache Storage after the first
// drawing (2026-10-11, "the inventory still ticks a bit when clicking"),
// so later visits never draw them again. Bump WEAPON_THUMBS_CACHE when a
// weapon model changes. Resolves null when nothing (complete) is saved.
export async function _loadSavedWeaponThumbs(game) {
  if (game._weaponThumbCache) return game._weaponThumbCache
  // Ready-made pictures shipped with the game (2026-10-17 lag hunt:
  // drawing them froze a slow device for up to a second the first time it
  // pressed Play). Only when every weapon has one - a new weapon without a
  // picture yet falls back to drawing them (scripts/make-weapon-thumbs.mjs
  // makes them again).
  const ids = Object.keys(game.weapons?.viewmodels || {})
  if (ids.length && ids.every((id) => WEAPON_THUMB_IDS.includes(id))) {
    const out = {}
    for (const id of ids) out[id] = `/images/weapon-thumbs/${id}.png?v=${WEAPON_THUMBS_VERSION}`
    game._weaponThumbCache = out
    game._weaponThumbsSaved = true
    return out
  }
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(WEAPON_THUMBS_CACHE)
    const ids = Object.keys(game.weapons.viewmodels || {})
    const out = {}
    for (const id of ids) {
      const res = await cache.match(`/weapon-thumbs/${id}.png`)
      if (!res) { game._weaponThumbsSaved = false; return null }
      out[id] = URL.createObjectURL(await res.blob())
    }
    if (!ids.length) return null
    game._weaponThumbCache = out
    game._weaponThumbsSaved = true
    return out
  } catch {
    game._weaponThumbsSaved = false
    return null
  }
}

export async function _saveWeaponThumbs(_game, out) {
  try {
    if (typeof caches === 'undefined') return
    for (const name of await caches.keys()) if (name.startsWith('gayz-weapon-thumbs') && name !== WEAPON_THUMBS_CACHE) await caches.delete(name)
    const cache = await caches.open(WEAPON_THUMBS_CACHE)
    for (const [id, url] of Object.entries(out)) {
      const blob = await (await fetch(url)).blob()
      await cache.put(`/weapon-thumbs/${id}.png`, new Response(blob, { headers: { 'Content-Type': 'image/png' } }))
    }
  } catch {
    // Not saved - they're just drawn again next visit.
  }
}

// A weapon's viewmodel copied for showing on its own (card pictures,
// Inspect): reset to the origin and visible. Shares the game's
// geometry/materials - never dispose them through this.
export function _weaponDisplayClone(_game, vm) {
  const model = cloneViewmodel(vm)
  model.position.set(0, 0, 0)
  model.rotation.set(0, 0, 0)
  model.scale.set(1, 1, 1)
  model.visible = true
  return model
}

export function _openShopPanel(game) {
  game._closeAllMenuPanels()
  // Opened from the pause overlay (still on screen, unlocked) as well as
  // the main menu now that crates are buyable mid-run - hide it
  // explicitly rather than relying on DOM/paint order, same reasoning
  // (and fix) as _openUpgradesPanel's own comment: #pause-overlay comes
  // after #shop-panel in index.html and would otherwise render on top
  // and eat every click meant for a crate underneath it.
  game.shopPanel.style.display = 'flex'
  game.shopPanelTitle.textContent = t('shopPanelTitle')
  if (game.shopSkinCanvas) {
    if (!game._shopSkinAvatar3D) {
      game._shopSkinAvatar3D = new MenuAvatar3D(game.shopSkinCanvas)
      // Drag turns it both ways, wheel/pinch zooms, like Inspect.
      game._shopSkinAvatar3D.enableInspect()
      // Turns on its own at a clear pace (Gaymi: "just make it spinning").
      game._shopSkinAvatar3D.spinSpeed = 1.1
      // Lit brighter than the homepage character so GaygarX's dark skin
      // reads on the card (2026-10-24, "make it brighter").
      game._shopSkinAvatar3D.scene.traverse((o) => { if (o.isLight) o.intensity *= 1.6 })
      loadSkinTexture(SHOP_SKIN_PREVIEW_DATA_URL).then((skin) => {
        if (game._shopSkinAvatar3D) game._shopSkinAvatar3D.setSkin(skin)
      }).catch(() => {
        if (game._shopSkinAvatar3D) game._shopSkinAvatar3D.reveal()
      })
    }
    game._shopSkinAvatar3D.start()
  }
  game._renderShopSkinState()
  game._renderCrateTiers()
}

// Try On (2026-10-23): the shop closes and the homepage character wears
// GaygarX until Back to Shop (or any panel opening) puts the real skin
// back. Only on the homepage - mid-run there's no character to show.
function _shopTryOnAvailable(game) {
  return !!(game._menuAvatar3D && game.setupAvatarCanvas && game.setupAvatarCanvas.offsetParent !== null)
}

export async function _startShopTryOn(game) {
  if (game._shopTryOn || !_shopTryOnAvailable(game)) return
  game._shopTryOn = true
  game._closeShopPanel()
  const bar = document.getElementById('shop-tryon-bar')
  if (bar) bar.style.display = 'flex'
  // On a phone the character is further down the stacked homepage.
  game.setupAvatarCanvas.scrollIntoView({ block: 'center' })
  try {
    const skin = await loadSkinTexture(SHOP_SKIN_PREVIEW_DATA_URL)
    if (game._shopTryOn && game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
  } catch { /* keeps showing the current skin */ }
}

export async function _endShopTryOn(game, reopenShop) {
  if (!game._shopTryOn) return
  game._shopTryOn = false
  const bar = document.getElementById('shop-tryon-bar')
  if (bar) bar.style.display = 'none'
  const url = game.settings.customSkinDataUrl
  if (url) {
    try {
      const skin = await loadSkinTexture(url)
      if (game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
    } catch { /* leave it */ }
  } else {
    await game._applyDefaultBundledSkin()
  }
  if (reopenShop) game._openShopPanel()
}

// A short burst of coloured paper over the skin card after buying.
function _shopConfetti() {
  const host = document.getElementById('shop-skin-item')
  if (!host || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#ff3d6e', '#ffcf3d', '#3dd6ff', '#7dff6a', '#b57ce8', '#ff8a3d']
  for (let i = 0; i < 28; i++) {
    const bit = document.createElement('span')
    bit.className = 'shop-confetti'
    const angle = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 90
    bit.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
    bit.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`)
    bit.style.setProperty('--rot', `${Math.round(Math.random() * 720 - 360)}deg`)
    bit.style.background = colors[i % colors.length]
    host.appendChild(bit)
    setTimeout(() => bit.remove(), 1300)
  }
}

export function _renderShopSkinState(game) {
  if (game.shopSkinBadge) game.shopSkinBadge.style.display = game.ownsShopSkin ? '' : 'none'
  const priceAmount = document.getElementById('shop-skin-price-amount')
  if (priceAmount) priceAmount.textContent = Game.SHOP_SKIN_PRICE.toLocaleString()
  if (!game.shopSkinBuyBtn) return
  if (game.ownsShopSkin) {
    game.shopSkinBuyBtn.style.display = 'none'
    return
  }
  game.shopSkinBuyBtn.style.display = ''
  const short = game.gems < Game.SHOP_SKIN_PRICE
  game.shopSkinBuyBtn.disabled = short
  game.shopSkinBuyBtn.textContent = short ? t('shopSkinNeedMoreGems', { need: Game.SHOP_SKIN_PRICE - game.gems }) : t('shopSkinBuyBtn')
}

export async function _buyShopSkin(game) {
  if (game.ownsShopSkin || game.gems < Game.SHOP_SKIN_PRICE) return
  if (!window.confirm(t('shopSkinBuyConfirm'))) return
  game.gems -= Game.SHOP_SKIN_PRICE
  game.ownsShopSkin = true
  saveShopProgress(game)
  game._renderCurrencyBar()
  // Equip immediately - same sequence _bindSkinUpload's own upload
  // handler uses (settings.customSkinDataUrl + menu avatar + corner
  // photo + third-person body), just sourced from the fixed shop skin
  // data URL instead of an uploaded file.
  game.settings.customSkinDataUrl = SHOP_SKIN_PREVIEW_DATA_URL
  saveSettings(game.settings)
  const skin = await loadSkinTexture(SHOP_SKIN_PREVIEW_DATA_URL)
  if (game._menuAvatar3D) game._menuAvatar3D.setSkin(skin)
  game._updateMenuAvatarPhoto(skin)
  game._renderShopSkinState()
  _shopConfetti()
  game._showHomepageToast(t('shopSkinBuySuccess'))
}

export function _closeShopPanel(game) {
  // _closeAllMenuPanels() calls game unconditionally as blanket cleanup
  // every time ANY panel opens mid-run (Settings, Upgrades, etc.), not
  // just when Shop was actually the one open. Without game guard, opening
  // Settings from the pause menu re-flexed #pause-overlay right after
  // _toggleSettings had just hidden it - both ended up visible at the
  // same z-index (15), and #pause-overlay (later in the DOM) silently ate
  // every click meant for a Settings control underneath it. Only restore
  // the pause overlay when Shop was genuinely the panel being closed.
  game.shopPanel.style.display = 'none'
  if (game._shopSkinAvatar3D) game._shopSkinAvatar3D.stop()
}

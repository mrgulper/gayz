// Shop > Name & ID (2026-11-15).
// - Changing your name costs NAME_CHANGE_PRICE gems (it used to be free).
//   Both the Shop card and the pencil next to your name go through
//   buyNameChange, so there is one place that charges.
// - A custom Player ID (5-10 letters/numbers you pick) costs
//   CUSTOM_ID_PRICE gems. Needs sign-in: the ID is claimed online
//   (CloudSync.claimPlayerId, Firestore playerIds/{ID}) so no two players
//   can own the same one. Gems are only taken after the claim worked.
//   Banned players, and anyone warned in the last 30 days, can't buy one
//   (asked fresh from /api/live each time, LiveConfig.checkIdShopBlocked).
import * as CloudSync from './CloudSync.js'
import { PLAYER_ID_MAX, isValidPlayerId, saveSettings, saveShopProgress } from './Game.js'
import { t } from './i18n.js'
import { audioEngine } from './Audio.js'
import { checkIdShopBlocked } from './LiveConfig.js'

export const NAME_CHANGE_PRICE = 100
export const CUSTOM_ID_PRICE = 10000

function cleanName(text) {
  return String(text || '').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 16)
}

export function cleanIdInput(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, PLAYER_ID_MAX)
}

function playBuy() {
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
}

function spendGems(game, price) {
  game.gems -= price
  saveShopProgress(game)
  game._renderCurrencyBar()
}

// Returns true when the name was changed and paid for.
export function buyNameChange(game, rawName) {
  const name = cleanName(rawName)
  const current = game.settings.nickname || ''
  if (!name || name === current) return false
  if (game.gems < NAME_CHANGE_PRICE) {
    game._showHomepageToast(t('shopNameNeedGems', { price: NAME_CHANGE_PRICE, need: NAME_CHANGE_PRICE - game.gems }))
    return false
  }
  if (!window.confirm(t('shopNameConfirm', { name, price: NAME_CHANGE_PRICE }))) return false
  spendGems(game, NAME_CHANGE_PRICE)
  game.settings.nickname = name
  saveSettings(game.settings)
  game._renderPlayerTag()
  game._pushOnlineStats?.()
  playBuy()
  game._showHomepageToast(t('shopNameDone', { name }))
  renderShopIdentity(game)
  return true
}

let idBusy = false

export async function buyCustomId(game, rawId) {
  if (idBusy) return
  const id = cleanIdInput(rawId)
  const status = (key, vars) => setIdStatus(t(key, vars), key !== 'shopIdChecking')
  if (!isValidPlayerId(id)) return status('shopIdBadFormat')
  if (id === game.settings.playerId) return status('shopIdSame')
  if (game.gems < CUSTOM_ID_PRICE) return status('shopIdNeedGems', { need: (CUSTOM_ID_PRICE - game.gems).toLocaleString() })
  // Tests swap in a fake online check (no live Firestore in tests).
  const cloud = game.__idBackendForTests || CloudSync
  const uid = game._cloudUid
  if (!uid || !cloud.isConfigured()) return status('shopIdSignIn')
  idBusy = true
  renderShopIdentity(game)
  status('shopIdChecking')
  try {
    const blocked = game.__idBackendForTests ? !!(await game.__idBackendForTests.isIdShopBlocked?.()) : await checkIdShopBlocked(game)
    if (blocked) return status('shopIdBlocked')
    if (await cloud.isPlayerIdTaken(id, uid)) return status('shopIdTaken')
    setIdStatus('', false)
    if (!window.confirm(t('shopIdConfirm', { id, price: CUSTOM_ID_PRICE.toLocaleString() }))) return
    status('shopIdChecking')
    await cloud.claimPlayerId(uid, id)
    const oldId = game.settings.playerId
    spendGems(game, CUSTOM_ID_PRICE)
    game.settings.playerId = id
    saveSettings(game.settings)
    game._renderPlayerTag()
    game._pushOnlineStats?.()
    cloud.releasePlayerId(uid, oldId).catch(() => {})
    playBuy()
    setIdStatus('', false)
    const input = document.getElementById('shop-id-input')
    if (input) input.value = ''
    game._showHomepageToast(t('shopIdDone', { id }))
  } catch (err) {
    status(String(err?.message).includes('taken') ? 'shopIdTaken' : 'shopIdError')
  } finally {
    idBusy = false
    renderShopIdentity(game)
  }
}

function setIdStatus(text, isError) {
  const el = document.getElementById('shop-id-status')
  if (!el) return
  el.textContent = text
  el.classList.toggle('shop-identity-error', !!isError)
}

export function renderShopIdentity(game) {
  const nameInput = document.getElementById('shop-name-input')
  if (nameInput && document.activeElement !== nameInput) nameInput.value = game.settings.nickname || ''
  const nameBtn = document.getElementById('shop-name-buy-btn')
  if (nameBtn) {
    const short = game.gems < NAME_CHANGE_PRICE
    nameBtn.disabled = short
    nameBtn.textContent = short ? t('shopSkinNeedMoreGems', { need: NAME_CHANGE_PRICE - game.gems }) : t('shopNameBuyBtn')
  }
  const current = document.getElementById('shop-id-current')
  if (current) current.textContent = t('shopIdCurrent', { id: game.settings.playerId || '' })
  const idBtn = document.getElementById('shop-id-buy-btn')
  if (idBtn) {
    const short = game.gems < CUSTOM_ID_PRICE
    idBtn.disabled = short || idBusy
    idBtn.textContent = short ? t('shopSkinNeedMoreGems', { need: (CUSTOM_ID_PRICE - game.gems).toLocaleString() }) : t('shopIdBuyBtn')
  }
  const namePrice = document.getElementById('shop-name-price-amount')
  if (namePrice) namePrice.textContent = NAME_CHANGE_PRICE.toLocaleString()
  const idPrice = document.getElementById('shop-id-price-amount')
  if (idPrice) idPrice.textContent = CUSTOM_ID_PRICE.toLocaleString()
}

export function bindShopIdentity(game) {
  const nameInput = document.getElementById('shop-name-input')
  const nameBtn = document.getElementById('shop-name-buy-btn')
  const idInput = document.getElementById('shop-id-input')
  const idBtn = document.getElementById('shop-id-buy-btn')
  nameInput?.addEventListener('input', () => {
    const filtered = nameInput.value.replace(/[^\x20-\x7E]/g, '')
    if (filtered !== nameInput.value) nameInput.value = filtered
  })
  nameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameBtn?.click() })
  nameBtn?.addEventListener('click', () => {
    if (!buyNameChange(game, nameInput?.value)) {
      const name = cleanName(nameInput?.value)
      if (!name || name === game.settings.nickname) game._showHomepageToast(t('shopNameTypeNew'))
    }
  })
  idInput?.addEventListener('input', () => {
    const cleaned = cleanIdInput(idInput.value)
    if (cleaned !== idInput.value) idInput.value = cleaned
    setIdStatus('', false)
  })
  idInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') idBtn?.click() })
  idBtn?.addEventListener('click', () => buyCustomId(game, idInput?.value))
}

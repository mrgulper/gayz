// Shop > Kill Effects, Walk Trails, Jump Effects, Death Effects, Gun Skins, Pet Hats, Pet Paints and
// Ride Paints, Name Styles, Chat Bubbles and Profile Frames (2026-11-25, shop plan;
// KillEffects.js, WalkTrails.js, GunSkins.js). One card each: click to buy
// (coins; Settings > Confirm Purchases asks first on big buys) and it's
// used right away. An owned one: click to use it, click again to stop.
// Inventory > Hats & Capes has the same pickers (CosmeticsUI.js).
import { _escapeHtml, saveSettings } from './Game.js'
import { ownsShopCosmetic } from './Cosmetics.js'
import { KILL_EFFECTS, KILL_EFFECT_IDS, killEffectName, killEffectIcon } from './KillEffects.js'
import { TRAILS, TRAIL_IDS, trailName, trailIcon } from './WalkTrails.js'
import { GUN_SKINS, GUN_SKIN_IDS, gunSkinName, gunSkinIcon } from './GunSkins.js'
import { PET_HATS, PET_HAT_IDS, PET_PAINTS, PET_PAINT_IDS, RIDE_PAINTS, RIDE_PAINT_IDS, petHatName, petPaintName, ridePaintName, petHatIcon, petPaintIcon, ridePaintIcon } from './PetRideLooks.js'
import { JUMP_EFFECTS, JUMP_EFFECT_IDS, DEATH_EFFECTS, DEATH_EFFECT_IDS, jumpEffectName, deathEffectName, jumpEffectIcon, deathEffectIcon } from './JumpDeathEffects.js'
import { NAME_STYLES, NAME_STYLE_IDS, CHAT_BUBBLES, CHAT_BUBBLE_IDS, PROFILE_FRAMES, PROFILE_FRAME_IDS, nameStyleName, chatBubbleName, profileFrameName, nameStyleIcon, chatBubbleIcon, profileFrameIcon, applyMyNameLook } from './NameChatStyles.js'
import { needsBuyConfirm } from './GameplayAssist.js'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'

// Each kind: its items, the setting that holds the one used, its Shop
// section and its words.
export const EFFECT_KINDS = {
  kill: {
    items: KILL_EFFECTS, ids: KILL_EFFECT_IDS, setting: 'killEffect', name: killEffectName, icon: killEffectIcon,
    root: 'shop-effects', heading: 'shop-effects-heading', headingKey: 'killFxHeading', toastKey: 'killFxBoughtToast', color: '#a98bff',
  },
  trail: {
    items: TRAILS, ids: TRAIL_IDS, setting: 'walkTrail', name: trailName, icon: trailIcon,
    root: 'shop-trails', heading: 'shop-trails-heading', headingKey: 'trailHeading', toastKey: 'trailBoughtToast', color: '#5cc8ff',
  },
  // Jump + death effects (JumpDeathEffects.js).
  jump: {
    items: JUMP_EFFECTS, ids: JUMP_EFFECT_IDS, setting: 'jumpEffect', name: jumpEffectName, icon: jumpEffectIcon,
    root: 'shop-jumps', heading: 'shop-jumps-heading', headingKey: 'jumpFxHeading', toastKey: 'jumpFxBoughtToast', color: '#7fd8ff',
  },
  death: {
    items: DEATH_EFFECTS, ids: DEATH_EFFECT_IDS, setting: 'deathEffect', name: deathEffectName, icon: deathEffectIcon,
    root: 'shop-deaths', heading: 'shop-deaths-heading', headingKey: 'deathFxHeading', toastKey: 'deathFxBoughtToast', color: '#c0c6ce',
  },
  // Gun skins (GunSkins.js): one paint job for every gun.
  gun: {
    items: GUN_SKINS, ids: GUN_SKIN_IDS, setting: 'gunSkin', name: gunSkinName, icon: gunSkinIcon,
    root: 'shop-gunskins', heading: 'shop-gunskins-heading', headingKey: 'gunSkinHeading', toastKey: 'gunSkinBoughtToast', color: '#ffb347',
  },
  // Pet + ride looks (PetRideLooks.js): a hat and a paint for every pet,
  // one paint for every ride.
  petHat: {
    items: PET_HATS, ids: PET_HAT_IDS, setting: 'petHat', name: petHatName, icon: petHatIcon,
    root: 'shop-pethats', heading: 'shop-pethats-heading', headingKey: 'petHatHeading', toastKey: 'petHatBoughtToast', color: '#ff8fd0',
  },
  petPaint: {
    items: PET_PAINTS, ids: PET_PAINT_IDS, setting: 'petPaint', name: petPaintName, icon: petPaintIcon,
    root: 'shop-petpaints', heading: 'shop-petpaints-heading', headingKey: 'petPaintHeading', toastKey: 'petPaintBoughtToast', color: '#7dffb0',
  },
  ridePaint: {
    items: RIDE_PAINTS, ids: RIDE_PAINT_IDS, setting: 'ridePaint', name: ridePaintName, icon: ridePaintIcon,
    root: 'shop-ridepaints', heading: 'shop-ridepaints-heading', headingKey: 'ridePaintHeading', toastKey: 'ridePaintBoughtToast', color: '#ff6a4a',
  },
  // Name + chat style (NameChatStyles.js).
  nameStyle: {
    items: NAME_STYLES, ids: NAME_STYLE_IDS, setting: 'nameStyle', name: nameStyleName, icon: nameStyleIcon,
    root: 'shop-namestyles', heading: 'shop-namestyles-heading', headingKey: 'nameStyleHeading', toastKey: 'nameStyleBoughtToast', color: '#ffd23f',
  },
  chatBubble: {
    items: CHAT_BUBBLES, ids: CHAT_BUBBLE_IDS, setting: 'chatBubble', name: chatBubbleName, icon: chatBubbleIcon,
    root: 'shop-chatbubbles', heading: 'shop-chatbubbles-heading', headingKey: 'chatBubbleHeading', toastKey: 'chatBubbleBoughtToast', color: '#ff8fd0',
  },
  profileFrame: {
    items: PROFILE_FRAMES, ids: PROFILE_FRAME_IDS, setting: 'profileFrame', name: profileFrameName, icon: profileFrameIcon,
    root: 'shop-frames', heading: 'shop-frames-heading', headingKey: 'profileFrameHeading', toastKey: 'profileFrameBoughtToast', color: '#c0c6ce',
  },
}
export const kindOfEffect = (id) => Object.keys(EFFECT_KINDS).find((k) => EFFECT_KINDS[k].items[id]) || ''

function card(game, kind, id) {
  const K = EFFECT_KINDS[kind]
  const price = K.items[id].price
  const have = ownsShopCosmetic(id)
  const using = have && game.settings?.[K.setting] === id
  const classes = ['inv-skin-card', 'shop-effect-card']
  if (have) classes.push('owned')
  else if ((game.coins || 0) < price) classes.push('cant-afford')
  if (using) classes.push('equipped')
  const label = using ? t('killFxUsing') : have ? t('killFxOwned') : game._formatSkinPrice('coins', price)
  return `<button type="button" class="${classes.join(' ')}" data-shop-effect="${id}" style="--rarity: ${K.color}">`
    + `<span class="inv-skin-card-name">${_escapeHtml(K.name(id))}</span>`
    + `<img class="shop-effect-img" src="${K.icon(id)}" alt="" draggable="false" />`
    + `<span class="inv-skin-card-price">${_escapeHtml(label)}</span>`
    + '</button>'
}

export function renderShopEffects(game) {
  for (const [kind, K] of Object.entries(EFFECT_KINDS)) {
    const root = document.getElementById(K.root)
    if (!root) continue
    bind(game, root)
    const heading = document.getElementById(K.heading)
    if (heading) heading.textContent = t(K.headingKey)
    root.innerHTML = K.ids.map((id) => card(game, kind, id)).join('')
  }
}

function bind(game, root) {
  if (root.dataset.bound) return
  root.dataset.bound = '1'
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-effect]')
    if (btn) buyOrUseEffect(game, btn.dataset.shopEffect)
  })
}

// Use (or stop using) an owned one.
export function toggleEffect(game, id) {
  const K = EFFECT_KINDS[kindOfEffect(id)]
  if (!K) return
  game.settings[K.setting] = game.settings[K.setting] === id ? '' : id
  saveSettings(game.settings)
  petLookChanged(game, K)
}

// The homepage pet wears the new pet hat / paint at once.
function petLookChanged(game, K) {
  if (K.setting === 'petHat' || K.setting === 'petPaint') game._refreshHomePet?.()
  // My name style / frame show at once on the homepage and in Profile.
  if (K.setting === 'nameStyle' || K.setting === 'profileFrame') applyMyNameLook(game)
}

export function buyOrUseEffect(game, id) {
  const K = EFFECT_KINDS[kindOfEffect(id)]
  if (!K) return
  if (ownsShopCosmetic(id)) {
    toggleEffect(game, id)
    renderShopEffects(game)
    return
  }
  const price = K.items[id].price
  const have = game.coins || 0
  if (have < price) {
    try { audioEngine.playUi?.('error') } catch { /* no audio */ }
    game._showHomepageToast(t('skinNeedCoins', { need: Math.ceil(price - have).toLocaleString() }))
    return
  }
  const name = K.name(id)
  if (needsBuyConfirm(game.settings, price) && !window.confirm(t('shopMoreSkinsConfirm', { name, price: game._formatSkinPrice('coins', price) }))) return
  game.coins -= price
  try { audioEngine.playUi?.('buy') } catch { /* no audio */ }
  if (!game.shopCosmetics || typeof game.shopCosmetics !== 'object') game.shopCosmetics = {}
  game.shopCosmetics[id] = 1
  game.settings[K.setting] = id
  saveSettings(game.settings)
  petLookChanged(game, K)
  game._afterTradeChange() // saves, refreshes the currency bar and Shop
  renderShopEffects(game)
  game._showHomepageToast(t(K.toastKey, { name }))
}

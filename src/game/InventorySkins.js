// Inventory > Character skins data and the flat card picture, moved out
// of Game.js (pure move, 2026-10-17). Game.js re-exports these so every
// existing import keeps working.
import { DEFAULT_SKIN_DATA_URL, SHOP_SKIN_PREVIEW_DATA_URL, ALISA_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { MARKET_SKINS, MARKET_PRICES } from './MarketSkins.js'

// Inventory > Character skins, in grid order. Adding a
// skin to the game = one entry here: its 64x64 skin texture,
// a rarity (colors the card's side bar) and how many the player owns
// (0 = not shown). An uploaded custom skin gets its own card on top of
// these while it's the one equipped (see _inventorySkinEntries).
export const INVENTORY_SKINS = [
  // The GayZ default skin is called Gaymi (a name, so not translated);
  // Alisa is the free girl skin next to it (2026-10-17).
  { id: 'default', name: 'Gaymi', rarity: 'common', dataUrl: DEFAULT_SKIN_DATA_URL, count: () => 1 },
  { id: 'alisa', name: 'Alisa', rarity: 'common', dataUrl: ALISA_SKIN_DATA_URL, count: () => 1 },
  // Sells back for half its 10,000-gem Shop price, in gems.
  { id: 'gaygarx', name: 'GaygarX', rarity: 'legendary', dataUrl: SHOP_SKIN_PREVIEW_DATA_URL, count: (g) => (g.ownsShopSkin ? 1 : 0), sell: { currency: 'gems', amount: 5000 } },
  // Market skins (MarketSkins.js): bought with coins, sold for half.
  ...MARKET_SKINS.map((skin) => ({
    ...skin,
    price: MARKET_PRICES[skin.rarity],
    count: (g) => Math.max(0, Math.floor(Number(g.charSkins?.[skin.id]) || 0)),
    sell: { currency: 'coins', amount: Math.floor(MARKET_PRICES[skin.rarity] / 2) },
  })),
]
export const SKIN_RARITIES = {
  common: { color: '#9aa0a6', key: 'skinRarityCommon' },
  uncommon: { color: '#4caf50', key: 'skinRarityUncommon' },
  rare: { color: '#2f80ed', key: 'skinRarityRare' },
  epic: { color: '#9b51e0', key: 'skinRarityEpic' },
  legendary: { color: '#f2a516', key: 'skinRarityLegendary' },
  mythic: { color: '#e5322d', key: 'skinRarityMythic' },
}

// Flat front view of a skin (head+hat, body, arms, legs) as a
// data URL - the card picture. Cached per texture.
const _skinFrontIconCache = new Map()
export function skinFrontIconURL(dataUrl) {
  if (_skinFrontIconCache.has(dataUrl)) return _skinFrontIconCache.get(dataUrl)
  const promise = new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // k = real pixels per skin pixel (HD skins are 128/256 wide).
      const k = Math.max(1, Math.round(img.width / 64))
      const legacy = img.height / k < 64 // old 64x32 skins: left limbs mirror the right ones
      const canvas = document.createElement('canvas')
      canvas.width = 16 * k
      canvas.height = 32 * k
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.imageSmoothingEnabled = false
      const part = (sx, sy, w, h, dx, dy, mirror = false) => {
        ;[sx, sy, w, h, dx, dy] = [sx, sy, w, h, dx, dy].map((n) => n * k)
        if (mirror) {
          ctx.save()
          ctx.translate(dx + w, dy)
          ctx.scale(-1, 1)
          ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)
          ctx.restore()
        } else ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h)
      }
      part(8, 8, 8, 8, 4, 0) // head
      part(40, 8, 8, 8, 4, 0) // hat layer
      part(20, 20, 8, 12, 4, 8) // body
      // Slim (3-pixel) arms: the arm's 4th front column is empty.
      const slim = !legacy && (() => {
        const probe = document.createElement('canvas')
        probe.width = 2 * k
        probe.height = 12 * k
        const pctx = probe.getContext('2d', { willReadFrequently: true })
        pctx.drawImage(img, 54 * k, 20 * k, 2 * k, 12 * k, 0, 0, 2 * k, 12 * k)
        const px = pctx.getImageData(0, 0, 2 * k, 12 * k).data
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) return false
        return true
      })()
      const aw = slim ? 3 : 4
      part(44, 20, aw, 12, 4 - aw, 8) // right arm (viewer's left)
      if (legacy) part(44, 20, 4, 12, 12, 8, true)
      else part(36, 52, aw, 12, 12, 8) // left arm
      part(4, 20, 4, 12, 4, 20) // right leg
      if (legacy) part(4, 20, 4, 12, 8, 20, true)
      else part(20, 52, 4, 12, 8, 20) // left leg
      resolve(canvas.toDataURL())
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
  _skinFrontIconCache.set(dataUrl, promise)
  return promise
}

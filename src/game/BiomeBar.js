// The top bar's picture (2026-10-18, Gaymi: "redesign the gayz, fps, ms etc
// dont make it old style make it more nature based on where the biome the
// player is in and when they go to a new biome naturely fade into the new
// biome colour", picked "biome textures"): the bar is made of the ground
// you're on - leaves in forests, sand in deserts, snow in the snow, water
// at sea, stone bricks in the city... TopBar.js cross-fades it.
//
// Lives with the Map Editor's code (BuildMode.js loads it) since it needs
// the block pictures; TopBar asks bm.biomeBarLook().
import { blockFaceCanvases } from './BlockTextures.js'
import { sampleLand, inCity, isFlatWorld } from './OpenWorld.js'

// Which block's picture each biome's bar uses.
const BIOME_BLOCK = {
  ocean: 'water', deepOcean: 'water', warmOcean: 'water', river: 'water', frozenOcean: 'packedice',
  beach: 'sand', desert: 'sand', snowyBeach: 'snow', snowyPlains: 'snow', snowyTaiga: 'snow', snowyPeaks: 'snow', iceSpikes: 'packedice',
  plains: 'grass', savanna: 'grass', mushroomFields: 'mycelium', badlands: 'redsand', mountains: 'stone',
  forest: 'leaves', darkForest: 'leaves', birchForest: 'birchleaves', taiga: 'spruceleaves', cherryGrove: 'cherryleaves',
  jungle: 'jungleleaves', bambooJungle: 'jungleleaves', swamp: 'mangroveleaves', mangroveSwamp: 'mangroveleaves',
}
const CITY_BLOCK = 'stonebricks'
const TILE = 48

const urls = new Map()
// The picture as a data URL: the block's top face, scaled up crisp, with a
// faint dark wash so the bar's white text stays easy to read.
function pictureOf(type) {
  if (urls.has(type.id)) return urls.get(type.id)
  const face = blockFaceCanvases(type).top
  const c = document.createElement('canvas')
  c.width = c.height = TILE
  const ctx = c.getContext('2d')
  // Leaves and water have see-through bits: a dark ground behind them.
  ctx.fillStyle = '#1d2418'
  ctx.fillRect(0, 0, TILE, TILE)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(face, 0, 0, TILE, TILE)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.fillRect(0, 0, TILE, TILE)
  const url = c.toDataURL()
  urls.set(type.id, url)
  return url
}

// { key, url } for the spot (x, z), or null outside the open world.
export function biomeBarLook(bm, x, z) {
  if (!bm.world?.active) return null
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  const id = inCity(cx, cz) && !isFlatWorld() ? CITY_BLOCK : BIOME_BLOCK[sampleLand(cx, cz).biome] || 'grass'
  const type = bm.blockTypeOf?.(id)
  if (!type) return null
  return { key: id, url: pictureOf(type) }
}

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
import { oppositeInk } from './CleanTheme.js'

// Which block's picture each biome's bar uses.
const BIOME_BLOCK = {
  ocean: 'water', deepOcean: 'water', warmOcean: 'water', river: 'water', frozenOcean: 'packedice',
  beach: 'sand', desert: 'sand', snowyBeach: 'snow', snowyPlains: 'snow', snowyTaiga: 'snow', snowyPeaks: 'snow', iceSpikes: 'packedice',
  plains: 'grass', savanna: 'grass', mushroomFields: 'mycelium', badlands: 'redsand', mountains: 'stone',
  forest: 'leaves', darkForest: 'leaves', birchForest: 'birchleaves', taiga: 'spruceleaves', cherryGrove: 'cherryleaves',
  jungle: 'jungleleaves', bambooJungle: 'jungleleaves', swamp: 'mangroveleaves', mangroveSwamp: 'mangroveleaves',
}
const CITY_BLOCK = 'stonebricks'
// The highlight colour that goes with each picture (titles, the picked
// slot, bars) on the game's biome-styled screens (play-biome.css).
const ACCENT = {
  water: '#7fd6ff', packedice: '#bfe9ff', sand: '#ffd27a', redsand: '#ff9f5a', snow: '#e6f3ff', grass: '#b6f06a',
  mycelium: '#d9a7ff', stone: '#d6dbe0', leaves: '#9be36b', birchleaves: '#d4f07a', spruceleaves: '#8fd9a0',
  cherryleaves: '#ffb3d1', jungleleaves: '#7cf07a', mangroveleaves: '#b4d96b', stonebricks: '#ffe38a',
}
const TILE = 48

const urls = new Map()
const colours = new Map()
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

// The picture's own colour (its average) and the opposite text colour that
// reads on it, the way the Simple theme picks its ink (2026-10-26, Gaymi:
// "use opposite colours like the simple theme because you cant really see
// in some colours for the biome"). Game screens are filled with the
// colour, the picture only faintly showing through.
function coloursOf(type) {
  if (colours.has(type.id)) return colours.get(type.id)
  const face = blockFaceCanvases(type).top
  const c = document.createElement('canvas')
  c.width = c.height = 8
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#1d2418'
  ctx.fillRect(0, 0, 8, 8)
  ctx.drawImage(face, 0, 0, 8, 8)
  const px = ctx.getImageData(0, 0, 8, 8).data
  const avg = [0, 0, 0]
  for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) avg[k] += px[i + k]
  const mid = avg.map((v) => v / 64)
  const ink = oppositeInk(mid.map(Math.round))
  // Mid-tone colours (badlands orange) read badly either way, so the box
  // is pushed away from its ink: darker under light text, lighter under
  // dark text.
  const lightInk = ink[0] + ink[1] + ink[2] > 382
  const bg = mid.map((v) => Math.round(lightInk ? v * 0.55 : v + (255 - v) * 0.45))
  const out = { bg: bg.join(', '), ink: ink.join(', ') }
  colours.set(type.id, out)
  return out
}

// { key, url, accent, bg, ink } for the spot (x, z), or null outside the open world.
export function biomeBarLook(bm, x, z) {
  if (!bm.world?.active) return null
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  const id = inCity(cx, cz) && !isFlatWorld() ? CITY_BLOCK : BIOME_BLOCK[sampleLand(cx, cz).biome] || 'grass'
  const type = bm.blockTypeOf?.(id)
  if (!type) return null
  return { key: id, url: pictureOf(type), accent: ACCENT[id] || '#ffe38a', ...coloursOf(type) }
}

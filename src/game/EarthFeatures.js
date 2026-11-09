// Names of big real places you walk past in the World Map mode
// (2026-10-23, Gaymi: "name every big mountain, ocean, big anything you
// walk by in world map the name like amazon river"). BuildTryMode shows
// the name as a title that fades in when you arrive, and under the map
// while you're there.
//
// Shapes are rough on purpose - a few points per river or range, a box
// per desert or sea - so the lookup is cheap: peaks are circles, rivers
// and mountain ranges are lines with a width, seas, lakes, deserts and
// forests are [south, north, west, east] boxes. Earlier entries win, so
// the small specific places come before the big ones around them.
// Points are [lat, lon]. Each id's name is the i18n key `feat_<id>`.

const PEAKS = [
  ['everest', 27.99, 86.93, 0.4], ['k2', 35.88, 76.51, 0.35], ['kilimanjaro', -3.07, 37.35, 0.35],
  ['matterhorn', 45.98, 7.66, 0.15], ['montblanc', 45.83, 6.86, 0.2], ['fuji', 35.36, 138.73, 0.3],
  ['denali', 63.07, -151.0, 0.4], ['aconcagua', -32.65, -70.01, 0.35], ['elbrus', 43.35, 42.44, 0.3],
  ['grandcanyon', 36.1, -112.1, 0.5],
]

// Water: lakes first, then the seas, then (oceanAt) the oceans.
const LAKES = [
  ['superior', [46.4, 49.0, -92.2, -84.4]], ['michigan', [41.6, 46.1, -88.0, -84.8]], ['huron', [43.0, 46.3, -84.8, -79.7]],
  ['victoria', [-3.0, 0.5, 31.5, 34.9]], ['caspian', [36.5, 47.2, 46.5, 54.8]],
]
const BAIKAL = [[51.5, 104], [53, 107], [55.8, 109.6]]
const SEAS = [
  ['blackSea', [40.9, 46.8, 27.4, 41.8]], ['redSea', [12.5, 30, 32, 43.5]], ['persianGulf', [24, 30.5, 47.5, 56.5]],
  ['baltic', [53.5, 66, 9.5, 30.5]], ['northSea', [51, 61, -4, 9.5]], ['mediterranean', [30, 46, -5.6, 36.5]],
  ['gulfMexico', [18, 31, -98, -81]], ['caribbean', [9, 22, -88, -60]], ['southChinaSea', [0, 23, 105, 121]],
  ['bengal', [5, 23, 80, 95]], ['arabianSea', [5, 25, 55, 75]],
]

const RIVERS = [
  ['amazonRiver', [[-4.3, -73.3], [-3.4, -68], [-3.1, -60], [-2.3, -56], [-1.9, -54], [-0.5, -51], [0, -50]]],
  ['nile', [[4.5, 31.6], [9.5, 30.5], [15.6, 32.5], [19, 33], [22, 31.5], [24, 32.9], [27.2, 31.2], [30, 31.2], [31.4, 31]]],
  ['mississippi', [[47.2, -95.2], [44.9, -93.2], [41.5, -90.6], [38.6, -90.2], [35.1, -90.1], [32.3, -90.9], [30, -90.1], [29.2, -89.3]]],
  ['yangtze', [[33, 91], [30.5, 97.5], [28, 99.5], [26.6, 101.7], [29.5, 106.5], [30.6, 111.3], [30.6, 114.3], [31.4, 121.5]]],
  ['ganges', [[30, 78.3], [25.4, 81.9], [25.3, 83], [25.6, 85.1], [24.8, 87.9], [23, 89.5], [22, 90.5]]],
  ['danube', [[48, 8.5], [48.4, 10], [48.6, 13], [48.2, 16.4], [47.5, 19], [45.3, 19.8], [44.8, 20.5], [44.6, 22.5], [43.7, 24.7], [44, 27], [45.2, 29.6]]],
  ['rhine', [[46.6, 9.5], [47.6, 7.6], [49, 8.3], [50, 8.2], [50.9, 6.9], [51.8, 6], [51.9, 4.1]]],
  ['volga', [[57, 34], [57.6, 39.9], [56.3, 44], [55.8, 49.1], [53.2, 50.1], [51.5, 46], [48.7, 44.5], [46.3, 48]]],
  ['mekong', [[33, 94.5], [28, 98.7], [22, 100.5], [20.3, 100.1], [17.9, 102.6], [15.1, 105.8], [11.6, 104.9], [10, 106.5]]],
  ['congoRiver', [[-11, 27], [-5, 26.5], [0.5, 25.2], [1.6, 23], [0, 18], [-4.3, 15.3], [-6, 12.3]]],
  ['colorado', [[40.5, -105.8], [39, -108.5], [36.1, -112], [36, -114.7], [32.7, -114.6]]],
]
const RIVER_NEAR = 1.2 // degrees from the rough line

// Land: mountain ranges (lines with a width), then deserts and forests.
const RANGES = [
  ['himalayas', 1.4, [[35.5, 74], [34, 77], [31, 79], [29, 82], [28, 86], [27.8, 89], [27.5, 92], [28, 95]]],
  ['alps', 0.8, [[44.1, 7], [45.9, 7], [46.5, 8.5], [46.8, 10.5], [47.2, 12.5], [47.4, 14], [47.6, 16]]],
  ['andes', 1.6, [[10, -73], [4, -76], [-2, -78.5], [-10, -77], [-16, -72], [-20, -68.5], [-27, -68.5], [-33, -70], [-40, -71.5], [-50, -73.3]]],
  ['rockies', 2.2, [[60, -125], [55, -121], [51, -116], [47, -113], [44, -110], [40, -106], [37, -106], [35, -105.5]]],
  ['urals', 1.2, [[68, 66], [62, 59.5], [57, 59.5], [52, 58.5]]],
]
const REGIONS = [
  ['taklamakan', [36.5, 41, 77, 89]], ['gobi', [39.5, 46, 96, 112]], ['atacama', [-27, -18, -71, -68.5]],
  ['kalahari', [-27, -19, 18, 25.5]], ['arabianDesert', [16, 30, 39, 56]], ['sahara', [16, 32, -15, 33]],
  ['outback', [-32, -19, 118, 145]], ['amazonForest', [-12, 4, -75, -50]], ['congoForest', [-5, 5, 12, 29]],
  ['siberia', [52, 72, 60, 140]],
]

export const FEATURE_IDS = [...PEAKS.map((p) => p[0]), ...LAKES.map((l) => l[0]), 'baikal', ...SEAS.map((s) => s[0]), 'pacific', 'atlantic', 'indian', 'arctic', 'southern', ...RIVERS.map((r) => r[0]), ...RANGES.map((r) => r[0]), ...REGIONS.map((r) => r[0])]

const inBox = (lat, lon, [s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e
// Degrees from a point to a line of points (longitude squeezed toward the
// poles, so distances read the same everywhere).
function lineDist(lat, lon, pts) {
  const k = Math.cos((lat * Math.PI) / 180)
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [ay, ax0] = pts[i - 1]
    const [by, bx0] = pts[i]
    const ax = ax0 * k
    const bx = bx0 * k
    const px = lon * k
    const dx = bx - ax
    const dy = by - ay
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / len)) : 0
    best = Math.min(best, Math.hypot(ax + dx * t - px, ay + dy * t - lat))
  }
  return best
}

// The oceans, roughly by where they lie.
function oceanAt(lat, lon) {
  if (lat > 66) return 'arctic'
  if (lat < -60) return 'southern'
  if ((lon >= 20 && lon < 120 && lat < 30) || (lon >= 120 && lon < 147 && lat < -10)) return 'indian'
  if (lat > 8 ? lon > -100 && lon < 20 : lon > -70 && lon < 20) return 'atlantic'
  return 'pacific'
}

// The big place at a spot ('' for none). water: the spot is sea or lake
// water; river: it's on or by a river.
export function featureAt(lat, lon, { water = false, river = false } = {}) {
  for (const [id, plat, plon, r] of PEAKS) if (Math.hypot(lat - plat, (lon - plon) * Math.cos((lat * Math.PI) / 180)) < r) return id
  // (Rivers before seas: the Nile at Cairo is inside the Mediterranean's box.)
  if (river) for (const [id, pts] of RIVERS) if (lineDist(lat, lon, pts) < RIVER_NEAR) return id
  if (water) {
    for (const [id, box] of LAKES) if (inBox(lat, lon, box)) return id
    if (lineDist(lat, lon, BAIKAL) < 0.6) return 'baikal'
    if (river) return ''
    for (const [id, box] of SEAS) if (inBox(lat, lon, box)) return id
    return oceanAt(lat, lon)
  }
  for (const [id, width, pts] of RANGES) if (lineDist(lat, lon, pts) < width) return id
  for (const [id, box] of REGIONS) if (inBox(lat, lon, box)) return id
  return ''
}

#!/usr/bin/env python3
"""Makes src/game/EarthMapData.js: Earth as a half-degree grid of GayZ biomes.

Biomes come from the real climate map (Koeppen-Geiger, 1951-2000, 0.5 deg,
Kottek et al. 2006, free to use with credit), so deserts, jungles, forests,
taiga and tundra have their real shapes instead of hand-placed boxes
(2026-10-24, Gaymi: "dont make it like a square or rectangle make it based on
real life how the biome is"). Sea cells keep the old grid's kind of sea.

Usage: python3 scripts/make-earth-biomes.py path/to/Koeppen-Geiger-ASCII.txt
(from http://koeppen-geiger.vu-wien.ac.at/data/Koeppen-Geiger-ASCII.zip)
"""
import json
import re
import sys

OUT = 'src/game/EarthMapData.js'
W, H = 720, 360
BIOMES = ["ocean", "deepOcean", "frozenOcean", "warmOcean", "beach", "snowyBeach", "river", "plains", "forest",
          "birchForest", "darkForest", "cherryGrove", "taiga", "snowyTaiga", "snowyPlains", "iceSpikes", "desert",
          "savanna", "badlands", "jungle", "bambooJungle", "swamp", "mangroveSwamp", "mushroomFields", "mountains",
          "snowyPeaks"]
WATER = {"ocean", "deepOcean", "frozenOcean", "warmOcean", "river"}

# Climate class -> biome.
CLIMATE = {
    'Af': 'jungle', 'Am': 'jungle', 'Aw': 'savanna', 'As': 'savanna',
    'BWh': 'desert', 'BWk': 'desert', 'BSh': 'savanna', 'BSk': 'plains',
    'Cfa': 'forest', 'Cfb': 'forest', 'Cfc': 'taiga',
    'Csa': 'plains', 'Csb': 'plains', 'Csc': 'taiga',
    'Cwa': 'forest', 'Cwb': 'plains', 'Cwc': 'taiga',
    'Dfa': 'forest', 'Dfb': 'birchForest', 'Dfc': 'taiga', 'Dfd': 'snowyTaiga',
    'Dsa': 'plains', 'Dsb': 'forest', 'Dsc': 'taiga', 'Dsd': 'snowyTaiga',
    'Dwa': 'forest', 'Dwb': 'birchForest', 'Dwc': 'taiga', 'Dwd': 'snowyTaiga',
    'ET': 'snowyPlains', 'EF': 'snowyPlains',
}


def box(lat, lon, s, n, w, e):
    return s <= lat <= n and w <= lon <= e


def special(cls, lat, lon, coast):
    """A few well-known places get the GayZ biome that fits them best."""
    # Red rock deserts: the American Southwest and the Australian outback.
    if cls in ('BWh', 'BWk', 'BSk') and box(lat, lon, 30, 40, -118, -103):
        return 'badlands'
    if cls == 'BWh' and box(lat, lon, -32, -18, 118, 140):
        return 'badlands'
    # Bamboo forests of southern China and Southeast Asia's hills.
    if cls in ('Cwa', 'Cfa', 'Am') and box(lat, lon, 18, 30, 98, 118):
        return 'bambooJungle'
    # Cherry blossoms in Japan and Korea.
    if cls in ('Cfa', 'Dfa', 'Dwa') and box(lat, lon, 31, 41, 126, 142):
        return 'cherryGrove'
    # The Gulf Coast bayous and the Everglades.
    if cls in ('Cfa', 'Aw', 'Am') and box(lat, lon, 25, 32, -95, -80):
        return 'swamp'
    # Wet lowland swamps: the Pantanal, the Sudd, western Siberia's bogs.
    if box(lat, lon, -20, -15, -58, -55) or box(lat, lon, 6, 9.5, 29.5, 32) or (cls == 'Dfc' and box(lat, lon, 57, 63, 65, 80)):
        return 'swamp'
    # Dark old-growth forests: the Pacific Northwest, the Black Forest and
    # Central Europe's hills.
    if cls in ('Cfb', 'Csb', 'Dfb') and (box(lat, lon, 42, 52, -125, -120) or box(lat, lon, 47, 51, 7, 18)):
        return 'darkForest'
    # Tropical coasts: mangroves.
    if coast and cls in ('Af', 'Am') and abs(lat) < 25:
        return 'mangroveSwamp'
    return CLIMATE[cls]


def old_grid():
    src = open(OUT).read()
    rle = re.search(r'EARTH_RLE = ["\x27]([^"\x27]*)["\x27]', src).group(1)
    old_biomes = re.search(r'EARTH_BIOMES = (\[[^\]]*\])', src).group(1)
    names = json.loads(old_biomes)
    out = []
    for n, b in re.findall(r'(\d*)([a-z])', rle):
        out += [names[ord(b) - 97]] * int(n or 1)
    ow = int(re.search(r'EARTH_W = (\d+)', src).group(1))
    return out, ow


def main():
    cls = {}
    for line in open(sys.argv[1]):
        p = line.split()
        if len(p) != 3 or p[0] == 'Lat':
            continue
        lat, lon = float(p[0]), float(p[1])
        j = int((90 - lat) * 2)
        i = int((lon + 180) * 2)
        cls[(i, j)] = p[2]
    old, ow = old_grid()
    k = ow // 360 if ow >= 360 else 1
    oh = len(old) // ow

    def old_at(i, j):
        # Old grid cell for this half-degree cell.
        oi = int(i / W * ow) % ow
        oj = min(oh - 1, int(j / H * oh))
        return old[oj * ow + oi]

    grid = []
    for j in range(H):
        for i in range(W):
            lat = 90 - (j + 0.5) / 2
            lon = -180 + (i + 0.5) / 2
            c = cls.get((i, j))
            if c is None:
                o = old_at(i, j)
                if o not in WATER:
                    o = 'frozenOcean' if abs(lat) > 62 else 'warmOcean' if abs(lat) < 23 else 'ocean'
                grid.append(o)
                continue
            coast = any((i + di, j + dj) not in cls for di in (-1, 0, 1) for dj in (-1, 0, 1))
            grid.append(special(c, lat, lon, coast))
    # Run-length code it.
    parts = []
    run = 1
    for n in range(1, len(grid) + 1):
        if n < len(grid) and grid[n] == grid[n - 1]:
            run += 1
            continue
        letter = chr(97 + BIOMES.index(grid[n - 1]))
        parts.append((str(run) if run > 1 else '') + letter)
        run = 1
    rle = ''.join(parts)
    with open(OUT, 'w') as f:
        f.write('// Earth as a half-degree grid of GayZ biomes (720 x 360 cells, west to\n')
        f.write('// east from -180, north to south from +90), for the World Map mode\'s\n')
        f.write('// land (OpenWorld.js) and the spawn map (SpawnMap.js). Made by\n')
        f.write('// scripts/make-earth-biomes.py from the real climate map (Koeppen-Geiger,\n')
        f.write('// Kottek et al. 2006): jungle where it\'s tropical rainforest, desert where\n')
        f.write('// it\'s desert, taiga and tundra in the far north, a few well-known places\n')
        f.write('// (bayous, cherry blossoms, bamboo, red-rock deserts) picked by hand.\n')
        f.write('// Run-length coded: a count (none = 1) before each biome letter\n')
        f.write('// (EARTH_BIOMES order).\n')
        f.write(f'export const EARTH_W = {W}\n')
        f.write(f'export const EARTH_H = {H}\n')
        f.write('export const EARTH_BIOMES = ' + str(BIOMES).replace("'", '"') + '\n')
        f.write(f'export const EARTH_RLE = "{rle}"\n')
    print(len(rle), 'chars')


main()

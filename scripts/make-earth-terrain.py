# Makes the World Map mode's real heights, lakes and rivers (2026-10-23,
# Gaymi: "the map is based on real life geographies like rivers mountains
# all should be based on real life ... not just random generated").
#
# Inputs (all public / free to use):
#   - Terrarium elevation tiles, zoom 4 (Mapzen / AWS "elevation-tiles-prod"),
#     https://s3.amazonaws.com/elevation-tiles-prod/terrarium/4/{x}/{y}.png
#     saved as <tiles>/{x}-{y}.png (all 16 x 16).
#   - Natural Earth ne_10m_lakes.geojson and
#     ne_10m_rivers_lake_centerlines.geojson.
#   python3 scripts/make-earth-terrain.py <tiles dir> <lakes> <rivers>
#
# Writes:
#   public/earth/height.png - 1440 x 720 grey picture, one pixel per 0.25
#     degree (pixel (i, j) centred on lon -180 + (i + .5) / 4, lat
#     90 - (j + .5) / 4). Value v >= 128 is land at 8848 m * ((v - 128) / 127)^2,
#     v < 128 is sea (11000 m * ((127 - v) / 127)^2 deep). EarthTerrain.js
#     reads it back.
#   public/earth/water.json - { l: [[level m, ring, ring...], ...], r: [[size,
#     line], ...] }. Rings/lines are [lon100, lat100, dlon, dlat, ...]
#     (hundredths of a degree, each point after the first a step from the
#     one before - the same as the province files). size 0 (big) .. 3 (small).
import json
import math
import os
import sys

import numpy as np
from PIL import Image

tiles_dir, lakes_path, rivers_path = sys.argv[1:4]
out_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'earth')
Z = 4
N = 2 ** Z
T = 256
Q = 4  # pixels per degree

# The whole zoom-4 Mercator picture, in metres.
merc = np.zeros((N * T, N * T), dtype=np.float32)
for x in range(N):
    for y in range(N):
        a = np.asarray(Image.open(os.path.join(tiles_dir, f'{x}-{y}.png')).convert('RGB'), dtype=np.float32)
        merc[y * T:(y + 1) * T, x * T:(x + 1) * T] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768

W, H = 360 * Q, 180 * Q
S = 4  # samples per pixel side
sub = (np.arange(S) + 0.5) / S
lon = -180 + (np.arange(W)[:, None] + sub[None, :]).reshape(-1) / Q
lat = 90 - (np.arange(H)[:, None] + sub[None, :]).reshape(-1) / Q
lat_c = np.clip(lat, -85.05, 85.05)
mx = np.clip(((lon + 180) / 360 * N * T).astype(int), 0, N * T - 1)
my = np.clip(((1 - np.log(np.tan(np.radians(lat_c)) + 1 / np.cos(np.radians(lat_c))) / math.pi) / 2 * N * T).astype(int), 0, N * T - 1)
samples = merc[my[:, None], mx[None, :]].reshape(H, S, W, S)
mean = samples.mean(axis=(1, 3))
top = samples.max(axis=(1, 3))
# Peaks matter (snow, ranges you can see), so lean a little to the highest.
elev = np.where(mean > 0, mean * 0.65 + top * 0.35, mean)

land = np.clip(elev, 0, 8848)
sea = np.clip(-elev, 0, 11000)
v = np.where(elev >= 0, 128 + np.round(127 * np.sqrt(land / 8848)), 127 - np.round(127 * np.sqrt(sea / 11000)))
Image.fromarray(v.astype(np.uint8)).save(os.path.join(out_dir, 'height.png'), optimize=True)


def height_at(la, lo):
    i = min(W - 1, max(0, int((lo + 180) * Q)))
    j = min(H - 1, max(0, int((90 - la) * Q)))
    return float(elev[j, i])


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for k in range(a + 1, b):
            d = abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def code(pts):
    out = []
    px = py = 0
    for k, (x, y) in enumerate(pts):
        qx, qy = round(x * 100), round(y * 100)
        if k == 0:
            out += [qx, qy]
        elif qx != px or qy != py:
            out += [qx - px, qy - py]
        else:
            continue
        px, py = qx, qy
    return out


def inside(ring, x, y):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


lakes = []
for f in json.load(open(lakes_path))['features']:
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        # A closed ring starts and ends on the same point, so simplify its
        # two halves.
        rings = []
        for r in poly:
            pts = [tuple(p[:2]) for p in r]
            h = len(pts) // 2
            rings.append(simplify(pts[:h + 1], 0.01)[:-1] + simplify(pts[h:], 0.01))
        if len(rings[0]) < 4:
            continue
        xs = [p[0] for p in rings[0]]
        ys = [p[1] for p in rings[0]]
        # The lake's surface: the middle of the heights found inside it.
        hs = []
        for j in range(int((90 - max(ys)) * Q), int((90 - min(ys)) * Q) + 1):
            for i in range(int((min(xs) + 180) * Q), int((max(xs) + 180) * Q) + 1):
                lo, la = -180 + (i + 0.5) / Q, 90 - (j + 0.5) / Q
                if inside(rings[0], lo, la):
                    hs.append(height_at(la, lo))
        if not hs:
            hs = [height_at(sum(ys) / len(ys), sum(xs) / len(xs))]
        level = round(float(np.median(hs)))
        lakes.append([level] + [code(r) for r in rings if len(r) >= 4])

rivers = []
for f in json.load(open(rivers_path))['features']:
    p = f['properties']
    if p['featurecla'] != 'River':
        continue
    rank = p['scalerank'] or 0
    size = 0 if rank <= 2 else 1 if rank <= 4 else 2 if rank <= 6 else 3
    g = f['geometry']
    lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    for line in lines:
        pts = simplify([tuple(q[:2]) for q in line], 0.015)
        if len(pts) >= 2:
            rivers.append([size, code(pts)])

with open(os.path.join(out_dir, 'water.json'), 'w') as fh:
    json.dump({'l': lakes, 'r': rivers}, fh, separators=(',', ':'))
print('lakes', len(lakes), 'rivers', len(rivers))

// "In Real Life" graphics: rounded and natural-looking blocks.
// Split out of the old buildmode.spec.js (2026-11-16) so a change only
// runs (and reads) the tests for its own area.
import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// 2026-10-26: less blocky land on Realistic/Ultra/In Real Life (smooth
// hills, rounded edges, pebbles, leafy trees), animals with painted eyes
// and rounder bodies on In Real Life.
test('bumpy block tops and rounded edges on the top levels', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A one-block step: a 3x3 clay floor with one more clay on top
    // (clay: no little rocks lie on it). Checked on Detailed, the best
    // level without real-life ground - on the top 3 every natural block
    // rounds off into real land now (RealGround.js, own tests below).
    for (let x = 40; x < 43; x++) for (let z = 40; z < 43; z++) bm._placeBlockInner(x, 0, z, 'clay')
    bm._placeBlockInner(41, 1, 41, 'clay')
    // Every vertex height's part above the whole block under it.
    const fracs = () => {
      ch.flush(bm._chunkCells)
      const f = []
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 1; i < pos.array.length; i += 3) {
            const S = bm._chunks.blockSize
            const x = (pos.array[i - 1] + m.position.x) / S
            const z = (pos.array[i + 1] + m.position.z) / S
            // Only the test blocks (the ground round them has rocks on it).
            if (x < 40 || x > 43 || z < 40 || z > 43) continue
            const y = (pos.array[i] + m.position.y) / S
            // Not the grass under them: on the top levels grass and dirt
            // are real-life ground and round off below block tops on
            // purpose (RealGround.js, own test below).
            if (y < 0.5) continue
            f.push(Math.round((y - Math.floor(y + 0.001)) * 1000) / 1000)
          }
        }
      }
      return f
    }
    g._applyGraphicsLevel('detailed')
    bm._applyGraphicsLook()
    const irl = fracs()
    // Bumps rise a little (0.02..0.1 of a block) above flat tops; nothing
    // dips below a block's top, so every step stays a clean one-block step.
    out.irl = [ch.shapes, ch.fx.round.value, irl.length === 0 || irl.some((f) => f > 0.015), irl.every((f) => f < 0.105 || f > 0.99)]
    out.bad = [...new Set(irl.filter((f) => !(f < 0.105 || f > 0.99)))].slice(0, 20)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const simple = fracs()
    out.simple = [ch.shapes, ch.fx.round.value, simple.some((f) => f > 0.015 && f < 0.99)]
    g._exitBuildMode()
    return out
  })
  // Uploaded chunk geometry may drop its arrays (dropAfterUpload), so the
  // bump check only counts when the arrays were still there.
  expect(r.irl, JSON.stringify(r.bad)).toEqual([true, 0.35, true, true])
  expect(r.simple).toEqual([false, 0, false])
})

test('real-life ground: grass and dirt round into one piece on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone dirt block up in the air, and a grass block with planks on
    // one side (where they meet, the grass must not move).
    bm._placeBlockInner(60, 5, 60, 'dirt')
    bm._placeBlockInner(70, 5, 70, 'grass')
    bm._placeBlockInner(71, 5, 70, 'oakplanks')
    const verts = (x0, z0) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.amt = ch.realAmt
    const lone = verts(60, 60)
    // Its corners round in: no point reaches the cube's top corners.
    out.rounded = lone.length === 0 || lone.every(([x, y, z]) => !(y > 5.97 && (x < 60.03 || x > 60.97) && (z < 60.03 || z > 60.97)))
    // The real top as GrassTufts/cracks see it, and the planks' corner.
    out.grid = !!ch.realFaceGrids(60, 5, 60) && ch.realFaceGrids(61, 5, 60) === null
    const L = ch.realTopLattice(70, 5, 70)
    const p = ch.realTopPoint(L, 70, 5, 70, 1, 0)
    out.pinned = [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000]
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    out.simpleAmt = ch.realAmt
    const flat = verts(60, 60)
    out.simpleCube = flat.length === 0 || flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    g._exitBuildMode()
    return out
  })
  expect(r.amt).toBe(1)
  // Uploaded chunk geometry may drop its arrays (dropAfterUpload); the
  // vertex checks count whenever the arrays were still there.
  expect(r.rounded).toBe(true)
  expect(r.grid).toBe(true)
  expect(r.pinned).toEqual([71, 6, 70])
  expect(r.simpleAmt).toBe(0)
  expect(r.simpleCube).toBe(true)
})

test('real-life trees: leaves join into one bushy top, logs turn round, on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A little tree up in the air: 2 logs, a 3x3 leaf layer on top.
    bm._placeBlockInner(80, 5, 80, 'oaklog')
    bm._placeBlockInner(80, 6, 80, 'oaklog')
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) bm._placeBlockInner(80 + dx, 7, 80 + dz, dx || dz ? 'leaves' : 'birchleaves')
    const verts = (y0, y1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > 78 && x < 83 && z > 78 && z < 83 && y > y0 && y < y1) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    // Trunk: every point within the round, none at the square's corners.
    const trunk = verts(5.01, 6.3)
    out.round = trunk.every(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) < 0.505)
    out.trunkPts = trunk.length
    out.badTrunk = trunk.filter(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) >= 0.505).slice(0, 6).map((p) => p.map((k) => Math.round(k * 100) / 100))
    // Crown: the 3x3 layer's outside corners are rounded in (the clumps
    // stick out, but never reach the square crown's top corners).
    const crown = verts(6.99, 8.6)
    out.crownRounded = crown.every(([x, y, z]) => !(y > 7.97 && (x < 79.03 || x > 81.97) && (z < 79.03 || z > 81.97)))
    out.grid = !!ch.realFaceGrids(80, 7, 80) && !!ch.realFaceGrids(79, 7, 79)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(5.01, 6.3)
    out.simpleSquare = flat.some(([x, , z]) => Math.hypot(x - 80.5, z - 80.5) > 0.6)
    out.simpleGrid = ch.realFaceGrids(80, 7, 80) === null
    g._exitBuildMode()
    return out
  })
  expect(r.round, JSON.stringify(r.badTrunk)).toBe(true)
  expect(r.crownRounded).toBe(true)
  expect(r.grid).toBe(true)
  expect(r.simpleGrid).toBe(true)
  // Vertex checks count whenever the arrays were still there.
  if (r.trunkPts) expect(r.simpleSquare).toBe(true)
})

test('real-life nature extras: round stems, cactus, hay, pumpkins, melons, bumpy blobs, more rock, top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // Each one up in the air on its own spot (x = z = the spot).
    const ROUND = { crimsonstem: 90, cactus: 94, haybale: 98, pumpkin: 102, melon: 106 }
    for (const [id, at] of Object.entries(ROUND)) {
      bm._placeBlockInner(at, 5, at, id)
      if (id === 'cactus' || id === 'haybale') bm._placeBlockInner(at, 6, at, id)
    }
    // A 2x2 nether wart cap.
    for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) bm._placeBlockInner(110 + dx, 5, 110 + dz, 'netherwartblock')
    const verts = (x0, x1, y0, y1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 && x < x1 && z > x0 && z < x1 && y > y0 && y < y1) v.push([x, y, z])
          }
        }
      }
      return v
    }
    const around = (at, h) => verts(at - 1, at + 2, 4.5, 5 + h + 0.5)
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.round = {}
    out.pts = {}
    for (const [id, at] of Object.entries(ROUND)) {
      const v = around(at, id === 'cactus' || id === 'haybale' ? 2 : 1)
      out.pts[id] = v.length
      out.round[id] = v.every(([x, , z]) => Math.hypot(x - at - 0.5, z - at - 0.5) < 0.505)
    }
    // Pumpkins sit squat; melons are fatter in the middle than at the ends.
    const pv = around(102, 1)
    out.pumpkinTop = pv.length ? Math.max(...pv.map((p) => p[1])) : 0
    const mv = around(106, 1)
    const rAt = (v, at, lo, hi) => Math.max(0, ...v.filter((p) => p[1] > lo && p[1] < hi).map(([x, , z]) => Math.hypot(x - at - 0.5, z - at - 0.5)))
    out.melonMid = rAt(mv, 106, 5.4, 5.6)
    out.melonEnd = rAt(mv, 106, 5.93, 5.96)
    // Blob: the cap's outside top corners round in, and it has a real crack shape.
    const bv = verts(109.5, 112.5, 4.5, 6.5)
    out.blobPts = bv.length
    out.blobRounded = bv.every(([x, y, z]) => !(y > 5.97 && (x < 110.03 || x > 111.97) && (z < 110.03 || z > 111.97)))
    out.blobGrid = !!ch.realFaceGrids(110, 5, 110)
    const I = (id) => ch.info.get(id) || {}
    out.rock = ['amethystblock', 'magmablock', 'glowstone', 'ancientdebris', 'rawironblock', 'rawgoldblock', 'rawcopperblock'].every((id) => I(id).real && I(id).rock)
    out.glowKept = I('magmablock').glow && I('glowstone').glow
    out.blobs = ['redmushroomblock', 'brownmushroomblock', 'warpedwartblock', 'tubecoralblock', 'horncoralblock', 'sculk'].every((id) => I(id).blob)
    // Glow lights stay plain cubes.
    out.plain = !I('shroomlight').real && !I('shroomlight').blob && !I('jackolantern').log && !I('sealantern').real
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = around(102, 1)
    out.simpleSquare = flat.some(([x, , z]) => Math.hypot(x - 102.5, z - 102.5) > 0.6)
    out.simpleGrid = ch.realFaceGrids(110, 5, 110) === null
    g._exitBuildMode()
    return out
  })
  expect(r.rock).toBe(true)
  expect(r.glowKept).toBe(true)
  expect(r.blobs).toBe(true)
  expect(r.plain).toBe(true)
  expect(r.blobGrid).toBe(true)
  expect(r.simpleGrid).toBe(true)
  // Vertex checks count whenever the arrays were still there.
  for (const id of Object.keys(r.round)) if (r.pts[id]) expect(r.round[id], id).toBe(true)
  if (r.pts.pumpkin) {
    expect(r.pumpkinTop).toBeLessThan(5.95)
    expect(r.simpleSquare).toBe(true)
  }
  if (r.pts.melon) expect(r.melonMid).toBeGreaterThan(r.melonEnd + 0.05)
  if (r.blobPts) expect(r.blobRounded).toBe(true)
})

test('real-life wood builds: flat faces, soft outside edges, one solid wall, shaggy thatch, top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A 3x3 plank wall, a lone crate, planks against stone, a thatch overhang.
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) bm._placeBlockInner(124 + dx, 5 + dy, 124, 'oakplanks')
    bm._placeBlockInner(120, 5, 120, 'crate')
    bm._placeBlockInner(130, 5, 130, 'oakplanks')
    bm._placeBlockInner(131, 5, 130, 'stone')
    bm._placeBlockInner(136, 8, 136, 'thatch')
    const verts = (x0, x1, y0, y1, z0, z1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) v.push([x, y, z])
          }
        }
      }
      return v
    }
    const near = (v, x, y, z) => v.some((p) => Math.abs(p[0] - x) < 0.002 && Math.abs(p[1] - y) < 0.002 && Math.abs(p[2] - z) < 0.002)
    const crate = () => verts(119.9, 121.1, 4.9, 6.1, 119.9, 121.1)
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const c = crate()
    out.cratePts = c.length
    // Corners rounded in, nothing sticks out, top stays flat.
    out.crateCorner = near(c, 121, 6, 121)
    out.crateInside = c.every(([x, y, z]) => x >= 119.999 && x <= 121.001 && y >= 4.999 && y <= 6.001 && z >= 119.999 && z <= 121.001)
    out.crateFlatTop = c.filter((p) => p[1] > 5.95).every((p) => p[1] > 5.999 || p[1] < 5.96)
    // The wall: the bevel runs on across the joint (no pinch), and the
    // middle block's front is one plain quad (no extra points).
    const w = verts(123.9, 127.1, 4.9, 8.1, 123.9, 125.1)
    out.wallPts = w.length
    const h = 0.07
    out.wallJoint = near(w, 125, 8 - h, 124 + h)
    out.wallMiddle = w.filter(([x, y, z]) => x > 125.01 && x < 125.99 && y > 6.01 && y < 6.99 && z < 124.01).length
    // Against stone the corner stays put (a sharp, clean line).
    const s = verts(129.9, 131.1, 4.9, 6.1, 129.9, 131.1)
    out.stonePts = s.length
    out.stonePinned = near(s, 131, 6, 130)
    // Thatch: straw hangs under the overhang and pokes out.
    const t = verts(135.5, 137.5, 7.5, 9.5, 135.5, 137.5)
    out.thatchPts = t.length
    out.fringe = t.some((p) => p[1] < 7.97)
    const I = (id) => ch.info.get(id) || {}
    out.wood = ['oakplanks', 'spruceplanks', 'crimsonplanks', 'bambooplanks', 'planks', 'wood', 'bookshelf', 'barrel', 'crate', 'craftingtable', 'timberframe', 'thatch', 'roofshingles', 'slateshingles'].every((id) => !ch.info.has(id) || I(id).wood)
    out.notWood = !I('explosivebarrel').wood && !I('stone').wood && !I('oaklog').wood && ![...ch.info.keys()].some((id) => /(slab|stairs|fence|door)$/.test(id) && I(id).wood)
    out.flatCrack = ch.lumpyTopPoints(120, 5, 120) === null
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const c2 = crate()
    out.simplePts = c2.length
    out.simpleCorner = near(c2, 121, 6, 121)
    g._exitBuildMode()
    return out
  })
  expect(r.wood).toBe(true)
  expect(r.notWood).toBe(true)
  expect(r.flatCrack).toBe(true)
  // Vertex checks count whenever the arrays were still there.
  if (r.cratePts) {
    expect(r.crateCorner).toBe(false)
    expect(r.crateInside).toBe(true)
    expect(r.crateFlatTop).toBe(true)
  }
  if (r.wallPts) {
    expect(r.wallJoint).toBe(true)
    expect(r.wallMiddle).toBe(0)
  }
  if (r.stonePts) expect(r.stonePinned).toBe(true)
  if (r.thatchPts) expect(r.fringe).toBe(true)
  if (r.simplePts) expect(r.simpleCorner).toBe(true)
})

test('real-life stone and metal builds: one solid wall, metal sharper and shiny, kinds meet sharp', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone brick, a lone iron block, a 3x3 concrete wall, brick against planks.
    bm._placeBlockInner(140, 5, 140, 'brick')
    bm._placeBlockInner(144, 5, 140, 'iron')
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) bm._placeBlockInner(148 + dx, 5 + dy, 148, 'whiteconcrete')
    bm._placeBlockInner(154, 5, 154, 'brick')
    bm._placeBlockInner(155, 5, 154, 'oakplanks')
    const verts = (x0, x1, y0, y1, z0, z1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          const ed = m.geometry.attributes.aEdge
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) v.push([x, y, z, ed ? ed.array[i / 3] : 0])
          }
        }
      }
      return v
    }
    const near = (v, x, y, z, e = 0.002) => v.some((p) => Math.abs(p[0] - x) < e && Math.abs(p[1] - y) < e && Math.abs(p[2] - z) < e)
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const b = verts(139.9, 141.1, 4.9, 6.1, 139.9, 141.1)
    const m = verts(143.9, 145.1, 4.9, 6.1, 139.9, 141.1)
    out.brickPts = b.length
    out.ironPts = m.length
    out.brickCorner = near(b, 141, 6, 141)
    out.ironCorner = near(m, 145, 6, 141)
    // Bevel depth: deepest drop below the top on the block's points.
    out.brickDrop = Math.max(...b.map((p) => 6 - p[1]).filter((d) => d < 0.3))
    out.ironDrop = Math.max(...m.map((p) => 6 - p[1]).filter((d) => d < 0.3))
    out.brickInside = b.every(([x, y, z]) => x >= 139.999 && x <= 141.001 && y >= 4.999 && y <= 6.001 && z >= 139.999 && z <= 141.001)
    out.ironShiny = m.some((p) => p[3] < -0.5)
    out.brickDull = b.every((p) => p[3] === 0)
    const w = verts(147.9, 151.1, 4.9, 8.1, 147.9, 149.1)
    out.wallPts = w.length
    out.wallMiddle = w.filter(([x, y, z]) => x > 149.01 && x < 149.99 && y > 6.01 && y < 6.99 && z < 148.01).length
    const s = verts(153.9, 156.1, 4.9, 6.1, 153.9, 155.1)
    out.mixPts = s.length
    out.mixPinned = near(s, 155, 6, 154)
    const I = (id) => ch.info.get(id) || {}
    const has = (id) => ch.info.has(id)
    out.stone = ['brick', 'netherbrick', 'mudbricks', 'quartz', 'purpurblock', 'prismarine', 'concrete', 'whiteconcrete', 'redterracotta', 'glazedterracotta', 'plaster', 'asphalt'].filter((id) => has(id) && I(id).build !== 'stone')
    out.metal = ['metal', 'iron', 'gold', 'copper', 'oxidizedcopper', 'netherite', 'diamondblock', 'emeraldblock', 'lapisblock', 'coalblock', 'redstoneblock'].filter((id) => has(id) && I(id).build !== 'metal')
    out.notBuild = ['stonebricks', 'terracotta', 'redstonelamp', 'brickslab', 'irondoor', 'ironore', 'tnt', 'sealantern'].filter((id) => has(id) && I(id).build)
    out.stillRock = !has('stonebricks') || I('stonebricks').real
    out.flatCrack = ch.lumpyTopPoints(140, 5, 140) === null
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const b2 = verts(139.9, 141.1, 4.9, 6.1, 139.9, 141.1)
    out.simplePts = b2.length
    out.simpleCorner = near(b2, 141, 6, 141)
    g._exitBuildMode()
    return out
  })
  expect(r.stone).toEqual([])
  expect(r.metal).toEqual([])
  expect(r.notBuild).toEqual([])
  expect(r.stillRock).toBe(true)
  expect(r.flatCrack).toBe(true)
  if (r.brickPts && r.ironPts) {
    expect(r.brickCorner).toBe(false)
    expect(r.ironCorner).toBe(false)
    expect(r.brickInside).toBe(true)
    // Metal edges are sharper (a smaller bevel) and shiny; brick isn't.
    expect(r.ironDrop).toBeLessThan(r.brickDrop)
    expect(r.ironShiny).toBe(true)
    expect(r.brickDull).toBe(true)
  }
  if (r.wallPts) expect(r.wallMiddle).toBe(0)
  if (r.mixPts) expect(r.mixPinned).toBe(true)
  if (r.simplePts) expect(r.simpleCorner).toBe(true)
})

test('real-life soft and see-through: pillowy wool, framed glass that joins, jelly blobs', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone wool block, a 3-wide glass window, a lone honey block, honey against slime.
    bm._placeBlockInner(140, 5, 160, 'redwool')
    for (let dx = 0; dx < 3; dx++) bm._placeBlockInner(150 + dx, 5, 160, 'glass')
    bm._placeBlockInner(160, 5, 160, 'honeyblock')
    bm._placeBlockInner(170, 5, 160, 'honeyblock')
    bm._placeBlockInner(171, 5, 160, 'slimeblock')
    const verts = (x0, x1, y0, y1, z0, z1) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          const ed = m.geometry.attributes.aEdge
          const col = m.geometry.attributes.color
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            const a = col && col.itemSize === 4 ? col.array[(i / 3) * 4 + 3] : 1
            if (x > x0 && x < x1 && y > y0 && y < y1 && z > z0 && z < z1) v.push([x, y, z, ed ? ed.array[i / 3] : 0, a])
          }
        }
      }
      return v
    }
    const near = (v, x, y, z, e = 0.002) => v.some((p) => Math.abs(p[0] - x) < e && Math.abs(p[1] - y) < e && Math.abs(p[2] - z) < e)
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const w = verts(139.9, 141.1, 4.9, 6.1, 159.9, 161.1)
    out.woolPts = w.length
    out.woolCorner = near(w, 141, 6, 161)
    out.woolDrop = Math.max(...w.map((p) => 6 - p[1]).filter((d) => d < 0.4))
    out.woolPuffs = w.some((p) => p[1] > 6.01)
    // The window's front face (z = 160 plane): frame alpha on the outside, clearer where panes join.
    const gl = verts(149.9, 153.1, 4.9, 6.1, 159.95, 160.05)
    out.glassPts = gl.length
    out.glassFrame = gl.filter((p) => p[0] < 150.001 && p[1] > 5.3 && p[1] < 5.7).every((p) => p[4] > 0.99)
    out.glassJoined = gl.filter((p) => Math.abs(p[0] - 151) < 0.001 && p[1] > 5.3 && p[1] < 5.7).every((p) => p[4] < 0.7)
    out.glassShiny = gl.some((p) => p[3] < -0.5)
    const h = verts(159.9, 161.1, 4.9, 6.1, 159.9, 161.1)
    out.honeyPts = h.length
    out.honeyCorner = near(h, 161, 6, 161)
    out.honeyDrop = Math.max(...h.map((p) => 6 - p[1]).filter((d) => d < 0.4))
    out.honeyShiny = h.some((p) => p[3] < -0.5)
    const j = verts(169.9, 172.1, 4.9, 6.1, 159.9, 161.1)
    out.jellyPts = j.length
    out.jellyPinned = near(j, 171, 6, 160)
    const I = (id) => ch.info.get(id) || {}
    const has = (id) => ch.info.has(id)
    out.wool = ['wool', 'redwool', 'whitewool', 'lightbluewool'].filter((id) => has(id) && I(id).build !== 'wool')
    out.glass = ['glass', 'tintedglass', 'redstainedglass', 'lightgraystainedglass'].filter((id) => has(id) && I(id).build !== 'glass')
    out.jelly = ['honeyblock', 'slimeblock'].filter((id) => has(id) && I(id).build !== 'jelly')
    out.notBuild = ['glasspane', 'invisible', 'honeycombblock', 'sponge', 'jukebox', 'tnt'].filter((id) => has(id) && I(id).build)
    out.flatCrack = ch.lumpyTopPoints(140, 5, 160) === null
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const w2 = verts(139.9, 141.1, 4.9, 6.1, 159.9, 161.1)
    out.simplePts = w2.length
    out.simpleCorner = near(w2, 141, 6, 161)
    g._exitBuildMode()
    return out
  })
  expect(r.wool).toEqual([])
  expect(r.glass).toEqual([])
  expect(r.jelly).toEqual([])
  expect(r.notBuild).toEqual([])
  expect(r.flatCrack).toBe(true)
  expect(r.woolPts).toBeGreaterThan(0)
  expect(r.woolCorner).toBe(false)
  // Wool is puffier than a stone build (0.11 bevel, flat faces).
  expect(r.woolDrop).toBeGreaterThan(0.1)
  expect(r.woolPuffs).toBe(true)
  expect(r.glassPts).toBeGreaterThan(0)
  expect(r.glassFrame).toBe(true)
  expect(r.glassJoined).toBe(true)
  expect(r.glassShiny).toBe(true)
  expect(r.honeyPts).toBeGreaterThan(0)
  expect(r.honeyCorner).toBe(false)
  expect(r.honeyDrop).toBeGreaterThan(r.woolDrop)
  expect(r.honeyShiny).toBe(true)
  // Honey and slime don't melt into each other.
  expect(r.jellyPinned).toBe(true)
  if (r.simplePts) expect(r.simpleCorner).toBe(true)
})

test('real-life rock: stone-type blocks turn craggy, melt into dirt, on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A lone stone up in the air, stone beside dirt, bricks beside planks.
    bm._placeBlockInner(90, 5, 90, 'stone')
    bm._placeBlockInner(95, 5, 95, 'cobblestone')
    bm._placeBlockInner(96, 5, 95, 'dirt')
    bm._placeBlockInner(100, 5, 100, 'stonebricks')
    bm._placeBlockInner(101, 5, 100, 'oakplanks')
    const verts = (x0, z0) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          if (!pos?.array?.length) continue
          for (let i = 0; i < pos.array.length; i += 3) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.kinds = ['stone', 'cobblestone', 'stonebricks', 'diamondore', 'sandstone', 'smoothstone'].map((t) => !!ch.info.get(t)?.rock)
    out.notRock = ['stoneslab', 'sealantern', 'redstonelamp', 'grass', 'oakplanks'].map((t) => !!ch.info.get(t)?.rock)
    const lone = verts(90, 90)
    out.pts = lone.length
    out.rounded = lone.every(([x, y, z]) => !(y > 5.97 && (x < 90.03 || x > 90.97) && (z < 90.03 || z > 90.97)))
    // Rock and dirt share their middle edge and it moves (not pinned).
    const L = ch.realTopLattice(95, 5, 95)
    out.joinFree = L[1][6] === 1 && L[1][8] > 0 && L[1][8] < 1
    const a = ch.realTopPoint(L, 95, 5, 95, 1, 0.5)
    const b = ch.realTopPoint(ch.realTopLattice(96, 5, 95), 96, 5, 95, 0, 0.5)
    out.joined = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4
    // Bricks meeting planks stay pinned at the planks.
    const p = ch.realTopPoint(ch.realTopLattice(100, 5, 100), 100, 5, 100, 1, 0)
    out.pinned = [p.x, p.y, p.z].map((k) => Math.round(k * 1000) / 1000)
    out.crack = !!ch.realFaceGrids(90, 5, 90)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(90, 90)
    out.simpleCube = flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    out.simpleGrid = ch.realFaceGrids(90, 5, 90) === null
    g._exitBuildMode()
    return out
  })
  expect(r.kinds).toEqual([true, true, true, true, true, true])
  expect(r.notRock).toEqual([false, false, false, false, false])
  expect(r.rounded).toBe(true)
  expect(r.joinFree).toBe(true)
  expect(r.joined).toBe(true)
  expect(r.pinned).toEqual([101, 6, 100])
  expect(r.crack).toBe(true)
  expect(r.simpleCube).toBe(true)
  expect(r.simpleGrid).toBe(true)
})

test('real-life soft ground: sand, gravel, mud... join the land with their own looks, top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // Lone blocks up in the air, sand beside grass, mud beside planks.
    bm._placeBlockInner(130, 5, 130, 'sand')
    bm._placeBlockInner(134, 5, 130, 'gravel')
    bm._placeBlockInner(138, 5, 130, 'mud')
    bm._placeBlockInner(130, 5, 135, 'sand')
    bm._placeBlockInner(131, 5, 135, 'grass')
    bm._placeBlockInner(135, 5, 135, 'mud')
    bm._placeBlockInner(136, 5, 135, 'oakplanks')
    const verts = (x0, z0) => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          const pos = m.geometry.attributes.position
          const e = m.geometry.attributes.aEdge
          if (!pos?.array?.length) continue
          for (let i = 0, k = 0; i < pos.array.length; i += 3, k++) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z, e?.array?.[k] ?? 0])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const ids = ['sand', 'redsand', 'gravel', 'mud', 'clay', 'moss', 'podzol', 'mycelium', 'soulsand', 'crimsonnylium', 'terracotta', 'dirtpath']
    out.real = ids.map((t) => !!ch.info.get(t)?.real)
    out.looks = ids.map((t) => ch.info.get(t)?.look)
    // Still cubes: snow (its own batch), planks, glass.
    out.notReal = ['oakplanks', 'glass', 'sandslab'].map((t) => !!ch.info.get(t)?.real)
    const sand = verts(130, 130)
    out.rounded = sand.length > 0 && sand.every(([x, y, z]) => !(y > 5.97 && (x < 130.03 || x > 130.97) && (z < 130.03 || z > 130.97)))
    // Gravel carries small stones: more points than a lone sand block.
    out.gravelStones = verts(134, 130).length > sand.length
    // Wet mud shines (gloss rides below 0 on aEdge); sand doesn't.
    out.mudGloss = verts(138, 130).some((p) => p[3] < -0.3)
    out.sandDry = sand.every((p) => p[3] > -0.01)
    // Sand and grass share their middle edge and it moves (not pinned).
    const L = ch.realTopLattice(130, 5, 135)
    out.joinFree = L[1][6] === 1 && L[1][9] > 0 && L[1][9] < 1
    const a = ch.realTopPoint(L, 130, 5, 135, 1, 0.5)
    const b = ch.realTopPoint(ch.realTopLattice(131, 5, 135), 131, 5, 135, 0, 0.5)
    out.joined = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4
    // Mud meeting planks stays pinned at the planks.
    const p = ch.realTopPoint(ch.realTopLattice(135, 5, 135), 135, 5, 135, 1, 0)
    out.pinned = [p.x, p.y, p.z].map((k) => Math.round(k * 1000) / 1000)
    out.crack = !!ch.realFaceGrids(134, 5, 130)
    // Speed: a 40x40 field, 3 deep, as dirt and then as mixed soft ground.
    const field = (pick) => {
      for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) for (let y = 10; y < 13; y++) bm._placeBlockInner(200 + x, y, 200 + z, pick(x, z))
      ch.flush(bm._chunkCells)
      const t0 = performance.now()
      ch.rebuildAll()
      ch.flush(bm._chunkCells)
      return performance.now() - t0
    }
    const soft = ['sand', 'gravel', 'mud', 'clay', 'moss', 'podzol']
    out.msDirt = field(() => 'dirt')
    out.msSoft = field((x, z) => soft[(Math.floor(x / 7) + Math.floor(z / 7) * 3) % soft.length])
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(130, 130)
    out.simpleCube = flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    out.simpleGrid = ch.realFaceGrids(130, 5, 130) === null
    g._exitBuildMode()
    return out
  })
  console.log(`soft ground rebuild ms: dirt ${r.msDirt.toFixed(0)}, soft ${r.msSoft.toFixed(0)}`)
  expect(r.real).toEqual(Array(12).fill(true))
  expect(r.looks).toEqual(['sand', 'sand', 'gravel', 'mud', 'mud', 'dirt', 'dirt', 'dirt', 'sand', 'dirt', 'rock', 'dirt'])
  expect(r.notReal).toEqual([false, false, false])
  expect(r.rounded).toBe(true)
  expect(r.gravelStones).toBe(true)
  expect(r.mudGloss).toBe(true)
  expect(r.sandDry).toBe(true)
  expect(r.joinFree).toBe(true)
  expect(r.joined).toBe(true)
  expect(r.pinned).toEqual([136, 6, 135])
  expect(r.crack).toBe(true)
  expect(r.simpleCube).toBe(true)
  expect(r.simpleGrid).toBe(true)
  // Mixed soft ground costs about the same as plain dirt to build.
  expect(r.msSoft).toBeLessThan(r.msDirt * 2 + 100)
})

test('real-life water: soft shores, depth and splash on the top levels only', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    // A 3x3 pond, 2 deep, in a dirt basin with a grass bank, up in the air;
    // one water block on top of its middle (a waterfall landing).
    for (let x = 109; x <= 115; x++) for (let z = 109; z <= 115; z++) for (let y = 3; y <= 5; y++) bm._placeBlockInner(x, y, z, y === 5 ? 'grass' : 'dirt')
    for (let x = 111; x <= 113; x++) for (let z = 111; z <= 113; z++) for (let y = 4; y <= 5; y++) { bm._removeBlockInner?.(x, y, z); bm._placeBlockInner(x, y, z, 'water') }
    bm._placeBlockInner(112, 6, 112, 'water')
    const water = () => {
      ch.flush(bm._chunkCells)
      const v = []
      const S = ch.blockSize
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          if (m.material !== ch.materials.water) continue
          const pos = m.geometry.attributes.position
          const w = m.geometry.attributes.aWater
          if (!pos?.array?.length) continue
          for (let i = 0, k = 0; i < pos.array.length; i += 3, k += 2) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > 108 && x < 117 && z > 108 && z < 117 && y > 5.5 && y < 6.2) v.push([x, y, z, w?.array?.[k], w?.array?.[k + 1]])
          }
        }
      }
      return v
    }
    out.types = [bm._blocks.get('112,5,112'), bm._blocks.get('112,4,112'), bm._blocks.get('112,6,112')]
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    out.amt = ch.fx.realWater.value
    // The bank's corner at the water's edge is free to round off now.
    const L = ch.realTopLattice(110, 5, 111)
    out.bankFree = L[1][6] === 1
    const top = water()
    out.pts = top.length
    // The water reaches under the bank (past its own cells, x 111..114).
    out.reach = top.some(([x]) => x < 110.9) && top.some(([x]) => x > 114.1)
    out.deep = Math.max(...top.map((p) => p[3] ?? 0))
    out.splash = top.some((p) => p[4] === 1)
    out.shore0 = top.some((p) => p[3] === 0 && p[4] === -1)
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    out.simpleAmt = ch.fx.realWater.value
    const flat = water()
    out.simplePts = flat.length
    out.simpleInside = flat.every(([x, , z]) => x > 110.99 && x < 114.01 && z > 110.99 && z < 114.01)
    g._exitBuildMode()
    return out
  })
  expect(r.types).toEqual(['water', 'water', 'water'])
  expect(r.amt).toBe(1)
  expect(r.bankFree).toBe(true)
  expect(r.simpleAmt).toBe(0)
  // Vertex checks count whenever the arrays were still there.
  if (r.pts) {
    expect(r.reach).toBe(true)
    expect(r.deep).toBeGreaterThan(1.5)
    expect(r.splash).toBe(true)
    expect(r.shore0).toBe(true)
  }
  if (r.simplePts) expect(r.simpleInside).toBe(true)
})

test('real-life snow, ice and lava: drifts, glassy see-through ice, crusted lava with soft banks, top levels only', async ({ page }) => {
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && /shader|program|webgl/i.test(m.text())) errors.push(m.text()) })
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    await g._enterBuildMode()
    const bm = g.buildMode
    const ch = bm._chunks
    const S = ch.blockSize
    // Lone snow, ice and packed ice up in the air; snow beside grass.
    bm._placeBlockInner(150, 5, 150, 'snow')
    bm._placeBlockInner(154, 5, 150, 'ice')
    bm._placeBlockInner(158, 5, 150, 'packedice')
    bm._placeBlockInner(150, 5, 155, 'snow')
    bm._placeBlockInner(151, 5, 155, 'grass')
    // A 3x3 lava pool, 2 deep, in a stone basin, with lava falling on its
    // middle.
    for (let x = 169; x <= 175; x++) for (let z = 169; z <= 175; z++) for (let y = 3; y <= 5; y++) bm._placeBlockInner(x, y, z, 'stone')
    for (let x = 171; x <= 173; x++) for (let z = 171; z <= 173; z++) for (let y = 4; y <= 5; y++) { bm._removeBlockInner?.(x, y, z); bm._placeBlockInner(x, y, z, 'lava') }
    bm._placeBlockInner(172, 6, 172, 'lava')
    // Vertices near (x0, z0), y 4.2..6.8, from meshes with material mat
    // (null = any): [x, y, z, aEdge, alpha].
    const verts = (x0, z0, mat = null) => {
      ch.flush(bm._chunkCells)
      const v = []
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          if (mat && m.material !== mat) continue
          const pos = m.geometry.attributes.position
          const e = m.geometry.attributes.aEdge
          const col = m.geometry.attributes.color
          if (!pos?.array?.length) continue
          for (let i = 0, k = 0; i < pos.array.length; i += 3, k++) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            const a = col?.itemSize === 4 ? col.array[k * 4 + 3] : 1
            if (x > x0 - 0.8 && x < x0 + 1.8 && z > z0 - 0.8 && z < z0 + 1.8 && y > 4.2 && y < 6.8) v.push([x, y, z, e?.array?.[k] ?? 0, a])
          }
        }
      }
      return v
    }
    const lava = () => {
      ch.flush(bm._chunkCells)
      const v = []
      for (const c of ch.chunks.values()) {
        for (const m of c.meshes) {
          if (m.material !== ch.materials.lava) continue
          const pos = m.geometry.attributes.position
          const w = m.geometry.attributes.aWater
          if (!pos?.array?.length) continue
          for (let i = 0, k = 0; i < pos.array.length; i += 3, k += 2) {
            const x = (pos.array[i] + m.position.x) / S
            const y = (pos.array[i + 1] + m.position.y) / S
            const z = (pos.array[i + 2] + m.position.z) / S
            if (x > 168 && x < 177 && z > 168 && z < 177 && y > 5.5 && y < 6.2) v.push([x, y, z, w?.array?.[k], w?.array?.[k + 1]])
          }
        }
      }
      return v
    }
    g._applyGraphicsLevel('irl')
    bm._applyGraphicsLook()
    const ids = ['snow', 'ice', 'packedice', 'blueice']
    out.real = ids.map((t) => !!ch.info.get(t)?.real)
    out.looks = ids.map((t) => ch.info.get(t)?.look)
    out.lavaReal = !!ch.info.get('lava')?.real
    const snow = verts(150, 150)
    out.snowPts = snow.length
    out.snowRound = snow.every(([x, y, z]) => !(y > 5.97 && (x < 150.03 || x > 150.97) && (z < 150.03 || z > 150.97)))
    // Snow's little gloss (sparkles); ice shines like glass.
    out.snowGloss = snow.some((p) => p[3] < -0.1 && p[3] > -0.2)
    const ice = verts(154, 150, ch.materials.clear)
    out.icePts = ice.length
    out.iceClear = ice.length > 0 && ice.every((p) => p[4] < 0.9)
    out.iceGloss = ice.some((p) => p[3] < -0.8)
    out.iceRound = ice.every(([x, y, z]) => !(y > 5.97 && (x < 154.03 || x > 154.97) && (z < 154.03 || z > 154.97)))
    out.packedSolid = verts(158, 150, ch.materials.solid).length > 0
    // Snow and grass share their middle edge and it moves (not pinned).
    const L = ch.realTopLattice(150, 5, 155)
    out.joinFree = L[1][6] === 1 && L[1][12] > 0 && L[1][12] < 1
    const a = ch.realTopPoint(L, 150, 5, 155, 1, 0.5)
    const b = ch.realTopPoint(ch.realTopLattice(151, 5, 155), 151, 5, 155, 0, 0.5)
    out.joined = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4
    out.crack = !!ch.realFaceGrids(154, 5, 150)
    // Lava: the stone bank's corner at its edge is free to round off.
    out.bankFree = ch.realTopLattice(170, 5, 171)[1][6] === 1
    const top = lava()
    out.lavaPts = top.length
    out.reach = top.some(([x]) => x < 170.9) && top.some(([x]) => x > 174.1)
    out.deep = Math.max(...top.map((p) => p[3] ?? 0))
    out.splash = top.some((p) => p[4] === 1)
    // Every shader compiles: draw one frame with the new looks in view.
    bm.camera.position.set(160 * S, 12 * S, 140 * S)
    bm.camera.lookAt(160 * S, 5 * S, 160 * S)
    bm.camera.updateMatrixWorld()
    bm.renderer.render(bm.scene, bm.camera)
    const gl = bm.renderer.getContext()
    out.glError = gl.getError()
    out.badPrograms = (bm.renderer.info.programs || []).filter((p) => p.diagnostics && !p.diagnostics.runnable).length
    g._applyGraphicsLevel('simple')
    bm._applyGraphicsLook()
    const flat = verts(150, 150)
    out.simplePts = flat.length
    out.simpleCube = flat.every(([x, y, z]) => [x, y, z].every((k) => Math.abs(k - Math.round(k)) < 0.001))
    const flatLava = lava()
    out.simpleLavaPts = flatLava.length
    out.simpleLavaInside = flatLava.every(([x, , z]) => x > 170.99 && x < 174.01 && z > 170.99 && z < 174.01)
    g._exitBuildMode()
    return out
  })
  expect(r.real).toEqual([true, true, true, true])
  expect(r.looks).toEqual(['snow', 'ice', 'ice', 'ice'])
  expect(r.lavaReal).toBe(false)
  expect(r.joinFree).toBe(true)
  expect(r.joined).toBe(true)
  expect(r.crack).toBe(true)
  expect(r.bankFree).toBe(true)
  expect(r.glError).toBe(0)
  expect(r.badPrograms).toBe(0)
  expect(errors).toEqual([])
  // Vertex checks count whenever the arrays were still there
  // (dropAfterUpload).
  if (r.snowPts) {
    expect(r.snowRound).toBe(true)
    expect(r.snowGloss).toBe(true)
  }
  if (r.icePts) {
    expect(r.iceClear).toBe(true)
    expect(r.iceGloss).toBe(true)
    expect(r.iceRound).toBe(true)
  }
  if (r.lavaPts) {
    expect(r.reach).toBe(true)
    expect(r.deep).toBeGreaterThan(1.5)
    expect(r.splash).toBe(true)
  }
  if (r.simplePts) expect(r.simpleCube).toBe(true)
  if (r.simpleLavaPts) expect(r.simpleLavaInside).toBe(true)
  console.log(JSON.stringify(r))
})

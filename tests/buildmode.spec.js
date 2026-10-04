import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

test('entering Build Mode shows a scene with a ground plane, exiting returns to the homepage', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const enteredActive = g.buildMode.active
    // The ground is now a real, breakable block layer (see
    // _ensureGroundLayer), not a standalone mesh - check for an actual
    // ground block instead of the removed `ground` property.
    const hasGround = g.buildMode.getBlockAt(0, -1, 0) !== null
    const menuHiddenWhileActive = getComputedStyle(g.menu).display === 'none'
    g._exitBuildMode()
    const exitedActive = g.buildMode.active
    const menuVisibleAfterExit = getComputedStyle(g.menu).display !== 'none'
    return { enteredActive, hasGround, menuHiddenWhileActive, exitedActive, menuVisibleAfterExit }
  })

  expect(result.enteredActive).toBe(true)
  expect(result.hasGround).toBe(true)
  expect(result.menuHiddenWhileActive).toBe(true)
  expect(result.exitedActive).toBe(false)
  expect(result.menuVisibleAfterExit).toBe(true)
})

test('free-fly movement moves the camera in Build Mode', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { moved: before.distanceTo(after) > 0.1 }
  })

  expect(result.moved).toBe(true)
})

// Plain cubes are drawn by chunk meshes (BlockChunks.js) - one mesh per
// 16x16x16 chunk holding only visible faces. faceCount sums the quads in
// the chunk that holds cell (0..15, 0..15, 0..15).
test('placing and removing a block updates both the chunk mesh and the internal map', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const faceCount = () => {
      bm.render()
      const chunk = bm._chunks.chunks.get('0,0,0')
      return chunk ? chunk.meshes.reduce((n, m) => n + m.geometry.index.count / 6, 0) : 0
    }
    const before = faceCount()
    bm.placeBlock(2, 0, 3, 'brick')
    const afterPlace = { atBlock: bm.getBlockAt(2, 0, 3), faces: faceCount() }
    bm.removeBlock(2, 0, 3)
    const afterRemove = { atBlock: bm.getBlockAt(2, 0, 3), faces: faceCount() }
    g._exitBuildMode()
    return { before, afterPlace, afterRemove }
  })

  expect(result.afterPlace.atBlock).toBe('brick')
  // A lone block on the ground shows 5 faces (its bottom touches grass).
  expect(result.afterPlace.faces).toBe(result.before + 5)
  expect(result.afterRemove.atBlock).toBe(null)
  expect(result.afterRemove.faces).toBe(result.before)
})

test('removing one block does not remove a different still-placed block of the same type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const faceCount = () => {
      bm.render()
      const chunk = bm._chunks.chunks.get('0,0,0')
      return chunk ? chunk.meshes.reduce((n, m) => n + m.geometry.index.count / 6, 0) : 0
    }
    const before = faceCount()
    bm.placeBlock(0, 0, 0, 'stone')
    bm.placeBlock(1, 0, 0, 'stone')
    bm.placeBlock(2, 0, 0, 'stone')
    bm.removeBlock(1, 0, 0) // remove the middle one
    const remaining = {
      first: bm.getBlockAt(0, 0, 0),
      removed: bm.getBlockAt(1, 0, 0),
      third: bm.getBlockAt(2, 0, 0),
      addedFaces: faceCount() - before,
    }
    g._exitBuildMode()
    return remaining
  })

  expect(result.first).toBe('stone')
  expect(result.removed).toBe(null)
  expect(result.third).toBe('stone')
  // Two separate lone blocks: 5 visible faces each.
  expect(result.addedFaces).toBe(10)
})

test('Tab opens the picker, clicking a swatch changes the selected block type', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const beforeType = g.buildMode.selectedType
    g.buildMode.togglePicker()
    const openAfterToggle = g.buildMode.pickerOpen
    const swatches = document.querySelectorAll('.build-picker-swatch')
    swatches[2].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const afterClickType = g.buildMode.selectedType
    const closedAfterClick = g.buildMode.pickerOpen
    g._exitBuildMode()
    return { beforeType, openAfterToggle, afterClickType, closedAfterClick, swatchCount: swatches.length }
  })

  expect(result.openAfterToggle).toBe(true)
  expect(result.swatchCount).toBe(808)
  expect(result.afterClickType).not.toBe(result.beforeType)
  expect(result.closedAfterClick).toBe(false)
})

// Doors are two blocks tall, open/close on right-click (toggleDoor), let
// you through only while open, and keep their facing/open state in saves.
test('doors place both halves, open and close, and save their state', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.placeBlock(5, 3, 5, 'oakdoor', false, { facing: 1, open: false })
    const halves = [bm.getBlockAt(5, 3, 5), bm.getBlockAt(5, 4, 5)]
    const blockedClosed = bm._blockedAt(2.275, 1.575, 2.275)
    bm.toggleDoor(5, 4, 5)
    const openedFromTop = bm.isDoorOpenAt(5, 3, 5)
    const blockedOpen = bm._blockedAt(2.275, 1.575, 2.275)
    const saved = bm._snapshot().blocks.filter((b) => b.x === 5 && b.y >= 0 && b.z === 5)
    bm.removeBlock(5, 4, 5)
    const afterBreak = [bm.getBlockAt(5, 3, 5), bm.getBlockAt(5, 4, 5)]
    bm.undo()
    const afterUndo = [bm.getBlockAt(5, 4, 5), bm.isDoorOpenAt(5, 4, 5)]
    g._exitBuildMode()
    return { halves, blockedClosed, openedFromTop, blockedOpen, saved, afterBreak, afterUndo }
  })

  expect(result.halves).toEqual(['oakdoor', 'oakdoortop'])
  expect(result.blockedClosed).toBe(true)
  expect(result.openedFromTop).toBe(true)
  expect(result.blockedOpen).toBe(false)
  expect(result.saved).toEqual([{ x: 5, y: 3, z: 5, type: 'oakdoor', facing: 1, open: true }])
  expect(result.afterBreak).toEqual([null, null])
  expect(result.afterUndo).toEqual(['oakdoortop', true])
})

test('old saves load TNT as C4', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm._applyParsedData({ blocks: [{ x: 7, y: 0, z: 7, type: 'tnt' }, { x: 8, y: 0, z: 7, type: 'tntslab' }], hotbar: ['tnt', null, null, null, null, null, null, null, null, null] })
    const out = { block: bm.getBlockAt(7, 0, 7), slab: bm.getBlockAt(8, 0, 7), hotbar0: bm.hotbar[0] }
    g._exitBuildMode()
    return out
  })

  expect(result).toEqual({ block: 'c4', slab: 'c4slab', hotbar0: 'c4' })
})

test('a saved build reloads correctly in a fresh BuildMode instance', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    g.buildMode.placeBlock(5, 0, 5, 'metal')
    g.buildMode.placeBlock(6, 0, 5, 'glass')
    g.buildMode.save()
    g._exitBuildMode()

    // Fresh instance reading the same localStorage key, same technique
    // this project's own settings-persistence tests already use.
    g.buildMode = new g.buildMode.constructor(g.renderer)
    g.buildMode.load()
    return {
      metal: g.buildMode.getBlockAt(5, 0, 5),
      glass: g.buildMode.getBlockAt(6, 0, 5),
    }
  })

  expect(result.metal).toBe('metal')
  expect(result.glass).toBe('glass')
})

test('malformed save data does not crash Build Mode - starts with just the default ground instead', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  const result = await page.evaluate(async () => {
    localStorage.setItem('gayz-build-mode', 'not valid json {{{')
    const g = window.__game
    await g._enterBuildMode()
    // No player-built blocks survive a malformed save, but the ground
    // layer (see _ensureGroundLayer) still backfills every cell - a full
    // GROUND_SIZE x GROUND_SIZE (128x128) layer, none of it player-placed.
    const blockCount = g.buildMode._blocks.size
    g._exitBuildMode()
    return { blockCount }
  })

  expect(result.blockCount).toBe(128 * 128)
  expect(errors).toEqual([])
})

test('re-entering Build Mode multiple times does not accumulate duplicate movement listeners', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const result = await page.evaluate(async () => {
    const g = window.__game
    // Enter/exit 3 times before the real measurement - if listeners were
    // leaking, this is where duplicates would build up.
    for (let i = 0; i < 3; i++) {
      await g._enterBuildMode()
      g._exitBuildMode()
    }
    await g._enterBuildMode()
    const before = g.buildMode.camera.position.clone()
    g.buildMode._keys.add('KeyW')
    g.buildMode.update(0.5)
    g.buildMode._keys.delete('KeyW')
    const after = g.buildMode.camera.position.clone()
    g._exitBuildMode()
    return { distanceMoved: before.distanceTo(after) }
  })

  // update(dt) is called exactly once here regardless of prior enter/exit
  // cycles, so distance moved must match a single un-duplicated call -
  // FLY_SPEED (8) * dt (0.5) = 4, not some multiple of it.
  expect(result.distanceMoved).toBeGreaterThan(3.9)
  expect(result.distanceMoved).toBeLessThan(4.1)
})

// Fill, Replace and the shape tools (BuildTools.js) - each whole action is
// one Undo.
test('fill, replace and shape tools build the right cells and undo in one step', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const tools = bm.tools
    const count = (type) => [...bm._blocks.values()].filter((t) => t === type).length
    const out = {}
    out.fill = tools.apply('fill', [0, 0, 0], [2, 1, 3], 'stone')
    out.stoneAfterFill = count('stone')
    bm.undo()
    out.stoneAfterUndo = count('stone')
    bm.redo()
    out.stoneAfterRedo = count('stone')
    out.replace = tools.apply('replace', [0, 0, 0], [1, 1, 1], 'brick', 'stone')
    out.brick = count('brick')
    bm.undo()
    out.brickAfterUndo = count('brick')
    out.stoneBack = count('stone')
    bm.undo()
    out.wall = tools.apply('wall', [10, 0, 10], [14, 2, 10], 'oakplanks')
    out.floor = tools.apply('floor', [20, 0, 20], [22, 5, 21], 'cobblestone')
    out.box = tools.apply('box', [30, 0, 30], [32, 2, 32], 'glass')
    out.circle = tools.cells('circle', [0, 5, 0], [4, 5, 0]).every(([x, y, z]) => y === 5 && Math.abs(Math.hypot(x, z) - 4) < 0.5)
    out.ballHollow = !tools.cells('ball', [0, 20, 0], [0, 23, 0]).some(([x, y, z]) => x === 0 && y === 20 && z === 0)
    out.tooBig = tools.cells('fill', [0, 0, 0], [100, 100, 100])
    bm._clipboard = { blocks: [{ dx: 0, dy: 0, dz: 0, type: 'oakstairs', state: { facing: 0 } }, { dx: 2, dy: 0, dz: 0, type: 'stone' }], width: 3, height: 1, depth: 1 }
    tools.rotateClipboard()
    out.rotated = JSON.stringify(bm._clipboard.blocks.map((b) => [b.dx, b.dz, b.state?.facing ?? null])) + ` ${bm._clipboard.width}x${bm._clipboard.depth}`
    g._exitBuildMode()
    return out
  })

  expect(r.fill).toBe(24)
  expect(r.stoneAfterUndo).toBe(r.stoneAfterFill - 24)
  expect(r.stoneAfterRedo).toBe(r.stoneAfterFill)
  expect(r.replace).toBe(8)
  expect(r.brick).toBe(8)
  expect(r.brickAfterUndo).toBe(0)
  expect(r.stoneBack).toBe(r.stoneAfterFill)
  expect(r.wall).toBe(15)
  expect(r.floor).toBe(6)
  expect(r.box).toBe(26)
  expect(r.circle).toBe(true)
  expect(r.ballHollow).toBe(true)
  expect(r.tooBig).toBe(null)
  expect(r.rotated).toBe('[[0,0,3],[0,2,null]] 1x3')
})

// Levers open nearby doors, signs keep their words in a save, and the new
// game blocks (BuildGadgets.js) come back facing the same way.
test('levers, pressure plates and signs work and are saved', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    bm.placeBlock(0, 0, 5, 'oakdoor', false, { facing: 0 })
    bm.placeBlock(3, 0, 3, 'lever', false, { facing: 1 })
    bm.placeBlock(-3, 0, 3, 'pressureplate')
    bm.placeBlock(2, 0, 0, 'sign', false, { facing: 3, text: 'Hello  there' })
    bm.placeBlock(4, 0, 0, 'lootchest', false, { facing: 2 })
    const out = { closed: bm.isDoorOpenAt(0, 0, 5) }
    bm.gadgets.use(3, 0, 3, true)
    out.leverOpens = bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.use(3, 0, 3, true)
    out.leverCloses = !bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.updatePlates([[-3, 0, 3]], 0.1)
    out.plateOpens = bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.updatePlates([], 5)
    out.plateCloses = !bm.isDoorOpenAt(0, 0, 5)
    bm.gadgets.setLever(3, 0, 3, true)
    const saved = bm._decodeSlot(bm._encodeSlot(bm._snapshot())).blocks
    out.sign = saved.find((b) => b.type === 'sign')
    out.lever = saved.find((b) => b.type === 'lever')
    out.chest = saved.find((b) => b.type === 'lootchest')
    out.signMesh = bm.gadgets._signMeshes.size
    bm.removeBlock(2, 0, 0)
    out.signMeshAfterRemove = bm.gadgets._signMeshes.size
    bm.undo()
    out.signBackText = bm.gadgets.signText.get('2,0,0')
    out.special = ['playerstart', 'zombiespawner', 'lootchest', 'lever', 'pressureplate', 'sign'].every((id) => bm.constructor.blockShape(id))
    g._exitBuildMode()
    return out
  })

  expect(r.closed).toBe(false)
  expect(r.leverOpens).toBe(true)
  expect(r.leverCloses).toBe(true)
  expect(r.plateOpens).toBe(true)
  expect(r.plateCloses).toBe(true)
  expect(r.sign).toMatchObject({ facing: 3, text: 'Hello  there' })
  expect(r.lever).toMatchObject({ facing: 1, open: true })
  expect(r.chest).toMatchObject({ facing: 2 })
  expect(r.signMesh).toBe(1)
  expect(r.signMeshAfterRemove).toBe(0)
  expect(r.signBackText).toBe('Hello  there')
  expect(r.special).toBe(true)
})

// Play (BuildSurvival.js): waves spawn at the Zombie Spawner, zombies find
// a way round a wall to you, shots kill them, chests give loot once.
test('Play mode spawns zombie waves that reach you and can be shot', async ({ page }) => {
  await gotoAndWaitForGame(page)

  const r = await page.evaluate(async () => {
    const g = window.__game
    await g._enterBuildMode()
    const bm = g.buildMode
    const s = bm.survival
    bm.placeBlock(0, 0, 0, 'playerstart', false, { facing: 0 })
    bm.placeBlock(0, 0, 14, 'zombiespawner')
    bm.placeBlock(2, 0, 1, 'lootchest', false, { facing: 0 })
    // A wall between the spawner and you, with a gap at one end.
    for (let x = -6; x <= 4; x++) for (let y = 0; y < 3; y++) bm.placeBlock(x, y, 7, 'stone')
    s.start()
    // The zombie skin is painted and loaded in the background.
    for (let i = 0; i < 50 && s._skin === undefined; i++) await new Promise((res) => setTimeout(res, 100))
    const out = { started: s.active && bm.tryMode.active }
    out.startCell = [Math.floor(bm.tryMode.pos.x), Math.floor(bm.tryMode.pos.z)]
    // Run the game forward without real frames.
    const step = (secs) => { for (let i = 0; i < secs * 20; i++) { bm.tryMode.update(0.05, new Set()); s.update(0.05) } }
    step(4)
    out.wave = s.wave
    out.spawned = s.zombies.length
    out.spawnNearSpawner = s.zombies.every((z) => Math.abs(z.z - 14.5) < 2.5)
    s.health = 1e9
    step(14)
    const p = bm.tryMode.pos
    out.closest = Math.min(...s.zombies.map((z) => Math.hypot(z.x - p.x, z.z - p.z)))
    out.wentRound = s.zombies.some((z) => z.z < 7)
    // Shoot the one in front.
    const target = s.zombies[0]
    const killsBefore = s.kills
    for (let i = 0; i < 10 && s.zombies.includes(target); i++) s.damageZombie(target, 34)
    out.killed = s.kills === killsBefore + 1
    out.mag = s.mag
    out.fired = s.tryFire() && s.mag === out.mag - 1
    const reserve = s.reserve
    out.chest = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    out.chestOnce = s.useChest(2, 0, 1) && s.reserve === reserve + 60
    s.health = 5
    s._hurtPlayer(10)
    out.dead = s.dead && document.getElementById('build-play-over').style.display === 'flex'
    s.stop()
    out.stopped = !s.active && !bm.tryMode.active && s.zombies.length === 0
    g._exitBuildMode()
    return out
  })

  expect(r.started).toBe(true)
  expect(r.startCell).toEqual([0, 0])
  expect(r.wave).toBe(1)
  expect(r.spawned).toBeGreaterThan(0)
  expect(r.spawnNearSpawner).toBe(true)
  expect(r.wentRound).toBe(true)
  expect(r.closest).toBeLessThan(2)
  expect(r.killed).toBe(true)
  expect(r.fired).toBe(true)
  expect(r.chest).toBe(true)
  expect(r.chestOnce).toBe(true)
  expect(r.dead).toBe(true)
  expect(r.stopped).toBe(true)
})

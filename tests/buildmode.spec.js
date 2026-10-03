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
  expect(result.swatchCount).toBe(805)
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

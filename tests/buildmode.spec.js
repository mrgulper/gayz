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
  expect(result.swatchCount).toBe(205)
  expect(result.afterClickType).not.toBe(result.beforeType)
  expect(result.closedAfterClick).toBe(false)
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
    // One walking step from a fixed start, with a fresh velocity.
    const step = () => {
      const bm = g.buildMode
      bm.camera.position.set(0.175, 0.567, 2.8)
      bm._velocity.set(0, 0, 0)
      bm._vy = 0
      bm._yaw = 0
      const before = bm.camera.position.clone()
      bm._keys.add('KeyW')
      bm.update(0.5)
      bm._keys.delete('KeyW')
      return before.distanceTo(bm.camera.position)
    }
    await g._enterBuildMode()
    const first = step()
    g._exitBuildMode()
    // Enter/exit 3 more times - if listeners were leaking, duplicates
    // would build up here.
    for (let i = 0; i < 3; i++) {
      await g._enterBuildMode()
      g._exitBuildMode()
    }
    await g._enterBuildMode()
    const later = step()
    g._exitBuildMode()
    return { first, later }
  })

  // update(dt) is called exactly once either way, so the distance must be
  // the same as on the very first entry, not some multiple of it.
  expect(result.first).toBeGreaterThan(0.1)
  expect(Math.abs(result.later - result.first)).toBeLessThan(0.01)
})

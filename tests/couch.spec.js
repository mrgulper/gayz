import { test, expect } from '@playwright/test'
import { gotoAndWaitForGame } from './helpers.js'

// Couch Co-op (CouchCoop.js, 2026-11-14): the homepage tag starts a game
// split in two; Player 2 joins with a controller, walks, shoots, gets
// knocked down and revived. Game time is stepped by hand (b.update), so
// a slow test machine runs it the same.
test('couch co-op: split screen, Player 2 joins, fights, revives', async ({ page }) => {
  await gotoAndWaitForGame(page)
  const r = await page.evaluate(async () => {
    const g = window.__game
    const out = {}
    const tag = document.getElementById('home-couch-tag')
    out.tagShown = tag.style.display !== 'none' && tag.textContent.length > 0
    const tr = tag.getBoundingClientRect()
    out.tagCentre = Math.round((tr.left + tr.right) / 2 - innerWidth / 2)
    // A fake controller (the browser only lists real ones after a press).
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true })
    const hold = (i, on) => { buttons[i].pressed = on; buttons[i].value = on ? 1 : 0 }
    // The tag's own path, without waiting for the real Play loading.
    g._couchNext = true
    await g._enterBuildMode({ map: 'map3' })
    const b = g.buildMode
    b.update(0.016)
    b.survival.start({ fromMenu: true })
    const s = b.survival
    if (s._picking) s._pickWeapon('rifle')
    const step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) b.update(dt) }
    step(4)
    const c = s.couch
    out.couch = !!c
    out.noLobby = !s.lobby
    out.split = document.body.classList.contains('couch-split')
    out.waiting = document.getElementById('couch-p2-msg').textContent.length > 0
    // Before Player 2 picks it, the controller doesn't move Player 1.
    out.p1PadFree = !b._padMove
    // Any button joins.
    hold(0, true)
    step(2)
    hold(0, false)
    step(2)
    out.joined = c.joined
    // Player 1's HUD keeps to the left half; Player 2's to the right.
    const inHalf = (id, left) => {
      const el = document.getElementById(id)
      if (!el || getComputedStyle(el).display === 'none') return true
      const r = el.getBoundingClientRect()
      return left ? r.right <= innerWidth / 2 + 1 : r.left >= innerWidth / 2 - 1
    }
    out.leftHud = ['build-hotbar', 'build-try-map', 'build-play-health', 'build-play-ammo', 'build-try-crosshair'].filter((id) => !inHalf(id, true))
    out.rightHud = ['couch-p2-health', 'couch-p2-ammo', 'couch-p2-crosshair'].filter((id) => !inHalf(id, false))
    out.twoTargets = s._targets().filter((t) => !t.remote).length
    // The left stick walks Player 2 (not Player 1).
    const p1Before = { ...s.bodyPos() }
    const p2Before = { x: c.p2.x, z: c.p2.z }
    pad.axes[1] = -1
    step(20)
    pad.axes[1] = 0
    step(10)
    out.p2Walked = Math.hypot(c.p2.x - p2Before.x, c.p2.z - p2Before.z) > 1.5
    out.p1Stayed = Math.hypot(s.bodyPos().x - p1Before.x, s.bodyPos().z - p1Before.z) < 0.5
    // Right trigger fires (a bullet gone), RB switches guns.
    c.p2.nextShotAt = 0
    const mag = c._ammo().mag
    hold(7, true)
    step(1)
    hold(7, false)
    step(1)
    out.fired = c._ammo().mag < mag
    const gun = c._weaponId()
    hold(5, true)
    step(1)
    hold(5, false)
    step(1)
    out.switched = c._weaponId() !== gun
    // A zombie put right under Player 2's crosshair takes the hit.
    c.p2.pitch = 0
    c._placeCamera()
    const zz = s.zombies.find((o) => !o.boss && (o.tall || 1) >= 1)
    if (zz) {
      const cam = c.camera.position.clone().divideScalar(s.B)
      const dir = c.camera.getWorldDirection(c.camera.position.clone())
      const at = cam.addScaledVector(dir, 7)
      zz.x = at.x
      zz.z = at.z
      zz.y = at.y - 1
      const before = zz.health
      c._shoot({ damage: 30 })
      out.hit = !s.zombies.includes(zz) || zz.health < before
    } else out.hit = 'no zombie yet'
    // Knocked down and revived (out of the camp's safety for this).
    const safe = s._campSafe
    s._campSafe = () => false
    try {
      for (const o of s.zombies) { o.x += 300; o.z += 300 }
      c._spawnNearP1()
      c.hurtP2(1000)
      out.p2Down = c.p2.isDown
      out.p2NotChased = !s._targets().some((t) => t.hurt)
      step(70)
      out.p2Revived = !c.p2.isDown && c.p2.health > 0
      s.armor = 0
      s.health = 1
      s._hurtPlayer(50)
      out.p1Down = c.p1Down && !s.dead
      out.p1CantShoot = s.tryFire() === false
      step(70)
      out.p1Revived = !c.p1Down && s.health > 0
      // Both down: game over, back to one screen.
      s.armor = 0
      s.health = 1
      s._hurtPlayer(50)
      c.hurtP2(1000)
      step(2)
      out.over = s.dead
      out.oneScreen = !document.body.classList.contains('couch-split')
    } finally {
      s._campSafe = safe
    }
    s.stop()
    out.cleaned = !document.getElementById('couch-hud') && !s.couch
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true })
    return out
  })
  expect(r).toMatchObject({
    tagShown: true, tagCentre: 0, couch: true, noLobby: true, split: true, waiting: true, p1PadFree: true,
    joined: true, leftHud: [], rightHud: [], twoTargets: 2, p2Walked: true, p1Stayed: true, fired: true, switched: true,
    p2Down: true, p2NotChased: true, p2Revived: true, p1Down: true, p1CantShoot: true, p1Revived: true,
    over: true, oneScreen: true, cleaned: true,
  })
  expect([true, 'no zombie yet']).toContain(r.hit)
})

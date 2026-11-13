// The owner dropping in (2026-11-13, Gaymi: "owner drop-in character",
// picked "visible or invisible, invisible by default" with "can't be hurt"
// and "fly"). The owner's tools make a pass (api/_lib/admin.js dropIn) and
// open the game with ?join=SERVER&drop=PASS (ServerBrowser.joinFromLink);
// the server checks the pass and marks the player:
//
//   own   - seen by everyone with a gold Owner name tag and a crown. Only
//           the server can set it, so nobody can fake it. Can't be hurt
//           (BuildSurvival._hurtPlayer) and flies: Jump up, Crouch down,
//           hovering otherwise (BuildTryMode).
//   ghost - invisible: the server never sends this player to anyone and
//           drops their blocks, shots and chat bubbles
//           (api/_lib/servers.js). Starts in Spectate's free camera so the
//           owner can fly around and watch; can't be hurt either.
import * as THREE from 'three'
import { MOB_HEIGHT } from './PlayRules.js'
import { addChatSystemLine } from './ChatUI.js'
import { t } from './i18n.js'

const GOLD = '#ffd23a'

// The gold two-line name tag: OWNER over the name.
export function ownerTag(nick, B) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 96
  const ctx = c.getContext('2d')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  ctx.fillStyle = GOLD
  ctx.lineWidth = 5
  ctx.font = 'bold 20px sans-serif'
  ctx.strokeText(t('ownerTag'), 128, 22)
  ctx.fillText(t('ownerTag'), 128, 22)
  ctx.lineWidth = 6
  ctx.font = 'bold 28px sans-serif'
  ctx.strokeText(nick, 128, 62)
  ctx.fillText(nick, 128, 62)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  sprite.scale.set(1.7 * B, 0.64 * B, 1)
  sprite.position.y = (MOB_HEIGHT + 0.65) * B
  return sprite
}

// A small blocky gold crown sitting on the head.
let crownParts = null
export function ownerCrown(B) {
  if (!crownParts) {
    crownParts = {
      gold: new THREE.MeshLambertMaterial({ color: 0xf2b822, emissive: 0x4a3200 }),
      gem: new THREE.MeshLambertMaterial({ color: 0xd8203a, emissive: 0x300008 }),
      box: new THREE.BoxGeometry(1, 1, 1),
    }
  }
  const { gold, gem, box } = crownParts
  const crown = new THREE.Group()
  const part = (mat, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(box, mat)
    m.scale.set(w * B, h * B, d * B)
    m.position.set(x * B, y * B, z * B)
    crown.add(m)
  }
  // The band, then a point on each side and corner.
  part(gold, 0.56, 0.1, 0.56, 0, 0.05, 0)
  for (const [x, z] of [[-0.23, -0.23], [0.23, -0.23], [-0.23, 0.23], [0.23, 0.23], [0, -0.25], [0, 0.25], [-0.25, 0], [0.25, 0]]) {
    part(gold, 0.1, 0.12, 0.1, x, 0.16, z)
  }
  part(gem, 0.08, 0.08, 0.04, 0, 0.06, 0.29)
  crown.position.y = (MOB_HEIGHT + 0.02) * B
  return crown
}

// Once the game is running (PlayNet's first sync): say what's on, and an
// invisible owner goes straight into the free camera.
export function startOwnerMode(game, survival, mode) {
  addChatSystemLine(game, t(mode === 'own' ? 'ownerJoinedVisible' : 'ownerJoinedGhost'))
  if (mode === 'ghost') {
    // Right away if possible; Spectate needs a living player in a game.
    const tryEnter = (left) => {
      if (!survival.active || survival.ownerMode !== 'ghost') return
      if (!survival.dead && survival.bm.spectate) survival.bm.spectate.enter()
      else if (left > 0) setTimeout(() => tryEnter(left - 1), 500)
    }
    tryEnter(20)
  }
}

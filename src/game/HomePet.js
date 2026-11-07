// Homepage pet (2026-11-07, Gaymi's homepage idea 2): one of your pets
// idles beside your character on the homepage. Picked on the Team page
// (Inventory > Pets, #home-pet-select): settings.homePet is 'auto' (your
// Pet Zombie if you have one), 'none', 'pet' (the Pet Zombie) or 'c<id>'
// (a caught creature).
//
// Looks exactly like it did in the wild (gayz-pets-keep-look): the Pet
// Zombie is built by PetZombie's own _buildBody/_spawn from its saved look
// (kind, hat, cape, shine, mutant, pink bow); a caught creature uses the
// same model it has in Team battles (an animal is PlayAnimals' own model).
//
// Loaded lazily (import() from Game.js) only once the homepage is idle and
// there is a pet to show, so it never slows the first paint.
import * as THREE from 'three'
import { PetZombie, loadPet } from './PetZombie.js'
import { loadCreatures } from './Creatures.js'
import { zombieModel, animalModel } from './TeamBattle.js'
import { loadSkinTexture } from './MenuAvatar3D.js'
import { SKELETON_KINDS, loadSkeletons } from './SkeletonModels.js'
import { MOB_HEIGHT } from './PlayRules.js'

// Same file as BuildSurvival's ZOMBIE_SKIN_URL (not imported: that would
// pull the whole game into this small chunk).
const ZOMBIE_SKIN_URL = '/images/npc/zombie.png'
// One block in the homepage scene's units (the character is ~32 tall =
// 2 blocks, like every mob).
const B = 16

let _skin = null
const zombieSkin = () => (_skin ||= loadSkinTexture(ZOMBIE_SKIN_URL).catch(() => null))

// Which pet the setting means right now -> { kind: 'pet', look } |
// { kind: 'creature', c } | null.
export function chosenPet(setting) {
  const pet = loadPet()
  const v = setting || 'auto'
  if (v === 'none') return null
  if (v === 'auto' || v === 'pet') return pet ? { kind: 'pet', look: pet } : null
  const id = Number(String(v).slice(1))
  const c = loadCreatures().list.find((x) => x.id === id)
  return c ? { kind: 'creature', c } : null
}

// Builds the model -> { group, tick(dt), dispose() } or null.
async function buildPet(choice) {
  if (choice.kind === 'pet') {
    if (SKELETON_KINDS[choice.look.kind]) await loadSkeletons()
    const holder = new THREE.Group()
    const fake = { B, _skin: await zombieSkin(), bm: { scene: holder } }
    const pz = new PetZombie(fake)
    pz.data = choice.look
    if (!pz._spawn(0, 0, 0) || !pz.pet) return null
    const p = pz.pet
    // Its floating name tag is for the game world - the homepage already
    // names your character, and two tags crowd the small panel.
    p.group.traverse((o) => { if (o.isSprite) o.visible = false })
    p.look.skel?.play('idle')
    return {
      group: holder,
      tick(dt) {
        p.look.monster?.update(dt, 0)
        p.look.skel?.update(dt)
      },
      dispose: () => pz._despawn(),
    }
  }
  const c = choice.c
  if (c.t === 'a') {
    // PlayAnimals' models are built with a block as 1 unit, and share
    // their kind's materials (never disposed here).
    const built = animalModel(c.k)
    const group = new THREE.Group()
    built.group.scale.setScalar(B)
    group.add(built.group)
    return { group, tick() {}, dispose() {} }
  }
  const z = zombieModel(c)
  const group = new THREE.Group()
  z.group.scale.multiplyScalar(B)
  group.add(z.group)
  // Arms down while it waits (battles hold them out).
  for (const a of z.arms) a.rotation.x = 0
  return {
    group,
    tick() {},
    dispose() {
      z.group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
      for (const m of z.mats) m.dispose()
    },
  }
}

let _token = 0
// Shows (or clears) the chosen pet beside the homepage character.
export async function refreshHomePet(game) {
  const avatar = game._menuAvatar3D
  if (!avatar) return
  const my = ++_token
  const choice = chosenPet(game.settings.homePet)
  const built = choice ? await buildPet(choice).catch(() => null) : null
  if (my !== _token) {
    built?.dispose()
    return
  }
  avatar.setPet(built)
}

// Exposed for tests: the height of the pet next to the character.
export const PET_HEIGHT = MOB_HEIGHT * B

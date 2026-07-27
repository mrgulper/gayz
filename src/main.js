import './style.css'
import { Game } from './game/Game.js'
import { preloadBuildingModels, preloadPropModels, preloadGunShopDisplayModels } from './game/World.js'
import { preloadZombieModel, preloadTitanModel } from './game/Zombie.js'
import { preloadCompanionModel } from './game/Companion.js'
import { preloadRivalModel } from './game/RivalScavenger.js'
import { preloadSurvivorModel } from './game/RescueSurvivor.js'
import { preloadPlayerBodyModel } from './game/PlayerBody.js'
import { preloadFuelcanModel } from './game/Pickups.js'
import { preloadChestModel, preloadVaultModel } from './game/Chests.js'
import {
  preloadPistolViewmodel,
  preloadRifleViewmodel,
  preloadShotgunViewmodel,
  preloadAwpViewmodel,
  preloadGlock18Viewmodel,
  preloadKnifeViewmodel,
  preloadBatViewmodel,
  preloadMacheteViewmodel,
  preloadUvBatonViewmodel,
} from './game/Viewmodels.js'

Promise.all([
  preloadBuildingModels(),
  preloadPropModels(),
  preloadGunShopDisplayModels(),
  preloadFuelcanModel(),
  preloadChestModel(),
  preloadVaultModel(),
  preloadZombieModel(),
  preloadTitanModel(),
  preloadCompanionModel(),
  preloadRivalModel(),
  preloadSurvivorModel(),
  preloadPlayerBodyModel(),
  preloadPistolViewmodel(),
  preloadRifleViewmodel(),
  preloadShotgunViewmodel(),
  preloadAwpViewmodel(),
  preloadGlock18Viewmodel(),
  preloadKnifeViewmodel(),
  preloadBatViewmodel(),
  preloadMacheteViewmodel(),
  preloadUvBatonViewmodel(),
]).finally(() => {
  const loader = document.getElementById('asset-loader')
  new Game()
  // The loader used to hide right here, before `new Game()` even ran -
  // but construction itself was never the expensive part (it reliably
  // finishes in under a second). The real cost is the browser's first
  // few real render/tick passes over a scene this large (first-time GPU
  // buffer uploads for thousands of meshes, first-ever full culling pass
  // over every cullable) - a genuine multi-second-plus one-time stall
  // that, until now, showed up as the game itself freezing right after
  // the loading screen vanished instead of being masked by it. Chaining
  // rAF callbacks (rather than a fixed setTimeout) means this naturally
  // waits out however long that actually takes on the player's hardware,
  // slow or fast, since each callback only fires once the previous real
  // frame has actually finished.
  let framesWaited = 0
  const WARMUP_FRAMES = 10
  function waitForWarmup() {
    framesWaited++
    if (framesWaited < WARMUP_FRAMES) requestAnimationFrame(waitForWarmup)
    else if (loader) loader.style.display = 'none'
  }
  requestAnimationFrame(waitForWarmup)
})

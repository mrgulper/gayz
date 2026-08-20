import './style.css'
import './consoleBridge.js'
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
  preloadSuppressedSmgViewmodel,
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
  preloadSuppressedSmgViewmodel(),
  // No preloadKnifeViewmodel() here - USE_GLB_KNIFE is off (see
  // Viewmodels.js), the procedural knife needs no asset fetch.
  preloadBatViewmodel(),
  preloadMacheteViewmodel(),
  preloadUvBatonViewmodel(),
]).finally(() => {
  // No blocking full-page loading screen anymore (there used to be one
  // here, masking both the asset preload above and a ~10-frame GPU-
  // warmup stall after construction - see git history if that's ever
  // needed again). The homepage's own static HTML/CSS now paints
  // immediately on page load instead of being hidden behind an overlay;
  // it just isn't interactive yet until this Promise.all resolves and
  // Game() finishes constructing, same as any ordinary page where
  // JS attaches behavior after the markup is already visible. The
  // tradeoff: the GPU-warmup stall this used to mask is no longer
  // hidden - a real, brief freeze may be visible right after the page
  // becomes interactive, on slower hardware especially.
  new Game()
})

import './style.css'
import { Game } from './game/Game.js'
import { preloadBuildingModels, preloadPropModels } from './game/World.js'
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
  if (loader) loader.style.display = 'none'
  new Game()
})

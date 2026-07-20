import './style.css'
import { Game } from './game/Game.js'
import { preloadBuildingModels } from './game/World.js'
import { preloadZombieModel, preloadTitanModel } from './game/Zombie.js'
import { preloadCompanionModel } from './game/Companion.js'
import { preloadRivalModel } from './game/RivalScavenger.js'
import { preloadSurvivorModel } from './game/RescueSurvivor.js'
import { preloadPlayerBodyModel } from './game/PlayerBody.js'

Promise.all([
  preloadBuildingModels(),
  preloadZombieModel(),
  preloadTitanModel(),
  preloadCompanionModel(),
  preloadRivalModel(),
  preloadSurvivorModel(),
  preloadPlayerBodyModel(),
]).finally(() => {
  const loader = document.getElementById('asset-loader')
  if (loader) loader.style.display = 'none'
  new Game()
})

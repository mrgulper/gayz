import './style.css'
import { Game } from './game/Game.js'
import { preloadBuildingModels } from './game/World.js'

preloadBuildingModels().finally(() => {
  const loader = document.getElementById('asset-loader')
  if (loader) loader.style.display = 'none'
  new Game()
})

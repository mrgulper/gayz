// Random mid-night events: once per night (see Game.js's night-round timer),
// at a random point during that round, one of these fires - mirrors the
// Perks.js pattern (a flat list + apply(game) mutating live game objects).
export const NIGHT_EVENTS = [
  {
    id: 'horde_surge',
    labelKey: 'eventHordeSurge',
    apply: (game) => game.zombies.spawnSurge(5),
  },
  {
    id: 'blackout',
    labelKey: 'eventBlackout',
    apply: (game) => {
      game.flashlightOn = false
      game.flashlightBattery = 0
      game.generatorFuel = 0
    },
  },
  {
    id: 'supply_drop',
    labelKey: 'eventSupplyDrop',
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game.chests.addChest(spot.x, 0, spot.z)
    },
  },
]

export function pickNightEvent() {
  return NIGHT_EVENTS[Math.floor(Math.random() * NIGHT_EVENTS.length)]
}

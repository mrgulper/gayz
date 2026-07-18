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
  {
    id: 'survivor_found',
    labelKey: 'eventSurvivorFound',
    apply: (game) => game._spawnRescueSurvivor(),
  },
  {
    id: 'supply_convoy',
    labelKey: 'eventSupplyConvoy',
    // A guarded chest (see RivalScavenger.js's RivalManager 'convoy' squad
    // type) - the escorts stand their ground around it and fight if
    // approached, rather than racing anyone for it like an airdrop squad.
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game.rivals.spawnSquad(spot.x, spot.z, 3, 'convoy')
      game.chests.addChest(spot.x, 0, spot.z)
    },
  },
  {
    id: 'toxic_gas',
    labelKey: 'eventToxicGas',
    // Ambient hazard, not a player tool - see Game.js's _spawnHazardZone/
    // _updateHazardZones. Distinct from the EMP grenade (something the
    // player chooses to throw at zombies) - this is a zone the player has
    // to notice and route around.
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game._spawnHazardZone('gas', spot.x, spot.z)
    },
  },
  {
    id: 'emp_field',
    labelKey: 'eventEmpField',
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game._spawnHazardZone('emp', spot.x, spot.z)
    },
  },
]

export function pickNightEvent() {
  return NIGHT_EVENTS[Math.floor(Math.random() * NIGHT_EVENTS.length)]
}

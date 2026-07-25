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
    id: 'camp_attack',
    labelKey: 'eventCampAttack',
    // Distinct from 'survivor_found' above: that one is a single passive
    // NPC waiting to be walked up to (no fail state). This spawns a small
    // group of vulnerable NPCs under active zombie pressure at a location -
    // the player can lose some or all of them if they don't get there in
    // time, see Game.js's _spawnSurvivorCamp/_updateSurvivorCamp.
    apply: (game) => game._spawnSurvivorCamp(),
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
    id: 'escort_convoy',
    labelKey: 'eventEscortConvoy',
    apply: (game) => game._spawnEscortConvoy(),
  },
  {
    id: 'radio_distress',
    // eventRadioDistress's own text carries the radio-chatter framing (see
    // i18n.js) - Game.js's own trigger site already toasts t(labelKey)
    // right after apply() runs, same as every other NIGHT_EVENTS entry.
    labelKey: 'eventRadioDistress',
    // Themed variant of the same chest+zombie-burst shape supply_drop/
    // camp_attack already use, framed through the radio chatter device
    // instead of a generic event banner - distinct from Game.js's
    // RADIO_CHATTER_KEYS, which are pure flavor with no gameplay attached.
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game.chests.addChest(spot.x, 0, spot.z)
      game.zombies.spawnAt(spot.x, spot.z, 4)
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

// Whole-round modifier, rolled once at the start of a night (see Game.js's
// _rollNightMutation, called alongside _rollWeather) - distinct from
// NIGHT_EVENTS above, which fires once at a random MOMENT mid-round. Only
// NIGHT_MUTATION_CHANCE of nights get one at all, so most nights stay
// exactly as they'd otherwise play.
export const NIGHT_MUTATION_CHANCE = 0.35
export const NIGHT_MUTATIONS = [
  { id: 'armored', labelKey: 'mutationArmored', healthMult: 1.35 },
  { id: 'swift', labelKey: 'mutationSwift', speedMult: 1.25 },
  { id: 'reckless', labelKey: 'mutationReckless', aggroRadiusMult: 1.6 },
  { id: 'docile', labelKey: 'mutationDocile', aggroRadiusMult: 0.5 },
]

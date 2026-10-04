// Random mid-night events: once per night (see Game.js's night-round timer),
// at a random point during that round, one of these fires - mirrors the
// Perks.js pattern (a flat list + apply(game) mutating live game objects).
// `name`/`about`: how GayZ Features lists each event.
export const NIGHT_EVENTS = [
  {
    id: 'horde_surge',
    name: 'Horde Surge',
    about: 'a sudden wave of extra zombies.',
    labelKey: 'eventHordeSurge',
    apply: (game) => game.zombies.spawnSurge(5),
  },
  {
    id: 'blackout',
    name: 'Blackout',
    about: 'the lights go out for the night.',
    labelKey: 'eventBlackout',
    apply: (game) => {
      game.flashlightOn = false
      game.flashlightBattery = 0
      game.generatorFuel = 0
    },
  },
  {
    id: 'supply_drop',
    name: 'Supply Drop',
    about: 'a crate of supplies lands somewhere on the map.',
    labelKey: 'eventSupplyDrop',
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game.chests.addChest(spot.x, 0, spot.z)
    },
  },
  {
    id: 'survivor_found',
    name: 'Survivor Found',
    about: 'an NPC survivor appears to be rescued.',
    labelKey: 'eventSurvivorFound',
    apply: (game) => game._spawnRescueSurvivor(),
  },
  {
    id: 'camp_attack',
    name: 'Camp Attack',
    about: 'a small NPC group under active zombie siege you can save.',
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
    name: 'Supply Convoy',
    about: 'a guarded chest escorted by rival humans.',
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
    name: 'Toxic Gas',
    about: 'a damaging gas cloud spreads over an area.',
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
    id: 'toxic_spread',
    name: 'Spreading Toxic Gas',
    about: 'a version that keeps expanding over time.',
    labelKey: 'eventToxicSpread',
    // Distinct from toxic_gas above: this one starts small and grows every
    // tick it's not dealt with (see Game.js's TOXIC_SPREAD_GROWTH_PER_SEC),
    // instead of a fixed-size cloud that just times out.
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game._spawnHazardZone('toxic_spread', spot.x, spot.z)
    },
  },
  {
    id: 'escort_convoy',
    name: 'Escort Convoy',
    about: 'protect a moving convoy.',
    labelKey: 'eventEscortConvoy',
    apply: (game) => game._spawnEscortConvoy(),
  },
  {
    id: 'radio_distress',
    name: 'Radio Distress Call',
    about: 'a call leads you to a location needing help.',
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
    name: 'EMP Field',
    about: 'an area that disables electronics.',
    labelKey: 'eventEmpField',
    apply: (game) => {
      const spot = game.spawnPoints[Math.floor(Math.random() * game.spawnPoints.length)]
      game._spawnHazardZone('emp', spot.x, spot.z)
    },
  },
  {
    id: 'dilemma',
    name: 'Impossible Choice',
    about: 'survivors trapped in one direction, a loot cache in another, and only time to reach one of them.',
    labelKey: 'eventDilemma',
    // Distinct from every event above: those are each a single standalone
    // objective (succeed, fail, or just walk past). This spawns TWO at
    // once, far enough apart under a shared clock (see Game.js's
    // DILEMMA_MIN_SEPARATION/DILEMMA_TIMER_MS) that going for both for
    // real isn't realistic - a genuine trade-off, not just a timed task.
    apply: (game) => game._spawnDilemma(),
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

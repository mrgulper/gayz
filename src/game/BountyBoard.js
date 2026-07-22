// Side objectives offered at the trader (see Game.js's activeBounty
// tracking), giving a run more shape than just survive-and-shoot. One
// active at a time; completing it grants points and rolls the next.
export const BOUNTY_DEFS = [
  { id: 'kill_screamers', titleKey: 'bountyKillScreamers', target: 3, reward: 25 },
  { id: 'melee_kills', titleKey: 'bountyMeleeKills', target: 10, reward: 20 },
  { id: 'survive_rain_night', titleKey: 'bountySurviveRainNight', target: 1, reward: 20 },
  { id: 'reach_3_nights', titleKey: 'bountyReach3Nights', target: 3, reward: 30 },
  { id: 'survive_snow_night', titleKey: 'bountySurviveSnowNight', target: 1, reward: 20 },
  { id: 'rescue_survivors', titleKey: 'bountyRescueSurvivors', target: 2, reward: 30 },
  // Location picked fresh each time this def is assigned (see Game.js's
  // _assignBounty) - titleKey takes a {location} param on top of the usual
  // {n}, unlike every other def here.
  { id: 'clear_location', titleKey: 'bountyClearLocation', target: 8, reward: 35 },
]

export function pickBounty(excludeId) {
  const pool = BOUNTY_DEFS.filter((b) => b.id !== excludeId)
  const options = pool.length > 0 ? pool : BOUNTY_DEFS
  return options[Math.floor(Math.random() * options.length)]
}

// Lists the game and the server (api/_lib/admin.js) share, in one tiny
// file with no imports: the world events and natural disasters by name
// (WorldEvents.js, Disasters.js - the server checks a "drop an event
// into every game" request against them), and what each live tuning
// multiplier may be (LiveConfig.js tune).
export const WORLD_EVENT_KINDS = ['supply', 'horde', 'meteor', 'survivor', 'golden', 'escort', 'disco', 'pirate', 'haunted', 'ufo', 'dragon', 'graveyard', 'heist', 'blimp']
export const DISASTER_KINDS = ['flood', 'flashFlood', 'drought', 'wildfire', 'forestFire', 'avalanche', 'limnicEruption', 'earthquake', 'tsunami', 'volcanicEruption', 'landslide', 'mudslide', 'rockfall', 'sinkhole', 'subsidence', 'solarFlare', 'geomagneticStorm', 'tornado', 'meteoroid', 'asteroid', 'comet']

// [lowest, highest] for each tuning multiplier (1 = normal).
export const TUNE_LIMITS = { zombieSpeed: [0.5, 2], drops: [0, 5], coins: [0, 5], shopPrices: [0.1, 3], homePrices: [0.1, 3] }

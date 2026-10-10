// What every gun does in Map 1 (the block city) - picked at the start of a
// run from the homepage (2026-10-09, Gaymi: "make the weapons choosable
// like the old Map 1, pickable at the start when joining a game"). The old
// Map 1's weapon code was deleted with it, so these are fresh numbers for
// the block city's zombies (100 health on wave 1, BuildSurvival.js).
//
// damage   per hit (per pellet for shotguns), before upgrades
// rate     seconds between shots
// auto     keeps firing while the button is held
// mag      shots per magazine; reserve = spare ammo at the start
// reload   seconds
// pellets  rays per shot, spread = how far they fan out (radians)
// range    blocks (Infinity = until a wall)
// blast    blocks: everything that close to where it hits is damaged too
export const PLAY_WEAPONS = {
  rifle: { damage: 34, rate: 0.11, auto: true, mag: 30, reserve: 150, reload: 1.6 },
  pistol: { damage: 42, rate: 0.22, mag: 8, reserve: 72, reload: 1.2 },
  glock18: { damage: 24, rate: 0.075, auto: true, mag: 20, reserve: 140, reload: 1.3 },
  minigun: { damage: 20, rate: 0.05, auto: true, mag: 150, reserve: 450, reload: 3.6 },
  shotgun: { damage: 18, rate: 0.75, mag: 6, reserve: 42, reload: 2.2, pellets: 8, spread: 0.075 },
  awp: { damage: 180, rate: 1.25, mag: 5, reserve: 30, reload: 2.6 },
  flamethrower: { damage: 11, rate: 0.06, auto: true, mag: 100, reserve: 300, reload: 2.4, range: 7, pellets: 3, spread: 0.06 },
  rocket: { damage: 200, rate: 1.4, mag: 1, reserve: 12, reload: 2.4, blast: 3 },
  crossbow: { damage: 120, rate: 0.9, mag: 1, reserve: 36, reload: 0.9 },
  launcher: { damage: 130, rate: 0.7, mag: 6, reserve: 24, reload: 2.6, blast: 2.5 },
  suppressedsmg: { damage: 22, rate: 0.07, auto: true, mag: 30, reserve: 180, reload: 1.5 },
  voidripper: { damage: 48, rate: 0.16, auto: true, mag: 24, reserve: 120, reload: 1.8 },
  melee: { damage: 75, rate: 0.45, auto: true, mag: Infinity, reserve: Infinity, reload: 0, range: 2.6 },
}

// Picked when nothing has been chosen yet (and for the Map Editor's own
// Play, which has no picker).
export const DEFAULT_PLAY_WEAPON = 'rifle'

// Ammo pickups (chests, the Trader's ammo box) are written for the rifle's
// 150 spare rounds; other guns get the same share of their own reserve.
export function ammoFor(weaponId, rifleAmount) {
  const w = PLAY_WEAPONS[weaponId] || PLAY_WEAPONS[DEFAULT_PLAY_WEAPON]
  if (!Number.isFinite(w.reserve)) return 0
  return Math.max(1, Math.round((rifleAmount * w.reserve) / PLAY_WEAPONS.rifle.reserve))
}

// 0-1 bars for the picker: damage per second, how fast it fires, ammo.
export function weaponBars(weaponId) {
  const w = PLAY_WEAPONS[weaponId]
  if (!w) return { damage: 0, rate: 0, ammo: 0 }
  const dps = (w.damage * (w.pellets || 1) * (w.blast ? 2 : 1)) / w.rate
  return {
    damage: Math.min(1, (w.damage * (w.pellets || 1)) / 200),
    rate: Math.min(1, 0.05 / w.rate + (dps > 400 ? 0.1 : 0)),
    ammo: Number.isFinite(w.reserve) ? Math.min(1, (w.mag + w.reserve) / 600) : 1,
  }
}

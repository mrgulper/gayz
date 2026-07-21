// Phase 0 of the Extended Metropolitan Grid plan - a lightweight zone
// registry so named locations can tune zombie density / loot tier / day-night
// gating without every system needing its own bespoke per-location logic.
// Deliberately just a flat array + radius check, not a spatial index - zone
// counts here will stay in the dozens (one entry per named location), not
// thousands, so a linear scan per lookup is plenty fast.

const zones = []

// zone: { id, x, z, radius, densityMult = 1, lootTier = 'normal', dayOnly, nightOnly }
export function registerZone(zone) {
  zones.push(zone)
  return zone
}

export function getZoneAt(x, z) {
  for (const zone of zones) {
    const dx = x - zone.x
    const dz = z - zone.z
    if (dx * dx + dz * dz <= zone.radius * zone.radius) return zone
  }
  return null
}

// Test-only escape hatch (mirrors ChestManager.reset()'s style) - lets a
// fresh `new Game()` (or a Playwright test rebuilding the world) start from
// an empty registry instead of accumulating duplicate zones across restarts.
export function clearZones() {
  zones.length = 0
}

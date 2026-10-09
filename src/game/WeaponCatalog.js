import { buildViewmodel } from './Viewmodels.js'

// Every gun's id and name, in hotbar/Inventory order. The old Map 1's
// shooting (WeaponSystem.js) was deleted with it on 2026-10-05; what's left
// is the models: the Map Editor's Try Map holds one (BuildTryMode._showGun)
// and Inventory > Weapons draws its cards and Inspect view from them.
export const WEAPON_LIST = [
  { id: 'melee', name: 'Knife' },
  { id: 'rifle', name: 'AK-47' },
  { id: 'pistol', name: 'M1911' },
  { id: 'minigun', name: 'Minigun' },
  { id: 'shotgun', name: 'Shotgun' },
  { id: 'awp', name: 'AWP' },
  { id: 'glock18', name: 'Glock 18' },
  { id: 'flamethrower', name: 'Flamethrower' },
  { id: 'rocket', name: 'Rocket Launcher' },
  { id: 'crossbow', name: 'Crossbow' },
  { id: 'launcher', name: 'Grenade Launcher' },
  { id: 'suppressedsmg', name: 'Suppressed SMG' },
  { id: 'nailgun', name: 'Nail Gun' },
  { id: 'harpoon', name: 'Harpoon Gun' },
  { id: 'voidripper', name: 'Void Ripper' },
]

// One copy of every gun model, built once on load (main.js preloads the
// GLBs first).
export class WeaponCatalog {
  constructor() {
    this.weapons = WEAPON_LIST.map((w) => ({ ...w, unlocked: true }))
    this.viewmodels = {}
    for (const w of this.weapons) {
      const vm = buildViewmodel(w.id)
      vm.visible = false
      this.viewmodels[w.id] = vm
    }
  }

  get current() {
    return this.weapons[0]
  }

  getSummary() {
    return this.weapons.map((w) => ({
      id: w.id,
      name: w.name,
      nameKey: `weapon${w.id.charAt(0).toUpperCase()}${w.id.slice(1)}`,
      unlocked: w.unlocked,
    }))
  }
}

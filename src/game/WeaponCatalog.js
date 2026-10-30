import { buildViewmodel, preloadWeaponModels } from './Viewmodels.js'

// Every gun's id and name, in hotbar/Inventory order. GayZ's own names
// since 2026-10-30 (Gaymi: "give them names ... new names for each gun");
// the real gun each one is stays in the comment beside it in PlayWeapons.js. The old Map 1's
// shooting code was deleted with it on 2026-10-05; what's left
// is the models: the Map Editor's Try Map holds one (BuildTryMode._showGun)
// and Inventory > Weapons draws its cards and Inspect view from them.
export const WEAPON_LIST = [
  { id: 'melee', name: 'Fang' },
  { id: 'rifle', name: 'Havoc' },
  { id: 'pistol', name: 'Scrapper' },
  { id: 'minigun', name: 'Buzzsaw' },
  { id: 'shotgun', name: 'Boomstick' },
  { id: 'awp', name: 'Farsight' },
  { id: 'revolver', name: 'Outlaw' },
  { id: 'flamethrower', name: 'Dragonbreath' },
  { id: 'rocket', name: 'Skybreaker' },
  { id: 'crossbow', name: 'Quill' },
  { id: 'launcher', name: 'Thumper' },
  { id: 'suppressedsmg', name: 'Whisper' },
  { id: 'voidripper', name: 'Void Ripper' },
  { id: 'gpmg', name: 'Bulldog' },
  { id: 'tomahawk', name: 'Cleaver' },
]

// One copy of every gun model. The game is built before the GLBs finish
// loading (2026-10-27), so these start as stand-in boxes and are rebuilt
// from the real models once `ready` resolves.
export class WeaponCatalog {
  constructor() {
    this.weapons = WEAPON_LIST.map((w) => ({ ...w, unlocked: true }))
    this.viewmodels = {}
    this._build()
    this.ready = preloadWeaponModels().then(() => this._build())
  }

  _build() {
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

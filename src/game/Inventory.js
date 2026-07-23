export class Inventory {
  constructor() {
    this.healthPacks = 0
    this.armorPacks = 0
    this.noisemakers = 0
    this.fuelCans = 0
    this.grenades = 0
    this.barricades = 0
    this.traps = 0
    this.molotovs = 0
    this.c4 = 0
    this.adrenaline = 0
    this.emp = 0
    this.throwingKnives = 0
    this.shields = 0
    this.turretKits = 0
    // A single quest flag, not a stacking count like the rest of this class -
    // there's only ever one Vault Key in play at a time (see Chests.js's
    // Vault and Pickups.js's 'vaultkey' type).
    this.vaultKey = false
  }

  addHealthPack(n = 1) {
    this.healthPacks += n
  }

  addArmorPack(n = 1) {
    this.armorPacks += n
  }

  addNoisemaker(n = 1) {
    this.noisemakers += n
  }

  addFuelCan(n = 1) {
    this.fuelCans += n
  }

  addGrenade(n = 1) {
    this.grenades += n
  }

  addBarricade(n = 1) {
    this.barricades += n
  }

  addTrap(n = 1) {
    this.traps += n
  }

  addMolotov(n = 1) {
    this.molotovs += n
  }

  addC4(n = 1) {
    this.c4 += n
  }

  addAdrenaline(n = 1) {
    this.adrenaline += n
  }

  addEmp(n = 1) {
    this.emp += n
  }

  addThrowingKnife(n = 1) {
    this.throwingKnives += n
  }

  addShield(n = 1) {
    this.shields += n
  }

  addTurretKit(n = 1) {
    this.turretKits += n
  }

  useHealthPack() {
    if (this.healthPacks <= 0) return false
    this.healthPacks -= 1
    return true
  }

  useArmorPack() {
    if (this.armorPacks <= 0) return false
    this.armorPacks -= 1
    return true
  }

  useNoisemaker() {
    if (this.noisemakers <= 0) return false
    this.noisemakers -= 1
    return true
  }

  useFuelCan() {
    if (this.fuelCans <= 0) return false
    this.fuelCans -= 1
    return true
  }

  useGrenade() {
    if (this.grenades <= 0) return false
    this.grenades -= 1
    return true
  }

  useBarricade() {
    if (this.barricades <= 0) return false
    this.barricades -= 1
    return true
  }

  useTrap() {
    if (this.traps <= 0) return false
    this.traps -= 1
    return true
  }

  useMolotov() {
    if (this.molotovs <= 0) return false
    this.molotovs -= 1
    return true
  }

  useC4() {
    if (this.c4 <= 0) return false
    this.c4 -= 1
    return true
  }

  useAdrenaline() {
    if (this.adrenaline <= 0) return false
    this.adrenaline -= 1
    return true
  }

  useThrowingKnife() {
    if (this.throwingKnives <= 0) return false
    this.throwingKnives -= 1
    return true
  }

  useShield() {
    if (this.shields <= 0) return false
    this.shields -= 1
    return true
  }

  useTurretKit() {
    if (this.turretKits <= 0) return false
    this.turretKits -= 1
    return true
  }

  useEmp() {
    if (this.emp <= 0) return false
    this.emp -= 1
    return true
  }

  useVaultKey() {
    if (!this.vaultKey) return false
    this.vaultKey = false
    return true
  }
}

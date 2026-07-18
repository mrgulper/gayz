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
}

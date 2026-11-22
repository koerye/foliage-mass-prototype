import { Vector3 } from 'three'
import type { TreeMassConfig } from './config'

export const tau = Math.PI * 2
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const up = new Vector3(0, 1, 0)
export type XYZ = [number, number, number]

export function seedFor(seed: number, key: number) {
  let n = (seed ^ Math.imul(key, 0x9e3779b9)) >>> 0
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad)
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97)
  return (n ^ (n >>> 15)) >>> 0
}

export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let z = Math.imul(s ^ (s >>> 15), s | 1)
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61)
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

const radii = [.145, .31, .48, .65, .84, 1.00, .87]

export function profile(values: number[], t: number) {
  const a = clamp(t) * (values.length - 1)
  const i = Math.min(values.length - 2, Math.floor(a))
  const u = a - i
  const v0 = values[Math.max(0, i - 1)], v1 = values[i], v2 = values[i + 1], v3 = values[Math.min(values.length - 1, i + 2)]
  return v1 + .5 * u * (v2 - v0 + u * (2 * v0 - 5 * v1 + 4 * v2 - v3 + u * (3 * v1 - v0 - 3 * v2 + v3)))
}

export interface Tier {
  index: number
  u: number
  elevation: number
  radius: number
  pitch: number
  azimuth: number
  center: XYZ
  seed: number
}

export interface FoliageMass {
  id: string
  profile: 'fan' | 'spray'
  tierIndex: number
  azimuth: number
  anchor: XYZ
  length: number
  width: number
  thickness: number
  droop: number
  curl: number
  climb: number
  rise: number
  lobeCount: number
  shadeBand: 0 | 1 | 2
  seed: number
}

export function stemAt(y: number, config: TreeMassConfig) {
  const t = clamp(y / config.totalHeight)
  const phase = seedFor(config.seed, 38) / 0xffffffff * tau
  const sway = config.totalHeight * (.012 + .018 * config.asymmetry)
  return new Vector3(Math.sin(phase + t * 3.4) * t * sway, y,
    (Math.cos(phase * 1.5 + t * 4.2) - Math.cos(phase * 1.5)) * t * sway * .53)
}

export function buildTierLayout(config: TreeMassConfig): Tier[] {
  const random = rng(seedFor(config.seed, 711))
  const phase = random() * tau
  const start = config.crownStart + config.crownHeight
  const pitch = config.crownHeight * .789 / (config.tierCount - 1)
  return Array.from({ length: config.tierCount }, (_, index) => {
    const u = index / (config.tierCount - 1)
    const rhythm = Math.sin(phase + u * 9.3)
    const elevation = start - config.crownHeight * .104 - pitch * (config.tierCount - 1) * u ** 1.19
      + pitch * rhythm * config.asymmetry * .09 * Math.sin(Math.PI * u)
    const center = stemAt(elevation, config)
    return {
      index, u, elevation,
      radius: config.maxCrownRadius * profile(radii, u) * (1 + .054 * config.asymmetry * rhythm),
      pitch, azimuth: phase * .20 + index * .53 + rhythm * config.asymmetry * .25,
      center: center.toArray(), seed: seedFor(config.seed, index + 1024),
    }
  })
}

export function generateFoliageMasses(tiers: Tier[], config: TreeMassConfig): FoliageMass[] {
  return tiers.flatMap(tier => Array.from({ length: config.massesPerTier }, (_, slot) => {
    const seed = seedFor(tier.seed, slot + 571)
    const random = rng(seed)
    const a = slot / config.massesPerTier * tau + tier.azimuth + (random() - .5) * config.asymmetry * .42
    const balance = Math.sin(a * 1.8 + tier.u * 4.1) * config.asymmetry
    const vigor = .91 + (slot % 3 === (tier.index + 1) % 3 ? .17 : 0)
    const reach = tier.radius * (vigor + balance * .24 + (random() - .5) * config.asymmetry * .14)
    const leader = tier.index === 0 && slot === 0
    const tight = tier.index === 0
    const nominalDepth = tier.pitch / (1 - config.tierOverlap) * (.49 + tier.u * .16)
    const anchor = new Vector3().fromArray(tier.center)
    anchor.x -= Math.cos(a) * reach * .060
    anchor.z -= Math.sin(a) * reach * .060
    anchor.y += (balance * .35 + (random() - .5) * config.asymmetry * .31) * tier.pitch
    if (tight && !leader) anchor.y -= tier.pitch * .24
    const length = reach * (leader ? .53 : tight ? 1.05 : .98)
    const skirt = .46 + .54 * tier.u
    const drop = tight ? (leader ? .015 : .23 + config.droop * .21) : (.12 + config.droop * reach * .54) * skirt
    return {
      id: `tier-${tier.index}/mass-${slot}`, profile: 'fan', tierIndex: tier.index, azimuth: a, anchor: anchor.toArray(),
      length,
      width: Math.max(config.totalHeight * .033, reach * lerp(.92, 1.54, config.macroLobeWidth) * (leader ? .65 : 1)),
      thickness: nominalDepth * (leader ? .43 : tight ? .62 : 1.04) * (1 + balance * .15),
      droop: Math.min(drop, Math.max(.04, anchor.y - config.crownStart * .42 - nominalDepth * .55)),
      curl: (.16 + config.droop * .43) * nominalDepth * (tight ? .32 : 1),
      rise: tier.pitch * (tight ? .046 : .12 + .13 * (1 - tier.u)),
      climb: leader ? config.crownHeight * .102 : tight ? config.crownHeight * .015 : 0,
      lobeCount: 2 + Math.floor(random() * 3),
      shadeBand: tier.u < .26 ? 0 : tier.u > .81 ? 2 : 1, seed,
    }
  }))
}

const rails = [.28, .68, .94, .79, 1, .73, .82, .47, .075]
const sprayRails = [.19, .46, .76, .96, 1, .84, .54, .23, .04]

export function loftFrame(mass: FoliageMass) {
  const along = new Vector3(Math.cos(mass.azimuth), 0, Math.sin(mass.azimuth))
  const across = new Vector3().crossVectors(up, along)
  const root = new Vector3().fromArray(mass.anchor)
  const phase = (mass.seed % 1009) / 1009 * tau
  const center = (u: number) => root.clone().addScaledVector(along, u * mass.length)
    .add(new Vector3(0, mass.climb * u + mass.rise * Math.sin(Math.PI * u) - mass.droop * u ** 1.61, 0))
    .addScaledVector(across, mass.width * .096 * Math.sin(phase + u * 3.6) * Math.sin(Math.PI * u))

  function point(u: number, angle: number) {
    const s = Math.cos(angle), height = Math.sin(angle)
    const envelope = Math.sin(Math.PI * u)
    const side = s < 0 ? -1 : 1
    // Broad edge lobes sit in the width rail and curl downward into the skirt.
    const wave = Math.sin(u * Math.PI * (mass.lobeCount * 1.93) + phase * .74 + side * .94)
    const drift = side * envelope * (.045 + .027 * Math.sin(phase))
    const rail = profile(mass.profile === 'fan' ? rails : sprayRails, u + drift) * (1 + envelope * .18 * wave)
    const shoulder = Math.sin(u * Math.PI * 2.1 + phase) * envelope * .038
    const span = mass.width * .5 * rail
    const z = mass.thickness * (.048 + .46 * Math.sin(Math.PI * u ** .83) ** .79)
    const curl = mass.curl * Math.abs(s) ** 1.55 * envelope ** .70 * (.24 + .76 * u) * (1 + wave * .19)
    const curveSlope = mass.climb + mass.rise * Math.PI * Math.cos(Math.PI * u) - 1.61 * mass.droop * u ** .61
    const tangent = along.clone().multiplyScalar(mass.length).addScaledVector(up, curveSlope).normalize()
    const dorsal = new Vector3().crossVectors(tangent, across)
    const arch = height > 0 ? (1.02 + .13 * Math.exp(-(s ** 2) / .05) - .24 * s ** 2) * height : .71 * height
    return center(u).addScaledVector(across, (s + shoulder) * span)
      .addScaledVector(along, -mass.length * .072 * envelope * s ** 2 * u)
      .addScaledVector(dorsal, arch * z - curl)
  }

  return { center, point }
}

export function generateMeso(masses: FoliageMass[], config: TreeMassConfig) {
  return masses.flatMap(parent => {
    const random = rng(seedFor(parent.seed, 808))
    const frame = loftFrame(parent)
    const count = 2 + Number(parent.lobeCount > 2)
    return Array.from({ length: count }, (_, i): FoliageMass => {
      const side = i === 1 ? -1 : 1
      const u = [.37, .46, .64][i] + (random() - .5) * config.asymmetry * .08
      const angle = side > 0 ? .43 : Math.PI - .43
      const root = frame.point(u, angle).lerp(frame.center(u), .13)
      return {
        id: `${parent.id}/lobe-${i}`, profile: 'spray', tierIndex: parent.tierIndex,
        azimuth: parent.azimuth - side * (.63 + .20 * random()), anchor: root.toArray(),
        length: parent.length * [.44, .41, .33][i],
        width: parent.width * (.22 + .066 * random()),
        thickness: parent.thickness * .30,
        droop: parent.droop * (.50 + .15 * random()), curl: parent.curl * .65,
        rise: parent.rise * .32, climb: parent.climb * .23,
        lobeCount: 2, shadeBand: parent.shadeBand, seed: seedFor(parent.seed, i + 5431),
      }
    })
  })
}

export function generateMicro(masses: FoliageMass[]): FoliageMass[] {
  return masses.filter((_, i) => i % 3 !== 0).map(parent => {
    const u = .34 + (parent.seed % 9) * .018
    const angle = parent.seed % 2 ? 1.28 : 1.84
    const root = loftFrame(parent).point(u, angle).addScaledVector(up, parent.thickness * .009)
    return {
      ...parent, id: parent.id + '/rim-accent', profile: 'spray', anchor: root.toArray(),
      length: parent.length * .14, width: parent.width * .068, thickness: parent.thickness * .13,
      azimuth: parent.azimuth + (parent.seed % 2 ? .13 : -.13), droop: parent.droop * .11,
      rise: parent.rise * .55, curl: parent.curl * .19, climb: parent.climb * .14, lobeCount: 2,
      seed: seedFor(parent.seed, 848),
    }
  })
}


import { describe, expect, it } from 'vitest'
import { Box3, Vector3, type BufferGeometry } from 'three'
import { defaults, parseConfig, saveConfig } from '../src/config'
import { bandGeometry } from '../src/mesh'
import { buildTierLayout, generateFoliageMasses, generateMeso, loftFrame } from '../src/shape'
import { assembleStylizedTree } from '../src/tree'

function closed(geometry: BufferGeometry) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  const colors = geometry.getAttribute('color'), index = geometry.index!
  expect([positions, normals, colors].every(attribute => attribute.count === positions.count && attribute.array.every(Number.isFinite))).toBe(true)
  const edges = new Map<number, number>()
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), sideA = new Vector3(), sideB = new Vector3()
  let volume = 0, minArea = Infinity, badWinding = 0
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
    for (let j = 0; j < 3; j++) {
      const k = triangle[j], l = triangle[(j + 1) % 3]
      const key = Math.min(k, l) * positions.count + Math.max(k, l)
      edges.set(key, (edges.get(key) ?? 0) + 1)
      if (k < 0 || k >= positions.count || k === l) badWinding++
    }
    a.fromBufferAttribute(positions, triangle[0])
    b.fromBufferAttribute(positions, triangle[1])
    c.fromBufferAttribute(positions, triangle[2])
    minArea = Math.min(minArea, sideA.subVectors(b, a).cross(sideB.subVectors(c, a)).lengthSq())
    volume += a.dot(sideA.crossVectors(b, c)) / 6
  }
  expect(badWinding).toBe(0)
  expect([...edges.values()].every(count => count === 2)).toBe(true)
  expect(minArea).toBeGreaterThan(1e-20)
  expect(volume).toBeGreaterThan(0)
  let error = 0
  for (let i = 0; i < normals.count; i++) error = Math.max(error, Math.abs(a.fromBufferAttribute(normals, i).lengthSq() - 1))
  expect(error).toBeLessThan(1e-4)
}

const buffers = (geometry: BufferGeometry) => [
  geometry.getAttribute('position').array, geometry.getAttribute('normal').array, geometry.index!.array,
]

describe('v1 configuration', () => {
  it('round trips the default preset and keeps the smaller height preset valid', () => {
    expect(parseConfig(JSON.parse(saveConfig(defaults())))).toEqual(defaults())
    expect(parseConfig({ totalHeight: 3 }).crownHeight).toBeCloseTo(2.56)
  })
  it.each([
    { seed: -1 }, { seed: .5 }, { tierCount: 9 }, { massesPerTier: 1 }, { droop: Infinity },
    { crownHeight: 6 }, { tierOverlap: .5 }, { schemaVersion: 2 }, { macroEnabled: 'false' },
    { palette: { middle: 'green' } }, { unrelated: 1 }, null,
  ])('reports invalid config %o', unknown => {
    expect(() => parseConfig(unknown)).toThrow()
  })
})

describe('sculpted volumes', () => {
  it('produces a repeatable config, loft buffers, and layout', () => {
    const first = assembleStylizedTree(defaults()), second = assembleStylizedTree(defaults())
    expect(first.tiers).toEqual(second.tiers)
    expect(first.masses).toEqual(second.masses)
    expect(first.meso).toEqual(second.meso)
    for (const key of ['macro', 'meso', 'micro'] as const) expect(buffers(first.batches[key])).toEqual(buffers(second.batches[key]))
    first.dispose()
    second.dispose()
  })

  it.each([6, 7, 8])('maintains a tapered %d-tier silhouette through ten deterministic seeds', tierCount => {
    const signatures = new Set<string>()
    for (const seed of [4607, 8123, 1307, 9731, 3089, 6727, 11003, 18447, 19339, 24611]) {
      const config = parseConfig({ tierCount, seed })
      const tiers = buildTierLayout(config)
      const masses = generateFoliageMasses(tiers, config)
      expect(tiers.length).toBe(tierCount)
      expect(masses.length).toBe(tierCount * 4)
      expect(tiers.every((tier, i) => i === 0 || tier.elevation < tiers[i - 1].elevation)).toBe(true)
      expect(tiers[0].radius).toBeLessThan(tiers.at(-1)!.radius / 4)
      expect(tiers.at(-1)!.radius).toBeLessThan(tiers.at(-2)!.radius)
      signatures.add(JSON.stringify(masses))
    }
    expect(signatures.size).toBe(10)
  })

  it.each([3, 4, 5])('binds all meso lobes to a parent shell at %d volumes per tier', massesPerTier => {
    const config = parseConfig({ massesPerTier })
    const masses = generateFoliageMasses(buildTierLayout(config), config)
    const children = generateMeso(masses, config)
    expect(masses).toHaveLength(7 * massesPerTier)
    for (const mass of masses) {
      const attached = children.filter(child => child.id.startsWith(mass.id + '/'))
      expect(attached.length).toBeGreaterThanOrEqual(2)
      expect(attached.length).toBeLessThanOrEqual(4)
      const frame = loftFrame(mass)
      for (const child of attached) {
        const root = new Vector3().fromArray(child.anchor)
        const proximity = Math.min(...Array.from({ length: 31 }, (_, i) => frame.center(i / 30).distanceTo(root)))
        expect(proximity).toBeLessThan(Math.max(mass.width, mass.thickness) * .55)
        expect(child.length).toBeLessThan(mass.length * .5)
      }
    }
  })

  it.each([
    {},
    { totalHeight: 3, crownHeight: 2.1, crownStart: .25, maxCrownRadius: .85, tierOverlap: .25, asymmetry: 0, droop: 0, macroLobeWidth: .38, tierCount: 6, massesPerTier: 3 },
    { totalHeight: 14, crownHeight: 13.75, crownStart: .25, maxCrownRadius: 5.2, tierOverlap: .4, asymmetry: 1, droop: 1, macroLobeWidth: .95, tierCount: 8, massesPerTier: 5 },
  ])('builds closed, oriented lofts and normalized normals at parameter boundaries %o', overrides => {
    const tree = assembleStylizedTree(parseConfig(overrides))
    for (const geometry of [tree.trunk.geometry, ...Object.values(tree.batches)]) closed(geometry)
    const box = new Box3().setFromObject(tree.group)
    expect(box.max.y / tree.tiers[0].elevation).toBeGreaterThan(1.015)
    expect(box.min.y).toBeGreaterThanOrEqual(-.002)
    tree.dispose()
  })

  it('connects droop, overlap, asymmetry and lobe width to the actual 3D surface', () => {
    const base = defaults()
    const source = generateFoliageMasses(buildTierLayout(base), base)
    const positions = (config: typeof base) => {
      const data = generateFoliageMasses(buildTierLayout(config), config)
      return loftFrame(data[19]).point(.81, .92).toArray()
    }
    for (const [field, value] of [['droop', .93], ['tierOverlap', .4], ['asymmetry', .92], ['macroLobeWidth', .91]] as const) {
      expect(positions({ ...base, [field]: value })).not.toEqual(positions(base))
    }
    expect(loftFrame(source[19]).point(.6, Math.PI * .5).y).toBeGreaterThan(loftFrame(source[19]).point(.6, Math.PI * 1.5).y)
  })

  it('changes visibility only and keeps the three diagnostic colors face-constant', () => {
    const config = defaults()
    const tree = assembleStylizedTree(config)
    const original = tree.layers.macro.geometry
    const base = tree.stats()
    tree.display('macro', config)
    expect(tree.stats().macro).toBe(base.macro)
    expect(tree.stats().meso).toBe(0)
    tree.display('final', { ...config, macroEnabled: false, microEnabled: true })
    expect(tree.stats().macro).toBe(0)
    expect(tree.stats().meso).toBe(base.meso)
    expect(tree.stats().micro).toBeGreaterThan(0)
    expect(tree.layers.macro.geometry).toBe(original)
    const bands = bandGeometry(original, config)
    const colors = bands.getAttribute('color')
    const palette = new Set<string>()
    for (let i = 0; i < colors.count; i += 3) {
      const c = [colors.getX(i), colors.getY(i), colors.getZ(i)]
      palette.add(c.join(','))
      expect([colors.getX(i + 1), colors.getY(i + 1), colors.getZ(i + 1)]).toEqual(c)
    }
    expect(palette.size).toBe(3)
    bands.dispose()
    tree.dispose()
  })
})


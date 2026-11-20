import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { crownShapes, defaults, parseBroadleafConfig, seeds, speciesList } from '../src/broadleaf/config'
import { buildGrowth } from '../src/broadleaf/growth'
import { sheetGeometry } from '../src/foliage-sheets'

describe('broadleaf growth', () => {
  it.each(speciesList)('repeats %s exactly and varies with the three preset seeds', species => {
    const signature = (seed: number) => buildGrowth(defaults(species, seed)).clusters.map(cluster => cluster.center.toArray())
    const variants = seeds[species].map(seed => {
      expect(signature(seed)).toEqual(signature(seed))
      return JSON.stringify(signature(seed))
    })
    expect(new Set(variants).size).toBe(3)
  })

  it.each(speciesList)('attaches each %s crown cluster and each daughter branch to a real socket', species => {
    for (const seed of seeds[species]) {
      for (const crownShape of crownShapes) {
        const { limbs, clusters, config } = buildGrowth({ ...defaults(species, seed), crownShape })
        const parents = new Set<number>()
        expect(clusters).toHaveLength(config.crownClusterCount)
        expect(limbs.filter(limb => limb.kind === 'primary')).toHaveLength(config.primaryBranchCount)
        expect(limbs.length).toBeGreaterThan(config.primaryBranchCount * 2)
        for (const limb of limbs.slice(1)) {
          const parent = limbs[limb.parentId!]
          expect(parent.curve.getPoint(limb.socket!).distanceTo(limb.curve.v0)).toBeLessThan(1e-6)
          expect(limb.curve.v0.distanceTo(limb.curve.v3)).toBeGreaterThan(.03)
          expect(limb.tipRadius).toBeLessThan(limb.rootRadius)
        }
        for (const cluster of clusters) {
          const branch = limbs[cluster.branchId]
          parents.add(branch.kind === 'primary' ? branch.id : branch.parentId!)
          expect(branch.curve.getPoint(cluster.socket).distanceTo(cluster.center)).toBeLessThan(1e-6)
          expect(cluster.direction.length()).toBeCloseTo(1)
          expect(cluster.width * cluster.height * cluster.depth).toBeGreaterThan(0)
        }
        expect(parents.size).toBe(config.primaryBranchCount)
      }
    }
  })

  it('keeps separate species topology and changes the crown envelope independently', () => {
    const round = buildGrowth(defaults('round'))
    const open = buildGrowth(defaults('open'))
    expect(round.clusters.length).toBeGreaterThan(open.clusters.length)
    expect(round.limbs.filter(limb => limb.kind === 'primary')).toHaveLength(7)
    expect(open.limbs.filter(limb => limb.kind === 'primary')).toHaveLength(5)
    const growthWithShape = (crownShape: typeof crownShapes[number]) => buildGrowth({ ...round.config, crownShape })
    const spread = (growth: typeof round) => Math.max(...growth.clusters.map(cluster => Math.hypot(cluster.center.x, cluster.center.z)))
    expect(spread(growthWithShape('wide'))).toBeGreaterThan(spread(round))
    expect(growthWithShape('irregular').clusters[0].center.distanceTo(round.clusters[0].center)).toBeGreaterThan(.01)
  })

  it('honors per-primary growth overrides on the selected branch', () => {
    const base = defaults('open')
    const before = buildGrowth(base).limbs[1]
    const grown = buildGrowth({ ...base, primaryBranches: [{ yaw: -85, length: 1.30, thickness: 1.2, angle: 33, children: 4, droop: .65 }] })
    const after = grown.limbs[1]
    expect(after.curve.v3.z).toBeLessThan(0)
    expect(after.curve.v3.y).toBeLessThan(before.curve.v3.y)
    expect(after.rootRadius / before.rootRadius).toBeCloseTo(1.2)
    expect(grown.limbs.filter(limb => limb.parentId === after.id)).toHaveLength(4)
  })

  it('rejects invalid range, type, counts, geometry relationships and branch overrides', () => {
    const config = defaults('round')
    for (const bad of [
      { seed: -1 }, { primaryBranchCount: 3.5 }, { crownWidth: Infinity }, { foliageScale: '1' },
      { trunkHeight: 5 }, { crownHeight: 6 }, { crownClusterCount: 4 }, { species: 'pine' },
      { schemaVersion: 2 }, { crownShape: 'none' }, { primaryBranches: [{ yaw: 600 }] },
      { primaryBranches: [{ children: 3.4 }] }, { primaryBranches: [{ angle: null }] },
    ]) expect(() => parseBroadleafConfig({ ...config, ...bad })).toThrow()
    expect(parseBroadleafConfig(JSON.parse(JSON.stringify(config)))).toEqual(config)
  })

  it('uses the shared sheet geometry with a continuous top, underside, and UVs', () => {
    const sheet = sheetGeometry({ yaw: 0, length: 1, width: .38, drop: .12, lift: .10, index: 3, origin: new Vector3() })
    expect(sheet.groups).toHaveLength(2)
    expect(sheet.groups[0].count + sheet.groups[1].count).toBe(sheet.index!.count)
    for (const name of ['position', 'normal', 'uv']) expect(sheet.getAttribute(name).array.every(Number.isFinite)).toBe(true)
    expect(sheet.getAttribute('normal').getY(15)).toBeGreaterThan(0)
    sheet.dispose()
  })
})

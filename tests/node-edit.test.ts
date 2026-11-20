import { describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { buildSkeleton } from '../src/tree/skeleton'
import { parseTreeSpec, presetSpec, type BranchEdit } from '../src/tree/spec'
import { buildWood, estimateBranchTriangles } from '../src/tree/wood'

const tex = () => new Texture()
const dummyTextures: TreeTextures = {
  leaf: tex(), needle: tex(), drape: tex(), palm: tex(), grass: tex(), fern: tex(),
  flower: tex(), blossom: tex(), sakura: tex(), cloud: tex(), maple: tex(), willow: tex(),
}

describe('SpeedTree-style per-branch node editing (branchEdits)', () => {
  it('produces identical skeleton when branchEdits is absent or empty', () => {
    const base = presetSpec('broadleaf-maple')
    const skA = buildSkeleton(base)
    const skB = buildSkeleton({ ...base, branchEdits: [] })
    expect(skB.branches.length).toBe(skA.branches.length)
    for (let i = 0; i < skA.branches.length; i++) {
      expect(skB.branches[i].length).toBeCloseTo(skA.branches[i].length, 6)
      expect(skB.branches[i].points[skB.branches[i].points.length - 1].distanceTo(
        skA.branches[i].points[skA.branches[i].points.length - 1],
      )).toBeLessThan(1e-6)
    }
  })

  it('scales limb length and keeps attached child branches locked to the edited parent socket', () => {
    const base = presetSpec('broadleaf-round')
    const skBefore = buildSkeleton(base)
    const limb = skBefore.branches.find(b => b.role === 'limb')!
    const childrenBefore = skBefore.branches.filter(b => b.parentId === limb.id)
    expect(childrenBefore.length).toBeGreaterThan(0)

    const skAfter = buildSkeleton({
      ...base,
      branchEdits: [{ id: limb.id, lengthScale: 1.75 }],
    })
    const limbAfter = skAfter.branches.find(b => b.id === limb.id)!
    expect(limbAfter.length / limb.length).toBeCloseTo(1.75, 2)
    // Limb root stays locked at trunk socket
    expect(limbAfter.points[0].distanceTo(limb.points[0])).toBeLessThan(1e-4)

    // Every child stays seamlessly attached to its edited parent socket
    for (const cb of childrenBefore) {
      const ca = skAfter.branches.find(b => b.id === cb.id)!
      const expectedSocket = limbAfter.curve.getPoint(ca.socket!)
      expect(ca.points[0].distanceTo(expectedSocket)).toBeLessThan(1e-3)
      // Child physically moved outward along with lengthened parent
      expect(ca.points[0].distanceTo(cb.points[0])).toBeGreaterThan(.05)
    }
  })

  it('tilts pitch upward (+) / downward (-) and swings yaw cleanly around Y', () => {
    const base = presetSpec('broadleaf-open')
    const sk0 = buildSkeleton(base)
    const limb = sk0.branches.find(b => b.role === 'limb')!
    const tip0 = limb.points[limb.points.length - 1]

    const skUp = buildSkeleton({ ...base, branchEdits: [{ id: limb.id, pitchDelta: 28 }] })
    const tipUp = skUp.branches.find(b => b.id === limb.id)!.points.at(-1)!
    expect(tipUp.y).toBeGreaterThan(tip0.y + .25)

    const skDown = buildSkeleton({ ...base, branchEdits: [{ id: limb.id, pitchDelta: -28 }] })
    const tipDown = skDown.branches.find(b => b.id === limb.id)!.points.at(-1)!
    expect(tipDown.y).toBeLessThan(tip0.y - .25)

    const skYaw = buildSkeleton({ ...base, branchEdits: [{ id: limb.id, yawDelta: 90 }] })
    const limbYaw = skYaw.branches.find(b => b.id === limb.id)!
    const tipYaw = limbYaw.points.at(-1)!
    expect(limbYaw.length).toBeCloseTo(limb.length, 2)
    // Tip moved substantially horizontally while keeping nearly same Y
    expect(Math.hypot(tipYaw.x - tip0.x, tipYaw.z - tip0.z)).toBeGreaterThan(.5)
    expect(Math.abs(tipYaw.y - tip0.y)).toBeLessThan(.15)
  })

  it('applies gravity arch/droop and radius scaling safely within parent bark', () => {
    const base = presetSpec('broadleaf-round')
    const sk0 = buildSkeleton(base)
    const limb = sk0.branches.find(b => b.role === 'limb')!
    const tip0 = limb.points.at(-1)!

    const skDroop = buildSkeleton({ ...base, branchEdits: [{ id: limb.id, gravityDelta: .9, radiusScale: 1.8 }] })
    const limbDroop = skDroop.branches.find(b => b.id === limb.id)!
    expect(limbDroop.points.at(-1)!.y).toBeLessThan(tip0.y - .3)
    expect(limbDroop.rootRadius).toBeGreaterThan(limb.rootRadius * 1.1)

    // Root radius remains strictly contained inside parent trunk
    const parentTrunkR = skDroop.trunk.radii[Math.round(limbDroop.socket! * (skDroop.trunk.radii.length - 1))]
    expect(limbDroop.rootRadius).toBeLessThanOrEqual(parentTrunkR * .95)
  })

  it('sculpts branch centerline accurately with 4 direct spline control offsets while pinning root', () => {
    const base = presetSpec('broadleaf-maple')
    const sk0 = buildSkeleton(base)
    const trunk0 = sk0.trunk
    const mid0 = trunk0.curve.getPoint(.5)
    const tip0 = trunk0.curve.getPoint(1)

    const edits: BranchEdit[] = [{
      id: 0,
      spineOffsets: [
        [0, 0, 0],
        [.45, .15, -.1],
        [.2, .1, .05],
        [-.3, .25, .15],
      ],
    }]
    const sk1 = buildSkeleton({ ...base, branchEdits: edits })
    const trunk1 = sk1.trunk
    // Trunk root stays pinned at origin
    expect(trunk1.points[0].distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-6)
    // Midpoint & apex track their dragged spline offsets closely
    expect(trunk1.curve.getPoint(.5).distanceTo(mid0.clone().add(new Vector3(.45, .15, -.1)))).toBeLessThan(.08)
    expect(trunk1.curve.getPoint(1).distanceTo(tip0.clone().add(new Vector3(-.3, .25, .15)))).toBeLessThan(.05)
    // Primary limbs follow the sculpted trunk seamlessly
    for (const limb of sk1.branches.filter(b => b.role === 'limb')) {
      expect(limb.points[0].distanceTo(trunk1.curve.getPoint(limb.socket!))).toBeLessThan(1e-3)
    }
  })

  it('cascades branch pruning to descendants and builds watertight wood without index bugs', () => {
    const base = presetSpec('broadleaf-round')
    const sk0 = buildSkeleton(base)
    const limb = sk0.branches.find(b => b.role === 'limb')!
    const descCount = sk0.branches.filter(b => b.parentId === limb.id).length
    expect(descCount).toBeGreaterThan(0)

    // Pruning limb + attempting to prune trunk (ignored)
    const edited = { ...base, branchEdits: [{ id: 0, pruned: true }, { id: limb.id, pruned: true }] }
    const sk1 = buildSkeleton(edited)
    expect(sk1.branches.some(b => b.id === 0)).toBe(true)
    expect(sk1.branches.some(b => b.id === limb.id)).toBe(false)
    expect(sk1.branches.length).toBe(sk0.branches.length - 1 - descCount)

    // Full buildTree & buildWood succeed cleanly after pruning
    const asset = buildTree(edited, dummyTextures)
    expect(asset.stats.triangles).toBeGreaterThan(200)
    asset.dispose()
  })

  it('strips foliage cleanly per branch (bare) on both broadleaf and conifer without deleting wood', () => {
    const broad = presetSpec('broadleaf-maple')
    const broadFull = buildTree(broad, dummyTextures)
    const broadLimbIds = broadFull.skeleton.branches.filter(b => b.role === 'limb').slice(0, 3).map(b => b.id)
    const broadBare = buildTree({ ...broad, branchEdits: broadLimbIds.map(id => ({ id, bare: true })) }, dummyTextures)
    expect(broadBare.skeleton.branches.length).toBe(broadFull.skeleton.branches.length)
    expect(broadBare.stats.leaves).toBeLessThan(broadFull.stats.leaves * .8)
    broadFull.dispose()
    broadBare.dispose()

    const con = presetSpec('conifer-standard')
    const conFull = buildTree(con, dummyTextures)
    const conLimbIds = conFull.skeleton.branches.filter(b => b.role === 'limb').slice(0, 12).map(b => b.id)
    const conBare = buildTree({ ...con, branchEdits: conLimbIds.map(id => ({ id, bare: true })) }, dummyTextures)
    expect(conBare.stats.leaves).toBeLessThan(conFull.stats.leaves)
    conFull.dispose()
    conBare.dispose()
  })

  it('supports SpeedTree trunk node editing on palm trees', () => {
    const palm = presetSpec('palm-tropical')
    const sk0 = buildSkeleton(palm)
    const sk1 = buildSkeleton({ ...palm, branchEdits: [{ id: 0, lengthScale: 1.4, pitchDelta: 15 }] })
    expect(sk1.trunk.length / sk0.trunk.length).toBeCloseTo(1.4, 2)
    expect(sk1.trunk.points[0].length()).toBeLessThan(1e-6)
  })

  it('estimates exact per-branch wood triangle count matching buildWood', () => {
    const spec = { ...presetSpec('broadleaf-round'), trunk: { ...presetSpec('broadleaf-round').trunk, surfaceRoots: 0 } }
    const sk = buildSkeleton(spec)
    const geo = buildWood(sk.branches, spec.trunk, spec.seed, { detail: 1 })
    const actualTotal = geo.index!.count / 3
    const estimatedSum = sk.branches.reduce((sum, b) => sum + estimateBranchTriangles(b, 1), 0)
    expect(estimatedSum).toBe(actualTotal)
    geo.dispose()
  })

  it('round-trips branchEdits cleanly through JSON and parseTreeSpec with safe clamping', () => {
    const base = presetSpec('broadleaf-sakura')
    const raw = {
      ...base,
      branchEdits: [
        { id: 0, lengthScale: 1.25, radiusScale: 1.15, pitchDelta: 12, yawDelta: -25, gravityDelta: .3, pruned: true },
        { id: 3, lengthScale: 9.9, pitchDelta: -200, bare: true, spineOffsets: [[.1, .2, 0], [0, .3, -.1]] },
      ],
    }
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(raw)))
    expect(parsed.branchEdits).toHaveLength(2)
    // Trunk cannot be pruned
    expect(parsed.branchEdits![0].pruned).toBeUndefined()
    expect(parsed.branchEdits![0].lengthScale).toBeCloseTo(1.25, 3)
    // Out-of-range values clamped safely
    expect(parsed.branchEdits![1].lengthScale).toBe(2.5)
    expect(parsed.branchEdits![1].pitchDelta).toBe(-65)
    expect(parsed.branchEdits![1].bare).toBe(true)
    expect(parsed.branchEdits![1].spineOffsets).toEqual([[.1, .2, 0], [0, .3, -.1]])
  })
})

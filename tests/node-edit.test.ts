import { describe, expect, it } from 'vitest'
import { Mesh, Texture, Vector3 } from 'three'
import { envelopeNormal, fitEnvelope } from '../src/broadleaf/leaves'
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

  it('refits CrownEnvelope & prevents dark AO / inverted clump normals after S-curve trunk and limb node edits', () => {
    // Reproduces sculpting a dramatic S-curved trunk + pushed-out limb like the user's screenshot
    const base = presetSpec('broadleaf-round')
    const sculpted = {
      ...base,
      branchEdits: [
        {
          id: 0,
          pitchDelta: 14,
          spineOffsets: [
            [.85, 0, 0],
            [.35, .15, 0],
            [-.55, .25, 0],
            [-.2, .4, 0],
          ] as [number, number, number][],
        },
        { id: 1, lengthScale: 1.45, pitchDelta: 18 },
      ],
    }
    const sk0 = buildSkeleton(base)
    const sk1 = buildSkeleton(sculpted)
    // Crown envelope dynamically refits to the sculpted canopy rather than staying stuck at pre-edit bounds
    expect(sk1.envelope.axis.distanceTo(sk0.envelope.axis)).toBeGreaterThan(.1)

    // No clump normal may ever invert inward against the outward crown normal (prevents black concave creases)
    const fitted = fitEnvelope([], sk1.branches, sk1.clusters, sculpted.leaves)
    const nCrown = new Vector3(), nClump = new Vector3()
    for (const c of sk1.clusters) {
      for (const dir of [
        new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
        new Vector3(0, 1, 0), new Vector3(0, -1, 0),
        new Vector3(0, 0, 1), new Vector3(0, 0, -1),
      ]) {
        const pt = c.center.clone().addScaledVector(dir, c.width * .45)
        envelopeNormal(fitted, pt, 'crown', nCrown)
        envelopeNormal(fitted, pt, 'clumps', nClump)
        expect(nClump.dot(nCrown)).toBeGreaterThan(0)
      }
    }

    // Build full broadleaf leaves & verify no extreme near-black vertex colors collapse on exterior edited lobes
    const built = buildTree(sculpted, dummyTextures)
    let leafMesh: Mesh | undefined
    built.group.traverse(o => { if (o instanceof Mesh && o.name === 'Leaf cards') leafMesh = o })
    expect(leafMesh).toBeDefined()
    const col = leafMesh!.geometry.getAttribute('color')
    let minLum = Infinity
    for (let i = 0; i < col.count; i++) {
      const lum = col.getX(i) * .2126 + col.getY(i) * .7152 + col.getZ(i) * .0722
      if (lum < minLum) minLum = lum
    }
    // Linear luminance floor stays well above dark mud (no black vertex patches)
    expect(minLum).toBeGreaterThan(.04)
    built.dispose()
  })

  it('slides a primary limb and child branch along parent spline via socketDelta with welded sculpted wood', () => {
    const base = presetSpec('broadleaf-driftwood')
    const sk0 = buildSkeleton(base)
    const limb = sk0.branches.find(b => b.role === 'limb')!
    const child = sk0.branches.find(b => b.parentId === limb.id)!
    const origLimbSock = limb.baseSocket!
    const origChildSock = child.baseSocket!

    const sk1 = buildSkeleton({
      ...base,
      branchEdits: [
        { id: limb.id, socketDelta: -.28 },
        { id: child.id, socketDelta: .22 },
      ],
    })
    const limb1 = sk1.branches.find(b => b.id === limb.id)!
    const child1 = sk1.branches.find(b => b.id === child.id)!

    expect(limb1.baseSocket).toBeCloseTo(origLimbSock, 5)
    expect(limb1.socket).toBeCloseTo(Math.max(.04, origLimbSock - .28), 3)
    expect(limb1.points[0].distanceTo(sk1.trunk.curve.getPoint(limb1.socket!))).toBeLessThan(1e-3)
    expect(limb1.points[0].y).toBeLessThan(limb.points[0].y - .3)

    expect(child1.baseSocket).toBeCloseTo(origChildSock, 5)
    expect(child1.socket).toBeCloseTo(Math.min(.98, origChildSock + .22), 3)
    expect(child1.points[0].distanceTo(limb1.curve.getPoint(child1.socket!))).toBeLessThan(1e-3)

    // Sculpted trunk collar welding rebuilds cleanly at the new slid socket without NaN vertices
    const wood = buildWood(sk1.branches, base.trunk, base.seed, { detail: 1 })
    const pos = wood.getAttribute('position')
    expect(pos.count).toBeGreaterThan(200)
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true)
      expect(Number.isFinite(pos.getY(i))).toBe(true)
      expect(Number.isFinite(pos.getZ(i))).toBe(true)
    }
    wood.dispose()
  })

  it('translates single limbs and trunk freely via BranchEdit.offset with child propagation & clean detached wood', () => {
    const base = presetSpec('broadleaf-driftwood')
    const sk0 = buildSkeleton(base)
    const limb = sk0.branches.find(b => b.role === 'limb')!
    const children0 = sk0.branches.filter(b => b.parentId === limb.id)
    expect(children0.length).toBeGreaterThan(0)

    const skOff = buildSkeleton({
      ...base,
      branchEdits: [{ id: limb.id, offset: [.9, .35, -.45] }],
    })
    const limbOff = skOff.branches.find(b => b.id === limb.id)!
    expect(limbOff.points[0].distanceTo(limb.points[0].clone().add(new Vector3(.9, .35, -.45)))).toBeLessThan(1e-3)

    // Children follow the detached limb rigidly and stay anchored on it
    for (const c0 of children0) {
      const c1 = skOff.branches.find(b => b.id === c0.id)!
      expect(c1.points[0].distanceTo(limbOff.curve.getPoint(c1.socket!))).toBeLessThan(1e-3)
      expect(c1.points[0].distanceTo(c0.points[0].clone().add(new Vector3(.9, .35, -.45)))).toBeLessThan(.02)
    }

    // Detached limb builds clean finite wood on sculpted welded trunk without stretched weld bridges
    const wood = buildWood(skOff.branches, base.trunk, base.seed, { detail: 1 })
    const pos = wood.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true)
      expect(Number.isFinite(pos.getY(i))).toBe(true)
      expect(Number.isFinite(pos.getZ(i))).toBe(true)
    }
    wood.dispose()

    // Trunk free root offset carries trunk and all primary limbs together
    const skTrunkOff = buildSkeleton({
      ...base,
      branchEdits: [{ id: 0, offset: [.6, .2, -.3] }],
    })
    expect(skTrunkOff.trunk.points[0].distanceTo(new Vector3(.6, .2, -.3))).toBeLessThan(1e-4)
    const limbTrunkOff = skTrunkOff.branches.find(b => b.id === limb.id)!
    expect(limbTrunkOff.points[0].distanceTo(skTrunkOff.trunk.curve.getPoint(limbTrunkOff.socket!))).toBeLessThan(1e-3)
  })

  it('applies global branch placement (startHeight/heightSpan/azimuthOffset/childStart) and X/Y/Z assembly offset', () => {
    const base = presetSpec('broadleaf-round')
    const sk0 = buildSkeleton(base)
    const limbs0 = sk0.branches.filter(b => b.role === 'limb')

    // 1. Lower startHeight + tighter heightSpan moves primary limbs down along trunk
    const skLow = buildSkeleton({
      ...base,
      branches: { ...base.branches, startHeight: .20, heightSpan: .32 },
    })
    const limbsLow = skLow.branches.filter(b => b.role === 'limb')
    expect(Math.min(...limbsLow.map(b => b.socket!))).toBeLessThan(.35)
    expect(Math.max(...limbsLow.map(b => b.socket!))).toBeCloseTo(.52, 2)

    // 2. azimuthOffset rotates primary limbs around trunk horizontally
    const skRot = buildSkeleton({
      ...base,
      branches: { ...base.branches, azimuthOffset: 90 },
    })
    const tip0 = limbs0[0].points.at(-1)!
    const tipRot = skRot.branches.find(b => b.id === limbs0[0].id)!.points.at(-1)!
    expect(Math.hypot(tipRot.x - tip0.x, tipRot.z - tip0.z)).toBeGreaterThan(1.0)

    // 3. childStart pushes secondary branches outward along parent limbs (broadleaf & conifer)
    const skChildOut = buildSkeleton({
      ...base,
      branches: { ...base.branches, childStart: .62 },
    })
    const childSocks = skChildOut.branches.filter(b => b.role === 'child').map(b => b.socket!)
    expect(Math.min(...childSocks)).toBeGreaterThanOrEqual(.60)

    const con = presetSpec('conifer-standard')
    const conChildOut = buildSkeleton({
      ...con,
      branches: { ...con.branches, childCount: 3, childStart: .55, azimuthOffset: 45 },
    })
    const conChildSocks = conChildOut.branches.filter(b => b.role === 'child').map(b => b.socket!)
    expect(conChildSocks.length).toBeGreaterThan(0)
    expect(Math.min(...conChildSocks)).toBeGreaterThanOrEqual(.53)

    // 4. Global offsetX/Y/Z shifts all non-trunk branches + envelope + full tree assembly cleanly
    const shiftedSpec = {
      ...base,
      branches: { ...base.branches, offsetX: 1.2, offsetY: .5, offsetZ: -.6 },
    }
    const skShift = buildSkeleton(shiftedSpec)
    // Trunk stays rooted at origin while limbs and envelope shift
    expect(skShift.trunk.points[0].length()).toBeLessThan(1e-6)
    expect(skShift.branches[1].points[0].distanceTo(
      sk0.branches[1].points[0].clone().add(new Vector3(1.2, .5, -.6)),
    )).toBeLessThan(1e-4)
    expect(skShift.envelope.axis.x - sk0.envelope.axis.x).toBeGreaterThan(.8)

    const built = buildTree(shiftedSpec, dummyTextures)
    expect(built.stats.leaves).toBeGreaterThan(50)
    expect(built.stats.triangles).toBeGreaterThan(200)
    built.dispose()
  })

  it('keeps backward compatibility in parseTreeSpec for legacy branches and round-trips socketDelta & offset', () => {
    const legacyBroad = JSON.parse(JSON.stringify(presetSpec('broadleaf-round')))
    delete legacyBroad.branches.startHeight
    delete legacyBroad.branches.heightSpan
    delete legacyBroad.branches.azimuthOffset
    delete legacyBroad.branches.childStart
    delete legacyBroad.branches.offsetX
    delete legacyBroad.branches.offsetY
    delete legacyBroad.branches.offsetZ
    const parsedBroad = parseTreeSpec(legacyBroad)
    expect(parsedBroad.branches.startHeight).toBeCloseTo(.58, 5)
    expect(parsedBroad.branches.heightSpan).toBeCloseTo(.38, 5)
    expect(parsedBroad.branches.azimuthOffset).toBe(0)
    expect(parsedBroad.branches.childStart).toBeCloseTo(.26, 5)
    expect(parsedBroad.branches.offsetX).toBe(0)

    const legacyCon = JSON.parse(JSON.stringify(presetSpec('conifer-standard')))
    delete legacyCon.branches.childStart
    const parsedCon = parseTreeSpec(legacyCon)
    expect(parsedCon.branches.childStart).toBeCloseTo(.06, 5)

    const withEdits = parseTreeSpec({
      ...presetSpec('broadleaf-open'),
      branchEdits: [
        { id: 0, socketDelta: .4, offset: [5.5, -1.2, .3] },
        { id: 2, socketDelta: -1.5, offset: [.4, -.5, .25] },
      ],
    })
    expect(withEdits.branchEdits).toHaveLength(2)
    // Trunk ignores socketDelta but keeps clamped offset
    expect(withEdits.branchEdits![0].socketDelta).toBeUndefined()
    expect(withEdits.branchEdits![0].offset).toEqual([4, -1.2, .3])
    // Limb clamps socketDelta to -0.95 and preserves offset
    expect(withEdits.branchEdits![1].socketDelta).toBe(-.95)
    expect(withEdits.branchEdits![1].offset).toEqual([.4, -.5, .25])
  })

  it('prevents outer-cap craters on protruding sculpted limbs (broadleaf-wishing regression)', () => {
    const base = presetSpec('broadleaf-wishing')
    const sculpted = {
      ...base,
      branches: { ...base.branches, childCount: 0 },
      branchEdits: [
        { id: 2, lengthScale: 1.76, socketDelta: -.206, spineOffsets: [[.09, -.22, .09], [0, 0, 0], [0, 0, 0], [0, 0, 0]] as [number, number, number][] },
      ],
    }
    const built = buildTree(sculpted, dummyTextures)
    // Find the protruding limb #2 tip cluster and verify outer front cap has dense leaf cards (no hollow crater!)
    const limb2 = built.skeleton.branches.find(b => b.id === 2)!
    const tip = limb2.curve.getPoint(.84)
    let leafMesh: Mesh | undefined
    built.group.traverse(o => { if (o instanceof Mesh && o.name === 'Leaf cards') leafMesh = o })
    expect(leafMesh).toBeDefined()
    const cen = leafMesh!.geometry.getAttribute('leafCenter')
    let outerCapHits = 0
    const outDir = new Vector3(tip.x, 0, tip.z).normalize()
    for (let i = 0; i < cen.count; i += 4) {
      const dx = cen.getX(i) - tip.x
      const dy = cen.getY(i) - tip.y
      const dz = cen.getZ(i) - tip.z
      const dist = Math.hypot(dx, dy, dz)
      if (dist < 2.8 && (dx * outDir.x + dz * outDir.z) > 0.65) outerCapHits++
    }
    expect(outerCapHits).toBeGreaterThan(25)
    built.dispose()
  })
})

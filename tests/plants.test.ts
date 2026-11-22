import { describe, expect, it } from 'vitest'
import { LineCurve3, Texture, Vector3 } from 'three'
import { buildTree } from '../src/tree/assemble'
import { buildFronds } from '../src/tree/fronds'
import { buildSkeleton, drapeDown, drapeTilt } from '../src/tree/skeleton'
import { presetSpec, presetIds, type TreeSpec } from '../src/tree/spec'
import { cardTypes, generateLeafCards } from '../src/broadleaf/leaves'

const textures = { leaf: new Texture(), needle: new Texture(), drape: new Texture(), palm: new Texture(), grass: new Texture(), fern: new Texture() }
const leafMesh = (spec: TreeSpec) => {
  const asset = buildTree(spec, textures)
  const mesh = asset.group.children.find(m => m.name === 'Leaf cards') as unknown as { geometry: import('three').BufferGeometry }
  return { asset, geometry: mesh.geometry }
}

describe('leaf insertion types', () => {
  it('multiplies planes per card for cross / tri / fan and keeps unit normals', () => {
    const base = presetSpec('broadleaf-round')
    const quad = leafMesh(base)
    const verts = (t: typeof cardTypes[number], extra = {}) => leafMesh({ ...base, leaves: { ...base.leaves, cardType: t, ...extra } }).geometry.getAttribute('position').count
    const q = quad.geometry.getAttribute('position').count
    expect(verts('cross')).toBe(q * 2)
    expect(verts('tri')).toBe(q * 3)
    expect(verts('fan', { fanCount: 4 })).toBe(q * 4)
    const n = leafMesh({ ...base, leaves: { ...base.leaves, cardType: 'tri' } }).geometry.getAttribute('normal').array
    for (let i = 0; i < n.length; i += 30) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3)
  })

  it('strip mode sweeps one ribbon per twig instead of twig cards', () => {
    const base = presetSpec('broadleaf-round')
    const { asset } = leafMesh({ ...base, leaves: { ...base.leaves, cardType: 'strip', clumpFill: 0, limbLeafFrequency: 0 } })
    expect(asset.stats.leaves).toBeGreaterThan(asset.stats.twigs * .6)
    expect(asset.stats.leaves).toBeLessThanOrEqual(asset.stats.twigs + 50)
  })

  it('hangs one descending, ground-cleared spray per willow anchor with unit normals', () => {
    const spec = presetSpec('broadleaf-willow')
    expect(spec.leaves.cardType).toBe('drape')
    const { asset, geometry } = leafMesh(spec)
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const nor = geometry.getAttribute('normal')
    expect(asset.stats.leaves).toBeGreaterThan(150)
    expect(asset.stats.leaves).toBeLessThan(300)
    expect(pos.count).toBe(asset.stats.leaves * 10)

    for (let i = 0; i < pos.count; i += 10) {
      expect(uv.getY(i)).toBeCloseTo(1, 3)
      expect(uv.getY(i + 8)).toBeCloseTo(0, 3)
      expect(pos.getY(i + 8)).toBeGreaterThanOrEqual(.179)
      for (let row = 1; row <= 4; row++) {
        expect(pos.getY(i + row * 2)).toBeLessThan(pos.getY(i + row * 2 - 2))
      }
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 3)
    }
    asset.dispose()
  })

  it('anchors willow sprays to the branch rather than the crown envelope and keeps LOD anchor positions', () => {
    const spec = presetSpec('broadleaf-willow')
    const start = new Vector3(0, 2, 0)
    const end = new Vector3(3, 2, 0)
    const curve = new LineCurve3(start, end)
    const growth = {
      limbs: [{ id: 1, kind: 'primary' as const, curve, rootRadius: .12, tipRadius: .03 }],
      clusters: [{ center: new Vector3(4, 6, 1), direction: new Vector3(1, 0, 0), width: 3, height: 3, depth: 3 }],
      config: { seed: spec.seed },
    }
    const leaves = { ...spec.leaves, twigFrequency: 0, clumpFill: 8 }
    const high = generateLeafCards(growth, leaves, { radius: () => 1 })
    const low = generateLeafCards(growth, leaves, { radius: () => 1, reduce: .6, flat: true })
    const pos = high.geometry.getAttribute('position')
    expect(high.cards.length).toBeGreaterThan(2)
    for (let i = 0; i < pos.count; i += 10) {
      expect(pos.getY(i)).toBeCloseTo(2, 6)
      expect((pos.getZ(i) + pos.getZ(i + 1)) / 2).toBeCloseTo(0, 6)
      const x = (pos.getX(i) + pos.getX(i + 1)) / 2
      expect(x).toBeGreaterThanOrEqual(start.x)
      expect(x).toBeLessThanOrEqual(end.x + 1e-6)
    }
    expect(low.cards.length).toBeLessThan(high.cards.length)
    expect(low.cards.every(card => high.cards.some(source => source.position.equals(card.position)))).toBe(true)
    high.geometry.dispose()
    low.geometry.dispose()
  })
})

describe('conifer drape', () => {
  it('hangs each curtain below its branch and points sub-branches down inside it', () => {
    const base = presetSpec('conifer-standard')
    const spec = { ...base, fronds: { ...base.fronds, mode: 'drape' as const }, branches: { ...base.branches, childCount: 9 } }
    const sk = buildSkeleton(spec)
    const children = sk.branches.filter(b => b.role === 'child')
    const downward = children.filter(b => b.points.at(-1)!.y < b.points[0].y - .02).length
    expect(downward / children.length).toBeGreaterThan(.9)
    // twig directions lie (mostly) in the curtain plane of the parent
    for (const c of children.slice(0, 80)) {
      const parent = sk.branches[c.parentId!]
      const T = parent.curve.getTangent(c.socket!).normalize()
      const plane = new Vector3().crossVectors(T, drapeDown(T, drapeTilt(spec, parent.id))).normalize()
      const dir = c.points.at(-1)!.clone().sub(c.points[0]).normalize()
      expect(Math.abs(dir.dot(plane))).toBeLessThan(.45)
    }
    const { geometry, fronds } = buildFronds(sk, spec)
    const limbs = sk.branches.filter(b => b.role === 'limb')
    expect(fronds).toBeGreaterThanOrEqual(limbs.length)
    // the uv v=0 row (needle tips) is below the v=1 row (branch) for every curtain row
    const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    let checked = 0
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if (uv.getY(i) !== 1 || uv.getY(i + 2) !== 0) continue
      expect(pos.getY(i + 2)).toBeLessThan(pos.getY(i) + 1e-6)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('tent mode still works', () => {
    const spec = presetSpec('conifer-standard')
    const tent = { ...spec, fronds: { ...spec.fronds, mode: 'tent' as const } }
    expect(buildFronds(buildSkeleton(tent), tent).fronds).toBeGreaterThan(50)
  })
})

describe('conifer single folded plane per branch (default)', () => {
  it.each(['conifer-standard', 'conifer-dense', 'conifer-tall', 'conifer-shrub'] as const)('%s: one low-poly folded kite plane per branch, hanging downward & outward', id => {
    const spec = presetSpec(id)
    expect(spec.fronds.mode).toBe('leaf')
    const sk = buildSkeleton(spec)
    const limbs = sk.branches.filter(b => b.role === 'limb')
    expect(sk.branches.filter(b => b.role === 'child')).toHaveLength(0)
    const { geometry, fronds } = buildFronds(sk, spec)
    const tuft = spec.fronds.tuft > 0 ? 11 : 0
    expect(fronds).toBe(limbs.length + tuft)
    // branches drape outward and downward from the trunk
    const axis = sk.envelope.axis
    let outwardDown = 0
    for (const b of limbs) {
      const a = b.points[0], z = b.points.at(-1)!
      const r0 = Math.hypot(a.x - axis.x, a.z - axis.z), r1 = Math.hypot(z.x - axis.x, z.z - axis.z)
      if (z.y < a.y && r1 > r0 + .05) outwardDown++
    }
    expect(outwardDown / limbs.length).toBeGreaterThan(.95)
    // 3-column kite mesh: stem (v=1) & tip (v=0) narrow to a point; UVs stay in [0,1]
    const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (const value of uv.array) expect(value).toBeGreaterThanOrEqual(0), expect(value).toBeLessThanOrEqual(1)
    let tips = 0
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if (uv.getY(i) !== 0) continue
      tips++
      const span = new Vector3().fromBufferAttribute(pos, i).distanceTo(new Vector3().fromBufferAttribute(pos, i + 2))
      expect(span).toBeLessThan(.15)
    }
    expect(tips).toBeGreaterThanOrEqual(limbs.length)
  })

  it('denser at the bottom and sparser toward the top (上疏下密)', () => {
    const spec = presetSpec('conifer-standard')
    const sk = buildSkeleton(spec)
    const limbs = sk.branches.filter(b => b.role === 'limb')
    const midY = (sk.envelope.y0 + sk.envelope.y1) * .55
    const low = limbs.filter(b => b.points[0].y < midY).length
    const high = limbs.filter(b => b.points[0].y >= midY).length
    expect(low).toBeGreaterThan(high)
  })

  it('first card starts at the branch root (v=1) and extends past the branch tip', () => {
    const spec = presetSpec('conifer-standard')
    const sk = buildSkeleton(spec)
    const limb = sk.branches.find(b => b.role === 'limb')!
    const { geometry } = buildFronds(sk, spec)
    const pos = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    // 3 columns: index 1 is the center ridge of row 0
    expect(uv.getY(1)).toBeCloseTo(1, 5)
    expect(new Vector3().fromBufferAttribute(pos, 1).distanceTo(limb.curve.getPoint(spec.fronds.start))).toBeLessThan(.05)
    const rows = Math.max(4, Math.round(spec.fronds.segments) + 1)
    const tipIdx = (rows - 1) * 3 + 1
    expect(uv.getY(tipIdx)).toBeCloseTo(0, 5)
    const root = limb.points[0]
    expect(new Vector3().fromBufferAttribute(pos, tipIdx).distanceTo(root)).toBeGreaterThan(limb.points.at(-1)!.distanceTo(root))
  })
})
describe('low plants', () => {
  it.each(['grass-clump', 'grass-narrow', 'grass-dense', 'grass-tall', 'fern'] as const)('%s builds blades with no wood and respects bare zones', id => {
    const spec = presetSpec(id)
    const asset = buildTree(spec, textures)
    expect(asset.group.children.some(m => m.name === 'Trunk and branches')).toBe(false)
    expect(asset.stats.leaves).toBeGreaterThan(spec.ground.count * .9)
    const mesh = asset.group.children[0] as unknown as { geometry: import('three').BufferGeometry; material: import('three').MeshStandardMaterial }
    mesh.geometry.computeBoundingBox()
    expect(mesh.geometry.boundingBox!.min.y).toBeGreaterThan(-.05)
    expect(mesh.geometry.boundingBox!.max.y).toBeLessThan(spec.ground.length * 1.6)
    const nor = mesh.geometry.getAttribute('normal')
    for (let i = 0; i < nor.count; i += Math.max(1, Math.floor(nor.count / 60))) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 3)
    }
    if (spec.kind === 'grass' && spec.ground.mode === 'blade') {
      // Modeled 3D grass blades require no alpha texture and taper cleanly to pointed tips
      expect(mesh.material.map).toBeNull()
      expect(mesh.material.alphaTest).toBe(0)
    }
    const bare = { ...spec, handles: [{ id: 1, kind: 'bare' as const, anchor: [0, spec.ground.length * .5, 0] as [number, number, number], offset: [0, 0, 0] as [number, number, number], radius: spec.ground.length * 3 }] }
    expect(buildTree(bare, textures).stats.leaves).toBeLessThan(asset.stats.leaves * .3)
    asset.dispose()
  })

  it('grass mode switches cleanly between modeled 3D blades and legacy textured cards', () => {
    const base = presetSpec('grass-clump')
    const bladeAsset = buildTree(base, textures)
    const cardSpec = { ...base, ground: { ...base.ground, mode: 'card' as const, count: 24, segments: 4 } }
    const cardAsset = buildTree(cardSpec, textures)
    const bladeMat = (bladeAsset.group.children[0] as unknown as { material: import('three').MeshStandardMaterial }).material
    const cardMat = (cardAsset.group.children[0] as unknown as { material: import('three').MeshStandardMaterial }).material
    expect(bladeMat.map).toBeNull()
    expect(cardMat.map).toBe(textures.grass)
    expect(cardAsset.stats.leaves).toBe(24)
    bladeAsset.dispose()
    cardAsset.dispose()
  })

  it.each(['shrub-round', 'shrub-spread', 'conifer-shrub'] as const)('%s stays low and dense', id => {
    const asset = buildTree(presetSpec(id), textures)
    const pts = asset.skeleton.branches.flatMap(b => b.points)
    expect(Math.max(...pts.map(p => p.y))).toBeLessThan(2.6)
    expect(asset.stats.leaves).toBeGreaterThan(id === 'conifer-shrub' ? 40 : 150)
  })

  it('every preset assembles', () => {
    for (const id of presetIds) {
      const a = buildTree(presetSpec(id), textures)
      expect(a.stats.triangles).toBeGreaterThan(id.startsWith('flowerbed') ? 50 : 200)
      a.dispose()
    }
  })
})

describe('palm trees', () => {
  it.each(['palm-tropical', 'palm-stout', 'palm-curved'] as const)('%s builds ringed trunk + arching fronds with valid geometry and LOD', id => {
    const spec = presetSpec(id)
    const high = buildTree(spec, textures)
    expect(high.stats.leaves).toBe(spec.palm.frondCount)
    expect(high.stats.triangles).toBeGreaterThan(1000)
    const frondsMesh = high.group.children.find(m => m.name === 'Palm fronds') as unknown as { geometry: import('three').BufferGeometry }
    expect(frondsMesh).toBeTruthy()
    const n = frondsMesh.geometry.getAttribute('normal').array
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3)
    for (const v of frondsMesh.geometry.getAttribute('uv').array) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1)
    // bare zone removes fronds
    const tip = high.skeleton.trunk.curve.getPoint(1)
    const bare = buildTree({ ...spec, handles: [{ id: 1, kind: 'bare', anchor: [tip.x, tip.y, tip.z], offset: [0, 0, 0], radius: spec.palm.frondLength * 2 }] }, textures)
    expect(bare.stats.leaves).toBeLessThan(high.stats.leaves * .2)
    high.dispose(); bare.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { buildTree } from '../src/tree/assemble'
import { CrownEnvelope, defaultHandles } from '../src/tree/envelope'
import { buildFronds } from '../src/tree/fronds'
import { buildSkeleton } from '../src/tree/skeleton'
import { parseTreeSpec, presetIds, presetSpec, type TreeSpec } from '../src/tree/spec'

const textures = { leaf: new Texture(), needle: new Texture(), drape: new Texture(), palm: new Texture(), bamboo: new Texture(), lotusLeaf: new Texture(), lotusPetal: new Texture(), grass: new Texture(), fern: new Texture() }
const withHandles = (spec: TreeSpec, edit: (h: TreeSpec['handles']) => void) => {
  const env = new CrownEnvelope(spec, buildSkeleton(spec).envelope.axis)
  const handles = defaultHandles(env)
  edit(handles)
  return { ...spec, handles }
}

describe('tree v2 skeleton', () => {
  it.each(presetIds)('%s is deterministic and every branch root sits on its parent', id => {
    const spec = presetSpec(id)
    const a = buildSkeleton(spec), b = buildSkeleton(spec)
    expect(a.branches.map(x => x.points[1].toArray())).toEqual(b.branches.map(x => x.points[1].toArray()))
    for (const branch of a.branches.slice(1)) {
      const parent = a.branches[branch.parentId!]
      const gap = parent.curve.getPoint(branch.socket!).distanceTo(branch.points[0])
      expect(gap).toBeLessThan(Math.max(.06, parent.length * .02))
      for (const p of branch.points) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true)
    }
  })

  it('keeps roots attached when the crown is deformed by handles', () => {
    for (const id of ['broadleaf-round', 'conifer-standard'] as const) {
      const spec = withHandles(presetSpec(id), h => { h[2].offset = [-2, -.6, 0]; h[0].offset = [0, -1.2, 0] })
      const sk = buildSkeleton(spec)
      for (const branch of sk.branches.slice(1)) {
        const parent = sk.branches[branch.parentId!]
        expect(parent.curve.getPoint(branch.socket!).distanceTo(branch.points[0])).toBeLessThan(Math.max(.08, parent.length * .03))
      }
      expect(sk.trunk.points[0].length()).toBeLessThan(1e-9)
    }
  })

  it('conifer whorls get shorter toward the top and stay under the apex', () => {
    const sk = buildSkeleton(presetSpec('conifer-standard'))
    const limbs = sk.branches.filter(b => b.role === 'limb')
    expect(limbs.length).toBeGreaterThan(40)
    const low = limbs.filter(b => b.points[0].y < sk.envelope.y0 + sk.envelope.height * .3)
    const high = limbs.filter(b => b.points[0].y > sk.envelope.y0 + sk.envelope.height * .7)
    const mean = (list: typeof limbs) => list.reduce((s, b) => s + b.length, 0) / list.length
    expect(mean(low)).toBeGreaterThan(mean(high) * 2)
    for (const b of limbs) expect(b.points.at(-1)!.y).toBeLessThan(sk.envelope.y1 + .3)
    expect(sk.branches.filter(b => b.role === 'dead').length).toBeGreaterThan(0)
  })
})

describe('crown envelope editing', () => {
  it('maps surface points to rho 1 and inverts the deformation', () => {
    for (const id of ['broadleaf-round', 'conifer-standard'] as const) {
      const spec = withHandles(presetSpec(id), h => { h[1].offset = [1.2, .3, 0] })
      const env = new CrownEnvelope(spec)
      for (const [u, th] of [[.3, .4], [.5, 2], [.7, 4]]) expect(env.rhoBase(env.surface(u, th))).toBeCloseTo(1, 5)
      const p = env.surface(.45, .1)
      const moved = env.deform(p)
      expect(moved.distanceTo(p)).toBeGreaterThan(.3)
      expect(env.undeform(moved).distanceTo(p)).toBeLessThan(.08)
      expect(env.rho(moved)).toBeCloseTo(1, 1)
    }
  })

  it('pulling the left handle widens the left side; pushing the top flattens', () => {
    const base = presetSpec('broadleaf-round')
    const extent = (spec: TreeSpec) => {
      const sk = buildSkeleton(spec)
      const pts = sk.branches.flatMap(b => b.points)
      return { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)) }
    }
    const before = extent(base)
    // handle index 3 sits at theta = PI (left / -x)
    const wide = extent(withHandles(base, h => { h[3].offset = [-1.8, 0, 0] }))
    expect(wide.minX).toBeLessThan(before.minX - .8)
    expect(Math.abs(wide.maxX - before.maxX)).toBeLessThan(.3)
    const flat = extent(withHandles(base, h => { h[0].offset = [0, -1.5, 0] }))
    expect(flat.maxY).toBeLessThan(before.maxY - .5)
  })

  it('bare zones remove foliage inside them', () => {
    const base = presetSpec('broadleaf-round')
    const full = buildTree(base, textures)
    const env = full.skeleton.envelope
    const center = env.surface(.5, 0)
    const bare = { ...base, handles: [{ id: 1, kind: 'bare' as const, anchor: [center.x, center.y, center.z] as [number, number, number], offset: [0, 0, 0] as [number, number, number], radius: 1.6 }] }
    const cut = buildTree(bare, textures)
    const inside = (asset: typeof full) => {
      const pos = asset.group.children.find(m => m.name === 'Leaf cards') as unknown as { geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } }
      const attr = pos.geometry.getAttribute('leafCenter')
      let n = 0
      for (let i = 0; i < attr.count; i++) if (new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)).distanceTo(center) < 1.0) n++
      return n
    }
    expect(inside(full)).toBeGreaterThan(50)
    expect(inside(cut)).toBeLessThan(inside(full) * .15)
    expect(cut.stats.leaves).toBeLessThan(full.stats.leaves)
  })
})

describe('foliage builders', () => {
  it.each(['conifer-standard', 'conifer-dense', 'conifer-tall'] as const)('%s fronds have valid geometry', id => {
    const spec = presetSpec(id)
    const { geometry, fronds } = buildFronds(buildSkeleton(spec), spec)
    expect(fronds).toBeGreaterThan(50)
    const n = geometry.getAttribute('normal').array
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3)
    for (const v of geometry.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true)
  })

  it.each(presetIds)('%s assembles with sane budgets', id => {
    const asset = buildTree(presetSpec(id), textures)
    expect(asset.stats.triangles).toBeGreaterThan(id.startsWith('flowerbed') ? 50 : id.startsWith('grass') || id === 'fern' ? 200 : id.startsWith('palm') || id.startsWith('bamboo') || id.startsWith('lotus') ? 900 : 5000)
    expect(asset.stats.triangles).toBeLessThan(150000)
    asset.dispose()
  })

  it('round-trips specs through JSON validation', () => {
    const spec = withHandles(presetSpec('conifer-tall'), h => { h[0].offset = [0, -1, 0] })
    const back = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
    expect(back).toEqual(spec)
    expect(() => parseTreeSpec({ schemaVersion: 1 })).toThrow()
  })
})

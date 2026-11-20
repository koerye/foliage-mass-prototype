import { describe, expect, it } from 'vitest'
import { Box3, Texture, Vector3 } from 'three'
import { buildTree } from '../src/tree/assemble'
import { buildFlowers, sitesFromLeafCards } from '../src/tree/flowers'
import { generateLeafCards } from '../src/broadleaf/leaves'
import { optimizeAt } from '../src/tree/optimize'
import { defaultOptimize, parseTreeSpec, presetSpec } from '../src/tree/spec'

const textures = {
  leaf: new Texture(), needle: new Texture(), drape: new Texture(),
  palm: new Texture(), grass: new Texture(), fern: new Texture(), flower: new Texture(), blossom: new Texture(),
}

describe('outer-surface flower decoration', () => {
  it('places flowers strictly on the outermost layer of the canopy', () => {
    const spec = presetSpec('shrub-flower')
    expect(spec.flowers.enabled).toBe(true)
    const asset = buildTree(spec, textures)
    expect(asset.stats.flowers).toBeGreaterThan(30)
    const env = asset.skeleton.envelope
    const carriers = asset.skeleton.branches.filter(b => b.role !== 'dead')
    const leaves = generateLeafCards({ limbs: carriers, clusters: asset.skeleton.clusters, config: { seed: spec.seed } }, spec.leaves, {
      radius: p => env.rho(p),
    })
    const sites = sitesFromLeafCards(leaves.cards, env)
    const meanLeafRho = sites.reduce((s, x) => s + x.rho, 0) / sites.length
    const fl = buildFlowers(sites, env, spec.flowers, defaultOptimize, spec.seed)
    const meanFlowerRho = fl.placed.reduce((s, x) => s + env.rho(x.position), 0) / fl.placed.length
    // flowers sit strictly further out than the average leaf layer, and every
    // flower quad faces strictly outward along the crown envelope normal
    expect(meanFlowerRho).toBeGreaterThan(meanLeafRho + .18)
    const pos = fl.geometry.getAttribute('position')
    for (let i = 0; i < fl.placed.length; i++) {
      const f = fl.placed[i]
      expect(env.rho(f.position)).toBeGreaterThan(meanLeafRho)
      const a = new Vector3().fromBufferAttribute(pos, i * 4)
      const b = new Vector3().fromBufferAttribute(pos, i * 4 + 1)
      const c = new Vector3().fromBufferAttribute(pos, i * 4 + 2)
      const planeNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
      expect(planeNormal.dot(env.normal(f.position))).toBeGreaterThan(.97)
    }
    fl.geometry.dispose()
    leaves.geometry.dispose()
    asset.dispose()
  })

  it('scales flower size proportionally with the host leaf size', () => {
    const base = presetSpec('broadleaf-round')
    const smallSpec = { ...base, leaves: { ...base.leaves, leafSize: .4 }, flowers: { ...base.flowers, enabled: true, sizeVariance: 0, count: 40 } }
    const bigSpec = { ...base, leaves: { ...base.leaves, leafSize: 1.0 }, flowers: { ...base.flowers, enabled: true, sizeVariance: 0, count: 40 } }
    const meanSize = (s: typeof base) => {
      const a = buildTree(s, textures)
      const env = a.skeleton.envelope
      const carriers = a.skeleton.branches.filter(b => b.role !== 'dead')
      const leaves = generateLeafCards({ limbs: carriers, clusters: a.skeleton.clusters, config: { seed: s.seed } }, s.leaves, { radius: p => env.rho(p) })
      const fl = buildFlowers(sitesFromLeafCards(leaves.cards, env), env, s.flowers, defaultOptimize, s.seed)
      const avg = fl.placed.reduce((acc, f) => acc + f.size, 0) / fl.placed.length
      fl.geometry.dispose(); leaves.geometry.dispose(); a.dispose()
      return avg
    }
    const ratio = meanSize(bigSpec) / meanSize(smallSpec)
    expect(ratio).toBeGreaterThan(2.2)
    expect(ratio).toBeLessThan(2.8)
  })

  it('works across all plant kinds, respects bare zones and LOD, and round-trips JSON', () => {
    for (const id of ['broadleaf-round', 'shrub-spread', 'conifer-standard', 'palm-tropical', 'grass-clump', 'fern'] as const) {
      const base = presetSpec(id)
      const withFlowers = { ...base, flowers: { ...base.flowers, enabled: true, count: 30 } }
      const a = buildTree(withFlowers, textures)
      expect(a.stats.flowers).toBeGreaterThan(5)
      const mesh = a.group.children.find(m => m.name === 'Flower cards') as unknown as { geometry: import('three').BufferGeometry }
      expect(mesh).toBeTruthy()
      const n = mesh.geometry.getAttribute('normal').array
      for (let i = 0; i < n.length; i += 30) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3)
      a.dispose()
    }
    // bare zone wipes flowers inside it
    const sf = presetSpec('shrub-flower')
    const full = buildTree(sf, textures)
    const bare = buildTree({ ...sf, handles: [{ id: 1, kind: 'bare', anchor: [0, .8, 0], offset: [0, 0, 0], radius: 4 }] }, textures)
    expect(bare.stats.flowers).toBe(0)
    // LOD reduces flower count
    const lod = buildTree({ ...sf, optimize: optimizeAt(.85) }, textures)
    expect(lod.stats.flowers).toBeLessThan(full.stats.flowers)
    // JSON round-trip preserves flower settings
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(sf)))
    expect(parsed.flowers).toEqual(sf.flowers)
    full.dispose(); bare.dispose(); lod.dispose()
  })
})

describe('standalone flowerbed template (stemmed & pure)', () => {
  it('flowerbed-stemmed builds curved green stems+leaves and blossom heads sitting on y >= 0', () => {
    const spec = presetSpec('flowerbed-stemmed')
    expect(spec.kind).toBe('flowerbed')
    expect(spec.flowerbed.withStems).toBe(true)
    const asset = buildTree(spec, textures)
    const stems = asset.group.children.find(m => m.name === 'Flower stems and leaves') as unknown as { geometry: import('three').BufferGeometry } | undefined
    const blossoms = asset.group.children.find(m => m.name === 'Flower blossoms') as unknown as { geometry: import('three').BufferGeometry } | undefined
    expect(stems).toBeTruthy()
    expect(blossoms).toBeTruthy()
    expect(asset.group.children).toHaveLength(2)
    expect(asset.stats.branches).toBeGreaterThan(20)
    expect(asset.stats.flowers).toBe(asset.stats.branches)
    // grounded stems & valid unit normals / UVs
    const stemBox = new Box3().setFromObject(asset.group.children.find(m => m.name === 'Flower stems and leaves')!)
    expect(stemBox.min.y).toBeGreaterThanOrEqual(-1e-5)
    for (const geo of [stems!.geometry, blossoms!.geometry]) {
      const n = geo.getAttribute('normal').array
      for (let i = 0; i < n.length; i += 9) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3)
      for (const v of geo.getAttribute('position').array) expect(Number.isFinite(v)).toBe(true)
    }
    for (const v of blossoms!.geometry.getAttribute('uv').array) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    asset.dispose()
  })

  it('flowerbed-pure builds blossoms only with zero stems (single draw call)', () => {
    const spec = presetSpec('flowerbed-pure')
    expect(spec.kind).toBe('flowerbed')
    expect(spec.flowerbed.withStems).toBe(false)
    const asset = buildTree(spec, textures)
    expect(asset.group.children).toHaveLength(1)
    expect(asset.group.children[0].name).toBe('Flower blossoms')
    expect(asset.stats.branches).toBe(0)
    expect(asset.stats.flowers).toBeGreaterThan(20)
    expect(asset.stats.triangles).toBe(asset.stats.flowers * 2) // 1 quad = 2 tris per blossom
    const box = new Box3().setFromObject(asset.group)
    expect(box.min.y).toBeGreaterThan(0)
    asset.dispose()
  })

  it('toggling withStems, bare zones, LOD, and JSON round-trip all work', () => {
    const base = presetSpec('flowerbed-stemmed')
    const pure = buildTree({ ...base, flowerbed: { ...base.flowerbed, withStems: false } }, textures)
    expect(pure.group.children).toHaveLength(1)
    expect(pure.stats.branches).toBe(0)
    // bare zone removes blossoms inside it
    const full = buildTree(base, textures)
    const bare = buildTree({ ...base, handles: [{ id: 1, kind: 'bare', anchor: [0, .35, 0], offset: [0, 0, 0], radius: 2 }] }, textures)
    expect(bare.stats.flowers).toBe(0)
    // LOD reduces triangles
    const lod = buildTree({ ...base, optimize: optimizeAt(.85) }, textures)
    expect(lod.stats.triangles).toBeLessThan(full.stats.triangles * .55)
    // JSON round-trip
    const parsed = parseTreeSpec(JSON.parse(JSON.stringify(base)))
    expect(parsed.flowerbed).toEqual(base.flowerbed)
    pure.dispose(); full.dispose(); bare.dispose(); lod.dispose()
  })
})

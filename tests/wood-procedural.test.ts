import { describe, expect, it } from 'vitest'
import { Box3, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'
import { prepareGlbScene } from '../src/export-glb'
import { buildAiScene } from '../src/ai/scene'
import { twistedSakuraShowcase } from '../src/ai/showcase'
import { createTextureRegistry } from '../src/studio/texture-slots'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { buildSkeleton, radiusAt } from '../src/tree/skeleton'
import { presetSpec, type PresetId } from '../src/tree/spec'
import { buildWood } from '../src/tree/wood'

function dummyTextures(bark?: Texture): TreeTextures {
  const mk = (name: string) => { const t = new Texture(); t.name = name; return t }
  return {
    ...(bark ? { bark } : {}),
    leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'), palm: mk('palm'),
    grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'),
    sakura: mk('sakura'), cloud: mk('cloud'), maple: mk('maple'), willow: mk('willow'),
  }
}

describe('Improved trunk/branch geometry & 3D procedural materials (no UV tiling)', () => {
  it('strictly bounds child branch radii inside parent trunk & builds smooth dome + valid unit normals', () => {
    const specs = [
      ...(['broadleaf-round', 'broadleaf-open', 'broadleaf-sakura', 'broadleaf-maple', 'broadleaf-willow', 'conifer-standard'] as PresetId[]).map(id => presetSpec(id)),
      twistedSakuraShowcase().parts[0].spec,
    ]
    const n = new Vector3()
    for (const spec of specs) {
      const sk = buildSkeleton(spec)
      for (const b of sk.branches) {
        if (b.parentId === undefined) continue
        const parent = sk.branches[b.parentId]
        const pR = radiusAt(parent, b.socket ?? 0)
        // Strict containment: no child limb starts thicker than its parent trunk/limb
        expect(b.rootRadius).toBeLessThanOrEqual(pR * .785)
      }

      const geo = buildWood(sk.branches, spec.trunk, spec.seed)
      const pos = geo.getAttribute('position')
      const norm = geo.getAttribute('normal')
      const col = geo.getAttribute('color')
      expect(pos.count).toBeGreaterThan(100)
      expect(geo.getAttribute('uv')).toBeUndefined() // pure 3D procedural: no UV tiling needed
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
        expect(Number.isFinite(col.getX(i))).toBe(true)
        n.fromBufferAttribute(norm, i)
        expect(Math.abs(n.length() - 1)).toBeLessThan(1e-3)
      }
      // Grounding invariant: trunk & roots never dip below y = 0
      expect(geo.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-5)
      // Broadleaf trunk top smoothly extends into an apical dome instead of a flat cutoff
      if (spec.kind === 'broadleaf') {
        const lastTrunkY = sk.trunk.points[sk.trunk.points.length - 1].y
        expect(geo.boundingBox!.max.y).toBeGreaterThan(lastTrunkY)
      }
      geo.dispose()
    }
  })

  it('uses pure GPU 3D procedural bark by default, switches to stochastic triplanar on custom bark import, and live-updates at 0 ms', () => {
    const spec = presetSpec('broadleaf-sakura')
    const defaultTree = buildTree(spec, dummyTextures())
    const wood = defaultTree.group.children.find(c => c.name === 'Trunk and branches') as Mesh
    const mat = wood.material as MeshStandardMaterial
    expect(mat.map).toBeNull() // never uses normal UV map tiling
    expect(wood.geometry.getAttribute('uv')).toBeUndefined()
    const u = mat.userData.barkUniforms as Record<string, { value: unknown }>
    expect(u.uUseBarkMap.value).toBe(0)
    expect(u.uBarkScale.value).toBe(1)
    expect(u.uBarkDetail.value).toBe(.72)
    expect(u.uBarkTint.value).toBe(.45)

    // Live 0 ms uniform updates without rebuilding geometry (scale, detail, tint + 3D world-space upward moss & root AO)
    expect(defaultTree.applyLiveParam('trunk.barkScale', { ...spec, trunk: { ...spec.trunk, barkScale: 2.2 } })).toBe(true)
    expect(u.uBarkScale.value).toBe(2.2)
    expect(defaultTree.applyLiveParam('trunk.barkDetail', { ...spec, trunk: { ...spec.trunk, barkDetail: 1.25 } })).toBe(true)
    expect(u.uBarkDetail.value).toBe(1.25)
    expect(defaultTree.applyLiveParam('trunk.barkTint', { ...spec, trunk: { ...spec.trunk, barkTint: .15 } })).toBe(true)
    expect(u.uBarkTint.value).toBe(.15)
    expect(defaultTree.applyLiveParam('trunk.barkMoss', { ...spec, trunk: { ...spec.trunk, barkMoss: .72 } })).toBe(true)
    expect(u.uBarkMoss.value).toBe(.72)
    expect(defaultTree.applyLiveParam('trunk.barkRootAO', { ...spec, trunk: { ...spec.trunk, barkRootAO: .55 } })).toBe(true)
    expect(u.uBarkRootAO.value).toBe(.55)
    expect(defaultTree.applyLiveParam('trunk.barkMossColor', { ...spec, trunk: { ...spec.trunk, barkMossColor: '#488824' } })).toBe(true)
    expect(mat.customProgramCacheKey()).toBe('procedural-bark-v7')
    defaultTree.dispose()

    // With custom imported bark texture: still NO mat.map UV tiling live; bound via uBarkMap triplanar shader
    const customBark = new Texture()
    customBark.name = 'custom_cherry_bark'
    const mappedTree = buildTree(spec, dummyTextures(customBark))
    const mWood = mappedTree.group.children.find(c => c.name === 'Trunk and branches') as Mesh
    const mMat = mWood.material as MeshStandardMaterial
    expect(mMat.map).toBeNull()
    const mu = mMat.userData.barkUniforms as Record<string, { value: unknown }>
    expect(mu.uUseBarkMap.value).toBe(1)
    expect(mu.uBarkMap.value).toBe(customBark)

    // GLB export strips barkUniforms and synthesizes fallback triplanar UVs + map for external PBR viewers
    const prepared = prepareGlbScene(mappedTree.group)
    const expWood = prepared.children.find(c => c.name === 'Trunk and branches') as Mesh
    const expMat = expWood.material as MeshStandardMaterial
    expect(expMat.userData.barkUniforms).toBeUndefined()
    expect(expMat.userData.barkMap).toBeUndefined()
    expect(expMat.map).toBe(customBark)
    expect(expWood.geometry.getAttribute('uv')).toBeDefined()
    mappedTree.dispose()
  })

  it('uses procedural shaders on flower stems and ambient petals too, and keeps bark slot lazy in TextureRegistry', () => {
    const reg = createTextureRegistry()
    expect(reg.textures.bark).toBeUndefined()
    expect(reg.loadedSlots()).toEqual([])

    const fb = buildTree(presetSpec('flowerbed-stemmed'), dummyTextures())
    const stemMesh = fb.group.children.find(c => c.name === 'Flower stems') as Mesh
    expect((stemMesh.material as MeshStandardMaterial).userData.procUniforms).toBeDefined()
    const expFb = prepareGlbScene(fb.group)
    const expStem = expFb.children.find(c => c.name === 'Flower stems') as Mesh
    expect((expStem.material as MeshStandardMaterial).userData.procUniforms).toBeUndefined()
    fb.dispose()

    const scene = buildAiScene(twistedSakuraShowcase(), dummyTextures())
    const box = new Box3().setFromObject(scene.group)
    expect(box.min.y).toBeGreaterThanOrEqual(-0.02)
    scene.dispose()
    reg.dispose()
  })
})

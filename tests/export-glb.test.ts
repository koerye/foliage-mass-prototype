import { describe, expect, it } from 'vitest'
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { exportGlb, inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { buildAiScene } from '../src/ai/scene'
import { floweringBushShowcase, sakuraBonsaiShowcase, twistedSakuraShowcase } from '../src/ai/showcase'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { presetSpec } from '../src/tree/spec'

function dummyTextures(): TreeTextures {
  const mk = (name: string) => { const t = new Texture(); t.name = name; return t }
  return {
    leaf: mk('leaf'), needle: mk('needle'), drape: mk('drape'), palm: mk('palm'),
    grass: mk('grass'), grassTint: mk('grassTint'), fern: mk('fern'),
    flower: mk('flower'), blossom: mk('blossom'),
    sakura: mk('sakura'), cloud: mk('cloud'), maple: mk('maple'), willow: mk('willow'),
    bush: mk('bush'), wildrose: mk('wildrose'),
  }
}

describe('GLB export cleanup & quantization (P1-2)', () => {
  it('strips preview-only attributes and quantizes linear COLOR_0 losslessly without mutating live meshes', () => {
    const tex = dummyTextures()
    const tree = buildTree(presetSpec('broadleaf-sakura'), tex)
    const prepared = prepareGlbScene(tree.group)

    const liveMeshes: Mesh[] = []
    tree.group.traverse(o => { if (o instanceof Mesh) liveMeshes.push(o) })
    const expMeshes: Mesh[] = []
    prepared.traverse(o => { if (o instanceof Mesh) expMeshes.push(o) })
    expect(expMeshes.length).toBe(liveMeshes.length)

    // Live leaf mesh keeps leafCenter/leafCorner and Float32 color
    const liveLeaf = liveMeshes.find(m => m.name === 'Leaf cards')!
    const expLeaf = expMeshes.find(m => m.name === 'Leaf cards')!
    expect(liveLeaf.geometry.getAttribute('leafCenter')).toBeDefined()
    expect(liveLeaf.geometry.getAttribute('leafCorner')).toBeDefined()
    expect(liveLeaf.geometry.getAttribute('color').array).toBeInstanceOf(Float32Array)
    expect((liveLeaf.material as MeshStandardMaterial).userData.leafUniforms).toBeDefined()

    // Exported meshes strip preview-only attrs, use normalized Uint16 color, and strip leafUniforms
    for (let i = 0; i < expMeshes.length; i++) {
      const geo = expMeshes[i].geometry
      expect(geo.getAttribute('leafCenter')).toBeUndefined()
      expect(geo.getAttribute('leafCorner')).toBeUndefined()
      expect(geo.getAttribute('shadeWeight')).toBeUndefined()

      const srcCol = liveMeshes[i].geometry.getAttribute('color') as BufferAttribute
      const expCol = geo.getAttribute('color') as BufferAttribute
      expect(expCol.array).toBeInstanceOf(Uint16Array)
      expect(expCol.normalized).toBe(true)
      expect(expCol.count).toBe(srcCol.count)

      // Check quantization accuracy across sampled vertices (linear space precision < 1e-4)
      let maxErr = 0
      const step = Math.max(1, Math.floor(srcCol.count / 200))
      for (let v = 0; v < srcCol.count; v += step) {
        const sr = Math.min(1, Math.max(0, srcCol.getX(v)))
        const sg = Math.min(1, Math.max(0, srcCol.getY(v)))
        const sb = Math.min(1, Math.max(0, srcCol.getZ(v)))
        maxErr = Math.max(maxErr, Math.abs(sr - expCol.getX(v)), Math.abs(sg - expCol.getY(v)), Math.abs(sb - expCol.getZ(v)))
      }
      expect(maxErr).toBeLessThan(1e-4)

      const mat = expMeshes[i].material as MeshStandardMaterial
      expect(mat.userData.leafUniforms).toBeUndefined()
    }
    tree.dispose()
  })

  it('deduplicates identical materials and omits redundant child userData.spec on multi-part AI scenes', () => {
    const tex = dummyTextures()
    const scene = buildAiScene(sakuraBonsaiShowcase(), tex)

    const liveMats = new Set<unknown>()
    scene.group.traverse(o => { if (o instanceof Mesh) liveMats.add(o.material) })

    const prepared = prepareGlbScene(scene.group)
    const expMats = new Set<unknown>()
    const childSpecs: unknown[] = []
    prepared.traverse(o => {
      if (o instanceof Mesh) expMats.add(o.material)
      if (o !== prepared && o.userData && 'spec' in o.userData) childSpecs.push(o.userData.spec)
    })

    // 5-part showcase has 12 distinct material instances live -> deduplicated down to <= 6
    expect(liveMats.size).toBeGreaterThanOrEqual(10)
    expect(expMats.size).toBeLessThanOrEqual(6)
    expect(prepared.userData.aiScene).toBeDefined()
    expect(childSpecs).toHaveLength(0)

    // Verify child part transforms preserved faithfully
    const leftOrig = scene.group.children.find(c => c.name.includes('左侧'))!
    const leftCopy = prepared.children.find(c => c.name.includes('左侧'))!
    expect(leftCopy.position.toArray()).toEqual(leftOrig.position.toArray())
    expect(leftCopy.scale.toArray()).toEqual(leftOrig.scale.toArray())
    scene.dispose()
  })

  it('exports valid glTF 2.0 binary that round-trips cleanly through GLTFLoader', async () => {
    const prevFileReader = (globalThis as Record<string, unknown>).FileReader
    if (!prevFileReader) {
      ;(globalThis as Record<string, unknown>).FileReader = class NodeFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.() })
        }
      }
    }
    try {
    const root = new Group()
    root.name = 'RoundTripTest'
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
    geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
    geo.setAttribute('color', new BufferAttribute(new Float32Array([0.011, 0.25, 0.98, 0.5, 0.5, 0.5, 1.0, 0.0, 0.12]), 3))
    geo.setAttribute('leafCenter', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]), 3))
    geo.setAttribute('leafCorner', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
    geo.setIndex([0, 1, 2])

    const matA = new MeshStandardMaterial({ name: 'LeafCards', vertexColors: true, roughness: 0.8 })
    matA.userData.leafUniforms = { uLeafSSS: { value: 0.45 } }
    const matB = new MeshStandardMaterial({ name: 'LeafCards', vertexColors: true, roughness: 0.8 })
    matB.userData.leafUniforms = { uLeafSSS: { value: 0.45 } }

    root.add(new Mesh(geo, matA))
    const m2 = new Mesh(geo, matB)
    m2.position.set(2, 0, 0)
    root.add(m2)

    const blob = await exportGlb(root)
    const buf = await blob.arrayBuffer()
    const view = new DataView(buf)
    expect(view.getUint32(0, true)).toBe(0x46546c67) // 'glTF'
    expect(view.getUint32(4, true)).toBe(2)
    const jsonLen = view.getUint32(12, true)
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)))

    // Deduplicated to 1 material, zero preview attributes, normalized UNSIGNED_SHORT COLOR_0
    expect(gltf.materials).toHaveLength(1)
    expect(gltf.materials[0].extras).toBeUndefined()
    const attrs = gltf.meshes[0].primitives[0].attributes
    expect(attrs._LEAFCENTER).toBeUndefined()
    expect(attrs._LEAFCORNER).toBeUndefined()
    const colAcc = gltf.accessors[attrs.COLOR_0]
    expect(colAcc.componentType).toBe(5123) // UNSIGNED_SHORT
    expect(colAcc.normalized).toBe(true)

    // Round-trip through Three.js GLTFLoader
    const loader = new GLTFLoader()
    const loaded = await loader.parseAsync(buf, '')
    const meshes: Mesh[] = []
    loaded.scene.traverse(o => { if (o instanceof Mesh) meshes.push(o) })
    expect(meshes).toHaveLength(2)
    const cAttr = meshes[0].geometry.getAttribute('color') as BufferAttribute
    expect(Math.abs(cAttr.getX(0) - 0.011)).toBeLessThan(1e-4)
    expect(Math.abs(cAttr.getY(0) - 0.25)).toBeLessThan(1e-4)
    expect(Math.abs(cAttr.getZ(0) - 0.98)).toBeLessThan(1e-4)

    geo.dispose(); matA.dispose(); matB.dispose()
    } finally {
      if (!prevFileReader) delete (globalThis as Record<string, unknown>).FileReader
    }
  })

  it('supports 3 GLB export modes: merged single-mesh multi-material, separate, and excludeDecorations', async () => {
    const prevFileReader = (globalThis as Record<string, unknown>).FileReader
    if (!prevFileReader) {
      ;(globalThis as Record<string, unknown>).FileReader = class NodeFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.() })
        }
      }
    }
    try {
      const tex = dummyTextures()
      // 1. Multi-part twisted sakura (4 tree parts + 2 green grass parts + 4 ambient petal meshes)
      const twisted = buildAiScene(twistedSakuraShowcase(), tex)
      const previewAll = inspectGlbExport(twisted.group, { mode: 'merged', excludeDecorations: false })
      const previewNoDecor = inspectGlbExport(twisted.group, { mode: 'merged', excludeDecorations: true })
      expect(previewAll.meshCount).toBe(1)
      expect(previewAll.materials).toContain('Mat_Tree_Bark')
      expect(previewAll.materials).toContain('Mat_Foliage_Sakura')
      expect(previewAll.materials).toContain('Mat_Grass')
      expect(previewAll.materials).toContain('Mat_Decor_Petals')

      // Excluding decorations strips both grass tufts AND all floating petal particle meshes
      expect(previewNoDecor.excludedDecorations).toBeGreaterThanOrEqual(6)
      expect(previewNoDecor.materials).not.toContain('Mat_Grass')
      expect(previewNoDecor.materials).not.toContain('Mat_Decor_Petals')
      expect(previewNoDecor.materials).toEqual(['Mat_Tree_Bark', 'Mat_Foliage_Sakura'])
      expect(previewNoDecor.triangles).toBeLessThan(previewAll.triangles)

      // Separate mode preserves independent meshes & also respects excludeDecorations
      const sepAll = inspectGlbExport(twisted.group, { mode: 'separate', excludeDecorations: false })
      const sepNoDecor = inspectGlbExport(twisted.group, { mode: 'separate', excludeDecorations: true })
      expect(sepAll.meshCount).toBeGreaterThan(10)
      expect(sepNoDecor.meshCount).toBe(sepAll.meshCount - sepNoDecor.excludedDecorations)
      twisted.dispose()

      // 2. Merged single-mesh multi-material verification on Flowering Bush (bark + bush leaves + wildrose flowers -> 1 Mesh, 3 groups/materials!)
      const bush = buildAiScene(floweringBushShowcase(), tex)
      const mergedBush = prepareGlbScene(bush.group, { mode: 'merged', excludeDecorations: true })
      const mergedMeshes: Mesh[] = []
      mergedBush.traverse(o => { if (o instanceof Mesh) mergedMeshes.push(o) })
      expect(mergedMeshes).toHaveLength(1)
      const mMats = mergedMeshes[0].material as MeshStandardMaterial[]
      expect(Array.isArray(mMats)).toBe(true)
      expect(mMats).toHaveLength(3)
      expect(mergedMeshes[0].geometry.groups).toHaveLength(3)
      const bushMatNames = mMats.map(m => m.name)
      expect(bushMatNames).toContain('Mat_Tree_Bark')
      expect(bushMatNames).toContain('Mat_Foliage_Bush')
      expect(bushMatNames).toContain('Mat_Flowers_Wildrose')

      // 3. Binary GLB multi-material single-mesh export round-trip (verifies gltf.meshes.length === 1 & 3 distinct named primitives!)
      const triGeo = () => {
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
        g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
        g.setAttribute('color', new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3))
        g.setIndex([0, 1, 2])
        return g
      }
      const multiRoot = new Group()
      multiRoot.name = 'MultiMatTree'
      const barkM = new Mesh(triGeo(), new MeshStandardMaterial({ name: 'BarkProcedural', vertexColors: true }))
      barkM.name = 'Trunk and branches'
      const leafM = new Mesh(triGeo(), new MeshStandardMaterial({ name: 'LeafCards', vertexColors: true, roughness: 0.8 }))
      leafM.name = 'Leaf cards'
      const flowerM = new Mesh(triGeo(), new MeshStandardMaterial({ name: 'FlowerCards', vertexColors: true, roughness: 0.7 }))
      flowerM.name = 'Flower cards'
      const petalM = new Mesh(triGeo(), new MeshStandardMaterial({ name: 'AmbientPetals', vertexColors: true }))
      petalM.name = 'Ambient petals'
      const rockM = new Mesh(triGeo(), new MeshStandardMaterial({ name: 'RockMat', vertexColors: true }))
      rockM.name = 'Decorative Stone'
      multiRoot.add(barkM, leafM, flowerM, petalM, rockM)

      const blob = await exportGlb(multiRoot, { mode: 'merged', excludeDecorations: true })
      const buf = await blob.arrayBuffer()
      const view = new DataView(buf)
      const jsonLen = view.getUint32(12, true)
      const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)))
      expect(gltf.meshes).toHaveLength(1)
      expect(gltf.meshes[0].primitives).toHaveLength(3)
      const glbMatNames = gltf.materials.map((m: { name: string }) => m.name)
      expect(glbMatNames).toEqual(['Mat_Tree_Bark', 'Mat_Foliage_Leaves', 'Mat_Flowers'])
      bush.dispose()
    } finally {
      if (!prevFileReader) delete (globalThis as Record<string, unknown>).FileReader
    }
  })
})

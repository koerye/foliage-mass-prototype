import { describe, expect, it, vi } from 'vitest'
import {
  Box3, BufferAttribute, BufferGeometry, DataTexture, Group, Mesh, MeshStandardMaterial, RGBAFormat, Texture, Vector3,
} from 'three'
import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { exportGlb, extractStandaloneBarkBakePngsAsync, inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { buildAiScene } from '../src/ai/scene'
import { floweringBushShowcase, sakuraBonsaiShowcase, twistedSakuraShowcase } from '../src/ai/showcase'
import { makeRockMaterial } from '../src/rock/material'
import { parseRockSpec, rockPresetSpec } from '../src/rock/spec'
import { rng } from '../src/shape'
import { activityLog } from '../src/studio/activity-log'
import { bindGlbExportPopover } from '../src/studio/glb-export-ui'
import { sections } from '../src/studio/panel'
import { buildTree, isOptimizeOnlyParam, type TreeTextures } from '../src/tree/assemble'
import { CrownEnvelope } from '../src/tree/envelope'
import { lodPresets, optimizeAt, solveForTriangleBudget } from '../src/tree/optimize'
import { buildSkeleton, sampleStratifiedAzimuths, sampleStratifiedBranchSlots, shuffledIndices } from '../src/tree/skeleton'
import { parseTreeSpec, presetSpec } from '../src/tree/spec'
import { buildTrunkFeaturePlan, evalBarkSculpt, precomputeRibRow, woodSculptStyleMeta } from '../src/tree/wood-sculpt'
import { bakeSculptedBarkMaps, bakeSculptedBarkMapsAsync } from '../src/tree/wood-weld'

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

    // 5-part showcase has 13 distinct material instances live -> deduplicated down to <= 7 (includes alpha stem-leaf card material)
    expect(liveMats.size).toBeGreaterThanOrEqual(10)
    expect(expMats.size).toBeLessThanOrEqual(7)
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

  it('REQ-B1: strips broken/unloaded textures safely during exportGlb and records activityLog warning', async () => {
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
    activityLog.clear()
    try {
      const root = new Group()
      root.name = 'BrokenTexTree'
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
      geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
      geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
      geo.setIndex([0, 1, 2])

      const brokenMap = new Texture()
      brokenMap.name = 'broken_albedo'
      ;(brokenMap as unknown as { image: unknown }).image = undefined
      const brokenNorm = new Texture()
      brokenNorm.name = 'broken_normal'
      ;(brokenNorm as unknown as { image: unknown }).image = null

      const mat = new MeshStandardMaterial({
        name: 'BrokenTexMat',
        map: brokenMap,
        normalMap: brokenNorm,
        roughness: 0.75,
        metalness: 0,
      })
      const mesh = new Mesh(geo, mat)
      mesh.name = 'Leaf cards'
      root.add(mesh)

      const blob = await exportGlb(root, { mode: 'merged' })
      const ab = await blob.arrayBuffer()
      expect(new DataView(ab).getUint32(0, true)).toBe(0x46546c67) // 'glTF'

      // Live material must NOT be mutated
      expect(mat.map).toBe(brokenMap)
      expect(mat.normalMap).toBe(brokenNorm)

      // Activity log must record a warning for stripped broken textures
      const warns = activityLog.entries().filter(e => e.level === 'warn' && e.category === 'export')
      expect(warns.some(w => w.message.includes('broken_albedo') && w.message.includes('broken_normal'))).toBe(true)

      geo.dispose()
      mat.dispose()
      brokenMap.dispose()
      brokenNorm.dispose()
    } finally {
      if (!prevFileReader) delete (globalThis as Record<string, unknown>).FileReader
    }
  })

  it('REQ-B1: aliases metalnessMap = roughnessMap when metalness=0 and round-trips via GLTFLoader with zero merge warning', async () => {
    // Minimal 1x1 PNG bytes for headless Node OffscreenCanvas mock
    const png1x1 = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
      0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const g = globalThis as Record<string, unknown>
    const prevFileReader = g.FileReader
    const prevOffscreen = g.OffscreenCanvas
    const prevImageData = g.ImageData
    const prevCreateBitmap = g.createImageBitmap
    const prevFetch = g.fetch
    const prevSelf = g.self
    if (!prevSelf) g.self = globalThis
    if (!prevFileReader) {
      g.FileReader = class NodeFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.() })
        }
      }
    }
    if (!prevImageData) {
      g.ImageData = class MockImageData {
        data: Uint8ClampedArray
        width: number
        height: number
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data; this.width = width; this.height = height
        }
      }
    }
    if (!prevOffscreen) {
      g.OffscreenCanvas = class MockOffscreenCanvas {
        width: number
        height: number
        constructor(w: number, h: number) { this.width = w; this.height = h }
        getContext() {
          return {
            translate() {},
            scale() {},
            putImageData() {},
            drawImage() {},
            getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          }
        }
        async convertToBlob() { return new Blob([png1x1], { type: 'image/png' }) }
      }
    }
    if (!prevCreateBitmap) {
      g.createImageBitmap = async () => ({ width: 2, height: 2, close() {} })
    }
    // GLTFLoader's ImageBitmapLoader fetches blob: URLs; handle data/blob cleanly if needed
    const origCreateObjectURL = URL.createObjectURL
    const blobStore = new Map<string, Blob>()
    let urlCounter = 0
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const id = `blob:mock-glb-${++urlCounter}`
      if (obj instanceof Blob) blobStore.set(id, obj)
      return id
    }
    g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = String(input)
      const hit = blobStore.get(key)
      if (hit) return new Response(hit, { status: 200, headers: { 'Content-Type': 'image/png' } })
      return (prevFetch as typeof fetch)(input, init)
    }

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const root = new Group()
      root.name = 'RoughnessOnlyTree'
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
      geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
      geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
      geo.setIndex([0, 1, 2])

      const roughData = new Uint8Array(2 * 2 * 4).fill(180)
      const roughTex = new DataTexture(roughData, 2, 2, RGBAFormat)
      roughTex.name = 'bark_roughness'
      const mat = new MeshStandardMaterial({
        name: 'RoughBark',
        metalness: 0,
        roughness: 1,
        roughnessMap: roughTex,
      })
      expect(mat.metalnessMap).toBeNull()
      const mesh = new Mesh(geo, mat)
      mesh.name = 'Trunk and branches'
      root.add(mesh)

      // 1. Prepared clone sets metalnessMap === roughnessMap without mutating live material
      const prepared = prepareGlbScene(root, { mode: 'merged' })
      const expMesh = prepared.children[0] as Mesh
      const expMat = expMesh.material as MeshStandardMaterial
      expect(expMat.metalnessMap).toBe(roughTex)
      expect(expMat.roughnessMap).toBe(roughTex)
      expect(mat.metalnessMap).toBeNull()

      // 2. Binary GLB export emits ZERO GLTFExporter merge warning and round-trips via GLTFLoader
      const blob = await exportGlb(root, { mode: 'merged' })
      const mergeWarnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('Merged metalnessMap and roughnessMap'))
      expect(mergeWarnings).toHaveLength(0)

      const ab = await blob.arrayBuffer()
      const view = new DataView(ab)
      expect(view.getUint32(0, true)).toBe(0x46546c67)
      const jsonLen = view.getUint32(12, true)
      const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)))
      expect(gltf.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0)
      expect(gltf.materials[0].pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined()

      const loaded = await new GLTFLoader().parseAsync(ab, '')
      const loadedMeshes: Mesh[] = []
      loaded.scene.traverse(o => { if (o instanceof Mesh) loadedMeshes.push(o) })
      expect(loadedMeshes).toHaveLength(1)
      const loadedMat = loadedMeshes[0].material as MeshStandardMaterial
      expect(loadedMat.metalness).toBe(0)
      expect(loadedMat.roughnessMap).toBeTruthy()

      geo.dispose()
      mat.dispose()
      roughTex.dispose()
    } finally {
      warnSpy.mockRestore()
      URL.createObjectURL = origCreateObjectURL
      g.fetch = prevFetch
      if (!prevFileReader) delete g.FileReader
      if (!prevOffscreen) delete g.OffscreenCanvas
      if (!prevImageData) delete g.ImageData
      if (!prevCreateBitmap) delete g.createImageBitmap
      if (!prevSelf) delete g.self
    }
  })

  it('REQ-B3: cached LOD remesh matches full buildTree, decreases triangles monotonically, keeps silhouette <12%, and packages LOD0~LOD3.zip', async () => {
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
      expect(isOptimizeOnlyParam('optimize.level')).toBe(true)
      expect(isOptimizeOnlyParam('optimize.woodDetail')).toBe(true)
      expect(isOptimizeOnlyParam('optimize.cullHiddenWood')).toBe(true)
      expect(isOptimizeOnlyParam('optimize.flatCards')).toBe(true)
      expect(isOptimizeOnlyParam('optimize.cardReduction')).toBe(true)
      expect(isOptimizeOnlyParam('trunk.height')).toBe(false)

      const tex = dummyTextures()
      const baseSpec = presetSpec('broadleaf-sakura', 4242)
      const asset = buildTree({ ...baseSpec, optimize: optimizeAt(0) }, tex)

      const baseBox = new Box3().setFromObject(asset.group)
      const baseSize = baseBox.getSize(new Vector3())
      const lodTriangles: number[] = []
      const zipEntries: Record<string, Uint8Array> = {}

      for (let i = 0; i < lodPresets.length; i++) {
        const preset = lodPresets[i]
        const lodSpec = { ...baseSpec, optimize: optimizeAt(preset.level, baseSpec.optimize.targetTriangles) }

        // 1. remeshForOptimize produces exact same triangle count as full buildTree
        const fresh = buildTree(lodSpec, tex)
        const ok = asset.remeshForOptimize(lodSpec)
        expect(ok).toBe(true)
        expect(asset.stats.triangles).toBe(fresh.stats.triangles)
        lodTriangles.push(asset.stats.triangles)

        // Bounding-box size drift stays strictly < 12% across LOD0..LOD3
        const lodSize = new Box3().setFromObject(asset.group).getSize(new Vector3())
        const relErrX = Math.abs(lodSize.x - baseSize.x) / Math.max(1e-4, baseSize.x)
        const relErrY = Math.abs(lodSize.y - baseSize.y) / Math.max(1e-4, baseSize.y)
        const relErrZ = Math.abs(lodSize.z - baseSize.z) / Math.max(1e-4, baseSize.z)
        expect(Math.max(relErrX, relErrY, relErrZ)).toBeLessThan(0.12)

        // 2. buildLodClone matches triangle count, shares materials when requested, and exports valid GLB
        const sharedClone = asset.buildLodClone(lodSpec, { shareMaterials: true })
        expect(sharedClone.stats.triangles).toBe(fresh.stats.triangles)
        const liveMats = new Set<unknown>()
        asset.group.traverse(o => { if (o instanceof Mesh) liveMats.add(o.material) })
        sharedClone.group.traverse(o => { if (o instanceof Mesh) expect(liveMats.has(o.material)).toBe(true) })
        sharedClone.dispose()

        const exportClone = asset.buildLodClone(lodSpec)
        expect(exportClone.stats.triangles).toBe(fresh.stats.triangles)
        const glbBlob = await exportGlb(exportClone.group, { mode: 'merged', excludeDecorations: false })
        zipEntries[`sakura_LOD${i}.glb`] = new Uint8Array(await glbBlob.arrayBuffer())
        exportClone.dispose()
        fresh.dispose()
      }

      // Strictly monotonic decreasing triangle counts from LOD0 -> LOD1 -> LOD2 -> LOD3
      expect(lodTriangles).toHaveLength(4)
      for (let i = 1; i < lodTriangles.length; i++) {
        expect(lodTriangles[i]).toBeLessThan(lodTriangles[i - 1])
      }

      // 3. Package 4 GLBs with Three.js fflate zipSync -> PK header + 4 valid glTF binaries via unzipSync
      const zipped = zipSync(zipEntries, { level: 0 })
      expect(zipped[0]).toBe(0x50) // 'P'
      expect(zipped[1]).toBe(0x4b) // 'K'
      const unzipped = unzipSync(zipped)
      const names = Object.keys(unzipped).sort()
      expect(names).toEqual(['sakura_LOD0.glb', 'sakura_LOD1.glb', 'sakura_LOD2.glb', 'sakura_LOD3.glb'])
      for (const name of names) {
        const bytes = unzipped[name]
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        expect(dv.getUint32(0, true)).toBe(0x46546c67) // 'glTF'
        expect(dv.getUint32(4, true)).toBe(2)
      }

      // 4. solveForTriangleBudget reuses cached skeleton/cards cleanly
      const budgetTarget = Math.round(lodTriangles[0] * 0.45)
      const solved = solveForTriangleBudget(baseSpec, tex, budgetTarget)
      expect(solved.before).toBe(lodTriangles[0])
      expect(solved.after).toBeLessThanOrEqual(budgetTarget)
      expect(solved.reached).toBe(true)

      asset.dispose()
    } finally {
      if (!prevFileReader) delete (globalThis as Record<string, unknown>).FileReader
    }
  })

  it('REQ-B5: exports opt-in Fisher-Yates stratified azimuth helpers without perturbing default buildSkeleton', () => {
    const r1 = rng(12345)
    const idx = shuffledIndices(8, r1)
    expect(idx).toHaveLength(8)
    expect([...idx].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])

    const azA = sampleStratifiedAzimuths(6, rng(999))
    const azB = sampleStratifiedAzimuths(6, rng(999))
    expect(azA).toEqual(azB)
    expect(azA).toHaveLength(6)
    // Every angular sector [0..5] receives exactly one branch
    const sectors = azA.map(a => Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / 6)))
    expect([...sectors].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])

    const slots = sampleStratifiedBranchSlots(5, rng(777), { start: 0.25, end: 0.9 })
    expect(slots).toHaveLength(5)
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].socket).toBeGreaterThanOrEqual(slots[i - 1].socket - 0.15)
    }

    // Verify default buildSkeleton remains 100% deterministic
    const skA = buildSkeleton(presetSpec('broadleaf-sakura', 1001))
    const skB = buildSkeleton(presetSpec('broadleaf-sakura', 1001))
    expect(skA.branches.length).toBe(skB.branches.length)
    expect(skA.branches[1].points.map(p => p.toArray())).toEqual(skB.branches[1].points.map(p => p.toArray()))
  })

  it('REQ-C1 ①: precomputeRibRow matches per-pixel evalBarkSculpt identically and bakeSculptedBarkMapsAsync matches sync output', async () => {
    const spec = presetSpec('broadleaf-twisted-trunk', 3011)
    const sculpt = { ...woodSculptStyleMeta['ancient-driftwood'].spec }
    const trunk = { ...spec.trunk, sculpt }
    const phase = (spec.seed % 997) / 997 * Math.PI * 2
    const plan = buildTrunkFeaturePlan(
      sculpt, spec.seed, phase, trunk.flare, trunk.flareLobes, trunk.flareHeight,
      trunk.height, trunk.height * 0.65, [], [],
    )
    const hRef = Math.max(0.5, trunk.height)

    // Verify per-row hoisted rib evaluation matches direct evaluation to floating-point precision
    for (const t of [0.05, 0.32, 0.68, 0.92]) {
      const arcLen = t * plan.trunkArcLen
      const precomputed = precomputeRibRow(plan, sculpt, t, arcLen, arcLen, hRef, true)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + 0.13
        const baseInp = {
          sculpt, angle, t, arcLen, y: arcLen, baseRadius: trunk.radius * (1 - t * 0.35),
          refHeight: hRef, phase, concavity: 0, isTrunk: true, barkScale: trunk.barkScale ?? 1,
          flare: trunk.flare * 0.45, flareLobes: trunk.flareLobes, flareHeight: trunk.flareHeight, plan,
        }
        const direct = evalBarkSculpt(baseInp)
        const hoisted = evalBarkSculpt({ ...baseInp, precomputedRibs: precomputed })
        expect(hoisted.finalRadius).toBeCloseTo(direct.finalRadius, 10)
        expect(hoisted.cavity).toBeCloseTo(direct.cavity, 10)
        expect(hoisted.crest).toBeCloseTo(direct.crest, 10)
      }
    }

    // Verify async baker (Node sync fallback when Worker is undefined) produces exact identical bytes to sync baker
    const syncRes = bakeSculptedBarkMaps(trunk, spec.seed, 0.55, { size: 64, normalConvention: 'opengl', plan })
    const asyncRes = await bakeSculptedBarkMapsAsync(trunk, spec.seed, 0.55, { size: 64, normalConvention: 'opengl', plan })
    try {
      expect(asyncRes.width).toBe(64)
      expect(asyncRes.height).toBe(64)
      expect(asyncRes.normalConvention).toBe('opengl')
      expect(asyncRes.normalBytes).toEqual(syncRes.normalBytes)
      expect(asyncRes.aoBytes).toEqual(syncRes.aoBytes)
    } finally {
      syncRes.dispose()
      asyncRes.dispose()
    }

    // Verify extractStandaloneBarkBakePngsAsync runs cleanly on a sculpted tree
    const tex = dummyTextures()
    const tree = buildTree({ ...spec, trunk }, tex)
    try {
      const items = await extractStandaloneBarkBakePngsAsync(tree.group, { size: 512, normalConvention: 'directx' })
      expect(items.length).toBeGreaterThanOrEqual(1)
      expect(items[0].width).toBe(512)
      expect(items[0].normalConvention).toBe('directx')
    } finally {
      tree.dispose()
    }
  })

  it('REQ-C1 ②: option 5 (bakeNormalCb) stays enabled for procedural or sculpted bark and disables only when neither exists', () => {
    const prevWindow = globalThis.window
    const prevDocument = globalThis.document
    const classesMap = new WeakMap<object, Set<string>>()
    const makeEl = (tag = 'div') => {
      const cls = new Set<string>()
      const el: Record<string, unknown> = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        hidden: false,
        checked: false,
        disabled: false,
        value: '512',
        textContent: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        onclick: null as unknown,
        onchange: null as unknown,
        classList: {
          add: (...xs: string[]) => xs.forEach(x => cls.add(x)),
          remove: (...xs: string[]) => xs.forEach(x => cls.delete(x)),
          contains: (x: string) => cls.has(x),
        },
        setAttribute: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30, right: 200, bottom: 40 }),
        contains: () => false,
        append: () => {},
      }
      classesMap.set(el, cls)
      return el
    }
    const elements = new Map<string, Record<string, unknown>>()
    const getOrMake = (sel: string) => {
      let el = elements.get(sel)
      if (!el) {
        el = makeEl(sel.includes('size') || sel.includes('conv') ? 'select' : sel.includes('opt-') && !sel.includes('row') && !sel.includes('desc') && !sel.includes('summary') && !sel.includes('download') && !sel.includes('confirm') && !sel.includes('lod') ? 'input' : 'button')
        if (sel === '#glb-opt-merged' || sel === '#glb-opt-bake-moss' || sel === '#glb-opt-bake-normal' || sel === '#glb-opt-bake-grass') el.checked = true
        if (sel === '#glb-opt-bake-size') el.value = '512'
        if (sel === '#glb-opt-bake-conv') el.value = 'opengl'
        elements.set(sel, el)
      }
      return el
    }
    const popEl = makeEl('div')
    popEl.querySelector = (sel: string) => (sel === '#glb-opt-lod-zip' ? null : getOrMake(sel))
    popEl.querySelectorAll = () => []
    const triggerBtn = makeEl('button') as unknown as HTMLButtonElement
    ;(globalThis as unknown as { window: unknown; document: unknown }).window = {
      innerWidth: 1280,
      addEventListener: () => {},
    }
    ;(globalThis as unknown as { document: unknown }).document = {
      createElement: () => popEl,
      body: { append: () => {} },
    }

    const tex = dummyTextures()
    const procTree = buildTree(presetSpec('broadleaf-round', 111), tex)
    const grass = buildTree(presetSpec('grass-clump', 222), tex)
    const sculptedSpec = presetSpec('broadleaf-twisted-trunk', 333)
    sculptedSpec.trunk.sculpt = { ...woodSculptStyleMeta['stylized-twist'].spec }
    const sculptedTree = buildTree(sculptedSpec, tex)

    try {
      let activeRoot: Group = procTree.group
      const ctrl = bindGlbExportPopover({
        triggerButton: triggerBtn,
        getRoot: () => activeRoot,
        exportBlob: async () => new Blob(),
        getFilename: () => 'test.glb',
        saveBlob: () => {},
        message: () => {},
      })

      const bakeNormalCb = getOrMake('#glb-opt-bake-normal')
      const bakeDesc = getOrMake('#glb-opt-bake-normal-desc')

      // 1. Default procedural bark tree -> option 5 MUST stay enabled & checked (User Req #3 priority override!)
      ctrl.refreshSummary()
      expect(bakeNormalCb.disabled).toBe(false)
      expect(bakeNormalCb.checked).toBe(true)
      expect(String(bakeDesc.textContent)).toContain('程序化树皮')

      // 2. Non-bark model (grass clump) -> neither procedural nor sculpted bark -> auto-unchecked & disabled!
      activeRoot = grass.group
      ctrl.refreshSummary()
      expect(bakeNormalCb.disabled).toBe(true)
      expect(bakeNormalCb.checked).toBe(false)
      expect(ctrl.getOptions().bakeBarkNormal).toBe(false)
      expect(ctrl.getOptions().bakeProceduralBark).toBe(false)

      // 3. Sculpted bark tree -> re-enables cleanly & restores user's checked preference!
      activeRoot = sculptedTree.group
      ctrl.refreshSummary()
      expect(bakeNormalCb.disabled).toBe(false)
      expect(bakeNormalCb.checked).toBe(true)
      expect(String(bakeDesc.textContent)).toContain('雕刻')
    } finally {
      procTree.dispose()
      grass.dispose()
      sculptedTree.dispose()
      ;(globalThis as unknown as { window: unknown; document: unknown }).window = prevWindow
      ;(globalThis as unknown as { document: unknown }).document = prevDocument
    }
  })

  it('REQ-C5 ①②③: rock cel shader reads directionalLights[0], drape mode shows fronds.start and hides fronds.twist, and parsers/envelope guard edge inputs', () => {
    // Rock shader (v5: painterly / cel / handpainted) compiles against directionalLights[0] & uCracks
    const rockMat = makeRockMaterial(rockPresetSpec('boulder-chiseled'), 'final')
    expect(rockMat.customProgramCacheKey?.()).toBe('stylized-rock-v5')
    const mockShader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <normal_fragment_maps>\n#include <opaque_fragment>',
    }
    rockMat.onBeforeCompile(mockShader as never, {} as never)
    expect(mockShader.fragmentShader).toContain('directionalLights[0].direction')
    expect(mockShader.fragmentShader).toContain('directionalLights[0].color')
    expect(mockShader.fragmentShader).toContain('uCracks')
    rockMat.dispose()

    // Strict rock spec whitelist rejects empty {} & TexGraph JSON
    expect(() => parseRockSpec({})).toThrow()
    expect(() => parseRockSpec({ schemaVersion: 1, nodes: [], edges: [] })).toThrow()

    // Panel drape visibility: fronds.start visible, fronds.twist hidden
    const coniferSection = sections.find(s => s.kinds?.includes('conifer') && s.fields.some(f => f.path === 'fronds.start'))
    expect(coniferSection).toBeDefined()
    const startField = coniferSection!.fields.find(f => f.path === 'fronds.start')!
    const twistField = coniferSection!.fields.find(f => f.path === 'fronds.twist')!
    const drapeSpec = presetSpec('conifer-standard')
    drapeSpec.fronds.mode = 'drape'
    expect(startField.when ? startField.when(drapeSpec) : true).toBe(true)
    expect(twistField.when ? twistField.when(drapeSpec) : true).toBe(false)

    // parseTreeSpec + CrownEnvelope guard degenerate values cleanly
    const raw = JSON.parse(JSON.stringify(presetSpec('lotus-stemmed'))) as Record<string, unknown>
    ;(raw.lotus as Record<string, unknown>).leafCount = 9999
    ;(raw.crown as Record<string, unknown>).topBias = 0
    const safe = parseTreeSpec(raw)
    expect(safe.lotus.leafCount).toBeLessThanOrEqual(120)
    expect(safe.crown.topBias).toBeGreaterThanOrEqual(0.25)

    const env = new CrownEnvelope({ ...safe, crown: { ...safe.crown, depth: 0, topBias: 0, coneShape: 0 } })
    expect(Number.isFinite(env.rhoBase(new Vector3(0.3, 1.2, 0.3)))).toBe(true)
  })
})

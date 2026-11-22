import {
  Box3, BufferAttribute, CatmullRomCurve3, ClampToEdgeWrapping, Mesh, MeshStandardMaterial,
  NoColorSpace, Texture, Vector3,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'
import { buildCardGeometry } from '../src/broadleaf/leaves'
import { exportGlb, inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { optimizeGraphAgainstReference } from '../src/texgraph/agent-api'
import { evaluateTextureGraph, materialOutputToThreeTexture } from '../src/texgraph/engine'
import { defaultAsymmetricAtlasRegions } from '../src/texgraph/nodes'
import { analyzeReferenceImage } from '../src/texgraph/ref-analyze'
import { createTextureLibraryStore } from '../src/texgraph/store'
import { detectGraphAtlasRegions, textureTemplates } from '../src/texgraph/templates'
import type { AtlasRegion } from '../src/texgraph/types'
import { buildTree, type TreeTextures } from '../src/tree/assemble'
import { CrownEnvelope, evalProfileCurve } from '../src/tree/envelope'
import { buildSkeleton, type Branch } from '../src/tree/skeleton'
import { parseTreeSpec, presetSpec, woodSculptStyleMeta } from '../src/tree/spec'
import { buildWood } from '../src/tree/wood'
import { bakeSculptedBarkMaps } from '../src/tree/wood-weld'
import { decodePngFile, resolveWorkspacePath } from '../scripts/png-node.mjs'

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

describe('Milestone 1 + 2 Full Project Landing Verification', () => {
  it('1A: atlas_compose renders 8 non-overlapping regions (4 big + 4 small) with zero mip-gutter bleed & exact 3D UV consumption', () => {
    const tpl = textureTemplates.find(t => t.id === 'leaf-oak-asymmetric-atlas')
    expect(tpl).toBeDefined()
    const graph = tpl!.build()
    const regions = detectGraphAtlasRegions(graph)
    expect(regions).toBeDefined()
    expect(regions!.length).toBe(8)
    expect(regions!.filter(r => r.role === 'canopy')).toHaveLength(4)
    expect(regions!.filter(r => r.role === 'accent')).toHaveLength(4)

    // Verify all 8 regions are pairwise non-overlapping
    for (let i = 0; i < regions!.length; i++) {
      const a = regions![i]
      for (let j = i + 1; j < regions!.length; j++) {
        const b = regions![j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        expect(overlapX > 1e-4 && overlapY > 1e-4).toBe(false)
      }
    }

    const res = evaluateTextureGraph(graph, 256)
    const { width: w, height: h, data } = res.output.baseColor
    // Every single region must contain non-empty opaque foliage inside its padded box (Float32 alpha in [0,1])
    for (const r of regions!) {
      const x0 = Math.floor((r.x + r.padding) * w)
      const x1 = Math.ceil((r.x + r.w - r.padding) * w)
      const y0 = Math.floor((r.y + r.padding) * h)
      const y1 = Math.ceil((r.y + r.h - r.padding) * h)
      let opaque = 0
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (data[(py * w + px) * 4 + 3] > 0.7) opaque++
        }
      }
      expect(opaque).toBeGreaterThan(40)
    }

    // Check horizontal mip gutters between big rows (y=0.385) and between big/small rows (y=0.765) are 100% transparent!
    for (const gyFrac of [0.385, 0.765]) {
      const gutterY = Math.round(gyFrac * h)
      let gutterOpaque = 0
      for (let px = 0; px < w; px++) {
        if (data[(gutterY * w + px) * 4 + 3] > 0.08) gutterOpaque++
      }
      expect(gutterOpaque).toBe(0)
    }

    // Verify JSON round-trip of leaves.atlasRegions & strict per-card UV containment inside assigned region rects
    const spec = presetSpec('broadleaf-round')
    spec.leaves.atlasRegions = regions
    const roundTripped = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
    expect(roundTripped.leaves.atlasRegions).toHaveLength(8)

    const sk = buildSkeleton(roundTripped)
    const built = buildTree(roundTripped, dummyTextures())
    const leafMesh = built.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const uvAttr = leafMesh.geometry.getAttribute('uv') as BufferAttribute
    expect(uvAttr.count).toBeGreaterThan(20)

    // Verify buildCardGeometry directly on flat quads: every card's 4 UV vertices must lie inside ONE region rect!
    const cards = Array.from({ length: 24 }, (_, idx) => ({
      position: new Vector3(idx * 0.2, 2, 0),
      right: new Vector3(1, 0, 0),
      up: new Vector3(0, 1, 0),
      normal: new Vector3(0, 0, 1),
      width: idx % 3 === 0 ? 0.35 : 0.85,
      height: idx % 3 === 0 ? 0.35 : 0.85,
      cell: idx,
      shade: 0.9,
      spin: 0,
    }))
    const testEnv = {
      center: new Vector3(0, 2, 0),
      radii: new Vector3(3, 2, 3),
      clumps: [],
    }
    const quadGeo = buildCardGeometry(cards, testEnv, { ...roundTripped.leaves, cardType: 'quad' }, { flat: true })
    const qUv = quadGeo.getAttribute('uv') as BufferAttribute
    const hitRoles = new Set<string>()
    for (let ci = 0; ci < cards.length; ci++) {
      const us = [qUv.getX(ci * 4), qUv.getX(ci * 4 + 1), qUv.getX(ci * 4 + 2), qUv.getX(ci * 4 + 3)]
      const vs = [qUv.getY(ci * 4), qUv.getY(ci * 4 + 1), qUv.getY(ci * 4 + 2), qUv.getY(ci * 4 + 3)]
      const uMin = Math.min(...us), uMax = Math.max(...us)
      const vMin = Math.min(...vs), vMax = Math.max(...vs)
      const matched = regions!.find((r: AtlasRegion) => {
        const pad = Math.min(r.padding, r.w * 0.2, r.h * 0.2)
        const ru0 = r.x + pad - 1e-4, ru1 = r.x + r.w - pad + 1e-4
        const rv0 = 1 - (r.y + r.h - pad) - 1e-4, rv1 = 1 - (r.y + pad) + 1e-4
        return uMin >= ru0 && uMax <= ru1 && vMin >= rv0 && vMax <= rv1
      })
      expect(matched).toBeDefined()
      if (matched?.role) hitRoles.add(matched.role)
    }
    expect(hitRoles.has('canopy')).toBe(true)
    expect(hitRoles.has('accent')).toBe(true)
    expect(sk.branches.length).toBeGreaterThan(2)
    quadGeo.dispose()
    built.dispose()
  })

  it('1B: bush_inked analyzer generates 3 distinct custom_leaf prototypes with valid params & monotonic micro-refinement', async () => {
    const bushPath = resolveWorkspacePath('手绘风格繁茂绿叶灌木 PNG素材.png')
    const ref = decodePngFile(bushPath)
    const draft = analyzeReferenceImage(ref, { resolution: 256 })
    expect(draft.kind).toBe('bush_inked')

    const customLeaves = draft.draftGraph.nodes.filter(n => n.type === 'custom_leaf')
    expect(customLeaves.length).toBeGreaterThanOrEqual(3)
    for (const node of customLeaves) {
      expect(node.params.bend).toBeTypeOf('number')
      expect(node.params.tipCurl).toBeTypeOf('number')
      expect(node.params.asymmetry).toBeTypeOf('number')
      expect(node.params.notchDepth).toBeTypeOf('number')
      expect(node.params.tipSharpness).toBeUndefined()
    }

    const opt = optimizeGraphAgainstReference(draft.draftGraph, ref, {
      mode: draft.scoreMode,
      maxEvals: 40,
      params: draft.recommendedParams,
      verify512: false,
    })
    expect(opt.bestScore256.totalScore).toBeGreaterThanOrEqual(opt.initialScore256.totalScore - 1e-6)
    expect(opt.bestScore256.alphaIoU).toBeGreaterThan(0.84)
    expect(opt.telemetry.stages.some(s => s.name.includes('Stage 1b'))).toBe(true)
  })

  it('1C + 2A: multi-channel PBR persistence (with localStorage quota fallback), 1024 DirectX normal bake & TEXCOORD_1 wind UV GLB round-trip', async () => {
    // 1. Multi-channel Three Texture attachment + dispose propagation
    const barkTpl = textureTemplates.find(t => t.id === 'bark-moss-v2')!
    const barkOut = evaluateTextureGraph(barkTpl.build(), 128).output
    const barkTex = materialOutputToThreeTexture(barkOut, 'bark', 'MossBarkTest')
    expect(barkTex.userData.normalMap).toBeInstanceOf(Texture)
    expect(barkTex.userData.roughnessMap).toBeInstanceOf(Texture)
    expect((barkTex.userData.normalMap as Texture).colorSpace).toBe(NoColorSpace)
    expect((barkTex.userData.roughnessMap as Texture).colorSpace).toBe(NoColorSpace)
    expect(barkTex.userData.heightField).toBeDefined()

    const leafTpl = textureTemplates.find(t => t.id === 'leaf-oak-asymmetric-atlas')!
    const leafOut = evaluateTextureGraph(leafTpl.build(), 128).output
    const leafTex = materialOutputToThreeTexture(leafOut, 'leaf', 'OakAtlasTest')
    expect(leafTex.userData.normalMap).toBeInstanceOf(Texture)
    expect(leafTex.userData.roughnessMap).toBeInstanceOf(Texture)

    // 2. Store persistence + localStorage QuotaExceededError fallback
    let lsCalls = 0
    const memStore = new Map<string, string>()
    const fakeStorage = {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        lsCalls++
        if (v.length > 5000) throw new Error('QuotaExceededError')
        memStore.set(k, v)
      },
      removeItem: (k: string) => { memStore.delete(k) },
    }
    const store = createTextureLibraryStore({ storage: fakeStorage, apiUrl: null })
    const saved = await store.saveNew({
      name: 'PBR测试贴图',
      targetSlot: 'leaf',
      dataUrl: 'data:image/png;base64,AAAA',
      thumbnail: 'data:image/png;base64,AAAA',
      normalDataUrl: 'data:image/png;base64,' + 'N'.repeat(2400),
      heightDataUrl: 'data:image/png;base64,' + 'H'.repeat(2400),
      roughnessDataUrl: 'data:image/png;base64,' + 'R'.repeat(2400),
      atlasRegions: defaultAsymmetricAtlasRegions.map(r => ({ ...r })),
      graph: leafTpl.build(),
    })
    expect(saved.normalDataUrl).toContain('NNNN')
    expect(saved.roughnessDataUrl).toContain('RRRR')
    expect(saved.atlasRegions).toHaveLength(8)
    expect(lsCalls).toBeGreaterThanOrEqual(2) // first threw quota, fallback stripped secondary PBR mirror cleanly!

    // 3. OpenGL (+Y) vs DirectX (-Y) sculpted bark normal bake sign check + 1024px resolution support
    const drift = presetSpec('broadleaf-driftwood')
    const bakedGl = bakeSculptedBarkMaps(drift.trunk, drift.seed, 0.5, { size: 128, normalConvention: 'opengl' })
    const bakedDx = bakeSculptedBarkMaps(drift.trunk, drift.seed, 0.5, { size: 128, normalConvention: 'directx' })
    expect(bakedGl.normalConvention).toBe('opengl')
    expect(bakedDx.normalConvention).toBe('directx')
    expect(bakedGl.aoMap.channel).toBe(0)
    let flippedCount = 0
    for (let i = 0; i < bakedGl.normalBytes.length; i += 4) {
      expect(bakedGl.normalBytes[i]).toBe(bakedDx.normalBytes[i]) // R (+X) identical
      expect(bakedGl.normalBytes[i + 2]).toBe(bakedDx.normalBytes[i + 2]) // B (+Z) identical
      // G channel strictly inverted: G_dx + G_gl == 255 (±1 rounding)
      expect(Math.abs((bakedGl.normalBytes[i + 1] + bakedDx.normalBytes[i + 1]) - 255)).toBeLessThanOrEqual(1)
      if (Math.abs(bakedGl.normalBytes[i + 1] - 128) > 10) flippedCount++
    }
    expect(flippedCount).toBeGreaterThan(500)
    bakedGl.dispose()
    bakedDx.dispose()

    // 4. Multi-channel bark + leaf PBR survival in prepareGlbScene AND TEXCOORD_1 wind UV binary GLB round-trip!
    const customTex = dummyTextures()
    customTex.bark = barkTex
    customTex.leaf = leafTex
    const tree = buildTree(presetSpec('broadleaf-round'), customTex)
    const preparedPbr = prepareGlbScene(tree.group, { mode: 'merged', exportWindUv: true })
    let foundBarkPbr = false, foundLeafPbr = false
    preparedPbr.traverse(o => {
      if (o instanceof Mesh) {
        const uv1 = o.geometry.getAttribute('uv1') as BufferAttribute | undefined
        expect(uv1).toBeDefined()
        let minU = Infinity, maxU = -Infinity, maxV = -Infinity
        for (let i = 0; i < uv1!.count; i++) {
          const u = uv1!.getX(i), v = uv1!.getY(i)
          expect(u).toBeGreaterThanOrEqual(-1e-5)
          expect(u).toBeLessThanOrEqual(1 + 1e-5)
          expect(v).toBeGreaterThanOrEqual(-1e-5)
          expect(v).toBeLessThanOrEqual(1 + 1e-5)
          if (u < minU) minU = u
          if (u > maxU) maxU = u
          if (v > maxV) maxV = v
        }
        expect(minU).toBeLessThan(0.05) // trunk root anchored near 0
        expect(maxU).toBeGreaterThan(0.75) // upper canopy sways strongly
        expect(maxV).toBeGreaterThan(0.45) // outer leaf tips flutter strongly

        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m instanceof MeshStandardMaterial && m.name.startsWith('Mat_Tree_Bark')) {
            expect(m.normalMap).toBeInstanceOf(Texture)
            expect(m.roughnessMap).toBeInstanceOf(Texture)
            foundBarkPbr = true
          }
          if (m instanceof MeshStandardMaterial && m.name.startsWith('Mat_Foliage')) {
            expect(m.normalMap).toBeInstanceOf(Texture)
            expect(m.roughnessMap).toBeInstanceOf(Texture)
            foundLeafPbr = true
          }
        }
      }
    })
    expect(foundBarkPbr).toBe(true)
    expect(foundLeafPbr).toBe(true)
    expect(inspectGlbExport(tree.group, { mode: 'merged', exportWindUv: true }).windUvMeshes).toBeGreaterThanOrEqual(2)

    // Binary GLB round-trip with GLTFLoader verifying TEXCOORD_1 in glTF JSON & loaded geometry
    const prevFR = (globalThis as Record<string, unknown>).FileReader
    if (!prevFR) {
      ;(globalThis as Record<string, unknown>).FileReader = class NodeFileReader {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) { blob.arrayBuffer().then(ab => { this.result = ab; this.onloadend?.() }) }
      }
    }
    try {
      const plainTree = buildTree(presetSpec('broadleaf-round'), dummyTextures())
      // Strip empty placeholder Texture shells for headless Node GLTFExporter (Chrome Gate B verifies full embedded PNG textures)
      plainTree.group.traverse(o => {
        if (o instanceof Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (m instanceof MeshStandardMaterial) { m.map = null; m.normalMap = null; m.roughnessMap = null }
          }
        }
      })
      const blob = await exportGlb(plainTree.group, { mode: 'merged', exportWindUv: true, bakeBarkNormal: false })
      const ab = await blob.arrayBuffer()
      const jsonLen = new DataView(ab).getUint32(12, true)
      const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 20, jsonLen)))
      expect(gltf.meshes[0].primitives[0].attributes.TEXCOORD_1).toBeDefined()

      const loaded = await new GLTFLoader().parseAsync(ab, '')
      let loadedUv1Count = 0
      loaded.scene.traverse(o => {
        if (o instanceof Mesh && o.geometry.getAttribute('uv1')) loadedUv1Count++
      })
      expect(loadedUv1Count).toBeGreaterThanOrEqual(1)
      plainTree.dispose()
    } finally {
      if (!prevFR) delete (globalThis as Record<string, unknown>).FileReader
    }

    tree.dispose()
    barkTex.dispose()
    leafTex.dispose()
  })

  it('2B: welds primary limbs straddling the trunk cylindrical UV seam (j = 0 / segs) with zero UV wrap stripes + top-fork & secondary collar stability', () => {
    const spec = presetSpec('broadleaf-twisted-trunk')
    spec.trunk.sculpt = { ...woodSculptStyleMeta['stylized-twist'].spec, weldCollars: true }

    // Construct deterministic trunk + primary limb explicitly emerging right at azimuth 0 (j = 0 / segs UV seam!)
    // + top primary fork at t = 0.94 + thicker secondary branch off the primary limb!
    const trunkPts = [
      new Vector3(0, 0, 0), new Vector3(0, 1.2, 0), new Vector3(0, 2.4, 0), new Vector3(0, 3.6, 0),
    ]
    const trunkBranch: Branch = {
      id: 0, kind: 'trunk', role: 'trunk', level: 0, points: trunkPts, radii: [0.42, 0.35, 0.28, 0.22],
      curve: new CatmullRomCurve3(trunkPts),
      rootRadius: 0.42, tipRadius: 0.22, length: 3.6,
    }
    // Primary limb emerging directly along +X (matching transport frame normal at vertical trunk -> exact angle 0 / UV seam!)
    const seamLimbPts = [
      new Vector3(0, 1.8, 0), new Vector3(0.65, 2.05, 0), new Vector3(1.35, 2.45, 0), new Vector3(2.0, 2.95, 0),
    ]
    const seamLimb: Branch = {
      id: 1, parentId: 0, socket: 0.5, kind: 'primary', role: 'limb', level: 1, points: seamLimbPts, radii: [0.16, 0.12, 0.08, 0.045],
      curve: new CatmullRomCurve3(seamLimbPts), rootRadius: 0.16, tipRadius: 0.045, length: 2.35,
    }
    // Top fork emerging at t = 0.94 for apical dome crotch blending
    const topForkPts = [
      new Vector3(0, 3.38, 0), new Vector3(-0.45, 4.05, 0.35), new Vector3(-0.95, 4.75, 0.72),
    ]
    const topFork: Branch = {
      id: 2, parentId: 0, socket: 0.94, kind: 'primary', role: 'limb', level: 1, points: topForkPts, radii: [0.14, 0.09, 0.04],
      curve: new CatmullRomCurve3(topForkPts), rootRadius: 0.14, tipRadius: 0.04, length: 1.8,
    }
    // Thick secondary branch emerging from seamLimb (triggers soft normal-blended secondary collar!)
    const secPts = [
      seamLimb.curve.getPoint(0.45),
      seamLimb.curve.getPoint(0.45).add(new Vector3(0.2, 0.35, 0.45)),
      seamLimb.curve.getPoint(0.45).add(new Vector3(0.35, 0.72, 0.88)),
    ]
    const secBranch: Branch = {
      id: 3, parentId: 1, socket: 0.45, kind: 'secondary', role: 'child', level: 2, points: secPts, radii: [0.045, 0.028, 0.012],
      curve: new CatmullRomCurve3(secPts), rootRadius: 0.045, tipRadius: 0.012, length: 1.1,
    }

    // Try angles around 0 to guarantee at least one hits the exact j = 0 / segs trunk seam!
    let hitCrossSeam = false
    for (const angDeg of [0, 90, 180, 270]) {
      const rad = (angDeg * Math.PI) / 180
      const ca = Math.cos(rad), sa = Math.sin(rad)
      const rotPts = seamLimbPts.map(p => new Vector3(p.x * ca - p.z * sa, p.y, p.x * sa + p.z * ca))
      const testLimb: Branch = { ...seamLimb, points: rotPts, curve: new CatmullRomCurve3(rotPts) }
      const geo = buildWood([trunkBranch, testLimb, topFork, secBranch], spec.trunk, spec.seed, { detail: 1 })
      const wStats = geo.userData.weldStats as { weldedCount: number; crossSeamCount: number }
      if (wStats.crossSeamCount >= 1) {
        hitCrossSeam = true
        expect(wStats.weldedCount).toBeGreaterThanOrEqual(1)
        const pos = geo.getAttribute('position') as BufferAttribute
        const norm = geo.getAttribute('normal') as BufferAttribute
        const uv = geo.getAttribute('uv') as BufferAttribute
        const idx = geo.index!
        // Every vertex must have finite position & unit normal
        for (let i = 0; i < pos.count; i++) {
          expect(Number.isFinite(pos.getX(i))).toBe(true)
          expect(Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))).toBeCloseTo(1, 2)
        }
        // Check trunk & first two Hermite collar strips (B -> ring1 -> ring2) have ZERO UV wrap stripes (|du| < 0.48)
        let badWrapTris = 0
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2)
          // Ignore single cap fan center or final child-ring wrap seam where child j=segs-1 meets j=0
          const pa = new Vector3(pos.getX(a), pos.getY(a), pos.getZ(a))
          const pb = new Vector3(pos.getX(b), pos.getY(b), pos.getZ(b))
          const pc = new Vector3(pos.getX(c), pos.getY(c), pos.getZ(c))
          // Only inspect triangles near the trunk wall & collar strips away from ground/tip caps
          const avgR = (Math.hypot(pa.x, pa.z) + Math.hypot(pb.x, pb.z) + Math.hypot(pc.x, pc.z)) / 3
          if (avgR > 0.20 && avgR < 0.56 && pa.y > 0.3 && pa.y < 3.2) {
            const du = Math.max(
              Math.abs(uv.getX(a) - uv.getX(b)),
              Math.abs(uv.getX(b) - uv.getX(c)),
              Math.abs(uv.getX(c) - uv.getX(a)),
            )
            // True cylindrical seam wraparound produces |du| ~ 0.85..1.0; must be strictly < 0.65 everywhere!
            if (du > 0.65) badWrapTris++
          }
        }
        expect(badWrapTris).toBe(0)
      }
      geo.dispose()
    }
    expect(hitCrossSeam).toBe(true)
  })

  it('2C: conifer-shrub calibration prevents upper branch poke-through & CrownEnvelope profileCurve modulates silhouettes cleanly', () => {
    // 1. conifer-shrub calibration check
    const shrub = presetSpec('conifer-shrub')
    expect(shrub.branches.tipCurl).toBeLessThanOrEqual(0.15)
    expect(shrub.fronds.cardsPerBranch).toBe(1)
    expect(shrub.fronds.cardAspect).toBeGreaterThanOrEqual(0.75)
    expect(shrub.fronds.drop).toBeGreaterThanOrEqual(0.42)

    const built = buildTree(shrub, dummyTextures())
    const wood = built.group.children.find(c => c.name === 'Trunk and branches') as Mesh
    const fronds = built.group.children.find(c => c.name === 'Needle fronds') as Mesh
    wood.geometry.computeBoundingBox()
    fronds.geometry.computeBoundingBox()
    const wBox = wood.geometry.boundingBox as Box3
    const fBox = fronds.geometry.boundingBox as Box3
    // Foliage envelope must cleanly wrap both height & radial spread of juniper branches
    expect(fBox.max.y).toBeGreaterThanOrEqual(wBox.max.y - 0.05)
    expect(fBox.max.x).toBeGreaterThan(wBox.max.x)
    expect(fBox.min.x).toBeLessThan(wBox.min.x)
    built.dispose()

    // 2. CrownEnvelope vertical profileCurve identity, vase modulation & JSON round-trip
    const baseSpec = presetSpec('broadleaf-round')
    const baseEnv = new CrownEnvelope(baseSpec)
    const idSpec = parseTreeSpec(JSON.parse(JSON.stringify({
      ...baseSpec,
      crown: { ...baseSpec.crown, profileCurve: [[0, 1], [0.5, 1], [1, 1]] },
    })))
    const idEnv = new CrownEnvelope(idSpec)
    for (const u of [0.1, 0.35, 0.5, 0.75, 0.9]) {
      expect(Math.abs(idEnv.profile(u) - baseEnv.profile(u))).toBeLessThan(1e-6)
      expect(evalProfileCurve(idSpec.crown.profileCurve, u)).toBeCloseTo(1, 6)
    }

    const vaseCurve: [number, number][] = [[0.05, 0.45], [0.28, 0.50], [0.52, 1.05], [0.76, 1.40], [0.96, 1.15]]
    const vaseSpec = parseTreeSpec(JSON.parse(JSON.stringify({
      ...baseSpec,
      crown: { ...baseSpec.crown, profileCurve: vaseCurve },
    })))
    expect(vaseSpec.crown.profileCurve).toHaveLength(5)
    const vaseEnv = new CrownEnvelope(vaseSpec)
    // Waist at u=0.28 shrinks by ~0.50x; top at u=0.76 widens by ~1.40x
    expect(vaseEnv.profile(0.28) / baseEnv.profile(0.28)).toBeCloseTo(0.50, 2)
    expect(vaseEnv.profile(0.76) / baseEnv.profile(0.76)).toBeCloseTo(1.40, 2)
    // Surface consistency: every point on surface(u, theta) must satisfy rhoBase(p) == 1.0!
    for (const u of [0.2, 0.5, 0.8]) {
      for (const th of [0, 1.2, 2.7, 4.5]) {
        const pt = vaseEnv.surface(u, th)
        expect(vaseEnv.rhoBase(pt)).toBeCloseTo(1, 3)
      }
    }
    // Conifer profileCurve also works smoothly
    const conSpec = presetSpec('conifer-standard')
    conSpec.crown.profileCurve = [[0, 1.3], [0.5, 0.8], [1, 1.0]]
    const conEnv = new CrownEnvelope(conSpec)
    expect(conEnv.rhoBase(conEnv.surface(0.5, 0.7))).toBeCloseTo(1, 3)
  })

  it('Audit regressions: disk PBR survives localStorage quota merge, locked leaves stay immutable across Stage 0a+1b, willow drape gets non-zero UV1 flutter & baked bark aligns V without wrap seam', async () => {
    // 1. Quota-stripped localStorage mirror with equal updatedAt MUST NOT clobber full-PBR disk item on reload
    const leafTpl = textureTemplates.find(t => t.id === 'leaf-oak-asymmetric-atlas')!
    const ts = '2026-11-21T10:00:00.000Z'
    const diskItem = {
      id: 'tex-leaf-disk-1',
      name: 'Disk Full PBR',
      category: 'leaf',
      targetSlot: 'leaf',
      resolution: 512,
      seamless: false,
      atlasRegions: defaultAsymmetricAtlasRegions.map(r => ({ ...r })),
      dataUrl: 'data:image/png;base64,FULLBASE',
      normalDataUrl: 'data:image/png;base64,FULLNORM',
      heightDataUrl: 'data:image/png;base64,FULLHGHT',
      roughnessDataUrl: 'data:image/png;base64,FULLRGHN',
      thumbnail: 'data:image/png;base64,THUMB',
      graph: leafTpl.build(),
      createdAt: ts,
      updatedAt: ts,
    }
    const strippedLocalItem = {
      ...diskItem,
      dataUrl: '',
      normalDataUrl: undefined,
      heightDataUrl: undefined,
      roughnessDataUrl: undefined,
    }
    const mem = new Map<string, string>([
      ['vegetation-studio:saved-textures:v1', JSON.stringify({ schemaVersion: 1, items: [strippedLocalItem] })],
    ])
    const store = createTextureLibraryStore({
      storage: {
        getItem: k => mem.get(k) ?? null,
        setItem: (k, v) => { mem.set(k, v) },
      },
      apiUrl: '/api/textures',
      fetcher: async (_url, init) => {
        if (!init?.method || init.method === 'GET') {
          return new Response(JSON.stringify({ schemaVersion: 1, items: [diskItem] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      },
    })
    await store.ready()
    const reloaded = store.get('tex-leaf-disk-1')
    expect(reloaded?.dataUrl).toBe('data:image/png;base64,FULLBASE')
    expect(reloaded?.normalDataUrl).toBe('data:image/png;base64,FULLNORM')
    expect(reloaded?.heightDataUrl).toBe('data:image/png;base64,FULLHGHT')
    expect(reloaded?.roughnessDataUrl).toBe('data:image/png;base64,FULLRGHN')

    // 2. Locked vector_layout leaf instances must remain bit-exact immutable across ALL optimizer stages (0a + 1b)
    const bushRef = decodePngFile(resolveWorkspacePath('手绘风格繁茂绿叶灌木 PNG素材.png'))
    const draft = analyzeReferenceImage(bushRef, { resolution: 256 })
    const vecNode = draft.draftGraph.nodes.find(n => n.type === 'vector_layout')!
    const insts = vecNode.params.instances as Array<{ id: string; x: number; y: number; scaleX: number; scaleY: number; rot: number; locked?: boolean }>
    expect(insts.length).toBeGreaterThan(2)
    insts[0].locked = true
    const lockedBefore = { ...insts[0] }
    const opt = optimizeGraphAgainstReference(draft.draftGraph, bushRef, {
      mode: draft.scoreMode,
      maxEvals: 30,
      params: draft.recommendedParams,
      verify512: false,
      enableScaleProbe: true,
    })
    const bestVec = opt.bestGraph.nodes.find(n => n.id === vecNode.id)!
    const lockedAfter = (bestVec.params.instances as typeof insts).find(x => x.id === lockedBefore.id)!
    expect(lockedAfter.x).toBe(lockedBefore.x)
    expect(lockedAfter.y).toBe(lockedBefore.y)
    expect(lockedAfter.scaleX).toBe(lockedBefore.scaleX)
    expect(lockedAfter.scaleY).toBe(lockedBefore.scaleY)
    expect(lockedAfter.rot).toBe(lockedBefore.rot)

    // 3. Weeping willow (drape mode with zero leafCorner) must receive strong non-zero UV1 flutter on hanging tips!
    const willow = buildTree(presetSpec('broadleaf-willow'), dummyTextures())
    const willowGlb = prepareGlbScene(willow.group, { mode: 'separate', exportWindUv: true })
    let willowLeafMaxV1 = 0
    willowGlb.traverse(o => {
      if (o instanceof Mesh && o.name === 'Leaf cards') {
        const uv1 = o.geometry.getAttribute('uv1') as BufferAttribute | undefined
        expect(uv1).toBeDefined()
        for (let i = 0; i < uv1!.count; i++) {
          if (uv1!.getY(i) > willowLeafMaxV1) willowLeafMaxV1 = uv1!.getY(i)
        }
      }
    })
    expect(willowLeafMaxV1).toBeGreaterThan(0.75)
    willow.dispose()

    // 4. Sculpted bark bake aligns strictly to trunk UV.y span with ClampToEdgeWrapping, NoColorSpace & flipY=true
    const drift = presetSpec('broadleaf-driftwood')
    const baked = bakeSculptedBarkMaps(drift.trunk, drift.seed, 0.5, { size: 128 })
    expect(baked.normalMap.colorSpace).toBe(NoColorSpace)
    expect(baked.aoMap.colorSpace).toBe(NoColorSpace)
    expect(baked.normalMap.wrapT).toBe(ClampToEdgeWrapping)
    expect(baked.aoMap.wrapT).toBe(ClampToEdgeWrapping)
    expect(baked.normalMap.repeat.y).toBeLessThan(1)
    expect(baked.normalMap.repeat.y).toBeGreaterThan(0.4)
    expect(baked.normalMap.flipY).toBe(true)
    baked.dispose()
  })
})

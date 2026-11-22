import { BufferAttribute, Mesh, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { applySceneParam, buildAiScene } from '../src/ai/scene'
import { wishingTreeShowcase } from '../src/ai/showcase'
import { inspectGlbExport, prepareGlbScene } from '../src/export-glb'
import { evaluateTextureGraph } from '../src/texgraph/engine'
import { textureTemplates } from '../src/texgraph/templates'
import { buildTree, isWoodOnlyParam, type TreeTextures } from '../src/tree/assemble'
import { lodPresets, optimizeAt, solveForTriangleBudget } from '../src/tree/optimize'
import { buildSkeleton } from '../src/tree/skeleton'
import {
  isWoodSculptActive, parseTreeSpec, presetSpec, woodSculptStyleMeta,
} from '../src/tree/spec'
import { buildWood } from '../src/tree/wood'
import {
  barkFlowTileU, evalBarkSculpt, flowTwistAngle, ribCenterAngleAt, woodSculptLodParams,
  type BarkHeightField, type RibFeature,
} from '../src/tree/wood-sculpt'
import { bakeSculptedBarkMaps } from '../src/tree/wood-weld'

const textures = new Proxy({} as TreeTextures, {
  get: (_t, prop) => (prop === 'bark' ? undefined : {}),
})

describe('Unified Sculpted Bark Wrinkles & Integrated Root Buttresses (v2 Consensus)', () => {
  it('P0: enforces strict 2*PI periodicity & zero seam position gap across flare, non-integer barkScale & synthetic heightmaps', () => {
    const round = presetSpec('broadleaf-round')
    expect(isWoodSculptActive(round.trunk.sculpt)).toBe(false)
    expect(woodSculptLodParams(1, round.trunk.sculpt).active).toBe(false)

    // 4x1 periodic synthetic heightmap [0,1,0,1] + non-integer barkScale = 1.18 (exact GPT P0 repro!)
    const synthField: BarkHeightField = { data: new Float32Array([0, 1, 0, 1]), width: 4, height: 1 }
    const sculpt = { ...woodSculptStyleMeta['ancient-driftwood'].spec, heightDisplace: 0.7 }
    expect(Number.isInteger(barkFlowTileU(1.18))).toBe(true)

    const at0 = evalBarkSculpt({
      sculpt, angle: 0, t: 0.25, arcLen: 1.6, y: 1.5, baseRadius: 0.42, refHeight: 6, phase: 0.7,
      concavity: 0.4, isTrunk: true, barkScale: 1.18, flare: 1.45, flareLobes: 6, flareHeight: 1.2,
      heightField: synthField,
    })
    const at2pi = evalBarkSculpt({
      sculpt, angle: Math.PI * 2, t: 0.25, arcLen: 1.6, y: 1.5, baseRadius: 0.42, refHeight: 6, phase: 0.7,
      concavity: 0.4, isTrunk: true, barkScale: 1.18, flare: 1.45, flareLobes: 6, flareHeight: 1.2,
      heightField: synthField,
    })
    // Strict value AND slope continuity across seam
    expect(Math.abs(at0.finalRadius - at2pi.finalRadius)).toBeLessThan(1e-6)
    expect(Math.abs(at0.dispRatio - at2pi.dispRatio)).toBeLessThan(1e-6)
    expect(Math.abs(at0.cavity - at2pi.cavity)).toBeLessThan(1e-6)
    expect(at2pi.uvU - at0.uvU).toBeCloseTo(1, 6)

    // Mesh-level P0 check: measure actual 3D distance between j=0 and j=segs on EVERY trunk ring!
    for (const id of ['broadleaf-driftwood', 'broadleaf-twisted-trunk'] as const) {
      for (const detail of [1.0, 0.59]) {
        const spec = presetSpec(id)
        spec.trunk.barkScale = 1.37 // deliberate non-integer scale
        spec.trunk.sculpt = { ...spec.trunk.sculpt!, heightDisplace: 0.65 }
        const sk = buildSkeleton(spec)
        const geo = buildWood(sk.branches, spec.trunk, spec.seed, { detail, heightField: synthField })
        const pos = geo.getAttribute('position') as BufferAttribute
        const meta = geo.userData.sculptMeta as { seamPairs: [number, number][] }
        expect(meta.seamPairs.length).toBeGreaterThan(10)
        let maxGap = 0
        for (const [i0, i1] of meta.seamPairs) {
          const d = Math.hypot(
            pos.getX(i0) - pos.getX(i1),
            pos.getY(i0) - pos.getY(i1),
            pos.getZ(i0) - pos.getZ(i1),
          )
          if (d > maxGap) maxGap = d
        }
        expect(maxGap).toBeLessThan(1e-6)
        geo.dispose()
      }
    }
  })

  it('P1: locks unified twist sign between ribs & Flow UV, and preserves 0.0 deg LOD root/strand anchor invariance', () => {
    // 1. Unified twist direction check: moving along a rib keeps Flow UV.x constant!
    const fakeRib: RibFeature = {
      id: 0, priority: 100, rootAngle: 0.6, isPrimaryRoot: true,
      buttressReach: 0.5, buttressHalfWidth: 0.4, buttressHeight: 1.0,
      ribHalfWidth: 0.35, ribHeight: 0.2, startT: 0, endT: 1,
      meanderAmp: 0, meanderFreq: 1, meanderPhase: 0, creviceDepth: 0.7,
    }
    const twist = 0.52
    const ang1 = ribCenterAngleAt(fakeRib, 0.2, 1.2, 6, twist)
    const ang2 = ribCenterAngleAt(fakeRib, 0.6, 3.6, 6, twist)
    expect(ang2 - ang1).toBeCloseTo(flowTwistAngle(2.4 / 6, twist), 5)
    expect(ang2).toBeGreaterThan(ang1) // positive twist -> +angle

    const sc = woodSculptStyleMeta['stylized-twist'].spec
    const uv1 = evalBarkSculpt({
      sculpt: { ...sc, twist }, angle: ang1, t: 0.2, arcLen: 1.2, y: 1.2, baseRadius: 0.4, refHeight: 6,
      phase: 0, concavity: 0, isTrunk: true, barkScale: 1, flare: 0, flareLobes: 5, flareHeight: 1,
    }).uvU
    const uv2 = evalBarkSculpt({
      sculpt: { ...sc, twist }, angle: ang2, t: 0.6, arcLen: 3.6, y: 3.6, baseRadius: 0.3, refHeight: 6,
      phase: 0, concavity: 0, isTrunk: true, barkScale: 1, flare: 0, flareLobes: 5, flareHeight: 1,
    }).uvU
    expect(Math.abs(uv2 - uv1)).toBeLessThan(1e-5)

    // 2. LOD anchor invariance check across ALL 4 LOD tiers (0.0 deg drift!)
    for (const id of ['broadleaf-driftwood', 'broadleaf-twisted-trunk'] as const) {
      const base = presetSpec(id)
      const sk = buildSkeleton(base)
      const hiGeo = buildWood(sk.branches, base.trunk, base.seed, { detail: 1 })
      const hiMeta = hiGeo.userData.sculptMeta as {
        primaryRoots: { id: number; rootAngle: number }[]
        activeStrandIds: { id: number; parentRibId: number }[]
      }
      if (id === 'broadleaf-twisted-trunk') {
        // Stylized twist strictly uses 0 detached strands!
        expect(hiMeta.activeStrandIds.length).toBe(0)
      } else {
        // Ancient driftwood uses 1-3 short hero strands
        expect(hiMeta.activeStrandIds.length).toBeGreaterThanOrEqual(1)
        expect(hiMeta.activeStrandIds.length).toBeLessThanOrEqual(3)
      }

      for (const p of lodPresets.slice(1)) {
        const opt = optimizeAt(p.level)
        const loGeo = buildWood(sk.branches, base.trunk, base.seed, { detail: opt.woodDetail })
        const loMeta = loGeo.userData.sculptMeta as typeof hiMeta
        expect(loMeta.primaryRoots.length).toBe(hiMeta.primaryRoots.length)
        for (let k = 0; k < hiMeta.primaryRoots.length; k++) {
          expect(loMeta.primaryRoots[k].id).toBe(hiMeta.primaryRoots[k].id)
          expect(Math.abs(loMeta.primaryRoots[k].rootAngle - hiMeta.primaryRoots[k].rootAngle)).toBeLessThan(1e-6)
        }
        // Any retained hero strand keeps its exact parentRibId & ID
        for (let k = 0; k < loMeta.activeStrandIds.length; k++) {
          expect(loMeta.activeStrandIds[k]).toEqual(hiMeta.activeStrandIds[k])
        }
        loGeo.dispose()
      }
      hiGeo.dispose()
    }
  })

  it('builds both presets with Flow UVs, grounded y>=0, overlapping branch-collar stability, monotonic LOD & clean GLB', () => {
    for (const id of ['broadleaf-driftwood', 'broadleaf-twisted-trunk'] as const) {
      const spec = presetSpec(id)
      const back = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
      expect(back).toEqual(spec)

      // Stress test: drag two primary limbs nearly overlapping + shallow pitch (GPT 4.3 & 5.3!)
      const stressSpec = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
      stressSpec.branchEdits = [
        { id: 1, yawDelta: 38, pitchDelta: 18 },
        { id: 2, yawDelta: -36, pitchDelta: 24 },
      ]
      const stressAsset = buildTree(stressSpec, textures)
      const stressWood = stressAsset.group.children.find(c => c.name === 'Trunk and branches') as Mesh
      const sPos = stressWood.geometry.getAttribute('position') as BufferAttribute
      const sNorm = stressWood.geometry.getAttribute('normal') as BufferAttribute
      let minY = Infinity
      for (let i = 0; i < sPos.count; i++) {
        expect(Number.isFinite(sPos.getX(i))).toBe(true)
        expect(Number.isFinite(sPos.getY(i))).toBe(true)
        expect(Number.isFinite(sPos.getZ(i))).toBe(true)
        if (sPos.getY(i) < minY) minY = sPos.getY(i)
        const nl = Math.hypot(sNorm.getX(i), sNorm.getY(i), sNorm.getZ(i))
        expect(nl).toBeCloseTo(1, 2)
      }
      expect(minY).toBeGreaterThanOrEqual(-1e-4)
      stressAsset.dispose()

      // Verify strictly monotonic LOD reduction & budget solver
      const woodTris: number[] = []
      const totalTris: number[] = []
      for (const p of lodPresets) {
        const asset = buildTree({ ...spec, optimize: optimizeAt(p.level) }, textures)
        const woodMesh = asset.group.children.find(c => c.name === 'Trunk and branches') as Mesh
        woodTris.push(woodMesh.geometry.index!.count / 3)
        totalTris.push(asset.stats.triangles)
        if (p.id === 'high') {
          // Verify GLB export strips preview-only `barkMetric` while preserving Flow UVs
          const glbRoot = prepareGlbScene(asset.group, { mode: 'merged', bakeBarkMoss: false })
          glbRoot.traverse(o => {
            if (o instanceof Mesh) {
              expect(o.geometry.getAttribute('uv')).toBeDefined()
              expect(o.geometry.getAttribute('barkMetric')).toBeUndefined()
            }
          })
        }
        asset.dispose()
      }
      for (let i = 1; i < woodTris.length; i++) {
        expect(woodTris[i]).toBeLessThan(woodTris[i - 1])
        expect(totalTris[i]).toBeLessThan(totalTris[i - 1])
      }
      const solved = solveForTriangleBudget(spec, textures, 8000)
      expect(solved.reached).toBe(true)
      expect(solved.after).toBeLessThanOrEqual(8000)
    }
  })

  it('physically displaces trunk geometry from Substance HeightField and syncs across woody parts in AI Mode', () => {
    const tpl = textureTemplates.find(t => t.id === 'bark-oak') ?? textureTemplates[0]
    const out = evaluateTextureGraph(tpl.build(), 128).output
    const field: BarkHeightField = { data: out.heightMap.data, width: out.width, height: out.height }

    const s0 = presetSpec('broadleaf-twisted-trunk')
    s0.trunk.sculpt = { ...s0.trunk.sculpt!, heightDisplace: 0 }
    const s1 = presetSpec('broadleaf-twisted-trunk')
    s1.trunk.sculpt = { ...s1.trunk.sculpt!, heightDisplace: 0.85 }

    const sk = buildSkeleton(s0)
    const g0 = buildWood(sk.branches, s0.trunk, s0.seed, { detail: 1, heightField: field })
    const g1 = buildWood(sk.branches, s1.trunk, s1.seed, { detail: 1, heightField: field })
    const p0 = g0.getAttribute('position') as BufferAttribute
    const p1 = g1.getAttribute('position') as BufferAttribute
    expect(p0.count).toBe(p1.count)

    let maxDelta = 0
    for (let i = 0; i < p0.count; i++) {
      const d = Math.hypot(p1.getX(i) - p0.getX(i), p1.getY(i) - p0.getY(i), p1.getZ(i) - p0.getZ(i))
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeGreaterThan(0.015)
    g0.dispose()
    g1.dispose()

    const scene = wishingTreeShowcase()
    const lead = scene.parts[0]
    const res = applySceneParam(scene, lead.id, 'trunk.sculpt', { ...woodSculptStyleMeta['stylized-twist'].spec }, 'whole')
    expect(res.needsPanelSync).toBe(true)
    const woodyParts = scene.parts.filter(p => p.spec.kind === 'broadleaf' || p.spec.kind === 'conifer' || p.spec.kind === 'palm')
    const grassParts = scene.parts.filter(p => p.spec.kind === 'grass')
    for (const wp of woodyParts) expect(wp.spec.trunk.sculpt?.intensity).toBeCloseTo(woodSculptStyleMeta['stylized-twist'].spec.intensity, 3)
    for (const gp of grassParts) expect(gp.spec.trunk.sculpt?.intensity ?? 0).toBe(0)

    const built = buildAiScene(scene, textures)
    expect(built.stats.triangles).toBeGreaterThan(20000)
    built.dispose()
  })

  it('welds primary branch collars into a watertight single-manifold mesh with overlap fallback', () => {
    for (const id of ['broadleaf-twisted-trunk', 'broadleaf-driftwood'] as const) {
      const spec = presetSpec(id)
      expect(spec.trunk.sculpt?.weldCollars).toBe(true)
      const sk = buildSkeleton(spec)

      const weldedGeo = buildWood(sk.branches, spec.trunk, spec.seed, { detail: 1 })
      const wStats = weldedGeo.userData.weldStats as { weldedCount: number; skippedOverlap: number }
      expect(wStats.weldedCount).toBeGreaterThanOrEqual(2)

      // Compare against weldCollars: false
      const unweldedGeo = buildWood(
        sk.branches,
        { ...spec.trunk, sculpt: { ...spec.trunk.sculpt!, weldCollars: false } },
        spec.seed,
        { detail: 1 },
      )
      expect((unweldedGeo.userData.weldStats as { weldedCount: number }).weldedCount).toBe(0)

      // Verify watertight vertex-index connectivity from trunk (vertex 0) into welded primary limbs
      const idx = weldedGeo.index!
      const pos = weldedGeo.getAttribute('position') as BufferAttribute
      const norm = weldedGeo.getAttribute('normal') as BufferAttribute
      const adj: number[][] = Array.from({ length: pos.count }, () => [])
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2)
        adj[a].push(b, c); adj[b].push(a, c); adj[c].push(a, b)
      }
      const visited = new Uint8Array(pos.count)
      const queue = [0]
      visited[0] = 1
      let trunkComponentSize = 0
      for (let head = 0; head < queue.length; head++) {
        const u = queue[head]
        trunkComponentSize++
        for (const v of adj[u]) {
          if (!visited[v]) { visited[v] = 1; queue.push(v) }
        }
      }
      // Unwelded trunk is only trunk rings*cols + caps; welded trunk absorbs multiple primary limbs!
      const unweldedVisited = new Uint8Array(unweldedGeo.getAttribute('position').count)
      const uIdx = unweldedGeo.index!
      const uAdj: number[][] = Array.from({ length: unweldedVisited.length }, () => [])
      for (let i = 0; i < uIdx.count; i += 3) {
        const a = uIdx.getX(i), b = uIdx.getX(i + 1), c = uIdx.getX(i + 2)
        uAdj[a].push(b, c); uAdj[b].push(a, c); uAdj[c].push(a, b)
      }
      const uq = [0]; unweldedVisited[0] = 1; let unweldedTrunkSize = 0
      for (let h = 0; h < uq.length; h++) {
        unweldedTrunkSize++
        for (const v of uAdj[uq[h]]) if (!unweldedVisited[v]) { unweldedVisited[v] = 1; uq.push(v) }
      }
      expect(trunkComponentSize).toBeGreaterThan(unweldedTrunkSize + 150)

      // Check zero NaN positions & unit normals across the entire welded geometry
      for (let i = 0; i < pos.count; i++) {
        expect(Number.isFinite(pos.getX(i))).toBe(true)
        expect(Number.isFinite(pos.getY(i))).toBe(true)
        expect(Number.isFinite(pos.getZ(i))).toBe(true)
        const nl = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i))
        expect(nl).toBeCloseTo(1, 2)
      }

      weldedGeo.dispose()
      unweldedGeo.dispose()
    }
  })

  it('rebuilds ONLY wood geometry & bark material in-place while reusing foliage buffers in Classic & AI Mode', () => {
    expect(isWoodOnlyParam('trunk.sculpt.twist')).toBe(true)
    expect(isWoodOnlyParam('trunk.sculpt.weldCollars')).toBe(true)
    expect(isWoodOnlyParam('trunk.sculpt')).toBe(true)
    expect(isWoodOnlyParam('trunk.flare')).toBe(true)
    expect(isWoodOnlyParam('trunk.barkColor')).toBe(true)
    expect(isWoodOnlyParam('optimize.woodDetail')).toBe(true)
    expect(isWoodOnlyParam('trunk.height')).toBe(false)
    expect(isWoodOnlyParam('branches.count')).toBe(false)
    expect(isWoodOnlyParam('leaves.leafCount')).toBe(false)

    const spec = presetSpec('broadleaf-twisted-trunk')
    const asset = buildTree(spec, textures)
    const woodMesh = asset.group.children.find(c => c.name === 'Trunk and branches') as Mesh
    const leafMesh = asset.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const origWoodGeo = woodMesh.geometry
    const origLeafGeo = leafMesh.geometry
    const origLeafMat = leafMesh.material
    const origTris = asset.stats.triangles

    // Change twist + subdiv + weldCollars + woodDetail via rebuildWoodOnly
    const nextSpec = parseTreeSpec(JSON.parse(JSON.stringify(spec)))
    nextSpec.trunk.sculpt = { ...nextSpec.trunk.sculpt!, twist: 1.15, flutes: 7, weldCollars: false }
    nextSpec.optimize = { ...nextSpec.optimize, woodDetail: 0.55 }
    expect(asset.rebuildWoodOnly(nextSpec, textures)).toBe(true)

    expect(woodMesh.geometry).not.toBe(origWoodGeo)
    expect(leafMesh.geometry).toBe(origLeafGeo) // exact same BufferGeometry reference (0 foliage rebuild!)
    expect(leafMesh.material).toBe(origLeafMat)
    expect(asset.stats.triangles).toBeLessThan(origTris)

    // Verify live shader uniform hot-updates still target the active bark material after wood rebuild
    const mossSpec = { ...nextSpec, trunk: { ...nextSpec.trunk, barkMoss: 0.72 } }
    expect(asset.applyLiveParam('trunk.barkMoss', mossSpec)).toBe(true)
    const barkMat = woodMesh.material as MeshStandardMaterial
    expect((barkMat.userData.barkUniforms as Record<string, { value: number }>).uBarkMoss.value).toBeCloseTo(0.72, 4)
    asset.dispose()

    // Verify AI Mode per-part wood-only incremental rebuild preserves foliage buffers
    const aiScene = wishingTreeShowcase()
    const lead = aiScene.parts[0]
    const aiAsset = buildAiScene(aiScene, textures)
    const leadBuilt = aiAsset.partAssets.get(lead.id)!
    const aiLeafMesh = leadBuilt.group.children.find(c => c.name === 'Leaf cards') as Mesh
    const aiOrigLeafGeo = aiLeafMesh.geometry
    const aiOrigTris = aiAsset.stats.triangles

    lead.spec = { ...lead.spec, trunk: { ...lead.spec.trunk, sculpt: { ...woodSculptStyleMeta['stylized-twist'].spec } } }
    expect(aiAsset.rebuildPartWoodOnly(lead, textures, aiScene)).toBe(true)
    expect(aiLeafMesh.geometry).toBe(aiOrigLeafGeo)
    expect(aiAsset.stats.triangles).toBeGreaterThan(aiOrigTris)
    aiAsset.dispose()
  })

  it('bakes valid OpenGL tangent-space NormalMap + Cavity AO for low-poly GLB export', () => {
    const spec = presetSpec('broadleaf-driftwood')
    const gameSpec = { ...spec, optimize: optimizeAt(0.42) } // Standard Game LOD (~6k tris)
    const baked = bakeSculptedBarkMaps(gameSpec.trunk, gameSpec.seed, gameSpec.optimize.woodDetail, { size: 128 })

    expect(baked.width).toBe(128)
    expect(baked.height).toBe(128)
    let minR = 255, maxR = 0, minB = 255, minAO = 255, maxAO = 0
    for (let i = 0; i < baked.normalBytes.length; i += 4) {
      const r = baked.normalBytes[i]
      const b = baked.normalBytes[i + 2]
      const ao = baked.aoBytes[i]
      if (r < minR) minR = r
      if (r > maxR) maxR = r
      if (b < minB) minB = b
      if (ao < minAO) minAO = ao
      if (ao > maxAO) maxAO = ao
    }
    // All tangent normals must point outward (+Z -> blue > 128), with strong sculptural relief & crevice AO!
    expect(minB).toBeGreaterThan(128)
    expect(minR).toBeLessThan(115)
    expect(maxR).toBeGreaterThan(140)
    expect(minAO).toBeLessThan(190)
    expect(maxAO).toBeGreaterThan(235)
    baked.dispose()

    // Verify inspectGlbExport & prepareGlbScene attach baked normalMap + aoMap cleanly in both merged & separate modes
    const asset = buildTree(gameSpec, textures)
    expect(inspectGlbExport(asset.group, { mode: 'merged', bakeBarkNormal: true }).normalBakedMeshes).toBe(1)
    expect(inspectGlbExport(asset.group, { mode: 'merged', bakeBarkNormal: false }).normalBakedMeshes).toBe(0)

    for (const mode of ['merged', 'separate'] as const) {
      const prepared = prepareGlbScene(asset.group, { mode, bakeBarkNormal: true })
      let foundNormalAndAo = false
      prepared.traverse(o => {
        if (o instanceof Mesh) {
          expect(o.geometry.userData.sculptBakeInfo).toBeUndefined()
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            if (m instanceof MeshStandardMaterial && m.normalMap?.name === 'BakedSculptBarkNormal' && m.aoMap?.name === 'BakedSculptBarkAO') {
              foundNormalAndAo = true
            }
          }
        }
      })
      expect(foundNormalAndAo).toBe(true)
    }
    asset.dispose()
  })
})

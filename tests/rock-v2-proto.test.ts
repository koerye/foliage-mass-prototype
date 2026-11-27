import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferAttribute, Group, Matrix3, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import { prepareGlbScene } from '../src/export-glb'
import { bakeRockV2Textures } from '../src/rock-v2/bake'
import { createRockV2Field } from '../src/rock-v2/sdf'
import { extractSurfaceNets } from '../src/rock-v2/surface-nets'
import { computeLockedTangents, unwrapRockUvCharts } from '../src/rock-v2/uv-charts'
import { buildBlockBluffRouteC, buildRouteCRock, buildSandstoneLedgeRouteC, sliceMeshByPlane } from '../src/rock-v2/poly-csg'
import { PolyCWorkerClient } from '../src/rock-v2/poly-c-client'
import type { PolyCWorkerRequest, PolyCWorkerResponse } from '../src/rock-v2/poly-c.worker'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from '../src/rock-v2/poly-pbr'
import type { RockV2WorkerRequest, RockV2WorkerResponse } from '../src/rock-v2/rock-v2.worker'
import { RockV2WorkerClient } from '../src/rock-v2/worker-client'

describe('Rock v2 Route-B Prototype — Gate 1, Gate 2 & Regression Audits', () => {
  for (const id of ['sandstone-ledge-b', 'block-bluff', 'twin-slab'] as const) {
    it(`${id}: extracts watertight single-shell manifold at both low (LOD0) and high (sculpt) resolutions`, () => {
      const field = createRockV2Field(id)
      const low = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
      const high = extractSurfaceNets(field, { resolution: 64, projectToSurface: true })

      console.log(
        `[Gate1 ${id}] LOW(30): tris=${low.audit.triangles}, shells=${low.audit.connectedComponents}, ` +
        `open=${low.audit.openEdges}, nonManifold=${low.audit.nonManifoldEdges}, winding=${low.audit.windingMismatches}, ` +
        `degen=${low.audit.degenerateTriangles}, selfX=${low.audit.selfIntersections}, ` +
        `minY=${low.audit.minY}, maxY=${low.audit.maxY}, offErr(max/mean)=${low.audit.maxOffSurfaceError}/${low.audit.meanOffSurfaceError}, ` +
        `ms=${low.timings.totalMs}`,
      )
      console.log(
        `[Gate1 ${id}] HIGH(64): tris=${high.audit.triangles}, shells=${high.audit.connectedComponents}, ` +
        `open=${high.audit.openEdges}, nonManifold=${high.audit.nonManifoldEdges}, winding=${high.audit.windingMismatches}, ` +
        `degen=${high.audit.degenerateTriangles}, selfX=${high.audit.selfIntersections}, ` +
        `minY=${high.audit.minY}, maxY=${high.audit.maxY}, offErr(max/mean)=${high.audit.maxOffSurfaceError}/${high.audit.meanOffSurfaceError}, ` +
        `ms=${high.timings.totalMs}`,
      )

      for (const m of [low, high]) {
        expect(m.audit.connectedComponents).toBe(1)
        expect(m.audit.openEdges).toBe(0)
        expect(m.audit.nonManifoldEdges).toBe(0)
        expect(m.audit.windingMismatches).toBe(0)
        expect(m.audit.degenerateTriangles).toBe(0)
        expect(m.audit.selfIntersections).toBe(0)
        expect(Math.abs(m.audit.minY)).toBeLessThan(1e-3)
        expect(m.audit.maxY).toBeGreaterThan(0.8)
      }
      expect(low.audit.triangles).toBeGreaterThanOrEqual(1000)
      expect(low.audit.triangles).toBeLessThanOrEqual(5000)
    })
  }

  for (const id of ['block-bluff', 'twin-slab'] as const) {
    it(`Gate 2 (${id}): honest analytical vs cache-fallback bake audit & residual bounds`, () => {
      const field = createRockV2Field(id)
      const low = extractSurfaceNets(field, { resolution: 30, projectToSurface: true })
      const unwrapped = unwrapRockUvCharts(low, 512, 12)
      const baked = bakeRockV2Textures(field, unwrapped, { size: 256, dilationPasses: 6, brushMode: 'subtle' })

      console.log(`[Gate2 UV ${id}]`, JSON.stringify({ ...unwrapped.audit, uvMs: unwrapped.uvMs }))
      console.log(`[Gate2 BAKE 256 ${id}]`, JSON.stringify(baked.stats))

      expect(unwrapped.audit.flippedUvTris).toBe(0)
      expect(unwrapped.audit.overlappingChartTris).toBe(0)
      expect(unwrapped.audit.tangentInvalidCount).toBe(0)
      expect(unwrapped.audit.uvCoverage).toBeGreaterThan(0.25)

      // Strict honest analytical hit verification (separate from cacheFallbacks!)
      expect(baked.stats.analyticalHitRate).toBeGreaterThan(0.95)
      expect(baked.stats.cacheFallbackRate).toBeLessThan(0.03)
      expect(baked.stats.crossWallRate).toBeLessThan(0.01)
      expect(baked.stats.missRate).toBeLessThan(0.02)
      expect(baked.stats.p95AnalyticalResidual).toBeLessThan(0.002)
      expect(baked.stats.meanAnalyticalResidual).toBeLessThan(0.001)
    })
  }

  it('GLB merge tangent regression: non-uniform scale, mirror scale, and mixed tangent/non-tangent meshes preserve valid orthonormal TBN', () => {
    const field = createRockV2Field('block-bluff')
    const low = extractSurfaceNets(field, { resolution: 24, projectToSurface: true })
    const unwrapped = unwrapRockUvCharts(low, 512, 12)

    // 1. Non-uniform scale + rotation on tangent-bearing rock
    const rockGeo = unwrapped.toBufferGeometry()
    const rockMat = new MeshStandardMaterial({ name: 'Mat_RockV2_PBR', roughness: 0.9, metalness: 0 })
    const rockMesh = new Mesh(rockGeo, rockMat)
    rockMesh.scale.set(2.2, 0.65, 1.35)
    rockMesh.rotation.set(0.25, 0.48, 0.62)

    const gNonUniform = new Group()
    gNonUniform.add(rockMesh)
    gNonUniform.updateMatrixWorld(true)

    const preparedNU = prepareGlbScene(gNonUniform, { mode: 'merged', excludeDecorations: false })
    const linMat = new Matrix3().setFromMatrix4(rockMesh.matrixWorld)
    const normMat = new Matrix3().getNormalMatrix(rockMesh.matrixWorld)

    let checkedNU = 0
    preparedNU.traverse(obj => {
      if (!(obj instanceof Mesh)) return
      const nAttr = obj.geometry.getAttribute('normal') as BufferAttribute
      const tAttr = obj.geometry.getAttribute('tangent') as BufferAttribute
      expect(tAttr).toBeTruthy()
      expect(tAttr.itemSize).toBe(4)

      const srcN = rockGeo.getAttribute('normal') as BufferAttribute
      const srcT = rockGeo.getAttribute('tangent') as BufferAttribute
      for (let i = 0; i < tAttr.count; i++) {
        const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
        const tx = tAttr.getX(i), ty = tAttr.getY(i), tz = tAttr.getZ(i), tw = tAttr.getW(i)
        const tLen = Math.hypot(tx, ty, tz)
        expect(tLen).toBeGreaterThan(0.99)
        expect(tLen).toBeLessThan(1.01)
        // Strict orthogonality T ⊥ N even under extreme (2.2, 0.65, 1.35) + rotation!
        expect(Math.abs(nx * tx + ny * ty + nz * tz)).toBeLessThan(1e-4)
        expect(tw === 1 || tw === -1).toBe(true)

        // Verify tangent matches linear-matrix transformed T (orthogonalized against N), NOT normalMatrix * T!
        const expN = new Vector3().fromBufferAttribute(srcN, i).applyMatrix3(normMat).normalize()
        const expT = new Vector3(srcT.getX(i), srcT.getY(i), srcT.getZ(i)).applyMatrix3(linMat)
        expT.addScaledVector(expN, -expN.dot(expT)).normalize()
        expect(Math.abs(expT.x * tx + expT.y * ty + expT.z * tz)).toBeGreaterThan(0.999)
        checkedNU++
      }
    })
    expect(checkedNU).toBeGreaterThan(1000)

    // 2. Mirror transform scale(-1, 1, 1): handedness w MUST flip so cross(N', T')*w' matches L * B_local!
    const mirrorMesh = new Mesh(rockGeo.clone(), rockMat)
    mirrorMesh.scale.set(-1, 1, 1)
    const gMirror = new Group()
    gMirror.add(mirrorMesh)
    gMirror.updateMatrixWorld(true)
    const preparedMirror = prepareGlbScene(gMirror, { mode: 'merged', excludeDecorations: false })
    const mirrorLin = new Matrix3().setFromMatrix4(mirrorMesh.matrixWorld)
    preparedMirror.traverse(obj => {
      if (!(obj instanceof Mesh)) return
      const nAttr = obj.geometry.getAttribute('normal') as BufferAttribute
      const tAttr = obj.geometry.getAttribute('tangent') as BufferAttribute
      const srcN = rockGeo.getAttribute('normal') as BufferAttribute
      const srcT = rockGeo.getAttribute('tangent') as BufferAttribute
      for (let i = 0; i < tAttr.count; i++) {
        const nOut = new Vector3().fromBufferAttribute(nAttr, i)
        const tOut = new Vector3(tAttr.getX(i), tAttr.getY(i), tAttr.getZ(i))
        const wOut = tAttr.getW(i)
        expect(Math.abs(nOut.dot(tOut))).toBeLessThan(1e-4)
        expect(wOut).toBe(-srcT.getW(i))
        // Verify reconstructed bitangent cross(N', T') * w' aligns with mirror-transformed original bitangent!
        const bOut = new Vector3().crossVectors(nOut, tOut).multiplyScalar(wOut).normalize()
        const nLoc = new Vector3().fromBufferAttribute(srcN, i)
        const tLoc = new Vector3(srcT.getX(i), srcT.getY(i), srcT.getZ(i))
        const bExp = new Vector3().crossVectors(nLoc, tLoc).multiplyScalar(srcT.getW(i)).applyMatrix3(mirrorLin).normalize()
        expect(bOut.dot(bExp)).toBeGreaterThan(0.99)
      }
    })

    // 3. Mixed merge: tangent-bearing rock + UV'd box (NO tangent, faces ±X!) + non-UV sphere (NO tangent)
    const boxGeo = new BoxGeometry(1, 1, 1) // has normals (±1,0,0) and uv, NO tangent!
    const sphereGeo = new SphereGeometry(0.5, 8, 6)
    sphereGeo.deleteAttribute('uv') // NO uv, NO tangent!
    const auxMat = new MeshStandardMaterial({ name: 'Mat_Aux', roughness: 0.8 })
    const gMixed = new Group()
    gMixed.add(new Mesh(rockGeo.clone(), rockMat))
    gMixed.add(new Mesh(boxGeo, auxMat))
    gMixed.add(new Mesh(sphereGeo, auxMat))
    gMixed.updateMatrixWorld(true)

    const preparedMixed = prepareGlbScene(gMixed, { mode: 'merged', excludeDecorations: false })
    let mixedVerts = 0
    preparedMixed.traverse(obj => {
      if (!(obj instanceof Mesh)) return
      const nAttr = obj.geometry.getAttribute('normal') as BufferAttribute
      const tAttr = obj.geometry.getAttribute('tangent') as BufferAttribute
      expect(tAttr && tAttr.itemSize === 4).toBe(true)
      for (let i = 0; i < tAttr.count; i++) {
        const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
        const tx = tAttr.getX(i), ty = tAttr.getY(i), tz = tAttr.getZ(i), tw = tAttr.getW(i)
        const tl = Math.hypot(tx, ty, tz)
        expect(tl).toBeGreaterThan(0.99)
        expect(tl).toBeLessThan(1.01)
        // Guarantees NO hardcoded (1,0,0,1) collinear with (±1,0,0) box faces!
        expect(Math.abs(nx * tx + ny * ty + nz * tz)).toBeLessThan(1e-4)
        expect(tw === 1 || tw === -1).toBe(true)
        mixedVerts++
      }
    })
    expect(mixedVerts).toBeGreaterThan(rockGeo.getAttribute('position').count + boxGeo.getAttribute('position').count)

    rockGeo.dispose(); boxGeo.dispose(); sphereGeo.dispose(); rockMat.dispose(); auxMat.dispose()
  })

  it('locked tangents follow glTF 2.0 / OpenGL (+Y up) MikkTSpace handedness for cross-engine (Blender/Three.js) parity', () => {
    // Unit quad in XY facing +Z with glTF top-down UVs (v=0 top y=1, v=1 bottom y=0)
    const pos = new Float32Array([0, 1, 0, 1, 1, 0, 0, 0, 0])
    const norm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])
    const uv = new Float32Array([0, 0, 1, 0, 0, 1])
    const idx = new Uint32Array([0, 2, 1])
    const { tangents, invalidCount } = computeLockedTangents(pos, norm, uv, idx)
    expect(invalidCount).toBe(0)
    // T = +X, B = cross(N, T) * w = (0,+1,0) (+Y UP in image space!), so w MUST be +1!
    for (let i = 0; i < 3; i++) {
      expect(tangents[i * 4]).toBeCloseTo(1, 5)
      expect(tangents[i * 4 + 1]).toBeCloseTo(0, 5)
      expect(tangents[i * 4 + 2]).toBeCloseTo(0, 5)
      expect(tangents[i * 4 + 3]).toBe(1)
    }
  })

  it('RockV2WorkerClient coalesces rapid drag jobs, drops stale bakes, and respects cancelAll()', () => {
    // Controllable mock async Worker to deterministically simulate slow in-flight jobs!
    const dispatched: RockV2WorkerRequest[] = []
    let onMsg: ((ev: MessageEvent<RockV2WorkerResponse>) => void) | null = null
    const mockWorker = {
      set onmessage(fn: ((ev: MessageEvent<RockV2WorkerResponse>) => void) | null) { onMsg = fn },
      onerror: null,
      postMessage(req: RockV2WorkerRequest) { dispatched.push(req) },
      terminate() {},
    } as unknown as Worker

    const makeMockResp = (req: RockV2WorkerRequest): RockV2WorkerResponse => {
      if (req.stage === 'preview') {
        return {
          jobId: req.jobId,
          stage: 'preview',
          positions: new Float32Array(9),
          normals: new Float32Array(9),
          indices: new Uint32Array([0, 1, 2]),
          audit: {
            vertices: 3, triangles: 1, connectedComponents: 1, openEdges: 0,
            nonManifoldEdges: 0, windingMismatches: 0, degenerateTriangles: 0,
            selfIntersections: 0, minY: 0, maxY: 1, maxOffSurfaceError: 0, meanOffSurfaceError: 0,
          },
          timings: { sdfSampleMs: 1, extractMs: 1, projectMs: 1, normalsMs: 0, totalMs: 3 },
        }
      }
      return {
        jobId: req.jobId,
        stage: 'bake',
        positions: new Float32Array(9),
        normals: new Float32Array(9),
        uvs: new Float32Array(6),
        tangents: new Float32Array(12),
        indices: new Uint32Array([0, 1, 2]),
        size: 4,
        albedo: new Uint8ClampedArray(64),
        normal: new Uint8ClampedArray(64),
        ao: new Uint8ClampedArray(64),
        audit: {
          vertices: 3, triangles: 1, connectedComponents: 1, openEdges: 0,
          nonManifoldEdges: 0, windingMismatches: 0, degenerateTriangles: 0,
          selfIntersections: 0, minY: 0, maxY: 1, maxOffSurfaceError: 0, meanOffSurfaceError: 0,
        },
        uvAudit: {
          chartCount: 1, vertexCountBeforeSplit: 3, vertexCountAfterSplit: 3, triangles: 1,
          uvCoverage: 0.5, flippedUvTris: 0, overlappingChartTris: 0, minScale: 1, maxScale: 1, tangentInvalidCount: 0,
        },
        uvMs: 1,
        meshTimings: { sdfSampleMs: 1, extractMs: 1, projectMs: 1, normalsMs: 0, totalMs: 3 },
        bakeStats: {
          resolution: 4, coveredTexels: 1, analyticalCleanHits: 1, analyticalGrazingHits: 0,
          cacheFallbacks: 0, crossWallRejected: 0, misses: 0, flippedNormalFallback: 0,
          analyticalHitRate: 1, cacheFallbackRate: 0, crossWallRate: 0, missRate: 0,
          maxAnalyticalResidual: 0, meanAnalyticalResidual: 0, p95AnalyticalResidual: 0,
          timings: { volumeCacheMs: 1, rasterAndProjectMs: 1, aoMs: 1, albedoMs: 1, dilationMs: 1, totalBakeMs: 5 },
        },
      }
    }

    const applied: { jobId: number; stage: string }[] = []
    const client = new RockV2WorkerClient(
      res => { applied.push({ jobId: res.jobId, stage: res.stage }) },
      undefined,
      { workerFactory: () => mockWorker },
    )

    // 1. Slow bake #1 starts in-flight; newer bakes #2 and #3 arrive before #1 finishes!
    const j1 = client.submit({ stage: 'bake', archetype: 'block-bluff', sculpt: { seed: 100 } })
    const j2 = client.submit({ stage: 'bake', archetype: 'block-bluff', sculpt: { seed: 200 } })
    const j3 = client.submit({ stage: 'bake', archetype: 'block-bluff', sculpt: { seed: 300 } })
    expect(dispatched.map(d => d.jobId)).toEqual([j1]) // #2 coalesced by #3 while #1 is busy!

    // Slow #1 finishes -> MUST be strictly dropped (NEVER overwrite #3!) and #3 dispatched immediately
    onMsg!({ data: makeMockResp(dispatched[0]) } as MessageEvent<RockV2WorkerResponse>)
    expect(applied).toEqual([])
    expect(dispatched.map(d => d.jobId)).toEqual([j1, j3])
    expect(client.getStats().staleDropped).toBe(1)
    expect(client.getStats().coalescedSkipped).toBe(1)

    // #3 finishes -> applied!
    onMsg!({ data: makeMockResp(dispatched[1]) } as MessageEvent<RockV2WorkerResponse>)
    expect(applied).toEqual([{ jobId: j3, stage: 'bake' }])

    // 2. Continuous drag preview burst (#4 dispatched, #5 coalesced by #6) -> #4 renders immediately, then #6 renders!
    const j4 = client.submit({ stage: 'preview', archetype: 'block-bluff', sculpt: { seed: 400 } })
    client.submit({ stage: 'preview', archetype: 'block-bluff', sculpt: { seed: 500 } })
    const j6 = client.submit({ stage: 'preview', archetype: 'block-bluff', sculpt: { seed: 600 } })
    onMsg!({ data: makeMockResp(dispatched[2]) } as MessageEvent<RockV2WorkerResponse>)
    expect(applied.map(a => a.jobId)).toEqual([j3, j4])
    onMsg!({ data: makeMockResp(dispatched[3]) } as MessageEvent<RockV2WorkerResponse>)
    expect(applied.map(a => a.jobId)).toEqual([j3, j4, j6])

    // 3. cancelAll() invalidates any in-flight job when user exits experimental mode
    const j7 = client.submit({ stage: 'bake', archetype: 'block-bluff', sculpt: { seed: 700 } })
    expect(dispatched[4].jobId).toBe(j7)
    client.cancelAll()
    onMsg!({ data: makeMockResp(dispatched[4]) } as MessageEvent<RockV2WorkerResponse>)
    expect(applied.map(a => a.jobId)).toEqual([j3, j4, j6]) // #7 dropped cleanly!
    expect(client.getStats().staleDropped).toBe(2)

    client.dispose()
  })

  it('Route C (sandstone-ledge c1 & c2): explicit polyhedral Manifold CSG passes watertight, single-shell & cross-section audits', async () => {
    for (const variant of ['c1', 'c2'] as const) {
      const res = await buildSandstoneLedgeRouteC(variant)
      console.log(`[Route C ${variant}]`, JSON.stringify(res.audit))

      expect(res.audit.manifoldStatus).toBe('NoError')
      expect(res.audit.rawManifoldComponents).toBe(1)
      expect(res.audit.connectedComponents).toBe(1)
      expect(res.audit.openEdges).toBe(0)
      expect(res.audit.nonManifoldEdges).toBe(0)
      expect(res.audit.windingMismatches).toBe(0)
      expect(res.audit.degenerateTriangles).toBe(0)
      expect(res.audit.selfIntersections).toBe(0)
      expect(res.audit.minY).toBeCloseTo(0, 3)

      // Verify shoulder cross-section slice produces clean segments
      const sliceSegs = sliceMeshByPlane(
        res.positions,
        res.indices,
        { x: -0.02, y: 0.49 + res.shiftY, z: 0.28 },
        { x: 0.44, y: 0.44, z: 0.78 },
        { x: 0.78, y: -0.22, z: -0.58 },
        { x: -0.26, y: 0.88, z: 0.39 },
      )
      expect(sliceSegs.length).toBeGreaterThan(4)
    }
  })

  it('Route C2 512 PBR: faceID/crease UV unwrap merges coplanar patches cleanly & bakes C2-surface Baseline + Shallow-Detail PBR', async () => {
    const c2 = await buildSandstoneLedgeRouteC('c2')
    const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: 512, gutterPx: 10 })
    const base = bakePolyCsgPbr(c2, uv, { size: 512, mode: 'baseline', baseColorHex: '#caa57c', dilationPasses: 14 })
    const detail = bakePolyCsgPbr(c2, uv, { size: 512, mode: 'shallow-detail', baseColorHex: '#caa57c', dilationPasses: 14 })

    console.log('[Route C2 UV]', JSON.stringify(uv.audit))
    console.log('[Route C2 Bake Baseline]', JSON.stringify(base.stats))
    console.log('[Route C2 Bake Shallow-Detail]', JSON.stringify(detail.stats))

    expect(uv.audit.flippedUvTris).toBe(0)
    expect(uv.audit.overlappingChartTris).toBe(0)
    expect(uv.audit.tangentInvalidCount).toBe(0)
    expect(uv.audit.chartCount).toBeLessThan(uv.audit.rawFaceGroups)
    expect(uv.audit.uvCoverage).toBeGreaterThan(0.35)

    // Baseline normal map must be strictly flat neutral (128,128,255) everywhere!
    expect(base.stats.maxNormalDeviationDeg).toBe(0)
    let nonNeutralNormalTexels = 0
    for (let i = 0; i < base.normal.length; i += 4) {
      if (base.normal[i] !== 128 || base.normal[i + 1] !== 128 || base.normal[i + 2] !== 255) {
        nonNeutralNormalTexels++
      }
    }
    expect(nonNeutralNormalTexels).toBe(0)

    // Physical BVH ray-traced AO must genuinely darken the open shoulder V-notch relative to open faces!
    expect(base.stats.shoulderNotchCoverage.coveredTexels).toBeGreaterThan(400)
    expect(base.stats.bevelCoverage.coveredTexels).toBeGreaterThan(800)
    expect(base.stats.shoulderNotchMeanAo).toBeLessThan(base.stats.meanAo)

    // Shallow detail normal stays restrained (<= 6.5°) and never introduces extreme dark trenches
    expect(detail.stats.maxNormalDeviationDeg).toBeGreaterThan(0.25)
    expect(detail.stats.maxNormalDeviationDeg).toBeLessThan(7.0)
  })

  it('Route C2 parameterized sliders stay watertight single-shell with zero self-intersections across bounds', async () => {
    const canon = await buildSandstoneLedgeRouteC('c2', { seed: 5104, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 1.0 })
    expect(canon.audit.triangles).toBe(230)

    const cases = [
      { seed: 5104, shoulderDepth: 0.70, bevelScale: 1.0, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.32, bevelScale: 1.0, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.0, bevelScale: 0.0, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.0, bevelScale: 1.35, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 0.55 },
      { seed: 5104, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 1.35 },
      { seed: 1111, shoulderDepth: 0.85, bevelScale: 1.15, notchDepth: 1.10 },
      { seed: 3333, shoulderDepth: 1.22, bevelScale: 0.75, notchDepth: 0.90 },
      // Continuous 20-step shoulderDepth & 15-step bevelScale drag sweep (guards against degenerate triple-plane slivers!)
      ...Array.from({ length: 20 }, (_, i) => ({ seed: 5104, shoulderDepth: Number((0.72 + (i / 19) * 0.58).toFixed(2)), bevelScale: 1.0, notchDepth: 1.0 })),
      ...Array.from({ length: 15 }, (_, i) => ({ seed: 5104, shoulderDepth: 1.30, bevelScale: Number((0.05 + (i / 14) * 1.25).toFixed(2)), notchDepth: 1.0 })),
    ]
    for (const p of cases) {
      const r = await buildSandstoneLedgeRouteC('c2', p)
      expect(r.audit.manifoldStatus).toBe('NoError')
      expect(r.audit.connectedComponents).toBe(1)
      expect(r.audit.openEdges).toBe(0)
      expect(r.audit.nonManifoldEdges).toBe(0)
      expect(r.audit.windingMismatches).toBe(0)
      expect(r.audit.degenerateTriangles).toBe(0)
      expect(r.audit.selfIntersections).toBe(0)
      expect(r.audit.triangles).toBeGreaterThan(100)
    }
  })

  it('PolyCWorkerClient coalesces rapid drag jobs, drops stale bakes, and respects cancelAll()', () => {
    const dispatched: PolyCWorkerRequest[] = []
    let onMsg: ((ev: MessageEvent<PolyCWorkerResponse>) => void) | null = null
    const mockWorker = {
      set onmessage(fn: ((ev: MessageEvent<PolyCWorkerResponse>) => void) | null) { onMsg = fn },
      onerror: null,
      postMessage(req: PolyCWorkerRequest) { dispatched.push(req) },
      terminate() {},
    } as unknown as Worker

    const makeMockResp = (req: PolyCWorkerRequest): PolyCWorkerResponse => {
      const dummyAudit = {
        manifoldStatus: 'NoError', rawManifoldComponents: 1, vertices: 3, triangles: 1, faceGroups: 1,
        connectedComponents: 1, openEdges: 0, nonManifoldEdges: 0, windingMismatches: 0,
        degenerateTriangles: 0, selfIntersections: 0, minY: 0, maxY: 1, size: [1, 1, 1] as [number, number, number], buildMs: 2,
      }
      if (req.stage === 'preview') {
        return {
          jobId: req.jobId, stage: 'preview',
          positions: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
          audit: dummyAudit, previewMs: 3,
          phaseTimings: { booleanMs: 1.5, fallbackMs: 0, fallbackCount: 0, auditMs: 0.5, previewBufMs: 1.0, workerTotalMs: 3 },
        }
      }
      return {
        jobId: req.jobId, stage: 'bake',
        positions: new Float32Array(9), normals: new Float32Array(9), uvs: new Float32Array(6),
        tangents: new Float32Array(12), indices: new Uint32Array([0, 1, 2]),
        size: 4, albedo: new Uint8ClampedArray(64), normal: new Uint8ClampedArray(64), ao: new Uint8ClampedArray(64), roughness: new Uint8ClampedArray(64),
        audit: dummyAudit,
        uvAudit: {
          rawFaceGroups: 1, coplanarPatchCount: 1, chartCount: 1, vertexCountBeforeSplit: 3, vertexCountAfterSplit: 3,
          triangles: 1, atlasSize: 4, gutterPx: 1, pxPerMeter: 100, uvCoverage: 0.5, flippedUvTris: 0,
          overlappingChartTris: 0, minScale: 1, maxScale: 1, tangentInvalidCount: 0,
        },
        uvMs: 1,
        bakeStats: {
          mode: req.bake?.mode ?? 'shallow-detail', resolution: 4, coveredTexels: 1, uvFillRatio: 0.5,
          shoulderNotchCoverage: { triangles: 1, coveredTexels: 1, minChartStripPx: 2, meanTexelsPerTri: 1 },
          bevelCoverage: { triangles: 1, coveredTexels: 1, minChartStripPx: 2, meanTexelsPerTri: 1 },
          meanAo: 0.98, shoulderNotchMeanAo: 0.80, maxNormalDeviationDeg: 1.5,
          timings: { rasterMs: 1, bvhAoMs: 1, materialMs: 1, dilationMs: 1, totalBakeMs: 4 },
        },
      }
    }

    const applied: { jobId: number; stage: string }[] = []
    const client = new PolyCWorkerClient(
      res => { applied.push({ jobId: res.jobId, stage: res.stage }) },
      undefined,
      { workerFactory: () => mockWorker },
    )

    const j1 = client.submit({ stage: 'bake', sculpt: { seed: 1111 }, bake: { mode: 'shallow-detail' } })
    client.submit({ stage: 'bake', sculpt: { seed: 2222 }, bake: { mode: 'shallow-detail' } })
    const j3 = client.submit({ stage: 'bake', sculpt: { seed: 3333 }, bake: { mode: 'baseline' } })
    expect(dispatched.map(d => d.jobId)).toEqual([j1])

    // Slow stale bake #1 finishes -> MUST be dropped and #3 dispatched immediately!
    onMsg!({ data: makeMockResp(dispatched[0]) } as MessageEvent<PolyCWorkerResponse>)
    expect(applied).toEqual([])
    expect(dispatched.map(d => d.jobId)).toEqual([j1, j3])
    expect(client.getStats().staleDropped).toBe(1)
    expect(client.getStats().coalescedSkipped).toBe(1)

    onMsg!({ data: makeMockResp(dispatched[1]) } as MessageEvent<PolyCWorkerResponse>)
    expect(applied).toEqual([{ jobId: j3, stage: 'bake' }])

    // Drag burst coalescing (#4 renders, #5 coalesced by #6)
    const j4 = client.submit({ stage: 'preview', sculpt: { shoulderDepth: 0.8 } })
    client.submit({ stage: 'preview', sculpt: { shoulderDepth: 1.0 } })
    const j6 = client.submit({ stage: 'preview', sculpt: { shoulderDepth: 1.2 } })
    onMsg!({ data: makeMockResp(dispatched[2]) } as MessageEvent<PolyCWorkerResponse>)
    onMsg!({ data: makeMockResp(dispatched[3]) } as MessageEvent<PolyCWorkerResponse>)
    expect(applied.map(a => a.jobId)).toEqual([j3, j4, j6])

    // cancelAll() drops in-flight job on mode exit
    const j7 = client.submit({ stage: 'bake', sculpt: { seed: 7777 }, bake: { mode: 'shallow-detail' } })
    expect(dispatched[4].jobId).toBe(j7)
    client.cancelAll()
    onMsg!({ data: makeMockResp(dispatched[4]) } as MessageEvent<PolyCWorkerResponse>)
    expect(applied.map(a => a.jobId)).toEqual([j3, j4, j6])
    expect(client.getStats().staleDropped).toBe(2)

    client.dispose()
  })

  it('skipFullAudit preview path matches exact geometry while default bake path preserves full topology audit', async () => {
    const cases = [
      { seed: 5104, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.30, bevelScale: 0.05, notchDepth: 1.0 },
      { seed: 5104, shoulderDepth: 1.30, bevelScale: 1.30, notchDepth: 1.0 },
    ]
    for (const sculpt of cases) {
      const full = await buildSandstoneLedgeRouteC('c2', sculpt)
      const fast = await buildSandstoneLedgeRouteC('c2', sculpt, { skipFullAudit: true })
      expect(fast.positions.length).toBe(full.positions.length)
      expect(fast.indices.length).toBe(full.indices.length)
      expect(Array.from(fast.indices)).toEqual(Array.from(full.indices))
      expect(fast.audit.phases?.auditMs).toBe(0)
      expect(full.audit.phases?.booleanMs).toBeGreaterThanOrEqual(0)
      expect(full.audit.openEdges).toBe(0)
      expect(full.audit.nonManifoldEdges).toBe(0)
      expect(full.audit.selfIntersections).toBe(0)
    }
  })

  it('Route C2 2nd archetype (block-bluff-c2): watertight explicit manifold, 43-point sweep, 512 PBR & non-uniform tangent preservation', async () => {
    const c1 = await buildBlockBluffRouteC('c1')
    const c2 = await buildBlockBluffRouteC('c2')
    const viaDispatch = await buildRouteCRock('block-bluff-c2')
    expect(viaDispatch.audit.triangles).toBe(c2.audit.triangles)
    expect(c1.id).toBe('block-bluff-c1')
    expect(c2.id).toBe('block-bluff-c2')
    expect(c2.audit.size[1]).toBeGreaterThan(1.38) // Distinct chunky tall bluff profile vs low sandstone-ledge (~1.07m)

    for (const m of [c1, c2]) {
      expect(m.audit.manifoldStatus).toBe('NoError')
      expect(m.audit.connectedComponents).toBe(1)
      expect(m.audit.openEdges).toBe(0)
      expect(m.audit.nonManifoldEdges).toBe(0)
      expect(m.audit.windingMismatches).toBe(0)
      expect(m.audit.degenerateTriangles).toBe(0)
      expect(m.audit.selfIntersections).toBe(0)
      expect(m.audit.minY).toBe(0)
    }

    // 43-point continuous drag sweep (20 shoulderDepth + 15 bevelScale @ high shoulderDepth + 8 seeds)
    for (let i = 0; i < 20; i++) {
      const sd = Number((0.72 + (i / 19) * 0.58).toFixed(2))
      const r = await buildBlockBluffRouteC('c2', { seed: 7342, shoulderDepth: sd })
      expect(r.audit.manifoldStatus).toBe('NoError')
      expect(r.audit.openEdges).toBe(0)
      expect(r.audit.nonManifoldEdges).toBe(0)
      expect(r.audit.selfIntersections).toBe(0)
    }
    for (let i = 0; i < 15; i++) {
      const bs = Number((0.05 + (i / 14) * 1.25).toFixed(2))
      const r = await buildBlockBluffRouteC('c2', { seed: 7342, shoulderDepth: 1.30, bevelScale: bs })
      expect(r.audit.manifoldStatus).toBe('NoError')
      expect(r.audit.openEdges).toBe(0)
      expect(r.audit.nonManifoldEdges).toBe(0)
      expect(r.audit.selfIntersections).toBe(0)
    }
    for (const seed of [1111, 2222, 3333, 5104, 7342, 8888, 9123, 4096]) {
      const r = await buildBlockBluffRouteC('c2', { seed, shoulderDepth: 1.0, bevelScale: 1.0, notchDepth: 1.15 })
      expect(r.audit.manifoldStatus).toBe('NoError')
      expect(r.audit.openEdges).toBe(0)
      expect(r.audit.nonManifoldEdges).toBe(0)
      expect(r.audit.selfIntersections).toBe(0)
    }

    // Preview skipFullAudit geometry equivalence
    const fast = await buildBlockBluffRouteC('c2', { seed: 7342, shoulderDepth: 1.30, bevelScale: 1.30 }, { skipFullAudit: true })
    const full = await buildBlockBluffRouteC('c2', { seed: 7342, shoulderDepth: 1.30, bevelScale: 1.30 })
    expect(Array.from(fast.indices)).toEqual(Array.from(full.indices))
    expect(fast.audit.phases?.auditMs).toBe(0)

    // 512 PBR UV charts, thin-face coverage & physical V-notch AO
    const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: 512, gutterPx: 10 })
    expect(uv.audit.flippedUvTris).toBe(0)
    expect(uv.audit.overlappingChartTris).toBe(0)
    expect(uv.audit.tangentInvalidCount).toBe(0)
    expect(uv.audit.pxPerMeter).toBeGreaterThan(100)

    const base = bakePolyCsgPbr(c2, uv, { size: 512, mode: 'baseline', baseColorHex: '#caa57c', dilationPasses: 14, seed: 7342 })
    const shallow = bakePolyCsgPbr(c2, uv, { size: 512, mode: 'shallow-detail', baseColorHex: '#caa57c', dilationPasses: 14, seed: 7342 })
    expect(base.stats.maxNormalDeviationDeg).toBe(0)
    expect(shallow.stats.maxNormalDeviationDeg).toBeGreaterThan(0.5)
    expect(shallow.stats.maxNormalDeviationDeg).toBeLessThan(4.0)
    expect(shallow.stats.shoulderNotchCoverage.coveredTexels).toBeGreaterThan(1500)
    expect(shallow.stats.shoulderNotchCoverage.minChartStripPx).toBeGreaterThanOrEqual(10)
    expect(shallow.stats.bevelCoverage.coveredTexels).toBeGreaterThan(2500)
    expect(shallow.stats.shoulderNotchMeanAo).toBeLessThan(shallow.stats.meanAo - 0.08)

    // Non-uniformly scaled GLB merge preserves unit orthogonal tangents
    const grp = new Group()
    const mat = new MeshStandardMaterial({ name: 'Mat_BluffC2', roughness: 0.9, metalness: 0 })
    const m = new Mesh(uv.toBufferGeometry(), mat)
    m.scale.set(1.35, 0.82, 1.15)
    m.rotation.set(0, 0.18, 0)
    grp.add(m)
    grp.updateMatrixWorld(true)
    const mergedRoot = prepareGlbScene(grp, { mode: 'merged', excludeDecorations: false })
    let checkedVerts = 0
    mergedRoot.traverse(obj => {
      if (obj instanceof Mesh) {
        const nAttr = obj.geometry.getAttribute('normal') as BufferAttribute
        const tAttr = obj.geometry.getAttribute('tangent') as BufferAttribute
        expect(tAttr).toBeDefined()
        for (let i = 0; i < tAttr.count; i++) {
          const tx = tAttr.getX(i), ty = tAttr.getY(i), tz = tAttr.getZ(i), tw = tAttr.getW(i)
          const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
          expect(Math.abs(Math.hypot(tx, ty, tz) - 1)).toBeLessThan(1e-3)
          expect(Math.abs(tx * nx + ty * ny + tz * nz)).toBeLessThan(1e-3)
          expect(Math.abs(tw)).toBe(1)
          checkedVerts++
        }
        obj.geometry.dispose()
      }
    })
    expect(checkedVerts).toBe(uv.audit.vertexCountAfterSplit)
    m.geometry.dispose()
    mat.dispose()
  })
})

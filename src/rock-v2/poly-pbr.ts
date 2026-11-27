import { BufferAttribute, BufferGeometry } from 'three'
import { dilatePerChart } from './bake'
import {
  sampleTopPlanarPbr,
  sampleTriplanarPbr,
  type ExternalPbrLayers,
} from './photocraft-sampler'
import type { PolyCsgResult } from './poly-csg'
import { fbm2, fbm3, type Vec3 } from './sdf'
import { computeLockedTangents, type UvChartInfo } from './uv-charts'

export type PolyPbrMode = 'baseline' | 'shallow-detail' | 'photocraft-pbr'

export interface PolyCreaseEdge {
  ax: number; ay: number; az: number
  bx: number; by: number; bz: number
  dihedralDeg: number
  isConvex: boolean
  isShoulderNotch: boolean
}

export interface PolyRegionCoverageAudit {
  triangles: number
  coveredTexels: number
  minChartStripPx: number
  meanTexelsPerTri: number
}

export interface PolyUvAudit {
  rawFaceGroups: number
  coplanarPatchCount: number
  chartCount: number
  vertexCountBeforeSplit: number
  vertexCountAfterSplit: number
  triangles: number
  atlasSize: number
  gutterPx: number
  pxPerMeter: number
  uvCoverage: number
  flippedUvTris: number
  overlappingChartTris: number
  minScale: number
  maxScale: number
  tangentInvalidCount: number
}

export interface UnwrappedPolyCsgMesh {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  tangents: Float32Array
  indices: Uint32Array
  /** Source PolyCsg faceID per triangle (length = triangles). */
  faceIds: Uint32Array
  /** Geometric triangle unit normal per triangle (length = triangles * 3). */
  faceNormals: Float32Array
  /** UV chart ID per triangle (length = triangles). */
  triChartIds: Int32Array
  charts: UvChartInfo[]
  /** Hard geometric crease edges (dihedral > creaseAngleDeg) with convex/concave classification. */
  hardCreaseEdges: PolyCreaseEdge[]
  audit: PolyUvAudit
  uvMs: number
  toBufferGeometry(): BufferGeometry
}

export interface BakePolyPbrOptions {
  size?: number
  mode: PolyPbrMode
  baseColorHex?: string
  dilationPasses?: number
  aoRays?: number
  seed?: number
  /** Shallow in-face strata intensity in 'shallow-detail' mode (default 1.0, range 0..1.5). */
  strataStrength?: number
  /** Stylized flat-terrace inset moss blanket with beveled sandstone rim protection (auto-on for terraced-moss-bluff). */
  mossTop?: boolean
  /** Primary moss hex color when mossTop is enabled (default '#76b82c'). */
  mossColorHex?: string
  /** Seamless PhotoCraft Material Studio PBR texture sets (stone + optional moss) used when mode === 'photocraft-pbr'. */
  externalPbr?: ExternalPbrLayers
  /** World-space triplanar repeat scale for external PhotoCraft PBR maps (default 0.92). */
  pbrScale?: number
}

export interface PolyBakeStats {
  mode: PolyPbrMode
  resolution: number
  coveredTexels: number
  uvFillRatio: number
  shoulderNotchCoverage: PolyRegionCoverageAudit
  bevelCoverage: PolyRegionCoverageAudit
  meanAo: number
  shoulderNotchMeanAo: number
  maxNormalDeviationDeg: number
  timings: {
    rasterMs: number
    bvhAoMs: number
    materialMs: number
    dilationMs: number
    totalBakeMs: number
  }
}

export interface PolyBakedPbrTextures {
  size: number
  albedo: Uint8ClampedArray
  normal: Uint8ClampedArray
  ao: Uint8ClampedArray
  /** Linear roughness RGBA buffer (0..255) for MeshStandardMaterial.roughnessMap & glTF metallicRoughnessTexture. */
  roughness: Uint8ClampedArray
  /** Diagnostic atlas: Blue=wide interior detail allowed, Amber=edge-protected band, Green=shoulder V-notch, Cyan=local bevels. */
  diagnostic: Uint8ClampedArray
  /** 512x512 UV chart color-block map (distinct pastel per merged chart, crisp outline borders). */
  uvChartMap: Uint8ClampedArray
  stats: PolyBakeStats
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function norm3(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z)
  return l > 1e-10 ? { x: x / l, y: y / l, z: z / l } : { x: 0, y: 1, z: 0 }
}

function parseHexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [202, 165, 124]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function makeBasis(axis: Vec3, rotRad = 0): { uDir: Vec3; vDir: Vec3 } {
  const ref: Vec3 = Math.abs(axis.y) < 0.88 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  const u0 = norm3(
    ref.y * axis.z - ref.z * axis.y,
    ref.z * axis.x - ref.x * axis.z,
    ref.x * axis.y - ref.y * axis.x,
  )
  const v0: Vec3 = {
    x: axis.y * u0.z - axis.z * u0.y,
    y: axis.z * u0.x - axis.x * u0.z,
    z: axis.x * u0.y - axis.y * u0.x,
  }
  if (Math.abs(rotRad) < 1e-7) return { uDir: u0, vDir: v0 }
  const c = Math.cos(rotRad), s = Math.sin(rotRad)
  return {
    uDir: { x: u0.x * c + v0.x * s, y: u0.y * c + v0.y * s, z: u0.z * c + v0.z * s },
    vDir: { x: -u0.x * s + v0.x * c, y: -u0.y * s + v0.y * c, z: -u0.z * s + v0.z * c },
  }
}

function triArea2D(u0: number, v0: number, u1: number, v1: number, u2: number, v2: number): number {
  return 0.5 * ((u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0))
}

function trisOverlap2D(
  tA: [number, number, number, number, number, number],
  tB: [number, number, number, number, number, number],
  eps = 1e-6,
): boolean {
  const minAx = Math.min(tA[0], tA[2], tA[4]), maxAx = Math.max(tA[0], tA[2], tA[4])
  const minBx = Math.min(tB[0], tB[2], tB[4]), maxBx = Math.max(tB[0], tB[2], tB[4])
  if (maxAx <= minBx + eps || maxBx <= minAx + eps) return false
  const minAy = Math.min(tA[1], tA[3], tA[5]), maxAy = Math.max(tA[1], tA[3], tA[5])
  const minBy = Math.min(tB[1], tB[3], tB[5]), maxBy = Math.max(tB[1], tB[3], tB[5])
  if (maxAy <= minBy + eps || maxBy <= minAy + eps) return false

  // Exact 2D Separating Axis Theorem (strict interior overlap test — shared boundary edges never false-positive!)
  const polyA: [number, number][] = [[tA[0], tA[1]], [tA[2], tA[3]], [tA[4], tA[5]]]
  const polyB: [number, number][] = [[tB[0], tB[1]], [tB[2], tB[3]], [tB[4], tB[5]]]
  const separated = (poly: [number, number][]): boolean => {
    for (let i = 0; i < 3; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % 3]
      const ex = p1[0] - p0[0], ey = p1[1] - p0[1]
      const len = Math.hypot(ex, ey)
      if (len < 1e-10) continue
      const nx = -ey / len, ny = ex / len
      let minA = Infinity, maxA = -Infinity
      for (const p of polyA) {
        const d = p[0] * nx + p[1] * ny
        if (d < minA) minA = d
        if (d > maxA) maxA = d
      }
      let minB = Infinity, maxB = -Infinity
      for (const p of polyB) {
        const d = p[0] * nx + p[1] * ny
        if (d < minB) minB = d
        if (d > maxB) maxB = d
      }
      if (maxA <= minB + eps || maxB <= minA + eps) return true
    }
    return false
  }
  return !separated(polyA) && !separated(polyB)
}

function isShoulderNotchFace(faceId: number): boolean {
  return faceId >= 60 && faceId <= 69
}

function isLocalBevelFace(faceId: number): boolean {
  return faceId >= 110 && faceId <= 149
}

// ---------------------------------------------------------------------------
// 1. FaceID + Crease-Aware Explicit Surface UV Unwrapper
// ---------------------------------------------------------------------------
export function unwrapPolyCsgUvCharts(
  mesh: PolyCsgResult,
  opts?: {
    atlasSize?: number
    gutterPx?: number
    /** Dihedral threshold for splitting hard UV seams (default 34°). */
    mergeCreaseDeg?: number
    /** Shading crease angle for split vertex normals (default 24°). */
    shadingCreaseDeg?: number
  },
): UnwrappedPolyCsgMesh {
  const t0 = performance.now()
  const atlasSize = opts?.atlasSize ?? 512
  const gutterPx = opts?.gutterPx ?? 12
  const mergeCreaseDeg = opts?.mergeCreaseDeg ?? 34
  const shadingCreaseDeg = opts?.shadingCreaseDeg ?? 24

  const { positions, indices, faceIds } = mesh
  const vCountOrig = positions.length / 3
  const tCount = indices.length / 3

  const faceNormalsVec: Vec3[] = new Array(tCount)
  const faceNormalsFlat = new Float32Array(tCount * 3)
  const faceAreas = new Float32Array(tCount)
  const faceCentroids: Vec3[] = new Array(tCount)
  const rawFaceSet = new Set<number>()

  interface EdgeRec {
    u: number
    v: number
    tris: number[]
  }
  const edgeMap = new Map<string, EdgeRec>()

  for (let t = 0; t < tCount; t++) {
    rawFaceSet.add(faceIds[t])
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const len = Math.hypot(nx, ny, nz)
    faceAreas[t] = 0.5 * len
    const fn = len > 1e-10 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 1, z: 0 }
    faceNormalsVec[t] = fn
    faceNormalsFlat[t * 3] = fn.x; faceNormalsFlat[t * 3 + 1] = fn.y; faceNormalsFlat[t * 3 + 2] = fn.z
    faceCentroids[t] = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3, z: (az + bz + cz) / 3 }

    const edges: [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [u, v] of edges) {
      const lo = u < v ? u : v
      const hi = u < v ? v : u
      const key = `${lo}:${hi}`
      let rec = edgeMap.get(key)
      if (!rec) { rec = { u: lo, v: hi, tris: [] }; edgeMap.set(key, rec) }
      rec.tris.push(t)
    }
  }

  // Classify every undirected manifold edge by faceID, dihedral angle & convexity
  interface AdjacencyEdge {
    tA: number
    tB: number
    dihedralDeg: number
    sharedLen: number
    sameFace: boolean
    isConvex: boolean
  }
  const adjEdges: AdjacencyEdge[] = []
  const coplanarAdj: number[][] = Array.from({ length: tCount }, () => [])
  const hardCreaseEdges: PolyCreaseEdge[] = []

  for (const rec of edgeMap.values()) {
    if (rec.tris.length !== 2) continue
    const [tA, tB] = rec.tris
    const nA = faceNormalsVec[tA], nB = faceNormalsVec[tB]
    const dotN = clamp(nA.x * nB.x + nA.y * nB.y + nA.z * nB.z, -1, 1)
    const dihedralDeg = (Math.acos(dotN) * 180) / Math.PI
    const ax = positions[rec.u * 3], ay = positions[rec.u * 3 + 1], az = positions[rec.u * 3 + 2]
    const bx = positions[rec.v * 3], by = positions[rec.v * 3 + 1], bz = positions[rec.v * 3 + 2]
    const sharedLen = Math.hypot(bx - ax, by - ay, bz - az)
    const sameFace = faceIds[tA] === faceIds[tB]

    const cA = faceCentroids[tA], cB = faceCentroids[tB]
    const dcx = cB.x - cA.x, dcy = cB.y - cA.y, dcz = cB.z - cA.z
    // If centroid B lies behind plane A (dot(nA, cB - cA) < 0), the fold bends away -> convex ridge!
    const isConvex = (nA.x * dcx + nA.y * dcy + nA.z * dcz) < 0

    adjEdges.push({ tA, tB, dihedralDeg, sharedLen, sameFace, isConvex })
    if (sameFace || dihedralDeg < 5.0) {
      coplanarAdj[tA].push(tB)
      coplanarAdj[tB].push(tA)
    }
    if (dihedralDeg > 20.0 && sharedLen > 1e-4) {
      hardCreaseEdges.push({
        ax, ay, az, bx, by, bz,
        dihedralDeg,
        isConvex,
        isShoulderNotch: isShoulderNotchFace(faceIds[tA]) || isShoulderNotchFace(faceIds[tB]),
      })
    }
  }

  // Phase A: Build strictly connected coplanar surface patches
  const patchOfTri = new Int32Array(tCount).fill(-1)
  interface Patch {
    id: number
    tris: number[]
    area: number
    avgNormal: Vec3
  }
  const patches: Patch[] = []
  for (let t = 0; t < tCount; t++) {
    if (patchOfTri[t] !== -1) continue
    const pid = patches.length
    const tris: number[] = []
    const q = [t]
    patchOfTri[t] = pid
    let sumArea = 0, nx = 0, ny = 0, nz = 0
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]
      tris.push(cur)
      const a = faceAreas[cur]
      sumArea += a
      nx += faceNormalsVec[cur].x * a
      ny += faceNormalsVec[cur].y * a
      nz += faceNormalsVec[cur].z * a
      for (const nb of coplanarAdj[cur]) {
        if (patchOfTri[nb] === -1) { patchOfTri[nb] = pid; q.push(nb) }
      }
    }
    patches.push({ id: pid, tris, area: sumArea, avgNormal: norm3(nx, ny, nz) })
  }
  const coplanarPatchCount = patches.length

  // Helper: test whether a set of triangles projects cleanly onto `axis` with zero flips, bounded stretch & zero 2D overlap
  const validatePatchProjection = (
    tris: number[],
    axis: Vec3,
    minDot: number,
  ): { ok: boolean; uDir: Vec3; vDir: Vec3; proj: Map<number, [number, number, number, number, number, number]> } => {
    const { uDir, vDir } = makeBasis(axis)
    const proj = new Map<number, [number, number, number, number, number, number]>()
    const projList: [number, number, number, number, number, number][] = []
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i]
      const fn = faceNormalsVec[t]
      if (fn.x * axis.x + fn.y * axis.y + fn.z * axis.z < minDot) return { ok: false, uDir, vDir, proj }
      const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
      const p2: [number, number, number, number, number, number] = [
        positions[a] * uDir.x + positions[a + 1] * uDir.y + positions[a + 2] * uDir.z,
        positions[a] * vDir.x + positions[a + 1] * vDir.y + positions[a + 2] * vDir.z,
        positions[b] * uDir.x + positions[b + 1] * uDir.y + positions[b + 2] * uDir.z,
        positions[b] * vDir.x + positions[b + 1] * vDir.y + positions[b + 2] * vDir.z,
        positions[c] * uDir.x + positions[c + 1] * uDir.y + positions[c + 2] * uDir.z,
        positions[c] * vDir.x + positions[c + 1] * vDir.y + positions[c + 2] * vDir.z,
      ]
      const a2 = triArea2D(p2[0], p2[1], p2[2], p2[3], p2[4], p2[5])
      if (a2 <= Math.max(1e-9, faceAreas[t] * 0.42)) return { ok: false, uDir, vDir, proj }
      for (let j = 0; j < projList.length; j++) {
        if (trisOverlap2D(p2, projList[j])) return { ok: false, uDir, vDir, proj }
      }
      proj.set(t, p2)
      projList.push(p2)
    }
    return { ok: true, uDir, vDir, proj }
  }

  // Phase B: Merge adjacent patches ONLY across gentle folds (never across hard creases > mergeCreaseDeg,
  // and never merging shoulder V-notch walls into outer faces so notch seams stay crystal crisp!).
  const activePatchOfTri = new Int32Array(patchOfTri)
  const activePatches = new Map<number, Patch>()
  for (const p of patches) activePatches.set(p.id, { ...p, tris: [...p.tris] })

  const tryMergePass = (maxAngleDeg: number, onlyTinyMaxArea: number, minAxisDot: number) => {
    let mergedAny = true
    while (mergedAny) {
      mergedAny = false
      // Build patch-pair candidates sorted by smallest dihedral angle, then longest shared edge
      const pairBest = new Map<string, { pA: number; pB: number; angle: number; len: number }>()
      for (const e of adjEdges) {
        if (e.dihedralDeg > maxAngleDeg) continue
        const pA = activePatchOfTri[e.tA], pB = activePatchOfTri[e.tB]
        if (pA === pB) continue
        // Never merge shoulder V-notch interior walls with outside rock faces!
        if (isShoulderNotchFace(faceIds[e.tA]) !== isShoulderNotchFace(faceIds[e.tB])) continue
        const patchA = activePatches.get(pA)!, patchB = activePatches.get(pB)!
        if (onlyTinyMaxArea > 0 && Math.min(patchA.area, patchB.area) > onlyTinyMaxArea) continue
        const lo = pA < pB ? pA : pB, hi = pA < pB ? pB : pA
        const key = `${lo}:${hi}`
        const prev = pairBest.get(key)
        if (!prev || e.dihedralDeg < prev.angle || (Math.abs(e.dihedralDeg - prev.angle) < 0.5 && e.sharedLen > prev.len)) {
          pairBest.set(key, { pA: lo, pB: hi, angle: e.dihedralDeg, len: e.sharedLen })
        }
      }
      const candidates = [...pairBest.values()].sort((a, b) => a.angle - b.angle || b.len - a.len)
      for (const cand of candidates) {
        const patchA = activePatches.get(cand.pA)
        const patchB = activePatches.get(cand.pB)
        if (!patchA || !patchB) continue
        const combinedTris = [...patchA.tris, ...patchB.tris]
        let nx = 0, ny = 0, nz = 0
        for (const t of combinedTris) {
          const a = faceAreas[t]
          nx += faceNormalsVec[t].x * a; ny += faceNormalsVec[t].y * a; nz += faceNormalsVec[t].z * a
        }
        const combinedAxis = norm3(nx, ny, nz)
        const check = validatePatchProjection(combinedTris, combinedAxis, minAxisDot)
        if (!check.ok) continue
        // Commit merge B -> A
        patchA.tris = combinedTris
        patchA.area += patchB.area
        patchA.avgNormal = combinedAxis
        for (const t of patchB.tris) activePatchOfTri[t] = patchA.id
        activePatches.delete(patchB.id)
        mergedAny = true
        break
      }
    }
  }

  // Pass 1: Merge gentle-angle adjacent bevels & near-coplanar facets (<= mergeCreaseDeg)
  tryMergePass(mergeCreaseDeg, 0, Math.cos((46 * Math.PI) / 180))
  // Pass 2: Absorb narrow/thin local bevel strips & bevel-tip slivers (< 0.030 m²) into their gentlest
  //         adjacent non-notch neighbor (<= 45°) ONLY when strictly flip-free & zero 2D UV overlap!
  //         Eliminates 4px hairline UV needles and removes unnecessary UV seams along bevel tips!
  tryMergePass(45, 0.030, Math.cos((54 * Math.PI) / 180))

  // Phase C: Build final charts, rotating each chart to its minimum-area axis-aligned bounding box!
  //          This aligns thin bevel strips & shoulder V-notch walls parallel to pixel rows/columns (zero diagonal stair-stepping!).
  interface FinalChart {
    id: number
    tris: number[]
    axis: Vec3
    uDir: Vec3
    vDir: Vec3
    proj2D: Map<number, [number, number, number, number, number, number]>
    minU: number; maxU: number
    minV: number; maxV: number
  }
  const finalCharts: FinalChart[] = []
  const triChartIds = new Int32Array(tCount)

  for (const patch of activePatches.values()) {
    const cid = finalCharts.length
    let bestAngle = 0
    let bestScore = Infinity
    let bestProj = new Map<number, [number, number, number, number, number, number]>()
    let bestU = makeBasis(patch.avgNormal).uDir
    let bestV = makeBasis(patch.avgNormal).vDir
    let bMinU = 0, bMaxU = 0, bMinV = 0, bMaxV = 0

    for (let step = 0; step < 18; step++) {
      const ang = (step * Math.PI) / 18
      const { uDir, vDir } = makeBasis(patch.avgNormal, ang)
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity
      const proj = new Map<number, [number, number, number, number, number, number]>()
      for (const t of patch.tris) {
        const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
        const p2: [number, number, number, number, number, number] = [
          positions[a] * uDir.x + positions[a + 1] * uDir.y + positions[a + 2] * uDir.z,
          positions[a] * vDir.x + positions[a + 1] * vDir.y + positions[a + 2] * vDir.z,
          positions[b] * uDir.x + positions[b + 1] * uDir.y + positions[b + 2] * uDir.z,
          positions[b] * vDir.x + positions[b + 1] * vDir.y + positions[b + 2] * vDir.z,
          positions[c] * uDir.x + positions[c + 1] * uDir.y + positions[c + 2] * uDir.z,
          positions[c] * vDir.x + positions[c + 1] * vDir.y + positions[c + 2] * vDir.z,
        ]
        proj.set(t, p2)
        for (let k = 0; k < 3; k++) {
          const u = p2[k * 2], v = p2[k * 2 + 1]
          if (u < minU) minU = u; if (u > maxU) maxU = u
          if (v < minV) minV = v; if (v > maxV) maxV = v
        }
      }
      const w = maxU - minU, h = maxV - minV
      // Prefer compact bounding box oriented wider than tall for tighter shelf packing
      const score = w * h + (h > w ? 0.002 * (h - w) : 0)
      if (score < bestScore) {
        bestScore = score
        bestAngle = ang
        bestProj = proj
        bestU = uDir; bestV = vDir
        bMinU = minU; bMaxU = maxU; bMinV = minV; bMaxV = maxV
      }
    }
    void bestAngle
    for (const t of patch.tris) triChartIds[t] = cid
    finalCharts.push({
      id: cid,
      tris: patch.tris,
      axis: patch.avgNormal,
      uDir: bestU,
      vDir: bestV,
      proj2D: bestProj,
      minU: bMinU, maxU: bMaxU,
      minV: bMinV, maxV: bMaxV,
    })
  }

  // Phase D: Uniform texel-density MaxRects (Best-Short-Side-Fit) packing with 90° rotation & mip-safe gutterPx!
  const sortedCharts = [...finalCharts].sort((a, b) => {
    const areaA = (a.maxU - a.minU) * (a.maxV - a.minV)
    const areaB = (b.maxU - b.minU) * (b.maxV - b.minV)
    return areaB - areaA
  })

  interface PackPlacement {
    x: number
    y: number
    w: number
    h: number
    rotated: boolean
  }

  const tryPackMaxRects = (scalePxPerM: number): { ok: boolean; rects: Map<number, PackPlacement> } => {
    const rects = new Map<number, PackPlacement>()
    const pad = gutterPx
    const free: { x: number; y: number; w: number; h: number }[] = [
      { x: pad, y: pad, w: atlasSize - pad * 2, h: atlasSize - pad * 2 },
    ]

    for (const ch of sortedCharts) {
      const rw = Math.max(4, Math.ceil((ch.maxU - ch.minU) * scalePxPerM))
      const rh = Math.max(4, Math.ceil((ch.maxV - ch.minV) * scalePxPerM))
      // Include trailing gutter inside the allocated slot so every pair of charts has >= gutterPx separation!
      const needW0 = rw + pad, needH0 = rh + pad
      const needW1 = rh + pad, needH1 = rw + pad

      let bestIdx = -1
      let bestShort = Infinity
      let bestLong = Infinity
      let bestRot = false
      let bestX = 0, bestY = 0, bestW = 0, bestH = 0

      for (let fi = 0; fi < free.length; fi++) {
        const fr = free[fi]
        // Try unrotated
        if (rw <= fr.w && rh <= fr.h) {
          const leftW = fr.w - rw, leftH = fr.h - rh
          const shortSide = Math.min(leftW, leftH)
          const longSide = Math.max(leftW, leftH)
          if (shortSide < bestShort || (shortSide === bestShort && longSide < bestLong)) {
            bestIdx = fi; bestShort = shortSide; bestLong = longSide; bestRot = false
            bestX = fr.x; bestY = fr.y; bestW = Math.min(fr.w, needW0); bestH = Math.min(fr.h, needH0)
          }
        }
        // Try 90° rotated
        if (rh <= fr.w && rw <= fr.h) {
          const leftW = fr.w - rh, leftH = fr.h - rw
          const shortSide = Math.min(leftW, leftH)
          const longSide = Math.max(leftW, leftH)
          if (shortSide < bestShort || (shortSide === bestShort && longSide < bestLong)) {
            bestIdx = fi; bestShort = shortSide; bestLong = longSide; bestRot = true
            bestX = fr.x; bestY = fr.y; bestW = Math.min(fr.w, needW1); bestH = Math.min(fr.h, needH1)
          }
        }
      }
      if (bestIdx < 0) return { ok: false, rects }

      const usedW = bestRot ? rh : rw
      const usedH = bestRot ? rw : rh
      rects.set(ch.id, { x: bestX, y: bestY, w: usedW, h: usedH, rotated: bestRot })

      // Split every free rect overlapping the placed slot (with gutter padding!)
      const px0 = bestX, py0 = bestY, px1 = bestX + bestW, py1 = bestY + bestH
      const nextFree: { x: number; y: number; w: number; h: number }[] = []
      for (let fi = 0; fi < free.length; fi++) {
        const fr = free[fi]
        const fx0 = fr.x, fy0 = fr.y, fx1 = fr.x + fr.w, fy1 = fr.y + fr.h
        if (px0 >= fx1 || px1 <= fx0 || py0 >= fy1 || py1 <= fy0) {
          nextFree.push(fr)
          continue
        }
        if (px0 > fx0) nextFree.push({ x: fx0, y: fy0, w: px0 - fx0, h: fr.h })
        if (px1 < fx1) nextFree.push({ x: px1, y: fy0, w: fx1 - px1, h: fr.h })
        if (py0 > fy0) nextFree.push({ x: fx0, y: fy0, w: fr.w, h: py0 - fy0 })
        if (py1 < fy1) nextFree.push({ x: fx0, y: py1, w: fr.w, h: fy1 - py1 })
      }
      // Prune fully contained free rects
      free.length = 0
      for (let i = 0; i < nextFree.length; i++) {
        const a = nextFree[i]
        let contained = false
        for (let j = 0; j < nextFree.length; j++) {
          if (i === j) continue
          const b = nextFree[j]
          if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
            contained = true
            break
          }
        }
        if (!contained && a.w >= 4 && a.h >= 4) free.push(a)
      }
    }
    return { ok: true, rects }
  }

  let lo = 10, hi = atlasSize * 1.5
  let loPack = tryPackMaxRects(lo)
  if (!loPack.ok) {
    lo = 2
    loPack = tryPackMaxRects(lo)
  }
  let bestScale = lo
  let bestRects = loPack.rects
  for (let iter = 0; iter < 20; iter++) {
    const mid = 0.5 * (lo + hi)
    const r = tryPackMaxRects(mid)
    if (r.ok) { bestScale = mid; bestRects = r.rects; lo = mid }
    else hi = mid
  }

  // Phase E: Compute crease-aware vertex normals strictly within each chart (flat on hard creases, smooth across gentle bevels!)
  const vertTris: number[][] = Array.from({ length: vCountOrig }, () => [])
  for (let t = 0; t < tCount; t++) {
    vertTris[indices[t * 3]].push(t)
    vertTris[indices[t * 3 + 1]].push(t)
    vertTris[indices[t * 3 + 2]].push(t)
  }
  const cosShadingCrease = Math.cos((shadingCreaseDeg * Math.PI) / 180)

  const outPos: number[] = []
  const outNorm: number[] = []
  const outUv: number[] = []
  const outIndices = new Uint32Array(tCount * 3)
  const vertexMap = new Map<string, number>()

  let flippedUvTris = 0
  let totalUvArea = 0
  let minScale = Infinity
  let maxScale = 0

  for (let t = 0; t < tCount; t++) {
    const cid = triChartIds[t]
    const ch = finalCharts[cid]
    const rect = bestRects.get(cid)!
    const p2 = ch.proj2D.get(t)!
    const fn = faceNormalsVec[t]
    const uvTri: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]

    for (let k = 0; k < 3; k++) {
      const origVi = indices[t * 3 + k]
      const lu = (p2[k * 2] - ch.minU) * bestScale
      const lv = (p2[k * 2 + 1] - ch.minV) * bestScale
      // Preserve strict positive 2D orientation when 90° rotated: (u', v') = (rect.w - lv, lu) has det = +1!
      const u = rect.rotated
        ? (rect.x + Math.max(0, rect.w - lv)) / atlasSize
        : (rect.x + lu) / atlasSize
      const v = rect.rotated
        ? (rect.y + lu) / atlasSize
        : (rect.y + lv) / atlasSize
      uvTri[k * 2] = u; uvTri[k * 2 + 1] = v

      // Crease-aware shading normal computed strictly from same-chart or gentle-crease neighbors!
      let snx = 0, sny = 0, snz = 0
      for (const nt of vertTris[origVi]) {
        const ntn = faceNormalsVec[nt]
        if (fn.x * ntn.x + fn.y * ntn.y + fn.z * ntn.z >= cosShadingCrease) {
          const w = faceAreas[nt]
          snx += ntn.x * w; sny += ntn.y * w; snz += ntn.z * w
        }
      }
      const sn = norm3(snx, sny, snz)
      // Quantize normal in vertex key so hard creases split cleanly while smooth bevel vertices weld inside the chart!
      const nKey = `${Math.round(sn.x * 100)},${Math.round(sn.y * 100)},${Math.round(sn.z * 100)}`
      const vKey = `${origVi}:${cid}:${nKey}`
      let newVi = vertexMap.get(vKey)
      if (newVi === undefined) {
        newVi = outPos.length / 3
        vertexMap.set(vKey, newVi)
        outPos.push(positions[origVi * 3], positions[origVi * 3 + 1], positions[origVi * 3 + 2])
        outNorm.push(sn.x, sn.y, sn.z)
        outUv.push(u, v)
      }
      outIndices[t * 3 + k] = newVi
    }

    const aUv = triArea2D(uvTri[0], uvTri[1], uvTri[2], uvTri[3], uvTri[4], uvTri[5])
    if (aUv <= 0) flippedUvTris++
    totalUvArea += Math.abs(aUv)
    if (faceAreas[t] > 1e-8) {
      const ratio = Math.sqrt(Math.abs(aUv) / faceAreas[t])
      if (ratio < minScale) minScale = ratio
      if (ratio > maxScale) maxScale = ratio
    }
  }

  // Independent final 2D UV overlap audit across ALL triangles in the packed atlas
  let overlappingChartTris = 0
  const allUvTris: [number, number, number, number, number, number][] = new Array(tCount)
  for (let t = 0; t < tCount; t++) {
    const a = outIndices[t * 3] * 2, b = outIndices[t * 3 + 1] * 2, c = outIndices[t * 3 + 2] * 2
    allUvTris[t] = [outUv[a], outUv[a + 1], outUv[b], outUv[b + 1], outUv[c], outUv[c + 1]]
  }
  for (let i = 0; i < tCount; i++) {
    for (let j = i + 1; j < tCount; j++) {
      if (trisOverlap2D(allUvTris[i], allUvTris[j], 1e-5)) overlappingChartTris++
    }
  }

  const finalPos = Float32Array.from(outPos)
  const finalNorm = Float32Array.from(outNorm)
  const finalUv = Float32Array.from(outUv)
  const { tangents, invalidCount } = computeLockedTangents(finalPos, finalNorm, finalUv, outIndices)

  const chartInfos: UvChartInfo[] = finalCharts.map(ch => {
    const r = bestRects.get(ch.id)!
    return { id: ch.id, triCount: ch.tris.length, axis: ch.axis, rect: { x: r.x, y: r.y, w: r.w, h: r.h } }
  })

  const uvMs = Math.round((performance.now() - t0) * 10) / 10
  const audit: PolyUvAudit = {
    rawFaceGroups: rawFaceSet.size,
    coplanarPatchCount,
    chartCount: finalCharts.length,
    vertexCountBeforeSplit: vCountOrig,
    vertexCountAfterSplit: finalPos.length / 3,
    triangles: tCount,
    atlasSize,
    gutterPx,
    pxPerMeter: Math.round(bestScale * 10) / 10,
    uvCoverage: Math.round(totalUvArea * 1000) / 1000,
    flippedUvTris,
    overlappingChartTris,
    minScale: Number.isFinite(minScale) ? Math.round(minScale * 1000) / 1000 : 0,
    maxScale: Math.round(maxScale * 1000) / 1000,
    tangentInvalidCount: invalidCount,
  }

  return {
    positions: finalPos,
    normals: finalNorm,
    uvs: finalUv,
    tangents,
    indices: outIndices,
    faceIds: new Uint32Array(faceIds),
    faceNormals: faceNormalsFlat,
    triChartIds,
    charts: chartInfos,
    hardCreaseEdges,
    audit,
    uvMs,
    toBufferGeometry() {
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(new Float32Array(finalPos), 3))
      geo.setAttribute('normal', new BufferAttribute(new Float32Array(finalNorm), 3))
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(finalUv), 2))
      geo.setAttribute('tangent', new BufferAttribute(new Float32Array(tangents), 4))
      geo.setIndex(new BufferAttribute(new Uint32Array(outIndices), 1))
      geo.computeBoundingBox()
      geo.computeBoundingSphere()
      return geo
    },
  }
}

function pointToSegDistSq(
  px: number, py: number, pz: number,
  e: PolyCreaseEdge,
): number {
  const vx = e.bx - e.ax, vy = e.by - e.ay, vz = e.bz - e.az
  const wx = px - e.ax, wy = py - e.ay, wz = pz - e.az
  const c1 = vx * wx + vy * wy + vz * wz
  if (c1 <= 0) return wx * wx + wy * wy + wz * wz
  const c2 = vx * vx + vy * vy + vz * vz
  if (c2 <= c1) {
    const dx = px - e.bx, dy = py - e.by, dz = pz - e.bz
    return dx * dx + dy * dy + dz * dz
  }
  const t = c1 / c2
  const dx = px - (e.ax + vx * t)
  const dy = py - (e.ay + vy * t)
  const dz = pz - (e.az + vz * t)
  return dx * dx + dy * dy + dz * dz
}

function makeCosineHemisphereRays(count: number): [number, number, number][] {
  const out: [number, number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    // Cosine-weighted hemisphere elevation (keeps grazing rays > ~12° off the flat facet plane!)
    const u = (i + 0.5) / count
    const z = Math.sqrt(0.06 + 0.94 * u)
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const th = i * golden
    out.push([Math.cos(th) * r, Math.sin(th) * r, z])
  }
  return out
}

// Distinct warm-readable pastel palette for UV chart color-block diagnostic map
const CHART_PALETTE: readonly [number, number, number][] = [
  [217, 134, 108], [116, 173, 146], [122, 159, 209], [219, 181, 105],
  [177, 137, 199], [108, 186, 194], [212, 143, 165], [156, 189, 117],
  [207, 152, 118], [134, 149, 207], [131, 191, 165], [224, 166, 121],
  [167, 152, 209], [116, 179, 127], [212, 136, 134], [126, 184, 212],
]

// ---------------------------------------------------------------------------
// 3. Explicit C2-Surface 512 PBR Baker (Baseline & Shallow Detail)
// ---------------------------------------------------------------------------
export function bakePolyCsgPbr(
  mesh: PolyCsgResult,
  unwrapped: UnwrappedPolyCsgMesh,
  opts: BakePolyPbrOptions,
): PolyBakedPbrTextures {
  const tStart = performance.now()
  const size = opts.size ?? unwrapped.audit.atlasSize
  const dilationPasses = opts.dilationPasses ?? 14
  const aoRayCount = opts.aoRays ?? 16
  const seed = opts.seed ?? 42
  const strataStrength = clamp(opts.strataStrength ?? 1.0, 0, 1.5)
  const [baseR, baseG, baseB] = parseHexRgb(opts.baseColorHex ?? '#caa57c')
  const enableMossTop = opts.mossTop ?? mesh.id.startsWith('terraced-moss-bluff')
  const [mossR, mossG, mossB] = parseHexRgb(opts.mossColorHex ?? '#76b82c')
  const totalPix = size * size

  const albedo = new Uint8ClampedArray(totalPix * 4)
  const normal = new Uint8ClampedArray(totalPix * 4)
  const ao = new Uint8ClampedArray(totalPix * 4)
  const roughness = new Uint8ClampedArray(totalPix * 4)
  const diagnostic = new Uint8ClampedArray(totalPix * 4)
  const uvChartMap = new Uint8ClampedArray(totalPix * 4)

  // Neutral defaults for background before dilation
  for (let i = 0; i < totalPix; i++) {
    const p4 = i * 4
    albedo[p4] = baseR; albedo[p4 + 1] = baseG; albedo[p4 + 2] = baseB; albedo[p4 + 3] = 255
    normal[p4] = 128; normal[p4 + 1] = 128; normal[p4 + 2] = 255; normal[p4 + 3] = 255
    ao[p4] = 255; ao[p4 + 1] = 255; ao[p4 + 2] = 255; ao[p4 + 3] = 255
    roughness[p4] = 224; roughness[p4 + 1] = 224; roughness[p4 + 2] = 224; roughness[p4 + 3] = 255
    diagnostic[p4] = 236; diagnostic[p4 + 1] = 232; diagnostic[p4 + 2] = 224; diagnostic[p4 + 3] = 255
    uvChartMap[p4] = 244; uvChartMap[p4 + 1] = 241; uvChartMap[p4 + 2] = 235; uvChartMap[p4 + 3] = 255
  }

  const chartIdBuf = new Int32Array(totalPix).fill(-1)
  const triIdxBuf = new Int32Array(totalPix).fill(-1)
  const faceIdBuf = new Int32Array(totalPix).fill(-1)
  const posX = new Float32Array(totalPix)
  const posY = new Float32Array(totalPix)
  const posZ = new Float32Array(totalPix)
  const normX = new Float32Array(totalPix)
  const normY = new Float32Array(totalPix)
  const normZ = new Float32Array(totalPix)
  const fnX = new Float32Array(totalPix)
  const fnY = new Float32Array(totalPix)
  const fnZ = new Float32Array(totalPix)
  const tanX = new Float32Array(totalPix)
  const tanY = new Float32Array(totalPix)
  const tanZ = new Float32Array(totalPix)
  const tanW = new Float32Array(totalPix)

  // -------------------------------------------------------------------------
  // Pass 1: Exact Conservative UV Triangle Rasterization on C2 Surface
  // -------------------------------------------------------------------------
  const tRaster0 = performance.now()
  const { positions, normals, uvs, tangents, indices, faceIds, faceNormals, triChartIds } = unwrapped
  const tCount = indices.length / 3
  let coveredTexels = 0
  let maxY = 1.0
  for (let i = 1; i < positions.length; i += 3) if (positions[i] > maxY) maxY = positions[i]

  for (let t = 0; t < tCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2]
    const cid = triChartIds[t]
    const fid = faceIds[t]
    const u0 = uvs[i0 * 2] * size, v0 = uvs[i0 * 2 + 1] * size
    const u1 = uvs[i1 * 2] * size, v1 = uvs[i1 * 2 + 1] * size
    const u2 = uvs[i2 * 2] * size, v2 = uvs[i2 * 2 + 1] * size

    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
    if (Math.abs(denom) < 1e-8) continue
    const invDenom = 1 / denom

    const minX = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1)
    const maxX = Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2)) + 1)
    const minY = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1)
    const maxYpx = Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2)) + 1)

    const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2]
    const p1x = positions[i1 * 3], p1y = positions[i1 * 3 + 1], p1z = positions[i1 * 3 + 2]
    const p2x = positions[i2 * 3], p2y = positions[i2 * 3 + 1], p2z = positions[i2 * 3 + 2]

    const n0x = normals[i0 * 3], n0y = normals[i0 * 3 + 1], n0z = normals[i0 * 3 + 2]
    const n1x = normals[i1 * 3], n1y = normals[i1 * 3 + 1], n1z = normals[i1 * 3 + 2]
    const n2x = normals[i2 * 3], n2y = normals[i2 * 3 + 1], n2z = normals[i2 * 3 + 2]

    const t0x = tangents[i0 * 4], t0y = tangents[i0 * 4 + 1], t0z = tangents[i0 * 4 + 2]
    const t1x = tangents[i1 * 4], t1y = tangents[i1 * 4 + 1], t1z = tangents[i1 * 4 + 2]
    const t2x = tangents[i2 * 4], t2y = tangents[i2 * 4 + 1], t2z = tangents[i2 * 4 + 2]
    const handed = tangents[i0 * 4 + 3]

    const gfx = faceNormals[t * 3], gfy = faceNormals[t * 3 + 1], gfz = faceNormals[t * 3 + 2]
    const col = CHART_PALETTE[cid % CHART_PALETTE.length]

    for (let py = minY; py <= maxYpx; py++) {
      const cy = py + 0.5
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5
        let w0 = ((v1 - v2) * (cx - u2) + (u2 - u1) * (cy - v2)) * invDenom
        let w1 = ((v2 - v0) * (cx - u2) + (u0 - u2) * (cy - v2)) * invDenom
        let w2 = 1 - w0 - w1
        const pix = py * size + px
        const strictInside = w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4
        // Conservative sub-pixel fallback ONLY for thin bevel/notch slivers if pixel isn't claimed yet
        const nearInside = !strictInside && chartIdBuf[pix] < 0 && w0 >= -0.08 && w1 >= -0.08 && w2 >= -0.08
        if (!strictInside && !nearInside) continue
        if (nearInside) {
          w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2)
          const ws = w0 + w1 + w2 || 1
          w0 /= ws; w1 /= ws; w2 /= ws
        }

        if (chartIdBuf[pix] < 0) coveredTexels++
        chartIdBuf[pix] = cid
        triIdxBuf[pix] = t
        faceIdBuf[pix] = fid

        posX[pix] = p0x * w0 + p1x * w1 + p2x * w2
        posY[pix] = p0y * w0 + p1y * w1 + p2y * w2
        posZ[pix] = p0z * w0 + p1z * w1 + p2z * w2

        const nl = norm3(n0x * w0 + n1x * w1 + n2x * w2, n0y * w0 + n1y * w1 + n2y * w2, n0z * w0 + n1z * w1 + n2z * w2)
        normX[pix] = nl.x; normY[pix] = nl.y; normZ[pix] = nl.z
        fnX[pix] = gfx; fnY[pix] = gfy; fnZ[pix] = gfz

        // Gram-Schmidt orthogonalized tangent matching Three.js vertex/fragment shader
        let tx = t0x * w0 + t1x * w1 + t2x * w2
        let ty = t0y * w0 + t1y * w1 + t2y * w2
        let tz = t0z * w0 + t1z * w1 + t2z * w2
        const ndt = nl.x * tx + nl.y * ty + nl.z * tz
        const tn = norm3(tx - nl.x * ndt, ty - nl.y * ndt, tz - nl.z * ndt)
        tanX[pix] = tn.x; tanY[pix] = tn.y; tanZ[pix] = tn.z; tanW[pix] = handed

        const p4 = pix * 4
        // Slightly darken triangles near chart edges in UV color map for visual inspection
        const minW = Math.min(w0, w1, w2)
        const edgeTint = minW < 0.04 ? 0.72 : 1.0
        uvChartMap[p4] = Math.round(col[0] * edgeTint)
        uvChartMap[p4 + 1] = Math.round(col[1] * edgeTint)
        uvChartMap[p4 + 2] = Math.round(col[2] * edgeTint)
        uvChartMap[p4 + 3] = 255
      }
    }
  }
  const rasterMs = performance.now() - tRaster0

  // -------------------------------------------------------------------------
  // Pass 2: True Physical 3D Exact Ray-Traced Geometric AO on C2's Own Mesh
  //   Exact necessary-condition pre-filter per triangle: only triangles strictly above
  //   triangle t's plane (dot(N_f, v - P0) > 0.002) and within maxAoDist of AABB(t) can ever
  //   occlude upper-hemisphere rays from triangle t! Zero approximation, ~15x faster than full BVH!
  // -------------------------------------------------------------------------
  const tAo0 = performance.now()
  const hemiRays = makeCosineHemisphereRays(aoRayCount)
  const aoRaw = new Float32Array(totalPix).fill(1)
  const maxAoDist = 0.45
  const maxGroundDist = 0.28

  const triGeomAll = new Float32Array(tCount * 9)
  const triAabbMin = new Float32Array(tCount * 3)
  const triAabbMax = new Float32Array(tCount * 3)
  const meshPos = mesh.positions
  const meshIdx = mesh.indices
  for (let t = 0; t < tCount; t++) {
    const a = meshIdx[t * 3] * 3, b = meshIdx[t * 3 + 1] * 3, c = meshIdx[t * 3 + 2] * 3
    const ax = meshPos[a], ay = meshPos[a + 1], az = meshPos[a + 2]
    const bx = meshPos[b], by = meshPos[b + 1], bz = meshPos[b + 2]
    const cx = meshPos[c], cy = meshPos[c + 1], cz = meshPos[c + 2]
    const o = t * 9
    triGeomAll[o] = ax; triGeomAll[o + 1] = ay; triGeomAll[o + 2] = az
    triGeomAll[o + 3] = bx - ax; triGeomAll[o + 4] = by - ay; triGeomAll[o + 5] = bz - az
    triGeomAll[o + 6] = cx - ax; triGeomAll[o + 7] = cy - ay; triGeomAll[o + 8] = cz - az
    triAabbMin[t * 3] = Math.min(ax, bx, cx); triAabbMin[t * 3 + 1] = Math.min(ay, by, cy); triAabbMin[t * 3 + 2] = Math.min(az, bz, cz)
    triAabbMax[t * 3] = Math.max(ax, bx, cx); triAabbMax[t * 3 + 1] = Math.max(ay, by, cy); triAabbMax[t * 3 + 2] = Math.max(az, bz, cz)
  }

  const occludersOfTri: Int32Array[] = new Array(tCount)
  for (let t = 0; t < tCount; t++) {
    const nx = faceNormals[t * 3], ny = faceNormals[t * 3 + 1], nz = faceNormals[t * 3 + 2]
    const p0x = triGeomAll[t * 9], p0y = triGeomAll[t * 9 + 1], p0z = triGeomAll[t * 9 + 2]
    const dPlane = nx * p0x + ny * p0y + nz * p0z + 0.0018
    const ax0 = triAabbMin[t * 3] - maxAoDist, ay0 = triAabbMin[t * 3 + 1] - maxAoDist, az0 = triAabbMin[t * 3 + 2] - maxAoDist
    const ax1 = triAabbMax[t * 3] + maxAoDist, ay1 = triAabbMax[t * 3 + 1] + maxAoDist, az1 = triAabbMax[t * 3 + 2] + maxAoDist
    const list: number[] = []
    for (let q = 0; q < tCount; q++) {
      if (q === t) continue
      if (triAabbMax[q * 3] < ax0 || triAabbMin[q * 3] > ax1) continue
      if (triAabbMax[q * 3 + 1] < ay0 || triAabbMin[q * 3 + 1] > ay1) continue
      if (triAabbMax[q * 3 + 2] < az0 || triAabbMin[q * 3 + 2] > az1) continue
      const oq = q * 9
      const qax = triGeomAll[oq], qay = triGeomAll[oq + 1], qaz = triGeomAll[oq + 2]
      const qbx = qax + triGeomAll[oq + 3], qby = qay + triGeomAll[oq + 4], qbz = qaz + triGeomAll[oq + 5]
      const qcx = qax + triGeomAll[oq + 6], qcy = qay + triGeomAll[oq + 7], qcz = qaz + triGeomAll[oq + 8]
      if (
        nx * qax + ny * qay + nz * qaz > dPlane ||
        nx * qbx + ny * qby + nz * qbz > dPlane ||
        nx * qcx + ny * qcy + nz * qcz > dPlane
      ) {
        list.push(q)
      }
    }
    occludersOfTri[t] = Int32Array.from(list)
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const pix = py * size + px
      if (chartIdBuf[pix] < 0) continue

      const nx = fnX[pix], ny = fnY[pix], nz = fnZ[pix]
      const ox = posX[pix] + nx * 0.0022
      const oy = posY[pix] + ny * 0.0022
      const oz = posZ[pix] + nz * 0.0022
      const occTris = occludersOfTri[triIdxBuf[pix]]
      const occCount = occTris.length
      const nearGround = oy < maxGroundDist

      // Fast path: unobstructed convex outer face far from ground -> mathematically 100% unoccluded (AO = 1.0)!
      if (occCount === 0 && !nearGround) {
        aoRaw[pix] = 1.0
        continue
      }

      // Inline orthonormal tangent basis rotated by deterministic R2 angle per texel (zero object alloc!)
      const r2 = ((px * 0.7548776662 + py * 0.5698402909) % 1) * Math.PI * 2
      const cR = Math.cos(r2), sR = Math.sin(r2)
      let u0x: number, u0y: number, u0z: number
      if (Math.abs(ny) < 0.88) {
        const l = Math.hypot(nz, nx) || 1
        u0x = nz / l; u0y = 0; u0z = -nx / l
      } else {
        const l = Math.hypot(nz, ny) || 1
        u0x = 0; u0y = -nz / l; u0z = ny / l
      }
      const v0x = ny * u0z - nz * u0y
      const v0y = nz * u0x - nx * u0z
      const v0z = nx * u0y - ny * u0x
      const ux = u0x * cR + v0x * sR, uy = u0y * cR + v0y * sR, uz = u0z * cR + v0z * sR
      const vx = -u0x * sR + v0x * cR, vy = -u0y * sR + v0y * cR, vz = -u0z * sR + v0z * cR

      let occSum = 0
      for (let ri = 0; ri < aoRayCount; ri++) {
        const ray = hemiRays[ri]
        const lx = ray[0], ly = ray[1], lz = ray[2]
        const dx = ux * lx + vx * ly + nx * lz
        const dy = uy * lx + vy * ly + ny * lz
        const dz = uz * lx + vz * ly + nz * lz

        let bestT = maxAoDist
        for (let oi = 0; oi < occCount; oi++) {
          const o = occTris[oi] * 9
          const e1x = triGeomAll[o + 3], e1y = triGeomAll[o + 4], e1z = triGeomAll[o + 5]
          const e2x = triGeomAll[o + 6], e2y = triGeomAll[o + 7], e2z = triGeomAll[o + 8]
          const pvx = dy * e2z - dz * e2y
          const pvy = dz * e2x - dx * e2z
          const pvz = dx * e2y - dy * e2x
          const det = e1x * pvx + e1y * pvy + e1z * pvz
          if (det > -1e-9 && det < 1e-9) continue
          const invDet = 1 / det
          const tx = ox - triGeomAll[o], ty = oy - triGeomAll[o + 1], tz = oz - triGeomAll[o + 2]
          const u = (tx * pvx + ty * pvy + tz * pvz) * invDet
          if (u < -1e-4 || u > 1.0001) continue
          const qx = ty * e1z - tz * e1y
          const qy = tz * e1x - tx * e1z
          const qz = tx * e1y - ty * e1x
          const v = (dx * qx + dy * qy + dz * qz) * invDet
          if (v < -1e-4 || u + v > 1.0001) continue
          const tHit = (e2x * qx + e2y * qy + e2z * qz) * invDet
          if (tHit > 1e-4 && tHit < bestT) bestT = tHit
        }

        let hitOcc = 0
        if (bestT < maxAoDist) {
          // Two-scale physical crevice response: crisp short-range V-notch depth (<16cm) + broad pocket falloff (<45cm)
          const nearW = bestT < 0.16 ? 1 - bestT / 0.16 : 0
          const farW = 1 - bestT / maxAoDist
          hitOcc = Math.min(1, 0.55 * nearW + 0.65 * Math.pow(farW, 1.2))
        }
        // Soft ground-plane contact occlusion at y = 0 (natural seated weight without dark horizontal skirt!)
        if (nearGround && dy < -0.03 && oy > 0.001) {
          const tG = -oy / dy
          if (tG > 0 && tG < maxGroundDist) {
            const wg = 1 - tG / maxGroundDist
            const gOcc = 0.50 * Math.pow(wg, 1.65)
            if (gOcc > hitOcc) hitOcc = gOcc
          }
        }
        occSum += hitOcc
      }
      const occ = occSum / aoRayCount
      aoRaw[pix] = clamp(1 - occ * 0.92, 0.24, 1.0)
    }
  }

  // Chart-isolated 3x3 smoothing pass on raw ray-traced AO (zero cross-seam bleed, silky clean V-notch gradients!)
  const aoSmooth = new Float32Array(aoRaw)
  for (let py = 1; py < size - 1; py++) {
    for (let px = 1; px < size - 1; px++) {
      const pix = py * size + px
      const cid = chartIdBuf[pix]
      if (cid < 0) continue
      const fid = faceIdBuf[pix]
      let sum = aoRaw[pix] * 4
      let wSum = 4
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const np = (py + dy) * size + (px + dx)
          if (chartIdBuf[np] !== cid) continue
          // Keep sharp crease AO crisp if different faceID with big normal jump
          const w = faceIdBuf[np] === fid ? (dx === 0 || dy === 0 ? 2 : 1) : 0.45
          sum += aoRaw[np] * w
          wSum += w
        }
      }
      aoSmooth[pix] = sum / wSum
    }
  }
  const bvhAoMs = performance.now() - tAo0

  // -------------------------------------------------------------------------
  // Pass 3: C2-Surface Albedo + Normal Synthesis (Baseline vs Shallow Detail)
  // -------------------------------------------------------------------------
  const tMat0 = performance.now()
  const convexEdges = unwrapped.hardCreaseEdges.filter(e => e.isConvex && e.dihedralDeg >= 26)
  const hardEdgesAll = unwrapped.hardCreaseEdges.filter(e => e.dihedralDeg >= 24)
  const notchEdges = unwrapped.hardCreaseEdges.filter(e => e.isShoulderNotch)

  // Non-periodic, finite, in-face-terminating sedimentary strata veins (ZERO equidistant repeating sine stripes!):
  // 3 irregularly spaced asymmetric bedding ledges, each laterally gated by a smooth 3D spatial envelope
  // so every stratum starts and fades out organically inside the wide rock faces, leaving hard ridges & V-notch clean!
  // Scales height smoothly for taller cliff archetypes (e.g. block-bluff-c2 @ 1.46m) while keeping sandstone-ledge-c2 exact!
  const hScale = maxY > 1.15 ? maxY / 1.07 : 1.0
  const strataDefs: readonly {
    h: number
    width: number
    tiltX: number
    tiltZ: number
    amp: number
    cx: number
    cz: number
    span: number
    seedOff: number
  }[] = [
    // Low-mid subtle ledge fading across the rear-left / front cheek
    { h: 0.25 * hScale, width: 0.044 * Math.sqrt(hScale), tiltX: 0.22, tiltZ: 0.06, amp: 0.85, cx: -0.32, cz: -0.22, span: 0.78, seedOff: 19 },
    // Mid-upper primary sandstone bedding vein breaking up the wide rear shoulder plane & terminating mid-face
    { h: 0.59 * hScale, width: 0.056 * Math.sqrt(hScale), tiltX: 0.26, tiltZ: 0.11, amp: 1.00, cx: 0.24, cz: -0.30, span: 0.86, seedOff: 53 },
    // Short high secondary sediment pocket near the upper crown shoulder (fades before summit & cliff)
    { h: 0.84 * hScale, width: 0.036 * Math.sqrt(hScale), tiltX: 0.19, tiltZ: -0.05, amp: 0.70, cx: 0.12, cz: 0.08, span: 0.56, seedOff: 89 },
  ]

  const evalFiniteStrata = (x: number, y: number, z: number): { tone: number; gx: number; gy: number; gz: number } => {
    let toneSum = 0
    let gx = 0, gy = 0, gz = 0
    for (let i = 0; i < strataDefs.length; i++) {
      const s = strataDefs[i]
      const latDist = Math.hypot(x - s.cx, z - s.cz)
      if (latDist >= s.span) continue
      const radialFade = 1 - smoothstep(s.span * 0.35, s.span, latDist)
      const patchNoise = fbm3(x * 1.6 + s.seedOff * 0.1, y * 1.2, z * 1.6 - s.seedOff * 0.1, seed + s.seedOff + 7, 2) * 0.5 + 0.5
      const patchFade = smoothstep(0.28, 0.72, patchNoise)
      const env = radialFade * patchFade * s.amp
      if (env <= 0.002) continue

      const warp = fbm2(x * 1.45 + i * 3.1, z * 1.45 - i * 2.3, seed + s.seedOff, 2) * 0.055
      const d = (y + x * s.tiltX + z * s.tiltZ) - (s.h + warp)
      const q = d / s.width
      if (q > 3.2 || q < -3.2) continue
      const q2 = q * q
      const gauss = Math.exp(-q2)
      const gaussHalf = Math.exp(-0.5 * q2)
      // Analytic slope of asymmetric ledge profile (0.65*q*exp(-0.5*q^2) + 0.25*exp(-q^2))
      const dStepDq = 0.65 * (1 - q2) * gaussHalf - 0.50 * q * gauss
      const mag = (dStepDq * env * 0.0032 * strataStrength) / s.width
      gx += mag * s.tiltX
      gy += mag
      gz += mag * s.tiltZ
      toneSum += (q > 0 ? gauss * 0.65 : -gauss * 0.85) * env
    }
    return { tone: toneSum, gx, gy, gz }
  }

  let aoSumAll = 0
  let notchTexels = 0
  let notchAoSum = 0
  let bevelTexels = 0
  let maxNormalDevDeg = 0

  const usePhotoCraft = opts.mode === 'photocraft-pbr' && Boolean(opts.externalPbr?.stone)
  const pcStone = opts.externalPbr?.stone
  const pcMoss = opts.externalPbr?.moss
  const pcTileScale = opts.pbrScale ?? (enableMossTop ? 0.66 : 0.62)
  // Relative color tint ratio so custom baseColorHex shifts PhotoCraft sandstone cleanly while default '#cfa87d' stays 1:1 faithful!
  const refSandR = 207, refSandG = 168, refSandB = 125
  const tintRatioR = clamp(baseR / refSandR, 0.55, 1.45)
  const tintRatioG = clamp(baseG / refSandG, 0.55, 1.45)
  const tintRatioB = clamp(baseB / refSandB, 0.55, 1.45)

  for (let pix = 0; pix < totalPix; pix++) {
    const cid = chartIdBuf[pix]
    if (cid < 0) continue

    const px = posX[pix], py = posY[pix], pz = posZ[pix]
    const nlx = normX[pix], nly = normY[pix], nlz = normZ[pix]
    const fid = faceIdBuf[pix]
    const aoVal = aoSmooth[pix]
    const inNotch = isShoulderNotchFace(fid)
    const inBevel = isLocalBevelFace(fid)

    aoSumAll += aoVal
    if (inNotch) { notchTexels++; notchAoSum += aoVal }
    if (inBevel) bevelTexels++

    // Exact 3D distances to C2's own explicit convex ridges, hard creases & shoulder V-notch
    let minConvexD2 = Infinity
    for (let i = 0; i < convexEdges.length; i++) {
      const d2 = pointToSegDistSq(px, py, pz, convexEdges[i])
      if (d2 < minConvexD2) minConvexD2 = d2
    }
    let minHardD2 = Infinity
    for (let i = 0; i < hardEdgesAll.length; i++) {
      const d2 = pointToSegDistSq(px, py, pz, hardEdgesAll[i])
      if (d2 < minHardD2) minHardD2 = d2
    }
    let minNotchD2 = Infinity
    for (let i = 0; i < notchEdges.length; i++) {
      const d2 = pointToSegDistSq(px, py, pz, notchEdges[i])
      if (d2 < minNotchD2) minNotchD2 = d2
    }
    const distConvex = Math.sqrt(minConvexD2)
    const distHard = Math.sqrt(minHardD2)
    const distNotch = Math.sqrt(minNotchD2)

    // Write AO map (linear grayscale RGB)
    const p4 = pix * 4
    let outAo = aoVal
    let outRough = 0.88

    // --- PhotoCraft PBR Mode: Triplanar Stylized Sandstone Cliff + Inset Velvet Terrace Moss ---
    if (usePhotoCraft && pcStone) {
      const hNorm = clamp(py / maxY, 0, 1)
      const upBias = clamp(nly * 0.5 + 0.5, 0, 1)
      const edgeWearBreakup = 0.65 + 0.35 * fbm3(px * 4.5, py * 4.5, pz * 4.5, seed + 13, 2)
      const edgeProtect = smoothstep(0.012, 0.048, distHard)
      const notchProtect = inNotch ? 0 : smoothstep(0.028, 0.085, distNotch)
      const detailMask = edgeProtect * notchProtect

      // Diagnostic atlas
      if (inNotch) {
        diagnostic[p4] = 56; diagnostic[p4 + 1] = 178; diagnostic[p4 + 2] = 104; diagnostic[p4 + 3] = 255
      } else if (inBevel) {
        diagnostic[p4] = 56; diagnostic[p4 + 1] = 168; diagnostic[p4 + 2] = 204; diagnostic[p4 + 3] = 255
      } else if (detailMask < 0.35) {
        diagnostic[p4] = 228; diagnostic[p4 + 1] = 176; diagnostic[p4 + 2] = 74; diagnostic[p4 + 3] = 255
      } else {
        diagnostic[p4] = 92; diagnostic[p4 + 1] = 132; diagnostic[p4 + 2] = 194; diagnostic[p4 + 3] = 255
      }

      // 1. Sample PhotoCraft Sandstone Cliff PBR (gravity-aligned horizontal strata + crisp OpenGL normal!)
      const stoneNormalGain = (0.62 + strataStrength * 0.45) * (0.28 + 0.72 * detailMask)
      const stSmp = sampleTriplanarPbr(pcStone, px, py, pz, nlx, nly, nlz, pcTileScale, stoneNormalGain, seed % 997)
      // Gentle height/orientation warmth + user baseColorHex tint preservation
      const lift = 0.94 + hNorm * 0.08 + (upBias - 0.5) * 0.05
      let r = stSmp.r * tintRatioR * lift
      let g = stSmp.g * tintRatioG * lift
      let b = stSmp.b * tintRatioB * lift
      outRough = stSmp.roughness
      outAo = aoVal * lerp(1.0, stSmp.ao, 0.55)

      let targetWnx = stSmp.wnx
      let targetWny = stSmp.wny
      let targetWnz = stSmp.wnz

      // 2. Signature pale-ivory dry-brush bevel highlight frame (matching turnaround TOP & HERO 3/4 views!)
      const bevelCatch = inNotch
        ? 0
        : (inBevel ? 0.78 : 0) + (1 - smoothstep(0.003, 0.030, distConvex)) * clamp(edgeWearBreakup, 0.52, 1.0) * smoothstep(0.014, 0.048, distNotch) * 0.82
      const catchAmt = clamp(bevelCatch, 0, 0.90)
      if (catchAmt > 0.01) {
        r = lerp(r, Math.min(255, 248 * tintRatioR), catchAmt * 0.68)
        g = lerp(g, Math.min(255, 230 * tintRatioG), catchAmt * 0.68)
        b = lerp(b, Math.min(255, 192 * tintRatioB), catchAmt * 0.68)
        outRough = lerp(outRough, 0.66, catchAmt * 0.42)
      }

      // 3. Grounded warm-earth base dampening + warm-umber real 3D crevice deepening
      const baseDamp = 1 - smoothstep(0.0, 0.30, py)
      r *= 1 - baseDamp * 0.11
      g *= 1 - baseDamp * 0.13
      b *= 1 - baseDamp * 0.13

      const creviceAmt = smoothstep(0.86, 0.40, aoVal)
      if (creviceAmt > 0.005) {
        r = lerp(r, r * 0.56 - 7, creviceAmt * 0.78)
        g = lerp(g, g * 0.47 - 9, creviceAmt * 0.78)
        b = lerp(b, b * 0.40 - 8, creviceAmt * 0.78)
        outRough = lerp(outRough, 0.94, creviceAmt * 0.65)
      }

      // 4. Inset scalloped PhotoCraft Velvet Terrace Moss on flat horizontal terrace tops!
      if (enableMossTop) {
        const isFlatTop = smoothstep(0.84, 0.93, nly) * (inBevel ? 0 : 1) * smoothstep(0.06, 0.15, py)
        let mossMask = 0
        let cushionCore = 0
        if (isFlatTop > 0.005) {
          const lobeBig = fbm3(px * 3.8 + 1.1, py * 2.8, pz * 3.8 - 1.9, seed + 409, 2) * 0.025
          const lobeFine = fbm3(px * 10.2 - 2.4, py * 5.5, pz * 10.2 + 3.1, seed + 421, 2) * 0.010
          const insetDist = distConvex + lobeBig + lobeFine
          const rimInset = smoothstep(0.007, 0.026, insetDist)
          mossMask = clamp(isFlatTop * rimInset, 0, 1)
          // 3D cushion pillow gradient: deep lush forest-olive shadow around outer scalloped skirt, lifting to sunlit crown inside!
          cushionCore = smoothstep(0.014, 0.105, insetDist)
        }
        if (mossMask > 0.005) {
          const mossScale = pcTileScale * 2.15
          const mSmp = pcMoss
            ? sampleTopPlanarPbr(pcMoss, px, pz, mossScale, 0.90, seed % 991)
            : { r: mossR, g: mossG, b: mossB, roughness: 0.91, ao: 0.92, wnx: nlx, wny: nly, wnz: nlz }
          const sunLift = 0.88 + hNorm * 0.15
          const innerShade = 0.72 + 0.28 * smoothstep(0.48, 0.90, aoVal)
          const cushionLightR = lerp(0.58, 1.05, cushionCore)
          const cushionLightG = lerp(0.68, 1.03, cushionCore)
          const cushionLightB = lerp(0.56, 0.96, cushionCore)
          let mr = mSmp.r * sunLift * innerShade * cushionLightR
          let mg = mSmp.g * sunLift * innerShade * cushionLightG
          let mb = mSmp.b * sunLift * innerShade * cushionLightB

          // Crisp deep forest-olive contact shadow right along the scalloped edge inside the pale sandstone frame
          const rimEdge = mossMask * (1 - mossMask) * 4
          mr = lerp(mr, mr * 0.48, rimEdge * 0.72)
          mg = lerp(mg, mg * 0.56, rimEdge * 0.72)
          mb = lerp(mb, mb * 0.46, rimEdge * 0.72)

          r = lerp(r, mr, mossMask)
          g = lerp(g, mg, mossMask)
          b = lerp(b, mb, mossMask)
          outRough = lerp(outRough, mSmp.roughness, mossMask)
          outAo = lerp(outAo, aoVal * lerp(1.0, mSmp.ao, 0.45) * lerp(0.76, 1.0, cushionCore), mossMask)
          targetWnx = lerp(targetWnx, mSmp.wnx, mossMask)
          targetWny = lerp(targetWny, mSmp.wny, mossMask)
          targetWnz = lerp(targetWnz, mSmp.wnz, mossMask)
        }
      }

      // 5. Project blended world-space PBR normal accurately into C2's locked MikkTSpace tangent frame!
      const tx = tanX[pix], ty = tanY[pix], tz = tanZ[pix], tw = tanW[pix]
      const bx = (nly * tz - nlz * ty) * tw
      const by = (nlz * tx - nlx * tz) * tw
      const bz = (nlx * ty - nly * tx) * tw
      const bLen = Math.hypot(bx, by, bz) || 1
      const bux = bx / bLen, buy = by / bLen, buz = bz / bLen

      const wl = Math.hypot(targetWnx, targetWny, targetWnz) || 1
      const wux = targetWnx / wl, wuy = targetWny / wl, wuz = targetWnz / wl
      // Blend slightly toward geometric normal on steep bevels/notches so silhouette stays razor-clean
      const nBlend = inNotch ? 0.25 : inBevel ? 0.35 : 0.85
      const fnx = lerp(nlx, wux, nBlend)
      const fny = lerp(nly, wuy, nBlend)
      const fnz = lerp(nlz, wuz, nBlend)
      const fl = Math.hypot(fnx, fny, fnz) || 1
      const ux = fnx / fl, uy = fny / fl, uz = fnz / fl

      const rawTx = ux * tx + uy * ty + uz * tz
      const rawTy = ux * bux + uy * buy + uz * buz
      const rawTz = Math.max(0.25, ux * nlx + uy * nly + uz * nlz)
      const tl = Math.hypot(rawTx, rawTy, rawTz) || 1
      const tnx = rawTx / tl, tny = rawTy / tl, tnz = rawTz / tl
      const devDeg = (Math.acos(clamp(tnz, -1, 1)) * 180) / Math.PI
      if (devDeg > maxNormalDevDeg) maxNormalDevDeg = devDeg

      normal[p4] = Math.round(clamp(tnx * 0.5 + 0.5, 0, 1) * 255)
      normal[p4 + 1] = Math.round(clamp(tny * 0.5 + 0.5, 0, 1) * 255)
      normal[p4 + 2] = Math.round(clamp(tnz * 0.5 + 0.5, 0, 1) * 255)
      normal[p4 + 3] = 255

      const aoByte = Math.round(clamp(outAo, 0, 1) * 255)
      ao[p4] = aoByte; ao[p4 + 1] = aoByte; ao[p4 + 2] = aoByte; ao[p4 + 3] = 255
      const rghByte = Math.round(clamp(outRough, 0.04, 0.99) * 255)
      roughness[p4] = rghByte; roughness[p4 + 1] = rghByte; roughness[p4 + 2] = rghByte; roughness[p4 + 3] = 255
      albedo[p4] = Math.round(clamp(r, 0, 255))
      albedo[p4 + 1] = Math.round(clamp(g, 0, 255))
      albedo[p4 + 2] = Math.round(clamp(b, 0, 255))
      albedo[p4 + 3] = 255
      continue
    }

    const aoByte = Math.round(clamp(aoVal, 0, 1) * 255)
    ao[p4] = aoByte; ao[p4 + 1] = aoByte; ao[p4 + 2] = aoByte; ao[p4 + 3] = 255
    const rghDefault = Math.round(outRough * 255)
    roughness[p4] = rghDefault; roughness[p4 + 1] = rghDefault; roughness[p4 + 2] = rghDefault; roughness[p4 + 3] = 255

    // --- Shared Clean C2 Baseline Albedo (NO baked key-light shadows, NO dark V-notch seam core!) ---
    const hNorm = clamp(py / maxY, 0, 1)
    const upBias = clamp(nly * 0.5 + 0.5, 0, 1)
    // Gentle top warm sunlit-sandstone / lower cool-earth mineral value shift (±6%)
    const toneScale = 0.94 + hNorm * 0.06 + (upBias - 0.5) * 0.07
    let r = baseR * (toneScale + (upBias - 0.5) * 0.025)
    let g = baseG * toneScale
    let b = baseB * (toneScale - (upBias - 0.5) * 0.022)

    // Ultra-subtle organic convex-edge dry-brush catch-light (<= +4.5% — NEVER a sharp bright wireframe, zero in V-notch!)
    const edgeWearBreakup = 0.65 + 0.35 * fbm3(px * 4.2, py * 4.2, pz * 4.2, seed + 13, 2)
    const convexCatch = inNotch
      ? 0
      : (1 - smoothstep(0.004, 0.026, distConvex)) * clamp(edgeWearBreakup, 0.35, 1.0) * smoothstep(0.02, 0.06, distNotch)
    r = lerp(r, Math.min(255, r * 1.07 + 9), convexCatch * 0.45)
    g = lerp(g, Math.min(255, g * 1.06 + 7), convexCatch * 0.45)
    b = lerp(b, Math.min(255, b * 1.04 + 4), convexCatch * 0.45)

    // Strict edge & shoulder-notch protection mask for shallow-detail mode
    const edgeProtect = smoothstep(0.018, 0.065, distHard)
    const notchProtect = inNotch ? 0 : smoothstep(0.035, 0.11, distNotch)
    const detailMask = edgeProtect * notchProtect

    // Write diagnostic map (visualizes exact coverage of shoulder V-notch, bevels, edge-protected band & detail interior)
    if (inNotch) {
      diagnostic[p4] = 56; diagnostic[p4 + 1] = 178; diagnostic[p4 + 2] = 104; diagnostic[p4 + 3] = 255
    } else if (inBevel) {
      diagnostic[p4] = 56; diagnostic[p4 + 1] = 168; diagnostic[p4 + 2] = 204; diagnostic[p4 + 3] = 255
    } else if (detailMask < 0.35) {
      diagnostic[p4] = 228; diagnostic[p4 + 1] = 176; diagnostic[p4 + 2] = 74; diagnostic[p4 + 3] = 255
    } else {
      diagnostic[p4] = 92; diagnostic[p4 + 1] = 132; diagnostic[p4 + 2] = 194; diagnostic[p4 + 3] = 255
    }

    if (opts.mode === 'baseline') {
      // Strictly flat tangent-space normal (128, 128, 255) — zero SDF projection conflict, zero fake cracks!
      normal[p4] = 128; normal[p4 + 1] = 128; normal[p4 + 2] = 255; normal[p4 + 3] = 255
    } else {
      // --- C2 Shallow Detail Mode: non-periodic in-face-terminating strata + broad painter wash + gentle <=3.5° interior normal ---
      const st = evalFiniteStrata(px, py, pz)
      // Broad organic stone wash stretched gently along the oblique ledge (breaks uniform flatness without periodic stripes!)
      const sx = px * 0.94 - py * 0.24
      const sy = px * 0.24 + py * 0.94
      const brushWash = fbm3(sx * 1.9 + 0.8, sy * 3.8 - 1.3, pz * 1.9 + 0.4, seed + 211, 2)
      const strataDelta = (st.tone * 0.058 + brushWash * 0.042) * detailMask * strataStrength
      r *= 1 + strataDelta * 1.08
      g *= 1 + strataDelta * 0.98
      b *= 1 + strataDelta * 0.82

      // Subtle warm mineral variation across wide planes (breaks blockiness on rear shoulder without dirtying edges!)
      const mottle = fbm3(px * 2.6, py * 2.6, pz * 2.6, seed + 307, 2) * 0.024 * detailMask * strataStrength
      r *= 1 + mottle; g *= 1 + mottle * 0.92; b *= 1 + mottle * 0.80

      // Tangent-space normal from exact analytic finite-strata gradient + gentle 1-octave sandstone micro-tooth!
      if (detailMask > 0.01 && strataStrength > 0.01) {
        const tx = tanX[pix], ty = tanY[pix], tz = tanZ[pix], tw = tanW[pix]
        const bx = (nly * tz - nlz * ty) * tw
        const by = (nlz * tx - nlx * tz) * tw
        const bz = (nlx * ty - nly * tx) * tw
        const bLen = Math.hypot(bx, by, bz) || 1
        const bux = bx / bLen, buy = by / bLen, buz = bz / bLen

        // Analytic strata projection onto tangent plane (zero finite-difference overhead!)
        let dhdu = st.gx * tx + st.gy * ty + st.gz * tz
        let dhdv = st.gx * bux + st.gy * buy + st.gz * buz

        // Subtle weathered sandstone tooth (1-octave fast directional diff)
        const eps = 0.008
        const tC = fbm3(px * 8.2 + 1.1, py * 8.2 - 0.7, pz * 8.2 + 2.3, seed + 91, 1)
        const tU = fbm3((px + tx * eps) * 8.2 + 1.1, (py + ty * eps) * 8.2 - 0.7, (pz + tz * eps) * 8.2 + 2.3, seed + 91, 1)
        const tV = fbm3((px + bux * eps) * 8.2 + 1.1, (py + buy * eps) * 8.2 - 0.7, (pz + buz * eps) * 8.2 + 2.3, seed + 91, 1)
        const toothScale = (0.00085 * strataStrength) / eps
        dhdu += (tU - tC) * toothScale
        dhdv += (tV - tC) * toothScale

        // Clamp gradient strictly to <= ~3.8° slope (tan 3.8° ≈ 0.066) so grazing/back-lit faces stay flat & sculptural!
        const gain = 0.80 * detailMask
        const gx = clamp(-dhdu * gain, -0.066, 0.066)
        const gy = clamp(-dhdv * gain, -0.066, 0.066)
        const invL = 1 / Math.hypot(gx, gy, 1)
        const tnx = gx * invL, tny = gy * invL, tnz = invL
        const devDeg = (Math.acos(clamp(tnz, -1, 1)) * 180) / Math.PI
        if (devDeg > maxNormalDevDeg) maxNormalDevDeg = devDeg

        normal[p4] = Math.round(clamp(tnx * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 1] = Math.round(clamp(tny * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 2] = Math.round(clamp(tnz * 0.5 + 0.5, 0, 1) * 255)
        normal[p4 + 3] = 255
      } else {
        normal[p4] = 128; normal[p4 + 1] = 128; normal[p4 + 2] = 255; normal[p4 + 3] = 255
      }
    }

    if (enableMossTop) {
      // Stylized terraced sandstone smart-material accent: crisp sunlit chiseled bevel catch + clean painterly strata wash + rich organic moss!
      // (ZERO curvy Perlin worm-lines! Surface detail stays clean, planar, and sculptural just like ZBrush/Substance hand-painted rock!)
      const bevelCatch = inNotch
        ? 0
        : (inBevel ? 0.58 : 0) + (1 - smoothstep(0.003, 0.026, distConvex)) * clamp(edgeWearBreakup, 0.48, 1.0) * smoothstep(0.015, 0.05, distNotch) * 0.70
      const catchAmt = clamp(bevelCatch, 0, 0.78)
      r = lerp(r, Math.min(255, baseR * 1.20 + 19), catchAmt * 0.52)
      g = lerp(g, Math.min(255, baseG * 1.17 + 15), catchAmt * 0.52)
      b = lerp(b, Math.min(255, baseB * 1.11 + 10), catchAmt * 0.52)

      // Compute organic multi-scale wavy-lobe moss mask strictly on flat horizontal terrace tops (nly > 0.84)
      const isFlatTop = smoothstep(0.84, 0.93, nly) * (inBevel ? 0 : 1) * smoothstep(0.06, 0.15, py)
      let mossMask = 0
      if (isFlatTop > 0.005) {
        const lobeBig = fbm3(px * 3.4 + 1.1, py * 2.8, pz * 3.4 - 1.9, seed + 409, 2) * 0.024
        const lobeFine = fbm3(px * 9.2 - 2.4, py * 5.5, pz * 9.2 + 3.1, seed + 421, 2) * 0.009
        const rimInset = smoothstep(0.005, 0.024, distConvex + lobeBig + lobeFine)
        mossMask = clamp(isFlatTop * rimInset, 0, 1)
      }

      // Clean painterly sandstone wall variation: subtle horizontal sedimentary brushstrokes + broad mineral warmth + grounded lower earth tone
      const wallWeight = (1 - mossMask) * (nly < 0.88 ? 1 : 0.30)
      if (wallWeight > 0.02) {
        // Horizontal layered sandstone wash (very gentle dip, no repetitive stripes, no dark worm scribbles!)
        const dipY = py + px * 0.08 - pz * 0.05
        const horizWash = fbm3(px * 1.8 + 1.4, dipY * 9.5 - 0.8, pz * 1.8 - 1.1, seed + 521, 2)
        const broadWarm = fbm3(px * 1.6 - 2.1, py * 2.2 + 0.5, pz * 1.6 + 1.7, seed + 547, 2)
        // Subtle crisp planar chisel tonal shift (gives hand-painted faceted depth without muddy blotches)
        const chiselTone = (Math.abs(fbm3(px * 3.6 + 0.5, dipY * 4.2, pz * 3.6 - 0.7, seed + 577, 1)) - 0.25) * 0.12
        const baseDamp = 1 - smoothstep(0.0, 0.34, py)
        const wallShift = (horizWash * 0.065 + broadWarm * 0.055 + chiselTone) * detailMask * wallWeight
        r *= 1 + wallShift * 1.10 - baseDamp * 0.11
        g *= 1 + wallShift * 0.96 - baseDamp * 0.12
        b *= 1 + wallShift * 0.80 - baseDamp * 0.10

        // Gentle clean directional sandstone chisel & horizontal-strata normal relief (<= ~4.5° — crisp & clean!)
        if (opts.mode !== 'baseline' && detailMask > 0.02 && strataStrength > 0.01) {
          const tx = tanX[pix], ty = tanY[pix], tz = tanZ[pix], tw = tanW[pix]
          const bx = (nly * tz - nlz * ty) * tw
          const by = (nlz * tx - nlx * tz) * tw
          const bz = (nlx * ty - nly * tx) * tw
          const bLen = Math.hypot(bx, by, bz) || 1
          const bux = bx / bLen, buy = by / bLen, buz = bz / bLen
          const eps = 0.010
          const evalCleanRockH = (x: number, y: number, z: number) => {
            const dy = y + x * 0.08 - z * 0.05
            const hBed = fbm3(x * 1.9 + 1.4, dy * 10.5 - 0.8, z * 1.9 - 1.1, seed + 521, 1) * 0.0024
            const hChisel = Math.abs(fbm3(x * 3.6 + 0.5, dy * 4.2, z * 3.6 - 0.7, seed + 577, 1)) * 0.0032
            return hBed + hChisel
          }
          const h0 = evalCleanRockH(px, py, pz)
          const hU = evalCleanRockH(px + tx * eps, py + ty * eps, pz + tz * eps)
          const hV = evalCleanRockH(px + bux * eps, py + buy * eps, pz + buz * eps)
          const gain = 0.82 * detailMask * wallWeight * strataStrength
          const sgx = clamp(-((hU - h0) / eps) * gain, -0.078, 0.078)
          const sgy = clamp(-((hV - h0) / eps) * gain, -0.078, 0.078)
          const invL = 1 / Math.hypot(sgx, sgy, 1)
          const tnx = sgx * invL, tny = sgy * invL, tnz = invL
          const devDeg = (Math.acos(clamp(tnz, -1, 1)) * 180) / Math.PI
          if (devDeg > maxNormalDevDeg) maxNormalDevDeg = devDeg
          normal[p4] = Math.round(clamp(tnx * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 1] = Math.round(clamp(tny * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 2] = Math.round(clamp(tnz * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 3] = 255
        }
      }

      // Warm-umber stylized crevice deepening strictly in real 3D concave block seams & cleavage grooves
      const creviceAmt = smoothstep(0.85, 0.42, aoVal)
      if (creviceAmt > 0.005) {
        r = lerp(r, r * 0.62 - 9, creviceAmt * 0.72)
        g = lerp(g, g * 0.56 - 10, creviceAmt * 0.72)
        b = lerp(b, b * 0.52 - 8, creviceAmt * 0.72)
      }

      // Apply lush stylized velvety meadow-moss pad on top terraces + soft velvety tuft normal
      if (mossMask > 0.005) {
        const patchA = fbm3(px * 3.2 - 1.2, py * 2.2, pz * 3.2 + 0.9, seed + 433, 2)
        const patchB = fbm3(px * 10.5 + 4.1, py * 5.0, pz * 10.5 - 3.3, seed + 467, 2)
        const sunLift = clamp(0.46 + patchA * 0.72 + (hNorm - 0.45) * 0.26, 0, 1)
        const innerShade = smoothstep(0.54, 0.90, aoVal)
        let mr = lerp(mossR * 0.68, Math.min(255, mossR * 1.22 + 16), sunLift) + patchB * 9
        let mg = lerp(mossG * 0.74, Math.min(255, mossG * 1.15 + 12), sunLift) + patchB * 11
        let mb = lerp(mossB * 0.72, Math.min(255, mossB * 1.02 + 5), sunLift) + patchB * 4
        mr *= 0.78 + 0.22 * innerShade
        mg *= 0.80 + 0.20 * innerShade
        mb *= 0.78 + 0.22 * innerShade
        // Subtle darker grounded contact edge where thick moss turf overlaps bare sandstone rim
        const rimEdge = mossMask * (1 - mossMask) * 4
        mr = lerp(mr, mr * 0.76, rimEdge * 0.52)
        mg = lerp(mg, mg * 0.78, rimEdge * 0.52)
        mb = lerp(mb, mb * 0.72, rimEdge * 0.52)
        r = lerp(r, mr, mossMask)
        g = lerp(g, mg, mossMask)
        b = lerp(b, mb, mossMask)

        if (opts.mode !== 'baseline' && mossMask > 0.25) {
          const tx = tanX[pix], ty = tanY[pix], tz = tanZ[pix], tw = tanW[pix]
          const bx = (nly * tz - nlz * ty) * tw
          const by = (nlz * tx - nlx * tz) * tw
          const bz = (nlx * ty - nly * tx) * tw
          const bLen = Math.hypot(bx, by, bz) || 1
          const bux = bx / bLen, buy = by / bLen, buz = bz / bLen
          const eps = 0.007
          const mC = fbm3(px * 15.0, py * 10.0, pz * 15.0, seed + 487, 1)
          const mU = fbm3((px + tx * eps) * 15.0, (py + ty * eps) * 10.0, (pz + tz * eps) * 15.0, seed + 487, 1)
          const mV = fbm3((px + bux * eps) * 15.0, (py + buy * eps) * 10.0, (pz + buz * eps) * 15.0, seed + 487, 1)
          const mgx = clamp(-((mU - mC) / eps) * 0.0022 * mossMask, -0.055, 0.055)
          const mgy = clamp(-((mV - mC) / eps) * 0.0022 * mossMask, -0.055, 0.055)
          const invL = 1 / Math.hypot(mgx, mgy, 1)
          normal[p4] = Math.round(clamp(mgx * invL * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 1] = Math.round(clamp(mgy * invL * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 2] = Math.round(clamp(invL * 0.5 + 0.5, 0, 1) * 255)
          normal[p4 + 3] = 255
        }
      }
    }

    albedo[p4] = Math.round(clamp(r, 0, 255))
    albedo[p4 + 1] = Math.round(clamp(g, 0, 255))
    albedo[p4 + 2] = Math.round(clamp(b, 0, 255))
    albedo[p4 + 3] = 255
  }
  const materialMs = performance.now() - tMat0

  // -------------------------------------------------------------------------
  // Pass 4: Isolated Per-Chart Mip-Safe Dilation (fills full 12px gutter!)
  // -------------------------------------------------------------------------
  const tDil0 = performance.now()
  dilatePerChart(size, chartIdBuf, [albedo, normal, ao, roughness], dilationPasses)
  const dilationMs = performance.now() - tDil0

  // Region thin-face strip width audit (shoulder V-notch & C2 bevel faces)
  const regionAudit = (pred: (fid: number) => boolean, texels: number): PolyRegionCoverageAudit => {
    let tris = 0
    const chartSet = new Set<number>()
    for (let t = 0; t < tCount; t++) {
      if (pred(faceIds[t])) { tris++; chartSet.add(triChartIds[t]) }
    }
    let minStrip = Infinity
    for (const cid of chartSet) {
      const r = unwrapped.charts[cid].rect
      const s = Math.min(r.w, r.h)
      if (s < minStrip) minStrip = s
    }
    return {
      triangles: tris,
      coveredTexels: texels,
      minChartStripPx: Number.isFinite(minStrip) ? minStrip : 0,
      meanTexelsPerTri: tris > 0 ? Math.round((texels / tris) * 10) / 10 : 0,
    }
  }

  const totalBakeMs = performance.now() - tStart
  const safeCov = Math.max(1, coveredTexels)

  return {
    size,
    albedo,
    normal,
    ao,
    roughness,
    diagnostic,
    uvChartMap,
    stats: {
      mode: opts.mode,
      resolution: size,
      coveredTexels,
      uvFillRatio: Math.round((coveredTexels / totalPix) * 10000) / 10000,
      shoulderNotchCoverage: regionAudit(isShoulderNotchFace, notchTexels),
      bevelCoverage: regionAudit(isLocalBevelFace, bevelTexels),
      meanAo: Math.round((aoSumAll / safeCov) * 1000) / 1000,
      shoulderNotchMeanAo: notchTexels > 0 ? Math.round((notchAoSum / notchTexels) * 1000) / 1000 : 1,
      maxNormalDeviationDeg: Math.round(maxNormalDevDeg * 100) / 100,
      timings: {
        rasterMs: Math.round(rasterMs * 10) / 10,
        bvhAoMs: Math.round(bvhAoMs * 10) / 10,
        materialMs: Math.round(materialMs * 10) / 10,
        dilationMs: Math.round(dilationMs * 10) / 10,
        totalBakeMs: Math.round(totalBakeMs * 10) / 10,
      },
    },
  }
}

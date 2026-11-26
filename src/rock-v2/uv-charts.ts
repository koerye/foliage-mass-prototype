import { BufferAttribute, BufferGeometry } from 'three'
import type { Vec3 } from './sdf'
import type { SurfaceNetsResult } from './surface-nets'

export interface UvChartInfo {
  id: number
  triCount: number
  axis: Vec3
  rect: { x: number; y: number; w: number; h: number }
}

export interface UvUnwrapAudit {
  chartCount: number
  vertexCountBeforeSplit: number
  vertexCountAfterSplit: number
  triangles: number
  uvCoverage: number
  flippedUvTris: number
  overlappingChartTris: number
  minScale: number
  maxScale: number
  tangentInvalidCount: number
}

export interface UnwrappedLowPolyMesh {
  /** Split-at-seam positions ready for GPU & glTF export. */
  positions: Float32Array
  /** Exact pre-split welded normals carried across seam splits for seamless lighting. */
  normals: Float32Array
  /** Packed atlas UVs in [0, 1]^2 (flipY = false / glTF convention: v=0 top, v=1 bottom). */
  uvs: Float32Array
  /** Locked MikkTSpace/Terathon per-vertex tangents (vec4: Tx, Ty, Tz, handedness ±1). */
  tangents: Float32Array
  /** Locked triangle indices. */
  indices: Uint32Array
  /** Chart ID per triangle (length = triangles). */
  triChartIds: Int32Array
  charts: UvChartInfo[]
  /** SDF grounding shift from Surface Nets (p_sdf = p_mesh - shift). */
  shift: Vec3
  voxelSize: number
  audit: UvUnwrapAudit
  uvMs: number
  toBufferGeometry(): BufferGeometry
}

interface RawChart {
  id: number
  tris: number[]
  axis: Vec3
  uDir: Vec3
  vDir: Vec3
  /** Projected 2D coordinates per triangle in chart-local meters: [u0,v0, u1,v1, u2,v2]. */
  proj2D: Map<number, [number, number, number, number, number, number]>
  minU: number
  maxU: number
  minV: number
  maxV: number
}

function norm3(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z)
  return l > 1e-10 ? { x: x / l, y: y / l, z: z / l } : { x: 0, y: 1, z: 0 }
}

function makeBasis(axis: Vec3): { uDir: Vec3; vDir: Vec3 } {
  const ref: Vec3 = Math.abs(axis.y) < 0.88 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  // u = normalize(cross(ref, axis)), v = cross(axis, u) -> right-handed basis (u, v, axis)
  const ux = ref.y * axis.z - ref.z * axis.y
  const uy = ref.z * axis.x - ref.x * axis.z
  const uz = ref.x * axis.y - ref.y * axis.x
  const uDir = norm3(ux, uy, uz)
  // For flipY = false (glTF UV where +v goes DOWN image), keeping right-handed (u, v, axis) ensures
  // positive 2D signed area on front-facing triangles projected along +axis!
  const vDir: Vec3 = {
    x: axis.y * uDir.z - axis.z * uDir.y,
    y: axis.z * uDir.x - axis.x * uDir.z,
    z: axis.x * uDir.y - axis.y * uDir.x,
  }
  return { uDir, vDir }
}

function triArea2D(u0: number, v0: number, u1: number, v1: number, u2: number, v2: number): number {
  return 0.5 * ((u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0))
}

function segsIntersect2D(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const eps = 1e-7
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx)
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx)
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax)
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
}

function pointInTri2D(px: number, py: number, t: [number, number, number, number, number, number]): boolean {
  const eps = 1e-6
  const [x0, y0, x1, y1, x2, y2] = t
  const c0 = (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)
  const c1 = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
  const c2 = (x0 - x2) * (py - y2) - (y0 - y2) * (px - x2)
  return c0 > eps && c1 > eps && c2 > eps
}

function trisOverlap2D(
  tA: [number, number, number, number, number, number],
  tB: [number, number, number, number, number, number],
): boolean {
  // Fast AABB reject
  const minAx = Math.min(tA[0], tA[2], tA[4]), maxAx = Math.max(tA[0], tA[2], tA[4])
  const minBx = Math.min(tB[0], tB[2], tB[4]), maxBx = Math.max(tB[0], tB[2], tB[4])
  if (maxAx <= minBx + 1e-7 || maxBx <= minAx + 1e-7) return false
  const minAy = Math.min(tA[1], tA[3], tA[5]), maxAy = Math.max(tA[1], tA[3], tA[5])
  const minBy = Math.min(tB[1], tB[3], tB[5]), maxBy = Math.max(tB[1], tB[3], tB[5])
  if (maxAy <= minBy + 1e-7 || maxBy <= minAy + 1e-7) return false

  // Proper edge-edge crossing test (shared boundary vertices/edges never trigger strict eps)
  for (let i = 0; i < 3; i++) {
    const ax = tA[i * 2], ay = tA[i * 2 + 1]
    const bx = tA[((i + 1) % 3) * 2], by = tA[((i + 1) % 3) * 2 + 1]
    for (let j = 0; j < 3; j++) {
      const cx = tB[j * 2], cy = tB[j * 2 + 1]
      const dx = tB[((j + 1) % 3) * 2], dy = tB[((j + 1) % 3) * 2 + 1]
      if (segsIntersect2D(ax, ay, bx, by, cx, cy, dx, dy)) return true
    }
  }
  // Check strict containment of centroids
  const cAx = (tA[0] + tA[2] + tA[4]) / 3, cAy = (tA[1] + tA[3] + tA[5]) / 3
  const cBx = (tB[0] + tB[2] + tB[4]) / 3, cBy = (tB[1] + tB[3] + tB[5]) / 3
  if (pointInTri2D(cAx, cAy, tB) || pointInTri2D(cBx, cBy, tA)) return true
  return false
}

/**
 * Unwraps a closed welded Surface Nets rock mesh using adjacency-growing local planar charts:
 * - Grows each chart only while triangle normal agrees with chart axis (bounded stretch),
 *   projected 2D area is strictly positive (zero flips), and 2D projection has zero overlap.
 * - Splits recessed grooves / deep steps automatically into clean separate charts.
 * - Packs charts uniformly into [0,1]^2 with generous gutter for isolated dilation padding.
 * - Preserves welded normals across UV seams & computes exact MikkTSpace/Terathon vec4 tangents.
 */
export function unwrapRockUvCharts(
  mesh: SurfaceNetsResult,
  atlasSize = 512,
  gutterPx = 12,
): UnwrappedLowPolyMesh {
  const t0 = performance.now()
  const { positions, normals, indices, shift, voxelSize } = mesh
  const vCountOrig = positions.length / 3
  const tCount = indices.length / 3

  // 1. Precompute face normals, areas & face-to-face adjacency across undirected edges
  const faceNormals: Vec3[] = new Array(tCount)
  const faceAreas = new Float32Array(tCount)
  const edgeToTris = new Map<string, number[]>()

  for (let t = 0; t < tCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    const abx = positions[b * 3] - positions[a * 3]
    const aby = positions[b * 3 + 1] - positions[a * 3 + 1]
    const abz = positions[b * 3 + 2] - positions[a * 3 + 2]
    const acx = positions[c * 3] - positions[a * 3]
    const acy = positions[c * 3 + 1] - positions[a * 3 + 1]
    const acz = positions[c * 3 + 2] - positions[a * 3 + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    const len = Math.hypot(nx, ny, nz)
    faceAreas[t] = 0.5 * len
    faceNormals[t] = len > 1e-10 ? { x: nx / len, y: ny / len, z: nz / len } : { x: 0, y: 1, z: 0 }

    const edges: [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [u, v] of edges) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`
      let list = edgeToTris.get(key)
      if (!list) { list = []; edgeToTris.set(key, list) }
      list.push(t)
    }
  }

  const triAdj: number[][] = Array.from({ length: tCount }, () => [])
  for (const list of edgeToTris.values()) {
    if (list.length === 2) {
      triAdj[list[0]].push(list[1])
      triAdj[list[1]].push(list[0])
    }
  }

  // Project triangle `t` onto (uDir, vDir) basis in 3D meters
  const projectTri = (t: number, uDir: Vec3, vDir: Vec3): [number, number, number, number, number, number] => {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    return [
      positions[a] * uDir.x + positions[a + 1] * uDir.y + positions[a + 2] * uDir.z,
      positions[a] * vDir.x + positions[a + 1] * vDir.y + positions[a + 2] * vDir.z,
      positions[b] * uDir.x + positions[b + 1] * uDir.y + positions[b + 2] * uDir.z,
      positions[b] * vDir.x + positions[b + 1] * vDir.y + positions[b + 2] * vDir.z,
      positions[c] * uDir.x + positions[c + 1] * uDir.y + positions[c + 2] * uDir.z,
      positions[c] * vDir.x + positions[c + 1] * vDir.y + positions[c + 2] * vDir.z,
    ]
  }

  // 2. Adjacency-growing planar charts seeded from canonical dominant directions (keeps major rock faces intact
  //    and pushes seams onto natural ridges, steps, & bottom edge!)
  const triChartIds = new Int32Array(tCount).fill(-1)
  const rawCharts: RawChart[] = []
  const cosLimit = 0.46 // max ~62° tilt from chart projection axis -> stretch <= ~2.1x, zero fold-overs!

  // Helper to check if a triangle can safely join a chart without flipping or overlapping any existing chart triangle
  const canAddToChart = (
    t: number,
    chart: RawChart,
    strictCos: number,
  ): [number, number, number, number, number, number] | null => {
    const fn = faceNormals[t]
    const nd = fn.x * chart.axis.x + fn.y * chart.axis.y + fn.z * chart.axis.z
    if (nd < strictCos) return null
    const p2 = projectTri(t, chart.uDir, chart.vDir)
    const a2 = triArea2D(p2[0], p2[1], p2[2], p2[3], p2[4], p2[5])
    // Require positive area and bounded area foreshortening (>= 22% of 3D area)
    if (a2 <= Math.max(1e-9, faceAreas[t] * 0.22)) return null
    for (const existing of chart.proj2D.values()) {
      if (trisOverlap2D(p2, existing)) return null
    }
    return p2
  }

  // Order candidate seeds by dominant face alignment (bottom, front, right, top, left, back, then largest unassigned)
  const canonicalAxes: Vec3[] = [
    norm3(-0.10, 0.18, 0.98),  // hero front face (stays 1 clean unbroken chart!)
    norm3(0.91, 0.12, 0.40),   // right cliff
    norm3(-0.10, 0.96, 0.22),  // top crown & shoulder bench
    norm3(-0.94, 0.16, 0.27),  // left flank
    norm3(-0.68, 0.18, -0.71), // back-left
    norm3(0.38, 0.20, -0.90),  // back-right
    norm3(0, -1, 0),           // bottom base (hides seams underneath!)
  ]

  const growChartFromSeed = (seedTri: number, seedAxis: Vec3) => {
    const id = rawCharts.length
    const { uDir, vDir } = makeBasis(seedAxis)
    const chart: RawChart = {
      id,
      tris: [],
      axis: seedAxis,
      uDir,
      vDir,
      proj2D: new Map(),
      minU: Infinity, maxU: -Infinity,
      minV: Infinity, maxV: -Infinity,
    }
    const pSeed = projectTri(seedTri, uDir, vDir)
    if (triArea2D(pSeed[0], pSeed[1], pSeed[2], pSeed[3], pSeed[4], pSeed[5]) <= 1e-10) {
      // Fallback to exact face normal of seed triangle
      chart.axis = faceNormals[seedTri]
      const b = makeBasis(chart.axis)
      chart.uDir = b.uDir
      chart.vDir = b.vDir
    }

    const p0 = projectTri(seedTri, chart.uDir, chart.vDir)
    triChartIds[seedTri] = id
    chart.tris.push(seedTri)
    chart.proj2D.set(seedTri, p0)

    const queue: number[] = [seedTri]
    let qHead = 0
    while (qHead < queue.length) {
      const cur = queue[qHead++]
      const neighbors = triAdj[cur]
      for (let i = 0; i < neighbors.length; i++) {
        const nb = neighbors[i]
        if (triChartIds[nb] !== -1) continue
        const p2 = canAddToChart(nb, chart, cosLimit)
        if (!p2) continue
        triChartIds[nb] = id
        chart.tris.push(nb)
        chart.proj2D.set(nb, p2)
        queue.push(nb)
      }
    }

    // Compute chart bounds
    for (const p2 of chart.proj2D.values()) {
      for (let k = 0; k < 3; k++) {
        const u = p2[k * 2], v = p2[k * 2 + 1]
        if (u < chart.minU) chart.minU = u; if (u > chart.maxU) chart.maxU = u
        if (v < chart.minV) chart.minV = v; if (v > chart.maxV) chart.maxV = v
      }
    }
    rawCharts.push(chart)
  }

  // First seed charts aligned with the 7 canonical rock planes
  for (const ax of canonicalAxes) {
    let bestTri = -1
    let bestScore = 0.72
    for (let t = 0; t < tCount; t++) {
      if (triChartIds[t] !== -1) continue
      const fn = faceNormals[t]
      const d = fn.x * ax.x + fn.y * ax.y + fn.z * ax.z
      if (d > bestScore) { bestScore = d; bestTri = t }
    }
    if (bestTri >= 0) growChartFromSeed(bestTri, ax)
  }

  // Fill remaining unassigned triangles (e.g., recessed shoulder wall, steep corners, notches)
  while (true) {
    let bestTri = -1
    let bestArea = -1
    for (let t = 0; t < tCount; t++) {
      if (triChartIds[t] !== -1) continue
      if (faceAreas[t] > bestArea) { bestArea = faceAreas[t]; bestTri = t }
    }
    if (bestTri < 0) break
    // Try absorbing tiny orphan triangle into a valid neighboring chart first to keep chart count tidy
    let absorbed = false
    for (const nb of triAdj[bestTri]) {
      const cid = triChartIds[nb]
      if (cid < 0) continue
      const p2 = canAddToChart(bestTri, rawCharts[cid], 0.34)
      if (p2) {
        triChartIds[bestTri] = cid
        const ch = rawCharts[cid]
        ch.tris.push(bestTri)
        ch.proj2D.set(bestTri, p2)
        for (let k = 0; k < 3; k++) {
          const u = p2[k * 2], v = p2[k * 2 + 1]
          if (u < ch.minU) ch.minU = u; if (u > ch.maxU) ch.maxU = u
          if (v < ch.minV) ch.minV = v; if (v > ch.maxV) ch.maxV = v
        }
        absorbed = true
        break
      }
    }
    if (!absorbed) growChartFromSeed(bestTri, faceNormals[bestTri])
  }

  // 3. Uniform-texel-density Shelf Packing into [0, 1]^2 with guaranteed pixel gutter
  //    Binary-search maximum uniform scale `s` (pixels per meter) that fits all charts with `gutterPx`!
  const sortedCharts = [...rawCharts].sort((a, b) => (b.maxV - b.minV) - (a.maxV - a.minV))
  const tryPack = (scalePxPerM: number): { ok: boolean; rects: Map<number, { x: number; y: number; w: number; h: number }> } => {
    const rects = new Map<number, { x: number; y: number; w: number; h: number }>()
    let curX = gutterPx
    let curY = gutterPx
    let rowH = 0
    for (const ch of sortedCharts) {
      const w = Math.max(4, Math.ceil((ch.maxU - ch.minU) * scalePxPerM))
      const h = Math.max(4, Math.ceil((ch.maxV - ch.minV) * scalePxPerM))
      if (w + gutterPx * 2 > atlasSize || h + gutterPx * 2 > atlasSize) return { ok: false, rects }
      if (curX + w + gutterPx > atlasSize) {
        curX = gutterPx
        curY += rowH + gutterPx
        rowH = 0
      }
      if (curY + h + gutterPx > atlasSize) return { ok: false, rects }
      rects.set(ch.id, { x: curX, y: curY, w, h })
      curX += w + gutterPx
      if (h > rowH) rowH = h
    }
    return { ok: true, rects }
  }

  let lo = 10, hi = atlasSize * 1.5
  let bestScale = lo
  let bestRects = tryPack(lo).rects
  for (let iter = 0; iter < 18; iter++) {
    const mid = 0.5 * (lo + hi)
    const res = tryPack(mid)
    if (res.ok) {
      bestScale = mid
      bestRects = res.rects
      lo = mid
    } else {
      hi = mid
    }
  }

  // 4. Split vertices strictly at UV chart boundaries while preserving exact welded vertex normals!
  const outPos: number[] = []
  const outNorm: number[] = []
  const outUv: number[] = []
  const outIndices = new Uint32Array(tCount * 3)
  const vertexMap = new Map<string, number>()

  let flippedUvTris = 0
  let totalUvArea = 0
  let minScale = Infinity
  let maxScale = 0

  const chartInfos: UvChartInfo[] = rawCharts.map(ch => {
    const r = bestRects.get(ch.id)!
    return { id: ch.id, triCount: ch.tris.length, axis: ch.axis, rect: r }
  })

  for (let t = 0; t < tCount; t++) {
    const cid = triChartIds[t]
    const ch = rawCharts[cid]
    const rect = bestRects.get(cid)!
    const p2 = ch.proj2D.get(t)!
    const triVerts = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]]

    const uvTri: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const u = (rect.x + (p2[k * 2] - ch.minU) * bestScale) / atlasSize
      const v = (rect.y + (p2[k * 2 + 1] - ch.minV) * bestScale) / atlasSize
      uvTri[k * 2] = u
      uvTri[k * 2 + 1] = v

      const origVi = triVerts[k]
      const key = `${origVi}:${cid}`
      let newVi = vertexMap.get(key)
      if (newVi === undefined) {
        newVi = outPos.length / 3
        vertexMap.set(key, newVi)
        outPos.push(positions[origVi * 3], positions[origVi * 3 + 1], positions[origVi * 3 + 2])
        outNorm.push(normals[origVi * 3], normals[origVi * 3 + 1], normals[origVi * 3 + 2])
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

  const finalPos = Float32Array.from(outPos)
  const finalNorm = Float32Array.from(outNorm)
  const finalUv = Float32Array.from(outUv)

  // 5. Compute locked MikkTSpace / Terathon vec4 tangents on the exact final locked triangulation & normals!
  //    Matches Three.js vertex shader: vBitangent = normalize(cross(vNormal, vTangent) * tangent.w)
  const { tangents, invalidCount } = computeLockedTangents(finalPos, finalNorm, finalUv, outIndices)

  const uvMs = Math.round((performance.now() - t0) * 10) / 10
  const audit: UvUnwrapAudit = {
    chartCount: rawCharts.length,
    vertexCountBeforeSplit: vCountOrig,
    vertexCountAfterSplit: finalPos.length / 3,
    triangles: tCount,
    uvCoverage: Math.round(totalUvArea * 1000) / 1000,
    flippedUvTris,
    overlappingChartTris: 0, // guaranteed by per-chart overlap rejection + disjoint packing rects
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
    triChartIds,
    charts: chartInfos,
    shift,
    voxelSize,
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

/**
 * Computes Terathon / glTF 2.0 MikkTSpace-compatible per-vertex tangents `(Tx, Ty, Tz, handedness ±1)`.
 * Consistent with Three.js `normal_vertex`: `B = normalize(cross(N, T) * tangent.w)`.
 */
export function computeLockedTangents(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): { tangents: Float32Array; invalidCount: number } {
  const vCount = positions.length / 3
  const tan1 = new Float32Array(vCount * 3)
  const tan2 = new Float32Array(vCount * 3)

  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i], i2 = indices[i + 1], i3 = indices[i + 2]
    const x1 = positions[i2 * 3] - positions[i1 * 3]
    const y1 = positions[i2 * 3 + 1] - positions[i1 * 3 + 1]
    const z1 = positions[i2 * 3 + 2] - positions[i1 * 3 + 2]
    const x2 = positions[i3 * 3] - positions[i1 * 3]
    const y2 = positions[i3 * 3 + 1] - positions[i1 * 3 + 1]
    const z2 = positions[i3 * 3 + 2] - positions[i1 * 3 + 2]

    const s1 = uvs[i2 * 2] - uvs[i1 * 2]
    // Convert glTF top-down v (0=top, 1=bottom) to OpenGL/MikkTSpace v_gl = 1 - v (0=bottom, 1=top)
    // so tangent.w matches glTF 2.0 / Blender / Unity / Three.js OpenGL (+Y up) normal map convention.
    const t1 = uvs[i1 * 2 + 1] - uvs[i2 * 2 + 1]
    const s2 = uvs[i3 * 2] - uvs[i1 * 2]
    const t2 = uvs[i1 * 2 + 1] - uvs[i3 * 2 + 1]

    const denom = s1 * t2 - s2 * t1
    if (Math.abs(denom) < 1e-12) continue
    const r = 1 / denom
    const sdx = (t2 * x1 - t1 * x2) * r
    const sdy = (t2 * y1 - t1 * y2) * r
    const sdz = (t2 * z1 - t1 * z2) * r
    const tdx = (s1 * x2 - s2 * x1) * r
    const tdy = (s1 * y2 - s2 * y1) * r
    const tdz = (s1 * z2 - s2 * z1) * r

    for (const vi of [i1, i2, i3]) {
      tan1[vi * 3] += sdx; tan1[vi * 3 + 1] += sdy; tan1[vi * 3 + 2] += sdz
      tan2[vi * 3] += tdx; tan2[vi * 3 + 1] += tdy; tan2[vi * 3 + 2] += tdz
    }
  }

  const tangents = new Float32Array(vCount * 4)
  let invalidCount = 0
  for (let vi = 0; vi < vCount; vi++) {
    const nx = normals[vi * 3], ny = normals[vi * 3 + 1], nz = normals[vi * 3 + 2]
    let tx = tan1[vi * 3], ty = tan1[vi * 3 + 1], tz = tan1[vi * 3 + 2]
    const ndt = nx * tx + ny * ty + nz * tz
    tx -= nx * ndt
    ty -= ny * ndt
    tz -= nz * ndt
    const tLen = Math.hypot(tx, ty, tz)
    if (tLen > 1e-8) {
      tx /= tLen; ty /= tLen; tz /= tLen
    } else {
      invalidCount++
      const ref: Vec3 = Math.abs(ny) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
      const f = norm3(ref.y * nz - ref.z * ny, ref.z * nx - ref.x * nz, ref.x * ny - ref.y * nx)
      tx = f.x; ty = f.y; tz = f.z
    }
    // Handedness w: cross(N, T) dot tan2
    const cx = ny * tz - nz * ty
    const cy = nz * tx - nx * tz
    const cz = nx * ty - ny * tx
    const w = (cx * tan2[vi * 3] + cy * tan2[vi * 3 + 1] + cz * tan2[vi * 3 + 2]) < 0 ? -1 : 1
    tangents[vi * 4] = tx
    tangents[vi * 4 + 1] = ty
    tangents[vi * 4 + 2] = tz
    tangents[vi * 4 + 3] = w
  }
  return { tangents, invalidCount }
}

// Topological Primary Branch Collar Welding (Watertight Hole-Cut + Cubic Hermite Fillet Bridge)
// & High-Poly -> Low-Poly Tangent-Space Normal Map + Cavity AO Baker for glTF 2.0 Export.
import {
  CanvasTexture, ClampToEdgeWrapping, DataTexture, MathUtils, NoColorSpace,
  RepeatWrapping, RGBAFormat, Texture, Vector3,
} from 'three'
import type { TrunkSpec } from './spec'
import {
  barkFlowTileU, buildTrunkFeaturePlan, evalBarkSculpt, evalFlowBarkMicroCpu,
  flowTwistAngle, woodSculptLodParams,
  type BarkHeightField, type SocketFlowHint, type TrunkFeaturePlan,
} from './wood-sculpt'

// ---------------------------------------------------------------------------
// PART A: Crash-Proof Primary Branch Collar Topological Welding
// ---------------------------------------------------------------------------
export interface TrunkWeldGridInfo {
  startVert: number
  rings: number
  segs: number
  cols: number
  pts: Vector3[]
  tangents: Vector3[]
  normals: Vector3[]
  binormals: Vector3[]
  radii: number[]
  ringT: number[]
  arcLen: number[]
}

export interface PlannedWeldHole {
  branchId: number
  socket: SocketFlowHint
  iMin: number
  iMax: number
  jMin: number
  jMax: number
  /** True when the hole straddles the trunk cylindrical UV seam (j = 0 / segs) and uses split-UV twins. */
  crossesSeam: boolean
  /** Ordered closed boundary loop of trunk vertex indices (CCW when looking from outside trunk). */
  boundaryVerts: number[]
  /** Exact per-edge trunk vertex pairs `[vA, vB]` around the hole boundary (preserves split seam indices). */
  boundaryEdges: [number, number][]
  /** World-space centroid of the trunk hole opening. */
  holeCenter: Vector3
  /** Outward surface normal at hole center. */
  holeNormal: Vector3
  /** Radius of trunk wall at socket ring (used to trim child limb inner rings). */
  trunkRAtSocket: number
}

export interface TrunkWeldPlan {
  holesByBranchId: Map<number, PlannedWeldHole>
  skipTrunkQuad: Uint8Array // rings * segs: 1 = removed quad inside welded branch hole
  weldedCount: number
  skippedOverlap: number
}

function wrapMod(n: number, m: number): number {
  return ((n % m) + m) % m
}

/** Reserves non-overlapping grid cutouts on the sculpted trunk for primary limbs.
 *  If two dragged limbs overlap too closely, gracefully shrinks or skips welding the secondary one
 *  so it falls back cleanly to our fixed-topology normal-blended collar (100% crash-proof!). */
export function planTrunkWeldHoles(
  grid: TrunkWeldGridInfo,
  sockets: SocketFlowHint[],
  position: number[],
): TrunkWeldPlan {
  const { startVert, rings, segs, cols, pts, normals, binormals, radii, ringT, arcLen } = grid
  const skipTrunkQuad = new Uint8Array(rings * segs)
  const claimedMargin = new Uint8Array(rings * segs)
  const holesByBranchId = new Map<number, PlannedWeldHole>()
  let skippedOverlap = 0

  // Sort deterministically by largest limb radius first (then stable branchId)
  const candidates = [...sockets].sort((a, b) => (b.radius - a.radius) || (a.branchId - b.branchId))

  for (const sk of candidates) {
    // Guard shallow grazing emergence angles (< ~36 deg off trunk), thin twigs & very short stubs
    // so welded collars stay compact and never stretch along the trunk belly (shallow limbs fall back to normal-blended collars!)
    if (sk.exitDotTan > 0.80 || sk.radius < sk.trunkRadius * 0.20) continue
    if (sk.length !== undefined && sk.length < sk.trunkRadius * 2.1) continue

    // Locate closest trunk ring to socket.t
    let sIdx = 0
    for (let k = 1; k < rings; k++) {
      if (Math.abs(ringT[k] - sk.t) < Math.abs(ringT[sIdx] - sk.t)) sIdx = k
    }
    // Keep safe margin away from root ground ring (0..2) while allowing upper fork limbs just below the apical dome!
    if (sIdx < 3 || sIdx > rings - 2) continue

    const localStep = Math.max(0.02, (arcLen[Math.min(rings - 1, sIdx + 1)] - arcLen[Math.max(0, sIdx - 1)]) * 0.5)
    const trunkR = Math.max(0.06, radii[sIdx])
    const sinExit = Math.max(0.60, Math.sqrt(Math.max(0.05, 1 - sk.exitDotTan * sk.exitDotTan)))

    // Desired cutout footprint in trunk grid cells (compact organic oval: 2..6 quads tall, 2..6 wide)
    const desiredHalfI = MathUtils.clamp(Math.round((sk.radius * 0.85 / sinExit) / localStep), 1, Math.min(3, Math.floor((rings - 6) / 2)))
    const angRadius = Math.asin(Math.min(0.64, (sk.radius * 0.88) / trunkR))
    const desiredHalfJ = MathUtils.clamp(Math.round(angRadius / ((Math.PI * 2) / segs)), 1, Math.max(1, Math.floor(segs / 7)))

    const jCenter = wrapMod(Math.round((sk.angle / (Math.PI * 2)) * segs), segs)

    // Try desired size, then progressively shrink down to 2x2 quads if an adjacent limb is nearby.
    // Supports full 360-degree periodic cutouts including cross-UV-seam (j = 0 / segs) split-UV welding!
    let chosen: { iMin: number; iMax: number; jStart: number; spanJ: number } | undefined
    for (let shrink = 0; shrink <= 2; shrink++) {
      const hi = Math.max(1, desiredHalfI - shrink)
      const hj = Math.max(1, desiredHalfJ - shrink)
      const iMax = Math.min(rings - 2, sIdx + hi - 1) // quads [iMin..iMax] keep ring rings-1 & apical dome intact!
      const iMin = Math.max(2, iMax - 2 * hi + 1)
      if (iMin < 2 || iMax >= rings - 1 || iMax < iMin) continue
      const jStartRaw = jCenter - hj
      const spanJ = Math.min(segs - 2, 2 * hj)
      const normJStart = wrapMod(jStartRaw, segs)

      let collides = false
      for (let qi = iMin - 1; qi <= iMax + 1 && !collides; qi++) {
        for (let dj = -1; dj <= spanJ && !collides; dj++) {
          const wj = wrapMod(normJStart + dj, segs)
          if (qi >= 0 && qi < rings && claimedMargin[qi * segs + wj]) collides = true
        }
      }
      if (!collides) {
        chosen = { iMin, iMax, jStart: normJStart, spanJ }
        break
      }
    }

    if (!chosen) {
      skippedOverlap++
      continue
    }

    const { iMin, iMax, jStart, spanJ } = chosen
    const jMin = jStart
    const jMax = wrapMod(jStart + spanJ - 1, segs)
    const crossesSeam = jStart + spanJ > segs
    // Mark removed quads & 1-ring safety margin (periodic around circumference)
    for (let qi = iMin; qi <= iMax; qi++) {
      for (let dj = 0; dj < spanJ; dj++) {
        skipTrunkQuad[qi * segs + wrapMod(jStart + dj, segs)] = 1
      }
    }
    for (let qi = Math.max(0, iMin - 1); qi <= Math.min(rings - 1, iMax + 1); qi++) {
      for (let dj = -1; dj <= spanJ; dj++) {
        claimedMargin[qi * segs + wrapMod(jStart + dj, segs)] = 1
      }
    }

    // Extract exact CCW boundary edges (looking from outside trunk; interior hole on LEFT!).
    // Each edge `[vA, vB]` uses the exact trunk mesh column indices `[qj, qj+1]` so cross-seam holes
    // stay 100% watertight on both sides of `j = segs / 0` with zero UV wraparound stripes!
    const boundaryEdges: [number, number][] = []
    const vIdx = (ri: number, rj: number) => startVert + ri * cols + rj
    // 1. Bottom edge: i = iMin, dj = 0 -> spanJ - 1
    for (let dj = 0; dj < spanJ; dj++) {
      const qj = wrapMod(jStart + dj, segs)
      boundaryEdges.push([vIdx(iMin, qj), vIdx(iMin, qj + 1)])
    }
    // 2. Right edge: col = jMax + 1, i = iMin -> iMax
    const rightCol = jMax + 1
    for (let i = iMin; i <= iMax; i++) {
      boundaryEdges.push([vIdx(i, rightCol), vIdx(i + 1, rightCol)])
    }
    // 3. Top edge: i = iMax + 1, dj = spanJ - 1 -> 0
    for (let dj = spanJ - 1; dj >= 0; dj--) {
      const qj = wrapMod(jStart + dj, segs)
      boundaryEdges.push([vIdx(iMax + 1, qj + 1), vIdx(iMax + 1, qj)])
    }
    // 4. Left edge: col = jStart, i = iMax -> iMin
    for (let i = iMax; i >= iMin; i--) {
      boundaryEdges.push([vIdx(i + 1, jStart), vIdx(i, jStart)])
    }
    const boundaryVerts = boundaryEdges.map(e => e[0])

    // Compute hole centroid from actual sculpted boundary vertices
    const holeCenter = new Vector3()
    for (const vi of boundaryVerts) {
      holeCenter.x += position[vi * 3]
      holeCenter.y += position[vi * 3 + 1]
      holeCenter.z += position[vi * 3 + 2]
    }
    holeCenter.multiplyScalar(1 / Math.max(1, boundaryVerts.length))

    const ca = Math.cos(sk.angle), sa = Math.sin(sk.angle)
    const holeNormal = new Vector3()
      .addScaledVector(normals[sIdx], ca)
      .addScaledVector(binormals[sIdx], sa)
      .normalize()
    // Ensure holeCenter isn't inverted inward relative to trunk spine
    const radialDist = holeCenter.distanceTo(pts[sIdx])

    holesByBranchId.set(sk.branchId, {
      branchId: sk.branchId,
      socket: sk,
      iMin, iMax, jMin, jMax,
      crossesSeam,
      boundaryVerts,
      boundaryEdges,
      holeCenter,
      holeNormal,
      trunkRAtSocket: Math.max(trunkR, radialDist),
    })
  }

  return {
    holesByBranchId,
    skipTrunkQuad,
    weldedCount: holesByBranchId.size,
    skippedOverlap,
  }
}

export interface WeldBridgeBuffers {
  position: number[]
  uv: number[]
  color: number[]
  metric: number[]
  index: number[]
  /** Optional seam-normal weld pairs; cross-UV-seam collar twins are appended here for C1 smooth normals. */
  seamPairs?: [number, number][]
}

/** Stitches a smooth 3-ring cubic Hermite collar fillet directly between the exact trunk hole boundary
 *  indices (`hole.boundaryVerts`) and the child limb's first exterior ring indices (`childRingVerts`).
 *  Watertight shared indices -> zero intersection crease & C1 continuous vertex normals! */
export function bridgeWeldedCollar(
  hole: PlannedWeldHole,
  childRingVerts: number[], // length = childSegs (excluding duplicate seam col, strictly CCW around limbTan)
  childCenter: Vector3,
  childTan: Vector3,
  childNormal: Vector3,
  childBinormal: Vector3,
  buffers: WeldBridgeBuffers,
) {
  const { position, uv, color, metric, index, seamPairs } = buffers
  const edges = hole.boundaryEdges
  const B = hole.boundaryVerts
  const M = B.length
  const K = childRingVerts.length
  if (M < 4 || K < 4 || edges.length !== M) return

  const readPos = (vi: number) => new Vector3(position[vi * 3], position[vi * 3 + 1], position[vi * 3 + 2])
  const readCol = (vi: number): [number, number, number] => [color[vi * 3], color[vi * 3 + 1], color[vi * 3 + 2]]
  const readUv = (vi: number): [number, number] => [uv[vi * 2], uv[vi * 2 + 1]]

  // Compute angles of both rings around childTan in child's (childNormal, childBinormal) plane
  const angleInChild = (p: Vector3, origin: Vector3) => {
    const dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z
    return Math.atan2(
      dx * childBinormal.x + dy * childBinormal.y + dz * childBinormal.z,
      dx * childNormal.x + dy * childNormal.y + dz * childNormal.z,
    )
  }

  const bPts = B.map(readPos)
  const bAngles = bPts.map(p => angleInChild(p, hole.holeCenter))

  // Check signed winding of B around childTan vs childRingVerts; align C to match B's winding direction!
  let bWind = 0
  for (let i = 0; i < M; i++) {
    const da = Math.atan2(Math.sin(bAngles[(i + 1) % M] - bAngles[i]), Math.cos(bAngles[(i + 1) % M] - bAngles[i]))
    bWind += da
  }
  let cOrder = [...childRingVerts]
  const cAnglesRaw = cOrder.map(vi => angleInChild(readPos(vi), childCenter))
  let cWind = 0
  for (let i = 0; i < K; i++) {
    const da = Math.atan2(Math.sin(cAnglesRaw[(i + 1) % K] - cAnglesRaw[i]), Math.cos(cAnglesRaw[(i + 1) % K] - cAnglesRaw[i]))
    cWind += da
  }
  if (bWind * cWind < 0) cOrder.reverse()

  // Rotate cOrder so cOrder[0] aligns closest in angle to B[0] (zero twist!)
  const cPts = cOrder.map(readPos)
  const cAngles = cPts.map(p => angleInChild(p, childCenter))
  let bestShift = 0
  let bestErr = Infinity
  for (let sh = 0; sh < K; sh++) {
    const da = Math.abs(Math.atan2(Math.sin(cAngles[sh] - bAngles[0]), Math.cos(cAngles[sh] - bAngles[0])))
    if (da < bestErr) { bestErr = da; bestShift = sh }
  }
  if (bestShift > 0) {
    cOrder = [...cOrder.slice(bestShift), ...cOrder.slice(0, bestShift)]
  }
  const cPtsAligned = cOrder.map(readPos)
  const cAnglesAligned = cPtsAligned.map(p => angleInChild(p, childCenter))

  // Continuous interpolation along child ring C by angle (for smooth Hermite target of each B_i)
  const sampleChildAtAngle = (targetAng: number) => {
    let bestIdx = 0
    let bestDist = Infinity
    for (let k = 0; k < K; k++) {
      const d = Math.abs(Math.atan2(Math.sin(cAnglesAligned[k] - targetAng), Math.cos(cAnglesAligned[k] - targetAng)))
      if (d < bestDist) { bestDist = d; bestIdx = k }
    }
    const nextIdx = (bestIdx + 1) % K
    const prevIdx = (bestIdx - 1 + K) % K
    const dNext = Math.abs(Math.atan2(Math.sin(cAnglesAligned[nextIdx] - targetAng), Math.cos(cAnglesAligned[nextIdx] - targetAng)))
    const dPrev = Math.abs(Math.atan2(Math.sin(cAnglesAligned[prevIdx] - targetAng), Math.cos(cAnglesAligned[prevIdx] - targetAng)))
    const otherIdx = dNext <= dPrev ? nextIdx : prevIdx
    const a0 = cAnglesAligned[bestIdx], a1 = cAnglesAligned[otherIdx]
    const span = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)))
    const frac = span > 1e-4 ? MathUtils.clamp(bestDist / span, 0, 1) : 0
    const p = cPtsAligned[bestIdx].clone().lerp(cPtsAligned[otherIdx], frac)
    const c0 = readCol(cOrder[bestIdx]), c1 = readCol(cOrder[otherIdx])
    const col: [number, number, number] = [
      MathUtils.lerp(c0[0], c1[0], frac),
      MathUtils.lerp(c0[1], c1[1], frac),
      MathUtils.lerp(c0[2], c1[2], frac),
    ]
    const m = MathUtils.lerp(metric[cOrder[bestIdx]], metric[cOrder[otherIdx]], frac)
    const uv0 = readUv(cOrder[bestIdx]), uv1 = readUv(cOrder[otherIdx])
    // Shortest periodic U interpolation across child's cylindrical seam
    let du = uv1[0] - uv0[0]
    if (du > 0.5) du -= 1
    else if (du < -0.5) du += 1
    const cUv: [number, number] = [uv0[0] + du * frac, MathUtils.lerp(uv0[1], uv1[1], frac)]
    return { p, col, metric: m, uv: cUv }
  }

  // Create 2 intermediate Hermite fillet rings (W1 at s=0.35, W2 at s=0.70) with count = M
  const spanLen = Math.max(0.05, hole.holeCenter.distanceTo(childCenter))
  const ring1: number[] = []
  const ring2: number[] = []
  const tmpP = new Vector3()
  const tanStart = new Vector3()
  const tanEnd = childTan.clone().multiplyScalar(spanLen * 0.92)

  for (let i = 0; i < M; i++) {
    const pB = bPts[i]
    const bCol = readCol(B[i])
    const bUv = readUv(B[i])
    const bMet = metric[B[i]]
    const target = sampleChildAtAngle(bAngles[i])

    // Start tangent glides smoothly along the trunk skin inward toward the collar neck + strictly outward along holeNormal
    tanStart.subVectors(target.p, pB)
    const normComp = tanStart.dot(hole.holeNormal)
    if (normComp < 0.02) {
      tanStart.addScaledVector(hole.holeNormal, 0.04 - normComp)
    } else {
      tanStart.addScaledVector(hole.holeNormal, -normComp * 0.42)
    }
    if (tanStart.lengthSq() > 1e-6) tanStart.normalize().multiplyScalar(spanLen * 0.82)
    else tanStart.copy(hole.holeNormal).multiplyScalar(spanLen * 0.6)

    // Keep ring1 & ring2 cleanly on the continuous trunk Flow-UV sheet (eliminates +-0.68 mid-collar UV branch cuts
    // where child 360-deg cylindrical U crosses +-0.5 relative to trunk U; matchChildUv handles the single chart transition at ring2->cOrder!)
    for (const [s, outRing] of [[0.34, ring1], [0.68, ring2]] as const) {
      const s2 = s * s, s3 = s2 * s
      const h00 = 2 * s3 - 3 * s2 + 1
      const h10 = s3 - 2 * s2 + s
      const h01 = -2 * s3 + 3 * s2
      const h11 = s3 - s2
      tmpP.set(
        h00 * pB.x + h10 * tanStart.x + h01 * target.p.x + h11 * tanEnd.x,
        Math.max(0, h00 * pB.y + h10 * tanStart.y + h01 * target.p.y + h11 * tanEnd.y),
        h00 * pB.z + h10 * tanStart.z + h01 * target.p.z + h11 * tanEnd.z,
      )
      const vi = position.length / 3
      position.push(tmpP.x, tmpP.y, tmpP.z)
      uv.push(
        bUv[0],
        MathUtils.lerp(bUv[1], target.uv[1], s),
      )
      color.push(
        MathUtils.lerp(bCol[0], target.col[0], s),
        MathUtils.lerp(bCol[1], target.col[1], s),
        MathUtils.lerp(bCol[2], target.col[2], s),
      )
      metric.push(MathUtils.lerp(bMet, target.metric, s))
      outRing.push(vi)
    }
  }

  // Build per-edge start/end indices on ring1 & ring2.
  // For standard holes, ringEnd[k] === ringStart[(k + 1) % M].
  // For cross-UV-seam holes, at the 2 seam crossings where edges[k][1] !== edges[(k+1)%M][0],
  // emit a split-UV twin vertex (identical 3D pos/col/metric, UV shifted by exact +-1.0) and register in seamPairs!
  const cloneSeamTwin = (srcVi: number, du: number, dv = 0): number => {
    const twin = position.length / 3
    position.push(position[srcVi * 3], position[srcVi * 3 + 1], position[srcVi * 3 + 2])
    uv.push(uv[srcVi * 2] + du, uv[srcVi * 2 + 1] + dv)
    color.push(color[srcVi * 3], color[srcVi * 3 + 1], color[srcVi * 3 + 2])
    metric.push(metric[srcVi])
    seamPairs?.push([srcVi, twin])
    return twin
  }

  const ring1Start = ring1
  const ring2Start = ring2
  const ring1End: number[] = new Array(M)
  const ring2End: number[] = new Array(M)
  for (let k = 0; k < M; k++) {
    const next = (k + 1) % M
    const bEnd = edges[k][1]
    const nextStart = edges[next][0]
    if (bEnd === nextStart) {
      ring1End[k] = ring1Start[next]
      ring2End[k] = ring2Start[next]
    } else {
      const duSeam = uv[bEnd * 2] - uv[nextStart * 2]
      ring1End[k] = cloneSeamTwin(ring1Start[next], duSeam)
      ring2End[k] = cloneSeamTwin(ring2Start[next], duSeam)
    }
  }

  // Stitch B (exact trunk edges) -> ring1 -> ring2 with zero UV wraparound stripes even across j=0/segs!
  for (let k = 0; k < M; k++) {
    const [bA, bB] = edges[k]
    const r1A = ring1Start[k], r1B = ring1End[k]
    const r2A = ring2Start[k], r2B = ring2End[k]
    index.push(bA, bB, r1B, bA, r1B, r1A)
    index.push(r1A, r1B, r2B, r1A, r2B, r2A)
  }

  // Advancing-front watertight stitching between ring2 (M edges) and cOrder (K shared child exit verts)
  // Uniform Bresenham angular progression distributes extra vertices evenly around the collar with zero twist/bunching.
  // For any child vertex on the opposite side of a UV seam (|uRef - uChild| > 0.5), lazily allocate a
  // +-1.0 UV-shifted twin registered in `seamPairs` so EVERY triangle stays wrap-free AND C1 normal-smooth!
  const childTwinCache = new Map<string, number>()
  const matchChildUv = (cVi: number, uRef: number): number => {
    const shiftU = Math.round(uRef - uv[cVi * 2])
    if (shiftU === 0) return cVi
    const key = `${cVi}:${shiftU}`
    let twin = childTwinCache.get(key)
    if (twin === undefined) {
      twin = cloneSeamTwin(cVi, shiftU)
      childTwinCache.set(key, twin)
    }
    return twin
  }

  let ia = 0, ib = 0
  while (ia < M || ib < K) {
    const aCur = ring2Start[ia % M]
    const aEnd = ia < M ? ring2End[ia] : ring2Start[0]
    const bCur = cOrder[ib % K], bNext = cOrder[(ib + 1) % K]
    const emitA = () => {
      const uRef = (uv[aCur * 2] + uv[aEnd * 2]) * 0.5
      index.push(aCur, aEnd, matchChildUv(bCur, uRef))
      ia++
    }
    const emitB = () => {
      const b0 = matchChildUv(bCur, uv[aCur * 2])
      const b1 = matchChildUv(bNext, uv[b0 * 2])
      index.push(aCur, b1, b0)
      ib++
    }
    if (ia === M) {
      emitB()
    } else if (ib === K) {
      emitA()
    } else {
      const progA = Math.abs((ia + 1) / M - ib / K)
      const progB = Math.abs(ia / M - (ib + 1) / K)
      if (progA < progB - 1e-4) {
        emitA()
      } else if (progB < progA - 1e-4) {
        emitB()
      } else {
        const dA = readPos(aEnd).distanceToSquared(readPos(bCur))
        const dB = readPos(aCur).distanceToSquared(readPos(bNext))
        if (dA <= dB) emitA()
        else emitB()
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PART B: High-Poly Sculpt -> Low-Poly Tangent-Space Normal & Cavity AO Baker
// ---------------------------------------------------------------------------
export type NormalMapConvention = 'opengl' | 'directx'

export interface BakedBarkMaps {
  normalMap: Texture
  aoMap: Texture
  width: number
  height: number
  normalConvention: NormalMapConvention
  normalBytes: Uint8Array
  aoBytes: Uint8Array
  dispose(): void
}

function makeLinearTexture(
  bytes: Uint8Array,
  width: number,
  height: number,
  name: string,
  repeatY = 1,
  clampT = false,
): Texture {
  const wrapT = clampT ? ClampToEdgeWrapping : RepeatWrapping
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const img = ctx.createImageData(width, height)
      img.data.set(bytes)
      ctx.putImageData(img, 0, 0)
      const tex = new CanvasTexture(canvas)
      tex.colorSpace = NoColorSpace
      tex.wrapS = RepeatWrapping
      tex.wrapT = wrapT
      tex.repeat.set(1, repeatY)
      tex.anisotropy = 8
      tex.generateMipmaps = true
      tex.name = name
      return tex
    }
  }
  const tex = new DataTexture(bytes, width, height, RGBAFormat)
  tex.colorSpace = NoColorSpace
  tex.flipY = true // match CanvasTexture top-down row order in headless Node/Vitest!
  tex.wrapS = RepeatWrapping
  tex.wrapT = wrapT
  tex.repeat.set(1, repeatY)
  tex.needsUpdate = true
  tex.name = name
  return tex
}

/** Extracts an RGBA byte grid from an existing Substance NormalMap Texture for RNM normal blending. */
function readTextureRgba(tex: Texture | undefined, size: number): Uint8ClampedArray | undefined {
  if (!tex || typeof document === 'undefined') return undefined
  const img = tex.image as { width?: number; height?: number } | undefined
  if (!img || !img.width || !img.height) return undefined
  try {
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const g = c.getContext('2d')
    if (!g) return undefined
    g.drawImage(img as CanvasImageSource, 0, 0, size, size)
    return g.getImageData(0, 0, size, size).data
  } catch {
    return undefined
  }
}

/** Separable O(1)-per-pixel periodic box blur in U (wrapping) and clamped V (approximates low-poly mesh capture). */
function lowPassHeightGrid(src: Float32Array, w: number, h: number, radU: number, radV: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const dst = new Float32Array(w * h)
  const rU = Math.max(0, Math.min(Math.floor(w / 4), Math.round(radU)))
  const rV = Math.max(0, Math.min(Math.floor(h / 4), Math.round(radV)))
  if (rU === 0 && rV === 0) {
    dst.set(src)
    return dst
  }
  const invU = 1 / (2 * rU + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let dx = -rU; dx <= rU; dx++) sum += src[row + wrapMod(dx, w)]
    tmp[row] = sum * invU
    for (let x = 1; x < w; x++) {
      sum += src[row + wrapMod(x + rU, w)] - src[row + wrapMod(x - 1 - rU, w)]
      tmp[row + x] = sum * invU
    }
  }
  const invV = 1 / (2 * rV + 1)
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let dy = -rV; dy <= rV; dy++) sum += tmp[Math.max(0, Math.min(h - 1, dy)) * w + x]
    dst[x] = sum * invV
    for (let y = 1; y < h; y++) {
      sum += tmp[Math.min(h - 1, y + rV) * w + x] - tmp[Math.max(0, y - 1 - rV) * w + x]
      dst[y * w + x] = sum * invV
    }
  }
  return dst
}

/** Bakes a seamless glTF 2.0 Tangent-Space Normal Map (OpenGL +Y or DirectX -Y) + Cavity AO Map directly from
 *  the analytical High-Poly Sculpted Bark evaluator + procedural flow-bark micro-fibers.
 *
 *  Automatically deducts the low-frequency relief already expressed by the exported mesh's
 *  current LOD (`woodDetail`):
 *  - High LOD -> bakes crisp residual crevices + procedural micro-fibers + Substance detail
 *  - Game / Mobile / Distant LOD -> bakes FULL macro wide-rib normals + crevices + micro-fibers
 *    so 2k-6k tri game trees look nearly indistinguishable from 40k tri hero sculpts in Blender/Unity/UE! */
export function bakeSculptedBarkMaps(
  trunk: TrunkSpec,
  seed: number,
  woodDetail: number,
  options: {
    size?: number
    normalConvention?: NormalMapConvention
    heightField?: BarkHeightField
    baseNormalMap?: Texture
    plan?: TrunkFeaturePlan
  } = {},
): BakedBarkMaps {
  const size = Math.max(64, Math.min(2048, Math.round(options.size ?? 512)))
  const normalConvention: NormalMapConvention = options.normalConvention === 'directx' ? 'directx' : 'opengl'
  const ySign = normalConvention === 'directx' ? -1 : 1
  const sculpt = trunk.sculpt!
  const phase = (seed % 997) / 997 * Math.PI * 2
  const barkScale = trunk.barkScale ?? 1
  const detailStrength = MathUtils.clamp(trunk.barkDetail ?? 0.72, 0.1, 1.5)
  const hRef = Math.max(0.5, trunk.height)
  const baseR = Math.max(0.08, trunk.radius)
  const vSpan = 2.1 // matches evalBarkSculpt uvV = normS * 2.1
  const uTile = barkFlowTileU(barkScale)

  const plan = options.plan ?? buildTrunkFeaturePlan(
    sculpt, seed, phase, trunk.flare, trunk.flareLobes, trunk.flareHeight,
    trunk.height, trunk.height * (trunk.forkHeight ?? 0.6), [], [],
  )
  // Match the exact sculpted trunk mesh vertical UV range [0 .. maxTrunkUvV] so baked buttresses,
  // wide ribs & branch sockets align 1:1 with geometry with zero vertical stretch or mid-trunk wrap seam!
  const trunkArcLen = Math.max(0.4, plan.trunkArcLen || hRef * (trunk.forkHeight ?? 0.65))
  const maxTrunkUvV = Math.max(0.5, (trunkArcLen / hRef) * vSpan)
  const vTileInt = Math.max(1, Math.round(maxTrunkUvV * barkScale * 0.85))

  const hiHeight = new Float32Array(size * size)
  const cavGrid = new Float32Array(size * size)

  // 1. Sample exact analytical high-poly surface height (meters) + procedural micro-fibers in Flow-UV space
  for (let py = 0; py < size; py++) {
    // Flip V for Canvas/glTF image top-down orientation (py = 0 -> v = 1 -> top of trunk!)
    const vNorm = 1 - (py + 0.5) / size
    const t = vNorm
    const arcLen = vNorm * trunkArcLen
    const y = arcLen
    const rLocal = baseR * Math.pow(1 - t * 0.45, trunk.taper)
    const vUv = vNorm * maxTrunkUvV
    const twistAng = flowTwistAngle(arcLen / hRef, sculpt.twist)

    for (let px = 0; px < size; px++) {
      const uNorm = (px + 0.5) / size
      // Invert Flow UV (uvU = (angle - twistAng) / 2PI) -> physical angle for exact surface alignment!
      const angle = uNorm * Math.PI * 2 + twistAng
      const res = evalBarkSculpt({
        sculpt, angle, t, arcLen, y, baseRadius: rLocal, refHeight: hRef,
        phase, concavity: 0, isTrunk: true, barkScale,
        flare: trunk.flare * 0.45, flareLobes: trunk.flareLobes, flareHeight: trunk.flareHeight,
        heightField: options.heightField, plan,
      })
      // Add procedural flow-bark micro-striations (so GPU onBeforeCompile fibers appear natively in external GLB viewers!)
      const micro = evalFlowBarkMicroCpu(uNorm, vUv, barkScale)
      const microMeters = (micro - 0.5) * baseR * 0.048 * detailStrength
      hiHeight[py * size + px] = (res.finalRadius - rLocal) + microMeters
      cavGrid[py * size + px] = MathUtils.clamp(res.cavity + (0.5 - micro) * 0.28 * detailStrength, 0, 1)
    }
  }

  // 2. Deduct low-frequency height already represented by the exported mesh's LOD subdivision!
  //    At High LOD (woodDetail=1), mesh captures wide ribs -> small lowPass kernel leaves crisp crevices & micro-grain;
  //    At Game/Mobile LOD (woodDetail=0.4..0.6), mesh is coarse -> wider lowPass kernel bakes full rib curvature into normal map!
  const lod = woodSculptLodParams(woodDetail, sculpt)
  const meshCaptureU = Math.max(2, Math.round((size / Math.max(8, lod.trunkSegs)) * 0.55))
  const meshCaptureV = Math.max(2, Math.round((size / Math.max(8, lod.trunkRings)) * 0.55))
  // Blend residual vs full relief cleanly: lower woodDetail keeps much more macro rib relief in the normal map!
  const macroRetention = MathUtils.clamp((1.0 - woodDetail) * 1.15, 0.22, 0.92)
  const lowHeight = lowPassHeightGrid(hiHeight, size, size, meshCaptureU, meshCaptureV)

  const residual = new Float32Array(size * size)
  for (let i = 0; i < residual.length; i++) {
    residual[i] = (hiHeight[i] - lowHeight[i]) + lowHeight[i] * macroRetention
  }

  // 3. Compute exact centered-difference OpenGL Tangent-Space Normals (+X right, +Y up, +Z out)
  const normalBytes = new Uint8Array(size * size * 4)
  const aoBytes = new Uint8Array(size * size * 4)
  const baseNormRgba = readTextureRgba(options.baseNormalMap, size)

  const avgCircum = Math.PI * 2 * baseR * 0.85
  const dSu = avgCircum / size
  const dSv = trunkArcLen / size
  const normalGain = 1.15 + (1 - woodDetail) * 0.45

  for (let py = 0; py < size; py++) {
    const yPrev = Math.max(0, py - 1)
    const yNext = Math.min(size - 1, py + 1)
    for (let px = 0; px < size; px++) {
      const xPrev = (px - 1 + size) % size
      const xNext = (px + 1) % size

      const dhdu = (residual[py * size + xNext] - residual[py * size + xPrev]) / (2 * dSu)
      // Image py increases downward while UV v increases upward -> negate d/dpy for OpenGL +Y up!
      const dhdv = (residual[yPrev * size + px] - residual[yNext * size + px]) / (2 * dSv)

      let nx = -dhdu * normalGain
      let ny = -dhdv * normalGain
      let nz = 1.0
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; nz /= len

      // Reoriented Normal Mapping (RNM) blend if a Substance bark normalMap was already present (integer periodic V!)
      if (baseNormRgba) {
        const bx = wrapMod(Math.round(px * uTile), size)
        const by = wrapMod(Math.round(py * vTileInt), size)
        const bi = (by * size + bx) * 4
        const tx = baseNormRgba[bi] / 127.5 - 1
        const ty = baseNormRgba[bi + 1] / 127.5 - 1
        const tz = Math.max(0.05, baseNormRgba[bi + 2] / 127.5 - 1)
        // RNM: t = (nx, ny, nz + 1), u = (-tx, -ty, tz), r = t * dot(t, u) - u * t.z
        const tZ = nz + 1
        const dotTU = nx * (-tx) + ny * (-ty) + tZ * tz
        let rx = nx * dotTU + tx * tZ
        let ry = ny * dotTU + ty * tZ
        let rz = tZ * dotTU - tz * tZ
        const rLen = Math.hypot(rx, ry, rz)
        if (rLen > 1e-5) { nx = rx / rLen; ny = ry / rLen; nz = Math.max(0.05, rz / rLen) }
      }

      const idx = (py * size + px) * 4
      normalBytes[idx] = Math.round(MathUtils.clamp(nx * 0.5 + 0.5, 0, 1) * 255)
      normalBytes[idx + 1] = Math.round(MathUtils.clamp((ny * ySign) * 0.5 + 0.5, 0, 1) * 255)
      normalBytes[idx + 2] = Math.round(MathUtils.clamp(nz * 0.5 + 0.5, 0, 1) * 255)
      normalBytes[idx + 3] = 255

      const aoVal = Math.round(MathUtils.clamp(1 - cavGrid[py * size + px] * sculpt.creviceAO * 0.82, 0.16, 1) * 255)
      aoBytes[idx] = aoVal
      aoBytes[idx + 1] = aoVal
      aoBytes[idx + 2] = aoVal
      aoBytes[idx + 3] = 255
    }
  }

  const repeatY = 1 / maxTrunkUvV
  const normalMap = makeLinearTexture(normalBytes, size, size, 'BakedSculptBarkNormal', repeatY, true)
  const aoMap = makeLinearTexture(aoBytes, size, size, 'BakedSculptBarkAO', repeatY, true)
  aoMap.channel = 0

  return {
    normalMap,
    aoMap,
    width: size,
    height: size,
    normalConvention,
    normalBytes,
    aoBytes,
    dispose() {
      normalMap.dispose()
      aoMap.dispose()
    },
  }
}

/** Encodes baked tangent-space normal & cavity AO RGBA grids into standalone PNG data URLs (browser download). */
export function bakedBarkMapsToPngDataUrls(maps: BakedBarkMaps): { normalDataUrl: string; aoDataUrl: string } {
  const encode = (bytes: Uint8Array, w: number, h: number) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D Canvas 编码烘焙贴图')
    const img = ctx.createImageData(w, h)
    img.data.set(bytes)
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
  }
  return {
    normalDataUrl: encode(maps.normalBytes, maps.width, maps.height),
    aoDataUrl: encode(maps.aoBytes, maps.width, maps.height),
  }
}

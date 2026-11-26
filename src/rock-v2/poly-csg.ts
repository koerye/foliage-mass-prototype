import Module, { type Manifold, type ManifoldToplevel, type Mesh as ManifoldMesh } from 'manifold-3d'
import manifoldWasmB64 from 'virtual:manifold-wasm-b64'
import { BufferAttribute, BufferGeometry } from 'three'
import { vNorm, type Vec3 } from './sdf'

export interface RouteCSculptParams {
  /** Deterministic variation seed (5104 = canonical approved sandstone-ledge-c2). */
  seed?: number
  /** Primary shoulder cleavage ramp & riser depth multiplier (0.65..1.35, default 1.0). */
  shoulderDepth?: number
  /** Localized asymmetric bevel scale (0.0 = sharp C1 edges, 1.0 = canonical C2, 1.4 = bolder weathered bevels). */
  bevelScale?: number
  /** Shoulder V-notch & base foot-notch penetration multiplier (0.5..1.4, default 1.0). */
  notchDepth?: number
}

export interface HalfSpacePlane {
  /** Outward-pointing plane normal; solid interior satisfies dot(n, p) <= h. */
  n: Vec3
  h: number
  faceId?: number
}

export interface PolyCsgPhaseTimings {
  booleanMs: number
  fallbackMs: number
  fallbackCount: number
  auditMs: number
  totalMs: number
}

export interface PolyCsgAudit {
  manifoldStatus: string
  rawManifoldComponents: number
  vertices: number
  triangles: number
  faceGroups: number
  connectedComponents: number
  openEdges: number
  nonManifoldEdges: number
  windingMismatches: number
  degenerateTriangles: number
  selfIntersections: number
  minY: number
  maxY: number
  size: [number, number, number]
  buildMs: number
  phases?: PolyCsgPhaseTimings
}

export type PolyCsgPresetId = 'sandstone-ledge-c2' | 'block-bluff-c2' | 'terraced-moss-bluff-c2'

export type PolyCsgVariantId =
  | 'sandstone-ledge-c1'
  | 'sandstone-ledge-c2'
  | 'block-bluff-c1'
  | 'block-bluff-c2'
  | 'terraced-moss-bluff-c1'
  | 'terraced-moss-bluff-c2'

export interface PolyCsgResult {
  id: PolyCsgVariantId
  name: string
  /** Welded vertex positions (x, y, z) shifted so minY === 0. */
  positions: Float32Array
  /** Welded triangle indices (3 * numTri). */
  indices: Uint32Array
  /** Source face ID per triangle (tracks exact original plane / cutter face!). */
  faceIds: Uint32Array
  /** Y shift applied so minY === 0 (subtract shiftY when querying unshifted SDF coordinates). */
  shiftY: number
  audit: PolyCsgAudit
  /** Builds a Three.js BufferGeometry with crease-aware split normals (no shading wobble across sharp facets!). */
  toBufferGeometry(creaseAngleDeg?: number): BufferGeometry
}

export interface SectionSegment2D {
  u0: number
  v0: number
  u1: number
  v1: number
}

let cachedManifoldPromise: Promise<ManifoldToplevel> | null = null

function decodeBase64ToBytes(b64: string): Uint8Array | null {
  if (!b64) return null
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Lazily initializes offline manifold-3d WASM.
 * Works identically in Node/Vitest, Vite dev server, Electron `file://`, AND `?worker&inline` blob Workers
 * by decoding Vite's inlined base64 WASM into `wasmBinary` (zero network/file fetch required inside Workers!).
 */
export async function getManifoldModule(): Promise<ManifoldToplevel> {
  if (!cachedManifoldPromise) {
    const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node) && typeof self === 'undefined'
    if (isNode) {
      cachedManifoldPromise = Module().then(wasm => {
        wasm.setup()
        return wasm
      })
    } else {
      const inlineBytes = decodeBase64ToBytes(manifoldWasmB64)
      const initOpts = inlineBytes
        ? ({ wasmBinary: inlineBytes, locateFile: () => 'manifold.wasm' } as unknown as Parameters<typeof Module>[0])
        : undefined
      cachedManifoldPromise = Module(initOpts).then(wasm => {
        wasm.setup()
        return wasm
      })
    }
  }
  return cachedManifoldPromise
}

// ---------------------------------------------------------------------------
// Pure TS Exact Convex Half-Space Polyhedron Builder (Sutherland-Hodgman 3D)
// ---------------------------------------------------------------------------
interface PolyFace {
  verts: Vec3[]
  normal: Vec3
  faceId: number
}

function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function vLerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function makeCubeFaces(halfExtent: number): PolyFace[] {
  const s = halfExtent
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
  // All 6 faces strictly CCW when viewed from outside
  return [
    { normal: { x: 1, y: 0, z: 0 }, faceId: 1, verts: [p(s, -s, -s), p(s, s, -s), p(s, s, s), p(s, -s, s)] },
    { normal: { x: -1, y: 0, z: 0 }, faceId: 2, verts: [p(-s, -s, s), p(-s, s, s), p(-s, s, -s), p(-s, -s, -s)] },
    { normal: { x: 0, y: 1, z: 0 }, faceId: 3, verts: [p(-s, s, -s), p(-s, s, s), p(s, s, s), p(s, s, -s)] },
    { normal: { x: 0, y: -1, z: 0 }, faceId: 4, verts: [p(-s, -s, s), p(-s, -s, -s), p(s, -s, -s), p(s, -s, s)] },
    { normal: { x: 0, y: 0, z: 1 }, faceId: 5, verts: [p(-s, -s, s), p(s, -s, s), p(s, s, s), p(-s, s, s)] },
    { normal: { x: 0, y: 0, z: -1 }, faceId: 6, verts: [p(s, -s, -s), p(-s, -s, -s), p(-s, s, -s), p(s, s, -s)] },
  ]
}

function dedupePolygonVerts(verts: Vec3[], eps = 1e-6): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]
    const prev = out.length > 0 ? out[out.length - 1] : null
    if (prev && Math.hypot(v.x - prev.x, v.y - prev.y, v.z - prev.z) < eps) continue
    out.push(v)
  }
  while (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) < eps) out.pop()
    else break
  }
  return out
}

/** Clips a convex polyhedron by half-spaces `dot(n, p) <= h` in pure TS and returns welded triangle arrays + faceIDs. */
export function buildConvexPolyhedronMeshData(
  planes: HalfSpacePlane[],
  halfExtent = 3.5,
  faceIdOffset = 100,
): { vertProperties: Float32Array; triVerts: Uint32Array; faceID: Uint32Array } {
  const EPS = 1e-6
  let faces: PolyFace[] = makeCubeFaces(halfExtent)

  for (let pi = 0; pi < planes.length; pi++) {
    const n = vNorm(planes[pi].n)
    const h = planes[pi].h
    const fId = planes[pi].faceId ?? (faceIdOffset + pi)
    const nextFaces: PolyFace[] = []
    const capPoints: Vec3[] = []

    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi]
      const vs = face.verts
      const count = vs.length
      if (count < 3) continue
      const dists = new Float64Array(count)
      let allIn = true
      let allOut = true
      for (let i = 0; i < count; i++) {
        const d = vDot(n, vs[i]) - h
        dists[i] = d
        if (d > EPS) allIn = false
        if (d < -EPS) allOut = false
      }
      if (allOut) continue
      if (allIn) {
        // Record vertices lying directly on the cutting plane for the cap polygon
        for (let i = 0; i < count; i++) {
          if (Math.abs(dists[i]) <= EPS * 10) capPoints.push(vs[i])
        }
        nextFaces.push(face)
        continue
      }

      const clipped: Vec3[] = []
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count
        const a = vs[i], b = vs[j]
        const da = dists[i], db = dists[j]
        const aIn = da <= EPS
        const bIn = db <= EPS
        if (aIn) {
          clipped.push(a)
          if (Math.abs(da) <= EPS * 10) capPoints.push(a)
        }
        if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
          const t = da / (da - db)
          const inter = vLerp(a, b, t)
          clipped.push(inter)
          capPoints.push(inter)
        } else if (!aIn && bIn && Math.abs(db) <= EPS * 10) {
          capPoints.push(b)
        }
      }

      const cleaned = dedupePolygonVerts(clipped, 1e-5)
      if (cleaned.length >= 3) {
        nextFaces.push({ verts: cleaned, normal: face.normal, faceId: face.faceId })
      }
    }

    // Build CCW cap polygon on the cutting plane from unique intersection points
    if (capPoints.length >= 3) {
      const uniqCap: Vec3[] = []
      for (let i = 0; i < capPoints.length; i++) {
        const p = capPoints[i]
        let dup = false
        for (let j = 0; j < uniqCap.length; j++) {
          if (Math.hypot(p.x - uniqCap[j].x, p.y - uniqCap[j].y, p.z - uniqCap[j].z) < 2e-5) {
            dup = true
            break
          }
        }
        if (!dup) uniqCap.push(p)
      }
      if (uniqCap.length >= 3) {
        const center: Vec3 = { x: 0, y: 0, z: 0 }
        for (const p of uniqCap) { center.x += p.x; center.y += p.y; center.z += p.z }
        center.x /= uniqCap.length; center.y /= uniqCap.length; center.z /= uniqCap.length

        const ref: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
        const uAxis = vNorm(vCross(ref, n))
        const vAxis = vNorm(vCross(n, uAxis))

        // Sort strictly CCW around outward normal n
        uniqCap.sort((a, b) => {
          const da = vSub(a, center), db = vSub(b, center)
          return Math.atan2(vDot(da, vAxis), vDot(da, uAxis)) - Math.atan2(vDot(db, vAxis), vDot(db, uAxis))
        })

        // Verify area & orientation
        const crossCheck = vCross(vSub(uniqCap[1], uniqCap[0]), vSub(uniqCap[2], uniqCap[0]))
        if (vDot(crossCheck, n) < 0) uniqCap.reverse()
        nextFaces.push({ verts: uniqCap, normal: n, faceId: fId })
      }
    }

    faces = nextFaces
    if (faces.length === 0) break
  }

  // Quantize & weld vertices cleanly so Manifold receives a watertight shared-vertex mesh
  const QUANT = 1e5
  const vertMap = new Map<string, number>()
  const vertsOut: number[] = []
  const trisOut: number[] = []
  const faceIdsOut: number[] = []

  const getVertIdx = (p: Vec3): number => {
    const qx = Math.round(p.x * QUANT)
    const qy = Math.round(p.y * QUANT)
    const qz = Math.round(p.z * QUANT)
    const key = `${qx},${qy},${qz}`
    let idx = vertMap.get(key)
    if (idx === undefined) {
      idx = vertsOut.length / 3
      vertMap.set(key, idx)
      vertsOut.push(p.x, p.y, p.z)
    }
    return idx
  }

  for (const face of faces) {
    const idxs = face.verts.map(getVertIdx)
    const compact: number[] = []
    for (let i = 0; i < idxs.length; i++) {
      if (compact.length === 0 || compact[compact.length - 1] !== idxs[i]) compact.push(idxs[i])
    }
    if (compact.length > 1 && compact[0] === compact[compact.length - 1]) compact.pop()
    if (compact.length < 3) continue
    for (let i = 1; i < compact.length - 1; i++) {
      const a = compact[0], b = compact[i], c = compact[i + 1]
      if (a === b || b === c || c === a) continue
      // Enforce outward winding against face.normal
      const ax = vertsOut[a * 3], ay = vertsOut[a * 3 + 1], az = vertsOut[a * 3 + 2]
      const bx = vertsOut[b * 3], by = vertsOut[b * 3 + 1], bz = vertsOut[b * 3 + 2]
      const cx = vertsOut[c * 3], cy = vertsOut[c * 3 + 1], cz = vertsOut[c * 3 + 2]
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
      const nx = e1y * e2z - e1z * e2y
      const ny = e1z * e2x - e1x * e2z
      const nz = e1x * e2y - e1y * e2x
      const area2 = Math.hypot(nx, ny, nz)
      if (area2 < 1e-10) continue
      if (nx * face.normal.x + ny * face.normal.y + nz * face.normal.z >= 0) {
        trisOut.push(a, b, c)
      } else {
        trisOut.push(a, c, b)
      }
      faceIdsOut.push(face.faceId)
    }
  }

  return {
    vertProperties: Float32Array.from(vertsOut),
    triVerts: Uint32Array.from(trisOut),
    faceID: Uint32Array.from(faceIdsOut),
  }
}

/** Helper to construct a finite tapered 3D V-prism cutter (convex polyhedron!) for fractures & foot notches. */
function buildFiniteVNotchPlanes(opts: {
  origin: Vec3
  across: Vec3
  upOut: Vec3
  throatHalf: number
  angleLeftRad: number
  angleRightRad: number
  halfLenFront: number
  halfLenBack: number
  /** Upward slope of the V-notch floor toward the rear (-w) so the notch tapers cleanly into solid stone! */
  backFloorSlopeRad?: number
  frontFloorSlopeRad?: number
  openTopHeight?: number
  faceIdBase: number
}): HalfSpacePlane[] {
  const v = vNorm(opts.upOut)
  const dDot = vDot(opts.across, v)
  const u = vNorm({ x: opts.across.x - v.x * dDot, y: opts.across.y - v.y * dDot, z: opts.across.z - v.z * dDot })
  const w = vNorm(vCross(u, v))
  const o = opts.origin
  const hTop = opts.openTopHeight ?? 0.9

  const makePlane = (dirLocalU: number, dirLocalV: number, dirLocalW: number, pointLocalU: number, pointLocalV: number, pointLocalW: number, fId: number): HalfSpacePlane => {
    const n = vNorm({
      x: u.x * dirLocalU + v.x * dirLocalV + w.x * dirLocalW,
      y: u.y * dirLocalU + v.y * dirLocalV + w.y * dirLocalW,
      z: u.z * dirLocalU + v.z * dirLocalV + w.z * dirLocalW,
    })
    const pt = {
      x: o.x + u.x * pointLocalU + v.x * pointLocalV + w.x * pointLocalW,
      y: o.y + u.y * pointLocalU + v.y * pointLocalV + w.y * pointLocalW,
      z: o.z + u.z * pointLocalU + v.z * pointLocalV + w.z * pointLocalW,
    }
    return { n, h: vDot(n, pt), faceId: fId }
  }

  const cR = Math.cos(opts.angleRightRad), sR = Math.sin(opts.angleRightRad)
  const cL = Math.cos(opts.angleLeftRad), sL = Math.sin(opts.angleLeftRad)
  const bSlope = opts.backFloorSlopeRad ?? 0.42
  const fSlope = opts.frontFloorSlopeRad ?? 0.0

  const planes: HalfSpacePlane[] = [
    // Right V-wall (outward normal points +u, -v)
    makePlane(cR, -sR, 0, opts.throatHalf, 0, 0, opts.faceIdBase),
    // Left V-wall (outward normal points -u, -v)
    makePlane(-cL, -sL, 0, -opts.throatHalf, 0, 0, opts.faceIdBase + 1),
    // Center groove floor (outward normal points -v)
    makePlane(0, -1, 0, 0, 0, 0, opts.faceIdBase + 2),
    // Open top cap well out in the air (+v)
    makePlane(0, 1, 0, 0, hTop, 0, opts.faceIdBase + 3),
    // Front (+w) & Back (-w) bounds
    makePlane(0, 0, 1, 0, 0, opts.halfLenFront, opts.faceIdBase + 4),
    makePlane(0, 0, -1, 0, 0, -opts.halfLenBack, opts.faceIdBase + 5),
  ]

  // Taper floor upward toward rear (-w) so fracture dies out smoothly inside the ramp without splitting the back!
  if (bSlope > 0.01) {
    planes.push(makePlane(0, -Math.cos(bSlope), -Math.sin(bSlope), 0, 0, -0.04, opts.faceIdBase + 6))
  }
  if (fSlope > 0.01) {
    planes.push(makePlane(0, -Math.cos(fSlope), Math.sin(fSlope), 0, 0, 0.04, opts.faceIdBase + 7))
  }
  return planes
}

// ---------------------------------------------------------------------------
// Independent Pure-TS Topology & Self-Intersection Audit (Zero Blind Trust!)
//   Exact Möller (1997) non-coplanar + 2D SAT coplanar interior-overlap test.
// ---------------------------------------------------------------------------
function coplanarTri2DOverlap(
  a0: [number, number], a1: [number, number], a2: [number, number],
  b0: [number, number], b1: [number, number], b2: [number, number],
  eps = 2e-5,
): boolean {
  const polyA = [a0, a1, a2]
  const polyB = [b0, b1, b2]
  const checkAxes = (poly: [number, number][]): boolean => {
    for (let i = 0; i < 3; i++) {
      const p0 = poly[i]
      const p1 = poly[(i + 1) % 3]
      const ex = p1[0] - p0[0]
      const ey = p1[1] - p0[1]
      const len = Math.hypot(ex, ey)
      if (len < 1e-10) continue
      const nx = -ey / len
      const ny = ex / len
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
      if (maxA <= minB + eps || maxB <= minA + eps) return false
    }
    return true
  }
  return checkAxes(polyA) && checkAxes(polyB)
}

function triTriIntersect(
  a0: Vec3, a1: Vec3, a2: Vec3,
  b0: Vec3, b1: Vec3, b2: Vec3,
): boolean {
  const PLANE_EPS = 2e-5
  const naRaw = vCross(vSub(a1, a0), vSub(a2, a0))
  const naLen = Math.hypot(naRaw.x, naRaw.y, naRaw.z)
  if (naLen < 1e-12) return false
  const na: Vec3 = { x: naRaw.x / naLen, y: naRaw.y / naLen, z: naRaw.z / naLen }
  const da = -vDot(na, a0)
  const db0 = vDot(na, b0) + da, db1 = vDot(na, b1) + da, db2 = vDot(na, b2) + da
  if ((db0 > PLANE_EPS && db1 > PLANE_EPS && db2 > PLANE_EPS) || (db0 < -PLANE_EPS && db1 < -PLANE_EPS && db2 < -PLANE_EPS)) {
    return false
  }

  const nbRaw = vCross(vSub(b1, b0), vSub(b2, b0))
  const nbLen = Math.hypot(nbRaw.x, nbRaw.y, nbRaw.z)
  if (nbLen < 1e-12) return false
  const nb: Vec3 = { x: nbRaw.x / nbLen, y: nbRaw.y / nbLen, z: nbRaw.z / nbLen }
  const db = -vDot(nb, b0)
  const da0 = vDot(nb, a0) + db, da1 = vDot(nb, a1) + db, da2 = vDot(nb, a2) + db
  if ((da0 > PLANE_EPS && da1 > PLANE_EPS && da2 > PLANE_EPS) || (da0 < -PLANE_EPS && da1 < -PLANE_EPS && da2 < -PLANE_EPS)) {
    return false
  }

  const dir = vCross(na, nb)
  const dirLen = Math.hypot(dir.x, dir.y, dir.z)
  const allBOnA = Math.abs(db0) <= PLANE_EPS && Math.abs(db1) <= PLANE_EPS && Math.abs(db2) <= PLANE_EPS
  const allAOnB = Math.abs(da0) <= PLANE_EPS && Math.abs(da1) <= PLANE_EPS && Math.abs(da2) <= PLANE_EPS
  if (dirLen < 1e-4 || allBOnA || allAOnB) {
    // Parallel / coplanar planes: reject if separated, otherwise test true 2D interior overlap!
    if (Math.max(Math.abs(db0), Math.abs(db1), Math.abs(db2)) > 2e-4) return false
    const ax = Math.abs(na.x), ay = Math.abs(na.y), az = Math.abs(na.z)
    const proj2D = (p: Vec3): [number, number] =>
      ax >= ay && ax >= az ? [p.y, p.z] : ay >= az ? [p.x, p.z] : [p.x, p.y]
    return coplanarTri2DOverlap(proj2D(a0), proj2D(a1), proj2D(a2), proj2D(b0), proj2D(b1), proj2D(b2))
  }

  const dirN: Vec3 = { x: dir.x / dirLen, y: dir.y / dirLen, z: dir.z / dirLen }
  const proj = (p: Vec3) => vDot(p, dirN)

  const interval = (p0: Vec3, p1: Vec3, p2: Vec3, d0: number, d1: number, d2: number): [number, number] | null => {
    const pts: number[] = []
    const pairs: [Vec3, Vec3, number, number][] = [[p0, p1, d0, d1], [p1, p2, d1, d2], [p2, p0, d2, d0]]
    for (const [u, v, du, dv] of pairs) {
      if ((du > PLANE_EPS && dv < -PLANE_EPS) || (du < -PLANE_EPS && dv > PLANE_EPS)) {
        const t = du / (du - dv)
        pts.push(proj(vLerp(u, v, t)))
      } else if (Math.abs(du) <= PLANE_EPS) {
        pts.push(proj(u))
      }
    }
    if (pts.length < 2) return null
    let lo = Infinity, hi = -Infinity
    for (const val of pts) { if (val < lo) lo = val; if (val > hi) hi = val }
    return [lo, hi]
  }

  const ia = interval(a0, a1, a2, da0, da1, da2)
  const ib = interval(b0, b1, b2, db0, db1, db2)
  if (!ia || !ib) return false
  return Math.max(ia[0], ib[0]) < Math.min(ia[1], ib[1]) - 2e-5
}

function auditExplicitMesh(
  positions: Float32Array,
  indices: Uint32Array,
  faceIds: Uint32Array,
  manifoldStatus: string,
  rawManifoldComponents: number,
  buildMs: number,
): PolyCsgAudit {
  const vCount = positions.length / 3
  const tCount = indices.length / 3

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < vCount; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }

  const edgeCounts = new Map<string, number>()
  const edgeDirCounts = new Map<string, { fwd: number; rev: number }>()
  const adj: number[][] = Array.from({ length: vCount }, () => [])
  let degenerateTriangles = 0

  const triMin = new Float32Array(tCount * 3)
  const triMax = new Float32Array(tCount * 3)

  for (let t = 0; t < tCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    if (a === b || b === c || c === a) degenerateTriangles++
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const area2 = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x)
    if (area2 < 1e-10) degenerateTriangles++

    triMin[t * 3] = Math.min(ax, bx, cx); triMax[t * 3] = Math.max(ax, bx, cx)
    triMin[t * 3 + 1] = Math.min(ay, by, cy); triMax[t * 3 + 1] = Math.max(ay, by, cy)
    triMin[t * 3 + 2] = Math.min(az, bz, cz); triMax[t * 3 + 2] = Math.max(az, bz, cz)

    const edges: [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [u, v] of edges) {
      adj[u].push(v); adj[v].push(u)
      const lo = u < v ? u : v
      const hi = u < v ? v : u
      const key = `${lo}_${hi}`
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
      let rec = edgeDirCounts.get(key)
      if (!rec) { rec = { fwd: 0, rev: 0 }; edgeDirCounts.set(key, rec) }
      if (u < v) rec.fwd++
      else rec.rev++
    }
  }

  let openEdges = 0, nonManifoldEdges = 0, windingMismatches = 0
  for (const [key, cnt] of edgeCounts.entries()) {
    if (cnt === 1) openEdges++
    else if (cnt > 2) nonManifoldEdges++
    else if (cnt === 2) {
      const rec = edgeDirCounts.get(key)!
      if (rec.fwd !== 1 || rec.rev !== 1) windingMismatches++
    }
  }

  // Connected components via BFS
  const visited = new Uint8Array(vCount)
  let connectedComponents = 0
  const queue: number[] = []
  for (let i = 0; i < vCount; i++) {
    if (visited[i] || adj[i].length === 0) continue
    connectedComponents++
    visited[i] = 1
    queue.length = 0
    queue.push(i)
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q]
      for (const nb of adj[cur]) {
        if (!visited[nb]) { visited[nb] = 1; queue.push(nb) }
      }
    }
  }

  // Exact non-adjacent triangle-triangle self-intersection audit (fast since tCount ~ 80..600!)
  let selfIntersections = 0
  const getP = (vi: number): Vec3 => ({ x: positions[vi * 3], y: positions[vi * 3 + 1], z: positions[vi * 3 + 2] })
  for (let i = 0; i < tCount; i++) {
    const a0 = indices[i * 3], a1 = indices[i * 3 + 1], a2 = indices[i * 3 + 2]
    const ax0 = triMin[i * 3], ay0 = triMin[i * 3 + 1], az0 = triMin[i * 3 + 2]
    const ax1 = triMax[i * 3], ay1 = triMax[i * 3 + 1], az1 = triMax[i * 3 + 2]
    for (let j = i + 1; j < tCount; j++) {
      if (ax1 < triMin[j * 3] || triMax[j * 3] < ax0) continue
      if (ay1 < triMin[j * 3 + 1] || triMax[j * 3 + 1] < ay0) continue
      if (az1 < triMin[j * 3 + 2] || triMax[j * 3 + 2] < az0) continue
      const b0 = indices[j * 3], b1 = indices[j * 3 + 1], b2 = indices[j * 3 + 2]
      if (a0 === b0 || a0 === b1 || a0 === b2 || a1 === b0 || a1 === b1 || a1 === b2 || a2 === b0 || a2 === b1 || a2 === b2) continue
      if (triTriIntersect(getP(a0), getP(a1), getP(a2), getP(b0), getP(b1), getP(b2))) {
        selfIntersections++
      }
    }
  }

  const faceSet = new Set<number>()
  for (let i = 0; i < faceIds.length; i++) faceSet.add(faceIds[i])

  return {
    manifoldStatus,
    rawManifoldComponents,
    vertices: vCount,
    triangles: tCount,
    faceGroups: faceSet.size,
    connectedComponents,
    openEdges,
    nonManifoldEdges,
    windingMismatches,
    degenerateTriangles,
    selfIntersections,
    minY: Number(minY.toFixed(4)),
    maxY: Number(maxY.toFixed(4)),
    size: [
      Number((maxX - minX).toFixed(3)),
      Number((maxY - minY).toFixed(3)),
      Number((maxZ - minZ).toFixed(3)),
    ],
    buildMs: Math.round(buildMs * 10) / 10,
  }
}

/** Builds crease-aware split position/normal/index typed arrays ready for zero-copy Worker transfer. */
export function buildCreasePreviewBuffers(
  positions: Float32Array,
  indices: Uint32Array,
  creaseAngleDeg: number,
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const tCount = indices.length / 3
  const faceNormals = new Float32Array(tCount * 3)
  const faceAreas = new Float32Array(tCount)
  const vCount = positions.length / 3
  const vertTris: number[][] = Array.from({ length: vCount }, () => [])

  for (let t = 0; t < tCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    vertTris[a].push(t); vertTris[b].push(t); vertTris[c].push(t)
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2]
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2]
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2]
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    const l = Math.hypot(nx, ny, nz) || 1
    faceNormals[t * 3] = nx / l; faceNormals[t * 3 + 1] = ny / l; faceNormals[t * 3 + 2] = nz / l
    faceAreas[t] = l * 0.5
  }

  const cosThresh = Math.cos((creaseAngleDeg * Math.PI) / 180)
  const outPos = new Float32Array(tCount * 9)
  const outNrm = new Float32Array(tCount * 9)
  const outIdx = new Uint32Array(tCount * 3)

  for (let t = 0; t < tCount; t++) {
    const fnx = faceNormals[t * 3], fny = faceNormals[t * 3 + 1], fnz = faceNormals[t * 3 + 2]
    for (let k = 0; k < 3; k++) {
      const vi = indices[t * 3 + k]
      const outVi = t * 3 + k
      outIdx[outVi] = outVi
      const o = outVi * 3
      outPos[o] = positions[vi * 3]
      outPos[o + 1] = positions[vi * 3 + 1]
      outPos[o + 2] = positions[vi * 3 + 2]

      let snx = 0, sny = 0, snz = 0
      const nbTris = vertTris[vi]
      for (let m = 0; m < nbTris.length; m++) {
        const nt = nbTris[m]
        const ntx = faceNormals[nt * 3], nty = faceNormals[nt * 3 + 1], ntz = faceNormals[nt * 3 + 2]
        if (fnx * ntx + fny * nty + fnz * ntz >= cosThresh) {
          const w = faceAreas[nt]
          snx += ntx * w; sny += nty * w; snz += ntz * w
        }
      }
      const sl = Math.hypot(snx, sny, snz) || 1
      outNrm[o] = snx / sl; outNrm[o + 1] = sny / sl; outNrm[o + 2] = snz / sl
    }
  }
  return { positions: outPos, normals: outNrm, indices: outIdx }
}

/** Builds a BufferGeometry with crease-aware split normals (flat across hard creases > creaseAngleDeg, smooth across gentle bevels). */
function buildCreaseAwareGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  creaseAngleDeg: number,
): BufferGeometry {
  const bufs = buildCreasePreviewBuffers(positions, indices, creaseAngleDeg)
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(bufs.positions, 3))
  geo.setAttribute('normal', new BufferAttribute(bufs.normals, 3))
  geo.setIndex(new BufferAttribute(bufs.indices, 1))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

/** Slices any triangle mesh with an arbitrary 3D plane, returning exact 2D cross-section line segments in (u, v) plane coordinates. */
export function sliceMeshByPlane(
  positions: Float32Array,
  indices: Uint32Array,
  planeOrigin: Vec3,
  planeNormal: Vec3,
  axisU: Vec3,
  axisV: Vec3,
): SectionSegment2D[] {
  const n = vNorm(planeNormal)
  const u = vNorm(axisU)
  const v = vNorm(axisV)
  const segs: SectionSegment2D[] = []
  const tCount = indices.length / 3
  const eps = 1e-6

  const getP = (vi: number): Vec3 => ({ x: positions[vi * 3], y: positions[vi * 3 + 1], z: positions[vi * 3 + 2] })
  const toUV = (p: Vec3): [number, number] => {
    const d = vSub(p, planeOrigin)
    return [vDot(d, u), vDot(d, v)]
  }

  for (let t = 0; t < tCount; t++) {
    const p0 = getP(indices[t * 3]), p1 = getP(indices[t * 3 + 1]), p2 = getP(indices[t * 3 + 2])
    const d0 = vDot(vSub(p0, planeOrigin), n)
    const d1 = vDot(vSub(p1, planeOrigin), n)
    const d2 = vDot(vSub(p2, planeOrigin), n)
    const hits: Vec3[] = []
    const pairs: [Vec3, Vec3, number, number][] = [[p0, p1, d0, d1], [p1, p2, d1, d2], [p2, p0, d2, d0]]
    for (const [a, b, da, db] of pairs) {
      if ((da > eps && db < -eps) || (da < -eps && db > eps)) {
        hits.push(vLerp(a, b, da / (da - db)))
      } else if (Math.abs(da) <= eps) {
        hits.push(a)
      }
    }
    // Deduplicate hits on shared vertices
    const uniq: Vec3[] = []
    for (const h of hits) {
      if (!uniq.some(q => Math.hypot(q.x - h.x, q.y - h.y, q.z - h.z) < 1e-5)) uniq.push(h)
    }
    if (uniq.length >= 2) {
      const [u0, v0] = toUV(uniq[0])
      const [u1, v1] = toUV(uniq[1])
      if (Math.hypot(u1 - u0, v1 - v0) > 1e-5) {
        segs.push({ u0, v0, u1, v1 })
      }
    }
  }
  return segs
}

// ---------------------------------------------------------------------------
// Route C Single-Rock Explicit Polyhedral Boolean Builders: sandstone-ledge-c1 & c2
//   Shared primary planes, shoulder position, right cliff buttress & fracture cleft with sandstone-ledge-b!
//   C1: Sharp-edge base (parent oblique monolith + shoulder cut + right cliff relief + diagonal fracture + 3 chips).
//   C2: C1 + selective, asymmetric, finite geometric bevel cuts + explicit corner transition facets
//       (NO uniform equal-width chamfer strip; long hard cliff edges stay razor crisp!).
// ---------------------------------------------------------------------------
function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function makeSeedJitter(seed: number, canonicalSeed = 5104): (idx: number, amp: number) => number {
  if (seed === canonicalSeed) return () => 0
  return (idx: number, amp: number) => {
    let h = Math.imul(seed ^ Math.imul(idx + 1, 0x9e3779b1), 0x85ebca6b)
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
    h = (h ^ (h >>> 16)) >>> 0
    return ((h / 4294967295) * 2 - 1) * amp
  }
}

export interface BuildRouteCOptions {
  /** Skip full O(T^2) topology & self-intersection audit during interactive drag preview (bake & tests always run full audit). */
  skipFullAudit?: boolean
}

interface PolyCsgRecipe {
  id: PolyCsgVariantId
  name: string
  defaultCreaseDeg: number
  parentPlanes: HalfSpacePlane[]
  unionBlocks?: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[]
  cutters: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[]
}

async function executePolyCsgRecipe(
  recipe: PolyCsgRecipe,
  options?: BuildRouteCOptions,
): Promise<PolyCsgResult> {
  const wasm = await getManifoldModule()
  const t0 = performance.now()
  const { Manifold: ManifoldCtor, Mesh: MeshCtor } = wasm

  let fallbackCount = 0
  let fallbackMs = 0

  const makeSolidFromPlanes = (planes: HalfSpacePlane[], faceIdOffset: number): Manifold => {
    try {
      const data = buildConvexPolyhedronMeshData(planes, 3.6, faceIdOffset)
      const m: ManifoldMesh = new MeshCtor({
        numProp: 3,
        vertProperties: data.vertProperties,
        triVerts: data.triVerts,
        faceID: data.faceID,
      })
      m.merge()
      const solid = ManifoldCtor.ofMesh(m)
      if (String(solid.status()) === 'NoError') return solid
      solid.delete()
    } catch {
      // Near-coincident triple-plane sliver at an intermediate slider tick -> fall through to exact C++ trimByPlane!
    }

    const tFb0 = performance.now()
    fallbackCount++
    const normPlanes = planes.map((pl, idx) => ({
      n: vNorm(pl.n),
      h: pl.h,
      faceId: pl.faceId ?? (faceIdOffset + idx),
    }))
    let cur: Manifold = ManifoldCtor.cube([7.2, 7.2, 7.2], true)
    for (const pl of normPlanes) {
      const next = cur.trimByPlane([-pl.n.x, -pl.n.y, -pl.n.z], -pl.h)
      cur.delete()
      cur = next
    }
    const gm = cur.getMesh()
    const numProp = gm.numProp
    const vCount = gm.numVert
    const tCount = gm.triVerts.length / 3
    const vp = new Float32Array(vCount * 3)
    for (let i = 0; i < vCount; i++) {
      vp[i * 3] = gm.vertProperties[i * numProp]
      vp[i * 3 + 1] = gm.vertProperties[i * numProp + 1]
      vp[i * 3 + 2] = gm.vertProperties[i * numProp + 2]
    }
    const fidOut = new Uint32Array(tCount)
    for (let t = 0; t < tCount; t++) {
      const a = gm.triVerts[t * 3] * 3, b = gm.triVerts[t * 3 + 1] * 3, c = gm.triVerts[t * 3 + 2] * 3
      const ax = vp[a], ay = vp[a + 1], az = vp[a + 2]
      const bx = vp[b], by = vp[b + 1], bz = vp[b + 2]
      const cx = vp[c], cy = vp[c + 1], cz = vp[c + 2]
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
      const fn = vNorm({ x: e1y * e2z - e1z * e2y, y: e1z * e2x - e1x * e2z, z: e1x * e2y - e1y * e2x })
      const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3
      let bestId = faceIdOffset
      let bestErr = Infinity
      for (const pl of normPlanes) {
        const dotN = fn.x * pl.n.x + fn.y * pl.n.y + fn.z * pl.n.z
        const pErr = Math.abs(mx * pl.n.x + my * pl.n.y + mz * pl.n.z - pl.h)
        const err = (1 - dotN) * 2 + pErr
        if (err < bestErr) { bestErr = err; bestId = pl.faceId }
      }
      fidOut[t] = bestId
    }
    cur.delete()
    const tagged = new MeshCtor({
      numProp: 3,
      vertProperties: vp,
      triVerts: new Uint32Array(gm.triVerts),
      faceID: fidOut,
    })
    const resSolid = ManifoldCtor.ofMesh(tagged)
    fallbackMs += performance.now() - tFb0
    return resSolid
  }

  let solid: Manifold = makeSolidFromPlanes(recipe.parentPlanes, 10)
  if (recipe.unionBlocks) {
    for (const b of recipe.unionBlocks) {
      const blk = makeSolidFromPlanes(b.planes, b.faceIdBase)
      const next = solid.add(blk)
      solid.delete()
      blk.delete()
      solid = next
    }
  }
  for (const c of recipe.cutters) {
    const cutter = makeSolidFromPlanes(c.planes, c.faceIdBase)
    const next = solid.subtract(cutter)
    solid.delete()
    cutter.delete()
    solid = next
  }

  const statusCode = String(solid.status())
  const parts = solid.decompose()
  const rawManifoldComponents = parts.length
  let chosen = solid
  if (parts.length > 1) {
    let bestIdx = 0
    let bestVol = -1
    for (let i = 0; i < parts.length; i++) {
      const vol = parts[i].volume()
      if (vol > bestVol) { bestVol = vol; bestIdx = i }
    }
    chosen = parts[bestIdx]
    for (let i = 0; i < parts.length; i++) {
      if (i !== bestIdx) parts[i].delete()
    }
    solid.delete()
  } else {
    for (const p of parts) p.delete()
  }

  const outMesh = chosen.getMesh()
  const numProp = outMesh.numProp
  const vCount = outMesh.numVert
  const positions = new Float32Array(vCount * 3)
  let minY = Infinity
  for (let i = 0; i < vCount; i++) {
    const x = outMesh.vertProperties[i * numProp]
    const y = outMesh.vertProperties[i * numProp + 1]
    const z = outMesh.vertProperties[i * numProp + 2]
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    if (y < minY) minY = y
  }
  const shiftY = Number.isFinite(minY) ? -minY : 0
  if (Math.abs(shiftY) > 1e-7) {
    for (let i = 0; i < vCount; i++) positions[i * 3 + 1] += shiftY
  }

  const indices = new Uint32Array(outMesh.triVerts)
  const faceIds = outMesh.faceID && outMesh.faceID.length === indices.length / 3
    ? new Uint32Array(outMesh.faceID)
    : new Uint32Array(indices.length / 3)

  chosen.delete()

  const tAfterBool = performance.now()
  const booleanMs = tAfterBool - t0
  let audit: PolyCsgAudit
  if (options?.skipFullAudit) {
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const buildMs = performance.now() - t0
    audit = {
      manifoldStatus: statusCode,
      rawManifoldComponents,
      vertices: vCount,
      triangles: indices.length / 3,
      faceGroups: 0,
      connectedComponents: 1,
      openEdges: 0,
      nonManifoldEdges: 0,
      windingMismatches: 0,
      degenerateTriangles: 0,
      selfIntersections: 0,
      minY: 0,
      maxY: Number((Number.isFinite(maxY) ? maxY : 0).toFixed(4)),
      size: [
        Number((maxX - minX).toFixed(3)),
        Number((Number.isFinite(maxY) ? maxY : 0).toFixed(3)),
        Number((maxZ - minZ).toFixed(3)),
      ],
      buildMs: Math.round(buildMs * 10) / 10,
      phases: {
        booleanMs: Math.round(booleanMs * 10) / 10,
        fallbackMs: Math.round(fallbackMs * 10) / 10,
        fallbackCount,
        auditMs: 0,
        totalMs: Math.round(buildMs * 10) / 10,
      },
    }
  } else {
    const tAud0 = performance.now()
    const buildMs = performance.now() - t0
    audit = auditExplicitMesh(positions, indices, faceIds, statusCode, rawManifoldComponents, buildMs)
    const auditMs = performance.now() - tAud0
    const totalMs = performance.now() - t0
    audit.buildMs = Math.round(totalMs * 10) / 10
    audit.phases = {
      booleanMs: Math.round(booleanMs * 10) / 10,
      fallbackMs: Math.round(fallbackMs * 10) / 10,
      fallbackCount,
      auditMs: Math.round(auditMs * 10) / 10,
      totalMs: Math.round(totalMs * 10) / 10,
    }
  }

  return {
    id: recipe.id,
    name: recipe.name,
    positions,
    indices,
    faceIds,
    shiftY,
    audit,
    toBufferGeometry(creaseAngleDeg = recipe.defaultCreaseDeg) {
      return buildCreaseAwareGeometry(positions, indices, creaseAngleDeg)
    },
  }
}

export async function buildSandstoneLedgeRouteC(
  variant: 'c1' | 'c2',
  params?: RouteCSculptParams,
  options?: BuildRouteCOptions,
): Promise<PolyCsgResult> {
  const seed = Math.round(params?.seed ?? 5104)
  const jitter = makeSeedJitter(seed, 5104)
  const shoulderDepth = clampRange(params?.shoulderDepth ?? 1.0, 0.65, 1.35)
  const dShoulder = shoulderDepth - 1.0
  const bevelScale = variant === 'c2' ? clampRange(params?.bevelScale ?? 1.0, 0.0, 1.4) : 0
  const notchDepth = clampRange(params?.notchDepth ?? 1.0, 0.5, 1.4)
  const dNotch = notchDepth - 1.0

  // 1. SINGLE unified eccentric oblique parent monolith (exact shared planes with sandstone-ledge-b!)
  const parentPlanes: HalfSpacePlane[] = [
    { n: { x: 0, y: -1, z: 0 }, h: 0.0, faceId: 10 },
    { n: { x: -0.27 + jitter(1, 0.025), y: 0.94, z: 0.20 + jitter(2, 0.025) }, h: 0.87 + jitter(3, 0.025), faceId: 11 },
    { n: { x: 0.46 + jitter(4, 0.025), y: 0.85, z: -0.24 + jitter(5, 0.025) }, h: 1.24 + jitter(6, 0.022), faceId: 12 },
    { n: { x: 0.93, y: 0.22 + jitter(7, 0.02), z: 0.29 + jitter(8, 0.025) }, h: 1.09 + jitter(9, 0.024), faceId: 13 },
    { n: { x: 0.70 + jitter(10, 0.02), y: 0.22, z: 0.68 }, h: 0.92 + jitter(11, 0.02), faceId: 14 },
    { n: { x: 0.34 + jitter(12, 0.02), y: 0.34, z: 0.88 }, h: 0.68 + jitter(13, 0.018), faceId: 15 },
    { n: { x: -0.06 + jitter(14, 0.018), y: 0.15, z: 0.99 }, h: 0.545 + jitter(15, 0.016), faceId: 16 },
    { n: { x: -0.91, y: 0.34 + jitter(16, 0.02), z: 0.24 + jitter(17, 0.02) }, h: 1.20 + jitter(18, 0.03), faceId: 17 },
    { n: { x: -0.66, y: 0.64, z: 0.39 }, h: 1.02 + jitter(19, 0.02), faceId: 18 },
    { n: { x: -0.38 + jitter(20, 0.02), y: 0.24, z: -0.89 }, h: 0.72 + jitter(21, 0.02), faceId: 19 },
    { n: { x: 0.16 + jitter(22, 0.02), y: 0.26, z: -0.95 }, h: 0.66 + jitter(23, 0.02), faceId: 20 },
    { n: { x: 0.76, y: 0.25, z: -0.60 }, h: 0.94 + jitter(24, 0.02), faceId: 21 },
    { n: { x: -0.06, y: -0.56, z: 0.83 }, h: 0.445, faceId: 22 },
    { n: { x: -0.14, y: -0.56, z: -0.82 }, h: 0.49, faceId: 23 },
    { n: { x: 0.84, y: -0.48, z: -0.24 }, h: 0.88, faceId: 24 },
    { n: { x: -0.80, y: -0.54, z: 0.26 }, h: 0.95, faceId: 25 },
  ]

  // 2. Concave & Localized Subtractive Cutters (shared by C1 and C2)
  const rampShift = dShoulder * 0.13 + jitter(25, 0.018)
  const riserShift = dShoulder * 0.11 + jitter(26, 0.018)
  const notchUpShift = -dNotch * 0.036
  const cuttersPlanes: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = [
    {
      name: 'shoulderCleavage',
      faceIdBase: 40,
      planes: [
        { n: { x: 0.23, y: -0.96, z: -0.17 }, h: -0.495 + rampShift, faceId: 40 },
        { n: { x: 0.82, y: -0.47, z: -0.33 }, h: -0.34 - riserShift, faceId: 41 },
      ],
    },
    {
      name: 'upperRightCliffRelief',
      faceIdBase: 50,
      planes: [
        { n: { x: -0.38, y: -0.84, z: -0.39 }, h: -0.78 + jitter(27, 0.025), faceId: 50 },
        { n: { x: -0.94, y: -0.28, z: -0.19 }, h: -0.99 + jitter(28, 0.02), faceId: 51 },
      ],
    },
    {
      name: 'shoulderFractureNotch',
      faceIdBase: 60,
      planes: buildFiniteVNotchPlanes({
        origin: {
          x: -0.02 + riserShift * 0.85 - notchUpShift * 0.26,
          y: 0.49 - rampShift * 0.90 + notchUpShift * 0.88,
          z: 0.28 + notchUpShift * 0.39,
        },
        across: { x: 0.78, y: -0.22, z: -0.58 },
        upOut: { x: -0.26, y: 0.88, z: 0.39 },
        throatHalf: 0.036 * (1 + dNotch * 0.42),
        angleLeftRad: 0.56,
        angleRightRad: 0.16,
        halfLenFront: 0.50,
        halfLenBack: 0.34,
        backFloorSlopeRad: 0.48,
        faceIdBase: 60,
      }),
    },
    {
      name: 'footNotchFront',
      faceIdBase: 70,
      planes: buildFiniteVNotchPlanes({
        origin: { x: -0.34 + jitter(29, 0.04), y: 0.06, z: 0.54 - dNotch * 0.022 },
        across: { x: 0.94, y: 0.10, z: 0.32 },
        upOut: { x: 0.16, y: -0.24, z: 0.96 },
        throatHalf: 0.048 * (1 + dNotch * 0.32),
        angleLeftRad: 0.76,
        angleRightRad: 0.54,
        halfLenFront: 0.24,
        halfLenBack: 0.22,
        backFloorSlopeRad: 0.55,
        frontFloorSlopeRad: 0.55,
        faceIdBase: 70,
      }),
    },
    {
      name: 'crownCornerChip',
      faceIdBase: 80,
      planes: buildFiniteVNotchPlanes({
        origin: { x: 0.14 + riserShift * 0.65, y: 0.90 + jitter(30, 0.015), z: 0.12 },
        across: { x: 0.72, y: -0.35, z: -0.60 },
        upOut: { x: -0.58, y: 0.72, z: 0.38 },
        throatHalf: 0.024,
        angleLeftRad: 0.62,
        angleRightRad: 0.30,
        halfLenFront: 0.28,
        halfLenBack: 0.24,
        backFloorSlopeRad: 0.50,
        frontFloorSlopeRad: 0.45,
        faceIdBase: 80,
      }),
    },
    {
      name: 'toeCornerChip',
      faceIdBase: 90,
      planes: buildFiniteVNotchPlanes({
        origin: { x: -1.04, y: 0.27 - rampShift * 0.45, z: 0.22 },
        across: { x: 0.44, y: -0.16, z: -0.88 },
        upOut: { x: -0.58, y: 0.66, z: 0.47 },
        throatHalf: 0.020,
        angleLeftRad: 0.52,
        angleRightRad: 0.34,
        halfLenFront: 0.26,
        halfLenBack: 0.24,
        backFloorSlopeRad: 0.52,
        frontFloorSlopeRad: 0.42,
        faceIdBase: 90,
      }),
    },
  ]

  // 3. C2 ONLY: Intentional, finite, ASYMMETRIC localized geometric bevel planes + explicit corner transition facets!
  const useBevels = variant === 'c2' && bevelScale > 0.02
  const scaleGlobalH = (tangentH: number, canonH: number) => tangentH - (tangentH - canonH) * bevelScale
  const scaleCutterH = (tangentH: number, canonH: number) => tangentH + (canonH - tangentH) * bevelScale

  const c2GlobalBevelPlanes: HalfSpacePlane[] = useBevels ? [
    { n: { x: -0.12, y: 0.72, z: 0.68 }, h: scaleGlobalH(0.8584, 0.834), faceId: 110 },
    { n: { x: 0.02, y: 0.73, z: -0.68 }, h: scaleGlobalH(1.0400, 1.018), faceId: 111 },
    { n: { x: 0.70, y: 0.65, z: 0.30 }, h: scaleGlobalH(1.2287, 1.202), faceId: 113 },
    { n: { x: 0.62, y: 0.62, z: -0.48 }, h: scaleGlobalH(1.1834, 1.161), faceId: 114 },
  ] : []

  const c2FiniteBevelCutters: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = useBevels ? [
    {
      name: 'shoulderCrestBevel',
      faceIdBase: 120,
      planes: [
        { n: { x: 0.586, y: -0.757, z: -0.288 }, h: scaleCutterH(-0.653, -0.642) - riserShift * 0.48, faceId: 120 },
        { n: { x: -1, y: 0, z: 0 }, h: 0.40, faceId: 122 },
      ],
    },
    {
      name: 'shoulderFrontCornerTransition',
      faceIdBase: 125,
      planes: [
        { n: { x: 0.34, y: -0.68, z: -0.65 }, h: scaleCutterH(-0.758, -0.734) - riserShift * 0.25, faceId: 125 },
        { n: { x: -1, y: 0, z: 0 }, h: 0.35, faceId: 126 },
      ],
    },
    {
      name: 'rampFrontTaperedBevel',
      faceIdBase: 130,
      planes: [
        { n: { x: 0.15, y: -0.68, z: -0.72 }, h: scaleCutterH(-0.637, -0.618) + rampShift * 0.66, faceId: 130 },
        { n: { x: 0.90, y: -0.22, z: -0.38 }, h: -0.30 + riserShift * 0.72, faceId: 131 },
      ],
    },
    {
      name: 'rampRearWeatheredBevel',
      faceIdBase: 135,
      planes: [
        { n: { x: 0.33, y: -0.66, z: 0.67 }, h: scaleCutterH(-0.812, -0.794) + rampShift * 0.64, faceId: 135 },
        { n: { x: 0.94, y: 0.30, z: 0.16 }, h: -0.20 + riserShift * 0.72, faceId: 136 },
        { n: { x: 0, y: 1, z: 0 }, h: 0.56 - rampShift * 0.85, faceId: 137 },
      ],
    },
    {
      name: 'rightButtressShelfBevel',
      faceIdBase: 140,
      planes: [
        { n: { x: -0.74, y: -0.58, z: -0.34 }, h: scaleCutterH(-1.034, -1.016), faceId: 140 },
        { n: { x: 0, y: 1, z: 0 }, h: 0.54, faceId: 141 },
        { n: { x: 0, y: 0, z: -1 }, h: 0.25, faceId: 142 },
      ],
    },
  ] : []

  return executePolyCsgRecipe(
    {
      id: variant === 'c1' ? 'sandstone-ledge-c1' : 'sandstone-ledge-c2',
      name: variant === 'c1'
        ? '低矮横展砂岩 · 路线 C1 锐边基底 (Manifold)'
        : '低矮横展砂岩 · 路线 C2 显式局部几何倒角版 (Manifold)',
      defaultCreaseDeg: variant === 'c1' ? 18 : 26,
      parentPlanes: [...parentPlanes, ...c2GlobalBevelPlanes],
      cutters: [...cuttersPlanes, ...c2FiniteBevelCutters],
    },
    options,
  )
}

// ---------------------------------------------------------------------------
// Route C Archetype 2: Stepped Block Bluff (阶梯方巨岩 · block-bluff-c1 & c2)
//   Distinct tall, chunky, upright blocky cliff monolith (~1.90m x 1.44m x 1.38m)
//   with high cross-rolled stepped left shoulder terrace, bold diagonal front cliff ridge,
//   proud lower-right cliff buttress step, open V-notch at the shoulder elbow,
//   solid thick rear spine (145° monolithic integrity), grounded faceted feet,
//   and selective asymmetric localized geometric bevels (zero uniform chamfer!).
// ---------------------------------------------------------------------------
export async function buildBlockBluffRouteC(
  variant: 'c1' | 'c2',
  params?: RouteCSculptParams,
  options?: BuildRouteCOptions,
): Promise<PolyCsgResult> {
  const seed = Math.round(params?.seed ?? 7342)
  const jitter = makeSeedJitter(seed, 7342)
  const shoulderDepth = clampRange(params?.shoulderDepth ?? 1.0, 0.65, 1.35)
  const dShoulder = shoulderDepth - 1.0
  const bevelScale = variant === 'c2' ? clampRange(params?.bevelScale ?? 1.0, 0.0, 1.4) : 0
  const notchDepth = clampRange(params?.notchDepth ?? 1.0, 0.5, 1.4)
  const dNotch = notchDepth - 1.0

  // 1. Unified massive upright blocky crag parent monolith (distinct proportions from sandstone-ledge!)
  const parentPlanes: HalfSpacePlane[] = [
    // Crisp flat grounded bearing plane (y >= 0)
    { n: { x: 0, y: -1, z: 0 }, h: 0.0, faceId: 10 },
    // Oblique rising blocky crown (~16° left->right rise + slight forward roll -> sunlit hero top!)
    { n: { x: -0.27 + jitter(1, 0.024), y: 0.94, z: 0.21 + jitter(2, 0.022) }, h: 1.25 + jitter(3, 0.026), faceId: 11 },
    // Eccentric rear-right descending summit break (places proud cliff apex near x~+0.28, y~1.44, z~-0.08)
    { n: { x: 0.47 + jitter(4, 0.024), y: 0.84, z: -0.26 + jitter(5, 0.022) }, h: 1.41 + jitter(6, 0.024), faceId: 12 },
    // Steep outer right cliff wall (extends to x~+0.93 so upper-right relief carves a bold lower-right buttress!)
    { n: { x: 0.91, y: 0.25 + jitter(7, 0.02), z: 0.33 + jitter(8, 0.022) }, h: 0.94 + jitter(9, 0.024), faceId: 13 },
    // Crisp dark diagonal front-right shadow cliff break
    { n: { x: 0.68 + jitter(10, 0.02), y: 0.21, z: 0.70 }, h: 0.89 + jitter(11, 0.02), faceId: 14 },
    // Bold diagonally-tilted front-right cliff flank (oblique structural front ridge, ZERO vertical seam!)
    { n: { x: 0.29 + jitter(12, 0.02), y: 0.33, z: 0.90 }, h: 0.84 + jitter(13, 0.02), faceId: 15 },
    // Broad intact sunlit front-left hero cliff face (~81° battered vertical wall)
    { n: { x: -0.10 + jitter(14, 0.018), y: 0.16, z: 0.98 }, h: 0.685 + jitter(15, 0.018), faceId: 16 },
    // Tall chunky left cliff wall (grounds the high stepped terrace block solidly!)
    { n: { x: -0.92, y: 0.26 + jitter(16, 0.02), z: 0.27 + jitter(17, 0.02) }, h: 0.93 + jitter(18, 0.026), faceId: 17 },
    // Crisp angled upper-left corner nose facet
    { n: { x: -0.66, y: 0.62, z: 0.42 }, h: 1.03 + jitter(19, 0.02), faceId: 18 },
    // Converging rear-left fractured cliff flank
    { n: { x: -0.52 + jitter(20, 0.02), y: 0.23, z: -0.82 }, h: 0.76 + jitter(21, 0.02), faceId: 19 },
    // Solid thick unbroken rear-right spine (guarantees heavy monolithic back in 145° counter-evidence view!)
    { n: { x: 0.24 + jitter(22, 0.02), y: 0.25, z: -0.94 }, h: 0.72 + jitter(23, 0.02), faceId: 20 },
    // Rear-right corner cliff
    { n: { x: 0.76, y: 0.25, z: -0.60 }, h: 0.87 + jitter(24, 0.02), faceId: 21 },
    // Four angular grounded base undercuts (leave crisp seated rock feet, zero boxy/marshmallow skirt!)
    { n: { x: -0.08, y: -0.56, z: 0.82 }, h: 0.515, faceId: 22 },
    { n: { x: -0.14, y: -0.56, z: -0.82 }, h: 0.550, faceId: 23 },
    { n: { x: 0.82, y: -0.50, z: -0.28 }, h: 0.74, faceId: 24 },
    { n: { x: -0.80, y: -0.52, z: 0.30 }, h: 0.72, faceId: 25 },
  ]

  // 2. Concave & Localized Subtractive Cutters (shared by C1 & C2)
  const benchShift = dShoulder * 0.16 + jitter(25, 0.02)
  const riserShift = dShoulder * 0.12 + jitter(26, 0.018)
  const notchUpShift = -dNotch * 0.040
  const cuttersPlanes: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = [
    // Primary high oblique stepped shoulder terrace wedge (carves crisp high left step bench + steep ~66° cliff riser!)
    {
      name: 'bluffShoulderTerrace',
      faceIdBase: 40,
      planes: [
        { n: { x: 0.27, y: -0.94, z: -0.20 }, h: -0.78 + benchShift, faceId: 40 },
        { n: { x: 0.84, y: -0.36, z: -0.40 }, h: -0.43 - riserShift, faceId: 41 },
      ],
    },
    // Outward-opening upper-right cliff step relief (reveals proud lower-right cliff buttress step!)
    {
      name: 'bluffUpperRightRelief',
      faceIdBase: 50,
      planes: [
        { n: { x: -0.35, y: -0.85, z: -0.39 }, h: -0.93 + jitter(27, 0.025), faceId: 50 },
        { n: { x: -0.92, y: -0.28, z: -0.27 }, h: -0.80 + jitter(28, 0.02), faceId: 51 },
      ],
    },
    // Concentrated diagonal shoulder-elbow V-notch (monotonically open V-trough on the plane-40/41 elbow — ZERO overhang hook!)
    {
      name: 'bluffShoulderNotch',
      faceIdBase: 60,
      planes: buildFiniteVNotchPlanes({
        origin: {
          x: -0.02 + riserShift * 0.85 - notchUpShift * 0.22,
          y: 0.685 - benchShift * 0.90 + notchUpShift * 0.90,
          z: 0.34 + notchUpShift * 0.37,
        },
        across: { x: 0.82, y: -0.18, z: -0.54 },
        upOut: { x: -0.16, y: 0.92, z: 0.36 },
        throatHalf: 0.038 * (1 + dNotch * 0.42),
        angleLeftRad: 0.54,
        angleRightRad: 0.34,
        halfLenFront: 0.56,
        halfLenBack: 0.38,
        backFloorSlopeRad: 0.48,
        faceIdBase: 60,
      }),
    },
    // Localized angular front-mid base foot notch (breaks continuous horizontal skirt!)
    {
      name: 'bluffFootNotchFront',
      faceIdBase: 70,
      planes: buildFiniteVNotchPlanes({
        origin: { x: -0.22 + jitter(29, 0.04), y: 0.09, z: 0.65 - dNotch * 0.024 },
        across: { x: 0.94, y: 0.08, z: 0.33 },
        upOut: { x: 0.14, y: -0.22, z: 0.96 },
        throatHalf: 0.052 * (1 + dNotch * 0.32),
        angleLeftRad: 0.74,
        angleRightRad: 0.56,
        halfLenFront: 0.26,
        halfLenBack: 0.24,
        backFloorSlopeRad: 0.55,
        frontFloorSlopeRad: 0.55,
        faceIdBase: 70,
      }),
    },
    // Localized upper-front crown corner flake chip (breaks boxy summit silhouette!)
    {
      name: 'bluffCrownCornerChip',
      faceIdBase: 80,
      planes: buildFiniteVNotchPlanes({
        origin: { x: 0.03 + riserShift * 0.60, y: 1.21 + jitter(30, 0.015), z: 0.30 },
        across: { x: 0.74, y: -0.32, z: -0.59 },
        upOut: { x: -0.56, y: 0.72, z: 0.40 },
        throatHalf: 0.030,
        angleLeftRad: 0.60,
        angleRightRad: 0.30,
        halfLenFront: 0.34,
        halfLenBack: 0.26,
        backFloorSlopeRad: 0.52,
        frontFloorSlopeRad: 0.45,
        faceIdBase: 80,
      }),
    },
    // Localized outer front-left terrace lip flake chip (angular weathered stone corner!)
    {
      name: 'bluffTerraceLipChip',
      faceIdBase: 90,
      planes: buildFiniteVNotchPlanes({
        origin: { x: -0.68, y: 0.58 - benchShift * 0.55, z: 0.44 },
        across: { x: 0.48, y: -0.18, z: -0.86 },
        upOut: { x: -0.60, y: 0.64, z: 0.48 },
        throatHalf: 0.028,
        angleLeftRad: 0.54,
        angleRightRad: 0.34,
        halfLenFront: 0.30,
        halfLenBack: 0.24,
        backFloorSlopeRad: 0.52,
        frontFloorSlopeRad: 0.44,
        faceIdBase: 90,
      }),
    },
  ]

  // 3. C2 ONLY: Selective, finite, ASYMMETRIC localized geometric bevels (tangent planes calibrated from C1!)
  const useBevels = variant === 'c2' && bevelScale > 0.02
  const scaleGlobalH = (tangentH: number, canonH: number) => tangentH - (tangentH - canonH) * bevelScale
  const scaleCutterH = (tangentH: number, canonH: number) => tangentH + (canonH - tangentH) * bevelScale

  const c2GlobalBevelPlanes: HalfSpacePlane[] = useBevels ? [
    // Asymmetric upper-front summit crest bevel (~2.9 cm depth -> ~6 cm sunlit weathered top crest)
    { n: { x: -0.12, y: 0.72, z: 0.68 }, h: scaleGlobalH(1.1774, 1.148), faceId: 110 },
    // Asymmetric upper-rear summit crest bevel (~2.7 cm depth)
    { n: { x: 0.04, y: 0.73, z: -0.68 }, h: scaleGlobalH(1.3039, 1.277), faceId: 111 },
    // Upper-right summit-to-cliff corner transition bevel (~2.9 cm depth, leaves lower right cliff razor crisp!)
    { n: { x: 0.68, y: 0.66, z: 0.32 }, h: scaleGlobalH(1.2483, 1.219), faceId: 113 },
    // Upper-rear-right apex corner transition bevel (~2.5 cm depth)
    { n: { x: 0.62, y: 0.62, z: -0.48 }, h: scaleGlobalH(1.2542, 1.229), faceId: 114 },
  ] : []

  const c2FiniteBevelCutters: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = useBevels ? [
    // Restrained asymmetric bevel ONLY along the upper shoulder-riser crest
    {
      name: 'bluffShoulderCrestBevel',
      faceIdBase: 120,
      planes: [
        { n: { x: 0.62, y: -0.73, z: -0.29 }, h: scaleCutterH(-0.9645, -0.946) - riserShift * 0.48, faceId: 120 },
        { n: { x: -1, y: 0, z: 0 }, h: 0.36, faceId: 122 },
      ],
    },
    // Explicit 3-way triangular corner transition facet at upper-front shoulder crown corner
    {
      name: 'bluffShoulderCornerTransition',
      faceIdBase: 125,
      planes: [
        { n: { x: 0.34, y: -0.68, z: -0.65 }, h: scaleCutterH(-1.0594, -1.032) - riserShift * 0.25, faceId: 125 },
        { n: { x: -1, y: 0, z: 0 }, h: 0.32, faceId: 126 },
      ],
    },
    // Tapered asymmetric bevel along the front-left lip of the high stepped terrace (tracks benchShift!)
    {
      name: 'bluffTerraceFrontLipBevel',
      faceIdBase: 130,
      planes: [
        { n: { x: 0.14, y: -0.68, z: -0.72 }, h: scaleCutterH(-0.9888, -0.964) + benchShift * 0.66, faceId: 130 },
        { n: { x: 0.90, y: -0.20, z: -0.39 }, h: -0.14 + riserShift * 0.72, faceId: 131 },
      ],
    },
    // Restrained weathered bevel along the rear-left terrace crest (stops strictly before shoulder riser -> zero elbow nick!)
    {
      name: 'bluffTerraceRearLipBevel',
      faceIdBase: 135,
      planes: [
        { n: { x: 0.32, y: -0.66, z: 0.68 }, h: scaleCutterH(-0.9700, -0.946) + benchShift * 0.64, faceId: 135 },
        { n: { x: 0.84, y: -0.36, z: -0.40 }, h: -0.44 - riserShift, faceId: 136 },
      ],
    },
    // Localized asymmetric bevel ONLY on the outer lip of the proud lower-right cliff buttress step (bounded parallel to wall 51 -> zero roof nick!)
    {
      name: 'bluffRightButtressLipBevel',
      faceIdBase: 140,
      planes: [
        { n: { x: -0.72, y: -0.58, z: -0.38 }, h: scaleCutterH(-1.0324, -1.004), faceId: 140 },
        { n: { x: -0.92, y: -0.28, z: -0.27 }, h: -0.79, faceId: 141 },
        { n: { x: 0, y: 0, z: -1 }, h: 0.32, faceId: 142 },
      ],
    },
  ] : []

  return executePolyCsgRecipe(
    {
      id: variant === 'c1' ? 'block-bluff-c1' : 'block-bluff-c2',
      name: variant === 'c1'
        ? '阶梯方巨岩 · 路线 C1 锐边基底 (Manifold)'
        : '阶梯方巨岩 · 路线 C2 显式局部几何倒角版 (Manifold)',
      defaultCreaseDeg: variant === 'c1' ? 18 : 26,
      parentPlanes: [...parentPlanes, ...c2GlobalBevelPlanes],
      cutters: [...cuttersPlanes, ...c2FiniteBevelCutters],
    },
    options,
  )
}

interface TerraceBlockSpec {
  cx: number
  cz: number
  hx: number
  hz: number
  yTop: number
  yaw?: number
  tiltX?: number
  tiltZ?: number
  /** Side wall batter (positive = widens gently toward base for grounded cliff stance). */
  batter?: [number, number, number, number]
  /** Independent XZ yaw skew (radians) per wall [+X, -X, +Z, -Z] for natural non-orthogonal hand-hewn stone trapezoids! */
  wallSkew?: [number, number, number, number]
  /** Top-edge 45° chiseled bevel depths [+X, -X, +Z, -Z]. */
  topBevel?: [number, number, number, number]
  /** Vertical corner chamfer depths [(+X,+Z), (+X,-Z), (-X,+Z), (-X,-Z)]. */
  cornerBevel?: [number, number, number, number]
  bevelScale: number
  /** Base faceID for top & 4 walls (use non-bevel range, e.g. 10, 20, 30, 40, 50, 160..230). */
  faceIdBase: number
  /** Base faceID for bevels & chamfers (use 110..149 so PBR baker treats them as chiseled rims!). */
  bevelFaceIdBase: number
}

/** Builds a chamfered, battered, hand-chiseled terraced sandstone cliff block as exact half-space planes. */
function makeTerraceBlockPlanes(spec: TerraceBlockSpec): HalfSpacePlane[] {
  const { cx, cz, hx, hz, yTop, bevelScale, faceIdBase, bevelFaceIdBase } = spec
  const yaw = spec.yaw ?? 0
  const tiltX = spec.tiltX ?? 0
  const tiltZ = spec.tiltZ ?? 0
  const [batXp, batXm, batZp, batZm] = spec.batter ?? [0.09, 0.08, 0.09, 0.08]
  const [skXp, skXm, skZp, skZm] = spec.wallSkew ?? [0, 0, 0, 0]
  const [bXp, bXm, bZp, bZm] = spec.topBevel ?? [0.044, 0.040, 0.046, 0.038]
  const [cPP, cPM, cMP, cMM] = spec.cornerBevel ?? [0.055, 0.050, 0.058, 0.048]

  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  // Local horizontal axes: ex = (cy, 0, sy), ez = (-sy, 0, cy)
  const planeLocal = (
    px: number, py: number, pz: number,
    nx: number, ny: number, nz: number,
    faceId: number,
  ): HalfSpacePlane => {
    const wx = cx + cy * px - sy * pz
    const wy = py
    const wz = cz + sy * px + cy * pz
    const n = vNorm({
      x: cy * nx - sy * nz,
      y: ny,
      z: sy * nx + cy * nz,
    })
    return { n, h: n.x * wx + n.y * wy + n.z * wz, faceId }
  }

  // Skewed local wall horizontal normals so rock blocks are natural organic trapezoids instead of sterile CAD cubes
  const wxpX = Math.cos(skXp), wxpZ = Math.sin(skXp)
  const wxmX = -Math.cos(skXm), wxmZ = -Math.sin(skXm)
  const wzpX = -Math.sin(skZp), wzpZ = Math.cos(skZp)
  const wzmX = Math.sin(skZm), wzmZ = -Math.cos(skZm)

  const yMid = yTop * 0.5
  const planes: HalfSpacePlane[] = [
    // Slightly tilted flat top terrace
    planeLocal(0, yTop, 0, tiltX, 1, tiltZ, faceIdBase + 0),
    // Bottom anchor slightly below y=0 (cleanly trimmed flush at y=0 after union)
    planeLocal(0, -0.03, 0, 0, -1, 0, faceIdBase + 1),
    // 4 battered, subtly skewed cliff walls
    planeLocal(hx, yMid, 0, wxpX, batXp, wxpZ, faceIdBase + 2),
    planeLocal(-hx, yMid, 0, wxmX, batXm, wxmZ, faceIdBase + 3),
    planeLocal(0, yMid, hz, wzpX, batZp, wzpZ, faceIdBase + 4),
    planeLocal(0, yMid, -hz, wzmX, batZm, wzmZ, faceIdBase + 5),
  ]

  if (bevelScale > 0.02) {
    const bs = bevelScale
    // Approximate top-edge line positions accounting for wall batter & gentle top tilt
    const xTopP = hx - batXp * yMid
    const xTopM = -hx + batXm * yMid
    const zTopP = hz - batZp * yMid
    const zTopM = -hz + batZm * yMid
    const topYAt = (lx: number, lz: number) => yTop - tiltX * lx - tiltZ * lz

    const addTopBevel = (
      ex: number, ez: number,
      nx: number, ny: number, nz: number,
      depth: number,
      fid: number,
    ) => {
      if (depth * bs < 0.004) return
      const pl = planeLocal(ex, topYAt(ex, ez), ez, nx, ny, nz, fid)
      pl.h -= depth * bs
      planes.push(pl)
    }

    // 4 asymmetric chiseled 45° terrace rim bevels aligned with each skewed wall!
    addTopBevel(xTopP, 0, wxpX * 0.72, 0.69, wxpZ * 0.72, bXp, bevelFaceIdBase + 0)
    addTopBevel(xTopM, 0, wxmX * 0.71, 0.70, wxmZ * 0.71, bXm, bevelFaceIdBase + 1)
    addTopBevel(0, zTopP, wzpX * 0.73, 0.68, wzpZ * 0.73, bZp, bevelFaceIdBase + 2)
    addTopBevel(0, zTopM, wzmX * 0.71, 0.70, wzmZ * 0.71, bZm, bevelFaceIdBase + 3)

    // 4 chunky vertical corner chamfers (sculpted block corners instead of sharp 90° architectural boxes!)
    const addCornerChamfer = (
      sx: number, sz: number,
      batA: number, batB: number,
      depth: number,
      fid: number,
    ) => {
      if (depth * bs < 0.004) return
      const pl = planeLocal(sx * hx, yMid, sz * hz, sx, (batA + batB) * 0.45, sz, fid)
      pl.h -= depth * bs
      planes.push(pl)
    }
    addCornerChamfer(1, 1, batXp, batZp, cPP, bevelFaceIdBase + 4)
    addCornerChamfer(1, -1, batXp, batZm, cPM, bevelFaceIdBase + 5)
    addCornerChamfer(-1, 1, batXm, batZp, cMP, bevelFaceIdBase + 6)
    addCornerChamfer(-1, -1, batXm, batZm, cMM, bevelFaceIdBase + 7)
  }

  return planes
}

/**
 * Stylized Multi-Block Mossy Terraced Cliff Rock (`terraced-moss-bluff-c1` / `c2`):
 *   13 interlocking, asymmetrically chiseled sandstone strata blocks merged via exact Manifold union,
 *   then carved with clean through-going vertical & horizontal cleavage seams and edge-straddling
 *   weathered rim chips — strictly watertight single shell, crisp tight bevel rims framing lush inset moss!
 */
export async function buildTerracedMossBluffRouteC(
  variant: 'c1' | 'c2',
  params?: RouteCSculptParams,
  options?: BuildRouteCOptions,
): Promise<PolyCsgResult> {
  const seed = params?.seed ?? 7301
  const jitter = makeSeedJitter(seed, 7301)
  const shoulderDepth = clampRange(params?.shoulderDepth ?? 1.0, 0.65, 1.35)
  const bevelScale = variant === 'c1' ? 0 : clampRange(params?.bevelScale ?? 1.0, 0.0, 1.45)
  const notchDepth = clampRange(params?.notchDepth ?? 1.0, 0.5, 1.4)
  const dStep = (shoulderDepth - 1.0) * 0.14
  const dNotch = notchDepth - 1.0

  // 1. Hero central-right high mesa plateau (parent solid; crisp tight asymmetric 2.2-3.2cm sandstone rim bevels!)
  const parentPlanes = makeTerraceBlockPlanes({
    cx: 0.13 + jitter(1, 0.02),
    cz: -0.14 + jitter(2, 0.02),
    hx: 0.44,
    hz: 0.46,
    yTop: 0.99 + jitter(3, 0.02),
    yaw: -0.06 + jitter(4, 0.03),
    tiltX: -0.04,
    tiltZ: 0.05,
    batter: [0.06, 0.05, 0.08, 0.08],
    wallSkew: [0.09, -0.07, 0.11, -0.08],
    topBevel: [0.026, 0.018, 0.030, 0.020],
    cornerBevel: [0.048, 0.036, 0.032, 0.040],
    bevelScale,
    faceIdBase: 10,
    bevelFaceIdBase: 110,
  })

  // 2. Twelve interlocking stepped sedimentary cliff blocks (solid core overlap + crisp layered strata ledges!)
  const unionBlocks: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = [
    // Tallest rear-left sentinel pillar (angled slightly, rises proud above main mesa!)
    {
      name: 'backLeftPillar',
      faceIdBase: 20,
      planes: makeTerraceBlockPlanes({
        cx: -0.40 + jitter(5, 0.02),
        cz: -0.29 + jitter(6, 0.02),
        hx: 0.29,
        hz: 0.30,
        yTop: 1.12 + dStep * 0.4 + jitter(7, 0.02),
        yaw: 0.22 + jitter(8, 0.04),
        tiltX: 0.05,
        tiltZ: 0.06,
        batter: [0.05, 0.08, 0.07, 0.09],
        wallSkew: [-0.08, 0.12, -0.10, 0.07],
        topBevel: [0.024, 0.026, 0.030, 0.020],
        cornerBevel: [0.046, 0.036, 0.048, 0.038],
        bevelScale,
        faceIdBase: 20,
        bevelFaceIdBase: 118,
      }),
    },
    // Front-left bold mid-height diagonal shield buttress (angled hexagonal rock facet!)
    {
      name: 'frontLeftButtress',
      faceIdBase: 30,
      planes: makeTerraceBlockPlanes({
        cx: -0.31 + jitter(9, 0.02),
        cz: 0.22 + jitter(10, 0.02),
        hx: 0.27,
        hz: 0.26,
        yTop: 0.74 - dStep * 0.35 + jitter(11, 0.02),
        yaw: -0.22 + jitter(12, 0.04),
        tiltX: -0.11,
        tiltZ: 0.09,
        batter: [0.07, 0.09, 0.09, 0.06],
        wallSkew: [0.14, -0.11, 0.16, -0.08],
        topBevel: [0.022, 0.024, 0.028, 0.016],
        cornerBevel: [0.048, 0.030, 0.052, 0.034],
        bevelScale,
        faceIdBase: 30,
        bevelFaceIdBase: 126,
      }),
    },
    // Prominent front-center stepped mossy terrace shelf
    {
      name: 'frontLowerShelf',
      faceIdBase: 40,
      planes: makeTerraceBlockPlanes({
        cx: 0.09 + jitter(13, 0.02),
        cz: 0.43 + jitter(14, 0.02),
        hx: 0.34,
        hz: 0.28,
        yTop: 0.55 - dStep * 0.45 + jitter(15, 0.015),
        yaw: 0.07 + jitter(16, 0.03),
        tiltX: 0.02,
        tiltZ: 0.045,
        batter: [0.08, 0.08, 0.10, 0.05],
        wallSkew: [-0.10, 0.09, -0.12, 0.06],
        topBevel: [0.022, 0.020, 0.028, 0.016],
        cornerBevel: [0.046, 0.030, 0.050, 0.030],
        bevelScale,
        faceIdBase: 40,
        bevelFaceIdBase: 134,
      }),
    },
    // Front-center subtle lower strata foot step (breaks tall front vertical wall into crisp stepped geology!)
    {
      name: 'frontBaseStrataLedge',
      faceIdBase: 46,
      planes: makeTerraceBlockPlanes({
        cx: 0.15 + jitter(13, 0.015),
        cz: 0.50,
        hx: 0.32,
        hz: 0.25,
        yTop: 0.25 + jitter(15, 0.01),
        yaw: 0.11,
        tiltX: 0.04,
        tiltZ: 0.06,
        batter: [0.10, 0.10, 0.14, 0.06],
        topBevel: [0.020, 0.018, 0.024, 0.014],
        cornerBevel: [0.040, 0.026, 0.042, 0.024],
        bevelScale,
        faceIdBase: 46,
        bevelFaceIdBase: 138,
      }),
    },
    // Right-flank upper step ledge hugging main mesa (bright narrow mossy step band!)
    {
      name: 'rightUpperStep',
      faceIdBase: 50,
      planes: makeTerraceBlockPlanes({
        cx: 0.41 + jitter(17, 0.015),
        cz: -0.14 + jitter(18, 0.015),
        hx: 0.28,
        hz: 0.42,
        yTop: 0.81 - dStep * 0.25 + jitter(19, 0.015),
        yaw: -0.05 + jitter(20, 0.03),
        tiltX: 0.05,
        tiltZ: 0.03,
        batter: [0.08, 0.05, 0.08, 0.08],
        topBevel: [0.028, 0.018, 0.026, 0.024],
        cornerBevel: [0.042, 0.038, 0.028, 0.030],
        bevelScale,
        faceIdBase: 50,
        bevelFaceIdBase: 142,
      }),
    },
    // Right-flank cascading middle buttress column
    {
      name: 'rightMidButtress',
      faceIdBase: 56,
      planes: makeTerraceBlockPlanes({
        cx: 0.49 + jitter(21, 0.015),
        cz: 0.06 + jitter(22, 0.015),
        hx: 0.27,
        hz: 0.34,
        yTop: 0.60 - dStep * 0.30 + jitter(23, 0.015),
        yaw: -0.09,
        tiltX: 0.06,
        tiltZ: 0.04,
        batter: [0.10, 0.06, 0.09, 0.08],
        topBevel: [0.026, 0.018, 0.026, 0.020],
        cornerBevel: [0.044, 0.038, 0.028, 0.030],
        bevelScale,
        faceIdBase: 56,
        bevelFaceIdBase: 112,
      }),
    },
    // Right-flank lower-front cascading mossy foot shelf
    {
      name: 'rightLowerFront',
      faceIdBase: 160,
      planes: makeTerraceBlockPlanes({
        cx: 0.51 + jitter(21, 0.015),
        cz: 0.31 + jitter(22, 0.015),
        hx: 0.26,
        hz: 0.26,
        yTop: 0.39 - dStep * 0.25 + jitter(23, 0.012),
        yaw: 0.08 + jitter(24, 0.03),
        tiltX: 0.05,
        tiltZ: 0.05,
        batter: [0.11, 0.06, 0.11, 0.07],
        topBevel: [0.024, 0.016, 0.026, 0.018],
        cornerBevel: [0.042, 0.036, 0.030, 0.028],
        bevelScale,
        faceIdBase: 160,
        bevelFaceIdBase: 116,
      }),
    },
    // Right-flank rear-right staggered column (natural vertical block offset on right cliff!)
    {
      name: 'rightLowerRear',
      faceIdBase: 166,
      planes: makeTerraceBlockPlanes({
        cx: 0.52,
        cz: -0.34,
        hx: 0.24,
        hz: 0.24,
        yTop: 0.49,
        yaw: 0.12,
        tiltX: 0.06,
        tiltZ: -0.04,
        batter: [0.11, 0.06, 0.07, 0.11],
        topBevel: [0.024, 0.016, 0.018, 0.024],
        cornerBevel: [0.038, 0.044, 0.028, 0.032],
        bevelScale,
        faceIdBase: 166,
        bevelFaceIdBase: 120,
      }),
    },
    // Far-left mid sandstone strata step
    {
      name: 'farLeftUpperStep',
      faceIdBase: 170,
      planes: makeTerraceBlockPlanes({
        cx: -0.55 + jitter(25, 0.015),
        cz: -0.02 + jitter(26, 0.015),
        hx: 0.23,
        hz: 0.33,
        yTop: 0.52 - dStep * 0.22 + jitter(27, 0.012),
        yaw: 0.08 + jitter(28, 0.03),
        tiltX: -0.07,
        tiltZ: 0.03,
        batter: [0.05, 0.10, 0.09, 0.09],
        topBevel: [0.018, 0.026, 0.024, 0.022],
        cornerBevel: [0.030, 0.030, 0.042, 0.040],
        bevelScale,
        faceIdBase: 170,
        bevelFaceIdBase: 122,
      }),
    },
    // Far-left lower projecting shale ledge (stacks crisp layered strata along left flank!)
    {
      name: 'farLeftLowerPlinth',
      faceIdBase: 176,
      planes: makeTerraceBlockPlanes({
        cx: -0.60,
        cz: 0.08,
        hx: 0.24,
        hz: 0.34,
        yTop: 0.30,
        yaw: -0.06,
        tiltX: -0.05,
        tiltZ: 0.04,
        batter: [0.06, 0.12, 0.10, 0.10],
        topBevel: [0.016, 0.024, 0.022, 0.020],
        cornerBevel: [0.028, 0.028, 0.040, 0.038],
        bevelScale,
        faceIdBase: 176,
        bevelFaceIdBase: 124,
      }),
    },
    // Front-left small angular corner anchor stone
    {
      name: 'frontLeftToeBlock',
      faceIdBase: 180,
      planes: makeTerraceBlockPlanes({
        cx: -0.45 + jitter(29, 0.015),
        cz: 0.45 + jitter(30, 0.015),
        hx: 0.20,
        hz: 0.19,
        yTop: 0.24 + jitter(31, 0.01),
        yaw: -0.25 + jitter(32, 0.04),
        tiltX: -0.06,
        tiltZ: 0.08,
        batter: [0.08, 0.11, 0.12, 0.07],
        topBevel: [0.018, 0.022, 0.024, 0.016],
        cornerBevel: [0.032, 0.026, 0.036, 0.028],
        bevelScale,
        faceIdBase: 180,
        bevelFaceIdBase: 130,
      }),
    },
    // Rear stepped mossy buttress (ensures full 360-degree sculptural silhouette from side-back!)
    {
      name: 'rearSteppedButtress',
      faceIdBase: 190,
      planes: makeTerraceBlockPlanes({
        cx: 0.15 + jitter(33, 0.015),
        cz: -0.54 + jitter(34, 0.015),
        hx: 0.38,
        hz: 0.25,
        yTop: 0.66 - dStep * 0.20 + jitter(35, 0.015),
        yaw: 0.08 + jitter(36, 0.03),
        tiltX: 0.02,
        tiltZ: -0.05,
        batter: [0.10, 0.10, 0.06, 0.11],
        topBevel: [0.024, 0.024, 0.018, 0.028],
        cornerBevel: [0.032, 0.044, 0.032, 0.046],
        bevelScale,
        faceIdBase: 190,
        bevelFaceIdBase: 146,
      }),
    },
  ]

  // 3. Subtractive sculpting cutters: exact base slice + ONLY clean through-going seams & edge-straddling chips
  //    (ZERO isolated mid-face holes or mailbox slots!)
  const cutters: { name: string; planes: HalfSpacePlane[]; faceIdBase: number }[] = [
    // Exact flat grounded base slice at y = 0 (zero Z-fighting on bottom!)
    {
      name: 'baseFlatTrim',
      faceIdBase: 15,
      planes: [{ n: { x: 0, y: 1, z: 0 }, h: 0.0, faceId: 15 }],
    },
    // Clean vertical cleavage notch aligned squarely on the mid-right cliff boundary (zero floating stub!)
    {
      name: 'rightCliffFullVerticalSeam',
      faceIdBase: 60,
      planes: buildFiniteVNotchPlanes({
        origin: { x: 0.70 - dNotch * 0.020, y: 0.36, z: -0.18 + jitter(37, 0.015) },
        across: { x: -0.06, y: 0.03, z: 1.0 },
        upOut: { x: 1.0, y: 0.05, z: 0.06 },
        throatHalf: 0.020 * (1 + dNotch * 0.28),
        angleLeftRad: 0.56,
        angleRightRad: 0.44,
        halfLenFront: 0.68,
        halfLenBack: 0.68,
        backFloorSlopeRad: 0.02,
        frontFloorSlopeRad: 0.02,
        faceIdBase: 60,
      }),
    },
    // Clean angular corner-seam notch separating front-center shelf from right-front cliff step
    {
      name: 'frontRightFullVerticalSeam',
      faceIdBase: 64,
      planes: buildFiniteVNotchPlanes({
        origin: { x: 0.39 + jitter(38, 0.015), y: 0.32, z: 0.62 - dNotch * 0.018 },
        across: { x: 0.90, y: 0.03, z: -0.43 },
        upOut: { x: 0.43, y: 0.05, z: 0.90 },
        throatHalf: 0.020 * (1 + dNotch * 0.28),
        angleLeftRad: 0.54,
        angleRightRad: 0.46,
        halfLenFront: 0.55,
        halfLenBack: 0.55,
        backFloorSlopeRad: 0.02,
        frontFloorSlopeRad: 0.02,
        faceIdBase: 64,
      }),
    },
    // True edge-straddling chiseled notch biting cleanly out of the outer front lip of mainMesaSlab!
    {
      name: 'mainMesaFrontOuterLipNotch',
      faceIdBase: 82,
      planes: buildFiniteVNotchPlanes({
        origin: { x: 0.08 + jitter(42, 0.02), y: 0.96, z: 0.33 },
        across: { x: 0.95, y: -0.10, z: 0.30 },
        upOut: { x: -0.12, y: 0.58, z: 0.81 },
        throatHalf: 0.022,
        angleLeftRad: 0.62,
        angleRightRad: 0.38,
        halfLenFront: 0.24,
        halfLenBack: 0.20,
        backFloorSlopeRad: 0.42,
        frontFloorSlopeRad: 0.30,
        faceIdBase: 82,
      }),
    },
    // True edge-straddling angular corner flake biting cleanly out of back-left pillar's outer front-left crest!
    {
      name: 'pillarOuterCornerFlake',
      faceIdBase: 86,
      planes: buildFiniteVNotchPlanes({
        origin: { x: -0.62 + jitter(43, 0.02), y: 1.07, z: -0.02 },
        across: { x: 0.55, y: -0.18, z: 0.81 },
        upOut: { x: -0.68, y: 0.54, z: 0.49 },
        throatHalf: 0.022,
        angleLeftRad: 0.56,
        angleRightRad: 0.38,
        halfLenFront: 0.22,
        halfLenBack: 0.22,
        backFloorSlopeRad: 0.42,
        frontFloorSlopeRad: 0.36,
        faceIdBase: 86,
      }),
    },
  ]

  return executePolyCsgRecipe(
    {
      id: variant === 'c1' ? 'terraced-moss-bluff-c1' : 'terraced-moss-bluff-c2',
      name: variant === 'c1'
        ? '苔藓层叠方巨岩 · 路线 C1 锐边基底 (Manifold)'
        : '苔藓层叠方巨岩 · 路线 C2 倒角层叠巨岩 (Manifold)',
      defaultCreaseDeg: variant === 'c1' ? 18 : 26,
      parentPlanes,
      unionBlocks,
      cutters,
    },
    options,
  )
}

export async function buildRouteCRock(
  preset: PolyCsgPresetId,
  params?: RouteCSculptParams,
  options?: BuildRouteCOptions,
): Promise<PolyCsgResult> {
  if (preset === 'terraced-moss-bluff-c2') {
    return buildTerracedMossBluffRouteC('c2', params, options)
  }
  if (preset === 'block-bluff-c2') {
    return buildBlockBluffRouteC('c2', params, options)
  }
  return buildSandstoneLedgeRouteC('c2', params, options)
}

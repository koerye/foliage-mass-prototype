import {
  Box3, BufferAttribute, BufferGeometry, Color, Group, Mesh, Vector3,
} from 'three'
import type { RockSpec } from './spec'

interface Vec3 { x: number; y: number; z: number }

interface PolyFace {
  normal: Vec3
  pts: Vec3[]
}

interface IndexedPoly {
  verts: number[]
  faceId: number
  isBevel: boolean
}

export interface RockBuildStats {
  stones: number
  vertices: number
  triangles: number
  ms: number
}

function mulberry32(seed: number) {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

function vAdd(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }
function vSub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function vScale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s } }
function vDot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z }
function vCross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function vLen(a: Vec3) { return Math.hypot(a.x, a.y, a.z) }
function vNorm(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z)
  return l > 1e-8 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 1, z: 0 }
}
function vDistSq(a: Vec3, b: Vec3) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

// Fast deterministic 3D value noise + fBM
function hash3(ix: number, iy: number, iz: number, seed: number) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1274126177)
  n = (n ^ (n >>> 13)) | 0
  n = Math.imul(n, 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function noise3(x: number, y: number, z: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = x - ix, fy = y - iy, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const n000 = hash3(ix, iy, iz, seed)
  const n100 = hash3(ix + 1, iy, iz, seed)
  const n010 = hash3(ix, iy + 1, iz, seed)
  const n110 = hash3(ix + 1, iy + 1, iz, seed)
  const n001 = hash3(ix, iy, iz + 1, seed)
  const n101 = hash3(ix + 1, iy, iz + 1, seed)
  const n011 = hash3(ix, iy + 1, iz + 1, seed)
  const n111 = hash3(ix + 1, iy + 1, iz + 1, seed)
  const x00 = lerp(n000, n100, ux), x10 = lerp(n010, n110, ux)
  const x01 = lerp(n001, n101, ux), x11 = lerp(n011, n111, ux)
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz)
}

function fbm3(x: number, y: number, z: number, seed: number, octaves = 3) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * (noise3(x * freq, y * freq, z * freq, seed + i * 31) * 2 - 1)
    norm += amp
    amp *= 0.5
    freq *= 2.04
  }
  return sum / (norm || 1)
}

// ---------------------------------------------------------------------------
// 1. Exact Convex Half-Space Polyhedron Clipping
// ---------------------------------------------------------------------------
function makeBoxPolyhedron(r = 1.25): PolyFace[] {
  const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
  return [
    { normal: v(1, 0, 0), pts: [v(r, -r, r), v(r, -r, -r), v(r, r, -r), v(r, r, r)] },
    { normal: v(-1, 0, 0), pts: [v(-r, -r, -r), v(-r, -r, r), v(-r, r, r), v(-r, r, -r)] },
    { normal: v(0, 1, 0), pts: [v(-r, r, r), v(r, r, r), v(r, r, -r), v(-r, r, -r)] },
    { normal: v(0, -1, 0), pts: [v(-r, -r, -r), v(r, -r, -r), v(r, -r, r), v(-r, -r, r)] },
    { normal: v(0, 0, 1), pts: [v(-r, -r, r), v(r, -r, r), v(r, r, r), v(-r, r, r)] },
    { normal: v(0, 0, -1), pts: [v(r, -r, -r), v(-r, -r, -r), v(-r, r, -r), v(r, r, -r)] },
  ]
}

function polyArea(pts: Vec3[], normal: Vec3) {
  if (pts.length < 3) return 0
  let ax = 0, ay = 0, az = 0
  const p0 = pts[0]
  for (let i = 1; i + 1 < pts.length; i++) {
    const e1 = vSub(pts[i], p0), e2 = vSub(pts[i + 1], p0)
    const c = vCross(e1, e2)
    ax += c.x; ay += c.y; az += c.z
  }
  return 0.5 * (ax * normal.x + ay * normal.y + az * normal.z)
}

function dedupRing(pts: Vec3[], epsSq = 1e-9): Vec3[] {
  const out: Vec3[] = []
  for (const p of pts) {
    if (out.length === 0 || vDistSq(out[out.length - 1], p) > epsSq) out.push(p)
  }
  while (out.length > 1 && vDistSq(out[0], out[out.length - 1]) <= epsSq) out.pop()
  return out
}

function clipPolyhedronByPlane(faces: PolyFace[], normal: Vec3, dist: number): PolyFace[] {
  const eps = 1e-6
  let minD = Infinity, maxD = -Infinity
  for (const f of faces) {
    for (const p of f.pts) {
      const d = vDot(p, normal)
      if (d < minD) minD = d
      if (d > maxD) maxD = d
    }
  }
  // No cut or would destroy the polyhedron
  if (maxD <= dist + eps) return faces
  if (minD >= dist - 0.14) return faces

  const next: PolyFace[] = []
  const cutPts: Vec3[] = []

  for (const face of faces) {
    const pts = face.pts
    const m = pts.length
    const sds = new Float64Array(m)
    let allIn = true, allOut = true
    for (let i = 0; i < m; i++) {
      const sd = vDot(pts[i], normal) - dist
      sds[i] = sd
      if (sd > eps) allIn = false
      if (sd <= eps) allOut = false
    }
    if (allOut) continue
    if (allIn) {
      next.push(face)
      continue
    }

    const clipped: Vec3[] = []
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m
      const a = pts[i], b = pts[j]
      const sa = sds[i], sb = sds[j]
      const inA = sa <= eps, inB = sb <= eps
      if (inA) clipped.push(a)
      if (inA !== inB) {
        const t = clamp(sa / (sa - sb), 0, 1)
        const q: Vec3 = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }
        clipped.push(q)
        cutPts.push(q)
      } else if (Math.abs(sa) <= eps) {
        cutPts.push(a)
      }
    }
    const clean = dedupRing(clipped)
    if (clean.length >= 3 && Math.abs(polyArea(clean, face.normal)) > 1e-6) {
      next.push({ normal: face.normal, pts: clean })
    }
  }

  // Deduplicate cap vertices and order CCW around `normal`
  const uniq: Vec3[] = []
  for (const p of cutPts) {
    let dup = false
    for (const u of uniq) {
      if (vDistSq(p, u) < 1e-8) { dup = true; break }
    }
    if (!dup) uniq.push(p)
  }

  if (uniq.length >= 3) {
    const c = uniq.reduce((acc, p) => vAdd(acc, p), { x: 0, y: 0, z: 0 })
    const center = vScale(c, 1 / uniq.length)
    const up = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    const t1 = vNorm(vCross(up, normal))
    const t2 = vNorm(vCross(normal, t1))
    uniq.sort((a, b) => {
      const da = vSub(a, center), db = vSub(b, center)
      return Math.atan2(vDot(da, t2), vDot(da, t1)) - Math.atan2(vDot(db, t2), vDot(db, t1))
    })
    if (polyArea(uniq, normal) > 1e-6) {
      next.push({ normal, pts: uniq })
    }
  }

  return next.length >= 4 ? next : faces
}

function buildRockPolyhedron(spec: RockSpec, seed: number): PolyFace[] {
  const rng = mulberry32(seed)
  let faces = makeBoxPolyhedron(2)
  const { facetCount, flatness, asymmetry, bottomFlat } = spec.shape
  const cel = spec.style === 'cel'
  const hp = spec.style === 'handpainted'

  // 1. Grounded bottom settling plane
  const botTiltX = (rng() - 0.5) * 0.14 * (1 - bottomFlat * 0.7)
  const botTiltZ = (rng() - 0.5) * 0.14 * (1 - bottomFlat * 0.7)
  const botN = vNorm({ x: botTiltX, y: -1, z: botTiltZ })
  const botD = lerp(0.84, 0.56, bottomFlat)
  faces = clipPolyhedronByPlane(faces, botN, botD)

  // 2. Crown / tilted ridge plane. Handpainted & cel lean boldly into angled hero planes.
  const topTilt = cel
    ? lerp(.99, .46, flatness)
    : hp
      ? lerp(.92, .34, flatness)
      : lerp(.36, .15, flatness)
  const topAng = rng() * Math.PI * 2
  const topN = vNorm({
    x: Math.cos(topAng) * topTilt * (0.35 + rng() * 0.65),
    y: 1,
    z: Math.sin(topAng) * topTilt * (0.35 + rng() * 0.65),
  })
  const topD = cel
    ? lerp(.81, .57, flatness)
    : hp
      ? lerp(.84, .58, flatness)
      : lerp(.92, .71, flatness)
  faces = clipPolyhedronByPlane(faces, topN, topD)

  // 3. Broad load-bearing faces, offset shoulder cuts and short heel facets.
  const chipCount = hp
    ? Math.max(0, Math.round((facetCount - 8) * .18))
    : Math.max(0, Math.round((facetCount - 8) * .25))
  const cuts = facetCount - 2 - chipCount
  const bodyCount = Math.max(4, Math.round(cuts * (hp ? .50 : .46)))
  const shoulderCount = Math.ceil((cuts - bodyCount) * (hp ? .62 : .56))
  const heelCount = cuts - bodyCount - shoulderCount
  const yaw = rng() * Math.PI * 2
  const swing = .80 + .68 * asymmetry
  const tiers = [
    { count: bodyCount, offset: 0, y: cel ? .24 : hp ? .04 : .06, variation: hp ? .42 : .66, distance: lerp(.84, .78, flatness) },
    { count: shoulderCount, offset: .42, y: hp ? .66 : .67, variation: hp ? .34 : .42, distance: lerp(.77, .88, flatness) },
    { count: heelCount, offset: .64, y: hp ? -.52 : -.60, variation: hp ? .28 : .37, distance: hp ? lerp(.86, .82, bottomFlat) : lerp(.76, .72, bottomFlat) },
  ]
  for (const tier of tiers) {
    for (let i = 0; i < tier.count; i++) {
      const step = Math.PI * 2 / tier.count
      const theta = yaw + step * (i + tier.offset + (rng() - .5) * .52 * swing)
      const y = tier.y + (rng() - .5) * tier.variation * swing
      const r = Math.sqrt(Math.max(0, 1 - y * y))
      const normal = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }
      const drift = (hp ? .13 : .08) * asymmetry * Math.sin(theta * 2 + yaw)
      const distance = tier.distance + drift + (rng() - .5) * (hp ? .32 : .28) * swing
      faces = clipPolyhedronByPlane(faces, normal, distance)
    }
  }
  // Shallow, offset corner cuts create smaller facet families among the large planes.
  for (let i = 0; i < chipCount; i++) {
    const theta = yaw + (i + rng() * .68) * Math.PI * 2 / chipCount
    const y = (i % 2 === 0 ? 1 : -1) * (.33 + rng() * .40)
    const r = Math.sqrt(1 - y * y)
    const normal = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r }
    let support = -Infinity
    for (const face of faces) for (const point of face.pts) support = Math.max(support, vDot(point, normal))
    const inset = (.085 + rng() * .095) * (.72 + spec.detail.chisel * .75)
    faces = clipPolyhedronByPlane(faces, normal, support - inset)
  }

  // Normalize polyhedron centroid & bounding radius so width/height/depth are predictable
  const allPts: Vec3[] = []
  for (const f of faces) for (const p of f.pts) allPts.push(p)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of allPts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z
  }
  const cx = 0.5 * (minX + maxX), cy = 0.5 * (minY + maxY), cz = 0.5 * (minZ + maxZ)
  const sx = Math.max(0.2, maxX - minX), sy = Math.max(0.2, maxY - minY), sz = Math.max(0.2, maxZ - minZ)
  return faces.map(f => ({
    normal: vNorm({ x: f.normal.x * sx, y: f.normal.y * sy, z: f.normal.z * sz }),
    pts: f.pts.map(p => ({ x: (p.x - cx) / sx, y: (p.y - cy) / sy, z: (p.z - cz) / sz })),
  }))
}

// ---------------------------------------------------------------------------
// 2. Watertight Topology Extraction & Doo-Sabin Bevel
// ---------------------------------------------------------------------------
function extractTopology(faces: PolyFace[], weldEps = 1.8e-3) {
  const verts: Vec3[] = []
  const epsSq = weldEps * weldEps
  const findOrAdd = (p: Vec3) => {
    for (let i = 0; i < verts.length; i++) {
      if (vDistSq(verts[i], p) <= epsSq) return i
    }
    verts.push({ ...p })
    return verts.length - 1
  }

  const faceLoops: { verts: number[]; normal: Vec3 }[] = []
  for (const f of faces) {
    const loop: number[] = []
    for (const p of f.pts) {
      const idx = findOrAdd(p)
      if (loop.length === 0 || loop[loop.length - 1] !== idx) loop.push(idx)
    }
    while (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop()
    if (loop.length >= 3) {
      const n = computeLoopNormal(verts, loop)
      if (vLen(n) > 1e-6) {
        const aligned = vDot(n, f.normal) >= 0 ? loop : [...loop].reverse()
        faceLoops.push({ verts: aligned, normal: vNorm(vDot(n, f.normal) >= 0 ? n : vScale(n, -1)) })
      }
    }
  }
  return { verts, faceLoops }
}

function computeLoopNormal(verts: Vec3[], loop: number[]): Vec3 {
  let nx = 0, ny = 0, nz = 0
  const m = loop.length
  for (let i = 0; i < m; i++) {
    const a = verts[loop[i]], b = verts[loop[(i + 1) % m]]
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return { x: nx, y: ny, z: nz }
}

function buildBeveledPolyMesh(
  rawFaces: PolyFace[],
  bevelAmount: number,
  keepCrest: boolean,
): { verts: Vec3[]; polys: IndexedPoly[]; vertEdgeInit: Float32Array } {
  const { verts, faceLoops } = extractTopology(rawFaces)
  if (bevelAmount <= 0.004 || faceLoops.length < 4) {
    return {
      verts,
      polys: faceLoops.map((f, fi) => ({ verts: f.verts, faceId: fi, isBevel: false })),
      vertEdgeInit: new Float32Array(verts.length),
    }
  }

  // Build directed half-edge map: "u:v" -> faceIndex
  const halfEdge = new Map<string, number>()
  let manifold = true
  for (let fi = 0; fi < faceLoops.length; fi++) {
    const loop = faceLoops[fi].verts
    for (let k = 0; k < loop.length; k++) {
      const u = loop[k], v = loop[(k + 1) % loop.length]
      const key = `${u}:${v}`
      if (halfEdge.has(key)) { manifold = false; break }
      halfEdge.set(key, fi)
    }
    if (!manifold) break
  }
  if (manifold) {
    for (const key of halfEdge.keys()) {
      const [u, v] = key.split(':')
      if (!halfEdge.has(`${v}:${u}`)) { manifold = false; break }
    }
  }

  if (!manifold) {
    return {
      verts,
      polys: faceLoops.map((f, fi) => ({ verts: f.verts, faceId: fi, isBevel: false })),
      vertEdgeInit: new Float32Array(verts.length),
    }
  }

  const b = clamp(bevelAmount * 1.38, 0.02, 0.44)
  const outVerts: Vec3[] = []
  const outVertEdge: number[] = []
  const polys: IndexedPoly[] = []
  const cornerIndex: Map<number, number>[] = []
  const incidentCorners = new Map<number, number[]>()

  // 1. Create inset main face loops strictly inside each convex face plane (edgeWeight = 0 at shoulders)
  for (let fi = 0; fi < faceLoops.length; fi++) {
    const loop = faceLoops[fi].verts
    const m = loop.length
    let cx = 0, cy = 0, cz = 0
    for (const vi of loop) { cx += verts[vi].x; cy += verts[vi].y; cz += verts[vi].z }
    const center: Vec3 = { x: cx / m, y: cy / m, z: cz / m }

    const map = new Map<number, number>()
    const insetLoop: number[] = []
    for (let k = 0; k < m; k++) {
      const vi = loop[k]
      const vp = verts[loop[(k - 1 + m) % m]]
      const vc = verts[vi]
      const vn = verts[loop[(k + 1) % m]]
      const midPrev = vScale(vAdd(vc, vp), 0.5)
      const midNext = vScale(vAdd(vc, vn), 0.5)
      const target: Vec3 = {
        x: 0.38 * midPrev.x + 0.38 * midNext.x + 0.24 * center.x,
        y: 0.38 * midPrev.y + 0.38 * midNext.y + 0.24 * center.y,
        z: 0.38 * midPrev.z + 0.38 * midNext.z + 0.24 * center.z,
      }
      const q: Vec3 = {
        x: lerp(vc.x, target.x, b),
        y: lerp(vc.y, target.y, b),
        z: lerp(vc.z, target.z, b),
      }
      const newIdx = outVerts.length
      outVerts.push(q)
      outVertEdge.push(0)
      map.set(vi, newIdx)
      insetLoop.push(newIdx)

      let inc = incidentCorners.get(vi)
      if (!inc) { inc = []; incidentCorners.set(vi, inc) }
      inc.push(newIdx)
    }
    cornerIndex.push(map)
    polys.push({ verts: insetLoop, faceId: fi, isBevel: false })
  }

  // Compute dihedral ridge sharpness for every original vertex (used by both cel strokes & painterly dry-brush wear).
  const vertMaxDihedral = new Float32Array(verts.length)
  for (let fi = 0; fi < faceLoops.length; fi++) {
    const loop = faceLoops[fi].verts
    for (let k = 0; k < loop.length; k++) {
      const u = loop[k], v = loop[(k + 1) % loop.length]
      const fj = halfEdge.get(`${v}:${u}`)
      if (fj === undefined || fj === fi) continue
      const cosAng = clamp(vDot(faceLoops[fi].normal, faceLoops[fj].normal), -1, 1)
      const ew = smoothstep(0.08, 0.56, 1 - cosAng)
      if (ew > vertMaxDihedral[u]) vertMaxDihedral[u] = ew
      if (ew > vertMaxDihedral[v]) vertMaxDihedral[v] = ew
    }
  }

  const crestIndex = new Int32Array(verts.length).fill(-1)
  for (const [vi, qIds] of incidentCorners.entries()) {
    let ax = 0, ay = 0, az = 0
    for (const qi of qIds) { ax += outVerts[qi].x; ay += outVerts[qi].y; az += outVerts[qi].z }
    const avgQ: Vec3 = { x: ax / qIds.length, y: ay / qIds.length, z: az / qIds.length }
    if (keepCrest) {
      const crown = vAdd(avgQ, vScale(vSub(verts[vi], avgQ), .62))
      crestIndex[vi] = outVerts.length
      outVerts.push(crown)
      outVertEdge.push(vertMaxDihedral[vi])
    } else {
      // Tag painterly bevel shoulders gently by local dihedral angle so crisp ridges catch dry-brush highlights
      for (const qi of qIds) outVertEdge[qi] = Math.max(outVertEdge[qi], vertMaxDihedral[vi] * 0.86)
      const n = vNorm(vSub(verts[vi], avgQ))
      const ref = Math.abs(n.y) < .9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
      const x = vNorm(vCross(ref, n)), y = vCross(n, x)
      const angle = (i: number) => {
        const p = vSub(outVerts[i], avgQ)
        return Math.atan2(vDot(p, y), vDot(p, x))
      }
      const loop = [...qIds].sort((a, b) => angle(a) - angle(b))
      polys.push({ verts: loop, faceId: -1, isBevel: true })
    }
  }

  // Connect inset face edges to one another.
  const edgeDone = new Set<string>()
  for (let fi = 0; fi < faceLoops.length; fi++) {
    const loop = faceLoops[fi].verts
    for (let k = 0; k < loop.length; k++) {
      const u = loop[k], v = loop[(k + 1) % loop.length]
      const eKey = u < v ? `${u}:${v}` : `${v}:${u}`
      if (edgeDone.has(eKey)) continue
      edgeDone.add(eKey)

      const fj = halfEdge.get(`${v}:${u}`)
      if (fj === undefined || fj === fi) continue

      const qAu = cornerIndex[fi].get(u)!
      const qAv = cornerIndex[fi].get(v)!
      const qBu = cornerIndex[fj].get(u)!
      const qBv = cornerIndex[fj].get(v)!
      const nAvg = vNorm(vAdd(faceLoops[fi].normal, faceLoops[fj].normal))
      if (!keepCrest) {
        const loop = [qAu, qBu, qBv, qAv]
        if (vDot(computeLoopNormal(outVerts, loop), nAvg) < 0) loop.reverse()
        polys.push({ verts: loop, faceId: -1, isBevel: true })
        continue
      }
      const cU = crestIndex[u]
      const cV = crestIndex[v]
      let quadA = [qAu, cU, cV, qAv]
      if (vDot(computeLoopNormal(outVerts, quadA), nAvg) < 0) quadA = quadA.reverse()
      polys.push({ verts: quadA, faceId: fi, isBevel: true })

      let quadB = [cU, qBu, qBv, cV]
      if (vDot(computeLoopNormal(outVerts, quadB), nAvg) < 0) quadB = quadB.reverse()
      polys.push({ verts: quadB, faceId: fj, isBevel: true })
    }
  }

  return { verts: outVerts, polys, vertEdgeInit: Float32Array.from(outVertEdge) }
}

// ---------------------------------------------------------------------------
// 3. Clean Triangulation + Edge-Preserving Midpoint Subdivision
// ---------------------------------------------------------------------------
interface Tri {
  a: number
  b: number
  c: number
  faceId: number
  isBevel: boolean
}

function triangulateAndSubdivide(
  vertsIn: Vec3[],
  polys: IndexedPoly[],
  vertEdgeInit: Float32Array,
  subdivisions: 0 | 1 | 2,
  seed: number,
) {
  const verts = vertsIn.map(v => ({ ...v }))
  const edgeList = Array.from(vertEdgeInit)
  const faceTone = (face: number) => face < 0 ? 0 : hash3(face, seed & 0xffff, 17, seed) * 2 - 1
  const tone = verts.map(() => 0)
  const incidentFaces = new Uint8Array(verts.length)
  for (const poly of polys) {
    if (poly.isBevel) continue
    const tint = faceTone(poly.faceId)
    for (const i of poly.verts) {
      tone[i] += tint
      incidentFaces[i]++
    }
  }
  for (let i = 0; i < tone.length; i++) tone[i] /= Math.max(1, incidentFaces[i])

  let tris: Tri[] = []
  for (const p of polys) {
    const loop = p.verts
    const m = loop.length
    if (m < 3) continue
    const surface = { faceId: p.faceId, isBevel: p.isBevel }

    if (m === 3) {
      tris.push({ ...surface, a: loop[0], b: loop[1], c: loop[2] })
    } else if (m === 4) {
      const d02 = vDistSq(verts[loop[0]], verts[loop[2]])
      const d13 = vDistSq(verts[loop[1]], verts[loop[3]])
      if (d02 <= d13) {
        tris.push({ ...surface, a: loop[0], b: loop[1], c: loop[2] })
        tris.push({ ...surface, a: loop[0], b: loop[2], c: loop[3] })
      } else {
        tris.push({ ...surface, a: loop[1], b: loop[2], c: loop[3] })
        tris.push({ ...surface, a: loop[1], b: loop[3], c: loop[0] })
      }
    } else {
      let cx = 0, cy = 0, cz = 0
      for (const vi of loop) { cx += verts[vi].x; cy += verts[vi].y; cz += verts[vi].z }
      const cIdx = verts.length
      verts.push({ x: cx / m, y: cy / m, z: cz / m })
      edgeList.push(0)
      tone.push(loop.reduce((sum, i) => sum + tone[i], 0) / m)
      for (let k = 0; k < m; k++) {
        tris.push({
          a: cIdx,
          b: loop[k],
          c: loop[(k + 1) % m],
          ...surface,
        })
      }
    }
  }

  let vertEdge = Float32Array.from(edgeList)

  // Exact watertight midpoint subdivision
  for (let pass = 0; pass < subdivisions; pass++) {
    const midCache = new Map<string, number>()
    const nextEdge: number[] = Array.from(vertEdge)
    const getMid = (u: number, v: number) => {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`
      const hit = midCache.get(key)
      if (hit !== undefined) return hit
      const p = vScale(vAdd(verts[u], verts[v]), 0.5)
      const idx = verts.length
      verts.push(p)
      nextEdge.push(0.5 * (nextEdge[u] + nextEdge[v]))
      tone.push((tone[u] + tone[v]) * .5)
      midCache.set(key, idx)
      return idx
    }

    const nextTris: Tri[] = []
    for (const t of tris) {
      const ab = getMid(t.a, t.b)
      const bc = getMid(t.b, t.c)
      const ca = getMid(t.c, t.a)
      nextTris.push(
        { ...t, b: ab, c: ca },
        { ...t, a: ab, c: bc },
        { ...t, a: ca, b: bc },
        { ...t, a: ab, b: bc, c: ca },
      )
    }
    tris = nextTris
    vertEdge = Float32Array.from(nextEdge)
  }

  return { verts, tris, vertEdge, tone, faceTone }
}

// ---------------------------------------------------------------------------
// 4. Organic Warp, Secondary Chisel Scoops, Cracks & Vertex Metric Bake
// ---------------------------------------------------------------------------
interface BlockTransform {
  offset: Vec3
  rotX: number
  rotY: number
  rotZ: number
  scaleX: number
  scaleY: number
  scaleZ: number
  isPebble?: boolean
}

interface HullPlane {
  normal: Vec3
  dist: number
}

interface BuiltStoneBlock {
  verts: Vec3[]
  tris: Tri[]
  smoothN: Vec3[]
  faceNormals: Vec3[]
  bevelVertices: Uint8Array
  vertEdge: Float32Array
  tone: number[]
  faceTone: (face: number) => number
  cavityAttr: Float32Array
  extraEdgeAttr: Float32Array
  geomConvex: Float32Array
  geomConcave: Float32Array
  paintField: Float32Array
  depositField: Float32Array
  wearField: Float32Array
  hullPlanes: HullPlane[]
  finalH: number
  isPebble: boolean
}

function rotVecEuler(v: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let { x, y, z } = v
  if (rz) {
    const c = Math.cos(rz), s = Math.sin(rz)
    const nx = x * c - y * s, ny = x * s + y * c
    x = nx; y = ny
  }
  if (rx) {
    const c = Math.cos(rx), s = Math.sin(rx)
    const ny = y * c - z * s, nz = y * s + z * c
    y = ny; z = nz
  }
  if (ry) {
    const c = Math.cos(ry), s = Math.sin(ry)
    const nx = x * c + z * s, nz = -x * s + z * c
    x = nx; z = nz
  }
  return { x, y, z }
}

function buildStoneBlock(
  spec: RockSpec,
  seed: number,
  scaleMul = 1,
  xform?: BlockTransform,
): BuiltStoneBlock {
  const rng = mulberry32(seed)
  const cel = spec.style === 'cel'
  const hp = spec.style === 'handpainted'
  const keepCrest = cel || hp
  const rawFaces = buildRockPolyhedron(spec, seed)
  const { verts: bVerts, polys, vertEdgeInit } = buildBeveledPolyMesh(rawFaces, spec.shape.bevel, keepCrest)
  const { verts, tris, vertEdge, tone, faceTone } = triangulateAndSubdivide(bVerts, polys, vertEdgeInit, spec.detail.subdivisions, seed)

  const nVerts = verts.length
  const { width, height, depth, asymmetry, taperTop, bottomFlat } = spec.shape
  const { chisel, undulation, cracks, sharpness } = spec.detail
  const sxMul = (xform?.scaleX ?? 1) * scaleMul
  const syMul = (xform?.scaleY ?? 1) * scaleMul
  const szMul = (xform?.scaleZ ?? 1) * scaleMul
  const effW = width * sxMul
  const effH = height * syMul
  const effD = depth * szMul

  // Deterministic macro organic skew / lean
  const leanX = (rng() - 0.5) * (hp ? 0.42 : 0.34) * asymmetry
  const leanZ = (rng() - 0.5) * (hp ? 0.38 : 0.34) * asymmetry
  const twistY = (rng() - 0.5) * (hp ? 0.32 : 0.42) * asymmetry

  // Secondary planar-faceted chisel scoops on the upper/side hull
  const chiselCount = chisel > 0.01 ? (hp ? 8 : 14) : 0
  const chiselSites: { dir: Vec3; radius: number; depth: number }[] = []
  for (let i = 0; i < chiselCount; i++) {
    const phi = rng() * Math.PI * 2
    const y = -0.1 + rng() * 0.98
    const r = Math.sqrt(Math.max(0.05, 1 - clamp(y, -0.95, 0.95) ** 2))
    chiselSites.push({
      dir: vNorm({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r }),
      radius: 0.28 + rng() * 0.22,
      depth: (0.022 + rng() * 0.032) * chisel * (hp ? 0.65 : 1.0),
    })
  }

  const cavityAttr = new Float32Array(nVerts)
  const extraEdgeAttr = new Float32Array(nVerts)
  const crackDirA = vNorm({ x: rng() - 0.5, y: 0.7 + rng() * 0.5, z: rng() - 0.5 })
  const crackDirB = vNorm({ x: rng() - 0.5, y: 0.35 + rng() * 0.4, z: rng() - 0.5 })
  const minDim = Math.min(effW, effH, effD)

  // Apply proportion scale + macro warp + secondary chisel + undulation + cracks
  for (let i = 0; i < nVerts; i++) {
    const p = verts[i]
    const dir = vNorm(p)
    const yNorm = clamp(p.y + 0.5, 0, 1) // approx 0 (bottom) .. 1 (top)

    const bx = p.x
    const by = p.y
    const bz = p.z

    // Taper & organic lean + slight twist. For dramatic crag spires (taperTop > 0.50),
    // smoothly pinch toward a chunky rocky arrowhead peak while keeping a safe floor (>= 0.18).
    const taper = taperTop > 0.50
      ? Math.max(0.18, 1 - taperTop * (yNorm - 0.16) * (0.86 + (taperTop - 0.50) * 0.65 * yNorm))
      : 1 - taperTop * (yNorm - 0.35)
    const tw = twistY * (yNorm - 0.5)
    const cT = Math.cos(tw), sT = Math.sin(tw)
    let px = (bx * cT - bz * sT) * taper + leanX * (yNorm * yNorm)
    let pz = (bx * sT + bz * cT) * taper + leanZ * (yNorm * yNorm)
    let py = by

    // Scale to target rock dimensions
    px *= effW
    py *= effH
    pz *= effD

    // Secondary shallow concave chisel facets
    let cav = 0
    let rim = 0
    if (chiselSites.length > 0) {
      let radialDisp = 0
      for (const s of chiselSites) {
        const angDist = Math.acos(clamp(vDot(dir, s.dir), -1, 1))
        if (angDist < s.radius) {
          const u = angDist / s.radius
          const bowl = (1 - u * u) * (1 - u * u)
          radialDisp -= s.depth * bowl * minDim
          cav = Math.max(cav, bowl * 0.65 * chisel)
          const rimBand = Math.exp(-(((u - 0.88) / 0.11) ** 2))
          rim = Math.max(rim, rimBand * 0.82 * chisel)
        }
      }
      px += dir.x * radialDisp
      py += dir.y * radialDisp
      pz += dir.z * radialDisp
    }

    // Broad painterly hand-sculpted undulation (calmer in handpainted mode so broad planes stay crisp)
    if (undulation > 0.005) {
      const f = 1.65
      const uVal = fbm3(p.x * f * 2.5 + 3.1, p.y * f * 2.0 + 7.4, p.z * f * 2.5 - 2.3, seed + 101, 3)
      const amp = undulation * (hp ? 0.14 : 0.27) * minDim
      px += dir.x * uVal * amp
      py += dir.y * uVal * amp * 0.85
      pz += dir.z * uVal * amp
      if (uVal < -0.15) cav = Math.max(cav, (-uVal - 0.15) * 0.65 * undulation)
    }

    // Subtle sedimentary strata / fracture lines (handpainted uses per-pixel Voronoi cracks, so keep vertex grooves ultra-gentle)
    if (cracks > 0.005) {
      const ca = vDot({ x: px, y: py, z: pz }, crackDirA) * 2.1
      const cb = vDot({ x: px, y: py, z: pz }, crackDirB) * 2.5
      const nA = fbm3(px * 1.4, py * 1.4, pz * 1.4, seed + 211, 2) * 0.55
      const lineA = Math.abs(Math.sin(ca + nA * 2.4))
      const lineB = Math.abs(Math.sin(cb - nA * 1.9))
      const groove = Math.max(smoothstep(0.14, 0.0, lineA), smoothstep(0.12, 0.0, lineB) * 0.75)
      const depthAmp = cracks * (hp ? 0.011 : 0.048) * minDim
      px -= dir.x * groove * depthAmp
      py -= dir.y * groove * depthAmp
      pz -= dir.z * groove * depthAmp
      cav = Math.max(cav, groove * (hp ? 0.28 : 0.9) * cracks)
    }

    if (xform && (xform.rotX || xform.rotY || xform.rotZ)) {
      const r = rotVecEuler({ x: px, y: py, z: pz }, xform.rotX, xform.rotY, xform.rotZ)
      px = r.x; py = r.y; pz = r.z
    }

    p.x = px
    p.y = py
    p.z = pz
    cavityAttr[i] = clamp(cav, 0, 1)
    extraEdgeAttr[i] = clamp(rim, 0, 1)
  }

  // Soft bottom settling + exact grounding (minY = 0) & XZ centering (+ optional block offset)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of verts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z
  }
  const rockH = Math.max(0.1, maxY - minY)
  const cx = 0.5 * (minX + maxX), cz = 0.5 * (minZ + maxZ)
  const settleBand = bottomFlat * 0.09 * rockH
  const ox = xform?.offset.x ?? 0
  const oy = xform?.offset.y ?? 0
  const oz = xform?.offset.z ?? 0
  for (const p of verts) {
    p.x = p.x - cx + ox
    p.z = p.z - cz + oz
    let y = p.y - minY
    if (settleBand > 1e-4 && y < settleBand) {
      y *= 1 - bottomFlat * .65 * (1 - smoothstep(0, settleBand, y))
    }
    p.y = Math.max(0, y) + oy
  }
  // Re-normalize exact minY = oy after settle
  let newMinY = Infinity, newMaxY = -Infinity
  for (const p of verts) {
    if (p.y < newMinY) newMinY = p.y
    if (p.y > newMaxY) newMaxY = p.y
  }
  const yShift = newMinY - Math.max(0, oy)
  for (const p of verts) p.y -= yShift
  const finalH = Math.max(0.05, newMaxY - newMinY)

  // Weighted Face Normals (AAA stylized rock bevel shading):
  // Main flat faces carry higher normal weight (scaled by `sharpness`) than narrow chamfer bevels,
  // keeping large planar faces crisp even at subdivisions = 0 while staying 100% shared & continuous across bevels!
  const smoothN: Vec3[] = Array.from({ length: nVerts }, () => ({ x: 0, y: 0, z: 0 }))
  const faceNormals: Vec3[] = rawFaces.map(() => ({ x: 0, y: 0, z: 0 }))
  const faceCenters: Vec3[] = rawFaces.map(() => ({ x: 0, y: 0, z: 0 }))
  const faceCounts = new Uint32Array(rawFaces.length)
  const bevelVertices = new Uint8Array(nVerts)
  const mainPlaneWeight = cel ? 1.0 : hp ? lerp(1.0, 12.0, sharpness * sharpness) : lerp(1.0, 9.5, sharpness * sharpness)
  for (const t of tris) {
    const pa = verts[t.a], pb = verts[t.b], pc = verts[t.c]
    const cross = vCross(vSub(pb, pa), vSub(pc, pa))
    if (t.isBevel) {
      bevelVertices[t.a] = bevelVertices[t.b] = bevelVertices[t.c] = 1
      smoothN[t.a] = vAdd(smoothN[t.a], cross)
      smoothN[t.b] = vAdd(smoothN[t.b], cross)
      smoothN[t.c] = vAdd(smoothN[t.c], cross)
    } else {
      faceNormals[t.faceId] = vAdd(faceNormals[t.faceId], cross)
      faceCenters[t.faceId].x += pa.x + pb.x + pc.x
      faceCenters[t.faceId].y += pa.y + pb.y + pc.y
      faceCenters[t.faceId].z += pa.z + pb.z + pc.z
      faceCounts[t.faceId] += 3
      const wCross = vScale(cross, mainPlaneWeight)
      smoothN[t.a] = vAdd(smoothN[t.a], wCross)
      smoothN[t.b] = vAdd(smoothN[t.b], wCross)
      smoothN[t.c] = vAdd(smoothN[t.c], wCross)
    }
  }
  for (let i = 0; i < nVerts; i++) smoothN[i] = vNorm(smoothN[i])
  const hullPlanes: HullPlane[] = []
  for (let i = 0; i < faceNormals.length; i++) {
    faceNormals[i] = vNorm(faceNormals[i])
    if (faceCounts[i] > 0) {
      const c = vScale(faceCenters[i], 1 / faceCounts[i])
      hullPlanes.push({ normal: faceNormals[i], dist: vDot(c, faceNormals[i]) })
    }
  }

  // Compute geometric convexity/concavity from 1-ring neighbors (captures subdivided & chiseled ridges!)
  const neighborPos: Vec3[] = Array.from({ length: nVerts }, () => ({ x: 0, y: 0, z: 0 }))
  const neighborCnt = new Uint16Array(nVerts)
  for (const t of tris) {
    const pairs: [number, number][] = [[t.a, t.b], [t.b, t.c], [t.c, t.a]]
    for (const [u, v] of pairs) {
      neighborPos[u] = vAdd(neighborPos[u], verts[v])
      neighborCnt[u]++
      neighborPos[v] = vAdd(neighborPos[v], verts[u])
      neighborCnt[v]++
    }
  }
  const geomConvex = new Float32Array(nVerts)
  const geomConcave = new Float32Array(nVerts)
  const paintField = new Float32Array(nVerts)
  const depositField = new Float32Array(nVerts)
  const wearField = new Float32Array(nVerts)
  const avgScale = Math.max(0.12, (effW + effH + effD) / 3)
  for (let i = 0; i < nVerts; i++) {
    if (neighborCnt[i] === 0) continue
    const avg = vScale(neighborPos[i], 1 / neighborCnt[i])
    const lap = vSub(verts[i], avg)
    const signedCurv = vDot(lap, smoothN[i]) / avgScale
    geomConvex[i] = smoothstep(0.008, 0.065, signedCurv)
    geomConcave[i] = smoothstep(0.006, 0.048, -signedCurv)
    const p = verts[i]
    const x = p.x / avgScale, y = p.y / avgScale, z = p.z / avgScale
    paintField[i] = fbm3(x * 2.5, y * 2.7, z * 2.5, seed + 809, 2)
    const patch = fbm3(x * 3.1, y * 1.4, z * 3.1, seed + 503, 2)
    depositField[i] = smoothstep(.24, .97, p.y / finalH) * .67 + Math.max(0, smoothN[i].y) * .28 + patch * .43
    wearField[i] = noise3(x * 4.6, y * 4.6, z * 4.6, seed + 947)
  }

  return {
    verts,
    tris,
    smoothN,
    faceNormals,
    bevelVertices,
    vertEdge,
    tone,
    faceTone,
    cavityAttr,
    extraEdgeAttr,
    geomConvex,
    geomConcave,
    paintField,
    depositField,
    wearField,
    hullPlanes,
    finalH,
    isPebble: Boolean(xform?.isPebble),
  }
}

function convexHullSignedDist(p: Vec3, planes: HullPlane[]): number {
  let maxD = -Infinity
  for (let i = 0; i < planes.length; i++) {
    const pl = planes[i]
    const d = p.x * pl.normal.x + p.y * pl.normal.y + p.z * pl.normal.z - pl.dist
    if (d > maxD) maxD = d
  }
  return maxD
}

function packStoneBlocksToGeometry(blocks: BuiltStoneBlock[], spec: RockSpec, scaleMul: number): BufferGeometry {
  const cel = spec.style === 'cel'
  const hp = spec.style === 'handpainted'
  const { sharpness } = spec.detail

  let totalTris = 0
  for (const b of blocks) totalTris += b.tris.length

  const vCount = totalTris * 3
  const positions = new Float32Array(vCount * 3)
  const normals = new Float32Array(vCount * 3)
  const uvs = new Float32Array(vCount * 2)
  const colors = new Float32Array(vCount * 3)
  const rockData = new Float32Array(vCount * 4)

  const colBase = new Color(spec.shading.baseColor)
  const colShadow = new Color(spec.shading.shadowColor)
  const colEdge = new Color(spec.shading.edgeColor)
  const colTop = new Color(spec.top.color)
  const tmpColor = new Color()

  const uvScale = 0.65 / Math.max(0.3, scaleMul)
  const capThreshold = lerp(1.33, .55, spec.top.coverage)
  const capSoftness = lerp(.045, .26, spec.top.softness)

  let outTriOffset = 0
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    const {
      verts, tris, smoothN, faceNormals, bevelVertices, vertEdge,
      tone, faceTone, cavityAttr, extraEdgeAttr, geomConvex, geomConcave,
      paintField, depositField, wearField, finalH,
    } = b

    for (let ti = 0; ti < tris.length; ti++) {
      const t = tris[ti]
      const fN = t.isBevel ? undefined : faceNormals[t.faceId]
      const flatTone = faceTone(t.faceId)
      const corners = [t.a, t.b, t.c]

      for (let ci = 0; ci < 3; ci++) {
        const vi = corners[ci]
        const p = verts[vi]
        const sN = smoothN[vi]
        const outIdx = (outTriOffset + ti) * 3 + ci
        const facetTone = (cel || hp) ? flatTone : tone[vi]

        // Ridge-crest edge weight: cel & handpainted confine strictly to crowned bevel crests & Y-corners;
        // painterly combines dihedral chamfer ridge + geometric convexity
        const finalEdge = cel
          ? vertEdge[vi]
          : hp
            ? clamp(Math.max(vertEdge[vi], extraEdgeAttr[vi] * 0.55), 0, 1)
            : clamp(Math.max(extraEdgeAttr[vi], geomConvex[vi] * 0.94, vertEdge[vi] * (bevelVertices[vi] ? 0.88 : 0.0)), 0, 1)

        // Blend normal: interior main-face vertices sharpen toward plane normal while bevel boundaries stay continuous
        const normalBlend = (cel || hp || !bevelVertices[vi]) ? sharpness * (cel ? .96 : hp ? .97 : .72) : 0
        const n = fN && normalBlend > 0 ? vNorm(vAdd(vScale(sN, 1 - normalBlend), vScale(fN, normalBlend))) : sN

        positions[outIdx * 3] = p.x
        positions[outIdx * 3 + 1] = p.y
        positions[outIdx * 3 + 2] = p.z

        normals[outIdx * 3] = n.x
        normals[outIdx * 3 + 1] = n.y
        normals[outIdx * 3 + 2] = n.z

        // Box-projected triplanar UV for seamless GLB / texture compatibility
        const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z)
        if (ay >= ax && ay >= az) {
          uvs[outIdx * 2] = p.x * uvScale
          uvs[outIdx * 2 + 1] = p.z * uvScale
        } else if (ax >= az) {
          uvs[outIdx * 2] = p.z * uvScale
          uvs[outIdx * 2 + 1] = p.y * uvScale
        } else {
          uvs[outIdx * 2] = p.x * uvScale
          uvs[outIdx * 2 + 1] = p.y * uvScale
        }

        // Cavity AO + ground contact grounding shadow + underside shadow (includes inter-slab crevice seam AO!)
        const groundOcc = smoothstep(finalH * (hp ? 0.24 : 0.30), 0.0, p.y) * (hp ? .46 : .53)
        const undersideOcc = smoothstep(0.18, -0.68, sN.y) * .60
        const finalCavity = clamp(
          Math.max(cavityAttr[vi], geomConcave[vi] * .60, groundOcc) + undersideOcc * .45,
          0,
          1,
        )

        // Store a continuous deposit field for both the live shader and baked GLB colors.
        const capField = depositField[vi]
        const topMask = spec.top.mode !== 'none' && spec.top.coverage > .005
          ? smoothstep(capThreshold - capSoftness, capThreshold + capSoftness, capField)
          : 0

        // Bake the palette, mask and edge wear into the GLB's linear vertex colors.
        tmpColor.copy(colBase)
        const planeShift = 1 + facetTone * spec.shading.facetVariation * (hp ? .26 : .22)
        const grainN = paintField[vi] * spec.shading.grain * (hp ? .12 : .22)
        tmpColor.multiplyScalar(clamp(planeShift + grainN, 0.62, 1.32))

        // Shadow undertone in cavities, slab crevices & underside
        const aoBlend = finalCavity * spec.shading.cavityAO * .82
        tmpColor.lerp(colShadow, aoBlend)

        // Top cap (sand / moss / snow)
        if (topMask > 0.001) {
          tmpColor.lerp(colTop, topMask * (cel ? .83 : .76))
        }

        // Sunlit/dry-brush convex edge wear highlight
        const sharpCrest = smoothstep(cel ? .60 : hp ? .44 : .34, cel ? .94 : hp ? .84 : .90, finalEdge)
        const sunRidgeBias = cel
          ? 1.0
          : smoothstep(-0.35, 0.45, sN.y * 0.65 + 0.35) * (1 - finalCavity * 0.5)
        const capAtten = 1 - topMask * .52
        const wear = lerp(1, smoothstep(.20, .68, wearField[vi]), spec.shading.edgeBreakup)
        const edgeFactor = sharpCrest * sunRidgeBias * wear * capAtten * spec.shading.edgeWear * (cel ? .78 : hp ? .74 : .62)
        tmpColor.lerp(colEdge, clamp(edgeFactor, 0, 0.85))

        colors[outIdx * 3] = clamp(tmpColor.r, 0, 1)
        colors[outIdx * 3 + 1] = clamp(tmpColor.g, 0, 1)
        colors[outIdx * 3 + 2] = clamp(tmpColor.b, 0, 1)

        rockData[outIdx * 4] = finalEdge
        rockData[outIdx * 4 + 1] = finalCavity
        rockData[outIdx * 4 + 2] = capField
        rockData[outIdx * 4 + 3] = facetTone * 0.5 + 0.5
      }
    }
    outTriOffset += tris.length
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('normal', new BufferAttribute(normals, 3))
  geo.setAttribute('uv', new BufferAttribute(uvs, 2))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setAttribute('rockData', new BufferAttribute(rockData, 4))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return geo
}

function buildSingleStoneGeometry(spec: RockSpec, seed: number, scaleMul = 1, includePebbles = true): BufferGeometry {
  const slabs = clamp(Math.round(spec.shape.slabs ?? 1), 1, 3)
  const pebbles = includePebbles ? clamp(Math.round(spec.cluster.pebbles ?? 0), 0, 6) : 0

  // Fast legacy path: single block, zero extra allocations or merging overhead
  if (slabs <= 1 && pebbles <= 0) {
    const hero = buildStoneBlock(spec, seed, scaleMul)
    return packStoneBlocksToGeometry([hero], spec, scaleMul)
  }

  const rng = mulberry32(seed + 4409)
  const { width, height, depth } = spec.shape
  const isSpire = height > width * 1.35
  const isLowRidge = width > height * 1.45
  const blocks: BuiltStoneBlock[] = []

  // 1. Hero main slab (with slight coherent dip tilt when paired with interlocking slabs)
  const dipDir = rng() < 0.5 ? 1 : -1
  const heroTiltZ = slabs > 1 ? (isSpire ? dipDir * 0.045 : dipDir * 0.065) : 0
  const heroBlock = buildStoneBlock(spec, seed, scaleMul, slabs > 1 ? {
    offset: { x: slabs === 2 ? -0.10 * width * scaleMul : 0, y: 0, z: slabs === 2 ? 0.04 * depth * scaleMul : 0 },
    rotX: (rng() - 0.5) * 0.06,
    rotY: 0,
    rotZ: heroTiltZ,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  } : undefined)
  blocks.push(heroBlock)

  // 2. Interlocking secondary rock slabs creating authentic concave V-clefts, stepped shoulders & strata
  if (slabs >= 2) {
    if (isSpire) {
      // Flanking sturdy shoulder spire beside the tall crag peak (matches Row 3 Col 1)
      const sideSpec: RockSpec = {
        ...spec,
        shape: { ...spec.shape, facetCount: Math.max(8, spec.shape.facetCount - 1), taperTop: Math.min(0.76, spec.shape.taperTop + 0.04) },
      }
      blocks.push(buildStoneBlock(sideSpec, seed + 313, scaleMul, {
        offset: { x: 0.24 * width * scaleMul, y: 0, z: (rng() - 0.35) * 0.18 * depth * scaleMul },
        rotX: (rng() - 0.5) * 0.10,
        rotY: 0.58 + (rng() - 0.5) * 0.35,
        rotZ: -dipDir * (0.11 + rng() * 0.05),
        scaleX: 0.68,
        scaleY: 0.58 + rng() * 0.08,
        scaleZ: 0.72,
      }))
      if (slabs >= 3) {
        blocks.push(buildStoneBlock(sideSpec, seed + 627, scaleMul, {
          offset: { x: -0.23 * width * scaleMul, y: 0, z: -0.10 * depth * scaleMul },
          rotX: (rng() - 0.5) * 0.10,
          rotY: -0.72 + (rng() - 0.5) * 0.30,
          rotZ: dipDir * (0.12 + rng() * 0.05),
          scaleX: 0.60,
          scaleY: 0.46 + rng() * 0.08,
          scaleZ: 0.66,
        }))
      }
    } else if (slabs === 2) {
      // Twin deeply fused slanted slabs with a crisp diagonal V-cleft between them (matches Row 1 Col 2)
      blocks.push(buildStoneBlock(spec, seed + 313, scaleMul, {
        offset: { x: 0.24 * width * scaleMul, y: 0, z: -0.09 * depth * scaleMul },
        rotX: (rng() - 0.5) * 0.08,
        rotY: 0.44 + (rng() - 0.5) * 0.30,
        rotZ: -heroTiltZ * 0.90 + (rng() - 0.5) * 0.04,
        scaleX: 0.84,
        scaleY: 0.82 + rng() * 0.06,
        scaleZ: 0.88,
      }))
    } else if (isLowRidge) {
      // Low layered shale strata ridge: fused overlapping front-left plate + stepped rear-right ridge (matches Row 2 Col 3)
      blocks.push(buildStoneBlock(spec, seed + 313, scaleMul, {
        offset: { x: -0.20 * width * scaleMul, y: 0, z: 0.11 * depth * scaleMul },
        rotX: 0.05,
        rotY: 0.26 + (rng() - 0.5) * 0.18,
        rotZ: dipDir * 0.09,
        scaleX: 0.76,
        scaleY: 0.74 + rng() * 0.06,
        scaleZ: 0.82,
      }))
      blocks.push(buildStoneBlock(spec, seed + 627, scaleMul, {
        offset: { x: 0.19 * width * scaleMul, y: 0, z: -0.09 * depth * scaleMul },
        rotX: -0.04,
        rotY: -0.34 + (rng() - 0.5) * 0.18,
        rotZ: -dipDir * 0.08,
        scaleX: 0.74,
        scaleY: 0.72 + rng() * 0.06,
        scaleZ: 0.80,
      }))
    } else {
      // Stepped blocky cliff bluff: central block + tight stepped left shoulder + right buttress (matches Row 1 Col 3 / Row 2 Col 2)
      blocks.push(buildStoneBlock(spec, seed + 313, scaleMul, {
        offset: { x: -0.23 * width * scaleMul, y: 0, z: 0.11 * depth * scaleMul },
        rotX: 0.03,
        rotY: 0.38 + (rng() - 0.5) * 0.25,
        rotZ: dipDir * 0.05,
        scaleX: 0.74,
        scaleY: 0.70 + rng() * 0.06,
        scaleZ: 0.78,
      }))
      blocks.push(buildStoneBlock(spec, seed + 627, scaleMul, {
        offset: { x: 0.23 * width * scaleMul, y: 0, z: -0.09 * depth * scaleMul },
        rotX: -0.03,
        rotY: -0.44 + (rng() - 0.5) * 0.25,
        rotZ: -dipDir * 0.05,
        scaleX: 0.70,
        scaleY: 0.80 + rng() * 0.06,
        scaleZ: 0.76,
      }))
    }
  }

  // Compute main rock XZ footprint before placing grounded talus pebbles around its foot
  let mainMinX = Infinity, mainMaxX = -Infinity, mainMinZ = Infinity, mainMaxZ = -Infinity
  for (const b of blocks) {
    for (const p of b.verts) {
      if (p.x < mainMinX) mainMinX = p.x; if (p.x > mainMaxX) mainMaxX = p.x
      if (p.z < mainMinZ) mainMinZ = p.z; if (p.z > mainMaxZ) mainMaxZ = p.z
    }
  }
  const footCenterX = 0.5 * (mainMinX + mainMaxX)
  const footCenterZ = 0.5 * (mainMinZ + mainMaxZ)
  const footRx = Math.max(0.25, 0.5 * (mainMaxX - mainMinX))
  const footRz = Math.max(0.25, 0.5 * (mainMaxZ - mainMinZ))
  const baseSpan = Math.max(0.45, Math.min(width, depth) * scaleMul)

  // 3. Grounded angular talus rubble pebbles nestled along the hero rock foot
  if (pebbles > 0) {
    const pebbleSpec: RockSpec = {
      ...spec,
      shape: {
        ...spec.shape,
        width: 1,
        height: 1,
        depth: 1,
        facetCount: 8,
        flatness: 0.66,
        bevel: clamp(spec.shape.bevel * 1.15, 0.06, 0.13),
        asymmetry: 0.64,
        taperTop: 0.32,
        bottomFlat: 0.94,
        slabs: 1,
      },
      detail: {
        ...spec.detail,
        subdivisions: 0,
        chisel: 0,
        undulation: 0.05,
        cracks: 0,
        sharpness: Math.max(0.88, spec.detail.sharpness),
      },
    }
    // Natural tight front-left & foreground clusters visible cleanly from both front (pi/2) & 45° (pi/4) cameras
    const clusterAnchors = [1.55, 1.85, 1.25, 2.15, 0.42, 0.74]
    const anchorJitter = (rng() - 0.5) * 0.18
    for (let pi = 0; pi < pebbles; pi++) {
      const ang = clusterAnchors[pi % clusterAnchors.length] + anchorJitter + (rng() - 0.5) * 0.16
      const chunky = isSpire && pi < 2
      const pw = (chunky ? (0.30 + rng() * 0.12) : pi === 0 ? (0.20 + rng() * 0.07) : (0.11 + rng() * 0.09)) * baseSpan
      const ph = pw * (chunky ? (0.72 + rng() * 0.24) : (0.38 + rng() * 0.22))
      const pd = pw * (0.76 + rng() * 0.28)
      const edgeR = Math.hypot(Math.cos(ang) * footRx, Math.sin(ang) * footRz)
      const radialFactor = chunky ? (0.64 + rng() * 0.10) : pi < 2 ? (0.78 + rng() * 0.10) : (0.88 + rng() * 0.14)
      const dist = edgeR * radialFactor + pw * 0.12
      blocks.push(buildStoneBlock(pebbleSpec, seed + 1709 + pi * 197, 1, {
        offset: {
          x: footCenterX + Math.cos(ang) * dist,
          y: 0,
          z: footCenterZ + Math.sin(ang) * dist,
        },
        rotX: (rng() - 0.5) * 0.16,
        rotY: rng() * Math.PI * 2,
        rotZ: (rng() - 0.5) * 0.18,
        scaleX: pw,
        scaleY: ph,
        scaleZ: pd,
        isPebble: true,
      }))
    }
  }

  // 4. Inter-slab & foot-pebble crevice seam AO (darkens concave V-cleft joints in both shader & baked GLB vertex colors!)
  const seamRange = Math.max(0.14, 0.17 * baseSpan)
  for (let i = 0; i < blocks.length; i++) {
    const bi = blocks[i]
    for (let j = 0; j < blocks.length; j++) {
      if (i === j) continue
      const bj = blocks[j]
      if (bj.hullPlanes.length === 0) continue
      // Pebbles cast light contact AO onto main slabs; main slabs cast bold crevice AO onto each other & nestled pebbles
      const weight = bi.isPebble ? (bj.isPebble ? 0.55 : 0.90) : (bj.isPebble ? 0.42 : 0.92)
      const range = (bi.isPebble || bj.isPebble) ? seamRange * 0.65 : seamRange
      for (let vi = 0; vi < bi.verts.length; vi++) {
        const sd = convexHullSignedDist(bi.verts[vi], bj.hullPlanes)
        if (sd < range) {
          const seamAO = smoothstep(range, -range * 0.12, sd) * weight
          if (seamAO > bi.cavityAttr[vi]) bi.cavityAttr[vi] = seamAO
        }
      }
    }
  }

  // 5. Re-center compound stone horizontally around the main slabs while keeping exact y >= 0 grounding
  let minY = Infinity
  for (const b of blocks) {
    for (const p of b.verts) if (p.y < minY) minY = p.y
  }
  for (const b of blocks) {
    for (const p of b.verts) {
      p.x -= footCenterX
      p.z -= footCenterZ
      p.y -= minY
    }
  }

  return packStoneBlocksToGeometry(blocks, spec, scaleMul)
}

// ---------------------------------------------------------------------------
// 5. Public Rock Group Builder (Single Stone or Grounded Cluster)
// ---------------------------------------------------------------------------
export function buildRockGeometries(spec: RockSpec): {
  geometries: { geometry: BufferGeometry; position: Vector3; rotationY: number; name: string }[]
  ms: number
} {
  const t0 = performance.now()
  const count = clamp(Math.round(spec.cluster.count), 1, 5)
  const out: { geometry: BufferGeometry; position: Vector3; rotationY: number; name: string }[] = []

  // Hero rock at origin
  out.push({
    geometry: buildSingleStoneGeometry(spec, spec.seed, 1.0),
    position: new Vector3(0, 0, 0),
    rotationY: 0,
    name: 'Stylized_Rock_Hero',
  })

  if (count > 1) {
    const rng = mulberry32(spec.seed + 9091)
    const baseRadius = 0.5 * Math.hypot(spec.shape.width, spec.shape.depth)
    const startAngle = rng() * Math.PI * 2
    for (let i = 1; i < count; i++) {
      const scale = Math.pow(spec.cluster.scaleDecay, i === 1 ? 1 : 1 + (i - 1) * 0.42) * (0.9 + rng() * 0.22)
      const angle = startAngle + ((i - 1) * (Math.PI * 2) / (count - 1)) + (rng() - 0.5) * 0.45
      const dist = baseRadius * (0.58 + scale * 0.46) * spec.cluster.spread
      const geo = buildSingleStoneGeometry(spec, spec.seed + i * 137 + 19, scale, false)
      out.push({
        geometry: geo,
        position: new Vector3(Math.cos(angle) * dist, -0.02 * scale, Math.sin(angle) * dist),
        rotationY: rng() * Math.PI * 2,
        name: `Stylized_Rock_Sub_${i}`,
      })
    }
  }

  return { geometries: out, ms: Math.max(0.1, performance.now() - t0) }
}

export function buildRockGroup(spec: RockSpec, material: Mesh['material']): {
  group: Group
  meshes: Mesh[]
  stats: RockBuildStats
  bounds: Box3
  dispose(): void
} {
  const { geometries, ms } = buildRockGeometries(spec)
  const group = new Group()
  group.name = 'StylizedRockAsset'
  const meshes: Mesh[] = []
  let vertices = 0
  let triangles = 0

  for (const item of geometries) {
    const mesh = new Mesh(item.geometry, material)
    mesh.name = item.name
    mesh.position.copy(item.position)
    mesh.rotation.y = item.rotationY
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    meshes.push(mesh)
    const pos = item.geometry.getAttribute('position')
    if (pos) {
      vertices += pos.count
      triangles += Math.round(pos.count / 3)
    }
  }

  // Re-center whole cluster horizontally while preserving exact y = 0 grounding
  group.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(group)
  if (!bounds.isEmpty()) {
    const center = bounds.getCenter(new Vector3())
    const minY = bounds.min.y
    for (const m of meshes) {
      m.position.x -= center.x
      m.position.z -= center.z
      m.position.y -= minY
    }
    group.updateMatrixWorld(true)
    bounds.setFromObject(group)
  }

  return {
    group,
    meshes,
    stats: { stones: meshes.length, vertices, triangles, ms: Math.round(ms * 10) / 10 },
    bounds,
    dispose() {
      for (const m of meshes) m.geometry.dispose()
    },
  }
}

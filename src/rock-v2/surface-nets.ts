import { BufferAttribute, BufferGeometry } from 'three'
import type { RockV2Field, Vec3 } from './sdf'

export interface SurfaceNetsOptions {
  /** Number of grid cells along the longest AABB axis (e.g. 34 for low-poly LOD0, 68 for high-res sculpt). */
  resolution: number
  /** Single clamped gradient projection step onto F(p)=0 only when off-surface error exceeds tolerance. */
  projectToSurface?: boolean
  /** Off-surface threshold (in voxel units) triggering the optional clamped projection. Default 0.08. */
  projectTolVoxels?: number
}

export interface TopologyAudit {
  vertices: number
  triangles: number
  connectedComponents: number
  openEdges: number
  nonManifoldEdges: number
  windingMismatches: number
  degenerateTriangles: number
  selfIntersections: number
  minY: number
  maxY: number
  maxOffSurfaceError: number
  meanOffSurfaceError: number
}

export interface SurfaceNetsResult {
  /** Indexed closed-manifold welded positions (grounded minY = 0, centered XZ). */
  positions: Float32Array
  /** Smooth area-weighted vertex normals on the welded closed mesh. */
  normals: Float32Array
  /** Triangle indices (length = triangles * 3). */
  indices: Uint32Array
  /** Translation added to raw SDF coordinates to produce grounded mesh coordinates: p_mesh = p_sdf + shift. */
  shift: Vec3
  /** Uniform voxel edge length (meters). */
  voxelSize: number
  /** Grid dimensions (nx, ny, nz sample points). */
  gridDims: [number, number, number]
  /** Measured timings (ms). */
  timings: {
    sdfSampleMs: number
    extractMs: number
    projectMs: number
    normalsMs: number
    totalMs: number
  }
  /** Full topological & geometric audit on the welded mesh. */
  audit: TopologyAudit
  /** Helper to create a ready-to-render Three.js BufferGeometry (clay / wireframe). */
  toBufferGeometry(): BufferGeometry
}

const CUBE_EDGES: readonly [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // X edges
  [0, 2], [1, 3], [4, 6], [5, 7], // Y edges
  [0, 4], [1, 5], [2, 6], [3, 7], // Z edges
]

const CORNER_OFFSETS: readonly [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
]

export function extractSurfaceNets(field: RockV2Field, opts: SurfaceNetsOptions): SurfaceNetsResult {
  const tStart = performance.now()
  const res = Math.max(12, Math.round(opts.resolution))
  const padCells = 2

  const spanX = field.boundsMax.x - field.boundsMin.x
  const spanY = field.boundsMax.y - field.boundsMin.y
  const spanZ = field.boundsMax.z - field.boundsMin.z
  const maxSpan = Math.max(spanX, spanY, spanZ)
  const voxelSize = maxSpan / res

  const cellsX = Math.max(8, Math.ceil(spanX / voxelSize)) + padCells * 2
  const cellsY = Math.max(8, Math.ceil(spanY / voxelSize)) + padCells * 2
  const cellsZ = Math.max(8, Math.ceil(spanZ / voxelSize)) + padCells * 2
  const nx = cellsX + 1
  const ny = cellsY + 1
  const nz = cellsZ + 1

  const originX = field.boundsMin.x - padCells * voxelSize
  const originY = field.boundsMin.y - padCells * voxelSize
  const originZ = field.boundsMin.z - padCells * voxelSize

  // 1. Sample scalar field onto regular 3D grid with guaranteed positive outer shell
  const tSample0 = performance.now()
  const grid = new Float32Array(nx * ny * nz)
  const idx3 = (i: number, j: number, k: number) => (k * ny + j) * nx + i
  const evalMacro = field.evalMacro

  for (let k = 0; k < nz; k++) {
    const z = originZ + k * voxelSize
    const isOuterZ = k === 0 || k === nz - 1
    for (let j = 0; j < ny; j++) {
      const y = originY + j * voxelSize
      const isOuterY = j === 0 || j === ny - 1
      const rowOff = (k * ny + j) * nx
      for (let i = 0; i < nx; i++) {
        if (isOuterZ || isOuterY || i === 0 || i === nx - 1) {
          // Enforce strictly positive boundary shell so extracted surface is guaranteed closed
          grid[rowOff + i] = Math.max(voxelSize, evalMacro(originX + i * voxelSize, y, z))
        } else {
          grid[rowOff + i] = evalMacro(originX + i * voxelSize, y, z)
        }
      }
    }
  }
  const sdfSampleMs = performance.now() - tSample0

  // Resolve rare 2x2 checkerboard saddle faces on the scalar grid so Surface Nets never pinches 4 quads onto 1 edge.
  resolveGridSaddles(grid, nx, ny, nz)

  // 2. Naive Surface Nets: place 1 dual vertex per sign-change cell at edge zero-crossing centroid
  const tExtract0 = performance.now()
  const cellVert = new Int32Array(cellsX * cellsY * cellsZ).fill(-1)
  const cellIdx = (i: number, j: number, k: number) => (k * cellsY + j) * cellsX + i
  const rawPos: number[] = []
  const rawCellOrigin: number[] = []
  const cornerVal = new Float32Array(8)

  for (let k = 0; k < cellsZ; k++) {
    for (let j = 0; j < cellsY; j++) {
      for (let i = 0; i < cellsX; i++) {
        let negMask = 0
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = CORNER_OFFSETS[c]
          const val = grid[idx3(i + ox, j + oy, k + oz)]
          cornerVal[c] = val
          if (val < 0) negMask |= 1 << c
        }
        if (negMask === 0 || negMask === 255) continue

        let sx = 0, sy = 0, sz = 0, count = 0
        for (let e = 0; e < 12; e++) {
          const [c0, c1] = CUBE_EDGES[e]
          const v0 = cornerVal[c0]
          const v1 = cornerVal[c1]
          if ((v0 < 0) === (v1 < 0)) continue
          const denom = v0 - v1
          const t = Math.abs(denom) > 1e-9 ? Math.min(1, Math.max(0, v0 / denom)) : 0.5
          const [ax, ay, az] = CORNER_OFFSETS[c0]
          const [bx, by, bz] = CORNER_OFFSETS[c1]
          sx += ax + (bx - ax) * t
          sy += ay + (by - ay) * t
          sz += az + (bz - az) * t
          count++
        }
        if (count === 0) continue

        const inv = 1 / count
        const vi = rawPos.length / 3
        cellVert[cellIdx(i, j, k)] = vi
        const cx0 = originX + i * voxelSize
        const cy0 = originY + j * voxelSize
        const cz0 = originZ + k * voxelSize
        rawCellOrigin.push(cx0, cy0, cz0)
        rawPos.push(
          cx0 + sx * inv * voxelSize,
          cy0 + sy * inv * voxelSize,
          cz0 + sz * inv * voxelSize,
        )
      }
    }
  }

  // Emit oriented quads across every interior sign-change grid edge (split into 2 clean triangles)
  const rawIndices: number[] = []
  const usedDiags = new Set<string>()
  const emitQuad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    const v0 = a, v1 = flip ? d : b, v2 = c, v3 = flip ? b : d
    const k02 = v0 < v2 ? `${v0}:${v2}` : `${v2}:${v0}`
    const k13 = v1 < v3 ? `${v1}:${v3}` : `${v3}:${v1}`
    // Split along shorter diagonal unless that diagonal is already used
    const d02 = distSqArr(rawPos, v0, v2)
    const d13 = distSqArr(rawPos, v1, v3)
    const pick02 = usedDiags.has(k02) ? false : usedDiags.has(k13) ? true : d02 <= d13
    if (pick02) {
      usedDiags.add(k02)
      rawIndices.push(v0, v1, v2, v0, v2, v3)
    } else {
      usedDiags.add(k13)
      rawIndices.push(v1, v2, v3, v1, v3, v0)
    }
  }

  // X-edges: (i, j, k) -> (i+1, j, k)
  for (let k = 1; k < cellsZ; k++) {
    for (let j = 1; j < cellsY; j++) {
      for (let i = 0; i < cellsX; i++) {
        const v0 = grid[idx3(i, j, k)]
        const v1 = grid[idx3(i + 1, j, k)]
        if ((v0 < 0) === (v1 < 0)) continue
        const c00 = cellVert[cellIdx(i, j - 1, k - 1)]
        const c10 = cellVert[cellIdx(i, j, k - 1)]
        const c11 = cellVert[cellIdx(i, j, k)]
        const c01 = cellVert[cellIdx(i, j - 1, k)]
        emitQuad(c00, c10, c11, c01, !(v0 < 0))
      }
    }
  }

  // Y-edges: (i, j, k) -> (i, j+1, k)
  for (let k = 1; k < cellsZ; k++) {
    for (let j = 0; j < cellsY; j++) {
      for (let i = 1; i < cellsX; i++) {
        const v0 = grid[idx3(i, j, k)]
        const v1 = grid[idx3(i, j + 1, k)]
        if ((v0 < 0) === (v1 < 0)) continue
        const c00 = cellVert[cellIdx(i - 1, j, k - 1)]
        const c01 = cellVert[cellIdx(i - 1, j, k)]
        const c11 = cellVert[cellIdx(i, j, k)]
        const c10 = cellVert[cellIdx(i, j, k - 1)]
        emitQuad(c00, c01, c11, c10, !(v0 < 0))
      }
    }
  }

  // Z-edges: (i, j, k) -> (i, j, k+1)
  for (let k = 0; k < cellsZ; k++) {
    for (let j = 1; j < cellsY; j++) {
      for (let i = 1; i < cellsX; i++) {
        const v0 = grid[idx3(i, j, k)]
        const v1 = grid[idx3(i, j, k + 1)]
        if ((v0 < 0) === (v1 < 0)) continue
        const c00 = cellVert[cellIdx(i - 1, j - 1, k)]
        const c10 = cellVert[cellIdx(i, j - 1, k)]
        const c11 = cellVert[cellIdx(i, j, k)]
        const c01 = cellVert[cellIdx(i - 1, j, k)]
        emitQuad(c00, c10, c11, c01, !(v0 < 0))
      }
    }
  }

  const positions = Float32Array.from(rawPos)
  const indices = Uint32Array.from(rawIndices)
  const extractMs = performance.now() - tExtract0

  // 3. Optional single clamped projection onto F(p)=0 (only where |F(v)| > tol; zero global Laplacian!)
  const tProj0 = performance.now()
  const doProject = opts.projectToSurface !== false
  const vCount = positions.length / 3
  if (doProject) {
    const tol = (opts.projectTolVoxels ?? 0.08) * voxelSize
    const maxStep = 0.32 * voxelSize
    const eps = Math.max(0.004, voxelSize * 0.25)
    for (let vi = 0; vi < vCount; vi++) {
      const px = positions[vi * 3]
      const py = positions[vi * 3 + 1]
      const pz = positions[vi * 3 + 2]
      const f0 = evalMacro(px, py, pz)
      if (Math.abs(f0) <= tol) continue

      const gx = (evalMacro(px + eps, py, pz) - evalMacro(px - eps, py, pz)) / (2 * eps)
      const gy = (evalMacro(px, py + eps, pz) - evalMacro(px, py - eps, pz)) / (2 * eps)
      const gz = (evalMacro(px, py, pz + eps) - evalMacro(px, py, pz - eps)) / (2 * eps)
      const gLenSq = gx * gx + gy * gy + gz * gz
      if (gLenSq < 0.04) continue // small gradient -> keep original cell centroid

      const stepLen = f0 / gLenSq
      const moveDist = Math.abs(stepLen) * Math.sqrt(gLenSq)
      if (moveDist > maxStep) continue // too far -> keep original to avoid jumping across thin walls/branches

      const cellMargin = 0.04 * voxelSize
      const cx0 = rawCellOrigin[vi * 3], cy0 = rawCellOrigin[vi * 3 + 1], cz0 = rawCellOrigin[vi * 3 + 2]
      const nxPos = Math.min(cx0 + voxelSize - cellMargin, Math.max(cx0 + cellMargin, px - gx * stepLen))
      const nyPos = Math.min(cy0 + voxelSize - cellMargin, Math.max(cy0 + cellMargin, py - gy * stepLen))
      const nzPos = Math.min(cz0 + voxelSize - cellMargin, Math.max(cz0 + cellMargin, pz - gz * stepLen))
      const f1 = evalMacro(nxPos, nyPos, nzPos)
      // Accept only if strictly closer to F=0 and gradient didn't flip branches
      if (Math.abs(f1) < Math.abs(f0)) {
        const g1x = (evalMacro(nxPos + eps, nyPos, nzPos) - evalMacro(nxPos - eps, nyPos, nzPos)) / (2 * eps)
        const g1y = (evalMacro(nxPos, nyPos + eps, nzPos) - evalMacro(nxPos, nyPos - eps, nzPos)) / (2 * eps)
        const g1z = (evalMacro(nxPos, nyPos, nzPos + eps) - evalMacro(nxPos, nyPos, nzPos - eps)) / (2 * eps)
        if (gx * g1x + gy * g1y + gz * g1z > 0.35 * gLenSq) {
          positions[vi * 3] = nxPos
          positions[vi * 3 + 1] = nyPos
          positions[vi * 3 + 2] = nzPos
        }
      }
    }
  }
  const projectMs = performance.now() - tProj0

  // Measure off-surface error in raw SDF space before grounding shift
  let maxOffErr = 0
  let sumOffErr = 0
  for (let vi = 0; vi < vCount; vi++) {
    const err = Math.abs(evalMacro(positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]))
    if (err > maxOffErr) maxOffErr = err
    sumOffErr += err
  }
  const meanOffErr = vCount > 0 ? sumOffErr / vCount : 0

  // Ground cleanly to minY = 0 & center horizontally (record exact shift for analytical SDF baking!)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let vi = 0; vi < vCount; vi++) {
    const x = positions[vi * 3], y = positions[vi * 3 + 1], z = positions[vi * 3 + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const shift: Vec3 = {
    x: Number.isFinite(minX) ? -0.5 * (minX + maxX) : 0,
    y: Number.isFinite(minY) ? -minY : 0,
    z: Number.isFinite(minZ) ? -0.5 * (minZ + maxZ) : 0,
  }
  for (let vi = 0; vi < vCount; vi++) {
    positions[vi * 3] += shift.x
    positions[vi * 3 + 1] += shift.y
    positions[vi * 3 + 2] += shift.z
  }

  // 4. Compute smooth area-weighted vertex normals
  const tNorm0 = performance.now()
  const normals = computeVertexNormals(positions, indices)
  const normalsMs = performance.now() - tNorm0

  const totalMs = performance.now() - tStart
  const audit = auditMeshTopology(positions, indices, maxOffErr, meanOffErr)

  return {
    positions,
    normals,
    indices,
    shift,
    voxelSize,
    gridDims: [nx, ny, nz],
    timings: {
      sdfSampleMs: round1(sdfSampleMs),
      extractMs: round1(extractMs),
      projectMs: round1(projectMs),
      normalsMs: round1(normalsMs),
      totalMs: round1(totalMs),
    },
    audit,
    toBufferGeometry() {
      const geo = new BufferGeometry()
      geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
      geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
      geo.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
      geo.computeBoundingBox()
      geo.computeBoundingSphere()
      return geo
    },
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * Eliminates 2x2 checkerboard saddle faces (and 3D diagonal pinch corners) in the scalar grid.
 * In Naive Surface Nets, any 2x2 face with alternating signs `(- + / + -)` puts 4 quads on 1 shared edge.
 * Nudging the corner closest to zero across the bilinear face average resolves the topological ambiguity cleanly.
 */
function resolveGridSaddles(grid: Float32Array, nx: number, ny: number, nz: number) {
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i
  const fixFace = (i00: number, i10: number, i01: number, i11: number): boolean => {
    const v00 = grid[i00], v10 = grid[i10], v01 = grid[i01], v11 = grid[i11]
    const n00 = v00 < 0, n10 = v10 < 0, n01 = v01 < 0, n11 = v11 < 0
    if (n00 === n11 && n10 === n01 && n00 !== n10) {
      // Bilinear face-center value decides whether the two negative corners connect or separate
      const avg = 0.25 * (v00 + v10 + v01 + v11)
      const eps = 1e-4
      if (avg < 0) {
        // Connect negative corners: flip the weaker positive corner slightly negative
        const pA = n00 ? i10 : i00
        const pB = n00 ? i01 : i11
        if (Math.abs(grid[pA]) <= Math.abs(grid[pB])) grid[pA] = -eps
        else grid[pB] = -eps
      } else {
        // Separate negative corners: flip the weaker negative corner slightly positive
        const mA = n00 ? i00 : i10
        const mB = n00 ? i11 : i01
        if (Math.abs(grid[mA]) <= Math.abs(grid[mB])) grid[mA] = eps
        else grid[mB] = eps
      }
      return true
    }
    return false
  }

  for (let pass = 0; pass < 6; pass++) {
    let fixed = 0
    // XY faces
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 1; j < ny - 2; j++) {
        for (let i = 1; i < nx - 2; i++) {
          if (fixFace(id(i, j, k), id(i + 1, j, k), id(i, j + 1, k), id(i + 1, j + 1, k))) fixed++
        }
      }
    }
    // XZ faces
    for (let k = 1; k < nz - 2; k++) {
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 2; i++) {
          if (fixFace(id(i, j, k), id(i + 1, j, k), id(i, j, k + 1), id(i + 1, j, k + 1))) fixed++
        }
      }
    }
    // YZ faces
    for (let k = 1; k < nz - 2; k++) {
      for (let j = 1; j < ny - 2; j++) {
        for (let i = 1; i < nx - 1; i++) {
          if (fixFace(id(i, j, k), id(i, j + 1, k), id(i, j, k + 1), id(i, j + 1, k + 1))) fixed++
        }
      }
    }
    // 3D body-diagonal pinch cells (only 2 diagonally opposite corners share sign -> split into 2 manifolds in 1 cell)
    const bodyDiags: [number, number][] = [[0, 7], [1, 6], [2, 5], [3, 4]]
    for (let k = 1; k < nz - 2; k++) {
      for (let j = 1; j < ny - 2; j++) {
        for (let i = 1; i < nx - 2; i++) {
          let negMask = 0
          for (let c = 0; c < 8; c++) {
            const [ox, oy, oz] = CORNER_OFFSETS[c]
            if (grid[id(i + ox, j + oy, k + oz)] < 0) negMask |= 1 << c
          }
          for (const [a, b] of bodyDiags) {
            const pair = (1 << a) | (1 << b)
            if (negMask === pair || negMask === (255 ^ pair)) {
              const [ax, ay, az] = CORNER_OFFSETS[a]
              const [bx, by, bz] = CORNER_OFFSETS[b]
              const ia = id(i + ax, j + ay, k + az)
              const ib = id(i + bx, j + by, k + bz)
              const targetIdx = Math.abs(grid[ia]) <= Math.abs(grid[ib]) ? ia : ib
              grid[targetIdx] = grid[targetIdx] < 0 ? 1e-4 : -1e-4
              fixed++
              break
            }
          }
        }
      }
    }
    if (fixed === 0) break
  }
}

function distSqArr(arr: number[], a: number, b: number): number {
  const dx = arr[a * 3] - arr[b * 3]
  const dy = arr[a * 3 + 1] - arr[b * 3 + 1]
  const dz = arr[a * 3 + 2] - arr[b * 3 + 2]
  return dx * dx + dy * dy + dz * dz
}

export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
    if (l > 1e-10) {
      normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l
    } else {
      normals[i] = 0; normals[i + 1] = 1; normals[i + 2] = 0
    }
  }
  return normals
}

// ---------------------------------------------------------------------------
// Rigorous Topology & Self-Intersection Audit (Pre-UV Welded Mesh)
// ---------------------------------------------------------------------------
export function auditMeshTopology(
  positions: Float32Array,
  indices: Uint32Array,
  maxOffSurfaceError = 0,
  meanOffSurfaceError = 0,
): TopologyAudit {
  const vCount = positions.length / 3
  const tCount = indices.length / 3

  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < vCount; i++) {
    const y = positions[i * 3 + 1]
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  // Directed half-edges & undirected edge counts + union-find for connected components
  const parent = new Int32Array(vCount)
  for (let i = 0; i < vCount; i++) parent[i] = i
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
    return x
  }
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const usedVert = new Uint8Array(vCount)
  const undirCounts = new Map<string, number>()
  const dirCounts = new Map<string, number>()
  let degenerateTriangles = 0

  for (let t = 0; t < tCount; t++) {
    const a = indices[t * 3]
    const b = indices[t * 3 + 1]
    const c = indices[t * 3 + 2]
    usedVert[a] = usedVert[b] = usedVert[c] = 1
    union(a, b); union(b, c)

    if (a === b || b === c || c === a) {
      degenerateTriangles++
    } else {
      const abx = positions[b * 3] - positions[a * 3]
      const aby = positions[b * 3 + 1] - positions[a * 3 + 1]
      const abz = positions[b * 3 + 2] - positions[a * 3 + 2]
      const acx = positions[c * 3] - positions[a * 3]
      const acy = positions[c * 3 + 1] - positions[a * 3 + 1]
      const acz = positions[c * 3 + 2] - positions[a * 3 + 2]
      const cx = aby * acz - abz * acy
      const cy = abz * acx - abx * acz
      const cz = abx * acy - aby * acx
      if (0.5 * Math.hypot(cx, cy, cz) < 1e-8) degenerateTriangles++
    }

    const triEdges: [number, number][] = [[a, b], [b, c], [c, a]]
    for (const [u, v] of triEdges) {
      const uKey = u < v ? `${u}:${v}` : `${v}:${u}`
      undirCounts.set(uKey, (undirCounts.get(uKey) ?? 0) + 1)
      const dKey = `${u}>${v}`
      dirCounts.set(dKey, (dirCounts.get(dKey) ?? 0) + 1)
    }
  }

  let openEdges = 0
  let nonManifoldEdges = 0
  for (const cnt of undirCounts.values()) {
    if (cnt === 1) openEdges++
    else if (cnt > 2) nonManifoldEdges++
  }

  let windingMismatches = 0
  for (const [key, cnt] of dirCounts.entries()) {
    if (cnt !== 1) windingMismatches++
    else {
      const [u, v] = key.split('>')
      if (dirCounts.get(`${v}>${u}`) !== 1) windingMismatches++
    }
  }

  const roots = new Set<number>()
  for (let i = 0; i < vCount; i++) {
    if (usedVert[i]) roots.add(find(i))
  }

  // Exact spatial-hashed non-adjacent triangle-triangle self-intersection check
  const selfIntersections = countSelfIntersections(positions, indices)

  return {
    vertices: vCount,
    triangles: tCount,
    connectedComponents: roots.size,
    openEdges,
    nonManifoldEdges,
    windingMismatches,
    degenerateTriangles,
    selfIntersections,
    minY: Number.isFinite(minY) ? round4(minY) : 0,
    maxY: Number.isFinite(maxY) ? round4(maxY) : 0,
    maxOffSurfaceError: round4(maxOffSurfaceError),
    meanOffSurfaceError: round4(meanOffSurfaceError),
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

function countSelfIntersections(positions: Float32Array, indices: Uint32Array): number {
  const tCount = indices.length / 3
  if (tCount === 0) return 0

  // Compute per-triangle AABBs and average edge size for spatial hash cell sizing
  const bMinX = new Float32Array(tCount), bMaxX = new Float32Array(tCount)
  const bMinY = new Float32Array(tCount), bMaxY = new Float32Array(tCount)
  const bMinZ = new Float32Array(tCount), bMaxZ = new Float32Array(tCount)
  let avgExtent = 0
  for (let t = 0; t < tCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const minx = Math.min(positions[a], positions[b], positions[c])
    const maxx = Math.max(positions[a], positions[b], positions[c])
    const miny = Math.min(positions[a + 1], positions[b + 1], positions[c + 1])
    const maxy = Math.max(positions[a + 1], positions[b + 1], positions[c + 1])
    const minz = Math.min(positions[a + 2], positions[b + 2], positions[c + 2])
    const maxz = Math.max(positions[a + 2], positions[b + 2], positions[c + 2])
    bMinX[t] = minx; bMaxX[t] = maxx
    bMinY[t] = miny; bMaxY[t] = maxy
    bMinZ[t] = minz; bMaxZ[t] = maxz
    avgExtent += (maxx - minx) + (maxy - miny) + (maxz - minz)
  }
  const cell = Math.max(0.03, (avgExtent / (tCount * 3)) * 2.2)
  const invCell = 1 / cell
  const buckets = new Map<string, number[]>()

  for (let t = 0; t < tCount; t++) {
    const ix0 = Math.floor(bMinX[t] * invCell), ix1 = Math.floor(bMaxX[t] * invCell)
    const iy0 = Math.floor(bMinY[t] * invCell), iy1 = Math.floor(bMaxY[t] * invCell)
    const iz0 = Math.floor(bMinZ[t] * invCell), iz1 = Math.floor(bMaxZ[t] * invCell)
    for (let kz = iz0; kz <= iz1; kz++) {
      for (let ky = iy0; ky <= iy1; ky++) {
        for (let kx = ix0; kx <= ix1; kx++) {
          const key = `${kx},${ky},${kz}`
          let arr = buckets.get(key)
          if (!arr) { arr = []; buckets.set(key, arr) }
          arr.push(t)
        }
      }
    }
  }

  const tested = new Set<number>()
  let hits = 0
  for (const list of buckets.values()) {
    const len = list.length
    if (len < 2) continue
    for (let i = 0; i < len; i++) {
      const t1 = list[i]
      const a1 = indices[t1 * 3], b1 = indices[t1 * 3 + 1], c1 = indices[t1 * 3 + 2]
      for (let j = i + 1; j < len; j++) {
        const t2 = list[j]
        const lo = t1 < t2 ? t1 : t2
        const hi = t1 < t2 ? t2 : t1
        const pairKey = lo * tCount + hi
        if (tested.has(pairKey)) continue
        tested.add(pairKey)

        // Skip triangles sharing any vertex
        const a2 = indices[t2 * 3], b2 = indices[t2 * 3 + 1], c2 = indices[t2 * 3 + 2]
        if (
          a1 === a2 || a1 === b2 || a1 === c2 ||
          b1 === a2 || b1 === b2 || b1 === c2 ||
          c1 === a2 || c1 === b2 || c1 === c2
        ) continue

        // AABB reject
        if (
          bMaxX[t1] < bMinX[t2] || bMaxX[t2] < bMinX[t1] ||
          bMaxY[t1] < bMinY[t2] || bMaxY[t2] < bMinY[t1] ||
          bMaxZ[t1] < bMinZ[t2] || bMaxZ[t2] < bMinZ[t1]
        ) continue

        if (trianglesIntersect(positions, a1, b1, c1, a2, b2, c2)) hits++
      }
    }
  }
  return hits
}

/** Strict non-adjacent triangle-triangle intersection test (segment vs triangle edges). */
function trianglesIntersect(
  pos: Float32Array,
  a1: number, b1: number, c1: number,
  a2: number, b2: number, c2: number,
): boolean {
  const edges1: [number, number][] = [[a1, b1], [b1, c1], [c1, a1]]
  for (const [u, v] of edges1) {
    if (segmentIntersectsTriangle(pos, u, v, a2, b2, c2)) return true
  }
  const edges2: [number, number][] = [[a2, b2], [b2, c2], [c2, a2]]
  for (const [u, v] of edges2) {
    if (segmentIntersectsTriangle(pos, u, v, a1, b1, c1)) return true
  }
  return false
}

function segmentIntersectsTriangle(
  pos: Float32Array,
  p0: number, p1: number,
  v0: number, v1: number, v2: number,
): boolean {
  const ox = pos[p0 * 3], oy = pos[p0 * 3 + 1], oz = pos[p0 * 3 + 2]
  const dx = pos[p1 * 3] - ox, dy = pos[p1 * 3 + 1] - oy, dz = pos[p1 * 3 + 2] - oz

  const v0x = pos[v0 * 3], v0y = pos[v0 * 3 + 1], v0z = pos[v0 * 3 + 2]
  const e1x = pos[v1 * 3] - v0x, e1y = pos[v1 * 3 + 1] - v0y, e1z = pos[v1 * 3 + 2] - v0z
  const e2x = pos[v2 * 3] - v0x, e2y = pos[v2 * 3 + 1] - v0y, e2z = pos[v2 * 3 + 2] - v0z

  const hx = dy * e2z - dz * e2y
  const hy = dz * e2x - dx * e2z
  const hz = dx * e2y - dy * e2x
  const a = e1x * hx + e1y * hy + e1z * hz
  if (Math.abs(a) < 1e-10) return false
  const f = 1 / a
  const sx = ox - v0x, sy = oy - v0y, sz = oz - v0z
  const u = f * (sx * hx + sy * hy + sz * hz)
  if (u < -1e-6 || u > 1 + 1e-6) return false
  const qx = sy * e1z - sz * e1y
  const qy = sz * e1x - sx * e1z
  const qz = sx * e1y - sy * e1x
  const v = f * (dx * qx + dy * qy + dz * qz)
  if (v < -1e-6 || u + v > 1 + 1e-6) return false
  const t = f * (e2x * qx + e2y * qy + e2z * qz)
  return t > 1e-6 && t < 1 - 1e-6
}

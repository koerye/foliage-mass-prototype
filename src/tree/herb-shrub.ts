// Branching Herbaceous Flowering Shrub Generator (Prototype 2: 10 绣球花丛, plus Phase 3 11/12/15/16):
// Models true multi-stem leafy shrubs with individual decussate 3D curved leaves AND
// TRUE 3D HEMISPHERICAL HYDRANGEA POM-POM FLOWER CLUSTERS (20-26 tangential cupped 4-petal
// florets arranged on a dome shell with shaded interior core — ZERO flat billboard circles!).
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export interface BuiltHerbShrub {
  stemGeometry: BufferGeometry
  leafGeometry: BufferGeometry
  flowerGeometry: BufferGeometry
  coreGeometry: BufferGeometry
  stems: number
  leaves: number
  flowers: number
}

function appendTube(
  spine: Vector3[],
  rStart: number,
  rEnd: number,
  radialSegs: number,
  colBase: Color,
  colTip: Color,
  pos: number[],
  nor: number[],
  uv: number[],
  col: number[],
  idx: number[],
) {
  const rings = spine.length
  if (rings < 2) return
  const baseVert = pos.length / 3
  const tVec = new Vector3(), side = new Vector3(), binorm = new Vector3(), n = new Vector3(), p = new Vector3()
  const c = new Color()
  for (let i = 0; i < rings; i++) {
    const f = i / (rings - 1)
    tVec.subVectors(spine[Math.min(rings - 1, i + 1)], spine[Math.max(0, i - 1)])
    if (tVec.lengthSq() < 1e-8) tVec.copy(UP)
    else tVec.normalize()
    const ref = Math.abs(tVec.y) < 0.9 ? UP : new Vector3(1, 0, 0)
    side.crossVectors(tVec, ref).normalize()
    binorm.crossVectors(tVec, side).normalize()
    const r = MathUtils.lerp(rStart, rEnd, f)
    c.copy(colBase).lerp(colTip, f)
    for (let s = 0; s < radialSegs; s++) {
      const a = (s / radialSegs) * Math.PI * 2
      n.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(binorm, Math.sin(a)).normalize()
      p.copy(spine[i]).addScaledVector(n, r)
      pos.push(p.x, p.y, p.z)
      nor.push(n.x, n.y, n.z)
      uv.push(s / radialSegs, f)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let s = 0; s < radialSegs; s++) {
      const sn = (s + 1) % radialSegs
      const a = baseVert + i * radialSegs + s
      const b = baseVert + i * radialSegs + sn
      const d = baseVert + (i + 1) * radialSegs + s
      const e = baseVert + (i + 1) * radialSegs + sn
      idx.push(a, b, e, a, e, d)
    }
  }
}

function appendLowPolyCoreDome(
  center: Vector3,
  radius: number,
  colBottom: Color,
  colTop: Color,
  pos: number[],
  nor: number[],
  uv: number[],
  col: number[],
  idx: number[],
) {
  const latSegs = 5
  const lonSegs = 8
  const baseVert = pos.length / 3
  const c = new Color()
  for (let la = 0; la <= latSegs; la++) {
    const v = la / latSegs
    const phi = MathUtils.lerp(-Math.PI * 0.28, Math.PI * 0.5, v)
    const cp = Math.cos(phi), sp = Math.sin(phi)
    c.copy(colBottom).lerp(colTop, v)
    for (let lo = 0; lo <= lonSegs; lo++) {
      const u = lo / lonSegs
      const th = u * Math.PI * 2
      const nx = cp * Math.cos(th), ny = sp, nz = cp * Math.sin(th)
      pos.push(center.x + nx * radius, center.y + ny * radius * 0.88, center.z + nz * radius)
      nor.push(nx, ny, nz)
      uv.push(u, v)
      col.push(c.r, c.g, c.b)
    }
  }
  const stride = lonSegs + 1
  for (let la = 0; la < latSegs; la++) {
    for (let lo = 0; lo < lonSegs; lo++) {
      const a = baseVert + la * stride + lo
      const b = a + 1
      const d = a + stride
      const e = d + 1
      // Outward CCW winding matching radial surface normal (dP/dphi x dP/dtheta = +N)
      idx.push(a, e, b, a, d, e)
    }
  }
}

export function buildHerbShrub(spec: TreeSpec, env: CrownEnvelope): BuiltHerbShrub {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 9455))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.4, (1 / keepRatio) ** 0.35) : 1

  const shrubH = Math.max(0.32, spec.trunk.height || 0.72)
  const shrubW = Math.max(0.32, spec.crown.width || 0.68)
  const stemCount = Math.max(5, Math.min(18, Math.round(spec.branches.count || 11)))
  const leafSizeBase = Math.max(0.10, spec.leaves.leafSize || 0.21) * scaleBoost
  const leafAspect = MathUtils.clamp(spec.leaves.leafAspect || 0.74, 0.45, 1.2)
  const ballCountTarget = spec.flowers.enabled
    ? Math.max(2, Math.min(12, Math.round(spec.flowers.clusterCount || 6)))
    : 0
  const floretsPerBall = Math.max(12, Math.round((spec.flowers.count || 26) * keepRatio))

  const sPos: number[] = [], sNor: number[] = [], sUv: number[] = [], sCol: number[] = [], sIdx: number[] = []
  const lPos: number[] = [], lNor: number[] = [], lUv: number[] = [], lCol: number[] = []
  const lCen: number[] = [], lCor: number[] = [], lIdx: number[] = []
  const fPos: number[] = [], fNor: number[] = [], fUv: number[] = [], fCol: number[] = []
  const fCen: number[] = [], fCor: number[] = [], fIdx: number[] = []
  const cPos: number[] = [], cNor: number[] = [], cUv: number[] = [], cCol: number[] = [], cIdx: number[] = []

  const stemBaseCol = new Color('#295c22')
  const stemTipCol = new Color('#5da832')
  const leafInnerCol = new Color(spec.leaves.tintInner || '#88b294')
  const leafOuterCol = new Color(spec.leaves.tintOuter || '#fffef2')
  const flowerInnerCol = new Color(spec.flowers.tintInner || '#bac4f8')
  const flowerOuterCol = new Color(spec.flowers.tintOuter || '#ffffff')
  const coreBotCol = new Color('#8a98dc')
  const coreTopCol = new Color('#ccd4ff')
  const tmpCol = new Color()
  const domeCenter = new Vector3(0, shrubH * 0.34, 0)

  const stemRadialSegs = opt.woodDetail < 0.5 ? 3 : 4
  const segU = opt.flatCards ? 1 : 2
  const segV = opt.flatCards ? 1 : 3
  const colsU = segU + 1, rowsV = segV + 1

  interface BranchRecord {
    spine: Vector3[]
    outDir: Vector3
    angle: number
    isPrimary: boolean
    tip: Vector3
    len: number
  }
  const branches: BranchRecord[] = []

  // Helper: emit one individual 3D curved serrated leaf anchored at `socket`
  const emitSingleLeaf = (
    socket: Vector3,
    dir: Vector3,
    size: number,
    hFrac: number,
    shadeFactor: number,
  ) => {
    const width = size * leafAspect
    const fwd = dir.clone().normalize()
    // Right-handed leaf basis: right = cross(fwd, UP), up = cross(right, fwd) -> strictly +Y upward normal & CCW winding!
    const rawSide = new Vector3().crossVectors(fwd, UP)
    if (rawSide.lengthSq() < 1e-5) rawSide.set(1, 0, 0)
    rawSide.normalize()
    const rawUp = new Vector3().crossVectors(rawSide, fwd).normalize()
    const roll = (random() - 0.5) * 0.24
    const side = rawSide.clone().multiplyScalar(Math.cos(roll)).addScaledVector(rawUp, Math.sin(roll)).normalize()
    const up = new Vector3().crossVectors(side, fwd).normalize()

    const baseVert = lPos.length / 3
    const pts: Vector3[] = []
    const leafCenter = socket.clone().addScaledVector(fwd, size * 0.48)
    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV
      const along = v * size
      const arch = Math.sin(Math.PI * v) * size * 0.14 - v * v * size * 0.16
      for (let cu = 0; cu < colsU; cu++) {
        const u = cu / segU
        const s = 2 * u - 1
        const cup = size * 0.085 * (s * s - 0.32) * Math.sin(Math.PI * v)
        const p = socket.clone()
          .addScaledVector(fwd, along)
          .addScaledVector(side, s * width * 0.5)
          .addScaledVector(up, arch + cup)
        if (p.y < 0.015) p.y = 0.015
        pts.push(p)
      }
    }
    const vA = new Vector3(), vB = new Vector3(), nL = new Vector3(), nD = new Vector3()
    const jitter = 1 + (random() - 0.5) * 0.14
    const ao = 1 - (spec.leaves.aoStrength ?? 0.5) * (1 - hFrac) * 0.52
    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV
      for (let cu = 0; cu < colsU; cu++) {
        const u = cu / segU
        const p = pts[rv * colsU + cu]
        const pL = pts[rv * colsU + Math.max(0, cu - 1)]
        const pR = pts[rv * colsU + Math.min(segU, cu + 1)]
        const pD = pts[Math.max(0, rv - 1) * colsU + cu]
        const pU = pts[Math.min(segV, rv + 1) * colsU + cu]
        vA.subVectors(pR, pL); vB.subVectors(pU, pD)
        nL.crossVectors(vB, vA)
        if (nL.lengthSq() < 1e-8) nL.copy(up)
        else { nL.normalize(); if (nL.dot(up) < 0) nL.negate() }
        nD.subVectors(p, domeCenter)
        if (nD.lengthSq() < 1e-6) nD.copy(UP)
        else nD.normalize()
        nD.y = Math.max(0.25, nD.y); nD.normalize()
        nL.lerp(nD, 0.52).normalize()

        tmpCol.copy(leafInnerCol).lerp(leafOuterCol, MathUtils.clamp(hFrac * 0.8 + v * 0.25, 0, 1))
        tmpCol.multiplyScalar(ao * shadeFactor * jitter * (0.88 + 0.16 * v))

        lPos.push(p.x, p.y, p.z)
        lNor.push(nL.x, nL.y, nL.z)
        lUv.push(u, v)
        lCol.push(Math.min(1.15, tmpCol.r), Math.min(1.15, tmpCol.g), Math.min(1.15, tmpCol.b))
        lCen.push(leafCenter.x, leafCenter.y, leafCenter.z)
        lCor.push((u - 0.5) * width, (v - 0.5) * size)
      }
    }
    for (let rv = 0; rv < segV; rv++) {
      for (let cu = 0; cu < segU; cu++) {
        const a = baseVert + rv * colsU + cu
        const b = a + 1
        const d = a + colsU
        const e = d + 1
        lIdx.push(a, b, e, a, e, d)
      }
    }
  }

  let stems = 0
  let leaves = 0
  let flowers = 0

  // 1. Build lush spreading green stems + graceful forked secondary twigs (low-to-mid mound matching 10_hydrangea_3view!)
  for (let i = 0; i < stemCount; i++) {
    const ringFrac = i / stemCount
    const isInner = i < Math.max(3, Math.round(stemCount * 0.30))
    const angle = i * GOLDEN + (random() - 0.5) * 0.32
    const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const r0 = shrubW * (isInner ? 0.08 : 0.17) * (0.45 + random() * 0.55)
    const len = shrubH * (isInner ? 0.92 + random() * 0.16 : 0.78 + random() * 0.24)
    const leanRad = MathUtils.degToRad(isInner ? 18 + random() * 14 : 38 + random() * 20)
    const arch = isInner ? 0.16 + random() * 0.12 : 0.34 + random() * 0.18

    const rings = 6
    const spine: Vector3[] = [new Vector3(out.x * r0, 0, out.z * r0)]
    const step = len / (rings - 1)
    for (let k = 1; k < rings; k++) {
      const t = (k - 0.5) / (rings - 1)
      const aHere = leanRad + arch * t * t * Math.PI * 0.44
      const dir = UP.clone().multiplyScalar(Math.cos(aHere)).addScaledVector(out, Math.sin(aHere)).normalize()
      const pt = spine[k - 1].clone().addScaledVector(dir, step)
      spine.push(env.deform(pt, k / (rings - 1)))
    }
    appendTube(spine, 0.0085, 0.0038, stemRadialSegs, stemBaseCol, stemTipCol, sPos, sNor, sUv, sCol, sIdx)
    stems++
    branches.push({ spine, outDir: out, angle, isPrimary: true, tip: spine[spine.length - 1].clone(), len })

    // Add 1 forked lateral shoot on ~65% of primary stems (creates lush tiered bush volume!)
    if (random() < 0.65 || ringFrac < 0.45) {
      const forkIdx = 2 + Math.floor(random() * 2)
      const origin = spine[forkIdx].clone()
      const sideSign = i % 2 === 0 ? 1 : -1
      const forkYaw = angle + sideSign * (0.58 + random() * 0.45)
      const fOut = new Vector3(Math.cos(forkYaw), 0, Math.sin(forkYaw))
      const fLen = len * (0.46 + random() * 0.16)
      const fRings = 4
      const fSpine: Vector3[] = [origin]
      for (let k = 1; k < fRings; k++) {
        const t = k / (fRings - 1)
        const aHere = MathUtils.degToRad(40 + t * 22)
        const dir = UP.clone().multiplyScalar(Math.cos(aHere)).addScaledVector(fOut, Math.sin(aHere)).normalize()
        fSpine.push(fSpine[k - 1].clone().addScaledVector(dir, fLen / (fRings - 1)))
      }
      appendTube(fSpine, 0.0052, 0.0028, stemRadialSegs, stemBaseCol, stemTipCol, sPos, sNor, sUv, sCol, sIdx)
      stems++
      branches.push({ spine: fSpine, outDir: fOut, angle: forkYaw, isPrimary: false, tip: fSpine[fSpine.length - 1].clone(), len: fLen })
    }
  }

  // 2. Pick 5-6 well-spaced staggered branch tips nestled AMONG the leaf canopy for TRUE 3D HYDRANGEA BALLS
  //    Reserve the 2 tallest shoots as lush leafy green crowns rising behind/left (matching 10_hydrangea_3view!)
  const sortedByHeight = [...branches].sort((a, b) => b.tip.y - a.tip.y)
  const reservedLeafShoots = new Set<BranchRecord>(sortedByHeight.slice(0, 2))
  const flowerTipSet = new Set<BranchRecord>()
  const flowerBalls: { center: Vector3; radius: number; branch: BranchRecord }[] = []

  const radiusSchedule = [0.138, 0.130, 0.112, 0.104, 0.086, 0.078, 0.092, 0.082]

  for (const br of branches) {
    if (flowerBalls.length >= ballCountTarget) break
    if (reservedLeafShoots.has(br)) continue
    // Seat ball snugly near tip (slightly lower than tip so cradling leaf collar hugs its base!)
    const candidateCenter = br.tip.clone().add(new Vector3(0, 0.015, 0))
    const rHere = radiusSchedule[flowerBalls.length % radiusSchedule.length] * (shrubW / 0.70) * (0.94 + random() * 0.12)
    const tooClose = flowerBalls.some(other => other.center.distanceTo(candidateCenter) < (other.radius + rHere) * 1.24)
    if (tooClose) continue
    flowerBalls.push({ center: candidateCenter, radius: rHere, branch: br })
    flowerTipSet.add(br)
  }

  // Helper: deflect any leaf direction cleanly away from hydrangea flower balls so leaves CRADLE blooms instead of stabbing through!
  const avoidFlowerBalls = (socket: Vector3, dir: Vector3, size: number): Vector3 | null => {
    const outDir = dir.clone().normalize()
    for (const ball of flowerBalls) {
      // Skip if the socket itself is buried deep inside a flower ball
      if (socket.distanceTo(ball.center) < ball.radius * 0.85) return null
      const midPt = socket.clone().addScaledVector(outDir, size * 0.52)
      const tipPt = socket.clone().addScaledVector(outDir, size * 0.92)
      const clearR = ball.radius * 1.24
      for (const testPt of [midPt, tipPt]) {
        const toPt = testPt.clone().sub(ball.center)
        const dist = toPt.length()
        if (dist < clearR) {
          // Deflect leaf cleanly outward & slightly downward underneath the flower cluster
          const push = toPt.lengthSq() > 1e-6 ? toPt.normalize() : new Vector3(0, -1, 0)
          push.y = Math.min(push.y, -0.35)
          outDir.addScaledVector(push, (clearR - dist) / Math.max(0.08, size) * 2.4).normalize()
        }
      }
    }
    return outDir
  }

  // 3. Emit opposite/decussate pairs of INDIVIDUAL 3D sculpted serrated hydrangea leaves along every stem
  for (const br of branches) {
    const hasBall = flowerTipSet.has(br)
    const nodes = br.isPrimary ? 3 : 2
    const tMax = hasBall ? 0.80 : 0.94
    const tMin = br.isPrimary ? 0.18 : 0.24
    for (let ni = 0; ni < nodes; ni++) {
      const t = MathUtils.lerp(tMin, tMax, ni / Math.max(1, nodes - 1))
      const fIdx = t * (br.spine.length - 1)
      const i0 = Math.floor(fIdx), i1 = Math.min(br.spine.length - 1, i0 + 1)
      const posOnStem = br.spine[i0].clone().lerp(br.spine[i1], fIdx - i0)
      const stemTan = br.spine[i1].clone().sub(br.spine[Math.max(0, i0 - 1)]).normalize()
      const right = new Vector3().crossVectors(UP, stemTan)
      if (right.lengthSq() < 1e-5) right.set(1, 0, 0)
      right.normalize()
      const ortho = new Vector3().crossVectors(stemTan, right).normalize()
      const rotBase = (ni % 2 === 0 ? 0 : Math.PI * 0.5) + (random() - 0.5) * 0.35
      const hFrac = MathUtils.clamp(posOnStem.y / Math.max(0.2, shrubH), 0, 1)
      const nodeSize = leafSizeBase * (1.14 - t * 0.22) * (br.isPrimary ? 1.0 : 0.88) * (0.90 + random() * 0.18)

      for (const sideSign of [-1, 1]) {
        const a = rotBase + (sideSign < 0 ? Math.PI : 0)
        const radialDir = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(ortho, Math.sin(a)).normalize()
        const rawDir = radialDir.clone().multiplyScalar(0.84).addScaledVector(br.outDir, 0.38).addScaledVector(UP, 0.04 - t * 0.20).normalize()
        const safeDir = avoidFlowerBalls(posOnStem, rawDir, nodeSize)
        if (!safeDir) continue
        emitSingleLeaf(posOnStem, safeDir, nodeSize, hFrac, 0.86 + hFrac * 0.18)
        leaves++
      }
    }
    if (!hasBall) {
      const hFrac = MathUtils.clamp(br.tip.y / Math.max(0.2, shrubH), 0, 1)
      const rawTip = br.outDir.clone().multiplyScalar(0.82).addScaledVector(UP, 0.38).normalize()
      const safeTip = avoidFlowerBalls(br.tip, rawTip, leafSizeBase * 0.88)
      if (safeTip) {
        emitSingleLeaf(br.tip, safeTip, leafSizeBase * 0.88, hFrac, 1.04)
        leaves++
      }
    }
  }

  // Add a lush 4-leaf downward-cradling green collar directly underneath every hydrangea pom-pom so balls rest on foliage!
  for (const ball of flowerBalls) {
    const collarBase = ball.center.clone().add(new Vector3(0, -ball.radius * 0.72, 0))
    const hFrac = MathUtils.clamp(collarBase.y / Math.max(0.2, shrubH), 0, 1)
    const baseYaw = random() * Math.PI * 2
    for (let k = 0; k < 4; k++) {
      const a = baseYaw + (k / 4) * Math.PI * 2 + (random() - 0.5) * 0.28
      const dir = new Vector3(Math.cos(a) * 0.94, -0.26 - random() * 0.14, Math.sin(a) * 0.94).normalize()
      const leafSock = collarBase.clone().add(new Vector3(Math.cos(a) * ball.radius * 0.42, 0, Math.sin(a) * ball.radius * 0.42))
      emitSingleLeaf(leafSock, dir, leafSizeBase * (0.94 + random() * 0.16), hFrac, 0.95)
      leaves++
    }
  }

  // 4. Emit TRUE 3D HEMISPHERICAL POM-POM HYDRANGEA CLUSTERS (luminous core + 34-44 plush 3D cupped 4-petal florets!)
  const fSeg = opt.flatCards ? 1 : 2 // 2x2 cupped petal card (8 tris/floret)
  const fStride = fSeg + 1
  for (let bi = 0; bi < flowerBalls.length; bi++) {
    const ball = flowerBalls[bi]
    // Luminous shaded dome core (outward-wound!) completely eliminates hollow sky gaps between florets
    appendLowPolyCoreDome(ball.center, ball.radius * 0.80, coreBotCol, coreTopCol, cPos, cNor, cUv, cCol, cIdx)

    const countHere = Math.max(26, Math.round(floretsPerBall * (1.18 + (ball.radius / 0.12) * 0.25)))
    const floretSize = ball.radius * 0.78
    const lobePhase = bi * 1.7 + random() * 2.0
    for (let fi = 0; fi < countHere; fi++) {
      // Fibonacci spiral distribution across full upper ~82% of plush domed hydrangea cluster
      const uFrac = (fi + 0.5) / countHere
      const sinPhi = MathUtils.lerp(-0.42, 0.99, uFrac)
      const cosPhi = Math.sqrt(Math.max(0, 1 - sinPhi * sinPhi))
      const theta = fi * GOLDEN + bi * 2.1 + (random() - 0.5) * 0.20

      const surfN = new Vector3(cosPhi * Math.cos(theta), sinPhi, cosPhi * Math.sin(theta)).normalize()
      // Subtle 3-lobe organic hydrangea puffiness so silhouette reads as organic flower cloud, not rigid golf ball!
      const lobeMod = 1 + 0.10 * Math.sin(theta * 3 + lobePhase) * cosPhi + (random() - 0.5) * 0.10
      const rad = ball.radius * 0.94 * lobeMod
      const fCenter = ball.center.clone().add(new Vector3(surfN.x * rad, surfN.y * rad * 0.86, surfN.z * rad))

      // Tangent plane orthogonal to sphere normal + random floret spin around normal
      const ref = Math.abs(surfN.y) < 0.9 ? UP : new Vector3(1, 0, 0)
      const tU = new Vector3().crossVectors(ref, surfN).normalize()
      const tV = new Vector3().crossVectors(surfN, tU).normalize()
      const spin = random() * Math.PI * 2
      const cs = Math.cos(spin), ss = Math.sin(spin)
      const axU = tU.clone().multiplyScalar(cs).addScaledVector(tV, ss)
      const axV = tV.clone().multiplyScalar(cs).addScaledVector(tU, -ss)

      // Pick 1 of the 4 quadrants in our 2x2 hand-painted hydrangea floret atlas!
      const cell = Math.floor(random() * 4)
      const colCell = cell % 2
      const rowCell = Math.floor(cell / 2)
      const u0 = colCell * 0.5 + 0.015, u1 = (colCell + 1) * 0.5 - 0.015
      const v0 = rowCell * 0.5 + 0.015, v1 = (rowCell + 1) * 0.5 - 0.015

      const sz = floretSize * (0.86 + random() * 0.28)
      const cupDepth = sz * 0.14
      // Soft luminous spherical shading: cool periwinkle underneath -> bright pale lavender-blue on sunlit top
      const upFactor = MathUtils.clamp(surfN.y * 0.5 + 0.5, 0, 1)
      const jitter = 0.95 + random() * 0.10
      tmpCol.copy(flowerInnerCol).lerp(flowerOuterCol, upFactor).multiplyScalar((0.84 + 0.22 * upFactor) * jitter)

      const baseVert = fPos.length / 3
      for (let ry = 0; ry <= fSeg; ry++) {
        const ly = ry / fSeg // 0..1
        const sy = ly * 2 - 1 // -1..1
        for (let rx = 0; rx <= fSeg; rx++) {
          const lx = rx / fSeg // 0..1
          const sx = lx * 2 - 1 // -1..1
          const r2 = Math.min(1, sx * sx + sy * sy)
          // Gentle petal saucer cupping curving back toward sphere core at petal tips!
          const lift = (1 - r2) * cupDepth
          const p = fCenter.clone()
            .addScaledVector(axU, sx * sz * 0.5)
            .addScaledVector(axV, sy * sz * 0.5)
            .addScaledVector(surfN, lift)
          const nVert = surfN.clone()
            .addScaledVector(axU, sx * 0.26)
            .addScaledVector(axV, sy * 0.26)
            .normalize()

          fPos.push(p.x, p.y, p.z)
          fNor.push(nVert.x, nVert.y, nVert.z)
          fUv.push(MathUtils.lerp(u0, u1, lx), MathUtils.lerp(v0, v1, ly))
          fCol.push(Math.min(1.12, tmpCol.r), Math.min(1.12, tmpCol.g), Math.min(1.12, tmpCol.b))
          fCen.push(fCenter.x, fCenter.y, fCenter.z)
          fCor.push(sx * sz * 0.5, sy * sz * 0.5)
        }
      }
      for (let ry = 0; ry < fSeg; ry++) {
        for (let rx = 0; rx < fSeg; rx++) {
          const a = baseVert + ry * fStride + rx
          const b = a + 1
          const d = a + fStride
          const e = d + 1
          fIdx.push(a, b, e, a, e, d)
        }
      }
      flowers++
    }
  }

  const mkGeo = (pos: number[], nor: number[], uv: number[], col: number[], idx: number[], cen?: number[], cor?: number[]) => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
    if (cen && cor) {
      g.setAttribute('aCenter', new BufferAttribute(new Float32Array(cen), 3))
      g.setAttribute('aCorner', new BufferAttribute(new Float32Array(cor), 2))
    }
    g.setIndex(idx)
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }

  return {
    stemGeometry: mkGeo(sPos, sNor, sUv, sCol, sIdx),
    leafGeometry: mkGeo(lPos, lNor, lUv, lCol, lIdx, lCen, lCor),
    flowerGeometry: mkGeo(fPos, fNor, fUv, fCol, fIdx, fCen, fCor),
    coreGeometry: mkGeo(cPos, cNor, cUv, cCol, cIdx),
    stems,
    leaves,
    flowers,
  }
}

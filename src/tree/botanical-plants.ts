// Unified High-Craft Stylized Botanical Plant Generators (16 Studio Archetypes):
// - fern-clump          (01 大蕨类 A, 03 蕨类 B)
// - blade-clump         (02 大型草丛 A, 06/07/08 草丛 A/B/C, 09 小草丛)
// - rosette-shrub       (04 阔叶灌木 A, 05 阔叶灌木 B -> delegates to v7 rosette-shrub.ts)
// - hydrangea-shrub     (10 绣球花丛 -> delegates to v3 herb-shrub.ts)
// - cosmos-shrub        (11 紫花小灌木: airy branching stems + ovate leaves + 3D cupped pink-lavender cosmos blooms)
// - flower-groundcover  (12 小花地被: plush low leafy dome + 3D cupped violet-blue 5-petal wildflowers)
// - clover-groundcover  (13 三叶草地被, 14 小叶蔓延地被: multi-cluster 3D tilted clovers/rosettes on real curved stems)
// - fine-herb           (15 细叶草 A, 16 细叶草 B: arching/upright slender green stalks + dense 3D narrow lance leaves)
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import { sampleHorizontalSlots, type BotanicalLayout } from './botanical-layout'
import type { BotanicalTextureKey } from './botanical-textures'
import type { CrownEnvelope } from './envelope'
import { buildHerbShrub } from './herb-shrub'
import { buildRosetteShrub } from './rosette-shrub'
import { defaultBotanical, type BotanicalSpec, type TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export interface BuiltBotanicalPlant {
  stemGeometry?: BufferGeometry
  leafGeometry: BufferGeometry
  flowerGeometry?: BufferGeometry
  coreGeometry?: BufferGeometry
  leafTextureKey: BotanicalTextureKey
  flowerTextureKey?: BotanicalTextureKey
  alphaCutoff: number
  stems: number
  leaves: number
  flowers: number
}

interface MeshBuf {
  pos: number[]
  nor: number[]
  uv: number[]
  col: number[]
  cen: number[]
  cor: number[]
  idx: number[]
}

function makeBuf(): MeshBuf {
  return { pos: [], nor: [], uv: [], col: [], cen: [], cor: [], idx: [] }
}

function finishBuf(b: MeshBuf, withCardAttrs: boolean): BufferGeometry | undefined {
  if (b.idx.length === 0) return undefined
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3))
  if (withCardAttrs && b.cen.length > 0) {
    g.setAttribute('aCenter', new BufferAttribute(new Float32Array(b.cen), 3))
    g.setAttribute('aCorner', new BufferAttribute(new Float32Array(b.cor), 2))
  }
  g.setIndex(b.idx)
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

function appendTube(
  buf: MeshBuf,
  spine: Vector3[],
  rStart: number,
  rEnd: number,
  radialSegs: number,
  colBase: Color,
  colTip: Color,
) {
  const rings = spine.length
  if (rings < 2) return
  const baseVert = buf.pos.length / 3
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
      buf.pos.push(p.x, p.y, p.z)
      buf.nor.push(n.x, n.y, n.z)
      buf.uv.push(s / radialSegs, f)
      buf.col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let s = 0; s < radialSegs; s++) {
      const sn = (s + 1) % radialSegs
      const a = baseVert + i * radialSegs + s
      const b = baseVert + i * radialSegs + sn
      const d = baseVert + (i + 1) * radialSegs + s
      const e = baseVert + (i + 1) * radialSegs + sn
      buf.idx.push(a, b, e, a, e, d)
    }
  }
}

/** Emits a single 3D curved/cupped leaf anchored at `socket`, strictly right-handed upward normals & CCW winding. */
function appendCurvedLeaf(
  buf: MeshBuf,
  socket: Vector3,
  dir: Vector3,
  length: number,
  width: number,
  arch: number,
  droop: number,
  cup: number,
  rollRad: number,
  segU: number,
  segV: number,
  colBase: Color,
  colTip: Color,
  domeCenter: Vector3,
  spherize: number,
  minY = 0.012,
) {
  const fwd = dir.clone().normalize()
  let rawSide = new Vector3().crossVectors(fwd, UP)
  if (rawSide.lengthSq() < 1e-5) rawSide = new Vector3(1, 0, 0)
  rawSide.normalize()
  const rawUp = new Vector3().crossVectors(rawSide, fwd).normalize()
  const side = rawSide.clone().multiplyScalar(Math.cos(rollRad)).addScaledVector(rawUp, Math.sin(rollRad)).normalize()
  const up = new Vector3().crossVectors(side, fwd).normalize()

  const colsU = segU + 1, rowsV = segV + 1
  const baseVert = buf.pos.length / 3
  const pts: Vector3[] = []
  const center = socket.clone().addScaledVector(fwd, length * 0.48)
  for (let rv = 0; rv < rowsV; rv++) {
    const v = rv / segV
    const along = v * length
    const lift = Math.sin(Math.PI * v) * arch * length * 0.36 - v * v * droop * length * 0.48
    for (let cu = 0; cu < colsU; cu++) {
      const u = cu / segU
      const s = 2 * u - 1
      const cLift = cup * length * 0.24 * (s * s - 0.34) * Math.sin(Math.PI * v)
      const p = socket.clone()
        .addScaledVector(fwd, along)
        .addScaledVector(side, s * width * 0.5)
        .addScaledVector(up, lift + cLift)
      if (p.y < minY) p.y = minY
      pts.push(p)
    }
  }

  const vA = new Vector3(), vB = new Vector3(), nL = new Vector3(), nD = new Vector3(), tmpC = new Color()
  for (let rv = 0; rv < rowsV; rv++) {
    const v = rv / segV
    tmpC.copy(colBase).lerp(colTip, v)
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
      nD.y = Math.max(0.24, nD.y); nD.normalize()
      nL.lerp(nD, spherize).normalize()

      buf.pos.push(p.x, p.y, p.z)
      buf.nor.push(nL.x, nL.y, nL.z)
      buf.uv.push(u, v)
      buf.col.push(Math.min(1.16, tmpC.r), Math.min(1.16, tmpC.g), Math.min(1.16, tmpC.b))
      buf.cen.push(center.x, center.y, center.z)
      buf.cor.push((u - 0.5) * width, (v - 0.5) * length)
    }
  }
  for (let rv = 0; rv < segV; rv++) {
    for (let cu = 0; cu < segU; cu++) {
      const a = baseVert + rv * colsU + cu
      const b = a + 1
      const d = a + colsU
      const e = d + 1
      buf.idx.push(a, b, e, a, e, d)
    }
  }
}

/** Emits a 2x2 cupped top-down rosette / blossom head sampling 1 quadrant of a 2x2 hand-painted PNG atlas. */
function appendCuppedAtlasQuad(
  buf: MeshBuf,
  center: Vector3,
  surfN: Vector3,
  size: number,
  cupDepth: number,
  spinRad: number,
  quadrant: number,
  colCenter: Color,
  colRim: Color,
  seg: number,
) {
  const n = surfN.clone().normalize()
  const ref = Math.abs(n.y) < 0.9 ? UP : new Vector3(1, 0, 0)
  const tU = new Vector3().crossVectors(ref, n).normalize()
  const tV = new Vector3().crossVectors(n, tU).normalize()
  const cs = Math.cos(spinRad), ss = Math.sin(spinRad)
  const axU = tU.clone().multiplyScalar(cs).addScaledVector(tV, ss)
  const axV = tV.clone().multiplyScalar(cs).addScaledVector(tU, -ss)

  const colCell = quadrant % 2
  const rowCell = Math.floor(quadrant / 2) % 2
  const u0 = colCell * 0.5 + 0.015, u1 = (colCell + 1) * 0.5 - 0.015
  const v0 = rowCell * 0.5 + 0.015, v1 = (rowCell + 1) * 0.5 - 0.015

  const stride = seg + 1
  const baseVert = buf.pos.length / 3
  const tmpC = new Color()
  for (let ry = 0; ry <= seg; ry++) {
    const ly = ry / seg
    const sy = ly * 2 - 1
    for (let rx = 0; rx <= seg; rx++) {
      const lx = rx / seg
      const sx = lx * 2 - 1
      const r2 = Math.min(1, (sx * sx + sy * sy) * 0.5)
      // Gentle bowl cup (positive cupDepth lifts outer petals upward like an open flower cup; negative domes like a clover!)
      const lift = r2 * cupDepth
      const p = center.clone()
        .addScaledVector(axU, sx * size * 0.5)
        .addScaledVector(axV, sy * size * 0.5)
        .addScaledVector(n, lift)
      if (p.y < 0.008) p.y = 0.008
      const nv = n.clone()
        .addScaledVector(axU, sx * (cupDepth >= 0 ? -0.18 : 0.20))
        .addScaledVector(axV, sy * (cupDepth >= 0 ? -0.18 : 0.20))
        .normalize()
      tmpC.copy(colCenter).lerp(colRim, Math.sqrt(r2))
      buf.pos.push(p.x, p.y, p.z)
      buf.nor.push(nv.x, nv.y, nv.z)
      buf.uv.push(MathUtils.lerp(u0, u1, lx), MathUtils.lerp(v0, v1, ly))
      buf.col.push(Math.min(1.16, tmpC.r), Math.min(1.16, tmpC.g), Math.min(1.16, tmpC.b))
      buf.cen.push(center.x, center.y, center.z)
      buf.cor.push(sx * size * 0.5, sy * size * 0.5)
    }
  }
  for (let ry = 0; ry < seg; ry++) {
    for (let rx = 0; rx < seg; rx++) {
      const a = baseVert + ry * stride + rx
      const b = a + 1
      const d = a + stride
      const e = d + 1
      buf.idx.push(a, b, e, a, e, d)
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Arching Sculpted Fern Clump (01 大蕨类 A, 03 蕨类 B) & Grass/Strap Clump (02, 06, 07, 08, 09)
// ---------------------------------------------------------------------------
function buildFountainClump(spec: TreeSpec, env: CrownEnvelope, b: BotanicalSpec, isFern: boolean): BuiltBotanicalPlant {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, isFern ? 3101 : 3209))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.38, (1 / keepRatio) ** 0.34) : 1
  const totalCount = Math.max(6, Math.round(b.count * keepRatio))

  const leafBuf = makeBuf()
  const colInner = new Color(b.tintInner)
  const colOuter = new Color(b.tintOuter)
  const domeCenter = new Vector3(0, b.height * 0.32, 0)

  const segU = opt.flatCards ? 1 : 2
  const segV = opt.flatCards ? 3 : (isFern ? 7 : 6)
  const colsU = segU + 1, rowsV = segV + 1

  // 3 graceful concentric fountain rings:
  // Steep upright launch near the heart -> generous rising arch -> smooth sweeping outward/downward cascade!
  const rings = isFern
    ? [
      { frac: 0.26, rScale: 0.24, lenMin: 0.76, lenMax: 0.92, launchMin: 6,  launchMax: 16, bendMul: 0.60, shade: 0.90 },
      { frac: 0.42, rScale: 0.60, lenMin: 0.92, lenMax: 1.08, launchMin: 16, launchMax: 28, bendMul: 0.92, shade: 1.00 },
      { frac: 0.32, rScale: 1.00, lenMin: 0.80, lenMax: 0.96, launchMin: 28, launchMax: 42, bendMul: 1.12, shade: 0.94 },
    ]
    : [
      { frac: 0.28, rScale: 0.24, lenMin: 0.84, lenMax: 1.04, launchMin: 6,  launchMax: 16, bendMul: 0.68, shade: 0.92 },
      { frac: 0.42, rScale: 0.60, lenMin: 0.90, lenMax: 1.06, launchMin: 16, launchMax: 28, bendMul: 1.00, shade: 1.00 },
      { frac: 0.30, rScale: 1.00, lenMin: 0.70, lenMax: 0.88, launchMin: 26, launchMax: 42, bendMul: 1.24, shade: 0.94 },
    ]

  let leaves = 0
  let globalIdx = 0
  const hj = MathUtils.clamp(b.heightJitter ?? 0.36, 0, 1)
  const lj = MathUtils.clamp(b.lateralJitter ?? 0.46, 0, 1)
  const layout: BotanicalLayout = b.layout ?? (isFern ? 'ring' : 'phyllotaxis')
  const areaRad = Math.max(b.spread * 1.45, b.leafSize * MathUtils.lerp(0.16, 0.34, lj))
  const slots = sampleHorizontalSlots({
    layout,
    count: totalCount,
    radius: b.spread,
    areaRadius: areaRad,
    lateralJitter: lj,
    random,
  }).sort((a, z) => a.group - z.group || a.rFrac - z.rFrac)

  const placedMids: Vector3[] = []
  const tmpC = new Color(), vA = new Vector3(), vB = new Vector3(), nL = new Vector3(), nD = new Vector3()

  const buildSpine = (
    origin: Vector3,
    outHoriz: Vector3,
    baseSide: Vector3,
    len: number,
    launchRad: number,
    bendTotal: number,
    sideSway: number,
  ) => {
    const spine: Vector3[] = [origin]
    const tans: Vector3[] = []
    const step = len / segV
    for (let rv = 1; rv <= segV; rv++) {
      const f = (rv - 0.5) / segV
      const theta = Math.min(Math.PI * 0.86, Math.max(0.06, launchRad + bendTotal * Math.pow(f, isFern ? 1.32 : 1.38)))
      const tan = new Vector3(
        outHoriz.x * Math.sin(theta) + baseSide.x * (sideSway / Math.max(0.1, len)) * f,
        Math.cos(theta),
        outHoriz.z * Math.sin(theta) + baseSide.z * (sideSway / Math.max(0.1, len)) * f,
      ).normalize()
      tans.push(tan)
      const nextPt = spine[rv - 1].clone().addScaledVector(tan, step)
      if (nextPt.y < 0.015) nextPt.y = 0.015
      spine.push(env.deform(nextPt, rv / segV))
    }
    tans.push(tans[tans.length - 1].clone())
    return { spine, tans }
  }

  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si]
    globalIdx++
    const ri = MathUtils.clamp(slot.group, 0, rings.length - 1)
    const rd = rings[ri]
    let angle = slot.angle
    // Stratified alternating + random vertical tier (-1..+1) so adjacent leaves sit on distinct height shells!
    const tier = MathUtils.clamp((si % 2 === 0 ? 1 : -1) * 0.58 + (random() - 0.5) * 0.84, -1, 1)
    const len = b.leafSize * MathUtils.lerp(rd.lenMin, rd.lenMax, random()) * (1 + tier * hj * 0.24) * scaleBoost
    const width = len * b.leafAspect * (0.92 + random() * 0.16)
    let launchRad = MathUtils.degToRad(MathUtils.lerp(rd.launchMin, rd.launchMax, random()) - tier * hj * 14)
    if (layout === 'fan') {
      // Fan silhouettes open slightly flatter on outer wings and stand taller at center!
      launchRad = MathUtils.degToRad(MathUtils.lerp(8, 44, slot.rFrac) - tier * hj * 10)
    }
    launchRad = MathUtils.clamp(launchRad, MathUtils.degToRad(4), MathUtils.degToRad(58))
    // Total fountain bend in radians so inner fronds arch gracefully & outer fronds cascade over past horizontal!
    let bendTotal = (b.arch * 1.48 + b.droop * 1.05) * rd.bendMul * (0.88 + random() * 0.24) * (1 - tier * hj * 0.28)
    let sideSway = (slot.sideSign * (0.35 + random() * 0.65) * lj * 0.18 + (random() - 0.5) * 0.08) * len
    const twistMax = MathUtils.degToRad((slot.sideSign * lj * 10 + (random() - 0.5) * (isFern ? 16 : 22)))

    let outHoriz = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    let baseSide = new Vector3().crossVectors(outHoriz, UP).normalize()
    const baseY = Math.max(0, (tier * 0.5 + 0.5) * hj * Math.min(0.075, b.height * 0.11) * (ri === 2 ? 0.45 : 1.0))
    const origin = new Vector3(slot.x, baseY, slot.z)

    // Integrate graceful fountain spine + 2-stage anti-overlap solver:
    // Stage 1: Horizontal left-right lateral push (lj) opens stacked top-down azimuth overlaps
    // Stage 2: Vertical tier lift/drop (hj) separates any remaining close blades in height!
    let { spine, tans } = buildSpine(origin, outHoriz, baseSide, len, launchRad, bendTotal, sideSway)
    const midIdx = Math.max(1, Math.min(segV - 1, Math.round(segV * 0.45)))

    if (lj > 0.04) {
      const horizClear = width * MathUtils.lerp(0.32, 0.62, lj)
      const vertOverlap = width * 0.55
      for (let iter = 0; iter < 2; iter++) {
        const mid = spine[midIdx]
        let latPush = 0
        for (const prev of placedMids) {
          const dx = mid.x - prev.x, dz = mid.z - prev.z
          const dh = Math.hypot(dx, dz)
          if (dh < horizClear && Math.abs(mid.y - prev.y) < vertOverlap) {
            // Signed horizontal side relative to outHoriz: push away from neighbor left or right!
            const cross = outHoriz.x * dz - outHoriz.z * dx
            latPush += (cross >= 0 ? 1 : -1) * (1 - dh / Math.max(1e-4, horizClear))
          }
        }
        if (Math.abs(latPush) < 0.02) break
        const sgn = latPush > 0 ? 1 : -1
        const swingRad = MathUtils.degToRad(Math.min(18, (6 + lj * 10) * Math.min(1.5, Math.abs(latPush))))
        angle += sgn * swingRad
        sideSway += sgn * len * (0.04 + lj * 0.05)
        outHoriz = new Vector3(Math.cos(angle), 0, Math.sin(angle))
        baseSide = new Vector3().crossVectors(outHoriz, UP).normalize()
        const rebuilt = buildSpine(origin, outHoriz, baseSide, len, launchRad, bendTotal, sideSway)
        spine = rebuilt.spine
        tans = rebuilt.tans
      }
    }

    if (hj > 0.04) {
      const horizClear = width * 0.42
      const vertClear = width * (0.18 + hj * 0.34)
      for (let iter = 0; iter < 2; iter++) {
        const mid = spine[midIdx]
        let pushDir = 0
        for (const prev of placedMids) {
          const dh = Math.hypot(mid.x - prev.x, mid.z - prev.z)
          const dy = mid.y - prev.y
          if (dh < horizClear && Math.abs(dy) < vertClear) {
            pushDir += dy >= 0 ? 1 : -1
          }
        }
        if (pushDir === 0) break
        const sgn = pushDir > 0 ? 1 : -1
        launchRad = MathUtils.clamp(launchRad - sgn * MathUtils.degToRad(5.5 + hj * 5), MathUtils.degToRad(4), MathUtils.degToRad(62))
        bendTotal = Math.max(0.22, bendTotal * (1 - sgn * (0.08 + hj * 0.10)))
        const rebuilt = buildSpine(origin, outHoriz, baseSide, len, launchRad, bendTotal, sideSway)
        spine = rebuilt.spine
        tans = rebuilt.tans
      }
    }
    placedMids.push(spine[midIdx].clone())

    const pts: Vector3[] = []
    const ups: Vector3[] = []
    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV
      const tan = tans[rv]
      const roll = twistMax * v
      let rSide = new Vector3().crossVectors(tan, UP)
      if (rSide.lengthSq() < 1e-5) rSide = baseSide.clone()
      rSide.normalize()
      const rUp = new Vector3().crossVectors(rSide, tan).normalize()
      const side = rSide.clone().multiplyScalar(Math.cos(roll)).addScaledVector(rUp, Math.sin(roll)).normalize()
      const up = new Vector3().crossVectors(side, tan).normalize()
      ups.push(up)
      // Fullness profile stays full through the middle so texture silhouette never gets pinched!
      const wHere = width * (isFern ? 1.0 : MathUtils.lerp(0.86, 1.04, Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.1))))
      for (let cu = 0; cu < colsU; cu++) {
        const u = cu / segU
        const s = 2 * u - 1
        // Crisp botanical V-fold trough along central midrib/rachis (catches realistic directional light across halves!)
        const cupLift = b.cup * width * 0.34 * (Math.abs(s) - 0.35) * Math.sin(Math.PI * MathUtils.clamp(v * 0.92 + 0.04, 0, 1))
        const p = spine[rv].clone()
          .addScaledVector(side, s * wHere * 0.5)
          .addScaledVector(up, cupLift)
        if (p.y < 0.012) p.y = 0.012
        pts.push(p)
      }
    }

    const baseVert = leafBuf.pos.length / 3
    const center = spine[Math.floor(segV * 0.5)]
    const jitter = 0.94 + random() * 0.12

    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV
      const up = ups[rv]
      // Soft translucent stylized base AO (keeps lower emerald blades rich green, never pitch-black!)
      const ao = 1 - b.aoStrength * (1 - v) * (ri === 0 ? 0.34 : 0.26)
      tmpC.copy(colInner).lerp(colOuter, MathUtils.clamp(v * 1.12 + (ri === 1 ? 0.16 : 0.08), 0, 1))
      tmpC.multiplyScalar(ao * rd.shade * jitter)

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
        // Keep true geometric normal on the steep basal half (so DoubleSide front blades point OUTWARD toward light,
        // never canceling into (0,+1,0) whose backface flips to pitch-black (0,-1,0)!), and gently sky-soften the arching upper crown.
        const topSkyBlend = MathUtils.smoothstep(v, 0.38, 0.88) * (isFern ? 0.30 : 0.24)
        if (topSkyBlend > 0.001) {
          nD.subVectors(p, domeCenter)
          if (nD.lengthSq() < 1e-6) nD.copy(UP)
          else nD.normalize()
          nD.y = Math.max(0.55, nD.y); nD.normalize()
          nL.lerp(nD, topSkyBlend).normalize()
        }

        leafBuf.pos.push(p.x, p.y, p.z)
        leafBuf.nor.push(nL.x, nL.y, nL.z)
        leafBuf.uv.push(u, v)
        leafBuf.col.push(Math.min(1.16, tmpC.r), Math.min(1.16, tmpC.g), Math.min(1.16, tmpC.b))
        leafBuf.cen.push(center.x, center.y, center.z)
        leafBuf.cor.push((u - 0.5) * width, (v - 0.5) * len)
      }
    }

    for (let rv = 0; rv < segV; rv++) {
      for (let cu = 0; cu < segU; cu++) {
        const a = baseVert + rv * colsU + cu
        const bIdx = a + 1
        const d = a + colsU
        const e = d + 1
        leafBuf.idx.push(a, bIdx, e, a, e, d)
      }
    }
    leaves++
  }
  void globalIdx

  return {
    leafGeometry: finishBuf(leafBuf, true)!,
    leafTextureKey: b.leafTexture,
    alphaCutoff: b.alphaCutoff,
    stems: 0,
    leaves,
    flowers: 0,
  }
}

// ---------------------------------------------------------------------------
// 2. Cosmos Flowering Shrub (11 紫花小灌木): Airy upright stems + small ovate leaves + 3D cupped pink-lavender blossoms
// ---------------------------------------------------------------------------
function buildCosmosShrub(spec: TreeSpec, env: CrownEnvelope, b: BotanicalSpec): BuiltBotanicalPlant {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 3311))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.36, (1 / keepRatio) ** 0.32) : 1

  const stemBuf = makeBuf()
  const leafBuf = makeBuf()
  const flowerBuf = makeBuf()

  const stemBase = new Color(b.stemTint).multiplyScalar(0.55)
  const stemTip = new Color(b.stemTint).lerp(new Color('#74b23c'), 0.45)
  const leafInner = new Color(b.tintInner)
  const leafOuter = new Color(b.tintOuter)
  const flwInner = new Color(b.flowerTintInner)
  const flwOuter = new Color(b.flowerTintOuter)
  const domeCenter = new Vector3(0, b.height * 0.42, 0)

  const stemCount = Math.max(6, Math.round(b.stemCount * keepRatio))
  const stemSegs = opt.woodDetail < 0.5 ? 3 : 4
  const segU = opt.flatCards ? 1 : 2
  const segV = opt.flatCards ? 1 : 3
  const fSeg = opt.flatCards ? 1 : 2

  interface Shoot { spine: Vector3[]; out: Vector3; tip: Vector3; isPrimary: boolean; angle: number }
  const shoots: Shoot[] = []
  let stems = 0, leaves = 0, flowers = 0

  const hj = MathUtils.clamp(b.heightJitter ?? 0.36, 0, 1)
  const lj = MathUtils.clamp(b.lateralJitter ?? 0.42, 0, 1)
  const hjMul = MathUtils.lerp(0.20, 2.00, hj)
  const stemSlots = sampleHorizontalSlots({
    layout: b.layout ?? 'phyllotaxis',
    count: stemCount,
    radius: b.spread * 0.26,
    areaRadius: b.spread * 0.62,
    lateralJitter: lj,
    random,
  })
  for (let i = 0; i < stemSlots.length; i++) {
    const slot = stemSlots[i]
    const isInner = slot.group === 0
    const angle = slot.angle
    const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const len = b.height * MathUtils.clamp((isInner ? 0.96 : 0.78) + (random() - 0.5) * 0.26 * hjMul, 0.42, 1.38)
    const leanRad = MathUtils.degToRad(isInner ? 10 + random() * 14 : 24 + random() * 20)

    const rings = 6
    const spine: Vector3[] = [new Vector3(slot.x, 0, slot.z)]
    const sideAxis = new Vector3().crossVectors(out, UP).normalize()
    for (let k = 1; k < rings; k++) {
      const t = (k - 0.5) / (rings - 1)
      const aHere = leanRad + b.arch * t * t * 0.65
      const dir = UP.clone()
        .multiplyScalar(Math.cos(aHere))
        .addScaledVector(out, Math.sin(aHere))
        .addScaledVector(sideAxis, slot.sideSign * lj * 0.14 * t)
        .normalize()
      spine.push(env.deform(spine[k - 1].clone().addScaledVector(dir, len / (rings - 1)), k / (rings - 1)))
    }
    appendTube(stemBuf, spine, 0.0068, 0.0026, stemSegs, stemBase, stemTip)
    stems++
    shoots.push({ spine, out, tip: spine[spine.length - 1].clone(), isPrimary: true, angle })

    // Forked lateral flowering shoot on most primary stems
    if (random() < 0.78) {
      const fIdx = 2 + Math.floor(random() * 2)
      const origin = spine[fIdx].clone()
      const fYaw = angle + (i % 2 === 0 ? 1 : -1) * (0.55 + random() * 0.45)
      const fOut = new Vector3(Math.cos(fYaw), 0, Math.sin(fYaw))
      const fLen = len * (0.42 + random() * 0.20)
      const fSpine: Vector3[] = [origin]
      for (let k = 1; k < 4; k++) {
        const t = k / 3
        const aHere = MathUtils.degToRad(22 + t * 20)
        const dir = UP.clone().multiplyScalar(Math.cos(aHere)).addScaledVector(fOut, Math.sin(aHere)).normalize()
        fSpine.push(fSpine[k - 1].clone().addScaledVector(dir, fLen / 3))
      }
      appendTube(stemBuf, fSpine, 0.0042, 0.0022, stemSegs, stemBase, stemTip)
      stems++
      shoots.push({ spine: fSpine, out: fOut, tip: fSpine[fSpine.length - 1].clone(), isPrimary: false, angle: fYaw })
    }
  }

  // Emit airy opposite pairs of crisp 3D small ovate leaves along lower/mid 78% of each shoot
  const cBase = new Color(), cTip = new Color()
  for (const sh of shoots) {
    const nodes = sh.isPrimary ? 4 : 2
    for (let ni = 0; ni < nodes; ni++) {
      const t = MathUtils.lerp(0.18, 0.78, ni / Math.max(1, nodes - 1))
      const fi = t * (sh.spine.length - 1)
      const i0 = Math.floor(fi), i1 = Math.min(sh.spine.length - 1, i0 + 1)
      const pos = sh.spine[i0].clone().lerp(sh.spine[i1], fi - i0)
      const tan = sh.spine[i1].clone().sub(sh.spine[Math.max(0, i0 - 1)]).normalize()
      const right = new Vector3().crossVectors(tan, UP)
      if (right.lengthSq() < 1e-5) right.set(1, 0, 0)
      right.normalize()
      const ortho = new Vector3().crossVectors(right, tan).normalize()
      const rot = (ni % 2 === 0 ? 0 : Math.PI * 0.5) + (random() - 0.5) * 0.4
      const hFrac = MathUtils.clamp(pos.y / Math.max(0.2, b.height), 0, 1)
      const sz = b.leafSize * (1.08 - t * 0.28) * (0.88 + random() * 0.24) * scaleBoost
      const ao = 1 - b.aoStrength * (1 - hFrac) * 0.42
      cBase.copy(leafInner).lerp(leafOuter, hFrac * 0.65).multiplyScalar(ao)
      cTip.copy(leafInner).lerp(leafOuter, Math.min(1, hFrac * 0.75 + 0.35)).multiplyScalar(ao * 1.04)

      for (const sgn of [-1, 1]) {
        const a = rot + (sgn < 0 ? Math.PI : 0)
        const rDir = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(ortho, Math.sin(a)).normalize()
        const leafDir = rDir.clone().multiplyScalar(0.84).addScaledVector(sh.out, 0.34).addScaledVector(UP, 0.22 - t * 0.16).normalize()
        appendCurvedLeaf(leafBuf, pos, leafDir, sz, sz * b.leafAspect, b.arch, b.droop, b.cup, (random() - 0.5) * 0.3, segU, segV, cBase, cTip, domeCenter, 0.45)
        leaves++
      }
    }
  }

  // Crown the airy upper branch tips with 3D cupped upward-tilted pink-lavender cosmos blooms!
  const targetFlowers = Math.max(6, Math.round(b.flowerClusters * keepRatio))
  const ranked = [...shoots].sort((a, z) => z.tip.y - a.tip.y)
  const placedFlw: Vector3[] = []
  for (let i = 0; i < ranked.length && flowers < targetFlowers; i++) {
    const sh = ranked[i]
    const center = sh.tip.clone().add(new Vector3(0, 0.008, 0))
    if (placedFlw.some(p => p.distanceTo(center) < b.flowerSize * 0.85)) continue
    placedFlw.push(center)
    // Keep blooms predominantly skyward-facing (<=16 deg tilt) so zero dark backfaces appear from any 360° camera azimuth!
    const surfN = UP.clone().multiplyScalar(0.95).addScaledVector(sh.out, 0.22).add(new Vector3((random() - 0.5) * 0.12, 0, (random() - 0.5) * 0.12)).normalize()
    const sz = b.flowerSize * (0.86 + random() * 0.30) * scaleBoost
    const fColC = flwInner.clone().lerp(flwOuter, 0.72)
    const fColR = flwOuter.clone().multiplyScalar(0.98 + random() * 0.08)
    appendCuppedAtlasQuad(flowerBuf, center, surfN, sz, sz * 0.16, random() * Math.PI * 2, Math.floor(random() * 4), fColC, fColR, fSeg)
    flowers++
  }

  return {
    stemGeometry: finishBuf(stemBuf, false),
    leafGeometry: finishBuf(leafBuf, true)!,
    flowerGeometry: finishBuf(flowerBuf, true),
    leafTextureKey: b.leafTexture,
    flowerTextureKey: b.flowerTexture ?? 'pink-cosmos-2x2',
    alphaCutoff: b.alphaCutoff,
    stems,
    leaves,
    flowers,
  }
}

// ---------------------------------------------------------------------------
// 3. Flowering Groundcover Cushion (12 小花地被): Low lush mound of small ovate leaves + 3D cupped violet wildflowers
// ---------------------------------------------------------------------------
function buildFlowerGroundcover(spec: TreeSpec, env: CrownEnvelope, b: BotanicalSpec): BuiltBotanicalPlant {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 3412))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.34, (1 / keepRatio) ** 0.32) : 1

  const stemBuf = makeBuf()
  const leafBuf = makeBuf()
  const flowerBuf = makeBuf()

  const stemBase = new Color(b.stemTint).multiplyScalar(0.50)
  const stemTip = new Color(b.stemTint).lerp(new Color('#6eb438'), 0.38)
  const leafInner = new Color(b.tintInner)
  const leafOuter = new Color(b.tintOuter)
  const flwInner = new Color(b.flowerTintInner)
  const flwOuter = new Color(b.flowerTintOuter)
  const domeCenter = new Vector3(0, b.height * 0.32, 0)

  const stemSegs = 3
  const segU = opt.flatCards ? 1 : 2
  const segV = opt.flatCards ? 1 : 2
  const fSeg = opt.flatCards ? 1 : 2

  const targetLeaves = Math.max(24, Math.round(b.count * keepRatio))
  const targetFlowers = Math.max(10, Math.round(b.flowerClusters * keepRatio))
  const cBase = new Color(), cTip = new Color()

  let stems = 0, leaves = 0, flowers = 0

  // 1. Plush low mounded carpet of crisp 3D cupped small ovate leaves using chosen horizontal layout!
  const hj = MathUtils.clamp(b.heightJitter ?? 0.36, 0, 1)
  const lj = MathUtils.clamp(b.lateralJitter ?? 0.48, 0, 1)
  const layout: BotanicalLayout = b.layout ?? 'scatter'
  const leafSlots = sampleHorizontalSlots({
    layout,
    count: Math.round(targetLeaves * 1.45),
    radius: b.spread * 0.95,
    areaRadius: b.spread,
    lateralJitter: lj,
    random,
  })
  const placedLeafCenters: Vector3[] = []
  for (let i = 0; i < leafSlots.length && leaves < targetLeaves; i++) {
    const slot = leafSlots[i]
    const rFrac = MathUtils.clamp(Math.hypot(slot.x, slot.z) / Math.max(0.08, b.spread), 0, 1.15)
    const domeH = Math.sqrt(Math.max(0.05, 1 - Math.min(0.95, rFrac * rFrac * 0.86)))
    const ySpread = MathUtils.lerp(0.16, 1.05, hj)
    const y = b.height * domeH * MathUtils.clamp(0.55 + (random() - 0.5) * ySpread, 0.14, 1.18)
    const out = new Vector3(Math.cos(slot.angle), 0, Math.sin(slot.angle))
    const sock = env.deform(new Vector3(slot.x, Math.max(0.016, y), slot.z), domeH)
    const sz = b.leafSize * (0.86 + random() * 0.32) * scaleBoost
    const leafDir = out.clone().multiplyScalar(0.86).addScaledVector(UP, MathUtils.lerp(0.28, -0.24, Math.min(1, rFrac)) + (random() - 0.5) * 0.22).normalize()
    const mid = sock.clone().addScaledVector(leafDir, sz * 0.42)
    if (placedLeafCenters.some(p => p.distanceToSquared(mid) < (sz * MathUtils.lerp(0.26, 0.44, lj)) ** 2)) continue
    placedLeafCenters.push(mid)

    // Short basal petiole anchoring every 3rd leaf cleanly to the ground without leggy bare stems
    if (i % 3 === 0) {
      const root = new Vector3(sock.x * 0.78, 0, sock.z * 0.78)
      appendTube(stemBuf, [root, root.clone().lerp(sock, 0.55).add(new Vector3(0, 0.014, 0)), sock], 0.0038, 0.0022, stemSegs, stemBase, stemTip)
      stems++
    }
    const hFrac = MathUtils.clamp(sock.y / Math.max(0.1, b.height), 0, 1)
    const ao = 1 - b.aoStrength * (1 - hFrac) * 0.42
    cBase.copy(leafInner).lerp(leafOuter, hFrac * 0.68).multiplyScalar(ao)
    cTip.copy(leafInner).lerp(leafOuter, Math.min(1, hFrac * 0.78 + 0.34)).multiplyScalar(ao * 1.05)
    appendCurvedLeaf(leafBuf, sock, leafDir, sz, sz * b.leafAspect, b.arch, b.droop, b.cup, (random() - 0.5) * 0.40, segU, segV, cBase, cTip, domeCenter, 0.50, 0.012)
    leaves++
  }

  // 2. Sprinkle 28-36 proud upward-facing 3D cupped violet-blue 5-petal wildflowers across the same layout!
  const flwSlots = sampleHorizontalSlots({
    layout,
    count: Math.round(targetFlowers * 1.6),
    radius: b.spread * 0.90,
    areaRadius: b.spread * 0.94,
    lateralJitter: lj,
    random,
    phaseOffset: 0.85,
  })
  const placedFlw: Vector3[] = []
  for (let i = 0; i < flwSlots.length && flowers < targetFlowers; i++) {
    const slot = flwSlots[i]
    const rFrac = MathUtils.clamp(Math.hypot(slot.x, slot.z) / Math.max(0.08, b.spread), 0, 1.1)
    const domeH = Math.sqrt(Math.max(0.08, 1 - Math.min(0.92, rFrac * rFrac * 0.86)))
    const y = b.height * domeH * (0.78 + random() * 0.26) + 0.024
    const out = new Vector3(Math.cos(slot.angle), 0, Math.sin(slot.angle))
    const center = env.deform(new Vector3(slot.x, y, slot.z), domeH)
    if (placedFlw.some(p => p.distanceTo(center) < b.flowerSize * MathUtils.lerp(0.70, 0.96, lj))) continue
    placedFlw.push(center)

    // Delicate green pedicel rising from cushion up to blossom
    const pBase = new Vector3(center.x * 0.90, Math.max(0, center.y - 0.07), center.z * 0.90)
    appendTube(stemBuf, [pBase, pBase.clone().lerp(center, 0.55), center], 0.0028, 0.0018, stemSegs, stemBase, stemTip)
    stems++

    const surfN = UP.clone().multiplyScalar(0.95).addScaledVector(out, 0.22 * rFrac).add(new Vector3((random() - 0.5) * 0.14, 0, (random() - 0.5) * 0.14)).normalize()
    const sz = b.flowerSize * (0.84 + random() * 0.32) * scaleBoost
    const fColC = flwInner.clone().lerp(flwOuter, 0.70)
    const fColR = flwOuter.clone().multiplyScalar(0.96 + random() * 0.08)
    appendCuppedAtlasQuad(flowerBuf, center, surfN, sz, sz * 0.15, random() * Math.PI * 2, Math.floor(random() * 4), fColC, fColR, fSeg)
    flowers++
  }

  return {
    stemGeometry: finishBuf(stemBuf, false),
    leafGeometry: finishBuf(leafBuf, true)!,
    flowerGeometry: finishBuf(flowerBuf, true),
    leafTextureKey: b.leafTexture,
    flowerTextureKey: b.flowerTexture ?? 'violet-wildflower-2x2',
    alphaCutoff: b.alphaCutoff,
    stems,
    leaves,
    flowers,
  }
}

// ---------------------------------------------------------------------------
// 4. True 3D Clover / Creeping Groundcover Carpet (13 三叶草地被, 14 小叶蔓延地被)
//    ZERO giant floating flat quads! 85-115 individual 3D tilted rosettes on real curved stems in organic sub-clusters!
// ---------------------------------------------------------------------------
function buildCloverGroundcover(spec: TreeSpec, env: CrownEnvelope, b: BotanicalSpec): BuiltBotanicalPlant {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 3513))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.36, (1 / keepRatio) ** 0.34) : 1
  const targetCount = Math.max(24, Math.round(b.count * keepRatio))

  const stemBuf = makeBuf()
  const leafBuf = makeBuf()
  const stemBase = new Color(b.stemTint).multiplyScalar(0.55)
  const stemTip = new Color(b.stemTint).lerp(new Color('#74be36'), 0.35)
  const colInner = new Color(b.tintInner)
  const colOuter = new Color(b.tintOuter)
  const qSeg = opt.flatCards ? 1 : 2
  const isCreeping = b.stemCount > 0 // stemCount=1 enables creeping stolon runner mode (14 小叶蔓延地被)

  const hj = MathUtils.clamp(b.heightJitter ?? 0.40, 0, 1)
  const lj = MathUtils.clamp(b.lateralJitter ?? 0.50, 0, 1)
  const layout: BotanicalLayout = b.layout ?? 'clumps'
  const cloverSlots = sampleHorizontalSlots({
    layout,
    count: Math.round(targetCount * 1.45),
    radius: b.spread * 0.92,
    areaRadius: b.spread,
    lateralJitter: lj,
    random,
  })
  const placed: { pos: Vector3; sz: number }[] = []
  let stems = 0, leaves = 0

  for (let attempt = 0; attempt < cloverSlots.length && leaves < targetCount; attempt++) {
    const slot = cloverSlots[attempt]
    const x = slot.x
    const z = slot.z
    const edgeFactor = MathUtils.clamp(Math.hypot(x, z) / Math.max(0.1, b.spread), 0, 1.2)
    const hSpread = MathUtils.lerp(0.14, 1.25, hj)
    const hHere = b.height * MathUtils.lerp(1.0, 0.36, Math.min(1, edgeFactor * 0.85)) * MathUtils.clamp(0.82 + (random() - 0.5) * hSpread, 0.24, 1.55)
    const pos = env.deform(new Vector3(x, Math.max(isCreeping ? 0.016 : 0.026, hHere), z), 0.2)
    const sz = b.leafSize * (0.76 + random() * 0.48) * scaleBoost

    // Gentle non-overlap clearance so individual 3-leaf shamrocks & creeping rosettes stay crisp & distinct!
    const minSep = sz * (isCreeping ? 0.52 : 0.48) * MathUtils.lerp(0.75, 1.22, lj)
    if (placed.some(p => {
      const dx = p.pos.x - pos.x, dz = p.pos.z - pos.z, dy = p.pos.y - pos.y
      return dx * dx + dz * dz < minSep * minSep && Math.abs(dy) < 0.032
    })) continue
    placed.push({ pos, sz })

    // Tiny curved green petiole anchoring each clover cleanly into the ground!
    if (!isCreeping || attempt % 2 === 0) {
      const root = new Vector3(pos.x + (random() - 0.5) * 0.025, 0, pos.z + (random() - 0.5) * 0.025)
      const mid = root.clone().lerp(pos, 0.55)
      mid.x += (random() - 0.5) * 0.015
      mid.z += (random() - 0.5) * 0.015
      appendTube(stemBuf, [root, mid, pos], 0.0028, 0.0018, 3, stemBase, stemTip)
      stems++
    }

    // Gentle organic 3D tilt (not dead-flat horizontal!) + slight convex leaf dome
    const tiltAmp = isCreeping ? 0.24 : 0.34
    const surfN = new Vector3((random() - 0.5) * tiltAmp, 1, (random() - 0.5) * tiltAmp).normalize()
    const hNorm = MathUtils.clamp(pos.y / Math.max(0.05, b.height), 0, 1)
    const shade = (0.76 + 0.30 * hNorm) * (0.90 + random() * 0.18)
    const cCenter = colInner.clone().lerp(colOuter, hNorm * 0.75).multiplyScalar(shade * 0.94)
    const cRim = colInner.clone().lerp(colOuter, Math.min(1, hNorm * 0.85 + 0.25)).multiplyScalar(shade * 1.04)
    appendCuppedAtlasQuad(leafBuf, pos, surfN, sz, -sz * b.cup * 0.35, random() * Math.PI * 2, Math.floor(random() * 4), cCenter, cRim, qSeg)
    leaves++
  }

  // Optional subtle ground stolon runners for `14 小叶蔓延地被` linking adjacent creeping clusters
  if (isCreeping && placed.length > 8) {
    for (let i = 0; i < Math.min(18, placed.length - 1); i += 2) {
      const a = placed[i].pos
      let best: Vector3 | null = null
      let bestD = 0.24
      for (let j = i + 1; j < placed.length; j++) {
        const d = a.distanceTo(placed[j].pos)
        if (d > 0.06 && d < bestD) { bestD = d; best = placed[j].pos }
      }
      if (best) {
        const p0 = new Vector3(a.x, 0.008, a.z)
        const p2 = new Vector3(best.x, 0.008, best.z)
        const p1 = p0.clone().lerp(p2, 0.5).add(new Vector3((random() - 0.5) * 0.03, 0.005, (random() - 0.5) * 0.03))
        appendTube(stemBuf, [p0, p1, p2], 0.0024, 0.0022, 3, stemBase, stemTip)
        stems++
      }
    }
  }

  return {
    stemGeometry: finishBuf(stemBuf, false),
    leafGeometry: finishBuf(leafBuf, true)!,
    leafTextureKey: b.leafTexture,
    alphaCutoff: b.alphaCutoff,
    stems,
    leaves,
    flowers: 0,
  }
}

// ---------------------------------------------------------------------------
// 5. Multi-Stem Fine Leaf Herbs (15 细叶草 A arching bamboo-herb, 16 细叶草 B dense upright rosemary-herb)
// ---------------------------------------------------------------------------
function buildFineHerb(spec: TreeSpec, env: CrownEnvelope, b: BotanicalSpec): BuiltBotanicalPlant {
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 3615))
  const keepRatio = Math.max(0.35, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.36, (1 / keepRatio) ** 0.32) : 1

  const stemBuf = makeBuf()
  const leafBuf = makeBuf()
  const stemBase = new Color(b.stemTint).multiplyScalar(0.54)
  const stemTip = new Color(b.stemTint).lerp(new Color('#82ca3a'), 0.42)
  const leafInner = new Color(b.tintInner)
  const leafOuter = new Color(b.tintOuter)
  const domeCenter = new Vector3(0, b.height * 0.42, 0)

  const stemCount = Math.max(6, Math.round(b.stemCount * keepRatio))
  const isDenseUpright = b.stemCount >= 16 // 16 细叶草 B (dense petite whorled upright shoots) vs 15 细叶草 A (arching slender bamboo-herb)
  const stemSegs = opt.woodDetail < 0.5 ? 3 : 4
  const segU = opt.flatCards ? 1 : 2
  const segV = opt.flatCards ? 1 : (isDenseUpright ? 2 : 3)
  const cBase = new Color(), cTip = new Color()

  const hj = MathUtils.clamp(b.heightJitter ?? 0.36, 0, 1)
  const lj = MathUtils.clamp(b.lateralJitter ?? 0.44, 0, 1)
  const hjMul = MathUtils.lerp(0.20, 2.00, hj)
  const herbSlots = sampleHorizontalSlots({
    layout: b.layout ?? 'phyllotaxis',
    count: stemCount,
    radius: b.spread * 0.44,
    areaRadius: b.spread * 0.80,
    lateralJitter: lj,
    random,
  })
  let stems = 0, leaves = 0

  for (let i = 0; i < herbSlots.length; i++) {
    const slot = herbSlots[i]
    const isInner = slot.group === 0
    const angle = slot.angle
    const out = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const len = b.height * MathUtils.clamp((isInner ? 0.96 : 0.77) + (random() - 0.5) * 0.26 * hjMul, 0.40, 1.38)
    const leanDeg = isDenseUpright
      ? (isInner ? 6 + random() * 12 : 16 + random() * 20)
      : (isInner ? 14 + random() * 14 : 26 + random() * 22)
    const leanRad = MathUtils.degToRad(leanDeg)

    const rings = 7
    const spine: Vector3[] = [new Vector3(slot.x, 0, slot.z)]
    const wavePhase = random() * Math.PI * 2
    const sideAxis = new Vector3().crossVectors(out, UP).normalize()
    for (let k = 1; k < rings; k++) {
      const t = (k - 0.5) / (rings - 1)
      const aHere = leanRad + b.arch * t * t * (isDenseUpright ? 0.58 : 0.96)
      const sway = (Math.sin(t * Math.PI * 1.4 + wavePhase) + slot.sideSign * lj * 0.55) * (isDenseUpright ? 0.09 : 0.07)
      const dir = UP.clone().multiplyScalar(Math.cos(aHere)).addScaledVector(out, Math.sin(aHere)).addScaledVector(sideAxis, sway).normalize()
      spine.push(env.deform(spine[k - 1].clone().addScaledVector(dir, len / (rings - 1)), k / (rings - 1)))
    }
    appendTube(stemBuf, spine, isDenseUpright ? 0.0044 : 0.0052, 0.0018, stemSegs, stemBase, stemTip)
    stems++

    // Populate lush, full-silhouette 3D curved lance leaves cleanly along the stalk!
    const nodesPerStem = isDenseUpright
      ? Math.max(6, Math.round((b.count / Math.max(1, stemCount)) * 0.48))
      : Math.max(5, Math.round((b.count / Math.max(1, stemCount)) * 0.48))
    for (let ni = 0; ni < nodesPerStem; ni++) {
      const t = MathUtils.lerp(0.10, 0.95, ni / Math.max(1, nodesPerStem - 1))
      const fi = t * (spine.length - 1)
      const i0 = Math.floor(fi), i1 = Math.min(spine.length - 1, i0 + 1)
      const pos = spine[i0].clone().lerp(spine[i1], fi - i0)
      const tan = spine[i1].clone().sub(spine[Math.max(0, i0 - 1)]).normalize()
      const right = new Vector3().crossVectors(tan, UP)
      if (right.lengthSq() < 1e-5) right.set(1, 0, 0)
      right.normalize()
      const ortho = new Vector3().crossVectors(right, tan).normalize()

      const hFrac = MathUtils.clamp(pos.y / Math.max(0.2, b.height), 0, 1)
      const ao = 1 - b.aoStrength * (1 - hFrac) * 0.40
      cBase.copy(leafInner).lerp(leafOuter, hFrac * 0.72).multiplyScalar(ao)
      cTip.copy(leafInner).lerp(leafOuter, Math.min(1, hFrac * 0.85 + 0.28)).multiplyScalar(ao * 1.06)

      const pairCount = 2
      const baseRot = ni * (isDenseUpright ? GOLDEN : Math.PI * 0.52) + (random() - 0.5) * 0.25
      for (let pk = 0; pk < pairCount; pk++) {
        const a = baseRot + (pk / pairCount) * Math.PI * 2
        const radial = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(ortho, Math.sin(a)).normalize()
        // Crisp upward-angled V-spray along stalk (dense rosemary angles ~48°, bamboo-herb gracefully fans ~34°!)
        const upBias = isDenseUpright ? 0.62 + t * 0.22 : 0.40 - t * 0.14
        const leafDir = radial.clone().multiplyScalar(0.84).addScaledVector(tan, upBias).normalize()
        const sz = b.leafSize * MathUtils.lerp(1.08, 0.70, t) * (0.88 + random() * 0.24) * scaleBoost
        appendCurvedLeaf(leafBuf, pos, leafDir, sz, sz * b.leafAspect, b.arch * 0.55, b.droop, b.cup, (random() - 0.5) * 0.30, segU, segV, cBase, cTip, domeCenter, 0.42)
        leaves++
      }
    }
    // Delicate apical tip leaf finishing each shoot cleanly
    const tipPos = spine[spine.length - 1]
    const tipTan = tipPos.clone().sub(spine[spine.length - 2]).normalize()
    cBase.copy(leafInner).lerp(leafOuter, 0.88)
    cTip.copy(leafOuter)
    appendCurvedLeaf(leafBuf, tipPos, tipTan, b.leafSize * 0.78 * scaleBoost, b.leafSize * 0.78 * b.leafAspect * scaleBoost, 0.14, 0.08, b.cup, 0, segU, segV, cBase, cTip, domeCenter, 0.42)
    leaves++
  }

  return {
    stemGeometry: finishBuf(stemBuf, false),
    leafGeometry: finishBuf(leafBuf, true)!,
    leafTextureKey: b.leafTexture,
    alphaCutoff: b.alphaCutoff,
    stems,
    leaves,
    flowers: 0,
  }
}

// ---------------------------------------------------------------------------
// Unified Botanical Plant Entry Point (Dispatches All 16 Stylized Plants!)
// ---------------------------------------------------------------------------
export function buildBotanicalPlant(spec: TreeSpec, env: CrownEnvelope): BuiltBotanicalPlant {
  const b: BotanicalSpec = spec.botanical ?? defaultBotanical

  if (b.mode === 'rosette-shrub') {
    const adapter: TreeSpec = {
      ...spec,
      trunk: { ...spec.trunk, height: b.height, radius: b.height < 0.62 ? 0.0075 : 0.0085 },
      crown: { ...spec.crown, width: b.spread },
      ground: { ...spec.ground, count: b.count, arch: b.arch },
      leaves: {
        ...spec.leaves,
        leafSize: b.leafSize,
        leafAspect: b.leafAspect,
        leafFold: b.cup,
        leafCurl: b.droop,
        normalSpherize: 0.44,
        tintInner: b.tintInner,
        tintOuter: b.tintOuter,
        aoStrength: b.aoStrength,
      },
      flowerbed: { ...spec.flowerbed, stemTint: b.stemTint },
    }
    const built = buildRosetteShrub(adapter, env)
    return {
      stemGeometry: built.stemGeometry,
      leafGeometry: built.leafGeometry,
      leafTextureKey: b.leafTexture,
      alphaCutoff: b.alphaCutoff,
      stems: built.stems,
      leaves: built.leaves,
      flowers: 0,
    }
  }

  if (b.mode === 'hydrangea-shrub') {
    const adapter: TreeSpec = {
      ...spec,
      trunk: { ...spec.trunk, height: b.height },
      crown: { ...spec.crown, width: b.spread },
      branches: { ...spec.branches, count: b.stemCount },
      leaves: {
        ...spec.leaves,
        leafSize: b.leafSize,
        leafAspect: b.leafAspect,
        tintInner: b.tintInner,
        tintOuter: b.tintOuter,
        aoStrength: b.aoStrength,
      },
      flowers: {
        ...spec.flowers,
        enabled: b.flowerClusters > 0,
        clusterCount: b.flowerClusters,
        count: b.count,
        tintInner: b.flowerTintInner,
        tintOuter: b.flowerTintOuter,
      },
    }
    const built = buildHerbShrub(adapter, env)
    return {
      stemGeometry: built.stemGeometry,
      leafGeometry: built.leafGeometry,
      flowerGeometry: built.flowerGeometry,
      coreGeometry: built.coreGeometry,
      leafTextureKey: b.leafTexture,
      flowerTextureKey: b.flowerTexture ?? 'hydrangea-floret-2x2',
      alphaCutoff: b.alphaCutoff,
      stems: built.stems,
      leaves: built.leaves,
      flowers: built.flowers,
    }
  }

  if (b.mode === 'fern-clump') return buildFountainClump(spec, env, b, true)
  if (b.mode === 'blade-clump') return buildFountainClump(spec, env, b, false)
  if (b.mode === 'cosmos-shrub') return buildCosmosShrub(spec, env, b)
  if (b.mode === 'flower-groundcover') return buildFlowerGroundcover(spec, env, b)
  if (b.mode === 'clover-groundcover') return buildCloverGroundcover(spec, env, b)
  return buildFineHerb(spec, env, b)
}

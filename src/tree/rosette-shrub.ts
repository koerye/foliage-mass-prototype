// Rosette Petiole Broad-Leaf Shrub Generator (Prototype 1: 04 阔叶灌木 A / 05 阔叶灌木 B):
// Models true clumping herbaceous dome shrubs (hosta / wild ginger / broadleaf ground mound):
// - Tight basal root crown with slender curved green tubular petioles radiating outward
// - 4 concentric shingled golden-angle tiers of INDIVIDUAL 3D cupped, arched heart/ovate leaves
// - Zero chaotic cross-card intersections; smooth dome-blended vertex normals + tiered inner AO
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export interface RosetteShrubConfig {
  leafCount: number
  domeWidth: number
  domeHeight: number
  leafSize: number
  leafAspect: number
  cup: number
  arch: number
  droop: number
  petioleRadius: number
  spherize: number
  tintInner: string
  tintOuter: string
  stemColor: string
  tintVariance: number
  aoStrength: number
}

export function defaultRosetteShrubConfig(spec: TreeSpec): RosetteShrubConfig {
  const c = spec.crown
  const l = spec.leaves
  return {
    leafCount: Math.max(16, Math.min(72, Math.round(spec.ground.count > 14 ? spec.ground.count : 38))),
    domeWidth: Math.max(0.24, c.width || 0.44),
    domeHeight: Math.max(0.28, spec.trunk.height || 0.74),
    leafSize: Math.max(0.14, l.leafSize || 0.29),
    leafAspect: MathUtils.clamp(l.leafAspect || 1.00, 0.55, 1.35),
    cup: MathUtils.clamp(l.leafFold ?? 0.16, 0.02, 0.42),
    arch: MathUtils.clamp(spec.ground.arch ?? 0.28, 0.05, 0.65),
    droop: MathUtils.clamp(Math.abs(l.leafCurl ?? 0.18), 0.02, 0.45),
    petioleRadius: Math.max(0.004, spec.trunk.radius || 0.0085),
    spherize: MathUtils.clamp(l.normalSpherize ?? 0.46, 0, 1),
    tintInner: l.tintInner || '#508c5c',
    tintOuter: l.tintOuter || '#fffef0',
    stemColor: spec.flowerbed.stemTint || '#2b6a24',
    tintVariance: MathUtils.clamp(l.tintVariance ?? 0.10, 0, 0.35),
    aoStrength: MathUtils.clamp(l.aoStrength ?? 0.56, 0, 0.9),
  }
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
  const tVec = new Vector3()
  const side = new Vector3()
  const binorm = new Vector3()
  const n = new Vector3()
  const p = new Vector3()
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
      const ca = Math.cos(a), sa = Math.sin(a)
      n.copy(side).multiplyScalar(ca).addScaledVector(binorm, sa).normalize()
      p.copy(spine[i]).addScaledVector(n, r)
      pos.push(p.x, p.y, p.z)
      nor.push(n.x, n.y, n.z)
      uv.push(s / radialSegs, f)
      col.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let s = 0; s < radialSegs; s++) {
      const sNext = (s + 1) % radialSegs
      const a = baseVert + i * radialSegs + s
      const b = baseVert + i * radialSegs + sNext
      const d = baseVert + (i + 1) * radialSegs + s
      const e = baseVert + (i + 1) * radialSegs + sNext
      idx.push(a, b, e, a, e, d)
    }
  }
}

export interface BuiltRosetteShrub {
  stemGeometry: BufferGeometry
  leafGeometry: BufferGeometry
  stems: number
  leaves: number
}

export function buildRosetteShrub(spec: TreeSpec, env: CrownEnvelope): BuiltRosetteShrub {
  const cfg = defaultRosetteShrubConfig(spec)
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 9124))
  const keepRatio = Math.max(0.32, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.45, (1 / keepRatio) ** 0.36) : 1
  const totalTarget = Math.max(14, Math.round(cfg.leafCount * keepRatio))

  const sPos: number[] = [], sNor: number[] = [], sUv: number[] = [], sCol: number[] = [], sIdx: number[] = []
  const lPos: number[] = [], lNor: number[] = [], lUv: number[] = [], lCol: number[] = []
  const lCen: number[] = [], lCor: number[] = [], lIdx: number[] = []

  const innerCol = new Color(cfg.tintInner)
  const outerCol = new Color(cfg.tintOuter)
  const stemBaseCol = new Color(cfg.stemColor).multiplyScalar(0.42)
  const stemTipCol = new Color(cfg.stemColor).lerp(new Color('#7ec63a'), 0.36)
  const tmpCol = new Color()

  const segU = opt.flatCards ? 1 : 2 // 3 columns (left lobe, central midrib valley, right lobe)
  const segV = opt.flatCards ? 1 : 3 // 4 rows (basal notch -> buoyant arch -> full belly -> soft tip)
  const colsU = segU + 1
  const rowsV = segV + 1
  const stemRadialSegs = opt.woodDetail < 0.5 ? 3 : 4
  const domeCenter = new Vector3(0, cfg.domeHeight * 0.38, 0)

  // Airy, fluffy dual-shell golden-angle dome layout:
  // - Outer proud leaves pop forward into sunlight with full readable heart faces (steep outward pitch!)
  // - Recessed shadow-layer leaves tuck slightly inward to create deep emerald breathing pockets between leaves
  // - Strict 3D blade-center clearance prevents ugly card-through-card intersections & dense roof-shingle plastering!
  interface PlacedBlade {
    center: Vector3
    radius: number
    proud: boolean
  }
  const placedBlades: PlacedBlade[] = []
  let leaves = 0
  let stems = 0

  interface CandidateLeaf {
    angle: number
    hFrac: number
    rFrac: number
    proud: boolean
    pitchDeg: number
    szScale: number
    tierIdx: number
  }
  const candidates: CandidateLeaf[] = []

  // 1. Crown apex cap (5 staggered buoyant leaves closing TOP VIEW cleanly into a rounded dome peak — zero center hole!)
  const crownCount = Math.max(4, Math.min(6, Math.round(totalTarget * 0.13)))
  for (let i = 0; i < crownCount; i++) {
    const u = i / Math.max(1, crownCount - 1) // 0 = very peak, 1 = upper shoulder ring
    const angle = i * GOLDEN + 0.45 + (random() - 0.5) * 0.25
    const rFrac = u === 0 ? 0.04 + random() * 0.04 : MathUtils.lerp(0.14, 0.34, u) * (0.90 + random() * 0.20)
    const hFrac = MathUtils.lerp(1.00, 0.78, u) + (random() - 0.5) * 0.04
    const pitchDeg = u === 0 ? 14 + random() * 8 : MathUtils.lerp(20, 36, u) + (random() - 0.5) * 8
    const szScale = MathUtils.lerp(0.76, 0.90, u) * (0.94 + random() * 0.12)
    candidates.push({
      angle,
      hFrac,
      rFrac,
      proud: true,
      pitchDeg,
      szScale,
      tierIdx: 2,
    })
  }

  // 2. Proud outer sunlit dome shell arranged by golden-angle phyllotaxis from lush lifted skirt -> shoulders
  const proudCount = Math.max(20, Math.round(totalTarget * 0.68))
  for (let i = 0; i < proudCount; i++) {
    // u from 0 (outer lower skirt) to 1 (upper shoulder below crown cap)
    const u = (i + 0.35) / proudCount
    // Rounded bell-dome profile: wider lush base skirt tapering smoothly into rounded upper shoulder!
    const polar = MathUtils.lerp(Math.PI * 0.48, Math.PI * 0.17, u)
    const rBase = Math.sin(polar) ** 0.90
    const yBase = MathUtils.lerp(0.16, 0.82, Math.cos(polar) ** 0.88)
    const angle = (i + crownCount) * GOLDEN + (random() - 0.5) * 0.20
    // Generous outward heart-face pitch so EVERY front/side leaf shows its complete glossy heart face!
    const pitchDeg = MathUtils.lerp(54, 24, u ** 0.90) + (random() - 0.5) * 10
    const szScale = MathUtils.lerp(1.08, 0.86, u) * (0.92 + random() * 0.16)
    candidates.push({
      angle,
      hFrac: MathUtils.clamp(yBase + (random() - 0.5) * 0.05, 0.14, 0.86),
      rFrac: rBase * (0.94 + random() * 0.16),
      proud: true,
      pitchDeg,
      szScale,
      tierIdx: u < 0.42 ? 0 : 1,
    })
  }

  // 3. Recessed interior depth-pocket leaves nestled behind gaps for lush dark-emerald puffiness!
  const innerCount = Math.max(16, Math.round(totalTarget * 0.55))
  for (let i = 0; i < innerCount; i++) {
    const u = (i + 0.5) / innerCount
    const polar = MathUtils.lerp(Math.PI * 0.48, Math.PI * 0.16, u)
    const rBase = Math.sin(polar) ** 0.90
    const yBase = MathUtils.lerp(0.16, 0.78, Math.cos(polar) ** 0.88)
    const angle = i * GOLDEN + 2.15 + (random() - 0.5) * 0.30
    const pitchDeg = MathUtils.lerp(52, 22, u) + (random() - 0.5) * 12
    const szScale = MathUtils.lerp(1.04, 0.82, u) * (0.90 + random() * 0.18)
    candidates.push({
      angle,
      hFrac: MathUtils.clamp(yBase + (random() - 0.5) * 0.06, 0.13, 0.84),
      rFrac: rBase * (0.58 + random() * 0.20),
      proud: false,
      pitchDeg,
      szScale,
      tierIdx: u < 0.4 ? 0 : 1,
    })
  }

  for (const cand of candidates) {
    if (leaves >= totalTarget) break
    const sz = cfg.leafSize * cand.szScale * scaleBoost
    const width = sz * cfg.leafAspect
    const radius = cfg.domeWidth * cand.rFrac
    const height = cfg.domeHeight * cand.hFrac

    const outDir = new Vector3(Math.cos(cand.angle), 0, Math.sin(cand.angle))
    const socket = new Vector3(outDir.x * radius, height, outDir.z * radius)
    const deformedSocket = env.deform(socket, cand.hFrac)
    // Keep bottom skirt lifted slightly so bush feels light & airy over grounded stems (no pancake floor smear!)
    if (deformedSocket.y < 0.07) deformedSocket.y = 0.07

    const pitchRad = MathUtils.degToRad(MathUtils.clamp(cand.pitchDeg, 6, 66))
    const rollRad = MathUtils.degToRad((random() - 0.5) * 22)
    const yawJitter = (random() - 0.5) * 0.26
    const fwdHoriz = new Vector3(Math.cos(cand.angle + yawJitter), 0, Math.sin(cand.angle + yawJitter)).normalize()
    const leafFwd = fwdHoriz.clone().multiplyScalar(Math.cos(pitchRad)).addScaledVector(UP, -Math.sin(pitchRad)).normalize()
    // Right-handed leaf frame: right = cross(fwd, UP), up = cross(right, fwd) -> strictly +Y upward normal & CCW winding!
    const rawSide = new Vector3().crossVectors(leafFwd, UP).normalize()
    const rawUp = new Vector3().crossVectors(rawSide, leafFwd).normalize()
    const leafSide = rawSide.clone().multiplyScalar(Math.cos(rollRad)).addScaledVector(rawUp, Math.sin(rollRad)).normalize()
    const leafUp = new Vector3().crossVectors(leafSide, leafFwd).normalize()

    // Check true 3D blade-center separation so individual heart leaves breathe cleanly without smashing into each other!
    const leafCenter = deformedSocket.clone().addScaledVector(leafFwd, sz * 0.44).addScaledVector(leafUp, sz * 0.08)
    const bladeRad = sz * 0.50
    let tooCrowded = false
    for (const prev of placedBlades) {
      const clearance = cand.tierIdx === 2
        ? 0.54
        : (cand.proud && prev.proud) ? 0.78 : 0.60
      const minD = (bladeRad + prev.radius) * clearance
      if (leafCenter.distanceToSquared(prev.center) < minD * minD) {
        tooCrowded = true
        break
      }
    }
    if (tooCrowded) continue
    placedBlades.push({ center: leafCenter.clone(), radius: bladeRad, proud: cand.proud })

    // 1. Slender arching green petiole rising cleanly from compact root crown to lifted leaf socket
    const rootR = Math.min(radius * 0.40, cfg.domeWidth * 0.26) * (0.45 + random() * 0.55)
    const rootPt = new Vector3(
      Math.cos(cand.angle + (random() - 0.5) * 0.22) * rootR,
      0,
      Math.sin(cand.angle + (random() - 0.5) * 0.22) * rootR,
    )
    const mid1 = rootPt.clone().lerp(deformedSocket, 0.36)
    mid1.y = Math.max(0.04, deformedSocket.y * 0.58)
    const mid2 = rootPt.clone().lerp(deformedSocket, 0.72)
    mid2.y = Math.max(mid1.y + 0.02, deformedSocket.y * 0.96)
    appendTube(
      [rootPt, mid1, mid2, deformedSocket],
      cfg.petioleRadius * (1.02 - cand.tierIdx * 0.08),
      cfg.petioleRadius * 0.50,
      stemRadialSegs,
      stemBaseCol,
      stemTipCol,
      sPos, sNor, sUv, sCol, sIdx,
    )
    stems++

    // 2. Sculpted 3D buoyant cupped heart leaf (lifted arch belly + soft curved tip + vivid outer vs deep-emerald inner contrast!)
    const exposure = cand.proud
      ? MathUtils.clamp(0.55 + cand.hFrac * 0.48, 0, 1)
      : MathUtils.clamp(0.14 + cand.hFrac * 0.36, 0, 0.62)
    const depthShade = cand.proud
      ? MathUtils.lerp(0.92, 1.07, cand.hFrac)
      : MathUtils.lerp(0.62, 0.78, cand.hFrac)
    const jitter = 1 + (random() - 0.5) * 2 * cfg.tintVariance
    const tierAo = 1 - cfg.aoStrength * (1 - cand.hFrac) * (cand.proud ? 0.24 : 0.46)

    const baseVert = lPos.length / 3
    const localPts: Vector3[] = []

    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV // 0 = basal petiole cleft, 1 = pointed heart leaf tip
      const along = (v - 0.14) * sz
      // Buoyant upward springy belly arch with gentle rounded tip curve (creates airy fluffy silhouette!)
      const archLift = Math.sin(Math.PI * v) * cfg.arch * sz * 0.46 - (v * v) * cfg.droop * sz * 0.42
      for (let cu = 0; cu < colsU; cu++) {
        const u = cu / segU
        const s = 2 * u - 1
        // Gentle central midrib crease + lifted plump heart lobes
        const cupLift = cfg.cup * sz * 0.36 * (s * s - 0.40) * Math.sin(Math.PI * MathUtils.clamp(v * 0.92 + 0.04, 0, 1))
        const p = deformedSocket.clone()
          .addScaledVector(leafFwd, along)
          .addScaledVector(leafSide, s * width * 0.5)
          .addScaledVector(leafUp, archLift + cupLift)
        if (p.y < 0.028) p.y = 0.028
        localPts.push(p)
      }
    }

    // Smooth sculpted surface normals blended gently with dome normal (keeps every individual cupped heart leaf readable!)
    const vTmpA = new Vector3(), vTmpB = new Vector3(), nLocal = new Vector3(), nDome = new Vector3()
    for (let rv = 0; rv < rowsV; rv++) {
      const v = rv / segV
      for (let cu = 0; cu < colsU; cu++) {
        const u = cu / segU
        const p = localPts[rv * colsU + cu]
        const pL = localPts[rv * colsU + Math.max(0, cu - 1)]
        const pR = localPts[rv * colsU + Math.min(segU, cu + 1)]
        const pD = localPts[Math.max(0, rv - 1) * colsU + cu]
        const pU = localPts[Math.min(segV, rv + 1) * colsU + cu]
        vTmpA.subVectors(pR, pL)
        vTmpB.subVectors(pU, pD)
        nLocal.crossVectors(vTmpB, vTmpA)
        if (nLocal.lengthSq() < 1e-8) nLocal.copy(leafUp)
        else {
          nLocal.normalize()
          if (nLocal.dot(leafUp) < 0) nLocal.negate()
        }
        nDome.subVectors(p, domeCenter)
        if (nDome.lengthSq() < 1e-6) nDome.copy(UP)
        else nDome.normalize()
        nDome.y = Math.max(0.24, nDome.y)
        nDome.normalize()
        nLocal.lerp(nDome, cfg.spherize).normalize()

        // Crisp sunlit belly/tip lift vs deeper cool-emerald inner pocket
        const tipBoost = 0.88 + 0.18 * Math.sin(Math.PI * Math.min(1, v * 0.85 + 0.15))
        tmpCol.copy(innerCol).lerp(outerCol, MathUtils.clamp(exposure + v * 0.16, 0, 1))
        tmpCol.multiplyScalar(tierAo * depthShade * jitter * tipBoost)

        lPos.push(p.x, p.y, p.z)
        lNor.push(nLocal.x, nLocal.y, nLocal.z)
        lUv.push(u, v)
        lCol.push(Math.min(1.16, tmpCol.r), Math.min(1.16, tmpCol.g), Math.min(1.16, tmpCol.b))
        lCen.push(leafCenter.x, leafCenter.y, leafCenter.z)
        lCor.push((u - 0.5) * width, (v - 0.5) * sz)
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
    leaves++
  }

  const stemGeometry = new BufferGeometry()
  stemGeometry.setAttribute('position', new BufferAttribute(new Float32Array(sPos), 3))
  stemGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(sNor), 3))
  stemGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(sUv), 2))
  stemGeometry.setAttribute('color', new BufferAttribute(new Float32Array(sCol), 3))
  stemGeometry.setIndex(sIdx)
  stemGeometry.computeBoundingBox()
  stemGeometry.computeBoundingSphere()

  const leafGeometry = new BufferGeometry()
  leafGeometry.setAttribute('position', new BufferAttribute(new Float32Array(lPos), 3))
  leafGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(lNor), 3))
  leafGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(lUv), 2))
  leafGeometry.setAttribute('color', new BufferAttribute(new Float32Array(lCol), 3))
  leafGeometry.setAttribute('aCenter', new BufferAttribute(new Float32Array(lCen), 3))
  leafGeometry.setAttribute('aCorner', new BufferAttribute(new Float32Array(lCor), 2))
  leafGeometry.setIndex(lIdx)
  leafGeometry.computeBoundingBox()
  leafGeometry.computeBoundingSphere()

  return { stemGeometry, leafGeometry, stems, leaves }
}

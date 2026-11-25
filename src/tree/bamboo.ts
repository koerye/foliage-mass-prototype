// Stylized & realistic bamboo generator:
// - Sculptural hourglass internodes with crisp double-lip node ridges & recessed dark olive-brown grooves
// - Tight hero + slender companion culm clump hierarchy with beveled foot & optional hollow cut apex
// - Segmented alternating side branches + top crown shoots sprouting above the upper node
// - Pure Alpha curved V-folded lanceolate leaf cards arranged in structured palmate radiating fans
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, MathUtils, Vector3,
} from 'three'
import { clamp, rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const golden = Math.PI * (3 - Math.sqrt(5))

function anyPerpendicular(v: Vector3) {
  const ref = Math.abs(v.y) < .9 ? UP : new Vector3(1, 0, 0)
  return new Vector3().crossVectors(v, ref).normalize()
}

function transportFrames(points: Vector3[]) {
  const tangents = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(points.length - 1, i + 1)]
    const d = b.clone().sub(a)
    return d.lengthSq() > 1e-8 ? d.normalize() : UP.clone()
  })
  const normals: Vector3[] = []
  const binormals: Vector3[] = []
  let n = anyPerpendicular(tangents[0])
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const axis = new Vector3().crossVectors(tangents[i - 1], tangents[i])
      const s = axis.length()
      if (s > 1e-6) {
        n = n.clone().applyAxisAngle(axis.normalize(), Math.atan2(s, tangents[i - 1].dot(tangents[i])))
      }
      n.addScaledVector(tangents[i], -n.dot(tangents[i]))
      if (n.lengthSq() < 1e-6) n = anyPerpendicular(tangents[i])
      else n.normalize()
    }
    normals.push(n.clone())
    binormals.push(new Vector3().crossVectors(tangents[i], n).normalize())
  }
  return { tangents, normals, binormals }
}

interface CulmNode {
  pos: Vector3
  radius: number
  t: number
}

interface FanHub {
  anchor: Vector3
  azimuth: number
  pitch: number
  scale: number
  weight: number
  light: number
  depth: number
  maxBlades: number
  fanSpread: number
  droopScale: number
}

export interface BuiltBamboo {
  culmsGeometry: BufferGeometry
  leavesGeometry: BufferGeometry
  branches: number
  leaves: number
}

export function buildBamboo(spec: TreeSpec, env: CrownEnvelope, sprayTexture = false): BuiltBamboo {
  const B = spec.bamboo
  const T = spec.trunk
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 5401))
  const isChibi = B.style === 'chibi'

  const detail = MathUtils.clamp(opt.woodDetail, .2, 1)
  const culmSegs = Math.max(6, Math.round((isChibi ? 16 : 14) * detail))
  const ringDetail = detail >= .62 ? 2 : detail >= .38 ? 1 : 0
  const branchSegs = Math.max(4, Math.round(6 * detail))
  const cardColumns = opt.flatCards ? 1 : 2
  const cardRows = opt.flatCards ? 1 : 4
  const reduce = MathUtils.clamp(opt.cardReduction, 0, .82)
  const areaBoost = 1 + reduce * .26
  const branchReach = Math.max(.08, B.branchLength)

  // Rich stylized bamboo culm palette derived from user culmColor & nodeColor:
  // - vibrant sunlit chartreuse side + lush olive-emerald shade
  // - bright sunlit yellow-lime chamfered double-lip node rings
  // - crisp recessed dark olive-brown crease right between the two node lips
  const culmBaseColor = new Color(B.culmColor)
  const culmSunColor = culmBaseColor.clone().lerp(new Color('#b6e63c'), .34)
  const culmShadeColor = culmBaseColor.clone().multiplyScalar(.66)
  culmShadeColor.g = Math.min(1, culmShadeColor.g * 1.06)
  const nodeLipColor = new Color(B.nodeColor)
  const nodeLipBright = nodeLipColor.clone().lerp(new Color('#f1fa86'), .28)
  const nodeGrooveColor = culmBaseColor.clone().lerp(new Color('#3c3912'), .66).multiplyScalar(.62)
  const rimBright = nodeLipColor.clone().lerp(new Color('#eef79c'), .32)
  const hollowDark = culmShadeColor.clone().multiplyScalar(.34)
  const branchBaseColor = culmBaseColor.clone().lerp(new Color('#548c24'), .30)
  const branchTipColor = culmSunColor.clone().lerp(nodeLipColor, .25)

  const woodPos: number[] = []
  const woodCol: number[] = []
  const woodIdx: number[] = []

  const culmCount = Math.max(1, Math.min(7, Math.round(B.culmCount)))
  const baseSegments = Math.max(3, Math.min(18, Math.round(B.segments)))
  const culms: { nodes: CulmNode[]; hScale: number; rScale: number }[] = []
  let branchCount = 0

  // Sweep a slender segmented green bamboo side twig (with subtle mid-branch node ring)
  const pushTwigTube = (
    pts: Vector3[],
    r0: number,
    r1: number,
    segs: number,
    baseCol: Color,
    tipCol: Color,
    nodeCol: Color,
  ) => {
    const start = woodPos.length / 3
    const { normals, binormals } = transportFrames(pts)
    const c = new Color()
    const nPts = pts.length
    for (let i = 0; i < nPts; i++) {
      const f = i / Math.max(1, nPts - 1)
      // Subtle bamboo node swelling at ~42% and ~74% along the side branch
      const jointBump = (i > 0 && i < nPts - 1 && (Math.abs(f - .42) < .10 || Math.abs(f - .74) < .10)) ? 1 : 0
      const rr = MathUtils.lerp(r0, r1, f) * (1 + jointBump * .22)
      c.copy(baseCol).lerp(tipCol, f)
      if (jointBump) c.lerp(nodeCol, .35)
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2
        const px = pts[i].x + (normals[i].x * Math.cos(a) + binormals[i].x * Math.sin(a)) * rr
        const py = Math.max(0, pts[i].y + (normals[i].y * Math.cos(a) + binormals[i].y * Math.sin(a)) * rr)
        const pz = pts[i].z + (normals[i].z * Math.cos(a) + binormals[i].z * Math.sin(a)) * rr
        woodPos.push(px, py, pz)
        woodCol.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < nPts - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * segs + j
        const b = start + i * segs + (j + 1) % segs
        woodIdx.push(a, b, b + segs, a, b + segs, a + segs)
      }
    }
    const tipCenter = woodPos.length / 3
    const tipP = pts[nPts - 1]
    woodPos.push(tipP.x, Math.max(0, tipP.y), tipP.z)
    woodCol.push(tipCol.r, tipCol.g, tipCol.b)
    const lastRow = start + (nPts - 1) * segs
    for (let j = 0; j < segs; j++) {
      woodIdx.push(lastRow + j, lastRow + (j + 1) % segs, tipCenter)
    }
  }

  // 1. Build segmented bamboo culms with hero + tight slender companion hierarchy
  for (let cIdx = 0; cIdx < culmCount; cIdx++) {
    const isPrimary = cIdx === 0
    let ox = 0, oz = 0
    let hScale = 1
    let rScale = 1
    let leanAz = T.leanAngle !== undefined && T.leanAngle >= 0
      ? MathUtils.degToRad(T.leanAngle)
      : (isChibi ? .14 : -.12)

    if (culmCount === 2) {
      if (isPrimary) {
        ox = B.culmSpread * .18
        oz = B.culmSpread * .04
        leanAz = .14
      } else {
        ox = -(T.radius * 1.45 + B.culmSpread * .56)
        oz = -(T.radius * .35 + B.culmSpread * .14)
        hScale = isChibi ? .62 : .74
        rScale = isChibi ? .38 : .64
        leanAz = Math.PI * .93
      }
    } else if (culmCount >= 3) {
      if (isPrimary) {
        // Stout hero culm planted right in front-center
        ox = B.culmSpread * .12
        oz = B.culmSpread * .05
        leanAz = .10
      } else if (cIdx === 1) {
        // Mid-height slender companion hugging VERY tightly on the left-back flank
        ox = -(T.radius * 1.25 + B.culmSpread * .34)
        oz = -(T.radius * .35 + B.culmSpread * .14)
        hScale = isChibi ? .58 : .76
        rScale = isChibi ? .33 : .58
        leanAz = Math.PI * .96
      } else if (cIdx === 2) {
        // Shorter tender companion shoot tucked right against the hero base
        ox = -(T.radius * 0.96 + B.culmSpread * .16)
        oz = T.radius * .62 + B.culmSpread * .08
        hScale = isChibi ? .36 : .56
        rScale = isChibi ? .25 : .44
        leanAz = Math.PI * .88
      } else {
        const frac = (cIdx - 2) / Math.max(1, culmCount - 2)
        const th = cIdx * golden + .85
        const rad = T.radius * 1.4 + B.culmSpread * (.55 + .60 * Math.sqrt(frac))
        ox = Math.cos(th) * rad
        oz = Math.sin(th) * rad
        hScale = .50 + random() * .38
        rScale = .36 + random() * .32
        leanAz = th + (random() - .5) * .65
      }
    }

    const H = Math.max(.75, T.height * hScale)
    const R0 = Math.max(.016, T.radius * rScale)
    const segCount = Math.max(3, Math.round(baseSegments * (isPrimary ? 1 : (.68 + .32 * hScale))))
    const leanDir = new Vector3(Math.cos(leanAz), 0, Math.sin(leanAz))
    const sideDir = new Vector3(-leanDir.z, 0, leanDir.x)

    // Internode spacing: slightly shorter base & top internodes, balanced mid segments
    const jointTs: number[] = [0]
    let weightSum = 0
    const segWeights: number[] = []
    for (let s = 0; s < segCount; s++) {
      const f = (s + .5) / segCount
      const w = isChibi
        ? (.84 + .24 * Math.sin(f * Math.PI) + (random() - .5) * .04)
        : (.70 + .42 * Math.sin(f * Math.PI * .94) + (random() - .5) * .08)
      segWeights.push(Math.max(.42, w))
      weightSum += segWeights[s]
    }
    let acc = 0
    for (let s = 0; s < segCount; s++) {
      acc += segWeights[s] / weightSum
      jointTs.push(Math.min(1, acc))
    }
    jointTs[jointTs.length - 1] = 1

    const jointPts: Vector3[] = []
    const jointRadii: number[] = []
    const bendTotal = B.bend * (isPrimary ? .82 : 1.05) * (H / Math.max(1, T.height))
    const zigAmp = B.nodeZigzag * R0 * (isChibi ? .95 : .75)

    for (let s = 0; s <= segCount; s++) {
      const t = jointTs[s]
      const arch = bendTotal * (t ** (isChibi ? 1.38 : 1.65)) + T.lean * t * t * .42 * (isPrimary ? 1 : .65)
      const wobble = T.wobble * t * Math.sin(t * Math.PI * 1.6 + cIdx * 1.7)
      const zigSign = s === 0 ? 0 : (s % 2 === 0 ? -1 : 1)
      const zig = zigSign * zigAmp * Math.sin(Math.min(1, t * 1.15) * Math.PI)
      const p = new Vector3(
        ox + leanDir.x * (arch + zig) + sideDir.x * wobble,
        H * t,
        oz + leanDir.z * (arch + zig) + sideDir.z * wobble,
      )
      const deformed = s === 0 ? p : env.deform(p, clamp((t - .15) / .85))
      if (s === 0 || deformed.y < 0) deformed.y = 0
      jointPts.push(deformed)

      const flare = 1 + T.flare * Math.exp(-deformed.y / Math.max(.08, T.flareHeight))
      const topMin = B.hollowTop ? .62 : .20
      const r = R0 * flare * MathUtils.lerp(1, topMin, t ** T.taper)
      jointRadii.push(Math.max(.008, r))
    }

    const curve = new CatmullRomCurve3(jointPts, false, 'centripetal')
    const nodes = jointPts.map((pos, i) => ({ pos, radius: jointRadii[i], t: jointTs[i] }))
    const ringPts: Vector3[] = []
    const ringRadii: number[] = []
    const ringColors: Color[] = []

    // Sculptural hourglass internodes + crisp double-lip node rings with dark olive-brown recessed groove
    const bulge = B.nodeBulge
    const waistDepth = isChibi ? .058 : .038
    for (let i = 0; i < segCount; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      const span = a.pos.distanceTo(b.pos)
      const lipW = clamp(a.radius * .52 / Math.max(.01, span), .016, .16)
      const topLipW = clamp(b.radius * .52 / Math.max(.01, span), .016, .16)
      const hasBottomNode = i > 0
      const hasTopNode = i < segCount - 1

      type StationSpec = { u: number; rMul: number; lip: number; groove: number; underAo: number; footBevel?: boolean }
      const stations: StationSpec[] = ringDetail === 2
        ? [
            // Node seam groove (or beveled base foot on lowest segment)
            hasBottomNode
              ? { u: 0, rMul: 1 + bulge * .14, lip: .08, groove: 1.0, underAo: 0 }
              : { u: 0, rMul: .90, lip: .28, groove: 0, underAo: .18, footBevel: true },
            // Upper chamfered lip right above the dark groove (or base foot flare)
            hasBottomNode
              ? { u: lipW * .26, rMul: 1 + bulge * 1.10, lip: .96, groove: 0, underAo: 0 }
              : { u: Math.min(.10, lipW * .65), rMul: 1.02, lip: .06, groove: 0, underAo: .08 },
            // Lip shoulder settling into internode wall
            { u: lipW * .66, rMul: 1 + bulge * .18, lip: .18, groove: 0, underAo: 0 },
            // Lower internode body
            { u: Math.min(.32, lipW * 1.35), rMul: 1 - waistDepth * .55, lip: 0, groove: 0, underAo: 0 },
            // Mid internode subtle concave hourglass waist (catches clean sunlit glow)
            { u: .50, rMul: 1 - waistDepth, lip: 0, groove: 0, underAo: 0 },
            // Upper internode body approaching next node
            { u: Math.max(.68, 1 - topLipW * 1.35), rMul: 1 - waistDepth * .42, lip: 0, groove: 0, underAo: .10 },
            // Under-lip AO shadow tucked beneath overhanging lower lip of next node
            hasTopNode
              ? { u: 1 - topLipW * .66, rMul: 1 + bulge * .16, lip: .06, groove: 0, underAo: .26 }
              : { u: 1 - topLipW * .55, rMul: 1.0, lip: .05, groove: 0, underAo: .04 },
            // Lower chamfered lip peak right below the next node groove
            hasTopNode
              ? { u: 1 - topLipW * .24, rMul: 1 + bulge * 1.04, lip: .90, groove: 0, underAo: 0 }
              : { u: 1 - topLipW * .16, rMul: 1 + (B.hollowTop ? bulge * .22 : 0), lip: B.hollowTop ? .35 : .08, groove: 0, underAo: 0 },
          ]
        : ringDetail === 1
          ? [
              hasBottomNode
                ? { u: 0, rMul: 1 + bulge * .15, lip: .08, groove: .92, underAo: 0 }
                : { u: 0, rMul: .92, lip: .22, groove: 0, underAo: .14, footBevel: true },
              hasBottomNode
                ? { u: lipW * .34, rMul: 1 + bulge * 1.02, lip: .88, groove: 0, underAo: 0 }
                : { u: Math.min(.12, lipW * .7), rMul: 1.0, lip: .04, groove: 0, underAo: .06 },
              { u: .50, rMul: 1 - waistDepth * .85, lip: 0, groove: 0, underAo: 0 },
              hasTopNode
                ? { u: 1 - topLipW * .32, rMul: 1 + bulge * .96, lip: .82, groove: 0, underAo: .08 }
                : { u: 1 - topLipW * .25, rMul: 1, lip: .12, groove: 0, underAo: 0 },
            ]
          : [
              hasBottomNode
                ? { u: 0, rMul: 1 + bulge * .62, lip: .45, groove: .45, underAo: 0 }
                : { u: 0, rMul: .95, lip: .12, groove: 0, underAo: .10, footBevel: true },
              { u: .50, rMul: 1 - waistDepth * .6, lip: 0, groove: 0, underAo: 0 },
            ]

      for (const st of stations) {
        const radius = MathUtils.lerp(a.radius, b.radius, st.u) * st.rMul
        const t = MathUtils.lerp(a.t, b.t, st.u)
        ringPts.push(curve.getPoint((i + st.u) / segCount))
        ringRadii.push(radius)

        // Internode vertical gradient: subtle emerald shade near base/under-lip -> sunlit chartreuse mid/upper
        const bodyShade = MathUtils.lerp(.90, 1.06, st.u * .65 + t * .35)
        const c = culmBaseColor.clone()
          .lerp(culmSunColor, .16 + t * .38 + Math.sin(st.u * Math.PI) * .16)
          .multiplyScalar(bodyShade * (1 - st.underAo * .68))
        if (st.lip > 0) c.lerp(st.lip > .7 ? nodeLipBright : nodeLipColor, st.lip * .82)
        if (st.groove > 0) c.lerp(nodeGrooveColor, st.groove * .92)
        ringColors.push(c)
      }
    }

    const topNode = nodes[nodes.length - 1]
    ringPts.push(topNode.pos)
    ringRadii.push(topNode.radius * (B.hollowTop ? 1 + bulge * .24 : 1))
    ringColors.push(B.hollowTop ? rimBright.clone() : culmSunColor.clone())
    const { tangents, normals: ringNormals, binormals: ringBinormals } = transportFrames(ringPts)

    // Emit culm tube vertices with subtle cylindrical sunlit-vs-shaded wrap & bamboo fiber striations
    const culmStart = woodPos.length / 3
    const colTmp = new Color()
    for (let rIdx = 0; rIdx < ringPts.length; rIdx++) {
      const p = ringPts[rIdx]
      const n = ringNormals[rIdx]
      const bi = ringBinormals[rIdx]
      const rad = ringRadii[rIdx]
      const baseC = ringColors[rIdx]
      const slantTop = B.hollowTop && rIdx === ringPts.length - 1 ? rad * .08 : 0

      for (let j = 0; j < culmSegs; j++) {
        const a = (j / culmSegs) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        const px = p.x + (n.x * ca + bi.x * sa) * rad
        const py = Math.max(0, p.y + (n.y * ca + bi.y * sa) * rad + slantTop * ca)
        const pz = p.z + (n.z * ca + bi.z * sa) * rad
        woodPos.push(px, rIdx === 0 ? 0 : py, pz)
        // Subtle vertical fiber streak + directional highlight wrap around cylinder
        const streak = .96 + .04 * Math.sin(a * 5 + cIdx * 2.1)
        const wrap = (.84 + .26 * (.5 + .5 * Math.cos(a - .65))) * streak
        colTmp.copy(baseC).multiplyScalar(wrap)
        woodCol.push(colTmp.r, colTmp.g, colTmp.b)
      }
    }
    for (let rIdx = 0; rIdx < ringPts.length - 1; rIdx++) {
      for (let j = 0; j < culmSegs; j++) {
        const a = culmStart + rIdx * culmSegs + j
        const b = culmStart + rIdx * culmSegs + (j + 1) % culmSegs
        woodIdx.push(a, b, b + culmSegs, a, b + culmSegs, a + culmSegs)
      }
    }

    // Apex finish: crisp concave hollow cut rim or tapered live dome
    const topRingIdx = ringPts.length - 1
    const topRow = culmStart + topRingIdx * culmSegs
    const topRad = ringRadii[topRingIdx]
    const topTangent = tangents[topRingIdx]
    const topNormal = ringNormals[topRingIdx]
    const topBinormal = ringBinormals[topRingIdx]
    if (B.hollowTop) {
      const innerR = topRad * .74
      const cavityDepth = Math.min(.20, topRad * 1.35)
      const slantTop = topRad * .08
      const innerRimRow = woodPos.length / 3
      for (let j = 0; j < culmSegs; j++) {
        const a = (j / culmSegs) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        const px = topNode.pos.x + (topNormal.x * ca + topBinormal.x * sa) * innerR
        const py = topNode.pos.y + (topNormal.y * ca + topBinormal.y * sa) * innerR + slantTop * ca
        const pz = topNode.pos.z + (topNormal.z * ca + topBinormal.z * sa) * innerR
        woodPos.push(px, py, pz)
        woodCol.push(rimBright.r, rimBright.g, rimBright.b)
      }
      const floorRow = woodPos.length / 3
      const floorCenterPos = topNode.pos.clone().addScaledVector(topTangent, -cavityDepth)
      for (let j = 0; j < culmSegs; j++) {
        const a = (j / culmSegs) * Math.PI * 2
        const ca = Math.cos(a), sa = Math.sin(a)
        const px = floorCenterPos.x + (topNormal.x * ca + topBinormal.x * sa) * (innerR * .86)
        const py = floorCenterPos.y + (topNormal.y * ca + topBinormal.y * sa) * (innerR * .86)
        const pz = floorCenterPos.z + (topNormal.z * ca + topBinormal.z * sa) * (innerR * .86)
        woodPos.push(px, py, pz)
        woodCol.push(hollowDark.r, hollowDark.g, hollowDark.b)
      }
      const floorCenter = woodPos.length / 3
      woodPos.push(floorCenterPos.x, floorCenterPos.y, floorCenterPos.z)
      woodCol.push(hollowDark.r, hollowDark.g, hollowDark.b)

      for (let j = 0; j < culmSegs; j++) {
        const jn = (j + 1) % culmSegs
        woodIdx.push(topRow + j, topRow + jn, innerRimRow + jn, topRow + j, innerRimRow + jn, innerRimRow + j)
        woodIdx.push(innerRimRow + j, innerRimRow + jn, floorRow + jn, innerRimRow + j, floorRow + jn, floorRow + j)
        woodIdx.push(floorRow + j, floorRow + jn, floorCenter)
      }
    } else {
      const capCenter = woodPos.length / 3
      const tipP = topNode.pos.clone().addScaledVector(topTangent, topRad * .85)
      woodPos.push(tipP.x, tipP.y, tipP.z)
      woodCol.push(culmSunColor.r, culmSunColor.g, culmSunColor.b)
      for (let j = 0; j < culmSegs; j++) {
        woodIdx.push(topRow + j, topRow + (j + 1) % culmSegs, capCenter)
      }
    }

    culms.push({ nodes, hScale, rScale })
  }

  // 2. Leaf geometry buffers
  const leafPos: number[] = []
  const leafNor: number[] = []
  const leafUv: number[] = []
  const leafCol: number[] = []
  const leafCen: number[] = []
  const leafCor: number[] = []
  const leafIdx: number[] = []

  const innerTint = new Color(B.tintInner)
  const outerTint = new Color(B.tintOuter)
  let leafCardTotal = 0

  // Emit one gracefully arched, V-folded Alpha lanceolate bamboo leaf card.
  // - Smooth upward launch -> arched crest -> graceful sweeping downward droop to needle tip
  // - Inverted-V midrib ridge along u=0.5 with angled half-normals for crisp stylized two-tone sunlight
  function emitLeaf(
    anchor: Vector3,
    direction: Vector3,
    length: number,
    width: number,
    roll: number,
    droopFactor: number,
    pigmentation: Color,
  ) {
    if (env.bare(anchor) > .35) return
    const right = new Vector3().crossVectors(UP, direction)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    else right.normalize()
    right.applyAxisAngle(direction, roll)
    const up = new Vector3().crossVectors(direction, right).normalize()
    const start = leafPos.length / 3
    const color = new Color()
    const point = new Vector3()
    const normal = new Vector3()
    const forward = new Vector3()

    const riseAmp = sprayTexture ? .10 : .22
    const droopAmp = (sprayTexture ? .36 : .76) * MathUtils.clamp(droopFactor, .12, 1.45)
    const foldAmp = sprayTexture ? .14 : .26

    for (let j = 0; j <= cardRows; j++) {
      const v = j / cardRows
      // Graceful botanical fountain arch: rises cleanly from petiole, crests at ~32%,
      // then arcs outward & downward so the broad blade face displays boldly in 3D!
      const arch = (Math.sin(v * Math.PI * .78) * riseAmp - droopAmp * (v ** 1.98)) * length
      const slope = Math.cos(v * Math.PI * .78) * riseAmp * Math.PI * .78 - droopAmp * 1.98 * (v ** .98)
      const reachAlong = (v - .12 * droopAmp * (v ** 3)) * length
      forward.copy(direction).addScaledVector(up, slope).normalize()
      // Saturated emerald petiole brightening smoothly to sunlit lime tip (never washed-out white!)
      const bladeGrad = MathUtils.lerp(.74, 1.03, v ** .90)
      color.copy(pigmentation).multiplyScalar(bladeGrad)

      for (let i = 0; i <= cardColumns; i++) {
        const u = i / cardColumns
        const across = (u - .5) * width
        // Crisp inverted-V midrib ridge (center u=0.5 crests upward, margins slope cleanly down)
        const fold = Math.abs(across) * foldAmp * Math.sin(Math.min(1, v * 1.06) * Math.PI)
        point.copy(anchor)
          .addScaledVector(direction, reachAlong)
          .addScaledVector(right, across)
          .addScaledVector(up, arch - fold)

        // Angled normals across the V-fold give crisp sunlit-half / emerald-half bamboo blade contrast
        normal.crossVectors(forward, right).normalize()
        if (normal.y < 0) normal.negate()
        normal.addScaledVector(UP, .24).addScaledVector(right, (u - .5) * .62).normalize()

        leafPos.push(point.x, Math.max(0, point.y), point.z)
        leafNor.push(normal.x, normal.y, normal.z)
        leafUv.push(u, 1 - v)
        leafCol.push(color.r, color.g, color.b)
        leafCen.push(anchor.x, anchor.y, anchor.z)
        leafCor.push(across, v * length)
      }
    }
    for (let j = 0; j < cardRows; j++) {
      for (let i = 0; i < cardColumns; i++) {
        const a = start + j * (cardColumns + 1) + i
        const c = a + cardColumns + 1
        leafIdx.push(a, c, c + 1, a, c + 1, a + 1)
      }
    }
    leafCardTotal++
  }

  // Emit a cohesive palmate radiating bamboo rosette fan (3..7 arched blades sharing one tight petiole hub)
  function emitPalmateFan(
    hub: FanHub,
    bladeCount: number,
    baseLeafScale: number,
    leafRandom: () => number,
  ) {
    const n = Math.max(1, bladeCount)
    // Ordered center-out fan angles so central hero blade stays prominent even at low LOD counts
    const fanAngles: number[] = []
    if (n === 1) {
      fanAngles.push(0)
    } else {
      const halfSpread = hub.fanSpread * .5
      const orderedSlots: number[] = []
      if (n % 2 === 1) {
        orderedSlots.push(0)
        const pairs = (n - 1) / 2
        for (let p = 1; p <= pairs; p++) {
          const frac = p / pairs
          orderedSlots.push(-frac, frac)
        }
      } else {
        const pairs = n / 2
        for (let p = 0; p < pairs; p++) {
          const frac = (p + .5) / pairs
          orderedSlots.push(-frac, frac)
        }
      }
      for (const s of orderedSlots) {
        fanAngles.push(s * halfSpread + (leafRandom() - .5) * .09)
      }
    }

    for (let k = 0; k < fanAngles.length; k++) {
      const relAngle = fanAngles[k]
      const absFrac = Math.min(1, Math.abs(relAngle) / Math.max(.2, hub.fanSpread * .5))
      const az = hub.azimuth + relAngle
      // Center blades arch gracefully higher, outer flanking blades fan wide & slightly lower like open fingers
      const pitch = MathUtils.clamp(
        hub.pitch + (1 - absFrac) * .18 - absFrac * .14 + (leafRandom() - .5) * .09,
        -.12,
        .78,
      )
      const cosP = Math.cos(pitch)
      const dir = new Vector3(Math.cos(az) * cosP, Math.sin(pitch), Math.sin(az) * cosP).normalize()

      // Micro-stagger petiole origin along shoot axis so blades nest cleanly without Z-fighting
      const stagger = new Vector3(
        Math.cos(hub.azimuth) * (k === 0 ? .012 : -absFrac * .022),
        (1 - absFrac) * .014 - absFrac * .008,
        Math.sin(hub.azimuth) * (k === 0 ? .012 : -absFrac * .022),
      )
      const anchor = hub.anchor.clone().add(stagger)

      // Hero center blade bold & long, outer flank blades fanning gracefully outward & downward
      const sizeProfile = MathUtils.lerp(1.08, .68, absFrac ** 1.12) * (.92 + leafRandom() * .16)
      const length = baseLeafScale * hub.scale * sizeProfile * (sprayTexture ? .94 : 1)
      const width = length * (sprayTexture ? .92 : (isChibi ? .275 : .235) * (.92 + leafRandom() * .16))

      // Coherent fountain roll so flanking blades open their broad sunlit faces cleanly toward the viewer
      const sideSign = relAngle === 0 ? (leafRandom() < .5 ? -1 : 1) : Math.sign(relAngle)
      const roll = sideSign * (.18 + absFrac * .34) + (leafRandom() - .5) * .10

      // Rich emerald-to-sunlit-lime tonal range: shaded inner/lower fans sit deep emerald, sunlit outer crests flash bright chartreuse
      const bladeLight = clamp(hub.light * .82 + (1 - absFrac) * .18 + Math.sin(pitch) * .14 + (leafRandom() - .5) * .16)
      const shade = 1 - B.aoStrength * (1 - hub.depth) * .56 + (leafRandom() - .5) * B.tintVariance
      const pigment = innerTint.clone().lerp(outerTint, bladeLight).multiplyScalar(shade)
      const droop = B.leafDroop * hub.droopScale * MathUtils.lerp(.90, 1.14, absFrac)

      emitLeaf(anchor, dir, length, width, roll, droop, pigment)
    }
  }

  // 3. Grow segmented side branches & collect structured palmate fan hubs
  function growBranch(
    hubs: FanHub[],
    node: CulmNode,
    azimuth: number,
    length: number,
    rise: number,
    light: number,
    depth: number,
    divisions: number,
    fanScale: number,
    branchRandom: () => number,
    isCrownShoot = false,
  ) {
    const out = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth))
    const aside = new Vector3(-out.z, 0, out.x)
    const root = node.pos.clone().addScaledVector(out, node.radius * (isCrownShoot ? .35 : .82))
    const sweep = (branchRandom() - .5) * length * .22
    const branchPoints = [
      root,
      root.clone().addScaledVector(out, length * .34).addScaledVector(UP, rise * .52),
      root.clone().addScaledVector(out, length * .72).addScaledVector(UP, rise * .88).addScaledVector(aside, sweep * .55),
      root.clone().addScaledVector(out, length).addScaledVector(UP, rise).addScaledVector(aside, sweep),
    ]
    const branch = new CatmullRomCurve3(branchPoints)
    const branchRadius = Math.min(length * .026, Math.max(.007, node.radius * (isCrownShoot ? .17 : .21)))
    pushTwigTube(
      branch.getPoints(ringDetail === 2 ? 7 : 4),
      branchRadius,
      branchRadius * .22,
      branchSegs,
      branchBaseColor,
      branchTipColor,
      nodeLipColor,
    )
    branchCount++

    // Primary terminal hero palmate fan at the branch tip
    const tipPos = branch.getPoint(1)
    const tipTan = branch.getTangent(1)
    const tipAz = Math.atan2(tipTan.z, tipTan.x)
    hubs.push({
      anchor: tipPos,
      azimuth: tipAz,
      pitch: isCrownShoot ? .32 : .16,
      scale: fanScale * 1.10,
      weight: 1.55,
      light: clamp(light + .16),
      depth: Math.min(1, depth + .16),
      maxBlades: sprayTexture ? 2 : 7,
      fanSpread: isCrownShoot ? 2.25 : 2.38,
      droopScale: isCrownShoot ? 1.04 : 1.14,
    })

    // Lush mid-branch fan bridging culm & outer tip so branches read full & organic (no bare skinny sticks)
    if (length > .24 && !isCrownShoot) {
      const midPos = branch.getPoint(.52)
      const midAz = tipAz + (branchRandom() < .5 ? 1 : -1) * .48
      hubs.push({
        anchor: midPos,
        azimuth: midAz,
        pitch: .28,
        scale: fanScale * .78,
        weight: .85,
        light: clamp(light - .04),
        depth: depth * .76,
        maxBlades: sprayTexture ? 1 : 4,
        fanSpread: 1.85,
        droopScale: .96,
      })
    }

    // Tender small axil leaves tucked near branch base for botanical scale hierarchy
    if (length > .32 && !isCrownShoot) {
      const axilPos = branch.getPoint(.22)
      const axilAz = tipAz + (branchRandom() < .5 ? -1 : 1) * .72
      hubs.push({
        anchor: axilPos,
        azimuth: axilAz,
        pitch: .44,
        scale: fanScale * .48,
        weight: .42,
        light: clamp(light - .12),
        depth: depth * .58,
        maxBlades: sprayTexture ? 1 : 3,
        fanSpread: 1.35,
        droopScale: .76,
      })
    }

    // Alternating slender sub-shoots along the outer 60% of the branch, each ending in a cascading palmate fan
    for (let i = 0; i < divisions; i++) {
      const station = .44 + (i + .25 + branchRandom() * .35) / Math.max(1, divisions) * .44
      const anchor = branch.getPoint(Math.min(.90, station))
      const side = i % 2 === 0 ? 1 : -1
      const yaw = tipAz + side * (.55 + branchRandom() * .32)
      const reach = length * MathUtils.lerp(.50, .32, station) * (.84 + branchRandom() * .24)
      const twigDir = new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
      const lift = reach * (.26 + branchRandom() * .34)
      const twigPoints = [
        anchor,
        anchor.clone().addScaledVector(twigDir, reach * .52).addScaledVector(UP, lift * .72),
        anchor.clone().addScaledVector(twigDir, reach).addScaledVector(UP, lift),
      ]
      const twig = new CatmullRomCurve3(twigPoints)
      if (!opt.cullHiddenWood) {
        pushTwigTube(twig.getPoints(4), branchRadius * .50, branchRadius * .16, 4, branchBaseColor, branchTipColor, nodeLipColor)
        branchCount++
      }
      const subTip = twig.getPoint(1)
      hubs.push({
        anchor: subTip,
        azimuth: yaw,
        pitch: .14 + (isCrownShoot ? .12 : 0),
        scale: fanScale * MathUtils.lerp(.96, .78, station),
        weight: 1.08,
        light: clamp(light + (branchRandom() - .35) * .18),
        depth: Math.min(1, depth + .08),
        maxBlades: sprayTexture ? 2 : 5,
        fanSpread: 2.08,
        droopScale: 1.08,
      })
    }
  }

  for (const [culmIndex, culmEntry] of culms.entries()) {
    const { nodes: culmNodes, hScale } = culmEntry
    const isPrimary = culmIndex === 0
    const branchRandom = rng(seedFor(spec.seed, 5601 + culmIndex))
    const leafRandom = rng(seedFor(spec.seed, 5901 + culmIndex))
    const sizeScale = isPrimary ? 1 : MathUtils.lerp(.60, .86, hScale)
    const possibleNodes = culmNodes.slice(1, -1)
    const minCanopyT = isPrimary ? B.canopyStart : Math.max(.20, B.canopyStart * .66)
    const eligible = possibleNodes.filter(node => node.t >= minCanopyT)
    const nodes = eligible.length ? eligible : possibleNodes.slice(-1)
    const groups = Math.min(Math.max(1, Math.round(B.tiers)), nodes.length)
    const hubs: FanHub[] = []

    // Camera-friendly alternating left/right + 3D depth phase so the hero culm fans cleanly
    const basePhase = isPrimary ? -.18 : (culmIndex === 1 ? Math.PI - .24 : Math.PI + .38)

    for (const [i, node] of nodes.entries()) {
      const local = nodes.length <= 1 ? 1 : i / (nodes.length - 1)
      const tier = Math.floor(i * groups / Math.max(1, nodes.length))
      // Alternate primary wings cleanly left/right with gentle 3D depth swing
      const wing = (i % 2 === 0) ? 0 : Math.PI
      const depthSwing = ((tier % 3) - 1) * .36
      const azimuth = basePhase + wing + depthSwing + (branchRandom() - .5) * .28

      // Fullest sculptural reach in mid-upper tiers, cleaner & tighter near lower stem
      const bell = Math.sin(MathUtils.lerp(.18, .88, local) * Math.PI)
      const profile = MathUtils.lerp(.58, 1.16, bell)
      const length = branchReach * sizeScale * profile * (.90 + branchRandom() * .20)
      const rise = length * (.48 + branchRandom() * .22)
      const light = .18 + local * .48 + Math.cos(azimuth - .65) * .18 + (branchRandom() - .5) * .12
      const divisions = isPrimary ? (local > .2 ? 2 : 1) : 1
      const fanScale = MathUtils.lerp(.78, 1.06, bell)

      growBranch(hubs, node, azimuth, length, rise, light, .72 + local * .18, divisions, fanScale, branchRandom)

      // Upper & mid-upper hero nodes sprout a graceful secondary counter-branch for full 360° volume
      const addCounter = isPrimary && (local >= .35 || i === nodes.length - 1)
      if (addCounter) {
        const counterAz = azimuth + (i % 2 === 0 ? 1 : -1) * (2.35 + (branchRandom() - .5) * .45)
        const counterLen = length * (.68 + branchRandom() * .16)
        const counterRise = counterLen * (.50 + branchRandom() * .20)
        growBranch(
          hubs,
          node,
          counterAz,
          counterLen,
          counterRise,
          clamp(light - .06),
          .62 + local * .18,
          1,
          fanScale * .88,
          branchRandom,
        )
      }
    }

    // Compact lush sprouting crown umbrella hugging right onto the culm apex!
    if (isPrimary) {
      const apex = culmNodes[culmNodes.length - 1]
      const crownAnchors = B.hollowTop ? 3 : 2
      for (let k = 0; k < crownAnchors; k++) {
        const az = basePhase + .45 + (k / crownAnchors) * Math.PI * 2 + (branchRandom() - .5) * .30
        const len = branchReach * (.24 + k * .04) * (.90 + branchRandom() * .16)
        const rise = len * (.68 + branchRandom() * .22)
        growBranch(
          hubs,
          apex,
          az,
          len,
          rise,
          .82 + (branchRandom() - .5) * .10,
          .96,
          1,
          .96,
          branchRandom,
          true,
        )
      }
      // Small tender upright crown center tuft right above the cut rim
      hubs.push({
        anchor: apex.pos.clone().add(new Vector3(0, .06, 0)),
        azimuth: basePhase + 1.1,
        pitch: .48,
        scale: .62,
        weight: .72,
        light: .86,
        depth: 1.0,
        maxBlades: sprayTexture ? 1 : 4,
        fanSpread: 2.6,
        droopScale: .95,
      })
    } else if (!B.hollowTop) {
      const apex = culmNodes[culmNodes.length - 1]
      const len = branchReach * sizeScale * .32
      growBranch(hubs, apex, basePhase + .25, len, len * .72, .68, .86, 1, .84, branchRandom, true)
    }

    // Distribute requested leafCount budget cleanly across all palmate fan hubs
    const culmBudgetFactor = isPrimary ? 1 : MathUtils.lerp(.32, .62, hScale)
    const targetCount = Math.max(3, Math.round(B.leafCount * culmBudgetFactor * (1 - reduce) * (sprayTexture ? .42 : 1)))
    const totalWeight = hubs.reduce((sum, h) => sum + h.weight, 0) || 1
    const baseLeafScale = B.leafSize * sizeScale * areaBoost
    let cumulative = 0
    let emitted = 0
    for (let hIdx = 0; hIdx < hubs.length; hIdx++) {
      const hub = hubs[hIdx]
      cumulative += hub.weight / totalWeight
      const end = hIdx === hubs.length - 1 ? targetCount : Math.min(targetCount, Math.round(cumulative * targetCount))
      const assigned = Math.max(1, Math.min(hub.maxBlades, end - emitted))
      emitted += assigned
      emitPalmateFan(hub, assigned, baseLeafScale, leafRandom)
    }
  }

  const culmsGeometry = new BufferGeometry()
  culmsGeometry.setAttribute('position', new Float32BufferAttribute(woodPos, 3))
  culmsGeometry.setAttribute('color', new Float32BufferAttribute(woodCol, 3))
  culmsGeometry.setIndex(woodIdx)
  culmsGeometry.computeVertexNormals()
  culmsGeometry.computeBoundingBox()
  culmsGeometry.computeBoundingSphere()

  const leavesGeometry = new BufferGeometry()
  leavesGeometry.setAttribute('position', new Float32BufferAttribute(leafPos, 3))
  leavesGeometry.setAttribute('normal', new Float32BufferAttribute(leafNor, 3))
  leavesGeometry.setAttribute('uv', new Float32BufferAttribute(leafUv, 2))
  leavesGeometry.setAttribute('color', new Float32BufferAttribute(leafCol, 3))
  leavesGeometry.setAttribute('leafCenter', new BufferAttribute(new Float32Array(leafCen), 3))
  leavesGeometry.setAttribute('leafCorner', new BufferAttribute(new Float32Array(leafCor), 2))
  leavesGeometry.setIndex(leafIdx)
  leavesGeometry.computeBoundingBox()
  leavesGeometry.computeBoundingSphere()

  return { culmsGeometry, leavesGeometry, branches: culmCount + branchCount, leaves: leafCardTotal }
}

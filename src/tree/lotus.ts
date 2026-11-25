// Emergent lotus and floating water lilies share the same leaf and flower meshes.
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

interface PlacedPad {
  center: Vector3
  radius: number
  normal: Vector3
  angle: number
  cup: number
  wave: number
  phase: number
  cleft: number
  tear: number
}

interface Stalk {
  curve: CatmullRomCurve3
  samples: Vector3[]
  radius: number
}

interface Disk {
  center: Vector3
  radius: number
}

function diskGap(a: Disk, b: Disk) {
  return Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z) - a.radius - b.radius
}

function padHub(pad: PlacedPad) {
  return pad.center.clone().addScaledVector(pad.normal, -pad.cup * pad.radius * .34)
}

export interface BuiltLotus {
  stemsGeometry?: BufferGeometry
  leavesGeometry: BufferGeometry
  petalsGeometry?: BufferGeometry
  centersGeometry?: BufferGeometry
  stems: number
  leaves: number
  flowers: number
}

export function buildLotus(spec: TreeSpec, env: CrownEnvelope): BuiltLotus {
  const L = spec.lotus
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 6173))

  const detail = MathUtils.clamp(opt.woodDetail, .2, 1)
  const reduce = MathUtils.clamp(opt.cardReduction, 0, .78)
  const stemRadialSegs = Math.max(4, Math.round(7 * detail))
  const stemLengthSegs = Math.max(4, Math.round(9 * detail))
  const padAngSegs = Math.round(MathUtils.lerp(16, opt.flatCards ? 24 : 40, detail))
  const padRadialRings = opt.flatCards ? 2 : Math.round(MathUtils.lerp(3, L.withStems ? 5 : 4, detail))
  const petalSubU = opt.flatCards ? 2 : 4
  const petalSubV = opt.flatCards ? 4 : 7

  const stemPos: number[] = []
  const stemCol: number[] = []
  const stemIdx: number[] = []

  const leafPos: number[] = []
  const leafUv: number[] = []
  const leafCol: number[] = []
  const leafCen: number[] = []
  const leafCor: number[] = []
  const leafIdx: number[] = []

  const petalPos: number[] = []
  const petalUv: number[] = []
  const petalCol: number[] = []
  const petalCen: number[] = []
  const petalCor: number[] = []
  const petalIdx: number[] = []

  const centerPos: number[] = []
  const centerCol: number[] = []
  const centerIdx: number[] = []

  const stemBaseC = new Color(L.stemColor).multiplyScalar(.78)
  const stemTopC = new Color(L.stemColor).lerp(new Color('#89af59'), .26)
  const calyxC = new Color(L.stemColor).lerp(new Color('#54a242'), .28)
  const leafInnerC = new Color(L.leafTintInner)
  const leafOuterC = new Color(L.leafTintOuter)
  const petalBaseC = new Color(L.petalBaseColor)
  const petalTipC = new Color(L.petalTipColor)
  const sepalTipC = new Color(L.stemColor).lerp(petalTipC, .32)
  const stamenC = new Color(L.stamenColor)
  const podGreenC = new Color('#b8c84e').lerp(stamenC, .45)

  // A tapered tube ends against the underside of the leaf or the flower receptacle.
  const emitStem = (stalk: Stalk) => {
    const rBase = stalk.radius, rTip = rBase * .55
    const pts = stalk.curve.getPoints(stemLengthSegs)
    const { normals, binormals } = transportFrames(pts)
    const start = stemPos.length / 3
    const c = new Color()
    for (let i = 0; i < pts.length; i++) {
      const f = i / Math.max(1, pts.length - 1)
      const rr = MathUtils.lerp(rBase, rTip, f ** .78)
      c.copy(stemBaseC).lerp(stemTopC, f)
      for (let j = 0; j < stemRadialSegs; j++) {
        const a = (j / stemRadialSegs) * Math.PI * 2
        const px = pts[i].x + (normals[i].x * Math.cos(a) + binormals[i].x * Math.sin(a)) * rr
        const py = Math.max(0, pts[i].y + (normals[i].y * Math.cos(a) + binormals[i].y * Math.sin(a)) * rr)
        const pz = pts[i].z + (normals[i].z * Math.cos(a) + binormals[i].z * Math.sin(a)) * rr
        stemPos.push(px, i === 0 ? 0 : py, pz)
        stemCol.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < stemRadialSegs; j++) {
        const a = start + i * stemRadialSegs + j
        const b = start + i * stemRadialSegs + (j + 1) % stemRadialSegs
        stemIdx.push(a, b, b + stemRadialSegs, a, b + stemRadialSegs, a + stemRadialSegs)
      }
    }
  }

  const emitLotusPad = (pad: PlacedPad, hueShift: number) => {
    const { center, normal, radius, angle, cup, wave, phase, cleft, tear } = pad
    const tangent = anyPerpendicular(normal).applyAxisAngle(normal, angle)
    const bitangent = new Vector3().crossVectors(normal, tangent)
    const open = cleft > 0
    const cols = padAngSegs + Number(open)
    const hub = padHub(pad)
    hub.y = Math.max(.004, hub.y)
    const start = leafPos.length / 3
    const shade = 1 + hueShift * L.tintVariance
    const dark = leafInnerC.clone().multiplyScalar(shade)
    const light = leafOuterC.clone().multiplyScalar(1 + (shade - 1) * .82)
    const color = new Color()

    leafPos.push(hub.x, hub.y, hub.z)
    leafUv.push(.5, .5)
    color.copy(dark).lerp(light, .23)
    leafCol.push(color.r, color.g, color.b)
    leafCen.push(center.x, center.y, center.z)
    leafCor.push(0, 0)

    for (let ring = 1; ring <= padRadialRings; ring++) {
      const radial = ring / padRadialRings
      const slit = cleft * MathUtils.smoothstep(radial, 0, .78)
      for (let j = 0; j < cols; j++) {
        const fraction = j / padAngSegs
        const a = slit + (Math.PI * 2 - 2 * slit) * fraction
        const cos = Math.cos(a), sin = Math.sin(a)
        const rim = MathUtils.smoothstep(radial, .56, 1)
        const ripple = .52 * Math.sin(a * 3 + phase) + .31 * Math.sin(a * 5 - phase) + .17 * Math.cos(a * 8 + phase)
        const edgeNick = tear * rim * Math.max(0, Math.cos(a - phase * .6)) ** 32
        const outline = 1 + radial * .026 * Math.cos(2 * a + phase)
          + rim * (.028 * Math.sin(a * 3 + phase) + .024 * Math.cos(a * 7 - phase)) - edgeNick
        const shoulder = open ? Math.min(fraction, 1 - fraction) : 1
        const radiusHere = radius * radial * outline * (.975 + .025 * MathUtils.smoothstep(shoulder, 0, .06))
        const dish = cup * (radial ** 1.8 - .34)
        const edgeLift = (L.withStems ? .022 : .013) * rim * rim
        const height = radius * (dish + radial * radial * ripple * wave + edgeLift)
        const x = cos * radiusHere, z = sin * radiusHere
        const point = center.clone().addScaledVector(tangent, x).addScaledVector(bitangent, z).addScaledVector(normal, height)
        const uvRadius = .465 * radial
        // Keep low-frequency pigment across the whole surface and leave the fine veins to the texture.
        const hue = clamp(.11 + .71 * MathUtils.smoothstep(radial, 0, .91)
          + .13 * Math.sin(a + phase) * radial + .042 * Math.sin(a * 3 - phase) * radial)
        color.copy(dark).lerp(light, hue)
        color.multiplyScalar(1 + ripple * radial * .054)

        leafPos.push(point.x, Math.max(.004, point.y), point.z)
        leafUv.push(.5 + cos * uvRadius, .5 + sin * uvRadius)
        leafCol.push(color.r, color.g, color.b)
        leafCen.push(center.x, center.y, center.z)
        leafCor.push(x, z)
      }
    }

    for (let j = 0; j < padAngSegs; j++) {
      const next = open ? j + 1 : (j + 1) % cols
      leafIdx.push(start, start + 1 + j, start + 1 + next)
      for (let ring = 1; ring < padRadialRings; ring++) {
        const inner = start + 1 + (ring - 1) * cols
        const outer = inner + cols
        leafIdx.push(inner + j, outer + j, outer + next, inner + j, outer + next, inner + next)
      }
    }
  }

  // Each petal is a tapered curved surface. The modeled outline also works with an opaque texture.
  const emitPetal = (
    baseCenter: Vector3,
    up: Vector3,
    radial: Vector3,
    width: number,
    length: number,
    tilt: number,
    cup: number,
    curl: number,
    baseColor: Color,
    tipColor: Color,
  ) => {
    const side = new Vector3().crossVectors(up, radial)
    const spine = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(radial, Math.sin(tilt))
    const outer = radial.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, -Math.sin(tilt))
    const start = petalPos.length / 3
    const color = new Color()

    for (let j = 0; j <= petalSubV; j++) {
      const v = j / petalSubV
      const swell = Math.sin(Math.PI * v)
      const outline = .035 + .965 * Math.sin(Math.PI * v ** .92) ** .72
      const center = baseCenter.clone()
        .addScaledVector(spine, v * length)
        .addScaledVector(outer, length * (.22 * cup * swell - .31 * curl * v ** 3))
      for (let i = 0; i <= petalSubU; i++) {
        const u = i / petalSubU
        const lateral = 2 * u - 1
        const across = (u - .5) * width * outline
        const point = center.clone().addScaledVector(side, across)
          .addScaledVector(outer, -lateral * lateral * width * .23 * outline * cup)
        const pigment = clamp(.08 + .68 * v ** 1.48 + .22 * MathUtils.smoothstep(v, .72, 1) + .09 * lateral ** 2 * swell)
        color.copy(baseColor).lerp(tipColor, pigment)
        petalPos.push(point.x, Math.max(.005, point.y), point.z)
        petalUv.push(.5 + (u - .5) * .76 * outline, .035 + v * .93)
        petalCol.push(color.r, color.g, color.b)
        petalCen.push(baseCenter.x, baseCenter.y, baseCenter.z)
        petalCor.push(across, v * length)
      }
    }
    for (let j = 0; j < petalSubV; j++) {
      for (let i = 0; i < petalSubU; i++) {
        const a = start + j * (petalSubU + 1) + i
        const b = a + 1, c = a + petalSubU + 1
        petalIdx.push(a, b, c + 1, a, c + 1, c)
      }
    }
  }

  // Helper: emit golden lotus seedpod + radiating stamens into `centersGeometry`
  const emitSeedpodAndStamens = (baseCenter: Vector3, upAxis: Vector3, flowerR: number) => {
    const up = upAxis.clone().normalize()
    const tA = anyPerpendicular(up)
    const tB = new Vector3().crossVectors(up, tA).normalize()
    const podSegs = Math.max(6, Math.round(9 * detail))
    const podRBot = flowerR * .09
    const podRTop = flowerR * .19
    const podH = flowerR * .22

    // Inverted conical golden-green lotus seedpod receptacle
    const baseRow = centerPos.length / 3
    for (let j = 0; j < podSegs; j++) {
      const a = (j / podSegs) * Math.PI * 2
      const ca = Math.cos(a), sa = Math.sin(a)
      const p = baseCenter.clone().addScaledVector(tA, ca * podRBot).addScaledVector(tB, sa * podRBot)
      centerPos.push(p.x, Math.max(.005, p.y), p.z)
      centerCol.push(podGreenC.r * .82, podGreenC.g * .82, podGreenC.b * .82)
    }
    const topRow = centerPos.length / 3
    for (let j = 0; j < podSegs; j++) {
      const a = (j / podSegs) * Math.PI * 2
      const ca = Math.cos(a), sa = Math.sin(a)
      const p = baseCenter.clone()
        .addScaledVector(up, podH)
        .addScaledVector(tA, ca * podRTop)
        .addScaledVector(tB, sa * podRTop)
      centerPos.push(p.x, Math.max(.005, p.y), p.z)
      centerCol.push(podGreenC.r, podGreenC.g, podGreenC.b)
    }
    const topCenter = centerPos.length / 3
    const tcPos = baseCenter.clone().addScaledVector(up, podH * 1.06)
    centerPos.push(tcPos.x, Math.max(.005, tcPos.y), tcPos.z)
    centerCol.push(stamenC.r, stamenC.g, stamenC.b)

    for (let j = 0; j < podSegs; j++) {
      const jn = (j + 1) % podSegs
      centerIdx.push(baseRow + j, baseRow + jn, topRow + jn, baseRow + j, topRow + jn, topRow + j)
      centerIdx.push(topRow + j, topRow + jn, topCenter)
    }

    // Ring of slender golden stamen filaments around the seedpod!
    const stamenCount = Math.max(8, Math.round(14 * detail))
    const sLen = flowerR * .26
    const sW = flowerR * .018
    for (let k = 0; k < stamenCount; k++) {
      const a = (k / stamenCount) * Math.PI * 2 + random() * .25
      const ca = Math.cos(a), sa = Math.sin(a)
      const rad = tA.clone().multiplyScalar(ca).addScaledVector(tB, sa)
      const side = tA.clone().multiplyScalar(-sa).addScaledVector(tB, ca)
      const pBase = baseCenter.clone().addScaledVector(rad, podRBot * 1.15).addScaledVector(up, podH * .18)
      const pTip = pBase.clone().addScaledVector(rad, sLen * .58).addScaledVector(up, sLen * .92)
      const s0 = pBase.clone().addScaledVector(side, -sW)
      const s1 = pBase.clone().addScaledVector(side, sW)
      const s2 = pTip.clone().addScaledVector(side, sW * 1.55)
      const s3 = pTip.clone().addScaledVector(side, -sW * 1.55)
      const emitStamenQuad = (flip: boolean) => {
        const stStart = centerPos.length / 3
        for (const q of [s0, s1]) {
          centerPos.push(q.x, Math.max(.005, q.y), q.z)
          centerCol.push(stamenC.r * .86, stamenC.g * .78, stamenC.b * .65)
        }
        for (const q of [s2, s3]) {
          centerPos.push(q.x, Math.max(.005, q.y), q.z)
          centerCol.push(Math.min(1, stamenC.r * 1.12), Math.min(1, stamenC.g * 1.08), stamenC.b)
        }
        if (!flip) centerIdx.push(stStart, stStart + 1, stStart + 2, stStart, stStart + 2, stStart + 3)
        else centerIdx.push(stStart, stStart + 2, stStart + 1, stStart, stStart + 3, stStart + 2)
      }
      emitStamenQuad(false)
      emitStamenQuad(true)
    }
  }

  // Helper: emit full multi-ring blooming lotus flower (outer sepals + 2..4 staggered petal tiers + golden core)
  const emitLotusBlossom = (center: Vector3, upAxis: Vector3, flowerDia: number) => {
    const up = upAxis.clone().normalize()
    const tA = anyPerpendicular(up)
    const tB = new Vector3().crossVectors(up, tA).normalize()
    const r = flowerDia * .5
    const rings = Math.max(2, Math.min(4, Math.round(L.petalRings)))
    const perRingBase = Math.max(5, Math.min(12, Math.round(L.petalsPerRing * (1 - reduce * .35))))
    const rotBase = random() * Math.PI * 2
    const open = clamp(L.flowerOpen, .15, 1.0)

    // Subtle green-tinted outer calyx sepals cradling the underside
    const sepalCount = Math.max(4, Math.round(perRingBase * .58))
    for (let k = 0; k < sepalCount; k++) {
      const a = rotBase + (k / sepalCount) * Math.PI * 2 + .2
      const radDir = tA.clone().multiplyScalar(Math.cos(a)).addScaledVector(tB, Math.sin(a))
      const baseP = center.clone().addScaledVector(radDir, r * .07).addScaledVector(up, -r * .02)
      emitPetal(
        baseP, up, radDir,
        r * .26, r * .33,
        MathUtils.degToRad(MathUtils.lerp(45, 77, open)),
        .52, -.17,
        calyxC, sepalTipC,
      )
    }

    // Concentric staggered petal tiers (outermost -> innermost)
    for (let ring = 0; ring < rings; ring++) {
      const rf = ring / Math.max(1, rings - 1) // 0 = outer wide tier, 1 = inner upright tier
      const count = Math.max(5, Math.round(perRingBase * MathUtils.lerp(1.05, .72, rf)))
      const ringOffset = rotBase + ring * (Math.PI / count)
      const tiltDeg = MathUtils.lerp(
        MathUtils.lerp(41, 77, open),
        MathUtils.lerp(13, 51, open),
        rf,
      )
      const pLen = r * MathUtils.lerp(1.10, .72, rf)
      const pWidth = r * MathUtils.lerp(.76, .61, rf)
      const ringRad = r * MathUtils.lerp(.11, .04, rf)
      const ringLift = r * rf * .11
      // Outer ring slightly richer tip pigment, inner ring extra glowing pale cream-pink
      const cBase = petalBaseC.clone().lerp(new Color('#ffffff'), rf * .25)
      const cTip = petalTipC.clone().lerp(petalBaseC, rf * .22)

      for (let k = 0; k < count; k++) {
        const a = ringOffset + (k / count) * Math.PI * 2 + (random() - .5) * .12
        const radDir = tA.clone().multiplyScalar(Math.cos(a)).addScaledVector(tB, Math.sin(a))
        const baseP = center.clone().addScaledVector(radDir, ringRad).addScaledVector(up, ringLift)
        const tiltRad = MathUtils.degToRad(tiltDeg + (random() - .5) * 6)
        emitPetal(
          baseP, up, radDir,
          pWidth * (.92 + random() * .16),
          pLen * (.94 + random() * .12),
          tiltRad,
          MathUtils.lerp(.64, .98, rf),
          MathUtils.lerp(.34, .24, rf),
          cBase, cTip,
        )
      }
    }

    emitSeedpodAndStamens(center, up, r)
  }

  // Helper: emit a plump unopened / half-open lotus bud (teardrop cupped petals + green sepal collar)
  const emitLotusBud = (center: Vector3, upAxis: Vector3, budScale: number) => {
    const up = upAxis.clone().normalize()
    const tA = anyPerpendicular(up)
    const tB = new Vector3().crossVectors(up, tA).normalize()
    const r = budScale * .44
    const rotBase = random() * Math.PI * 2
    const cTipDeep = petalTipC.clone().multiplyScalar(.92)

    // Outer green-blush calyx bracts
    for (let k = 0; k < 4; k++) {
      const a = rotBase + (k / 4) * Math.PI * 2
      const radDir = tA.clone().multiplyScalar(Math.cos(a)).addScaledVector(tB, Math.sin(a))
      const baseP = center.clone().addScaledVector(radDir, r * .08)
      emitPetal(baseP, up, radDir, r * .72, r * .82, MathUtils.degToRad(24), .92, .58, calyxC, sepalTipC)
    }
    // 6 tightly cupped overlapping teardrop lotus bud petals
    for (let k = 0; k < 6; k++) {
      const a = rotBase + (k / 6) * Math.PI * 2 + .32
      const radDir = tA.clone().multiplyScalar(Math.cos(a)).addScaledVector(tB, Math.sin(a))
      const baseP = center.clone().addScaledVector(radDir, r * .06).addScaledVector(up, r * .04)
      emitPetal(baseP, up, radDir, r * .85, r * 1.31, MathUtils.degToRad(10 + (k % 2) * 2), 1.3, .83, petalBaseC, cTipDeep)
    }
  }

  const wantedLeaves = Math.max(2, Math.round(L.leafCount * (1 - reduce * .55)))
  const wantedFlowers = Math.max(0, Math.round(L.flowerCount * (1 - reduce * .35)))
  const wantedBuds = Math.max(0, Math.round(L.budCount * (1 - reduce * .45)))

  const placedPads: PlacedPad[] = []
  const flowerSites: Disk[] = []
  const stalks: Stalk[] = []
  const sizeVariance = clamp(L.leafSizeVariance, 0, .75)
  const phase = random() * Math.PI * 2
  let stemTotal = 0
  let leafTotal = 0
  let flowerTotal = 0

  const makePad = (center: Vector3, radius: number, normal: Vector3): PlacedPad => ({
    center, radius, normal,
    angle: random() * Math.PI * 2,
    phase: random() * Math.PI * 2,
    cup: L.leafCup * (.82 + random() * .32),
    wave: L.leafWave * (.75 + random() * .36),
    cleft: !L.withStems && random() < L.leafNotch ? MathUtils.degToRad(6 + random() * 6) : 0,
    tear: L.withStems ? L.leafNotch * (.05 + random() * .075) : 0,
  })

  const addPad = (pad: PlacedPad) => {
    emitLotusPad(pad, random() * 2 - 1)
    placedPads.push(pad)
    leafTotal++
  }

  const makeStalk = (tip: Vector3, raw: Vector3, outward: Vector3, thickness: number, rootFraction = .64): Stalk => {
    // Nearby plants start from separate rhizome positions. The lower stalk is nearly vertical.
    const side = new Vector3(-outward.z, 0, outward.x)
    const root = new Vector3(raw.x * rootFraction, 0, raw.z * rootFraction)
    const lower = root.clone().lerp(tip, .26)
    lower.x = MathUtils.lerp(root.x, tip.x, .16)
    lower.z = MathUtils.lerp(root.z, tip.z, .16)
    const upper = root.clone().lerp(tip, .68)
      .addScaledVector(outward, -L.stemCurve * tip.y * .058)
      .addScaledVector(side, Math.sin(raw.x * 5.1 + raw.z * 4.7) * L.stemCurve * tip.y * .063)
    const curve = new CatmullRomCurve3([root, lower, upper, tip])
    return { curve, samples: curve.getPoints(40), radius: L.stemRadius * thickness }
  }

  const addStalk = (stalk: Stalk) => {
    emitStem(stalk)
    stalks.push(stalk)
    stemTotal++
  }

  const stalkTouchesPad = (stalk: Stalk, pad: PlacedPad) => {
    const support = new Vector3()
    const extent = pad.radius * 1.047 + stalk.radius
    const tolerance = pad.wave * pad.radius + stalk.radius + .023
    for (const point of stalk.samples) {
      support.copy(point).sub(pad.center)
      const distance = support.dot(pad.normal)
      const radial = Math.sqrt(Math.max(0, support.lengthSq() - distance * distance))
      if (radial > extent) continue
      const f = Math.min(1, radial / pad.radius)
      const dish = pad.radius * (pad.cup * (f ** 1.8 - .34) + .022 * MathUtils.smoothstep(f, .56, 1) ** 2)
      if (Math.abs(distance - dish) < tolerance) return true
    }
    return false
  }

  const padsTouch = (a: PlacedPad, b: PlacedPad) => {
    const dx = b.center.x - a.center.x
    const dz = b.center.z - a.center.z
    const distance = Math.hypot(dx, dz)
    if (distance > (a.radius + b.radius) * 1.04) return false
    // Test the two tilted leaf surfaces in their overlapping footprint.
    const f = distance > .0001 ? clamp((distance + a.radius - b.radius) / (2 * distance)) : .5
    const x = a.center.x + dx * f
    const z = a.center.z + dz * f
    const span = Math.min(a.radius, b.radius) * Math.sqrt(clamp(1 - distance / ((a.radius + b.radius) * 1.04)))
    const band = (pad: PlacedPad) => {
      const n = pad.normal
      const plane = pad.center.y - ((x - pad.center.x) * n.x + (z - pad.center.z) * n.z) / n.y
      const uncertainty = span * Math.hypot(n.x, n.z) / n.y + pad.radius * pad.wave + .012
      return [plane - .34 * pad.cup * pad.radius - uncertainty, plane + (.66 * pad.cup + .022) * pad.radius + uncertainty]
    }
    const [aLo, aHi] = band(a), [bLo, bHi] = band(b)
    return aLo < bHi && bLo < aHi
  }

  function clearEmergentPad(site: Disk) {
    let clearance = 0
    for (const pad of placedPads) {
      if (diskGap(site, pad) > pad.radius * .055) continue
      const slope = Math.hypot(pad.normal.x, pad.normal.z) / Math.max(.35, pad.normal.y)
      const plane = ((pad.center.x - site.center.x) * pad.normal.x
        + (pad.center.z - site.center.z) * pad.normal.z) / Math.max(.35, pad.normal.y)
      const rim = (.66 * pad.cup + pad.wave + .029) * pad.radius
      clearance = Math.max(clearance, pad.center.y + rim + Math.min(pad.radius * slope, plane + site.radius * slope))
    }
    return clearance + .024
  }

  if (L.withStems) {
    for (let i = 0; i < wantedLeaves; i++) {
      const fraction = (i + .5) / wantedLeaves
      const placement = Math.sqrt(fraction)
      const preferred = phase + i * golden
      const young = fraction > .76
      const stature = young ? .27 + random() * .23 : MathUtils.lerp(1.02, .60, placement) + random() * .27
      const radius = Math.max(.045, .5 * L.leafSize * (young ? .40 + random() * .18 : 1.14 - .26 * fraction)
        * (1 + (random() - .5) * sizeVariance))
      const thickness = young ? .62 : .85 + random() * .23
      for (let attempt = 0; attempt < 108; attempt++) {
        const angle = preferred + (random() - .5) * (attempt < 18 ? .54 : 2.6)
        const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle))
        const expansion = Math.floor(attempt / 18) * radius * .52
        const reach = L.spread * (.16 + .77 * placement) * (.84 + random() * .22) + expansion
        const height = L.stemHeight * stature * (.84 + random() * .27)
        const raw = outward.clone().multiplyScalar(reach).setY(Math.max(.12, height))
        const center = env.deform(raw, clamp(stature))
        center.y = Math.max(.12, center.y)
        if (env.bare(center) > .35) continue

        const normal = UP.clone().addScaledVector(outward, .047 + random() * .24).normalize()
        const pad = makePad(center, radius, normal)
        if (placedPads.some(other => padsTouch(pad, other)) || stalks.some(stalk => stalkTouchesPad(stalk, pad))) continue
        const junction = padHub(pad).addScaledVector(normal, -L.stemRadius * .12)
        junction.y = Math.max(.012, junction.y)
        const stalk = makeStalk(junction, raw, outward, thickness)
        if (placedPads.some(other => stalkTouchesPad(stalk, other))) continue
        addStalk(stalk)
        addPad(pad)
        break
      }
    }

    for (let i = 0; i < wantedFlowers + wantedBuds; i++) {
      const bud = i >= wantedFlowers
      const diameter = L.flowerSize * (bud ? .58 + random() * .17 : .90 + random() * .24)
      const radius = diameter * (bud ? .33 : .59)
      const nominalHeight = bud
        ? (L.stemHeight * .78 + L.flowerHeightBoost * .42) * (.94 + random() * .26)
        : (L.stemHeight + L.flowerHeightBoost) * (.84 + random() * .26)
      const preferred = phase + .9 + i * (bud ? golden : Math.PI * 2 / Math.max(1, wantedFlowers))
      let best: { stalk: Stalk; site: Disk; outward: Vector3; score: number } | undefined
      for (let attempt = 0; attempt < 68; attempt++) {
        const angle = preferred + (random() - .5) * (.48 + attempt * .013)
        const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle))
        const reach = L.spread * (.23 + random() * (bud ? .72 : .66)) + Math.floor(attempt / 22) * radius * .91
        const raw = outward.clone().multiplyScalar(reach).setY(Math.max(.14, nominalHeight))
        const center = env.deform(raw, 1)
        if (env.bare(center) > .35) continue
        const site = { center, radius }
        const gap = Math.min(.1, ...flowerSites.map(other => diskGap(site, other)))
        const lift = Math.max(0, clearEmergentPad(site) - center.y)
        const score = lift * 1.7 + Math.max(0, .035 - gap) * 6 + Math.abs(angle - preferred) * .92
        if (best && score >= best.score) continue
        center.y = Math.max(.12, center.y + lift)
        const stalk = makeStalk(center, raw, outward, bud ? .66 : .88, .76)
        if (placedPads.some(pad => stalkTouchesPad(stalk, pad))) continue
        best = { stalk, site, outward, score }

      }
      if (!best) continue
      const { stalk, site, outward } = best
      const normal = UP.clone().addScaledVector(outward, .14 + random() * .18).normalize()
      addStalk(stalk)
      if (bud) emitLotusBud(site.center, normal, diameter)
      else emitLotusBlossom(site.center, normal, diameter)
      flowerSites.push(site)
      flowerTotal++
    }
  } else {
    const disks: Disk[] = []
    const lobeCount = wantedLeaves >= 14 ? 3 : 1
    const lobes = Array.from({ length: lobeCount }, (_, i) => {
      const angle = phase + i * Math.PI * 2 / lobeCount
      return new Vector3(Math.cos(angle) * L.spread * .44, 0, Math.sin(angle) * L.spread * .38)
    })
    const findWater = (radius: number, height: number, index: number): Disk | undefined => {
      // Each occupied disk reserves free water for its rim. Crowded layouts can grow out
      // from their lobe instead of forcing a fallback that overlaps the previous pad.
      for (let ring = 0; ring < 8; ring++) {
        const reach = L.spread * (lobeCount > 1 ? .62 : .89) + Math.max(.18, radius) * ring * .95
        for (let attempt = 0; attempt < 32; attempt++) {
          const angle = random() * Math.PI * 2
          const r = Math.sqrt(random()) * reach
          const lobe = lobes[(index + (attempt > 19 ? attempt : 0)) % lobes.length]
          const center = env.deform(new Vector3(lobe.x + Math.cos(angle) * r, height, lobe.z + Math.sin(angle) * r), .65)
          center.y = Math.max(.008, height + (center.y - height) * .16)
          const site = { center, radius }
          if (env.bare(center) <= .35 && disks.every(other => diskGap(site, other) >= -.008)) {
            disks.push(site)
            return site
          }
        }
      }
      return undefined
    }

    // Reserve space for each flower before the pad bank grows around it.
    for (let i = 0; i < wantedFlowers + wantedBuds; i++) {
      const bud = i >= wantedFlowers
      const diameter = L.flowerSize * (bud ? .54 + random() * .17 : .90 + random() * .22)
      const site = findWater(diameter * (bud ? .22 : .52), bud ? .021 : .035, i)
      if (!site) continue
      const normal = new Vector3((random() - .5) * .09, 1, (random() - .5) * .09).normalize()
      if (bud) emitLotusBud(site.center, normal, diameter)
      else emitLotusBlossom(site.center, normal, diameter)
      flowerTotal++
    }

    for (let i = 0; i < wantedLeaves; i++) {
      const fraction = i / Math.max(1, wantedLeaves - 1)
      const radius = Math.max(.042, .5 * L.leafSize * MathUtils.lerp(1.12, .57, fraction ** .78)
        * (1 + (random() - .5) * sizeVariance))
      const site = findWater(radius * 1.065, .015 + random() * .006, i)
      if (!site) continue
      const normal = new Vector3((random() - .5) * .021, 1, (random() - .5) * .021).normalize()
      addPad(makePad(site.center, radius, normal))
    }
  }

  let stemsGeometry: BufferGeometry | undefined
  if (stemPos.length > 0) {
    stemsGeometry = new BufferGeometry()
    stemsGeometry.setAttribute('position', new Float32BufferAttribute(stemPos, 3))
    stemsGeometry.setAttribute('color', new Float32BufferAttribute(stemCol, 3))
    stemsGeometry.setIndex(stemIdx)
    stemsGeometry.computeVertexNormals()
    stemsGeometry.computeBoundingBox()
    stemsGeometry.computeBoundingSphere()
  }

  const leavesGeometry = new BufferGeometry()
  leavesGeometry.setAttribute('position', new Float32BufferAttribute(leafPos, 3))
  leavesGeometry.setAttribute('uv', new Float32BufferAttribute(leafUv, 2))
  leavesGeometry.setAttribute('color', new Float32BufferAttribute(leafCol, 3))
  leavesGeometry.setAttribute('leafCenter', new BufferAttribute(new Float32Array(leafCen), 3))
  leavesGeometry.setAttribute('leafCorner', new BufferAttribute(new Float32Array(leafCor), 2))
  leavesGeometry.setIndex(leafIdx)
  leavesGeometry.computeVertexNormals()
  leavesGeometry.computeBoundingBox()
  leavesGeometry.computeBoundingSphere()

  let petalsGeometry: BufferGeometry | undefined
  if (petalPos.length > 0) {
    petalsGeometry = new BufferGeometry()
    petalsGeometry.setAttribute('position', new Float32BufferAttribute(petalPos, 3))
    petalsGeometry.setAttribute('uv', new Float32BufferAttribute(petalUv, 2))
    petalsGeometry.setAttribute('color', new Float32BufferAttribute(petalCol, 3))
    petalsGeometry.setAttribute('leafCenter', new BufferAttribute(new Float32Array(petalCen), 3))
    petalsGeometry.setAttribute('leafCorner', new BufferAttribute(new Float32Array(petalCor), 2))
    petalsGeometry.setIndex(petalIdx)
    petalsGeometry.computeVertexNormals()
    petalsGeometry.computeBoundingBox()
    petalsGeometry.computeBoundingSphere()
  }

  let centersGeometry: BufferGeometry | undefined
  if (centerPos.length > 0) {
    centersGeometry = new BufferGeometry()
    centersGeometry.setAttribute('position', new Float32BufferAttribute(centerPos, 3))
    centersGeometry.setAttribute('color', new Float32BufferAttribute(centerCol, 3))
    centersGeometry.setIndex(centerIdx)
    centersGeometry.computeVertexNormals()
    centersGeometry.computeBoundingBox()
    centersGeometry.computeBoundingSphere()
  }

  return {
    stemsGeometry,
    leavesGeometry,
    petalsGeometry,
    centersGeometry,
    stems: stemTotal,
    leaves: leafTotal,
    flowers: flowerTotal,
  }
}

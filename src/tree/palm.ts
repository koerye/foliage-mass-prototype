// Stylized palm tree: ringed curved trunk (+ optional coconuts) and a layered
// crown rosette of arching, V-folded frond planes.
import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import { radiusAt, type Branch } from './skeleton'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const golden = Math.PI * (3 - Math.sqrt(5))

/** Builds the curved / S-curved palm trunk polyline in base space. */
export function buildPalmSpine(spec: TreeSpec) {
  const { trunk: T, palm: P } = spec
  const random = rng(seedFor(spec.seed, 311))
  // bias lean sideways to the default front camera so the graceful curve reads immediately
  const yaw = (random() - .5) * .9 + (random() < .5 ? .25 : Math.PI - .25)
  const dir = new Vector3(Math.cos(yaw), 0, Math.sin(yaw))
  const side = new Vector3(-dir.z, 0, dir.x)
  const samples = 24
  const points: Vector3[] = [], radii: number[] = []
  const H = T.height
  const bend = P.bend
  const sCurve = P.sCurve
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1)
    // t^1.5 and sin(PI*t)^2 both have zero slope at t = 0 so the trunk always emerges cleanly upright from the ground
    const s2 = Math.sin(Math.PI * t) ** 2
    const sweep = bend * (t ** 1.45 + sCurve * .36 * s2)
    const sway = T.wobble * Math.sin(Math.PI * t * 1.5)
    // strong S-curve dips mid-trunk gently like a sweeping beach palm, then lifts toward the crown
    const sag = sCurve > .4 ? (sCurve - .4) * Math.min(H * .34, bend * .45) * s2 : 0
    const y = Math.max(t === 0 ? 0 : .16 * t * H, H * t - sag)
    points.push(new Vector3(
      dir.x * sweep + side.x * sway,
      y,
      dir.z * sweep + side.z * sway,
    ))
    // slight swell near base + gentle taper + subtle crownshaft neck swell near top
    const taper = (1 - t * .52) ** T.taper
    const crownSwell = 1 + .12 * Math.exp(-(((1 - t) / .08) ** 2))
    radii.push(T.radius * taper * crownSwell)
  }
  return { points, radii }
}

function transportFrames(points: Vector3[]) {
  const tangents = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)]
    return b.clone().sub(a).normalize()
  })
  const normals: Vector3[] = [], binormals: Vector3[] = []
  const t0 = tangents[0]
  let n = Math.abs(t0.y) < .9 ? new Vector3(0, 1, 0).cross(t0).normalize() : new Vector3(1, 0, 0).cross(t0).normalize()
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const axis = new Vector3().crossVectors(tangents[i - 1], tangents[i])
      const s = axis.length()
      if (s > 1e-6) n = n.clone().applyAxisAngle(axis.normalize(), Math.atan2(s, tangents[i - 1].dot(tangents[i])))
      n.addScaledVector(tangents[i], -n.dot(tangents[i])).normalize()
    }
    normals.push(n.clone())
    binormals.push(new Vector3().crossVectors(tangents[i], n).normalize())
  }
  return { tangents, normals, binormals }
}

/** Ringed palm trunk + optional coconut cluster merged into a single wood mesh. */
export function buildPalmWood(trunk: Branch, spec: TreeSpec) {
  const T = spec.trunk, P = spec.palm, opt = spec.optimize
  const detail = MathUtils.clamp(opt.woodDetail, .2, 1)
  const position: number[] = [], color: number[] = [], index: number[] = []
  const barkLight = new Color('#a67c52'), barkMid = new Color('#7a5638'), ringCrease = new Color('#3d2a1b')
  const crownGreen = new Color('#586b35'), c = new Color()
  const phase = (spec.seed % 997) / 997 * Math.PI * 2

  const ringCount = Math.max(4, Math.round(P.ringCount))
  // 2 samples per palm ring at high detail so sawtooth steps read crisply; scales smoothly with LOD
  const totalRings = Math.max(8, Math.round(ringCount * (detail >= .6 ? 2.2 : detail >= .38 ? 1.4 : .8)))
  const segs = Math.max(6, Math.round(16 * detail))
  const pts = Array.from({ length: totalRings }, (_, i) => trunk.curve.getPoint(i / (totalRings - 1)))
  const { normals, binormals } = transportFrames(pts)

  for (let i = 0; i < totalRings; i++) {
    const t = i / (totalRings - 1)
    const rBase = radiusAt(trunk, t)
    const y = pts[i].y
    // sawtooth palm leaf-scar rings: swells gently toward upper lip of each ring, steps in at crease
    const ringPos = (t * ringCount) % 1
    const saw = ringPos < .18 ? ringPos / .18 * .25 : .25 + .75 * ((ringPos - .18) / .82) ** .7
    const ringFactor = 1 + P.ringStep * (saw - .45) * (1 - t * .25)
    const crease = Math.exp(-(((ringPos < .5 ? ringPos : 1 - ringPos) / .14) ** 2))
    for (let j = 0; j < segs; j++) {
      const a = j / segs * Math.PI * 2
      const lobes = Math.max(0, Math.cos(T.flareLobes * a + phase))
      const flare = 1 + T.flare * Math.exp(-y / Math.max(.05, T.flareHeight)) * (.35 + .85 * lobes ** 1.5)
      const rr = rBase * flare * ringFactor
      const p = pts[i].clone().addScaledVector(normals[i], Math.cos(a) * rr).addScaledVector(binormals[i], Math.sin(a) * rr)
      if (i === 0 || p.y < 0) p.y = 0
      position.push(p.x, p.y, p.z)
      // warm banded palm bark with darker creases and olive tint right below the crown
      c.copy(barkMid).lerp(barkLight, saw * .75 + .15 * Math.cos(a + .6))
      c.lerp(ringCrease, crease * .65)
      if (t > .9) c.lerp(crownGreen, (t - .9) / .1 * .55)
      c.multiplyScalar(.84 + .16 * Math.min(1, y / .5))
      color.push(c.r, c.g, c.b)
    }
  }
  for (let i = 0; i < totalRings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + (j + 1) % segs
      index.push(a, b, b + segs, a, b + segs, a + segs)
    }
  }
  // top cap
  const capIdx = position.length / 3
  const topPt = pts[totalRings - 1]
  position.push(topPt.x, topPt.y, topPt.z)
  color.push(crownGreen.r, crownGreen.g, crownGreen.b)
  const lastRow = (totalRings - 1) * segs
  for (let j = 0; j < segs; j++) index.push(capIdx, lastRow + j, lastRow + (j + 1) % segs)

  // optional stylized coconut cluster tucked neatly under the frond crown
  const cocoCount = Math.min(6, Math.max(0, Math.round(P.coconuts)))
  if (cocoCount > 0 && detail >= .32) {
    const random = rng(seedFor(spec.seed, 8801))
    const tip = trunk.curve.getPoint(.96)
    const tipT = trunk.curve.getTangent(.96).normalize()
    const baseR = radiusAt(trunk, .95)
    const cocoR = Math.max(.08, baseR * .72)
    const uSegs = detail >= .6 ? 8 : 6, vSegs = detail >= .6 ? 6 : 4
    const side0 = Math.abs(tipT.y) < .9 ? new Vector3(0, 1, 0).cross(tipT).normalize() : new Vector3(1, 0, 0)
    const side1 = new Vector3().crossVectors(tipT, side0).normalize()
    const cocoDark = new Color('#4c4a26'), cocoWarm = new Color('#7e7338')
    for (let k = 0; k < cocoCount; k++) {
      const a = k * Math.PI * 2 / cocoCount + random() * .4
      const radial = side0.clone().multiplyScalar(Math.cos(a)).addScaledVector(side1, Math.sin(a))
      const center = tip.clone().addScaledVector(radial, baseR + cocoR * .55).addScaledVector(tipT, -cocoR * (.6 + random() * .45))
      const start = position.length / 3
      for (let iv = 0; iv <= vSegs; iv++) {
        const phi = iv / vSegs * Math.PI
        for (let iu = 0; iu < uSegs; iu++) {
          const th = iu / uSegs * Math.PI * 2
          const rx = Math.sin(phi) * Math.cos(th) * cocoR
          const ry = Math.cos(phi) * cocoR * 1.18
          const rz = Math.sin(phi) * Math.sin(th) * cocoR
          position.push(center.x + rx, Math.max(0, center.y + ry), center.z + rz)
          c.copy(cocoDark).lerp(cocoWarm, .3 + .7 * (1 - iv / vSegs))
          color.push(c.r, c.g, c.b)
        }
      }
      for (let iv = 0; iv < vSegs; iv++) {
        for (let iu = 0; iu < uSegs; iu++) {
          const a0 = start + iv * uSegs + iu, b0 = start + iv * uSegs + (iu + 1) % uSegs
          index.push(a0, a0 + uSegs, b0 + uSegs, a0, b0 + uSegs, b0)
        }
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

/** Palm frond width profile: narrow petiole -> broad tropical blade -> tapered tip. */
export function palmFrondProfile(s: number) {
  if (s < .12) return .16 + .48 * (s / .12)
  if (s < .55) return .64 + .36 * Math.sin((s - .12) / .43 * Math.PI / 2)
  return Math.max(.08, Math.cos((s - .55) / .45 * Math.PI / 2) ** .72)
}

/** Layered rosette of arching, V-folded palm frond cards radiating from the trunk apex. */
export function buildPalmFronds(trunk: Branch, env: CrownEnvelope, spec: TreeSpec) {
  const P = spec.palm, opt = spec.optimize
  const random = rng(seedFor(spec.seed, 6611))
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const inner = new Color(P.tintInner), outer = new Color(P.tintOuter), c = new Color()
  const envN = new Vector3(), n3 = new Vector3()

  const keepRatio = Math.max(.35, 1 - opt.cardReduction)
  const widthBoost = keepRatio < 1 ? Math.min(1.55, (1 / keepRatio) ** .4) : 1
  const totalCount = Math.max(5, Math.round(P.frondCount * keepRatio))
  const segs = Math.max(3, Math.round(P.segments * (1 - opt.level * .55)))
  const cols = [-1, 0, 1] as const

  const apex = trunk.curve.getPoint(.985)
  const tipTangent = trunk.curve.getTangent(.985).normalize()
  // blend trunk tip tilt with world up so curved beach palms tilt organically yet still reach for the sun
  const crownUp = tipTangent.clone().lerp(UP, .55).normalize()
  const refX = Math.abs(crownUp.y) < .9 ? new Vector3(0, 1, 0).cross(crownUp).normalize() : new Vector3(1, 0, 0)
  const refZ = new Vector3().crossVectors(crownUp, refX).normalize()

  // split fronds into 3 staggered rings: lower/outer drooping skirt, mid arching crown, inner upright shoots
  const innerN = Math.max(2, Math.round(totalCount * .22))
  const midN = Math.max(2, Math.round(totalCount * .34))
  const outerN = Math.max(3, totalCount - innerN - midN)
  const layers = [
    { count: outerN, pitchAdd: 0, archMul: 1.08, lenMul: 1.0, yOff: -.08, phase: random() * Math.PI * 2 },
    { count: midN, pitchAdd: 18, archMul: .85, lenMul: .88, yOff: 0, phase: random() * Math.PI * 2 + golden },
    { count: innerN, pitchAdd: 38, archMul: .55, lenMul: .64, yOff: .06, phase: random() * Math.PI * 2 + golden * 2 },
  ]

  let fronds = 0
  const foldRad = P.frondFold * Math.PI / 180
  for (const layer of layers) {
    for (let k = 0; k < layer.count; k++) {
      const theta = layer.phase + k * Math.PI * 2 / layer.count + (random() - .5) * .35
      const out = refX.clone().multiplyScalar(Math.cos(theta)).addScaledVector(refZ, Math.sin(theta)).normalize()
      const L = P.frondLength * layer.lenMul * (1 + (random() * 2 - 1) * P.frondLengthVariance)
      const launch = MathUtils.degToRad(MathUtils.clamp(P.frondPitch + layer.pitchAdd + (random() - .5) * 8, 5, 84))
      const arch = P.frondArch * layer.archMul * (.88 + random() * .24)
      const roll = MathUtils.degToRad((random() * 2 - 1) * P.frondTwist)
      const shade = 1 + (random() * 2 - 1) * P.tintVariance
      const keepR = random()

      // integrate the arching frond spine from the crown apex
      const spine: Vector3[] = [apex.clone().addScaledVector(crownUp, layer.yOff)]
      const step = L / segs
      for (let i = 1; i <= segs; i++) {
        const s = (i - .5) / segs
        const pitch = launch - arch * s ** 1.35 * Math.PI * .52
        const d = out.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(crownUp, Math.sin(pitch)).normalize()
        spine.push(spine[i - 1].clone().addScaledVector(d, step))
      }
      // editable crown handles deform fronds smoothly (root stays anchored on the trunk apex)
      for (let i = 1; i <= segs; i++) spine[i] = env.deform(spine[i], i / segs)
      if (env.bare(spine[Math.round(segs * .55)]) > .35 + keepR * .4) continue

      const start = position.length / 3
      const halfW = P.frondWidth * layer.lenMul * widthBoost
      for (let i = 0; i <= segs; i++) {
        const s = i / segs
        const p = spine[i]
        const T = spine[Math.min(segs, i + 1)].clone().sub(spine[Math.max(0, i - 1)]).normalize()
        const nUp = crownUp.clone().addScaledVector(T, -crownUp.dot(T))
        if (nUp.lengthSq() < 1e-6) nUp.copy(out).addScaledVector(T, -out.dot(T))
        nUp.normalize().applyAxisAngle(T, roll)
        const side = new Vector3().crossVectors(T, nUp).normalize()
        const prof = palmFrondProfile(s)
        const w = halfW * prof
        env.normal(p, envN)
        for (const x of cols) {
          const ax = Math.abs(x)
          const q = p.clone()
            .addScaledVector(side, x * w * Math.cos(foldRad))
            .addScaledVector(nUp, -ax * w * Math.sin(foldRad))
          const geo = x === 0 ? nUp.clone()
            : nUp.clone().multiplyScalar(Math.cos(foldRad)).addScaledVector(side, Math.sign(x) * Math.sin(foldRad)).normalize()
          n3.copy(geo).lerp(envN, P.spherize)
          if (n3.lengthSq() < 1e-8) n3.copy(envN)
          n3.normalize()
          const ao = 1 - P.aoStrength * (1 - s) ** 2 * .6
          c.copy(inner).lerp(outer, Math.min(1, s * .75 + (1 - ax) * .12)).multiplyScalar(ao * shade)
          position.push(q.x, q.y, q.z)
          normal.push(n3.x, n3.y, n3.z)
          uv.push(.5 + .5 * x * prof, s)
          color.push(c.r, c.g, c.b)
        }
      }
      for (let i = 0; i < segs; i++) {
        for (let m = 0; m < 2; m++) {
          const a = start + i * 3 + m, b = a + 3
          index.push(a, a + 1, b + 1, a, b + 1, b)
        }
      }
      fronds++
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return { geometry, fronds }
}

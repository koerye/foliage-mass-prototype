// Low ground plants:
// 1. Modeled 3D grass blades (`mode === 'blade'`, ported from Blender Procedural Grass Blade Studio):
//    golden-angle radial clumps of solid tapered blades with cubic bend/droop, cross-section cupping,
//    axial twist, sculpted smooth normals, and 3-tone color variation (zero alpha texture required).
// 2. Textured cards (`mode === 'card'` and `fern`): arching strips/fronds radiating from a root disk.
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const golden = Math.PI * (3 - Math.sqrt(5))

/** Narrow root -> full belly near mid-lower section -> pointed tip (Blender profile_width). */
export function bladeProfileWidth(t: number, fullness: number) {
  if (t <= 0 || t >= 1) return 0
  return (Math.sin(Math.PI * t) ** fullness) * (.62 + .38 * Math.min(1, t / .26))
}

function buildModeledGrass(spec: TreeSpec, env: CrownEnvelope) {
  const g = spec.ground
  const opt = spec.optimize
  const random = rng(seedFor(spec.seed, 6142))
  const uniform = (lo: number, hi: number) => lo + random() * (hi - lo)

  const keepRatio = Math.max(.25, 1 - opt.cardReduction)
  const widthBoost = keepRatio < 1 ? Math.min(1.65, (1 / keepRatio) ** .38) : 1
  const minBlades = Math.min(g.count, Math.max(2, Math.round(g.count * .35)))
  const targetCount = Math.max(minBlades, Math.round(g.count * keepRatio))
  const seg = Math.max(2, Math.round(g.segments * (1 - opt.level * .58)))
  const across = opt.flatCards || opt.level >= .5 ? 1 : Math.max(1, Math.min(6, Math.round(g.across)))
  const cols = across + 1

  const position: number[] = []
  const uv: number[] = []
  const color: number[] = []
  const index: number[] = []
  const bladeStarts: number[] = []

  const baseCol = new Color(g.tintBase)
  const tipCol = new Color(g.tintTip)
  const c = new Color()
  const angleJitterRad = MathUtils.degToRad(g.angleJitter)
  const sideSwirlRad = MathUtils.degToRad(g.sideSwirl)
  const twistRad = MathUtils.degToRad(g.twist)
  const radius = Math.max(0, g.spread)
  const radialBias = Math.max(.1, g.radialBias)
  const fullness = Math.max(.2, g.widthFullness)

  // 3-tone variation matching Blender's Light / Mid / Dark grass blades
  const toneScales = [.76, .98, 1.16]
  const toneTipShifts = [-.1, 0, .12]

  let blades = 0
  for (let i = 0; i < targetCount; i++) {
    const angle = i * golden + uniform(-angleJitterRad, angleJitterRad)
    const tFrac = (i + .5) / targetCount
    const radial = radius * (tFrac ** radialBias) * uniform(.55, 1.0)
    const height = g.length * Math.max(.18, uniform(1 - g.lengthVariance, 1 + g.lengthVariance))
    const width = g.width * Math.max(.18, uniform(1 - g.widthVariance, 1 + g.widthVariance)) * widthBoost
    // Less lean at center, more flare at perimeter (Blender generate_geometry)
    const leanBase = MathUtils.degToRad(g.lean) * (.45 + .55 * Math.min(1, radial / Math.max(radius, 1e-5)))
    const lean = MathUtils.clamp(leanBase + MathUtils.degToRad(uniform(-g.leanVariance, g.leanVariance)), .02, Math.PI * .48)

    const sway = uniform(-1, 1) * g.bendVariance
    const twist = uniform(-1, 1) * twistRad
    const lift = uniform(-1, 1) * g.lengthVariance * .2 * g.length
    const toneIdx = g.colorTones ? Math.min(2, Math.floor(random() * 3)) : 1
    const shade = (g.colorTones ? toneScales[toneIdx] : 1) * (1 + uniform(-1, 1) * g.tintVariance)
    const tipShift = g.colorTones ? toneTipShifts[toneIdx] : 0
    const keepR = random()

    const root = new Vector3(Math.cos(angle) * radial, 0, Math.sin(angle) * radial)
    const outward = new Vector3(Math.cos(angle), 0, Math.sin(angle))
    const side = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
    const sweep = outward.clone().multiplyScalar(Math.cos(sideSwirlRad)).addScaledVector(side, Math.sin(sideSwirlRad)).normalize()

    // Cubic sweep spine (base upright -> gracefully curved & drooping tip) + CrownEnvelope handles
    const centers: Vector3[] = []
    for (let j = 0; j <= seg; j++) {
      const t = j / seg
      const horizontal = height * (Math.sin(lean) * t + (g.arch + sway) * t * t)
      const y = height * Math.cos(lean) * t - height * g.droop * (t ** 3) + lift * t
      const pt = root.clone().addScaledVector(sweep, horizontal)
      pt.y = j === 0 ? 0 : Math.max(.004, y)
      const deformed = j === 0 ? pt : env.deform(pt, t)
      if (j > 0 && deformed.y < .004) deformed.y = .004
      centers.push(deformed)
    }

    if (env.bare(centers[Math.round(seg * .6)]) > .35 + keepR * .4) continue

    const startVertex = position.length / 3
    bladeStarts.push(startVertex)
    const tan = new Vector3(), rotSide = new Vector3(), faceN = new Vector3(), cupDir = new Vector3(), pt = new Vector3()

    for (let j = 0; j <= seg; j++) {
      const t = j / seg
      const center = centers[j]
      tan.subVectors(centers[Math.min(seg, j + 1)], centers[Math.max(0, j - 1)])
      if (tan.lengthSq() < 1e-8) tan.copy(UP)
      else tan.normalize()

      const theta = twist * t
      rotSide.copy(side).multiplyScalar(Math.cos(theta)).addScaledVector(outward, Math.sin(theta)).normalize()
      faceN.crossVectors(rotSide, tan)
      if (faceN.lengthSq() < 1e-6) faceN.copy(UP)
      else {
        faceN.normalize()
        if (faceN.y < 0) faceN.negate()
      }
      // Blend blade normal with +Y so both flat broad leaves and upright narrow leaves get crisp 3D cupping
      cupDir.copy(faceN).lerp(UP, .45).normalize()

      const w = width * bladeProfileWidth(t, fullness)
      const cupBase = g.cup * Math.sin(Math.PI * t) * width
      const ao = 1 - g.aoStrength * (1 - t) ** 2 * .48
      const gradT = MathUtils.clamp((t ** .78) + tipShift * (.35 + .65 * t), 0, 1)
      c.copy(baseCol).lerp(tipCol, gradT).multiplyScalar(ao * shade)

      for (let k = 0; k < cols; k++) {
        const u = k / across
        const s = 2 * u - 1
        const cup = cupBase * (1 - s * s)
        pt.copy(center).addScaledVector(rotSide, w * s * .5).addScaledVector(cupDir, cup)
        if (j > 0 && pt.y < .002) pt.y = .002
        position.push(pt.x, pt.y, pt.z)
        uv.push(u, t)
        color.push(c.r, c.g, c.b)
      }
    }

    for (let j = 0; j < seg; j++) {
      for (let k = 0; k < across; k++) {
        const a = startVertex + j * cols + k
        const b = a + 1
        const d = a + cols
        const cc = d + 1
        index.push(a, b, cc, a, cc, d)
      }
    }
    blades++
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  // Compute real smooth sculpted vertex normals from the curved & cupped blade surface
  geometry.computeVertexNormals()

  const posAttr = geometry.getAttribute('position') as BufferAttribute
  const norAttr = geometry.getAttribute('normal') as BufferAttribute
  const pTmp = new Vector3(), nTmp = new Vector3(), envN = new Vector3()
  // Repair any degenerate tip/root zero normals from adjacent interior ring, then blend spherize
  const vertsPerBlade = (seg + 1) * cols
  for (const start of bladeStarts) {
    for (let k = 0; k < cols; k++) {
      const i0 = start + k
      if (Math.hypot(norAttr.getX(i0), norAttr.getY(i0), norAttr.getZ(i0)) < 1e-4) {
        const ref = start + cols + k
        norAttr.setXYZ(i0, norAttr.getX(ref), norAttr.getY(ref), norAttr.getZ(ref))
      }
      const iTip = start + vertsPerBlade - cols + k
      if (Math.hypot(norAttr.getX(iTip), norAttr.getY(iTip), norAttr.getZ(iTip)) < 1e-4) {
        const ref = iTip - cols
        norAttr.setXYZ(iTip, norAttr.getX(ref), norAttr.getY(ref), norAttr.getZ(ref))
      }
    }
  }
  for (let i = 0; i < posAttr.count; i++) {
    pTmp.fromBufferAttribute(posAttr, i)
    nTmp.fromBufferAttribute(norAttr, i)
    if (nTmp.lengthSq() < 1e-6) nTmp.copy(UP)
    else nTmp.normalize()
    if (g.spherize > 0) {
      env.normal(pTmp, envN)
      // Align envN to nTmp (never flip nTmp itself!) so normals stay 100% continuous across each blade
      if (envN.dot(nTmp) < 0) envN.negate()
      nTmp.lerp(envN, g.spherize).normalize()
    }
    norAttr.setXYZ(i, nTmp.x, nTmp.y, nTmp.z)
  }
  norAttr.needsUpdate = true
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return { geometry, blades }
}

export function buildGround(spec: TreeSpec, env: CrownEnvelope) {
  if (spec.kind === 'grass' && spec.ground.mode !== 'card') {
    return buildModeledGrass(spec, env)
  }
  const g = spec.ground
  const opt = spec.optimize
  const fern = spec.kind === 'fern'
  const random = rng(seedFor(spec.seed, 6060))
  const position: number[] = [], normal: number[] = [], uv: number[] = [], color: number[] = [], index: number[] = []
  const base = new Color(g.tintBase), tip = new Color(g.tintTip), c = new Color()
  const envN = new Vector3(), n3 = new Vector3()
  const keepRatio = Math.max(.25, 1 - opt.cardReduction)
  const widthBoost = keepRatio < 1 ? Math.min(1.75, (1 / keepRatio) ** .42) : 1
  const targetCount = Math.max(fern ? 5 : 6, Math.round(g.count * keepRatio))
  const seg = Math.max(2, Math.round(g.segments * (1 - opt.level * .45)))
  const basePlanes = fern ? 1 : opt.flatCards ? 1 : Math.max(1, Math.min(3, Math.round(g.planes)))
  let blades = 0
  for (let i = 0; i < targetCount; i++) {
    const ring = i / Math.max(1, targetCount - 1)
    const innerFern = fern && ring < .36
    const theta = i * golden + (random() - .5) * .6
    const r0 = g.spread * (innerFern ? .4 : 1) * Math.sqrt(random())
    const root = new Vector3(Math.cos(theta) * r0, 0, Math.sin(theta) * r0)
    const out = new Vector3(Math.cos(theta + (random() - .5) * .5), 0, Math.sin(theta + (random() - .5) * .5)).normalize()
    const L = g.length * (1 + (random() * 2 - 1) * g.lengthVariance) *
      (innerFern ? .64 + random() * .16 : fern ? 1 : .75 + .5 * (1 - r0 / Math.max(.01, g.spread)))
    const lean = MathUtils.degToRad(g.lean * (innerFern ? .52 : 1) * (.65 + random() * .7))
    const arch = g.arch * (innerFern ? .6 : 1)
    const twist = MathUtils.degToRad((random() * 2 - 1) * g.twist)
    const shade = 1 + (random() * 2 - 1) * g.tintVariance
    const keepR = random()
    // integrate the spine: start leaning outward, gravity arches it down
    const spine: Vector3[] = [root.clone()]
    for (let k = 1; k <= seg; k++) {
      const t = (k - .5) / seg
      const angle = lean + arch * t * t * Math.PI * .55
      const dir = UP.clone().multiplyScalar(Math.cos(angle)).addScaledVector(out, Math.sin(angle))
      spine.push(spine[k - 1].clone().addScaledVector(dir, L / seg))
    }
    // editable envelope: blades follow handles with weight rising toward the tip
    for (let k = 1; k <= seg; k++) spine[k] = env.deform(spine[k], k / seg)
    if (env.bare(spine[Math.round(seg * .6)]) > .35 + keepR * .4) continue
    const planes = basePlanes
    for (let pl = 0; pl < planes; pl++) {
      const start = position.length / 3
      const roll = twist + pl * Math.PI / planes
      for (let k = 0; k <= seg; k++) {
        const s = k / seg
        const p = spine[k]
        const T = spine[Math.min(seg, k + 1)].clone().sub(spine[Math.max(0, k - 1)]).normalize()
        let side = new Vector3().crossVectors(T, fern ? UP : out)
        if (side.lengthSq() < 1e-6) side = new Vector3().crossVectors(T, new Vector3(1, 0, 0))
        side.normalize().applyAxisAngle(T, roll)
        const face = new Vector3().crossVectors(side, T).normalize()
        const w = (fern
          ? g.width * Math.min(1, s / .2 + .15) * Math.max(.05, 1 - s) ** .4
          : g.width * (1 - s ** 1.6 * .82)) * widthBoost
        env.normal(p, envN)
        if (face.dot(envN) < 0) face.negate()
        n3.copy(face).lerp(envN, g.spherize).normalize()
        const ao = 1 - g.aoStrength * (1 - s) ** 2 * .42
        c.copy(base).lerp(tip, s ** .75).multiplyScalar(ao * shade)
        const f = MathUtils.degToRad(g.fold)
        const cols: [number, number][] = fern ? [[-1, 0], [0, .5], [1, 1]] : [[-1, 0], [1, 1]]
        for (const [x, u] of cols) {
          const q = p.clone().addScaledVector(side, x * w * Math.cos(f))
          if (fern) q.addScaledVector(face, -Math.abs(x) * w * Math.sin(f))
          position.push(q.x, q.y, q.z)
          normal.push(n3.x, n3.y, n3.z)
          uv.push(u, s)
          color.push(c.r, c.g, c.b)
        }
      }
      const cols = fern ? 3 : 2
      for (let k = 0; k < seg; k++) {
        for (let x = 0; x < cols - 1; x++) {
          const a = start + k * cols + x, b = a + cols
          index.push(a, a + 1, b + 1, a, b + 1, b)
        }
      }
    }
    blades++
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(color), 3))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return { geometry, blades }
}

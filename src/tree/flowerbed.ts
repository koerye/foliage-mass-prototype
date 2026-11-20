// Standalone ground flower patch template:
// - withStems = true : curved green stems + stylized stem leaves + blossom heads
// - withStems = false: pure blossom heads only (1 draw call, for scattering over grass)
import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, MathUtils, Vector3 } from 'three'
import { rng, seedFor } from '../shape'
import type { CrownEnvelope } from './envelope'
import type { TreeSpec } from './spec'

const UP = new Vector3(0, 1, 0)
const golden = Math.PI * (3 - Math.sqrt(5))

function anyPerpendicular(v: Vector3) {
  const a = Math.abs(v.y) < .9 ? UP : new Vector3(1, 0, 0)
  return new Vector3().crossVectors(v, a).normalize()
}

export function buildFlowerBed(spec: TreeSpec, env: CrownEnvelope) {
  const F = spec.flowerbed, opt = spec.optimize
  const random = rng(seedFor(spec.seed, 8450))
  const keepRatio = Math.max(.25, 1 - opt.cardReduction)
  const scaleBoost = keepRatio < 1 ? Math.min(1.6, (1 / keepRatio) ** .4) : 1
  const count = Math.max(3, Math.round(F.count * keepRatio))

  // ---- stem + stylized stem-leaf buffers (only when withStems = true) -----
  const sPos: number[] = [], sCol: number[] = [], sIdx: number[] = []
  const stemBase = new Color(F.stemTint).multiplyScalar(.55)
  const stemMid = new Color(F.stemTint)
  const leafTip = new Color(F.stemTint).lerp(new Color('#c8ef68'), .42)
  const tmpCol = new Color()
  const detail = MathUtils.clamp(opt.woodDetail, .2, 1)
  const stemRings = Math.max(3, Math.round(5 * detail))
  const stemSegs = detail >= .55 ? 4 : 3
  const leavesPerStem = F.withStems && !(opt.cullHiddenWood && opt.level > .65) ? Math.max(0, Math.min(4, Math.round(F.stemLeaves))) : 0

  // ---- blossom head buffers ------------------------------------------------
  const effectiveType = opt.flatCards && F.cardType === 'cup' ? 'quad' : F.cardType
  const curved = effectiveType === 'cup'
  const nx = curved ? 2 : 1, ny = curved ? 2 : 1
  const fPos: number[] = [], fNor: number[] = [], fUv: number[] = [], fCol: number[] = []
  const fCen: number[] = [], fCor: number[] = [], fIdx: number[] = []
  const innerCol = new Color(F.tintInner), outerCol = new Color(F.tintOuter)
  const cols = Math.max(1, Math.round(F.atlasCols)), rows = Math.max(1, Math.round(F.atlasRows))
  const cells = cols * rows
  const envN = new Vector3(), n3 = new Vector3(), world = new Vector3()

  let flowers = 0
  let stems = 0
  const placedTips: Vector3[] = []

  for (let i = 0; i < count; i++) {
    const frac = (i + .5) / count
    const theta = i * golden + (random() - .5) * .45
    const rNorm = Math.sqrt(frac)
    const r0 = F.spread * rNorm * (.88 + random() * .24)
    const root = new Vector3(Math.cos(theta) * r0, 0, Math.sin(theta) * r0)
    const out = new Vector3(Math.cos(theta + (random() - .5) * .6), 0, Math.sin(theta + (random() - .5) * .6)).normalize()
    // dome height profile: slightly taller near patch centre, lower around edges
    const dome = 1.08 - .36 * rNorm * rNorm
    const h = Math.max(.04, F.height * dome * (1 + (random() * 2 - 1) * F.heightVariance))
    const leanRad = MathUtils.degToRad(F.lean * (.4 + .9 * rNorm) * (.7 + random() * .6))
    const bend = F.bend * (.7 + random() * .6)
    const shade = 1 + (random() * 2 - 1) * F.tintVariance
    const size = F.flowerSize * Math.max(.3, 1 + (random() * 2 - 1) * F.flowerSizeVariance) * scaleBoost
    const keepR = random()

    // integrate stem spine from ground up to blossom position
    const spine: Vector3[] = [root.clone()]
    const step = h / (stemRings - 1)
    for (let k = 1; k < stemRings; k++) {
      const t = (k - .5) / (stemRings - 1)
      const angle = leanRad * (1 + bend * t * t * 1.4)
      const dir = UP.clone().multiplyScalar(Math.cos(angle)).addScaledVector(out, Math.sin(angle)).normalize()
      spine.push(spine[k - 1].clone().addScaledVector(dir, step))
    }
    for (let k = 1; k < stemRings; k++) spine[k] = env.deform(spine[k], k / (stemRings - 1))
    const tip = spine[stemRings - 1]
    if (tip.y < .02) tip.y = .02
    if (env.bare(tip) > .32 + keepR * .4) continue
    // gentle anti-overlap so adjacent flower heads read cleanly
    const minGap = size * .48
    if (placedTips.some(other => other.distanceToSquared(tip) < minGap * minGap)) continue
    placedTips.push(tip.clone())

    // 1. Emit green stem + paired stylized stem leaves when withStems = true
    if (F.withStems) {
      const start = sPos.length / 3
      const t0 = spine[1].clone().sub(spine[0]).normalize()
      const ref = anyPerpendicular(t0)
      for (let k = 0; k < stemRings; k++) {
        const s = k / (stemRings - 1)
        const p = spine[k]
        const T = spine[Math.min(stemRings - 1, k + 1)].clone().sub(spine[Math.max(0, k - 1)]).normalize()
        const uAxis = ref.clone().addScaledVector(T, -ref.dot(T))
        if (uAxis.lengthSq() < 1e-6) uAxis.copy(anyPerpendicular(T))
        uAxis.normalize()
        const vAxis = new Vector3().crossVectors(T, uAxis).normalize()
        const rr = F.stemRadius * (1.25 - .55 * s)
        tmpCol.copy(stemBase).lerp(stemMid, .25 + .75 * s).multiplyScalar(shade)
        for (let j = 0; j < stemSegs; j++) {
          const a = j / stemSegs * Math.PI * 2
          const q = p.clone().addScaledVector(uAxis, Math.cos(a) * rr).addScaledVector(vAxis, Math.sin(a) * rr)
          if (k === 0 || q.y < 0) q.y = 0
          sPos.push(q.x, q.y, q.z)
          sCol.push(tmpCol.r, tmpCol.g, tmpCol.b)
        }
      }
      for (let k = 0; k < stemRings - 1; k++) {
        for (let j = 0; j < stemSegs; j++) {
          const a = start + k * stemSegs + j, b = start + k * stemSegs + (j + 1) % stemSegs
          sIdx.push(a, b, b + stemSegs, a, b + stemSegs, a + stemSegs)
        }
      }
      stems++

      // stylized pointed stem leaves sprouting from the lower-middle of the stem
      const leafPhase = random() * Math.PI * 2
      for (let l = 0; l < leavesPerStem; l++) {
        const s = .14 + .52 * (l + .25 + random() * .4) / Math.max(1, leavesPerStem)
        const fIdx = s * (stemRings - 1), i0 = Math.min(stemRings - 2, Math.floor(fIdx))
        const anchor = spine[i0].clone().lerp(spine[i0 + 1], fIdx - i0)
        const la = leafPhase + l * golden * 2.1 + (random() - .5) * .6
        const lDir = new Vector3(Math.cos(la), .36 + random() * .26, Math.sin(la)).normalize()
        const lSide = new Vector3().crossVectors(UP, lDir)
        if (lSide.lengthSq() < 1e-5) lSide.set(1, 0, 0)
        lSide.normalize()
        const lUp = new Vector3().crossVectors(lDir, lSide).normalize()
        const lLen = F.stemLeafSize * (.82 + random() * .44) * (1 - s * .22)
        const lW = lLen * .38
        const mid = anchor.clone().addScaledVector(lDir, lLen * .46).addScaledVector(lUp, lLen * .08)
        const end = anchor.clone().addScaledVector(lDir, lLen).addScaledVector(UP, -lLen * .14)
        if (end.y < .005) end.y = .005
        const left = mid.clone().addScaledVector(lSide, lW).addScaledVector(lUp, -lW * .25)
        const right = mid.clone().addScaledVector(lSide, -lW).addScaledVector(lUp, -lW * .25)
        const bStart = sPos.length / 3
        const verts: [Vector3, Color][] = [
          [anchor, stemBase.clone().multiplyScalar(shade)],
          [left, stemMid.clone().multiplyScalar(shade)],
          [mid, stemMid.clone().lerp(leafTip, .45).multiplyScalar(shade)],
          [right, stemMid.clone().multiplyScalar(shade)],
          [end, leafTip.clone().multiplyScalar(shade)],
        ]
        for (const [pt, col] of verts) { sPos.push(pt.x, pt.y, pt.z); sCol.push(col.r, col.g, col.b) }
        // 4 triangles forming a gently folded 3D diamond leaf
        sIdx.push(bStart, bStart + 1, bStart + 2, bStart, bStart + 2, bStart + 3)
        sIdx.push(bStart + 1, bStart + 4, bStart + 2, bStart + 2, bStart + 4, bStart + 3)
      }
    }

    // 2. Emit blossom head at `tip`
    const stemTipDir = tip.clone().sub(spine[Math.max(0, stemRings - 2)]).normalize()
    const tiltRad = MathUtils.degToRad(F.headTilt * (.5 + random() * .8))
    const tiltDir = out.clone().applyAxisAngle(UP, (random() - .5) * 1.1)
    let normal = UP.clone().multiplyScalar(Math.cos(tiltRad)).addScaledVector(tiltDir, Math.sin(tiltRad)).normalize()
    normal.lerp(stemTipDir, .25).normalize()
    env.normal(tip, envN)
    if (envN.y < 0) envN.y = Math.abs(envN.y) * .4
    envN.normalize()
    normal.lerp(envN, F.faceOutward * .55).normalize()
    const spin = (random() * 2 - 1) * Math.PI
    const up = anyPerpendicular(normal).applyAxisAngle(normal, spin)
    const right = new Vector3().crossVectors(up, normal).normalize()

    const cell = Math.min(cells - 1, Math.floor(random() * cells))
    const cellCol = cell % cols, cellRow = Math.floor(cell / cols)
    const cs = Math.cos(spin), sn = Math.sin(spin)
    const bases = effectiveType === 'cross'
      ? [
        { right, up, normal },
        { right: right.clone().applyAxisAngle(up, Math.PI * .5), up: up.clone().applyAxisAngle(right, .2), normal: normal.clone().applyAxisAngle(up, Math.PI * .5) },
      ]
      : [{ right, up, normal }]

    const bright = (.9 + .1 * (1 - rNorm)) * shade
    for (const basis of bases) {
      const baseV = fPos.length / 3
      for (let jj = 0; jj <= ny; jj++) {
        for (let ii = 0; ii <= nx; ii++) {
          const u = ii / nx, w = jj / ny
          const x = (u - .5) * size, y = (w - .5) * size
          const r2 = ((u - .5) * 2) ** 2 + ((w - .5) * 2) ** 2
          const z = curved ? r2 * size * .16 : 0
          world.copy(tip).addScaledVector(basis.right, x).addScaledVector(basis.up, y).addScaledVector(basis.normal, z)
          n3.copy(normal).lerp(UP, .35).normalize()
          fPos.push(world.x, world.y, world.z)
          fNor.push(n3.x, n3.y, n3.z)
          fCen.push(tip.x, tip.y, tip.z)
          fCor.push(x * cs - y * sn, x * sn + y * cs)
          fUv.push((cellCol + u) / cols, 1 - (cellRow + 1 - w) / rows)
          tmpCol.copy(innerCol).lerp(outerCol, MathUtils.clamp(.4 + .6 * Math.min(1, r2 * .5), 0, 1)).multiplyScalar(bright)
          fCol.push(tmpCol.r, tmpCol.g, tmpCol.b)
        }
      }
      for (let jj = 0; jj < ny; jj++) {
        for (let ii = 0; ii < nx; ii++) {
          const a = baseV + jj * (nx + 1) + ii, b = a + 1, c0 = a + nx + 1, d = c0 + 1
          fIdx.push(a, b, d, a, d, c0)
        }
      }
    }
    flowers++
  }

  let stemsGeometry: BufferGeometry | undefined
  if (F.withStems && sPos.length > 0) {
    stemsGeometry = new BufferGeometry()
    stemsGeometry.setAttribute('position', new Float32BufferAttribute(sPos, 3))
    stemsGeometry.setAttribute('color', new Float32BufferAttribute(sCol, 3))
    stemsGeometry.setIndex(sIdx)
    stemsGeometry.computeVertexNormals()
    stemsGeometry.computeBoundingBox()
  }

  const blossomsGeometry = new BufferGeometry()
  blossomsGeometry.setAttribute('position', new BufferAttribute(new Float32Array(fPos), 3))
  blossomsGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(fNor), 3))
  blossomsGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(fUv), 2))
  blossomsGeometry.setAttribute('color', new BufferAttribute(new Float32Array(fCol), 3))
  blossomsGeometry.setAttribute('leafCenter', new BufferAttribute(new Float32Array(fCen), 3))
  blossomsGeometry.setAttribute('leafCorner', new BufferAttribute(new Float32Array(fCor), 2))
  blossomsGeometry.setIndex(fIdx)
  blossomsGeometry.computeBoundingSphere()
  blossomsGeometry.computeBoundingBox()

  return { stemsGeometry, blossomsGeometry, flowers, stems }
}

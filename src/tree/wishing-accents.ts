// Modular parameterized stylized ancient wishing-tree accents:
// - Sculpted moss-capped boulders flanking flared roots (configurable count, scale, stone & moss colors)
// - Draped flat-folded crimson silk wishing sashes & catenary swags around the S-trunk arch
// - Hanging cedar-wood wishing plaques with matching silk tassels anchored to trunk sash & live limbs
// - Luminous 4-point golden floating canopy starlight motes
// All meshes are explicitly named with decoration keywords so GLB export's
// `excludeDecorations` cleanly removes them on demand.
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide,
  Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3,
} from 'three'
import { foliageWind } from '../broadleaf/leaf-material'
import { rng } from '../shape'
import type { Skeleton } from './skeleton'
import { defaultAccents, type WishingAccentsSpec } from './spec'

const UP = new Vector3(0, 1, 0)

/** Attaches lightweight traveling silk-wave wind flutter synchronized with global `foliageWind`. */
function attachRibbonWind(mat: MeshStandardMaterial) {
  mat.userData.windUniforms = foliageWind
  mat.customProgramCacheKey = () => 'wishing-ribbon-wind-v1'
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, foliageWind)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWindTime;
uniform float uWindStrength;
attribute float windWeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (uWindStrength > 0.0 && windWeight > 0.001) {
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  float phase = uWindTime * 2.55 + wp.x * 2.6 - wp.y * 2.1 + wp.z * 1.8;
  float wave = sin(phase) + 0.42 * sin(phase * 1.9 + 1.1);
  float amp = uWindStrength * 2.5 * windWeight;
  transformed.x += wave * amp;
  transformed.z += cos(phase * 0.85 + 0.6) * amp * 0.85;
  transformed.y += sin(phase * 1.4) * amp * 0.24;
}`)
  }
}

/** Attaches rigid-pendulum wind sway around each plaque's top hanging cord pivot (`pivotPos`). */
function attachPlaqueWind(mat: MeshStandardMaterial) {
  mat.userData.windUniforms = foliageWind
  mat.customProgramCacheKey = () => 'wishing-plaque-wind-v1'
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, foliageWind)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uWindTime;
uniform float uWindStrength;
attribute vec3 pivotPos;
attribute float windWeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (uWindStrength > 0.0 && windWeight > 0.001) {
  float ph = pivotPos.x * 4.7 + pivotPos.y * 3.1 + pivotPos.z * 5.3;
  float sway = (sin(uWindTime * 2.15 + ph) + 0.35 * sin(uWindTime * 3.8 + ph * 1.6)) * uWindStrength * 5.2;
  float swayZ = cos(uWindTime * 1.75 + ph * 0.9) * uWindStrength * 3.4;
  vec3 rel = transformed - pivotPos;
  float c1 = cos(sway), s1 = sin(sway);
  float c2 = cos(swayZ), s2 = sin(swayZ);
  // Pendulum swing around Z then X from top hanging cord (zero detachment!)
  vec3 r1 = vec3(rel.x * c1 - rel.y * s1, rel.x * s1 + rel.y * c1, rel.z);
  vec3 r2 = vec3(r1.x, r1.y * c2 - r1.z * s2, r1.y * s2 + r1.z * c2);
  // Extra delicate flutter on hanging lower silk tassels
  float tasselExtra = max(0.0, windWeight - 0.62) * uWindStrength * 1.2 * sin(uWindTime * 4.4 + ph);
  transformed = pivotPos + mix(rel, r2, clamp(windWeight * 1.25, 0.0, 1.0)) + vec3(tasselExtra, 0.0, tasselExtra * 0.5);
}`)
  }
}

/** Builds a sculpted, slightly faceted mossy boulder mesh resting flat on y = -0.02. */
function makeMossyBoulderGeometry(
  rx: number, ry: number, rz: number, seed: number,
  rockBaseHex: string, mossBaseHex: string,
): BufferGeometry {
  const r = rng(seed)
  const segU = 10, segV = 7
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const slateMid = new Color(rockBaseHex)
  const slateDark = slateMid.clone().multiplyScalar(0.62)
  const slateLight = slateMid.clone().lerp(new Color('#d8e6e8'), 0.34)
  const mossMid = new Color(mossBaseHex)
  const mossDark = mossMid.clone().multiplyScalar(0.58)
  const mossBright = mossMid.clone().lerp(new Color('#d4f078'), 0.32)
  const c = new Color()

  // Random plane-cut directions for stylized angular rock facets
  const cuts: [Vector3, number][] = []
  for (let i = 0; i < 6; i++) {
    const dir = new Vector3(r() * 2 - 1, r() * 1.4 - 0.3, r() * 2 - 1).normalize()
    cuts.push([dir, 0.78 + r() * 0.28])
  }

  for (let j = 0; j <= segV; j++) {
    const v = j / segV
    const phi = 0.025 + v * (Math.PI - 0.05)
    for (let i = 0; i <= segU; i++) {
      const u = i / segU
      const theta = u * Math.PI * 2
      const dir = new Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      )
      let rad = 1.0
      for (const [cd, lim] of cuts) {
        const d = dir.dot(cd)
        if (d > lim * 0.72) rad = Math.min(rad, lim / Math.max(0.15, d) * 0.78 + 0.22 * rad)
      }
      rad *= 0.88 + 0.18 * Math.sin(theta * 3 + seed) * Math.sin(phi * 2)
      let x = dir.x * rx * rad
      let y = dir.y * ry * rad + ry * 0.56
      let z = dir.z * rz * rad
      if (y < 0.02) {
        y = -0.02
        x *= 1.06
        z *= 1.06
      }
      pos.push(x, y, z)

      const up = Math.max(0, dir.y)
      const sideLight = 0.5 + 0.5 * (dir.x * 0.5 + dir.z * 0.5)
      c.copy(slateDark).lerp(slateMid, Math.min(1, y / Math.max(0.2, ry * 1.1)))
      c.lerp(slateLight, sideLight * 0.38)
      const mossAmt = Math.max(0, Math.min(1, (up - 0.44 + Math.sin(theta * 3 + seed * 1.7) * 0.14) * 2.8))
      if (mossAmt > 0.01) {
        const mc = mossDark.clone().lerp(mossBright, Math.min(1, up * 1.1))
        c.lerp(mc, mossAmt * 0.92)
      }
      col.push(c.r, c.g, c.b)
    }
  }

  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * (segU + 1) + i
      const b = a + 1
      const d = a + (segU + 1)
      const e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const nAttr = geo.getAttribute('normal') as BufferAttribute | undefined
  if (nAttr) {
    for (let i = 0; i < nAttr.count; i++) {
      const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-5) nAttr.setXYZ(i, nx / len, ny / len, nz / len)
      else nAttr.setXYZ(i, 0, 1, 0)
    }
  }
  return geo
}

/** Builds a sculpted flat-folded silk sash ribbon along a 3D spline (3-column V-folded strip
 *  with graceful organic twist & soft edge highlight so it reads as draped silk rather than a round cord). */
function makeSilkRibbonGeometry(
  curve: CatmullRomCurve3,
  halfWidth: number,
  ribbonHex: string,
  segments = 28,
  twistTurns = 0.45,
  weightFn: (t: number) => number = t => Math.sin(t * Math.PI),
): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const wgt: number[] = []
  const idx: number[] = []
  const baseCol = new Color(ribbonHex)
  const hiCol = baseCol.clone().lerp(new Color('#ffcab8'), 0.24)
  const foldCol = baseCol.clone().multiplyScalar(0.68)
  const c = new Color()

  const prevSide = new Vector3(1, 0, 0)
  const tan = new Vector3()
  const side = new Vector3()
  const norm = new Vector3()
  const pt = new Vector3()

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    curve.getPoint(t, pt)
    curve.getTangent(t, tan).normalize()

    // Parallel-transport stable ribbon frame with gentle silk twist
    side.copy(prevSide).addScaledVector(tan, -prevSide.dot(tan))
    if (side.lengthSq() < 1e-5) {
      const ref = Math.abs(tan.y) < 0.9 ? UP : new Vector3(1, 0, 0)
      side.crossVectors(tan, ref)
    }
    side.normalize()
    prevSide.copy(side)
    norm.crossVectors(tan, side).normalize()

    const twist = Math.sin(t * Math.PI * 2 * twistTurns) * 0.65
    const ct = Math.cos(twist), st = Math.sin(twist)
    const rSide = side.clone().multiplyScalar(ct).addScaledVector(norm, st)
    const rNorm = norm.clone().multiplyScalar(ct).addScaledVector(side, -st)

    // Taper smoothly at tips while keeping broad flat silk sash through the draped belly
    const taper = Math.pow(Math.sin(Math.min(1, Math.max(0.02, t)) * Math.PI), 0.24)
    const hw = halfWidth * (0.38 + 0.72 * taper)
    const crease = hw * 0.26
    const ww = Math.max(0, weightFn(t))

    // 3 vertices across ribbon width: left edge, softly raised center fold, right edge
    const offsets: [number, number, Color][] = [
      [-hw, 0, foldCol],
      [0, crease, hiCol],
      [hw, 0, baseCol],
    ]
    for (const [ox, oz, baseC] of offsets) {
      const vx = pt.x + rSide.x * ox + rNorm.x * oz
      const vy = pt.y + rSide.y * ox + rNorm.y * oz
      const vz = pt.z + rSide.z * ox + rNorm.z * oz
      pos.push(vx, vy, vz)
      const light = 0.86 + 0.22 * Math.sin(t * Math.PI)
      c.copy(baseC).multiplyScalar(light)
      col.push(c.r, c.g, c.b)
      wgt.push(ww)
    }
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 3
    const b = a + 3
    idx.push(a, a + 1, b + 1, a, b + 1, b)
    idx.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1)
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  geo.setAttribute('windWeight', new BufferAttribute(new Float32Array(wgt), 1))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const nAttr = geo.getAttribute('normal') as BufferAttribute | undefined
  if (nAttr) {
    for (let i = 0; i < nAttr.count; i++) {
      const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-5) nAttr.setXYZ(i, nx / len, ny / len, nz / len)
      else nAttr.setXYZ(i, 0, 1, 0)
    }
  }
  return geo
}

/** Builds clean wooden wishing plaques + matching colored silk hanging cords & tassels with pendulum wind attributes. */
function makePlaquePairGeometry(
  anchors: { pos: Vector3; yaw: number; scale: number; tilt: number }[],
  ribbonHex: string,
): { wood: BufferGeometry; tassel: BufferGeometry } {
  const wPos: number[] = [], wCol: number[] = [], wPiv: number[] = [], wWgt: number[] = [], wIdx: number[] = []
  const tPos: number[] = [], tCol: number[] = [], tPiv: number[] = [], tWgt: number[] = [], tIdx: number[] = []
  const woodTop = new Color('#ebd0a0')
  const woodBot = new Color('#bf9363')
  const redTop = new Color(ribbonHex).lerp(new Color('#ff9e8a'), 0.14)
  const redBot = new Color(ribbonHex).multiplyScalar(0.68)

  const pushBox = (
    posArr: number[], colArr: number[], pivArr: number[], wgtArr: number[], idxArr: number[],
    origin: Vector3, yaw: number, tilt: number,
    hw: number, hh: number, hd: number, yOff: number,
    cTop: Color, cBot: Color, wTop: number, wBot: number,
  ) => {
    const base = posArr.length / 3
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const ct = Math.cos(tilt), st = Math.sin(tilt)
    const corners: [number, number, number, Color, number][] = [
      [-hw, yOff + hh, -hd, cTop, wTop], [hw, yOff + hh, -hd, cTop, wTop],
      [hw, yOff - hh, -hd, cBot, wBot], [-hw, yOff - hh, -hd, cBot, wBot],
      [-hw, yOff + hh, hd, cTop, wTop], [hw, yOff + hh, hd, cTop, wTop],
      [hw, yOff - hh, hd, cBot, wBot], [-hw, yOff - hh, hd, cBot, wBot],
    ]
    for (const [lx, ly, lz, col, ww] of corners) {
      const tx = lx * ct - ly * st
      const ty = lx * st + ly * ct
      const rx = tx * cy + lz * sy
      const rz = -tx * sy + lz * cy
      posArr.push(origin.x + rx, origin.y + ty, origin.z + rz)
      colArr.push(col.r, col.g, col.b)
      pivArr.push(origin.x, origin.y, origin.z)
      wgtArr.push(ww)
    }
    const faces = [
      [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [0, 1, 5, 4], [7, 6, 2, 3],
    ]
    for (const [a, b, c, d] of faces) {
      idxArr.push(base + a, base + b, base + c, base + a, base + c, base + d)
    }
  }

  for (const a of anchors) {
    const s = a.scale
    pushBox(wPos, wCol, wPiv, wWgt, wIdx, a.pos, a.yaw, a.tilt, 0.058 * s, 0.095 * s, 0.014 * s, -0.11 * s, woodTop, woodBot, 0.16, 0.62)
    pushBox(tPos, tCol, tPiv, tWgt, tIdx, a.pos, a.yaw, a.tilt, 0.008 * s, 0.026 * s, 0.008 * s, -0.020 * s, redTop, redTop, 0.0, 0.18)
    pushBox(tPos, tCol, tPiv, tWgt, tIdx, a.pos, a.yaw, a.tilt, 0.017 * s, 0.072 * s, 0.014 * s, -0.255 * s, redTop, redBot, 0.62, 1.0)
  }

  const wood = new BufferGeometry()
  wood.setAttribute('position', new BufferAttribute(new Float32Array(wPos), 3))
  wood.setAttribute('color', new BufferAttribute(new Float32Array(wCol), 3))
  wood.setAttribute('pivotPos', new BufferAttribute(new Float32Array(wPiv), 3))
  wood.setAttribute('windWeight', new BufferAttribute(new Float32Array(wWgt), 1))
  wood.setIndex(wIdx)
  wood.computeVertexNormals()

  const tassel = new BufferGeometry()
  tassel.setAttribute('position', new BufferAttribute(new Float32Array(tPos), 3))
  tassel.setAttribute('color', new BufferAttribute(new Float32Array(tCol), 3))
  tassel.setAttribute('pivotPos', new BufferAttribute(new Float32Array(tPiv), 3))
  tassel.setAttribute('windWeight', new BufferAttribute(new Float32Array(tWgt), 1))
  tassel.setIndex(tIdx)
  tassel.computeVertexNormals()

  return { wood, tassel }
}

/** Builds luminous 4-point starlight sparkles drifting softly around the upper crown. */
function makeGoldenMotesGeometry(trunkHeight: number, crownRadius: number, count: number, seed: number): BufferGeometry {
  const r = rng(seed + 881)
  const pos: number[] = []
  const idx: number[] = []
  const n = Math.max(0, Math.min(36, Math.round(count)))
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2
    const rad = crownRadius * (0.35 + r() * 0.78)
    const cx = Math.cos(ang) * rad
    const cy = trunkHeight * (0.50 + r() * 0.48)
    const cz = Math.abs(Math.sin(ang)) * rad * 0.55 + 0.85
    const sz = 0.085 + r() * 0.085
    for (const rot of [0, Math.PI * 0.5]) {
      const base = pos.length / 3
      const ca = Math.cos(rot), sa = Math.sin(rot)
      const pts: [number, number][] = [
        [0, sz], [sz * 0.24, sz * 0.24], [sz, 0], [sz * 0.24, -sz * 0.24],
        [0, -sz], [-sz * 0.24, -sz * 0.24], [-sz, 0], [-sz * 0.24, sz * 0.24],
      ]
      pos.push(cx, cy, cz)
      for (const [px, py] of pts) pos.push(cx + px * ca, cy + py, cz + px * sa)
      for (let k = 0; k < 8; k++) {
        idx.push(base, base + 1 + k, base + 1 + ((k + 1) % 8))
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const nAttr = geo.getAttribute('normal') as BufferAttribute | undefined
  if (nAttr) {
    for (let i = 0; i < nAttr.count; i++) {
      const nx = nAttr.getX(i), ny = nAttr.getY(i), nz = nAttr.getZ(i)
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-5) nAttr.setXYZ(i, nx / len, ny / len, nz / len)
      else nAttr.setXYZ(i, 0, 1, 0)
    }
  }
  return geo
}

/** Assembles parameterized stylized Ancient Wishing Tree decorative accents bound cleanly to the live trunk curve. */
export function buildWishingAccents(
  skeleton: Skeleton,
  seed: number,
  options?: Partial<WishingAccentsSpec>,
): {
  group: Group
  disposables: { dispose(): void }[]
  triangles: number
} {
  const cfg: WishingAccentsSpec = { ...defaultAccents, ...(options ?? {}) }
  const group = new Group()
  group.name = 'Wishing Accents / 祈愿古树装饰'
  const disposables: { dispose(): void }[] = []
  let triangles = 0

  const trunk = skeleton.trunk
  const r0 = trunk.radii[0] ?? 0.45
  const env = skeleton.envelope

  // 1. Sculpted moss-capped boulders flanking the ancient flared root base
  const rockCount = Math.max(0, Math.min(8, Math.round(cfg.rockCount)))
  const rockScale = Math.max(0.35, Math.min(2.2, cfg.rockScale))
  if (rockCount > 0) {
    const boulderMat = new MeshStandardMaterial({
      name: 'MossyRocksDecor',
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
    })
    disposables.push(boulderMat)
    const rockSpecs: [number, number, number, number, number, number, number][] = [
      [-r0 * 1.95, 0, r0 * 0.55, 0.56, 0.52, 0.44, seed + 11],
      [-r0 * 2.55, 0, r0 * 0.18, 0.34, 0.30, 0.30, seed + 23],
      [r0 * 1.15, 0, r0 * 0.92, 0.52, 0.46, 0.40, seed + 37],
      [r0 * 2.15, 0, r0 * 0.35, 0.44, 0.36, 0.38, seed + 53],
      [r0 * 0.15, 0, -r0 * 1.65, 0.58, 0.48, 0.44, seed + 71],
      [-r0 * 1.35, 0, -r0 * 1.35, 0.42, 0.36, 0.38, seed + 89],
      [r0 * 1.65, 0, -r0 * 1.15, 0.40, 0.32, 0.34, seed + 107],
      [-r0 * 0.45, 0, r0 * 1.45, 0.32, 0.25, 0.28, seed + 131],
    ]
    for (let i = 0; i < rockCount; i++) {
      const [x, y, z, rx, ry, rz, rs] = rockSpecs[i]
      const geo = makeMossyBoulderGeometry(
        rx * rockScale, ry * rockScale, rz * rockScale, rs,
        cfg.rockColor, cfg.rockMossColor,
      )
      disposables.push(geo)
      const mesh = new Mesh(geo, boulderMat)
      mesh.name = `Mossy Rock ${i + 1} / 根部青苔石装饰`
      mesh.userData.role = 'decoration'
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      triangles += (geo.index?.count ?? 0) / 3
    }
  }

  // Sample points & live local trunk radii right along the dramatic mid-trunk curve (t = 0.24 .. 0.72)
  const radiusAt = (t: number) => {
    const arr = trunk.radii
    if (!arr.length) return r0 * (1 - t * 0.5)
    const idx = Math.min(arr.length - 1, Math.max(0, Math.round(t * (arr.length - 1))))
    return Math.max(0.14, arr[idx])
  }
  const pA = trunk.curve.getPoint(0.26)
  const pB = trunk.curve.getPoint(0.42)
  const pC = trunk.curve.getPoint(0.56)
  const pD = trunk.curve.getPoint(0.68)
  // Extra radial clearance keeps draped silk cleanly outside deeply sculpted bark ribs
  const rA = radiusAt(0.26) * 1.12 + 0.09
  const rB = radiusAt(0.42) * 1.12 + 0.10
  const rC = radiusAt(0.56) * 1.12 + 0.09
  const rD = radiusAt(0.68) * 1.12 + 0.08

  // 2. Sculpted flat-folded crimson silk sashes wrapping the S-trunk arch & catenary swags
  const ribbonWraps = Math.max(0, Math.min(4, Math.round(cfg.ribbonWraps)))
  if (ribbonWraps > 0) {
    const ribbonMat = new MeshStandardMaterial({
      name: 'WishingRibbonDecor',
      vertexColors: true,
      roughness: 0.56,
      metalness: 0.04,
      side: DoubleSide,
    })
    attachRibbonWind(ribbonMat)
    disposables.push(ribbonMat)

    const ribbonSpecs: { curve: CatmullRomCurve3; halfWidth: number; twist: number; weight: (t: number) => number }[] = [
      // Wrap 1: iconic diagonal silk sash draping OVER upper trunk back & across front chest
      {
        curve: new CatmullRomCurve3([
          pA.clone().add(new Vector3(-rA * 1.12, 0.06, rA * 0.45)),
          pA.clone().lerp(pB, 0.48).add(new Vector3(-0.08, rB * 0.96, rB * 0.92)),
          pB.clone().add(new Vector3(0.06, 0.14, rB * 1.18)),
          pB.clone().lerp(pC, 0.42).add(new Vector3(0.16, -0.18, rC * 1.14)),
          pC.clone().add(new Vector3(0.22, 0.16, rC * 0.72)),
          pC.clone().add(new Vector3(0.12, 0.24, -rC * 0.82)),
        ]),
        halfWidth: 0.062,
        twist: 0.55,
        weight: t => Math.sin(t * Math.PI) * 0.35,
      },
      // Wrap 2: graceful low-looping silk swag beneath the sweeping right trunk arch
      {
        curve: new CatmullRomCurve3([
          pB.clone().add(new Vector3(-0.06, 0.18, rB * 1.14)),
          pB.clone().lerp(pC, 0.35).add(new Vector3(0.06, -0.46, rB * 1.18)),
          pC.clone().add(new Vector3(0.32, -0.58, rC * 0.92)),
          pD.clone().add(new Vector3(0.34, -0.16, rD * 0.65)),
          pD.clone().add(new Vector3(0.12, 0.20, -rD * 0.55)),
        ]),
        halfWidth: 0.048,
        twist: 0.42,
        weight: t => Math.pow(Math.sin(t * Math.PI), 1.1) * 1.0,
      },
      // Wrap 3: outer silk festoon trailing along upper right shoulder
      {
        curve: new CatmullRomCurve3([
          pC.clone().add(new Vector3(-0.02, 0.26, rC * 0.96)),
          pC.clone().lerp(pD, 0.50).add(new Vector3(0.40, -0.26, rD * 0.88)),
          pD.clone().add(new Vector3(0.52, 0.10, rD * 0.28)),
        ]),
        halfWidth: 0.042,
        twist: 0.35,
        weight: t => Math.sin(t * Math.PI) * 0.85,
      },
      // Wrap 4: optional lower trailing tail streamer fluttering down from the central knot
      {
        curve: new CatmullRomCurve3([
          pB.clone().add(new Vector3(0.08, 0.06, rB * 1.16)),
          pB.clone().add(new Vector3(-0.04, -0.34, rB * 1.24)),
          pB.clone().add(new Vector3(-0.18, -0.78, rB * 1.12)),
          pB.clone().add(new Vector3(-0.10, -1.06, rB * 1.02)),
        ]),
        halfWidth: 0.046,
        twist: 0.65,
        weight: t => Math.pow(t, 1.3) * 1.35,
      },
    ]

    for (let i = 0; i < ribbonWraps; i++) {
      const s = ribbonSpecs[i]
      const geo = makeSilkRibbonGeometry(s.curve, s.halfWidth, cfg.ribbonColor, 28, s.twist, s.weight)
      disposables.push(geo)
      const mesh = new Mesh(geo, ribbonMat)
      mesh.name = `Wishing Silk Ribbon ${i + 1} / 红绸祈愿带装饰`
      mesh.userData.role = 'decoration'
      mesh.castShadow = true
      group.add(mesh)
      triangles += (geo.index?.count ?? 0) / 3
    }
  }

  // 3. Clustered cedar-wood wishing plaques hung cleanly along the ribbon sash & live skeleton limbs
  const plaqueCount = Math.max(0, Math.min(10, Math.round(cfg.plaqueCount)))
  const plaqueScale = Math.max(0.5, Math.min(2.0, cfg.plaqueScale))
  if (plaqueCount > 0) {
    const trunkBundle: { pos: Vector3; yaw: number; scale: number; tilt: number }[] = [
      { pos: pB.clone().add(new Vector3(-0.10, 0.04, rB * 1.24)), yaw: 0.22, scale: 1.42 * plaqueScale, tilt: -0.18 },
      { pos: pB.clone().add(new Vector3(0.05, -0.02, rB * 1.28)), yaw: -0.10, scale: 1.50 * plaqueScale, tilt: 0.08 },
      { pos: pB.clone().add(new Vector3(0.20, -0.08, rB * 1.20)), yaw: 0.34, scale: 1.36 * plaqueScale, tilt: 0.16 },
      { pos: pB.clone().add(new Vector3(-0.02, -0.15, rB * 1.18)), yaw: -0.24, scale: 1.26 * plaqueScale, tilt: -0.10 },
      { pos: pB.clone().lerp(pC, 0.40).add(new Vector3(0.14, -0.22, rC * 1.18)), yaw: 0.14, scale: 1.22 * plaqueScale, tilt: 0.06 },
      { pos: pA.clone().lerp(pB, 0.65).add(new Vector3(-0.22, 0.08, rB * 1.12)), yaw: -0.32, scale: 1.16 * plaqueScale, tilt: -0.12 },
    ]
    const limbs = skeleton.branches
      .filter(b => b.role === 'limb' && b.length > 0.7)
      .sort((a, b) => a.curve.getPoint(0.55).y - b.curve.getPoint(0.55).y)
    const limbAnchors: { pos: Vector3; yaw: number; scale: number; tilt: number }[] = limbs.slice(0, 4).map((limb, i) => ({
      pos: limb.curve.getPoint(0.58).clone().add(new Vector3(0, -0.04, 0)),
      yaw: (i - 1.5) * 0.45,
      scale: 0.90 * plaqueScale,
      tilt: (i % 2 === 0 ? 1 : -1) * 0.05,
    }))
    // First fill up to 5 trunk plaques, then limb plaques, then 6th trunk plaque if needed
    const ordered = [...trunkBundle.slice(0, 5), ...limbAnchors, trunkBundle[5]]
    const plaqueAnchors = ordered.slice(0, plaqueCount)

    const plaques = makePlaquePairGeometry(plaqueAnchors, cfg.ribbonColor)
    const woodMat = new MeshStandardMaterial({ name: 'WishingPlaquesDecor', vertexColors: true, roughness: 0.78, metalness: 0 })
    const tasselMat = new MeshStandardMaterial({ name: 'WishingTasselsDecor', vertexColors: true, roughness: 0.62, metalness: 0 })
    attachPlaqueWind(woodMat)
    attachPlaqueWind(tasselMat)
    disposables.push(plaques.wood, plaques.tassel, woodMat, tasselMat)

    const woodMesh = new Mesh(plaques.wood, woodMat)
    woodMesh.name = 'Wishing Plaques / 祈愿木牌装饰'
    woodMesh.userData.role = 'decoration'
    woodMesh.castShadow = true
    const tasselMesh = new Mesh(plaques.tassel, tasselMat)
    tasselMesh.name = 'Wishing Tassels / 祈愿红穗装饰'
    tasselMesh.userData.role = 'decoration'
    group.add(woodMesh, tasselMesh)
    triangles += ((plaques.wood.index?.count ?? 0) + (plaques.tassel.index?.count ?? 0)) / 3
  }

  // 4. Warm golden floating 4-point starlight motes around the upper sunlit canopy
  if (cfg.sparkles && cfg.sparkleCount > 0) {
    const moteGeo = makeGoldenMotesGeometry(env.y1, Math.max(2.2, env.width), cfg.sparkleCount, seed)
    const moteMat = new MeshBasicMaterial({
      name: 'GoldenStarlightSparkles',
      color: new Color(cfg.sparkleColor),
      side: DoubleSide,
      transparent: true,
      opacity: 0.90,
    })
    disposables.push(moteGeo, moteMat)
    const moteMesh = new Mesh(moteGeo, moteMat)
    moteMesh.name = 'Golden Sparkles / 金色星芒粒子装饰'
    moteMesh.userData.role = 'decoration'
    group.add(moteMesh)
    triangles += (moteGeo.index?.count ?? 0) / 3
  }

  return { group, disposables, triangles }
}

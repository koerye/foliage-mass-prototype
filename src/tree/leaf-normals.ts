// Custom Foliage Normal Editing & Transfer Engine (Blender Data Transfer / SpeedTree Normal Sculpt style).
// Supports:
// - 6 projection modes: auto, dome (anime/Genshin soft underside), radial (draggable 3D center),
//   cylinder, directional (cel/illustrative shading), and original (raw geometric face normals)
// - Global sculpting modifiers: strength, 3D centerOffset, upLift, underside flatten, azimuth/elevation, jitter
// - Interactive 3D local Normal Brush strokes (up-lift, directional comb, local puff dome, smooth)
// - 3D RGB normal-vector needle visualization geometry builder
// All edited normals write directly into geometry `normal` attributes so GLB exports preserve them 100%!
import {
  BufferAttribute, BufferGeometry, Float32BufferAttribute, Mesh, Object3D, Vector3,
} from 'three'
import type { CrownEnvelope } from './envelope'
import type { XYZ } from './spec'

export const leafNormalModes = [
  'auto',
  'dome',
  'radial',
  'cylinder',
  'directional',
  'original',
] as const
export type LeafNormalMode = typeof leafNormalModes[number]

export const normalBrushKinds = ['up', 'comb', 'puff', 'smooth'] as const
export type NormalBrushKind = typeof normalBrushKinds[number]

export interface NormalBrushStroke {
  id: number
  kind: NormalBrushKind
  center: XYZ
  radius: number
  strength: number
  direction: XYZ
}

export interface LeafNormalEditSpec {
  mode: LeafNormalMode
  strength: number       // 0..1 blend toward custom projection normal
  centerOffsetX: number  // -4..4 m projection center X offset
  centerOffsetY: number  // -4..4 m projection center Y offset (negative lifts underside normals!)
  centerOffsetZ: number  // -4..4 m projection center Z offset
  upLift: number         // -1..1 global upward/downward normal tilt
  flatten: number        // 0..1 reduces dark downward-facing underside normal contrast
  azimuth: number        // -180..180 deg target azimuth (directional mode)
  elevation: number      // -90..90 deg target elevation (directional mode)
  jitter: number         // 0..1 per-card/vertex organic painterly normal variation
  brushes: NormalBrushStroke[]
}

export function defaultLeafNormalEdit(): LeafNormalEditSpec {
  return {
    mode: 'auto',
    strength: 0.85,
    centerOffsetX: 0,
    centerOffsetY: 0,
    centerOffsetZ: 0,
    upLift: 0,
    flatten: 0,
    azimuth: 35,
    elevation: 42,
    jitter: 0,
    brushes: [],
  }
}

export function cloneLeafNormalEdit(src?: LeafNormalEditSpec): LeafNormalEditSpec {
  const base = defaultLeafNormalEdit()
  if (!src) return base
  return {
    ...base,
    ...src,
    brushes: (src.brushes ?? []).map(b => ({
      ...b,
      center: [b.center[0], b.center[1], b.center[2]] as XYZ,
      direction: [b.direction[0], b.direction[1], b.direction[2]] as XYZ,
    })),
  }
}

export function parseLeafNormalEdit(raw: unknown): LeafNormalEditSpec {
  const base = defaultLeafNormalEdit()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const clampN = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb
  const vec3 = (v: unknown, fb: XYZ): XYZ =>
    Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n))
      ? [v[0], v[1], v[2]] as XYZ
      : fb

  const mode = typeof o.mode === 'string' && (leafNormalModes as readonly string[]).includes(o.mode)
    ? o.mode as LeafNormalMode
    : base.mode

  const brushes: NormalBrushStroke[] = []
  if (Array.isArray(o.brushes)) {
    for (let i = 0; i < Math.min(96, o.brushes.length); i++) {
      const b = o.brushes[i] as Record<string, unknown> | null
      if (!b || typeof b !== 'object') continue
      const kind = typeof b.kind === 'string' && (normalBrushKinds as readonly string[]).includes(b.kind)
        ? b.kind as NormalBrushKind
        : 'up'
      brushes.push({
        id: Number.isFinite(Number(b.id)) ? Number(b.id) : i + 1,
        kind,
        center: vec3(b.center, [0, 2, 0]),
        radius: clampN(b.radius, 0.15, 6, 1.0),
        strength: clampN(b.strength, 0.05, 1, 0.65),
        direction: vec3(b.direction, [0, 1, 0]),
      })
    }
  }

  return {
    mode,
    strength: clampN(o.strength, 0, 1, base.strength),
    centerOffsetX: clampN(o.centerOffsetX, -4, 4, 0),
    centerOffsetY: clampN(o.centerOffsetY, -4, 4, 0),
    centerOffsetZ: clampN(o.centerOffsetZ, -4, 4, 0),
    upLift: clampN(o.upLift, -1, 1, 0),
    flatten: clampN(o.flatten, 0, 1, 0),
    azimuth: clampN(o.azimuth, -180, 180, base.azimuth),
    elevation: clampN(o.elevation, -90, 90, base.elevation),
    jitter: clampN(o.jitter, 0, 1, 0),
    brushes,
  }
}

/** Fast check: returns false when default untouched, preserving bit-exact original normals at 0 cost. */
export function isCustomNormalActive(ne?: LeafNormalEditSpec): boolean {
  if (!ne) return false
  if (ne.mode !== 'auto') return true
  if (Math.abs(ne.centerOffsetX) > 1e-4 || Math.abs(ne.centerOffsetY) > 1e-4 || Math.abs(ne.centerOffsetZ) > 1e-4) return true
  if (Math.abs(ne.upLift) > 1e-4 || Math.abs(ne.flatten) > 1e-4 || Math.abs(ne.jitter) > 1e-4) return true
  return (ne.brushes?.length ?? 0) > 0
}

/** Computes the local 3D projection center for a crown envelope + user center offsets. */
export function customNormalCenter(env: CrownEnvelope, ne?: LeafNormalEditSpec): Vector3 {
  const cy = env.y0 + env.height * 0.5
  return new Vector3(
    env.axis.x + (ne?.centerOffsetX ?? 0),
    cy + (ne?.centerOffsetY ?? 0),
    env.axis.z + (ne?.centerOffsetZ ?? 0),
  )
}

function hash3(x: number, y: number, z: number, seed: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453123
  return h - Math.floor(h)
}

/** Computes geometric triangle normals directly from `position` + `index` (for 'original' mode). */
function computeRawGeometricNormals(geo: BufferGeometry): Float32Array {
  const pos = geo.getAttribute('position')
  const count = pos.count
  const out = new Float32Array(count * 3)
  const index = geo.index
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  const ab = new Vector3(), ac = new Vector3(), fn = new Vector3()
  const triCount = index ? index.count / 3 : count / 3
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    fn.crossVectors(ab, ac)
    for (const idx of [i0, i1, i2]) {
      out[idx * 3] += fn.x
      out[idx * 3 + 1] += fn.y
      out[idx * 3 + 2] += fn.z
    }
  }
  for (let i = 0; i < count; i++) {
    const x = out[i * 3], y = out[i * 3 + 1], z = out[i * 3 + 2]
    const len = Math.hypot(x, y, z)
    if (len > 1e-6) {
      out[i * 3] = x / len; out[i * 3 + 1] = y / len; out[i * 3 + 2] = z / len
    } else {
      out[i * 3] = 0; out[i * 3 + 1] = 1; out[i * 3 + 2] = 0
    }
  }
  return out
}

/** Applies custom normal transfer, projection center offset, global sculpting biases, and
 *  interactive 3D local normal brush strokes in-place onto any foliage BufferGeometry.
 *  Guarantees unit-length normals compatible with both live shading & GLB export. */
export function applyCustomLeafNormals(
  geometry: BufferGeometry,
  env: CrownEnvelope,
  edit: LeafNormalEditSpec,
  seed = 1,
): void {
  if (!isCustomNormalActive(edit)) return
  const posAttr = geometry.getAttribute('position')
  const normAttr = geometry.getAttribute('normal')
  if (!posAttr || !normAttr) return

  const cardCenterAttr = geometry.getAttribute('leafCenter')
  const rawGeoNormals = edit.mode === 'original' ? computeRawGeometricNormals(geometry) : undefined
  const projCenter = customNormalCenter(env, edit)
  const rx = Math.max(0.25, env.width)
  const ry = Math.max(0.25, env.height * 0.5)
  const rz = Math.max(0.25, env.depth)

  const azRad = (edit.azimuth * Math.PI) / 180
  const elRad = (edit.elevation * Math.PI) / 180
  const dirVec = new Vector3(
    Math.cos(elRad) * Math.sin(azRad),
    Math.sin(elRad),
    Math.cos(elRad) * Math.cos(azRad),
  ).normalize()

  const strength = Math.max(0, Math.min(1, edit.strength))
  const hasCenterOffset =
    Math.abs(edit.centerOffsetX) > 1e-4 ||
    Math.abs(edit.centerOffsetY) > 1e-4 ||
    Math.abs(edit.centerOffsetZ) > 1e-4
  const brushes = edit.brushes ?? []

  const p = new Vector3()
  const orig = new Vector3()
  const target = new Vector3()
  const n = new Vector3()
  const tmp = new Vector3()
  const brushDir = new Vector3()

  for (let i = 0; i < posAttr.count; i++) {
    p.fromBufferAttribute(posAttr, i)
    orig.fromBufferAttribute(normAttr, i)
    if (orig.lengthSq() < 1e-8) orig.set(0, 1, 0)
    else orig.normalize()

    const dx = p.x - projCenter.x
    const dy = p.y - projCenter.y
    const dz = p.z - projCenter.z

    if (edit.mode === 'original' && rawGeoNormals) {
      target.set(rawGeoNormals[i * 3], rawGeoNormals[i * 3 + 1], rawGeoNormals[i * 3 + 2])
      n.copy(orig).lerp(target, strength)
    } else if (edit.mode === 'dome') {
      target.set(dx / (rx * rx), dy / (ry * ry), dz / (rz * rz))
      if (target.lengthSq() < 1e-8) target.set(0, 1, 0)
      else target.normalize()
      // Soft anime/Genshin hemisphere dome: gently lifts bottom normals so undersides glow softly
      target.y = Math.max(-0.14, target.y * 0.78 + 0.28)
      target.normalize()
      n.copy(orig).lerp(target, strength)
    } else if (edit.mode === 'radial' || (edit.mode === 'auto' && hasCenterOffset)) {
      target.set(dx, dy, dz)
      if (target.lengthSq() < 1e-8) target.set(0, 1, 0)
      else target.normalize()
      const w = edit.mode === 'radial' ? strength : Math.min(1, strength * 0.85)
      n.copy(orig).lerp(target, w)
    } else if (edit.mode === 'cylinder') {
      const hLen = Math.hypot(dx, dz)
      if (hLen > 1e-5) target.set(dx / hLen, Math.max(-0.35, Math.min(0.85, (dy / ry) * 0.38)), dz / hLen).normalize()
      else target.set(0, 1, 0)
      n.copy(orig).lerp(target, strength)
    } else if (edit.mode === 'directional') {
      n.copy(orig).lerp(dirVec, strength)
    } else {
      n.copy(orig)
    }

    if (n.lengthSq() < 1e-8) n.set(0, 1, 0)
    else n.normalize()

    // Global sculpting adjustments: soften dark underside contrast + vertical normal lift
    if (edit.flatten > 1e-4) {
      if (n.y < 0) n.y *= 1 - edit.flatten * 0.88
      n.y += edit.flatten * 0.14
      n.normalize()
    }
    if (Math.abs(edit.upLift) > 1e-4) {
      n.y += edit.upLift * 1.25
      if (n.lengthSq() < 1e-8) n.set(0, edit.upLift >= 0 ? 1 : -1, 0)
      else n.normalize()
    }

    // Painterly organic normal breakup (coherent per leaf card if leafCenter exists)
    if (edit.jitter > 1e-4) {
      const hx = cardCenterAttr ? cardCenterAttr.getX(i) : p.x
      const hy = cardCenterAttr ? cardCenterAttr.getY(i) : p.y
      const hz = cardCenterAttr ? cardCenterAttr.getZ(i) : p.z
      const jx = (hash3(hx, hy, hz, seed + 13) - 0.5) * 2
      const jy = (hash3(hx, hy, hz, seed + 47) - 0.5) * 2
      const jz = (hash3(hx, hy, hz, seed + 91) - 0.5) * 2
      n.x += jx * edit.jitter * 0.65
      n.y += jy * edit.jitter * 0.65
      n.z += jz * edit.jitter * 0.65
      if (n.lengthSq() < 1e-8) n.set(0, 1, 0)
      else n.normalize()
    }

    // Interactive 3D local normal sculpting brushes (applied sequentially for intuitive layering)
    for (let bi = 0; bi < brushes.length; bi++) {
      const b = brushes[bi]
      const bx = p.x - b.center[0]
      const by = p.y - b.center[1]
      const bz = p.z - b.center[2]
      const dist = Math.hypot(bx, by, bz)
      if (dist >= b.radius) continue
      const u = 1 - dist / Math.max(1e-4, b.radius)
      const falloff = u * u * (3 - 2 * u)
      const w = Math.max(0, Math.min(1, falloff * b.strength))
      if (w <= 1e-4) continue

      if (b.kind === 'up') {
        brushDir.set(b.direction[0], b.direction[1], b.direction[2])
        if (brushDir.lengthSq() < 1e-6) brushDir.set(0, 1, 0)
        else brushDir.normalize()
        n.lerp(brushDir, w)
      } else if (b.kind === 'comb') {
        brushDir.set(b.direction[0], b.direction[1], b.direction[2])
        if (brushDir.lengthSq() < 1e-6) brushDir.set(0, 1, 0)
        else brushDir.normalize()
        n.lerp(brushDir, w)
      } else if (b.kind === 'puff') {
        tmp.set(bx, by + b.radius * 0.12, bz)
        if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0)
        else tmp.normalize()
        n.lerp(tmp, w)
      } else if (b.kind === 'smooth') {
        tmp.set(dx / (rx * rx), Math.max(0.05, dy / (ry * ry)), dz / (rz * rz))
        if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0)
        else tmp.normalize()
        n.lerp(tmp, w)
      }
      if (n.lengthSq() < 1e-8) n.set(0, 1, 0)
      else n.normalize()
    }

    normAttr.setXYZ(i, n.x, n.y, n.z)
  }

  normAttr.needsUpdate = true
}

/** Builds RGB-colored 3D normal-vector needles sampled uniformly across foliage meshes
 *  for real-time visual inspection inside the Custom Leaf Normal Editor. */
export function buildNormalVectorsGeometry(root: Object3D, maxNeedles = 720, needleLength = 0.24): BufferGeometry {
  const meshes: Mesh[] = []
  root.traverse(o => {
    if (o instanceof Mesh && o.userData?.role === 'foliage' && o.name !== 'Ambient petals') {
      meshes.push(o)
    }
  })

  let totalVerts = 0
  for (const m of meshes) totalVerts += m.geometry.getAttribute('position')?.count ?? 0
  const stride = Math.max(1, Math.floor(totalVerts / Math.max(1, maxNeedles)))

  const positions: number[] = []
  const colors: number[] = []
  const p = new Vector3()
  const n = new Vector3()
  let counter = 0

  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position') as BufferAttribute | undefined
    const norm = m.geometry.getAttribute('normal') as BufferAttribute | undefined
    if (!pos || !norm) continue
    for (let i = 0; i < pos.count; i++) {
      if (counter++ % stride !== 0) continue
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(norm, i)
      if (n.lengthSq() < 1e-6) continue
      n.normalize()
      const r = n.x * 0.5 + 0.5
      const g = n.y * 0.5 + 0.5
      const b = n.z * 0.5 + 0.5
      // Base of arrow (slightly deeper) -> tip of arrow (crisp RGB normal hue)
      positions.push(p.x, p.y, p.z, p.x + n.x * needleLength, p.y + n.y * needleLength, p.z + n.z * needleLength)
      colors.push(r * 0.62, g * 0.62, b * 0.62, r, g, b)
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

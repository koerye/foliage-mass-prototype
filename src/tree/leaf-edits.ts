// Direct 3D foliage / leaf sculpting data model & evaluation helpers.
// Supports hand-placed sculptural leaf clumps (position/radius/flatten/density/scale/tint)
// and 3D canopy brushes (densify / prune / scale / tint) across Tree Studio, AI Mode,
// Scene Assembly, LOD optimization, and GLB/FBX export.
import { BufferAttribute, BufferGeometry, Color, MathUtils, Vector3 } from 'three'
import type { CrownCluster } from '../broadleaf/leaves'
import type { XYZ } from './spec'

export type LeafBrushKind = 'densify' | 'prune' | 'scale' | 'tint'

export interface LeafClumpEdit {
  id: number
  position: XYZ
  radius: number       // 0.2..3.5 m
  flatten: number      // 0..0.85 horizontal cloud-pad flattening
  density: number      // 0.3..3.0 card density multiplier
  leafScale: number    // 0.4..2.2 card size multiplier
  tint?: string        // optional hex tint color
  tintStrength?: number // 0..1 tint blend strength
}

export interface LeafBrushStroke {
  id: number
  kind: LeafBrushKind
  position: XYZ
  radius: number       // 0.2..3.5 m
  strength: number     // -1..1 (positive for densify/prune/tint; -1..1 for scale)
  color?: string       // optional hex color for 'tint'
}

export interface LeafEditSpec {
  clumps: LeafClumpEdit[]
  brushes: LeafBrushStroke[]
}

const VALID_BRUSH_KINDS = new Set<string>(['densify', 'prune', 'scale', 'tint'])
const HEX_RE = /^#[0-9a-fA-F]{6}$/

const clampNum = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? MathUtils.clamp(v, lo, hi) : fallback

const round3 = (n: number) => Math.round(n * 1000) / 1000

const parseXYZ = (raw: unknown): XYZ | undefined => {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const [x, y, z] = raw
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined
  return [
    round3(MathUtils.clamp(x, -30, 30)),
    round3(MathUtils.clamp(y, -10, 40)),
    round3(MathUtils.clamp(z, -30, 30)),
  ]
}

export function defaultLeafEditSpec(): LeafEditSpec {
  return { clumps: [], brushes: [] }
}

export function hasLeafEdits(edit?: LeafEditSpec): boolean {
  return Boolean(edit && (edit.clumps.length > 0 || edit.brushes.length > 0))
}

export function cloneLeafEditSpec(edit?: LeafEditSpec): LeafEditSpec {
  if (!edit) return defaultLeafEditSpec()
  return {
    clumps: edit.clumps.map(c => ({
      ...c,
      position: [c.position[0], c.position[1], c.position[2]],
    })),
    brushes: edit.brushes.map(b => ({
      ...b,
      position: [b.position[0], b.position[1], b.position[2]],
    })),
  }
}

export function parseLeafEditSpec(raw: unknown): LeafEditSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const clumps: LeafClumpEdit[] = []
  const brushes: LeafBrushStroke[] = []
  const seenClump = new Set<number>()
  const seenBrush = new Set<number>()

  if (Array.isArray(o.clumps)) {
    for (const item of o.clumps) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'number' && Number.isInteger(r.id) && r.id >= 1 ? r.id : clumps.length + 1
      if (seenClump.has(id)) continue
      const pos = parseXYZ(r.position)
      if (!pos) continue
      seenClump.add(id)
      const tint = typeof r.tint === 'string' && HEX_RE.test(r.tint) ? r.tint.toLowerCase() : undefined
      const tintStrength = tint ? round3(clampNum(r.tintStrength, 0, 0, 1)) : 0
      clumps.push({
        id,
        position: pos,
        radius: round3(clampNum(r.radius, .85, .2, 3.5)),
        flatten: round3(clampNum(r.flatten, .32, 0, .85)),
        density: round3(clampNum(r.density, 1.2, .3, 3)),
        leafScale: round3(clampNum(r.leafScale, 1, .4, 2.2)),
        ...(tint && tintStrength > 0 ? { tint, tintStrength } : {}),
      })
      if (clumps.length >= 64) break
    }
  }

  if (Array.isArray(o.brushes)) {
    for (const item of o.brushes) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const kind = typeof r.kind === 'string' && VALID_BRUSH_KINDS.has(r.kind) ? r.kind as LeafBrushKind : undefined
      if (!kind) continue
      const id = typeof r.id === 'number' && Number.isInteger(r.id) && r.id >= 1 ? r.id : brushes.length + 1
      if (seenBrush.has(id)) continue
      const pos = parseXYZ(r.position)
      if (!pos) continue
      seenBrush.add(id)
      const color = kind === 'tint' && typeof r.color === 'string' && HEX_RE.test(r.color) ? r.color.toLowerCase() : undefined
      const lo = kind === 'scale' ? -1 : .05
      brushes.push({
        id,
        kind,
        position: pos,
        radius: round3(clampNum(r.radius, .95, .2, 3.5)),
        strength: round3(clampNum(r.strength, .72, lo, 1)),
        ...(color ? { color } : {}),
      })
      if (brushes.length >= 120) break
    }
  }

  return clumps.length > 0 || brushes.length > 0 ? { clumps, brushes } : undefined
}

/** Smooth cubic falloff 1 at center -> 0 at boundary. */
export function brushFalloff(dist: number, radius: number): number {
  if (radius <= 1e-5 || dist >= radius) return 0
  const t = 1 - dist / radius
  return t * t * (3 - 2 * t)
}

/** Convert a hand-placed LeafClumpEdit into a CrownCluster usable by broadleaf placement. */
export function clumpToCrownCluster(clump: LeafClumpEdit): CrownCluster {
  const r = MathUtils.clamp(clump.radius, .2, 3.5)
  const flat = MathUtils.clamp(clump.flatten, 0, .85)
  return {
    center: new Vector3(clump.position[0], clump.position[1], clump.position[2]),
    direction: new Vector3(1, 0, 0),
    width: r * (1 + flat * .45),
    height: r * Math.max(.24, 1 - flat * .64),
    depth: r * (1 + flat * .38),
    density: MathUtils.clamp(clump.density, .3, 3),
    leafScale: MathUtils.clamp(clump.leafScale, .4, 2.2),
    tint: clump.tint,
    tintStrength: clump.tintStrength,
    manual: true,
  }
}

/** Compute cumulative prune mask [0..1] at a 3D point from all 'prune' brush strokes. */
export function leafPruneMaskAt(p: Vector3, edit?: LeafEditSpec): number {
  if (!edit || !edit.brushes.length) return 0
  let keepProb = 1
  for (const b of edit.brushes) {
    if (b.kind !== 'prune' || b.strength <= 0) continue
    const dx = p.x - b.position[0], dy = p.y - b.position[1], dz = p.z - b.position[2]
    const dist = Math.hypot(dx, dy, dz)
    if (dist >= b.radius) continue
    // Plateau core (full strength within inner ~32% radius) with smooth cubic feathering to edge
    const t = MathUtils.clamp((1 - dist / b.radius) * 1.48, 0, 1)
    const w = t * t * (3 - 2 * t) * MathUtils.clamp(b.strength, 0, 1)
    keepProb *= 1 - w
  }
  return 1 - keepProb
}

/** Compute local leaf card size multiplier [0.3..2.6] from 'scale' brushes and manual clumps. */
export function leafScaleFactorAt(p: Vector3, edit?: LeafEditSpec): number {
  if (!edit) return 1
  let factor = 1
  for (const b of edit.brushes) {
    if (b.kind !== 'scale' || Math.abs(b.strength) < 1e-4) continue
    const dist = Math.hypot(p.x - b.position[0], p.y - b.position[1], p.z - b.position[2])
    if (dist >= b.radius) continue
    const w = brushFalloff(dist, b.radius)
    // strength > 0 enlarges up to ~1.95x; strength < 0 shrinks down to ~0.42x
    const localScale = b.strength >= 0
      ? 1 + b.strength * w * .95
      : Math.max(.38, 1 + b.strength * w * .62)
    factor *= localScale
  }
  return MathUtils.clamp(factor, .3, 2.6)
}

const _tmpColor = new Color()

/** Smoothly blend 'tint' brush strokes (and optional manual clump tint) into a foliage color. */
export function applyLeafTintAt(p: Vector3, edit: LeafEditSpec | undefined, target: Color, manualClump?: LeafClumpEdit): void {
  if (manualClump?.tint && (manualClump.tintStrength ?? 0) > 0) {
    _tmpColor.set(manualClump.tint)
    target.lerp(_tmpColor, MathUtils.clamp(manualClump.tintStrength ?? 0, 0, 1))
  }
  if (!edit || !edit.brushes.length) return
  for (const b of edit.brushes) {
    if (b.kind !== 'tint' || !b.color || b.strength <= 0) continue
    const dist = Math.hypot(p.x - b.position[0], p.y - b.position[1], p.z - b.position[2])
    if (dist >= b.radius) continue
    const w = brushFalloff(dist, b.radius) * MathUtils.clamp(b.strength, 0, 1)
    if (w > 1e-4) {
      _tmpColor.set(b.color)
      target.lerp(_tmpColor, MathUtils.clamp(w, 0, 1))
    }
  }
}

/** Deterministic hash in [0, 1) for triangle-level pruning on non-broadleaf foliage meshes. */
function hash01(i: number, seed: number): number {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed + 17, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  return h / 0x100000000
}

/** Generic post-pass for non-broadleaf foliage meshes (conifer fronds, bamboo leaves, palm fronds, grass, lotus).
 *  Supports prune (drops triangles smoothly inside prune strokes), scale (scales triangles about centroid),
 *  and tint (blends vertex colors cleanly). Broadleaf uses native card-level clumps + densify + prune + scale + tint. */
export function applyLeafEditsToGeometry(geometry: BufferGeometry, edit: LeafEditSpec | undefined, seed = 1): void {
  if (!edit || !edit.brushes.length) return
  const pos = geometry.getAttribute('position') as BufferAttribute | undefined
  if (!pos || pos.count === 0) return

  const hasPrune = edit.brushes.some(b => b.kind === 'prune' && b.strength > 0)
  const hasScale = edit.brushes.some(b => b.kind === 'scale' && Math.abs(b.strength) > 1e-4)
  const hasTint = edit.brushes.some(b => b.kind === 'tint' && b.color && b.strength > 0)
  if (!hasPrune && !hasScale && !hasTint) return

  const pt = new Vector3()

  // 1. Prune triangles inside prune brush strokes
  if (hasPrune) {
    const idx = geometry.getIndex()
    if (idx) {
      const src = idx.array
      const kept: number[] = []
      for (let t = 0; t + 2 < src.length; t += 3) {
        const a = src[t], b = src[t + 1], c = src[t + 2]
        pt.set(
          (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
          (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
          (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3,
        )
        const mask = leafPruneMaskAt(pt, edit)
        if (mask > .92 || (mask > .04 && hash01(t / 3, seed) < mask)) continue
        kept.push(a, b, c)
      }
      geometry.setIndex(kept)
    }
  }

  // 2. Scale vertices gently away from brush center for non-broadleaf blades/fronds
  if (hasScale) {
    for (let i = 0; i < pos.count; i++) {
      pt.set(pos.getX(i), pos.getY(i), pos.getZ(i))
      let dx = 0, dy = 0, dz = 0
      for (const b of edit.brushes) {
        if (b.kind !== 'scale' || Math.abs(b.strength) < 1e-4) continue
        const rx = pt.x - b.position[0], ry = pt.y - b.position[1], rz = pt.z - b.position[2]
        const dist = Math.hypot(rx, ry, rz)
        if (dist >= b.radius || dist < 1e-5) continue
        const w = brushFalloff(dist, b.radius) * b.strength * .32
        dx += rx * w
        dy += ry * w
        dz += rz * w
      }
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        pos.setXYZ(i, pt.x + dx, pt.y + dy, pt.z + dz)
      }
    }
    pos.needsUpdate = true
  }

  // 3. Vertex-color tint painting
  if (hasTint) {
    const col = geometry.getAttribute('color') as BufferAttribute | undefined
    if (col) {
      const c = new Color()
      for (let i = 0; i < pos.count; i++) {
        pt.set(pos.getX(i), pos.getY(i), pos.getZ(i))
        c.setRGB(col.getX(i), col.getY(i), col.getZ(i))
        applyLeafTintAt(pt, edit, c)
        col.setXYZ(i, c.r, c.g, c.b)
      }
      col.needsUpdate = true
    }
  }
}

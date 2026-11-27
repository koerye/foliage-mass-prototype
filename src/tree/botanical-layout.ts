// Botanical horizontal placement & left-right stagger algorithms shared by all 16 stylized plants.
// Supports 5 distinct procedural/botanical distribution patterns:
//   - 'phyllotaxis': Golden-angle (137.508°) Vogel spiral — zero radial stacking across 360°
//   - 'ring':        Concentric circular rings with strict half-step inter-ring interleaving
//   - 'scatter':     2D blue-noise Poisson-disc random scatter across the horizontal footprint
//   - 'clumps':      Multi-sub-cluster organic meadow hubs (3–5 irregular tufts)
//   - 'fan':         Botanical distichous bilateral left-right staggered fan (iris / sword-leaf)
import { MathUtils } from 'three'

export type BotanicalLayout = 'phyllotaxis' | 'ring' | 'scatter' | 'clumps' | 'fan'

export const botanicalLayouts: readonly BotanicalLayout[] = [
  'phyllotaxis',
  'ring',
  'scatter',
  'clumps',
  'fan',
] as const

export const botanicalLayoutLabels: Record<BotanicalLayout, string> = {
  phyllotaxis: '黄金角螺旋错位（360° 零叠叶）',
  ring: '圆形环绕错缝（同心圆交错）',
  scatter: '范围内随机散布（泊松蓝噪）',
  clumps: '多簇自然聚落（不规则草团）',
  fan: '扇形左右交错（二列互生）',
}

export interface HorizontalSlot {
  /** Ground-plane base X offset (m) */
  x: number
  /** Ground-plane base Z offset (m) */
  z: number
  /** Primary outward horizontal azimuth (radians, 0 = +X, π/2 = +Z) */
  angle: number
  /** Normalized radial distance 0 (center) .. 1 (outer perimeter) */
  rFrac: number
  /** Semantic group index (ring 0..2, cluster hub id, or bilateral tier) */
  group: number
  /** Signed left/right stagger bias (-1..+1) for lateral sway & root separation */
  sideSign: number
}

export interface HorizontalLayoutOptions {
  layout: BotanicalLayout
  count: number
  /** Primary horizontal spread radius (m) used by phyllotaxis / ring / fan */
  radius: number
  /** Footprint radius (m) for area-filling patterns (scatter / clumps) */
  areaRadius?: number
  /** 0..1 horizontal left-right stagger, tangential offset & separation strength */
  lateralJitter: number
  /** Deterministic RNG returning [0, 1) */
  random: () => number
  /** Optional initial phase rotation (radians) */
  phaseOffset?: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) // ~2.399963 rad (137.5077°)
const TWO_PI = Math.PI * 2

function wrapAngle(a: number): number {
  let out = a % TWO_PI
  if (out < 0) out += TWO_PI
  return out
}

/**
 * Generates deterministic, non-clumping horizontal slots according to the chosen botanical layout
 * and lateral stagger amplitude (`lateralJitter` in 0..1).
 */
export function sampleHorizontalSlots(opts: HorizontalLayoutOptions): HorizontalSlot[] {
  const count = Math.max(1, Math.round(opts.count))
  const lj = MathUtils.clamp(opts.lateralJitter, 0, 1)
  const rad = Math.max(0.02, opts.radius)
  const areaRad = Math.max(rad, opts.areaRadius ?? rad)
  const rng = opts.random
  const phase0 = opts.phaseOffset ?? rng() * TWO_PI
  const slots: HorizontalSlot[] = []

  if (opts.layout === 'ring') {
    // 2 or 3 concentric circular rings with strict half-step angular interleaving so outer leaves
    // sit cleanly inside the gaps between inner-ring leaves, while keeping the heart tightly closed.
    const specs = count <= 7
      ? [
        { frac: 0.36, rScale: 0.22, halfStep: 0.0 },
        { frac: 0.64, rScale: 1.00, halfStep: 0.5 },
      ]
      : [
        { frac: 0.26, rScale: 0.14, halfStep: 0.0 },
        { frac: 0.42, rScale: 0.56, halfStep: 0.5 },
        { frac: 0.32, rScale: 1.00, halfStep: 0.25 },
      ]

    let remaining = count
    for (let ri = 0; ri < specs.length; ri++) {
      const sp = specs[ri]
      const isLast = ri === specs.length - 1
      const nRing = isLast
        ? Math.max(1, remaining)
        : Math.max(2, Math.min(remaining - (specs.length - 1 - ri), Math.round(count * sp.frac)))
      remaining -= nRing
      const step = TWO_PI / nRing
      const ringPhase = phase0 + sp.halfStep * step

      for (let j = 0; j < nRing; j++) {
        const sideSign = j % 2 === 0 ? 1 : -1
        // Controlled azimuthal jitter stays strictly below ±0.30 * step so ring slots never swap order!
        const angJitter = (rng() - 0.5) * step * MathUtils.lerp(0.06, 0.52, lj)
        const angle = wrapAngle(ringPhase + j * step + angJitter)
        const rJitter = 1 + (rng() - 0.5) * MathUtils.lerp(0.08, 0.38, lj)
        const rFrac = MathUtils.clamp(sp.rScale * rJitter, 0.04, 1.05)
        const r = rad * rFrac
        // Tangential left-right root stagger ramps up outside the core so the center never opens a donut hole
        const tang = sideSign * rad * lj * (0.06 + rng() * 0.12) * MathUtils.smoothstep(rFrac, 0.14, 0.65)
        const cx = Math.cos(angle), sz = Math.sin(angle)
        slots.push({
          x: cx * r - sz * tang,
          z: sz * r + cx * tang,
          angle,
          rFrac: MathUtils.clamp(rFrac, 0, 1),
          group: ri,
          sideSign,
        })
      }
    }
    return slots
  }

  if (opts.layout === 'scatter') {
    // 2D blue-noise Poisson-disc random scatter across the FULL horizontal footprint (including center!).
    // Each scattered blade gets an independent organic azimuth so it fills the whole patch naturally
    // instead of blowing radially outward into a hollow ring!
    const R = areaRad * MathUtils.lerp(0.70, 1.15, lj)
    const idealDist = R * Math.sqrt(Math.PI / Math.max(2, count))
    let minDist = idealDist * MathUtils.lerp(0.45, 0.86, lj)
    const maxAttempts = count * 28

    // Seed 1–2 anchor points near the center heart so random patches stay lush across the middle
    const coreAnchors = count >= 8 ? 2 : 1
    for (let c = 0; c < coreAnchors && slots.length < count; c++) {
      const aPos = rng() * TWO_PI
      const rCore = R * (0.05 + rng() * 0.22)
      slots.push({
        x: Math.cos(aPos) * rCore,
        z: Math.sin(aPos) * rCore,
        angle: wrapAngle(phase0 + c * GOLDEN_ANGLE + (rng() - 0.5) * 1.4),
        rFrac: rCore / Math.max(0.05, R),
        group: 0,
        sideSign: c % 2 === 0 ? 1 : -1,
      })
    }

    for (let attempt = 0; attempt < maxAttempts && slots.length < count; attempt++) {
      if (attempt > count * 14 && attempt % count === 0) minDist *= 0.86
      const aPos = rng() * TWO_PI
      const rFrac = Math.sqrt(rng())
      const x = Math.cos(aPos) * R * rFrac
      const z = Math.sin(aPos) * R * rFrac
      let tooClose = false
      for (let k = 0; k < slots.length; k++) {
        const dx = slots[k].x - x, dz = slots[k].z - z
        if (dx * dx + dz * dz < minDist * minDist) { tooClose = true; break }
      }
      if (tooClose) continue

      const sideSign = slots.length % 2 === 0 ? 1 : -1
      // Truly free random yaw in the interior; only gentle outward bias near the very outer rim!
      const randA = rng() * TWO_PI
      const outA = Math.atan2(z, x)
      const rimPull = MathUtils.smoothstep(rFrac, 0.65, 1.0) * 0.45
      const vx = Math.cos(randA) * (1 - rimPull) + Math.cos(outA) * rimPull
      const vz = Math.sin(randA) * (1 - rimPull) + Math.sin(outA) * rimPull
      const angle = wrapAngle(Math.atan2(vz, vx))
      slots.push({
        x,
        z,
        angle,
        rFrac: MathUtils.clamp(rFrac, 0, 1),
        group: rFrac < 0.36 ? 0 : rFrac < 0.72 ? 1 : 2,
        sideSign,
      })
    }
    while (slots.length < count) {
      const i = slots.length
      const a = wrapAngle(phase0 + i * GOLDEN_ANGLE)
      const rf = Math.sqrt((i + 0.5) / count)
      slots.push({
        x: Math.cos(a) * R * rf,
        z: Math.sin(a) * R * rf,
        angle: wrapAngle(rng() * TWO_PI),
        rFrac: MathUtils.clamp(rf, 0, 1),
        group: rf < 0.36 ? 0 : rf < 0.72 ? 1 : 2,
        sideSign: i % 2 === 0 ? 1 : -1,
      })
    }
    return slots
  }

  if (opts.layout === 'clumps') {
    // 3–5 cohesive organic sub-cluster tufts (each tuft has its own tight local rosette + 360° splay)
    const R = areaRad * MathUtils.lerp(0.68, 1.12, lj)
    const hubCount = count < 14 ? 3 : 4
    const hubs: { x: number; z: number; r: number; idx: number }[] = [
      { x: 0, z: 0, r: R * 0.42, idx: 0 },
    ]
    for (let h = 1; h < hubCount; h++) {
      const ha = phase0 + ((h - 1) / (hubCount - 1)) * TWO_PI + (rng() - 0.5) * (0.65 * (0.4 + lj * 0.6))
      const hd = R * MathUtils.lerp(0.32, 0.52, 0.30 + rng() * 0.70)
      hubs.push({
        x: Math.cos(ha) * hd,
        z: Math.sin(ha) * hd,
        r: R * (0.28 + rng() * 0.14),
        idx: h,
      })
    }

    const perHubCounter = new Array<number>(hubs.length).fill(0)
    let minDist = R * Math.sqrt(Math.PI / Math.max(4, count)) * MathUtils.lerp(0.26, 0.54, lj)
    const maxAttempts = count * 24
    for (let attempt = 0; attempt < maxAttempts && slots.length < count; attempt++) {
      if (attempt > count * 12 && attempt % count === 0) minDist *= 0.82
      const hi = attempt % hubs.length
      const hub = hubs[hi]
      const kLocal = perHubCounter[hi]
      // Each sub-hub forms a tight organic mini-tuft radiating 360° around its own crown!
      const aLoc = wrapAngle(phase0 + hi * 1.3 + kLocal * GOLDEN_ANGLE + (rng() - 0.5) * (0.35 + lj * 0.55))
      const dLoc = hub.r * Math.pow(rng(), 0.95)
      const x = hub.x + Math.cos(aLoc) * dLoc
      const z = hub.z + Math.sin(aLoc) * dLoc
      let tooClose = false
      for (let k = 0; k < slots.length; k++) {
        const dx = slots[k].x - x, dz = slots[k].z - z
        if (dx * dx + dz * dz < minDist * minDist) { tooClose = true; break }
      }
      if (tooClose) continue
      perHubCounter[hi]++

      const rFrac = MathUtils.clamp(Math.hypot(x, z) / Math.max(0.05, R), 0, 1)
      slots.push({
        x,
        z,
        angle: aLoc,
        rFrac,
        group: kLocal === 0 ? 0 : (rFrac < 0.65 ? 1 : 2),
        sideSign: slots.length % 2 === 0 ? 1 : -1,
      })
    }
    while (slots.length < count) {
      const i = slots.length
      const hub = hubs[i % hubs.length]
      const a = wrapAngle(phase0 + i * GOLDEN_ANGLE)
      const d = hub.r * (0.1 + rng() * 0.45)
      const x = hub.x + Math.cos(a) * d
      const z = hub.z + Math.sin(a) * d
      slots.push({
        x,
        z,
        angle: a,
        rFrac: MathUtils.clamp(Math.hypot(x, z) / Math.max(0.05, R), 0, 1),
        group: i % 3,
        sideSign: i % 2 === 0 ? 1 : -1,
      })
    }
    return slots
  }

  if (opts.layout === 'fan') {
    // Botanical distichous bilateral fan: leaves interlock tightly at the center sheath (x ≈ 0)
    // and alternate Left (-X) / Right (+X) with progressive outward wing splay & gentle front/back Z stagger!
    const halfSpan = MathUtils.degToRad(MathUtils.lerp(24, 58, lj))
    const latWidth = Math.max(rad * 0.85, areaRad * 0.36) * MathUtils.lerp(0.45, 1.05, lj)
    const zDepth = Math.max(rad * 0.25, areaRad * 0.16) * MathUtils.lerp(0.22, 0.85, lj)

    for (let i = 0; i < count; i++) {
      const sideSign = i % 2 === 0 ? 1 : -1 // +1 right (+X), -1 left (-X)
      const pairIdx = Math.floor(i / 2)
      const pairTotal = Math.max(1, Math.ceil(count / 2))
      const u = pairTotal <= 1 ? 0.5 : pairIdx / (pairTotal - 1) // 0 = interlocked center blade, 1 = outer wide wing
      const zAltern = (pairIdx % 2 === 0 ? 1 : -1) * (0.45 + rng() * 0.55)
      const baseDir = sideSign > 0 ? 0 : Math.PI
      const fanSweep = zAltern * halfSpan * MathUtils.lerp(0.25, 1.0, u) + (rng() - 0.5) * 0.20 * lj
      const angle = wrapAngle(baseDir + fanSweep)
      // Inner pair interlocks right at center (0.04..0.15 * latWidth) so there is zero central split gap!
      const x = sideSign * latWidth * MathUtils.lerp(0.03, 1.0, u * u * 0.55 + u * 0.45) * (0.90 + rng() * 0.20)
      const z = zAltern * zDepth * MathUtils.lerp(0.18, 1.0, u) + (rng() - 0.5) * zDepth * 0.22
      slots.push({
        x,
        z,
        angle,
        rFrac: MathUtils.clamp(MathUtils.lerp(0.10, 1.0, u), 0, 1),
        group: u < 0.34 ? 0 : u < 0.70 ? 1 : 2,
        sideSign,
      })
    }
    return slots
  }

  // Default: 'phyllotaxis' — Vogel golden-angle spiral (137.508°), guaranteeing zero cross-ring stacking
  // AND keeping the center heart tightly closed with tapered tangential left-right stagger!
  const spiralSpread = rad * MathUtils.lerp(0.75, 1.25, lj)
  for (let i = 0; i < count; i++) {
    const u = (i + 0.30) / count
    const rFrac = Math.sqrt(u)
    const sideSign = i % 2 === 0 ? 1 : -1
    // Keep angular jitter strictly below 26° so golden-angle spacing never collapses two adjacent leaves!
    const angJitter = (rng() - 0.5) * MathUtils.lerp(0.08, 0.40, lj)
    const angle = wrapAngle(phase0 + i * GOLDEN_ANGLE + angJitter)
    const r = spiralSpread * MathUtils.lerp(0.04, 1.0, rFrac * rFrac * 0.35 + rFrac * 0.65) * (0.88 + rng() * 0.24)
    // Tangential left-right root offset ramps smoothly outside the inner heart so center stays lush & solid!
    const tang = sideSign * rad * MathUtils.lerp(0.08, 0.38, lj) * (0.45 + rng() * 0.55) * MathUtils.smoothstep(rFrac, 0.24, 0.78)
    const cx = Math.cos(angle), sz = Math.sin(angle)
    slots.push({
      x: cx * r - sz * tang,
      z: sz * r + cx * tang,
      angle,
      rFrac: MathUtils.clamp(rFrac, 0, 1),
      group: rFrac < 0.48 ? 0 : rFrac < 0.80 ? 1 : 2,
      sideSign,
    })
  }
  return slots
}

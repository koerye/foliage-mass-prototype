// Vegetation-aware polycount / LOD optimization presets and target-budget solver.
import { MathUtils } from 'three'
import { buildTree, type TreeTextures } from './assemble'
import type { OptimizeSpec, TreeSpec } from './spec'

export interface LodPreset {
  id: 'high' | 'game' | 'mobile' | 'distant'
  label: string
  hint: string
  level: number
}

export const lodPresets: readonly LodPreset[] = [
  { id: 'high', label: '高模', hint: '原始精度，不做减面', level: 0 },
  { id: 'game', label: '标准游戏', hint: '剔除隐藏枝 + 平板卡片 + 轻度减卡，观感几乎不变', level: .42 },
  { id: 'mobile', label: '手游轻量', hint: '大幅精简木质与卡片面数，保持剪影与饱满度', level: .72 },
  { id: 'distant', label: '远景 LOD', hint: '极致低面数，适合中远景大面积实例化', level: .94 },
]

/** Derive coordinated wood/card reduction parameters from a single 0..1 level. */
export function optimizeAt(level: number, targetTriangles = 3000): OptimizeSpec {
  const t = MathUtils.clamp(level, 0, 1)
  if (t <= .005) {
    return { level: 0, woodDetail: 1, cullHiddenWood: false, flatCards: false, cardReduction: 0, targetTriangles }
  }
  return {
    level: +t.toFixed(2),
    woodDetail: +(MathUtils.lerp(.85, .24, t)).toFixed(2),
    cullHiddenWood: t >= .15,
    flatCards: t >= .2,
    cardReduction: +(t <= .22 ? 0 : MathUtils.clamp((t - .22) / .78 * .74, 0, .74)).toFixed(2),
    targetTriangles,
  }
}

/**
 * Binary-search the lowest optimization level that brings the tree's triangle
 * count at or below `target` (preserving maximum visual fidelity for the budget).
 * Reuses a single cached skeleton & unreduced foliage placement via `remeshForOptimize`.
 */
export function solveForTriangleBudget(spec: TreeSpec, textures: TreeTextures, target: number) {
  const goal = Math.max(100, Math.round(target))
  const baseOpt = optimizeAt(0, goal)
  const asset = buildTree({ ...spec, optimize: baseOpt }, textures)
  try {
    const before = asset.stats.triangles
    if (before <= goal) return { optimize: baseOpt, before, after: before, reached: true }
    const measure = (level: number) => {
      const opt = optimizeAt(level, goal)
      const nextSpec = { ...spec, optimize: opt }
      if (asset.remeshForOptimize(nextSpec)) {
        return { opt, triangles: asset.stats.triangles }
      }
      const fallback = buildTree(nextSpec, textures)
      const triangles = fallback.stats.triangles
      fallback.dispose()
      return { opt, triangles }
    }
    const minPossible = measure(1)
    if (minPossible.triangles >= goal) {
      return { optimize: minPossible.opt, before, after: minPossible.triangles, reached: minPossible.triangles <= goal }
    }
    let lo = 0, hi = 1
    let best = minPossible
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) * .5
      const cur = measure(mid)
      if (cur.triangles <= goal) {
        best = cur
        hi = mid
      } else {
        lo = mid
      }
    }
    return { optimize: best.opt, before, after: best.triangles, reached: true }
  } finally {
    asset.dispose()
  }
}

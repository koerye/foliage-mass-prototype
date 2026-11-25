// Agent-Native Reference Replication Optimizer & Dual-End (Browser + Node CLI) Agent API.
// Runs bounded, whitelist-only, cache-aware multi-stage coordinate pattern search strictly within
// evaluation/time budgets, tracking cache hits, eval ms, score ms, and 128->256->512 ranking consistency.
import { TextureGraphEvaluator } from './engine'
import {
  clamp01, labToSrgb, rgb01ToHex, rgbaBufferToImageData, type RgbaImageData,
} from './image-utils'
import { allNodeTypes, cloneGraph, nodeDefinitions, normalizeGraphSchemaVersion } from './nodes'
import {
  analyzeReferenceImage, type OptimizableParamSpec, type RefAnalysisResult,
} from './ref-analyze'
import {
  RefFeatureCache, renderDiagnosticSheet, scoreAgainstReference,
  type ScoreBreakdown, type ScoreMode,
} from './ref-score'
import type {
  LabelBuffer, TextureGraph, VectorLeafInstance,
} from './types'

export interface OptimizeOptions {
  mode?: ScoreMode
  maxEvals?: number // Default 85 (consensus 80-100 budget)
  maxWallMs?: number // Soft timeout guard
  params?: OptimizableParamSpec[]
  verify512?: boolean
  enablePaletteSnap?: boolean
  enableScaleProbe?: boolean
  signal?: AbortSignal
}

export interface OptimizeStageSummary {
  name: string
  resolution: number
  evals: number
  cacheHits: number
  cacheMisses: number
  scoreBefore: number
  scoreAfter: number
  ms: number
}

export interface OptimizeResult {
  improved: boolean
  rolledBack: boolean
  initialScore128: ScoreBreakdown
  bestScore128: ScoreBreakdown
  initialScore256: ScoreBreakdown
  bestScore256: ScoreBreakdown
  finalScore512?: ScoreBreakdown
  bestGraph: TextureGraph
  telemetry: {
    totalEvals: number
    cacheHits: number
    cacheMisses: number
    cacheHitRate: number
    evalMsTotal: number
    scoreMsTotal: number
    wallMsTotal: number
    stages: OptimizeStageSummary[]
  }
}

/** Auto-builds a safe whitelisted continuous parameter list if caller didn't pass one from RefAnalyzer. */
export function inferWhitelistedParams(graph: TextureGraph): OptimizableParamSpec[] {
  const out: OptimizableParamSpec[] = []
  for (const n of graph.nodes) {
    if (n.type === 'custom_leaf') {
      out.push(
        { nodeId: n.id, key: 'width', min: 0.34, max: 0.84, step: 0.05, stage: 1 },
        { nodeId: n.id, key: 'length', min: 0.72, max: 0.96, step: 0.04, stage: 1 },
        { nodeId: n.id, key: 'bend', min: -0.25, max: 0.25, step: 0.06, stage: 1 },
      )
    } else if (n.type === 'vector_layout') {
      out.push(
        { nodeId: n.id, key: 'paletteStrength', min: 0.55, max: 1.0, step: 0.08, stage: 2 },
        { nodeId: n.id, key: 'lightStrength', min: 0.0, max: 0.45, step: 0.06, stage: 2 },
        { nodeId: n.id, key: 'depthShade', min: 0.0, max: 0.48, step: 0.06, stage: 2 },
        { nodeId: n.id, key: 'lightAngle', min: -180, max: 180, step: 25, stage: 2 },
      )
    } else if (n.type === 'ink_outline') {
      const ow = Number(n.params.outerWidth ?? 0)
      const iw = Number(n.params.innerWidth ?? 0)
      if (ow > 0.1) out.push({ nodeId: n.id, key: 'outerWidth', min: 1.0, max: 6.5, step: 0.5, stage: 3 })
      if (iw > 0.1) out.push({ nodeId: n.id, key: 'innerWidth', min: 0.5, max: 4.5, step: 0.4, stage: 3 })
    } else if (n.type === 'painterly_bark') {
      out.push(
        { nodeId: n.id, key: 'scaleX', min: 3, max: 14, step: 1, stage: 1 },
        { nodeId: n.id, key: 'scaleY', min: 1, max: 6, step: 1, stage: 1 },
        { nodeId: n.id, key: 'flowWarp', min: 0.1, max: 1.3, step: 0.15, stage: 1 },
        { nodeId: n.id, key: 'mossCoverage', min: 0, max: 0.95, step: 0.08, stage: 1 },
        { nodeId: n.id, key: 'creviceDepth', min: 0.25, max: 1.35, step: 0.15, stage: 1 },
        { nodeId: n.id, key: 'brushSteps', min: 3, max: 10, step: 1, stage: 2 },
      )
    } else if (n.type === 'bark_fibers') {
      out.push(
        { nodeId: n.id, key: 'scaleX', min: 3, max: 16, step: 1.5, stage: 1 },
        { nodeId: n.id, key: 'warp', min: 0.1, max: 1.4, step: 0.18, stage: 1 },
        { nodeId: n.id, key: 'fissure', min: 0.5, max: 2.2, step: 0.2, stage: 1 },
      )
    } else if (n.type === 'curvature_ao') {
      out.push(
        { nodeId: n.id, key: 'bias', min: -0.35, max: 0.35, step: 0.06, stage: 2 },
        { nodeId: n.id, key: 'aoStrength', min: 0.1, max: 1.4, step: 0.15, stage: 2 },
      )
    } else if (n.type === 'palette_map') {
      out.push({ nodeId: n.id, key: 'strength', min: 0.0, max: 0.95, step: 0.12, stage: 2 })
    } else if (n.type === 'branch_scatter') {
      out.push(
        { nodeId: n.id, key: 'leafScale', min: 0.22, max: 0.68, step: 0.04, stage: 1 },
        { nodeId: n.id, key: 'spread', min: 0.5, max: 1.35, step: 0.08, stage: 1 },
        { nodeId: n.id, key: 'depthShade', min: 0.1, max: 0.68, step: 0.07, stage: 2 },
      )
    } else if (n.type === 'blend' && (n.id.includes('ao') || n.id.includes('mix'))) {
      out.push({ nodeId: n.id, key: 'opacity', min: 0.05, max: 0.95, step: 0.1, stage: 2 })
    }
  }
  return out
}

export function optimizeGraphAgainstReference(
  initialGraphRaw: TextureGraph,
  refImg: RgbaImageData,
  opts: OptimizeOptions = {},
): OptimizeResult {
  const wallStart = performance.now()
  const initialGraph = normalizeGraphSchemaVersion(cloneGraph(initialGraphRaw))
  const mode: ScoreMode = opts.mode ?? (initialGraph.targetSlot === 'bark' ? 'bark_tile' : 'figurative')
  const maxEvals = Math.max(12, Math.min(140, opts.maxEvals ?? 85))
  const maxWallMs = Math.max(1000, opts.maxWallMs ?? 12000)
  const whitelist = (opts.params && opts.params.length > 0 ? opts.params : inferWhitelistedParams(initialGraph))
    .filter(spec => initialGraph.nodes.some(n => n.id === spec.nodeId))

  const refCache = new RefFeatureCache(refImg)
  const evaluator = new TextureGraphEvaluator()

  let totalEvals = 0
  let cacheHits = 0
  let cacheMisses = 0
  let evalMsTotal = 0
  let scoreMsTotal = 0
  const stages: OptimizeStageSummary[] = []

  const isBudgetLeft = (reserve = 2) => {
    if (opts.signal?.aborted) return false
    if (totalEvals + reserve >= maxEvals) return false
    if (performance.now() - wallStart > maxWallMs) return false
    return true
  }

  const evalAndScore = (g: TextureGraph, res: number, skipPbr = true) => {
    const ev = evaluator.evaluate(g, res, { skipPbrMaps: skipPbr })
    totalEvals++
    cacheHits += ev.cacheHits ?? 0
    cacheMisses += ev.cacheMisses ?? 0
    evalMsTotal += ev.evalMs
    const img = rgbaBufferToImageData(ev.output.baseColor)
    const score = scoreAgainstReference(refCache, img, mode, res)
    scoreMsTotal += score.scoreMs
    return { ev, score, img }
  }

  // Baseline evaluation at 128px & 256px
  const init128 = evalAndScore(initialGraph, 128, true)
  const init256 = evalAndScore(initialGraph, 256, true)

  let bestGraph = cloneGraph(initialGraph)
  let bestScore128 = init128.score
  let lastEval128 = init128.ev

  // -------------------------------------------------------------------------
  // Stage 0 (Figurative vector_layout): Closed-Form Palette Snap + Scale Probe
  // -------------------------------------------------------------------------
  const vecNode = bestGraph.nodes.find(n => n.type === 'vector_layout')
  if (mode === 'figurative' && vecNode && isBudgetLeft(6)) {
    const s0Start = performance.now()
    const s0Evals = totalEvals, s0Hits = cacheHits, s0Miss = cacheMisses
    const s0Before = bestScore128.totalScore

    // 0a. Uniform leaf scale probe (tightens overall alpha IoU & contour F1 immediately!)
    if (opts.enableScaleProbe !== false) {
      const baseInstances = (vecNode.params.instances as VectorLeafInstance[] | undefined) ?? []
      if (baseInstances.length > 0) {
        let bestMul = 1.0
        for (const mul of [0.90, 0.95, 1.06, 1.13, 1.22]) {
          if (!isBudgetLeft(4)) break
          const cand = cloneGraph(bestGraph)
          const cn = cand.nodes.find(n => n.id === vecNode.id)!
          cn.params.instances = baseInstances.map(l => l.locked ? { ...l } : ({
            ...l,
            scaleX: Number(Math.max(0.03, Math.min(0.45, l.scaleX * mul)).toFixed(4)),
            scaleY: Number(Math.max(0.03, Math.min(0.45, l.scaleY * mul)).toFixed(4)),
          }))
          const res = evalAndScore(cand, 128, true)
          if (res.score.totalScore > bestScore128.totalScore + 0.05) {
            bestGraph = cand
            bestScore128 = res.score
            lastEval128 = res.ev
            bestMul = mul
          }
        }
        void bestMul
      }
    }

    // 0b. Exact labelMap-guided CIELAB palette snapping (zero blind search!)
    if (opts.enablePaletteSnap !== false && isBudgetLeft(3)) {
      const vnCur = bestGraph.nodes.find(n => n.id === vecNode.id)!
      const insts = (vnCur.params.instances as VectorLeafInstance[] | undefined) ?? []
      const pal = Array.isArray(vnCur.params.palette) ? [...(vnCur.params.palette as string[])] : []
      const lblBuf = lastEval128.nodeOutputs.get(vecNode.id)?.label as LabelBuffer | undefined
      if (lblBuf && lblBuf.kind === 'label' && pal.length > 0 && insts.length > 0) {
        const ref128 = refCache.get(128, mode)
        const buckets: [number[], number[], number[]][] = pal.map(() => [[], [], []])
        const ld = lblBuf.data
        for (let i = 0; i < ld.length; i++) {
          const id = ld[i]
          if (id <= 0 || !ref128.alphaBin[i]) continue
          const inst = insts[id - 1]
          if (!inst) continue
          const ci = ((inst.colorIdx % pal.length) + pal.length) % pal.length
          buckets[ci][0].push(ref128.lab[i * 3])
          buckets[ci][1].push(ref128.lab[i * 3 + 1])
          buckets[ci][2].push(ref128.lab[i * 3 + 2])
        }
        let changed = false
        const nextPal = pal.map((hex, ci) => {
          const [Ls, As, Bs] = buckets[ci]
          if (Ls.length < 10) return hex
          Ls.sort((a, b) => a - b); As.sort((a, b) => a - b); Bs.sort((a, b) => a - b)
          const m = Math.floor(Ls.length * 0.5)
          const [r, g, b] = labToSrgb(Ls[m], As[m], Bs[m])
          const nextHex = rgb01ToHex(r, g, b)
          if (nextHex !== hex) changed = true
          return nextHex
        })
        if (changed) {
          const cand = cloneGraph(bestGraph)
          cand.nodes.find(n => n.id === vecNode.id)!.params.palette = nextPal
          const res = evalAndScore(cand, 128, true)
          if (res.score.totalScore > bestScore128.totalScore + 0.02) {
            bestGraph = cand
            bestScore128 = res.score
            lastEval128 = res.ev
          }
        }
      }
    }

    stages.push({
      name: 'Stage 0 · 实例尺度与色板对齐',
      resolution: 128,
      evals: totalEvals - s0Evals,
      cacheHits: cacheHits - s0Hits,
      cacheMisses: cacheMisses - s0Miss,
      scoreBefore: s0Before,
      scoreAfter: bestScore128.totalScore,
      ms: Number((performance.now() - s0Start).toFixed(1)),
    })
  }

  // Helper: Bounded Coordinate Pattern Search over a stage's whitelisted params
  const runCoordinateStage = (
    name: string,
    stageParams: OptimizableParamSpec[],
    res: number,
    maxStageEvals: number,
    rounds = 2,
  ) => {
    if (stageParams.length === 0 || !isBudgetLeft(3)) return
    const t0 = performance.now()
    const startEvals = totalEvals, startHits = cacheHits, startMiss = cacheMisses
    const curBase = res === 128 ? bestScore128 : evalAndScore(bestGraph, res, true).score
    let stageBestScore = curBase
    const scoreBefore = stageBestScore.totalScore
    let used = 0

    for (let round = 0; round < rounds && used < maxStageEvals && isBudgetLeft(3); round++) {
      const stepScale = round === 0 ? 1.0 : 0.45
      let anyImproved = false
      for (const spec of stageParams) {
        if (used >= maxStageEvals || !isBudgetLeft(3)) break
        const node = bestGraph.nodes.find(n => n.id === spec.nodeId)
        if (!node) continue
        const defParam = nodeDefinitions[node.type]?.params.find(p => p.key === spec.key)
        const curVal = Number(node.params[spec.key] ?? defParam?.default ?? 0)
        if (!Number.isFinite(curVal)) continue
        const delta = spec.step * stepScale
        const isInt = defParam?.kind === 'int'

        const candidates = [curVal + delta, curVal - delta]
          .map(v => Math.max(spec.min, Math.min(spec.max, isInt ? Math.round(v) : Number(v.toFixed(4)))))
          .filter(v => Math.abs(v - curVal) > 1e-5)

        let bestLocalVal = curVal
        let bestLocalScore = stageBestScore
        let bestLocalGraph: TextureGraph | undefined

        for (const candVal of candidates) {
          if (used >= maxStageEvals || !isBudgetLeft(3)) break
          const cand = cloneGraph(bestGraph)
          cand.nodes.find(n => n.id === spec.nodeId)!.params[spec.key] = candVal
          const r = evalAndScore(cand, res, true)
          used++
          if (r.score.totalScore > bestLocalScore.totalScore + 0.04) {
            bestLocalScore = r.score
            bestLocalVal = candVal
            bestLocalGraph = cand
            if (res === 128) lastEval128 = r.ev
          }
        }
        if (bestLocalGraph && bestLocalVal !== curVal) {
          bestGraph = bestLocalGraph
          stageBestScore = bestLocalScore
          if (res === 128) bestScore128 = stageBestScore
          anyImproved = true
        }
      }
      if (!anyImproved) break
    }

    stages.push({
      name,
      resolution: res,
      evals: totalEvals - startEvals,
      cacheHits: cacheHits - startHits,
      cacheMisses: cacheMisses - startMiss,
      scoreBefore,
      scoreAfter: stageBestScore.totalScore,
      ms: Number((performance.now() - t0).toFixed(1)),
    })
  }

  // Stage 1: Structure & Scale @ 128px
  runCoordinateStage(
    'Stage 1 · 结构与尺度',
    whitelist.filter(p => p.stage === 1),
    128,
    Math.round(maxEvals * 0.34),
    2,
  )

  // Stage 1b (Figurative vector_layout): Bounded Outlier Leaf Micro-Refinement (locked leaves untouched!)
  if (mode === 'figurative' && vecNode && isBudgetLeft(10)) {
    const s1bStart = performance.now()
    const s1bEvals = totalEvals, s1bHits = cacheHits, s1bMiss = cacheMisses
    const s1bBefore = bestScore128.totalScore
    const vnCur = bestGraph.nodes.find(n => n.id === vecNode.id)!
    const curInsts = (vnCur.params.instances as VectorLeafInstance[] | undefined) ?? []
    const ref128 = refCache.get(128, mode)
    const genImg128 = rgbaBufferToImageData(lastEval128.output.baseColor)
    const w = 128

    // Rank unlocked leaves by local alpha mismatch error inside their tight bounding box
    const ranked = curInsts
      .map((inst, idx) => {
        if (inst.locked) return { idx, err: 0, dx: 0, dy: 0 }
        const rx = Math.max(3, Math.ceil(inst.scaleX * 0.55 * w))
        const ry = Math.max(3, Math.ceil(inst.scaleY * 0.55 * w))
        const cx = Math.round(inst.x * w), cy = Math.round(inst.y * w)
        let missCnt = 0, extraCnt = 0, tot = 0, dirX = 0, dirY = 0
        for (let py = Math.max(0, cy - ry); py <= Math.min(w - 1, cy + ry); py++) {
          for (let px = Math.max(0, cx - rx); px <= Math.min(w - 1, cx + rx); px++) {
            const p = py * w + px
            const rA = ref128.alphaBin[p]
            const gA = genImg128.data[p * 4 + 3] >= 128 ? 1 : 0
            if (rA !== gA) {
              const sign = rA ? 1 : -1
              dirX += sign * ((px - cx) / Math.max(1, rx))
              dirY += sign * ((py - cy) / Math.max(1, ry))
              if (rA) missCnt++
              else extraCnt++
            }
            tot++
          }
        }
        const err = (missCnt + extraCnt) / Math.max(1, tot)
        const dLen = Math.hypot(dirX, dirY) || 1
        return { idx, err, dx: (dirX / dLen) * 0.015, dy: (dirY / dLen) * 0.015 }
      })
      .filter(r => r.err > 0.16)
      .sort((a, b) => b.err - a.err)
      .slice(0, 6)

    for (const target of ranked) {
      if (!isBudgetLeft(6)) break
      const orig = (bestGraph.nodes.find(n => n.id === vecNode.id)!.params.instances as VectorLeafInstance[])[target.idx]
      if (!orig) continue
      const proposals: Partial<VectorLeafInstance>[] = [
        { x: Number(clamp01(orig.x + target.dx).toFixed(4)), y: Number(clamp01(orig.y + target.dy).toFixed(4)) },
        { scaleX: Number(Math.max(0.03, Math.min(0.45, orig.scaleX * 0.91)).toFixed(4)), scaleY: Number(Math.max(0.03, Math.min(0.45, orig.scaleY * 0.91)).toFixed(4)) },
        { rot: Number((orig.rot + 0.14).toFixed(4)) },
      ]
      for (const delta of proposals) {
        if (!isBudgetLeft(5)) break
        const cand = cloneGraph(bestGraph)
        const list = cand.nodes.find(n => n.id === vecNode.id)!.params.instances as VectorLeafInstance[]
        list[target.idx] = { ...list[target.idx], ...delta }
        const r = evalAndScore(cand, 128, true)
        if (r.score.totalScore > bestScore128.totalScore + 0.03) {
          bestGraph = cand
          bestScore128 = r.score
          lastEval128 = r.ev
          break
        }
      }
    }

    if (totalEvals > s1bEvals) {
      stages.push({
        name: 'Stage 1b · 离群单叶微调',
        resolution: 128,
        evals: totalEvals - s1bEvals,
        cacheHits: cacheHits - s1bHits,
        cacheMisses: cacheMisses - s1bMiss,
        scoreBefore: s1bBefore,
        scoreAfter: bestScore128.totalScore,
        ms: Number((performance.now() - s1bStart).toFixed(1)),
      })
    }
  }

  // Stage 2: Color, Curvature & Lighting @ 128px (High upstream cache hit rate!)
  runCoordinateStage(
    'Stage 2 · 色板曲率与光照',
    whitelist.filter(p => p.stage === 2),
    128,
    Math.round(maxEvals * 0.36),
    2,
  )

  // Stage 3: Detail & Finishing @ 256px
  runCoordinateStage(
    'Stage 3 · 细节与描边精修',
    whitelist.filter(p => p.stage === 3),
    256,
    Math.round(maxEvals * 0.22),
    2,
  )

  // Final Verification @ 256px (and optional 512px ranking check!)
  const wasAborted = Boolean(opts.signal?.aborted)
  const best256 = wasAborted ? init256 : evalAndScore(bestGraph, 256, true)
  const gateRegression = init256.score.hardGatesPassed && !best256.score.hardGatesPassed
  const netImproved = !wasAborted && !gateRegression && best256.score.totalScore > init256.score.totalScore + 0.05

  let finalGraph = netImproved ? bestGraph : initialGraph
  let finalScore256 = netImproved ? best256.score : init256.score
  let finalScore128 = netImproved ? bestScore128 : init128.score
  let finalScore512: ScoreBreakdown | undefined

  if (opts.verify512) {
    finalScore512 = evalAndScore(finalGraph, 512, false).score
  }

  const totalNodeLookups = cacheHits + cacheMisses
  return {
    improved: netImproved,
    rolledBack: !netImproved,
    initialScore128: init128.score,
    bestScore128: finalScore128,
    initialScore256: init256.score,
    bestScore256: finalScore256,
    finalScore512,
    bestGraph: finalGraph,
    telemetry: {
      totalEvals,
      cacheHits,
      cacheMisses,
      cacheHitRate: totalNodeLookups > 0 ? Number((cacheHits / totalNodeLookups).toFixed(4)) : 0,
      evalMsTotal: Number(evalMsTotal.toFixed(1)),
      scoreMsTotal: Number(scoreMsTotal.toFixed(1)),
      wallMsTotal: Number((performance.now() - wallStart).toFixed(1)),
      stages,
    },
  }
}

/** Browser-side Agent API surface mounted onto `window.__studio.textures.agent` & `window.__aiStudio.textures.agent`. */
export interface BrowserTextureAgentApi {
  getSchema(): { schemaVersion: 2; nodeTypes: string[]; portTypes: string[] }
  getGraph(): TextureGraph
  loadGraph(graph: TextureGraph): void
  analyzeReference(ref: RgbaImageData, opts?: { name?: string; resolution?: 256 | 512 | 1024 }): RefAnalysisResult
  scoreAgainstReference(ref: RgbaImageData, mode?: ScoreMode, res?: number): ScoreBreakdown
  optimizeAgainstReference(ref: RgbaImageData, opts?: OptimizeOptions): OptimizeResult
  renderDiagnosticSheet(ref: RgbaImageData, mode?: ScoreMode, panelSize?: number): {
    sheet: RgbaImageData
    score: ScoreBreakdown
  }
  getLastAnalysis(): RefAnalysisResult | undefined
  getLastOptimize(): OptimizeResult | undefined
}

export function createBrowserTextureAgentApi(hooks: {
  getGraph(): TextureGraph
  commitGraph(graph: TextureGraph, label: string): void
}): BrowserTextureAgentApi {
  let lastAnalysis: RefAnalysisResult | undefined
  let lastOptimize: OptimizeResult | undefined
  const evaluator = new TextureGraphEvaluator()

  return {
    getSchema() {
      return {
        schemaVersion: 2,
        nodeTypes: [...allNodeTypes],
        portTypes: ['gray', 'rgba', 'label'],
      }
    },
    getGraph: () => hooks.getGraph(),
    loadGraph: (g: TextureGraph) => hooks.commitGraph(normalizeGraphSchemaVersion(g), 'Agent 载入节点图'),
    analyzeReference(ref, opts) {
      const res = analyzeReferenceImage(ref, opts)
      lastAnalysis = res
      return res
    },
    scoreAgainstReference(ref, mode, res = 256) {
      const g = hooks.getGraph()
      const useMode: ScoreMode = mode ?? (g.targetSlot === 'bark' ? 'bark_tile' : 'figurative')
      const ev = evaluator.evaluate(g, res, { skipPbrMaps: true })
      const gen = rgbaBufferToImageData(ev.output.baseColor)
      return scoreAgainstReference(new RefFeatureCache(ref), gen, useMode, res)
    },
    optimizeAgainstReference(ref, opts) {
      const cur = hooks.getGraph()
      const params = opts?.params ?? (lastAnalysis && lastAnalysis.draftGraph.name === cur.name ? lastAnalysis.recommendedParams : undefined)
      const res = optimizeGraphAgainstReference(cur, ref, { ...opts, params })
      lastOptimize = res
      if (res.improved) {
        hooks.commitGraph(res.bestGraph, `Agent 自动寻优 (${res.initialScore256.totalScore}→${res.bestScore256.totalScore})`)
      }
      return res
    },
    renderDiagnosticSheet(ref, mode, panelSize = 256) {
      const g = hooks.getGraph()
      const useMode: ScoreMode = mode ?? (g.targetSlot === 'bark' ? 'bark_tile' : 'figurative')
      const ev = evaluator.evaluate(g, panelSize, { skipPbrMaps: true })
      const gen = rgbaBufferToImageData(ev.output.baseColor)
      const score = scoreAgainstReference(new RefFeatureCache(ref), gen, useMode, panelSize)
      const sheet = renderDiagnosticSheet(ref, gen, useMode, panelSize)
      return { sheet, score }
    },
    getLastAnalysis: () => lastAnalysis,
    getLastOptimize: () => lastOptimize,
  }
}

export { clamp01 }

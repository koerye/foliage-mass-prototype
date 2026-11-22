import { describe, expect, it } from 'vitest'
import {
  decodePngBytes, decodePngFile, encodePngBytes, resolveWorkspacePath,
} from '../scripts/png-node.mjs'
import { optimizeGraphAgainstReference } from '../src/texgraph/agent-api'
import { evaluateTextureGraph } from '../src/texgraph/engine'
import {
  circularShiftImageData, deltaE00, resizeImageData, rgbaBufferToImageData,
  srgbToLab, type RgbaImageData,
} from '../src/texgraph/image-utils'
import { validateTextureGraph } from '../src/texgraph/nodes'
import { analyzeReferenceImage } from '../src/texgraph/ref-analyze'
import {
  RefFeatureCache, renderDiagnosticSheet, scoreAgainstReference,
} from '../src/texgraph/ref-score'

const REF_VINE = resolveWorkspacePath('交织绿叶藤蔓插画.png')
const REF_CLUSTER = resolveWorkspacePath('多色绿叶簇插画.png')
const REF_BUSH = resolveWorkspacePath('手绘风格繁茂绿叶灌木 PNG素材.png')
const REF_BARK = resolveWorkspacePath('textures/painterly_moss_bark.png')
const REF_OAK2X2 = resolveWorkspacePath('textures/oak_painterly_atlas2x2.png')

describe('TexGraph v2 Phase 2: PNG Codec, RefAnalyzer, Anti-Gaming RefScorer & Bounded Optimizer', () => {
  it('round-trips RGBA PNG bytes bit-exact and computes exact CIEDE2000 color differences', () => {
    const img: RgbaImageData = {
      width: 16,
      height: 12,
      data: new Uint8ClampedArray(16 * 12 * 4),
    }
    for (let i = 0; i < 16 * 12; i++) {
      img.data[i * 4] = (i * 19) & 255
      img.data[i * 4 + 1] = (i * 41) & 255
      img.data[i * 4 + 2] = (i * 73) & 255
      img.data[i * 4 + 3] = i % 3 === 0 ? 0 : 255
    }
    const png = encodePngBytes(img)
    const dec = decodePngBytes(png)
    expect(dec.width).toBe(16)
    expect(dec.height).toBe(12)
    expect(dec.data).toEqual(img.data)

    const [L1, a1, b1] = srgbToLab(0.4, 0.65, 0.25)
    expect(deltaE00(L1, a1, b1, L1, a1, b1)).toBeLessThan(1e-6)
    const [L2, a2, b2] = srgbToLab(0.85, 0.2, 0.2)
    expect(deltaE00(L1, a1, b1, L2, a2, b2)).toBeGreaterThan(40)
  })

  it('auto-classifies all 5 frozen reference benchmarks into valid editable v2 draft graphs with evidence', () => {
    const cases: { path: string; expectedKind: string; expectStems: boolean; expectOutline: boolean }[] = [
      { path: REF_VINE, expectedKind: 'vine', expectStems: true, expectOutline: false },
      { path: REF_CLUSTER, expectedKind: 'cluster_flat', expectStems: false, expectOutline: false },
      { path: REF_BUSH, expectedKind: 'bush_inked', expectStems: true, expectOutline: true },
      { path: REF_BARK, expectedKind: 'bark_tile', expectStems: false, expectOutline: false },
      { path: REF_OAK2X2, expectedKind: 'atlas_2x2', expectStems: false, expectOutline: false },
    ]

    for (const c of cases) {
      const ref = decodePngFile(c.path)
      const res = analyzeReferenceImage(ref, { resolution: 512 })
      expect(res.kind).toBe(c.expectedKind)
      expect(res.confidence).toBeGreaterThan(0.6)
      expect(res.draftGraph.schemaVersion).toBe(2)
      const val = validateTextureGraph(res.draftGraph)
      expect(val.ok).toBe(true)
      expect(val.errors).toEqual([])
      expect(res.evidence.palette.length).toBeGreaterThanOrEqual(3)

      if (c.expectedKind === 'vine' || c.expectedKind === 'cluster_flat' || c.expectedKind === 'bush_inked') {
        const vn = res.draftGraph.nodes.find(n => n.type === 'vector_layout')!
        const outl = res.draftGraph.nodes.find(n => n.type === 'ink_outline')!
        expect(vn).toBeDefined()
        expect(outl).toBeDefined()
        if (c.expectStems) expect(res.evidence.detectedStems).toBeGreaterThanOrEqual(2)
        else expect(res.evidence.detectedStems).toBe(0)
        if (c.expectOutline) {
          expect(Number(outl.params.outerWidth)).toBeGreaterThan(1.5)
          expect(Number(outl.params.innerWidth)).toBeGreaterThan(0.8)
        } else {
          expect(Number(outl.params.outerWidth)).toBe(0)
          expect(Number(outl.params.innerWidth)).toBe(0)
        }
        expect(res.evidence.detectedLeaves).toBeGreaterThanOrEqual(25)
      } else if (c.expectedKind === 'atlas_2x2') {
        const sc = res.draftGraph.nodes.find(n => n.type === 'branch_scatter')!
        expect(sc.params.atlasCols).toBe(2)
        expect(sc.params.atlasRows).toBe(2)
      } else if (c.expectedKind === 'bark_tile') {
        expect(res.scoreMode).toBe('bark_tile')
        expect(res.evidence.mossRatio).toBeGreaterThan(0.18)
      }
    }
  })

  it('enforces bark translation invariance and rejects metric-hacking counterexamples (noise, mush, seam cut, solid fill)', () => {
    const barkRef = resizeImageData(decodePngFile(REF_BARK), 128, 128)
    const barkCache = new RefFeatureCache(barkRef)

    // 1. True circular shift must preserve high score & pass all hard gates!
    const shifted = circularShiftImageData(barkRef, 47, 83)
    const shiftedScore = scoreAgainstReference(barkCache, shifted, 'bark_tile', 128)
    expect(shiftedScore.totalScore).toBeGreaterThan(96)
    expect(shiftedScore.hardGatesPassed).toBe(true)
    expect(shiftedScore.seamPassed).toBe(true)
    expect(shiftedScore.dominantAngleErrDeg!).toBeLessThan(1.5)

    // 2. Counterexample A: Histogram-matched shuffled white noise (identical RGB/moss distribution!)
    const shuffledData = new Uint8ClampedArray(barkRef.data.length)
    const n = 128 * 128
    for (let i = 0; i < n; i++) {
      // Deterministic permutation destroys spatial correlation, orientation & crevice geometry
      const srcIdx = (i * 7919 + 104729) % n
      shuffledData[i * 4] = barkRef.data[srcIdx * 4]
      shuffledData[i * 4 + 1] = barkRef.data[srcIdx * 4 + 1]
      shuffledData[i * 4 + 2] = barkRef.data[srcIdx * 4 + 2]
      shuffledData[i * 4 + 3] = 255
    }
    const noiseScore = scoreAgainstReference(barkCache, { width: 128, height: 128, data: shuffledData }, 'bark_tile', 128)
    expect(noiseScore.hardGatesPassed).toBe(false)
    expect(noiseScore.totalScore).toBeLessThan(50)

    // 3. Counterexample B: Constant flat blurred mush
    const flatData = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) {
      flatData[i * 4] = 152; flatData[i * 4 + 1] = 136; flatData[i * 4 + 2] = 104; flatData[i * 4 + 3] = 255
    }
    const flatScore = scoreAgainstReference(barkCache, { width: 128, height: 128, data: flatData }, 'bark_tile', 128)
    expect(flatScore.hardGatesPassed).toBe(false)
    expect(flatScore.totalScore).toBeLessThan(55)

    // 4. Counterexample C: Hard non-seamless discontinuity on X boundary (left dark strip vs right bright strip)
    const seamBrokenData = new Uint8ClampedArray(barkRef.data)
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const o = (y * 128 + x) * 4
        const ramp = x / 127
        seamBrokenData[o] = Math.round(seamBrokenData[o] * (0.35 + 0.65 * ramp))
        seamBrokenData[o + 1] = Math.round(seamBrokenData[o + 1] * (0.35 + 0.65 * ramp))
        seamBrokenData[o + 2] = Math.round(seamBrokenData[o + 2] * (0.35 + 0.65 * ramp))
      }
    }
    const seamBroken = scoreAgainstReference(barkCache, { width: 128, height: 128, data: seamBrokenData }, 'bark_tile', 128)
    expect(seamBroken.seamPassed).toBe(false)
    expect(seamBroken.seamRatioX!).toBeGreaterThan(1.5)

    // 5. Counterexample D: Solid green square gaming attempt against figurative cluster
    const clusterRef = resizeImageData(decodePngFile(REF_CLUSTER), 128, 128)
    const clusterCache = new RefFeatureCache(clusterRef)
    const greenFill = new Uint8ClampedArray(n * 4)
    for (let i = 0; i < n; i++) {
      greenFill[i * 4] = 95; greenFill[i * 4 + 1] = 158; greenFill[i * 4 + 2] = 68; greenFill[i * 4 + 3] = 255
    }
    const solidScore = scoreAgainstReference(clusterCache, { width: 128, height: 128, data: greenFill }, 'figurative', 128)
    expect(solidScore.hardGatesPassed).toBe(false)
    expect(solidScore.totalScore).toBeLessThan(55)
  })

  it('runs cache-aware bounded optimization across all 5 benchmarks, produces 4-panel sheets, and supports clean abort rollback', () => {
    // 1. Intertwined Vine
    const vineRef = decodePngFile(REF_VINE)
    const vineAn = analyzeReferenceImage(vineRef, { resolution: 512 })
    const vineOpt = optimizeGraphAgainstReference(vineAn.draftGraph, vineRef, {
      mode: 'figurative', maxEvals: 45, params: vineAn.recommendedParams,
    })
    expect(vineOpt.telemetry.totalEvals).toBeLessThanOrEqual(45)
    expect(vineOpt.telemetry.evalMsTotal).toBeGreaterThan(0)
    expect(vineOpt.telemetry.scoreMsTotal).toBeGreaterThan(0)
    expect(vineOpt.bestScore256.hardGatesPassed).toBe(true)
    expect(vineOpt.bestScore256.totalScore).toBeGreaterThanOrEqual(84)
    expect(vineOpt.bestScore256.contourF1!).toBeGreaterThanOrEqual(0.85)
    expect(vineOpt.bestScore256.labDeltaE00Median!).toBeLessThan(3.5)

    // 2. Multi-Color Flat Cluster
    const cluRef = decodePngFile(REF_CLUSTER)
    const cluAn = analyzeReferenceImage(cluRef, { resolution: 512 })
    const cluOpt = optimizeGraphAgainstReference(cluAn.draftGraph, cluRef, {
      mode: 'figurative', maxEvals: 45, params: cluAn.recommendedParams,
    })
    expect(cluOpt.bestScore256.hardGatesPassed).toBe(true)
    expect(cluOpt.bestScore256.alphaIoU!).toBeGreaterThanOrEqual(0.85)
    expect(cluOpt.bestScore256.contourF1!).toBeGreaterThanOrEqual(0.80)
    expect(cluOpt.bestScore256.labDeltaE00Median!).toBeLessThan(3.5)

    // 3. Lush Hand-Drawn Inked Bush
    const bushRef = decodePngFile(REF_BUSH)
    const bushAn = analyzeReferenceImage(bushRef, { resolution: 512 })
    const bushOpt = optimizeGraphAgainstReference(bushAn.draftGraph, bushRef, {
      mode: 'figurative', maxEvals: 50, params: bushAn.recommendedParams,
    })
    expect(bushOpt.bestScore256.hardGatesPassed).toBe(true)
    expect(bushOpt.bestScore256.alphaIoU!).toBeGreaterThanOrEqual(0.84)
    expect(bushOpt.bestScore256.paletteDeltaE00!).toBeLessThan(5.0)

    // 4. Painterly Moss Bark (verify upstream cache hits + seam pass + moss match)
    const barkRef = decodePngFile(REF_BARK)
    const barkAn = analyzeReferenceImage(barkRef, { resolution: 512 })
    const barkOpt = optimizeGraphAgainstReference(barkAn.draftGraph, barkRef, {
      mode: 'bark_tile', maxEvals: 45, params: barkAn.recommendedParams,
    })
    expect(barkOpt.bestScore256.hardGatesPassed).toBe(true)
    expect(barkOpt.bestScore256.seamPassed).toBe(true)
    expect(barkOpt.bestScore256.totalScore).toBeGreaterThanOrEqual(75)
    expect(barkOpt.bestScore256.mossCoverageErr!).toBeLessThan(0.09)
    expect(barkOpt.telemetry.cacheHits).toBeGreaterThan(10)

    // 5. 2x2 Oak Atlas 2D comparison
    const oakRef = decodePngFile(REF_OAK2X2)
    const oakAn = analyzeReferenceImage(oakRef, { resolution: 512 })
    const oakOpt = optimizeGraphAgainstReference(oakAn.draftGraph, oakRef, {
      mode: 'figurative', maxEvals: 35, params: oakAn.recommendedParams,
    })
    expect(oakOpt.bestScore256.hardGatesPassed).toBe(true)
    expect(oakOpt.bestScore256.alphaIoU!).toBeGreaterThanOrEqual(0.78)

    // 6. AbortSignal clean rollback returns original graph untouched
    const ac = new AbortController()
    ac.abort()
    const aborted = optimizeGraphAgainstReference(vineAn.draftGraph, vineRef, {
      mode: 'figurative', maxEvals: 40, signal: ac.signal,
    })
    expect(aborted.rolledBack).toBe(true)
    expect(aborted.bestGraph).toEqual(vineAn.draftGraph)

    // 7. 4-panel diagnostic sheets render crisp 512x512 RGBA output
    const vineGen = rgbaBufferToImageData(evaluateTextureGraph(vineOpt.bestGraph, 256).output.baseColor)
    const vineSheet = renderDiagnosticSheet(vineRef, vineGen, 'figurative', 256)
    expect(vineSheet.width).toBe(512)
    expect(vineSheet.height).toBe(512)
    const barkGen = rgbaBufferToImageData(evaluateTextureGraph(barkOpt.bestGraph, 256).output.baseColor)
    const barkSheet = renderDiagnosticSheet(barkRef, barkGen, 'bark_tile', 256)
    expect(barkSheet.width).toBe(512)
    expect(barkSheet.height).toBe(512)
  }, 25000)
})

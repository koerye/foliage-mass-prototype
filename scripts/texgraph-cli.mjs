#!/usr/bin/env node
/**
 * Headless Node CLI for Texture Node Editor v2 & Agent-Native Reference Replication.
 * Uses Vite SSR module loader to execute the exact same pure-TypeScript CPU evaluator,
 * RefAnalyzer, RefScorer, and Optimizer as the browser & Vitest suite.
 *
 * Commands:
 *   node scripts/texgraph-cli.mjs analyze  <ref.png> --out <dir> [--res 512]
 *   node scripts/texgraph-cli.mjs score    <ref.png> <graph.json> [--res 256] [--mode figurative|bark_tile] [--sheet out.png]
 *   node scripts/texgraph-cli.mjs render   <graph.json> --out <dir> [--res 512] [--pbr]
 *   node scripts/texgraph-cli.mjs optimize <ref.png> [--graph in.json] --out <dir> [--max-evals 85] [--res 512] [--verify-512] [--pbr]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { decodePngFile, encodePngFile } from './png-node.mjs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')

function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) flags[k] = true
      else { flags[k] = next; i++ }
    } else {
      pos.push(a)
    }
  }
  return { cmd: pos[0], args: pos.slice(1), flags }
}

function grayToImageData(buf) {
  const n = buf.width * buf.height
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const v = Math.max(0, Math.min(255, Math.round(buf.data[i] * 255)))
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255
  }
  return { width: buf.width, height: buf.height, data }
}

async function main() {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2))
  if (!cmd || flags.help) {
    console.log([
      'Usage:',
      '  node scripts/texgraph-cli.mjs analyze  <ref.png> --out <dir> [--res 512]',
      '  node scripts/texgraph-cli.mjs score    <ref.png> <graph.json> [--res 256] [--mode figurative|bark_tile] [--sheet out.png]',
      '  node scripts/texgraph-cli.mjs render   <graph.json> --out <dir> [--res 512] [--pbr]',
      '  node scripts/texgraph-cli.mjs optimize <ref.png> [--graph in.json] --out <dir> [--max-evals 85] [--res 512] [--verify-512] [--pbr]',
    ].join('\n'))
    process.exit(0)
  }

  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const pngMod = { decodePngFile, encodePngFile }
    const imgMod = await vite.ssrLoadModule('/src/texgraph/image-utils.ts')
    const nodesMod = await vite.ssrLoadModule('/src/texgraph/nodes.ts')
    const engineMod = await vite.ssrLoadModule('/src/texgraph/engine.ts')
    const analyzeMod = await vite.ssrLoadModule('/src/texgraph/ref-analyze.ts')
    const scoreMod = await vite.ssrLoadModule('/src/texgraph/ref-score.ts')
    const agentMod = await vite.ssrLoadModule('/src/texgraph/agent-api.ts')

    if (cmd === 'analyze') {
      const refPath = resolve(args[0])
      const outDir = resolve(flags.out || './out-texgraph')
      const res = Number(flags.res || 512)
      mkdirSync(outDir, { recursive: true })
      const refImg = pngMod.decodePngFile(refPath)
      const analysis = analyzeMod.analyzeReferenceImage(refImg, {
        name: basename(refPath, '.png'),
        resolution: res,
      })
      const ev = engineMod.evaluateTextureGraph(analysis.draftGraph, Math.min(512, res))
      const genImg = imgMod.rgbaBufferToImageData(ev.output.baseColor)
      const score = scoreMod.scoreAgainstReference(new scoreMod.RefFeatureCache(refImg), genImg, analysis.scoreMode, 256)
      const sheet = scoreMod.renderDiagnosticSheet(refImg, genImg, analysis.scoreMode, 256)

      writeFileSync(join(outDir, 'draft.graph.json'), JSON.stringify(analysis.draftGraph, null, 2))
      pngMod.encodePngFile(join(outDir, 'draft.png'), genImg)
      pngMod.encodePngFile(join(outDir, 'diagnostic_draft.png'), sheet)
      const summary = {
        refPath,
        analyzerVersion: analysis.analyzerVersion,
        kind: analysis.kind,
        scoreMode: analysis.scoreMode,
        confidence: analysis.confidence,
        evidence: analysis.evidence,
        draftScore256: score,
      }
      writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(summary, null, 2))
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    if (cmd === 'score') {
      const refPath = resolve(args[0])
      const graphPath = resolve(args[1])
      const res = Number(flags.res || 256)
      const refImg = pngMod.decodePngFile(refPath)
      const graph = nodesMod.parseTextureGraph(JSON.parse(readFileSync(graphPath, 'utf-8')), { strict: true })
      const mode = flags.mode || (graph.targetSlot === 'bark' ? 'bark_tile' : 'figurative')
      const ev = engineMod.evaluateTextureGraph(graph, res)
      const genImg = imgMod.rgbaBufferToImageData(ev.output.baseColor)
      const score = scoreMod.scoreAgainstReference(new scoreMod.RefFeatureCache(refImg), genImg, mode, res)
      if (flags.sheet) {
        const sheet = scoreMod.renderDiagnosticSheet(refImg, genImg, mode, Math.min(512, res))
        pngMod.encodePngFile(resolve(flags.sheet), sheet)
      }
      console.log(JSON.stringify({ refPath, graphPath, evalMs: ev.evalMs, score }, null, 2))
      return
    }

    if (cmd === 'render') {
      const graphPath = resolve(args[0])
      const outDir = resolve(flags.out || './out-render')
      const res = Number(flags.res || 512)
      mkdirSync(outDir, { recursive: true })
      const graph = nodesMod.parseTextureGraph(JSON.parse(readFileSync(graphPath, 'utf-8')), { strict: true })
      const ev = engineMod.evaluateTextureGraph(graph, res)
      pngMod.encodePngFile(join(outDir, 'baseColor.png'), imgMod.rgbaBufferToImageData(ev.output.baseColor))
      const files = ['baseColor.png']
      if (flags.pbr) {
        pngMod.encodePngFile(join(outDir, 'normal.png'), imgMod.rgbaBufferToImageData(ev.output.normal))
        pngMod.encodePngFile(join(outDir, 'height.png'), grayToImageData(ev.output.height))
        pngMod.encodePngFile(join(outDir, 'roughness.png'), grayToImageData(ev.output.roughness))
        files.push('normal.png', 'height.png', 'roughness.png')
      }
      console.log(JSON.stringify({ graphPath, outDir, res, evalMs: ev.evalMs, files }, null, 2))
      return
    }

    if (cmd === 'optimize') {
      const refPath = resolve(args[0])
      const outDir = resolve(flags.out || './out-optimize')
      const res = Number(flags.res || 512)
      const maxEvals = Number(flags['max-evals'] || 85)
      mkdirSync(outDir, { recursive: true })
      const refImg = pngMod.decodePngFile(refPath)

      let analysis = null
      let initGraph
      let mode
      let whitelist
      if (flags.graph) {
        initGraph = nodesMod.parseTextureGraph(JSON.parse(readFileSync(resolve(flags.graph), 'utf-8')), { strict: true })
        mode = flags.mode || (initGraph.targetSlot === 'bark' ? 'bark_tile' : 'figurative')
      } else {
        analysis = analyzeMod.analyzeReferenceImage(refImg, { name: basename(refPath, '.png'), resolution: res })
        initGraph = analysis.draftGraph
        mode = flags.mode || analysis.scoreMode
        whitelist = analysis.recommendedParams
      }

      const evDraft = engineMod.evaluateTextureGraph(initGraph, 256)
      const draftImg = imgMod.rgbaBufferToImageData(evDraft.output.baseColor)
      pngMod.encodePngFile(join(outDir, 'diagnostic_draft.png'), scoreMod.renderDiagnosticSheet(refImg, draftImg, mode, 256))
      writeFileSync(join(outDir, 'draft.graph.json'), JSON.stringify(initGraph, null, 2))

      const opt = agentMod.optimizeGraphAgainstReference(initGraph, refImg, {
        mode,
        maxEvals,
        params: whitelist,
        verify512: Boolean(flags['verify-512']),
      })

      const evFinal = engineMod.evaluateTextureGraph(opt.bestGraph, res)
      const finalImg = imgMod.rgbaBufferToImageData(evFinal.output.baseColor)
      writeFileSync(join(outDir, 'optimized.graph.json'), JSON.stringify(opt.bestGraph, null, 2))
      pngMod.encodePngFile(join(outDir, 'optimized.png'), finalImg)
      pngMod.encodePngFile(join(outDir, 'diagnostic_optimized.png'), scoreMod.renderDiagnosticSheet(refImg, finalImg, mode, 256))

      if (flags.pbr) {
        pngMod.encodePngFile(join(outDir, 'normal.png'), imgMod.rgbaBufferToImageData(evFinal.output.normal))
        pngMod.encodePngFile(join(outDir, 'height.png'), grayToImageData(evFinal.output.height))
        pngMod.encodePngFile(join(outDir, 'roughness.png'), grayToImageData(evFinal.output.roughness))
      }

      const report = {
        refPath,
        mode,
        analyzerVersion: analysis?.analyzerVersion ?? 'external-graph',
        kind: analysis?.kind ?? 'custom',
        confidence: analysis?.confidence ?? 1,
        evidence: analysis?.evidence ?? null,
        improved: opt.improved,
        rolledBack: opt.rolledBack,
        initialScore128: opt.initialScore128,
        bestScore128: opt.bestScore128,
        initialScore256: opt.initialScore256,
        bestScore256: opt.bestScore256,
        finalScore512: opt.finalScore512 ?? null,
        telemetry: opt.telemetry,
      }
      writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report, null, 2))
      return
    }

    throw new Error(`Unknown command: ${cmd}`)
  } finally {
    await vite.close()
  }
}

main().catch(err => {
  console.error('[texgraph-cli] ERROR:', err instanceof Error ? err.stack || err.message : err)
  process.exit(1)
})

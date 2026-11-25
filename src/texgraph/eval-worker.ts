// Dedicated Web Worker for non-blocking procedural texture graph evaluation & reference optimization.
// Shares the exact same pure-TS TextureGraphEvaluator core as Node CLI & Vitest!
import { optimizeGraphAgainstReference, type OptimizeOptions, type OptimizeResult } from './agent-api'
import { bufferToRgbaBytes, TextureGraphEvaluator } from './engine'
import type { RgbaImageData } from './image-utils'
import { analyzeReferenceImage, type RefAnalysisResult } from './ref-analyze'
import type { ImageBuffer, MaterialOutputResult, TextureGraph } from './types'

export interface WorkerEvalRequest {
  type: 'eval'
  reqId: number
  graph: TextureGraph
  resolution: number
  skipPbrMaps?: boolean
  pinnedNodeId?: string
}

export interface WorkerClearRequest {
  type: 'clear'
}

export interface WorkerAnalyzeRefRequest {
  type: 'analyze_ref'
  reqId: number
  ref: RgbaImageData
  opts?: { name?: string; resolution?: 256 | 512 | 1024 }
}

export interface WorkerOptimizeRefRequest {
  type: 'optimize_ref'
  reqId: number
  graph: TextureGraph
  ref: RgbaImageData
  opts?: Omit<OptimizeOptions, 'signal'>
}

export type WorkerIncomingMessage =
  | WorkerEvalRequest
  | WorkerClearRequest
  | WorkerAnalyzeRefRequest
  | WorkerOptimizeRefRequest

export interface SerializedThumb {
  nodeId: string
  width: number
  height: number
  bytes: Uint8ClampedArray
}

export interface WorkerEvalResponse {
  type: 'result'
  reqId: number
  width: number
  height: number
  evalMs: number
  cacheHits: number
  cacheMisses: number
  nodeTimings: Record<string, number>
  output: MaterialOutputResult
  pinnedBuffer?: ImageBuffer
  thumbs: SerializedThumb[]
}

export interface WorkerAnalyzeRefResponse {
  type: 'analyze_result'
  reqId: number
  result: RefAnalysisResult
}

export interface WorkerOptimizeRefResponse {
  type: 'optimize_result'
  reqId: number
  result: OptimizeResult
}

export interface WorkerErrorResponse {
  type: 'error'
  reqId: number
  error: string
}

export type WorkerOutgoingMessage =
  | WorkerEvalResponse
  | WorkerAnalyzeRefResponse
  | WorkerOptimizeRefResponse
  | WorkerErrorResponse

const evaluator = new TextureGraphEvaluator()
const THUMB_SIZE = 72

function downsampleThumb(buf: ImageBuffer): Uint8ClampedArray {
  const srcBytes = bufferToRgbaBytes(buf)
  const sw = buf.width, sh = buf.height
  const dst = new Uint8ClampedArray(THUMB_SIZE * THUMB_SIZE * 4)
  for (let y = 0; y < THUMB_SIZE; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) / THUMB_SIZE) * sh))
    for (let x = 0; x < THUMB_SIZE; x++) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) / THUMB_SIZE) * sw))
      const si = (sy * sw + sx) * 4
      const di = (y * THUMB_SIZE + x) * 4
      dst[di] = srcBytes[si]
      dst[di + 1] = srcBytes[si + 1]
      dst[di + 2] = srcBytes[si + 2]
      dst[di + 3] = srcBytes[si + 3]
    }
  }
  return dst
}

function cloneBufferForTransfer(buf: ImageBuffer): { copy: ImageBuffer; ab: ArrayBuffer } {
  if (buf.kind === 'label') {
    const data = new Int32Array(buf.data)
    return { copy: { kind: 'label', width: buf.width, height: buf.height, data }, ab: data.buffer }
  }
  const data = new Float32Array(buf.data)
  return {
    copy: buf.kind === 'gray'
      ? { kind: 'gray', width: buf.width, height: buf.height, data }
      : { kind: 'rgba', width: buf.width, height: buf.height, data },
    ab: data.buffer,
  }
}

const ctx = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerIncomingMessage>) => void) | null
  postMessage(msg: WorkerOutgoingMessage, transfer?: Transferable[]): void
}

ctx.onmessage = (ev: MessageEvent<WorkerIncomingMessage>) => {
  const msg = ev.data
  try {
    if (msg.type === 'clear') {
      evaluator.clear()
      return
    }
    if (msg.type === 'analyze_ref') {
      const result = analyzeReferenceImage(msg.ref, msg.opts)
      ctx.postMessage({ type: 'analyze_result', reqId: msg.reqId, result })
      return
    }
    if (msg.type === 'optimize_ref') {
      const result = optimizeGraphAgainstReference(msg.graph, msg.ref, msg.opts)
      ctx.postMessage({ type: 'optimize_result', reqId: msg.reqId, result })
      return
    }
    const res = evaluator.evaluate(msg.graph, msg.resolution, { skipPbrMaps: msg.skipPbrMaps })
    const transfers: Transferable[] = []

    // Clone output typed arrays so evaluator's internal LRU cache stays intact across zero-copy transfer!
    const baseCopy = cloneBufferForTransfer(res.output.baseColor)
    const heightCopy = cloneBufferForTransfer(res.output.heightMap)
    const roughCopy = cloneBufferForTransfer(res.output.roughness)
    const normCopy = cloneBufferForTransfer(res.output.normal)
    transfers.push(baseCopy.ab, heightCopy.ab, roughCopy.ab, normCopy.ab)

    let pinnedBuffer: ImageBuffer | undefined
    if (msg.pinnedNodeId) {
      const outs = res.nodeOutputs.get(msg.pinnedNodeId)
      const primary = outs ? Object.values(outs)[0] : undefined
      if (primary) {
        const pCopy = cloneBufferForTransfer(primary)
        pinnedBuffer = pCopy.copy
        transfers.push(pCopy.ab)
      }
    }

    const thumbs: SerializedThumb[] = []
    for (const n of msg.graph.nodes) {
      const outs = res.nodeOutputs.get(n.id)
      const primary = n.type === 'output_material'
        ? res.output.baseColor
        : (outs ? Object.values(outs)[0] : undefined)
      if (primary) {
        const bytes = downsampleThumb(primary)
        thumbs.push({ nodeId: n.id, width: THUMB_SIZE, height: THUMB_SIZE, bytes })
        transfers.push(bytes.buffer)
      }
    }

    ctx.postMessage({
      type: 'result',
      reqId: msg.reqId,
      width: res.width,
      height: res.height,
      evalMs: res.evalMs,
      cacheHits: res.cacheHits ?? 0,
      cacheMisses: res.cacheMisses ?? 0,
      nodeTimings: res.nodeTimings ?? {},
      output: {
        width: res.output.width,
        height: res.output.height,
        baseColor: baseCopy.copy as MaterialOutputResult['baseColor'],
        heightMap: heightCopy.copy as MaterialOutputResult['heightMap'],
        roughness: roughCopy.copy as MaterialOutputResult['roughness'],
        normal: normCopy.copy as MaterialOutputResult['normal'],
        alphaDilated: res.output.alphaDilated,
      },
      pinnedBuffer,
      thumbs,
    }, transfers)
  } catch (err) {
    const reqId = 'reqId' in msg ? msg.reqId : 0
    ctx.postMessage({
      type: 'error',
      reqId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

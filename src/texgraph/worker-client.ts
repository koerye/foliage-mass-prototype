// Latest-wins async Web Worker client for TextureGraphEvaluator.
// Guarantees 60fps main-thread responsiveness during dragging while dropping stale intermediate frames.
import { optimizeGraphAgainstReference, type OptimizeOptions, type OptimizeResult } from './agent-api'
import { bufferToRgbaBytes, TextureGraphEvaluator } from './engine'
import type { SerializedThumb, WorkerEvalRequest, WorkerOutgoingMessage } from './eval-worker'
import type { RgbaImageData } from './image-utils'
import { analyzeReferenceImage, type RefAnalysisResult } from './ref-analyze'
import type { ImageBuffer, MaterialOutputResult, TextureGraph } from './types'

export interface WorkerEvalOutcome {
  reqId: number
  width: number
  height: number
  evalMs: number
  roundTripMs: number
  cacheHits: number
  cacheMisses: number
  nodeTimings: Record<string, number>
  output: MaterialOutputResult
  pinnedBuffer?: ImageBuffer
  thumbs: SerializedThumb[]
  usedWorker: boolean
}

export class TextureEvalWorkerClient {
  private worker: Worker | undefined
  private fallback = new TextureGraphEvaluator()
  private seq = 0
  private inFlight: { reqId: number; startedAt: number; resolve: (r: WorkerEvalOutcome | null) => void } | undefined
  private queued: {
    req: WorkerEvalRequest
    startedAt: number
    resolve: (r: WorkerEvalOutcome | null) => void
  } | undefined

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./eval-worker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
          const msg = ev.data
          if (msg.type === 'error') {
            const cur = this.inFlight
            this.inFlight = undefined
            if (cur) cur.resolve(null)
            this.flush()
            return
          }
          if (msg.type !== 'result') return
          const cur = this.inFlight
          this.inFlight = undefined
          if (cur) {
            // Discard stale reply if a newer request is already queued!
            if (this.queued) {
              cur.resolve(null)
            } else {
              cur.resolve({
                reqId: msg.reqId,
                width: msg.width,
                height: msg.height,
                evalMs: msg.evalMs,
                roundTripMs: performance.now() - cur.startedAt,
                cacheHits: msg.cacheHits,
                cacheMisses: msg.cacheMisses,
                nodeTimings: msg.nodeTimings,
                output: msg.output,
                pinnedBuffer: msg.pinnedBuffer,
                thumbs: msg.thumbs,
                usedWorker: true,
              })
            }
          }
          this.flush()
        }
        this.worker.onerror = () => {
          // Graceful fallback to main thread if Worker fails — never leave queued promises hanging!
          this.worker?.terminate()
          this.worker = undefined
          const cur = this.inFlight
          this.inFlight = undefined
          if (cur) cur.resolve(null)
          const q = this.queued
          this.queued = undefined
          if (q) {
            q.resolve(this.evalSyncFallback(q.req.graph, q.req.resolution, {
              skipPbrMaps: q.req.skipPbrMaps,
              pinnedNodeId: q.req.pinnedNodeId,
            }, q.req.reqId, q.startedAt))
          }
        }
      } catch {
        this.worker = undefined
      }
    }
  }

  get hasWorker(): boolean {
    return Boolean(this.worker)
  }

  clear() {
    this.fallback.clear()
    this.worker?.postMessage({ type: 'clear' })
  }

  private evalSyncFallback(
    graph: TextureGraph,
    resolution: number,
    options: { skipPbrMaps?: boolean; pinnedNodeId?: string },
    reqId: number,
    startedAt: number,
  ): WorkerEvalOutcome {
    const res = this.fallback.evaluate(graph, resolution, { skipPbrMaps: options.skipPbrMaps })
    const thumbs: SerializedThumb[] = []
    const ts = 72
    for (const n of graph.nodes) {
      const outs = res.nodeOutputs.get(n.id)
      const primary = n.type === 'output_material' ? res.output.baseColor : (outs ? Object.values(outs)[0] : undefined)
      if (!primary) continue
      const src = bufferToRgbaBytes(primary)
      const bytes = new Uint8ClampedArray(ts * ts * 4)
      for (let y = 0; y < ts; y++) {
        const sy = Math.min(primary.height - 1, Math.floor(((y + 0.5) / ts) * primary.height))
        for (let x = 0; x < ts; x++) {
          const sx = Math.min(primary.width - 1, Math.floor(((x + 0.5) / ts) * primary.width))
          const si = (sy * primary.width + sx) * 4
          const di = (y * ts + x) * 4
          bytes[di] = src[si]; bytes[di + 1] = src[si + 1]; bytes[di + 2] = src[si + 2]; bytes[di + 3] = src[si + 3]
        }
      }
      thumbs.push({ nodeId: n.id, width: ts, height: ts, bytes })
    }
    const pOuts = options.pinnedNodeId ? res.nodeOutputs.get(options.pinnedNodeId) : undefined
    return {
      reqId,
      width: res.width,
      height: res.height,
      evalMs: res.evalMs,
      roundTripMs: performance.now() - startedAt,
      cacheHits: res.cacheHits ?? 0,
      cacheMisses: res.cacheMisses ?? 0,
      nodeTimings: res.nodeTimings ?? {},
      output: res.output,
      pinnedBuffer: pOuts ? Object.values(pOuts)[0] : undefined,
      thumbs,
      usedWorker: false,
    }
  }

  /** Evaluates asynchronously in the Worker using latest-wins coalescing.
   *  Resolves to `null` if superseded by a newer request before finishing. */
  evaluate(
    graph: TextureGraph,
    resolution: number,
    options: { skipPbrMaps?: boolean; pinnedNodeId?: string } = {},
  ): Promise<WorkerEvalOutcome | null> {
    const reqId = ++this.seq
    const startedAt = performance.now()

    if (!this.worker) {
      return Promise.resolve(this.evalSyncFallback(graph, resolution, options, reqId, startedAt))
    }

    return new Promise<WorkerEvalOutcome | null>(resolve => {
      if (this.queued) {
        this.queued.resolve(null) // Supersede older queued request immediately!
      }
      this.queued = {
        req: {
          type: 'eval',
          reqId,
          graph,
          resolution,
          skipPbrMaps: options.skipPbrMaps,
          pinnedNodeId: options.pinnedNodeId,
        },
        startedAt,
        resolve,
      }
      this.flush()
    })
  }

  /** Non-blocking reference analysis executed inside a dedicated Worker (never freezes UI main thread!). */
  analyzeReferenceAsync(
    ref: RgbaImageData,
    opts?: { name?: string; resolution?: 256 | 512 | 1024 },
  ): Promise<RefAnalysisResult> {
    if (typeof Worker === 'undefined') {
      return Promise.resolve(analyzeReferenceImage(ref, opts))
    }
    return new Promise<RefAnalysisResult>((resolve, reject) => {
      let w: Worker
      try {
        w = new Worker(new URL('./eval-worker.ts', import.meta.url), { type: 'module' })
      } catch {
        resolve(analyzeReferenceImage(ref, opts))
        return
      }
      const reqId = ++this.seq
      w.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
        const msg = ev.data
        w.terminate()
        if (msg.type === 'analyze_result') resolve(msg.result)
        else if (msg.type === 'error') reject(new Error(msg.error))
        else reject(new Error('Unexpected worker reply'))
      }
      w.onerror = () => {
        w.terminate()
        try { resolve(analyzeReferenceImage(ref, opts)) } catch (err) { reject(err) }
      }
      w.postMessage({ type: 'analyze_ref', reqId, ref, opts })
    })
  }

  /** Non-blocking, instantaneously cancellable reference optimization in an isolated Web Worker. */
  optimizeReferenceAsync(
    graph: TextureGraph,
    ref: RgbaImageData,
    opts: OptimizeOptions = {},
  ): Promise<OptimizeResult> {
    const { signal, ...serializableOpts } = opts
    if (typeof Worker === 'undefined') {
      return Promise.resolve(optimizeGraphAgainstReference(graph, ref, opts))
    }
    return new Promise<OptimizeResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('已取消寻优', 'AbortError'))
        return
      }
      let w: Worker
      try {
        w = new Worker(new URL('./eval-worker.ts', import.meta.url), { type: 'module' })
      } catch {
        resolve(optimizeGraphAgainstReference(graph, ref, opts))
        return
      }
      const onAbort = () => {
        w.terminate()
        reject(new DOMException('已取消寻优', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
        w.terminate()
      }
      const reqId = ++this.seq
      w.onmessage = (ev: MessageEvent<WorkerOutgoingMessage>) => {
        const msg = ev.data
        cleanup()
        if (msg.type === 'optimize_result') resolve(msg.result)
        else if (msg.type === 'error') reject(new Error(msg.error))
        else reject(new Error('Unexpected worker reply'))
      }
      w.onerror = () => {
        cleanup()
        if (signal?.aborted) reject(new DOMException('已取消寻优', 'AbortError'))
        else {
          try { resolve(optimizeGraphAgainstReference(graph, ref, opts)) } catch (err) { reject(err) }
        }
      }
      w.postMessage({ type: 'optimize_ref', reqId, graph, ref, opts: serializableOpts })
    })
  }

  private flush() {
    if (!this.worker || this.inFlight || !this.queued) return
    const next = this.queued
    this.queued = undefined
    this.inFlight = { reqId: next.req.reqId, startedAt: next.startedAt, resolve: next.resolve }
    this.worker.postMessage(next.req)
  }

  dispose() {
    this.worker?.terminate()
    this.worker = undefined
    if (this.inFlight) { this.inFlight.resolve(null); this.inFlight = undefined }
    if (this.queued) { this.queued.resolve(null); this.queued = undefined }
    this.fallback.clear()
  }
}

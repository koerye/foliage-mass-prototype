import {
  buildCreasePreviewBuffers,
  buildRouteCRock,
  type PolyCsgPresetId,
  type RouteCSculptParams,
} from './poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts, type PolyPbrMode } from './poly-pbr'
import type {
  PolyCWorkerBakeResponse,
  PolyCWorkerPreviewResponse,
  PolyCWorkerRequest,
  PolyCWorkerResponse,
} from './poly-c.worker'

export interface PolyCJobMeta {
  jobId: number
  submittedAt: number
  dispatchedAt: number
  receivedAt: number
  queueWaitMs: number
  roundTripMs: number
}

export interface PolyCWorkerClientStats {
  usingWorker: boolean
  latestJobId: number
  lastAppliedJobId: number
  lastAppliedStage: 'none' | 'preview' | 'bake'
  completedPreviews: number
  completedBakes: number
  staleDropped: number
  coalescedSkipped: number
}

export type PolyCResultHandler = (
  res: PolyCWorkerPreviewResponse | PolyCWorkerBakeResponse,
  meta: PolyCJobMeta,
) => void

export interface PolyCWorkerClientOptions {
  workerFactory?: () => Worker | null
}

/**
 * Latest-wins coalescing Worker client for Route C2 explicit Manifold CSG + C2-surface 512 PBR:
 * - Rapid continuous drag events coalesce to at most 1 queued job behind the busy Worker,
 *   while intermediate clay previews render immediately for smooth drag feedback.
 * - Any stale `bake` (`res.jobId < latestJobId`) is strictly dropped and NEVER overwrites newer parameters.
 * - Any `preview` older than a newer `bake`, an already-applied job, or `cancelAll()` is strictly dropped.
 */
export class PolyCWorkerClient {
  private worker: Worker | null = null
  private workerInitTried = false
  private readonly workerFactory: (() => Worker | null) | null
  private latestJobId = 0
  private latestBakeJobId = 0
  private minValidJobId = 0
  private lastAppliedJobId = 0
  private inFlightJobId: number | null = null
  private pendingReq: PolyCWorkerRequest | null = null
  private readonly submittedTimes = new Map<number, number>()
  private readonly dispatchedTimes = new Map<number, number>()
  private readonly stats: PolyCWorkerClientStats = {
    usingWorker: false,
    latestJobId: 0,
    lastAppliedJobId: 0,
    lastAppliedStage: 'none',
    completedPreviews: 0,
    completedBakes: 0,
    staleDropped: 0,
    coalescedSkipped: 0,
  }
  private onResult: PolyCResultHandler | null = null
  private onError: ((err: Error) => void) | null = null
  private disposed = false

  constructor(
    onResult: PolyCResultHandler,
    onError?: (err: Error) => void,
    options?: PolyCWorkerClientOptions,
  ) {
    this.onResult = onResult
    this.onError = onError ?? null
    this.workerFactory = options?.workerFactory ?? null
  }

  private ensureWorker(): Worker | null {
    if (this.disposed) return null
    if (this.worker) return this.worker
    if (this.workerInitTried) return null
    this.workerInitTried = true
    try {
      let w: Worker | null = null
      if (this.workerFactory) {
        w = this.workerFactory()
      } else if (typeof Worker !== 'undefined') {
        w = new Worker(new URL('./poly-c.worker.ts', import.meta.url), { type: 'module' })
      }
      if (!w) return null
      w.onmessage = (ev: MessageEvent<PolyCWorkerResponse>) => this.handleMessage(ev.data)
      w.onerror = ev => {
        this.inFlightJobId = null
        this.onError?.(new Error(ev.message || 'Route C2 Worker error'))
        this.flushPending()
      }
      this.worker = w
      this.stats.usingWorker = true
      return w
    } catch {
      this.stats.usingWorker = false
      return null
    }
  }

  submit(input: {
    stage: 'preview' | 'bake'
    preset?: PolyCsgPresetId
    sculpt: RouteCSculptParams
    bake?: {
      size?: number
      mode: PolyPbrMode
      baseColorHex?: string
      dilationPasses?: number
      aoRays?: number
      strataStrength?: number
    }
  }): number {
    if (this.disposed) return -1
    const jobId = ++this.latestJobId
    this.stats.latestJobId = jobId
    if (input.stage === 'bake') this.latestBakeJobId = jobId
    const now = performance.now()
    this.submittedTimes.set(jobId, now)

    const req: PolyCWorkerRequest = {
      jobId,
      stage: input.stage,
      preset: input.preset ?? 'sandstone-ledge-c2',
      sculpt: { ...input.sculpt },
      bake: input.bake ? { ...input.bake } : undefined,
    }

    const w = this.ensureWorker()
    if (!w) {
      if (this.inFlightJobId !== null) {
        if (this.pendingReq !== null) {
          this.stats.coalescedSkipped++
          this.submittedTimes.delete(this.pendingReq.jobId)
        }
        this.pendingReq = req
        return jobId
      }
      this.dispatchFallback(req)
      return jobId
    }

    if (this.inFlightJobId !== null) {
      if (this.pendingReq !== null) {
        this.stats.coalescedSkipped++
        this.submittedTimes.delete(this.pendingReq.jobId)
      }
      this.pendingReq = req
      return jobId
    }

    this.dispatchToWorker(w, req)
    return jobId
  }

  cancelAll() {
    this.latestJobId++
    this.minValidJobId = this.latestJobId
    this.stats.latestJobId = this.latestJobId
    if (this.pendingReq) {
      this.stats.coalescedSkipped++
      this.pendingReq = null
    }
    this.submittedTimes.clear()
    this.dispatchedTimes.clear()
  }

  getStats(): PolyCWorkerClientStats {
    return { ...this.stats }
  }

  dispose() {
    this.disposed = true
    this.cancelAll()
    this.worker?.terminate()
    this.worker = null
    this.inFlightJobId = null
    this.onResult = null
    this.onError = null
  }

  private dispatchToWorker(w: Worker, req: PolyCWorkerRequest) {
    this.inFlightJobId = req.jobId
    this.dispatchedTimes.set(req.jobId, performance.now())
    w.postMessage(req)
  }

  private dispatchFallback(req: PolyCWorkerRequest) {
    this.inFlightJobId = req.jobId
    this.dispatchedTimes.set(req.jobId, performance.now())
    void runMainThreadFallback(req)
      .then(res => this.handleMessage(res))
      .catch(err => {
        this.inFlightJobId = null
        this.onError?.(err instanceof Error ? err : new Error(String(err)))
        this.flushPending()
      })
  }

  private handleMessage(res: PolyCWorkerResponse) {
    if (this.disposed) return
    if (this.inFlightJobId === res.jobId) {
      this.inFlightJobId = null
    }
    if (res.stage === 'error') {
      this.submittedTimes.delete(res.jobId)
      this.dispatchedTimes.delete(res.jobId)
      this.onError?.(new Error(res.error))
      this.flushPending()
      return
    }

    const receivedAt = performance.now()
    const submittedAt = this.submittedTimes.get(res.jobId) ?? receivedAt
    const dispatchedAt = this.dispatchedTimes.get(res.jobId) ?? submittedAt
    this.submittedTimes.delete(res.jobId)
    this.dispatchedTimes.delete(res.jobId)

    const isCancelled = res.jobId < this.minValidJobId
    const isOlderThanApplied = res.jobId <= this.lastAppliedJobId
    const isStaleBake = res.stage === 'bake' && res.jobId < this.latestJobId
    const isPreviewSupersededByBake = res.stage === 'preview' && res.jobId < this.latestBakeJobId

    if (isCancelled || isOlderThanApplied || isStaleBake || isPreviewSupersededByBake) {
      this.stats.staleDropped++
      this.flushPending()
      return
    }

    this.lastAppliedJobId = res.jobId
    this.stats.lastAppliedJobId = res.jobId
    this.stats.lastAppliedStage = res.stage
    if (res.stage === 'preview') this.stats.completedPreviews++
    else this.stats.completedBakes++

    this.onResult?.(res, {
      jobId: res.jobId,
      submittedAt,
      dispatchedAt,
      receivedAt,
      queueWaitMs: Math.round((dispatchedAt - submittedAt) * 10) / 10,
      roundTripMs: Math.round((receivedAt - submittedAt) * 10) / 10,
    })

    this.flushPending()
  }

  private flushPending() {
    if (this.disposed || this.inFlightJobId !== null || !this.pendingReq) return
    const next = this.pendingReq
    this.pendingReq = null
    if (this.worker) this.dispatchToWorker(this.worker, next)
    else this.dispatchFallback(next)
  }
}

async function runMainThreadFallback(req: PolyCWorkerRequest): Promise<PolyCWorkerResponse> {
  const t0 = performance.now()
  const c2 = await buildRouteCRock(req.preset, req.sculpt, {
    skipFullAudit: req.stage === 'preview',
  })
  if (req.stage === 'preview') {
    const tBuf0 = performance.now()
    const creaseDeg = (req.sculpt.bevelScale ?? 1.0) <= 0.02 ? 18 : 24
    const bufs = buildCreasePreviewBuffers(c2.positions, c2.indices, creaseDeg)
    const previewBufMs = Math.round((performance.now() - tBuf0) * 10) / 10
    const previewMs = Math.round((performance.now() - t0) * 10) / 10
    const ph = c2.audit.phases ?? { booleanMs: c2.audit.buildMs, fallbackMs: 0, fallbackCount: 0, auditMs: 0, totalMs: c2.audit.buildMs }
    return {
      jobId: req.jobId,
      stage: 'preview',
      positions: bufs.positions,
      normals: bufs.normals,
      indices: bufs.indices,
      audit: c2.audit,
      previewMs,
      phaseTimings: {
        booleanMs: ph.booleanMs,
        fallbackMs: ph.fallbackMs,
        fallbackCount: ph.fallbackCount,
        auditMs: ph.auditMs,
        previewBufMs,
        workerTotalMs: previewMs,
      },
    }
  }
  const bakeSize = req.bake?.size ?? 512
  const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: bakeSize, gutterPx: 10 })
  const baked = bakePolyCsgPbr(c2, uv, {
    size: bakeSize,
    mode: req.bake?.mode ?? 'shallow-detail',
    baseColorHex: req.bake?.baseColorHex ?? '#caa57c',
    dilationPasses: req.bake?.dilationPasses ?? 14,
    aoRays: req.bake?.aoRays ?? 16,
    seed: Math.round(req.sculpt.seed ?? 5104),
    strataStrength: req.bake?.strataStrength ?? 1.0,
  })
  return {
    jobId: req.jobId,
    stage: 'bake',
    positions: uv.positions,
    normals: uv.normals,
    uvs: uv.uvs,
    tangents: uv.tangents,
    indices: uv.indices,
    size: baked.size,
    albedo: baked.albedo,
    normal: baked.normal,
    ao: baked.ao,
    audit: c2.audit,
    uvAudit: uv.audit,
    uvMs: uv.uvMs,
    bakeStats: baked.stats,
  }
}

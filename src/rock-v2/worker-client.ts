import { bakeRockV2Textures, type BakeRockV2Options } from './bake'
import { createRockV2Field, type RockV2ArchetypeId, type RockV2SculptParams } from './sdf'
import { extractSurfaceNets } from './surface-nets'
import { unwrapRockUvCharts } from './uv-charts'
import type {
  RockV2WorkerBakeResponse,
  RockV2WorkerPreviewResponse,
  RockV2WorkerRequest,
  RockV2WorkerResponse,
} from './rock-v2.worker'

export interface RockV2JobMeta {
  jobId: number
  submittedAt: number
  receivedAt: number
  roundTripMs: number
}

export interface RockV2WorkerClientStats {
  usingWorker: boolean
  latestJobId: number
  lastAppliedJobId: number
  lastAppliedStage: 'none' | 'preview' | 'bake'
  completedPreviews: number
  completedBakes: number
  staleDropped: number
  coalescedSkipped: number
}

export type RockV2ResultHandler = (
  res: RockV2WorkerPreviewResponse | RockV2WorkerBakeResponse,
  meta: RockV2JobMeta,
) => void

export interface RockV2WorkerClientOptions {
  workerFactory?: () => Worker | null
}

/**
 * Latest-wins coalescing Worker client for Rock v2 SDF + 512 PBR baking:
 * - During continuous drag, intermediate `preview` frames render as they finish (smooth live feedback)
 *   while rapid drag events coalesce to at most 1 queued job behind the busy Worker.
 * - A stale `bake` (`res.jobId < latestJobId`) NEVER overwrites newer parameters.
 * - Any `preview` older than a newer `bake`, an already-applied job, or `cancelAll()` is dropped cleanly.
 * - Supports custom `workerFactory` (Vite `?worker&inline` for Electron `file://` AND mock async workers for tests).
 */
export class RockV2WorkerClient {
  private worker: Worker | null = null
  private workerInitTried = false
  private readonly workerFactory: (() => Worker | null) | null
  private latestJobId = 0
  private latestBakeJobId = 0
  private minValidJobId = 0
  private lastAppliedJobId = 0
  private inFlightJobId: number | null = null
  private pendingReq: RockV2WorkerRequest | null = null
  private readonly submittedTimes = new Map<number, number>()
  private readonly stats: RockV2WorkerClientStats = {
    usingWorker: false,
    latestJobId: 0,
    lastAppliedJobId: 0,
    lastAppliedStage: 'none',
    completedPreviews: 0,
    completedBakes: 0,
    staleDropped: 0,
    coalescedSkipped: 0,
  }
  private onResult: RockV2ResultHandler | null = null
  private onError: ((err: Error) => void) | null = null
  private disposed = false

  constructor(
    onResult: RockV2ResultHandler,
    onError?: (err: Error) => void,
    options?: RockV2WorkerClientOptions,
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
        w = new Worker(new URL('./rock-v2.worker.ts', import.meta.url), { type: 'module' })
      }
      if (!w) return null
      w.onmessage = (ev: MessageEvent<RockV2WorkerResponse>) => this.handleMessage(ev.data)
      w.onerror = ev => {
        this.inFlightJobId = null
        this.onError?.(new Error(ev.message || 'Rock v2 Worker error'))
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

  /** Submits a new preview or full-bake job. Newer submissions immediately supersede stale/queued jobs. */
  submit(input: {
    stage: 'preview' | 'bake'
    archetype: RockV2ArchetypeId
    resolution?: number
    sculpt: RockV2SculptParams
    bake?: BakeRockV2Options
  }): number {
    if (this.disposed) return -1
    const jobId = ++this.latestJobId
    this.stats.latestJobId = jobId
    if (input.stage === 'bake') {
      this.latestBakeJobId = jobId
    }
    const now = performance.now()
    this.submittedTimes.set(jobId, now)

    const req: RockV2WorkerRequest = {
      jobId,
      stage: input.stage,
      archetype: input.archetype,
      resolution: input.resolution ?? 30,
      sculpt: { ...input.sculpt },
      bake: input.bake ? { ...input.bake } : undefined,
    }

    const w = this.ensureWorker()
    if (!w) {
      const res = runSyncFallback(req)
      this.handleMessage(res)
      return jobId
    }

    if (this.inFlightJobId !== null) {
      // Latest-wins coalescing: overwrite any queued older request
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

  /** Invalidates all currently running & queued jobs so none can overwrite UI state after exiting mode. */
  cancelAll() {
    this.latestJobId++
    this.minValidJobId = this.latestJobId
    this.stats.latestJobId = this.latestJobId
    if (this.pendingReq) {
      this.stats.coalescedSkipped++
      this.pendingReq = null
    }
    this.submittedTimes.clear()
  }

  getStats(): RockV2WorkerClientStats {
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

  private dispatchToWorker(w: Worker, req: RockV2WorkerRequest) {
    this.inFlightJobId = req.jobId
    w.postMessage(req)
  }

  private handleMessage(res: RockV2WorkerResponse) {
    if (this.disposed) return
    if (this.inFlightJobId === res.jobId) {
      this.inFlightJobId = null
    }

    const receivedAt = performance.now()
    const submittedAt = this.submittedTimes.get(res.jobId) ?? receivedAt
    this.submittedTimes.delete(res.jobId)

    // Strict stale-job non-overwrite guard:
    // 1. Anything invalidated by cancelAll() is dropped.
    // 2. Anything older than or equal to an already-applied job is dropped.
    // 3. A stale `bake` (older than latestJobId) NEVER overwrites newer params.
    // 4. A stale `preview` older than a newer `bake` submission is dropped.
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
      receivedAt,
      roundTripMs: Math.round((receivedAt - submittedAt) * 10) / 10,
    })

    this.flushPending()
  }

  private flushPending() {
    if (this.disposed || this.inFlightJobId !== null || !this.pendingReq) return
    const w = this.worker
    if (!w) return
    const next = this.pendingReq
    this.pendingReq = null
    if (next.jobId < this.minValidJobId || (next.stage === 'bake' && next.jobId < this.latestJobId)) {
      this.stats.staleDropped++
      return
    }
    this.dispatchToWorker(w, next)
  }
}

function runSyncFallback(req: RockV2WorkerRequest): RockV2WorkerResponse {
  const field = createRockV2Field(req.archetype, req.sculpt)
  const mesh = extractSurfaceNets(field, { resolution: req.resolution, projectToSurface: true })
  if (req.stage === 'preview') {
    return {
      jobId: req.jobId,
      stage: 'preview',
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      audit: mesh.audit,
      timings: mesh.timings,
    }
  }
  const bakeSize = req.bake?.size ?? 512
  const unwrapped = unwrapRockUvCharts(mesh, bakeSize, 12)
  const baked = bakeRockV2Textures(field, unwrapped, {
    size: bakeSize,
    dilationPasses: req.bake?.dilationPasses ?? 10,
    brushMode: req.bake?.brushMode ?? 'off',
    baseColorHex: req.bake?.baseColorHex ?? '#cca988',
  })
  return {
    jobId: req.jobId,
    stage: 'bake',
    positions: unwrapped.positions,
    normals: unwrapped.normals,
    uvs: unwrapped.uvs,
    tangents: unwrapped.tangents,
    indices: unwrapped.indices,
    size: baked.size,
    albedo: baked.albedo,
    normal: baked.normal,
    ao: baked.ao,
    audit: mesh.audit,
    uvAudit: unwrapped.audit,
    uvMs: unwrapped.uvMs,
    meshTimings: mesh.timings,
    bakeStats: baked.stats,
  }
}

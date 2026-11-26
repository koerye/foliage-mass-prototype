/// <reference lib="webworker" />
import {
  buildCreasePreviewBuffers,
  buildRouteCRock,
  getManifoldModule,
  type PolyCsgAudit,
  type PolyCsgPresetId,
  type RouteCSculptParams,
} from './poly-csg'
import {
  bakePolyCsgPbr,
  unwrapPolyCsgUvCharts,
  type BakePolyPbrOptions,
  type PolyBakeStats,
  type PolyPbrMode,
  type PolyUvAudit,
} from './poly-pbr'

export interface PolyCWorkerRequest {
  jobId: number
  stage: 'preview' | 'bake'
  preset: PolyCsgPresetId
  sculpt: RouteCSculptParams
  bake?: {
    size?: number
    mode: PolyPbrMode
    baseColorHex?: string
    dilationPasses?: number
    aoRays?: number
    strataStrength?: number
  }
}

export interface PolyCWorkerPreviewResponse {
  jobId: number
  stage: 'preview'
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  audit: PolyCsgAudit
  previewMs: number
  phaseTimings: {
    booleanMs: number
    fallbackMs: number
    fallbackCount: number
    auditMs: number
    previewBufMs: number
    workerTotalMs: number
  }
}

export interface PolyCWorkerBakeResponse {
  jobId: number
  stage: 'bake'
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  tangents: Float32Array
  indices: Uint32Array
  size: number
  albedo: Uint8ClampedArray
  normal: Uint8ClampedArray
  ao: Uint8ClampedArray
  audit: PolyCsgAudit
  uvAudit: PolyUvAudit
  uvMs: number
  bakeStats: PolyBakeStats
}

export interface PolyCWorkerErrorResponse {
  jobId: number
  stage: 'error'
  error: string
}

export type PolyCWorkerResponse = PolyCWorkerPreviewResponse | PolyCWorkerBakeResponse | PolyCWorkerErrorResponse

const ctx = self as unknown as DedicatedWorkerGlobalScope

// Pre-warm offline Manifold WASM immediately when Worker boots so first drag has zero WASM compile stall!
void getManifoldModule()

ctx.onmessage = async (ev: MessageEvent<PolyCWorkerRequest>) => {
  const req = ev.data
  if (!req) return

  try {
    const t0 = performance.now()
    // Interactive drag preview skips O(T^2) self-intersection audit for lowest latency;
    // release/512 PBR bake ALWAYS runs the full topology + self-intersection audit.
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
      const res: PolyCWorkerPreviewResponse = {
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
      ctx.postMessage(res, [bufs.positions.buffer, bufs.normals.buffer, bufs.indices.buffer])
      return
    }

    const bakeSize = req.bake?.size ?? 512
    const isMossyTerrace = req.preset === 'terraced-moss-bluff-c2'
    const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: bakeSize, gutterPx: isMossyTerrace ? 6 : 10 })
    const bakeOpts: BakePolyPbrOptions = {
      size: bakeSize,
      mode: req.bake?.mode ?? 'shallow-detail',
      baseColorHex: req.bake?.baseColorHex ?? (isMossyTerrace ? '#c49b76' : '#caa57c'),
      dilationPasses: req.bake?.dilationPasses ?? (isMossyTerrace ? 8 : 14),
      aoRays: req.bake?.aoRays ?? (isMossyTerrace ? 12 : 16),
      seed: Math.round(req.sculpt.seed ?? (isMossyTerrace ? 7301 : 5104)),
      strataStrength: req.bake?.strataStrength ?? 1.0,
      ...(isMossyTerrace ? { mossTop: true, mossColorHex: '#68a624' } : {}),
    }
    const baked = bakePolyCsgPbr(c2, uv, bakeOpts)

    const res: PolyCWorkerBakeResponse = {
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
    ctx.postMessage(res, [
      uv.positions.buffer,
      uv.normals.buffer,
      uv.uvs.buffer,
      uv.tangents.buffer,
      uv.indices.buffer,
      baked.albedo.buffer,
      baked.normal.buffer,
      baked.ao.buffer,
    ])
  } catch (err) {
    const errRes: PolyCWorkerErrorResponse = {
      jobId: req.jobId,
      stage: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(errRes)
  }
}

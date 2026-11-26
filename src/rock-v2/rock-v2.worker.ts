/// <reference lib="webworker" />
import { bakeRockV2Textures, type BakeRockV2Options, type RockV2BakeDiagnostics } from './bake'
import { createRockV2Field, type RockV2ArchetypeId, type RockV2SculptParams } from './sdf'
import { extractSurfaceNets, type TopologyAudit } from './surface-nets'
import { unwrapRockUvCharts, type UvUnwrapAudit } from './uv-charts'

export interface RockV2WorkerRequest {
  jobId: number
  stage: 'preview' | 'bake'
  archetype: RockV2ArchetypeId
  resolution: number
  sculpt: RockV2SculptParams
  bake?: BakeRockV2Options
}

export interface RockV2WorkerPreviewResponse {
  jobId: number
  stage: 'preview'
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  audit: TopologyAudit
  timings: {
    sdfSampleMs: number
    extractMs: number
    projectMs: number
    normalsMs: number
    totalMs: number
  }
}

export interface RockV2WorkerBakeResponse {
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
  audit: TopologyAudit
  uvAudit: UvUnwrapAudit
  uvMs: number
  meshTimings: RockV2WorkerPreviewResponse['timings']
  bakeStats: RockV2BakeDiagnostics
}

export type RockV2WorkerResponse = RockV2WorkerPreviewResponse | RockV2WorkerBakeResponse

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<RockV2WorkerRequest>) => {
  const req = ev.data
  if (!req) return
  const field = createRockV2Field(req.archetype, req.sculpt)
  const mesh = extractSurfaceNets(field, { resolution: req.resolution, projectToSurface: true })

  if (req.stage === 'preview') {
    const res: RockV2WorkerPreviewResponse = {
      jobId: req.jobId,
      stage: 'preview',
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      audit: mesh.audit,
      timings: mesh.timings,
    }
    ctx.postMessage(res, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer])
    return
  }

  const bakeSize = req.bake?.size ?? 512
  const unwrapped = unwrapRockUvCharts(mesh, bakeSize, 12)
  const baked = bakeRockV2Textures(field, unwrapped, {
    size: bakeSize,
    dilationPasses: req.bake?.dilationPasses ?? 10,
    brushMode: req.bake?.brushMode ?? 'subtle',
    baseColorHex: req.bake?.baseColorHex ?? '#cca988',
  })

  const res: RockV2WorkerBakeResponse = {
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
  ctx.postMessage(res, [
    unwrapped.positions.buffer,
    unwrapped.normals.buffer,
    unwrapped.uvs.buffer,
    unwrapped.tangents.buffer,
    unwrapped.indices.buffer,
    baked.albedo.buffer,
    baked.normal.buffer,
    baked.ao.buffer,
  ])
}

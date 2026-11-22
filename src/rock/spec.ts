export type RockStyle = 'painterly' | 'cel'
export type RockTopMode = 'none' | 'sand' | 'moss' | 'snow'
export type RockPresetId =
  | 'boulder-sand-cap'
  | 'cel-anime-rock'
  | 'boulder-chiseled'
  | 'boulder-slab'
  | 'mossy-forest-rock'
  | 'rock-cluster'

export interface RockShapeSpec {
  width: number
  height: number
  depth: number
  facetCount: number
  flatness: number
  bevel: number
  asymmetry: number
  taperTop: number
  bottomFlat: number
}

export interface RockDetailSpec {
  subdivisions: 0 | 1 | 2
  chisel: number
  undulation: number
  cracks: number
  sharpness: number
}

export interface RockShadingSpec {
  baseColor: string
  shadowColor: string
  edgeColor: string
  edgeWear: number
  edgeBreakup: number
  cavityAO: number
  facetVariation: number
  roughness: number
  grain: number
}

export interface RockTopSpec {
  mode: RockTopMode
  color: string
  coverage: number
  softness: number
}

export interface RockClusterSpec {
  count: number
  spread: number
  scaleDecay: number
}

export interface RockSpec {
  version: 1
  preset: RockPresetId
  name: string
  seed: number
  style: RockStyle
  shape: RockShapeSpec
  detail: RockDetailSpec
  shading: RockShadingSpec
  top: RockTopSpec
  cluster: RockClusterSpec
}

export const rockPresetIds: RockPresetId[] = [
  'boulder-sand-cap',
  'cel-anime-rock',
  'boulder-chiseled',
  'boulder-slab',
  'mossy-forest-rock',
  'rock-cluster',
]

export const rockPresets: Record<RockPresetId, RockSpec> = {
  'boulder-sand-cap': {
    version: 1,
    preset: 'boulder-sand-cap',
    name: '沙顶切面岩',
    seed: 2048,
    style: 'painterly',
    shape: {
      width: 1.60,
      height: 1.12,
      depth: 1.38,
      facetCount: 20,
      flatness: 0.32,
      bevel: 0.23,
      asymmetry: 0.48,
      taperTop: 0.15,
      bottomFlat: 0.74,
    },
    detail: {
      subdivisions: 1,
      chisel: 0.28,
      undulation: 0.24,
      cracks: 0.21,
      sharpness: 0.58,
    },
    shading: {
      baseColor: '#999997',
      shadowColor: '#4f5a68',
      edgeColor: '#cbcac2',
      edgeWear: 0.57,
      edgeBreakup: 0.72,
      cavityAO: 0.70,
      facetVariation: 0.46,
      roughness: 0.94,
      grain: 0.52,
    },
    top: {
      mode: 'sand',
      color: '#cbb67b',
      coverage: 0.56,
      softness: 0.36,
    },
    cluster: { count: 1, spread: 0.95, scaleDecay: 0.56 },
  },

  'cel-anime-rock': {
    version: 1,
    preset: 'cel-anime-rock',
    name: '赛璐璐简面石',
    seed: 3107,
    style: 'cel',
    shape: {
      width: 1.72,
      height: 0.92,
      depth: 1.36,
      facetCount: 9,
      flatness: 0.57,
      bevel: 0.12,
      asymmetry: 0.42,
      taperTop: 0.48,
      bottomFlat: 0.88,
    },
    detail: {
      subdivisions: 1,
      chisel: 0.0,
      undulation: 0.23,
      cracks: 0.0,
      sharpness: 0.94,
    },
    shading: {
      baseColor: '#929795',
      shadowColor: '#5b6b67',
      edgeColor: '#cbdad4',
      edgeWear: 0.98,
      edgeBreakup: 0.82,
      cavityAO: 0.3,
      facetVariation: 0.34,
      roughness: 0.94,
      grain: 0.05,
    },
    top: {
      mode: 'none',
      color: '#e5cf78',
      coverage: 0.0,
      softness: 0.18,
    },
    cluster: { count: 1, spread: 1.0, scaleDecay: 0.55 },
  },

  'boulder-chiseled': {
    version: 1,
    preset: 'boulder-chiseled',
    name: '凿面碎棱岩',
    seed: 4821,
    style: 'painterly',
    shape: {
      width: 1.38,
      height: 1.44,
      depth: 1.26,
      facetCount: 23,
      flatness: 0.44,
      bevel: 0.18,
      asymmetry: 0.38,
      taperTop: 0.24,
      bottomFlat: 0.68,
    },
    detail: {
      subdivisions: 2,
      chisel: 0.68,
      undulation: 0.22,
      cracks: 0.3,
      sharpness: 0.72,
    },
    shading: {
      baseColor: '#958f88',
      shadowColor: '#495564',
      edgeColor: '#ccc9be',
      edgeWear: 0.67,
      edgeBreakup: 0.70,
      cavityAO: 0.78,
      facetVariation: 0.34,
      roughness: 0.84,
      grain: 0.42,
    },
    top: {
      mode: 'sand',
      color: '#c9b47c',
      coverage: 0.52,
      softness: 0.33,
    },
    cluster: { count: 1, spread: 0.92, scaleDecay: 0.54 },
  },

  'boulder-slab': {
    version: 1,
    preset: 'boulder-slab',
    name: '宽厚平棱巨石',
    seed: 1659,
    style: 'painterly',
    shape: {
      width: 2.16,
      height: 1.06,
      depth: 1.56,
      facetCount: 14,
      flatness: 0.72,
      bevel: 0.21,
      asymmetry: 0.36,
      taperTop: 0.2,
      bottomFlat: 0.84,
    },
    detail: {
      subdivisions: 1,
      chisel: 0.18,
      undulation: 0.14,
      cracks: 0.16,
      sharpness: 0.74,
    },
    shading: {
      baseColor: '#9f9b98',
      shadowColor: '#445566',
      edgeColor: '#eeeae4',
      edgeWear: 0.48,
      edgeBreakup: 0.68,
      cavityAO: 0.68,
      facetVariation: 0.32,
      roughness: 0.88,
      grain: 0.38,
    },
    top: {
      mode: 'none',
      color: '#e5cf78',
      coverage: 0.0,
      softness: 0.25,
    },
    cluster: { count: 1, spread: 1.05, scaleDecay: 0.52 },
  },

  'mossy-forest-rock': {
    version: 1,
    preset: 'mossy-forest-rock',
    name: '森林青苔磐石',
    seed: 7315,
    style: 'painterly',
    shape: {
      width: 1.82,
      height: 1.16,
      depth: 1.52,
      facetCount: 16,
      flatness: 0.52,
      bevel: 0.18,
      asymmetry: 0.32,
      taperTop: 0.16,
      bottomFlat: 0.78,
    },
    detail: {
      subdivisions: 1,
      chisel: 0.28,
      undulation: 0.22,
      cracks: 0.22,
      sharpness: 0.54,
    },
    shading: {
      baseColor: '#7b858e',
      shadowColor: '#32424d',
      edgeColor: '#d8e3e6',
      edgeWear: 0.44,
      edgeBreakup: 0.62,
      cavityAO: 0.76,
      facetVariation: 0.28,
      roughness: 0.88,
      grain: 0.4,
    },
    top: {
      mode: 'moss',
      color: '#78894a',
      coverage: 0.68,
      softness: 0.29,
    },
    cluster: { count: 1, spread: 0.96, scaleDecay: 0.56 },
  },

  'rock-cluster': {
    version: 1,
    preset: 'rock-cluster',
    name: '自然石堆组合',
    seed: 5512,
    style: 'painterly',
    shape: {
      width: 1.55,
      height: 1.18,
      depth: 1.38,
      facetCount: 14,
      flatness: 0.6,
      bevel: 0.20,
      asymmetry: 0.38,
      taperTop: 0.18,
      bottomFlat: 0.78,
    },
    detail: {
      subdivisions: 1,
      chisel: 0.3,
      undulation: 0.16,
      cracks: 0.16,
      sharpness: 0.66,
    },
    shading: {
      baseColor: '#999892',
      shadowColor: '#3c495e',
      edgeColor: '#c6c4ba',
      edgeWear: 0.50,
      edgeBreakup: 0.70,
      cavityAO: 0.72,
      facetVariation: 0.3,
      roughness: 0.86,
      grain: 0.34,
    },
    top: {
      mode: 'sand',
      color: '#c5b17e',
      coverage: 0.55,
      softness: 0.36,
    },
    cluster: { count: 3, spread: 0.96, scaleDecay: 0.54 },
  },
}

function clamp(v: number, lo: number, hi: number, fallback: number) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(hi, Math.max(lo, n))
}

function colorHex(v: unknown, fallback: string) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback
}

export function rockPresetSpec(id: RockPresetId): RockSpec {
  const src = rockPresets[id] ?? rockPresets['boulder-sand-cap']
  return {
    ...src,
    shape: { ...src.shape },
    detail: { ...src.detail },
    shading: { ...src.shading },
    top: { ...src.top },
    cluster: { ...src.cluster },
  }
}

export function parseRockSpec(raw: unknown): RockSpec {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pid = rockPresetIds.includes(obj.preset as RockPresetId)
    ? (obj.preset as RockPresetId)
    : 'boulder-sand-cap'
  const base = rockPresetSpec(pid)
  const sh = (obj.shape && typeof obj.shape === 'object' ? obj.shape : {}) as Record<string, unknown>
  const dt = (obj.detail && typeof obj.detail === 'object' ? obj.detail : {}) as Record<string, unknown>
  const sd = (obj.shading && typeof obj.shading === 'object' ? obj.shading : {}) as Record<string, unknown>
  const tp = (obj.top && typeof obj.top === 'object' ? obj.top : {}) as Record<string, unknown>
  const cl = (obj.cluster && typeof obj.cluster === 'object' ? obj.cluster : {}) as Record<string, unknown>

  const rawSub = Math.round(clamp(dt.subdivisions as number, 0, 2, base.detail.subdivisions))
  const subdivisions = (rawSub <= 0 ? 0 : rawSub === 1 ? 1 : 2) as 0 | 1 | 2
  const style: RockStyle = obj.style === 'cel' ? 'cel' : obj.style === 'painterly' ? 'painterly' : base.style
  const topMode: RockTopMode =
    tp.mode === 'none' || tp.mode === 'sand' || tp.mode === 'moss' || tp.mode === 'snow'
      ? tp.mode
      : base.top.mode

  return {
    version: 1,
    preset: pid,
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 48) : base.name,
    seed: Math.max(0, Math.round(clamp(obj.seed as number, 0, 999999, base.seed))),
    style,
    shape: {
      width: clamp(sh.width as number, 0.4, 4.5, base.shape.width),
      height: clamp(sh.height as number, 0.35, 4.0, base.shape.height),
      depth: clamp(sh.depth as number, 0.4, 4.5, base.shape.depth),
      facetCount: Math.round(clamp(sh.facetCount as number, 6, 28, base.shape.facetCount)),
      flatness: clamp(sh.flatness as number, 0, 1, base.shape.flatness),
      bevel: clamp(sh.bevel as number, 0, 0.32, base.shape.bevel),
      asymmetry: clamp(sh.asymmetry as number, 0, 1, base.shape.asymmetry),
      taperTop: clamp(sh.taperTop as number, -0.35, 0.55, base.shape.taperTop),
      bottomFlat: clamp(sh.bottomFlat as number, 0, 1, base.shape.bottomFlat),
    },
    detail: {
      subdivisions,
      chisel: clamp(dt.chisel as number, 0, 1, base.detail.chisel),
      undulation: clamp(dt.undulation as number, 0, 1, base.detail.undulation),
      cracks: clamp(dt.cracks as number, 0, 1, base.detail.cracks),
      sharpness: clamp(dt.sharpness as number, 0, 1, base.detail.sharpness),
    },
    shading: {
      baseColor: colorHex(sd.baseColor, base.shading.baseColor),
      shadowColor: colorHex(sd.shadowColor, base.shading.shadowColor),
      edgeColor: colorHex(sd.edgeColor, base.shading.edgeColor),
      edgeWear: clamp(sd.edgeWear as number, 0, 1, base.shading.edgeWear),
      edgeBreakup: clamp(sd.edgeBreakup as number, 0, 1, base.shading.edgeBreakup),
      cavityAO: clamp(sd.cavityAO as number, 0, 1, base.shading.cavityAO),
      facetVariation: clamp(sd.facetVariation as number, 0, 1, base.shading.facetVariation),
      roughness: clamp(sd.roughness as number, 0.25, 1, base.shading.roughness),
      grain: clamp(sd.grain as number, 0, 1, base.shading.grain),
    },
    top: {
      mode: topMode,
      color: colorHex(tp.color, base.top.color),
      coverage: clamp(tp.coverage as number, 0, 1, base.top.coverage),
      softness: clamp(tp.softness as number, 0.05, 0.65, base.top.softness),
    },
    cluster: {
      count: Math.round(clamp(cl.count as number, 1, 5, base.cluster.count)),
      spread: clamp(cl.spread as number, 0.45, 1.8, base.cluster.spread),
      scaleDecay: clamp(cl.scaleDecay as number, 0.3, 0.85, base.cluster.scaleDecay),
    },
  }
}

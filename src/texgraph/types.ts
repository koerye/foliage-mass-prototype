// Core data model for the Substance Designer-style procedural texture node graph (v1 + v2).
import type { EditableTextureSlot } from '../studio/texture-slots'

export type PortType = 'gray' | 'rgba' | 'label'

export type NodeCategory = 'bark' | 'foliage' | 'filter' | 'adjust' | 'blend' | 'output'

export type NodeType =
  | 'perlin_noise'
  | 'bark_fibers'
  | 'painterly_bark'
  | 'cells_voronoi'
  | 'lenticels'
  | 'gradient_linear'
  | 'leaf_shape'
  | 'custom_leaf'
  | 'branch_scatter'
  | 'vector_layout'
  | 'atlas_compose'
  | 'flower_bloom'
  | 'warp'
  | 'stylize_paint'
  | 'transform_2d'
  | 'blur'
  | 'slope_blur'
  | 'ink_outline'
  | 'curvature_ao'
  | 'levels'
  | 'curves_lut'
  | 'gradient_map'
  | 'palette_map'
  | 'hsl_adjust'
  | 'edge_mask'
  | 'blend'
  | 'output_material'

export interface PortSpec {
  id: string
  label: string
  type: PortType
  optional?: boolean
}

export interface ParamSpec {
  key: string
  label: string
  kind: 'range' | 'int' | 'select' | 'color' | 'bool' | 'gradient' | 'curve' | 'palette' | 'json'
  min?: number
  max?: number
  step?: number
  options?: [string, string][]
  default: unknown
  hint?: string
}

export interface GradientStop {
  pos: number // 0..1
  color: string // #rrggbb
}

/** Control point `[x, y]` in `[0, 1] x [0, 1]` for monotone curve LUTs & leaf contour profiles. */
export type CurvePoint = [number, number]

/** Editable multi-point Bezier stem spline inside `vector_layout`. */
export interface VectorStem {
  id: string
  /** Normalized canvas coordinates `[[x0,y0], [x1,y1], ...]` (2..8 control points, 0..1). */
  points: [number, number][]
  widthStart: number // normalized radius at base (0.002..0.04)
  widthEnd: number   // normalized radius at tip (0.001..0.03)
  color?: string     // optional per-stem hex color override
  z: number          // unified z-order shared with leaf instances
}

/** Editable procedural leaf stamp instance inside `vector_layout` (stable ID across undo/save/reload). */
export interface VectorLeafInstance {
  id: string
  x: number         // center X in [0..1]
  y: number         // center Y in [0..1]
  rot: number       // rotation in radians (0 = pointing up -Y in canvas coords)
  scaleX: number    // width multiplier (0.03..0.65)
  scaleY: number    // height multiplier (0.03..0.65)
  flip?: boolean    // horizontal mirror
  variant: number   // 0..3 selects leafA..leafD input
  colorIdx: number  // index into palette[]
  z: number         // unified z-order (higher draws in front)
  bend?: number     // optional subtle per-instance bend offset (-0.3..0.3)
  stemId?: string   // optional parent stem reference
  locked?: boolean  // protected from automated optimizer perturbation
}

/** Editable non-uniform region metadata inside `atlas_compose` (consumed by 3D leaf cards & mip-safe padding). */
export interface AtlasRegion {
  id: string
  x: number // normalized top-left X [0..1]
  y: number // normalized top-left Y [0..1]
  w: number // normalized width (0..1]
  h: number // normalized height (0..1]
  padding: number // mip-safe inset in normalized UV units
  slot: number // 0..3 selects slotA..slotD
  anchorX?: number // normalized [0..1] inside region
  anchorY?: number // normalized [0..1] inside region (default 0.85 stem base)
  weight?: number // relative card sampling weight on 3D canopy
  role?: 'canopy' | 'accent' // large canopy cluster vs small accent sprig
}

export interface NodeDefinition {
  type: NodeType
  label: string
  shortLabel: string
  category: NodeCategory
  description: string
  inputs: PortSpec[]
  outputs: PortSpec[]
  params: ParamSpec[]
  /** Marks v2 nodes so graphs containing them automatically persist with `schemaVersion: 2`. */
  sinceVersion?: 1 | 2
}

export interface GraphNode {
  id: string
  type: NodeType
  x: number
  y: number
  label?: string
  bypass?: boolean
  params: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  fromNode: string
  fromPort: string
  toNode: string
  toPort: string
}

export type TextureCategory = 'leaf' | 'bark' | 'needle' | 'flower' | 'grass' | 'other'

export interface TextureGraph {
  schemaVersion: 1 | 2
  name: string
  category: TextureCategory
  targetSlot: EditableTextureSlot
  resolution: 256 | 512 | 1024
  seamless: boolean
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Evaluated grayscale single-channel image (values typically 0..1). */
export interface GrayBuffer {
  kind: 'gray'
  width: number
  height: number
  data: Float32Array
}

/** Evaluated 4-channel sRGB-like RGBA float buffer (0..1 per channel). */
export interface RgbaBuffer {
  kind: 'rgba'
  width: number
  height: number
  data: Float32Array
}

/** Exact non-interpolated integer instance label map (0 = background, >0 = leaf instance index, <0 = stem index). */
export interface LabelBuffer {
  kind: 'label'
  width: number
  height: number
  data: Int32Array
}

export type ImageBuffer = GrayBuffer | RgbaBuffer | LabelBuffer

export interface MaterialOutputResult {
  width: number
  height: number
  baseColor: RgbaBuffer
  heightMap: GrayBuffer
  roughness: GrayBuffer
  normal: RgbaBuffer
  alphaDilated: boolean
}

export interface GraphEvalResult {
  width: number
  height: number
  nodeOutputs: Map<string, Record<string, ImageBuffer>>
  output: MaterialOutputResult
  evalMs: number
  /** Per-node timing telemetry (ms) and cache hit count for profiling & optimization verification. */
  nodeTimings?: Record<string, number>
  cacheHits?: number
  cacheMisses?: number
}

export const CURRENT_GRAPH_SCHEMA_VERSION = 2 as const

export const categoryLabels: Record<TextureCategory, string> = {
  leaf: '树叶',
  bark: '树皮',
  needle: '针叶',
  flower: '花朵',
  grass: '草蕨',
  other: '其他',
}

export const slotLabels: Record<EditableTextureSlot, string> = {
  leaf: '阔叶叶片',
  bark: '树皮（3D无平铺）',
  needle: '松针叶形卡',
  drape: '松针垂片',
  palm: '棕榈叶',
  grass: '草叶贴图',
  fern: '蕨叶贴图',
  flower: '外层花簇',
  blossom: '花丛单花',
  stemLeaf: '花杆茎叶',
}

export const nodeCategoryLabels: Record<NodeCategory, string> = {
  bark: '树皮 · 噪声',
  foliage: '树叶 · 花朵',
  filter: '扭曲 · 滤镜',
  adjust: '调色 · 遮罩',
  blend: '混合',
  output: '材质输出',
}

export function defaultCategoryForSlot(slot: EditableTextureSlot): TextureCategory {
  if (slot === 'bark') return 'bark'
  if (slot === 'needle' || slot === 'drape') return 'needle'
  if (slot === 'flower' || slot === 'blossom') return 'flower'
  if (slot === 'grass' || slot === 'fern') return 'grass'
  return 'leaf'
}

export function defaultSlotForCategory(cat: TextureCategory): EditableTextureSlot {
  if (cat === 'bark') return 'bark'
  if (cat === 'needle') return 'needle'
  if (cat === 'flower') return 'flower'
  if (cat === 'grass') return 'grass'
  return 'leaf'
}

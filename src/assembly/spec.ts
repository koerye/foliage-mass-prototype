// Scene Assembly Studio data model, schema validation, and item factory helpers.
// Supports unlimited independent trees, shrubs, flowers, grass, rocks, and multi-part AI scenes
// positioned freely on a configurable painterly diorama ground tile.
import { leafTextureSources, parseAiScene, type AiSceneSpec, type LeafTextureSource } from '../ai/scene'
import type { PolyCsgPresetId } from '../rock-v2/poly-csg'
import type { PolyPbrMode } from '../rock-v2/poly-pbr'
import { parseRockSpec, type RockSpec } from '../rock/spec'
import { parseSavedTextureMap, type SavedTextureMap } from '../studio/texture-serialize'
import { parseTreeSpec, type TreeSpec } from '../tree/spec'
import { lightingPresets, type LightingPreset } from '../viewport'

export type AssemblyAssetKind = 'tree' | 'rock' | 'rock-c2' | 'ai'

export interface PolyCRockSpec {
  version: 1
  preset: PolyCsgPresetId
  name: string
  mode: PolyPbrMode
  seed: number
  shoulderDepth: number
  bevelScale: number
  notchDepth: number
  strataStrength: number
  baseColor: string
}

export const polyCRockPresetIds: readonly PolyCsgPresetId[] = [
  'sandstone-ledge-c2',
  'block-bluff-c2',
  'terraced-moss-bluff-c2',
] as const

export const polyCRockPresets: Record<PolyCsgPresetId, { name: string; subtitle: string; canonicalSeed: number }> = {
  'sandstone-ledge-c2': {
    name: '低矮横展砂岩 · C2',
    subtitle: '路线 C2 显式布尔 · 230 面 · 512 PBR',
    canonicalSeed: 5104,
  },
  'block-bluff-c2': {
    name: '阶梯方巨岩 · C2',
    subtitle: '路线 C2 显式布尔 · 220 面 · 512 PBR',
    canonicalSeed: 7342,
  },
  'terraced-moss-bluff-c2': {
    name: '17 苔藓层叠方巨岩 · C2',
    subtitle: '13 块非正交 Manifold 水密并集 · 阶面内缩苔藓 512 PBR',
    canonicalSeed: 7301,
  },
}
export type AssemblyCategory = 'tree' | 'deadwood' | 'shrub' | 'grass' | 'flower' | 'rock' | 'scene'
export type GroundStyle = 'diorama-path' | 'diorama-meadow' | 'studio' | 'none'
export type PathLayout = 'birch-curve' | 'boulder-trail' | 'straight' | 'none'
export type BackdropTheme = 'diorama-dark' | 'ghibli' | 'neutral' | 'forest' | 'sakura' | 'celestial'
export type AssemblyBarkStyle = 'default' | 'birch' | 'driftwood' | 'moss'
export type AssemblyCameraPreset = 'iso' | 'illustration' | 'front' | 'side' | 'top'
export type RefCompareMode = 'off' | 'pip' | 'wipe' | 'overlay' | 'split'
export type GrassSpeciesId = 'broad' | 'narrow' | 'dense' | 'reed' | 'clover'
export type GrassRvtMode = 'off' | 'root-blend' | 'full-tint' | 'normal-only'

export interface GrassRvtSpec {
  mode: GrassRvtMode
  /** 0..1 ground-to-grass color fusion strength */
  strength: number
  /** Height (m) over which root RVT color & normal blend fades out */
  fadeHeight: number
  /** 0..1 shading normal alignment toward ground Up (0,1,0) */
  normalBlend: number
  /** Also fuse placed grass assets (GrassBlades) in addition to brush grass */
  affectPlacedGrass: boolean
}

export function defaultGrassRvtSpec(overrides: Partial<GrassRvtSpec> = {}): GrassRvtSpec {
  return {
    mode: 'root-blend',
    strength: 0.9,
    fadeHeight: 0.26,
    normalBlend: 0.82,
    affectPlacedGrass: true,
    ...overrides,
  }
}

export interface AssemblyReferenceSpec {
  /** Image URL (relative ./showcases/..., /..., or data:image/... base64 DataURL) */
  src: string
  name?: string
  mode?: RefCompareMode
  opacity?: number
  split?: number
  scale?: number
  offsetX?: number
  offsetY?: number
}

export interface GrassPaintCluster {
  x: number
  y: number
  z: number
  yaw: number
  scale: number
  tiltX: number
  tiltZ: number
  species: GrassSpeciesId
  tint: string
}

export interface AssemblyGroundSpec {
  style: GroundStyle
  size: number
  thickness: number
  grassColor: string
  grassHighlight: string
  grassShadow: string
  pathLayout: PathLayout
  pathColor: string
  pathWidth: number
  seed: number
  /** Optional procedural micro-turf baked into the diorama tile (default false so clearing items leaves a clean slab). */
  builtInTurf?: boolean
}

export interface AssemblyItem {
  id: string
  name: string
  kind: AssemblyAssetKind
  category: AssemblyCategory
  visible: boolean
  locked: boolean
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  barkStyle?: AssemblyBarkStyle
  crownStyle?: 'painted'
  treeForm?: 'meadow-birch'
  leafTexture?: LeafTextureSource
  customTextures?: SavedTextureMap
  payload: TreeSpec | RockSpec | PolyCRockSpec | AiSceneSpec
}

export interface AssemblySceneSpec {
  version: 1
  name: string
  description: string
  backdrop: BackdropTheme
  lighting: LightingPreset
  wind: boolean
  ground: AssemblyGroundSpec
  cameraPreset?: AssemblyCameraPreset
  reference?: AssemblyReferenceSpec
  grassPaint?: GrassPaintCluster[]
  /** Optional PNG DataURL overlay storing custom Terrain Material Paint Brush strokes */
  groundPaint?: string
  rvt?: GrassRvtSpec
  items: AssemblyItem[]
}

export const backdropMeta: Record<BackdropTheme, { label: string; bg: string; lighting: LightingPreset }> = {
  'diorama-dark': { label: '暗夜展示台（参考图风）', bg: '#0b0e11', lighting: 'ghibli' },
  ghibli: { label: '暖阳吉卜力', bg: '#f1eee0', lighting: 'ghibli' },
  neutral: { label: '清透画室', bg: '#f2f1ec', lighting: 'neutral' },
  forest: { label: '森林冷影', bg: '#e8eeea', lighting: 'forest' },
  sakura: { label: '樱花柔光', bg: '#f7f2f4', lighting: 'sakura' },
  celestial: { label: '仙韵青岚', bg: '#d7e7e0', lighting: 'celestial' },
}

export const categoryLabels: Record<AssemblyCategory, string> = {
  tree: '树木',
  deadwood: '枯木',
  shrub: '灌木',
  grass: '草丛',
  flower: '花卉',
  rock: '石头',
  scene: '组合',
}

export const categoryIcons: Record<AssemblyCategory, string> = {
  tree: '🌳',
  deadwood: '🪵',
  shrub: '🌿',
  grass: '🌱',
  flower: '✿',
  rock: '🪨',
  scene: '✦',
}

const VALID_GROUND_STYLES = new Set<GroundStyle>(['diorama-path', 'diorama-meadow', 'studio', 'none'])
const VALID_PATH_LAYOUTS = new Set<PathLayout>(['birch-curve', 'boulder-trail', 'straight', 'none'])
const VALID_BACKDROPS = new Set<BackdropTheme>(Object.keys(backdropMeta) as BackdropTheme[])
const VALID_LIGHTINGS = new Set<string>(Object.keys(lightingPresets))
const VALID_CATEGORIES = new Set<AssemblyCategory>(Object.keys(categoryLabels) as AssemblyCategory[])
const VALID_BARK_STYLES = new Set<AssemblyBarkStyle>(['default', 'birch', 'driftwood', 'moss'])
const VALID_LEAF_SOURCES = new Set<string>(leafTextureSources)
const VALID_CAMERAS = new Set<AssemblyCameraPreset>(['iso', 'illustration', 'front', 'side', 'top'])
const VALID_REF_MODES = new Set<RefCompareMode>(['off', 'pip', 'wipe', 'overlay', 'split'])
const VALID_GRASS_SPECIES = new Set<GrassSpeciesId>(['broad', 'narrow', 'dense', 'reed', 'clover'])
const VALID_RVT_MODES = new Set<GrassRvtMode>(['off', 'root-blend', 'full-tint', 'normal-only'])
const HEX_RE = /^#[0-9a-fA-F]{6}$/
const SAFE_REF_SRC_RE = /^(?:data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+|\.{0,2}\/[\w./%-]+\.(?:png|jpe?g|webp|gif)(?:\?[\w=&.%-]*)?|https?:\/\/[^\s"'<>]+)$/i

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return n < lo ? lo : n > hi ? hi : n
}

function parseHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback
}

function parseVec3(raw: unknown, fallback: [number, number, number], lo: number, hi: number): [number, number, number] {
  if (!Array.isArray(raw) || raw.length < 3) return [...fallback]
  return [
    clamp(raw[0], lo, hi, fallback[0]),
    clamp(raw[1], lo, hi, fallback[1]),
    clamp(raw[2], lo, hi, fallback[2]),
  ]
}

export function cloneJson<T>(v: T): T {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v) } catch { /* fallback below */ }
  }
  return JSON.parse(JSON.stringify(v)) as T
}

let idCounter = 1
export function makeItemId(prefix = 'item'): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 5)}`
}

export function defaultGroundSpec(overrides: Partial<AssemblyGroundSpec> = {}): AssemblyGroundSpec {
  return {
    style: 'diorama-path',
    size: 9.0,
    thickness: 0.14,
    grassColor: '#4eb349',
    grassHighlight: '#86d256',
    grassShadow: '#2b6f3e',
    pathLayout: 'birch-curve',
    pathColor: '#d9b97e',
    pathWidth: 1.0,
    seed: 2026,
    builtInTurf: false,
    ...overrides,
  }
}

export function blankAssemblyScene(name = '空白场景组装'): AssemblySceneSpec {
  return {
    version: 1,
    name,
    description: '自由摆放树木、灌木、花草与石头，实时预览组合效果',
    backdrop: 'ghibli',
    lighting: 'ghibli',
    wind: true,
    ground: defaultGroundSpec({ style: 'diorama-meadow', pathLayout: 'none', size: 10 }),
    cameraPreset: 'iso',
    items: [],
  }
}

export function inferCategoryFromTree(spec: TreeSpec): AssemblyCategory {
  if (spec.kind === 'botanical') {
    const mode = spec.botanical?.mode
    if (mode === 'hydrangea-shrub' || mode === 'cosmos-shrub' || mode === 'flower-groundcover') return 'flower'
    if (mode === 'rosette-shrub') return 'shrub'
    return 'grass'
  }
  if (spec.kind === 'grass' || spec.kind === 'fern') return 'grass'
  if (spec.kind === 'flowerbed' || spec.kind === 'lotus') return 'flower'
  if (spec.kind === 'bamboo') return 'tree'
  if (spec.kind === 'broadleaf') {
    const noLeaves = spec.leaves.leavesPerTwig <= 0 && spec.leaves.clumpFill <= 0 && spec.leaves.twigLength <= 0.01
    if (noLeaves) return 'deadwood'
    if (spec.trunk.height <= 2.3 && spec.crown.base <= 0.18) return 'shrub'
  }
  if (spec.kind === 'conifer' && spec.trunk.height <= 2.2) return 'shrub'
  return 'tree'
}

export function createTreeItem(
  spec: TreeSpec,
  opts: Partial<Omit<AssemblyItem, 'kind' | 'payload'>> = {},
): AssemblyItem {
  const cloned = cloneJson(spec)
  return {
    id: opts.id ?? makeItemId('tree'),
    name: opts.name ?? (cloned.name || '树木资产'),
    kind: 'tree',
    category: opts.category ?? inferCategoryFromTree(cloned),
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    position: opts.position ? [...opts.position] : [0, 0, 0],
    rotation: opts.rotation ? [...opts.rotation] : [0, 0, 0],
    scale: opts.scale ? [...opts.scale] : [1, 1, 1],
    ...(opts.barkStyle && opts.barkStyle !== 'default' ? { barkStyle: opts.barkStyle } : {}),
    ...(opts.crownStyle === 'painted' ? { crownStyle: opts.crownStyle } : {}),
    ...(opts.treeForm === 'meadow-birch' && cloned.kind === 'broadleaf' ? { treeForm: opts.treeForm } : {}),
    ...(opts.leafTexture && opts.leafTexture !== 'auto' ? { leafTexture: opts.leafTexture } : {}),
    ...(opts.customTextures ? { customTextures: cloneJson(opts.customTextures) } : {}),
    payload: cloned,
  }
}

export function createRockItem(
  spec: RockSpec,
  opts: Partial<Omit<AssemblyItem, 'kind' | 'payload'>> = {},
): AssemblyItem {
  const cloned = cloneJson(spec)
  return {
    id: opts.id ?? makeItemId('rock'),
    name: opts.name ?? (cloned.name || '风格化石头'),
    kind: 'rock',
    category: opts.category ?? 'rock',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    position: opts.position ? [...opts.position] : [0, 0, 0],
    rotation: opts.rotation ? [...opts.rotation] : [0, 0, 0],
    scale: opts.scale ? [...opts.scale] : [1, 1, 1],
    payload: cloned,
  }
}

export function defaultPolyCRockSpec(
  preset: PolyCsgPresetId = 'sandstone-ledge-c2',
  overrides: Partial<PolyCRockSpec> = {},
): PolyCRockSpec {
  const meta = polyCRockPresets[preset] ?? polyCRockPresets['sandstone-ledge-c2']
  return {
    version: 1,
    preset,
    name: meta.name,
    mode: 'shallow-detail',
    seed: meta.canonicalSeed,
    shoulderDepth: 1.0,
    bevelScale: 1.0,
    notchDepth: 1.0,
    strataStrength: 1.0,
    baseColor: preset === 'terraced-moss-bluff-c2' ? '#c69f7b' : '#caa57c',
    ...overrides,
  }
}

export function parsePolyCRockSpec(raw: unknown): PolyCRockSpec {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const preset: PolyCsgPresetId = typeof o.preset === 'string' && (polyCRockPresetIds as readonly string[]).includes(o.preset)
    ? (o.preset as PolyCsgPresetId)
    : 'sandstone-ledge-c2'
  const d = defaultPolyCRockSpec(preset)
  const mode: PolyPbrMode = o.mode === 'baseline' ? 'baseline' : 'shallow-detail'
  return {
    version: 1,
    preset,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 64) : d.name,
    mode,
    seed: Math.max(0, Math.round(clamp(o.seed as number, 0, 9999999, d.seed))),
    shoulderDepth: Number(clamp(o.shoulderDepth as number, 0.65, 1.35, d.shoulderDepth).toFixed(3)),
    bevelScale: Number(clamp(o.bevelScale as number, 0, 1.4, d.bevelScale).toFixed(3)),
    notchDepth: Number(clamp(o.notchDepth as number, 0.5, 1.4, d.notchDepth).toFixed(3)),
    strataStrength: Number(clamp(o.strataStrength as number, 0, 1.5, d.strataStrength).toFixed(3)),
    baseColor: parseHex(o.baseColor, d.baseColor),
  }
}

export function createRockC2Item(
  spec: PolyCRockSpec,
  opts: Partial<Omit<AssemblyItem, 'kind' | 'payload'>> = {},
): AssemblyItem {
  const parsed = parsePolyCRockSpec(spec)
  return {
    id: opts.id ?? makeItemId('rock-c2'),
    name: opts.name ?? parsed.name,
    kind: 'rock-c2',
    category: opts.category ?? 'rock',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    position: opts.position ? [...opts.position] : [0, 0, 0],
    rotation: opts.rotation ? [...opts.rotation] : [0, 0, 0],
    scale: opts.scale ? [...opts.scale] : [1, 1, 1],
    payload: parsed,
  }
}

export function createAiItem(
  scene: AiSceneSpec,
  opts: Partial<Omit<AssemblyItem, 'kind' | 'payload'>> = {},
): AssemblyItem {
  const cloned = cloneJson(scene)
  return {
    id: opts.id ?? makeItemId('ai'),
    name: opts.name ?? (cloned.name || 'AI 组合资产'),
    kind: 'ai',
    category: opts.category ?? 'scene',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    position: opts.position ? [...opts.position] : [0, 0, 0],
    rotation: opts.rotation ? [...opts.rotation] : [0, 0, 0],
    scale: opts.scale ? [...opts.scale] : [1, 1, 1],
    payload: cloned,
  }
}

export function parseAssemblyGround(raw: unknown): AssemblyGroundSpec {
  const d = defaultGroundSpec()
  if (!raw || typeof raw !== 'object') return d
  const g = raw as Record<string, unknown>
  return {
    style: VALID_GROUND_STYLES.has(g.style as GroundStyle) ? (g.style as GroundStyle) : d.style,
    size: clamp(g.size as number, 4, 28, d.size),
    thickness: clamp(g.thickness as number, 0.04, 0.8, d.thickness),
    grassColor: parseHex(g.grassColor, d.grassColor),
    grassHighlight: parseHex(g.grassHighlight, d.grassHighlight),
    grassShadow: parseHex(g.grassShadow, d.grassShadow),
    pathLayout: VALID_PATH_LAYOUTS.has(g.pathLayout as PathLayout) ? (g.pathLayout as PathLayout) : d.pathLayout,
    pathColor: parseHex(g.pathColor, d.pathColor),
    pathWidth: clamp(g.pathWidth as number, 0.25, 2.2, d.pathWidth),
    seed: Math.max(1, Math.round(clamp(g.seed as number, 1, 999999, d.seed))),
    builtInTurf: typeof g.builtInTurf === 'boolean' ? g.builtInTurf : false,
  }
}

export function parseAssemblyItem(raw: unknown): AssemblyItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const kind: AssemblyAssetKind | undefined =
    o.kind === 'tree' || o.kind === 'rock' || o.kind === 'rock-c2' || o.kind === 'ai' ? o.kind : undefined
  if (!kind || !o.payload || typeof o.payload !== 'object') return undefined
  try {
    const payload = kind === 'tree'
      ? parseTreeSpec(o.payload)
      : kind === 'rock'
        ? parseRockSpec(o.payload)
        : kind === 'rock-c2'
          ? parsePolyCRockSpec(o.payload)
          : parseAiScene(o.payload)
    const fallbackCat: AssemblyCategory =
      kind === 'rock' || kind === 'rock-c2' ? 'rock' : kind === 'ai' ? 'scene' : inferCategoryFromTree(payload as TreeSpec)
    const category: AssemblyCategory = VALID_CATEGORIES.has(o.category as AssemblyCategory)
      ? (o.category as AssemblyCategory)
      : fallbackCat
    const name = typeof o.name === 'string' && o.name.trim()
      ? o.name.trim().slice(0, 64)
      : (payload.name || '场景资产')
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 64) : makeItemId(kind)
    const barkStyle = VALID_BARK_STYLES.has(o.barkStyle as AssemblyBarkStyle)
      ? (o.barkStyle as AssemblyBarkStyle)
      : undefined
    const leafTexture = typeof o.leafTexture === 'string' && VALID_LEAF_SOURCES.has(o.leafTexture)
      ? (o.leafTexture as LeafTextureSource)
      : undefined
    const customTextures = parseSavedTextureMap(o.customTextures)
    return {
      id,
      name,
      kind,
      category,
      visible: typeof o.visible === 'boolean' ? o.visible : true,
      locked: typeof o.locked === 'boolean' ? o.locked : false,
      position: parseVec3(o.position, [0, 0, 0], -60, 60),
      rotation: parseVec3(o.rotation, [0, 0, 0], -360, 360),
      scale: parseVec3(o.scale, [1, 1, 1], 0.05, 12),
      ...(barkStyle && barkStyle !== 'default' ? { barkStyle } : {}),
      ...(kind === 'tree' && o.crownStyle === 'painted' ? { crownStyle: 'painted' as const } : {}),
      ...(kind === 'tree' && (payload as TreeSpec).kind === 'broadleaf' && o.treeForm === 'meadow-birch'
        ? { treeForm: 'meadow-birch' as const } : {}),
      ...(leafTexture && leafTexture !== 'auto' ? { leafTexture } : {}),
      ...(customTextures ? { customTextures } : {}),
      payload,
    }
  } catch {
    return undefined
  }
}

export function parseAssemblyReference(raw: unknown): AssemblyReferenceSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const src = typeof o.src === 'string' ? o.src.trim() : ''
  if (!src || src.length > 8_000_000 || !SAFE_REF_SRC_RE.test(src)) return undefined
  const mode = VALID_REF_MODES.has(o.mode as RefCompareMode) ? (o.mode as RefCompareMode) : 'wipe'
  return {
    src,
    ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim().slice(0, 80) } : {}),
    mode,
    opacity: clamp(o.opacity as number, 0.05, 1, 0.55),
    split: clamp(o.split as number, 0.02, 0.98, 0.5),
    scale: clamp(o.scale as number, 0.4, 2.5, 1),
    offsetX: clamp(o.offsetX as number, -60, 60, 0),
    offsetY: clamp(o.offsetY as number, -60, 60, 0),
  }
}

export function parseGrassPaint(raw: unknown): GrassPaintCluster[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: GrassPaintCluster[] = []
  const maxItems = Math.min(raw.length, 30000)
  for (let i = 0; i < maxItems; i++) {
    const entry = raw[i]
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const species = VALID_GRASS_SPECIES.has(e.species as GrassSpeciesId)
      ? (e.species as GrassSpeciesId)
      : 'broad'
    out.push({
      x: Number(clamp(e.x as number, -60, 60, 0).toFixed(3)),
      y: Number(clamp(e.y as number, -10, 20, 0).toFixed(3)),
      z: Number(clamp(e.z as number, -60, 60, 0).toFixed(3)),
      yaw: Number(clamp(e.yaw as number, -360, 360, 0).toFixed(1)),
      scale: Number(clamp(e.scale as number, 0.18, 3.5, 1).toFixed(3)),
      tiltX: Number(clamp(e.tiltX as number, -45, 45, 0).toFixed(1)),
      tiltZ: Number(clamp(e.tiltZ as number, -45, 45, 0).toFixed(1)),
      species,
      tint: parseHex(e.tint, '#ffffff'),
    })
  }
  return out.length > 0 ? out : undefined
}

export function parseGrassRvt(raw: unknown): GrassRvtSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const d = defaultGrassRvtSpec()
  return {
    mode: VALID_RVT_MODES.has(o.mode as GrassRvtMode) ? (o.mode as GrassRvtMode) : d.mode,
    strength: Number(clamp(o.strength as number, 0, 1, d.strength).toFixed(2)),
    fadeHeight: Number(clamp(o.fadeHeight as number, 0.05, 0.85, d.fadeHeight).toFixed(2)),
    normalBlend: Number(clamp(o.normalBlend as number, 0, 1, d.normalBlend).toFixed(2)),
    affectPlacedGrass: typeof o.affectPlacedGrass === 'boolean' ? o.affectPlacedGrass : d.affectPlacedGrass,
  }
}

export function parseAssemblyScene(raw: unknown): AssemblySceneSpec {
  const base = blankAssemblyScene()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const backdrop: BackdropTheme = VALID_BACKDROPS.has(o.backdrop as BackdropTheme)
    ? (o.backdrop as BackdropTheme)
    : base.backdrop
  const lighting: LightingPreset = typeof o.lighting === 'string' && VALID_LIGHTINGS.has(o.lighting)
    ? (o.lighting as LightingPreset)
    : backdropMeta[backdrop].lighting
  const rawItems = Array.isArray(o.items) ? o.items : []
  const items: AssemblyItem[] = []
  const seenIds = new Set<string>()
  for (const entry of rawItems) {
    const parsed = parseAssemblyItem(entry)
    if (!parsed) continue
    if (seenIds.has(parsed.id)) parsed.id = makeItemId(parsed.kind)
    seenIds.add(parsed.id)
    items.push(parsed)
  }
  const reference = parseAssemblyReference(o.reference)
  const grassPaint = parseGrassPaint(o.grassPaint)
  const groundPaint = typeof o.groundPaint === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(o.groundPaint) && o.groundPaint.length <= 6_000_000
    ? o.groundPaint
    : undefined
  const rvt = parseGrassRvt(o.rvt)
  return {
    version: 1,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : base.name,
    description: typeof o.description === 'string' ? o.description.trim().slice(0, 240) : '',
    backdrop,
    lighting,
    wind: typeof o.wind === 'boolean' ? o.wind : true,
    ground: parseAssemblyGround(o.ground),
    cameraPreset: VALID_CAMERAS.has(o.cameraPreset as AssemblyCameraPreset)
      ? (o.cameraPreset as AssemblyCameraPreset)
      : 'iso',
    ...(reference ? { reference } : {}),
    ...(grassPaint ? { grassPaint } : {}),
    ...(groundPaint ? { groundPaint } : {}),
    ...(rvt ? { rvt } : {}),
    items,
  }
}

/** Detects whether an arbitrary uploaded JSON file is a RockSpec, AiSceneSpec, TreeSpec, or AssemblySceneSpec. */
export function detectImportedAssetJson(raw: unknown):
  | { type: 'assembly'; scene: AssemblySceneSpec }
  | { type: 'item'; item: AssemblyItem } {
  if (!raw || typeof raw !== 'object') throw new Error('无效的 JSON 对象')
  const o = raw as Record<string, unknown>
  if (Array.isArray(o.items) && 'ground' in o) {
    return { type: 'assembly', scene: parseAssemblyScene(raw) }
  }
  if ('shape' in o && 'detail' in o && 'shading' in o && 'top' in o) {
    const rock = parseRockSpec(raw)
    return { type: 'item', item: createRockItem(rock, { name: rock.name }) }
  }
  if (typeof o.preset === 'string' && (polyCRockPresetIds as readonly string[]).includes(o.preset)) {
    const c2 = parsePolyCRockSpec(raw)
    return { type: 'item', item: createRockC2Item(c2, { name: c2.name }) }
  }
  if (Array.isArray(o.parts)) {
    const ai = parseAiScene(raw)
    return { type: 'item', item: createAiItem(ai, { name: ai.name }) }
  }
  if ('trunk' in o && 'crown' in o && 'leaves' in o) {
    const tree = parseTreeSpec(raw)
    return { type: 'item', item: createTreeItem(tree, { name: tree.name }) }
  }
  throw new Error('未能识别的资产 JSON（支持场景组装 JSON、树木 JSON、AI 场景 JSON、石头 .rock.json）')
}

// Scene Assembly Studio data model, schema validation, and item factory helpers.
// Supports unlimited independent trees, shrubs, flowers, grass, rocks, and multi-part AI scenes
// positioned freely on a configurable painterly diorama ground tile.
import { leafTextureSources, parseAiScene, type AiSceneSpec, type LeafTextureSource } from '../ai/scene'
import { parseRockSpec, type RockSpec } from '../rock/spec'
import { parseSavedTextureMap, type SavedTextureMap } from '../studio/texture-serialize'
import { parseTreeSpec, type TreeSpec } from '../tree/spec'
import { lightingPresets, type LightingPreset } from '../viewport'

export type AssemblyAssetKind = 'tree' | 'rock' | 'ai'
export type AssemblyCategory = 'tree' | 'deadwood' | 'shrub' | 'grass' | 'flower' | 'rock' | 'scene'
export type GroundStyle = 'diorama-path' | 'diorama-meadow' | 'studio' | 'none'
export type PathLayout = 'birch-curve' | 'boulder-trail' | 'straight' | 'none'
export type BackdropTheme = 'diorama-dark' | 'ghibli' | 'neutral' | 'forest' | 'sakura' | 'celestial'
export type AssemblyBarkStyle = 'default' | 'birch' | 'driftwood' | 'moss'
export type AssemblyCameraPreset = 'iso' | 'illustration' | 'front' | 'side' | 'top'

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
  payload: TreeSpec | RockSpec | AiSceneSpec
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
const HEX_RE = /^#[0-9a-fA-F]{6}$/

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
  if (spec.kind === 'grass' || spec.kind === 'fern') return 'grass'
  if (spec.kind === 'flowerbed') return 'flower'
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
  }
}

export function parseAssemblyItem(raw: unknown): AssemblyItem | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const kind: AssemblyAssetKind | undefined =
    o.kind === 'tree' || o.kind === 'rock' || o.kind === 'ai' ? o.kind : undefined
  if (!kind || !o.payload || typeof o.payload !== 'object') return undefined
  try {
    const payload = kind === 'tree'
      ? parseTreeSpec(o.payload)
      : kind === 'rock'
        ? parseRockSpec(o.payload)
        : parseAiScene(o.payload)
    const fallbackCat: AssemblyCategory =
      kind === 'rock' ? 'rock' : kind === 'ai' ? 'scene' : inferCategoryFromTree(payload as TreeSpec)
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

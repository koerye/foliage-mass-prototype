// Composable multi-part AI Scene specification & builder.
// Exposes 100% of Vegetation Studio's procedural generators, parameters, LOD,
// crown handles, and texture slots inside a blank-project canvas.
import { Group, MathUtils, type Texture } from 'three'
import { exportGlb, type ExportGlbOptions } from '../export-glb'
import { getPath, sections, setPath } from '../studio/panel'
import type { EditableTextureSlot } from '../studio/texture-slots'
import { buildTree, type TreeAsset, type TreeTextures, type View } from '../tree/assemble'
import { optimizeAt } from '../tree/optimize'
import {
  parseTreeSpec, presetIds, presetSpec, treeKinds,
  type OptimizeSpec, type PresetId, type TreeKind, type TreeSpec, type XYZ,
} from '../tree/spec'

export const leafTextureSources = ['auto', 'leaf', 'feathery', 'oak', 'oakAtlas', 'cloud', 'bush', 'sakura', 'maple', 'willow', 'flower', 'wildrose', 'blossom', 'needle', 'drape', 'palm', 'grass', 'grassTint', 'fern'] as const
export type LeafTextureSource = typeof leafTextureSources[number]

export const leafTextureLabels: Record<LeafTextureSource, string> = {
  auto: '自动（随植物类型/叶型）',
  leaf: '阔叶叶片',
  feathery: '羽叶细枝（高冠/盆景）',
  oak: '手绘厚涂橡叶叠簇',
  oakAtlas: '手绘厚涂橡叶 2×2 图集',
  cloud: '厚涂圆云叶（吉卜力）',
  bush: '翠绿尖叶灌木簇',
  sakura: '樱花柔瓣簇（缺口5瓣）',
  maple: '枫叶五角簇',
  willow: '垂柳细长丝',
  flower: '通用花簇',
  wildrose: '五瓣白野蔷薇',
  blossom: '单朵雏菊',
  needle: '松针叶形片',
  drape: '松针垂片',
  palm: '棕榈羽叶',
  grass: '草叶（绿）',
  grassTint: '草叶（自由染色）',
  fern: '蕨叶',
}

export interface AiPart {
  id: string
  label: string
  enabled: boolean
  position: XYZ
  rotationY: number
  scale: number
  leafTexture: LeafTextureSource
  spec: TreeSpec
}

export interface AiSceneSpec {
  schemaVersion: 1
  mode: 'ai-blank'
  name: string
  sourceImage?: string
  summary?: string
  parts: AiPart[]
}

export function blankAiScene(name = '空白植物工程'): AiSceneSpec {
  return { schemaVersion: 1, mode: 'ai-blank', name, parts: [] }
}

const defaultPresetForKind: Record<TreeKind, PresetId> = {
  broadleaf: 'broadleaf-round',
  conifer: 'conifer-standard',
  palm: 'palm-tropical',
  bamboo: 'bamboo-realistic',
  lotus: 'lotus-stemmed',
  grass: 'grass-clump',
  fern: 'fern',
  flowerbed: 'flowerbed-stemmed',
}

export function createAiPart(kind: TreeKind, label?: string, seed?: number): AiPart {
  const spec = presetSpec(defaultPresetForKind[kind], seed)
  return {
    id: 'part-' + Math.random().toString(36).slice(2, 8),
    label: label ?? spec.name,
    enabled: true,
    position: [0, 0, 0],
    rotationY: 0,
    scale: 1,
    leafTexture: 'auto',
    spec,
  }
}

export type EditScope = 'whole' | 'part'
export type PartCustomTextures = Map<string, Partial<Record<EditableTextureSlot, Texture>>>

function textureForSource(src: LeafTextureSource, textures: TreeTextures, part?: AiPart): Texture | undefined {
  if (src === 'auto') return undefined
  if (src === 'oak' && part && (part.spec.leaves.atlasCols > 1 || part.spec.leaves.atlasRows > 1)) {
    return textures.oakAtlas ?? textures.oak
  }
  return textures[src]
}

/** Lazy-safe texture override: layers per-part custom uploads + explicit leafTexture
 *  override via prototype inheritance so untouched lazy getters on `base` are never
 *  eagerly evaluated. */
function texturesForPart(
  part: AiPart,
  base: TreeTextures,
  customMap?: Partial<Record<EditableTextureSlot, Texture>>,
): TreeTextures {
  const hasCustom = Boolean(customMap && Object.values(customMap).some(Boolean))
  let effectiveBase = base
  if (hasCustom && customMap) {
    const layered = Object.create(base) as TreeTextures
    for (const [slot, tex] of Object.entries(customMap)) {
      if (tex) Object.defineProperty(layered, slot, { value: tex, enumerable: true, configurable: true })
    }
    effectiveBase = layered
  }
  const override = textureForSource(part.leafTexture, effectiveBase, part)
  if (!override) return effectiveBase
  const next = Object.create(effectiveBase) as TreeTextures
  const setOwn = (key: keyof TreeTextures) => Object.defineProperty(next, key, { value: override, enumerable: true, configurable: true })
  switch (part.spec.kind) {
    case 'broadleaf': setOwn('leaf'); break
    case 'conifer': setOwn('needle'); setOwn('drape'); break
    case 'palm': setOwn('palm'); break
    case 'bamboo': setOwn('bamboo'); break
    case 'lotus': setOwn('lotusLeaf'); break
    case 'grass': setOwn('grass'); break
    case 'fern': setOwn('fern'); break
    case 'flowerbed': setOwn('blossom'); break
  }
  return next
}

function effectiveSpecForPart(part: AiPart): TreeSpec {
  // If explicit leafTexture override is set on broadleaf, bypass shading.leafStyle so the override wins cleanly
  return part.leafTexture !== 'auto' && part.spec.kind === 'broadleaf'
    ? { ...part.spec, shading: { ...part.spec.shading, leafStyle: 'default' as const } }
    : part.spec
}

function applyPartTransformToGroup(group: Group, part: AiPart) {
  group.name = part.label || part.id
  group.position.set(part.position[0], part.position[1], part.position[2])
  group.rotation.y = MathUtils.degToRad(part.rotationY)
  group.scale.setScalar(Math.max(.05, part.scale))
}

export interface AiSceneStats {
  parts: number
  branches: number
  twigs: number
  leaves: number
  flowers: number
  triangles: number
  ms: number
}

export interface AiSceneAsset {
  group: Group
  stats: AiSceneStats
  partAssets: Map<string, TreeAsset>
  display(view: View): void
  updatePartTransform(part: AiPart, scene?: AiSceneSpec): boolean
  applyPartLiveParam(part: AiPart, path: string, scene?: AiSceneSpec): boolean
  rebuildPartWoodOnly(part: AiPart, textures: TreeTextures, scene?: AiSceneSpec, partTextures?: PartCustomTextures): boolean
  rebuildPart(part: AiPart, textures: TreeTextures, view: View, scene?: AiSceneSpec, partTextures?: PartCustomTextures): boolean
  exportGlb(options?: ExportGlbOptions): Promise<Blob>
  dispose(): void
}

export function buildAiScene(scene: AiSceneSpec, textures: TreeTextures, partTextures?: PartCustomTextures): AiSceneAsset {
  const started = performance.now()
  const group = new Group()
  group.name = 'Vegetation Studio AI / ' + scene.name
  group.userData.aiScene = scene
  const partAssets = new Map<string, TreeAsset>()
  const stats: AiSceneStats = { parts: 0, branches: 0, twigs: 0, leaves: 0, flowers: 0, triangles: 0, ms: 0 }

  const recomputeStats = (ms: number) => {
    stats.parts = 0
    stats.branches = 0
    stats.twigs = 0
    stats.leaves = 0
    stats.flowers = 0
    stats.triangles = 0
    for (const built of partAssets.values()) {
      stats.parts++
      stats.branches += built.stats.branches
      stats.twigs += built.stats.twigs
      stats.leaves += built.stats.leaves
      stats.flowers += built.stats.flowers
      stats.triangles += built.stats.triangles
    }
    stats.ms = Math.round(ms)
  }

  for (const part of scene.parts) {
    if (!part.enabled) continue
    const prev = partAssets.get(part.id)
    if (prev) {
      group.remove(prev.group)
      prev.dispose()
    }
    const built = buildTree(effectiveSpecForPart(part), texturesForPart(part, textures, partTextures?.get(part.id)))
    applyPartTransformToGroup(built.group, part)
    group.add(built.group)
    partAssets.set(part.id, built)
  }
  recomputeStats(performance.now() - started)

  return {
    group,
    stats,
    partAssets,
    display(view: View) {
      for (const asset of partAssets.values()) asset.display(view)
    },
    updatePartTransform(part: AiPart, nextScene?: AiSceneSpec): boolean {
      const built = partAssets.get(part.id)
      if (!built) return false
      applyPartTransformToGroup(built.group, part)
      if (nextScene) group.userData.aiScene = nextScene
      return true
    },
    applyPartLiveParam(part: AiPart, path: string, nextScene?: AiSceneSpec): boolean {
      const built = partAssets.get(part.id)
      if (!built) return false
      const ok = built.applyLiveParam(path, effectiveSpecForPart(part))
      if (ok && nextScene) group.userData.aiScene = nextScene
      return ok
    },
    rebuildPartWoodOnly(part: AiPart, nextTextures: TreeTextures, nextScene?: AiSceneSpec, nextPartTextures?: PartCustomTextures): boolean {
      if (!part.enabled) return false
      const built = partAssets.get(part.id)
      if (!built) return false
      const t0 = performance.now()
      const ok = built.rebuildWoodOnly(
        effectiveSpecForPart(part),
        texturesForPart(part, nextTextures, (nextPartTextures ?? partTextures)?.get(part.id)),
      )
      if (!ok) return false
      if (nextScene) group.userData.aiScene = nextScene
      recomputeStats(performance.now() - t0)
      return true
    },
    rebuildPart(part: AiPart, nextTextures: TreeTextures, view: View, nextScene?: AiSceneSpec, nextPartTextures?: PartCustomTextures): boolean {
      const old = partAssets.get(part.id)
      if (!part.enabled) {
        if (!old) return false
        group.remove(old.group)
        old.dispose()
        partAssets.delete(part.id)
        if (nextScene) group.userData.aiScene = nextScene
        recomputeStats(0)
        return true
      }
      if (!old) return false
      const t0 = performance.now()
      const next = buildTree(effectiveSpecForPart(part), texturesForPart(part, nextTextures, (nextPartTextures ?? partTextures)?.get(part.id)))
      applyPartTransformToGroup(next.group, part)
      next.display(view)
      const idx = group.children.indexOf(old.group)
      group.remove(old.group)
      group.add(next.group)
      if (idx >= 0 && idx < group.children.length - 1) {
        group.children.splice(idx, 0, group.children.pop()!)
      }
      old.dispose()
      partAssets.set(part.id, next)
      if (nextScene) group.userData.aiScene = nextScene
      recomputeStats(performance.now() - t0)
      return true
    },
    exportGlb: (options?: ExportGlbOptions) => exportGlb(group, options),
    dispose() {
      for (const asset of partAssets.values()) asset.dispose()
      partAssets.clear()
    },
  }
}

/** Accepts either an AiSceneSpec (schemaVersion 1) or a single TreeSpec (schemaVersion 2). */
export function parseAiScene(value: unknown): AiSceneSpec {
  if (typeof value !== 'object' || value === null) throw new Error('AI 场景配置必须是 JSON 对象')
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion === 2 && typeof raw.kind === 'string') {
    const spec = parseTreeSpec(raw)
    return {
      schemaVersion: 1,
      mode: 'ai-blank',
      name: spec.name,
      parts: [{
        id: 'part-1', label: spec.name, enabled: true,
        position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'auto', spec,
      }],
    }
  }
  if (!Array.isArray(raw.parts)) throw new Error('需要包含 parts 数组的 AI 场景配置，或 schemaVersion 2 单植物配置')
  const seenIds = new Set<string>()
  const parts: AiPart[] = raw.parts.map((entry, idx) => {
    const p = (entry ?? {}) as Record<string, unknown>
    const spec = parseTreeSpec(p.spec)
    const vec = Array.isArray(p.position) && p.position.length === 3 && p.position.every(n => typeof n === 'number' && Number.isFinite(n))
      ? p.position as XYZ : [0, 0, 0] as XYZ
    const tex = typeof p.leafTexture === 'string' && leafTextureSources.includes(p.leafTexture as LeafTextureSource)
      ? p.leafTexture as LeafTextureSource : 'auto'
    const baseId = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `part-${idx + 1}`
    let uniqueId = baseId
    if (seenIds.has(uniqueId)) {
      let suffix = 2
      while (seenIds.has(`${baseId}-${suffix}`)) suffix++
      uniqueId = `${baseId}-${suffix}`
    }
    seenIds.add(uniqueId)
    return {
      id: uniqueId,
      label: typeof p.label === 'string' && p.label ? p.label : spec.name,
      enabled: p.enabled !== false,
      position: vec,
      rotationY: typeof p.rotationY === 'number' && Number.isFinite(p.rotationY) ? p.rotationY : 0,
      scale: typeof p.scale === 'number' && Number.isFinite(p.scale) ? Math.max(.05, p.scale) : 1,
      leafTexture: tex,
      spec,
    }
  })
  return {
    schemaVersion: 1,
    mode: 'ai-blank',
    name: typeof raw.name === 'string' && raw.name ? raw.name : '导入的 AI 植物',
    sourceImage: typeof raw.sourceImage === 'string' ? raw.sourceImage : undefined,
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    parts,
  }
}

export interface SceneBudgetResult {
  optimize: OptimizeSpec
  before: number
  after: number
  reached: boolean
}

/** Binary-searches the lowest uniform optimization level across ALL enabled parts
 *  of a multi-part AI scene to meet a whole-tree triangle budget. */
export function solveSceneForTriangleBudget(
  scene: AiSceneSpec,
  textures: TreeTextures,
  target: number,
): SceneBudgetResult {
  const goal = Math.max(200, Math.round(target))
  const enabled = scene.parts.filter(p => p.enabled)
  if (!enabled.length) {
    return { optimize: optimizeAt(0, goal), before: 0, after: 0, reached: true }
  }
  const measureOpt = (opt: OptimizeSpec) => {
    let triangles = 0
    for (const part of enabled) {
      const built = buildTree(
        effectiveSpecForPart({ ...part, spec: { ...part.spec, optimize: opt } }),
        texturesForPart(part, textures),
      )
      triangles += built.stats.triangles
      built.dispose()
    }
    return { opt, triangles }
  }
  const base = measureOpt(optimizeAt(0, goal))
  if (base.triangles <= goal) {
    return { optimize: base.opt, before: base.triangles, after: base.triangles, reached: true }
  }
  const extremeOpt: OptimizeSpec = {
    level: 1, woodDetail: .2, cullHiddenWood: true, flatCards: true, cardReduction: .78, targetTriangles: goal,
  }
  const minPossible = measureOpt(extremeOpt)
  if (minPossible.triangles >= goal) {
    return { optimize: minPossible.opt, before: base.triangles, after: minPossible.triangles, reached: minPossible.triangles <= goal }
  }
  const lvl1 = measureOpt(optimizeAt(1, goal))
  if (lvl1.triangles > goal) {
    // Budget lies between standard level=1 and extreme (woodDetail 0.20, cardReduction 0.78)
    let lo = 0, hi = 1, best = minPossible
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) * .5
      const cur = measureOpt({
        level: 1,
        woodDetail: +(MathUtils.lerp(.24, .2, mid)).toFixed(2),
        cullHiddenWood: true,
        flatCards: true,
        cardReduction: +(MathUtils.lerp(.74, .78, mid)).toFixed(2),
        targetTriangles: goal,
      })
      if (cur.triangles <= goal) { best = cur; hi = mid }
      else lo = mid
    }
    return { optimize: best.opt, before: base.triangles, after: best.triangles, reached: true }
  }
  let lo = 0, hi = 1
  let best = lvl1
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) * .5
    const cur = measureOpt(optimizeAt(mid, goal))
    if (cur.triangles <= goal) {
      best = cur
      hi = mid
    } else {
      lo = mid
    }
  }
  return { optimize: best.opt, before: base.triangles, after: best.triangles, reached: true }
}

const fieldsByPath = new Map<string, { kinds?: TreeKind[]; field: (typeof sections)[number]['fields'][number] }[]>()
for (const sec of sections) {
  for (const f of sec.fields) {
    const list = fieldsByPath.get(f.path) ?? []
    list.push({ kinds: f.kinds ?? sec.kinds, field: f })
    fieldsByPath.set(f.path, list)
  }
}
function fieldForPart(path: string, kind: TreeKind) {
  const list = fieldsByPath.get(path)
  if (!list?.length) return undefined
  return (list.find(x => x.kinds?.includes(kind)) ?? list.find(x => !x.kinds) ?? list[0]).field
}
function snapToStep(v: number, step?: number): number {
  if (!step || step <= 0) return Number(v.toFixed(4))
  if (step >= 1) return Math.round(v / step) * step
  return Number(v.toFixed(4))
}

const stylePalettes: Record<string, [string, string]> = {
  default: ['#5c7a3c', '#f4ffd8'],
  cloud: ['#2f6e31', '#88d458'],
  sakura: ['#c44d74', '#fcb9d0'],
  maple: ['#9e1f1b', '#ff8a36'],
  oak: ['#3d7458', '#f2f79e'],
  willow: ['#4e7d36', '#d9f28a'],
  bush: ['#164f33', '#d6ff66'],
  flower: ['#d45c88', '#ffd2e4'],
}

/** Scale-sensitive geometry / density paths that sync proportionally across multi-part assets
 *  so large main crowns and smaller secondary boughs / shoulder mounds preserve their hierarchy. */
const PROPORTIONAL_PATHS = new Set([
  'trunk.height', 'trunk.radius', 'trunk.flareHeight',
  'crown.width',
  'branches.count', 'branches.perWhorl', 'branches.childCount',
  'leaves.leafSize', 'leaves.twigLength', 'leaves.twigFrequency', 'leaves.leavesPerTwig',
  'leaves.clumpFill', 'leaves.limbLeafFrequency',
  'flowers.count', 'flowers.clusterCount',
  'fronds.drop', 'fronds.width',
  'ground.count', 'ground.length', 'ground.width', 'ground.spread',
  'palm.frondCount', 'palm.frondLength', 'palm.frondWidth',
  'flowerbed.count', 'flowerbed.spread', 'flowerbed.height',
  'flowerbed.stemRadius', 'flowerbed.stemLeafSize', 'flowerbed.flowerSize',
])

/** Signed / offset shape paths that shift by the same delta across multi-part peers. */
const DELTA_PATHS = new Set([
  'trunk.wobble', 'trunk.lean', 'trunk.gnarl', 'trunk.taper', 'trunk.flare',
  'crown.base', 'crown.top', 'crown.depth', 'crown.roundness', 'crown.topBias',
  'crown.coneShape', 'crown.irregularity', 'crown.canopyLift', 'crown.padFlatten',
  'branches.startHeight', 'branches.heightSpan', 'branches.azimuthOffset',
  'branches.angle', 'branches.angleTop', 'branches.reach', 'branches.curvature',
  'branches.droop', 'branches.tipCurl', 'branches.radiusRatio',
  'branches.childStart', 'branches.childAngle', 'branches.childLength', 'branches.childDroop',
  'branches.offsetX', 'branches.offsetY', 'branches.offsetZ',
])

const WOODY_KINDS = new Set<TreeKind>(['broadleaf', 'conifer', 'palm'])
const BARK_STYLE_PATHS = new Set([
  'trunk.barkColor', 'trunk.barkScale', 'trunk.barkDetail', 'trunk.barkTint',
  'trunk.barkMoss', 'trunk.barkMossColor', 'trunk.barkRootAO',
  'trunk.barkRidges', 'trunk.barkDepth',
])

/** Parts affected by a parameter edit under the given scope ('whole' = default entire plant sync; 'part' = single-part edit). */
export function wholeSyncTargets(scene: AiSceneSpec, lead: AiPart, path: string, scope: EditScope): AiPart[] {
  if (scope === 'part') return [lead]
  if (path.startsWith('optimize.')) return [...scene.parts]
  if (path.startsWith('accents.')) {
    const owner = scene.parts.find(p => p.spec.shading.accent === 'wishing')
    return [owner ?? lead]
  }
  if (path.startsWith('normalEdit.')) {
    const sameKind = scene.parts.filter(p => p.spec.kind === lead.spec.kind)
    return sameKind.length ? sameKind : [lead]
  }
  if (path.startsWith('shading.') && path !== 'shading.leafStyle') return [...scene.parts]
  if (BARK_STYLE_PATHS.has(path) || path === 'trunk.sculpt' || path.startsWith('trunk.sculpt.')) {
    const woody = scene.parts.filter(p => WOODY_KINDS.has(p.spec.kind))
    return woody.length ? woody : [lead]
  }
  if (path === 'shading.leafStyle' || path.startsWith('leaves.')) {
    const broad = scene.parts.filter(p => p.spec.kind === 'broadleaf')
    return broad.length ? broad : [lead]
  }
  if (path.startsWith('fronds.')) return scene.parts.filter(p => p.spec.kind === 'conifer')
  if (path.startsWith('palm.')) return scene.parts.filter(p => p.spec.kind === 'palm')
  if (path.startsWith('bamboo.')) return scene.parts.filter(p => p.spec.kind === 'bamboo')
  if (path.startsWith('lotus.')) return scene.parts.filter(p => p.spec.kind === 'lotus')
  if (path.startsWith('flowerbed.')) return scene.parts.filter(p => p.spec.kind === 'flowerbed')
  // ground.*, flowers.*, trunk.* (non-bark), crown.*, branches.* sync across all parts sharing the lead kind
  const sameKind = scene.parts.filter(p => p.spec.kind === lead.spec.kind)
  return sameKind.length ? sameKind : [lead]
}

/** Apply any inspector parameter to either the whole multi-part plant (default) or a single edited part. */
export function applySceneParam(
  scene: AiSceneSpec,
  leadPartId: string,
  path: string,
  value: unknown,
  scope: EditScope = 'whole',
): { changedIds: string[]; needsPanelSync: boolean } {
  const lead = scene.parts.find(p => p.id === leadPartId) ?? scene.parts[0]
  if (!lead) return { changedIds: [], needsPanelSync: false }
  const targets = wholeSyncTargets(scene, lead, path, scope)
  const changedIds: string[] = []
  let needsPanelSync = false

  if (path === 'optimize.level') {
    const lv = Number(value)
    for (const part of targets) {
      part.spec = { ...part.spec, optimize: optimizeAt(lv, part.spec.optimize.targetTriangles) }
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync: true }
  }

  if (path === 'shading.petals' && scope === 'whole') {
    const n = Math.max(0, Math.round(Number(value) || 0))
    for (const part of targets) {
      part.spec = setPath(part.spec, path, part.id === lead.id ? n : 0)
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync: false }
  }

  if (path === 'shading.accent' && scope === 'whole') {
    const nextAcc = String(value)
    const owner = scene.parts.find(p => p.spec.shading.accent === 'wishing') ?? lead
    for (const part of targets) {
      part.spec = setPath(part.spec, path, part.id === owner.id ? nextAcc : 'none')
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync: false }
  }

  if (path === 'trunk.sculpt') {
    for (const part of targets) {
      part.spec = setPath(part.spec, path, value)
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync: true }
  }

  if (path.startsWith('accents.')) {
    for (const part of targets) {
      let nextSpec = setPath(part.spec, path, value)
      if (nextSpec.shading.accent !== 'wishing') {
        nextSpec = setPath(nextSpec, 'shading.accent', 'wishing')
        needsPanelSync = true
      }
      part.spec = nextSpec
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync }
  }

  if (path === 'shading.leafStyle') {
    const nextStyle = String(value)
    const pal = stylePalettes[nextStyle]
    const nextAtlas = nextStyle === 'oak' ? 2 : 1
    for (const part of targets) {
      let nextSpec = setPath(part.spec, path, nextStyle)
      if (part.spec.kind === 'broadleaf') {
        // Clear explicit leafTexture override so the chosen built-in leafStyle takes immediate effect
        part.leafTexture = 'auto'
        if (pal) {
          const nextCard = nextStyle === 'willow'
            ? 'drape' as const
            : nextSpec.leaves.cardType === 'drape' ? 'quad' as const : nextSpec.leaves.cardType
          nextSpec = {
            ...nextSpec,
            leaves: {
              ...nextSpec.leaves,
              tintInner: pal[0],
              tintOuter: pal[1],
              cardType: nextCard,
              atlasCols: nextAtlas,
              atlasRows: nextAtlas,
              atlasRegions: undefined,
            },
          }
        } else if (nextSpec.leaves.atlasRegions?.length) {
          nextSpec = { ...nextSpec, leaves: { ...nextSpec.leaves, atlasRegions: undefined } }
        }
      }
      part.spec = nextSpec
      changedIds.push(part.id)
    }
    return { changedIds, needsPanelSync: true }
  }

  const prevLead = getPath(lead.spec, path)
  const isProportional = scope === 'whole' && PROPORTIONAL_PATHS.has(path)
  const isDelta = scope === 'whole' && DELTA_PATHS.has(path)

  for (const part of targets) {
    let nextVal: unknown = value
    if (part.id !== lead.id && typeof value === 'number' && typeof prevLead === 'number') {
      const otherPrev = getPath(part.spec, path)
      const partField = fieldForPart(path, part.spec.kind)
      if (typeof otherPrev === 'number') {
        const lo = partField?.min !== undefined ? Math.min(partField.min, otherPrev) : -Infinity
        const hi = partField?.max !== undefined ? Math.max(partField.max, otherPrev) : Infinity
        if (isProportional) {
          if (value <= 0) nextVal = 0
          else if (otherPrev <= 1e-4) nextVal = 0
          else if (prevLead > 1e-4) nextVal = MathUtils.clamp(otherPrev * (value / prevLead), Math.max(lo, 1e-4), hi)
          else nextVal = MathUtils.clamp(value, lo, hi)
        } else if (isDelta) {
          nextVal = MathUtils.clamp(otherPrev + (value - prevLead), lo, hi)
        }
        if (typeof nextVal === 'number') nextVal = snapToStep(nextVal, partField?.step)
      }
    }
    part.spec = setPath(part.spec, path, nextVal)
    changedIds.push(part.id)
  }
  return { changedIds, needsPanelSync }
}

/** Sync leafTexture source dropdown across all matching parts in whole mode, or only the selected part in edit mode. */
export function applySceneLeafTexture(
  scene: AiSceneSpec,
  leadPartId: string,
  src: LeafTextureSource,
  scope: EditScope = 'whole',
): string[] {
  const lead = scene.parts.find(p => p.id === leadPartId) ?? scene.parts[0]
  if (!lead) return []
  const targets = scope === 'part' ? [lead] : scene.parts.filter(p => p.spec.kind === lead.spec.kind)
  for (const p of targets) {
    p.leafTexture = src
    if (p.spec.kind === 'broadleaf') {
      if (src === 'oakAtlas') {
        p.spec = { ...p.spec, leaves: { ...p.spec.leaves, atlasCols: 2, atlasRows: 2, atlasRegions: undefined } }
      } else if (src !== 'oak' && src !== 'auto' && (p.spec.leaves.atlasCols !== 1 || p.spec.leaves.atlasRows !== 1 || p.spec.leaves.atlasRegions?.length)) {
        p.spec = { ...p.spec, leaves: { ...p.spec.leaves, atlasCols: 1, atlasRows: 1, atlasRegions: undefined } }
      } else if (p.spec.leaves.atlasRegions?.length) {
        p.spec = { ...p.spec, leaves: { ...p.spec.leaves, atlasRegions: undefined } }
      }
    }
  }
  return targets.map(p => p.id)
}

/** Sync seed change across all parts (preserving distinct per-part offsets) in whole mode, or only lead in edit mode. */
export function applySceneSeed(
  scene: AiSceneSpec,
  leadPartId: string,
  nextSeed: number,
  scope: EditScope = 'whole',
): string[] {
  const lead = scene.parts.find(p => p.id === leadPartId) ?? scene.parts[0]
  if (!lead) return []
  const clean = Math.max(0, Math.round(nextSeed))
  if (scope === 'part') {
    lead.spec = { ...lead.spec, seed: clean }
    return [lead.id]
  }
  const delta = clean - lead.spec.seed
  for (const p of scene.parts) {
    const s = p.id === lead.id ? clean : Math.max(0, p.spec.seed + delta)
    p.spec = { ...p.spec, seed: s }
  }
  return scene.parts.map(p => p.id)
}

/** Scale entire multi-part assembly uniformly around world origin in whole mode, or only lead in edit mode. */
export function applySceneUniformScale(
  scene: AiSceneSpec,
  leadPartId: string,
  nextScale: number,
  scope: EditScope = 'whole',
): string[] {
  const lead = scene.parts.find(p => p.id === leadPartId) ?? scene.parts[0]
  if (!lead) return []
  const clamped = Math.max(.05, nextScale)
  if (scope === 'part') {
    lead.scale = clamped
    return [lead.id]
  }
  const ratio = clamped / Math.max(.05, lead.scale)
  for (const p of scene.parts) {
    p.scale = Number(Math.max(.05, p.id === lead.id ? clamped : p.scale * ratio).toFixed(4))
    p.position = [
      Number((p.position[0] * ratio).toFixed(4)),
      Number((p.position[1] * ratio).toFixed(4)),
      Number((p.position[2] * ratio).toFixed(4)),
    ]
  }
  return scene.parts.map(p => p.id)
}

/** Machine-readable manifest exposing every plant kind, preset, texture slot, and parameter range
 *  to external Vision LLMs or automation agents. */
export function aiCapabilitySchema() {
  return {
    engine: 'Vegetation Studio v2 (Procedural Parametric Foliage Engine)',
    sceneFormat: {
      schemaVersion: 1,
      mode: 'ai-blank',
      name: 'string',
      parts: [{
        id: 'string',
        label: 'string',
        enabled: true,
        position: ['x (m)', 'y (m)', 'z (m)'],
        rotationY: 'degrees',
        scale: 'number (>0)',
        leafTexture: [...leafTextureSources],
        spec: 'TreeSpec (schemaVersion: 2)',
      }],
    },
    kinds: [...treeKinds],
    presets: [...presetIds],
    textureSources: leafTextureLabels,
    parameters: sections.map(sec => ({
      section: sec.title,
      kinds: sec.kinds ?? [...treeKinds],
      fields: sec.fields.map(f => ({
        path: f.path,
        label: f.label,
        type: f.type ?? 'range',
        min: f.min,
        max: f.max,
        step: f.step,
        options: f.options,
        hint: f.hint,
      })),
    })),
    handles: {
      shape: '{ id, kind: "shape", anchor: [x,y,z], offset: [dx,dy,dz], radius } — deforms crown silhouette and branches',
      bare: '{ id, kind: "bare", anchor: [x,y,z], offset: [0,0,0], radius } — carves foliage-free gaps exposing branches',
      customTrunkSpine: 'trunk.spine?: [x,y,z][] — optional 3D trunk centerline points from root [0,0,0] to crown fork (auto-extracted from photo medial axis)',
      branchEdits: 'branchEdits?: { id, lengthScale?, radiusScale?, pitchDelta?, yawDelta?, gravityDelta?, socketDelta?, offset?, spineOffsets?, pruned?, bare? }[] — SpeedTree-style per-branch node overrides (including parent-spline socket sliding & free 3D root offset) with parent-to-child propagation',
    },
  }
}

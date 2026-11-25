// Curated reusable diorama assets & built-in Scene Assembly Showcase Case:
//   1. 林间白桦孤树地块 (birch-meadow — updated to user's saved customized scene)
import { rockPresetSpec, type RockSpec } from '../rock/spec'
import { presetSpec, type TreeSpec } from '../tree/spec'
import case1BirchMeadowRaw from './case1-birch-meadow.json'
import {
  createRockItem, createTreeItem, parseAssemblyScene,
  type AssemblyCategory, type AssemblyItem, type AssemblySceneSpec,
} from './spec'

export interface CuratedAssetTemplate {
  id: string
  name: string
  subtitle: string
  category: AssemblyCategory
  create: () => AssemblyItem
}

export interface BuiltInAssemblyCase {
  id: string
  name: string
  subtitle: string
  tag: string
  thumbnail?: string
  build: () => AssemblySceneSpec
}

// ============================================================================
// Reusable Stylized Assets (Ref 1 & Ref 2)
// ============================================================================

/** Ref 1 Hero Tree: tall open-crowned woodland broadleaf with bright birch-white lower trunk,
 *  visible dark mossy Y-fork branches, and 4-lobe sunlit Ghibli emerald cloud clusters. */
export function makeBirchHeroTreeSpec(seed = 4108): TreeSpec {
  const s = presetSpec('broadleaf-open', seed)
  s.name = '林间白桦孤树'
  s.trunk = {
    ...s.trunk,
    height: 7.35,
    radius: .235,
    taper: 1.15,
    flare: .29,
    flareHeight: 0.68,
    gnarl: 0.26,
    surfaceRoots: 0,
    lean: .18,
    wobble: .12,
    barkColor: '#4a5747',
    barkStyle: 'birch',
    treeForm: 'meadow-birch',
    barkScale: 1.05,
    barkDetail: 0.72,
    barkMoss: 0.47,
    barkMossColor: '#5ea142',
    barkRootAO: 0.06,
    forkHeight: .46,
    spine: [
      [0, 0, 0],
      [-0.03, 0.72, 0.02],
      [-0.08, 1.52, 0.04],
      [-0.12, 2.38, 0.03],
      [-.17, 3.25, -.02],
      [-.24, 4.15, .06],
    ],
  }
  s.crown = {
    base: .46,
    top: 1.0,
    width: 1.98,
    depth: 0.88,
    roundness: 2.25,
    topBias: 1.22,
    coneShape: 1.08,
    irregularity: 0.42,
    canopyLift: 0.08,
    padFlatten: 0.31,
  }
  s.branches = {
    ...s.branches,
    count: 5,
    startHeight: 0.48,
    heightSpan: 0.50,
    azimuthOffset: 18,
    angle: 34,
    angleTop: 70,
    reach: 1.06,
    lengthVariance: 0.26,
    curvature: 0.34,
    droop: 0.08,
    radiusRatio: .76,
    childCount: 2,
    childStart: 0.42,
    childAngle: 46,
    childLength: 0.4,
    childDroop: 0.06,
    deadCount: 1,
  }
  s.leaves = {
    ...s.leaves,
    cardType: 'cross',
    leafSize: .73,
    leafSizeVariance: 0.26,
    leafAspect: 1.04,
    leafPivot: 0.50,
    twigFrequency: 2.1,
    twigStart: 0.42,
    twigEnd: 1.0,
    twigLength: 0.46,
    leavesPerTwig: 5,
    tipLeaves: 2,
    limbLeafFrequency: 0.65,
    clumpFill: 7.4,
    clumpFillScale: 1.0,
    clumpFillDepth: 0.44,
    clumpScale: .96,
    pruneOuter: 1.35,
    pruneInner: 0,
    faceOutward: 0.78,
    upAlign: 0.14,
    randomRoll: 55,
    randomTilt: 24,
    leafFold: 0.22,
    leafCurl: -0.10,
    normalSource: 'clumps',
    normalSpherize: 0.90,
    tintInner: '#3a5647',
    tintOuter: '#70bb5a',
    tintVariance: 0.09,
    aoStrength: 0.25,
    alphaCutoff: 0.40,
    leafSeed: seed + 17,
  }
  s.shading = {
    ...s.shading,
    leafStyle: 'painted',
    colorMass: 0.98,
    translucency: 0.20,
    rimLight: 0.12,
    shadowShift: 0.38,
    topWarmth: 0.32,
    softSelfShadow: true,
    petals: 0,
  }
  // A small lift at the tip and the two exposed sides stagger the paint masses.
  s.handles = [
    { id: 1, kind: 'shape', anchor: [-.42, 6.95, -.35], offset: [-.08, .17, .04], radius: 1.45 },
    { id: 2, kind: 'shape', anchor: [-1.65, 5.7, -.18], offset: [-.12, .07, .13], radius: 1.20 },
    { id: 3, kind: 'shape', anchor: [.91, 4.22, .30], offset: [.08, .04, .02], radius: 1.15 },
  ]
  return s
}

/** Ref 2 Hero Deadwood Snag: zero-leaf gaunt split trunk with sharp angular dry forks. */
export function makeDeadSnagSpec(seed = 7321, tall = true): TreeSpec {
  const s = presetSpec('broadleaf-open', seed)
  s.name = tall ? '枯木分叉残桩' : '斜伸矮枯枝'
  s.trunk = {
    ...s.trunk,
    height: tall ? 3.15 : 1.85,
    radius: tall ? .26 : .11,
    taper: .72,
    flare: tall ? 0.45 : 0.24,
    flareHeight: 0.44,
    gnarl: 0.48,
    surfaceRoots: tall ? 3 : 0,
    barkColor: '#796653',
    barkScale: 1.25,
    barkDetail: 0.85,
    barkMoss: 0.08,
    barkRootAO: 0.32,
    forkHeight: 0.38,
  }
  s.crown = {
    base: 0.38,
    top: 1.0,
    width: tall ? 1.55 : 1.15,
    depth: 0.82,
    roundness: 1.6,
    topBias: 1.0,
    coneShape: 1.0,
    irregularity: 0.55,
    canopyLift: 0.3,
    padFlatten: 0.0,
  }
  s.branches = {
    ...s.branches,
    count: tall ? 5 : 3,
    startHeight: 0.36,
    heightSpan: 0.56,
    azimuthOffset: tall ? 24 : 58,
    angle: 34,
    angleTop: 56,
    reach: 0.96,
    lengthVariance: 0.34,
    curvature: 0.32,
    droop: -0.05,
    radiusRatio: 0.54,
    childCount: 0,
    childStart: 0.44,
    childAngle: 42,
    childLength: 0.52,
    childDroop: -0.06,
    deadCount: tall ? 1 : 0,
  }
  // Zero leaves -> pure crisp deadwood skeleton!
  s.leaves = {
    ...s.leaves,
    twigFrequency: 0,
    twigLength: 0.05,
    leavesPerTwig: 0,
    tipLeaves: 0,
    limbLeafFrequency: 0,
    clumpFill: 0,
  }
  s.shading = {
    ...s.shading,
    petals: 0,
  }
  return s
}

/** Lush stylized shrub (variant: 'deep-forest' for Ref 1 backdrop or 'ghibli-lime' for Ref 2 hero bush). */
export function makeDioramaShrubSpec(variant: 'deep-forest' | 'ghibli-lime', seed = 2241): TreeSpec {
  const s = presetSpec('shrub-round', seed)
  const isDeep = variant === 'deep-forest'
  s.name = isDeep ? '林下暗绿灌丛' : '岩前鲜绿灌木丛'
  s.trunk = {
    ...s.trunk,
    height: isDeep ? 1.38 : 1.58,
    radius: 0.055,
    flare: 0.20,
    barkColor: '#4e4234',
  }
  s.crown = {
    ...s.crown,
    base: 0.05,
    top: 1.0,
    width: isDeep ? 1.25 : 1.38,
    depth: 0.92,
    roundness: 2.15,
    topBias: 1.15,
    irregularity: 0.42,
    canopyLift: 0.14,
    padFlatten: 0.22,
  }
  s.branches = {
    ...s.branches,
    count: 6,
    childCount: 2,
    angle: 38,
    angleTop: 64,
  }
  s.leaves = {
    ...s.leaves,
    cardType: 'cross',
    leafSize: isDeep ? 0.56 : 0.62,
    leafSizeVariance: 0.28,
    leafPivot: 0.22,
    twigFrequency: 4.0,
    twigLength: 0.34,
    leavesPerTwig: 5,
    pruneOuter: 1.32,
    pruneInner: 0,
    clumpFill: isDeep ? 6.8 : 7.4,
    clumpFillScale: 1.18,
    clumpFillDepth: 0.48,
    clumpScale: 1.05,
    normalSource: 'clumps',
    normalSpherize: 0.88,
    tintInner: isDeep ? '#263e36' : '#254a2f',
    tintOuter: isDeep ? '#4f7c54' : '#7eb04e',
    tintVariance: 0.14,
    aoStrength: 0.32,
    alphaCutoff: 0.40,
    leafSeed: seed + 9,
  }
  s.shading = {
    ...s.shading,
    leafStyle: 'bush',
    translucency: isDeep ? 0.22 : 0.38,
    rimLight: isDeep ? 0.20 : 0.34,
    shadowShift: isDeep ? 0.55 : 0.32,
    topWarmth: isDeep ? 0.22 : 0.48,
    softSelfShadow: true,
    petals: 0,
  }
  return s
}

/** Ref 1 Pale Cool-Gray Faceted Boulder (sharp planar faces, bright cool top, soft teal-gray shadow). */
export function makePaleMeadowBoulderSpec(seed = 5012, flat = false): RockSpec {
  const r = rockPresetSpec('boulder-slab')
  r.seed = seed
  r.name = flat ? '路边冷灰踏石板' : '冷灰白切面主石'
  r.style = 'painterly'
  r.shape = {
    width: flat ? 1.35 : 1.62,
    height: flat ? 0.26 : 0.84,
    depth: flat ? 0.96 : 1.18,
    facetCount: flat ? 10 : 12,
    flatness: flat ? 0.88 : 0.78,
    bevel: 0.042,
    asymmetry: 0.48,
    taperTop: flat ? 0.08 : 0.24,
    bottomFlat: 0.92,
  }
  r.detail = {
    subdivisions: 1,
    chisel: 0.22,
    undulation: 0.16,
    cracks: 0.14,
    sharpness: 0.78,
  }
  r.shading = {
    baseColor: '#b3c3b9',
    shadowColor: '#526c5c',
    edgeColor: '#f5f8f9',
    edgeWear: 0.44,
    edgeBreakup: 0.34,
    cavityAO: .46,
    facetVariation: 0.36,
    roughness: 0.86,
    grain: 0.16,
  }
  r.top = { mode: 'none', color: '#cbb67b', coverage: 0, softness: 0.2 }
  r.cluster = { count: 1, spread: 0.8, scaleDecay: 0.5 }
  return r
}

/** Ref 2 Heavy Blocky Warm-Gray Monolith Boulder (crisp stratified planes, sculpted cracks). */
export function makeWarmMonolithRockSpec(
  seed = 8401,
  variant: 'monolith' | 'slab' | 'accent' = 'monolith',
): RockSpec {
  const r = rockPresetSpec('boulder-chiseled')
  r.seed = seed
  r.name = variant === 'monolith' ? '方正暖灰主巨岩' : variant === 'slab' ? '草径长扁石板' : '灰褐草地配石'
  r.style = 'painterly'
  r.shape = variant === 'monolith'
    ? {
        width: 2.55,
        height: 1.68,
        depth: 2.15,
        facetCount: 9,
        flatness: 0.86,
        bevel: 0.045,
        asymmetry: 0.38,
        taperTop: 0.16,
        bottomFlat: 0.94,
      }
    : variant === 'slab'
      ? {
          width: 1.68,
          height: 0.52,
          depth: 0.96,
          facetCount: 10,
          flatness: 0.84,
          bevel: 0.04,
          asymmetry: 0.44,
          taperTop: 0.14,
          bottomFlat: 0.92,
        }
      : {
          width: 1.05,
          height: 0.58,
          depth: 0.82,
          facetCount: 11,
          flatness: 0.74,
          bevel: 0.05,
          asymmetry: 0.52,
          taperTop: 0.22,
          bottomFlat: 0.88,
        }
  r.detail = {
    subdivisions: variant === 'monolith' ? 2 : 1,
    chisel: 0.36,
    undulation: 0.22,
    cracks: variant === 'monolith' ? 0.52 : 0.34,
    sharpness: 0.82,
  }
  r.shading = {
    baseColor: '#a9a699',
    shadowColor: '#5c5c55',
    edgeColor: '#d4d2c7',
    edgeWear: 0.46,
    edgeBreakup: 0.40,
    cavityAO: 0.48,
    facetVariation: 0.42,
    roughness: 0.90,
    grain: 0.34,
  }
  r.top = { mode: 'none', color: '#8f9e52', coverage: 0, softness: 0.25 }
  r.cluster = { count: 1, spread: 0.9, scaleDecay: 0.55 }
  return r
}

/** Stylized painterly grass clump (for tucking around tree roots, boulder bases & path borders). */
export function makeMeadowGrassSpec(seed = 3102, lush = true): TreeSpec {
  const s = presetSpec('grass-clump', seed)
  s.name = lush ? '翠绿林间细草簇' : '路缘短草簇'
  s.ground = {
    ...s.ground,
    mode: 'blade',
    count: lush ? 56 : 38,
    length: lush ? .34 : .26,
    lengthVariance: 0.46,
    width: 0.055,
    spread: lush ? 0.68 : 0.54,
    lean: 28,
    arch: 0.36,
    tintBase: '#276d38',
    tintTip: '#8be05c',
    tintVariance: 0.16,
    aoStrength: 0.18,
  }
  return s
}

/** Stylized meadow wildflower cluster (white daisies or warm yellow buttercups, with alpha stem leaves). */
export function makeMeadowFlowersSpec(
  variant: 'tall-white' | 'low-white' | 'low-yellow',
  seed = 6201,
  count = 18,
  spread = 0.85,
): TreeSpec {
  const s = presetSpec('flowerbed-stemmed', seed)
  const isTall = variant === 'tall-white'
  const isYellow = variant === 'low-yellow'
  s.name = isTall ? '高茎野白花簇' : isYellow ? '草径小黄花簇' : '野白花带'
  s.flowerbed = {
    ...s.flowerbed,
    withStems: true,
    layout: 'cluster',
    count,
    spread,
    height: isTall ? 0.44 : isYellow ? 0.11 : 0.16,
    heightVariance: 0.42,
    lean: 22,
    bend: 0.28,
    stemRadius: isTall ? 0.011 : 0.0085,
    stemLeaves: isTall ? 2 : 1,
    stemLeafSize: isTall ? 0.13 : 0.09,
    flowerSize: isTall ? 0.14 : isYellow ? 0.105 : 0.115,
    flowerSizeVariance: 0.32,
    headTilt: 32,
    tintInner: isYellow ? '#f5b828' : '#e6efe4',
    tintOuter: isYellow ? '#fff068' : '#ffffff',
    stemTint: isTall ? '#2f7240' : '#409146',
    tintVariance: 0.08,
    alphaCutoff: 0.38,
  }
  s.shading = {
    ...s.shading,
    petals: 0,
  }
  return s
}

// ============================================================================
// Reusable Asset Palette Catalog (available for unlimited placement in Assembly Studio)
// ============================================================================

export const curatedAssemblyAssets: CuratedAssetTemplate[] = [
  {
    id: 'curated-birch-hero',
    name: '林间白桦孤树',
    subtitle: '参考图1主树 · 灰白下干 Y 叉翠绿云冠',
    category: 'tree',
    create: () => createTreeItem(makeBirchHeroTreeSpec(4108), {
      name: '林间白桦孤树',
      category: 'tree',
      barkStyle: 'birch',
      treeForm: 'meadow-birch',
    }),
  },
  {
    id: 'curated-dead-snag',
    name: '枯木分叉残桩',
    subtitle: '参考图2枯木 · 无叶硬朗分叉树桩',
    category: 'deadwood',
    create: () => createTreeItem(makeDeadSnagSpec(7321, true), {
      name: '枯木分叉残桩',
      category: 'deadwood',
    }),
  },
  {
    id: 'curated-dead-twig',
    name: '斜伸矮枯枝',
    subtitle: '参考图2配景 · 纤细斜出枯枝',
    category: 'deadwood',
    create: () => createTreeItem(makeDeadSnagSpec(7399, false), {
      name: '斜伸矮枯枝',
      category: 'deadwood',
    }),
  },
  {
    id: 'curated-ghibli-shrub',
    name: '岩前鲜绿灌木丛',
    subtitle: '参考图2灌木 · 亮黄绿吉卜力蓬松灌丛',
    category: 'shrub',
    create: () => createTreeItem(makeDioramaShrubSpec('ghibli-lime', 2241), {
      name: '岩前鲜绿灌木丛',
      category: 'shrub',
    }),
  },
  {
    id: 'curated-forest-shrub',
    name: '林下暗绿灌丛',
    subtitle: '参考图1配景 · 深青绿低矮背景灌丛',
    category: 'shrub',
    create: () => createTreeItem(makeDioramaShrubSpec('deep-forest', 2109), {
      name: '林下暗绿灌丛',
      category: 'shrub',
    }),
  },
  {
    id: 'curated-pale-boulder',
    name: '冷灰白切面主石',
    subtitle: '参考图1主石 · 亮冷灰赛璐璐切面岩',
    category: 'rock',
    create: () => createRockItem(makePaleMeadowBoulderSpec(5012, false), {
      name: '冷灰白切面主石',
    }),
  },
  {
    id: 'curated-warm-monolith',
    name: '方正暖灰主巨岩',
    subtitle: '参考图2主岩 · 块面硬朗厚重方岩',
    category: 'rock',
    create: () => createRockItem(makeWarmMonolithRockSpec(8401, 'monolith'), {
      name: '方正暖灰主巨岩',
    }),
  },
  {
    id: 'curated-path-slab',
    name: '草径长扁石板',
    subtitle: '参考图2配石 · 嵌草长条灰褐石板',
    category: 'rock',
    create: () => createRockItem(makeWarmMonolithRockSpec(8422, 'slab'), {
      name: '草径长扁石板',
    }),
  },
  {
    id: 'curated-tall-white-flowers',
    name: '高茎野白花簇',
    subtitle: '参考图1花卉 · 灌木旁高挑细茎小白花',
    category: 'flower',
    create: () => createTreeItem(makeMeadowFlowersSpec('tall-white', 6201, 14, 0.58), {
      name: '高茎野白花簇',
      category: 'flower',
    }),
  },
  {
    id: 'curated-low-white-flowers',
    name: '草径野白花带',
    subtitle: '参考图1/2 · 岩脚与路缘点缀白花',
    category: 'flower',
    create: () => createTreeItem(makeMeadowFlowersSpec('low-white', 6240, 24, 1.15), {
      name: '草径野白花带',
      category: 'flower',
    }),
  },
  {
    id: 'curated-low-yellow-flowers',
    name: '路边小黄花簇',
    subtitle: '参考图1/2 · 明亮暖黄草地小花',
    category: 'flower',
    create: () => createTreeItem(makeMeadowFlowersSpec('low-yellow', 6288, 16, 0.82), {
      name: '路边小黄花簇',
      category: 'flower',
    }),
  },
  {
    id: 'curated-meadow-grass',
    name: '翠绿林间细草簇',
    subtitle: '参考图1/2 · 柔和修长实体草叶片',
    category: 'grass',
    create: () => createTreeItem(makeMeadowGrassSpec(3102, true), {
      name: '翠绿林间细草簇',
      category: 'grass',
    }),
  },
]

// ============================================================================
// Built-in Diorama Showcase Case (Ref 1 — User-Saved Edition)
// ============================================================================

export function buildBirchMeadowCase(): AssemblySceneSpec {
  return parseAssemblyScene(case1BirchMeadowRaw)
}

export const builtInAssemblyCases: BuiltInAssemblyCase[] = [
  {
    id: 'birch-meadow',
    name: '林间白桦孤树地块',
    subtitle: '参考图1 · 自定义精修版 · 白桦孤树 · 林下灌丛 · 冷灰石组 · 手绘地形 · 772 簇刷草',
    tag: '12 资产 · 参考案例1',
    build: buildBirchMeadowCase,
  },
]

export function getBuiltInAssemblyCase(id: string): BuiltInAssemblyCase | undefined {
  return builtInAssemblyCases.find(c => c.id === id)
}

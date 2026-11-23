// Curated reusable diorama assets & 2 complete built-in Scene Assembly Showcase Cases
// crafted from the user's 2 stylized isometric diorama reference images:
//   1. 林间白桦孤树地块 (birch-meadow)
//   2. 巨岩枯木草径地块 (boulder-trail)
import { rockPresetSpec, type RockSpec } from '../rock/spec'
import { presetSpec, type TreeSpec } from '../tree/spec'
import {
  createRockItem, createTreeItem, defaultGroundSpec,
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
    radius: .29,
    taper: 1.32,
    flare: .38,
    flareHeight: 0.68,
    gnarl: 0.26,
    surfaceRoots: 0,
    barkColor: '#3f4539',
    barkScale: 1.05,
    barkDetail: 0.72,
    barkMoss: 0.34,
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
    base: .49,
    top: 1.0,
    width: 2.12,
    depth: 0.92,
    roundness: 2.25,
    topBias: 1.24,
    coneShape: 1.08,
    irregularity: 0.46,
    canopyLift: 0.44,
    padFlatten: 0.24,
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
    leafSize: .59,
    leafSizeVariance: 0.34,
    twigFrequency: 3.3,
    twigLength: 0.58,
    leavesPerTwig: 4,
    clumpFill: 3.1,
    clumpFillScale: 1.04,
    clumpScale: .96,
    normalSpherize: 0.86,
    tintInner: '#3c6051',
    tintOuter: '#76ae69',
    tintVariance: 0.14,
    aoStrength: 0.22,
    alphaCutoff: 0.42,
    leafSeed: seed + 17,
  }
  s.shading = {
    ...s.shading,
    leafStyle: 'bush',
    translucency: 0.36,
    rimLight: 0.34,
    shadowShift: 0.48,
    topWarmth: 0.42,
    softSelfShadow: true,
    petals: 0,
  }
  // Sculpt Ref 1's iconic airy multi-cloud silhouette with a breathing gap at the Y-fork
  s.handles = [
    { id: 1, kind: 'shape', anchor: [0, 7.15, 0], offset: [-0.08, 0.32, 0.04], radius: 2.35 },
    { id: 2, kind: 'shape', anchor: [-1.85, 5.25, 0.65], offset: [-0.45, 0.22, 0.28], radius: 2.05 },
    { id: 3, kind: 'shape', anchor: [1.75, 5.35, -0.55], offset: [0.46, 0.34, -0.24], radius: 2.05 },
    { id: 4, kind: 'shape', anchor: [0.85, 3.95, 0.85], offset: [0.32, -0.15, 0.25], radius: 1.60 },
    { id: 5, kind: 'bare', anchor: [0.18, 3.55, 0.15], offset: [0, 0, 0], radius: 0.82 },
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
    leafSize: isDeep ? 0.46 : 0.54,
    leafSizeVariance: 0.30,
    twigFrequency: 3.2,
    twigLength: 0.36,
    leavesPerTwig: 4,
    pruneInner: 0.02,
    clumpFill: isDeep ? 4.2 : 4.9,
    clumpFillScale: 1.28,
    clumpScale: 1.15,
    normalSpherize: 0.88,
    tintInner: isDeep ? '#263e36' : '#254a2f',
    tintOuter: isDeep ? '#4c7450' : '#75a048',
    tintVariance: 0.14,
    aoStrength: 0.24,
    alphaCutoff: 0.42,
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
      crownStyle: 'painted',
      treeForm: 'meadow-birch',
      leafTexture: 'bush',
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
      crownStyle: 'painted',
      leafTexture: 'bush',
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
      crownStyle: 'painted',
      leafTexture: 'bush',
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
// Built-in Diorama Showcase Cases (Ref 1 & Ref 2)
// ============================================================================

/** Showcase Case 1: Ref 1 — Birch-Base Woodland Hero Tree Diorama (13 independent editable assets). */
export function buildBirchMeadowCase(): AssemblySceneSpec {
  return {
    version: 1,
    name: '参考案例 1 · 林间白桦孤树地块',
    description: '白桦分叉与枝团、林下灌丛、浅灰石组、草径和野花',
    backdrop: 'diorama-dark',
    lighting: 'ghibli',
    wind: false,
    cameraPreset: 'illustration',
    ground: defaultGroundSpec({
      style: 'diorama-path',
      size: 7.2,
      thickness: .048,
      grassColor: '#469a45',
      grassHighlight: '#83b751',
      grassShadow: '#214f3e',
      pathLayout: 'birch-curve',
      pathColor: '#b9a05e',
      pathWidth: .77,
      seed: 1084,
    }),
    items: [
      createTreeItem(makeBirchHeroTreeSpec(4108), {
        id: 'birch-hero-tree',
        name: '林间白桦孤树',
        category: 'tree',
        barkStyle: 'birch',
        crownStyle: 'painted',
        treeForm: 'meadow-birch',
        leafTexture: 'bush',
        position: [-0.52, 0, 0.18],
        rotation: [0, 39, 0],
        scale: [1, 1.07, 1],
      }),
      createTreeItem(makeDioramaShrubSpec('deep-forest', 2109), {
        id: 'birch-shrub-left',
        name: '林下暗绿灌丛·左',
        category: 'shrub',
        crownStyle: 'painted',
        leafTexture: 'bush',
        position: [-1.59, 0, -.2],
        rotation: [0, 42, 0],
        scale: [.91, .76, .79],
      }),
      createTreeItem(makeDioramaShrubSpec('deep-forest', 2137), {
        id: 'birch-shrub-back',
        name: '林下暗绿灌丛·后',
        category: 'shrub',
        crownStyle: 'painted',
        leafTexture: 'bush',
        position: [-1.04, 0, -1.07],
        rotation: [0, 130, 0],
        scale: [1.19, 1.09, .99],
      }),
      createTreeItem(makeDioramaShrubSpec('deep-forest', 2183), {
        id: 'birch-shrub-right-back',
        name: '林下矮灌丛·右后',
        category: 'shrub',
        crownStyle: 'painted',
        leafTexture: 'bush',
        position: [0.48, 0, -1.03],
        rotation: [0, 215, 0],
        scale: [1.02, .84, .95],
      }),
      createRockItem(makePaleMeadowBoulderSpec(5012, false), {
        id: 'birch-boulder-main',
        name: '冷灰白切面主石',
        position: [.92, -.08, -.43],
        rotation: [0, -32, 0],
        scale: [1.21, .75, .96],
      }),
      createRockItem(makePaleMeadowBoulderSpec(5044, false), {
        id: 'birch-boulder-small',
        name: '伴生冷灰小石',
        position: [0.85, -0.02, 0.56],
        rotation: [0, 44, 0],
        scale: [0.42, 0.34, 0.38],
      }),
      createRockItem(makePaleMeadowBoulderSpec(5088, true), {
        id: 'birch-stepping-slab',
        name: '前景冷灰踏石板',
        position: [-0.85, -0.02, 2.55],
        rotation: [0, 22, 0],
        scale: [0.95, 0.56, 0.82],
      }),
      createTreeItem(makeMeadowFlowersSpec('tall-white', 6201, 14, 0.56), {
        id: 'birch-tall-white-flowers',
        name: '灌木旁高茎白花',
        category: 'flower',
        position: [-1.18, 0, 0.72],
        rotation: [0, 15, 0],
        scale: [1.1, 1.15, 1.1],
      }),
      createTreeItem(makeMeadowFlowersSpec('low-yellow', 6288, 16, 0.72), {
        id: 'birch-front-yellow-flowers',
        name: '前景草地小黄花',
        category: 'flower',
        position: [-.43, 0, 2.76],
        rotation: [0, 28, 0],
        scale: [1.0, 1.0, 1.0],
      }),
      createTreeItem(makeMeadowFlowersSpec('low-white', 6241, 18, 0.92), {
        id: 'birch-meadow-white-flowers',
        name: '石边与草坪小白花',
        category: 'flower',
        position: [1.85, 0, -0.58],
        rotation: [0, 62, 0],
        scale: [1.0, 1.0, 1.0],
      }),
      createTreeItem(makeDioramaShrubSpec('ghibli-lime', 3102), {
        id: 'birch-grass-root',
        name: '树根向阳嫩叶',
        category: 'shrub',
        crownStyle: 'painted',
        position: [-1.19, 0, .24],
        rotation: [0, 12, 0],
        scale: [.59, .67, .50],
      }),
      createTreeItem(makeMeadowGrassSpec(3144, true), {
        id: 'birch-grass-boulder',
        name: '主石旁翠绿草簇',
        category: 'grass',
        position: [1.38, 0, -0.08],
        rotation: [0, 118, 0],
        scale: [0.92, 0.85, 0.92],
      }),
      createTreeItem(makeMeadowGrassSpec(3199, false), {
        id: 'birch-grass-edge',
        name: '左缘草丛',
        category: 'grass',
        position: [-2.45, 0, 1.85],
        rotation: [0, 74, 0],
        scale: [1.15, 0.95, 1.15],
      }),
    ],
  }
}

/** Showcase Case 2: Ref 2 — Monolith Boulder, Deadwood Snag & Sandy Trail Diorama (18 independent editable assets). */
export function buildBoulderTrailCase(): AssemblySceneSpec {
  return {
    version: 1,
    name: '参考案例 2 · 巨岩枯木草径地块',
    description: '复刻参考图2：叠压方正暖灰主巨岩、无叶分叉枯木残桩与矮枯枝、鲜绿吉卜力灌木丛、7 块错落灰褐配石、野白花带与斜贯沙土草径地块（共 18 个独立可调资产）',
    backdrop: 'diorama-dark',
    lighting: 'ghibli',
    wind: true,
    cameraPreset: 'illustration',
    ground: defaultGroundSpec({
      style: 'diorama-path',
      size: 9.6,
      thickness: 0.065,
      grassColor: '#418e43',
      grassHighlight: '#98b14d',
      grassShadow: '#295e3a',
      pathLayout: 'boulder-trail',
      pathColor: '#cfaa6d',
      pathWidth: .94,
      seed: 2048,
    }),
    items: [
      createRockItem(makeWarmMonolithRockSpec(8401, 'monolith'), {
        id: 'trail-monolith-main',
        name: '方正暖灰主巨岩',
        position: [-1.65, -0.12, -.72],
        rotation: [0, 32, 0],
        scale: [1.32, .62, 1.04],
      }),
      createRockItem(makeWarmMonolithRockSpec(8417, 'monolith'), {
        id: 'trail-monolith-upper',
        name: '巨岩后侧叠层岩',
        position: [-1.99, .55, -1.24],
        rotation: [0, 28, 0],
        scale: [.99, .42, .84],
      }),
      createTreeItem(makeDeadSnagSpec(7321, true), {
        id: 'trail-dead-snag',
        name: '枯木分叉残桩',
        category: 'deadwood',
        position: [-3.38, 0, .48],
        rotation: [0, 24, -6],
        scale: [1.17, .78, 1.10],
      }),
      createTreeItem(makeDeadSnagSpec(7399, false), {
        id: 'trail-dead-twig',
        name: '左缘斜伸矮枯枝',
        category: 'deadwood',
        position: [-3.48, 0, -0.58],
        rotation: [8, -32, 16],
        scale: [0.72, 0.76, 0.72],
      }),
      createTreeItem(makeDioramaShrubSpec('ghibli-lime', 2241), {
        id: 'trail-hero-shrub',
        name: '岩前鲜绿灌木丛',
        category: 'shrub',
        crownStyle: 'painted',
        leafTexture: 'bush',
        position: [-2.40, 0, .35],
        rotation: [0, 32, 0],
        scale: [1.08, .68, .86],
      }),
      createTreeItem(makeDioramaShrubSpec('ghibli-lime', 2289), {
        id: 'trail-left-shrub',
        name: '左缘低矮灌丛',
        category: 'shrub',
        crownStyle: 'painted',
        leafTexture: 'bush',
        position: [-3.12, 0, 0.62],
        rotation: [0, 145, 0],
        scale: [0.74, 0.56, 0.72],
      }),
      createRockItem(makeWarmMonolithRockSpec(8431, 'accent'), {
        id: 'trail-rock-bush-front',
        name: '灌木前竖立小石',
        position: [-2.55, -0.02, 0.82],
        rotation: [0, 26, 0],
        scale: [0.52, 0.72, 0.48],
      }),
      createRockItem(makeWarmMonolithRockSpec(8445, 'accent'), {
        id: 'trail-rock-foot-left',
        name: '巨岩脚下配石·左',
        position: [-0.82, -0.03, -0.52],
        rotation: [0, 16, 0],
        scale: [0.68, 0.56, 0.58],
      }),
      createRockItem(makeWarmMonolithRockSpec(8459, 'accent'), {
        id: 'trail-rock-foot-right',
        name: '巨岩脚下配石·右',
        position: [-0.18, -0.03, -0.88],
        rotation: [0, -40, 0],
        scale: [0.58, 0.46, 0.50],
      }),
      createRockItem(makeWarmMonolithRockSpec(8422, 'slab'), {
        id: 'trail-rock-path-slab',
        name: '路边长扁灰石板',
        position: [-0.42, -0.03, 0.92],
        rotation: [0, -18, 0],
        scale: [1.3, .41, .83],
      }),
      createRockItem(makeWarmMonolithRockSpec(8477, 'accent'), {
        id: 'trail-rock-mid',
        name: '路缘圆润中石',
        position: [0.36, -0.02, -0.18],
        rotation: [0, 34, 0],
        scale: [0.84, 0.64, 0.68],
      }),
      createRockItem(makeWarmMonolithRockSpec(8491, 'slab'), {
        id: 'trail-rock-right-lawn',
        name: '右侧草坪矮石',
        position: [2.86, -.065, -.65],
        rotation: [0, 47, 0],
        scale: [1.12, .32, .76],
      }),
      createRockItem(makeWarmMonolithRockSpec(8509, 'accent'), {
        id: 'trail-pebble-far',
        name: '草坪碎石',
        position: [2.42, -0.02, -0.92],
        rotation: [0, 52, 0],
        scale: [0.40, 0.32, 0.36],
      }),
      createTreeItem(makeMeadowFlowersSpec('low-white', 6240, 34, 1.42), {
        id: 'trail-white-flowers',
        name: '岩脚大片野白花带',
        category: 'flower',
        position: [-1.18, 0, 0.58],
        rotation: [0, 18, 0],
        scale: [1.05, 1.05, 1.05],
      }),
      createTreeItem(makeMeadowFlowersSpec('low-yellow', 6277, 18, 0.92), {
        id: 'trail-yellow-flowers-left',
        name: '左侧草坪小黄花',
        category: 'flower',
        position: [-1.95, 0, 2.05],
        rotation: [0, 44, 0],
        scale: [1.0, 1.0, 1.0],
      }),
      createTreeItem(makeMeadowFlowersSpec('low-yellow', 6311, 14, 0.78), {
        id: 'trail-yellow-flowers-right',
        name: '右缘草坪小黄花',
        category: 'flower',
        position: [2.75, 0, 2.55],
        rotation: [0, 92, 0],
        scale: [1.0, 1.0, 1.0],
      }),
      createTreeItem(makeMeadowGrassSpec(3211, true), {
        id: 'trail-grass-left-edge',
        name: '左缘茂密草丛',
        category: 'grass',
        position: [-3.35, 0, 1.32],
        rotation: [0, 36, 0],
        scale: [1.25, 1.1, 1.25],
      }),
      createTreeItem(makeMeadowGrassSpec(3255, true), {
        id: 'trail-grass-boulder-foot',
        name: '岩脚与路边草丛',
        category: 'grass',
        position: [-1.32, 0, 0.25],
        rotation: [0, 110, 0],
        scale: [1.18, 1.05, 1.18],
      }),
    ],
  }
}

export const builtInAssemblyCases: BuiltInAssemblyCase[] = [
  {
    id: 'birch-meadow',
    name: '林间白桦孤树地块',
    subtitle: '参考图1 · 白桦下干孤树 · 暗绿灌木 · 冷灰主石 · 野白/黄花 · 弧形土路',
    tag: '13 资产 · 参考案例1',
    build: buildBirchMeadowCase,
  },
  {
    id: 'boulder-trail',
    name: '巨岩枯木草径地块',
    subtitle: '参考图2 · 叠层暖灰巨岩 · 分叉枯木桩 · 吉卜力绿灌木 · 7配石 · 沙土草径',
    tag: '18 资产 · 参考案例2',
    build: buildBoulderTrailCase,
  },
]

export function getBuiltInAssemblyCase(id: string): BuiltInAssemblyCase | undefined {
  return builtInAssemblyCases.find(c => c.id === id)
}

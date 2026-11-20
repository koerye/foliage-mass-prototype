// Built-in finished AI Mode showcase library — every crafted AI template tree
// is permanently registered here using 100% exposed Vegetation Studio procedural
// algorithms, traced spines, cloud pads, modeled grass blades, and stylized shading.
import { presetSpec } from '../tree/spec'
import type { LightingPreset } from '../viewport'
import type { AiSceneSpec } from './scene'

export interface AiShowcaseEntry {
  id: string
  name: string
  subtitle: string
  tag: string
  lighting: LightingPreset
  thumbnail: string
  build: () => AiSceneSpec
}

/** Multi-stem Sakura Bonsai showcase (5 editable procedural parts):
 *  - Main S-curved gnarled trunk + asymmetric sakura cloud canopy + 5 surface roots
 *  - Left curved sub-trunk + puffball sakura crown
 *  - Right outward-hooking sub-trunk + puffball sakura crown
 *  - Vivid pink grass mound base (grassTint)
 *  - Delicate base wildflowers (flowerbed-stemmed) */
export function sakuraBonsaiShowcase(): AiSceneSpec {
  const mainSpec = presetSpec('broadleaf-sakura', 16392)
  mainSpec.name = '主干与主冠'
  mainSpec.trunk.height = 5.51
  mainSpec.trunk.radius = .33
  mainSpec.trunk.flare = .88
  mainSpec.trunk.flareHeight = .78
  mainSpec.trunk.gnarl = .48
  mainSpec.trunk.surfaceRoots = 5
  mainSpec.trunk.barkColor = '#765666'
  mainSpec.trunk.forkHeight = .52
  mainSpec.trunk.spine = [
    [0, 0, 0], [.22, .42, .06], [.54, .92, .15], [.62, 1.42, .22],
    [.5, 1.92, .18], [.28, 2.38, .1], [.06, 2.78, .04],
  ]
  mainSpec.crown = {
    base: .48, top: 1, width: 2.95, depth: .86, roundness: 2.5, topBias: 1.3,
    coneShape: 1, irregularity: .42, canopyLift: .36, padFlatten: .46,
  }
  mainSpec.handles = [
    { id: 1, kind: 'shape', anchor: [-2.6, 4.15, 0], offset: [-.55, .28, 0], radius: 2.25 },
    { id: 2, kind: 'shape', anchor: [2.7, 3.85, 0], offset: [.48, -.26, 0], radius: 2.15 },
    { id: 3, kind: 'shape', anchor: [0, 5.51, 0], offset: [-.35, .16, 0], radius: 2.2 },
  ]

  const leftSpec = presetSpec('broadleaf-sakura', 16586)
  leftSpec.name = '左侧分干与副冠'
  leftSpec.trunk.height = 3.05
  leftSpec.trunk.radius = .15
  leftSpec.trunk.flare = .52
  leftSpec.trunk.flareHeight = .42
  leftSpec.trunk.gnarl = .4
  leftSpec.trunk.surfaceRoots = 2
  leftSpec.trunk.barkColor = '#765666'
  leftSpec.trunk.forkHeight = .54
  leftSpec.trunk.spine = [
    [0, 0, 0], [.1, .28, -.03], [.22, .62, -.07], [.16, .98, -.08], [.04, 1.32, -.05], [-.14, 1.62, -.02],
  ]
  leftSpec.crown = {
    base: .48, top: 1, width: 1.12, depth: .9, roundness: 2.2, topBias: 1.18,
    coneShape: 1, irregularity: .35, canopyLift: .28, padFlatten: .42,
  }
  leftSpec.branches = { ...mainSpec.branches, count: 5, angle: 32, angleTop: 64, curvature: .48, droop: .16, childCount: 3 }
  leftSpec.leaves = { ...mainSpec.leaves, leafSize: .52, twigLength: .48, leavesPerTwig: 8, clumpFill: 5.2, clumpFillScale: 1.35, leafSeed: 29 }
  leftSpec.shading = { ...mainSpec.shading, petals: 6 }

  const rightSpec = presetSpec('broadleaf-sakura', 16489)
  rightSpec.name = '右侧分干与副冠'
  rightSpec.trunk.height = 2.76
  rightSpec.trunk.radius = .145
  rightSpec.trunk.flare = .48
  rightSpec.trunk.flareHeight = .4
  rightSpec.trunk.gnarl = .38
  rightSpec.trunk.surfaceRoots = 2
  rightSpec.trunk.barkColor = '#765666'
  rightSpec.trunk.forkHeight = .52
  rightSpec.trunk.spine = [
    [0, 0, 0], [.08, .26, .04], [.22, .56, .09], [.42, .88, .12], [.56, 1.18, .08], [.66, 1.44, .04],
  ]
  rightSpec.crown = {
    base: .46, top: 1, width: 1.08, depth: .9, roundness: 2.2, topBias: 1.16,
    coneShape: 1, irregularity: .35, canopyLift: .28, padFlatten: .42,
  }
  rightSpec.branches = { ...mainSpec.branches, count: 5, angle: 32, angleTop: 64, curvature: .48, droop: .16, childCount: 3 }
  rightSpec.leaves = { ...mainSpec.leaves, leafSize: .5, twigLength: .46, leavesPerTwig: 8, clumpFill: 5.2, clumpFillScale: 1.35, leafSeed: 41 }
  rightSpec.shading = { ...mainSpec.shading, petals: 6 }

  const grassSpec = presetSpec('grass-clump', 16895)
  grassSpec.name = '根部草丛基底'
  grassSpec.ground = {
    ...grassSpec.ground,
    mode: 'card',
    count: 150, spread: 2.15, length: .44, lengthVariance: .44, width: .095,
    lean: 28, arch: .36, planes: 2, segments: 4, spherize: .55,
    tintBase: '#f26f8a', tintTip: '#f9c8d8', aoStrength: .14,
  }

  const fbSpec = presetSpec('flowerbed-stemmed', 17101)
  fbSpec.name = '根部点缀小花'
  fbSpec.flowerbed = {
    ...fbSpec.flowerbed,
    count: 16, spread: 1.95, height: .62, heightVariance: .42, stemRadius: .005,
    stemLeaves: 1, stemLeafSize: .07, flowerSize: .095,
    tintInner: '#c44d74', tintOuter: '#fcb9d0', stemTint: '#765666',
  }

  return {
    schemaVersion: 1,
    mode: 'ai-blank',
    name: '三干樱花盆景（示范案例）',
    summary: '观花阔叶树 / 樱花盆景 · 多冠分干：3 组树冠 · 真树干样条复刻 ×3 · 樱花柔瓣簇 · 含粉色根部草地与落瓣',
    parts: [
      { id: 'part-main', label: '主干与主冠', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: mainSpec },
      { id: 'part-left', label: '左侧分干与副冠', enabled: true, position: [-1.22, 0, -.18], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: leftSpec },
      { id: 'part-right', label: '右侧分干与副冠', enabled: true, position: [1.02, 0, .4], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: rightSpec },
      { id: 'part-ground', label: '根部草丛基底', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'grassTint', spec: grassSpec },
      { id: 'part-ground-flowers', label: '根部点缀小花', enabled: true, position: [0, 0, 0], rotationY: 0, scale: 1, leafTexture: 'blossom', spec: fbSpec },
    ],
  }
}

/** Sculptural S-curved Ancient Cherry Blossom Tree (6 editable procedural parts):
 *  - Massive ribbed mauve-plum S-curved trunk with 6 sprawling surface roots & open dark-limb crown
 *  - Lower-right sweeping arched bough with tiered blush sakura clouds & airy negative-space window
 *  - Upper-left cascading arched branch cloud
 *  - Delicate lower-left elbow accent blossom twig
 *  - Fresh spring-green modeled 3D root grass tufts (base + right root-tip accent) */
export function twistedSakuraShowcase(): AiSceneSpec {
  const sharedShading = {
    leafStyle: 'sakura' as const,
    translucency: .48,
    shadowShift: .22,
    rimLight: .26,
    topWarmth: .22,
    softSelfShadow: true,
    petals: 26,
  }

  // 1. Main S-curved ancient trunk + wide sunlit upper umbrella crown
  const mainSpec = presetSpec('broadleaf-sakura', 28419)
  mainSpec.name = '盘曲主干与顶冠'
  mainSpec.trunk = {
    ...mainSpec.trunk,
    height: 5.05,
    radius: .35,
    taper: 1.95,
    flare: 1.05,
    flareLobes: 5,
    flareHeight: .96,
    wobble: .04,
    lean: .08,
    barkRidges: 8,
    barkDepth: .082,
    forkHeight: .64,
    barkColor: '#5a4353',
    gnarl: .42,
    surfaceRoots: 6,
    spine: [
      [0, 0, 0],
      [-.05, .48, .04],
      [-.28, 1.02, .11],
      [-.68, 1.54, .16],
      [-.80, 1.94, .14],
      [-.54, 2.34, .08],
      [-.22, 2.74, .02],
      [-.26, 3.04, -.02],
      [-.44, 3.23, -.04],
    ],
  }
  mainSpec.crown = {
    base: .56, top: 1, width: 2.42, depth: .82, roundness: 2.4, topBias: 1.26,
    coneShape: 1, irregularity: .42, canopyLift: .42, padFlatten: .54,
  }
  mainSpec.branches = {
    count: 7, perWhorl: 1, angle: 18, angleTop: 52, reach: .96, lengthVariance: .24,
    curvature: .48, droop: .16, tipCurl: .08, radiusRatio: .72,
    childCount: 3, childAngle: 48, childLength: .44, childDroop: .14, deadCount: 0, tierGradient: .45,
  }
  mainSpec.leaves = {
    ...mainSpec.leaves,
    leafSize: .54, twigLength: .46, twigFrequency: 7.4, leavesPerTwig: 7,
    clumpFill: 4.6, clumpFillScale: 1.32, limbLeafFrequency: 2.4,
    cardType: 'cross', cameraFacing: .14, pruneInner: .25, leafSeed: 73,
    tintInner: '#c84b76', tintOuter: '#ffd4e2', aoStrength: .24, alphaCutoff: .44,
  }
  mainSpec.shading = { ...sharedShading, petals: 26 }
  mainSpec.handles = [
    { id: 1, kind: 'shape', anchor: [-2.15, 3.72, 0], offset: [-.36, -.12, 0], radius: 1.95 },
    { id: 2, kind: 'shape', anchor: [1.90, 4.05, 0], offset: [.38, .22, 0], radius: 2.05 },
    { id: 3, kind: 'shape', anchor: [-.15, 4.95, 0], offset: [.18, .08, 0], radius: 1.95 },
    { id: 4, kind: 'bare', anchor: [-.28, 2.98, .44], offset: [0, 0, 0], radius: .60 },
  ]

  // 2. Lower-right graceful concave-arched bough with open negative-space window
  const rightSpec = presetSpec('broadleaf-sakura', 28527)
  rightSpec.name = '右侧悬弧大枝与云冠'
  rightSpec.trunk = {
    ...rightSpec.trunk,
    height: 2.68,
    radius: .135,
    taper: 1.65,
    flare: .16,
    flareLobes: 4,
    flareHeight: .20,
    barkRidges: 5,
    barkDepth: .048,
    forkHeight: .60,
    barkColor: '#523c4c',
    gnarl: .35,
    surfaceRoots: 0,
    spine: [
      [0, 0, 0],
      [.50, .18, -.06],
      [.92, .44, -.02],
      [1.32, .80, .02],
      [1.62, 1.22, .01],
      [1.78, 1.64, -.02],
    ],
  }
  rightSpec.crown = {
    base: .50, top: 1, width: 1.26, depth: .86, roundness: 2.25, topBias: 1.16,
    coneShape: 1, irregularity: .38, canopyLift: .32, padFlatten: .52,
  }
  rightSpec.branches = {
    ...mainSpec.branches,
    count: 6, angle: 18, angleTop: 52, reach: .94, curvature: .44, droop: .14, radiusRatio: .66, childCount: 3,
  }
  rightSpec.leaves = {
    ...mainSpec.leaves,
    leafSize: .50, twigLength: .42, twigFrequency: 7.0, leavesPerTwig: 7,
    clumpFill: 4.7, clumpFillScale: 1.30, limbLeafFrequency: 2.2, leafSeed: 112,
    tintInner: '#c44670', tintOuter: '#ffcce0',
  }
  rightSpec.shading = { ...sharedShading, petals: 8 }

  // 3. Upper-left slender sweeping arched branch + sunlit cascade cloud
  const leftWingSpec = presetSpec('broadleaf-sakura', 28640)
  leftWingSpec.name = '左上垂弧花枝云团'
  leftWingSpec.trunk = {
    ...leftWingSpec.trunk,
    height: 1.46,
    radius: .062,
    taper: 1.55,
    flare: .08,
    flareLobes: 4,
    flareHeight: .12,
    barkRidges: 4,
    barkDepth: .035,
    forkHeight: .54,
    barkColor: '#4a3545',
    gnarl: .26,
    surfaceRoots: 0,
    spine: [
      [0, 0, 0],
      [-.42, .14, .03],
      [-.90, .24, .05],
      [-1.36, .24, .02],
      [-1.66, .38, -.01],
    ],
  }
  leftWingSpec.crown = {
    base: .46, top: 1, width: 1.12, depth: .82, roundness: 2.15, topBias: 1.06,
    coneShape: 1, irregularity: .36, canopyLift: .28, padFlatten: .54,
  }
  leftWingSpec.branches = {
    ...mainSpec.branches,
    count: 5, angle: 16, angleTop: 46, reach: .92, curvature: .38, droop: .16, radiusRatio: .62, childCount: 2,
  }
  leftWingSpec.leaves = {
    ...mainSpec.leaves,
    leafSize: .48, twigLength: .38, twigFrequency: 6.6, leavesPerTwig: 6,
    clumpFill: 4.3, clumpFillScale: 1.28, limbLeafFrequency: 2.0, leafSeed: 149,
    tintInner: '#cc527c', tintOuter: '#ffdae7',
  }
  leftWingSpec.shading = { ...sharedShading, petals: 6 }

  // 4. Delicate lower-left accent twig emerging from main trunk elbow
  const leftTwigSpec = presetSpec('broadleaf-sakura', 28755)
  leftTwigSpec.name = '左下肘部探出花枝'
  leftTwigSpec.trunk = {
    ...leftTwigSpec.trunk,
    height: .72,
    radius: .040,
    taper: 1.35,
    flare: .06,
    flareLobes: 4,
    flareHeight: .08,
    barkRidges: 4,
    barkDepth: .028,
    forkHeight: .52,
    barkColor: '#453040',
    gnarl: .20,
    surfaceRoots: 0,
    spine: [
      [0, 0, 0],
      [-.24, .03, .02],
      [-.56, .08, .04],
      [-.88, .20, .03],
      [-1.14, .34, .01],
    ],
  }
  leftTwigSpec.crown = {
    base: .44, top: 1, width: .54, depth: .72, roundness: 2.0, topBias: 1.0,
    coneShape: 1, irregularity: .32, canopyLift: .20, padFlatten: .52,
  }
  leftTwigSpec.branches = {
    ...mainSpec.branches,
    count: 4, angle: 14, angleTop: 42, reach: .86, curvature: .30, droop: .12, radiusRatio: .56, childCount: 2,
  }
  leftTwigSpec.leaves = {
    ...mainSpec.leaves,
    leafSize: .31, twigLength: .26, twigFrequency: 5.6, leavesPerTwig: 5,
    clumpFill: 3.4, clumpFillScale: 1.2, limbLeafFrequency: 1.8, leafSeed: 203,
    tintInner: '#c84b76', tintOuter: '#ffd4e2',
  }
  leftTwigSpec.shading = { ...sharedShading, petals: 4 }

  // 5. Vibrant spring-green modeled 3D grass tufts tucked visibly between root buttresses
  const grassBaseSpec = presetSpec('grass-clump', 28810)
  grassBaseSpec.name = '根部嫩绿草簇'
  grassBaseSpec.ground = {
    ...grassBaseSpec.ground,
    mode: 'blade',
    count: 34, length: .34, lengthVariance: .36, width: .036, widthFullness: .48,
    spread: .96, lean: 24, arch: .34, droop: .06, cup: .22, twist: 8, sideSwirl: 6,
    segments: 5, across: 2, spherize: .35, colorTones: true,
    tintBase: '#1b6d28', tintTip: '#5ad044', aoStrength: .20,
  }

  // 6. Small right root-tip green grass accent tuft
  const grassAccentSpec = presetSpec('grass-clump', 28899)
  grassAccentSpec.name = '右侧根梢小草簇'
  grassAccentSpec.ground = {
    ...grassAccentSpec.ground,
    mode: 'blade',
    count: 11, length: .24, lengthVariance: .32, width: .028, widthFullness: .45,
    spread: .15, lean: 28, arch: .32, droop: .05, cup: .20, twist: 6, sideSwirl: 5,
    segments: 5, across: 2, spherize: .35, colorTones: true,
    tintBase: '#207a2e', tintTip: '#64d44c', aoStrength: .18,
  }

  return {
    schemaVersion: 1,
    mode: 'ai-blank',
    name: '盘曲古樱（案例库）',
    summary: '风格化盘曲古樱 · 6 部件全可调：S 形扭曲粗干与 6 条贴地盘根 + 右侧悬弧大枝 + 左上垂弧花枝 + 肘部探出小花枝 + 实体 3D 嫩绿根草与飘落花瓣',
    parts: [
      { id: 'part-main', label: '盘曲主干与顶冠', enabled: true, position: [.22, 0, 0], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: mainSpec },
      { id: 'part-right-bough', label: '右侧悬弧大枝与云冠', enabled: true, position: [.10, .78, .04], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: rightSpec },
      { id: 'part-left-wing', label: '左上垂弧花枝云团', enabled: true, position: [-.24, 2.38, .04], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: leftWingSpec },
      { id: 'part-left-twig', label: '左下肘部探出花枝', enabled: true, position: [-.48, 1.76, .14], rotationY: 0, scale: 1, leafTexture: 'sakura', spec: leftTwigSpec },
      { id: 'part-grass-base', label: '根部嫩绿草簇', enabled: true, position: [.06, 0, .22], rotationY: 0, scale: 1, leafTexture: 'auto', spec: grassBaseSpec },
      { id: 'part-grass-accent', label: '右侧根梢小草簇', enabled: true, position: [1.52, 0, .12], rotationY: 0, scale: 1, leafTexture: 'auto', spec: grassAccentSpec },
    ],
  }
}

/** Lush Ghibli/Anime Flowering Green Bush Mound (4 seamlessly nestled multi-lobe parts):
 *  - Stepped asymmetrical hedgerow silhouette hugging y = 0 (zero exposed brown trunk)
 *  - Crisp pointed lance-leaf sprigs (`bush`) with bright lime-yellow sunlit crown -> deep emerald-teal base
 *  - Scattered 5-petal pure-white wild-rose blossoms (`wildrose`) nestled across the outer leaf shell */
export function floweringBushShowcase(): AiSceneSpec {
  const makeMound = (
    name: string,
    seed: number,
    height: number,
    width: number,
    depth: number,
    flowerCount: number,
    leafSize = .31,
  ) => {
    const spec = presetSpec('shrub-flower', seed)
    spec.name = name
    spec.trunk = {
      ...spec.trunk,
      height,
      radius: .004,
      taper: 1.2,
      flare: 0,
      flareLobes: 4,
      flareHeight: .04,
      wobble: .02,
      lean: .03,
      barkRidges: 4,
      barkDepth: .01,
      forkHeight: .08,
      barkColor: '#134224',
      gnarl: 0,
      surfaceRoots: 0,
    }
    spec.crown = {
      base: .15, top: 1, width, depth, roundness: 2.4, topBias: .80,
      coneShape: 1, irregularity: .24, canopyLift: 0, padFlatten: .12,
    }
    spec.branches = {
      count: 9, perWhorl: 1, angle: 12, angleTop: 58, reach: .94, lengthVariance: .18,
      curvature: .35, droop: .20, tipCurl: 0, radiusRatio: .18,
      childCount: 2, childAngle: 52, childLength: .35, childDroop: .20, deadCount: 0, tierGradient: .45,
    }
    spec.leaves = {
      ...spec.leaves,
      leafSize, twigLength: .22, twigFrequency: 7.8, leavesPerTwig: 5,
      clumpFill: 4.6, clumpFillScale: 1.32, limbLeafFrequency: 2.8,
      cardType: 'cross', cameraFacing: 0, pruneInner: .20,
      normalSource: 'crown', normalSpherize: .88, leafSeed: seed % 997,
      tintInner: '#0d3f28', tintOuter: '#9ee63c', tintVariance: .14,
      aoStrength: .66, alphaCutoff: .42,
    }
    spec.flowers = {
      ...spec.flowers,
      enabled: true, style: 'wildrose', count: flowerCount,
      sizeRatio: .44, sizeVariance: .20, outerShell: .60, surfaceOffset: .34,
      upBias: .24, clumping: .06, clusterCount: 12, cardType: 'cup',
      faceOutward: .92, cameraFacing: .48,
      tintInner: '#eef2eb', tintOuter: '#ffffff', tintVariance: .06,
      alphaCutoff: .34, seed: (seed * 7) % 9999,
    }
    spec.shading = {
      leafStyle: 'bush',
      translucency: .22,
      rimLight: .16,
      shadowShift: .56,
      topWarmth: .28,
      softSelfShadow: true,
      petals: 0,
    }
    return spec
  }

  return {
    schemaVersion: 1,
    mode: 'ai-blank',
    name: '繁花绿灌木丛（案例库）',
    summary: '吉卜力风格繁花绿灌木团 · 4 组阶梯灌木丘无缝拼接 · 翠绿尖叶枝簇（顶鲜黄绿 → 中翠绿 → 底墨绿青影）· 表层点缀 216 朵立体五瓣白野蔷薇',
    parts: [
      { id: 'part-bush-main-left', label: '主冠左丘', enabled: true, position: [-.34, 0, 0], rotationY: 0, scale: 1, leafTexture: 'bush', spec: makeMound('主冠左丘', 39104, 1.18, .96, .88, 70, .32) },
      { id: 'part-bush-main-right', label: '主冠右丘', enabled: true, position: [.46, 0, -.05], rotationY: 22, scale: 1, leafTexture: 'bush', spec: makeMound('主冠右丘', 39217, 1.06, .88, .86, 62, .31) },
      { id: 'part-bush-wing-left', label: '左侧低蓬肩丘', enabled: true, position: [-.98, 0, .08], rotationY: -18, scale: 1, leafTexture: 'bush', spec: makeMound('左侧低蓬肩丘', 39341, .76, .68, .84, 44, .28) },
      { id: 'part-bush-wing-right', label: '右侧低蓬肩丘', enabled: true, position: [1.04, 0, .09], rotationY: 35, scale: 1, leafTexture: 'bush', spec: makeMound('右侧低蓬肩丘', 39482, .70, .66, .84, 40, .28) },
    ],
  }
}

/** Ordered built-in AI Showcase Case Library — newest crafted trees appear first. */
export const aiShowcases: AiShowcaseEntry[] = [
  {
    id: 'flowering-bush',
    name: '繁花绿灌木丛',
    subtitle: '吉卜力尖叶绿灌木团 · 五瓣白野蔷薇点缀 · 4 部件',
    tag: '4 部件花灌木',
    lighting: 'ghibli',
    thumbnail: './showcases/flowering-bush.jpg',
    build: floweringBushShowcase,
  },
  {
    id: 'sakura-twist',
    name: '盘曲古樱',
    subtitle: 'S 形盘曲粗干 · 左肘探枝 · 右侧悬弧大枝 · 6 部件',
    tag: '6 部件古樱',
    lighting: 'sakura',
    thumbnail: './showcases/sakura-twist.jpg',
    build: twistedSakuraShowcase,
  },
  {
    id: 'sakura',
    name: '三干樱花盆景',
    subtitle: '三干真样条复刻 · 粉色草丛基底与小花 · 5 部件',
    tag: '5 部件盆景',
    lighting: 'sakura',
    thumbnail: './showcases/sakura.jpg',
    build: sakuraBonsaiShowcase,
  },
]

export function getAiShowcase(id: string): AiShowcaseEntry | undefined {
  return aiShowcases.find(c => c.id === id)
}

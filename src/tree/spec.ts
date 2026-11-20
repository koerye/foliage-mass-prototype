// Unified tree specification (schema v2) shared by broadleaf and conifer.
import { defaultLeafParams, parseLeafParams, type LeafParams } from '../broadleaf/leaves'

export const treeKinds = ['broadleaf', 'conifer', 'palm', 'grass', 'fern', 'flowerbed'] as const
export type TreeKind = typeof treeKinds[number]
export const leafStyles = ['default', 'cloud', 'sakura', 'maple', 'willow', 'bush', 'flower'] as const
export type LeafStyle = typeof leafStyles[number]
export type XYZ = [number, number, number]

export interface TrunkSpec {
  height: number        // total tree height (m)
  radius: number        // base radius (m)
  taper: number         // radius falloff exponent
  flare: number         // root flare amount
  flareLobes: number    // number of root buttresses
  flareHeight: number   // flare decay height (m)
  wobble: number        // low-frequency bend (m)
  lean: number          // overall lean (m at top)
  leanAngle?: number    // explicit lean azimuth in deg (0=+X right, 180=-X left; <0 = random from seed)
  gnarl?: number        // 0..1 organic bonsai/ancient elbow kinks & knot swells
  surfaceRoots?: number // 0..8 sculptural crawling ground roots emerging from trunk flare
  barkColor?: string    // custom bark base hex color (default #5b4636)
  barkScale?: number    // 3D procedural / triplanar bark projection density (0.25..4, default 1.0)
  barkDetail?: number   // 3D procedural bark relief/bump & grain strength (0..1.5, default 0.72)
  barkTint?: number     // custom bark image tint blend with barkColor (0..1, default 0.45)
  spine?: XYZ[]         // optional traced/custom 3D trunk centerline in local meters ([0,0,0] -> fork)
  barkRidges: number    // vertical ridge count
  barkDepth: number     // ridge depth (fraction of radius)
  forkHeight: number    // broadleaf: fraction of height where the trunk dissolves into limbs
}

export interface CrownSpec {
  base: number          // fraction of tree height where the crown starts
  top: number           // fraction of tree height where the crown ends
  width: number         // crown radius (m)
  depth: number         // z/x ratio
  roundness: number     // broadleaf superellipse exponent (2 = ellipse)
  topBias: number       // broadleaf: >1 moves the widest point up
  coneShape: number     // conifer: profile exponent (1 = straight cone)
  irregularity: number  // angular wobble of the envelope
  canopyLift?: number   // 0..0.75 carves under-canopy negative space to expose branching limbs
  padFlatten?: number   // 0..0.85 flattens leaf clusters into layered bonsai cloud pads & trims poking twigs
}

export interface BranchSpec {
  count: number         // broadleaf primary limbs / conifer whorls
  perWhorl: number      // conifer branches per whorl
  angle: number         // elevation at the bottom (deg, + up)
  angleTop: number      // elevation at the top (deg)
  reach: number         // tip distance as fraction of envelope radius
  lengthVariance: number
  curvature: number     // bow of the limb (broadleaf) / horizontal swing (conifer)
  droop: number         // gravity sag along the branch
  tipCurl: number       // conifer upturned tips
  radiusRatio: number   // limb root radius / parent radius
  childCount: number    // sub-branches per branch
  childAngle: number    // deg from parent axis
  childLength: number   // fraction of parent length
  childDroop: number
  deadCount: number     // bare stubs below the crown
  tierGradient: number  // conifer: >0 makes lower tiers far apart and upper tiers tight
}

export const frondModes = ['leaf', 'drape', 'tent'] as const
export type FrondMode = typeof frondModes[number]

export interface FrondSpec {
  mode: FrondMode       // leaf: one leaf-shaped card per branch (branch = midrib); drape: hanging plane; tent: folded ribbon
  cardAspect: number    // leaf: card width / length
  overhang: number      // leaf: card extends past the branch tip (fraction of length)
  arch: number          // leaf: extra downward arch along the card
  cardsPerBranch: number // leaf: layered cards per branch (1..3)
  cardCup: number       // leaf: cross-section cupping of the card edges
  drop: number          // drape: hanging depth (m)
  drapeTilt: number     // drape: tilt of the curtain off vertical (deg)
  drapeCurl: number     // drape: outward curl of the lower edge
  drapeChildren: number // drape: curtains on sub-branches (0 = off, else width scale)
  width: number         // frond half width (m) on level-1 branches
  start: number         // where along the branch fronds begin
  fold: number          // tent fold angle (deg)
  cross: number         // 0..1 vertical cross ribbon width (side volume)
  childScale: number    // frond width on sub-branches relative to main
  segments: number
  spherize: number
  tintInner: string
  tintOuter: string
  tintVariance: number
  aoStrength: number
  alphaCutoff: number
  tuft: number          // leader tuft size at the tree top
  twist: number         // random roll of sub-fronds around their branch (deg)
}

export type GrassMode = 'blade' | 'card'

/** Low ground plants (grass clumps, ferns): modeled 3D grass blades or textured cards/fronds. */
export interface GroundSpec {
  mode: GrassMode       // grass: 'blade' (modeled tapered 3D blades, Blender style) | 'card' (textured strips)
  count: number
  length: number
  lengthVariance: number
  width: number
  widthVariance: number // blade: random width jitter (0..0.9)
  widthFullness: number // blade: sin(pi*t)^fullness profile exponent (0.2..3)
  spread: number        // root disk radius (m)
  radialBias: number    // blade: radial distribution exponent (0.1..4)
  angleJitter: number   // blade: azimuth angle jitter (deg)
  sideSwirl: number     // blade: tangential sweep swirl angle (deg)
  lean: number          // outward tilt from vertical (deg)
  leanVariance: number  // blade: random lean jitter (deg)
  arch: number          // bend along the blade (blade: quadratic bend; card/fern: gravity arch)
  bendVariance: number  // blade: random bend jitter (0..1)
  droop: number         // blade: cubic tip droop (-0.5..1)
  cup: number           // blade: cross-section ridge / cupping (-1..1)
  twist: number         // twist along blade / random roll (deg)
  planes: number        // card: 1..3 crossed planes per blade
  across: number        // blade: cross-section subdivisions (1..6, 2 = 3 columns with central ridge)
  fold: number          // fern: tent fold (deg)
  segments: number
  colorTones: boolean   // blade: 3-tone light/mid/dark per-blade variation
  spherize: number
  tintBase: string
  tintTip: string
  tintVariance: number
  aoStrength: number
  alphaCutoff: number
}

export interface CrownHandle {
  id: number
  kind: 'shape' | 'bare'
  anchor: XYZ           // shape: point on the undeformed envelope; bare: zone center
  offset: XYZ           // shape: displacement; bare: unused
  radius: number
}

/** SpeedTree-style per-branch node override (non-destructive, topological parent -> child). */
export interface BranchEdit {
  id: number            // deterministic skeleton branch id (0 = trunk, 1..N = limbs/children/dead)
  lengthScale?: number  // 0.25..2.5 (default 1)
  radiusScale?: number  // 0.3..2.5 (default 1)
  pitchDelta?: number   // -65..65 deg elevation tilt (default 0)
  yawDelta?: number     // -180..180 deg azimuth swing around Y (default 0)
  gravityDelta?: number // -1.5..1.5 extra arch (-) / droop (+) (default 0)
  spineOffsets?: XYZ[]  // 4 direct 3D spline sculpt deltas at t = 0.25, 0.50, 0.75, 1.0
  pruned?: boolean      // true = prune this branch and all descendants (ignored on trunk)
  bare?: boolean        // true = strip foliage on this branch and all descendants
}

/** Palm tree: ringed curved trunk + layered crown rosette of arching fronds. */
export interface PalmSpec {
  bend: number          // overall trunk lean/curve (m)
  sCurve: number        // S-bend wave amplitude (0 = simple arc, >0 = sweeping beach curve)
  ringCount: number     // horizontal bark/leaf-scar rings along the trunk
  ringStep: number      // sawtooth step depth at each ring (fraction of radius)
  frondCount: number    // total palm fronds in the crown rosette
  frondLength: number   // outer frond length (m)
  frondLengthVariance: number
  frondWidth: number    // frond half-width (m)
  frondArch: number     // downward gravity arch along the frond
  frondPitch: number    // outer ring launch elevation (deg)
  frondFold: number     // V-fold angle along the midrib (deg)
  frondTwist: number    // random roll (deg)
  segments: number      // longitudinal segments per frond
  coconuts: number      // coconut cluster count under the crown (0..6)
  spherize: number
  tintInner: string
  tintOuter: string
  tintVariance: number
  aoStrength: number
  alphaCutoff: number
}

export const flowerCardTypes = ['quad', 'cross', 'cup'] as const
export type FlowerCardType = typeof flowerCardTypes[number]

/** Outer-surface flower decoration: placement & scale follow the foliage cards. */
export interface FlowerSpec {
  enabled: boolean
  style?: 'default' | 'wildrose' // built-in flower card texture ('default' = cluster, 'wildrose' = single 5-petal white wild rose)
  count: number          // target number of flower cards
  sizeRatio: number      // flower card size relative to the host leaf card size
  sizeVariance: number   // 0..0.7 random scale jitter
  outerShell: number     // 0.3..0.98 quantile threshold (higher = strictly outermost leaf layer)
  surfaceOffset: number  // 0..0.8 outward push along surface normal (fraction of host leaf size)
  upBias: number         // -0.5..1.0 preference for sunlit upper/side outer surfaces
  clumping: number       // 0..1: 0 = even scatter, 1 = tight floral patches on outer leaf mounds
  clusterCount: number   // 2..24 floral patch centers when clumping > 0
  cardType: FlowerCardType
  faceOutward: number    // 0..1 align card normal with outer crown normal
  cameraFacing: number   // 0..1 billboard blend
  tintInner: string      // lower/shaded blossom tint
  tintOuter: string      // outer/sunlit blossom tint
  tintVariance: number
  alphaCutoff: number
  atlasCols: number
  atlasRows: number
  seed: number
}

/** Standalone ground flower patch template: with stems+leaves OR pure blossom heads. */
export interface FlowerBedSpec {
  withStems: boolean      // true = curved green stems + stem leaves + blossoms; false = pure blossoms only
  count: number           // number of flowers in the patch
  spread: number          // patch radius on the ground (m)
  height: number          // stem height (or blossom cushion height when pure) (m)
  heightVariance: number  // 0..0.7 random height variation
  lean: number            // outward stem lean (deg)
  bend: number            // graceful stem curve (0..1)
  stemRadius: number      // stem thickness (m)
  stemLeaves: number      // paired green leaves along each stem (0..4)
  stemLeafSize: number    // stem leaf length (m)
  flowerSize: number      // blossom head diameter (m)
  flowerSizeVariance: number
  headTilt: number        // outward/organic tilt of blossom head off straight up (deg)
  cardType: FlowerCardType
  faceOutward: number     // 0..1 blend toward crown envelope outward normal
  tintInner: string       // shaded / lower blossom tint
  tintOuter: string       // bright / outer blossom tint
  stemTint: string        // green tint for stems & stem leaves
  tintVariance: number
  alphaCutoff: number
  atlasCols: number
  atlasRows: number
}

/** Vegetation-aware polycount / LOD optimization settings. */
export interface OptimizeSpec {
  level: number          // 0 (original) .. 1 (maximum reduction)
  woodDetail: number     // 0.2 .. 1.0 trunk/branch mesh detail
  cullHiddenWood: boolean // omit hidden twigs & covered conifer branches
  flatCards: boolean     // 1x1 flat quads (2 tris/card instead of 8) & simpler strips
  cardReduction: number  // 0 .. 0.78 stratified card thinning with area-preserving scale boost
  targetTriangles: number // 0 = manual; >0 = target budget for one-click auto-optimize
}

/** Stylized foliage look-dev shading: backlit SSS, cool shadow hue shift, sunlit rim & top warmth. */
export interface ShadingSpec {
  leafStyle: LeafStyle    // built-in broadleaf foliage card silhouette (default/cloud/sakura/maple/willow/flower)
  translucency: number   // 0..1 backlit subsurface scattering glow
  rimLight: number       // 0..1 soft sunward silhouette rim
  shadowShift: number    // 0..1 enrich shadow tint (cool violet/teal) instead of muddy gray
  topWarmth: number      // 0..1 three-zone sunlight warmth on crown top vs cool underside
  softSelfShadow: boolean // foliage casts shadows on trunk/floor without jagged card-on-card shadow triangles
  petals: number         // 0..60 lightweight floating falling petals / accent leaves around silhouette
}

export interface TreeSpec {
  schemaVersion: 2
  kind: TreeKind
  name: string
  seed: number
  trunk: TrunkSpec
  crown: CrownSpec
  branches: BranchSpec
  leaves: LeafParams
  fronds: FrondSpec
  ground: GroundSpec
  palm: PalmSpec
  flowers: FlowerSpec
  flowerbed: FlowerBedSpec
  shading: ShadingSpec
  optimize: OptimizeSpec
  handles: CrownHandle[]
  branchEdits?: BranchEdit[]
}

const defaultFronds: FrondSpec = {
  mode: 'leaf', cardAspect: .58, overhang: .24, arch: .12, cardsPerBranch: 1, cardCup: .08,
  drop: .55, drapeTilt: 18, drapeCurl: .3, drapeChildren: 0,
  width: .44, start: .02, fold: 26, cross: .55, childScale: 1, segments: 5, spherize: .62,
  tintInner: '#5e8f4e', tintOuter: '#f2ffd8', tintVariance: .16, aoStrength: .45, alphaCutoff: .35, tuft: 1, twist: 14,
}

const defaultGround: GroundSpec = {
  mode: 'blade',
  count: 8, length: .72, lengthVariance: .22, width: .22, widthVariance: .18, widthFullness: .72,
  spread: .05, radialBias: .7, angleJitter: 7, sideSwirl: 0,
  lean: 46, leanVariance: 10, arch: .16, bendVariance: .09, droop: .04, cup: .22, twist: 10,
  planes: 1, across: 2, fold: 0, segments: 9, colorTones: true,
  spherize: .32, tintBase: '#256128', tintTip: '#8fe05a', tintVariance: .12, aoStrength: .38, alphaCutoff: .3,
}

const defaultPalm: PalmSpec = {
  bend: .95, sCurve: .35, ringCount: 18, ringStep: .15,
  frondCount: 14, frondLength: 2.75, frondLengthVariance: .18, frondWidth: .68,
  frondArch: 1.32, frondPitch: 36, frondFold: 28, frondTwist: 14, segments: 8, coconuts: 3,
  spherize: .58, tintInner: '#4e8a38', tintOuter: '#eaffb8', tintVariance: .14, aoStrength: .4, alphaCutoff: .35,
}

export const defaultFlowers: FlowerSpec = {
  enabled: false, style: 'default', count: 75, sizeRatio: .8, sizeVariance: .28, outerShell: .76, surfaceOffset: .16,
  upBias: .5, clumping: .72, clusterCount: 7, cardType: 'quad', faceOutward: 1, cameraFacing: 0,
  tintInner: '#f0a6be', tintOuter: '#fff4f8', tintVariance: .14, alphaCutoff: .35, atlasCols: 1, atlasRows: 1, seed: 1,
}

export const defaultFlowerBed: FlowerBedSpec = {
  withStems: true, count: 28, spread: .65, height: .48, heightVariance: .35, lean: 18, bend: .28,
  stemRadius: .009, stemLeaves: 2, stemLeafSize: .15, flowerSize: .18, flowerSizeVariance: .24,
  headTilt: 24, cardType: 'cup', faceOutward: .45, tintInner: '#e08a14', tintOuter: '#ffe44d',
  stemTint: '#3e8432', tintVariance: .12, alphaCutoff: .35, atlasCols: 1, atlasRows: 1,
}

export const defaultOptimize: OptimizeSpec = {
  level: 0, woodDetail: 1, cullHiddenWood: false, flatCards: false, cardReduction: 0, targetTriangles: 3000,
}

export const defaultShading: ShadingSpec = {
  leafStyle: 'default', translucency: .45, rimLight: .32, shadowShift: .34, topWarmth: .36, softSelfShadow: true, petals: 0,
}

const broadTrunk: TrunkSpec = {
  height: 6.2, radius: .25, taper: 1.15, flare: .55, flareLobes: 5, flareHeight: .55, wobble: .12, lean: .25,
  leanAngle: -1, gnarl: 0, surfaceRoots: 0, barkColor: '#5b4636', barkScale: 1, barkDetail: .72, barkTint: .45,
  barkRidges: 9, barkDepth: .06, forkHeight: .48,
}
const conTrunk: TrunkSpec = {
  height: 8.4, radius: .28, taper: 1.2, flare: .72, flareLobes: 6, flareHeight: .7, wobble: .06, lean: .08,
  leanAngle: -1, gnarl: 0, surfaceRoots: 0, barkColor: '#5b4636', barkScale: 1, barkDetail: .72, barkTint: .45,
  barkRidges: 11, barkDepth: .07, forkHeight: 1,
}

const stubBranches: BranchSpec = { count: 2, perWhorl: 2, angle: 30, angleTop: 60, reach: .9, lengthVariance: .2, curvature: .3, droop: .2,
  tipCurl: 0, radiusRatio: .5, childCount: 0, childAngle: 45, childLength: .4, childDroop: .2, deadCount: 0, tierGradient: .45 }

export const presets = {
  'broadleaf-round': {
    kind: 'broadleaf', name: '阔叶 · 圆冠', seed: 4217, trunk: broadTrunk,
    crown: { base: .34, top: 1, width: 3.1, depth: .92, roundness: 2.2, topBias: 1.1, coneShape: 1, irregularity: .3 },
    branches: { count: 7, perWhorl: 1, angle: 38, angleTop: 70, reach: .92, lengthVariance: .15, curvature: .35, droop: .12,
      tipCurl: 0, radiusRatio: .62, childCount: 4, childAngle: 48, childLength: .42, childDroop: .2, deadCount: 0, tierGradient: .45 },
  },
  'broadleaf-open': {
    kind: 'broadleaf', name: '阔叶 · 舒展', seed: 7123,
    trunk: { ...broadTrunk, height: 6.6, forkHeight: .4, lean: .45, wobble: .2 },
    crown: { base: .38, top: 1, width: 3.6, depth: .85, roundness: 2.6, topBias: 1.35, coneShape: 1, irregularity: .65 },
    branches: { count: 5, perWhorl: 1, angle: 30, angleTop: 62, reach: .97, lengthVariance: .25, curvature: .55, droop: .25,
      tipCurl: 0, radiusRatio: .66, childCount: 4, childAngle: 52, childLength: .45, childDroop: .3, deadCount: 0, tierGradient: .45 },
    leaves: { clumpFill: 3.5, clumpFillScale: 1.45, leafSeed: 3 },
  },
  'broadleaf-sakura': {
    kind: 'broadleaf', name: '樱花 · 盆景古树', seed: 16392,
    trunk: {
      ...broadTrunk, height: 5.55, radius: .31, taper: 1.12, flare: .88, flareHeight: .78,
      wobble: .34, lean: .35, leanAngle: 180, gnarl: .52, surfaceRoots: 5, barkColor: '#765666', forkHeight: .48,
      spine: [[0, 0, 0], [.22, .42, .06], [.54, .92, .15], [.62, 1.42, .22], [.48, 1.92, .18], [.22, 2.38, .1], [-.05, 2.75, .04]],
    },
    crown: { base: .46, top: 1, width: 3.05, depth: .86, roundness: 2.5, topBias: 1.3, coneShape: 1, irregularity: .42, canopyLift: .36, padFlatten: .46 },
    branches: { count: 6, perWhorl: 1, angle: 26, angleTop: 58, reach: .95, lengthVariance: .22, curvature: .62, droop: .22,
      tipCurl: 0, radiusRatio: .62, childCount: 4, childAngle: 52, childLength: .44, childDroop: .28, deadCount: 0, tierGradient: .45 },
    leaves: {
      cardType: 'quad', leafSize: .66, leafPivot: .48, leavesPerTwig: 9, clumpFill: 6.4, clumpFillScale: 1.42,
      faceOutward: .9, cameraFacing: .3, normalSpherize: .85, aoStrength: .2, alphaCutoff: .46, pruneInner: .22,
      tintInner: '#c44d74', tintOuter: '#fcb9d0', tintVariance: .16, leafSeed: 7,
    },
    shading: { leafStyle: 'sakura', translucency: .56, rimLight: .42, shadowShift: .36, topWarmth: .32, softSelfShadow: true, petals: 24 },
  },
  'broadleaf-maple': {
    kind: 'broadleaf', name: '红枫 · 绯秋', seed: 5411,
    trunk: { ...broadTrunk, height: 5.8, radius: .24, flare: .72, wobble: .24, lean: .42, gnarl: .42, surfaceRoots: 4, barkColor: '#564944', forkHeight: .42 },
    crown: { base: .36, top: 1, width: 3.25, depth: .9, roundness: 2.4, topBias: 1.28, coneShape: 1, irregularity: .52, canopyLift: .32, padFlatten: .48 },
    branches: { count: 6, perWhorl: 1, angle: 28, angleTop: 60, reach: .94, lengthVariance: .24, curvature: .54, droop: .2,
      tipCurl: 0, radiusRatio: .6, childCount: 4, childAngle: 50, childLength: .44, childDroop: .24, deadCount: 0, tierGradient: .45 },
    leaves: {
      cardType: 'quad', leafSize: .72, leafPivot: .3, leavesPerTwig: 8, clumpFill: 5.2, clumpFillScale: 1.4,
      faceOutward: .82, cameraFacing: .35, normalSpherize: .8, aoStrength: .3, alphaCutoff: .44,
      tintInner: '#9e1f1b', tintOuter: '#ff8a36', tintVariance: .22, leafSeed: 11,
    },
    shading: { leafStyle: 'maple', translucency: .58, rimLight: .38, shadowShift: .32, topWarmth: .42, softSelfShadow: true, petals: 18 },
  },
  'broadleaf-willow': {
    kind: 'broadleaf', name: '垂柳 · 轻丝', seed: 6329,
    trunk: { ...broadTrunk, height: 6.4, radius: .3, flare: .85, wobble: .28, lean: .55, gnarl: .42, surfaceRoots: 5, barkColor: '#625648', forkHeight: .44 },
    crown: { base: .34, top: 1, width: 3.55, depth: .94, roundness: 2.0, topBias: 1.48, coneShape: 1, irregularity: .38, canopyLift: .16, padFlatten: .08 },
    branches: { count: 7, perWhorl: 1, angle: 32, angleTop: 64, reach: .95, lengthVariance: .2, curvature: .65, droop: .85,
      tipCurl: 0, radiusRatio: .58, childCount: 4, childAngle: 44, childLength: .5, childDroop: .88, deadCount: 0, tierGradient: .45 },
    leaves: {
      twigUpBias: -.48, twigGravity: -.85, twigLength: .52,
      cardType: 'drape', leafSize: 1.58, leafAspect: .52, leafSizeVariance: .36, leafPivot: 0, leavesPerTwig: 4, clumpFill: 2.8, clumpFillScale: 1.32,
      faceOutward: .55, upAlign: 0, leafAngle: 0, randomRoll: 0, randomTilt: 0, leafFold: .06, leafCurl: -.18,
      cameraFacing: 0, normalSpherize: .78, aoStrength: .36, alphaCutoff: .38,
      tintInner: '#356b30', tintOuter: '#d8f27e', tintVariance: .16, leafSeed: 19,
    },
    shading: { leafStyle: 'willow', translucency: .54, rimLight: .36, shadowShift: .32, topWarmth: .4, softSelfShadow: true, petals: 0 },
  },
  'conifer-standard': {
    kind: 'conifer', name: '松树 · 标准', seed: 1301, trunk: conTrunk,
    crown: { base: .18, top: 1, width: 2.35, depth: 1, roundness: 2, topBias: 1, coneShape: .86, irregularity: .2 },
    branches: { count: 10, perWhorl: 6, angle: -44, angleTop: -62, reach: 1.02, lengthVariance: .22, curvature: .18, droop: .12,
      tipCurl: .42, radiusRatio: .22, childCount: 0, childAngle: 42, childLength: .42, childDroop: .45, deadCount: 2, tierGradient: .25 },
  },
  'conifer-dense': {
    kind: 'conifer', name: '松树 · 茂密', seed: 2207,
    trunk: { ...conTrunk, height: 7.4, radius: .3 },
    crown: { base: .14, top: 1, width: 2.55, depth: 1, roundness: 2, topBias: 1, coneShape: .78, irregularity: .16 },
    branches: { count: 12, perWhorl: 7, angle: -42, angleTop: -58, reach: 1.05, lengthVariance: .16, curvature: .15, droop: .1,
      tipCurl: .38, radiusRatio: .22, childCount: 0, childAngle: 40, childLength: .42, childDroop: .4, deadCount: 1, tierGradient: .22 },
    fronds: { width: .5, cardAspect: .64, overhang: .28 },
  },
  'conifer-tall': {
    kind: 'conifer', name: '松树 · 高瘦', seed: 3911,
    trunk: { ...conTrunk, height: 10.2, radius: .27, wobble: .09, lean: .18 },
    crown: { base: .22, top: 1, width: 1.95, depth: 1, roundness: 2, topBias: 1, coneShape: .95, irregularity: .24 },
    branches: { count: 12, perWhorl: 5, angle: -50, angleTop: -66, reach: 1.0, lengthVariance: .26, curvature: .22, droop: .14,
      tipCurl: .45, radiusRatio: .22, childCount: 0, childAngle: 44, childLength: .4, childDroop: .5, deadCount: 4, tierGradient: .3 },
    fronds: { cardAspect: .52, overhang: .26 },
  },
  'shrub-round': {
    kind: 'broadleaf', name: '灌木 · 圆球', seed: 5150,
    trunk: { ...broadTrunk, height: 1.7, radius: .07, taper: 1, flare: .3, flareLobes: 4, flareHeight: .1, wobble: .04, lean: .05,
      barkRidges: 5, barkDepth: .04, forkHeight: .06 },
    crown: { base: .1, top: 1, width: 1.15, depth: .9, roundness: 2.3, topBias: 1, coneShape: 1, irregularity: .45 },
    branches: { count: 11, perWhorl: 1, angle: 55, angleTop: 80, reach: .95, lengthVariance: .2, curvature: .35, droop: .1,
      tipCurl: 0, radiusRatio: .8, childCount: 3, childAngle: 45, childLength: .45, childDroop: .15, deadCount: 0, tierGradient: .45 },
    leaves: { leafSize: .36, twigLength: .3, twigFrequency: 9, leavesPerTwig: 6, clumpFill: 10, clumpFillScale: 1.6,
      limbLeafFrequency: 4, cardType: 'cross', cameraFacing: .25, pruneInner: .2 },
  },
  'shrub-spread': {
    kind: 'broadleaf', name: '灌木 · 低矮宽丛', seed: 6402,
    trunk: { ...broadTrunk, height: 1.15, radius: .06, taper: 1, flare: .25, flareLobes: 4, flareHeight: .08, wobble: .05, lean: .08,
      barkRidges: 5, barkDepth: .04, forkHeight: .05 },
    crown: { base: .08, top: 1, width: 1.75, depth: .8, roundness: 3, topBias: .8, coneShape: 1, irregularity: .7 },
    branches: { count: 13, perWhorl: 1, angle: 22, angleTop: 62, reach: .97, lengthVariance: .3, curvature: .45, droop: .22,
      tipCurl: 0, radiusRatio: .8, childCount: 3, childAngle: 50, childLength: .4, childDroop: .25, deadCount: 0, tierGradient: .45 },
    leaves: { leafSize: .3, twigLength: .28, twigFrequency: 10, leavesPerTwig: 5, clumpFill: 9, clumpFillScale: 1.5,
      limbLeafFrequency: 4, cardType: 'fan', fanCount: 3, fanSpread: 80, cameraFacing: .2, pruneInner: .15, leafSeed: 7 },
  },
  'conifer-shrub': {
    kind: 'conifer', name: '针叶灌木 · 刺柏', seed: 7702,
    trunk: { ...conTrunk, height: 2.3, radius: .09, flare: .4, flareHeight: .2, barkRidges: 7, wobble: .06, lean: .08 },
    crown: { base: .12, top: 1, width: 1.02, depth: 1, roundness: 2, topBias: 1, coneShape: .76, irregularity: .28 },
    branches: { count: 7, perWhorl: 6, angle: -34, angleTop: -52, reach: 1.0, lengthVariance: .22, curvature: .2, droop: .1,
      tipCurl: .35, radiusRatio: .25, childCount: 0, childAngle: 44, childLength: .42, childDroop: .4, deadCount: 0, tierGradient: .2 },
    fronds: { width: .2, drop: .32, drapeTilt: 24, tuft: .9, cardAspect: .62, overhang: .25, arch: .1 },
  },
  'grass-clump': {
    kind: 'grass', name: '草丛 · 宽叶放射', seed: 42,
    trunk: { ...broadTrunk, height: .85, radius: .02 }, crown: { base: -.5, top: 1, width: .85, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .25 },
    branches: { ...stubBranches },
    ground: {
      mode: 'blade', count: 7, length: .76, lengthVariance: .22, width: .26, widthVariance: .18, widthFullness: .68,
      spread: .04, radialBias: .7, angleJitter: 8, sideSwirl: 6,
      lean: 36, leanVariance: 10, arch: .32, bendVariance: .10, droop: .34, cup: .18, twist: 12,
      across: 2, segments: 11, colorTones: true, spherize: .22,
      tintBase: '#215c26', tintTip: '#8be05c', tintVariance: .12, aoStrength: .34,
    },
  },
  'grass-narrow': {
    kind: 'grass', name: '草丛 · 尖长弯叶', seed: 108,
    trunk: { ...broadTrunk, height: 1.05, radius: .02 }, crown: { base: -.5, top: 1, width: .95, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    ground: {
      mode: 'blade', count: 10, length: .98, lengthVariance: .32, width: .13, widthVariance: .2, widthFullness: .95,
      spread: .06, radialBias: .7, angleJitter: 8, sideSwirl: 6,
      lean: 26, leanVariance: 12, arch: .42, bendVariance: .12, droop: .36, cup: .14, twist: 18,
      across: 2, segments: 12, colorTones: true, spherize: .24,
      tintBase: '#276424', tintTip: '#9ee862', tintVariance: .14, aoStrength: .36,
    },
  },
  'grass-dense': {
    kind: 'grass', name: '草丛 · 密集窄叶', seed: 256,
    trunk: { ...broadTrunk, height: .95, radius: .02 }, crown: { base: -.5, top: 1, width: .78, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    ground: {
      mode: 'blade', count: 26, length: .86, lengthVariance: .38, width: .085, widthVariance: .32, widthFullness: 1.12,
      spread: .09, radialBias: .7, angleJitter: 10, sideSwirl: 3,
      lean: 18, leanVariance: 14, arch: .24, bendVariance: .10, droop: .18, cup: .12, twist: 16,
      across: 2, segments: 11, colorTones: true, spherize: .26,
      tintBase: '#1d5421', tintTip: '#84d850', tintVariance: .15, aoStrength: .4,
    },
  },
  'grass-tall': {
    kind: 'grass', name: '高草 · 芦苇丛', seed: 913,
    trunk: { ...broadTrunk, height: 1.6, radius: .02 }, crown: { base: -.4, top: 1, width: .85, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .4 },
    branches: { ...stubBranches },
    ground: {
      mode: 'blade', count: 32, length: 1.45, lengthVariance: .32, width: .075, widthVariance: .25, widthFullness: 1.08,
      spread: .16, radialBias: .72, angleJitter: 10, sideSwirl: 6,
      lean: 16, leanVariance: 12, arch: .34, bendVariance: .12, droop: .26, cup: .11, twist: 22,
      across: 2, segments: 12, colorTones: true, spherize: .26,
      tintBase: '#4c6e2c', tintTip: '#e6e48a', tintVariance: .16, aoStrength: .38,
    },
  },
  'palm-tropical': {
    kind: 'palm', name: '棕榈 · 热带经典', seed: 3104,
    trunk: { ...conTrunk, height: 4.7, radius: .23, taper: .72, flare: .45, flareLobes: 5, flareHeight: .38, wobble: .05, lean: .95, barkRidges: 0, barkDepth: 0 },
    crown: { base: .58, top: 1.25, width: 2.7, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .15 },
    branches: { ...stubBranches },
  },
  'palm-stout': {
    kind: 'palm', name: '棕榈 · 粗干矮棕', seed: 4408,
    trunk: { ...conTrunk, height: 3.6, radius: .34, taper: .62, flare: .55, flareLobes: 6, flareHeight: .46, wobble: .04, lean: .35, barkRidges: 0, barkDepth: 0 },
    crown: { base: .48, top: 1.3, width: 2.8, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .18 },
    branches: { ...stubBranches },
    palm: { bend: .35, sCurve: .15, ringCount: 13, ringStep: .22, frondCount: 17, frondLength: 2.85, frondWidth: .76, frondArch: 1.18, frondPitch: 40, coconuts: 4 },
  },
  'palm-curved': {
    kind: 'palm', name: '棕榈 · 弯干海滩', seed: 5512,
    trunk: { ...conTrunk, height: 4.8, radius: .22, taper: .68, flare: .42, flareLobes: 5, flareHeight: .36, wobble: .05, lean: 2.3, barkRidges: 0, barkDepth: 0 },
    crown: { base: .46, top: 1.24, width: 2.6, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .15 },
    branches: { ...stubBranches },
    palm: { bend: 2.35, sCurve: 1.2, ringCount: 20, ringStep: .16, frondCount: 13, frondLength: 2.65, frondWidth: .66, frondArch: 1.35, frondPitch: 34, coconuts: 3 },
  },
  'shrub-flower': {
    kind: 'broadleaf', name: '灌木 · 开花宽丛', seed: 6402,
    trunk: { ...broadTrunk, height: 1.15, radius: .06, taper: 1, flare: .25, flareLobes: 4, flareHeight: .08, wobble: .05, lean: .08,
      barkRidges: 5, barkDepth: .04, forkHeight: .05 },
    crown: { base: .08, top: 1, width: 1.75, depth: .8, roundness: 3, topBias: .8, coneShape: 1, irregularity: .7 },
    branches: { count: 13, perWhorl: 1, angle: 22, angleTop: 62, reach: .97, lengthVariance: .3, curvature: .45, droop: .22,
      tipCurl: 0, radiusRatio: .8, childCount: 3, childAngle: 50, childLength: .4, childDroop: .25, deadCount: 0, tierGradient: .45 },
    leaves: { leafSize: .3, twigLength: .28, twigFrequency: 10, leavesPerTwig: 5, clumpFill: 9, clumpFillScale: 1.5,
      limbLeafFrequency: 4, cardType: 'fan', fanCount: 3, fanSpread: 80, cameraFacing: .2, pruneInner: .15, leafSeed: 7 },
    flowers: { enabled: true, count: 95, sizeRatio: .95, clumping: .78, clusterCount: 7, outerShell: .78, surfaceOffset: .16, faceOutward: 1, cardType: 'quad' },
  },
  'flowerbed-stemmed': {
    kind: 'flowerbed', name: '花丛 · 有植物杆', seed: 8401,
    trunk: { ...broadTrunk, height: .65, radius: .02 },
    crown: { base: -.35, top: 1, width: .85, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    flowerbed: { withStems: true, count: 28, spread: .65, height: .48, stemLeaves: 3, stemLeafSize: .17, flowerSize: .19, tintInner: '#e08a14', tintOuter: '#ffe44d' },
  },
  'flowerbed-pure': {
    kind: 'flowerbed', name: '花丛 · 纯花版本', seed: 8409,
    trunk: { ...broadTrunk, height: .45, radius: .02 },
    crown: { base: -.45, top: 1, width: .82, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    flowerbed: { withStems: false, count: 34, spread: .68, height: .22, heightVariance: .42, flowerSize: .17, headTilt: 22, cardType: 'quad', tintInner: '#d64526', tintOuter: '#ff8a61' },
  },
  'fern': {
    kind: 'fern', name: '蕨类', seed: 1212,
    trunk: { ...broadTrunk, height: .9, radius: .02 }, crown: { base: -.3, top: 1, width: 1.05, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    ground: { mode: 'card', count: 16, length: 1.05, lengthVariance: .2, width: .19, spread: .06, lean: 40, arch: .92, twist: 12, planes: 1, fold: 22,
      segments: 7, spherize: .55, tintBase: '#4b823c', tintTip: '#eaffcc', aoStrength: .45, alphaCutoff: .32 },
  },
} as const satisfies Record<string, Partial<Omit<TreeSpec, 'leaves' | 'fronds' | 'ground' | 'palm' | 'flowers' | 'flowerbed' | 'shading'>> & { leaves?: Partial<LeafParams>; fronds?: Partial<FrondSpec>; ground?: Partial<GroundSpec>; palm?: Partial<PalmSpec>; flowers?: Partial<FlowerSpec>; flowerbed?: Partial<FlowerBedSpec>; shading?: Partial<ShadingSpec> }>

export type PresetId = keyof typeof presets
export const presetIds = Object.keys(presets) as PresetId[]

export function presetSpec(id: PresetId, seed?: number): TreeSpec {
  const p = presets[id] as unknown as Partial<TreeSpec> & { leaves?: Partial<LeafParams>; fronds?: Partial<FrondSpec>; ground?: Partial<GroundSpec>; palm?: Partial<PalmSpec>; flowers?: Partial<FlowerSpec>; flowerbed?: Partial<FlowerBedSpec>; shading?: Partial<ShadingSpec> }
  return {
    schemaVersion: 2, kind: p.kind!, name: p.name!, seed: seed ?? p.seed!,
    trunk: { ...broadTrunk, ...p.trunk! }, crown: { canopyLift: 0, padFlatten: 0, ...p.crown! }, branches: { ...p.branches! },
    leaves: parseLeafParams({ ...defaultLeafParams, ...(p.leaves ?? {}) }),
    fronds: { ...defaultFronds, ...(p.fronds ?? {}) },
    ground: { ...defaultGround, ...(p.ground ?? {}) },
    palm: { ...defaultPalm, ...(p.palm ?? {}) },
    flowers: { ...defaultFlowers, ...(p.flowers ?? {}) },
    flowerbed: { ...defaultFlowerBed, ...(p.flowerbed ?? {}) },
    shading: { ...defaultShading, ...(p.shading ?? {}) },
    optimize: { ...defaultOptimize },
    handles: [],
  }
}

/** Light validation for imported JSON: fills missing groups from the preset of the same kind. */
export function parseTreeSpec(value: unknown): TreeSpec {
  if (typeof value !== 'object' || value === null) throw new Error('树配置必须是对象')
  const data = value as Partial<TreeSpec>
  if (data.schemaVersion !== 2) throw new Error('需要 schemaVersion 2 的树配置')
  if (!treeKinds.includes(data.kind as TreeKind)) throw new Error('未知树种类型')
  const base = presetSpec(({ broadleaf: 'broadleaf-round', conifer: 'conifer-standard', palm: 'palm-tropical', grass: 'grass-clump', fern: 'fern', flowerbed: 'flowerbed-stemmed' } as const)[data.kind as TreeKind])
  const finite = (group: Record<string, unknown>, fallback: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...fallback }
    for (const [k, v] of Object.entries(group ?? {})) {
      if (!(k in fallback)) continue
      if (typeof fallback[k] === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) throw new Error('参数 ' + k + ' 无效')
      out[k] = v
    }
    return out
  }
  const handles = Array.isArray(data.handles) ? data.handles.map((h, i) => {
    const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n)) ? v as XYZ : [0, 0, 0] as XYZ
    return { id: Number(h.id ?? i), kind: h.kind === 'bare' ? 'bare' : 'shape', anchor: vec(h.anchor), offset: vec(h.offset),
      radius: Math.max(.05, Number(h.radius) || 1) } as CrownHandle
  }) : []
  const clampNum = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined
  const branchEdits: BranchEdit[] = []
  if (Array.isArray(data.branchEdits)) {
    const seen = new Set<number>()
    for (const raw of data.branchEdits) {
      if (!raw || typeof raw !== 'object') continue
      const id = Number(raw.id)
      if (!Number.isInteger(id) || id < 0 || seen.has(id)) continue
      seen.add(id)
      const edit: BranchEdit = { id }
      const ls = clampNum(raw.lengthScale, .25, 2.5); if (ls !== undefined && Math.abs(ls - 1) > 1e-4) edit.lengthScale = ls
      const rs = clampNum(raw.radiusScale, .3, 2.5); if (rs !== undefined && Math.abs(rs - 1) > 1e-4) edit.radiusScale = rs
      const pd = clampNum(raw.pitchDelta, -65, 65); if (pd !== undefined && Math.abs(pd) > 1e-4) edit.pitchDelta = pd
      const yd = clampNum(raw.yawDelta, -180, 180); if (yd !== undefined && Math.abs(yd) > 1e-4) edit.yawDelta = yd
      const gd = clampNum(raw.gravityDelta, -1.5, 1.5); if (gd !== undefined && Math.abs(gd) > 1e-4) edit.gravityDelta = gd
      if (Array.isArray(raw.spineOffsets) && raw.spineOffsets.length > 0) {
        const offs = raw.spineOffsets.slice(0, 6).map(p =>
          Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n))
            ? [p[0], p[1], p[2]] as XYZ
            : [0, 0, 0] as XYZ)
        if (offs.some(o => o[0] * o[0] + o[1] * o[1] + o[2] * o[2] > 1e-8)) edit.spineOffsets = offs
      }
      if (raw.pruned === true && id !== 0) edit.pruned = true
      if (raw.bare === true) edit.bare = true
      if (Object.keys(edit).length > 1) branchEdits.push(edit)
    }
  }
  const parsedTrunk = finite(data.trunk as never, base.trunk as never) as unknown as TrunkSpec
  const rawSpine = (data.trunk as Partial<TrunkSpec> | undefined)?.spine
  if (Array.isArray(rawSpine) && rawSpine.length >= 3) {
    const valid = rawSpine.filter(p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n))) as XYZ[]
    if (valid.length >= 3) parsedTrunk.spine = valid
  }
  return {
    schemaVersion: 2, kind: data.kind as TreeKind, name: String(data.name ?? base.name),
    seed: Number.isInteger(data.seed) ? data.seed! : base.seed,
    trunk: parsedTrunk,
    crown: finite(data.crown as never, base.crown as never) as unknown as CrownSpec,
    branches: finite(data.branches as never, base.branches as never) as unknown as BranchSpec,
    leaves: parseLeafParams(data.leaves),
    fronds: finite(data.fronds as never, base.fronds as never) as unknown as FrondSpec,
    ground: finite(data.ground as never, base.ground as never) as unknown as GroundSpec,
    palm: finite(data.palm as never, base.palm as never) as unknown as PalmSpec,
    flowers: finite(data.flowers as never, base.flowers as never) as unknown as FlowerSpec,
    flowerbed: finite(data.flowerbed as never, base.flowerbed as never) as unknown as FlowerBedSpec,
    shading: finite(data.shading as never, base.shading as never) as unknown as ShadingSpec,
    optimize: finite(data.optimize as never, base.optimize as never) as unknown as OptimizeSpec,
    handles,
    ...(branchEdits.length ? { branchEdits } : {}),
  }
}

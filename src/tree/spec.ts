// Unified tree specification (schema v2) shared by broadleaf and conifer.
import { botanicalTextureKeys, type BotanicalTextureKey } from './botanical-textures'
import { botanicalLayouts, type BotanicalLayout } from './botanical-layout'
export { botanicalLayouts, botanicalLayoutLabels, type BotanicalLayout } from './botanical-layout'
import { defaultLeafParams, parseLeafParams, type LeafParams } from '../broadleaf/leaves'
import {
  defaultLeafNormalEdit, parseLeafNormalEdit,
  type LeafNormalEditSpec, type LeafNormalMode, type NormalBrushKind, type NormalBrushStroke,
} from './leaf-normals'
import { parseLeafEditSpec, type LeafEditSpec } from './leaf-edits'
import {
  defaultTrunkSculpt, parseTrunkSculpt, woodSculptStyleMeta,
  type BarkUvMode, type TrunkSculptSpec, type WoodSculptStyleId,
} from './wood-sculpt'
export {
  defaultLeafNormalEdit, leafNormalModes, normalBrushKinds,
  type LeafNormalEditSpec, type LeafNormalMode, type NormalBrushKind, type NormalBrushStroke,
} from './leaf-normals'
export {
  cloneLeafEditSpec, defaultLeafEditSpec, hasLeafEdits, parseLeafEditSpec,
  type LeafBrushKind, type LeafBrushStroke, type LeafClumpEdit, type LeafEditSpec,
} from './leaf-edits'
export {
  barkUvModes, cloneTrunkSculpt, defaultTrunkSculpt, isWoodSculptActive, parseTrunkSculpt,
  woodSculptStyleIds, woodSculptStyleMeta,
  type BarkUvMode, type TrunkSculptSpec, type WoodSculptStyleId,
} from './wood-sculpt'

export const treeKinds = ['broadleaf', 'conifer', 'palm', 'bamboo', 'lotus', 'grass', 'fern', 'flowerbed', 'botanical'] as const
export type TreeKind = typeof treeKinds[number]
export const bambooStyles = ['realistic', 'chibi'] as const
export type BambooStyle = typeof bambooStyles[number]
export const leafStyles = ['default', 'cloud', 'oak', 'sakura', 'maple', 'willow', 'bush', 'flower', 'painted', 'feathery'] as const
export type LeafStyle = typeof leafStyles[number]
export const barkStyles = ['default', 'birch', 'driftwood', 'moss'] as const
export type BarkStyle = typeof barkStyles[number]
export const treeForms = ['free', 'meadow-birch'] as const
export type TreeForm = typeof treeForms[number]
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
  barkStyle?: BarkStyle // unified bark appearance style ('default' | 'birch' | 'driftwood' | 'moss')
  treeForm?: TreeForm   // unified skeleton form provider ('free' | 'meadow-birch')
  barkColor?: string    // custom bark base hex color (default #5b4636)
  barkScale?: number    // 3D procedural / triplanar bark projection density (0.25..4, default 1.0)
  barkDetail?: number   // 3D procedural bark relief/bump & grain strength (0..1.5, default 0.72)
  barkTint?: number     // custom bark image tint blend with barkColor (0..1, default 0.45)
  barkMoss?: number     // 0..1 world-space upward-facing & root-crevice 3D velvety moss coverage
  barkMossColor?: string // 3D world-space moss base hex color (default #5d9132)
  barkRootAO?: number   // 0..1 grounded root-collar contact shadow & earth dampness
  spine?: XYZ[]         // optional traced/custom 3D trunk centerline in local meters ([0,0,0] -> fork)
  barkRidges: number    // vertical ridge count
  barkDepth: number     // ridge depth (fraction of radius)
  forkHeight: number    // broadleaf: fraction of height where the trunk dissolves into limbs
  sculpt?: TrunkSculptSpec // high-detail sculpted bark wrinkles, flow-UV displacement & braided wood strands
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
  /** Optional vertical silhouette profile curve `[[u, scale], ...]` (`u` in [0,1] bottom->top, `scale` in [0.15, 1.85]). */
  profileCurve?: [number, number][]
}

export interface BranchSpec {
  count: number         // broadleaf primary limbs / conifer whorls
  perWhorl: number      // conifer branches per whorl
  startHeight: number   // broadleaf: lowest primary limb socket along trunk (0.05..0.92)
  heightSpan: number    // broadleaf: upward distribution span along trunk (0.05..0.95)
  azimuthOffset: number // global azimuth rotation around trunk axis (deg, -180..180)
  angle: number         // elevation at the bottom (deg, + up)
  angleTop: number      // elevation at the top (deg)
  reach: number         // tip distance as fraction of envelope radius
  lengthVariance: number
  curvature: number     // bow of the limb (broadleaf) / horizontal swing (conifer)
  droop: number         // gravity sag along the branch
  tipCurl: number       // conifer upturned tips
  radiusRatio: number   // limb root radius / parent radius
  childCount: number    // sub-branches per branch
  childStart: number    // sub-branch start socket along parent limb (0.05..0.85)
  childAngle: number    // deg from parent axis
  childLength: number   // fraction of parent length
  childDroop: number
  deadCount: number     // bare stubs below the crown
  tierGradient: number  // conifer: >0 makes lower tiers far apart and upper tiers tight
  offsetX: number       // global branch assembly X translation (m)
  offsetY: number       // global branch assembly Y translation (m)
  offsetZ: number       // global branch assembly Z translation (m)
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
  socketDelta?: number  // -0.95..0.95 slide branch root along parent spline t (ignored on trunk)
  offset?: XYZ          // free 3D root translation [dx, dy, dz] in meters (moves branch + descendants)
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

export const flowerBedLayouts = ['dome', 'square', 'rect', 'ring', 'cluster', 'row'] as const
export type FlowerBedLayout = typeof flowerBedLayouts[number]

/** Standalone ground flower patch template: with stems+leaves OR pure blossom heads. */
export interface FlowerBedSpec {
  withStems: boolean      // true = curved green stems + stem leaves + blossoms; false = pure blossoms only
  layout: FlowerBedLayout // spatial distribution: dome (spherical), square, rect strip, ring, multi-cluster, rows
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

export type TreeAccent = 'none' | 'wishing'

/** Parameterized ancient-tree decorative accents (moss-capped boulders, flat-folded silk sashes,
 *  hanging cedar wishing plaques, and upper-canopy 4-point starlight motes). */
export interface WishingAccentsSpec {
  rockCount: number      // 0..8 sculpted moss-capped boulders around flared roots
  rockScale: number      // 0.4..1.8 boulder scale multiplier
  rockColor: string      // slate stone base hex color
  rockMossColor: string  // lush moss cap hex color on boulder tops
  ribbonWraps: number    // 0..4 draped flat-folded silk sashes & catenary swags around trunk arch
  ribbonColor: string    // silk sash & plaque tassel hex color
  plaqueCount: number    // 0..10 hanging cedar wishing plaques (trunk sash cluster + real limbs)
  plaqueScale: number    // 0.6..1.8 plaque size multiplier
  sparkles: boolean      // enable luminous 4-point starlight motes around upper canopy
  sparkleCount: number   // 0..36 floating starlight motes count
  sparkleColor: string   // starlight hex color
}

/** Stylized foliage look-dev shading: backlit SSS, cool shadow hue shift, sunlit rim, top warmth & painterly color-mass coherence. */
export interface ShadingSpec {
  leafStyle: LeafStyle    // built-in broadleaf foliage card silhouette
  translucency: number   // 0..1 backlit subsurface scattering glow
  rimLight: number       // 0..1 soft sunward silhouette rim
  shadowShift: number    // 0..1 enrich shadow tint (cool violet/teal) instead of muddy gray
  topWarmth: number      // 0..1 three-zone sunlight warmth on crown top vs cool underside
  colorMass?: number     // 0..1 coherent clump-level sunlit/shadow color-mass shading (Ghibli/hand-painted gouache mass)
  softSelfShadow: boolean // foliage casts shadows on trunk/floor without jagged card-on-card shadow triangles
  petals: number         // 0..60 lightweight floating falling petals / accent leaves around silhouette
  accent?: TreeAccent    // optional stylized decorative accents (e.g. mossy boulders + wishing ribbons/plaques)
}

/** Bamboo culms with narrow node rings and leaf cards along alternating shoots. */
export interface BambooSpec {
  style: BambooStyle       // slender living culms or a compact sculpted bamboo clump
  culmCount: number        // 1..7 culms in the cluster
  culmSpread: number       // 0..1.6 horizontal spread radius between culms (m)
  segments: number         // 3..18 internode segments per culm
  nodeBulge: number        // 0..0.65 flared node ring relief
  nodeZigzag: number       // 0..0.45 alternating angular joint deflection
  bend: number             // 0..2.2 overall graceful lean/arch (m)
  hollowTop: boolean       // open cut hollow bamboo rim at culm apex (signature Q-version cut top)
  culmColor: string        // base internode culm color
  nodeColor: string        // pale creamy/lime node ring highlight color
  canopyStart: number      // 0.15..0.85 height fraction where leaf clusters begin
  tiers: number            // 1..6 staggered groups of foliage-bearing branches
  branchLength: number     // 0.08..2.0 side bamboo branch reach (m)
  leafCount: number        // 12..260 alpha bamboo leaf cards per culm
  leafSize: number         // 0.2..1.6 bamboo leaf or spray card length (m)
  leafDroop: number        // 0..1 natural arch/droop of leaf cards
  tintInner: string        // shaded inner foliage color
  tintOuter: string        // sunlit outer foliage color
  tintVariance: number     // 0..0.5 per-card tint randomness
  aoStrength: number       // 0..1 interior darkening
  alphaCutoff: number      // 0.05..0.9 leaf card alpha test
}

/** Lotus & water-lily plant:
 *  - withStems = true : curved emergent green stems + 3D cupped wavy radial lotus leaves + elevated multi-tier lotus blossoms & buds
 *  - withStems = false: stemless floating water-lily pads (V-notched) + floating multi-tier lotus blossoms & buds */
export interface LotusSpec {
  withStems: boolean       // true = emergent stemmed lotus; false = floating stemless water-lily pads + lotus
  spread: number           // 0.4..4.5 cluster radius (m)
  leafCount: number        // 2..60 lotus pads
  leafSize: number         // 0.15..1.4 base pad diameter (m)
  leafSizeVariance: number // 0..0.75 big-medium-small size rhythm
  leafCup: number          // 0..0.85 3D funnel cupping depth
  leafWave: number         // 0..0.4 organic scalloped rim wave amplitude
  leafNotch: number        // 0..1 floating slit probability; shallow rim tears on stemmed leaves
  stemHeight: number       // 0.2..2.2 emergent stem height (m, stemmed mode)
  stemRadius: number       // 0.006..0.045 stem radius (m)
  stemCurve: number        // 0..1 graceful S-bend & outward fan lean
  stemColor: string        // stem green tint
  leafTintInner: string    // central hub / shaded leaf green
  leafTintOuter: string    // sunlit margin leaf green
  flowerCount: number      // 0..16 blooming multi-ring lotus flowers
  budCount: number         // 0..12 plump unopened/half-open lotus buds
  flowerSize: number       // 0.12..0.9 open lotus diameter (m)
  petalRings: number       // 2..4 concentric staggered petal rings
  petalsPerRing: number    // 5..12 petals per tier
  flowerOpen: number       // 0.15..1.0 petal opening spread
  flowerHeightBoost: number // -0.3..0.6 extra elevation of blooms above leaves (m, stemmed mode)
  petalBaseColor: string   // luminous inner petal base color
  petalTipColor: string    // radiant petal tip pigment
  stamenColor: string      // golden seedpod & stamen color
  tintVariance: number     // 0..0.4 per-pad organic hue/value variation
  alphaCutoff: number      // 0.05..0.9 leaf/petal alpha cutoff
}

export const botanicalModes = [
  'fern-clump',
  'blade-clump',
  'rosette-shrub',
  'hydrangea-shrub',
  'cosmos-shrub',
  'flower-groundcover',
  'clover-groundcover',
  'fine-herb',
] as const
export type BotanicalMode = typeof botanicalModes[number]

/** High-craft hand-painted stylized botanical plant system (16 studio archetypes with zero-halo 512 PNG alpha sprites). */
export interface BotanicalSpec {
  mode: BotanicalMode
  leafTexture: BotanicalTextureKey
  flowerTexture?: BotanicalTextureKey
  count: number          // primary fronds / blades / leaves / clovers
  spread: number         // horizontal footprint radius (m)
  height: number         // overall plant height (m)
  heightJitter: number   // 0..1 vertical height stratification & anti-overlap stagger across leaves
  layout: BotanicalLayout // horizontal distribution pattern (phyllotaxis / ring / scatter / clumps / fan)
  lateralJitter: number  // 0..1 horizontal left-right stagger, tangential offset & XY separation
  leafSize: number       // single leaf / frond / floret / rosette size (m)
  leafAspect: number     // blade width / length aspect ratio
  arch: number           // outward curvature / parabolic arch lift
  droop: number          // tip droop
  cup: number            // cross-section V-fold / saucer cupping
  stemCount: number      // primary branching stalks (shrubs / fine herbs)
  flowerClusters: number // flower balls (hydrangea) or blossoms (cosmos / wildflower)
  flowerSize: number     // single blossom diameter or hydrangea cluster radius (m)
  tintInner: string      // inner/shaded vertex color multiplier
  tintOuter: string      // outer/sunlit vertex color multiplier
  flowerTintInner: string
  flowerTintOuter: string
  stemTint: string
  aoStrength: number
  alphaCutoff: number
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
  bamboo: BambooSpec
  lotus: LotusSpec
  flowers: FlowerSpec
  flowerbed: FlowerBedSpec
  botanical?: BotanicalSpec
  shading: ShadingSpec
  accents?: WishingAccentsSpec
  normalEdit?: LeafNormalEditSpec
  leafEdits?: LeafEditSpec
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

export const defaultBamboo: BambooSpec = {
  style: 'realistic',
  culmCount: 1, culmSpread: .42, segments: 13, nodeBulge: .16, nodeZigzag: .05, bend: .43,
  hollowTop: false, culmColor: '#4a713b', nodeColor: '#a5b371',
  canopyStart: .43, tiers: 4, branchLength: 1.04, leafCount: 158, leafSize: .48, leafDroop: .36,
  tintInner: '#2e513b', tintOuter: '#86aa57', tintVariance: .12, aoStrength: .34, alphaCutoff: .37,
}

export const defaultLotus: LotusSpec = {
  withStems: true, spread: 1.42, leafCount: 11, leafSize: .70, leafSizeVariance: .46,
  leafCup: .23, leafWave: .075, leafNotch: 0,
  stemHeight: 1.15, stemRadius: .014, stemCurve: .58, stemColor: '#598149',
  leafTintInner: '#427954', leafTintOuter: '#81b764',
  flowerCount: 3, budCount: 2, flowerSize: .42, petalRings: 3, petalsPerRing: 7,
  flowerOpen: .74, flowerHeightBoost: .24,
  petalBaseColor: '#fff4f7', petalTipColor: '#ef6a98', stamenColor: '#ffd24a',
  tintVariance: .14, alphaCutoff: .36,
}

export const defaultBotanical: BotanicalSpec = {
  mode: 'rosette-shrub',
  leafTexture: 'heart-leaf-a',
  count: 44,
  spread: 0.45,
  height: 0.72,
  heightJitter: 0.36,
  layout: 'phyllotaxis',
  lateralJitter: 0.46,
  leafSize: 0.29,
  leafAspect: 1.0,
  arch: 0.28,
  droop: 0.16,
  cup: 0.17,
  stemCount: 11,
  flowerClusters: 6,
  flowerSize: 0.14,
  tintInner: '#4c8858',
  tintOuter: '#ffffff',
  flowerTintInner: '#bac4f8',
  flowerTintOuter: '#ffffff',
  stemTint: '#2b6a24',
  aoStrength: 0.56,
  alphaCutoff: 0.42,
}

export const defaultFlowers: FlowerSpec = {
  enabled: false, style: 'default', count: 75, sizeRatio: .8, sizeVariance: .28, outerShell: .76, surfaceOffset: .16,
  upBias: .5, clumping: .72, clusterCount: 7, cardType: 'quad', faceOutward: 1, cameraFacing: 0,
  tintInner: '#f0a6be', tintOuter: '#fff4f8', tintVariance: .14, alphaCutoff: .35, atlasCols: 1, atlasRows: 1, seed: 1,
}

export const defaultFlowerBed: FlowerBedSpec = {
  withStems: true, layout: 'dome', count: 28, spread: .65, height: .48, heightVariance: .35, lean: 18, bend: .28,
  stemRadius: .009, stemLeaves: 2, stemLeafSize: .15, flowerSize: .18, flowerSizeVariance: .24,
  headTilt: 24, cardType: 'cup', faceOutward: .45, tintInner: '#e08a14', tintOuter: '#ffe44d',
  stemTint: '#3e8432', tintVariance: .12, alphaCutoff: .35, atlasCols: 1, atlasRows: 1,
}

export const defaultOptimize: OptimizeSpec = {
  level: 0, woodDetail: 1, cullHiddenWood: false, flatCards: false, cardReduction: 0, targetTriangles: 3000,
}

export const defaultShading: ShadingSpec = {
  leafStyle: 'default', translucency: .45, rimLight: .32, shadowShift: .34, topWarmth: .36, colorMass: 0, softSelfShadow: true, petals: 0, accent: 'none',
}

export const defaultAccents: WishingAccentsSpec = {
  rockCount: 5,
  rockScale: 1,
  rockColor: '#587680',
  rockMossColor: '#6ca842',
  ribbonWraps: 3,
  ribbonColor: '#cc3b33',
  plaqueCount: 8,
  plaqueScale: 1,
  sparkles: true,
  sparkleCount: 18,
  sparkleColor: '#fff7b0',
}

const broadTrunk: TrunkSpec = {
  height: 6.2, radius: .25, taper: 1.15, flare: .55, flareLobes: 5, flareHeight: .55, wobble: .12, lean: .25,
  leanAngle: -1, gnarl: 0, surfaceRoots: 0, barkColor: '#5b4636', barkScale: 1, barkDetail: .72, barkTint: .45,
  barkMoss: 0, barkMossColor: '#5d9132', barkRootAO: .25,
  barkRidges: 9, barkDepth: .06, forkHeight: .48,
}
const conTrunk: TrunkSpec = {
  height: 8.4, radius: .28, taper: 1.2, flare: .72, flareLobes: 6, flareHeight: .7, wobble: .06, lean: .08,
  leanAngle: -1, gnarl: 0, surfaceRoots: 0, barkColor: '#5b4636', barkScale: 1, barkDetail: .72, barkTint: .45,
  barkMoss: 0, barkMossColor: '#5d9132', barkRootAO: .25,
  barkRidges: 11, barkDepth: .07, forkHeight: 1,
}

const defaultBranchPlacement = (kind: TreeKind) => ({
  startHeight: .58,
  heightSpan: .38,
  azimuthOffset: 0,
  childStart: kind === 'conifer' ? .06 : .26,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
})

const stubBranches: BranchSpec = {
  count: 2, perWhorl: 2, ...defaultBranchPlacement('broadleaf'), angle: 30, angleTop: 60, reach: .9, lengthVariance: .2, curvature: .3, droop: .2,
  tipCurl: 0, radiusRatio: .5, childCount: 0, childAngle: 45, childLength: .4, childDroop: .2, deadCount: 0, tierGradient: .45,
}

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
      cardType: 'drape', leafSize: 1.58, leafAspect: .52, leafSizeVariance: .36, leafPivot: 0, leavesPerTwig: 6, limbLeafFrequency: 3.5, clumpFill: 2.8, clumpFillScale: 1.32,
      faceOutward: .55, upAlign: 0, leafAngle: 0, randomRoll: 0, randomTilt: 0, leafFold: .06, leafCurl: -.18,
      cameraFacing: 0, normalSpherize: .78, aoStrength: .36, alphaCutoff: .38,
      tintInner: '#426b36', tintOuter: '#bddb83', tintVariance: .16, leafSeed: 19,
    },
    shading: { leafStyle: 'willow', translucency: .54, rimLight: .36, shadowShift: .32, topWarmth: .4, softSelfShadow: true, petals: 0 },
  },
  'broadleaf-wishing': {
    kind: 'broadleaf', name: '古树 · 仙韵祈愿', seed: 8824,
    trunk: {
      ...broadTrunk, height: 6.35, radius: .48, taper: 1.55, flare: 1.38, flareLobes: 6, flareHeight: 1.08,
      wobble: .08, lean: .12, barkRidges: 10, barkDepth: .082, forkHeight: .62,
      barkStyle: 'driftwood',
      barkColor: '#b59a78', barkScale: .82, barkDetail: .46, barkTint: .10,
      barkMoss: .56, barkMossColor: '#5c9430', barkRootAO: .42,
      gnarl: .48, surfaceRoots: 7,
      spine: [
        [0, 0, 0], [-.14, .48, .06], [-.28, .98, .12], [.14, 1.44, .16],
        [.80, 1.78, .18], [1.22, 2.14, .12], [.78, 2.62, .06], [.26, 3.12, .02], [.14, 3.68, -.02], [.06, 3.96, -.02],
      ],
    },
    crown: { base: .44, top: 1, width: 3.45, depth: .84, roundness: 2.5, topBias: 1.24, coneShape: 1, irregularity: .46, canopyLift: .42, padFlatten: .64 },
    branches: { count: 7, perWhorl: 1, angle: 16, angleTop: 56, reach: .98, lengthVariance: .26, curvature: .56, droop: .16,
      tipCurl: .06, radiusRatio: .68, childCount: 4, childAngle: 52, childLength: .46, childDroop: .18, deadCount: 0, tierGradient: .45 },
    leaves: {
      cardType: 'quad', leafSize: .78, leafPivot: .48, leavesPerTwig: 8, clumpFill: 6.2, clumpFillScale: 1.48,
      faceOutward: .88, cameraFacing: .28, normalSpherize: .88, aoStrength: .42, alphaCutoff: .38, pruneInner: .20,
      tintInner: '#3a725a', tintOuter: '#fefbc0', tintVariance: .16, atlasCols: 2, atlasRows: 2, leafSeed: 37,
    },
    shading: { leafStyle: 'oak', translucency: .60, rimLight: .46, shadowShift: .38, topWarmth: .64, softSelfShadow: true, petals: 14, accent: 'wishing' },
    accents: { ...defaultAccents },
  },
  'broadleaf-driftwood': {
    kind: 'broadleaf', name: '古木 · 绞缠枯树', seed: 9104,
    trunk: {
      ...broadTrunk, height: 6.2, radius: .46, taper: 1.38, flare: 1.48, flareLobes: 6, flareHeight: 1.25,
      wobble: .10, lean: .14, gnarl: .68, surfaceRoots: 0,
      barkColor: '#9e9284', barkScale: 1.0, barkDetail: .92, barkTint: .35, barkRootAO: .46,
      barkRidges: 6, barkDepth: .06, forkHeight: .64,
      spine: [
        [0, 0, 0], [-.14, .66, .06], [-.48, 1.42, .14], [-.70, 2.20, .16],
        [-.40, 2.94, .10], [.14, 3.54, .04], [.02, 4.02, -.04],
      ],
      sculpt: { ...woodSculptStyleMeta['ancient-driftwood'].spec },
    },
    crown: { base: .56, top: 1, width: 3.1, depth: .86, roundness: 2.3, topBias: 1.35, coneShape: 1, irregularity: .62, canopyLift: .50, padFlatten: .44 },
    branches: {
      count: 6, perWhorl: 1, angle: 26, angleTop: 64, reach: .94, lengthVariance: .34, curvature: .78, droop: .24,
      tipCurl: 0, radiusRatio: .56, childCount: 4, childAngle: 54, childLength: .48, childDroop: .32, deadCount: 2, tierGradient: .45,
    },
    leaves: {
      cardType: 'quad', leafSize: .60, leafPivot: .42, leavesPerTwig: 6, clumpFill: 2.4, clumpFillScale: 1.25,
      faceOutward: .85, cameraFacing: .2, normalSpherize: .78, aoStrength: .32, alphaCutoff: .44, pruneInner: .32,
      tintInner: '#3f523a', tintOuter: '#9db07c', tintVariance: .20, leafSeed: 31,
    },
    shading: { leafStyle: 'cloud', translucency: .42, rimLight: .35, shadowShift: .38, topWarmth: .30, softSelfShadow: true, petals: 0 },
  },
  'broadleaf-twisted-trunk': {
    kind: 'broadleaf', name: '盆景 · 扭纹古干', seed: 9208,
    trunk: {
      ...broadTrunk, height: 5.55, radius: .42, taper: 1.32, flare: 1.42, flareLobes: 5, flareHeight: 1.15,
      wobble: .08, lean: .10, gnarl: .54, surfaceRoots: 0,
      barkColor: '#b98d78', barkScale: 1.0, barkDetail: .78, barkTint: .30, barkRootAO: .34,
      barkRidges: 5, barkDepth: .06, forkHeight: .62,
      spine: [
        [0, 0, 0], [-.14, .44, .03], [-.72, .96, .09], [-1.22, 1.54, .14],
        [-.88, 2.14, .12], [-.18, 2.66, .06], [.32, 3.22, .02],
      ],
      sculpt: { ...woodSculptStyleMeta['stylized-twist'].spec },
    },
    crown: { base: .54, top: 1, width: 3.15, depth: .84, roundness: 2.5, topBias: 1.32, coneShape: 1, irregularity: .46, canopyLift: .48, padFlatten: .54 },
    branches: {
      count: 6, perWhorl: 1, angle: 24, angleTop: 60, reach: .95, lengthVariance: .24, curvature: .68, droop: .20,
      tipCurl: 0, radiusRatio: .58, childCount: 4, childAngle: 50, childLength: .45, childDroop: .24, deadCount: 0, tierGradient: .45,
    },
    leaves: {
      cardType: 'quad', leafSize: .66, leafPivot: .44, leavesPerTwig: 8, clumpFill: 4.8, clumpFillScale: 1.36,
      faceOutward: .88, cameraFacing: .25, normalSpherize: .84, aoStrength: .24, alphaCutoff: .44, pruneInner: .26,
      tintInner: '#365b34', tintOuter: '#9ec466', tintVariance: .16, leafSeed: 47,
    },
    shading: { leafStyle: 'cloud', translucency: .52, rimLight: .42, shadowShift: .34, topWarmth: .40, softSelfShadow: true, petals: 0 },
  },
  'broadleaf-poplar': {
    kind: 'broadleaf', name: '乔木 · 羽叶高冠树', seed: 6412,
    trunk: {
      ...broadTrunk, height: 10.2, radius: .20, taper: 1.35, flare: .55, flareLobes: 5, flareHeight: .60,
      wobble: .05, lean: .10, leanAngle: 15, gnarl: .06, surfaceRoots: 0,
      barkColor: '#8d6445', barkScale: 1.15, barkDetail: .78, barkTint: .28, barkMoss: .28, barkMossColor: '#4c7e22',
      barkRootAO: .46, barkRidges: 7, barkDepth: .05, forkHeight: .36,
    },
    crown: {
      base: .20, top: 1, width: 2.25, depth: .90, roundness: 1.50, topBias: .56, coneShape: 1,
      irregularity: .84, canopyLift: .18, padFlatten: .08,
      profileCurve: [[0, .44], [.18, .92], [.44, 1.08], [.66, .84], [.80, .46], [.92, .22], [1, .15]],
    },
    branches: {
      count: 13, perWhorl: 1, startHeight: .30, heightSpan: .64, azimuthOffset: 0,
      angle: 56, angleTop: 76, reach: .98, lengthVariance: .46, curvature: .38, droop: .02,
      tipCurl: 0, radiusRatio: .56, childCount: 4, childStart: .30, childAngle: 34, childLength: .48, childDroop: .06,
      deadCount: 0, tierGradient: .45,
    },
    leaves: {
      cardType: 'cross', leafSize: .86, leafSizeVariance: .44, leafTipScale: .80, leafAspect: 1.0, leafPivot: .34,
      twigFrequency: 5.0, twigStart: .36, twigEnd: 1.0, twigLength: .62, leavesPerTwig: 6, leafStart: .38, tipLeaves: 2,
      limbLeafFrequency: .8, leafJitter: .26, faceOutward: .68, upAlign: .22, randomRoll: 55, randomTilt: 24,
      leafFold: .16, leafCurl: -.08, pruneOuter: 1.18, pruneInner: .28, normalSource: 'clumps', normalSpherize: .64,
      clumpScale: 1.08, clumpFill: 2.2, clumpFillScale: 1.14, clumpFillDepth: .34, cameraFacing: 0,
      tintInner: '#0c300e', tintOuter: '#94f03e', tintVariance: .20, aoStrength: .86, alphaCutoff: .44, leafSeed: 64,
    },
    shading: { leafStyle: 'feathery', colorMass: 0, translucency: .56, rimLight: .28, shadowShift: .36, topWarmth: .54, softSelfShadow: true, petals: 0 },
  },
  'broadleaf-bonsai-tier': {
    kind: 'broadleaf', name: '盆景 · 卧枝云片古树', seed: 6494,
    trunk: {
      ...broadTrunk, height: 3.35, radius: .18, taper: 2.50, flare: .95, flareLobes: 5, flareHeight: .50,
      wobble: .04, lean: 0, leanAngle: 180, gnarl: .36, surfaceRoots: 3,
      barkColor: '#9a6e4b', barkScale: 1.20, barkDetail: .72, barkTint: .30, barkMoss: .34, barkMossColor: '#5c8a22',
      barkRootAO: .52, barkRidges: 6, barkDepth: .04, forkHeight: .54,
      spine: [
        [0, 0, 0], [.20, .36, .04], [-.10, .72, .06], [-.82, .86, .04],
        [-1.44, 1.14, .01], [-1.76, 1.66, -.02],
      ],
    },
    crown: {
      base: .34, top: 1, width: 2.30, depth: .86, roundness: 2.65, topBias: 1.38, coneShape: 1,
      irregularity: .54, canopyLift: .62, padFlatten: .80,
    },
    branches: {
      count: 6, perWhorl: 1, startHeight: .26, heightSpan: .70, azimuthOffset: 30,
      angle: 18, angleTop: 52, reach: 1.06, lengthVariance: .34, curvature: .54, droop: .02,
      tipCurl: 0, radiusRatio: .68, childCount: 5, childStart: .40, childAngle: 48, childLength: .42, childDroop: .02,
      deadCount: 0, tierGradient: .45,
    },
    leaves: {
      cardType: 'cross', leafSize: .56, leafSizeVariance: .30, leafTipScale: .88, leafAspect: 1.0, leafPivot: .42,
      twigFrequency: 7.8, twigStart: .52, twigEnd: 1.0, twigLength: .30, leavesPerTwig: 8, leafStart: .58, tipLeaves: 2,
      limbLeafFrequency: 0, leafJitter: .14, faceOutward: .58, upAlign: .64, randomRoll: 42, randomTilt: 16,
      leafFold: .12, leafCurl: -.04, pruneOuter: 1.14, pruneInner: .24, normalSource: 'clumps', normalSpherize: .84,
      clumpScale: 1.14, clumpFill: 14.0, clumpFillScale: 1.24, clumpFillDepth: .20, cameraFacing: 0,
      tintInner: '#1c2d06', tintOuter: '#9cb82c', tintVariance: .16, aoStrength: .82, alphaCutoff: .42, leafSeed: 88,
    },
    shading: { leafStyle: 'feathery', colorMass: 0, translucency: .32, rimLight: .20, shadowShift: .28, topWarmth: .48, softSelfShadow: true, petals: 0 },
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
    trunk: { ...conTrunk, height: 2.3, radius: .085, flare: .38, flareHeight: .2, barkRidges: 7, wobble: .05, lean: .06 },
    crown: { base: .10, top: 1, width: 1.05, depth: 1, roundness: 2, topBias: 1, coneShape: .74, irregularity: .24 },
    branches: { count: 10, perWhorl: 6, angle: -18, angleTop: -30, reach: .94, lengthVariance: .18, curvature: .14, droop: .08,
      tipCurl: .12, radiusRatio: .16, childCount: 0, childAngle: 42, childLength: .4, childDroop: .32, deadCount: 0, tierGradient: .18 },
    fronds: { width: .26, drop: .44, drapeTilt: 18, tuft: 1.15, cardAspect: .78, overhang: .36, arch: .04, cardsPerBranch: 1, cardCup: .14 },
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
  'bamboo-realistic': {
    kind: 'bamboo', name: '竹子 · 写实修长', seed: 5201,
    trunk: { ...broadTrunk, height: 6.8, radius: .095, taper: .75, flare: .10, flareHeight: .25, wobble: .03, lean: .15, barkColor: '#5c9428' },
    crown: { base: .34, top: 1, width: 1.85, depth: 1, roundness: 2, topBias: 1.25, coneShape: 1, irregularity: .25 },
    branches: { ...stubBranches },
    bamboo: {
      style: 'realistic', culmCount: 3, culmSpread: .36, segments: 12, nodeBulge: .20, nodeZigzag: .03, bend: .32,
      hollowTop: false, culmColor: '#5c9428', nodeColor: '#cde264',
      canopyStart: .38, tiers: 5, branchLength: .82, leafCount: 144, leafSize: .92, leafDroop: .58,
      tintInner: '#1c5d19', tintOuter: '#84c924', tintVariance: .14, aoStrength: .46, alphaCutoff: .36,
    },
    shading: { translucency: .32, rimLight: .18, shadowShift: .24, topWarmth: .24, colorMass: 0, softSelfShadow: true },
  },
  'bamboo-chibi': {
    kind: 'bamboo', name: '竹子 · Q版卡通', seed: 5219,
    trunk: { ...broadTrunk, height: 3.95, radius: .145, taper: .55, flare: .10, flareHeight: .25, wobble: .02, lean: .10, barkColor: '#6ea824' },
    crown: { base: .24, top: 1, width: 1.75, depth: 1, roundness: 2, topBias: 1.15, coneShape: 1, irregularity: .25 },
    branches: { ...stubBranches },
    bamboo: {
      style: 'chibi', culmCount: 3, culmSpread: .22, segments: 7, nodeBulge: .24, nodeZigzag: .03, bend: .14,
      hollowTop: true, culmColor: '#6ea824', nodeColor: '#d9eb5b',
      canopyStart: .34, tiers: 5, branchLength: .56, leafCount: 112, leafSize: 1.04, leafDroop: .58,
      tintInner: '#1e6318', tintOuter: '#93d622', tintVariance: .14, aoStrength: .48, alphaCutoff: .36,
    },
    shading: { translucency: .34, rimLight: .20, shadowShift: .22, topWarmth: .28, colorMass: 0, softSelfShadow: true },
  },
  'lotus-stemmed': {
    kind: 'lotus', name: '荷花 · 有杆挺水', seed: 6103,
    trunk: { ...broadTrunk, height: 1.55, radius: .02, barkColor: '#3e8534' },
    crown: { base: 0, top: 1, width: 1.55, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    lotus: {
      withStems: true, spread: 1.32, leafCount: 11, leafSize: .83, leafSizeVariance: .44,
      leafCup: .23, leafWave: .078, leafNotch: 0,
      stemHeight: 1.18, stemRadius: .013, stemCurve: .64, stemColor: '#547d44',
      leafTintInner: '#417952', leafTintOuter: '#82b161',
      flowerCount: 3, budCount: 2, flowerSize: .66, petalRings: 3, petalsPerRing: 8,
      flowerOpen: .72, flowerHeightBoost: .19,
      petalBaseColor: '#fff0ed', petalTipColor: '#dc6398', stamenColor: '#eec25a',
      tintVariance: .14, alphaCutoff: .36,
    },
    shading: { translucency: .38, rimLight: .2, shadowShift: .24, topWarmth: .24, softSelfShadow: true },
  },
  'lotus-floating': {
    kind: 'lotus', name: '荷花 · 无杆浮水', seed: 6117,
    trunk: { ...broadTrunk, height: .45, radius: .02, barkColor: '#3e8534' },
    crown: { base: -.2, top: 1, width: 1.95, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    lotus: {
      withStems: false, spread: 1.62, leafCount: 25, leafSize: .60, leafSizeVariance: .48,
      leafCup: .025, leafWave: .018, leafNotch: .94,
      stemHeight: .85, stemRadius: .016, stemCurve: .42, stemColor: '#3d8634',
      leafTintInner: '#356f56', leafTintOuter: '#7eab5e',
      flowerCount: 4, budCount: 2, flowerSize: .56, petalRings: 3, petalsPerRing: 8,
      flowerOpen: .91, flowerHeightBoost: 0,
      petalBaseColor: '#fff4f2', petalTipColor: '#d76d9a', stamenColor: '#eec25a',
      tintVariance: .16, alphaCutoff: .36,
    },
    shading: { translucency: .37, rimLight: .2, shadowShift: .24, topWarmth: .24, softSelfShadow: true },
  },
  'fern': {
    kind: 'fern', name: '蕨类', seed: 1212,
    trunk: { ...broadTrunk, height: .9, radius: .02 }, crown: { base: -.3, top: 1, width: 1.05, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    ground: { mode: 'card', count: 16, length: 1.05, lengthVariance: .2, width: .19, spread: .06, lean: 40, arch: .92, twist: 12, planes: 1, fold: 22,
      segments: 7, spherize: .55, tintBase: '#4b823c', tintTip: '#eaffcc', aoStrength: .45, alphaCutoff: .32 },
  },
  // --- 16 Studio-Grade Stylized Hand-Painted Botanical Plants (Phase 3 Full Library) ---
  'botanical-fern-a': {
    kind: 'botanical', name: '01 大蕨类 A', seed: 3011,
    trunk: { ...broadTrunk, height: .86, radius: .02 },
    crown: { base: 0, top: 1, width: 1.15, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'fern-clump', leafTexture: 'fern-frond-a',
      count: 24, spread: .09, height: .86, heightJitter: .40, layout: 'ring', lateralJitter: .44, leafSize: 1.00, leafAspect: .90,
      arch: .84, droop: .52, cup: .16, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#6ca872', tintOuter: '#fffef4', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#2b6a24', aoStrength: .38, alphaCutoff: .40,
    },
  },
  'botanical-large-grass-a': {
    kind: 'botanical', name: '02 大型草丛 A', seed: 3022,
    trunk: { ...broadTrunk, height: .82, radius: .02 },
    crown: { base: 0, top: 1, width: 1.02, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'blade-clump', leafTexture: 'broad-strap-leaf',
      count: 18, spread: .08, height: .82, heightJitter: .46, layout: 'phyllotaxis', lateralJitter: .54, leafSize: .96, leafAspect: .72,
      arch: .84, droop: .54, cup: .22, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#68a872', tintOuter: '#fffef6', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#2b6a24', aoStrength: .36, alphaCutoff: .40,
    },
  },
  'botanical-fern-b': {
    kind: 'botanical', name: '03 蕨类 B', seed: 3033,
    trunk: { ...broadTrunk, height: .74, radius: .02 },
    crown: { base: 0, top: 1, width: .98, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'fern-clump', leafTexture: 'fern-frond-b',
      count: 20, spread: .08, height: .74, heightJitter: .40, layout: 'ring', lateralJitter: .44, leafSize: .88, leafAspect: .90,
      arch: .82, droop: .48, cup: .14, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#74b278', tintOuter: '#ffffff', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#367c2c', aoStrength: .36, alphaCutoff: .40,
    },
  },
  'botanical-shrub-a': {
    kind: 'botanical', name: '04 阔叶灌木 A', seed: 4041,
    trunk: { ...broadTrunk, height: .72, radius: .02 },
    crown: { base: 0, top: 1, width: .45, depth: .96, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'rosette-shrub', leafTexture: 'heart-leaf-a',
      count: 44, spread: .45, height: .72, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .42, leafSize: .29, leafAspect: 1.0,
      arch: .28, droop: .16, cup: .17, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#4c8858', tintOuter: '#ffffff', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#2b6a24', aoStrength: .56, alphaCutoff: .42,
    },
  },
  'botanical-shrub-b': {
    kind: 'botanical', name: '05 阔叶灌木 B', seed: 4052,
    trunk: { ...broadTrunk, height: .54, radius: .02 },
    crown: { base: 0, top: 1, width: .35, depth: .96, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'rosette-shrub', leafTexture: 'heart-leaf-b',
      count: 46, spread: .35, height: .54, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .42, leafSize: .22, leafAspect: 1.0,
      arch: .26, droop: .16, cup: .16, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#5e9e64', tintOuter: '#ffffff', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#327428', aoStrength: .48, alphaCutoff: .42,
    },
  },
  'botanical-grass-a': {
    kind: 'botanical', name: '06 草丛 A', seed: 3061,
    trunk: { ...broadTrunk, height: .58, radius: .02 },
    crown: { base: 0, top: 1, width: .72, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'blade-clump', leafTexture: 'grass-blade-deep',
      count: 20, spread: .06, height: .58, heightJitter: .40, layout: 'phyllotaxis', lateralJitter: .48, leafSize: .72, leafAspect: 1.04,
      arch: .76, droop: .44, cup: .18, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#6eae94', tintOuter: '#f4fff8', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#1f5e3b', aoStrength: .34, alphaCutoff: .40,
    },
  },
  'botanical-grass-b': {
    kind: 'botanical', name: '07 草丛 B', seed: 3072,
    trunk: { ...broadTrunk, height: .50, radius: .02 },
    crown: { base: 0, top: 1, width: .66, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'blade-clump', leafTexture: 'grass-blade-bright',
      count: 25, spread: .08, height: .50, heightJitter: .40, layout: 'phyllotaxis', lateralJitter: .48, leafSize: .64, leafAspect: .80,
      arch: .72, droop: .36, cup: .16, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#6ca86e', tintOuter: '#ffffff', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#2b6e28', aoStrength: .34, alphaCutoff: .40,
    },
  },
  'botanical-grass-c': {
    kind: 'botanical', name: '08 草丛 C', seed: 3083,
    trunk: { ...broadTrunk, height: .66, radius: .02 },
    crown: { base: 0, top: 1, width: .76, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'blade-clump', leafTexture: 'grass-blade-bright',
      count: 22, spread: .06, height: .66, heightJitter: .42, layout: 'phyllotaxis', lateralJitter: .50, leafSize: .84, leafAspect: .72,
      arch: .92, droop: .62, cup: .16, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#74ae66', tintOuter: '#fffbe4', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#367424', aoStrength: .34, alphaCutoff: .40,
    },
  },
  'botanical-small-grass': {
    kind: 'botanical', name: '09 小草丛', seed: 3094,
    trunk: { ...broadTrunk, height: .32, radius: .02 },
    crown: { base: 0, top: 1, width: .44, depth: 1, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'blade-clump', leafTexture: 'broad-strap-leaf',
      count: 12, spread: .05, height: .32, heightJitter: .44, layout: 'phyllotaxis', lateralJitter: .46, leafSize: .40, leafAspect: .76,
      arch: .74, droop: .42, cup: .20, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#78b472', tintOuter: '#fffef2', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#347a28', aoStrength: .30, alphaCutoff: .40,
    },
  },
  'botanical-hydrangea': {
    kind: 'botanical', name: '10 绣球花丛', seed: 1017,
    trunk: { ...broadTrunk, height: .56, radius: .02 },
    crown: { base: 0, top: 1, width: .72, depth: .94, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches, count: 11 },
    botanical: {
      mode: 'hydrangea-shrub', leafTexture: 'hydrangea-leaf', flowerTexture: 'hydrangea-floret-2x2',
      count: 32, spread: .72, height: .56, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .42, leafSize: .25, leafAspect: .76,
      arch: .26, droop: .16, cup: .14, stemCount: 11, flowerClusters: 6, flowerSize: .14,
      tintInner: '#82ac90', tintOuter: '#ffffff', flowerTintInner: '#bac4f8', flowerTintOuter: '#ffffff',
      stemTint: '#295c22', aoStrength: .44, alphaCutoff: .42,
    },
  },
  'botanical-purple-shrub': {
    kind: 'botanical', name: '11 紫花小灌木', seed: 3115,
    trunk: { ...broadTrunk, height: .72, radius: .02 },
    crown: { base: 0, top: 1, width: .48, depth: .95, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'cosmos-shrub', leafTexture: 'small-ovate-leaf', flowerTexture: 'pink-cosmos-2x2',
      count: 96, spread: .46, height: .72, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .42, leafSize: .17, leafAspect: .94,
      arch: .26, droop: .14, cup: .14, stemCount: 13, flowerClusters: 22, flowerSize: .13,
      tintInner: '#629c6c', tintOuter: '#ffffff', flowerTintInner: '#f4c8e8', flowerTintOuter: '#ffffff',
      stemTint: '#3b6a2c', aoStrength: .42, alphaCutoff: .42,
    },
  },
  'botanical-flower-cover': {
    kind: 'botanical', name: '12 小花地被', seed: 3126,
    trunk: { ...broadTrunk, height: .30, radius: .02 },
    crown: { base: 0, top: 1, width: .52, depth: .96, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'flower-groundcover', leafTexture: 'small-ovate-leaf', flowerTexture: 'violet-wildflower-2x2',
      count: 118, spread: .50, height: .24, heightJitter: .36, layout: 'scatter', lateralJitter: .48, leafSize: .15, leafAspect: .92,
      arch: .20, droop: .12, cup: .14, stemCount: 18, flowerClusters: 34, flowerSize: .105,
      tintInner: '#549262', tintOuter: '#ffffff', flowerTintInner: '#c8ccff', flowerTintOuter: '#ffffff',
      stemTint: '#2c6c28', aoStrength: .44, alphaCutoff: .42,
    },
  },
  'botanical-clover-cover': {
    kind: 'botanical', name: '13 三叶草地被', seed: 3137,
    trunk: { ...broadTrunk, height: .30, radius: .02 },
    crown: { base: 0, top: 1, width: .68, depth: .92, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'clover-groundcover', leafTexture: 'clover-shamrock-2x2',
      count: 108, spread: .64, height: .13, heightJitter: .40, layout: 'clumps', lateralJitter: .50, leafSize: .13, leafAspect: 1.0,
      arch: .10, droop: .08, cup: .16, stemCount: 0, flowerClusters: 0, flowerSize: 0,
      tintInner: '#54965c', tintOuter: '#ffffff', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#2b6826', aoStrength: .40, alphaCutoff: .42,
    },
  },
  'botanical-creeping-cover': {
    kind: 'botanical', name: '14 小叶蔓延地被', seed: 3148,
    trunk: { ...broadTrunk, height: .30, radius: .02 },
    crown: { base: 0, top: 1, width: .68, depth: .92, roundness: 2, topBias: 1, coneShape: 1, irregularity: .3 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'clover-groundcover', leafTexture: 'creeping-rosette-2x2',
      count: 112, spread: .66, height: .08, heightJitter: .40, layout: 'clumps', lateralJitter: .50, leafSize: .12, leafAspect: 1.0,
      arch: .08, droop: .06, cup: .14, stemCount: 1, flowerClusters: 0, flowerSize: 0,
      tintInner: '#6ca456', tintOuter: '#fffef0', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#447c2a', aoStrength: .36, alphaCutoff: .42,
    },
  },
  'botanical-fine-herb-a': {
    kind: 'botanical', name: '15 细叶草 A', seed: 3159,
    trunk: { ...broadTrunk, height: .64, radius: .02 },
    crown: { base: 0, top: 1, width: .44, depth: .96, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'fine-herb', leafTexture: 'narrow-herb-leaf',
      count: 144, spread: .36, height: .64, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .44, leafSize: .23, leafAspect: 1.38,
      arch: .46, droop: .16, cup: .12, stemCount: 11, flowerClusters: 0, flowerSize: 0,
      tintInner: '#629e60', tintOuter: '#fffef2', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#367428', aoStrength: .40, alphaCutoff: .40,
    },
  },
  'botanical-fine-herb-b': {
    kind: 'botanical', name: '16 细叶草 B', seed: 3164,
    trunk: { ...broadTrunk, height: .66, radius: .02 },
    crown: { base: 0, top: 1, width: .42, depth: .96, roundness: 2, topBias: 1, coneShape: 1, irregularity: .2 },
    branches: { ...stubBranches },
    botanical: {
      mode: 'fine-herb', leafTexture: 'narrow-herb-leaf',
      count: 290, spread: .40, height: .66, heightJitter: .36, layout: 'phyllotaxis', lateralJitter: .44, leafSize: .14, leafAspect: 1.48,
      arch: .26, droop: .08, cup: .14, stemCount: 19, flowerClusters: 0, flowerSize: 0,
      tintInner: '#5e9c58', tintOuter: '#fffef2', flowerTintInner: '#ffffff', flowerTintOuter: '#ffffff',
      stemTint: '#3a7026', aoStrength: .42, alphaCutoff: .40,
    },
  },
} as const satisfies Record<string, Partial<Omit<TreeSpec, 'branches' | 'leaves' | 'fronds' | 'ground' | 'palm' | 'bamboo' | 'lotus' | 'flowers' | 'flowerbed' | 'botanical' | 'shading' | 'accents'>> & { branches?: Partial<BranchSpec>; leaves?: Partial<LeafParams>; fronds?: Partial<FrondSpec>; ground?: Partial<GroundSpec>; palm?: Partial<PalmSpec>; bamboo?: Partial<BambooSpec>; lotus?: Partial<LotusSpec>; flowers?: Partial<FlowerSpec>; flowerbed?: Partial<FlowerBedSpec>; botanical?: Partial<BotanicalSpec>; shading?: Partial<ShadingSpec>; accents?: Partial<WishingAccentsSpec> }>

export type PresetId = keyof typeof presets
export const presetIds = Object.keys(presets) as PresetId[]

export function presetSpec(id: PresetId, seed?: number): TreeSpec {
  const p = presets[id] as unknown as Partial<Omit<TreeSpec, 'branches'>> & { branches?: Partial<BranchSpec>; leaves?: Partial<LeafParams>; fronds?: Partial<FrondSpec>; ground?: Partial<GroundSpec>; palm?: Partial<PalmSpec>; bamboo?: Partial<BambooSpec>; lotus?: Partial<LotusSpec>; flowers?: Partial<FlowerSpec>; flowerbed?: Partial<FlowerBedSpec>; botanical?: Partial<BotanicalSpec>; shading?: Partial<ShadingSpec>; accents?: Partial<WishingAccentsSpec> }
  return {
    schemaVersion: 2, kind: p.kind!, name: p.name!, seed: seed ?? p.seed!,
    trunk: {
      ...broadTrunk,
      ...p.trunk!,
      ...(p.trunk?.spine ? { spine: p.trunk.spine.map(pt => [pt[0], pt[1], pt[2]] as XYZ) } : {}),
      sculpt: { ...defaultTrunkSculpt(), ...(p.trunk?.sculpt ?? {}) },
    },
    crown: { canopyLift: 0, padFlatten: 0, ...p.crown! },
    branches: { ...stubBranches, ...defaultBranchPlacement(p.kind!), ...(p.branches ?? {}) },
    leaves: parseLeafParams({ ...defaultLeafParams, ...(p.leaves ?? {}) }),
    fronds: { ...defaultFronds, ...(p.fronds ?? {}) },
    ground: { ...defaultGround, ...(p.ground ?? {}) },
    palm: { ...defaultPalm, ...(p.palm ?? {}) },
    bamboo: { ...defaultBamboo, ...(p.bamboo ?? {}) },
    lotus: { ...defaultLotus, ...(p.lotus ?? {}) },
    flowers: { ...defaultFlowers, ...(p.flowers ?? {}) },
    flowerbed: { ...defaultFlowerBed, ...(p.flowerbed ?? {}) },
    ...(p.botanical ? { botanical: { ...defaultBotanical, ...p.botanical } } : {}),
    shading: { ...defaultShading, ...(p.shading ?? {}) },
    accents: { ...defaultAccents, ...(p.accents ?? {}) },
    normalEdit: defaultLeafNormalEdit(),
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
  const base = presetSpec(({ broadleaf: 'broadleaf-round', conifer: 'conifer-standard', palm: 'palm-tropical', bamboo: 'bamboo-realistic', lotus: 'lotus-stemmed', grass: 'grass-clump', fern: 'fern', flowerbed: 'flowerbed-stemmed', botanical: 'botanical-shrub-a' } as const)[data.kind as TreeKind])
  const finite = (group: Record<string, unknown>, fallback: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...fallback }
    for (const [k, v] of Object.entries(group ?? {})) {
      if (!(k in fallback)) continue
      if (typeof fallback[k] === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) throw new Error('参数 ' + k + ' 无效')
      out[k] = v
    }
    return out
  }
  const handles = Array.isArray(data.handles) ? data.handles
    .filter((h): h is CrownHandle => Boolean(h && typeof h === 'object'))
    .map((h, i) => {
      const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n)) ? v as XYZ : [0, 0, 0] as XYZ
      return {
        id: Number.isFinite(Number(h.id)) ? Number(h.id) : i,
        kind: h.kind === 'bare' ? 'bare' : 'shape',
        anchor: vec(h.anchor),
        offset: vec(h.offset),
        radius: Math.min(20, Math.max(.05, Number(h.radius) || 1)),
      } as CrownHandle
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
      const sd = clampNum(raw.socketDelta, -.95, .95); if (sd !== undefined && id !== 0 && Math.abs(sd) > 1e-4) edit.socketDelta = sd
      if (Array.isArray(raw.offset) && raw.offset.length === 3 && raw.offset.every(n => typeof n === 'number' && Number.isFinite(n))) {
        const ox = Math.min(4, Math.max(-4, raw.offset[0]))
        const oy = Math.min(4, Math.max(-4, raw.offset[1]))
        const oz = Math.min(4, Math.max(-4, raw.offset[2]))
        if (ox * ox + oy * oy + oz * oz > 1e-8) edit.offset = [ox, oy, oz]
      }
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
  parsedTrunk.sculpt = parseTrunkSculpt((data.trunk as Partial<TrunkSpec> | undefined)?.sculpt)
  const rawBarkStyle = (data.trunk as Partial<TrunkSpec> | undefined)?.barkStyle
  if (typeof rawBarkStyle === 'string' && (barkStyles as readonly string[]).includes(rawBarkStyle) && rawBarkStyle !== 'default') {
    parsedTrunk.barkStyle = rawBarkStyle as BarkStyle
  } else {
    delete parsedTrunk.barkStyle
  }
  const rawTreeForm = (data.trunk as Partial<TrunkSpec> | undefined)?.treeForm
  if (typeof rawTreeForm === 'string' && (treeForms as readonly string[]).includes(rawTreeForm) && rawTreeForm !== 'free') {
    parsedTrunk.treeForm = rawTreeForm as TreeForm
  } else {
    delete parsedTrunk.treeForm
  }
  const rawSpine = (data.trunk as Partial<TrunkSpec> | undefined)?.spine
  if (Array.isArray(rawSpine) && rawSpine.length >= 3) {
    const valid = rawSpine.filter(p => Array.isArray(p) && p.length === 3 && p.every(n => typeof n === 'number' && Number.isFinite(n))) as XYZ[]
    if (valid.length >= 3) parsedTrunk.spine = valid
  }
  const parsedCrown = finite(data.crown as never, base.crown as never) as unknown as CrownSpec
  const rawProfile = (data.crown as Partial<CrownSpec> | undefined)?.profileCurve
  if (Array.isArray(rawProfile) && rawProfile.length >= 2) {
    const valid = rawProfile
      .filter(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(p => [Math.min(1, Math.max(0, Number(p[0]))), Math.min(1.85, Math.max(0.15, Number(p[1])))] as [number, number])
      .sort((a, b) => a[0] - b[0])
    if (valid.length >= 2) parsedCrown.profileCurve = valid
  }
  const clampIn = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))
  parsedTrunk.height = clampIn(parsedTrunk.height, 0.3, 40)
  parsedTrunk.radius = clampIn(parsedTrunk.radius, 0.015, 3)
  parsedTrunk.taper = clampIn(parsedTrunk.taper, 0.05, 4.0)
  parsedTrunk.forkHeight = clampIn(parsedTrunk.forkHeight, 0.02, 1.0)
  parsedTrunk.flare = clampIn(parsedTrunk.flare, 0, 3)
  parsedTrunk.flareHeight = clampIn(parsedTrunk.flareHeight, 0.02, 5.0)
  parsedCrown.base = clampIn(parsedCrown.base, -0.5, 0.95)
  parsedCrown.top = clampIn(parsedCrown.top, Math.min(1.6, parsedCrown.base + 0.05), 2.5)
  parsedCrown.width = clampIn(parsedCrown.width, 0.15, 25)
  parsedCrown.depth = clampIn(parsedCrown.depth, 0.2, 3)
  parsedCrown.roundness = clampIn(parsedCrown.roundness, 0.2, 5)
  parsedCrown.topBias = clampIn(parsedCrown.topBias, 0.25, 3)
  parsedCrown.coneShape = clampIn(parsedCrown.coneShape, 0.2, 3)
  parsedCrown.irregularity = clampIn(parsedCrown.irregularity, 0, 2)
  if (typeof parsedCrown.canopyLift === 'number') parsedCrown.canopyLift = clampIn(parsedCrown.canopyLift, 0, 1)
  if (typeof parsedCrown.padFlatten === 'number') parsedCrown.padFlatten = clampIn(parsedCrown.padFlatten, 0, 1)
  const parsedBranches = finite(data.branches as never, base.branches as never) as unknown as BranchSpec
  parsedBranches.count = Math.round(clampIn(parsedBranches.count, 0, 48))
  parsedBranches.childCount = Math.round(clampIn(parsedBranches.childCount, 0, 16))
  parsedBranches.heightSpan = clampIn(parsedBranches.heightSpan, 0.05, 1.0)
  parsedBranches.startHeight = clampIn(parsedBranches.startHeight, 0.02, 0.96)
  parsedBranches.radiusRatio = clampIn(parsedBranches.radiusRatio, 0.05, 1.0)
  const parsedFronds = finite(data.fronds as never, base.fronds as never) as unknown as FrondSpec
  if (!(frondModes as readonly string[]).includes(parsedFronds.mode)) parsedFronds.mode = base.fronds.mode
  parsedFronds.start = clampIn(parsedFronds.start, 0.0, 0.85)
  parsedFronds.cardsPerBranch = Math.round(clampIn(parsedFronds.cardsPerBranch, 1, 6))
  parsedFronds.segments = Math.round(clampIn(parsedFronds.segments, 2, 12))
  parsedFronds.cardAspect = clampIn(parsedFronds.cardAspect, 0.08, 3)
  parsedFronds.overhang = clampIn(parsedFronds.overhang, 0, 1.5)
  parsedFronds.arch = clampIn(parsedFronds.arch, -1, 2)
  parsedFronds.cardCup = clampIn(parsedFronds.cardCup, -1, 1)
  parsedFronds.drop = clampIn(parsedFronds.drop, 0.05, 4)
  parsedFronds.drapeTilt = clampIn(parsedFronds.drapeTilt, -60, 85)
  parsedFronds.drapeCurl = clampIn(parsedFronds.drapeCurl, -1, 2)
  parsedFronds.drapeChildren = clampIn(parsedFronds.drapeChildren, 0, 2)
  parsedFronds.width = clampIn(parsedFronds.width, 0.03, 3)
  parsedFronds.fold = clampIn(parsedFronds.fold, 0, 85)
  parsedFronds.cross = clampIn(parsedFronds.cross, 0, 2)
  parsedFronds.childScale = clampIn(parsedFronds.childScale, 0.1, 2.5)
  parsedFronds.spherize = clampIn(parsedFronds.spherize, 0, 1)
  parsedFronds.tintVariance = clampIn(parsedFronds.tintVariance, 0, 1)
  parsedFronds.aoStrength = clampIn(parsedFronds.aoStrength, 0, 1)
  parsedFronds.alphaCutoff = clampIn(parsedFronds.alphaCutoff, 0.01, 0.99)
  parsedFronds.tuft = clampIn(parsedFronds.tuft, 0, 3)
  parsedFronds.twist = clampIn(parsedFronds.twist, 0, 180)
  const parsedOptimize = finite(data.optimize as never, base.optimize as never) as unknown as OptimizeSpec
  parsedOptimize.level = clampIn(parsedOptimize.level, 0, 1)
  parsedOptimize.woodDetail = clampIn(parsedOptimize.woodDetail, 0.1, 1)
  parsedOptimize.cardReduction = clampIn(parsedOptimize.cardReduction, 0, 0.85)
  const parsedGround = finite(data.ground as never, base.ground as never) as unknown as GroundSpec
  if (parsedGround.mode !== 'blade' && parsedGround.mode !== 'card') parsedGround.mode = base.ground.mode
  parsedGround.count = Math.round(clampIn(parsedGround.count, 1, 400))
  parsedGround.length = clampIn(parsedGround.length, 0.05, 5)
  parsedGround.lengthVariance = clampIn(parsedGround.lengthVariance, 0, 0.95)
  parsedGround.width = clampIn(parsedGround.width, 0.005, 1.5)
  parsedGround.widthVariance = clampIn(parsedGround.widthVariance, 0, 0.95)
  parsedGround.widthFullness = clampIn(parsedGround.widthFullness, 0.15, 4)
  parsedGround.spread = clampIn(parsedGround.spread, 0, 6)
  parsedGround.radialBias = clampIn(parsedGround.radialBias, 0.1, 6)
  parsedGround.angleJitter = clampIn(parsedGround.angleJitter, 0, 180)
  parsedGround.sideSwirl = clampIn(parsedGround.sideSwirl, -180, 180)
  parsedGround.lean = clampIn(parsedGround.lean, 0, 89)
  parsedGround.leanVariance = clampIn(parsedGround.leanVariance, 0, 90)
  parsedGround.arch = clampIn(parsedGround.arch, -1.5, 3)
  parsedGround.bendVariance = clampIn(parsedGround.bendVariance, 0, 1.5)
  parsedGround.droop = clampIn(parsedGround.droop, -1, 2)
  parsedGround.cup = clampIn(parsedGround.cup, -1, 1)
  parsedGround.twist = clampIn(parsedGround.twist, 0, 360)
  parsedGround.planes = Math.round(clampIn(parsedGround.planes, 1, 4))
  parsedGround.across = Math.round(clampIn(parsedGround.across, 1, 8))
  parsedGround.fold = clampIn(parsedGround.fold, 0, 85)
  parsedGround.segments = Math.round(clampIn(parsedGround.segments, 2, 32))
  parsedGround.spherize = clampIn(parsedGround.spherize, 0, 1)
  parsedGround.tintVariance = clampIn(parsedGround.tintVariance, 0, 1)
  parsedGround.aoStrength = clampIn(parsedGround.aoStrength, 0, 1)
  parsedGround.alphaCutoff = clampIn(parsedGround.alphaCutoff, 0.01, 0.99)
  const parsedPalm = finite(data.palm as never, base.palm as never) as unknown as PalmSpec
  parsedPalm.bend = clampIn(parsedPalm.bend, 0, 5)
  parsedPalm.sCurve = clampIn(parsedPalm.sCurve, 0, 3)
  parsedPalm.ringCount = Math.round(clampIn(parsedPalm.ringCount, 2, 60))
  parsedPalm.ringStep = clampIn(parsedPalm.ringStep, 0, 0.6)
  parsedPalm.frondCount = Math.round(clampIn(parsedPalm.frondCount, 2, 48))
  parsedPalm.frondLength = clampIn(parsedPalm.frondLength, 0.3, 12)
  parsedPalm.frondLengthVariance = clampIn(parsedPalm.frondLengthVariance, 0, 0.9)
  parsedPalm.frondWidth = clampIn(parsedPalm.frondWidth, 0.05, 3)
  parsedPalm.frondArch = clampIn(parsedPalm.frondArch, 0, 4)
  parsedPalm.frondPitch = clampIn(parsedPalm.frondPitch, -45, 85)
  parsedPalm.frondFold = clampIn(parsedPalm.frondFold, 0, 80)
  parsedPalm.frondTwist = clampIn(parsedPalm.frondTwist, 0, 180)
  parsedPalm.segments = Math.round(clampIn(parsedPalm.segments, 2, 24))
  parsedPalm.coconuts = Math.round(clampIn(parsedPalm.coconuts, 0, 12))
  parsedPalm.spherize = clampIn(parsedPalm.spherize, 0, 1)
  parsedPalm.tintVariance = clampIn(parsedPalm.tintVariance, 0, 1)
  parsedPalm.aoStrength = clampIn(parsedPalm.aoStrength, 0, 1)
  parsedPalm.alphaCutoff = clampIn(parsedPalm.alphaCutoff, 0.01, 0.99)
  const parsedFlowerBed = finite(data.flowerbed as never, base.flowerbed as never) as unknown as FlowerBedSpec
  if (!(flowerBedLayouts as readonly string[]).includes(parsedFlowerBed.layout)) parsedFlowerBed.layout = 'dome'
  parsedFlowerBed.count = Math.round(clampIn(parsedFlowerBed.count, 1, 300))
  parsedFlowerBed.spread = clampIn(parsedFlowerBed.spread, 0.08, 6)
  parsedFlowerBed.height = clampIn(parsedFlowerBed.height, 0.05, 3)
  parsedFlowerBed.heightVariance = clampIn(parsedFlowerBed.heightVariance, 0, 0.9)
  parsedFlowerBed.lean = clampIn(parsedFlowerBed.lean, 0, 85)
  parsedFlowerBed.bend = clampIn(parsedFlowerBed.bend, 0, 1.5)
  parsedFlowerBed.stemRadius = clampIn(parsedFlowerBed.stemRadius, 0.002, 0.08)
  parsedFlowerBed.stemLeaves = Math.round(clampIn(parsedFlowerBed.stemLeaves, 0, 8))
  parsedFlowerBed.stemLeafSize = clampIn(parsedFlowerBed.stemLeafSize, 0.02, 1)
  parsedFlowerBed.flowerSize = clampIn(parsedFlowerBed.flowerSize, 0.03, 1.5)
  parsedFlowerBed.flowerSizeVariance = clampIn(parsedFlowerBed.flowerSizeVariance, 0, 0.9)
  parsedFlowerBed.headTilt = clampIn(parsedFlowerBed.headTilt, 0, 90)
  parsedFlowerBed.faceOutward = clampIn(parsedFlowerBed.faceOutward, 0, 1)
  parsedFlowerBed.tintVariance = clampIn(parsedFlowerBed.tintVariance, 0, 1)
  parsedFlowerBed.alphaCutoff = clampIn(parsedFlowerBed.alphaCutoff, 0.01, 0.99)
  parsedFlowerBed.atlasCols = Math.round(clampIn(parsedFlowerBed.atlasCols, 1, 8))
  parsedFlowerBed.atlasRows = Math.round(clampIn(parsedFlowerBed.atlasRows, 1, 8))
  const parsedBamboo = finite(data.bamboo as never, base.bamboo as never) as unknown as BambooSpec
  if (!(bambooStyles as readonly string[]).includes(parsedBamboo.style)) parsedBamboo.style = 'realistic'
  parsedBamboo.culmCount = Math.round(clampIn(parsedBamboo.culmCount, 1, 16))
  parsedBamboo.culmSpread = clampIn(parsedBamboo.culmSpread, 0, 4)
  parsedBamboo.segments = Math.round(clampIn(parsedBamboo.segments, 2, 36))
  parsedBamboo.nodeBulge = clampIn(parsedBamboo.nodeBulge, 0, 1)
  parsedBamboo.nodeZigzag = clampIn(parsedBamboo.nodeZigzag, 0, 1)
  parsedBamboo.bend = clampIn(parsedBamboo.bend, 0, 4)
  parsedBamboo.canopyStart = clampIn(parsedBamboo.canopyStart, 0.05, 0.95)
  parsedBamboo.tiers = Math.round(clampIn(parsedBamboo.tiers, 1, 12))
  parsedBamboo.branchLength = clampIn(parsedBamboo.branchLength, 0.05, 4)
  parsedBamboo.leafCount = Math.round(clampIn(parsedBamboo.leafCount, 4, 600))
  parsedBamboo.leafSize = clampIn(parsedBamboo.leafSize, 0.05, 3)
  parsedBamboo.leafDroop = clampIn(parsedBamboo.leafDroop, 0, 1.5)
  parsedBamboo.tintVariance = clampIn(parsedBamboo.tintVariance, 0, 1)
  parsedBamboo.aoStrength = clampIn(parsedBamboo.aoStrength, 0, 1)
  parsedBamboo.alphaCutoff = clampIn(parsedBamboo.alphaCutoff, 0.01, 0.99)
  const parsedLotus = finite(data.lotus as never, base.lotus as never) as unknown as LotusSpec
  parsedLotus.spread = clampIn(parsedLotus.spread, 0.2, 8)
  parsedLotus.leafCount = Math.round(clampIn(parsedLotus.leafCount, 1, 120))
  parsedLotus.leafSize = clampIn(parsedLotus.leafSize, 0.08, 2.5)
  parsedLotus.leafSizeVariance = clampIn(parsedLotus.leafSizeVariance, 0, 0.9)
  parsedLotus.leafCup = clampIn(parsedLotus.leafCup, 0, 1)
  parsedLotus.leafWave = clampIn(parsedLotus.leafWave, 0, 0.8)
  parsedLotus.leafNotch = clampIn(parsedLotus.leafNotch, 0, 1)
  parsedLotus.stemHeight = clampIn(parsedLotus.stemHeight, 0.1, 4)
  parsedLotus.stemRadius = clampIn(parsedLotus.stemRadius, 0.003, 0.1)
  parsedLotus.stemCurve = clampIn(parsedLotus.stemCurve, 0, 1.5)
  parsedLotus.flowerCount = Math.round(clampIn(parsedLotus.flowerCount, 0, 32))
  parsedLotus.budCount = Math.round(clampIn(parsedLotus.budCount, 0, 24))
  parsedLotus.flowerSize = clampIn(parsedLotus.flowerSize, 0.05, 2)
  parsedLotus.petalRings = Math.round(clampIn(parsedLotus.petalRings, 1, 6))
  parsedLotus.petalsPerRing = Math.round(clampIn(parsedLotus.petalsPerRing, 3, 18))
  parsedLotus.flowerOpen = clampIn(parsedLotus.flowerOpen, 0.05, 1.2)
  parsedLotus.flowerHeightBoost = clampIn(parsedLotus.flowerHeightBoost, -0.8, 1.5)
  parsedLotus.tintVariance = clampIn(parsedLotus.tintVariance, 0, 1)
  parsedLotus.alphaCutoff = clampIn(parsedLotus.alphaCutoff, 0.01, 0.99)
  const parsedFlowers = finite(data.flowers as never, base.flowers as never) as unknown as FlowerSpec
  parsedFlowers.count = Math.round(clampIn(parsedFlowers.count, 0, 600))
  parsedFlowers.sizeRatio = clampIn(parsedFlowers.sizeRatio, 0.1, 4)
  parsedFlowers.sizeVariance = clampIn(parsedFlowers.sizeVariance, 0, 0.95)
  parsedFlowers.outerShell = clampIn(parsedFlowers.outerShell, 0.1, 0.99)
  parsedFlowers.surfaceOffset = clampIn(parsedFlowers.surfaceOffset, 0, 1.5)
  parsedFlowers.upBias = clampIn(parsedFlowers.upBias, -1, 1)
  parsedFlowers.clumping = clampIn(parsedFlowers.clumping, 0, 1)
  parsedFlowers.clusterCount = Math.round(clampIn(parsedFlowers.clusterCount, 1, 48))
  parsedFlowers.faceOutward = clampIn(parsedFlowers.faceOutward, 0, 1)
  parsedFlowers.cameraFacing = clampIn(parsedFlowers.cameraFacing, 0, 1)
  parsedFlowers.tintVariance = clampIn(parsedFlowers.tintVariance, 0, 1)
  parsedFlowers.alphaCutoff = clampIn(parsedFlowers.alphaCutoff, 0.01, 0.99)
  parsedFlowers.atlasCols = Math.round(clampIn(parsedFlowers.atlasCols, 1, 8))
  parsedFlowers.atlasRows = Math.round(clampIn(parsedFlowers.atlasRows, 1, 8))
  parsedFlowers.seed = Math.round(clampIn(parsedFlowers.seed, 0, 999999))
  const parsedShading = finite(data.shading as never, base.shading as never) as unknown as ShadingSpec
  parsedShading.translucency = clampIn(parsedShading.translucency, 0, 1)
  parsedShading.rimLight = clampIn(parsedShading.rimLight, 0, 1)
  parsedShading.shadowShift = clampIn(parsedShading.shadowShift, 0, 1)
  parsedShading.topWarmth = clampIn(parsedShading.topWarmth, 0, 1)
  parsedShading.petals = Math.round(clampIn(parsedShading.petals, 0, 120))
  if (typeof parsedShading.colorMass === 'number') {
    parsedShading.colorMass = clampIn(parsedShading.colorMass, 0, 1)
  }
  const parsedAccents = finite(data.accents as never, (base.accents ?? defaultAccents) as never) as unknown as WishingAccentsSpec
  parsedAccents.rockCount = Math.round(clampIn(parsedAccents.rockCount, 0, 16))
  parsedAccents.rockScale = clampIn(parsedAccents.rockScale, 0.2, 3)
  parsedAccents.ribbonWraps = Math.round(clampIn(parsedAccents.ribbonWraps, 0, 8))
  parsedAccents.plaqueCount = Math.round(clampIn(parsedAccents.plaqueCount, 0, 24))
  parsedAccents.plaqueScale = clampIn(parsedAccents.plaqueScale, 0.3, 3)
  parsedAccents.sparkleCount = Math.round(clampIn(parsedAccents.sparkleCount, 0, 80))
  const parsedLeafEdits = parseLeafEditSpec(data.leafEdits)
  let parsedBotanical: BotanicalSpec | undefined
  if (data.kind === 'botanical' || data.botanical) {
    const rawBot = finite((data.botanical ?? {}) as never, (base.botanical ?? defaultBotanical) as never) as unknown as BotanicalSpec
    if (!(botanicalModes as readonly string[]).includes(rawBot.mode)) rawBot.mode = 'rosette-shrub'
    if (!(botanicalTextureKeys as readonly string[]).includes(rawBot.leafTexture)) rawBot.leafTexture = 'heart-leaf-a'
    const rawFlwTex = (data.botanical as Partial<BotanicalSpec> | undefined)?.flowerTexture
    if (typeof rawFlwTex === 'string' && (botanicalTextureKeys as readonly string[]).includes(rawFlwTex)) {
      rawBot.flowerTexture = rawFlwTex as BotanicalTextureKey
    } else {
      delete rawBot.flowerTexture
    }
    rawBot.count = Math.round(clampIn(rawBot.count, 4, 400))
    rawBot.spread = clampIn(rawBot.spread, 0.02, 4)
    rawBot.height = clampIn(rawBot.height, 0.04, 3.5)
    rawBot.heightJitter = clampIn(rawBot.heightJitter, 0, 1)
    if (!(botanicalLayouts as readonly string[]).includes(rawBot.layout)) {
      rawBot.layout = rawBot.mode === 'clover-groundcover'
        ? 'clumps'
        : rawBot.mode === 'flower-groundcover'
          ? 'scatter'
          : rawBot.mode === 'fern-clump'
            ? 'ring'
            : 'phyllotaxis'
    }
    rawBot.lateralJitter = clampIn(rawBot.lateralJitter, 0, 1)
    rawBot.leafSize = clampIn(rawBot.leafSize, 0.03, 2.5)
    rawBot.leafAspect = clampIn(rawBot.leafAspect, 0.15, 2.0)
    rawBot.arch = clampIn(rawBot.arch, 0, 2.0)
    rawBot.droop = clampIn(rawBot.droop, 0, 1.5)
    rawBot.cup = clampIn(rawBot.cup, 0, 0.8)
    rawBot.stemCount = Math.round(clampIn(rawBot.stemCount, 0, 48))
    rawBot.flowerClusters = Math.round(clampIn(rawBot.flowerClusters, 0, 80))
    rawBot.flowerSize = clampIn(rawBot.flowerSize, 0, 1.0)
    rawBot.aoStrength = clampIn(rawBot.aoStrength, 0, 1)
    rawBot.alphaCutoff = clampIn(rawBot.alphaCutoff, 0.05, 0.9)
    parsedBotanical = rawBot
  }
  return {
    schemaVersion: 2, kind: data.kind as TreeKind, name: String(data.name ?? base.name),
    seed: Number.isInteger(data.seed) ? data.seed! : base.seed,
    trunk: parsedTrunk,
    crown: parsedCrown,
    branches: parsedBranches,
    leaves: parseLeafParams(data.leaves),
    fronds: parsedFronds,
    ground: parsedGround,
    palm: parsedPalm,
    bamboo: parsedBamboo,
    lotus: parsedLotus,
    flowers: parsedFlowers,
    flowerbed: parsedFlowerBed,
    ...(parsedBotanical ? { botanical: parsedBotanical } : {}),
    shading: parsedShading,
    accents: parsedAccents,
    normalEdit: parseLeafNormalEdit(data.normalEdit),
    ...(parsedLeafEdits ? { leafEdits: parsedLeafEdits } : {}),
    optimize: parsedOptimize,
    handles,
    ...(branchEdits.length ? { branchEdits } : {}),
  }
}

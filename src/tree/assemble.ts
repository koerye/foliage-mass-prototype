import { BufferAttribute, BufferGeometry, Color, Group, MathUtils, Mesh, MeshStandardMaterial, type Material, type Object3D, type Texture } from 'three'
import { applyBirchWoodSurface, makeBirchBarkMaterial } from '../assembly/birch-bark'
import { buildMeadowBirchStructure } from '../assembly/birch-structure'
import { exportGlb, type ExportGlbOptions } from '../export-glb'
import { Batch } from '../mesh'
import { makeLeafMaterial } from '../broadleaf/leaf-material'
import { computeLeafPlacement, remeshLeafPlacement, type LeafPlacementCache, type Twig } from '../broadleaf/leaves'
import { makePainterlyDriftwoodBarkTexture, makePainterlyMossBarkTexture } from '../texgraph/templates'
import { makeBarkMaterial, makePetalMaterial, makeStemMaterial } from './bark-material'
import { buildBamboo } from './bamboo'
import { buildFlowerBed } from './flowerbed'
import { buildAmbientPetals, buildFlowers, sitesFromGeometry, sitesFromLeafCards, type FoliageSite } from './flowers'
import { buildFronds } from './fronds'
import { buildGround } from './ground'
import { applyLeafEditsToGeometry, hasLeafEdits } from './leaf-edits'
import { applyCustomLeafNormals, isCustomNormalActive } from './leaf-normals'
import { buildLotus } from './lotus'
import { buildPalmFronds, buildPalmWood } from './palm'
import { buildSkeleton, hasGeometricEdit, hasGlobalBranchOffset, type Skeleton } from './skeleton'
import type { BarkStyle, TreeSpec } from './spec'
import { makeBambooLeafTexture, makeFeatherySprayTexture, makeLotusLeafTexture, makeLotusPetalTexture, makePaintedClusterTexture } from './textures'
import { buildWishingAccents } from './wishing-accents'
import { buildWood } from './wood'
import { getBarkHeightField, woodSculptLodParams } from './wood-sculpt'

export const views = ['final', 'skeleton', 'crown'] as const
export type View = typeof views[number]

const sharedStyleBarkCache: Partial<Record<BarkStyle, Texture>> = {}
function resolveStyleBarkTexture(style: BarkStyle | undefined): Texture | undefined {
  if (style !== 'driftwood' && style !== 'moss') return undefined
  let tex = sharedStyleBarkCache[style]
  if (!tex) {
    tex = style === 'driftwood'
      ? makePainterlyDriftwoodBarkTexture(512)
      : makePainterlyMossBarkTexture(512)
    sharedStyleBarkCache[style] = tex
  }
  return tex
}

const WOOD_ONLY_PARAMS = new Set([
  'trunk.sculpt',
  'trunk.barkStyle',
  'trunk.barkRidges',
  'trunk.barkDepth',
  'trunk.flare',
  'trunk.flareLobes',
  'trunk.flareHeight',
  'trunk.surfaceRoots',
  'trunk.barkColor',
  'trunk.barkScale',
  'trunk.barkDetail',
  'trunk.barkTint',
  'trunk.barkMoss',
  'trunk.barkMossColor',
  'trunk.barkRootAO',
  'optimize.woodDetail',
])

/** Returns true when editing `path` ONLY changes wood mesh geometry or bark material
 *  (zero change to skeleton, leaf cards, fronds, flowers, petals, or wishing accents). */
export function isWoodOnlyParam(path: string): boolean {
  return path.startsWith('trunk.sculpt.') || WOOD_ONLY_PARAMS.has(path)
}

const OPTIMIZE_ONLY_PARAMS = new Set([
  'optimize.level',
  'optimize.woodDetail',
  'optimize.cullHiddenWood',
  'optimize.flatCards',
  'optimize.cardReduction',
  'optimize.targetTriangles',
])

/** Returns true when editing `path` ONLY affects LOD / optimization remeshing
 *  (can reuse cached skeleton + unreduced leaf-card placement via `remeshForOptimize`). */
export function isOptimizeOnlyParam(path: string): boolean {
  return OPTIMIZE_ONLY_PARAMS.has(path)
}

export interface TreeBuildStats {
  branches: number
  twigs: number
  leaves: number
  flowers: number
  triangles: number
  ms: number
}

export interface TreeLodClone {
  group: Group
  stats: TreeBuildStats
  dispose(): void
}

function meshTriCount(geo: BufferGeometry | undefined): number {
  return geo?.index ? geo.index.count / 3 : 0
}

function cloneStaticSubtree(node: Object3D, cloneDisposables: { dispose(): void }[]): Object3D {
  let copy: Object3D
  if (node instanceof Mesh) {
    const geo = node.geometry.clone()
    cloneDisposables.push(geo)
    copy = new Mesh(geo, node.material)
    copy.castShadow = node.castShadow
    copy.receiveShadow = node.receiveShadow
  } else {
    copy = new Group()
  }
  copy.name = node.name
  copy.visible = node.visible
  copy.position.copy(node.position)
  copy.quaternion.copy(node.quaternion)
  copy.scale.copy(node.scale)
  copy.userData = { ...node.userData }
  for (const child of node.children) {
    copy.add(cloneStaticSubtree(child, cloneDisposables))
  }
  return copy
}

function buildTwigs(twigs: Twig[], barkColor?: string) {
  const batch = new Batch()
  const color = barkColor && barkColor.toLowerCase() !== '#5b4636'
    ? new Color(barkColor).lerp(new Color('#c8beb8'), .12)
    : new Color('#6b5842')
  for (const twig of twigs) {
    const frames = twig.curve.computeFrenetFrames(2, false)
    const center = (t: number) => twig.curve.getPoint(t)
    batch.shell(3, 4, (t, a) => {
      const i = Math.round(t * 2)
      const radius = twig.radius * (1 - t * .75)
      return [center(t).addScaledVector(frames.normals[i], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[i], Math.sin(a) * radius), color, .5]
    }, center)
  }
  const geometry = batch.finish()
  geometry.deleteAttribute('shadeWeight')
  const posAttr = geometry.getAttribute('position')
  if (posAttr && !geometry.getAttribute('uv')) {
    const uvs = new Float32Array(posAttr.count * 2)
    const met = new Float32Array(posAttr.count)
    for (let i = 0; i < posAttr.count; i++) {
      uvs[i * 2] = (i % 4) * 0.25
      uvs[i * 2 + 1] = posAttr.getY(i) * 0.8
      met[i] = 0.08
    }
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
    geometry.setAttribute('barkMetric', new BufferAttribute(met, 1))
  }
  return geometry
}

export interface TreeTextures {
  bark?: Texture
  leaf: Texture
  needle: Texture
  drape: Texture
  palm: Texture
  bamboo?: Texture
  lotusLeaf?: Texture
  lotusPetal?: Texture
  grass: Texture
  grassTint?: Texture
  fern: Texture
  flower?: Texture
  blossom?: Texture
  stemLeaf?: Texture
  painted?: Texture
  feathery?: Texture
  sakura?: Texture
  cloud?: Texture
  oak?: Texture
  oakAtlas?: Texture
  maple?: Texture
  willow?: Texture
  bush?: Texture
  wildrose?: Texture
}

let fallbackPaintedTex: Texture | undefined
function getFallbackPaintedTex(): Texture {
  if (!fallbackPaintedTex) fallbackPaintedTex = makePaintedClusterTexture()
  return fallbackPaintedTex
}
let fallbackFeatheryTex: Texture | undefined
function getFallbackFeatheryTex(fallback: Texture): Texture {
  if (typeof document === 'undefined') return fallback
  if (!fallbackFeatheryTex) fallbackFeatheryTex = makeFeatherySprayTexture()
  return fallbackFeatheryTex
}
let fallbackBambooTex: Texture | undefined
function getFallbackBambooTex(fallback: Texture): Texture {
  if (typeof document === 'undefined') return fallback
  if (!fallbackBambooTex) fallbackBambooTex = makeBambooLeafTexture()
  return fallbackBambooTex
}
let fallbackLotusLeafTex: Texture | undefined
function getFallbackLotusLeafTex(fallback: Texture): Texture {
  if (typeof document === 'undefined') return fallback
  if (!fallbackLotusLeafTex) fallbackLotusLeafTex = makeLotusLeafTexture()
  return fallbackLotusLeafTex
}
let fallbackLotusPetalTex: Texture | undefined
function getFallbackLotusPetalTex(fallback: Texture): Texture {
  if (typeof document === 'undefined') return fallback
  if (!fallbackLotusPetalTex) fallbackLotusPetalTex = makeLotusPetalTexture()
  return fallbackLotusPetalTex
}

export function buildTree(
  spec: TreeSpec,
  textures: TreeTextures,
  options: { skeleton?: Skeleton; leafTextureOverride?: boolean } = {},
) {
  const started = performance.now()
  // Stage 1: Unified Skeleton Provider (free parametric skeleton OR meadow-birch form)
  const form = !options.skeleton && spec.kind === 'broadleaf' && spec.trunk.treeForm === 'meadow-birch'
    ? buildMeadowBirchStructure(spec)
    : undefined
  const skeleton = options.skeleton ?? form?.skeleton ?? buildSkeleton(spec)
  const env = skeleton.envelope
  const group = new Group()
  group.name = 'Vegetation Studio / ' + spec.name + ' / ' + spec.seed
  group.userData.spec = spec
  const opt = spec.optimize
  const ground = spec.kind === 'grass' || spec.kind === 'fern'
  const flowerbed = spec.kind === 'flowerbed'
  const palm = spec.kind === 'palm'
  const bamboo = spec.kind === 'bamboo'
  const lotus = spec.kind === 'lotus'
  const makeSkipWood = (s: TreeSpec) => s.optimize.cullHiddenWood
    ? (b: typeof skeleton.branches[number]) => {
      if (b.role === 'trunk' || b.role === 'dead') return false
      if (env.bare(b.curve.getPoint(.6)) >= .25) return false
      if (s.kind === 'conifer' && s.fronds.mode === 'leaf' && b.role === 'limb') return true
      if (s.kind === 'broadleaf' && s.optimize.woodDetail < .45 && b.role === 'child') return true
      return false
    }
    : undefined

  // Stage 2: Unified Wood Geometry & Bark Material (supports default, birch, driftwood, moss, and custom bark)
  const isBirchBark = (s: TreeSpec, tex: TreeTextures) => !tex.bark && s.trunk.barkStyle === 'birch'
  const buildBarkFor = (s: TreeSpec, tex: TreeTextures) => {
    if (isBirchBark(s, tex)) {
      return makeBirchBarkMaterial(s.seed, s)
    }
    const sc = s.trunk.sculpt
    const scLod = woodSculptLodParams(s.optimize.woodDetail, sc)
    const effectiveBarkTex = tex.bark ?? resolveStyleBarkTexture(s.trunk.barkStyle)
    return makeBarkMaterial(effectiveBarkTex, {
      scale: s.trunk.barkScale,
      detail: s.trunk.barkDetail,
      tint: s.trunk.barkTint,
      shadowShift: s.shading.shadowShift,
      baseColor: s.trunk.barkColor,
      moss: s.trunk.barkMoss,
      mossColor: s.trunk.barkMossColor,
      rootAO: s.trunk.barkRootAO,
      uvMode: scLod.active ? sc?.uvMode : 'triplanar',
      lodNormalBoost: scLod.lodNormalBoost,
      sculptIntensity: sc?.intensity ?? 0,
      hasMetric: scLod.active,
    })
  }

  let currentSpec = spec
  let currentView: View = 'final'
  let currentBark: MeshStandardMaterial = buildBarkFor(spec, textures)
  let currentBarkStyle: BarkStyle = spec.trunk.barkStyle ?? 'default'
  const effectiveBarkTex = textures.bark ?? resolveStyleBarkTexture(spec.trunk.barkStyle)
  const barkHeightField = spec.trunk.sculpt && spec.trunk.sculpt.heightDisplace > 0.001
    ? getBarkHeightField(effectiveBarkTex)
    : undefined

  const buildWoodGeometryFor = (s: TreeSpec): BufferGeometry | undefined => {
    if (ground || flowerbed || bamboo || lotus) return undefined
    const geo = palm
      ? buildPalmWood(skeleton.trunk, s)
      : buildWood(skeleton.branches, s.trunk, s.seed, {
          detail: s.optimize.woodDetail,
          skip: makeSkipWood(s),
          heightField: barkHeightField,
        })
    if (geo && isBirchBark(s, textures)) {
      applyBirchWoodSurface(geo, skeleton.trunk, s.trunk.height, s.seed)
    }
    return geo
  }

  let currentWoodGeometry = buildWoodGeometryFor(spec)
  const wood = currentWoodGeometry ? new Mesh(currentWoodGeometry, currentBark) : undefined
  if (wood) {
    wood.name = 'Trunk and branches'
    wood.userData.role = 'wood'
  }
  let twigsMesh: Mesh | undefined
  const meshes: Mesh[] = wood ? [wood] : []
  const ownedMaterials: Material[] = []
  const accentDisposables: { dispose(): void }[] = []
  const stats: TreeBuildStats = {
    branches: skeleton.branches.length - 1,
    twigs: 0,
    leaves: 0,
    flowers: 0,
    triangles: meshTriCount(currentWoodGeometry),
    ms: 0,
  }
  let sites: FoliageSite[] = []

  const sh = spec.shading
  const customNormalOn = isCustomNormalActive(spec.normalEdit)
  const keepCustomNormal = customNormalOn ? spec.normalEdit!.mode !== 'original' : undefined
  const leafStyle = (shadowFrom: string, rvtChannel: 0 | 1 | 2 = 0) => ({
    translucency: sh.translucency,
    rimLight: sh.rimLight,
    shadowShift: sh.shadowShift,
    topWarmth: sh.topWarmth,
    shadowFrom,
    rvtChannel,
    ...(keepCustomNormal !== undefined ? { keepNormal: keepCustomNormal } : {}),
  })

  // Cached per-kind placement & material references so `remeshForOptimize` & `buildLodClone`
  // skip skeleton generation, twig generation, and spatial-hash leaf distribution completely.
  let leafPlacementCache: LeafPlacementCache | undefined
  let broadleafLeafMesh: Mesh | undefined
  let broadleafLeafMat: MeshStandardMaterial | undefined
  let palmFrondMesh: Mesh | undefined
  let palmFrondMat: MeshStandardMaterial | undefined
  let bambooSprayTexture = false
  let bambooCulmMesh: Mesh | undefined
  let bambooCulmMat: MeshStandardMaterial | undefined
  let bambooLeafMesh: Mesh | undefined
  let bambooLeafMat: MeshStandardMaterial | undefined
  let lotusStemsMesh: Mesh | undefined
  let lotusStemMat: MeshStandardMaterial | undefined
  let lotusLeavesMesh: Mesh | undefined
  let lotusPadMat: MeshStandardMaterial | undefined
  let lotusPetalsMesh: Mesh | undefined
  let lotusPetalMat: MeshStandardMaterial | undefined
  let lotusCentersMesh: Mesh | undefined
  let lotusCenterMat: MeshStandardMaterial | undefined
  let fbStemsMesh: Mesh | undefined
  let fbStemMat: MeshStandardMaterial | undefined
  let fbStemLeavesMesh: Mesh | undefined
  let fbStemLeafMat: MeshStandardMaterial | undefined
  let fbBlossomsMesh: Mesh | undefined
  let fbBlossomsMat: MeshStandardMaterial | undefined
  let groundMesh: Mesh | undefined
  let groundMat: MeshStandardMaterial | undefined
  let coniferFrondMesh: Mesh | undefined
  let coniferFrondMat: MeshStandardMaterial | undefined
  let flowerOverlayMesh: Mesh | undefined
  let flowerOverlayMat: MeshStandardMaterial | undefined
  let petalsMesh: Mesh | undefined
  let accentGroup: Group | undefined
  let accentTriangles = 0

  const trackMat = <M extends Material>(m: M): M => {
    ownedMaterials.push(m)
    return m
  }
  const addMeshToLive = (m: Mesh) => {
    m.castShadow = true
    m.receiveShadow = m.userData.role === 'wood' || !sh.softSelfShadow
    m.visible = m.userData.role === 'wood' ? currentView !== 'crown' : currentView !== 'skeleton'
    meshes.push(m)
    group.add(m)
    return m
  }
  const removeMeshFromLive = (m: Mesh | undefined) => {
    if (!m) return
    group.remove(m)
    const idx = meshes.indexOf(m)
    if (idx >= 0) meshes.splice(idx, 1)
    m.geometry.dispose()
  }
  const swapMeshGeometry = (m: Mesh, nextGeo: BufferGeometry) => {
    const prev = m.geometry
    m.geometry = nextGeo
    prev.dispose()
  }

  // Stage 3 (Pure Alpha Leaf Cards — Unified Clump-Mass & Classic Distribution)
  // + Stage 4 (Custom Normals) + Stage 5 (Unified Foliage Shading Material)
  if (spec.kind === 'broadleaf') {
    const carriers = skeleton.branches.filter(b => b.role !== 'dead' && !b.bare)
    const leafPreset = options.leafTextureOverride && sh.leafStyle === 'painted' ? 'default' : sh.leafStyle
    const effectiveColorMass = MathUtils.clamp(sh.colorMass ?? (leafPreset === 'painted' ? .98 : 0), 0, 1)
    const useClumpMass = effectiveColorMass >= .55 && skeleton.clusters.length > 0
      && spec.leaves.cardType !== 'drape' && spec.leaves.cardType !== 'strip'
    const hasBranchGeomEdit = hasGlobalBranchOffset(spec.branches) || Boolean(spec.branchEdits?.some(hasGeometricEdit))
    const useFittedEnv = hasBranchGeomEdit || Boolean(form)
    const lift = Math.max(0, Math.min(.75, spec.crown.canopyLift ?? 0))
    const effectiveLeafParams = leafPreset === 'painted'
      ? { ...spec.leaves, atlasCols: 1, atlasRows: 1, atlasRegions: undefined }
      : spec.leaves
    leafPlacementCache = computeLeafPlacement(
      { limbs: carriers, clusters: skeleton.clusters, config: { seed: spec.seed } },
      effectiveLeafParams,
      {
        // On sculpted / node-edited / form skeletons, use live post-edit fitted envelope so protruding limbs stay lush!
        radius: useFittedEnv ? undefined : p => env.rho(p),
        preserveClumpShells: skeleton.clusters.length > 0,
        uniformDensity: true,
        colorMass: effectiveColorMass,
        clumpMassMode: useClumpMass,
        keep: (p, r) => {
          if (lift > 0 && !form && !useClumpMass) {
            const u = (p.y - env.y0) / Math.max(.2, env.height)
            if (u < lift * .82 && env.rho(p) < .84 - u * .25) return false
          }
          return env.bare(p) < (useClumpMass ? .38 : .3 + r * .45)
        },
        padFlatten: spec.crown.padFlatten,
        ...(hasLeafEdits(spec.leafEdits) ? { leafEdits: spec.leafEdits } : {}),
      },
    )
    const info = remeshLeafPlacement(leafPlacementCache, { flat: opt.flatCards, reduce: opt.cardReduction })
    const styleMap = (() => {
      switch (leafPreset) {
        case 'sakura': return textures.sakura ?? textures.flower ?? textures.leaf
        case 'cloud': return textures.cloud ?? textures.leaf
        case 'oak':
          return (spec.leaves.atlasCols > 1 || spec.leaves.atlasRows > 1)
            ? (textures.oakAtlas ?? textures.oak ?? textures.leaf)
            : (textures.oak ?? textures.leaf)
        case 'maple': return textures.maple ?? textures.leaf
        case 'willow': return textures.willow ?? textures.leaf
        case 'bush': return textures.bush ?? textures.leaf
        case 'painted': return textures.painted ?? getFallbackPaintedTex()
        case 'feathery': return textures.feathery ?? getFallbackFeatheryTex(textures.leaf)
        case 'flower': return textures.flower ?? textures.leaf
        default: return textures.leaf
      }
    })()
    const noFacing = spec.leaves.cardType === 'cross' || spec.leaves.cardType === 'tri' || spec.leaves.cardType === 'drape'
    if (customNormalOn) applyCustomLeafNormals(info.geometry, env, spec.normalEdit!, spec.seed)
    broadleafLeafMat = trackMat(makeLeafMaterial(styleMap, spec.leaves.alphaCutoff, spec.leaves.normalSpherize,
      noFacing ? 0 : spec.leaves.cameraFacing, {
        ...leafStyle(spec.leaves.tintInner),
        ...(effectiveColorMass > .01
          ? { paintedLight: effectiveColorMass * .86, roughness: MathUtils.lerp(.80, .98, effectiveColorMass) }
          : {}),
      }))
    broadleafLeafMesh = new Mesh(info.geometry, broadleafLeafMat)
    broadleafLeafMesh.name = 'Leaf cards'
    broadleafLeafMesh.userData.role = 'foliage'
    if (!opt.cullHiddenWood) {
      const twigGeometry = buildTwigs(info.twigs, spec.trunk.barkColor)
      const twigs = new Mesh(twigGeometry, currentBark)
      twigs.name = 'Twigs'
      twigs.userData.role = 'wood'
      twigsMesh = twigs
      meshes.push(twigs)
      stats.twigs = info.twigs.length
      stats.triangles += meshTriCount(twigGeometry)
    }
    meshes.push(broadleafLeafMesh)
    stats.leaves = info.cards.length + info.strips
    stats.triangles += meshTriCount(info.geometry)
    if (spec.flowers.enabled) sites = info.cards.length ? sitesFromLeafCards(info.cards, env) : sitesFromGeometry(info.geometry, env, spec.leaves.leafSize)
  } else if (palm) {
    const { geometry, fronds } = buildPalmFronds(skeleton.trunk, env, spec)
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    palmFrondMat = trackMat(makeLeafMaterial(textures.palm, spec.palm.alphaCutoff, spec.palm.spherize, 0, leafStyle(spec.palm.tintInner)))
    palmFrondMat.name = 'PalmFronds'
    palmFrondMesh = new Mesh(geometry, palmFrondMat)
    palmFrondMesh.name = 'Palm fronds'
    palmFrondMesh.userData.role = 'foliage'
    meshes.push(palmFrondMesh)
    stats.leaves = fronds
    stats.triangles += meshTriCount(geometry)
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, spec.palm.frondWidth * .7)
  } else if (bamboo) {
    const bamTex = textures.bamboo ?? getFallbackBambooTex(textures.leaf)
    bambooSprayTexture = Boolean(textures.bamboo && !bamTex.userData.bambooBlade)
    const bam = buildBamboo(spec, env, bambooSprayTexture)
    bambooCulmMat = trackMat(makeStemMaterial())
    bambooCulmMat.name = 'BambooCulm'
    bambooCulmMat.roughness = spec.bamboo.style === 'chibi' ? .44 : .50
    bambooCulmMat.metalness = .02
    bambooCulmMesh = new Mesh(bam.culmsGeometry, bambooCulmMat)
    bambooCulmMesh.name = 'Bamboo culms'
    bambooCulmMesh.userData.role = 'wood'
    meshes.push(bambooCulmMesh)
    stats.branches = bam.branches
    stats.triangles += meshTriCount(bam.culmsGeometry)

    if (customNormalOn) applyCustomLeafNormals(bam.leavesGeometry, env, spec.normalEdit!, spec.seed)
    const bambooColorMass = MathUtils.clamp(sh.colorMass ?? 0, 0, 1)
    bambooLeafMat = trackMat(makeLeafMaterial(bamTex, spec.bamboo.alphaCutoff, .44, 0, {
      ...leafStyle(spec.bamboo.tintInner),
      roughness: bambooColorMass > .01 ? MathUtils.lerp(.58, .82, bambooColorMass) : .54,
      ...(bambooColorMass > .01 ? { paintedLight: bambooColorMass * .24 } : {}),
    }))
    bambooLeafMat.name = 'BambooLeaves'
    bambooLeafMesh = new Mesh(bam.leavesGeometry, bambooLeafMat)
    bambooLeafMesh.name = 'Bamboo leaves'
    bambooLeafMesh.userData.role = 'foliage'
    meshes.push(bambooLeafMesh)
    stats.leaves = bam.leaves
    stats.triangles += meshTriCount(bam.leavesGeometry)
    if (spec.flowers.enabled) sites = sitesFromGeometry(bam.leavesGeometry, env, spec.bamboo.leafSize * .6)
  } else if (lotus) {
    const lt = buildLotus(spec, env)
    if (lt.stemsGeometry) {
      lotusStemMat = trackMat(makeStemMaterial())
      lotusStemMat.name = 'LotusStems'
      lotusStemMat.roughness = .62
      lotusStemsMesh = new Mesh(lt.stemsGeometry, lotusStemMat)
      lotusStemsMesh.name = 'Lotus stems'
      lotusStemsMesh.userData.role = 'wood'
      meshes.push(lotusStemsMesh)
      stats.branches = lt.stems
      stats.triangles += meshTriCount(lt.stemsGeometry)
    } else {
      stats.branches = 0
    }
    const padTex = textures.lotusLeaf ?? getFallbackLotusLeafTex(textures.leaf)
    if (customNormalOn) applyCustomLeafNormals(lt.leavesGeometry, env, spec.normalEdit!, spec.seed)
    lotusPadMat = trackMat(makeLeafMaterial(padTex, spec.lotus.alphaCutoff, .38, 0, {
      ...leafStyle(spec.lotus.leafTintInner),
      roughness: .66,
    }))
    lotusPadMat.name = 'LotusLeaves'
    lotusLeavesMesh = new Mesh(lt.leavesGeometry, lotusPadMat)
    lotusLeavesMesh.name = 'Lotus leaves'
    lotusLeavesMesh.userData.role = 'foliage'
    meshes.push(lotusLeavesMesh)
    stats.leaves = lt.leaves
    stats.triangles += meshTriCount(lt.leavesGeometry)

    if (lt.petalsGeometry) {
      const petalTex = textures.lotusPetal ?? getFallbackLotusPetalTex(textures.blossom ?? textures.flower ?? textures.leaf)
      lotusPetalMat = trackMat(makeLeafMaterial(petalTex, spec.lotus.alphaCutoff, .42, 0, {
        ...leafStyle(spec.lotus.petalTipColor),
        translucency: Math.max(.55, sh.translucency),
        roughness: .58,
      }))
      lotusPetalMat.name = 'LotusPetals'
      lotusPetalsMesh = new Mesh(lt.petalsGeometry, lotusPetalMat)
      lotusPetalsMesh.name = 'Lotus petals'
      lotusPetalsMesh.userData.role = 'foliage'
      meshes.push(lotusPetalsMesh)
      stats.triangles += meshTriCount(lt.petalsGeometry)
    }
    if (lt.centersGeometry) {
      lotusCenterMat = trackMat(makeStemMaterial())
      lotusCenterMat.name = 'LotusCenters'
      lotusCenterMat.roughness = .58
      lotusCentersMesh = new Mesh(lt.centersGeometry, lotusCenterMat)
      lotusCentersMesh.name = 'Lotus centers'
      lotusCentersMesh.userData.role = 'foliage'
      meshes.push(lotusCentersMesh)
      stats.triangles += meshTriCount(lt.centersGeometry)
    }
    stats.flowers = lt.flowers
  } else if (flowerbed) {
    const fb = buildFlowerBed(spec, env)
    if (fb.stemsGeometry) {
      fbStemMat = trackMat(makeStemMaterial())
      fbStemsMesh = new Mesh(fb.stemsGeometry, fbStemMat)
      fbStemsMesh.name = 'Flower stems'
      fbStemsMesh.userData.role = 'wood'
      meshes.push(fbStemsMesh)
      stats.branches = fb.stems
      stats.triangles += meshTriCount(fb.stemsGeometry)
    } else {
      stats.branches = 0
    }
    if (fb.stemLeavesGeometry) {
      const stemLeafMap = textures.stemLeaf ?? textures.leaf
      fbStemLeafMat = trackMat(makeLeafMaterial(stemLeafMap, spec.flowerbed.alphaCutoff, .48, 0, leafStyle(spec.flowerbed.stemTint)))
      fbStemLeafMat.name = 'FlowerStemLeaves'
      fbStemLeavesMesh = new Mesh(fb.stemLeavesGeometry, fbStemLeafMat)
      fbStemLeavesMesh.name = 'Flower stem leaves'
      fbStemLeavesMesh.userData.role = 'foliage'
      meshes.push(fbStemLeavesMesh)
      stats.triangles += meshTriCount(fb.stemLeavesGeometry)
    }
    const map = textures.blossom ?? textures.flower ?? textures.leaf
    if (customNormalOn) applyCustomLeafNormals(fb.blossomsGeometry, env, spec.normalEdit!, spec.seed)
    fbBlossomsMat = trackMat(makeLeafMaterial(map, spec.flowerbed.alphaCutoff, .65, 0, leafStyle(spec.flowerbed.tintInner)))
    fbBlossomsMat.name = 'FlowerBedBlossoms'
    fbBlossomsMesh = new Mesh(fb.blossomsGeometry, fbBlossomsMat)
    fbBlossomsMesh.name = 'Flower blossoms'
    fbBlossomsMesh.userData.role = 'foliage'
    meshes.push(fbBlossomsMesh)
    stats.leaves = fb.flowers
    stats.flowers = fb.flowers
    stats.triangles += meshTriCount(fb.blossomsGeometry)
  } else if (ground) {
    const { geometry, blades } = buildGround(spec, env)
    const modeledBlade = spec.kind === 'grass' && spec.ground.mode !== 'card'
    const map = modeledBlade ? undefined : (spec.kind === 'fern' ? textures.fern : textures.grass)
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    groundMat = trackMat(makeLeafMaterial(map, modeledBlade ? 0 : spec.ground.alphaCutoff, spec.ground.spherize, 0, leafStyle(spec.ground.tintBase, spec.kind === 'grass' ? 1 : 0)))
    groundMat.name = spec.kind === 'fern' ? 'FernFronds' : 'GrassBlades'
    groundMesh = new Mesh(geometry, groundMat)
    groundMesh.name = groundMat.name
    groundMesh.userData.role = 'foliage'
    meshes.push(groundMesh)
    stats.leaves = blades
    stats.triangles += meshTriCount(geometry)
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, Math.max(.14, spec.ground.width * 1.4))
  } else {
    const { geometry, fronds } = buildFronds(skeleton, spec)
    const map = spec.fronds.mode === 'drape' ? textures.drape : textures.needle
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    coniferFrondMat = trackMat(makeLeafMaterial(map, spec.fronds.alphaCutoff, spec.fronds.spherize, 0, leafStyle(spec.fronds.tintInner)))
    coniferFrondMat.name = 'NeedleFronds'
    coniferFrondMesh = new Mesh(geometry, coniferFrondMat)
    coniferFrondMesh.name = 'Needle fronds'
    coniferFrondMesh.userData.role = 'foliage'
    meshes.push(coniferFrondMesh)
    stats.leaves = fronds
    stats.triangles += meshTriCount(geometry)
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, Math.max(.25, spec.fronds.width))
  }

  // Optional outer-surface flower decoration following the host foliage sites & scale
  // Resolve lazily so TextureRegistry never synthesizes flower textures when `flowers.enabled === false`.
  const resolveFlowerTex = (s: TreeSpec): Texture | undefined => (
    s.flowers.style === 'wildrose'
      ? (textures.wildrose ?? textures.blossom ?? textures.flower)
      : textures.flower
  )
  const ensureFlowerMaterial = (s: TreeSpec, tex: Texture): MeshStandardMaterial => {
    if (!flowerOverlayMat) {
      const facing = s.flowers.cardType === 'cross' ? 0 : s.flowers.cameraFacing
      flowerOverlayMat = trackMat(makeLeafMaterial(tex, s.flowers.alphaCutoff, .75, facing, leafStyle(s.flowers.tintInner)))
      flowerOverlayMat.name = 'FlowerCards'
    }
    return flowerOverlayMat
  }
  if (spec.flowers.enabled && sites.length > 0) {
    const flowerTex = resolveFlowerTex(spec)
    if (flowerTex) {
      const fl = buildFlowers(sites, env, spec.flowers, opt, spec.seed)
      if (fl.flowers > 0) {
        const material = ensureFlowerMaterial(spec, flowerTex)
        flowerOverlayMesh = new Mesh(fl.geometry, material)
        flowerOverlayMesh.name = 'Flower cards'
        flowerOverlayMesh.userData.role = 'foliage'
        meshes.push(flowerOverlayMesh)
        stats.flowers = fl.flowers
        stats.triangles += meshTriCount(fl.geometry)
      } else {
        fl.geometry.dispose()
      }
    }
  }
  // Optional drifting ambient petals / leaves around the outer crown silhouette
  if (sh.petals > 0) {
    const cIn = spec.kind === 'broadleaf' ? spec.leaves.tintInner
      : spec.kind === 'bamboo' ? spec.bamboo.tintInner
        : spec.kind === 'lotus' ? spec.lotus.petalBaseColor
          : spec.kind === 'flowerbed' ? spec.flowerbed.tintInner : spec.flowers.tintInner
    const cOut = spec.kind === 'broadleaf' ? spec.leaves.tintOuter
      : spec.kind === 'bamboo' ? spec.bamboo.tintOuter
        : spec.kind === 'lotus' ? spec.lotus.petalTipColor
          : spec.kind === 'flowerbed' ? spec.flowerbed.tintOuter : spec.flowers.tintOuter
    const pt = buildAmbientPetals(env, sh.petals, cIn, cOut, spec.seed)
    const pMat = trackMat(makePetalMaterial())
    petalsMesh = new Mesh(pt.geometry, pMat)
    petalsMesh.name = 'Ambient petals'
    petalsMesh.userData.role = 'particle'
    meshes.push(petalsMesh)
    stats.triangles += meshTriCount(pt.geometry)
  }
  // Optional stylized ancient wishing-tree decorative accents (mossy boulders, flat-folded silk ribbons, wooden plaques, golden sparkles)
  if (sh.accent === 'wishing' && !ground && !flowerbed && !lotus) {
    const acc = buildWishingAccents(skeleton, spec.seed, spec.accents)
    accentGroup = acc.group
    accentTriangles = acc.triangles
    group.add(accentGroup)
    accentDisposables.push(...acc.disposables)
    stats.triangles += acc.triangles
  }
  if (spec.kind !== 'broadleaf' && hasLeafEdits(spec.leafEdits)) {
    for (const mesh of meshes) {
      if (mesh.userData.role !== 'foliage') continue
      const beforeTris = meshTriCount(mesh.geometry)
      applyLeafEditsToGeometry(mesh.geometry, spec.leafEdits, spec.seed)
      stats.triangles += meshTriCount(mesh.geometry) - beforeTris
    }
  }
  for (const mesh of meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = mesh.userData.role === 'wood' || !sh.softSelfShadow
    group.add(mesh)
  }
  stats.ms = Math.round(performance.now() - started)
  const setAlphaTest = (mesh: Mesh, next: number) => {
    const mat = mesh.material as MeshStandardMaterial
    const prev = mat.alphaTest
    mat.alphaTest = next
    if ((prev > 0) !== (next > 0)) mat.needsUpdate = true
  }
  let currentBarkTex = textures.bark
  let currentBarkIsFlow = Boolean(woodSculptLodParams(opt.woodDetail, spec.trunk.sculpt).active && spec.trunk.sculpt?.uvMode === 'flow')
  const recomputeLiveTriangles = () => {
    let total = accentTriangles
    for (const m of meshes) total += meshTriCount(m.geometry)
    stats.triangles = total
  }
  return {
    group, stats, skeleton,
    display(view: View) {
      currentView = view
      for (const mesh of meshes) mesh.visible = mesh.userData.role === 'wood' ? view !== 'crown' : view !== 'skeleton'
      if (accentGroup) accentGroup.visible = view === 'final'
    },
    /** Fast-path LOD remeshing using cached skeleton & unreduced leaf-card placement (zero RNG resample).
     *  Skips skeleton generation and spatial-hash leaf placement; updates stats & disposes replaced geometries. */
    remeshForOptimize(nextSpec: TreeSpec): boolean {
      if (nextSpec.kind !== currentSpec.kind || nextSpec.seed !== currentSpec.seed) return false
      if (nextSpec.kind !== 'broadleaf' && hasLeafEdits(nextSpec.leafEdits)) return false
      if (spec.kind === 'broadleaf' && (!leafPlacementCache || nextSpec.leaves.cardType !== currentSpec.leaves.cardType)) {
        return false
      }
      const t0 = performance.now()
      const nextOpt = nextSpec.optimize

      // 1. Update wood mesh & sculpt LOD bark uniforms (broadleaf, conifer, palm)
      if (wood) {
        const nextWoodGeo = buildWoodGeometryFor(nextSpec)
        if (!nextWoodGeo) return false
        if (!palm) {
          const nextSculpt = nextSpec.trunk.sculpt
          const nextSculptLod = woodSculptLodParams(nextOpt.woodDetail, nextSculpt)
          const nextIsFlow = Boolean(nextSculptLod.active && nextSculpt?.uvMode === 'flow')
          if (nextIsFlow !== currentBarkIsFlow) {
            const nextBark = buildBarkFor(nextSpec, textures)
            wood.material = nextBark
            if (twigsMesh) twigsMesh.material = nextBark
            currentBark.dispose()
            currentBark = nextBark
            currentBarkIsFlow = nextIsFlow
          } else {
            const u = currentBark.userData?.barkUniforms as Record<string, { value: unknown }> | undefined
            if (u) {
              u.uBarkUvMode.value = nextIsFlow ? 1 : 0
              u.uBarkLodBoost.value = nextSculptLod.lodNormalBoost
              u.uBarkSculpt.value = nextSculpt?.intensity ?? 0
              u.uHasBarkMetric.value = nextSculptLod.active ? 1 : 0
            }
            if (currentBark.normalMap) {
              const s = 0.45 + (nextSpec.trunk.barkDetail ?? .72) * 0.45 + nextSculptLod.lodNormalBoost * 0.45
              currentBark.normalScale.set(s, s)
            }
          }
        }
        swapMeshGeometry(wood, nextWoodGeo)
        currentWoodGeometry = nextWoodGeo
      }

      // 2. Remesh foliage / kind-specific geometry in-place reusing cached skeleton & placement
      let nextSites: FoliageSite[] = []
      const nextCustomNormal = isCustomNormalActive(nextSpec.normalEdit)
      if (spec.kind === 'broadleaf' && leafPlacementCache && broadleafLeafMesh) {
        const info = remeshLeafPlacement(leafPlacementCache, { flat: nextOpt.flatCards, reduce: nextOpt.cardReduction })
        if (nextCustomNormal) applyCustomLeafNormals(info.geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(broadleafLeafMesh, info.geometry)
        if (!nextOpt.cullHiddenWood) {
          const twigGeo = buildTwigs(info.twigs, nextSpec.trunk.barkColor)
          if (twigsMesh) {
            twigsMesh.material = currentBark
            swapMeshGeometry(twigsMesh, twigGeo)
          } else {
            const twigs = new Mesh(twigGeo, currentBark)
            twigs.name = 'Twigs'
            twigs.userData.role = 'wood'
            twigsMesh = addMeshToLive(twigs)
          }
          stats.twigs = info.twigs.length
        } else {
          if (twigsMesh) {
            removeMeshFromLive(twigsMesh)
            twigsMesh = undefined
          }
          stats.twigs = 0
        }
        stats.leaves = info.cards.length + info.strips
        if (nextSpec.flowers.enabled) {
          nextSites = info.cards.length
            ? sitesFromLeafCards(info.cards, env)
            : sitesFromGeometry(info.geometry, env, nextSpec.leaves.leafSize)
        }
      } else if (palm && palmFrondMesh) {
        const { geometry, fronds } = buildPalmFronds(skeleton.trunk, env, nextSpec)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(palmFrondMesh, geometry)
        stats.leaves = fronds
        if (nextSpec.flowers.enabled) nextSites = sitesFromGeometry(geometry, env, nextSpec.palm.frondWidth * .7)
      } else if (bamboo && bambooCulmMesh && bambooLeafMesh) {
        const bam = buildBamboo(nextSpec, env, bambooSprayTexture)
        swapMeshGeometry(bambooCulmMesh, bam.culmsGeometry)
        if (nextCustomNormal) applyCustomLeafNormals(bam.leavesGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(bambooLeafMesh, bam.leavesGeometry)
        stats.branches = bam.branches
        stats.leaves = bam.leaves
        if (nextSpec.flowers.enabled) nextSites = sitesFromGeometry(bam.leavesGeometry, env, nextSpec.bamboo.leafSize * .6)
      } else if (lotus && lotusLeavesMesh) {
        const lt = buildLotus(nextSpec, env)
        if (lt.stemsGeometry) {
          if (lotusStemsMesh) {
            swapMeshGeometry(lotusStemsMesh, lt.stemsGeometry)
          } else {
            if (!lotusStemMat) {
              lotusStemMat = trackMat(makeStemMaterial())
              lotusStemMat.name = 'LotusStems'
              lotusStemMat.roughness = .62
            }
            const stems = new Mesh(lt.stemsGeometry, lotusStemMat)
            stems.name = 'Lotus stems'
            stems.userData.role = 'wood'
            lotusStemsMesh = addMeshToLive(stems)
          }
          stats.branches = lt.stems
        } else {
          if (lotusStemsMesh) { removeMeshFromLive(lotusStemsMesh); lotusStemsMesh = undefined }
          stats.branches = 0
        }
        if (nextCustomNormal) applyCustomLeafNormals(lt.leavesGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(lotusLeavesMesh, lt.leavesGeometry)
        stats.leaves = lt.leaves
        if (lt.petalsGeometry) {
          if (lotusPetalsMesh) {
            swapMeshGeometry(lotusPetalsMesh, lt.petalsGeometry)
          } else {
            if (!lotusPetalMat) {
              const petalTex = textures.lotusPetal ?? getFallbackLotusPetalTex(textures.blossom ?? textures.flower ?? textures.leaf)
              lotusPetalMat = trackMat(makeLeafMaterial(petalTex, nextSpec.lotus.alphaCutoff, .42, 0, {
                ...leafStyle(nextSpec.lotus.petalTipColor),
                translucency: Math.max(.55, sh.translucency),
                roughness: .58,
              }))
              lotusPetalMat.name = 'LotusPetals'
            }
            const petalMesh = new Mesh(lt.petalsGeometry, lotusPetalMat)
            petalMesh.name = 'Lotus petals'
            petalMesh.userData.role = 'foliage'
            lotusPetalsMesh = addMeshToLive(petalMesh)
          }
        } else if (lotusPetalsMesh) {
          removeMeshFromLive(lotusPetalsMesh)
          lotusPetalsMesh = undefined
        }
        if (lt.centersGeometry) {
          if (lotusCentersMesh) {
            swapMeshGeometry(lotusCentersMesh, lt.centersGeometry)
          } else {
            if (!lotusCenterMat) {
              lotusCenterMat = trackMat(makeStemMaterial())
              lotusCenterMat.name = 'LotusCenters'
              lotusCenterMat.roughness = .58
            }
            const centerMesh = new Mesh(lt.centersGeometry, lotusCenterMat)
            centerMesh.name = 'Lotus centers'
            centerMesh.userData.role = 'foliage'
            lotusCentersMesh = addMeshToLive(centerMesh)
          }
        } else if (lotusCentersMesh) {
          removeMeshFromLive(lotusCentersMesh)
          lotusCentersMesh = undefined
        }
        stats.flowers = lt.flowers
      } else if (flowerbed && fbBlossomsMesh) {
        const fb = buildFlowerBed(nextSpec, env)
        if (fb.stemsGeometry) {
          if (fbStemsMesh) {
            swapMeshGeometry(fbStemsMesh, fb.stemsGeometry)
          } else {
            if (!fbStemMat) fbStemMat = trackMat(makeStemMaterial())
            const stems = new Mesh(fb.stemsGeometry, fbStemMat)
            stems.name = 'Flower stems'
            stems.userData.role = 'wood'
            fbStemsMesh = addMeshToLive(stems)
          }
          stats.branches = fb.stems
        } else {
          if (fbStemsMesh) { removeMeshFromLive(fbStemsMesh); fbStemsMesh = undefined }
          stats.branches = 0
        }
        if (fb.stemLeavesGeometry) {
          if (fbStemLeavesMesh) {
            swapMeshGeometry(fbStemLeavesMesh, fb.stemLeavesGeometry)
          } else {
            if (!fbStemLeafMat) {
              const stemLeafMap = textures.stemLeaf ?? textures.leaf
              fbStemLeafMat = trackMat(makeLeafMaterial(stemLeafMap, nextSpec.flowerbed.alphaCutoff, .48, 0, leafStyle(nextSpec.flowerbed.stemTint)))
              fbStemLeafMat.name = 'FlowerStemLeaves'
            }
            const stemLeaves = new Mesh(fb.stemLeavesGeometry, fbStemLeafMat)
            stemLeaves.name = 'Flower stem leaves'
            stemLeaves.userData.role = 'foliage'
            fbStemLeavesMesh = addMeshToLive(stemLeaves)
          }
        } else if (fbStemLeavesMesh) {
          removeMeshFromLive(fbStemLeavesMesh)
          fbStemLeavesMesh = undefined
        }
        if (nextCustomNormal) applyCustomLeafNormals(fb.blossomsGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(fbBlossomsMesh, fb.blossomsGeometry)
        stats.leaves = fb.flowers
        stats.flowers = fb.flowers
      } else if (ground && groundMesh) {
        const { geometry, blades } = buildGround(nextSpec, env)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(groundMesh, geometry)
        stats.leaves = blades
        if (nextSpec.flowers.enabled) nextSites = sitesFromGeometry(geometry, env, Math.max(.14, nextSpec.ground.width * 1.4))
      } else if (coniferFrondMesh) {
        const { geometry, fronds } = buildFronds(skeleton, nextSpec)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        swapMeshGeometry(coniferFrondMesh, geometry)
        stats.leaves = fronds
        if (nextSpec.flowers.enabled) nextSites = sitesFromGeometry(geometry, env, Math.max(.25, nextSpec.fronds.width))
      }

      // 3. Update optional outer-surface flower cards
      const nextFlowerTex = nextSpec.flowers.enabled && nextSites.length > 0 ? resolveFlowerTex(nextSpec) : undefined
      if (nextFlowerTex) {
        const fl = buildFlowers(nextSites, env, nextSpec.flowers, nextOpt, nextSpec.seed)
        if (fl.flowers > 0) {
          if (flowerOverlayMesh) {
            swapMeshGeometry(flowerOverlayMesh, fl.geometry)
          } else {
            const mat = ensureFlowerMaterial(nextSpec, nextFlowerTex)
            const mesh = new Mesh(fl.geometry, mat)
            mesh.name = 'Flower cards'
            mesh.userData.role = 'foliage'
            flowerOverlayMesh = addMeshToLive(mesh)
          }
          stats.flowers = fl.flowers
        } else {
          fl.geometry.dispose()
          if (flowerOverlayMesh) { removeMeshFromLive(flowerOverlayMesh); flowerOverlayMesh = undefined }
          stats.flowers = 0
        }
      } else if (!lotus && !flowerbed) {
        if (flowerOverlayMesh) { removeMeshFromLive(flowerOverlayMesh); flowerOverlayMesh = undefined }
        stats.flowers = 0
      }

      currentSpec = nextSpec
      group.userData.spec = nextSpec
      recomputeLiveTriangles()
      stats.ms = Math.round(performance.now() - t0)
      return true
    },
    /** Builds a standalone Group for `nextSpec` reusing cached skeleton & unreduced leaf placement.
     *  - `shareMaterials: true`: shares exact live Material instances (zero extra wind/RVT uniform overhead);
     *    `dispose()` ONLY disposes clone geometries and never touches live materials/textures.
     *  - `shareMaterials` omitted/false: safe for `exportGlb(clone.group, options)`, and `dispose()` cleans up
     *    clone geometries (and any clone-only temp materials) without touching live asset materials/textures. */
    buildLodClone(nextSpec: TreeSpec, cloneOpts?: { shareMaterials?: boolean }): TreeLodClone {
      if (
        nextSpec.kind !== currentSpec.kind
        || nextSpec.seed !== currentSpec.seed
        || (spec.kind === 'broadleaf' && (!leafPlacementCache || nextSpec.leaves.cardType !== currentSpec.leaves.cardType))
      ) {
        const built = buildTree(nextSpec, textures)
        return { group: built.group, stats: { ...built.stats }, dispose: () => built.dispose() }
      }
      const t0 = performance.now()
      const shareMaterials = Boolean(cloneOpts?.shareMaterials)
      const nextOpt = nextSpec.optimize
      const cloneGroup = new Group()
      cloneGroup.name = 'Vegetation Studio / ' + nextSpec.name + ' / ' + nextSpec.seed
      cloneGroup.userData.spec = nextSpec
      const cloneDisposables: { dispose(): void }[] = []
      const cloneStats: TreeBuildStats = {
        branches: skeleton.branches.length - 1,
        twigs: 0,
        leaves: 0,
        flowers: 0,
        triangles: 0,
        ms: 0,
      }
      const addCloneMesh = (geo: BufferGeometry, mat: Material, name: string, role: string) => {
        cloneDisposables.push(geo)
        const m = new Mesh(geo, mat)
        m.name = name
        m.userData.role = role
        m.castShadow = true
        m.receiveShadow = role === 'wood' || !sh.softSelfShadow
        cloneGroup.add(m)
        cloneStats.triangles += meshTriCount(geo)
        return m
      }

      let cloneBarkMat: Material = currentBark
      if (!shareMaterials && !ground && !flowerbed && !bamboo && !lotus && !palm && nextSpec.trunk.sculpt && nextSpec.trunk.sculpt.intensity > 0) {
        const freshBark = buildBarkFor(nextSpec, textures)
        cloneDisposables.push(freshBark)
        cloneBarkMat = freshBark
      }

      const cloneWoodGeo = buildWoodGeometryFor(nextSpec)
      if (cloneWoodGeo) {
        addCloneMesh(cloneWoodGeo, cloneBarkMat, 'Trunk and branches', 'wood')
      }

      let cloneSites: FoliageSite[] = []
      const nextCustomNormal = isCustomNormalActive(nextSpec.normalEdit)
      if (spec.kind === 'broadleaf' && leafPlacementCache && broadleafLeafMat) {
        const info = remeshLeafPlacement(leafPlacementCache, { flat: nextOpt.flatCards, reduce: nextOpt.cardReduction })
        if (nextCustomNormal) applyCustomLeafNormals(info.geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        if (!nextOpt.cullHiddenWood) {
          const twigGeo = buildTwigs(info.twigs, nextSpec.trunk.barkColor)
          addCloneMesh(twigGeo, cloneBarkMat, 'Twigs', 'wood')
          cloneStats.twigs = info.twigs.length
        }
        addCloneMesh(info.geometry, broadleafLeafMat, 'Leaf cards', 'foliage')
        cloneStats.leaves = info.cards.length + info.strips
        if (nextSpec.flowers.enabled) {
          cloneSites = info.cards.length
            ? sitesFromLeafCards(info.cards, env)
            : sitesFromGeometry(info.geometry, env, nextSpec.leaves.leafSize)
        }
      } else if (palm && palmFrondMat) {
        const { geometry, fronds } = buildPalmFronds(skeleton.trunk, env, nextSpec)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(geometry, palmFrondMat, 'Palm fronds', 'foliage')
        cloneStats.leaves = fronds
        if (nextSpec.flowers.enabled) cloneSites = sitesFromGeometry(geometry, env, nextSpec.palm.frondWidth * .7)
      } else if (bamboo && bambooCulmMat && bambooLeafMat) {
        const bam = buildBamboo(nextSpec, env, bambooSprayTexture)
        addCloneMesh(bam.culmsGeometry, bambooCulmMat, 'Bamboo culms', 'wood')
        if (nextCustomNormal) applyCustomLeafNormals(bam.leavesGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(bam.leavesGeometry, bambooLeafMat, 'Bamboo leaves', 'foliage')
        cloneStats.branches = bam.branches
        cloneStats.leaves = bam.leaves
        if (nextSpec.flowers.enabled) cloneSites = sitesFromGeometry(bam.leavesGeometry, env, nextSpec.bamboo.leafSize * .6)
      } else if (lotus && lotusPadMat) {
        const lt = buildLotus(nextSpec, env)
        if (lt.stemsGeometry) {
          if (!lotusStemMat) {
            lotusStemMat = trackMat(makeStemMaterial())
            lotusStemMat.name = 'LotusStems'
            lotusStemMat.roughness = .62
          }
          addCloneMesh(lt.stemsGeometry, lotusStemMat, 'Lotus stems', 'wood')
          cloneStats.branches = lt.stems
        } else {
          cloneStats.branches = 0
        }
        if (nextCustomNormal) applyCustomLeafNormals(lt.leavesGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(lt.leavesGeometry, lotusPadMat, 'Lotus leaves', 'foliage')
        cloneStats.leaves = lt.leaves
        if (lt.petalsGeometry) {
          if (!lotusPetalMat) {
            const petalTex = textures.lotusPetal ?? getFallbackLotusPetalTex(textures.blossom ?? textures.flower ?? textures.leaf)
            lotusPetalMat = trackMat(makeLeafMaterial(petalTex, nextSpec.lotus.alphaCutoff, .42, 0, {
              ...leafStyle(nextSpec.lotus.petalTipColor),
              translucency: Math.max(.55, sh.translucency),
              roughness: .58,
            }))
            lotusPetalMat.name = 'LotusPetals'
          }
          addCloneMesh(lt.petalsGeometry, lotusPetalMat, 'Lotus petals', 'foliage')
        }
        if (lt.centersGeometry) {
          if (!lotusCenterMat) {
            lotusCenterMat = trackMat(makeStemMaterial())
            lotusCenterMat.name = 'LotusCenters'
            lotusCenterMat.roughness = .58
          }
          addCloneMesh(lt.centersGeometry, lotusCenterMat, 'Lotus centers', 'foliage')
        }
        cloneStats.flowers = lt.flowers
      } else if (flowerbed && fbBlossomsMat) {
        const fb = buildFlowerBed(nextSpec, env)
        if (fb.stemsGeometry) {
          if (!fbStemMat) fbStemMat = trackMat(makeStemMaterial())
          addCloneMesh(fb.stemsGeometry, fbStemMat, 'Flower stems', 'wood')
          cloneStats.branches = fb.stems
        } else {
          cloneStats.branches = 0
        }
        if (fb.stemLeavesGeometry) {
          if (!fbStemLeafMat) {
            const stemLeafMap = textures.stemLeaf ?? textures.leaf
            fbStemLeafMat = trackMat(makeLeafMaterial(stemLeafMap, nextSpec.flowerbed.alphaCutoff, .48, 0, leafStyle(nextSpec.flowerbed.stemTint)))
            fbStemLeafMat.name = 'FlowerStemLeaves'
          }
          addCloneMesh(fb.stemLeavesGeometry, fbStemLeafMat, 'Flower stem leaves', 'foliage')
        }
        if (nextCustomNormal) applyCustomLeafNormals(fb.blossomsGeometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(fb.blossomsGeometry, fbBlossomsMat, 'Flower blossoms', 'foliage')
        cloneStats.leaves = fb.flowers
        cloneStats.flowers = fb.flowers
      } else if (ground && groundMat) {
        const { geometry, blades } = buildGround(nextSpec, env)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(geometry, groundMat, groundMat.name, 'foliage')
        cloneStats.leaves = blades
        if (nextSpec.flowers.enabled) cloneSites = sitesFromGeometry(geometry, env, Math.max(.14, nextSpec.ground.width * 1.4))
      } else if (coniferFrondMat) {
        const { geometry, fronds } = buildFronds(skeleton, nextSpec)
        if (nextCustomNormal) applyCustomLeafNormals(geometry, env, nextSpec.normalEdit!, nextSpec.seed)
        addCloneMesh(geometry, coniferFrondMat, 'Needle fronds', 'foliage')
        cloneStats.leaves = fronds
        if (nextSpec.flowers.enabled) cloneSites = sitesFromGeometry(geometry, env, Math.max(.25, nextSpec.fronds.width))
      }

      if (nextSpec.flowers.enabled && cloneSites.length > 0) {
        const cloneFlowerTex = resolveFlowerTex(nextSpec)
        if (cloneFlowerTex) {
          const fl = buildFlowers(cloneSites, env, nextSpec.flowers, nextOpt, nextSpec.seed)
          if (fl.flowers > 0) {
            const mat = ensureFlowerMaterial(nextSpec, cloneFlowerTex)
            addCloneMesh(fl.geometry, mat, 'Flower cards', 'foliage')
            cloneStats.flowers = fl.flowers
          } else {
            fl.geometry.dispose()
          }
        }
      }

      if (petalsMesh) {
        addCloneMesh(petalsMesh.geometry.clone(), petalsMesh.material as Material, 'Ambient petals', 'particle')
      }
      if (accentGroup) {
        cloneGroup.add(cloneStaticSubtree(accentGroup, cloneDisposables))
        cloneStats.triangles += accentTriangles
      }

      cloneStats.ms = Math.round(performance.now() - t0)
      return {
        group: cloneGroup,
        stats: cloneStats,
        dispose() {
          for (const d of cloneDisposables) d.dispose()
        },
      }
    },
    /** Fast-path incremental rebuild for wood-only parameters (trunk sculpt, flare, bark ridges,
     *  bark color, surface roots, woodDetail): rebuilds ONLY wood geometry & bark material while
     *  preserving the cached skeleton, leaf cards, fronds, flowers, twigs, petals, and accents! */
    rebuildWoodOnly(nextSpec: TreeSpec, nextTextures: TreeTextures): boolean {
      if (!wood || (nextSpec.kind !== 'broadleaf' && nextSpec.kind !== 'conifer')) return false
      if (nextSpec.kind !== currentSpec.kind || nextSpec.seed !== currentSpec.seed) return false
      if (nextSpec.kind !== 'broadleaf' && hasLeafEdits(nextSpec.leafEdits)) return false
      const t0 = performance.now()
      const nextOpt = nextSpec.optimize
      const nextSculpt = nextSpec.trunk.sculpt
      const nextSculptLod = woodSculptLodParams(nextOpt.woodDetail, nextSculpt)
      const nextEffectiveBarkTex = nextTextures.bark ?? resolveStyleBarkTexture(nextSpec.trunk.barkStyle)
      const nextHeightField = nextSculpt && nextSculpt.heightDisplace > 0.001
        ? getBarkHeightField(nextEffectiveBarkTex)
        : undefined
      const nextWoodGeometry = buildWood(skeleton.branches, nextSpec.trunk, nextSpec.seed, {
        detail: nextOpt.woodDetail,
        skip: makeSkipWood(nextSpec),
        heightField: nextHeightField,
      })
      const nextBarkStyle: BarkStyle = nextSpec.trunk.barkStyle ?? 'default'
      const nextIsBirch = isBirchBark(nextSpec, nextTextures)
      if (nextIsBirch) {
        applyBirchWoodSurface(nextWoodGeometry, skeleton.trunk, nextSpec.trunk.height, nextSpec.seed)
      }
      const nextIsFlow = Boolean(nextSculptLod.active && nextSculpt?.uvMode === 'flow')
      const needsNewBark = nextIsBirch
        || currentBarkStyle !== nextBarkStyle
        || nextTextures.bark !== currentBarkTex
        || nextIsFlow !== currentBarkIsFlow
      if (needsNewBark) {
        const nextBark = buildBarkFor(nextSpec, nextTextures)
        wood.material = nextBark
        if (twigsMesh) twigsMesh.material = nextBark
        currentBark.dispose()
        currentBark = nextBark
        currentBarkStyle = nextBarkStyle
        currentBarkTex = nextTextures.bark
        currentBarkIsFlow = nextIsFlow
      } else {
        const u = currentBark.userData?.barkUniforms as Record<string, { value: unknown }> | undefined
        if (u) {
          u.uBarkUvMode.value = nextIsFlow ? 1 : 0
          u.uBarkLodBoost.value = nextSculptLod.lodNormalBoost
          u.uBarkSculpt.value = nextSculpt?.intensity ?? 0
          u.uHasBarkMetric.value = nextSculptLod.active ? 1 : 0
          const bc = new Color(nextSpec.trunk.barkColor || '#5b4636')
          u.uBarkBaseLum.value = Math.max(.03, bc.r * .2126 + bc.g * .7152 + bc.b * .0722)
          if (u.uBarkTargetColor?.value instanceof Color) u.uBarkTargetColor.value.copy(bc)
        }
        if (currentBark.normalMap) {
          const s = 0.45 + (nextSpec.trunk.barkDetail ?? .72) * 0.45 + nextSculptLod.lodNormalBoost * 0.45
          currentBark.normalScale.set(s, s)
        }
      }
      if (twigsMesh && nextSpec.trunk.barkColor !== currentSpec.trunk.barkColor) {
        const colAttr = twigsMesh.geometry.getAttribute('color') as BufferAttribute | undefined
        if (colAttr) {
          const tc = nextSpec.trunk.barkColor && nextSpec.trunk.barkColor.toLowerCase() !== '#5b4636'
            ? new Color(nextSpec.trunk.barkColor).lerp(new Color('#c8beb8'), .12)
            : new Color('#6b5842')
          for (let i = 0; i < colAttr.count; i++) colAttr.setXYZ(i, tc.r, tc.g, tc.b)
          colAttr.needsUpdate = true
        }
      }
      const prevTris = currentWoodGeometry?.index ? currentWoodGeometry.index.count / 3 : 0
      const nextTris = nextWoodGeometry.index ? nextWoodGeometry.index.count / 3 : 0
      wood.geometry = nextWoodGeometry
      currentWoodGeometry?.dispose()
      currentWoodGeometry = nextWoodGeometry
      currentSpec = nextSpec
      group.userData.spec = nextSpec
      stats.triangles = Math.max(0, stats.triangles - prevTris + nextTris)
      stats.ms = Math.round(performance.now() - t0)
      return true
    },
    /** Fast-path hot update for pure material/shader parameters (0 ms geometry rebuild).
     *  Returns true if handled in-place, false if a geometry rebuild is required. */
    applyLiveParam(path: string, nextSpec: TreeSpec): boolean {
      const foliageMeshes = meshes.filter(m => m.userData.role === 'foliage')
      const primary = foliageMeshes.find(m => m.name !== 'Flower cards' && m.name !== 'Ambient petals')
      const flowerMesh = foliageMeshes.find(m => m.name === 'Flower cards')
      const uniformOf = (m: Mesh) => (m.material as MeshStandardMaterial).userData?.leafUniforms as Record<string, { value: number }> | undefined
      const barkUniforms = (currentBark.userData?.barkUniforms as Record<string, { value: unknown }> | undefined)
      // Painted birch bark bakes color/moss/scale/detail into its procedural canvas/DataTexture;
      // returning false routes cleanly to 4ms `rebuildWoodOnly()` without rebuilding leaves!
      if (currentBark.userData?.barkStyle === 'birch' && path.startsWith('trunk.bark')) {
        return false
      }
      let handled = false
      switch (path) {
        case 'trunk.barkScale':
          if (barkUniforms) barkUniforms.uBarkScale.value = nextSpec.trunk.barkScale ?? 1
          handled = true; break
        case 'trunk.barkDetail': {
          const det = nextSpec.trunk.barkDetail ?? .72
          if (barkUniforms) barkUniforms.uBarkDetail.value = det
          if (currentBark.normalMap) {
            const lodBoost = Number(barkUniforms?.uBarkLodBoost?.value ?? 0)
            const ns = 0.45 + det * 0.45 + lodBoost * 0.45
            currentBark.normalScale.set(ns, ns)
          }
          handled = true; break
        }
        case 'trunk.barkColor':
          // When a custom/library bark texture is bound, perceptual HSL recoloring updates in 0 ms!
          if (barkUniforms && Number(barkUniforms.uUseBarkMap?.value) > 0.5 && barkUniforms.uBarkTargetColor?.value instanceof Color) {
            barkUniforms.uBarkTargetColor.value.set(nextSpec.trunk.barkColor || '#5b4636')
            handled = true
          }
          break
        case 'trunk.barkTint':
          if (barkUniforms) barkUniforms.uBarkTint.value = nextSpec.trunk.barkTint ?? .45
          handled = true; break
        case 'trunk.barkMoss':
          if (barkUniforms) barkUniforms.uBarkMoss.value = nextSpec.trunk.barkMoss ?? 0
          handled = true; break
        case 'trunk.barkMossColor':
          if (barkUniforms && barkUniforms.uBarkMossColor?.value instanceof Color) {
            barkUniforms.uBarkMossColor.value.set(nextSpec.trunk.barkMossColor || '#5d9132')
          }
          handled = true; break
        case 'trunk.barkRootAO':
          if (barkUniforms) barkUniforms.uBarkRootAO.value = nextSpec.trunk.barkRootAO ?? .25
          handled = true; break
        case 'shading.translucency':
          for (const m of foliageMeshes) { const u = uniformOf(m); if (u) u.uLeafSSS.value = nextSpec.shading.translucency }
          handled = true; break
        case 'shading.rimLight':
          for (const m of foliageMeshes) { const u = uniformOf(m); if (u) u.uLeafRim.value = nextSpec.shading.rimLight }
          handled = true; break
        case 'shading.shadowShift':
          for (const m of foliageMeshes) { const u = uniformOf(m); if (u) u.uShadowShift.value = nextSpec.shading.shadowShift }
          if (barkUniforms) barkUniforms.uBarkShadowShift.value = nextSpec.shading.shadowShift
          handled = true; break
        case 'shading.topWarmth':
          for (const m of foliageMeshes) { const u = uniformOf(m); if (u) u.uTopWarmth.value = nextSpec.shading.topWarmth }
          handled = true; break
        case 'shading.softSelfShadow':
          for (const m of foliageMeshes) m.receiveShadow = !nextSpec.shading.softSelfShadow
          handled = true; break
        case 'leaves.alphaCutoff':
          if (nextSpec.kind === 'broadleaf' && primary) { setAlphaTest(primary, nextSpec.leaves.alphaCutoff); handled = true }
          break
        case 'fronds.alphaCutoff':
          if (nextSpec.kind === 'conifer' && primary) { setAlphaTest(primary, nextSpec.fronds.alphaCutoff); handled = true }
          break
        case 'palm.alphaCutoff':
          if (nextSpec.kind === 'palm' && primary) { setAlphaTest(primary, nextSpec.palm.alphaCutoff); handled = true }
          break
        case 'bamboo.alphaCutoff':
          if (nextSpec.kind === 'bamboo' && primary) { setAlphaTest(primary, nextSpec.bamboo.alphaCutoff); handled = true }
          break
        case 'lotus.alphaCutoff':
          if (nextSpec.kind === 'lotus') {
            for (const m of foliageMeshes) {
              if (m.name === 'Lotus leaves' || m.name === 'Lotus petals') setAlphaTest(m, nextSpec.lotus.alphaCutoff)
            }
            handled = true
          }
          break
        case 'ground.alphaCutoff':
          if ((nextSpec.kind === 'grass' || nextSpec.kind === 'fern') && primary) {
            if ((primary.material as MeshStandardMaterial).map) setAlphaTest(primary, nextSpec.ground.alphaCutoff)
            handled = true
          }
          break
        case 'flowerbed.alphaCutoff':
          if (nextSpec.kind === 'flowerbed') {
            for (const m of foliageMeshes) {
              if (m.name === 'Flower blossoms' || m.name === 'Flower stem leaves') setAlphaTest(m, nextSpec.flowerbed.alphaCutoff)
            }
            handled = true
          }
          break
        case 'flowers.alphaCutoff':
          if (flowerMesh) setAlphaTest(flowerMesh, nextSpec.flowers.alphaCutoff)
          handled = true; break
        case 'leaves.cameraFacing':
          if (nextSpec.kind === 'broadleaf' && primary) {
            const u = uniformOf(primary)
            if (u) u.uLeafFacing.value = (nextSpec.leaves.cardType === 'cross' || nextSpec.leaves.cardType === 'tri' || nextSpec.leaves.cardType === 'drape') ? 0 : nextSpec.leaves.cameraFacing
            handled = true
          }
          break
        case 'flowers.cameraFacing':
          if (flowerMesh) {
            const u = uniformOf(flowerMesh)
            if (u) u.uLeafFacing.value = nextSpec.flowers.cardType === 'cross' ? 0 : nextSpec.flowers.cameraFacing
          }
          handled = true; break
      }
      if (handled) {
        currentSpec = nextSpec
        group.userData.spec = nextSpec
      }
      return handled
    },
    exportGlb: (options?: ExportGlbOptions) => exportGlb(group, options),
    dispose() {
      const disposedGeos = new Set<BufferGeometry>()
      for (const m of meshes) {
        if (m.geometry && !disposedGeos.has(m.geometry)) {
          disposedGeos.add(m.geometry)
          m.geometry.dispose()
        }
      }
      if (currentWoodGeometry && !disposedGeos.has(currentWoodGeometry)) {
        currentWoodGeometry.dispose()
      }
      currentBark.dispose()
      for (const mat of ownedMaterials) mat.dispose()
      for (const d of accentDisposables) d.dispose()
    },
  }
}
export type TreeAsset = ReturnType<typeof buildTree>

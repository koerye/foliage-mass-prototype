import { BufferAttribute, Color, Group, Mesh, MeshStandardMaterial, type Texture } from 'three'
import { exportGlb, type ExportGlbOptions } from '../export-glb'
import { Batch } from '../mesh'
import { makeLeafMaterial } from '../broadleaf/leaf-material'
import { generateLeafCards, type Twig } from '../broadleaf/leaves'
import { makeBarkMaterial, makePetalMaterial, makeStemMaterial } from './bark-material'
import { buildFlowerBed } from './flowerbed'
import { buildAmbientPetals, buildFlowers, sitesFromGeometry, sitesFromLeafCards, type FoliageSite } from './flowers'
import { buildFronds } from './fronds'
import { buildGround } from './ground'
import { applyCustomLeafNormals, isCustomNormalActive } from './leaf-normals'
import { buildPalmFronds, buildPalmWood } from './palm'
import { buildSkeleton, hasGeometricEdit, hasGlobalBranchOffset, type Skeleton } from './skeleton'
import type { TreeSpec } from './spec'
import { buildWishingAccents } from './wishing-accents'
import { buildWood } from './wood'
import { getBarkHeightField, woodSculptLodParams } from './wood-sculpt'

export const views = ['final', 'skeleton', 'crown'] as const
export type View = typeof views[number]

const WOOD_ONLY_PARAMS = new Set([
  'trunk.sculpt',
  'trunk.barkRidges',
  'trunk.barkDepth',
  'trunk.flare',
  'trunk.flareLobes',
  'trunk.flareHeight',
  'trunk.surfaceRoots',
  'trunk.barkColor',
  'optimize.woodDetail',
])

/** Returns true when editing `path` ONLY changes wood mesh geometry or bark material
 *  (zero change to skeleton, leaf cards, fronds, flowers, petals, or wishing accents). */
export function isWoodOnlyParam(path: string): boolean {
  return path.startsWith('trunk.sculpt.') || WOOD_ONLY_PARAMS.has(path)
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
  grass: Texture
  grassTint?: Texture
  fern: Texture
  flower?: Texture
  blossom?: Texture
  stemLeaf?: Texture
  sakura?: Texture
  cloud?: Texture
  oak?: Texture
  oakAtlas?: Texture
  maple?: Texture
  willow?: Texture
  bush?: Texture
  wildrose?: Texture
}

export function buildTree(
  spec: TreeSpec,
  textures: TreeTextures,
  options: { skeleton?: Skeleton; foliage?: Mesh } = {},
) {
  const started = performance.now()
  const skeleton = options.skeleton ?? buildSkeleton(spec)
  const env = skeleton.envelope
  const group = new Group()
  group.name = 'Vegetation Studio / ' + spec.name + ' / ' + spec.seed
  group.userData.spec = spec
  const opt = spec.optimize
  const ground = spec.kind === 'grass' || spec.kind === 'fern'
  const flowerbed = spec.kind === 'flowerbed'
  const palm = spec.kind === 'palm'
  const makeSkipWood = (s: TreeSpec) => s.optimize.cullHiddenWood
    ? (b: typeof skeleton.branches[number]) => {
      if (b.role === 'trunk' || b.role === 'dead') return false
      if (env.bare(b.curve.getPoint(.6)) >= .25) return false
      if (s.kind === 'conifer' && s.fronds.mode === 'leaf' && b.role === 'limb') return true
      if (s.kind === 'broadleaf' && s.optimize.woodDetail < .45 && b.role === 'child') return true
      return false
    }
    : undefined

  const buildBarkFor = (s: TreeSpec, tex: TreeTextures) => {
    const sc = s.trunk.sculpt
    const scLod = woodSculptLodParams(s.optimize.woodDetail, sc)
    return makeBarkMaterial(tex.bark, {
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
  let currentBark = buildBarkFor(spec, textures)
  const barkHeightField = spec.trunk.sculpt && spec.trunk.sculpt.heightDisplace > 0.001
    ? getBarkHeightField(textures.bark)
    : undefined
  let currentWoodGeometry = (ground || flowerbed) ? undefined
    : palm ? buildPalmWood(skeleton.trunk, spec)
      : buildWood(skeleton.branches, spec.trunk, spec.seed, { detail: opt.woodDetail, skip: makeSkipWood(spec), heightField: barkHeightField })
  const wood = currentWoodGeometry ? new Mesh(currentWoodGeometry, currentBark) : undefined
  if (wood) {
    wood.name = 'Trunk and branches'
    wood.userData.role = 'wood'
  }
  let twigsMesh: Mesh | undefined
  const meshes: Mesh[] = wood ? [wood] : []
  const disposables: { dispose(): void }[] = []
  const stats = { branches: skeleton.branches.length - 1, twigs: 0, leaves: 0, flowers: 0, triangles: currentWoodGeometry ? currentWoodGeometry.index!.count / 3 : 0, ms: 0 }
  let sites: FoliageSite[] = []

  const sh = spec.shading
  const customNormalOn = isCustomNormalActive(spec.normalEdit)
  const keepCustomNormal = customNormalOn ? spec.normalEdit!.mode !== 'original' : undefined
  const leafStyle = (shadowFrom: string) => ({
    translucency: sh.translucency,
    rimLight: sh.rimLight,
    shadowShift: sh.shadowShift,
    topWarmth: sh.topWarmth,
    shadowFrom,
    ...(keepCustomNormal !== undefined ? { keepNormal: keepCustomNormal } : {}),
  })

  if (spec.kind === 'broadleaf' && options.foliage) {
    const foliage = options.foliage
    foliage.userData.role = 'foliage'
    meshes.push(foliage)
    const position = foliage.geometry.getAttribute('position')
    stats.triangles += (foliage.geometry.index?.count ?? position.count) / 3
    if (spec.flowers.enabled) sites = sitesFromGeometry(foliage.geometry, env, spec.leaves.leafSize)
  } else if (spec.kind === 'broadleaf') {
    const carriers = skeleton.branches.filter(b => b.role !== 'dead' && !b.bare)
    const hasBranchGeomEdit = hasGlobalBranchOffset(spec.branches) || Boolean(spec.branchEdits?.some(hasGeometricEdit))
    const lift = Math.max(0, Math.min(.75, spec.crown.canopyLift ?? 0))
    const info = generateLeafCards({ limbs: carriers, clusters: skeleton.clusters, config: { seed: spec.seed } }, spec.leaves, {
      // When node edits reshaped the skeleton, let leaves.ts use its live post-edit fitted envelope
      // instead of pre-edit CrownEnvelope rho so moved/bent outer lobes never inherit dark interior AO.
      radius: hasBranchGeomEdit ? undefined : p => env.rho(p),
      preserveClumpShells: hasBranchGeomEdit,
      keep: (p, r) => {
        if (lift > 0) {
          const u = (p.y - env.y0) / Math.max(.2, env.height)
          if (u < lift * .82 && env.rho(p) < .84 - u * .25) return false
        }
        return env.bare(p) < .3 + r * .45
      },
      padFlatten: spec.crown.padFlatten,
      flat: opt.flatCards,
      reduce: opt.cardReduction,
    })
    const styleMap = (() => {
      switch (sh.leafStyle) {
        case 'sakura': return textures.sakura ?? textures.flower ?? textures.leaf
        case 'cloud': return textures.cloud ?? textures.leaf
        case 'oak':
          return (spec.leaves.atlasCols > 1 || spec.leaves.atlasRows > 1)
            ? (textures.oakAtlas ?? textures.oak ?? textures.leaf)
            : (textures.oak ?? textures.leaf)
        case 'maple': return textures.maple ?? textures.leaf
        case 'willow': return textures.willow ?? textures.leaf
        case 'bush': return textures.bush ?? textures.leaf
        case 'flower': return textures.flower ?? textures.leaf
        default: return textures.leaf
      }
    })()
    const noFacing = spec.leaves.cardType === 'cross' || spec.leaves.cardType === 'tri' || spec.leaves.cardType === 'drape'
    if (customNormalOn) applyCustomLeafNormals(info.geometry, env, spec.normalEdit!, spec.seed)
    const material = makeLeafMaterial(styleMap, spec.leaves.alphaCutoff, spec.leaves.normalSpherize,
      noFacing ? 0 : spec.leaves.cameraFacing, leafStyle(spec.leaves.tintInner))
    const leaves = new Mesh(info.geometry, material)
    leaves.name = 'Leaf cards'
    leaves.userData.role = 'foliage'
    if (!opt.cullHiddenWood) {
      const twigGeometry = buildTwigs(info.twigs, spec.trunk.barkColor)
      const twigs = new Mesh(twigGeometry, currentBark)
      twigs.name = 'Twigs'
      twigs.userData.role = 'wood'
      twigsMesh = twigs
      meshes.push(twigs)
      disposables.push(twigGeometry)
      stats.twigs = info.twigs.length
      stats.triangles += twigGeometry.index!.count / 3
    }
    meshes.push(leaves)
    disposables.push(info.geometry, material)
    stats.leaves = info.cards.length + info.strips
    stats.triangles += info.geometry.index!.count / 3
    if (spec.flowers.enabled) sites = info.cards.length ? sitesFromLeafCards(info.cards, env) : sitesFromGeometry(info.geometry, env, spec.leaves.leafSize)
  } else if (palm) {
    const { geometry, fronds } = buildPalmFronds(skeleton.trunk, env, spec)
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    const material = makeLeafMaterial(textures.palm, spec.palm.alphaCutoff, spec.palm.spherize, 0, leafStyle(spec.palm.tintInner))
    material.name = 'PalmFronds'
    const mesh = new Mesh(geometry, material)
    mesh.name = 'Palm fronds'
    mesh.userData.role = 'foliage'
    meshes.push(mesh)
    disposables.push(geometry, material)
    stats.leaves = fronds
    stats.triangles += geometry.index!.count / 3
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, spec.palm.frondWidth * .7)
  } else if (flowerbed) {
    const fb = buildFlowerBed(spec, env)
    if (fb.stemsGeometry) {
      const stemMat = makeStemMaterial()
      const stems = new Mesh(fb.stemsGeometry, stemMat)
      stems.name = 'Flower stems'
      stems.userData.role = 'wood'
      meshes.push(stems)
      disposables.push(fb.stemsGeometry, stemMat)
      stats.branches = fb.stems
      stats.triangles += fb.stemsGeometry.index!.count / 3
    } else {
      stats.branches = 0
    }
    if (fb.stemLeavesGeometry) {
      const stemLeafMap = textures.stemLeaf ?? textures.leaf
      const stemLeafMat = makeLeafMaterial(stemLeafMap, spec.flowerbed.alphaCutoff, .48, 0, leafStyle(spec.flowerbed.stemTint))
      stemLeafMat.name = 'FlowerStemLeaves'
      const stemLeaves = new Mesh(fb.stemLeavesGeometry, stemLeafMat)
      stemLeaves.name = 'Flower stem leaves'
      stemLeaves.userData.role = 'foliage'
      meshes.push(stemLeaves)
      disposables.push(fb.stemLeavesGeometry, stemLeafMat)
      stats.triangles += fb.stemLeavesGeometry.index!.count / 3
    }
    const map = textures.blossom ?? textures.flower ?? textures.leaf
    if (customNormalOn) applyCustomLeafNormals(fb.blossomsGeometry, env, spec.normalEdit!, spec.seed)
    const material = makeLeafMaterial(map, spec.flowerbed.alphaCutoff, .65, 0, leafStyle(spec.flowerbed.tintInner))
    material.name = 'FlowerBedBlossoms'
    const mesh = new Mesh(fb.blossomsGeometry, material)
    mesh.name = 'Flower blossoms'
    mesh.userData.role = 'foliage'
    meshes.push(mesh)
    disposables.push(fb.blossomsGeometry, material)
    stats.leaves = fb.flowers
    stats.flowers = fb.flowers
    stats.triangles += fb.blossomsGeometry.index!.count / 3
  } else if (ground) {
    const { geometry, blades } = buildGround(spec, env)
    const modeledBlade = spec.kind === 'grass' && spec.ground.mode !== 'card'
    const map = modeledBlade ? undefined : (spec.kind === 'fern' ? textures.fern : textures.grass)
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    const material = makeLeafMaterial(map, modeledBlade ? 0 : spec.ground.alphaCutoff, spec.ground.spherize, 0, leafStyle(spec.ground.tintBase))
    material.name = spec.kind === 'fern' ? 'FernFronds' : 'GrassBlades'
    const mesh = new Mesh(geometry, material)
    mesh.name = material.name
    mesh.userData.role = 'foliage'
    meshes.push(mesh)
    disposables.push(geometry, material)
    stats.leaves = blades
    stats.triangles += geometry.index!.count / 3
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, Math.max(.14, spec.ground.width * 1.4))
  } else {
    const { geometry, fronds } = buildFronds(skeleton, spec)
    const map = spec.fronds.mode === 'drape' ? textures.drape : textures.needle
    if (customNormalOn) applyCustomLeafNormals(geometry, env, spec.normalEdit!, spec.seed)
    const material = makeLeafMaterial(map, spec.fronds.alphaCutoff, spec.fronds.spherize, 0, leafStyle(spec.fronds.tintInner))
    material.name = 'NeedleFronds'
    const mesh = new Mesh(geometry, material)
    mesh.name = 'Needle fronds'
    mesh.userData.role = 'foliage'
    meshes.push(mesh)
    disposables.push(geometry, material)
    stats.leaves = fronds
    stats.triangles += geometry.index!.count / 3
    if (spec.flowers.enabled) sites = sitesFromGeometry(geometry, env, Math.max(.25, spec.fronds.width))
  }

  // Optional outer-surface flower decoration following the host foliage sites & scale
  if (spec.flowers.enabled && sites.length > 0) {
    const flowerTex = spec.flowers.style === 'wildrose'
      ? (textures.wildrose ?? textures.blossom ?? textures.flower)
      : textures.flower
    if (flowerTex) {
      const fl = buildFlowers(sites, env, spec.flowers, opt, spec.seed)
      if (fl.flowers > 0) {
        const facing = spec.flowers.cardType === 'cross' ? 0 : spec.flowers.cameraFacing
        const material = makeLeafMaterial(flowerTex, spec.flowers.alphaCutoff, .75, facing, leafStyle(spec.flowers.tintInner))
        material.name = 'FlowerCards'
        const mesh = new Mesh(fl.geometry, material)
        mesh.name = 'Flower cards'
        mesh.userData.role = 'foliage'
        meshes.push(mesh)
        disposables.push(fl.geometry, material)
        stats.flowers = fl.flowers
        stats.triangles += fl.geometry.index!.count / 3
      } else {
        fl.geometry.dispose()
      }
    }
  }
  // Optional drifting ambient petals / leaves around the outer crown silhouette
  if (sh.petals > 0) {
    const cIn = spec.kind === 'broadleaf' ? spec.leaves.tintInner : spec.kind === 'flowerbed' ? spec.flowerbed.tintInner : spec.flowers.tintInner
    const cOut = spec.kind === 'broadleaf' ? spec.leaves.tintOuter : spec.kind === 'flowerbed' ? spec.flowerbed.tintOuter : spec.flowers.tintOuter
    const pt = buildAmbientPetals(env, sh.petals, cIn, cOut, spec.seed)
    const pMat = makePetalMaterial()
    const pMesh = new Mesh(pt.geometry, pMat)
    pMesh.name = 'Ambient petals'
    pMesh.userData.role = 'foliage'
    meshes.push(pMesh)
    disposables.push(pt.geometry, pMat)
    stats.triangles += pt.geometry.index!.count / 3
  }
  // Optional stylized ancient wishing-tree decorative accents (mossy boulders, flat-folded silk ribbons, wooden plaques, golden sparkles)
  let accentGroup: Group | undefined
  if (sh.accent === 'wishing' && !ground && !flowerbed) {
    const acc = buildWishingAccents(skeleton, spec.seed, spec.accents)
    accentGroup = acc.group
    group.add(accentGroup)
    disposables.push(...acc.disposables)
    stats.triangles += acc.triangles
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
  return {
    group, stats, skeleton,
    display(view: View) {
      for (const mesh of meshes) mesh.visible = mesh.userData.role === 'wood' ? view !== 'crown' : view !== 'skeleton'
      if (accentGroup) accentGroup.visible = view === 'final'
    },
    /** Fast-path incremental rebuild for wood-only parameters (trunk sculpt, flare, bark ridges,
     *  bark color, surface roots, woodDetail): rebuilds ONLY wood geometry & bark material while
     *  preserving the cached skeleton, leaf cards, fronds, flowers, twigs, petals, and accents! */
    rebuildWoodOnly(nextSpec: TreeSpec, nextTextures: TreeTextures): boolean {
      if (!wood || (nextSpec.kind !== 'broadleaf' && nextSpec.kind !== 'conifer')) return false
      if (nextSpec.kind !== currentSpec.kind || nextSpec.seed !== currentSpec.seed) return false
      const t0 = performance.now()
      const nextOpt = nextSpec.optimize
      const nextSculpt = nextSpec.trunk.sculpt
      const nextSculptLod = woodSculptLodParams(nextOpt.woodDetail, nextSculpt)
      const nextHeightField = nextSculpt && nextSculpt.heightDisplace > 0.001
        ? getBarkHeightField(nextTextures.bark)
        : undefined
      const nextWoodGeometry = buildWood(skeleton.branches, nextSpec.trunk, nextSpec.seed, {
        detail: nextOpt.woodDetail,
        skip: makeSkipWood(nextSpec),
        heightField: nextHeightField,
      })
      const nextIsFlow = Boolean(nextSculptLod.active && nextSculpt?.uvMode === 'flow')
      const needsNewBark = nextTextures.bark !== currentBarkTex || nextIsFlow !== currentBarkIsFlow
      if (needsNewBark) {
        const nextBark = buildBarkFor(nextSpec, nextTextures)
        wood.material = nextBark
        if (twigsMesh) twigsMesh.material = nextBark
        currentBark.dispose()
        currentBark = nextBark
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
      currentWoodGeometry?.dispose()
      currentBark.dispose()
      for (const d of disposables) d.dispose()
    },
  }
}
export type TreeAsset = ReturnType<typeof buildTree>

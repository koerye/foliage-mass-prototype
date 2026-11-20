import { Color, Group, Mesh, MeshStandardMaterial, type Texture } from 'three'
import { exportGlb, type ExportGlbOptions } from '../export-glb'
import { Batch } from '../mesh'
import { makeLeafMaterial } from '../broadleaf/leaf-material'
import { generateLeafCards, type Twig } from '../broadleaf/leaves'
import { makeBarkMaterial, makePetalMaterial, makeStemMaterial } from './bark-material'
import { buildFlowerBed } from './flowerbed'
import { buildAmbientPetals, buildFlowers, sitesFromGeometry, sitesFromLeafCards, type FoliageSite } from './flowers'
import { buildFronds } from './fronds'
import { buildGround } from './ground'
import { buildPalmFronds, buildPalmWood } from './palm'
import { buildSkeleton } from './skeleton'
import type { TreeSpec } from './spec'
import { buildWood } from './wood'

export const views = ['final', 'skeleton', 'crown'] as const
export type View = typeof views[number]

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
  sakura?: Texture
  cloud?: Texture
  maple?: Texture
  willow?: Texture
  bush?: Texture
  wildrose?: Texture
}

export function buildTree(spec: TreeSpec, textures: TreeTextures) {
  const started = performance.now()
  const skeleton = buildSkeleton(spec)
  const env = skeleton.envelope
  const group = new Group()
  group.name = 'Vegetation Studio / ' + spec.name + ' / ' + spec.seed
  group.userData.spec = spec
  const opt = spec.optimize
  const ground = spec.kind === 'grass' || spec.kind === 'fern'
  const flowerbed = spec.kind === 'flowerbed'
  const palm = spec.kind === 'palm'
  const skipWood = opt.cullHiddenWood
    ? (b: typeof skeleton.branches[number]) => {
      if (b.role === 'trunk' || b.role === 'dead') return false
      if (env.bare(b.curve.getPoint(.6)) >= .25) return false
      if (spec.kind === 'conifer' && spec.fronds.mode === 'leaf' && b.role === 'limb') return true
      if (spec.kind === 'broadleaf' && opt.woodDetail < .45 && b.role === 'child') return true
      return false
    }
    : undefined
  const bark = makeBarkMaterial(textures.bark, {
    scale: spec.trunk.barkScale,
    detail: spec.trunk.barkDetail,
    tint: spec.trunk.barkTint,
    shadowShift: spec.shading.shadowShift,
  })
  const woodGeometry = (ground || flowerbed) ? undefined
    : palm ? buildPalmWood(skeleton.trunk, spec)
      : buildWood(skeleton.branches, spec.trunk, spec.seed, { detail: opt.woodDetail, skip: skipWood })
  const wood = woodGeometry ? new Mesh(woodGeometry, bark) : undefined
  if (wood) {
    wood.name = 'Trunk and branches'
    wood.userData.role = 'wood'
  }
  const meshes: Mesh[] = wood ? [wood] : []
  const disposables: { dispose(): void }[] = woodGeometry ? [woodGeometry, bark] : [bark]
  const stats = { branches: skeleton.branches.length - 1, twigs: 0, leaves: 0, flowers: 0, triangles: woodGeometry ? woodGeometry.index!.count / 3 : 0, ms: 0 }
  let sites: FoliageSite[] = []

  const sh = spec.shading
  const leafStyle = (shadowFrom: string) => ({
    translucency: sh.translucency,
    rimLight: sh.rimLight,
    shadowShift: sh.shadowShift,
    topWarmth: sh.topWarmth,
    shadowFrom,
  })

  if (spec.kind === 'broadleaf') {
    const carriers = skeleton.branches.filter(b => b.role !== 'dead' && !b.bare)
    const hasBranchGeomEdit = Boolean(spec.branchEdits?.some(e =>
      (e.lengthScale !== undefined && Math.abs(e.lengthScale - 1) > 1e-4) ||
      (e.pitchDelta !== undefined && Math.abs(e.pitchDelta) > 1e-4) ||
      (e.yawDelta !== undefined && Math.abs(e.yawDelta) > 1e-4) ||
      (e.gravityDelta !== undefined && Math.abs(e.gravityDelta) > 1e-4) ||
      Boolean(e.spineOffsets?.length)))
    const lift = Math.max(0, Math.min(.75, spec.crown.canopyLift ?? 0))
    const info = generateLeafCards({ limbs: carriers, clusters: skeleton.clusters, config: { seed: spec.seed } }, spec.leaves, {
      radius: hasBranchGeomEdit ? p => Math.min(env.rho(p), 1.02) : p => env.rho(p),
      keep: (p, r) => {
        if (lift > 0) {
          const u = (p.y - env.y0) / Math.max(.2, env.height)
          if (u < lift * .82 && env.rho(p) < .84 - u * .25) return false
        }
        return env.bare(p) < .3 + r * .45
      },
      flat: opt.flatCards,
      reduce: opt.cardReduction,
    })
    const styleMap = (() => {
      switch (sh.leafStyle) {
        case 'sakura': return textures.sakura ?? textures.flower ?? textures.leaf
        case 'cloud': return textures.cloud ?? textures.leaf
        case 'maple': return textures.maple ?? textures.leaf
        case 'willow': return textures.willow ?? textures.leaf
        case 'bush': return textures.bush ?? textures.leaf
        case 'flower': return textures.flower ?? textures.leaf
        default: return textures.leaf
      }
    })()
    const noFacing = spec.leaves.cardType === 'cross' || spec.leaves.cardType === 'tri' || spec.leaves.cardType === 'drape'
    const material = makeLeafMaterial(styleMap, spec.leaves.alphaCutoff, spec.leaves.normalSpherize,
      noFacing ? 0 : spec.leaves.cameraFacing, leafStyle(spec.leaves.tintInner))
    const leaves = new Mesh(info.geometry, material)
    leaves.name = 'Leaf cards'
    leaves.userData.role = 'foliage'
    if (!opt.cullHiddenWood) {
      const twigGeometry = buildTwigs(info.twigs, spec.trunk.barkColor)
      const twigs = new Mesh(twigGeometry, bark)
      twigs.name = 'Twigs'
      twigs.userData.role = 'wood'
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
      stems.name = 'Flower stems and leaves'
      stems.userData.role = 'wood'
      meshes.push(stems)
      disposables.push(fb.stemsGeometry, stemMat)
      stats.branches = fb.stems
      stats.triangles += fb.stemsGeometry.index!.count / 3
    } else {
      stats.branches = 0
    }
    const map = textures.blossom ?? textures.flower ?? textures.leaf
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
  return {
    group, stats, skeleton,
    display(view: View) {
      for (const mesh of meshes) mesh.visible = mesh.userData.role === 'wood' ? view !== 'crown' : view !== 'skeleton'
    },
    /** Fast-path hot update for pure material/shader parameters (0 ms geometry rebuild).
     *  Returns true if handled in-place, false if a geometry rebuild is required. */
    applyLiveParam(path: string, nextSpec: TreeSpec): boolean {
      const foliageMeshes = meshes.filter(m => m.userData.role === 'foliage')
      const primary = foliageMeshes.find(m => m.name !== 'Flower cards' && m.name !== 'Ambient petals')
      const flowerMesh = foliageMeshes.find(m => m.name === 'Flower cards')
      const uniformOf = (m: Mesh) => (m.material as MeshStandardMaterial).userData?.leafUniforms as Record<string, { value: number }> | undefined
      const barkUniforms = (bark.userData?.barkUniforms as Record<string, { value: number }> | undefined)
      let handled = false
      switch (path) {
        case 'trunk.barkScale':
          if (barkUniforms) barkUniforms.uBarkScale.value = nextSpec.trunk.barkScale ?? 1
          handled = true; break
        case 'trunk.barkDetail':
          if (barkUniforms) barkUniforms.uBarkDetail.value = nextSpec.trunk.barkDetail ?? .72
          handled = true; break
        case 'trunk.barkTint':
          if (barkUniforms) barkUniforms.uBarkTint.value = nextSpec.trunk.barkTint ?? .45
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
          if (nextSpec.kind === 'flowerbed' && primary) { setAlphaTest(primary, nextSpec.flowerbed.alphaCutoff); handled = true }
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
      if (handled) group.userData.spec = nextSpec
      return handled
    },
    exportGlb: (options?: ExportGlbOptions) => exportGlb(group, options),
    dispose() { for (const d of disposables) d.dispose() },
  }
}
export type TreeAsset = ReturnType<typeof buildTree>

// Unified Three.js instance builder for Scene Assembly Studio items (trees, rocks, AI scenes).
// Delegates ALL tree generation through the single unified 6-stage `buildTree()` pipeline in `src/tree/assemble.ts`
// (zero external foliage/bark post-mutations!), keeping Tree Studio <-> Scene Studio 100% identical and fully parametric.
import {
  Box3, CanvasTexture, DataTexture, Group, LinearMipmapLinearFilter, LOD, MathUtils, Mesh,
  MeshStandardMaterial, NoColorSpace, RGBAFormat, SRGBColorSpace, Vector2, type Object3D, type Texture,
} from 'three'
import { buildAiScene, type AiSceneSpec, type LeafTextureSource } from '../ai/scene'
import { loadDefaultPhotoCraftPbrLayers, type ExternalPbrLayers } from '../rock-v2/photocraft-pbr'
import { buildRouteCRock } from '../rock-v2/poly-csg'
import { bakePolyCsgPbr, unwrapPolyCsgUvCharts } from '../rock-v2/poly-pbr'
import { buildRockGroup } from '../rock/geometry'
import { makeRockMaterial } from '../rock/material'
import type { RockSpec } from '../rock/spec'
import { decodeSavedTextureMap } from '../studio/texture-serialize'
import type { EditableTextureSlot, TextureRegistry } from '../studio/texture-slots'
import { buildTree, type TreeAsset, type TreeTextures } from '../tree/assemble'
import { optimizeAt } from '../tree/optimize'
import type { BarkStyle, TreeForm, TreeSpec } from '../tree/spec'
import { parsePolyCRockSpec, type AssemblyBarkStyle, type AssemblyCategory, type AssemblyItem, type PolyCRockSpec } from './spec'

export interface BuiltAssemblyInstance {
  id: string
  wrapper: Group
  content: Object3D
  /** Full-precision LOD0 root (always used for GLB export & grounding measurements). */
  lod0Group: Group
  /** Present on `kind === 'tree'` instances built with `distantLod: true`. */
  lod?: LOD
  /** Per-level triangle counts `[LOD0, LOD1, LOD2]` when `lod` is active. */
  lodTriangles?: readonly number[]
  /** Returns triangle count of the currently active LOD level (or full LOD0 triangles when LOD is off). */
  activeTriangles(): number
  localMinY: number
  triangles: number
  dispose(): void
}

export interface BuildAssemblyItemOptions {
  /** Mounts 3-level shared-material `THREE.LOD` (0m / 18m / 36m) on `kind === 'tree'` items. */
  distantLod?: boolean
}

function countTriangles(root: Object3D): number {
  let tris = 0
  root.traverse(o => {
    if (!(o instanceof Mesh)) return
    const pos = o.geometry.getAttribute('position')
    if (!pos) return
    tris += o.geometry.index ? Math.round(o.geometry.index.count / 3) : Math.round(pos.count / 3)
  })
  return tris
}

function measureLocalMinY(root: Object3D): number {
  root.updateMatrixWorld(true)
  const box = new Box3().setFromObject(root)
  return box.isEmpty() || !Number.isFinite(box.min.y) ? 0 : box.min.y
}

export interface AssemblySharedTextures {
  registry: TextureRegistry
  barkTemplates: Partial<Record<AssemblyBarkStyle, Texture>>
}

function buildTreeTextureView(
  base: TreeTextures,
  leafSource: LeafTextureSource | undefined,
  customMap?: Partial<Record<EditableTextureSlot, Texture>>,
): TreeTextures {
  const leafResolved = customMap?.leaf ?? (
    leafSource && leafSource !== 'auto'
      ? (base[leafSource as keyof TreeTextures] ?? base.leaf)
      : undefined
  )
  return {
    get leaf() { return leafResolved ?? base.leaf },
    get needle() { return customMap?.needle ?? base.needle },
    get drape() { return customMap?.drape ?? base.drape },
    get palm() { return customMap?.palm ?? base.palm },
    get bamboo() { return customMap?.bamboo ?? base.bamboo },
    get lotusLeaf() { return customMap?.lotusLeaf ?? base.lotusLeaf },
    get lotusPetal() { return customMap?.lotusPetal ?? base.lotusPetal },
    get grass() { return customMap?.grass ?? base.grass },
    get grassTint() { return base.grassTint },
    get fern() { return customMap?.fern ?? base.fern },
    get flower() { return customMap?.flower ?? base.flower },
    get blossom() { return customMap?.blossom ?? base.blossom },
    get stemLeaf() { return customMap?.stemLeaf ?? base.stemLeaf },
    get painted() { return base.painted },
    get feathery() { return base.feathery },
    get sakura() { return base.sakura },
    get cloud() { return base.cloud },
    get oak() { return base.oak },
    get oakAtlas() { return base.oakAtlas },
    get maple() { return base.maple },
    get willow() { return base.willow },
    get bush() { return base.bush },
    get wildrose() { return base.wildrose },
    get bark() { return customMap?.bark ?? base.bark },
  }
}

export function applyItemTransform(wrapper: Group, item: AssemblyItem) {
  wrapper.position.set(item.position[0], item.position[1], item.position[2])
  wrapper.rotation.set(
    MathUtils.degToRad(item.rotation[0]),
    MathUtils.degToRad(item.rotation[1]),
    MathUtils.degToRad(item.rotation[2]),
  )
  wrapper.scale.set(item.scale[0], item.scale[1], item.scale[2])
  wrapper.visible = item.visible
  wrapper.name = item.name
  wrapper.userData.assemblyItemId = item.id
  wrapper.updateMatrixWorld(true)
}

export interface AssemblyTreeAppearance {
  barkStyle?: AssemblyBarkStyle
  crownStyle?: 'painted'
  treeForm?: 'meadow-birch'
  leafTexture?: LeafTextureSource
  category?: AssemblyCategory
  customMap?: Partial<Record<EditableTextureSlot, Texture>>
  hasCustomLeaf?: boolean
  hasCustomBark?: boolean
}

/** Normalizes legacy AssemblyItem sidecar fields (`barkStyle`, `treeForm`) directly onto
 *  `TreeSpec` so `TreeSpec` is ALWAYS the Single Source of Truth across all studios and JSON exports!
 *  Note: ALL broadleaf trees & shrubs use pure Alpha-tested Leaf Cards (zero 3D-modeled blades). */
export function resolveAssemblyTreeSpec(
  treeSpec: TreeSpec,
  appearance: AssemblyTreeAppearance,
): TreeSpec {
  const resolvedBarkStyle: BarkStyle | undefined =
    treeSpec.trunk.barkStyle ?? (appearance.barkStyle && appearance.barkStyle !== 'default' ? appearance.barkStyle : undefined)
  const resolvedTreeForm: TreeForm | undefined =
    treeSpec.trunk.treeForm ?? (appearance.treeForm === 'meadow-birch' ? 'meadow-birch' : undefined)

  if (
    resolvedBarkStyle === treeSpec.trunk.barkStyle
    && resolvedTreeForm === treeSpec.trunk.treeForm
  ) {
    return treeSpec
  }
  return {
    ...treeSpec,
    trunk: {
      ...treeSpec.trunk,
      ...(resolvedBarkStyle ? { barkStyle: resolvedBarkStyle } : {}),
      ...(resolvedTreeForm ? { treeForm: resolvedTreeForm } : {}),
    },
  }
}

/** Shared 1:1 TreeAsset builder delegating cleanly to the unified pure leaf-card `buildTree()` pipeline. */
export function buildAssemblyTreeAsset(
  treeSpec: TreeSpec,
  appearance: AssemblyTreeAppearance,
  baseTextures: TreeTextures,
  _barkTemplates?: Partial<Record<AssemblyBarkStyle, Texture>>,
): TreeAsset {
  const resolvedSpec = resolveAssemblyTreeSpec(treeSpec, appearance)
  const texView = buildTreeTextureView(baseTextures, appearance.leafTexture, appearance.customMap)
  return buildTree(resolvedSpec, texView, {
    leafTextureOverride: Boolean((appearance.leafTexture && appearance.leafTexture !== 'auto') || appearance.customMap?.leaf),
  })
}

function makePolyCPbrTexture(rgba: Uint8ClampedArray, size: number, srgb: boolean, name: string): Texture {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const img = ctx.createImageData(size, size)
      img.data.set(rgba)
      ctx.putImageData(img, 0, 0)
      const tex = new CanvasTexture(canvas)
      tex.name = name
      tex.flipY = false
      tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
      tex.generateMipmaps = true
      tex.minFilter = LinearMipmapLinearFilter
      tex.anisotropy = 4
      tex.needsUpdate = true
      return tex
    }
  }
  const bytes = new Uint8Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength))
  const tex = new DataTexture(bytes, size, size, RGBAFormat)
  tex.name = name
  tex.flipY = false
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** Builds a single AssemblyItem into an isolated Three.js wrapper Group ready to mount in the scene. */
export async function buildAssemblyItem(
  item: AssemblyItem,
  shared: AssemblySharedTextures,
  options?: BuildAssemblyItemOptions,
): Promise<BuiltAssemblyInstance> {
  const wrapper = new Group()
  wrapper.name = item.name
  wrapper.userData.assemblyItemId = item.id

  const extraDisposables: { dispose(): void }[] = []
  let content: Object3D
  let lod0Group: Group
  let lod: LOD | undefined
  let lodTriangles: number[] | undefined
  let disposeInner: () => void

  if (item.kind === 'rock') {
    const rockSpec = item.payload as RockSpec
    const mat = makeRockMaterial(rockSpec, 'final')
    const built = buildRockGroup(rockSpec, mat)
    content = built.group
    lod0Group = built.group
    extraDisposables.push(mat)
    disposeInner = () => {
      built.dispose()
      mat.dispose()
    }
  } else if (item.kind === 'rock-c2') {
    const c2Spec = parsePolyCRockSpec(item.payload as PolyCRockSpec)
    const c2 = await buildRouteCRock(c2Spec.preset, {
      seed: c2Spec.seed,
      shoulderDepth: c2Spec.shoulderDepth,
      bevelScale: c2Spec.bevelScale,
      notchDepth: c2Spec.notchDepth,
    })
    const isMossyTerrace = c2Spec.preset === 'terraced-moss-bluff-c2'
    let externalPbr: ExternalPbrLayers | undefined
    if (c2Spec.mode === 'photocraft-pbr') {
      try {
        externalPbr = await loadDefaultPhotoCraftPbrLayers()
      } catch {
        // Headless Node test environment without image decoder falls back cleanly
      }
    }
    const uv = unwrapPolyCsgUvCharts(c2, { atlasSize: 512, gutterPx: isMossyTerrace ? 6 : 10 })
    const baked = bakePolyCsgPbr(c2, uv, {
      size: 512,
      mode: externalPbr ? c2Spec.mode : (c2Spec.mode === 'photocraft-pbr' ? 'shallow-detail' : c2Spec.mode),
      baseColorHex: c2Spec.baseColor,
      dilationPasses: isMossyTerrace ? 8 : 14,
      aoRays: isMossyTerrace ? 10 : 16,
      seed: c2Spec.seed,
      strataStrength: c2Spec.strataStrength,
      ...(isMossyTerrace ? { mossTop: true, mossColorHex: '#68a624' } : {}),
      ...(externalPbr ? { externalPbr } : {}),
    })
    const geo = uv.toBufferGeometry()
    const tag = c2Spec.preset === 'terraced-moss-bluff-c2'
      ? 'TerracedMossBluff'
      : c2Spec.preset === 'block-bluff-c2'
        ? 'BlockBluff'
        : 'SandstoneLedge'
    const mapTex = makePolyCPbrTexture(baked.albedo, baked.size, true, `RockC2_${tag}_BaseColor`)
    const normTex = makePolyCPbrTexture(baked.normal, baked.size, false, `RockC2_${tag}_Normal`)
    const aoTex = makePolyCPbrTexture(baked.ao, baked.size, false, `RockC2_${tag}_AO`)
    const roughTex = makePolyCPbrTexture(baked.roughness, baked.size, false, `RockC2_${tag}_Roughness`)
    aoTex.channel = 0
    const useRoughMap = Boolean(externalPbr && c2Spec.mode === 'photocraft-pbr')
    const mat = new MeshStandardMaterial({
      name: `Mat_RockC2_${tag}_${c2Spec.mode === 'baseline' ? 'Baseline' : useRoughMap ? 'PhotoCraftPBR' : 'PBR'}`,
      color: 0xffffff,
      map: mapTex,
      normalMap: normTex,
      normalScale: new Vector2(1, 1),
      aoMap: aoTex,
      aoMapIntensity: useRoughMap ? 0.92 : 0.85,
      roughnessMap: useRoughMap ? roughTex : null,
      roughness: useRoughMap ? 1.0 : 0.90,
      metalness: 0.0,
    })
    const mesh = new Mesh(geo, mat)
    mesh.name = `RockC2_${tag}_LOD0`
    mesh.castShadow = true
    mesh.receiveShadow = true
    const grp = new Group()
    grp.name = `RockC2_${tag}`
    grp.add(mesh)
    content = grp
    lod0Group = grp
    disposeInner = () => {
      geo.dispose()
      mat.dispose()
      mapTex.dispose()
      normTex.dispose()
      aoTex.dispose()
      roughTex.dispose()
    }
  } else if (item.kind === 'ai') {
    const aiSpec = item.payload as AiSceneSpec
    const built = buildAiScene(aiSpec, shared.registry.textures)
    content = built.group
    lod0Group = built.group
    disposeInner = () => built.dispose()
  } else {
    const treeSpec = item.payload as TreeSpec
    const customMap = item.customTextures ? await decodeSavedTextureMap(item.customTextures) : undefined
    if (customMap) {
      for (const tex of Object.values(customMap)) {
        if (tex) extraDisposables.push(tex)
      }
    }
    const appearance: AssemblyTreeAppearance = {
      barkStyle: item.barkStyle,
      crownStyle: item.crownStyle,
      treeForm: item.treeForm,
      leafTexture: item.leafTexture,
      category: item.category,
      customMap,
    }
    const resolvedSpec = resolveAssemblyTreeSpec(treeSpec, appearance)
    const built = buildAssemblyTreeAsset(
      resolvedSpec,
      appearance,
      shared.registry.textures,
      shared.barkTemplates,
    )
    lod0Group = built.group
    lod0Group.userData.lodLevel = 0

    if (options?.distantLod) {
      const baseLevel = resolvedSpec.optimize?.level ?? 0
      const targetTris = resolvedSpec.optimize?.targetTriangles
      const lod1Spec: TreeSpec = { ...resolvedSpec, optimize: optimizeAt(Math.max(baseLevel, 0.42), targetTris) }
      const lod2Spec: TreeSpec = { ...resolvedSpec, optimize: optimizeAt(Math.max(baseLevel, 0.72), targetTris) }
      const lod1 = built.buildLodClone(lod1Spec, { shareMaterials: true })
      const lod2 = built.buildLodClone(lod2Spec, { shareMaterials: true })

      const tagDistantLevel = (grp: Group, levelIdx: number) => {
        grp.userData.lodLevel = levelIdx
        grp.userData.isDistantLod = true
        grp.userData.exportIgnore = true
        grp.traverse(o => {
          o.userData.lodLevel = levelIdx
          o.userData.isDistantLod = true
          o.userData.exportIgnore = true
        })
      }
      tagDistantLevel(lod1.group, 1)
      tagDistantLevel(lod2.group, 2)

      const lodObj = new LOD()
      lodObj.name = `${item.name || 'Tree'}_LOD`
      lodObj.userData.isAssemblyLod = true
      lodObj.addLevel(lod0Group, 0)
      lodObj.addLevel(lod1.group, 18)
      lodObj.addLevel(lod2.group, 36)
      lod0Group.visible = true
      lod1.group.visible = false
      lod2.group.visible = false

      lod = lodObj
      content = lodObj
      lodTriangles = [countTriangles(lod0Group), countTriangles(lod1.group), countTriangles(lod2.group)]
      disposeInner = () => {
        // Dispose cloned LOD1/LOD2 geometries first (shared materials stay intact until built.dispose()).
        lod1.dispose()
        lod2.dispose()
        built.dispose()
        for (const d of extraDisposables) d.dispose()
      }
    } else {
      content = lod0Group
      disposeInner = () => {
        built.dispose()
        for (const d of extraDisposables) d.dispose()
      }
    }
  }

  // Tag every descendant mesh across all LOD levels with assemblyItemId & category for raycasting and GLB export protection
  wrapper.userData.assemblyItemId = item.id
  wrapper.userData.assemblyCategory = item.category
  content.traverse(o => {
    o.userData.assemblyItemId = item.id
    o.userData.assemblyCategory = item.category
  })
  wrapper.add(content)

  // Measure un-transformed local min.y and full triangle count strictly on LOD0
  const localMinY = measureLocalMinY(lod0Group)
  const triangles = lodTriangles ? lodTriangles[0] : countTriangles(lod0Group)
  applyItemTransform(wrapper, item)

  return {
    id: item.id,
    wrapper,
    content,
    lod0Group,
    lod,
    lodTriangles,
    activeTriangles() {
      if (!lod || !lodTriangles) return triangles
      const lvl = lod.getCurrentLevel()
      return lodTriangles[lvl] ?? triangles
    },
    localMinY,
    triangles,
    dispose: disposeInner,
  }
}

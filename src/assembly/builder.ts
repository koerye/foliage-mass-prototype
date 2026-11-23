// Unified Three.js instance builder for Scene Assembly Studio items (trees, rocks, AI scenes).
// Supports birch white-base painted bark, procedural bark styles, leaf texture overrides,
// custom saved textures, and exact bounding-box computation for 1-click grounding.
import {
  Box3, BufferAttribute, Color, Group, MathUtils, Mesh, Vector3, type Object3D, type Texture,
} from 'three'
import { buildAiScene, type AiSceneSpec, type LeafTextureSource } from '../ai/scene'
import { buildRockGroup } from '../rock/geometry'
import { makeRockMaterial } from '../rock/material'
import type { RockSpec } from '../rock/spec'
import { decodeSavedTextureMap } from '../studio/texture-serialize'
import type { EditableTextureSlot, TextureRegistry } from '../studio/texture-slots'
import { makePainterlyDriftwoodBarkTexture, makePainterlyMossBarkTexture } from '../texgraph/templates'
import { buildTree, type TreeTextures } from '../tree/assemble'
import { buildSkeleton } from '../tree/skeleton'
import type { TreeSpec } from '../tree/spec'
import { buildBirchFoliage } from './birch-foliage'
import { applyPaintedBirchBark } from './birch-bark'
import { buildMeadowBirchStructure } from './birch-structure'
import type { AssemblyBarkStyle, AssemblyItem } from './spec'

export interface BuiltAssemblyInstance {
  id: string
  wrapper: Group
  content: Group
  localMinY: number
  triangles: number
  dispose(): void
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

/** Smoothly paints a painterly white/ivory lower-trunk birch gradient directly into the wood
 *  geometry's linear vertex colors (matches Ref 1's iconic pale lower trunk & dark mossy fork,
 *  and exports 100% natively into GLB without extra custom shaders!). */
function applyBirchLowerTrunkTint(root: Object3D, trunkHeight: number) {
  const barkFlecksCol = new Color('#3c413a')
  const mossSpotCol = new Color('#4f843c')
  const whiteTop = Math.max(1.45, trunkHeight * .36)
  const fadeSpan = Math.max(0.42, trunkHeight * 0.12)

  root.traverse(o => {
    if (!(o instanceof Mesh) || o.userData?.role !== 'wood') return
    const pos = o.geometry.getAttribute('position') as BufferAttribute | undefined
    const col = o.geometry.getAttribute('color') as BufferAttribute | undefined
    if (!pos || !col) return
    const n = pos.count
    const out = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i)
      let r = col.getX(i), g = col.getY(i), b = col.getZ(i)
      const angle = Math.atan2(pz, px)
      // Organic jagged brushstroke boundary around the upper edge of the white lower trunk
      const jagged = Math.sin(angle * 3.0 + 0.7) * 0.24 + Math.cos(angle * 7.0 - py * 2.4) * 0.11
      const h = py + jagged
      const t = 1 - Math.max(0, Math.min(1, (h - (whiteTop - fadeSpan * 0.3)) / fadeSpan))
      const mask = t * t * (3 - 2 * t)
      if (mask > 0.001) {
        // High-luminance chalky birch white with subtle vertical bark fissures & dark lenticels
        const streak = 0.5 + 0.5 * Math.sin(angle * 11.0 + Math.sin(py * 4.5) * 1.4)
        const lenticel = Math.sin(py * 22.0 + Math.cos(angle * 5.0) * 1.8) > 0.88 ? 0.34 : 0
        const rootMoss = py < 0.32 ? (1 - py / 0.32) * (0.20 + 0.22 * Math.max(0, Math.sin(angle * 4.0 + 1.1))) : 0
        let wr = 0.94 + 0.06 * streak
        let wg = 0.95 + 0.05 * streak
        let wb = 0.94 + 0.06 * streak
        if (lenticel > 0) {
          wr = wr + (barkFlecksCol.r - wr) * lenticel
          wg = wg + (barkFlecksCol.g - wg) * lenticel
          wb = wb + (barkFlecksCol.b - wb) * lenticel
        }
        if (rootMoss > 0) {
          wr = wr + (mossSpotCol.r - wr) * rootMoss
          wg = wg + (mossSpotCol.g - wg) * rootMoss
          wb = wb + (mossSpotCol.b - wb) * rootMoss
        }
        const blend = mask * .96
        r = r + (wr - r) * blend
        g = g + (wg - g) * blend
        b = b + (wb - b) * blend
      }
      out[i * 3] = Math.min(1, r)
      out[i * 3 + 1] = Math.min(1, g)
      out[i * 3 + 2] = Math.min(1, b)
    }
    o.geometry.setAttribute('color', new BufferAttribute(out, 3))
  })
}

export interface AssemblySharedTextures {
  registry: TextureRegistry
  barkTemplates: Partial<Record<AssemblyBarkStyle, Texture>>
}

function resolveBarkTemplate(shared: AssemblySharedTextures, style: AssemblyBarkStyle | undefined): Texture | undefined {
  if (!style || style === 'default' || style === 'birch') return undefined
  let tex = shared.barkTemplates[style]
  if (!tex) {
    tex = style === 'driftwood'
      ? makePainterlyDriftwoodBarkTexture(512)
      : makePainterlyMossBarkTexture(512)
    shared.barkTemplates[style] = tex
  }
  return tex
}

function buildTreeTextureView(
  base: TreeTextures,
  leafSource: LeafTextureSource | undefined,
  barkOverride: Texture | undefined,
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
    get grass() { return customMap?.grass ?? base.grass },
    get grassTint() { return base.grassTint },
    get fern() { return customMap?.fern ?? base.fern },
    get flower() { return customMap?.flower ?? base.flower },
    get blossom() { return customMap?.blossom ?? base.blossom },
    get stemLeaf() { return customMap?.stemLeaf ?? base.stemLeaf },
    get sakura() { return base.sakura },
    get cloud() { return base.cloud },
    get oak() { return base.oak },
    get oakAtlas() { return base.oakAtlas },
    get maple() { return base.maple },
    get willow() { return base.willow },
    get bush() { return base.bush },
    get wildrose() { return base.wildrose },
    get bark() { return customMap?.bark ?? barkOverride ?? base.bark },
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

/** Builds a single AssemblyItem into an isolated Three.js wrapper Group ready to mount in the scene. */
export async function buildAssemblyItem(
  item: AssemblyItem,
  shared: AssemblySharedTextures,
): Promise<BuiltAssemblyInstance> {
  const wrapper = new Group()
  wrapper.name = item.name
  wrapper.userData.assemblyItemId = item.id

  const extraDisposables: { dispose(): void }[] = []
  let content: Group
  let disposeInner: () => void

  if (item.kind === 'rock') {
    const rockSpec = item.payload as RockSpec
    const mat = makeRockMaterial(rockSpec, 'final')
    const built = buildRockGroup(rockSpec, mat)
    content = built.group
    extraDisposables.push(mat)
    disposeInner = () => {
      built.dispose()
      mat.dispose()
    }
  } else if (item.kind === 'ai') {
    const aiSpec = item.payload as AiSceneSpec
    const built = buildAiScene(aiSpec, shared.registry.textures)
    content = built.group
    disposeInner = () => built.dispose()
  } else {
    const treeSpec = item.payload as TreeSpec
    const customMap = item.customTextures ? await decodeSavedTextureMap(item.customTextures) : undefined
    if (customMap) {
      for (const tex of Object.values(customMap)) {
        if (tex) extraDisposables.push(tex)
      }
    }
    const barkOverride = resolveBarkTemplate(shared, item.barkStyle)
    const broadleaf = treeSpec.kind === 'broadleaf'
    const form = broadleaf && item.treeForm === 'meadow-birch' ? buildMeadowBirchStructure(treeSpec) : undefined
    const modeled = broadleaf && item.crownStyle === 'painted' && !customMap?.leaf
    const skeleton = form?.skeleton ?? (modeled ? buildSkeleton(treeSpec) : undefined)
    const foliage = modeled && skeleton ? buildBirchFoliage(treeSpec, form?.clumps ?? skeleton.clusters.map(cluster => ({
      center: cluster.center,
      radii: new Vector3(cluster.width * .54, cluster.height * .54, cluster.depth * .54),
      direction: cluster.direction,
      density: item.category === 'shrub' ? Math.min(.48, 7 / skeleton.clusters.length) : .7,
    }))) : undefined
    if (foliage) {
      extraDisposables.push(foliage.geometry, ...(Array.isArray(foliage.material) ? foliage.material : [foliage.material]))
    }
    const texView = buildTreeTextureView(shared.registry.textures, item.leafTexture, barkOverride, customMap)
    const built = buildTree(treeSpec, texView, { skeleton, foliage })
    content = built.group
    if (item.barkStyle === 'birch') {
      if (form && !customMap?.bark) {
        const bark = applyPaintedBirchBark(content, built.skeleton.trunk, treeSpec.trunk.height, treeSpec.seed)
        if (bark) extraDisposables.push(bark)
      } else applyBirchLowerTrunkTint(content, treeSpec.trunk.height)
    }
    disposeInner = () => {
      built.dispose()
      for (const d of extraDisposables) d.dispose()
    }
  }

  // Tag every descendant mesh with assemblyItemId so 3D viewport raycasting selects the right item cleanly
  content.traverse(o => {
    o.userData.assemblyItemId = item.id
  })
  wrapper.add(content)

  // Measure un-transformed local min.y for exact 1-click grounding
  const localMinY = measureLocalMinY(content)
  const triangles = countTriangles(content)
  applyItemTransform(wrapper, item)

  return {
    id: item.id,
    wrapper,
    content,
    localMinY,
    triangles,
    dispose: disposeInner,
  }
}

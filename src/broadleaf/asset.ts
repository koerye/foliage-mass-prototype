import { Color, Group, Mesh, MeshStandardMaterial, type Texture } from 'three'
import { exportGlb } from '../export-glb'
import { Batch } from '../mesh'
import type { BroadleafTreeConfig } from './config'
import { makeFoliage } from './foliage'
import { buildGrowth, type Limb } from './growth'
import { makeLeafMaterial } from './leaf-material'
import { defaultLeafParams, generateLeafCards, type LeafParams, type Twig } from './leaves'

export const views = ['final', 'skeleton', 'crown'] as const
export type View = typeof views[number]
export const leafModes = ['cards', 'sheets'] as const
export type LeafMode = typeof leafModes[number]

function buildWood(limbs: Limb[]) {
  const batch = new Batch()
  const dark = new Color('#605144'), warm = new Color('#967c5d')
  for (const limb of limbs) {
    const trunk = limb.kind === 'trunk'
    const rings = trunk ? 22 : limb.kind === 'primary' ? 12 : 7
    const segments = trunk ? 14 : limb.kind === 'primary' ? 9 : 6
    const frames = limb.curve.computeFrenetFrames(rings - 1, false)
    const seat = trunk ? undefined : limbs[limb.parentId!].curve.getTangent(limb.socket!)
    const center = (t: number) => {
      const point = limb.curve.getPoint(t)
      // Seat the first ring inside the parent to soften the visible fork collar.
      if (seat) point.addScaledVector(seat, -limb.rootRadius * .9 * (1 - t) ** 7)
      return point
    }
    batch.shell(rings, segments, (t, a) => {
      const index = Math.round(t * (rings - 1))
      const radius = (limb.tipRadius + (limb.rootRadius - limb.tipRadius) * (1 - t) ** 1.25) *
        (1 + Math.exp(-18 * t) * (trunk ? .34 + .19 * Math.cos(a * 5) : -.20) + .046 * Math.cos(a * 3 + t * 2))
      const point = center(t).addScaledVector(frames.normals[index], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[index], Math.sin(a) * radius)
      const color = dark.clone().lerp(warm, .48 + .19 * Math.cos(a + .71) + .12 * Math.cos(a * 4 + t * 3))
      return [point, color, .5]
    }, center)
  }
  const geometry = batch.finish()
  geometry.deleteAttribute('shadeWeight')
  return geometry
}

function buildTwigs(twigs: Twig[]) {
  const batch = new Batch()
  const color = new Color('#6b5842')
  for (const twig of twigs) {
    const frames = twig.curve.computeFrenetFrames(2, false)
    const center = (t: number) => twig.curve.getPoint(t)
    batch.shell(3, 4, (t, a) => {
      const index = Math.round(t * 2)
      const radius = twig.radius * (1 - t * .75)
      const point = center(t).addScaledVector(frames.normals[index], Math.cos(a) * radius)
        .addScaledVector(frames.binormals[index], Math.sin(a) * radius)
      return [point, color, .5]
    }, center)
  }
  const geometry = batch.finish()
  geometry.deleteAttribute('shadeWeight')
  return geometry
}

export interface LeafSetup {
  mode: LeafMode
  params: LeafParams
  texture?: Texture
}

export function assembleBroadleaf(config: BroadleafTreeConfig, setup: LeafSetup = { mode: 'sheets', params: defaultLeafParams }) {
  const growth = buildGrowth(config)
  const woodGeometry = buildWood(growth.limbs)
  const bark = new MeshStandardMaterial({ name: 'Bark', vertexColors: true, roughness: 1 })
  const group = new Group()
  group.name = 'Vegetation Studio / Broadleaf / ' + config.species + ' / ' + config.seed
  group.userData.config = growth.config
  const wood = new Mesh(woodGeometry, bark)
  wood.name = 'Trunk and forked branches'
  wood.castShadow = wood.receiveShadow = true
  group.add(wood)
  let view: View = 'final'
  let foliageMeshes: Mesh[] = []
  let disposeFoliage = () => {}
  const stats = { branches: growth.limbs.length - 1, twigs: 0, leaves: 0, triangles: 0 }
  const woodTriangles = woodGeometry.index!.count / 3
  let cardsInfo: ReturnType<typeof generateLeafCards> | undefined

  const display = (next: View) => {
    view = next
    wood.visible = view !== 'crown'
    for (const mesh of foliageMeshes) {
      const role = mesh.userData.role as 'leaf' | 'twig' | 'detail'
      mesh.visible = role === 'twig' ? view !== 'crown' : role === 'detail' ? view === 'final' : view !== 'skeleton'
    }
  }

  const setLeaves = (next: LeafSetup) => {
    for (const mesh of foliageMeshes) group.remove(mesh)
    disposeFoliage()
    foliageMeshes = []
    cardsInfo = undefined
    if (next.mode === 'sheets') {
      const foliage = makeFoliage(growth)
      const body = new Mesh(foliage.form, foliage.materials)
      const tips = new Mesh(foliage.detail, foliage.materials)
      body.name = 'Crown-form foliage sheets'
      tips.name = 'Directional edge and secondary sprays'
      body.userData.role = 'leaf'
      tips.userData.role = 'detail'
      foliageMeshes = [body, tips]
      disposeFoliage = foliage.dispose
      stats.leaves = growth.clusters.length
      stats.twigs = 0
      stats.triangles = woodTriangles + (foliage.form.index!.count + foliage.detail.index!.count) / 3
    } else {
      if (!next.texture) throw new Error('卡片模式需要叶片贴图')
      const info = generateLeafCards(growth, next.params)
      const twigGeometry = buildTwigs(info.twigs)
      const material = makeLeafMaterial(next.texture, next.params.alphaCutoff, next.params.normalSpherize, next.params.cameraFacing)
      const leaves = new Mesh(info.geometry, material)
      const twigs = new Mesh(twigGeometry, bark)
      leaves.name = 'Leaf cards'
      twigs.name = 'Twigs'
      leaves.userData.role = 'leaf'
      twigs.userData.role = 'twig'
      foliageMeshes = [twigs, leaves]
      disposeFoliage = () => { info.geometry.dispose(); twigGeometry.dispose(); material.dispose() }
      cardsInfo = info
      stats.leaves = info.cards.length
      stats.twigs = info.twigs.length
      stats.triangles = woodTriangles + (info.geometry.index!.count + twigGeometry.index!.count) / 3
    }
    for (const mesh of foliageMeshes) {
      mesh.castShadow = true
      mesh.receiveShadow = mesh.userData.role !== 'detail'
      group.add(mesh)
    }
    display(view)
  }
  setLeaves(setup)

  return {
    group, stats, growth,
    get cards() { return cardsInfo },
    display,
    setLeaves,
    exportGlb: () => exportGlb(group),
    dispose() {
      disposeFoliage()
      woodGeometry.dispose()
      bark.dispose()
    },
  }
}

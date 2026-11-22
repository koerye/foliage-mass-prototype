import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type BufferGeometry, type Material } from 'three'
import type { TreeMassConfig } from './config'
import { bandGeometry, buildMassMeshes, buildTrunk } from './mesh'
import { buildTierLayout, generateFoliageMasses, generateMeso, generateMicro } from './shape'

export const views = ['final', 'silhouette', 'flat', 'wireframe', 'macro'] as const
export type View = typeof views[number]
export const drawCount = (geometry: BufferGeometry) => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3

export function assembleStylizedTree(config: TreeMassConfig) {
  const group = new Group()
  const template = new MeshStandardMaterial({ vertexColors: true, roughness: .94, metalness: 0 })
  const black = new MeshBasicMaterial({ color: '#131916' })
  const flat = new MeshBasicMaterial({ vertexColors: true })
  const wire = new MeshBasicMaterial({ color: '#2d5648', wireframe: true })
  const materials: Record<View, Material> = { final: template, silhouette: black, flat, wireframe: wire, macro: template }
  const tiers = buildTierLayout(config)
  const masses = generateFoliageMasses(tiers, config)
  const meso = generateMeso(masses, config)
  const micro = generateMicro(masses)
  const wood = buildTrunk(config)
  const trunk = new Mesh<BufferGeometry, Material>(wood, template)
  const batches = {
    macro: buildMassMeshes(masses, config), meso: buildMassMeshes(meso, config, 'meso'), micro: buildMassMeshes(micro, config, 'micro'),
  }
  const layers = {
    macro: new Mesh<BufferGeometry, Material>(batches.macro, template),
    meso: new Mesh<BufferGeometry, Material>(batches.meso, template),
    micro: new Mesh<BufferGeometry, Material>(batches.micro, template),
  }
  trunk.name = 'Tapered trunk'
  group.add(trunk)
  trunk.castShadow = trunk.receiveShadow = true
  for (const key of Object.keys(layers) as (keyof typeof layers)[]) {
    const mesh = layers[key]
    mesh.name = key
    mesh.castShadow = key !== 'micro'
    mesh.receiveShadow = true
    group.add(mesh)
  }
  const switchesByLayer = { macro: 'macroEnabled', meso: 'mesoEnabled', micro: 'microEnabled' } as const
  const flatBands = new Map<keyof typeof layers, BufferGeometry>()

  function display(view: View, switches: TreeMassConfig) {
    trunk.material = view === 'flat' ? flat : materials[view]
    for (const key of Object.keys(layers) as (keyof typeof layers)[]) {
      const mesh = layers[key]
      mesh.material = materials[view]
      mesh.visible = switches[switchesByLayer[key]] && (view !== 'macro' || key === 'macro')
      if (view === 'flat' && mesh.visible) {
        if (!flatBands.has(key)) flatBands.set(key, bandGeometry(batches[key], config))
        mesh.geometry = flatBands.get(key)!
      } else mesh.geometry = batches[key]
    }
  }
  display('final', config)

  return { group, tiers, masses, meso, micro, trunk, layers, batches, display,
    stats() {
      const triangles = Object.values(layers).reduce((sum, mesh) => sum + (mesh.visible ? drawCount(mesh.geometry) : 0), drawCount(wood))
      return { tiers: tiers.length, macro: layers.macro.visible ? masses.length : 0, meso: layers.meso.visible ? meso.length : 0,
        micro: layers.micro.visible ? micro.length : 0, triangles }
    },
    dispose() {
      wood.dispose()
      Object.values(batches).forEach(geometry => geometry.dispose())
      flatBands.forEach(geometry => geometry.dispose())
      for (const material of new Set(Object.values(materials))) material.dispose()
    },
  }
}

export type TreeAsset = ReturnType<typeof assembleStylizedTree>


import { Box3, Group, InstancedMesh, Mesh, Vector3, type BufferGeometry } from 'three'
import { assembleBPine, pineProfiles, type PineProfile } from '../experiments/branch-sheets/b-study'
import type { View } from './broadleaf/asset'
import { exportGlb } from './export-glb'

export { pineProfiles, type PineProfile }

export function showPine(profile: PineProfile) {
  const pine = assembleBPine(profile)
  pine.group.name = 'Vegetation Studio / Pine B / ' + profile
  pine.group.userData.config = { schemaVersion: 1, species: 'pine', profile }
  pine.group.updateMatrixWorld(true)

  // Each placement references the same branch template. Instance by source
  // geometry for the live preview while exporting ordinary GLB meshes.
  const batches = new Map<BufferGeometry, Mesh[]>()
  let triangles = 0
  pine.group.traverse(node => {
    if (!(node instanceof Mesh)) return
    const source = batches.get(node.geometry) ?? []
    source.push(node)
    batches.set(node.geometry, source)
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3
  })
  const group = new Group()
  const wood: InstancedMesh[] = []
  const foliage: InstancedMesh[] = []
  for (const [geometry, sources] of batches) {
    const original = sources[0]
    const mesh = new InstancedMesh(geometry, original.material, sources.length)
    sources.forEach((source, index) => mesh.setMatrixAt(index, source.matrixWorld))
    mesh.castShadow = original.castShadow
    mesh.receiveShadow = original.receiveShadow
    group.add(mesh)
    const part = Array.isArray(original.material) ? foliage : wood
    part.push(mesh)
  }
  const bounds = new Box3().setFromObject(group).getSize(new Vector3())
  return {
    group, height: bounds.y, span: Math.max(bounds.x, bounds.z),
    stats: { branches: pine.branches, clusters: pine.tiers, triangles },
    display(view: View) {
      wood.forEach(mesh => { mesh.visible = view !== 'crown' })
      foliage.forEach(mesh => { mesh.visible = view !== 'skeleton' })
    },
    exportGlb: () => exportGlb(pine.group),
    dispose() {
      wood.forEach(mesh => mesh.dispose())
      foliage.forEach(mesh => mesh.dispose())
      pine.dispose()
    },
  }
}

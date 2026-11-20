import { Box3, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Viewer, type Camera } from '../src/viewport'
import { parseBroadleafConfig, defaults, type Species } from '../src/broadleaf/config'
import { assembleBroadleaf, type View } from '../src/broadleaf/asset'

const viewer = new Viewer(document.getElementById('canvas')!)
const frameHeight = 6.55
let asset: ReturnType<typeof assembleBroadleaf> | undefined
let imported: Awaited<ReturnType<GLTFLoader['parseAsync']>> | undefined

Object.assign(window, {
  async renderBroadleaf(species: Species, seed: number, view: View, camera: Camera, custom?: unknown) {
    asset?.dispose()
    asset = assembleBroadleaf(custom ? parseBroadleafConfig(custom) : defaults(species, seed))
    asset.display(view)
    viewer.showModel(asset.group, frameHeight, false)
    viewer.frame(camera)
    const bounds = new Box3().setFromObject(asset.group)
    const size = bounds.getSize(new Vector3()).toArray()
    viewer.snapshot()
    return { ...asset.stats, config: asset.growth.config, size, calls: viewer.renderer.info.render.calls }
  },
  async broadleafPng() { return viewer.snapshot() },
  async exportBroadleaf() {
    if (!asset) throw new Error('No asset')
    const blob = await asset.exportGlb()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = reject
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
  },
  async inspectBroadleaf(data: string) {
    const buffer = await (await fetch(data)).arrayBuffer()
    imported = await new GLTFLoader().parseAsync(buffer, '')
    const source = asset!
    const root = imported.scene
    const sourceBounds = new Box3().setFromObject(source.group)
    const bounds = new Box3().setFromObject(root)
    let triangles = 0, meshes = 0, masks = 0
    root.traverse(node => {
      if (!(node instanceof Mesh)) return
      meshes++
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      masks += materials.filter(material => material.alphaTest > 0 && material.map).length
      triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3
      for (const name of ['position', 'normal', 'uv']) {
        const attribute = node.geometry.getAttribute(name)
        if (attribute && !attribute.array.every(Number.isFinite)) throw new Error('Invalid GLB ' + name)
      }
      node.castShadow = true
      node.receiveShadow = materials.every(material => !material.alphaTest)
    })
    const boundError = sourceBounds.min.distanceTo(bounds.min) + sourceBounds.max.distanceTo(bounds.max)
    viewer.showModel(root, frameHeight, false)
    viewer.frame('angle')
    return { meshes, triangles, masks, boundError, inputSize: buffer.byteLength }
  },
})

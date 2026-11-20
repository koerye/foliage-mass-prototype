import { Box3, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { defaults, parseConfig } from '../src/config'
import { Viewer, type Camera } from '../src/viewport'
import type { View } from '../src/tree'

const frame = () => new Promise<number>(requestAnimationFrame)
const png = (viewer: Viewer) => viewer.snapshot().split(',')[1]
const seeds = [4607, 8123, 1307, 9731, 3089, 6727]

function makeHost(width: number, height: number) {
  const host = document.createElement('div')
  Object.assign(host.style, { width: width + 'px', height: height + 'px', overflow: 'hidden' })
  document.body.append(host)
  return host
}

async function capture(viewer: Viewer, view: View, camera: Camera, meso = true) {
  viewer.setView(view, { ...defaults(), mesoEnabled: meso })
  viewer.frame(camera)
  await frame()
  return png(viewer)
}

async function greenTop(encoded: string) {
  const image = new Image()
  image.src = 'data:image/png;base64,' + encoded
  await image.decode()
  const scan = document.createElement('canvas')
  scan.width = image.width
  scan.height = image.height
  const ctx = scan.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, scan.width, scan.height).data
  for (let row = 0; row < scan.height; row++) {
    let total = 0
    for (let column = 0; column < scan.width; column++) {
      const i = (row * scan.width + column) * 4
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]]
      if (g - r > 5 && g - b > 9 && g < 229 && ++total >= 3) return row
    }
  }
  throw new Error('Comparison silhouette missing')
}

export async function evidence(reference: string) {
  const host = makeHost(960, 850)
  const viewer = new Viewer(host)
  const config = defaults()
  const info = viewer.setTree(config, true)
  const bounds = new Box3().setFromObject(viewer.asset!.group)
  const files: Record<string, string> = {}
  try {
    files['01_macro_front'] = await capture(viewer, 'macro', 'front')
    files['02_macro_45deg'] = await capture(viewer, 'macro', 'angle')
    files['03_final_front'] = await capture(viewer, 'final', 'front')
    files['04_final_side'] = await capture(viewer, 'final', 'side')
    files['05_final_top_oblique'] = await capture(viewer, 'final', 'top')
    files['06_silhouette'] = await capture(viewer, 'silhouette', 'front')
    files['07_flat_bands'] = await capture(viewer, 'flat', 'front')
    const finalAngle = await capture(viewer, 'final', 'angle')
    const silhouettes: Record<string, [string, string]> = {}
    for (const camera of ['front', 'angle', 'side', 'top'] as Camera[]) {
      silhouettes[camera] = [await capture(viewer, 'silhouette', camera, false), await capture(viewer, 'silhouette', camera, true)]
    }

    const bytes = Uint8Array.from(atob(reference), character => character.charCodeAt(0))
    const original = (await new GLTFLoader().parseAsync(bytes.buffer, '')).scene
    viewer.setView('final', config)
    viewer.setReference(original, config.totalHeight)
    viewer.frame('front')
    await frame()
    const ground = (1 - new Vector3(0, 0, 0).project(viewer.camera).y) * viewer.renderer.domElement.height / 2
    const top = await greenTop(files['03_final_front'])
    const scale = (ground - top) / (ground - await greenTop(png(viewer)))
    original.scale.multiplyScalar(scale)
    original.position.multiplyScalar(scale)
    viewer.renderer.shadowMap.needsUpdate = true
    await frame()
    const baseline = png(viewer)
    const baselineTop = await greenTop(baseline)
    const size = bounds.getSize(new Vector3()).toArray()
    return { files, baseline, info, size, silhouettes, finalAngle, comparison: { baselineTop, top, ground, scale } }
  } finally {
    viewer.dispose()
    host.remove()
  }
}

export async function thumbnails() {
  const host = makeHost(128, 128)
  const viewer = new Viewer(host)
  try {
    const files = []
    for (const seed of seeds) {
      viewer.setTree(parseConfig({ seed }), true)
      viewer.frame('angle')
      await frame()
      files.push({ seed, png: png(viewer) })
    }
    return files
  } finally {
    viewer.dispose()
    host.remove()
  }
}

export async function performance1080() {
  const host = makeHost(1920, 1080)
  const viewer = new Viewer(host)
  const stats = viewer.setTree(defaults(), true)
  viewer.frame('angle')
  const gl = viewer.renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  const axis = new Vector3(0, 1, 0)
  const startPosition = viewer.camera.position.clone()
  try {
    let mark = performance.now()
    while (performance.now() - mark < 680) await frame()
    mark = performance.now()
    let frames = 0, calls = 0
    while (performance.now() - mark < 2600) {
      await frame()
      viewer.camera.position.copy(startPosition).applyAxisAngle(axis, frames / 100)
      viewer.controls.update()
      calls = Math.max(viewer.renderer.info.render.calls, calls)
      frames++
    }
    const fps = frames * 1000 / (performance.now() - mark)
    return { gpu, width: viewer.renderer.domElement.width, height: viewer.renderer.domElement.height, fps,
      calls, triangles: stats.triangles, mesh: stats, frames }
  } finally {
    viewer.dispose()
    host.remove()
  }
}


import {
  ACESFilmicToneMapping, Box3, Color, DirectionalLight, HemisphereLight, Mesh, Object3D,
  OrthographicCamera, PCFShadowMap, PlaneGeometry, Scene, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { foliageWind } from './broadleaf/leaf-material'
import type { TreeMassConfig } from './config'
import { assembleStylizedTree, type TreeAsset, type View } from './tree'

export const cameraMap = {
  front: [0, .07, 1],
  angle: [1, .29, 1],
  side: [1, .07, 0],
  top: [1, 2.24, 1],
} as const
export type Camera = keyof typeof cameraMap

export const lightingPresets = {
  neutral: {
    label: '清透画室', bg: '#f2f1ec',
    keyColor: '#fff6ea', keyIntensity: 2.15, keyDir: [.83, 1.84, 1.05] as const,
    fillColor: '#dce8ff', fillIntensity: .68,
    hemiSky: '#f8f9fc', hemiGround: '#dcd6d2', hemiIntensity: 1.38,
    shadowColor: '#4e505e', shadowOpacity: .15, exposure: 1.06,
  },
  ghibli: {
    label: '暖阳吉卜力', bg: '#f1eee0',
    keyColor: '#ffe7b8', keyIntensity: 2.35, keyDir: [.95, 1.65, .85] as const,
    fillColor: '#cde4ff', fillIntensity: .62,
    hemiSky: '#e8f4ff', hemiGround: '#cbc8a4', hemiIntensity: 1.35,
    shadowColor: '#485c52', shadowOpacity: .17, exposure: 1.08,
  },
  sakura: {
    label: '樱花柔光', bg: '#f7f2f4',
    keyColor: '#fff0f4', keyIntensity: 2.25, keyDir: [.68, 1.62, 1.15] as const,
    fillColor: '#e2dcff', fillIntensity: .78,
    hemiSky: '#fff7fa', hemiGround: '#e2cfd8', hemiIntensity: 1.48,
    shadowColor: '#6b4e64', shadowOpacity: .14, exposure: 1.1,
  },
  forest: {
    label: '森林冷影', bg: '#e8eeea',
    keyColor: '#eef8ff', keyIntensity: 2.05, keyDir: [.72, 2.05, .8] as const,
    fillColor: '#b7d6e8', fillIntensity: .72,
    hemiSky: '#dff0f7', hemiGround: '#889c92', hemiIntensity: 1.28,
    shadowColor: '#364d4b', shadowOpacity: .19, exposure: 1.03,
  },
  celestial: {
    label: '仙韵青岚', bg: '#d7e7e0',
    keyColor: '#fff5cf', keyIntensity: 2.38, keyDir: [.78, 1.75, 1.02] as const,
    fillColor: '#bfe5db', fillIntensity: .78,
    hemiSky: '#f0fbf5', hemiGround: '#98b9a6', hemiIntensity: 1.46,
    shadowColor: '#3c5d58', shadowOpacity: .15, exposure: 1.12,
  },
} as const
export type LightingPreset = keyof typeof lightingPresets
export const background = lightingPresets.neutral.bg

export class Viewer {
  readonly renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false })
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(-6, 6, 6, -6, .025, 140)
  readonly controls: OrbitControls
  asset?: TreeAsset
  reference?: Object3D
  private readonly floorMat = new ShadowMaterial({ color: lightingPresets.neutral.shadowColor, opacity: lightingPresets.neutral.shadowOpacity })
  private readonly floor = new Mesh(new PlaneGeometry(200, 200), this.floorMat)
  private readonly key = new DirectionalLight(lightingPresets.neutral.keyColor, lightingPresets.neutral.keyIntensity)
  private readonly fill = new DirectionalLight(lightingPresets.neutral.fillColor, lightingPresets.neutral.fillIntensity)
  private readonly hemi = new HemisphereLight(lightingPresets.neutral.hemiSky, lightingPresets.neutral.hemiGround, lightingPresets.neutral.hemiIntensity)
  private lighting: LightingPreset = 'neutral'
  private windEnabled = true
  private observer: ResizeObserver
  private frameId = 0
  private frameHeight = 7.2
  private frameWidth = 0
  private shownHeight = 6
  private fixedView: Camera = 'angle'
  private view: View = 'final'
  private frames = 0
  private stamp = performance.now()
  private config?: TreeMassConfig
  private readonly renderListeners = new Set<() => void>()

  private readonly onContextLostHandler: (ev: Event) => void
  private readonly onContextRestoredHandler: () => void

  constructor(
    readonly host: HTMLElement,
    private readonly onStats = (_fps: number, _calls: number) => {},
    onContextChange?: (lost: boolean) => void,
  ) {
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = lightingPresets.neutral.exposure
    this.scene.background = new Color(background)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.55))
    this.renderer.domElement.setAttribute('aria-label', '三维树冠预览')
    this.onContextLostHandler = (ev: Event) => {
      ev.preventDefault()
      onContextChange?.(true)
    }
    this.onContextRestoredHandler = () => {
      this.refreshShadows()
      onContextChange?.(false)
    }
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLostHandler)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestoredHandler)
    host.append(this.renderer.domElement)
    this.floor.name = 'StudioShadowFloor'
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = -.015
    this.floor.receiveShadow = true
    this.key.position.set(5, 11, 6)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1024, 1024)
    this.key.shadow.bias = -.00035
    this.key.shadow.normalBias = .035
    this.key.shadow.radius = 3.8
    Object.assign(this.key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, far: 120 })
    this.key.shadow.camera.updateProjectionMatrix()
    this.fill.position.set(-7, 3, -4)
    this.scene.add(this.floor, this.key, this.fill, this.hemi)
    this.camera.position.set(8, 6, 8)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.minZoom = .4
    this.controls.maxZoom = 6.5
    this.controls.maxPolarAngle = Math.PI * .57
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(this.host)
    window.addEventListener('pagehide', this.onPageHide)
    this.resize()
    this.frameId = requestAnimationFrame(this.animate)
  }

  private onPageHide = () => {
    cancelAnimationFrame(this.frameId)
    this.dispose()
  }

  private resize = () => {
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight)
    const scale = Math.max(this.frameHeight, (this.frameWidth || this.shownHeight * .74) / (width / height))
    this.renderer.setSize(width, height, false)
    this.camera.top = scale / 2
    this.camera.bottom = -this.camera.top
    this.camera.right = scale / 2 * width / height
    this.camera.left = -this.camera.right
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
  }

  setTree(config: TreeMassConfig, frame = false) {
    this.config = config
    const prior = this.asset
    if (prior) {
      this.scene.remove(prior.group)
      prior.dispose()
    }
    this.asset = assembleStylizedTree(config)
    if (this.reference) this.scene.remove(this.reference)
    this.reference = undefined
    this.scene.add(this.asset.group)
    this.shownHeight = config.totalHeight
    this.animLighting()
    this.setView(this.view, config)
    if (frame || !prior) this.frame(this.fixedView)
    return this.asset.stats()
  }

  setView(view: View, config = this.config) {
    if (!config) return
    this.view = view
    this.config = config
    this.asset?.display(view, config)
    this.floor.visible = view !== 'silhouette' && view !== 'wireframe' && view !== 'flat'
    this.renderer.shadowMap.needsUpdate = true
  }

  setReference(model: Object3D, height: number) {
    const box = new Box3().setFromObject(model)
    const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3())
    const factor = height / size.y
    model.position.set(-center.x * factor, -box.min.y * factor, -center.z * factor)
    model.scale.setScalar(factor)
    model.traverse(node => { if (node instanceof Mesh) node.castShadow = true })
    this.showModel(model, height)
  }

  showModel(model: Object3D, height: number, reframe = true) {
    if (this.reference) this.scene.remove(this.reference)
    if (this.asset) this.scene.remove(this.asset.group)
    this.scene.add(model)
    this.reference = model
    this.shownHeight = height
    this.floor.visible = true
    this.animLighting()
    if (reframe) this.frame(this.fixedView)
  }

  refreshShadows() { this.renderer.shadowMap.needsUpdate = true }

  setWind(on: boolean) {
    this.windEnabled = on
    foliageWind.uWindStrength.value = on ? .032 : 0
  }

  setLighting(preset: LightingPreset) {
    const resolved: LightingPreset = Object.prototype.hasOwnProperty.call(lightingPresets, preset) ? preset : 'neutral'
    this.lighting = resolved
    const p = lightingPresets[resolved]
    this.scene.background = new Color(p.bg)
    this.key.color.set(p.keyColor)
    this.key.intensity = p.keyIntensity
    this.fill.color.set(p.fillColor)
    this.fill.intensity = p.fillIntensity
    this.hemi.color.set(p.hemiSky)
    this.hemi.groundColor.set(p.hemiGround)
    this.hemi.intensity = p.hemiIntensity
    this.floorMat.color.set(p.shadowColor)
    this.floorMat.opacity = p.shadowOpacity
    this.renderer.toneMappingExposure = p.exposure
    this.animLighting()
  }

  private animLighting() {
    const h = this.shownHeight
    const [dx, dy, dz] = (lightingPresets[this.lighting] ?? lightingPresets.neutral).keyDir
    this.key.position.set(h * dx, h * dy, h * dz)
    Object.assign(this.key.shadow.camera, { left: -h * 1.28, right: h * 1.28, top: h * 1.28, bottom: -h * 1.28 })
    this.key.shadow.camera.updateProjectionMatrix()
    this.renderer.shadowMap.needsUpdate = true
  }

  frame(view: Camera, center?: Vector3, bounds?: Box3) {
    this.fixedView = view
    const h = this.shownHeight
    const focus = center ?? bounds?.getCenter(new Vector3()) ?? new Vector3(0, h * .495, 0)
    const direction = new Vector3(...cameraMap[view]).normalize()
    this.frameHeight = h * 1.19
    this.frameWidth = 0
    if (bounds && !bounds.isEmpty()) {
      const size = bounds.getSize(new Vector3())
      const right = new Vector3().crossVectors(this.camera.up, direction).normalize()
      const up = new Vector3().crossVectors(direction, right)
      const projectedSize = (axis: Vector3) =>
        Math.abs(axis.x) * size.x + Math.abs(axis.y) * size.y + Math.abs(axis.z) * size.z
      this.frameHeight = projectedSize(up) * 1.14
      this.frameWidth = projectedSize(right) * 1.14
    }
    this.controls.enableDamping = false
    this.controls.update()
    this.controls.target.copy(focus)
    this.camera.position.copy(focus).addScaledVector(direction, h * 2.50)
    this.camera.zoom = 1
    this.resize()
    this.controls.update()
    this.controls.enableDamping = true
  }

  snapshot(options?: { transparent?: boolean; hide?: (Object3D | undefined)[] }): string {
    const transparent = Boolean(options?.transparent)
    if (!transparent && !options?.hide?.length) {
      this.renderer.render(this.scene, this.camera)
      return this.renderer.domElement.toDataURL('image/png')
    }

    const prevBg = this.scene.background
    const prevFog = this.scene.fog
    const prevFloorVisible = this.floor.visible
    const prevClearColor = new Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()

    const hiddenStates: [Object3D, boolean][] = []
    const hideOnce = new Set<Object3D>()
    const markHide = (obj: Object3D | undefined) => {
      if (!obj || hideOnce.has(obj)) return
      hideOnce.add(obj)
      hiddenStates.push([obj, obj.visible])
      obj.visible = false
    }

    try {
      if (options?.hide) {
        for (const obj of options.hide) markHide(obj)
      }
      if (transparent) {
        this.scene.background = null
        this.scene.fog = null
        markHide(this.floor)
        for (const child of this.scene.children) {
          if (
            child === this.floor
            || child.name === 'StudioShadowFloor'
            || child.name === 'crown-editor'
            || child.userData?.exportIgnore === true
          ) {
            markHide(child)
          }
        }
        this.renderer.setClearColor(0x000000, 0)
      }
      this.renderer.render(this.scene, this.camera)
      return this.renderer.domElement.toDataURL('image/png')
    } finally {
      this.scene.background = prevBg
      this.scene.fog = prevFog
      for (const [obj, wasVisible] of hiddenStates) obj.visible = wasVisible
      this.floor.visible = prevFloorVisible
      this.renderer.setClearColor(prevClearColor, prevClearAlpha)
      try { this.renderer.render(this.scene, this.camera) } catch { /* ignore restore render failure */ }
    }
  }

  addRenderListener(fn: () => void) {
    this.renderListeners.add(fn)
    return () => { this.renderListeners.delete(fn) }
  }

  private animate = (now: number) => {
    this.frameId = requestAnimationFrame(this.animate)
    if (this.windEnabled) {
      foliageWind.uWindTime.value = now * .001
      foliageWind.uWindStrength.value = .032
    } else {
      foliageWind.uWindStrength.value = 0
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    for (const fn of this.renderListeners) fn()
    this.frames++
    if (now - this.stamp >= 650) {
      this.onStats(this.frames * 1000 / (now - this.stamp), this.renderer.info.render.calls)
      this.frames = 0
      this.stamp = now
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    window.removeEventListener('pagehide', this.onPageHide)
    this.observer.disconnect()
    this.controls.dispose()
    this.asset?.dispose()
    this.floor.geometry.dispose()
    this.floor.material.dispose()
    this.key.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}


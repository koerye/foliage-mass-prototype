// Interactive 3D Scene Assembly Viewport with OrbitControls, Three.js TransformControls
// (translate / rotate / scale), click-to-select raycasting, crisp 2048px diorama shadows,
// backdrop/lighting moods, wind animation, and clean snapshot/thumbnail capture.
import {
  ACESFilmicToneMapping, Box3, BoxHelper, Color, DirectionalLight, Group, HemisphereLight,
  MathUtils, PCFShadowMap, PerspectiveCamera, Raycaster, Scene, SRGBColorSpace, Vector2,
  Vector3, WebGLRenderer, type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { foliageWind } from '../broadleaf/leaf-material'
import { lightingPresets, type LightingPreset } from '../viewport'
import { backdropMeta, type AssemblyCameraPreset, type BackdropTheme } from './spec'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface AssemblyViewportCallbacks {
  onSelect(id: string | undefined): void
  onTransformChange(id: string, pos: [number, number, number], rotDeg: [number, number, number], scale: [number, number, number]): void
  onTransformCommit(id: string): void
  onStats?(fps: number, calls: number): void
}

export class AssemblyViewport {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  readonly transform: TransformControls
  readonly transformHelper: Object3D
  readonly exportGroup = new Group()
  readonly groundRoot = new Group()
  readonly itemsRoot = new Group()

  private readonly key = new DirectionalLight('#ffe7b8', 2.45)
  private readonly fill = new DirectionalLight('#cde4ff', 0.68)
  private readonly hemi = new HemisphereLight('#e8f4ff', '#9aa684', 1.38)
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private selectionBox?: BoxHelper
  private attachedTarget?: Object3D
  private attachedId?: string
  private gizmoMode: GizmoMode = 'translate'
  private draggingGizmo = false
  private windEnabled = true
  private backdrop: BackdropTheme = 'diorama-dark'
  private lighting: LightingPreset = 'ghibli'
  private sceneRadius = 6.5
  private frameId = 0
  private frames = 0
  private stamp = performance.now()
  private observer: ResizeObserver
  private pointerDownPos = { x: 0, y: 0 }
  private pointerDownValid = false

  constructor(
    readonly host: HTMLElement,
    private readonly cb: AssemblyViewportCallbacks,
  ) {
    this.renderer = new WebGLRenderer({
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6))
    this.renderer.domElement.setAttribute('aria-label', '场景组装三维视口')
    host.append(this.renderer.domElement)

    this.camera = new PerspectiveCamera(28, 1, 0.1, 220)
    this.camera.position.set(13.5, 9.6, 13.5)

    this.exportGroup.name = 'AssemblyScene'
    this.groundRoot.name = 'GroundRoot'
    this.itemsRoot.name = 'ItemsRoot'
    this.exportGroup.add(this.groundRoot, this.itemsRoot)
    this.scene.add(this.exportGroup)

    // Stylized key + fill + hemisphere lighting with crisp 2048px diorama shadow map
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    this.key.shadow.bias = -0.00035
    this.key.shadow.normalBias = 0.032
    this.key.shadow.radius = 2.8
    this.scene.add(this.key, this.fill, this.hemi)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 2.0
    this.controls.maxDistance = 68
    this.controls.maxPolarAngle = Math.PI * 0.495

    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.setMode(this.gizmoMode)
    this.transform.setSize(0.82)
    this.transformHelper = this.transform.getHelper()
    this.transformHelper.userData.isHelper = true
    this.scene.add(this.transformHelper)

    this.transform.addEventListener('dragging-changed', ev => {
      this.draggingGizmo = Boolean((ev as { value?: unknown }).value)
      this.controls.enabled = !this.draggingGizmo
      if (!this.draggingGizmo && this.attachedId) {
        this.refreshShadows()
        this.cb.onTransformCommit(this.attachedId)
      }
    })

    this.transform.addEventListener('objectChange', () => {
      if (!this.attachedTarget || !this.attachedId) return
      const p = this.attachedTarget.position
      const r = this.attachedTarget.rotation
      const s = this.attachedTarget.scale
      // Clamp tiny negative/zero scales safely
      s.set(Math.max(0.05, s.x), Math.max(0.05, s.y), Math.max(0.05, s.z))
      this.selectionBox?.update()
      this.refreshShadows()
      this.cb.onTransformChange(
        this.attachedId,
        [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
        [
          Number(MathUtils.radToDeg(r.x).toFixed(1)),
          Number(MathUtils.radToDeg(r.y).toFixed(1)),
          Number(MathUtils.radToDeg(r.z).toFixed(1)),
        ],
        [Number(s.x.toFixed(3)), Number(s.y.toFixed(3)), Number(s.z.toFixed(3))],
      )
    })

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)

    this.setBackdrop('diorama-dark', 'ghibli')
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(this.host)
    this.resize()
    this.frameId = requestAnimationFrame(this.animate)
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0 || this.draggingGizmo) {
      this.pointerDownValid = false
      return
    }
    this.pointerDownValid = true
    this.pointerDownPos = { x: ev.clientX, y: ev.clientY }
  }

  private onPointerUp = (ev: PointerEvent) => {
    if (!this.pointerDownValid || ev.button !== 0 || this.draggingGizmo) return
    this.pointerDownValid = false
    const dist = Math.hypot(ev.clientX - this.pointerDownPos.x, ev.clientY - this.pointerDownPos.y)
    if (dist > 5) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    this.pointer.y = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.itemsRoot.children, true)
    for (const hit of hits) {
      let cur: Object3D | null = hit.object
      while (cur && cur !== this.itemsRoot) {
        if (!cur.visible) { cur = null; break }
        const id = cur.userData?.assemblyItemId as string | undefined
        if (id) {
          this.cb.onSelect(id)
          return
        }
        cur = cur.parent
      }
    }
    this.cb.onSelect(undefined)
  }

  private resize = () => {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.scene, this.camera)
  }

  setBackdrop(theme: BackdropTheme, lightingOverride?: LightingPreset) {
    this.backdrop = theme
    const meta = backdropMeta[theme]
    this.lighting = lightingOverride ?? meta.lighting
    const lp = lightingPresets[this.lighting]
    this.scene.background = new Color(meta.bg)
    const isDark = theme === 'diorama-dark'
    this.key.color.set(lp.keyColor)
    this.key.intensity = isDark ? lp.keyIntensity * 1.12 : lp.keyIntensity
    this.fill.color.set(lp.fillColor)
    this.fill.intensity = isDark ? lp.fillIntensity * 0.92 : lp.fillIntensity
    this.hemi.color.set(lp.hemiSky)
    this.hemi.groundColor.set(isDark ? '#32513d' : lp.hemiGround)
    this.hemi.intensity = isDark ? lp.hemiIntensity * 0.95 : lp.hemiIntensity
    this.renderer.toneMappingExposure = isDark ? 1.10 : lp.exposure
    this.updateShadowFrustum(this.sceneRadius)
  }

  setWind(on: boolean) {
    this.windEnabled = on
    foliageWind.uWindStrength.value = on ? 0.026 : 0
  }

  updateShadowFrustum(radius: number) {
    this.sceneRadius = Math.max(4.5, radius)
    const lp = lightingPresets[this.lighting]
    const [dx, dy, dz] = lp.keyDir
    const d = this.sceneRadius * 1.45
    // Aim key light from right-front-top so the tree casts that rich shadow toward the back-left lawn (Ref 1/2!)
    const keyZ = this.backdrop === 'diorama-dark' ? -.72 : .55
    this.key.position.set(d * Math.abs(dx) * 1.15, d * dy * 1.15, d * Math.abs(dz) * keyZ)
    const span = this.sceneRadius * 1.32
    Object.assign(this.key.shadow.camera, {
      left: -span,
      right: span,
      top: span,
      bottom: -span,
      near: 0.5,
      far: d * 4.5,
    })
    this.key.shadow.camera.updateProjectionMatrix()
    this.fill.position.set(-d * 0.8, d * 0.45, -d * 0.6)
    this.refreshShadows()
  }

  refreshShadows() {
    this.renderer.shadowMap.needsUpdate = true
  }

  setGizmoMode(mode: GizmoMode) {
    this.gizmoMode = mode
    this.transform.setMode(mode)
  }

  getGizmoMode(): GizmoMode {
    return this.gizmoMode
  }

  attachSelection(id: string | undefined, target: Object3D | undefined, locked = false) {
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox)
      this.selectionBox.dispose()
      this.selectionBox = undefined
    }
    this.attachedId = id
    this.attachedTarget = target
    if (!id || !target || !target.visible) {
      this.transform.detach()
      return
    }
    this.selectionBox = new BoxHelper(target, locked ? 0xf59e0b : 0x57d47b)
    this.selectionBox.userData.isHelper = true
    this.scene.add(this.selectionBox)
    if (locked) this.transform.detach()
    else this.transform.attach(target)
  }

  refreshSelectionBox() {
    this.selectionBox?.update()
  }

  frameScene(preset: AssemblyCameraPreset = 'iso', groundSize = 9.0) {
    this.exportGroup.updateMatrixWorld(true)
    const box = new Box3().setFromObject(this.exportGroup)
    const size = new Vector3()
    const center = new Vector3()
    if (box.isEmpty()) {
      size.set(groundSize, 4, groundSize)
      center.set(0, 1.2, 0)
    } else {
      box.getSize(size)
      box.getCenter(center)
    }
    // Keep focus nicely centered over the diorama slab & vertical mid-height of hero silhouette
    const targetY = Math.max(0.25, Math.min(size.y * 0.38, box.max.y * 0.44))
    const focus = new Vector3(center.x * 0.45, targetY, center.z * 0.45)
    const radius = Math.max(groundSize * 0.68, size.length() * 0.52)
    this.updateShadowFrustum(Math.max(groundSize * 0.72, radius))

    const fovRad = MathUtils.degToRad(this.camera.fov)
    const dist = (radius / Math.sin(fovRad * 0.5)) * 0.84
    // Lower the sightline for tall subjects so the slab does not hide the exposed trunk.
    const illustrationPitch = MathUtils.clamp(.55 - .34 * size.y / groundSize, .17, .49)
    const dir = preset === 'front'
      ? new Vector3(0, 0.28, 1)
      : preset === 'side'
        ? new Vector3(1, 0.28, 0)
        : preset === 'top'
          ? new Vector3(0.18, 2.35, 0.18)
          : preset === 'illustration' ? new Vector3(.83, illustrationPitch, 1) : new Vector3(1, .64, 1)
    dir.normalize()

    this.controls.enableDamping = false
    this.controls.target.copy(focus)
    this.camera.position.copy(focus).addScaledVector(dir, dist)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.controls.enableDamping = true
    this.renderer.render(this.scene, this.camera)
  }

  focusObject(target: Object3D) {
    target.updateMatrixWorld(true)
    const box = new Box3().setFromObject(target)
    if (box.isEmpty()) return
    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    const radius = Math.max(0.8, size.length() * 0.6)
    const dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-4) dir.set(1, 0.65, 1)
    dir.normalize()
    const dist = Math.max(3.2, radius * 2.6)
    this.controls.enableDamping = false
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(dir, dist)
    this.controls.update()
    this.controls.enableDamping = true
    this.renderer.render(this.scene, this.camera)
  }

  snapshotDataUrl(mime: 'image/png' | 'image/jpeg' = 'image/png', maxW?: number, maxH?: number): string {
    const helperWasVisible = this.transformHelper.visible
    const boxWasVisible = this.selectionBox?.visible ?? false
    this.transformHelper.visible = false
    if (this.selectionBox) this.selectionBox.visible = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
    let out: string
    if (maxW && maxH) {
      const src = this.renderer.domElement
      const c = document.createElement('canvas')
      c.width = maxW
      c.height = maxH
      const g = c.getContext('2d')!
      const ratio = Math.min(maxW / src.width, maxH / src.height)
      const w = src.width * ratio, h = src.height * ratio
      g.fillStyle = (this.scene.background as Color).getStyle()
      g.fillRect(0, 0, maxW, maxH)
      g.drawImage(src, (maxW - w) / 2, (maxH - h) / 2, w, h)
      out = c.toDataURL(mime, mime === 'image/jpeg' ? 0.88 : undefined)
    } else {
      out = this.renderer.domElement.toDataURL(mime)
    }
    this.transformHelper.visible = helperWasVisible
    if (this.selectionBox) this.selectionBox.visible = boxWasVisible
    this.renderer.render(this.scene, this.camera)
    return out
  }

  private animate = (now: number) => {
    this.frameId = requestAnimationFrame(this.animate)
    if (this.windEnabled) {
      foliageWind.uWindTime.value = now * 0.001
      foliageWind.uWindStrength.value = 0.026
    } else {
      foliageWind.uWindStrength.value = 0
    }
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.frames++
    if (now - this.stamp >= 650) {
      this.cb.onStats?.(this.frames * 1000 / (now - this.stamp), this.renderer.info.render.calls)
      this.frames = 0
      this.stamp = now
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    this.observer.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.transform.detach()
    this.transform.dispose()
    this.controls.dispose()
    if (this.selectionBox) this.selectionBox.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

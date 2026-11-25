// Interactive 3D Scene Assembly Viewport with OrbitControls, Three.js TransformControls
// (translate / rotate / scale), click-to-select raycasting, crisp 2048px diorama shadows,
// backdrop/lighting moods, wind animation, and clean snapshot/thumbnail capture.
import {
  ACESFilmicToneMapping, Box3, BoxHelper, Color, DirectionalLight, Group, HemisphereLight,
  InstancedMesh, LOD, MathUtils, Mesh, MOUSE, PCFShadowMap, PerspectiveCamera, Plane, Raycaster,
  Scene, ShadowMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { foliageWind } from '../broadleaf/leaf-material'
import { lightingPresets, type LightingPreset } from '../viewport'
import { createBrushCursorRing, type BrushCursorRing } from './grass-brush'
import { backdropMeta, type AssemblyCameraPreset, type BackdropTheme } from './spec'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

export interface AssemblyViewportCallbacks {
  onSelect(id: string | undefined): void
  onTransformStart?(id: string): void
  onTransformChange(id: string, pos: [number, number, number], rotDeg: [number, number, number], scale: [number, number, number]): void
  onTransformCommit(id: string): void
  onStats?(fps: number, calls: number, triangles: number): void
  onBrushHover?(hit: Vector3 | undefined, shiftKey: boolean): void
  onBrushStrokeStart?(hit: Vector3, shiftKey: boolean): void
  onBrushStrokeMove?(hit: Vector3, shiftKey: boolean): void
  onBrushStrokeEnd?(): void
  onContextLost?(lost: boolean): void
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
  readonly grassRoot = new Group()
  readonly brushCursor: BrushCursorRing

  private readonly key = new DirectionalLight('#ffe7b8', 2.45)
  private readonly fill = new DirectionalLight('#cde4ff', 0.68)
  private readonly hemi = new HemisphereLight('#e8f4ff', '#9aa684', 1.38)
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0)
  private selectionBox?: BoxHelper
  private attachedTarget?: Object3D
  private attachedId?: string
  private attachedLocked = false
  private gizmoMode: GizmoMode = 'translate'
  private draggingGizmo = false
  private brushActive = false
  private brushPainting = false
  private lastPointerClient?: { x: number; y: number }
  private lastBrushHit?: Vector3
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
      alpha: true,
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
    this.grassRoot.name = 'GrassRoot'
    this.exportGroup.add(this.groundRoot, this.itemsRoot, this.grassRoot)
    this.scene.add(this.exportGroup)

    this.brushCursor = createBrushCursorRing()
    this.scene.add(this.brushCursor.group)

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
      const nextDragging = Boolean((ev as { value?: unknown }).value)
      const wasDragging = this.draggingGizmo
      this.draggingGizmo = nextDragging
      this.controls.enabled = !nextDragging
      if (nextDragging && this.attachedId) {
        this.cb.onTransformStart?.(this.attachedId)
      } else if (!nextDragging && wasDragging && this.attachedId) {
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
      this.updateLods()
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
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.onCancelActiveInteraction)
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored)
    window.addEventListener('pointerup', this.onWindowPointerUp)
    window.addEventListener('blur', this.onCancelActiveInteraction)
    window.addEventListener('pagehide', this.onPageHide)

    this.setBackdrop('diorama-dark', 'ghibli')
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(this.host)
    this.resize()
    this.frameId = requestAnimationFrame(this.animate)
  }

  private onPageHide = () => {
    cancelAnimationFrame(this.frameId)
    this.dispose()
  }

  private raycastGroundPoint(clientX: number, clientY: number): Vector3 | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return undefined
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const out = new Vector3()
    return this.raycaster.ray.intersectPlane(this.groundPlane, out) ? out : undefined
  }

  private onPointerDown = (ev: PointerEvent) => {
    if (this.brushActive) {
      if (ev.button === 0 && !ev.altKey) {
        const hit = this.raycastGroundPoint(ev.clientX, ev.clientY)
        if (hit) {
          this.brushPainting = true
          this.cb.onBrushStrokeStart?.(hit, ev.shiftKey)
        }
      }
      this.pointerDownValid = false
      return
    }
    if (ev.button !== 0 || this.draggingGizmo) {
      this.pointerDownValid = false
      return
    }
    this.pointerDownValid = true
    this.pointerDownPos = { x: ev.clientX, y: ev.clientY }
  }

  private onPointerMove = (ev: PointerEvent) => {
    this.lastPointerClient = { x: ev.clientX, y: ev.clientY }
    if (!this.brushActive) return
    const hit = this.raycastGroundPoint(ev.clientX, ev.clientY)
    this.lastBrushHit = hit?.clone()
    this.cb.onBrushHover?.(hit, ev.shiftKey)
    if (this.brushPainting && hit) {
      this.cb.onBrushStrokeMove?.(hit, ev.shiftKey)
    }
  }

  private onPointerLeave = () => {
    this.lastPointerClient = undefined
    this.lastBrushHit = undefined
    if (!this.brushActive) return
    this.cb.onBrushHover?.(undefined, false)
  }

  /** Immediately refreshes the 3D brush cursor ring (e.g. on pressing B, [, ], or Shift) with zero mouse-move delay! */
  refreshBrushHover(shiftKey = false) {
    if (!this.brushActive) return
    const hit = this.lastPointerClient
      ? this.raycastGroundPoint(this.lastPointerClient.x, this.lastPointerClient.y)
      : this.lastBrushHit
    if (hit) this.lastBrushHit = hit.clone()
    this.cb.onBrushHover?.(hit, shiftKey)
  }

  private onContextLost = (ev: Event) => {
    ev.preventDefault()
    this.cancelActiveDrag()
    this.cb.onContextLost?.(true)
  }

  private onContextRestored = () => {
    this.refreshShadows()
    this.cb.onContextLost?.(false)
  }

  /** Safely unwinds any in-flight Gizmo drag or brush stroke so OrbitControls / pointer state can never lock up. */
  cancelActiveDrag() {
    this.pointerDownValid = false
    if (this.draggingGizmo || this.transform.dragging) {
      const tc = this.transform as unknown as {
        pointerUp?: (pointer: null) => void
        _onPointerMove?: EventListener
      }
      // Reset Three.js TransformControls internal dragging/axis state BEFORE disabling or detaching,
      // otherwise onPointerUp exits early when enabled=false and leaves TransformControls stuck dragging.
      if (tc._onPointerMove) {
        this.renderer.domElement.removeEventListener('pointermove', tc._onPointerMove)
      }
      tc.pointerUp?.(null)
      const stillDragging = this.draggingGizmo
      this.draggingGizmo = false
      this.controls.enabled = true
      if (stillDragging && this.attachedId) {
        this.refreshShadows()
        this.cb.onTransformCommit(this.attachedId)
      }
    }
    if (this.brushPainting) {
      this.brushPainting = false
      this.cb.onBrushStrokeEnd?.()
    }
  }

  private onCancelActiveInteraction = () => {
    this.cancelActiveDrag()
  }

  private onWindowPointerUp = () => {
    if (!this.brushPainting) return
    this.brushPainting = false
    this.cb.onBrushStrokeEnd?.()
  }

  private onPointerUp = (ev: PointerEvent) => {
    if (this.brushActive) {
      if (this.brushPainting) {
        this.brushPainting = false
        this.cb.onBrushStrokeEnd?.()
      }
      return
    }
    if (!this.pointerDownValid || ev.button !== 0 || this.draggingGizmo) return
    this.pointerDownValid = false
    const dist = Math.hypot(ev.clientX - this.pointerDownPos.x, ev.clientY - this.pointerDownPos.y)
    if (dist > 5) return

    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    this.pointer.y = -((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
    this.updateLods()
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.itemsRoot.children, true)
    for (const hit of hits) {
      // Verify FULL ancestor chain up to itemsRoot is visible so hidden items never intercept clicks!
      let visCheck: Object3D | null = hit.object
      let hidden = false
      let foundId: string | undefined
      while (visCheck && visCheck !== this.itemsRoot) {
        if (!visCheck.visible) { hidden = true; break }
        if (!foundId && typeof visCheck.userData?.assemblyItemId === 'string') {
          foundId = visCheck.userData.assemblyItemId
        }
        visCheck = visCheck.parent
      }
      if (!hidden && foundId) {
        this.cb.onSelect(foundId)
        return
      }
    }
    this.cb.onSelect(undefined)
  }

  setBrushMode(active: boolean) {
    if (this.brushActive === active) return
    // Unwind any active Gizmo drag (resetting TransformControls internal drag state via pointerUp(null)
    // BEFORE setting transform.enabled = false) or active brush stroke BEFORE toggling tool state.
    this.cancelActiveDrag()
    this.brushActive = active
    this.brushPainting = false
    this.controls.enabled = true
    if (active) {
      // UE-style Brush Mode: ALL scene models are strictly locked (TransformControls disabled & detached!).
      // Left-drag paints/erases, Right-drag orbits, Wheel zooms.
      this.controls.mouseButtons = {
        LEFT: null as unknown as MOUSE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.ROTATE,
      }
      if (this.draggingGizmo || this.transform.dragging) {
        ;(this.transform as unknown as { pointerUp?: (pointer: null) => void }).pointerUp?.(null)
        this.draggingGizmo = false
        this.controls.enabled = true
      }
      this.transform.enabled = false
      this.transform.detach()
      this.transformHelper.visible = false
      if (this.selectionBox) this.selectionBox.visible = false
      this.renderer.domElement.style.cursor = 'crosshair'
      this.refreshBrushHover(false)
    } else {
      this.controls.mouseButtons = {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
      }
      this.brushCursor.setPose(0, 0, 0, 1, false, false)
      this.transform.enabled = true
      if (this.attachedTarget && this.attachedTarget.visible && !this.attachedLocked) {
        this.transform.attach(this.attachedTarget)
        this.transformHelper.visible = true
      } else {
        this.transform.detach()
        this.transformHelper.visible = false
      }
      if (this.selectionBox) this.selectionBox.visible = Boolean(this.attachedTarget && this.attachedTarget.visible)
      this.renderer.domElement.style.cursor = ''
    }
  }

  isBrushMode(): boolean {
    return this.brushActive
  }

  triggerResize() {
    this.resize()
  }

  private resize = () => {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the tile visible when reference comparison halves the viewport width.
    this.camera.zoom = Math.min(1, this.camera.aspect / 1.02)
    this.camera.updateProjectionMatrix()
    this.updateLods()
    this.renderer.render(this.scene, this.camera)
  }

  /** Synchronizes all `THREE.LOD` children in `itemsRoot` against the current camera pose. */
  updateLods() {
    this.camera.updateMatrixWorld()
    this.itemsRoot.updateMatrixWorld(true)
    this.itemsRoot.traverse(o => {
      if (o instanceof LOD) o.update(this.camera)
    })
  }

  /**
   * Returns a non-mutating export root where any `THREE.LOD` subtree is flattened to its
   * full-precision `LOD0` level (`levels[0].object`), ensuring GLB/glTF/FBX exports and
   * export previews ALWAYS use full LOD0 geometry regardless of current camera distance.
   * When no `THREE.LOD` exists in the scene, returns `this.exportGroup` directly.
   */
  getLod0ExportRoot(): Group {
    let hasLod = false
    this.exportGroup.traverse(o => {
      if (o instanceof LOD) hasLod = true
    })
    if (!hasLod) return this.exportGroup

    this.exportGroup.updateMatrixWorld(true)
    const cloneShallowLod0 = (node: Object3D, forceVisible = false): Object3D | undefined => {
      if (!forceVisible && !node.visible) return undefined
      if (node.userData?.isDistantLod === true) return undefined
      if (node instanceof LOD) {
        const lod0 = node.levels[0]?.object
        if (!lod0) return undefined
        const g = new Group()
        g.name = node.name
        g.visible = true
        g.position.copy(node.position)
        g.quaternion.copy(node.quaternion)
        g.scale.copy(node.scale)
        g.userData = node.userData
        const clonedLod0 = cloneShallowLod0(lod0, true)
        if (clonedLod0) g.add(clonedLod0)
        return g
      }
      if (node instanceof InstancedMesh) {
        const c = new InstancedMesh(node.geometry, node.material, 0)
        c.instanceMatrix = node.instanceMatrix
        c.instanceColor = node.instanceColor
        c.count = node.count
        c.name = node.name
        c.visible = true
        c.position.copy(node.position)
        c.quaternion.copy(node.quaternion)
        c.scale.copy(node.scale)
        c.castShadow = node.castShadow
        c.receiveShadow = node.receiveShadow
        c.userData = node.userData
        return c
      }
      if (node instanceof Mesh) {
        const c = new Mesh(node.geometry, node.material)
        c.name = node.name
        c.visible = true
        c.position.copy(node.position)
        c.quaternion.copy(node.quaternion)
        c.scale.copy(node.scale)
        c.castShadow = node.castShadow
        c.receiveShadow = node.receiveShadow
        c.userData = node.userData
        for (const child of node.children) {
          const cc = cloneShallowLod0(child, false)
          if (cc) c.add(cc)
        }
        return c
      }
      const g = new Group()
      g.name = node.name
      g.visible = true
      g.position.copy(node.position)
      g.quaternion.copy(node.quaternion)
      g.scale.copy(node.scale)
      g.userData = node.userData
      for (const child of node.children) {
        const cc = cloneShallowLod0(child, false)
        if (cc) g.add(cc)
      }
      return g
    }

    const proxy = cloneShallowLod0(this.exportGroup, true) as Group
    proxy.updateMatrixWorld(true)
    return proxy
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
    foliageWind.uWindStrength.value = on ? 0.078 : 0
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
    if ((this.draggingGizmo || this.transform.dragging) && (target !== this.attachedTarget || locked || !target?.visible || this.brushActive)) {
      this.cancelActiveDrag()
    }
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox)
      this.selectionBox.dispose()
      this.selectionBox = undefined
    }
    this.attachedId = id
    this.attachedTarget = target
    this.attachedLocked = locked
    if (!id || !target || !target.visible) {
      this.transform.detach()
      return
    }
    this.selectionBox = new BoxHelper(target, locked ? 0xf59e0b : 0x57d47b)
    this.selectionBox.userData.isHelper = true
    this.selectionBox.visible = !this.brushActive
    this.scene.add(this.selectionBox)
    if (locked || this.brushActive) {
      this.transform.detach()
      this.transform.enabled = !this.brushActive
      this.transformHelper.visible = false
    } else {
      this.transform.enabled = true
      this.transform.attach(target)
      this.transformHelper.visible = true
    }
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
    // Tall subjects read more like an illustration with a shallow ground plane and nearly even corners.
    const heightToGround = size.y / groundSize
    const tallSubject = MathUtils.smoothstep(heightToGround, .65, 1.12)
    const illustrationPitch = MathUtils.clamp(.55 - .34 * heightToGround, .17, .49) - .052 * tallSubject
    const dir = preset === 'front'
      ? new Vector3(0, 0.28, 1)
      : preset === 'side'
        ? new Vector3(1, 0.28, 0)
        : preset === 'top'
          ? new Vector3(0.18, 2.35, 0.18)
          : preset === 'illustration' ? new Vector3(.83 + .095 * tallSubject, illustrationPitch, 1) : new Vector3(1, .64, 1)
    dir.normalize()

    this.controls.enableDamping = false
    this.controls.target.copy(focus)
    this.camera.position.copy(focus).addScaledVector(dir, dist)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.controls.enableDamping = true
    this.updateLods()
    this.renderer.render(this.scene, this.camera)
  }

  /** Moves the camera along its current view ray to `distance` meters from orbit target and refreshes LODs. */
  setCameraDistance(distance: number) {
    const clamped = MathUtils.clamp(distance, this.controls.minDistance, this.controls.maxDistance)
    const dir = this.camera.position.clone().sub(this.controls.target)
    if (dir.lengthSq() < 1e-4) dir.set(1, 0.64, 1)
    dir.normalize()
    this.controls.enableDamping = false
    this.camera.position.copy(this.controls.target).addScaledVector(dir, clamped)
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.controls.enableDamping = true
    this.updateLods()
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
    this.updateLods()
    this.renderer.render(this.scene, this.camera)
  }

  snapshot(options?: { transparent?: boolean }): string {
    return this.snapshotDataUrl('image/png', undefined, undefined, options)
  }

  snapshotDataUrl(
    mime: 'image/png' | 'image/jpeg' = 'image/png',
    maxW?: number,
    maxH?: number,
    options?: { transparent?: boolean },
  ): string {
    const transparent = Boolean(options?.transparent)
    const helperWasVisible = this.transformHelper.visible
    const boxWasVisible = this.selectionBox?.visible ?? false
    const cursorWasVisible = this.brushCursor.group.visible
    const prevBg = this.scene.background
    const prevFog = this.scene.fog
    const prevClearColor = new Color()
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()
    const hiddenForSnapshot: { obj: Object3D; visible: boolean }[] = []

    try {
      this.transformHelper.visible = false
      if (this.selectionBox) this.selectionBox.visible = false
      this.brushCursor.group.visible = false
      if (transparent) {
        this.scene.traverse(obj => {
          if (!obj.visible) return
          const isShadowFloor = obj.name === 'StudioShadowFloor'
            || (obj instanceof Mesh && (
              Array.isArray(obj.material)
                ? obj.material.length > 0 && obj.material.every(m => m instanceof ShadowMaterial)
                : obj.material instanceof ShadowMaterial
            ))
          const isHelper = obj.userData?.isHelper === true || obj.type === 'GridHelper'
          if (isShadowFloor || isHelper) {
            hiddenForSnapshot.push({ obj, visible: obj.visible })
            obj.visible = false
          }
        })
        this.scene.background = null
        this.scene.fog = null
        this.renderer.setClearColor(0x000000, 0)
      }
      this.updateLods()
      this.renderer.shadowMap.needsUpdate = true
      this.renderer.render(this.scene, this.camera)

      const outMime = transparent ? 'image/png' : mime
      if (maxW && maxH) {
        const src = this.renderer.domElement
        const c = document.createElement('canvas')
        c.width = maxW
        c.height = maxH
        const g = c.getContext('2d')!
        const ratio = Math.min(maxW / src.width, maxH / src.height)
        const w = src.width * ratio, h = src.height * ratio
        if (!transparent && prevBg instanceof Color) {
          g.fillStyle = prevBg.getStyle()
          g.fillRect(0, 0, maxW, maxH)
        }
        g.drawImage(src, (maxW - w) / 2, (maxH - h) / 2, w, h)
        return c.toDataURL(outMime, outMime === 'image/jpeg' ? 0.88 : undefined)
      }
      return this.renderer.domElement.toDataURL(outMime)
    } finally {
      for (const h of hiddenForSnapshot) h.obj.visible = h.visible
      this.scene.background = prevBg
      this.scene.fog = prevFog
      this.renderer.setClearColor(prevClearColor, prevClearAlpha)
      this.transformHelper.visible = helperWasVisible
      if (this.selectionBox) this.selectionBox.visible = boxWasVisible
      this.brushCursor.group.visible = cursorWasVisible
      this.renderer.render(this.scene, this.camera)
    }
  }

  private animate = (now: number) => {
    this.frameId = requestAnimationFrame(this.animate)
    if (this.windEnabled) {
      foliageWind.uWindTime.value = now * 0.001
      foliageWind.uWindStrength.value = 0.078
    } else {
      foliageWind.uWindStrength.value = 0
    }
    this.controls.update()
    this.updateLods()
    this.renderer.render(this.scene, this.camera)
    this.frames++
    if (now - this.stamp >= 650) {
      this.cb.onStats?.(
        this.frames * 1000 / (now - this.stamp),
        this.renderer.info.render.calls,
        this.renderer.info.render.triangles,
      )
      this.frames = 0
      this.stamp = now
    }
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    this.observer.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove)
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp)
    this.renderer.domElement.removeEventListener('pointercancel', this.onCancelActiveInteraction)
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored)
    window.removeEventListener('pointerup', this.onWindowPointerUp)
    window.removeEventListener('blur', this.onCancelActiveInteraction)
    window.removeEventListener('pagehide', this.onPageHide)
    this.brushCursor.dispose()
    this.transform.detach()
    this.transform.dispose()
    this.controls.dispose()
    if (this.selectionBox) this.selectionBox.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

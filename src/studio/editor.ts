// SpeedTree-inspired Branch Node Editor + Upgraded Crown Envelope Sculptor.
//
// Two cohesive editing sub-modes:
// 1. 'nodes' (SpeedTree Mode, default on trees):
//    - Direct click-to-select any trunk, primary limb, secondary branch or dead stub in 3D
//    - Iconic on-branch SpeedTree concentric radial arc gizmo (SVG locked to 3D branch pivot & tangent):
//        * length  — 长度 (绝对量) [signature gold axis block with dual crimson arrows]
//        * pitch   — 仰角 / 抬升   [wide outer white curved ribbon arc]
//        * yaw     — 旋转 (方位)   [middle concentric white curved ribbon arc]
//        * gravity — 弯曲 / 重力   [inner concentric white curved ribbon arc]
//        * radius  — 粗细 (半径)   [right-shoulder concentric white curved ribbon arc]
//    - 4 direct 3D spline control pins along the selected branch for hand-sculpted S-curves & arches
//    - Live SpeedTree dark parameter tooltip + top-left Selected-Node stats callback
//    - Per-branch foliage toggle (bare), cascading prune (Delete), and 30-step Undo (Ctrl+Z)
// 2. 'crown' (Upgraded Crown Envelope & Bare-Zone Sculpt Mode):
//    - Clean delicate envelope cage + tethered shape handles + bare-zone spheres
//
// Pointer events on gizmos/handles capture before OrbitControls so drags never rotate the camera,
// while dragging elsewhere on the canvas still orbits freely.
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, Object3D, Plane, Raycaster, SphereGeometry,
  TubeGeometry, Vector2, Vector3,
} from 'three'
import type { Viewer } from '../viewport'
import { CrownEnvelope } from '../tree/envelope'
import { buildSkeleton, type Branch, type BranchRole, type Skeleton } from '../tree/skeleton'
import type { BranchEdit, CrownHandle, TreeSpec, XYZ } from '../tree/spec'
import { estimateBranchTriangles } from '../tree/wood'

export type EditMode = 'select' | 'add-shape' | 'add-bare'
export type EditSubMode = 'nodes' | 'crown'
export type GizmoKind = 'length' | 'pitch' | 'yaw' | 'gravity' | 'radius'

export interface SelectedBranchInfo {
  id: number
  role: BranchRole
  level: number
  label: string
  partLabel?: string
  length: number
  rootRadius: number
  triangles: number
  descendants: number
  totalBones: number
  bare: boolean
  edit: Required<Pick<BranchEdit, 'id' | 'lengthScale' | 'radiusScale' | 'pitchDelta' | 'yawDelta' | 'gravityDelta' | 'bare' | 'pruned'>> & {
    spineOffsets: XYZ[]
  }
}

export interface PickablePart {
  partId: string
  label?: string
  skeleton: Skeleton
  matrixWorld: Matrix4
  group?: Object3D
}

export interface EditorHost {
  spec(): TreeSpec
  axis(): Vector3
  skeleton?(): Skeleton | undefined
  partLabel?(): string | undefined
  setHandles(handles: CrownHandle[], final: boolean): void
  setBranchEdits?(edits: BranchEdit[], final: boolean): void
  selected(handle: CrownHandle | undefined): void
  selectedBranch?(info: SelectedBranchInfo | undefined): void
  onStateChange?(): void
  otherParts?(): PickablePart[]
  focusPart?(partId: string): void
}

interface UndoEntry {
  branchEdits: BranchEdit[]
  handles: CrownHandle[]
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const SPLINE_TS = [.25, .5, .75, 1] as const
const v3 = (a: XYZ) => new Vector3(...a)
const xyz = (v: Vector3): XYZ => [v.x, v.y, v.z]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const cloneEdits = (edits: BranchEdit[] | undefined): BranchEdit[] =>
  (edits ?? []).map(e => ({ ...e, ...(e.spineOffsets ? { spineOffsets: e.spineOffsets.map(p => [...p] as XYZ) } : {}) }))
const cloneHandles = (handles: CrownHandle[]): CrownHandle[] =>
  handles.map(h => ({ ...h, anchor: [...h.anchor] as XYZ, offset: [...h.offset] as XYZ }))

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

/** Crisp annular curved ribbon arc path in local gizmo space (0 deg = +X, -90 deg = -Y / branch axis). */
function arcRibbonPath(rIn: number, rOut: number, deg0: number, deg1: number): string {
  const a0 = deg0 * Math.PI / 180
  const a1 = deg1 * Math.PI / 180
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0
  const x0o = (Math.cos(a0) * rOut).toFixed(2), y0o = (Math.sin(a0) * rOut).toFixed(2)
  const x1o = (Math.cos(a1) * rOut).toFixed(2), y1o = (Math.sin(a1) * rOut).toFixed(2)
  const x1i = (Math.cos(a1) * rIn).toFixed(2), y1i = (Math.sin(a1) * rIn).toFixed(2)
  const x0i = (Math.cos(a0) * rIn).toFixed(2), y0i = (Math.sin(a0) * rIn).toFixed(2)
  return `M ${x0o} ${y0o} A ${rOut} ${rOut} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rIn} ${rIn} 0 ${large} 0 ${x0i} ${y0i} Z`
}

function branchRoleLabel(b: Branch): string {
  if (b.role === 'trunk') return `树干 #${b.id}`
  if (b.role === 'limb') return `一级主枝 #${b.id}`
  if (b.role === 'dead') return `枯枝 #${b.id}`
  return `${b.level === 2 ? '二级' : `${b.level}级`}侧枝 #${b.id}`
}

function distToSegment2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): { dist: number; t: number } {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  const t = lenSq > 1e-6 ? clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1) : 0
  return { dist: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t }
}

function normalizeEdit(id: number, raw?: BranchEdit) {
  const offs: XYZ[] = SPLINE_TS.map((_, i) => {
    const p = raw?.spineOffsets?.[i]
    return p ? [p[0], p[1], p[2]] : [0, 0, 0]
  })
  return {
    id,
    lengthScale: raw?.lengthScale ?? 1,
    radiusScale: raw?.radiusScale ?? 1,
    pitchDelta: raw?.pitchDelta ?? 0,
    yawDelta: raw?.yawDelta ?? 0,
    gravityDelta: raw?.gravityDelta ?? 0,
    bare: Boolean(raw?.bare),
    pruned: Boolean(raw?.pruned),
    spineOffsets: offs,
  }
}

function compactEdit(e: ReturnType<typeof normalizeEdit>): BranchEdit | undefined {
  const out: BranchEdit = { id: e.id }
  if (Math.abs(e.lengthScale - 1) > 1e-4) out.lengthScale = Number(e.lengthScale.toFixed(3))
  if (Math.abs(e.radiusScale - 1) > 1e-4) out.radiusScale = Number(e.radiusScale.toFixed(3))
  if (Math.abs(e.pitchDelta) > 1e-3) out.pitchDelta = Number(e.pitchDelta.toFixed(2))
  if (Math.abs(e.yawDelta) > 1e-3) out.yawDelta = Number(e.yawDelta.toFixed(2))
  if (Math.abs(e.gravityDelta) > 1e-4) out.gravityDelta = Number(e.gravityDelta.toFixed(3))
  if (e.spineOffsets.some(o => o[0] * o[0] + o[1] * o[1] + o[2] * o[2] > 1e-7)) {
    out.spineOffsets = e.spineOffsets.map(([x, y, z]) => [Number(x.toFixed(3)), Number(y.toFixed(3)), Number(z.toFixed(3))] as XYZ)
  }
  if (e.bare) out.bare = true
  if (e.pruned && e.id !== 0) out.pruned = true
  return Object.keys(out).length > 1 ? out : undefined
}

const GIZMO_LABELS: Record<GizmoKind, string> = {
  length: '长度 (绝对量)',
  pitch: '仰角 (抬升)',
  yaw: '旋转 (方位)',
  gravity: '弯曲 (重力)',
  radius: '粗细 (半径)',
}

export class CrownEditor {
  readonly group = new Group()
  enabled = false
  subMode: EditSubMode = 'nodes'
  mode: EditMode = 'select'
  showGuides = true
  selectedId: number | undefined
  selectedBranchId: number | undefined
  hoveredBranchId: number | undefined

  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()

  // Crown sculpt 3D meshes (delicate clean styling)
  private readonly crownGroup = new Group()
  private readonly wire = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#3b7d5a', transparent: true, opacity: .28, depthTest: false }))
  private readonly shell = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: '#7fc79b', transparent: true, opacity: .035, side: DoubleSide, depthWrite: false }))
  private readonly handleMeshes = new Group()
  private readonly knobGeo = new SphereGeometry(1, 16, 12)
  private readonly zoneGeo = new SphereGeometry(1, 20, 14)
  private readonly matShape = new MeshBasicMaterial({ color: '#ff9038', depthTest: false })
  private readonly matSelected = new MeshBasicMaterial({ color: '#ffe033', depthTest: false })
  private readonly matBare = new MeshBasicMaterial({ color: '#e0564f', depthTest: false })
  private readonly matLine = new LineBasicMaterial({ color: '#d47c34', depthTest: false })
  private readonly matZoneShape = new MeshBasicMaterial({ color: '#ffb347', wireframe: true, transparent: true, opacity: .10, depthTest: false })
  private readonly matZoneBare = new MeshBasicMaterial({ color: '#e0564f', wireframe: true, transparent: true, opacity: .34, depthTest: false })

  // Node edit 3D guides & selection highlight
  private readonly nodeGroup = new Group()
  private readonly guideLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#d89f30', transparent: true, opacity: .30, depthTest: false }))
  private readonly hoverLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#fff2a6', transparent: true, opacity: .82, depthTest: false }))
  private readonly selectLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#ffca28', transparent: true, opacity: 1, depthTest: false }))
  private readonly selectTubeMat = new MeshBasicMaterial({ color: '#ffd23d', transparent: true, opacity: .24, depthTest: false, depthWrite: false })
  private selectTube?: Mesh

  // SpeedTree Crisp Vector Gizmo Overlay (SVG + Tooltip locked to 3D branch pivot)
  private readonly overlay: HTMLDivElement
  private readonly svg: SVGSVGElement
  private readonly gizmoG: SVGGElement
  private readonly splineG: SVGGElement
  private readonly tooltip: HTMLDivElement
  private readonly hoverBadge: HTMLDivElement
  private readonly gizmoEls = new Map<GizmoKind, SVGElement>()
  private readonly splineEls: SVGCircleElement[] = []
  private readonly rootDot: SVGCircleElement
  private hoveredGizmo?: GizmoKind | `spline-${number}`

  // Interaction state
  private dragCrown?: { id: number; plane: Plane; grab: Vector3 }
  private dragHandles?: CrownHandle[]
  private dragGizmo?: {
    kind: GizmoKind
    branchId: number
    startX: number
    startY: number
    dir2: [number, number]
    perp2: [number, number]
    startEdit: ReturnType<typeof normalizeEdit>
    snapshot: UndoEntry
    moved: boolean
  }
  private dragSpline?: {
    branchId: number
    index: number
    plane: Plane
    grab: Vector3
    startLocal: Vector3
    startEdit: ReturnType<typeof normalizeEdit>
    snapshot: UndoEntry
    moved: boolean
  }
  private clickCandidate?: { x: number; y: number }
  private cachedSkeleton?: Skeleton
  private lastCamSig = ''
  private pivotScreen = { x: 0, y: 0, angleDeg: 0, dir2: [0, -1] as [number, number], perp2: [1, 0] as [number, number], visible: false }
  private splineScreens: { x: number; y: number }[] = []
  private readonly undoStack: UndoEntry[] = []
  private readonly removeRenderListener: () => void

  constructor(private readonly viewer: Viewer, private readonly host: EditorHost) {
    this.group.name = 'crown-editor'
    this.wire.renderOrder = 998
    this.crownGroup.add(this.shell, this.wire, this.handleMeshes)
    this.guideLines.renderOrder = 994
    this.hoverLine.renderOrder = 997
    this.selectLine.renderOrder = 999
    this.hoverLine.visible = false
    this.selectLine.visible = false
    this.nodeGroup.add(this.guideLines, this.hoverLine, this.selectLine)
    this.group.add(this.crownGroup, this.nodeGroup)
    this.group.visible = false
    viewer.scene.add(this.group)

    // Mount SpeedTree SVG Gizmo Overlay inside .stage (parent of #canvas)
    const stage = viewer.host.parentElement ?? viewer.host
    this.overlay = document.createElement('div')
    this.overlay.className = 'st-gizmo-layer'
    this.overlay.hidden = true

    this.svg = svgEl('svg', { class: 'st-gizmo-svg' })
    this.splineG = svgEl('g', { class: 'st-spline-group' })
    this.rootDot = svgEl('circle', { class: 'st-root-pin', r: 4, cx: -100, cy: -100 })
    this.splineG.append(this.rootDot)
    for (let i = 0; i < SPLINE_TS.length; i++) {
      const c = svgEl('circle', { class: 'st-spline-pin', r: 6, cx: -100, cy: -100, 'data-spline': i })
      c.addEventListener('pointerenter', () => {
        this.hoveredGizmo = `spline-${i}`
        this.updateTooltip()
      })
      c.addEventListener('pointerleave', () => {
        if (this.hoveredGizmo === `spline-${i}`) { this.hoveredGizmo = undefined; this.updateTooltip() }
      })
      c.addEventListener('pointerdown', e => this.onSplineDown(e, i))
      this.splineEls.push(c)
      this.splineG.append(c)
    }

    // Iconic SpeedTree concentric arc gizmo (centered at 0,0, -Y = along branch tangent)
    this.gizmoG = svgEl('g', { class: 'st-radial-gizmo' })
    const makeHandle = (kind: GizmoKind, el: SVGElement) => {
      el.classList.add('st-handle', `st-handle-${kind}`)
      el.setAttribute('data-gizmo', kind)
      el.addEventListener('pointerenter', () => {
        this.hoveredGizmo = kind
        this.syncGizmoActiveClasses()
        this.updateTooltip()
      })
      el.addEventListener('pointerleave', () => {
        if (this.hoveredGizmo === kind) {
          this.hoveredGizmo = undefined
          this.syncGizmoActiveClasses()
          this.updateTooltip()
        }
      })
      el.addEventListener('pointerdown', e => this.onGizmoDown(e, kind))
      this.gizmoEls.set(kind, el)
      this.gizmoG.append(el)
    }

    // 1. Wide outer curved white ribbon: Pitch / Elevation (matches SpeedTree main curved arc!)
    makeHandle('pitch', svgEl('path', { d: arcRibbonPath(42, 54, -158, -22) }))
    // 2. Middle left concentric white ribbon: Yaw / Azimuth Rotate
    makeHandle('yaw', svgEl('path', { d: arcRibbonPath(61, 71, -156, -104) }))
    // 3. Inner/upper left concentric white ribbon: Gravity / Bend
    makeHandle('gravity', svgEl('path', { d: arcRibbonPath(78, 86, -148, -112) }))
    // 4. Right shoulder concentric white ribbon: Radius / Thickness
    makeHandle('radius', svgEl('path', { d: arcRibbonPath(61, 71, -74, -26) }))
    // 5. Iconic SpeedTree bright gold axis handle: Length (绝对量) right on top of arc crest!
    const lenGroup = svgEl('g', { class: 'st-length-group' })
    lenGroup.append(
      svgEl('rect', { class: 'st-length-box', x: -9.5, y: -64, width: 19, height: 27, rx: 2.5 }),
      // Upper crimson outward chevron
      svgEl('polygon', { class: 'st-length-arrow', points: '0,-61 -4.2,-55.2 4.2,-55.2' }),
      // Lower crimson inward chevron
      svgEl('polygon', { class: 'st-length-arrow', points: '0,-40 -4.2,-45.8 4.2,-45.8' }),
      // Center pivot dot
      svgEl('circle', { class: 'st-length-dot', cx: 0, cy: -50.5, r: 2 }),
    )
    makeHandle('length', lenGroup)

    this.svg.append(this.gizmoG, this.splineG)

    this.tooltip = document.createElement('div')
    this.tooltip.className = 'st-gizmo-tip'
    this.tooltip.hidden = true

    this.hoverBadge = document.createElement('div')
    this.hoverBadge.className = 'st-hover-badge'
    this.hoverBadge.hidden = true

    this.overlay.append(this.svg, this.tooltip, this.hoverBadge)
    stage.append(this.overlay)

    const el = viewer.renderer.domElement
    el.addEventListener('pointerdown', this.onCanvasDown, { capture: true })
    el.addEventListener('pointermove', this.onCanvasHover)
    el.addEventListener('pointerleave', this.onCanvasLeave)
    window.addEventListener('pointermove', this.onWindowMove)
    window.addEventListener('pointerup', this.onWindowUp)
    window.addEventListener('keydown', this.onKeyDown)
    this.removeRenderListener = viewer.addRenderListener(this.onFrameSync)
  }

  private get isGroundKind() {
    const k = this.host.spec().kind
    return k === 'grass' || k === 'fern' || k === 'flowerbed'
  }

  private currentSkeleton(): Skeleton {
    const ext = this.host.skeleton?.()
    if (ext) { this.cachedSkeleton = ext; return ext }
    if (!this.cachedSkeleton) this.cachedSkeleton = buildSkeleton(this.host.spec())
    return this.cachedSkeleton
  }

  private snapshot(): UndoEntry {
    const s = this.host.spec()
    return { branchEdits: cloneEdits(s.branchEdits), handles: cloneHandles(s.handles) }
  }

  private pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > 30) this.undoStack.shift()
    this.host.onStateChange?.()
  }

  canUndo() { return this.undoStack.length > 0 }

  undo(): boolean {
    const prev = this.undoStack.pop()
    if (!prev) return false
    if (this.host.setBranchEdits) this.host.setBranchEdits(prev.branchEdits, true)
    this.host.setHandles(prev.handles, true)
    this.host.onStateChange?.()
    this.refresh()
    return true
  }

  setEnabled(on: boolean) {
    this.enabled = on
    this.group.visible = on
    this.overlay.hidden = !on || this.subMode !== 'nodes'
    if (!on) {
      this.setMode('select')
      this.hoveredBranchId = undefined
      this.hoverBadge.hidden = true
      this.tooltip.hidden = true
    } else {
      // Auto-select crown sculpt on ground plants; SpeedTree node mode on trees (auto-selecting trunk for instant gizmo!)
      if (this.isGroundKind) {
        this.subMode = 'crown'
      } else if (this.subMode === 'nodes' && this.selectedBranchId === undefined) {
        const sk = this.currentSkeleton()
        if (sk.branches.length > 0) this.selectedBranchId = sk.branches[0].id
      }
    }
    this.refresh()
    this.host.onStateChange?.()
  }

  setSubMode(sub: EditSubMode) {
    if (sub === 'nodes' && this.isGroundKind) sub = 'crown'
    this.subMode = sub
    this.setMode('select')
    this.overlay.hidden = !this.enabled || sub !== 'nodes'
    if (sub === 'nodes' && this.enabled && this.selectedBranchId === undefined) {
      const sk = this.currentSkeleton()
      if (sk.branches.length > 0) this.selectedBranchId = sk.branches[0].id
    }
    this.refresh()
    this.host.onStateChange?.()
  }

  setShowGuides(on: boolean) {
    this.showGuides = on
    this.guideLines.visible = on && this.subMode === 'nodes'
  }

  setMode(mode: EditMode) {
    this.mode = mode
    if (mode !== 'select' && this.subMode !== 'crown') {
      this.subMode = 'crown'
      this.overlay.hidden = true
      this.refresh()
      this.host.onStateChange?.()
    }
    this.viewer.renderer.domElement.style.cursor = mode === 'select' ? '' : 'crosshair'
  }

  selectBranch(id: number | undefined) {
    this.selectedBranchId = id
    this.hoveredGizmo = undefined
    this.hoverBadge.hidden = true
    this.refresh()
    this.host.onStateChange?.()
  }

  cycleBranch(step: 1 | -1) {
    const sk = this.currentSkeleton()
    if (!sk.branches.length) return
    const idx = sk.branches.findIndex(b => b.id === this.selectedBranchId)
    const nextIdx = idx < 0 ? 0 : (idx + step + sk.branches.length) % sk.branches.length
    this.selectBranch(sk.branches[nextIdx].id)
  }

  getSelectedBranchInfo(): SelectedBranchInfo | undefined {
    if (this.selectedBranchId === undefined) return undefined
    const sk = this.currentSkeleton()
    const branch = sk.branches.find(b => b.id === this.selectedBranchId)
    if (!branch) return undefined
    const spec = this.host.spec()
    const raw = spec.branchEdits?.find(e => e.id === branch.id)
    const edit = normalizeEdit(branch.id, raw)
    // Count direct & indirect surviving descendants
    const desc = new Set<number>()
    for (const b of sk.branches) {
      if (b.parentId === branch.id || (b.parentId !== undefined && desc.has(b.parentId))) desc.add(b.id)
    }
    return {
      id: branch.id,
      role: branch.role,
      level: branch.level,
      label: branchRoleLabel(branch),
      partLabel: this.host.partLabel?.(),
      length: branch.length,
      rootRadius: branch.rootRadius,
      triangles: estimateBranchTriangles(branch, spec.optimize.woodDetail, spec.kind === 'palm', spec.palm.ringCount),
      descendants: desc.size,
      totalBones: 1 + desc.size,
      bare: Boolean(branch.bare || edit.bare),
      edit,
    }
  }

  /** Apply a partial update to the currently selected branch edit (used by panel sliders & action buttons). */
  updateSelectedBranch(patch: Partial<Omit<BranchEdit, 'id'>>, final = true, recordUndo = true) {
    if (this.selectedBranchId === undefined || !this.host.setBranchEdits) return
    const id = this.selectedBranchId
    if (recordUndo) this.pushUndo(this.snapshot())
    const spec = this.host.spec()
    const cur = normalizeEdit(id, spec.branchEdits?.find(e => e.id === id))
    const merged = {
      ...cur,
      ...patch,
      spineOffsets: patch.spineOffsets ? patch.spineOffsets.map(p => [...p] as XYZ) : cur.spineOffsets,
    }
    this.commitBranchEdit(merged, final)
  }

  private commitBranchEdit(nextNorm: ReturnType<typeof normalizeEdit>, final: boolean) {
    if (!this.host.setBranchEdits) return
    const spec = this.host.spec()
    const others = cloneEdits(spec.branchEdits).filter(e => e.id !== nextNorm.id)
    const compacted = compactEdit(nextNorm)
    if (compacted) others.push(compacted)
    this.host.setBranchEdits(others, final)
  }

  toggleSelectedBare() {
    const info = this.getSelectedBranchInfo()
    if (!info) return
    this.updateSelectedBranch({ bare: !info.edit.bare }, true, true)
  }

  pruneSelectedBranch() {
    const info = this.getSelectedBranchInfo()
    if (!info || info.role === 'trunk') return
    this.updateSelectedBranch({ pruned: true }, true, true)
    // Select parent cleanly after pruning
    const sk = this.currentSkeleton()
    const pruned = sk.branches.find(b => b.id === info.id)
    this.selectedBranchId = pruned?.parentId ?? 0
    this.host.onStateChange?.()
  }

  resetSelectedBranch() {
    if (this.selectedBranchId === undefined || !this.host.setBranchEdits) return
    const id = this.selectedBranchId
    const spec = this.host.spec()
    if (!spec.branchEdits?.some(e => e.id === id)) return
    this.pushUndo(this.snapshot())
    const next = cloneEdits(spec.branchEdits).filter(e => e.id !== id)
    this.host.setBranchEdits(next, true)
  }

  resetAllBranches() {
    if (!this.host.setBranchEdits) return
    const spec = this.host.spec()
    if (!spec.branchEdits?.length) return
    this.pushUndo(this.snapshot())
    this.host.setBranchEdits([], true)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName
    if (!this.enabled || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (this.undo()) e.preventDefault()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.subMode === 'nodes') this.pruneSelectedBranch()
      else this.removeSelected()
    } else if (e.key === 'Escape') {
      this.setMode('select')
      if (this.subMode === 'nodes') this.selectBranch(undefined)
    }
  }

  private envelope(spec = this.host.spec()) { return new CrownEnvelope(spec, this.host.axis()) }

  private clearHandleMeshes() {
    for (const child of [...this.handleMeshes.children]) {
      this.handleMeshes.remove(child)
      const geo = (child as Mesh | LineSegments).geometry
      if (geo && geo !== this.knobGeo && geo !== this.zoneGeo) geo.dispose()
    }
  }

  private clearSelectTube() {
    if (this.selectTube) {
      this.nodeGroup.remove(this.selectTube)
      this.selectTube.geometry.dispose()
      this.selectTube = undefined
    }
  }

  /** Rebuild 3D guides, crown handles, and SpeedTree SVG gizmos from current spec & skeleton. */
  refresh(handles = this.dragHandles ?? this.host.spec().handles) {
    this.cachedSkeleton = this.host.skeleton?.()
    if (!this.enabled) return
    const spec = { ...this.host.spec(), handles }
    if (this.isGroundKind && this.subMode === 'nodes') this.subMode = 'crown'

    this.crownGroup.visible = this.subMode === 'crown'
    this.nodeGroup.visible = this.subMode === 'nodes'
    this.overlay.hidden = this.subMode !== 'nodes'

    if (this.subMode === 'crown') {
      this.refreshCrown(spec, handles)
      this.host.selectedBranch?.(undefined)
    } else {
      this.refreshNodes()
    }
    this.group.updateMatrixWorld(true)
    this.syncOverlayGeometry(true)
  }

  private refreshCrown(spec: TreeSpec, handles: CrownHandle[]) {
    const env = this.envelope(spec)
    const U = 16, V = 28
    const grid: Vector3[][] = []
    for (let i = 0; i <= U; i++) {
      const row: Vector3[] = []
      for (let j = 0; j < V; j++) row.push(env.deform(env.surface(i / U, j / V * Math.PI * 2)))
      grid.push(row)
    }
    const lines: number[] = [], tris: number[] = [], pos: number[] = []
    grid.forEach(row => row.forEach(p => pos.push(p.x, p.y, p.z)))
    const id = (i: number, j: number) => i * V + (j % V)
    for (let i = 0; i <= U; i++) for (let j = 0; j < V; j++) {
      if (i % 4 === 0) lines.push(id(i, j), id(i, j + 1))
      if (j % 4 === 0 && i < U) lines.push(id(i, j), id(i + 1, j))
      if (i < U) tris.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
    }
    for (const mesh of [this.wire, this.shell]) {
      mesh.geometry.dispose()
      mesh.geometry = new BufferGeometry()
      mesh.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3))
      mesh.geometry.setIndex(mesh === this.wire ? lines : tris)
    }
    this.shell.geometry.computeBoundingSphere()

    this.clearHandleMeshes()
    const size = Math.max(.05, spec.trunk.height * .017)
    for (const h of handles) {
      const selected = h.id === this.selectedId
      const at = h.kind === 'shape' ? v3(h.anchor).add(v3(h.offset)) : v3(h.anchor)
      const knob = new Mesh(this.knobGeo, h.kind === 'bare' ? this.matBare : selected ? this.matSelected : this.matShape)
      knob.position.copy(at)
      knob.scale.setScalar(size * (selected ? 1.38 : 1))
      knob.renderOrder = 1000
      knob.userData.handleId = h.id
      this.handleMeshes.add(knob)
      if (h.kind === 'shape') {
        const anchorPt = v3(h.anchor)
        if (at.distanceToSquared(anchorPt) > 1e-6) {
          const g = new BufferGeometry().setFromPoints([anchorPt, at])
          const line = new LineSegments(g, this.matLine)
          line.renderOrder = 999
          this.handleMeshes.add(line)
        }
      }
      if (h.kind === 'bare' || selected) {
        const zone = new Mesh(this.zoneGeo, h.kind === 'bare' ? this.matZoneBare : this.matZoneShape)
        zone.position.copy(at)
        zone.scale.setScalar(h.radius)
        zone.renderOrder = 997
        this.handleMeshes.add(zone)
      }
    }
  }

  private refreshNodes() {
    const sk = this.currentSkeleton()
    // Ensure selectedBranchId still exists (e.g. after seed/branchCount change)
    if (this.selectedBranchId !== undefined && !sk.branches.some(b => b.id === this.selectedBranchId)) {
      this.selectedBranchId = sk.branches[0]?.id
    }

    // Build subtle full-skeleton hairline guide geometry
    const guidePos: number[] = []
    for (const b of sk.branches) {
      const segs = b.role === 'trunk' ? 14 : b.level === 1 ? 8 : 4
      let prev = b.curve.getPoint(0)
      for (let i = 1; i <= segs; i++) {
        const cur = b.curve.getPoint(i / segs)
        guidePos.push(prev.x, prev.y, prev.z, cur.x, cur.y, cur.z)
        prev = cur
      }
    }
    this.guideLines.geometry.dispose()
    this.guideLines.geometry = new BufferGeometry()
    this.guideLines.geometry.setAttribute('position', new Float32BufferAttribute(guidePos, 3))
    this.guideLines.visible = this.showGuides

    // Selected branch centerline + glowing halo tube
    this.clearSelectTube()
    const sel = sk.branches.find(b => b.id === this.selectedBranchId)
    if (sel) {
      const pts = Array.from({ length: 24 }, (_, i) => sel.curve.getPoint(i / 23))
      this.selectLine.geometry.dispose()
      this.selectLine.geometry = new BufferGeometry().setFromPoints(pts)
      this.selectLine.visible = true

      const tubeRadius = Math.max(.016, (sel.rootRadius + sel.tipRadius) * .42)
      const tubeGeo = new TubeGeometry(sel.curve, 20, tubeRadius, 8, false)
      this.selectTube = new Mesh(tubeGeo, this.selectTubeMat)
      this.selectTube.renderOrder = 996
      this.nodeGroup.add(this.selectTube)
    } else {
      this.selectLine.visible = false
    }

    this.refreshHoverLine(sk)
    this.host.selectedBranch?.(this.getSelectedBranchInfo())
  }

  private refreshHoverLine(sk = this.currentSkeleton()) {
    const hov = this.hoveredBranchId !== undefined && this.hoveredBranchId !== this.selectedBranchId
      ? sk.branches.find(b => b.id === this.hoveredBranchId)
      : undefined
    if (hov) {
      const pts = Array.from({ length: 16 }, (_, i) => hov.curve.getPoint(i / 15))
      this.hoverLine.geometry.dispose()
      this.hoverLine.geometry = new BufferGeometry().setFromPoints(pts)
      this.hoverLine.visible = true
    } else {
      this.hoverLine.visible = false
    }
  }

  private projectLocalToStage(localPt: Vector3, matrixWorld = this.group.matrixWorld) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    const w = localPt.clone().applyMatrix4(matrixWorld)
    const p = w.project(this.viewer.camera)
    return {
      x: (p.x + 1) * .5 * rect.width,
      y: (1 - p.y) * .5 * rect.height,
      clientX: rect.left + (p.x + 1) * .5 * rect.width,
      clientY: rect.top + (1 - p.y) * .5 * rect.height,
      z: p.z,
    }
  }

  private onFrameSync = () => {
    if (!this.enabled || this.subMode !== 'nodes') return
    const cam = this.viewer.camera
    const sig = `${cam.position.x.toFixed(4)},${cam.position.y.toFixed(4)},${cam.position.z.toFixed(4)},${cam.zoom.toFixed(4)},${this.viewer.host.clientWidth}x${this.viewer.host.clientHeight}`
    if (sig !== this.lastCamSig) {
      this.lastCamSig = sig
      this.syncOverlayGeometry(false)
    }
  }

  /** Project selected branch pivot, screen tangent & 4 spline nodes into crisp SVG gizmo coordinates. */
  private syncOverlayGeometry(force = false) {
    if (!this.enabled || this.subMode !== 'nodes') {
      this.pivotScreen.visible = false
      return
    }
    const sk = this.currentSkeleton()
    const sel = sk.branches.find(b => b.id === this.selectedBranchId)
    if (!sel) {
      this.gizmoG.style.display = 'none'
      this.splineG.style.display = 'none'
      this.tooltip.hidden = true
      this.pivotScreen.visible = false
      return
    }
    this.group.updateMatrixWorld(true)
    const pivotT = sel.role === 'trunk' ? .38 : .26
    const pivotLocal = sel.curve.getPoint(pivotT)
    const tanLocal = sel.curve.getTangent(pivotT).normalize()
    const step = Math.max(.18, Math.min(.65, sel.length * .25))
    const p0 = this.projectLocalToStage(pivotLocal)
    const p1 = this.projectLocalToStage(pivotLocal.clone().addScaledVector(tanLocal, step))

    let dx = p1.x - p0.x, dy = p1.y - p0.y
    const len = Math.hypot(dx, dy)
    if (len < 3) { dx = 0; dy = -1 } else { dx /= len; dy /= len }
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI + 90

    this.pivotScreen = {
      x: p0.x, y: p0.y, angleDeg,
      dir2: [dx, dy],
      perp2: [-dy, dx],
      visible: true,
    }

    this.gizmoG.style.display = ''
    this.gizmoG.setAttribute('transform', `translate(${p0.x.toFixed(1)}, ${p0.y.toFixed(1)}) rotate(${angleDeg.toFixed(1)})`)

    // Project root anchor & 4 draggable spline nodes along selected branch
    this.splineG.style.display = ''
    const r0 = this.projectLocalToStage(sel.curve.getPoint(0))
    this.rootDot.setAttribute('cx', r0.x.toFixed(1))
    this.rootDot.setAttribute('cy', r0.y.toFixed(1))

    const spec = this.host.spec()
    const raw = spec.branchEdits?.find(e => e.id === sel.id)
    this.splineScreens = []
    for (let i = 0; i < SPLINE_TS.length; i++) {
      const sp = this.projectLocalToStage(sel.curve.getPoint(SPLINE_TS[i]))
      this.splineScreens.push({ x: sp.x, y: sp.y })
      const el = this.splineEls[i]
      el.setAttribute('cx', sp.x.toFixed(1))
      el.setAttribute('cy', sp.y.toFixed(1))
      const off = raw?.spineOffsets?.[i]
      const edited = Boolean(off && (off[0] * off[0] + off[1] * off[1] + off[2] * off[2] > 1e-6))
      el.classList.toggle('is-edited', edited)
      el.classList.toggle('is-active', this.dragSpline?.index === i || this.hoveredGizmo === `spline-${i}`)
    }

    if (force) this.syncGizmoActiveClasses()
    this.updateTooltip()
  }

  private syncGizmoActiveClasses() {
    const activeKind = this.dragGizmo?.kind ?? (this.hoveredGizmo && !this.hoveredGizmo.startsWith('spline-') ? this.hoveredGizmo as GizmoKind : undefined)
    for (const [k, el] of this.gizmoEls) {
      el.classList.toggle('is-active', activeKind === k)
    }
  }

  private updateTooltip() {
    const info = this.getSelectedBranchInfo()
    if (!this.enabled || this.subMode !== 'nodes' || !info || !this.pivotScreen.visible) {
      this.tooltip.hidden = true
      return
    }
    const { x, y, dir2, perp2 } = this.pivotScreen
    const e = info.edit

    // Active spline drag/hover tooltip
    const splineIdx = this.dragSpline ? this.dragSpline.index
      : this.hoveredGizmo?.startsWith('spline-') ? Number(this.hoveredGizmo.slice(7)) : -1
    if (splineIdx >= 0 && this.splineScreens[splineIdx]) {
      const off = e.spineOffsets[splineIdx]
      const fmtSign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
      this.tooltip.textContent = `样条节点 #${splineIdx + 1} · Δ(${fmtSign(off[0])}, ${fmtSign(off[1])}, ${fmtSign(off[2])}) m`
      this.tooltip.style.left = `${(this.splineScreens[splineIdx].x + 14).toFixed(1)}px`
      this.tooltip.style.top = `${(this.splineScreens[splineIdx].y - 12).toFixed(1)}px`
      this.tooltip.hidden = false
      return
    }

    // Active or hovered SpeedTree gizmo handle (default shows iconic "长度 (绝对量)" right beside gold handle!)
    const kind: GizmoKind = this.dragGizmo?.kind
      ?? (this.hoveredGizmo && !this.hoveredGizmo.startsWith('spline-') ? this.hoveredGizmo as GizmoKind : 'length')
    const fmtDeg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`
    let detail = ''
    switch (kind) {
      case 'length': detail = `${info.length.toFixed(2)} m (${e.lengthScale.toFixed(2)}×)`; break
      case 'pitch': detail = fmtDeg(e.pitchDelta); break
      case 'yaw': detail = fmtDeg(e.yawDelta); break
      case 'gravity': detail = `${e.gravityDelta >= 0 ? '+' : ''}${e.gravityDelta.toFixed(2)}`; break
      case 'radius': detail = `${e.radiusScale.toFixed(2)}×`; break
    }
    this.tooltip.textContent = `${GIZMO_LABELS[kind]} · ${detail}`
    // Anchor tooltip neatly to the right of the gold length grip (just like SpeedTree!)
    const tipX = x + dir2[0] * 48 + perp2[0] * 18 + 8
    const tipY = y + dir2[1] * 48 + perp2[1] * 18 - 10
    const maxW = Math.max(200, this.viewer.host.clientWidth - 190)
    const maxH = Math.max(120, this.viewer.host.clientHeight - 36)
    this.tooltip.style.left = `${clamp(tipX, 12, maxW).toFixed(1)}px`
    this.tooltip.style.top = `${clamp(tipY, 12, maxH).toFixed(1)}px`
    this.tooltip.hidden = false
  }

  /** Raycast other parts' 3D meshes in multi-part AI scenes (enables clicking dense bush mounds or grass tufts in 3D). */
  private pickOtherPartMeshAt(clientX: number, clientY: number): PickablePart | undefined {
    if (!this.host.otherParts) return undefined
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera)
    let best: { part: PickablePart; dist: number } | undefined
    for (const part of this.host.otherParts()) {
      if (!part.group) continue
      const hit = this.raycaster.intersectObject(part.group, true)[0]
      if (hit && (!best || hit.distance < best.dist)) best = { part, dist: hit.distance }
    }
    return best?.part
  }

  /** Pick the closest branch in screen space (checks active skeleton first, then optional other AI parts). */
  private pickBranchAt(clientX: number, clientY: number, includeOtherParts = false): { branch: Branch; partId?: string; partLabel?: string; dist: number } | undefined {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    const sx = clientX - rect.left, sy = clientY - rect.top
    const threshold = 18

    const scan = (sk: Skeleton, matrix: Matrix4, partId?: string, partLabel?: string) => {
      let best: { branch: Branch; partId?: string; partLabel?: string; score: number; dist: number; z: number } | undefined
      for (const b of sk.branches) {
        const samples = b.role === 'trunk' ? 12 : b.level === 1 ? 8 : 5
        let prev = this.projectLocalToStage(b.curve.getPoint(0), matrix)
        for (let i = 1; i <= samples; i++) {
          const cur = this.projectLocalToStage(b.curve.getPoint(i / samples), matrix)
          const { dist, t } = distToSegment2D(sx, sy, prev.x, prev.y, cur.x, cur.y)
          if (dist <= threshold) {
            const z = prev.z + (cur.z - prev.z) * t
            // Slight priority for trunk / primary limbs when overlapping background twigs at exact same pixel
            const roleBonus = b.role === 'trunk' ? -3.5 : b.role === 'limb' ? -2.0 : 0
            const score = dist + roleBonus + z * 2.5
            if (!best || score < best.score) best = { branch: b, partId, partLabel, score, dist, z }
          }
          prev = cur
        }
      }
      return best
    }

    this.group.updateMatrixWorld(true)
    const primary = scan(this.currentSkeleton(), this.group.matrixWorld)
    if (primary || !includeOtherParts || !this.host.otherParts) return primary

    let bestOther: ReturnType<typeof scan>
    for (const other of this.host.otherParts()) {
      const hit = scan(other.skeleton, other.matrixWorld, other.partId, other.label)
      if (hit && (!bestOther || hit.score < bestOther.score)) bestOther = hit
    }
    if (bestOther) return bestOther
    // Fallback for dense bushes / grass tufts: raycast visible 3D part meshes directly
    const meshPart = this.pickOtherPartMeshAt(clientX, clientY)
    if (meshPart && meshPart.skeleton.branches.length > 0) {
      return { branch: meshPart.skeleton.branches[0], partId: meshPart.partId, partLabel: meshPart.label, dist: 0 }
    }
    return undefined
  }

  private onGizmoDown(e: PointerEvent, kind: GizmoKind) {
    if (!this.enabled || this.subMode !== 'nodes' || e.button !== 0) return
    const info = this.getSelectedBranchInfo()
    if (!info) return
    e.stopImmediatePropagation()
    e.preventDefault()
    this.dragGizmo = {
      kind,
      branchId: info.id,
      startX: e.clientX,
      startY: e.clientY,
      dir2: [...this.pivotScreen.dir2],
      perp2: [...this.pivotScreen.perp2],
      startEdit: normalizeEdit(info.id, info.edit),
      snapshot: this.snapshot(),
      moved: false,
    }
    this.viewer.controls.enabled = false
    this.syncGizmoActiveClasses()
    this.updateTooltip()
  }

  private onSplineDown(e: PointerEvent, index: number) {
    if (!this.enabled || this.subMode !== 'nodes' || e.button !== 0) return
    const info = this.getSelectedBranchInfo()
    const sk = this.currentSkeleton()
    const branch = info ? sk.branches.find(b => b.id === info.id) : undefined
    if (!info || !branch) return
    e.stopImmediatePropagation()
    e.preventDefault()
    this.group.updateMatrixWorld(true)
    const startLocal = branch.curve.getPoint(SPLINE_TS[index]).clone()
    const startWorld = this.group.localToWorld(startLocal.clone())
    const normal = new Vector3()
    this.viewer.camera.getWorldDirection(normal)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, startWorld)
    const onPlane = new Vector3()
    this.ray(e).ray.intersectPlane(plane, onPlane)
    this.dragSpline = {
      branchId: info.id,
      index,
      plane,
      grab: startWorld.clone().sub(onPlane),
      startLocal,
      startEdit: normalizeEdit(info.id, info.edit),
      snapshot: this.snapshot(),
      moved: false,
    }
    this.viewer.controls.enabled = false
    this.syncOverlayGeometry(true)
  }

  private ray(e: PointerEvent) {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera)
    return this.raycaster
  }

  private onCanvasHover = (e: PointerEvent) => {
    if (!this.enabled || this.subMode !== 'nodes' || this.dragGizmo || this.dragSpline) return
    const hit = this.pickBranchAt(e.clientX, e.clientY, true)
    const nextHover = hit && !hit.partId ? hit.branch.id : undefined
    if (nextHover !== this.hoveredBranchId) {
      this.hoveredBranchId = nextHover
      this.refreshHoverLine()
    }
    if (hit && (hit.partId || hit.branch.id !== this.selectedBranchId)) {
      const rect = this.viewer.renderer.domElement.getBoundingClientRect()
      this.hoverBadge.textContent = hit.partId
        ? `点击切换单体 · ${hit.partLabel ?? hit.partId}`
        : `点击选中 · ${branchRoleLabel(hit.branch)}`
      this.hoverBadge.style.left = `${(e.clientX - rect.left + 14).toFixed(0)}px`
      this.hoverBadge.style.top = `${(e.clientY - rect.top - 10).toFixed(0)}px`
      this.hoverBadge.hidden = false
      this.viewer.renderer.domElement.style.cursor = 'pointer'
    } else {
      this.hoverBadge.hidden = true
      if (this.mode === 'select') this.viewer.renderer.domElement.style.cursor = ''
    }
  }

  private onCanvasLeave = () => {
    this.hoveredBranchId = undefined
    this.hoverLine.visible = false
    this.hoverBadge.hidden = true
  }

  private onCanvasDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return
    this.group.updateMatrixWorld(true)

    if (this.subMode === 'nodes') {
      // Allow free camera orbiting on drag; short click selects a branch in 3D!
      this.clickCandidate = { x: e.clientX, y: e.clientY }
      return
    }

    const ray = this.ray(e)
    const spec = this.host.spec()
    if (this.mode !== 'select') {
      const hit = ray.intersectObject(this.shell, false)[0]
      if (!hit) return
      e.stopImmediatePropagation()
      this.pushUndo(this.snapshot())
      const localPoint = this.group.worldToLocal(hit.point.clone())
      const env = this.envelope()
      const id = Math.max(0, ...spec.handles.map(h => h.id)) + 1
      const handle: CrownHandle = this.mode === 'add-shape'
        ? { id, kind: 'shape', anchor: xyz(localPoint), offset: [0, 0, 0], radius: env.width * .9 }
        : { id, kind: 'bare', anchor: xyz(localPoint), offset: [0, 0, 0], radius: env.width * .6 }
      this.selectedId = id
      this.setMode('select')
      this.host.setHandles([...spec.handles, handle], true)
      this.host.selected(handle)
      return
    }
    const knobs = this.handleMeshes.children.filter(c => c.userData.handleId !== undefined)
    const hit = ray.intersectObjects(knobs, false)[0]
    if (!hit) {
      // Allow short click on another part's mesh in Crown sub-mode to switch single-part focus
      if (this.host.otherParts && this.host.focusPart) this.clickCandidate = { x: e.clientX, y: e.clientY }
      return
    }
    e.stopImmediatePropagation()
    e.preventDefault()
    this.pushUndo(this.snapshot())
    const id = hit.object.userData.handleId as number
    this.selectedId = id
    const normal = new Vector3()
    this.viewer.camera.getWorldDirection(normal)
    const worldPos = hit.object.getWorldPosition(new Vector3())
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, worldPos)
    const onPlane = new Vector3()
    ray.ray.intersectPlane(plane, onPlane)
    this.dragCrown = { id, plane, grab: worldPos.clone().sub(onPlane) }
    this.dragHandles = cloneHandles(spec.handles)
    this.viewer.controls.enabled = false
    this.host.selected(spec.handles.find(h => h.id === id))
    this.refresh()
  }

  private onWindowMove = (e: PointerEvent) => {
    if (this.dragGizmo) {
      const d = this.dragGizmo
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (Math.hypot(dx, dy) > 1.5) d.moved = true
      const next = normalizeEdit(d.branchId, d.startEdit)
      switch (d.kind) {
        case 'length': {
          const proj = dx * d.dir2[0] + dy * d.dir2[1]
          next.lengthScale = clamp(d.startEdit.lengthScale + proj / 110, .25, 2.5)
          break
        }
        case 'pitch': {
          next.pitchDelta = clamp(d.startEdit.pitchDelta + (-dy) * .48, -65, 65)
          break
        }
        case 'yaw': {
          next.yawDelta = clamp(d.startEdit.yawDelta + dx * .65, -180, 180)
          break
        }
        case 'gravity': {
          next.gravityDelta = clamp(d.startEdit.gravityDelta + dy * .0085, -1.5, 1.5)
          break
        }
        case 'radius': {
          const proj = dx * d.perp2[0] + dy * d.perp2[1]
          next.radiusScale = clamp(d.startEdit.radiusScale + proj / 85, .3, 2.5)
          break
        }
      }
      this.commitBranchEdit(next, false)
      this.updateTooltip()
      return
    }

    if (this.dragSpline) {
      const ds = this.dragSpline
      const worldPt = new Vector3()
      if (!this.ray(e).ray.intersectPlane(ds.plane, worldPt)) return
      worldPt.add(ds.grab)
      this.group.updateMatrixWorld(true)
      const curLocal = this.group.worldToLocal(worldPt)
      const delta = curLocal.sub(ds.startLocal)
      if (delta.lengthSq() > 1e-6) ds.moved = true
      const next = normalizeEdit(ds.branchId, ds.startEdit)
      const baseOff = ds.startEdit.spineOffsets[ds.index]
      next.spineOffsets[ds.index] = [baseOff[0] + delta.x, baseOff[1] + delta.y, baseOff[2] + delta.z]
      this.commitBranchEdit(next, false)
      this.updateTooltip()
      return
    }

    if (this.dragCrown && this.dragHandles) {
      const worldPoint = new Vector3()
      if (!this.ray(e).ray.intersectPlane(this.dragCrown.plane, worldPoint)) return
      worldPoint.add(this.dragCrown.grab)
      this.group.updateMatrixWorld(true)
      const localPoint = this.group.worldToLocal(worldPoint)
      const h = this.dragHandles.find(x => x.id === this.dragCrown!.id)!
      if (h.kind === 'shape') h.offset = xyz(localPoint.sub(v3(h.anchor)))
      else h.anchor = xyz(localPoint)
      this.refresh()
      this.host.setHandles(this.dragHandles.map(x => ({ ...x })), false)
    }
  }

  private onWindowUp = (e: PointerEvent) => {
    if (this.dragGizmo) {
      const d = this.dragGizmo
      this.dragGizmo = undefined
      this.viewer.controls.enabled = true
      if (d.moved) {
        this.pushUndo(d.snapshot)
        const spec = this.host.spec()
        const cur = normalizeEdit(d.branchId, spec.branchEdits?.find(x => x.id === d.branchId))
        this.commitBranchEdit(cur, true)
      }
      this.syncGizmoActiveClasses()
      this.updateTooltip()
      return
    }

    if (this.dragSpline) {
      const ds = this.dragSpline
      this.dragSpline = undefined
      this.viewer.controls.enabled = true
      if (ds.moved) {
        this.pushUndo(ds.snapshot)
        const spec = this.host.spec()
        const cur = normalizeEdit(ds.branchId, spec.branchEdits?.find(x => x.id === ds.branchId))
        this.commitBranchEdit(cur, true)
      }
      this.syncOverlayGeometry(true)
      return
    }

    if (this.clickCandidate) {
      const cand = this.clickCandidate
      this.clickCandidate = undefined
      if (this.enabled && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) <= 5) {
        if (this.subMode === 'nodes') {
          const hit = this.pickBranchAt(e.clientX, e.clientY, true)
          if (hit) {
            if (hit.partId && this.host.focusPart) {
              this.host.focusPart(hit.partId)
            }
            this.selectBranch(hit.branch.id)
          } else {
            this.selectBranch(undefined)
          }
        } else if (this.host.focusPart) {
          const meshPart = this.pickOtherPartMeshAt(e.clientX, e.clientY)
          if (meshPart) this.host.focusPart(meshPart.partId)
        }
      }
    }

    if (!this.dragCrown || !this.dragHandles) return
    const handles = this.dragHandles
    this.dragCrown = undefined
    this.dragHandles = undefined
    this.viewer.controls.enabled = true
    this.host.setHandles(handles, true)
  }

  removeSelected() {
    const spec = this.host.spec()
    if (this.selectedId === undefined) return
    this.pushUndo(this.snapshot())
    this.host.setHandles(spec.handles.filter(h => h.id !== this.selectedId), true)
    this.selectedId = undefined
    this.host.selected(undefined)
  }

  /** Client-space position of a crown handle (used by automated UI checks). */
  screenPosition(id: number) {
    const h = this.host.spec().handles.find(x => x.id === id)
    if (!h) return undefined
    this.group.updateMatrixWorld(true)
    const local = h.kind === 'shape' ? v3(h.anchor).add(v3(h.offset)) : v3(h.anchor)
    const p = this.group.localToWorld(local).project(this.viewer.camera)
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height }
  }

  /** Client-space position of a branch sample point (for automated SpeedTree node edit checks). */
  branchScreen(id: number, t = .5) {
    const sk = this.currentSkeleton()
    const b = sk.branches.find(x => x.id === id)
    if (!b) return undefined
    this.group.updateMatrixWorld(true)
    const pt = this.projectLocalToStage(b.curve.getPoint(clamp(t, 0, 1)))
    return { x: pt.clientX, y: pt.clientY }
  }

  /** Client-space center point directly on an active SpeedTree gizmo handle or spline node pin (for E2E tests). */
  gizmoScreen(target: GizmoKind | `spline-${number}`) {
    if (!this.enabled || this.subMode !== 'nodes' || !this.pivotScreen.visible) return undefined
    this.syncOverlayGeometry(false)
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    if (target.startsWith('spline-')) {
      const sp = this.splineScreens[Number(target.slice(7))]
      return sp ? { x: rect.left + sp.x, y: rect.top + sp.y } : undefined
    }
    // Exact painted-ribbon local points (avoids hollow bounding-box centers of C-arcs)
    const polarPt = (r: number, deg: number): [number, number] => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r]
    const localPts: Record<GizmoKind, [number, number]> = {
      length: [0, -50.5],
      pitch: polarPt(48, -130),
      yaw: polarPt(66, -130),
      gravity: polarPt(82, -130),
      radius: polarPt(66, -50),
    }
    const [lx, ly] = localPts[target as GizmoKind]
    const rad = this.pivotScreen.angleDeg * Math.PI / 180
    const ca = Math.cos(rad), sa = Math.sin(rad)
    const sx = this.pivotScreen.x + lx * ca - ly * sa
    const sy = this.pivotScreen.y + lx * sa + ly * ca
    return { x: rect.left + sx, y: rect.top + sy }
  }

  dispose() {
    this.removeRenderListener()
    const el = this.viewer.renderer.domElement
    el.removeEventListener('pointerdown', this.onCanvasDown, { capture: true })
    el.removeEventListener('pointermove', this.onCanvasHover)
    el.removeEventListener('pointerleave', this.onCanvasLeave)
    window.removeEventListener('pointermove', this.onWindowMove)
    window.removeEventListener('pointerup', this.onWindowUp)
    window.removeEventListener('keydown', this.onKeyDown)
    this.clearHandleMeshes()
    this.clearSelectTube()
    this.wire.geometry.dispose(); this.wire.material.dispose()
    this.shell.geometry.dispose(); this.shell.material.dispose()
    this.guideLines.geometry.dispose(); this.guideLines.material.dispose()
    this.hoverLine.geometry.dispose(); this.hoverLine.material.dispose()
    this.selectLine.geometry.dispose(); this.selectLine.material.dispose()
    this.selectTubeMat.dispose()
    this.knobGeo.dispose(); this.zoneGeo.dispose()
    this.matShape.dispose(); this.matSelected.dispose(); this.matBare.dispose()
    this.matLine.dispose(); this.matZoneShape.dispose(); this.matZoneBare.dispose()
    this.overlay.remove()
    this.viewer.scene.remove(this.group)
  }
}

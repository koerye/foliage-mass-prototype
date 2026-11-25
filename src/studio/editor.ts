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
import { foliageNormalView } from '../broadleaf/leaf-material'
import type { Viewer } from '../viewport'
import { CrownEnvelope } from '../tree/envelope'
import {
  cloneLeafEditSpec, defaultLeafEditSpec, hasLeafEdits,
  type LeafBrushKind, type LeafBrushStroke, type LeafClumpEdit, type LeafEditSpec,
} from '../tree/leaf-edits'
import {
  buildNormalVectorsGeometry, cloneLeafNormalEdit, customNormalCenter, defaultLeafNormalEdit,
  type LeafNormalEditSpec, type LeafNormalMode, type NormalBrushKind, type NormalBrushStroke,
} from '../tree/leaf-normals'
import { buildSkeleton, hasGlobalBranchOffset, type Branch, type BranchRole, type Skeleton } from '../tree/skeleton'
import type { BranchEdit, CrownHandle, TreeSpec, XYZ } from '../tree/spec'
import { estimateBranchTriangles } from '../tree/wood'

export type EditMode = 'select' | 'add-shape' | 'add-bare'
export type EditSubMode = 'nodes' | 'crown' | 'leaves' | 'normals'
export type LeafTool = 'clump' | LeafBrushKind | 'erase'
export type NormalTool = 'center' | NormalBrushKind | 'erase'
export type GizmoKind = 'length' | 'pitch' | 'yaw' | 'gravity' | 'radius'

export interface SelectedBranchInfo {
  id: number
  role: BranchRole
  level: number
  label: string
  partLabel?: string
  length: number
  rootRadius: number
  socket: number
  baseSocket: number
  triangles: number
  descendants: number
  totalBones: number
  bare: boolean
  edit: Required<Pick<BranchEdit, 'id' | 'lengthScale' | 'radiusScale' | 'pitchDelta' | 'yawDelta' | 'gravityDelta' | 'socketDelta' | 'bare' | 'pruned'>> & {
    offset: XYZ
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
  foliageObject?(): Object3D | undefined
  partId?(): string | undefined
  partLabel?(): string | undefined
  canHandleShortcuts?(): boolean
  setHandles(handles: CrownHandle[], final: boolean): void
  setBranchEdits?(edits: BranchEdit[], final: boolean): void
  setLeafEdits?(next: LeafEditSpec | undefined, final: boolean): void
  setNormalEdit?(next: LeafNormalEditSpec, final: boolean): void
  selected(handle: CrownHandle | undefined): void
  selectedBranch?(info: SelectedBranchInfo | undefined): void
  onStateChange?(): void
  otherParts?(): PickablePart[]
  focusPart?(partId: string): void
}

interface UndoEntry {
  partId?: string
  branchEdits: BranchEdit[]
  handles: CrownHandle[]
  leafEdits?: LeafEditSpec
  normalEdit: LeafNormalEditSpec
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const SPLINE_TS = [.25, .5, .75, 1] as const
const v3 = (a: XYZ) => new Vector3(...a)
const xyz = (v: Vector3): XYZ => [v.x, v.y, v.z]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const cloneEdits = (edits: BranchEdit[] | undefined): BranchEdit[] =>
  (edits ?? []).map(e => ({
    ...e,
    ...(e.offset ? { offset: [...e.offset] as XYZ } : {}),
    ...(e.spineOffsets ? { spineOffsets: e.spineOffsets.map(p => [...p] as XYZ) } : {}),
  }))
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
  const ro = raw?.offset
  return {
    id,
    lengthScale: raw?.lengthScale ?? 1,
    radiusScale: raw?.radiusScale ?? 1,
    pitchDelta: raw?.pitchDelta ?? 0,
    yawDelta: raw?.yawDelta ?? 0,
    gravityDelta: raw?.gravityDelta ?? 0,
    socketDelta: raw?.socketDelta ?? 0,
    offset: (ro ? [ro[0], ro[1], ro[2]] : [0, 0, 0]) as XYZ,
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
  if (e.id !== 0 && Math.abs(e.socketDelta) > 1e-4) out.socketDelta = Number(e.socketDelta.toFixed(3))
  if (e.offset[0] * e.offset[0] + e.offset[1] * e.offset[1] + e.offset[2] * e.offset[2] > 1e-7) {
    out.offset = [Number(e.offset[0].toFixed(3)), Number(e.offset[1].toFixed(3)), Number(e.offset[2].toFixed(3))]
  }
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

function makeOrthoRingsGeo(segs = 36): BufferGeometry {
  const pos: number[] = []
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2
    const a1 = ((i + 1) / segs) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    // XY, XZ, YZ great-circle rings
    pos.push(c0, s0, 0, c1, s1, 0)
    pos.push(c0, 0, s0, c1, 0, s1)
    pos.push(0, c0, s0, 0, c1, s1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  return g
}

export class CrownEditor {
  readonly group = new Group()
  enabled = false
  subMode: EditSubMode = 'nodes'
  mode: EditMode = 'select'
  showGuides = true
  selectedId: number | undefined
  hoveredHandleId: number | undefined
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
  private readonly matBackShape = new MeshBasicMaterial({ color: '#c46c2b', transparent: true, opacity: .62, depthTest: false })
  private readonly matHover = new MeshBasicMaterial({ color: '#fff482', depthTest: false })
  private readonly matSelected = new MeshBasicMaterial({ color: '#ffe033', depthTest: false })
  private readonly matBare = new MeshBasicMaterial({ color: '#e0564f', depthTest: false })
  private readonly matLine = new LineBasicMaterial({ color: '#d47c34', depthTest: false })
  private readonly matZoneShape = new MeshBasicMaterial({ color: '#ffb347', wireframe: true, transparent: true, opacity: .10, depthTest: false })
  private readonly matZoneBare = new MeshBasicMaterial({ color: '#e0564f', wireframe: true, transparent: true, opacity: .34, depthTest: false })
  private lastHandleCycle?: { x: number; y: number; ids: number[]; idx: number }

  // Node edit 3D guides & selection highlight
  private readonly nodeGroup = new Group()
  private readonly guideLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#d89f30', transparent: true, opacity: .30, depthTest: false }))
  private readonly hoverLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#fff2a6', transparent: true, opacity: .82, depthTest: false }))
  private readonly selectLine = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#ffca28', transparent: true, opacity: 1, depthTest: false }))
  private readonly selectTubeMat = new MeshBasicMaterial({ color: '#ffd23d', transparent: true, opacity: .24, depthTest: false, depthWrite: false })
  private selectTube?: Mesh

  // Custom Leaf Normal Editor 3D visuals (RGB vector needles + draggable projection center + brush zones)
  normalTool: NormalTool = 'center'
  normalBrushRadius = 1.15
  normalBrushStrength = 0.72
  showNormalVectors = true
  normalDebugColor = false
  private readonly normalGroup = new Group()
  private readonly normalVectors = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .92, depthTest: false }))
  private readonly normalCenterMat = new MeshBasicMaterial({ color: '#22e3d4', depthTest: false })
  private readonly normalCenterKnob: Mesh
  private readonly normalCenterCross = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true, depthTest: false }))
  private readonly normalBrushZones = new Group()
  private readonly normalRingGeo = makeOrthoRingsGeo(36)
  private readonly normalBrushMat = new LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: .40, depthTest: false })
  private readonly normalCursorMesh: LineSegments
  private readonly normalCursorMat = new LineBasicMaterial({ color: '#22e3d4', transparent: true, opacity: .78, depthTest: false })
  private dragNormalCenter?: { plane: Plane; grab: Vector3; baseCenter: Vector3; startEdit: LeafNormalEditSpec; snapshot: UndoEntry; moved: boolean }
  private dragNormalBrush?: { strokeId: number; anchorLocal: Vector3; lastLocal: Vector3; snapshot: UndoEntry; isErase: boolean }

  // Direct 3D Leaf / Foliage Sculptor visuals (hand-placed leaf clumps + 3D foliage brushes)
  leafTool: LeafTool = 'clump'
  leafBrushRadius = 0.90
  leafBrushStrength = 0.72
  leafScaleSign: 1 | -1 = 1
  leafBrushColor = '#e68c2e'
  leafClumpRadius = 0.85
  leafClumpFlatten = 0.34
  selectedLeafClumpId: number | undefined
  private readonly leafGroup = new Group()
  private readonly leafClumpMeshes = new Group()
  private readonly leafBrushZones = new Group()
  private readonly matLeafClump = new MeshBasicMaterial({ color: '#22c55e', depthTest: false })
  private readonly matLeafClumpSelected = new MeshBasicMaterial({ color: '#fde047', depthTest: false })
  private readonly matLeafZone = new MeshBasicMaterial({ color: '#34d399', wireframe: true, transparent: true, opacity: .24, depthTest: false })
  private readonly matLeafZoneSel = new MeshBasicMaterial({ color: '#fde047', wireframe: true, transparent: true, opacity: .45, depthTest: false })
  private readonly matLeafBrushDensify = new LineBasicMaterial({ color: '#34d399', transparent: true, opacity: .45, depthTest: false })
  private readonly matLeafBrushPrune = new LineBasicMaterial({ color: '#f87171', transparent: true, opacity: .48, depthTest: false })
  private readonly matLeafBrushScale = new LineBasicMaterial({ color: '#fbbf24', transparent: true, opacity: .45, depthTest: false })
  private readonly matLeafBrushTint = new LineBasicMaterial({ color: '#f59e0b', transparent: true, opacity: .48, depthTest: false })
  private readonly leafCursorMesh: LineSegments
  private readonly leafCursorMat = new LineBasicMaterial({ color: '#34d399', transparent: true, opacity: .82, depthTest: false })
  private dragLeafClump?: { id: number; plane: Plane; grab: Vector3; snapshot: UndoEntry; moved: boolean }
  private dragLeafBrush?: { lastLocal: Vector3; snapshot: UndoEntry; changed: boolean }

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
  private hoveredGizmo?: GizmoKind | 'root' | `spline-${number}`

  // Interaction state
  private dragCrown?: { id: number; plane: Plane; grab: Vector3; startX: number; startY: number; snapshot: UndoEntry; moved: boolean }
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
  private dragRoot?: {
    branchId: number
    mode: 'slide' | 'offset'
    parentBranchId?: number
    baseSocket: number
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
  private rootScreen = { x: -100, y: -100 }
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
    this.normalCenterKnob = new Mesh(this.knobGeo, this.normalCenterMat)
    this.normalCenterKnob.renderOrder = 1002
    this.normalCenterKnob.userData.isNormalCenter = true
    this.normalVectors.renderOrder = 995
    this.normalCenterCross.renderOrder = 1001
    this.normalCursorMesh = new LineSegments(this.normalRingGeo, this.normalCursorMat)
    this.normalCursorMesh.renderOrder = 1000
    this.normalCursorMesh.visible = false
    this.normalGroup.add(this.normalVectors, this.normalBrushZones, this.normalCenterCross, this.normalCenterKnob, this.normalCursorMesh)
    this.normalGroup.visible = false
    this.leafCursorMesh = new LineSegments(this.normalRingGeo, this.leafCursorMat)
    this.leafCursorMesh.renderOrder = 1000
    this.leafCursorMesh.visible = false
    this.leafGroup.add(this.leafClumpMeshes, this.leafBrushZones, this.leafCursorMesh)
    this.leafGroup.visible = false
    this.group.add(this.crownGroup, this.nodeGroup, this.leafGroup, this.normalGroup)
    this.group.visible = false
    viewer.scene.add(this.group)

    // Mount SpeedTree SVG Gizmo Overlay inside .stage (parent of #canvas)
    const stage = viewer.host.parentElement ?? viewer.host
    this.overlay = document.createElement('div')
    this.overlay.className = 'st-gizmo-layer'
    this.overlay.hidden = true

    this.svg = svgEl('svg', { class: 'st-gizmo-svg' })
    this.splineG = svgEl('g', { class: 'st-spline-group' })
    this.rootDot = svgEl('circle', { class: 'st-root-pin', r: 6.5, cx: -100, cy: -100, 'data-gizmo': 'root' })
    this.rootDot.addEventListener('pointerenter', () => {
      this.hoveredGizmo = 'root'
      this.syncOverlayGeometry(false)
      this.updateTooltip()
    })
    this.rootDot.addEventListener('pointerleave', () => {
      if (this.hoveredGizmo === 'root') {
        this.hoveredGizmo = undefined
        this.syncOverlayGeometry(false)
        this.updateTooltip()
      }
    })
    this.rootDot.addEventListener('pointerdown', e => this.onRootDown(e))
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
    el.addEventListener('pointercancel', this.onCancelActiveDrag)
    window.addEventListener('pointermove', this.onWindowMove)
    window.addEventListener('pointerup', this.onWindowUp)
    window.addEventListener('blur', this.onCancelActiveDrag)
    window.addEventListener('keydown', this.onKeyDown)
    this.removeRenderListener = viewer.addRenderListener(this.onFrameSync)
  }

  /** Unwinds any active 3D drag across all 6 sub-machines and unlocks OrbitControls (prevents Alt+Tab / tool-switch lockups). */
  cancelActiveDrag() {
    const hadDrag = Boolean(
      this.dragCrown || this.dragGizmo || this.dragSpline || this.dragRoot
      || this.dragNormalCenter || this.dragNormalBrush
      || this.dragLeafClump || this.dragLeafBrush || this.clickCandidate,
    )
    this.dragCrown = undefined
    this.dragHandles = undefined
    this.dragGizmo = undefined
    this.dragSpline = undefined
    this.dragRoot = undefined
    this.dragNormalCenter = undefined
    this.dragNormalBrush = undefined
    this.dragLeafClump = undefined
    this.dragLeafBrush = undefined
    this.clickCandidate = undefined
    if (hadDrag) {
      this.viewer.controls.enabled = true
      this.tooltip.hidden = true
      this.refresh()
    }
  }

  private onCancelActiveDrag = () => {
    this.cancelActiveDrag()
  }

  private get isGroundKind() {
    const k = this.host.spec().kind
    return k === 'grass' || k === 'fern' || k === 'flowerbed' || k === 'bamboo' || k === 'lotus'
  }

  private currentSkeleton(): Skeleton {
    const ext = this.host.skeleton?.()
    if (ext) { this.cachedSkeleton = ext; return ext }
    if (!this.cachedSkeleton) this.cachedSkeleton = buildSkeleton(this.host.spec())
    return this.cachedSkeleton
  }

  private snapshot(): UndoEntry {
    const s = this.host.spec()
    return {
      partId: this.host.partId?.(),
      branchEdits: cloneEdits(s.branchEdits),
      handles: cloneHandles(s.handles),
      leafEdits: hasLeafEdits(s.leafEdits) ? cloneLeafEditSpec(s.leafEdits) : undefined,
      normalEdit: cloneLeafNormalEdit(s.normalEdit),
    }
  }

  private pushUndo(entry: UndoEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > 30) this.undoStack.shift()
    this.host.onStateChange?.()
  }

  canUndo() { return this.undoStack.length > 0 }

  clearUndo() {
    if (this.undoStack.length === 0) return
    this.undoStack.length = 0
    this.host.onStateChange?.()
  }

  undo(): boolean {
    const prev = this.undoStack.pop()
    if (!prev) return false
    if (prev.partId && this.host.partId && this.host.partId() !== prev.partId) {
      if (this.host.focusPart) this.host.focusPart(prev.partId)
      else return false
    }
    if (this.host.setBranchEdits) this.host.setBranchEdits(prev.branchEdits, true)
    if (this.host.setLeafEdits) this.host.setLeafEdits(prev.leafEdits, true)
    if (this.host.setNormalEdit) this.host.setNormalEdit(prev.normalEdit, true)
    this.host.setHandles(prev.handles, true)
    this.host.onStateChange?.()
    this.refresh()
    return true
  }

  setEnabled(on: boolean) {
    this.cancelActiveDrag()
    this.enabled = on
    this.group.visible = on
    this.overlay.hidden = !on || (this.subMode !== 'nodes' && this.subMode !== 'crown')
    this.svg.style.display = this.subMode === 'nodes' ? '' : 'none'
    if (!on) {
      this.setMode('select')
      this.hoveredBranchId = undefined
      this.hoveredHandleId = undefined
      this.lastHandleCycle = undefined
      this.hoverBadge.hidden = true
      this.tooltip.hidden = true
      this.normalCursorMesh.visible = false
      this.leafCursorMesh.visible = false
      foliageNormalView.uNormalDebug.value = 0
    } else {
      // Auto-select crown sculpt on ground plants when in nodes mode; keep 'leaves' & 'normals' allowed for ALL plant kinds!
      if (this.isGroundKind && this.subMode === 'nodes') {
        this.subMode = 'crown'
      } else if (this.subMode === 'nodes' && this.selectedBranchId === undefined) {
        const sk = this.currentSkeleton()
        if (sk.branches.length > 0) this.selectedBranchId = sk.branches[0].id
      }
      foliageNormalView.uNormalDebug.value = this.subMode === 'normals' && this.normalDebugColor ? 1 : 0
    }
    this.refresh()
    this.host.onStateChange?.()
  }

  setSubMode(sub: EditSubMode) {
    this.cancelActiveDrag()
    if (sub === 'nodes' && this.isGroundKind) sub = 'crown'
    this.subMode = sub
    this.setMode('select')
    this.hoveredHandleId = undefined
    this.lastHandleCycle = undefined
    this.hoverBadge.hidden = true
    this.tooltip.hidden = true
    this.overlay.hidden = !this.enabled || (sub !== 'nodes' && sub !== 'crown')
    this.svg.style.display = sub === 'nodes' ? '' : 'none'
    this.normalCursorMesh.visible = false
    this.leafCursorMesh.visible = false
    foliageNormalView.uNormalDebug.value = this.enabled && sub === 'normals' && this.normalDebugColor ? 1 : 0
    if (sub === 'nodes' && this.enabled && this.selectedBranchId === undefined) {
      const sk = this.currentSkeleton()
      if (sk.branches.length > 0) this.selectedBranchId = sk.branches[0].id
    }
    this.viewer.renderer.domElement.style.cursor = (sub === 'normals' && this.normalTool !== 'center') || sub === 'leaves' ? 'crosshair' : ''
    this.refresh()
    this.host.onStateChange?.()
  }

  private leafCursorColorFor(tool: LeafTool): string {
    switch (tool) {
      case 'prune': return '#f87171'
      case 'scale': return '#fbbf24'
      case 'tint': return this.leafBrushColor
      case 'erase': return '#94a3b8'
      default: return '#34d399'
    }
  }

  setLeafTool(tool: LeafTool) {
    this.leafTool = tool
    this.leafCursorMesh.visible = false
    this.leafCursorMat.color.set(this.leafCursorColorFor(tool))
    if (this.enabled && this.subMode === 'leaves') {
      this.viewer.renderer.domElement.style.cursor = 'crosshair'
    }
    this.host.onStateChange?.()
  }

  getSelectedLeafClump(): LeafClumpEdit | undefined {
    if (this.selectedLeafClumpId === undefined) return undefined
    return this.host.spec().leafEdits?.clumps.find(c => c.id === this.selectedLeafClumpId)
  }

  updateSelectedLeafClump(patch: Partial<LeafClumpEdit>, final: boolean) {
    if (!this.host.setLeafEdits || this.selectedLeafClumpId === undefined) return
    const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
    const item = cur.clumps.find(c => c.id === this.selectedLeafClumpId)
    if (!item) return
    if (final) this.pushUndo(this.snapshot())
    Object.assign(item, patch)
    if (!item.tint || (item.tintStrength ?? 0) <= 0) {
      delete item.tint
      delete item.tintStrength
    }
    this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, final)
    this.refresh()
    this.host.onStateChange?.()
  }

  removeSelectedLeafClump() {
    if (!this.host.setLeafEdits || this.selectedLeafClumpId === undefined) return
    const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
    const nextClumps = cur.clumps.filter(c => c.id !== this.selectedLeafClumpId)
    if (nextClumps.length === cur.clumps.length) return
    this.pushUndo(this.snapshot())
    cur.clumps = nextClumps
    this.selectedLeafClumpId = nextClumps[nextClumps.length - 1]?.id
    this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, true)
    this.refresh()
    this.host.onStateChange?.()
  }

  clearLeafBrushes() {
    if (!this.host.setLeafEdits) return
    const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
    if (!cur.brushes.length) return
    this.pushUndo(this.snapshot())
    cur.brushes = []
    this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, true)
    this.refresh()
    this.host.onStateChange?.()
  }

  resetLeafEdits() {
    if (!this.host.setLeafEdits) return
    if (!hasLeafEdits(this.host.spec().leafEdits)) return
    this.pushUndo(this.snapshot())
    this.selectedLeafClumpId = undefined
    this.host.setLeafEdits(undefined, true)
    this.refresh()
    this.host.onStateChange?.()
  }

  setNormalTool(tool: NormalTool) {
    this.normalTool = tool
    this.normalCursorMesh.visible = false
    if (this.enabled && this.subMode === 'normals') {
      this.viewer.renderer.domElement.style.cursor = tool === 'center' ? '' : 'crosshair'
    }
    this.host.onStateChange?.()
  }

  setShowNormalVectors(on: boolean) {
    this.showNormalVectors = on
    this.normalVectors.visible = on && this.enabled && this.subMode === 'normals'
    this.host.onStateChange?.()
  }

  setNormalDebugColor(on: boolean) {
    this.normalDebugColor = on
    foliageNormalView.uNormalDebug.value = this.enabled && this.subMode === 'normals' && on ? 1 : 0
    this.host.onStateChange?.()
  }

  applyNormalPreset(mode: LeafNormalMode, patch: Partial<LeafNormalEditSpec> = {}) {
    if (!this.host.setNormalEdit) return
    this.pushUndo(this.snapshot())
    const cur = cloneLeafNormalEdit(this.host.spec().normalEdit)
    this.host.setNormalEdit({ ...cur, ...patch, mode }, true)
    this.refresh()
  }

  clearNormalBrushes() {
    if (!this.host.setNormalEdit) return
    const cur = cloneLeafNormalEdit(this.host.spec().normalEdit)
    if (!cur.brushes.length) return
    this.pushUndo(this.snapshot())
    cur.brushes = []
    this.host.setNormalEdit(cur, true)
    this.refresh()
  }

  resetNormalEdit() {
    if (!this.host.setNormalEdit) return
    this.pushUndo(this.snapshot())
    this.host.setNormalEdit(defaultLeafNormalEdit(), true)
    this.refresh()
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
      socket: branch.socket ?? 0,
      baseSocket: branch.baseSocket ?? branch.socket ?? 0,
      triangles: estimateBranchTriangles(branch, spec.optimize.woodDetail, spec.kind === 'palm', spec.palm.ringCount, spec.trunk.sculpt),
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
      offset: patch.offset ? ([patch.offset[0], patch.offset[1], patch.offset[2]] as XYZ) : cur.offset,
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
    if (e.defaultPrevented) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (!this.enabled || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (this.host.canHandleShortcuts && !this.host.canHandleShortcuts()) return
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (this.undo()) {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.subMode === 'nodes') {
        const info = this.getSelectedBranchInfo()
        if (info && info.role !== 'trunk') {
          this.pruneSelectedBranch()
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      } else if (this.subMode === 'crown') {
        if (this.selectedId !== undefined) {
          this.removeSelected()
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      } else if (this.subMode === 'leaves') {
        if (this.selectedLeafClumpId !== undefined) {
          this.removeSelectedLeafClump()
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }
    } else if (e.key === 'Escape') {
      this.cancelActiveDrag()
      this.setMode('select')
      if (this.subMode === 'nodes') this.selectBranch(undefined)
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }

  private envelope(spec = this.host.spec()) {
    const skEnv = this.host.skeleton?.()?.envelope
    if (skEnv && (spec.branchEdits?.length || hasGlobalBranchOffset(spec.branches))) {
      return new CrownEnvelope(spec, skEnv.axis, { y0: skEnv.y0, y1: skEnv.y1, width: skEnv.width })
    }
    return new CrownEnvelope(spec, this.host.axis())
  }

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

  private clearNormalZones() {
    for (const child of [...this.normalBrushZones.children]) {
      this.normalBrushZones.remove(child)
      const geo = (child as Mesh | LineSegments).geometry
      if (geo && geo !== this.knobGeo && geo !== this.zoneGeo && geo !== this.normalRingGeo) geo.dispose()
    }
  }

  private clearLeafVisuals() {
    for (const grp of [this.leafClumpMeshes, this.leafBrushZones]) {
      for (const child of [...grp.children]) {
        grp.remove(child)
        const geo = (child as Mesh | LineSegments).geometry
        if (geo && geo !== this.knobGeo && geo !== this.zoneGeo && geo !== this.normalRingGeo) geo.dispose()
      }
    }
  }

  /** Rebuild 3D guides, crown handles, leaf sculpting gizmos, normal vectors/gizmos, and SpeedTree SVG gizmos. */
  refresh(handles = this.dragHandles ?? this.host.spec().handles) {
    this.cachedSkeleton = this.host.skeleton?.()
    if (!this.enabled) return
    const spec = { ...this.host.spec(), handles }
    if (this.isGroundKind && this.subMode === 'nodes') this.subMode = 'crown'

    this.crownGroup.visible = this.subMode === 'crown'
    this.nodeGroup.visible = this.subMode === 'nodes'
    this.leafGroup.visible = this.subMode === 'leaves'
    this.normalGroup.visible = this.subMode === 'normals'
    this.overlay.hidden = this.subMode !== 'nodes' && this.subMode !== 'crown'
    this.svg.style.display = this.subMode === 'nodes' ? '' : 'none'

    if (this.subMode === 'crown') {
      this.refreshCrown(spec, handles)
      this.host.selectedBranch?.(undefined)
    } else if (this.subMode === 'leaves') {
      this.refreshLeaves(spec)
      this.host.selectedBranch?.(undefined)
    } else if (this.subMode === 'normals') {
      this.refreshNormals(spec)
      this.host.selectedBranch?.(undefined)
    } else {
      this.refreshNodes()
    }
    this.group.updateMatrixWorld(true)
    this.syncOverlayGeometry(true)
  }

  private refreshLeaves(spec: TreeSpec) {
    this.clearLeafVisuals()
    const le = spec.leafEdits
    const knobSize = Math.max(.08, spec.trunk.height * .020)
    if (le) {
      for (const cl of le.clumps) {
        const sel = cl.id === this.selectedLeafClumpId
        const knob = new Mesh(this.knobGeo, sel ? this.matLeafClumpSelected : this.matLeafClump)
        knob.position.set(cl.position[0], cl.position[1], cl.position[2])
        knob.scale.setScalar(sel ? knobSize * 1.25 : knobSize)
        knob.renderOrder = 1002
        knob.userData.leafClumpId = cl.id
        this.leafClumpMeshes.add(knob)

        const zone = new Mesh(this.zoneGeo, sel ? this.matLeafZoneSel : this.matLeafZone)
        zone.position.set(cl.position[0], cl.position[1], cl.position[2])
        const r = Math.max(.2, cl.radius)
        const flat = clamp(cl.flatten, 0, .85)
        zone.scale.set(r * (1 + flat * .45) * .5, r * Math.max(.24, 1 - flat * .64) * .5, r * (1 + flat * .38) * .5)
        zone.renderOrder = 996
        this.leafClumpMeshes.add(zone)
      }
      for (const b of le.brushes) {
        const mat = b.kind === 'prune'
          ? this.matLeafBrushPrune
          : b.kind === 'scale'
            ? this.matLeafBrushScale
            : b.kind === 'tint'
              ? this.matLeafBrushTint
              : this.matLeafBrushDensify
        const ring = new LineSegments(this.normalRingGeo, mat)
        ring.position.set(b.position[0], b.position[1], b.position[2])
        ring.scale.setScalar(b.radius)
        ring.renderOrder = 995
        this.leafBrushZones.add(ring)
      }
    }
    this.leafCursorMat.color.set(this.leafCursorColorFor(this.leafTool))
  }

  private refreshNormals(spec: TreeSpec) {
    const env = this.envelope(spec)
    const ne = spec.normalEdit ?? defaultLeafNormalEdit()
    const center = customNormalCenter(env, ne)
    const size = Math.max(.09, spec.trunk.height * .022)
    this.normalCenterKnob.position.copy(center)
    this.normalCenterKnob.scale.setScalar(size)

    // 3-axis RGB crosshair around the draggable projection center
    const ax = size * 2.8
    const cPos = [
      center.x - ax, center.y, center.z, center.x + ax, center.y, center.z,
      center.x, center.y - ax, center.z, center.x, center.y + ax, center.z,
      center.x, center.y, center.z - ax, center.x, center.y, center.z + ax,
    ]
    const cCol = [
      1, .3, .3, 1, .3, .3,
      .3, 1, .3, .3, 1, .3,
      .3, .6, 1, .3, .6, 1,
    ]
    this.normalCenterCross.geometry.dispose()
    this.normalCenterCross.geometry = new BufferGeometry()
    this.normalCenterCross.geometry.setAttribute('position', new Float32BufferAttribute(cPos, 3))
    this.normalCenterCross.geometry.setAttribute('color', new Float32BufferAttribute(cCol, 3))

    // Render sleek 3-axis orthogonal rings for painted local normal brush zones
    this.clearNormalZones()
    for (const b of ne.brushes ?? []) {
      const zRing = new LineSegments(this.normalRingGeo, this.normalBrushMat)
      zRing.position.set(b.center[0], b.center[1], b.center[2])
      zRing.scale.setScalar(b.radius)
      zRing.renderOrder = 994
      this.normalBrushZones.add(zRing)
    }
    this.normalBrushZones.visible = this.showNormalVectors || this.normalTool !== 'center'

    // Rebuild 3D RGB normal-vector needles directly from live foliage geometry!
    this.normalVectors.geometry.dispose()
    const foliageRoot = this.host.foliageObject?.()
    if (foliageRoot) {
      const needleLen = Math.max(.14, Math.min(.38, spec.trunk.height * .042))
      this.normalVectors.geometry = buildNormalVectorsGeometry(foliageRoot, 680, needleLen)
    } else {
      this.normalVectors.geometry = new BufferGeometry()
    }
    this.normalVectors.visible = this.showNormalVectors
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
    this.group.updateMatrixWorld(true)
    const size = Math.max(.05, spec.trunk.height * .017)
    const camPos = this.viewer.camera.position

    // Compute camera-ray depth & screen projection for every handle so overlapping front/back handles
    // draw strictly back-to-front with distinct front vs occluded styling.
    const meta = handles.map(h => {
      const at = h.kind === 'shape' ? v3(h.anchor).add(v3(h.offset)) : v3(h.anchor)
      const worldAt = this.group.localToWorld(at.clone())
      const camDist = worldAt.distanceTo(camPos)
      const scr = this.projectLocalToStage(at)
      return { h, at, camDist, sx: scr.x, sy: scr.y, sz: scr.z }
    })
    const occludedIds = new Set<number>()
    for (let i = 0; i < meta.length; i++) {
      if (meta[i].sz < -1 || meta[i].sz > 1) continue
      for (let j = 0; j < meta.length; j++) {
        if (i === j || meta[j].sz < -1 || meta[j].sz > 1) continue
        if (meta[j].camDist < meta[i].camDist - 0.08 && Math.hypot(meta[i].sx - meta[j].sx, meta[i].sy - meta[j].sy) < 22) {
          occludedIds.add(meta[i].h.id)
          break
        }
      }
    }
    // Sort back-to-front so closer handles always receive higher renderOrder
    meta.sort((a, b) => b.camDist - a.camDist)

    meta.forEach(({ h, at }, rank) => {
      const selected = h.id === this.selectedId
      const hovered = h.id === this.hoveredHandleId
      const occluded = occludedIds.has(h.id)
      const mat = h.kind === 'bare'
        ? this.matBare
        : selected
          ? this.matSelected
          : hovered
            ? this.matHover
            : occluded
              ? this.matBackShape
              : this.matShape
      const knob = new Mesh(this.knobGeo, mat)
      knob.position.copy(at)
      knob.scale.setScalar(size * (selected ? 1.42 : hovered ? 1.24 : occluded ? 0.90 : 1))
      knob.renderOrder = 1000 + rank + (selected ? 40 : hovered ? 25 : 0)
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
      if (h.kind === 'bare' || selected || hovered) {
        const zone = new Mesh(this.zoneGeo, h.kind === 'bare' ? this.matZoneBare : this.matZoneShape)
        zone.position.copy(at)
        zone.scale.setScalar(h.radius)
        zone.renderOrder = 997
        this.handleMeshes.add(zone)
      }
    })
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

  /** Lightweight zero-alloc depth sort & occluded styling sync for crown handles when camera orbits. */
  private updateCrownHandleDepths() {
    const handles = this.dragHandles ?? this.host.spec().handles
    if (!handles.length) return
    const knobs = this.handleMeshes.children.filter((c): c is Mesh => c instanceof Mesh && c.userData.handleId !== undefined)
    if (!knobs.length) return
    this.group.updateMatrixWorld(true)
    const spec = this.host.spec()
    const size = Math.max(.05, spec.trunk.height * .017)
    const camPos = this.viewer.camera.position
    const byId = new Map(handles.map(h => [h.id, h]))
    const meta = knobs.map(knob => {
      const id = knob.userData.handleId as number
      const worldAt = knob.getWorldPosition(new Vector3())
      const scr = this.projectLocalToStage(knob.position)
      return { knob, id, h: byId.get(id), camDist: worldAt.distanceTo(camPos), sx: scr.x, sy: scr.y, sz: scr.z }
    })
    const occludedIds = new Set<number>()
    for (let i = 0; i < meta.length; i++) {
      if (meta[i].sz < -1 || meta[i].sz > 1) continue
      for (let j = 0; j < meta.length; j++) {
        if (i === j || meta[j].sz < -1 || meta[j].sz > 1) continue
        if (meta[j].camDist < meta[i].camDist - 0.08 && Math.hypot(meta[i].sx - meta[j].sx, meta[i].sy - meta[j].sy) < 22) {
          occludedIds.add(meta[i].id)
          break
        }
      }
    }
    meta.sort((a, b) => b.camDist - a.camDist)
    meta.forEach(({ knob, id, h }, rank) => {
      const selected = id === this.selectedId
      const hovered = id === this.hoveredHandleId
      const occluded = occludedIds.has(id)
      knob.material = h?.kind === 'bare'
        ? this.matBare
        : selected ? this.matSelected : hovered ? this.matHover : occluded ? this.matBackShape : this.matShape
      knob.scale.setScalar(size * (selected ? 1.42 : hovered ? 1.24 : occluded ? 0.90 : 1))
      knob.renderOrder = 1000 + rank + (selected ? 40 : hovered ? 25 : 0)
    })
  }

  private onFrameSync = () => {
    if (!this.enabled || (this.subMode !== 'nodes' && this.subMode !== 'crown')) return
    const cam = this.viewer.camera
    const sig = `${cam.position.x.toFixed(4)},${cam.position.y.toFixed(4)},${cam.position.z.toFixed(4)},${cam.zoom.toFixed(4)},${this.viewer.host.clientWidth}x${this.viewer.host.clientHeight}`
    if (sig !== this.lastCamSig) {
      this.lastCamSig = sig
      if (this.subMode === 'nodes') this.syncOverlayGeometry(false)
      else this.updateCrownHandleDepths()
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
    this.rootScreen = { x: r0.x, y: r0.y }
    this.rootDot.setAttribute('cx', r0.x.toFixed(1))
    this.rootDot.setAttribute('cy', r0.y.toFixed(1))

    const spec = this.host.spec()
    const raw = spec.branchEdits?.find(e => e.id === sel.id)
    const rootEdited = Boolean(
      (raw?.socketDelta && Math.abs(raw.socketDelta) > 1e-4) ||
      (raw?.offset && (raw.offset[0] * raw.offset[0] + raw.offset[1] * raw.offset[1] + raw.offset[2] * raw.offset[2] > 1e-6)),
    )
    this.rootDot.classList.toggle('is-edited', rootEdited)
    this.rootDot.classList.toggle('is-active', Boolean(this.dragRoot) || this.hoveredGizmo === 'root')

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
    const activeKind = this.dragGizmo?.kind
      ?? (this.hoveredGizmo && this.hoveredGizmo !== 'root' && !this.hoveredGizmo.startsWith('spline-') ? this.hoveredGizmo as GizmoKind : undefined)
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
    const fmtSign = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
    const maxW = Math.max(200, this.viewer.host.clientWidth - 220)
    const maxH = Math.max(120, this.viewer.host.clientHeight - 36)

    // Active root-anchor drag/hover tooltip
    if (this.dragRoot || this.hoveredGizmo === 'root') {
      const off = e.offset
      const sockPct = Math.round(info.socket * 100)
      const deltaPct = Math.round(e.socketDelta * 100)
      if (this.dragRoot?.mode === 'slide') {
        this.tooltip.textContent = `枝根滑动 · 挂点 ${sockPct}% (${deltaPct >= 0 ? '+' : ''}${deltaPct}%)`
      } else if (this.dragRoot?.mode === 'offset') {
        this.tooltip.textContent = `枝根位移 · Δ(${fmtSign(off[0])}, ${fmtSign(off[1])}, ${fmtSign(off[2])}) m`
      } else if (info.role === 'trunk') {
        this.tooltip.textContent = `树干根点 · 拖动自由平移 · Δ(${fmtSign(off[0])}, ${fmtSign(off[1])}, ${fmtSign(off[2])}) m`
      } else {
        this.tooltip.textContent = `枝根锚点 · 拖动沿父干滑动 (${sockPct}%) · Shift+拖自由平移`
      }
      this.tooltip.style.left = `${clamp(this.rootScreen.x + 14, 12, maxW).toFixed(1)}px`
      this.tooltip.style.top = `${clamp(this.rootScreen.y - 12, 12, maxH).toFixed(1)}px`
      this.tooltip.hidden = false
      return
    }

    // Active spline drag/hover tooltip
    const splineIdx = this.dragSpline ? this.dragSpline.index
      : this.hoveredGizmo?.startsWith('spline-') ? Number(this.hoveredGizmo.slice(7)) : -1
    if (splineIdx >= 0 && this.splineScreens[splineIdx]) {
      const off = e.spineOffsets[splineIdx]
      this.tooltip.textContent = `样条节点 #${splineIdx + 1} · Δ(${fmtSign(off[0])}, ${fmtSign(off[1])}, ${fmtSign(off[2])}) m`
      this.tooltip.style.left = `${clamp(this.splineScreens[splineIdx].x + 14, 12, maxW).toFixed(1)}px`
      this.tooltip.style.top = `${clamp(this.splineScreens[splineIdx].y - 12, 12, maxH).toFixed(1)}px`
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

  private onRootDown(e: PointerEvent) {
    if (!this.enabled || this.subMode !== 'nodes' || e.button !== 0) return
    const info = this.getSelectedBranchInfo()
    const sk = this.currentSkeleton()
    const branch = info ? sk.branches.find(b => b.id === info.id) : undefined
    if (!info || !branch) return
    e.stopImmediatePropagation()
    e.preventDefault()
    this.group.updateMatrixWorld(true)
    const startLocal = branch.curve.getPoint(0).clone()
    const startWorld = this.group.localToWorld(startLocal.clone())
    const normal = new Vector3()
    this.viewer.camera.getWorldDirection(normal)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, startWorld)
    const onPlane = new Vector3()
    this.ray(e).ray.intersectPlane(plane, onPlane)
    const mode: 'slide' | 'offset' =
      branch.role === 'trunk' || branch.parentId === undefined || e.shiftKey ? 'offset' : 'slide'
    this.dragRoot = {
      branchId: info.id,
      mode,
      parentBranchId: branch.parentId,
      baseSocket: branch.baseSocket ?? branch.socket ?? 0,
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

  private raycastFoliagePoint(e: PointerEvent, includeWood = false): Vector3 | undefined {
    const foliageRoot = this.host.foliageObject?.()
    if (!foliageRoot) return undefined
    const meshes: Mesh[] = []
    foliageRoot.traverse(o => {
      if (o instanceof Mesh && o.visible && o.name !== 'Ambient petals') {
        const role = o.userData?.role
        if (role === 'foliage' || (includeWood && role === 'wood')) meshes.push(o)
      }
    })
    if (!meshes.length) return undefined
    const hits = this.ray(e).intersectObjects(meshes, false)
    if (!hits.length) return undefined
    this.group.updateMatrixWorld(true)
    return this.group.worldToLocal(hits[0].point.clone())
  }

  private pickLeafClumpKnob(e: PointerEvent): { id: number; knob: Mesh } | undefined {
    const knobs = this.leafClumpMeshes.children.filter((c): c is Mesh => c instanceof Mesh && c.userData.leafClumpId !== undefined)
    if (!knobs.length) return undefined
    const hit = this.ray(e).intersectObjects(knobs, false)[0]
    if (!hit) return undefined
    return { id: hit.object.userData.leafClumpId as number, knob: hit.object as Mesh }
  }

  /** Depth-sorted front-to-back CrownHandle picking (supports ray hit + 16px screen radius for overlapping handles). */
  pickHandlesAtClient(clientX: number, clientY: number): { id: number; knob: Mesh; camDist: number; screenDist: number }[] {
    this.group.updateMatrixWorld(true)
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.viewer.camera)

    const knobs = this.handleMeshes.children.filter((c): c is Mesh => c instanceof Mesh && c.userData.handleId !== undefined)
    const rayHitIds = new Set(this.raycaster.intersectObjects(knobs, false).map(h => h.object.userData.handleId as number))
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const camPos = this.viewer.camera.position
    const hits: { id: number; knob: Mesh; camDist: number; screenDist: number }[] = []

    for (const knob of knobs) {
      const id = knob.userData.handleId as number
      const scr = this.projectLocalToStage(knob.position)
      if (scr.z < -1 || scr.z > 1) continue // ignore handles behind camera or beyond frustum
      const screenDist = Math.hypot(scr.x - sx, scr.y - sy)
      if (rayHitIds.has(id) || screenDist <= 16) {
        const worldPos = knob.getWorldPosition(new Vector3())
        hits.push({ id, knob, camDist: worldPos.distanceTo(camPos), screenDist })
      }
    }
    // Primary sort: front-to-back camera distance (closest first); tie-break by screen distance
    hits.sort((a, b) => (a.camDist - b.camDist) || (a.screenDist - b.screenDist))
    return hits
  }

  private onCanvasHover = (e: PointerEvent) => {
    if (!this.enabled || this.dragGizmo || this.dragSpline || this.dragRoot || this.dragNormalCenter || this.dragNormalBrush || this.dragLeafClump || this.dragLeafBrush || this.dragCrown) return
    if (this.subMode === 'leaves') {
      const hitClump = this.pickLeafClumpKnob(e)
      if (hitClump) {
        this.leafCursorMesh.visible = false
        this.viewer.renderer.domElement.style.cursor = 'grab'
        return
      }
      const includeWood = this.leafTool === 'clump' || this.leafTool === 'densify'
      const pt = this.raycastFoliagePoint(e, includeWood)
      if (pt) {
        this.leafCursorMesh.position.copy(pt)
        const rad = this.leafTool === 'clump' ? this.leafClumpRadius * .5 : this.leafBrushRadius
        this.leafCursorMesh.scale.setScalar(rad)
        this.leafCursorMat.color.set(this.leafCursorColorFor(this.leafTool))
        this.leafCursorMesh.visible = true
        this.viewer.renderer.domElement.style.cursor = 'crosshair'
      } else {
        this.leafCursorMesh.visible = false
        this.viewer.renderer.domElement.style.cursor = ''
      }
      return
    }
    if (this.subMode === 'normals') {
      if (this.normalTool !== 'center') {
        const pt = this.raycastFoliagePoint(e)
        if (pt) {
          this.normalCursorMesh.position.copy(pt)
          this.normalCursorMesh.scale.setScalar(this.normalBrushRadius)
          this.normalCursorMesh.visible = true
          this.viewer.renderer.domElement.style.cursor = 'crosshair'
        } else {
          this.normalCursorMesh.visible = false
          this.viewer.renderer.domElement.style.cursor = ''
        }
      } else {
        this.normalCursorMesh.visible = false
        const hitC = this.ray(e).intersectObject(this.normalCenterKnob, false)[0]
        this.viewer.renderer.domElement.style.cursor = hitC ? 'grab' : ''
      }
      return
    }
    if (this.subMode === 'crown') {
      if (this.mode !== 'select') {
        this.hoverBadge.hidden = true
        return
      }
      const hits = this.pickHandlesAtClient(e.clientX, e.clientY)
      const top = hits[0]
      const nextHov = top?.id
      if (nextHov !== this.hoveredHandleId) {
        this.hoveredHandleId = nextHov
        this.refreshCrown(this.host.spec(), this.dragHandles ?? this.host.spec().handles)
      }
      if (top) {
        const rect = this.viewer.renderer.domElement.getBoundingClientRect()
        const h = this.host.spec().handles.find(x => x.id === top.id)
        const kindTxt = h?.kind === 'bare' ? '裸枝区' : '树冠控制点'
        const stackTxt = hits.length > 1 ? ` · 前方 (共${hits.length}个重叠，再次点击切换后方)` : ' · 拖动塑形'
        this.hoverBadge.textContent = `${kindTxt} #${top.id}${stackTxt}`
        this.hoverBadge.style.left = `${(e.clientX - rect.left + 14).toFixed(0)}px`
        this.hoverBadge.style.top = `${(e.clientY - rect.top - 10).toFixed(0)}px`
        this.hoverBadge.hidden = false
        this.viewer.renderer.domElement.style.cursor = 'grab'
      } else {
        this.hoverBadge.hidden = true
        this.viewer.renderer.domElement.style.cursor = ''
      }
      return
    }
    if (this.subMode !== 'nodes') return
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
    if (this.hoveredHandleId !== undefined) {
      this.hoveredHandleId = undefined
      if (this.enabled && this.subMode === 'crown') {
        this.refreshCrown(this.host.spec(), this.dragHandles ?? this.host.spec().handles)
      }
    }
    this.hoverLine.visible = false
    this.hoverBadge.hidden = true
    this.normalCursorMesh.visible = false
    this.leafCursorMesh.visible = false
  }

  private onCanvasDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return
    this.group.updateMatrixWorld(true)

    if (this.subMode === 'nodes') {
      // Allow free camera orbiting on drag; short click selects a branch in 3D!
      this.clickCandidate = { x: e.clientX, y: e.clientY }
      return
    }

    if (this.subMode === 'leaves') {
      const spec = this.host.spec()
      if (!this.host.setLeafEdits) return
      // 1. Clicking an existing hand-placed leaf clump knob selects & drags it in 3D!
      const hitClump = this.pickLeafClumpKnob(e)
      if (hitClump && this.leafTool !== 'erase') {
        e.stopImmediatePropagation()
        e.preventDefault()
        this.selectedLeafClumpId = hitClump.id
        const normal = new Vector3()
        this.viewer.camera.getWorldDirection(normal)
        const worldPos = hitClump.knob.getWorldPosition(new Vector3())
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, worldPos)
        const onPlane = new Vector3()
        this.ray(e).ray.intersectPlane(plane, onPlane)
        this.dragLeafClump = {
          id: hitClump.id,
          plane,
          grab: worldPos.clone().sub(onPlane),
          snapshot: this.snapshot(),
          moved: false,
        }
        this.viewer.controls.enabled = false
        this.refresh()
        this.host.onStateChange?.()
        return
      }
      // 2. Plant a new hand-placed leaf clump (only supported natively on broadleaf)
      if (this.leafTool === 'clump') {
        const localHit = this.raycastFoliagePoint(e, true)
        if (localHit) {
          e.stopImmediatePropagation()
          e.preventDefault()
          this.pushUndo(this.snapshot())
          const cur = cloneLeafEditSpec(spec.leafEdits)
          const nextId = Math.max(0, ...cur.clumps.map(c => c.id)) + 1
          const clump: LeafClumpEdit = {
            id: nextId,
            position: xyz(localHit),
            radius: this.leafClumpRadius,
            flatten: this.leafClumpFlatten,
            density: 1.25,
            leafScale: 1,
          }
          cur.clumps.push(clump)
          if (cur.clumps.length > 64) cur.clumps.shift()
          this.selectedLeafClumpId = nextId
          this.host.setLeafEdits(cur, true)
          this.refresh()
          this.host.onStateChange?.()
          return
        }
        if (this.host.otherParts && this.host.focusPart) this.clickCandidate = { x: e.clientX, y: e.clientY }
        return
      }
      // 3. Direct 3D foliage brush painting (densify / prune / scale / tint / erase)
      const localHit = this.raycastFoliagePoint(e, this.leafTool === 'densify' || this.leafTool === 'erase')
      if (localHit) {
        e.stopImmediatePropagation()
        e.preventDefault()
        const snap = this.snapshot()
        const cur = cloneLeafEditSpec(spec.leafEdits)
        let changed = false
        if (this.leafTool === 'erase') {
          const rCut = this.leafBrushRadius * 1.1
          const b0 = cur.brushes.length, c0 = cur.clumps.length
          cur.brushes = cur.brushes.filter(b => Math.hypot(b.position[0] - localHit.x, b.position[1] - localHit.y, b.position[2] - localHit.z) > rCut)
          cur.clumps = cur.clumps.filter(c => Math.hypot(c.position[0] - localHit.x, c.position[1] - localHit.y, c.position[2] - localHit.z) > rCut)
          if (this.selectedLeafClumpId !== undefined && !cur.clumps.some(c => c.id === this.selectedLeafClumpId)) {
            this.selectedLeafClumpId = cur.clumps[cur.clumps.length - 1]?.id
          }
          changed = cur.brushes.length !== b0 || cur.clumps.length !== c0
        } else {
          const nextId = Math.max(0, ...cur.brushes.map(b => b.id)) + 1
          const sign = this.leafTool === 'scale' ? (e.altKey ? -this.leafScaleSign : this.leafScaleSign) : 1
          const stroke: LeafBrushStroke = {
            id: nextId,
            kind: this.leafTool,
            position: xyz(localHit),
            radius: this.leafBrushRadius,
            strength: Number((this.leafBrushStrength * sign).toFixed(3)),
            ...(this.leafTool === 'tint' ? { color: this.leafBrushColor } : {}),
          }
          cur.brushes.push(stroke)
          if (cur.brushes.length > 120) cur.brushes.shift()
          changed = true
        }
        if (changed) this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, false)
        this.dragLeafBrush = { lastLocal: localHit.clone(), snapshot: snap, changed }
        this.viewer.controls.enabled = false
        return
      }
      if (this.host.otherParts && this.host.focusPart) this.clickCandidate = { x: e.clientX, y: e.clientY }
      return
    }

    if (this.subMode === 'normals') {
      const spec = this.host.spec()
      // 1. Check draggable 3D Normal Projection Center Sphere first (works in center tool or direct click)
      const hitCenter = this.ray(e).intersectObject(this.normalCenterKnob, false)[0]
      if (hitCenter && this.host.setNormalEdit) {
        e.stopImmediatePropagation()
        e.preventDefault()
        const normal = new Vector3()
        this.viewer.camera.getWorldDirection(normal)
        const worldPos = this.normalCenterKnob.getWorldPosition(new Vector3())
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, worldPos)
        const onPlane = new Vector3()
        this.ray(e).ray.intersectPlane(plane, onPlane)
        const env = this.envelope(spec)
        const baseCenter = new Vector3(env.axis.x, env.y0 + env.height * 0.5, env.axis.z)
        this.dragNormalCenter = {
          plane,
          grab: worldPos.clone().sub(onPlane),
          baseCenter,
          startEdit: cloneLeafNormalEdit(spec.normalEdit),
          snapshot: this.snapshot(),
          moved: false,
        }
        this.viewer.controls.enabled = false
        return
      }

      // 2. Direct 3D Canopy Normal Brush painting (up / comb / puff / smooth / erase)
      if (this.normalTool !== 'center' && this.host.setNormalEdit) {
        const localHit = this.raycastFoliagePoint(e)
        if (localHit) {
          e.stopImmediatePropagation()
          e.preventDefault()
          const snap = this.snapshot()
          const cur = cloneLeafNormalEdit(spec.normalEdit)
          if (this.normalTool === 'erase') {
            const before = cur.brushes.length
            cur.brushes = cur.brushes.filter(b => Math.hypot(b.center[0] - localHit.x, b.center[1] - localHit.y, b.center[2] - localHit.z) > this.normalBrushRadius * 1.1)
            if (cur.brushes.length !== before) {
              this.pushUndo(snap)
              this.host.setNormalEdit(cur, false)
            }
            this.dragNormalBrush = { strokeId: -1, anchorLocal: localHit.clone(), lastLocal: localHit.clone(), snapshot: snap, isErase: true }
          } else {
            const nextId = Math.max(0, ...cur.brushes.map(b => b.id)) + 1
            const stroke: NormalBrushStroke = {
              id: nextId,
              kind: this.normalTool,
              center: xyz(localHit),
              radius: this.normalBrushRadius,
              strength: this.normalBrushStrength,
              direction: [0, 1, 0],
            }
            cur.brushes.push(stroke)
            if (cur.brushes.length > 64) cur.brushes.shift()
            this.host.setNormalEdit(cur, false)
            this.dragNormalBrush = { strokeId: nextId, anchorLocal: localHit.clone(), lastLocal: localHit.clone(), snapshot: snap, isErase: false }
          }
          this.viewer.controls.enabled = false
          return
        }
      }
      // Clicking elsewhere allows free camera orbiting (or switching active part in AI mode)
      if (this.host.otherParts && this.host.focusPart) this.clickCandidate = { x: e.clientX, y: e.clientY }
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
    const hits = this.pickHandlesAtClient(e.clientX, e.clientY)
    if (!hits.length) {
      this.lastHandleCycle = undefined
      // Allow short click on another part's mesh in Crown sub-mode to switch single-part focus
      if (this.host.otherParts && this.host.focusPart) this.clickCandidate = { x: e.clientX, y: e.clientY }
      return
    }
    e.stopImmediatePropagation()
    e.preventDefault()
    const ids = hits.map(h => h.id)
    let pickIdx = 0
    if (hits.length > 1) {
      const prev = this.lastHandleCycle
      const sameStack = prev
        && Math.hypot(prev.x - e.clientX, prev.y - e.clientY) <= 14
        && prev.ids.length === ids.length
        && prev.ids.every((v, k) => v === ids[k])
      if (sameStack || (e.shiftKey && prev?.ids[0] === ids[0])) {
        pickIdx = ((prev?.idx ?? 0) + 1) % hits.length
      }
      this.lastHandleCycle = { x: e.clientX, y: e.clientY, ids, idx: pickIdx }
    } else {
      this.lastHandleCycle = undefined
    }
    const chosen = hits[pickIdx]
    const id = chosen.id
    this.selectedId = id
    const normal = new Vector3()
    this.viewer.camera.getWorldDirection(normal)
    const worldPos = chosen.knob.getWorldPosition(new Vector3())
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, worldPos)
    const onPlane = new Vector3()
    ray.ray.intersectPlane(plane, onPlane)
    this.dragCrown = {
      id, plane, grab: worldPos.clone().sub(onPlane),
      startX: e.clientX, startY: e.clientY, snapshot: this.snapshot(), moved: false,
    }
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

    if (this.dragRoot) {
      const dr = this.dragRoot
      const next = normalizeEdit(dr.branchId, dr.startEdit)
      if (dr.mode === 'slide' && dr.parentBranchId !== undefined) {
        const sk = this.currentSkeleton()
        const parent = sk.branches.find(b => b.id === dr.parentBranchId)
        if (!parent) return
        const rect = this.viewer.renderer.domElement.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        const spec = this.host.spec()
        // If global branch offset shifted limbs off trunk, align parent projection track with the shifted branch!
        const shiftX = parent.role === 'trunk' ? (spec.branches.offsetX ?? 0) : 0
        const shiftY = parent.role === 'trunk' ? (spec.branches.offsetY ?? 0) : 0
        const shiftZ = parent.role === 'trunk' ? (spec.branches.offsetZ ?? 0) : 0
        this.group.updateMatrixWorld(true)
        const N = 48
        const tMin = .04, tMax = .98
        const sampleScreen = (t: number) => {
          const p = parent.curve.getPoint(t)
          if (shiftX || shiftY || shiftZ) p.set(p.x + shiftX, Math.max(0, p.y + shiftY), p.z + shiftZ)
          return this.projectLocalToStage(p)
        }
        let bestDist = Infinity
        let bestT = clamp(dr.baseSocket + dr.startEdit.socketDelta, tMin, tMax)
        let prev = sampleScreen(tMin)
        for (let i = 1; i <= N; i++) {
          const t0 = tMin + ((i - 1) / N) * (tMax - tMin)
          const t1 = tMin + (i / N) * (tMax - tMin)
          const cur = sampleScreen(t1)
          const { dist, t } = distToSegment2D(sx, sy, prev.x, prev.y, cur.x, cur.y)
          if (dist < bestDist) {
            bestDist = dist
            bestT = t0 + (t1 - t0) * t
          }
          prev = cur
        }
        const rawDelta = clamp(bestT - dr.baseSocket, -.95, .95)
        const nextDelta = Math.abs(rawDelta) < .004 ? 0 : rawDelta
        if (Math.abs(nextDelta - dr.startEdit.socketDelta) > 1e-4) dr.moved = true
        next.socketDelta = nextDelta
      } else {
        const worldPt = new Vector3()
        if (!this.ray(e).ray.intersectPlane(dr.plane, worldPt)) return
        worldPt.add(dr.grab)
        this.group.updateMatrixWorld(true)
        const curLocal = this.group.worldToLocal(worldPt)
        const delta = curLocal.sub(dr.startLocal)
        if (delta.lengthSq() > 1e-6) dr.moved = true
        const baseOff = dr.startEdit.offset
        next.offset = [
          clamp(baseOff[0] + delta.x, -4, 4),
          clamp(baseOff[1] + delta.y, -4, 4),
          clamp(baseOff[2] + delta.z, -4, 4),
        ]
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

    if (this.dragLeafClump && this.host.setLeafEdits) {
      const dc = this.dragLeafClump
      const worldPt = new Vector3()
      if (!this.ray(e).ray.intersectPlane(dc.plane, worldPt)) return
      worldPt.add(dc.grab)
      this.group.updateMatrixWorld(true)
      const localPt = this.group.worldToLocal(worldPt)
      const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
      const item = cur.clumps.find(c => c.id === dc.id)
      if (!item) return
      item.position = xyz(localPt)
      dc.moved = true
      this.host.setLeafEdits(cur, false)
      return
    }

    if (this.dragLeafBrush && this.host.setLeafEdits) {
      const db = this.dragLeafBrush
      const localHit = this.raycastFoliagePoint(e, this.leafTool === 'densify' || this.leafTool === 'erase')
      if (!localHit) return
      const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
      if (this.leafTool === 'erase') {
        const rCut = this.leafBrushRadius * 1.1
        const b0 = cur.brushes.length, c0 = cur.clumps.length
        cur.brushes = cur.brushes.filter(b => Math.hypot(b.position[0] - localHit.x, b.position[1] - localHit.y, b.position[2] - localHit.z) > rCut)
        cur.clumps = cur.clumps.filter(c => Math.hypot(c.position[0] - localHit.x, c.position[1] - localHit.y, c.position[2] - localHit.z) > rCut)
        if (cur.brushes.length !== b0 || cur.clumps.length !== c0) {
          db.changed = true
          this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, false)
        }
      } else if (this.leafTool !== 'clump' && localHit.distanceTo(db.lastLocal) >= Math.max(0.20, this.leafBrushRadius * 0.44)) {
        const nextId = Math.max(0, ...cur.brushes.map(b => b.id)) + 1
        const sign = this.leafTool === 'scale' ? (e.altKey ? -this.leafScaleSign : this.leafScaleSign) : 1
        cur.brushes.push({
          id: nextId,
          kind: this.leafTool,
          position: xyz(localHit),
          radius: this.leafBrushRadius,
          strength: Number((this.leafBrushStrength * sign).toFixed(3)),
          ...(this.leafTool === 'tint' ? { color: this.leafBrushColor } : {}),
        })
        if (cur.brushes.length > 120) cur.brushes.shift()
        db.lastLocal.copy(localHit)
        db.changed = true
        this.host.setLeafEdits(cur, false)
      }
      return
    }

    if (this.dragNormalCenter && this.host.setNormalEdit) {
      const dc = this.dragNormalCenter
      const worldPt = new Vector3()
      if (!this.ray(e).ray.intersectPlane(dc.plane, worldPt)) return
      worldPt.add(dc.grab)
      this.group.updateMatrixWorld(true)
      const localPt = this.group.worldToLocal(worldPt)
      const ox = clamp(localPt.x - dc.baseCenter.x, -4, 4)
      const oy = clamp(localPt.y - dc.baseCenter.y, -4, 4)
      const oz = clamp(localPt.z - dc.baseCenter.z, -4, 4)
      dc.moved = true
      const next = cloneLeafNormalEdit(dc.startEdit)
      if (next.mode === 'auto') next.mode = 'radial'
      next.centerOffsetX = Number(ox.toFixed(2))
      next.centerOffsetY = Number(oy.toFixed(2))
      next.centerOffsetZ = Number(oz.toFixed(2))
      this.host.setNormalEdit(next, false)
      return
    }

    if (this.dragNormalBrush && this.host.setNormalEdit) {
      const db = this.dragNormalBrush
      const localHit = this.raycastFoliagePoint(e)
      if (!localHit) return
      const cur = cloneLeafNormalEdit(this.host.spec().normalEdit)
      if (db.isErase) {
        cur.brushes = cur.brushes.filter(b => Math.hypot(b.center[0] - localHit.x, b.center[1] - localHit.y, b.center[2] - localHit.z) > this.normalBrushRadius * 1.1)
        this.host.setNormalEdit(cur, false)
      } else if (this.normalTool === 'comb') {
        // Update stroke direction live from 3D drag vector across canopy surface!
        const dir = localHit.clone().sub(db.anchorLocal)
        if (dir.lengthSq() > 0.0025) {
          dir.normalize()
          const target = cur.brushes.find(b => b.id === db.strokeId)
          if (target) {
            target.direction = [Number(dir.x.toFixed(3)), Number(dir.y.toFixed(3)), Number(dir.z.toFixed(3))]
            this.host.setNormalEdit(cur, false)
          }
        }
      } else if (localHit.distanceTo(db.lastLocal) >= Math.max(0.22, this.normalBrushRadius * 0.45)) {
        // Continuous painting along drag path for 'up' / 'puff' / 'smooth'
        const nextId = Math.max(0, ...cur.brushes.map(b => b.id)) + 1
        cur.brushes.push({
          id: nextId,
          kind: this.normalTool as NormalBrushKind,
          center: xyz(localHit),
          radius: this.normalBrushRadius,
          strength: this.normalBrushStrength,
          direction: [0, 1, 0],
        })
        if (cur.brushes.length > 64) cur.brushes.shift()
        db.lastLocal.copy(localHit)
        this.host.setNormalEdit(cur, false)
      }
      return
    }

    if (this.dragCrown && this.dragHandles) {
      if (!this.dragCrown.moved && Math.hypot(e.clientX - this.dragCrown.startX, e.clientY - this.dragCrown.startY) <= 2) return
      this.dragCrown.moved = true
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

    if (this.dragRoot) {
      const dr = this.dragRoot
      this.dragRoot = undefined
      this.viewer.controls.enabled = true
      if (dr.moved) {
        this.pushUndo(dr.snapshot)
        const spec = this.host.spec()
        const cur = normalizeEdit(dr.branchId, spec.branchEdits?.find(x => x.id === dr.branchId))
        this.commitBranchEdit(cur, true)
      }
      this.syncOverlayGeometry(true)
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

    if (this.dragLeafClump) {
      const dc = this.dragLeafClump
      this.dragLeafClump = undefined
      this.viewer.controls.enabled = true
      if (dc.moved && this.host.setLeafEdits) {
        this.pushUndo(dc.snapshot)
        const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
        this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, true)
      }
      return
    }

    if (this.dragLeafBrush) {
      const db = this.dragLeafBrush
      this.dragLeafBrush = undefined
      this.viewer.controls.enabled = true
      if (db.changed && this.host.setLeafEdits) {
        this.pushUndo(db.snapshot)
        const cur = cloneLeafEditSpec(this.host.spec().leafEdits)
        this.host.setLeafEdits(hasLeafEdits(cur) ? cur : undefined, true)
      }
      return
    }

    if (this.dragNormalCenter) {
      const dc = this.dragNormalCenter
      this.dragNormalCenter = undefined
      this.viewer.controls.enabled = true
      if (dc.moved && this.host.setNormalEdit) {
        this.pushUndo(dc.snapshot)
        this.host.setNormalEdit(cloneLeafNormalEdit(this.host.spec().normalEdit), true)
      }
      return
    }

    if (this.dragNormalBrush) {
      const db = this.dragNormalBrush
      this.dragNormalBrush = undefined
      this.viewer.controls.enabled = true
      if (this.host.setNormalEdit) {
        if (!db.isErase) this.pushUndo(db.snapshot)
        this.host.setNormalEdit(cloneLeafNormalEdit(this.host.spec().normalEdit), true)
      }
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
    const dc = this.dragCrown
    const handles = this.dragHandles
    this.dragCrown = undefined
    this.dragHandles = undefined
    this.viewer.controls.enabled = true
    if (dc.moved) {
      this.pushUndo(dc.snapshot)
      this.host.setHandles(handles, true)
    }
  }

  removeSelected() {
    const spec = this.host.spec()
    if (this.selectedId === undefined) return
    this.pushUndo(this.snapshot())
    this.host.setHandles(spec.handles.filter(h => h.id !== this.selectedId), true)
    this.selectedId = undefined
    this.host.selected(undefined)
  }

  /** Client-space position of the 3D Normal Projection Center sphere (for automated UI checks). */
  normalCenterScreen() {
    if (!this.enabled || this.subMode !== 'normals') return undefined
    this.group.updateMatrixWorld(true)
    const pt = this.projectLocalToStage(this.normalCenterKnob.position)
    return { x: pt.clientX, y: pt.clientY }
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

  /** Client-space center point directly on an active SpeedTree gizmo handle, root anchor, or spline node pin (for E2E tests). */
  gizmoScreen(target: GizmoKind | 'root' | `spline-${number}`) {
    if (!this.enabled || this.subMode !== 'nodes' || !this.pivotScreen.visible) return undefined
    this.syncOverlayGeometry(false)
    const rect = this.viewer.renderer.domElement.getBoundingClientRect()
    if (target === 'root') {
      return { x: rect.left + this.rootScreen.x, y: rect.top + this.rootScreen.y }
    }
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
    this.cancelActiveDrag()
    this.removeRenderListener()
    const el = this.viewer.renderer.domElement
    el.removeEventListener('pointerdown', this.onCanvasDown, { capture: true })
    el.removeEventListener('pointermove', this.onCanvasHover)
    el.removeEventListener('pointerleave', this.onCanvasLeave)
    el.removeEventListener('pointercancel', this.onCancelActiveDrag)
    window.removeEventListener('pointermove', this.onWindowMove)
    window.removeEventListener('pointerup', this.onWindowUp)
    window.removeEventListener('blur', this.onCancelActiveDrag)
    window.removeEventListener('keydown', this.onKeyDown)
    this.clearHandleMeshes()
    this.clearSelectTube()
    this.clearNormalZones()
    this.clearLeafVisuals()
    foliageNormalView.uNormalDebug.value = 0
    this.wire.geometry.dispose(); this.wire.material.dispose()
    this.shell.geometry.dispose(); this.shell.material.dispose()
    this.guideLines.geometry.dispose(); this.guideLines.material.dispose()
    this.hoverLine.geometry.dispose(); this.hoverLine.material.dispose()
    this.selectLine.geometry.dispose(); this.selectLine.material.dispose()
    this.selectTubeMat.dispose()
    this.normalVectors.geometry.dispose(); this.normalVectors.material.dispose()
    this.normalCenterCross.geometry.dispose(); this.normalCenterCross.material.dispose()
    this.normalCenterMat.dispose(); this.normalBrushMat.dispose(); this.normalCursorMat.dispose(); this.normalRingGeo.dispose()
    this.matLeafClump.dispose(); this.matLeafClumpSelected.dispose()
    this.matLeafZone.dispose(); this.matLeafZoneSel.dispose()
    this.matLeafBrushDensify.dispose(); this.matLeafBrushPrune.dispose()
    this.matLeafBrushScale.dispose(); this.matLeafBrushTint.dispose(); this.leafCursorMat.dispose()
    this.knobGeo.dispose(); this.zoneGeo.dispose()
    this.matShape.dispose(); this.matBackShape.dispose(); this.matHover.dispose()
    this.matSelected.dispose(); this.matBare.dispose()
    this.matLine.dispose(); this.matZoneShape.dispose(); this.matZoneBare.dispose()
    this.overlay.remove()
    this.viewer.scene.remove(this.group)
  }
}

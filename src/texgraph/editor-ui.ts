// Substance Designer-style Interactive Procedural Texture Node Graph Editor (v2).
// Features: pan/zoom blueprint canvas, inline live node previews, typed Bezier wiring (gray/rgba/label),
// Web Worker non-blocking evaluation, 30-step transactional Undo/Redo + Bypass + Duplicate + Search + JSON I/O,
// direct 2D canvas dragging for vector_layout leaves & Bezier stems, interactive monotone Curves & CIELAB Palette,
// Reference Image Split-Wipe / Onion-Skin / Diff Heatmap / Raw-Pixel Eyedropper,
// 6-channel + PBR relight preview, full PBR channel PNG export, real-time 3D sync, and Texture Library persistence.
import './texgraph.css'
import type { Texture } from 'three'
import type { EditableTextureSlot } from '../studio/texture-slots'
import { editableTextureSlots } from '../studio/texture-slots'
import {
  createBrowserTextureAgentApi, type BrowserTextureAgentApi,
  type OptimizeOptions, type OptimizeResult,
} from './agent-api'
import {
  bufferToRgbaBytes, drawBufferToCanvas, materialOutputToDataUrl,
  materialOutputToPbrDataUrls, materialOutputToThreeTexture,
  renderLitPbrPreview, TextureGraphEvaluator,
} from './engine'
import type { RgbaImageData } from './image-utils'
import {
  allNodeTypes, arePortsCompatible, cloneGraph, createNode, nodeDefinitions,
  normalizeGraphSchemaVersion, parseTextureGraph, wouldCreateCycle,
} from './nodes'
import { buildCurveLut, evalStemPoint, hitTestVectorLayout, type VectorHitTarget } from './nodes-v2'
import type { RefAnalysisResult } from './ref-analyze'
import {
  compositeReferenceComparison, decodeReferenceImage, sampleReferencePixel,
  type CompareMode, type PickedRefColor, type ReferenceImageState,
} from './ref-compare'
import type { ScoreBreakdown, ScoreMode } from './ref-score'
import type { SavedTextureItem, TextureLibraryStore } from './store'
import {
  defaultTemplateForSlot, detectGraphAtlasGrid, detectGraphAtlasRegions,
  getTextureTemplate, textureTemplates,
} from './templates'
import { GraphHistory, type GraphTransactionOp, type PatchResult } from './transaction'
import type {
  AtlasRegion, CurvePoint, GradientStop, GraphNode, ImageBuffer, MaterialOutputResult,
  NodeCategory, NodeType, TextureGraph, VectorLeafInstance, VectorStem,
} from './types'
import { defaultCategoryForSlot, nodeCategoryLabels, slotLabels } from './types'
import { TextureEvalWorkerClient, type WorkerEvalOutcome } from './worker-client'

export type PreviewChannel = 'baseColor' | 'lit' | 'normal' | 'height' | 'alpha' | 'roughness'

export interface TextureEditorHost {
  store: TextureLibraryStore
  /** Apply a baked Three.js Texture onto the live 3D tree in the given slot. */
  applyTexture(
    slot: EditableTextureSlot,
    texture: Texture,
    label: string,
    meta?: { atlasCols?: number; atlasRows?: number; atlasRegions?: AtlasRegion[] },
  ): void
  onOpen?(): void
  onClose?(): void
  message(text: string, error?: boolean): void
}

export interface EditorEvalMetrics {
  evalSeq: number
  width: number
  evalMs: number
  roundTripMs: number
  usedWorker: boolean
  cacheHits: number
  cacheMisses: number
  nodeTimings: Record<string, number>
}

export interface TextureAgentBridge {
  getSchema: BrowserTextureAgentApi['getSchema']
  getGraph: () => TextureGraph
  loadGraph: (graph: TextureGraph) => void
  applyPatch: (ops: GraphTransactionOp[], label?: string, baseRevision?: number) => PatchResult
  analyzeReference: (src?: string | File | RgbaImageData, opts?: { name?: string; resolution?: 256 | 512 | 1024; applyDraft?: boolean }) => Promise<RefAnalysisResult>
  scoreAgainstReference: (src?: string | File | RgbaImageData, mode?: ScoreMode, res?: number) => Promise<ScoreBreakdown>
  optimizeAgainstReference: (src?: string | File | RgbaImageData, opts?: OptimizeOptions) => Promise<OptimizeResult>
  renderDiagnosticDataUrl: (src?: string | File | RgbaImageData, mode?: ScoreMode, panelSize?: number) => Promise<{ dataUrl: string; score: ScoreBreakdown; width: number; height: number }>
  saveAndApply: (name?: string) => Promise<SavedTextureItem>
  getLastAnalysis: () => RefAnalysisResult | undefined
  getLastOptimize: () => OptimizeResult | undefined
}

export interface TextureEditorController {
  open(options?: { slot?: EditableTextureSlot; graph?: TextureGraph; savedId?: string; templateId?: string }): void
  close(): void
  isOpen(): boolean
  getGraph(): TextureGraph
  loadGraph(graph: TextureGraph, savedId?: string): void
  loadTemplate(templateId: string): void
  addNode(type: NodeType, x?: number, y?: number): GraphNode
  duplicateNode(nodeId?: string): GraphNode | undefined
  setBypass(nodeId: string, on: boolean): boolean
  connectPorts(fromNode: string, fromPort: string, toNode: string, toPort: string): boolean
  setNodeParam(nodeId: string, key: string, value: unknown): void
  applyPatch(ops: GraphTransactionOp[], label?: string, baseRevision?: number): PatchResult
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
  getRevision(): number
  setLiveSync(on: boolean): void
  saveToLibrary(overwrite?: boolean): Promise<SavedTextureItem>
  setFullscreen(full: boolean): void
  setReferenceImage(src: string | File, name?: string): Promise<ReferenceImageState>
  clearReferenceImage(): void
  setCompareMode(mode: CompareMode): void
  sampleReferenceAt(u: number, v: number): PickedRefColor | undefined
  exportPbrDataUrls(): { baseColor: string; normal: string; height: string; roughness: string; alpha?: string }
  getLastMetrics(): EditorEvalMetrics | undefined
  agent: TextureAgentBridge
  dispose(): void
}

const SVG_OFF = 2400
const esc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const gradientPresets: [string, GradientStop[]][] = [
  ['橡木皮', [
    { pos: 0, color: '#1e1612' }, { pos: 0.35, color: '#4a382c' },
    { pos: 0.72, color: '#755c4a' }, { pos: 1, color: '#a58c76' },
  ]],
  ['樱木紫褐', [
    { pos: 0, color: '#24181e' }, { pos: 0.38, color: '#4d343e' },
    { pos: 0.74, color: '#7c5b64' }, { pos: 1, color: '#b29197' },
  ]],
  ['白桦树皮', [
    { pos: 0, color: '#242220' }, { pos: 0.24, color: '#7a726a' },
    { pos: 0.56, color: '#cfc9be' }, { pos: 1, color: '#f2eee6' },
  ]],
  ['苔藓绿', [
    { pos: 0, color: '#223d1d' }, { pos: 0.45, color: '#477330' },
    { pos: 0.8, color: '#79ab45' }, { pos: 1, color: '#b0d96b' },
  ]],
  ['秋枫红橙', [
    { pos: 0, color: '#4d1012' }, { pos: 0.4, color: '#a8231c' },
    { pos: 0.76, color: '#e66424' }, { pos: 1, color: '#ffbf47' },
  ]],
]

const toneCurvePresets: [string, CurvePoint[]][] = [
  ['线性', [[0, 0], [0.33, 0.33], [0.67, 0.67], [1, 1]]],
  ['S 对比', [[0, 0.02], [0.25, 0.14], [0.75, 0.86], [1, 0.98]]],
  ['提亮', [[0, 0], [0.35, 0.52], [0.7, 0.84], [1, 1]]],
  ['压暗', [[0, 0], [0.35, 0.18], [0.72, 0.54], [1, 0.96]]],
]

const leafProfilePresets: [string, CurvePoint[]][] = [
  ['尖卵叶', [[0, 0.04], [0.18, 0.40], [0.44, 0.54], [0.70, 0.38], [0.90, 0.14], [1, 0]]],
  ['宽圆叶', [[0, 0.08], [0.20, 0.54], [0.50, 0.68], [0.80, 0.52], [0.94, 0.22], [1, 0]]],
  ['纤柳叶', [[0, 0.03], [0.20, 0.22], [0.46, 0.26], [0.76, 0.18], [0.94, 0.06], [1, 0]]],
  ['宽尾叶', [[0, 0.05], [0.25, 0.26], [0.60, 0.58], [0.84, 0.46], [0.95, 0.16], [1, 0]]],
]

const paletteOrder: NodeCategory[] = ['bark', 'foliage', 'filter', 'adjust', 'blend']

export function mountTextureEditor(host: TextureEditorHost): TextureEditorController {
  const workerClient = new TextureEvalWorkerClient()
  const syncBakeEvaluator = new TextureGraphEvaluator()

  let graph: TextureGraph = normalizeGraphSchemaVersion(defaultTemplateForSlot('leaf'))
  const history = new GraphHistory(graph, 30)
  let activeSavedId: string | undefined
  let selectedNodeId: string | undefined = graph.nodes[0]?.id
  let pinnedNodeId: string | undefined
  let previewChannel: PreviewChannel = 'baseColor'
  let tile2x2 = false
  let liveSync = true
  let isFull = false
  let openState = false

  let lastOutput: MaterialOutputResult | undefined
  let lastPinnedBuffer: ImageBuffer | undefined
  let lastMetrics: EditorEvalMetrics | undefined
  let lastSkippedPbr = false
  let evalSeq = 0

  // Direct 2D canvas vector_layout selection state (UI-only, never stored in history)
  let selectedLeafId: string | undefined
  let selectedStemId: string | undefined
  let selectedStemPtIdx = 0

  // Reference image comparator state (UI-only, never stored in history)
  let refImage: ReferenceImageState | undefined
  let compareMode: CompareMode = 'off'
  let wipePos = 0.5
  let onionAlpha = 0.45
  let lastPicked: PickedRefColor | undefined
  let activePickTarget: { nodeId: string; paramKey: string; swatchIdx: number } | undefined

  // Offscreen canvas holding the latest clean generated preview (before reference comparison overlay)
  const genCanvas = document.createElement('canvas')
  genCanvas.width = 256
  genCanvas.height = 256

  // Pan & zoom state
  let panX = 36
  let panY = 44
  let zoom = 0.86

  // Interactive PBR light direction for 'lit' preview channel
  let lightAzimuth = 0.72
  let lightElevation = 0.82

  // Root overlay element
  const root = document.createElement('section')
  root.className = 'tg-studio is-split'
  root.id = 'texture-node-studio'
  root.setAttribute('aria-label', '程序化贴图节点编辑器（Substance 风格 v2）')
  root.hidden = true

  const paletteHtml = paletteOrder.map(cat => {
    const nodes = allNodeTypes.filter(t => nodeDefinitions[t].category === cat)
    return `<div class="tg-pal-group">
      <div class="tg-pal-title">${nodeCategoryLabels[cat]}</div>
      ${nodes.map(t => `<button type="button" class="tg-pal-item" data-add-node="${t}" title="${esc(nodeDefinitions[t].description)}">
        <span class="tg-pal-dot tg-cat-${cat}"></span><span>${esc(nodeDefinitions[t].shortLabel)}</span>
      </button>`).join('')}
    </div>`
  }).join('')

  root.innerHTML = `
    <header class="tg-topbar">
      <div class="tg-top-left">
        <span class="tg-brand">◈ 贴图节点工坊</span>
        <input id="tg-name" class="tg-name-input" type="text" maxlength="80" placeholder="贴图名称">
        <select id="tg-slot" title="应用到 3D 树的贴图槽位">
          ${editableTextureSlots.map(s => `<option value="${s}">${slotLabels[s]}</option>`).join('')}
        </select>
        <select id="tg-template" title="载入内置 Substance 节点模板">
          <option value="">载入模板…</option>
          ${textureTemplates.map(t => `<option value="${t.id}">[${t.category === 'bark' ? '树皮' : t.category === 'flower' ? '花朵' : t.category === 'needle' ? '针叶' : '树叶'}] ${esc(t.name)}</option>`).join('')}
        </select>
        <select id="tg-res" title="烘焙与同步分辨率">
          <option value="256">256px</option>
          <option value="512" selected>512px</option>
          <option value="1024">1024px</option>
        </select>
      </div>
      <div class="tg-top-right">
        <button type="button" id="tg-live-sync" class="tg-btn" aria-pressed="true" title="参数或连线变动时实时同步到左侧 3D 树木">🔗 实时同步 3D</button>
        <button type="button" id="tg-apply-now" class="tg-btn is-accent" title="立即将当前输出烘焙应用到 3D 树">应用到 3D</button>
        <button type="button" id="tg-save-new" class="tg-btn is-primary" title="将此节点图与贴图保存到实时贴图库">💾 存入贴图库</button>
        <button type="button" id="tg-save-over" class="tg-btn" hidden title="覆盖更新贴图库中正在编辑的条目">覆盖保存</button>
        <button type="button" id="tg-export-png" class="tg-btn" title="下载当前预览通道的 PNG 图片">↓ 导出 PNG</button>
        <button type="button" id="tg-export-pbr" class="tg-btn" title="一键导出全套 PBR 通道 PNG（BaseColor/Normal/Height/Roughness/Alpha）">↓ PBR全通道</button>
        <button type="button" id="tg-json-io" class="tg-btn" title="查看、复制或严格校验导入 v1/v2 节点图 JSON">{ } JSON</button>
        <button type="button" id="tg-toggle-full" class="tg-btn" title="切换分屏联动 / 全屏工作台">⛶ 全屏</button>
        <button type="button" id="tg-close" class="tg-btn">✕ 关闭</button>
      </div>
    </header>
    <div class="tg-body">
      <aside class="tg-palette" aria-label="节点库">${paletteHtml}</aside>
      <div class="tg-canvas-wrap" id="tg-canvas-wrap">
        <div class="tg-graph-hint">拖拽空白平移 · 滚轮缩放 · 拖端口连线 · Tab 搜节点 · Ctrl+Z/Y 撤销重做 · B 直通 · Ctrl+D 复制</div>
        <div class="tg-world" id="tg-world">
          <svg class="tg-wires-svg" id="tg-wires-svg" width="6400" height="6400" viewBox="0 0 6400 6400">
            <g id="tg-wires-layer"></g>
            <path id="tg-wire-draft" class="tg-wire-draft" d="" style="display:none"></path>
          </svg>
          <div id="tg-nodes-layer"></div>
        </div>
        <div class="tg-graph-tools">
          <button type="button" id="tg-undo" title="撤销 (Ctrl+Z)" disabled>↩</button>
          <button type="button" id="tg-redo" title="重做 (Ctrl+Y)" disabled>↪</button>
          <button type="button" id="tg-search-node" title="搜索添加节点 (Tab)">🔍加节点</button>
          <button type="button" id="tg-dup-node" title="复制当前节点 (Ctrl+D)">复制</button>
          <button type="button" id="tg-bypass-node" title="直通静音当前节点 (B)">直通</button>
          <button type="button" id="tg-zoom-out" title="缩小">−</button>
          <button type="button" id="tg-zoom-reset" title="重置缩放">100%</button>
          <button type="button" id="tg-zoom-in" title="放大">＋</button>
          <button type="button" id="tg-fit" title="适应全部节点">适应</button>
          <button type="button" id="tg-layout" title="按拓扑自动排列节点">排布</button>
          <button type="button" id="tg-del-node" title="删除当前选中节点 (Delete)">删节点</button>
        </div>
        <div class="tg-graph-stat" id="tg-stat">就绪</div>
      </div>
      <aside class="tg-right">
        <section class="tg-preview-pane">
          <div class="tg-preview-head">
            <span id="tg-prev-title">最终输出</span>
            <div class="tg-preview-toggles">
              <button type="button" id="tg-prev-pin" class="tg-mini-btn" aria-pressed="false" title="切换查看最终材质输出 / 当前选中节点">查看节点</button>
              <button type="button" id="tg-prev-tile" class="tg-mini-btn" aria-pressed="false" title="2×2 平铺检视无缝衔接（树皮强烈推荐）">2×2 平铺</button>
            </div>
          </div>
          <div class="tg-preview-box" id="tg-preview-box">
            <canvas id="tg-preview-canvas" width="256" height="256"></canvas>
            <svg class="tg-vec-overlay" id="tg-vec-overlay" viewBox="0 0 1 1" preserveAspectRatio="none"></svg>
            <span class="tg-preview-tip" id="tg-preview-tip">BaseColor</span>
          </div>
          <div class="tg-channels" role="group" aria-label="预览通道">
            <button type="button" data-ch="baseColor" aria-pressed="true">色彩</button>
            <button type="button" data-ch="lit" aria-pressed="false">光照</button>
            <button type="button" data-ch="normal" aria-pressed="false">法线</button>
            <button type="button" data-ch="height" aria-pressed="false">高度</button>
            <button type="button" data-ch="alpha" aria-pressed="false">透明</button>
            <button type="button" data-ch="roughness" aria-pressed="false">粗糙</button>
          </div>
          <div class="tg-ref-bar" id="tg-ref-bar">
            <input type="file" id="tg-ref-file" accept="image/png,image/webp,image/jpeg" hidden>
            <button type="button" id="tg-ref-load" title="载入参考图进行卷帘/叠加/热力图对比与吸色">🖼 参考图</button>
            <button type="button" data-cmp="off" aria-pressed="true" hidden>关</button>
            <button type="button" data-cmp="wipe" aria-pressed="false" hidden>卷帘</button>
            <button type="button" data-cmp="onion" aria-pressed="false" hidden>叠加</button>
            <button type="button" data-cmp="diff" aria-pressed="false" hidden>热力图</button>
            <button type="button" data-cmp="pick" aria-pressed="false" hidden title="从参考图原始像素直接取色（避开棋盘格与显示叠加）">💉吸管</button>
            <button type="button" id="tg-ref-analyze" hidden style="color:#ffd875;border-color:#5b502a" title="自动分析参考图结构、色板与描边并生成可编辑 v2 节点初稿（支持 Ctrl+Z 撤销）">✨分析初稿</button>
            <button type="button" id="tg-ref-optimize" hidden style="color:#7dffb3;border-color:#2c6144" title="运行缓存感知局部参数寻优并更新相似度评分与 3D 预览">⚡自动寻优</button>
            <input type="range" id="tg-ref-onion" min="0.1" max="0.9" step="0.05" value="0.45" hidden title="参考图叠加不透明度">
            <span id="tg-ref-pick-readout" class="tg-ref-pick-chip" hidden></span>
            <span id="tg-ref-score-chip" class="tg-ref-pick-chip" hidden></span>
            <button type="button" id="tg-ref-clear" hidden title="清除参考图">✕</button>
          </div>
        </section>
        <section class="tg-inspector" id="tg-inspector"></section>
      </aside>
    </div>
  `
  document.body.appendChild(root)

  // Context menu for right-click adding nodes directly at cursor
  const ctxMenu = document.createElement('div')
  ctxMenu.className = 'tg-ctx-menu'
  ctxMenu.hidden = true
  ctxMenu.innerHTML = paletteOrder.map(cat => {
    const nodes = allNodeTypes.filter(t => nodeDefinitions[t].category === cat)
    return `<div class="tg-ctx-head">${nodeCategoryLabels[cat]}</div>` +
      nodes.map(t => `<button type="button" class="tg-ctx-item" data-ctx-node="${t}">
        <span class="tg-pal-dot tg-cat-${cat}"></span><span>${esc(nodeDefinitions[t].label)}</span>
      </button>`).join('')
  }).join('')
  document.body.appendChild(ctxMenu)

  // Quick Fuzzy Search Modal (Tab / Space)
  const searchModal = document.createElement('div')
  searchModal.className = 'tg-modal-backdrop'
  searchModal.id = 'tg-search-modal'
  searchModal.hidden = true
  searchModal.innerHTML = `
    <div class="tg-modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>搜索并添加节点</b>
        <span style="font-size:11px;color:#8fa1b0">Enter 添加 · Esc 关闭</span>
      </div>
      <input type="search" id="tg-search-input" placeholder="输入中文或英文节点名（如 描边 / curve / ao / vector / palette）">
      <div class="tg-search-list" id="tg-search-list"></div>
    </div>`
  document.body.appendChild(searchModal)

  // Graph JSON Import / Export Modal (strict v1/v2 contract)
  const jsonModal = document.createElement('div')
  jsonModal.className = 'tg-modal-backdrop'
  jsonModal.id = 'tg-json-modal'
  jsonModal.hidden = true
  jsonModal.innerHTML = `
    <div class="tg-modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <b>节点图 JSON（v1 / v2 严格契约）</b>
        <span style="font-size:11px;color:#8fa1b0" id="tg-json-ver">schemaVersion: 2</span>
      </div>
      <textarea id="tg-json-text" spellcheck="false"></textarea>
      <div class="tg-modal-foot">
        <button type="button" id="tg-json-copy">复制 JSON</button>
        <button type="button" id="tg-json-apply" class="is-primary">校验并载入</button>
        <button type="button" id="tg-json-close">关闭</button>
      </div>
    </div>`
  document.body.appendChild(jsonModal)

  const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T
  const nameInput = q<HTMLInputElement>('#tg-name')
  const slotSelect = q<HTMLSelectElement>('#tg-slot')
  const templateSelect = q<HTMLSelectElement>('#tg-template')
  const resSelect = q<HTMLSelectElement>('#tg-res')
  const liveSyncBtn = q<HTMLButtonElement>('#tg-live-sync')
  const saveOverBtn = q<HTMLButtonElement>('#tg-save-over')
  const toggleFullBtn = q<HTMLButtonElement>('#tg-toggle-full')
  const canvasWrap = q('#tg-canvas-wrap')
  const worldEl = q('#tg-world')
  const wiresLayer = root.querySelector('#tg-wires-layer') as SVGGElement
  const draftWire = root.querySelector('#tg-wire-draft') as SVGPathElement
  const nodesLayer = q('#tg-nodes-layer')
  const statEl = q('#tg-stat')
  const prevTitle = q('#tg-prev-title')
  const prevPinBtn = q<HTMLButtonElement>('#tg-prev-pin')
  const prevTileBtn = q<HTMLButtonElement>('#tg-prev-tile')
  const prevBox = q('#tg-preview-box')
  const prevCanvas = q<HTMLCanvasElement>('#tg-preview-canvas')
  const vecOverlay = root.querySelector('#tg-vec-overlay') as SVGSVGElement
  const prevTip = q('#tg-preview-tip')
  const inspectorEl = q('#tg-inspector')
  const zoomResetBtn = q<HTMLButtonElement>('#tg-zoom-reset')
  const undoBtn = q<HTMLButtonElement>('#tg-undo')
  const redoBtn = q<HTMLButtonElement>('#tg-redo')
  const refFileInput = q<HTMLInputElement>('#tg-ref-file')
  const refOnionInput = q<HTMLInputElement>('#tg-ref-onion')
  const refPickReadout = q('#tg-ref-pick-readout')
  const refScoreChip = q('#tg-ref-score-chip')
  const refAnalyzeBtn = q<HTMLButtonElement>('#tg-ref-analyze')
  const refOptimizeBtn = q<HTMLButtonElement>('#tg-ref-optimize')
  const refClearBtn = q<HTMLButtonElement>('#tg-ref-clear')
  let lastRefScoreText = ''

  const nodeEls = new Map<string, HTMLElement>()
  const nodeThumbs = new Map<string, HTMLCanvasElement>()

  function syncUndoRedoButtons() {
    undoBtn.disabled = !history.canUndo()
    redoBtn.disabled = !history.canRedo()
  }

  function applyPatch(ops: GraphTransactionOp[], label = '编辑', baseRevision?: number): PatchResult {
    const res = history.apply(ops, label, baseRevision)
    if (!res.ok) {
      host.message(res.errors[0] || '事务校验失败', true)
      return res
    }
    graph = cloneGraph(history.current)
    syncUndoRedoButtons()
    syncHeader()
    renderNodes()
    renderInspector()
    scheduleEvaluate(false)
    return res
  }

  function commitCurrentGraph(label = '编辑') {
    graph = normalizeGraphSchemaVersion(graph)
    history.commit(graph, label)
    syncUndoRedoButtons()
  }

  function undo(): boolean {
    const prev = history.undo()
    if (!prev) return false
    graph = prev
    if (selectedNodeId && !graph.nodes.some(n => n.id === selectedNodeId)) selectedNodeId = graph.nodes[0]?.id
    if (pinnedNodeId && !graph.nodes.some(n => n.id === pinnedNodeId)) pinnedNodeId = undefined
    syncUndoRedoButtons()
    syncHeader()
    renderNodes()
    renderInspector()
    scheduleEvaluate(false)
    host.message('已撤销')
    return true
  }

  function redo(): boolean {
    const next = history.redo()
    if (!next) return false
    graph = next
    if (selectedNodeId && !graph.nodes.some(n => n.id === selectedNodeId)) selectedNodeId = graph.nodes[0]?.id
    if (pinnedNodeId && !graph.nodes.some(n => n.id === pinnedNodeId)) pinnedNodeId = undefined
    syncUndoRedoButtons()
    syncHeader()
    renderNodes()
    renderInspector()
    scheduleEvaluate(false)
    host.message('已重做')
    return true
  }

  // ---- Transform & Coordinate Helpers --------------------------------------
  function applyWorldTransform() {
    worldEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
    const minor = Math.max(8, 20 * zoom)
    const major = minor * 5
    canvasWrap.style.backgroundSize = `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`
    canvasWrap.style.backgroundPosition = `${panX}px ${panY}px`
    zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`
  }

  function clientToWorld(cx: number, cy: number): [number, number] {
    const rect = canvasWrap.getBoundingClientRect()
    return [(cx - rect.left - panX) / zoom, (cy - rect.top - panY) / zoom]
  }

  function portCenterWorld(nodeId: string, kind: 'in' | 'out', portId: string): [number, number] | undefined {
    const el = nodesLayer.querySelector<HTMLElement>(
      `[data-node-id="${CSS.escape(nodeId)}"] [data-port-kind="${kind}"][data-port-id="${CSS.escape(portId)}"]`,
    )
    if (!el) return undefined
    const pr = el.getBoundingClientRect()
    const wr = worldEl.getBoundingClientRect()
    return [
      (pr.left + pr.width * 0.5 - wr.left) / zoom,
      (pr.top + pr.height * 0.5 - wr.top) / zoom,
    ]
  }

  function bezierPath(x0: number, y0: number, x1: number, y1: number): string {
    const dx = Math.max(46, Math.abs(x1 - x0) * 0.48)
    const sx0 = x0 + SVG_OFF, sy0 = y0 + SVG_OFF
    const sx1 = x1 + SVG_OFF, sy1 = y1 + SVG_OFF
    return `M ${sx0.toFixed(1)} ${sy0.toFixed(1)} C ${(sx0 + dx).toFixed(1)} ${sy0.toFixed(1)}, ${(sx1 - dx).toFixed(1)} ${sy1.toFixed(1)}, ${sx1.toFixed(1)} ${sy1.toFixed(1)}`
  }

  function fitView() {
    if (!graph.nodes.length) return
    const rect = canvasWrap.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + 178)
      maxY = Math.max(maxY, n.y + 152)
    }
    const bw = Math.max(200, maxX - minX + 90)
    const bh = Math.max(160, maxY - minY + 90)
    zoom = Math.max(0.35, Math.min(1.15, Math.min(rect.width / bw, rect.height / bh)))
    panX = (rect.width - (maxX - minX) * zoom) * 0.5 - minX * zoom
    panY = (rect.height - (maxY - minY) * zoom) * 0.5 - minY * zoom
    applyWorldTransform()
  }

  function autoLayout() {
    const layer = new Map<string, number>()
    for (const n of graph.nodes) layer.set(n.id, 0)
    for (let iter = 0; iter < graph.nodes.length; iter++) {
      for (const e of graph.edges) {
        const lFrom = layer.get(e.fromNode) ?? 0
        const lTo = layer.get(e.toNode) ?? 0
        if (lFrom + 1 > lTo) layer.set(e.toNode, lFrom + 1)
      }
    }
    const cols = new Map<number, GraphNode[]>()
    for (const n of graph.nodes) {
      const c = layer.get(n.id) ?? 0
      const arr = cols.get(c) ?? []
      arr.push(n)
      cols.set(c, arr)
    }
    for (const [col, list] of cols) {
      list.sort((a, b) => a.y - b.y)
      list.forEach((n, idx) => {
        n.x = 40 + col * 230
        n.y = 50 + idx * 175
      })
    }
    commitCurrentGraph('自动排布')
    renderNodes()
    requestAnimationFrame(() => { renderWires(); fitView() })
  }

  // ---- Non-Blocking Web Worker Evaluation & Live 3D Sync -------------------
  let evalRaf = 0
  let pendingHighRes = false
  let highResTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleEvaluate(fast = false) {
    pendingHighRes = pendingHighRes || !fast
    if (highResTimer) { clearTimeout(highResTimer); highResTimer = undefined }
    if (!evalRaf) {
      evalRaf = requestAnimationFrame(() => {
        evalRaf = 0
        const useHigh = pendingHighRes
        pendingHighRes = false
        const res = useHigh ? graph.resolution : Math.min(256, graph.resolution)
        // Skip PBR Normal/Roughness during fast 256px drag if viewing BaseColor/Alpha
        const skipPbr = !useHigh && (previewChannel === 'baseColor' || previewChannel === 'alpha')
        void runEvaluateAsync(res, useHigh, skipPbr)
        if (!useHigh && graph.resolution > 256) {
          highResTimer = setTimeout(() => {
            highResTimer = undefined
            if (openState) void runEvaluateAsync(graph.resolution, true, false)
          }, 220)
        }
      })
    }
  }

  function drawThumbBytes(bytes: Uint8ClampedArray, w: number, h: number, canvas: HTMLCanvasElement) {
    const g = canvas.getContext('2d')!
    const cw = canvas.width, ch = canvas.height
    g.clearRect(0, 0, cw, ch)
    const cell = 8
    for (let y = 0; y < ch; y += cell) {
      for (let x = 0; x < cw; x += cell) {
        g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? '#2b3136' : '#21262a'
        g.fillRect(x, y, cell, cell)
      }
    }
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    const tg = tmp.getContext('2d')!
    const img = tg.createImageData(w, h)
    img.data.set(bytes)
    tg.putImageData(img, 0, 0)
    g.drawImage(tmp, 0, 0, cw, ch)
  }

  async function runEvaluateAsync(res: number, sync3d: boolean, skipPbrMaps = false) {
    const snapshot = cloneGraph(graph)
    const outcome: WorkerEvalOutcome | null = await workerClient.evaluate(snapshot, res, {
      skipPbrMaps,
      pinnedNodeId,
    })
    if (!outcome) return // Superseded by a newer drag frame!

    lastOutput = outcome.output
    lastPinnedBuffer = outcome.pinnedBuffer
    lastSkippedPbr = skipPbrMaps
    evalSeq++
    lastMetrics = {
      evalSeq,
      width: outcome.width,
      evalMs: outcome.evalMs,
      roundTripMs: outcome.roundTripMs,
      usedWorker: outcome.usedWorker,
      cacheHits: outcome.cacheHits,
      cacheMisses: outcome.cacheMisses,
      nodeTimings: outcome.nodeTimings,
    }
    statEl.textContent = `${outcome.width}px · ${Math.round(outcome.evalMs)} ms${outcome.usedWorker ? ' (Worker)' : ''} · ${graph.nodes.length} 节点 · v${graph.schemaVersion}`

    for (const th of outcome.thumbs) {
      const thumb = nodeThumbs.get(th.nodeId)
      if (thumb) drawThumbBytes(th.bytes, th.width, th.height, thumb)
    }

    renderPreviewCanvas()

    if (sync3d && liveSync && openState) {
      const tex = materialOutputToThreeTexture(outcome.output, graph.targetSlot, graph.name || '程序贴图')
      const grid = detectGraphAtlasGrid(graph)
      const regions = detectGraphAtlasRegions(graph)
      const meta = (grid || regions) ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions } : undefined
      host.applyTexture(graph.targetSlot, tex, `◈ ${graph.name}`, meta)
    }
  }

  // ---- Direct 2D Vector Layout Overlay & Reference Comparator --------------
  function getActiveVectorNode(): GraphNode | undefined {
    const sel = graph.nodes.find(n => n.id === selectedNodeId)
    if (sel?.type === 'vector_layout') return sel
    return undefined
  }

  function isDirectVectorEditActive(): boolean {
    if (!getActiveVectorNode()) return false
    if (tile2x2 || previewChannel === 'lit') return false
    if (refImage && (compareMode === 'wipe' || compareMode === 'pick')) return false
    return true
  }

  function renderVectorOverlay() {
    const vecNode = getActiveVectorNode()
    const active = isDirectVectorEditActive()
    prevBox.classList.toggle('is-vec-active', active)
    prevBox.classList.toggle('is-wipe-active', Boolean(refImage && compareMode === 'wipe'))
    prevBox.classList.toggle('is-pick-active', Boolean(refImage && compareMode === 'pick'))

    if (!active || !vecNode) {
      vecOverlay.innerHTML = ''
      return
    }
    const stems = Array.isArray(vecNode.params.stems) ? vecNode.params.stems as VectorStem[] : []
    const instances = Array.isArray(vecNode.params.instances) ? vecNode.params.instances as VectorLeafInstance[] : []
    const parts: string[] = []

    // Subtle anchor dots for all leaves & stems so users see what's directly draggable
    for (const st of stems) {
      const isSel = st.id === selectedStemId
      const dPts: string[] = []
      for (let i = 0; i <= 20; i++) {
        const [px, py] = evalStemPoint(st.points, i / 20)
        dPts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(4)} ${py.toFixed(4)}`)
      }
      parts.push(`<path d="${dPts.join(' ')}" fill="none" stroke="${isSel ? '#ffd166' : 'rgba(255,209,102,0.34)'}" stroke-width="${isSel ? 0.007 : 0.003}" stroke-dasharray="${isSel ? '0.015 0.01' : ''}"/>`)
      if (isSel) {
        st.points.forEach((pt, idx) => {
          const isCur = idx === selectedStemPtIdx
          parts.push(`<circle cx="${pt[0].toFixed(4)}" cy="${pt[1].toFixed(4)}" r="${isCur ? 0.020 : 0.014}" fill="${isCur ? '#ff7b54' : '#ffd166'}" stroke="#0b1116" stroke-width="0.005"/>`)
        })
      } else {
        for (const pt of st.points) {
          parts.push(`<circle cx="${pt[0].toFixed(4)}" cy="${pt[1].toFixed(4)}" r="0.009" fill="rgba(255,209,102,0.58)" stroke="rgba(11,17,22,0.65)" stroke-width="0.003"/>`)
        }
      }
    }

    for (const inst of instances) {
      const isSel = inst.id === selectedLeafId
      if (!isSel) {
        parts.push(`<circle cx="${inst.x.toFixed(4)}" cy="${inst.y.toFixed(4)}" r="0.008" fill="rgba(83,216,251,0.35)" stroke="rgba(10,18,24,0.6)" stroke-width="0.002"/>`)
      } else {
        const deg = (inst.rot * 180) / Math.PI
        const hw = inst.scaleX * 0.42
        const hh = inst.scaleY * 0.48
        const rotHandleDist = hh + 0.055
        const rx = inst.x + Math.sin(inst.rot) * rotHandleDist
        const ry = inst.y - Math.cos(inst.rot) * rotHandleDist
        const sx = inst.x + Math.cos(inst.rot) * hw - Math.sin(inst.rot) * hh
        const sy = inst.y + Math.sin(inst.rot) * hw + Math.cos(inst.rot) * hh
        parts.push(`
          <g transform="translate(${inst.x.toFixed(4)} ${inst.y.toFixed(4)}) rotate(${deg.toFixed(2)})">
            <rect x="${(-hw).toFixed(4)}" y="${(-hh).toFixed(4)}" width="${(hw * 2).toFixed(4)}" height="${(hh * 2).toFixed(4)}" fill="rgba(83,216,251,0.08)" stroke="#53d8fb" stroke-width="0.005" stroke-dasharray="0.014 0.008"/>
            <line x1="0" y1="${(-hh).toFixed(4)}" x2="0" y2="${(-rotHandleDist).toFixed(4)}" stroke="#53d8fb" stroke-width="0.004"/>
          </g>
          <circle cx="${inst.x.toFixed(4)}" cy="${inst.y.toFixed(4)}" r="0.015" fill="#53d8fb" stroke="#08121a" stroke-width="0.005"/>
          <circle cx="${rx.toFixed(4)}" cy="${ry.toFixed(4)}" r="0.017" fill="#7dffb3" stroke="#08121a" stroke-width="0.005"/>
          <rect x="${(sx - 0.014).toFixed(4)}" y="${(sy - 0.014).toFixed(4)}" width="0.028" height="0.028" fill="#ffd166" stroke="#08121a" stroke-width="0.005"/>
        `)
      }
    }

    vecOverlay.innerHTML = parts.join('')
  }

  function syncRefBarUi() {
    const hasRef = Boolean(refImage)
    for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-cmp]')) {
      btn.hidden = !hasRef
      btn.setAttribute('aria-pressed', String(btn.dataset.cmp === compareMode))
    }
    refAnalyzeBtn.hidden = !hasRef
    refOptimizeBtn.hidden = !hasRef
    refOnionInput.hidden = !(hasRef && compareMode === 'onion')
    refClearBtn.hidden = !hasRef
    if (lastPicked && hasRef) {
      refPickReadout.hidden = false
      refPickReadout.innerHTML = `<i class="tg-ref-pick-swatch" style="background:${lastPicked.hex}"></i>${lastPicked.hex} A:${Math.round(lastPicked.a * 100)}%`
    } else {
      refPickReadout.hidden = true
    }
    if (lastRefScoreText && hasRef) {
      refScoreChip.hidden = false
      refScoreChip.textContent = lastRefScoreText
    } else {
      refScoreChip.hidden = true
    }
  }

  function renderPreviewCanvas() {
    if (!lastOutput) return
    const pinned = pinnedNodeId ? graph.nodes.find(n => n.id === pinnedNodeId) : undefined
    prevPinBtn.setAttribute('aria-pressed', String(Boolean(pinned)))
    prevTileBtn.setAttribute('aria-pressed', String(tile2x2))
    prevBox.classList.toggle('is-lit', !pinned && previewChannel === 'lit')

    let tipLabel = 'BaseColor'
    if (pinned && pinned.type !== 'output_material' && lastPinnedBuffer) {
      const def = nodeDefinitions[pinned.type]
      prevTitle.textContent = `节点预览 · ${def.shortLabel}`
      drawBufferToCanvas(lastPinnedBuffer, genCanvas, {
        checkerboard: !(refImage && compareMode !== 'off'),
        tile2x2,
        showAlphaOnly: previewChannel === 'alpha' && lastPinnedBuffer.kind === 'rgba',
      })
      tipLabel = `${def.shortLabel}${tile2x2 ? ' · 2×2' : ''}`
    } else {
      prevTitle.textContent = `最终输出 · ${slotLabels[graph.targetSlot]}`
      const out = lastOutput
      const wantRawTransparent = Boolean(refImage && compareMode !== 'off')
      if (previewChannel === 'lit') {
        renderLitPbrPreview(out, genCanvas, lightAzimuth, lightElevation, tile2x2)
        tipLabel = `PBR 实时光照（拖动换光向）${tile2x2 ? ' · 2×2' : ''}`
      } else if (previewChannel === 'normal') {
        drawBufferToCanvas(out.normal, genCanvas, { tile2x2 })
        tipLabel = `Normal 法线${tile2x2 ? ' · 2×2' : ''}`
      } else if (previewChannel === 'height') {
        drawBufferToCanvas(out.heightMap, genCanvas, { tile2x2 })
        tipLabel = `Height 高度${tile2x2 ? ' · 2×2' : ''}`
      } else if (previewChannel === 'roughness') {
        drawBufferToCanvas(out.roughness, genCanvas, { tile2x2 })
        tipLabel = `Roughness 粗糙度${tile2x2 ? ' · 2×2' : ''}`
      } else if (previewChannel === 'alpha') {
        drawBufferToCanvas(out.baseColor, genCanvas, { showAlphaOnly: true, tile2x2 })
        tipLabel = `Alpha 透明遮罩${tile2x2 ? ' · 2×2' : ''}`
      } else {
        drawBufferToCanvas(out.baseColor, genCanvas, { checkerboard: !wantRawTransparent, tile2x2 })
        tipLabel = `BaseColor${tile2x2 ? ' · 2×2' : ''}`
      }
    }

    if (refImage && compareMode !== 'off') {
      const res = compositeReferenceComparison(genCanvas, refImage, prevCanvas, compareMode, { wipePos, onionAlpha })
      if (compareMode === 'wipe') tipLabel = `卷帘对照（左参考 | 右生成）`
      else if (compareMode === 'onion') tipLabel = `参考叠加 ${Math.round(onionAlpha * 100)}%`
      else if (compareMode === 'diff') tipLabel = `差异热力图 · 均差 ${Math.round((res.meanDiff ?? 0) * 100)}%`
      else if (compareMode === 'pick') tipLabel = `吸管取色（点击参考图原始像素）`
    } else {
      const pg = prevCanvas.getContext('2d')!
      pg.clearRect(0, 0, prevCanvas.width, prevCanvas.height)
      pg.drawImage(genCanvas, 0, 0, prevCanvas.width, prevCanvas.height)
    }

    prevTip.textContent = tipLabel
    syncRefBarUi()
    renderVectorOverlay()
  }

  // ---- Render Nodes & Wires ------------------------------------------------
  function renderWires() {
    const parts: string[] = []
    for (const e of graph.edges) {
      const p0 = portCenterWorld(e.fromNode, 'out', e.fromPort)
      const p1 = portCenterWorld(e.toNode, 'in', e.toPort)
      if (!p0 || !p1) continue
      const fromNode = graph.nodes.find(n => n.id === e.fromNode)
      const fromDef = fromNode ? nodeDefinitions[fromNode.type] : undefined
      const portDef = fromDef?.outputs.find(p => p.id === e.fromPort)
      const cls = portDef?.type === 'label' ? 'type-label' : portDef?.type === 'gray' ? 'type-gray' : 'type-rgba'
      const d = bezierPath(p0[0], p0[1], p1[0], p1[1])
      parts.push(`<path class="tg-wire-hit" data-edge-id="${esc(e.id)}" d="${d}"><title>点击断开连线</title></path>`)
      parts.push(`<path class="tg-wire ${cls}" d="${d}"></path>`)
    }
    wiresLayer.innerHTML = parts.join('')
  }

  function renderNodes() {
    nodesLayer.innerHTML = ''
    nodeEls.clear()
    nodeThumbs.clear()

    const connectedInputs = new Set(graph.edges.map(e => `${e.toNode}:${e.toPort}`))
    const connectedOutputs = new Set(graph.edges.map(e => `${e.fromNode}:${e.fromPort}`))

    for (const node of graph.nodes) {
      const def = nodeDefinitions[node.type]
      const card = document.createElement('div')
      card.className = 'tg-node'
        + (node.id === selectedNodeId ? ' is-selected' : '')
        + (node.id === pinnedNodeId ? ' is-pinned' : '')
        + (node.bypass ? ' is-bypassed' : '')
      card.dataset.nodeId = node.id
      card.style.left = `${node.x}px`
      card.style.top = `${node.y}px`

      const portLabelType = (t: string) => t === 'label' ? '实例标签(Int32)' : t === 'gray' ? '灰度' : 'RGBA'
      const insHtml = def.inputs.map(p => {
        const conn = connectedInputs.has(`${node.id}:${p.id}`) ? ' is-connected' : ''
        return `<div class="tg-port-row is-in">
          <span class="tg-port-dot type-${p.type}${conn}" data-port-kind="in" data-port-id="${p.id}" data-node-id="${esc(node.id)}" title="${esc(p.label)}（${portLabelType(p.type)}）"></span>
          <span>${esc(p.label)}</span>
        </div>`
      }).join('')

      const outsHtml = def.outputs.map(p => {
        const conn = connectedOutputs.has(`${node.id}:${p.id}`) ? ' is-connected' : ''
        return `<div class="tg-port-row is-out">
          <span>${esc(p.label)}</span>
          <span class="tg-port-dot type-${p.type}${conn}" data-port-kind="out" data-port-id="${p.id}" data-node-id="${esc(node.id)}" title="${esc(p.label)}（${portLabelType(p.type)}，拖出连线）"></span>
        </div>`
      }).join('')

      card.innerHTML = `
        <div class="tg-node-head">
          <div class="tg-node-head-l">
            <span class="tg-pal-dot tg-cat-${def.category}"></span>
            <span class="tg-node-title">${esc(node.label || def.shortLabel)}</span>
          </div>
          ${node.bypass ? '<span class="tg-bypass-badge">直通</span>' : ''}
        </div>
        <div class="tg-node-mid"><canvas class="tg-node-thumb" width="72" height="72" title="双击固定到右侧大图预览"></canvas></div>
        <div class="tg-ports-wrap">
          <div class="tg-node-ports-col">${insHtml}</div>
          <div class="tg-node-ports-col">${outsHtml}</div>
        </div>
      `
      nodesLayer.appendChild(card)
      nodeEls.set(node.id, card)
      nodeThumbs.set(node.id, card.querySelector<HTMLCanvasElement>('.tg-node-thumb')!)

      // Select & drag node (commits 1 undo step on pointerup if moved)
      card.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('.tg-port-dot')) return
        e.stopPropagation()
        selectNode(node.id)
        const startX = e.clientX, startY = e.clientY
        const origX = node.x, origY = node.y
        let moved = false
        const onMove = (me: PointerEvent) => {
          const nx = Math.round(origX + (me.clientX - startX) / zoom)
          const ny = Math.round(origY + (me.clientY - startY) / zoom)
          if (nx !== node.x || ny !== node.y) {
            moved = true
            node.x = nx; node.y = ny
            card.style.left = `${node.x}px`
            card.style.top = `${node.y}px`
            renderWires()
          }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (moved) commitCurrentGraph('移动节点')
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })

      card.addEventListener('dblclick', e => {
        e.stopPropagation()
        if (node.type === 'output_material') pinnedNodeId = undefined
        else pinnedNodeId = pinnedNodeId === node.id ? undefined : node.id
        syncNodeClasses()
        void runEvaluateAsync(Math.min(256, graph.resolution), false, false)
      })
    }

    for (const dot of nodesLayer.querySelectorAll<HTMLElement>('.tg-port-dot')) {
      dot.addEventListener('pointerdown', e => {
        e.stopPropagation()
        e.preventDefault()
        startWireDrag(dot.dataset.nodeId!, dot.dataset.portId!, dot.dataset.portKind as 'in' | 'out', e)
      })
    }

    requestAnimationFrame(renderWires)
  }

  function syncNodeClasses() {
    for (const [id, el] of nodeEls) {
      el.classList.toggle('is-selected', id === selectedNodeId)
      el.classList.toggle('is-pinned', id === pinnedNodeId)
    }
  }

  // ---- Interactive Bezier Wire Dragging ------------------------------------
  function startWireDrag(startNodeId: string, startPortId: string, startKind: 'in' | 'out', downEvt: PointerEvent) {
    let anchorNode = startNodeId
    let anchorPort = startPortId
    let anchorKind: 'in' | 'out' = startKind

    if (startKind === 'in') {
      const existing = graph.edges.find(e => e.toNode === startNodeId && e.toPort === startPortId)
      if (existing) {
        applyPatch([{ op: 'disconnect', edgeId: existing.id }], '断开连线')
        anchorNode = existing.fromNode
        anchorPort = existing.fromPort
        anchorKind = 'out'
      }
    }

    const origin = portCenterWorld(anchorNode, anchorKind, anchorPort)
    if (!origin) return
    draftWire.style.display = ''
    const updateDraft = (cx: number, cy: number) => {
      const [wx, wy] = clientToWorld(cx, cy)
      draftWire.setAttribute('d', anchorKind === 'out'
        ? bezierPath(origin[0], origin[1], wx, wy)
        : bezierPath(wx, wy, origin[0], origin[1]))
    }
    updateDraft(downEvt.clientX, downEvt.clientY)

    const onMove = (me: PointerEvent) => updateDraft(me.clientX, me.clientY)
    const onUp = (ue: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      draftWire.style.display = 'none'
      draftWire.setAttribute('d', '')

      const target = document.elementFromPoint(ue.clientX, ue.clientY)?.closest('.tg-port-dot') as HTMLElement | null
      if (!target) return
      const targetNode = target.dataset.nodeId!
      const targetPort = target.dataset.portId!
      const targetKind = target.dataset.portKind as 'in' | 'out'
      if (targetKind === anchorKind || targetNode === anchorNode) return

      const fromNode = anchorKind === 'out' ? anchorNode : targetNode
      const fromPort = anchorKind === 'out' ? anchorPort : targetPort
      const toNode = anchorKind === 'in' ? anchorNode : targetNode
      const toPort = anchorKind === 'in' ? anchorPort : targetPort
      connectPorts(fromNode, fromPort, toNode, toPort)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function connectPorts(fromNode: string, fromPort: string, toNode: string, toPort: string): boolean {
    const fn = graph.nodes.find(n => n.id === fromNode)
    const tn = graph.nodes.find(n => n.id === toNode)
    if (!fn || !tn) return false
    const fp = nodeDefinitions[fn.type].outputs.find(p => p.id === fromPort)
    const tp = nodeDefinitions[tn.type].inputs.find(p => p.id === toPort)
    if (!fp || !tp) return false
    if (!arePortsCompatible(fp.type, tp.type)) {
      host.message(`端口类型不兼容：${fp.type} 不可连入 ${tp.type}`, true)
      return false
    }
    if (wouldCreateCycle(graph.nodes, graph.edges, fromNode, toNode)) {
      host.message('不能创建循环连线', true)
      return false
    }
    return applyPatch([{ op: 'connect', fromNode, fromPort, toNode, toPort }], '连接端口').ok
  }

  wiresLayer.addEventListener('click', e => {
    const hit = (e.target as Element).closest('[data-edge-id]') as SVGElement | null
    if (!hit) return
    const edgeId = hit.getAttribute('data-edge-id')
    if (edgeId) applyPatch([{ op: 'disconnect', edgeId }], '断开连线')
  })

  // ---- Node Selection & Interactive Parameter Inspector --------------------
  function selectNode(nodeId: string | undefined) {
    selectedNodeId = nodeId
    syncNodeClasses()
    renderInspector()
    renderVectorOverlay()
  }

  function setNodeParam(nodeId: string, key: string, value: unknown, fast = false, commit = !fast) {
    const node = graph.nodes.find(n => n.id === nodeId)
    if (!node) return
    node.params[key] = value
    if (commit) commitCurrentGraph(`修改 ${key}`)
    scheduleEvaluate(fast)
  }

  function renderCurveSvgInner(points: CurvePoint[], monotone: boolean): string {
    const lut = buildCurveLut(points, points, monotone, 64)
    const pathPts: string[] = []
    for (let i = 0; i < lut.length; i++) {
      const x = (i / (lut.length - 1)) * 180 + 8
      const y = (1 - lut[i]) * 108 + 9
      pathPts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    const gridLines = [0.25, 0.5, 0.75].map(t => {
      const x = t * 180 + 8
      const y = (1 - t) * 108 + 9
      return `<line x1="${x}" y1="9" x2="${x}" y2="117" stroke="#222b33" stroke-width="1"/>
              <line x1="8" y1="${y}" x2="188" y2="${y}" stroke="#222b33" stroke-width="1"/>`
    }).join('')
    const ptsSvg = points.map((pt, idx) => {
      const cx = pt[0] * 180 + 8
      const cy = (1 - pt[1]) * 108 + 9
      return `<circle class="tg-curve-pt" data-cpt="${idx}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4.5"><title>拖动调点 · 双击删除中间点</title></circle>`
    }).join('')
    return `
      <rect x="8" y="9" width="180" height="108" fill="none" stroke="#2d3844" stroke-width="1"/>
      ${gridLines}
      <line x1="8" y1="117" x2="188" y2="9" stroke="#2a3540" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="${pathPts.join(' ')}" fill="none" stroke="#53d8fb" stroke-width="2"/>
      ${ptsSvg}
    `
  }

  function renderInspector() {
    const node = graph.nodes.find(n => n.id === selectedNodeId)
    if (!node) {
      inspectorEl.innerHTML = '<p class="tg-insp-desc">在画布中点击任意节点以调节参数，双击节点可在上方实时检视该节点输出。</p>'
      return
    }
    const def = nodeDefinitions[node.type]
    const hasSeed = def.params.some(p => p.key === 'seed')
    const canDelete = node.type !== 'output_material'

    let html = `
      <div class="tg-insp-head">
        <h4>${esc(def.label)}</h4>
        <div style="display:flex;gap:4px">
          ${canDelete ? `<button type="button" id="tg-insp-bypass" class="tg-mini-btn" aria-pressed="${Boolean(node.bypass)}" title="直通跳过该节点 (B)">${node.bypass ? '恢复' : '直通'}</button>` : ''}
          ${hasSeed ? '<button type="button" id="tg-insp-seed" class="tg-mini-btn" title="随机更换种子">🎲</button>' : ''}
          ${canDelete ? '<button type="button" id="tg-insp-del" class="tg-mini-btn" style="color:#ff9e9e" title="删除该节点">删除</button>' : ''}
        </div>
      </div>
      <p class="tg-insp-desc">${esc(def.description)}</p>
    `

    for (const param of def.params) {
      if (param.kind === 'json') continue // edited via specialized vector_layout UI + direct canvas!
      const val = node.params[param.key] ?? param.default
      if (param.kind === 'bool') {
        html += `<label class="tg-param-check"><span>${esc(param.label)}</span><input type="checkbox" data-pkey="${param.key}" ${val ? 'checked' : ''}></label>`
      } else if (param.kind === 'select') {
        html += `<label class="tg-param"><span>${esc(param.label)}</span><select data-pkey="${param.key}">
          ${(param.options ?? []).map(([v, l]) => `<option value="${esc(v)}" ${String(val) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>`
      } else if (param.kind === 'color') {
        html += `<label class="tg-param"><span>${esc(param.label)}</span><input type="color" data-pkey="${param.key}" value="${esc(String(val))}"></label>`
      } else if (param.kind === 'gradient') {
        const stops = (Array.isArray(val) ? val : param.default) as GradientStop[]
        const cssStops = [...stops].sort((a, b) => a.pos - b.pos).map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')
        html += `<div class="tg-grad-box" data-grad-key="${param.key}">
          <div class="tg-grad-bar" id="tg-grad-bar" style="background:linear-gradient(90deg, ${cssStops})"></div>
          <div class="tg-grad-presets">
            ${gradientPresets.map(([label], i) => `<button type="button" data-gpreset="${i}">${label}</button>`).join('')}
            <button type="button" id="tg-grad-add" style="color:#7de8a6">＋ 色标</button>
          </div>
          ${stops.map((s, idx) => `<div class="tg-grad-stop" data-stop-idx="${idx}">
            <input type="color" data-stop-color="${idx}" value="${esc(s.color)}">
            <input type="range" data-stop-pos="${idx}" min="0" max="1" step="0.01" value="${s.pos}">
            <span>${Math.round(s.pos * 100)}%</span>
            <button type="button" data-stop-del="${idx}" title="移除色标" ${stops.length <= 2 ? 'disabled' : ''}>×</button>
          </div>`).join('')}
        </div>`
      } else if (param.kind === 'curve') {
        const pts = (Array.isArray(val) ? val : param.default) as CurvePoint[]
        const mono = node.type === 'curves_lut' ? node.params.monotone !== false : true
        const presets = node.type === 'custom_leaf' ? leafProfilePresets : toneCurvePresets
        html += `<div class="tg-curve-box" data-curve-key="${param.key}">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#b8c7d4">
            <span>${esc(param.label)}</span>
            <div class="tg-grad-presets">${presets.map(([lbl], i) => `<button type="button" data-cpreset="${i}">${lbl}</button>`).join('')}</div>
          </div>
          <svg class="tg-curve-svg" viewBox="0 0 196 126" data-curve-svg="${param.key}">${renderCurveSvgInner(pts, mono)}</svg>
        </div>`
      } else if (param.kind === 'palette') {
        const colors = (Array.isArray(val) ? val : param.default) as string[]
        html += `<div class="tg-pal-box" data-pal-key="${param.key}">
          <div style="font-size:11px;color:#b8c7d4">${esc(param.label)}（${colors.length} 色）</div>
          <div class="tg-pal-swatches">
            ${colors.map((hex, idx) => `<span class="tg-pal-chip">
              <input type="color" data-pal-col="${idx}" value="${esc(hex)}">
              <button type="button" data-pal-pick="${idx}" title="用吸管从参考图取色到此色块">💉</button>
              ${colors.length > 2 ? `<button type="button" data-pal-del="${idx}" title="移除该色块">×</button>` : ''}
            </span>`).join('')}
          </div>
          <div class="tg-pal-actions">
            <button type="button" data-pal-add style="color:#7de8a6">＋ 添加色块</button>
          </div>
        </div>`
      } else {
        html += `<label class="tg-param"><span>${esc(param.label)}</span>
          <input type="range" data-pkey="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}" value="${Number(val)}">
          <input type="number" data-pnum="${param.key}" min="${param.min}" max="${param.max}" step="${param.step}" value="${Number(val)}">
        </label>`
      }
    }

    // Dedicated Vector Layout interactive selection card
    if (node.type === 'vector_layout') {
      const stems = Array.isArray(node.params.stems) ? node.params.stems as VectorStem[] : []
      const instances = Array.isArray(node.params.instances) ? node.params.instances as VectorLeafInstance[] : []
      const pal = Array.isArray(node.params.palette) ? node.params.palette as string[] : ['#487c39']
      const selLeaf = instances.find(x => x.id === selectedLeafId)
      const selStem = stems.find(x => x.id === selectedStemId)
      html += `<div class="tg-vec-card">
        <div class="tg-vec-card-head">
          <span>矢量编排（${stems.length} 枝 · ${instances.length} 叶）</span>
          <span style="font-size:10px;color:#9ab2c2">直接在预览图拖拽</span>
        </div>
        <div class="tg-vec-btns">
          <button type="button" id="tg-vec-add-leaf" style="color:#7de8a6">＋ 添加叶片</button>
          <button type="button" id="tg-vec-add-stem" style="color:#ffd166">＋ 添加枝条</button>
        </div>`
      if (selLeaf) {
        const deg = Math.round((selLeaf.rot * 180) / Math.PI)
        html += `
          <div style="font-size:11px;color:#cde4f5;border-top:1px solid #263642;padding-top:5px">已选叶片：<b>${esc(selLeaf.id)}</b></div>
          <label class="tg-param"><span>旋转°</span><input type="range" id="tg-vl-rot" min="-180" max="180" step="1" value="${deg}"><input type="number" id="tg-vl-rot-n" min="-180" max="180" step="1" value="${deg}"></label>
          <label class="tg-param"><span>宽缩放</span><input type="range" id="tg-vl-sx" min="0.04" max="0.45" step="0.005" value="${selLeaf.scaleX.toFixed(3)}"><input type="number" id="tg-vl-sx-n" min="0.04" max="0.45" step="0.005" value="${selLeaf.scaleX.toFixed(3)}"></label>
          <label class="tg-param"><span>长缩放</span><input type="range" id="tg-vl-sy" min="0.04" max="0.45" step="0.005" value="${selLeaf.scaleY.toFixed(3)}"><input type="number" id="tg-vl-sy-n" min="0.04" max="0.45" step="0.005" value="${selLeaf.scaleY.toFixed(3)}"></label>
          <label class="tg-param"><span>色板序号</span><input type="range" id="tg-vl-col" min="0" max="${Math.max(0, pal.length - 1)}" step="1" value="${Math.min(pal.length - 1, selLeaf.colorIdx)}"><input type="number" id="tg-vl-col-n" min="0" max="${Math.max(0, pal.length - 1)}" step="1" value="${Math.min(pal.length - 1, selLeaf.colorIdx)}"></label>
          <label class="tg-param"><span>前后层级 Z</span><input type="range" id="tg-vl-z" min="0" max="1.5" step="0.01" value="${selLeaf.z.toFixed(2)}"><input type="number" id="tg-vl-z-n" min="0" max="1.5" step="0.01" value="${selLeaf.z.toFixed(2)}"></label>
          <div class="tg-vec-btns">
            <button type="button" id="tg-vl-flip">水平翻转</button>
            <button type="button" id="tg-vl-dup">复制叶片</button>
            <button type="button" id="tg-vl-del" style="color:#ff9e9e">删除叶片</button>
          </div>`
      } else if (selStem) {
        html += `
          <div style="font-size:11px;color:#ffe09c;border-top:1px solid #263642;padding-top:5px">已选枝条：<b>${esc(selStem.id)}</b>（${selStem.points.length} 控制点）</div>
          <label class="tg-param"><span>根部粗细</span><input type="range" id="tg-vs-ws" min="0.002" max="0.035" step="0.0005" value="${selStem.widthStart.toFixed(4)}"><input type="number" id="tg-vs-ws-n" min="0.002" max="0.035" step="0.0005" value="${selStem.widthStart.toFixed(4)}"></label>
          <label class="tg-param"><span>梢部粗细</span><input type="range" id="tg-vs-we" min="0.001" max="0.025" step="0.0005" value="${selStem.widthEnd.toFixed(4)}"><input type="number" id="tg-vs-we-n" min="0.001" max="0.025" step="0.0005" value="${selStem.widthEnd.toFixed(4)}"></label>
          <div class="tg-vec-btns">
            <button type="button" id="tg-vs-addpt" ${selStem.points.length >= 8 ? 'disabled' : ''}>＋ 细分控制点</button>
            <button type="button" id="tg-vs-del" style="color:#ff9e9e">删除枝条</button>
          </div>`
      } else {
        html += `<p class="tg-insp-desc" style="margin:0">点击上方预览画布中的任意叶片或枝条即可直接拖动、旋转、缩放与调点。</p>`
      }
      html += `</div>`
    }

    inspectorEl.innerHTML = html

    // Wire standard parameter inputs
    for (const input of inspectorEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-pkey]')) {
      const key = input.dataset.pkey!
      const spec = def.params.find(p => p.key === key)!
      if (spec.kind === 'bool') {
        input.onchange = () => {
          setNodeParam(node.id, key, (input as HTMLInputElement).checked, false, true)
          if (node.type === 'curves_lut' && key === 'monotone') renderInspector()
        }
      } else if (spec.kind === 'select') {
        input.onchange = () => setNodeParam(node.id, key, input.value, false, true)
      } else if (spec.kind === 'color') {
        input.oninput = () => setNodeParam(node.id, key, input.value, true, false)
        input.onchange = () => setNodeParam(node.id, key, input.value, false, true)
      } else {
        const peer = inspectorEl.querySelector<HTMLInputElement>(`[data-pnum="${CSS.escape(key)}"]`)
        const emit = (fast: boolean) => {
          let v = (input as HTMLInputElement).valueAsNumber
          if (!Number.isFinite(v)) return
          if (spec.kind === 'int') v = Math.round(v)
          if (peer) peer.value = String(v)
          setNodeParam(node.id, key, v, fast, !fast)
        }
        input.oninput = () => emit(true)
        input.onchange = () => emit(false)
        if (peer) {
          peer.onchange = () => {
            let v = peer.valueAsNumber
            if (!Number.isFinite(v)) return
            if (spec.min !== undefined) v = Math.max(spec.min, Math.min(spec.max!, v))
            if (spec.kind === 'int') v = Math.round(v)
            input.value = String(v)
            peer.value = String(v)
            setNodeParam(node.id, key, v, false, true)
          }
        }
      }
    }

    // Wire Gradient Map interactive editor
    const gradBox = inspectorEl.querySelector<HTMLElement>('[data-grad-key]')
    if (gradBox) {
      const gKey = gradBox.dataset.gradKey!
      const getStops = (): GradientStop[] => Array.isArray(node.params[gKey]) ? node.params[gKey] as GradientStop[] : []
      const updateBar = () => {
        const stops = getStops()
        const bar = gradBox.querySelector<HTMLElement>('#tg-grad-bar')
        if (!bar) return
        const cssStops = [...stops].sort((a, b) => a.pos - b.pos).map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')
        bar.style.background = `linear-gradient(90deg, ${cssStops})`
      }
      for (const colEl of gradBox.querySelectorAll<HTMLInputElement>('[data-stop-color]')) {
        const idx = Number(colEl.dataset.stopColor)
        colEl.oninput = () => { const st = getStops(); if (st[idx]) st[idx].color = colEl.value; updateBar(); scheduleEvaluate(true) }
        colEl.onchange = () => { commitCurrentGraph('修改渐变色标'); scheduleEvaluate(false) }
      }
      for (const posEl of gradBox.querySelectorAll<HTMLInputElement>('[data-stop-pos]')) {
        const idx = Number(posEl.dataset.stopPos)
        posEl.oninput = () => {
          const st = getStops()
          if (st[idx]) st[idx].pos = posEl.valueAsNumber
          const span = posEl.nextElementSibling
          if (span) span.textContent = `${Math.round(posEl.valueAsNumber * 100)}%`
          updateBar(); scheduleEvaluate(true)
        }
        posEl.onchange = () => { commitCurrentGraph('移动渐变色标'); scheduleEvaluate(false) }
      }
      for (const delBtn of gradBox.querySelectorAll<HTMLButtonElement>('[data-stop-del]')) {
        const idx = Number(delBtn.dataset.stopDel)
        delBtn.onclick = () => {
          const st = getStops()
          if (st.length <= 2) return
          st.splice(idx, 1)
          commitCurrentGraph('删除渐变色标')
          renderInspector(); scheduleEvaluate(false)
        }
      }
      gradBox.querySelector('#tg-grad-add')?.addEventListener('click', () => {
        const st = getStops()
        if (st.length >= 6) return
        st.push({ pos: 0.5, color: '#6b8550' })
        commitCurrentGraph('添加渐变色标')
        renderInspector(); scheduleEvaluate(false)
      })
      for (const pBtn of gradBox.querySelectorAll<HTMLButtonElement>('[data-gpreset]')) {
        pBtn.onclick = () => {
          const preset = gradientPresets[Number(pBtn.dataset.gpreset)]
          if (!preset) return
          applyPatch([{ op: 'replaceGradient', nodeId: node.id, key: gKey, stops: preset[1] }], '切换渐变预设')
        }
      }
    }

    // Wire Interactive SVG Curve Editor (curves_lut & custom_leaf)
    for (const curveBox of inspectorEl.querySelectorAll<HTMLElement>('[data-curve-key]')) {
      const cKey = curveBox.dataset.curveKey!
      const svg = curveBox.querySelector<SVGSVGElement>('[data-curve-svg]')!
      const getPts = (): CurvePoint[] => Array.isArray(node.params[cKey]) ? node.params[cKey] as CurvePoint[] : [[0, 0], [1, 1]]
      const isMono = () => (node.type === 'curves_lut' ? node.params.monotone !== false : true)
      const redraw = () => { svg.innerHTML = renderCurveSvgInner(getPts(), isMono()) }

      const svgToCurve = (e: PointerEvent): [number, number] => {
        const r = svg.getBoundingClientRect()
        const vx = ((e.clientX - r.left) / Math.max(1, r.width)) * 196
        const vy = ((e.clientY - r.top) / Math.max(1, r.height)) * 126
        return [
          Math.max(0, Math.min(1, (vx - 8) / 180)),
          Math.max(0, Math.min(1, 1 - (vy - 9) / 108)),
        ]
      }

      svg.addEventListener('pointerdown', e => {
        const ptEl = (e.target as Element).closest('[data-cpt]') as SVGCircleElement | null
        const pts = getPts()
        let idx = ptEl ? Number(ptEl.dataset.cpt) : -1
        if (idx < 0) {
          if (pts.length >= 8) return
          const [cx, cy] = svgToCurve(e)
          pts.push([Number(cx.toFixed(3)), Number(cy.toFixed(3))])
          pts.sort((a, b) => a[0] - b[0])
          idx = pts.findIndex(pt => Math.abs(pt[0] - cx) < 0.01 && Math.abs(pt[1] - cy) < 0.01)
          if (idx < 0) idx = pts.length - 1
          redraw()
          scheduleEvaluate(true)
        }
        const onMove = (me: PointerEvent) => {
          const [nx, ny] = svgToCurve(me)
          if (idx === 0) pts[idx] = [0, Number(ny.toFixed(3))]
          else if (idx === pts.length - 1) pts[idx] = [1, Number(ny.toFixed(3))]
          else {
            const minX = pts[idx - 1][0] + 0.03
            const maxX = pts[idx + 1][0] - 0.03
            pts[idx] = [Number(Math.max(minX, Math.min(maxX, nx)).toFixed(3)), Number(ny.toFixed(3))]
          }
          redraw()
          scheduleEvaluate(true)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          commitCurrentGraph('调整曲线')
          scheduleEvaluate(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
      })

      svg.addEventListener('dblclick', e => {
        const ptEl = (e.target as Element).closest('[data-cpt]') as SVGCircleElement | null
        if (!ptEl) return
        const idx = Number(ptEl.dataset.cpt)
        const pts = getPts()
        if (idx <= 0 || idx >= pts.length - 1 || pts.length <= 2) return
        pts.splice(idx, 1)
        redraw()
        commitCurrentGraph('删除曲线控制点')
        scheduleEvaluate(false)
      })

      const presets = node.type === 'custom_leaf' ? leafProfilePresets : toneCurvePresets
      for (const btn of curveBox.querySelectorAll<HTMLButtonElement>('[data-cpreset]')) {
        btn.onclick = () => {
          const preset = presets[Number(btn.dataset.cpreset)]
          if (!preset) return
          applyPatch([{ op: 'setParam', nodeId: node.id, key: cKey, value: preset[1] }], '应用曲线预设')
        }
      }
    }

    // Wire Discrete Palette Editor (palette_map & vector_layout)
    for (const palBox of inspectorEl.querySelectorAll<HTMLElement>('[data-pal-key]')) {
      const pKey = palBox.dataset.palKey!
      const getPal = (): string[] => Array.isArray(node.params[pKey]) ? node.params[pKey] as string[] : ['#487c39', '#8fc14a']
      for (const colEl of palBox.querySelectorAll<HTMLInputElement>('[data-pal-col]')) {
        const idx = Number(colEl.dataset.palCol)
        colEl.oninput = () => { const pal = getPal(); pal[idx] = colEl.value; scheduleEvaluate(true) }
        colEl.onchange = () => { commitCurrentGraph('修改色板'); scheduleEvaluate(false) }
      }
      for (const delBtn of palBox.querySelectorAll<HTMLButtonElement>('[data-pal-del]')) {
        const idx = Number(delBtn.dataset.palDel)
        delBtn.onclick = () => {
          const pal = [...getPal()]
          if (pal.length <= 2) return
          pal.splice(idx, 1)
          applyPatch([{ op: 'setParam', nodeId: node.id, key: pKey, value: pal }], '删除色块')
        }
      }
      for (const pickBtn of palBox.querySelectorAll<HTMLButtonElement>('[data-pal-pick]')) {
        const idx = Number(pickBtn.dataset.palPick)
        pickBtn.onclick = () => {
          if (!refImage) {
            host.message('请先点击「🖼 参考图」载入参考图片', true)
            return
          }
          activePickTarget = { nodeId: node.id, paramKey: pKey, swatchIdx: idx }
          setCompareMode('pick')
          host.message(`点击参考图任意位置以吸取色块 #${idx + 1}`)
        }
      }
      palBox.querySelector('[data-pal-add]')?.addEventListener('click', () => {
        const pal = [...getPal()]
        if (pal.length >= 12) return
        pal.push('#7eb553')
        applyPatch([{ op: 'setParam', nodeId: node.id, key: pKey, value: pal }], '添加色块')
      })
    }

    // Wire Vector Layout selected-instance / selected-stem inspector controls
    if (node.type === 'vector_layout') {
      const getInstances = () => Array.isArray(node.params.instances) ? node.params.instances as VectorLeafInstance[] : []
      const getStems = () => Array.isArray(node.params.stems) ? node.params.stems as VectorStem[] : []

      inspectorEl.querySelector('#tg-vec-add-leaf')?.addEventListener('click', () => {
        const insts = getInstances()
        const newId = `leaf-${Date.now().toString(36).slice(-4)}`
        const created: VectorLeafInstance = {
          id: newId, x: 0.5, y: 0.5, rot: 0, scaleX: 0.11, scaleY: 0.13,
          variant: 0, colorIdx: insts.length % 5, z: (insts.reduce((m, x) => Math.max(m, x.z), 0.2)) + 0.05,
        }
        selectedLeafId = newId; selectedStemId = undefined
        applyPatch([{ op: 'upsertInstances', nodeId: node.id, instances: [created] }], '添加叶片')
      })

      inspectorEl.querySelector('#tg-vec-add-stem')?.addEventListener('click', () => {
        const stems = getStems()
        const newId = `stem-${Date.now().toString(36).slice(-4)}`
        const created: VectorStem = {
          id: newId, points: [[0.35, 0.72], [0.50, 0.52], [0.65, 0.34]],
          widthStart: 0.009, widthEnd: 0.004, z: 0.35,
        }
        selectedStemId = newId; selectedStemPtIdx = 1; selectedLeafId = undefined
        applyPatch([{ op: 'upsertStems', nodeId: node.id, stems: [created] }], '添加枝条')
      })

      const selLeaf = getInstances().find(x => x.id === selectedLeafId)
      if (selLeaf) {
        const bindLeafRange = (id: string, applyVal: (v: number) => void) => {
          const r = inspectorEl.querySelector<HTMLInputElement>(`#${id}`)
          const n = inspectorEl.querySelector<HTMLInputElement>(`#${id}-n`)
          if (!r) return
          r.oninput = () => { const v = r.valueAsNumber; if (n) n.value = String(v); applyVal(v); renderVectorOverlay(); scheduleEvaluate(true) }
          r.onchange = () => { commitCurrentGraph('微调叶片'); scheduleEvaluate(false) }
          if (n) n.onchange = () => { const v = n.valueAsNumber; if (!Number.isFinite(v)) return; r.value = String(v); applyVal(v); commitCurrentGraph('微调叶片'); renderVectorOverlay(); scheduleEvaluate(false) }
        }
        bindLeafRange('tg-vl-rot', v => { selLeaf.rot = (v * Math.PI) / 180 })
        bindLeafRange('tg-vl-sx', v => { selLeaf.scaleX = Math.max(0.02, v) })
        bindLeafRange('tg-vl-sy', v => { selLeaf.scaleY = Math.max(0.02, v) })
        bindLeafRange('tg-vl-col', v => { selLeaf.colorIdx = Math.max(0, Math.round(v)) })
        bindLeafRange('tg-vl-z', v => { selLeaf.z = v })

        inspectorEl.querySelector('#tg-vl-flip')?.addEventListener('click', () => {
          applyPatch([{ op: 'upsertInstances', nodeId: node.id, instances: [{ ...selLeaf, flip: !selLeaf.flip }] }], '翻转叶片')
        })
        inspectorEl.querySelector('#tg-vl-dup')?.addEventListener('click', () => {
          const copyId = `${selLeaf.id}-c${Math.random().toString(36).slice(2, 4)}`
          const copy: VectorLeafInstance = {
            ...selLeaf, id: copyId,
            x: Math.min(0.95, selLeaf.x + 0.045), y: Math.min(0.95, selLeaf.y + 0.045), z: selLeaf.z + 0.02,
          }
          selectedLeafId = copyId
          applyPatch([{ op: 'upsertInstances', nodeId: node.id, instances: [copy] }], '复制叶片')
        })
        inspectorEl.querySelector('#tg-vl-del')?.addEventListener('click', () => {
          const dropId = selLeaf.id
          selectedLeafId = undefined
          applyPatch([{ op: 'removeInstances', nodeId: node.id, instanceIds: [dropId] }], '删除叶片')
        })
      }

      const selStem = getStems().find(x => x.id === selectedStemId)
      if (selStem) {
        const bindStemRange = (id: string, applyVal: (v: number) => void) => {
          const r = inspectorEl.querySelector<HTMLInputElement>(`#${id}`)
          const n = inspectorEl.querySelector<HTMLInputElement>(`#${id}-n`)
          if (!r) return
          r.oninput = () => { const v = r.valueAsNumber; if (n) n.value = String(v); applyVal(v); scheduleEvaluate(true) }
          r.onchange = () => { commitCurrentGraph('调节枝条粗细'); scheduleEvaluate(false) }
          if (n) n.onchange = () => { const v = n.valueAsNumber; if (!Number.isFinite(v)) return; r.value = String(v); applyVal(v); commitCurrentGraph('调节枝条粗细'); scheduleEvaluate(false) }
        }
        bindStemRange('tg-vs-ws', v => { selStem.widthStart = v })
        bindStemRange('tg-vs-we', v => { selStem.widthEnd = v })
        inspectorEl.querySelector('#tg-vs-addpt')?.addEventListener('click', () => {
          if (selStem.points.length >= 8) return
          const mid = evalStemPoint(selStem.points, 0.5)
          const insertAt = Math.ceil(selStem.points.length / 2)
          const nextPts = [...selStem.points.slice(0, insertAt), mid, ...selStem.points.slice(insertAt)]
          selectedStemPtIdx = insertAt
          applyPatch([{ op: 'upsertStems', nodeId: node.id, stems: [{ ...selStem, points: nextPts }] }], '细分枝条控制点')
        })
        inspectorEl.querySelector('#tg-vs-del')?.addEventListener('click', () => {
          const dropId = selStem.id
          selectedStemId = undefined
          applyPatch([{ op: 'removeStems', nodeId: node.id, stemIds: [dropId] }], '删除枝条')
        })
      }
    }

    inspectorEl.querySelector('#tg-insp-bypass')?.addEventListener('click', () => setBypass(node.id, !node.bypass))
    inspectorEl.querySelector('#tg-insp-seed')?.addEventListener('click', () => {
      applyPatch([{ op: 'setParam', nodeId: node.id, key: 'seed', value: Math.floor(Math.random() * 9999) }], '随机种子')
    })
    inspectorEl.querySelector('#tg-insp-del')?.addEventListener('click', () => deleteSelectedNode())
  }

  function addNode(type: NodeType, x?: number, y?: number): GraphNode {
    const rect = canvasWrap.getBoundingClientRect()
    const [cx, cy] = x !== undefined && y !== undefined
      ? [x, y]
      : clientToWorld(rect.left + rect.width * 0.45, rect.top + rect.height * 0.45)
    let nx = Math.round(cx - 80), ny = Math.round(cy - 60)
    while (graph.nodes.some(n => Math.hypot(n.x - nx, n.y - ny) < 28)) {
      nx += 28; ny += 28
    }
    const node = createNode(type, nx, ny)
    selectedNodeId = node.id
    applyPatch([{ op: 'addNode', node }], `添加 ${nodeDefinitions[type].shortLabel}`)
    return graph.nodes.find(n => n.id === node.id) ?? node
  }

  function duplicateNode(nodeId = selectedNodeId): GraphNode | undefined {
    if (!nodeId) return undefined
    const src = graph.nodes.find(n => n.id === nodeId)
    if (!src || src.type === 'output_material') {
      host.message('材质输出节点不可复制')
      return undefined
    }
    const newId = `${src.id}-copy-${Math.random().toString(36).slice(2, 5)}`
    const res = applyPatch([{ op: 'duplicateNode', nodeId: src.id, newId, dx: 44, dy: 44 }], `复制 ${src.id}`)
    if (!res.ok) return undefined
    selectedNodeId = newId
    syncNodeClasses()
    renderInspector()
    return graph.nodes.find(n => n.id === newId)
  }

  function setBypass(nodeId: string, on: boolean): boolean {
    return applyPatch([{ op: 'setBypass', nodeId, bypass: on }], on ? '开启直通' : '取消直通').ok
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return
    const target = graph.nodes.find(n => n.id === selectedNodeId)
    if (!target || target.type === 'output_material') {
      host.message('材质输出节点不可删除')
      return
    }
    if (pinnedNodeId === selectedNodeId) pinnedNodeId = undefined
    const dropId = selectedNodeId
    selectedNodeId = graph.nodes.find(n => n.id !== dropId)?.id
    applyPatch([{ op: 'removeNode', nodeId: dropId, bridge: true }], `删除 ${target.id}`)
  }

  // ---- Preview Canvas Unified Pointer Handler (Wipe / Eyedropper / Lit / Direct Vector Edit) ---
  prevBox.addEventListener('pointerdown', e => {
    const r = prevBox.getBoundingClientRect()
    const u = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
    const v = Math.max(0, Math.min(1, (e.clientY - r.top) / Math.max(1, r.height)))

    // 1. Reference Image Eyedropper (reads exact raw reference pixels!)
    if (refImage && compareMode === 'pick') {
      const picked = sampleReferencePixel(refImage, u, v)
      lastPicked = picked
      syncRefBarUi()
      if (activePickTarget) {
        const tgt = activePickTarget
        const n = graph.nodes.find(x => x.id === tgt.nodeId)
        if (n && Array.isArray(n.params[tgt.paramKey])) {
          const pal = [...(n.params[tgt.paramKey] as string[])]
          pal[tgt.swatchIdx] = picked.hex
          applyPatch([{ op: 'setParam', nodeId: tgt.nodeId, key: tgt.paramKey, value: pal }], '吸管更新色块')
          host.message(`已从参考图吸取 ${picked.hex}（Alpha ${Math.round(picked.a * 100)}%）`)
        }
        activePickTarget = undefined
        setCompareMode('wipe')
      } else {
        void navigator.clipboard?.writeText(picked.hex).catch(() => {})
        host.message(`参考图原像素：${picked.hex}（Alpha ${Math.round(picked.a * 100)}%）`)
      }
      return
    }

    // 2. Reference Split-Wipe Divider Dragging
    if (refImage && compareMode === 'wipe') {
      const updateWipe = (pe: PointerEvent) => {
        const rect = prevBox.getBoundingClientRect()
        wipePos = Math.max(0.04, Math.min(0.96, (pe.clientX - rect.left) / Math.max(1, rect.width)))
        renderPreviewCanvas()
      }
      updateWipe(e)
      const onMove = (me: PointerEvent) => updateWipe(me)
      const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      return
    }

    // 3. Direct 2D Canvas Manipulation for `vector_layout` (leaves & Bezier stem control points!)
    if (isDirectVectorEditActive()) {
      const vecNode = getActiveVectorNode()!
      const stems = Array.isArray(vecNode.params.stems) ? vecNode.params.stems as VectorStem[] : []
      const instances = Array.isArray(vecNode.params.instances) ? vecNode.params.instances as VectorLeafInstance[] : []

      // Check selected leaf's Rotate / Scale handles first!
      const curLeaf = instances.find(x => x.id === selectedLeafId)
      if (curLeaf) {
        const hw = curLeaf.scaleX * 0.42
        const hh = curLeaf.scaleY * 0.48
        const rotHandleDist = hh + 0.055
        const rx = curLeaf.x + Math.sin(curLeaf.rot) * rotHandleDist
        const ry = curLeaf.y - Math.cos(curLeaf.rot) * rotHandleDist
        const sx = curLeaf.x + Math.cos(curLeaf.rot) * hw - Math.sin(curLeaf.rot) * hh
        const sy = curLeaf.y + Math.sin(curLeaf.rot) * hw + Math.cos(curLeaf.rot) * hh

        if (Math.hypot(u - rx, v - ry) <= 0.036) {
          let moved = false
          const onMove = (me: PointerEvent) => {
            const rect = prevBox.getBoundingClientRect()
            const mu = (me.clientX - rect.left) / Math.max(1, rect.width)
            const mv = (me.clientY - rect.top) / Math.max(1, rect.height)
            curLeaf.rot = Math.atan2(mu - curLeaf.x, -(mv - curLeaf.y))
            moved = true
            renderVectorOverlay()
            scheduleEvaluate(true)
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            if (moved) { commitCurrentGraph(`旋转叶片 ${curLeaf.id}`); renderInspector(); scheduleEvaluate(false) }
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }

        if (Math.hypot(u - sx, v - sy) <= 0.036) {
          const origDist = Math.max(0.02, Math.hypot(u - curLeaf.x, v - curLeaf.y))
          const origSx = curLeaf.scaleX, origSy = curLeaf.scaleY
          let moved = false
          const onMove = (me: PointerEvent) => {
            const rect = prevBox.getBoundingClientRect()
            const mu = (me.clientX - rect.left) / Math.max(1, rect.width)
            const mv = (me.clientY - rect.top) / Math.max(1, rect.height)
            const factor = Math.max(0.25, Math.min(3.0, Math.hypot(mu - curLeaf.x, mv - curLeaf.y) / origDist))
            curLeaf.scaleX = Math.max(0.03, Math.min(0.6, origSx * factor))
            curLeaf.scaleY = Math.max(0.03, Math.min(0.6, origSy * factor))
            moved = true
            renderVectorOverlay()
            scheduleEvaluate(true)
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            if (moved) { commitCurrentGraph(`缩放叶片 ${curLeaf.id}`); renderInspector(); scheduleEvaluate(false) }
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }
      }

      const hit: VectorHitTarget | undefined = hitTestVectorLayout(stems, instances, u, v, selectedStemId)
      if (!hit) {
        selectedLeafId = undefined
        selectedStemId = undefined
        renderVectorOverlay()
        renderInspector()
        return
      }
      if (hit.kind === 'leaf') {
        selectedLeafId = hit.id
        selectedStemId = undefined
        renderVectorOverlay()
        renderInspector()
        const inst = instances.find(x => x.id === hit.id)!
        const offX = u - inst.x, offY = v - inst.y
        let moved = false
        const onMove = (me: PointerEvent) => {
          const rect = prevBox.getBoundingClientRect()
          const mu = (me.clientX - rect.left) / Math.max(1, rect.width)
          const mv = (me.clientY - rect.top) / Math.max(1, rect.height)
          const nx = Math.max(0.01, Math.min(0.99, mu - offX))
          const ny = Math.max(0.01, Math.min(0.99, mv - offY))
          if (Math.hypot(nx - inst.x, ny - inst.y) > 0.001) {
            inst.x = Number(nx.toFixed(4))
            inst.y = Number(ny.toFixed(4))
            moved = true
            renderVectorOverlay()
            scheduleEvaluate(true)
          }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (moved) { commitCurrentGraph(`拖拽叶片 ${inst.id}`); scheduleEvaluate(false) }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }
      if (hit.kind === 'stemPoint') {
        selectedStemId = hit.stemId
        selectedStemPtIdx = hit.pointIdx
        selectedLeafId = undefined
        renderVectorOverlay()
        renderInspector()
        const st = stems.find(s => s.id === hit.stemId)!
        let moved = false
        const onMove = (me: PointerEvent) => {
          const rect = prevBox.getBoundingClientRect()
          const mu = Math.max(0.01, Math.min(0.99, (me.clientX - rect.left) / Math.max(1, rect.width)))
          const mv = Math.max(0.01, Math.min(0.99, (me.clientY - rect.top) / Math.max(1, rect.height)))
          st.points[hit.pointIdx] = [Number(mu.toFixed(4)), Number(mv.toFixed(4))]
          moved = true
          renderVectorOverlay()
          scheduleEvaluate(true)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          if (moved) { commitCurrentGraph(`拖拽枝条 ${st.id}`); scheduleEvaluate(false) }
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }
      if (hit.kind === 'stem') {
        selectedStemId = hit.stemId
        selectedStemPtIdx = 0
        selectedLeafId = undefined
        renderVectorOverlay()
        renderInspector()
        return
      }
    }

    // 4. Interactive PBR Light Dragging in 'lit' channel
    if (previewChannel !== 'lit' || pinnedNodeId) return
    const updateLight = (pe: PointerEvent) => {
      const rect = prevBox.getBoundingClientRect()
      const nx = ((pe.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      const ny = ((pe.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
      lightAzimuth = Math.atan2(ny, nx)
      lightElevation = Math.max(0.25, Math.min(1.45, 1.4 - Math.hypot(nx, ny) * 0.7))
      renderPreviewCanvas()
    }
    updateLight(e)
    const onMove = (me: PointerEvent) => updateLight(me)
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })

  // ---- Canvas Pan, Zoom & Context Menu -------------------------------------
  canvasWrap.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.tg-node, .tg-graph-tools, .tg-wire-hit')) return
    ctxMenu.hidden = true
    if (e.button !== 0 && e.button !== 1) return
    canvasWrap.classList.add('is-panning')
    const sx = e.clientX, sy = e.clientY
    const ox = panX, oy = panY
    const onMove = (me: PointerEvent) => {
      panX = ox + (me.clientX - sx)
      panY = oy + (me.clientY - sy)
      applyWorldTransform()
    }
    const onUp = () => {
      canvasWrap.classList.remove('is-panning')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })

  canvasWrap.addEventListener('wheel', e => {
    e.preventDefault()
    const rect = canvasWrap.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 0.91
    const nextZoom = Math.max(0.32, Math.min(1.8, zoom * factor))
    panX = mx - ((mx - panX) / zoom) * nextZoom
    panY = my - ((my - panY) / zoom) * nextZoom
    zoom = nextZoom
    applyWorldTransform()
  }, { passive: false })

  let ctxWorldPos: [number, number] = [200, 160]
  canvasWrap.addEventListener('contextmenu', e => {
    e.preventDefault()
    ctxWorldPos = clientToWorld(e.clientX, e.clientY)
    ctxMenu.style.left = `${Math.min(window.innerWidth - 190, e.clientX)}px`
    ctxMenu.style.top = `${Math.min(window.innerHeight - 360, e.clientY)}px`
    ctxMenu.hidden = false
  })
  document.addEventListener('pointerdown', e => {
    if (!ctxMenu.hidden && !(e.target as HTMLElement).closest('.tg-ctx-menu')) ctxMenu.hidden = true
  })
  for (const btn of ctxMenu.querySelectorAll<HTMLButtonElement>('[data-ctx-node]')) {
    btn.onclick = () => { ctxMenu.hidden = true; addNode(btn.dataset.ctxNode as NodeType, ctxWorldPos[0], ctxWorldPos[1]) }
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-add-node]')) {
    btn.onclick = () => addNode(btn.dataset.addNode as NodeType)
  }

  // ---- Quick Node Search Modal & Graph JSON Modal --------------------------
  const searchInput = searchModal.querySelector<HTMLInputElement>('#tg-search-input')!
  const searchList = searchModal.querySelector<HTMLElement>('#tg-search-list')!
  let searchMatches: NodeType[] = []

  function renderSearchMatches() {
    const term = searchInput.value.trim().toLowerCase()
    searchMatches = allNodeTypes.filter(t => {
      if (t === 'output_material') return false
      const d = nodeDefinitions[t]
      return !term
        || t.includes(term)
        || d.label.toLowerCase().includes(term)
        || d.shortLabel.toLowerCase().includes(term)
        || d.description.toLowerCase().includes(term)
    })
    searchList.innerHTML = searchMatches.map((t, idx) => {
      const d = nodeDefinitions[t]
      return `<button type="button" class="tg-search-item${idx === 0 ? ' is-active' : ''}" data-pick-node="${t}">
        <span><span class="tg-pal-dot tg-cat-${d.category}" style="display:inline-block;margin-right:6px"></span>${esc(d.label)}</span>
        <span style="font-size:10px;color:#8fa3b4">${esc(d.shortLabel)}</span>
      </button>`
    }).join('') || '<p style="font-size:12px;color:#8fa3b4;margin:6px">无匹配节点</p>'
    for (const btn of searchList.querySelectorAll<HTMLButtonElement>('[data-pick-node]')) {
      btn.onclick = () => { searchModal.hidden = true; addNode(btn.dataset.pickNode as NodeType) }
    }
  }
  function openSearchModal() {
    searchModal.hidden = false
    searchInput.value = ''
    renderSearchMatches()
    searchInput.focus()
  }
  searchInput.oninput = renderSearchMatches
  searchInput.onkeydown = e => {
    if (e.key === 'Escape') searchModal.hidden = true
    else if (e.key === 'Enter' && searchMatches.length > 0) {
      e.preventDefault()
      searchModal.hidden = true
      addNode(searchMatches[0])
    }
  }
  searchModal.onclick = e => { if (e.target === searchModal) searchModal.hidden = true }

  const jsonText = jsonModal.querySelector<HTMLTextAreaElement>('#tg-json-text')!
  const jsonVerLabel = jsonModal.querySelector<HTMLElement>('#tg-json-ver')!
  function openJsonModal() {
    const clean = normalizeGraphSchemaVersion(graph)
    jsonVerLabel.textContent = `schemaVersion: ${clean.schemaVersion} · rev ${history.revision}`
    jsonText.value = JSON.stringify(clean, null, 2)
    jsonModal.hidden = false
  }
  jsonModal.querySelector('#tg-json-close')!.addEventListener('click', () => { jsonModal.hidden = true })
  jsonModal.onclick = e => { if (e.target === jsonModal) jsonModal.hidden = true }
  jsonModal.querySelector('#tg-json-copy')!.addEventListener('click', () => {
    void navigator.clipboard?.writeText(jsonText.value).catch(() => {})
    host.message('已复制节点图 JSON')
  })
  jsonModal.querySelector('#tg-json-apply')!.addEventListener('click', () => {
    try {
      const parsed = parseTextureGraph(JSON.parse(jsonText.value), { strict: true })
      graph = parsed
      commitCurrentGraph('导入节点图 JSON')
      selectedNodeId = graph.nodes.find(n => n.type !== 'output_material')?.id ?? graph.nodes[0]?.id
      pinnedNodeId = undefined
      syncHeader()
      renderNodes()
      renderInspector()
      requestAnimationFrame(() => { renderWires(); fitView() })
      scheduleEvaluate(false)
      jsonModal.hidden = true
      host.message(`已校验并载入 v${parsed.schemaVersion} 节点图（${parsed.nodes.length} 节点）`)
    } catch (err) {
      host.message(err instanceof Error ? err.message : String(err), true)
    }
  })

  // ---- Reference Image Comparator Wiring -----------------------------------
  async function setReferenceImage(src: string | File, name?: string): Promise<ReferenceImageState> {
    const decoded = await decodeReferenceImage(src, name)
    refImage = decoded
    lastPicked = undefined
    if (compareMode === 'off') compareMode = 'wipe'
    renderPreviewCanvas()
    host.message(`已载入参考图「${decoded.name}」（${decoded.width}×${decoded.height}）`)
    return decoded
  }
  function clearReferenceImage() {
    refImage = undefined
    compareMode = 'off'
    lastPicked = undefined
    lastRefScoreText = ''
    activePickTarget = undefined
    renderPreviewCanvas()
  }
  function setCompareMode(mode: CompareMode) {
    compareMode = refImage ? mode : 'off'
    renderPreviewCanvas()
  }

  // ---- Agent-Native Reference Replication Bridge (Shared with Browser UI & Automation) ---
  function commitAgentGraph(nextGraph: TextureGraph, label: string) {
    graph = normalizeGraphSchemaVersion(cloneGraph(nextGraph))
    commitCurrentGraph(label)
    const pref = graph.nodes.find(n => n.type === 'vector_layout' || n.type === 'painterly_bark' || n.type === 'branch_scatter')
    selectedNodeId = pref?.id ?? graph.nodes.find(n => n.type !== 'output_material')?.id ?? graph.nodes[0]?.id
    pinnedNodeId = undefined
    selectedLeafId = undefined
    selectedStemId = undefined
    tile2x2 = graph.targetSlot === 'bark'
    syncHeader()
    renderNodes()
    renderInspector()
    requestAnimationFrame(() => { renderWires(); fitView() })
    scheduleEvaluate(false)
  }

  const coreAgent = createBrowserTextureAgentApi({
    getGraph: () => cloneGraph(graph),
    commitGraph: commitAgentGraph,
  })

  async function resolveRefPixels(src?: string | File | RgbaImageData): Promise<{ img: RgbaImageData; name: string }> {
    if (src && typeof src === 'object' && 'data' in src && 'width' in src && 'height' in src) {
      return { img: src, name: 'reference' }
    }
    if (src) {
      const dec = await decodeReferenceImage(src)
      return { img: { width: dec.width, height: dec.height, data: dec.rgba }, name: dec.name }
    }
    if (refImage) {
      return { img: { width: refImage.width, height: refImage.height, data: refImage.rgba }, name: refImage.name }
    }
    throw new Error('请先载入或传入参考图')
  }

  function formatScoreChip(s: ScoreBreakdown): string {
    if (s.mode === 'bark_tile') {
      return `得分 ${s.totalScore.toFixed(1)} · 苔藓${Math.round((s.mossCoverageGen ?? 0) * 100)}%`
    }
    return `得分 ${s.totalScore.toFixed(1)} · IoU ${Math.round((s.alphaIoU ?? 0) * 100)}% · ΔE ${(s.labDeltaE00Median ?? 0).toFixed(1)}`
  }

  const agentBridge: TextureAgentBridge = {
    getSchema: () => coreAgent.getSchema(),
    getGraph: () => cloneGraph(graph),
    loadGraph: g => commitAgentGraph(g, 'Agent 载入节点图'),
    applyPatch: (ops, label, baseRev) => applyPatch(ops, label, baseRev),
    async analyzeReference(src, opts = {}) {
      const { img, name } = await resolveRefPixels(src)
      const res = coreAgent.analyzeReference(img, {
        name: opts.name ?? name.replace(/\.[^.]+$/, ''),
        resolution: opts.resolution ?? graph.resolution,
      })
      if (opts.applyDraft !== false) {
        commitAgentGraph(res.draftGraph, `参考图自动分析初稿 (${res.kind})`)
        const initScore = coreAgent.scoreAgainstReference(img, res.scoreMode, 256)
        lastRefScoreText = formatScoreChip(initScore)
        syncRefBarUi()
      }
      return res
    },
    async scoreAgainstReference(src, mode, res = 256) {
      const { img } = await resolveRefPixels(src)
      const score = coreAgent.scoreAgainstReference(img, mode, res)
      lastRefScoreText = formatScoreChip(score)
      syncRefBarUi()
      return score
    },
    async optimizeAgainstReference(src, opts = {}) {
      const { img } = await resolveRefPixels(src)
      const opt = coreAgent.optimizeAgainstReference(img, opts)
      lastRefScoreText = formatScoreChip(opt.bestScore256)
      syncRefBarUi()
      return opt
    },
    async renderDiagnosticDataUrl(src, mode, panelSize = 256) {
      const { img } = await resolveRefPixels(src)
      const { sheet, score } = coreAgent.renderDiagnosticSheet(img, mode, panelSize)
      const c = document.createElement('canvas')
      c.width = sheet.width
      c.height = sheet.height
      const g = c.getContext('2d')!
      const id = g.createImageData(sheet.width, sheet.height)
      id.data.set(sheet.data)
      g.putImageData(id, 0, 0)
      return { dataUrl: c.toDataURL('image/png'), score, width: sheet.width, height: sheet.height }
    },
    async saveAndApply(name) {
      if (name) { graph.name = name; syncHeader() }
      await runEvaluateAsync(graph.resolution, true, false)
      return saveToLibrary(false)
    },
    getLastAnalysis: () => coreAgent.getLastAnalysis(),
    getLastOptimize: () => coreAgent.getLastOptimize(),
  }

  refAnalyzeBtn.onclick = () => {
    if (!refImage) return
    refAnalyzeBtn.disabled = true
    void agentBridge.analyzeReference(undefined, { applyDraft: true }).then(res => {
      host.message(`已分析为「${res.kind}」（置信度 ${Math.round(res.confidence * 100)}%，${res.evidence.detectedLeaves} 叶 / ${res.evidence.detectedStems} 枝），可直接拖拽修改或 Ctrl+Z 撤销`)
    }).catch(err => host.message(String(err), true)).finally(() => { refAnalyzeBtn.disabled = false })
  }
  refOptimizeBtn.onclick = () => {
    if (!refImage) return
    refOptimizeBtn.disabled = true
    host.message('正在运行缓存感知局部寻优…')
    setTimeout(() => {
      void agentBridge.optimizeAgainstReference(undefined, { maxEvals: 72 }).then(opt => {
        host.message(opt.improved
          ? `寻优完成：${opt.initialScore256.totalScore.toFixed(1)} → ${opt.bestScore256.totalScore.toFixed(1)} 分（${opt.telemetry.totalEvals} 次求值 · 命中率 ${Math.round(opt.telemetry.cacheHitRate * 100)}% · ${Math.round(opt.telemetry.wallMsTotal)} ms）`
          : `当前初稿已接近局部最优（${opt.bestScore256.totalScore.toFixed(1)} 分 · ${opt.telemetry.totalEvals} 次求值）`)
      }).catch(err => host.message(String(err), true)).finally(() => { refOptimizeBtn.disabled = false })
    }, 16)
  }

  q('#tg-ref-load').onclick = () => refFileInput.click()
  refFileInput.onchange = () => {
    const f = refFileInput.files?.[0]
    if (!f) return
    void setReferenceImage(f).catch(err => host.message(String(err), true))
    refFileInput.value = ''
  }
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-cmp]')) {
    btn.onclick = () => setCompareMode(btn.dataset.cmp as CompareMode)
  }
  refOnionInput.oninput = () => { onionAlpha = refOnionInput.valueAsNumber; renderPreviewCanvas() }
  refClearBtn.onclick = clearReferenceImage

  // ---- Header & Preview Toolbar Controls -----------------------------------
  function syncHeader() {
    nameInput.value = graph.name
    slotSelect.value = graph.targetSlot
    resSelect.value = String(graph.resolution)
    liveSyncBtn.setAttribute('aria-pressed', String(liveSync))
    saveOverBtn.hidden = !activeSavedId
    toggleFullBtn.textContent = isFull ? '◧ 分屏联动' : '⛶ 全屏'
    syncUndoRedoButtons()
  }

  nameInput.oninput = () => { graph.name = nameInput.value.trim() || '未命名贴图' }
  nameInput.onchange = () => commitCurrentGraph('改名')
  slotSelect.onchange = () => {
    const slot = slotSelect.value as EditableTextureSlot
    applyPatch([{ op: 'setMeta', targetSlot: slot, category: defaultCategoryForSlot(slot), seamless: slot === 'bark' }], '切换贴图槽位')
    tile2x2 = slot === 'bark'
  }
  resSelect.onchange = () => {
    const r = Number(resSelect.value)
    const nextRes: 256 | 512 | 1024 = r === 256 || r === 1024 ? r : 512
    applyPatch([{ op: 'setMeta', resolution: nextRes }], '切换分辨率')
  }
  templateSelect.onchange = () => {
    const id = templateSelect.value
    if (!id) return
    loadTemplate(id)
    templateSelect.value = ''
  }
  liveSyncBtn.onclick = () => {
    liveSync = !liveSync
    liveSyncBtn.setAttribute('aria-pressed', String(liveSync))
    if (liveSync && lastOutput) {
      const tex = materialOutputToThreeTexture(lastOutput, graph.targetSlot, graph.name)
      const grid = detectGraphAtlasGrid(graph)
      const regions = detectGraphAtlasRegions(graph)
      const meta = (grid || regions) ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions } : undefined
      host.applyTexture(graph.targetSlot, tex, `◈ ${graph.name}`, meta)
      host.message('已开启实时同步 3D 树木')
    }
  }
  q('#tg-apply-now').onclick = () => {
    const baked = syncBakeEvaluator.evaluate(graph, graph.resolution)
    lastOutput = baked.output
    renderPreviewCanvas()
    const tex = materialOutputToThreeTexture(baked.output, graph.targetSlot, graph.name)
    const grid = detectGraphAtlasGrid(graph)
    const regions = detectGraphAtlasRegions(graph)
    const meta = (grid || regions) ? { atlasCols: grid?.cols, atlasRows: grid?.rows, atlasRegions: regions } : undefined
    host.applyTexture(graph.targetSlot, tex, `◈ ${graph.name}`, meta)
    host.message(`已将「${graph.name}」应用到 ${slotLabels[graph.targetSlot]}`)
  }

  async function saveToLibrary(overwrite = false): Promise<SavedTextureItem> {
    const cleanName = (nameInput.value.trim() || graph.name || '我的程序贴图').slice(0, 80)
    graph = normalizeGraphSchemaVersion({ ...graph, name: cleanName })
    const baked = syncBakeEvaluator.evaluate(graph, graph.resolution)
    lastOutput = baked.output
    const pbr = materialOutputToPbrDataUrls(baked.output, graph.targetSlot)
    const dataUrl = pbr.baseColor
    const thumbnail = materialOutputToDataUrl(baked.output, graph.targetSlot, 192)
    const atlasRegions = detectGraphAtlasRegions(graph)
    const payload = {
      name: cleanName,
      category: graph.category,
      targetSlot: graph.targetSlot,
      resolution: graph.resolution,
      seamless: graph.seamless,
      atlasRegions,
      dataUrl,
      normalDataUrl: pbr.normal,
      heightDataUrl: pbr.height,
      roughnessDataUrl: pbr.roughness,
      thumbnail,
      graph,
    }
    let saved: SavedTextureItem
    if (overwrite && activeSavedId && host.store.get(activeSavedId)) {
      saved = await host.store.overwrite(activeSavedId, payload)
      host.message(`已覆盖更新贴图库「${saved.name}」（含完整 PBR 通道）`)
    } else {
      saved = await host.store.saveNew(payload)
      activeSavedId = saved.id
      host.message(`已保存到实时贴图库「${saved.name}」（v${graph.schemaVersion} · 完整 PBR 通道落盘）`)
    }
    syncHeader()
    return saved
  }

  q('#tg-save-new').onclick = () => { void saveToLibrary(false).catch(err => host.message(String(err), true)) }
  saveOverBtn.onclick = () => { void saveToLibrary(true).catch(err => host.message(String(err), true)) }

  function exportPbrDataUrls() {
    const baked = syncBakeEvaluator.evaluate(graph, graph.resolution)
    return materialOutputToPbrDataUrls(baked.output, graph.targetSlot)
  }

  q('#tg-export-png').onclick = () => {
    const baked = syncBakeEvaluator.evaluate(graph, graph.resolution)
    const out = baked.output
    const buf: ImageBuffer =
      previewChannel === 'normal' ? out.normal
        : previewChannel === 'height' ? out.heightMap
          : previewChannel === 'roughness' ? out.roughness
            : out.baseColor
    const canvas = document.createElement('canvas')
    canvas.width = buf.width; canvas.height = buf.height
    const bytes = bufferToRgbaBytes(buf, {
      dilateAlpha: previewChannel === 'baseColor' && graph.targetSlot !== 'bark' && out.alphaDilated,
      showAlphaOnly: previewChannel === 'alpha',
    })
    const g = canvas.getContext('2d')!
    const img = g.createImageData(buf.width, buf.height)
    img.data.set(bytes)
    g.putImageData(img, 0, 0)
    const suffix = previewChannel === 'baseColor' || previewChannel === 'lit' ? 'basecolor' : previewChannel
    const link = document.createElement('a')
    link.download = `${(graph.name || 'texture').replace(/[\\/:*?"<>|]/g, '_')}-${suffix}-${buf.width}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    host.message(`已导出 ${link.download}`)
  }

  q('#tg-export-pbr').onclick = () => {
    const maps = exportPbrDataUrls()
    const base = (graph.name || 'texture').replace(/[\\/:*?"<>|]/g, '_')
    const entries: [string, string][] = [
      ['basecolor', maps.baseColor],
      ['normal_opengl', maps.normal],
      ['height', maps.height],
      ['roughness', maps.roughness],
      ...(maps.alpha ? [['alpha', maps.alpha] as [string, string]] : []),
    ]
    entries.forEach(([ch, url], idx) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.download = `${base}-${ch}-${graph.resolution}.png`
        a.href = url
        a.click()
      }, idx * 90)
    })
    host.message(`已导出全套 ${entries.length} 个 PBR 通道 PNG（${graph.resolution}px）`)
  }

  q('#tg-json-io').onclick = openJsonModal

  function setFullscreen(full: boolean) {
    isFull = full
    root.classList.toggle('is-full', isFull)
    root.classList.toggle('is-split', !isFull)
    document.body.classList.toggle('tg-split', openState && !isFull)
    syncHeader()
    window.dispatchEvent(new Event('resize'))
    requestAnimationFrame(() => { renderWires(); fitView() })
  }
  toggleFullBtn.onclick = () => setFullscreen(!isFull)
  q('#tg-close').onclick = () => close()

  // Channel buttons & toggles
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-ch]')) {
    btn.onclick = () => {
      previewChannel = btn.dataset.ch as PreviewChannel
      for (const o of root.querySelectorAll<HTMLButtonElement>('[data-ch]')) {
        o.setAttribute('aria-pressed', String(o === btn))
      }
      // Only re-evaluate if the latest frame skipped PBR maps (fast drag preview)
      if ((previewChannel === 'normal' || previewChannel === 'roughness' || previewChannel === 'lit') && (!lastOutput || lastSkippedPbr)) {
        void runEvaluateAsync(Math.min(256, graph.resolution), false, false)
      } else {
        renderPreviewCanvas()
      }
    }
  }
  prevPinBtn.onclick = () => {
    if (pinnedNodeId) pinnedNodeId = undefined
    else if (selectedNodeId) pinnedNodeId = selectedNodeId
    syncNodeClasses()
    void runEvaluateAsync(Math.min(256, graph.resolution), false, false)
  }
  prevTileBtn.onclick = () => { tile2x2 = !tile2x2; renderPreviewCanvas() }

  // Graph tools
  undoBtn.onclick = () => undo()
  redoBtn.onclick = () => redo()
  q('#tg-search-node').onclick = openSearchModal
  q('#tg-dup-node').onclick = () => duplicateNode()
  q('#tg-bypass-node').onclick = () => {
    const n = graph.nodes.find(x => x.id === selectedNodeId)
    if (n && n.type !== 'output_material') setBypass(n.id, !n.bypass)
  }
  q('#tg-zoom-in').onclick = () => { zoom = Math.min(1.8, zoom * 1.15); applyWorldTransform() }
  q('#tg-zoom-out').onclick = () => { zoom = Math.max(0.32, zoom * 0.87); applyWorldTransform() }
  zoomResetBtn.onclick = () => { zoom = 1; applyWorldTransform() }
  q('#tg-fit').onclick = () => fitView()
  q('#tg-layout').onclick = () => autoLayout()
  q('#tg-del-node').onclick = () => deleteSelectedNode()

  // Keyboard shortcuts
  const onKeyDown = (e: KeyboardEvent) => {
    if (!openState) return
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); undo()
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault(); redo()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault(); duplicateNode()
    } else if (e.key === 'Tab') {
      e.preventDefault(); openSearchModal()
    } else if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey) {
      const n = graph.nodes.find(x => x.id === selectedNodeId)
      if (n && n.type !== 'output_material') { e.preventDefault(); setBypass(n.id, !n.bypass) }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); deleteSelectedNode()
    } else if (e.key === 'Escape') {
      if (!ctxMenu.hidden) ctxMenu.hidden = true
      if (!searchModal.hidden) searchModal.hidden = true
      if (!jsonModal.hidden) jsonModal.hidden = true
    }
  }
  window.addEventListener('keydown', onKeyDown)

  // ---- Open / Close / Template Loading -------------------------------------
  function loadGraphInternal(next: TextureGraph, savedId?: string) {
    graph = normalizeGraphSchemaVersion(cloneGraph(next))
    history.reset(graph, '载入节点图')
    activeSavedId = savedId
    pinnedNodeId = undefined
    selectedLeafId = undefined
    selectedStemId = undefined
    // Auto-select vector_layout if present so direct canvas editing works immediately!
    const vec = graph.nodes.find(n => n.type === 'vector_layout')
    selectedNodeId = vec?.id ?? graph.nodes.find(n => n.type !== 'output_material')?.id ?? graph.nodes[0]?.id
    tile2x2 = graph.targetSlot === 'bark'
    workerClient.clear()
    syncBakeEvaluator.clear()
    syncHeader()
    renderNodes()
    renderInspector()
    requestAnimationFrame(() => {
      fitView()
      renderWires()
      void runEvaluateAsync(graph.resolution, true, false)
    })
  }

  function loadTemplate(templateId: string) {
    const tpl = getTextureTemplate(templateId)
    if (!tpl) return
    loadGraphInternal(tpl.build(), undefined)
    host.message(`已载入节点模板「${tpl.name}」`)
  }

  function open(options: { slot?: EditableTextureSlot; graph?: TextureGraph; savedId?: string; templateId?: string } = {}) {
    host.onOpen?.()
    openState = true
    root.hidden = false
    document.body.classList.toggle('tg-split', !isFull)
    window.dispatchEvent(new Event('resize'))

    if (options.graph) {
      loadGraphInternal(options.graph, options.savedId)
    } else if (options.templateId && getTextureTemplate(options.templateId)) {
      loadGraphInternal(getTextureTemplate(options.templateId)!.build(), undefined)
    } else if (options.slot) {
      loadGraphInternal(defaultTemplateForSlot(options.slot), undefined)
    } else if (!lastOutput) {
      loadGraphInternal(graph, activeSavedId)
    } else {
      syncHeader()
      requestAnimationFrame(() => { renderWires(); fitView() })
    }
  }

  function close() {
    if (!openState) return
    openState = false
    root.hidden = true
    ctxMenu.hidden = true
    searchModal.hidden = true
    jsonModal.hidden = true
    document.body.classList.remove('tg-split')
    window.dispatchEvent(new Event('resize'))
    host.onClose?.()
  }

  return {
    open,
    close,
    isOpen: () => openState,
    getGraph: () => cloneGraph(graph),
    loadGraph: (g, savedId) => loadGraphInternal(g, savedId),
    loadTemplate,
    addNode,
    duplicateNode,
    setBypass,
    connectPorts,
    setNodeParam: (id, key, val) => { setNodeParam(id, key, val, false, true); renderInspector() },
    applyPatch,
    undo,
    redo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    getRevision: () => history.revision,
    setLiveSync: on => { liveSync = on; syncHeader() },
    saveToLibrary,
    setFullscreen,
    setReferenceImage,
    clearReferenceImage,
    setCompareMode,
    sampleReferenceAt: (u, v) => (refImage ? sampleReferencePixel(refImage, u, v) : undefined),
    exportPbrDataUrls,
    getLastMetrics: () => (lastMetrics ? { ...lastMetrics } : undefined),
    agent: agentBridge,
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      if (highResTimer) clearTimeout(highResTimer)
      workerClient.dispose()
      close()
      root.remove()
      ctxMenu.remove()
      searchModal.remove()
      jsonModal.remove()
    },
  }
}

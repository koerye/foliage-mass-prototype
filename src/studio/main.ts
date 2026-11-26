import '../style.css'
import './studio.css'
import { Box3, Vector3, type Texture } from 'three'
import { lightingPresets, Viewer, type Camera, type LightingPreset } from '../viewport'
import { exportGlb } from '../export-glb'
import { buildTree, isOptimizeOnlyParam, isWoodOnlyParam, views, type TreeAsset, type View } from '../tree/assemble'
import { barkClayView } from '../tree/bark-material'
import { CrownEnvelope, defaultHandles } from '../tree/envelope'
import { buildSkeleton } from '../tree/skeleton'
import { lodPresets, optimizeAt, solveForTriangleBudget } from '../tree/optimize'
import { defaultOptimize, parseTreeSpec, presetIds, presets, presetSpec, type BranchEdit, type LeafNormalEditSpec, type PresetId, type TreeKind, type TreeSpec } from '../tree/spec'
import { CrownEditor, type EditSubMode, type GizmoKind, type NormalTool } from './editor'
import { bindEditToolsUi, editToolsHtml } from './editor-ui'
import { bindGlbExportPopover } from './glb-export-ui'
import { bindPanel, panelHtml, setPath } from './panel'
import { createDefaultOverrideStore } from './default-overrides'
import { mountPresetLibrary } from './preset-library'
import { captureViewportThumbnail, createPresetStore, deepClone } from './preset-store'
import { bindTextureSlots, createTextureRegistry, editableTextureSlots, type AllTextureSlot, type EditableTextureSlot } from './texture-slots'
import { captureCustomRegistryTextures, decodeSavedTextureMap, parseSavedTextureMap, type SavedTextureMap } from './texture-serialize'
import { activityLog, initStudioLogging } from './activity-log'
import { mountActivityLogDrawer } from './activity-log-ui'
import { blobToBase64, mountDesktopToolbarBadge, tryDesktopSaveBlob } from './desktop-bridge'
import { SnapshotHistory } from './history'
import { mountTextureEditor } from '../texgraph/editor-ui'
import {
  attachTextureGraphSource, mountTextureLibrary, resolveSlotEditorOptions, type AppliedTextureMeta,
} from '../texgraph/library-ui'
import { createTextureLibraryStore } from '../texgraph/store'
import { makePainterlyDriftwoodBarkTexture, makePainterlyMossBarkTexture } from '../texgraph/templates'
import { defaultCategoryForSlot } from '../texgraph/types'
import { makeBirchPreviewTexture } from '../assembly/birch-bark'
import { resolveAssemblyTreeSpec } from '../assembly/builder'
import type { BarkStyle, TreeForm } from '../tree/spec'
import {
  loadSceneEditSession, loadSceneEditSessionAsync, saveSceneEditProgressAsync,
  type SceneEditBridgeSession, type ScenePlantAppearance,
} from '../assembly/studio-bridge'

const sceneEditParam = new URL(location.href).searchParams.get('sceneEdit')
let activeSceneEdit: SceneEditBridgeSession | undefined = sceneEditParam ? loadSceneEditSession(sceneEditParam) : undefined
let sceneEditHydrated = false
let initialSceneEditSnapshot: {
  spec: TreeSpec
  appearance: ScenePlantAppearance
  lighting: LightingPreset
  customTextures?: SavedTextureMap
} | undefined
const sceneEditAppearance: ScenePlantAppearance = activeSceneEdit
  ? {
      barkStyle: activeSceneEdit.barkStyle,
      crownStyle: activeSceneEdit.crownStyle,
      treeForm: activeSceneEdit.treeForm,
      leafTexture: activeSceneEdit.leafTexture,
      category: activeSceneEdit.category,
      lighting: activeSceneEdit.lighting,
    }
  : {}
const previewBarkTemplates: Partial<Record<BarkStyle, Texture>> = {}
const escHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cameras: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const viewLabel: Record<View, string> = { final: '成品', skeleton: '枝干骨架', crown: '树冠' }
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')
const lowIds: PresetId[] = ['shrub-round', 'shrub-spread', 'shrub-flower', 'conifer-shrub', 'grass-clump', 'grass-narrow', 'grass-dense', 'grass-tall', 'fern']
const presetGroups: [string, PresetId[]][] = [
  ['风格化植物 · 16 套高精库', presetIds.filter(id => presets[id].kind === 'botanical')],
  ['阔叶树', presetIds.filter(id => presets[id].kind === 'broadleaf' && !lowIds.includes(id))],
  ['针叶树', presetIds.filter(id => presets[id].kind === 'conifer' && !lowIds.includes(id))],
  ['棕榈树', presetIds.filter(id => presets[id].kind === 'palm')],
  ['竹子', presetIds.filter(id => presets[id].kind === 'bamboo')],
  ['荷花水生', presetIds.filter(id => presets[id].kind === 'lotus')],
  ['低矮植物', lowIds],
  ['花丛模板', presetIds.filter(id => presets[id].kind === 'flowerbed')],
]

byId('app').classList.add('s-studio')
if (activeSceneEdit) byId('app').classList.add('has-scene-edit')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark" aria-hidden="true">♧</span><div><h1>Vegetation Studio</h1><span>程序化树木工作台 · v2</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./ai.html" title="空白工程 · 拖图自动生成并暴露全部参数能力">✦ AI 模式</a>
    <a class="b-link" href="./rock.html" title="风格化石头工作台 · 切面雕刻与赛璐璐">◈ 石头工作台</a>
    <a class="b-link" href="./scene.html" title="场景组装工作台 · 自由摆放树木花草石头查看整体效果">❖ 场景组装</a>
    <a class="b-link" href="./legacy.html">旧版工作台</a>
    <button id="tex-editor" class="tg-open-btn" title="打开 Substance 风格树叶/树皮程序化贴图节点编辑器">◈ 贴图编辑</button>
    <button id="tex-lib" class="tl-open-btn" title="打开实时贴图库（支持悬停 3D 预览、保存与复用）">🎨 贴图库<span class="pl-badge" id="tex-lib-count">0</span></button>
    <button id="preset-save" class="pl-save-btn" title="带当前 3D 实时封面保存为预设">★ 保存预设</button>
    <button id="preset-lib" title="打开可视化预设库（支持悬停实时 3D 预览）">预设库<span class="pl-badge" id="preset-lib-count">0</span></button>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button><button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button><button id="png-alpha" title="导出透明背景抠图 PNG（自动隐藏背景与阴影底板）">透明底 PNG</button><button id="glb" class="primary" title="导出 GLB / 拆分 glTF+贴图 / FBX+TEX">导出 GLB/FBX</button>
    <button id="activity-log-btn" class="al-open-btn" title="查看每一步用户操作与导出诊断日志（支持一键复制/导出排查问题）">📋 日志<span class="pl-badge" id="al-badge">0</span></button>
  </nav>
</header>
<div class="se-return-banner" id="scene-edit-banner" ${activeSceneEdit ? '' : 'hidden'}>
  <div class="se-return-info">
    <span class="se-return-badge">❖ 组装场景联调</span>
    <span class="se-return-text">正在编辑「${escHtml(activeSceneEdit?.sceneName ?? '组装场景')}」中的 <strong>${escHtml(activeSceneEdit?.itemName ?? '')}</strong></span>
  </div>
  <div class="se-appearance-picks" id="scene-edit-picks" ${activeSceneEdit ? '' : 'hidden'}>
    <label id="se-bark-wrap" hidden><span>树皮</span>
      <select id="se-bark-select">
        <option value="default">默认程序</option>
        <option value="birch">白桦浅灰</option>
        <option value="driftwood">古木宽纹</option>
        <option value="moss">苍古苔藓</option>
      </select>
    </label>
    <label id="se-form-wrap" hidden><span>形态</span>
      <select id="se-form-select">
        <option value="meadow-birch">白桦预设骨架</option>
        <option value="free">自由参数骨架</option>
      </select>
    </label>
  </div>
  <div class="se-return-acts">
    <button type="button" id="scene-edit-cancel" class="se-return-cancel">✕ 取消返回</button>
    <button type="button" id="scene-edit-apply" class="se-return-apply">✓ 完成并返回组装工作台</button>
  </div>
</div>
<section class="workspace">
  <section class="viewport panel" aria-label="三维工作区">
    <header class="viewport-head"><h2 id="tree-title">树</h2><div style="display:flex;gap:8px;align-items:center"><button type="button" id="wind-toggle" aria-pressed="true" title="开关微风轻拂动画" style="font-size:12px;padding:4px 9px;border-radius:8px">🍃 微风</button><select id="lighting" title="预览氛围光预设" style="font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid rgba(40,56,44,.16);background:rgba(255,255,255,.78)">
      ${Object.entries(lightingPresets).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
    </select><div class="switcher" role="group" aria-label="显示模式">
      ${views.map(v => `<button data-view="${v}" aria-pressed="${v === 'final'}">${viewLabel[v]}</button>`).join('')}
    </div></div></header>
    <div class="stage"><div id="canvas"></div>
      <div class="camera-tools switcher" role="group" aria-label="固定机位">
        ${Object.entries(cameras).map(([k, l]) => `<button data-camera="${k}" aria-pressed="${k === 'front'}">${l}</button>`).join('')}
      </div>
      ${editToolsHtml('✎ 节点编辑')}
      <div class="gesture">拖动旋转 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats s-stats">
      ${Object.entries({ branches: '枝条', twigs: '细枝', leaves: '叶片卡', triangles: '三角面', ms: '生成 ms', calls: 'Draw Calls' }).map(([k, l]) =>
        `<div><span id="label-${k}">${l}</span><output id="stat-${k}">—</output></div>`).join('')}
    </div>
  </section>
  <form class="inspector panel s-inspector" id="form" aria-label="树木参数" onsubmit="return false">
    <header class="inspect-head"><h2>树木参数</h2><button id="reset" type="button">恢复预设</button></header>
    <div class="s-scroll" id="panel">
      <label class="s-field s-top"><span>树种预设</span><select id="preset">
        ${presetGroups.map(([label, ids]) => `<optgroup label="${label}">${ids.map(id => `<option value="${id}">${presets[id].name}</option>`).join('')}</optgroup>`).join('')}
      </select><i></i></label>
      <div class="dp-bar" id="default-preset-bar">
        <button type="button" id="save-default" class="dp-save-btn" title="将当前参数保存并替换当前内置默认预设（写入本地文件，刷新后永久生效）">★ 保存替换默认预设</button>
        <button type="button" id="reset-factory" class="dp-factory-btn" title="清除自定义覆盖，恢复出厂内置默认参数" hidden>恢复出厂</button>
      </div>
      <label class="s-field s-top"><span>随机种子</span><input id="seed" type="number" min="0" step="1"><button type="button" id="reseed" title="随机">🎲</button></label>
      ${panelHtml()}
    </div>
  </form>
</section>
<div id="toast" class="toast" role="status" hidden></div>`

function syncStudioTop() {
  const bar = document.querySelector<HTMLElement>('#app > header.bar')
  const banner = document.getElementById('scene-edit-banner')
  const barH = bar ? (bar.getBoundingClientRect().height || bar.offsetHeight) : 70
  const bannerH = banner && !banner.hidden ? (banner.getBoundingClientRect().height || banner.offsetHeight) : 0
  document.documentElement.style.setProperty('--studio-top', `${Math.max(0, Math.ceil(barH + bannerH))}px`)
}
{
  const bar = document.querySelector<HTMLElement>('#app > header.bar')
  const banner = document.getElementById('scene-edit-banner')
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(syncStudioTop)
    if (bar) ro.observe(bar)
    if (banner) ro.observe(banner)
  }
  window.addEventListener('resize', syncStudioTop)
  syncStudioTop()
  requestAnimationFrame(syncStudioTop)
}

// ---------------------------------------------------------------------------
interface TreeDefaultOverride {
  version: 2
  spec: TreeSpec
  lighting: LightingPreset
  wind: boolean
  textures?: SavedTextureMap
}

const validLightingKeys = new Set<string>(Object.keys(lightingPresets))
function defaultLightingForPreset(id: PresetId): LightingPreset {
  return id === 'broadleaf-wishing' ? 'celestial'
    : id === 'broadleaf-sakura' ? 'sakura'
      : id.startsWith('conifer') ? 'forest'
        : id === 'broadleaf-maple' || id === 'broadleaf-willow' || id.startsWith('palm') ? 'ghibli'
          : 'neutral'
}

function parseTreeDefaultOverride(raw: unknown, id: PresetId): TreeDefaultOverride {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if ('spec' in rec && rec.spec && typeof rec.spec === 'object') {
    const parsedSpec = { ...parseTreeSpec(rec.spec), name: presets[id].name }
    const lightingMood: LightingPreset = typeof rec.lighting === 'string' && validLightingKeys.has(rec.lighting)
      ? rec.lighting as LightingPreset
      : defaultLightingForPreset(id)
    const wind = typeof rec.wind === 'boolean' ? rec.wind : true
    const texturesMap = parseSavedTextureMap(rec.textures)
    return {
      version: 2,
      spec: parsedSpec,
      lighting: lightingMood,
      wind,
      ...(texturesMap ? { textures: texturesMap } : {}),
    }
  }
  // Backward-compatible with v1 raw TreeSpec default overrides already on disk
  return {
    version: 2,
    spec: { ...parseTreeSpec(raw), name: presets[id].name },
    lighting: defaultLightingForPreset(id),
    wind: true,
  }
}

const treeDefaults = createDefaultOverrideStore<PresetId, TreeDefaultOverride>({
  scope: 'tree',
  validIds: presetIds,
  parse: parseTreeDefaultOverride,
  slimForLocal: entry => ({ version: 2, spec: entry.spec, lighting: entry.lighting, wind: entry.wind }),
})

let presetId: PresetId = (new URL(location.href).searchParams.get('preset') as PresetId) ?? 'broadleaf-round'
if (!presetIds.includes(presetId)) presetId = 'broadleaf-round'
let activeCustomId: string | undefined
let userDirty = Boolean(sceneEditParam || activeSceneEdit)
let lighting: LightingPreset = activeSceneEdit?.lighting ?? defaultLightingForPreset(presetId)
let windEnabled = true
let presetApplySeq = 0
let lastAppliedOverrideSnap = ''
let lastTextureApplyPromise: Promise<void> = Promise.resolve()
const bootOverride = (sceneEditParam || activeSceneEdit) ? undefined : treeDefaults.get(presetId)
let spec: TreeSpec = activeSceneEdit
  ? (() => {
      const parsed = resolveAssemblyTreeSpec(parseTreeSpec(activeSceneEdit.treeSpec), sceneEditAppearance)
      return parsed.handles?.length ? deepClone(parsed) : withDefaultHandles(deepClone(parsed))
    })()
  : bootOverride
    ? (bootOverride.spec.handles?.length ? deepClone(bootOverride.spec) : withDefaultHandles(deepClone(bootOverride.spec)))
    : withDefaultHandles(presetSpec(presetId))
if (bootOverride) {
  lighting = bootOverride.lighting
  windEnabled = bootOverride.wind
  lastAppliedOverrideSnap = JSON.stringify(bootOverride)
}
const kindLabels: Record<TreeKind, string> = {
  broadleaf: '阔叶树', conifer: '针叶树', palm: '棕榈树', bamboo: '竹子', lotus: '荷花', grass: '草丛', fern: '蕨类', flowerbed: '花丛模板', botanical: '风格化植物',
}
let asset: TreeAsset | undefined
let view: View = 'final'
function defaultCameraForPlant(plant: TreeSpec): Camera {
  if (plant.kind === 'botanical') return 'angle'
  if (plant.kind !== 'lotus') return 'front'
  return plant.lotus.withStems ? 'angle' : 'top'
}
let camera = defaultCameraForPlant(spec)
let lotusBounds: Box3 | undefined

function syncCameraButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) {
    button.setAttribute('aria-pressed', String(button.dataset.camera === camera))
  }
}
const registry = createTextureRegistry()
const textures = registry.textures
function buildStudioTree(treeSpec: TreeSpec) {
  const leafSource = sceneEditAppearance.leafTexture
  return buildTree(treeSpec, effectiveTextures(), {
    leafTextureOverride: Boolean((leafSource && leafSource !== 'auto') || registry.isCustom('leaf')),
  })
}

function effectiveTextures() {
  const leafSrc = sceneEditAppearance.leafTexture
  if (!leafSrc || leafSrc === 'auto' || registry.isCustom('leaf')) return textures
  return {
    get leaf() { return (textures[leafSrc as keyof typeof textures] as Texture | undefined) ?? textures.leaf },
    get needle() { return textures.needle },
    get drape() { return textures.drape },
    get palm() { return textures.palm },
    get bamboo() { return textures.bamboo },
    get lotusLeaf() { return textures.lotusLeaf },
    get lotusPetal() { return textures.lotusPetal },
    get grass() { return textures.grass },
    get grassTint() { return textures.grassTint },
    get fern() { return textures.fern },
    get flower() { return textures.flower },
    get blossom() { return textures.blossom },
    get stemLeaf() { return textures.stemLeaf },
    get painted() { return textures.painted },
    get feathery() { return textures.feathery },
    get sakura() { return textures.sakura },
    get cloud() { return textures.cloud },
    get oak() { return textures.oak },
    get oakAtlas() { return textures.oakAtlas },
    get maple() { return textures.maple },
    get willow() { return textures.willow },
    get bush() { return textures.bush },
    get wildrose() { return textures.wildrose },
    get bark() { return textures.bark },
  }
}
let toastTimer: ReturnType<typeof setTimeout>

function message(value: unknown, error = false, logIt = true) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  const text = value instanceof Error ? value.message : String(value)
  toast.textContent = text
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 4000)
  if (logIt) {
    if (error) activityLog.error('system', `提示错误：${text}`, value instanceof Error ? value : undefined)
    else activityLog.info('system', `状态提示：${text}`)
  }
}

function axisOf(s: TreeSpec) { return buildSkeleton({ ...s, handles: [] }).envelope.axis }
function withDefaultHandles(s: TreeSpec): TreeSpec {
  return { ...s, handles: defaultHandles(new CrownEnvelope(s, axisOf(s))) }
}

let viewer: Viewer | undefined
try {
  viewer = new Viewer(
    byId('canvas'),
    (_, calls) => { byId('stat-calls').textContent = fmt.format(calls) },
    lost => { message(lost ? 'WebGL 渲染上下文已丢失，正在尝试恢复…' : 'WebGL 渲染上下文已恢复', lost) },
  )
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}
initStudioLogging({
  page: 'broadleaf',
  getWebGLContext: () => viewer?.renderer.getContext() ?? null,
})

const paramHistory = new SnapshotHistory<TreeSpec>({ maxDepth: 30, clone: deepClone })
let intentionalNavigation = false
window.addEventListener('beforeunload', ev => {
  if (userDirty && !intentionalNavigation) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})

let cachedAxis = { key: '', axis: axisOf(spec) }
let editUi: ReturnType<typeof bindEditToolsUi> | undefined
const editor: CrownEditor | undefined = viewer ? new CrownEditor(viewer, {
  spec: () => spec,
  axis: () => {
    const key = JSON.stringify([spec.kind, spec.seed, spec.trunk, spec.crown.base, spec.palm.bend, spec.palm.sCurve, spec.branchEdits])
    if (key !== cachedAxis.key) cachedAxis = { key, axis: axisOf(spec) }
    return cachedAxis.axis
  },
  skeleton: () => asset?.skeleton,
  foliageObject: () => asset?.group,
  setHandles: (handles, final) => {
    userDirty = true
    spec = { ...spec, handles }
    if (final) activityLog.action(`调整树冠控制点（当前 ${handles.length} 个）`, { count: handles.length }, 'scene')
    scheduleBuild(final)
  },
  setBranchEdits: (branchEdits: BranchEdit[], final: boolean) => {
    userDirty = true
    const next = { ...spec }
    if (branchEdits.length) next.branchEdits = branchEdits
    else delete next.branchEdits
    spec = next
    if (final) activityLog.action(`编辑 3D 枝条节点（已修改 ${branchEdits.length} 条枝干）`, { count: branchEdits.length }, 'scene')
    scheduleBuild(final)
  },
  setLeafEdits: (leafEdits, final) => {
    userDirty = true
    const next = { ...spec }
    if (leafEdits && (leafEdits.clumps.length || leafEdits.brushes.length)) next.leafEdits = leafEdits
    else delete next.leafEdits
    spec = next
    if (final) {
      activityLog.action(
        `3D 树叶编辑（补叶簇 ${leafEdits?.clumps.length ?? 0} · 笔刷 ${leafEdits?.brushes.length ?? 0}）`,
        { clumps: leafEdits?.clumps.length ?? 0, brushes: leafEdits?.brushes.length ?? 0 },
        'scene',
      )
    }
    scheduleBuild(final)
  },
  setNormalEdit: (normalEdit: LeafNormalEditSpec, final: boolean) => {
    userDirty = true
    spec = { ...spec, normalEdit }
    panel.sync()
    if (final) activityLog.action(`笔刷调整叶片法线（模式：${normalEdit.mode}）`, { mode: normalEdit.mode, brushes: normalEdit.brushes?.length ?? 0 }, 'scene')
    scheduleBuild(final)
  },
  selected: handle => editUi?.showSelectedHandle(handle),
  selectedBranch: info => editUi?.showSelectedBranch(info),
  onStateChange: () => editUi?.sync(),
  canHandleShortcuts: (): boolean => !textureEditor?.isOpen() && !textureLibrary?.isOpen() && !presetLibrary?.isOpen() && !activityLogDrawer?.isOpen(),
}) : undefined

// ---- build scheduling: live while dragging, adaptive to generation cost ----
let lastBuildMs = 0, lastBuildAt = 0, pending = false, pendingFinal = false, frame = 0, frameHeight = 0, buildCount = 0
let lastWoodMs = 0, lastWoodAt = 0, woodPending = false, woodPendingFinal = false, woodFrame = 0, woodBuildCount = 0
function scheduleBuild(final = true) {
  woodPending = false
  woodPendingFinal = false
  cancelAnimationFrame(woodFrame)
  pending = true
  pendingFinal = pendingFinal || final
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const isFinal = pendingFinal
    const interval = isFinal ? 0 : Math.max(0, lastBuildMs * 2.5)
    if (performance.now() - lastBuildAt < interval) { scheduleBuild(isFinal); return }
    if (pending) {
      pendingFinal = false
      rebuild(false, isFinal)
    }
  })
}

function scheduleWoodBuild(final = true) {
  woodPending = true
  woodPendingFinal = woodPendingFinal || final
  cancelAnimationFrame(woodFrame)
  woodFrame = requestAnimationFrame(() => {
    const isFinal = woodPendingFinal
    const interval = isFinal ? 0 : Math.min(48, Math.max(0, lastWoodMs * 1.15))
    if (performance.now() - lastWoodAt < interval) { scheduleWoodBuild(isFinal); return }
    if (woodPending) {
      woodPending = false
      woodPendingFinal = false
      rebuildWoodOnly(isFinal)
    }
  })
}

function rebuildWoodOnly(final = true) {
  woodPending = false
  woodPendingFinal = false
  if (!viewer || !asset) { rebuild(false, final); return }
  const started = performance.now()
  try {
    if (!asset.rebuildWoodOnly(spec, effectiveTextures())) {
      rebuild(false, final)
      return
    }
    woodBuildCount++
    const triEl = document.getElementById('stat-triangles')
    if (triEl) triEl.textContent = fmt.format(asset.stats.triangles)
    const msEl = document.getElementById('stat-ms')
    if (msEl) msEl.textContent = fmt.format(asset.stats.ms)
    updateOptStatus(asset.stats.triangles, true)
    viewer.refreshShadows()
    if (final && presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) {
      presetLibrary.refreshCapture(false)
    }
    if (final && !presetLibrary?.isPreviewing() && !hoverPreviewTex) {
      scheduleSceneEditLiveSync()
      activityLog.info('scene', `树干快速重建完成：${spec.name}（${fmt.format(asset.stats.triangles)} 面 · ${asset.stats.ms} ms）`, {
        presetId,
        kind: spec.kind,
        seed: spec.seed,
        triangles: asset.stats.triangles,
        ms: asset.stats.ms,
      })
    }
  } catch (error) {
    console.error(error)
    message(error, true)
  }
  lastWoodMs = performance.now() - started
  lastWoodAt = performance.now()
}

function remeshOptimizeOnly(final = true): boolean {
  if (!viewer || !asset) return false
  const started = performance.now()
  try {
    if (!asset.remeshForOptimize(spec)) return false
    asset.display(view)
    for (const [key, value] of Object.entries(asset.stats)) {
      const el = document.getElementById('stat-' + key)
      if (el) el.textContent = fmt.format(value)
    }
    if (spec.kind !== 'broadleaf') byId('stat-twigs').textContent = '—'
    updateOptStatus(asset.stats.triangles, !final)
    viewer.refreshShadows()
    if (final && presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) {
      presetLibrary.refreshCapture(false)
    }
    if (final && !presetLibrary?.isPreviewing() && !hoverPreviewTex) {
      scheduleSceneEditLiveSync()
      activityLog.info('scene', `LOD 快速重网格完成：${spec.name}（${fmt.format(asset.stats.triangles)} 面 · ${asset.stats.ms} ms）`, {
        presetId,
        kind: spec.kind,
        seed: spec.seed,
        optimizeLevel: spec.optimize.level,
        triangles: asset.stats.triangles,
        ms: asset.stats.ms,
      })
    }
    lastBuildMs = performance.now() - started
    lastBuildAt = performance.now()
    return true
  } catch (error) {
    console.error(error)
    message(error, true)
    return false
  }
}

function rebuild(reframe: boolean, final = true) {
  pending = false
  pendingFinal = false
  woodPending = false
  woodPendingFinal = false
  cancelAnimationFrame(woodFrame)
  if (!viewer) return
  const started = performance.now()
  try {
    const next = buildStudioTree(spec)
    next.display(view)
    const box = new Box3().setFromObject(next.group), size = box.getSize(new Vector3())
    const height = box.max.y * 1.03 + .05
    const span = 2 * Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), size.x * .5) * 1.3
    const aspect = viewer.host.clientWidth / Math.max(1, viewer.host.clientHeight)
    if (reframe || !frameHeight) frameHeight = Math.max(height * 1.05, (span + height * .12) / Math.max(.56, aspect) / 1.16)
    viewer.showModel(next.group, frameHeight, false)
    lotusBounds = spec.kind === 'lotus' ? box : undefined
    if (reframe) {
      viewer.frame(camera, undefined, lotusBounds)
      syncCameraButtons()
    }
    asset?.dispose()
    asset = next
    buildCount++
    for (const [key, value] of Object.entries(asset.stats)) {
      const el = document.getElementById('stat-' + key)
      if (el) el.textContent = fmt.format(value)
    }
    byId('label-branches').textContent = spec.kind === 'flowerbed' || spec.kind === 'botanical' ? '茎/叶柄' : spec.kind === 'lotus' ? '荷茎' : spec.kind === 'bamboo' ? '竹竿/枝' : '枝条'
    byId('label-twigs').textContent = spec.kind === 'broadleaf' ? '细枝' : '—'
    byId('label-leaves').textContent = ({ broadleaf: '叶片卡', conifer: '针叶片', palm: '棕榈叶', bamboo: '竹叶卡', lotus: '荷叶', grass: '草叶', fern: '蕨叶', flowerbed: '花朵', botanical: '独立叶片' } as const)[spec.kind]
    if (spec.kind !== 'broadleaf') byId('stat-twigs').textContent = '—'
    updateOptStatus(asset.stats.triangles, !final)
    viewer.refreshShadows()
    editor?.refresh()
    if (final && presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) {
      presetLibrary.refreshCapture(false)
    }
    if (final && !presetLibrary?.isPreviewing() && !hoverPreviewTex) {
      scheduleSceneEditLiveSync()
      activityLog.info('scene', `模型构建完成：${spec.name}（${fmt.format(asset.stats.triangles)} 面 · ${asset.stats.ms} ms）`, {
        presetId,
        kind: spec.kind,
        seed: spec.seed,
        triangles: asset.stats.triangles,
        ms: asset.stats.ms,
        loadedTextures: registry.loadedSlots(),
      })
    }
  } catch (error) {
    console.error(error)
    message(error, true)
  }
  lastBuildMs = performance.now() - started
  lastBuildAt = performance.now()
}

let baselineCache = { key: '', triangles: 0 }
let baselineTimer: ReturnType<typeof setTimeout> | undefined
function baselineKey() {
  const { optimize: _o, ...rest } = spec
  void _o
  return JSON.stringify(rest)
}
function baselineTriangles() {
  const key = baselineKey()
  if (key !== baselineCache.key) {
    const raw = asset
      ? asset.buildLodClone({ ...spec, optimize: defaultOptimize })
      : buildStudioTree({ ...spec, optimize: defaultOptimize })
    baselineCache = { key, triangles: raw.stats.triangles }
    raw.dispose()
  }
  return baselineCache.triangles
}

function updateOptStatus(current: number, deferBaseline = false) {
  const opt = spec.optimize
  const active = opt.level > 0 || opt.woodDetail < 1 || opt.cullHiddenWood || opt.flatCards || opt.cardReduction > 0
  const el = byId('opt-status')
  if (baselineTimer) { clearTimeout(baselineTimer); baselineTimer = undefined }
  if (!active) {
    el.textContent = `当前高模：${fmt.format(current)} 三角面（未减面）`
    el.classList.remove('is-active')
  } else if (deferBaseline && baselineKey() !== baselineCache.key) {
    el.textContent = `当前 ${fmt.format(current)} 面（优化中…）`
    el.classList.add('is-active')
    baselineTimer = setTimeout(() => {
      baselineTimer = undefined
      if (asset) updateOptStatus(asset.stats.triangles, false)
    }, 240)
  } else {
    const base = baselineTriangles()
    const pct = base > 0 ? Math.round((1 - current / base) * 100) : 0
    el.textContent = `当前 ${fmt.format(current)} 面（原 ${fmt.format(base)} 面，${pct >= 0 ? '−' + pct : '+' + (-pct)}%）`
    el.classList.add('is-active')
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) {
    btn.setAttribute('aria-pressed', String(Math.abs(Number(btn.dataset.lod) - opt.level) < .03))
  }
}

const stylePalettes: Record<string, [string, string]> = {
  default: ['#325c3a', '#92ce5a'],
  cloud: ['#2f6e31', '#88d458'],
  oak: ['#3d7458', '#d8e478'],
  sakura: ['#c44d74', '#fcb9d0'],
  maple: ['#9e1f1b', '#ff8a36'],
  willow: ['#4e7d36', '#c6e678'],
  bush: ['#2e5c48', '#84cc6a'],
  painted: ['#3a5647', '#70bb5a'],
  flower: ['#d45c88', '#ffd2e4'],
}
const applyStudioParam = (path: string, value: unknown, final: boolean) => {
  if (!final) paramHistory.beginGesture(spec)
  else paramHistory.commitGesture(spec)
  userDirty = true
  if (path === 'optimize.level') {
    spec = { ...spec, optimize: optimizeAt(Number(value), spec.optimize.targetTriangles) }
    panel.sync()
  } else if (path === 'shading.leafStyle') {
    const nextStyle = String(value)
    // Switching built-in leafStyle clears any custom leaf texture override so the selection always takes visible effect
    if (registry.isCustom('leaf')) registry.resetDefault('leaf')
    const pal = stylePalettes[nextStyle]
    const nextAtlas = nextStyle === 'oak' ? 2 : 1
    spec = setPath(spec, path, value)
    if (pal) {
      const nextCard = nextStyle === 'willow'
        ? 'drape' as const
        : spec.leaves.cardType === 'drape' ? 'quad' as const : spec.leaves.cardType
      const nextPivot = nextStyle === 'painted' ? .5 : spec.leaves.leafPivot
      const nextColorMass = nextStyle === 'painted'
        ? Math.max(.88, spec.shading.colorMass ?? 0)
        : (spec.shading.colorMass ?? 0)
      spec = {
        ...spec,
        shading: { ...spec.shading, colorMass: nextColorMass },
        leaves: { ...spec.leaves, tintInner: pal[0], tintOuter: pal[1], cardType: nextCard, leafPivot: nextPivot, atlasCols: nextAtlas, atlasRows: nextAtlas, atlasRegions: undefined },
      }
    } else if (spec.leaves.atlasRegions?.length) {
      spec = { ...spec, leaves: { ...spec.leaves, atlasRegions: undefined } }
    }
    if (sceneEditAppearance.leafTexture) sceneEditAppearance.leafTexture = undefined
    panel.sync()
    syncSceneEditAppearanceUi()
    texSlots?.syncThumbnails()
  } else if (path === 'trunk.barkStyle') {
    // Switching built-in barkStyle clears any custom bark texture override so birch/driftwood/moss always work!
    if (registry.isCustom('bark')) registry.resetDefault('bark')
    const nextBark = String(value) as BarkStyle
    const nextTrunk = { ...spec.trunk }
    if (nextBark === 'default') delete nextTrunk.barkStyle
    else nextTrunk.barkStyle = nextBark
    spec = { ...spec, trunk: nextTrunk }
    syncSceneEditAppearanceUi()
    texSlots?.syncThumbnails()
  } else if (path === 'trunk.treeForm') {
    const nextForm = String(value) as TreeForm
    const nextTrunk = { ...spec.trunk }
    if (nextForm === 'free') delete nextTrunk.treeForm
    else nextTrunk.treeForm = nextForm
    spec = { ...spec, trunk: nextTrunk }
    syncSceneEditAppearanceUi()
  } else if (path === 'leaves.cardType') {
    spec = setPath(spec, path, value)
    syncSceneEditAppearanceUi()
    texSlots?.syncThumbnails()
  } else if (path === 'trunk.sculpt') {
    spec = setPath(spec, path, value)
    panel.sync()
  } else if (path.startsWith('accents.')) {
    spec = setPath(spec, path, value)
    if (spec.shading.accent !== 'wishing') {
      spec = setPath(spec, 'shading.accent', 'wishing')
      panel.sync()
    }
  } else if (path === 'trunk.barkColor') {
    spec = setPath(spec, path, value)
    if (registry.isCustom('bark') && (spec.trunk.barkTint ?? 0) < .8) {
      spec = setPath(spec, 'trunk.barkTint', .88)
      asset?.applyLiveParam('trunk.barkTint', spec)
      panel.sync()
    }
  } else {
    spec = setPath(spec, path, value)
  }
  if (spec.trunk.barkStyle === 'birch' && (path === 'trunk.barkColor' || path === 'trunk.barkMoss' || path === 'trunk.barkMossColor' || path === 'trunk.barkScale' || path === 'trunk.barkDetail' || path === 'trunk.barkRootAO' || path === 'trunk.flareHeight')) {
    texSlots?.drawSlot('bark', true)
  }
  if (path === 'optimize.targetTriangles') return
  if (asset?.applyLiveParam(path, spec)) {
    if (path === 'shading.softSelfShadow') viewer?.refreshShadows()
    if (final && !presetLibrary?.isPreviewing() && !hoverPreviewTex) {
      scheduleSceneEditLiveSync()
      if (presetLibrary?.isOpen()) presetLibrary.refreshCapture(false)
    }
    return
  }
  if (asset && isOptimizeOnlyParam(path) && !pending && !woodPending && remeshOptimizeOnly(final)) {
    return
  }
  if (asset && isWoodOnlyParam(path) && (spec.kind === 'broadleaf' || spec.kind === 'conifer') && !pending) {
    scheduleWoodBuild(final)
    return
  }
  scheduleBuild(final)
}
const panel = bindPanel(byId('panel'), () => spec, applyStudioParam)

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) btn.onclick = () => {
  paramHistory.push(spec)
  userDirty = true
  spec = { ...spec, optimize: optimizeAt(Number(btn.dataset.lod), spec.optimize.targetTriangles) }
  panel.sync()
  if (!remeshOptimizeOnly(true)) rebuild(false)
}
byId('opt-solve').onclick = () => {
  paramHistory.push(spec)
  userDirty = true
  const goal = Math.max(200, Math.round(byId<HTMLInputElement>('opt-target').valueAsNumber || spec.optimize.targetTriangles || 3000))
  const res = solveForTriangleBudget(spec, effectiveTextures(), goal)
  spec = { ...spec, optimize: res.optimize }
  panel.sync()
  if (!remeshOptimizeOnly(true)) rebuild(false)
  const pct = res.before > 0 ? Math.round((1 - res.after / res.before) * 100) : 0
  message(res.reached
    ? `已优化至 ${fmt.format(res.after)} 面（原 ${fmt.format(res.before)} 面，−${pct}%）`
    : `已达极限低模 ${fmt.format(res.after)} 面（目标 ${fmt.format(goal)} 面）`)
}

function setLightingMood(mood: LightingPreset) {
  lighting = mood
  byId<HTMLSelectElement>('lighting').value = mood
  viewer?.setLighting(mood)
  if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
}

function setWindState(on: boolean) {
  windEnabled = on
  byId<HTMLButtonElement>('wind-toggle').setAttribute('aria-pressed', String(on))
  viewer?.setWind(on)
}

function syncDefaultOverrideUi() {
  if (activeSceneEdit) {
    byId('default-preset-bar').hidden = true
    byId('tree-title').textContent = `${activeSceneEdit.itemName} · 场景联调`
    return
  }
  const isCustomLib = Boolean(activeCustomId)
  const overridden = !isCustomLib && treeDefaults.has(presetId)
  byId('default-preset-bar').hidden = isCustomLib
  byId('reset-factory').hidden = !overridden
  byId('save-default').textContent = overridden ? '★ 更新当前默认预设' : '★ 保存替换默认预设'
  byId('tree-title').textContent = overridden ? `${spec.name} · 已改默认` : spec.name
  const sel = byId<HTMLSelectElement>('preset')
  for (const id of presetIds) {
    const opt = sel.querySelector<HTMLOptionElement>(`option[value="${id}"]`)
    if (opt) opt.textContent = treeDefaults.has(id) ? `${presets[id].name} · 已改` : presets[id].name
  }
}

function applyBuiltInPresetState(id: PresetId, override: TreeDefaultOverride | undefined, reframe = true): Promise<void> {
  const seq = ++presetApplySeq
  editor?.clearUndo()
  paramHistory.clear()
  lastAppliedOverrideSnap = override ? JSON.stringify(override) : ''
  setLightingMood(override?.lighting ?? defaultLightingForPreset(id))
  setWindState(override?.wind ?? true)

  // Clear custom texture overrides from any previously viewed preset
  const savedTextures = override?.textures
  for (const slot of editableTextureSlots) {
    if (!savedTextures?.[slot]) registry.resetDefault(slot)
  }

  const nextSpec = override
    ? (override.spec.handles?.length ? deepClone(override.spec) : withDefaultHandles(deepClone(override.spec)))
    : withDefaultHandles(presetSpec(id))
  const presetCamera = defaultCameraForPlant(nextSpec)
  if (reframe && presetCamera !== defaultCameraForPlant(spec)) camera = presetCamera

  if (!savedTextures || Object.keys(savedTextures).length === 0) {
    applySpec(nextSpec, reframe)
    lastTextureApplyPromise = Promise.resolve()
    return lastTextureApplyPromise
  }

  // Decode saved custom textures BEFORE building the tree so startup / preset switch only builds ONCE!
  const p = decodeSavedTextureMap(savedTextures).then(decoded => {
    if (seq !== presetApplySeq) {
      for (const tex of Object.values(decoded)) tex?.dispose()
      return
    }
    for (const [slot, tex] of Object.entries(decoded) as [EditableTextureSlot, Texture | undefined][]) {
      if (!tex) continue
      registry.setCustom(slot, tex)
      texSlots?.drawSlot(slot, true)
    }
    applySpec(nextSpec, reframe)
  })
  lastTextureApplyPromise = p
  return p
}

async function saveCurrentAsDefaultPreset() {
  if (activeCustomId) return undefined
  const capturedTextures = captureCustomRegistryTextures(registry)
  const texCount = Object.keys(capturedTextures).length
  const payload: TreeDefaultOverride = {
    version: 2,
    spec: deepClone({ ...spec, name: presets[presetId].name }),
    lighting,
    wind: windEnabled,
    ...(texCount > 0 ? { textures: capturedTextures } : {}),
  }
  const saved = await treeDefaults.save(presetId, payload)
  spec = saved.spec.handles?.length ? deepClone(saved.spec) : withDefaultHandles(deepClone(saved.spec))
  lastAppliedOverrideSnap = JSON.stringify(saved)
  userDirty = false
  syncDefaultOverrideUi()
  const where = treeDefaults.storageMode === 'file' ? '本地文件' : '浏览器存储'
  const extra = texCount > 0 ? `（含全部参数、${texCount} 项贴图与光照，已写入${where}）` : `（含整树全部参数与光照，已写入${where}）`
  message(`已保存替换默认预设「${presets[presetId].name}」${extra}`)
  return saved
}

async function resetCurrentToFactoryPreset() {
  if (activeCustomId) return
  await treeDefaults.resetOne(presetId)
  userDirty = false
  await applyBuiltInPresetState(presetId, undefined, true)
  message(`已恢复「${presets[presetId].name}」为出厂默认参数与贴图`)
}

function applySpec(next: TreeSpec, reframe = true) {
  spec = next
  const presetSel = byId<HTMLSelectElement>('preset')
  const want = activeCustomId ? `custom:${activeCustomId}` : presetId
  if ([...presetSel.options].some(o => o.value === want)) presetSel.value = want
  byId<HTMLInputElement>('seed').value = String(spec.seed)
  syncDefaultOverrideUi()
  panel.sync()
  texSlots?.syncThumbnails()
  cachedAxis.key = ''
  editor?.refresh()
  rebuild(reframe)
}

// ---- inspector events ------------------------------------------------------
byId<HTMLSelectElement>('preset').onchange = () => {
  const val = byId<HTMLSelectElement>('preset').value
  if (sceneEditAppearance.leafTexture) {
    sceneEditAppearance.leafTexture = undefined
    syncSceneEditAppearanceUi()
  }
  if (val.startsWith('custom:')) {
    const cid = val.slice(7)
    const saved = presetStore.get<TreeSpec>(cid)
    if (!saved) return
    activeCustomId = saved.id
    presetLibrary.setActiveId(saved.id)
    editor?.clearUndo()
    paramHistory.clear()
    for (const slot of editableTextureSlots) registry.resetDefault(slot)
    editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined)
    editUi?.showSelectedHandle(undefined)
    setLightingMood(saved.lighting)
    applySpec(deepClone(saved.payload), true)
    message(`已切换至我的预设「${saved.name}」`)
    return
  }
  activeCustomId = undefined
  presetLibrary.setActiveId(undefined)
  presetId = val as PresetId
  const url = new URL(location.href)
  url.searchParams.set('preset', presetId)
  history.replaceState(null, '', url)
  editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined)
  editUi?.showSelectedHandle(undefined)
  userDirty = false
  void applyBuiltInPresetState(presetId, treeDefaults.get(presetId), true)
  if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(true)
}
byId<HTMLInputElement>('seed').onchange = () => {
  paramHistory.push(spec)
  userDirty = true
  const seed = Math.max(0, Math.round(byId<HTMLInputElement>('seed').valueAsNumber || 0))
  applySpec({ ...spec, seed }, false)
}
byId('reseed').onclick = () => {
  paramHistory.push(spec)
  userDirty = true
  applySpec({ ...spec, seed: Math.floor(Math.random() * 99999) }, false)
}
byId('save-default').onclick = () => { void saveCurrentAsDefaultPreset().catch(err => message(err, true)) }
byId('reset-factory').onclick = () => { void resetCurrentToFactoryPreset().catch(err => message(err, true)) }
byId('reset').onclick = () => {
  if (activeSceneEdit && initialSceneEditSnapshot) {
    const snap = initialSceneEditSnapshot
    void (async () => {
      editor?.clearUndo()
      paramHistory.clear()
      activeCustomId = undefined
      presetLibrary.setActiveId(undefined)
      sceneEditAppearance.barkStyle = snap.appearance.barkStyle
      sceneEditAppearance.crownStyle = snap.appearance.crownStyle
      sceneEditAppearance.treeForm = snap.appearance.treeForm
      sceneEditAppearance.leafTexture = snap.appearance.leafTexture
      sceneEditAppearance.category = snap.appearance.category
      sceneEditAppearance.lighting = snap.appearance.lighting
      for (const slot of editableTextureSlots) registry.resetDefault(slot)
      if (snap.customTextures) {
        const decoded = await decodeSavedTextureMap(snap.customTextures)
        for (const slot of editableTextureSlots) {
          const tex = decoded[slot]
          if (tex) registry.setCustom(slot, tex, true)
        }
        texSlots?.syncThumbnails()
      }
      setLightingMood(snap.lighting)
      syncSceneEditAppearanceUi()
      applySpec(deepClone(snap.spec), true)
      message('已恢复当前场景资产初始状态')
    })()
    return
  }
  const saved = activeCustomId ? presetStore.get<TreeSpec>(activeCustomId) : undefined
  if (saved) {
    setLightingMood(saved.lighting)
    applySpec(deepClone(saved.payload), true)
    return
  }
  userDirty = false
  void applyBuiltInPresetState(presetId, treeDefaults.get(presetId), true)
  message(treeDefaults.has(presetId) ? '已恢复至你保存的默认预设状态' : '已恢复当前预设默认参数')
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => {
  view = button.dataset.view as View
  asset?.display(view)
  viewer?.refreshShadows()
  document.querySelectorAll('[data-view]').forEach(o => o.setAttribute('aria-pressed', String(o === button)))
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) button.onclick = () => {
  camera = button.dataset.camera as Camera
  viewer?.frame(camera, undefined, lotusBounds)
  syncCameraButtons()
}
byId<HTMLSelectElement>('lighting').onchange = e => {
  userDirty = true
  setLightingMood((e.target as HTMLSelectElement).value as LightingPreset)
}
const windBtn = byId<HTMLButtonElement>('wind-toggle')
windBtn.onclick = () => {
  userDirty = true
  const on = windBtn.getAttribute('aria-pressed') !== 'true'
  setWindState(on)
}

// ---- SpeedTree node & crown editing tools ----------------------------------
editUi = bindEditToolsUi({
  editor,
  getSpec: () => spec,
  onHandlesChange: (handles, final) => {
    userDirty = true
    spec = { ...spec, handles }
    scheduleBuild(final)
  },
  onResetHandles: () => {
    userDirty = true
    spec = withDefaultHandles(spec)
    rebuild(false)
  },
  onMessage: message,
})

// ---- textures (lazy registry + shared slot bindings) -----------------------
function activateTextureSlotOnSpec(slot: EditableTextureSlot): boolean {
  let changed = false
  if (slot === 'leaf') {
    if (spec.shading.leafStyle !== 'default') {
      spec = { ...spec, shading: { ...spec.shading, leafStyle: 'default' } }
      changed = true
    }
  } else if (slot === 'flower' && (!spec.flowers.enabled || spec.flowers.style !== 'default')) {
    spec = { ...spec, flowers: { ...spec.flowers, enabled: true, style: 'default' } }
    changed = true
  } else if (slot === 'grass' && spec.kind === 'grass' && spec.ground.mode !== 'card') {
    spec = { ...spec, ground: { ...spec.ground, mode: 'card' } }
    changed = true
  }
  if (changed) {
    panel.sync()
    syncSceneEditAppearanceUi()
  }
  return changed
}

let cachedBirchPreview: { key: string; tex: Texture } | undefined
function resolveAppearanceSlot(slot: EditableTextureSlot): { texture?: Texture; label?: string } | undefined {
  if (registry.isCustom(slot)) return undefined
  if (slot === 'bark' && spec.trunk.barkStyle && spec.trunk.barkStyle !== 'default') {
    if (spec.trunk.barkStyle === 'birch') {
      const key = `${spec.seed}|${spec.trunk.barkColor}|${spec.trunk.barkMoss}|${spec.trunk.barkMossColor}|${spec.trunk.barkScale}|${spec.trunk.barkDetail}|${spec.trunk.barkRootAO}|${spec.trunk.flareHeight}`
      if (!cachedBirchPreview || cachedBirchPreview.key !== key) {
        cachedBirchPreview?.tex.dispose()
        const t = makeBirchPreviewTexture(spec.seed, spec)
        if (t) cachedBirchPreview = { key, tex: t }
      }
      return { texture: cachedBirchPreview?.tex, label: '白桦浅灰手绘树皮（响应下方颜色/苔藓）' }
    }
    if (spec.trunk.barkStyle === 'driftwood') {
      if (!previewBarkTemplates.driftwood) previewBarkTemplates.driftwood = makePainterlyDriftwoodBarkTexture(256)
      return { texture: previewBarkTemplates.driftwood, label: '厚涂宽纹古木树皮（风格预设）' }
    }
    if (spec.trunk.barkStyle === 'moss') {
      if (!previewBarkTemplates.moss) previewBarkTemplates.moss = makePainterlyMossBarkTexture(256)
      return { texture: previewBarkTemplates.moss, label: '苍古苔藓木皮（风格预设）' }
    }
  }
  if (slot === 'leaf') {
    if (spec.kind === 'broadleaf' && spec.shading.leafStyle && spec.shading.leafStyle !== 'default') {
      const styleSlot: AllTextureSlot = spec.shading.leafStyle === 'oak' && (spec.leaves.atlasCols > 1 || spec.leaves.atlasRows > 1)
        ? 'oakAtlas'
        : (spec.shading.leafStyle as AllTextureSlot)
      const styleLabels: Record<string, string> = {
        painted: '手绘色块叶簇（连贯大块面+碎叶尖）',
        feathery: '羽叶细枝（林木高冠 / 细腻盆景）',
        bush: '翠绿尖叶灌木簇（内置叶型）',
        cloud: '厚涂圆云叶（内置叶型）',
        oak: '手绘厚涂橡叶叠簇（内置叶型）',
        sakura: '樱花柔瓣簇（内置叶型）',
        maple: '枫叶五角簇（内置叶型）',
        willow: '垂柳细长丝（内置叶型）',
        flower: '通用花簇（内置叶型）',
      }
      return { texture: registry.get(styleSlot), label: styleLabels[spec.shading.leafStyle] ?? '内置风格化叶型' }
    }
    if (activeSceneEdit && sceneEditAppearance.leafTexture && sceneEditAppearance.leafTexture !== 'auto') {
      return {
        texture: registry.get(sceneEditAppearance.leafTexture as AllTextureSlot),
        label: `场景叶型贴图（${sceneEditAppearance.leafTexture}）`,
      }
    }
  }
  return undefined
}

const texSlots = bindTextureSlots(registry, {
  resolveSlot: resolveAppearanceSlot,
  onBeforeUseCustom: slot => {
    activateTextureSlotOnSpec(slot)
    if (slot === 'leaf') {
      sceneEditAppearance.leafTexture = undefined
      syncSceneEditAppearanceUi()
    } else if (slot === 'bark' && spec.trunk.barkStyle) {
      const nextTrunk = { ...spec.trunk }
      delete nextTrunk.barkStyle
      spec = { ...spec, trunk: nextTrunk }
      panel.sync()
      syncSceneEditAppearanceUi()
    }
    if (slot === 'leaf' && (spec.leaves.atlasCols !== 1 || spec.leaves.atlasRows !== 1 || spec.leaves.atlasRegions?.length)) {
      spec = { ...spec, leaves: { ...spec.leaves, atlasCols: 1, atlasRows: 1, atlasRegions: undefined } }
      panel.sync()
    }
  },
  onResetTexture: slot => {
    if (slot === 'leaf' && spec.leaves.atlasRegions?.length) {
      spec = { ...spec, leaves: { ...spec.leaves, atlasRegions: undefined } }
      panel.sync()
    }
    return false
  },
  onOpenEditor: slot => openEditorForSlot(slot),
  onOpenLibrary: slot => textureLibrary.open(undefined, defaultCategoryForSlot(slot)),
  onChange: () => { userDirty = true; rebuild(false) },
  onMessage: message,
})

// ---- file actions ----------------------------------------------------------
const fileInput = byId<HTMLInputElement>('file')
byId('import').onclick = () => fileInput.click()
fileInput.onchange = async () => {
  const selected = fileInput.files?.[0]
  if (!selected) return
  try {
    const next = parseTreeSpec(JSON.parse(await selected.text()))
    activeCustomId = undefined
    presetLibrary.setActiveId(undefined)
    editor?.clearUndo()
    paramHistory.clear()
    presetId = presetIds.find(id => presets[id].kind === next.kind && presets[id].name === next.name) ?? presetIds.find(id => presets[id].kind === next.kind)!
    userDirty = true
    applySpec(next)
    message('已导入 ' + selected.name)
  } catch (error) { message(error, true) }
  finally { fileInput.value = '' }
}
function download(url: string, filename: string) {
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
}
function save(blob: Blob, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const filters = ext === 'glb'
    ? [{ name: 'glTF Binary (.glb)', extensions: ['glb'] }]
    : ext === 'zip'
      ? [{ name: 'ZIP 压缩包 (.zip)', extensions: ['zip'] }]
      : ext === 'json'
      ? [{ name: 'JSON (.json)', extensions: ['json'] }]
      : ext === 'png'
        ? [{ name: 'PNG 图像 (.png)', extensions: ['png'] }]
        : undefined
  void tryDesktopSaveBlob(blob, filename, filters).then(res => {
    if (res.handled) {
      if (!res.canceled && res.filePath) message(`已保存到 ${res.filePath}`)
      return
    }
    const url = URL.createObjectURL(blob)
    download(url, filename)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }).catch(err => {
    message(`文件保存失败：${err instanceof Error ? err.message : String(err)}`, true)
  })
}
function captureStudioPng(transparent = false): string {
  if (!viewer) return ''
  const wasVisible = editor?.group.visible
  if (editor) editor.group.visible = false
  try {
    return viewer.snapshot({ transparent })
  } finally {
    if (editor) editor.group.visible = Boolean(wasVisible)
  }
}
const fileName = () => `${presetId}-${spec.seed}`
byId('json').onclick = () => save(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), fileName() + '.json')
byId('png').onclick = () => {
  const dataUrl = captureStudioPng(false)
  if (!dataUrl) return
  const fname = fileName() + '-' + view + '-' + camera + '.png'
  fetch(dataUrl).then(r => r.blob()).then(b => save(b, fname)).catch(() => download(dataUrl, fname))
}
byId('png-alpha').onclick = () => {
  const dataUrl = captureStudioPng(true)
  if (!dataUrl) return
  const fname = `${fileName()}_transparent.png`
  activityLog.exportStep(`导出透明背景 PNG：${fname}`, { filename: fname, view, camera })
  fetch(dataUrl).then(r => r.blob()).then(b => save(b, fname)).catch(() => download(dataUrl, fname))
}
const glb = byId<HTMLButtonElement>('glb')
bindGlbExportPopover({
  triggerButton: glb,
  getRoot: () => asset?.group,
  exportBlob: opts => asset!.exportGlb(opts),
  exportLodGlb: async (lodLevel, opts) => {
    const preset = lodPresets[lodLevel] ?? lodPresets[0]
    const lodSpec = { ...spec, optimize: optimizeAt(preset.level, spec.optimize.targetTriangles) }
    const clone = asset ? asset.buildLodClone(lodSpec) : buildStudioTree(lodSpec)
    try {
      return await exportGlb(clone.group, opts)
    } finally {
      clone.dispose()
    }
  },
  getFilename: opts => `${fileName()}${opts.mode === 'merged' ? '-merged' : ''}.glb`,
  saveBlob: save,
  message,
})

// ---- saved preset library (real-time 3D preview & local persistence) -------
const presetStore = createPresetStore()

function syncCustomPresetOptions() {
  const sel = byId<HTMLSelectElement>('preset')
  const list = presetStore.list<TreeSpec>('tree')
  byId('preset-lib-count').textContent = String(list.length)
  let group = document.getElementById('custom-presets-group') as HTMLOptGroupElement | null
  if (!list.length) {
    group?.remove()
    if (activeCustomId) {
      activeCustomId = undefined
      sel.value = presetId
    }
    return
  }
  if (!group) {
    group = document.createElement('optgroup')
    group.id = 'custom-presets-group'
    group.label = '★ 我的预设'
    sel.prepend(group)
  }
  group.innerHTML = ''
  for (const item of list) {
    const opt = document.createElement('option')
    opt.value = `custom:${item.id}`
    opt.textContent = `★ ${item.name}`
    group.append(opt)
  }
  if (activeCustomId && list.some(x => x.id === activeCustomId)) {
    sel.value = `custom:${activeCustomId}`
  } else {
    if (activeCustomId) activeCustomId = undefined
    sel.value = presetId
  }
}

const presetLibrary = mountPresetLibrary<TreeSpec, { spec: TreeSpec; lighting: LightingPreset; presetId: PresetId; activeCustomId?: string; frameHeight: number; customTextures?: SavedTextureMap }>({
  scope: 'tree',
  store: presetStore,
  capture: () => {
    const capturedTex = captureCustomRegistryTextures(registry)
    return {
      defaultName: spec.name,
      kind: spec.kind,
      kindLabel: kindLabels[spec.kind],
      triangles: asset?.stats.triangles ?? 0,
      lighting,
      thumbnail: captureViewportThumbnail(viewer, [editor?.group]),
      payload: spec,
      ...(Object.keys(capturedTex).length ? { textures: capturedTex } : {}),
    }
  },
  snapshotState: () => {
    const capturedTex = captureCustomRegistryTextures(registry)
    return {
      spec: deepClone(spec),
      lighting,
      presetId,
      activeCustomId,
      frameHeight,
      ...(Object.keys(capturedTex).length ? { customTextures: capturedTex } : {}),
    }
  },
  restoreState: snap => {
    const seq = ++presetApplySeq
    presetId = snap.presetId
    activeCustomId = snap.activeCustomId
    const needReframe = Math.abs(frameHeight - snap.frameHeight) / Math.max(.5, snap.frameHeight) > .25
    setLightingMood(snap.lighting)
    const finish = () => {
      if (seq !== presetApplySeq) return
      applySpec(snap.spec, needReframe)
      texSlots?.syncThumbnails()
    }
    for (const slot of editableTextureSlots) registry.resetDefault(slot)
    if (snap.customTextures && Object.keys(snap.customTextures).length > 0) {
      void decodeSavedTextureMap(snap.customTextures).then(decoded => {
        if (seq !== presetApplySeq) {
          for (const t of Object.values(decoded)) t?.dispose()
          return
        }
        for (const [slot, tex] of Object.entries(decoded) as [EditableTextureSlot, Texture | undefined][]) {
          if (tex) registry.setCustom(slot, tex)
        }
        finish()
      })
    } else {
      finish()
    }
  },
  preview: preset => {
    const seq = ++presetApplySeq
    const prevH = spec.trunk.height
    const nextH = preset.payload.trunk.height
    const scaleChanged = Math.abs(nextH - prevH) / Math.max(.5, prevH) > .35 || preset.payload.kind !== spec.kind
    setLightingMood(preset.lighting)
    const finish = () => {
      if (seq !== presetApplySeq) return
      applySpec(deepClone(preset.payload), scaleChanged)
      texSlots?.syncThumbnails()
    }
    for (const slot of editableTextureSlots) registry.resetDefault(slot)
    if (preset.textures && Object.keys(preset.textures).length > 0) {
      void decodeSavedTextureMap(preset.textures).then(decoded => {
        if (seq !== presetApplySeq) {
          for (const t of Object.values(decoded)) t?.dispose()
          return
        }
        for (const [slot, tex] of Object.entries(decoded) as [EditableTextureSlot, Texture | undefined][]) {
          if (tex) registry.setCustom(slot, tex)
        }
        finish()
      })
    } else {
      finish()
    }
  },
  apply: preset => {
    const seq = ++presetApplySeq
    activeCustomId = preset.id
    if (sceneEditAppearance.leafTexture) {
      sceneEditAppearance.leafTexture = undefined
      syncSceneEditAppearanceUi()
    }
    editor?.clearUndo()
    paramHistory.clear()
    editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined, editor.selectedLeafClumpId = undefined)
    editUi?.showSelectedHandle(undefined)
    setLightingMood(preset.lighting)
    const finish = () => {
      if (seq !== presetApplySeq) return
      applySpec(deepClone(preset.payload), true)
      texSlots?.syncThumbnails()
    }
    for (const slot of editableTextureSlots) registry.resetDefault(slot)
    if (preset.textures && Object.keys(preset.textures).length > 0) {
      void decodeSavedTextureMap(preset.textures).then(decoded => {
        if (seq !== presetApplySeq) {
          for (const t of Object.values(decoded)) t?.dispose()
          return
        }
        for (const [slot, tex] of Object.entries(decoded) as [EditableTextureSlot, Texture | undefined][]) {
          if (tex) registry.setCustom(slot, tex)
        }
        finish()
      })
    } else {
      finish()
    }
  },
  message,
  onActiveChange: id => {
    activeCustomId = id
    syncCustomPresetOptions()
    syncDefaultOverrideUi()
  },
})

presetStore.subscribe(syncCustomPresetOptions)
void presetStore.ready().then(syncCustomPresetOptions)
syncCustomPresetOptions()
treeDefaults.subscribe(syncDefaultOverrideUi)
const bootSyncPromise = treeDefaults.ready().then(async () => {
  if (sceneEditParam) {
    await lastTextureApplyPromise
    return
  }
  if (!userDirty && !activeCustomId) {
    const diskOverride = treeDefaults.get(presetId)
    const nextSnap = diskOverride ? JSON.stringify(diskOverride) : ''
    if (nextSnap !== lastAppliedOverrideSnap) {
      await applyBuiltInPresetState(presetId, diskOverride, true)
      return
    }
  }
  await lastTextureApplyPromise
  syncDefaultOverrideUi()
})

// ---- Substance-style Procedural Texture Editor & Real-Time Texture Library -
interface SlotPreviewSnapshot {
  slot: EditableTextureSlot
  prevCustom: Texture | undefined
  leafStyle: TreeSpec['shading']['leafStyle']
  atlasCols: number
  atlasRows: number
  atlasRegions: TreeSpec['leaves']['atlasRegions']
  flowersEnabled: boolean
  flowersStyle: TreeSpec['flowers']['style']
  groundMode: TreeSpec['ground']['mode']
}

const textureStore = createTextureLibraryStore({ lazy: true })
let hoverPreviewTex: Texture | undefined
let hoverStashedOriginal: Texture | undefined

function applyProceduralTexture(
  slot: EditableTextureSlot,
  texture: Texture,
  label: string,
  isPreview = false,
  meta?: AppliedTextureMeta,
) {
  texture.name = label
  if (!isPreview) attachTextureGraphSource(texture, meta)
  if (isPreview) {
    const prevPreview = hoverPreviewTex
    hoverPreviewTex = texture
    registry.setCustom(slot, texture, false)
    if (prevPreview && prevPreview !== texture && prevPreview !== hoverStashedOriginal) prevPreview.dispose()
  } else {
    userDirty = true
    const oldStashed = hoverStashedOriginal
    hoverStashedOriginal = undefined
    const prevPreview = hoverPreviewTex
    hoverPreviewTex = undefined
    registry.setCustom(slot, texture, true)
    if (prevPreview && prevPreview !== texture) prevPreview.dispose()
    if (oldStashed && oldStashed !== texture) oldStashed.dispose()
  }
  activateTextureSlotOnSpec(slot)
  if (slot === 'bark' && spec.trunk.barkStyle && spec.trunk.barkStyle !== 'default') {
    const nextTrunk = { ...spec.trunk }
    delete nextTrunk.barkStyle
    spec = { ...spec, trunk: nextTrunk }
    panel.sync()
    syncSceneEditAppearanceUi()
  }
  if (slot === 'leaf') {
    // Always reset atlas grid to 1x1 when applying a non-atlas texture so 1x1 leaf images aren't sliced into 1/4 quarters!
    const nextRegions = meta?.atlasRegions?.length ? meta.atlasRegions : undefined
    const nextCols = nextRegions ? 1 : (meta?.atlasCols ?? 1)
    const nextRows = nextRegions ? 1 : (meta?.atlasRows ?? 1)
    const regionsChanged = JSON.stringify(spec.leaves.atlasRegions ?? null) !== JSON.stringify(nextRegions ?? null)
    if (spec.leaves.atlasCols !== nextCols || spec.leaves.atlasRows !== nextRows || regionsChanged) {
      spec = {
        ...spec,
        leaves: { ...spec.leaves, atlasCols: nextCols, atlasRows: nextRows, atlasRegions: nextRegions },
      }
      panel.sync()
    }
  }
  texSlots.drawSlot(slot, true)
  if (slot === 'bark' && asset && (spec.kind === 'broadleaf' || spec.kind === 'conifer')) rebuildWoodOnly(!isPreview)
  else rebuild(false, !isPreview)
}

const textureEditor = mountTextureEditor({
  store: textureStore,
  applyTexture: (slot, tex, label, meta) => applyProceduralTexture(slot, tex, label, false, meta),
  onOpen: () => {
    presetLibrary.close()
    textureLibrary.close()
  },
  message,
})

const textureLibrary = mountTextureLibrary<SlotPreviewSnapshot>({
  store: textureStore,
  snapshotSlot: slot => {
    const prevCustom = registry.getCustom(slot)
    hoverStashedOriginal = prevCustom
    return {
      slot,
      prevCustom,
      leafStyle: spec.shading.leafStyle,
      atlasCols: spec.leaves.atlasCols,
      atlasRows: spec.leaves.atlasRows,
      atlasRegions: spec.leaves.atlasRegions,
      flowersEnabled: spec.flowers.enabled,
      flowersStyle: spec.flowers.style,
      groundMode: spec.ground.mode,
    }
  },
  restoreSlot: snap => {
    const curPreview = hoverPreviewTex
    hoverPreviewTex = undefined
    hoverStashedOriginal = undefined
    if (snap.prevCustom) registry.setCustom(snap.slot, snap.prevCustom, false)
    else registry.resetDefault(snap.slot, false)
    if (curPreview && curPreview !== snap.prevCustom) curPreview.dispose()
    spec = {
      ...spec,
      shading: { ...spec.shading, leafStyle: snap.leafStyle },
      leaves: { ...spec.leaves, atlasCols: snap.atlasCols, atlasRows: snap.atlasRows, atlasRegions: snap.atlasRegions },
      flowers: { ...spec.flowers, enabled: snap.flowersEnabled, style: snap.flowersStyle },
      ground: { ...spec.ground, mode: snap.groundMode },
    }
    panel.sync()
    texSlots.drawSlot(snap.slot, true)
    rebuild(false)
  },
  applyTexture: (slot, tex, label, isPreview, meta) => applyProceduralTexture(slot, tex, label, isPreview, meta),
  openEditor: opts => textureEditor.open(opts),
  onOpen: () => {
    presetLibrary.close()
    textureEditor.close()
  },
  message,
})

const syncTexLibCount = () => { byId('tex-lib-count').textContent = String(textureStore.count) }
textureStore.subscribe(syncTexLibCount)
void textureStore.ready().then(syncTexLibCount)
syncTexLibCount()

const activityLogDrawer = mountActivityLogDrawer({
  triggerButton: byId<HTMLButtonElement>('activity-log-btn'),
  badgeElement: byId('al-badge'),
  onBeforeOpen: () => {
    presetLibrary.close()
    textureLibrary.close()
    textureEditor.close()
  },
  message: (text, err) => message(text, err, false),
})

function openEditorForSlot(slot: EditableTextureSlot) {
  const openNow = () => textureEditor.open(resolveSlotEditorOptions(slot, registry.getCustom(slot), textureStore, spec))
  if (!textureStore.isLoaded) {
    void textureStore.ensureLoaded().finally(openNow)
  } else {
    openNow()
  }
}

byId('tex-editor').onclick = () => {
  activityLogDrawer.close()
  const defaultSlot: EditableTextureSlot = spec.kind === 'conifer' ? 'needle'
    : spec.kind === 'palm' ? 'palm'
      : spec.kind === 'bamboo' ? 'bamboo'
        : spec.kind === 'lotus' ? 'lotusLeaf'
          : spec.kind === 'flowerbed' ? 'blossom'
            : spec.kind === 'grass' ? 'grass'
              : spec.kind === 'fern' ? 'fern' : 'leaf'
  openEditorForSlot(defaultSlot)
}

// 30-step parameter Undo/Redo (Ctrl+Z / Ctrl+Y) when 3D node editor & overlays aren't capturing shortcuts
window.addEventListener('keydown', ev => {
  if (ev.defaultPrevented) return
  const target = ev.target as HTMLElement | null
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)))) return
  if (textureEditor.isOpen() || textureLibrary.isOpen() || presetLibrary.isOpen() || activityLogDrawer.isOpen()) return
  if (!(ev.ctrlKey || ev.metaKey)) return
  const k = ev.key.toLowerCase()
  if (k === 'z' && !ev.shiftKey) {
    if (editor?.enabled && editor.canUndo()) return
    const prev = paramHistory.undo(spec)
    if (prev) {
      ev.preventDefault()
      applySpec(prev, false)
      message('已撤销参数修改')
    }
  } else if (k === 'y' || (k === 'z' && ev.shiftKey)) {
    const next = paramHistory.redo(spec)
    if (next) {
      ev.preventDefault()
      applySpec(next, false)
      message('已重做参数修改')
    }
  }
})
byId('tex-lib').onclick = () => { activityLogDrawer.close(); textureLibrary.toggle() }

byId('preset-save').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.open(true) }
byId('preset-lib').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.toggle() }

// ---- Scene Assembly Studio Live Edit Round-Trip ----------------------------
function syncSceneEditAppearanceUi() {
  if (!activeSceneEdit) return
  const isBroadleaf = spec.kind === 'broadleaf'
  const isWoody = spec.kind === 'broadleaf' || spec.kind === 'conifer' || spec.kind === 'palm'
  const barkWrap = byId('se-bark-wrap')
  const formWrap = byId('se-form-wrap')
  barkWrap.hidden = !isWoody
  formWrap.hidden = !isBroadleaf || (spec.trunk.treeForm !== 'meadow-birch' && activeSceneEdit.treeForm !== 'meadow-birch')
  byId<HTMLSelectElement>('se-bark-select').value = spec.trunk.barkStyle ?? 'default'
  byId<HTMLSelectElement>('se-form-select').value = spec.trunk.treeForm === 'meadow-birch' ? 'meadow-birch' : 'free'
}

byId<HTMLSelectElement>('se-bark-select').onchange = ev => {
  if (!activeSceneEdit) return
  paramHistory.push(spec)
  userDirty = true
  if (registry.isCustom('bark')) registry.resetDefault('bark')
  const val = (ev.target as HTMLSelectElement).value as BarkStyle
  const nextTrunk = { ...spec.trunk }
  if (val === 'default') delete nextTrunk.barkStyle
  else nextTrunk.barkStyle = val
  spec = { ...spec, trunk: nextTrunk }
  panel.sync()
  syncSceneEditAppearanceUi()
  texSlots?.syncThumbnails()
  rebuild(false)
}
byId<HTMLSelectElement>('se-form-select').onchange = ev => {
  if (!activeSceneEdit) return
  const val = (ev.target as HTMLSelectElement).value as TreeForm
  const nextTrunk = { ...spec.trunk }
  if (val === 'free') delete nextTrunk.treeForm
  else nextTrunk.treeForm = val
  spec = { ...spec, trunk: nextTrunk }
  panel.sync()
  syncSceneEditAppearanceUi()
  rebuild(false)
}

function currentSceneAppearancePayload() {
  return {
    barkStyle: spec.trunk.barkStyle ?? null,
    crownStyle: null,
    treeForm: spec.trunk.treeForm === 'meadow-birch' ? ('meadow-birch' as const) : null,
    leafTexture: sceneEditAppearance.leafTexture ?? null,
  }
}

let sceneEditSyncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSceneEditLiveSync() {
  if (!activeSceneEdit || !sceneEditHydrated) return
  if (sceneEditSyncTimer) clearTimeout(sceneEditSyncTimer)
  const sid = activeSceneEdit.sessionId
  const itemName = activeSceneEdit.itemName
  sceneEditSyncTimer = setTimeout(() => {
    sceneEditSyncTimer = undefined
    void saveSceneEditProgressAsync(sid, {
      treeSpec: deepClone(spec),
      customTextures: captureCustomRegistryTextures(registry),
      itemName,
      ...currentSceneAppearancePayload(),
      committed: false,
    })
  }, 180)
}

let sceneEditReturning = false
async function applySceneEditAndReturn(): Promise<boolean> {
  if (sceneEditParam && !sceneEditHydrated) await lastTextureApplyPromise
  if (!activeSceneEdit || sceneEditReturning) return false
  if (sceneEditSyncTimer) {
    clearTimeout(sceneEditSyncTimer)
    sceneEditSyncTimer = undefined
  }
  sceneEditReturning = true
  const applyBtn = byId<HTMLButtonElement>('scene-edit-apply')
  const prevText = applyBtn.textContent
  applyBtn.disabled = true
  applyBtn.textContent = '正在同步保存…'
  try {
    const customTextures = captureCustomRegistryTextures(registry)
    const saved = await saveSceneEditProgressAsync(activeSceneEdit.sessionId, {
      treeSpec: deepClone(spec),
      customTextures,
      itemName: activeSceneEdit.itemName,
      ...currentSceneAppearancePayload(),
      committed: true,
    })
    if (!saved) {
      message('同步保存失败：浏览器本地存储与 IndexedDB 均不可用或已满，已留在当前页，请先导出 JSON 备份后再试。', true)
      return false
    }
    const target = new URL(activeSceneEdit.returnUrl || './scene.html', location.href)
    target.searchParams.set('applyEdit', activeSceneEdit.sessionId)
    intentionalNavigation = true
    location.href = target.toString()
    return true
  } catch (err) {
    message(`同步保存失败：${err instanceof Error ? err.message : String(err)}`, true)
    return false
  } finally {
    if (!intentionalNavigation) {
      applyBtn.disabled = false
      applyBtn.textContent = prevText
      sceneEditReturning = false
    }
  }
}

function cancelSceneEditAndReturn() {
  const sid = activeSceneEdit?.sessionId ?? sceneEditParam
  if (!sid) return
  if (sceneEditSyncTimer) {
    clearTimeout(sceneEditSyncTimer)
    sceneEditSyncTimer = undefined
  }
  const target = new URL(activeSceneEdit?.returnUrl || './scene.html', location.href)
  target.searchParams.set('resumeEdit', sid)
  intentionalNavigation = true
  location.href = target.toString()
}

byId('scene-edit-apply').onclick = () => { void applySceneEditAndReturn() }
byId('scene-edit-cancel').onclick = cancelSceneEditAndReturn

if (sceneEditParam) {
  lastTextureApplyPromise = (async () => {
    const loaded = await loadSceneEditSessionAsync(sceneEditParam)
    if (!loaded) {
      activeSceneEdit = undefined
      byId('app').classList.remove('has-scene-edit')
      byId('scene-edit-banner').hidden = true
      byId('scene-edit-picks').hidden = true
      syncStudioTop()
      userDirty = false
      await applyBuiltInPresetState(presetId, treeDefaults.get(presetId), true)
      message('未找到对应的场景联调会话，已切回常规树木工作台', true)
      return
    }
    activeSceneEdit = loaded
    userDirty = true
    sceneEditAppearance.barkStyle = loaded.barkStyle
    sceneEditAppearance.crownStyle = loaded.crownStyle
    sceneEditAppearance.treeForm = loaded.treeForm
    sceneEditAppearance.leafTexture = loaded.leafTexture
    sceneEditAppearance.category = loaded.category
    sceneEditAppearance.lighting = loaded.lighting

    byId('app').classList.add('has-scene-edit')
    byId('scene-edit-banner').hidden = false
    byId('scene-edit-picks').hidden = false
    const infoText = document.querySelector('#scene-edit-banner .se-return-text')
    if (infoText) {
      infoText.innerHTML = `正在编辑「${escHtml(loaded.sceneName || '组装场景')}」中的 <strong>${escHtml(loaded.itemName || '')}</strong>`
    }
    syncStudioTop()

    const parsed = resolveAssemblyTreeSpec(parseTreeSpec(loaded.treeSpec), sceneEditAppearance)
    spec = parsed.handles?.length ? deepClone(parsed) : withDefaultHandles(deepClone(parsed))
    initialSceneEditSnapshot = {
      spec: deepClone(spec),
      appearance: { ...sceneEditAppearance },
      lighting: loaded.lighting ?? 'ghibli',
      customTextures: loaded.customTextures ? deepClone(loaded.customTextures) : undefined,
    }
    camera = defaultCameraForPlant(spec)
    const matchPreset = presetIds.find(id => presets[id].kind === spec.kind && presets[id].name === spec.name)
      ?? presetIds.find(id => presets[id].kind === spec.kind)
      ?? presetId
    presetId = matchPreset
    const presetSel = byId<HTMLSelectElement>('preset')
    if (presetSel) presetSel.value = presetId
    setLightingMood(loaded.lighting ?? 'ghibli')
    syncSceneEditAppearanceUi()
    for (const slot of editableTextureSlots) registry.resetDefault(slot)
    if (loaded.customTextures) {
      const decoded = await decodeSavedTextureMap(loaded.customTextures)
      for (const slot of editableTextureSlots) {
        const tex = decoded[slot]
        if (tex) registry.setCustom(slot, tex, true)
      }
      texSlots?.syncThumbnails()
    }
    applySpec(spec, true)
    sceneEditHydrated = true
    message(`已按 1:1 场景外观载入「${loaded.itemName}」，编辑完成后点击上方绿色按钮实时同步`)
  })()
} else {
  void applyBuiltInPresetState(presetId, bootOverride, true)
}

// automation hooks for browser checks
Object.assign(window, {
  __activityLog: {
    store: activityLog,
    open: () => activityLogDrawer.open(),
    close: () => activityLogDrawer.close(),
    entries: () => activityLog.entries(),
    counts: () => activityLog.counts(),
    exportJson: () => activityLog.exportJson(),
    exportText: () => activityLog.exportText(),
    clear: () => activityLog.clear(),
  },
  __studio: {
  get spec() { return spec },
  get stats() { return asset ? { ...asset.stats } : undefined },
  get buildCount() { return buildCount },
  get woodBuildCount() { return woodBuildCount },
  get lighting() { return lighting },
  get wind() { return windEnabled },
  sceneEdit: {
    get active() { return Boolean(activeSceneEdit) },
    get sessionId() { return activeSceneEdit?.sessionId },
    get itemId() { return activeSceneEdit?.itemId },
    get itemName() { return activeSceneEdit?.itemName },
    get appearance() {
      return {
        ...sceneEditAppearance,
        barkStyle: spec.trunk.barkStyle,
        crownStyle: undefined,
        treeForm: spec.trunk.treeForm === 'meadow-birch' ? ('meadow-birch' as const) : undefined,
      }
    },
    setAppearance: (patch: Partial<ScenePlantAppearance>) => {
      Object.assign(sceneEditAppearance, patch)
      spec = resolveAssemblyTreeSpec(spec, patch)
      panel.sync()
      syncSceneEditAppearanceUi()
      texSlots?.syncThumbnails()
      rebuild(false)
    },
    applyAndReturn: () => applySceneEditAndReturn(),
    cancelAndReturn: () => cancelSceneEditAndReturn(),
    ready: () => lastTextureApplyPromise,
  },
  loadedTextures: () => registry.loadedSlots(),
  customTextureNames: () => Object.fromEntries(
    editableTextureSlots.flatMap(s => {
      const c = registry.getCustom(s)
      return c ? [[s, c.name]] : []
    }),
  ),
  presets: {
    store: presetStore,
    open: (focus?: boolean) => presetLibrary.open(focus),
    close: () => presetLibrary.close(),
    list: () => presetStore.list<TreeSpec>('tree'),
    saveDefault: () => saveCurrentAsDefaultPreset(),
    resetFactory: () => resetCurrentToFactoryPreset(),
    hasDefaultOverride: (id?: PresetId) => treeDefaults.has(id ?? presetId),
    defaultOverridesReady: () => bootSyncPromise.then(() => lastTextureApplyPromise),
  },
  textures: {
    store: textureStore,
    editor: textureEditor,
    agent: textureEditor.agent,
    library: textureLibrary,
    openEditor: (slot?: EditableTextureSlot) => (slot ? openEditorForSlot(slot) : textureEditor.open({})),
    closeEditor: () => textureEditor.close(),
    openLibrary: (tab?: 'mine' | 'templates') => textureLibrary.open(tab),
    closeLibrary: () => textureLibrary.close(),
  },
  set(patch: (s: TreeSpec) => TreeSpec) { userDirty = true; applySpec(patch(spec), false) },
  handleScreen: (id: number) => editor?.screenPosition(id),
  selectedHandleId: () => editor?.selectedId,
  hoveredHandleId: () => editor?.hoveredHandleId,
  pickHandlesAt: (x: number, y: number) => editor?.pickHandlesAtClient(x, y).map(h => ({ id: h.id, camDist: h.camDist })) ?? [],
  setCamera: (x: number, y: number, z: number, tx?: number, ty?: number, tz?: number) => {
    viewer?.camera.position.set(x, y, z)
    if (tx !== undefined && ty !== undefined && tz !== undefined) viewer?.controls.target.set(tx, ty, tz)
    viewer?.controls.update()
    viewer?.camera.updateMatrixWorld(true)
  },
  setEditMode: (on: boolean) => editUi?.setEnabled(on),
  setEditSubMode: (sub: EditSubMode) => { editor?.setSubMode(sub); editUi?.sync() },
  selectBranch: (id: number | undefined) => editor?.selectBranch(id),
  selectedBranch: () => editor?.getSelectedBranchInfo(),
  branchScreen: (id: number, t?: number) => editor?.branchScreen(id, t),
  gizmoScreen: (target: GizmoKind | 'root' | `spline-${number}`) => editor?.gizmoScreen(target),
  normalCenterScreen: () => editor?.normalCenterScreen(),
  setNormalTool: (tool: NormalTool) => { editor?.setNormalTool(tool); editUi?.sync() },
  setNormalDebugColor: (on: boolean) => { editor?.setNormalDebugColor(on); editUi?.sync() },
  setShowNormalVectors: (on: boolean) => { editor?.setShowNormalVectors(on); editUi?.sync() },
  setBarkClay: (on: boolean) => { barkClayView.uBarkClay.value = on ? 1 : 0 },
  undoEdit: () => editor?.undo() ?? false,
  extent() {
    const pts = asset?.skeleton.branches.flatMap(b => b.points) ?? []
    return { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)), minY: Math.min(...pts.map(p => p.y)) }
  },
  setWind: (on: boolean) => { windBtn.setAttribute('aria-pressed', String(on)); viewer?.setWind(on) },
  setLighting: (mood: LightingPreset) => setLightingMood(mood),
  setView: (next: View) => {
    view = next
    asset?.display(view)
    viewer?.refreshShadows()
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === next))
  },
  setCameraPreset: (cam: Camera) => {
    camera = cam
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) b.setAttribute('aria-pressed', String(b.dataset.camera === cam))
    viewer?.frame(cam)
  },
  listPresets: () => presetIds.map(id => ({ id, name: presets[id].name, kind: presets[id].kind })),
  loadPreset: (id: PresetId, seed?: number) => {
    if (!(presetIds as readonly string[]).includes(id)) throw new Error('未知预设 ID: ' + id)
    activeCustomId = undefined
    presetLibrary.setActiveId(undefined)
    presetId = id
    byId<HTMLSelectElement>('preset').value = id
    userDirty = true
    applySpec(withDefaultHandles(presetSpec(id, seed)), true)
  },
  setParam: (path: string, value: unknown) => {
    applyStudioParam(path, value, true)
    panel.sync()
    rebuild(false)
  },
  setLod: (opts: { level?: number; targetTriangles?: number }) => {
    userDirty = true
    if (typeof opts.targetTriangles === 'number' && opts.targetTriangles > 0) {
      const solved = solveForTriangleBudget(spec, effectiveTextures(), opts.targetTriangles)
      spec = { ...spec, optimize: solved.optimize }
      panel.sync()
      if (!remeshOptimizeOnly(true)) rebuild(false)
      return solved
    }
    const lv = typeof opts.level === 'number' ? opts.level : 0
    spec = { ...spec, optimize: optimizeAt(lv, spec.optimize.targetTriangles) }
    panel.sync()
    if (!remeshOptimizeOnly(true)) rebuild(false)
    return { optimize: spec.optimize, triangles: asset?.stats.triangles ?? 0 }
  },
  snapshotCanvas: (opts?: { transparent?: boolean }) => captureStudioPng(Boolean(opts?.transparent)),
  snapshotTransparentCanvas: () => captureStudioPng(true),
  exportGlbBase64: async (opts?: Parameters<NonNullable<typeof asset>['exportGlb']>[0]) => {
    if (!asset) throw new Error('当前没有可导出的树木模型')
    const blob = await asset.exportGlb(opts)
    const base64 = await blobToBase64(blob)
    return {
      base64,
      bytes: blob.size,
      filename: `${fileName()}${opts?.mode === 'merged' ? '-merged' : ''}.glb`,
    }
  },
  textureDataUrl: (slot: AllTextureSlot) => (registry.get(slot).image as HTMLCanvasElement).toDataURL('image/png'),
} })

mountDesktopToolbarBadge('header.bar nav', msg => message(msg))

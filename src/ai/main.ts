// Vegetation Studio · AI Mode (Blank Project + Image-to-Plant Engine)
// Starts as an empty canvas, exposes 100% of procedural generators, parameters,
// crown handles, LOD optimization, texture slots, and JSON/LLM schema, and turns
// any dropped plant image directly into an editable procedural 3D plant.
import '../style.css'
import '../studio/studio.css'
import './ai.css'
import { Box3, Group, MathUtils, Vector3, type Texture } from 'three'
import { lightingPresets, Viewer, type Camera, type LightingPreset } from '../viewport'
import { exportGlb } from '../export-glb'
import { isOptimizeOnlyParam, isWoodOnlyParam, views, type View } from '../tree/assemble'
import { CrownEnvelope, defaultHandles } from '../tree/envelope'
import { lodPresets, optimizeAt, solveForTriangleBudget } from '../tree/optimize'
import { buildSkeleton } from '../tree/skeleton'
import {
  presetSpec, treeKinds,
  type BranchEdit, type LeafNormalEditSpec, type TreeKind, type TreeSpec,
} from '../tree/spec'
import { CrownEditor, type EditSubMode, type GizmoKind, type NormalTool, type PickablePart } from '../studio/editor'
import { bindEditToolsUi, editToolsHtml } from '../studio/editor-ui'
import { bindGlbExportPopover } from '../studio/glb-export-ui'
import { bindPanel, panelHtml } from '../studio/panel'
import { mountPresetLibrary } from '../studio/preset-library'
import { captureViewportThumbnail, createPresetStore, deepClone } from '../studio/preset-store'
import { bindTextureSlots, createTextureRegistry, type EditableTextureSlot } from '../studio/texture-slots'
import { mountTextureEditor } from '../texgraph/editor-ui'
import {
  attachTextureGraphSource, mountTextureLibrary, resolveSlotEditorOptions, type AppliedTextureMeta,
} from '../texgraph/library-ui'
import { createTextureLibraryStore } from '../texgraph/store'
import { makePainterlyDriftwoodBarkTexture, makePainterlyMossBarkTexture } from '../texgraph/templates'
import { defaultCategoryForSlot } from '../texgraph/types'
import { analyzePlantImage, computeScribbleMask, type AnalysisReport, type PixelBuffer } from './analyze'
import {
  aiCapabilitySchema, applySceneLeafTexture, applySceneParam, applySceneSeed, applySceneUniformScale,
  blankAiScene, buildAiScene, createAiPart, leafTextureLabels, leafTextureSources, parseAiScene,
  solveSceneForTriangleBudget,
  type AiPart, type AiSceneAsset, type AiSceneSpec, type EditScope, type LeafTextureSource, type PartCustomTextures,
} from './scene'
import { aiShowcases, getAiShowcase } from './showcase'
import { createHiddenShowcaseStore } from './showcase-store'
import { activityLog, initStudioLogging } from '../studio/activity-log'
import { mountActivityLogDrawer } from '../studio/activity-log-ui'
import { mountDesktopToolbarBadge, tryDesktopSaveBlob } from '../studio/desktop-bridge'
import { SnapshotHistory } from '../studio/history'

const hiddenShowcaseStore = createHiddenShowcaseStore({ validIds: aiShowcases.map(s => s.id) })
const visibleShowcases = () => aiShowcases.filter(s => !hiddenShowcaseStore.isHidden(s.id))

const cameras: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const viewLabel: Record<View, string> = { final: '成品', skeleton: '枝干骨架', crown: '树冠' }
const kindNames: Record<TreeKind, string> = {
  broadleaf: '阔叶树 / 观花树', conifer: '针叶树', palm: '棕榈树', bamboo: '竹子', lotus: '荷花',
  grass: '草丛', fern: '蕨类', flowerbed: '花丛模板', botanical: '风格化植物',
}
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')

byId('app').classList.add('s-studio')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark" aria-hidden="true">✦</span><div><h1>Vegetation Studio <span class="ai-badge">AI 模式</span></h1><span>空白参数化工程 · 丢图即生成全参数可调植物</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./broadleaf.html">← 经典工作台</a>
    <a class="b-link" href="./rock.html" title="风格化石头工作台 · 切面雕刻与赛璐璐">◈ 石头工作台</a>
    <a class="b-link" href="./scene.html" title="场景组装工作台 · 自由摆放树木花草石头查看整体效果">❖ 场景组装</a>
    <input id="ai-image-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    <button id="ai-upload-top" class="primary">上传参考图</button>
    <button id="ai-showcase-top" class="pl-showcase-btn" title="打开内置 AI 成品案例库（支持悬停实时 3D 预览）">✿ 案例库<span class="pl-badge" id="ai-showcase-top-count">${visibleShowcases().length}</span></button>
    <button id="ai-clear">清空空白</button>
    <button id="tex-editor" class="tg-open-btn" title="打开 Substance 风格树叶/树皮程序化贴图节点编辑器">◈ 贴图编辑</button>
    <button id="tex-lib" class="tl-open-btn" title="打开实时贴图库（支持悬停 3D 预览、保存与复用）">🎨 贴图库<span class="pl-badge" id="tex-lib-count">0</span></button>
    <button id="preset-save" class="pl-save-btn" title="带当前 3D 实时封面保存为预设">★ 保存预设</button>
    <button id="preset-lib" title="打开可视化预设库（支持悬停实时 3D 预览）">预设库<span class="pl-badge" id="preset-lib-count">0</span></button>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button><button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button><button id="png-alpha" title="导出透明背景抠图 PNG（自动隐藏背景、阴影底板与编辑辅助线）">透明底 PNG</button><button id="glb" title="导出 GLB / 拆分 glTF+贴图 / FBX+TEX">导出 GLB/FBX</button>
    <button id="activity-log-btn" class="al-open-btn" title="查看每一步用户操作与导出诊断日志（支持一键复制/导出排查问题）">📋 日志<span class="pl-badge" id="al-badge">0</span></button>
  </nav>
</header>
<section class="workspace">
  <section class="viewport panel" aria-label="三维工作区">
    <header class="viewport-head"><h2 id="tree-title">空白植物工程</h2><div style="display:flex;gap:8px;align-items:center"><button type="button" id="wind-toggle" aria-pressed="true" title="开关微风轻拂动画" style="font-size:12px;padding:4px 9px;border-radius:8px">🍃 微风</button><select id="lighting" title="预览氛围光预设" style="font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid rgba(40,56,44,.16);background:rgba(255,255,255,.78)">
      ${Object.entries(lightingPresets).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
    </select><div class="switcher" role="group" aria-label="显示模式">
      ${views.map(v => `<button data-view="${v}" aria-pressed="${v === 'final'}">${viewLabel[v]}</button>`).join('')}
    </div></div></header>
    <div class="stage" id="ai-stage"><div id="canvas"></div>
      <div class="ai-stage-drop" id="ai-drop-empty">
        <div class="ai-drop-card">
          <div class="ai-drop-icon" aria-hidden="true">✦</div>
          <h3>AI 空白植物工程</h3>
          <p>已暴露全部 6 类植物算法、多叶型贴图库、树冠控制点、真树干样条复刻、LOD 减面与抠图画笔。<br>把任意植物图片拖到这里即可自动生成 3D 植物，或先体验内置成品案例。</p>
          <div class="ai-drop-actions">
            <button type="button" id="ai-drop-btn" class="primary">选择或拖入植物图片</button>
            <button type="button" id="ai-showcase-btn" class="pl-showcase-btn">✿ 浏览案例库（${visibleShowcases().length}）</button>
            ${aiShowcases.map(s => `<button type="button" data-quick-case="${s.id}" title="${s.subtitle}"${hiddenShowcaseStore.isHidden(s.id) ? ' hidden' : ''}>✿ ${s.name}</button>`).join('')}
            <button type="button" id="ai-open-presets">★ 打开我的预设库</button>
            <button type="button" id="ai-add-blank">＋ 手动添加空白部件</button>
          </div>
        </div>
      </div>
      <aside class="ai-ref-hud" id="ai-ref-hud" hidden>
        <div class="ai-ref-top">
          <img id="ai-ref-img" alt="参考图预览">
          <div class="ai-ref-meta">
            <b id="ai-ref-name">参考图</b>
            <span id="ai-ref-summary"></span>
          </div>
        </div>
        <div class="ai-swatches" id="ai-swatches"></div>
        <div class="ai-ref-btns">
          <button type="button" id="ai-ref-mask" title="遇到复杂实景背景时，绿笔涂植物、红笔涂背景修补抠图">✎ 抠图画笔</button>
          <button type="button" id="ai-ref-change">换图生成</button>
          <button type="button" id="ai-ref-hide">收起</button>
        </div>
      </aside>
      <div class="camera-tools switcher" role="group" aria-label="固定机位">
        ${Object.entries(cameras).map(([k, l]) => `<button data-camera="${k}" aria-pressed="${k === 'front'}">${l}</button>`).join('')}
      </div>
      ${editToolsHtml('✎ 节点编辑')}
      <div class="gesture">拖入图片即生成 · 左键旋转 · 滚轮缩放 · 右键平移</div>
      <div class="error" id="webgl" hidden>预览需要支持 WebGL 2 的浏览器。</div>
    </div>
    <div class="stats s-stats">
      ${Object.entries({ parts: '部件', branches: '枝干', leaves: '叶/花片', triangles: '三角面', ms: '生成 ms', calls: 'Draw Calls' }).map(([k, l]) =>
        `<div><span id="label-${k}">${l}</span><output id="stat-${k}">0</output></div>`).join('')}
    </div>
  </section>
  <form class="inspector panel s-inspector" id="form" aria-label="全参数工作台" onsubmit="return false">
    <header class="inspect-head"><h2>暴露参数 · 部件</h2><button id="ai-ref-show" type="button" hidden>显示参考图</button></header>
    <div class="ai-parts-box">
      <div class="ai-parts-head"><b>植物部件图层（支持多干 / 多层组合）</b></div>
      <div class="ai-add-row">
        <select id="ai-add-kind">
          ${treeKinds.map(k => `<option value="${k}">${kindNames[k]}</option>`).join('')}
        </select>
        <button type="button" id="ai-add-part">＋ 添加部件</button>
      </div>
      <div class="ai-part-list" id="ai-part-list"></div>
      <div class="ai-global-lod" id="ai-global-lod" hidden>
        <div class="ai-global-lod-head"><span>全场景一键减面 · LOD</span><output id="ai-global-lod-out"></output></div>
        <div class="ai-global-lod-btns">
          ${lodPresets.map(p => `<button type="button" data-global-lod="${p.level}" title="同步优化全部部件：${p.hint}">${p.label}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="s-scroll" id="panel-wrap">
      <div id="ai-part-controls" hidden>
        <div class="ai-scope-banner" id="ai-scope-banner">
          <div class="ai-scope-top">
            <b id="ai-scope-title">🌐 整体同步模式</b>
            <button type="button" id="ai-scope-btn" title="进入编辑模式后可单独选中单个部件独立调色、换贴图与改参数">✎ 单体编辑</button>
          </div>
          <span id="ai-scope-desc">所有颜色、材质、贴图与参数自动同步到整株植物</span>
        </div>
        <details class="s-section" open>
          <summary id="part-meta-summary">整体 · 贴图源、种子与缩放</summary>
          <div id="part-single-meta" hidden>
            <label class="s-field"><span>部件名称</span><input id="part-label" type="text"><i></i></label>
            <label class="s-field"><span>植物算法类型</span><select id="part-kind">
              ${treeKinds.map(k => `<option value="${k}">${kindNames[k]}</option>`).join('')}
            </select><i></i></label>
          </div>
          <label class="s-field"><span>叶面贴图源</span><select id="part-tex">
            ${leafTextureSources.map(s => `<option value="${s}">${leafTextureLabels[s]}</option>`).join('')}
          </select><i></i></label>
          <label class="s-field"><span>随机种子</span><input id="seed" type="number" min="0" step="1"><button type="button" id="reseed" title="随机">🎲</button></label>
          <label class="s-field"><span>整体缩放</span><input id="part-sc" type="number" min="0.1" max="5" step="0.05"><i></i></label>
          <div id="part-single-pose" class="ai-transform-grid" hidden>
            <label>位置 X m<input id="part-px" type="number" step="0.05"></label>
            <label>位置 Y m<input id="part-py" type="number" step="0.05"></label>
            <label>位置 Z m<input id="part-pz" type="number" step="0.05"></label>
            <label>旋转 Y°<input id="part-ry" type="number" step="5"></label>
            <label>快速操作<button type="button" id="part-dup">复制部件</button></label>
          </div>
          <div id="part-spine-row" hidden style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px;font-size:11px;color:#2f6c47">
            <span>✦ 已启用原图真树干样条复刻</span>
            <button type="button" id="part-clear-spine" style="font-size:11px;padding:3px 7px">切回参数树干</button>
          </div>
        </details>
        <div id="panel">${panelHtml()}</div>
      </div>
      <div class="ai-empty-note" id="ai-inspector-empty">当前为空白工程。上传植物图片或点击上方「＋ 添加部件」后，全部算法参数将在此展开。</div>
      <details class="s-section" id="ai-bridge">
        <summary>AI 能力 Schema & JSON 接口</summary>
        <div class="ai-json-box">
          <p class="s-note">此处暴露完整的参数能力表与场景 JSON，可供外部视觉大模型或脚本直接读写生成植物。</p>
          <div class="ai-json-actions">
            <button type="button" id="ai-copy-schema">复制能力 Schema</button>
            <button type="button" id="ai-copy-json">复制当前 JSON</button>
          </div>
          <textarea id="ai-json-text" spellcheck="false" placeholder="粘贴 AiSceneSpec JSON 或单植物 TreeSpec JSON…"></textarea>
          <button type="button" id="ai-apply-json" class="primary">应用 JSON 到三维画布</button>
          <div class="ai-llm-fields">
            <p class="s-note">可选：接入兼容 OpenAI 的视觉大模型（不填则自动使用内置本地图像算法实时生成）</p>
            <input id="ai-llm-url" type="url" placeholder="API Endpoint（如 https://api.openai.com/v1/chat/completions）">
            <input id="ai-llm-model" type="text" placeholder="模型名（如 gpt-4o / gemini-2.5-pro）">
            <input id="ai-llm-key" type="password" data-log-ignore="true" autocomplete="off" placeholder="API Key（仅保存在当前会话内存）">
            <button type="button" id="ai-llm-run">用视觉大模型重分析当前图</button>
          </div>
        </div>
      </details>
    </div>
  </form>
</section>
<div id="ai-mask-modal" class="ai-mask-modal" hidden>
  <div class="ai-mask-card">
    <div class="ai-mask-head">
      <h3>✎ 前景 / 背景抠图修补画笔（复杂实景背景专用）</h3>
      <button type="button" id="ai-mask-close">✕</button>
    </div>
    <p class="s-note" style="margin:0">绿笔在植物主体上轻涂几笔，红笔在要去掉的杂乱背景上轻涂几笔，实时预览抠图范围后点应用即可。</p>
    <div class="ai-mask-tools">
      <button type="button" data-brush="1" aria-pressed="true">● 绿笔：保留植物</button>
      <button type="button" data-brush="2" aria-pressed="false">● 红笔：擦除背景</button>
      <button type="button" id="ai-mask-reset">重置涂抹</button>
      <label>笔刷 <input id="ai-mask-size" type="range" min="3" max="24" step="1" value="10"></label>
    </div>
    <div class="ai-mask-canvas-wrap"><canvas id="ai-mask-canvas" width="256" height="256"></canvas></div>
    <div class="ai-mask-foot">
      <button type="button" id="ai-mask-cancel">取消</button>
      <button type="button" id="ai-mask-apply" class="primary">按修补结果重新生成 3D</button>
    </div>
  </div>
</div>
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

// ---- state & textures ------------------------------------------------------
let sceneSpec: AiSceneSpec = blankAiScene()
let selectedId: string | undefined
let lastReport: AnalysisReport | undefined
let lastImageDataUrl: string | undefined
let lastImageName: string | undefined
let lastPixels: PixelBuffer | undefined
let lastCustomMask: Uint8Array | undefined
let globalLodLevel = 0
let optScope: 'all' | 'part' = 'all'
let sceneAsset: AiSceneAsset | undefined
let view: View = 'final'
let camera: Camera = 'front'
let lighting: LightingPreset = 'neutral'
let userDirty = false
const aiHistory = new SnapshotHistory<AiSceneSpec>({ maxDepth: 30, clone: deepClone })

function setLightingMood(mood: LightingPreset) {
  lighting = mood
  byId<HTMLSelectElement>('lighting').value = mood
  viewer?.setLighting(mood)
  if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
}

const registry = createTextureRegistry()
const textures = registry.textures
// Per-part custom uploaded texture overrides (used exclusively when editing a single part in Edit Mode)
const partCustomTextures: PartCustomTextures = new Map()
const partCustomNames = new Map<string, Partial<Record<EditableTextureSlot, string>>>()

function clearAllPartCustomTextures(slot?: EditableTextureSlot) {
  if (!slot) {
    for (const map of partCustomTextures.values()) {
      for (const tex of Object.values(map)) tex?.dispose()
    }
    partCustomTextures.clear()
    partCustomNames.clear()
    return
  }
  for (const [pid, map] of partCustomTextures) {
    if (map[slot]) { map[slot]!.dispose(); delete map[slot] }
    const nm = partCustomNames.get(pid)
    if (nm) delete nm[slot]
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
  toastTimer = setTimeout(() => { toast.hidden = true }, 4200)
  if (logIt) {
    if (error) activityLog.error('system', `提示错误：${text}`, value instanceof Error ? value : undefined)
    else activityLog.info('system', `状态提示：${text}`)
  }
}

const activePart = (): AiPart | undefined => sceneSpec.parts.find(p => p.id === selectedId) ?? sceneSpec.parts[0]
const fallbackSpec = presetSpec('broadleaf-round')
const axisOf = (s: TreeSpec) => buildSkeleton({ ...s, handles: [] }).envelope.axis

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
  page: 'ai',
  getWebGLContext: () => viewer?.renderer.getContext() ?? null,
})

let cachedAxis = { key: '', axis: new Vector3() }
let editUi: ReturnType<typeof bindEditToolsUi> | undefined
const editor: CrownEditor | undefined = viewer ? new CrownEditor(viewer, {
  spec: () => activePart()?.spec ?? fallbackSpec,
  axis: () => {
    const p = activePart()
    if (!p) return new Vector3()
    const s = p.spec
    const key = JSON.stringify([p.id, s.kind, s.seed, s.trunk, s.crown.base, s.palm.bend, s.palm.sCurve, s.branchEdits])
    if (key !== cachedAxis.key) cachedAxis = { key, axis: axisOf(s) }
    return cachedAxis.axis
  },
  skeleton: () => {
    const p = activePart()
    return p ? sceneAsset?.partAssets.get(p.id)?.skeleton : undefined
  },
  foliageObject: () => {
    const p = activePart()
    return p ? sceneAsset?.partAssets.get(p.id)?.group : undefined
  },
  partId: () => activePart()?.id,
  partLabel: () => (sceneSpec.parts.length > 1 ? activePart()?.label : undefined),
  canHandleShortcuts: (): boolean => !textureEditor?.isOpen() && !textureLibrary?.isOpen() && !presetLibrary?.isOpen() && !activityLogDrawer?.isOpen() && byId('ai-mask-modal').hidden,
  setHandles: (handles, final) => {
    const p = activePart()
    if (!p) return
    userDirty = true
    p.spec = { ...p.spec, handles }
    if (final) activityLog.action(`调整部件「${p.label}」树冠控制点（${handles.length} 个）`, { partId: p.id, count: handles.length }, 'scene')
    scheduleBuild(final, p.id)
  },
  setBranchEdits: (branchEdits: BranchEdit[], final: boolean) => {
    const p = activePart()
    if (!p) return
    userDirty = true
    const next = { ...p.spec }
    if (branchEdits.length) next.branchEdits = branchEdits
    else delete next.branchEdits
    p.spec = next
    if (final) activityLog.action(`编辑部件「${p.label}」枝条节点（${branchEdits.length} 条）`, { partId: p.id, count: branchEdits.length }, 'scene')
    scheduleBuild(final, p.id)
  },
  setLeafEdits: (leafEdits, final) => {
    const p = activePart()
    if (!p) return
    userDirty = true
    const next = { ...p.spec }
    if (leafEdits && (leafEdits.clumps.length || leafEdits.brushes.length)) next.leafEdits = leafEdits
    else delete next.leafEdits
    p.spec = next
    if (final) {
      activityLog.action(
        `编辑部件「${p.label}」树叶（补叶簇 ${leafEdits?.clumps.length ?? 0} · 笔刷 ${leafEdits?.brushes.length ?? 0}）`,
        { partId: p.id, clumps: leafEdits?.clumps.length ?? 0, brushes: leafEdits?.brushes.length ?? 0 },
        'scene',
      )
    }
    scheduleBuild(final, p.id)
  },
  setNormalEdit: (normalEdit: LeafNormalEditSpec, final: boolean) => {
    const p = activePart()
    if (!p) return
    userDirty = true
    p.spec = { ...p.spec, normalEdit }
    panel.sync()
    if (final) activityLog.action(`笔刷调整部件「${p.label}」叶片法线（${normalEdit.mode}）`, { partId: p.id, mode: normalEdit.mode }, 'scene')
    scheduleBuild(final, p.id)
  },
  selected: handle => editUi?.showSelectedHandle(handle),
  selectedBranch: info => editUi?.showSelectedBranch(info),
  onStateChange: () => editUi?.sync(),
  otherParts: (): PickablePart[] => {
    if (!sceneAsset) return []
    const curId = activePart()?.id
    const out: PickablePart[] = []
    for (const part of sceneSpec.parts) {
      if (!part.enabled || part.id === curId) continue
      const built = sceneAsset.partAssets.get(part.id)
      if (!built) continue
      built.group.updateMatrixWorld(true)
      out.push({
        partId: part.id,
        label: part.label,
        skeleton: built.skeleton,
        matrixWorld: built.group.matrixWorld,
        group: built.group,
      })
    }
    return out
  },
  focusPart: (partId: string) => {
    if (partId !== selectedId) selectPart(partId)
  },
}) : undefined

// ---- build scheduling (incremental per-part + adaptive drag throttle) ------
let lastBuildMs = 0, lastBuildAt = 0, pending = false, pendingFinal = false
let pendingPartId: string | 'ALL' | undefined
let frame = 0, frameHeight = 5.5
let fullBuildCount = 0, partBuildCount = 0, woodBuildCount = 0
let lastWoodMs = 0, lastWoodAt = 0, woodPending = false, woodPendingFinal = false, woodFrame = 0
let pendingWoodPartIds = new Set<string>()
let jsonDirty = false
let sceneEpoch = 0

function cancelScheduledBuilds() {
  pending = false
  pendingFinal = false
  pendingPartId = undefined
  cancelAnimationFrame(frame)
  woodPending = false
  woodPendingFinal = false
  pendingWoodPartIds.clear()
  cancelAnimationFrame(woodFrame)
}

function scheduleWoodBuild(partIds: string[], final = true) {
  const epoch = sceneEpoch
  for (const id of partIds) pendingWoodPartIds.add(id)
  woodPending = true
  woodPendingFinal = woodPendingFinal || final
  cancelAnimationFrame(woodFrame)
  woodFrame = requestAnimationFrame(() => {
    if (epoch !== sceneEpoch) return
    const isFinal = woodPendingFinal
    const interval = isFinal ? 0 : Math.min(48, Math.max(0, lastWoodMs * 1.15))
    if (performance.now() - lastWoodAt < interval) { scheduleWoodBuild([], isFinal); return }
    if (woodPending) {
      const ids = [...pendingWoodPartIds]
      pendingWoodPartIds.clear()
      woodPending = false
      woodPendingFinal = false
      rebuildPartsWoodOnly(ids)
    }
  })
}

function rebuildPartsWoodOnly(partIds: string[]) {
  if (!viewer || !sceneAsset) { rebuild(false); return }
  const started = performance.now()
  try {
    let allOk = true
    for (const id of partIds) {
      const p = sceneSpec.parts.find(x => x.id === id)
      if (!p || !p.enabled || !sceneAsset.rebuildPartWoodOnly(p, textures, sceneSpec, partCustomTextures)) {
        allOk = false
        break
      }
    }
    if (!allOk) {
      if (partIds.length === 1) rebuildSinglePart(partIds[0])
      else rebuild(false)
      return
    }
    woodBuildCount++
    updateSceneStatsUi(sceneAsset)
    updateOptStatus()
    updateGlobalLodUi()
    viewer.refreshShadows()
    markJsonDirty()
    if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
  } catch (error) {
    console.error(error)
    message(error, true)
  }
  lastWoodMs = performance.now() - started
  lastWoodAt = performance.now()
}

function scheduleBuild(final = true, partId?: string) {
  const epoch = sceneEpoch
  woodPending = false
  woodPendingFinal = false
  pendingWoodPartIds.clear()
  cancelAnimationFrame(woodFrame)
  if (!pending) {
    pendingPartId = partId ?? 'ALL'
  } else if (pendingPartId !== (partId ?? 'ALL')) {
    pendingPartId = 'ALL'
  }
  pending = true
  pendingFinal = pendingFinal || final
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (epoch !== sceneEpoch) return
    const isFinal = pendingFinal
    const interval = isFinal ? 0 : Math.max(0, lastBuildMs * 2.5)
    if (performance.now() - lastBuildAt < interval) {
      scheduleBuild(isFinal, pendingPartId === 'ALL' ? undefined : pendingPartId)
      return
    }
    if (pending) {
      const target = pendingPartId
      pending = false
      pendingFinal = false
      pendingPartId = undefined
      if (target && target !== 'ALL') rebuildSinglePart(target)
      else rebuild(false)
    }
  })
}

function syncEditorTransform() {
  if (!editor) return
  const p = activePart()
  if (!p) {
    editor.group.position.set(0, 0, 0)
    editor.group.rotation.y = 0
    editor.group.scale.setScalar(1)
    editor.group.updateMatrixWorld(true)
    return
  }
  editor.group.position.set(p.position[0], p.position[1], p.position[2])
  editor.group.rotation.y = MathUtils.degToRad(p.rotationY)
  editor.group.scale.setScalar(Math.max(.05, p.scale))
  editor.group.updateMatrixWorld(true)
}

function updateSceneStatsUi(asset: AiSceneAsset) {
  byId('stat-parts').textContent = fmt.format(asset.stats.parts)
  byId('stat-branches').textContent = fmt.format(asset.stats.branches)
  byId('stat-leaves').textContent = fmt.format(asset.stats.leaves + (asset.stats.flowers !== asset.stats.leaves ? asset.stats.flowers : 0))
  byId('stat-triangles').textContent = fmt.format(asset.stats.triangles)
  byId('stat-ms').textContent = fmt.format(asset.stats.ms)
}

function rebuildSinglePart(partId: string) {
  cancelScheduledBuilds()
  if (!viewer) return
  const p = sceneSpec.parts.find(x => x.id === partId)
  if (!p || !sceneAsset || !p.enabled || !sceneAsset.partAssets.has(partId)) {
    rebuild(false)
    return
  }
  const started = performance.now()
  try {
    if (!sceneAsset.rebuildPart(p, textures, view, sceneSpec, partCustomTextures)) {
      rebuild(false)
      return
    }
    partBuildCount++
    updateSceneStatsUi(sceneAsset)
    updateOptStatus()
    updateGlobalLodUi()
    viewer.refreshShadows()
    syncEditorTransform()
    editor?.refresh()
    markJsonDirty()
    if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
    activityLog.info('scene', `AI 部件更新完成：${p.label}（场景共 ${fmt.format(sceneAsset.stats.triangles)} 面）`, {
      partId: p.id,
      label: p.label,
      triangles: sceneAsset.stats.triangles,
    })
  } catch (error) {
    console.error(error)
    message(error, true)
  }
  lastBuildMs = performance.now() - started
  lastBuildAt = performance.now()
}

function rebuild(reframe: boolean) {
  cancelScheduledBuilds()
  if (!viewer) return
  const started = performance.now()
  try {
    const hasParts = sceneSpec.parts.some(p => p.enabled)
    byId('ai-drop-empty').hidden = sceneSpec.parts.length > 0
    if (!hasParts) {
      sceneAsset?.dispose()
      sceneAsset = undefined
      const empty = new Group()
      empty.name = 'Blank AI Project'
      viewer.showModel(empty, 5.5, reframe)
      for (const k of ['parts', 'branches', 'leaves', 'triangles', 'ms']) byId('stat-' + k).textContent = '0'
      editor?.setEnabled(false)
      byId('edit-toggle').setAttribute('aria-pressed', 'false')
      byId('edit-group').hidden = true
      updateOptStatus()
      updateGlobalLodUi()
      markJsonDirty()
      if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
      return
    }

    const next = buildAiScene(sceneSpec, textures, partCustomTextures)
    next.display(view)
    const box = new Box3().setFromObject(next.group), size = box.getSize(new Vector3())
    const height = Math.max(.35, box.max.y * 1.04 + .08)
    const span = 2 * Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), size.x * .5) * 1.24
    const aspect = viewer.host.clientWidth / Math.max(1, viewer.host.clientHeight)
    if (reframe || !frameHeight) frameHeight = Math.max(height * 1.06, (span + height * .12) / Math.max(.56, aspect) / 1.14)
    viewer.showModel(next.group, frameHeight, false)
    if (reframe) viewer.frame(camera)
    sceneAsset?.dispose()
    sceneAsset = next
    fullBuildCount++

    updateSceneStatsUi(next)
    updateOptStatus()
    updateGlobalLodUi()
    viewer.refreshShadows()
    syncEditorTransform()
    editor?.refresh()
    markJsonDirty()
    if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
    activityLog.info('scene', `AI 场景构建完成：${sceneSpec.name}（${next.stats.parts} 部件 · ${fmt.format(next.stats.triangles)} 面 · ${next.stats.ms} ms）`, {
      name: sceneSpec.name,
      parts: next.stats.parts,
      triangles: next.stats.triangles,
      ms: next.stats.ms,
      loadedTextures: registry.loadedSlots(),
    })
  } catch (error) {
    console.error(error)
    message(error, true)
  }
  lastBuildMs = performance.now() - started
  lastBuildAt = performance.now()
}

const bridgeEl = byId<HTMLDetailsElement>('ai-bridge')
function syncJsonBox() {
  const ta = byId<HTMLTextAreaElement>('ai-json-text')
  if (document.activeElement !== ta) {
    ta.value = JSON.stringify(sceneSpec, null, 2)
    jsonDirty = false
  }
}
function markJsonDirty() {
  jsonDirty = true
  if (bridgeEl.open) syncJsonBox()
}
bridgeEl.addEventListener('toggle', () => {
  if (bridgeEl.open && jsonDirty) syncJsonBox()
})

// Inject whole-tree vs single-part LOD scope switcher directly into the LOD section (default: whole tree)
const optStatusEl = byId('opt-status')
const optScopeBar = document.createElement('div')
optScopeBar.className = 'ai-opt-scope'
optScopeBar.setAttribute('role', 'group')
optScopeBar.setAttribute('aria-label', '面数优化作用范围')
optScopeBar.innerHTML = `
  <button type="button" data-opt-scope="all" aria-pressed="true" title="同步优化整棵树全部部件（推荐）">整棵树（全部部件）</button>
  <button type="button" data-opt-scope="part" aria-pressed="false" title="仅微调当前选中的单个部件">仅当前部件</button>`
optStatusEl.parentElement?.insertBefore(optScopeBar, optStatusEl)

function setOptScope(next: 'all' | 'part') {
  optScope = next
  for (const b of optScopeBar.querySelectorAll<HTMLButtonElement>('[data-opt-scope]')) {
    b.setAttribute('aria-pressed', String(b.dataset.optScope === optScope))
  }
  updateOptStatus()
}
for (const b of optScopeBar.querySelectorAll<HTMLButtonElement>('[data-opt-scope]')) {
  b.onclick = () => setOptScope(b.dataset.optScope as 'all' | 'part')
}

function isOptActive(opt: TreeSpec['optimize']) {
  return opt.level > 0 || opt.woodDetail < 1 || opt.cullHiddenWood || opt.flatCards || opt.cardReduction > 0
}

function updateOptStatus() {
  const p = activePart()
  const el = byId('opt-status')
  if (!p) { el.textContent = '空白工程'; return }
  const totalTris = sceneAsset?.stats.triangles ?? 0
  const enabledCount = sceneSpec.parts.filter(x => x.enabled).length
  if (optScope === 'all') {
    const anyActive = sceneSpec.parts.some(x => x.enabled && isOptActive(x.spec.optimize))
    if (!anyActive) {
      el.textContent = `整棵树高模：${fmt.format(totalTris)} 三角面（${enabledCount} 部件，未减面）`
      el.classList.remove('is-active')
    } else {
      el.textContent = `整棵树已优化：${fmt.format(totalTris)} 三角面（共 ${enabledCount} 部件）`
      el.classList.add('is-active')
    }
    const levels = sceneSpec.parts.filter(x => x.enabled).map(x => x.spec.optimize.level)
    const uniform = levels.length > 0 && levels.every(lv => Math.abs(lv - levels[0]) < .03)
    const refLevel = uniform ? levels[0] : globalLodLevel
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) {
      btn.setAttribute('aria-pressed', String(uniform && Math.abs(Number(btn.dataset.lod) - refLevel) < .03))
    }
    return
  }
  const opt = p.spec.optimize
  const active = isOptActive(opt)
  const built = sceneAsset?.partAssets.get(p.id)
  const tris = built?.stats.triangles ?? 0
  if (!active) {
    el.textContent = `当前部件高模：${fmt.format(tris)} 面（整棵树 ${fmt.format(totalTris)} 面）`
    el.classList.remove('is-active')
  } else {
    el.textContent = `当前部件已优化：${fmt.format(tris)} 面（整棵树 ${fmt.format(totalTris)} 面）`
    el.classList.add('is-active')
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) {
    btn.setAttribute('aria-pressed', String(Math.abs(Number(btn.dataset.lod) - opt.level) < .03))
  }
}

// ---- Whole-Asset Sync (default) vs Single-Part Edit Mode -------------------
const editScope = (): EditScope => (editor?.enabled ? 'part' : 'whole')

function updateScopeUi() {
  const p = activePart()
  const single = editScope() === 'part'
  const banner = byId('ai-scope-banner')
  const titleEl = byId('ai-scope-title')
  const descEl = byId('ai-scope-desc')
  const btn = byId<HTMLButtonElement>('ai-scope-btn')
  const summary = byId('part-meta-summary')
  const singleMeta = byId('part-single-meta')
  const singlePose = byId('part-single-pose')
  const spineRow = byId('part-spine-row')

  banner.classList.toggle('is-single', single)
  singleMeta.hidden = !single
  singlePose.hidden = !single
  if (!p) return
  spineRow.hidden = !single || !(p.spec.trunk.spine && p.spec.trunk.spine.length >= 3)

  if (single) {
    titleEl.textContent = `✎ 单体 · ${p.label}`
    descEl.textContent = '当前仅修改此部件的颜色、材质、自定义贴图、位姿与参数；点击三维画布可切换其他单体。'
    btn.textContent = '🌐 回整体'
    btn.title = '退出编辑模式，恢复默认整体同步参数'
    summary.textContent = `当前单体 · 名称、材质、贴图与位姿`
  } else {
    const total = sceneSpec.parts.length
    const sameKindCount = sceneSpec.parts.filter(x => x.spec.kind === p.spec.kind).length
    const multiKinds = sameKindCount < total
    titleEl.textContent = multiKinds
      ? `🌐 整体同步 · ${kindNames[p.spec.kind]} (${sameKindCount}/${total})`
      : `🌐 整体同步（全部 ${total} 部件）`
    descEl.textContent = '默认颜色、材质、贴图、花朵、光影与参数同步到整体；开启「✎ 节点编辑」可单独微调某一部件。'
    btn.textContent = '✎ 单体编辑'
    btn.title = '开启编辑模式，进入单体独立调整'
    summary.textContent = '整体 · 贴图源、种子与缩放'
  }
}

byId('ai-scope-btn').onclick = () => {
  editUi?.setEnabled(editScope() === 'whole')
}

function remeshAiPartsOptimize(parts: AiPart[]): boolean {
  if (!viewer || !sceneAsset || !parts.length) return false
  const started = performance.now()
  for (const part of parts) {
    if (!part.enabled) continue
    const built = sceneAsset.partAssets.get(part.id)
    if (!built) return false
    const effSpec = part.leafTexture !== 'auto' && part.spec.kind === 'broadleaf'
      ? { ...part.spec, shading: { ...part.spec.shading, leafStyle: 'default' as const } }
      : part.spec
    if (!built.remeshForOptimize(effSpec)) return false
    built.display(view)
  }
  const st = sceneAsset.stats
  st.parts = 0
  st.branches = 0
  st.twigs = 0
  st.leaves = 0
  st.flowers = 0
  st.triangles = 0
  for (const built of sceneAsset.partAssets.values()) {
    st.parts++
    st.branches += built.stats.branches
    st.twigs += built.stats.twigs
    st.leaves += built.stats.leaves
    st.flowers += built.stats.flowers
    st.triangles += built.stats.triangles
  }
  st.ms = Math.round(performance.now() - started)
  sceneAsset.group.userData.aiScene = sceneSpec
  updateSceneStatsUi(sceneAsset)
  updateOptStatus()
  updateGlobalLodUi()
  viewer.refreshShadows()
  markJsonDirty()
  if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(false)
  return true
}

function applyInspectorParam(path: string, value: unknown, final: boolean) {
  const p = activePart()
  if (!p) return
  userDirty = true
  if (path === 'trunk.barkStyle' && registry.isCustom('bark')) {
    registry.resetDefault('bark')
  }
  const scope: EditScope = path.startsWith('optimize.')
    ? (optScope === 'all' ? 'whole' : 'part')
    : editScope()

  const { changedIds, needsPanelSync } = applySceneParam(sceneSpec, p.id, path, value, scope)
  if (!changedIds.length) return
  if (path === 'trunk.barkColor') {
    let liftedTint = false
    for (const id of changedIds) {
      const targetPart = sceneSpec.parts.find(x => x.id === id)
      const hasCustomBark = Boolean(registry.isCustom('bark') || (targetPart && partCustomTextures.get(targetPart.id)?.bark))
      if (targetPart && hasCustomBark && (targetPart.spec.trunk.barkTint ?? 0) < .8) {
        targetPart.spec = { ...targetPart.spec, trunk: { ...targetPart.spec.trunk, barkTint: .88 } }
        sceneAsset?.applyPartLiveParam(targetPart, 'trunk.barkTint', sceneSpec)
        liftedTint = true
      }
    }
    if (liftedTint) panel.sync()
  }
  if (path === 'optimize.level' && scope === 'whole') globalLodLevel = Number(value)
  if (needsPanelSync) {
    byId<HTMLSelectElement>('part-tex').value = p.leafTexture
    panel.sync()
  }
  if (path === 'optimize.targetTriangles') return

  const changedParts = changedIds
    .map(id => sceneSpec.parts.find(x => x.id === id))
    .filter((x): x is AiPart => Boolean(x && x.enabled))
  if (sceneAsset && changedParts.length > 0 && changedParts.every(part => sceneAsset!.applyPartLiveParam(part, path, sceneSpec))) {
    if (path === 'shading.softSelfShadow') viewer?.refreshShadows()
    markJsonDirty()
    return
  }
  if (sceneAsset && !pending && isOptimizeOnlyParam(path) && changedParts.length > 0 && remeshAiPartsOptimize(changedParts)) {
    return
  }
  if (sceneAsset && !pending && isWoodOnlyParam(path) && changedParts.length > 0 &&
    changedParts.every(part => (part.spec.kind === 'broadleaf' || part.spec.kind === 'conifer') && sceneAsset!.partAssets.has(part.id))) {
    scheduleWoodBuild(changedParts.map(part => part.id), final)
    return
  }
  if (changedIds.length === 1) scheduleBuild(final, changedIds[0])
  else scheduleBuild(final)
}

// ---- inspector & part list syncing -----------------------------------------
const panel = bindPanel(byId('panel'), () => activePart()?.spec ?? fallbackSpec, (path, value, final) => {
  if (!final) aiHistory.beginGesture(sceneSpec)
  else aiHistory.commitGesture(sceneSpec)
  applyInspectorParam(path, value, final)
})

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

function renderPartList() {
  const list = byId('ai-part-list')
  const cur = activePart()
  const single = editScope() === 'part'
  if (!sceneSpec.parts.length) {
    list.innerHTML = '<div class="ai-empty-note">暂无部件（拖入图片自动拆解，或手动添加）</div>'
  } else {
    list.innerHTML = sceneSpec.parts.map(p => {
      const id = escapeHtml(p.id)
      const label = escapeHtml(p.label)
      const kind = escapeHtml(p.spec.kind)
      const rowCls = single
        ? (p.id === selectedId ? 'is-selected' : '')
        : (cur && p.spec.kind === cur.spec.kind ? 'is-synced' : '')
      return `
      <div class="ai-part-item ${rowCls}" data-part="${id}">
        <input type="checkbox" data-toggle="${id}" ${p.enabled ? 'checked' : ''} title="显示/隐藏此部件">
        <span>${label}<small>${kind}</small></span>
        <button type="button" class="ai-edit-one" data-edit-one="${id}" title="进入编辑模式单独调整此部件">✎</button>
        <button type="button" class="ai-del" data-del="${id}" title="删除部件">✕</button>
      </div>`
    }).join('')
    for (const row of list.querySelectorAll<HTMLElement>('[data-part]')) {
      row.onclick = e => {
        if ((e.target as HTMLElement).closest('input, button')) return
        selectPart(row.dataset.part!)
      }
    }
    for (const editBtn of list.querySelectorAll<HTMLButtonElement>('[data-edit-one]')) {
      editBtn.onclick = () => {
        selectPart(editBtn.dataset.editOne!)
        if (!editor?.enabled) editUi?.setEnabled(true)
      }
    }
    for (const cb of list.querySelectorAll<HTMLInputElement>('[data-toggle]')) {
      cb.onchange = () => {
        const p = sceneSpec.parts.find(x => x.id === cb.dataset.toggle)
        if (p) {
          aiHistory.push(sceneSpec)
          userDirty = true
          p.enabled = cb.checked
          rebuild(false)
        }
      }
    }
    for (const del of list.querySelectorAll<HTMLButtonElement>('[data-del]')) {
      del.onclick = () => {
        const gone = del.dataset.del!
        aiHistory.push(sceneSpec)
        userDirty = true
        const customMap = partCustomTextures.get(gone)
        if (customMap) { for (const t of Object.values(customMap)) t?.dispose(); partCustomTextures.delete(gone); partCustomNames.delete(gone) }
        sceneSpec.parts = sceneSpec.parts.filter(x => x.id !== gone)
        if (selectedId === gone) selectedId = sceneSpec.parts[0]?.id
        refreshUi(false)
      }
    }
  }
  const p = activePart()
  byId('ai-global-lod').hidden = sceneSpec.parts.length === 0
  byId('ai-part-controls').hidden = !p
  byId('ai-inspector-empty').hidden = Boolean(p)
  if (p) {
    byId<HTMLInputElement>('part-label').value = p.label
    byId<HTMLSelectElement>('part-kind').value = p.spec.kind
    byId<HTMLSelectElement>('part-tex').value = p.leafTexture
    byId<HTMLInputElement>('seed').value = String(p.spec.seed)
    byId<HTMLInputElement>('part-px').value = String(p.position[0])
    byId<HTMLInputElement>('part-py').value = String(p.position[1])
    byId<HTMLInputElement>('part-pz').value = String(p.position[2])
    byId<HTMLInputElement>('part-ry').value = String(p.rotationY)
    byId<HTMLInputElement>('part-sc').value = String(p.scale)
    panel.sync()
  }
  updateScopeUi()
  texSlots?.syncThumbnails()
  updateGlobalLodUi()
}

function updateGlobalLodUi() {
  const out = byId('ai-global-lod-out')
  out.textContent = sceneAsset ? `总计 ${fmt.format(sceneAsset.stats.triangles)} 面` : ''
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-global-lod]')) {
    btn.setAttribute('aria-pressed', String(Math.abs(Number(btn.dataset.globalLod) - globalLodLevel) < .03))
  }
}

function applyGlobalLod(level: number) {
  if (!sceneSpec.parts.length) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const before = sceneAsset?.stats.triangles ?? 0
  globalLodLevel = level
  for (const part of sceneSpec.parts) {
    part.spec = { ...part.spec, optimize: optimizeAt(level, part.spec.optimize.targetTriangles) }
  }
  panel.sync()
  const enabledParts = sceneSpec.parts.filter(p => p.enabled)
  if (!remeshAiPartsOptimize(enabledParts)) rebuild(false)
  updateGlobalLodUi()
  const after = sceneAsset?.stats.triangles ?? 0
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0
  message(level <= 0
    ? `全场景已恢复高模（共 ${fmt.format(after)} 面）`
    : `全场景已优化至 ${fmt.format(after)} 面（${pct >= 0 ? '−' + pct : '+' + (-pct)}%）`)
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-global-lod]')) {
  btn.onclick = () => applyGlobalLod(Number(btn.dataset.globalLod))
}

function loadShowcaseById(id: string) {
  const entry = getAiShowcase(id) ?? aiShowcases[0]
  if (!entry) return
  sceneEpoch++
  cancelScheduledBuilds()
  clearAllPartCustomTextures()
  editor?.clearUndo()
  aiHistory.clear()
  userDirty = false
  sceneSpec = entry.build()
  const hasNativeBarkStyle = sceneSpec.parts.some(p => Boolean(p.spec.trunk.barkStyle && p.spec.trunk.barkStyle !== 'default'))
  if (!hasNativeBarkStyle && entry.barkTemplate === 'bark-painterly-driftwood') {
    registry.setCustom('bark', makePainterlyDriftwoodBarkTexture(512))
  } else if (!hasNativeBarkStyle && entry.barkTemplate === 'bark-painterly-moss') {
    registry.setCustom('bark', makePainterlyMossBarkTexture(512))
  } else {
    registry.resetDefault('bark')
  }
  selectedId = sceneSpec.parts[0]?.id
  globalLodLevel = 0
  lastReport = undefined
  lastImageDataUrl = undefined
  lastPixels = undefined
  lastCustomMask = undefined
  byId('ai-ref-hud').hidden = true
  byId('ai-ref-show').hidden = true
  editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined)
  editUi?.showSelectedHandle(undefined)
  presetLibrary?.setActiveShowcaseId(entry.id)
  setLightingMood(entry.lighting)
  texSlots?.drawSlot('bark', true)
  refreshUi(true)
  message(`已加载案例：${entry.name}（${sceneSpec.parts.length} 个可调部件）`)
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-quick-case]')) {
  btn.onclick = () => loadShowcaseById(btn.dataset.quickCase!)
}

function selectPart(id: string) {
  selectedId = id
  cachedAxis.key = ''
  if (editor) { editor.selectedId = undefined; editor.selectedBranchId = editor.enabled && editor.subMode === 'nodes' ? 0 : undefined; editUi?.showSelectedHandle(undefined) }
  renderPartList()
  syncEditorTransform()
  editor?.refresh()
  updateOptStatus()
}

function refreshUi(reframe: boolean) {
  byId('tree-title').textContent = sceneSpec.name || '空白植物工程'
  if (!selectedId || !sceneSpec.parts.some(p => p.id === selectedId)) selectedId = sceneSpec.parts[0]?.id
  cachedAxis.key = ''
  renderPartList()
  rebuild(reframe)
}

// ---- image upload & local CV generation ------------------------------------
function renderReportHud(dataUrl: string, name: string, report: AnalysisReport) {
  byId<HTMLImageElement>('ai-ref-img').src = dataUrl
  byId('ai-ref-name').textContent = name
  byId('ai-ref-summary').textContent = report.summary
  const sw: [string, string][] = [
    ['主色', report.palette.foliageOuter],
    ['暗部', report.palette.foliageInner],
    ['树皮', report.palette.bark],
  ]
  if (report.palette.accentFlower) sw.push(['花饰', report.palette.accentFlower])
  if (report.palette.groundTip) sw.push(['草底', report.palette.groundTip])
  byId('ai-swatches').innerHTML = sw.map(([l, c]) => `<span class="ai-swatch"><i style="background:${c}"></i>${l}</span>`).join('')
  byId('ai-ref-hud').hidden = false
  byId('ai-ref-show').hidden = true
}

function runAnalyzeOnPixels(pixels: PixelBuffer, name: string, dataUrl: string, customMask?: Uint8Array) {
  const { report, scene } = analyzePlantImage(
    pixels,
    name,
    customMask ? { customMask, customMaskWidth: pixels.width, customMaskHeight: pixels.height } : {},
  )
  sceneEpoch++
  cancelScheduledBuilds()
  clearAllPartCustomTextures()
  editor?.clearUndo()
  aiHistory.clear()
  userDirty = true
  lastReport = report
  lastImageDataUrl = dataUrl
  lastImageName = name
  lastPixels = pixels
  lastCustomMask = customMask
  globalLodLevel = 0
  sceneSpec = scene
  selectedId = scene.parts[0]?.id
  const mood: LightingPreset = report.foliageStyle === 'blossom' ? 'sakura' : report.kind === 'conifer' ? 'forest' : 'ghibli'
  presetLibrary?.setActiveId(undefined)
  setLightingMood(mood)
  renderReportHud(dataUrl, name, report)
  refreshUi(true)
  message(`${customMask ? '已按修补抠图重新生成' : '已根据图片生成'}：${report.summary}`)
  return { report, scene }
}

async function processImageDataUrl(dataUrl: string, name: string) {
  activityLog.action(`上传参考图进行 AI 识图：${name}`, { name }, 'scene')
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  const maxDim = 256
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height))
  canvas.width = Math.max(16, Math.round((img.naturalWidth || img.width) * scale))
  canvas.height = Math.max(16, Math.round((img.naturalHeight || img.height) * scale))
  const g = canvas.getContext('2d')!
  g.drawImage(img, 0, 0, canvas.width, canvas.height)
  const imageData = g.getImageData(0, 0, canvas.width, canvas.height)
  const pixels: PixelBuffer = { width: imageData.width, height: imageData.height, data: imageData.data }
  return runAnalyzeOnPixels(pixels, name, dataUrl)
}

// ---- interactive foreground/background scribble cutout modal ----------------
let maskBrush: 1 | 2 = 1
let maskStrokes: Uint8Array | undefined
let maskPreview: Uint8Array | undefined
let maskPainting = false
const maskCanvas = byId<HTMLCanvasElement>('ai-mask-canvas')
const maskCtx = maskCanvas.getContext('2d')!

function drawMaskCanvas() {
  if (!lastPixels) return
  const { width: W, height: H, data } = lastPixels
  if (maskCanvas.width !== W || maskCanvas.height !== H) { maskCanvas.width = W; maskCanvas.height = H }
  const out = maskCtx.createImageData(W, H)
  for (let i = 0; i < W * H; i++) {
    const o = i * 4
    let r = data[o], g = data[o + 1], b = data[o + 2]
    if (maskPreview && maskPreview[i] === 0) {
      // dim excluded background with subtle crimson wash
      r = r * .42 + 120; g = g * .35 + 24; b = b * .35 + 32
    }
    if (maskStrokes?.[i] === 1) { r = r * .35 + 34; g = g * .35 + 165; b = b * .35 + 62 }
    else if (maskStrokes?.[i] === 2) { r = r * .35 + 185; g = g * .35 + 36; b = b * .35 + 42 }
    out.data[o] = r; out.data[o + 1] = g; out.data[o + 2] = b; out.data[o + 3] = 255
  }
  maskCtx.putImageData(out, 0, 0)
}

let lastMaskPx: { x: number; y: number } | undefined
let maskImageKey = ''

function stampMaskCircle(cx: number, cy: number, rad: number, W: number, H: number) {
  if (!maskStrokes) return
  const r2 = rad * rad
  for (let y = Math.max(0, cy - rad); y <= Math.min(H - 1, cy + rad); y++) {
    for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) maskStrokes[y * W + x] = maskBrush
    }
  }
}

function paintMaskDot(clientX: number, clientY: number, isMove = false) {
  if (!lastPixels || !maskStrokes) return
  const rect = maskCanvas.getBoundingClientRect()
  const cx = Math.round((clientX - rect.left) / Math.max(1, rect.width) * lastPixels.width)
  const cy = Math.round((clientY - rect.top) / Math.max(1, rect.height) * lastPixels.height)
  const rad = Math.max(2, byId<HTMLInputElement>('ai-mask-size').valueAsNumber || 10)
  const { width: W, height: H } = lastPixels
  if (isMove && lastMaskPx) {
    const dx = cx - lastMaskPx.x, dy = cy - lastMaskPx.y
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, rad * 0.45)))
    for (let s = 1; s <= steps; s++) {
      stampMaskCircle(Math.round(lastMaskPx.x + dx * s / steps), Math.round(lastMaskPx.y + dy * s / steps), rad, W, H)
    }
  } else {
    stampMaskCircle(cx, cy, rad, W, H)
  }
  lastMaskPx = { x: cx, y: cy }
  drawMaskCanvas()
}

function openMaskModal() {
  if (!lastPixels) { message('请先上传一张参考图', true); return }
  const curKey = `${lastImageName || ''}|${lastPixels.width}x${lastPixels.height}`
  if (!maskStrokes || maskStrokes.length !== lastPixels.width * lastPixels.height || maskImageKey !== curKey) {
    maskStrokes = new Uint8Array(lastPixels.width * lastPixels.height)
    maskImageKey = curKey
  }
  maskPreview = lastCustomMask ? new Uint8Array(lastCustomMask) : maskPreview
  byId('ai-mask-modal').hidden = false
  drawMaskCanvas()
}
byId('ai-ref-mask').onclick = openMaskModal
byId('ai-mask-close').onclick = () => { byId('ai-mask-modal').hidden = true }
byId('ai-mask-cancel').onclick = () => { byId('ai-mask-modal').hidden = true }
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-brush]')) {
  btn.onclick = () => {
    maskBrush = Number(btn.dataset.brush) as 1 | 2
    document.querySelectorAll('[data-brush]').forEach(o => o.setAttribute('aria-pressed', String(o === btn)))
  }
}
byId('ai-mask-reset').onclick = () => {
  if (!lastPixels) return
  maskStrokes = new Uint8Array(lastPixels.width * lastPixels.height)
  maskPreview = undefined
  drawMaskCanvas()
}
maskCanvas.addEventListener('pointerdown', e => {
  maskPainting = true
  lastMaskPx = undefined
  maskCanvas.setPointerCapture(e.pointerId)
  paintMaskDot(e.clientX, e.clientY, false)
})
maskCanvas.addEventListener('pointermove', e => { if (maskPainting) paintMaskDot(e.clientX, e.clientY, true) })
maskCanvas.addEventListener('pointerup', () => {
  if (!maskPainting) return
  maskPainting = false
  lastMaskPx = undefined
  if (lastPixels && maskStrokes && maskStrokes.some(v => v === 1 || v === 2)) {
    maskPreview = computeScribbleMask(lastPixels, maskStrokes)
    drawMaskCanvas()
  }
})
maskCanvas.addEventListener('pointercancel', () => { maskPainting = false; lastMaskPx = undefined })
byId('ai-mask-apply').onclick = () => {
  if (!lastPixels || !lastImageDataUrl || !lastImageName) return
  if (maskStrokes && maskStrokes.some(v => v === 1 || v === 2)) {
    maskPreview = computeScribbleMask(lastPixels, maskStrokes)
  }
  byId('ai-mask-modal').hidden = true
  runAnalyzeOnPixels(lastPixels, lastImageName, lastImageDataUrl, maskPreview)
}

async function handleImageFile(file: File) {
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
  await processImageDataUrl(dataUrl, file.name)
}

const imageInput = byId<HTMLInputElement>('ai-image-file')
const openImagePicker = () => imageInput.click()
byId('ai-upload-top').onclick = openImagePicker
byId('ai-drop-btn').onclick = openImagePicker
byId('ai-ref-change').onclick = openImagePicker
imageInput.onchange = async () => {
  const f = imageInput.files?.[0]
  if (!f) return
  try { await handleImageFile(f) }
  catch (err) { message(err, true) }
  finally { imageInput.value = '' }
}

// Drag & drop anywhere on the 3D stage
const stageEl = byId('ai-stage')
let dragDepth = 0
stageEl.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; stageEl.classList.add('is-dragging') })
stageEl.addEventListener('dragover', e => { e.preventDefault() })
stageEl.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) stageEl.classList.remove('is-dragging') })
stageEl.addEventListener('drop', async e => {
  e.preventDefault()
  dragDepth = 0
  stageEl.classList.remove('is-dragging')
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    try { await handleImageFile(file) }
    catch (err) { message(err, true) }
  }
})

byId('ai-ref-hide').onclick = () => { byId('ai-ref-hud').hidden = true; byId('ai-ref-show').hidden = false }
byId('ai-ref-show').onclick = () => { byId('ai-ref-hud').hidden = false; byId('ai-ref-show').hidden = true }
byId('ai-clear').onclick = () => {
  sceneEpoch++
  cancelScheduledBuilds()
  clearAllPartCustomTextures()
  editor?.clearUndo()
  aiHistory.clear()
  userDirty = false
  sceneSpec = blankAiScene()
  selectedId = undefined
  lastReport = undefined
  lastImageDataUrl = undefined
  presetLibrary?.setActiveId(undefined)
  presetLibrary?.setActiveShowcaseId(undefined)
  byId('ai-ref-hud').hidden = true
  byId('ai-ref-show').hidden = true
  refreshUi(true)
  message('已清空为空白植物工程')
}

// ---- part CRUD & transform controls ----------------------------------------
function addNewPart(kind: TreeKind) {
  aiHistory.push(sceneSpec)
  userDirty = true
  const part = createAiPart(kind, `${kindNames[kind]} ${sceneSpec.parts.length + 1}`)
  sceneSpec.parts.push(part)
  selectedId = part.id
  refreshUi(sceneSpec.parts.length === 1)
}
byId('ai-add-part').onclick = () => addNewPart(byId<HTMLSelectElement>('ai-add-kind').value as TreeKind)
byId('ai-add-blank').onclick = () => addNewPart('broadleaf')

byId<HTMLInputElement>('part-label').oninput = e => {
  const p = activePart()
  if (!p) return
  aiHistory.beginGesture(sceneSpec)
  userDirty = true
  p.label = (e.target as HTMLInputElement).value
  sceneAsset?.updatePartTransform(p, sceneSpec)
  renderPartList()
  markJsonDirty()
}
byId<HTMLInputElement>('part-label').onchange = () => aiHistory.commitGesture()
byId<HTMLSelectElement>('part-kind').onchange = e => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const nextKind = (e.target as HTMLSelectElement).value as TreeKind
  const fresh = createAiPart(nextKind, p.label, p.spec.seed)
  p.spec = fresh.spec
  cachedAxis.key = ''
  renderPartList()
  rebuildSinglePart(p.id)
}
byId<HTMLSelectElement>('part-tex').onchange = e => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const src = (e.target as HTMLSelectElement).value as LeafTextureSource
  const ids = applySceneLeafTexture(sceneSpec, p.id, src, editScope())
  if (ids.length === 1) rebuildSinglePart(ids[0])
  else rebuild(false)
}
byId<HTMLInputElement>('seed').onchange = () => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const nextSeed = Math.max(0, Math.round(byId<HTMLInputElement>('seed').valueAsNumber || 0))
  const ids = applySceneSeed(sceneSpec, p.id, nextSeed, editScope())
  if (ids.length === 1) rebuildSinglePart(ids[0])
  else rebuild(false)
}
byId('reseed').onclick = () => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const nextSeed = Math.floor(Math.random() * 99999)
  byId<HTMLInputElement>('seed').value = String(nextSeed)
  const ids = applySceneSeed(sceneSpec, p.id, nextSeed, editScope())
  if (ids.length === 1) rebuildSinglePart(ids[0])
  else rebuild(false)
}
const bindNum = (id: string, apply: (p: AiPart, v: number) => void) => {
  const input = byId<HTMLInputElement>(id)
  input.oninput = e => {
    const p = activePart()
    const v = (e.target as HTMLInputElement).valueAsNumber
    if (!p || !Number.isFinite(v)) return
    aiHistory.beginGesture(sceneSpec)
    userDirty = true
    apply(p, v)
    if (sceneAsset?.updatePartTransform(p, sceneSpec)) {
      syncEditorTransform()
      editor?.refresh()
      viewer?.refreshShadows()
      markJsonDirty()
    } else if (p.enabled) {
      scheduleBuild(false, p.id)
    }
  }
  input.onchange = () => aiHistory.commitGesture()
}
bindNum('part-px', (p, v) => { p.position[0] = v })
bindNum('part-py', (p, v) => { p.position[1] = v })
bindNum('part-pz', (p, v) => { p.position[2] = v })
bindNum('part-ry', (p, v) => { p.rotationY = v })
byId<HTMLInputElement>('part-sc').oninput = e => {
  const p = activePart()
  const v = (e.target as HTMLInputElement).valueAsNumber
  if (!p || !Number.isFinite(v)) return
  aiHistory.beginGesture(sceneSpec)
  userDirty = true
  const ids = applySceneUniformScale(sceneSpec, p.id, v, editScope())
  let ok = true
  for (const id of ids) {
    const part = sceneSpec.parts.find(x => x.id === id)
    if (part && part.enabled && !sceneAsset?.updatePartTransform(part, sceneSpec)) ok = false
  }
  if (ok) {
    syncEditorTransform()
    editor?.refresh()
    viewer?.refreshShadows()
    markJsonDirty()
  } else {
    scheduleBuild(false)
  }
}
byId<HTMLInputElement>('part-sc').onchange = () => aiHistory.commitGesture()
byId('part-dup').onclick = () => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const clone: AiPart = JSON.parse(JSON.stringify(p))
  clone.id = 'part-' + Math.random().toString(36).slice(2, 8)
  clone.label = p.label + ' 副本'
  clone.position[0] = Number((clone.position[0] + .8).toFixed(2))
  clone.spec.seed += 17
  sceneSpec.parts.push(clone)
  selectedId = clone.id
  refreshUi(false)
}
byId('part-clear-spine').onclick = () => {
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const nextTrunk = { ...p.spec.trunk }
  delete nextTrunk.spine
  p.spec = { ...p.spec, trunk: nextTrunk }
  renderPartList()
  rebuildSinglePart(p.id)
  message('已切回参数化树干曲线（可自由调节弯曲与倾角）')
}

// ---- LOD buttons & budget solver (defaults to whole tree; optional single-part mode) ----
function solveGlobalLod(target?: number) {
  aiHistory.push(sceneSpec)
  userDirty = true
  const p = activePart()
  const goal = Math.max(200, Math.round(target ?? (byId<HTMLInputElement>('opt-target').valueAsNumber || p?.spec.optimize.targetTriangles || 3000)))
  const res = solveSceneForTriangleBudget(sceneSpec, textures, goal)
  globalLodLevel = res.optimize.level
  for (const part of sceneSpec.parts) {
    part.spec = { ...part.spec, optimize: { ...res.optimize, targetTriangles: goal } }
  }
  panel.sync()
  const enabledParts = sceneSpec.parts.filter(x => x.enabled)
  if (!remeshAiPartsOptimize(enabledParts)) rebuild(false)
  updateGlobalLodUi()
  const pct = res.before > 0 ? Math.round((1 - res.after / res.before) * 100) : 0
  const enabledCount = enabledParts.length
  message(res.reached
    ? `整棵树（${enabledCount} 部件）已优化至 ${fmt.format(res.after)} 面（原 ${fmt.format(res.before)} 面，−${pct}%）`
    : `整棵树（${enabledCount} 部件）已达极限低模 ${fmt.format(res.after)} 面（原 ${fmt.format(res.before)} 面，−${pct}%，目标 ${fmt.format(goal)} 面）`)
  return res
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) btn.onclick = () => {
  const level = Number(btn.dataset.lod)
  if (optScope === 'all') {
    applyGlobalLod(level)
    return
  }
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  p.spec = { ...p.spec, optimize: optimizeAt(level, p.spec.optimize.targetTriangles) }
  panel.sync()
  if (!remeshAiPartsOptimize([p])) rebuildSinglePart(p.id)
}
byId('opt-solve').onclick = () => {
  if (optScope === 'all') {
    solveGlobalLod()
    return
  }
  const p = activePart()
  if (!p) return
  aiHistory.push(sceneSpec)
  userDirty = true
  const goal = Math.max(200, Math.round(byId<HTMLInputElement>('opt-target').valueAsNumber || p.spec.optimize.targetTriangles || 3000))
  const res = solveForTriangleBudget(p.spec, textures, goal)
  p.spec = { ...p.spec, optimize: res.optimize }
  panel.sync()
  if (!remeshAiPartsOptimize([p])) rebuildSinglePart(p.id)
  const pct = res.before > 0 ? Math.round((1 - res.after / res.before) * 100) : 0
  message(`已优化当前部件至 ${fmt.format(res.after)} 面（原 ${fmt.format(res.before)} 面，−${pct}%）`)
}

// ---- view & camera ---------------------------------------------------------
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => {
  view = button.dataset.view as View
  sceneAsset?.display(view)
  viewer?.refreshShadows()
  document.querySelectorAll('[data-view]').forEach(o => o.setAttribute('aria-pressed', String(o === button)))
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) button.onclick = () => {
  camera = button.dataset.camera as Camera
  viewer?.frame(camera)
  document.querySelectorAll('[data-camera]').forEach(o => o.setAttribute('aria-pressed', String(o === button)))
}
byId<HTMLSelectElement>('lighting').onchange = e => {
  setLightingMood((e.target as HTMLSelectElement).value as LightingPreset)
}
const windBtn = byId<HTMLButtonElement>('wind-toggle')
windBtn.onclick = () => {
  const on = windBtn.getAttribute('aria-pressed') !== 'true'
  windBtn.setAttribute('aria-pressed', String(on))
  viewer?.setWind(on)
}

// ---- SpeedTree node & crown editing on selected part -----------------------
editUi = bindEditToolsUi({
  editor,
  getSpec: () => activePart()?.spec,
  canEnable: () => {
    if (activePart()) return true
    message('请先上传图片或添加一个部件')
    return false
  },
  onBeforeEnable: () => syncEditorTransform(),
  onEnabledChange: on => {
    setOptScope(on ? 'part' : 'all')
    renderPartList()
    if (on && activePart()) {
      message(`已进入单体编辑模式：当前选中「${activePart()!.label}」，可独立调色/换贴图/改参数`)
    } else if (!on && sceneSpec.parts.length > 0) {
      message('已切回整体同步模式：参数调节自动同步到全部部件')
    }
  },
  onHandlesChange: (handles, final) => {
    const p = activePart()
    if (!p) return
    userDirty = true
    p.spec = { ...p.spec, handles }
    scheduleBuild(final, p.id)
  },
  onResetHandles: () => {
    const p = activePart()
    if (!p) return
    aiHistory.push(sceneSpec)
    userDirty = true
    p.spec = { ...p.spec, handles: defaultHandles(new CrownEnvelope(p.spec, axisOf(p.spec))) }
    rebuildSinglePart(p.id)
  },
  onMessage: message,
})

// ---- textures (lazy registry + whole vs single-part custom texture slots) --
function activateCustomSlotOnPart(p: AiPart, kind: EditableTextureSlot): boolean {
  let changed = false
  if (kind === 'leaf' && p.spec.kind === 'broadleaf') {
    if (p.spec.shading.leafStyle !== 'default') {
      p.spec = { ...p.spec, shading: { ...p.spec.shading, leafStyle: 'default' } }
      changed = true
    }
    if (p.leafTexture !== 'auto' && p.leafTexture !== 'leaf') {
      p.leafTexture = 'leaf'
      changed = true
    }
  } else {
    const nativeMatch =
      (p.spec.kind === 'conifer' && (kind === 'needle' || kind === 'drape')) ||
      (p.spec.kind === 'palm' && kind === 'palm') ||
      (p.spec.kind === 'bamboo' && kind === 'bamboo') ||
      (p.spec.kind === 'lotus' && (kind === 'lotusLeaf' || kind === 'lotusPetal')) ||
      (p.spec.kind === 'grass' && kind === 'grass') ||
      (p.spec.kind === 'fern' && kind === 'fern') ||
      (p.spec.kind === 'flowerbed' && kind === 'blossom')
    if (nativeMatch && p.leafTexture !== 'auto' && p.leafTexture !== kind) {
      p.leafTexture = 'auto'
      changed = true
    }
    if (kind === 'grass' && p.spec.kind === 'grass' && p.spec.ground.mode !== 'card') {
      p.spec = { ...p.spec, ground: { ...p.spec.ground, mode: 'card' } }
      changed = true
    }
  }
  return changed
}

function ensureCustomTextureActive(kind: EditableTextureSlot) {
  const lead = activePart()
  if (!lead) return
  const targets = editScope() === 'part' ? [lead] : sceneSpec.parts
  let anyChanged = false
  for (const part of targets) {
    if (activateCustomSlotOnPart(part, kind)) anyChanged = true
  }
  if (anyChanged) {
    byId<HTMLSelectElement>('part-tex').value = lead.leafTexture
    panel.sync()
  }
}

const texSlots = bindTextureSlots(registry, {
  onBeforeUseCustom: slot => {
    ensureCustomTextureActive(slot)
    if (slot === 'leaf') {
      const targets = editScope() === 'whole' ? sceneSpec.parts : (activePart() ? [activePart()!] : [])
      let atlasChanged = false
      for (const p of targets) {
        if (p.spec.kind === 'broadleaf' && (p.spec.leaves.atlasCols !== 1 || p.spec.leaves.atlasRows !== 1 || p.spec.leaves.atlasRegions?.length)) {
          p.spec = { ...p.spec, leaves: { ...p.spec.leaves, atlasCols: 1, atlasRows: 1, atlasRegions: undefined } }
          atlasChanged = true
        }
      }
      if (atlasChanged) panel.sync()
    } else if (slot === 'bark') {
      const targets = editScope() === 'whole' ? sceneSpec.parts : (activePart() ? [activePart()!] : [])
      let barkChanged = false
      for (const p of targets) {
        if (p.spec.trunk.barkStyle && p.spec.trunk.barkStyle !== 'default') {
          const nextTrunk = { ...p.spec.trunk }
          delete nextTrunk.barkStyle
          p.spec = { ...p.spec, trunk: nextTrunk }
          barkChanged = true
        }
      }
      if (barkChanged) panel.sync()
    }
  },
  onOpenEditor: slot => openAiEditorForSlot(slot),
  onOpenLibrary: slot => textureLibrary.open(undefined, defaultCategoryForSlot(slot)),
  onCustomTexture: (slot, texture, filename) => {
    if (editScope() === 'whole') {
      // Whole-asset mode: clear any old per-part override on this slot so global registry applies uniformly
      clearAllPartCustomTextures(slot)
      return false
    }
    const p = activePart()
    if (!p) return false
    const map = partCustomTextures.get(p.id) ?? {}
    if (map[slot] && map[slot] !== texture) map[slot]!.dispose()
    map[slot] = texture
    partCustomTextures.set(p.id, map)
    const names = partCustomNames.get(p.id) ?? {}
    names[slot] = filename
    partCustomNames.set(p.id, names)
    return true
  },
  onResetTexture: slot => {
    if (slot === 'leaf') {
      const targets = editScope() === 'whole' ? sceneSpec.parts : (activePart() ? [activePart()!] : [])
      for (const p of targets) {
        if (p.spec.kind === 'broadleaf' && p.spec.leaves.atlasRegions?.length) {
          p.spec = { ...p.spec, leaves: { ...p.spec.leaves, atlasRegions: undefined } }
        }
      }
    }
    if (editScope() === 'whole') {
      clearAllPartCustomTextures(slot)
      return false
    }
    const p = activePart()
    if (!p) return false
    const map = partCustomTextures.get(p.id)
    if (map?.[slot]) {
      map[slot]!.dispose()
      delete map[slot]
      const names = partCustomNames.get(p.id)
      if (names) delete names[slot]
      return true
    }
    return false
  },
  resolveSlot: slot => {
    if (editScope() !== 'part') return undefined
    const p = activePart()
    const customTex = p ? partCustomTextures.get(p.id)?.[slot] : undefined
    if (!customTex) return undefined
    const fname = partCustomNames.get(p!.id)?.[slot] || customTex.name || '自定义贴图'
    return { texture: customTex, label: `单体贴图：${fname}` }
  },
  onChange: () => {
    userDirty = true
    const p = activePart()
    if (editScope() === 'part' && p) rebuildSinglePart(p.id)
    else rebuild(false)
  },
  onMessage: message,
})

// ---- AI Schema / JSON / Optional Vision LLM Bridge -------------------------
byId('ai-copy-schema').onclick = async () => {
  const txt = JSON.stringify(aiCapabilitySchema(), null, 2)
  try { await navigator.clipboard.writeText(txt); message('已复制全部参数能力 Schema JSON') }
  catch { byId<HTMLTextAreaElement>('ai-json-text').value = txt; message('已将能力 Schema 填入文本框') }
}
byId('ai-copy-json').onclick = async () => {
  const txt = JSON.stringify(sceneSpec, null, 2)
  try { await navigator.clipboard.writeText(txt); message('已复制当前工程 JSON') }
  catch { message('请直接从文本框复制') }
}
byId('ai-apply-json').onclick = () => {
  try {
    const parsed = parseAiScene(JSON.parse(byId<HTMLTextAreaElement>('ai-json-text').value))
    sceneEpoch++
    cancelScheduledBuilds()
    clearAllPartCustomTextures()
    editor?.clearUndo()
    aiHistory.clear()
    userDirty = true
    sceneSpec = parsed
    selectedId = sceneSpec.parts[0]?.id
    presetLibrary?.setActiveId(undefined)
    refreshUi(true)
    message(`已应用 JSON（共 ${sceneSpec.parts.length} 个部件）`)
  } catch (err) { message(err, true) }
}
let llmAbort: AbortController | undefined
async function compressImageForLlm(dataUrl: string, maxDim = 1024): Promise<string> {
  try {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    if (Math.max(img.naturalWidth, img.naturalHeight) <= maxDim && dataUrl.length < 400_000) return dataUrl
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.naturalWidth * scale))
    c.height = Math.max(1, Math.round(img.naturalHeight * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.86)
  } catch {
    return dataUrl
  }
}

byId('ai-llm-run').onclick = async () => {
  const url = byId<HTMLInputElement>('ai-llm-url').value.trim()
  const model = byId<HTMLInputElement>('ai-llm-model').value.trim() || 'gpt-4o'
  const key = byId<HTMLInputElement>('ai-llm-key').value.trim()
  if (!lastImageDataUrl) { message('请先上传一张参考图', true); return }
  if (!url || !key) { message('请填写 API Endpoint 与 API Key（留空则已使用本地图像算法）', true); return }
  const btn = byId<HTMLButtonElement>('ai-llm-run')
  llmAbort?.abort()
  const ctrl = new AbortController()
  llmAbort = ctrl
  const timeout = setTimeout(() => ctrl.abort(), 60000)
  btn.disabled = true
  try {
    const uploadUrl = await compressImageForLlm(lastImageDataUrl)
    const prompt = 'You are a 3D procedural plant designer. Given this image and the following Vegetation Studio capability schema, return ONLY a valid JSON object matching AiSceneSpec (schemaVersion: 1) with accurate multi-part composition, trunk lean/wobble/barkColor, crown handles, leafTexture, and colors.\nSchema:\n' +
      JSON.stringify(aiCapabilitySchema())
    const resp = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: uploadUrl } },
          ],
        }],
      }),
    })
    if (!resp.ok) throw new Error(`API 请求失败 (${resp.status})`)
    const json = await resp.json() as { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] }
    const rawContent = json.choices?.[0]?.message?.content
    const content = Array.isArray(rawContent)
      ? rawContent.map(c => (typeof c === 'string' ? c : c?.text ?? '')).join('')
      : rawContent
    if (!content) throw new Error('模型未返回有效内容')
    if (ctrl.signal.aborted) return
    const cleaned = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
    const parsed = parseAiScene(JSON.parse(cleaned))
    sceneEpoch++
    cancelScheduledBuilds()
    clearAllPartCustomTextures()
    editor?.clearUndo()
    aiHistory.clear()
    userDirty = true
    sceneSpec = parsed
    selectedId = sceneSpec.parts[0]?.id
    refreshUi(true)
    message('视觉大模型生成完成！')
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') message('视觉大模型请求超时或已取消', true)
    else message(err, true)
  } finally {
    clearTimeout(timeout)
    if (llmAbort === ctrl) llmAbort = undefined
    btn.disabled = false
  }
}

// ---- file actions ----------------------------------------------------------
const fileInput = byId<HTMLInputElement>('file')
byId('import').onclick = () => fileInput.click()
fileInput.onchange = async () => {
  const selected = fileInput.files?.[0]
  if (!selected) return
  try {
    const parsed = parseAiScene(JSON.parse(await selected.text()))
    sceneEpoch++
    cancelScheduledBuilds()
    clearAllPartCustomTextures()
    editor?.clearUndo()
    aiHistory.clear()
    userDirty = false
    sceneSpec = parsed
    selectedId = sceneSpec.parts[0]?.id
    presetLibrary?.setActiveId(undefined)
    refreshUi(true)
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
window.addEventListener('beforeunload', ev => {
  if (userDirty && sceneSpec.parts.length > 0) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})
window.addEventListener('keydown', ev => {
  if (ev.defaultPrevented) return
  const target = ev.target as HTMLElement | null
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)))) return
  if (textureEditor.isOpen() || textureLibrary.isOpen() || presetLibrary.isOpen() || activityLogDrawer.isOpen() || !byId('ai-mask-modal').hidden) return
  if (!(ev.ctrlKey || ev.metaKey)) return
  const k = ev.key.toLowerCase()
  if (k === 'z' && !ev.shiftKey) {
    if (editor?.enabled && editor.canUndo()) return
    const prev = aiHistory.undo(sceneSpec)
    if (prev) {
      ev.preventDefault()
      userDirty = true
      sceneSpec = prev
      selectedId = sceneSpec.parts.some(p => p.id === selectedId) ? selectedId : sceneSpec.parts[0]?.id
      refreshUi(false)
      message('已撤销场景修改')
    }
  } else if (k === 'y' || (k === 'z' && ev.shiftKey)) {
    const next = aiHistory.redo(sceneSpec)
    if (next) {
      ev.preventDefault()
      userDirty = true
      sceneSpec = next
      selectedId = sceneSpec.parts.some(p => p.id === selectedId) ? selectedId : sceneSpec.parts[0]?.id
      refreshUi(false)
      message('已重做场景修改')
    }
  }
})
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
function captureAiPng(transparent = false): string {
  if (!viewer) return ''
  const wasVisible = editor?.group.visible
  if (editor) editor.group.visible = false
  try {
    return viewer.snapshot({ transparent })
  } finally {
    if (editor) editor.group.visible = Boolean(wasVisible)
  }
}
const fileName = () => (sceneSpec.name || 'ai-plant').replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
byId('json').onclick = () => {
  userDirty = false
  save(new Blob([JSON.stringify(sceneSpec, null, 2)], { type: 'application/json' }), fileName() + '.json')
}
byId('png').onclick = () => {
  const dataUrl = captureAiPng(false)
  if (!dataUrl) return
  const fname = fileName() + '-' + view + '-' + camera + '.png'
  fetch(dataUrl).then(r => r.blob()).then(b => save(b, fname)).catch(() => download(dataUrl, fname))
}
byId('png-alpha').onclick = () => {
  const dataUrl = captureAiPng(true)
  if (!dataUrl) return
  const fname = `${fileName()}_transparent.png`
  activityLog.exportStep(`导出透明背景 PNG：${fname}`, { filename: fname, view, camera })
  fetch(dataUrl).then(r => r.blob()).then(b => save(b, fname)).catch(() => download(dataUrl, fname))
}
const glb = byId<HTMLButtonElement>('glb')
bindGlbExportPopover({
  triggerButton: glb,
  getRoot: () => sceneAsset?.group,
  exportBlob: opts => sceneAsset!.exportGlb(opts),
  exportLodGlb: async (lodLevel, opts) => {
    const preset = lodPresets[lodLevel] ?? lodPresets[0]
    const rootGroup = new Group()
    rootGroup.name = 'Vegetation Studio AI / ' + sceneSpec.name
    const disposables: { dispose(): void }[] = []
    try {
      for (const part of sceneSpec.parts) {
        if (!part.enabled) continue
        const baseSpec = part.leafTexture !== 'auto' && part.spec.kind === 'broadleaf'
          ? { ...part.spec, shading: { ...part.spec.shading, leafStyle: 'default' as const } }
          : part.spec
        const lodSpec: TreeSpec = {
          ...baseSpec,
          optimize: optimizeAt(preset.level, part.spec.optimize.targetTriangles),
        }
        const existing = sceneAsset?.partAssets.get(part.id)
        if (existing) {
          const clone = existing.buildLodClone(lodSpec)
          disposables.push(clone)
          clone.group.name = part.label || part.id
          clone.group.position.set(part.position[0], part.position[1], part.position[2])
          clone.group.rotation.y = MathUtils.degToRad(part.rotationY)
          clone.group.scale.setScalar(Math.max(.05, part.scale))
          rootGroup.add(clone.group)
        } else {
          const built = buildAiScene({ ...sceneSpec, parts: [{ ...part, spec: lodSpec }] }, textures, partCustomTextures)
          disposables.push(built)
          rootGroup.add(built.group)
        }
      }
      return await exportGlb(rootGroup, opts)
    } finally {
      for (const d of disposables) d.dispose()
    }
  },
  getFilename: opts => `${fileName()}${opts.mode === 'merged' ? '-merged' : ''}.glb`,
  saveBlob: save,
  message,
  emptyMessage: '当前为空白工程，请先上传图片或添加部件',
})

// ---- saved preset library (real-time 3D preview & local persistence) -------
const presetStore = createPresetStore()

function syncPresetBadge() {
  byId('preset-lib-count').textContent = String(presetStore.list<AiSceneSpec>('ai').length)
}

const presetLibrary = mountPresetLibrary<
  AiSceneSpec,
  { sceneSpec: AiSceneSpec; selectedId?: string; lighting: LightingPreset; globalLodLevel: number; frameHeight: number }
>({
  scope: 'ai',
  store: presetStore,
  showcases: aiShowcases,
  getHiddenShowcaseIds: () => hiddenShowcaseStore.hiddenIds(),
  deleteShowcase: async sc => { await hiddenShowcaseStore.hide(sc.id) },
  restoreShowcases: async () => { await hiddenShowcaseStore.restoreAll() },
  applyShowcase: sc => loadShowcaseById(sc.id),
  capture: () => {
    const enabled = sceneSpec.parts.filter(p => p.enabled)
    const canSave = enabled.length > 0
    const singleKind = enabled.length === 1 ? enabled[0].spec.kind : 'multi'
    return {
      defaultName: sceneSpec.name && sceneSpec.name !== '空白植物工程'
        ? sceneSpec.name
        : (enabled.length === 1 ? enabled[0].label : `AI 组合植物 (${enabled.length} 部件)`),
      kind: singleKind,
      kindLabel: singleKind === 'multi' ? `${enabled.length} 部件场景` : kindNames[singleKind],
      triangles: sceneAsset?.stats.triangles ?? 0,
      lighting,
      thumbnail: canSave ? captureViewportThumbnail(viewer, [editor?.group]) : '',
      payload: sceneSpec,
      canSave,
      emptyReason: '当前为空白工程，请先上传图片、加载案例或添加部件',
    }
  },
  snapshotState: () => ({
    sceneSpec: deepClone(sceneSpec),
    selectedId,
    lighting,
    globalLodLevel,
    frameHeight,
  }),
  restoreState: snap => {
    const wasEmpty = !sceneSpec.parts.some(p => p.enabled)
    const willBeEmpty = !snap.sceneSpec.parts.some(p => p.enabled)
    sceneSpec = snap.sceneSpec
    selectedId = snap.selectedId
    globalLodLevel = snap.globalLodLevel
    const needReframe = wasEmpty !== willBeEmpty || Math.abs(frameHeight - snap.frameHeight) / Math.max(.5, snap.frameHeight) > .25
    setLightingMood(snap.lighting)
    refreshUi(needReframe)
  },
  preview: preset => {
    const wasEmpty = !sceneSpec.parts.some(p => p.enabled)
    sceneSpec = deepClone(preset.payload)
    selectedId = sceneSpec.parts[0]?.id
    setLightingMood(preset.lighting)
    refreshUi(wasEmpty || sceneSpec.parts.length !== 1)
  },
  apply: preset => {
    sceneEpoch++
    cancelScheduledBuilds()
    clearAllPartCustomTextures()
    editor?.clearUndo()
    aiHistory.clear()
    userDirty = false
    sceneSpec = deepClone(preset.payload)
    selectedId = sceneSpec.parts[0]?.id
    globalLodLevel = 0
    editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined)
    editUi?.showSelectedHandle(undefined)
    setLightingMood(preset.lighting)
    refreshUi(true)
  },
  onActiveChange: id => {
    if (id) userDirty = false
  },
  message,
})

function syncShowcaseUi() {
  const vis = visibleShowcases()
  byId('ai-showcase-top-count').textContent = String(vis.length)
  byId('ai-showcase-btn').textContent = `✿ 浏览案例库（${vis.length}）`
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-quick-case]')) {
    btn.hidden = hiddenShowcaseStore.isHidden(btn.dataset.quickCase!)
  }
  presetLibrary.refreshShowcases()
}

presetStore.subscribe(syncPresetBadge)
void presetStore.ready().then(syncPresetBadge)
syncPresetBadge()
hiddenShowcaseStore.subscribe(syncShowcaseUi)
void hiddenShowcaseStore.ready().then(syncShowcaseUi)
syncShowcaseUi()

// ---- Substance-style Procedural Texture Editor & Real-Time Texture Library -
interface AiSlotSnapshot {
  slot: EditableTextureSlot
  scope: EditScope
  partId?: string
  prevGlobal: Texture | undefined
  prevPartTex: Texture | undefined
  prevPartName: string | undefined
  partStates: {
    id: string
    leafTexture: LeafTextureSource
    leafStyle: TreeSpec['shading']['leafStyle']
    atlasCols: number
    atlasRows: number
    atlasRegions: TreeSpec['leaves']['atlasRegions']
    flowersEnabled: boolean
    flowersStyle: TreeSpec['flowers']['style']
    groundMode: TreeSpec['ground']['mode']
  }[]
}

const textureStore = createTextureLibraryStore({ lazy: true })
let aiHoverPreviewTex: Texture | undefined
let aiHoverStashedTex: Texture | undefined

function activateFlowerSlotIfNeeded(slot: EditableTextureSlot) {
  if (slot !== 'flower') return
  const lead = activePart()
  if (!lead) return
  const targets = editScope() === 'part' ? [lead] : sceneSpec.parts
  let changed = false
  for (const part of targets) {
    if (part.spec.kind === 'broadleaf' || part.spec.kind === 'conifer' || part.spec.kind === 'palm') {
      if (!part.spec.flowers.enabled || part.spec.flowers.style !== 'default') {
        part.spec = { ...part.spec, flowers: { ...part.spec.flowers, enabled: true, style: 'default' } }
        changed = true
      }
    }
  }
  if (changed) panel.sync()
}

function applyAiProceduralTexture(
  slot: EditableTextureSlot,
  texture: Texture,
  label: string,
  isPreview = false,
  meta?: AppliedTextureMeta,
) {
  texture.name = label
  const scope = editScope()
  const lead = activePart()
  if (!isPreview) attachTextureGraphSource(texture, meta)

  if (isPreview) {
    const prevPreview = aiHoverPreviewTex
    aiHoverPreviewTex = texture
    if (scope === 'part' && lead) {
      const map = partCustomTextures.get(lead.id) ?? {}
      map[slot] = texture
      partCustomTextures.set(lead.id, map)
      const names = partCustomNames.get(lead.id) ?? {}
      names[slot] = label
      partCustomNames.set(lead.id, names)
    } else {
      registry.setCustom(slot, texture, false)
    }
    if (prevPreview && prevPreview !== texture && prevPreview !== aiHoverStashedTex) prevPreview.dispose()
  } else {
    userDirty = true
    const oldStashed = aiHoverStashedTex
    aiHoverStashedTex = undefined
    const prevPreview = aiHoverPreviewTex
    aiHoverPreviewTex = undefined
    if (scope === 'part' && lead) {
      const map = partCustomTextures.get(lead.id) ?? {}
      if (map[slot] && map[slot] !== texture && map[slot] !== oldStashed) map[slot]!.dispose()
      map[slot] = texture
      partCustomTextures.set(lead.id, map)
      const names = partCustomNames.get(lead.id) ?? {}
      names[slot] = label
      partCustomNames.set(lead.id, names)
    } else {
      clearAllPartCustomTextures(slot)
      registry.setCustom(slot, texture, true)
    }
    if (prevPreview && prevPreview !== texture) prevPreview.dispose()
    if (oldStashed && oldStashed !== texture) oldStashed.dispose()
  }

  ensureCustomTextureActive(slot)
  if (slot === 'bark' && !isPreview) {
    const targets = scope === 'part' && lead ? [lead] : sceneSpec.parts
    let barkChanged = false
    for (const part of targets) {
      if (part.spec.trunk.barkStyle && part.spec.trunk.barkStyle !== 'default') {
        const nextTrunk = { ...part.spec.trunk }
        delete nextTrunk.barkStyle
        part.spec = { ...part.spec, trunk: nextTrunk }
        barkChanged = true
      }
    }
    if (barkChanged) panel.sync()
  }
  if (slot === 'leaf') {
    const targets = scope === 'part' && lead ? [lead] : sceneSpec.parts.filter(p => p.spec.kind === 'broadleaf')
    let atlasChanged = false
    const nextRegions = meta?.atlasRegions?.length ? meta.atlasRegions : undefined
    for (const part of targets) {
      if (part.spec.kind !== 'broadleaf') continue
      const nextCols = nextRegions ? 1 : (meta?.atlasCols ?? 1)
      const nextRows = nextRegions ? 1 : (meta?.atlasRows ?? 1)
      const regDiff = JSON.stringify(part.spec.leaves.atlasRegions ?? null) !== JSON.stringify(nextRegions ?? null)
      if (part.spec.leaves.atlasCols !== nextCols || part.spec.leaves.atlasRows !== nextRows || regDiff) {
        part.spec = {
          ...part.spec,
          leaves: { ...part.spec.leaves, atlasCols: nextCols, atlasRows: nextRows, atlasRegions: nextRegions },
        }
        atlasChanged = true
      }
    }
    if (atlasChanged) panel.sync()
  }
  activateFlowerSlotIfNeeded(slot)
  texSlots.drawSlot(slot, true)
  if (scope === 'part' && lead) rebuildSinglePart(lead.id)
  else if (sceneSpec.parts.length > 0) rebuild(false)
}

const textureEditor = mountTextureEditor({
  store: textureStore,
  applyTexture: (slot, tex, label, meta) => applyAiProceduralTexture(slot, tex, label, false, meta),
  onOpen: () => {
    presetLibrary.close()
    textureLibrary.close()
  },
  message,
})

const textureLibrary = mountTextureLibrary<AiSlotSnapshot>({
  store: textureStore,
  snapshotSlot: slot => {
    const scope = editScope()
    const lead = activePart()
    const prevGlobal = registry.getCustom(slot)
    const prevPartTex = lead ? partCustomTextures.get(lead.id)?.[slot] : undefined
    const prevPartName = lead ? partCustomNames.get(lead.id)?.[slot] : undefined
    aiHoverStashedTex = scope === 'part' ? prevPartTex : prevGlobal
    return {
      slot,
      scope,
      partId: lead?.id,
      prevGlobal,
      prevPartTex,
      prevPartName,
      partStates: sceneSpec.parts.map(p => ({
        id: p.id,
        leafTexture: p.leafTexture,
        leafStyle: p.spec.shading.leafStyle,
        atlasCols: p.spec.leaves.atlasCols,
        atlasRows: p.spec.leaves.atlasRows,
        atlasRegions: p.spec.leaves.atlasRegions,
        flowersEnabled: p.spec.flowers.enabled,
        flowersStyle: p.spec.flowers.style,
        groundMode: p.spec.ground.mode,
      })),
    }
  },
  restoreSlot: snap => {
    const curPreview = aiHoverPreviewTex
    aiHoverPreviewTex = undefined
    aiHoverStashedTex = undefined
    if (snap.scope === 'part' && snap.partId) {
      const map = partCustomTextures.get(snap.partId)
      const names = partCustomNames.get(snap.partId)
      if (snap.prevPartTex) {
        if (map) map[snap.slot] = snap.prevPartTex
        if (names && snap.prevPartName) names[snap.slot] = snap.prevPartName
      } else {
        if (map) delete map[snap.slot]
        if (names) delete names[snap.slot]
      }
      if (curPreview && curPreview !== snap.prevPartTex) curPreview.dispose()
    } else {
      if (snap.prevGlobal) registry.setCustom(snap.slot, snap.prevGlobal, false)
      else registry.resetDefault(snap.slot, false)
      if (curPreview && curPreview !== snap.prevGlobal) curPreview.dispose()
    }
    for (const st of snap.partStates) {
      const p = sceneSpec.parts.find(x => x.id === st.id)
      if (!p) continue
      p.leafTexture = st.leafTexture
      p.spec = {
        ...p.spec,
        shading: { ...p.spec.shading, leafStyle: st.leafStyle },
        leaves: { ...p.spec.leaves, atlasCols: st.atlasCols, atlasRows: st.atlasRows, atlasRegions: st.atlasRegions },
        flowers: { ...p.spec.flowers, enabled: st.flowersEnabled, style: st.flowersStyle },
        ground: { ...p.spec.ground, mode: st.groundMode },
      }
    }
    const lead = activePart()
    if (lead) byId<HTMLSelectElement>('part-tex').value = lead.leafTexture
    panel.sync()
    texSlots.drawSlot(snap.slot, true)
    if (snap.scope === 'part' && snap.partId) rebuildSinglePart(snap.partId)
    else if (sceneSpec.parts.length > 0) rebuild(false)
  },
  applyTexture: (slot, tex, label, isPreview, meta) => applyAiProceduralTexture(slot, tex, label, isPreview, meta),
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

function openAiEditorForSlot(slot: EditableTextureSlot) {
  const openNow = () => {
    const lead = activePart()
    const activeTex = (editScope() === 'part' && lead ? partCustomTextures.get(lead.id)?.[slot] : undefined)
      ?? registry.getCustom(slot)
    textureEditor.open(resolveSlotEditorOptions(slot, activeTex, textureStore, lead?.spec))
  }
  if (!textureStore.isLoaded) {
    void textureStore.ensureLoaded().finally(openNow)
  } else {
    openNow()
  }
}

byId('tex-editor').onclick = () => {
  activityLogDrawer.close()
  const lead = activePart()
  const defaultSlot: EditableTextureSlot = lead?.spec.kind === 'conifer' ? 'needle'
    : lead?.spec.kind === 'palm' ? 'palm'
      : lead?.spec.kind === 'bamboo' ? 'bamboo'
        : lead?.spec.kind === 'lotus' ? 'lotusLeaf'
          : lead?.spec.kind === 'flowerbed' ? 'blossom'
            : lead?.spec.kind === 'grass' ? 'grass'
              : lead?.spec.kind === 'fern' ? 'fern' : 'leaf'
  openAiEditorForSlot(defaultSlot)
}
byId('tex-lib').onclick = () => { activityLogDrawer.close(); textureLibrary.toggle() }

byId('preset-save').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.open(true, 'mine') }
byId('preset-lib').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.toggle('mine') }
byId('ai-open-presets').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.open(false, 'mine') }
byId('ai-showcase-top').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.toggle('showcases') }
byId('ai-showcase-btn').onclick = () => { activityLogDrawer.close(); textureLibrary.close(); textureEditor.close(); presetLibrary.open(false, 'showcases') }

// Initialize blank project cleanly (or optional ?showcase=<id> direct link)
const initialShowcase = new URL(location.href).searchParams.get('showcase')
if (initialShowcase && getAiShowcase(initialShowcase)) loadShowcaseById(initialShowcase)
else refreshUi(true)

// Expose complete AI Studio API for external agents & automated browser tests
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
  __aiStudio: {
    get scene() { return sceneSpec },
    get report() { return lastReport },
    get stats() { return sceneAsset ? { ...sceneAsset.stats } : { parts: 0, branches: 0, twigs: 0, leaves: 0, flowers: 0, triangles: 0, ms: 0 } },
    get fullBuilds() { return fullBuildCount },
    get partBuilds() { return partBuildCount },
    get woodBuilds() { return woodBuildCount },
    loadedTextures: () => registry.loadedSlots(),
    showcases: () => visibleShowcases().map(s => ({ id: s.id, name: s.name, tag: s.tag, subtitle: s.subtitle })),
    presets: {
      store: presetStore,
      showcaseStore: hiddenShowcaseStore,
      open: (focus?: boolean) => presetLibrary.open(focus, 'mine'),
      openShowcases: () => presetLibrary.open(false, 'showcases'),
      close: () => presetLibrary.close(),
      list: () => presetStore.list<AiSceneSpec>('ai'),
      hiddenShowcases: () => hiddenShowcaseStore.listHiddenIds(),
      deleteShowcase: (id: string) => hiddenShowcaseStore.hide(id),
      restoreShowcases: () => hiddenShowcaseStore.restoreAll(),
    },
    textures: {
      store: textureStore,
      editor: textureEditor,
      agent: textureEditor.agent,
      library: textureLibrary,
      openEditor: (slot?: EditableTextureSlot) => (slot ? openAiEditorForSlot(slot) : textureEditor.open({})),
      closeEditor: () => textureEditor.close(),
      openLibrary: (tab?: 'mine' | 'templates') => textureLibrary.open(tab),
      closeLibrary: () => textureLibrary.close(),
    },
    schema: () => aiCapabilitySchema(),
    setScene(next: unknown) {
      sceneEpoch++
      cancelScheduledBuilds()
      clearAllPartCustomTextures()
      editor?.clearUndo()
      aiHistory.clear()
      sceneSpec = parseAiScene(next)
      selectedId = sceneSpec.parts[0]?.id
      refreshUi(true)
    },
    loadImageDataUrl: (dataUrl: string, name = 'reference.png') => processImageDataUrl(dataUrl, name),
    loadShowcase: (id = 'sakura') => { if (getAiShowcase(id)) loadShowcaseById(id) },
    applyGlobalLod: (level: number) => applyGlobalLod(level),
    solveGlobalLod: (target: number) => solveGlobalLod(target),
    setOptScope: (scope: 'all' | 'part') => setOptScope(scope),
    setWind: (on: boolean) => { windBtn.setAttribute('aria-pressed', String(on)); viewer?.setWind(on) },
    applyScribbleCutout: (strokes: number[]) => {
      if (!lastPixels || !lastImageDataUrl || !lastImageName) return undefined
      const mask = computeScribbleMask(lastPixels, new Uint8Array(strokes))
      return runAnalyzeOnPixels(lastPixels, lastImageName, lastImageDataUrl, mask)
    },
    clear: () => byId('ai-clear').click(),
    addPart: (kind: TreeKind) => addNewPart(kind),
    selectPart: (id: string) => selectPart(id),
    handleScreen: (id: number) => editor?.screenPosition(id),
    setEditMode: (on: boolean) => editUi?.setEnabled(on),
    get editScope() { return editScope() },
    get activePartId() { return activePart()?.id },
    setParam: (path: string, value: unknown) => { applyInspectorParam(path, value, true); panel.sync() },
    partScreen: (partId: string) => {
      const built = sceneAsset?.partAssets.get(partId)
      if (!built || !viewer) return undefined
      built.group.updateMatrixWorld(true)
      const box = new Box3().setFromObject(built.group)
      const c = box.getCenter(new Vector3()).project(viewer.camera)
      const rect = viewer.renderer.domElement.getBoundingClientRect()
      return { x: rect.left + (c.x + 1) * .5 * rect.width, y: rect.top + (1 - c.y) * .5 * rect.height }
    },
    setEditSubMode: (sub: EditSubMode) => { editor?.setSubMode(sub); editUi?.sync() },
    selectBranch: (id: number | undefined) => editor?.selectBranch(id),
    selectedBranch: () => editor?.getSelectedBranchInfo(),
    branchScreen: (id: number, t?: number) => editor?.branchScreen(id, t),
    gizmoScreen: (target: GizmoKind | 'root' | `spline-${number}`) => editor?.gizmoScreen(target),
    normalCenterScreen: () => editor?.normalCenterScreen(),
    setNormalTool: (tool: NormalTool) => { editor?.setNormalTool(tool); editUi?.sync() },
    setNormalDebugColor: (on: boolean) => { editor?.setNormalDebugColor(on); editUi?.sync() },
    setShowNormalVectors: (on: boolean) => { editor?.setShowNormalVectors(on); editUi?.sync() },
    undoEdit: () => editor?.undo() ?? false,
    lastImageName: () => lastImageName,
    snapshotCanvas: (opts?: { transparent?: boolean }) => captureAiPng(Boolean(opts?.transparent)),
    snapshotTransparentCanvas: () => captureAiPng(true),
  },
})

mountDesktopToolbarBadge('header.bar nav', msg => message(msg))

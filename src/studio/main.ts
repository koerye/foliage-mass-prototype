import '../style.css'
import './studio.css'
import { Box3, Vector3 } from 'three'
import { lightingPresets, Viewer, type Camera, type LightingPreset } from '../viewport'
import { buildTree, views, type TreeAsset, type View } from '../tree/assemble'
import { CrownEnvelope, defaultHandles } from '../tree/envelope'
import { buildSkeleton } from '../tree/skeleton'
import { optimizeAt, solveForTriangleBudget } from '../tree/optimize'
import { defaultOptimize, parseTreeSpec, presetIds, presets, presetSpec, type BranchEdit, type PresetId, type TreeKind, type TreeSpec } from '../tree/spec'
import { CrownEditor, type EditSubMode, type GizmoKind } from './editor'
import { bindEditToolsUi, editToolsHtml } from './editor-ui'
import { bindGlbExportPopover } from './glb-export-ui'
import { bindPanel, panelHtml, setPath } from './panel'
import { mountPresetLibrary } from './preset-library'
import { captureViewportThumbnail, createPresetStore, deepClone } from './preset-store'
import { bindTextureSlots, createTextureRegistry, type AllTextureSlot } from './texture-slots'

const cameras: Record<Camera, string> = { front: '正面', angle: '45°', side: '侧面', top: '斜俯视' }
const viewLabel: Record<View, string> = { final: '成品', skeleton: '枝干骨架', crown: '树冠' }
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const fmt = new Intl.NumberFormat('zh-CN')
const lowIds: PresetId[] = ['shrub-round', 'shrub-spread', 'shrub-flower', 'conifer-shrub', 'grass-clump', 'grass-narrow', 'grass-dense', 'grass-tall', 'fern']
const presetGroups: [string, PresetId[]][] = [
  ['阔叶树', presetIds.filter(id => presets[id].kind === 'broadleaf' && !lowIds.includes(id))],
  ['针叶树', presetIds.filter(id => presets[id].kind === 'conifer' && !lowIds.includes(id))],
  ['棕榈树', presetIds.filter(id => presets[id].kind === 'palm')],
  ['低矮植物', lowIds],
  ['花丛模板', presetIds.filter(id => presets[id].kind === 'flowerbed')],
]

byId('app').classList.add('s-studio')
byId('app').innerHTML = `
<header class="bar">
  <div class="brand"><span class="mark" aria-hidden="true">♧</span><div><h1>Vegetation Studio</h1><span>程序化树木工作台 · v2</span></div></div>
  <nav aria-label="项目操作">
    <a class="b-link" href="./ai.html" title="空白工程 · 拖图自动生成并暴露全部参数能力">✦ AI 模式</a>
    <a class="b-link" href="./legacy.html">旧版工作台</a>
    <button id="preset-save" class="pl-save-btn" title="带当前 3D 实时封面保存为预设">★ 保存预设</button>
    <button id="preset-lib" title="打开可视化预设库（支持悬停实时 3D 预览）">预设库<span class="pl-badge" id="preset-lib-count">0</span></button>
    <input id="file" type="file" accept=".json,application/json" hidden>
    <button id="import">导入 JSON</button><button id="json">保存 JSON</button>
    <button id="png">截图 PNG</button><button id="glb" class="primary">导出 GLB</button>
  </nav>
</header>
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
      <label class="s-field s-top"><span>随机种子</span><input id="seed" type="number" min="0" step="1"><button type="button" id="reseed" title="随机">🎲</button></label>
      ${panelHtml()}
    </div>
  </form>
</section>
<div id="toast" class="toast" role="status" hidden></div>`

// ---------------------------------------------------------------------------
let presetId: PresetId = (new URL(location.href).searchParams.get('preset') as PresetId) ?? 'broadleaf-round'
if (!presetIds.includes(presetId)) presetId = 'broadleaf-round'
let activeCustomId: string | undefined
let lighting: LightingPreset = 'neutral'
let spec: TreeSpec = withDefaultHandles(presetSpec(presetId))
const kindLabels: Record<TreeKind, string> = {
  broadleaf: '阔叶树', conifer: '针叶树', palm: '棕榈树', grass: '草丛', fern: '蕨类', flowerbed: '花丛模板',
}
let asset: TreeAsset | undefined
let view: View = 'final'
let camera: Camera = 'front'
const registry = createTextureRegistry()
const textures = registry.textures
let toastTimer: ReturnType<typeof setTimeout>

function message(value: unknown, error = false) {
  const toast = byId('toast')
  clearTimeout(toastTimer)
  toast.textContent = value instanceof Error ? value.message : String(value)
  toast.classList.toggle('is-error', error)
  toast.hidden = false
  toastTimer = setTimeout(() => { toast.hidden = true }, 4000)
}

function axisOf(s: TreeSpec) { return buildSkeleton({ ...s, handles: [] }).envelope.axis }
function withDefaultHandles(s: TreeSpec): TreeSpec {
  return { ...s, handles: defaultHandles(new CrownEnvelope(s, axisOf(s))) }
}

let viewer: Viewer | undefined
try {
  viewer = new Viewer(byId('canvas'), (_, calls) => { byId('stat-calls').textContent = fmt.format(calls) })
} catch (error) {
  console.warn(error)
  byId('webgl').hidden = false
}

let cachedAxis = { key: '', axis: axisOf(spec) }
let editUi: ReturnType<typeof bindEditToolsUi> | undefined
const editor = viewer ? new CrownEditor(viewer, {
  spec: () => spec,
  axis: () => {
    const key = JSON.stringify([spec.kind, spec.seed, spec.trunk, spec.crown.base, spec.palm.bend, spec.palm.sCurve])
    if (key !== cachedAxis.key) cachedAxis = { key, axis: axisOf(spec) }
    return cachedAxis.axis
  },
  skeleton: () => asset?.skeleton,
  setHandles: (handles, final) => {
    spec = { ...spec, handles }
    scheduleBuild(final)
  },
  setBranchEdits: (branchEdits: BranchEdit[], final: boolean) => {
    const next = { ...spec }
    if (branchEdits.length) next.branchEdits = branchEdits
    else delete next.branchEdits
    spec = next
    scheduleBuild(final)
  },
  selected: handle => editUi?.showSelectedHandle(handle),
  selectedBranch: info => editUi?.showSelectedBranch(info),
  onStateChange: () => editUi?.sync(),
}) : undefined

// ---- build scheduling: live while dragging, adaptive to generation cost ----
let lastBuildMs = 0, lastBuildAt = 0, pending = false, pendingFinal = false, frame = 0, frameHeight = 0, buildCount = 0
function scheduleBuild(final = true) {
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

function rebuild(reframe: boolean, final = true) {
  pending = false
  pendingFinal = false
  if (!viewer) return
  const started = performance.now()
  try {
    const next = buildTree(spec, textures)
    next.display(view)
    const box = new Box3().setFromObject(next.group), size = box.getSize(new Vector3())
    const height = box.max.y * 1.03 + .05
    const span = 2 * Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), size.x * .5) * 1.3
    const aspect = viewer.host.clientWidth / Math.max(1, viewer.host.clientHeight)
    if (reframe || !frameHeight) frameHeight = Math.max(height * 1.05, (span + height * .12) / Math.max(.56, aspect) / 1.16)
    viewer.showModel(next.group, frameHeight, false)
    if (reframe) viewer.frame(camera)
    asset?.dispose()
    asset = next
    buildCount++
    for (const [key, value] of Object.entries(asset.stats)) {
      const el = document.getElementById('stat-' + key)
      if (el) el.textContent = fmt.format(value)
    }
    byId('label-branches').textContent = spec.kind === 'flowerbed' ? '植物杆' : '枝条'
    byId('label-twigs').textContent = spec.kind === 'broadleaf' ? '细枝' : '—'
    byId('label-leaves').textContent = ({ broadleaf: '叶片卡', conifer: '针叶片', palm: '棕榈叶', grass: '草叶', fern: '蕨叶', flowerbed: '花朵' } as const)[spec.kind]
    if (spec.kind !== 'broadleaf') byId('stat-twigs').textContent = '—'
    updateOptStatus(asset.stats.triangles, !final)
    viewer.refreshShadows()
    editor?.refresh()
    if (final && presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) {
      presetLibrary.refreshCapture(false)
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
    const raw = buildTree({ ...spec, optimize: defaultOptimize }, textures)
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
  default: ['#5c7a3c', '#f4ffd8'],
  cloud: ['#2f6e31', '#88d458'],
  sakura: ['#c44d74', '#fcb9d0'],
  maple: ['#9e1f1b', '#ff8a36'],
  willow: ['#4e7d36', '#d9f28a'],
  bush: ['#164f33', '#d6ff66'],
  flower: ['#d45c88', '#ffd2e4'],
}
const panel = bindPanel(byId('panel'), () => spec, (path, value, final) => {
  if (path === 'optimize.level') {
    spec = { ...spec, optimize: optimizeAt(Number(value), spec.optimize.targetTriangles) }
    panel.sync()
  } else if (path === 'shading.leafStyle') {
    const nextStyle = String(value)
    const pal = stylePalettes[nextStyle]
    spec = setPath(spec, path, value)
    if (pal) {
      const nextCard = nextStyle === 'willow'
        ? 'drape' as const
        : spec.leaves.cardType === 'drape' ? 'quad' as const : spec.leaves.cardType
      spec = { ...spec, leaves: { ...spec.leaves, tintInner: pal[0], tintOuter: pal[1], cardType: nextCard } }
    }
    panel.sync()
  } else {
    spec = setPath(spec, path, value)
  }
  if (path === 'optimize.targetTriangles') return
  if (asset?.applyLiveParam(path, spec)) {
    if (path === 'shading.softSelfShadow') viewer?.refreshShadows()
    return
  }
  scheduleBuild(final)
})

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lod]')) btn.onclick = () => {
  spec = { ...spec, optimize: optimizeAt(Number(btn.dataset.lod), spec.optimize.targetTriangles) }
  panel.sync()
  rebuild(false)
}
byId('opt-solve').onclick = () => {
  const goal = Math.max(200, Math.round(byId<HTMLInputElement>('opt-target').valueAsNumber || spec.optimize.targetTriangles || 3000))
  const res = solveForTriangleBudget(spec, textures, goal)
  spec = { ...spec, optimize: res.optimize }
  panel.sync()
  rebuild(false)
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

function applySpec(next: TreeSpec, reframe = true) {
  spec = next
  byId('tree-title').textContent = spec.name
  const presetSel = byId<HTMLSelectElement>('preset')
  const want = activeCustomId ? `custom:${activeCustomId}` : presetId
  if ([...presetSel.options].some(o => o.value === want)) presetSel.value = want
  byId<HTMLInputElement>('seed').value = String(spec.seed)
  panel.sync()
  texSlots?.syncThumbnails()
  cachedAxis.key = ''
  editor?.refresh()
  rebuild(reframe)
}

// ---- inspector events ------------------------------------------------------
byId<HTMLSelectElement>('preset').onchange = () => {
  const val = byId<HTMLSelectElement>('preset').value
  if (val.startsWith('custom:')) {
    const cid = val.slice(7)
    const saved = presetStore.get<TreeSpec>(cid)
    if (!saved) return
    activeCustomId = saved.id
    presetLibrary.setActiveId(saved.id)
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
  const mood: LightingPreset = presetId === 'broadleaf-sakura' ? 'sakura'
    : presetId.startsWith('conifer') ? 'forest'
      : presetId === 'broadleaf-maple' || presetId === 'broadleaf-willow' || presetId.startsWith('palm') ? 'ghibli'
        : 'neutral'
  setLightingMood(mood)
  applySpec(withDefaultHandles(presetSpec(presetId)))
  if (presetLibrary?.isOpen() && !presetLibrary.isPreviewing()) presetLibrary.refreshCapture(true)
}
byId<HTMLInputElement>('seed').onchange = () => {
  const seed = Math.max(0, Math.round(byId<HTMLInputElement>('seed').valueAsNumber || 0))
  applySpec({ ...spec, seed }, false)
}
byId('reseed').onclick = () => applySpec({ ...spec, seed: Math.floor(Math.random() * 99999) }, false)
byId('reset').onclick = () => {
  const saved = activeCustomId ? presetStore.get<TreeSpec>(activeCustomId) : undefined
  if (saved) {
    setLightingMood(saved.lighting)
    applySpec(deepClone(saved.payload), true)
    return
  }
  applySpec(withDefaultHandles(presetSpec(presetId)))
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.onclick = () => {
  view = button.dataset.view as View
  asset?.display(view)
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

// ---- SpeedTree node & crown editing tools ----------------------------------
editUi = bindEditToolsUi({
  editor,
  getSpec: () => spec,
  onHandlesChange: (handles, final) => {
    spec = { ...spec, handles }
    scheduleBuild(final)
  },
  onResetHandles: () => {
    spec = withDefaultHandles(spec)
    rebuild(false)
  },
  onMessage: message,
})

// ---- textures (lazy registry + shared slot bindings) -----------------------
const texSlots = bindTextureSlots(registry, {
  onBeforeUseCustom: slot => {
    if (slot === 'leaf' && spec.shading.leafStyle !== 'default') {
      spec = { ...spec, shading: { ...spec.shading, leafStyle: 'default' } }
      panel.sync()
    } else if (slot === 'grass' && spec.kind === 'grass' && spec.ground.mode !== 'card') {
      spec = { ...spec, ground: { ...spec.ground, mode: 'card' } }
      panel.sync()
    }
  },
  onChange: () => rebuild(false),
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
    presetId = presetIds.find(id => presets[id].kind === next.kind && presets[id].name === next.name) ?? presetIds.find(id => presets[id].kind === next.kind)!
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
  const url = URL.createObjectURL(blob)
  download(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
const fileName = () => `${presetId}-${spec.seed}`
byId('json').onclick = () => save(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), fileName() + '.json')
byId('png').onclick = () => {
  if (!viewer) return
  const wasVisible = editor?.group.visible
  if (editor) editor.group.visible = false
  download(viewer.snapshot(), fileName() + '-' + view + '-' + camera + '.png')
  if (editor) editor.group.visible = Boolean(wasVisible)
}
const glb = byId<HTMLButtonElement>('glb')
bindGlbExportPopover({
  triggerButton: glb,
  getRoot: () => asset?.group,
  exportBlob: opts => asset!.exportGlb(opts),
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
  if (activeCustomId && list.some(x => x.id === activeCustomId)) sel.value = `custom:${activeCustomId}`
}

const presetLibrary = mountPresetLibrary<TreeSpec, { spec: TreeSpec; lighting: LightingPreset; presetId: PresetId; activeCustomId?: string; frameHeight: number }>({
  scope: 'tree',
  store: presetStore,
  capture: () => ({
    defaultName: spec.name,
    kind: spec.kind,
    kindLabel: kindLabels[spec.kind],
    triangles: asset?.stats.triangles ?? 0,
    lighting,
    thumbnail: captureViewportThumbnail(viewer, [editor?.group]),
    payload: spec,
  }),
  snapshotState: () => ({ spec: deepClone(spec), lighting, presetId, activeCustomId, frameHeight }),
  restoreState: snap => {
    presetId = snap.presetId
    activeCustomId = snap.activeCustomId
    const needReframe = Math.abs(frameHeight - snap.frameHeight) / Math.max(.5, snap.frameHeight) > .25
    setLightingMood(snap.lighting)
    applySpec(snap.spec, needReframe)
  },
  preview: preset => {
    const prevH = spec.trunk.height
    const nextH = preset.payload.trunk.height
    const scaleChanged = Math.abs(nextH - prevH) / Math.max(.5, prevH) > .35 || preset.payload.kind !== spec.kind
    setLightingMood(preset.lighting)
    applySpec(deepClone(preset.payload), scaleChanged)
  },
  apply: preset => {
    activeCustomId = preset.id
    editor && (editor.selectedId = undefined, editor.selectedBranchId = undefined)
    editUi?.showSelectedHandle(undefined)
    setLightingMood(preset.lighting)
    applySpec(deepClone(preset.payload), true)
  },
  message,
  onActiveChange: id => {
    activeCustomId = id
    syncCustomPresetOptions()
  },
})

presetStore.subscribe(syncCustomPresetOptions)
void presetStore.ready().then(syncCustomPresetOptions)
syncCustomPresetOptions()

byId('preset-save').onclick = () => presetLibrary.open(true)
byId('preset-lib').onclick = () => presetLibrary.toggle()

applySpec(spec)

// automation hooks for browser checks
Object.assign(window, { __studio: {
  get spec() { return spec },
  get stats() { return asset ? { ...asset.stats } : undefined },
  get buildCount() { return buildCount },
  loadedTextures: () => registry.loadedSlots(),
  presets: {
    store: presetStore,
    open: (focus?: boolean) => presetLibrary.open(focus),
    close: () => presetLibrary.close(),
    list: () => presetStore.list<TreeSpec>('tree'),
  },
  set(patch: (s: TreeSpec) => TreeSpec) { applySpec(patch(spec), false) },
  handleScreen: (id: number) => editor?.screenPosition(id),
  setEditMode: (on: boolean) => editUi?.setEnabled(on),
  setEditSubMode: (sub: EditSubMode) => { editor?.setSubMode(sub); editUi?.sync() },
  selectBranch: (id: number | undefined) => editor?.selectBranch(id),
  selectedBranch: () => editor?.getSelectedBranchInfo(),
  branchScreen: (id: number, t?: number) => editor?.branchScreen(id, t),
  gizmoScreen: (target: GizmoKind | `spline-${number}`) => editor?.gizmoScreen(target),
  undoEdit: () => editor?.undo() ?? false,
  extent() {
    const pts = asset?.skeleton.branches.flatMap(b => b.points) ?? []
    return { minX: Math.min(...pts.map(p => p.x)), maxX: Math.max(...pts.map(p => p.x)), maxY: Math.max(...pts.map(p => p.y)), minY: Math.min(...pts.map(p => p.y)) }
  },
  setWind: (on: boolean) => { windBtn.setAttribute('aria-pressed', String(on)); viewer?.setWind(on) },
  textureDataUrl: (slot: AllTextureSlot) => (registry.get(slot).image as HTMLCanvasElement).toDataURL('image/png'),
} })
